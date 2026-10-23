-- v_rentabilidad_bike
--
-- Linea factura/NC con costo + venta + metadata producto para rentabilidad Bike.
-- 1 row por (doc_entry, line_num) donde el cliente tiene u_division='1' (BIKE)
-- y la linea tiene item_code NO NULL + qty > 0.
--
-- 2026-10-24 — Cuarta ronda conciliacion Paiva: filtro migrado de
-- COGSCostingCode3='BIK' (por articulo) a bp.u_division='1' (por cliente),
-- criterio Juan Paiva. El filtro viejo dejaba enero-julio 2026 vacios porque
-- los articulos empezaron a cargarse con COGSCostingCode3='BIK' recien en
-- agosto. Rollback snapshot en bigquery/views/v_rentabilidad_bike_pre_filtro_division.sql.
--
-- SHIMANO URUGUAY (CSUR0001) y cuentas EMPL* ENTRAN a la vista (son clientes
-- u_division='1'). Power BI los excluye con tablas de exclusion igual que
-- hace con ENV*/ING_*. La vista es el UNIVERSO COMPLETO de clientes bike.
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
--   * costo_finanzas_ars   OITM.AvgPrice × Qty × sign.
--                          Logica (2026-10-24, PR mes abierto):
--                            * Si el mes de doc_date esta CERRADO (primer lunes
--                              post fin de mes <= CURRENT_DATE ART), usa el
--                              snapshot especifico de ese cierre. Si no existe,
--                              NULL (no se interpola con el mes previo).
--                            * Si el mes de doc_date esta ABIERTO (primer lunes
--                              post fin de mes > CURRENT_DATE ART), usa el
--                              ULTIMO snapshot paiva_import disponible
--                              (snapshot_week_start <= CURRENT_DATE ART).
--                          cost_source filtrado a 'paiva_import%' o
--                          'oitm_avg_price%' en ambos casos.
--                          Los snapshots con cost_source=
--                          'sap_items_bike_raw.cost_avg_ars' NO se usan: esa
--                          fuente es ItemPrices[PriceList=11, Currency=ARS], no
--                          OITM.AvgPrice (0/1327 exactos vs Paiva sep 2026). SL
--                          de Shimano tampoco expone AvgPrice (HTTP 400,
--                          confirmado 2026-10-23 con test_sl_avg_price_singular.py).
--                          Fuente oficial permanente = planilla manual Juan Paiva.
--   * costo_finanzas_fuente STRING. cost_source del snapshot usado (ver arriba).
--                          NULL si no hay snapshot aplicable.
--   * costo_finanzas_cierre BOOL. TRUE si costo_finanzas_ars viene del snapshot
--                          de cierre especifico del mes (ya cerrado y con
--                          planilla cargada). FALSE si es provisorio (mes
--                          abierto, usando ultimo snapshot disponible). NULL si
--                          no hay snapshot aplicable (p.ej. ene-ago 2026 sin
--                          planilla Paiva cargada).
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
),
-- 2026-10-24 segunda ronda: fallback para mes abierto + dedup por prioridad.
-- Reemplaza al antiguo CTE latest_paiva_import (que solo miraba paiva_import%).
-- Ahora acepta oitm_avg_price_sl del job automatico semanal (ver
-- scripts/snapshot_avgprice_sl.py + .github/workflows/snapshot-avgprice-sl.yml).
--
-- Prioridad cuando un mismo item + semana tiene varias fuentes:
--   1. paiva_import_<mes><año>  (cierre oficial de finanzas, ej. paiva_import_sep2026).
--   2. oitm_avg_price_sl_*     (job automatico, prioritario sobre carga manual).
--   3. paiva_import_semanal_*  (carga manual legacy, respaldo si falla el job).
latest_snapshot AS (
  SELECT item_code, cost_avg_ars, cost_source, snapshot_week_start
  FROM (
    SELECT item_code, cost_avg_ars, cost_source, snapshot_week_start,
      ROW_NUMBER() OVER (
        PARTITION BY item_code
        ORDER BY snapshot_week_start DESC,
          CASE
            WHEN cost_source LIKE 'paiva_import%' AND cost_source NOT LIKE 'paiva_import_semanal%' THEN 1
            WHEN cost_source LIKE 'oitm_avg_price_sl%' THEN 2
            WHEN cost_source LIKE 'paiva_import_semanal%' THEN 3
            ELSE 99
          END ASC
      ) AS rn
    FROM `app-vendedores-shimano.shimano_app.costo_snapshot_semanal`
    WHERE (cost_source LIKE 'paiva_import%' OR cost_source LIKE 'oitm_avg_price%')
      AND snapshot_week_start <= CURRENT_DATE('America/Argentina/Buenos_Aires')
  )
  WHERE rn = 1
),
-- 2026-10-24 segunda ronda: red de seguridad para el JOIN de cierre.
-- Deduplica por (item_code, snapshot_week_start) con la misma prioridad que
-- latest_snapshot. Protege contra el caso donde una semana tiene 2 fuentes
-- (ej. paiva_import_sep2026 + oitm_avg_price_sl_20261006): el JOIN directo
-- a costo_snapshot_semanal duplicaria filas, el CTE con ROW_NUMBER = 1 toma
-- la de mayor prioridad.
css_cierre_dedup AS (
  SELECT item_code, snapshot_week_start, cost_avg_ars, cost_source
  FROM (
    SELECT item_code, snapshot_week_start, cost_avg_ars, cost_source,
      ROW_NUMBER() OVER (
        PARTITION BY item_code, snapshot_week_start
        ORDER BY
          CASE
            WHEN cost_source LIKE 'paiva_import%' AND cost_source NOT LIKE 'paiva_import_semanal%' THEN 1
            WHEN cost_source LIKE 'oitm_avg_price_sl%' THEN 2
            WHEN cost_source LIKE 'paiva_import_semanal%' THEN 3
            ELSE 99
          END ASC
      ) AS rn
    FROM `app-vendedores-shimano.shimano_app.costo_snapshot_semanal`
    WHERE cost_source LIKE 'paiva_import%' OR cost_source LIKE 'oitm_avg_price%'
  )
  WHERE rn = 1
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
  TRUE AS es_bike,                                    -- siempre TRUE: filtro bp.u_division='1' (2026-10-24).
  -- division: BIKE si TODAS las lineas del doc son cogs3='BIK'; MIXTO si combina con otras
  -- (post 2026-10-24: el filtro de la vista ya no limita por cogs3, entonces un doc u_div=1 puede
  -- tener lineas BIK + FIS + NULL mezcladas). La columna es diagnostica: 'BIKE' => doc puro bike
  -- por articulo; 'MIXTO' => cliente bike compro tambien productos no-BIK en el mismo doc.
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
  -- Snapshot OITM.AvgPrice (criterio Juan Paiva). Logica:
  --   * Mes CERRADO (primer lunes post fin de mes <= CURRENT_DATE ART):
  --     usa el snapshot de ese cierre (css_cierre). Si no existe, NULL.
  --   * Mes ABIERTO (primer lunes post fin de mes > CURRENT_DATE ART):
  --     usa el ultimo snapshot paiva_import disponible (lp).
  -- Usa doc_date (NO fecha_contable). Ver detalle en cabecera de la vista.
  (
    CASE
      WHEN DATE_ADD(
            LAST_DAY(inv.doc_date, MONTH),
            INTERVAL CASE
              WHEN EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)) = 2 THEN 7
              ELSE MOD(9 - EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)), 7)
            END DAY
          ) <= CURRENT_DATE('America/Argentina/Buenos_Aires')
        THEN css_cierre.cost_avg_ars
      ELSE lp.cost_avg_ars
    END
    * SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)
    * inv.sign
  ) AS costo_finanzas_ars,
  -- cost_source del snapshot efectivamente usado. NULL si no hay.
  CASE
    WHEN DATE_ADD(
          LAST_DAY(inv.doc_date, MONTH),
          INTERVAL CASE
            WHEN EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)) = 2 THEN 7
            ELSE MOD(9 - EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)), 7)
          END DAY
        ) <= CURRENT_DATE('America/Argentina/Buenos_Aires')
      THEN css_cierre.cost_source
    ELSE lp.cost_source
  END AS costo_finanzas_fuente,
  -- TRUE = snapshot especifico del cierre (mes cerrado y con planilla cargada).
  -- FALSE = provisorio (mes abierto, usando ultimo disponible).
  -- NULL = no hay snapshot aplicable (ni cierre ni fallback).
  CASE
    WHEN DATE_ADD(
          LAST_DAY(inv.doc_date, MONTH),
          INTERVAL CASE
            WHEN EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)) = 2 THEN 7
            ELSE MOD(9 - EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)), 7)
          END DAY
        ) <= CURRENT_DATE('America/Argentina/Buenos_Aires')
      THEN
        CASE WHEN css_cierre.cost_avg_ars IS NOT NULL THEN TRUE ELSE NULL END
    ELSE
      CASE WHEN lp.cost_avg_ars IS NOT NULL THEN FALSE ELSE NULL END
  END AS costo_finanzas_cierre,

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
-- (planilla Juan — UNICA fuente activa) o 'oitm_avg_price%' (prefijo reservado
-- por si en el futuro aparece via automatica).
--
-- 2026-10-23 segunda ronda: el workflow semanal
-- .github/workflows/snapshot-costo-semanal.yml y scripts/snapshot_costo_semanal.py
-- fueron ELIMINADOS. Ese job insertaba rows con cost_source=
-- 'sap_items_bike_raw.cost_avg_ars' (= ItemPrices[PriceList=11, Currency=ARS],
-- validacion empirica sep 2026: 0/1327 exactos vs Paiva, solo 10% dentro de
-- 1%). SL de Shimano tampoco expone OITM.AvgPrice (AvgPrice singular y
-- AvgStdPrice ambos HTTP 400 "Property X of 'Item' is invalid"). Fuente
-- oficial permanente = carga manual mensual desde planilla Juan Paiva.
--
-- Resultado: en meses sin planilla Paiva cargada, costo_finanzas_ars queda
-- NULL. NUNCA se "aproxima" con la lista 11.
-- 2026-10-24: JOIN de cierre dedupeado por (item, semana). El CTE
-- css_cierre_dedup ya filtra por cost_source LIKE 'paiva_import%' OR
-- 'oitm_avg_price%' y aplica prioridad por fuente.
LEFT JOIN css_cierre_dedup css_cierre
  ON css_cierre.item_code = JSON_VALUE(line, '$.ItemCode')
  AND css_cierre.snapshot_week_start = DATE_ADD(
    LAST_DAY(inv.doc_date, MONTH),
    INTERVAL CASE
      WHEN EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)) = 2 THEN 7
      ELSE MOD(9 - EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)), 7)
    END DAY
  )
-- 2026-10-24: fallback para mes abierto (ultimo snapshot <= today), tambien
-- dedupeado por prioridad en el CTE latest_snapshot (renombrado desde
-- latest_paiva_import para reflejar que acepta oitm_avg_price_sl).
LEFT JOIN latest_snapshot lp
  ON lp.item_code = JSON_VALUE(line, '$.ItemCode')
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
  AND bp.u_division = '1'
  AND JSON_VALUE(line, '$.ItemCode') IS NOT NULL
  AND SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) > 0
