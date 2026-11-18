-- Sales Plan → BigQuery
-- DDL ejecutar UNA VEZ (dataset `shimano_app` ya existe):
--   bq query --use_legacy_sql=false --location=southamerica-east1 \
--     < scripts/forecast/sales_plan_bq_schema.sql
--
-- Tabla + 2 vistas para alimentar Power BI con la misma métrica que la
-- columna "Plan futuro" del frontend Forecast (ver src/domains/forecast.js
-- → _computeSalesPlanFuturo).
--
-- Cada corrida del workflow Sync Sales Plan to BQ hace WRITE_TRUNCATE
-- de `sales_plan_rows` (reemplazo total). Las vistas re-derivan al query.

-- ============================================================
-- Tabla: sales_plan_rows
-- ============================================================
-- Long format: 1 registro por (familia × SKU × mes).
-- Particionada por `mes` (MONTH) para filtros eficientes "futuro vs pasado".
-- Clustered por (familia, sku) para lookups de un SKU específico.

CREATE TABLE IF NOT EXISTS `app-vendedores-shimano.shimano_app.sales_plan_rows` (
  familia STRING NOT NULL OPTIONS(description='rods o reels'),
  sku STRING NOT NULL,
  description STRING,
  moq INT64 OPTIONS(description='MOQ 12 months del Sales Plan'),
  mes DATE NOT NULL OPTIONS(description='Primer día del mes planeado (YYYY-MM-01)'),
  cantidad INT64 NOT NULL OPTIONS(description='Unidades planeadas para ese mes'),
  source_year_month STRING OPTIONS(description='yearMonth del upload (YYYY-MM)'),
  source_filename STRING OPTIONS(description='Nombre del Excel original'),
  uploaded_by STRING OPTIONS(description='Email del uploader'),
  snapshot_at TIMESTAMP OPTIONS(description='parsedAt del doc Firestore'),
  loaded_at TIMESTAMP NOT NULL OPTIONS(description='Timestamp de la corrida del workflow')
)
PARTITION BY mes
CLUSTER BY familia, sku
OPTIONS(
  description='Export long-format de sales_plan_cache/{rods,reels}. Reemplazado completo cada corrida del workflow sync-sales-plan-to-bq.yml.'
);

-- ============================================================
-- Vista: v_plan_futuro_hoy
-- ============================================================
-- Agregado futuro: suma cantidades para meses >= mes en curso (ART).
-- Coincide 1:1 con la columna "Plan futuro" de la pantalla Forecast.
--
-- Zona horaria Argentina: DATE_TRUNC(CURRENT_DATE('America/Argentina/Buenos_Aires'), MONTH)
-- garantiza que cambia de mes al pasar la medianoche ART, no UTC.

CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_plan_futuro_hoy` AS
SELECT
  familia,
  sku,
  ANY_VALUE(description) AS description,
  MAX(moq) AS moq,
  SUM(cantidad) AS plan_futuro,
  MIN(mes) AS primer_mes_futuro,
  MAX(mes) AS ultimo_mes_plan,
  COUNT(*) AS meses_con_plan,
  MAX(snapshot_at) AS snapshot_at
FROM `app-vendedores-shimano.shimano_app.sales_plan_rows`
WHERE mes >= DATE_TRUNC(CURRENT_DATE('America/Argentina/Buenos_Aires'), MONTH)
GROUP BY familia, sku;

-- ============================================================
-- Vista: v_plan_futuro_por_sku
-- ============================================================
-- Resuelve el "duplicado ROD/REEL" visible en la pantalla Forecast:
-- si un SKU aparece en ambos Excels (Rods y Reels), la pantalla muestra
-- 2 filas con el MISMO Plan futuro. Power BI tiene que elegir qué hacer.
--
-- Convención: tomamos el MÁXIMO entre familias (asume que ambos Excels
-- planean la misma demanda; el máximo defensivo evita subestimar).
-- Si en el futuro se decide SUM o solo una familia, cambiar aquí.
--
-- Columna `item_code` = alias de `sku` para que Power BI pueda unirla
-- con las tablas SAP (sap_items_raw.ItemCode) sin aliasing manual en
-- Power Query. Es la columna que alimenta "Forecast - Units" en el
-- modelo de inventario.

CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_plan_futuro_por_sku` AS
SELECT
  sku AS item_code,
  ANY_VALUE(description) AS description,
  MAX(moq) AS moq,
  MAX(plan_futuro) AS plan_futuro,
  STRING_AGG(familia, ',' ORDER BY familia) AS familias,
  MAX(snapshot_at) AS snapshot_at
FROM `app-vendedores-shimano.shimano_app.v_plan_futuro_hoy`
GROUP BY sku;
