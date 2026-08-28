// @ts-check
/**
 * v701 (2026-08-28): Stock realmente disponible para vender.
 *
 * Contexto: Mariano decidio 2026-08-28 que la app sea dueña del stock. Al
 * enviar una SQ a SAP, esas unidades quedan comprometidas y no deben
 * ofrecerse al siguiente vendedor. Idem para BO/ASIG open: son demanda
 * pendiente que reservan stock futuro.
 *
 * Fórmula:
 *   disponible_real(sku) =
 *     max(0, stockFisico(sku) - Σ qtyOpen de todas las lineas en pedidos-app
 *            open con state IN ('confirmed', 'BO', 'ASIG'))
 *
 * Dedup: cada linea del pedido cuenta una sola vez (por indice). Si el mismo
 * cliente pide el mismo SKU en 2 pedidos-app distintos (dups heredados de
 * SAP), cuentan las 2 lineas — son 2 compromisos separados. Si un pedido
 * tiene 2 lineas con el mismo SKU (split v600: confirmed + BO), cuentan
 * ambas — son la misma demanda pero cada linea reserva su qty.
 *
 * Excluye:
 * - Pedidos con closedAt != null (ya cerrados)
 * - Lineas con state IN ('invoiced', 'cancelled', 'recycled', 'legacy')
 * - Lineas con qtyOpen <= 0
 */

/**
 * @typedef {Object} PedidoLike
 * @property {any} [closedAt]
 * @property {Array<any>} [lines]
 */

/**
 * @typedef {Object} StockRealDeps
 * @property {(sku: string) => number} getStockFisico Lookup del stock fisico (dep 11).
 * @property {Array<PedidoLike>} pedidos Lista de pedidos-app (typicamente globalPedidos).
 */

/**
 * Estados que reservan stock. `confirmed` fue enviado a SAP pero aun no
 * facturado; `BO` espera stock futuro; `ASIG` ya tiene stock reservado FIFO.
 */
const STATES_QUE_RESERVAN = new Set(['confirmed', 'BO', 'ASIG']);

/**
 * Calcula el stock realmente disponible para un SKU dado.
 *
 * @param {string} sku
 * @param {StockRealDeps} deps
 * @returns {number} Stock disponible >= 0.
 */
export function getStockRealmenteDisponible(sku, deps) {
  const skuUp = String(sku || '').toUpperCase();
  if (!skuUp) return 0;
  const fisico = Number(deps.getStockFisico(skuUp)) || 0;
  if (fisico <= 0) return 0;

  let comprometido = 0;
  const pedidos = Array.isArray(deps.pedidos) ? deps.pedidos : [];
  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      if (!STATES_QUE_RESERVAN.has(l.state)) continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      comprometido += qtyOpen;
    }
  }

  return Math.max(0, fisico - comprometido);
}

/**
 * Calcula el desglose (fisico, comprometido, real) para mostrar en UI.
 *
 * @param {string} sku
 * @param {StockRealDeps} deps
 * @returns {{fisico: number, comprometido: number, real: number, breakdown: {confirmed: number, BO: number, ASIG: number}}}
 */
export function getStockDesglose(sku, deps) {
  const skuUp = String(sku || '').toUpperCase();
  const fisico = skuUp ? Number(deps.getStockFisico(skuUp)) || 0 : 0;
  const breakdown = { confirmed: 0, BO: 0, ASIG: 0 };
  if (!skuUp) return { fisico: 0, comprometido: 0, real: 0, breakdown };

  const pedidos = Array.isArray(deps.pedidos) ? deps.pedidos : [];
  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      const st = /** @type {'confirmed'|'BO'|'ASIG'} */ (l.state);
      if (!STATES_QUE_RESERVAN.has(st)) continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      breakdown[st] = (breakdown[st] || 0) + qtyOpen;
    }
  }
  const comprometido = breakdown.confirmed + breakdown.BO + breakdown.ASIG;
  return {
    fisico,
    comprometido,
    real: Math.max(0, fisico - comprometido),
    breakdown,
  };
}
