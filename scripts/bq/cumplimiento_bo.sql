-- Vistas para medir tasa de cumplimiento del Backorder.
-- Flujo medido: linea state='BO' → ASIG via "Crear Pedido - ST" → pedido confirmed.
-- Marker: pedidos.source = 'stock-asignado-batch' (campo persistido en v1209, 2026-10-08).
--
-- Las 3 vistas:
--   v_bo_cumplimiento_pedidos   -> tasa simple por mes (nro pedidos)
--   v_bo_cumplimiento_unidades  -> tasa por qty unidades (dinero-weighted)
--   v_bo_cumplimiento_funnel    -> funnel historico BO -> ASIG -> confirmed via STOCK ASIG
--
-- Dataset: app-vendedores-shimano.shimano_app
-- Fuentes:
--   pedidos_raw_raw_latest       -> VIEW del Firebase extension (ultimo estado por doc)
--   pedidos_raw_raw_changelog    -> TABLE con todas las operaciones (necesaria para historial BO)
--
-- Deploy: python scripts/bq/deploy_cumplimiento_bo.py


-- ========================================================================
-- VISTA 1: Tasa simple por mes (nro de pedidos)
-- ========================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_bo_cumplimiento_pedidos` AS
WITH base AS (
  SELECT
    document_name,
    JSON_EXTRACT_SCALAR(data, '$.source') AS source,
    JSON_EXTRACT_SCALAR(data, '$.stage') AS stage,
    JSON_EXTRACT_SCALAR(data, '$.transferidoSAP.docNum') AS sap_docnum,
    JSON_EXTRACT_SCALAR(data, '$.ownerVendor') AS vendor,
    JSON_EXTRACT_SCALAR(data, '$.clientName') AS cliente,
    SAFE_CAST(JSON_EXTRACT_SCALAR(data, '$.createdAt._seconds') AS INT64) AS created_sec
  FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest`
  WHERE data IS NOT NULL
)
SELECT
  DATE_TRUNC(DATE(TIMESTAMP_SECONDS(created_sec), 'America/Argentina/Buenos_Aires'), MONTH) AS mes,
  COUNT(*) AS pedidos_totales_confirmed,
  COUNTIF(source = 'stock-asignado-batch') AS pedidos_via_stock_asig,
  SAFE_DIVIDE(
    COUNTIF(source = 'stock-asignado-batch'),
    COUNT(*)
  ) AS tasa_cumplimiento_pct
FROM base
WHERE sap_docnum IS NOT NULL  -- solo pedidos efectivamente en SAP
  AND created_sec IS NOT NULL
GROUP BY mes
ORDER BY mes DESC;


-- ========================================================================
-- VISTA 2: Tasa por unidades (qty-weighted)
-- ========================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_bo_cumplimiento_unidades` AS
WITH base AS (
  SELECT
    document_name,
    JSON_EXTRACT_SCALAR(data, '$.source') AS source,
    JSON_EXTRACT_SCALAR(data, '$.transferidoSAP.docNum') AS sap_docnum,
    JSON_EXTRACT_SCALAR(data, '$.ownerVendor') AS vendor,
    SAFE_CAST(JSON_EXTRACT_SCALAR(data, '$.createdAt._seconds') AS INT64) AS created_sec,
    JSON_EXTRACT_ARRAY(data, '$.lines') AS lines_arr
  FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest`
  WHERE data IS NOT NULL
    AND JSON_EXTRACT_SCALAR(data, '$.transferidoSAP.docNum') IS NOT NULL
),
lines_flat AS (
  SELECT
    b.document_name,
    b.source,
    b.vendor,
    DATE_TRUNC(DATE(TIMESTAMP_SECONDS(b.created_sec), 'America/Argentina/Buenos_Aires'), MONTH) AS mes,
    JSON_EXTRACT_SCALAR(line, '$.state') AS line_state,
    SAFE_CAST(JSON_EXTRACT_SCALAR(line, '$.qty') AS FLOAT64) AS qty,
    SAFE_CAST(JSON_EXTRACT_SCALAR(line, '$.precio') AS FLOAT64) AS precio
  FROM base b,
       UNNEST(b.lines_arr) AS line
  WHERE b.created_sec IS NOT NULL
)
SELECT
  mes,
  SUM(IF(line_state IN ('confirmed', 'invoiced', 'ASIG'), qty, 0)) AS unidades_totales,
  SUM(IF(line_state IN ('confirmed', 'invoiced', 'ASIG') AND source = 'stock-asignado-batch', qty, 0)) AS unidades_via_stock_asig,
  SAFE_DIVIDE(
    SUM(IF(line_state IN ('confirmed', 'invoiced', 'ASIG') AND source = 'stock-asignado-batch', qty, 0)),
    SUM(IF(line_state IN ('confirmed', 'invoiced', 'ASIG'), qty, 0))
  ) AS tasa_cumplimiento_pct,
  -- Monto $ (coherente con la qty: solo lineas confirmed/invoiced/ASIG)
  SUM(IF(line_state IN ('confirmed', 'invoiced', 'ASIG'), qty * COALESCE(precio, 0), 0)) AS monto_total_ars,
  SUM(IF(line_state IN ('confirmed', 'invoiced', 'ASIG') AND source = 'stock-asignado-batch', qty * COALESCE(precio, 0), 0)) AS monto_via_stock_asig_ars
