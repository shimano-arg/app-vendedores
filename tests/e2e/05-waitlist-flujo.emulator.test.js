/**
 * P2-A.a T9 — Lista de espera: VDE pone pedido en espera, gerente confirma.
 *
 * Flujo:
 *  1. VDE Gonzalo crea revision_waitlist (pone pedido en espera).
 *  2. Gerente lee la waitlist → success.
 *  3. Gerente actualiza stage→'consumed' (simulando confirmar desde panel).
 *
 * Nota: La transición real via commitPedidoCF usa Admin SDK (bypassa rules).
 * Este test verifica las reglas Firestore para el flujo cliente.
 * La lógica de negocio completa está en tests/functions/commit-pedido-core.test.js.
 *
 * S-7 / 2026-11-25
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CARD_CODE_GONZALO, seedAllRoles, TEST_SKU } from './fixtures/seed-roles.js';
import {
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  clearTestEnv,
  doc,
  emulatorUnavailable,
  getDoc,
  initTestEnv,
  setDoc,
  UID,
  updateDoc,
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
});

describe('T9 — waitlist: VDE pone en espera, gerente confirma', () => {
  it.skipIf(emulatorUnavailable)(
    'VDE puede crear revision_waitlist (poner en espera)',
    async () => {
      const db = authedDb(UID.vdeGonzalo);
      await assertSucceeds(
        setDoc(doc(db, 'revision_waitlist', 'e2e-t9-wl-01'), {
          ownerUid: UID.vdeGonzalo,
          assignedVendorUid: UID.vdeGonzalo,
          clientCardCode: CARD_CODE_GONZALO,
          orderNumber: 999,
          createdAt: new Date().toISOString(),
          items: [{ code: TEST_SKU, qty: 2, precio: 100 }],
          stage: 'open',
        })
      );
    }
  );

  it.skipIf(emulatorUnavailable)('gerente puede leer revision_waitlist', async () => {
    // Seed la waitlist vía bypass.
    const { seedDoc } = await import('./lib/setup-emulator.js');
    await seedDoc('revision_waitlist/e2e-t9-wl-read', {
      ownerUid: UID.vdeGonzalo,
      assignedVendorUid: UID.vdeGonzalo,
      clientCardCode: CARD_CODE_GONZALO,
      orderNumber: 998,
      createdAt: new Date().toISOString(),
      items: [{ code: TEST_SKU, qty: 1, precio: 100 }],
      stage: 'open',
    });
    const db = authedDb(UID.gerente);
    await assertSucceeds(getDoc(doc(db, 'revision_waitlist', 'e2e-t9-wl-read')));
  });

  it.skipIf(emulatorUnavailable)('gerente puede marcar waitlist como consumed', async () => {
    const { seedDoc } = await import('./lib/setup-emulator.js');
    await seedDoc('revision_waitlist/e2e-t9-wl-consume', {
      ownerUid: UID.vdeGonzalo,
      assignedVendorUid: UID.vdeGonzalo,
      clientCardCode: CARD_CODE_GONZALO,
      orderNumber: 997,
      createdAt: new Date().toISOString(),
      items: [{ code: TEST_SKU, qty: 1, precio: 100 }],
      stage: 'open',
    });
    const db = authedDb(UID.gerente);
    await assertSucceeds(
      updateDoc(doc(db, 'revision_waitlist', 'e2e-t9-wl-consume'), {
        stage: 'consumed',
        consumedAt: new Date().toISOString(),
        consumedByPedidoId: 'e2e-t9-ped-simulado',
      })
    );
  });
});

describe('precondición T9', () => {
  it('emulador disponible', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});
