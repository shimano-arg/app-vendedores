// D8 — Capa 1 unit: casos U-01, U-03, U-06, U-09 del informe 010.
//
// Los otros casos U-02, U-04, U-05, U-07, U-08, U-10, U-11, U-12 ya estan
// cubiertos en tests/functions/auth-secrets-core.test.js y
// tests/functions/auth-gate-ratelimit.test.js (ver informe 011 §).
//
// Estos 4 cierran los gaps parciales identificados:
//   U-01: verifyPasswordCore con password vacio NO llega a tocar rate_limits
//         (classify = not_counted; recordAuthGateResult no escribe).
//   U-03: verifyTotpCore con formato invalido NO llega a tocar rate_limits.
//   U-06: setTotpCore con secret base32 invalido -> TransientAuthError.
//   U-09: backoffForStreak(3) = 0 (confirmar que streak 3 NO bloquea aun).
//
// Tests deterministicos. Sin red. Sin credenciales reales. Sin secretos en log.

import { describe, expect, it } from 'vitest';
import {
  setTotpCore,
  TransientAuthError,
  verifyPasswordCore,
  verifyTotpCore,
} from '../../functions/core/auth-secrets-core.js';
import {
  backoffForStreak,
  classifyAuthGateResult,
  recordAuthGateResult,
} from '../../functions/core/rate-limit-core.js';

// Mock Firestore minimo (patron de los otros tests unit: solo expone .collection().doc().get()/set()).
function makeMockDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  const writes = []; // auditoria: toda escritura queda registrada
  const _make = (path) => ({
    id: path.split('/').pop(),
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
      id: path.split('/').pop(),
    }),
    set: async (data, opts) => {
      const prev = store.get(path) || {};
      store.set(path, opts && opts.merge ? Object.assign({}, prev, data) : data);
      writes.push({ path, data: JSON.parse(JSON.stringify(data)), merge: !!(opts && opts.merge) });
    },
    update: async (data) => {
      const prev = store.get(path) || {};
      store.set(path, Object.assign({}, prev, data));
      writes.push({ path, data: JSON.parse(JSON.stringify(data)), update: true });
    },
    delete: async () => {
      store.delete(path);
      writes.push({ path, delete: true });
    },
  });
  return {
    _store: store,
    _writes: writes,
    collection: (col) => ({ doc: (id) => _make(col + '/' + id) }),
    doc: (path) => _make(path),
    runTransaction: async (fn) => {
      // simplificacion: no implementa rollback cross-ref; suficiente para tests
      // que NO tocan rate_limits (U-01/U-03/U-06) o que no exigen aislamiento.
      const tx = {
        get: async (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
      };
      return fn(tx);
    },
  };
}

// Deps minimos: NO inyectamos scryptAsync ni totpCodeAt porque los casos U
// nunca llegan a esa parte del flow (fallan antes por format/empty/invalid).
function baseDepsNoCrypto(db) {
  return {
    fbDb: db,
    now: () => new Date('2026-11-12T16:00:00Z'),
    log: () => {},
    // sha256Hex NO se usa en el camino empty/no_secret/format.
    sha256Hex: async () => {
      throw new Error('sha256Hex no deberia invocarse en este camino');
    },
  };
}

describe('D8 Capa 1 — U-01: verifyPasswordCore con password vacio NO toca rate_limits', () => {
  it('U-01a: verifyPasswordCore password=="" devuelve reason="empty"', async () => {
    const db = makeMockDb({
      'roles/u1': { role: 'vendedor' },
      // No hay /auth_secrets/u1 — pero igual el flow debe cortar en "empty"
      // antes de leer /auth_secrets (ver auth-secrets-core.js linea 133).
    });
    const r = await verifyPasswordCore(baseDepsNoCrypto(db), 'u1', '');
    expect(r).toEqual({ ok: false, reason: 'empty' });
  });

  it('U-01b: classifyAuthGateResult({ok:false, reason:"empty"}) === "not_counted"', () => {
    expect(classifyAuthGateResult({ ok: false, reason: 'empty' })).toBe('not_counted');
  });

  it('U-01c: recordAuthGateResult con reason="empty" NO escribe en rate_limits', async () => {
    const db = makeMockDb({});
    const r = { ok: false, reason: 'empty' };
    const rec = await recordAuthGateResult({ fbDb: db }, 'u1', 'verifyPasswordGate', r);
    expect(rec.outcome).toBe('not_counted');
    expect(rec.recorded).toBe(false);
    // Invariante clave: el store sigue vacio; no hay doc rate_limits/u1.
    expect(db._store.has('rate_limits/u1')).toBe(false);
    expect(db._writes.length).toBe(0);
  });
});

