-- v_rentabilidad_bike
--
-- Linea factura/NC con costo + venta + metadata producto para rentabilidad Bike.
-- 1 row por (doc_entry, line_num) donde COGSCostingCode3='BIK'.
--
-- Columnas 2026-10-22 (conciliacion Paiva):
--   * division_cliente     OCRD.U_DIVISION del cliente ('1'=BIKE, '2'=PESCA,
--                          '3'=BIKE&PESCA, strings legacy o vacio). Nuevo criterio
--                          "bike por cliente" vs filtro histórico "bike por articulo"
--                          (COGSCostingCode3='BIK'). Ambos criterios conviven: la
--                          vista sigue filtrando por articulo (WHERE), y Power BI
--                          puede sumar division_cliente para alinearse al informe
--                          Juan Paiva (margen bruto mensual).
--   * nro_fiscal           IFNULL(FolNumTo, DocNum). Mismo criterio que Juan.
--   * nro_fiscal_completo  Formato "00003-00043006" cuando FolioPrefixString esta
--                          disponible; sino NULL.
--   * costo_finanzas_ars   OITM.AvgPrice × Qty × sign con snapshot semanal del
--                          primer lunes posterior al ultimo dia del mes de
--                          doc_date (criterio Juan). Lee de costo_snapshot_semanal
--                          FILTRANDO cost_source LIKE 'paiva_import%' o
--                          'oitm_avg_price%' (2026-10-23). Los snapshots con
--                          cost_source='sap_items_bike_raw.cost_avg_ars' NO se
--                          usan porque esa fuente es ItemPrices[PriceList=11,
--                          Currency=ARS], no OITM.AvgPrice real: validacion
--                          empirica contra snapshot Paiva sep 2026 dio 0% de
--                          exactos y solo 10% dentro de 1%. Mientras no entre
--                          Paiva nueva (planilla mensual) o AvgPrice confirmado
--                          via SL, costo_finanzas_ars queda NULL para esos
--                          meses. NUNCA se "aproxima" con la lista 11.
--
-- NOTA — `fecha_contable` es un campo DERIVADO (no es la fecha contable de SAP):
--   * Para FACTURAS: fecha_contable = doc_date (= OINV.DocDate propia).
--   * Para NOTAS DE CREDITO: fecha_contable = DocDate de la factura ORIGINAL
--     (via BaseEntry+BaseType=13). Esto difiere del criterio Juan Paiva, que usa
--     ORIN.DocDate (DocDate propio de la NC). Power BI debe elegir cual usar en el
--     agrupamiento segun el reporte. costo_finanzas_ars siempre usa doc_date
--     (criterio Juan). Para no romper reportes existentes, fecha_contable se
--     preserva intacta.
--
-- Preserva el comportamiento historico EXACTO de las columnas pre-2026-10-22.

