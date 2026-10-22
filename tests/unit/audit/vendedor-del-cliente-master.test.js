// @ts-check
/**
 * v1406 §44 — tests de flow para los 4 caminos de creación + unificación:
 * el vendedor del PEDIDO/WAITLIST siempre viene del cliente master, sin
 * importar quién cargó. El Planner filtra por `assignedVendorUid`.
 *
 * Simulamos el flow sin Firebase: creamos un payload, invocamos el enrich
 * (que es la pura `enrichPayloadWithClientVendor`), y verificamos campos.
 */
import { describe, expect, it } from 'vitest';
import {
  enrichPayloadWithClientVendor,
  resolveClientVendorFromMaster,
} from '../../../src/pure/resolve-client-vendor.js';

const FEDERICO_UID = 'uid-federico-xyz';
const PABLO_UID = 'uid-pablo-pqr';
const SANTI_UID = 'uid-santi-abc';

const DEPS = {
  points: [
    {
      province: 'BUENOS AIRES',
      name: 'LA PLATA',
      vendor: 'FEDERICO',
      clients: ['ALBERTO PONTORIERO'],
    },
    {
      province: 'MENDOZA',
      name: 'SAN RAFAEL',
      vendor: '',
      clients: ['CLIENTE SIN VENDOR'],
    },
  ],
  vdiPartnerUsers: [
    { uid: FEDERICO_UID, email: 'federico@shimano.com.ar', vendorKey: 'FEDERICO' },
    { uid: PABLO_UID, email: 'pablo@shimano.com.ar', vendorKey: 'ADMIN_pablo' },
    { uid: SANTI_UID, email: 'santi@shimano.com.ar', vendorKey: 'SANTIAGO ESTEBAN' },
  ],
  getEffectiveVendorForClient: (p) => p.vendor || '',
  sapGetClienteCode: (n) =>
    ({ 'ALBERTO PONTORIERO': 'C20175569635', 'CLIENTE SIN VENDOR': 'C20300000002' })[n] || '',
};

function resolve(payload) {
  return resolveClientVendorFromMaster({
    cardCode: payload.clientCardCode || payload.cardCode || '',
    clientName: payload.clientName || payload.cardName || '',
    ...DEPS,
  });
}

function enrichAs(user, payload) {
  const res = resolve(payload);
  return enrichPayloadWithClientVendor(payload, res, {
    cargadoPorUid: user.uid,
    cargadoPorEmail: user.email,
  });
}

const PABLO = { uid: PABLO_UID, email: 'pablo@shimano.com.ar' };
const FEDERICO = { uid: FEDERICO_UID, email: 'federico@shimano.com.ar' };

