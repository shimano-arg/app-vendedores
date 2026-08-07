// @ts-check
/**
 * Funciones puras de normalización de strings. Extracted de index.html
 * (líneas 3365-3372, 4396, 5580, 18595, 24962) como parte de E4 (Fase 0)
 * para poder testear con Vitest. E2 completa la modularización y hace
 * que index.html las importe de acá.
 */

// U+0300 – U+036F: diacríticos combinantes (marcas de acento).
const DIACRITICS_RE = new RegExp(
  '[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']',
  'g'
);

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
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Overrides display-only para vendor keys donde la clave canónica interna
 * tiene un typo histórico que no se puede migrar sin romper datos
 * históricos (Firestore + BQ + SAP SlpCode + email en Workspace).
 *
 * Federico: apellido real "Castelaneli" (1 L). El sistema completo usa
 * "CASTELANELLI" (2 L) porque el email corporativo se dió de alta con
 * typo hace años y todo lo demás se cascadeó: SAP SlpCode 54 name, todos
 * los pedidos/visitas/targets en Firestore, snapshots BQ, etc. Cambiar
 * la key requiere migración full + coordinación con IT (Google Workspace)
 * y SEIDOR (SAP OSLP). Mientras tanto este mapping garantiza que el USER
 * lo vea escrito correcto en la UI.
 */
/** @type {Record<string, string>} */
const VENDOR_DISPLAY_OVERRIDES = {
  'FEDERICO CASTELANELLI': 'Federico Castelaneli',
};

/**
 * Devuelve el nombre human-readable de un vendor key. Aplica override
 * si existe (ver VENDOR_DISPLAY_OVERRIDES) o fallback a titleCase().
 * Usar SIEMPRE que se muestre un vendor al user (badges, listados, exports,
 * dashboards). NUNCA para lógica interna (comparaciones, storage, matching).
 * @param {unknown} vendorKey
 * @returns {string}
 */
export function displayVendorName(vendorKey) {
  if (vendorKey == null || vendorKey === '') return '';
  const upper = String(vendorKey).toUpperCase().trim();
  if (VENDOR_DISPLAY_OVERRIDES[upper]) return VENDOR_DISPLAY_OVERRIDES[upper];
  return titleCase(vendorKey);
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
