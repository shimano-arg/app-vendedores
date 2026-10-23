// @ts-check
/**
 * §63 (2026-10-23) — ESPEJO de `src/pure/cpst-cancel-asig-plan.js` +
 * `src/pure/cpst-item-cancel-helpers.js`.
 *
 * CLAUDE.md §57: lógica compartida cliente+servidor vive una sola vez
 * en src/pure/<name>.js con copia espejo en functions/core/<name>.js y
 * test de sincronía que falla si divergen.
 *
 * NO EDITAR SIN REPLICAR EL CAMBIO EN AMBOS ARCHIVOS DE src/pure/.
 */

/**
 * @typedef {Object} AsigRef
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} [qtyAsignada]
 * @property {string} [sku]
 */

/**
 * Unión dedupe (pedidoId|lineIndex) de pedidosOrigenes (doc-level §40.6)
 * + items[].asigRefs (per-line §42 v1382).
 * @param {{ pedidosOrigenes?: AsigRef[], items?: Array<{ asigRefs?: AsigRef[] }> } | null | undefined} w
 * @returns {AsigRef[]}
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
      existing.qtyAsignada = Math.max(existing.qtyAsignada || 0, q);
      if (r.sku && !existing.sku) existing.sku = r.sku;
    } else {
      /** @type {AsigRef} */
      const neu = { pedidoId: r.pedidoId, lineIndex: r.lineIndex, qtyAsignada: q };
      if (r.sku) neu.sku = r.sku;
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
 * Refs ASIG de UNA línea del waitlist (§40.7 "Quitar producto").
 * Mira item.asigRefs (per-line v1382) + w.pedidosOrigenes filtrado por item.code.
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
  if (Array.isArray(item.asigRefs)) {
    for (const r of item.asigRefs) add(r);
  }
  if (Array.isArray(w.pedidosOrigenes)) {
    for (const r of w.pedidosOrigenes) {
      if (!r || !r.pedidoId) continue;
      if (String(r.sku || '').toUpperCase() !== sku) continue;
      add(r);
    }
  }
  return Array.from(refs.values());
}