describe('D8 Capa 1 — U-03: verifyTotpCore con formato invalido NO toca rate_limits', () => {
  it('U-03a: verifyTotpCore code="ABC" devuelve reason="format"', async () => {
    const db = makeMockDb({});
    const r = await verifyTotpCore(baseDepsNoCrypto(db), 'u1', 'ABC');
    expect(r).toEqual({ ok: false, reason: 'format' });
  });

  it('U-03b: verifyTotpCore code="12345" (5 digitos) devuelve reason="format"', async () => {
    const db = makeMockDb({});
    const r = await verifyTotpCore(baseDepsNoCrypto(db), 'u1', '12345');
    expect(r).toEqual({ ok: false, reason: 'format' });
  });

  it('U-03c: verifyTotpCore code="1234567" (7 digitos) devuelve reason="format"', async () => {
    const db = makeMockDb({});
    const r = await verifyTotpCore(baseDepsNoCrypto(db), 'u1', '1234567');
    expect(r).toEqual({ ok: false, reason: 'format' });
  });

  it('U-03d: classifyAuthGateResult({ok:false, reason:"format"}) === "not_counted"', () => {
    expect(classifyAuthGateResult({ ok: false, reason: 'format' })).toBe('not_counted');
  });

  it('U-03e: recordAuthGateResult con reason="format" NO escribe en rate_limits', async () => {
    const db = makeMockDb({});
    const r = { ok: false, reason: 'format' };
    const rec = await recordAuthGateResult({ fbDb: db }, 'u1', 'verifyTotpGate', r);
    expect(rec.outcome).toBe('not_counted');
    expect(rec.recorded).toBe(false);
    expect(db._store.has('rate_limits/u1')).toBe(false);
    expect(db._writes.length).toBe(0);
  });
});

describe('D8 Capa 1 — U-06: setTotpCore con secret base32 invalido -> TransientAuthError', () => {
  // La validacion esta en auth-secrets-core.js:361
  //   if (!secretBase32 || !/^[A-Z2-7]+=*$/.test(String(secretBase32))) {
  //     throw new TransientAuthError('secret base32 invalido');
  //   }
  const db = makeMockDb({});
  const deps = { fbDb: db, now: () => new Date('2026-11-12T16:00:00Z'), log: () => {} };

  it('U-06a: secret vacio -> TransientAuthError', async () => {
    await expect(
      setTotpCore(deps, { targetUid: 'u1', secretBase32: '', enabledBy: 'admin@x' })
    ).rejects.toThrow(TransientAuthError);
  });

  it('U-06b: secret con minusculas -> TransientAuthError (base32 es A-Z2-7 case-sensitive)', async () => {
    await expect(
      setTotpCore(deps, { targetUid: 'u1', secretBase32: 'jbswy3dpehpk', enabledBy: 'admin@x' })
    ).rejects.toThrow(TransientAuthError);
  });

  it('U-06c: secret con 0 o 1 (no validos en base32 RFC4648) -> TransientAuthError', async () => {
    await expect(
      setTotpCore(deps, { targetUid: 'u1', secretBase32: 'JBSWY01EHPK', enabledBy: 'admin@x' })
    ).rejects.toThrow(TransientAuthError);
  });

  it('U-06d: secret con caracter especial -> TransientAuthError', async () => {
    await expect(
      setTotpCore(deps, { targetUid: 'u1', secretBase32: 'JBSW!Y3DP', enabledBy: 'admin@x' })
    ).rejects.toThrow(TransientAuthError);
  });

  it('U-06e: secret base32 valido NO lanza (regex matchea)', async () => {
    // Nota: no completamos el setTotpCore porque no mockeamos la transaction
    // ni el Firestore completo. Solo verificamos que la validacion inicial pasa
    // (el flow continuaria y fallaria mas adelante en el runTransaction del mock
    // simplificado — ese camino se cubre en auth-secrets-emulator.test.js).
    const dbFull = makeMockDb({});
    try {
      await setTotpCore(
        { fbDb: dbFull, now: () => new Date(), log: () => {} },
        { targetUid: 'u1', secretBase32: 'JBSWY3DPEHPK3PXP', enabledBy: 'admin@x' }
      );
    } catch (e) {
      // El mock de runTransaction es simplificado; si falla por eso esta OK
      // mientras el error NO sea 'secret base32 invalido'.
      expect(String(e && e.message)).not.toContain('secret base32 invalido');
    }
  });
});

describe('D8 Capa 1 — U-09: backoffForStreak(3) === 0 (streak 3 todavia NO bloquea)', () => {
  // La invariante: solo streak >= 5 dispara backoff (ver rate-limit-core.js:113+
  // AUTH_GATE_BACKOFF_STEPS = [{atStreak:5,lockMs:60000}, {atStreak:10,...},
  // {atStreak:15,...}, {atStreak:20,...}])
  it('U-09a: backoffForStreak(0) === 0 (sin fallos, no lockout)', () => {
    expect(backoffForStreak(0)).toBe(0);
  });

  it('U-09b: backoffForStreak(1) === 0', () => {
    expect(backoffForStreak(1)).toBe(0);
  });

  it('U-09c: backoffForStreak(3) === 0 (streak 3 -> todavia NO bloquea)', () => {
    expect(backoffForStreak(3)).toBe(0);
  });

  it('U-09d: backoffForStreak(4) === 0 (umbral inferior exclusivo)', () => {
    expect(backoffForStreak(4)).toBe(0);
  });

  it('U-09e: backoffForStreak(5) === 60_000 (primer escalon)', () => {
    expect(backoffForStreak(5)).toBe(60_000);
  });
});
