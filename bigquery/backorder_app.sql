-- =============================================================================
-- backorder_app.sql — Migracion backorder SAP -> APP (2026-09-01)
-- =============================================================================
-- Contexto (Mariano decision 2026-09-01): el backorder se esta migrando de SAP
-- (Sales Quotations abiertas / v_backorder_lineas) a la app de vendedores
-- (colección `pedidos` en Firestore, campo state='BO'/'ASIG'). Las SQ abiertas
-- en SAP se van a discontinuar en el corto plazo, asi que construir vistas
-- historicas sobre esa fuente no tiene sentido.
--
-- Este archivo crea:
--   1. v_pedidos_lines_ext (extension de v_pedidos_lines) — expone state,
--      qty_open, qty_invoiced, qty_cancelled ademas de las columnas actuales.
--      NOTA: la vista original v_pedidos_lines tambien se actualiza en views.sql
--      para incluir estas columnas (fuente unica de verdad = views.sql). Este
--      archivo NO redefine v_pedidos_lines (para evitar carrera de deploys);
--      documenta que campos deben estar en v_pedidos_lines post-update.
--
--   2. v_backorder_app — vista limpia con TODAS las lineas de pedidos abiertos
--      (closedAt IS NULL), con state (BO/ASIG/confirmed/cancelled/etc.).
--      El que consulta filtra por state segun necesidad.
--
--   3. v_backorder_lineas_v2 — shim compatibility con MISMO shape que la vieja
--      v_backorder_lineas de SAP. Filtra state IN ('BO','ASIG'). Mapea:
--      state='BO' -> estado='SIN ASIGNAR', state='ASIG' -> estado='ASIGNADO'.
--      Para minimizar el impacto en Power BI (un solo rename en el modelo).
--      JOIN a v_inventario y sap_purchase_orders_raw para las columnas que
--      SIGUEN viviendo en SAP (stock_actual, prox_embarque_date, qty_incoming).
--
-- CRITERIOS DE NEGOCIO (Mariano confirmo 2026-09-01):
--   STOCK ASIGNADO   = SUM(qty_open) WHERE state='ASIG'
--   BACKORDER (puro) = SUM(qty_open) WHERE state='BO'
--   CONFIRMADO       = state IN ('confirmed','invoiced')
--   LIBERADO/ELIMINADO = state IN ('cancelled','recycled')
--
-- HISTORICO CONFIRMADO/LIBERADO:
--   NO se necesita snapshot table (backorder_snapshots_hist). El changelog
--   `pedidos_raw_raw_changelog` (Firestore extension append-only) ya tiene
--   todo el historial de cambios de estado. Query pattern para el informe
--   mensual: comparar data JSON entre snapshots consecutivos en changelog
--   filtrando por mes. Ver query de validacion V3 al final del archivo.
--
-- REPOSICION/ETA:
--   prox_embarque_date + qty_incoming siguen viviendo en SAP
--   (sap_purchase_orders_raw). Se joinean por sku en v_backorder_lineas_v2.
--   Multiples POs abiertas por sku -> tomamos la de ShipDate mas proxima
--   (proximo embarque) y sumamos qty totales pending.
--
-- STOCK DISPONIBLE:
--   Sigue en v_inventario (stock_total_sellable). No se toca.
-- =============================================================================


