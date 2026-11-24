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

/**
 * Mensaje cuando no se pudo leer el rol (falla transitoria). Sigue siendo un
 * rechazo (falla cerrada), pero reintentar alcanza: no hay que pedir un rol.
 */
export const ROLE_CHECK_UNAVAILABLE_MESSAGE =
  'No pudimos verificar tu permiso en este momento. Volvé a intentar en un minuto; si sigue, avisale a Mariano.';

/** Mensaje para usuario deshabilitado. */
export const USER_DISABLED_MESSAGE =
  'Tu usuario está deshabilitado. Si creés que es un error, avisale a Mariano.';

/**
 * Normaliza un rol crudo (trim + minúsculas). Solo acepta string: cualquier
 * otro tipo (array, objeto, número, booleano) devuelve '' y nunca coincide
 * con un rol aprobado. Evita que `['admin']` pase por `String(['admin'])`.
 * @param {unknown} role
 * @returns {string}
 */
export function normalizeRole(role) {
  if (typeof role !== 'string') return '';
  return role.trim().toLowerCase();
}

/**
 * Deduplicación del registro de rechazos en `operations_log`.
 *
 * Como máximo 1 escritura por (uid, via) cada ventana, por instancia de la
 * función. Se eligió un Map en memoria y no un doc de control con
 * transacción porque el doc de control cuesta 1 lectura (y una transacción)
 * por cada rechazo: no baja el costo del ataque en loop, solo cambia qué se
 * escribe. En memoria el rechazo repetido no toca Firestore. Límite: con N
 * instancias activas puede haber hasta N registros por ventana para el mismo
 * (uid, via); está acotado por `maxInstances` de cada función y alcanza para
 * auditar. El rechazo al cliente ocurre siempre, se loguee o no.
 */
export const ROLE_REJECTION_LOG_WINDOW_MS = 10 * 60 * 1000;
/** Tope de claves en memoria (cuentas distintas); al llegar se podan vencidas o las más viejas. */
export const ROLE_REJECTION_LOG_MAX_KEYS = 5000;

/** @type {Map<string, {lastLoggedAt: number, suppressed: number}>} */
const _rejectionLogState = new Map();

/** Solo tests: vacía el estado de deduplicación. */
export function _resetRoleRejectionLogDedupe() {
  _rejectionLogState.clear();
}

/**
 * Poda el Map para que no crezca sin límite (muchas cuentas distintas).
 * @param {number} now
 */
function _pruneRejectionLogState(now) {
  if (_rejectionLogState.size < ROLE_REJECTION_LOG_MAX_KEYS) return;
  for (const [k, v] of _rejectionLogState) {
    if (now - v.lastLoggedAt >= ROLE_REJECTION_LOG_WINDOW_MS) _rejectionLogState.delete(k);
  }
  // Si siguen todas vigentes, saca las más viejas (orden de inserción).
  while (_rejectionLogState.size >= ROLE_REJECTION_LOG_MAX_KEYS) {
    const first = _rejectionLogState.keys().next().value;
    if (first === undefined) break;
    _rejectionLogState.delete(first);
  }
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
 *             'rol_no_aprobado' | 'rol_tipo_invalido' | 'usuario_deshabilitado'.
 *   `disabled` / `active` se comparan estricto: solo `disabled === true` o
 *   `active === false` deshabilitan ('true', 0, etc. no).
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
  const rawRole = doc ? doc.role : undefined;
  const roleTypeInvalid = rawRole !== undefined && rawRole !== null && typeof rawRole !== 'string';
  const role = normalizeRole(rawRole);

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
    reason: !doc ? 'sin_doc_rol' : roleTypeInvalid ? 'rol_tipo_invalido' : 'rol_no_aprobado',
  };
}

/**
 * Lee `roles/{uid}` con Admin SDK, evalúa y, si rechaza, deja registro en
 * `operations_log` (await; el fallo del log no tapa el rechazo). El registro
 * se deduplica: como máximo 1 por (uid, via) cada
 * `ROLE_REJECTION_LOG_WINDOW_MS` por instancia; el siguiente registro lleva
 * `suppressedSinceLast` con los rechazos no registrados en el medio.
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
 *   now?: number,
 * }} params
 * Si la lectura falla, el rechazo sale con `code: 'unavailable'` y
 * `errorCode: 'ROLE_CHECK_UNAVAILABLE'` (reintentable); el resto de los
 * rechazos usa `errorCode: 'ROLE_REQUIRED'`.
 *
 * @returns {Promise<{ok: boolean, code: string, message: string, role: string, reason: string, errorCode?: string}>}
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

  /** @type {{ok: boolean, code: string, message: string, role: string, reason: string, errorCode?: string}} */
  let result;
  if (roleReadError !== null) {
    result = {
      ok: false,
      code: 'unavailable',
      message: ROLE_CHECK_UNAVAILABLE_MESSAGE,
      role: '',
      reason: 'error_lectura_rol',
      errorCode: 'ROLE_CHECK_UNAVAILABLE',
    };
  } else {
    result = evaluateCallerRole(roleDoc, uid, { extraAllowedUids });
  }
  if (result.ok || result.code === 'unauthenticated') return result;
  if (!result.errorCode) result = Object.assign({}, result, { errorCode: 'ROLE_REQUIRED' });

  const now = typeof params.now === 'number' ? params.now : Date.now();
  const dedupeKey = `${via}|${uid}`;
  const prev = _rejectionLogState.get(dedupeKey);
  if (prev && now - prev.lastLoggedAt < ROLE_REJECTION_LOG_WINDOW_MS) {
    prev.suppressed++;
    return result;
  }
  const suppressedSinceLast = prev ? prev.suppressed : 0;
  // Se marca antes del await para que llamadas concurrentes no dupliquen;
  // si la escritura falla se restaura el estado previo para reintentar.
  _pruneRejectionLogState(now);
  _rejectionLogState.delete(dedupeKey);
  _rejectionLogState.set(dedupeKey, { lastLoggedAt: now, suppressed: 0 });

  try {
    await fbDb.collection('operations_log').add({
      type: `${via}_rejected`,
      errorCode: result.errorCode,
      reason: result.reason,
      userId: uid,
      userEmail: email || null,
      callerRole: result.role || '(vacío)',
      roleReadError,
      via,
      suppressedSinceLast,
      timestamp: new Date(now),
    });
  } catch (logErr) {
    if (prev) _rejectionLogState.set(dedupeKey, prev);
    else _rejectionLogState.delete(dedupeKey);
    log(`${via} operations_log write failed on ${result.errorCode}`, {
      uid,
      err: String((logErr && /** @type {any} */ (logErr).message) || logErr),
    });
  }
  return result;
}
