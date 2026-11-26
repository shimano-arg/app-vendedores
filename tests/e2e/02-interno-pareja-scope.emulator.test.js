/**
 * P2-A.a T3+T4 — Interno Ioannis: scope de pareja en Firestore rules.
 *
 * T3: interno (Ioannis) modifica pedido de su pareja VDE (Gonzalo) → success
 * T4: interno (Ioannis) modifica pedido de VDE de Pachi → PERMISSION_DENIED
 *
 * Pareja canónica: UID.internoIoannis ↔ UID.vdeGonzalo
 * (UID.vdeGonzalo.internalPartnerUid = UID.internoIoannis)
 *
 * Nota: T3 verifica la regla Firestore (isMyPartnerVDE). La lógica de
 * negocio INTERNO_FUERA_DE_PAREJA vive en commitPedidoCF, cubierta en
 * tests/functions/commit-pedido-interno-pareja.test.js.
 *
 * S-7 / 2026-11-25
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CARD_CODE_GONZALO,
  CARD_CODE_PACHI,
  seedAllRoles,
  TEST_SKU,
} from './fixtures/seed-roles.js';
import {
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  clearTestEnv,
  doc,
  emulatorUnavailable,
  initTestEnv,
  seedDoc,
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
  // Pedido de la pareja de Ioannis (asignado a Gonzalo).
  await seedDoc('pedidos/e2e-ped-gonzalo-01', {
    ownerUid: UID.vdeGonzalo,
    assignedVendorUid: UID.vdeGonzalo,
    clientCardCode: CARD_CODE_GONZALO,
    stage: 'pending',
    createdAt: new Date().toISOString(),
    lines: [{ code: TEST_SKU, qty: 2, state: 'pending', qtyOpen: 2, precio: 100 }],
  });
  // Pedido de Pachi (fuera de la pareja de Ioannis).
  await seedDoc('pedidos/e2e-ped-pachi-01', {
    ownerUid: UID.vdePachi,
    assignedVendorUid: UID.vdePachi,
    clientCardCode: CARD_CODE_PACHI,
    stage: 'pending',
    createdAt: new Date().toISOString(),
    lines: [{ code: TEST_SKU, qty: 1, state: 'pending', qtyOpen: 1, precio: 100 }],
  });
});

describe('T3 — interno Ioannis modifica pedido de su pareja (Gonzalo) → success', () => {
  it.skipIf(emulatorUnavailable)(
    'puede actualizar observaciones del pedido de su pareja',
    async () => {
      const db = authedDb(UID.internoIoannis);
      await assertSucceeds(
        updateDoc(doc(db, 'pedidos', 'e2e-ped-gonzalo-01'), {
          observaciones: 'actualizado por interno de pareja',
        })
      );
    }
  );
});

describe('T4 — interno Ioannis modifica pedido de Pachi → PERMISSION_DENIED', () => {
  it.skipIf(emulatorUnavailable)('no puede actualizar pedido de VDE ajeno', async () => {
    const db = authedDb(UID.internoIoannis);
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'e2e-ped-pachi-01'), {
        observaciones: 'intento no autorizado',
      })
    );
  });

  it.skipIf(emulatorUnavailable)('no puede crear pedido para cliente de Pachi', async () => {
    const db = authedDb(UID.internoIoannis);
    await assertFails(
      setDoc(doc(db, 'pedidos', 'e2e-t4-nuevo-pachi'), {
        ownerUid: UID.internoIoannis,
        assignedVendorUid: UID.vdePachi,
        clientCardCode: CARD_CODE_PACHI,
        stage: 'pending',
        createdAt: new Date().toISOString(),
        lines: [{ code: TEST_SKU, qty: 1, state: 'pending', qtyOpen: 1, precio: 100 }],
      })
    );
  });
});

describe('precondición T3+T4', () => {
  it('emulador disponible', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});
