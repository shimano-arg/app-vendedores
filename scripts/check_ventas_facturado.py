"""Ver si hay data facturada real en v_ventas_lineas para el treemap."""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
client = bigquery.Client(project='app-vendedores-shimano',
                        credentials=service_account.Credentials.from_service_account_info(sa),
                        location='southamerica-east1')

queries = [
    ('lineas con familia no-null vs total', """
        SELECT
          COUNT(*) AS total,
          COUNTIF(familia IS NOT NULL) AS con_familia,
          COUNTIF(importe_linea_ars > 0) AS con_importe,
          COUNTIF(familia IS NOT NULL AND importe_linea_ars > 0) AS con_ambos
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
    """),
    ('top 10 SKUs por unidades (todo Shimano)', """
        SELECT COALESCE(item_name_catalogo, item_code) AS producto,
               SUM(cantidad) AS unidades, is_pesca
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
        WHERE item_code IS NOT NULL
        GROUP BY producto, is_pesca
        ORDER BY unidades DESC
        LIMIT 10
    """),
    ('top 10 SKUs solo PESCA', """
        SELECT item_name_catalogo AS producto, familia,
               SUM(cantidad) AS unidades, ROUND(SUM(importe_linea_ars), 0) AS facturado
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
        WHERE is_pesca = TRUE
        GROUP BY producto, familia
        ORDER BY unidades DESC
        LIMIT 10
    """),
    ('facturado por familia PESCA', """
        SELECT familia, subfamilia,
               COUNT(*) AS lineas,
               ROUND(SUM(importe_linea_ars), 0) AS facturado
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
        WHERE is_pesca = TRUE
        GROUP BY familia, subfamilia
        ORDER BY facturado DESC
    """),
]
for label, q in queries:
    print(f'\n=== {label} ===')
    for row in client.query(q).result():
        print(dict(row))
