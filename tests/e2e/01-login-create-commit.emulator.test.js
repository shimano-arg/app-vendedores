/**
 * P2-A.a T1+T2 — Login admin + crear pedido (commit success)
 *                Login gerente + crear pedido + confirmar (success)
 *
 * Verifica via Firestore rules que admin y gerente pueden escribir
 * en /pedidos (crear un pedido) y en /revision_waitlist. Los tests
 * apuntan al emulador local; §40.8 skip si no está disponible.
 *
 * S-7 / 2026-11-25
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CARD_CODE_GONZALO, seedAllRoles, seedClientes, TEST_SKU } from './fixtures/seed-roles.js';
import {
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  clearTestEnv,
  doc,
  emulatorUnavailable,
  initTestEnv,
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
  await seedClientes();
});

function pedidoSimple(ownerUid, cardCode = CARD_CODE_GONZALO) {
  return {
    ownerUid,
    assignedVendorUid: UID.vdeGonzalo,
    clientCardCode: cardCode,
    stage: 'pending',
    createdAt: new Date().toISOString(),
    lines: [{ code: TEST_SKU, qty: 2, state: 'pending', qtyOpen: 2, precio: 100 }],
  };
}

describe('T1 — admin crea pedido (commit success)', () => {
  it.skipIf(emulatorUnavailable)('admin puede escribir en /pedidos', async () => {
    const db = authedDb(UID.admin);
    await assertSucceeds(
      setDoc(doc(db, 'pedidos', 'e2e-t1-admin-ped-01'), pedidoSimple(UID.admin))
    );
  });

  it.skipIf(emulatorUnavailable)('admin puede crear revision_waitlist', async () => {
    const db = authedDb(UID.admin);
    await assertSucceeds(
      setDoc(doc(db, 'revision_waitlist', 'e2e-t1-admin-wl-01'), {
        ownerUid: UID.admin,
        assignedVendorUid: UID.vdeGonzalo,
        clientCardCode: CARD_CODE_GONZALO,
        createdAt: new Date().toISOString(),
        lines: [{ code: TEST_SKU, qty: 1 }],
      })
    );
  });
});

describe('T2 — gerente crea pedido y confirma', () => {
  it.skipIf(emulatorUnavailable)('gerente puede escribir en /pedidos', async () => {
    const db = authedDb(UID.gerente);
    await assertSucceeds(
      setDoc(doc(db, 'pedidos', 'e2e-t2-ger-ped-01'), pedidoSimple(UID.gerente))
    );
  });

  it.skipIf(emulatorUnavailable)('gerente puede actualizar stage a confirmed', async () => {
    // Seed pedido en pending.
    const db = authedDb(UID.gerente);
    await assertSucceeds(
      setDoc(doc(db, 'pedidos', 'e2e-t2-ger-ped-02'), pedidoSimple(UID.gerente))
    );
    // Gerente lo confirma (update stage).
    const { updateDoc } = await import('./lib/setup-emulator.js');
    await assertSucceeds(
      updateDoc(doc(db, 'pedidos', 'e2e-t2-ger-ped-02'), {
        stage: 'confirmed',
        confirmedAt: new Date().toISOString(),
      })
    );
  });
});

describe('precondición T1+T2', () => {
  it('emulador disponible (si no, los tests no prueban nada)', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});
