"""Rollback quirurgico de v_inventario: vuelve a 755 filas + schema
identico al pre-fix (sin columna is_in_master). Power BI Desktop puede
refrescarla en incremental sin recomprimir VertiPaq desde cero.

Los otros consumers del enriched (v_backorder_lineas, v_ventas_lineas)
mantienen el fix: siguen mostrando SKUs BIKE con producto/familia/stock
poblados.
"""
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
    r'(CREATE OR REPLACE VIEW `[^`]+\.v_inventario`[^;]+;)',
    re.DOTALL,
)
m = pattern.search(raw)
if not m:
    raise SystemExit('No encontre CREATE OR REPLACE VIEW v_inventario en views.sql')
sql = m.group(1)

print('[EXEC] Aplicando rollback a v_inventario...')
client.query(sql, location=BQ_LOCATION).result()
print('  OK')

# Verificaciones
print('\n--- verificaciones post-rollback ---')

r = list(client.query('SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_inventario`').result())
n_inv = r[0]['n']
print(f'v_inventario filas: {n_inv} (esperado 755)')

# Confirmar que is_in_master NO esta en el schema
tbl = client.get_table('app-vendedores-shimano.shimano_app.v_inventario')
cols = [f.name for f in tbl.schema]
print(f'v_inventario columnas ({len(cols)}): {cols}')
if 'is_in_master' in cols:
    print('  !!! is_in_master TODAVIA presente - el rollback fallo')
else:
    print('  OK - is_in_master fuera del schema (Power BI ve el schema pre-fix)')

# Confirmar que v_backorder_lineas sigue mostrando huerfanos con datos
r2 = list(client.query('''
  SELECT is_pesca, COUNT(DISTINCT sku) AS n_skus, COUNTIF(stock_actual IS NULL) AS nulls_stock
  FROM `app-vendedores-shimano.shimano_app.v_backorder_lineas`
  GROUP BY is_pesca
  ORDER BY is_pesca DESC
''').result())
print('\nv_backorder_lineas breakdown:')
for row in r2:
    print(' ', dict(row))
print('(SKUs BIKE con is_pesca=False siguen siendo visibles con stock_actual=0)')
