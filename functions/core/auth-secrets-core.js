// @ts-check
/**
 * auth-secrets-core (S04b PR-A, 2026-11-04).
 *
 * Logica PURA (deps inyectables, sin importar firebase-admin) para la
 * verificacion y seteo de los secretos de autenticacion que hoy viven en
 * `/roles/{uid}` (passwordHash, passwordSalt, totpSecret, totpEnabled) y que
 * S04b mueve a `/auth_secrets/{uid}` (coleccion cerrada a clientes por reglas,
 * solo Admin SDK).
 *
 * PR-A: estas funciones se exponen como Cloud Functions callables pero el
 * frontend TODAVIA NO las invoca (quedan inertes). No cambian comportamiento
 * productivo. No tocan `firestore.rules` ni ejecutan migracion.
 *
 * FUENTE DE VERDAD de verificacion: `/auth_secrets/{uid}`. Durante la
 * transicion los setters hacen dual-write (auth_secrets + roles, atomico) para
 * mantener `/roles` vigente de cara al rollback; `/roles` NO se usa para
 * verificar aca.
 *
 * FAIL-CLOSED: ante error transitorio (Firestore no responde, etc.) estas
 * funciones LANZAN (el wrapper lo traduce a un error reintentable); ante
 * credencial invalida devuelven { ok:false }. Nunca devuelven ok:true por
 * fallback silencioso.
 *
 * NUNCA loguear ni devolver el secreto (hash/salt/totpSecret). Las respuestas
 * son booleanas.
 *
 * Deps inyectables (RateLimit-core style):
 *   deps.fbDb   Firestore Admin instance (.doc(), .runTransaction())
 *   deps.now    () => Date           (inyectable para tests)
 *   deps.log    (msg, extra?) => void
 *   deps.scryptAsync (password, salt, keylen, opts) => Promise<Buffer>
 *   deps.sha256Hex   (str) => Promise<string>   (para validar hashes legacy)
 *   deps.randomBytesHex (n) => string
 *   deps.timingSafeEqualHex (aHex, bHex) => boolean
 */

/**
 * Parametros scrypt. DEFINITIVOS SUJETOS A BENCHMARK (S04b). N=2^15 requiere
 * maxmem explicito (~64 MiB) porque el default de Node (32 MiB) lo rechaza.
 * Ejecucion ASINCRONA obligatoria (no bloquear el event loop).
 */
export const SCRYPT_PARAMS = /** @type {const} */ ({
  N: 32768, // 2^15
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024, // 64 MiB (N=2^15 supera el default de 32 MiB)
});

/** Version actual del algoritmo de hashing de password para nuevos sets. */
export const PW_VERSION_CURRENT = 'scrypt-v2';
/** Version legacy (los hashes migrados desde /roles sin pwVersion). */
export const PW_VERSION_LEGACY = 'sha256-legacy';

/** Ventana TOTP: paso de 30s, tolerancia ±1 paso. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_TOLERANCE = 1;

/**
 * @typedef {Object} AuthSecretsDeps
 * @property {any} fbDb
 * @property {() => Date} [now]
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {(password: string, salt: Buffer|string, keylen: number, opts: object) => Promise<Buffer>} [scryptAsync]
 * @property {(str: string) => Promise<string>} [sha256Hex]
 * @property {(nBytes: number) => string} [randomBytesHex]
 * @property {(aHex: string, bHex: string) => boolean} [timingSafeEqualHex]
 * @property {(secretBase32: string, step: number) => string} [totpCodeAt]
 */

/** Error transitorio (el wrapper lo mapea a 'unavailable'/'internal' → reintentar). */
export class TransientAuthError extends Error {
  /** @param {string} msg */
  constructor(msg) {
    super(msg);
    this.name = 'TransientAuthError';
    this.transient = true;
  }
}

/** @param {AuthSecretsDeps} deps */
function _now(deps) {
  return deps.now ? deps.now() : new Date();
}

/**
 * Hash de password con scrypt (async). Devuelve hex.
 * @param {AuthSecretsDeps} deps
 * @param {string} password
 * @param {string} saltHex
 * @returns {Promise<string>}
 */
