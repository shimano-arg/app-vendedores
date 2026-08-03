import { describe, expect, it } from 'vitest';
import { calcClientDiscount } from '../../src/pure/discount.js';

describe('calcClientDiscount', () => {
  it('happy: cliente P, subtotal $5M, CONTADO → 6% fijo + 3% vol + 5% antic = 14%', () => {
    const d = calcClientDiscount({ cliTipo: 'P' }, 5_000_000, 'CONTADO');
    expect(d.pctFijo).toBe(6);
    expect(d.pctVol).toBe(3);
    expect(d.pctAntic).toBe(5);
    expect(d.pctTotal).toBe(14);
    expect(d.monto).toBe(700_000);
    expect(d.total).toBe(4_300_000);
    expect(d.vol).toBe('$4.5M-$10M');
  });

  it('bracket volumen: hasta $3M → 0%', () => {
    const d = calcClientDiscount({ cliTipo: 'C' }, 2_500_000, 'CTA CTE');
    expect(d.pctVol).toBe(0);
    expect(d.vol).toBe('hasta $3M');
  });

  it('bracket volumen: mas de $20M → 6%', () => {
    const d = calcClientDiscount({ cliTipo: 'C' }, 25_000_000, 'CTA CTE');
    expect(d.pctVol).toBe(6);
    expect(d.vol).toBe('mas de $20M');
  });

  it('bracket boundary: exactamente $3M → hasta $3M (no salta)', () => {
    // Rule: `subtotal > 3M` para el bracket 2. Exactly 3M queda en "hasta $3M".
    const d = calcClientDiscount({ cliTipo: 'B' }, 3_000_000, 'CTA CTE');
    expect(d.pctVol).toBe(0);
  });

  it('bracket boundary: apenas por encima de $3M → salta a 2%', () => {
    const d = calcClientDiscount({ cliTipo: 'B' }, 3_000_001, 'CTA CTE');
    expect(d.pctVol).toBe(2);
  });

  it('anticipado NO aplica si formaPago ≠ CONTADO', () => {
    const d = calcClientDiscount({ cliTipo: 'P' }, 1_000_000, 'CTA CTE');
    expect(d.pctAntic).toBe(0);
    expect(d.pctTotal).toBe(6); // solo fijo
  });

  it('cliente sin categoría: pctFijo=0 pctAntic=0 pero pctVol puede correr', () => {
    const d = calcClientDiscount({}, 15_000_000, 'CONTADO');
    expect(d.pctFijo).toBe(0);
    expect(d.pctAntic).toBe(0);
    expect(d.pctVol).toBe(4);
    expect(d.pctTotal).toBe(4);
  });

  it('clientData null: no rompe, tipo=""', () => {
    const d = calcClientDiscount(null, 1_000_000, 'CONTADO');
    expect(d.tipo).toBe('');
    expect(d.pctTotal).toBe(0);
  });

  it('hasAny=false solo si NO hay tipo, NO hay formaPago y volumen=0', () => {
    // La fórmula es `!!(tipo || formaPago || pctVol>0)`. Categoría 'C'
    // hace hasAny=true aunque el descuento resultante sea 0%. Documenta
    // la intención: "cliente ya categorizado" vs "descuento distinto de cero".
    const d = calcClientDiscount({ cliTipo: '' }, 1_000_000, '');
    expect(d.hasAny).toBe(false);
  });

  it('hasAny=true si el cliente tiene tipo aunque sea C (0% de descuento)', () => {
    const d = calcClientDiscount({ cliTipo: 'C' }, 1_000_000, '');
    expect(d.pctTotal).toBe(0);
    expect(d.hasAny).toBe(true);
  });

  it('hasAny=true cuando aplica volumen sin categoría', () => {
    const d = calcClientDiscount({}, 25_000_000, '');
    expect(d.hasAny).toBe(true);
  });
});
