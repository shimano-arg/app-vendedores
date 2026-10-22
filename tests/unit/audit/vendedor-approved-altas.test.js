// @ts-check
/**
 * v1412 §50 — altas SAP huérfanas (approvedAltasList) como SEGUNDA fuente del
 * master. Antes del fix, `resolveClientVendorFromMaster` solo consultaba
 * POINTS → clientes sync-SAP sin POINT histórico quedaban sin vendedor en el
 * Planner aunque el Master Clientes los mostraba con zona asignada.
 *
 * Casos reales Mariano:
 *   - JOSE LUIS BURELLA (C20203196122) orden 515 — Z5 Mauricio en master,
 *     IOANNIS PALKOUDAKIS en Planner (porque fallback a user logueado).
 *   - COLLI RAMON ROBERTO (C20116066670) orden 384 — Z5 Mauricio en master,
 *     "sin vendedor" en Planner.
 */
import { describe, expect, it } from 'vitest';
import {
  enrichPayloadWithClientVendor,
  resolveClientVendorFromMaster,
} from '../../../src/pure/resolve-client-vendor.js';

const MAURICIO_UID = 'uid-mauricio-gil';
const FEDE_UID = 'uid-federico';
const USERS = [
  { uid: MAURICIO_UID, email: 'mauricio.gil@shimano.com.ar', vendorKey: 'MAURICIO GIL' },
  { uid: FEDE_UID, email: 'federico@shimano.com.ar', vendorKey: 'FEDERICO CASTELANELLI' },
];

const APPROVED_ALTAS = [
  {
    _fsId: 'alta-burella',
    cardCodeSap: 'C20203196122',
    comercio: 'JOSE LUIS BURELLA',
    fantasia: 'BURELLA PESCA',
    provincia: 'CORDOBA',
    localidad: 'CORDOBA',
    assignedVendor: 'MAURICIO GIL',
  },
  {
    _fsId: 'alta-colli',
    cardCodeSap: 'C20116066670',
    comercio: 'COLLI RAMON ROBERTO',
    fantasia: null,
    provincia: 'CORDOBA',
    localidad: 'CORDOBA',
    assignedVendor: 'MAURICIO GIL',
  },
  {
    _fsId: 'alta-label-formato',
    cardCodeSap: 'C20300000333',
    comercio: 'CLIENTE LABEL',
    assignedVendor: 'Z5 - Mauricio Gil', // guardado histórico con label
  },
  {
    _fsId: 'alta-sin-vendor',
    cardCodeSap: 'C20300000999',
    comercio: 'CLIENTE SIN VENDOR',
    assignedVendor: '',
  },
];

const POINTS = []; // ningún point tiene estos clientes (son huérfanos)

const deps = {
  points: POINTS,
  approvedAltas: APPROVED_ALTAS,
  users: USERS,
  getEffectiveVendorForClient: (p) => p.vendor || '',
  sapGetClienteCode: () => '',
};

describe('v1412 §50 — approvedAltas como 2da fuente del master', () => {
  it('BURELLA (C20203196122) sin POINT → resuelve via alta a MAURICIO GIL', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20203196122',
      clientName: 'JOSE LUIS BURELLA',
      ...deps,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe(MAURICIO_UID);
    expect(r.reason).toBe('ok');
    expect(r.source).toBe('approvedAlta');
  });

  it('COLLI (C20116066670) sin POINT → resuelve via alta a MAURICIO GIL', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20116066670',
      clientName: 'COLLI RAMON ROBERTO',
      ...deps,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe(MAURICIO_UID);
    expect(r.reason).toBe('ok');
  });

  it('alta con assignedVendor label histórico "Z5 - Mauricio Gil" normaliza a MAURICIO GIL', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20300000333',
      clientName: '',
      ...deps,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe(MAURICIO_UID);
  });

  it('alta con assignedVendor vacío → zona_sin_vendedor', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20300000999',
      clientName: 'CLIENTE SIN VENDOR',
      ...deps,
    });
    expect(r.reason).toBe('zona_sin_vendedor');
    expect(r.vendorKey).toBe('');
  });

  it('cardCode no en POINTS ni en approvedAltas → cliente_no_en_master', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C00000000000',
      clientName: 'DESCONOCIDO',
      ...deps,
    });
    expect(r.reason).toBe('cliente_no_en_master');
  });

  it('match por fantasia (clientName === fantasia)', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: '',
      clientName: 'BURELLA PESCA', // = fantasia de BURELLA
      ...deps,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
  });

  it('match por comercio (clientName === comercio)', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: '',
      clientName: 'jose luis burella', // case-insensitive
      ...deps,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
  });
});

describe('v1412 §50 — POINTS tienen prioridad sobre approvedAltas', () => {
  it('cliente en POINTS + alta → gana POINTS', () => {
    const pointWithFederico = {
      province: 'BUENOS AIRES',
      name: 'LA PLATA',
      vendor: 'FEDERICO CASTELANELLI',
      clients: ['CLIENTE DOBLE'],
    };
    const altaConMauricio = {
      cardCodeSap: 'C20400000001',
      comercio: 'CLIENTE DOBLE',
      assignedVendor: 'MAURICIO GIL',
    };
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20400000001',
      clientName: 'CLIENTE DOBLE',
      points: [pointWithFederico],
      approvedAltas: [altaConMauricio],
      users: USERS,
      getEffectiveVendorForClient: (p) => p.vendor || '',
      sapGetClienteCode: (n) => (n === 'CLIENTE DOBLE' ? 'C20400000001' : ''),
    });
    expect(r.vendorKey).toBe('FEDERICO CASTELANELLI');
    expect(r.source).toBe('point');
  });
});

describe('v1412 §50 — payload enriquecido con reason + source', () => {
  it('payload para BURELLA tiene vendorAssigned + assignedVendorUid + reason=ok', () => {
    const payload = {
      clientName: 'JOSE LUIS BURELLA',
      clientCardCode: 'C20203196122',
      ownerUid: 'uid-ioannis',
      ownerVendor: 'IOANNIS PALKOUDAKIS', // legacy fallback del user logueado
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      ...deps,
    });
    enrichPayloadWithClientVendor(payload, res);
    expect(payload.vendorAssigned).toBe('MAURICIO GIL');
    expect(payload.assignedVendorUid).toBe(MAURICIO_UID);
    expect(payload.ownerVendor).toBe('MAURICIO GIL'); // PISA el "IOANNIS PALKOUDAKIS" legacy
    expect(payload.assignedVendorReason).toBe('ok');
  });
});
