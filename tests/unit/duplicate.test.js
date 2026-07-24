import { describe, it, expect } from 'vitest';
import { findSapDuplicateForProvisorio } from '../../src/pure/duplicate.js';

const sap = (over) => ({
  _fsId: 'sap-1',
  cardCodeSap: 'C100',
  provincia: 'Buenos Aires',
  localidad: 'Quilmes',
  ...over,
});
const prov = (over) => ({
  _fsId: 'prov-1',
  manualSapPending: true,
  cardCodeSap: null,
  provincia: 'Buenos Aires',
  localidad: 'Quilmes',
  ...over,
});

describe('findSapDuplicateForProvisorio', () => {
  it('happy: mismo nombre + misma provincia/localidad → match', () => {
    const p = prov({ comercio: 'El Pez Gordo' });
    const list = [sap({ comercio: 'El Pez Gordo' })];
    expect(findSapDuplicateForProvisorio(p, list)?._fsId).toBe('sap-1');
  });

  it('happy: nombres similares (>=2 tokens comunes) → match', () => {
    const p = prov({ comercio: 'Pescadería La Ballena Roja' });
    const list = [sap({ comercio: 'Pescadería Ballena Roja Tienda' })];
    expect(findSapDuplicateForProvisorio(p, list)).not.toBeNull();
  });

  it('nombres muy distintos → null', () => {
    const p = prov({ comercio: 'El Pez Gordo' });
    const list = [sap({ comercio: 'Ferretería Central' })];
    expect(findSapDuplicateForProvisorio(p, list)).toBeNull();
  });

  it('provincia distinta → null aunque nombre matchee', () => {
    const p = prov({ comercio: 'El Pez Gordo', provincia: 'Buenos Aires' });
    const list = [sap({ comercio: 'El Pez Gordo', provincia: 'Córdoba' })];
    expect(findSapDuplicateForProvisorio(p, list)).toBeNull();
  });

  it('localidad distinta → null', () => {
    const p = prov({ comercio: 'El Pez Gordo', localidad: 'Quilmes' });
    const list = [sap({ comercio: 'El Pez Gordo', localidad: 'La Plata' })];
    expect(findSapDuplicateForProvisorio(p, list)).toBeNull();
  });

  it('candidato sin cardCodeSap NO cuenta (es otro provisorio)', () => {
    const p = prov({ comercio: 'El Pez Gordo' });
    const list = [{ ...sap({ comercio: 'El Pez Gordo' }), cardCodeSap: null, manualSapPending: true }];
    expect(findSapDuplicateForProvisorio(p, list)).toBeNull();
  });

  it('input no-provisorio → null (guard)', () => {
    const p = { manualSapPending: false, comercio: 'X' };
    expect(findSapDuplicateForProvisorio(p, [sap({ comercio: 'X' })])).toBeNull();
  });

  it('input con cardCodeSap ya asignado → null (ya no es provisorio)', () => {
    const p = prov({ comercio: 'X', cardCodeSap: 'C999' });
    expect(findSapDuplicateForProvisorio(p, [sap({ comercio: 'X' })])).toBeNull();
  });

  it('sin provincia/localidad → null (rule del helper)', () => {
    const p = prov({ comercio: 'El Pez Gordo', provincia: '', localidad: '' });
    expect(findSapDuplicateForProvisorio(p, [sap({ comercio: 'El Pez Gordo' })])).toBeNull();
  });

  it('lista vacía o inválida → null', () => {
    expect(findSapDuplicateForProvisorio(prov({ comercio: 'X' }), [])).toBeNull();
    expect(findSapDuplicateForProvisorio(prov({ comercio: 'X' }), null)).toBeNull();
  });

  it('stopwords no cuentan como tokens (2 tokens comunes de "de la la" ≠ match)', () => {
    const p = prov({ comercio: 'De La Pesca' });
    const list = [sap({ comercio: 'De La Tienda' })];
    // "de", "la", "pesca", "tienda" son todos stopwords → 0 tokens sig.
    expect(findSapDuplicateForProvisorio(p, list)).toBeNull();
  });

  it('substring: uno contiene al otro (>=2 tokens ya no requerido)', () => {
    const p = prov({ comercio: 'Bahia' });
    const list = [sap({ comercio: 'Bahia Blanca Store' })];
    // provNameNorm 'bahia' incluido en candNameNorm 'bahia blanca store'
    expect(findSapDuplicateForProvisorio(p, list)).not.toBeNull();
  });
});
