// R01 Fase 1 (v1557-dev 2026-11-17) — Emulator test de CONCURRENCIA REAL
// para el lock atómico `revision_waitlist_locks/{cardCode}` que garantiza
// §42 (a lo sumo 1 waitlist abierta por cardCode).
//
// Gating: la suite SOLO se registra con FIRESTORE_EMULATOR_HOST o
// REQUIRE_EMULATOR=1. Sin eso, se saltea sin fallar (mismo pattern que
// d8-emulator-ampliado.test.js).
//
// Levantar el emulator antes de correr:
//   firebase emulators:exec --only firestore,auth,functions \
//     "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//      npx vitest run tests/functions/waitlist-lock-concurrency.emulator.test.js"
//
// 8 escenarios (T1-T8) cubriendo la invariante lock en concurrencia real:
//
//   T1 — concurrent CREATE: 2 movePedido simultáneos sobre el mismo cardCode
//        sin lock previo → 1 waitlist creada, el otro absorbido (UNIFY).
//   T2 — concurrent UNIFY: 2 movePedido simultáneos sobre cardCode con
//        waitlist existente → ambos convergen al mismo target.
//   T3 — stale lock: lock apunta a waitlist consumed; nuevo movePedido se
//        re-apunta correctamente al nuevo waitlist creado.
//   T4 — unify + move simultáneos: unifyWaitlistsCF corriendo + movePedido
//        mismo cardCode no deja órdenes abiertas N>=2.
//   T5 — pre-existing N>=2: 2 waitlists abiertas pre-§42 + movePedido →
//        absorbed N-1 + target único + lock apunta al target.
//   T6 — idempotencia: segundo call con mismo pedidoId → not-found (ya
//        borrado por el primer tx exitoso).
//   T7 — H3 interleave: 3 waitlists abiertos + 2 CFs concurrentes → final
//        state tiene 1 waitlist abierta.
//   T8 — lock inmutable post-tx: tras un unify fallido (permission denied),
//        el lock no cambió.
//
// Expectativas: TODOS los escenarios garantizan openWaitlists.length <= 1
// por cardCode al final, y `revision_waitlist_locks/{cardCode}.waitlistId`
// apunta al único abierto (o null si no hay ninguno).

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { movePedidoToWaitlistCore } from '../../functions/core/move-pedido-to-waitlist-core.js';
import { unifyWaitlistsCore } from '../../functions/core/unify-waitlists-core.js';

const _require = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../functions/package.json')
);
const { initializeApp, deleteApp } = _require('firebase-admin/app');
const { getFirestore } = _require('firebase-admin/firestore');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const REQUIRE = process.env.REQUIRE_EMULATOR === '1';
const emulatorAvailable = Boolean(EMU || REQUIRE);

let app;
let db;
let appIdx = 0;

