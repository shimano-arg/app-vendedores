"""Muestra top 20 casos del bucket B (duplicado cliente+SKU en 2+ pedidos BO).

Para cada caso: cliente, SKU, cantidad total BO, cantidad por pedido, fechas.
Ayuda a Mariano a decidir cuáles son dup legítimos y cuáles basura.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, timezone

from google.cloud import firestore

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT = "app-vendedores-shimano"


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


def main():
    print("=" * 100)
    print("TOP 20 BUCKET B — Duplicado cliente+SKU en 2+ pedidos (ordenado por u_total DESC)")
    print("=" * 100)
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
                "orderNumber": order_num,
                "lineIndex": idx,
                "qtyOpen": qo,
                "qty": float(l.get("qty") or 0),
                "created": created,
                "clientName": client_name,
            })

    # Filtrar casos con 2+ pedidos
    dup_cases = [(k, v) for k, v in bo_by_cs.items() if len(v) >= 2]
    # Ordenar por total u DESC
    dup_cases.sort(key=lambda x: -sum(ln["qtyOpen"] for ln in x[1]))

    print(f"\nTotal casos duplicados: {len(dup_cases)}")
    print(f"Total unidades en duplicados: {sum(sum(ln['qtyOpen'] for ln in c) for _, c in dup_cases):.0f}\n")

    print(f"{'#':>3} {'Cliente':35} {'SKU':20} {'u_total':>8} {'n_ped':>6} Detalle (orden, u, fecha)")
    print("-" * 120)
    for i, ((cc, sku), lineas) in enumerate(dup_cases[:20], 1):
        total_u = sum(ln["qtyOpen"] for ln in lineas)
        cliente = (lineas[0]["clientName"] or cc)[:34]
        lineas_sorted = sorted(lineas, key=lambda x: x["created"] or datetime.min.replace(tzinfo=timezone.utc))
        detalle_items = []
        for ln in lineas_sorted:
            fecha = ln["created"].strftime("%m/%d") if ln["created"] else "?"
            detalle_items.append(f"ORD{ln['orderNumber']}:{ln['qtyOpen']:.0f}u({fecha})")
        detalle = " | ".join(detalle_items)
        print(f"{i:>3} {cliente:35} {sku:20} {total_u:>8.0f} {len(lineas):>6}  {detalle}")

    print(f"\n{'-' * 120}")
    print(f"\n¿Que querés hacer con estos casos?")
    print(f"  A) Cancelar el BO MAS VIEJO cuando hay duplicado (asume que el nuevo pedido es el vigente)")
    print(f"  B) Cancelar el BO MAS NUEVO (asume que el viejo es el 'legítimo')")
    print(f"  C) Unificar: mantener uno con la qty mas alta y cancelar el resto")
    print(f"  D) Revisar manualmente caso por caso (Excel YA generado)")


if __name__ == "__main__":
    main()
