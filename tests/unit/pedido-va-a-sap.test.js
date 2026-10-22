// @ts-check
/**
 * v1418 §53 (2026-10-22) — tests del pure helper computeVaASap.
 *
 * Fixture PONTORIERO ORDEN 524: 5 líneas confirmed + descuento 17%.
 * El total "VA A SAP" debe ser consistente en modal detalle, Planner card
 * y payload SL (DiscountPercent + lines sin descuento → SAP calcula).
 */
import { describe, expect, it } from 'vitest';
import {
  computeVaASap,
  readDiscountPct,
  sumConfirmedBruto,
} from '../../src/pure/pedido-va-a-sap.js';

const FIXTURE_524 = {
  // Precios ficticios (los reales están en el SAP real; el fixture los simula).
  // La idea es que confirmed_sum × (1 - 0.17) ≈ "va a SAP" del modal.
  discountPct: 17,
  discountSnapshot: { pctTotal: 17 },
  netAmountArs: null, // no se usa cuando hay confirmed
  lines: [
    { code: 'EXGTVS90M4CH', state: 'confirmed', qty: 1, precio: 288_000 },
    { code: 'EXGTVC66M4AR', state: 'confirmed', qty: 2, precio: 288_000 },
    { code: 'EXGTVS70MH4AR', state: 'confirmed', qty: 3, precio: 288_000 },
    { code: 'CLC70HAR', state: 'confirmed', qty: 4, precio: 160_000 },
    { code: 'CLC66HAR', state: 'confirmed', qty: 2, precio: 160_000 },
  ],
};
// Confirmed bruto: 1×288k + 2×288k + 3×288k + 4×160k + 2×160k
//   = 288_000 + 576_000 + 864_000 + 640_000 + 320_000
//   = 2_688_000
// × (1 - 17/100) = 2_688_000 × 0.83 = 2_231_040

describe('sumConfirmedBruto', () => {
  it('suma solo líneas state=confirmed', () => {
    const lines = [
      { state: 'confirmed', qty: 2, precio: 100 },
      { state: 'BO', qty: 10, precio: 100 },
      { state: 'cancelled', qty: 5, precio: 100 },
      { state: 'ASIG', qty: 3, precio: 100 },
    ];
    expect(sumConfirmedBruto(lines)).toBe(200);
  });

  it('respeta precedencia precio > priceAtCreation > price', () => {
    const l1 = [{ state: 'confirmed', qty: 1, precio: 100, priceAtCreation: 999, price: 888 }];
    expect(sumConfirmedBruto(l1)).toBe(100);
    const l2 = [{ state: 'confirmed', qty: 1, priceAtCreation: 50, price: 888 }];
    expect(sumConfirmedBruto(l2)).toBe(50);
    const l3 = [{ state: 'confirmed', qty: 1, price: 30 }];
    expect(sumConfirmedBruto(l3)).toBe(30);
  });

  it('ignora líneas sin qty o sin precio', () => {
    const l = [
      { state: 'confirmed', qty: 0, precio: 100 },
      { state: 'confirmed', qty: 2, precio: 0 },
      { state: 'confirmed', qty: 1, precio: 50 },
    ];
    expect(sumConfirmedBruto(l)).toBe(50);
  });

  it('null/undefined/no-array → 0', () => {
    expect(sumConfirmedBruto(null)).toBe(0);
    expect(sumConfirmedBruto(undefined)).toBe(0);
    // @ts-expect-error — intencional test defensivo
    expect(sumConfirmedBruto({})).toBe(0);
  });

  it('fixture 524 confirmed = $2.688.000', () => {
    expect(sumConfirmedBruto(FIXTURE_524.lines)).toBe(2_688_000);
  });
});

describe('readDiscountPct', () => {
  it('prioriza discountPct sobre discountSnapshot', () => {
    expect(readDiscountPct({ discountPct: 10, discountSnapshot: { pctTotal: 20 } })).toBe(10);
  });

  it('fallback a discountSnapshot.pctTotal', () => {
    expect(readDiscountPct({ discountSnapshot: { pctTotal: 17 } })).toBe(17);
  });

  it('null/undefined → 0', () => {
    expect(readDiscountPct(null)).toBe(0);
    expect(readDiscountPct(undefined)).toBe(0);
    expect(readDiscountPct({})).toBe(0);
  });

  it('clamp a [0, 100]', () => {
    expect(readDiscountPct({ discountPct: -5 })).toBe(0);
    expect(readDiscountPct({ discountPct: 150 })).toBe(100);
    expect(readDiscountPct({ discountPct: 0 })).toBe(0);
    expect(readDiscountPct({ discountPct: 100 })).toBe(100);
  });

  it('ignora NaN', () => {
    expect(readDiscountPct({ discountPct: Number.NaN })).toBe(0);
  });

  it('fixture 524 pct = 17', () => {
    expect(readDiscountPct(FIXTURE_524)).toBe(17);
  });
});

describe('computeVaASap — fuente única', () => {
  it('fixture ORDEN 524: $2.688.000 × 0.83 = $2.231.040', () => {
    expect(computeVaASap(FIXTURE_524)).toBe(2_231_040);
  });

  it('prioriza sapDocTotal si existe (sync real desde SAP)', () => {
    const p = { ...FIXTURE_524, sapDocTotal: 2_389_570 };
    expect(computeVaASap(p)).toBe(2_389_570);
  });

  it('ignora sapDocTotal si es 0 o negativo', () => {
    expect(computeVaASap({ ...FIXTURE_524, sapDocTotal: 0 })).toBe(2_231_040);
    expect(computeVaASap({ ...FIXTURE_524, sapDocTotal: -100 })).toBe(2_231_040);
  });

  it('pedido sin confirmed → fallback a netAmountArs', () => {
    const p = {
      lines: [{ state: 'BO', qty: 10, precio: 100 }],
      netAmountArs: 500_000,
    };
    expect(computeVaASap(p)).toBe(500_000);
  });

  it('pedido sin confirmed ni netAmountArs → fallback a subtotalArs', () => {
    const p = {
      lines: [{ state: 'BO', qty: 10, precio: 100 }],
      subtotalArs: 300_000,
    };
    expect(computeVaASap(p)).toBe(300_000);
  });

  it('pedido vacío sin ningún total → null', () => {
    expect(computeVaASap({})).toBe(null);
    expect(computeVaASap(null)).toBe(null);
  });

  it('pedido con discountPct=0 → bruto == neto', () => {
    const p = {
      discountPct: 0,
      lines: [{ state: 'confirmed', qty: 1, precio: 100 }],
    };
    expect(computeVaASap(p)).toBe(100);
  });

  it('pedido con descuento aplicado solo sobre confirmed (ignora BO)', () => {
    const p = {
      discountPct: 10,
      lines: [
        { state: 'confirmed', qty: 1, precio: 1000 },
        { state: 'BO', qty: 5, precio: 500 }, // Backorder NO va a SAP
      ],
    };
    // bruto confirmed = 1000; neto = 1000 × 0.9 = 900. BO excluido.
    expect(computeVaASap(p)).toBe(900);
  });

  it('redondea al entero más cercano', () => {
    const p = {
      discountPct: 7,
      lines: [{ state: 'confirmed', qty: 1, precio: 1_000_033 }],
    };
    // 1_000_033 × 0.93 = 930_030.69 → 930_031
    expect(computeVaASap(p)).toBe(930_031);
  });
});
