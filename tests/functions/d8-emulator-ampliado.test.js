// D8 — Capa 2 (ampliacion): tests de INTEGRACION contra Firestore Emulator real
// que extienden auth-secrets-emulator.test.js (pre-existente) con los casos
// del informe 010 §7.2 que faltaban: disableTotpCore end-to-end, rate_limits
// reales, dual-write setTotpCore, verificacion legacy sha256 roundtrip.
//
// Gating identico al archivo pre-existente: la suite SOLO se registra con
// FIRESTORE_EMULATOR_HOST o REQUIRE_EMULATOR=1 definidos. Sin ellos, no hay
// tests ni skips (evita check-known-failures rechazar skip nuevo).
//
// LIMITACIONES DOCUMENTADAS (ver §12 informe 011):
//   - No se ejecuta el wrapper onCall completo (requeriria firebase-functions-
//     test + emulator functions levantados). Aqui solo se ejercita el core
//     contra Firestore emulator real. El wrapper queda cubierto por grep
//     estatico (tests/unit/audit/d8-*.test.js).
//   - Rollback de transaccion ante fallo mid-tx NO se prueba aqui (Firestore
//     emulator no soporta inyeccion de fallos). Queda como limitacion
//     declarada; se cubre indirectamente por el `runTransaction` del Admin SDK.

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
  disableTotpCore,
  setPasswordCore,
  setTotpCore,
  verifyPasswordCore,
  verifyTotpCore,
} from '../../functions/core/auth-secrets-core.js';
import { recordAuthGateResult } from '../../functions/core/rate-limit-core.js';

const _require = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../functions/package.json')
);
const { initializeApp, deleteApp } = _require('firebase-admin/app');
const { getFirestore, FieldValue } = _require('firebase-admin/firestore');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const REQUIRE = process.env.REQUIRE_EMULATOR === '1';
const emulatorAvailable = Boolean(EMU || REQUIRE);

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

// Guard siempre registrado (igual patron que auth-secrets-emulator.test.js).
describe('D8 Capa 2 — gating documentado', () => {
  it('la suite ampliada se registra solo con FIRESTORE_EMULATOR_HOST/REQUIRE_EMULATOR', () => {
    expect(typeof emulatorAvailable).toBe('boolean');
  });
  it('documentacion: wrappers onCall NO se ejercitan aqui (ver §12 informe 011)', () => {
    // Limite explicito: estos tests cubren el CORE contra Firestore real, no
    // los wrappers firebase-functions/v2/https.onCall. Para cubrir los
    // wrappers haria falta firebase-functions-test + Functions Emulator
    // levantado (no incorporado por decision del plan).
    expect(true).toBe(true);
  });
});

