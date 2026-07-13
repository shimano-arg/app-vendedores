"""Prueba en DRY-RUN la fix de v_sap_items_enriched.

En vez de tocar la vista en produccion, la ejecutamos como CTE inline y
comparamos:
  - COUNT de v_inventario ANTES vs DESPUES
  - COUNT DISTINCT sku de backorder que quedan huerfanos ANTES vs DESPUES
  - stock_actual NULL vs 0 en la nueva version

Si los numeros son razonables, entonces si aplicamos el CREATE OR REPLACE.
"""
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

# ============================================================
# NUEVA v_sap_items_enriched (propuesta)
# ============================================================
# Diseno:
# 1) CTE `universo_docs` = item_codes de SQ + SO + PO open (los que puede
#    referenciar v_backorder_lineas hoy). NO incluye sap_invoices_raw
#    porque son SKUs historicos que ya no venden mas y solo inflarian
#    v_inventario con ruido.
# 2) CTE `all_codes` = maestro sap_items_raw UNION universo_docs.
# 3) CTE `orphan_names` = mejor esfuerzo para item_name de huerfanos:
#    ultima descripcion vista en SQ / SO / PO (por doc_date desc).
# 4) SELECT final = LEFT JOIN sap_items_raw + orphan_names + logica
#    familia_norm existente + COALESCE stock=0.
#
# Naming preservado: mismos nombres y tipos de columnas que la version
# actual (item_code, item_name, foreign_name, cat, fam, sub, valid,
# frozen, stock_total_sellable, stock_by_warehouse_json, price_pesca_ars,
# cost_avg_ars, cost_last_purchase_ars, familia_norm, _sync_timestamp).
NEW_ENRICHED_CTE = f'''
WITH universo_docs AS (
  SELECT JSON_VALUE(line, '$.ItemCode') AS item_code
  FROM `{TBL}.sap_quotations_raw` q, UNNEST(JSON_EXTRACT_ARRAY(q.lines_json)) AS line
  WHERE q.document_status = 'bost_Open' AND COALESCE(q.cancelled, 'tNO') = 'tNO'
  UNION DISTINCT
  SELECT JSON_VALUE(line, '$.ItemCode')
  FROM `{TBL}.sap_orders_raw` o, UNNEST(JSON_EXTRACT_ARRAY(o.lines_json)) AS line
  WHERE o.document_status = 'bost_Open' AND COALESCE(o.cancelled, 'tNO') = 'tNO'
  UNION DISTINCT
  SELECT JSON_VALUE(line, '$.ItemCode')
  FROM `{TBL}.sap_purchase_orders_raw` po, UNNEST(JSON_EXTRACT_ARRAY(po.lines_json)) AS line
  WHERE po.document_status = 'bost_Open' AND COALESCE(po.cancelled, 'tNO') = 'tNO'
),
all_codes AS (
  SELECT item_code FROM `{TBL}.sap_items_raw` WHERE item_code IS NOT NULL AND item_code != ''
  UNION DISTINCT
  SELECT item_code FROM universo_docs WHERE item_code IS NOT NULL AND item_code != ''
),
orphan_names_src AS (
  -- SQ lines
  SELECT
    JSON_VALUE(line, '$.ItemCode') AS item_code,
    JSON_VALUE(line, '$.ItemDescription') AS item_name,
    q.doc_date AS ranked_date
  FROM `{TBL}.sap_quotations_raw` q, UNNEST(JSON_EXTRACT_ARRAY(q.lines_json)) AS line
  WHERE q.document_status = 'bost_Open' AND COALESCE(q.cancelled, 'tNO') = 'tNO'
  UNION ALL
  -- SO lines
  SELECT
    JSON_VALUE(line, '$.ItemCode'),
    JSON_VALUE(line, '$.ItemDescription'),
    o.doc_date
  FROM `{TBL}.sap_orders_raw` o, UNNEST(JSON_EXTRACT_ARRAY(o.lines_json)) AS line
  WHERE o.document_status = 'bost_Open' AND COALESCE(o.cancelled, 'tNO') = 'tNO'
  UNION ALL
  -- PO lines
  SELECT
    JSON_VALUE(line, '$.ItemCode'),
    JSON_VALUE(line, '$.ItemDescription'),
    po.doc_date
  FROM `{TBL}.sap_purchase_orders_raw` po, UNNEST(JSON_EXTRACT_ARRAY(po.lines_json)) AS line
  WHERE po.document_status = 'bost_Open' AND COALESCE(po.cancelled, 'tNO') = 'tNO'
),
orphan_names AS (
  SELECT
    item_code,
    ARRAY_AGG(item_name ORDER BY ranked_date DESC LIMIT 1)[SAFE_OFFSET(0)] AS item_name_fallback
  FROM orphan_names_src
  WHERE item_code IS NOT NULL AND item_code != '' AND item_name IS NOT NULL
  GROUP BY item_code
),
enriched AS (
  SELECT
    ac.item_code,
    COALESCE(it.item_name, orn.item_name_fallback)                        AS item_name,
    it.foreign_name,
    it.cat,
    it.fam,
    it.sub,
    it.valid,
    it.frozen,
    -- STOCK: COALESCE a 0 (nunca NULL). Huerfanos = 0.
    COALESCE(SAFE_CAST(it.stock_total_sellable AS FLOAT64), 0.0)          AS stock_total_sellable,
    it.stock_by_warehouse_json,
    it.price_pesca_ars,
    it.cost_avg_ars,
    it.cost_last_purchase_ars,
    it._sync_timestamp,
    -- Flag: TRUE si el item existe en el maestro PESCA. FALSE = huerfano.
    (it.item_code IS NOT NULL)                                            AS is_in_master
  FROM all_codes ac
  LEFT JOIN `{TBL}.sap_items_raw` it ON ac.item_code = it.item_code
  LEFT JOIN orphan_names orn        ON ac.item_code = orn.item_code
)
SELECT
  e.item_code,
  e.item_name,
  e.foreign_name,
  e.cat,
  e.fam,
  e.sub,
  e.valid,
  e.frozen,
  e.stock_total_sellable,
  e.stock_by_warehouse_json,
  e.price_pesca_ars,
  e.cost_avg_ars,
  e.cost_last_purchase_ars,
  e._sync_timestamp,
  e.is_in_master,
  -- familia_norm: preservamos la logica actual + fallback 'SIN CATALOGO'
  -- para huerfanos (los que no estan en el maestro PESCA).
  CASE
    WHEN NOT e.is_in_master THEN 'SIN CATALOGO'
    WHEN e.cat IS NOT NULL AND e.cat != '' THEN e.cat
    WHEN e.item_code IN ('CVC66H2CSA','CVC66MH2','CVC66MH4SACO','FXPR410','12843-01','55CRT12524') THEN 'CAÑAS'
    WHEN e.item_code = '471512' THEN 'FG'
    WHEN REGEXP_CONTAINS(UPPER(e.item_name),
      r'CA(N|Ñ)A|SOJOURN|CRUZAR|PEJERREY|CONVERGENCE|TELESC|NRX|G\\.LOOMIS|TIP ASQ|SOLARA|CLARUS') THEN 'CAÑAS'
    WHEN REGEXP_CONTAINS(UPPER(e.item_name),
      r'REEL |SPINNING REEL|BAITCAST|BAITCASTING|FRONTAL|SPINNING FRONTAL') THEN 'REEL'
    WHEN REGEXP_CONTAINS(UPPER(e.item_name), r'COMBO') THEN 'COMBO'
    WHEN REGEXP_CONTAINS(UPPER(e.item_name),
      r'POWER ?PRO| LINE | LINEA|SEDAL|NYLON|FLUOROCARB|LEADER|MULTIFILAMENTO') THEN 'LINEAS'
    WHEN REGEXP_CONTAINS(UPPER(e.item_name),
      r'STICKER|BANNER|RUBBER MATT|PROMO|BUFF|GORRA|SOMBRERO|REMERA|BANDANA|KIT |BOLSA|CAJA|NECESER|CAMPING|ESTUCHE|LENTE|POLARIZADO| CAP | SHIRT|SHIMANO PROMO|PINZA|TIJERA|BOX|BAG|DISPLAY|DISP |CORTADOR|CUCHILLO|BOGAGRIP|ROD DISPLAY|FLOOR|COUNTER') THEN 'FG'
    ELSE e.cat
  END                                                                    AS familia_norm
FROM enriched e
'''.strip()

