"""
Rebuild completo de app_config/stock_snapshot_app (v551+ active mode) con las
4 keys derivadas de pedidos-app:
  - backorderBySkuApp[sku]
  - asigBySkuApp[sku]
  - asigByClientSkuApp[cardCode::sku]
  - backorderByClientSkuApp[cardCode::sku]  (v567+)

Uso principal: post-deploy de la CF nueva (v567 backorderByClientSkuApp),
la CF solo re-escribe keys cuando SE MODIFICA un pedido. Este script llena
el snapshot con TODO el estado actual sin esperar actividad organica.

Idempotente + --dry-run default. --apply para escribir.

Reglas de agregacion (mismo que functions/core/pedido-snapshot-core.js):
  - Considera solo pedidos con closedAt == null.
  - Ignora lineas con state='legacy' / 'confirmed' / 'invoiced' /
    'cancelled' / 'recycled' / 'expired'.
  - Solo cuenta state='BO' o 'ASIG'.
  - Suma qtyOpen (no qty).
  - Solo cuenta lineas con qtyOpen > 0.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)
ACTIVE_DOC = "app_config/stock_snapshot_app"
IGNORED_STATES = {"legacy", "confirmed", "invoiced", "cancelled", "recycled", "expired"}


def aggregate_from_pedidos(db):
    bo_by_sku = defaultdict(float)
    asig_by_sku = defaultdict(float)
    asig_by_client_sku = defaultdict(float)
    bo_by_client_sku = defaultdict(float)
    stats = {
        "pedidos_total": 0, "pedidos_open": 0,
        "lines_seen": 0, "lines_bo": 0, "lines_asig": 0,
        "lines_ignored_state": defaultdict(int),
        "lines_zero_qtyopen": 0, "lines_no_cardcode_bo": 0,
    }
    docs = list(db.collection("pedidos").stream())
    stats["pedidos_total"] = len(docs)
    stats["pedidos_sin_transferido_skip"] = 0
    for doc in docs:
        d = doc.to_dict() or {}
        if d.get("closedAt"):
            continue
        # v578 (2026-08-21): solo pedidos procesados por auto-send cuentan
        # para backorder (mirror del filter en aggregateForSku).
        if not d.get("transferidoSAP"):
            stats["pedidos_sin_transferido_skip"] += 1
            continue
        stats["pedidos_open"] += 1
        cc = str(d.get("clientCardCode") or "").strip()
        for line in d.get("lines") or []:
            stats["lines_seen"] += 1
            code = str(line.get("code") or "").strip()
            state = str(line.get("state") or "").strip()
            qty_open = float(line.get("qtyOpen") or 0)
            if not code:
                continue
            if state in IGNORED_STATES:
                stats["lines_ignored_state"][state] += 1
                continue
            if qty_open <= 0:
                stats["lines_zero_qtyopen"] += 1
                continue
            if state == "BO":
                bo_by_sku[code] += qty_open
                stats["lines_bo"] += 1
                if cc:
                    bo_by_client_sku[f"{cc}::{code}"] += qty_open
                else:
                    stats["lines_no_cardcode_bo"] += 1
            elif state == "ASIG":
                asig_by_sku[code] += qty_open
                stats["lines_asig"] += 1
                if cc:
                    asig_by_client_sku[f"{cc}::{code}"] += qty_open

    def _cast(m):
        return {k: (int(v) if v == int(v) else v) for k, v in m.items()}
    return (_cast(bo_by_sku), _cast(asig_by_sku),
            _cast(asig_by_client_sku), _cast(bo_by_client_sku), stats)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="Escribe cambios (default: dry-run)")
    args = parser.parse_args()

    if not os.path.exists(SA_PATH):
        print(f"ERROR SA no encontrado: {SA_PATH}", file=sys.stderr)
        sys.exit(1)
    firebase_admin.initialize_app(credentials.Certificate(SA_PATH))
    db = firestore.client()

    print(f"[{'APPLY' if args.apply else 'DRY-RUN'}] Rebuild {ACTIVE_DOC}\n")

    bo, asig, asig_cli, bo_cli, stats = aggregate_from_pedidos(db)
    print("Stats agregacion pedidos:")
    print(f"  pedidos total: {stats['pedidos_total']}")
    print(f"  pedidos open + transferidoSAP: {stats['pedidos_open']}")
    print(f"  pedidos open pero SIN transferidoSAP (v578 skip): {stats['pedidos_sin_transferido_skip']}")
    print(f"  lines totales: {stats['lines_seen']}")
    print(f"  lines BO contabilizadas: {stats['lines_bo']}")
    print(f"  lines ASIG contabilizadas: {stats['lines_asig']}")
    print(f"  lines ignoradas por state: {dict(stats['lines_ignored_state'])}")
    print(f"  lines con qtyOpen<=0: {stats['lines_zero_qtyopen']}")
    print(f"  lines BO sin cardCode (no van a backorderByClientSkuApp): {stats['lines_no_cardcode_bo']}")
    print()
    print("Resultado agregacion:")
    print(f"  backorderBySkuApp:        {len(bo)} SKUs, sum={sum(bo.values())}")
    print(f"  asigBySkuApp:             {len(asig)} SKUs, sum={sum(asig.values())}")
    print(f"  asigByClientSkuApp:       {len(asig_cli)} keys, sum={sum(asig_cli.values())}")
    print(f"  backorderByClientSkuApp:  {len(bo_cli)} keys, sum={sum(bo_cli.values())}")

    if not args.apply:
        print("\n(dry-run — sin escritura. Correr con --apply para persistir)")
        return

    ref = db.collection("app_config").document("stock_snapshot_app")
    ref.set({
        "backorderBySkuApp": bo,
        "asigBySkuApp": asig,
        "asigByClientSkuApp": asig_cli,
        "backorderByClientSkuApp": bo_cli,
        "sourceApp": "app_pedidos_v3",
        "updatedAtApp": firestore.SERVER_TIMESTAMP,
        "backfilledAt": firestore.SERVER_TIMESTAMP,
        "backfilledBy": "rebuild_stock_snapshot_app.py",
    }, merge=True)
    print("\n[APPLY] Escritura OK — stock_snapshot_app actualizado con los 4 sub-maps.")
    print("        La UI (modal cliente) va a leer los datos nuevos en el proximo listener update.")


if __name__ == "__main__":
    main()
