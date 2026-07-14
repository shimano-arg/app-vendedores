"""Smoke test rapido de v_pedidos_lines y otras vistas afectadas por
'ADBC Error al enviar la solicitud'. Confirma que BQ prod responde OK
(el error real es del cliente PBI, no del server)."""
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

for view in ('v_pedidos_lines', 'v_pedidos_header', 'v_facturas_sap', 'v_visitas',
             'v_inventario', 'v_backorder_lineas', 'v_ventas_lineas', 'sap_items_raw'):
    try:
        r = list(client.query(f'SELECT COUNT(*) AS n FROM `{TBL}.{view}`').result())
        print(f'  OK   {view:30}  filas: {r[0]["n"]}')
    except Exception as e:
        print(f'  FAIL {view:30}  {str(e)[:120]}')
