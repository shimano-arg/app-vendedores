// @ts-check
/**
 * §63 Fase 3 Capa 2 (v1445) — tests para commitPedidoCore con fetchStockLive
 * inyectado.
 *
 * Verifica que:
 *   T1 — Sin fetchStockLive dep → comportamiento histórico (snapshot).
 *   T2 — fetchStockLive ok=true + no fallback → overridea fisicoDep11.
 *        commitPedidoCore computa breakdown con el valor live.
 *   T3 — fetchStockLive snapshotFallback=true + snapshot fresco → usa snapshot.
 *   T4 — fetchStockLive snapshotFallback=true + snapshot vencido (>30 min) →
 *        throw SAP_UNAVAILABLE.
 *        v1454 §60 UPDATE: threshold bajado 8h -> 30 min.
 */
import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeMockDb(fixture) {
  const state = fixture || {};
  const makeDoc = (col, id) => ({
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
    },
    async update(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
    },
    async delete() {
      if (state[col]) delete state[col][id];
    },
  });
  const makeCol = (col, filters = []) => ({
    where(f, op, v) {
      return makeCol(col, [...filters, { f, op, v }]);
    },
    limit() {
      return this;
    },
    doc(id) {
      return makeDoc(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
    },
    add(d) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = d;
      return Promise.resolve({ id });
    },
    async get() {
      const colData = state[col] || {};
      let docs = Object.entries(colData).map(([id, data]) => ({
        id,
        data: () => data,
        exists: true,
      }));
      for (const f of filters) {
        docs = docs.filter((d) => {
          const v = d.data()[f.f];
          if (f.op === '==') return v === f.v;
          if (f.op === 'in') return Array.isArray(f.v) && f.v.includes(v);
          return true;
        });
      }
      return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
    },
  });
  return {
    fbDb: {
      collection: (c) => makeCol(c),
      doc(path) {
        const [c, id] = path.split('/');
        return makeDoc(c, id);
      },
      async runTransaction(fn) {
        const tx = {
          async get(ref) {
            return ref.get();
          },
          set(ref, data) {
            return ref.set(data);
          },
          update(ref, data) {
            return ref.update(data);
          },
          delete(ref) {
            return ref.delete();
          },
        };
        return fn(tx);
      },
    },
    _state: state,
  };
}

const nowRef = new Date('2026-10-23T20:00:00Z');

function baseStateWithStock(sku, fisicoSnapshot) {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: { [sku]: { 11: fisicoSnapshot } },
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('§63 Capa 2 — commitPedidoCore con fetchStockLive', () => {
  it('T1 — sin fetchStockLive dep: usa snapshot (comportamiento histórico)', async () => {
    const state = baseStateWithStock('SKU-A', 2);
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd1',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1445',
      }
    );
    // 5 pedidas con snapshot=2 → qtyBO=3 → STOCK_CHANGED.
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
  });

  it('T2 — fetchStockLive ok=true devuelve 10 → override snapshot 2 → confirma 5', async () => {
    const state = baseStateWithStock('SKU-A', 2);
    const { fbDb } = makeMockDb(state);
    const fetchStockLive = vi.fn(async (params) => {
      expect(params.skus).toContain('SKU-A');
      return {
        ok: true,
        snapshotFallback: false,
        partial: false,
        fisicoDep11: { 'SKU-A': 10 },
        skusLive: ['SKU-A'],
        skusSnapshot: [],
        reason: 'ok',
        durationMs: 100,
        slRequests: 1,
      };
    });
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'd2',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1445',
      }
    );
    if (!r.ok) console.log('T2 unexpected:', JSON.stringify(r, null, 2));
    expect(r.ok).toBe(true); // 5 pedidas, 10 fisico live → qtyConfirmed=5, qtyBO=0.
    expect(fetchStockLive).toHaveBeenCalledOnce();
  });

  it('T3 — fetchStockLive fallback + snapshot fresco → usa snapshot sin throw', async () => {
    const state = baseStateWithStock('SKU-A', 10);
    const { fbDb } = makeMockDb(state);
    const fetchStockLive = vi.fn(async () => ({
      ok: true,
      snapshotFallback: true,
      partial: false,
      fisicoDep11: {},
      skusLive: [],
      skusSnapshot: ['SKU-A'],
      reason: 'timeout',
      durationMs: 3000,
      slRequests: 1,
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'd3',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
        clientVersion: 'v1445',
      }
    );
    // Snapshot fresco (updatedAt hace 60s) → usa snapshot 10 → confirma 3.
    expect(r.ok).toBe(true);
  });

  it('T4 — fetchStockLive fallback + snapshot vencido (>30 min v1454) → SAP_UNAVAILABLE', async () => {
    const state = baseStateWithStock('SKU-A', 10);
    state.app_config.stock_snapshot.updatedAt = {
      // v1454 §60 UPDATE: threshold BAJADO 8h -> 30 min. 45 min dispara.
      toMillis: () => nowRef.getTime() - 45 * 60 * 1000, // 45 min atrás
    };
    const { fbDb } = makeMockDb(state);
    const fetchStockLive = vi.fn(async () => ({
      ok: true,
      snapshotFallback: true,
      partial: false,
      fisicoDep11: {},
      skusLive: [],
      skusSnapshot: ['SKU-A'],
      reason: 'sl_error',
      durationMs: 100,
      slRequests: 1,
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'd4',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
        clientVersion: 'v1445',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('SAP_UNAVAILABLE');
    expect(r.data.snapshotAgeMinutes).toBeGreaterThan(30);
    expect(r.data.liveReason).toBe('sl_error');
  });
});
