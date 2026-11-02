// @ts-check
/**
 * pedidos-del-mes-view.js (v1540, 2026-11-02, APP-06) — helpers puros de la
 * pantalla Pedidos del mes (src/domains/pedidos-del-mes.js). Sin DOM ni
 * Firebase: formato de números y filtros sobre la respuesta de
 * pedidosDelMesCF.
 */

/** @param {number} n */
export function fmtArs(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  const s = Math.round(Math.abs(x))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (x < 0 ? '-$ ' : '$ ') + s;
}

/** @param {number} n */
export function fmtUds(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ',');
}

/**
 * Filtra clientes por búsqueda (nombre, código, localidad) y vendedor. Puro.
 * @param {any[]} clientes
 * @param {string} q
 * @param {string} vendedor
 */
export function filtrarClientes(clientes, q, vendedor) {
  const qq = String(q || '')
    .trim()
    .toUpperCase();
  const v = String(vendedor || '')
    .trim()
    .toUpperCase();
  return (clientes || []).filter((c) => {
    if (v && String(c.vendedor || '').toUpperCase() !== v) return false;
    if (!qq) return true;
    const hay = [c.nombre, c.cardCode, c.localidad, c.provincia].join(' ').toUpperCase();
    return qq.split(/\s+/).every((t) => hay.includes(t));
  });
}

/**
 * Totales de la lista filtrada (los KPI del encabezado siguen al filtro).
 * @param {any[]} clientes
 */
export function totalesDe(clientes) {
  const skus = new Set();
  let ars = 0;
  for (const c of clientes) {
    ars += Number(c.totalArs) || 0;
    for (const s of c.skus || []) skus.add(s.sku);
  }
  return { clientes: clientes.length, skus: skus.size, ars: Math.round(ars * 100) / 100 };
}
