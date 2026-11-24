// @ts-check
/**
 * §39 FIX v9 (2026-11-24) — agregados asignadasBySku/confirmadasBySku para
 * cerrar la divergencia §39 cliente↔server descripta en
 * INCIDENTE_PEDIDOS_13 + INCIDENTE_PEDIDOS_15.
 *
 * Causa raíz: desde v820 (2026-09-07) los listeners cliente filtran
 * `pedidos` por `assignedVendorUid` (rules VDE). Server usa Admin SDK y
 * ve todo. `getStockBreakdown` (pure byte-for-byte mirror §57) recibe
 * `deps.pedidos` distinto → VDE ve `reservadasTotal` menor → cliente
 * arma pedido con qty > `libre` server → STOCK_CHANGED.
 *
 * Solución: `syncSapCatalogStockCF` (CF server-side, bypassa rules)
 * precomputa agregados por SKU en 2 campos nuevos del snapshot:
 *   - `asignadasBySku`     = {sku: int}  // ASIG físico vigente (§40 TTL 7d, excluye enTransito §E1)
 *   - `confirmadasBySku`   = {sku: int}  // confirmed físico vigente (§38 TTL soft 7d + hard 60d, excluye enTransito)
 *
 * El cliente con `snapshotAgregados=true` usa esos agregados para
 * `reservadasTotal` en vez de iterar `deps.pedidos` (que está filtrado).
 * Server sigue iterando (`snapshotAgregados=false`), es el ground truth.
 *
 * NO relaja STOCK_CHANGED. NO omite checks. NO permite sobreventa.
 * El fix alinea CÁLCULOS; la validación final del server sigue intacta.
 *
 * Preserva:
 * - §40 (BO no reserva).
 * - §40.11 (sobre-asignada auto-revertida — scanner off-path de este fix).
 * - §56 (7 CHECKs semánticos).
 * - §58 (reads before writes).
 * - §104 (no ASIG zombie).
 * - v8 §E1 (sub-totales tránsito: este helper SOLO cuenta físico).
 */

/**
 * @typedef {Object} PedidoLine
 * @property {string} [code]
 * @property {string} [state]
 * @property {number} [qtyOpen]
 * @property {boolean} [enTransito]
 * @property {string} [asigAt]
 * @property {boolean|number} [asigReserva]
 * @property {any} [transferidoSAP]
 */

/**
 * @typedef {Object} PedidoDoc
 * @property {any} [closedAt]
 * @property {string} [createdAt]
 * @property {string} [confirmedAt]
 * @property {Array<PedidoLine>} [lines]
 * @property {string} [clientCardCode]
 * @property {any} [transferidoSAP]
 */

/**
 * Replica de `lineReservesStock` acotada a los 2 estados que nos
 * interesan (ASIG + confirmed) para evitar circular import desde
 * `functions/core/pedido-snapshot-core.js`. Byte-for-byte alineada con
 * §38 + §40 + §40.8 + v8 §E1. Cualquier cambio a esas reglas debe
 * reflejarse acá en el MISMO commit.
 *
 * @param {PedidoLine} line
 * @param {PedidoDoc} pedido
 * @param {number} nowMs
 * @returns {boolean}
 */
export function lineReservesStockFisico(line, pedido, nowMs) {
  if (!line || !pedido) return false;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RESERVA_TTL_DAYS = 7;
  const CONFIRMED_HARD_CAP_DAYS = 60;
  const state = line.state;

  // v8 §E1: este helper es SOLO para el bucket físico. Las líneas
  // tránsito reservan contra dep 12 (libreTransito), no contra dep 11.
  if (line.enTransito === true) return false;

  if (state === 'ASIG') {
    // §40.10 ASIG siempre reserva (ignorá asigReserva=false — reverte a BO).
    // TTL 7d desde asigAt || pedido.createdAt.
    const ref = line.asigAt || pedido.createdAt;
    if (!ref) return true; // edge compat: sin fecha, cuenta
    const refMs = Date.parse(ref);
    if (Number.isNaN(refMs)) return true;
    return (nowMs - refMs) / DAY_MS <= RESERVA_TTL_DAYS;
  }

  if (state === 'confirmed') {
    // §40.8: confirmed con orderDocEntry SAP NO reserva (doble conteo).
    if (pedido.transferidoSAP && /** @type {any} */ (pedido.transferidoSAP).orderDocEntry != null) {
      return false;
    }
    // §36: sin asigReserva=false.
    if (line.asigReserva === false || /** @type {any} */ (line.asigReserva) === 0) {
      return false;
    }
    // §36 + §38 TTL soft 7d + hard cap 60d desde confirmedAt.
    if (!pedido.confirmedAt) return false;
    const confMs = Date.parse(pedido.confirmedAt);
    if (Number.isNaN(confMs)) return false;
    const ageDays = (nowMs - confMs) / DAY_MS;
    if (ageDays > RESERVA_TTL_DAYS) return false;
    if (ageDays > CONFIRMED_HARD_CAP_DAYS) return false;
    return true;
  }

  return false;
}

/**
 * Normaliza un SKU: trim + uppercase. Devuelve '' si inválido.
 * @param {any} code
 * @returns {string}
 */
export function normalizeSku(code) {
  if (code == null) return '';
  return String(code).trim().toUpperCase();
}

/**
 * Itera pedidos abiertos + devuelve agregados por SKU.
 * Solo cuenta líneas físico (excluye enTransito §E1).
 * Aplica TTLs §40 (ASIG 7d) + §38 (confirmed soft 7d + hard 60d).
 * Respeta §40.8 (confirmed con orderDocEntry SAP no reserva).
 *
 * @param {Array<PedidoDoc>} pedidosDocs
 * @param {number} nowMs
 * @returns {{asignadasBySku: Record<string, number>, confirmadasBySku: Record<string, number>, totalesStats: {asignadasSkuCount: number, confirmadasSkuCount: number, asignadasQty: number, confirmadasQty: number, pedidosScanned: number, linesScanned: number}}}
 */
export function collectAsignadasConfirmadasFromPedidos(pedidosDocs, nowMs) {
  /** @type {Record<string, number>} */
  const asignadasBySku = {};
  /** @type {Record<string, number>} */
  const confirmadasBySku = {};
  let pedidosScanned = 0;
  let linesScanned = 0;
  let asignadasQty = 0;
  let confirmadasQty = 0;

  const pedidos = Array.isArray(pedidosDocs) ? pedidosDocs : [];
  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    pedidosScanned++;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      linesScanned++;
      const sku = normalizeSku(l.code);
      if (!sku) continue;
      const qty = Number(l.qtyOpen) || 0;
      if (qty <= 0) continue;
      if (!lineReservesStockFisico(l, p, nowMs)) continue;
      if (l.state === 'ASIG') {
        asignadasBySku[sku] = (asignadasBySku[sku] || 0) + qty;
        asignadasQty += qty;
      } else if (l.state === 'confirmed') {
        confirmadasBySku[sku] = (confirmadasBySku[sku] || 0) + qty;
        confirmadasQty += qty;
      }
    }
  }

  return {
    asignadasBySku,
    confirmadasBySku,
    totalesStats: {
      asignadasSkuCount: Object.keys(asignadasBySku).length,
      confirmadasSkuCount: Object.keys(confirmadasBySku).length,
      asignadasQty,
      confirmadasQty,
      pedidosScanned,
      linesScanned,
    },
  };
}
