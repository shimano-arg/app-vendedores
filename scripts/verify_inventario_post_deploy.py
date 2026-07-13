"""Verificacion post-deploy: corre los 2 checks de aceptacion del user
directamente contra las vistas actualizadas en prod."""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
creds = service_account.Credentials.from_service_account_info(sa)
client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

TBL = 'app-vendedores-shimano.shimano_app'

checks = [
    ('(a) SKUs de v_backorder_lineas que NO estan en v_inventario - esperado 0',
        f'''SELECT COUNT(DISTINCT bo.sku) AS n
            FROM `{TBL}.v_backorder_lineas` bo
            WHERE bo.sku NOT IN (SELECT item_code FROM `{TBL}.v_inventario`)'''),

    ('(b) v_inventario: filas con stock_actual NULL - esperado 0',
        f'SELECT COUNT(*) AS n FROM `{TBL}.v_inventario` WHERE stock_actual IS NULL'),

    ('items totales en v_inventario ahora',
        f'SELECT COUNT(*) AS n FROM `{TBL}.v_inventario`'),

    ('breakdown is_in_master',
        f'''SELECT is_in_master, COUNT(*) AS n,
                   COUNTIF(stock_actual > 0) AS con_stock
            FROM `{TBL}.v_inventario` GROUP BY is_in_master ORDER BY is_in_master DESC'''),

    ('ARDTY300D ahora en v_inventario',
        f"SELECT item_code, item_name, familia, stock_actual, is_in_master FROM `{TBL}.v_inventario` WHERE item_code = 'ARDTY300D'"),

    ('ARDTY300D linea en v_backorder_lineas con stock_actual',
        f"SELECT sku, producto, familia, stock_actual, pendiente FROM `{TBL}.v_backorder_lineas` WHERE sku = 'ARDTY300D' LIMIT 3"),
]

for name, sql in checks:
    print('=' * 70)
    print(f'>>> {name}')
    print('-' * 70)
    for row in client.query(sql).result():
        print('  ', dict(row.items()))
    print()
