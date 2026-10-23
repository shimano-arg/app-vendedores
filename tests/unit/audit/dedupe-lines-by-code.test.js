// @ts-check
/**
 * v1435 §56 (2026-10-24): tests para `dedupeLinesByCode`. Garantiza invariante
 * "un SKU una sola vez por orden" en los call-sites que no pasan por
 * `mergeLinesFromOrders` (alta manual, import Excel).
 */
import { describe, expect, it } from 'vitest';
import { dedupeLinesByCode } from '../../../src/pure/unificar-ordenes.js';

describe('dedupeLinesByCode', () => {
  it('array vacío → {lines: [], dedupedCount: 0}', () => {
    expect(dedupeLinesByCode([])).toEqual({ lines: [], dedupedCount: 0 });
  });

  it('array sin duplicados → mismo contenido, dedupedCount = 0', () => {
    const input = [
      { code: 'A', qty: 1 },
      { code: 'B', qty: 2 },
    ];
    const r = dedupeLinesByCode(input);
    expect(r.lines).toHaveLength(2);
    expect(r.dedupedCount).toBe(0);
  });

  it('2 líneas con mismo code (case-insensitive) → fusiona qty', () => {
    const input = [
      { code: 'A', qty: 3, desc: 'original' },
      { code: 'a', qty: 2 },
    ];
    const r = dedupeLinesByCode(input);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qty).toBe(5);
    expect(r.lines[0].desc).toBe('original'); // preserva primer aparición
    expect(r.dedupedCount).toBe(1);
  });

  it('3 líneas del mismo SKU → fusiona todas', () => {
    const r = dedupeLinesByCode([
      { code: 'X', qty: 1 },
      { code: 'X', qty: 2 },
      { code: 'X', qty: 3 },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qty).toBe(6);
    expect(r.dedupedCount).toBe(2);
  });

  it('conserva origen=stock-asignado si alguna lo tenía', () => {
    const r = dedupeLinesByCode([
      { code: 'X', qty: 1 },
      {
        code: 'X',
        qty: 1,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 1 }],
      },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].origen).toBe('stock-asignado');
    expect(r.lines[0].asigRefs).toHaveLength(1);
  });

  it('union dedupe de asigRefs cuando ambas líneas tienen reservas', () => {
    const r = dedupeLinesByCode([
      {
        code: 'X',
        qty: 1,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'pA', lineIndex: 0, qtyAsignada: 1 }],
      },
      {
        code: 'X',
        qty: 1,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'pB', lineIndex: 2, qtyAsignada: 1 }],
      },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].asigRefs).toHaveLength(2);
  });

  it('ignora líneas sin code o code vacío (defensive)', () => {
    // @ts-expect-error input invalido
    const r = dedupeLinesByCode([{ code: 'A', qty: 1 }, { qty: 2 }, null, { code: '', qty: 5 }]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].code).toBe('A');
  });

  it('input null → defensivo {lines:[], dedupedCount:0}', () => {
    // @ts-expect-error
    expect(dedupeLinesByCode(null)).toEqual({ lines: [], dedupedCount: 0 });
  });
});
