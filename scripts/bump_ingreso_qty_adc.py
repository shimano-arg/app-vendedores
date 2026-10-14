"""One-shot v1292 (2026-10-14): bumpear qtyIngresada de un doc pending en
`ingresos_reparto/`. Caso Mariano EXGTVC66M4AR: la CF detecto delta de dep11
solo de 3u pero el stock dep11 real es 22u -> Mariano quiere repartir las 22.

Uso:
    SKU=EXGTVC66M4AR NEW_QTY=22 DRY_RUN=true  python scripts/bump_ingreso_qty_adc.py
    SKU=EXGTVC66M4AR NEW_QTY=22 DRY_RUN=false python scripts/bump_ingreso_qty_adc.py
"""
from __future__ import annotations
import os
from datetime import datetime
from google.cloud import firestore

SKU = os.environ.get('SKU', '').strip().upper()
NEW_QTY = int(os.environ.get('NEW_QTY', '0'))
DRY_RUN = (os.environ.get('DRY_RUN', 'true').lower() != 'false')
PROJECT = 'app-vendedores-shimano'


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def main():
    log('=== bump_ingreso_qty_adc START ===')
    log(f'  SKU: {SKU or "(none)"}')
    log(f'  NEW_QTY: {NEW_QTY}')
    log(f'  DRY_RUN: {DRY_RUN}')
    if not SKU:
        raise SystemExit('[ERROR] SKU no seteado')
    if NEW_QTY <= 0:
        raise SystemExit('[ERROR] NEW_QTY debe ser > 0')

    db = firestore.Client(project=PROJECT)

    # v1300 (2026-10-14): validar NEW_QTY vs stock dep11 real de SAP para
    # evitar typos destructivos (ej: 220 por 22 arma masacre al asignar
    # unidades inexistentes a 15 clientes). Precedente H3 security audit.
    force = (os.environ.get('FORCE', 'false').lower() == 'true')
    try:
        snap_stock = db.collection('app_config').document('stock_snapshot').get()
        stock_data = snap_stock.to_dict() or {}
        whb_raw = stock_data.get('warehouseBreakdown')
        if isinstance(whb_raw, str):
            import json as _json
            try:
                whb = _json.loads(whb_raw)
            except Exception:
                whb = {}
        else:
            whb = whb_raw or {}
        stock_dep11 = int(((whb.get(SKU) or {}).get('11')) or 0)
    except Exception as e:
        log(f'  [WARN] no se pudo leer stock_snapshot: {e}')
        stock_dep11 = None
    if stock_dep11 is not None:
        log(f'  stock dep11 real del SKU: {stock_dep11}')
        if NEW_QTY > stock_dep11 and not force:
            raise SystemExit(
                f'[ERROR] NEW_QTY={NEW_QTY} > stock dep11 real ({stock_dep11}). '
                f'Posible typo. Si es intencional, correr con FORCE=true.'
            )

    snap = (
        db.collection('ingresos_reparto')
        .where('sku', '==', SKU)
        .where('status', '==', 'pending')
        .get()
    )
    docs = list(snap)
    log(f'  encontrados {len(docs)} ingresos pending con SKU={SKU}')
    if not docs:
        log('  (nada que actualizar)')
        return
    # v1292 consolidate: si hay > 1 pending, dejamos el PRIMERO (ordenado por
    # detectedAt desc) con NEW_QTY y cancelamos los demas.
    docs_sorted = sorted(
        docs,
        key=lambda d: (d.to_dict() or {}).get('detectedAt') or '',
        reverse=True,
    )
    keeper = docs_sorted[0]
    cancels = docs_sorted[1:]
    keeper_data = keeper.to_dict() or {}
    keeper_old = int(keeper_data.get('qtyIngresada', 0))
    log(f'  KEEP doc {keeper.id} (detectedAt={keeper_data.get("detectedAt")}): qtyIngresada {keeper_old} -> {NEW_QTY}')
    for c in cancels:
        cd = c.to_dict() or {}
        log(f'  CANCEL doc {c.id} (detectedAt={cd.get("detectedAt")}, qtyIng={cd.get("qtyIngresada")})')
    if DRY_RUN:
        log('=== DONE (DRY_RUN) ===')
        return
    keeper.reference.update({
        'qtyIngresada': NEW_QTY,
        'qtyIngresadaOverriddenAt': datetime.utcnow().isoformat() + 'Z',
        'qtyIngresadaOverriddenFrom': keeper_old,
        'qtyIngresadaOverriddenNote': 'one-shot bump --- stock dep11 real > delta detectado',
    })
    for c in cancels:
        c.reference.update({
            'status': 'cancelled',
            'cancelledAt': datetime.utcnow().isoformat() + 'Z',
            'cancelledReason': 'consolidado en ' + keeper.id + ' por bump qtyIngresada',
            'cancelledBy': 'bump_ingreso_qty_adc.py',
        })
    log('=== DONE (APPLIED) ===')


if __name__ == '__main__':
    main()
