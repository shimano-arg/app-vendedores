// @ts-check
/**
 * auth-verify-login-core.js — B2-A (2026-11-26).
 *
 * Logica PURA (deps inyectables) para la verificacion de credenciales durante
 * el login. Resuelve el hallazgo de seguridad S-8 B1: passwordHash, passwordSalt
 * y totpSecret NO deben llegar al browser. Toda verificacion ocurre server-side.
 *
 * Flujo:
 *   1. Resolver UID desde email via getUserByEmail (Admin SDK, bypass rules).
 *   2. Chequear rate-limit por EMAIL HASH (uid desconocido pre-verificacion).
 *   3. verifyPasswordCore(deps, uid, password) -> leer /auth_secrets/{uid}.
 *   4. Si totpEnabled y no viene totpCode -> { ok: false, code: 'requires_totp' }.
 *   5. Si viene totpCode -> verifyTotpCore(deps, uid, totpCode).
 *   6. Leer rol del usuario desde /roles/{uid}.
 *   7. Retornar { ok: true, uid, role } o { ok: false, code, message }.
 *
 * FAIL-CLOSED: ninguna ruta de excepcion devuelve ok:true por fallback silencioso.
 * Excepciones transitorias se propagan (el wrapper las mapea a HttpsError).
 *
 * Rate-limit: 5 intentos / email_hash / 10 min usando auth_rate_limits/{emailHash}.
 * Cada rechazo se loguea en operations_log con type='login_failed'.
 *
 * @typedef {Object} AuthVerifyLoginDeps
 * @property {any} fbDb                                        Firestore Admin
 * @property {(email: string) => Promise<{uid: string}>} getUserByEmail  Admin Auth
 * @property {() => Date} [now]
 * @property {(msg: string, extra?: Record<string,unknown>) => void} [log]
 * @property {(password: string, salt: Buffer|string, keylen: number, opts: object) => Promise<Buffer>} [scryptAsync]
 * @property {(str: string) => Promise<string>} [sha256Hex]
 * @property {(nBytes: number) => string} [randomBytesHex]
 * @property {(aHex: string, bHex: string) => boolean} [timingSafeEqualHex]
 * @property {(secretBase32: string, step: number) => string} [totpCodeAt]
 */

import { TransientAuthError, verifyPasswordCore, verifyTotpCore } from './auth-secrets-core.js';
import {
  checkAuthGateRateLimit,
  recordAuthGateResult,
  refundAuthGateSlot,
} from './rate-limit-core.js';

/** Intentos maximos de login por email por ventana. */
export const LOGIN_RATE_LIMIT_THRESHOLD = 5;
/** Ventana de rate-limit en ms (10 minutos). */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * @param {AuthVerifyLoginDeps} deps
 * @returns {Date}
 */
function _now(deps) {
  return deps.now ? deps.now() : new Date();
}

/**
 * Loguea un rechazo de login en operations_log. Best-effort (nunca bloquea).
 * NUNCA loguea la password, el hash ni ningun secreto.
 * @param {any} fbDb
 * @param {{
 *   userUid?: string | null;
 *   email_hash: string;
 *   reason: string;
 *   code: string;
 *   atIso: string;
 * }} entry
 */
async function _logLoginFailed(fbDb, entry) {
  try {
    await fbDb.collection('operations_log').add(Object.assign({ type: 'login_failed' }, entry));
  } catch (_e) {
    /* no-op — log fallo no debe romper el flujo */
  }
}

/**
 * Verifica las credenciales de login server-side.
 *
 * @param {AuthVerifyLoginDeps} deps
 * @param {{
 *   email: string;
 *   password: string;
 *   totpCode?: string | null;
 *   sha256EmailHash: (email: string) => Promise<string>;
 * }} input
 * @returns {Promise<
 *   | { ok: true; uid: string; role: string }
 *   | { ok: false; code: string; message: string; requiresTotp?: true }
 * >}
 */