-- =============================================================================
-- VISTA: v_backorder_app
-- =============================================================================
-- Vista limpia con TODAS las lineas de pedidos abiertos de la app. Todos los
-- states expuestos (BO/ASIG/confirmed/cancelled/recycled/invoiced). El consumer
-- filtra segun necesidad.
--
-- Pedido "abierto" = closedAt IS NULL (mismo criterio que la app en runtime,
-- ver index.html:16596 `if (!p || p.closedAt) continue;`).
-- =============================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_backorder_app` AS
WITH pedidos_open AS (
  SELECT
    p.document_id AS pedido_id,
    p.data,
    SAFE_CAST(JSON_VALUE(p.data, '$.orderNumber') AS INT64)     AS order_number,
    SAFE_CAST(JSON_VALUE(p.data, '$.createdAt') AS TIMESTAMP)    AS created_at,
    JSON_VALUE(p.data, '$.clientCardCode')                       AS cliente_code,
    JSON_VALUE(p.data, '$.clientName')                           AS cliente_nombre,
    JSON_VALUE(p.data, '$.locName')                              AS cliente_ciudad,
    JSON_VALUE(p.data, '$.province')                             AS cliente_provincia,
    JSON_VALUE(p.data, '$.ownerVendor')                          AS vendor,
    JSON_VALUE(p.data, '$.ownerEmail')                           AS vendor_email,
    JSON_VALUE(p.data, '$.stage')                                AS pedido_stage,
    JSON_VALUE(p.data, '$.closedAt')                             AS closed_at_str,
    JSON_VALUE(p.data, '$.month')                                AS mes_label,
    SAFE_CAST(JSON_VALUE(p.data, '$.monthIdx') AS INT64)         AS mes_idx,
    SAFE_CAST(JSON_VALUE(p.data, '$.year') AS INT64)             AS anio,
    p.timestamp                                                   AS last_operation_at,
    p.operation                                                   AS last_operation
  FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest` p
  WHERE p.operation <> 'DELETE'
    -- Solo pedidos NO cerrados. closedAt es null/vacio en abiertos.
    AND (JSON_VALUE(p.data, '$.closedAt') IS NULL
         OR JSON_VALUE(p.data, '$.closedAt') = '')
)
SELECT
  po.pedido_id,
  po.order_number,
  po.created_at,
  line_idx,
  JSON_VALUE(line_json, '$.code')                                    AS sku,
  COALESCE(
    JSON_VALUE(line_json, '$.desc'),
    JSON_VALUE(line_json, '$.name')
  )                                                                   AS descripcion,
  -- Familia/subfamilia: usar la de la linea si existe, sino fallback via JOIN
  -- v_sap_items_enriched. Se resuelve en JOIN abajo.
  COALESCE(JSON_VALUE(line_json, '$.familia'), it.familia_norm)      AS familia,
  COALESCE(JSON_VALUE(line_json, '$.subfamilia'), it.subfamilia_norm) AS subfamilia,
  -- Cantidades: qty original + tracking de open/invoiced/cancelled
  SAFE_CAST(JSON_VALUE(line_json, '$.qty') AS FLOAT64)               AS qty,
  SAFE_CAST(JSON_VALUE(line_json, '$.qtyOpen') AS FLOAT64)           AS qty_open,
  SAFE_CAST(JSON_VALUE(line_json, '$.qtyInvoiced') AS FLOAT64)       AS qty_invoiced,
  SAFE_CAST(JSON_VALUE(line_json, '$.qtyCancelled') AS FLOAT64)      AS qty_cancelled,
  -- Estado: BO | ASIG | confirmed | cancelled | recycled | invoiced
  JSON_VALUE(line_json, '$.state')                                    AS state,
  -- Precio congelado al momento de creacion del pedido
  SAFE_CAST(JSON_VALUE(line_json, '$.priceAtCreation') AS FLOAT64)   AS price_at_creation,
  SAFE_CAST(JSON_VALUE(line_json, '$.precio') AS FLOAT64)            AS precio,
  -- Header info
  po.cliente_code,
  po.cliente_nombre,
  po.cliente_ciudad,
  po.cliente_provincia,
  po.vendor,
  po.vendor_email,
  po.pedido_stage,
  po.mes_label,
  po.mes_idx,
  po.anio,
  po.last_operation_at,
  -- is_pesca: derivado del catalogo SAP (grupo 102 = pesca)
  (it.items_group_code = 102)                                         AS is_pesca
