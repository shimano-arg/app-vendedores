// @ts-check
/**
 * Perfil operativo de PACHI — restricciones por UID (2026-10-26).
 *
 * PACHI es un VDE proxy (vendorKey PACHI) con uid confirmado en roles.
 * Mariano pidió explícitamente que la excepción se centralice en UN SOLO
 * lugar por UID (no por email, no comparaciones regadas).
 *
 * Esta constante + helpers son la ÚNICA fuente de verdad. Cualquier otro
 * sitio que necesite check de PACHI debe importar `isPachiRestricted(uid)`.
 *
 * Las 8 restricciones (ver INFORME_CAMBIOS_PACHI.md):
 *   A. Backorder solo lectura (no crea/edita/borra; rules Firestore bloquean escritura).
 *   B. Stock asignado sin acceso (sin botón + guard JS en openAsignacionBackorderModal).
 *   C. Visitas solo versión rápida (sin botón "Clásica" + guard en openVisitaModal).
 *   D. Contactos solo versión rápida (sin botón "Clásica" + guard).
 *   E. Rutas fuera menú (sin tab Rutas + guard en setTab('rutas')).
 *   F. SAP fuera menú (sin botón + guard en openSapPanel).
 *   G. Pedidos confirmados SAP fuera menú (cubierto por F — SAP modal oculto).
 *   H. Panel "Alertas y tareas" oculto sin dejar espacio vacío.
 *
 * Para los demás usuarios NO cambia nada.
 */

export const PACHI_UID = 'LaBFi1xkSLObzLEdRoP8fonZ06r2';
export const PACHI_EMAIL = 'pachinaba@gmail.com';
export const PACHI_VENDOR_KEY = 'PACHI';

/**
 * Returns true if the given uid is subject to PACHI restrictions.
 * @param {string | null | undefined} uid
 * @returns {boolean}
 */
export function isPachiRestricted(uid) {
  return !!uid && uid === PACHI_UID;
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
