/**
 * Auditoría de seguridad 2026-11-25 (revisión adversarial #1422, M1/M2):
 * alcance del interno (VDI) sobre /revision_waitlist.
 *
 * - Edita o consume solo órdenes propias (ownerUid / cargadoPorUid) o de su
 *   pareja VDE (ownerUid o assignedVendorUid es el VDE con
 *   internalPartnerUid == él), evaluado sobre el documento antes del cambio.
 * - No puede "adjudicarse" una orden vieja sin assignedVendorUid de otra
 *   pareja escribiéndole el uid de su VDE pareja.
 * - Borra solo órdenes propias.
 * - Vendedor, admin y gerente sin cambio.
 *
 * Pareja del seed canónico: UID.vendor.internalPartnerUid = UID.internoPartnered.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  deleteDoc,
  doc,
  emulatorUnavailable,
  initTestEnv,
  seedCanonicalRoles,
  seedDoc,
  UID,
  updateDoc,
} from './setup.js';

const GERENTE_LIKE = 'uid-carga-gerente';

beforeAll(async () => {
  await initTestEnv();
});
afterAll(async () => {
  await cleanupTestEnv();
});
beforeEach(async () => {
  await seedCanonicalRoles();
  // Orden de la pareja (cargada por el VDE).
  await seedDoc('revision_waitlist/wl-pareja', {
    ownerUid: UID.vendor,
    assignedVendorUid: UID.vendor,
    items: [{ code: 'A', qty: 1 }],
  });
  // Orden cargada por el gerente para un cliente de la pareja.
  await seedDoc('revision_waitlist/wl-ger-pareja', {
    ownerUid: GERENTE_LIKE,
    assignedVendorUid: UID.vendor,
    items: [{ code: 'A', qty: 1 }],
  });
  // Orden de otra pareja.
  await seedDoc('revision_waitlist/wl-otra', {
    ownerUid: UID.vendorOther,
    assignedVendorUid: UID.vendorOther,
    items: [{ code: 'A', qty: 1 }],
  });
  // Orden vieja de otra pareja, sin assignedVendorUid (pre-§44).
  await seedDoc('revision_waitlist/wl-legacy-otra', {
    ownerUid: GERENTE_LIKE,
    items: [{ code: 'A', qty: 1 }],
  });
  // Orden propia del interno de la pareja, y otra cargada por él (cargadoPorUid).
  await seedDoc('revision_waitlist/wl-propia', {
    ownerUid: UID.internoPartnered,
    items: [{ code: 'A', qty: 1 }],
  });
  await seedDoc('revision_waitlist/wl-cargada', {
    ownerUid: UID.vendor,
    cargadoPorUid: UID.internoPartnered,
    assignedVendorUid: UID.vendor,
    items: [{ code: 'A', qty: 1 }],
  });
});

const upd = (uid, id, data) => updateDoc(doc(authedDb(uid), 'revision_waitlist', id), data);
const del = (uid, id) => deleteDoc(doc(authedDb(uid), 'revision_waitlist', id));

describe('precondición', () => {
  it('el emulador está disponible (si no, estos tests no prueban nada)', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});

describe('M2 — interno edita/consume solo órdenes propias o de su pareja', () => {
  it('pareja (VDE y cargada por gerente) y propias: edita items', async () => {
    for (const id of ['wl-pareja', 'wl-ger-pareja', 'wl-propia', 'wl-cargada']) {
      await assertSucceeds(upd(UID.internoPartnered, id, { items: [{ code: 'A', qty: 2 }] }));
    }
  });

  it('pareja: consume la orden (stage + closedAt)', async () => {
    await assertSucceeds(
      upd(UID.internoPartnered, 'wl-pareja', {
        stage: 'consumed',
        closedAt: '2026-11-25T00:00:00Z',
        closedReason: 'x',
      })
    );
  });

  it('otra pareja: NO edita items ni consume', async () => {
    await assertFails(upd(UID.internoPartnered, 'wl-otra', { items: [] }));
    await assertFails(upd(UID.internoPartnered, 'wl-otra', { stage: 'consumed' }));
    // Interno sin pareja sobre una orden de un VDE.
    await assertFails(upd(UID.interno, 'wl-pareja', { items: [] }));
  });
});

describe('M1 — interno no se adjudica órdenes viejas sin assignedVendorUid', () => {
  it('NO puede escribir assignedVendorUid de su pareja en una orden vieja ajena', async () => {
    await assertFails(
      upd(UID.internoPartnered, 'wl-legacy-otra', {
        assignedVendorUid: UID.vendor,
        vendorAssigned: 'VDE PAREJA',
      })
    );
  });

  it('el vendedor sigue pudiendo re-resolver una orden vieja (sin cambio, §44)', async () => {
    await assertSucceeds(upd(UID.vendor, 'wl-legacy-otra', { assignedVendorUid: UID.vendor }));
  });
});

describe('M2 — interno borra solo órdenes propias', () => {
  it('propia (ownerUid o cargadoPorUid): la borra', async () => {
    await assertSucceeds(del(UID.internoPartnered, 'wl-propia'));
    await assertSucceeds(del(UID.internoPartnered, 'wl-cargada'));
  });

  it('pareja u otra pareja: NO la borra', async () => {
    for (const id of ['wl-pareja', 'wl-ger-pareja', 'wl-otra', 'wl-legacy-otra']) {
      await assertFails(del(UID.internoPartnered, id));
    }
  });
});

describe('sin cambio para vendedor, admin y gerente', () => {
  it('vendedor edita órdenes ajenas (colaborativo) y borra solo las propias', async () => {
    await assertSucceeds(upd(UID.vendorOther, 'wl-pareja', { items: [] }));
    await assertFails(del(UID.vendorOther, 'wl-pareja'));
    await assertSucceeds(del(UID.vendorOther, 'wl-otra'));
  });

  it('admin y gerente editan y borran cualquiera', async () => {
    await assertSucceeds(upd(UID.admin, 'wl-otra', { items: [] }));
    await assertSucceeds(del(UID.admin, 'wl-otra'));
    await assertSucceeds(upd(UID.gerente, 'wl-legacy-otra', { items: [] }));
    await assertSucceeds(del(UID.gerente, 'wl-legacy-otra'));
  });
});
