-- v_rentabilidad_pesca
--
-- Linea factura/NC con costo + venta + metadata producto para rentabilidad PESCA.
-- 1 row por (doc_entry, doc_kind, line_num) donde el cliente tiene u_division='2'
-- (PESCA) y la linea tiene item_code NO NULL + qty > 0.
--
-- 2026-11-05 (Fase 2): creacion inicial. Espejo de v_rentabilidad_bike con filtro
-- por cliente (u_division='2') y join a sap_items_raw (grupo 102). Opcion B
-- arquitectural: archivo nuevo, NO toca v_rentabilidad_bike. Confirmacion Mariano:
-- "Arquitectura Opcion B. Archivo nuevo v_rentabilidad_pesca.sql, sin tocar bike."
--
-- DISCLAIMER COSTO (confirmado Mariano 2026-11-05):
--   El costo_finanzas_ars viene de oitm_avg_price_sl_<YYYYMMDD> (AvgPrice de
--   OITM en SAP SL). Juan Paiva NO hace informe de margen pesca, entonces esta
--   fuente NO esta reconciliada con finanzas (a diferencia de bike, que tiene
--   paiva_import_<mes><ano> como cierre oficial). Power BI debe mostrar nota al
--   lado de las cards: "costo = AvgPrice SL, no reconciliado con finanzas".
--
-- CLIENTES EXCLUIDOS: u_division='3' (mixto, FOLCA S.R.L + GOMAR GUSTAVO ADRIAN
-- en el padron 2026-11-05). 34 lineas / $3.345.900 anuales / 0.20% del volumen.
-- Replica el criterio Juan Paiva de bike. Si en el futuro se necesitan incluir,
-- extender el filtro a:
--   AND (bp.u_division = '2' OR (bp.u_division = '3' AND it.items_group_code = 102))
--
-- COBERTURA COSTO (sanity 2026-11-05):
--   Octubre 2026: 100% (416 items / 416 con AvgPrice en oitm_avg_price_sl_20261102).
--   Pre-octubre: NULL (no hay snapshot con pesca antes del 2026-10-19).
--
-- GRANO UNICO: (doc_entry, doc_kind, line_num).
--
-- NOTA — fecha_contable es DERIVADO (mismo criterio que v_rentabilidad_bike):
--   * Facturas: fecha_contable = doc_date.
--   * NCs: fecha_contable = doc_date de la factura original (via BaseEntry+BaseType=13).