WITH invoices_and_cns AS (
  SELECT *, 1 AS sign, 'FACTURA' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`
  UNION ALL
  SELECT *, -1 AS sign, 'NOTA_CREDITO' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw`
),
-- fecha_contable para NCs: mes de la factura original (igual que v_ventas_lineas).
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
-- Suma de LineTotal por documento para prorrateo del dcto cabecera.
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
  -- ====== CLAVES ======
  inv.doc_entry,
  inv.doc_num,
  SAFE_CAST(JSON_VALUE(line, '$.LineNum') AS INT64) AS line_num,
  JSON_VALUE(line, '$.ItemCode') AS item_code,
  inv.card_code,
  inv.sales_person_code,                              -- SlpCode SAP SIN reasignar

  -- ====== FECHAS ======
  inv.doc_date,
  DATE(CASE
    WHEN inv.doc_kind = 'NOTA_CREDITO' AND ncb.factura_base_doc_date IS NOT NULL
      THEN ncb.factura_base_doc_date
    ELSE inv.doc_date
  END) AS fecha_contable,
  EXTRACT(YEAR FROM
    CASE
      WHEN inv.doc_kind = 'NOTA_CREDITO' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  ) AS anio_contable,
  EXTRACT(MONTH FROM
    CASE
      WHEN inv.doc_kind = 'NOTA_CREDITO' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  ) AS mes_contable,

  -- ====== CLASIFICACION ======
  inv.doc_kind,                                       -- 'FACTURA' | 'NOTA_CREDITO'
  TRUE AS es_bike,                                    -- siempre TRUE: filtro COGSCostingCode3=BIK
  -- division: BIKE si TODAS las lineas del doc son BIK; MIXTO si combina con otras.
  -- Proxy del campo "Division" de cabecera que usa Fernando (no se sincroniza al raw).
  CASE
    WHEN (SELECT COUNT(*) FROM UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS l2
          WHERE JSON_VALUE(l2, '$.COGSCostingCode3') != 'BIK') = 0 THEN 'BIKE'
    ELSE 'MIXTO'
  END AS division,
  CAST(NULL AS STRING) AS ssc,                        -- pendiente sync BP; placeholder para esquema estable
  JSON_VALUE(line, '$.PriceSource') AS price_source,  -- dpsManual | dpsActivePriceList

  -- Metadata operativa util para debug (no para agregacion directa)
  inv.card_name,
  inv.sign,                                           -- 1 factura, -1 NC
  inv.doc_currency,
  inv.series,

  -- ====== CANTIDAD + VENTA (importes ARS con signo) ======
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) * inv.sign AS cantidad,
  -- venta_bruta_ars = ARS ANTES del descuento de linea.
  -- NO uso UnitPrice (puede venir en moneda extranjera para doc_currency='USD',
  -- aunque las conversiones ya estan en LineTotal). Baso en LineTotal que esta
  -- siempre en ARS post-conversion por TC del documento.
  -- Si DP>0: venta_bruta = LineTotal / (1 - DP/100). Sino: = LineTotal.
  (
    CASE
      WHEN SAFE_CAST(JSON_VALUE(line, '$.DiscountPercent') AS FLOAT64) > 0
        THEN SAFE_DIVIDE(
          SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64),
          NULLIF(1 - SAFE_CAST(JSON_VALUE(line, '$.DiscountPercent') AS FLOAT64) / 100, 0)
        )
      ELSE SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    END
  ) * inv.sign AS venta_bruta_ars,
  -- dcto_linea_ars = venta_bruta_ars - LineTotal (identidad por construccion).
  (
    CASE
      WHEN SAFE_CAST(JSON_VALUE(line, '$.DiscountPercent') AS FLOAT64) > 0
        THEN SAFE_DIVIDE(
          SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64),
          NULLIF(1 - SAFE_CAST(JSON_VALUE(line, '$.DiscountPercent') AS FLOAT64) / 100, 0)
        )
      ELSE SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    END
    - SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
  ) * inv.sign AS dcto_linea_ars,
  -- venta_post_dcto_linea_ars = LineTotal (= UnitPrice * qty, post dcto linea, pre dcto cabecera)
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign AS venta_post_dcto_linea_ars,
  -- dcto_cabecera_prorrateado_ars = LineTotal * (total_discount / suma_lineas)
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    * SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma_lineas, 0))
    * inv.sign AS dcto_cabecera_prorrateado_ars,
  -- venta_neta_ars = LineTotal * (1 - dcto_cab_prorrateo)
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    * (1 - SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma_lineas, 0)))
    * inv.sign AS venta_neta_ars,
  -- Porcentajes del documento (dato del sistema, no ratios calculados)
  SAFE_CAST(JSON_VALUE(line, '$.DiscountPercent') AS FLOAT64) AS dcto_linea_pct,
  inv.discount_percent AS dcto_cabecera_pct,

  -- ====== COSTOS (importes de linea con signo) ======
  SAFE_CAST(JSON_VALUE(line, '$.GrossBuyPrice') AS FLOAT64)
    * SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)
    * inv.sign AS costo_doc_ars,                      -- GrossBuyPrice del documento
  item_bike.cost_avg_ars
    * SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)
    * inv.sign AS costo_prom_ars,                     -- cost_avg_ars del maestro (lista 11, snapshot continuo)
  item_bike.cost_usd
    * SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)
    * inv.sign AS costo_prom_usd,                     -- cost_usd puro (PBI convierte)
  -- costo_paiva_ars_sep2026: caso de prueba permanente. NULL fuera de Sep 2026 o sin match.
  -- Join con dedupe (ROW_NUMBER=1) sobre bike_test_paiva_sep2026.
  pbt.costo_total_paiva_ars * inv.sign AS costo_paiva_ars_sep2026,

  -- ====== JERARQUIA DE PRODUCTO ======
  item_enriched.familia_norm      AS familia,
  item_enriched.subfamilia_norm   AS subfamilia,
  item_enriched.sub               AS sub_subfamilia,
  item_bike.marca,
  item_bike.mss,
  item_bike.clase,
  item_bike.subcategoria,
  item_bike.modelo,
  -- Jerarquia Fernando: NO sincronizada al pipeline (pedir a Fernando los nombres
  -- de campo SAP exactos). Placeholders para esquema estable.
  CAST(NULL AS STRING) AS product_class,
  CAST(NULL AS STRING) AS product_series,
  CAST(NULL AS STRING) AS part_code,
  CAST(NULL AS STRING) AS model_code,
  CAST(NULL AS STRING) AS size,
  CAST(NULL AS STRING) AS color,

  -- ====== 2026-10-22 CONCILIACION PAIVA ======
  -- OCRD.U_DIVISION del cliente ('1'=BIKE, '2'=PESCA, '3'=BIKE&PESCA, legacy strings).
  -- Permite replicar el filtro "bike por cliente" de Juan Paiva en Power BI.
  bp.u_division AS division_cliente,
  -- IFNULL(FolioNumberTo, DocNum). Para facturas con fiscal AFIP, FolNumTo esta
  -- poblado; sino fallback a doc_num.
  CAST(COALESCE(inv.fol_num_to, inv.doc_num) AS INT64) AS nro_fiscal,
  -- Formato "00003-00043006": prefijo PV (5 digitos) + '-' + fol_num_to (8
  -- digitos). FolioPrefixString viene NULL en SL de Shimano (0/10233 populated,
  -- verificado 2026-10-23). D4 (2026-10-23 opcion B): hardcode series->prefijo
  -- validado contra factura impresa.
  --   series=4 (99.3% facturas) -> '00003' (confirmado Mariano con factura
  --     impresa).
  --   series=5 (0.7% facturas)  -> NULL (sin confirmar; pending David).
  CASE
    WHEN inv.series = 4 AND inv.fol_num_to IS NOT NULL
      THEN '00003-' || LPAD(CAST(inv.fol_num_to AS STRING), 8, '0')
    ELSE NULL
  END AS nro_fiscal_completo,
  -- Snapshot OITM.AvgPrice del primer lunes POSTERIOR al ultimo dia del mes de
  -- doc_date (criterio Juan Paiva). NULL si el snapshot para esa semana todavia
  -- no se cargo a costo_snapshot_semanal. Usa doc_date (NO fecha_contable; ver
  -- nota al tope de la vista) para que el agrupamiento mensual coincida con Juan.
  (
    css.cost_avg_ars
    * SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)
    * inv.sign
  ) AS costo_finanzas_ars,

  -- ====== METADATA ======
  inv._sync_timestamp                                 -- cuando se sincronizo el raw (ver refresh en CONTRATO_PBI.md)
