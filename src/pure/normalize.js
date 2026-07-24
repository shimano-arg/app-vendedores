// @ts-check
/**
 * Funciones puras de normalización de strings. Extracted de index.html
 * (líneas 3365-3372, 4396, 5580, 18595, 24962) como parte de E4 (Fase 0)
 * para poder testear con Vitest. E2 completa la modularización y hace
 * que index.html las importe de acá.
 */

// U+0300 – U+036F: diacríticos combinantes (marcas de acento).
const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36F) + ']', 'g');

/**
 * Normaliza nombre de cliente: NFD → strip diacríticos → upper → trim.
 * Ejemplos: "Café López " → "CAFE LOPEZ". null/undefined → "".
 * @param {unknown} s
 * @returns {string}
 */
export function normClientName(s) {
  if (s == null) return '';
  return String(s).normalize('NFD').replace(DIACRITICS_RE, '').toUpperCase().trim();
}

/**
 * "hola mundo" → "Hola Mundo". Cada palabra empieza con mayúscula.
 * @param {unknown} s
 * @returns {string}
 */
export function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * HTML-escape para outputs innerHTML. Cubre &, <, >, ", '.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  /** @type {Record<string, string>} */
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s).replace(/[&<>"']/g, (ch) => map[ch]);
}

/**
 * Normaliza título de producto: NFD → strip diacríticos → upper →
 * strip todo lo que no sea A-Z o 0-9. Usada para matching MELI ↔ SKU.
 * "Reel Shimano 4000-FI" → "REELSHIMANO4000FI".
 * @param {unknown} s
 * @returns {string}
 */
export function normTitle(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Normaliza query de búsqueda: NFD → strip diacríticos → lower.
 * Preserva espacios (a diferencia de normTitle). Usada por buscadores.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizeSearch(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(DIACRITICS_RE, '');
}
