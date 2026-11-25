// @ts-check
/**
 * Stack S-4 T2 — Async pre-warming del stock breakdown.
 *
 * Capacidad agregada SIN cambiar comportamiento actual: expone funciones
 * puras que un consumer (modal Pedido en Espera / Reparto) puede invocar
 * para pre-cargar `getStockBreakdown` de un conjunto de SKUs en background.
 *
 * NO toca el flow de commit server-side. El objetivo es:
 *   (a) Reducir la frecuencia de STOCK_CHANGED porque el breakdown que
 *       el modal muestra está más fresco al momento de confirmar.
 *   (b) Mejorar UX: cuando el user hace clic en Confirmar, el breakdown
 *       ya está computado y la re-render es instantánea.
 *
 * Equivalencia: `getPrewarmedBreakdown(sku, compute)` devuelve lo mismo
 * que `compute(sku)` (misma ref si cache hit; equivalente JSON si miss).
 * Tests unit confirman equivalencia JSON sobre fixtures.
 *
 * Alcance acotado del PR: solo helpers + tests. El wire a los 2 modales
 * queda para un PR siguiente (separa responsabilidad y reduce blast
 * radius).
 */

/**
 * @typedef {{
 *   result: unknown,
 *   ts: number,
 *   hashKey: string,
 * }} CacheEntry
 */

const DEFAULT_TTL_MS = 30_000; // 30 s, alineado con cadencia sync stock (§60/§65).

/** @type {Map<string, CacheEntry>} */
const _cache = new Map();

/** @type {{ hits: number, misses: number, prewarms: number }} */
const _stats = { hits: 0, misses: 0, prewarms: 0 };

/**
 * Normaliza SKU: trim + uppercase. Alineado con CLAUDE.md §46.
 *
 * @param {string} sku
 * @returns {string}
 */
export function normSku(sku) {
  return String(sku || '')
    .trim()
    .toUpperCase();
}

/**
 * Builds a stable cache key per (sku, depsHash). `depsHash` lo
 * provee el caller (ej. hash corto de `stock_snapshot.updatedAt` +
 * `pedidos.length`). Separado del compute() para que caller controle
 * cuando el cache debe invalidarse.
 *
 * @param {string} sku
 * @param {string} depsHash
 * @returns {string}
 */
export function cacheKeyFor(sku, depsHash) {
  return normSku(sku) + '|' + String(depsHash || '');
}

/**
 * Devuelve breakdown cacheado o computa + cachea. Nunca throw.
 * Si compute() tira, propaga el error (caller decide).
 *
 * @template T
 * @param {string} sku
 * @param {string} depsHash
 * @param {() => T} compute
 * @param {{ nowMs?: number, ttlMs?: number }} [opts]
 * @returns {T}
 */
export function getPrewarmedBreakdown(sku, depsHash, compute, opts) {
  const nowMs = opts && typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const ttlMs = opts && typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_TTL_MS;
  const key = cacheKeyFor(sku, depsHash);
  const entry = _cache.get(key);
  if (entry && nowMs - entry.ts <= ttlMs) {
    _stats.hits++;
    return /** @type {T} */ (entry.result);
  }
  _stats.misses++;
  const result = compute();
  _cache.set(key, { result, ts: nowMs, hashKey: key });
  return result;
}

/**
 * Pre-carga breakdown para un lote de SKUs en background. Llama compute()
 * UNA vez por SKU único (dedup) y store en cache. Idempotente: múltiples
 * llamadas con el mismo depsHash dentro del TTL son no-op.
 *
 * Devuelve stats de la corrida (cuántos computados vs cache hit).
 *
 * @template T
 * @param {Array<string>} skus
 * @param {string} depsHash
 * @param {(sku: string) => T} compute
 * @param {{ nowMs?: number, ttlMs?: number }} [opts]
 * @returns {{ computed: number, cached: number, total: number }}
 */
export function schedulePrewarm(skus, depsHash, compute, opts) {
  const nowMs = opts && typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const ttlMs = opts && typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_TTL_MS;
  const uniqueSkus = Array.from(new Set((skus || []).map(normSku).filter(Boolean)));
  let computed = 0;
  let cached = 0;
  for (const sku of uniqueSkus) {
    const key = cacheKeyFor(sku, depsHash);
    const entry = _cache.get(key);
    if (entry && nowMs - entry.ts <= ttlMs) {
      cached++;
      continue;
    }
    try {
      const result = compute(sku);
      _cache.set(key, { result, ts: nowMs, hashKey: key });
      computed++;
    } catch (_e) {
      // Fire-and-forget: si compute() tira para un SKU, lo saltamos.
      // El modal lo computará on-demand si el user llega a ver ese SKU.
    }
  }
  _stats.prewarms++;
  return { computed, cached, total: uniqueSkus.length };
}

/**
 * Limpia todo el cache + stats. Para llamar en logout (preserva
 * aislamiento entre users) y en tests.
 */
export function clearPrewarmCache() {
  _cache.clear();
  _stats.hits = 0;
  _stats.misses = 0;
  _stats.prewarms = 0;
}

/**
 * Devuelve stats actual (para instrumentación con PR #1439
 * `trackCacheEvent('stock_breakdown', hit)`).
 *
 * @returns {{ hits: number, misses: number, prewarms: number, size: number }}
 */
export function getPrewarmStats() {
  return {
    hits: _stats.hits,
    misses: _stats.misses,
    prewarms: _stats.prewarms,
    size: _cache.size,
  };
}

/**
 * Builds depsHash estable desde snapshot + pedidos.length. El caller
 * (domain wrapper) lo invoca con sus refs runtime.
 *
 * Shape conservador: el hash cambia cuando (a) snapshot.updatedAt
 * cambia, (b) la cantidad de pedidos abiertos cambia. No incluye otros
 * cambios (ej. edit de línea de un pedido existente) — esos cambios
 * disparan STOCK_CHANGED del server, que es el fail-safe.
 *
 * @param {{ updatedAtMs?: number }} snapshot
 * @param {number} openPedidosCount
 * @returns {string}
 */
export function buildDepsHash(snapshot, openPedidosCount) {
  const updatedAtMs =
    snapshot && typeof snapshot.updatedAtMs === 'number' ? snapshot.updatedAtMs : 0;
  const count = Math.max(0, Number(openPedidosCount) || 0);
  return String(updatedAtMs) + ':' + String(count);
}
