// @ts-check
/**
 * E2 §stock-servidor-atomico — tests de concurrencia simulada.
 *
 * Simula que una segunda transacción ejecuta DESPUÉS del commit de la
 * primera (equivalente a Firestore reintentando el callback de `runTransaction`
 * cuando detecta conflicto en los docs leídos).
 *
 * Casos:
 * - G1.G01: 2 VDEs confirman mismo SKU libre=1 → uno gana + otro BO.
 * - G1.G02 flavour: 1 VDE confirma mientras otra escritura modificó stock.
 * - G1.G13: 2 tabs mismo user, cache stale → el segundo recibe STOCK_CHANGED.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeDb(initialState) {
  const state = initialState;
  const makeDocRef = (col, id) => ({
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
  });
  const makeCollection = (col, filters = []) => {
    const api = {
      where(f, op, v) {
        return makeCollection(col, [...filters, { f, op, v }]);
      },
      limit() {
        return api;
      },
      doc(id) {
        return makeDocRef(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
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
    };
    return api;
  };
  return {
    collection: (c) => makeCollection(c),
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
    _state: state,
  };
}

function baseState(sku, fisico, nowMs) {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowMs - 60000 },
        warehouseBreakdown: { [sku]: { 11: fisico } },
      },
    },
    pedidos: {},
    stock_snapshot: {
      [sku]: {
        sku,
        asignadas: { total: 0, byClient: {} },
        backorderApp: { total: 0, byClient: {} },
      },
    },
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('commitPedidoCore — concurrencia simulada', () => {
  const nowRef = new Date('2026-10-23T12:00:00Z');

  it('G1.G01: 2 VDEs confirman mismo SKU libre=1 → uno gana, otro BO', async () => {
    const state = baseState('SKU-A', 1, nowRef.getTime());
    const fbDb = makeDb(state);
    const deps = { fbDb, now: () => nowRef };

    // Tx1: VDE1 confirma 1u
    const r1 = await commitPedidoCore(deps, {
      draftId: 'd_vde1',
      cardCode: 'C001',
      origen: 'manual',
      lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
      clientVersion: 'v1430',
    });
    expect(r1.ok).toBe(true);
    expect(r1.lines[0].qtyConfirmed).toBe(1);
    expect(r1.lines[0].qtyBO).toBe(0);
    expect(r1.diffVsClient).toBeNull();

    // Fake "sync" del snapshot post-tx1: actualizamos stock_snapshot/{SKU} para
    // reflejar que ahora hay 1 confirmed. En Firestore real esto lo hace el
    // trigger onPedidoWriteRecalcSnapshot. Lo simulamos manualmente.
    const pedido1 = Object.values(state.pedidos)[0];
    expect(pedido1).toBeTruthy();
    // El pedido ya está en state.pedidos. getStockBreakdown lo cuenta como
    // confirmed porque lee pedidos.lines con closedAt=null + state=confirmed.
    // Para que lineReservesStock('confirmed') devuelva true, el pedido necesita
    // confirmedAt + transferidoSAP NO con orderDocEntry (sino §40.8 lo excluye).
    // Agregamos confirmedAt para que entre en el bucket.
    pedido1.confirmedAt = nowRef.toISOString();
    // transferidoSAP se queda null — no hay orderDocEntry, por lo tanto cuenta.

    // Tx2: VDE2 confirma 1u del mismo SKU
    // Con autoAcceptStockChange=false → debe recibir STOCK_CHANGED
    const r2 = await commitPedidoCore(deps, {
      draftId: 'd_vde2',
      cardCode: 'C002',
      origen: 'manual',
      lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
      clientVersion: 'v1430',
      autoAcceptStockChange: false,
    });
    expect(r2.ok).toBe(false);
    expect(r2.errorCode).toBe('STOCK_CHANGED');
    expect(r2.data.diff[0].aBackOrder).toBe(1);

    // Tx3: VDE2 reintenta aceptando el BO
    const r3 = await commitPedidoCore(deps, {
      draftId: 'd_vde2_retry',
      cardCode: 'C002',
      origen: 'manual',
      lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
      clientVersion: 'v1430',
      autoAcceptStockChange: true,
    });
    expect(r3.ok).toBe(true);
    expect(r3.lines[0].qtyConfirmed).toBe(0);
    expect(r3.lines[0].qtyBO).toBe(1);
    expect(r3.diffVsClient).toBeTruthy();
  });

  it('G1.G13: 2 pestañas mismo user, cache stale → segunda ve STOCK_CHANGED', async () => {
    const state = baseState('SKU-B', 3, nowRef.getTime());
    const fbDb = makeDb(state);
    const deps = { fbDb, now: () => nowRef };

    // Tab1: VDE confirma 2u (restante=1)
    const r1 = await commitPedidoCore(deps, {
      draftId: 'tab1',
      cardCode: 'C001',
      origen: 'manual',
      lines: [{ sku: 'SKU-B', cantidad: 2, precio: 100 }],
      clientVersion: 'v1430',
    });
    expect(r1.ok).toBe(true);
    expect(r1.lines[0].qtyConfirmed).toBe(2);

    // Sync fake: setea confirmedAt al pedido para que entre en el bucket confirmed.
    const pedido1 = Object.values(state.pedidos)[0];
    pedido1.confirmedAt = nowRef.toISOString();

    // Tab2: mismo VDE (cache local decía libre=3). Pide 3u.
    // Pero servidor ya tiene 2 confirmed → libre=1 → 1 confirmed + 2 BO.
    const r2 = await commitPedidoCore(deps, {
      draftId: 'tab2',
      cardCode: 'C001',
      origen: 'manual',
      lines: [{ sku: 'SKU-B', cantidad: 3, precio: 100 }],
      clientVersion: 'v1430',
      autoAcceptStockChange: false,
    });
    expect(r2.ok).toBe(false);
    expect(r2.errorCode).toBe('STOCK_CHANGED');
    expect(r2.data.diff[0].pediste).toBe(3);
    expect(r2.data.diff[0].podesLlevar).toBe(1);
    expect(r2.data.diff[0].aBackOrder).toBe(2);
  });

  it('idempotencia: mismo draftId 2× devuelve mismo pedidoId', async () => {
    const state = baseState('SKU-C', 10, nowRef.getTime());
    const fbDb = makeDb(state);
    const deps = { fbDb, now: () => nowRef };

    const payload = {
      draftId: 'd_idem',
      cardCode: 'C001',
      origen: 'manual',
      lines: [{ sku: 'SKU-C', cantidad: 2, precio: 100 }],
      clientVersion: 'v1430',
    };

    const r1 = await commitPedidoCore(deps, payload);
    expect(r1.ok).toBe(true);
    const pedidoId1 = r1.pedidoId;

    const r2 = await commitPedidoCore(deps, payload);
    expect(r2.ok).toBe(true);
    expect(r2.pedidoId).toBe(pedidoId1);
    expect(r2.idempotentHit).toBe(true);
  });
});
