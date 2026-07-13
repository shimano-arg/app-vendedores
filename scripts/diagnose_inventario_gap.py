"""Diagnostico del gap entre v_inventario (755 items PESCA) y v_backorder_lineas
(1517 SKUs con demanda). Confirma la causa raiz (filtro ItemsGroupCode eq PESCA
en sync_sap_to_bigquery.py L631) y mide el universo real de item_codes que
aparecen en documentos SAP abiertos.

Corre solo consultas de LECTURA. No toca nada."""
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

TBL = 'app-vendedores-shimano.shimano_app'

queries = [
    ('items totales en sap_items_raw (PESCA solo)',
        f'SELECT COUNT(*) AS n FROM `{TBL}.sap_items_raw`'),

    ('items totales en v_inventario',
        f'SELECT COUNT(*) AS n FROM `{TBL}.v_inventario`'),

    ('items en v_inventario con stock > 0',
        f'SELECT COUNT(*) AS n FROM `{TBL}.v_inventario` WHERE stock_actual > 0'),

    ('items en v_inventario con stock = 0',
        f'SELECT COUNT(*) AS n FROM `{TBL}.v_inventario` WHERE stock_actual = 0'),

    ('SKUs distintos en v_backorder_lineas',
        f'SELECT COUNT(DISTINCT sku) AS n FROM `{TBL}.v_backorder_lineas`'),

    ('SKUs de backorder que SI estan en v_inventario',
        f'''SELECT COUNT(DISTINCT bo.sku) AS n
            FROM `{TBL}.v_backorder_lineas` bo
            WHERE bo.sku IN (SELECT item_code FROM `{TBL}.v_inventario`)'''),

    ('SKUs de backorder que NO estan en v_inventario (el gap)',
        f'''SELECT COUNT(DISTINCT bo.sku) AS n
            FROM `{TBL}.v_backorder_lineas` bo
            WHERE bo.sku NOT IN (SELECT item_code FROM `{TBL}.v_inventario`)'''),

    ('sample: 10 SKUs huerfanos con mas pendiente (para inspeccion visual)',
        f'''SELECT sku, ANY_VALUE(descripcion) AS descripcion,
                   SUM(pendiente) AS total_pendiente,
                   COUNT(*) AS lineas
            FROM `{TBL}.v_backorder_lineas` bo
            WHERE bo.sku NOT IN (SELECT item_code FROM `{TBL}.v_inventario`)
            GROUP BY sku
            ORDER BY total_pendiente DESC
            LIMIT 10'''),

    ('ARDTY300D esta en v_inventario?',
        f"SELECT COUNT(*) AS n FROM `{TBL}.v_inventario` WHERE item_code = 'ARDTY300D'"),

    ('ARDTY300D esta en v_backorder_lineas?',
        f'''SELECT sku, ANY_VALUE(descripcion) AS descripcion, SUM(pendiente) AS total_pendiente
            FROM `{TBL}.v_backorder_lineas` WHERE sku = 'ARDTY300D' GROUP BY sku'''),

    # Universo real de item_codes en documentos SAP abiertos (SQ + SO + PO)
    ('item_codes distintos en sap_quotations_raw (lineas open)',
        f'''SELECT COUNT(DISTINCT JSON_VALUE(line, '$.ItemCode')) AS n
            FROM `{TBL}.sap_quotations_raw` q,
                 UNNEST(JSON_EXTRACT_ARRAY(q.lines_json)) AS line
            WHERE q.document_status = 'bost_Open'
              AND COALESCE(q.cancelled, 'tNO') = 'tNO' '''),

    ('item_codes distintos en sap_orders_raw (lineas open)',
        f'''SELECT COUNT(DISTINCT JSON_VALUE(line, '$.ItemCode')) AS n
            FROM `{TBL}.sap_orders_raw` o,
                 UNNEST(JSON_EXTRACT_ARRAY(o.lines_json)) AS line
            WHERE o.document_status = 'bost_Open'
              AND COALESCE(o.cancelled, 'tNO') = 'tNO' '''),

    ('item_codes distintos en sap_purchase_orders_raw (lineas open)',
        f'''SELECT COUNT(DISTINCT JSON_VALUE(line, '$.ItemCode')) AS n
            FROM `{TBL}.sap_purchase_orders_raw` po,
                 UNNEST(JSON_EXTRACT_ARRAY(po.lines_json)) AS line
            WHERE po.document_status = 'bost_Open'
              AND COALESCE(po.cancelled, 'tNO') = 'tNO' '''),

    ('item_codes distintos en sap_invoices_raw (facturas emitidas)',
        f'''SELECT COUNT(DISTINCT JSON_VALUE(line, '$.ItemCode')) AS n
            FROM `{TBL}.sap_invoices_raw` inv,
                 UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS line'''),

    # UNIVERSO CANDIDATO: union de todos los item_codes que aparecen en algun lado
    ('UNIVERSO: item_codes distintos combinando maestro + docs abiertos + facturas',
        f'''WITH universo AS (
              SELECT item_code AS ic FROM `{TBL}.sap_items_raw`
              UNION DISTINCT
              SELECT JSON_VALUE(line, '$.ItemCode')
              FROM `{TBL}.sap_quotations_raw` q,
                   UNNEST(JSON_EXTRACT_ARRAY(q.lines_json)) AS line
              WHERE q.document_status = 'bost_Open' AND COALESCE(q.cancelled, 'tNO') = 'tNO'
              UNION DISTINCT
              SELECT JSON_VALUE(line, '$.ItemCode')
              FROM `{TBL}.sap_orders_raw` o,
                   UNNEST(JSON_EXTRACT_ARRAY(o.lines_json)) AS line
              WHERE o.document_status = 'bost_Open' AND COALESCE(o.cancelled, 'tNO') = 'tNO'
              UNION DISTINCT
              SELECT JSON_VALUE(line, '$.ItemCode')
              FROM `{TBL}.sap_purchase_orders_raw` po,
                   UNNEST(JSON_EXTRACT_ARRAY(po.lines_json)) AS line
              WHERE po.document_status = 'bost_Open' AND COALESCE(po.cancelled, 'tNO') = 'tNO'
              UNION DISTINCT
              SELECT JSON_VALUE(line, '$.ItemCode')
              FROM `{TBL}.sap_invoices_raw` inv,
                   UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS line
            )
            SELECT COUNT(*) AS n FROM universo WHERE ic IS NOT NULL AND ic != '' '''),
]

for name, sql in queries:
    print('=' * 70)
    print(f'>>> {name}')
    print('-' * 70)
    try:
        rows = list(client.query(sql).result())
        for r in rows:
            d = dict(r.items())
            print('  ', d)
    except Exception as e:
        print('  ERROR:', e)
    print()
