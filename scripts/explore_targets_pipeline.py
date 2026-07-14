"""Investigacion antes de crear v_targets:
(a) Ver si targets ya llega a BQ desde Firestore
(b) Ver donde vive el maestro de vendedores + validar el mapeo SlpCode
(c) Confirmar patron de v_pedidos_header para replicar en v_targets."""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
creds = service_account.Credentials.from_service_account_info(sa)
client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

# 1. Listar todas las tablas del dataset - buscar cualquier cosa con "target"
print('=' * 70)
print('1) TABLAS DEL DATASET shimano_app (busca *target*, *vendor*, *seller*)')
print('=' * 70)
dataset_ref = client.dataset(BQ_DATASET)
for tbl in client.list_tables(dataset_ref):
    name = tbl.table_id.lower()
    tag = ''
    if 'target' in name: tag = '   <-- TARGET'
    elif 'vendor' in name or 'seller' in name or 'slp' in name: tag = '   <-- VENDOR/SLP'
    elif 'bp' in name or 'sap_' in name: tag = '   (sap catalog)'
    print(f'  {tbl.table_type:5}  {tbl.table_id:45}{tag}')

# 2. Confirmar patron de las vistas v_pedidos_*
print()
print('=' * 70)
print('2) DEFINICIONES v_pedidos_header y v_visitas (para replicar patron)')
print('=' * 70)
for vname in ('v_pedidos_header', 'v_visitas'):
    try:
        t = client.get_table(f'{BQ_PROJECT}.{BQ_DATASET}.{vname}')
        print(f'\n--- {vname} ---')
        print(f'  columnas ({len(t.schema)}):')
        for f in t.schema:
            print(f'    {f.name:30}  {f.field_type}')
    except Exception as e:
        print(f'  ERROR {vname}: {e}')

# 3. Validar mapeo SlpCode contra sap_bp_raw
print()
print('=' * 70)
print('3) MAESTRO SlpCode desde sap_bp_raw (validar mapeo user)')
print('=' * 70)
# Los BPs tienen SalesPersonCode. Necesitamos algo tipo SalesEmployee.
# Chequeo si hay tabla dedicada a vendedores o si hay que extraerla de bp.
try:
    r = list(client.query(f'''
        SELECT DISTINCT sales_person_code, COUNT(*) AS n_bps
        FROM `{BQ_PROJECT}.{BQ_DATASET}.sap_bp_raw`
        WHERE sales_person_code IS NOT NULL AND sales_person_code >= 0
        GROUP BY sales_person_code
        ORDER BY sales_person_code
    ''').result())
    print('  sales_person_code distintos en sap_bp_raw:')
    for row in r:
        print(f'    slp_code={row["sales_person_code"]:>3}   ({row["n_bps"]} BPs asignados)')
except Exception as e:
    print(f'  ERROR: {e}')

# 4. Si existe tabla sap_vendors o similar
print()
print('=' * 70)
print('4) BUSQUEDA de tabla de vendedores (sap_vendors, sales_persons, etc)')
print('=' * 70)
for candidate in ('sap_vendors', 'sap_sales_persons', 'sales_employees',
                   'sap_slp', 'sap_sales_person_raw'):
    try:
        t = client.get_table(f'{BQ_PROJECT}.{BQ_DATASET}.{candidate}')
        print(f'  ENCONTRADA: {candidate} ({t.num_rows} filas)')
        for f in t.schema[:12]:
            print(f'    {f.name:30}  {f.field_type}')
    except Exception:
        pass  # tabla no existe, seguir

# 5. Buscar filas de sap_bp_raw asociadas a cada SlpCode para poner nombre
print()
print('=' * 70)
print('5) EJEMPLO de BP por SlpCode (para adivinar nombre del vendedor)')
print('=' * 70)
try:
    r = list(client.query(f'''
        SELECT sales_person_code, ANY_VALUE(card_name) AS sample_bp_name, COUNT(*) AS n
        FROM `{BQ_PROJECT}.{BQ_DATASET}.sap_bp_raw`
        WHERE sales_person_code BETWEEN 45 AND 60
        GROUP BY sales_person_code
        ORDER BY sales_person_code
    ''').result())
    print('  Muestra de nombres BPs por SlpCode (solo para hint - NO es el nombre del vendedor):')
    for row in r:
        print(f'    slp={row["sales_person_code"]:>3}  bp_sample={row["sample_bp_name"]:<40}  ({row["n"]} bps)')
except Exception as e:
    print(f'  ERROR: {e}')

# 6. Chequear si la Firestore Extension sincroniza targets a BQ
# La extension firestore-bigquery-export crea tablas con nombre <collection>_raw_changelog
print()
print('=' * 70)
print('6) FIRESTORE EXTENSION - existe targets_raw_changelog o similar?')
print('=' * 70)
for candidate in ('targets_raw_changelog', 'targets_raw_latest', 'targets',
                   'firestore_targets_raw_changelog'):
    try:
        t = client.get_table(f'{BQ_PROJECT}.{BQ_DATASET}.{candidate}')
        print(f'  ENCONTRADA: {candidate} ({t.num_rows} filas)')
        for f in t.schema[:15]:
            print(f'    {f.name:30}  {f.field_type}')
    except Exception:
        pass
print('  (si no aparece nada, targets NO se sincroniza a BQ - hay que crear pipeline)')
