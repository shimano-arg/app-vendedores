// @ts-check
/**
 * D8 — Tarea 65: REGRESIÓN del bug "no_secret → lockout".
 *
 * Antes (Tarea 63, caracterización): los wrappers verifyPasswordGate /
 * verifyTotpGate llamaban registerAuthGateOutcome(r.ok). Cualquier ok:false
 * (no_secret, no_totp, incomplete, ...) sumaba failStreak, y un usuario con la
 * contraseña CORRECTA pero sin /auth_secrets quedaba bloqueado hasta 24 h,
 * bloqueo que sobrevivía al backfill.
 *
 * Ahora: los wrappers usan recordAuthGateResult(r). SOLO reason 'invalid'
 * cuenta como fallo; el éxito resetea; cualquier otro estado (técnico o de
 * migración) NO escribe nada en rate_limits (ni suma ni resetea).
 *
 * Arnés: core REAL (auth-secrets-core + rate-limit-core), Firestore en
 * memoria, reloj controlado. Sin emulador. El flujo de `attempt` replica el
 * wrapper real de functions/index.js; un test de contrato verifica que el
 * wrapper real sea ese flujo.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyPasswordCore, verifyTotpCore } from '../../functions/core/auth-secrets-core.js';
import {
  AUTH_GATE_COUNTED_FAILURE_REASONS,
  checkAuthGateRateLimit,
  classifyAuthGateResult,
  RATE_LIMITS,
  recordAuthGateResult,
} from '../../functions/core/rate-limit-core.js';

/** Firestore mínimo en memoria (doc get/set merge + runTransaction). */
function memDb() {
  const store = new Map();
  const ref = (col, id) => {
    const key = col + '/' + id;
    return {
      key,
      get: async () => ({
        exists: store.has(key),
        data: () => (store.has(key) ? structuredClone(store.get(key)) : undefined),
      }),
      set: async (data, opts) => {
        store.set(
          key,
          opts && opts.merge
            ? { ...(store.get(key) || {}), ...structuredClone(data) }
            : structuredClone(data)
        );
      },
    };
  };
  const db = {
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    runTransaction: async (fn) =>
      fn({
        get: (r) => r.get(),
        set: (r, data, opts) => r.set(data, opts),
      }),
  };
  return { db, store };
}

