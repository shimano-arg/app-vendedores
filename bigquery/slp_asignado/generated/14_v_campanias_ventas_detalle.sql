CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_campanias_ventas_detalle` AS
WITH c AS (
  SELECT
    campaign_id, name AS campaign_name, familia AS campaign_familia,
    subfamilia AS campaign_subfamilia, target_type, target_amount,
    start_date, end_date, scope,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(sku) FROM UNNEST(JSON_EXTRACT_ARRAY(skus_json)) sku) AS skus,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(v)   FROM UNNEST(JSON_EXTRACT_ARRAY(scope_values_json)) v) AS scope_values
  FROM `app-vendedores-shimano.shimano_app.campaigns_raw`
)
SELECT
  c.campaign_id,
  c.campaign_name,
  c.campaign_familia,
  c.campaign_subfamilia,
  c.target_type,
  c.target_amount,
  c.start_date                                                          AS campaign_start_date,
  c.end_date                                                            AS campaign_end_date,
  c.scope,
  ARRAY_TO_STRING(c.scope_values, ', ')                                 AS scope_values_str,
  -- Contexto de la factura
  v.doc_entry,
  v.doc_num,
  v.doc_date,
  v.anio,
  v.mes,
  -- Cliente
  v.card_code,
  v.card_name,
  v.provincia_cliente,
  -- SKU vendido (item de la campania)
  v.item_code,
  v.descripcion_linea,
  v.warehouse_code,
  -- Categorizacion del catalogo (item_name_catalogo con parche encoding, familia/subfamilia enriquecidas)
  v.item_name_catalogo,
  v.familia,
  v.subfamilia,
  v.is_pesca,
  -- Vendedor
  v.assigned_vendor,
  v.sales_person_code,
  -- Metricas
  v.cantidad,
  v.precio_unitario,
  v.importe_linea_ars,
  v.cobrado_prorrateado_ars,
  v.deuda_prorrateada_ars,

  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de
  -- assigned_vendor. Congruente con la atribucion del modelo PBI.
  CASE UPPER(TRIM(v.assigned_vendor))
      WHEN 'GONZALO DE LA ROSA'    THEN 50
      WHEN 'MAURICIO GIL'          THEN 51
      WHEN 'IOANNIS PALKOUDAKIS'   THEN 52
      WHEN 'SANTIAGO ESTEBAN'      THEN 53
      WHEN 'PACHI'                 THEN 53
      WHEN 'FEDERICO CASTELANELLI' THEN 54
      WHEN 'MARTIN BOIERO'         THEN 55
      WHEN 'DIEGO VALSI'           THEN 56
      ELSE NULL
    END AS slp_asignado,
  -- slp_documento_sap (2026-09-29 v2): SlpCode del documento SAP,
  -- para analisis. NO se usa para atribucion (ver slp_asignado).
  v.sales_person_code AS slp_documento_sap
FROM c
JOIN `app-vendedores-shimano.shimano_app.v_ventas_lineas` v
  ON v.item_code IN UNNEST(c.skus)
 AND v.doc_date BETWEEN c.start_date AND c.end_date
WHERE
  c.scope = 'all'
  OR (c.scope = 'province' AND v.provincia_cliente IN UNNEST(c.scope_values))
  OR (c.scope = 'vendor'   AND v.assigned_vendor   IN UNNEST(c.scope_values))
