"""
E4B piloto seed: crea o encuentra un pedido con una linea ASIG artificial
para poder probar los botones Aceptar/Rechazar sin esperar a que E4.5 haga
la promocion FIFO organica.

Modos:
  --list                    Lista pedidos abiertos con lineas BO/ASIG (para elegir)
  --promote <pedidoId>      Muta la primera linea state='BO' del pedido a 'ASIG'
                            (simula lo que haria E4.5). Dispara E3 -> popula
                            stock_snapshot.asigByClientSkuApp automatico.
  --revert <pedidoId>       Revierte una promocion previa (state='ASIG' -> 'BO')

DRY-RUN default. --apply para persistir.

Uso tipico:
  python scripts/e4b_seed_asig.py --list
  python scripts/e4b_seed_asig.py --promote ABC123XYZ --apply
  # luego abrir modal cliente en el browser y probar botones
  python scripts/e4b_seed_asig.py --revert ABC123XYZ --apply
"""
from __future__ import annotations

import argparse
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)


def _init_db():
    if not os.path.exists(SA_PATH):
        print(f"ERROR SA no encontrado: {SA_PATH}", file=sys.stderr)
        sys.exit(1)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(SA_PATH))
    return firestore.client()


def cmd_list(db):
    docs = list(db.collection("pedidos").stream())
    print(f"Total pedidos: {len(docs)}\n")
    candidates_bo = []
    candidates_asig = []
    for doc in docs:
        d = doc.to_dict() or {}
        if d.get("closedAt"):
            continue
        lines = d.get("lines") or []
        for i, l in enumerate(lines):
            if not l or not l.get("code"):
                continue
            state = l.get("state")
            qty_open = float(l.get("qtyOpen") or 0)
            if qty_open <= 0:
                continue
            if state == "BO":
                candidates_bo.append((doc.id, i, l.get("code"), qty_open, d.get("clientName", "?"), d.get("clientCardCode", "?")))
            elif state == "ASIG":
                candidates_asig.append((doc.id, i, l.get("code"), qty_open, d.get("clientName", "?"), d.get("clientCardCode", "?")))

    print(f"=== {len(candidates_bo)} lineas state='BO' abiertas (candidatas a promover) ===")
    for pid, idx, code, qty, name, cc in candidates_bo[:20]:
        print(f"  {pid} [line{idx}] {code} qty={qty} cliente='{name}' cardCode={cc}")
    if len(candidates_bo) > 20:
        print(f"  ...(+{len(candidates_bo) - 20} mas)")

    print(f"\n=== {len(candidates_asig)} lineas state='ASIG' abiertas (listas para probar piloto) ===")
    for pid, idx, code, qty, name, cc in candidates_asig[:20]:
        print(f"  {pid} [line{idx}] {code} qty={qty} cliente='{name}' cardCode={cc}")
    if len(candidates_asig) > 20:
        print(f"  ...(+{len(candidates_asig) - 20} mas)")


def cmd_promote(db, pedido_id, apply_):
    ref = db.collection("pedidos").document(pedido_id)
    snap = ref.get()
    if not snap.exists:
        print(f"ERROR pedido {pedido_id} no existe", file=sys.stderr)
        sys.exit(1)
    d = snap.to_dict() or {}
    if d.get("closedAt"):
        print(f"ERROR pedido cerrado (closedAt={d.get('closedAt')})", file=sys.stderr)
        sys.exit(1)
    lines = d.get("lines") or []
    target_idx = None
    for i, l in enumerate(lines):
        if l and l.get("state") == "BO" and float(l.get("qtyOpen") or 0) > 0:
            target_idx = i
            break
    if target_idx is None:
        print(f"ERROR pedido {pedido_id} sin lineas state='BO' con qtyOpen>0", file=sys.stderr)
        sys.exit(1)

    line = lines[target_idx]
    print(f"[{'APPLY' if apply_ else 'DRY-RUN'}] Promover pedido={pedido_id} line[{target_idx}]:")
    print(f"  SKU: {line.get('code')}")
    print(f"  qtyOpen actual: {line.get('qtyOpen')}")
    print(f"  state actual: {line.get('state')} -> ASIG")
    print(f"  cliente: {d.get('clientName')} ({d.get('clientCardCode')})")

    if not apply_:
        print("\n(dry-run — correr con --apply para persistir)")
        return

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    new_lines = list(lines)
    new_lines[target_idx] = {**line, "state": "ASIG", "asigAt": now_iso}
    ref.update({"lines": new_lines, "updatedAt": now_iso})
    print(f"\n[APPLY] Linea promovida OK. E3 va a disparar en <1s y popular stock_snapshot.")
    print(f"[APPLY] Abrir modal cliente '{d.get('clientName')}' en el browser para probar piloto.")


