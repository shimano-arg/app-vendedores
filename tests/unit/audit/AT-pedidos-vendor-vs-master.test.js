// v1534 (2026-11-02) — Etapa 0 auditoría 46: lógica pura del script read-only
// scripts/audit/AT_pedidos_vendor_vs_master.cjs.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildMasterResolver,
  buildVendorKeyToUser,
  classifyPedido,
  aggregateByVendor,
  pedidoInScope,
  filterRowsByVendor,
} = require('../../../scripts/audit/AT_pedidos_vendor_vs_master.cjs');

const roles = [
  { id: 'uid-pachi', role: 'vendedor', vendor: 'PACHI', email: 'p@x' },
  { id: 'uid-pachi-test', role: 'admin', vendor: 'PACHI', email: 't@x' },
  { id: 'uid-gonza', role: 'vendedor', vendor: 'GONZALO DE LA ROSA', email: 'g@x' },
];
const ocrd = [
  {
    id: 'C1',
    CardCode: 'C1',
    CardName: 'TIENDA UNO',
    SlpName: 'GONZALO DE LA ROSA',
    Provincia: 'CORDOBA',
    Localidad: 'CENTRO',
  },
  {
    id: 'C2',
    CardCode: 'C2',
    CardName: 'TIENDA DOS',
    SlpName: 'GONZALO DE LA ROSA',
    Provincia: 'CORDOBA',
    Localidad: 'CENTRO',
  },
];
const overrides = [{ id: 'SHOP|CORDOBA|CENTRO|TIENDA DOS', newVendor: 'PACHI' }];
const altas = [{ cardCodeSap: 'C3', comercio: 'ALTA TRES', assignedVendor: 'Z4 - Pachi' }];

const users = buildVendorKeyToUser(roles);
const resolve = buildMasterResolver({ ocrd, overrides, altas, vendorKeyToUser: users });

describe('resolver del master (OCRD + overrides + altas)', () => {
  it('OCRD base', () => {
    expect(resolve('C1', '').vendorKey).toBe('GONZALO DE LA ROSA');
  });
  it('override SHOP gana sobre SlpName', () => {
    expect(resolve('c2', '').vendorKey).toBe('PACHI');
  });
  it('alta SAP con label "Z4 - Pachi" se normaliza', () => {
    const r = resolve('C3', '');
    expect(r.vendorKey).toBe('PACHI');
    expect(r.uid).toBe('uid-pachi'); // vendedor gana sobre admin con el mismo vendor
  });
  it('cliente desconocido', () => {
    expect(resolve('C9', 'NADIE').reason).toBe('cliente_no_en_master');
  });
});

describe('classifyPedido + aggregateByVendor', () => {
  const uidToVendorKey = new Map(roles.map((r) => [r.id, r.vendor]));
  const pedidos = [
    { _id: 'A', clientCardCode: 'C2', assignedVendorUid: 'uid-pachi' }, // alineado
    { _id: 'B', clientCardCode: 'C1', assignedVendorUid: 'uid-pachi' }, // ajeno que ve PACHI
    { _id: 'C', clientCardCode: 'C3', assignedVendorUid: 'uid-gonza' }, // propio de PACHI que no ve
    { _id: 'D', clientCardCode: 'C9', assignedVendorUid: 'uid-pachi' }, // sin master
    { _id: 'E', clientCardCode: 'C2', assignedVendorUid: 'uid-pachi-test' }, // mismo vendor, otro uid
  ];
  const rows = pedidos.map((p) =>
    classifyPedido(p, resolve, { uidToVendorKey, vendorKeyToUser: users })
  );

  it('estados', () => {
    expect(rows.map((r) => r.estado)).toEqual([
      'alineado',
      'ajeno_visible',
      'ajeno_visible',
      'sin_master',
      'uid_distinto',
    ]);
  });
  it('totales por vendedor', () => {
    const agg = aggregateByVendor(rows);
    expect(agg.PACHI).toEqual({ veHoy: 3, ajenosQueVe: 1, propiosQueNoVe: 2, sinMaster: 1 });
    // Otro usuario con el mismo vendor (ej. cuenta de pruebas): se lista aparte.
    expect(agg['PACHI [uid-pachi-test]']).toEqual({
      veHoy: 1,
      ajenosQueVe: 0,
      propiosQueNoVe: 0,
      sinMaster: 0,
    });
    expect(agg['GONZALO DE LA ROSA']).toEqual({
      veHoy: 1,
      ajenosQueVe: 1,
      propiosQueNoVe: 1,
      sinMaster: 0,
    });
  });
  it('filtro --vendor', () => {
    expect(filterRowsByVendor(rows, 'gonzalo de la rosa').map((r) => r.pedidoId)).toEqual([
      'B',
      'C',
    ]);
  });
});

describe('pedidoInScope', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  const cutoff = now - 90 * 86400000;
  it('abiertos siempre; cerrados solo si se crearon después del corte', () => {
    expect(pedidoInScope({ closedAt: null, createdAt: '2025-01-01T00:00:00Z' }, cutoff)).toBe(true);
    expect(pedidoInScope({ closedAt: 'x', createdAt: '2026-10-01T00:00:00Z' }, cutoff)).toBe(true);
    expect(pedidoInScope({ closedAt: 'x', createdAt: '2026-01-01T00:00:00Z' }, cutoff)).toBe(false);
    expect(
      pedidoInScope(
        { closedAt: 'x', createdAt: { toDate: () => new Date(now - 86400000) } },
        cutoff
      )
    ).toBe(true);
  });
});
