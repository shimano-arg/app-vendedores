// @ts-check
/**
 * Incidente 2026-11-17 02:15 UTC — helper de formato para errores de `fetch`.
 *
 * El 2026-11-17, `syncSapCatalogStockCF` registró 24 corridas consecutivas
 * con `errors: ["fetch failed"]` idéntico. Causa: `undici` (Node 18+/20
 * global fetch) tira `TypeError: fetch failed` cuando falla antes del
 * response (DNS, TCP, TLS, socket). El detalle real del fallo
 * (`ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`, `ENOTFOUND`, etc.) va dentro de
 * `error.cause` con shape:
 *   {
 *     code?: string,    // 'ECONNRESET' | 'UND_ERR_...' | 'ENOTFOUND' | ...
 *     errno?: number,   // -4039, -4077, etc.
 *     syscall?: string, // 'connect' | 'read' | 'getaddrinfo' | ...
 *     hostname?: string,
 *     address?: string,
 *     port?: number,
 *     message?: string,
 *   }
 *
 * El catch del core leía solo `e.message` → el audit log quedaba con el
 * string genérico "fetch failed". Este helper lo enriquece conservando el
 * message original como prefijo, de modo que consumers que buscan ese
 * prefijo con grep siguen funcionando.
 *
 * Diseño:
 *   - Entrada defensiva (null/undefined/cualquier shape).
 *   - Nunca lanza: devuelve siempre un string.
 *   - Mensaje original SIEMPRE aparece primero.
 *   - Detalle de `.cause` entre paréntesis, separado por comas.
 *   - Si no hay `.cause`, devuelve `e.message` sin modificar (compat).
 */

/**
 * Formatea un error de `fetch` conservando `e.message` como prefijo y
 * agregando los campos de `e.cause` cuando existen.
 *
 * @param {unknown} e
 * @returns {string}
 */
export function formatFetchError(e) {
  if (e === null || e === undefined) return 'unknown';
  // Base: e.message si es truthy, sino String(e).
  /** @type {string} */
  let base;
  try {
    const m = /** @type {any} */ (e).message;
    base = typeof m === 'string' && m ? m : String(e);
  } catch (_) {
    try {
      base = String(e);
    } catch (_e2) {
      base = 'unknown';
    }
  }
  if (!base) base = 'unknown';
  /** @type {any} */
  let cause;
  try {
    cause = /** @type {any} */ (e).cause;
  } catch (_) {
    return base;
  }
  if (cause === null || cause === undefined) return base;
  // Shape raro (array, string, primitivo): usar String() y cortar.
  if (typeof cause !== 'object') {
    const asStr = String(cause).slice(0, 200);
    return asStr ? `${base} (${asStr})` : base;
  }
  /** @type {string[]} */
  const parts = [];
  try {
    if (cause.code && typeof cause.code === 'string') parts.push(cause.code);
    if (typeof cause.errno === 'number') parts.push('errno=' + cause.errno);
    if (cause.syscall && typeof cause.syscall === 'string') parts.push('syscall=' + cause.syscall);
    if (cause.hostname && typeof cause.hostname === 'string') parts.push('host=' + cause.hostname);
    // Fallback: solo si no obtuvimos nada estructurado, usar cause.message.
    if (parts.length === 0 && typeof cause.message === 'string' && cause.message) {
      parts.push(cause.message.slice(0, 200));
    }
  } catch (_) {
    // cause con getter que tira → best-effort, devolvemos base.
    return base;
  }
  return parts.length > 0 ? `${base} (${parts.join(', ')})` : base;
}