def cmd_revert(db, pedido_id, apply_):
    ref = db.collection("pedidos").document(pedido_id)
    snap = ref.get()
    if not snap.exists:
        print(f"ERROR pedido {pedido_id} no existe", file=sys.stderr)
        sys.exit(1)
    d = snap.to_dict() or {}
    lines = d.get("lines") or []
    target_idx = None
    for i, l in enumerate(lines):
        if l and l.get("state") == "ASIG" and float(l.get("qtyOpen") or 0) > 0:
            target_idx = i
            break
    if target_idx is None:
        print(f"ERROR pedido sin lineas state='ASIG' con qtyOpen>0", file=sys.stderr)
        sys.exit(1)

    line = lines[target_idx]
    print(f"[{'APPLY' if apply_ else 'DRY-RUN'}] Revertir pedido={pedido_id} line[{target_idx}]:")
    print(f"  SKU: {line.get('code')} state ASIG -> BO")

    if not apply_:
        print("\n(dry-run)")
        return

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    new_lines = list(lines)
    new_lines[target_idx] = {**line, "state": "BO", "asigAt": None}
    ref.update({"lines": new_lines, "updatedAt": now_iso})
    print(f"\n[APPLY] Revert OK.")


def cmd_list_waitlist_with_cc(db):
    """Lista revision_waitlist items con clientCardCode no-vacio (candidatos
    a probar el piloto E4B). El modal se abre sobre estos."""
    docs = list(db.collection("revision_waitlist").stream())
    with_cc = []
    for doc in docs:
        d = doc.to_dict() or {}
        cc = str(d.get("clientCardCode") or "").strip()
        if cc:
            with_cc.append((doc.id, cc, d.get("clientName", "?"), d.get("clientLocality", "?"), d.get("ownerEmail", "?")))
    print(f"revision_waitlist items con clientCardCode: {len(with_cc)}\n")
    for wid, cc, name, loc, owner in with_cc[:15]:
        print(f"  waitlist={wid}  cc={cc}  {name} ({loc})  owner={owner}")


