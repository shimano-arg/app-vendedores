// v1545: alcance de Master Clientes por rol (src/pure/master-clientes-scope.js).
import { describe, expect, it } from 'vitest';
import { buildMasterClientesScope } from '../../src/pure/master-clientes-scope.js';

const ENTRIES = [
  { nombre: 'A', vendor: 'PACHI' },
  { nombre: 'B', vendor: 'MAURICIO GIL' },
  { nombre: 'C', vendor: 'FEDERICO CASTELANELLI' },
  { nombre: 'D', vendor: '' },
  { nombre: 'E', vendor: 'pachi ' },
];
const v = (e) => e.vendor;

describe('v1545 buildMasterClientesScope', () => {
  it('admin y gerente: ven todo y editan', () => {
    for (const role of ['admin', 'gerente']) {
      const sc = buildMasterClientesScope({ role, myVendorKey: 'PACHI' });
      expect(sc.canOpen).toBe(true);
      expect(sc.isGlobal).toBe(true);
      expect(sc.readOnly).toBe(false);
      expect(sc.fixedVendorKey).toBe(null);
      expect(sc.filter(ENTRIES, v)).toHaveLength(ENTRIES.length);
    }
  });

  it('vendedor (PACHI): solo sus clientes, solo lectura, vendedor fijo', () => {
    const sc = buildMasterClientesScope({ role: 'vendedor', myVendorKey: 'PACHI' });
    expect(sc.canOpen).toBe(true);
    expect(sc.readOnly).toBe(true);
    expect(sc.fixedVendorKey).toBe('PACHI');
    // Compara normalizado (trim + mayúsculas): 'pachi ' también es suyo.
    expect(sc.filter(ENTRIES, v).map((e) => e.nombre)).toEqual(['A', 'E']);
  });

  it('vendedor: nunca ve clientes sin vendedor ni de otro vendedor', () => {
    const sc = buildMasterClientesScope({ role: 'vendedor', myVendorKey: 'MAURICIO GIL' });
    expect(sc.filter(ENTRIES, v).map((e) => e.nombre)).toEqual(['B']);
    expect(sc.allowsVendor('')).toBe(false);
    expect(sc.allowsVendor('PACHI')).toBe(false);
  });

  it('vendedor sin vendedor asignado: entra pero no ve nada', () => {
    const sc = buildMasterClientesScope({ role: 'vendedor', myVendorKey: '' });
    expect(sc.canOpen).toBe(true);
    expect(sc.fixedVendorKey).toBe(null);
    expect(sc.filter(ENTRIES, v)).toEqual([]);
  });

  it('interno: su zona + parejas, solo lectura', () => {
    const sc = buildMasterClientesScope({
      role: 'interno',
      myVendorKey: 'SANTIAGO ESTEBAN',
      allowedVendorKeys: new Set(['MAURICIO GIL', 'FEDERICO CASTELANELLI']),
    });
    expect(sc.readOnly).toBe(true);
    expect(sc.fixedVendorKey).toBe(null);
    expect(sc.filter(ENTRIES, v).map((e) => e.nombre)).toEqual(['B', 'C']);
  });

  it('rol desconocido, viewer o sin rol: no entra y no ve nada', () => {
    for (const role of ['viewer', 'unassigned', '', null, undefined, 'otro']) {
      const sc = buildMasterClientesScope({ role, myVendorKey: 'PACHI' });
      expect(sc.canOpen).toBe(false);
      expect(sc.filter(ENTRIES, v)).toEqual([]);
    }
  });

  it('filter no muta el array original', () => {
    const arr = ENTRIES.slice();
    buildMasterClientesScope({ role: 'vendedor', myVendorKey: 'PACHI' }).filter(arr, v);
    expect(arr).toEqual(ENTRIES);
  });
});
