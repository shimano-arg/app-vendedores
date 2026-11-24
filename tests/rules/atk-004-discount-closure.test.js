/**
 * HARDENING6 (2026-11-23): el VDE no edita el descuento de un pedido despues
 * de crearlo. 'discountPct' y 'discountSnapshot' salen del whitelist hasOnly()
 * del VDE en pedidos.update. El descuento lo fija el servidor al crear.
 *
 * Estos tests verifican:
 * - VDE NO puede update discountPct sobre pedido PROPIO (ownerUid del vendor).
 * - VDE NO puede update discountSnapshot sobre pedido PROPIO.
 * - VDE NO puede update AMBOS campos juntos.
 * - Admin SI puede update (su rama no tiene hasOnly).
 * - Gerente SI puede update.
 * - Interno NO puede update (whitelist VDI, ajuste #1375).
 * - VDE puede seguir update otros campos del whitelist (regression: formaEntrega, stage).
 */

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  doc,
  emulatorUnavailable,
  initTestEnv,
  seedCanonicalRoles,
  seedDoc,
  UID,
  updateDoc,
} from './setup.js';

beforeAll(async () => {
  await initTestEnv();
});

afterAll(async () => {
  await cleanupTestEnv();
});

beforeEach(async () => {
  if (emulatorUnavailable) return;
  await seedCanonicalRoles();
});

/**
 * Siembra un pedido que es del vendor (UID.vendor) — asigna ownerUid +
 * assignedVendorUid al mismo uid. `discountPct` inicial 0, `stage` confirmed.
 */
async function seedPedidoDelVendor(pedidoId = 'pedido-test') {
  if (emulatorUnavailable) return;
  await seedDoc(`pedidos/${pedidoId}`, {
    ownerUid: UID.vendor,
    ownerEmail: 'gonzalo@shimano.com.ar',
    ownerVendor: 'VDE_GONZALO',
    vendorAssigned: 'VDE_GONZALO',
    assignedVendorUid: UID.vendor,
    assignedVendorEmail: 'gonzalo@shimano.com.ar',
    clientCardCode: 'C001',
    clientName: 'Cliente Test',
    stage: 'confirmed',
    discountPct: 0,
    discountSnapshot: null,
    lines: [{ code: 'SKU1', qty: 1, precio: 1000, state: 'confirmed' }],
    netAmountArs: 1000,
    subtotalArs: 1000,
    confirmedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    key: 'C|BA|CABA|Cliente Test',
    tipo: 'C',
  });
}

describe('HARDENING6 §ATK-004 — VDE NO puede update discountPct post-create', () => {
  it('VDE rechazado al setear discountPct=95 sobre pedido propio', async () => {
    await seedPedidoDelVendor('pedido-atk004-1');
    const db = authedDb(UID.vendor);
    // Vector de fraude: VDE abre DevTools y hace update directo.
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-1'), {
        discountPct: 95,
      })
    );
  });

  it('VDE rechazado al setear discountPct=10 (incluso valor razonable)', async () => {
    await seedPedidoDelVendor('pedido-atk004-2');
    const db = authedDb(UID.vendor);
    // Hasta un descuento razonable (10%) debe fallar — la rule cerro el campo
    // entero, no un cap. Si Mariano/Santi autorizan update post-create en el
    // futuro, se agrega CF updateDiscountCF con cap por rol (§63 pattern).
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-2'), {
        discountPct: 10,
      })
    );
  });

  it('VDE rechazado al setear discountSnapshot (snapshot)', async () => {
    await seedPedidoDelVendor('pedido-atk004-3');
    const db = authedDb(UID.vendor);
    // El snapshot tambien es fuente del descuento aguas abajo.
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-3'), {
        discountSnapshot: { pctTotal: 95, pctFijo: 0, pctVol: 0, pctAntic: 0 },
      })
    );
  });

  it('VDE rechazado al update AMBOS campos juntos', async () => {
    await seedPedidoDelVendor('pedido-atk004-4');
    const db = authedDb(UID.vendor);
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-4'), {
        discountPct: 50,
        discountSnapshot: { pctTotal: 50 },
      })
    );
  });

  it('VDE rechazado al update discountPct mezclado con un campo whitelisted (hasOnly falla)', async () => {
    await seedPedidoDelVendor('pedido-atk004-5');
    const db = authedDb(UID.vendor);
    // hasOnly() falla si CUALQUIER key no esta en el whitelist. Mezclar un
    // campo prohibido (discountPct) con uno permitido (observaciones) rechaza
    // el update entero.
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-5'), {
        discountPct: 20,
        observaciones: 'test',
      })
    );
  });
});

