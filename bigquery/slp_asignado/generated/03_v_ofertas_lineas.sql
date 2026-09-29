CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_ofertas_lineas` AS
WITH
cliente_app AS (
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(JSON_VALUE(data, '$.assignedVendor') IGNORE NULLS ORDER BY document_id LIMIT 1)[SAFE_OFFSET(0)] AS assigned_vendor_app
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
items AS (
  SELECT item_code, familia_norm AS familia, subfamilia_norm              AS subfamilia, item_code IS NOT NULL AS is_pesca
  FROM `app-vendedores-shimano.shimano_app.v_sap_items_enriched`
),
sum_lines_sq AS (
  SELECT doc_entry, SUM(SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64)) AS suma_lineas
  FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw`, UNNEST(JSON_QUERY_ARRAY(lines_json)) AS ln
  WHERE cancelled = 'tNO'
  GROUP BY doc_entry
),
-- Dedupe SQ identicas (2026-08-04): mismo card_code + mismo hash de
-- (item_code+cantidad ordenados) + mismo aÃ±o-mes calendario. Los vendedores
-- a veces recargan el mismo pedido varias veces cuando SAP no confirma stock,
-- creando SQ duplicadas que inflan el TOTAL. Ejemplo: SANTIAGO ESTEBAN tenia
-- 3 SQ identicas de RICARDO BLANCO GOITIA en julio (25797/25827/25879, 67
-- lineas c/u, mismo importe) que inflaban su total de \$31M a \$68M.
-- Regla: para cada (card_code, aÃ±o, mes, lines_hash) mantener solo el
-- doc_entry MAS RECIENTE (asumimos que la ultima carga es la version vigente).
-- Preservamos pedidos recurrentes legitimos entre meses porque particionamos
-- por aÃ±o+mes calendario.
sq_fingerprint AS (
  SELECT
    sq.doc_entry, sq.card_code,
    EXTRACT(YEAR FROM sq.doc_date) AS anio,
    EXTRACT(MONTH FROM sq.doc_date) AS mes,
    FARM_FINGERPRINT(STRING_AGG(
      JSON_VALUE(ln, '$.ItemCode') || '|' || CAST(SAFE_CAST(JSON_VALUE(ln, '$.Quantity') AS FLOAT64) AS STRING),
      ',' ORDER BY JSON_VALUE(ln, '$.ItemCode'), SAFE_CAST(JSON_VALUE(ln, '$.Quantity') AS FLOAT64)
    )) AS lines_hash
  FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw` sq,
       UNNEST(JSON_QUERY_ARRAY(sq.lines_json)) AS ln
  WHERE sq.cancelled = 'tNO'
  GROUP BY sq.doc_entry, sq.card_code, sq.doc_date
),
sq_ranked AS (
  SELECT doc_entry,
    ROW_NUMBER() OVER (PARTITION BY card_code, anio, mes, lines_hash ORDER BY doc_entry DESC) AS rank_dup
  FROM sq_fingerprint
),
sq_canonical AS (
  SELECT doc_entry FROM sq_ranked WHERE rank_dup = 1
)
SELECT
  sq.doc_entry,
  sq.doc_num,
  sq.doc_date,
  EXTRACT(YEAR FROM sq.doc_date) AS anio,
  EXTRACT(MONTH FROM sq.doc_date) AS mes,
  sq.card_code,
  sq.card_name,
  sq.sales_person_code,
  JSON_VALUE(line, '$.ItemCode') AS item_code,
  JSON_VALUE(line, '$.Dscription') AS descripcion_linea,
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) AS cantidad,
  SAFE_CAST(JSON_VALUE(line, '$.Price') AS FLOAT64) AS precio_unitario,
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    * (1 - SAFE_DIVIDE(COALESCE(sq.total_discount, 0), NULLIF(slp.suma_lineas, 0))) AS importe_linea_ars,
  it.familia,
  it.subfamilia,
  it.is_pesca,
  sq.doc_currency,
  sq.doc_rate,
  sq.document_status,
  CASE WHEN sq.sales_person_code BETWEEN 50 AND 55 THEN sq.sales_person_code ELSE NULL END AS `SlpCode Asignado`,
  ca.assigned_vendor_app AS assigned_vendor,
  sq._sync_timestamp,

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
    END AS slp_asignado,
  -- slp_documento_sap (2026-09-29 v2): SlpCode del documento SAP,
  -- para analisis. NO se usa para atribucion (ver slp_asignado).
  sq.sales_person_code AS slp_documento_sap
FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw` sq,
     UNNEST(JSON_EXTRACT_ARRAY(sq.lines_json)) AS line
INNER JOIN sq_canonical sc ON sc.doc_entry = sq.doc_entry
LEFT JOIN sum_lines_sq slp ON slp.doc_entry = sq.doc_entry
LEFT JOIN items it ON it.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN cliente_app ca ON ca.card_code = sq.card_code
WHERE COALESCE(sq.cancelled, 'tNO') = 'tNO'
