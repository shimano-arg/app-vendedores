// @ts-check
/**
 * Dashboard de Ventas fase 2 (2026-10-29) — query de campañas activas.
 *
 * Mismas reglas que `dashboard-ventas-queries.js`: valores del usuario solo
 * como parámetros, arrays con tipo STRING. La query arranca con el marcador
 * `-- dashboard:campanias`.
 *
 * Las campañas tienen sus propias fechas, SKUs y alcance: NO se filtran por
 * mes, cliente, producto, categoría ni provincia. Solo importa `vendedores`.
 */
import { arrayPredicate } from './dashboard-ventas-queries.js';

const DS = 'app-vendedores-shimano.shimano_app';
const T_PROGRESO = `\`${DS}.v_campanias_progreso\``;
const T_DETALLE = `\`${DS}.v_campanias_ventas_detalle\``;
const T_CARTERA = `\`${DS}.v_cartera_vendor\``;

/**
 * @param {import('./dashboard-ventas-queries.js').DashboardFilters} f
 * @param {number} [_nowMs]
 * @returns {import('./dashboard-ventas-queries.js').BqQuery}
 */
export function buildCampaniasQuery(f, _nowMs) {
  const sinFiltro = '(COALESCE(ARRAY_LENGTH(@vendedores), 0) = 0)';
  // Valores de alcance de la campaña, normalizados (mismo parseo que la vista).
  const scopeVals = `ARRAY(SELECT UPPER(TRIM(JSON_EXTRACT_SCALAR(sv))) FROM UNNEST(JSON_EXTRACT_ARRAY(c.scope_values_json)) sv)`;

  const query = `-- dashboard:campanias
WITH ventas AS (
  -- Ventas del vendedor dentro de cada campaña (el detalle ya está acotado a
  -- los SKUs, fechas y alcance de la campaña).
  SELECT campaign_id,
    SUM(COALESCE(cantidad, 0)) AS qty,
    SUM(COALESCE(importe_linea_ars, 0)) AS ars,
    COUNT(*) AS lineas
  FROM ${T_DETALLE}
  WHERE ${arrayPredicate('vendedores', 'UPPER(TRIM(assigned_vendor))')}
  GROUP BY campaign_id
)
SELECT
  c.campaign_id AS campaign_id,
  c.name AS nombre,
  FORMAT_DATE('%Y-%m-%d', c.start_date) AS start_date,
  FORMAT_DATE('%Y-%m-%d', c.end_date) AS end_date,
  c.target_type AS target_type,
  c.target_amount AS target_amount,
  IF(${sinFiltro}, COALESCE(c.realizado_qty, 0), COALESCE(v.qty, 0)) AS realizado_qty,
  IF(${sinFiltro}, COALESCE(c.realizado_ars, 0), COALESCE(v.ars, 0)) AS realizado_ars
FROM ${T_PROGRESO} c
LEFT JOIN ventas v ON v.campaign_id = c.campaign_id
WHERE c.activa = TRUE
  AND (
    ${sinFiltro}
    OR c.scope = 'all'
    OR (c.scope = 'vendor' AND EXISTS (
      SELECT 1 FROM UNNEST(${scopeVals}) s WHERE s IN UNNEST(@vendedores)))
    OR (c.scope = 'province' AND EXISTS (
      SELECT 1 FROM ${T_CARTERA} ca
      WHERE UPPER(TRIM(ca.vendor_key)) IN UNNEST(@vendedores)
        AND UPPER(TRIM(ca.province)) IN UNNEST(${scopeVals})))
    OR COALESCE(v.lineas, 0) > 0
  )
ORDER BY end_date ASC, nombre`;

  return {
    query,
    params: { vendedores: f.vendedores.slice() },
    types: { vendedores: ['STRING'] },
  };
}
