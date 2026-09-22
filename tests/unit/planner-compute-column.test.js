import { describe, expect, it } from 'vitest';
import { computeColumn as serverComputeColumn } from '../../functions/core/planner-compute-column.js';
import { computeColumn as clientComputeColumn } from '../../src/domains/planner/compute-column.js';

const implementations = [
  { name: 'server', fn: serverComputeColumn },
  { name: 'client', fn: clientComputeColumn },
];

implementations.forEach(({ name, fn }) => {
  describe(`computeColumn (${name})`, () => {
    it('empty pedido → lista_espera', () => {
      expect(fn({})).toBe('lista_espera');
    });

    it('empty items array → lista_espera', () => {
      expect(fn({ items: [] })).toBe('lista_espera');
    });

    it('docNum only → oferta', () => {
      expect(fn({ transferidoSAP: { docNum: 12345 } })).toBe('oferta');
    });

    it('docNum + orderDocEntry → ordenes', () => {
      expect(fn({ transferidoSAP: { docNum: 12345, orderDocEntry: 678 } })).toBe('ordenes');
    });

    it('docNum + orderDocEntry + items with qtyInvoiced > 0 → facturar', () => {
      expect(
        fn({
          transferidoSAP: { docNum: 12345, orderDocEntry: 678 },
          items: [{ qtyInvoiced: 0 }, { qtyInvoiced: 5 }],
        })
      ).toBe('facturar');
    });

    it('paidStatus = partial → cobrado', () => {
      expect(fn({ paidStatus: 'partial' })).toBe('cobrado');
    });

    it('paidStatus = paid → cobrado', () => {
      expect(fn({ paidStatus: 'paid' })).toBe('cobrado');
    });

    it('plannerStage = confirmado + docNum sin facturar → confirmado', () => {
      expect(
        fn({
          plannerStage: 'confirmado',
          transferidoSAP: { docNum: 12345 },
        })
      ).toBe('confirmado');
    });

    // v1016 (2026-09-22): SAP facturó una línea → gana sobre plannerStage=confirmado.
    // Precedente BIANCHINI SAP:2000120 (qtyInvoiced=15/78u pero atascado en Confirmado).
    it('plannerStage = confirmado + lines qtyInvoiced>0 → facturar (SAP pisa drag)', () => {
      expect(
        fn({
          plannerStage: 'confirmado',
          transferidoSAP: { docNum: 2000120, orderDocEntry: 50699 },
          lines: [{ qtyInvoiced: 0 }, { qtyInvoiced: 15 }],
        })
      ).toBe('facturar');
    });

    it('plannerStage = confirmado + items qtyInvoiced>0 (legacy schema) → facturar', () => {
      expect(
        fn({
          plannerStage: 'confirmado',
          items: [{ qtyInvoiced: 3 }],
        })
      ).toBe('facturar');
    });

    it('plannerStage = cobrado_parcial overrides transfer → cobrado', () => {
      expect(
        fn({
          plannerStage: 'cobrado_parcial',
          transferidoSAP: { docNum: 12345 },
        })
      ).toBe('cobrado');
    });

    it('plannerStage = cobrado_full overrides transfer → cobrado', () => {
      expect(
        fn({
          plannerStage: 'cobrado_full',
          transferidoSAP: { docNum: 12345 },
        })
      ).toBe('cobrado');
    });

    it('plannerStage = null + docNum → oferta (fallthrough)', () => {
      expect(
        fn({
          plannerStage: null,
          transferidoSAP: { docNum: 12345 },
        })
      ).toBe('oferta');
    });

    it('docNum + items with qtyInvoiced === 0 → oferta (no move to facturar)', () => {
      expect(
        fn({
          transferidoSAP: { docNum: 12345 },
          items: [{ qtyInvoiced: 0 }],
        })
      ).toBe('oferta');
    });

    it('empty transferidoSAP object → lista_espera (no crash)', () => {
      expect(fn({ transferidoSAP: {} })).toBe('lista_espera');
    });

    // v1013 (2026-09-22): pedidos schema real es `lines`; `items` fallback.
    it('lines (schema real) with qtyInvoiced > 0 → facturar', () => {
      expect(
        fn({
          transferidoSAP: { docNum: 12345, orderDocEntry: 678 },
          lines: [{ qtyInvoiced: 0 }, { qtyInvoiced: 5 }],
        })
      ).toBe('facturar');
    });

    it('lines takes precedence over items when both present', () => {
      // lines vacio + items con invoiced → NO va a facturar (lines gana)
      expect(
        fn({
          transferidoSAP: { docNum: 12345 },
          lines: [],
          items: [{ qtyInvoiced: 5 }],
        })
      ).toBe('oferta');
    });
  });
});
