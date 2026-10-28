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
 * IDs de botones del HEADER-TOP (barra superior del mapa) que PACHI no debe
 * ver. Fuente única paralela a `PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS`.
 *
 * v1507 iter 8 (2026-10-28): PACHI tiene su propia "Pedidos en espera" en
 * el panel izquierdo (sidebar-left-waitlist, filtrada por su UID). El botón
 * global "PEDIDOS EN ESPERA" del header-top muestra un contador CROSS-VENDOR
 * (todas las ordenes abiertas), lo que no corresponde al scope de PACHI.
 *
 * El inline del index.html agrega la clase `body.is-pachi-restricted` y los
 * gates CSS matchean estos IDs con `display:none !important`.
 */
export const PACHI_HIDDEN_HEADER_BTN_IDS = Object.freeze(['waitlist-btn']);

/**
 * @param {string} btnId
 * @returns {boolean} true si el botón del header-top debe ocultarse para PACHI.
 */
export function isHeaderBtnHiddenForPachi(btnId) {
  if (!btnId) return false;
  return PACHI_HIDDEN_HEADER_BTN_IDS.includes(String(btnId).trim());
}

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
 * v1493 §92 (2026-10-27) — iter 4: PACHI puede cargar pedidos y enviarlos
 * a lista de espera igual que cualquier VDE. Las restricciones vigentes son
 * las documentadas (no asignar stock, no confirmar directo a SAP, no ver
 * Backorder editable). La botonera del modal de carga de pedido NO está en
 * el set restringido.
 *
 * Esta fn centraliza la decisión "¿el user puede usar `revision_waitlist`
 * (botón `Enviar a lista de espera` del modal + Revision Excel + sidebar
 * waitlist)?". Antes v1493 el gate era SOLO email @shimano.*. Resultado:
 *
 *  - PACHI real `pachinaba@gmail.com` NO cumplía → botón "Enviar a lista
 *    de espera" oculto para él aunque la regla de negocio dice que PACHI
 *    SÍ carga pedidos y los manda a espera.
 *  - Test user `pruebas.pachi@shimano.com.ar` sí cumplía por email, pero
 *    si el auth refresh retrasaba `currentUser.email` cuando corría
 *    `applyRolePermissions`, el toggle quedaba off durante esa sesión.
 *
 * Nueva lógica (fuente única):
 *   `canRevisionEmailOrUid(email, uid)` → true si:
 *     - email termina en algún sufijo whitelist (@shimano.com.ar | @shimano.uy), O
 *     - uid está en PACHI_UIDS (cubre ambas cuentas sin tocar email).
 *
 * El cliente consume ESTA fn en `applyRolePermissions` + donde haga falta.
 * Las restricciones negativas (no Backorder editable, no asignar stock) siguen
 * en `isPachiRestricted` + CSS `is-pachi-restricted`. Son ortogonales.
 *
 * @param {string | null | undefined} email
 * @param {string | null | undefined} uid
 * @param {{ emailSuffixes?: string[] }} [opts]
 * @returns {boolean}
 */
export function canRevisionEmailOrUid(email, uid, opts) {
  const em = String(email || '')
    .trim()
    .toLowerCase();
  const suffixes =
    opts && Array.isArray(opts.emailSuffixes)
      ? opts.emailSuffixes
      : ['@shimano.com.ar', '@shimano.uy'];
  if (em && suffixes.some((s) => em.endsWith(s))) return true;
  if (uid && PACHI_UIDS.includes(uid)) return true;
  return false;
}

/**
 * v1496 §95 (2026-10-27) iter 6: ¿puede este user borrar la waitlist card
 * del modal "Pedido en espera"?
 *
 * Regla:
 *   - User con `canRevisionEmailOrUid` falso → NO (otra razón; sin permisos).
 *   - User PACHI (uid en PACHI_UIDS) → SÍ, pero SOLO si `w.ownerUid === uid`
 *     (puede borrar los pedidos cargados por él mismo, no los de otros VDE).
 *   - User VDE regular (shimano domain, no PACHI) → SÍ para cualquier
 *     pedido (preserva comportamiento v540 2026-08-18).
 *
 * Reportado iter 6 Mariano: PACHI no veía el botón "Eliminar" porque el
 * gate del front chequeaba sólo `email.endsWith('@shimano.*')`. Fix fuente
 * única acá; call-site index.html delega + fallback inline SW stale.
 *
 * @param {{ ownerUid?: string | null } | null | undefined} waitlist
 * @param {string | null | undefined} uid - UID del user activo.
 * @param {string | null | undefined} email - email del user activo.
 * @returns {boolean}
 */
export function canDeleteOwnWaitlist(waitlist, uid, email) {
  if (!canRevisionEmailOrUid(email, uid)) return false;
  if (uid && PACHI_UIDS.includes(uid)) {
    // PACHI: solo propios.
    if (!waitlist || typeof waitlist !== 'object') return false;
    const ownerUid = waitlist.ownerUid != null ? String(waitlist.ownerUid) : '';
    return !!ownerUid && ownerUid === String(uid);
  }
  // VDE regular (shimano domain) o admin: puede borrar cualquiera.
  return true;
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