FROM pedidos_open po,
UNNEST(JSON_EXTRACT_ARRAY(po.data, '$.lines')) AS line_json WITH OFFSET AS line_idx
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` it
  ON it.item_code = JSON_VALUE(line_json, '$.code');


-- =============================================================================
-- VISTA: v_backorder_lineas_v2 (shim compatibility con v_backorder_lineas SAP)
-- =============================================================================
-- MISMO shape que la v_backorder_lineas vieja para que Power BI solo tenga que
-- renombrar la fuente. Filtra state IN ('BO','ASIG') que era el scope de la vieja.
--
-- Mapping:
--   pendiente     = qty_open
--   estado        = 'SIN ASIGNAR' (state='BO') | 'ASIGNADO' (state='ASIG')
--   sq_doc_entry  = NULL (no aplica en app) — dejamos pedido_id como alias
--   sq_doc_num    = order_number (INT del app)
--   sq_doc_date   = created_at
--   sku, cliente_code, cliente_nombre, cliente_ciudad → directo
--   familia, subfamilia, is_pesca → directo
--   producto → descripcion
--   pedido (qty original), precio_unitario → directo
--
-- Data que sigue viviendo en SAP y se joinea aca:
--   stock_actual        <- v_inventario.stock_total_sellable (SAP)
--   prox_embarque_date  <- min ShipDate de sap_purchase_orders_raw abiertas
--   qty_incoming        <- sum Quantity de sap_purchase_orders_raw abiertas
-- =============================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_backorder_lineas_v2` AS
WITH
-- Sumas de POs abiertas por sku: proxima ShipDate + qty total
po_agg AS (
  SELECT
    JSON_VALUE(ln, '$.ItemCode') AS item_code,
    MIN(SAFE_CAST(JSON_VALUE(ln, '$.ShipDate') AS DATE)) AS prox_embarque_date,
    SUM(SAFE_CAST(JSON_VALUE(ln, '$.Quantity') AS FLOAT64)) AS qty_incoming
  FROM `app-vendedores-shimano.shimano_app.sap_purchase_orders_raw`,
       UNNEST(JSON_QUERY_ARRAY(lines_json)) AS ln
  WHERE COALESCE(cancelled, 'tNO') = 'tNO'
    AND document_status = 'bost_Open'
    AND JSON_VALUE(ln, '$.ItemCode') IS NOT NULL
  GROUP BY item_code
),
-- Stock actual del sku desde v_inventario (mismo pattern que la vieja)
stock_agg AS (
  SELECT item_code, stock_actual
  FROM `app-vendedores-shimano.shimano_app.v_inventario`
)
SELECT
  -- Compat columns con v_backorder_lineas vieja (mismo shape)
  CAST(NULL AS INT64)                    AS sq_doc_entry,   -- No aplica en app
  ba.order_number                        AS sq_doc_num,
  DATE(ba.created_at)                    AS sq_doc_date,
  ba.sku,
  ba.descripcion                         AS producto,
  ba.familia,
  ba.subfamilia,
  ba.is_pesca,
  CAST(sa.stock_actual AS INT64)         AS stock_actual,
  ba.qty                                 AS pedido,
  ba.qty_open                            AS pendiente,
  ba.price_at_creation                   AS precio_unitario,
  ba.cliente_code,
  ba.cliente_nombre,
  ba.cliente_ciudad,
  pa.prox_embarque_date,
  pa.qty_incoming,
  -- Estado mapeado a la nomenclatura vieja
  CASE
    WHEN ba.state = 'ASIG' THEN 'ASIGNADO'
    WHEN ba.state = 'BO' THEN 'SIN ASIGNAR'
    ELSE 'OTRO'  -- defensive; el filtro WHERE abajo ya excluye estos
  END                                    AS estado,
  ba.last_operation_at                   AS _sync_timestamp,
  -- Extras (no estaban en la vieja, disponibles como bonus)
  ba.pedido_id                           AS app_pedido_id,
  ba.state                               AS app_state,
  ba.vendor                              AS app_vendor,
  ba.pedido_stage                        AS app_pedido_stage
FROM `app-vendedores-shimano.shimano_app.v_backorder_app` ba
LEFT JOIN po_agg pa ON pa.item_code = ba.sku
LEFT JOIN stock_agg sa ON sa.item_code = ba.sku
-- Filtro de shim: solo lineas que ANTES aparecian en v_backorder_lineas SAP
WHERE ba.state IN ('BO', 'ASIG')
  AND ba.qty_open > 0;


-- =============================================================================
-- QUERIES DE VALIDACION (correr post-deploy)
-- =============================================================================

-- V1: 5 filas de v_backorder_app
-- SELECT pedido_id, order_number, sku, state, qty_open, cliente_nombre, vendor
-- FROM `app-vendedores-shimano.shimano_app.v_backorder_app`
-- ORDER BY created_at DESC LIMIT 5;

-- V2: 5 filas de v_backorder_lineas_v2 (shape identico al viejo)
-- SELECT sku, producto, familia, pendiente, estado, cliente_code, cliente_nombre,
--        stock_actual, prox_embarque_date, qty_incoming
-- FROM `app-vendedores-shimano.shimano_app.v_backorder_lineas_v2`
-- LIMIT 5;

