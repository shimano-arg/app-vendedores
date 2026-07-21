"""Sync ligero que SOLO actualiza sap_invoices_raw (para desbloquear el
campo paid_to_date sin re-cargar BP/Items/Quotations/Orders/PO).

Uso local. Chunkea el upload a BQ para no explotar la memoria del cliente
como paso con el sync full en Windows 10 con 8GB RAM.
"""
import json
import os
import sys
from io import BytesIO
from pathlib import Path
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import bigquery
from google.oauth2 import service_account
import requests

# ============================================================
# Config
# ============================================================
BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
BQ_TABLE = f'{BQ_PROJECT}.{BQ_DATASET}.sap_invoices_raw'

# 12 meses de historia (mismo cutoff que el sync grande)
HISTORY_DAYS = 365

# Cuantas facturas cargar a BQ por batch (evita quedarnos sin memoria)
BQ_UPLOAD_CHUNK = 500

# ============================================================
# Auth
# ============================================================
SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
sa_data = json.loads(SA_KEY_PATH.read_text())

if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(sa_data))
fs_db = firestore.client()

bq_creds = service_account.Credentials.from_service_account_info(sa_data)
bq_client = bigquery.Client(project=BQ_PROJECT, credentials=bq_creds, location=BQ_LOCATION)

# ============================================================
# Config SAP SL
# ============================================================
snap = fs_db.collection('app_config').document('sap_integration').get()
sl = (snap.to_dict() or {}).get('serviceLayer') or {}
cfg = {
    'url': sl['url'].rstrip('/'),
    'companyDB': sl['companyDB'],
    'username': sl['username'],
    'password': sl['password'],
}
print(f'[cfg] SL={cfg["url"]}  DB={cfg["companyDB"]}')

session = requests.Session()
resp = session.post(
    f"{cfg['url']}/b1s/v1/Login",
    json={'CompanyDB': cfg['companyDB'], 'UserName': cfg['username'], 'Password': cfg['password']},
    timeout=30,
)
if not resp.ok:
    print(f'[FATAL] Login fail: {resp.status_code}')
    sys.exit(1)
print('[SL] login OK')

# ============================================================
# Traer invoices con paginacion
# ============================================================
since_date = (datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)).strftime('%Y-%m-%d')
sync_ts = datetime.now(timezone.utc).isoformat()

# Fields SIN DocumentLines para bajar el peso ~10x. No los necesitamos
# para el KPI de deuda por vendedor (que solo mira header + PaidToDate).
# El script grande sigue trayendo las lines para las otras vistas.
fields = [
    'DocEntry', 'DocNum', 'DocDate', 'DocDueDate',
    'DocumentStatus', 'Cancelled',
    'CardCode', 'CardName',
    'DocCurrency', 'DocTotal', 'DocTotalFc', 'DocRate',
    'PaidToDate',
    'DiscountPercent', 'TotalDiscount',
    'SalesPersonCode', 'Comments', 'JournalMemo',
    'PaymentGroupCode', 'Series',
    'CreationDate', 'UpdateDate',
]

# Filtro: TODAS las abiertas (sin importar antiguedad) + las cerradas del
# ultimo ano. La deuda vieja (facturas de 2023 que siguen sin cobrarse)
# tiene que aparecer. Segun el diagnostico, son solo 66 facturas open
# en total, cero riesgo de volumen.
filter_expr = f"DocumentStatus eq 'bost_Open' or DocDate ge '{since_date}'"
path = (f"/b1s/v1/Invoices"
        f"?$select={','.join(fields)}"
        f"&$filter={filter_expr}")

