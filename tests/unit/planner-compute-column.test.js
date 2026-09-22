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

    it('plannerStage = confirmado overrides all → confirmado', () => {
      expect(
        fn({
          plannerStage: 'confirmado',
          transferidoSAP: { docNum: 12345 },
        })
      ).toBe('confirmado');
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
  });
});
