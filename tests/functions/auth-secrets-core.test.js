// S04b PR-A — tests unitarios del core de auth-secrets (sin emulador).
// Usa un mock de Firestore que respeta la semantica de runTransaction
// (read-then-write serializado) + primitivas crypto reales inyectadas.
import {
  scrypt as _scryptCb,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authorizeSecretOp,
  base32Decode,
  checkRecentGoogleReauth,
  disableTotpCore,
  PW_VERSION_CURRENT,
  REAUTH_MAX_AGE_SEC,
  setPasswordCore,
  setTotpCore,
  TransientAuthError,
  verifyPasswordCore,
  verifyTotpCore,
} from '../../functions/core/auth-secrets-core.js';
import { backoffForStreak as rlBackoff } from '../../functions/core/rate-limit-core.js';

// ---- primitivas reales (mismas que el wrapper) ----
function scryptAsync(password, salt, keylen, opts) {
  return new Promise((res, rej) =>
    _scryptCb(password, salt, keylen, opts, (e, dk) => (e ? rej(e) : res(dk)))
  );
}
const sha256Hex = async (s) => createHash('sha256').update(String(s)).digest('hex');
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
// base32Decode se importa del core (M5). El generador HOTP del test lo reusa.
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
  const store = new Map(Object.entries(initial)); // "col/doc" -> data
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
      return { doc: (id) => docRef(col, id) };
    },
    async runTransaction(fn) {
      // Serializa como Firestore (una tx por vez sobre el mismo doc).
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
        };
        const result = await fn(tx);
        // aplicar writes (merge con FieldValue.delete simulado)
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
const FAKE_DELETE = { __delete__: true };

