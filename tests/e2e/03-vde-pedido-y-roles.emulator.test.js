/**
 * P2-A.a T5+T6 — VDE Gonzalo: pedido cliente propio + lectura /roles ajenos.
 *
 * T5: VDE NO puede create directo a /pedidos — SOLO via commitPedidoCF.
 *     Desde #1379 (2026-11-24): `pedidos.create` restringido a admin/gerente.
 *     Todo pedido de vendedor o interno nace en commitPedidoCF (Admin SDK,
 *     no pasa por rules; §67 v1454 eliminó el `pedidos.add` del cliente).
 *     El VDE sigue pudiendo leer su propio rol (/roles/<uid>).
 *
 * T6: VDE NO puede leer /roles/{otro_vde} — cerrado por S04 (fix #1445).
 *     Commit 983d8085 (v1491 cap 2, 2026-10-27) agregó temporalmente
 *     `resource.data.role == 'vendedor'` como rama permisiva para que
 *     `resolveClientVendorFromMaster` resolviera UIDs client-side.
 *     Commit 852e2e9b (S04, 2026-11-25, PR #1445) la REMOVIÓ explícitamente
 *     por read leak: cualquier VDE con sesión podía enumerar nombres+emails
 *     de los 4 VDEs via consola. La resolución VDE→UID la hace ahora
 *     `resolveClientVendorServerSide` (admin SDK, §89).
 *     VDE sigue sin poder leer roles de internos ni admins.
 *
 * S-7 / 2026-11-26 — fixture alineado a rules post-#1379 + post-#1445.
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

describe('T5 — VDE Gonzalo + /pedidos (post #1379 2026-11-24)', () => {
  it.skipIf(emulatorUnavailable)(
    'NO puede create directo a /pedidos (solo admin/gerente; VDE pasa por commitPedidoCF)',
    async () => {
      // #1379: `pedidos.create: if isAdminOrGerente()`.
      // Un VDE que intenta setDoc directo recibe PERMISSION_DENIED.
      const db = authedDb(UID.vdeGonzalo);
      await assertFails(
        setDoc(doc(db, 'pedidos', 'e2e-t5-vde-ped-01'), {
          ownerUid: UID.vdeGonzalo,
          assignedVendorUid: UID.vdeGonzalo,
          clientCardCode: CARD_CODE_GONZALO,
          stage: 'pending',
          createdAt: new Date().toISOString(),
          lines: [{ code: TEST_SKU, qty: 1, state: 'pending', qtyOpen: 1, precio: 100 }],
        })
      );
    }
  );

  it.skipIf(emulatorUnavailable)('puede leer su propio rol', async () => {
    const db = authedDb(UID.vdeGonzalo);
    await assertSucceeds(getDoc(doc(db, 'roles', UID.vdeGonzalo)));
  });
});

describe('T6 — VDE Gonzalo lee /roles/{otro_uid} (post #1445 S04)', () => {
  it.skipIf(emulatorUnavailable)(
    'NO puede leer rol de otro VDE (S04 cerró la rama role==vendedor)',
    async () => {
      // Pre-#1445 existía `resource.data.role == 'vendedor'` (v1491 cap 2).
      // #1445 la removió: read leak de nombres+emails de VDEs.
      // La resolución VDE→UID ahora es server-side via admin SDK (§89).
      const db = authedDb(UID.vdeGonzalo);
      await assertFails(getDoc(doc(db, 'roles', UID.vdePachi)));
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
