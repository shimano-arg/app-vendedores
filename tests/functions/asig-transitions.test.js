import { describe, it, expect, vi } from 'vitest';
import {
  detectAsigTransitions,
  writeTransitionsBatch,
} from '../../functions/core/asig-transitions-core.js';

const baseMeta = {
  clientCardCode: 'C33651833669',
  clientName: 'ANGLERS',
  ownerVendor: 'MARTIN BOIERO',
  province: 'CORDOBA',
  locName: 'CORDOBA CAPITAL',
};

describe('detectAsigTransitions', () => {
  it('devuelve array vacio si no hay cambios de state', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU1', qty: 10, qtyOpen: 10, state: 'ASIG' }] };
    const after = { ...baseMeta, lines: [{ code: 'SKU1', qty: 10, qtyOpen: 10, state: 'ASIG' }] };
    expect(detectAsigTransitions('P1', before, after)).toEqual([]);
  });

  it('detecta ASIG -> confirmed', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU1', qty: 10, qtyOpen: 10, state: 'ASIG' }] };
    const after = { ...baseMeta, lines: [{ code: 'SKU1', qty: 10, qtyOpen: 10, state: 'confirmed' }] };
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      pedidoId: 'P1',
      lineIdx: 0,
      sku: 'SKU1',
      fromState: 'ASIG',
      toState: 'confirmed',
      qty: 10,
      clientCardCode: 'C33651833669',
      vendor: 'MARTIN BOIERO',
    });
  });

  it('detecta ASIG -> cancelled', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU2', qty: 5, qtyOpen: 5, state: 'ASIG' }] };
    const after = { ...baseMeta, lines: [{ code: 'SKU2', qty: 5, qtyOpen: 5, state: 'cancelled' }] };
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(1);
    expect(r[0].fromState).toBe('ASIG');
    expect(r[0].toState).toBe('cancelled');
    expect(r[0].qty).toBe(5);
  });

  it('detecta ASIG -> recycled', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU3', qty: 3, qtyOpen: 3, state: 'ASIG' }] };
    const after = { ...baseMeta, lines: [{ code: 'SKU3', qty: 3, qtyOpen: 3, state: 'recycled' }] };
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(1);
    expect(r[0].toState).toBe('recycled');
  });

  it('detecta ASIG -> invoiced', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU4', qty: 7, qtyOpen: 7, state: 'ASIG' }] };
    const after = { ...baseMeta, lines: [{ code: 'SKU4', qty: 7, qtyOpen: 0, state: 'invoiced' }] };
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(1);
    expect(r[0].toState).toBe('invoiced');
    expect(r[0].qty).toBe(7); // qty pre-transicion (qtyOpen del before)
  });

  it('detecta BO -> ASIG (entrada a ASIG)', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU5', qty: 4, qtyOpen: 4, state: 'BO' }] };
    const after = { ...baseMeta, lines: [{ code: 'SKU5', qty: 4, qtyOpen: 4, state: 'ASIG' }] };
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(1);
    expect(r[0].fromState).toBe('BO');
    expect(r[0].toState).toBe('ASIG');
    expect(r[0].qty).toBe(4);
  });

  it('ignora cambios que no involucran ASIG', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU6', qty: 1, qtyOpen: 1, state: 'confirmed' }] };
    const after = { ...baseMeta, lines: [{ code: 'SKU6', qty: 1, qtyOpen: 0, state: 'invoiced' }] };
    expect(detectAsigTransitions('P1', before, after)).toEqual([]);
  });

  it('detecta multiples transiciones en el mismo pedido', () => {
    const before = { ...baseMeta, lines: [
      { code: 'SKU1', qty: 10, qtyOpen: 10, state: 'ASIG' },
      { code: 'SKU2', qty: 5, qtyOpen: 5, state: 'ASIG' },
      { code: 'SKU3', qty: 3, qtyOpen: 3, state: 'BO' },
    ]};
    const after = { ...baseMeta, lines: [
      { code: 'SKU1', qty: 10, qtyOpen: 10, state: 'confirmed' },
      { code: 'SKU2', qty: 5, qtyOpen: 5, state: 'cancelled' },
      { code: 'SKU3', qty: 3, qtyOpen: 3, state: 'BO' },  // sin cambio
    ]};
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(2);
    expect(r[0].sku).toBe('SKU1');
    expect(r[0].toState).toBe('confirmed');
    expect(r[1].sku).toBe('SKU2');
    expect(r[1].toState).toBe('cancelled');
  });

  it('detecta linea eliminada del array (assume cancelled)', () => {
    const before = { ...baseMeta, lines: [
      { code: 'SKU1', qty: 10, qtyOpen: 10, state: 'ASIG' },
      { code: 'SKU2', qty: 5, qtyOpen: 5, state: 'ASIG' },
    ]};
    const after = { ...baseMeta, lines: [
      { code: 'SKU1', qty: 10, qtyOpen: 10, state: 'ASIG' },
      // SKU2 eliminada
    ]};
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('SKU2');
    expect(r[0].lineIdx).toBe(1);
    expect(r[0].toState).toBe('cancelled');
    expect(r[0].qty).toBe(5);
  });

  it('detecta linea nueva creada directo en ASIG', () => {
    const before = { ...baseMeta, lines: [] };
    const after = { ...baseMeta, lines: [{ code: 'SKU_NEW', qty: 2, qtyOpen: 2, state: 'ASIG' }] };
    const r = detectAsigTransitions('P1', before, after);
    expect(r).toHaveLength(1);
    expect(r[0].fromState).toBe('new');
    expect(r[0].toState).toBe('ASIG');
  });

  it('no trackea line nueva que no sea ASIG', () => {
    const before = { ...baseMeta, lines: [] };
    const after = { ...baseMeta, lines: [{ code: 'SKU', qty: 1, qtyOpen: 1, state: 'confirmed' }] };
    expect(detectAsigTransitions('P1', before, after)).toEqual([]);
  });

  it('devuelve array vacio si pedidoId es falsy', () => {
    expect(detectAsigTransitions('', {}, {})).toEqual([]);
    expect(detectAsigTransitions(null, {}, {})).toEqual([]);
  });

  it('maneja before o after null (create/delete del doc)', () => {
    const after = { ...baseMeta, lines: [{ code: 'SKU', qty: 1, qtyOpen: 1, state: 'ASIG' }] };
    // Create: before null. Debe detectar como 'new' -> 'ASIG'.
    const rCreate = detectAsigTransitions('P1', null, after);
    expect(rCreate).toHaveLength(1);
    expect(rCreate[0].toState).toBe('ASIG');
    // Delete: after null. Debe detectar como 'ASIG' -> 'cancelled'.
    const rDelete = detectAsigTransitions('P1', after, null);
    expect(rDelete).toHaveLength(1);
    expect(rDelete[0].fromState).toBe('ASIG');
    expect(rDelete[0].toState).toBe('cancelled');
  });

  it('lee metadata del cliente/vendor desde after cuando existe', () => {
    const before = { ...baseMeta, lines: [{ code: 'SKU', qty: 1, qtyOpen: 1, state: 'ASIG' }] };
    const after = {
      clientCardCode: 'NEW_CARD',
      clientName: 'NEW CLIENT',
      ownerVendor: 'OTHER_VENDOR',
      province: 'BUENOS AIRES',
      locName: 'CABA',
      lines: [{ code: 'SKU', qty: 1, qtyOpen: 1, state: 'confirmed' }],
    };
    const r = detectAsigTransitions('P1', before, after);
    expect(r[0].clientName).toBe('NEW CLIENT');
    expect(r[0].vendor).toBe('OTHER_VENDOR');
  });
});

