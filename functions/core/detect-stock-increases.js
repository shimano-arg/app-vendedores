/**
 * Mirror server-side de src/pure/detect-stock-increases.js (§57).
 *
 * Mantener byte-equivalent con el pure (post header). Si cambiás uno, cambiá
 * el otro + corré tests/unit/audit/detect-stock-increases-sync.test.js.
 */

import {
  DEP_FISICO,
  DEP_TRANSITO,
  getQtyFromBreakdown,
  WAREHOUSE_KEY_FISICO,
  WAREHOUSE_KEY_TRANSITO,
} from './warehouse-constants.js';

/**
 * @typedef {Object} StockDelta
 * @property {string} sku
 * @property {11 | 12} warehouse
 * @property {number} before
 * @property {number} after
 * @property {number} delta  // after - before, siempre > 0 (sólo subidas)
 */

/**
 * @typedef {Object} DetectResult
 * @property {StockDelta[]} dep11Deltas
 * @property {StockDelta[]} dep12Deltas
 */

/**
 * Parsea el `warehouseBreakdown` del snapshot. Puede venir como:
 * - JSON string (patrón sync Python v368+).
 * - Objeto dict ya parseado.
 * - null/undefined.
 *
 * @param {unknown} raw
 * @returns {Record<string, Record<string, number>>}
 */
function parseWarehouseBreakdown(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return /** @type {any} */ (raw);
  return {};
}

/**
 * Detecta incrementos de stock en dep 11 y dep 12 entre `before` y `after`.
 *
 * Toma ambos snapshots (shape `{warehouseBreakdown: string|object, ...}`) y
 * devuelve un array por depósito con los deltas positivos.
 *
 * - Si un SKU aparece en `after` pero no en `before` con qty > 0 → delta = qty.
 * - Si un SKU baja (delta < 0) → NO se incluye (eso lo maneja scanCancelledTransito
 *   en la etapa E2; este helper solo detecta subidas para disparar reparto).
 * - Si un SKU queda igual → no se incluye.
 *
 * @param {{warehouseBreakdown?: unknown} | null | undefined} beforeSnap
 * @param {{warehouseBreakdown?: unknown} | null | undefined} afterSnap
 * @returns {DetectResult}
 */
export function detectStockIncreases(beforeSnap, afterSnap) {
  const beforeBreakdown = parseWarehouseBreakdown(
    beforeSnap && /** @type {any} */ (beforeSnap).warehouseBreakdown
  );
  const afterBreakdown = parseWarehouseBreakdown(
    afterSnap && /** @type {any} */ (afterSnap).warehouseBreakdown
  );

  /** @type {StockDelta[]} */
  const dep11Deltas = [];
  /** @type {StockDelta[]} */
  const dep12Deltas = [];

  // Iteramos sobre todos los SKUs del after (los que no aparecen en after
  // claramente no subieron). Para cada SKU, comparamos ambos depósitos.
  const afterSkus = Object.keys(afterBreakdown);
  for (const sku of afterSkus) {
    const afterWhs = afterBreakdown[sku] || {};
    const beforeWhs = beforeBreakdown[sku] || {};

    // Dep 11 (físico Argentina)
    const b11 = getQtyFromBreakdown(beforeWhs, DEP_FISICO);
    const a11 = getQtyFromBreakdown(afterWhs, DEP_FISICO);
    if (a11 > b11) {
      dep11Deltas.push({
        sku,
        warehouse: DEP_FISICO,
        before: b11,
        after: a11,
        delta: a11 - b11,
      });
    }

    // Dep 12 (tránsito Uruguay → Argentina)
    const b12 = getQtyFromBreakdown(beforeWhs, DEP_TRANSITO);
    const a12 = getQtyFromBreakdown(afterWhs, DEP_TRANSITO);
    if (a12 > b12) {
      dep12Deltas.push({
        sku,
        warehouse: DEP_TRANSITO,
        before: b12,
        after: a12,
        delta: a12 - b12,
      });
    }
  }

  return { dep11Deltas, dep12Deltas };
}

/**
 * Detecta DECREMENTOS de stock en dep 12 sin suba equivalente en dep 11
 * (señal de "partida cancelada en tránsito" — §A3 del plan).
 *
 * Un caso frecuente: dep12 baja -10 y dep11 sube +10 (llegada normal) → NO alerta.
 * Caso que SÍ alerta: dep12 baja -10 y dep11 sube +0 (cancelación o pérdida).
 * Caso parcial: dep12 baja -10 y dep11 sube +7 → alerta por 3 unidades.
 *
 * El consumidor (scanCancelledTransito en E2) usa este output para disparar
 * revert FIFO de las ASIG tránsito afectadas.
 *
 * @param {{warehouseBreakdown?: unknown} | null | undefined} beforeSnap
 * @param {{warehouseBreakdown?: unknown} | null | undefined} afterSnap
 * @returns {{sku: string, dep12Bajo: number, dep11Subio: number, qtyCancelada: number}[]}
 */
export function detectTransitoCancelaciones(beforeSnap, afterSnap) {
  const beforeBreakdown = parseWarehouseBreakdown(
    beforeSnap && /** @type {any} */ (beforeSnap).warehouseBreakdown
  );
  const afterBreakdown = parseWarehouseBreakdown(
    afterSnap && /** @type {any} */ (afterSnap).warehouseBreakdown
  );

  /** @type {{sku: string, dep12Bajo: number, dep11Subio: number, qtyCancelada: number}[]} */
  const cancelaciones = [];

  // Iteramos los SKUs del before (que son los que pueden "haber tenido tránsito")
  const beforeSkus = Object.keys(beforeBreakdown);
  for (const sku of beforeSkus) {
    const beforeWhs = beforeBreakdown[sku] || {};
    const afterWhs = afterBreakdown[sku] || {};

    const b12 = getQtyFromBreakdown(beforeWhs, DEP_TRANSITO);
    const a12 = getQtyFromBreakdown(afterWhs, DEP_TRANSITO);
    const dep12Bajo = Math.max(0, b12 - a12);
    if (dep12Bajo === 0) continue;

    const b11 = getQtyFromBreakdown(beforeWhs, DEP_FISICO);
    const a11 = getQtyFromBreakdown(afterWhs, DEP_FISICO);
    const dep11Subio = Math.max(0, a11 - b11);

    const qtyCancelada = Math.max(0, dep12Bajo - dep11Subio);
    if (qtyCancelada === 0) continue;

    cancelaciones.push({ sku, dep12Bajo, dep11Subio, qtyCancelada });
  }

  return cancelaciones;
}

// Re-export por conveniencia para quien lo consuma directo.
export { DEP_FISICO, DEP_TRANSITO, WAREHOUSE_KEY_FISICO, WAREHOUSE_KEY_TRANSITO };
