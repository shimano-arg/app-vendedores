/**
 * P2-A.a T5+T6 — VDE Gonzalo: pedido cliente propio + lectura /roles ajenos.
 *
 * T5: VDE Gonzalo crea pedido para cliente propio → success
 * T6: VDE Gonzalo lee /roles/{otro_vde_uid} → PERMISSION_DENIED
 *     (post fix #1445: D2 restringe lectura de roles a Reader + vendor)
 *
 * T6 verifica la regla de D2 (2026-10-29): un vendedor puede leer roles de
 * otros vendedores (resource.data.role=='vendedor') pero NO de internos,
 * admins, gerentes u otras cuentas no-vendedor.
 *
 * S-7 / 2026-11-25
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CARD_CODE_GONZALO, seedAllRoles, TEST_SKU } from './fixtures/seed-roles.js';
import {
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  clearTestEnv,
  doc,
  emulatorUnavailable,
  getDoc,
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
  await seedDoc(`client_master/${CARD_CODE_GONZALO}`, {
    cardCode: CARD_CODE_GONZALO,
    cardName: 'TEST CLIENTE GONZALO',
    assignedVendor: 'TEST-VDE-GONZALO',
    state: 'enabled',
  });
});

describe('T5 — VDE Gonzalo crea pedido cliente propio → success', () => {
  it.skipIf(emulatorUnavailable)('puede crear pedido para su cliente', async () => {
    const db = authedDb(UID.vdeGonzalo);
    await assertSucceeds(
      setDoc(doc(db, 'pedidos', 'e2e-t5-vde-ped-01'), {
        ownerUid: UID.vdeGonzalo,
        assignedVendorUid: UID.vdeGonzalo,
        clientCardCode: CARD_CODE_GONZALO,
        stage: 'pending',
        createdAt: new Date().toISOString(),
        lines: [{ code: TEST_SKU, qty: 1, state: 'pending', qtyOpen: 1, precio: 100 }],
      })
    );
  });

  it.skipIf(emulatorUnavailable)('puede leer su propio rol', async () => {
    const db = authedDb(UID.vdeGonzalo);
    await assertSucceeds(getDoc(doc(db, 'roles', UID.vdeGonzalo)));
  });
});

describe('T6 — VDE Gonzalo lee /roles/{otro_vde} y no-vendedor', () => {
  it.skipIf(emulatorUnavailable)(
    'puede leer rol de otro VDE (resource.data.role==vendedor)',
    async () => {
      // D2: isReader() && resource.data.role=='vendedor' → permitido para VDE.
      const db = authedDb(UID.vdeGonzalo);
      await assertSucceeds(getDoc(doc(db, 'roles', UID.vdePachi)));
    }
  );

  it.skipIf(emulatorUnavailable)('no puede leer rol de un interno', async () => {
    // Interno no es 'vendedor' → PERMISSION_DENIED para un VDE que no es admin/gerente.
    const db = authedDb(UID.vdeGonzalo);
    await assertFails(getDoc(doc(db, 'roles', UID.internoIoannis)));
  });

  it.skipIf(emulatorUnavailable)('no puede leer rol de admin', async () => {
    const db = authedDb(UID.vdeGonzalo);
    await assertFails(getDoc(doc(db, 'roles', UID.admin)));
  });
});

describe('precondición T5+T6', () => {
  it('emulador disponible', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});
