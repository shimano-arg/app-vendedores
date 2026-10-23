-- costo_snapshot_semanal
--
-- Snapshot semanal de OITM.AvgPrice en ARS. Fuente oficial de Finanzas (Juan Paiva).
-- 1 row por (snapshot_week_start, item_code).
--
-- snapshot_week_start: primer LUNES posterior al ultimo dia del mes al que
-- corresponde el snapshot. Ej: septiembre 2026 → 2026-10-05 (ultimo dia sep
-- cae martes 30, proximo lunes 5-oct).
--
-- Alimentacion:
--   * Seed sep 2026: desde bike_test_paiva_sep2026 (export manual Juan).
--   * Lunes posteriores: scripts/snapshot_costo_semanal.py (TODO), que levanta
--     el valor actual de OITM.AvgPrice en SAP y lo carga a esta tabla con el
--     snapshot_week_start del dia que corre. Dependencia: Juan Paiva confirma
--     que la fuente estable es OITM.AvgPrice (no otra lista). Pipeline:
--       - Opcion A: CSV manual que Juan sube cada lunes a Storage, Cloud
--         Function trigger carga aqui.
--       - Opcion B: ampliar sync_sap_to_bigquery.py para incluir AvgPrice en
--         el $select de Items (ya probado AvgStdPrice en 2026-07-10 que fallo
--         con HTTP 400; AvgPrice no probado todavia).
--
-- Consumo:
--   * v_rentabilidad_bike.costo_finanzas_ars JOIN por item_code +
--     snapshot_week_start calculado desde doc_date (criterio Juan).

CREATE TABLE IF NOT EXISTS `app-vendedores-shimano.shimano_app.costo_snapshot_semanal` (
  snapshot_week_start DATE NOT NULL
    OPTIONS(description='Primer lunes posterior al ultimo dia del mes al que corresponde el snapshot. Ej: 2026-10-05 para septiembre 2026.'),
  snapshot_at TIMESTAMP NOT NULL
    OPTIONS(description='Timestamp real de la carga a BQ.'),
  item_code STRING NOT NULL
    OPTIONS(description='ItemCode SAP.'),
  cost_avg_ars FLOAT64
    OPTIONS(description='OITM.AvgPrice en ARS. Valor del maestro al momento del snapshot.'),
  cost_source STRING
    OPTIONS(description="Fuente del snapshot: 'paiva_import_sep2026' (seed inicial desde bike_test_paiva_sep2026) o 'oitm_avg_price_weekly' (pipeline automatico).")
)
PARTITION BY snapshot_week_start
CLUSTER BY item_code
OPTIONS(
  description="Snapshot semanal de OITM.AvgPrice. Fuente oficial de Finanzas (Juan Paiva) para valuacion mensual bike. v_rentabilidad_bike.costo_finanzas_ars matchea por (item_code, snapshot_week_start = primer_lunes_post_fin_de_mes(doc_date)). Seed sep 2026 cargado desde bike_test_paiva_sep2026 (criterio Mariano 2026-10-22)."
);

-- ============================================================
-- Seed septiembre 2026
-- ============================================================
-- primer_lunes_post_30_sep_2026 = 2026-10-05.
-- Costo unitario = SUM(costo_total_paiva_ars) / SUM(cantidad) por item_code
-- (promedio ponderado si Juan tenia multiples lineas por item con mismo costo).
-- Si Juan mantuvo el costo CONSTANTE por item en todo septiembre (criterio
-- snapshot: 1 valor por item al momento del snapshot), el promedio ponderado
-- devuelve ese valor exacto. Verificar con la query de controles al cierre.
DELETE FROM `app-vendedores-shimano.shimano_app.costo_snapshot_semanal`
WHERE snapshot_week_start = DATE('2026-10-05');

INSERT INTO `app-vendedores-shimano.shimano_app.costo_snapshot_semanal`
  (snapshot_week_start, snapshot_at, item_code, cost_avg_ars, cost_source)
SELECT
  DATE('2026-10-05') AS snapshot_week_start,
  CURRENT_TIMESTAMP() AS snapshot_at,
  item_code,
  SAFE_DIVIDE(SUM(costo_total_paiva_ars), SUM(cantidad)) AS cost_avg_ars,
  'paiva_import_sep2026' AS cost_source
FROM `app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026`
WHERE cantidad > 0
  AND costo_total_paiva_ars IS NOT NULL
GROUP BY item_code
;
