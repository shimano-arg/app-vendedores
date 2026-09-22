// @ts-check
/**
 * planner-compute-column (Planner Kanban, 2026-09-22).
 *
 * Pure function that determines which Kanban column a pedido belongs to
 * based on its state and document properties. Dual implementation:
 * - Server: functions/core/planner-compute-column.js (Cloud Functions)
 * - Client: src/domains/planner/compute-column.js (bundle)
 *
 * Used to render the Planner Kanban board with 6 columns:
 * 'lista_espera' | 'oferta' | 'ordenes' | 'confirmado' | 'facturar' | 'cobrado'
 *
 * Algorithm priority (top-down):
 * 1. plannerStage === 'confirmado' → 'confirmado'
 * 2. plannerStage === 'cobrado_parcial' || 'cobrado_full' → 'cobrado'
 * 3. paidStatus === 'partial' || 'paid' → 'cobrado'
 * 4. items.some(l => (l?.qtyInvoiced || 0) > 0) → 'facturar'
 * 5. transferidoSAP?.orderDocEntry truthy → 'ordenes'
 * 6. transferidoSAP?.docNum truthy → 'oferta'
 * 7. else → 'lista_espera'
 *
 * @typedef {Object} PlannerPedido
 * @property {string} [plannerStage] 'confirmado' | 'cobrado_parcial' | 'cobrado_full' | null
 * @property {string} [paidStatus] 'partial' | 'paid' | null
 * @property {Array<{qtyInvoiced?: number}>} [lines] pedidos schema real
 * @property {Array<{qtyInvoiced?: number}>} [items] fallback histórico
 * @property {{orderDocEntry?: number, docNum?: number}} [transferidoSAP]
 */

/**
 * Determines which Kanban column a pedido belongs to.
 *
 * @param {PlannerPedido} [pedido] - The pedido document (optional for robustness)
 * @returns {'lista_espera' | 'oferta' | 'ordenes' | 'confirmado' | 'facturar' | 'cobrado'}
 */
export function computeColumn(pedido) {
  if (!pedido) {
    return 'lista_espera';
  }

  // Rule 1: plannerStage === 'confirmado' (top priority)
  if (pedido.plannerStage === 'confirmado') {
    return 'confirmado';
  }

  // Rule 2: plannerStage === 'cobrado_parcial' || 'cobrado_full'
  if (pedido.plannerStage === 'cobrado_parcial' || pedido.plannerStage === 'cobrado_full') {
    return 'cobrado';
  }

  // Rule 3: paidStatus === 'partial' || 'paid'
  if (pedido.paidStatus === 'partial' || pedido.paidStatus === 'paid') {
    return 'cobrado';
  }

  // Rule 4: any line with qtyInvoiced > 0
  // v1013 (2026-09-22): schema real de pedidos es `lines`. Mantenemos `items`
  // como fallback por si algún doc viejo usa el nombre anterior.
  const lineas = Array.isArray(pedido.lines)
    ? pedido.lines
    : Array.isArray(pedido.items)
      ? pedido.items
      : [];
  if (lineas.some((line) => (line?.qtyInvoiced || 0) > 0)) {
    return 'facturar';
  }

  // Rule 5: transferidoSAP?.orderDocEntry truthy
  if (pedido.transferidoSAP?.orderDocEntry) {
    return 'ordenes';
  }

  // Rule 6: transferidoSAP?.docNum truthy
  if (pedido.transferidoSAP?.docNum) {
    return 'oferta';
  }

  // Rule 7: default
  return 'lista_espera';
}
