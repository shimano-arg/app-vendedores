// @ts-check
/**
 * E8 §stock-servidor-atomico (v1433) — bloqueo edición post-SAP.
 *
 * G4.03 del audit grises: un pedido ya enviado a SAP (transferidoSAP.docEntry
 * != null) NO debe editarse desde la app porque la SQ en SAP queda divergente.
 *
 * El guard vive server-side en commitPedidoCore: si existe pedido con mismo
 * draftId Y transferidoSAP.docEntry presente (no 'app_only') → return
 * PERMISSION_DENIED con mensaje "contactar admin que lo edita en SAP".
 */
import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeDeps(state) {
  const written = [];
  const makeDoc = (col, id) => ({
    id,
    async get() {
      const d = state[col] && state[col][id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
      written.push({ op: 'set', path: `${col}/${id}`, data });
    },
    async update(data) {
      state[col][id] = { ...(state[col][id] || {}), ...data };
      written.push({ op: 'update', path: `${col}/${id}`, data });
    },
  });
  const makeCol = (col, filters = []) => ({
    where(f, op, v) {
      return makeCol(col, [...filters, { f, op, v }]);
    },
    limit() {
      return this;
    },
    orderBy() {
      return this;
    },
    doc(id) {
      return makeDoc(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
    },
    async get() {
      let docs = Object.entries(state[col] || {}).map(([id, data]) => ({
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
        };
        return fn(tx);
      },
    },
    log: vi.fn(),
    _state: state,
    _written: written,
  };
}

const nowRef = new Date('2026-10-23T12:00:00Z');
const basePayload = {
  draftId: 'draft_e8_1',
  cardCode: 'C001',
  origen: 'manual',
  lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
  clientVersion: 'v1433',
};

describe('E8 — bloqueo edit post-SAP', () => {
  it('pedido con transferidoSAP.docEntry → PERMISSION_DENIED', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
          warehouseBreakdown: { 'SKU-A': { 11: 10 } },
        },
      },
      pedidos: {
        existing_post_sap: {
          _draftId: 'draft_e8_1',
          stage: 'confirmed',
          clientCardCode: 'C001',
          transferidoSAP: { docEntry: 999, docNum: 2000425, via: 'cf_auto' },
          lines: [{ code: 'SKU-A', state: 'confirmed', qty: 1, qtyOpen: 1 }],
        },
      },
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const deps = makeDeps(state);
    const r = await commitPedidoCore({ ...deps, now: () => nowRef }, basePayload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PERMISSION_DENIED');
    expect(r.message).toMatch(/Pedido ya enviado a SAP/);
    expect(r.data.sapDocNum).toBe(2000425);
  });

  it('transferidoSAP con via=app_only NO bloquea (fue cancelación local)', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
          warehouseBreakdown: { 'SKU-A': { 11: 10 } },
        },
      },
      pedidos: {
        existing_app_only: {
          _draftId: 'draft_e8_1',
          stage: 'confirmed',
          clientCardCode: 'C001',
          transferidoSAP: { docEntry: null, via: 'app_only', reason: 'all_lines_bo' },
          lines: [{ code: 'SKU-A', state: 'BO', qty: 1 }],
        },
      },
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const deps = makeDeps(state);
    const r = await commitPedidoCore({ ...deps, now: () => nowRef }, basePayload);
    expect(r.ok).toBe(true); // idempotency hit, no bloqueo
    expect(r.idempotentHit).toBe(true);
  });

  it('pedido sin transferidoSAP → idempotency hit normal', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
          warehouseBreakdown: { 'SKU-A': { 11: 10 } },
        },
      },
      pedidos: {
        existing_no_sap: {
          _draftId: 'draft_e8_1',
          stage: 'confirmed',
          clientCardCode: 'C001',
          transferidoSAP: null,
          lines: [{ code: 'SKU-A', state: 'confirmed', qty: 1 }],
        },
      },
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const deps = makeDeps(state);
    const r = await commitPedidoCore({ ...deps, now: () => nowRef }, basePayload);
    expect(r.ok).toBe(true);
    expect(r.idempotentHit).toBe(true);
    expect(r.pedidoId).toBe('existing_no_sap');
  });

  it('nuevo pedido sin idempotency hit → crear normal', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
          warehouseBreakdown: { 'SKU-A': { 11: 10 } },
        },
      },
      pedidos: {}, // sin pedido existente con ese draftId
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const deps = makeDeps(state);
    const r = await commitPedidoCore({ ...deps, now: () => nowRef }, basePayload);
    expect(r.ok).toBe(true);
    expect(r.idempotentHit).toBeUndefined();
  });
});
