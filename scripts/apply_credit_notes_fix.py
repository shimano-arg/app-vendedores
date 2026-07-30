"""Deploy fix Credit Notes (v367+, 2026-07-30):
1) Sync inicial de /b1s/v1/CreditNotes -> sap_credit_notes_raw en BQ.
2) CREATE OR REPLACE VIEW v_facturas_sap + v_ventas_lineas (con UNION ALL de CNs).
3) Verificacion: chequea que la NC RC 1810 (Ricardo Fabian Blanco, jul 2026)
   aparezca con doc_total negativo en v_facturas_sap.

Uso:
    python scripts/apply_credit_notes_fix.py

Bug fix: Santiago Esteban mostraba $29M facturado en jul 2026 cuando deberia
ser $18.9M. La NC RC 1810 por -$10.1M vivia en /b1s/v1/CreditNotes (endpoint
SAP separado), pero el pipeline solo sincronizaba /b1s/v1/Invoices -> las CNs
quedaban invisibles en BQ y no restaban.
"""
import json
import os
import re
import sys
import requests
from datetime import date, timedelta
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

# Set FIREBASE_SERVICE_ACCOUNT env var apuntando al sa-key.json local
# ANTES de importar el modulo (parse_sa_json la lee al importarse).
SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY_PATH.read_text()

# Importar helpers de sync + endpoint del SL.
from sync_sap_to_bigquery import (  # noqa: E402
    parse_sa_json,
    init_firestore,
    init_bigquery,
    get_sl_config,
    sl_login,
    sl_fetch_all,
    flatten_doc,
    load_to_bq,
    now_iso,
    env_int,
    env_bool,
    BQ_TABLE_CREDIT_NOTES,
    DEFAULT_HISTORY_MONTHS,
)

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
TBL = f'{BQ_PROJECT}.shimano_app'

sa = json.loads(SA_KEY_PATH.read_text())
creds = service_account.Credentials.from_service_account_info(sa)
bq = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

VIEWS_SQL = (SCRIPT_DIR.parent / 'bigquery' / 'views.sql').read_text(encoding='utf-8')


def extract_view_sql(views_sql: str, view_name: str) -> str:
    """Extrae el CREATE OR REPLACE VIEW completo de views.sql para 'view_name'.
    Robusto frente a `;` que aparezcan dentro de comentarios: busca desde el
    CREATE hasta el proximo CREATE OR REPLACE VIEW (o EOF), y toma hasta el
    ultimo `;` del chunk (el terminador real del statement)."""
    marker = f'CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.{view_name}`'
    start = views_sql.find(marker)
    if start < 0:
        raise SystemExit(f'No encontre {view_name} en views.sql (marker: {marker!r})')
    next_create = views_sql.find('CREATE OR REPLACE VIEW', start + 1)
    end = next_create if next_create > 0 else len(views_sql)
    chunk = views_sql[start:end]
    last_semi = chunk.rfind(';')
    if last_semi < 0:
        raise SystemExit(f'{view_name}: no encontre `;` terminador en el chunk')
    return chunk[:last_semi + 1]

# --- Paso 1: fetch de CreditNotes y cargar a BQ ---
print('=' * 70)
print('1) Fetch /b1s/v1/CreditNotes y cargar a sap_credit_notes_raw')
print('=' * 70)

sa_data = parse_sa_json()
sync_ts = now_iso()
sl_insecure = env_bool('SL_INSECURE')
max_docs = env_int('SL_MAX_DOCS', 0)
history_months = env_int('HISTORY_MONTHS', DEFAULT_HISTORY_MONTHS)

# Levantar sesion Service Layer siguiendo el mismo patron del script principal.
fs_db = init_firestore(sa_data)
cfg = get_sl_config(fs_db)
session = requests.Session()
session.verify = not sl_insecure
if sl_insecure:
    import urllib3
    from urllib3.exceptions import InsecureRequestWarning
    urllib3.disable_warnings(InsecureRequestWarning)
sl_login(cfg, session)

# Ventana igual a Invoices en el script principal.
today = date.today()
since = today - timedelta(days=history_months * 31)
since_iso_date = since.isoformat()

doc_select_invoices = [
    'DocEntry', 'DocNum', 'DocDate', 'DocDueDate',
    'DocumentStatus', 'Cancelled',
    'CardCode', 'CardName',
    'DocCurrency', 'DocTotal', 'DocTotalFc', 'DocRate',
    'PaidToDate',
    'DiscountPercent', 'TotalDiscount',
    'SalesPersonCode', 'Comments', 'JournalMemo',
    'PaymentGroupCode', 'Series',
    'CreationDate', 'UpdateDate',
    'DocumentLines',
]

cns = sl_fetch_all(
    cfg, session, '/b1s/v1/CreditNotes', 'CREDIT_NOTES',
    select_fields=doc_select_invoices,
    filter_expr=f"DocDate ge '{since_iso_date}'",
    max_docs=max_docs,
)
cn_rows = [flatten_doc(d, 'CREDIT_NOTE', sync_ts) for d in cns]

