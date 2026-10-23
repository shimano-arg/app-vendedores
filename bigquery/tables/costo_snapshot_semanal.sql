-- costo_snapshot_semanal
--
-- Snapshot MENSUAL (persistido con cadencia semanal por historia) del
-- OITM.AvgPrice en ARS. Fuente oficial de Finanzas (Juan Paiva). 1 row por
-- (snapshot_week_start, item_code).
--
-- snapshot_week_start: primer LUNES posterior al ultimo dia del mes al que
-- corresponde el snapshot. Ej: septiembre 2026 → 2026-10-05 (ultimo dia sep
-- cae martes 30, proximo lunes 5-oct).
--
-- FUENTE UNICA (2026-10-23 segunda ronda): planilla manual mensual de Juan
-- Paiva. cost_source canonico: 'paiva_import_<mes><año>' (ej.
-- 'paiva_import_sep2026', 'paiva_import_oct2026', ...). Cada carga mensual
-- se hace con INSERT desde una tabla staging `bike_test_paiva_<mes>_<año>`
-- cargada desde la planilla, promediando por item_code
-- (SAFE_DIVIDE(SUM(costo_total), SUM(cantidad))).
--
-- Fuentes DESCARTADAS (no usar):
--   * sap_items_bike_raw.cost_avg_ars (= ItemPrices[PriceList=11,
--     Currency=ARS], NO es OITM.AvgPrice): validacion empirica sep 2026
--     dio 0/1327 items exactos. v_rentabilidad_bike filtra el JOIN para
--     ignorarlo. El workflow .github/workflows/snapshot-costo-semanal.yml
--     + scripts/snapshot_costo_semanal.py fueron ELIMINADOS 2026-10-23.
--   * Service Layer OITM.AvgPrice (singular) y AvgStdPrice: ambos HTTP 400
--     "Property X of 'Item' is invalid" en el tenant SAP de Shimano
--     (confirmado con scripts/test_sl_avg_price_singular.py). No se puede
--     automatizar.
--
-- Consumo:
--   * v_rentabilidad_bike.costo_finanzas_ars JOIN por item_code +
--     snapshot_week_start calculado desde doc_date (criterio Juan).
--     Filtra `cost_source LIKE 'paiva_import%' OR 'oitm_avg_price%'`;
--     el segundo prefijo queda reservado por si en el futuro aparece
--     alguna via automatica.

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
    OPTIONS(description="Fuente del snapshot. Unica fuente activa: 'paiva_import_<mes><año>' desde planilla manual Juan Paiva (ej. 'paiva_import_sep2026'). Prefijo 'oitm_avg_price%' queda reservado por si en el futuro aparece una via automatica (SL de Shimano no expone AvgPrice ni AvgStdPrice, confirmado 2026-10-23). El prefijo 'sap_items_bike_raw.cost_avg_ars' NO se usa (seria lista 11, no AvgPrice): el workflow que lo generaba fue eliminado 2026-10-23.")
)
PARTITION BY snapshot_week_start
CLUSTER BY item_code
OPTIONS(
  description="Snapshot MENSUAL de OITM.AvgPrice (persistido con cadencia semanal). Fuente oficial UNICA: planilla manual Juan Paiva, cost_source='paiva_import_<mes><año>'. v_rentabilidad_bike.costo_finanzas_ars matchea por (item_code, snapshot_week_start = primer_lunes_post_fin_de_mes(doc_date)) filtrando cost_source LIKE 'paiva_import%' OR 'oitm_avg_price%'. Seed sep 2026 (1367 filas) cargado desde bike_test_paiva_sep2026 (criterio Mariano 2026-10-22). Workflow semanal automatico eliminado 2026-10-23 (segunda ronda): la fuente lista 11 NO reproduce AvgPrice."
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
