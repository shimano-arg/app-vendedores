// @ts-check
/**
 * §105 — Test T-09: CPST con múltiples pedidos origen. Verifica que el fix
 * funciona correctamente cuando el payload referencia ASIG de pedidos origen
 * distintos (no es un hack monopatinado solo para un pedido).
 *
 * Fixture:
 *   - Pedido origen X: 5 ASIG del cliente.
 *   - Pedido origen Y: 3 ASIG + 2 BO del cliente.
 *   - Pedido origen Z: 4 BO del cliente.
 *
 * Operación: commitPedidoCore cpst con asigRefs a X+Y + confirmed que absorbe BO de Y+Z.
 *
 * Esperado: 3 tx.update distintos (uno por pedido origen) con cancels + absorbs correctos.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeMockDb(fixture) {
  const state = fixture || {};
  const _opsLog = [];
  const makeDoc = (col, id) => ({
    id,
    _path: `${col}/${id}`,
    async get() {
      const d = state[col]?.[id];
      const cloned = d ? JSON.parse(JSON.stringify(d)) : null;
      return { exists: !!d, data: () => cloned };
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
    async add(data) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = { ...data };
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
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
        forEach: (fn) => docs.forEach(fn),
      };
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
        const snap = JSON.parse(JSON.stringify(state));
        const opsBefore = _opsLog.length;
        try {
          const tx = {
            async get(ref) {
              return ref.get();
            },
            set(ref, data) {
              _opsLog.push({ type: 'set', path: ref._path, data });
              return ref.set(data);
            },
            update(ref, data) {
              _opsLog.push({ type: 'update', path: ref._path, data });
              return ref.update(data);
            },
            delete(ref) {
              _opsLog.push({ type: 'delete', path: ref._path });
              return ref.delete();
            },
          };
          return await fn(tx);
        } catch (e) {
          for (const k of Object.keys(state)) delete state[k];
          for (const [k, v] of Object.entries(snap)) state[k] = v;
          for (let i = opsBefore; i < _opsLog.length; i++) _opsLog[i].rolledBack = true;
          throw e;
        }
      },
    },
    _state: state,
    _opsLog,
  };
}

const nowRef = new Date('2026-11-13T16:00:00Z');

function makePed({ nAsig = 0, nBo = 0, cliente = 'C001' } = {}) {
  const lines = [];
  for (let i = 0; i < nAsig; i++) {
    lines.push({
      code: 'ASIG_' + i,
      state: 'ASIG',
      qty: 3,
      qtyOpen: 3,
      qtyCancelled: 0,
      asigAt: '2026-11-10T02:00:00.000Z',
      asigReserva: true,
    });
  }
  for (let i = 0; i < nBo; i++) {
    lines.push({ code: 'BOY_' + i, state: 'BO', qty: 2, qtyOpen: 2, qtyCancelled: 0 });
  }
  return {
    clientCardCode: cliente,
    clientName: 'TEST',
    closedAt: null,
    lines,
    _backfill: {},
    createdAt: '2026-11-01T00:00:00.000Z',
    stage: 'confirmed',
  };
}

describe('§105 T-09 — múltiples pedidos origen', () => {
  it('cpst con asigRefs a X+Y + confirmed absorbe BO de Y+Z → 3 tx.update, todas mutaciones correctas', async () => {
    const pedX = makePed({ nAsig: 5, nBo: 0 });
    for (let i = 0; i < 5; i++) pedX.lines[i].code = 'ASIG_X_' + i;
    const pedY = makePed({ nAsig: 3, nBo: 2 });
    for (let i = 0; i < 3; i++) pedY.lines[i].code = 'ASIG_Y_' + i;
    pedY.lines[3].code = 'BO_Y_0';
    pedY.lines[4].code = 'BO_Y_1';
    const pedZ = makePed({ nAsig: 0, nBo: 4 });
    for (let i = 0; i < 4; i++) pedZ.lines[i].code = 'BO_Z_' + i;

    const wh = {};
    for (let i = 0; i < 5; i++) wh['ASIG_X_' + i] = { 11: 10 };
    for (let i = 0; i < 3; i++) wh['ASIG_Y_' + i] = { 11: 10 };
    for (let i = 0; i < 2; i++) wh['BO_Y_' + i] = { 11: 10 };
    for (let i = 0; i < 4; i++) wh['BO_Z_' + i] = { 11: 10 };

    const fixture = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          warehouseBreakdown: JSON.stringify(wh),
        },
      },
      pedidos: { pedX, pedY, pedZ },
      pedido_draft_locks: {},
      ingresos_reparto: {},
      revision_waitlist: {
        wl: {
          clientCardCode: 'C001',
          stage: 'pending',
          closedAt: null,
          source: 'stock-asignado-batch',
        },
      },
    };
    const { fbDb, _state, _opsLog } = makeMockDb(fixture);

    const asigRefs = [];
    for (let i = 0; i < 5; i++)
      asigRefs.push({ pedidoId: 'pedX', lineIndex: i, sku: 'ASIG_X_' + i, qtyAsignada: 3 });
    for (let i = 0; i < 3; i++)
      asigRefs.push({ pedidoId: 'pedY', lineIndex: i, sku: 'ASIG_Y_' + i, qtyAsignada: 3 });

    const payload = {
      draftId: 'DRAFT-T09',
      cardCode: 'C001',
      clientName: 'TEST',
      origen: 'cpst',
      lines: [
        {
          sku: 'CPST_LINE',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs,
        },
        // Lines confirmed de BO SKUs — §J los absorbe de pedY + pedZ.
        { sku: 'BO_Y_0', cantidad: 2, precio: 100 },
        { sku: 'BO_Y_1', cantidad: 2, precio: 100 },
        { sku: 'BO_Z_0', cantidad: 2, precio: 100 },
        { sku: 'BO_Z_1', cantidad: 2, precio: 100 },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      waitlistOrigenId: 'wl',
      source: 'stock-asignado-batch',
      autoAcceptStockChange: true,
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);

    // 5 ASIG canceladas en X.
    for (let i = 0; i < 5; i++) {
      expect(_state.pedidos.pedX.lines[i].state, `pedX[${i}]`).toBe('cancelled');
    }
    // 3 ASIG canceladas en Y + 2 BO absorbidas.
    for (let i = 0; i < 3; i++) {
      expect(_state.pedidos.pedY.lines[i].state, `pedY[${i}] ASIG`).toBe('cancelled');
    }
    expect(_state.pedidos.pedY.lines[3].qtyOpen, 'pedY BO 0').toBe(0);
    expect(_state.pedidos.pedY.lines[4].qtyOpen, 'pedY BO 1').toBe(0);

    // CRITICAL: exactamente 3 tx.update distintos sobre pedidos origen
    // (uno por doc: pedX, pedY, pedZ).
    const updatesPedX = _opsLog.filter((o) => o.path === 'pedidos/pedX' && o.type === 'update');
    const updatesPedY = _opsLog.filter((o) => o.path === 'pedidos/pedY' && o.type === 'update');
    const updatesPedZ = _opsLog.filter((o) => o.path === 'pedidos/pedZ' && o.type === 'update');
    expect(updatesPedX.length, 'tx.update pedX').toBe(1);
    expect(updatesPedY.length, 'tx.update pedY').toBe(1);
    expect(updatesPedZ.length, 'tx.update pedZ').toBe(1);
  });
});
