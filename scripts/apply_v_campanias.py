"""Aplica v_campanias_progreso + v_campanias_evolucion_diaria a BigQuery,
sincroniza la coleccion `campaigns` de Firestore a la tabla `campaigns_raw`
por primera vez (bootstrap), y corre verificaciones de aceptacion.

Uso:
    python scripts/apply_v_campanias.py

Prerequisitos:
    - ~/Desktop/sa-key.json con service account que tiene acceso a BQ +
      Firestore Read del proyecto app-vendedores-shimano.

Despues del bootstrap, el cron GH Actions `sync-sap-catalog-stock.yml`
mantiene `campaigns_raw` actualizada cada 30 min via sync_sap_to_bigquery.py
(sync_campaigns_from_firestore fue agregado en el mismo commit v367+).
"""
import json
import re
import sys
from pathlib import Path
from google.cloud import bigquery, firestore
from google.oauth2 import service_account

# Importar los helpers del script grande.
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from sync_sap_to_bigquery import (  # noqa: E402
    sync_campaigns_from_firestore,
    _load_to_bq_with_schema,
    BQ_TABLE_CAMPAIGNS,
    now_iso,
)

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
TBL = f'{BQ_PROJECT}.shimano_app'

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
creds = service_account.Credentials.from_service_account_info(sa)
bq = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)
fs = firestore.Client(project=BQ_PROJECT, credentials=creds)

VIEWS_SQL = (SCRIPT_DIR.parent / 'bigquery' / 'views.sql').read_text(encoding='utf-8')

# 1) Bootstrap: sync campaigns Firestore -> campaigns_raw BQ.
print('=' * 70)
print('1) Sync campaigns Firestore -> campaigns_raw BQ')
print('=' * 70)
schema = [
    bigquery.SchemaField('campaign_id', 'STRING'),
    bigquery.SchemaField('name', 'STRING'),
    bigquery.SchemaField('familia', 'STRING'),
    bigquery.SchemaField('subfamilia', 'STRING'),
    bigquery.SchemaField('skus_json', 'STRING'),
    bigquery.SchemaField('skus_count', 'INT64'),
    bigquery.SchemaField('target_type', 'STRING'),
    bigquery.SchemaField('target_amount', 'FLOAT64'),
    bigquery.SchemaField('start_date', 'DATE'),
    bigquery.SchemaField('end_date', 'DATE'),
    bigquery.SchemaField('scope', 'STRING'),
    bigquery.SchemaField('scope_values_json', 'STRING'),
    bigquery.SchemaField('created_by', 'STRING'),
    bigquery.SchemaField('created_by_email', 'STRING'),
    bigquery.SchemaField('created_at', 'TIMESTAMP'),
    bigquery.SchemaField('archived', 'BOOL'),
    bigquery.SchemaField('archived_at', 'TIMESTAMP'),
    bigquery.SchemaField('archived_by', 'STRING'),
    bigquery.SchemaField('_sync_timestamp', 'TIMESTAMP'),
]
# Bootstrap: crear tabla vacia primero (idempotente). Necesario porque
# _load_to_bq_with_schema skipea el create si rows=[] (Pablo puede no
# tener campanias cargadas todavia), y las vistas fallan sin la tabla.
tbl_ref = bigquery.Table(BQ_TABLE_CAMPAIGNS, schema=schema)
try:
    bq.create_table(tbl_ref, exists_ok=True)
    print(f'  OK: tabla {BQ_TABLE_CAMPAIGNS} existe (creada o pre-existente)')
except Exception as e:
    print(f'  FAIL creando tabla: {e}')
    raise
rows = sync_campaigns_from_firestore(fs, now_iso())
_load_to_bq_with_schema(bq, BQ_TABLE_CAMPAIGNS, rows, 'CAMPAIGNS', schema, dry_run=False)
print(f'  OK: {len(rows)} campanias cargadas a {BQ_TABLE_CAMPAIGNS}\n')