-- V3: validar que SUM(qty_open BO) + SUM(qty_open ASIG) = total lineas abiertas
-- SELECT
--   state,
--   COUNT(*) AS n_lineas,
--   ROUND(SUM(qty_open), 2) AS total_qty_open,
--   COUNT(DISTINCT pedido_id) AS n_pedidos
-- FROM `app-vendedores-shimano.shimano_app.v_backorder_app`
-- WHERE qty_open > 0
-- GROUP BY state
-- ORDER BY state;

-- V4: check total de pedidos abiertos vs suma de sus lineas open
-- SELECT
--   COUNT(DISTINCT pedido_id)                AS n_pedidos_abiertos,
--   COUNT(*)                                  AS n_lineas_total,
--   COUNTIF(qty_open > 0)                     AS n_lineas_con_qty_open,
--   ROUND(SUM(qty_open), 2)                   AS total_qty_open,
--   ROUND(SUM(qty), 2)                        AS total_qty_original,
--   ROUND(SUM(qty_invoiced), 2)               AS total_qty_invoiced,
--   ROUND(SUM(qty_cancelled), 2)              AS total_qty_cancelled
-- FROM `app-vendedores-shimano.shimano_app.v_backorder_app`;

-- V5: historico CONFIRMADO vs LIBERADO por mes (usa changelog Firestore)
--   Requiere query mas compleja. Ver README abajo. Idea: por cada snapshot de
--   pedido en pedidos_raw_raw_changelog, comparar data vs old_data para ver
--   los state changes por linea. Se puede parametrizar por mes.

