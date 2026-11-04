// S04b PR-A — tests del rate-limit extendido (lockout + backoff) y de que
// NO se rompio el checkAndIncrementRateLimit existente.
import { describe, expect, it } from 'vitest';
import {
  AUTH_GATE_BACKOFF_STEPS,
  backoffForStreak,
  checkAndIncrementRateLimit,
  checkAuthGateRateLimit,
  RATE_LIMITS,
  registerAuthGateOutcome,
} from '../../functions/core/rate-limit-core.js';

// mock db con runTransaction serializado (misma semantica que el core test)
function makeMockDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  let chain = Promise.resolve();
  const ref = (col, id) => ({
    path: col + '/' + id,
    async get() {
      const d = store.get(col + '/' + id);
      return { exists: d !== undefined, data: () => (d ? { ...d } : undefined) };
    },
  });
  return {
    _store: store,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    async runTransaction(fn) {
      const run = chain.then(async () => {
        const writes = [];
        const tx = {
          async get(r) {
            const d = store.get(r.path);
            return { exists: d !== undefined, data: () => (d ? { ...d } : undefined) };
          },
          set(r, data, opts) {
            writes.push({ path: r.path, data, merge: !!(opts && opts.merge) });
          },
        };
        const res = await fn(tx);
        for (const w of writes) {
          const prev = w.merge ? store.get(w.path) || {} : {};
          store.set(w.path, { ...prev, ...w.data });
        }
        return res;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

describe('backoffForStreak', () => {
  it('escalones', () => {
    expect(backoffForStreak(0)).toBe(0);
    expect(backoffForStreak(4)).toBe(0);
    expect(backoffForStreak(5)).toBe(60_000);
    expect(backoffForStreak(9)).toBe(60_000);
    expect(backoffForStreak(10)).toBe(300_000);
    expect(backoffForStreak(15)).toBe(1_800_000);
    expect(backoffForStreak(20)).toBe(86_400_000);
  });
  it('AUTH_GATE_BACKOFF_STEPS ordenado', () => {
    const streaks = AUTH_GATE_BACKOFF_STEPS.map((s) => s.atStreak);
    expect(streaks).toEqual([...streaks].sort((a, b) => a - b));
  });
});

describe('checkAuthGateRateLimit', () => {
  it('permite dentro de la ventana y rechaza al superar el umbral', async () => {
    const db = makeMockDb();
    const deps = { fbDb: db, now: () => new Date('2026-11-04T12:00:00Z') };
    const th = RATE_LIMITS.verifyPasswordGate.threshold;
    for (let i = 0; i < th; i++) {
      const r = await checkAuthGateRateLimit(deps, 'u1', 'verifyPasswordGate', th, 60_000);
      expect(r.allowed).toBe(true);
    }
    const over = await checkAuthGateRateLimit(deps, 'u1', 'verifyPasswordGate', th, 60_000);
    expect(over.allowed).toBe(false);
    expect(over.locked).toBe(false);
  });

  it('respeta lockedUntil (bloqueo temporal)', async () => {
    const future = new Date(Date.UTC(2026, 10, 4, 12, 5, 0)).toISOString();
    const db = makeMockDb({ 'rate_limits/u1': { verifyPasswordGate: { lockedUntil: future } } });
    const deps = { fbDb: db, now: () => new Date(Date.UTC(2026, 10, 4, 12, 0, 0)) };
    const r = await checkAuthGateRateLimit(deps, 'u1', 'verifyPasswordGate', 5, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.locked).toBe(true);
  });

  it('lock expirado deja pasar de nuevo', async () => {
    const past = new Date(Date.UTC(2026, 10, 4, 11, 50, 0)).toISOString();
    const db = makeMockDb({ 'rate_limits/u1': { verifyPasswordGate: { lockedUntil: past } } });
    const deps = { fbDb: db, now: () => new Date(Date.UTC(2026, 10, 4, 12, 0, 0)) };
    const r = await checkAuthGateRateLimit(deps, 'u1', 'verifyPasswordGate', 5, 60_000);
    expect(r.allowed).toBe(true);
  });
});

describe('registerAuthGateOutcome', () => {
  it('fallos consecutivos incrementan failStreak y setean lockedUntil al cruzar escalon', async () => {
    const db = makeMockDb();
    const deps = { fbDb: db, now: () => new Date('2026-11-04T12:00:00Z') };
    let res;
    for (let i = 0; i < 5; i++) {
      res = await registerAuthGateOutcome(deps, 'u1', 'verifyPasswordGate', false);
    }
    expect(res.failStreak).toBe(5);
    expect(res.lockedUntil).not.toBeNull(); // 5 fallos -> lock
  });
  it('exito resetea failStreak', async () => {
    const db = makeMockDb({ 'rate_limits/u1': { verifyPasswordGate: { failStreak: 4 } } });
    const deps = { fbDb: db, now: () => new Date('2026-11-04T12:00:00Z') };
    const res = await registerAuthGateOutcome(deps, 'u1', 'verifyPasswordGate', true);
    expect(res.failStreak).toBe(0);
    expect(res.lockedUntil).toBeNull();
  });
});

describe('checkAndIncrementRateLimit (existente) NO se rompio', () => {
  it('sigue el contrato original: allowed hasta threshold, luego no', async () => {
    const db = makeMockDb();
    const deps = { fbDb: db, now: () => new Date('2026-11-04T12:00:00Z') };
    const r1 = await checkAndIncrementRateLimit(deps, 'u9', 'sapProxy', 2, 60_000);
    const r2 = await checkAndIncrementRateLimit(deps, 'u9', 'sapProxy', 2, 60_000);
    const r3 = await checkAndIncrementRateLimit(deps, 'u9', 'sapProxy', 2, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.threshold).toBe(2);
    expect(typeof r3.resetAt).toBe('string');
  });
  it('RATE_LIMITS conserva las entradas originales', () => {
    expect(RATE_LIMITS.sapProxy).toEqual({ threshold: 5000, windowMs: 3600000 });
    expect(RATE_LIMITS.geminiOcrProxy).toEqual({ threshold: 100, windowMs: 3600000 });
    expect(RATE_LIMITS.updateAsigLineState).toEqual({ threshold: 500, windowMs: 3600000 });
  });
});

describe('M2 rate-limit de setters (ventana fija, sin lockout)', () => {
  it('entradas nuevas con los valores aprobados', () => {
    expect(RATE_LIMITS.setPasswordGate).toEqual({ threshold: 20, windowMs: 3600000 });
    expect(RATE_LIMITS.authSecretAdminOp).toEqual({ threshold: 60, windowMs: 3600000 });
  });
  it('setPasswordGate: permite hasta 20/hr y luego rechaza (sin lockout)', async () => {
    const db = makeMockDb();
    const deps = { fbDb: db, now: () => new Date('2026-11-04T12:00:00Z') };
    for (let i = 0; i < 20; i++) {
      const r = await checkAndIncrementRateLimit(deps, 'u1', 'setPasswordGate', 20, 3600000);
      expect(r.allowed).toBe(true);
    }
    const over = await checkAndIncrementRateLimit(deps, 'u1', 'setPasswordGate', 20, 3600000);
    expect(over.allowed).toBe(false);
    // ventana fija: NO hay campo locked -> recuperacion automatica al vencer.
    expect(over.locked).toBeUndefined();
  });
  it('recupera al vencer la ventana', async () => {
    const db = makeMockDb();
    let t = Date.UTC(2026, 10, 4, 12, 0, 0);
    const deps = { fbDb: db, now: () => new Date(t) };
    for (let i = 0; i < 20; i++)
      await checkAndIncrementRateLimit(deps, 'u1', 'setPasswordGate', 20, 3600000);
    expect(
      (await checkAndIncrementRateLimit(deps, 'u1', 'setPasswordGate', 20, 3600000)).allowed
    ).toBe(false);
    t += 3600001; // avanzar mas que la ventana
    expect(
      (await checkAndIncrementRateLimit(deps, 'u1', 'setPasswordGate', 20, 3600000)).allowed
    ).toBe(true);
  });
  it('authSecretAdminOp: contador compartido entre setTotp/disableTotp (mismo opName)', async () => {
    const db = makeMockDb();
    const deps = { fbDb: db, now: () => new Date('2026-11-04T12:00:00Z') };
    for (let i = 0; i < 60; i++) {
      expect(
        (await checkAndIncrementRateLimit(deps, 'u1', 'authSecretAdminOp', 60, 3600000)).allowed
      ).toBe(true);
    }
    expect(
      (await checkAndIncrementRateLimit(deps, 'u1', 'authSecretAdminOp', 60, 3600000)).allowed
    ).toBe(false);
  });
});
