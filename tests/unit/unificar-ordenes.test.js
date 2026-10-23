// @ts-check
/**
 * Tests para mergeLinesFromOrders + getRowColorClass + buildUnifiedFromAudit.
 *
 * v1435 §56 (2026-10-24): `mergeLinesFromOrders` ahora FUSIONA por SKU.
 * `computeDuplicateCodes` fue eliminado (SKU duplicado no se produce).
 * `getRowColorClass` devuelve solo 'imported' | 'reservado-imported' | null.
 */
import { describe, expect, it } from 'vitest';
import {
  buildUnifiedFromAudit,
  getRowColorClass,
  mergeLinesFromOrders,
} from '../../src/pure/unificar-ordenes.js';

describe('mergeLinesFromOrders — fusión por SKU (§56)', () => {
  it('0 other orders → devuelve baseLines idéntico (sin importedFromOrder flags)', () => {
    const baseLines = [
      { code: 'A', qty: 2 },
      { code: 'B', qty: 3 },
    ];
    const r = mergeLinesFromOrders(baseLines, []);
    expect(r.mergedLines).toHaveLength(2);
    expect(r.mergedLines[0].importedFromOrder).toBeUndefined();
    expect(r.mergedLines[1].importedFromOrder).toBeUndefined();
  });

  it('2 orders sin SKUs duplicados → lines concatenadas, imported con flag', () => {
    const baseLines = [
      { code: 'A', qty: 2 },
      { code: 'B', qty: 3 },
    ];
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
  });

  it('§56: SKU presente en base + imported → FUSIÓN (1 fila, qty sumada)', () => {
    const baseLines = [
      { code: 'A', qty: 2 },
      { code: 'X', qty: 3 },
    ];
    const otherOrders = [{ orderNumber: 332, lines: [{ code: 'X', qty: 5 }] }];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(2);
    const xLine = r.mergedLines.find((l) => l.code === 'X');
    expect(xLine.qty).toBe(8);
    // Hereda importedFromOrder del origen absorbido para que la UI pinte badge "DE ORDEN N".
    expect(xLine.importedFromOrder).toBe(332);
    // Audit trail: aporte original (orden 0) + aporte importado (orden 332).
    expect(xLine.mergedFrom).toHaveLength(1);
    expect(xLine.mergedFrom[0]).toMatchObject({ orden: 332, qty: 5 });
  });

  it('§56: SKU solo en origen (no en base) → línea del origen entra tal cual', () => {
    const baseLines = [{ code: 'A', qty: 2 }];
    const otherOrders = [{ orderNumber: 332, lines: [{ code: 'C', qty: 5 }] }];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    const cLine = r.mergedLines.find((l) => l.code === 'C');
    expect(cLine.qty).toBe(5);
    expect(cLine.importedFromOrder).toBe(332);
    expect(cLine.mergedFrom).toEqual([{ orden: 332, qty: 5, precio: undefined }]);
  });

  it('§56: 3 orders en cascada con SKU repetido → siempre 1 fila por SKU', () => {
    const baseLines = [
      { code: 'A', qty: 1 },
      { code: 'B', qty: 2 },
    ];
    const otherOrders = [
      {
        orderNumber: 100,
        lines: [
          { code: 'A', qty: 10 },
          { code: 'C', qty: 3 },
        ],
      },
      {
        orderNumber: 200,
        lines: [
          { code: 'B', qty: 20 },
          { code: 'D', qty: 4 },
        ],
      },
    ];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    // §56: una fila por SKU único (A, B, C, D).
    expect(r.mergedLines).toHaveLength(4);
    const codes = r.mergedLines.map((l) => l.code);
    expect(codes).toEqual(['A', 'B', 'C', 'D']);
    const a = r.mergedLines.find((l) => l.code === 'A');
    expect(a.qty).toBe(11);
    const b = r.mergedLines.find((l) => l.code === 'B');
    expect(b.qty).toBe(22);
  });

  it('§56: SKU duplicado entre 2 orders viejas → fusiona en 1 fila', () => {
    const baseLines = [{ code: 'A', qty: 1 }];
    const otherOrders = [
      { orderNumber: 100, lines: [{ code: 'X', qty: 2 }] },
      { orderNumber: 200, lines: [{ code: 'X', qty: 3 }] },
    ];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(2);
    const x = r.mergedLines.find((l) => l.code === 'X');
    expect(x.qty).toBe(5);
    expect(x.mergedFrom).toHaveLength(2);
  });

  it('§56: precios iguales → mantiene precio sin precioAnterior*', () => {
    const baseLines = [{ code: 'X', qty: 1, precio: 1200 }];
    const otherOrders = [{ orderNumber: 100, lines: [{ code: 'X', qty: 2, precio: 1200 }] }];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    const x = r.mergedLines[0];
    expect(x.qty).toBe(3);
    expect(x.precio).toBe(1200);
    expect(x.precioAnterior1).toBeUndefined();
    expect(x.precioAnterior2).toBeUndefined();
    expect(x.precioOrigen).toBeUndefined();
  });

  it('§56: precios distintos → usa precio base + registra precioAnterior1/precioOrigen', () => {
    const baseLines = [{ code: 'X', qty: 1, precio: 1250 }];
    const otherOrders = [{ orderNumber: 100, lines: [{ code: 'X', qty: 2, precio: 1200 }] }];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    const x = r.mergedLines[0];
    expect(x.qty).toBe(3);
    expect(x.precio).toBe(1250); // base = "lista actual"
    expect(x.precioAnterior1).toBe(1250);
    expect(x.precioOrigen).toBe('lista_actual');
  });

  it('§56: no muta baseLines (pureza)', () => {
    const original = [{ code: 'A', qty: 1 }];
    const otherOrders = [{ orderNumber: 100, lines: [{ code: 'A', qty: 2 }] }];
    const originalCopy = JSON.parse(JSON.stringify(original));
    mergeLinesFromOrders(original, otherOrders);
    expect(original).toEqual(originalCopy);
  });

  it('§56: no muta otherOrders.lines (pureza)', () => {
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
  });

  it('§56: code case-insensitive (CODE1 vs code1 son el mismo SKU → se fusionan)', () => {
    const baseLines = [{ code: 'ABC', qty: 1 }];
    const otherOrders = [{ orderNumber: 100, lines: [{ code: 'abc', qty: 2 }] }];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(1);
    expect(r.mergedLines[0].qty).toBe(3);
  });

  it('§56: 2 absorbed con mismo SKU + con reserva → conserva origen + union asigRefs', () => {
    const baseLines = [];
    const otherOrders = [
      {
        orderNumber: 100,
        source: 'stock-asignado-batch',
        pedidosOrigenes: [{ pedidoId: 'p-A', lineIndex: 0, sku: 'STRADIC', qtyAsignada: 2 }],
        lines: [{ code: 'STRADIC', qty: 2 }],
      },
      {
        orderNumber: 200,
        source: 'stock-asignado-batch',
        pedidosOrigenes: [{ pedidoId: 'p-B', lineIndex: 3, sku: 'STRADIC', qtyAsignada: 1 }],
        lines: [{ code: 'STRADIC', qty: 1 }],
      },
    ];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(1);
    const line = r.mergedLines[0];
    expect(line.qty).toBe(3);
    expect(line.origen).toBe('stock-asignado');
    expect(line.asigRefs).toHaveLength(2);
    const pIds = line.asigRefs.map((r) => r.pedidoId).sort();
    expect(pIds).toEqual(['p-A', 'p-B']);
  });

  it('§56: base con SKU normal + absorbida con reserva → hereda origen', () => {
    const baseLines = [{ code: 'STRADIC', qty: 1 }];
    const otherOrders = [
      {
        orderNumber: 332,
        source: 'stock-asignado-batch',
        pedidosOrigenes: [{ pedidoId: 'p-oeste', lineIndex: 0, sku: 'STRADIC', qtyAsignada: 1 }],
        lines: [{ code: 'STRADIC', qty: 1 }],
      },
    ];
    const r = mergeLinesFromOrders(baseLines, otherOrders);
    expect(r.mergedLines).toHaveLength(1);
    const line = r.mergedLines[0];
    expect(line.qty).toBe(2);
    expect(line.origen).toBe('stock-asignado');
    expect(line.asigRefs).toHaveLength(1);
  });
});