export async function hashPasswordScrypt(deps, password, saltHex) {
  if (!deps.scryptAsync) throw new TransientAuthError('scryptAsync no inyectado');
  const buf = await deps.scryptAsync(password, saltHex, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return Buffer.from(buf).toString('hex');
}

/**
 * Lee el doc de secretos de un uid desde auth_secrets. Fuente de verdad.
 * @param {AuthSecretsDeps} deps
 * @param {string} uid
 * @returns {Promise<{exists: boolean, data: any}>}
 */
async function readAuthSecret(deps, uid) {
  try {
    const snap = await deps.fbDb.collection('auth_secrets').doc(uid).get();
    return { exists: !!(snap && snap.exists), data: (snap && snap.data && snap.data()) || {} };
  } catch (e) {
    throw new TransientAuthError('auth_secrets read fallo: ' + ((e && e.message) || e));
  }
}

/**
 * Verifica la password del PROPIO usuario (uid = request.auth.uid).
 * Soporta hashes scrypt-v2 (nuevos) y sha256-legacy (migrados desde /roles).
 * Fail-closed: sin registro -> { ok:false, reason:'no_secret' } (el wrapper
 * decide forzar set inicial, NUNCA deja pasar).
 *
 * @param {AuthSecretsDeps} deps
 * @param {string} uid
 * @param {string} password
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verifyPasswordCore(deps, uid, password) {
  if (!uid) throw new TransientAuthError('uid requerido');
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const { exists, data } = await readAuthSecret(deps, uid);
  if (!exists) return { ok: false, reason: 'no_secret' };

  const version = data.pwVersion || (data.passwordHash ? PW_VERSION_LEGACY : null);
  if (!version) return { ok: false, reason: 'no_password' };

  if (version === PW_VERSION_LEGACY) {
    // Hash legacy: SHA-256(salt + password), hex. Migrado tal cual desde /roles.
    if (!data.passwordHash || !data.passwordSalt) return { ok: false, reason: 'incomplete' };
    if (!deps.sha256Hex) throw new TransientAuthError('sha256Hex no inyectado');
    const h = await deps.sha256Hex(String(data.passwordSalt) + password);
    const ok = _safeEq(deps, h, String(data.passwordHash));
    return { ok, reason: ok ? undefined : 'invalid' };
  }
  if (version === PW_VERSION_CURRENT) {
    if (!data.pwHash || !data.pwSalt) return { ok: false, reason: 'incomplete' };
    const h = await hashPasswordScrypt(deps, password, String(data.pwSalt));
    const ok = _safeEq(deps, h, String(data.pwHash));
    return { ok, reason: ok ? undefined : 'invalid' };
  }
  // Version desconocida -> fail-closed.
  return { ok: false, reason: 'unknown_version' };
}

/** @param {AuthSecretsDeps} deps @param {string} a @param {string} b */
function _safeEq(deps, a, b) {
  if (deps.timingSafeEqualHex) return deps.timingSafeEqualHex(a, b);
  // Fallback no-timing-safe SOLO si no se inyecto (tests). El wrapper real
  // inyecta crypto.timingSafeEqual.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifica un codigo TOTP del PROPIO usuario, con anti-replay ATOMICO.
 * Lee totpSecret + totpLastStep, valida en ventana ±1, y si acepta escribe el
 * step consumido en la MISMA transaccion (impide reuso del mismo codigo por
 * dos requests concurrentes).
 *
 * @param {AuthSecretsDeps} deps
 * @param {string} uid
 * @param {string} code  6 digitos
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verifyTotpCore(deps, uid, code) {
  if (!uid) throw new TransientAuthError('uid requerido');
  if (!/^[0-9]{6}$/.test(String(code || ''))) return { ok: false, reason: 'format' };
  if (!deps.totpCodeAt) throw new TransientAuthError('totpCodeAt no inyectado');
  // Referencia local tras el guard: tsc no estrecha deps.totpCodeAt (opcional)
  // dentro del closure de la transaccion, por eso lo fijamos aca.
  const totpCodeAt = deps.totpCodeAt;
  const nowMs = _now(deps).getTime();
  const curStep = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  const ref = deps.fbDb.collection('auth_secrets').doc(uid);
  try {
    return await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, reason: 'no_secret' };
      const data = snap.data() || {};
      const secret = data.totpSecret;
      if (!secret) return { ok: false, reason: 'no_totp' };
      const lastStep = typeof data.totpLastStep === 'number' ? data.totpLastStep : -1;
      // Buscar match en [curStep-tol, curStep+tol].
      let matchedStep = null;
      for (let s = curStep - TOTP_TOLERANCE; s <= curStep + TOTP_TOLERANCE; s++) {
        if (s <= lastStep) continue; // anti-replay: paso ya consumido o anterior
        if (_safeEq(deps, totpCodeAt(String(secret), s), String(code))) {
          matchedStep = s;
          break;
        }
      }
      if (matchedStep === null) {
        // Puede ser codigo invalido O reuso (step <= lastStep). No distinguir.
        return { ok: false, reason: 'invalid' };
      }
      tx.set(
        ref,
        { totpLastStep: matchedStep, totpLastOkAt: _now(deps).toISOString() },
        { merge: true }
      );
      return { ok: true };
    });
  } catch (e) {
    throw new TransientAuthError('verifyTotp tx fallo: ' + ((e && e.message) || e));
  }
}

