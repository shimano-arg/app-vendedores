// @ts-check
/**
 * §63 Fase 3 Capa 2 (v1445) — tests para fetch-stock-live-core.
 */
import { describe, expect, it, vi } from 'vitest';
import { _INTERNAL, fetchStockLiveCore } from '../../functions/core/fetch-stock-live-core.js';

const SAP_CFG = {
  url: 'https://sap.test',
  companyDB: 'TEST',
  userName: 'U',
  password: 'P',
};

function makeDeps(fetchFn, overrides = {}) {
  return {
    sapConfig: { ...SAP_CFG, fetch: fetchFn },
    fbDb: {},
    acquireSlCookie: overrides.acquireSlCookie || (async () => 'COOKIE_X'),
    releaseSlCookie: overrides.releaseSlCookie || (() => {}),
    log: () => {},
    now: () => 1_700_000_000_000,
  };
}

describe('§63 Capa 2 — fetch-stock-live-core', () => {
  it('T1 — happy path 3 SKUs, 1 batch', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          value: [
            {
              ItemCode: 'A',
              ItemWarehouseInfoCollection: [
                { WarehouseCode: '11', InStock: 10, Committed: 2 },
                { WarehouseCode: '12', InStock: 5, Committed: 0 },
              ],
            },
            {
              ItemCode: 'B',
              ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 3, Committed: 0 }],
            },
            {
              ItemCode: 'C',
              ItemWarehouseInfoCollection: [
                { WarehouseCode: '12', InStock: 7, Committed: 0 }, // no whs 11
              ],
            },
          ],
        };
      },
    }));
    const r = await fetchStockLiveCore(makeDeps(fetchFn), { skus: ['A', 'B', 'C'] });
    expect(r.ok).toBe(true);
    expect(r.snapshotFallback).toBe(false);
    expect(r.partial).toBe(false);
    expect(r.fisicoDep11.A).toBe(8); // InStock 10 - Committed 2
    expect(r.fisicoDep11.B).toBe(3);
    expect(r.fisicoDep11.C).toBe(0); // no whs 11 → 0
    expect(r.slRequests).toBe(1);
  });

  it('T2 — 120 SKUs, 3 batches de 50 en paralelo', async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async (url) => {
      callCount++;
      // Devolver todos los SKUs del filter con InStock=1 Committed=0.
      const skuMatches = String(url).match(/ItemCode%20eq%20'([^']+)'/g) || [];
      const skus = skuMatches.map((m) => m.replace(/.*'([^']+)'/, '$1'));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            value: skus.map((s) => ({
              ItemCode: s,
              ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 1, Committed: 0 }],
            })),
          };
        },
      };
    });
    const skus = Array.from({ length: 120 }, (_, i) => `SKU${i}`);
    const r = await fetchStockLiveCore(makeDeps(fetchFn), { skus });
    expect(r.ok).toBe(true);
    expect(r.slRequests).toBe(3); // ceil(120/50) = 3 batches
    expect(Object.keys(r.fisicoDep11).length).toBe(120);
    expect(r.fisicoDep11.SKU0).toBe(1);
    expect(r.fisicoDep11.SKU119).toBe(1);
  });

  it('T3 — SL devuelve 400 → snapshotFallback=true, reason=sl_error', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      async json() {
        return { error: { code: 201, message: { value: 'filter too long' } } };
      },
    }));
    const r = await fetchStockLiveCore(makeDeps(fetchFn), { skus: ['A', 'B'] });
    expect(r.ok).toBe(true);
    expect(r.snapshotFallback).toBe(true);
    expect(r.reason).toBe('sl_error');
    expect(r.skusSnapshot).toEqual(['A', 'B']);
    expect(r.fisicoDep11).toEqual({});
  });

  it('T4 — timeout 3s → snapshotFallback=true, reason=timeout', async () => {
    const fetchFn = vi.fn(async (_url, opts) => {
      return new Promise((_resolve, reject) => {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });
    const r = await fetchStockLiveCore(
      makeDeps(fetchFn),
      { skus: ['A'], timeoutMs: 50 } // force fast timeout
    );
    expect(r.ok).toBe(true);
    expect(r.snapshotFallback).toBe(true);
    expect(r.reason).toBe('timeout');
  });

  it('T5 — > 200 SKUs + libreSnapshot + qtyPedida → modo líneas en riesgo', async () => {
    let batchCalls = 0;
    const fetchFn = vi.fn(async (url) => {
      batchCalls++;
      const skuMatches = String(url).match(/ItemCode%20eq%20'([^']+)'/g) || [];
      const skus = skuMatches.map((m) => m.replace(/.*'([^']+)'/, '$1'));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            value: skus.map((s) => ({
              ItemCode: s,
              ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 5, Committed: 0 }],
            })),
          };
        },
      };
    });
    // 250 SKUs. Solo los primeros 10 en riesgo (qty >= libre).
    const skus = Array.from({ length: 250 }, (_, i) => `SKU${i}`);
    const libreSnapshot = {};
    const qtyPedida = {};
    for (let i = 0; i < 250; i++) {
      libreSnapshot[`SKU${i}`] = 100;
      qtyPedida[`SKU${i}`] = i < 10 ? 100 : 1; // primeros 10 en riesgo
    }
    const r = await fetchStockLiveCore(makeDeps(fetchFn), { skus, libreSnapshot, qtyPedida });
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.reason).toBe('partial_lineas_en_riesgo');
    expect(r.skusLive.length).toBe(10);
    expect(r.skusSnapshot.length).toBe(240);
    expect(batchCalls).toBe(1); // 10 SKUs = 1 batch
  });

  it('T6 — SKU vacío/duplicados → dedup y validación', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          value: [
            {
              ItemCode: 'A',
              ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 5, Committed: 1 }],
            },
          ],
        };
      },
    }));
    const r = await fetchStockLiveCore(makeDeps(fetchFn), {
      skus: ['A', 'A', '', '  ', 'A'],
    });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.fisicoDep11)).toEqual(['A']);
    expect(r.fisicoDep11.A).toBe(4);
  });

  it('T7 — skus=[] → no-op', async () => {
    const fetchFn = vi.fn();
    const r = await fetchStockLiveCore(makeDeps(fetchFn), { skus: [] });
    expect(r.ok).toBe(true);
    expect(r.slRequests).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('T8 — acquireSlCookie falla → snapshotFallback con reason', async () => {
    const deps = makeDeps(vi.fn(), {
      acquireSlCookie: async () => {
        throw new Error('sl is disabled in config');
      },
    });
    const r = await fetchStockLiveCore(deps, { skus: ['A'] });
    expect(r.ok).toBe(true);
    expect(r.snapshotFallback).toBe(true);
    expect(r.reason).toBe('sl_disabled');
    expect(r.skusSnapshot).toEqual(['A']);
  });

  it('T9 — exports constantes _INTERNAL', () => {
    expect(_INTERNAL.BLOCK_SIZE).toBe(50);
    expect(_INTERNAL.TIMEOUT_MS).toBe(3000);
    expect(_INTERNAL.LINEAS_EN_RIESGO_THRESHOLD).toBe(200);
  });

  it('T10 — chunkSkus parte en bloques exactos de 50', () => {
    const skus = Array.from({ length: 125 }, (_, i) => `S${i}`);
    const chunks = _INTERNAL.chunkSkus(skus);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(50);
    expect(chunks[1].length).toBe(50);
    expect(chunks[2].length).toBe(25);
  });
});
