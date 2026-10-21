// @ts-check
/**
 * v1399 (2026-10-21) §40.7 — helpers puros para liberar reserva al reducir
 * o quitar líneas de un pedido CPST.
 *
 * Casos cubiertos (extensión de §40.6):
 *   1. Botón X "Quitar producto" sobre línea con reserva: devuelve las refs
 *      de ESA línea (filtradas desde w.items[itemIndex].asigRefs + match por
 *      sku en w.pedidosOrigenes[]). Caller aplica cancelación idéntica a §40.6
 *      pero con closedReason='quitado_por_vendedor_cpst'.
 *   2. Edit qty < reserva + enviar a SAP: al confirmar el pedido B, el bloque
 *      v1280 descompone cada org en {qtyConsumed, qtyRecortado}. El consumido
 *      corresponde a lo que efectivamente va al pedido B (cancel con reason
 *      'waitlist-confirm'); el recortado se cancela aparte con reason
 *      'recorte_vendedor_cpst'. Caller aplica split de la línea original.
 *
 * Regla CLAUDE.md §40.7: toda reducción explícita del VDE sobre una línea
 * con reserva libera la diferencia.
 */

/**
 * @typedef {Object} AsigRef
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} [qtyAsignada]
 * @property {string} [sku]
 */

/**
 * Devuelve las refs ASIG que respaldan UNA línea del waitlist. Mira
 * item.asigRefs (per-line v1382) + w.pedidosOrigenes filtrado por item.code
 * (fallback para waitlists pre-v1382 que solo tienen refs a nivel documento).
 *
 * @param {{ items?: Array<any>, pedidosOrigenes?: AsigRef[] } | null | undefined} w
 * @param {number} itemIndex
 * @returns {AsigRef[]}
 */
export function collectAsigRefsForItemCancel(w, itemIndex) {
  if (!w || typeof w !== 'object') return [];
  const items = Array.isArray(w.items) ? w.items : [];
  const item = items[itemIndex];
  if (!item || !item.code) return [];
  const sku = String(item.code).toUpperCase();
  /** @type {Map<string, AsigRef>} */
  const refs = new Map();
  const add = (/** @type {AsigRef|undefined} */ r) => {
    if (!r || !r.pedidoId || typeof r.lineIndex !== 'number') return;
    const key = r.pedidoId + '|' + r.lineIndex;
    const existing = refs.get(key);
    const q = Number(r.qtyAsignada) || 0;
    if (existing) {
      existing.qtyAsignada = Math.max(existing.qtyAsignada || 0, q);
    } else {
      /** @type {AsigRef} */
      const neu = { pedidoId: r.pedidoId, lineIndex: r.lineIndex, qtyAsignada: q, sku };
      refs.set(key, neu);
    }
  };
  // Primera fuente: asigRefs del item (per-line, preferido).
  if (Array.isArray(item.asigRefs)) {
    for (const r of item.asigRefs) add(r);
  }
  // Segunda fuente: pedidosOrigenes del doc filtrado por sku (fallback v1280-only).
  if (Array.isArray(w.pedidosOrigenes)) {
    for (const r of w.pedidosOrigenes) {
      if (!r || !r.pedidoId) continue;
      if (String(r.sku || '').toUpperCase() !== sku) continue;
      add(r);
    }
  }
  return Array.from(refs.values());
}

/**
 * Dado el array de ASIG a cancelar al confirmar un pedido B (origenesACancelar)
 * y la qty consumida por SKU en pedido B (qtyConsumedBySku), decompone cada
 * org en {qtyConsumed, qtyRecortado}. qtyConsumed = min(qtyAsig, qty_consumible
 * restante del SKU). qtyRecortado = qtyAsig - qtyConsumed.
 *
 * Al llamar en orden sobre refs del mismo SKU, va consumiendo el bucket global
 * (FIFO por el orden de refs).
 *
 * @param {AsigRef[]} origenes
 * @param {Record<string, number>} qtyConsumedBySku
 * @returns {Array<{pedidoId:string, lineIndex:number, sku:string, qtyAsignada:number, qtyConsumed:number, qtyRecortado:number}>}
 */
export function computeRecorteVendedorPlan(origenes, qtyConsumedBySku) {
  const remaining = Object.assign({}, qtyConsumedBySku || {});
  const out = [];
  for (const org of Array.isArray(origenes) ? origenes : []) {
    if (!org || !org.pedidoId) continue;
    const sku = String(org.sku || '').toUpperCase();
    const qtyAsig = Number(org.qtyAsignada) || 0;
    const avail = Math.max(0, Number(remaining[sku]) || 0);
    const qtyConsumed = Math.min(qtyAsig, avail);
    const qtyRecortado = qtyAsig - qtyConsumed;
    remaining[sku] = avail - qtyConsumed;
    out.push({
      pedidoId: String(org.pedidoId),
      lineIndex: Number(org.lineIndex),
      sku,
      qtyAsignada: qtyAsig,
      qtyConsumed,
      qtyRecortado,
    });
  }
  return out;
}

/**
 * Suma qty total de líneas en el pedido B por SKU. Caller llama al construir
 * el batch del bloque v1280.
 * @param {Array<{code:string, qty:(number|string)}>} lines
 * @returns {Record<string, number>}
 */
export function sumQtyBySku(lines) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l || !l.code) continue;
    const sku = String(l.code).toUpperCase();
    out[sku] = (out[sku] || 0) + (Number(l.qty) || 0);
  }
  return out;
}
