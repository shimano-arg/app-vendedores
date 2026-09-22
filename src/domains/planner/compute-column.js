// @ts-check
/**
 * planner-compute-column (Planner Kanban, 2026-09-22).
 *
 * Pure function that determines which Kanban column a pedido belongs to
 * based on its state and document properties. Dual implementation:
 * - Server: functions/core/planner-compute-column.js (Cloud Functions)
 * - Client: src/domains/planner/compute-column.js (bundle)
 *
 * Used to render the Planner Kanban board with 5 columns:
 * 'lista_espera' | 'oferta' | 'ordenes' | 'facturar' | 'cobrado'
 *
 * Algorithm priority (top-down):
 * 1. plannerStage === 'cobrado_parcial' || 'cobrado_full' → 'cobrado'
 * 2. paidStatus === 'partial' || 'paid' → 'cobrado'
 * 3. items.some(l => (l?.qtyInvoiced || 0) > 0) → 'facturar'
 * 4. transferidoSAP?.orderDocEntry truthy → 'ordenes'
 * 5. transferidoSAP?.docNum truthy → 'oferta'
 * 6. else → 'lista_espera'
 *
 * v1037 (2026-09-22): removida columna 'confirmado' (0 uso en prod).
 * Pipeline queda 100% automático + lineal. Docs con plannerStage='confirmado'
 * caen ahora en las siguientes reglas SAP-based (solo BIANCHINI SAP:2000120
 * lo tenía en prod y ya caía en 'facturar' por Rule 3 — cero impacto).
 *
 * @typedef {Object} PlannerPedido
 * @property {string} [plannerStage] 'cobrado_parcial' | 'cobrado_full' | null
 * @property {string} [paidStatus] 'partial' | 'paid' | null
 * @property {Array<{qtyInvoiced?: number}>} [lines] pedidos schema real
 * @property {Array<{qtyInvoiced?: number}>} [items] fallback histórico
 * @property {{orderDocEntry?: number, docNum?: number}} [transferidoSAP]
 */

/**
 * Determines which Kanban column a pedido belongs to.
 *
 * @param {PlannerPedido} [pedido] - The pedido document (optional for robustness)
 * @returns {'lista_espera' | 'oferta' | 'ordenes' | 'facturar' | 'cobrado'}
 */
export function computeColumn(pedido) {
  if (!pedido) {
    return 'lista_espera';
  }

  // Rule 1: plannerStage === 'cobrado_parcial' || 'cobrado_full' (estado final drag)
  if (pedido.plannerStage === 'cobrado_parcial' || pedido.plannerStage === 'cobrado_full') {
    return 'cobrado';
  }

  // Rule 2: paidStatus === 'partial' || 'paid' (señal SAP de cobro)
  if (pedido.paidStatus === 'partial' || pedido.paidStatus === 'paid') {
    return 'cobrado';
  }

  // Rule 3: any line with qtyInvoiced > 0 → 'facturar' (señal SAP de facturación).
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

  // Rule 4: transferidoSAP?.orderDocEntry truthy
  if (pedido.transferidoSAP?.orderDocEntry) {
    return 'ordenes';
  }

  // Rule 5: transferidoSAP?.docNum truthy
  if (pedido.transferidoSAP?.docNum) {
    return 'oferta';
  }

  // Rule 6: default
  return 'lista_espera';
}
