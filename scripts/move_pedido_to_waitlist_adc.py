"""Wrapper ADC de move_pedido_to_waitlist.py — usa gcloud ADC en vez de SA key.

Uso:
    PEDIDO_ID=fcqwk2A9uPrZNYX8JHFr DRY_RUN=true  python scripts/move_pedido_to_waitlist_adc.py
    PEDIDO_ID=fcqwk2A9uPrZNYX8JHFr DRY_RUN=false python scripts/move_pedido_to_waitlist_adc.py
"""
from __future__ import annotations
import os, sys
from datetime import datetime
from google.cloud import firestore

PEDIDO_ID = os.environ.get('PEDIDO_ID', '').strip()
DRY_RUN = (os.environ.get('DRY_RUN', 'true').lower() != 'false')
PROJECT = 'app-vendedores-shimano'


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def main():
    log(f'=== move_pedido_to_waitlist_adc START ===')
    log(f'  PEDIDO_ID: {PEDIDO_ID or "(none)"}')
    log(f'  DRY_RUN: {DRY_RUN}')
    if not PEDIDO_ID:
        raise SystemExit('[ERROR] PEDIDO_ID no seteada')

    db = firestore.Client(project=PROJECT)

    ref = db.collection('pedidos').document(PEDIDO_ID)
    snap = ref.get()
    if not snap.exists:
        raise SystemExit(f'[ERROR] pedidos/{PEDIDO_ID} no existe.')
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
        })
        total_qty += qty
        total_ars += qty * precio

    if not items:
        raise SystemExit(f'[ERROR] pedidos/{PEDIDO_ID} no tiene lines validas.')

    log(f'  items validos:  {len(items)} ({total_qty:,.0f} unidades, ${total_ars:,.0f})')

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
        '_movedByScript': {
            'script': 'move_pedido_to_waitlist_adc.py',
            'at': datetime.utcnow().isoformat() + 'Z',
            'originalPedidoId': PEDIDO_ID,
        },
        'createdAt': firestore.SERVER_TIMESTAMP,
        'updatedAt': firestore.SERVER_TIMESTAMP,
    }

    log(f'\n[PAYLOAD waitlist]')
    log(f'    clientName:     {payload["clientName"]}')
    log(f'    clientCardCode: {payload["clientCardCode"]}')
    log(f'    vendorAssigned: {payload["vendorAssigned"]}')
    log(f'    orderNumber:    {payload["orderNumber"]}')
    log(f'    items:          {len(payload["items"])}')
    log(f'    fromPedidoFsId: {payload["fromPedidoFsId"]}')

    if DRY_RUN:
        log(f'\n[DRY_RUN] NO escribo. Correr con DRY_RUN=false para aplicar.')
        return 0

    log(f'\n[WRITE] creando doc en revision_waitlist...')
    waitlist_ref = db.collection('revision_waitlist').document()
    waitlist_ref.set(payload)
    log(f'[WRITE] revision_waitlist/{waitlist_ref.id} creado OK')

    log(f'[WRITE] borrando pedidos/{PEDIDO_ID}...')
    ref.delete()
    log(f'[WRITE] pedidos/{PEDIDO_ID} borrado OK')

    log(f'\n[DONE] pedido movido exitosamente.')
    log(f'  pedidos/{PEDIDO_ID}  →  revision_waitlist/{waitlist_ref.id}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
