// @ts-check
/**
 * v1398 §40.6 — collectAsigRefsForCancel: lista referencias ASIG a cancelar
 * cuando el VDE elige "El cliente no quiere la mercadería" al borrar un CPST.
 */
import { describe, expect, it } from 'vitest';
import {
  collectAsigRefsForCancel,
  sumUnitsToFreeOnCancel,
} from '../../src/pure/cpst-cancel-asig-plan.js';

describe('v1398 §40.6 collectAsigRefsForCancel', () => {
  it('waitlist sin pedidosOrigenes ni items → []', () => {
    expect(collectAsigRefsForCancel({})).toEqual([]);
    expect(collectAsigRefsForCancel(null)).toEqual([]);
    expect(collectAsigRefsForCancel({ pedidosOrigenes: [], items: [] })).toEqual([]);
  });

  it('waitlist con pedidosOrigenes directo → lista refs', () => {
    const refs = collectAsigRefsForCancel({
      pedidosOrigenes: [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2, sku: 'CLC70MHAAR' },
        { pedidoId: 'p2', lineIndex: 1, qtyAsignada: 3, sku: 'EXGC66HBAR' },
      ],
    });
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 });
    expect(refs[1]).toMatchObject({ pedidoId: 'p2', lineIndex: 1, qtyAsignada: 3 });
  });

  it('waitlist unificada (v1382): items[].asigRefs → extrae', () => {
    const refs = collectAsigRefsForCancel({
      items: [
        {
          code: 'CLC70MHAAR',
          asigRefs: [
            { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 1 },
            { pedidoId: 'p3', lineIndex: 2, qtyAsignada: 2 },
          ],
        },
        {
          code: 'EXGC66HBAR',
          asigRefs: [{ pedidoId: 'p4', lineIndex: 0, qtyAsignada: 1 }],
        },
      ],
    });
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.pedidoId).sort()).toEqual(['p1', 'p3', 'p4']);
  });

  it('dedupe: pedidoId+lineIndex en pedidosOrigenes Y asigRefs → una sola ref con max qty', () => {
    const refs = collectAsigRefsForCancel({
      pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
      items: [
        {
          asigRefs: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 3 }],
        },
      ],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0].qtyAsignada).toBe(3);
  });

  it('skippea refs inválidas', () => {
    const refs = collectAsigRefsForCancel({
      pedidosOrigenes: [
        null,
        { pedidoId: '', lineIndex: 0 }, // sin pedidoId
        { pedidoId: 'p1', lineIndex: 'x' }, // lineIndex no number
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 1 }, // válido
      ],
    });
    expect(refs).toHaveLength(1);
  });

  it('sumUnitsToFreeOnCancel: suma qty', () => {
    expect(
      sumUnitsToFreeOnCancel([
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 },
        { pedidoId: 'p2', lineIndex: 1, qtyAsignada: 3 },
      ])
    ).toBe(5);
    expect(sumUnitsToFreeOnCancel([])).toBe(0);
    expect(sumUnitsToFreeOnCancel(null)).toBe(0);
  });

  it('caso real ALAN OSCAR orden 487 CLC70MHAAR 1u', () => {
    const w = {
      source: 'stock-asignado-batch',
      orderNumber: '487',
      clientCardCode: 'C23347411299',
      pedidosOrigenes: [{ pedidoId: 'ewGoZIDQ', lineIndex: 0, qtyAsignada: 1, sku: 'CLC70MHAAR' }],
    };
    const refs = collectAsigRefsForCancel(w);
    expect(refs).toHaveLength(1);
    expect(refs[0].pedidoId).toBe('ewGoZIDQ');
    expect(refs[0].qtyAsignada).toBe(1);
    expect(sumUnitsToFreeOnCancel(refs)).toBe(1);
  });

  it('idempotencia: dos llamadas con mismo input → mismo output', () => {
    const w = {
      pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
    };
    const a = collectAsigRefsForCancel(w);
    const b = collectAsigRefsForCancel(w);
    expect(a).toEqual(b);
  });
});
