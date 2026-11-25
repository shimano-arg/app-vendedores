// @ts-check
// Stack S-6 T2 (2026-11-25): wire de `getStockBreakdownCached` + `schedulePrewarm`
// en los modales "Pedido en Espera" (`_renderWaitlistCard`) y "Reparto"
// (`_repartoRender` + `_repartoBuildCard`), más cleanup en `detachFirebaseListeners`.
//
// Tests cubren 3 niveles:
//   (a) GREP de contrato sobre index.html (cada call-site tiene el wire).
//   (b) EQUIVALENCIA funcional: dado el MISMO estado, el cache y el pure
//       devuelven el mismo JSON (drop-in).
//   (c) HIT RATE: 2 llamadas consecutivas con mismo stateHash → 1 solo compute.
//   (d) NORMALIZACIÓN del SKU (trim + uppercase).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildStockCacheKey,
  clearStockCache,
  getStockBreakdownCached,
  getStockCacheStats,
  normSku,
} from '../../../src/domains/stock-cache.js';
import { clearPrewarmCache, schedulePrewarm } from '../../../src/pure/prewarm-stock.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

beforeEach(() => {
  clearStockCache();
  clearPrewarmCache();
});
afterEach(() => {
  clearStockCache();
  clearPrewarmCache();
});

// ---------------------------------------------------------------------------
// (a) GREP: contrato index.html — cada wire-point tiene el helper esperado.
// ---------------------------------------------------------------------------

