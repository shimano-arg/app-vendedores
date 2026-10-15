"""Aplica bucket C: cancela las lineas BO de los 10 pedidos huerfanos (nunca
llegaron a SAP, nada en SAP los explica, nada facturado).

Si tras cancelar no queda NINGUNA linea viva (state in BO/ASIG/confirmed con qtyOpen>0),
cierra el pedido entero con closedAt=now.

Autorizado por Mariano 2026-10-15 tras ver el reporte audit_bo_bucketC_review_vendedor.xlsx.

Uso:
    DRY_RUN=true  python scripts/audit_bo_apply_bucketC.py
    DRY_RUN=false python scripts/audit_bo_apply_bucketC.py
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
CANCEL_REASON = "audit-bo-bucketC-huerfano-sin-sap"


def _to_dt(v):
    if v is None: return None
    if hasattr(v, "timestamp"):
        try: return datetime.fromtimestamp(v.timestamp(), tz=timezone.utc)
        except: return None
    return None


def _iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    print(f"=== audit_bo_apply_bucketC (DRY_RUN={DRY_RUN}) ===")
    db = firestore.Client(project=PROJECT)
    now = datetime.now(timezone.utc)
    snap = db.collection("pedidos").where("closedAt", "==", None).get()

    plan = []  # (pedidoId, ref, bo_line_indices, meta)
    for d in snap:
        data = d.to_dict() or {}
        if data.get("stage") != "confirmed": continue
        created = _to_dt(data.get("createdAt"))
        if not created or (now - created).days <= 30: continue
        tsap = data.get("transferidoSAP") if isinstance(data.get("transferidoSAP"), dict) else None
        if tsap and tsap.get("docNum"): continue

        bo_idxs = []
        total_u = 0
        for idx, l in enumerate(data.get("lines") or []):
            if not l or l.get("state") != "BO": continue
            qo = float(l.get("qtyOpen") or 0)
            if qo <= 0: continue
            bo_idxs.append(idx)
            total_u += qo
        if not bo_idxs: continue

        plan.append({
            "pedidoId": d.id,
            "ref": d.reference,
            "orderNumber": data.get("orderNumber"),
            "clientName": (data.get("clientName") or "").strip(),
            "cardCode": (data.get("clientCardCode") or "").strip(),
            "bo_line_indices": bo_idxs,
            "total_u": total_u,
            "created_days": (now - created).days,
        })

    print(f"\nPLAN:")
    total_lineas = sum(len(p["bo_line_indices"]) for p in plan)
    total_u = sum(p["total_u"] for p in plan)
    print(f"  pedidos a procesar: {len(plan)}")
    print(f"  lineas a cancelar:  {total_lineas}")
    print(f"  unidades:           {total_u:.0f}u")
    print()
    for p in sorted(plan, key=lambda x: -x["total_u"]):
        orden = f"ORD{p['orderNumber']}" if p["orderNumber"] else "sin-ORD"
        print(f"  {orden:12} {p['clientName'][:30]:30} {len(p['bo_line_indices']):>2}L {p['total_u']:>4.0f}u ({p['created_days']}d old)")

    if DRY_RUN:
        print(f"\n=== DRY_RUN: nada aplicado. Para apply: DRY_RUN=false ===")
        return

    print(f"\n[APLICANDO]")
    now_iso = _iso()
    cancelled = 0
    pedidos_cerrados = 0
    errors = []

    for p in plan:
        try:
            @firestore.transactional
            def _tx(txn):
                nonlocal cancelled, pedidos_cerrados
                snap_ = p["ref"].get(transaction=txn)
                data = snap_.to_dict() or {}
                lines = list(data.get("lines") or [])

                for li in p["bo_line_indices"]:
                    if li >= len(lines): continue
                    line = lines[li]
                    if not line or line.get("state") != "BO": continue
                    qo = float(line.get("qtyOpen") or 0)
                    if qo <= 0: continue
                    new_line = dict(line)
                    new_line["state"] = "cancelled"
                    new_line["qtyOpen"] = 0
                    new_line["qtyCancelled"] = float(line.get("qtyCancelled") or 0) + qo
                    new_line["cancelledFrom"] = CANCEL_REASON
                    new_line["cancelledAt"] = now_iso
                    new_line["cancelledReason"] = f"Pedido {p['created_days']}d sin SAP docNum, sin SQ relacionada, sin facturado"
                    lines[li] = new_line
                    cancelled += 1

                # Chequear si queda alguna linea viva (BO/ASIG/confirmed con qtyOpen>0)
                live = any(
                    (l.get("state") in ("BO", "ASIG", "confirmed") and float(l.get("qtyOpen") or 0) > 0)
                    for l in lines
                )
                updates = {"lines": lines, "updatedAt": now_iso}
                if not live:
                    updates["closedAt"] = now_iso
                    updates["closedFrom"] = CANCEL_REASON
                    pedidos_cerrados += 1
                txn.update(p["ref"], updates)

            _tx(db.transaction())
        except Exception as e:
            errors.append((p["pedidoId"], str(e)))

    print(f"  lineas canceladas:  {cancelled}")
    print(f"  pedidos cerrados:   {pedidos_cerrados} / {len(plan)}")
    if errors:
        print(f"  errores: {len(errors)}")
        for pid, e in errors[:5]:
            print(f"    {pid}: {e}")

    # Audit log
    try:
        db.collection("audit_bo_bucketC_log").add({
            "runAt": now_iso,
            "pedidos_procesados": len(plan),
            "lineas_canceladas": cancelled,
            "pedidos_cerrados": pedidos_cerrados,
            "u_total_canceladas": float(total_u),
            "errors": len(errors),
            "autorizado_por": "Mariano 2026-10-15",
            "source": "scripts/audit_bo_apply_bucketC.py",
        })
    except Exception:
        pass
    print(f"\n=== DONE C ===")


if __name__ == "__main__":
    main()