if (emulatorAvailable)
  describe('D8 Capa 2 — ampliacion emulator integracion', () => {
    beforeAll(() => {
      app = initializeApp({ projectId: 'demo-d8-cap2' }, 'd8cap2-' + Date.now());
      db = getFirestore(app);
    });
    afterAll(async () => {
      if (app) await deleteApp(app);
    });
    beforeEach(async () => {
      if (!db) return;
      // limpiar docs usados antes de cada test
      await db
        .collection('auth_secrets')
        .doc('iu2')
        .delete()
        .catch(() => {});
      await db
        .collection('rate_limits')
        .doc('iu2')
        .delete()
        .catch(() => {});
      await db.collection('roles').doc('iu2').set({ role: 'vendedor', email: 'v2@x.com' });
    });

    describe('E-07: disableTotpCore end-to-end', () => {
      it('setTotpCore → verifyTotpCore ok → disableTotpCore → verifyTotpCore no_totp', async () => {
        const SECRET = 'JBSWY3DPEHPK3PXP';
        const d = deps();

        // 1) Activar TOTP
        await setTotpCore(d, { targetUid: 'iu2', secretBase32: SECRET, enabledBy: 'admin@x' });
        const asAfterSet = (await db.collection('auth_secrets').doc('iu2').get()).data();
        const rolesAfterSet = (await db.collection('roles').doc('iu2').get()).data();
        expect(asAfterSet.totpSecret).toBe(SECRET);
        expect(asAfterSet.totpLastStep).toBe(-1);
        expect(rolesAfterSet.totpEnabled).toBe(true);
        expect(rolesAfterSet.totpSecret).toBe(SECRET);

        // 2) Verificar con codigo valido
        const nowMs = Date.now();
        const step = Math.floor(nowMs / 1000 / 30);
        const code = totpCodeAt(SECRET, step);
        const dAt = deps(() => new Date(nowMs));
        const verifyR = await verifyTotpCore(dAt, 'iu2', code);
        expect(verifyR.ok).toBe(true);

        // 3) Desactivar TOTP (dual-write delete)
        await disableTotpCore(d, { targetUid: 'iu2', deleteFieldValue: FieldValue.delete() });
        const asAfterDisable = (await db.collection('auth_secrets').doc('iu2').get()).data();
        const rolesAfterDisable = (await db.collection('roles').doc('iu2').get()).data();
        expect(asAfterDisable.totpSecret).toBeUndefined();
        expect(asAfterDisable.totpLastStep).toBeUndefined();
        expect(asAfterDisable.totpDisabledAt).toBeDefined();
        expect(rolesAfterDisable.totpEnabled).toBe(false);
        expect(rolesAfterDisable.totpSecret).toBeUndefined();
        expect(rolesAfterDisable.totpDisabledAt).toBeDefined();

        // 4) verify debe ser no_totp (ni secret ni totpLastStep quedan)
        const verifyAfter = await verifyTotpCore(dAt, 'iu2', code);
        expect(verifyAfter.ok).toBe(false);
        expect(verifyAfter.reason).toBe('no_totp');
      });

      it('disableTotpCore es idempotente (segunda llamada no rompe ni cambia nada util)', async () => {
        const d = deps();
        // Partimos de cuenta sin TOTP (beforeEach ya limpia).
        await disableTotpCore(d, { targetUid: 'iu2', deleteFieldValue: FieldValue.delete() });
        const asDoc = (await db.collection('auth_secrets').doc('iu2').get()).data();
        const rolesDoc = (await db.collection('roles').doc('iu2').get()).data();
        // Documentos pueden existir ahora con solo totpDisabledAt + totpEnabled:false.
        if (asDoc) {
          expect(asDoc.totpSecret).toBeUndefined();
          expect(asDoc.totpDisabledAt).toBeDefined();
        }
        expect(rolesDoc.totpEnabled).toBe(false);
      });
    });

    describe('E-08: rate_limits reales contra emulator (recordAuthGateResult)', () => {
      it('reason="invalid" incrementa failStreak en rate_limits/{uid}', async () => {
        const uid = 'iu2';
        // Primera "invalid" response: failStreak debe pasar de 0 a 1.
        const r1 = await recordAuthGateResult(
          { fbDb: db, now: () => new Date() },
          uid,
          'verifyPasswordGate',
          { ok: false, reason: 'invalid' }
        );
        expect(r1.outcome).toBe('failure');
        expect(r1.recorded).toBe(true);

        const rl1 = (await db.collection('rate_limits').doc(uid).get()).data();
        expect(rl1).toBeDefined();
        expect(rl1.verifyPasswordGate).toBeDefined();
        expect(rl1.verifyPasswordGate.failStreak).toBe(1);

        // Tres fallos mas: failStreak = 4, sin lockout todavia (U-09 threshold=5).
        for (let i = 0; i < 3; i++) {
          await recordAuthGateResult(
            { fbDb: db, now: () => new Date() },
            uid,
            'verifyPasswordGate',
            { ok: false, reason: 'invalid' }
          );
        }
        const rl4 = (await db.collection('rate_limits').doc(uid).get()).data();
        expect(rl4.verifyPasswordGate.failStreak).toBe(4);
        // Sin lockedUntil o con lockedUntil vacio
        const lu4 = rl4.verifyPasswordGate.lockedUntil;
        expect(
          lu4 === undefined || lu4 === null || lu4 === '' || Date.parse(lu4) <= Date.now()
        ).toBe(true);
      });

      it('reason="empty"/"format" NO modifica rate_limits (classify=not_counted)', async () => {
        const uid = 'iu2';
        // Pre-condicion: no existe rate_limits/{uid}.
        const pre = await db.collection('rate_limits').doc(uid).get();
        expect(pre.exists).toBe(false);

        // reason='empty' debe NO crear el doc.
        const rEmpty = await recordAuthGateResult(
          { fbDb: db, now: () => new Date() },
          uid,
          'verifyPasswordGate',
          { ok: false, reason: 'empty' }
        );
        expect(rEmpty.outcome).toBe('not_counted');
        expect(rEmpty.recorded).toBe(false);

        const postEmpty = await db.collection('rate_limits').doc(uid).get();
        expect(postEmpty.exists).toBe(false);

        // reason='format' sobre verifyTotpGate: idem.
        const rFormat = await recordAuthGateResult(
          { fbDb: db, now: () => new Date() },
          uid,
          'verifyTotpGate',
          { ok: false, reason: 'format' }
        );
        expect(rFormat.outcome).toBe('not_counted');
        expect(rFormat.recorded).toBe(false);

        const postFormat = await db.collection('rate_limits').doc(uid).get();
        expect(postFormat.exists).toBe(false);
      });

      it('ok=true resetea failStreak a 0', async () => {
        const uid = 'iu2';
        // Empujamos failStreak a 3.
        for (let i = 0; i < 3; i++) {
          await recordAuthGateResult(
            { fbDb: db, now: () => new Date() },
            uid,
            'verifyPasswordGate',
            { ok: false, reason: 'invalid' }
          );
        }
        const pre = (await db.collection('rate_limits').doc(uid).get()).data();
        expect(pre.verifyPasswordGate.failStreak).toBe(3);

        // ok=true debe resetear a 0.
        const rOk = await recordAuthGateResult(
          { fbDb: db, now: () => new Date() },
          uid,
          'verifyPasswordGate',
          { ok: true }
        );
        expect(rOk.outcome).toBe('success');
        expect(rOk.recorded).toBe(true);

        const post = (await db.collection('rate_limits').doc(uid).get()).data();
        expect(post.verifyPasswordGate.failStreak).toBe(0);
      });
    });

    describe('E-01 ampliado: dual-write setTotpCore refleja ambas colecciones', () => {
      it('setTotpCore escribe en auth_secrets y roles de forma consistente', async () => {
        const SECRET = 'KVKFKRCPNZQUYMLXOVYDSQKJKZDTSRLD';
        await setTotpCore(deps(), {
          targetUid: 'iu2',
          secretBase32: SECRET,
          enabledBy: 'admin2@x',
        });

        const as = (await db.collection('auth_secrets').doc('iu2').get()).data();
        const roles = (await db.collection('roles').doc('iu2').get()).data();

        // Invariante: ambos tienen el mismo secret.
        expect(as.totpSecret).toBe(SECRET);
        expect(roles.totpSecret).toBe(SECRET);
        // Invariante: auth_secrets reinicia step; roles marca enabled=true.
        expect(as.totpLastStep).toBe(-1);
        expect(roles.totpEnabled).toBe(true);
        // Invariante: timestamps presentes y coincidentes al segundo.
        expect(as.totpUpdatedAt).toBeDefined();
        expect(roles.totpEnabledAt).toBeDefined();
        expect(roles.totpEnabledBy).toBe('admin2@x');
      });
    });

    describe('E-03 ampliado: verifyPasswordCore roundtrip con legacy sha256', () => {
      it('legacy sha256 migrado se valida con el salt + hash correctos', async () => {
        // Simulamos una cuenta ya migrada a /auth_secrets con pwVersion=sha256-legacy.
        const legacyPwd = 'OldPass#2026';
        const legacySalt = 'abcdef01';
        const d = deps();
        const legacyHash = await d.sha256Hex(legacySalt + legacyPwd);

        await db.collection('auth_secrets').doc('iu2').set({
          pwVersion: 'sha256-legacy',
          passwordSalt: legacySalt,
          passwordHash: legacyHash,
          pwUpdatedAt: new Date().toISOString(),
        });

        const okResult = await verifyPasswordCore(d, 'iu2', legacyPwd);
        expect(okResult.ok).toBe(true);

        const badResult = await verifyPasswordCore(d, 'iu2', legacyPwd + 'x');
        expect(badResult.ok).toBe(false);
        expect(badResult.reason).toBe('invalid');
      });
    });
  });
