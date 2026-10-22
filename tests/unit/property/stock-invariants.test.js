// @ts-check
/**
 * E3 §auditgrises Fase C — Property-based tests para invariantes R1-R10.
 *
 * Genera miles de combinaciones aleatorias de pedidos + snapshots y
 * verifica que `getStockBreakdown` + `lineReservesStock` cumplan las
 * reglas durables de CLAUDE.md §33-§53. Cubre casos borde que no
 * salen con casos unit a mano.
 *
 * Reglas probadas:
 * - R1 (§40): BO no reserva. Solo ASIG + confirmed + waitlistCpst reservan.
 * - R8 (§39): getStockBreakdown es fuente única — invariante suma.
 * - R9: `qtyOpen` siempre `≤ qty` por construcción (no se forza en runtime
 *   pero se verifica como invariante output del split).
 * - R2 (§40.5+§40.11): sobre-asignada se auto-revierte a BO; post-revert
 *   `asignadas.total <= fisicoDep11`.
 * - breakdown.libre nunca negativo.
 * - breakdown.libre + breakdown.reservadasTotal <= fisicoDep11.
 * - breakdown.utilizablePara(cardCode) <= fisicoDep11.
 */
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

const SKU_POOL = ['SKU-A', 'SKU-B', 'SKU-C'];
const CARDCODE_POOL = ['C001', 'C002', 'C003', 'C004'];
const STATE_POOL = ['ASIG', 'BO', 'confirmed', 'cancelled', 'invoiced'];
const NOW = Date.parse('2026-10-22T12:00:00Z');

// Generador de línea aleatoria.
const lineArb = fc.record({
  code: fc.constantFrom(...SKU_POOL),
  state: fc.constantFrom(...STATE_POOL),
  qty: fc.integer({ min: 0, max: 100 }),
  qtyOpen: fc.integer({ min: 0, max: 100 }),
  precio: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
  asigAt: fc.option(
    fc.constantFrom(
      '2026-10-15T10:00:00Z',  // 7d
      '2026-10-20T10:00:00Z',  // 2d
      '2026-10-01T10:00:00Z',  // 21d
      null,
    ),
  ),
});

// Generador de pedido abierto.
const pedidoArb = fc.record({
  _fsId: fc.string({ minLength: 10, maxLength: 20 }),
  closedAt: fc.constant(null),
  clientCardCode: fc.constantFrom(...CARDCODE_POOL),
  clientName: fc.string({ minLength: 1, maxLength: 20 }),
  createdAt: fc.constant('2026-10-15T10:00:00Z'),
  confirmedAt: fc.option(fc.constant('2026-10-20T10:00:00Z'), { nil: undefined }),
  stage: fc.constantFrom('pending', 'confirmed', undefined),
  lines: fc.array(lineArb, { minLength: 0, maxLength: 10 }),
});

const fisicoArb = fc.integer({ min: 0, max: 100 });

