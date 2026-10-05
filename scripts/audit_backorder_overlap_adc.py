"""Wrapper read-only de audit_backorder_overlap.py usando ADC (gcloud auth) en vez de SA key.

Reutiliza las mismas funciones puras de detección. Firestore client se instancia
con credentials por default (ADC) para no requerir sa-key.json en disco.

Uso:
    python scripts/audit_backorder_overlap_adc.py           # tabla legible (strict + loose)
    python scripts/audit_backorder_overlap_adc.py --json    # JSON
    python scripts/audit_backorder_overlap_adc.py --strict-only
    python scripts/audit_backorder_overlap_adc.py --min-qty 5
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from google.cloud import firestore  # noqa: E402

from audit_backorder_overlap import (  # noqa: E402
    find_loose_overlaps,
    find_strict_duplicates,
    load_all_open_pedidos,
    load_app_backorder,
    load_sap_backorder,
    load_sap_by_client_sku,
)

PROJECT = "app-vendedores-shimano"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--min-qty', type=float, default=0.0)
    parser.add_argument('--strict-only', action='store_true')
    args = parser.parse_args()

    db = firestore.Client(project=PROJECT)

    sap_bo_sku = load_sap_backorder(db)
    app_bo_sku, app_bo_by_client = load_app_backorder(db)
    sap_by_client_sku = load_sap_by_client_sku(db)
    pedidos = load_all_open_pedidos(db)

    strict = find_strict_duplicates(pedidos, args.min_qty)
    loose = [] if args.strict_only else find_loose_overlaps(
        sap_by_client_sku, app_bo_by_client, args.min_qty,
    )
    strict_unexpected = [p for p in strict if not p.get('is_expected_split')]
    strict_expected = [p for p in strict if p.get('is_expected_split')]

    report = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
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
        print("STRICT UNEXPECTED (DUPLICACION DEFINITIVA) - via NO en EXPECTED_SPLIT_VIAS")
        print("=" * 80)
        if not strict_unexpected:
            print("OK: cero duplicaciones strict unexpected. El invariante se cumple.")
        else:
            print(f"WARN: {len(strict_unexpected)} pedido(s) con via inesperado\n")
            for p in strict_unexpected:
                print(f"[{p['pedidoId']}] {p['clientCardCode']} {p['clientName']} "
                      f"SQ={p['sqDocEntry']} via={p['via']}")
                for s in p['dup_skus']:
                    print(f"  SKU {s['sku']}: SAP={s['sap_qty_open']:.0f}u APP={s['app_qty_open']:.0f}u")

        if strict_expected:
            print(f"\nINFO: {len(strict_expected)} pedido(s) con split line intencional "
                  "(via en EXPECTED_SPLIT_VIAS). Comportamiento esperado, no bug.")

        if not args.strict_only:
            print()
            print("=" * 80)
            print("LOOSE (POSIBLE) - mismo (cardCode, sku) en ambas fuentes, pedidos distintos")
            print("=" * 80)
            if not loose:
                print("OK: cero overlaps loose.")
            else:
                print(f"INFO: {len(loose)} pares (cliente, sku) en ambas fuentes.\n")
                print(f"{'cardCode':<15} {'SKU':<20} {'SAP':>8} {'APP':>8}")
                print('-' * 55)
                for e in loose[:50]:
                    print(f"{e['clientCardCode']:<15} {e['sku']:<20} "
                          f"{e['sap_qty']:>8.0f} {e['app_qty']:>8.0f}")
                if len(loose) > 50:
                    print(f"... y {len(loose) - 50} mas. Usa --json para completo.")

        print()

    return 1 if strict_unexpected else 0


if __name__ == '__main__':
    sys.exit(main())
