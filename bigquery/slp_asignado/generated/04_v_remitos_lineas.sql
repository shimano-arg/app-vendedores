CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_remitos_lineas` AS
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
  -- v_sap_items_enriched no tiene columnas 'familia'/'subfamilia'/'is_pesca'
  -- directas; se derivan como en v_ventas_lineas: familia=familia_norm,
  -- subfamilia=fam, is_pesca=item_code IS NOT NULL (existe en sap_items_raw).
  SELECT
    item_code,
    familia_norm                 AS familia,
    subfamilia_norm              AS subfamilia,
    item_code IS NOT NULL        AS is_pesca
  FROM `app-vendedores-shimano.shimano_app.v_sap_items_enriched`
),
-- v388.1 (2026-08-04): sumas de LineTotal por doc para aplicar prorrateo
-- del descuento global de cabecera (total_discount). Mismo criterio que
-- v_ventas_lineas para mantener coherencia entre Facturado y Remitido.
sum_lines_deliveries AS (
  SELECT doc_entry, SUM(SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64)) AS suma_lineas
  FROM `app-vendedores-shimano.shimano_app.sap_deliveries_raw`,
       UNNEST(JSON_QUERY_ARRAY(lines_json)) AS ln
  WHERE cancelled = 'tNO'
  GROUP BY doc_entry
),
sum_lines_returns AS (
  SELECT doc_entry, SUM(SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64)) AS suma_lineas
  FROM `app-vendedores-shimano.shimano_app.sap_returns_raw`,
       UNNEST(JSON_QUERY_ARRAY(lines_json)) AS ln
  WHERE cancelled = 'tNO'
  GROUP BY doc_entry
),
sum_lines_invoices AS (
  SELECT doc_entry, SUM(SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64)) AS suma_lineas
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`,
       UNNEST(JSON_QUERY_ARRAY(lines_json)) AS ln
  WHERE cancelled = 'tNO'
  GROUP BY doc_entry
),
deliveries AS (
  SELECT
    'DELIVERY' AS source,
    d.doc_entry                                                       AS remito_doc_entry,
    d.doc_num                                                         AS remito_doc_num,
    d.doc_date,
    EXTRACT(YEAR  FROM d.doc_date)                                    AS anio,
    EXTRACT(MONTH FROM d.doc_date)                                    AS mes,
    d.card_code,
    d.card_name,
    d.sales_person_code,
    d.doc_currency,
    d.doc_rate,
    SAFE_CAST(JSON_VALUE(ln, '$.LineNum')    AS INT64)                AS line_num,
    JSON_VALUE(ln, '$.ItemCode')                                      AS item_code,
    JSON_VALUE(ln, '$.Dscription')                                    AS descripcion_linea,
    SAFE_CAST(JSON_VALUE(ln, '$.Quantity')   AS FLOAT64)              AS cantidad,
    -- v388.1 (2026-08-04): importe NETO post-descuento global cabecera.
    SAFE_CAST(JSON_VALUE(ln, '$.LineTotal')  AS FLOAT64)
      * (1 - SAFE_DIVIDE(COALESCE(d.total_discount, 0), NULLIF(sld.suma_lineas, 0)))
                                                                      AS importe_linea_ars,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseType')   AS INT64)                AS base_type,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry')  AS INT64)                AS base_entry,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseLine')   AS INT64)                AS base_line
  FROM `app-vendedores-shimano.shimano_app.sap_deliveries_raw` d,
       UNNEST(JSON_QUERY_ARRAY(d.lines_json)) AS ln
  LEFT JOIN sum_lines_deliveries sld ON sld.doc_entry = d.doc_entry
  WHERE d.cancelled = 'tNO'
  UNION ALL
  SELECT
    'RETURN' AS source,
    r.doc_entry                                                       AS remito_doc_entry,
    r.doc_num                                                         AS remito_doc_num,
    r.doc_date,
    EXTRACT(YEAR  FROM r.doc_date)                                    AS anio,
    EXTRACT(MONTH FROM r.doc_date)                                    AS mes,
    r.card_code,
    r.card_name,
    r.sales_person_code,
    r.doc_currency,
    r.doc_rate,
    SAFE_CAST(JSON_VALUE(ln, '$.LineNum')    AS INT64)                AS line_num,
    JSON_VALUE(ln, '$.ItemCode')                                      AS item_code,
    JSON_VALUE(ln, '$.Dscription')                                    AS descripcion_linea,
    -- Cantidad e importe con sign=-1 para restar del total.
    SAFE_CAST(JSON_VALUE(ln, '$.Quantity')   AS FLOAT64) * -1         AS cantidad,
    -- v388.1: importe NETO post-descuento con sign=-1.
    SAFE_CAST(JSON_VALUE(ln, '$.LineTotal')  AS FLOAT64) * -1
      * (1 - SAFE_DIVIDE(COALESCE(r.total_discount, 0), NULLIF(slr.suma_lineas, 0)))
                                                                      AS importe_linea_ars,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseType')   AS INT64)                AS base_type,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry')  AS INT64)                AS base_entry,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseLine')   AS INT64)                AS base_line
  FROM `app-vendedores-shimano.shimano_app.sap_returns_raw` r,
       UNNEST(JSON_QUERY_ARRAY(r.lines_json)) AS ln
  LEFT JOIN sum_lines_returns slr ON slr.doc_entry = r.doc_entry
  WHERE r.cancelled = 'tNO'
),
invoices_sin_delivery AS (
  SELECT
    'INVOICE_NO_DELIVERY' AS source,
    i.doc_entry                                                       AS remito_doc_entry,
    i.doc_num                                                         AS remito_doc_num,
    i.doc_date,
    EXTRACT(YEAR  FROM i.doc_date)                                    AS anio,
    EXTRACT(MONTH FROM i.doc_date)                                    AS mes,
    i.card_code,
    i.card_name,
    i.sales_person_code,
    i.doc_currency,
    i.doc_rate,
    SAFE_CAST(JSON_VALUE(ln, '$.LineNum')    AS INT64)                AS line_num,
    JSON_VALUE(ln, '$.ItemCode')                                      AS item_code,
    JSON_VALUE(ln, '$.Dscription')                                    AS descripcion_linea,
    SAFE_CAST(JSON_VALUE(ln, '$.Quantity')   AS FLOAT64)              AS cantidad,
    -- v388.1: importe NETO post-descuento global de cabecera.
    SAFE_CAST(JSON_VALUE(ln, '$.LineTotal')  AS FLOAT64)
      * (1 - SAFE_DIVIDE(COALESCE(i.total_discount, 0), NULLIF(sli.suma_lineas, 0)))
                                                                      AS importe_linea_ars,
    17                                                                AS base_type,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry')  AS INT64)                AS base_entry,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseLine')   AS INT64)                AS base_line
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` i,
       UNNEST(JSON_QUERY_ARRAY(i.lines_json)) AS ln
  LEFT JOIN sum_lines_invoices sli ON sli.doc_entry = i.doc_entry
  WHERE i.cancelled = 'tNO'
    AND JSON_VALUE(ln, '$.BaseType') = '17'    -- solo lineas que vienen de SO
    -- v386.3 (2026-08-04) MATCH DETERMINISTA CONFIRMADO POR SANTI (SEIDOR):
    -- En Shimano el flujo real es SO -> Invoice -> Delivery (94% de casos,
    -- 4478 de 4743 deliveries en 12 meses). Las lineas del Delivery tienen
    -- BaseType=13 (A/R Invoice) + BaseEntry=Invoice.DocEntry, no SO como
    -- yo asumia. Reemplaza la heuristica Â±10 dias de v386.1.
    AND NOT EXISTS (
      SELECT 1
      FROM deliveries d
      WHERE d.source = 'DELIVERY'
        AND d.base_type = 13
        AND d.base_entry = i.doc_entry
    )
    -- Match secundario canonico (5%): flujo SO -> Delivery. Delivery
    -- apunta al mismo SO+line que la factura via BaseType=17.
    AND NOT EXISTS (
      SELECT 1
      FROM deliveries d
      WHERE d.source = 'DELIVERY'
        AND d.base_type = 17
        AND d.base_entry = SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry') AS INT64)
        AND d.base_line  = SAFE_CAST(JSON_VALUE(ln, '$.BaseLine')  AS INT64)
    )
),
unioned AS (
  SELECT * FROM deliveries
  UNION ALL
  SELECT * FROM invoices_sin_delivery
)
SELECT
  u.source,
  u.remito_doc_entry,
  u.remito_doc_num,
  u.doc_date,
  u.anio,
  u.mes,
  u.card_code,
  u.card_name,
  u.item_code,
  u.descripcion_linea,
  u.cantidad,
  u.importe_linea_ars,
  it.is_pesca,
  it.familia,
  it.subfamilia,
  u.sales_person_code,
  CASE
    WHEN u.sales_person_code BETWEEN 50 AND 55 THEN u.sales_person_code
    ELSE NULL
  END                              AS `SlpCode Asignado`,
  ca.assigned_vendor_app           AS assigned_vendor,
  -- v386.3: base_type indica a que apunta el Delivery/Return/Invoice-fallback:
  --   13 = A/R Invoice (94% de deliveries Shimano â€” flujo SO->Invoice->Delivery)
  --   17 = Sales Order (5% de deliveries â€” flujo canonico SO->Delivery->Invoice)
  --   23 = Sales Quotation
  u.base_type,
  u.base_entry,
  u.base_line,
  u.doc_currency,
  u.doc_rate,

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
  u.sales_person_code AS slp_documento_sap
FROM unioned u
LEFT JOIN items       it ON it.item_code = u.item_code
LEFT JOIN cliente_app ca ON ca.card_code = u.card_code
