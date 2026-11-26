// @ts-check
// B2-A (2026-11-26) — Tests unitarios de verifyLoginCore.
// Tests: 8 casos cubriendo el flujo completo de login server-side (S-8 B1).
// No usa emulador — deps 100% inyectables + mock Firestore + real crypto.
//
// Garantias:
//   - passwordHash/passwordSalt/totpSecret NUNCA llegan al browser.
//   - Toda verificacion ocurre server-side.
//   - Fail-closed: ninguna ruta de excepcion devuelve ok:true.

import {
  scrypt as _scryptCb,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setPasswordCore, setTotpCore } from '../../functions/core/auth-secrets-core.js';
import {
  LOGIN_RATE_LIMIT_THRESHOLD,
  verifyLoginCore,
} from '../../functions/core/auth-verify-login-core.js';

// ---- primitivas crypto reales (mismas que el wrapper de prod) ----
function scryptAsync(password, salt, keylen, opts) {
  return new Promise((res, rej) =>
    _scryptCb(password, salt, keylen, opts, (e, dk) => (e ? rej(e) : res(dk)))
  );
}
const sha256Hex = async (s) => createHash('sha256').update(String(s)).digest('hex');
const sha256EmailHash = async (email) => createHash('sha256').update(String(email)).digest('hex');
const randomBytesHex = (n) => randomBytes(n).toString('hex');
const timingSafeEqualHex = (a, b) => {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};

// TOTP helper (mismo que auth-secrets-core.test.js)
function base32Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let val = 0;
  const out = [];
  for (const c of s.toUpperCase()) {
    const idx = alpha.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpCodeAt(secretBase32, step) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

// ---- mock Firestore con runTransaction serializado ----
function makeMockDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  let txChain = Promise.resolve();
  function docRef(col, id) {
    const path = col + '/' + id;
    return {
      path,
      async get() {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
      },
    };
  }
  const api = {
    _store: store,
    collection(col) {
      return {
        doc: (id) => docRef(col, id),
        // .add() necesario para operations_log
        add: async (data) => {
          const id = randomBytesHex(8);
          store.set(col + '/' + id, data);
          return { id };
        },
      };
    },
    async runTransaction(fn) {
      const run = txChain.then(async () => {
        const writes = [];
        const tx = {
          async get(ref) {
            const data = store.get(ref.path);
            return { exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
          },
          set(ref, data, opts) {
            writes.push({ path: ref.path, data, merge: !!(opts && opts.merge) });
          },
          update(ref, data) {
            writes.push({ path: ref.path, data, merge: true });
          },
        };
        const result = await fn(tx);
        for (const w of writes) {
          const prev = w.merge ? store.get(w.path) || {} : {};
          const next = { ...prev };
          for (const [k, v] of Object.entries(w.data)) {
            if (v && v.__delete__) delete next[k];
            else next[k] = v;
          }
          store.set(w.path, next);
        }
        return result;
      });
      txChain = run.catch(() => {});
      return run;
    },
  };
  return api;
}

// ---- deps base para verifyLoginCore (con getUserByEmail mock) ----
function makeAuthDeps(db, { now, uid = 'user-uid-001', getUserByEmail } = {}) {
  return {
    fbDb: db,
    now: now || (() => new Date('2026-11-26T10:00:00Z')),
    log: () => {},
    scryptAsync,
    sha256Hex,
    randomBytesHex,
    timingSafeEqualHex,
    totpCodeAt,
    getUserByEmail:
      getUserByEmail ||
      (async (email) => {
        if (email === 'test@shimano.com.ar') return { uid };
        const e = new Error('user-not-found');
        e.code = 'auth/user-not-found';
        throw e;
      }),
  };
}

// ---- deps base para setPasswordCore / setTotpCore (mismas crypto) ----
function makeSecretsDeps(db, now = () => new Date('2026-11-26T10:00:00Z')) {
  return {
    fbDb: db,
    now,
    log: () => {},
    scryptAsync,
    sha256Hex,
    randomBytesHex,
    timingSafeEqualHex,
    totpCodeAt,
  };
}

const TEST_EMAIL = 'test@shimano.com.ar';
const TEST_PASSWORD = 'SecretPass#2026';
const TEST_UID = 'user-uid-001';
const TEST_ROLE = 'vendedor';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const BASE_INPUT = {
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
  sha256EmailHash,
};

// ------------------------------------------------------------
// T1: Login OK sin TOTP
// ------------------------------------------------------------
describe('T1: login OK sin TOTP', () => {
  it('devuelve ok:true + uid + role cuando password es correcta y no hay TOTP', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    // Configurar password via setPasswordCore (crea auth_secrets/uid)
    await setPasswordCore(secretsDeps, {
      targetUid: TEST_UID,
      password: TEST_PASSWORD,
    });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    const r = await verifyLoginCore(deps, BASE_INPUT);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.uid).toBe(TEST_UID);
      expect(r.role).toBe(TEST_ROLE);
    }
  });
});

