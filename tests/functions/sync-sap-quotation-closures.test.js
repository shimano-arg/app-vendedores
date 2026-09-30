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
          // Soporta dot-notation ("transferidoSAP.orderDocEntry") como
          // sub-field merge (same behavior que Firestore Admin update()).
          const merged = { ...existing };
          for (const [k, v] of Object.entries(patch)) {
            if (k.includes('.')) {
              const [top, sub] = k.split('.', 2);
              merged[top] = { ...(merged[top] || {}), [sub]: v };
            } else {
              merged[k] = v;
            }
          }
          store.set(id, merged);
          writes.push({ id, patch });
        },
      };
    },
  };
}

// ---- Fake SAP SL fetch ----------------------------------------------------

function makeFetch({
  closedQuotations = [],
  ordersWithBase = [],
  numAtCardMapping = {},
} = {}) {
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
      // v1102: filter NumAtCard eq 'pedidoId' — anti-race guard.
      const decoded = decodeURIComponent(url);
      const nacMatch = decoded.match(/NumAtCard\s+eq\s+'([^']+)'/);
      if (nacMatch) {
        const pedidoId = nacMatch[1];
        const so = numAtCardMapping[pedidoId];
        const value = so ? [so] : [];
        return new Response(JSON.stringify({ value }), { status: 200 });
      }
      // Fallback: reverse scan (v1095 legacy — usado por tests de
      // fetchQuotationsWithDerivedOrder).
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

  it('incluye pedidos ya marcados closedManuallyInSap para race-victim recheck (v1102)', async () => {
    const deps = makeDeps({
      A: { closedAt: null, transferidoSAP: { docEntry: 100, closedManuallyInSap: true } },
      B: { closedAt: null, transferidoSAP: { docEntry: 200 } },
    });
    const c = await listCandidatePedidos(deps, 100);
    // v1102: A entra como candidato con alreadyClosed=true — el handler hará
    // recheck vía NumAtCard y salvará el pedido si fue race victim de v1095.
    const ids = c.map((x) => x.id).sort();
    expect(ids).toEqual(['A', 'B']);
    const A = c.find((x) => x.id === 'A');
    expect(A.alreadyClosed).toBe(true);
    const B = c.find((x) => x.id === 'B');
    expect(B.alreadyClosed).toBe(false);
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
        // v1102: anti-race por NumAtCard — SOLEDAD tiene SO derivada, CANCELADO no.
        numAtCardMapping: {
          soledad: { DocEntry: 500, DocNum: 20056 },
        },
      }
    );
    const result = await syncSapQuotationClosures(deps);
    expect(result.checked).toBe(2);
    expect(result.closedInApp).toBe(1); // solo CANCELADO cerrado, SOLEDAD race-victim salvage
    expect(deps.fbDb._store.get('soledad').closedAt).toBeNull();
    expect(deps.fbDb._store.get('soledad').closedReason).toBeUndefined();
    // v1102: SOLEDAD ahora se salva poblando orderDocEntry automáticamente.
    expect(deps.fbDb._store.get('soledad').transferidoSAP['orderDocEntry']).toBe(500);
    expect(deps.fbDb._store.get('soledad').transferidoSAP['orderDocNum']).toBe(20056);
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
