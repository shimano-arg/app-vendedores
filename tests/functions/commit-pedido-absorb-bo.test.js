// @ts-check
/**
 * §J (v1455 2026-10-25) — commitPedidoCore absorb BO integration.
 *
 * Verifica que:
 * - Cuando el cliente tiene BO vigente del mismo SKU, al confirmar nuevo
 *   pedido, el BO queda en max(qtyOpenBO - qtyConfirmed, 0).
 * - El pedido origen recibe `tx.update` con `lines` mutadas y `_backfill`.
 * - La response del CF incluye `absorptions[]` + `boAbsorbedTotal`.
 * - §58 ALL reads before writes: la tx no viola la invariante.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock Firestore strict: trackea reads/writes para verificar §58 implícito.
 */
function makeMockDb(fixture) {
  const state = fixture || {};
  const written = [];
  const txEvents = []; // orden de ops dentro de tx

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _path: key,
      async get() {
        const data = state[colName]?.[docId];
        return { exists: !!data, data: () => data || null };
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
      async add(data) {
        const id = 'auto_' + Math.random().toString(36).slice(2, 10);
        state[colName] ||= {};
        state[colName][id] = data;
        written.push({ op: 'add', path: `${colName}/${id}`, data });
        return { id };
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
      // STRICT §58: trackeo si hubo write; después de un write, un get tira.
      let hasWritten = false;
      const tx = {
        async get(ref) {
          if (hasWritten) {
            throw new Error('STRICT: tx.get after tx.write (viola §58 ALL reads before writes)');
          }
          txEvents.push({ op: 'get', path: ref._path });
          return ref.get();
        },
        set(ref, data) {
          hasWritten = true;
          txEvents.push({ op: 'set', path: ref._path });
          return ref.set(data);
        },
        update(ref, data) {
          hasWritten = true;
          txEvents.push({ op: 'update', path: ref._path });
          return ref.update(data);
        },
      };
      return fn(tx);
    },
  };
  return { fbDb, _state: state, _written: written, _txEvents: txEvents };
}

const nowRef = new Date('2026-10-25T12:00:00Z');

function baseStateWithStock(sku, fisico, pedidos = []) {
  const pedidosMap = {};
  for (const p of pedidos) pedidosMap[p._fsId || p.id || 'p1'] = p;
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
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
}

