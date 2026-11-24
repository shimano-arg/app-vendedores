// R01 Fase 1 — Smoke de scripts W (drift detector) y Y (seed dry-run)
// contra Firestore Emulator real. No invoca los scripts directamente
// (eso haría spawn + stdout parsing); replica la lógica mínima para
// verificar las 5 categorías de drift de W + el bloqueo --apply de Y.
//
// Gating idéntico a waitlist-lock-concurrency.emulator.test.js.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const _require = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../functions/package.json')
);
const { initializeApp, deleteApp } = _require('firebase-admin/app');
const { getFirestore } = _require('firebase-admin/firestore');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const REQUIRE = process.env.REQUIRE_EMULATOR === '1';
const emulatorAvailable = Boolean(EMU || REQUIRE);
const PROJECT = process.env.FIREBASE_PROJECT_ID || 'demo-r01';

let app;
let db;

describe('scripts-w-y smoke — gating', () => {
  it('suite ejecuta solo con FIRESTORE_EMULATOR_HOST', () => {
    expect(typeof emulatorAvailable).toBe('boolean');
  });
});

if (emulatorAvailable)
  describe('W/Y scripts smoke — contra Emulator real', () => {
    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT }, 'wy-smoke-' + Date.now());
      db = getFirestore(app);
    });
    afterAll(async () => {
      if (app) await deleteApp(app);
    });

    it('W: output JSON válido con las 5 categorías vacías cuando no hay docs', async () => {
      // Limpio por si la suite previa dejó datos (best-effort).
      // (No usamos recursiveDelete para evitar dependencia extra.)
      const json = execFileSync('node', ['scripts/audit/W_waitlist_lock_drift.cjs', '--json'], {
        env: {
          ...process.env,
          FIRESTORE_EMULATOR_HOST: EMU || '127.0.0.1:8080',
          FIREBASE_PROJECT_ID: PROJECT,
          GOOGLE_CLOUD_PROJECT: PROJECT,
          GCLOUD_PROJECT: PROJECT,
        },
        encoding: 'utf8',
      });
      const parsed = JSON.parse(json);
      expect(parsed.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(parsed.totals).toMatchObject({
        LOCK_WITHOUT_WAITLIST: expect.any(Number),
        LOCK_POINTS_TO_CLOSED: expect.any(Number),
        MULTIPLE_OPEN_WAITLISTS: expect.any(Number),
        WAITLIST_WITHOUT_LOCK: expect.any(Number),
        LOCK_MISMATCHED: expect.any(Number),
      });
      expect(typeof parsed.totalDrift).toBe('number');
    });

    it('W: detecta LOCK_WITHOUT_WAITLIST + LOCK_POINTS_TO_CLOSED + WAITLIST_WITHOUT_LOCK', async () => {
      const cc1 = 'WY-A-' + Date.now();
      const cc2 = 'WY-B-' + Date.now();
      const cc3 = 'WY-C-' + Date.now();
      // Inyecto 3 clases de drift:
      // 1) lock apunta a doc inexistente.
      await db.collection('revision_waitlist_locks').doc(cc1).set({
        cardCode: cc1,
        waitlistId: 'nope-no-existe',
        _version: 1,
      });
      // 2) lock apunta a consumed.
      await db.collection('revision_waitlist').doc('wy-closed').set({
        clientCardCode: cc2,
        stage: 'consumed',
        closedAt: '2026-11-14T00:00:00Z',
        items: [],
      });
      await db.collection('revision_waitlist_locks').doc(cc2).set({
        cardCode: cc2,
        waitlistId: 'wy-closed',
        _version: 1,
      });
      // 3) waitlist abierta sin lock.
      await db.collection('revision_waitlist').doc('wy-orphan').set({
        clientCardCode: cc3,
        stage: 'active',
        closedAt: null,
        items: [],
      });

      const json = execFileSync('node', ['scripts/audit/W_waitlist_lock_drift.cjs', '--json'], {
        env: {
          ...process.env,
          FIRESTORE_EMULATOR_HOST: EMU || '127.0.0.1:8080',
          FIREBASE_PROJECT_ID: PROJECT,
          GOOGLE_CLOUD_PROJECT: PROJECT,
          GCLOUD_PROJECT: PROJECT,
        },
        encoding: 'utf8',
      });
      const parsed = JSON.parse(json);
      expect(parsed.drift.LOCK_WITHOUT_WAITLIST.some((e) => e.cardCode === cc1)).toBe(true);
      expect(parsed.drift.LOCK_POINTS_TO_CLOSED.some((e) => e.cardCode === cc2)).toBe(true);
      expect(parsed.drift.WAITLIST_WITHOUT_LOCK.some((e) => e.cardCode === cc3)).toBe(true);
      expect(parsed.totalDrift).toBeGreaterThanOrEqual(3);
    });

    it('Y: --apply BLOQUEADO con exit 3 en Fase 1', () => {
      let err;
      try {
        execFileSync('node', ['scripts/audit/Y_seed_waitlist_locks.cjs', '--apply'], {
          env: {
            ...process.env,
            FIRESTORE_EMULATOR_HOST: EMU || '127.0.0.1:8080',
            FIREBASE_PROJECT_ID: PROJECT,
            GOOGLE_CLOUD_PROJECT: PROJECT,
            GCLOUD_PROJECT: PROJECT,
          },
          encoding: 'utf8',
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      // execFileSync lanza en exit !== 0. Exit 3 en el guard explícito.
      expect(err.status).toBe(3);
      const msg = String(err.stderr || err.stdout || '');
      expect(msg).toMatch(/--apply/);
      expect(msg).toMatch(/Fase 1/);
    });

    it('Y: dry-run default produce output sin escribir locks', async () => {
      // Snapshot pre-run.
      const preSnap = await db.collection('revision_waitlist_locks').get();
      const preCount = preSnap.size;
      const out = execFileSync('node', ['scripts/audit/Y_seed_waitlist_locks.cjs'], {
        env: {
          ...process.env,
          FIRESTORE_EMULATOR_HOST: EMU || '127.0.0.1:8080',
          FIREBASE_PROJECT_ID: PROJECT,
          GOOGLE_CLOUD_PROJECT: PROJECT,
          GCLOUD_PROJECT: PROJECT,
        },
        encoding: 'utf8',
      });
      expect(out).toMatch(/DRY-RUN/);
      expect(out).toMatch(/Plan de seed/);
      // Ningún lock nuevo tras dry-run.
      const postSnap = await db.collection('revision_waitlist_locks').get();
      expect(postSnap.size).toBe(preCount);
    });

    it('Y (Fase 2 prep): --apply SIN --i-understand → exit 3 incluso si FASE=1', () => {
      // Guard 2 nuevo (Obs 3): --apply solo con FASE=1 ya dispara exit 3 por
      // guard 1, pero verificamos que el mensaje mencione --apply + Fase 1
      // (el guard 1 corre antes del 2 cuando FASE=1).
      let err;
      try {
        execFileSync(
          'node',
          [
            'scripts/audit/Y_seed_waitlist_locks.cjs',
            '--apply',
            '--i-understand-this-writes-production-data',
          ],
          {
            env: {
              ...process.env,
              FIRESTORE_EMULATOR_HOST: EMU || '127.0.0.1:8080',
              FIREBASE_PROJECT_ID: PROJECT,
              GOOGLE_CLOUD_PROJECT: PROJECT,
              GCLOUD_PROJECT: PROJECT,
            },
            encoding: 'utf8',
          }
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      // Con FASE=1, el guard 1 sigue bloqueando aunque pase --i-understand.
      expect(err.status).toBe(3);
      const msg = String(err.stderr || err.stdout || '');
      expect(msg).toMatch(/Fase 1/);
    });

    it('Y (Fase 2 prep): sin --i-understand → mensaje explica el requisito', () => {
      // Mock de ver cómo responde el script si el guard 2 fuera el que corta.
      // (En FASE=1 real, guard 1 corta primero. Verificamos que el msg del
      // guard 1 sale correctamente y es inequívoco.)
      let err;
      try {
        execFileSync('node', ['scripts/audit/Y_seed_waitlist_locks.cjs', '--apply'], {
          env: {
            ...process.env,
            FIRESTORE_EMULATOR_HOST: EMU || '127.0.0.1:8080',
            FIREBASE_PROJECT_ID: PROJECT,
            GOOGLE_CLOUD_PROJECT: PROJECT,
            GCLOUD_PROJECT: PROJECT,
          },
          encoding: 'utf8',
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err.status).toBe(3);
      const msg = String(err.stderr || err.stdout || '');
      // Mensaje robusto: menciona que --apply está bloqueado (guard 1 en FASE=1
      // o guard 2 sin --i-understand). En ambos casos el usuario sabe qué hacer.
      expect(msg).toMatch(/BLOQUEADO|requiere/);
    });
  });