export async function verifyLoginCore(deps, input) {
  const { email, password, totpCode, sha256EmailHash } = input;
  const atIso = _now(deps).toISOString();

  // 1. Sanitize email.
  const emailClean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!emailClean) {
    return { ok: false, code: 'no_credentials', message: 'Email y contraseña requeridos.' };
  }
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, code: 'no_credentials', message: 'Email y contraseña requeridos.' };
  }

  // 2. Email hash para rate-limit (nunca el email en claro como doc id).
  const emailHash = await sha256EmailHash(emailClean);

  // 3. Rate-limit por email_hash ANTES de cualquier lookup.
  const rlDeps = { fbDb: deps.fbDb, now: deps.now, log: deps.log };
  const rl = await checkAuthGateRateLimit(
    rlDeps,
    emailHash,
    'authVerifyLogin',
    LOGIN_RATE_LIMIT_THRESHOLD,
    LOGIN_RATE_LIMIT_WINDOW_MS
  );
  if (!rl.allowed) {
    const code = rl.locked ? 'rate_limit_locked' : 'rate_limit';
    await _logLoginFailed(deps.fbDb, {
      userUid: null,
      email_hash: emailHash,
      reason: rl.locked ? 'locked' : 'rate_limited',
      code,
      atIso,
    });
    return {
      ok: false,
      code,
      message: 'Error del sistema, reintentá en 1 minuto.',
    };
  }

  // 4. Resolver UID desde email (Admin SDK — bypasa Firestore Rules).
  let uid;
  try {
    const userRecord = await deps.getUserByEmail(emailClean);
    uid = userRecord.uid;
  } catch (_e) {
    // user-not-found o error de red. No distinguir para evitar user enumeration.
    const code = 'invalid_credentials';
    await _logLoginFailed(deps.fbDb, {
      userUid: null,
      email_hash: emailHash,
      reason: 'user_not_found_or_lookup_failed',
      code,
      atIso,
    });
    // Registrar failure en el rate-limit counter.
    try {
      await recordAuthGateResult(rlDeps, emailHash, 'authVerifyLogin', {
        ok: false,
        reason: 'invalid',
      });
    } catch (_e2) {
      /* no-op */
    }
    return { ok: false, code, message: 'Error del sistema, reintentá en 1 minuto.' };
  }

  // 5. Verificar password server-side. Lee /auth_secrets/{uid} (cerrada al cliente).
  const authDeps = Object.assign({}, deps, { fbDb: deps.fbDb });
  let pwResult;
  try {
    pwResult = await verifyPasswordCore(authDeps, uid, password);
  } catch (e) {
    // TransientAuthError u otro: propagar para que el wrapper lo mapee a 'unavailable'.
    if (e instanceof TransientAuthError) throw e;
    // Error inesperado -> forzar TransientAuthError para que el wrapper reintente.
    throw new TransientAuthError(
      'verifyLoginCore verifyPassword fallo: ' + String((e && e.message) || e)
    );
  }

  if (!pwResult.ok) {
    const code = 'invalid_credentials';
    await _logLoginFailed(deps.fbDb, {
      userUid: uid,
      email_hash: emailHash,
      reason: 'bad_password',
      code,
      atIso,
    });
    // Contabilizar en rate-limit para lockout progresivo.
    try {
      await recordAuthGateResult(rlDeps, emailHash, 'authVerifyLogin', {
        ok: false,
        reason: 'invalid',
      });
    } catch (_e) {
      /* no-op */
    }
    return { ok: false, code, message: 'Error del sistema, reintentá en 1 minuto.' };
  }

  // 6. Leer /auth_secrets/{uid} para saber si TOTP esta habilitado.
  let totpEnabled = false;
  try {
    const secretSnap = await deps.fbDb.collection('auth_secrets').doc(uid).get();
    if (secretSnap && secretSnap.exists) {
      const d = secretSnap.data() || {};
      totpEnabled = !!d.totpSecret;
    }
  } catch (e) {
    throw new TransientAuthError(
      'verifyLoginCore totpEnabled read fallo: ' + String((e && e.message) || e)
    );
  }

  // 7. Si TOTP requerido y no viene el codigo -> pedir el codigo.
  if (totpEnabled && !totpCode) {
    // No contar esto como fallo de rate-limit (el flujo es normal 2-step).
    // Devolver el slot consumido por checkAuthGateRateLimit en el paso 3
    // para que el cliente pueda re-intentar N veces el flujo de 2 pasos
    // sin ser bloqueado por la ventana de rate-limit.
    try {
      await refundAuthGateSlot(rlDeps, emailHash, 'authVerifyLogin');
    } catch (_e) {
      /* best-effort — no bloquear el flujo */
    }
    return {
      ok: false,
      code: 'requires_totp',
      message: 'Se requiere el codigo de verificacion.',
      requiresTotp: true,
    };
  }

  // 8. Si TOTP requerido y viene el codigo -> verificar.
  if (totpEnabled && totpCode) {
    let totpResult;
    try {
      totpResult = await verifyTotpCore(authDeps, uid, String(totpCode));
    } catch (e) {
      if (e instanceof TransientAuthError) throw e;
      throw new TransientAuthError(
        'verifyLoginCore verifyTotp fallo: ' + String((e && e.message) || e)
      );
    }

    if (!totpResult.ok) {
      const code = 'invalid_totp';
      await _logLoginFailed(deps.fbDb, {
        userUid: uid,
        email_hash: emailHash,
        reason: 'bad_totp',
        code,
        atIso,
      });
      try {
        await recordAuthGateResult(rlDeps, emailHash, 'authVerifyLogin', {
          ok: false,
          reason: 'invalid',
        });
      } catch (_e) {
        /* no-op */
      }
      return { ok: false, code, message: 'Error del sistema, reintentá en 1 minuto.' };
    }
  }

  // 9. Login OK — leer rol desde /roles/{uid}.
  let role = '';
  try {
    const roleSnap = await deps.fbDb.collection('roles').doc(uid).get();
    if (roleSnap && roleSnap.exists) {
      role = String((roleSnap.data() || {}).role || '').toLowerCase();
    }
  } catch (e) {
    throw new TransientAuthError(
      'verifyLoginCore roles read fallo: ' + String((e && e.message) || e)
    );
  }

  if (!role) {
    // Usuario sin rol asignado -> no tiene acceso a la app.
    const code = 'no_role';
    await _logLoginFailed(deps.fbDb, {
      userUid: uid,
      email_hash: emailHash,
      reason: 'no_role',
      code,
      atIso,
    });
    return { ok: false, code, message: 'Error del sistema, reintentá en 1 minuto.' };
  }

  // 10. Registrar exito en el rate-limit para resetear el streak.
  try {
    await recordAuthGateResult(rlDeps, emailHash, 'authVerifyLogin', { ok: true });
  } catch (_e) {
    /* no-op */
  }

  return { ok: true, uid, role };
}
