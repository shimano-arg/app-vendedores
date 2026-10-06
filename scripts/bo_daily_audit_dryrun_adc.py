"""Smoke de bo_daily_audit.py usando ADC (sin enviar email).

Imprime el subject + primeras 50 líneas del HTML + los diff vs ayer.
Usa gcloud ADC en vez de SA key.
"""

import sys
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
from bo_daily_audit import (  # noqa: E402
    SNAPSHOT_COLLECTION,
    _build_summary,
    _diff_vs_previous,
    _render_html,
    _severity_icon,
    _today_key,
    _yesterday_key,
)

PROJECT = "app-vendedores-shimano"


def main() -> int:
    db = firestore.Client(project=PROJECT)

    sap_bo_sku = load_sap_backorder(db)
    app_bo_sku, app_bo_by_client = load_app_backorder(db)
    sap_by_client_sku = load_sap_by_client_sku(db)
    pedidos = load_all_open_pedidos(db)

    strict = find_strict_duplicates(pedidos, min_qty=0.0)
    loose = find_loose_overlaps(sap_by_client_sku, app_bo_by_client, min_qty=0.0)
    today_summary = _build_summary(strict, loose)

    totals = {
        "sap_source_skus": sum(1 for v in sap_bo_sku.values() if float(v or 0) > 0),
        "sap_source_qty": sum(float(v or 0) for v in sap_bo_sku.values() if float(v or 0) > 0),
        "app_source_skus": sum(1 for v in app_bo_sku.values() if float(v or 0) > 0),
        "app_source_qty": sum(float(v or 0) for v in app_bo_sku.values() if float(v or 0) > 0),
        "pedidos_open": len(pedidos),
    }

    prev_doc = db.collection(SNAPSHOT_COLLECTION).document(_yesterday_key()).get()
    previous = prev_doc.to_dict() if prev_doc.exists else None
    diff = _diff_vs_previous(today_summary, previous)

    icon = _severity_icon(today_summary, diff)
    subject = (
        f"{icon} BO Audit {_today_key()}: "
        f"{today_summary['strict_unexpected_count']} STRICT unexp, "
        f"{today_summary['loose_count']} LOOSE"
    )
    if diff["has_previous"] and diff["new_strict_unexpected"]:
        subject += f" (+{len(diff['new_strict_unexpected'])} nuevos)"

    print("=" * 80)
    print(f"SUBJECT: {subject}")
    print("=" * 80)
    print(f"Totales: {totals}")
    print(f"Today summary: strict_unexp={today_summary['strict_unexpected_count']}  "
          f"strict_exp={today_summary['strict_expected_count']}  loose={today_summary['loose_count']}")
    print(f"Previous snapshot exists: {diff['has_previous']}")
    print(f"Diff: new_strict_unexp={len(diff['new_strict_unexpected'])}  "
          f"new_loose={len(diff['new_loose_pairs'])}  "
          f"resolved_strict={len(diff['resolved_strict_unexpected'])}")
    print()
    print("HTML preview (first 1500 chars):")
    print("-" * 80)
    html = _render_html(today_summary, diff, strict, loose, totals)
    print(html[:1500])
    print("..." if len(html) > 1500 else "")
    print(f"\nTotal HTML length: {len(html)} chars")
    print("\nDRY-RUN: email NOT sent. Snapshot NOT saved.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
