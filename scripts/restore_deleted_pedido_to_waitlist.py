"""
Restaura un pedido borrado de Firestore → crea doc en revision_waitlist
usando el ultimo snapshot conocido del changelog BQ.

Util cuando:
- El pedido fue borrado del todo (ya no existe en pedidos/)
- Se quiere traerlo de vuelta como "lista de espera" para editarlo

Flow:
1. Query pedidos_raw_raw_changelog por document_name con el PEDIDO_ID
2. Toma el ultimo evento (preferentemente DELETE con old_data, sino el ultimo UPDATE con data)
3. Parse el snapshot del pedido
4. Mapea lines → items (shape waitlist)
5. Crea doc en revision_waitlist

NO borra nada (el pedido ya esta borrado). Solo CREA el waitlist doc.

Env:
  PEDIDO_ID  (obligatorio) — Firestore doc ID del pedido borrado
  DRY_RUN    (default true)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] pip install firebase-admin', file=sys.stderr)
    sys.exit(2)

try:
    from google.cloud import bigquery
    from google.oauth2 import service_account
except ImportError:
    print('[ERROR] pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(2)


BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'

FB_SA_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')
PEDIDO_ID = os.environ.get('PEDIDO_ID', '').strip()
DRY_RUN = (os.environ.get('DRY_RUN', 'true').lower() != 'false')


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def init_firestore():
    if not FB_SA_JSON:
        raise SystemExit('[ERROR] FIREBASE_SERVICE_ACCOUNT no seteada')
    sa = json.loads(FB_SA_JSON)
    cred = credentials.Certificate(sa)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def init_bigquery():
    if not FB_SA_JSON:
        raise SystemExit('[ERROR] FIREBASE_SERVICE_ACCOUNT no seteada')
    sa = json.loads(FB_SA_JSON)
    creds = service_account.Credentials.from_service_account_info(sa)
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


def fetch_last_snapshot(bq, pedido_id):
    """Trae el ultimo evento del changelog para este pedido_id.
    Para DELETE: usa old_data. Para UPDATE/CREATE: usa data.
    """
    q = f"""
        SELECT
          timestamp,
          operation,
          data,
          old_data
        FROM `{BQ_PROJECT}.{BQ_DATASET}.pedidos_raw_raw_changelog`
        WHERE document_name LIKE @pattern
        ORDER BY timestamp DESC
        LIMIT 20
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter('pattern', 'STRING', f'%{pedido_id}'),
        ],
    )
    log(f'[BQ] query changelog para document_name LIKE %{pedido_id}...')
    rows = list(bq.query(q, job_config=job_config).result())
    log(f'[BQ] {len(rows)} eventos encontrados para este pedido')

    if not rows:
        return None

    # Log de todos los eventos para visibilidad.
    for i, r in enumerate(rows[:10]):
        has_data = 'yes' if r['data'] else 'no'
        has_old = 'yes' if r['old_data'] else 'no'
        log(f'  [{i}] {r["timestamp"]} op={r["operation"]} data={has_data} old_data={has_old}')

    # Buscar el snapshot MAS COMPLETO. Prioridad:
    # 1. Si el ultimo es DELETE: usar old_data (contiene estado antes del delete)
    # 2. Sino: usar data del ultimo evento (UPDATE o CREATE)
    first = rows[0]
    if str(first['operation']).upper() == 'DELETE' and first['old_data']:
        log(f'[BQ] usando OLD_DATA del DELETE event ({first["timestamp"]})')
        return parse_data(first['old_data']), first['timestamp'], 'DELETE_OLD_DATA'

    # Si no hay DELETE todavia O el DELETE no tiene old_data, buscar el ultimo
    # evento con `data` no vacio (va a ser el ultimo UPDATE/CREATE).
    for r in rows:
        if r['data']:
            log(f'[BQ] usando DATA del evento {r["operation"]} ({r["timestamp"]})')
            return parse_data(r['data']), r['timestamp'], str(r['operation'])

    return None


