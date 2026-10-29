// @ts-check
/**
 * v1528 (2026-10-29) — Disponible por línea en el modal "Revisá tu pedido".
 *
 * Problema que arregla: el modal usaba el libre GENERAL para todas las líneas.
 * En las líneas STOCK ASIGNADO ese libre resta también la reserva del propio
 * cliente y daba 0 → "SIN STOCK" aunque las unidades son suyas. Caso
 * BENGOCHEA ORDEN 653 (29/10): Lista de espera $1.827.000 todo con stock;
 * Revisá tu pedido 597144, 597151 y ULT5500XSD como sin stock ($617.000).
 *
 * Misma regla que commitPedidoCore (CLAUDE.md §33/§35): línea con
 * origen='stock-asignado' y asigRefs → utilizable para el cliente; el resto →
 * libre general.
 */

/**
 * @param {any} line  línea del pedido (code, origen, asigRefs).
 * @param {string} cardCode  cliente del pedido.
 * @param {{ getLibre: (sku: string) => number|null, getUtilizable?: (sku: string, cardCode: string) => number|null }} deps
 * @returns {number|null}  null si no hay datos de stock.
 */
export function dispParaLineaReview(line, cardCode, deps) {
  if (!line || !line.code || !deps || typeof deps.getLibre !== 'function') return null;
  const esStockAsignado =
    line.origen === 'stock-asignado' && Array.isArray(line.asigRefs) && line.asigRefs.length > 0;
  if (esStockAsignado && cardCode && typeof deps.getUtilizable === 'function') {
    const u = deps.getUtilizable(line.code, cardCode);
    if (u != null && Number.isFinite(Number(u))) return Math.max(Number(u), 0);
  }
  const g = deps.getLibre(line.code);
  if (g == null || !Number.isFinite(Number(g))) return null;
  return Math.max(Number(g), 0);
}
