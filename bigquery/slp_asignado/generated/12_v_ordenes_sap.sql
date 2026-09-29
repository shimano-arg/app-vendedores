CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_ordenes_sap` AS
WITH
cliente_app AS (
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      JSON_VALUE(data, '$.assignedVendor')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS assigned_vendor_app
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
items AS (
  SELECT
    item_code,
    familia_norm                 AS familia,
    subfamilia_norm              AS subfamilia,
    (items_group_code = 102)     AS is_pesca
  FROM `app-vendedores-shimano.shimano_app.v_sap_items_enriched`
),
sum_lines_orders AS (
  SELECT
    doc_entry,
    SUM(SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64)) AS suma_lineas
  FROM `app-vendedores-shimano.shimano_app.sap_orders_raw`,
       UNNEST(JSON_QUERY_ARRAY(lines_json)) AS ln
  WHERE COALESCE(cancelled, 'tNO') = 'tNO'
  GROUP BY doc_entry
)
SELECT
  -- Identificacion documento + linea
  o.doc_entry,
  o.doc_num,
  SAFE_CAST(JSON_VALUE(line, '$.LineNum') AS INT64)                     AS line_num,

  -- Fecha (doc_date ya es DATE nativo)
  o.doc_date,
  o.doc_date                                                            AS fecha,
  FORMAT_DATE('%Y-%m', o.doc_date)                                      AS mes,
  EXTRACT(YEAR FROM o.doc_date)                                         AS anio,
  EXTRACT(MONTH FROM o.doc_date)                                        AS mes_idx,

  -- Cliente
  o.card_code,
  o.card_name,

  -- Vendedor (mismo pattern que v_ofertas_lineas / v_remitos_lineas)
  o.sales_person_code                                                   AS slp_code,
  CASE
    WHEN o.sales_person_code BETWEEN 50 AND 55 THEN o.sales_person_code
    ELSE NULL
  END                                                                   AS `SlpCode Asignado`,
  ca.assigned_vendor_app                                                AS assigned_vendor,

  -- Producto
  JSON_VALUE(line, '$.ItemCode')                                        AS item_code,
  -- SO usa ItemDescription (no Dscription como quotations/deliveries)
  COALESCE(
    JSON_VALUE(line, '$.ItemDescription'),
    JSON_VALUE(line, '$.Dscription')
  )                                                                     AS descripcion,
  it.familia,
  it.subfamilia,
  it.is_pesca,

  -- Cantidades e importes
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)                  AS cantidad,
  SAFE_CAST(JSON_VALUE(line, '$.Price') AS FLOAT64)                     AS precio_unitario,
  -- Importe linea NETO (post-descuento global cabecera, mismo criterio v388.1)
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    * (1 - SAFE_DIVIDE(COALESCE(o.total_discount, 0), NULLIF(slo.suma_lineas, 0)))
                                                                        AS importe_linea_ars,

  -- Estado de linea + apertura pendiente
  -- SAP Service Layer devuelve 'bost_Open'/'bost_Close'; mapeo a 'O'/'C'
  -- para que Power BI/DAX escriba filtros mas cortos y coherentes con RDR1.
  CASE JSON_VALUE(line, '$.LineStatus')
    WHEN 'bost_Open'  THEN 'O'
    WHEN 'bost_Close' THEN 'C'
    ELSE NULL
  END                                                                   AS line_status,
  SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)     AS open_qty,
  -- open_amount_ars: gate por LineStatus. SAP SL devuelve OpenAmount == LineTotal
  -- incluso en lineas cerradas (bug/design SAP: solo RemainingOpenQuantity se
  -- pone en 0 al cerrar). Sin este gate, SUM(open_amount) daria ~SUM(importe)
  -- confundiendo "orden neta" con "orden bruta". Se aplica el mismo prorrateo
  -- de descuento cabecera para coherencia con importe_linea_ars.
  CASE
    WHEN JSON_VALUE(line, '$.LineStatus') = 'bost_Open' THEN
      SAFE_CAST(JSON_VALUE(line, '$.OpenAmount') AS FLOAT64)
        * (1 - SAFE_DIVIDE(COALESCE(o.total_discount, 0), NULLIF(slo.suma_lineas, 0)))
    ELSE 0
  END                                                                   AS open_amount_ars,

  -- Metadata documento
  o.doc_currency,
  o.doc_rate,
  o.document_status,
  o._sync_timestamp,
  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de
  -- assigned_vendor. Congruente con la atribucion del modelo PBI.
  CASE UPPER(TRIM(ca.assigned_vendor_app))
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
FROM `app-vendedores-shimano.shimano_app.sap_orders_raw` o,
     UNNEST(JSON_EXTRACT_ARRAY(o.lines_json)) AS line
LEFT JOIN sum_lines_orders slo ON slo.doc_entry = o.doc_entry
LEFT JOIN items             it  ON it.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN cliente_app       ca  ON ca.card_code = o.card_code
WHERE COALESCE(o.cancelled, 'tNO') = 'tNO'
