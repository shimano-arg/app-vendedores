// @ts-check
/**
 * v1461 (2026-10-26) — fix UNRESOLVED_BO_ENTRY_ROWS espúreo.
 *
 * Mariano: "una línea requiere resolución SÓLO si el cliente tiene BO vigente
 * por ese SKU al cargarla; si no, no aplica y ni cliente ni CF la cuentan".
 *
 * El gate del CF ahora filtra por `boEntryResolved === null && boEntryPrevio > 0`.
 * Si llega `boEntryResolved=null` con `boEntryPrevio=0` o undefined, es row
 * espúrea → NO rechaza.
 *
 * 3 tests (los que pidió Mariano):
 *   T1: 10 líneas sin BO previo (todas con boEntryPrevio=0 o undefined) → confirma sin gate.
 *   T2: 1 línea con BO previo (boEntryPrevio=5, resolved=null) → bloquea; con resolved='same' → confirma.
 *   T3: mixta (3 sin BO + 1 con BO sin resolver) → bloquea sólo por la línea con BO; confirma al resolver.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

const nowRef = new Date('2026-10-26T15:00:00Z');

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
      return makeDoc(col, id || `auto_${Math.random().toString(36).slice(2, 10)}`);
    },
    async add(data) {
      const id = `auto_${Math.random().toString(36).slice(2, 10)}`;
      state[col] ||= {};
      state[col][id] = data;
      return { id };
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

function baseState(skus) {
  const warehouseBreakdown = {};
  for (const sku of skus) warehouseBreakdown[sku] = { 11: 100 };
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: JSON.stringify(warehouseBreakdown),
      },
    },
    pedidos: {},
    pedido_draft_locks: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

const DEFAULT_PAYLOAD_HEAD = {
  draftId: 'd-test',
  cardCode: 'CTEST',
  clientName: 'TEST CLIENT',
  origen: 'manual',
  clientVersion: 'v1461',
  ownerUid: 'U1',
  ownerEmail: 'u1@test.com',
  autoAcceptStockChange: true,
};

describe('v1461 §UNRESOLVED_BO_ENTRY_ROWS — gate espúreo', () => {
  it('T1 — 10 líneas sin BO previo (boEntryPrevio=0): confirma sin gate', async () => {
    const skus = Array.from({ length: 10 }, (_, i) => `SKU${i + 1}`);
    const { fbDb } = makeMockDb(baseState(skus));
    const lines = skus.map((sku) => ({
      sku,
      cantidad: 1,
      precio: 100,
      boEntryResolved: null,
      boEntryPrevio: 0, // sin BO previo
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      { ...DEFAULT_PAYLOAD_HEAD, lines }
    );
    if (!r.ok) console.error('T1 result:', JSON.stringify(r, null, 2));
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeFalsy();
  });

  it('T1b — 10 líneas sin BO previo (boEntryPrevio undefined): confirma sin gate', async () => {
    const skus = Array.from({ length: 10 }, (_, i) => `SKU${i + 1}`);
    const { fbDb } = makeMockDb(baseState(skus));
    const lines = skus.map((sku) => ({ sku, cantidad: 1, precio: 100 })); // sin boEntryResolved ni boEntryPrevio
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      { ...DEFAULT_PAYLOAD_HEAD, lines }
    );
    if (!r.ok) console.error('T1b result:', JSON.stringify(r, null, 2));
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeFalsy();
  });

  it('T2 — 1 línea con BO previo real (boEntryPrevio=5, resolved=null) bloquea', async () => {
    const { fbDb } = makeMockDb(baseState(['SKU-A']));
    const payload = {
      ...DEFAULT_PAYLOAD_HEAD,
      lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100, boEntryResolved: null, boEntryPrevio: 5 }],
    };
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('UNRESOLVED_BO_ENTRY_ROWS');
    expect(r.data.rows).toHaveLength(1);
    expect(r.data.rows[0].sku).toBe('SKU-A');
    expect(r.data.rows[0].boAnterior).toBe(5);
  });

  it('T2b — misma línea con resolved="same": confirma', async () => {
    const { fbDb } = makeMockDb(baseState(['SKU-A']));
    const payload = {
      ...DEFAULT_PAYLOAD_HEAD,
      draftId: 'd-t2b',
      lines: [
        { sku: 'SKU-A', cantidad: 3, precio: 100, boEntryResolved: 'same', boEntryPrevio: 5 },
      ],
    };
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeFalsy();
  });

  it('T3 — mixta: 3 sin BO + 1 con BO sin resolver bloquea sólo por esa línea', async () => {
    const { fbDb } = makeMockDb(baseState(['A', 'B', 'C', 'D']));
    const payload = {
      ...DEFAULT_PAYLOAD_HEAD,
      lines: [
        { sku: 'A', cantidad: 1, precio: 100, boEntryResolved: null, boEntryPrevio: 0 }, // sin BO
        { sku: 'B', cantidad: 1, precio: 100 }, // sin BO (undefined)
        { sku: 'C', cantidad: 1, precio: 100, boEntryResolved: null, boEntryPrevio: 0 }, // sin BO
        { sku: 'D', cantidad: 2, precio: 100, boEntryResolved: null, boEntryPrevio: 7 }, // CON BO sin resolver
      ],
    };
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('UNRESOLVED_BO_ENTRY_ROWS');
    expect(r.data.rows).toHaveLength(1);
    expect(r.data.rows[0].sku).toBe('D');
    expect(r.data.rows[0].boAnterior).toBe(7);
  });

  it('T3b — mixta: 3 sin BO + 1 con BO resuelta "additional": confirma', async () => {
    const { fbDb } = makeMockDb(baseState(['A', 'B', 'C', 'D']));
    const payload = {
      ...DEFAULT_PAYLOAD_HEAD,
      draftId: 'd-t3b',
      lines: [
        { sku: 'A', cantidad: 1, precio: 100 },
        { sku: 'B', cantidad: 1, precio: 100 },
        { sku: 'C', cantidad: 1, precio: 100 },
        { sku: 'D', cantidad: 2, precio: 100, boEntryResolved: 'additional', boEntryPrevio: 7 },
      ],
    };
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeFalsy();
  });
});