print(f'[SL] fetching invoices: TODAS las abiertas + cerradas desde {since_date}...')
all_rows = []
page = 0
next_url = f"{cfg['url']}{path}"
while next_url:
    r = session.get(next_url, timeout=60)
    if not r.ok:
        print(f'[FAIL] pag {page}: HTTP {r.status_code} - {r.text[:200]}')
        break
    body = r.json()
    batch = body.get('value', [])
    # Flatten inmediatamente para no acumular objetos grandes en memoria
    for inv in batch:
        all_rows.append({
            'doc_type': 'INVOICE',
            'doc_entry': inv.get('DocEntry'),
            'doc_num': inv.get('DocNum'),
            'doc_date': inv.get('DocDate'),
            'doc_due_date': inv.get('DocDueDate'),
            'document_status': inv.get('DocumentStatus'),
            'cancelled': inv.get('Cancelled'),
            'card_code': inv.get('CardCode'),
            'card_name': inv.get('CardName'),
            'doc_currency': inv.get('DocCurrency'),
            'doc_total': inv.get('DocTotal'),
            'doc_total_fc': inv.get('DocTotalFc'),
            'doc_rate': inv.get('DocRate'),
            'paid_to_date': inv.get('PaidToDate'),
            'discount_percent': inv.get('DiscountPercent'),
            'total_discount': inv.get('TotalDiscount'),
            'sales_person_code': inv.get('SalesPersonCode'),
            'comments': inv.get('Comments'),
            'jrnl_memo': inv.get('JournalMemo'),
            'payment_group_code': inv.get('PaymentGroupCode'),
            'series': inv.get('Series'),
            'create_date': inv.get('CreationDate'),
            'update_date': inv.get('UpdateDate'),
            'lines_count': 0,      # este sync no trae lines (rapido)
            'lines_json': None,
            '_sync_timestamp': sync_ts,
        })
    page += 1
    print(f'  pag {page}: {len(all_rows)} facturas acumuladas')
    nlink = body.get('@odata.nextLink') or body.get('odata.nextLink')
    if not nlink:
        break
    if nlink.startswith('http'):
        next_url = nlink
    elif nlink.startswith('/'):
        next_url = f"{cfg['url']}{nlink}"
    else:
        next_url = f"{cfg['url']}/b1s/v1/{nlink}"
    if page > 500:
        print('[safety] 500 pags reached, cortando')
        break

print(f'\n[SL] TOTAL: {len(all_rows)} facturas')

session.post(f"{cfg['url']}/b1s/v1/Logout")

if not all_rows:
    print('[warn] sin filas, no toco BQ')
    sys.exit(0)

# ============================================================
# WRITE_TRUNCATE con schema explicito
# ============================================================
# Escribimos en 1 solo job con schema explicito (mas seguro que autodetect,
# no queremos que un valor null cambie el tipo esperado).
schema = [
    bigquery.SchemaField('doc_type', 'STRING'),
    bigquery.SchemaField('doc_entry', 'INT64'),
    bigquery.SchemaField('doc_num', 'INT64'),
    bigquery.SchemaField('doc_date', 'DATE'),
    bigquery.SchemaField('doc_due_date', 'DATE'),
    bigquery.SchemaField('document_status', 'STRING'),
    bigquery.SchemaField('cancelled', 'STRING'),
    bigquery.SchemaField('card_code', 'STRING'),
    bigquery.SchemaField('card_name', 'STRING'),
    bigquery.SchemaField('doc_currency', 'STRING'),
    bigquery.SchemaField('doc_total', 'FLOAT64'),
    bigquery.SchemaField('doc_total_fc', 'FLOAT64'),
    bigquery.SchemaField('doc_rate', 'FLOAT64'),
    bigquery.SchemaField('paid_to_date', 'FLOAT64'),
    bigquery.SchemaField('discount_percent', 'FLOAT64'),
    bigquery.SchemaField('total_discount', 'FLOAT64'),
    bigquery.SchemaField('sales_person_code', 'INT64'),
    bigquery.SchemaField('comments', 'STRING'),
    bigquery.SchemaField('jrnl_memo', 'STRING'),
    bigquery.SchemaField('payment_group_code', 'INT64'),
    bigquery.SchemaField('series', 'INT64'),
    bigquery.SchemaField('create_date', 'DATE'),
    bigquery.SchemaField('update_date', 'DATE'),
    bigquery.SchemaField('lines_count', 'INT64'),
    bigquery.SchemaField('lines_json', 'STRING'),
    bigquery.SchemaField('_sync_timestamp', 'TIMESTAMP'),
]

job_config = bigquery.LoadJobConfig(
    write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    schema=schema,
)

# Buffer NDJSON linea por linea, no cargamos todo el string a la vez.
print(f'[BQ] escribiendo {len(all_rows)} filas a {BQ_TABLE}...')
buf = BytesIO()
for row in all_rows:
    buf.write((json.dumps(row, default=str) + '\n').encode('utf-8'))
buf.seek(0)

job = bq_client.load_table_from_file(buf, BQ_TABLE, location=BQ_LOCATION, job_config=job_config)
job.result()

dest = bq_client.get_table(BQ_TABLE)
print(f'[BQ] OK: {dest.num_rows} rows en {BQ_TABLE}')
print('\nDONE')