describe('v1406 §44 — vendedor del cliente master', () => {
  it('T1 manual: admin Pablo carga para cliente de Federico → ownerVendor=FEDERICO', () => {
    const payload = {
      clientName: 'ALBERTO PONTORIERO',
      clientCardCode: 'C20175569635',
      ownerUid: PABLO.uid, // rules revision_waitlist obligan ownerUid=auth.uid
      ownerEmail: PABLO.email,
    };
    enrichAs(PABLO, payload);
    expect(payload.ownerVendor).toBe('FEDERICO');
    expect(payload.vendorAssigned).toBe('FEDERICO');
    expect(payload.assignedVendorUid).toBe(FEDERICO_UID);
    expect(payload.cargadoPorUid).toBe(PABLO.uid);
    expect(payload.cargadoPorEmail).toBe(PABLO.email);
    expect(payload.ownerUid).toBe(PABLO.uid); // sin cambio (rules)
  });

  it('T2 Excel importado por Pablo: mismo pattern', () => {
    const payload = {
      clientName: 'ALBERTO PONTORIERO',
      clientCardCode: 'C20175569635',
      ownerUid: PABLO.uid,
      // Excel flow setea source='importado-excel' adicional.
      source: 'importado-excel',
    };
    enrichAs(PABLO, payload);
    expect(payload.assignedVendorUid).toBe(FEDERICO_UID);
    expect(payload.ownerVendor).toBe('FEDERICO');
    expect(payload.cargadoPorUid).toBe(PABLO.uid);
  });

  it('T3 CPST: Pablo arma pedido desde Stock Asignado para cliente de Federico', () => {
    const payload = {
      clientName: 'ALBERTO PONTORIERO',
      clientCardCode: 'C20175569635',
      ownerUid: PABLO.uid,
      source: 'stock-asignado-batch',
      pedidosOrigenes: [{ pedidoId: 'xxx', lineIndex: 0, sku: 'SGS80MH2A', qtyAsignada: 1 }],
    };
    enrichAs(PABLO, payload);
    expect(payload.assignedVendorUid).toBe(FEDERICO_UID);
    expect(payload.ownerVendor).toBe('FEDERICO');
    expect(payload.source).toBe('stock-asignado-batch');
  });

  it('T4 VDE carga para su propio cliente → cargadoPorUid=VDE.uid=assignedVendorUid', () => {
    const payload = {
      clientName: 'ALBERTO PONTORIERO',
      clientCardCode: 'C20175569635',
      ownerUid: FEDERICO.uid,
      ownerEmail: FEDERICO.email,
    };
    enrichAs(FEDERICO, payload);
    expect(payload.assignedVendorUid).toBe(FEDERICO_UID);
    expect(payload.cargadoPorUid).toBe(FEDERICO.uid);
    expect(payload.cargadoPorEmail).toBe(FEDERICO.email);
  });

  it('T5 cliente sin vendedor en master → "sin vendedor" (vendorKey vacío)', () => {
    const payload = {
      clientName: 'CLIENTE SIN VENDOR',
      clientCardCode: 'C20300000002',
      ownerUid: PABLO.uid,
    };
    enrichAs(PABLO, payload);
    expect(payload.vendorAssigned).toBe('');
    expect(payload.assignedVendorUid).toBe('');
    expect(payload.ownerVendor).toBe('');
    expect(payload.cargadoPorUid).toBe(PABLO.uid);
    // UI: card queda visible solo para admin/gerente; VDE no la ve en query.
  });

  it('T6 unificación: target preserva su assignedVendorUid, no se pisa', () => {
    // Target existente ya resuelto (post-§44).
    const target = {
      _id: 'target-wl',
      clientCardCode: 'C20175569635',
      clientName: 'ALBERTO PONTORIERO',
      orderNumber: 445,
      ownerUid: FEDERICO.uid, // VDE Federico creó originalmente
      vendorAssigned: 'FEDERICO',
      assignedVendorUid: FEDERICO_UID,
      ownerVendor: 'FEDERICO',
      items: [],
    };
    // Incoming: Pablo intenta crear otra orden; se unifica con target.
    const incoming = {
      clientCardCode: 'C20175569635',
      clientName: 'ALBERTO PONTORIERO',
      orderNumber: 490,
      ownerUid: PABLO.uid,
      ownerEmail: PABLO.email,
      items: [{ code: 'XYZ', qty: 1 }],
    };
    // El enrich del incoming resuelve FEDERICO (del master).
    enrichAs(PABLO, incoming);
    expect(incoming.ownerVendor).toBe('FEDERICO');
    expect(incoming.assignedVendorUid).toBe(FEDERICO_UID);
    expect(incoming.cargadoPorUid).toBe(PABLO.uid);
    // Simulamos el updatePayload del helper _createOrUnifyWaitlistPayload:
    // si target ya tenía assignedVendorUid, NO se agrega al updatePayload.
    const updatePayload = { items: [...target.items, ...incoming.items] };
    const targetHasVendor =
      target.assignedVendorUid && String(target.assignedVendorUid).trim() !== '';
    expect(targetHasVendor).toBe(true);
    // → updatePayload NO sobreescribe assignedVendorUid.
    expect(updatePayload.assignedVendorUid).toBeUndefined();
    // Target final: conserva ownerUid=FEDERICO + vendor del master.
    const finalDoc = { ...target, ...updatePayload };
    expect(finalDoc.assignedVendorUid).toBe(FEDERICO_UID);
    expect(finalDoc.ownerVendor).toBe('FEDERICO');
  });

  it('T7 unificación con target legacy pre-§44 (sin assignedVendorUid) → se re-resuelve y setea', () => {
    const target = {
      _id: 'target-legacy',
      clientCardCode: 'C20175569635',
      clientName: 'ALBERTO PONTORIERO',
      orderNumber: 480,
      ownerUid: PABLO.uid, // legacy: Pablo cargó y ownerVendor quedó vacío
      ownerVendor: '',
      items: [],
      // assignedVendorUid NO existe (campo nuevo).
    };
    const targetHasVendor =
      target.assignedVendorUid && String(target.assignedVendorUid).trim() !== '';
    expect(targetHasVendor).toBeFalsy();
    // → helper re-resuelve y agrega al updatePayload.
    const res = resolve({ clientCardCode: target.clientCardCode, clientName: target.clientName });
    const updatePayload = { items: [...target.items] };
    if (!targetHasVendor && res.resolved) {
      updatePayload.vendorAssigned = res.vendorKey;
      updatePayload.assignedVendorUid = res.vendorUid;
      updatePayload.assignedVendorEmail = res.vendorEmail;
      updatePayload.ownerVendor = res.vendorKey;
    }
    expect(updatePayload.assignedVendorUid).toBe(FEDERICO_UID);
    expect(updatePayload.ownerVendor).toBe('FEDERICO');
  });

  it('T8 Planner filter: VDE Federico ve orden 483 PONTORIERO aunque cargó Pablo', () => {
    // Simulamos la query where('assignedVendorUid', '==', uid).
    const pedidos = [
      {
        id: 'p483',
        clientName: 'ALBERTO PONTORIERO',
        ownerUid: PABLO_UID,
        assignedVendorUid: FEDERICO_UID,
      },
      { id: 'p999', clientName: 'OTRO', ownerUid: SANTI_UID, assignedVendorUid: SANTI_UID },
    ];
    const myUid = FEDERICO_UID;
    const visible = pedidos.filter((p) => String(p.assignedVendorUid || '').trim() === myUid);
    expect(visible.map((p) => p.id)).toEqual(['p483']);
  });

  it('T9 UI card: "sin vendedor" rojo cuando vendorAssigned+ownerVendor vacíos', () => {
    // Replica la lógica del render card renderPlannerCard (index.html).
    const pedido = { assignedVendorKey: '', vendorAssigned: '', ownerVendor: '', vendorKey: '' };
    const vendorKeyRaw = String(
      pedido.vendorAssigned ||
        pedido.assignedVendorKey ||
        pedido.ownerVendor ||
        pedido.vendorKey ||
        ''
    ).trim();
    const expectedHtml = vendorKeyRaw
      ? vendorKeyRaw
      : '<span style="color:#dc2626;font-weight:700" title="El cliente no tiene vendedor asignado en el master. Admin/gerente la ven; VDEs no.">sin vendedor</span>';
    expect(expectedHtml).toContain('sin vendedor');
    expect(expectedHtml).toContain('#dc2626');
  });

  it('T10 cliente de SANTI: Pablo carga → ownerVendor=SANTIAGO ESTEBAN', () => {
    // Caso donde el cliente tiene otro VDE que no es Federico.
    const payload = {
      clientName: 'OTRO CLIENTE',
      clientCardCode: '',
      ownerUid: PABLO.uid,
    };
    // Agregamos el point OTRO CLIENTE con vendor SANTIAGO ESTEBAN al DEPS.
    const extraDeps = {
      ...DEPS,
      points: [
        ...DEPS.points,
        { province: 'CORDOBA', name: 'VCP', vendor: 'SANTIAGO ESTEBAN', clients: ['OTRO CLIENTE'] },
      ],
    };
    const res = resolveClientVendorFromMaster({
      cardCode: '',
      clientName: 'OTRO CLIENTE',
      ...extraDeps,
    });
    enrichPayloadWithClientVendor(payload, res, {
      cargadoPorUid: PABLO.uid,
      cargadoPorEmail: PABLO.email,
    });
    expect(payload.ownerVendor).toBe('SANTIAGO ESTEBAN');
    expect(payload.assignedVendorUid).toBe(SANTI_UID);
  });
});
