"""
Rebuild completo de stock_snapshot_shadow_v3.backorderBySkuApp / asigBySkuApp /
asigByClientSkuApp a partir del estado actual de la coleccion pedidos.

Reemplazo del pedido-snapshot-core.js logic hecho en Python, corrida one-shot.

Usos:
  1. Backfill: post-fix del bug dotted-paths (2026-08-19), la CF solo re-escribe
     SKUs afectados por futuros writes a pedidos. Este script llena el nested
     map con TODO el estado actual sin esperar actividad organica.
  2. Limpieza: elimina las claves top-level flat legacy `backorderBySkuApp.SKU1`,
     `asigByClientSkuApp.CARD::SKU`, etc. que quedaron del bug pre-fix.

Idempotente + --dry-run default. --apply para escribir.

Reglas de agregacion (mismo que functions/core/pedido-snapshot-core.js):
  - Considera solo pedidos con closedAt == null.
  - Ignora lineas con state='legacy' (56 pedidos backfilleados en E1).
  - Ignora lineas con state='confirmed' (van a SAP, no cuentan como BO/ASIG app).
  - Ignora lineas con state='invoiced'/'cancelled'/'recycled' (cerradas).
  - Suma qtyOpen (no qty) para reflejar lo que queda REALMENTE abierto.
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
SHADOW_DOC = "app_config/stock_snapshot_shadow_v3"
IGNORED_STATES = {"legacy", "confirmed", "invoiced", "cancelled", "recycled"}


def aggregate_from_pedidos(db):
    """Devuelve (backorder_by_sku, asig_by_sku, asig_by_client_sku, stats)."""
    bo_by_sku = defaultdict(float)
    asig_by_sku = defaultdict(float)
    asig_by_client_sku = defaultdict(float)  # key: "CARD::SKU"
    stats = {"pedidos_total": 0, "pedidos_open": 0,
             "lines_seen": 0, "lines_bo": 0, "lines_asig": 0,
             "lines_ignored_state": defaultdict(int),
             "lines_zero_qtyopen": 0}
    docs = list(db.collection("pedidos").stream())
    stats["pedidos_total"] = len(docs)
    for doc in docs:
        d = doc.to_dict() or {}
        if d.get("closedAt"):
            continue
        stats["pedidos_open"] += 1
        cc = str(d.get("clientCardCode") or "").strip()
        lines = d.get("lines") or []
        for line in lines:
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
            elif state == "ASIG":
                asig_by_sku[code] += qty_open
                stats["lines_asig"] += 1
                if cc:
                    asig_by_client_sku[f"{cc}::{code}"] += qty_open
    # Cast a int si son enteros exactos (Firestore guarda floats pero UI espera int).
    def _cast(m):
        return {k: (int(v) if v == int(v) else v) for k, v in m.items()}
    return _cast(bo_by_sku), _cast(asig_by_sku), _cast(asig_by_client_sku), stats


def find_orphan_flat_keys(db):
    """Devuelve la lista de claves top-level literales con puntos en el nombre
    (residuos del bug pre-fix). Ej: 'backorderBySkuApp.SKU1'."""
    snap = db.collection("app_config").document("stock_snapshot_shadow_v3").get()
    if not snap.exists:
        return []
    d = snap.to_dict() or {}
    orphans = []
    for key in d.keys():
        if "." in key and (
            key.startswith("backorderBySkuApp.")
            or key.startswith("asigBySkuApp.")
            or key.startswith("asigByClientSkuApp.")
        ):
            orphans.append(key)
    return orphans


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

    print(f"[{'APPLY' if args.apply else 'DRY-RUN'}] Rebuild {SHADOW_DOC}\n")

    bo, asig, asig_cli, stats = aggregate_from_pedidos(db)
    print("Stats agregacion pedidos:")
    print(f"  pedidos total: {stats['pedidos_total']}")
    print(f"  pedidos open (closedAt==null): {stats['pedidos_open']}")
    print(f"  lines totales: {stats['lines_seen']}")
    print(f"  lines BO contabilizadas: {stats['lines_bo']}")
    print(f"  lines ASIG contabilizadas: {stats['lines_asig']}")
    print(f"  lines ignoradas por state: {dict(stats['lines_ignored_state'])}")
    print(f"  lines con qtyOpen<=0: {stats['lines_zero_qtyopen']}")
    print()
    print("Resultado agregacion:")
    print(f"  backorderBySkuApp: {len(bo)} SKUs, sum={sum(bo.values())}")
    print(f"  asigBySkuApp:      {len(asig)} SKUs, sum={sum(asig.values())}")
    print(f"  asigByClientSkuApp: {len(asig_cli)} keys, sum={sum(asig_cli.values())}")

    orphans = find_orphan_flat_keys(db)
    print(f"\nOrphan flat keys en el doc (bug pre-fix): {len(orphans)}")
    if orphans[:5]:
        for k in orphans[:5]:
            print(f"  - {k}")
        if len(orphans) > 5:
            print(f"  ...(+{len(orphans) - 5} mas)")

    if not args.apply:
        print("\n(dry-run — sin escritura. Correr con --apply para persistir)")
        return

    # 1. Escribir nested maps (fresh, no merge para que reemplace cualquier
    #    contenido corrupto del sub-map).
    from firebase_admin.firestore import SERVER_TIMESTAMP
    ref = db.collection("app_config").document("stock_snapshot_shadow_v3")
    # Set entero de los 3 sub-maps + metadata. NO merge para reemplazar
    # cualquier flat/nested legacy inconsistente.
    ref.set({
        "backorderBySkuApp": bo,
        "asigBySkuApp": asig,
        "asigByClientSkuApp": asig_cli,
        "sourceApp": "app_pedidos_v3",
        "updatedAtApp": firestore.SERVER_TIMESTAMP,
        "backfilledAt": firestore.SERVER_TIMESTAMP,
        "backfilledBy": "rebuild_shadow_snapshot_v3.py",
    }, merge=True)
    print("\n[APPLY] Nested maps escritos OK.")

    # 2. Borrar orphan flat keys.
    if orphans:
        from firebase_admin.firestore import DELETE_FIELD
        # Firestore soporta batch de 500 field deletes en un update.
        for i in range(0, len(orphans), 400):
            batch = orphans[i:i + 400]
            update = {k: DELETE_FIELD for k in batch}
            ref.update(update)
        print(f"[APPLY] {len(orphans)} orphan flat keys borrados.")
    else:
        print("[APPLY] Sin orphan flat keys — nada que limpiar.")


if __name__ == "__main__":
    main()
