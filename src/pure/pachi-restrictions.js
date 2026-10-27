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
 * IDs de los botones ORIGINALES del header que al moverse al panel izquierdo
 * del mapa (`#sidebar-left-buttons`) crean proxies que PACHI no debe ver.
 *
 * Fuente única (v1481 §81, 2026-10-27): el renderer `_moveButtonsToSidebarLeft`
 * en `index.html` consulta esta lista. Si el UID actual está en `PACHI_UIDS`
 * y el id está acá, el proxy NO se crea (el original ya está oculto por
 * `moved-to-sidebar-left` CSS en desktop).
 *
 * Reportado prod 2026-10-27 (v1478): aunque v1478 ocultó los originales con
 * CSS gates, los proxies del sidebar-left seguían visibles porque el
 * `syncVisibility` del proxy mira `orig.style.display` (inline) y los gates
 * CSS no setean inline — setean computed style.
 *
 * Los 6 IDs corresponden a los labels que Mariano pidió ocultar:
 *   - seguimiento-btn        → "Seguimiento" (abre modal Cartera via openCarteraModal).
 *   - backorders-btn         → "Backorder" (abre openBackordersModal).
 *   - asignacion-backorder-btn → "Stock Asig." (abre openAsignacionBackorderModal).
 *   - forecast-btn           → "Forecast" (abre openForecastModal).
 *   - revision-btn           → "Reparto" (abre openRepartoModal via overrideClick).
 *   - waitlist-btn           → "Depósito" (abre openDepositoModal via overrideClick).
 *
 * PACHI SÍ ve en ese panel: `mis-camps-btn` (Campañas), `dashboard-btn`
 * (Dashboard), `_exportBtn` (Exportar).
 */
export const PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS = Object.freeze([
  'seguimiento-btn',
  'backorders-btn',
  'asignacion-backorder-btn',
  'forecast-btn',
  'revision-btn',
  'waitlist-btn',
]);

/**
 * Features (globales de `window`) que PACHI NO puede abrir por ningún camino
 * (atajo teclado, URL hash, menú contextual, `window.X()` desde consola).
 * El wrapper correspondiente en `index.html` consulta esta lista + llama a
 * `pachiGuard(uid, {feature})` ANTES de ejecutar la función original.
 *
 * v1481 §81 (2026-10-27): defense in depth. Aunque el botón esté oculto,
 * cualquier otro camino (prompt URL, bookmarklet admin, programa que haga
 * `window.openBackordersModal()`) queda bloqueado para PACHI.
 */
export const PACHI_BLOCKED_OPEN_FNS = Object.freeze([
  'openBackordersModal',
  'openAsignacionBackorderModal',
  'openForecastModal',
  'openRepartoModal',
  'openDepositoModal',
  'openCarteraModal',
  'openSeguimientoModal',
]);

/**
 * Returns true if the given sidebar-left button id should be HIDDEN for PACHI.
 * @param {string} btnId
 * @returns {boolean}
 */
export function isSidebarLeftBtnHiddenForPachi(btnId) {
  return !!btnId && PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS.includes(btnId);
}

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
