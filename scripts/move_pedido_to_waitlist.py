"""
Mueve un pedido de Firestore `pedidos` → `revision_waitlist` (one-shot).

Replica la logica de window.volverAListaEspera (index.html:31013+) pero
server-side y sin el gate `stage==='pending'` — util para rescatar pedidos
confirmed (ej. el pedido Ricardo Blanco Goitia ORDEN 325 post-incident
2026-10-07).

Flow:
1. Lee pedidos/{PEDIDO_ID}
2. Mapea lines → items (code, desc, qty, firstStockTotal/Backorder/Disponible = null)
3. Crea doc nuevo en revision_waitlist con mismos clientName/cardCode/vendor/orderNumber
4. Borra el pedido original en pedidos/

Env:
  PEDIDO_ID  (obligatorio) — Firestore doc ID del pedido a mover
  DRY_RUN    (default true) — 'false' aplica writes

Output:
  stdout con detalle del pedido + items + confirmacion de write (si apply)
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


def main():
    log(f'=== move_pedido_to_waitlist START ===')
    log(f'  PEDIDO_ID: {PEDIDO_ID or "(none)"}')
    log(f'  DRY_RUN: {DRY_RUN}')

    if not PEDIDO_ID:
        raise SystemExit('[ERROR] PEDIDO_ID no seteada')

    db = init_firestore()

    # 1) Fetch pedido.
    ref = db.collection('pedidos').document(PEDIDO_ID)
    snap = ref.get()
    if not snap.exists:
        raise SystemExit(f'[ERROR] pedidos/{PEDIDO_ID} no existe. Verificar ID.')
    data = snap.to_dict() or {}

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

    log(f'[READ] pedidos/{PEDIDO_ID}:')
    log(f'  clientName:     {client_name}')
    log(f'  clientCardCode: {client_card_code or "(vacio)"}')
    log(f'  provincia/loc:  {client_province} / {client_locality}')
    log(f'  stage:          {stage}')
    log(f'  month:          {month}')
    log(f'  orderNumber:    {order_number}')
    log(f'  owner:          {owner_email} (vendor={owner_vendor})')
    log(f'  lines count:    {len(lines)}')

    # 2) Mapear lines → items (shape que espera revision_waitlist).
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
            # firstStockTotal/Backorder/Disponible NO los tenemos server-side sin
            # consultar sap_stock_snapshot. Dejamos null → la UI de waitlist los
            # resuelve on-demand igual.
            'firstStockTotal': None,
            'firstBackorder': 0,
            'firstDisponible': None,
            # Preservamos el precio original para traceability.
            '_originalPrecio': precio,
        })
        total_qty += qty
        total_ars += qty * precio

    if not items:
        raise SystemExit(f'[ERROR] pedidos/{PEDIDO_ID} no tiene lines validas (qty > 0). Nada para mover.')

    log(f'  items validos:  {len(items)} ({total_qty:,.0f} unidades, ${total_ars:,.0f})')

    # 3) Construir payload para revision_waitlist.
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
        # Marca que vino de un pedido revertido (replica fromPedidoFsId del flow UI).
        'fromPedidoFsId': PEDIDO_ID,
        'fromPedidoMonth': month,
        'fromPedidoStage': stage,
        # Marca que fue hecho por script (vs UI).
        '_movedByScript': {
            'script': 'move_pedido_to_waitlist.py',
            'at': datetime.utcnow().isoformat() + 'Z',
            'originalPedidoId': PEDIDO_ID,
        },
        'createdAt': firestore.SERVER_TIMESTAMP,
        'updatedAt': firestore.SERVER_TIMESTAMP,
    }

    log(f'\n[PAYLOAD waitlist]')
    log(f'  (preview — campos clave):')
    log(f'    clientName:     {payload["clientName"]}')
    log(f'    clientCardCode: {payload["clientCardCode"]}')
    log(f'    vendorAssigned: {payload["vendorAssigned"]}')
    log(f'    orderNumber:    {payload["orderNumber"]}')
    log(f'    items:          {len(payload["items"])}')
    log(f'    fromPedidoFsId: {payload["fromPedidoFsId"]}')

    if DRY_RUN:
        log(f'\n[DRY_RUN] NO escribo nada. Correr con DRY_RUN=false para aplicar.')
        log(f'[DRY_RUN] Si aplicas:')
        log(f'  1. Crear doc nuevo en revision_waitlist (ID auto-generado)')
        log(f'  2. Borrar pedidos/{PEDIDO_ID}')
        return 0

    # 4) WRITE: crear waitlist + borrar pedido.
    log(f'\n[WRITE] creando doc en revision_waitlist...')
    waitlist_ref = db.collection('revision_waitlist').document()
    try:
        waitlist_ref.set(payload)
        log(f'[WRITE] revision_waitlist/{waitlist_ref.id} creado OK')
    except Exception as e:
        log(f'[ERROR] fallo creating waitlist: {e}')
        raise

    log(f'[WRITE] borrando pedidos/{PEDIDO_ID}...')
    try:
        ref.delete()
        log(f'[WRITE] pedidos/{PEDIDO_ID} borrado OK')
    except Exception as e:
        log(f'[ERROR] fallo delete pedido: {e}')
        log(f'[AVISO] waitlist/{waitlist_ref.id} creado pero pedido original SIGUE EN FIRESTORE. Borrar manual.')
        raise

    log(f'\n[DONE] pedido movido exitosamente.')
    log(f'  pedidos/{PEDIDO_ID}  →  revision_waitlist/{waitlist_ref.id}')
    log(f'  Admin va a verlo en PEDIDOS EN ESPERA al proximo refresh del browser.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
