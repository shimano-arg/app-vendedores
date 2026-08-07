"""Bootstrap del snapshot BQ -> Firestore para el modal FORECAST.
Corre sync_sku_ventas_snapshot_to_firestore() aislado del script principal
(sin hacer todo el fetch SL de invoices/quotations/etc).

Uso:
    python scripts/apply_sku_ventas_snapshot.py

Requiere:
- ~/Desktop/sa-key.json con service account que tiene BQ Read + Firestore Write.
- La vista v_ventas_lineas ya deployada (esta desde 2026-07-30 -
  ver apply_credit_notes_fix.py + v_ventas_lineas en bigquery/views.sql).

Despues de este bootstrap, el cron GH Actions llama a
sync_sku_ventas_snapshot_to_firestore() al final de sync_sap_to_bigquery.py
en cada corrida (13,43 * * * *) y refresca la coleccion sku_ventas_snapshot
cada 30 min con la ventana 13m rolling.

Volumen esperado: ~755 docs (SKUs grupo PESCA con ventas en los ultimos 13m).
Cada doc: ~1 KB. Total ~750 KB.
"""
import os
import sys
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY_PATH.read_text()

from sync_sap_to_bigquery import (  # noqa: E402
    parse_sa_json,
    init_firestore,
    init_bigquery,
    sync_sku_ventas_snapshot_to_firestore,
    _sanitize_sku_doc_id,
)

print('=' * 70)
print('Bootstrap sku_ventas_snapshot (BQ -> Firestore) - ventana 13m rolling')
print('=' * 70)

sa_data = parse_sa_json()
db = init_firestore(sa_data)
bq_client = init_bigquery(sa_data)

written = sync_sku_ventas_snapshot_to_firestore(bq_client, db, dry_run=False)
print(f'\n>>> DONE. {written} docs en sku_ventas_snapshot.')
print('    Modal FORECAST leera esta coleccion (admin-only via firestore.rules).')

# Verify: leer 1 doc de ejemplo (Stella 4000 FI si existe).
print()
print('=' * 70)
print('VERIFY: leer un doc de ejemplo de sku_ventas_snapshot')
print('=' * 70)
# Tratamos de leer un SKU comun; sino agarramos el primero.
candidate_skus = ['REEL4000FI', '037000C', '0270008']  # SKUs recurrentes de Stella
found = None
for sku in candidate_skus:
    doc_id = _sanitize_sku_doc_id(sku)
    doc = db.collection('sku_ventas_snapshot').document(doc_id).get()
    if doc.exists:
        found = (doc_id, doc.to_dict())
        break

if not found:
    # Fallback: primer doc de la coleccion.
    docs = list(db.collection('sku_ventas_snapshot').limit(1).stream())
    if docs:
        found = (docs[0].id, docs[0].to_dict())

if found:
    doc_id, d = found
    print(f'  doc_id:      {doc_id}')
    print(f'  sku:         {d.get("sku")}')
    print(f'  itemName:    {d.get("itemName")}')
    print(f'  familia:     {d.get("familia")}')
    print(f'  subfamilia:  {d.get("subfamilia")}')
    meses = d.get('meses') or {}
    print(f'  meses ({len(meses)}):')
    for k in sorted(meses.keys()):
        m = meses[k]
        print(f'    {k}: qty={m.get("qty"):>8.1f}  ars={m.get("ars"):>14,.2f}')
else:
    print('  (no se pudo leer ningun doc de ejemplo)')