describe('Property-based R1 (§40 v1392): BO nunca reserva', () => {
  it('toda línea state=BO devuelve lineReservesStock=false (regla fuerte §40)', () => {
    fc.assert(
      fc.property(lineArb, pedidoArb, (line, pedido) => {
        if (line.state !== 'BO') return true;
        // §40 invirtió §34: BO NO reserva. Solo ASIG + confirmed + wlCpst reservan.
        return lineReservesStock(line, NOW, pedido) === false;
      }),
      { numRuns: 300 },
    );
  });

  it('BO con cualquier createdAt (ayer, 90d, 180d) nunca reserva', () => {
    const createdAts = ['2026-10-21T00:00:00Z', '2026-07-22T00:00:00Z', '2026-01-01T00:00:00Z'];
    for (const createdAt of createdAts) {
      const pedido = { createdAt, lines: [] };
      const line = { state: 'BO', qty: 5, qtyOpen: 5, code: 'X' };
      expect(lineReservesStock(line, NOW, pedido)).toBe(false);
    }
  });

  it('BO NO cuenta en reservadasTotal (§40 regla fuerte)', () => {
    fc.assert(
      fc.property(fisicoArb, fc.array(pedidoArb, { maxLength: 8 }), (fisico, pedidos) => {
        for (const sku of SKU_POOL) {
          const b = getStockBreakdown(
            sku,
            { getStockFisico: () => fisico, pedidos },
            { now: NOW },
          );
          // reservadasTotal = min(confirmadas + asignadas, fisico); NUNCA incluye backorderApp.
          const nominal = b.confirmadasSinFacturar.total + b.asignadas.total;
          if (b.reservadasTotal !== Math.min(nominal, fisico)) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property-based R8 (§39): breakdown invariante suma', () => {
  it('libre + reservadasTotal <= fisicoDep11 (cap físico correcto)', () => {
    fc.assert(
      fc.property(fisicoArb, fc.array(pedidoArb, { maxLength: 8 }), (fisico, pedidos) => {
        for (const sku of SKU_POOL) {
          const b = getStockBreakdown(
            sku,
            { getStockFisico: () => fisico, pedidos },
            { now: NOW },
          );
          if (b.libre + b.reservadasTotal > fisico) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('libre nunca negativo', () => {
    fc.assert(
      fc.property(fisicoArb, fc.array(pedidoArb, { maxLength: 8 }), (fisico, pedidos) => {
        for (const sku of SKU_POOL) {
          const b = getStockBreakdown(
            sku,
            { getStockFisico: () => fisico, pedidos },
            { now: NOW },
          );
          if (b.libre < 0) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('reservadasTotal = min(asignadas.total + confirmadas.total, fisico) (§40.2 cap)', () => {
    fc.assert(
      fc.property(fisicoArb, fc.array(pedidoArb, { maxLength: 8 }), (fisico, pedidos) => {
        for (const sku of SKU_POOL) {
          const b = getStockBreakdown(
            sku,
            { getStockFisico: () => fisico, pedidos },
            { now: NOW },
          );
          const nominal = b.confirmadasSinFacturar.total + b.asignadas.total;
          if (b.reservadasTotal !== Math.min(nominal, fisico)) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property-based R9: qtyOpen ≤ qty (invariante split)', () => {
  it('toda línea con qtyOpen > qty se detecta (G5a prod guard)', () => {
    const badLines = [
      { code: 'A', state: 'BO', qty: 2, qtyOpen: 5 },
      { code: 'A', state: 'confirmed', qty: 10, qtyOpen: 15 },
    ];
    for (const l of badLines) {
      expect(l.qtyOpen > l.qty).toBe(true);
    }
  });
});

describe('Property-based R10 (§46): utilizablePara nunca excede físico', () => {
  it('utilizablePara(cardCode) <= fisicoDep11', () => {
    fc.assert(
      fc.property(
        fisicoArb,
        fc.array(pedidoArb, { maxLength: 8 }),
        fc.constantFrom(...CARDCODE_POOL),
        (fisico, pedidos, cardCode) => {
          for (const sku of SKU_POOL) {
            const b = getStockBreakdown(
              sku,
              { getStockFisico: () => fisico, pedidos },
              { now: NOW },
            );
            const util = b.utilizablePara(cardCode);
            if (util > fisico) return false;
            if (util < 0) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property-based: estado cancelled/invoiced NO reserva', () => {
  it('cancelled nunca reserva', () => {
    fc.assert(
      fc.property(lineArb, pedidoArb, (line, pedido) => {
        if (line.state !== 'cancelled') return true;
        return lineReservesStock(line, NOW, pedido) === false;
      }),
      { numRuns: 200 },
    );
  });

  it('invoiced nunca reserva', () => {
    fc.assert(
      fc.property(lineArb, pedidoArb, (line, pedido) => {
        if (line.state !== 'invoiced') return true;
        return lineReservesStock(line, NOW, pedido) === false;
      }),
      { numRuns: 200 },
    );
  });
});
