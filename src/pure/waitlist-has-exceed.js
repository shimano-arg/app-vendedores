// @ts-check
/**
 * waitlist-has-exceed.js (v1388, 2026-10-21)
 *
 * Decide si una card de "Pedidos en espera" (revision_waitlist) tiene excedente
 * — es decir, si alguna de sus lineas tiene qty > disponible. El resultado se
 * usa para pintar border rojo en el sidebar del mapa (has-exceed=true) por
 * encima del bg naranja uniforme de las cards source-cpst.
 *
 * REGLA (ex H1 / CLAUDE.md §32 §33):
 *   - Si source='stock-asignado-batch' + clientCardCode presente:
 *     usar `getStockUtilizableParaClienteExAsig(sku, cardCode)`. Esta formula
 *     NO cuenta la reserva propia del cliente como "ajena" — asi la card no
 *     se marca como excedente cuando su ASIG propia cubre el pedido.
 *   - Si es otra source (manual, waitlist normal): usar formula GLOBAL
 *     `getStockRealmenteDisponible(sku)`.
 *   - Si es cpst pero NO hay clientCardCode (edge case): devolver
 *     hasExceed=false (señal muerta mejor que señal mentirosa).
 *
 * Reemplaza la logica inline del renderer `_renderWaitlistSidebar`
 * (index.html:20062-20080) que usaba `_pendingAppDeSku` global y
 * disparaba falsos positivos en cards cpst (bug fix-card-stock-asig-color).
 */

import {
  getStockRealmenteDisponible,
  getStockUtilizableParaClienteExAsig,
} from './stock-realmente-disponible.js';

/**
 * @typedef {object} WaitlistItem
 * @property {string} code
 * @property {number} qty
 */

/**
 * @typedef {object} WaitlistShape
 * @property {Array<WaitlistItem>} items
 * @property {string} [source]
 * @property {string} [clientCardCode]
 */

/**
 * @typedef {object} StockDeps
 * @property {(sku: string) => number} getStockFisico
 * @property {Array<any>} pedidos
 * @property {Array<any>} [waitlistEntries]
 */

/**
 * @param {WaitlistShape|null|undefined} waitlist
 * @param {StockDeps} deps
 * @param {{now?: number}} [opts]
 * @returns {{excedentes: number, hasExceed: boolean}}
 */
export function computeHasExceed(waitlist, deps, opts) {
  if (!waitlist || !Array.isArray(waitlist.items) || !deps) {
    return { excedentes: 0, hasExceed: false };
  }
  const items = waitlist.items;
  const isCpst = waitlist.source === 'stock-asignado-batch';
  const cardCode =
    typeof waitlist.clientCardCode === 'string' && waitlist.clientCardCode.trim()
      ? waitlist.clientCardCode.trim()
      : null;

  // CPST sin cardCode: no podemos aplicar la formula correcta → no mostramos
  // excedente. Mejor señal muerta que señal mentirosa (el border rojo
  // tiene que significar algo real).
  if (isCpst && !cardCode) {
    return { excedentes: 0, hasExceed: false };
  }

  let excedentes = 0;
  for (const it of items) {
    if (!it || typeof it.code !== 'string') continue;
    const code = it.code;
    const qty = Number(it.qty) || 0;
    if (qty <= 0) continue;

    let disp;
    if (isCpst) {
      // Formula por cliente — su ASIG propia NO cuenta como "comprometido ajeno".
      disp = getStockUtilizableParaClienteExAsig(
        code,
        /** @type {string} */ (cardCode),
        deps,
        opts
      );
    } else {
      // Formula global — cualquier reserva (incluso propia) cuenta.
      disp = getStockRealmenteDisponible(code, deps, opts);
    }
    if (qty > Math.max(disp, 0)) {
      excedentes++;
    }
  }

  return { excedentes, hasExceed: excedentes > 0 };
}