FROM invoices_and_cns inv,
UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS line
LEFT JOIN sum_lines_per_doc slp
  ON slp.doc_kind = inv.doc_kind AND slp.doc_entry = inv.doc_entry
LEFT JOIN nc_base_dates ncb
  ON ncb.nc_doc_entry = inv.doc_entry AND inv.doc_kind = 'NOTA_CREDITO'
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_items_bike_raw` item_bike
  ON item_bike.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` item_enriched
  ON item_enriched.item_code = JSON_VALUE(line, '$.ItemCode')
-- 2026-10-22: JOIN al master para traer OCRD.U_DIVISION (division_cliente).
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
  ON bp.card_code = inv.card_code
-- 2026-10-22: JOIN al snapshot semanal de OITM.AvgPrice (costo_finanzas_ars).
-- snapshot_week_start = primer LUNES posterior al ultimo dia del mes de doc_date.
-- Formula BQ: DAYOFWEEK Mon=2; si last_day_month cae lunes se suma 7 (strict).
--
-- 2026-10-23: FILTRO cost_source. Solo rows con cost_source LIKE 'paiva_import%'
-- (planilla Juan) o 'oitm_avg_price%' (AvgPrice confirmado via SL). Los rows con
-- cost_source='sap_items_bike_raw.cost_avg_ars' (job semanal GHA desde
-- sync_sap_to_bigquery) NO se usan: ese campo es ItemPrices[PriceList=11,
-- Currency=ARS] y no reproduce OITM.AvgPrice (validacion empirica sep 2026:
-- 0/1327 exactos, solo 10% dentro del 1%). Dejamos el job de los lunes
-- corriendo (acumula historia por si en el futuro confirmamos otra fuente),
-- pero esta vista lo ignora. Resultado: en meses sin planilla Paiva ni
-- AvgPrice confirmado, costo_finanzas_ars queda NULL (no se aproxima).
LEFT JOIN `app-vendedores-shimano.shimano_app.costo_snapshot_semanal` css
  ON css.item_code = JSON_VALUE(line, '$.ItemCode')
  AND css.snapshot_week_start = DATE_ADD(
    LAST_DAY(inv.doc_date, MONTH),
    INTERVAL CASE
      WHEN EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)) = 2 THEN 7
      ELSE MOD(9 - EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)), 7)
    END DAY
  )
  AND (
    css.cost_source LIKE 'paiva_import%'
    OR css.cost_source LIKE 'oitm_avg_price%'
  )
LEFT JOIN (
  SELECT card_code, item_code, fecha_contab, cantidad, costo_total_paiva_ars
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY card_code, item_code, fecha_contab, CAST(cantidad AS STRING)
        ORDER BY nro_factura
      ) AS rn
    FROM `app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026`
  )
  WHERE rn = 1
) pbt
  ON pbt.card_code = inv.card_code
  AND pbt.item_code = JSON_VALUE(line, '$.ItemCode')
  AND pbt.fecha_contab = inv.doc_date
  AND pbt.cantidad = SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)
  AND inv.doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
WHERE inv.cancelled = 'tNO'
  AND JSON_VALUE(line, '$.COGSCostingCode3') = 'BIK'
