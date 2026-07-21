"""One-off: agrega paid_to_date a sap_invoices_raw SIN pisar lines_json.

Contexto: el sync grande (sync_sap_to_bigquery.py) usa autodetect=True al
cargar a BQ. Como paid_to_date viene null para la mayoria de facturas
cerradas, autodetect dropea la columna. Este parche la agrega y la
puebla sin tocar el resto del schema.

Fix permanente: agregar schema explicito al sync grande. TODO.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import firebase_admin
import requests
from firebase_admin import credentials, firestore
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
TBL_MAIN = f'{BQ_PROJECT}.{BQ_DATASET}.sap_invoices_raw'
TBL_STAGE = f'{BQ_PROJECT}.{BQ_DATASET}.sap_invoices_paid_stage'
HISTORY_DAYS = 365

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(sa))
fs = firestore.client()
creds = service_account.Credentials.from_service_account_info(sa)
bq = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

# SL config desde Firestore
snap = fs.collection('app_config').document('sap_integration').get()
sl = (snap.to_dict() or {}).get('serviceLayer') or {}
url = sl['url'].rstrip('/')
sess = requests.Session()
r = sess.post(f'{url}/b1s/v1/Login', json={
    'CompanyDB': sl['companyDB'],
    'UserName': sl['username'],
    'Password': sl['password'],
}, timeout=30)
if not r.ok:
    print(f'[FATAL] login: {r.status_code} {r.text[:200]}')
    sys.exit(1)
print(f'[SL] login OK ({sl["companyDB"]})')

# Fetch minimo: solo DocEntry + PaidToDate (todas abiertas + cerradas ultimo año)
since = (datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)).strftime('%Y-%m-%d')
filter_ = f"DocumentStatus eq 'bost_Open' or DocDate ge '{since}'"
path = f"/b1s/v1/Invoices?$select=DocEntry,PaidToDate&$filter={filter_}"
next_url = f'{url}{path}'
rows = []
page = 0
while next_url:
    resp = sess.get(next_url, timeout=60)
    if not resp.ok:
        print(f'[FAIL] pag {page}: {resp.status_code} {resp.text[:200]}')
        break
    body = resp.json()
    for inv in body.get('value', []):
        rows.append({
            'doc_entry': inv.get('DocEntry'),
            'paid_to_date': inv.get('PaidToDate') or 0.0,
        })
    page += 1
    if page % 10 == 0:
        print(f'  pag {page}: {len(rows)} facturas')
    nl = body.get('@odata.nextLink') or body.get('odata.nextLink')
    if not nl:
        break
    if nl.startswith('http'):
        next_url = nl
    elif nl.startswith('/'):
        next_url = f'{url}{nl}'
    else:
        next_url = f'{url}/b1s/v1/{nl}'

print(f'[SL] total: {len(rows)} facturas')
sess.post(f'{url}/b1s/v1/Logout')

if not rows:
    print('[warn] sin filas, no toco BQ')
    sys.exit(0)

# 1. ALTER TABLE: agregar columna si no existe
print('[BQ] ALTER TABLE ADD COLUMN paid_to_date FLOAT64...')
bq.query(f'ALTER TABLE `{TBL_MAIN}` ADD COLUMN IF NOT EXISTS paid_to_date FLOAT64').result()
print('  OK')

# 2. Load staging con schema explicito
print(f'[BQ] cargando {len(rows)} rows a staging...')
schema = [
    bigquery.SchemaField('doc_entry', 'INT64'),
    bigquery.SchemaField('paid_to_date', 'FLOAT64'),
]
jc = bigquery.LoadJobConfig(
    write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    schema=schema,
)
buf = BytesIO()
for r_ in rows:
    buf.write((json.dumps(r_) + '\n').encode('utf-8'))
buf.seek(0)
bq.load_table_from_file(buf, TBL_STAGE, location=BQ_LOCATION, job_config=jc).result()
print('  OK')

# 3. UPDATE
print('[BQ] UPDATE sap_invoices_raw.paid_to_date desde staging...')
job = bq.query(f'''
UPDATE `{TBL_MAIN}` T
SET paid_to_date = S.paid_to_date
FROM `{TBL_STAGE}` S
WHERE T.doc_entry = S.doc_entry
''')
job.result()
print(f'  OK: {job.num_dml_affected_rows} filas actualizadas')

# 4. Drop staging
print('[BQ] DROP staging...')
bq.query(f'DROP TABLE `{TBL_STAGE}`').result()
print('  OK')

# 5. Verificaciones
print()
print('=== VERIFICACIONES ===')
r = list(bq.query(f'''
    SELECT
      COUNT(*) AS total,
      COUNTIF(paid_to_date IS NOT NULL) AS n_with_paid,
      COUNTIF(lines_json IS NOT NULL) AS n_with_lines,
      ROUND(SUM(doc_total - COALESCE(paid_to_date, 0)), 0) AS saldo_total
    FROM `{TBL_MAIN}`
    WHERE document_status = 'bost_Open' AND cancelled = 'tNO'
''').result())
r = r[0]
print(f'  total open: {r.total}')
print(f'  con paid_to_date: {r.n_with_paid}')
print(f'  con lines_json: {r.n_with_lines}')
print(f'  saldo total open: ${r.saldo_total:,.0f}')

print()
print('DONE')
