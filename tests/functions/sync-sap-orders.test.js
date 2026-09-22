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
    // GET /b1s/v1/Orders?$filter=DocumentLines/any(l:l/BaseEntry eq X and l/BaseType eq 23)&$select=DocEntry&$top=1
    // El filter viene URL-encoded (encodeURIComponent). Decodificamos para
    // que el regex pueda leer el sqDocEntry.
    const decoded = decodeURIComponent(url);
    const m = decoded.match(/BaseEntry\s+eq\s+(\d+)/);
    if (m && /\/b1s\/v1\/Orders\?/.test(url)) {
      const sqDocEntry = Number(m[1]);
      if (scenarios.throwOn && scenarios.throwOn.includes(sqDocEntry)) {
        throw new Error('network error');
      }
      if (scenarios.status500On && scenarios.status500On.includes(sqDocEntry)) {
        return { ok: false, status: 500, headers: { get: () => null }, text: async () => '' };
      }
      const orderDocEntry = scenarios.mapping && scenarios.mapping[sqDocEntry];
      if (orderDocEntry) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ value: [{ DocEntry: orderDocEntry }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ value: [] }),
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

  it('un pedido con SQ sin orderDocEntry -> SAP devuelve hit -> update aplicado', async () => {
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
      scenarios: { mapping: { 100: 777 } },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 1, misses: 0, errors: 0 });
    const updated = deps.fbDb._store.get('p1');
    expect(updated.transferidoSAP.orderDocEntry).toBe(777);
    expect(updated.transferidoSAP.orderSyncedAt).toBeTruthy();
    // Preserva campos previos.
    expect(updated.transferidoSAP.docEntry).toBe(100);
    expect(updated.transferidoSAP.docNum).toBe(555);
  });

  it('SAP no tiene SO todavia (value: []) -> miss, no update', async () => {
    const deps = makeDeps({
      pedidos: [{ id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } }],
      scenarios: { mapping: {} },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 0, misses: 1, errors: 0 });
    const p = deps.fbDb._store.get('p1');
    expect(p.transferidoSAP.orderDocEntry).toBeUndefined();
  });

  it('pedido con orderDocEntry ya seteado: se skip del batch', async () => {
    const deps = makeDeps({
      pedidos: [
        {
          id: 'p1',
          data: {
            closedAt: null,
            transferidoSAP: { docEntry: 100, orderDocEntry: 999 },
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

  it('GET SAP throw en un pedido -> errors=1, sigue con siguiente', async () => {
    const deps = makeDeps({
      pedidos: [
        { id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } },
        { id: 'p2', data: { closedAt: null, transferidoSAP: { docEntry: 200 } } },
      ],
      scenarios: { throwOn: [100], mapping: { 200: 888 } },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 2, hits: 1, misses: 0, errors: 1 });
    expect(deps.fbDb._store.get('p1').transferidoSAP.orderDocEntry).toBeUndefined();
    expect(deps.fbDb._store.get('p2').transferidoSAP.orderDocEntry).toBe(888);
  });

  it('GET SAP status 500 en un pedido -> errors=1, sigue', async () => {
    const deps = makeDeps({
      pedidos: [{ id: 'p1', data: { closedAt: null, transferidoSAP: { docEntry: 100 } } }],
      scenarios: { status500On: [100] },
    });
    const r = await syncSapOrders(deps);
    expect(r).toEqual({ checked: 1, hits: 0, misses: 0, errors: 1 });
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
