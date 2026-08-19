"""
E5 cutover toggle helper.

Cambia `app_config/sap_sync_state.mode` entre 'shadow' <-> 'active'. Al pasar
a 'active':
  - syncSapInvoicesToApp (E2) empieza a aplicar qtyInvoiced += qty a pedidos
    matcheados, cerrando el pedido cuando todas las lineas quedan invoiced.
  - onPedidoWriteRecalcSnapshot (E3) escribe backorderBySkuApp/asigBySkuApp/
    asigByClientSkuApp en `app_config/stock_snapshot` (prod) en vez de
    `stock_snapshot_shadow_v3`.
  - onStockChangeFIFOAssign (E4.5) muta pedidos.lines[i].state='ASIG' cuando
    entra stock y hay BO candidates FIFO.

Reversible: `rollback` vuelve a 'shadow'. Pedidos ya modificados en active
NO se revierten — el rollback solo detiene futuros writes activos.

Uso:
  python scripts/e5_toggle.py status          # muestra modo actual + timestamps
  python scripts/e5_toggle.py preflight       # PASS/FAIL checks
  python scripts/e5_toggle.py activate        # requiere typing "CUTOVER"
  python scripts/e5_toggle.py rollback        # requiere typing "ROLLBACK"
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)
STATE_DOC = "app_config/sap_sync_state"


def _init_db():
    if not os.path.exists(SA_PATH):
        print(f"ERROR SA no encontrado: {SA_PATH}", file=sys.stderr)
        sys.exit(1)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(SA_PATH))
    return firestore.client()


def cmd_status(db):
    snap = db.collection("app_config").document("sap_sync_state").get()
    if not snap.exists:
        print("Doc no existe -> modo default 'shadow'")
        return
    d = snap.to_dict() or {}
    print(f"  mode: {d.get('mode', '(unset, default shadow)')}")
    print(f"  lastInvoiceDocEntry: {d.get('lastInvoiceDocEntry', '-')}")
    print(f"  lastRunAt: {d.get('lastRunAt', '-')}")
    print(f"  cutoverAt: {d.get('cutoverAt', '-')}")
    print(f"  cutoverBy: {d.get('cutoverBy', '-')}")
    print(f"  rollbackAt: {d.get('rollbackAt', '-')}")


def cmd_preflight(db):
    """Chequea invariantes antes del cutover. Print PASS/FAIL por check."""
    checks = []

    # 1. E2 corrio en los ultimos 30 min
    state = db.collection("app_config").document("sap_sync_state").get()
    if not state.exists:
        checks.append(("E2 nunca corrio", False, "sap_sync_state doc missing"))
    else:
        d = state.to_dict() or {}
        last_run = d.get("lastRunAt")
        if not last_run:
            checks.append(("E2 lastRunAt", False, "sin lastRunAt en state"))
        else:
            try:
                # lastRunAt puede ser Timestamp o ISO string
                if hasattr(last_run, "timestamp"):
                    dt = last_run
                else:
                    dt = datetime.fromisoformat(str(last_run).replace("Z", "+00:00"))
                age_min = (datetime.now(timezone.utc) - dt).total_seconds() / 60
                ok = age_min < 30
                checks.append((f"E2 corrio hace {age_min:.1f} min", ok, "<30 min esperado" if ok else "STALE"))
            except Exception as e:
                checks.append(("E2 lastRunAt parseable", False, str(e)))

    # 2. Ultimos 5 sap_sync_log sin errores persistentes
    logs = sorted(db.collection("sap_sync_log").stream(), key=lambda x: x.id, reverse=True)[:5]
    if not logs:
        checks.append(("sap_sync_log", False, "sin corridas registradas"))
    else:
        total_errors = sum(len((l.to_dict() or {}).get("errors") or []) for l in logs)
        ok = total_errors == 0
        checks.append((f"sap_sync_log errores ultimos 5", ok, f"total={total_errors}"))

    # 3. stock_snapshot_shadow_v3 con updatedAtApp reciente
    ss = db.collection("app_config").document("stock_snapshot_shadow_v3").get()
    if not ss.exists:
        checks.append(("stock_snapshot_shadow_v3", False, "doc no existe"))
    else:
        d = ss.to_dict() or {}
        upd = d.get("updatedAtApp")
        if not upd:
            checks.append(("shadow snapshot updatedAtApp", False, "sin updatedAtApp"))
        else:
            try:
                dt = datetime.fromisoformat(str(upd).replace("Z", "+00:00"))
                age_hr = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
                ok = age_hr < 24
                checks.append((f"shadow snapshot updatedAtApp hace {age_hr:.1f}h", ok, "<24h esperado" if ok else "STALE"))
            except Exception as e:
                checks.append(("shadow snapshot updatedAtApp parseable", False, str(e)))

    # 4. No hay claves flat orfanas (residuos del bug pre-fix)
    if ss.exists:
        d = ss.to_dict() or {}
        orphans = [k for k in d.keys() if "." in k and k.startswith(("backorderBySkuApp.", "asigBySkuApp.", "asigByClientSkuApp."))]
        ok = len(orphans) == 0
        checks.append((f"orphan flat keys en shadow", ok, f"encontradas {len(orphans)}" if not ok else "clean"))

    # 5. Regla firestore permite escrituras de la CF (implicit — Admin SDK bypass)
    # No checkeamos aca.

    print("\nPREFLIGHT E5 CUTOVER:")
    print("-" * 60)
    all_pass = True
    for label, ok, detail in checks:
        mark = "[PASS]" if ok else "[FAIL]"
        print(f"  {mark} {label}: {detail}")
        if not ok:
            all_pass = False
    print("-" * 60)
    if all_pass:
        print("\n[OK] Todos los checks pasaron. Puedes correr `activate`.")
    else:
        print("\n[WARN] Algun check fallo. Revisar antes de cutover.")
        sys.exit(2)


def _flip_mode(db, new_mode, expected_confirm, action_label):
    print(f"\n[!] Cambio de modo: -> '{new_mode}'")
    print(f"    Impacta: E2/E3/E4.5 empiezan a mutar pedidos y stock_snapshot prod.")
    print(f"    Reversible via rollback pero pedidos ya modificados quedan asi.")
    typed = input(f"\n    Para confirmar, tipear literalmente '{expected_confirm}': ").strip()
    if typed != expected_confirm:
        print(f"    Cancelado (typed={typed!r}, expected={expected_confirm!r}).")
        return
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    field_ts = f"{action_label}At"
    field_by = f"{action_label}By"
    ref = db.collection("app_config").document("sap_sync_state")
    ref.set({
        "mode": new_mode,
        field_ts: now_iso,
        field_by: os.environ.get("USER") or os.environ.get("USERNAME") or "script",
    }, merge=True)
    print(f"\n[OK] mode -> '{new_mode}' at {now_iso}")
    print(f"      Watch Cloud Logs: `firebase functions:log --only syncSapInvoicesToApp,onPedidoWriteRecalcSnapshot,onStockChangeFIFOAssign -n 50`")


def cmd_activate(db):
    _flip_mode(db, "active", "CUTOVER", "cutover")


def cmd_rollback(db):
    _flip_mode(db, "shadow", "ROLLBACK", "rollback")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    for c in ("status", "preflight", "activate", "rollback"):
        sub.add_parser(c)
    args = parser.parse_args()
    db = _init_db()
    print(f"Cmd: {args.cmd}")
    if args.cmd == "status":
        cmd_status(db)
    elif args.cmd == "preflight":
        cmd_preflight(db)
    elif args.cmd == "activate":
        cmd_activate(db)
    elif args.cmd == "rollback":
        cmd_rollback(db)


if __name__ == "__main__":
    main()
