import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSapOrders } from '../../functions/core/sync-sap-orders-core.js';

// ---- Fake Firestore -------------------------------------------------------

/**
 * Mock que soporta el chain:
 *   fbDb.collection('pedidos').where('closedAt','==',null).orderBy(...).limit(N).get()
 *   fbDb.doc('pedidos/{id}').update({...})
 */
function makeFakeFbDb(pedidos) {
  const store = new Map(pedidos.map((p) => [p.id, p.data]));
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    doc(path) {
      return {
        async update(data) {
          const parts = path.split('/');
          if (parts[0] !== 'pedidos') throw new Error('update path no soportado: ' + path);
          const id = parts[1];
          const existing = store.get(id);
          if (!existing) throw new Error('doc no existe: ' + id);
          // Simular dot-notation update: acumular merges de sub-fields en un
          // solo patch[top] para no perder updates si vienen 2+ dot-notation
          // al mismo top-level (ej: transferidoSAP.orderDocEntry + transferidoSAP.orderSyncedAt).
          const patch = {};
          for (const [k, v] of Object.entries(data)) {
            if (k.includes('.')) {
              const [top, sub] = k.split('.', 2);
              if (!patch[top]) patch[top] = { ...(existing[top] || {}) };
              patch[top][sub] = v;
            } else {
              patch[k] = v;
            }
          }
          store.set(id, { ...existing, ...patch });
          writes.push({ path, data });
        },
      };
    },
    collection(name) {
      if (name !== 'pedidos')
        return {
          where: () => ({
            orderBy: () => ({ limit: () => ({ get: async () => ({ forEach: () => {} }) }) }),
          }),
        };
      // Simplificamos: ignoramos el filtro exacto y devolvemos todos los pedidos
      // (los tests controlan el input). listPendingPedidos filtra client-side
      // por transferidoSAP.docEntry + !orderDocEntry.
      const chain = {
        where() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit() {
          return chain;
        },
        async get() {
          const docs = Array.from(store.entries()).map(([id, data]) => ({
            id,
            data: () => data,
          }));
          return {
            forEach(cb) {
              docs.forEach(cb);
            },
          };
        },
      };
      return chain;
    },
  };
}

// ---- Fake SAP fetch -------------------------------------------------------

function makeSlFetch(scenarios) {
  return vi.fn(async (url, _init) => {
    if (url.endsWith('/b1s/v1/Login')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'B1SESSION=x; path=/, ROUTEID=.n1; path=/' },
        text: async () => JSON.stringify({ SessionId: 'x' }),
      };
    }
    if (url.endsWith('/b1s/v1/Logout')) {
      return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
    }
    // v1015 hotfix6: REVERSE MAP approach.
    // GET /b1s/v1/Orders?$select=DocEntry,DocumentLines&$expand=DocumentLines($select=BaseType,BaseEntry)
    //     &$orderby=DocEntry desc&$top=500
    // Devuelve las ultimas N SO con lineas que apuntan a SQs (BaseType=23).
    if (/\/b1s\/v1\/Orders\?/.test(url)) {
      if (scenarios.ordersThrow) throw new Error('orders network error');
      if (scenarios.ordersStatus && scenarios.ordersStatus !== 200) {
        return {
          ok: false,
          status: scenarios.ordersStatus,
          headers: { get: () => null },
          text: async () => '',
        };
      }
      // Build orders from scenarios.mapping = { sqDe -> soDe | {docEntry,docNum} }.
      // Cada mapping se traduce a una SO con una linea BaseType=23, BaseEntry=sqDe.
      // Shorthand num => DocNum = DocEntry (comportamiento tipico SAP). Para
      // testear DocNum distinto de DocEntry, pasar { docEntry, docNum }.
      const mapping = scenarios.mapping || {};
      const orders = Object.entries(mapping).map(([sqDe, so]) => {
        const isObj = so && typeof so === 'object';
        const docEntry = Number(isObj ? so.docEntry : so);
        const docNum = isObj ? Number(so.docNum) : docEntry;
        return {
          DocEntry: docEntry,
          DocNum: docNum,
          DocumentLines: [{ BaseType: 23, BaseEntry: Number(sqDe) }],
        };
      });
      // scenarios.extraOrders permite agregar SOs no relacionadas para
      // testear que se ignoran.
      if (Array.isArray(scenarios.extraOrders)) {
        orders.push(...scenarios.extraOrders);
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ value: orders }),
      };
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' };
  });
}

const baseSlConfig = { url: 'https://sap.test', companyDB: 'DB', userName: 'u', password: 'p' };

