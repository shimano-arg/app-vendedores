// @ts-check
import { describe, expect, it } from 'vitest';
import { resolveDiscountForPersist } from '../../functions/core/discount-validator.js';

/**
 * §91 (Fix D12-CRITICAL-01 2026-11-20) — tests de integracion server-side.
 *
 * Cobertura:
 *   1. Persistencia del descuento en el pedido (via helper del core).
 *   2. Coherencia pct vs snapshot.pctTotal (defensa ATK-004).
 *   3. Clamp defensivo [0, 100].
 *   4. Backward compat con payload legacy (sin discountPct ni snapshot).
 *   5. Regresion del hardcode 0.
 *
 * Nota: estos tests invocan el helper directamente para probar la unidad
 * minima que fija el bug. Tests end-to-end contra `commitPedidoCore` quedan
 * en archivos existentes (se extienden en commit-pedido-core.test.js).
 */

describe('§91 D12 — persistencia descuento en buildPedidoDocData (via helper)', () => {
  it('payload con descuento 10% + snapshot coherente -> persiste 10 + snapshot sanitizado', () => {
    const payload = {
      cardCode: 'C001',
      discountPct: 10,
      discountSnapshot: {
        pctFijo: 6,
        pctVol: 3,
        pctAntic: 1,
        pctTotal: 10,
        subtotal: 1000000,
        monto: 100000,
        total: 900000,
      },
    };
    const r = resolveDiscountForPersist(payload);
    expect(r.discountPct).toBe(10);
    expect(r.discountSnapshot).toBeTruthy();
    expect(r.discountSnapshot?.pctTotal).toBe(10);
    expect(r.discountSnapshot?.subtotal).toBe(1000000);
    expect(r.discountSnapshot?.monto).toBe(100000);
  });

  it('payload SIN descuento (legacy pre-D12) -> persiste 0 + snapshot null', () => {
    const payload = { cardCode: 'C001' };
    const r = resolveDiscountForPersist(payload);
    expect(r.discountPct).toBe(0);
    expect(r.discountSnapshot).toBeNull();
  });

  it('payload con solo discountPct (sin snapshot) -> persiste pct + snapshot null', () => {
    const payload = { cardCode: 'C001', discountPct: 15 };
    const r = resolveDiscountForPersist(payload);
    expect(r.discountPct).toBe(15);
    expect(r.discountSnapshot).toBeNull();
  });

  it('payload con solo snapshot (sin pct) -> persiste pctTotal + snapshot', () => {
    const payload = {
      cardCode: 'C001',
      discountSnapshot: { pctTotal: 14 },
    };
    const r = resolveDiscountForPersist(payload);
    expect(r.discountPct).toBe(14);
    expect(r.discountSnapshot?.pctTotal).toBe(14);
  });

  it('regresion: NUNCA persiste discountPct:0 cuando el payload dice 17 (bug v1430->v1475)', () => {
    const payload = {
      cardCode: 'C001',
      discountPct: 17,
      discountSnapshot: { pctTotal: 17 },
    };
    const r = resolveDiscountForPersist(payload);
    // Si este test falla, el hardcode `discountPct: 0` volvio a la vida.
    expect(r.discountPct).not.toBe(0);
    expect(r.discountPct).toBe(17);
  });
});

describe('§91 D12 — defensa ATK-004 (coherence check)', () => {
  it('ATK-004-A: VDE escalava discountPct=90 con snapshot.pctTotal=10 -> rechaza', () => {
    const payload = {
      cardCode: 'C001',
      discountPct: 90,
      discountSnapshot: { pctTotal: 10 },
    };
    expect(() => resolveDiscountForPersist(payload)).toThrowError(
      /Descuento del pedido inconsistente/
    );
  });

  it('ATK-004-B: discountPct=0 + snapshot.pctTotal=95 (oculta descuento al admin) -> rechaza', () => {
    const payload = {
      cardCode: 'C001',
      discountPct: 0,
      discountSnapshot: { pctTotal: 95 },
    };
    expect(() => resolveDiscountForPersist(payload)).toThrowError(
      /Descuento del pedido inconsistente/
    );
  });

  it('throw carries _errorCode=DISCOUNT_COHERENCE_MISMATCH para logging §64.2', () => {
    const payload = {
      cardCode: 'C001',
      discountPct: 50,
      discountSnapshot: { pctTotal: 10 },
    };
    try {
      resolveDiscountForPersist(payload);
      throw new Error('expected throw');
    } catch (e) {
      const err = /** @type {any} */ (e);
      expect(err._errorCode).toBe('DISCOUNT_COHERENCE_MISMATCH');
      expect(err._data).toHaveProperty('flatPct');
      expect(err._data).toHaveProperty('snapshotPctTotal');
      expect(err._data).toHaveProperty('delta');
      expect(err._data.delta).toBe(40);
    }
  });
});

describe('§91 D12 — clamp defensivo [0, 100]', () => {
  it('discountPct=150 -> clamp a 100', () => {
    const r = resolveDiscountForPersist({ discountPct: 150 });
    expect(r.discountPct).toBe(100);
  });

  it('discountPct=-10 -> clamp a 0', () => {
    const r = resolveDiscountForPersist({ discountPct: -10 });
    expect(r.discountPct).toBe(0);
  });

  it('snapshot.pctFijo=150 -> clamp a 100', () => {
    const r = resolveDiscountForPersist({
      discountPct: 50,
      discountSnapshot: { pctTotal: 50, pctFijo: 150 },
    });
    expect(r.discountSnapshot?.pctFijo).toBe(100);
  });

  it('snapshot.pctFijo=-5 -> clamp a 0', () => {
    const r = resolveDiscountForPersist({
      discountPct: 0,
      discountSnapshot: { pctTotal: 0, pctFijo: -5 },
    });
    expect(r.discountSnapshot?.pctFijo).toBe(0);
  });

  it('NaN/Infinity no genera NaN en el pedido final (toSafeNumber filtra antes del clamp)', () => {
    const r = resolveDiscountForPersist({
      discountPct: NaN,
      discountSnapshot: { pctTotal: Infinity },
    });
    // NaN y Infinity -> 0 por toSafeNumber; coherencia OK; devuelve 0.
    expect(r.discountPct).toBe(0);
    expect(r.discountSnapshot?.pctTotal).toBe(0);
  });
});
