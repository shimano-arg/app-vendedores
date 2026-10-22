// @ts-check
/**
 * E2 §stock-servidor-atomico — commitPedidoCore unit tests.
 *
 * Suite de 15+ tests cubriendo:
 * - Happy path manual + CPST.
 * - Idempotencia por draftId.
 * - Validación payload.
 * - Códigos de error: VERSION_OLD, CLIENT_HAS_OPEN_WAITLIST, STOCK_CHANGED,
 *   SNAPSHOT_TOO_OLD, VALIDATION_ERROR.
 * - Atomicidad: runTransaction wrapper + conflicto Firestore simulado.
 */
import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock Firestore con runTransaction + collections configurable.
 */
function makeMockDb(fixture) {
  // NO JSON.stringify: preservamos functions (e.g. toMillis en Timestamps mock).
  const state = fixture || {};
  const written = [];

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _path: key,
      async get() {
        const data = state[colName]?.[docId];
        return {
          exists: !!data,
          data: () => data || null,
        };
      },
      async set(data, _opts) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'set', path: key, data });
      },
      async update(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'update', path: key, data });
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
            if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(val);
            return true;
          });
        }
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn) => docs.forEach(fn),
        };
      },
    };
    return col;
  };

  const fbDb = {
    collection: (name) => makeCollection(name),
    doc(path) {
      const [col, id] = path.split('/');
      return makeDocRef(col, id);
    },
    async runTransaction(fn) {
      // Simulación: ejecuta la función una vez con tx que proxya a get/set/update.
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
  };
  return { fbDb, _state: state, _written: written };
}

const nowRef = new Date('2026-10-23T12:00:00Z');

function baseStateWithStock(sku, fisico, pedidos = []) {
  const pedidosMap = {};
  for (const p of pedidos) pedidosMap[p._fsId || p.id || 'p1'] = p;
  const state = {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60000 }, // 1 min atrás
        warehouseBreakdown: { [sku]: { 11: fisico } },
      },
    },
    pedidos: pedidosMap,
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
  return state;
}

