// @ts-check
/**
 * SEC-02 (P0, 2026-10-29) — autorización por rol en el servidor para
 * `commitPedidoCF` y `updatePedidoLinesCF`.
 *
 * Antes: ambos wrappers solo validaban el dominio del email
 * (`shimano.com.ar`, `shimano.uy`, `gmail.com`). Cualquier cuenta Gmail, o una
 * cuenta email/contraseña con un email inventado sin verificar, podía crear
 * pedidos confirmados (que reservan stock y se envían a SAP como cotización).
 *
 * Ahora: el rol se lee server-side de `roles/{auth.uid}.role` (el cliente no
 * puede inyectarlo) y se rechaza si no está en la lista permitida. El dominio
 * del email deja de ser criterio de autorización.
 *
 * Basado en `functions/core/caller-role.js` del PR #1284 (rama
 * `fix/sec-auth-001-and-pedido-role-gate`), revisado y extendido con
 * `authorizeCallerRole` (lectura + log) para que el wrapper sea mínimo y la
 * lógica se pueda testear sin emulador (CLAUDE.md §7).
 *
 * Falla cerrada: si la lectura de `roles` falla, se rechaza.
 */

/** Roles que pueden confirmar y editar pedidos. */
export const ALLOWED_ROLES = Object.freeze(new Set(['vendedor', 'interno', 'gerente', 'admin']));

/**
 * @param {unknown} role Valor leído de `roles/{auth.uid}.role`.
 * @param {ReadonlySet<string>} [allowed] Roles permitidos (default ALLOWED_ROLES).
 * @returns {{ok: boolean, errorCode?: string, normalized: string}}
 */
export function assertCallerRole(role, allowed = ALLOWED_ROLES) {
  const normalized = String(role ?? '')
    .toLowerCase()
    .trim();
  if (!allowed.has(normalized)) {
    return { ok: false, errorCode: 'ROLE_REQUIRED', normalized };
  }
  return { ok: true, normalized };
}

/** Mensaje al usuario (CLAUDE.md §68: qué pasó + qué hacer). */
export const ROLE_REQUIRED_MESSAGE =
  'Tu usuario no tiene permiso para esta operación. Pedile al administrador que te asigne un rol.';

/**
 * Lee el rol del caller en el servidor y lo valida.
 *
 * @param {{
 *   fbDb: any,
 *   uid: string,
 *   email?: string,
 *   via: string,
 *   allowedRoles?: ReadonlySet<string>,
 *   log?: (msg: string, extra?: any) => void,
 * }} params
 * @returns {Promise<{role: string}>} rol normalizado si está autorizado.
 * @throws {{code: 'permission-denied', message: string, errorCode: 'ROLE_REQUIRED'}}
 */
export async function authorizeCallerRole(params) {
  const { fbDb, uid, email = '', via, allowedRoles = ALLOWED_ROLES } = params;
  const log = params.log || (() => {});
  let rawRole = '';
  /** @type {string | null} */
  let roleReadError = null;
  try {
    const snap = await fbDb.collection('roles').doc(uid).get();
    rawRole = snap && snap.exists ? (snap.data() || {}).role || '' : '';
  } catch (e) {
    roleReadError = (e && /** @type {any} */ (e).message) || String(e);
    log(`${via} roles/{uid} read failed`, { uid, err: roleReadError });
  }
  const check = assertCallerRole(rawRole, allowedRoles);
  if (check.ok) return { role: check.normalized };

  // Registro del rechazo: best-effort, pero el fallo del log no se traga en
  // silencio (queda en Cloud Logging vía log()).
  try {
    await fbDb.collection('operations_log').add({
      type: `${via}_rejected`,
      errorCode: 'ROLE_REQUIRED',
      userId: uid,
      userEmail: email || null,
      callerRole: check.normalized || '(vacío)',
      roleReadError,
      via,
      timestamp: new Date(),
    });
  } catch (logErr) {
    log(`${via} operations_log write failed on ROLE_REQUIRED`, {
      uid,
      err: (logErr && /** @type {any} */ (logErr).message) || String(logErr),
    });
  }
  throw {
    code: 'permission-denied',
    message: ROLE_REQUIRED_MESSAGE,
    errorCode: 'ROLE_REQUIRED',
  };
}

/**
 * D9 (2026-10-29): envuelve el handler de un `onCall` para que la autorización
 * por rol sea ESTRUCTURAL: el handler de negocio solo se ejecuta si el rol pasó.
 * Antes los tests del wrapper eran greps sobre functions/index.js; con esto se
 * testea ejecutando (ver tests/functions/caller-role.test.js, bloque H).
 *
 * @param {{
 *   via: string,
 *   getDb: () => any,
 *   HttpsError: new (code: string, message: string, details?: any) => Error,
 *   allowedRoles?: ReadonlySet<string>,
 *   log?: (msg: string, extra?: any) => void,
 * }} opts
 * @param {(req: any, ctx: {db: any, email: string, role: string}) => Promise<any>} handler
 * @returns {(req: any) => Promise<any>}
 */
export function withCallerRole(opts, handler) {
  const { via, getDb, HttpsError, allowedRoles } = opts;
  const log = opts.log || ((msg, extra) => console.error(msg, extra || {}));
  return async (req) => {
    const auth = req && req.auth;
    if (!auth || !auth.uid) {
      throw new HttpsError('unauthenticated', 'login requerido');
    }
    const email = String(auth.token?.email || '').toLowerCase();
    const db = getDb();
    let role;
    try {
      ({ role } = await authorizeCallerRole({
        fbDb: db,
        uid: auth.uid,
        email,
        via,
        allowedRoles,
        log,
      }));
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err && err.errorCode === 'ROLE_REQUIRED') {
        throw new HttpsError('permission-denied', err.message, { errorCode: 'ROLE_REQUIRED' });
      }
      throw e;
    }
    return handler(req, { db, email, role });
  };
}
