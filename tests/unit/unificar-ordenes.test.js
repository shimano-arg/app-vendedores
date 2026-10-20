// @ts-check
/**
 * Tests para mergeLinesFromOrders + getRowColorClass + buildUnifiedFromAudit.
 * Precedente: spec docs/superpowers/specs/2026-10-20-unificar-ordenes-waitlist-design.md
 */
import { describe, expect, it } from 'vitest';
import {
  buildUnifiedFromAudit,
  computeDuplicateCodes,
  getRowColorClass,
  mergeLinesFromOrders,
} from '../../src/pure/unificar-ordenes.js';

describe('mergeLinesFromOrders', () => {
  it('0 other orders → devuelve baseLines idéntico (sin importedFromOrder flags)', () => {
    const baseLines = [{ code: 'A', qty: 2 }, { code: 'B', qty: 3 }];
    const r = mergeLinesFromOrders(baseLines, []);
    expect(r.mergedLines).toHaveLength(2);
    expect(r.mergedLines[0].importedFromOrder).toBeUndefined();
    expect(r.mergedLines[1].importedFromOrder).toBeUndefined();
    expect(r.duplicateCodes.size).toBe(0);
  });

  it('2 orders sin SKUs duplicados → lines concatenadas, imported con flag', () => {
    const baseLines = [{ code: 'A', qty: 2 }, { code: 'B', qty: 3 }];
    const otherOrders = [
      { orderNumber: 332, lines: [{ code: 'C', qty: 5 }] },
      { orderNumber: 335, lines: [{ code: 'D', qty: 1 }] },
    ];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(4);
    expect(r.mergedLines[0].code).toBe('A');
    expect(r.mergedLines[0].importedFromOrder).toBeUndefined();
    expect(r.mergedLines[2].code).toBe('C');
    expect(r.mergedLines[2].importedFromOrder).toBe(332);
    expect(r.mergedLines[3].code).toBe('D');
    expect(r.mergedLines[3].importedFromOrder).toBe(335);
    expect(r.duplicateCodes.size).toBe(0);
  });

  it('2 orders con 1 SKU duplicado → ambas filas quedan + duplicateCodes incluye el SKU', () => {
    const baseLines = [{ code: 'A', qty: 2 }, { code: 'X', qty: 3 }];
    const otherOrders = [{ orderNumber: 332, lines: [{ code: 'X', qty: 5 }] }];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(3);
    expect(r.mergedLines[1].code).toBe('X');
    expect(r.mergedLines[1].qty).toBe(3);
    expect(r.mergedLines[1].importedFromOrder).toBeUndefined();
    expect(r.mergedLines[2].code).toBe('X');
    expect(r.mergedLines[2].qty).toBe(5);
    expect(r.mergedLines[2].importedFromOrder).toBe(332);
    expect(r.duplicateCodes.has('X')).toBe(true);
    expect(r.duplicateCodes.size).toBe(1);
  });

  it('3 orders en cascada con mix de duplicados', () => {
    const baseLines = [{ code: 'A', qty: 1 }, { code: 'B', qty: 2 }];
    const otherOrders = [
      { orderNumber: 100, lines: [{ code: 'A', qty: 10 }, { code: 'C', qty: 3 }] },
      { orderNumber: 200, lines: [{ code: 'B', qty: 20 }, { code: 'D', qty: 4 }] },
    ];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(6);
    expect(r.duplicateCodes.has('A')).toBe(true);
    expect(r.duplicateCodes.has('B')).toBe(true);
    expect(r.duplicateCodes.has('C')).toBe(false);
    expect(r.duplicateCodes.has('D')).toBe(false);
  });

  it('SKU duplicado entre 2 orders viejas (misma vieja distinta) → también lo detecta', () => {
    const baseLines = [{ code: 'A', qty: 1 }];
    const otherOrders = [
      { orderNumber: 100, lines: [{ code: 'X', qty: 2 }] },
      { orderNumber: 200, lines: [{ code: 'X', qty: 3 }] },
    ];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(3);
    expect(r.duplicateCodes.has('X')).toBe(true);
  });

  it('no muta baseLines (pureza)', () => {
    const original = [{ code: 'A', qty: 1 }];
    const otherOrders = [{ orderNumber: 100, lines: [{ code: 'B', qty: 2 }] }];
    const originalCopy = JSON.parse(JSON.stringify(original));
    mergeLinesFromOrders(original, otherOrders);
    expect(original).toEqual(originalCopy);
  });

  it('no muta otherOrders.lines (pureza)', () => {
    const baseLines = [{ code: 'A', qty: 1 }];
    const otherLines = [{ code: 'B', qty: 2 }];
    const originalCopy = JSON.parse(JSON.stringify(otherLines));
    mergeLinesFromOrders(baseLines, [{ orderNumber: 100, lines: otherLines }]);
    expect(otherLines).toEqual(originalCopy);
  });

  it('baseLines no-array → devuelve estructura vacía defensiva', () => {
    // @ts-expect-error forzamos input invalido
    const r = mergeLinesFromOrders(null, []);
    expect(r.mergedLines).toEqual([]);
    expect(r.duplicateCodes.size).toBe(0);
  });

  it('code case-insensitive (CODE1 vs code1 son el mismo SKU)', () => {
    const baseLines = [{ code: 'ABC', qty: 1 }];
    const otherOrders = [{ orderNumber: 100, lines: [{ code: 'abc', qty: 2 }] }];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.duplicateCodes.size).toBe(1);
    // Internamente usamos uppercase para el Set
    expect(r.duplicateCodes.has('ABC')).toBe(true);
  });
});

