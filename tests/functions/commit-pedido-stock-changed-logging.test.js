// @ts-check
/**
 * §64 (2026-10-23 v1443) — tests para logging STOCK_CHANGED en operations_log.
 *
 * Pedido Mariano Fase 2: "cada vez que la CF lo devuelve [STOCK_CHANGED],
 * registrar en operations_log SKU y valores de cada lado". Permite:
 *   - Reproducir con orden abierta y confirmada al segundo sin sync en el medio.
 *   - Comparar cliente y CF sin inferir.
 *   - Si calculan distinto, unificar en src/pure §39.
 *
 * T1 — STOCK_CHANGED dispara + log entry con type/errorCode/skuDetails.
 * T2 — Log incluye valores server (libre, utilizablePara, qtyBO, _version).
 * T3 — Si payload trae clientStock[sku], el log lo incluye en client + mismatch.
 * T4 — Si payload NO trae clientStock, log tiene clientSnapshotProvided=false.
 * T5 — Log fire-and-forget: throw STOCK_CHANGED igual aunque log falle.
 * T6 — autoAcceptStockChange=true: NO dispara ni loguea.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeMockDb(fixture) {
  const state = fixture || {};
  const operationsLog = [];

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _path: key,
      async get() {
        const data = state[colName]?.[docId];
        return { exists: !!data, data: () => data || null };
      },
      async set(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
      },
      async update(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
      },
      async delete() {
        if (state[colName]) delete state[colName][docId];
      },
    };
  };

  const makeCollection = (colName, filters = []) => {
    const col = {
      _name: colName,
      where(field, op, val) {
        return makeCollection(colName, [...filters, { field, op, val }]);
      },
      limit() {
        return col;
      },
      doc(id) {
        return makeDocRef(colName, id || 'auto_' + Math.random().toString(36).slice(2, 10));
      },
      async get() {
        const colData = state[colName] || {};
        let docs = Object.entries(colData).map(([id, data]) => ({
          id,
          data: () => data,
          exists: true,
        }));
        for (const f of filters) {
          docs = docs.filter((d) => {
            const val = d.data()[f.field];
            if (f.op === '==') return val === f.val;
            return true;
          });
        }
        return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
      },
      add(data) {
        const id = 'auto_' + Math.random().toString(36).slice(2, 10);
        state[colName] ||= {};
        state[colName][id] = data;
        if (colName === 'operations_log') operationsLog.push(data);
        return Promise.resolve({ id });
      },
    };
    return col;
  };

  const fbDb = {
    collection: (name) => makeCollection(name),
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
  };
  return { fbDb, _state: state, _operationsLog: operationsLog };
}

const nowRef = new Date('2026-10-23T18:00:00Z');

/**
 * Fixture: SKU-A fisico 2 (dep 11). Si cliente pide 5, CF calcula
 * qtyConfirmed=2 + qtyBO=3 → STOCK_CHANGED.
 */
function makeStockChangedState() {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: { 'SKU-A': { 11: 2 } },
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('§64 STOCK_CHANGED logging', () => {
  it('T1 — dispara STOCK_CHANGED + escribe log entry en operations_log', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t1',
        cardCode: 'C001',
        clientName: 'TEST',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1443',
        ownerUid: 'U1',
        ownerEmail: 'u1@test.com',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
    await new Promise((res) => setTimeout(res, 10));
    expect(_operationsLog.length).toBeGreaterThan(0);
    const entry = _operationsLog[0];
    expect(entry.type).toBe('commit_pedido_rejected');
    expect(entry.errorCode).toBe('STOCK_CHANGED');
    expect(entry.draftId).toBe('d_t1');
    expect(entry.cardCode).toBe('C001');
    expect(entry.userId).toBe('U1');
    expect(entry.clientVersion).toBe('v1443');
  });

  it('T2 — log incluye valores server (libre, utilizablePara, qtyBO, _version)', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t2',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1443',
      }
    );
    await new Promise((res) => setTimeout(res, 10));
    const entry = _operationsLog[0];
    expect(entry.skuDetails).toBeTruthy();
    expect(entry.skuDetails.length).toBeGreaterThan(0);
    const sd = entry.skuDetails[0];
    expect(sd.sku).toBe('SKU-A');
    expect(sd.pediste).toBe(5);
    expect(sd.server).toBeTruthy();
    expect(sd.server.qtyConfirmed).toBe(2);
    expect(sd.server.qtyBO).toBe(3);
    expect(sd.server.libre).toBe(2);
    expect(sd.server.fisicoDep11).toBe(2);
    expect(sd.server._version).toBeTruthy();
    // Totales agregados.
    expect(entry.totalSkuChanged).toBe(1);
    expect(entry.totalUnitsToBO).toBe(3);
    expect(entry.serverSnapshotOrigin).toBe('server:app_config/stock_snapshot');
    expect(entry.serverSnapshotUpdatedAt).toBeTruthy();
  });

  it('T3 — si payload trae clientStock, log incluye client + flags mismatch', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    // Cliente dice que vio libre=5 (desincronizado).
    await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t3',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1443',
        clientStock: {
          'SKU-A': {
            libre: 5,
            utilizablePara: 5,
            fisicoDep11: 5,
            reservadasTotal: 0,
            _version: 7,
          },
        },
        clientSnapshotUpdatedAt: new Date(nowRef.getTime() - 120_000).toISOString(),
      }
    );
    await new Promise((res) => setTimeout(res, 10));
    const entry = _operationsLog[0];
    expect(entry.clientSnapshotProvided).toBe(true);
    expect(entry.clientSnapshotUpdatedAt).toBeTruthy();
    const sd = entry.skuDetails[0];
    expect(sd.client).toBeTruthy();
    expect(sd.client.libre).toBe(5);
    expect(sd.mismatch).toBeTruthy();
    expect(sd.mismatch.libre).toBe(true); // 5 (cliente) !== 2 (CF).
    expect(sd.mismatch.reservadasTotal).toBeUndefined; // Solo tracked libre/utilizable/fisico.
  });

  it('T4 — sin clientStock: clientSnapshotProvided=false, sd.client=null', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t4',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1443',
      }
    );
    await new Promise((res) => setTimeout(res, 10));
    const entry = _operationsLog[0];
    expect(entry.clientSnapshotProvided).toBe(false);
    expect(entry.skuDetails[0].client).toBeNull();
    expect(entry.skuDetails[0].mismatch).toBeNull();
  });

  it('T5 — autoAcceptStockChange=true: NO dispara STOCK_CHANGED ni loguea', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t5',
        cardCode: 'C001',
        clientName: 'TEST',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1443',
        ownerUid: 'U1',
        ownerEmail: 'u1@test.com',
        autoAcceptStockChange: true,
      }
    );
    // Acepta → confirma 2 + BO 3 sin disparar error.
    expect(r.ok).toBe(true);
    // No logueó STOCK_CHANGED.
    const stockChangedLog = _operationsLog.find((e) => e.errorCode === 'STOCK_CHANGED');
    expect(stockChangedLog).toBeFalsy();
  });

  it('T6 — pediste exacto a libre: NO dispara (qtyBO=0 para TODOS los SKU)', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t6',
        cardCode: 'C001',
        clientName: 'TEST',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 2, precio: 100 }], // libre = 2.
        clientVersion: 'v1443',
        ownerUid: 'U1',
        ownerEmail: 'u1@test.com',
      }
    );
    expect(r.ok).toBe(true);
    const stockChangedLog = _operationsLog.find((e) => e.errorCode === 'STOCK_CHANGED');
    expect(stockChangedLog).toBeFalsy();
  });
});
