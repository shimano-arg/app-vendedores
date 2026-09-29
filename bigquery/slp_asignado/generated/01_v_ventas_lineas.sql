CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_ventas_lineas` AS
WITH prov_lookup AS (
  SELECT card_code, provincia AS provincia_raw
  FROM (
    SELECT card_code, provincia, priority,
           ROW_NUMBER() OVER (PARTITION BY card_code ORDER BY priority) AS rn
    FROM (
      SELECT
        JSON_VALUE(data, '$.cardCodeSap') AS card_code,
        UPPER(TRIM(JSON_VALUE(data, '$.provincia'))) AS provincia,
        1 AS priority
      FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
      WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
        AND JSON_VALUE(data, '$.provincia') IS NOT NULL
        AND JSON_VALUE(data, '$.provincia') NOT IN ('(sin provincia)', '')
      UNION ALL
      SELECT
        JSON_VALUE(data, '$.sapCardCode') AS card_code,
        UPPER(TRIM(JSON_VALUE(data, '$.provincia'))) AS provincia,
        2 AS priority
      FROM `app-vendedores-shimano.shimano_app.client_master_raw_raw_latest`
      WHERE JSON_VALUE(data, '$.sapCardCode') IS NOT NULL
        AND JSON_VALUE(data, '$.provincia') NOT IN ('(sin provincia)', '', NULL)
    )
    WHERE card_code IS NOT NULL
  )
  WHERE rn = 1
),
cliente_app AS (
  -- v311+ (2026-07-22): assignedVendor de la app como fuente de verdad
  -- del vendedor real (independiente del SlpCode con el que se cargo la
  -- factura en SAP). Ver v_facturas_sap para contexto completo.
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
-- v367+ (2026-07-30): UNION ALL con Credit Notes multiplicando cantidad e
-- importes por sign=-1 para que las NCs resten automaticamente cualquier
-- SUM(cantidad) o SUM(importe_linea_ars) en PBI. Sin este UNION, las NCs
-- no se veian en el pipeline (endpoint SAP separado /b1s/v1/CreditNotes)
-- y las cards de facturacion sobreestimaban el total. Bug reportado por
-- Mariano 2026-07-30: Santiago $29M vs $18.9M real (NC RC 1810 -$10.1M
-- no restaba).
invoices_and_cns AS (
  SELECT *, 1 AS sign, 'INVOICE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`
  UNION ALL
  SELECT *, -1 AS sign, 'CREDIT_NOTE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw`
),
-- v1073 (2026-09-25): fecha_contable — atribuir NC al mes de la FACTURA
-- ORIGINAL. Ver comentario paralelo en v_facturas_sap para el fundamento.
-- Vinculo: RIN1.BaseType=13 (OINV) + RIN1.BaseEntry=OINV.DocEntry.
-- Si una NC referencia multiples facturas por sus lineas, se toma MIN.
-- MALALCO FLY SHOP: NC 1905 (22/09) contra INVOICE 18689 (21/08) →
-- fecha_contable de ambos = 2026-08-21 → neto agosto = $0.
nc_base_dates AS (
  SELECT
    nc.doc_entry AS nc_doc_entry,
    MIN(base_inv.doc_date) AS factura_base_doc_date
  FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw` nc,
       UNNEST(JSON_EXTRACT_ARRAY(nc.lines_json)) AS nc_line
  JOIN `app-vendedores-shimano.shimano_app.sap_invoices_raw` base_inv
    ON base_inv.doc_entry = SAFE_CAST(JSON_VALUE(nc_line, '$.BaseEntry') AS INT64)
    AND SAFE_CAST(JSON_VALUE(nc_line, '$.BaseType') AS INT64) = 13
  GROUP BY nc.doc_entry
),
-- v388.1 (2026-08-04): suma de LineTotal por doc, para prorratear el
-- descuento global de cabecera (total_discount) al importe de cada linea.
-- Sin este prorrateo, v_ventas_lineas mostraba el importe SIN restar el
-- descuento global (que en Shimano suele ser 17%), sobreestimando la
-- facturacion. Ejemplo: fact 18262 tenia doc_total=$33.6M pero suma de
-- LineTotal=$32.8M porque el descuento de 17% ($5.6M) va a la cuenta
-- contable 'Descuentos Concedidos' aparte. El Mayor Contable de la
-- cuenta FISH refleja el NETO post-descuento; nuestro reporte tambien
-- deberia. Fix confirmado con Mariano 2026-08-04.
sum_lines_per_doc AS (
  SELECT
    doc_kind,
    doc_entry,
    SUM(SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64)) AS suma_lineas
  FROM invoices_and_cns,
       UNNEST(JSON_EXTRACT_ARRAY(lines_json)) AS ln
  GROUP BY doc_kind, doc_entry
)
SELECT
  inv.doc_entry,
  inv.doc_num,
  inv.doc_kind,                                                         -- v367+: 'INVOICE' | 'CREDIT_NOTE'
  inv.doc_date,
  EXTRACT(YEAR  FROM inv.doc_date) AS anio,
  EXTRACT(MONTH FROM inv.doc_date) AS mes,
  -- v1073 (2026-09-25): fecha_contable / mes_contable / anio_contable
  -- + nc_sin_base. Netean NCs contra el mes de la factura original.
  -- DATETIME() wrap para evitar el bug de Storage Read API con DATE puro.
  DATETIME(
    CASE
      WHEN inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  )                                                                     AS fecha_contable,
  EXTRACT(YEAR FROM
    CASE
      WHEN inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  )                                                                     AS anio_contable,
  EXTRACT(MONTH FROM
    CASE
      WHEN inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  )                                                                     AS mes_contable,
  (inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NULL)  AS nc_sin_base,
  inv.card_code,
  inv.card_name,
  inv.sales_person_code,
  JSON_VALUE(line, '$.ItemCode')                                        AS item_code,
  JSON_VALUE(line, '$.Dscription')                                      AS descripcion_linea,
  -- v367+: cantidad y montos multiplicados por sign para que CNs resten.
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) * inv.sign       AS cantidad,
  SAFE_CAST(JSON_VALUE(line, '$.Price') AS FLOAT64)                     AS precio_unitario,
  -- v388.1 (2026-08-04): importe_linea_ars ahora es NETO post-descuento
  -- global de cabecera. Fórmula: LineTotal * sign * (1 - total_discount / suma_lineas).
  -- Antes daba $283M (bruto), ahora da $254M (matchea Mayor Contable FISH).
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign
    * (1 - SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma_lineas, 0)))
                                                                        AS importe_linea_ars,
  -- v302+ (2026-07-21): prorrateo cobrado/deuda por linea.
  -- Permite en PBI:
  --   [Cobrado ARS] = CALCULATE(SUM(cobrado_prorrateado_ars), is_pesca=TRUE)
  --   [Deuda ARS]   = CALCULATE(SUM(deuda_prorrateada_ars),   is_pesca=TRUE)
  -- que suman exactamente [Facturacion Total] (que usa importe_linea_ars).
  -- Prorrateo lineal: cobrado_linea = importe_linea_neto * (paid_to_date / doc_total).
  -- v388.1: aplica sobre el importe NETO (post descuento global) para mantener
  -- la consistencia con importe_linea_ars.
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign
    * (1 - SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma_lineas, 0)))
    * SAFE_DIVIDE(inv.paid_to_date, inv.doc_total)                      AS cobrado_prorrateado_ars,
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign
    * (1 - SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma_lineas, 0)))
    * SAFE_DIVIDE(inv.doc_total - COALESCE(inv.paid_to_date, 0), inv.doc_total)
                                                                        AS deuda_prorrateada_ars,
  JSON_VALUE(line, '$.WarehouseCode')                                   AS warehouse_code,
  -- Categorizacion del catalogo (join con items).
  -- Parche encoding: el catalogo embebido en index.html perdio acentos/enies
  -- (bytes latin-1 leidos como UTF-8 -> U+FFFD). Reemplazamos los patrones
  -- mas comunes para que Power BI muestre "Cania"/"Accion"/etc. correctos.
  -- Fix definitivo pendiente en el build del catalogo maestro.
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    it.item_name,
    'Ca�as', 'Cañas'),
    'Ca�a',  'Caña'),
    'Tama�o','Tamaño'),
    'Se�uelo','Señuelo'),
    'Acci�n','Acción'),
    'visi�n','visión'),
    'Multifunci�n','Multifunción'),
    'C�digo','Código'),
    'Jap�n','Japón'),
    'Telesc�pica','Telescópica'),
    'Se�al','Señal'),
    'a�os','años'),
    'a�o','año'),
    '�',     '')                                                    AS item_name_catalogo,
  it.familia_norm                                                       AS familia,
  it.subfamilia_norm                                                    AS subfamilia,
  it.sub                                                                AS sub_subfamilia,
  -- is_pesca = TRUE si el SKU existe en sap_items_raw (grupo 102 PESCA).
  -- Permite filtrar en PBI para vistas PESCA-solo vs Shimano-entera.
  it.item_code IS NOT NULL                                              AS is_pesca,
  -- Provincia canonizada del cliente (para mapa/ranking por region).
  CASE
    WHEN prov.provincia_raw IN ('CIUDAD AUTÓNOMA DE BUENOS AIRES',
                                'CAPITAL FEDERAL',
                                'CIUDAD DE BUENOS AIRES') THEN 'CABA'
    WHEN prov.provincia_raw = 'CÓRDOBA'    THEN 'CORDOBA'
    WHEN prov.provincia_raw = 'ENTRE RÍOS' THEN 'ENTRE RIOS'
    WHEN prov.provincia_raw = 'TUCUMÁN'    THEN 'TUCUMAN'
    WHEN prov.provincia_raw = 'RÍO NEGRO'  THEN 'RIO NEGRO'
    WHEN prov.provincia_raw = 'NEUQUÉN'    THEN 'NEUQUEN'
    ELSE prov.provincia_raw
  END                                                                   AS provincia_cliente,
  -- v311+ (2026-07-22): vendedor real del cliente segun la app (fuente
  -- de verdad del negocio). Usar en slicers PBI en lugar del SlpCode
  -- SAP que esta inconsistente en decenas de facturas.
  ca.assigned_vendor_app                                                AS assigned_vendor,
  inv._sync_timestamp,
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
  inv.sales_person_code AS slp_documento_sap
FROM invoices_and_cns inv,
UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS line
LEFT JOIN sum_lines_per_doc slp
  ON slp.doc_kind = inv.doc_kind AND slp.doc_entry = inv.doc_entry
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` it
  ON it.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN prov_lookup prov
  ON prov.card_code = inv.card_code
LEFT JOIN cliente_app ca
  ON ca.card_code = inv.card_code
-- v1073 (2026-09-25): fecha de la factura original para NCs (netea contra su mes).
LEFT JOIN nc_base_dates ncb
  ON ncb.nc_doc_entry = inv.doc_entry
  AND inv.doc_kind = 'CREDIT_NOTE'
-- v748 (2026-08-31): filtro estricto cancelled='tNO'. Antes: COALESCE(cancelled,'tNO')='tNO'
-- que trataba NULL/vacio como 'tNO' -> incluia los documentos de CANCELACION
-- (SAP crea un doc espejo con CANCELED='' cuando anula una factura). Efecto
-- del bug: Anglers (CardCode C33651833669) agosto 2026 sumaba $16.562.000 con
-- 5 docs cuando la unica valida es DocNum 18840 = $3.312.400. Los DocNum
-- 18824/26/28/39 tienen CANCELED='' y deben excluirse igual que las tYES.
WHERE inv.cancelled = 'tNO'
