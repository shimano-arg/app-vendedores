// @ts-check
/**
 * cartera-vendor-core.js (v1283, 2026-10-20)
 *
 * Core puro para syncCarteraVendorScheduled CF.
 * Snapshot nightly 04:00 ART desde v_cartera_vendor BQ -> cartera_vendor/{vendorKey} Firestore.
 *
 * Spec: docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md
 */

/**
 * @typedef {Object} ClienteCartera
 * @property {string|null} ultimaVisitaPresencial
 * @property {number|null} diasSinVisitaPresencial
 * @property {string|null} ultimaCompra
 * @property {number|null} diasSinCompra
 */

/**
 * @typedef {Object} ClienteCounts
 * @property {number} total
 * @property {number} baseActiva90d
 * @property {number} dormidosVisita30d
 * @property {number} dormidosCompra90d
 * @property {number} nuncaVisitados
 * @property {number} nuncaCompraron
 */

/**
 * Computa los 6 KPIs del dashboard sobre un array de clientes.
 *
 * Umbrales fijos (decision #7 del spec):
 *   - base activa: diasSinCompra <= 90
 *   - dormido visita: diasSinVisitaPresencial > 30
 *   - dormido compra: diasSinCompra > 90
 *   - nunca visitado: ultimaVisitaPresencial === null
 *   - nunca compro: ultimaCompra === null
 *
 * @param {ClienteCartera[]} clientes
 * @returns {ClienteCounts}
 */
export function computeCounts(clientes) {
  const total = clientes.length;
  let baseActiva90d = 0;
  let dormidosVisita30d = 0;
  let dormidosCompra90d = 0;
  let nuncaVisitados = 0;
  let nuncaCompraron = 0;
  for (const c of clientes) {
    if (c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra <= 90) {
      baseActiva90d++;
    }
    if (c.diasSinVisitaPresencial !== null && c.diasSinVisitaPresencial !== undefined && c.diasSinVisitaPresencial > 30) {
      dormidosVisita30d++;
    }
    if (c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra > 90) {
      dormidosCompra90d++;
    }
    if (c.ultimaVisitaPresencial === null || c.ultimaVisitaPresencial === undefined) {
      nuncaVisitados++;
    }
    if (c.ultimaCompra === null || c.ultimaCompra === undefined) {
      nuncaCompraron++;
    }
  }
  return { total, baseActiva90d, dormidosVisita30d, dormidosCompra90d, nuncaVisitados, nuncaCompraron };
}
