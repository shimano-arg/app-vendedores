/**
 * P2-A.a T7+T8 — Anónimo y cuenta sin rol intentan acceder.
 *
 * T7: login anónimo (unauthenticated) lee /roles → DENIED
 * T8: cuenta sin rol (role='unassigned') intenta crear/confirmar pedido → DENIED
 *
 * S-7 / 2026-11-25
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CARD_CODE_GONZALO, seedAllRoles, TEST_SKU } from './fixtures/seed-roles.js';
import {
  anonDb,
  assertFails,
  authedDb,
  cleanupTestEnv,
  clearTestEnv,
  collection,
  doc,
  emulatorUnavailable,
  getDoc,
  getDocs,
  initTestEnv,
  seedDoc,
  setDoc,
  UID,
} from './lib/setup-emulator.js';

beforeAll(async () => {
  await initTestEnv();
});
afterAll(async () => {
  await cleanupTestEnv();
});
beforeEach(async () => {
  await clearTestEnv();
  await seedAllRoles();
  // Seed un pedido para intentar confirmarlo.
  await seedDoc('pedidos/e2e-t8-ped-existente', {
    ownerUid: UID.vdeGonzalo,
    assignedVendorUid: UID.vdeGonzalo,
    clientCardCode: CARD_CODE_GONZALO,
    stage: 'pending',
    createdAt: new Date().toISOString(),
    lines: [{ code: TEST_SKU, qty: 1, state: 'pending', qtyOpen: 1, precio: 100 }],
  });
});

describe('T7 — anónimo intenta leer /roles → DENIED', () => {
  it.skipIf(emulatorUnavailable)('unauthenticated no puede leer un rol específico', async () => {
    const db = anonDb();
    await assertFails(getDoc(doc(db, 'roles', UID.admin)));
  });

  it.skipIf(emulatorUnavailable)('unauthenticated no puede listar /roles', async () => {
    const db = anonDb();
    await assertFails(getDocs(collection(db, 'roles')));
  });

  it.skipIf(emulatorUnavailable)('unauthenticated no puede leer /pedidos', async () => {
    const db = anonDb();
    await assertFails(getDoc(doc(db, 'pedidos', 'e2e-t8-ped-existente')));
  });
});

describe('T8 — cuenta sin rol intenta confirmar pedido → DENIED', () => {
  it.skipIf(emulatorUnavailable)('unassigned no puede crear pedido', async () => {
    const db = authedDb(UID.sinRol);
    await assertFails(
      setDoc(doc(db, 'pedidos', 'e2e-t8-sin-rol-ped'), {
        ownerUid: UID.sinRol,
        assignedVendorUid: UID.vdeGonzalo,
        clientCardCode: CARD_CODE_GONZALO,
        stage: 'pending',
        createdAt: new Date().toISOString(),
        lines: [{ code: TEST_SKU, qty: 1, state: 'pending', qtyOpen: 1, precio: 100 }],
      })
    );
  });

  it.skipIf(emulatorUnavailable)('unassigned no puede leer pedidos ajenos', async () => {
    const db = authedDb(UID.sinRol);
    await assertFails(getDoc(doc(db, 'pedidos', 'e2e-t8-ped-existente')));
  });

  it.skipIf(emulatorUnavailable)('unassigned no puede leer roles ajenos', async () => {
    const db = authedDb(UID.sinRol);
    await assertFails(getDoc(doc(db, 'roles', UID.admin)));
  });
});

describe('precondición T7+T8', () => {
  it('emulador disponible', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});
