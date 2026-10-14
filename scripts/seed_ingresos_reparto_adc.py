"""One-shot v1293 (2026-10-14): generar docs ingresos_reparto para TODOS los
SKUs con stock dep11 > 0 Y BO pendiente, para que aparezcan en el modal
Reparto. Caso Mariano post-v1288: la CF onDep11IncreaseCreateReparto solo
crea docs cuando detecta delta positivo. SKUs con stock previo + BO viejo
no tienen doc → invisible en Reparto.

Reglas:
  - Lee app_config/stock_snapshot (warehouseBreakdown) → stock por SKU en whs 11.
  - Lee pedidos abiertos (closedAt==null, stage=confirmed) → junta lineas state=BO.
  - Para cada SKU con stock_dep11 > 0 Y BO total > 0:
      * Si YA existe doc ingresos_reparto pending con ese SKU → skip.
      * Si NO existe → crea doc con qtyIngresada = stock_dep11,
        clientesBO = lista FIFO.
  - Marca source='manual-seed-v1293' para auditoria.

Uso:
    DRY_RUN=true  python scripts/seed_ingresos_reparto_adc.py
    DRY_RUN=false python scripts/seed_ingresos_reparto_adc.py
"""
from __future__ import annotations
import os, json
from datetime import datetime, timezone
from google.cloud import firestore

DRY_RUN = (os.environ.get('DRY_RUN', 'true').lower() != 'false')
PROJECT = 'app-vendedores-shimano'


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def _iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def main():
    log('=== seed_ingresos_reparto_adc START ===')
    log(f'  DRY_RUN: {DRY_RUN}')
    db = firestore.Client(project=PROJECT)

    # 1. Stock por SKU (dep 11).
    stock_doc = db.collection('app_config').document('stock_snapshot').get()
    stock_data = stock_doc.to_dict() or {}
    whb_raw = stock_data.get('warehouseBreakdown')
    if isinstance(whb_raw, str):
        try:
            whb = json.loads(whb_raw)
        except Exception:
            whb = {}
    else:
        whb = whb_raw or {}
    stock_dep11 = {sku.upper(): int((whs or {}).get('11') or 0) for sku, whs in whb.items()}
    skus_con_stock = {sku: qty for sku, qty in stock_dep11.items() if qty > 0}
    log(f'  SKUs con stock dep11>0: {len(skus_con_stock)}')

    # 2. Pedidos abiertos + lineas BO.
    pedidos_snap = db.collection('pedidos').where('closedAt', '==', None).get()
    pedidos = []
    for p in pedidos_snap:
        d = p.to_dict() or {}
        if d.get('stage') != 'confirmed':
            continue
        pedidos.append((p.id, d))
    log(f'  pedidos confirmed abiertos: {len(pedidos)}')

    # 3. Group BO por SKU, armar clientesBO FIFO.
    bo_by_sku = {}
    for pid, data in pedidos:
        lines = data.get('lines') or []
        for i, l in enumerate(lines):
            if not l or not l.get('code'):
                continue
            if l.get('state') != 'BO':
                continue
            qo = int(l.get('qtyOpen') or 0)
            if qo <= 0:
                continue
            sku = str(l.get('code')).upper()
            created = data.get('createdAt')
            if hasattr(created, 'timestamp'):
                created_ms = int(created.timestamp() * 1000)
                created_iso = created.isoformat().replace('+00:00', 'Z')
            elif isinstance(created, str):
                try:
                    created_ms = int(datetime.fromisoformat(created.replace('Z', '+00:00')).timestamp() * 1000)
                except Exception:
                    created_ms = 0
                created_iso = created
            else:
                created_ms = 0
                created_iso = None
            bo_by_sku.setdefault(sku, []).append({
                'pedidoId': pid,
                'lineIndex': i,
                'clientCardCode': str(data.get('clientCardCode') or '').strip(),
                'clientName': str(data.get('clientName') or '').strip(),
                'clientProvince': str(data.get('province') or data.get('clientProvince') or '').strip(),
                'clientLocality': str(data.get('locName') or data.get('clientLocality') or '').strip(),
                'pedidoCreatedAt': created_iso,
                'qtyBackorder': qo,
                '_createdMs': created_ms,
            })

    # 4. Lista ingresos pending existentes.
    exist_snap = (
        db.collection('ingresos_reparto')
        .where('status', '==', 'pending')
        .get()
    )
    existing_pending = set()
    for d in exist_snap:
        dd = d.to_dict() or {}
        existing_pending.add(str(dd.get('sku') or '').upper())
    log(f'  ingresos pending existentes: {len(existing_pending)}')

    # 5. Determinar SKUs a seedear.
    nuevos = []
    for sku, stock_qty in skus_con_stock.items():
        if sku in existing_pending:
            continue
        bo_list = bo_by_sku.get(sku) or []
        if not bo_list:
            continue
        bo_sorted = sorted(bo_list, key=lambda x: (x['_createdMs'], x['pedidoId']))
        clientes = [{k: v for k, v in c.items() if k != '_createdMs'} for c in bo_sorted]
        total_bo = sum(int(c['qtyBackorder']) for c in clientes)
        nuevos.append({'sku': sku, 'stock': stock_qty, 'clientes': clientes, 'total_bo': total_bo})

    log(f'  SKUs a seedear (stock>0 + BO>0 + sin ingreso pending): {len(nuevos)}')
    for n in nuevos[:20]:
        log(f'    - {n["sku"]}: stock={n["stock"]}, BO total={n["total_bo"]}, {len(n["clientes"])} clientes')
    if len(nuevos) > 20:
        log(f'    ... y {len(nuevos) - 20} mas')

    if DRY_RUN:
        log('=== DONE (DRY_RUN) ===')
        return

    # 6. Crear docs.
    now_iso = _iso()
    for n in nuevos:
        doc = {
            'sku': n['sku'],
            'qtyIngresada': int(n['stock']),
            'detectedAt': now_iso,
            'status': 'pending',
            'clientesBO': n['clientes'],
            'qtyBackorderTotal': int(n['total_bo']),
            'clientesCount': len(n['clientes']),
            'appliedAt': None,
            'appliedBy': None,
            'assignments': None,
            'source': 'manual-seed-v1293',
            'seedNote': 'generado masivo — SKU con stock dep11 + BO pendiente sin doc previo',
        }
        db.collection('ingresos_reparto').add(doc)
    log(f'=== DONE (APPLIED, {len(nuevos)} docs creados) ===')


if __name__ == '__main__':
    main()
