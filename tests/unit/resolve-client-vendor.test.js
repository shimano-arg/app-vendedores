// @ts-check
/**
 * v1408 §46 — tests pure para resolveClientVendorFromMaster +
 * enrichPayloadWithClientVendor + formatAssignedVendorReason.
 *
 * Cubren la cadena cliente → zona (overrides) → vendedor + los 4 reasons:
 *   - ok
 *   - cliente_no_en_master (= cliente_sin_zona en UI)
 *   - zona_sin_vendedor
 *   - vendor_sin_uid
 *   - input_vacio
 *
 * Y: normalización cardCode con espacios/mayúsculas; __DISTRIBUTOR__ queda
 * como "zona_sin_vendedor"; lookup VDE en `users` (no solo vdiPartnerUsers).
 */
import { describe, expect, it } from 'vitest';
import {
  enrichPayloadWithClientVendor,
  formatAssignedVendorReason,
  resolveClientVendorFromMaster,
} from '../../src/pure/resolve-client-vendor.js';

const MAURICIO_UID = 'uid-mauricio-vde';
const PACHI_UID = 'uid-pachi-vde';
const SANTI_UID = 'uid-santi-vdi';
const PABLO_UID = 'uid-pablo-gerente';

const USERS_UNION = [
  { uid: MAURICIO_UID, email: 'mauricio@shimano.com.ar', vendorKey: 'MAURICIO GIL' },
  { uid: PACHI_UID, email: 'pachi@shimano.com.ar', vendorKey: 'PACHI' },
  { uid: SANTI_UID, email: 'santi@shimano.com.ar', vendorKey: 'SANTIAGO ESTEBAN' },
  { uid: PABLO_UID, email: 'pablo@shimano.com.ar', vendorKey: 'GERENTE_pablo' },
];

const POINTS = [
  {
    province: 'CORDOBA',
    name: 'CORDOBA CAPITAL',
    vendor: 'MAURICIO GIL',
    clients: ['COLLI RAMON ROBERTO'],
  },
  {
    province: 'BUENOS AIRES',
    name: 'MARTINEZ',
    vendor: '', // sin vendor en master
    clients: ['CLIENTE SIN ZONA'],
  },
  {
    province: 'BUENOS AIRES',
    name: 'VICENTE LOPEZ',
    vendor: '__DISTRIBUTOR__',
    clients: ['S.A. ANGEL BARALDO CIA.'],
  },
];

const CARD_CODE_MAP = {
  'COLLI RAMON ROBERTO': 'C20116066670',
  'CLIENTE SIN ZONA': 'C20200000001',
  'S.A. ANGEL BARALDO CIA.': 'C20300000002',
};

const getEffectiveVendorForClient = (p) => p.vendor || '';
const sapGetClienteCode = (name) => CARD_CODE_MAP[name] || '';