def parse_data(s):
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def main():
    log(f'=== restore_deleted_pedido_to_waitlist START ===')
    log(f'  PEDIDO_ID: {PEDIDO_ID or "(none)"}')
    log(f'  DRY_RUN: {DRY_RUN}')

    if not PEDIDO_ID:
        raise SystemExit('[ERROR] PEDIDO_ID no seteada')

    db = init_firestore()
    bq = init_bigquery()

    # 1) Verificar si el pedido todavia existe en Firestore.
    live_ref = db.collection('pedidos').document(PEDIDO_ID)
    live_snap = live_ref.get()
    if live_snap.exists:
        log(f'\n[AVISO] pedidos/{PEDIDO_ID} TODAVIA EXISTE en Firestore.')
        log(f'[AVISO] Este script es para pedidos BORRADOS. Si queres mover un pedido vivo')
        log(f'[AVISO] a waitlist, usa el script move_pedido_to_waitlist.py en su lugar.')
        return 1

    log(f'[OK] pedidos/{PEDIDO_ID} NO existe (confirmado borrado).')

    # 2) Fetch ultimo snapshot del changelog BQ.
    result = fetch_last_snapshot(bq, PEDIDO_ID)
    if not result:
        raise SystemExit(f'[ERROR] No encontre eventos en changelog BQ para {PEDIDO_ID}. No puedo restaurar.')

    data, snapshot_ts, source = result
    if not data or not isinstance(data, dict):
        raise SystemExit(f'[ERROR] El snapshot del changelog no tiene data valida. Source: {source}.')

    client_name = (data.get('clientName') or '').strip()
    client_card_code = (data.get('clientCardCode') or '').strip()
    client_province = (data.get('clientProvince') or data.get('province') or '').strip()
    client_locality = (data.get('clientLocality') or data.get('locName') or '').strip()
    owner_uid = data.get('ownerUid') or ''
    owner_email = data.get('ownerEmail') or ''
    owner_vendor = data.get('ownerVendor') or data.get('vendorAssigned') or ''
    order_number = data.get('orderNumber') or None
    stage = data.get('stage') or ''
    month = data.get('month') or ''
    lines = data.get('lines') or []

    log(f'\n[SNAPSHOT recuperado] (source={source}, timestamp={snapshot_ts})')
    log(f'  clientName:     {client_name}')
    log(f'  clientCardCode: {client_card_code or "(vacio)"}')
    log(f'  provincia/loc:  {client_province} / {client_locality}')
    log(f'  stage:          {stage}')
    log(f'  month:          {month}')
    log(f'  orderNumber:    {order_number}')
    log(f'  owner:          {owner_email} (vendor={owner_vendor})')
    log(f'  lines count:    {len(lines)}')

    # 3) Mapear lines → items.
    items = []
    total_qty = 0.0
    total_ars = 0.0
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        qty = float(ln.get('qty') or 0)
        if qty <= 0:
            continue
        precio = float(ln.get('precio') or 0)
        items.append({
            'code': ln.get('code', ''),
            'desc': ln.get('desc', ''),
            'qty': qty,
            'firstStockTotal': None,
            'firstBackorder': 0,
            'firstDisponible': None,
            '_originalPrecio': precio,
            '_originalState': ln.get('state', ''),
        })
        total_qty += qty
        total_ars += qty * precio

    if not items:
        raise SystemExit(f'[ERROR] El snapshot no tiene lines validas (qty > 0). Nada para restaurar.')

    log(f'  items validos:  {len(items)} ({total_qty:,.0f} unidades, ${total_ars:,.0f})')
    log(f'\n[SAMPLE items] (hasta 5):')
    for it in items[:5]:
        log(f'  {it["code"]:16s} x {it["qty"]:>6.0f} @ ${it["_originalPrecio"]:>10,.0f}  {it["desc"][:40]}')

    # 4) Payload waitlist.
    payload = {
        'clientName': client_name,
        'clientProvince': client_province,
        'clientLocality': client_locality,
        'clientCardCode': client_card_code,
        'vendorAssigned': owner_vendor,
        'ownerUid': owner_uid,
        'ownerEmail': owner_email,
        'ownerDisplayName': data.get('ownerDisplayName') or owner_email,
        'ownerVendor': owner_vendor,
        'orderNumber': order_number,
        'items': items,
        'fromPedidoFsId': PEDIDO_ID,
        'fromPedidoMonth': month,
        'fromPedidoStage': stage,
        '_restoredFromBqChangelog': {
            'script': 'restore_deleted_pedido_to_waitlist.py',
            'at': datetime.utcnow().isoformat() + 'Z',
            'originalPedidoId': PEDIDO_ID,
            'snapshotSource': source,
            'snapshotTimestamp': str(snapshot_ts),
        },
        'createdAt': firestore.SERVER_TIMESTAMP,
        'updatedAt': firestore.SERVER_TIMESTAMP,
    }

    if DRY_RUN:
        log(f'\n[DRY_RUN] NO escribo. Correr con DRY_RUN=false para aplicar.')
        log(f'[DRY_RUN] Si aplicas: crea nuevo doc en revision_waitlist con los {len(items)} items.')
        return 0

    log(f'\n[WRITE] creando doc nuevo en revision_waitlist...')
    waitlist_ref = db.collection('revision_waitlist').document()
    try:
        waitlist_ref.set(payload)
        log(f'[WRITE] revision_waitlist/{waitlist_ref.id} creado OK')
    except Exception as e:
        log(f'[ERROR] fallo creating waitlist: {e}')
        raise

    log(f'\n[DONE] pedido restaurado exitosamente.')
    log(f'  Original: pedidos/{PEDIDO_ID} (borrado)')
    log(f'  Nuevo:    revision_waitlist/{waitlist_ref.id}')
    log(f'  Admin va a verlo en PEDIDOS EN ESPERA al proximo refresh del browser.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
