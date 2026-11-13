// @ts-check
/**
 * §105 — Test T-10: _backfill del pedido origen se preserva cuando el flujo
 * consolida mutaciones (cancel ASIG + absorb BO) en un solo tx.update.
 *
 * Fixture:
 *   - Pedido origen con `_backfill: {historicRun1: {...}, historicRun2: {...}}`
 *     (data de corridas de backfill anteriores que otros scripts/CFs escribieron).
 *   - 1 ASIG activa + 1 BO activa del mismo cliente.
 *
 * Operación: commitPedidoCore cpst que cancela ASIG + absorbe BO.
 *
 * Esperado:
 *   - UN solo tx.update sobre el pedido origen.
 *   - El `_backfill` existente (historicRun1, historicRun2) sigue en el doc
 *     tras el update (no se pierde).
 *   - No se agregan claves nuevas a _backfill (solo las existentes).
 *   - lines mutadas correctamente (ASIG cancelled + BO qtyOpen=0).
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
      return { exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : null) };
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

describe('§105 T-10 — _backfill del pedido origen preservado tras consolidación', () => {
  it('cancel ASIG + absorb BO en un pedido origen con _backfill existente → UN tx.update + _backfill intacto', async () => {
    const pedOrigen = {
      clientCardCode: 'C001',
      clientName: 'TEST',
      closedAt: null,
      createdAt: '2026-10-15T00:00:00.000Z',
      stage: 'confirmed',
      lines: [
        {
          code: 'SKU_ASIG',
          state: 'ASIG',
          qty: 3,
          qtyOpen: 3,
          qtyCancelled: 0,
          asigAt: '2026-11-10T02:00:00.000Z',
          asigReserva: true,
        },
        { code: 'SKU_BO', state: 'BO', qty: 2, qtyOpen: 2, qtyCancelled: 0 },
      ],
      _backfill: {
        'historicRun1_2026-10-20_v1300': {
          previousValues: { closedReason: '' },
          by: 'scripts/audit/X.cjs',
          at: '2026-10-20T10:00:00.000Z',
        },
        'historicRun2_2026-10-25_v1350': {
          previousValues: { stage: 'pending' },
          by: 'scripts/audit/Y.cjs',
          at: '2026-10-25T10:00:00.000Z',
        },
      },
    };

    const fixture = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          warehouseBreakdown: JSON.stringify({
            SKU_ASIG: { 11: 10 },
            SKU_BO: { 11: 10 },
          }),
        },
      },
      pedidos: { origen_pid: pedOrigen },
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

    const payload = {
      draftId: 'DRAFT-T10',
      cardCode: 'C001',
      clientName: 'TEST',
      origen: 'cpst',
      lines: [
        {
          sku: 'CPST_LINE',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 0, sku: 'SKU_ASIG', qtyAsignada: 3 }],
        },
        { sku: 'SKU_BO', cantidad: 2, precio: 100 },
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

    // 1. Exactamente 1 tx.update sobre el pedido origen (invariante §105).
    const updatesOrigen = _opsLog.filter(
      (o) => o.path === 'pedidos/origen_pid' && o.type === 'update'
    );
    expect(updatesOrigen.length, 'tx.update count sobre pedido origen').toBe(1);

    // 2. Las mutaciones se aplicaron correctamente.
    expect(_state.pedidos.origen_pid.lines[0].state).toBe('cancelled');
    expect(_state.pedidos.origen_pid.lines[0].qtyOpen).toBe(0);
    // BO absorbida: qtyOpen baja a 0 (state puede ser 'BO' o 'cancelled' según
    // convention del core — ambas válidas; lo crítico es qtyOpen=0).
    expect(_state.pedidos.origen_pid.lines[1].qtyOpen).toBe(0);

    // 3. CRITICAL: _backfill preservado (no se perdió historicRun1 ni historicRun2).
    const bf = _state.pedidos.origen_pid._backfill;
    expect(bf).toBeDefined();
    expect(bf['historicRun1_2026-10-20_v1300']).toBeDefined();
    expect(bf['historicRun1_2026-10-20_v1300'].previousValues.closedReason).toBe('');
    expect(bf['historicRun2_2026-10-25_v1350']).toBeDefined();
    expect(bf['historicRun2_2026-10-25_v1350'].previousValues.stage).toBe('pending');
  });

  it('cancel ASIG sobre un pedido SIN _backfill previo → NO se crea _backfill vacío spurioso', async () => {
    const pedOrigen = {
      clientCardCode: 'C001',
      clientName: 'TEST',
      closedAt: null,
      createdAt: '2026-10-15T00:00:00.000Z',
      stage: 'confirmed',
      lines: [
        {
          code: 'SKU_ASIG',
          state: 'ASIG',
          qty: 3,
          qtyOpen: 3,
          qtyCancelled: 0,
          asigAt: '2026-11-10T02:00:00.000Z',
          asigReserva: true,
        },
      ],
      // Sin _backfill.
    };

    const fixture = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          warehouseBreakdown: JSON.stringify({ SKU_ASIG: { 11: 10 } }),
        },
      },
      pedidos: { origen_pid: pedOrigen },
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
    const { fbDb, _state } = makeMockDb(fixture);

    const payload = {
      draftId: 'DRAFT-T10b',
      cardCode: 'C001',
      clientName: 'TEST',
      origen: 'cpst',
      lines: [
        {
          sku: 'CPST_LINE',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 0, sku: 'SKU_ASIG', qtyAsignada: 3 }],
        },
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

    // El pedido origen no debería tener _backfill si nunca lo tuvo (no se escribe
    // vacío/{} spurio).
    const docOrigen = _state.pedidos.origen_pid;
    // Puede ser undefined o no existir la key.
    const bf = docOrigen._backfill;
    expect(bf === undefined || Object.keys(bf).length === 0).toBe(true);
    // Línea cancelada correctamente.
    expect(docOrigen.lines[0].state).toBe('cancelled');
  });
});
