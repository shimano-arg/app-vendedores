// @ts-nocheck
/**
 * Stack S-4 T3 — Cache estable por contenido para `getStockBreakdown`.
 *
 * PROBLEMA: `window.getStockBreakdown` (`index.html`) construye un nuevo
 * objeto `deps` literal en cada llamada. El memo v1582 de
 * `src/pure/stock-breakdown.js` compara `depsRef === deps` (identidad) →
 * siempre miss → hit rate ≈ 0% al renderear modales que invocan
 * `getStockBreakdown` N veces (Pedido en Espera itera por línea, Reparto
 * por SKU).
 *
 * SOLUCIÓN: wrapper externo con cache keyed por el ESTADO de los globales
 * (clave de contenido). Mismo estado → misma clave → hit. Distinto estado
 * → miss → compute via pure + guardar.
 *
 * Alcance acotado del PR: expone capacidad + tests. NO toca el wrapper
 * `window.getStockBreakdown` del index.html — un PR siguiente puede wire
 * cuando Mariano decida. Esto preserva zero blast radius.
 *
 * Equivalencia garantizada: `getStockBreakdownCached(sku, buildDeps)` llama
 * al mismo pure `getStockBreakdown` con deps equivalentes al cold miss;
 * los hits devuelven la misma referencia (JSON.stringify match).
 *
 * TTL: 30s. Alineado con cadencia de `app_config/stock_snapshot` sync
 * (CLAUDE.md §60/§65).
 */

import { getStockBreakdown } from '../pure/stock-breakdown.js';

/**
 * @typedef {{ result: unknown, ts: number }} CacheEntry
 */

/** @type {Map<string, CacheEntry>} */
const _cache = new Map();
const _stats = { hits: 0, misses: 0, size: 0 };

export const STOCK_CACHE_TTL_MS = 30_000;

/**
 * Normaliza SKU: trim + uppercase. Alineado con CLAUDE.md §46.
 *
 * @param {string} sku
 * @returns {string}
 */
export function normSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

/**
 * Construye la clave de contenido desde el estado observable. El caller
 * (wrapper domain o window) pasa estos valores — deben ser scalars o
 * strings para que la clave sea estable.
 *
 * @param {string} sku
 * @param {{
 *   pedidosLen?: number,
 *   waitlistLen?: number,
 *   snapshotUpdatedAt?: string | number,
 *   agregadosActive?: boolean,
 * }} stateHash
 * @returns {string}
 */
export function buildStockCacheKey(sku, stateHash) {
  const s = stateHash || {};
  return (
    normSku(sku) +
    '|' +
    (Number(s.pedidosLen) || 0) +
    '|' +
    (Number(s.waitlistLen) || 0) +
    '|' +
    String(s.snapshotUpdatedAt || '') +
    '|' +
    (s.agregadosActive === true ? '1' : '0')
  );
}

/**
 * Lee del cache si hay hit; si miss, invoca `buildDeps()` + pure
 * `getStockBreakdown` + guarda. `buildDeps` es un thunk para lazy-evaluate
 * el `deps` object literal (no se construye si hay hit).
 *
 * @param {string} sku
 * @param {{
 *   pedidosLen?: number,
 *   waitlistLen?: number,
 *   snapshotUpdatedAt?: string | number,
 *   agregadosActive?: boolean,
 * }} stateHash
 * @param {() => object} buildDeps
 * @param {{ now?: number, ttlMs?: number }} [opts]
 * @returns {unknown}
 */
export function getStockBreakdownCached(sku, stateHash, buildDeps, opts) {
  const skuNorm = normSku(sku);
  if (!skuNorm) {
    // Sin SKU válido, no cacheamos — delegamos al pure (devolverá breakdown
    // vacío). Esto preserva el shape esperado por el caller.
    try {
      return getStockBreakdown(skuNorm, (buildDeps && buildDeps()) || {});
    } catch (_e) {
      return null;
    }
  }
  const now = (opts && typeof opts.now === 'number') ? opts.now : Date.now();
  const ttlMs = (opts && typeof opts.ttlMs === 'number') ? opts.ttlMs : STOCK_CACHE_TTL_MS;
  const key = buildStockCacheKey(skuNorm, stateHash);
  const entry = _cache.get(key);
  if (entry && (now - entry.ts) <= ttlMs) {
    _stats.hits++;
    return entry.result;
  }
  _stats.misses++;
  const deps = (buildDeps && buildDeps()) || {};
  const result = getStockBreakdown(skuNorm, deps);
  _cache.set(key, { result, ts: now });
  _stats.size = _cache.size;
  return result;
}

/**
 * Limpia el cache. Para llamar en logout (preserva aislamiento cross-user)
 * y en tests.
 */
export function clearStockCache() {
  _cache.clear();
  _stats.hits = 0;
  _stats.misses = 0;
  _stats.size = 0;
}

/**
 * Stats para instrumentación (consumible por PR #1439
 * `trackCacheEvent('stock_breakdown', hit)`).
 *
 * @returns {{ hits: number, misses: number, size: number }}
 */
export function getStockCacheStats() {
  return { hits: _stats.hits, misses: _stats.misses, size: _cache.size };
}