/**
 * M5 (S04b): decode base32 (RFC4648) ESTRICTO -> Buffer. Pura (sin crypto),
 * testeable. Tolera padding '=' al final y whitespace; cualquier otro caracter
 * fuera del alfabeto base32, o entrada vacia, lanza Error (antes se ignoraban
 * en silencio produciendo buffers parciales). Usada por el generador HOTP del
 * wrapper (functions/index.js).
 * @param {string} input
 * @returns {Buffer}
 */
export function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  if (clean.length === 0) throw new Error('base32: entrada vacia');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error('base32: caracter invalido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Antiguedad maxima (segundos) de la reautenticacion Google para self-ops. */
export const REAUTH_MAX_AGE_SEC = 300;

/**
 * H1 (S04b): predicado PURO de reautenticacion Google reciente para self-ops.
 * Valida SOLO claims del token verificado por Firebase (nunca booleanos del
 * frontend). Regla: 0 <= nowSec - auth_time <= 300 y sign_in_provider google.
 * El wrapper (functions/index.js:_assertRecentGoogleReauth) traduce ok:false a
 * HttpsError('failed-precondition') sin exponer el token.
 *
 * @param {any} token  request.auth.token (DecodedIdToken)
 * @param {number} nowSec  Math.floor(Date.now()/1000)
 * @param {number} [maxAgeSec]
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkRecentGoogleReauth(token, nowSec, maxAgeSec = REAUTH_MAX_AGE_SEC) {
  if (!token) return { ok: false, reason: 'no_token' };
  const authTime = token.auth_time;
  if (typeof authTime !== 'number' || !Number.isFinite(authTime) || !Number.isInteger(authTime)) {
    return { ok: false, reason: 'no_auth_time' };
  }
  const provider = token.firebase && token.firebase.sign_in_provider;
  if (provider !== 'google.com') return { ok: false, reason: 'provider' };
  const age = nowSec - authTime;
  if (age < 0) return { ok: false, reason: 'future' }; // futuro: sin tolerancia
  if (age > maxAgeSec) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/**
 * Autorizacion: resuelve si el caller puede operar sobre targetUid.
 * - self-op: targetUid === callerUid -> permitido (el wrapper ya exigio auth).
 * - admin-op: targetUid !== callerUid -> SOLO si callerRole === 'admin'.
 * @param {{callerUid: string, callerRole: string|null, targetUid: string}} a
 * @returns {{allowed: boolean, mode: 'self'|'admin'|'denied'}}
 */
export function authorizeSecretOp({ callerUid, callerRole, targetUid }) {
  if (!callerUid || !targetUid) return { allowed: false, mode: 'denied' };
  if (targetUid === callerUid) return { allowed: true, mode: 'self' };
  if (callerRole === 'admin') return { allowed: true, mode: 'admin' };
  return { allowed: false, mode: 'denied' };
}

/**
 * Setea password (dual-write ATOMICO auth_secrets + roles) con scrypt-v2.
 * self-op o admin-op segun authorizeSecretOp (el wrapper valida y pasa el mode).
 * Escribe en auth_secrets la version nueva; en roles mantiene el shape legacy
 * (passwordHash/passwordSalt) para que el rollback a lectura-/roles sea
 * consistente durante la transicion (se retira en el cleanup).
 *
 * NOTA: el dual-write a /roles usa SHA-256 legacy (mismo shape que hoy) para
 * compatibilidad del gate viejo durante el rollback; auth_secrets lleva scrypt.
 *
 * @param {AuthSecretsDeps} deps
 * @param {{targetUid: string, password: string}} args
 * @returns {Promise<{ok: boolean}>}
 */
export async function setPasswordCore(deps, { targetUid, password }) {
  if (!targetUid) throw new TransientAuthError('targetUid requerido');
  if (typeof password !== 'string' || password.length < 4) {
    throw new TransientAuthError('password invalida');
  }
  if (!deps.randomBytesHex) throw new TransientAuthError('randomBytesHex no inyectado');
  if (!deps.sha256Hex) throw new TransientAuthError('sha256Hex no inyectado');
  const nowIso = _now(deps).toISOString();
  // scrypt para auth_secrets (fuente de verdad nueva).
  const scryptSalt = deps.randomBytesHex(16);
  const scryptHash = await hashPasswordScrypt(deps, password, scryptSalt);
  // sha256 legacy para /roles (compat rollback). Salt distinto a proposito.
  const legacySalt = deps.randomBytesHex(8);
  const legacyHash = await deps.sha256Hex(legacySalt + password);

  const asRef = deps.fbDb.collection('auth_secrets').doc(targetUid);
  const rolesRef = deps.fbDb.collection('roles').doc(targetUid);
  try {
    await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      // Dual-write atomico. Admin SDK bypassa reglas (incluido el futuro freeze).
      tx.set(
        asRef,
        {
          pwVersion: PW_VERSION_CURRENT,
          pwSalt: scryptSalt,
          pwHash: scryptHash,
          pwUpdatedAt: nowIso,
        },
        { merge: true }
      );
      tx.set(
        rolesRef,
        { passwordSalt: legacySalt, passwordHash: legacyHash, pwUpdatedAt: nowIso },
        { merge: true }
      );
    });
    return { ok: true };
  } catch (e) {
    throw new TransientAuthError('setPassword tx fallo: ' + ((e && e.message) || e));
  }
}