FROM lines_flat
GROUP BY mes
ORDER BY mes DESC;


-- ========================================================================
-- VISTA 3: Funnel historico BO -> Stock Asignado -> confirmed via STOCK ASIG
-- ========================================================================
-- Usa el changelog (historial completo) para rastrear:
--   A) Pedidos que alguna vez tuvieron una linea state='BO' (BO abierto en algun momento)
--   B) De esos, cuales terminaron confirmados en SAP
--   C) Pedidos que vinieron especificamente de "Crear Pedido - ST" (source=stock-asignado-batch)
--
-- Nota: un pedido puede estar en varias etapas (BO en el historial Y confirmed hoy).
-- La tasa A->B mide "cuantos BOs se convierten en pedidos SAP eventualmente".
-- La tasa B->C mide "de los pedidos SAP, cuantos vinieron del flujo STOCK ASIG".
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_bo_cumplimiento_funnel` AS
WITH ever_had_bo AS (
  -- Pedidos que alguna vez tuvieron una linea state='BO' (en cualquier operacion del changelog)
  SELECT DISTINCT c.document_name
  FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_changelog` c,
       UNNEST(JSON_EXTRACT_ARRAY(c.data, '$.lines')) AS line
  WHERE c.data IS NOT NULL
    AND JSON_EXTRACT_SCALAR(line, '$.state') = 'BO'
),
current_state AS (
  -- Estado actual (ultimo snapshot) de los pedidos
  SELECT
    document_name,
    JSON_EXTRACT_SCALAR(data, '$.source') AS source,
    JSON_EXTRACT_SCALAR(data, '$.stage') AS stage,
    JSON_EXTRACT_SCALAR(data, '$.transferidoSAP.docNum') AS sap_docnum,
    SAFE_CAST(JSON_EXTRACT_SCALAR(data, '$.createdAt._seconds') AS INT64) AS created_sec
  FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest`
  WHERE data IS NOT NULL
),
funnel AS (
  SELECT
    DATE_TRUNC(DATE(TIMESTAMP_SECONDS(cs.created_sec), 'America/Argentina/Buenos_Aires'), MONTH) AS mes,
    COUNT(*) AS total_pedidos_mes,
    COUNTIF(cs.document_name IN (SELECT document_name FROM ever_had_bo)) AS pedidos_con_bo_historico,
    COUNTIF(cs.sap_docnum IS NOT NULL AND cs.document_name IN (SELECT document_name FROM ever_had_bo)) AS pedidos_con_bo_que_llegaron_a_sap,
    COUNTIF(cs.source = 'stock-asignado-batch') AS pedidos_via_stock_asig_batch,
    COUNTIF(cs.source = 'stock-asignado-batch' AND cs.sap_docnum IS NOT NULL) AS pedidos_via_stock_asig_batch_en_sap
  FROM current_state cs
  WHERE cs.created_sec IS NOT NULL
  GROUP BY mes
)
SELECT
  mes,
  total_pedidos_mes,
  pedidos_con_bo_historico,
  pedidos_con_bo_que_llegaron_a_sap,
  pedidos_via_stock_asig_batch,
  pedidos_via_stock_asig_batch_en_sap,
  -- Etapa A->B: de los que tuvieron BO, cuantos llegaron a SAP (eventual fulfillment)
  SAFE_DIVIDE(pedidos_con_bo_que_llegaron_a_sap, pedidos_con_bo_historico) AS tasa_bo_a_sap_pct,
  -- Etapa B->C: de los pedidos SAP, cuantos vinieron del flujo STOCK ASIG (adopcion)
  SAFE_DIVIDE(pedidos_via_stock_asig_batch_en_sap, pedidos_con_bo_que_llegaron_a_sap) AS tasa_adopcion_stock_asig_pct
FROM funnel
ORDER BY mes DESC;
