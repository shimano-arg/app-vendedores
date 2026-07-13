"""Drop v_backorder_detalle vieja + redeploy views 5-8 nuevas."""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
creds = service_account.Credentials.from_service_account_info(sa)
client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

# Drop la view vieja (v_backorder_detalle) - reemplazada por v_backorder_lineas
print('[DROP] v_backorder_detalle (reemplazada por v_backorder_lineas)')
try:
    client.query('DROP VIEW IF EXISTS `app-vendedores-shimano.shimano_app.v_backorder_detalle`',
                 location=BQ_LOCATION).result()
    print('  OK')
except Exception as e:
    print(f'  WARN: {e}')

# Redeploy 5-8
sql = (Path(__file__).resolve().parent.parent / 'bigquery' / 'views.sql').read_text(encoding='utf-8')
parts = sql.split('-- View ')
for part in parts:
    if part[:2] in ('4-', '5:', '6:', '7:', '8:'):
        title = part.split(':', 1)[1].strip().splitlines()[0].strip()
        idx = part.find('CREATE OR REPLACE VIEW')
        if idx < 0:
            continue
        body = part[idx:]
        end = body.rfind(';')
        if end > 0:
            body = body[:end + 1]
        print(f'\n[EXEC] {title}')
        client.query(body, location=BQ_LOCATION).result()
        print('  OK')

# Smoke
print('\n\n=== SMOKE v_backorder_lineas ===')
smoke = [
    ('total lineas backorder', 'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.v_backorder_lineas`'),
    ('lineas is_pesca', """
        SELECT is_pesca, COUNT(*) AS n_lineas,
               COUNT(DISTINCT sku) AS n_skus,
               COUNT(DISTINCT cliente_code) AS n_clientes,
               ROUND(SUM(pendiente), 0) AS pendiente_total
        FROM `app-vendedores-shimano.shimano_app.v_backorder_lineas`
        GROUP BY is_pesca
    """),
    ('top 5 backorder PESCA con cliente', """
        SELECT sku, producto, familia, ROUND(pendiente, 0) AS pendiente,
               cliente_code, cliente_nombre, prox_embarque_date, estado
        FROM `app-vendedores-shimano.shimano_app.v_backorder_lineas`
        WHERE is_pesca = TRUE
        ORDER BY pendiente DESC
        LIMIT 5
    """),
    ('top 5 backorder Shimano completa (bike+pesca)', """
        SELECT sku, producto, familia, ROUND(pendiente, 0) AS pendiente,
               cliente_code, cliente_nombre, prox_embarque_date, estado
        FROM `app-vendedores-shimano.shimano_app.v_backorder_lineas`
        ORDER BY pendiente DESC
        LIMIT 5
    """),
]
for label, q in smoke:
    print(f'\n--- {label} ---')
    for row in client.query(q).result():
        print(dict(row))
