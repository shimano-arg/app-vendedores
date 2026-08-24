"""Auditoria de overlap SAP-source vs APP-source en backorder.

v600 E1/E2/E3 (2026-08-24): con el flag `split_enabled` ON, un pedido con
qty>disp al confirmar genera 2 lineas:
  - {qty:disp, state:'confirmed'} → SQ SAP → cuenta en backorderBySku (SAP-source)
    como stock asignado (si hay stock disponible fisico) o backorder puro (si no).
  - {qty:qty-disp, state:'BO'} → cuenta en backorderBySkuApp (APP-source).

El invariante disenado es: las 2 lineas son disjuntas por construccion (E4C
filtra state='confirmed' antes de mandar a SAP). Pero se puede violar si:
  1. Alguien crea manualmente una segunda SQ en SAP por los 10u faltantes
     del mismo cliente/SKU → SAP-source contaria 40 (SQ original + SQ manual),
     APP-source contaria 10 (linea BO), UI mostraria 50 (duplicado real).
  2. Bug en la CF app-source cuenta lineas confirmed que ya viajaron a SAP.
  3. Bug en sync_sap_to_firestore.py incluye SQs canceladas.

Este script lee Firestore prod y reporta:
  - SKUs presentes en AMBOS mapas simultaneamente (posible duplicacion).
  - Para cada overlap, lista pedidos-app contribuyentes (con clientCardCode,
    docEntry SQ, qty BO) para investigacion manual.
  - Exit code 1 si hay overlaps, 0 si no. Uso en cron/monitoring.

Uso:
    python scripts/audit_backorder_overlap.py           # solo reporte
    python scripts/audit_backorder_overlap.py --json    # salida JSON
    python scripts/audit_backorder_overlap.py --min-qty 5  # solo overlaps >=5u
"""
import argparse
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
if SA_KEY_PATH.exists():
    os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY_PATH.read_text()

from sync_sap_to_bigquery import init_firestore, parse_sa_json  # noqa: E402


def load_sap_backorder(db) -> dict:
    """Lee stock_snapshot.backorderBySku (SAP-source, escrito por sync_sap_to_firestore.py).

    El campo es JSON-string en el doc (segun sync_sap_to_firestore.py:678). Puede
    ser dict directo si fue escrito por otra ruta.
    """
    snap = db.collection('app_config').document('stock_snapshot').get()
    if not snap.exists:
        return {}
    data = snap.to_dict() or {}
    raw = data.get('backorderBySku')
    if not raw:
        return {}
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    if isinstance(raw, dict):
        return raw
    return {}


def load_app_backorder(db) -> tuple[dict, dict]:
    """Lee stock_snapshot_app: backorderBySkuApp + backorderByClientSkuApp.

    backorderByClientSkuApp tiene claves como 'C30718510291::FX4000FCC' → qty.
    """
    snap = db.collection('app_config').document('stock_snapshot_app').get()
    if not snap.exists:
        return {}, {}
    data = snap.to_dict() or {}
    by_sku = data.get('backorderBySkuApp') or {}
    by_client_sku = data.get('backorderByClientSkuApp') or {}
    return by_sku, by_client_sku