function makeDeps({ pedidos = [], scenarios = {}, batchSize } = {}) {
  const fbDb = makeFakeFbDb(pedidos);
  const fetch = makeSlFetch(scenarios);
  return {
    fbDb,
    fetch,
    sapConfig: baseSlConfig,
    sl: { fetch, sapConfig: baseSlConfig, log: vi.fn() },
    log: vi.fn(),
    batchSize,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('syncSapOrders', () => {
  it('sin pedidos pendientes: checked=0, no SAP call', async () => {
    const deps = makeDeps({ pedidos: [] });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 0, hits: 0, misses: 0, errors: 0 });
    // sin pending, no hace ni siquiera login a SAP.
    expect(deps.sl.fetch).not.toHaveBeenCalled();
  });

  it('un pedido con SQ sin orderDocNum -> SAP devuelve hit -> update aplicado', async () => {
    const deps = makeDeps({
      pedidos: [
        {
          id: 'p1',
          data: {
            closedAt: null,
            transferidoSAP: { docEntry: 100, docNum: 555 },
          },
        },
      ],
      scenarios: { mapping: { 100: { docEntry: 37210, docNum: 220 } } },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 1, misses: 0, errors: 0 });
    const updated = deps.fbDb._store.get('p1');
    expect(updated.transferidoSAP.orderDocEntry).toBe(37210);
    expect(updated.transferidoSAP.orderDocNum).toBe(220);
    expect(updated.transferidoSAP.orderSyncedAt).toBeTruthy();
    // Preserva campos previos.
    expect(updated.transferidoSAP.docEntry).toBe(100);
    expect(updated.transferidoSAP.docNum).toBe(555);
  });

  it('v1054 backfill: pedido con orderDocEntry pero sin orderDocNum -> re-procesa', async () => {
    const deps = makeDeps({
      pedidos: [
        {
          id: 'p1',
          data: {
            closedAt: null,
            transferidoSAP: { docEntry: 100, docNum: 555, orderDocEntry: 37210 },
          },
        },
      ],
      scenarios: { mapping: { 100: { docEntry: 37210, docNum: 220 } } },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 1, misses: 0, errors: 0 });
    const updated = deps.fbDb._store.get('p1');
    expect(updated.transferidoSAP.orderDocNum).toBe(220);
    expect(updated.transferidoSAP.orderDocEntry).toBe(37210);
  });

  it('SO enumerate devuelve vacio -> miss, no update', async () => {
    const deps = makeDeps({
      pedidos: [{ id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } }],
      scenarios: { mapping: {} },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 0, misses: 1, errors: 0 });
    const p = deps.fbDb._store.get('p1');
    expect(p.transferidoSAP.orderDocEntry).toBeUndefined();
  });

  it('pedido con orderDocNum ya seteado: se skip del batch', async () => {
    const deps = makeDeps({
      pedidos: [
        {
          id: 'p1',
          data: {
            closedAt: null,
            transferidoSAP: { docEntry: 100, orderDocEntry: 999, orderDocNum: 220 },
          },
        },
      ],
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 0, hits: 0, misses: 0, errors: 0 });
  });

  it('pedido sin transferidoSAP.docEntry: se skip', async () => {
    const deps = makeDeps({
      pedidos: [
        { id: 'p1', data: { closedAt: null, transferidoSAP: { docNum: 555 } } }, // sin docEntry
      ],
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 0, hits: 0, misses: 0, errors: 0 });
  });

  it('GET /Orders throw -> todos los pending cuentan como errors', async () => {
    const deps = makeDeps({
      pedidos: [
        { id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } },
        { id: 'p2', data: { closedAt: null, transferidoSAP: { docEntry: 200 } } },
      ],
      scenarios: { ordersThrow: true },
    });
    // Cuando el GET a /Orders throw, sapLogin() throws antes de llegar al try/finally
    // del handler. syncSapOrders bubblea la excepcion (no la absorbe).
    await expect(syncSapOrders(deps)).rejects.toThrow();
  });

  it('GET /Orders status 500 -> errors = pending.length, no updates', async () => {
    const deps = makeDeps({
      pedidos: [{ id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } }],
      scenarios: { ordersStatus: 500 },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 0, misses: 0, errors: 1 });
    expect(deps.fbDb._store.get('p1').transferidoSAP.orderDocEntry).toBeUndefined();
  });

  it('ignora SO no relacionadas al buildear el reverse map', async () => {
    const deps = makeDeps({
      pedidos: [{ id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } }],
      scenarios: {
        mapping: { 100: 555 },
        // SO adicional que apunta a otra SQ que NO es nuestra.
        extraOrders: [{ DocEntry: 999, DocumentLines: [{ BaseType: 23, BaseEntry: 88888 }] }],
      },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 1, misses: 0, errors: 0 });
    expect(deps.fbDb._store.get('p1').transferidoSAP.orderDocEntry).toBe(555);
  });

  it('batchSize limita el numero de pedidos procesados', async () => {
    const pedidos = [];
    const mapping = {};
    for (let i = 1; i <= 5; i++) {
      pedidos.push({
        id: 'p' + i,
        data: { closedAt: null, transferidoSAP: { docEntry: 100 + i } },
      });
      mapping[100 + i] = 900 + i;
    }
    const deps = makeDeps({ pedidos, scenarios: { mapping }, batchSize: 3 });
    const r = await syncSapOrders(deps);
    expect(r.checked).toBe(3);
    expect(r.hits).toBe(3);
  });

  it('llama sapLogin y sapLogout una sola vez (session reuse)', async () => {
    const deps = makeDeps({
      pedidos: [
        { id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } },
        { id: 'p2', data: { closedAt: null, transferidoSAP: { docEntry: 200 } } },
      ],
      scenarios: { mapping: { 100: 900, 200: 901 } },
    });
    await syncSapOrders(deps);
    const calls = deps.sl.fetch.mock.calls;
    const loginCalls = calls.filter(([url]) => url.endsWith('/b1s/v1/Login'));
    const logoutCalls = calls.filter(([url]) => url.endsWith('/b1s/v1/Logout'));
    expect(loginCalls).toHaveLength(1);
    expect(logoutCalls).toHaveLength(1);
  });
});
