"""Aplica bucket B2: reduce al 50% el BO del pedido MAS NUEVO cuando hay
duplicado cliente+SKU en 2+ pedidos (ratio 0.5-2x, <=60d apart).

Regla Mariano: no estoy 100% seguro de que sea dup, entonces achico el
pedido mas nuevo a la mitad. Ejemplo: Orden A 30u + Orden B 16u -> Orden A
queda en 30u + Orden B queda en 8u (cancela 8u).

Floor para impares (15 -> 7 kept, 8 canceladas).

Uso:
    DRY_RUN=true  python scripts/audit_bo_apply_bucketB2.py
    DRY_RUN=false python scripts/audit_bo_apply_bucketB2.py
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

from google.cloud import firestore

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT = "app-vendedores-shimano"
DRY_RUN = (os.environ.get("DRY_RUN", "true").lower() != "false")


def _to_dt(v):
    if v is None:
        return None
    if hasattr(v, "timestamp"):
        try:
            return datetime.fromtimestamp(v.timestamp(), tz=timezone.utc)
        except Exception:
            return None
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def _iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    print(f"=== audit_bo_apply_bucketB2 (DRY_RUN={DRY_RUN}) ===")
    print(f"REGLA: reducir el BO del pedido mas NUEVO al 50% (floor).")
    db = firestore.Client(project=PROJECT)
    snap = db.collection("pedidos").where("closedAt", "==", None).get()

    bo_by_cs = defaultdict(list)
    for d in snap:
        data = d.to_dict() or {}
        if data.get("stage") != "confirmed":
            continue
        card_code = (data.get("clientCardCode") or "").strip().upper()
        if not card_code:
            continue
        order_num = data.get("orderNumber")
        created = _to_dt(data.get("createdAt"))
        client_name = (data.get("clientName") or "").strip()
        lines = data.get("lines") or []
        for idx, l in enumerate(lines):
            if not l or l.get("state") != "BO":
                continue
            qo = float(l.get("qtyOpen") or 0)
            if qo <= 0:
                continue
            k = (card_code, str(l.get("code") or "").strip().upper())
            bo_by_cs[k].append({
                "pedidoId": d.id,
                "ref": d.reference,
                "orderNumber": order_num,
                "lineIndex": idx,
                "qtyOpen": qo,
                "created": created,
                "clientName": client_name,
            })

    # Classify B2
    print("[1/3] Clasificando B2 (dup real)...")
    plan = []  # cada entry: info del pedido nuevo a reducir
    for (cc, sku), lineas in bo_by_cs.items():
        if len(lineas) < 2:
            continue
        by_ped = defaultdict(list)
        for ln in lineas:
            by_ped[ln["pedidoId"]].append(ln)
        if len(by_ped) < 2:
            continue
        peds_list = sorted(
            by_ped.items(),
            key=lambda x: min(ln["created"] or datetime.min.replace(tzinfo=timezone.utc) for ln in x[1])
        )
        viejo_pid, viejo_lns = peds_list[0]
        nuevo_pid, nuevo_lns = peds_list[-1]
        qty_viejo = sum(ln["qtyOpen"] for ln in viejo_lns)
        qty_nuevo = sum(ln["qtyOpen"] for ln in nuevo_lns)
        viejo_dt = min(ln["created"] or datetime.min.replace(tzinfo=timezone.utc) for ln in viejo_lns)
        nuevo_dt = max(ln["created"] or datetime.min.replace(tzinfo=timezone.utc) for ln in nuevo_lns)
        dias_apart = (nuevo_dt - viejo_dt).days if viejo_dt and nuevo_dt else -1
        ratio = qty_nuevo / qty_viejo if qty_viejo else 0

        # B2 criterio: ratio 0.5-2x, <=60d apart
        if 0.5 <= ratio <= 2.0 and 0 <= dias_apart <= 60:
            plan.append({
                "cardCode": cc, "sku": sku,
                "clientName": viejo_lns[0]["clientName"],
                "viejo_orden": viejo_lns[0]["orderNumber"], "viejo_qty": qty_viejo,
                "nuevo_pedidoId": nuevo_pid, "nuevo_orden": nuevo_lns[0]["orderNumber"],
                "nuevo_qty": qty_nuevo,
                "nuevo_lineas": nuevo_lns,  # las vamos a reducir al 50%
                "ratio": ratio, "dias_apart": dias_apart,
            })

    print(f"  casos B2: {len(plan)}")
    total_u_nuevo = sum(c["nuevo_qty"] for c in plan)
    # Lo que vamos a cancelar: nuevo - floor(nuevo/2) por cada linea del pedido nuevo
    total_u_cancelar = 0
    total_u_keep = 0
    for c in plan:
        for ln in c["nuevo_lineas"]:
            keep = int(ln["qtyOpen"] // 2)
            cancel = ln["qtyOpen"] - keep
            total_u_cancelar += cancel
            total_u_keep += keep
    print(f"  u del pedido NUEVO en total: {total_u_nuevo:.0f}")
    print(f"  u a cancelar (50%): {total_u_cancelar:.0f}")
    print(f"  u que quedan en nuevo despues (floor 50%): {total_u_keep:.0f}")

    # Preview top 15
    print(f"\n{'='*110}")
    print(f"PREVIEW TOP 15 (ordenado por u a cancelar):")
    print(f"{'='*110}")
    print(f"{'#':>3} {'Cliente':30} {'SKU':20} {'Viejo':>10} {'Nuevo':>10} {'Nuevo→':>12} {'Cancela':>8}")
    print("-" * 110)
    def _cancel_u(c):
        return sum(ln["qtyOpen"] - int(ln["qtyOpen"] // 2) for ln in c["nuevo_lineas"])
    plan_sorted = sorted(plan, key=lambda x: -_cancel_u(x))
    for i, c in enumerate(plan_sorted[:15], 1):
        total_keep = sum(int(ln["qtyOpen"] // 2) for ln in c["nuevo_lineas"])
        total_cancel = _cancel_u(c)
        viejo_str = f"ORD{c['viejo_orden']}:{c['viejo_qty']:.0f}u"
        nuevo_str = f"ORD{c['nuevo_orden']}:{c['nuevo_qty']:.0f}u"
        nuevo_despues = f"{total_keep}u"
        print(f"{i:>3} {c['clientName'][:29]:30} {c['sku']:20} {viejo_str:>10} {nuevo_str:>10} {nuevo_despues:>12} {total_cancel:>8.0f}")

    if DRY_RUN:
        print(f"\n=== DRY_RUN: nada aplicado. Para apply: DRY_RUN=false ===")
        return

    # Apply: por cada caso, reducir qtyOpen de las lineas del pedido nuevo
    print(f"\n[2/3] Aplicando reduccion 50% a pedidos nuevos...")
    now_iso = _iso()
    reduced = 0
    errors = []
    # Agrupar por pedidoId para 1 tx por doc
    by_pedido = defaultdict(list)
    for c in plan:
        by_pedido[c["nuevo_pedidoId"]].append(c)

    for pid, cases in by_pedido.items():
        try:
            @firestore.transactional
            def _tx(txn):
                nonlocal reduced
                ref = cases[0]["nuevo_lineas"][0]["ref"]
                snap_ = ref.get(transaction=txn)
                data = snap_.to_dict() or {}
                lines = list(data.get("lines") or [])
                for case in cases:
                    for ln_info in case["nuevo_lineas"]:
                        li = ln_info["lineIndex"]
                        if li >= len(lines):
                            continue
                        line = lines[li]
                        if not line or line.get("state") != "BO":
                            continue
                        qo = float(line.get("qtyOpen") or 0)
                        if qo <= 0:
                            continue
                        keep = int(qo // 2)
                        reduce_u = qo - keep
                        if reduce_u <= 0:
                            continue
                        new_line = dict(line)
                        new_line["qtyOpen"] = keep
                        new_line["qtyCancelled"] = float(line.get("qtyCancelled") or 0) + reduce_u
                        new_line["partialCancelAt"] = now_iso
                        new_line["partialCancelFrom"] = "audit-bo-bucketB2-reduce50"
                        new_line["partialCancelQty"] = reduce_u
                        new_line["partialCancelReason"] = f"Dup potencial con {case['viejo_orden']} (qty_viejo={case['viejo_qty']}, {case['dias_apart']}d apart)"
                        new_line["partialCancelViejoPedido"] = case.get("viejo_orden")
                        lines[li] = new_line
                        reduced += 1
                txn.update(cases[0]["nuevo_lineas"][0]["ref"], {"lines": lines, "updatedAt": now_iso})
            txn = db.transaction()
            _tx(txn)
        except Exception as e:
            errors.append((pid, str(e)))

    total_u_cancelled = total_u_cancelar
    print(f"  lineas reducidas: {reduced}")
    print(f"  u canceladas: {total_u_cancelled:.0f}")
    if errors:
        print(f"  errores: {len(errors)}")
        for pid, e in errors[:5]:
            print(f"    {pid}: {e}")

    # Audit log
    try:
        db.collection("audit_bo_bucketB2_log").add({
            "runAt": now_iso,
            "casos": len(plan),
            "lineas_reducidas": reduced,
            "u_total_canceladas": float(total_u_cancelled),
            "errors": len(errors),
            "regla": "reducir el BO del pedido mas NUEVO al 50% (floor) cuando dup real (ratio 0.5-2x, <=60d)",
            "source": "scripts/audit_bo_apply_bucketB2.py",
        })
    except Exception:
        pass
    print(f"\n[3/3] DONE B2")


if __name__ == "__main__":
    main()
