"""Inspect REBORN SRL ULT4000XGD duplicate case - audit 2026-10-05."""
from google.cloud import firestore

PROJECT = "app-vendedores-shimano"
REBORN = "C30710852762"
SKU = "ULT4000XGD"

fs = firestore.Client(project=PROJECT)
docs = fs.collection("pedidos").where("clientCardCode", "==", REBORN).where("closedAt", "==", None).stream()

matches = []
for d in docs:
    data = d.to_dict() or {}
    lines = data.get("lines") or []
    sku_lines = [(i, l) for i, l in enumerate(lines) if (l.get("code") or "").upper() == SKU and float(l.get("qtyOpen") or 0) > 0]
    if not sku_lines:
        continue
    t = data.get("transferidoSAP") or {}
    matches.append({
        "pedidoId": d.id,
        "createdAt": str(data.get("createdAt") or ""),
        "orderDocNum": t.get("orderDocNum"),
        "orderDocEntry": t.get("orderDocEntry"),
        "sqDocEntry": t.get("docEntry"),
        "sqDocNum": t.get("docNum"),
        "via": t.get("via"),
        "lines_with_sku": [
            {"idx": i, "state": l.get("state"), "qty": l.get("qty"), "qtyOpen": l.get("qtyOpen"), "asigReserva": l.get("asigReserva")}
            for i, l in sku_lines
        ],
    })

print(f"=== REBORN SRL ({REBORN}) + SKU {SKU} ===")
print(f"Pedidos abiertos con ese SKU: {len(matches)}\n")
for m in matches:
    print(f"[{m['pedidoId']}] created={m['createdAt'][:10]}  via={m['via']}")
    print(f"  SQ docEntry={m['sqDocEntry']} docNum={m['sqDocNum']}  "
          f"SO orderDocEntry={m['orderDocEntry']} orderDocNum={m['orderDocNum']}")
    for l in m["lines_with_sku"]:
        print(f"    line[{l['idx']}] state={l['state']} qty={l['qty']} qtyOpen={l['qtyOpen']} asigReserva={l['asigReserva']}")
    print()