function nextCardCode(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function seedPedido(db, id, overrides) {
  await db
    .collection('pedidos')
    .doc(id)
    .set({
      stage: 'pending',
      ownerUid: 'uid-admin',
      assignedVendorUid: 'uid-vde',
      ownerEmail: 'admin@shimano.com.ar',
      clientName: 'EMU CLIENT',
      clientCardCode: 'C-EMU',
      lines: [{ sku: 'EMU-A', code: 'EMU-A', qty: 1, precio: 100 }],
      transferidoSAP: null,
      ...overrides,
    });
}

async function seedWaitlist(db, id, overrides) {
  await db
    .collection('revision_waitlist')
    .doc(id)
    .set({
      clientCardCode: 'C-EMU',
      ownerUid: 'uid-admin',
      assignedVendorUid: 'uid-vde',
      stage: 'active',
      closedAt: null,
      createdAt: '2026-11-15T00:00:00Z',
      items: [{ code: 'WL-A', qty: 1, qtyOpen: 1, precio: 50 }],
      ...overrides,
    });
}

async function seedRole(db, uid, role) {
  await db.collection('roles').doc(uid).set({ role });
}

async function getOpenWaitlists(db, cardCode) {
  const qs = await db.collection('revision_waitlist').where('clientCardCode', '==', cardCode).get();
  const out = [];
  qs.forEach((d) => {
    const data = d.data();
    if (data.closedAt) return;
    if (data.stage === 'consumed') return;
    out.push({ id: d.id, data });
  });
  return out;
}

async function getLock(db, cardCode) {
  const snap = await db.collection('revision_waitlist_locks').doc(cardCode).get();
  return snap.exists ? snap.data() : null;
}

// Guard registrado siempre.
describe('waitlist-lock-concurrency — gating', () => {
  it('suite ejecuta solo con FIRESTORE_EMULATOR_HOST o REQUIRE_EMULATOR=1', () => {
    expect(typeof emulatorAvailable).toBe('boolean');
  });
});

if (emulatorAvailable)
  describe('R01 Fase 1 — lock concurrency real (T1-T8)', () => {
    beforeAll(() => {
      app = initializeApp({ projectId: 'demo-r01-fase1' }, 'r01-' + Date.now() + '-' + ++appIdx);
      db = getFirestore(app);
    });
    afterAll(async () => {
      if (app) await deleteApp(app);
    });

    beforeEach(async () => {
      await seedRole(db, 'uid-admin', 'admin');
    });

    it('T1 — concurrent CREATE sobre mismo cardCode: 1 sola abierta al final', {
      timeout: 20000,
    }, async () => {
      const cc = nextCardCode('T1');
      await seedPedido(db, 'T1-ped1', { clientCardCode: cc });
      await seedPedido(db, 'T1-ped2', { clientCardCode: cc });

      // 2 CFs concurrentes.
      const results = await Promise.allSettled([
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T1-ped1' }
        ),
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T1-ped2' }
        ),
      ]);

      // Al menos uno tiene que haber tenido éxito.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const open = await getOpenWaitlists(db, cc);
      expect(open.length).toBe(1);

      const lock = await getLock(db, cc);
      expect(lock).toBeTruthy();
      expect(lock.waitlistId).toBe(open[0].id);
    });

    it('T2 — concurrent UNIFY contra waitlist existente: convergen al mismo target', {
      timeout: 20000,
    }, async () => {
      const cc = nextCardCode('T2');
      await seedWaitlist(db, 'T2-wl', { clientCardCode: cc });
      // Seed lock para que ambas CFs encuentren el candidato por lock.
      await db.collection('revision_waitlist_locks').doc(cc).set({
        cardCode: cc,
        waitlistId: 'T2-wl',
        _version: 1,
        lastOperation: 'create',
        updatedAt: new Date().toISOString(),
        updatedBy: 'uid-seed',
      });
      await seedPedido(db, 'T2-ped1', { clientCardCode: cc });
      await seedPedido(db, 'T2-ped2', { clientCardCode: cc });

      const results = await Promise.allSettled([
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T2-ped1' }
        ),
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T2-ped2' }
        ),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const open = await getOpenWaitlists(db, cc);
      expect(open.length).toBe(1);
      expect(open[0].id).toBe('T2-wl');
      const lock = await getLock(db, cc);
      expect(lock.waitlistId).toBe('T2-wl');
    });

    it('T3 — stale lock (apunta a consumed): próximo move re-apunta correctamente', async () => {
      const cc = nextCardCode('T3');
      await seedWaitlist(db, 'T3-wl-stale', {
        clientCardCode: cc,
        stage: 'consumed',
        closedAt: '2026-11-16T10:00:00Z',
      });
      await db.collection('revision_waitlist_locks').doc(cc).set({
        cardCode: cc,
        waitlistId: 'T3-wl-stale',
        _version: 1,
        lastOperation: 'create',
        updatedAt: '2026-11-16T10:00:00Z',
        updatedBy: 'uid-seed',
      });
      await seedPedido(db, 'T3-ped', { clientCardCode: cc });

      const r = await movePedidoToWaitlistCore(
        { fbDb: db, now: () => Date.now() },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T3-ped' }
      );
      expect(r.unified).toBe(false);
      expect(r.newWaitlistId).toBeTruthy();

      const open = await getOpenWaitlists(db, cc);
      expect(open.length).toBe(1);
      expect(open[0].id).toBe(r.newWaitlistId);
      const lock = await getLock(db, cc);
      expect(lock.waitlistId).toBe(r.newWaitlistId);
      expect(lock.waitlistId).not.toBe('T3-wl-stale');
    });

    it('T4 — unify + move concurrentes: no deja N>=2 abiertas', { timeout: 20000 }, async () => {
      const cc = nextCardCode('T4');
      await seedWaitlist(db, 'T4-wl-a', { clientCardCode: cc });
      await seedWaitlist(db, 'T4-wl-b', { clientCardCode: cc });
      await seedPedido(db, 'T4-ped', { clientCardCode: cc });

      const results = await Promise.allSettled([
        unifyWaitlistsCore(
          { fbDb: db, now: () => Date.now() },
          {
            auth: { uid: 'uid-admin', token: {} },
            targetWaitlistId: 'T4-wl-a',
            absorbedWaitlistIds: ['T4-wl-b'],
          }
        ),
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T4-ped' }
        ),
      ]);
      // Al menos 1 tiene éxito (el otro puede chocar).
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const open = await getOpenWaitlists(db, cc);
      expect(open.length).toBe(1);
    });

    it('T5 — pre-existing N>=2 sin lock + moveNew: absorbe N-1', async () => {
      const cc = nextCardCode('T5');
      await seedWaitlist(db, 'T5-wl-old', {
        clientCardCode: cc,
        createdAt: '2026-11-10T00:00:00Z',
      });
      await seedWaitlist(db, 'T5-wl-newer', {
        clientCardCode: cc,
        createdAt: '2026-11-16T00:00:00Z',
      });
      await seedPedido(db, 'T5-ped', { clientCardCode: cc });

      const r = await movePedidoToWaitlistCore(
        { fbDb: db, now: () => Date.now() },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T5-ped' }
      );
      expect(r.unified).toBe(true);
      expect(r.absorbedWaitlistIds.length).toBeGreaterThanOrEqual(1);
      const open = await getOpenWaitlists(db, cc);
      expect(open.length).toBe(1);
    });

    it('T6 — idempotencia: segundo call con pedidoId ya borrado → not-found', async () => {
      const cc = nextCardCode('T6');
      await seedPedido(db, 'T6-ped', { clientCardCode: cc });
      const r1 = await movePedidoToWaitlistCore(
        { fbDb: db, now: () => Date.now() },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T6-ped' }
      );
      expect(r1.ok).toBe(true);
      // Segundo call: pedido ya fue borrado.
      await expect(
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T6-ped' }
        )
      ).rejects.toMatchObject({ _errorCode: 'not-found' });
    });

    it('T7 — 3 waitlists + 2 CFs concurrentes: final state = 1 abierta', {
      timeout: 30000,
    }, async () => {
      const cc = nextCardCode('T7');
      await seedWaitlist(db, 'T7-wl-a', {
        clientCardCode: cc,
        createdAt: '2026-11-10T00:00:00Z',
      });
      await seedWaitlist(db, 'T7-wl-b', {
        clientCardCode: cc,
        createdAt: '2026-11-11T00:00:00Z',
      });
      await seedWaitlist(db, 'T7-wl-c', {
        clientCardCode: cc,
        createdAt: '2026-11-12T00:00:00Z',
      });
      await seedPedido(db, 'T7-ped1', { clientCardCode: cc });
      await seedPedido(db, 'T7-ped2', { clientCardCode: cc });

      const results = await Promise.allSettled([
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T7-ped1' }
        ),
        movePedidoToWaitlistCore(
          { fbDb: db, now: () => Date.now() },
          { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'T7-ped2' }
        ),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const open = await getOpenWaitlists(db, cc);
      expect(open.length).toBe(1);
    });

    it('T8 — unify que falla por permission-denied: lock NO cambia', async () => {
      const cc = nextCardCode('T8');
      await seedRole(db, 'uid-vde-ajeno', 'vendedor');
      await seedWaitlist(db, 'T8-wl-t', {
        clientCardCode: cc,
        ownerUid: 'uid-otro',
        assignedVendorUid: 'uid-otro',
      });
      await seedWaitlist(db, 'T8-wl-a', {
        clientCardCode: cc,
        ownerUid: 'uid-otro',
        assignedVendorUid: 'uid-otro',
      });
      await db.collection('revision_waitlist_locks').doc(cc).set({
        cardCode: cc,
        waitlistId: 'T8-wl-t',
        _version: 1,
        lastOperation: 'create',
        updatedAt: '2026-11-15T00:00:00Z',
        updatedBy: 'uid-seed',
      });

      await expect(
        unifyWaitlistsCore(
          { fbDb: db, now: () => Date.now() },
          {
            auth: { uid: 'uid-vde-ajeno', token: {} },
            targetWaitlistId: 'T8-wl-t',
            absorbedWaitlistIds: ['T8-wl-a'],
          }
        )
      ).rejects.toMatchObject({ _errorCode: 'permission-denied' });

      const lock = await getLock(db, cc);
      expect(lock.waitlistId).toBe('T8-wl-t');
      expect(lock.updatedBy).toBe('uid-seed');
    });
  });
