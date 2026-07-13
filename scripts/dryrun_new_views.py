"""Dry-run los 3 CREATE OR REPLACE nuevos contra BigQuery.
No modifica el estado - solo valida sintaxis, tipos y referencias.

Si los 3 dry-run pasan, es seguro aplicar `redeploy_views.py` a prod.
"""
import json
import re
from pathlib import Path

from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'

with open(SA_KEY_PATH) as f:
    sa_data = json.load(f)
creds = service_account.Credentials.from_service_account_info(sa_data)
client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

VIEWS_SQL = Path(__file__).resolve().parents[1] / 'bigquery' / 'views.sql'
raw = VIEWS_SQL.read_text(encoding='utf-8')

# Extraer los CREATE OR REPLACE de las 3 vistas afectadas.
# El archivo tiene cada view separada por ';' final.
def extract_view(name, sql_text):
    # Match desde 'CREATE OR REPLACE VIEW ...`name`... AS' hasta el proximo ';' que no
    # este dentro de un string. Con SQL bien formado es suficiente el ';' terminal.
    pattern = re.compile(
        r'(CREATE OR REPLACE VIEW `[^`]+\.' + re.escape(name) + r'`[^;]+;)',
        re.DOTALL | re.IGNORECASE,
    )
    m = pattern.search(sql_text)
    if not m:
        raise RuntimeError(f'No encontre CREATE OR REPLACE VIEW para {name}')
    return m.group(1)

for view_name in ['v_sap_items_enriched', 'v_backorder_lineas', 'v_ventas_lineas', 'v_inventario']:
    print('=' * 70)
    print(f'>>> DRY-RUN {view_name}')
    print('-' * 70)
    try:
        view_sql = extract_view(view_name, raw)
        # Dry run: valida sintaxis, tipos, referencias, sin ejecutar
        job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        job = client.query(view_sql, job_config=job_config)
        print(f'  OK. Bytes procesados si se aplicara: {job.total_bytes_processed:,}')
    except Exception as e:
        # Truncar el error para no ensuciar la consola
        err_str = str(e)
        if len(err_str) > 800:
            err_str = err_str[:800] + '...'
        print(f'  FAIL: {err_str}')
    print()

# ATENCION: v_sap_items_enriched es dependencia de las otras 3. Como el
# dry-run no crea la vista fisicamente, las que dependen de ella se
# validan contra la version ACTUAL en BQ (que NO tiene is_in_master).
# Puede pasar que v_backorder_lineas dry-run falle con "no such field
# is_in_master" - eso es esperado y no significa que el SQL este mal.
# Confirmamos con un test independiente:
print('=' * 70)
print('>>> CHECK: el enriched nuevo devuelve la columna is_in_master')
print('-' * 70)
try:
    enriched_sql = extract_view('v_sap_items_enriched', raw)
    # Wrappealo como subquery para testear el schema
    check = enriched_sql.replace('CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_sap_items_enriched` AS', '', 1).rstrip(';')
    sample_sql = f'SELECT item_code, is_in_master, stock_total_sellable, familia_norm FROM ({check}) LIMIT 3'
    for row in client.query(sample_sql).result():
        print('  ', dict(row.items()))
    print('  OK - is_in_master presente en el schema.')
except Exception as e:
    print(f'  FAIL: {str(e)[:500]}')