// ------------------------------------------------------------
// T2: Login OK con TOTP habilitado y codigo correcto
// ------------------------------------------------------------
describe('T2: login OK con TOTP correcto', () => {
  it('devuelve ok:true cuando password + TOTP son correctos', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });
    await setTotpCore(secretsDeps, {
      targetUid: TEST_UID,
      secretBase32: TOTP_SECRET,
    });

    const nowMs = Date.UTC(2026, 10, 26, 10, 0, 0);
    const step = Math.floor(nowMs / 1000 / 30);
    const totpCode = totpCodeAt(TOTP_SECRET, step);

    const deps = makeAuthDeps(db, {
      uid: TEST_UID,
      now: () => new Date(nowMs),
    });
    const r = await verifyLoginCore(deps, { ...BASE_INPUT, totpCode });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.uid).toBe(TEST_UID);
      expect(r.role).toBe(TEST_ROLE);
    }
  });
});

// ------------------------------------------------------------
// T3: Password incorrecta -> invalid_credentials
// ------------------------------------------------------------
describe('T3: password incorrecta', () => {
  it('devuelve ok:false con code invalid_credentials cuando la password es mala', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    const r = await verifyLoginCore(deps, { ...BASE_INPUT, password: 'password-incorrecta' });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid_credentials');
    }
  });
});

// ------------------------------------------------------------
// T4: TOTP incorrecto -> invalid_totp
// ------------------------------------------------------------
describe('T4: TOTP incorrecto', () => {
  it('devuelve ok:false con code invalid_totp cuando el codigo TOTP es malo', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });
    await setTotpCore(secretsDeps, {
      targetUid: TEST_UID,
      secretBase32: TOTP_SECRET,
    });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    const r = await verifyLoginCore(deps, { ...BASE_INPUT, totpCode: '000000' });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid_totp');
    }
  });
});

// ------------------------------------------------------------
// T5: Sin credenciales -> no_credentials
// ------------------------------------------------------------
describe('T5: sin credenciales', () => {
  it('email vacio -> no_credentials', async () => {
    const db = makeMockDb();
    const deps = makeAuthDeps(db);
    const r = await verifyLoginCore(deps, { email: '', password: 'x', sha256EmailHash });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_credentials');
  });

  it('password vacia -> no_credentials', async () => {
    const db = makeMockDb();
    const deps = makeAuthDeps(db);
    const r = await verifyLoginCore(deps, { email: TEST_EMAIL, password: '', sha256EmailHash });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_credentials');
  });
});

// ------------------------------------------------------------
// T6: TOTP habilitado pero no viene codigo -> requires_totp
// ------------------------------------------------------------
describe('T6: TOTP habilitado, sin codigo -> requires_totp', () => {
  it('devuelve ok:false code requires_totp y requiresTotp:true cuando falta el codigo TOTP', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });
    await setTotpCore(secretsDeps, {
      targetUid: TEST_UID,
      secretBase32: TOTP_SECRET,
    });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    // No enviamos totpCode
    const r = await verifyLoginCore(deps, BASE_INPUT);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('requires_totp');
      expect(r.requiresTotp).toBe(true);
    }
  });

  it('requires_totp NO cuenta como fallo en el rate-limit', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });
    await setTotpCore(secretsDeps, {
      targetUid: TEST_UID,
      secretBase32: TOTP_SECRET,
    });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    // Invocar requires_totp LOGIN_RATE_LIMIT_THRESHOLD + 1 veces
    for (let i = 0; i <= LOGIN_RATE_LIMIT_THRESHOLD; i++) {
      const r = await verifyLoginCore(deps, BASE_INPUT);
      // Todas deben seguir siendo requires_totp, nunca rate_limit
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('requires_totp');
      }
    }
  });
});

