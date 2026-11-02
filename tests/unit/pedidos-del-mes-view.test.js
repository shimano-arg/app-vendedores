import { describe, expect, it } from 'vitest';
import { filtrarClientes, fmtArs, fmtUds, totalesDe } from '../../src/pure/pedidos-del-mes-view.js';

const CLIENTES = [
  {
    cardCode: 'C1',
    nombre: 'FOLCA S.R.L',
    localidad: 'Arroyito',
    provincia: 'CORDOBA',
    vendedor: 'PACHI',
    totalArs: 1000,
    skus: [{ sku: 'A' }, { sku: 'B' }],
  },
  {
    cardCode: 'C2',
    nombre: 'PESCA SUR',
    localidad: 'Quilmes',
    provincia: 'BUENOS AIRES',
    vendedor: 'FEDERICO CASTELANELLI',
    totalArs: 500.5,
    skus: [{ sku: 'B' }, { sku: 'C' }],
  },
];

describe('v1540 APP-06 — helpers de Pedidos del mes', () => {
  it('fmtArs: miles con punto y negativos', () => {
    expect(fmtArs(1234567.6)).toBe('$ 1.234.568');
    expect(fmtArs(-2500)).toBe('-$ 2.500');
    expect(fmtArs('x')).toBe('-');
  });
  it('fmtUds: enteros tal cual, decimales con coma', () => {
    expect(fmtUds(3)).toBe('3');
    expect(fmtUds(2.5)).toBe('2,50');
  });
  it('filtrarClientes por nombre, código, localidad y vendedor', () => {
    expect(filtrarClientes(CLIENTES, 'folca', '').map((c) => c.cardCode)).toEqual(['C1']);
    expect(filtrarClientes(CLIENTES, 'c2', '').map((c) => c.cardCode)).toEqual(['C2']);
    expect(filtrarClientes(CLIENTES, 'quilmes sur', '').map((c) => c.cardCode)).toEqual(['C2']);
    expect(filtrarClientes(CLIENTES, '', 'pachi').map((c) => c.cardCode)).toEqual(['C1']);
    expect(filtrarClientes(CLIENTES, '', '')).toHaveLength(2);
    expect(filtrarClientes(null, 'x', '')).toEqual([]);
  });
  it('totalesDe: clientes, SKU distintos e importe', () => {
    expect(totalesDe(CLIENTES)).toEqual({ clientes: 2, skus: 3, ars: 1500.5 });
    expect(totalesDe([])).toEqual({ clientes: 0, skus: 0, ars: 0 });
  });
});
