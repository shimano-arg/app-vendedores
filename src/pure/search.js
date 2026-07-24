/**
 * Buscador multi-token AND. Extracted de index.html:24962-24971 para E4.
 *
 * matchesAllTokens divide la query por espacios y requiere que TODOS los
 * tokens aparezcan en el haystack (concatenado). Normaliza vía NFD para
 * que "López" matchee "lopez". Introducido en v313.
 *
 * Ejemplos que ahora funcionan:
 *   matchesAllTokens('El Pez Gordo — Quilmes Oeste', 'pez quilmes') → true
 *   matchesAllTokens('Pescamagic — Buenos Aires', 'pesca aires')   → true
 *   matchesAllTokens('X', 'foo')                                    → false
 */
import { normalizeSearch } from './normalize.js';

/**
 * @param {string} haystack
 * @param {string | null | undefined} query
 * @returns {boolean}
 */
export function matchesAllTokens(haystack, query) {
  if (!query) return true;
  const q = normalizeSearch(query).trim();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  if (!tokens.length) return true;
  const hay = normalizeSearch(haystack);
  return tokens.every((tok) => hay.indexOf(tok) >= 0);
}
