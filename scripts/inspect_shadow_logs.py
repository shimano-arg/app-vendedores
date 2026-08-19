"""
Inspecciona el estado de las Cloud Functions en shadow mode (E2/E3/E4.5).

Lee y resume:
  1. app_config/sap_sync_state         -> modo actual + cursor
  2. sap_sync_log (E2)                 -> ultimas N ejecuciones + matches/orphans
  3. stock_snapshot_shadow_v3 (E3)     -> keys app-source poblados
  4. stock_assignment_log_shadow (E4.5) -> promociones FIFO en shadow

Uso:
  python scripts/inspect_shadow_logs.py         # ultimas 5 corridas
  python scripts/inspect_shadow_logs.py -n 20   # ultimas 20
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)


def _fmt_ts(v):
    if v is None:
        return "-"
    try:
        return v.isoformat() if hasattr(v, "isoformat") else str(v)
    except Exception:
        return str(v)


def _print_header(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def show_sync_state(db):
    _print_header("app_config/sap_sync_state (flag central shadow/active)")
    snap = db.collection("app_config").document("sap_sync_state").get()
    if not snap.exists:
        print("  (doc no existe -> modo default 'shadow')")
        return
    d = snap.to_dict() or {}
    print(f"  mode: {d.get('mode', '(unset, default shadow)')}")
    print(f"  lastInvoiceDocEntry: {d.get('lastInvoiceDocEntry', '-')}")
    print(f"  lastRunAt: {_fmt_ts(d.get('lastRunAt'))}")


def show_sap_sync_log(db, n):
    _print_header(f"sap_sync_log (E2 syncSapInvoicesToApp) — ultimas {n}")
    docs = sorted(db.collection("sap_sync_log").stream(),
                  key=lambda d: d.id, reverse=True)[:n]
    if not docs:
        print("  (sin logs — CF no corrio o sap_sync_log vacio)")
        return
    for doc in docs:
        d = doc.to_dict() or {}
        matches = d.get("matches") or []
        orphans = d.get("orphans") or []
        errors = d.get("errors") or []
        print(
            f"\n  [{doc.id}] mode={d.get('mode', '?')} "
            f"cursor {d.get('cursorBefore', '-')} -> {d.get('cursorAfter', '-')}"
        )
        print(
            f"    invoicesRead={d.get('invoicesRead', 0)} "
            f"matches={len(matches)} orphans={len(orphans)} errors={len(errors)}"
        )
        if matches:
            for m in matches[:3]:
                print(
                    f"      MATCH invoiceDocEntry={m.get('invoiceDocEntry')} "
                    f"sqDocEntry={m.get('sqDocEntry')} pedidoAppId={m.get('pedidoAppId')}"
                )
            if len(matches) > 3:
                print(f"      ...(+{len(matches) - 3} mas)")
        if orphans:
            reasons = {}
            for o in orphans:
                r = o.get("reason", "?")
                reasons[r] = reasons.get(r, 0) + 1
            print(f"      orphans by reason: {dict(reasons)}")
        if errors:
            for e in errors[:2]:
                print(f"      ERROR: {e}")


def show_stock_snapshot_shadow(db):
    _print_header("app_config/stock_snapshot_shadow_v3 (E3 onPedidoWriteRecalcSnapshot)")
    snap = db.collection("app_config").document("stock_snapshot_shadow_v3").get()
    if not snap.exists:
        print("  (doc no existe -> CF E3 nunca escribio)")
        return
    d = snap.to_dict() or {}
    bo = d.get("backorderBySkuApp") or {}
    asig = d.get("asigBySkuApp") or {}
    asig_cli = d.get("asigByClientSkuApp") or {}
    if isinstance(bo, str):
        try: bo = json.loads(bo)
        except Exception: bo = {}
    if isinstance(asig, str):
        try: asig = json.loads(asig)
        except Exception: asig = {}
    if isinstance(asig_cli, str):
        try: asig_cli = json.loads(asig_cli)
        except Exception: asig_cli = {}
    print(f"  updatedAtApp: {_fmt_ts(d.get('updatedAtApp'))}")
    print(f"  sourceApp: {d.get('sourceApp', '-')}")
    if d.get("backfilledAt"):
        print(f"  backfilledAt: {_fmt_ts(d.get('backfilledAt'))} by {d.get('backfilledBy', '?')}")
    print(f"  backorderBySkuApp: {len(bo)} SKUs, total qty={sum(int(v or 0) for v in bo.values())}")
    print(f"  asigBySkuApp:      {len(asig)} SKUs, total qty={sum(int(v or 0) for v in asig.values())}")
    print(f"  asigByClientSkuApp: {len(asig_cli)} claves cliente::sku, "
          f"total qty={sum(int(v or 0) for v in asig_cli.values())}")
    if bo:
        top = sorted(bo.items(), key=lambda kv: -int(kv[1] or 0))[:5]
        print("  TOP 5 backorder app-source:")
        for sku, q in top: print(f"    {sku}: {q}")
    if asig:
        top = sorted(asig.items(), key=lambda kv: -int(kv[1] or 0))[:5]
        print("  TOP 5 asignado app-source:")
        for sku, q in top: print(f"    {sku}: {q}")


def show_stock_snapshot_prod(db):
    _print_header("app_config/stock_snapshot (prod SAP-source — trigger para E4.5)")
    snap = db.collection("app_config").document("stock_snapshot").get()
    if not snap.exists:
        print("  (doc no existe — sync_sap_to_firestore.py nunca corrio)")
        return
    d = snap.to_dict() or {}
    print(f"  updatedAt: {_fmt_ts(d.get('updatedAt'))}")
    wb = d.get("warehouseBreakdown")
    if isinstance(wb, str):
        try: wb = json.loads(wb)
        except Exception: wb = {}
    if isinstance(wb, dict):
        # cuenta SKUs con dep 11 > 0
        with_disp = sum(1 for k, v in wb.items()
                        if isinstance(v, dict) and (v.get('11') or v.get(11) or 0) > 0)
        print(f"  warehouseBreakdown: {len(wb)} SKUs total, {with_disp} con dep 11 > 0")


def show_fifo_assignment_log(db, n):
    _print_header(f"stock_assignment_log_shadow (E4.5 onStockChangeFIFOAssign) — ultimas {n}")
    docs = sorted(db.collection("stock_assignment_log_shadow").stream(),
                  key=lambda d: d.id, reverse=True)[:n]
    if not docs:
        print("  (sin logs — CF E4.5 nunca disparo o sin deltas positivos)")
        return
    for doc in docs:
        d = doc.to_dict() or {}
        promotions = d.get("promotions") or []
        errors = d.get("errors") or []
        print(
            f"\n  [{doc.id}] mode={d.get('mode', '?')} "
            f"skusChecked={d.get('skusChecked', 0)} "
            f"promotions={len(promotions)} errors={len(errors)}"
        )
        for p in promotions[:5]:
            asigs = p.get("assignments") or []
            print(
                f"    SKU={p.get('sku')} delta={p.get('delta')} "
                f"availableAfter={p.get('availableAfter')} "
                f"assignments={len(asigs)}"
            )
            for a in asigs[:3]:
                print(
                    f"      -> pedido={a.get('pedidoId')} qty={a.get('qtyAssigned')} "
                    f"cliente={a.get('clientCardCode')}"
                )
        if len(promotions) > 5:
            print(f"    ...(+{len(promotions) - 5} promociones mas)")
        for e in errors[:2]:
            print(f"    ERROR: {e}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-n", "--limit", type=int, default=5,
                        help="Cantidad de logs por coleccion (default 5)")
    args = parser.parse_args()

    if not os.path.exists(SA_PATH):
        print(f"ERROR No encuentro service account en {SA_PATH}", file=sys.stderr)
        sys.exit(1)

    cred = credentials.Certificate(SA_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    show_sync_state(db)
    show_sap_sync_log(db, args.limit)
    show_stock_snapshot_shadow(db)
    show_stock_snapshot_prod(db)
    show_fifo_assignment_log(db, args.limit)
    print()


if __name__ == "__main__":
    main()
