// @ts-check
/**
 * v1398 (2026-10-21) §40.6 — Plan de cancelación de ASIG al borrar un
 * waitlist CPST con la opción "cliente_rechazo_cpst".
 *
 * Al borrar un pedido en espera generado desde Stock Asignado, el VDE elige:
 *   1) El cliente no quiere la mercadería → cancela el waitlist Y las ASIG
 *      de origen (las líneas ASIG referenciadas en pedidosOrigenes/asigRefs).
 *   2) Solo borra el borrador → cancela el waitlist y la ASIG sigue reservada.
 *
 * Esta función es PURA. Dado el waitlist doc, devuelve la lista de líneas a
 * cancelar. Dedupe por (pedidoId, lineIndex). Toma la unión de:
 *   - w.pedidosOrigenes[] (document-level, pattern v1280).
 *   - w.items[].asigRefs[] (per-line, pattern v1382 orden unificada).
 *
 * El caller aplica la cancelación en Firestore: line.state='cancelled',
 * closedReason='cliente_rechazo_cpst', cancelledAt, cancelledBy. Idempotente:
 * segunda ejecución sobre líneas ya cancelled no las toca.
 */

/**
 * @typedef {Object} AsigRef
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} [qtyAsignada]
 * @property {string} [sku]
 * @property {boolean} [enTransito]  v8 §E1: ref tránsito dep 12 (audit).
 */

/**
 * @param {{ pedidosOrigenes?: AsigRef[], items?: Array<{ asigRefs?: AsigRef[] }> } | null | undefined} w
 * @returns {AsigRef[]} refs únicas, dedupe por (pedidoId, lineIndex).
 */
export function collectAsigRefsForCancel(w) {
  /** @type {Map<string, AsigRef>} */
  const refs = new Map();
  const add = (/** @type {AsigRef|undefined} */ r) => {
    if (!r || !r.pedidoId || typeof r.lineIndex !== 'number') return;
    const key = r.pedidoId + '|' + r.lineIndex;
    const existing = refs.get(key);
    const q = Number(r.qtyAsignada) || 0;
    if (existing) {
      // Dedupe: mantener la qty máxima entre fuentes (defense-in-depth —
      // normalmente ambos deberían coincidir, pero una orden unificada puede
      // haber heredado un pedidosOrigenes del documento base y uno distinto
      // en asigRefs).
      existing.qtyAsignada = Math.max(existing.qtyAsignada || 0, q);
      if (r.sku && !existing.sku) existing.sku = r.sku;
      // v8 §E1: si alguna fuente marcó la ref como tránsito, se preserva.
      if (r.enTransito === true) existing.enTransito = true;
    } else {
      /** @type {AsigRef} */
      const neu = { pedidoId: r.pedidoId, lineIndex: r.lineIndex, qtyAsignada: q };
      if (r.sku) neu.sku = r.sku;
      if (r.enTransito === true) neu.enTransito = true;
      refs.set(key, neu);
    }
  };
  if (w && Array.isArray(w.pedidosOrigenes)) {
    for (const r of w.pedidosOrigenes) add(r);
  }
  if (w && Array.isArray(w.items)) {
    for (const it of w.items) {
      if (it && Array.isArray(it.asigRefs)) {
        for (const r of it.asigRefs) add(r);
      }
    }
  }
  return Array.from(refs.values());
}

/**
 * v8 §E1: extiende un closedReason base con `_transito` si la ref era tránsito.
 * Mantiene closedReason original si enTransito=false/undefined (idempotente).
 *
 * @param {string} baseReason  ej. 'cliente_rechazo_cpst'
 * @param {{enTransito?: boolean} | null | undefined} ref
 * @returns {string}
 */
export function buildClosedReasonWithTransito(baseReason, ref) {
  const r = String(baseReason || '');
  if (ref && ref.enTransito === true) return r + '_transito';
  return r;
}

/**
 * Suma unidades que se liberarían si el VDE elige "cliente_rechazo_cpst".
 * @param {AsigRef[]} refs
 * @returns {number}
 */
export function sumUnitsToFreeOnCancel(refs) {
  if (!Array.isArray(refs)) return 0;
  return refs.reduce((s, r) => s + (Number(r && r.qtyAsignada) || 0), 0);
}
