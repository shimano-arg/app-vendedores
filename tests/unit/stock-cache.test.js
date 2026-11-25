// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStockCacheKey,
  clearStockCache,
  getStockBreakdownCached,
  getStockCacheStats,
  normSku,
  STOCK_CACHE_TTL_MS,
} from '../../src/domains/stock-cache.js';

// Minimal deps builder for tests: provides a fixed snapshot of pedidos/wl.
function makeDeps(fisico = 10) {
  return {
    getStockFisico: () => fisico,
    pedidos: [],
    waitlistEntries: [],
  };
}

beforeEach(() => {
  clearStockCache();
});
afterEach(() => {
  clearStockCache();
});

describe('normSku', () => {
  it('trim + uppercase', () => {
    expect(normSku(' trx301b ')).toBe('TRX301B');
    expect(normSku(null)).toBe('');
    expect(normSku(undefined)).toBe('');
  });
});

describe('buildStockCacheKey', () => {
  it('mismo estado → misma clave', () => {
    const k1 = buildStockCacheKey('trx301b', {
      pedidosLen: 5,
      waitlistLen: 2,
      snapshotUpdatedAt: 'A',
      agregadosActive: false,
    });
    const k2 = buildStockCacheKey('TRX301B', {
      pedidosLen: 5,
      waitlistLen: 2,
      snapshotUpdatedAt: 'A',
      agregadosActive: false,
    });
    expect(k1).toBe(k2);
  });
  it('cambio en snapshot.updatedAt → clave distinta', () => {
    const k1 = buildStockCacheKey('A', { snapshotUpdatedAt: '2026-11-25T10:00:00Z' });
    const k2 = buildStockCacheKey('A', { snapshotUpdatedAt: '2026-11-25T10:05:00Z' });
    expect(k1).not.toBe(k2);
  });
  it('cambio en pedidosLen → clave distinta', () => {
    const k1 = buildStockCacheKey('A', { pedidosLen: 5 });
    const k2 = buildStockCacheKey('A', { pedidosLen: 6 });
    expect(k1).not.toBe(k2);
  });
  it('cambio en waitlistLen → clave distinta', () => {
    const k1 = buildStockCacheKey('A', { waitlistLen: 1 });
    const k2 = buildStockCacheKey('A', { waitlistLen: 2 });
    expect(k1).not.toBe(k2);
  });
  it('cambio en agregadosActive → clave distinta', () => {
    const k1 = buildStockCacheKey('A', { agregadosActive: false });
    const k2 = buildStockCacheKey('A', { agregadosActive: true });
    expect(k1).not.toBe(k2);
  });
  it('tolera inputs vacíos', () => {
    expect(buildStockCacheKey('', {})).toBe('|0|0||0');
  });
});

describe('getStockBreakdownCached — T1 cold miss', () => {
  it('invoca buildDeps + devuelve breakdown + guarda en cache', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    const r = getStockBreakdownCached('TRX301B', { pedidosLen: 0, waitlistLen: 0 }, buildDepsSpy);
    expect(buildDepsSpy).toHaveBeenCalledTimes(1);
    expect(r).toBeDefined();
    expect(typeof r.fisicoDep11).toBe('number');
    expect(r.sku).toBe('TRX301B');
    expect(getStockCacheStats().size).toBe(1);
    expect(getStockCacheStats().misses).toBe(1);
  });
});

describe('getStockBreakdownCached — T2 warm hit', () => {
  it('segunda llamada con mismo estado NO re-construye deps NI re-computa', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    const state = { pedidosLen: 0, waitlistLen: 0, snapshotUpdatedAt: 'A' };
    const r1 = getStockBreakdownCached('TRX301B', state, buildDepsSpy);
    const r2 = getStockBreakdownCached('TRX301B', state, buildDepsSpy);
    expect(buildDepsSpy).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2); // misma referencia
    expect(getStockCacheStats().hits).toBe(1);
    expect(getStockCacheStats().misses).toBe(1);
  });
});

describe('getStockBreakdownCached — T3 TTL expiry', () => {
  it('después del TTL re-computa', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    const state = { pedidosLen: 0 };
    const r1 = getStockBreakdownCached('TRX301B', state, buildDepsSpy, { now: 1000 });
    const r2 = getStockBreakdownCached('TRX301B', state, buildDepsSpy, {
      now: 1000 + STOCK_CACHE_TTL_MS + 1,
    });
    expect(buildDepsSpy).toHaveBeenCalledTimes(2);
    expect(r1).not.toBe(r2);
  });
});

describe('getStockBreakdownCached — T4 snapshot.updatedAt change', () => {
  it('cambio de snapshot → miss', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    const r1 = getStockBreakdownCached('A', { snapshotUpdatedAt: 't1' }, buildDepsSpy);
    const r2 = getStockBreakdownCached('A', { snapshotUpdatedAt: 't2' }, buildDepsSpy);
    expect(buildDepsSpy).toHaveBeenCalledTimes(2);
    expect(r1).not.toBe(r2);
  });
});

