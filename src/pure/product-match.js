/**
 * Matcher de SKU a partir de título MELI. Extracted de index.html:18627.
 *
 * Estrategia 2-pass:
 *   1. Match por SKU code substring (más específico gana — long > short).
 *   2. Fallback a familia/subfamilia substring (más laxo).
 *
 * REFACTOR para testeabilidad: los índices `skuIndex` y `skuTokens` se
 * pasan como parámetros (antes globales construidos desde PRODUCTS).
 */
import { normTitle } from './normalize.js';

/**
 * @typedef {Record<string, unknown[]>} MatchIndex
 * @typedef {Record<string, unknown[]>} TokenIndex
 */

/**
 * @param {string} meliTitle Título crudo del MELI.
 * @param {MatchIndex} skuIndex Map de SKU normalizado → array de productos.
 * @param {TokenIndex} skuTokens Map de familia/subfamilia → array productos.
 * @returns {unknown[] | null} Array de productos match, o null si nada.
 */
export function matchSkuFromTitle(meliTitle, skuIndex, skuTokens) {
  const t = normTitle(meliTitle);
  let best = null;
  let bestLen = 0;
  for (const k in skuIndex) {
    if (t.indexOf(k) !== -1 && k.length > bestLen) {
      best = skuIndex[k];
      bestLen = k.length;
    }
  }
  if (best) return best;
  for (const tok in skuTokens) {
    if (t.indexOf(tok) !== -1) return skuTokens[tok];
  }
  return null;
}
