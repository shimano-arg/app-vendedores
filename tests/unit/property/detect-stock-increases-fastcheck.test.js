import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  detectStockIncreases,
  detectTransitoCancelaciones,
} from '../../../src/pure/detect-stock-increases.js';

/**
 * Property-based tests para el detector de incrementos dep11 / dep12.
 * Plan 2026-11-17 reparto-dep12 §E0.
 *
 * Invariantes:
 *   P1: cada delta devuelto cumple after > before && delta == after - before > 0.
 *   P2: el conjunto de SKUs del output ⊆ el conjunto de SKUs del after snapshot.
 *   P3: una cancelación tránsito tiene qtyCancelada == dep12Bajo - dep11Subio y > 0.
 */

const skuArb = fc.string({ minLength: 3, maxLength: 10 }).filter((s) => /^[A-Za-z0-9]+$/.test(s));

const qtyArb = fc.integer({ min: 0, max: 1000 });

/** Snapshot con N SKUs, cada uno con dep11 + dep12 aleatorios 0..1000. */
const snapshotArb = fc
  .array(fc.record({ sku: skuArb, qty11: qtyArb, qty12: qtyArb }), { minLength: 0, maxLength: 20 })
  .map((entries) => {
    const breakdown = {};
    for (const e of entries) {
      breakdown[e.sku] = { 11: e.qty11, 12: e.qty12 };
    }
    return { warehouseBreakdown: JSON.stringify(breakdown) };
  });

describe('Property-based detectStockIncreases', () => {
  it('P1: cada delta cumple delta == after - before > 0', () => {
    fc.assert(
      fc.property(snapshotArb, snapshotArb, (before, after) => {
        const r = detectStockIncreases(before, after);
        for (const d of [...r.dep11Deltas, ...r.dep12Deltas]) {
          if (d.delta !== d.after - d.before) return false;
          if (d.delta <= 0) return false;
          if (d.after <= d.before) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('P2: todos los SKUs del output están en el after snapshot', () => {
    fc.assert(
      fc.property(snapshotArb, snapshotArb, (before, after) => {
        const afterBreakdown = JSON.parse(after.warehouseBreakdown);
        const afterSkus = new Set(Object.keys(afterBreakdown));
        const r = detectStockIncreases(before, after);
        for (const d of [...r.dep11Deltas, ...r.dep12Deltas]) {
          if (!afterSkus.has(d.sku)) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('P3: cada cancelación cumple qtyCancelada = max(0, dep12Bajo - dep11Subio) > 0', () => {
    fc.assert(
      fc.property(snapshotArb, snapshotArb, (before, after) => {
        const r = detectTransitoCancelaciones(before, after);
        for (const c of r) {
          const expected = Math.max(0, c.dep12Bajo - c.dep11Subio);
          if (c.qtyCancelada !== expected) return false;
          if (c.qtyCancelada <= 0) return false;
          if (c.dep12Bajo <= 0) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
