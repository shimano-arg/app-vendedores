// @ts-check
/**
 * waitlist-cpst-origen (v1466, 2026-10-26) — hotfix bug STOCK_CHANGED loop
 * reportado por Santi 2026-10-26 ~16:46 ART (ORDEN 533 MARISA LUJAN
 * IANUNZIO C27184733760, waitlistOrigenId Uvh1A4bhWfriBW5KZlO5).
 *
 * CAUSA RAÍZ:
 *   Waitlists CPST pre-v1382 (y algunas v1382+ con bug) tienen
 *   `w.source='stock-asignado-batch'` + `w.pedidosOrigenes[]` populated
 *   a nivel DOCUMENTO, pero `w.items[].origen` + `w.items[].asigRefs`
 *   vacíos. Al "Pasar a Pendientes", `_waitlistPasarAPendientesContinuar`
 *   mapeaba `it.origen` sin fallback → payload CF llegaba con
 *   `origenLinea=undefined` + `asigRefs=undefined` → el core aplicaba
 *   fórmula GLOBAL (CLAUDE.md §33/§35) `breakdown.libre` en vez de
 *   `breakdown.utilizablePara(cardCode)` → para SKU LDM54TE4028015S
 *   con fisicoDep11=20 asignadas=20 → libre=0 → qtyBO=qty → disparaba
 *   STOCK_CHANGED (sin clientStock) aunque el stock real estaba
 *   reservado PARA ESTE CLIENTE.
 *
 * FIX:
 *   Derivar `origen='stock-asignado'` + `asigRefs` POR SKU desde
 *   `w.pedidosOrigenes[]` cuando `w.source='stock-asignado-batch'` y
 *   los items[] no los tengan explícitos. Idempotente: si el item ya
 *   trae origen+asigRefs (v1382+ bien poblado), se preserva.
 *
 * REGLAS §33/§35: la decisión POR LÍNEA se mantiene — una línea que no
 * matchea con pedidosOrigenes (ej. CUDC151MGA en la orden de Santi, SKU
 * agregado manualmente al CPST) queda SIN origen → usa fórmula global
 * (correcto para línea manual).
 */

/**
 * @typedef {Object} PedidosOrigenRef
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {string} sku
 * @property {number} qtyAsignada
 */

/**
 * @typedef {Object} WaitlistItem
 * @property {string} [code]
 * @property {string} [desc]
 * @property {number} [qty]
 * @property {string} [origen]
 * @property {PedidosOrigenRef[]} [asigRefs]
 * @property {number} [importedFromOrder]
 */

/**
 * @typedef {Object} WaitlistDoc
 * @property {string} [source]
 * @property {PedidosOrigenRef[]} [pedidosOrigenes]
 * @property {WaitlistItem[]} [items]
 */

/**
 * Normaliza SKU para matching (uppercase + trim).
 * @param {any} v
 * @returns {string}
 */
function _normSku(v) {
  return String(v || '')
    .toUpperCase()
    .trim();
}

/**
 * Construye el mapa `{sku -> [asigRef]}` a partir de `w.pedidosOrigenes`.
 * Devuelve `null` si la waitlist no es CPST (`source != stock-asignado-batch`)
 * o si `pedidosOrigenes` no está populated.
 *
 * @param {WaitlistDoc} w
 * @returns {Record<string, PedidosOrigenRef[]> | null}
 */
export function buildOrigenesBySkuFromWaitlist(w) {
  if (!w || w.source !== 'stock-asignado-batch') return null;
  if (!Array.isArray(w.pedidosOrigenes) || w.pedidosOrigenes.length === 0) return null;
  /** @type {Record<string, PedidosOrigenRef[]>} */
  const out = {};
  for (const po of w.pedidosOrigenes) {
    if (!po || !po.sku) continue;
    const k = _normSku(po.sku);
    if (!out[k]) out[k] = [];
    out[k].push({
      pedidoId: po.pedidoId,
      lineIndex: Number(po.lineIndex),
      sku: po.sku,
      qtyAsignada: Number(po.qtyAsignada) || 0,
    });
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Enriquece un item del waitlist con `origen` + `asigRefs` derivados desde
 * `pedidosOrigenes` si corresponde. Idempotente: si el item ya tiene origen,
 * se preserva. Si tiene asigRefs explícitos se preservan sin tocar.
 *
 * @param {WaitlistItem} item
 * @param {Record<string, PedidosOrigenRef[]> | null} origenesBySku
 * @returns {{origen?: string, asigRefs?: PedidosOrigenRef[]}}
 */
export function enrichItemWithCpstOrigen(item, origenesBySku) {
  if (!item) return {};
  const existingOrigen = item.origen;
  const existingAsigRefs =
    Array.isArray(item.asigRefs) && item.asigRefs.length > 0
      ? item.asigRefs.map((r) => ({ ...r }))
      : null;
  // v1382+ bien populado: respetar sin tocar.
  if (existingOrigen) {
    const out = /** @type {{origen?: string, asigRefs?: PedidosOrigenRef[]}} */ ({
      origen: existingOrigen,
    });
    if (existingAsigRefs) out.asigRefs = existingAsigRefs;
    return out;
  }
  // Sin origen explícito. Intentar derivar desde pedidosOrigenes del doc.
  if (!origenesBySku) return {};
  const sku = _normSku(item.code);
  const refs = origenesBySku[sku];
  if (!Array.isArray(refs) || refs.length === 0) return {};
  return {
    origen: 'stock-asignado',
    asigRefs: refs.map((r) => ({ ...r })),
  };
}
