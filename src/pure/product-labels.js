// @ts-check
/**
 * v1495 §94 (2026-10-27) — fuente única para labels de producto en el picker.
 *
 * Bug reportado: en el buscador del modal de carga, varias filas del picker
 * mostraban "UNDEFINED UNDEFINED UNDEFINED" en la línea de categoría/familia/
 * subfamilia porque el renderer hacía `escapeHtml(p.cat)` + `escapeHtml(p.fam)`
 * + `escapeHtml(p.sub)` sin chequear si eran undefined. `escapeHtml` llama
 * `String(x)` internamente → `String(undefined)='undefined'` → la palabra se
 * imprime literal.
 *
 * SKUs afectados reportados (muestra): 26ZODIAS160MH, 271006, 471512, LUGC22,
 * DISPSUNGLASSES6, DISPSUNGLASSES9, KITBAITSPOINT, LINEDISP40X38, LR160FA.
 *
 * Regla UI:
 *   - Si falta cat/fam/sub (null, undefined, string vacío) → OMITIR ese span.
 *     Nada de "undefined", ni "-", ni placeholder.
 *   - Si falta desc → mostrar el SKU como fallback (visible).
 *   - Idempotente, puro, testeable sin DOM.
 *
 * Fuente única: usada por `src/domains/product-picker.js:renderProductPicker`
 * (línea 337-345 pre-v1495). Cualquier otro consumer que renderee producto
 * debe pasar también por acá.
 */

/**
 * Devuelve las partes NO vacías de categoría/familia/subfamilia, en el orden
 * cat → fam → sub. Vacío si el producto no tiene ninguna de las tres.
 *
 * @param {any} p
 * @returns {string[]}
 */
export function formatProductCatLineParts(p) {
  if (!p || typeof p !== 'object') return [];
  /** @type {string[]} */
  const out = [];
  for (const k of ['cat', 'fam', 'sub']) {
    const v = p[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    out.push(s);
  }
  return out;
}

/**
 * Devuelve la descripción del producto para mostrar. Fallback al SKU si
 * `desc` está vacío/null. Trim.
 *
 * @param {any} p
 * @returns {string}
 */
export function formatProductDesc(p) {
  if (!p || typeof p !== 'object') return '';
  const d = p.desc != null ? String(p.desc).trim() : '';
  if (d) return d;
  const code = p.code != null ? String(p.code).trim() : '';
  return code;
}

/**
 * Chequea si el producto tiene clasificación completa (cat + fam + sub todos
 * populados). Útil para auditorías.
 *
 * @param {any} p
 * @returns {boolean}
 */
export function hasFullClassification(p) {
  if (!p || typeof p !== 'object') return false;
  return ['cat', 'fam', 'sub'].every((k) => {
    const v = p[k];
    return v != null && String(v).trim() !== '';
  });
}