WITH invoices_and_cns AS (
  SELECT *, 1 AS sign, 'FACTURA' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`
  UNION ALL
  SELECT *, -1 AS sign, 'NOTA_CREDITO' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw`
),
-- fecha_contable para NCs: mes de la factura original (igual que v_ventas_lineas + bike).
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
-- Fallback para mes abierto + dedup por prioridad de fuente (verbatim bike).
-- Prioridad cuando un mismo item + semana tiene varias fuentes:
--   1. paiva_import_<mes><ano>  (cierre oficial finanzas; en pesca NO existe hoy,
--      pero se preserva la prioridad por si Juan arranca a cargar pesca manual).
--   2. oitm_avg_price_sl_*      (job automatico semanal).
--   3. paiva_import_semanal_*   (carga manual legacy).
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
-- Red de seguridad para el JOIN de cierre: dedup por (item, semana).
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
  TRUE AS es_pesca,                                   -- siempre TRUE: filtro bp.u_division='2'
  'PESCA' AS division,                                -- fijo: pesca no tiene equivalente a cogs3='BIK'/'FIS'
  CAST(NULL AS STRING) AS ssc,                        -- placeholder (pendiente sync BP)
  JSON_VALUE(line, '$.PriceSource') AS price_source,  -- dpsManual | dpsActivePriceList

  -- Metadata operativa util para debug (no para agregacion directa)
  inv.card_name,
  inv.sign,                                           -- 1 factura, -1 NC
  inv.doc_currency,
  inv.series,

  -- ====== CANTIDAD + VENTA (importes ARS con signo) ======
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) * inv.sign AS cantidad,
  -- venta_bruta_ars = ARS ANTES del descuento de linea (= LineTotal / (1 - DP/100) si DP>0).
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
  -- venta_post_dcto_linea_ars = LineTotal (post dcto linea, pre dcto cabecera).
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign AS venta_post_dcto_linea_ars,
  -- dcto_cabecera_prorrateado_ars = LineTotal * (total_discount / suma_lineas) * sign
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    * SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma_lineas, 0))
    * inv.sign AS dcto_cabecera_prorrateado_ars,
  -- venta_neta_ars = LineTotal * (1 - dcto_cab_prorrateo) * sign
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)
    * (1 - SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma_lineas, 0)))
    * inv.sign AS venta_neta_ars,
  -- Porcentajes del documento (dato del sistema)
  SAFE_CAST(JSON_VALUE(line, '$.DiscountPercent') AS FLOAT64) AS dcto_linea_pct,
  inv.discount_percent AS dcto_cabecera_pct,

  -- ====== COSTOS (importes de linea con signo) ======
  SAFE_CAST(JSON_VALUE(line, '$.GrossBuyPrice') AS FLOAT64)
    * SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)
    * inv.sign AS costo_doc_ars,                      -- GrossBuyPrice del voucher SAP

  -- costo_finanzas_ars: OITM.AvgPrice x Qty x sign, con logica mes cerrado vs abierto.
  -- Mes CERRADO (primer lunes post fin de mes <= CURRENT_DATE ART): snapshot del cierre.
  -- Mes ABIERTO: ultimo snapshot disponible (fallback).
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
  -- TRUE = snapshot especifico del cierre.
  -- FALSE = provisorio (mes abierto).
  -- NULL = no hay snapshot aplicable (p.ej. meses sin cobertura o item nuevo).
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

  -- ====== JERARQUIA DE PRODUCTO (PESCA) ======
  -- Mapeo confirmado por Mariano:
  --   familia         ← v_sap_items_enriched.familia_norm
  --   subfamilia      ← v_sap_items_enriched.subfamilia_norm
  --   sub_subfamilia  ← sap_items_raw.cat
  --   ciclo_producto  (columna especifica pesca, expuesta)
  --   pesca_categoria (columna especifica pesca = cat raw)
  -- Columnas bike-only (marca, mss, clase, subcategoria, modelo, product_class,
  -- product_series, part_code, model_code, size, color) ELIMINADAS por decision
  -- Mariano: "eliminar (no dejar NULL)".
  item_enriched.familia_norm      AS familia,
  item_enriched.subfamilia_norm   AS subfamilia,
  item_raw.cat                    AS sub_subfamilia,
  item_raw.ciclo_producto         AS ciclo_producto,
  item_raw.cat                    AS pesca_categoria,

  -- ====== CONCILIACION / FISCAL ======
  -- OCRD.U_DIVISION del cliente (siempre '2' por filtro; se expone igual para consistencia con bike).
  bp.u_division AS division_cliente,
  -- IFNULL(FolioNumberTo, DocNum). Mismo criterio Juan Paiva que bike.
  CAST(COALESCE(inv.fol_num_to, inv.doc_num) AS INT64) AS nro_fiscal,
  -- Formato "00003-XXXXXXXX". Hardcode series=4 -> '00003' confirmado con factura impresa (bike).
  CASE
    WHEN inv.series = 4 AND inv.fol_num_to IS NOT NULL
      THEN '00003-' || LPAD(CAST(inv.fol_num_to AS STRING), 8, '0')
    ELSE NULL
  END AS nro_fiscal_completo,

  -- ====== METADATA ======
  inv._sync_timestamp                                 -- cuando se sincronizo el raw
FROM invoices_and_cns inv,
UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS line
LEFT JOIN sum_lines_per_doc slp
  ON slp.doc_kind = inv.doc_kind AND slp.doc_entry = inv.doc_entry
LEFT JOIN nc_base_dates ncb
  ON ncb.nc_doc_entry = inv.doc_entry AND inv.doc_kind = 'NOTA_CREDITO'
-- sap_items_raw = grupo 102 (pesca). NO joinear a sap_items_bike_raw.
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_items_raw` item_raw
  ON item_raw.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` item_enriched
  ON item_enriched.item_code = JSON_VALUE(line, '$.ItemCode')
-- Master cliente para filtro u_division='2'.
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
  ON bp.card_code = inv.card_code
-- Snapshot de cierre: primer lunes posterior al ultimo dia del mes de doc_date.
LEFT JOIN css_cierre_dedup css_cierre
  ON css_cierre.item_code = JSON_VALUE(line, '$.ItemCode')
  AND css_cierre.snapshot_week_start = DATE_ADD(
    LAST_DAY(inv.doc_date, MONTH),
    INTERVAL CASE
      WHEN EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)) = 2 THEN 7
      ELSE MOD(9 - EXTRACT(DAYOFWEEK FROM LAST_DAY(inv.doc_date, MONTH)), 7)
    END DAY
  )
-- Fallback mes abierto.
LEFT JOIN latest_snapshot lp
  ON lp.item_code = JSON_VALUE(line, '$.ItemCode')
WHERE inv.cancelled = 'tNO'
  AND bp.u_division = '2'
  AND JSON_VALUE(line, '$.ItemCode') IS NOT NULL
  AND SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) > 0