describe('resolveClientVendorFromMaster v1408 §46', () => {
  it('COLLI RAMON ROBERTO (C20116066670) resuelve a MAURICIO GIL con UID', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20116066670',
      clientName: 'COLLI RAMON ROBERTO',
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe(MAURICIO_UID);
    expect(r.resolved).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('cardCode con espacios o minúsculas resuelve igual (normalización)', () => {
    const variants = ['  C20116066670 ', 'c20116066670', 'C20116066670\n', ' c20116066670 '];
    for (const cc of variants) {
      const r = resolveClientVendorFromMaster({
        cardCode: cc,
        clientName: '',
        points: POINTS,
        users: USERS_UNION,
        getEffectiveVendorForClient,
        sapGetClienteCode,
      });
      expect(r.vendorKey, 'variante ' + JSON.stringify(cc)).toBe('MAURICIO GIL');
      expect(r.vendorUid).toBe(MAURICIO_UID);
    }
  });

  it('getCardCode con espacios en el valor del master también matchea', () => {
    const sapGetClienteCodeSpaced = (name) => {
      const base = CARD_CODE_MAP[name];
      return base ? ' ' + base.toLowerCase() + ' ' : '';
    };
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20116066670',
      clientName: '',
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode: sapGetClienteCodeSpaced,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
  });

  it('cliente sin zona en master → reason=zona_sin_vendedor', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20200000001',
      clientName: 'CLIENTE SIN ZONA',
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(false);
    expect(r.reason).toBe('zona_sin_vendedor');
    expect(r.vendorKey).toBe('');
    expect(r.vendorUid).toBe('');
  });

  it('S.A. ANGEL BARALDO con zona=__DISTRIBUTOR__ → reason=zona_sin_vendedor', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20300000002',
      clientName: 'S.A. ANGEL BARALDO CIA.',
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(false);
    expect(r.reason).toBe('zona_sin_vendedor');
  });

  it('cliente no en POINTS → reason=cliente_no_en_master', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C99999999999',
      clientName: 'INEXISTENTE',
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.reason).toBe('cliente_no_en_master');
  });

  it('vendorKey resuelto pero sin match en users → reason=vendor_sin_uid', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20116066670',
      clientName: 'COLLI RAMON ROBERTO',
      points: POINTS,
      users: [], // sin users
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(true);
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe('');
    expect(r.reason).toBe('vendor_sin_uid');
  });

  it('args vacíos → reason=input_vacio', () => {
    expect(resolveClientVendorFromMaster(null).reason).toBe('input_vacio');
    expect(resolveClientVendorFromMaster({}).reason).toBe('input_vacio');
  });

  it('acepta `vdiPartnerUsers` legacy mergeado con `users` (compat v1406)', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20116066670',
      clientName: '',
      points: POINTS,
      vdiPartnerUsers: USERS_UNION, // legacy
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.vendorUid).toBe(MAURICIO_UID);
  });

  it('clientName case-insensitive sigue funcionando', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: '',
      clientName: 'colli ramon roberto',
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
  });
});

describe('enrichPayloadWithClientVendor v1408 §46', () => {
  it('preserva reason en el payload', () => {
    const payload = {
      clientName: 'COLLI RAMON ROBERTO',
      clientCardCode: 'C20116066670',
      ownerUid: PABLO_UID,
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    enrichPayloadWithClientVendor(payload, res, {
      cargadoPorUid: PABLO_UID,
      cargadoPorEmail: 'pablo@shimano.com.ar',
    });
    expect(payload.vendorAssigned).toBe('MAURICIO GIL');
    expect(payload.assignedVendorUid).toBe(MAURICIO_UID);
    expect(payload.ownerVendor).toBe('MAURICIO GIL');
    expect(payload.assignedVendorReason).toBe('ok');
  });

  it('cliente sin zona → payload.assignedVendorReason=zona_sin_vendedor', () => {
    const payload = {
      clientName: 'CLIENTE SIN ZONA',
      clientCardCode: 'C20200000001',
      ownerUid: PABLO_UID,
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      points: POINTS,
      users: USERS_UNION,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    enrichPayloadWithClientVendor(payload, res);
    expect(payload.vendorAssigned).toBe('');
    expect(payload.assignedVendorReason).toBe('zona_sin_vendedor');
  });

  it('idempotente: assignedVendorUid preexistente → NO re-pisa reason', () => {
    const payload = {
      clientName: 'COLLI RAMON ROBERTO',
      clientCardCode: 'C20116066670',
      assignedVendorUid: 'other-uid',
      vendorAssigned: 'OTRO VENDOR',
      ownerVendor: 'OTRO VENDOR',
      assignedVendorReason: 'ok',
    };
    const res = {
      vendorKey: 'MAURICIO GIL',
      vendorUid: MAURICIO_UID,
      vendorEmail: '',
      resolved: true,
      reason: 'ok',
    };
    enrichPayloadWithClientVendor(payload, res);
    expect(payload.assignedVendorUid).toBe('other-uid');
    expect(payload.vendorAssigned).toBe('OTRO VENDOR');
  });
});

describe('formatAssignedVendorReason v1408 §46', () => {
  it('traduce reasons a texto UI', () => {
    expect(formatAssignedVendorReason('cliente_no_en_master')).toBe('cliente sin zona');
    expect(formatAssignedVendorReason('cliente_sin_zona')).toBe('cliente sin zona');
    expect(formatAssignedVendorReason('zona_sin_vendedor')).toBe('zona sin vendedor');
    expect(formatAssignedVendorReason('vendor_sin_uid')).toBe('vendedor sin usuario');
    expect(formatAssignedVendorReason('input_vacio')).toBe('sin cliente');
    expect(formatAssignedVendorReason('ok')).toBe('');
    expect(formatAssignedVendorReason('')).toBe('');
  });
});