# Cargar. Si 0 rows, creamos igual la tabla vacia con schema explicito
# porque las vistas dependen de que exista.
if not cn_rows:
    print('  [WARN] 0 credit notes en la ventana. Creando tabla vacia con schema...')
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
        bigquery.SchemaField('discount_percent', 'FLOAT64'),
        bigquery.SchemaField('total_discount', 'FLOAT64'),
        bigquery.SchemaField('paid_to_date', 'FLOAT64'),
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
    tbl_ref = bigquery.Table(BQ_TABLE_CREDIT_NOTES, schema=schema)
    bq.create_table(tbl_ref, exists_ok=True)
    print(f'  OK: tabla {BQ_TABLE_CREDIT_NOTES} creada vacia')
else:
    load_to_bq(bq, BQ_TABLE_CREDIT_NOTES, cn_rows, 'CREDIT_NOTES', dry_run=False)
    print(f'  OK: {len(cn_rows)} credit notes cargadas a {BQ_TABLE_CREDIT_NOTES}')

# --- Paso 2: CREATE OR REPLACE VIEW v_facturas_sap ---
print()
print('=' * 70)
print('2) CREATE OR REPLACE VIEW v_facturas_sap (UNION Invoices + CreditNotes)')
print('=' * 70)
sql_v_facturas = extract_view_sql(VIEWS_SQL, 'v_facturas_sap')
print(f'  [debug] SQL capturado: {len(sql_v_facturas)} chars')
bq.query(sql_v_facturas, location=BQ_LOCATION).result()
print('  OK')

# --- Paso 3: CREATE OR REPLACE VIEW v_ventas_lineas ---
print()
print('=' * 70)
print('3) CREATE OR REPLACE VIEW v_ventas_lineas (UNION Invoices + CreditNotes)')
print('=' * 70)
sql_v_ventas = extract_view_sql(VIEWS_SQL, 'v_ventas_lineas')
print(f'  [debug] SQL capturado: {len(sql_v_ventas)} chars')
bq.query(sql_v_ventas, location=BQ_LOCATION).result()
print('  OK')

# --- Paso 4: Verificar que la NC RC 1810 esta con signo negativo ---
print()
print('=' * 70)
print('4) VERIFY: buscar Credit Notes de Ricardo Fabian Blanco (C20351155354) en jul 2026')
print('=' * 70)
res = list(bq.query(f'''
  SELECT doc_kind, doc_num, doc_date, card_code, card_name_invoice, doc_total, assigned_vendor
  FROM `{TBL}.v_facturas_sap`
  WHERE card_code = 'C20351155354'
    AND EXTRACT(YEAR FROM doc_date) = 2026
    AND EXTRACT(MONTH FROM doc_date) = 7
  ORDER BY doc_date
''').result())
if not res:
    print('  (sin resultados — verificar si el card_code o mes son correctos)')
else:
    for row in res:
        d = dict(row.items())
        print(f'  {d["doc_kind"]:12} doc_num={d["doc_num"]:>6} '
              f'fecha={d["doc_date"]} doc_total={d["doc_total"] or 0:>12.2f} '
              f'vendor={d["assigned_vendor"] or "(sin app)"} '
              f'card_name={d["card_name_invoice"] or ""}')

# --- Paso 5: SUM neto por vendedor para julio 2026 (deberia coincidir con SAP) ---
print()
print('=' * 70)
print('5) VERIFY: SUM doc_total NETO por vendedor para julio 2026')
print('=' * 70)
res = list(bq.query(f'''
  SELECT
    COALESCE(assigned_vendor, '(sin app)') AS vendor,
    COUNT(*) AS docs,
    SUM(doc_total) AS total_neto,
    SUM(CASE WHEN doc_kind = 'INVOICE' THEN doc_total ELSE 0 END) AS facturado_bruto,
    SUM(CASE WHEN doc_kind = 'CREDIT_NOTE' THEN doc_total ELSE 0 END) AS notas_credito
  FROM `{TBL}.v_facturas_sap`
  WHERE EXTRACT(YEAR FROM doc_date) = 2026
    AND EXTRACT(MONTH FROM doc_date) = 7
    AND COALESCE(cancelled, 'tNO') = 'tNO'
  GROUP BY vendor
  ORDER BY total_neto DESC
''').result())
for row in res:
    d = dict(row.items())
    print(f'  {d["vendor"]:30} docs={d["docs"]:>3} '
          f'facturado={d["facturado_bruto"] or 0:>14.2f} '
          f'NCs={d["notas_credito"] or 0:>14.2f} '
          f'NETO={d["total_neto"] or 0:>14.2f}')

print('\n>>> DONE. Refrescar Power BI para que las cards muestren el valor NETO.')
print('    Santiago Esteban jul 2026 debe pasar de ~$29M a ~$18.9M.')