describe('computeDuplicateCodes', () => {
  it('array vacío → Set vacío', () => {
    expect(computeDuplicateCodes([]).size).toBe(0);
  });
  it('sin duplicados → Set vacío', () => {
    const codes = computeDuplicateCodes([
      { code: 'A' },
      { code: 'B' },
      { code: 'C' },
    ]);
    expect(codes.size).toBe(0);
  });
  it('1 duplicado → set con 1', () => {
    const codes = computeDuplicateCodes([{ code: 'A' }, { code: 'B' }, { code: 'A' }]);
    expect(codes.size).toBe(1);
    expect(codes.has('A')).toBe(true);
  });
  it('3 veces el mismo → set con 1 (no cuenta la cantidad)', () => {
    const codes = computeDuplicateCodes([{ code: 'A' }, { code: 'A' }, { code: 'A' }]);
    expect(codes.size).toBe(1);
  });
});

describe('getRowColorClass', () => {
  const dupSet = new Set(['X']);

  it('línea original sin duplicado → null', () => {
    expect(getRowColorClass({ code: 'A' }, dupSet)).toBe(null);
  });
  it('línea importada sin duplicado → imported', () => {
    expect(getRowColorClass({ code: 'A', importedFromOrder: 332 }, dupSet)).toBe('imported');
  });
  it('línea original DUPLICADA → duplicate-original', () => {
    expect(getRowColorClass({ code: 'X' }, dupSet)).toBe('duplicate-original');
  });
  it('línea importada DUPLICADA → duplicate-imported', () => {
    expect(getRowColorClass({ code: 'X', importedFromOrder: 332 }, dupSet)).toBe('duplicate-imported');
  });
  it('line null → null (defensive)', () => {
    // @ts-expect-error forzamos input invalido
    expect(getRowColorClass(null, dupSet)).toBe(null);
  });
  it('dupSet null → trata como no-duplicado (defensive)', () => {
    // @ts-expect-error
    expect(getRowColorClass({ code: 'X' }, null)).toBe(null);
  });
  it('code case: X mayúscula en dupSet y x minúscula en line → matchea', () => {
    expect(getRowColorClass({ code: 'x' }, dupSet)).toBe('duplicate-original');
  });
});

describe('buildUnifiedFromAudit', () => {
  it('construye array de audit entries por cada otherOrder', () => {
    const otherOrders = [
      { orderNumber: 332, pedidoId: 'abc', lines: [{ code: 'A' }, { code: 'B' }] },
      { orderNumber: 335, pedidoId: 'def', lines: [{ code: 'C' }] },
    ];
    const r = buildUnifiedFromAudit(otherOrders, 'mariano@shimano.com.ar', '2026-10-20T18:00:00.000Z');
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      orderNumber: 332,
      pedidoId: 'abc',
      mergedAt: '2026-10-20T18:00:00.000Z',
      mergedBy: 'mariano@shimano.com.ar',
      lineCount: 2,
    });
    expect(r[1].orderNumber).toBe(335);
    expect(r[1].lineCount).toBe(1);
  });
  it('otherOrders vacío → []', () => {
    expect(buildUnifiedFromAudit([], 'x@y.com', '2026-10-20T18:00:00.000Z')).toEqual([]);
  });
});