const sha256Hex = async (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
/** TOTP determinístico de prueba: 6 dígitos función del step (no criptográfico). */
const totpCodeAt = (secret, step) =>
  String((step * 7919 + String(secret).length) % 1000000).padStart(6, '0');
const MIN = 60 * 1000;
const T0 = Date.parse('2026-11-11T12:00:00Z');

function env() {
  const { db, store } = memDb();
  return { db, store, t: T0 };
}
const deps = (e) => ({ fbDb: e.db, now: () => new Date(e.t), sha256Hex, totpCodeAt });
const curStep = (e) => Math.floor(e.t / 1000 / 30);
const streak = (e, uid, op) => {
  const d = e.store.get('rate_limits/' + uid);
  return d && d[op] ? d[op].failStreak || 0 : 0;
};
const lockedUntil = (e, uid, op) => {
  const d = e.store.get('rate_limits/' + uid);
  return d && d[op] ? d[op].lockedUntil || null : null;
};

/** Flujo del wrapper real: rate-limit → verify → recordAuthGateResult. */
async function attempt(e, uid, op, credential) {
  const d = deps(e);
  const rl = await checkAuthGateRateLimit(
    d,
    uid,
    op,
    RATE_LIMITS[op].threshold,
    RATE_LIMITS[op].windowMs
  );
  if (!rl.allowed) return rl.locked ? 'locked' : 'rate_limited';
  const r =
    op === 'verifyPasswordGate'
      ? await verifyPasswordCore(d, uid, credential)
      : await verifyTotpCore(d, uid, credential);
  const rec = await recordAuthGateResult(d, uid, op, r);
  return rec.outcome; // 'success' | 'failure' | 'not_counted'
}

async function seedLegacyPassword(e, uid, password) {
  const salt = 'abcd1234';
  await e.db
    .collection('auth_secrets')
    .doc(uid)
    .set({
      pwVersion: 'sha256-legacy',
      passwordSalt: salt,
      passwordHash: await sha256Hex(salt + password),
    });
}

describe('classifyAuthGateResult — clasificación explícita', () => {
  it('solo ok===true es éxito y solo reason "invalid" es fallo contable', () => {
    expect(AUTH_GATE_COUNTED_FAILURE_REASONS).toEqual(['invalid']);
    expect(classifyAuthGateResult({ ok: true })).toBe('success');
    expect(classifyAuthGateResult({ ok: false, reason: 'invalid' })).toBe('failure');
    for (const reason of [
      'no_secret',
      'no_totp',
      'no_password',
      'incomplete',
      'unknown_version',
      'empty',
      'format',
      'algo_nuevo',
      undefined,
    ]) {
      expect(classifyAuthGateResult({ ok: false, reason })).toBe('not_counted');
    }
  });
  it('resultados malformados NO se convierten en éxito', () => {
    for (const r of [
      null,
      undefined,
      {},
      { ok: 'true' },
      { ok: 1 },
      { ok: true, reason: 'invalid' },
    ]) {
      expect(classifyAuthGateResult(/** @type {any} */ (r))).not.toBe('success');
    }
    // ok:true con reason invalid es contradictorio → se trata como fallo, no éxito.
    expect(classifyAuthGateResult({ ok: true, reason: 'invalid' })).toBe('failure');
  });
});

describe('Contraseña — no_secret ya no bloquea', () => {
  it('contraseña correcta SIN /auth_secrets: 25 intentos no incrementan failStreak ni bloquean', async () => {
    const e = env();
    for (let i = 0; i < 25; i++) {
      expect(await attempt(e, 'u1', 'verifyPasswordGate', 'la-correcta')).toBe('not_counted');
      e.t += 2 * MIN; // fuera de la ventana 5/min
    }
    expect(streak(e, 'u1', 'verifyPasswordGate')).toBe(0);
    expect(lockedUntil(e, 'u1', 'verifyPasswordGate')).toBeNull();
  });

  it('el backfill posterior autentica al PRIMER intento, sin heredar bloqueo', async () => {
    const e = env();
    for (let i = 0; i < 25; i++) {
      await attempt(e, 'u2', 'verifyPasswordGate', 'la-correcta');
      e.t += 31 * MIN;
    }
    await seedLegacyPassword(e, 'u2', 'la-correcta'); // lo que haría BA --apply
    expect(await attempt(e, 'u2', 'verifyPasswordGate', 'la-correcta')).toBe('success');
  });

  it('contraseña realmente incorrecta SÍ incrementa failStreak', async () => {
    const e = env();
    await seedLegacyPassword(e, 'u3', 'la-correcta');
    expect(await attempt(e, 'u3', 'verifyPasswordGate', 'otra')).toBe('failure');
    expect(streak(e, 'u3', 'verifyPasswordGate')).toBe(1);
  });

  it('incomplete y unknown_version no incrementan failStreak', async () => {
    const e = env();
    await e.db.collection('auth_secrets').doc('u4').set({ pwVersion: 'sha256-legacy' }); // incomplete
    await e.db.collection('auth_secrets').doc('u5').set({ pwVersion: 'v99-desconocida' }); // unknown_version
    await e.db.collection('auth_secrets').doc('u6').set({ totpSecret: 'X' }); // no_password
    for (const uid of ['u4', 'u5', 'u6']) {
      for (let i = 0; i < 6; i++) {
        expect(await attempt(e, uid, 'verifyPasswordGate', 'cualquiera')).toBe('not_counted');
        e.t += 2 * MIN;
      }
      expect(streak(e, uid, 'verifyPasswordGate')).toBe(0);
    }
    const d = deps(e);
    expect((await verifyPasswordCore(d, 'u4', 'x')).reason).toBe('incomplete');
    expect((await verifyPasswordCore(d, 'u5', 'x')).reason).toBe('unknown_version');
  });

  it('un estado no contable NO resetea un streak de fallos reales (no sirve para evadir el lockout)', async () => {
    const e = env();
    await seedLegacyPassword(e, 'u7', 'la-correcta');
    for (let i = 0; i < 4; i++) {
      await attempt(e, 'u7', 'verifyPasswordGate', 'mala-' + i);
      e.t += 2 * MIN;
    }
    expect(streak(e, 'u7', 'verifyPasswordGate')).toBe(4);
    // Contraseña vacía → reason 'empty' → no_counted: no toca el streak.
    expect(await attempt(e, 'u7', 'verifyPasswordGate', '')).toBe('not_counted');
    expect(streak(e, 'u7', 'verifyPasswordGate')).toBe(4);
    e.t += 2 * MIN;
    // El 5.º fallo real bloquea igual que antes.
    expect(await attempt(e, 'u7', 'verifyPasswordGate', 'mala-final')).toBe('failure');
    expect(streak(e, 'u7', 'verifyPasswordGate')).toBe(5);
    expect(lockedUntil(e, 'u7', 'verifyPasswordGate')).toBeTruthy();
  });
});

describe('Contraseña — la protección contra fuerza bruta sigue intacta', () => {
  it('escalones 5→1 min, 10→5 min, 15→30 min, 20→24 h con fallos reales; el éxito resetea', async () => {
    const e = env();
    await seedLegacyPassword(e, 'b1', 'la-correcta');
    const expected = { 5: MIN, 10: 5 * MIN, 15: 30 * MIN, 20: 24 * 60 * MIN };
    let fails = 0;
    while (fails < 20) {
      const r = await attempt(e, 'b1', 'verifyPasswordGate', 'mala');
      if (r === 'failure') {
        fails++;
        if (expected[fails]) {
          const lu = Date.parse(lockedUntil(e, 'b1', 'verifyPasswordGate'));
          expect(lu - e.t).toBe(expected[fails]);
          // Durante el bloqueo, incluso la correcta es rechazada.
          expect(await attempt(e, 'b1', 'verifyPasswordGate', 'la-correcta')).toBe('locked');
        }
      }
      e.t += 31 * MIN;
    }
    expect(streak(e, 'b1', 'verifyPasswordGate')).toBe(20);
    e.t += 24 * 60 * MIN;
    expect(await attempt(e, 'b1', 'verifyPasswordGate', 'la-correcta')).toBe('success');
    expect(streak(e, 'b1', 'verifyPasswordGate')).toBe(0);
  });

  it('la ventana 5/min sigue aplicando a TODOS los intentos (incluidos los no contables)', async () => {
    const e = env();
    const res = [];
    for (let i = 0; i < 6; i++) res.push(await attempt(e, 'w1', 'verifyPasswordGate', 'x'));
    expect(res.slice(0, 5)).toEqual(Array(5).fill('not_counted'));
    expect(res[5]).toBe('rate_limited');
  });
});

describe('TOTP — mismo criterio', () => {
  it('no_totp (doc sin totpSecret) no incrementa failStreak', async () => {
    const e = env();
    await seedLegacyPassword(e, 't1', 'pw'); // tiene password, NO totp
    for (let i = 0; i < 6; i++) {
      expect(await attempt(e, 't1', 'verifyTotpGate', '123456')).toBe('not_counted');
      e.t += 2 * MIN;
    }
    expect(streak(e, 't1', 'verifyTotpGate')).toBe(0);
    expect((await verifyTotpCore(deps(e), 't1', '123456')).reason).toBe('no_totp');
  });

  it('no_secret en TOTP (sin doc) no incrementa failStreak', async () => {
    const e = env();
    for (let i = 0; i < 6; i++) {
      expect(await attempt(e, 't2', 'verifyTotpGate', '123456')).toBe('not_counted');
      e.t += 2 * MIN;
    }
    expect(streak(e, 't2', 'verifyTotpGate')).toBe(0);
  });

  it('formato inválido no cuenta; TOTP realmente incorrecto SÍ incrementa y bloquea a los 5', async () => {
    const e = env();
    await e.db
      .collection('auth_secrets')
      .doc('t3')
      .set({ totpSecret: 'SECRETO', totpLastStep: -1 });
    expect(await attempt(e, 't3', 'verifyTotpGate', '12ab')).toBe('not_counted');
    expect(streak(e, 't3', 'verifyTotpGate')).toBe(0);
    e.t += 2 * MIN;
    const good = totpCodeAt('SECRETO', curStep(e));
    const bad = good === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(await attempt(e, 't3', 'verifyTotpGate', bad)).toBe('failure');
      e.t += 2 * MIN;
    }
    expect(streak(e, 't3', 'verifyTotpGate')).toBe(5);
    expect(lockedUntil(e, 't3', 'verifyTotpGate')).toBeTruthy();
  });

  it('TOTP correcto autentica y resetea el streak', async () => {
    const e = env();
    await e.db
      .collection('auth_secrets')
      .doc('t4')
      .set({ totpSecret: 'SECRETO', totpLastStep: -1 });
    const good0 = totpCodeAt('SECRETO', curStep(e));
    await attempt(e, 't4', 'verifyTotpGate', good0 === '999999' ? '999998' : '999999');
    expect(streak(e, 't4', 'verifyTotpGate')).toBe(1);
    e.t += 2 * MIN;
    expect(await attempt(e, 't4', 'verifyTotpGate', totpCodeAt('SECRETO', curStep(e)))).toBe(
      'success'
    );
    expect(streak(e, 't4', 'verifyTotpGate')).toBe(0);
  });
});

