"""Ver que SKUs PESCA facturaron con familia='' (sin match con catalogo)."""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
client = bigquery.Client(project='app-vendedores-shimano',
                        credentials=service_account.Credentials.from_service_account_info(sa),
                        location='southamerica-east1')

q = """
SELECT item_code,
       ANY_VALUE(item_name_catalogo) AS name_catalogo,
       SUM(cantidad) AS unidades,
       ROUND(SUM(importe_linea_ars), 0) AS facturado,
       COUNT(*) AS lineas
FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
WHERE is_pesca = TRUE
  AND (familia IS NULL OR familia = '')
GROUP BY item_code
ORDER BY facturado DESC
"""
print('=== SKUs PESCA facturados sin familia ===')
for row in client.query(q).result():
    print(dict(row))
