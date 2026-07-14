"""Sync inicial de la coleccion `targets` de Firestore a BQ.

Se llama para bootstrap. Despues el cron del workflow existente incluye
esta misma funcion como parte de sync_sap_to_bigquery.py."""
import json
import sys
from pathlib import Path
from io import BytesIO
from datetime import datetime, timezone

# Reutilizamos la logica del sync principal
sys.path.insert(0, str(Path(__file__).resolve().parent))
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
BQ_TABLE_TARGETS = f'{BQ_PROJECT}.{BQ_DATASET}.targets_raw'

SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
sa_data = json.loads(SA_KEY.read_text())
if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(sa_data))
fs_db = firestore.client()

bq_creds = service_account.Credentials.from_service_account_info(sa_data)
bq_client = bigquery.Client(project=BQ_PROJECT, credentials=bq_creds, location=BQ_LOCATION)

sync_ts = datetime.now(timezone.utc).isoformat()

# ---- 1. leer targets de Firestore ----
rows = []
for d in fs_db.collection('targets').stream():
    data = d.to_dict() or {}
    try:
        target = float(data.get('targetArs', 0) or 0)
    except (TypeError, ValueError):
        continue
    if target <= 0:
        continue
    updated_at = data.get('updatedAt')
    rows.append({
        'doc_id':           d.id,
        'seller_id':        data.get('sellerId', ''),
        'year':             int(data.get('year', 0) or 0),
        'month':            int(data.get('month', -1)),
        'target_ars':       target,
        'updated_at':       updated_at.isoformat() if updated_at else None,
        'updated_by':       data.get('updatedBy', ''),
        'updated_by_email': data.get('updatedByEmail', ''),
        '_sync_timestamp':  sync_ts,
    })
print(f'[TARGETS] {len(rows)} rows validas (target > 0)')
for r in rows:
    print(f'  {r["doc_id"]:35}  seller={r["seller_id"]:22} y={r["year"]} m={r["month"]:>2} target={r["target_ars"]:>13}')

# ---- 2. escribir a BQ (WRITE_TRUNCATE) ----
if not rows:
    print('sin filas, skip load')
    sys.exit(0)

# Schema explicito para no depender del autodetect (schema estable
# facilita cambios futuros y evita que 1 fila con NULL cambie el tipo).
schema = [
    bigquery.SchemaField('doc_id', 'STRING'),
    bigquery.SchemaField('seller_id', 'STRING'),
    bigquery.SchemaField('year', 'INT64'),
    bigquery.SchemaField('month', 'INT64'),
    bigquery.SchemaField('target_ars', 'FLOAT64'),
    bigquery.SchemaField('updated_at', 'TIMESTAMP'),
    bigquery.SchemaField('updated_by', 'STRING'),
    bigquery.SchemaField('updated_by_email', 'STRING'),
    bigquery.SchemaField('_sync_timestamp', 'TIMESTAMP'),
]

job_config = bigquery.LoadJobConfig(
    write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    schema=schema,
)
ndjson = '\n'.join(json.dumps(r, default=str) for r in rows).encode('utf-8')
job = bq_client.load_table_from_file(BytesIO(ndjson), BQ_TABLE_TARGETS, location=BQ_LOCATION, job_config=job_config)
job.result()
dest = bq_client.get_table(BQ_TABLE_TARGETS)
print(f'\n[BQ/TARGETS] OK: {dest.num_rows} rows en {BQ_TABLE_TARGETS}')
