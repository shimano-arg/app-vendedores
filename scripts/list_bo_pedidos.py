"""
Lista pedidos-app con lineas state='BO' (backorder pendiente de stock).

Estos son los candidatos que E4.5 FIFO promovera a ASIG cuando entre
stock del SKU -> luego los VDEs podran reciclar via botones Aceptar/Rechazar.

Uso:
  python scripts/list_bo_pedidos.py         # todos los BO abiertos
"""
from __future__ import annotations

import json
import os
from collections import defaultdict

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)


def main():
    cred = credentials.Certificate(SA_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    # Stock actual (dep 11) para saber cuales tienen stock disponible YA
    stock_snap = db.collection("app_config").document("stock_snapshot").get()
    warehouse = (stock_snap.to_dict() or {}).get("warehouseBreakdown") or {}
    if isinstance(warehouse, str):
        try:
            warehouse = json.loads(warehouse)
        except Exception:
            warehouse = {}
    stock_disp = {}
    for sku, wh in warehouse.items():
        if isinstance(wh, dict):
            stock_disp[sku.upper()] = int(wh.get("11", 0) or 0)
        elif isinstance(wh, (int, float)):
            stock_disp[sku.upper()] = int(wh)

    pedidos = db.collection("pedidos").where("closedAt", "==", None).stream()
    by_client = defaultdict(list)
    total_bo_lines = 0
    total_bo_qty = 0
    ready_for_asig = []  # (cardCode, sku, qty, stock) — BO con stock disponible

    for doc in pedidos:
        d = doc.to_dict() or {}
        # cardCode puede venir en varios lugares dependiendo de cuando se creo
        cc = (
            d.get("clientCardCode")
            or d.get("cardCode")
            or (d.get("cliente") or {}).get("cardCode")
            or (d.get("cliente") or {}).get("CardCode")
            or ""
        )
        lines = d.get("lines") or []
        for l in lines:
            if not l or l.get("state") != "BO":
                continue
            sku = str(l.get("code") or "").upper()
            qty = int(l.get("qtyOpen") or 0)
            if not sku or qty <= 0:
                continue
            total_bo_lines += 1
            total_bo_qty += qty
            by_client[cc].append((sku, qty, doc.id))
            disp = stock_disp.get(sku, 0)
            if disp > 0:
                ready_for_asig.append((cc, sku, qty, disp, doc.id))

    print(f"\nTOTAL: {total_bo_lines} lineas BO en {len(by_client)} clientes, {total_bo_qty} unidades pendientes.\n")

    if ready_for_asig:
        print("=" * 90)
        print("BO CON STOCK DISPONIBLE (proximo tick E4.5 los promueve a ASIG)")
        print("=" * 90)
        print(f"{'CARDCODE':<20} {'SKU':<20} {'QTY_BO':>7} {'STOCK':>7} PEDIDO_ID")
        print("-" * 90)
        for cc, sku, qty, disp, pid in ready_for_asig[:30]:
            print(f"{cc:<20} {sku:<20} {qty:>7} {disp:>7} {pid}")
        print()
        print("-> Estos clientes ya deberian estar viendo 'Backorder asignado (app)'")
        print("  al proximo trigger E4.5 (que corre cuando sync_sap_to_firestore.py")
        print("  actualiza el stock, cada ~30 min).")
    else:
        print("=" * 90)
        print("Ningun BO tiene stock disponible ahora. Todos esperando reposicion.")
        print("=" * 90)

    print()
    print("=" * 90)
    print("TOP 15 CLIENTES CON MAS BACKORDER PENDIENTE (sin importar stock)")
    print("=" * 90)
    ranked = sorted(by_client.items(), key=lambda kv: -sum(q for _, q, _ in kv[1]))[:15]
    for cc, lines in ranked:
        try:
            cli = db.collection("clientes").document(cc).get()
            cli_data = cli.to_dict() or {} if cli.exists else {}
        except Exception:
            cli_data = {}
        vendor = cli_data.get("assignedVendor") or cli_data.get("vendorCode") or "-"
        nombre = (cli_data.get("nombre") or cli_data.get("CardName") or cli_data.get("razonSocial") or "?")[:40]
        total_qty = sum(q for _, q, _ in lines)
        n_lines = len(lines)
        skus_str = ",".join(sorted({sku for sku, _, _ in lines}))[:50]
        print(f"  {cc:<18} {total_qty:>4}u {n_lines:>2}lin  {str(vendor):<20} {nombre}")
        print(f"    SKUs: {skus_str}")


if __name__ == "__main__":
    main()
