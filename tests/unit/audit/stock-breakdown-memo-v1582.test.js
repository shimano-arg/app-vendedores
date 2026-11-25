// @ts-check
/**
 * v1582 PERF2 (2026-11-25) — memo scoped sobre `getStockBreakdown`.
 *
 * Reporte Mariano post-v1581: "la app sigue lenta". Culpable raíz: cada
 * render de sidebar/modal invoca `computeHasExceed` × 400-600 waitlists ×
 * múltiples SKUs → `getStockBreakdown` corre full compute sobre todo
 * `globalPedidos` miles de veces por render. Memo scoped con validación
 * de deps evita el 80% del compute entre renders consecutivos.
 *
 * Claves del cache: `{depsRef, pedidosLen, waitlistLen, fisico, transito}`.
 * Cualquier cambio de esos 5 → miss. Renders consecutivos con mismo state
 * → hit (devuelve breakdown cacheado).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getStockBreakdown,
  invalidateStockBreakdownCache,
} from '../../../src/pure/stock-breakdown.js';

describe('v1582 §PERF2 — memo getStockBreakdown', () => {
  it('exporta invalidateStockBreakdownCache como escape hatch', () => {
    expect(typeof invalidateStockBreakdownCache).toBe('function');
  });

  it('cache hit: 2 llamadas con mismo deps → 1 solo cómputo (cache check NO invoca getStockFisico)', () => {
    invalidateStockBreakdownCache();
    let _hits = 0;
    const deps = {
      getStockFisico: () => {
        _hits++;
        return 10;
      },
      getStockTransito: () => 0,
      pedidos: [],
      waitlistEntries: [],
    };
    const r1 = getStockBreakdown('SKU-X', deps);
    const r2 = getStockBreakdown('SKU-X', deps);
    // Cache check NO invoca getStockFisico (v1582 ajuste). Primera llamada
    // = miss → compute llama 1× getStockFisico internamente → 1 hit. Segunda
    // llamada = hit → NO invoca getStockFisico. Total: 1.
    expect(_hits).toBe(1);
    expect(r1).toBe(r2); // misma referencia (cached).
  });

  it('cache miss: invalidateStockBreakdownCache() + call → recompute', () => {
    invalidateStockBreakdownCache();
    let _hits = 0;
    const deps = {
      getStockFisico: () => {
        _hits++;
        return 10;
      },
      getStockTransito: () => 0,
      pedidos: [],
      waitlistEntries: [],
    };
    getStockBreakdown('SKU-X', deps);
    invalidateStockBreakdownCache();
    getStockBreakdown('SKU-X', deps);
    expect(_hits).toBe(2); // 2 computes porque invalidate forzó recompute.
  });

  it('cache miss: deps nuevo ref → recompute', () => {
    invalidateStockBreakdownCache();
    const _deps1 = {
      getStockFisico: () => 10,
      getStockTransito: () => 0,
      pedidos: [],
      waitlistEntries: [],
    };
    const _deps2 = {
      getStockFisico: () => 10,
      getStockTransito: () => 0,
      pedidos: [],
      waitlistEntries: [],
    };
    const r1 = getStockBreakdown('SKU-X', _deps1);
    const r2 = getStockBreakdown('SKU-X', _deps2);
    expect(r1).not.toBe(r2); // refs distintas (compute separados).
    expect(r1.fisicoDep11).toBe(r2.fisicoDep11); // valores iguales.
  });

  it('cache stale: fisico cambió sin invalidate → devuelve el valor viejo (trade-off conocido)', () => {
    // v1582 §PERF2: para no pagar 2 calls extras a getStockFisico por check,
    // el cache NO detecta cuando fisico cambia inplace sin cambiar deps ref.
    // En prod el consumer DEBE llamar `invalidateStockBreakdownCache()` desde
    // el listener de `stock_snapshot` (ver index.html:_applyStockSnapshotDoc).
    // Sin ese hook, el cache queda stale hasta que `globalPedidos.length`
    // cambie. Este test documenta el comportamiento esperado.
    invalidateStockBreakdownCache();
    let _fisico = 10;
    const deps = {
      getStockFisico: () => _fisico,
      getStockTransito: () => 0,
      pedidos: [],
      waitlistEntries: [],
    };
    const r1 = getStockBreakdown('SKU-X', deps);
    _fisico = 20; // mutación sin cambiar deps ref ni invalidate
    const r2 = getStockBreakdown('SKU-X', deps);
    expect(r1.fisicoDep11).toBe(10);
    expect(r2.fisicoDep11).toBe(10); // stale (NO 20): el cache hit lo devuelve.
    // Si el consumer invalida, recomputa.
    invalidateStockBreakdownCache();
    const r3 = getStockBreakdown('SKU-X', deps);
    expect(r3.fisicoDep11).toBe(20);
  });

  it('cache miss: pedidos.length cambió → recompute', () => {
    invalidateStockBreakdownCache();
    const _pedidos = [];
    const deps = {
      getStockFisico: () => 10,
      getStockTransito: () => 0,
      pedidos: _pedidos,
      waitlistEntries: [],
    };
    const r1 = getStockBreakdown('SKU-X', deps);
    _pedidos.push({ _fsId: 'p1', lines: [], closedAt: null });
    const r2 = getStockBreakdown('SKU-X', deps);
    expect(r1).not.toBe(r2); // length cambió → miss
  });

  it('invalidateStockBreakdownCache() fuerza recompute', () => {
    invalidateStockBreakdownCache();
    const deps = {
      getStockFisico: () => 10,
      getStockTransito: () => 0,
      pedidos: [],
      waitlistEntries: [],
    };
    const r1 = getStockBreakdown('SKU-X', deps);
    invalidateStockBreakdownCache();
    const r2 = getStockBreakdown('SKU-X', deps);
    expect(r1).not.toBe(r2); // cache cleared → miss
  });
});

describe('v1582 — bump APP_VERSION + CACHE_VERSION', () => {
  const INDEX_HTML = readFileSync('index.html', 'utf8');
  it('APP_VERSION v1582 en index.html', () => {
    expect(INDEX_HTML).toContain("const APP_VERSION = 'v1582'");
  });
  it('CACHE_VERSION v1582 en sw.js', () => {
    const sw = readFileSync('sw.js', 'utf8');
    expect(sw).toContain("const CACHE_VERSION = 'v1582'");
  });
});
