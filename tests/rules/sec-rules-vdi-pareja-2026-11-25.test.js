/**
 * H3 auditoria de seguridad (2026-11-25): alcance del interno (VDI) sobre
 * /pedidos.
 *
 * Regla: el interno modifica solo pedidos propios (ownerUid / createdByUid /
 * cargadoPorUid == el) con la lista completa, o pedidos de su pareja VDE
 * (ownerUid o assignedVendorUid es el VDE con internalPartnerUid == el) con
 * una lista reducida de "solo modificar". Borra solo pedidos propios.
 *
 * Pareja del seed canonico: UID.vendor.internalPartnerUid = UID.internoPartnered.
 * UID.interno no tiene pareja. UID.vendorOther no tiene pareja.
 *
 * Ver docs/CHANGELOG-sec-rules-vdi-pareja-2026-11-25.md.
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
  // Pedido del VDE de la pareja.
  await seedDoc('pedidos/p-pareja', {
    ownerUid: UID.vendor,
    assignedVendorUid: UID.vendor,
    stage: 'pending',
    lines: [{ code: 'SKU1', qty: 1 }],
    observaciones: '',
  });
  // Pedido cargado por el gerente para un cliente de la pareja.
  await seedDoc('pedidos/p-gerente-pareja', {
    ownerUid: GERENTE_LIKE,
    cargadoPorUid: GERENTE_LIKE,
    assignedVendorUid: UID.vendor,
    stage: 'pending',
    lines: [{ code: 'SKU1', qty: 1 }],
  });
  // Pedido cargado por el gerente para un cliente de otra pareja.
  await seedDoc('pedidos/p-gerente-otra', {
    ownerUid: GERENTE_LIKE,
    cargadoPorUid: GERENTE_LIKE,
    assignedVendorUid: UID.vendorOther,
    stage: 'pending',
    lines: [{ code: 'SKU1', qty: 1 }],
  });
  // Pedido propio de UID.interno.
  await seedDoc('pedidos/p-propio-interno', {
    ownerUid: UID.interno,
    assignedVendorUid: UID.vendorOther,
    stage: 'pending',
    lines: [{ code: 'SKU1', qty: 1 }],
  });
});

describe('precondición', () => {
  it('el emulador está disponible (si no, estos tests no prueban nada)', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});

describe('H3 — interno modifica pedidos de su pareja VDE', () => {
  it('pareja: actualiza lines y observaciones de un pedido del VDE', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-pareja'), {
        lines: [{ code: 'SKU1', qty: 2 }],
        observaciones: 'Nota VDI',
        updatedAt: '2026-11-25T00:00:00Z',
      })
    );
  });

  it('pareja: actualiza lines de un pedido que cargó el gerente para un cliente de la pareja', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-gerente-pareja'), {
        lines: [{ code: 'SKU1', qty: 3 }],
      })
    );
  });

  it('pareja: actualiza plannerStage de un pedido de la pareja', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-pareja'), {
        plannerStage: 'facturar',
        plannerHistory: [{ stage: 'facturar', at: '2026-11-25T00:00:00Z' }],
      })
    );
  });

  it('pareja: NO mueve la tarjeta a columnas de cobro (cobrado_parcial / cobrado_full)', async () => {
    for (const stage of ['cobrado_parcial', 'cobrado_full']) {
      await assertFails(
        updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-pareja'), {
          plannerStage: stage,
        })
      );
    }
  });

  it('propio: el interno sí puede mover su propio pedido a cobrado (lista completa)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-propio-interno'), {
        plannerStage: 'cobrado_parcial',
      })
    );
  });

  it('pareja: pedido sin ownerUid entra por assignedVendorUid; con assignedVendorUid null no', async () => {
    await seedDoc('pedidos/p-sin-owner', {
      assignedVendorUid: UID.vendor,
      stage: 'pending',
      lines: [{ code: 'SKU1', qty: 1 }],
    });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-sin-owner'), { observaciones: 'x' })
    );
    await seedDoc('pedidos/p-assigned-null', {
      ownerUid: GERENTE_LIKE,
      assignedVendorUid: null,
      stage: 'pending',
      lines: [{ code: 'SKU1', qty: 1 }],
    });
    await assertFails(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-assigned-null'), { observaciones: 'x' })
    );
  });

  it('pareja: NO puede escribir createdByUid para volverse dueño', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-pareja'), {
        createdByUid: UID.internoPartnered,
      })
    );
  });

  it('propio por cargadoPorUid: lo puede borrar', async () => {
    await seedDoc('pedidos/p-cargado-vdi-del', {
      ownerUid: UID.vendor,
      cargadoPorUid: UID.internoPartnered,
      assignedVendorUid: UID.vendor,
      stage: 'pending',
      lines: [],
    });
    await assertSucceeds(deleteDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-cargado-vdi-del')));
  });

  it('propio: interno cambia stage de su pedido y lo borra', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-propio-interno'), {
        stage: 'confirmed',
        confirmedAt: '2026-11-25T00:00:00Z',
      })
    );
    await assertSucceeds(deleteDoc(doc(authedDb(UID.interno), 'pedidos', 'p-propio-interno')));
  });

  it('propio por cargadoPorUid: el interno que cargó el pedido lo puede confirmar', async () => {
    await seedDoc('pedidos/p-cargado-vdi', {
      ownerUid: UID.vendor,
      cargadoPorUid: UID.internoPartnered,
      assignedVendorUid: UID.vendor,
      stage: 'pending',
      lines: [],
    });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-cargado-vdi'), {
        stage: 'confirmed',
      })
    );
  });
});

describe('H3 — interno NO modifica pedidos de otras parejas', () => {
  it('interno sin pareja NO actualiza lines de un pedido de un VDE', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-pareja'), {
        lines: [{ code: 'SKU1', qty: 2 }],
      })
    );
  });

  it('interno sin pareja NO actualiza un pedido del gerente para cliente de otra pareja', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-gerente-pareja'), {
        lines: [{ code: 'SKU1', qty: 2 }],
      })
    );
  });

  it('interno con pareja NO actualiza un pedido del gerente para cliente de otra pareja', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-gerente-otra'), {
        lines: [{ code: 'SKU1', qty: 2 }],
      })
    );
  });

  it('interno con pareja NO actualiza el pedido propio de otro interno', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-propio-interno'), {
        observaciones: 'x',
      })
    );
  });
});

describe('H3 — sobre pedidos de la pareja, el interno solo "modifica"', () => {
  const prohibidos = {
    stage: 'confirmed',
    confirmedAt: '2026-11-25T00:00:00Z',
    closedAt: '2026-11-25T00:00:00Z',
    finalizedAt: '2026-11-25T00:00:00Z',
    orderNumber: 999,
    transferidoSAP: { via: 'app_only', docEntry: null },
    ownerUid: UID.internoPartnered,
    assignedVendorUid: UID.internoPartnered,
    paidStatus: 'paid',
    paidAmount: 100,
    invoicedAmount: 100,
    revertedBy: 'x',
    autoSplitByStock: { at: 'x' },
  };
  for (const [campo, valor] of Object.entries(prohibidos)) {
    it(`pareja NO puede escribir ${campo}`, async () => {
      await assertFails(
        updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-pareja'), { [campo]: valor })
      );
    });
  }

  it('pareja NO puede escribir cargadoPorUid (para volverse "propio")', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-pareja'), {
        cargadoPorUid: UID.internoPartnered,
      })
    );
  });
});

describe('H3 — delete del interno', () => {
  it('interno con pareja NO borra un pedido de su pareja', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-pareja')));
  });

  it('interno NO borra un pedido que cargó el gerente', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.interno), 'pedidos', 'p-gerente-otra')));
    await assertFails(
      deleteDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-gerente-pareja'))
    );
  });

  it('gerente/admin siguen borrando cualquier pedido', async () => {
    await assertSucceeds(deleteDoc(doc(authedDb(UID.gerente), 'pedidos', 'p-gerente-otra')));
    await assertSucceeds(deleteDoc(doc(authedDb(UID.admin), 'pedidos', 'p-pareja')));
  });
});