/**
 * Setea/activa TOTP (admin-op). Dual-write atomico auth_secrets + roles.
 * @param {AuthSecretsDeps} deps
 * @param {{targetUid: string, secretBase32: string, enabledBy?: string}} args
 * @returns {Promise<{ok: boolean}>}
 */
export async function setTotpCore(deps, { targetUid, secretBase32, enabledBy }) {
  if (!targetUid) throw new TransientAuthError('targetUid requerido');
  if (!secretBase32 || !/^[A-Z2-7]+=*$/.test(String(secretBase32))) {
    throw new TransientAuthError('secret base32 invalido');
  }
  const nowIso = _now(deps).toISOString();
  const asRef = deps.fbDb.collection('auth_secrets').doc(targetUid);
  const rolesRef = deps.fbDb.collection('roles').doc(targetUid);
  try {
    await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      tx.set(
        asRef,
        { totpSecret: secretBase32, totpLastStep: -1, totpUpdatedAt: nowIso },
        { merge: true }
      );
      // En /roles mantenemos totpEnabled (booleano no sensible) + el secret
      // para compat de rollback; totpEnabled TRUE.
      tx.set(
        rolesRef,
        {
          totpEnabled: true,
          totpSecret: secretBase32,
          totpEnabledAt: nowIso,
          totpEnabledBy: enabledBy || '',
        },
        { merge: true }
      );
    });
    return { ok: true };
  } catch (e) {
    throw new TransientAuthError('setTotp tx fallo: ' + ((e && e.message) || e));
  }
}

/**
 * Desactiva TOTP (admin-op). Dual-write atomico.
 * @param {AuthSecretsDeps} deps
 * @param {{targetUid: string, deleteFieldValue: any}} args  deleteFieldValue = FieldValue.delete()
 * @returns {Promise<{ok: boolean}>}
 */
export async function disableTotpCore(deps, { targetUid, deleteFieldValue }) {
  if (!targetUid) throw new TransientAuthError('targetUid requerido');
  const nowIso = _now(deps).toISOString();
  const asRef = deps.fbDb.collection('auth_secrets').doc(targetUid);
  const rolesRef = deps.fbDb.collection('roles').doc(targetUid);
  try {
    await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      tx.set(
        asRef,
        { totpSecret: deleteFieldValue, totpLastStep: deleteFieldValue, totpDisabledAt: nowIso },
        { merge: true }
      );
      tx.set(
        rolesRef,
        { totpEnabled: false, totpSecret: deleteFieldValue, totpDisabledAt: nowIso },
        { merge: true }
      );
    });
    return { ok: true };
  } catch (e) {
    throw new TransientAuthError('disableTotp tx fallo: ' + ((e && e.message) || e));
  }
}
