"""Auditoria de duplicacion backorder SAP-source vs APP-source (v601+).

Contexto: SAP-source (`backorderBySku` en `stock_snapshot`) y APP-source
(`backorderBySkuApp` en `stock_snapshot_app`) reportan backorder por SKU pero
desde bases diferentes. El invariante disenado es que sean disjuntos por
construccion (E4C filtra state='confirmed' antes de mandar a SAP → lineas BO
nunca viajan a SAP).

**Version v0.2 (2026-08-24)**: la version original comparaba solo totales
SKU-agregados → 156 SKUs "en overlap", pero la mayoria eran FALSOS POSITIVOS
(mismo SKU pero clientes distintos = demandas separadas, no duplicacion).

Este script detecta 2 niveles:

**STRICT (definitivo)**: pedido-app con 2+ lineas MISMO SKU con estados mixtos
(al menos 1 en {'confirmed','invoiced'} + al menos 1 en {'BO','ASIG'}). Esto
solo puede pasar con flag v600 split ON. Es el escenario que E1 hace inocuo
(applyInvoiceMatch skipea BO/ASIG) pero que la UI del sumario (index.html:18159
`boTotal = backorder + backorderApp`) duplica al mostrar.

**LOOSE (posible)**: mismo `(cardCode, sku)` presente en ambas fuentes con
qty > 0 pero en pedidos distintos. Puede ser demanda legitima duplicada (mismo
cliente pide varias veces el mismo SKU) o duplicacion real (SQ SAP manual
complementaria al split app). Requiere investigacion.

Uso:
    python scripts/audit_backorder_overlap.py           # tabla legible (strict + loose)
    python scripts/audit_backorder_overlap.py --json    # salida JSON
    python scripts/audit_backorder_overlap.py --strict-only  # solo casos definitivos
    python scripts/audit_backorder_overlap.py --min-qty 5    # solo qtys >=5u
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


def load_all_open_pedidos(db) -> list:
    """Trae todos los pedidos-app abiertos con transferidoSAP != null (v578)."""
    out = []
    query = db.collection('pedidos').where('closedAt', '==', None)
    for doc in query.stream():
        data = doc.to_dict() or {}
        if not data.get('transferidoSAP'):
            continue
        data['_id'] = doc.id
        out.append(data)
    return out


EXPECTED_SPLIT_VIAS = frozenset({
    'service_layer_auto',      # auto-send client-side (admin con app abierta)
    'cf_auto',                 # auto-send CF trigger
    'cf_auto_partial_stock',   # auto-send CF con recheck live stock dep11
})
"""Vias que generan split line intencional (v600+). Un pedido via una de estas
puede tener legitimamente 2+ lineas mismo SKU con estados mixtos: SAP recibio
la parte con stock, APP guarda la parte sin stock. NO es duplicacion."""


def find_strict_duplicates(pedidos: list, min_qty: float = 0.0) -> list:
    """STRICT: pedidos con 2+ lineas mismo SKU + estados mixtos.

    v1130 (2026-10-05): distingue splits ESPERADOS (via en EXPECTED_SPLIT_VIAS)
    de UNEXPECTED (via desconocido o manual). Solo los unexpected se consideran
    duplicacion real. Los esperados se reportan como `expected_split_count` para
    tracking de volumen del flag v600 split.
    """
    SAP_STATES = {'confirmed', 'invoiced'}
    APP_STATES = {'BO', 'ASIG'}
    out = []
    for p in pedidos:
        via = (p.get('transferidoSAP') or {}).get('via') or ''
        is_expected_split = via in EXPECTED_SPLIT_VIAS
        lines = p.get('lines') or []
        by_sku = {}
        for i, l in enumerate(lines):
            if not l or not l.get('code'):
                continue
            sku_up = str(l['code']).upper()
            qty_open = float(l.get('qtyOpen') or 0)
            if qty_open <= 0:
                continue
            by_sku.setdefault(sku_up, []).append({
                'lineIndex': i,
                'state': l.get('state'),
                'qty': float(l.get('qty') or 0),
                'qtyOpen': qty_open,
            })
        dup_skus = []
        for sku, group in by_sku.items():
            if len(group) < 2:
                continue
            has_sap = any(g['state'] in SAP_STATES for g in group)
            has_app = any(g['state'] in APP_STATES for g in group)
            if not (has_sap and has_app):
                continue
            sap_lines = [g for g in group if g['state'] in SAP_STATES]
            app_lines = [g for g in group if g['state'] in APP_STATES]
            sum_sap = sum(g['qtyOpen'] for g in sap_lines)
            sum_app = sum(g['qtyOpen'] for g in app_lines)
            if sum_sap < min_qty and sum_app < min_qty:
                continue
            dup_skus.append({
                'sku': sku,
                'sap_lines': sap_lines,
                'app_lines': app_lines,
                'sap_qty_open': sum_sap,
                'app_qty_open': sum_app,
            })
        if dup_skus:
            out.append({
                'pedidoId': p['_id'],
                'clientCardCode': p.get('clientCardCode') or '',
                'clientName': p.get('clientName') or '',
                'sqDocEntry': (p.get('transferidoSAP') or {}).get('docEntry'),
                'via': via,
                'is_expected_split': is_expected_split,
                'dup_skus': dup_skus,
            })
    return out


def load_sap_by_client_sku(db) -> dict:
    """Lee todos los backorder_snapshot/{vendor} y agrega por (cardCode, sku).

    Retorna: {"cardCode::SKU": qty_pendiente_total}
    """
    out = {}
    for doc in db.collection('backorder_snapshot').stream():
        data = doc.to_dict() or {}
        for line in (data.get('lines') or []):
            code = str(line.get('clienteCode') or '').strip()
            sku = str(line.get('sku') or '').upper().strip()
            if not code or not sku:
                continue
            q = float(line.get('pendiente') or 0)
            if q <= 0:
                continue
            key = f'{code}::{sku}'
            out[key] = out.get(key, 0.0) + q
    return out


def find_loose_overlaps(sap_by_client_sku: dict, app_by_client_sku: dict,
                        min_qty: float = 0.0) -> list:
    """LOOSE: pares (cardCode, sku) presentes en AMBAS fuentes con qty>0."""
    out = []
    for key in sorted(set(sap_by_client_sku.keys()) & set(app_by_client_sku.keys())):
        sap_q = float(sap_by_client_sku.get(key) or 0)
        app_q = float(app_by_client_sku.get(key) or 0)
        if sap_q <= 0 or app_q <= 0:
            continue
        if sap_q < min_qty and app_q < min_qty:
            continue
        code, sku = (key.split('::', 1) + [''])[:2]
        out.append({
            'clientCardCode': code,
            'sku': sku,
            'sap_qty': sap_q,
            'app_qty': app_q,
        })
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true', help='Salida JSON en vez de tabla legible.')
    parser.add_argument('--min-qty', type=float, default=0.0,
                        help='Reportar solo casos donde SAP o APP >= min-qty.')
    parser.add_argument('--strict-only', action='store_true',
                        help='Reportar solo casos STRICT (duplicacion definitiva).')
    args = parser.parse_args()

    sa_data = parse_sa_json()
    db = init_firestore(sa_data)

    # Carga fuentes.
    sap_bo_sku = load_sap_backorder(db)
    app_bo_sku, app_bo_by_client = load_app_backorder(db)
    sap_by_client_sku = load_sap_by_client_sku(db)
    pedidos = load_all_open_pedidos(db)

    # Analisis.
    strict = find_strict_duplicates(pedidos, args.min_qty)
    loose = [] if args.strict_only else find_loose_overlaps(sap_by_client_sku, app_bo_by_client, args.min_qty)

    strict_unexpected = [p for p in strict if not p.get('is_expected_split')]
    strict_expected = [p for p in strict if p.get('is_expected_split')]

    report = {
        'timestamp': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'sap_source_skus_count': len([k for k, v in sap_bo_sku.items() if float(v or 0) > 0]),
        'sap_source_qty_total': sum(float(v or 0) for v in sap_bo_sku.values() if float(v or 0) > 0),
        'app_source_skus_count': len([k for k, v in app_bo_sku.items() if float(v or 0) > 0]),
        'app_source_qty_total': sum(float(v or 0) for v in app_bo_sku.values() if float(v or 0) > 0),
        'pedidos_open_with_sap': len(pedidos),
        'strict_duplicates_count': len(strict),
        'strict_duplicated_qty': sum(sum(s['app_qty_open'] for s in p['dup_skus']) for p in strict),
        'strict_unexpected_count': len(strict_unexpected),
        'strict_expected_split_count': len(strict_expected),
        'strict': strict,
        'loose_overlaps_count': len(loose),
        'loose': loose,
    }

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print(f"\n=== AUDIT BACKORDER DUPLICACION — {report['timestamp']} ===\n")
        print(f"SAP-source: {report['sap_source_skus_count']} SKUs / {report['sap_source_qty_total']:.0f}u")
        print(f"APP-source: {report['app_source_skus_count']} SKUs / {report['app_source_qty_total']:.0f}u")
        print(f"Pedidos abiertos con transferidoSAP: {report['pedidos_open_with_sap']}\n")

        print("=" * 80)
        print("STRICT UNEXPECTED (DUPLICACION DEFINITIVA) - via inesperado o manual")
        print("=" * 80)
        if not strict_unexpected:
            print("OK: cero duplicaciones strict con via inesperado. El invariante se cumple.")
        else:
            print(f"WARN: {len(strict_unexpected)} pedido(s), via NO en EXPECTED_SPLIT_VIAS\n")
            for p in strict_unexpected:
                print(f"[{p['pedidoId']}] {p['clientCardCode']} {p['clientName']} "
                      f"SQ={p['sqDocEntry']} via={p['via']}")
                for s in p['dup_skus']:
                    print(f"  SKU {s['sku']}: SAP={s['sap_qty_open']:.0f}u APP={s['app_qty_open']:.0f}u")
                    for line in s['sap_lines']:
                        print(f"    [line {line['lineIndex']}] state={line['state']} qty={line['qty']:.0f} open={line['qtyOpen']:.0f}")
                    for line in s['app_lines']:
                        print(f"    [line {line['lineIndex']}] state={line['state']} qty={line['qty']:.0f} open={line['qtyOpen']:.0f}")
                print('')

        if strict_expected:
            print()
            print("=" * 80)
            print("STRICT EXPECTED SPLIT - via en EXPECTED_SPLIT_VIAS (informativo, no es bug)")
            print("=" * 80)
            print(f"INFO: {len(strict_expected)} pedido(s) con split line intencional del flag v600+.")
            print("Esto es comportamiento esperado: SAP recibe la parte con stock, APP guarda")
            print("la parte sin stock. Los lectores UI son disjuntos por state (verificado 2026-10-05).")
            print()
            for p in strict_expected[:5]:
                skus = ', '.join(s['sku'] for s in p['dup_skus'])
                print(f"[{p['pedidoId']}] {p['clientName'][:40]:<40} via={p['via']}  "
                      f"skus: {skus}")
            if len(strict_expected) > 5:
                print(f"... y {len(strict_expected) - 5} mas. Usa --json para completo.")

        if not args.strict_only:
            print("=" * 80)
            print("LOOSE (POSIBLE) — mismo (cardCode, sku) en ambas fuentes, pedidos distintos")
            print("=" * 80)
            if not loose:
                print("OK: cero overlaps loose. Fuentes disjuntas por cliente+SKU.")
            else:
                print(f"INFO: {len(loose)} pares (cliente, sku) presentes en ambas fuentes.\n")
                print(f"{'cardCode':<15} {'SKU':<20} {'SAP':>8} {'APP':>8}")
                print('-' * 55)
                for e in loose[:50]:
                    print(f"{e['clientCardCode']:<15} {e['sku']:<20} "
                          f"{e['sap_qty']:>8.0f} {e['app_qty']:>8.0f}")
                if len(loose) > 50:
                    print(f"... y {len(loose) - 50} mas. Usar --json para lista completa.")
                print("\nNota: LOOSE no siempre es duplicacion. Un cliente puede tener demanda")
                print("historica en SAP (SQ abierta) + una nueva BO en app (pedido posterior)")
                print("por el mismo SKU. Son demandas separadas del mismo cliente, no duplicadas.")

        print()

    # Exit code 1 solo para STRICT UNEXPECTED (duplicacion real no explicable
    # por el split line v600+). STRICT expected y LOOSE son informativos.
    sys.exit(1 if strict_unexpected else 0)


if __name__ == '__main__':
    main()
