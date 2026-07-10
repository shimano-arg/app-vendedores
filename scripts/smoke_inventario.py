"""Smoke test de v_inventario y v_inventario_por_warehouse."""
import json
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

queries = [
    ('total items', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_inventario`'),
    ('items con stock', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_inventario` WHERE stock_actual > 0'),
    ('items con backorder', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_inventario` WHERE qty_backorder > 0'),
    ('items quebrados con demanda', "SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_inventario` WHERE estado_stock = 'QUEBRADO_CON_DEMANDA'"),
    ('valor total inventario a costo', 'SELECT ROUND(SUM(valor_inventario_costo_ars), 0) AS ars FROM `app-vendedores-shimano.shimano_app.v_inventario`'),
    ('valor total inventario a venta', 'SELECT ROUND(SUM(valor_inventario_venta_ars), 0) AS ars FROM `app-vendedores-shimano.shimano_app.v_inventario`'),
    ('distribucion estado_stock', """
        SELECT estado_stock, COUNT(*) AS n
        FROM `app-vendedores-shimano.shimano_app.v_inventario`
        GROUP BY estado_stock
        ORDER BY n DESC
    """),
    ('top 5 items por valor a costo', """
        SELECT item_code, item_name, stock_actual, cost_efectivo_ars,
               ROUND(valor_inventario_costo_ars, 0) AS valor_costo
        FROM `app-vendedores-shimano.shimano_app.v_inventario`
        WHERE valor_inventario_costo_ars > 0
        ORDER BY valor_inventario_costo_ars DESC
        LIMIT 5
    """),
    ('warehouses distintos', """
        SELECT warehouse_code, is_non_sales, COUNT(*) AS n_items,
               ROUND(SUM(stock_qty), 0) AS stock_total
        FROM `app-vendedores-shimano.shimano_app.v_inventario_por_warehouse`
        WHERE stock_qty > 0
        GROUP BY warehouse_code, is_non_sales
        ORDER BY warehouse_code
    """),
]

for label, q in queries:
    print(f'\n=== {label} ===')
    for row in client.query(q).result():
        print(dict(row))
