CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_backorder` AS
SELECT
  pedido_id,
  order_number,
  created_at,
  -- fecha canónica en TZ Argentina para que Power BI relacione con la dim Date local
  DATE(created_at, 'America/Argentina/Buenos_Aires')                                        AS fecha,
  FORMAT_DATE('%Y-%m', DATE(created_at, 'America/Argentina/Buenos_Aires'))                  AS mes,
  EXTRACT(YEAR FROM DATE(created_at, 'America/Argentina/Buenos_Aires'))                     AS anio,
  EXTRACT(MONTH FROM DATE(created_at, 'America/Argentina/Buenos_Aires'))                    AS mes_idx,
  sku,
  descripcion,
  familia,
  subfamilia,
  is_pesca,
  cliente_code,
  cliente_nombre,
  cliente_ciudad,
  cliente_provincia,
  vendor,
  vendor_email,
  qty                                             AS qty_original,
  qty_open                                        AS unidades,
  price_at_creation                               AS precio_unitario,
  ROUND(qty_open * COALESCE(price_at_creation, precio, 0), 2) AS importe_ars,
  last_operation_at                               AS _sync_timestamp,
  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de
  -- assigned_vendor. Congruente con la atribucion del modelo PBI.
  CASE UPPER(TRIM(vendor))
      WHEN 'GONZALO DE LA ROSA'    THEN 50
      WHEN 'MAURICIO GIL'          THEN 51
      WHEN 'IOANNIS PALKOUDAKIS'   THEN 52
      WHEN 'SANTIAGO ESTEBAN'      THEN 53
      WHEN 'PACHI'                 THEN 53
      WHEN 'FEDERICO CASTELANELLI' THEN 54
      WHEN 'MARTIN BOIERO'         THEN 55
      WHEN 'DIEGO VALSI'           THEN 56
      ELSE NULL
    END AS slp_asignado
FROM `app-vendedores-shimano.shimano_app.v_backorder_app`
WHERE state = 'BO'
  AND qty_open > 0