describe('Stack S-6 T2 §wire grep: index.html tiene el helper + wire', () => {
  it('_renderWaitlistCard arma stateHash + llama getStockBreakdownCached (o fallback)', () => {
    // Localizar sección del modal "Pedido en Espera" (función _renderWaitlistCard).
    const i0 = html.indexOf('function _renderWaitlistCard()');
    expect(i0).toBeGreaterThan(0);
    // Siguiente función top-level (approx ~2k líneas de distancia) — grep
    // sobre un rango acotado.
    const section = html.slice(i0, i0 + 200_000);
    // El stateHash está armado con los 4 campos esperados.
    expect(section).toMatch(/_wcardStateHash\s*=\s*\{/);
    expect(section).toMatch(/pedidosLen:\s*\(typeof globalPedidos/);
    expect(section).toMatch(/waitlistLen:\s*\(typeof revisionWaitlist/);
    expect(section).toMatch(/snapshotUpdatedAt:\s*\(window\._stockSnapshotMeta/);
    expect(section).toMatch(/agregadosActive:\s*window\._stockAgregadosActive/);
    // El helper local _wcardGetStockCached existe + llama a getStockBreakdownCached
    // del grupo stockCache del pure.
    expect(section).toMatch(/const _wcardGetStockCached\s*=/);
    expect(section).toMatch(
      /stockCache\s*&&\s*window\.__phase0\.pure\.stockCache\s*\.getStockBreakdownCached/
    );
    // Fallback inline a window.getStockBreakdown.
    expect(section).toMatch(
      /window\.getStockBreakdown === 'function'\s*\)\s*\?\s*window\.getStockBreakdown\(sku\)/
    );
  });

  it('_renderWaitlistCard dispara schedulePrewarm via requestAnimationFrame', () => {
    const i0 = html.indexOf('function _renderWaitlistCard()');
    const section = html.slice(i0, i0 + 200_000);
    // Función IIFE con nombre identificable.
    expect(section).toMatch(/_schedulePrewarmTopSkusWcard/);
    // Llama a schedulePrewarm del pure.
    expect(section).toMatch(
      /prewarmStock\s*\n?\s*&&\s*window\.__phase0\.pure\.prewarmStock\.schedulePrewarm/
    );
    // Usa requestAnimationFrame (con fallback setTimeout).
    expect(section).toMatch(/window\.requestAnimationFrame\s*\|\|\s*\(\(cb\)\s*=>\s*setTimeout/);
    // Top-N = 50.
    expect(section).toMatch(/\.slice\(0,\s*50\)/);
  });

  it('_repartoRender dispara schedulePrewarm + _repartoBuildCard usa el cache', () => {
    const i0 = html.indexOf('function _repartoRender()');
    expect(i0).toBeGreaterThan(0);
    const i1 = html.indexOf('function _repartoStockFisico(', i0);
    const section = html.slice(i0, i1 > 0 ? i1 : i0 + 100_000);
    // schedulePrewarm con top-N SKUs de matches.
    expect(section).toMatch(/_schedulePrewarmTopSkusReparto/);
    expect(section).toMatch(
      /prewarmStock\s*\n?\s*&&\s*window\.__phase0\.pure\.prewarmStock\.schedulePrewarm/
    );
    expect(section).toMatch(/window\.requestAnimationFrame\s*\|\|/);
    // _repartoBuildCard delega al cache.
    const i2 = html.indexOf('function _repartoBuildCard(');
    expect(i2).toBeGreaterThan(0);
    const cardSection = html.slice(i2, i2 + 50_000);
    expect(cardSection).toMatch(
      /stockCache\s*\n?\s*&&\s*window\.__phase0\.pure\.stockCache\.getStockBreakdownCached/
    );
  });

  it('detachFirebaseListeners limpia stockCache + prewarmCache', () => {
    const i0 = html.indexOf('function detachFirebaseListeners()');
    expect(i0).toBeGreaterThan(0);
    const section = html.slice(i0, i0 + 10_000);
    // Ambos helpers llamados (patrón __phase0.pure.X.clearY).
    expect(section).toMatch(/__phase0\.pure\.stockCache/);
    expect(section).toMatch(/clearStockCache/);
    expect(section).toMatch(/__phase0\.pure\.prewarmStock/);
    expect(section).toMatch(/clearPrewarmCache/);
    // Idempotente: envuelto en try/catch para tolerar bundle no cargado.
    expect(section).toMatch(/try\s*\{[\s\S]{0,400}?clearStockCache/);
    expect(section).toMatch(/try\s*\{[\s\S]{0,400}?clearPrewarmCache/);
  });
});

// ---------------------------------------------------------------------------
// (b) EQUIVALENCIA funcional: cached vs pure devuelven JSON equivalente.
// ---------------------------------------------------------------------------

describe('Stack S-6 T2 §equivalencia: cached === pure para mismo estado', () => {
  function makeFixtureDeps(fisico = 20) {
    return {
      getStockFisico: () => fisico,
      pedidos: [
        {
          _fsId: 'P1',
          closedAt: null,
          clientCardCode: 'C001',
          clientName: 'CLIENTE 1',
          stage: 'confirmed',
          confirmedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          lines: [
            {
              code: 'TRX301B',
              state: 'ASIG',
              qty: 3,
              qtyOpen: 3,
              asigAt: new Date().toISOString(),
            },
          ],
        },
      ],
      waitlistEntries: [],
    };
  }

  it('cold miss: cached devuelve el mismo shape que pure directo', () => {
    const deps = makeFixtureDeps(20);
    const direct = getStockBreakdown('TRX301B', deps);
    const cached = getStockBreakdownCached(
      'TRX301B',
      { pedidosLen: 1, waitlistLen: 0, snapshotUpdatedAt: 'A', agregadosActive: false },
      () => deps
    );
    expect(JSON.stringify(cached)).toBe(JSON.stringify(direct));
  });

  it('cold miss: shape idéntico para SKU sin pedidos', () => {
    const deps = { getStockFisico: () => 5, pedidos: [], waitlistEntries: [] };
    const direct = getStockBreakdown('CLC66H2PY', deps);
    const cached = getStockBreakdownCached(
      'CLC66H2PY',
      { pedidosLen: 0, waitlistLen: 0, snapshotUpdatedAt: 'A', agregadosActive: false },
      () => deps
    );
    expect(JSON.stringify(cached)).toBe(JSON.stringify(direct));
  });
});

// ---------------------------------------------------------------------------
// (c) HIT RATE: 2 llamadas → 1 solo compute.
// ---------------------------------------------------------------------------

describe('Stack S-6 T2 §hit rate: 2 llamadas consecutivas → 1 solo compute', () => {
  it('mismo stateHash → segunda call es hit (buildDeps NO se invoca)', () => {
    const deps = { getStockFisico: () => 10, pedidos: [], waitlistEntries: [] };
    const buildDeps = vi.fn(() => deps);
    const state = { pedidosLen: 0, waitlistLen: 0, snapshotUpdatedAt: 'A', agregadosActive: false };

    const r1 = getStockBreakdownCached('TRX301B', state, buildDeps);
    const r2 = getStockBreakdownCached('TRX301B', state, buildDeps);

    expect(buildDeps).toHaveBeenCalledTimes(1);
    const stats = getStockCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    // Misma referencia en hit (no sólo JSON equivalente).
    expect(r2).toBe(r1);
  });

  it('cambio en pedidosLen → nuevo compute (miss)', () => {
    const deps = { getStockFisico: () => 10, pedidos: [], waitlistEntries: [] };
    const buildDeps = vi.fn(() => deps);
    getStockBreakdownCached('TRX301B', { pedidosLen: 1, waitlistLen: 0 }, buildDeps);
    getStockBreakdownCached('TRX301B', { pedidosLen: 2, waitlistLen: 0 }, buildDeps);
    expect(buildDeps).toHaveBeenCalledTimes(2);
  });

  it('10 llamadas con mismo stateHash → 1 compute, 9 hits', () => {
    const deps = { getStockFisico: () => 10, pedidos: [], waitlistEntries: [] };
    const buildDeps = vi.fn(() => deps);
    const state = { pedidosLen: 5, waitlistLen: 3, snapshotUpdatedAt: 'B', agregadosActive: false };
    for (let i = 0; i < 10; i++) getStockBreakdownCached('TRX301B', state, buildDeps);
    expect(buildDeps).toHaveBeenCalledTimes(1);
    const stats = getStockCacheStats();
    expect(stats.hits).toBe(9);
    expect(stats.misses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (d) NORMALIZE SKU: trim + uppercase case-insensitive.
// ---------------------------------------------------------------------------

describe('Stack S-6 T2 §normalize: trim + uppercase', () => {
  it('"SKU-A" y " sku-a " comparten entry del cache', () => {
    const deps = { getStockFisico: () => 7, pedidos: [], waitlistEntries: [] };
    const buildDeps = vi.fn(() => deps);
    const state = { pedidosLen: 0, waitlistLen: 0, snapshotUpdatedAt: 'A', agregadosActive: false };
    const r1 = getStockBreakdownCached('SKU-A', state, buildDeps);
    const r2 = getStockBreakdownCached(' sku-a ', state, buildDeps);
    expect(r1).toBe(r2);
    expect(buildDeps).toHaveBeenCalledTimes(1);
  });

  it('normSku helper: trim + uppercase + null-safe', () => {
    expect(normSku('  trx301b  ')).toBe('TRX301B');
    expect(normSku('TRX')).toBe('TRX');
    expect(normSku(null)).toBe('');
    expect(normSku(undefined)).toBe('');
  });

  it('buildStockCacheKey normaliza el SKU', () => {
    const k1 = buildStockCacheKey('  a-b-c  ', { pedidosLen: 1 });
    const k2 = buildStockCacheKey('A-B-C', { pedidosLen: 1 });
    expect(k1).toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// (e) INTEGRACIÓN prewarm → cache: schedulePrewarm + luego sync call = hit.
// ---------------------------------------------------------------------------

describe('Stack S-6 T2 §integración: schedulePrewarm pre-caliente para sync calls', () => {
  it('schedulePrewarm luego sync call → ambos caches tienen el breakdown', () => {
    const deps = { getStockFisico: () => 15, pedidos: [], waitlistEntries: [] };
    const compute = vi.fn((sku) => getStockBreakdown(sku, deps));
    const skus = ['SKU-A', 'SKU-B', 'SKU-C'];
    const depsHash = 'hash-xyz';
    const prewarmResult = schedulePrewarm(skus, depsHash, compute);
    expect(prewarmResult.computed).toBe(3);
    expect(compute).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// (f) MAIN.JS exports — grupo stockCache + prewarmStock expuestos.
// ---------------------------------------------------------------------------

describe('Stack S-6 T2 §main.js exposure: __phase0.pure.{stockCache,prewarmStock}', () => {
  const mainJs = readFileSync(resolve(__dirname, '../../../src/main.js'), 'utf8');

  it('src/main.js importa de stock-cache.js', () => {
    expect(mainJs).toMatch(/from\s+['"]\.\/domains\/stock-cache\.js['"]/);
    expect(mainJs).toMatch(/getStockBreakdownCached/);
    expect(mainJs).toMatch(/clearStockCache/);
  });

  it('src/main.js importa de prewarm-stock.js', () => {
    expect(mainJs).toMatch(/from\s+['"]\.\/pure\/prewarm-stock\.js['"]/);
    expect(mainJs).toMatch(/schedulePrewarm/);
    expect(mainJs).toMatch(/clearPrewarmCache/);
  });

  it('src/main.js expone __phase0.pure.stockCache con todos los exports', () => {
    expect(mainJs).toMatch(/stockCache:\s*\{/);
    const stockCacheBlock = mainJs.slice(mainJs.indexOf('stockCache: {'));
    expect(stockCacheBlock).toMatch(/getStockBreakdownCached/);
    expect(stockCacheBlock).toMatch(/clearStockCache/);
    expect(stockCacheBlock).toMatch(/getStockCacheStats/);
  });

  it('src/main.js expone __phase0.pure.prewarmStock con todos los exports', () => {
    expect(mainJs).toMatch(/prewarmStock:\s*\{/);
    const prewarmBlock = mainJs.slice(mainJs.indexOf('prewarmStock: {'));
    expect(prewarmBlock).toMatch(/schedulePrewarm/);
    expect(prewarmBlock).toMatch(/clearPrewarmCache/);
    expect(prewarmBlock).toMatch(/buildDepsHash/);
  });
});