def cmd_create_test_pedido(db, waitlist_id, sku, qty, apply_):
    """Crea un pedido de test con clientCardCode tomado del waitlist_id +
    una linea state='ASIG'. Post-crear: E3 dispara y popula
    stock_snapshot.asigByClientSkuApp[cc::sku] = qty.
    Luego el modal del waitlist_id muestra la seccion piloto con esa linea."""
    from datetime import datetime, timezone
    wref = db.collection("revision_waitlist").document(waitlist_id)
    wsnap = wref.get()
    if not wsnap.exists:
        print(f"ERROR waitlist {waitlist_id} no existe", file=sys.stderr); sys.exit(1)
    wd = wsnap.to_dict() or {}
    cc = str(wd.get("clientCardCode") or "").strip()
    if not cc:
        print(f"ERROR waitlist {waitlist_id} no tiene clientCardCode", file=sys.stderr); sys.exit(1)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    test_pedido = {
        "_e4b_test_marker": "delete_after_test",
        "clientCardCode": cc,
        "clientName": wd.get("clientName", "TEST"),
        "clientLocality": wd.get("clientLocality", ""),
        "clientProvince": wd.get("clientProvince", ""),
        "ownerEmail": wd.get("ownerEmail", "test@shimano.com.ar"),
        "ownerVendor": wd.get("ownerVendor", "TEST"),
        "vendorAssigned": wd.get("vendorAssigned", "TEST"),
        "province": wd.get("clientProvince", ""),
        "schemaVersion": 2,
        "sapLinkage": {"soDocEntry": None, "lastInvoiceDocEntry": None, "lastSyncAt": None},
        "closedAt": None,
        "closedReason": None,
        "stage": "confirmed",
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
        "lines": [{
            "code": sku,
            "desc": f"TEST E4B piloto {sku}",
            "cat": "", "fam": "", "sub": "",
            "qty": qty,
            "precio": 1000,
            "priceAtCreation": 1000,
            "needsReview": False,
            "state": "ASIG",
            "asigAt": now_iso,
            "qtyOpen": qty,
            "qtyInvoiced": 0,
            "qtyCancelled": 0,
            "qtyRecycled": 0,
            "recycledIntoPedidoId": None,
        }],
    }
    print(f"[{'APPLY' if apply_ else 'DRY-RUN'}] Crear pedido test:")
    print(f"  clientCardCode: {cc}")
    print(f"  clientName: {wd.get('clientName')}")
    print(f"  linea: {sku} qty={qty} state=ASIG")
    print(f"  marker: _e4b_test_marker='delete_after_test'")
    if not apply_:
        print("\n(dry-run — correr con --apply para crear)")
        return
    ref = db.collection("pedidos").document()
    ref.set(test_pedido)
    print(f"\n[APPLY] Pedido test creado con id={ref.id}")
    print(f"[APPLY] E3 va a disparar en <1s y popular stock_snapshot.asigByClientSkuApp['{cc}::{sku}'] = {qty}")
    print(f"[APPLY] Ahora abrir en browser: waitlist={waitlist_id}, ver seccion piloto")
    print(f"[APPLY] Para limpiar despues: python scripts/e4b_seed_asig.py --delete-test {ref.id} --apply")


def cmd_delete_test_pedido(db, pedido_id, apply_):
    ref = db.collection("pedidos").document(pedido_id)
    snap = ref.get()
    if not snap.exists:
        print(f"ERROR pedido {pedido_id} no existe", file=sys.stderr); sys.exit(1)
    d = snap.to_dict() or {}
    if d.get("_e4b_test_marker") != "delete_after_test":
        print(f"ERROR pedido {pedido_id} no tiene el marker de test — no borro por seguridad", file=sys.stderr); sys.exit(1)
    print(f"[{'APPLY' if apply_ else 'DRY-RUN'}] Borrar pedido test {pedido_id} (marker match OK)")
    if not apply_:
        print("(dry-run)")
        return
    ref.delete()
    print(f"[APPLY] Pedido test borrado. E3 disparo con delete, snapshot debe actualizarse.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true", help="Lista pedidos con lineas BO/ASIG")
    parser.add_argument("--list-waitlist-cc", action="store_true", help="Lista waitlist items con clientCardCode (candidatos para test)")
    parser.add_argument("--promote", type=str, help="Pedido ID a promover (primera BO -> ASIG)")
    parser.add_argument("--revert", type=str, help="Pedido ID a revertir (primera ASIG -> BO)")
    parser.add_argument("--create-test", nargs=3, metavar=("WAITLIST_ID", "SKU", "QTY"),
                        help="Crea pedido test con clientCardCode del waitlist + linea ASIG. Ej: --create-test wid TECHNIUM 2")
    parser.add_argument("--delete-test", type=str, help="Borra pedido test (requiere marker _e4b_test_marker)")
    parser.add_argument("--apply", action="store_true", help="Persiste cambios (sin esto = dry-run)")
    args = parser.parse_args()

    db = _init_db()
    if args.list:
        cmd_list(db)
    elif args.list_waitlist_cc:
        cmd_list_waitlist_with_cc(db)
    elif args.promote:
        cmd_promote(db, args.promote, args.apply)
    elif args.revert:
        cmd_revert(db, args.revert, args.apply)
    elif args.create_test:
        wid, sku, qty = args.create_test
        cmd_create_test_pedido(db, wid, sku, int(qty), args.apply)
    elif args.delete_test:
        cmd_delete_test_pedido(db, args.delete_test, args.apply)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
