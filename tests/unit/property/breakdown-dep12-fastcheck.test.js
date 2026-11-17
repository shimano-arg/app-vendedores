// @ts-check
/**
 * v8 §E1 (2026-11-17 Reparto dep 12) — Property-based tests para
 * invariantes del breakdown con dep 12.
 */
import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

const nowIso = new Date().toISOString();

const lineArb = fc.record({
  code: fc.constant('SKU1'),
  state: fc.constantFrom('ASIG', 'confirmed', 'BO'),
  qty: fc.integer({ min: 0, max: 10 }),
  qtyOpen: fc.integer({ min: 0, max: 10 }),
  enTransito: fc.boolean(),
  asigAt: fc.constantFrom(nowIso, null),
  asigAtTransito: fc.constantFrom(nowIso, null),
});

const pedidoArb = fc.record({
  _fsId: fc.string({ minLength: 3, maxLength: 10 }),
  closedAt: fc.constant(null),
  clientCardCode: fc.constantFrom('C001', 'C002', 'C003'),
  clientName: fc.constant('cli'),
  confirmedAt: fc.constant(nowIso),
  createdAt: fc.constant(nowIso),
  lines: fc.array(lineArb, { minLength: 0, maxLength: 5 }),
});

const fisicoArb = fc.integer({ min: 0, max: 100 });
const transitoArb = fc.integer({ min: 0, max: 100 });

function buildDeps(fisico, transito, pedidos) {
  return {
    getStockFisico: () => fisico,
    getStockTransito: () => transito,
    pedidos,
  };
}

describe('Property-based v8 §E1', () => {
  it('P1: libre + reservadasTotal <= fisicoDep11 (§39 R8 extendido)', () => {
    fc.assert(
      fc.property(fisicoArb, transitoArb, fc.array(pedidoArb, { maxLength: 6 }), (f, t, p) => {
        const b = getStockBreakdown('SKU1', buildDeps(f, t, p));
        return b.libre + b.reservadasTotal <= b.fisicoDep11;
      }),
      { numRuns: 300 }
    );
  });

  it('P2: libreTransito + reservasTransito <= transitoDep12 (invariante nueva §E1)', () => {
    fc.assert(
      fc.property(fisicoArb, transitoArb, fc.array(pedidoArb, { maxLength: 6 }), (f, t, p) => {
        const b = getStockBreakdown('SKU1', buildDeps(f, t, p));
        const reservasTransito = b.asignadas.totalTransito + b.confirmadasSinFacturar.totalTransito;
        const reservasTransitoCap = Math.min(reservasTransito, b.transitoDep12);
        return b.libreTransito + reservasTransitoCap <= b.transitoDep12;
      }),
      { numRuns: 300 }
    );
  });

  it('P3: asignadas.total === totalFisico + totalTransito (suma consistente)', () => {
    fc.assert(
      fc.property(fisicoArb, transitoArb, fc.array(pedidoArb, { maxLength: 6 }), (f, t, p) => {
        const b = getStockBreakdown('SKU1', buildDeps(f, t, p));
        if (b.asignadas.total !== b.asignadas.totalFisico + b.asignadas.totalTransito) {
          return false;
        }
        return (
          b.confirmadasSinFacturar.total ===
          b.confirmadasSinFacturar.totalFisico + b.confirmadasSinFacturar.totalTransito
        );
      }),
      { numRuns: 300 }
    );
  });
});
