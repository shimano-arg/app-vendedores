// @ts-check
/**
 * SEC F1A (2026-11-24) — gate por rol aprobado para callables.
 *
 * Contexto: `commitPedidoCF`, `updatePedidoLinesCF`, `fetchStockLiveCF` y
 * `geminiOcrProxy` autorizaban por dominio del email (y `commitPedidoCF` /
 * `updatePedidoLinesCF` aceptaban cualquier `@gmail.com`). Cualquier cuenta
 * Google podía crear pedidos confirmados que reservan stock y salen a SAP
 * (informe F1A_PERMISOS H1, H7, H9, H12).
 *
 * Ahora el criterio es el rol leído en el servidor de `roles/{auth.uid}`
 * (Admin SDK, el cliente no lo puede inyectar). Falla cerrada: sin doc,
 * rol no aprobado, usuario deshabilitado o lectura fallida → rechazo.
 *
 * Core puro (CLAUDE.md §7): `evaluateCallerRole` no toca Firestore.
 * `authorizeCaller` hace la lectura + el registro del rechazo en
 * `operations_log` (AWAIT, CLAUDE.md §64.2). El wrapper de cada callable solo
 * traduce el resultado a `HttpsError`.
 */

/** Roles que pueden operar pedidos, stock en vivo y OCR. */
export const APPROVED_ROLES = Object.freeze(new Set(['vendedor', 'interno', 'gerente', 'admin']));

/**
 * UIDs de PACHI. Espejo de `isPachiUid()` en firestore.rules y de
 * `src/pure/pachi-restrictions.js`. Se usa SOLO en `fetchStockLiveCF`, que
 * ya tenía esta excepción (v1496 §95) antes del gate por rol.
 */
export const PACHI_UIDS = Object.freeze([
  'LaBFi1xkSLObzLEdRoP8fonZ06r2', // pachinaba@gmail.com
  'tUJHiLDyLHWvbkpWgCQXWJcucfV2', // pruebas.pachi@shimano.com.ar (E2E)
]);

/** Mensaje al usuario (CLAUDE.md §68: qué pasó + qué hacer, sin jerga). */
export const ROLE_REQUIRED_MESSAGE =
  'Tu usuario no tiene permiso para esta acción. Pedile a Mariano que te asigne un rol.';

/** Mensaje para usuario deshabilitado. */
export const USER_DISABLED_MESSAGE =
  'Tu usuario está deshabilitado. Si creés que es un error, avisale a Mariano.';

/**
 * Normaliza un rol crudo (trim + minúsculas).
 * @param {unknown} role
 * @returns {string}
 */
export function normalizeRole(role) {
  return String(role ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Decide si el caller está autorizado según su doc de rol.
 *
 * @param {any} roleDoc Datos de `roles/{uid}`; `null`/`undefined` = el doc no existe.
 * @param {string} uid `auth.uid` del caller.
 * @param {{extraAllowedUids?: ReadonlyArray<string>}} [opts]
 *   `extraAllowedUids`: UIDs que pasan aunque el rol no sea aprobado
 *   (excepción histórica PACHI en fetchStockLiveCF). No pasan si están
 *   deshabilitados.
 * @returns {{ok: boolean, code: string, message: string, role: string, reason: string}}
 *   `code`: 'ok' | 'unauthenticated' | 'permission-denied'.
 *   `reason`: 'ok' | 'uid_permitido' | 'sin_uid' | 'sin_doc_rol' |
 *             'rol_no_aprobado' | 'usuario_deshabilitado'.
 */
export function evaluateCallerRole(roleDoc, uid, opts = {}) {
  if (!uid || typeof uid !== 'string') {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'login requerido',
      role: '',
      reason: 'sin_uid',
    };
  }
  const extra = Array.isArray(opts.extraAllowedUids) ? opts.extraAllowedUids : [];
  const doc = roleDoc && typeof roleDoc === 'object' ? roleDoc : null;
  const role = normalizeRole(doc ? doc.role : '');

  // El modelo actual de `roles` no tiene campo de baja; si en el futuro se
  // agrega `disabled: true` o `active: false`, el gate ya lo respeta.
  if (doc && (doc.disabled === true || doc.active === false)) {
    return {
      ok: false,
      code: 'permission-denied',
      message: USER_DISABLED_MESSAGE,
      role,
      reason: 'usuario_deshabilitado',
    };
  }
  if (APPROVED_ROLES.has(role)) {
    return { ok: true, code: 'ok', message: '', role, reason: 'ok' };
  }
  if (extra.includes(uid)) {
    return { ok: true, code: 'ok', message: '', role, reason: 'uid_permitido' };
  }
  return {
    ok: false,
    code: 'permission-denied',
    message: ROLE_REQUIRED_MESSAGE,
    role,
    reason: doc ? 'rol_no_aprobado' : 'sin_doc_rol',
  };
}

/**
 * Lee `roles/{uid}` con Admin SDK, evalúa y, si rechaza, deja registro en
 * `operations_log` (await; el fallo del log no tapa el rechazo).
 * Si la lectura de `roles` falla, rechaza (falla cerrada), incluso para
 * `extraAllowedUids`.
 *
 * @param {{
 *   fbDb: any,
 *   uid: string,
 *   email?: string,
 *   via: string,
 *   extraAllowedUids?: ReadonlyArray<string>,
 *   log?: (msg: string, extra?: any) => void,
 * }} params
 * @returns {Promise<{ok: boolean, code: string, message: string, role: string, reason: string}>}
 */
export async function authorizeCaller(params) {
  const { fbDb, uid, email = '', via, extraAllowedUids } = params;
  const log = params.log || (() => {});
  /** @type {any} */
  let roleDoc = null;
  /** @type {string|null} */
  let roleReadError = null;
  if (uid) {
    try {
      const snap = await fbDb.collection('roles').doc(uid).get();
      roleDoc = snap && snap.exists ? snap.data() || {} : null;
    } catch (e) {
      roleReadError = String((e && /** @type {any} */ (e).message) || e);
      log(`${via} roles/{uid} read failed`, { uid, err: roleReadError });
    }
  }

  /** @type {{ok: boolean, code: string, message: string, role: string, reason: string}} */
  let result;
  if (roleReadError !== null) {
    result = {
      ok: false,
      code: 'permission-denied',
      message: ROLE_REQUIRED_MESSAGE,
      role: '',
      reason: 'error_lectura_rol',
    };
  } else {
    result = evaluateCallerRole(roleDoc, uid, { extraAllowedUids });
  }
  if (result.ok || result.code === 'unauthenticated') return result;

  try {
    await fbDb.collection('operations_log').add({
      type: `${via}_rejected`,
      errorCode: 'ROLE_REQUIRED',
      reason: result.reason,
      userId: uid,
      userEmail: email || null,
      callerRole: result.role || '(vacío)',
      roleReadError,
      via,
      timestamp: new Date(),
    });
  } catch (logErr) {
    log(`${via} operations_log write failed on ROLE_REQUIRED`, {
      uid,
      err: String((logErr && /** @type {any} */ (logErr).message) || logErr),
    });
  }
  return result;
}
