"""Smoke test de v_ventas_lineas y v_backorder_detalle."""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
client = bigquery.Client(project='app-vendedores-shimano',
                        credentials=service_account.Credentials.from_service_account_info(sa),
                        location='southamerica-east1')

queries = [
    ('total lineas venta', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`'),
    ('lineas con item_code no null', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas` WHERE item_code IS NOT NULL'),
    ('rango de fechas', """
        SELECT MIN(doc_date) AS min_date, MAX(doc_date) AS max_date
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
    """),
    ('top 5 SKUs por unidades vendidas (ultimos 12m)', """
        SELECT item_code, MAX(item_name_catalogo) AS producto, MAX(familia) AS familia,
               ROUND(SUM(cantidad), 0) AS unidades_vendidas
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
        WHERE doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
          AND item_code IS NOT NULL
        GROUP BY item_code
        ORDER BY unidades_vendidas DESC
        LIMIT 5
    """),
    ('total lineas venta con familia', """
        SELECT COUNT(*) AS con_familia
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
        WHERE familia IS NOT NULL
    """),
    ('backorder rows', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_backorder_detalle`'),
    ('backorder por estado', """
        SELECT estado, COUNT(*) AS n_skus, ROUND(SUM(pendiente), 0) AS unidades
        FROM `app-vendedores-shimano.shimano_app.v_backorder_detalle`
        GROUP BY estado
    """),
    ('top 10 backorder', """
        SELECT sku, producto, familia, ROUND(pedido, 0) AS pedido,
               ROUND(pendiente, 0) AS pendiente, n_tiendas,
               prox_embarque_date, estado
        FROM `app-vendedores-shimano.shimano_app.v_backorder_detalle`
        ORDER BY pendiente DESC
        LIMIT 10
    """),
]

for label, q in queries:
    print(f'\n=== {label} ===')
    for row in client.query(q).result():
        print(dict(row))
