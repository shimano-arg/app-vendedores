// @ts-check
/**
 * Stack S-7 P1-C (v1588 2026-11-25) — Enforcement pre-confirm de versión mínima.
 *
 * Fuente única de verdad para la comparación de versiones de la app. El modal
 * bloqueante post-login (E10 Fase 1+3 v1434) usa `_parseVersion`/`_isVersionLessThan`
 * inline en `index.html`; este módulo expone el equivalente puro + testeable
 * para el nuevo hook pre-confirm (chequeo antes de que `commitPedidoCF` salga
 * del navegador). El hook fuerza un `location.reload()` previo a la llamada
 * si `APP_VERSION < app_config/version_minima.minVersion`, preservando el
 * borrador en `localStorage.shimano_zonas_pending_v1` (CLAUDE.md §101).
 *
 * Diseño fail-open §77:
 * - `minVersion` null/undefined/empty → no bloquear (gate no configurado).
 * - `appVersion` null/undefined/empty → no bloquear (unknown local).
 * - Si ambos parseables: comparar; si `local < min` → force reload.
 *
 * Shape compatible con `_parseVersion` inline (strip de prefijo 'v', NaN → 0).
 */

/**
 * Parsea una string de versión del formato "v1234" o "1234" al número 1234.
 * Devuelve null si la entrada no es parseable (en vez de 0, para distinguir
 * "sin versión" de "versión 0").
 *
 * @param {unknown} v
 * @returns {number|null}
 */
export function parseAppVersion(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const stripped = s.replace(/^v/i, '');
  if (!stripped) return null;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Decisión pura: ¿hay que forzar reload pre-confirm?
 *
 * Fail-open §77: si no podemos resolver min o local, NO bloqueamos. El
 * servidor sigue teniendo la última palabra via `commitPedidoCore` que
 * también chequea `app_config/version_minima` (regla existente desde v1434).
 *
 * @param {unknown} appVersion  APP_VERSION del cliente local (ej. 'v1588').
 * @param {unknown} minVersion  minVersion del doc app_config/version_minima.
 * @returns {boolean}  true = frenar antes de commit y recargar.
 */
export function shouldForceReload(appVersion, minVersion) {
  const min = parseAppVersion(minVersion);
  if (min === null) return false; // gate no configurado → fail-open.
  const local = parseAppVersion(appVersion);
  if (local === null) return false; // local unknown → fail-open (el server rechazará si corresponde).
  return local < min;
}

/**
 * Comparador explícito 3-way. Útil para tests y futuros flows que necesiten
 * conocer la relación exacta (ej. UI que muestre "estás 3 versiones atrás").
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1|0|1|null}  null si cualquiera no es parseable.
 */
export function compareAppVersion(a, b) {
  const na = parseAppVersion(a);
  const nb = parseAppVersion(b);
  if (na === null || nb === null) return null;
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}
