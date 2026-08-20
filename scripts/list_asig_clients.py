"""
Lista clientes con lineas ASIG en la app (para elegir con quien probar
el flow E4B Aceptar/Rechazar de backorder asignado).

Lee `app_config/stock_snapshot_app.asigByClientSkuApp` (doc active
escrito por CF onPedidoWriteRecalcSnapshot), agrupa por cardCode,
resuelve nombre + vendedor asignado desde `clientes/{cardCode}`, y
muestra el ranking con mas ASIG pendiente.

Uso:
  python scripts/list_asig_clients.py            # top 20
  python scripts/list_asig_clients.py --limit 50 # top 50
  python scripts/list_asig_clients.py --sku CODE # filtrar por SKU
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--sku", type=str, default=None, help="filtrar por SKU (upper)")
    args = ap.parse_args()

    cred = credentials.Certificate(SA_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    snap = db.collection("app_config").document("stock_snapshot_app").get()
    if not snap.exists:
        print("app_config/stock_snapshot_app no existe -> CF E3 nunca escribio en active mode.")
        return
    d = snap.to_dict() or {}
    asig_cli = d.get("asigByClientSkuApp") or {}
    if not asig_cli:
        print("asigByClientSkuApp vacio -> no hay ASIG activas en app-source.")
        print("(Prob: los pedidos con ASIG estan todos cerrados, o solo hay legacy sin state).")
        return

    by_card = defaultdict(dict)
    sku_filter = (args.sku or "").upper().strip() or None
    for key, qty in asig_cli.items():
        if "::" not in key:
            continue
        cc, sku = key.split("::", 1)
        if sku_filter and sku.upper() != sku_filter:
            continue
        try:
            q = int(qty or 0)
        except Exception:
            q = 0
        if q <= 0:
            continue
        by_card[cc][sku] = q

    if not by_card:
        print(f"Sin resultados (filtro sku={sku_filter}).")
        return

    ranking = sorted(by_card.items(), key=lambda kv: -sum(kv[1].values()))[: args.limit]

    print(f"\n{'CARDCODE':<20} {'QTY':>5} {'#SKU':>5} VENDEDOR                CLIENTE")
    print("-" * 100)
    for cc, skus in ranking:
        total_qty = sum(skus.values())
        n_skus = len(skus)
        try:
            cli = db.collection("clientes").document(cc).get()
            cli_data = cli.to_dict() or {} if cli.exists else {}
        except Exception:
            cli_data = {}
        vendor = cli_data.get("assignedVendor") or cli_data.get("vendorCode") or "-"
        nombre = cli_data.get("nombre") or cli_data.get("CardName") or cli_data.get("razonSocial") or "?"
        print(f"{cc:<20} {total_qty:>5} {n_skus:>5} {str(vendor):<24} {nombre[:50]}")

    print()
    print("Para probar con uno: abrir la ficha del cliente en la app,")
    print("y ver la seccion 'Backorder asignado (app)' con los botones ✓/✗.")


if __name__ == "__main__":
    main()
