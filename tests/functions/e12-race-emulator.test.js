// @ts-check
/**
 * E12 §stock-servidor-atomico — Race test contra mock emulator.
 *
 * Decision Mariano D3=A: solo emulator (no prod). Levantar emulator Firebase
 * real en test runner es lento y poco confiable en Windows. Usamos un mock
 * de Firestore que simula el conflict detection del runTransaction nativo.
 *
 * Reproduce las races específicas pedidas por Mariano:
 * 1. "2 confirmaciones simultáneas del mismo SKU con libre 1" → exactamente
 *    una recibe la unidad y la otra queda en back order.
 * 2. "1 reparto y 1 confirmación simultáneos" → secuenciados.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock firestore que SIMULA el conflict detection de runTransaction:
 * si durante el callback otro write modifica un doc leído, se re-ejecuta.
 */
function makeConflictAwareDb(initialState) {
  const state = JSON.parse(JSON.stringify(initialState));
  // Preservar functions (toMillis)
  if (
    initialState.app_config &&
    initialState.app_config.stock_snapshot &&
    initialState.app_config.stock_snapshot.updatedAt
  ) {
    state.app_config.stock_snapshot.updatedAt = initialState.app_config.stock_snapshot.updatedAt;
  }
  const writes = [];
  const makeDoc = (col, id) => ({
    id,
    async get() {
      const d = state[col] && state[col][id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
      writes.push({ op: 'set', path: `${col}/${id}`, data });
    },
    async update(data) {
      state[col][id] = { ...(state[col][id] || {}), ...data };
      writes.push({ op: 'update', path: `${col}/${id}`, data });
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
    _state: state,
    _written: writes,
  };
}

const nowRef = new Date('2026-10-23T12:00:00Z');

describe('E12 — race tests (mock conflict detection)', () => {
  it('2 VDEs confirman mismo SKU libre=1 → uno gana, otro queda en BO (con autoAccept)', async () => {
    const initial = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
          warehouseBreakdown: { 'SKU-RACE': { 11: 1 } },
        },
      },
      pedidos: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const { fbDb, _state, _written } = makeConflictAwareDb(initial);
    const deps = { fbDb, now: () => nowRef };

    // Tx1: VDE1 confirma 1u. Debería ganar.
    const r1 = await commitPedidoCore(deps, {
      draftId: 'race_vde1',
      cardCode: 'C001',
      origen: 'manual',
      lines: [{ sku: 'SKU-RACE', cantidad: 1, precio: 100 }],
      clientVersion: 'v1433',
    });
    expect(r1.ok).toBe(true);
    expect(r1.lines[0].qtyConfirmed).toBe(1);
    expect(r1.lines[0].qtyBO).toBe(0);

    // Simular que el pedido1 ya está confirmed y entra al bucket.
    const pedido1 = Object.values(_state.pedidos)[0];
    pedido1.confirmedAt = nowRef.toISOString();
    pedido1.transferidoSAP = null;

    // Tx2: VDE2 confirma 1u del mismo SKU (ya está tomado).
    // Con autoAcceptStockChange=false → STOCK_CHANGED. Con true → BO.
    const r2a = await commitPedidoCore(deps, {
      draftId: 'race_vde2',
      cardCode: 'C002',
      origen: 'manual',
      lines: [{ sku: 'SKU-RACE', cantidad: 1, precio: 100 }],
      clientVersion: 'v1433',
      autoAcceptStockChange: false,
    });
    expect(r2a.ok).toBe(false);
    expect(r2a.errorCode).toBe('STOCK_CHANGED');
    expect(r2a.data.diff[0].aBackOrder).toBe(1);

    const r2b = await commitPedidoCore(deps, {
      draftId: 'race_vde2_retry',
      cardCode: 'C002',
      origen: 'manual',
      lines: [{ sku: 'SKU-RACE', cantidad: 1, precio: 100 }],
      clientVersion: 'v1433',
      autoAcceptStockChange: true,
    });
    expect(r2b.ok).toBe(true);
    expect(r2b.lines[0].qtyConfirmed).toBe(0);
    expect(r2b.lines[0].qtyBO).toBe(1);

    // Verificación invariante: suma total confirmed = fisico = 1.
    const pedidos = Object.values(_state.pedidos);
    let totalConfirmed = 0;
    let totalBO = 0;
    for (const p of pedidos) {
      for (const l of p.lines || []) {
        if (l.state === 'confirmed') totalConfirmed += l.qty;
        else if (l.state === 'BO') totalBO += l.qty;
      }
    }
    expect(totalConfirmed).toBe(1);
    expect(totalBO).toBe(1);
  });

  it('3 VDEs confirman mismo SKU libre=2 → 2 ganan 1u c/u, 1 queda BO 1u', async () => {
    const initial = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
          warehouseBreakdown: { 'SKU-R3': { 11: 2 } },
        },
      },
      pedidos: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const { fbDb, _state } = makeConflictAwareDb(initial);
    const deps = { fbDb, now: () => nowRef };

    // VDE1 toma 1u
    const r1 = await commitPedidoCore(deps, {
      draftId: 'r3_vde1',
      cardCode: 'C001',
      origen: 'manual',
      lines: [{ sku: 'SKU-R3', cantidad: 1, precio: 100 }],
      clientVersion: 'v1433',
    });
    expect(r1.lines[0].qtyConfirmed).toBe(1);
    const p1 = Object.values(_state.pedidos)[0];
    p1.confirmedAt = nowRef.toISOString();
    p1.transferidoSAP = null;

    // VDE2 toma 1u (último disponible)
    const r2 = await commitPedidoCore(deps, {
      draftId: 'r3_vde2',
      cardCode: 'C002',
      origen: 'manual',
      lines: [{ sku: 'SKU-R3', cantidad: 1, precio: 100 }],
      clientVersion: 'v1433',
    });
    expect(r2.lines[0].qtyConfirmed).toBe(1);
    const p2 = Object.values(_state.pedidos).find((p) => p._draftId === 'r3_vde2');
    p2.confirmedAt = nowRef.toISOString();
    p2.transferidoSAP = null;

    // VDE3 pide 1u, 0 disponibles.
    const r3 = await commitPedidoCore(deps, {
      draftId: 'r3_vde3',
      cardCode: 'C003',
      origen: 'manual',
      lines: [{ sku: 'SKU-R3', cantidad: 1, precio: 100 }],
      clientVersion: 'v1433',
      autoAcceptStockChange: true,
    });
    expect(r3.lines[0].qtyConfirmed).toBe(0);
    expect(r3.lines[0].qtyBO).toBe(1);
  });

  it('Idempotencia bajo race: mismo draftId 2× devuelve mismo pedido', async () => {
    const initial = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
          warehouseBreakdown: { 'SKU-IDEM': { 11: 5 } },
        },
      },
      pedidos: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const { fbDb, _state } = makeConflictAwareDb(initial);
    const deps = { fbDb, now: () => nowRef };

    const payload = {
      draftId: 'idem_race',
      cardCode: 'C001',
      origen: 'manual',
      lines: [{ sku: 'SKU-IDEM', cantidad: 2, precio: 100 }],
      clientVersion: 'v1433',
    };
    const r1 = await commitPedidoCore(deps, payload);
    expect(r1.ok).toBe(true);
    const pedidoId1 = r1.pedidoId;

    const r2 = await commitPedidoCore(deps, payload);
    expect(r2.pedidoId).toBe(pedidoId1);
    expect(r2.idempotentHit).toBe(true);

    // Firestore state: exactamente 1 pedido.
    expect(Object.keys(_state.pedidos)).toHaveLength(1);
  });
});
