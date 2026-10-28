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

/**
 * PR 2 (v1504, 2026-10-28) — descripción LIVE para readers UI.
 *
 * Diferencia con `resolveLineDesc`:
 *   - `resolveLineDesc` (write-side): `line.desc populated → catalog → ''`.
 *     Es el que usa el CF al PERSISTIR la línea, con prioridad al valor que
 *     mandó el cliente (snapshot al momento de crear la orden).
 *   - `resolveLineDescLive` (read-side): `catalog.desc → line.desc → line.code`.
 *     Es el que usa la UI al RENDERIZAR líneas de pedidos existentes. Si la
 *     ficha del SKU cambió en Master de Productos (ej. "2 tramos" → "1 tramo"
 *     corregido en SAP), queremos mostrar la vigente, no la snapshot stale
 *     guardada en `pedido.lines[].desc`.
 *
 * Qué viaja a SAP: NUNCA cambia. SAP recibe `l.desc` original (snapshot al
 * confirmar), y además SAP deriva la desc por su cuenta desde su catálogo
 * (`ItemCode → OITM`). Esta función solo afecta la UI/exports.
 *
 * Fallback a `line.desc`: si el SKU se borró del catálogo (ej. retirado de
 * portfolio) o el catálogo no cargó todavía, mostramos la copia histórica
 * en vez de un string vacío.
 *
 * @param {{code?: string, desc?: string, descripcion?: string} | null | undefined} line
 * @param {Catalog | null | undefined} [catalog]
 * @returns {string}
 */
export function resolveLineDescLive(line, catalog) {
  if (!line) return '';
  const code = _normCode(line.code);
  if (code) {
    const fromCatalog = _catalogLookup(catalog, code);
    if (fromCatalog) return fromCatalog;
  }
  const lineDesc = String(line.desc || line.descripcion || '').trim();
  if (lineDesc) return lineDesc;
  return code; // último recurso: el code (nunca "undefined" ni vacío si hay code)
}

/**
 * Construye un `Catalog` (plain object) a partir de un array con shape
 * `{code, desc}` (ej. `window.PRODUCTS` del app-vendedores). Normaliza keys
 * a uppercase para match contra `_normCode`.
 *
 * Idempotente: devuelve `{}` si `products` no es array.
 *
 * @param {Array<{code?: string, desc?: string, descripcion?: string, name?: string}> | null | undefined} products
 * @returns {Record<string, CatalogEntry>}
 */
export function buildCatalogDescMapFromProducts(products) {
  /** @type {Record<string, CatalogEntry>} */
  const map = {};
  if (!Array.isArray(products)) return map;
  for (const p of products) {
    if (!p || !p.code) continue;
    const key = _normCode(p.code);
    if (!key) continue;
    map[key] = {
      descripcion: String(p.descripcion || p.desc || p.name || '').trim(),
    };
  }
  return map;
}
