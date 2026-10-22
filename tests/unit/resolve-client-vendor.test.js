// @ts-check
/**
 * v1406 §44 — tests pure para resolveClientVendorFromMaster +
 * enrichPayloadWithClientVendor.
 */
import { describe, expect, it } from 'vitest';
import {
  enrichPayloadWithClientVendor,
  resolveClientVendorFromMaster,
} from '../../src/pure/resolve-client-vendor.js';

const FEDERICO_UID = 'uid-federico-xyz';
const SANTI_UID = 'uid-santi-abc';
const PABLO_UID = 'uid-pablo-pqr';

const VDI_USERS = [
  { uid: FEDERICO_UID, email: 'federico@shimano.com.ar', vendorKey: 'FEDERICO' },
  { uid: SANTI_UID, email: 'santi@shimano.com.ar', vendorKey: 'SANTIAGO ESTEBAN' },
  { uid: PABLO_UID, email: 'pablo@shimano.com.ar', vendorKey: 'ADMIN_pablo' },
];

const POINTS = [
  {
    province: 'BUENOS AIRES',
    name: 'LA PLATA',
    vendor: 'FEDERICO',
    clients: ['ALBERTO PONTORIERO'],
  },
  {
    province: 'CORDOBA',
    name: 'VILLA CARLOS PAZ',
    vendor: 'SANTIAGO ESTEBAN',
    clients: ['OTRO CLIENTE'],
  },
  {
    province: 'MENDOZA',
    name: 'SAN RAFAEL',
    vendor: '', // sin vendedor en master
    clients: ['CLIENTE SIN VENDOR'],
  },
];

const CARD_CODE_MAP = {
  'ALBERTO PONTORIERO': 'C20175569635',
  'OTRO CLIENTE': 'C20200000001',
  'CLIENTE SIN VENDOR': 'C20300000002',
};

const getEffectiveVendorForClient = (p) => p.vendor || '';
const sapGetClienteCode = (name) => CARD_CODE_MAP[name] || '';

describe('resolveClientVendorFromMaster', () => {
  it('resuelve por cardCode exacto', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20175569635',
      clientName: '',
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(true);
    expect(r.vendorKey).toBe('FEDERICO');
    expect(r.vendorUid).toBe(FEDERICO_UID);
    expect(r.vendorEmail).toBe('federico@shimano.com.ar');
  });

  it('resuelve por clientName cuando no hay cardCode', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: '',
      clientName: 'OTRO CLIENTE',
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(true);
    expect(r.vendorKey).toBe('SANTIAGO ESTEBAN');
    expect(r.vendorUid).toBe(SANTI_UID);
  });

  it('cliente sin vendedor en master → resolved=false, vendorKey=""', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20300000002',
      clientName: 'CLIENTE SIN VENDOR',
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(false);
    expect(r.vendorKey).toBe('');
    expect(r.vendorUid).toBe('');
  });

  it('cliente no encontrado en master → resolved=false', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C99999999999',
      clientName: 'INEXISTENTE',
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(false);
  });

  it('vendorKey sin UID en vdiPartnerUsers → vendorKey populated pero vendorUid vacío', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20175569635',
      clientName: 'ALBERTO PONTORIERO',
      points: POINTS,
      vdiPartnerUsers: [], // sin users cache
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.resolved).toBe(true);
    expect(r.vendorKey).toBe('FEDERICO');
    expect(r.vendorUid).toBe('');
    expect(r.vendorEmail).toBe('');
  });

  it('args vacíos → EMPTY', () => {
    expect(resolveClientVendorFromMaster(null).resolved).toBe(false);
    expect(resolveClientVendorFromMaster({}).resolved).toBe(false);
  });

  it('clientName case-insensitive', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: '',
      clientName: 'alberto pontoriero',
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    expect(r.vendorKey).toBe('FEDERICO');
  });
});

describe('enrichPayloadWithClientVendor', () => {
  it('setea los 4 campos del vendor + cargadoPor', () => {
    const payload = {
      clientName: 'ALBERTO PONTORIERO',
      clientCardCode: 'C20175569635',
      ownerUid: PABLO_UID,
      ownerEmail: 'pablo@shimano.com.ar',
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    enrichPayloadWithClientVendor(payload, res, {
      cargadoPorUid: PABLO_UID,
      cargadoPorEmail: 'pablo@shimano.com.ar',
    });
    expect(payload.vendorAssigned).toBe('FEDERICO');
    expect(payload.assignedVendorUid).toBe(FEDERICO_UID);
    expect(payload.assignedVendorEmail).toBe('federico@shimano.com.ar');
    expect(payload.ownerVendor).toBe('FEDERICO');
    expect(payload.cargadoPorUid).toBe(PABLO_UID);
    expect(payload.cargadoPorEmail).toBe('pablo@shimano.com.ar');
    // ownerUid NO cambia (sigue siendo quien carga; rules lo requieren).
    expect(payload.ownerUid).toBe(PABLO_UID);
  });

  it('cliente sin vendedor en master → ownerVendor + vendorAssigned vacíos', () => {
    const payload = {
      clientName: 'CLIENTE SIN VENDOR',
      clientCardCode: 'C20300000002',
      ownerUid: PABLO_UID,
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    enrichPayloadWithClientVendor(payload, res, { cargadoPorUid: PABLO_UID });
    expect(payload.vendorAssigned).toBe('');
    expect(payload.assignedVendorUid).toBe('');
    expect(payload.ownerVendor).toBe('');
    expect(payload.cargadoPorUid).toBe(PABLO_UID);
  });

  it('idempotente: payload con assignedVendorUid preexistente NO se pisa', () => {
    const payload = {
      clientName: 'OTRO CLIENTE',
      clientCardCode: 'C20200000001',
      // Target de unificación que ya tiene vendor resuelto previamente.
      assignedVendorUid: SANTI_UID,
      vendorAssigned: 'SANTIAGO ESTEBAN',
      ownerVendor: 'SANTIAGO ESTEBAN',
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      points: POINTS,
      vdiPartnerUsers: VDI_USERS,
      getEffectiveVendorForClient,
      sapGetClienteCode,
    });
    enrichPayloadWithClientVendor(payload, res, { cargadoPorUid: PABLO_UID });
    expect(payload.assignedVendorUid).toBe(SANTI_UID);
    expect(payload.vendorAssigned).toBe('SANTIAGO ESTEBAN');
    expect(payload.ownerVendor).toBe('SANTIAGO ESTEBAN');
  });

  it('cargadoPor fallback a ownerUid/ownerEmail si no se pasa', () => {
    const payload = {
      clientName: 'ALBERTO PONTORIERO',
      clientCardCode: 'C20175569635',
      ownerUid: PABLO_UID,
      ownerEmail: 'pablo@shimano.com.ar',
    };
    const res = {
      vendorKey: 'FEDERICO',
      vendorUid: FEDERICO_UID,
      vendorEmail: 'federico@shimano.com.ar',
      resolved: true,
    };
    enrichPayloadWithClientVendor(payload, res);
    expect(payload.cargadoPorUid).toBe(PABLO_UID);
    expect(payload.cargadoPorEmail).toBe('pablo@shimano.com.ar');
  });

  it('devuelve el mismo payload (mutado) para encadenar', () => {
    const payload = { ownerUid: PABLO_UID };
    const res = { vendorKey: 'FEDERICO', vendorUid: FEDERICO_UID, vendorEmail: '', resolved: true };
    const ret = enrichPayloadWithClientVendor(payload, res);
    expect(ret).toBe(payload);
  });
});
