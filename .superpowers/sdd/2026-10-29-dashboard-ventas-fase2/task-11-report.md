# Task 11 report
Status: DONE.
RED: vitest on core + ui tests -> 6 failed (monthsBetween/SERIE_DESDE missing, serie 12 points, dvDataLabels, dv-campanias).
GREEN: SERIE_DESDE='2026-06' + monthsBetween in queries.js (SERIE_MESES and dead monthsEndingAt removed); query desde = min(SERIE_DESDE, mes)+'-01'; core axis monthsBetween(SERIE_DESDE, mes); UI: dvDataLabels plugin registered in _loadChartJs, fmt via options.plugins.dvDataLabels (bars: units/money; cobertura uses _coberturaEtiqueta); _campaniasSection (#dv-campanias) after clientes; CSS dv-camp* in Apple block (CRLF kept).
Existing tests updated from 12 to 5 points / desde '2026-06-01'.
Verification: dashboard-ventas vitest 130 pass; test:unit 2580 pass; test:smoke 25 pass; lint 0 errors (19 warnings, baseline 20); typecheck clean. build.js run, chunks/dashboard-ventas.js committed (app.bundle.js unchanged).
Concerns: no APP_VERSION/CACHE_VERSION bump or README §41 entry (not in this task brief; release task 12). Cobertura label duplicates the axis text by design.
