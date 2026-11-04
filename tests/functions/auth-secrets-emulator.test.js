// S04b PR-A — test de INTEGRACION contra el emulador Firestore real
// (firebase-admin apuntando a FIRESTORE_EMULATOR_HOST). Ejercita transacciones
// reales: anti-replay atomico de TOTP + dual-write auth_secrets/roles.
//
// Si el emulador no esta disponible, se skippea (no rompe la suite). Con
// REQUIRE_EMULATOR=1 falla si no esta (evidencia real en CI dedicado).

import {
  scrypt as _scryptCb,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setPasswordCore,
  setTotpCore,
  verifyPasswordCore,
  verifyTotpCore,
} from '../../functions/core/auth-secrets-core.js';

// firebase-admin vive en functions/node_modules (no en el root): resolver desde ahi.
const _require = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../functions/package.json')
);
const { initializeApp, deleteApp } = _require('firebase-admin/app');
const { getFirestore, FieldValue } = _require('firebase-admin/firestore');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const REQUIRE = process.env.REQUIRE_EMULATOR === '1';
const run = EMU ? describe : REQUIRE ? describe : describe.skip;

function scryptAsync(p, s, k, o) {
  return new Promise((res, rej) => _scryptCb(p, s, k, o, (e, dk) => (e ? rej(e) : res(dk))));
}
function b32d(input) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const c = String(input).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0,
    value = 0;
  const out = [];
  for (const ch of c) {
    const i = A.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpCodeAt(secret, step) {
  const key = b32d(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const h = createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const code =
    ((h[off] & 0x7f) << 24) |
    ((h[off + 1] & 0xff) << 16) |
    ((h[off + 2] & 0xff) << 8) |
    (h[off + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

let app, db;
beforeAll(() => {
  if (!EMU) return;
  app = initializeApp({ projectId: 'demo-s04b' }, 's04b-' + Date.now());
  db = getFirestore(app);
});
afterAll(async () => {
  if (app) await deleteApp(app);
});

function deps(now = () => new Date()) {
  return {
    fbDb: db,
    now,
    log: () => {},
    scryptAsync,
    sha256Hex: async (s) => createHash('sha256').update(String(s)).digest('hex'),
    randomBytesHex: (n) => randomBytes(n).toString('hex'),
    timingSafeEqualHex: (a, b) => {
      try {
        const x = Buffer.from(a, 'hex'),
          y = Buffer.from(b, 'hex');
        return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
      } catch {
        return false;
      }
    },
    totpCodeAt,
  };
}

run('integracion emulador: dual-write + anti-replay', () => {
  beforeEach(async () => {
    if (!db) return;
    // limpiar docs usados
    await db
      .collection('auth_secrets')
      .doc('iu1')
      .delete()
      .catch(() => {});
    await db.collection('roles').doc('iu1').set({ role: 'vendedor', email: 'v@x.com' });
  });

  it('setPasswordCore escribe auth_secrets + roles y verifyPasswordCore valida', async () => {
    await setPasswordCore(deps(), { targetUid: 'iu1', password: 'Integr#123' });
    const as = (await db.collection('auth_secrets').doc('iu1').get()).data();
    const roles = (await db.collection('roles').doc('iu1').get()).data();
    expect(as.pwVersion).toBe('scrypt-v2');
    expect(roles.passwordHash).toBeTruthy();
    expect(roles.role).toBe('vendedor');
    expect((await verifyPasswordCore(deps(), 'iu1', 'Integr#123')).ok).toBe(true);
    expect((await verifyPasswordCore(deps(), 'iu1', 'mal')).ok).toBe(false);
  });

  it('anti-replay: dos verificaciones concurrentes del mismo codigo -> solo una ok', async () => {
    const SECRET = 'JBSWY3DPEHPK3PXP';
    await setTotpCore(deps(), { targetUid: 'iu1', secretBase32: SECRET, enabledBy: 'a@x' });
    const nowMs = Date.now();
    const step = Math.floor(nowMs / 1000 / 30);
    const code = totpCodeAt(SECRET, step);
    const d = deps(() => new Date(nowMs));
    // dos en paralelo: las transacciones de Firestore deben serializar y solo
    // una debe consumir el step.
    const [r1, r2] = await Promise.all([
      verifyTotpCore(d, 'iu1', code),
      verifyTotpCore(d, 'iu1', code),
    ]);
    const oks = [r1.ok, r2.ok].filter(Boolean).length;
    expect(oks).toBe(1); // exactamente una aceptada (anti-replay atomico)
  });
});
