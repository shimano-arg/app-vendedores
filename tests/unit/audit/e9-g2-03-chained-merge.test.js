// @ts-check
/**
 * E9 §stock-servidor-atomico (v1433) — fix G2.03 chained merge pierde asigRefs.
 *
 * Caso borde identificado en E0 inventario:
 * 1. X (CPST) con pedidosOrigenes=[{pedidoId:'A', lineIndex:0, sku:'SKU1', qty:2}]
 * 2. Y absorbe X vía unify → Y.lines[k].asigRefs=[{pedidoId:'A', ...}], Y.pedidosOrigenes=[{...}]
 * 3. Y absorbe W (otro CPST) → Y.pedidosOrigenes pisado con los nuevos refs.
 * 4. Z absorbe Y → bug v1382: buildAsigRefsForLine(line.code, Y.pedidosOrigenes)
 *    pierde el ref persistido en Y.lines[k].asigRefs del merge original con X.
 *
 * Fix v1433: UNION de refs de pedidosOrigenes + line.asigRefs ya persistidos.
 */
import { describe, expect, it } from 'vitest';
import { mergeLinesFromOrders, unionAsigRefsDedup } from '../../../src/pure/unificar-ordenes.js';

describe('E9 — fix G2.03 chained merge', () => {
  describe('unionAsigRefsDedup helper', () => {
    it('union sin duplicados', () => {
      const a = [{ pedidoId: 'A', lineIndex: 0, qtyAsignada: 2, sku: 'SKU1' }];
      const b = [{ pedidoId: 'B', lineIndex: 1, qtyAsignada: 3, sku: 'SKU1' }];
      const r = unionAsigRefsDedup(a, b);
      expect(r).toHaveLength(2);
      expect(r.find((x) => x.pedidoId === 'A').qtyAsignada).toBe(2);
      expect(r.find((x) => x.pedidoId === 'B').qtyAsignada).toBe(3);
    });

    it('dedupe por (pedidoId, lineIndex) — keep max qtyAsignada', () => {
      const a = [{ pedidoId: 'A', lineIndex: 0, qtyAsignada: 2, sku: 'SKU1' }];
      const b = [{ pedidoId: 'A', lineIndex: 0, qtyAsignada: 5, sku: 'SKU1' }];
      const r = unionAsigRefsDedup(a, b);
      expect(r).toHaveLength(1);
      expect(r[0].qtyAsignada).toBe(5);
    });

    it('refs vacíos → array vacío', () => {
      expect(unionAsigRefsDedup([], [])).toEqual([]);
      expect(unionAsigRefsDedup(null, undefined)).toEqual([]);
    });

    it('refs malformados ignorados', () => {
      const r = unionAsigRefsDedup(
        [
          { pedidoId: null, lineIndex: 0 },
          { pedidoId: 'A', lineIndex: 'x' },
        ],
        [{ pedidoId: 'B', lineIndex: 0, qtyAsignada: 1 }]
      );
      expect(r).toHaveLength(1);
      expect(r[0].pedidoId).toBe('B');
    });
  });

  describe('mergeLinesFromOrders chained merge preserva asigRefs', () => {
    it('G2.03: Z absorbe Y que ya tenía asigRefs persistidos — preserva ambos', () => {
      // Y ya fue mergeada con X previamente. Tiene asigRefs persistidos pero
      // pedidosOrigenes puede estar pisado por otro merge intermedio.
      const yWithPersistedRefs = {
        orderNumber: 100,
        source: 'stock-asignado-batch',
        pedidosOrigenes: [{ pedidoId: 'ped_W', lineIndex: 0, sku: 'SKU1', qtyAsignada: 1 }], // W (merge intermedio)
        lines: [
          {
            code: 'SKU1',
            qty: 3,
            state: 'ASIG',
            origen: 'stock-asignado',
            asigRefs: [
              { pedidoId: 'ped_X', lineIndex: 0, qtyAsignada: 2, sku: 'SKU1' }, // persistido del merge X
            ],
          },
        ],
      };
      // Z absorbe Y.
      const { mergedLines } = mergeLinesFromOrders([], [yWithPersistedRefs]);
      expect(mergedLines).toHaveLength(1);
      const line = mergedLines[0];
      expect(line.origen).toBe('stock-asignado');
      // UNION: ref de pedidosOrigenes (W) + ref persistido en línea (X).
      expect(line.asigRefs).toHaveLength(2);
      const refX = line.asigRefs.find((r) => r.pedidoId === 'ped_X');
      const refW = line.asigRefs.find((r) => r.pedidoId === 'ped_W');
      expect(refX).toBeTruthy();
      expect(refX.qtyAsignada).toBe(2);
      expect(refW).toBeTruthy();
      expect(refW.qtyAsignada).toBe(1);
    });

    it('orden sin CPST pero con asigRefs persistidos (de merge previo) → preserva refs', () => {
      // Orden absorbida sin pedidosOrigenes pero con asigRefs en línea.
      const yPostMerge = {
        orderNumber: 101,
        // sin source stock-asignado-batch
        // sin pedidosOrigenes
        lines: [
          {
            code: 'SKU2',
            qty: 2,
            state: 'ASIG',
            origen: 'stock-asignado',
            asigRefs: [{ pedidoId: 'ped_Z', lineIndex: 1, qtyAsignada: 2, sku: 'SKU2' }],
          },
        ],
      };
      const { mergedLines } = mergeLinesFromOrders([], [yPostMerge]);
      const line = mergedLines[0];
      // El fix v1433 preserva asigRefs incluso si isCpst=false (porque la línea
      // en sí ya los tiene — vinieron de un merge anterior).
      expect(line.origen).toBe('stock-asignado');
      expect(line.asigRefs).toHaveLength(1);
      expect(line.asigRefs[0].pedidoId).toBe('ped_Z');
    });

    it('línea normal sin asigRefs → sin stock-asignado (sin regresión)', () => {
      const normal = {
        orderNumber: 102,
        lines: [{ code: 'SKU3', qty: 1 }],
      };
      const { mergedLines } = mergeLinesFromOrders([], [normal]);
      const line = mergedLines[0];
      expect(line.origen).toBeUndefined();
      expect(line.asigRefs).toBeUndefined();
    });

    it('CPST normal (sin merge previo) sigue funcionando', () => {
      const cpstNormal = {
        orderNumber: 103,
        source: 'stock-asignado-batch',
        pedidosOrigenes: [{ pedidoId: 'ped_A', lineIndex: 0, sku: 'SKU4', qtyAsignada: 5 }],
        lines: [{ code: 'SKU4', qty: 5, state: 'ASIG' }],
      };
      const { mergedLines } = mergeLinesFromOrders([], [cpstNormal]);
      const line = mergedLines[0];
      expect(line.origen).toBe('stock-asignado');
      expect(line.asigRefs).toHaveLength(1);
      expect(line.asigRefs[0].pedidoId).toBe('ped_A');
    });
  });
});
