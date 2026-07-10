"""Debug: mirar sap_items_raw directo."""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
client = bigquery.Client(project='app-vendedores-shimano',
                        credentials=service_account.Credentials.from_service_account_info(sa),
                        location='southamerica-east1')

queries = [
    ('count sap_items_raw', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.sap_items_raw`'),
    ('count con stock>0', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.sap_items_raw` WHERE stock_total_sellable > 0'),
    ('count con stock_by_warehouse_json', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.sap_items_raw` WHERE stock_by_warehouse_json IS NOT NULL'),
    ('schema check', """
        SELECT column_name, data_type
        FROM `app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = 'sap_items_raw'
        ORDER BY ordinal_position
    """),
    ('sample 3 rows', """
        SELECT item_code, item_name, stock_total_sellable, price_pesca_ars, cost_avg_ars,
               SUBSTR(stock_by_warehouse_json, 1, 200) AS whs_json_head, cat, fam, sub
        FROM `app-vendedores-shimano.shimano_app.sap_items_raw`
        LIMIT 3
    """),
    ('items con precio', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.sap_items_raw` WHERE price_pesca_ars IS NOT NULL'),
    ('_sync_timestamp reciente', 'SELECT MAX(_sync_timestamp) AS ts FROM `app-vendedores-shimano.shimano_app.sap_items_raw`'),
]

for label, q in queries:
    print(f'\n=== {label} ===')
    for row in client.query(q).result():
        print(dict(row))
