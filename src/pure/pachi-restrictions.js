// @ts-check
/**
 * Perfil operativo PACHI — restricciones por UID (2026-10-26, v1463).
 *
 * Mariano pidió "la excepción se centraliza en UN SOLO lugar" — en v1460 era
 * una constante `PACHI_UID` (string). En v1463 pasa a `PACHI_UIDS` (lista)
 * para permitir que el user de prueba `pruebas.pachi@shimano.com.ar`
 * (UID tUJHiLDyLHWvbkpWgCQXWJcucfV2) herede las mismas restricciones sin
 * tocar la cuenta real de PACHI (UID LaBFi1xkSLObzLEdRoP8fonZ06r2).
 *
 * El set sigue siendo UNA sola fuente de verdad; cualquier consumidor
 * invoca `isPachiRestricted(uid)` que devuelve true si el UID está en la lista.
 *
 * Para los demás usuarios NO cambia nada.
 */

/**
 * Lista de UIDs sujetos a las restricciones PACHI.
 * - LaBFi1xkSLObzLEdRoP8fonZ06r2: PACHI real (pachinaba@gmail.com).
 * - tUJHiLDyLHWvbkpWgCQXWJcucfV2: user de prueba Playwright E2E
 *   (pruebas.pachi@shimano.com.ar). Mismo rol/vendor que PACHI real.
 *   Permite correr tests sin tocar su cuenta.
 */
export const PACHI_UIDS = Object.freeze([
  'LaBFi1xkSLObzLEdRoP8fonZ06r2',
  'tUJHiLDyLHWvbkpWgCQXWJcucfV2',
]);

// Compat retrocompatible: PACHI_UID (el real) se preserva para quien lo
// importe aislado. Nuevos consumidores deben usar PACHI_UIDS o isPachiRestricted.
export const PACHI_UID = PACHI_UIDS[0];
export const PACHI_EMAIL = 'pachinaba@gmail.com';
export const PACHI_VENDOR_KEY = 'PACHI';

/**
 * Returns true if the given uid is subject to PACHI restrictions.
 * @param {string | null | undefined} uid
 * @returns {boolean}
 */
export function isPachiRestricted(uid) {
  return !!uid && PACHI_UIDS.includes(uid);
}

/**
 * Returns true if PACHI restrictions apply to the current user (window context).
 * Centraliza el check al body class `is-pachi-restricted` que seteamos en el
 * frontend tras login + resolución de UID.
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function isPachiBodyFlagActive(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.body) return false;
  return d.body.classList.contains('is-pachi-restricted');
}

/**
 * Guard genérico para open*Modal / setTab / handlers que PACHI no puede
 * ejecutar. Devuelve `true` si debe abortarse (= PACHI está loggeado).
 * Si aborta, muestra un alert simple en castellano (opcional vía `opts.silent`).
 * @param {string | null | undefined} uid
 * @param {{silent?: boolean, feature?: string}} [opts]
 */
export function pachiGuard(uid, opts) {
  if (!isPachiRestricted(uid)) return false;
  const feature = (opts && opts.feature) || 'esta función';
  if (!opts || !opts.silent) {
    try {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`${feature} no está disponible para tu usuario.`);
      }
    } catch (_e) {
      /* ignore */
    }
  }
  return true;
}
