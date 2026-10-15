"""Divide bucket B en 3 sub-buckets:
- B1: mismo pedidoId con 2+ lineas BO del mismo SKU (bug data, unificar seguro)
- B2: pedidos distintos, ratio qty 0.5-2x, fechas <60d apart (duplicado real)
- B3: pedidos distintos con cantidades que suman legitimamente (ampliacion)

Aplica B1 automatico (unifica). Muestra B2/B3 para revision.

Uso:
    DRY_RUN=true  python scripts/audit_bo_split_bucketB.py
    DRY_RUN=false python scripts/audit_bo_split_bucketB.py  (aplica solo B1)
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
    print(f"=== audit_bo_split_bucketB (DRY_RUN={DRY_RUN}) ===")
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
                "qty": float(l.get("qty") or 0),
                "qtyCancelled": float(l.get("qtyCancelled") or 0),
                "created": created,
                "clientName": client_name,
                "linea": l,
            })

    # Casos duplicados
    dup_cases = [(k, v) for k, v in bo_by_cs.items() if len(v) >= 2]
    print(f"casos duplicados: {len(dup_cases)}")

    # Clasificar
    B1_merge_same_pedido = []  # mismo pedido, 2+ lineas
    B2_dup_real = []  # pedidos distintos, ratio 0.5-2x, <60d apart
    B3_ampliacion = []  # pedidos distintos, qty creciente

    for (cc, sku), lineas in dup_cases:
        # Agrupar por pedidoId
        by_ped = defaultdict(list)
        for ln in lineas:
            by_ped[ln["pedidoId"]].append(ln)

        # Lineas que repiten dentro del mismo pedido → B1
        for pid, lns in by_ped.items():
            if len(lns) >= 2:
                B1_merge_same_pedido.append({"cardCode": cc, "sku": sku, "pedidoId": pid, "lineas": lns})

        # Pedidos distintos: comparar pares
        if len(by_ped) >= 2:
            peds_list = list(by_ped.items())
            peds_list.sort(key=lambda x: min(ln["created"] or datetime.min.replace(tzinfo=timezone.utc) for ln in x[1]))
            # Tomar primer y último pedido (más viejo vs más nuevo)
            viejo_pid, viejo_lns = peds_list[0]
            nuevo_pid, nuevo_lns = peds_list[-1]
            if viejo_pid == nuevo_pid:
                continue
            qty_viejo = sum(ln["qtyOpen"] for ln in viejo_lns)
            qty_nuevo = sum(ln["qtyOpen"] for ln in nuevo_lns)
            viejo_dt = min(ln["created"] or datetime.min.replace(tzinfo=timezone.utc) for ln in viejo_lns)
            nuevo_dt = max(ln["created"] or datetime.min.replace(tzinfo=timezone.utc) for ln in nuevo_lns)
            dias_apart = (nuevo_dt - viejo_dt).days if viejo_dt and nuevo_dt else -1
            ratio = qty_nuevo / qty_viejo if qty_viejo else 0

            info = {
                "cardCode": cc, "sku": sku,
                "clientName": viejo_lns[0]["clientName"],
                "viejo_pedidoId": viejo_pid, "viejo_qty": qty_viejo,
                "viejo_fecha": viejo_dt.strftime("%Y-%m-%d") if viejo_dt else "?",
                "viejo_orden": viejo_lns[0]["orderNumber"],
                "nuevo_pedidoId": nuevo_pid, "nuevo_qty": qty_nuevo,
                "nuevo_fecha": nuevo_dt.strftime("%Y-%m-%d") if nuevo_dt else "?",
                "nuevo_orden": nuevo_lns[0]["orderNumber"],
                "ratio": ratio, "dias_apart": dias_apart,
                "viejo_lns": viejo_lns, "nuevo_lns": nuevo_lns,
            }

            # B2: ratio 0.5-2x, <=60d apart → duplicado real
            if 0.5 <= ratio <= 2.0 and dias_apart <= 60:
                B2_dup_real.append(info)
            else:
                B3_ampliacion.append(info)

    # Estadísticas
    u_B1 = sum(sum(ln["qtyOpen"] for ln in c["lineas"]) for c in B1_merge_same_pedido)
    u_B1_to_cancel = sum((sum(ln["qtyOpen"] for ln in c["lineas"]) - max(ln["qtyOpen"] for ln in c["lineas"])) for c in B1_merge_same_pedido)
    u_B2 = sum(c["viejo_qty"] for c in B2_dup_real)  # cancelariamos el viejo
    u_B3 = sum(c["viejo_qty"] + c["nuevo_qty"] for c in B3_ampliacion)

    print(f"\n  B1 (mismo pedido, 2+ lineas del mismo SKU): {len(B1_merge_same_pedido)} casos")
    print(f"      u total:  {u_B1:.0f} / u a cancelar unificando: {u_B1_to_cancel:.0f}")
    print(f"  B2 (dup real, ratio 0.5-2x, <=60d):          {len(B2_dup_real)} casos / {u_B2:.0f}u del BO viejo")
    print(f"  B3 (ampliacion genuina):                      {len(B3_ampliacion)} casos / {u_B3:.0f}u total (NO tocar)")

    # Mostrar top 15 de B2
    print(f"\n{'='*100}")
    print(f"TOP 15 B2 (DUPLICADO REAL candidato cancel BO viejo):")
    print(f"{'='*100}")
    B2_sorted = sorted(B2_dup_real, key=lambda x: -x["viejo_qty"])
    print(f"{'#':>3} {'Cliente':30} {'SKU':20} {'Viejo':>18} {'Nuevo':>18} {'ratio':>5} {'dias':>5}")
    print("-" * 110)
    for i, c in enumerate(B2_sorted[:15], 1):
        viejo = f"ORD{c['viejo_orden']}:{c['viejo_qty']:.0f}u ({c['viejo_fecha']})"
        nuevo = f"ORD{c['nuevo_orden']}:{c['nuevo_qty']:.0f}u ({c['nuevo_fecha']})"
        print(f"{i:>3} {c['clientName'][:29]:30} {c['sku']:20} {viejo:>18} {nuevo:>18} {c['ratio']:>5.2f} {c['dias_apart']:>5}")

    # Mostrar top 15 de B3
    print(f"\n{'='*100}")
    print(f"TOP 15 B3 (AMPLIACION legitima — ratio distinto o >60d apart — NO tocar):")
    print(f"{'='*100}")
    B3_sorted = sorted(B3_ampliacion, key=lambda x: -(x["viejo_qty"] + x["nuevo_qty"]))
    print(f"{'#':>3} {'Cliente':30} {'SKU':20} {'Viejo':>18} {'Nuevo':>18} {'ratio':>5} {'dias':>5}")
    print("-" * 110)
    for i, c in enumerate(B3_sorted[:15], 1):
        viejo = f"ORD{c['viejo_orden']}:{c['viejo_qty']:.0f}u ({c['viejo_fecha']})"
        nuevo = f"ORD{c['nuevo_orden']}:{c['nuevo_qty']:.0f}u ({c['nuevo_fecha']})"
        print(f"{i:>3} {c['clientName'][:29]:30} {c['sku']:20} {viejo:>18} {nuevo:>18} {c['ratio']:>5.2f} {c['dias_apart']:>5}")

    # ===== APLICAR B1 =====
    if DRY_RUN:
        print(f"\n=== DRY_RUN: nada aplicado. Para apply B1: DRY_RUN=false ===")
        return

    print(f"\n{'='*72}")
    print(f"APLICANDO B1 — unificar lineas duplicadas dentro del mismo pedido")
    print(f"{'='*72}")
    now_iso = _iso()
    unified = 0
    errors = []
    by_pedido_b1 = defaultdict(list)
    for case in B1_merge_same_pedido:
        by_pedido_b1[case["pedidoId"]].append(case)

    for pid, cases in by_pedido_b1.items():
        try:
            @firestore.transactional
            def _tx(txn):
                nonlocal unified
                ref = cases[0]["lineas"][0]["ref"]
                snap_ = ref.get(transaction=txn)
                data = snap_.to_dict() or {}
                lines = list(data.get("lines") or [])
                for case in cases:
                    lns_sorted = sorted(case["lineas"], key=lambda x: -x["qtyOpen"])
                    keeper = lns_sorted[0]
                    cancels = lns_sorted[1:]
                    # Sumar qtyOpen del resto al keeper
                    sum_cancelled = sum(ln["qtyOpen"] for ln in cancels)
                    keeper_idx = keeper["lineIndex"]
                    kline = lines[keeper_idx]
                    if not kline or kline.get("state") != "BO":
                        continue
                    new_keeper = dict(kline)
                    new_keeper["qtyOpen"] = float(kline.get("qtyOpen") or 0) + sum_cancelled
                    new_keeper["qty"] = float(kline.get("qty") or 0) + sum_cancelled
                    new_keeper["unifiedFrom"] = [c["lineIndex"] for c in cancels]
                    new_keeper["unifiedAt"] = now_iso
                    new_keeper["unifiedBy"] = "audit-bo-bucketB1"
                    lines[keeper_idx] = new_keeper
                    for c in cancels:
                        idx = c["lineIndex"]
                        cline = lines[idx]
                        if not cline or cline.get("state") != "BO":
                            continue
                        qo = float(cline.get("qtyOpen") or 0)
                        new_c = dict(cline)
                        new_c["state"] = "cancelled"
                        new_c["qtyOpen"] = 0
                        new_c["qtyCancelled"] = float(cline.get("qtyCancelled") or 0) + qo
                        new_c["cancelledFrom"] = "audit-bo-bucketB1-merged-to"
                        new_c["cancelledMergedToIndex"] = keeper_idx
                        new_c["cancelledAt"] = now_iso
                        lines[idx] = new_c
                        unified += 1
                txn.update(cases[0]["lineas"][0]["ref"], {"lines": lines, "updatedAt": now_iso})
            txn = db.transaction()
            _tx(txn)
        except Exception as e:
            errors.append((pid, str(e)))

    print(f"  lineas unificadas (canceladas): {unified}")
    if errors:
        print(f"  errores: {len(errors)}")
        for pid, e in errors[:5]:
            print(f"    {pid}: {e}")

    # Audit log
    try:
        db.collection("audit_bo_bucketB1_log").add({
            "runAt": now_iso,
            "casos": len(B1_merge_same_pedido),
            "unified": unified,
            "errors": len(errors),
            "source": "scripts/audit_bo_split_bucketB.py",
        })
    except Exception:
        pass
    print(f"\n=== DONE B1 ===")


if __name__ == "__main__":
    main()
