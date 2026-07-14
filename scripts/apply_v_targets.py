"""Aplica v_targets + corre las 3 verificaciones de aceptacion del user:
  a. SELECT * WHERE anio=2026 AND mes=7 -> Julio Gonzalo=57M en slp_code=50
  b. Ningun slp_code=49 ni NULL
  c. COUNT(*) = COUNT(DISTINCT CONCAT(slp_code,anio,mes)) - sin duplicados
"""
import json
import re
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
creds = service_account.Credentials.from_service_account_info(sa)
client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

VIEWS = (Path(__file__).resolve().parent.parent / 'bigquery' / 'views.sql').read_text(encoding='utf-8')
m = re.search(r'(CREATE OR REPLACE VIEW `[^`]+\.v_targets`[^;]+;)', VIEWS, re.DOTALL)
if not m:
    raise SystemExit('No encontre v_targets en views.sql')

print('[EXEC] CREATE OR REPLACE v_targets...')
client.query(m.group(1), location=BQ_LOCATION).result()
print('  OK\n')

TBL = 'app-vendedores-shimano.shimano_app'

print('=' * 70)
print('a) SELECT * FROM v_targets WHERE anio=2026 AND mes=7')
print('=' * 70)
r = list(client.query(f'SELECT * FROM `{TBL}.v_targets` WHERE anio=2026 AND mes=7 ORDER BY slp_code').result())
for row in r:
    d = dict(row.items())
    d['_sync_timestamp'] = str(d['_sync_timestamp'])[:19]
    print(f'  {d}')

# Chequear Gonzalo especifico
gonza = [row for row in r if dict(row.items())['slp_code'] == 50]
if gonza:
    g = dict(gonza[0].items())
    if g['target_ars'] == 57000000:
        print(f'  OK   Julio Gonzalo (slp_code=50) target_ars = 57.000.000')
    else:
        print(f'  FAIL Julio Gonzalo target_ars = {g["target_ars"]} (esperado 57000000)')
else:
    print('  FAIL no encuentro slp_code=50 en julio 2026')

print()
print('=' * 70)
print('b) Ningun slp_code=49 ni NULL')
print('=' * 70)
r = list(client.query(f'''
  SELECT
    COUNTIF(slp_code = 49) AS con_49,
    COUNTIF(slp_code IS NULL) AS con_null,
    COUNT(*) AS total
  FROM `{TBL}.v_targets`
''').result())
d = dict(r[0].items())
print(f'  {d}')
if d['con_49'] == 0 and d['con_null'] == 0:
    print('  OK   sin slp_code=49 y sin NULL')
else:
    print('  FAIL')

print()
print('=' * 70)
print('c) COUNT(*) == COUNT(DISTINCT CONCAT(slp_code,anio,mes)) - sin duplicados')
print('=' * 70)
r = list(client.query(f'''
  SELECT
    COUNT(*) AS n_total,
    COUNT(DISTINCT CONCAT(CAST(slp_code AS STRING), '_', CAST(anio AS STRING), '_', CAST(mes AS STRING))) AS n_unicos
  FROM `{TBL}.v_targets`
''').result())
d = dict(r[0].items())
print(f'  {d}')
if d['n_total'] == d['n_unicos']:
    print(f'  OK   {d["n_total"]} filas, {d["n_unicos"]} combinaciones unicas -> sin duplicados')
else:
    print('  FAIL')

# Bonus: schema real de la vista
print()
print('=' * 70)
print('SCHEMA de v_targets (columnas expuestas a PBI)')
print('=' * 70)
t = client.get_table(f'{TBL}.v_targets')
for f in t.schema:
    print(f'  {f.name:20}  {f.field_type}')
