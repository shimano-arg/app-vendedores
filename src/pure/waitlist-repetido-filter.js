// @ts-check
/**
 * v1421 §55 (2026-10-22) — filtro del aviso "SKU que este cliente ya tenía en
 * pedidos anteriores" del modal "Pedido en Espera".
 *
 * Regla: una línea cuenta para el aviso solo si:
 *   1. NO tiene `origen === 'stock-asignado'` (reservada por construcción).
 *   2. El SKU aparece en otro pedido abierto o confirmed-sin-facturar del
 *      cliente, excluyendo:
 *      - El propio waitlist actual (`w._id`).
 *      - Los pedidos de origen de las asignaciones del waitlist entero
 *        (`w.pedidosOrigenes[].pedidoId` + cada `item.asigRefs[].pedidoId`).
 *
 * Precedente: SUSANA GRACIELA ANDRILI, orden 530, CUDC201HG reservada.
 * El flujo pre-v1421 agregaba el badge "PEDIDO ANTERIOR" porque el pedido
 * origen de la ASIG era otro doc abierto del mismo cliente. Falso positivo
 * por construcción.
 */

/**
 * Construye el Set de pedidoIds a excluir del aviso "pedido anterior".
 *
 * @param {{_id?:string, pedidosOrigenes?:Array<{pedidoId?:string}>, items?:Array<{asigRefs?:Array<{pedidoId?:string}>}>}} waitlist
 * @returns {Set<string>}
 */
export function buildExcludedPedidoIdsForRepetido(waitlist) {
  const out = new Set();
  if (!waitlist) return out;
  if (waitlist._id) out.add(String(waitlist._id));
  if (Array.isArray(waitlist.pedidosOrigenes)) {
    for (const org of waitlist.pedidosOrigenes) {
      if (org && org.pedidoId) out.add(String(org.pedidoId));
    }
  }
  if (Array.isArray(waitlist.items)) {
    for (const it of waitlist.items) {
      if (!it || !Array.isArray(it.asigRefs)) continue;
      for (const ref of it.asigRefs) {
        if (ref && ref.pedidoId) out.add(String(ref.pedidoId));
      }
    }
  }
  return out;
}

/**
 * Devuelve true si la línea cuenta para el aviso + badge "pedido anterior".
 *
 * @param {{origen?:string|null}} line Línea del waitlist.
 * @param {Array<{pedidoId?:string}>} yaEnOtroPedido Lista cruda del `getStockPorCliente`.
 * @param {Set<string>} excludedPedidoIds Set construido con `buildExcludedPedidoIdsForRepetido`.
 * @returns {boolean}
 */
export function lineCountsAsPedidoAnterior(line, yaEnOtroPedido, excludedPedidoIds) {
  if (!line) return false;
  // Regla 1: líneas con origen=stock-asignado nunca cuentan — por construcción
  // la ASIG original pertenece al pedido origen y es el motivo del badge RESERVADO.
  if (line.origen === 'stock-asignado') return false;
  if (!Array.isArray(yaEnOtroPedido) || yaEnOtroPedido.length === 0) return false;
  for (const x of yaEnOtroPedido) {
    if (!x || !x.pedidoId) continue;
    if (excludedPedidoIds && excludedPedidoIds.has(String(x.pedidoId))) continue;
    return true;
  }
  return false;
}

/**
 * Filtra la lista cruda de yaEnOtroPedido excluyendo los pedidos origen.
 * Si la línea es `origen='stock-asignado'`, devuelve array vacío.
 *
 * @param {{origen?:string|null}} line
 * @param {Array<{pedidoId?:string}>} yaEnOtroPedido
 * @param {Set<string>} excludedPedidoIds
 * @returns {Array<{pedidoId?:string}>}
 */
export function filterYaEnOtroPedidoForLine(line, yaEnOtroPedido, excludedPedidoIds) {
  if (!line || line.origen === 'stock-asignado') return [];
  if (!Array.isArray(yaEnOtroPedido)) return [];
  return yaEnOtroPedido.filter(
    (x) => x && x.pedidoId && !(excludedPedidoIds && excludedPedidoIds.has(String(x.pedidoId)))
  );
}