describe('getStockBreakdownCached — T5 pedidos.length change', () => {
  it('pedidosLen distinto → miss', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    const r1 = getStockBreakdownCached('A', { pedidosLen: 5 }, buildDepsSpy);
    const r2 = getStockBreakdownCached('A', { pedidosLen: 6 }, buildDepsSpy);
    expect(buildDepsSpy).toHaveBeenCalledTimes(2);
    expect(r1).not.toBe(r2);
  });
});

describe('getStockBreakdownCached — T6 logout clear', () => {
  it('clearStockCache fuerza re-computa en siguiente call', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    const state = { pedidosLen: 0 };
    const r1 = getStockBreakdownCached('A', state, buildDepsSpy);
    clearStockCache();
    const r2 = getStockBreakdownCached('A', state, buildDepsSpy);
    expect(buildDepsSpy).toHaveBeenCalledTimes(2);
    expect(r1).not.toBe(r2);
    expect(getStockCacheStats().size).toBe(1);
    expect(getStockCacheStats().hits).toBe(0); // reset por clear + 1 miss nuevo
    expect(getStockCacheStats().misses).toBe(1);
  });

  it('clearStockCache limpia entradas de todos los SKUs', () => {
    getStockBreakdownCached('A', {}, () => makeDeps());
    getStockBreakdownCached('B', {}, () => makeDeps());
    getStockBreakdownCached('C', {}, () => makeDeps());
    expect(getStockCacheStats().size).toBe(3);
    clearStockCache();
    expect(getStockCacheStats().size).toBe(0);
  });
});

describe('getStockBreakdownCached — T7 equivalencia', () => {
  it('hit vs miss → JSON.stringify equivalente', () => {
    const buildDeps = () => makeDeps(10);
    const r1 = getStockBreakdownCached('A', {}, buildDeps);
    const r2 = getStockBreakdownCached('A', {}, buildDeps);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('SKU normalizado case-insensitive → hit', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    getStockBreakdownCached('trx301b', {}, buildDepsSpy);
    getStockBreakdownCached('TRX301B', {}, buildDepsSpy);
    getStockBreakdownCached('  TRX301B  ', {}, buildDepsSpy);
    expect(buildDepsSpy).toHaveBeenCalledTimes(1);
  });
});

describe('getStockBreakdownCached — T8 concurrencia', () => {
  it('N calls en el mismo tick con mismo estado → 1 solo compute', () => {
    const buildDepsSpy = vi.fn(() => makeDeps(10));
    const state = { pedidosLen: 0 };
    const results = [
      getStockBreakdownCached('A', state, buildDepsSpy),
      getStockBreakdownCached('A', state, buildDepsSpy),
      getStockBreakdownCached('A', state, buildDepsSpy),
      getStockBreakdownCached('A', state, buildDepsSpy),
    ];
    expect(buildDepsSpy).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === results[0])).toBe(true);
    expect(getStockCacheStats().size).toBe(1);
  });
});

describe('getStockBreakdownCached — edge cases', () => {
  it('SKU vacío NO guarda en cache (sin leak de key vacía)', () => {
    getStockBreakdownCached('', {}, () => makeDeps());
    getStockBreakdownCached(null, {}, () => makeDeps());
    getStockBreakdownCached(undefined, {}, () => makeDeps());
    expect(getStockCacheStats().size).toBe(0);
  });

  it('compute que tira → propaga error, NO guarda', () => {
    const buildDeps = () => {
      throw new Error('boom');
    };
    // buildDeps() se invoca en el miss path; el throw se propaga.
    // Pero `getStockBreakdown` del pure se llama con deps construido;
    // el throw de buildDeps rompe esa llamada.
    expect(() => getStockBreakdownCached('A', {}, buildDeps)).toThrow('boom');
    expect(getStockCacheStats().size).toBe(0);
  });
});

describe('getStockBreakdownCached — sobre-asignación fixture', () => {
  it('breakdown con ASIG>fisico cacheado === direct (equivalencia JSON)', () => {
    // Pedido con 1 línea ASIG qty=6, físico=2 → sobre-asignación clásica §40.2.
    const pedidos = [
      {
        _fsId: 'p1',
        clientCardCode: 'C001',
        clientName: 'CLIENTE X',
        closedAt: null,
        createdAt: new Date().toISOString(),
        stage: 'confirmed',
        confirmedAt: new Date().toISOString(),
        lines: [
          { code: 'OVER-SKU', state: 'ASIG', qty: 6, qtyOpen: 6, asigAt: new Date().toISOString() },
        ],
      },
    ];
    const buildDeps = () => ({
      getStockFisico: (sku) => (sku === 'OVER-SKU' ? 2 : 0),
      pedidos,
      waitlistEntries: [],
    });
    // Cold miss
    const r1 = getStockBreakdownCached('OVER-SKU', { pedidosLen: 1 }, buildDeps);
    // Warm hit — mismo resultado
    const r2 = getStockBreakdownCached('OVER-SKU', { pedidosLen: 1 }, buildDeps);
    expect(r1).toBe(r2);
    // Verificar cap por físico (§40.2): reservadasTotal ≤ fisicoDep11
    expect(r1.fisicoDep11).toBe(2);
    expect(r1.reservadasTotal).toBeLessThanOrEqual(2);
  });
});
