import { describe, expect, it } from 'vitest';
import { passesTypeFilter } from '../../src/pure/filters.js';

const specials = new Set(['SODIMAC', 'EASY', 'ESPECIAL SA']);

describe('passesTypeFilter', () => {
  it('ALL: pasa cualquier cliente', () => {
    expect(passesTypeFilter('Cualquiera', 'ALL', specials)).toBe(true);
    expect(passesTypeFilter('SODIMAC', 'ALL', specials)).toBe(true);
  });

  it('VENTAS_ESPECIALES: solo pasa si nombre normalizado está en el set', () => {
    expect(passesTypeFilter('Sodimac', 'VENTAS_ESPECIALES', specials)).toBe(true);
    expect(passesTypeFilter('  easy ', 'VENTAS_ESPECIALES', specials)).toBe(true);
    expect(passesTypeFilter('El Pez Gordo', 'VENTAS_ESPECIALES', specials)).toBe(false);
  });

  it('VENTAS_ESPECIALES: acentos normalizan', () => {
    const s = new Set(['CAFE LOPEZ']);
    expect(passesTypeFilter('Café López', 'VENTAS_ESPECIALES', s)).toBe(true);
  });

  it('DISTRIBUIDORES / EXISTENTES / PROSPECTOS: pasan (se manejan afuera)', () => {
    expect(passesTypeFilter('X', 'DISTRIBUIDORES', specials)).toBe(true);
    expect(passesTypeFilter('Y', 'EXISTENTES', specials)).toBe(true);
    expect(passesTypeFilter('Z', 'PROSPECTOS', specials)).toBe(true);
  });

  it('edge: specialSalesSet no-Set → devuelve false para VENTAS_ESPECIALES', () => {
    expect(passesTypeFilter('Sodimac', 'VENTAS_ESPECIALES', null)).toBe(false);
    expect(passesTypeFilter('Sodimac', 'VENTAS_ESPECIALES', ['SODIMAC'])).toBe(false);
  });
});