def load_pedidos_contributing_to_bo(db, sku_up: str) -> list:
    """Lista pedidos-app con lineas state='BO' del SKU dado que estan populando
    backorderBySkuApp. Es un scan (56 pedidos hoy, tolerable)."""
    out = []
    query = db.collection('pedidos').where('closedAt', '==', None)
    for doc in query.stream():
        data = doc.to_dict() or {}
        if not data.get('transferidoSAP'):
            continue  # v578: solo pedidos con transferidoSAP cuentan
        lines = data.get('lines') or []
        for i, l in enumerate(lines):
            if not l or not l.get('code'):
                continue
            if str(l['code']).upper() != sku_up:
                continue
            state = l.get('state')
            if state not in ('BO', 'ASIG'):
                continue
            qty_open = float(l.get('qtyOpen') or 0)
            if qty_open <= 0:
                continue
            out.append({
                'pedidoId': doc.id,
                'clientCardCode': data.get('clientCardCode') or '',
                'clientName': data.get('clientName') or '',
                'lineIndex': i,
                'qtyOpen': qty_open,
                'state': state,
                'sqDocEntry': (data.get('transferidoSAP') or {}).get('docEntry'),
                'via': (data.get('transferidoSAP') or {}).get('via'),
            })
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true', help='Salida JSON en vez de tabla legible.')
    parser.add_argument('--min-qty', type=float, default=0.0,
                        help='Reportar solo overlaps donde SAP o APP >= min-qty.')
    parser.add_argument('--include-pedidos', action='store_true', default=True,
                        help='Incluir lista de pedidos-app contribuyentes por SKU (default true).')
    args = parser.parse_args()

    sa_data = parse_sa_json()
    db = init_firestore(sa_data)

    sap_bo = load_sap_backorder(db)
    app_bo, app_bo_by_client = load_app_backorder(db)

    # Normalizar keys a upper-case (SAP-source ya vienen upper; APP puede variar).
    sap_bo_up = {str(k).upper(): float(v or 0) for k, v in sap_bo.items() if float(v or 0) > 0}
    app_bo_up = {str(k).upper(): float(v or 0) for k, v in app_bo.items() if float(v or 0) > 0}

    overlap_skus = sorted(set(sap_bo_up.keys()) & set(app_bo_up.keys()))

    report = {
        'timestamp': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'sap_source_skus_count': len(sap_bo_up),
        'sap_source_qty_total': sum(sap_bo_up.values()),
        'app_source_skus_count': len(app_bo_up),
        'app_source_qty_total': sum(app_bo_up.values()),
        'overlap_skus_count': len(overlap_skus),
        'overlaps': [],
    }

    for sku in overlap_skus:
        sap_qty = sap_bo_up[sku]
        app_qty = app_bo_up[sku]
        if sap_qty < args.min_qty and app_qty < args.min_qty:
            continue
        entry = {
            'sku': sku,
            'sap_qty': sap_qty,
            'app_qty': app_qty,
            'combined_naive_sum': sap_qty + app_qty,
        }
        if args.include_pedidos:
            entry['app_contributors'] = load_pedidos_contributing_to_bo(db, sku)
        report['overlaps'].append(entry)

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print(f"\n=== AUDIT BACKORDER OVERLAP — {report['timestamp']} ===\n")
        print(f"SAP-source: {report['sap_source_skus_count']} SKUs, "
              f"{report['sap_source_qty_total']:.0f}u total")
        print(f"APP-source: {report['app_source_skus_count']} SKUs, "
              f"{report['app_source_qty_total']:.0f}u total")
        print(f"OVERLAP: {report['overlap_skus_count']} SKUs presentes en ambas fuentes\n")
        if not report['overlaps']:
            print("OK: cero overlap detectado. El invariante disjunto se cumple.")
        else:
            print(f"{'SKU':<20} {'SAP':>8} {'APP':>8} {'SUMA':>8}  Pedidos APP contribuyentes")
            print('-' * 100)
            for e in report['overlaps']:
                base = f"{e['sku']:<20} {e['sap_qty']:>8.0f} {e['app_qty']:>8.0f} {e['combined_naive_sum']:>8.0f}"
                contribs = e.get('app_contributors', [])
                if contribs:
                    first = contribs[0]
                    print(f"{base}  {first['clientCardCode']} SQ={first['sqDocEntry']} "
                          f"line={first['lineIndex']} qty={first['qtyOpen']:.0f} {first['state']}")
                    for c in contribs[1:]:
                        print(f"{' ':<45}  {c['clientCardCode']} SQ={c['sqDocEntry']} "
                              f"line={c['lineIndex']} qty={c['qtyOpen']:.0f} {c['state']}")
                else:
                    print(base)
            print(f"\nWARN: {len(report['overlaps'])} SKU(s) con posible duplicacion. Investigar.")
            print("Nota: overlap no siempre es duplicacion. Ver PLAN_BACKORDER_SPLIT.md.")

    sys.exit(1 if report['overlaps'] else 0)


if __name__ == '__main__':
    main()
