"""Aplica v_facturas_sap sin lines_json (el string JSON gigante que hacia
colgar Power BI Desktop durante el refresh)."""
import json
import re
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'

sa_data = json.loads(SA_KEY_PATH.read_text())
creds = service_account.Credentials.from_service_account_info(sa_data)
client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

VIEWS_SQL = Path(__file__).resolve().parent.parent / 'bigquery' / 'views.sql'
raw = VIEWS_SQL.read_text(encoding='utf-8')

pattern = re.compile(
    r'(CREATE OR REPLACE VIEW `[^`]+\.v_facturas_sap`[^;]+;)',
    re.DOTALL,
)
m = pattern.search(raw)
if not m:
    raise SystemExit('No encontre CREATE OR REPLACE VIEW v_facturas_sap en views.sql')
sql = m.group(1)

print('[EXEC] Aplicando v_facturas_sap slim (sin lines_json)...')
client.query(sql, location=BQ_LOCATION).result()
print('  OK')

# Verificacion
print('\n--- verificaciones post-deploy ---')

r = list(client.query('SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_facturas_sap`').result())
print(f'v_facturas_sap filas: {r[0]["n"]}')

tbl = client.get_table('app-vendedores-shimano.shimano_app.v_facturas_sap')
cols = [f.name for f in tbl.schema]
print(f'v_facturas_sap columnas ({len(cols)}):')
for c in cols:
    print(f'  - {c}')
if 'lines_json' in cols:
    print('  !!! lines_json todavia presente')
else:
    print('\n  OK - lines_json fuera del schema (PBI VertiPaq no explota RAM)')
