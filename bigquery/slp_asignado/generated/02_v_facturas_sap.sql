CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_facturas_sap` AS
WITH bike_items AS (
  -- 2026-09-09 v2: universo de item_codes bike (grupo SAP 100, ~7k items).
  SELECT DISTINCT item_code
  FROM `app-vendedores-shimano.shimano_app.sap_items_bike_raw`
),
-- 2026-09-09 v4 (BI feedback): es_bike es del CLIENTE, no de la factura.
-- Cliente es bike si CUALQUIERA de sus facturas historicas tuvo al menos
-- una linea con item bike. Congruente con la medida "Es Bike" del modelo
-- Power BI. Marcar por factura (v2/v3) daba 200M vs los 89M que espera
-- el tablero â€” dos definiciones de negocio distintas.
clientes_bike AS (
  SELECT DISTINCT inv.card_code
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv,
       UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json, '$')) AS line_json
  INNER JOIN bike_items bi
    ON JSON_VALUE(line_json, '$.ItemCode') = bi.item_code
  WHERE inv.card_code IS NOT NULL
),
cliente_app AS (
  -- v311+ (2026-07-22): traer el assignedVendor de la app desde
  -- client_applications. Solucion al problema del SlpCode SAP inconsistente:
  -- SAP tiene facturas cargadas con SlpCode incorrectos (49=Mariano admin,
  -- 54=Federico cuando el cliente es de Martin, etc). El assignedVendor
  -- de la app es la fuente de verdad del negocio. Filtrar por este campo
  -- en PBI muestra las facturas del vendedor real, no del que qued
  -- registrado en la carga SAP.
  -- 2026-09-11: agregado coverage_by + coverage_trial_end_date para el
  -- trial de PACHI (3 meses hasta 2026-12-11). Diego confirmo que Pachi no
  -- es empleado; SAP factura como SANTI (assigned_vendor_app='SANTIAGO
  -- ESTEBAN') pero coverageBy='PACHI' permite reporting operativo separado.
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      JSON_VALUE(data, '$.assignedVendor')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS assigned_vendor_app,
    ARRAY_AGG(
      JSON_VALUE(data, '$.coverageBy')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS coverage_by,
    ARRAY_AGG(
      JSON_VALUE(data, '$.coverageTrialEndDate')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS coverage_trial_end_date
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
-- v367+ (2026-07-30): UNION ALL con Credit Notes para que las NCs resten
-- automaticamente del Remitido/Facturado/Deuda en Power BI. Sin este UNION,
-- las NCs quedan invisibles y el reporte sobreestima ventas. sign=-1 en CNs
-- negando doc_total/paid_to_date/total_discount asegura que cualquier
-- SUM(doc_total) en PBI ya venga con las devoluciones aplicadas.
invoices_and_cns AS (
  SELECT *, 1 AS sign, 'INVOICE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`
  UNION ALL
  SELECT *, -1 AS sign, 'CREDIT_NOTE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw`
),
-- v1073 (2026-09-25): fecha_contable â€” atribuir NC al mes de la FACTURA
-- ORIGINAL que reversa, no a la fecha de emision de la NC. Sin esto, una
-- NC del 22/09 contra una factura del 21/08 restaba en septiembre y no
-- neteaba contra agosto. Ejemplo: MALALCO FLY SHOP INVOICE 18689
-- (2026-08-21, +68 u, +$4.016.138) + CREDIT_NOTE 1905 (2026-09-22, -68 u,
-- -$4.016.138): con fecha_contable ambos caen en agosto 2026 â†’ neto $0
-- correcto.
-- Vinculo SAP: cada linea de NC tiene BaseType=13 (OINV) + BaseEntry
-- apuntando al OINV.DocEntry de la factura original. Un doc de NC puede
-- referenciar 1..N facturas por sus lineas â€” usamos MIN(doc_date) por si
-- hay multiples (comportamiento razonable: atribuir al mes de la primera
-- factura reversa).
-- Si la NC no tiene BaseType=13 valido (ej: NC directa sin factura base),
-- se marca con nc_sin_base=TRUE mas abajo y fecha_contable cae al doc_date
-- de la NC como fallback.
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
)
SELECT
  inv.doc_type,
  inv.doc_kind,                                                       -- v367+: 'INVOICE' | 'CREDIT_NOTE'
  inv.doc_entry,
  inv.doc_num,
  inv.doc_date,
  -- v1073 (2026-09-25): fecha_contable / mes_contable / anio_contable
  -- + nc_sin_base. Ver comentario del CTE nc_base_dates arriba.
  -- DATETIME() wrap para evitar el bug de Storage Read API con DATE puro.
  DATETIME(
    CASE
      WHEN inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  )                                                                   AS fecha_contable,
  EXTRACT(YEAR FROM
    CASE
      WHEN inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  )                                                                   AS anio_contable,
  EXTRACT(MONTH FROM
    CASE
      WHEN inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NOT NULL
        THEN ncb.factura_base_doc_date
      ELSE inv.doc_date
    END
  )                                                                   AS mes_contable,
  (inv.doc_kind = 'CREDIT_NOTE' AND ncb.factura_base_doc_date IS NULL) AS nc_sin_base,
  inv.doc_due_date,
  inv.document_status,
  inv.cancelled,
  inv.card_code,
  inv.card_name                                                       AS card_name_invoice,
  bp.card_name                                                        AS card_name_bp,
  bp.card_type                                                        AS card_type_bp,
  bp.currency                                                         AS bp_currency,
  bp.group_code                                                       AS bp_group_code,
  bp.city                                                             AS bp_city,
  bp.country                                                          AS bp_country,
  bp.email                                                            AS bp_email,
  bp.phone1                                                           AS bp_phone1,
  bp.pay_terms_group_code                                             AS bp_pay_terms_group_code,
  bp.sales_person_code                                                AS bp_sales_person_code,
  bp.valid                                                            AS bp_valid,
  bp.frozen                                                           AS bp_frozen,
  inv.doc_currency,
  -- v367+: multiplicamos por sign para que CNs vengan como negativo.
  inv.doc_total * inv.sign                                            AS doc_total,
  inv.doc_total_fc * inv.sign                                         AS doc_total_fc,
  inv.doc_rate,
  -- v302+ (2026-07-21): paid_to_date para calcular Cobrado / Deuda en PBI
  -- sin depender de v_facturado_cobrado_deuda_por_vendedor (que agrupa
  -- por assigned_vendor de la app; aca conservamos el criterio SlpCode
  -- de la pagina Facturacion por Vendedor).
  -- v367+: paid_to_date * sign para que en CNs sea negativo (cobrar una
  -- devolucion = plata que sale de tesoreria).
  inv.paid_to_date * inv.sign                                         AS paid_to_date,
  (inv.doc_total * inv.sign) - COALESCE(inv.paid_to_date * inv.sign, 0)
                                                                      AS saldo_ars,
  inv.discount_percent,
  inv.total_discount * inv.sign                                       AS total_discount,
  inv.sales_person_code                                               AS sales_person_code_invoice,
  -- v311+ (2026-07-22): vendedor real del cliente segun la app (source of truth).
  -- Usar este campo en los slicers del TABLERO SAR en vez de SlpCode.
  ca.assigned_vendor_app                                              AS assigned_vendor,
  -- 2026-09-11: coverage_by = vendedor que cubre presencialmente al cliente
  -- (puede diferir de assigned_vendor si hay una dupla vendedor externo +
  -- interno). Ej: PACHI cubre zona ex-MARTIN pero SANTI factura. coverage_by
  -- se setea manualmente en la app o auto por provincia (Cordoba/San Luis/
  -- Chaco/Formosa/Misiones/Corrientes/Salto BA â†’ PACHI durante trial).
  -- coverage_trial_end_date marca cuando revisar/oficializar (default 2026-12-11).
  ca.coverage_by                                                      AS coverage_by,
  ca.coverage_trial_end_date                                          AS coverage_trial_end_date,
  inv.comments,
  inv.jrnl_memo,
  inv.payment_group_code,
  inv.series,
  inv.create_date,
  inv.update_date,
  inv.lines_count,
  -- lines_json removido 2026-07-14: cada JSON pesa 5-50KB unico -> VertiPaq
  -- no puede comprimir y explota RAM en Power BI Desktop. El aplanamiento
  -- ya vive en v_ventas_lineas (63k filas) que es la fuente real para
  -- medidas de facturacion/margen. Si algun query necesita lines_json,
  -- leerlo directo de sap_invoices_raw.lines_json o sap_credit_notes_raw.lines_json.
  inv._sync_timestamp,
  -- 2026-09-09 (Mariano): aging server-side para evitar el bug de "columna
  -- calculada DAX que se congela en cada refresh". Antes en Power BI se
  -- calculaba DIA(TODAY() - doc_due_date) y quedaba desactualizado hasta
  -- el proximo refresh - un dia de retraso hacia caer facturas fuera del
  -- bucket vencidas ($21M invisibles reportado 2026-09-08). Con estos
  -- campos calculados en BQ, cada consulta tiene aging fresco.
  -- Solo aplica a facturas open + con doc_due_date. Para CN y cerradas
  -- queda NULL (no rompe consumers).
  -- 2026-09-09 v2 (BI feedback):
  --   - timezone AR (America/Argentina/Buenos_Aires) porque refresh corre
  --     de noche AR y con UTC quedaba +1 dia.
  --   - bucket_aging removido: el modelo espera etiquetas EN ("1. Current",
  --     "2. Overdue 1-30d", ...) y las hacia coincidir con las ES anteriores
  --     rompia las 5 medidas de tramo. Ahora expongo solo dias_vencido INT
  --     y el bucket se define en DAX (una sola fuente de verdad).
  CASE
    WHEN inv.document_status = 'bost_Open' AND inv.doc_due_date IS NOT NULL AND inv.doc_kind = 'INVOICE'
      THEN DATE_DIFF(CURRENT_DATE('America/Argentina/Buenos_Aires'), inv.doc_due_date, DAY)
    ELSE NULL
  END                                                                 AS dias_vencido,
  -- 2026-09-09 v2 (BI feedback): flags para que el modelo bike-only pueda
  -- filtrar sin JOINs adicionales.
  --   es_intercompany: CSIC* = SHIMANO INC, CSPH* = SHIMANO PHILIPINE.
  --     Refacturacion del grupo; NO es deuda de canal. Antes solo estaba en
  --     v_deuda_facturas_detalle; ahora tambien aca por consistencia.
  --   es_bike: TRUE si CUALQUIERA de las lineas de la factura tiene un
  --     item del universo bike (sap_items_bike_raw, grupo SAP 100, ~7k
  --     items). Facturas mixtas (bike + pesca) tambien quedan es_bike=TRUE
  --     â€” decision defensiva: mejor sobre-incluir que perder.
  --     Facturas SIN lines_json (raro, legacy) quedan es_bike=NULL.
  -- 2026-09-10 v6 (BI feedback): es_intercompany desde dim_intercompany
  -- (single source of truth). Antes LIKE 'CS%' se me colaban LAZER SPORT NV
  -- y ELITE ITALY. dim_intercompany en cobranzas_bike.sql.
  (inv.card_code IN (SELECT card_code FROM `app-vendedores-shimano.shimano_app.dim_intercompany`)) AS es_intercompany,
  -- 2026-09-09 v4: es_bike a nivel CLIENTE (marca al card_code, no la
  -- factura individual). Congruente con la medida "Es Bike" del modelo PBI.
  (cb.card_code IS NOT NULL)                                             AS es_bike,

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
FROM invoices_and_cns inv
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
  ON inv.card_code = bp.card_code
LEFT JOIN cliente_app ca
  ON ca.card_code = inv.card_code
LEFT JOIN clientes_bike cb
  ON cb.card_code = inv.card_code
-- v1073 (2026-09-25): join a la fecha de la factura original (solo aplica a NCs).
LEFT JOIN nc_base_dates ncb
  ON ncb.nc_doc_entry = inv.doc_entry
  AND inv.doc_kind = 'CREDIT_NOTE'
-- v748 (2026-08-31): filtro estricto cancelled='tNO'. Antes: la vista devolvia
-- TODOS los docs (incluyendo tYES y los cancellation docs con CANCELED='').
-- Downstream consumers (Power BI, dashboards, TABLERO SAR) tenian que aplicar
-- el filtro cada vez y algunos usaban `cancelled <> 'tYES'` que deja pasar los
-- cancellation docs con flag vacio. Efecto: Anglers agosto 2026 se veia con
-- $16.562.000 en vez de los $3.312.400 reales. Ahora el filtro es centralizado
-- aca: solo docs validos (tNO) - excluye tYES y los cancellation docs (CANCELED='').
WHERE inv.cancelled = 'tNO'