describe('recordAuthGateResult — no escribe nada para estados no contables', () => {
  it('not_counted no crea ni modifica rate_limits', async () => {
    const e = env();
    const rec = await recordAuthGateResult(deps(e), 'n1', 'verifyPasswordGate', {
      ok: false,
      reason: 'no_secret',
    });
    expect(rec).toEqual({ outcome: 'not_counted', recorded: false });
    expect(e.store.has('rate_limits/n1')).toBe(false);
  });
});

describe('Contrato con el wrapper real (functions/index.js)', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const SRC = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
  const body = (name) => {
    const i = SRC.indexOf(`export const ${name} = onCall(`);
    const j = SRC.indexOf('\nexport const ', i + 1);
    return SRC.slice(i, j > i ? j : undefined);
  };
  it('verifyPasswordGate y verifyTotpGate registran vía recordAuthGateResult, nunca con r.ok directo', () => {
    for (const n of ['verifyPasswordGate', 'verifyTotpGate']) {
      const b = body(n);
      expect(b).toMatch(new RegExp(`recordAuthGateResult\\(deps, uid, '${n}', r\\)`));
      expect(b).not.toMatch(/registerAuthGateOutcome/);
      // El contrato público sigue siendo { ok } y el ok sale de la clasificación.
      expect(b).toMatch(/return \{ ok: rec\.outcome === 'success' \}/);
    }
  });
  it('ninguna otra ruta del repo llama registerAuthGateOutcome (única ruta = recordAuthGateResult)', () => {
    const calls = (SRC.match(/registerAuthGateOutcome\(/g) || []).length;
    expect(calls).toBe(0);
  });
});
