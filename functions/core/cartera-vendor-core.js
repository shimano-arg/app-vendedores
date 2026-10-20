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

/**
 * Traduce una fila BQ (snake_case source-of-truth) al schema del doc Firestore
 * (camelCase + espanol). Ver spec section "Naming: BQ view -> Firestore doc".
 *
 * BigQuery Node client puede devolver DATE como string ISO, como { value: 'YYYY-MM-DD' },
 * o Date. Normalizamos a string ISO YYYY-MM-DD.
 *
 * @param {any} bqRow
 * @returns {Object}
 */
export function normalizeClienteRow(bqRow) {
  return {
    clientId: bqRow.client_id,
    cardCode: bqRow.card_code ?? null,
    clientName: bqRow.client_name ?? null,
    provincia: bqRow.province ?? null,
    localidad: bqRow.loc_name ?? null,
    cliTipo: bqRow.cli_tipo ?? null,
    ultimaVisitaPresencial: toIsoDate(bqRow.ultima_visita_presencial),
    diasSinVisitaPresencial: bqRow.dias_sin_visita_presencial ?? null,
    ultimoContacto: toIsoDate(bqRow.ultimo_contacto),
    diasSinContacto: bqRow.dias_sin_contacto ?? null,
    ultimaCompra: toIsoDate(bqRow.ultima_compra),
    diasSinCompra: bqRow.dias_sin_compra ?? null,
    facturado12M: Number(bqRow.facturado_12m) || 0,
    deudaAbierta: Number(bqRow.deuda_abierta) || 0,
  };
}

/**
 * Normaliza DATE BigQuery a ISO YYYY-MM-DD o null.
 * @param {any} v
 * @returns {string|null}
 */
function toIsoDate(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && typeof v.value === 'string') return v.value;
  return null;
}
