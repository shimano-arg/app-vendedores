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
-- VISTA 4: *** LA PRINCIPAL *** — tasa real del flujo CPST (Crear Pedido - ST)
-- ========================================================================
-- Mide exactamente lo que Mariano pregunta: "cuantas unidades que los clientes
-- tenian ASIGNADAS se terminaron enviando a SAP via Crear Pedido - ST".
--
-- Flujo medido:
--   1. Cliente tiene linea state='ASIG' en un pedido (stock asignado FIFO)
--   2. Admin/VDE abre modal Stock Asignado y clickea "Crear Pedido - ST"
--      -> La linea vieja se MARCA con cancelledFrom='crear-pedido-st'
--      -> Se crea NUEVO waitlist con source='stock-asignado-batch'
--   3. Ese waitlist pasa a pedidos (confirmed) y se envia a SAP
--
-- Numerador  : unidades llegadas a SAP via source='stock-asignado-batch'
-- Denominador: unidades que ENTRARON al flujo (cancelledFrom='crear-pedido-st')
-- Tasa real  : % del flujo CPST que efectivamente llega a SAP
--
-- Si tasa es baja: muchas ASIG se "convierten" pero el waitlist no se procesa
-- (el VDE no lo pasa a pending, o el pedido nuevo se cancela, o se traba).
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_bo_cumplimiento_cpst` AS
WITH entradas AS (
  -- Unidades que ENTRARON al flujo CPST (linea cancelada con marker)
  SELECT
    JSON_EXTRACT_SCALAR(line, '$.cancelledAt') AS cancelled_at,
    JSON_EXTRACT_SCALAR(line, '$.code') AS sku,
    SAFE_CAST(JSON_EXTRACT_SCALAR(line, '$.qty') AS FLOAT64) AS qty,
    SAFE_CAST(JSON_EXTRACT_SCALAR(line, '$.precio') AS FLOAT64) AS precio,
    JSON_EXTRACT_SCALAR(p.data, '$.clientCardCode') AS cardcode_origen,
    JSON_EXTRACT_SCALAR(p.data, '$.ownerVendor') AS vendor_origen
  FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest` p,
       UNNEST(JSON_EXTRACT_ARRAY(p.data, '$.lines')) AS line
  WHERE JSON_EXTRACT_SCALAR(line, '$.cancelledFrom') = 'crear-pedido-st'
),
salidas AS (
  -- Unidades que SALIERON por SAP via el flujo CPST
  SELECT
    SAFE_CAST(JSON_EXTRACT_SCALAR(p.data, '$.createdAt._seconds') AS INT64) AS created_sec,
    JSON_EXTRACT_SCALAR(line, '$.code') AS sku,
    SAFE_CAST(JSON_EXTRACT_SCALAR(line, '$.qty') AS FLOAT64) AS qty,
    SAFE_CAST(JSON_EXTRACT_SCALAR(line, '$.precio') AS FLOAT64) AS precio,
    JSON_EXTRACT_SCALAR(p.data, '$.clientCardCode') AS cardcode_destino,
    JSON_EXTRACT_SCALAR(p.data, '$.ownerVendor') AS vendor_destino
  FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest` p,
       UNNEST(JSON_EXTRACT_ARRAY(p.data, '$.lines')) AS line
  WHERE JSON_EXTRACT_SCALAR(p.data, '$.source') = 'stock-asignado-batch'
    AND JSON_EXTRACT_SCALAR(p.data, '$.transferidoSAP.docNum') IS NOT NULL
    AND JSON_EXTRACT_SCALAR(line, '$.state') IN ('confirmed', 'invoiced', 'ASIG')
),
entradas_por_mes AS (
  SELECT
    DATE_TRUNC(DATE(TIMESTAMP(cancelled_at), 'America/Argentina/Buenos_Aires'), MONTH) AS mes,
    SUM(qty) AS unidades_entraron,
    SUM(qty * COALESCE(precio, 0)) AS monto_entraron_ars,
    COUNT(DISTINCT cardcode_origen) AS clientes_tocados
  FROM entradas
  WHERE cancelled_at IS NOT NULL
  GROUP BY mes
),
salidas_por_mes AS (
  SELECT
    DATE_TRUNC(DATE(TIMESTAMP_SECONDS(created_sec), 'America/Argentina/Buenos_Aires'), MONTH) AS mes,
    SUM(qty) AS unidades_salieron_sap,
    SUM(qty * COALESCE(precio, 0)) AS monto_salieron_sap_ars,
    COUNT(DISTINCT cardcode_destino) AS clientes_cumplidos
  FROM salidas
  WHERE created_sec IS NOT NULL
  GROUP BY mes
)
SELECT
  COALESCE(e.mes, s.mes) AS mes,
  COALESCE(e.unidades_entraron, 0) AS unidades_entraron_flujo,
  COALESCE(s.unidades_salieron_sap, 0) AS unidades_llegaron_a_sap,
  COALESCE(e.unidades_entraron, 0) - COALESCE(s.unidades_salieron_sap, 0) AS unidades_perdidas,
  SAFE_DIVIDE(COALESCE(s.unidades_salieron_sap, 0), COALESCE(e.unidades_entraron, 0)) AS tasa_cumplimiento_pct,
  COALESCE(e.monto_entraron_ars, 0) AS monto_entraron_ars,
  COALESCE(s.monto_salieron_sap_ars, 0) AS monto_llegaron_sap_ars,
  COALESCE(e.clientes_tocados, 0) AS clientes_entraron_flujo,
  COALESCE(s.clientes_cumplidos, 0) AS clientes_cumplidos
FROM entradas_por_mes e
FULL OUTER JOIN salidas_por_mes s USING (mes)
WHERE COALESCE(e.mes, s.mes) IS NOT NULL
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
