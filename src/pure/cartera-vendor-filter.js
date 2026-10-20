// @ts-check
/**
 * cartera-vendor-filter.js (v1283, 2026-10-20)
 *
 * Puras para filtrar y ordenar la tabla del dashboard "Analisis de Cartera".
 * Importado por src/domains/cartera-vendor.js (bundle frontend).
 * Testeado en tests/unit/cartera-vendor-filter.test.js.
 */

/**
 * Aplica un chip de filtro al array de clientes.
 * @param {Array<Object>} clientes
 * @param {string} chip
 * @returns {Array<Object>}
 */
export function applyChipFilter(clientes, chip) {
  if (!Array.isArray(clientes)) return [];
  switch (chip) {
    case 'baseActiva90d':
      return clientes.filter((c) => c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra <= 90);
    case 'dormidosVisita30d':
      return clientes.filter((c) => c.diasSinVisitaPresencial !== null && c.diasSinVisitaPresencial !== undefined && c.diasSinVisitaPresencial > 30);
    case 'dormidosCompra90d':
      return clientes.filter((c) => c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra > 90);
    case 'nuncaVisitados':
      return clientes.filter((c) => c.ultimaVisitaPresencial === null || c.ultimaVisitaPresencial === undefined);
    case 'nuncaCompraron':
      return clientes.filter((c) => c.ultimaCompra === null || c.ultimaCompra === undefined);
    case 'todos':
    default:
      return clientes.slice();
  }
}

/**
 * Ordena una copia del array por columna. Nulls siempre al final.
 * @param {Array<Object>} clientes
 * @param {string} sortBy
 * @param {'asc'|'desc'} sortDir
 * @returns {Array<Object>}
 */
export function sortClientes(clientes, sortBy, sortDir) {
  if (!Array.isArray(clientes)) return [];
  const dir = sortDir === 'asc' ? 1 : -1;
  const copy = clientes.slice();
  copy.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    const aNull = av === null || av === undefined;
    const bNull = bv === null || bv === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return copy;
}
