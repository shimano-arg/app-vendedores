// @ts-check
/**
 * STACK S-4 T5 — §57 Test de sincronía entre `src/pure/discount.js` y
 * `functions/core/discount.js`.
 *
 * Si los dos archivos divergen (en API pública o en comportamiento), este
 * test falla. Ver STACK_08_D12_PLAN_FIX.md §3.2.
 *
 * Fixtures cubren:
 * - Los 3 componentes: fijo (P/A/B/C), volumen (5 brackets), anticipo (solo
 *   CONTADO con tipo P/A).
 * - Clientes sin cliTipo → solo volumen aplica.
 * - Combinaciones máximas (P + CONTADO + subtotal > $20M = 6+6+5 = 17%).
 * - Edge cases: subtotal=0, formaPago vacío, cliTipo desconocido.
 */
import { describe, expect, it } from 'vitest';
import * as mirror from '../../../functions/core/discount.js';
import * as pure from '../../../src/pure/discount.js';

const FIXTURES = [
  // Sin tipo + subtotal pequeño + CTA CTE = 0%
  { cliTipo: '', subtotal: 1_000_000, formaPago: 'CTA CTE' },
  // P + CTA CTE + subtotal $5M = fijo 6 + vol 3 + antic 0 = 9%
  { cliTipo: 'P', subtotal: 5_000_000, formaPago: 'CTA CTE' },
  // P + CONTADO + subtotal $5M = 6+3+5 = 14%
  { cliTipo: 'P', subtotal: 5_000_000, formaPago: 'CONTADO' },
  // A + CONTADO + subtotal $1M = fijo 3 + vol 0 + antic 3 = 6%
  { cliTipo: 'A', subtotal: 1_000_000, formaPago: 'CONTADO' },
  // Sin tipo + subtotal $25M + CONTADO = 0 + 6 + 0 = 6%
  { cliTipo: '', subtotal: 25_000_000, formaPago: 'CONTADO' },
  // B + CONTADO = 0 (B y C no tienen fijo ni anticipo)
  { cliTipo: 'B', subtotal: 100_000, formaPago: 'CONTADO' },
  // C + volumen $10M+ = 0 + 4 + 0 = 4%
  { cliTipo: 'C', subtotal: 11_000_000, formaPago: 'CTA CTE' },
  // Edge: subtotal 0
  { cliTipo: 'P', subtotal: 0, formaPago: 'CONTADO' },
  // Edge: formaPago null
  { cliTipo: 'P', subtotal: 5_000_000, formaPago: null },
  // Combinación máxima: P + CONTADO + > $20M = 6+6+5 = 17%
  { cliTipo: 'P', subtotal: 25_000_000, formaPago: 'CONTADO' },
];

describe('STACK S-4 T5 §57 discount sync: src/pure vs functions/core', () => {
  it('ambos exportan calcClientDiscount', () => {
    expect(typeof pure.calcClientDiscount).toBe('function');
    expect(typeof mirror.calcClientDiscount).toBe('function');
  });

  // STACK_08 §3.2: el mirror exporta FIJO_PCT/ANTIC_PCT para consumo externo
  // (scripts audit, tooling). El pure los deja privados (`const` sin export)
  // porque no los necesita fuera de calcClientDiscount. La paridad real que
  // importa es comportamental, no estructural.
  it('mirror expone FIJO_PCT y ANTIC_PCT para consumo externo', () => {
    expect(mirror.FIJO_PCT).toBeDefined();
    expect(mirror.ANTIC_PCT).toBeDefined();
    expect(mirror.FIJO_PCT).toEqual({ P: 6, A: 3, B: 0, C: 0 });
    expect(mirror.ANTIC_PCT).toEqual({ P: 5, A: 3, B: 0, C: 0 });
  });

  for (let i = 0; i < FIXTURES.length; i++) {
    const f = FIXTURES[i];
    it(`fixture[${i}] cliTipo=${f.cliTipo || '""'} subtotal=${f.subtotal} formaPago=${f.formaPago || '""'} → mismo output`, () => {
      const rPure = pure.calcClientDiscount({ cliTipo: f.cliTipo }, f.subtotal, f.formaPago);
      const rMirror = mirror.calcClientDiscount({ cliTipo: f.cliTipo }, f.subtotal, f.formaPago);
      expect(rMirror).toEqual(rPure);
    });
  }

  it('ambos manejan clientData=null igual', () => {
    const rPure = pure.calcClientDiscount(null, 5_000_000, 'CONTADO');
    const rMirror = mirror.calcClientDiscount(null, 5_000_000, 'CONTADO');
    expect(rMirror).toEqual(rPure);
    expect(rPure.pctTotal).toBe(3); // solo volumen $4.5M-$10M
  });

  it('ambos manejan clientData=undefined igual', () => {
    const rPure = pure.calcClientDiscount(undefined, 100_000, 'CONTADO');
    const rMirror = mirror.calcClientDiscount(undefined, 100_000, 'CONTADO');
    expect(rMirror).toEqual(rPure);
  });
});
