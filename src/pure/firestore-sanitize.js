// @ts-check
/**
 * firestore-sanitize (v1470, 2026-10-26) — hotfix bug "Function
 * WriteBatch.update() called with invalid data. Unsupported field value:
 * undefined" reportado por Federico Castelanelli al guardar una orden en
 * lista de espera. Precedente del mismo síntoma en server-side resuelto en
 * v1469 §64 (commit-pedido-core.js:717).
 *
 * CAUSA RAÍZ del lado cliente: el SDK web Firestore v8 (compat) rechaza
 * `undefined` como valor en update/set/batch, idéntico al admin SDK sin
 * `ignoreUndefinedProperties`. Multiples helpers escriben campos opcionales
 * que pueden ser `undefined`:
 *   - `boEntryResolved` / `boEntryPrevio` (tarea L v1457).
 *   - `origen` / `asigRefs` (v1382/v1466 CPST).
 *   - `importedFromOrder` (v1284/v1382 unificación).
 *   - `enricher` (v1461) que setea undefined en vez de omitir.
 *
 * REGLA: ningún payload que llega a Firestore puede tener claves con valor
 * `undefined`. Si el campo no aplica a la línea, se OMITE (no se escribe).
 *
 * Este helper es la única fuente de verdad para limpiar undefined antes de
 * cualquier `batch.update/set` o `ref.update/set` sobre colecciones
 * sensibles (`revision_waitlist`, `pedidos`). Aplicado via monkey-patch en
 * index.html al inicializar fbDb.
 */

/**
 * Chequea si un valor es "especial" de Firestore que NO debe inspeccionarse
 * recursivamente. FieldValue sentinel, Timestamp, DocumentReference, GeoPoint,
 * Blob — todos tienen protos propios y romper su shape los invalida.
 *
 * @param {any} v
 * @returns {boolean}
 */
function _isFirestoreSpecial(v) {
  if (!v || typeof v !== 'object') return false;
  if (v instanceof Date) return true;
  // FieldValue sentinel (serverTimestamp, arrayUnion, etc.): tiene _methodName
  // interno o es instancia de una clase FieldValue. En compat SDK web expone
  // el constructor name.
  const ctor = v.constructor && v.constructor.name;
  if (ctor) {
    if (ctor === 'FieldValue' || ctor === 'FieldValueImpl') return true;
    if (ctor === 'Timestamp') return true;
    if (ctor === 'DocumentReference' || ctor === 'DocumentReferenceImpl') return true;
    if (ctor === 'GeoPoint') return true;
    if (ctor === 'Blob' || ctor === 'Bytes') return true;
  }
  if (typeof v._methodName === 'string') return true; // FieldValue sentinel
  return false;
}

/**
 * Elimina recursivamente las claves con valor `undefined` de `data`.
 *
 * - Objetos planos: se recorren y se omiten las claves undefined. Los valores
 *   restantes se procesan recursivamente.
 * - Arrays: se procesan recursivamente item por item. Items `undefined` se
 *   excluyen del array (Firestore tampoco los acepta en arrays).
 * - Primitivos: se retornan tal cual.
 * - Firestore specials (FieldValue, Timestamp, DocumentReference, etc.): se
 *   retornan sin tocar.
 * - `null` se preserva (es valor válido en Firestore).
 * - `NaN` queda tal cual (Firestore lo convierte a número NaN; no es undefined).
 *
 * @template T
 * @param {T} data
 * @returns {T}
 */
export function stripUndefined(data) {
  if (data === undefined) return /** @type {any} */ (undefined);
  if (data === null) return /** @type {any} */ (null);
  if (typeof data !== 'object') return data;
  if (_isFirestoreSpecial(data)) return data;
  if (Array.isArray(data)) {
    /** @type {any[]} */
    const out = [];
    for (const item of data) {
      if (item === undefined) continue;
      out.push(stripUndefined(item));
    }
    return /** @type {any} */ (out);
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of Object.keys(data)) {
    const v = /** @type {any} */ (data)[k];
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return /** @type {any} */ (out);
}

/**
 * Chequea si un path de documento Firestore corresponde a una colección
 * "sensible" que requiere sanitización automática. Las colecciones son las
 * que escriben los paths críticos del dominio comercial:
 *   - `revision_waitlist/*` — lista de espera (bug Federico 2026-10-26).
 *   - `pedidos/*` — pedidos confirmados.
 *
 * El monkey-patch del cliente usa este helper para decidir cuándo aplicar
 * `stripUndefined` automáticamente. Call-sites de otras colecciones NO se
 * tocan — mejor opt-in explícito.
 *
 * @param {string} path Document path tipo "revision_waitlist/XYZ" o
 *   "pedidos/ABC".
 * @returns {boolean}
 */
export function isSanitizedPath(path) {
  if (!path || typeof path !== 'string') return false;
  return path.startsWith('revision_waitlist/') || path.startsWith('pedidos/');
}