# Verificaciones
tests = [
    ('items totales en la NUEVA vista',
        f'SELECT COUNT(*) AS n FROM ({NEW_ENRICHED_CTE})'),

    ('items in_master vs huerfanos',
        f'''SELECT is_in_master, COUNT(*) AS n FROM ({NEW_ENRICHED_CTE})
            GROUP BY is_in_master ORDER BY is_in_master DESC'''),

    ('items con stock_total_sellable NULL (deberia ser 0)',
        f'SELECT COUNT(*) AS n FROM ({NEW_ENRICHED_CTE}) WHERE stock_total_sellable IS NULL'),

    ('items con stock_total_sellable = 0',
        f'SELECT COUNT(*) AS n FROM ({NEW_ENRICHED_CTE}) WHERE stock_total_sellable = 0'),

    ('items con stock_total_sellable > 0',
        f'SELECT COUNT(*) AS n FROM ({NEW_ENRICHED_CTE}) WHERE stock_total_sellable > 0'),

    ('ARDTY300D esta ahora?',
        f"SELECT item_code, item_name, familia_norm, stock_total_sellable, is_in_master FROM ({NEW_ENRICHED_CTE}) WHERE item_code = 'ARDTY300D'"),

    # === VERIFICACIONES DE ACEPTACION DEL USUARIO ===
    ('(a) SKUs de v_backorder_lineas que NO estan en la NUEVA vista - deberia ser 0',
        f'''SELECT COUNT(DISTINCT sku) AS n
            FROM `{TBL}.v_backorder_lineas` bo
            WHERE bo.sku NOT IN (SELECT item_code FROM ({NEW_ENRICHED_CTE}))'''),

    ('(b) NULLs en stock_total_sellable de la nueva vista - deberia ser 0',
        f'SELECT COUNT(*) AS n FROM ({NEW_ENRICHED_CTE}) WHERE stock_total_sellable IS NULL'),

    ('distribucion familia_norm en la NUEVA vista',
        f'''SELECT familia_norm, COUNT(*) AS n FROM ({NEW_ENRICHED_CTE})
            GROUP BY familia_norm ORDER BY n DESC LIMIT 20'''),

    ('sample: 5 huerfanos con backorder mas grande',
        f'''SELECT e.item_code, e.item_name, e.familia_norm, SUM(bo.pendiente) AS total_pendiente
            FROM ({NEW_ENRICHED_CTE}) e
            JOIN `{TBL}.v_backorder_lineas` bo ON bo.sku = e.item_code
            WHERE NOT e.is_in_master
            GROUP BY e.item_code, e.item_name, e.familia_norm
            ORDER BY total_pendiente DESC
            LIMIT 5'''),
]

for name, sql in tests:
    print('=' * 70)
    print(f'>>> {name}')
    print('-' * 70)
    try:
        rows = list(client.query(sql).result())
        if not rows:
            print('   (sin filas)')
        for r in rows:
            print('  ', dict(r.items()))
    except Exception as e:
        print('  ERROR:', str(e)[:400])
    print()