describe('§J absorb BO — integración commitPedidoCore', () => {
  it('absorbe un BO del mismo cliente+SKU y queda qtyOpen=0 (cancelled)', async () => {
    const pedidoBO = {
      _fsId: 'ped-BO-A',
      clientCardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-X',
          state: 'BO',
          qty: 5,
          qtyOpen: 5,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    const state = baseStateWithStock('SKU-X', 10, [pedidoBO]);
    const { fbDb, _state, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-abs-1',
        cardCode: 'C001',
        clientName: 'Cliente 1',
        origen: 'manual',
        lines: [{ sku: 'SKU-X', cantidad: 5, precio: 100 }],
        clientVersion: 'v1455',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.absorptions).toHaveLength(1);
    expect(r.absorptions[0]).toMatchObject({
      sku: 'SKU-X',
      cantidad: 5,
      pedidoIdOrigen: 'ped-BO-A',
      lineIndexOrigen: 0,
      qtyAntes: 5,
      qtyDespues: 0,
    });
    expect(r.boAbsorbedTotal).toBe(5);
    // Pedido BO quedó actualizado: line cancelled.
    const updatePed = _written.find((w) => w.op === 'update' && w.path === 'pedidos/ped-BO-A');
    expect(updatePed).toBeTruthy();
    expect(updatePed.data.lines[0].state).toBe('cancelled');
    expect(updatePed.data.lines[0].qtyOpen).toBe(0);
    expect(updatePed.data.lines[0].closedReason).toBe('absorbed_by_newer_confirmed');
    expect(updatePed.data._backfill).toBeTruthy();
    // El key de backfill empieza con J_bo_absorbed_
    const bfKeys = Object.keys(updatePed.data._backfill);
    expect(bfKeys.some((k) => k.startsWith('J_bo_absorbed_'))).toBe(true);
  });

  it('absorbe parcialmente: qtyOpen=5, qtyConfirmed=3 → BO queda qtyOpen=2', async () => {
    const pedidoBO = {
      _fsId: 'ped-BO-B',
      clientCardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-Y',
          state: 'BO',
          qty: 5,
          qtyOpen: 5,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 50,
        },
      ],
    };
    const state = baseStateWithStock('SKU-Y', 10, [pedidoBO]);
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-abs-2',
        cardCode: 'C001',
        clientName: 'Cliente 1',
        origen: 'manual',
        lines: [{ sku: 'SKU-Y', cantidad: 3, precio: 50 }],
        clientVersion: 'v1455',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.absorptions[0].qtyDespues).toBe(2);
    const updatePed = _written.find((w) => w.op === 'update' && w.path === 'pedidos/ped-BO-B');
    expect(updatePed.data.lines[0].state).toBe('BO');
    expect(updatePed.data.lines[0].qtyOpen).toBe(2);
    expect(updatePed.data.lines[0].partialCancelFrom).toBe('absorbed_by_newer_confirmed');
    expect(updatePed.data.lines[0].partialCancelQty).toBe(3);
  });

  it('NO absorbe si cardCode distinto', async () => {
    const pedidoBO = {
      _fsId: 'ped-BO-X',
      clientCardCode: 'C999', // DIFERENTE
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-Z',
          state: 'BO',
          qty: 5,
          qtyOpen: 5,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    const state = baseStateWithStock('SKU-Z', 10, [pedidoBO]);
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-abs-3',
        cardCode: 'C001', // cliente distinto
        clientName: 'Cliente 1',
        origen: 'manual',
        lines: [{ sku: 'SKU-Z', cantidad: 3, precio: 100 }],
        clientVersion: 'v1455',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.absorptions).toEqual([]);
    expect(r.boAbsorbedTotal).toBe(0);
    const updatePed = _written.find((w) => w.op === 'update' && w.path === 'pedidos/ped-BO-X');
    expect(updatePed).toBeUndefined();
  });

  it('FIFO: absorbe primero el BO más viejo', async () => {
    const pedidoOld = {
      _fsId: 'ped-OLD',
      clientCardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-F',
          state: 'BO',
          qty: 3,
          qtyOpen: 3,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    const pedidoNew = {
      _fsId: 'ped-NEW',
      clientCardCode: 'C001',
      createdAt: '2026-10-20T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-F',
          state: 'BO',
          qty: 10,
          qtyOpen: 10,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    const state = baseStateWithStock('SKU-F', 20, [pedidoNew, pedidoOld]);
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-abs-4',
        cardCode: 'C001',
        clientName: 'Cliente 1',
        origen: 'manual',
        lines: [{ sku: 'SKU-F', cantidad: 5, precio: 100 }],
        clientVersion: 'v1455',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.absorptions).toHaveLength(2);
    // Primero el viejo.
    expect(r.absorptions[0].pedidoIdOrigen).toBe('ped-OLD');
    expect(r.absorptions[0].cantidad).toBe(3);
    expect(r.absorptions[1].pedidoIdOrigen).toBe('ped-NEW');
    expect(r.absorptions[1].cantidad).toBe(2);
    // Dos pedidos recibieron update.
    const updates = _written.filter((w) => w.op === 'update' && w.path.startsWith('pedidos/ped-'));
    expect(updates).toHaveLength(2);
  });

  it('§58: todos los tx.get antes de los tx.set/update (verifica mock STRICT)', async () => {
    const pedidoBO = {
      _fsId: 'ped-BO-C',
      clientCardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-W',
          state: 'BO',
          qty: 5,
          qtyOpen: 5,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    const state = baseStateWithStock('SKU-W', 10, [pedidoBO]);
    const { fbDb, _txEvents } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-abs-5',
        cardCode: 'C001',
        clientName: 'Cliente 1',
        origen: 'manual',
        lines: [{ sku: 'SKU-W', cantidad: 2, precio: 100 }],
        clientVersion: 'v1455',
      }
    );
    expect(r.ok).toBe(true);
    // Encuentra el índice del primer write.
    const firstWriteIdx = _txEvents.findIndex((e) => e.op === 'set' || e.op === 'update');
    // Después del primer write NO debe haber ningún get.
    const postWriteGets = _txEvents.slice(firstWriteIdx).filter((e) => e.op === 'get');
    expect(postWriteGets).toEqual([]);
  });

  it('no absorbe cuando qtyBO del nuevo pedido > 0 pero qtyConfirmed = 0 (sin stock)', async () => {
    const pedidoBO = {
      _fsId: 'ped-BO-D',
      clientCardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-N',
          state: 'BO',
          qty: 5,
          qtyOpen: 5,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    // Fisico=0 → el nuevo pedido va 100% BO.
    const state = baseStateWithStock('SKU-N', 0, [pedidoBO]);
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-abs-6',
        cardCode: 'C001',
        clientName: 'Cliente 1',
        origen: 'manual',
        autoAcceptStockChange: true, // sin este flag tiraría STOCK_CHANGED
        lines: [{ sku: 'SKU-N', cantidad: 3, precio: 100 }],
        clientVersion: 'v1455',
      }
    );
    expect(r.ok).toBe(true);
    // Como qtyConfirmed=0, NO hay absorción (hipótesis S1 solo cuenta lo
    // que el cliente efectivamente recibe en ESTE pedido).
    expect(r.absorptions).toEqual([]);
    expect(r.boAbsorbedTotal).toBe(0);
    const updatePed = _written.find((w) => w.op === 'update' && w.path === 'pedidos/ped-BO-D');
    expect(updatePed).toBeUndefined();
  });

  it('idempotente: 2do commit con mismo draftId NO reaplica (idempotent hit)', async () => {
    const pedidoBO = {
      _fsId: 'ped-BO-E',
      clientCardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: null,
      lines: [
        {
          code: 'SKU-I',
          state: 'BO',
          qty: 5,
          qtyOpen: 5,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    const state = baseStateWithStock('SKU-I', 10, [pedidoBO]);
    const { fbDb, _written } = makeMockDb(state);
    // Pre-cargar pedido ya creado con _draftId (simular 1er commit).
    state.pedidos['existing-ped'] = {
      _draftId: 'd-idem',
      clientCardCode: 'C001',
      lines: [
        {
          code: 'SKU-I',
          state: 'confirmed',
          qty: 3,
          qtyOpen: 3,
          qtyCancelled: 0,
          qtyInvoiced: 0,
          precio: 100,
        },
      ],
    };
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-idem',
        cardCode: 'C001',
        clientName: 'Cliente 1',
        origen: 'manual',
        lines: [{ sku: 'SKU-I', cantidad: 3, precio: 100 }],
        clientVersion: 'v1455',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.idempotentHit).toBe(true);
    // El pedido BO NO fue actualizado (idempotency fast-path).
    const updatePed = _written.find((w) => w.op === 'update' && w.path === 'pedidos/ped-BO-E');
    expect(updatePed).toBeUndefined();
  });
});