describe('HARDENING6 §ATK-004 — Admin/gerente SI, interno NO pueden update discount', () => {
  it('Admin puede setear discountPct=95 (rama blanket sin hasOnly)', async () => {
    await seedPedidoDelVendor('pedido-atk004-6');
    const db = authedDb(UID.admin);
    await assertSucceeds(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-6'), {
        discountPct: 95,
      })
    );
  });

  it('Gerente puede setear discountSnapshot', async () => {
    await seedPedidoDelVendor('pedido-atk004-7');
    const db = authedDb(UID.gerente);
    await assertSucceeds(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-7'), {
        discountSnapshot: { pctTotal: 30, pctFijo: 10, pctVol: 10, pctAntic: 10 },
      })
    );
  });

  // Ajuste #1375 (2026-11-24): el VDI ya no tiene blanket update; su whitelist
  // tampoco incluye el descuento.
  it('Interno NO puede setear discountPct/discountSnapshot (whitelist VDI sin descuento)', async () => {
    await seedPedidoDelVendor('pedido-atk004-8');
    const db = authedDb(UID.interno);
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-8'), {
        discountPct: 15,
        discountSnapshot: { pctTotal: 15 },
      })
    );
  });
});

describe('HARDENING6 §ATK-004 — Regression: VDE puede update otros campos del whitelist', () => {
  it('VDE puede update formaEntrega sobre pedido propio', async () => {
    await seedPedidoDelVendor('pedido-atk004-9');
    const db = authedDb(UID.vendor);
    await assertSucceeds(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-9'), {
        formaEntrega: 'retiro',
      })
    );
  });

  it('VDE puede update observaciones sobre pedido propio', async () => {
    await seedPedidoDelVendor('pedido-atk004-10');
    const db = authedDb(UID.vendor);
    await assertSucceeds(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-10'), {
        observaciones: 'test actualizado',
      })
    );
  });

  it('VDE puede update stage waitlist -> confirmed', async () => {
    await seedPedidoDelVendor('pedido-atk004-11');
    const db = authedDb(UID.vendor);
    await assertSucceeds(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-11'), {
        stage: 'invoiced',
      })
    );
  });

  it('VDE puede update lines + netAmountArs sobre pedido propio (whitelist intacto)', async () => {
    await seedPedidoDelVendor('pedido-atk004-12');
    const db = authedDb(UID.vendor);
    await assertSucceeds(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-12'), {
        lines: [{ code: 'SKU1', qty: 2, precio: 1000, state: 'confirmed' }],
        netAmountArs: 2000,
      })
    );
  });
});

describe('HARDENING6 §ATK-004 — Cross-vendor: VDE NO puede update discountPct de pedido ajeno', () => {
  it('VDE rechazado al setear discountPct sobre pedido de OTRO vendor', async () => {
    if (emulatorUnavailable) return;
    await seedDoc('pedidos/pedido-atk004-cross', {
      ownerUid: UID.vendorOther,
      assignedVendorUid: UID.vendorOther,
      clientCardCode: 'C002',
      clientName: 'Cliente Ajeno',
      stage: 'confirmed',
      discountPct: 0,
      lines: [{ code: 'SKU1', qty: 1, precio: 1000, state: 'confirmed' }],
      netAmountArs: 1000,
      createdAt: new Date().toISOString(),
    });
    const db = authedDb(UID.vendor);
    // Dos capas defensivas simultaneas: (a) VDE no es ownerUid ni
    // assignedVendorUid -> rule rechaza antes del hasOnly. (b) Aunque pasara
    // esa capa, discountPct ya no esta en el whitelist.
    await assertFails(
      updateDoc(doc(db, 'pedidos', 'pedido-atk004-cross'), {
        discountPct: 95,
      })
    );
  });
});