-- =============================================================================
-- README: JOIN pattern para Power BI
-- =============================================================================
-- Migracion desde v_backorder_lineas (SAP, obsoleto) a v_backorder_lineas_v2:
--   1. En el modelo Power BI, editar la fuente: cambiar
--      `v_backorder_lineas` -> `v_backorder_lineas_v2`
--   2. Todas las medidas existentes siguen funcionando (mismo shape).
--   3. Bonus: 4 columnas nuevas (app_pedido_id, app_state, app_vendor,
--      app_pedido_stage) disponibles para nuevos visuals si se quiere.
--
-- Migracion a v_backorder_app (approach preferido, mas granular):
--   1. Cambiar fuente a v_backorder_app en un dataset nuevo.
--   2. Ajustar medidas:
--      STOCK ASIGNADO   = CALCULATE(SUM(qty_open), state = "ASIG")
--      BACKORDER PURO   = CALCULATE(SUM(qty_open), state = "BO")
--      CONFIRMADO ACUM  = CALCULATE(SUM(qty_open), state IN {"confirmed","invoiced"})
--      LIBERADO ACUM    = CALCULATE(SUM(qty_open), state IN {"cancelled","recycled"})
--   3. Para ETA/qty_incoming y stock_actual (no estan en v_backorder_app):
--      hacer JOIN por sku a v_inventario y sap_purchase_orders_raw. Ejemplo M:
--
--      let
--        Source = GoogleBigQuery(...),
--        BA = Source{"v_backorder_app"},
--        Inv = Source{"v_inventario"},
--        Joined = Table.NestedJoin(BA, {"sku"}, Inv, {"item_code"}, "Inv", JoinKind.LeftOuter),
--        Expanded = Table.ExpandTableColumn(Joined, "Inv", {"stock_total_sellable", "qty_incoming"})
--      in Expanded
--
-- =============================================================================
-- VISTA: v_entradas_stock
-- =============================================================================
-- Mariano pedido 2026-09-01. Unidades fisicas RECIBIDAS al deposito, con
-- granularidad SKU + fecha + warehouse. Sirve para contrastar contra el
-- backorder de la app en el reporte mensual.
--
-- Fuentes:
--   1. sap_purchase_delivery_notes_raw (OPDN/PDN1) — recepciones contra
--      Purchase Order. Fuente principal, alto volumen.
--   2. sap_inventory_gen_entries_raw (OIGN/IGN1) — entradas SIN OC
--      (ajustes de inventario, transferencias, produccion). Complementaria.
--
-- Ambas sincronizadas por scripts/sync_sap_to_bigquery.py (v765+, 2026-09-01),
-- ventana 12 meses.
--
-- IMPORTANTE:
-- - Excluimos cancelled='tYES' (documentos anulados).
-- - Warehouse 05 (Marketing) y 06 (Devoluciones) NO son "vendibles" pero
--   pueden recibir entradas (samples, devoluciones ingresadas al stock).
--   Se deja el warehouse crudo — el consumer decide si filtrarlos.
-- - familia via JOIN v_sap_items_enriched (mismo pattern que v_ventas_lineas).
-- =============================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_entradas_stock` AS
WITH pdn_lines AS (
  SELECT
    'PDN' AS tipo_doc,             -- Purchase Delivery Note (GRPO)
    d.doc_entry,
    d.doc_num,
    d.doc_date                     AS fecha_entrada,
    d.card_code                    AS proveedor_code,
    d.card_name                    AS proveedor_nombre,
    JSON_VALUE(ln, '$.ItemCode')   AS sku,
    JSON_VALUE(ln, '$.ItemDescription') AS descripcion,
    SAFE_CAST(JSON_VALUE(ln, '$.Quantity') AS FLOAT64)  AS cantidad_recibida,
    JSON_VALUE(ln, '$.WarehouseCode') AS warehouse,
    SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64) AS importe_linea,
    JSON_VALUE(ln, '$.Currency')   AS moneda,
    d._sync_timestamp
  FROM `app-vendedores-shimano.shimano_app.sap_purchase_delivery_notes_raw` d,
       UNNEST(JSON_QUERY_ARRAY(d.lines_json)) AS ln
  WHERE COALESCE(d.cancelled, 'tNO') = 'tNO'
),
ign_lines AS (
  SELECT
    'IGN' AS tipo_doc,             -- Inventory Gen Entry (entrada sin OC)
    d.doc_entry,
    d.doc_num,
    d.doc_date                     AS fecha_entrada,
    d.card_code                    AS proveedor_code,   -- puede ser NULL en IGN
    d.card_name                    AS proveedor_nombre, -- puede ser NULL en IGN
    JSON_VALUE(ln, '$.ItemCode')   AS sku,
    JSON_VALUE(ln, '$.ItemDescription') AS descripcion,
    SAFE_CAST(JSON_VALUE(ln, '$.Quantity') AS FLOAT64)  AS cantidad_recibida,
    JSON_VALUE(ln, '$.WarehouseCode') AS warehouse,
    SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64) AS importe_linea,
    JSON_VALUE(ln, '$.Currency')   AS moneda,
    d._sync_timestamp
  FROM `app-vendedores-shimano.shimano_app.sap_inventory_gen_entries_raw` d,
       UNNEST(JSON_QUERY_ARRAY(d.lines_json)) AS ln
  WHERE COALESCE(d.cancelled, 'tNO') = 'tNO'
),
unioned AS (
  SELECT * FROM pdn_lines
  UNION ALL
  SELECT * FROM ign_lines
)
SELECT
  u.tipo_doc,
  u.doc_entry,
  u.doc_num,
  u.fecha_entrada,
  -- Mes canonico para agrupar en Power BI ('YYYY-MM')
  FORMAT_DATE('%Y-%m', u.fecha_entrada) AS mes,
  EXTRACT(YEAR FROM u.fecha_entrada)  AS anio,
  EXTRACT(MONTH FROM u.fecha_entrada) AS mes_idx,
  u.sku,
  COALESCE(u.descripcion, it.item_name) AS descripcion,
  it.familia_norm    AS familia,
  it.subfamilia_norm AS subfamilia,
  (it.items_group_code = 102) AS is_pesca,
  u.cantidad_recibida,
  u.warehouse,
  (u.warehouse IN ('05', '06')) AS is_warehouse_no_vendible,
  u.importe_linea,
  u.moneda,
  u.proveedor_code,
  u.proveedor_nombre,
  u._sync_timestamp
FROM unioned u
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` it
  ON it.item_code = u.sku
WHERE u.sku IS NOT NULL
  AND u.cantidad_recibida > 0;


-- QUERIES DE VALIDACION v_entradas_stock:

-- E1: Unidades recibidas mes actual
-- SELECT mes, COUNT(*) AS n_lineas, ROUND(SUM(cantidad_recibida), 0) AS unidades
-- FROM `app-vendedores-shimano.shimano_app.v_entradas_stock`
-- WHERE is_pesca = TRUE
-- GROUP BY mes ORDER BY mes DESC LIMIT 12;

