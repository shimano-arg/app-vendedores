// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDepsHash,
  cacheKeyFor,
  clearPrewarmCache,
  getPrewarmedBreakdown,
  getPrewarmStats,
  normSku,
  schedulePrewarm,
} from '../../src/pure/prewarm-stock.js';

afterEach(() => {
  clearPrewarmCache();
});

describe('normSku', () => {
  it('trim + uppercase', () => {
    expect(normSku('  abc ')).toBe('ABC');
    expect(normSku('Sku-A')).toBe('SKU-A');
    expect(normSku(null)).toBe('');
    expect(normSku(undefined)).toBe('');
  });
});

describe('cacheKeyFor', () => {
  it('estable para mismo SKU + depsHash', () => {
    expect(cacheKeyFor('abc', 'h1')).toBe(cacheKeyFor('ABC', 'h1'));
  });
  it('depende de depsHash', () => {
    expect(cacheKeyFor('ABC', 'h1')).not.toBe(cacheKeyFor('ABC', 'h2'));
  });
});

describe('buildDepsHash', () => {
  it('cambia cuando snapshot.updatedAt cambia', () => {
    expect(buildDepsHash({ updatedAtMs: 1 }, 10)).not.toBe(buildDepsHash({ updatedAtMs: 2 }, 10));
  });
  it('cambia cuando count cambia', () => {
    expect(buildDepsHash({ updatedAtMs: 1 }, 10)).not.toBe(buildDepsHash({ updatedAtMs: 1 }, 11));
  });
  it('maneja snapshot null / count no numérico', () => {
    expect(buildDepsHash(null, NaN)).toBe('0:0');
    expect(buildDepsHash({}, -5)).toBe('0:0');
  });
});

