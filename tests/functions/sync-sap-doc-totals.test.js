import { describe, expect, it, vi } from 'vitest';
import {
  applyDocTotalUpdate,
  handleSyncSapDocTotals,
  listCandidatePedidos,
} from '../../functions/core/sync-sap-doc-totals-core.js';

// ---- Fake Firestore -------------------------------------------------------

function makeFakeFbDb(pedidos) {
  const store = new Map(pedidos.map((p) => [p.id, { ...p.data }]));
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    collection(name) {
      if (name !== 'pedidos') throw new Error('collection no soportada: ' + name);
      const chain = {
        where() {
          return chain;
        },
        async get() {
          const docs = Array.from(store.entries()).map(([id, data]) => ({ id, data: () => data }));
          return {
            forEach(cb) {
              docs.forEach(cb);
            },
          };
        },
        doc(id) {
          return {
            async update(patch) {
              const existing = store.get(id);
              if (!existing) throw new Error('doc no existe: ' + id);
              store.set(id, { ...existing, ...patch });
              writes.push({ id, patch });
            },
          };
        },
      };
      return chain;
    },
  };
}

// ---- Fake SAP fetch -------------------------------------------------------

/**
 * Mock del SL. Devuelve /Quotations y /Orders paginados desde los maps.
 */
function makeFakeFetch(quotationsByDocEntry, ordersByDocEntry) {
  const sqArr = Object.entries(quotationsByDocEntry)
    .map(([de, info]) => ({ DocEntry: Number(de), DocNum: info.docNum, DocTotal: info.docTotal }))
    .sort((a, b) => b.DocEntry - a.DocEntry);
  const soArr = Object.entries(ordersByDocEntry)
    .map(([de, info]) => ({ DocEntry: Number(de), DocNum: info.docNum, DocTotal: info.docTotal }))
    .sort((a, b) => b.DocEntry - a.DocEntry);

  return async (url, init) => {
    const method = init?.method || 'GET';
    if (url.endsWith('/Login')) {
      return new Response(JSON.stringify({ SessionId: 'sess-test', SessionTimeout: 30 }), {
        status: 200,
        headers: { 'set-cookie': 'B1SESSION=sess-test; path=/' },
      });
    }
    if (url.endsWith('/Logout') && method === 'POST') {
      return new Response('', { status: 204 });
    }
    if (url.includes('/Quotations?') || url.includes('/Orders?')) {
      const arr = url.includes('/Quotations?') ? sqArr : soArr;
      const skipMatch = url.match(/\$skip=(\d+)/);
      const topMatch = url.match(/\$top=(\d+)/);
      const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
      const top = topMatch ? parseInt(topMatch[1], 10) : 20;
      const page = arr.slice(skip, skip + top);
      return new Response(JSON.stringify({ value: page }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected url ' + url }), { status: 404 });
  };
}

function makeDeps(pedidos, quotationsByDocEntry, ordersByDocEntry, extraOpts = {}) {
  return {
    fetch: makeFakeFetch(quotationsByDocEntry, ordersByDocEntry),
    sapConfig: { url: 'https://sap.test:50000', companyDB: 'test', userName: 'u', password: 'p' },
    fbDb: makeFakeFbDb(pedidos),
    log: vi.fn(),
    lookahead: 100,
    ...extraOpts,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('listCandidatePedidos', () => {
  it('incluye pedidos con transferidoSAP.docNum y closedAt=null y paidStatus!=paid', async () => {
    const deps = makeDeps(
      [
        {
          id: 'A',
          data: { transferidoSAP: { docNum: 2000212, docEntry: 51692 }, closedAt: null },
        },
        {
          id: 'B',
          data: { transferidoSAP: { docNum: 2000213 }, closedAt: null, paidStatus: 'paid' },
        },
        { id: 'C', data: { transferidoSAP: { docNum: 2000214 }, closedAt: 'someIso' } },
        { id: 'D', data: { closedAt: null } },
      ],
      {},
      {}
    );
    const out = await listCandidatePedidos(deps);
    expect(out.map((x) => x.id)).toEqual(['A']);
  });
});

describe('applyDocTotalUpdate', () => {
  it('prioriza SO cuando orderDocEntry existe y está en soMap', async () => {
    const deps = makeDeps(
      [
        {
          id: 'P1',
          data: { transferidoSAP: { docNum: 2000212, docEntry: 51692, orderDocEntry: 37192 } },
        },
      ],
      {},
      {}
    );
    const sqMap = new Map([[51692, 822800]]);
    const soMap = new Map([[37192, 822800]]);
    const r = await applyDocTotalUpdate(deps, 'P1', deps.fbDb._store.get('P1'), sqMap, soMap);
    expect(r).toMatchObject({ updated: true, missed: false, source: 'SO', docTotal: 822800 });
    expect(deps.fbDb._writes).toHaveLength(1);
    expect(deps.fbDb._writes[0].patch).toMatchObject({
      sapDocTotal: 822800,
      sapDocTotalSource: 'SO',
    });
  });

  it('fallback a SQ cuando orderDocEntry es null', async () => {
    const deps = makeDeps(
      [{ id: 'P1', data: { transferidoSAP: { docNum: 2000212, docEntry: 51692 } } }],
      {},
      {}
    );
    const sqMap = new Map([[51692, 500000]]);
    const soMap = new Map();
    const r = await applyDocTotalUpdate(deps, 'P1', deps.fbDb._store.get('P1'), sqMap, soMap);
    expect(r).toMatchObject({ source: 'SQ', docTotal: 500000, updated: true });
  });

  it('marca missed cuando ni SO ni SQ están en los maps', async () => {
    const deps = makeDeps(
      [{ id: 'P1', data: { transferidoSAP: { docNum: 2000212, docEntry: 51692 } } }],
      {},
      {}
    );
    const r = await applyDocTotalUpdate(
      deps,
      'P1',
      deps.fbDb._store.get('P1'),
      new Map(),
      new Map()
    );
    expect(r).toMatchObject({ updated: false, missed: true, source: null, docTotal: null });
    expect(deps.fbDb._writes).toHaveLength(0);
  });

  it('delta write: no escribe si sapDocTotal y source no cambiaron', async () => {
    const deps = makeDeps(
      [
        {
          id: 'P1',
          data: {
            transferidoSAP: { docNum: 2000212, docEntry: 51692, orderDocEntry: 37192 },
            sapDocTotal: 822800,
            sapDocTotalSource: 'SO',
          },
        },
      ],
      {},
      {}
    );
    const r = await applyDocTotalUpdate(
      deps,
      'P1',
      deps.fbDb._store.get('P1'),
      new Map(),
      new Map([[37192, 822800]])
    );
    expect(r).toMatchObject({ updated: false, missed: false });
    expect(deps.fbDb._writes).toHaveLength(0);
  });
});

describe('handleSyncSapDocTotals — MAXERA case regression', () => {
  it('escribe sapDocTotal=822800 desde SO para el pedido MAXERA orden 204', async () => {
    const maxeraPedido = {
      id: 'GnA4zn5B3pzj9V3CmtaP',
      data: {
        transferidoSAP: {
          docNum: 2000212,
          docEntry: 51692,
          orderDocEntry: 37192,
          orderDocNum: 19982,
        },
        closedAt: null,
        clientName: 'ALBERTO MAXERA',
        netAmountArs: 1526000,
      },
    };
    const deps = makeDeps(
      [maxeraPedido],
      { 51692: { docNum: 2000212, docTotal: 822800 } }, // SQ mismo total que SO
      { 37192: { docNum: 19982, docTotal: 822800 } } // SO — este es el que gana por prioridad
    );

    const result = await handleSyncSapDocTotals(deps);

    expect(result.pedidosChecked).toBe(1);
    expect(result.pedidosUpdated).toBe(1);
    expect(result.pedidosFromSO).toBe(1);
    expect(result.pedidosFromSQ).toBe(0);
    expect(result.pedidosMissed).toBe(0);

    const stored = deps.fbDb._store.get(maxeraPedido.id);
    expect(stored.sapDocTotal).toBe(822800);
    expect(stored.sapDocTotalSource).toBe('SO');
    expect(typeof stored.sapDocTotalSyncedAt).toBe('string');
  });

  it('resultado sin errores cuando la lista de pedidos está vacía', async () => {
    const deps = makeDeps([], {}, {});
    const result = await handleSyncSapDocTotals(deps);
    expect(result).toMatchObject({
      pedidosChecked: 0,
      sqScanned: 0,
      soScanned: 0,
      pedidosUpdated: 0,
      errors: 0,
    });
  });

  it('caso mezclado: 2 pedidos, uno con SO+SQ, otro con SQ solo, un tercero missed', async () => {
    const deps = makeDeps(
      [
        {
          id: 'has-SO',
          data: {
            transferidoSAP: { docNum: 2000212, docEntry: 51692, orderDocEntry: 37192 },
            closedAt: null,
          },
        },
        {
          id: 'sq-only',
          data: { transferidoSAP: { docNum: 2000213, docEntry: 51693 }, closedAt: null },
        },
        {
          id: 'missed',
          data: { transferidoSAP: { docNum: 2000999, docEntry: 99999 }, closedAt: null },
        },
      ],
      {
        51692: { docNum: 2000212, docTotal: 800000 },
        51693: { docNum: 2000213, docTotal: 500000 },
      },
      { 37192: { docNum: 19982, docTotal: 822800 } }
    );

    const result = await handleSyncSapDocTotals(deps);
    expect(result.pedidosChecked).toBe(3);
    expect(result.pedidosFromSO).toBe(1);
    expect(result.pedidosFromSQ).toBe(1);
    expect(result.pedidosMissed).toBe(1);
    expect(result.pedidosUpdated).toBe(2);
    expect(deps.fbDb._store.get('has-SO').sapDocTotal).toBe(822800);
    expect(deps.fbDb._store.get('sq-only').sapDocTotal).toBe(500000);
    expect(deps.fbDb._store.get('missed').sapDocTotal).toBeUndefined();
  });
});
