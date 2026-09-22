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
 * 1. plannerStage === 'cobrado_parcial' || 'cobrado_full' → 'cobrado'
 * 2. paidStatus === 'partial' || 'paid' → 'cobrado'
 * 3. items.some(l => (l?.qtyInvoiced || 0) > 0) → 'facturar'
 * 4. plannerStage === 'confirmado' → 'confirmado'
 * 5. transferidoSAP?.orderDocEntry truthy → 'ordenes'
 * 6. transferidoSAP?.docNum truthy → 'oferta'
 * 7. else → 'lista_espera'
 *
 * v1016 (2026-09-22): 'facturar' (auto SAP) precede a 'confirmado' (drag manual).
 * Bug reportado por Mariano: BIANCHINI SAP:2000120 quedaba trabado en Confirmado
 * después de haber sido arrastrado ahí, aunque SAP ya había facturado 15/78u.
 * Semántica: Confirmado es un stage de tránsito manual; si SAP avanza el pedido
 * (facturación o cobro), esas señales pisan al drag y promueven la card sola.
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
  // v1016 (2026-09-22): esta regla precede a plannerStage='confirmado' (Rule 4).
  // SAP facturó = flujo avanzó más allá de Confirmado aunque el drag manual quedó.
  const lineas = Array.isArray(pedido.lines)
    ? pedido.lines
    : Array.isArray(pedido.items)
      ? pedido.items
      : [];
  if (lineas.some((line) => (line?.qtyInvoiced || 0) > 0)) {
    return 'facturar';
  }

  // Rule 4: plannerStage === 'confirmado' (drag manual)
  if (pedido.plannerStage === 'confirmado') {
    return 'confirmado';
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