-- E2: Recibido por familia (mes actual)
-- SELECT familia, ROUND(SUM(cantidad_recibida), 0) AS unidades
-- FROM `app-vendedores-shimano.shimano_app.v_entradas_stock`
-- WHERE is_pesca = TRUE AND mes = FORMAT_DATE('%Y-%m', CURRENT_DATE())
-- GROUP BY familia ORDER BY unidades DESC;

-- E3: Contraste backorder vs recibido del mes (indicador clave para negocio)
-- SELECT
--   'BACKORDER (BO)' AS metric, ROUND(SUM(qty_open), 0) AS unidades
-- FROM `app-vendedores-shimano.shimano_app.v_backorder_app`
-- WHERE state = 'BO'
-- UNION ALL
-- SELECT
--   'RECIBIDO MES actual' AS metric, ROUND(SUM(cantidad_recibida), 0) AS unidades
-- FROM `app-vendedores-shimano.shimano_app.v_entradas_stock`
-- WHERE is_pesca = TRUE AND mes = FORMAT_DATE('%Y-%m', CURRENT_DATE());


-- =============================================================================
-- MEDIDA "Unidades Recibidas Mes" para Power BI (DAX)
-- =============================================================================
-- En Power BI, crear una medida en la tabla v_entradas_stock:
--
--   Unidades Recibidas Mes =
--     CALCULATE(
--       SUM('v_entradas_stock'[cantidad_recibida]),
--       'v_entradas_stock'[is_pesca] = TRUE,
--       DATESINPERIOD(
--         'v_entradas_stock'[fecha_entrada],
--         MAX('v_entradas_stock'[fecha_entrada]),
--         -1, MONTH
--       )
--     )
--
-- O version simple filtrada por slicer de mes:
--
--   Unidades Recibidas =
--     SUM('v_entradas_stock'[cantidad_recibida])
--
-- Y en el visual filtrar por mes usando el campo `mes` (STRING 'YYYY-MM') o
-- las columnas anio/mes_idx.


-- Historico CONFIRMADO vs LIBERADO desde el changelog Firestore:
--   Query pattern (ejemplo, mes agosto 2026):
--
--   WITH mes_range AS (
--     SELECT DATE '2026-08-01' AS d_from, DATE '2026-08-31' AS d_to
--   ),
--   changes AS (
--     -- Todos los updates de pedidos en el mes
--     SELECT
--       ch.document_id,
--       ch.timestamp,
--       old_line,
--       new_line,
--       SAFE.JSON_VALUE(old_line, '$.state') AS state_before,
--       SAFE.JSON_VALUE(new_line, '$.state') AS state_after,
--       SAFE_CAST(SAFE.JSON_VALUE(old_line, '$.qtyOpen') AS FLOAT64) AS qty_open_before,
--       SAFE_CAST(SAFE.JSON_VALUE(new_line, '$.qtyOpen') AS FLOAT64) AS qty_open_after
--     FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_changelog` ch, mes_range m,
--          UNNEST(JSON_EXTRACT_ARRAY(ch.old_data, '$.lines')) AS old_line WITH OFFSET pos_old,
--          UNNEST(JSON_EXTRACT_ARRAY(ch.data, '$.lines')) AS new_line WITH OFFSET pos_new
--     WHERE DATE(ch.timestamp) BETWEEN m.d_from AND m.d_to
--       AND ch.operation = 'UPDATE'
--       AND pos_old = pos_new  -- mismo indice de linea antes/despues
--   )
--   SELECT
--     COUNTIF(state_before IN ('BO','ASIG') AND state_after IN ('confirmed','invoiced'))
--       AS n_confirmados,
--     SUM(IF(state_before IN ('BO','ASIG') AND state_after IN ('confirmed','invoiced'), qty_open_before, 0))
--       AS unidades_confirmadas,
--     COUNTIF(state_before IN ('BO','ASIG') AND state_after IN ('cancelled','recycled'))
--       AS n_liberados,
--     SUM(IF(state_before IN ('BO','ASIG') AND state_after IN ('cancelled','recycled'), qty_open_before, 0))
--       AS unidades_liberadas
--   FROM changes;
-- =============================================================================
