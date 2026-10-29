// @ts-check
/**
 * §SEC-AUTH-001 Opción A regresión (PR #1 v1507) — flow colaborativo
 * VDE↔VDE legítimo preservado post role gate.
 *
 * Decisión Mariano 2026-10-28: `commitPedidoCF` sigue permitiendo que
 * cualquier caller con role válido (vendedor/interno/gerente/admin)
 * consuma waitlist de otro. El residual VDE↔VDE queda documentado en
 * SEC-AUTH-002 (fila CSV, estado=aceptado, cierre post-Japón).
 *
 * Este archivo verifica que los 4 roles válidos siguen pudiendo
 * procesar waitlists ajenas (flow legítimo revision-excel + CPST).
 * Sin branches condicionales — exige r.ok === true + consumedBy=caller.uid.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock Firestore completo que soporta el flow commit-pedido end-to-end.
 * Preset: waitlist abierta cargada por VDE A, stock_snapshot con SKU disponible,
 * sap_products con el SKU, counters.orderNumber, pedido_draft_locks vacío.
 */
function makeFullMockDb({ waitlistOwnerUid, waitlistId, cardCode = 'C001' }) {
  /** @type {Record<string, Record<string, any>>} */
  const state = {
    revision_waitlist: {
      [waitlistId]: {
        _id: waitlistId,
        clientCardCode: cardCode,
        ownerUid: waitlistOwnerUid,
        assignedVendorUid: 'uid-vde-federico',
        stage: 'review',
        closedAt: null,
        items: [{ code: 'SKU-A', qty: 1, precio: 100 }],
        orderNumber: 999,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    },
    app_config: {
      stock_snapshot: {
        updatedAt: new Date(),
        quantities: JSON.stringify({ 'SKU-A': 10 }),
        warehouseBreakdown: JSON.stringify({ 'SKU-A': { 11: 10 } }),
        backorderBySku: JSON.stringify({}),
      },
      version_minima: { minVersion: 'v1' },
      live_sl: { enabled: false },
    },
    pedidos: {},
    counters: { orderNumber: { current: 1000 } },
    pedido_draft_locks: {},
    operations_log: {},
    sap_products: { 'SKU-A': { exists: true } },
  };

  const makeDoc = (col, id) => ({
    id,
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
    orderBy() {
      return this;
    },
    doc(id) {
      return makeDoc(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
    },
    async add(data) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
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
          if (f.op === '!=') return v !== f.v;
          return true;
        });
      }
      return {
        empty: docs.length === 0,
        docs,
        size: docs.length,
        forEach: (fn) => docs.forEach(fn),
      };
    },
  });

  return {
    collection: makeCol,
    doc(path) {
      const [col, id] = path.split('/');
      return makeDoc(col, id);
    },
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref) => ref.get(),
        set: async (ref, data) => ref.set(data),
        update: async (ref, data) => ref.update(data),
        delete: async (ref) => ref.delete(),
      };
      return fn(tx);
    },
    _state: state,
  };
}

const BASE_PAYLOAD = {
  draftId: 'C|BA|CABA|CLIENTE X|999',
  cardCode: 'C001',
  origen: 'cpst',
  waitlistOrigenId: 'WL-ORIG-A',
  lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100, origen: 'stock-asignado', asigRefs: [] }],
  clientVersion: 'v1507',
  vendorAssigned: 'FEDERICO CASTELANELLI',
  assignedVendorUid: 'uid-vde-federico',
};

describe('commit-pedido flow colaborativo (SEC-AUTH-001 Opción A)', () => {
  it('T1: vendedor B consume waitlist de vendedor A → r.ok + consumedBy=B.uid', async () => {
    const db = makeFullMockDb({ waitlistOwnerUid: 'uid-vde-A', waitlistId: 'WL-ORIG-A' });
    const callerUid = 'uid-vde-B';
    const payload = { ...BASE_PAYLOAD, ownerUid: callerUid, ownerEmail: 'B@shimano.com.ar' };

    const r = await commitPedidoCore({ fbDb: db, log: () => {}, FieldValue: {} }, payload);

    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBeDefined();
    const wl = db._state.revision_waitlist['WL-ORIG-A'];
    expect(wl.stage).toBe('consumed');
    expect(wl.consumedBy).toBe(callerUid);
    expect(wl.consumedByPedidoId).toBe(r.pedidoId);
    expect(wl.closedReason).toBe('consumed_by_commitPedidoCF');
  });

  it('T2: admin Mariano consume waitlist de VDE A → r.ok + consumedBy=admin.uid', async () => {
    const db = makeFullMockDb({ waitlistOwnerUid: 'uid-vde-A', waitlistId: 'WL-ORIG-A' });
    const callerUid = 'uid-admin-mariano';
    const payload = { ...BASE_PAYLOAD, ownerUid: callerUid, ownerEmail: 'erbinomariano@gmail.com' };

    const r = await commitPedidoCore({ fbDb: db, log: () => {}, FieldValue: {} }, payload);

    expect(r.ok).toBe(true);
    const wl = db._state.revision_waitlist['WL-ORIG-A'];
    expect(wl.stage).toBe('consumed');
    expect(wl.consumedBy).toBe(callerUid);
  });

  it('T3: gerente Pablo consume waitlist de VDE A → r.ok + consumedBy=gerente.uid', async () => {
    const db = makeFullMockDb({ waitlistOwnerUid: 'uid-vde-A', waitlistId: 'WL-ORIG-A' });
    const callerUid = 'uid-gerente-pablo';
    const payload = { ...BASE_PAYLOAD, ownerUid: callerUid, ownerEmail: 'pablo@shimano.com.ar' };

    const r = await commitPedidoCore({ fbDb: db, log: () => {}, FieldValue: {} }, payload);

    expect(r.ok).toBe(true);
    const wl = db._state.revision_waitlist['WL-ORIG-A'];
    expect(wl.stage).toBe('consumed');
    expect(wl.consumedBy).toBe(callerUid);
  });

  it('T4: interno Santi consume waitlist de VDE A → r.ok + consumedBy=interno.uid', async () => {
    const db = makeFullMockDb({ waitlistOwnerUid: 'uid-vde-A', waitlistId: 'WL-ORIG-A' });
    const callerUid = 'uid-interno-santi';
    const payload = { ...BASE_PAYLOAD, ownerUid: callerUid, ownerEmail: 'santi@shimano.com.ar' };

    const r = await commitPedidoCore({ fbDb: db, log: () => {}, FieldValue: {} }, payload);

    expect(r.ok).toBe(true);
    const wl = db._state.revision_waitlist['WL-ORIG-A'];
    expect(wl.stage).toBe('consumed');
    expect(wl.consumedBy).toBe(callerUid);
  });
});
