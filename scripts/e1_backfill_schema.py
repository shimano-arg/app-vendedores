"""
E1 — Backfill schema pedidos para migracion BO/ASIG desde app.

Agrega campos nuevos a cada doc de `pedidos` con defaults neutros:

Por linea (lines[]):
  - qtyOpen: qty (todo pendiente al momento de migrar)
  - qtyInvoiced: 0
  - qtyCancelled: 0
  - qtyRecycled: 0
  - state: 'legacy' (pre-migracion, no interpretar el estado hasta cutover)
  - asigAt: null
  - recycledIntoPedidoId: null
  - priceAtCreation: precio || 0

Por pedido (header):
  - sapLinkage: { soDocEntry: null, lastInvoiceDocEntry: null, lastSyncAt: null }
  - closedAt: null
  - closedReason: null
  - schemaVersion: 2

Idempotencia: si schemaVersion == 2 -> skip.

Uso:
  python scripts/e1_backfill_schema.py             # dry-run
  python scripts/e1_backfill_schema.py --apply     # aplica cambios

Requiere service account en:
  ~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json
"""

import os
import sys
import argparse
from collections import defaultdict

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)

SCHEMA_VERSION = 2
BATCH_SIZE = 400  # Firestore permite 500, dejo margen


def build_migrated_lines(lines):
    """Toma el array lines[] existente y agrega campos nuevos por linea."""
    out = []
    for l in lines or []:
        if not isinstance(l, dict):
            # Linea corrupta o formato inesperado, la dejo como esta.
            out.append(l)
            continue
        qty = l.get("qty", 0) or 0
        precio = l.get("precio", 0) or 0
        migrated = dict(l)  # preservar todos los campos existentes
        migrated.setdefault("qtyOpen", qty)
        migrated.setdefault("qtyInvoiced", 0)
        migrated.setdefault("qtyCancelled", 0)
        migrated.setdefault("qtyRecycled", 0)
        migrated.setdefault("state", "legacy")
        migrated.setdefault("asigAt", None)
        migrated.setdefault("recycledIntoPedidoId", None)
        migrated.setdefault("priceAtCreation", precio)
        out.append(migrated)
    return out


def build_header_updates(data):
    """Devuelve un dict con los updates a aplicar al header del pedido."""
    updates = {"schemaVersion": SCHEMA_VERSION}
    if "sapLinkage" not in data:
        updates["sapLinkage"] = {
            "soDocEntry": None,
            "lastInvoiceDocEntry": None,
            "lastSyncAt": None,
        }
    if "closedAt" not in data:
        updates["closedAt"] = None
    if "closedReason" not in data:
        updates["closedReason"] = None
    return updates


def main():
    parser = argparse.ArgumentParser(description="E1 backfill schema pedidos")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplicar cambios. Sin este flag, corre en dry-run.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limitar cantidad de pedidos procesados (para testing).",
    )
    args = parser.parse_args()
    dry_run = not args.apply

    if not os.path.exists(SA_PATH):
        print(f"ERROR No encuentro service account en {SA_PATH}")
        sys.exit(1)

    cred = credentials.Certificate(SA_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    mode = "DRY-RUN" if dry_run else "APPLY"
    print(f"[{mode}] Leyendo colección pedidos...")

    query = db.collection("pedidos")
    if args.limit:
        query = query.limit(args.limit)
    docs = list(query.stream())
    total = len(docs)
    print(f"Total pedidos leídos: {total}\n")

    already_migrated = 0
    to_migrate = 0
    corrupt = 0
    by_stage = defaultdict(int)
    sample_before = None
    sample_after = None
    batch = db.batch()
    batch_count = 0

    for d in docs:
        data = d.to_dict() or {}
        stage = data.get("stage", "(none)")
        by_stage[stage] += 1

        if data.get("schemaVersion") == SCHEMA_VERSION:
            already_migrated += 1
            continue

        lines = data.get("lines")
        if lines is None:
            # No hay lines[], no se puede migrar de manera segura.
            corrupt += 1
            continue

        new_lines = build_migrated_lines(lines)
        header_updates = build_header_updates(data)
        header_updates["lines"] = new_lines

        if sample_before is None:
            sample_before = {"id": d.id, "lines_sample": (lines or [])[:1], "header_before": {
                k: data.get(k) for k in ["stage", "schemaVersion", "sapLinkage", "closedAt", "closedReason"]
            }}
            sample_after = {"id": d.id, "lines_sample": new_lines[:1], "header_after": {
                k: header_updates.get(k) for k in ["stage", "schemaVersion", "sapLinkage", "closedAt", "closedReason"]
            }}

        to_migrate += 1

        if not dry_run:
            batch.update(d.reference, header_updates)
            batch_count += 1
            if batch_count >= BATCH_SIZE:
                batch.commit()
                print(f"  Commit batch ({batch_count} docs)...")
                batch = db.batch()
                batch_count = 0

    if not dry_run and batch_count > 0:
        batch.commit()
        print(f"  Commit final batch ({batch_count} docs)...")

    print("=" * 60)
    print("RESUMEN")
    print("=" * 60)
    print(f"Total pedidos:              {total}")
    print(f"Ya migrados (schemaVer=2):  {already_migrated}")
    print(f"A migrar:                   {to_migrate}")
    print(f"Corruptos (sin lines[]):    {corrupt}")
    print()
    print("Distribución por stage:")
    for stage, count in sorted(by_stage.items(), key=lambda kv: -kv[1]):
        print(f"  {stage:20s} {count}")
    print()

    if sample_before and sample_after:
        print("Ejemplo de migración:")
        print(f"  Doc ID: {sample_before['id']}")
        print(f"  Header ANTES: {sample_before['header_before']}")
        print(f"  Header DESPUÉS: {sample_after['header_after']}")
        print(f"  Line[0] ANTES: {sample_before['lines_sample']}")
        print(f"  Line[0] DESPUÉS: {sample_after['lines_sample']}")
        print()

    if dry_run:
        print("[DRY-RUN] No se aplicaron cambios. Correr con --apply para migrar.")
    else:
        print(f"[APPLY] Migración completada: {to_migrate} pedidos actualizados.")


if __name__ == "__main__":
    main()