describe('getPrewarmedBreakdown — equivalencia', () => {
  it('cold miss ejecuta compute + guarda; warm hit NO re-ejecuta', () => {
    const computeSpy = vi.fn(() => ({ libre: 5, reservadasTotal: 2 }));
    const r1 = getPrewarmedBreakdown('SKU-A', 'h1', computeSpy);
    const r2 = getPrewarmedBreakdown('SKU-A', 'h1', computeSpy);
    expect(computeSpy).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
    // Equivalencia JSON:
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('depsHash distinto → re-computa', () => {
    const vals = [{ libre: 5 }, { libre: 3 }];
    let idx = 0;
    const compute = () => vals[idx++];
    getPrewarmedBreakdown('SKU-A', 'h1', compute);
    const r2 = getPrewarmedBreakdown('SKU-A', 'h2', compute);
    expect(idx).toBe(2);
    expect(r2.libre).toBe(3);
  });

  it('TTL expirado → re-computa', () => {
    const vals = [{ libre: 5 }, { libre: 7 }];
    let idx = 0;
    const compute = () => vals[idx++];
    getPrewarmedBreakdown('SKU-A', 'h1', compute, { nowMs: 1000, ttlMs: 5000 });
    // 6s después: TTL expirado.
    const r2 = getPrewarmedBreakdown('SKU-A', 'h1', compute, { nowMs: 7000, ttlMs: 5000 });
    expect(idx).toBe(2);
    expect(r2.libre).toBe(7);
  });

  it('propaga error de compute (no swallow)', () => {
    const compute = () => {
      throw new Error('boom');
    };
    expect(() => getPrewarmedBreakdown('SKU-A', 'h1', compute)).toThrow('boom');
    expect(getPrewarmStats().misses).toBe(1);
    expect(getPrewarmStats().hits).toBe(0);
  });
});

describe('schedulePrewarm — equivalencia batch', () => {
  it('computa cada SKU único UNA sola vez', () => {
    const computeSpy = vi.fn((sku) => ({ sku, libre: 10 }));
    const result = schedulePrewarm(['SKU-A', 'SKU-B', 'SKU-A', '  sku-b '], 'h1', computeSpy);
    expect(computeSpy).toHaveBeenCalledTimes(2); // dedup → 2 unique
    expect(result).toEqual({ computed: 2, cached: 0, total: 2 });
  });

  it('segunda llamada dentro del TTL con mismo depsHash → cached', () => {
    const computeSpy = vi.fn((sku) => ({ sku, libre: 10 }));
    schedulePrewarm(['SKU-A'], 'h1', computeSpy);
    const result2 = schedulePrewarm(['SKU-A'], 'h1', computeSpy);
    expect(computeSpy).toHaveBeenCalledTimes(1);
    expect(result2).toEqual({ computed: 0, cached: 1, total: 1 });
  });

  it('filtra SKU vacíos / null', () => {
    const computeSpy = vi.fn((sku) => ({ sku }));
    const result = schedulePrewarm(['', null, '   ', 'SKU-A'], 'h1', computeSpy);
    expect(result.total).toBe(1);
  });

  it('skip SKU que falle compute (sin romper otros)', () => {
    const compute = (sku) => {
      if (sku === 'SKU-B') throw new Error('bad sku');
      return { sku, ok: true };
    };
    const result = schedulePrewarm(['SKU-A', 'SKU-B', 'SKU-C'], 'h1', compute);
    // SKU-A y SKU-C computed, SKU-B saltado (no cache entry).
    expect(result.computed).toBe(2);
    // Siguiente call sobre SKU-B re-intenta (no quedó cacheado).
    const result2 = schedulePrewarm(['SKU-B'], 'h1', () => ({ sku: 'SKU-B', ok: true }));
    expect(result2.computed).toBe(1);
  });
});

describe('Concurrencia conceptual', () => {
  it('dos schedulePrewarm con mismo SKU+depsHash NO duplican compute', () => {
    const computeSpy = vi.fn((sku) => ({ sku, libre: 10 }));
    // JS single-threaded: el 2do call ve el cache del 1ro ya sembrado.
    schedulePrewarm(['SKU-A'], 'h1', computeSpy);
    schedulePrewarm(['SKU-A'], 'h1', computeSpy);
    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it('sobreasignación — breakdown computado idéntico vía cache vs cálculo directo', () => {
    // Fixture simula un breakdown con sobreasignación (asignadas.total > fisicoDep11).
    const fixture = {
      sku: 'SKU-OVER',
      fisicoDep11: 2,
      asignadas: { total: 6, porCliente: [{ cardCode: 'C1', qty: 6 }] },
      reservadasTotal: 2, // cap por físico §40.2
      libre: 0,
    };
    const compute = () => JSON.parse(JSON.stringify(fixture));
    const direct = compute();
    const cached = getPrewarmedBreakdown('SKU-OVER', 'h1', compute);
    expect(JSON.stringify(cached)).toBe(JSON.stringify(direct));
  });
});

describe('clearPrewarmCache + stats', () => {
  it('reset total post-clear', () => {
    schedulePrewarm(['SKU-A', 'SKU-B'], 'h1', (sku) => ({ sku }));
    expect(getPrewarmStats().size).toBe(2);
    clearPrewarmCache();
    expect(getPrewarmStats().size).toBe(0);
    expect(getPrewarmStats().hits).toBe(0);
    expect(getPrewarmStats().misses).toBe(0);
    expect(getPrewarmStats().prewarms).toBe(0);
  });

  it('cache limpia aisla sesiones (logout simulate)', () => {
    getPrewarmedBreakdown('SKU-A', 'h1', () => ({ libre: 10 }));
    expect(getPrewarmStats().misses).toBe(1);
    clearPrewarmCache(); // logout
    getPrewarmedBreakdown('SKU-A', 'h1', () => ({ libre: 20 }));
    // Después del clear, el mismo SKU+depsHash se re-computa (no leak cross-user).
    expect(getPrewarmStats().misses).toBe(1);
    expect(getPrewarmStats().hits).toBe(0);
  });
});
