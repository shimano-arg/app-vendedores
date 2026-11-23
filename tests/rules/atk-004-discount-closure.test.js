/**
 * HARDENING6 §ATK-004 (2026-11-23): cierre del vector de fraude de descuentos.
 *
 * Pre-fix (v1568 y anteriores): el whitelist hasOnly() del VDE en
 * pedidos.update incluia 'discountPct' y 'discountSnapshot'. Un VDE con
 * DevTools podia escribir directo:
 *   db.collection('pedidos').doc(x).update({ discountPct: 95 })
 *   db.collection('pedidos').doc(x).update({ discountSnapshot: { pctTotal: 95 } })
 * y la cascada OR de auto-send-sap-core.js enviaba DiscountPercent=95 al
 * payload del Service Layer. SAP creaba la oferta con -95%. Fraude potencial
 * $950k/pedido documentado.
 *
 * Post-fix (HARDENING6 §ATK-004 2026-11-23): removidos 'discountPct' y
 * 'discountSnapshot' del whitelist VDE. Admin/gerente/interno conservan la
 * capacidad (sus ramas de la rule NO tienen hasOnly). PR #1399 (D12) persiste
 * el descuento correctamente desde commitPedidoCF (admin SDK, bypassa rules),
 * entonces no hay flow legitimo cliente-side que rompa.
 *
 * Estos tests verifican:
 * - VDE NO puede update discountPct sobre pedido PROPIO (ownerUid del vendor).
 * - VDE NO puede update discountSnapshot sobre pedido PROPIO.
 * - VDE NO puede update AMBOS campos juntos.
 * - Admin SI puede update (su rama no tiene hasOnly).
 * - Gerente SI puede update.
 * - Interno SI puede update.
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

describe('HARDENING6 §ATK-004 — VDE NO puede update discountPct via DevTools', () => {
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

  it('VDE rechazado al setear discountSnapshot (bypass via cascada OR)', async () => {
    await seedPedidoDelVendor('pedido-atk004-3');
    const db = authedDb(UID.vendor);
    // Vector alternativo: cascada en auto-send-sap-core.js lee discountSnapshot
    // como fallback si discountPct=0. VDE podia setear solo el snapshot y SAP
    // recibia 95% igual.
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

describe('HARDENING6 §ATK-004 — Admin/gerente/interno SI pueden update discount (sin cambio)', () => {
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

  it('Interno (v747 blanket) puede setear ambos campos', async () => {
    await seedPedidoDelVendor('pedido-atk004-8');
    const db = authedDb(UID.interno);
    await assertSucceeds(
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
