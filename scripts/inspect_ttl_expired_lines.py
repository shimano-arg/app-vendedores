"""Inspect lines/pedidos que el CF expireAsigLinesTTLCF marco como expiradas
los dias 2026-10-03 / 04 / 05. Confirma que no se borro nada - solo cambio state.
"""
from datetime import datetime, timezone
from google.cloud import firestore

PROJECT = "app-vendedores-shimano"
fs = firestore.Client(project=PROJECT)

# Pedidos cerrados desde 2026-10-03 00:00 UTC
cutoff_from = datetime(2026, 10, 3, 0, 0, tzinfo=timezone.utc)
cutoff_to = datetime(2026, 10, 6, 0, 0, tzinfo=timezone.utc)

docs = fs.collection("pedidos").where("closedAt", ">=", cutoff_from).where("closedAt", "<", cutoff_to).stream()

by_reason = {}
expired_lines_sample = []
pedidos_closed = 0
total_pedidos = 0

for d in docs:
    data = d.to_dict() or {}
    total_pedidos += 1
    reason = data.get("closedReason") or "(sin reason)"
    by_reason[reason] = by_reason.get(reason, 0) + 1
    if "ttl" in reason.lower() or "expired" in reason.lower():
        pedidos_closed += 1

print(f"=== Pedidos cerrados 2026-10-03..05 UTC: {total_pedidos} ===\n")
print("Por closedReason:")
for r, c in sorted(by_reason.items(), key=lambda kv: -kv[1]):
    print(f"  {c:>4}  {r}")

# Lineas con state=expired (dentro de pedidos abiertos, no cerrados completamente)
print("\n=== Líneas state='expired' en pedidos activos (abiertos) ===")
open_pedidos = fs.collection("pedidos").where("closedAt", "==", None).stream()
expired_in_open = 0
sample_values = []
for d in open_pedidos:
    data = d.to_dict() or {}
    for i, l in enumerate(data.get("lines") or []):
        if (l or {}).get("state") == "expired":
            expired_in_open += 1
            price = float((l or {}).get("priceAtCreation") or 0)
            qty = float((l or {}).get("qty") or 0)
            if len(sample_values) < 10:
                sample_values.append({
                    "pedidoId": d.id,
                    "sku": l.get("code"),
                    "qty": qty,
                    "priceAtCreation": price,
                    "value_ars": qty * price,
                })

print(f"Lineas en state='expired' encontradas: {expired_in_open}")
if sample_values:
    print("\nMuestra 10 lineas expiradas (valor estimado):")
    total_sample = 0
    for s in sample_values:
        print(f"  {s['sku']:<20} qty={s['qty']:>6.0f}  precio=${s['priceAtCreation']:>12,.0f}  valor=${s['value_ars']:>14,.0f}  pedido={s['pedidoId']}")
        total_sample += s["value_ars"]
    print(f"\n  Subtotal muestra: ${total_sample:,.0f}")