describe('getRowColorClass (§56: solo imported | reservado-imported | null)', () => {
  it('línea original sin importedFromOrder → null', () => {
    expect(getRowColorClass({ code: 'A' }, null)).toBe(null);
  });
  it('línea importada sin reserva → "imported"', () => {
    expect(getRowColorClass({ code: 'A', importedFromOrder: 332 }, null)).toBe('imported');
  });
  it('línea importada con reserva (origen=stock-asignado) → "reservado-imported"', () => {
    expect(
      getRowColorClass({ code: 'A', importedFromOrder: 332, origen: 'stock-asignado' }, null)
    ).toBe('reservado-imported');
  });
  it('línea con origen=stock-asignado SIN importedFromOrder → null (es CPST original)', () => {
    expect(getRowColorClass({ code: 'A', origen: 'stock-asignado' }, null)).toBe(null);
  });
  it('line null → null (defensive)', () => {
    // @ts-expect-error forzamos input invalido
    expect(getRowColorClass(null, null)).toBe(null);
  });
  it('ignora el 2do argumento (legacy)', () => {
    expect(getRowColorClass({ code: 'A', importedFromOrder: 1 }, new Set(['A']))).toBe('imported');
  });
});

describe('buildUnifiedFromAudit', () => {
  it('construye array de audit entries por cada otherOrder', () => {
    const otherOrders = [
      { orderNumber: 332, pedidoId: 'abc', lines: [{ code: 'A' }, { code: 'B' }] },
      { orderNumber: 335, pedidoId: 'def', lines: [{ code: 'C' }] },
    ];
    const r = buildUnifiedFromAudit(
      otherOrders,
      'mariano@shimano.com.ar',
      '2026-10-20T18:00:00.000Z'
    );
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