// ------------------------------------------------------------
// T7: Usuario sin rol -> no_role
// ------------------------------------------------------------
describe('T7: usuario sin rol asignado', () => {
  it('devuelve ok:false code no_role cuando el usuario no tiene role en /roles/{uid}', async () => {
    // /roles/{uid} no existe en la DB
    const db = makeMockDb();
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    const r = await verifyLoginCore(deps, BASE_INPUT);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('no_role');
    }
  });

  it('devuelve ok:false code no_role cuando role es string vacio', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: '' } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    const r = await verifyLoginCore(deps, BASE_INPUT);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('no_role');
    }
  });
});

// ------------------------------------------------------------
// T8: Rate limit al superar el umbral con credenciales invalidas
// ------------------------------------------------------------
describe('T8: rate limit en el 6to intento con credenciales invalidas', () => {
  it('devuelve rate_limit al superar LOGIN_RATE_LIMIT_THRESHOLD intentos fallidos', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });

    const deps = makeAuthDeps(db, { uid: TEST_UID });

    let lastResult;
    // Intentar LOGIN_RATE_LIMIT_THRESHOLD + 1 veces con password incorrecta
    for (let i = 0; i <= LOGIN_RATE_LIMIT_THRESHOLD; i++) {
      lastResult = await verifyLoginCore(deps, {
        ...BASE_INPUT,
        password: 'password-mala-' + i,
      });
    }

    // El ultimo intento debe haber sido rechazado por rate limit
    expect(lastResult.ok).toBe(false);
    if (lastResult && !lastResult.ok) {
      expect(['rate_limit', 'rate_limit_locked']).toContain(lastResult.code);
    }
  });
});

// ------------------------------------------------------------
// Garantia de seguridad: auth_secrets nunca expuesto al caller
// ------------------------------------------------------------
describe('Garantia S-8 B1: auth_secrets nunca llega al resultado', () => {
  it('el resultado ok:true no contiene campos de auth_secrets', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    const r = await verifyLoginCore(deps, BASE_INPUT);

    expect(r.ok).toBe(true);
    if (r.ok) {
      // Verificar que NO vienen campos de auth_secrets
      const rAny = r;
      expect(rAny.passwordHash).toBeUndefined();
      expect(rAny.passwordSalt).toBeUndefined();
      expect(rAny.pwHash).toBeUndefined();
      expect(rAny.pwSalt).toBeUndefined();
      expect(rAny.totpSecret).toBeUndefined();
    }
  });

  it('el resultado ok:false no contiene campos de auth_secrets', async () => {
    const db = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });

    const deps = makeAuthDeps(db, { uid: TEST_UID });
    const r = await verifyLoginCore(deps, { ...BASE_INPUT, password: 'mala' });

    expect(r.ok).toBe(false);
    const rAny = r;
    expect(rAny.passwordHash).toBeUndefined();
    expect(rAny.passwordSalt).toBeUndefined();
    expect(rAny.pwHash).toBeUndefined();
    expect(rAny.pwSalt).toBeUndefined();
    expect(rAny.totpSecret).toBeUndefined();
  });
});

// ------------------------------------------------------------
// Anti-enumeracion: user no encontrado vs password mala -> mismo mensaje
// ------------------------------------------------------------
describe('Anti-enumeracion: user-not-found y bad-password devuelven mismo mensaje', () => {
  it('user-not-found y bad-password tienen el mismo message y code', async () => {
    // User no encontrado
    const db1 = makeMockDb();
    const deps1 = makeAuthDeps(db1, {
      getUserByEmail: async () => {
        const e = new Error('user-not-found');
        throw e;
      },
    });
    const rNotFound = await verifyLoginCore(deps1, BASE_INPUT);

    // User encontrado pero password mala
    const db2 = makeMockDb({ 'roles/user-uid-001': { role: TEST_ROLE } });
    const secretsDeps = makeSecretsDeps(db2);
    await setPasswordCore(secretsDeps, { targetUid: TEST_UID, password: TEST_PASSWORD });
    const deps2 = makeAuthDeps(db2, { uid: TEST_UID });
    const rBadPw = await verifyLoginCore(deps2, { ...BASE_INPUT, password: 'mala' });

    expect(rNotFound.ok).toBe(false);
    expect(rBadPw.ok).toBe(false);
    if (!rNotFound.ok && !rBadPw.ok) {
      expect(rNotFound.code).toBe(rBadPw.code);
      expect(rNotFound.message).toBe(rBadPw.message);
    }
  });
});
