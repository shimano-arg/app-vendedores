// @ts-check
/**
 * §64.1 FIX (2026-10-23 v1447) — tests para computeDiffVsClient con
 * comparación valor-por-valor contra clientStock.
 *
 * Reporte Mariano 17:27 ART: pedido recién abierto, "nada cambió", igual
 * devolvía STOCK_CHANGED. Hipótesis: el sync re-escribe snapshot cada 5
 * min; cliente pide 7 con libre=6 (ya sabe que qtyBO=1); CF valida y
 * también calcula qtyBO=1 → dispara STOCK_CHANGED aunque los números
 * coinciden.
 *
 * Fix: STOCK_CHANGED dispara solo si `fisicoDep11` o `libre` del
 * clientStock difieren del server para los SKUs del pedido.
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

const nowRef = new Date('2026-10-23T20:27:00Z');

function makeState(sku, fisico) {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: { [sku]: { 11: fisico } },
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('§64.1 FIX — STOCK_CHANGED compara valor-por-valor', () => {
  it('T1 — cliente pidió 7 con libre=6 (ya sabe que qtyBO=1); CF ve lo mismo → NO dispara', async () => {
    const { fbDb } = makeMockDb(makeState('SKU-A', 6));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd1',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 7, precio: 100 }],
        clientVersion: 'v1447',
        clientStock: {
          'SKU-A': { fisicoDep11: 6, libre: 6, utilizablePara: 6 },
        },
      }
    );
    expect(r.ok).toBe(true);
    // Se crea el pedido con 6 confirmed + 1 BO, SIN disparar STOCK_CHANGED.
  });

  it('T2 — cliente vio fisico=6, CF ve fisico=4 (snapshot cambió entre reads) → sí dispara', async () => {
    const { fbDb } = makeMockDb(makeState('SKU-A', 4));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd2',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 7, precio: 100 }],
        clientVersion: 'v1447',
        clientStock: {
          'SKU-A': { fisicoDep11: 6, libre: 6 }, // cliente vio 6, CF ve 4
        },
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
  });

  it('T3 — cliente pidió 5 con libre=6; CF ve libre=6; qtyBO=0 → ok (sin cambio)', async () => {
    const { fbDb } = makeMockDb(makeState('SKU-A', 6));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd3',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1447',
        clientStock: { 'SKU-A': { fisicoDep11: 6, libre: 6 } },
      }
    );
    expect(r.ok).toBe(true);
  });

  it('T4 — sin clientStock (SW stale pre-v1443) + qtyBO > 0 → comportamiento histórico, dispara', async () => {
    const { fbDb } = makeMockDb(makeState('SKU-A', 2));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd4',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1400', // sin clientStock
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
  });

  it('T5 — clientStock envía fisicoDep11 distinto a server → dispara aunque qtyBO=0 no sea', async () => {
    const { fbDb } = makeMockDb(makeState('SKU-A', 10));
    // Cliente dice fisico=5 (desincronizado); CF ve 10. Pide 3 → qtyBO=0.
    // Pero fisico distinto NO debe disparar si qtyBO=0 (no hay back order).
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd5',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
        clientVersion: 'v1447',
        clientStock: { 'SKU-A': { fisicoDep11: 5, libre: 5 } },
      }
    );
    expect(r.ok).toBe(true); // qtyBO=0 → no se compara con clientStock.
  });

  it('T6 — múltiples SKUs: 1 match + 1 diff → dispara solo por el diff', async () => {
    const state = makeState('SKU-A', 6);
    state.app_config.stock_snapshot.warehouseBreakdown['SKU-B'] = { 11: 2 }; // CF ve 2
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd6',
        cardCode: 'C001',
        origen: 'manual',
        lines: [
          { sku: 'SKU-A', cantidad: 7, precio: 100 }, // libre=6, qtyBO=1 (ambos saben)
          { sku: 'SKU-B', cantidad: 3, precio: 100 }, // cliente dice libre=3, CF ve libre=2
        ],
        clientVersion: 'v1447',
        clientStock: {
          'SKU-A': { fisicoDep11: 6, libre: 6 },
          'SKU-B': { fisicoDep11: 3, libre: 3 }, // mismatch con CF 2
        },
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
    // Solo SKU-B en el diff. SKU-A tiene qtyBO=1 pero cliente ya lo sabía.
    expect(r.data.diff.length).toBe(1);
    expect(r.data.diff[0].sku).toBe('SKU-B');
  });

  it('T7 — pediste exacto libre=0, cliente ve libre=0, CF libre=0 → qtyBO=cantidad, no dispara', async () => {
    const { fbDb } = makeMockDb(makeState('SKU-A', 0));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd7',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
        clientVersion: 'v1447',
        clientStock: { 'SKU-A': { fisicoDep11: 0, libre: 0 } },
      }
    );
    // Cliente supo "voy a backorderear todo". CF confirma. No disparar.
    expect(r.ok).toBe(true);
  });

  it('T8 — snapshot nuevo con mismos valores (hipótesis Mariano) → no dispara', async () => {
    // Simula: cliente abre waitlist, snapshot updatedAt T1, libre=6.
    // Sync se reescribe en T2 (snapshot nuevo), libre sigue = 6.
    // VDE confirma, CF valida contra snapshot T2 pero fisico/libre son 6/6.
    const state = makeState('SKU-A', 6);
    // Snapshot "nuevo" (hace 10s).
    state.app_config.stock_snapshot.updatedAt = { toMillis: () => nowRef.getTime() - 10_000 };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd8',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 7, precio: 100 }],
        clientVersion: 'v1447',
        clientStock: {
          'SKU-A': { fisicoDep11: 6, libre: 6 }, // snapshot anterior tenía 6, nuevo también
        },
      }
    );
    expect(r.ok).toBe(true);
  });
});