function baseDeps(db, now = () => new Date('2026-11-04T12:00:00Z')) {
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

describe('authorizeSecretOp (self vs admin)', () => {
  it('self-op permitido', () => {
    expect(authorizeSecretOp({ callerUid: 'u1', callerRole: 'vendedor', targetUid: 'u1' })).toEqual(
      {
        allowed: true,
        mode: 'self',
      }
    );
  });
  it('admin sobre ajeno permitido', () => {
    expect(authorizeSecretOp({ callerUid: 'a', callerRole: 'admin', targetUid: 'u2' })).toEqual({
      allowed: true,
      mode: 'admin',
    });
  });
  it('no-admin sobre ajeno DENEGADO', () => {
    expect(authorizeSecretOp({ callerUid: 'v', callerRole: 'vendedor', targetUid: 'u2' })).toEqual({
      allowed: false,
      mode: 'denied',
    });
  });
});

describe('verifyPasswordCore', () => {
  it('scrypt-v2: password correcta -> ok', async () => {
    const db = makeMockDb();
    const deps = baseDeps(db);
    await setPasswordCore(deps, { targetUid: 'u1', password: 'Secreta#1' });
    const r = await verifyPasswordCore(deps, 'u1', 'Secreta#1');
    expect(r.ok).toBe(true);
    // verifica que auth_secrets tiene la version nueva
    expect(db._store.get('auth_secrets/u1').pwVersion).toBe(PW_VERSION_CURRENT);
  });
  it('scrypt-v2: password incorrecta -> !ok', async () => {
    const db = makeMockDb();
    const deps = baseDeps(db);
    await setPasswordCore(deps, { targetUid: 'u1', password: 'Secreta#1' });
    const r = await verifyPasswordCore(deps, 'u1', 'otra');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid');
  });
  it('sin registro -> no_secret (fail-closed)', async () => {
    const db = makeMockDb();
    const r = await verifyPasswordCore(baseDeps(db), 'nadie', 'x');
    expect(r).toEqual({ ok: false, reason: 'no_secret' });
  });
  it('legacy sha256 migrado -> valida con el salt legacy', async () => {
    const salt = 'abcdef0123456789';
    const hash = await sha256Hex(salt + 'LegacyPass');
    const db = makeMockDb({ 'auth_secrets/u2': { passwordSalt: salt, passwordHash: hash } });
    const deps = baseDeps(db);
    expect((await verifyPasswordCore(deps, 'u2', 'LegacyPass')).ok).toBe(true);
    expect((await verifyPasswordCore(deps, 'u2', 'mal')).ok).toBe(false);
  });
  it('password vacia -> !ok sin tocar crypto', async () => {
    const db = makeMockDb({
      'auth_secrets/u1': { pwVersion: PW_VERSION_CURRENT, pwSalt: 'x', pwHash: 'y' },
    });
    expect((await verifyPasswordCore(baseDeps(db), 'u1', '')).ok).toBe(false);
  });
});

describe('verifyTotpCore (anti-replay atomico)', () => {
  const SECRET = 'JBSWY3DPEHPK3PXP';
  it('codigo valido del paso actual -> ok y consume el paso', async () => {
    const nowMs = Date.UTC(2026, 10, 4, 12, 0, 0);
    const step = Math.floor(nowMs / 1000 / 30);
    const db = makeMockDb({ 'auth_secrets/u1': { totpSecret: SECRET, totpLastStep: -1 } });
    const deps = baseDeps(db, () => new Date(nowMs));
    const code = totpCodeAt(SECRET, step);
    const r = await verifyTotpCore(deps, 'u1', code);
    expect(r.ok).toBe(true);
    expect(db._store.get('auth_secrets/u1').totpLastStep).toBe(step);
  });
  it('reuso del mismo codigo -> rechazado (replay)', async () => {
    const nowMs = Date.UTC(2026, 10, 4, 12, 0, 0);
    const step = Math.floor(nowMs / 1000 / 30);
    const db = makeMockDb({ 'auth_secrets/u1': { totpSecret: SECRET, totpLastStep: -1 } });
    const deps = baseDeps(db, () => new Date(nowMs));
    const code = totpCodeAt(SECRET, step);
    expect((await verifyTotpCore(deps, 'u1', code)).ok).toBe(true);
    const r2 = await verifyTotpCore(deps, 'u1', code); // mismo codigo otra vez
    expect(r2.ok).toBe(false); // step <= lastStep -> no re-aceptado
  });
  it('codigo invalido -> !ok', async () => {
    const nowMs = Date.UTC(2026, 10, 4, 12, 0, 0);
    const db = makeMockDb({ 'auth_secrets/u1': { totpSecret: SECRET, totpLastStep: -1 } });
    const deps = baseDeps(db, () => new Date(nowMs));
    expect((await verifyTotpCore(deps, 'u1', '000000')).reason).toBe('invalid');
  });
  it('sin totpSecret -> no_totp', async () => {
    const db = makeMockDb({ 'auth_secrets/u1': {} });
    expect((await verifyTotpCore(baseDeps(db), 'u1', '123456')).reason).toBe('no_totp');
  });
  it('formato invalido -> format', async () => {
    const db = makeMockDb();
    expect((await verifyTotpCore(baseDeps(db), 'u1', 'ABC')).reason).toBe('format');
  });
});

describe('setters dual-write (auth_secrets + roles)', () => {
  it('setPasswordCore escribe ambos docs', async () => {
    const db = makeMockDb({ 'roles/u1': { role: 'vendedor', email: 'v@x.com' } });
    await setPasswordCore(baseDeps(db), { targetUid: 'u1', password: 'Nueva#12' });
    const as = db._store.get('auth_secrets/u1');
    const roles = db._store.get('roles/u1');
    expect(as.pwVersion).toBe(PW_VERSION_CURRENT);
    expect(as.pwHash).toBeTruthy();
    expect(roles.passwordHash).toBeTruthy(); // dual-write legacy en roles
    expect(roles.role).toBe('vendedor'); // merge, no pisa otros campos
  });
  it('setTotpCore activa en ambos + totpLastStep reset', async () => {
    const db = makeMockDb({ 'roles/u1': { role: 'vendedor' } });
    await setTotpCore(baseDeps(db), {
      targetUid: 'u1',
      secretBase32: 'JBSWY3DPEHPK3PXP',
      enabledBy: 'a@x',
    });
    expect(db._store.get('auth_secrets/u1').totpSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(db._store.get('auth_secrets/u1').totpLastStep).toBe(-1);
    expect(db._store.get('roles/u1').totpEnabled).toBe(true);
  });
  it('disableTotpCore borra el secret en ambos', async () => {
    const db = makeMockDb({
      'auth_secrets/u1': { totpSecret: 'JBSWY3DPEHPK3PXP', totpLastStep: 5 },
      'roles/u1': { role: 'vendedor', totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' },
    });
    await disableTotpCore(baseDeps(db), { targetUid: 'u1', deleteFieldValue: FAKE_DELETE });
    expect(db._store.get('auth_secrets/u1').totpSecret).toBeUndefined();
    expect(db._store.get('roles/u1').totpEnabled).toBe(false);
    expect(db._store.get('roles/u1').totpSecret).toBeUndefined();
  });
  it('setPasswordCore con password corta -> TransientAuthError', async () => {
    const db = makeMockDb();
    await expect(
      setPasswordCore(baseDeps(db), { targetUid: 'u1', password: 'ab' })
    ).rejects.toBeInstanceOf(TransientAuthError);
  });
});

describe('backoff lockout', () => {
  it('escalones correctos (rate-limit-core)', () => {
    expect(rlBackoff(4)).toBe(0);
    expect(rlBackoff(5)).toBe(60 * 1000);
    expect(rlBackoff(10)).toBe(5 * 60 * 1000);
    expect(rlBackoff(15)).toBe(30 * 60 * 1000);
    expect(rlBackoff(20)).toBe(24 * 60 * 60 * 1000);
    expect(rlBackoff(100)).toBe(24 * 60 * 60 * 1000);
  });
});

describe('H1 checkRecentGoogleReauth (matriz reautenticacion)', () => {
  const NOW = 1_800_000_000; // segundos epoch arbitrarios
  const tok = (authTime, provider = 'google.com') => ({
    auth_time: authTime,
    firebase: { sign_in_provider: provider },
  });
  it('google, antiguedad < 300s -> ok', () => {
    expect(checkRecentGoogleReauth(tok(NOW - 100), NOW).ok).toBe(true);
  });
  it('google, exactamente 300s -> ok (limite inclusivo)', () => {
    expect(checkRecentGoogleReauth(tok(NOW - REAUTH_MAX_AGE_SEC), NOW).ok).toBe(true);
  });
  it('google, 301s -> rechaza (expired)', () => {
    const r = checkRecentGoogleReauth(tok(NOW - 301), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });
  it('proveedor distinto de google -> rechaza (provider)', () => {
    const r = checkRecentGoogleReauth(tok(NOW - 10, 'password'), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('provider');
  });
  it('auth_time ausente -> rechaza (no_auth_time)', () => {
    const r = checkRecentGoogleReauth({ firebase: { sign_in_provider: 'google.com' } }, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_auth_time');
  });
  it('auth_time no numerico -> rechaza', () => {
    expect(checkRecentGoogleReauth(tok('ayer'), NOW).ok).toBe(false);
  });
  it('auth_time no entero (NaN/float) -> rechaza', () => {
    expect(checkRecentGoogleReauth(tok(Number.NaN), NOW).ok).toBe(false);
    expect(checkRecentGoogleReauth(tok(NOW - 0.5), NOW).ok).toBe(false);
  });
  it('auth_time futuro -> rechaza (future, sin tolerancia)', () => {
    const r = checkRecentGoogleReauth(tok(NOW + 5), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('future');
  });
  it('token ausente -> rechaza (no_token)', () => {
    expect(checkRecentGoogleReauth(null, NOW).reason).toBe('no_token');
  });
});

describe('H2 authorizeSecretOp (matriz self/admin completa)', () => {
  const cases = [
    // [callerRole, same, esperado.allowed, esperado.mode]
    ['vendedor', true, true, 'self'],
    ['interno', true, true, 'self'],
    ['unassigned', true, true, 'self'],
    ['vendedor', false, false, 'denied'],
    ['interno', false, false, 'denied'],
    ['unassigned', false, false, 'denied'],
    ['admin', true, true, 'self'], // admin cambia su propia -> self (exigira reauth en wrapper)
    ['admin', false, true, 'admin'], // admin sobre tercero -> admin-op
  ];
  for (const [role, same, allowed, mode] of cases) {
    it(`${role} ${same ? 'propia' : 'ajena'} -> ${mode}`, () => {
      const r = authorizeSecretOp({
        callerUid: 'caller',
        callerRole: role,
        targetUid: same ? 'caller' : 'otro',
      });
      expect(r.allowed).toBe(allowed);
      expect(r.mode).toBe(mode);
    });
  }
  it('callerUid vacio -> denied (no suplantacion)', () => {
    expect(authorizeSecretOp({ callerUid: '', callerRole: 'admin', targetUid: 'x' }).allowed).toBe(
      false
    );
  });
});

describe('M5 base32Decode estricto', () => {
  it('secret valido decodifica', () => {
    expect(base32Decode('JBSWY3DPEHPK3PXP').length).toBeGreaterThan(0);
  });
  it('tolera padding y whitespace', () => {
    expect(() => base32Decode('JBSWY3DP EHPK3PXP===')).not.toThrow();
  });
  it('caracter invalido -> throw', () => {
    expect(() => base32Decode('JBSW0Y3DP')).toThrow(); // '0' y '1' no estan en base32
    expect(() => base32Decode('abc!def')).toThrow();
  });
  it('entrada vacia -> throw', () => {
    expect(() => base32Decode('')).toThrow();
    expect(() => base32Decode('   ')).toThrow();
  });
});
