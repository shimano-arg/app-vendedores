import { describe, expect, it, vi } from 'vitest';
import {
  fetchClosedQuotations,
  fetchQuotationsWithDerivedOrder,
  listCandidatePedidos,
  syncSapQuotationClosures,
} from '../../functions/core/sync-sap-quotation-closures-core.js';

// ---- Fake Firestore -------------------------------------------------------

function makeFbDb(pedidos) {
  const store = new Map(Object.entries(pedidos).map(([id, data]) => [id, { ...data }]));
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
      };
      return chain;
    },
    doc(path) {
      const id = path.replace(/^pedidos\//, '');
      return {
        async get() {
          const data = store.get(id);
          return { exists: !!data, data: () => data };
        },
        async update(patch) {
          const existing = store.get(id) || {};
          store.set(id, { ...existing, ...patch });
          writes.push({ id, patch });
        },
      };
    },
  };
}

// ---- Fake SAP SL fetch ----------------------------------------------------

function makeFetch({ closedQuotations = [], ordersWithBase = [] } = {}) {
  return async (url, init) => {
    const method = init?.method || 'GET';
    if (url.endsWith('/Login')) {
      return new Response(JSON.stringify({ SessionId: 's', SessionTimeout: 30 }), {
        status: 200,
        headers: { 'set-cookie': 'B1SESSION=s; path=/' },
      });
    }
    if (url.endsWith('/Logout') && method === 'POST') {
      return new Response('', { status: 204 });
    }
    if (url.includes('/Quotations?')) {
      const skipMatch = url.match(/\$skip=(\d+)/);
      const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
      const page = closedQuotations.slice(skip, skip + 20);
      return new Response(JSON.stringify({ value: page }), { status: 200 });
    }
    if (url.includes('/Orders?')) {
      const skipMatch = url.match(/\$skip=(\d+)/);
      const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
      const page = ordersWithBase.slice(skip, skip + 20);
      return new Response(JSON.stringify({ value: page }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected ' + url }), { status: 404 });
  };
}

function makeDeps(pedidos, sapMock = {}, extra = {}) {
  return {
    fetch: makeFetch(sapMock),
    sapConfig: { url: 'https://sap.test:50000', companyDB: 'test', userName: 'u', password: 'p' },
    fbDb: makeFbDb(pedidos),
    log: vi.fn(),
    closedLookahead: 100,
    batchSize: 100,
    now: () => new Date('2026-09-29T15:00:00Z'),
    ...extra,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('listCandidatePedidos', () => {
  it('excluye pedidos ya con orderDocEntry (SO ya asociada)', async () => {
    const deps = makeDeps({
      A: { closedAt: null, transferidoSAP: { docEntry: 100 } },
      B: { closedAt: null, transferidoSAP: { docEntry: 200, orderDocEntry: 999 } },
    });
    const c = await listCandidatePedidos(deps, 100);
    expect(c.map((x) => x.id)).toEqual(['A']);
  });

  it('excluye pedidos ya marcados closedManuallyInSap (idempotencia)', async () => {
    const deps = makeDeps({
      A: { closedAt: null, transferidoSAP: { docEntry: 100, closedManuallyInSap: true } },
      B: { closedAt: null, transferidoSAP: { docEntry: 200 } },
    });
    const c = await listCandidatePedidos(deps, 100);
    expect(c.map((x) => x.id)).toEqual(['B']);
  });

  it('excluye pedidos con paidStatus=paid o partial', async () => {
    const deps = makeDeps({
      A: { closedAt: null, transferidoSAP: { docEntry: 100 }, paidStatus: 'paid' },
      B: { closedAt: null, transferidoSAP: { docEntry: 200 }, paidStatus: 'partial' },
      C: { closedAt: null, transferidoSAP: { docEntry: 300 } },
    });
    const c = await listCandidatePedidos(deps, 100);
    expect(c.map((x) => x.id)).toEqual(['C']);
  });

  it('excluye pedidos con líneas facturadas (qtyInvoiced>0)', async () => {
    const deps = makeDeps({
      A: {
        closedAt: null,
        transferidoSAP: { docEntry: 100 },
        lines: [{ qtyInvoiced: 5 }],
      },
      B: { closedAt: null, transferidoSAP: { docEntry: 200 }, lines: [{ qtyInvoiced: 0 }] },
    });
    const c = await listCandidatePedidos(deps, 100);
    expect(c.map((x) => x.id)).toEqual(['B']);
  });
});

describe('fetchClosedQuotations', () => {
  it('devuelve Set con DocEntry de SQs bost_Close', async () => {
    const deps = makeDeps(
      {},
      {
        closedQuotations: [
          { DocEntry: 100, DocumentStatus: 'bost_Close', Cancelled: 'tNO' },
          { DocEntry: 200, DocumentStatus: 'bost_Close', Cancelled: 'tNO' },
        ],
      }
    );
    const res = await fetchClosedQuotations({ cookie: 'x' }, deps, 100);
    expect(res.ok).toBe(true);
    expect(res.closedSet.has(100)).toBe(true);
    expect(res.closedSet.has(200)).toBe(true);
    expect(res.scanned).toBe(2);
  });

  it('filtra client-side por status Cancelled=tYES', async () => {
    const deps = makeDeps(
      {},
      {
        closedQuotations: [
          { DocEntry: 100, DocumentStatus: 'bost_Close', Cancelled: 'tNO' },
          { DocEntry: 200, DocumentStatus: 'bost_Close', Cancelled: 'tYES' },
        ],
      }
    );
    const res = await fetchClosedQuotations({ cookie: 'x' }, deps, 100);
    expect(res.closedSet.has(100)).toBe(true);
    expect(res.closedSet.has(200)).toBe(false);
  });
});

describe('fetchQuotationsWithDerivedOrder (v1095 anti-race)', () => {
  it('devuelve Set con SQ docEntries que YA tienen SO derivada (BaseType=23)', async () => {
    const deps = makeDeps(
      {},
      {
        ordersWithBase: [
          { DocEntry: 500, DocumentLines: [{ BaseType: 23, BaseEntry: 100 }] },
          { DocEntry: 501, DocumentLines: [{ BaseType: 23, BaseEntry: 200 }] },
        ],
      }
    );
    const res = await fetchQuotationsWithDerivedOrder({ cookie: 'x' }, deps, 100);
    expect(res.ok).toBe(true);
    expect(res.derivedSqSet.has(100)).toBe(true);
    expect(res.derivedSqSet.has(200)).toBe(true);
  });

  it('ignora líneas con BaseType != 23', async () => {
    const deps = makeDeps(
      {},
      {
        ordersWithBase: [
          {
            DocEntry: 500,
            DocumentLines: [
              { BaseType: 17, BaseEntry: 999 }, // SO desde SO? no relevante
              { BaseType: 23, BaseEntry: 100 },
            ],
          },
        ],
      }
    );
    const res = await fetchQuotationsWithDerivedOrder({ cookie: 'x' }, deps, 100);
    expect(res.derivedSqSet.has(100)).toBe(true);
    expect(res.derivedSqSet.has(999)).toBe(false);
  });
});

describe('syncSapQuotationClosures — SOLEDAD race regression', () => {
  it('NO cierra SQs que están bost_Close por conversion a SO (anti-race v1095)', async () => {
    const deps = makeDeps(
      {
        // SOLEDAD: SQ 2000241 (docEntry 51942 → simplificado a 100)
        // fue convertida a SO 20056 (docEntry 500)
        soledad: {
          closedAt: null,
          transferidoSAP: { docEntry: 100, docNum: 2000241 },
          clientName: 'SOLEDAD SANCHEZ',
        },
        // Otra SQ genuinamente cerrada manualmente (sin SO)
        cancelada: {
          closedAt: null,
          transferidoSAP: { docEntry: 200, docNum: 2000242 },
          clientName: 'CLIENTE CANCELADO',
        },
      },
      {
        closedQuotations: [
          { DocEntry: 100, DocumentStatus: 'bost_Close', Cancelled: 'tNO' }, // SOLEDAD
          { DocEntry: 200, DocumentStatus: 'bost_Close', Cancelled: 'tNO' }, // CANCELADO
        ],
        ordersWithBase: [
          { DocEntry: 500, DocumentLines: [{ BaseType: 23, BaseEntry: 100 }] }, // SO 20056 desde SQ 100
        ],
      }
    );
    const result = await syncSapQuotationClosures(deps);
    expect(result.checked).toBe(2);
    expect(result.closedInApp).toBe(1); // solo CANCELADO cerrado, SOLEDAD skipped
    expect(deps.fbDb._store.get('soledad').closedAt).toBeNull();
    expect(deps.fbDb._store.get('soledad').closedReason).toBeUndefined();
    expect(deps.fbDb._store.get('cancelada').closedAt).not.toBeNull();
    expect(deps.fbDb._store.get('cancelada').closedReason).toBe('sap_manual_close');
  });

  it('sigue cerrando cuando no hay órdenes derivadas (comportamiento pre-v1095 preservado)', async () => {
    const deps = makeDeps(
      {
        pedidoA: {
          closedAt: null,
          transferidoSAP: { docEntry: 100 },
        },
      },
      {
        closedQuotations: [{ DocEntry: 100, DocumentStatus: 'bost_Close', Cancelled: 'tNO' }],
        ordersWithBase: [], // NO hay orders — cierre manual genuino
      }
    );
    const result = await syncSapQuotationClosures(deps);
    expect(result.closedInApp).toBe(1);
    expect(deps.fbDb._store.get('pedidoA').closedReason).toBe('sap_manual_close');
  });
});
