import { describe, expect, it } from 'vitest';
import {
  detectStockIncreases,
  detectTransitoCancelaciones,
} from '../../src/pure/detect-stock-increases.js';

/**
 * Helper: construye un snapshot mínimo con warehouseBreakdown como JSON string
 * (patrón sync Python v368+) o como objeto (patrón in-memory).
 */
function snap(breakdown, { asString = true } = {}) {
  if (!breakdown) return { warehouseBreakdown: null };
  return { warehouseBreakdown: asString ? JSON.stringify(breakdown) : breakdown };
}

describe('detectStockIncreases — Reparto dep 12 §E0', () => {
  it('T1: dep11 sube de 0 a 5 → 1 delta dep11', () => {
    const before = snap({ SKU1: { 11: 0 } });
    const after = snap({ SKU1: { 11: 5 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas).toEqual([{ sku: 'SKU1', warehouse: 11, before: 0, after: 5, delta: 5 }]);
    expect(r.dep12Deltas).toEqual([]);
  });

  it('T2: dep12 sube de 0 a 3 → 1 delta dep12 (caso nuevo del plan)', () => {
    const before = snap({ SKU2: { 11: 0, 12: 0 } });
    const after = snap({ SKU2: { 11: 0, 12: 3 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep12Deltas).toEqual([{ sku: 'SKU2', warehouse: 12, before: 0, after: 3, delta: 3 }]);
    expect(r.dep11Deltas).toEqual([]);
  });

  it('T3: dep11 Y dep12 suben simultáneo → 2 deltas (uno por bucket)', () => {
    const before = snap({ SKU3: { 11: 1, 12: 2 } });
    const after = snap({ SKU3: { 11: 4, 12: 7 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas).toEqual([{ sku: 'SKU3', warehouse: 11, before: 1, after: 4, delta: 3 }]);
    expect(r.dep12Deltas).toEqual([{ sku: 'SKU3', warehouse: 12, before: 2, after: 7, delta: 5 }]);
  });

  it('T4: dep11 baja (de 5 a 3) → NO se incluye (solo subidas)', () => {
    const before = snap({ SKU4: { 11: 5 } });
    const after = snap({ SKU4: { 11: 3 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas).toEqual([]);
    expect(r.dep12Deltas).toEqual([]);
  });

  it('T5: dep11 estable (5 → 5) → NO se incluye', () => {
    const before = snap({ SKU5: { 11: 5 } });
    const after = snap({ SKU5: { 11: 5 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas).toEqual([]);
  });

  it('T6: SKU nuevo (no estaba en before) con dep12=4 → delta 0 → 4', () => {
    const before = snap({});
    const after = snap({ NUEVO: { 12: 4 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep12Deltas).toEqual([{ sku: 'NUEVO', warehouse: 12, before: 0, after: 4, delta: 4 }]);
  });

  it('T7: before=null, after con subidas → todas se detectan desde 0', () => {
    const r = detectStockIncreases(null, snap({ X: { 11: 2, 12: 3 } }));
    expect(r.dep11Deltas[0].delta).toBe(2);
    expect(r.dep12Deltas[0].delta).toBe(3);
  });

  it('T8: before + after idénticos → 0 deltas', () => {
    const b = snap({ Y: { 11: 1, 12: 1 } });
    const a = snap({ Y: { 11: 1, 12: 1 } });
    const r = detectStockIncreases(b, a);
    expect(r.dep11Deltas).toEqual([]);
    expect(r.dep12Deltas).toEqual([]);
  });

  it('T9: breakdown viene como OBJETO (no JSON string) → funciona igual', () => {
    const before = snap({ Z: { 11: 0 } }, { asString: false });
    const after = snap({ Z: { 11: 5 } }, { asString: false });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas[0].delta).toBe(5);
  });

  it('T10: breakdown JSON string corrupto → treats as empty + no explota', () => {
    const r = detectStockIncreases(
      { warehouseBreakdown: '{"not valid json' },
      { warehouseBreakdown: '{"ok":true}' }
    );
    expect(r.dep11Deltas).toEqual([]);
    expect(r.dep12Deltas).toEqual([]);
  });

  it('T11: ignora depósitos que NO son 11 ni 12 (ej. dep 07 muestras)', () => {
    const before = snap({ W: { 7: 5, 11: 0 } });
    const after = snap({ W: { 7: 20, 11: 0 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas).toEqual([]);
    expect(r.dep12Deltas).toEqual([]);
  });

  it('T12: varios SKUs, mix completo', () => {
    const before = snap({
      A: { 11: 1, 12: 0 },
      B: { 11: 0, 12: 0 },
      C: { 11: 5, 12: 5 },
    });
    const after = snap({
      A: { 11: 3, 12: 0 }, // sube 2 en 11
      B: { 11: 0, 12: 10 }, // sube 10 en 12
      C: { 11: 5, 12: 5 }, // estable
      D: { 11: 7, 12: 3 }, // sku nuevo
    });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas.map((d) => d.sku).sort()).toEqual(['A', 'D']);
    expect(r.dep12Deltas.map((d) => d.sku).sort()).toEqual(['B', 'D']);
  });

  it('T13: delta negativo por qty negativa stale → tolerado como 0', () => {
    // getQtyFromBreakdown clampa qty negativa a 0 (defensa contra data corrupta).
    const before = snap({ E: { 11: -1 } });
    const after = snap({ E: { 11: 5 } });
    const r = detectStockIncreases(before, after);
    expect(r.dep11Deltas[0]).toEqual({
      sku: 'E',
      warehouse: 11,
      before: 0, // clamp: era -1 → 0
      after: 5,
      delta: 5,
    });
  });
});

describe('detectTransitoCancelaciones — §A3 plan (partida cancelada)', () => {
  it('T14: dep12 -10, dep11 +10 (llegada normal) → NO alerta', () => {
    const before = snap({ A: { 11: 0, 12: 10 } });
    const after = snap({ A: { 11: 10, 12: 0 } });
    const r = detectTransitoCancelaciones(before, after);
    expect(r).toEqual([]);
  });

  it('T15: dep12 -10, dep11 +0 (cancelación total) → alerta por 10', () => {
    const before = snap({ B: { 11: 0, 12: 10 } });
    const after = snap({ B: { 11: 0, 12: 0 } });
    const r = detectTransitoCancelaciones(before, after);
    expect(r).toEqual([{ sku: 'B', dep12Bajo: 10, dep11Subio: 0, qtyCancelada: 10 }]);
  });

  it('T16: dep12 -10, dep11 +7 (quiebre parcial) → alerta por 3', () => {
    const before = snap({ C: { 11: 0, 12: 10 } });
    const after = snap({ C: { 11: 7, 12: 0 } });
    const r = detectTransitoCancelaciones(before, after);
    expect(r).toEqual([{ sku: 'C', dep12Bajo: 10, dep11Subio: 7, qtyCancelada: 3 }]);
  });

  it('T17: dep12 estable → NO alerta aunque dep11 haya subido/bajado', () => {
    const before = snap({ D: { 11: 5, 12: 5 } });
    const after = snap({ D: { 11: 2, 12: 5 } });
    const r = detectTransitoCancelaciones(before, after);
    expect(r).toEqual([]);
  });

  it('T18: dep12 sube (no baja) → NO alerta (es un ingreso normal)', () => {
    const before = snap({ E: { 11: 0, 12: 5 } });
    const after = snap({ E: { 11: 0, 12: 10 } });
    const r = detectTransitoCancelaciones(before, after);
    expect(r).toEqual([]);
  });

  it('T19: múltiples SKUs mixtos — solo las cancelaciones', () => {
    const before = snap({
      A: { 11: 0, 12: 10 },
      B: { 11: 2, 12: 8 },
      C: { 11: 0, 12: 5 },
    });
    const after = snap({
      A: { 11: 10, 12: 0 }, // llegada normal
      B: { 11: 2, 12: 0 }, // cancelación total (8 -> 0 sin que suba dep11)
      C: { 11: 2, 12: 0 }, // parcial (5 -> 0, dep11 solo sumó 2)
    });
    const r = detectTransitoCancelaciones(before, after);
    expect(r.sort((x, y) => x.sku.localeCompare(y.sku))).toEqual([
      { sku: 'B', dep12Bajo: 8, dep11Subio: 0, qtyCancelada: 8 },
      { sku: 'C', dep12Bajo: 5, dep11Subio: 2, qtyCancelada: 3 },
    ]);
  });

  it('T20: before null → NO alertas (nada que cancelar)', () => {
    const r = detectTransitoCancelaciones(null, snap({ X: { 11: 5, 12: 0 } }));
    expect(r).toEqual([]);
  });
});
