// @ts-check
import { describe, expect, it } from 'vitest';
import {
  resolveAndValidateDiscount,
  resolveDiscountForPersist,
  sanitizeDiscountSnapshot,
} from '../../src/pure/discount-validator.js';

describe('§91 sanitizeDiscountSnapshot', () => {
  it('devuelve null para null/undefined/non-object', () => {
    expect(sanitizeDiscountSnapshot(null)).toBeNull();
    expect(sanitizeDiscountSnapshot(undefined)).toBeNull();
    expect(sanitizeDiscountSnapshot(0)).toBeNull();
    expect(sanitizeDiscountSnapshot('')).toBeNull();
    expect(sanitizeDiscountSnapshot(false)).toBeNull();
  });

  it('preserva shape canonico con numeros validos', () => {
    const s = sanitizeDiscountSnapshot({
      pctFijo: 6,
      pctVol: 3,
      pctAntic: 5,
      pctTotal: 14,
      subtotal: 1000000,
      monto: 140000,
      total: 860000,
      calculatedAt: '2026-11-20T12:34:56Z',
    });
    expect(s).toEqual({
      pctFijo: 6,
      pctVol: 3,
      pctAntic: 5,
      pctTotal: 14,
      subtotal: 1000000,
      monto: 140000,
      total: 860000,
      calculatedAt: '2026-11-20T12:34:56Z',
    });
  });

  it('clampea pct* a [0, 100]', () => {
    const s = sanitizeDiscountSnapshot({
      pctFijo: -5,
      pctVol: 150,
      pctAntic: 10,
      pctTotal: 200,
    });
    expect(s?.pctFijo).toBe(0);
    expect(s?.pctVol).toBe(100);
    expect(s?.pctAntic).toBe(10);
    expect(s?.pctTotal).toBe(100);
  });

  it('clampea monto/subtotal/total a >= 0', () => {
    const s = sanitizeDiscountSnapshot({
      subtotal: -100,
      monto: -50,
      total: -25,
    });
    expect(s?.subtotal).toBe(0);
    expect(s?.monto).toBe(0);
    expect(s?.total).toBe(0);
  });

  it('calculatedAt no-string -> null', () => {
    const s = sanitizeDiscountSnapshot({ pctTotal: 10, calculatedAt: 123456 });
    expect(s?.calculatedAt).toBeNull();
  });

  it('NaN/Infinity/strings no-numericas -> 0 (toSafeNumber filtra antes del clamp)', () => {
    const s = sanitizeDiscountSnapshot({
      pctFijo: NaN,
      pctVol: Infinity,
      pctTotal: 'abc',
    });
    expect(s?.pctFijo).toBe(0);
    expect(s?.pctVol).toBe(0);
    expect(s?.pctTotal).toBe(0);
  });

  it('strings numericas se convierten', () => {
    const s = sanitizeDiscountSnapshot({ pctTotal: '12.5' });
    expect(s?.pctTotal).toBe(12.5);
  });
});

describe('§91 resolveAndValidateDiscount — happy paths', () => {
  it('payload vacio -> 0', () => {
    expect(resolveAndValidateDiscount({})).toBe(0);
    expect(resolveAndValidateDiscount(null)).toBe(0);
    expect(resolveAndValidateDiscount(undefined)).toBe(0);
  });

  it('solo discountPct', () => {
    expect(resolveAndValidateDiscount({ discountPct: 10 })).toBe(10);
  });

  it('solo discountSnapshot.pctTotal', () => {
    expect(
      resolveAndValidateDiscount({
        discountSnapshot: { pctTotal: 14 },
      })
    ).toBe(14);
  });

  it('ambos coherentes', () => {
    expect(
      resolveAndValidateDiscount({
        discountPct: 14,
        discountSnapshot: { pctTotal: 14 },
      })
    ).toBe(14);
  });

  it('ambos coherentes con tolerancia 0.005 (float rounding)', () => {
    expect(
      resolveAndValidateDiscount({
        discountPct: 14,
        discountSnapshot: { pctTotal: 14.005 },
      })
    ).toBe(14);
  });

  it('clamp [0, 100]', () => {
    expect(resolveAndValidateDiscount({ discountPct: 150 })).toBe(100);
    expect(resolveAndValidateDiscount({ discountPct: -5 })).toBe(0);
  });

  it('string numerica', () => {
    expect(resolveAndValidateDiscount({ discountPct: '17' })).toBe(17);
  });

  it('NaN -> 0', () => {
    expect(resolveAndValidateDiscount({ discountPct: NaN })).toBe(0);
  });
});

describe('§91 resolveAndValidateDiscount — ATK-004 coherence check', () => {
  it('discountPct=0 + snapshot.pctTotal=95 (ATK-004 scenario B) -> throw', () => {
    expect(() =>
      resolveAndValidateDiscount({
        discountPct: 0,
        discountSnapshot: { pctTotal: 95 },
      })
    ).toThrowError(/Descuento del pedido inconsistente/);
  });

  it('error carries _errorCode y _data', () => {
    try {
      resolveAndValidateDiscount({
        discountPct: 10,
        discountSnapshot: { pctTotal: 90 },
      });
      throw new Error('should have thrown');
    } catch (e) {
      const err = /** @type {any} */ (e);
      expect(err._errorCode).toBe('DISCOUNT_COHERENCE_MISMATCH');
      expect(err._data).toEqual({ flatPct: 10, snapshotPctTotal: 90, delta: 80 });
    }
  });

  it('delta > 0.01 pero < 0.1 -> throw (sin margen generoso)', () => {
    expect(() =>
      resolveAndValidateDiscount({
        discountPct: 14,
        discountSnapshot: { pctTotal: 14.05 },
      })
    ).toThrow();
  });

  it('delta == 0.01 (en el limite) -> OK', () => {
    expect(
      resolveAndValidateDiscount({
        discountPct: 14,
        discountSnapshot: { pctTotal: 14.01 },
      })
    ).toBe(14);
  });
});

describe('§91 resolveDiscountForPersist (helper combinado)', () => {
  it('payload con ambos coherentes -> {pct, snapshot}', () => {
    const r = resolveDiscountForPersist({
      discountPct: 14,
      discountSnapshot: {
        pctFijo: 6,
        pctVol: 3,
        pctAntic: 5,
        pctTotal: 14,
        subtotal: 1000000,
        monto: 140000,
        total: 860000,
      },
    });
    expect(r.discountPct).toBe(14);
    expect(r.discountSnapshot).toBeTruthy();
    expect(r.discountSnapshot?.pctTotal).toBe(14);
  });

  it('solo discountPct (sin snapshot) -> snapshot null', () => {
    const r = resolveDiscountForPersist({ discountPct: 10 });
    expect(r.discountPct).toBe(10);
    expect(r.discountSnapshot).toBeNull();
  });

  it('payload vacio -> pct=0, snapshot=null (comportamiento legacy)', () => {
    const r = resolveDiscountForPersist({});
    expect(r.discountPct).toBe(0);
    expect(r.discountSnapshot).toBeNull();
  });

  it('propaga throw del coherence check', () => {
    expect(() =>
      resolveDiscountForPersist({
        discountPct: 0,
        discountSnapshot: { pctTotal: 95 },
      })
    ).toThrow();
  });
});
