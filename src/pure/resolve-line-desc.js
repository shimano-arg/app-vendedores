// @ts-check
/**
 * resolve-line-desc (v1477, 2026-10-26) — PR 4 §75.
 *
 * Problema: pedidos CPST con origen=stock-asignado (ej. ORDEN 502 OSVALDO
 * MASERA) tienen líneas en Firestore sin `desc` populated. La UI del detalle
 * usa `escapeHtml(l.desc)` sin fallback → `escapeHtml(undefined)` →
 * `String(undefined)` → literal "undefined" visible al vendedor.
 *
 * Causas raíz (3 call-sites rotos):
 *   1. functions/core/commit-pedido-core.js:812-840 arma `_lineConfirmed` sin
 *      copiar `desc` del payload cliente.
 *   2. Script W_reparar_pedidos_bo_fantasma_2026-10-25 escribió líneas sin desc.
 *   3. mergeLinesFromOrders §56 / helpers v1466 (si aplica) sin propagar desc.
 *
 * Fix definitivo: ÚNICA función que resuelve la descripción de una línea.
 * Prioridad: 1) desc populated en la línea, 2) catálogo `sap_products/{code}`,
 * 3) fallback vacío. Usada por TODOS los caminos (server-side al escribir
 * líneas + client-side al renderizar como fallback defensivo).
 *
 * CLAUDE.md §75: toda línea escrita a `pedidos` o `revision_waitlist` lleva
 * SIEMPRE la descripción resuelta por esta función.
 */

/**
 * @typedef {Object} CatalogEntry
 * @property {string} [descripcion] Field principal en sap_products.
 * @property {string} [desc] Alias legacy.
 * @property {string} [name] Fallback adicional.
 */

/**
 * @typedef {Record<string, CatalogEntry> | Map<string, CatalogEntry>} Catalog
 *   Mapa `code → entry`. Acepta plain object (window.sapProductsMap) o Map.
 */

/**
 * Normaliza code: uppercase + trim. Firestore sap_products usa docId uppercase.
 *
 * @param {any} v
 * @returns {string}
 */
function _normCode(v) {
  return String(v || '')
    .toUpperCase()
    .trim();
}

/**
 * Lee descripción del catálogo. Acepta plain object o Map.
 *
 * @param {Catalog | null | undefined} catalog
 * @param {string} normalizedCode
 * @returns {string}
 */
function _catalogLookup(catalog, normalizedCode) {
  if (!catalog) return '';
  /** @type {CatalogEntry | undefined} */
  let entry;
  if (catalog instanceof Map) {
    entry = catalog.get(normalizedCode);
  } else if (typeof catalog === 'object') {
    entry = /** @type {Record<string, CatalogEntry>} */ (catalog)[normalizedCode];
  }
  if (!entry) return '';
  return String(entry.descripcion || entry.desc || entry.name || '').trim();
}

/**
 * Resuelve la descripción de una línea. Prioridad:
 *   1. `line.desc` populated y non-trivial.
 *   2. Catálogo `sap_products` lookup por code.
 *   3. String vacío (nunca "undefined").
 *
 * NUNCA devuelve undefined; siempre string.
 *
 * @param {{code?: string, desc?: string, descripcion?: string} | null | undefined} line
 * @param {Catalog | null | undefined} [catalog]
 * @returns {string}
 */
export function resolveLineDesc(line, catalog) {
  if (!line) return '';
  const lineDesc = String(line.desc || line.descripcion || '').trim();
  if (lineDesc) return lineDesc;
  const code = _normCode(line.code);
  if (!code) return '';
  return _catalogLookup(catalog, code);
}

/**
 * Chequea si una línea tiene desc populated. Útil para auditorías
 * (ej. backfill script).
 *
 * @param {{desc?: string} | null | undefined} line
 * @returns {boolean}
 */
export function hasDesc(line) {
  return !!(line && typeof line.desc === 'string' && line.desc.trim());
}