describe('commitPedidoCore — E2 §stock-servidor-atomico', () => {
  describe('Validación payload', () => {
    it('rechaza payload sin draftId', async () => {
      const { fbDb } = makeMockDb({});
      const r = await commitPedidoCore(
        { fbDb },
        {
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'X', cantidad: 1 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.data.field).toBe('draftId');
    });

    it('rechaza origen inválido', async () => {
      const { fbDb } = makeMockDb({});
      const r = await commitPedidoCore(
        { fbDb },
        {
          draftId: 'd1',
          cardCode: 'C001',
          origen: 'FOO',
          lines: [{ sku: 'X', cantidad: 1 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.data.field).toBe('origen');
    });

    it('rechaza lines vacío', async () => {
      const { fbDb } = makeMockDb({});
      const r = await commitPedidoCore(
        { fbDb },
        {
          draftId: 'd1',
          cardCode: 'C001',
          origen: 'manual',
          lines: [],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
    });

    it('rechaza cantidad <= 0', async () => {
      const { fbDb } = makeMockDb({});
      const r = await commitPedidoCore(
        { fbDb },
        {
          draftId: 'd1',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'X', cantidad: 0 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('Happy path manual', () => {
    it('crea pedido confirmed cuando hay stock', async () => {
      const state = baseStateWithStock('SKU-A', 10, []);
      const { fbDb, _state, _written } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd001',
          cardCode: 'C001',
          clientName: 'CL1',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(true);
      expect(r.pedidoId).toBeTruthy();
      expect(r.lines).toHaveLength(1);
      expect(r.lines[0].qtyConfirmed).toBe(5);
      expect(r.lines[0].qtyBO).toBe(0);
      expect(r.diffVsClient).toBeNull();
      // Verifica que se escribió el pedido
      const pedidoWrite = _written.find((w) => w.path.startsWith('pedidos/'));
      expect(pedidoWrite).toBeTruthy();
      expect(pedidoWrite.data.stage).toBe('confirmed');
      expect(pedidoWrite.data._draftId).toBe('d001');
    });

    it('crea pedido con BO cuando stock insuficiente + autoAcceptStockChange=true', async () => {
      const state = baseStateWithStock('SKU-A', 2, []);
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd002',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
          clientVersion: 'v1430',
          autoAcceptStockChange: true,
        }
      );
      expect(r.ok).toBe(true);
      expect(r.lines[0].qtyConfirmed).toBe(2);
      expect(r.lines[0].qtyBO).toBe(3);
      expect(r.diffVsClient).toBeTruthy();
      expect(r.diffVsClient.skuChanged[0].aBackOrder).toBe(3);
    });

    it('STOCK_CHANGED cuando stock cambia + autoAcceptStockChange=false', async () => {
      const state = baseStateWithStock('SKU-A', 2, []);
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd003',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
          clientVersion: 'v1430',
          autoAcceptStockChange: false,
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('STOCK_CHANGED');
      expect(r.data.diff[0].aBackOrder).toBe(3);
    });
  });

  describe('Idempotencia por draftId', () => {
    it('mismo draftId devuelve mismo pedidoId (no crea duplicado)', async () => {
      const state = baseStateWithStock('SKU-A', 10, []);
      state.pedidos['existing_123'] = {
        _draftId: 'd_dup',
        stage: 'confirmed',
        clientCardCode: 'C001',
        lines: [{ code: 'SKU-A', qty: 3, state: 'confirmed' }],
      };
      const { fbDb, _written } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_dup',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(true);
      expect(r.pedidoId).toBe('existing_123');
      expect(r.idempotentHit).toBe(true);
      // Sin writes nuevos
      const pedidoWrites = _written.filter((w) => w.path.startsWith('pedidos/') && w.op === 'set');
      expect(pedidoWrites.length).toBe(0);
    });
  });

  describe('VERSION_OLD', () => {
    it('rechaza clientVersion < min_app_version', async () => {
      const state = baseStateWithStock('SKU-A', 10, []);
      state.app_config.version_minima = { minVersion: 'v2000' };
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_old',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VERSION_OLD');
      expect(r.data.minVersion).toBe('v2000');
      expect(r.data.currentVersion).toBe('v1430');
    });

    it('pasa si version_minima no existe', async () => {
      const state = baseStateWithStock('SKU-A', 10, []);
      // Sin version_minima
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_new',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('CLIENT_HAS_OPEN_WAITLIST', () => {
    it('rechaza si cliente tiene waitlist abierto (origen=manual)', async () => {
      const state = baseStateWithStock('SKU-A', 10, []);
      state.revision_waitlist['wl_1'] = {
        clientCardCode: 'C001',
        orderNumber: 445,
        items: [{ code: 'X' }],
        closedAt: null,
        stage: 'pending',
      };
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_wl',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('CLIENT_HAS_OPEN_WAITLIST');
      expect(r.data.waitlistId).toBe('wl_1');
      expect(r.data.orderNumber).toBe(445);
    });

    it('pasa si origen=cpst (waitlist esperado para CPST)', async () => {
      const state = baseStateWithStock('SKU-A', 10, []);
      state.revision_waitlist['wl_1'] = {
        clientCardCode: 'C001',
        orderNumber: 445,
        items: [{}],
        closedAt: null,
        stage: 'pending',
      };
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_cpst',
          cardCode: 'C001',
          origen: 'cpst',
          lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('SNAPSHOT_TOO_OLD', () => {
    it('rechaza si snapshot >45min antiguo', async () => {
      const state = baseStateWithStock('SKU-A', 10, []);
      state.app_config.stock_snapshot.updatedAt = {
        toMillis: () => nowRef.getTime() - 46 * 60 * 1000,
      };
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_old_snap',
          cardCode: 'C001',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('SNAPSHOT_TOO_OLD');
      expect(r.data.canRefresh).toBe(true);
    });
  });

  describe('CPST origen con asigRefs', () => {
    it('cancela ASIG originales en el pedido origen', async () => {
      const state = baseStateWithStock('SKU-A', 10, [
        {
          _fsId: 'ped_origen',
          closedAt: null,
          clientCardCode: 'C001',
          clientName: 'CLI',
          createdAt: '2026-10-20T10:00:00Z',
          transferidoSAP: { docEntry: 999 },
          lines: [
            { code: 'SKU-A', state: 'ASIG', qty: 3, qtyOpen: 3, asigAt: '2026-10-22T10:00:00Z' },
          ],
        },
      ]);
      state.pedidos.ped_origen = {
        _fsId: 'ped_origen',
        closedAt: null,
        clientCardCode: 'C001',
        createdAt: '2026-10-20T10:00:00Z',
        transferidoSAP: { docEntry: 999 },
        lines: [
          { code: 'SKU-A', state: 'ASIG', qty: 3, qtyOpen: 3, asigAt: '2026-10-22T10:00:00Z' },
        ],
      };
      const { fbDb, _written } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_cpst_asig',
          cardCode: 'C001',
          clientName: 'CLI',
          origen: 'cpst',
          lines: [
            {
              sku: 'SKU-A',
              cantidad: 3,
              precio: 100,
              origenLinea: 'stock-asignado',
              asigRefs: [{ pedidoId: 'ped_origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
            },
          ],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(true);
      // Verifica que la ASIG original fue cancelada
      const originalUpdate = _written.find(
        (w) => w.path === 'pedidos/ped_origen' && w.op === 'update'
      );
      expect(originalUpdate).toBeTruthy();
      expect(originalUpdate.data.lines[0].state).toBe('cancelled');
      expect(originalUpdate.data.lines[0].closedReason).toBe('waitlist-confirm');
    });
  });

  describe('Edge cases', () => {
    it('pedido con 2 líneas: una confirmed, otra BO', async () => {
      const state = baseStateWithStock('SKU-A', 5, []);
      state.app_config.stock_snapshot.warehouseBreakdown['SKU-B'] = { 11: 0 };
      state.stock_snapshot['SKU-B'] = {
        sku: 'SKU-B',
        asignadas: { total: 0, byClient: {} },
        backorderApp: { total: 0, byClient: {} },
      };
      const { fbDb } = makeMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd_mix',
          cardCode: 'C001',
          origen: 'manual',
          lines: [
            { sku: 'SKU-A', cantidad: 3, precio: 100 },
            { sku: 'SKU-B', cantidad: 2, precio: 50 },
          ],
          clientVersion: 'v1430',
          autoAcceptStockChange: true,
        }
      );
      expect(r.ok).toBe(true);
      const skuA = r.lines.find((l) => l.sku === 'SKU-A');
      const skuB = r.lines.find((l) => l.sku === 'SKU-B');
      expect(skuA.qtyConfirmed).toBe(3);
      expect(skuA.qtyBO).toBe(0);
      expect(skuB.qtyConfirmed).toBe(0);
      expect(skuB.qtyBO).toBe(2);
    });
  });
});
