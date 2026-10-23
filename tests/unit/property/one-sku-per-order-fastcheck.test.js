// @ts-check
/**
 * v1435 §56 (2026-10-24): property-based test "un SKU una sola vez por orden".
 *
 * Invariante: para cualquier combinación de base + órdenes absorbidas,
 * el resultado de `mergeLinesFromOrders` tiene todos sus `code` únicos
 * (case-insensitive). Además:
 *   - La suma de qty en el output == suma de qty en los inputs.
 *   - Toda line con `origen='stock-asignado'` en el input conserva origen en
 *     la fila fusionada correspondiente.
 */
import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { mergeLinesFromOrders } from '../../../src/pure/unificar-ordenes.js';

const codeArb = fc.constantFrom('A', 'B', 'C', 'D', 'E', 'STRADIC', 'TWIN', 'EXG');

const lineArb = fc.record({
  code: codeArb,
  qty: fc.integer({ min: 1, max: 100 }),
  precio: fc.option(fc.integer({ min: 500, max: 5000 }), { nil: undefined }),
  origen: fc.option(fc.constant('stock-asignado'), { nil: undefined }),
});

const orderArb = fc.record({
  orderNumber: fc.integer({ min: 1, max: 999 }),
  pedidoId: fc.string({ minLength: 4, maxLength: 10 }),
  source: fc.option(fc.constantFrom('stock-asignado-batch', undefined), { nil: undefined }),
  lines: fc.array(lineArb, { minLength: 0, maxLength: 6 }),
});

describe('Property-based §56: un SKU aparece una sola vez por orden', () => {
  it('mergedLines no tiene codes duplicados (case-insensitive)', () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 0, maxLength: 6 }),
        fc.array(orderArb, { minLength: 0, maxLength: 4 }),
        (baseLines, otherOrders) => {
          const { mergedLines } = mergeLinesFromOrders(baseLines, otherOrders);
          const codes = mergedLines.map((l) => String(l.code).toUpperCase().trim());
          const unique = new Set(codes);
          return unique.size === codes.length;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('la suma total de qty se preserva en el merge', () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 0, maxLength: 6 }),
        fc.array(orderArb, { minLength: 0, maxLength: 4 }),
        (baseLines, otherOrders) => {
          const sumIn =
            baseLines.reduce((s, l) => s + (Number(l.qty) || 0), 0) +
            otherOrders.reduce(
              (so, o) => so + (o.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0),
              0
            );
          const { mergedLines } = mergeLinesFromOrders(baseLines, otherOrders);
          const sumOut = mergedLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
          return sumIn === sumOut;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('si alguna line de un SKU tenía origen=stock-asignado, la fila fusionada lo preserva', () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 6 }),
        fc.array(orderArb, { minLength: 0, maxLength: 4 }),
        (baseLines, otherOrders) => {
          // Set de codes con al menos 1 input marcado origen=stock-asignado.
          /** @type {Set<string>} */
          const skusConReserva = new Set();
          for (const l of baseLines) {
            if (l && l.origen === 'stock-asignado') skusConReserva.add(l.code.toUpperCase());
          }
          for (const o of otherOrders) {
            for (const l of o.lines || []) {
              if (l && l.origen === 'stock-asignado') skusConReserva.add(l.code.toUpperCase());
            }
          }
          const { mergedLines } = mergeLinesFromOrders(baseLines, otherOrders);
          for (const l of mergedLines) {
            const codeU = String(l.code).toUpperCase().trim();
            if (skusConReserva.has(codeU)) {
              if (l.origen !== 'stock-asignado') return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});