describe('writeTransitionsBatch', () => {
  it('devuelve 0 sin escribir si el array esta vacio', async () => {
    const fbDb = { batch: vi.fn(), collection: vi.fn() };
    const result = await writeTransitionsBatch({ fbDb, FieldValue: {} }, []);
    expect(result).toBe(0);
    expect(fbDb.batch).not.toHaveBeenCalled();
  });

  it('escribe cada transicion como doc auto-id con month + serverTimestamp', async () => {
    const setSpy = vi.fn();
    const commitSpy = vi.fn().mockResolvedValue(undefined);
    const docSpy = vi.fn().mockReturnValue({ id: 'auto-id' });
    const collectionSpy = vi.fn().mockReturnValue({ doc: docSpy });
    const batchSpy = vi.fn().mockReturnValue({ set: setSpy, commit: commitSpy });
    const fbDb = { batch: batchSpy, collection: collectionSpy };
    const FieldValue = { serverTimestamp: () => 'STAMP' };

    const transitions = [
      { pedidoId: 'P1', lineIdx: 0, sku: 'SKU1', fromState: 'ASIG', toState: 'confirmed', qty: 10, clientCardCode: 'C1', clientName: 'CLI', vendor: 'V', province: 'BA', locName: 'L' },
      { pedidoId: 'P1', lineIdx: 1, sku: 'SKU2', fromState: 'ASIG', toState: 'cancelled', qty: 5, clientCardCode: 'C1', clientName: 'CLI', vendor: 'V', province: 'BA', locName: 'L' },
    ];

    const n = await writeTransitionsBatch({ fbDb, FieldValue }, transitions);
    expect(n).toBe(2);
    expect(collectionSpy).toHaveBeenCalledWith('asig_transitions');
    expect(docSpy).toHaveBeenCalledTimes(2);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(commitSpy).toHaveBeenCalledOnce();
    // Verificar que cada set() incluye month + transitionedAt.
    const firstCall = setSpy.mock.calls[0][1];
    expect(firstCall.month).toMatch(/^\d{4}-\d{2}$/);
    expect(firstCall.transitionedAt).toBe('STAMP');
    expect(firstCall.sku).toBe('SKU1');
    expect(firstCall.toState).toBe('confirmed');
  });
});