# 2) Aplicar v_campanias_progreso
print('=' * 70)
print('2) CREATE OR REPLACE VIEW v_campanias_progreso')
print('=' * 70)
m = re.search(r'(CREATE OR REPLACE VIEW `[^`]+\.v_campanias_progreso`[^;]+;)', VIEWS_SQL, re.DOTALL)
if not m:
    raise SystemExit('No encontre v_campanias_progreso en views.sql')
bq.query(m.group(1), location=BQ_LOCATION).result()
print('  OK\n')

# 3) Aplicar v_campanias_evolucion_diaria
print('=' * 70)
print('3) CREATE OR REPLACE VIEW v_campanias_evolucion_diaria')
print('=' * 70)
m = re.search(r'(CREATE OR REPLACE VIEW `[^`]+\.v_campanias_evolucion_diaria`[^;]+;)', VIEWS_SQL, re.DOTALL)
if not m:
    raise SystemExit('No encontre v_campanias_evolucion_diaria en views.sql')
bq.query(m.group(1), location=BQ_LOCATION).result()
print('  OK\n')

# 3b) Aplicar v_campanias_ventas_detalle (v368+: para matrices por vendedor/cliente/SKU)
print('=' * 70)
print('3b) CREATE OR REPLACE VIEW v_campanias_ventas_detalle')
print('=' * 70)
m = re.search(r'(CREATE OR REPLACE VIEW `[^`]+\.v_campanias_ventas_detalle`[^;]+;)', VIEWS_SQL, re.DOTALL)
if not m:
    raise SystemExit('No encontre v_campanias_ventas_detalle en views.sql')
bq.query(m.group(1), location=BQ_LOCATION).result()
print('  OK\n')

# 4) Verificacion: SELECT * de v_campanias_progreso
print('=' * 70)
print('4) SELECT * FROM v_campanias_progreso')
print('=' * 70)
res = list(bq.query(f'''
  SELECT campaign_id, name, familia, target_type, target_amount,
         realizado_qty, realizado_ars, pct_cumplimiento,
         dias_restantes, activa
  FROM `{TBL}.v_campanias_progreso`
  ORDER BY activa DESC, start_date DESC
''').result())
if not res:
    print('  (vacio - no hay campanias cargadas en Firestore aun)')
else:
    for row in res:
        d = dict(row.items())
        pct = d.get('pct_cumplimiento')
        pct_str = f'{pct:.1f}%' if pct is not None else '-'
        print(f'  {d["name"]:30} {d["target_type"]:5} target={d["target_amount"]:>10.0f} '
              f'realizado_qty={d["realizado_qty"]:>6.0f} realizado_ars={d["realizado_ars"]:>10.0f} '
              f'cumpl={pct_str:>7} dias_rest={d["dias_restantes"]:>3} activa={d["activa"]}')

# 5) Schema exposicion PBI
print()
print('=' * 70)
print('5) SCHEMA de v_campanias_progreso (columnas expuestas a Power BI)')
print('=' * 70)
t = bq.get_table(f'{TBL}.v_campanias_progreso')
for f in t.schema:
    print(f'  {f.name:24}  {f.field_type}')

print()
print('=' * 70)
print('6) SCHEMA de v_campanias_evolucion_diaria (columnas expuestas a PBI)')
print('=' * 70)
t = bq.get_table(f'{TBL}.v_campanias_evolucion_diaria')
for f in t.schema:
    print(f'  {f.name:24}  {f.field_type}')

print()
print('=' * 70)
print('7) SCHEMA de v_campanias_ventas_detalle (columnas expuestas a PBI)')
print('=' * 70)
t = bq.get_table(f'{TBL}.v_campanias_ventas_detalle')
for f in t.schema:
    print(f'  {f.name:24}  {f.field_type}')

print('\n>>> DONE. 3 vistas listas para consumir desde Power BI:')
print('    - v_campanias_progreso        (agregado por campania)')
print('    - v_campanias_evolucion_diaria (linea temporal acumulada)')
print('    - v_campanias_ventas_detalle   (detalle por venta para matrices)')
