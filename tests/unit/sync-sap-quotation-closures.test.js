// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import {
  fetchClosedQuotations,
  listCandidatePedidos,
  syncSapQuotationClosures,
} from '../../functions/core/sync-sap-quotation-closures-core.js';

const dummySession = { cookie: 'B1SESSION=abc' };

/**
 * Mock Firestore mínimo. `docs` es {[docId]: data}.
 * Soporta: db.collection(name).where(field, op, val).get()
 *          db.doc(path).get() / .update(patch)
 */
function makeFbDb(docs = {}) {
  const store = { ...docs };
  const calls = { updates: [] };
  const collectionAPI = (_colName) => ({
    where(field, op, val) {
      if (field !== 'closedAt' || op !== '==' || val !== null) {
        throw new Error(`unsupported where(${field},${op},${val})`);
      }
      return {
        async get() {
          const arr = [];
          for (const [id, data] of Object.entries(store)) {
            if (data.closedAt) continue;
            arr.push({ id, data: () => data });
          }
          return { forEach: (fn) => arr.forEach(fn), size: arr.length };
        },
      };
    },
  });
  const docAPI = (path) => {
    const [col, id] = path.split('/');
    if (col !== 'pedidos') throw new Error(`unsupported doc path ${path}`);
    return {
      async get() {
        const data = store[id];
        return {
          exists: !!data,
          data: () => data || null,
        };
      },
      async update(patch) {
        if (!store[id]) throw new Error(`doc gone ${id}`);
        // Simular merge parcial + nested (Firestore usa dot-notation, acá
        // el core usa full object replace via spread, así que replicamos eso).
        store[id] = { ...store[id], ...patch };
        calls.updates.push({ id, patch });
      },
    };
  };
  return {
    db: {
      collection: collectionAPI,
      doc: docAPI,
    },
    store,
    calls,
  };
}

function makeSapFetch({ pages = [[]], httpStatus = 200, throwErr = null } = {}) {
  const calls = [];
  let pageIdx = 0;
  return {
    fetch: vi.fn(async (url) => {
      calls.push(url);
      if (throwErr) throw throwErr;
      // Login endpoint (para syncSapQuotationClosures, no para fetchClosedQuotations solo)
      if (String(url).includes('/Login')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({}),
          headers: { get: () => 'B1SESSION=abc' },
        };
      }
      if (String(url).includes('/Logout')) {
        return {
          ok: true,
          status: 204,
          text: async () => '',
          headers: { get: () => null },
        };
      }
      const page = pages[pageIdx] || [];
      pageIdx++;
      const body = { value: page };
      return {
        ok: httpStatus >= 200 && httpStatus < 300,
        status: httpStatus,
        text: async () => JSON.stringify(body),
        headers: { get: () => null },
      };
    }),
    calls,
  };
}

const sapConfig = { url: 'https://sap.x', companyDB: 'DB', userName: 'u', password: 'p' };

describe('listCandidatePedidos', () => {
  it('retorna vacio si no hay pedidos', async () => {
    const { db } = makeFbDb();
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res).toEqual([]);
  });

  it('excluye pedidos cerrados (closedAt seteado)', async () => {
    const { db } = makeFbDb({
      A: { transferidoSAP: { docEntry: 1 }, closedAt: '2026-09-20T00:00:00Z' },
      B: { transferidoSAP: { docEntry: 2 } },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('B');
  });

  it('excluye pedidos sin transferidoSAP.docEntry', async () => {
    const { db } = makeFbDb({
      A: {}, // sin transferidoSAP
      B: { transferidoSAP: {} }, // sin docEntry
      C: { transferidoSAP: { docEntry: 3 } },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res.map((r) => r.id)).toEqual(['C']);
  });

  it('excluye pedidos con orderDocEntry (ya convertidos a SO)', async () => {
    const { db } = makeFbDb({
      A: { transferidoSAP: { docEntry: 1, orderDocEntry: 999 } },
      B: { transferidoSAP: { docEntry: 2 } },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res.map((r) => r.id)).toEqual(['B']);
  });

  it('excluye pedidos ya marcados closedManuallyInSap (idempotencia)', async () => {
    const { db } = makeFbDb({
      A: { transferidoSAP: { docEntry: 1, closedManuallyInSap: true } },
      B: { transferidoSAP: { docEntry: 2 } },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res.map((r) => r.id)).toEqual(['B']);
  });

  it('excluye pedidos con paidStatus partial/paid', async () => {
    const { db } = makeFbDb({
      A: { transferidoSAP: { docEntry: 1 }, paidStatus: 'partial' },
      B: { transferidoSAP: { docEntry: 2 }, paidStatus: 'paid' },
      C: { transferidoSAP: { docEntry: 3 } },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res.map((r) => r.id)).toEqual(['C']);
  });

  it('excluye pedidos con alguna line con qtyInvoiced > 0', async () => {
    const { db } = makeFbDb({
      A: {
        transferidoSAP: { docEntry: 1 },
        lines: [{ qtyInvoiced: 0 }, { qtyInvoiced: 3 }],
      },
      B: {
        transferidoSAP: { docEntry: 2 },
        lines: [{ qtyInvoiced: 0 }],
      },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res.map((r) => r.id)).toEqual(['B']);
  });

  it('respeta fallback `items` cuando `lines` no está', async () => {
    const { db } = makeFbDb({
      A: {
        transferidoSAP: { docEntry: 1 },
        items: [{ qtyInvoiced: 5 }], // legacy schema
      },
      B: {
        transferidoSAP: { docEntry: 2 },
        items: [{ qtyInvoiced: 0 }],
      },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 100);
    expect(res.map((r) => r.id)).toEqual(['B']);
  });

  it('ordena por sqDocEntry asc y respeta limit', async () => {
    const { db } = makeFbDb({
      A: { transferidoSAP: { docEntry: 200 } },
      B: { transferidoSAP: { docEntry: 100 } },
      C: { transferidoSAP: { docEntry: 300 } },
    });
    const res = await listCandidatePedidos({ fbDb: db }, 2);
    expect(res.map((r) => r.sqDocEntry)).toEqual([100, 200]);
  });
});

describe('fetchClosedQuotations', () => {
  it('retorna Set vacío + scanned 0 cuando SAP devuelve página vacía', async () => {
    const { fetch } = makeSapFetch({ pages: [[]] });
    const res = await fetchClosedQuotations(dummySession, { fetch, sapConfig, log: () => {} }, 100);
    expect(res.ok).toBe(true);
    expect(res.closedSet.size).toBe(0);
    expect(res.scanned).toBe(0);
  });

  it('parsea DocEntry de páginas de 20 (SL default page size)', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({
      DocEntry: 1000 + i,
      DocumentStatus: 'bost_Close',
      Cancelled: 'tNO',
    }));
    const page2 = [
      { DocEntry: 1020, DocumentStatus: 'bost_Close', Cancelled: 'tNO' },
      { DocEntry: 1021, DocumentStatus: 'bost_Close', Cancelled: 'tNO' },
    ];
    const { fetch } = makeSapFetch({ pages: [page1, page2] });
    const res = await fetchClosedQuotations(dummySession, { fetch, sapConfig, log: () => {} }, 40);
    expect(res.ok).toBe(true);
    expect(res.closedSet.size).toBe(22);
    expect(res.closedSet.has(1000)).toBe(true);
    expect(res.closedSet.has(1021)).toBe(true);
    expect(res.scanned).toBe(22);
  });

  it('defensa doble: descarta rows con Cancelled=tYES aunque el filter debería excluirlos', async () => {
    const page = [
      { DocEntry: 1, DocumentStatus: 'bost_Close', Cancelled: 'tNO' },
      { DocEntry: 2, DocumentStatus: 'bost_Close', Cancelled: 'tYES' }, // el filter debería haberlo excluido
      { DocEntry: 3, DocumentStatus: 'bost_Open', Cancelled: 'tNO' }, // idem
    ];
    const { fetch } = makeSapFetch({ pages: [page] });
    const res = await fetchClosedQuotations(dummySession, { fetch, sapConfig, log: () => {} }, 20);
    expect(res.ok).toBe(true);
    expect(res.closedSet.size).toBe(1);
    expect(res.closedSet.has(1)).toBe(true);
  });

  it('corta la paginación al recibir página vacía', async () => {
    const page1 = [{ DocEntry: 1, DocumentStatus: 'bost_Close', Cancelled: 'tNO' }];
    const { fetch, calls } = makeSapFetch({ pages: [page1, []] });
    const res = await fetchClosedQuotations(
      dummySession,
      { fetch, sapConfig, log: () => {} },
      100 // lookahead grande — que corte por página vacía, no por lookahead
    );
    expect(res.ok).toBe(true);
    expect(calls.length).toBe(2); // page1 + página vacía
  });

  it('devuelve ok:false ante SL 500', async () => {
    const { fetch } = makeSapFetch({ httpStatus: 500, pages: [[]] });
    const res = await fetchClosedQuotations(dummySession, { fetch, sapConfig, log: () => {} }, 20);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });

  it('devuelve ok:false ante fetch throw', async () => {
    const { fetch } = makeSapFetch({ throwErr: new Error('ECONNRESET') });
    const res = await fetchClosedQuotations(dummySession, { fetch, sapConfig, log: () => {} }, 20);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('ECONNRESET');
  });
});

describe('syncSapQuotationClosures (integration)', () => {
  it('no consulta SAP si no hay candidatos', async () => {
    const { db } = makeFbDb();
    const { fetch, calls } = makeSapFetch({ pages: [[]] });
    const res = await syncSapQuotationClosures({
      fetch,
      sapConfig,
      fbDb: db,
      log: () => {},
    });
    expect(res).toEqual({ checked: 0, closedInApp: 0, sapClosedScanned: 0, errors: 0 });
    expect(calls.length).toBe(0); // ni Login siquiera
  });

  it('cierra pedidos cuya SQ está en SAP como bost_Close', async () => {
    const { db, store, calls } = makeFbDb({
      P_CLOSED: {
        transferidoSAP: { docEntry: 100, docNum: 1234 },
        lines: [{ qtyInvoiced: 0 }],
      },
      P_STILL_OPEN: {
        // Su SQ está abierta en SAP → no debe cerrarse.
        transferidoSAP: { docEntry: 200, docNum: 5678 },
        lines: [{ qtyInvoiced: 0 }],
      },
    });
    const nowIso = '2026-09-24T00:00:00.000Z';
    const { fetch } = makeSapFetch({
      pages: [[{ DocEntry: 100, DocumentStatus: 'bost_Close', Cancelled: 'tNO' }], []],
    });
    const res = await syncSapQuotationClosures({
      fetch,
      sapConfig,
      fbDb: db,
      log: () => {},
      now: () => new Date(nowIso),
    });
    expect(res.closedInApp).toBe(1);
    expect(res.checked).toBe(2);
    expect(store.P_CLOSED.closedAt).toBe(nowIso);
    expect(store.P_CLOSED.closedReason).toBe('sap_manual_close');
    expect(store.P_CLOSED.transferidoSAP.closedManuallyInSap).toBe(true);
    expect(store.P_CLOSED.transferidoSAP.docEntry).toBe(100); // preserva existente
    expect(store.P_CLOSED.transferidoSAP.docNum).toBe(1234); // preserva existente
    expect(store.P_STILL_OPEN.closedAt).toBeUndefined();
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].id).toBe('P_CLOSED');
  });

  it('no cierra pedidos que están en el lookahead pero ya avanzaron (partial paid) — filtrados en candidates', async () => {
    const { db, store } = makeFbDb({
      P_PAID: {
        transferidoSAP: { docEntry: 300, docNum: 9999 },
        paidStatus: 'paid',
      },
    });
    const { fetch } = makeSapFetch({
      pages: [[{ DocEntry: 300, DocumentStatus: 'bost_Close', Cancelled: 'tNO' }], []],
    });
    const res = await syncSapQuotationClosures({
      fetch,
      sapConfig,
      fbDb: db,
      log: () => {},
    });
    expect(res.checked).toBe(0); // ni siquiera fue candidato
    expect(res.closedInApp).toBe(0);
    expect(store.P_PAID.closedAt).toBeUndefined();
  });

  it('marca errors cuando el SAP fetch falla', async () => {
    const { db } = makeFbDb({
      P: { transferidoSAP: { docEntry: 1 } },
    });
    const { fetch } = makeSapFetch({ httpStatus: 500, pages: [[]] });
    const res = await syncSapQuotationClosures({
      fetch,
      sapConfig,
      fbDb: db,
      log: () => {},
    });
    expect(res.errors).toBe(1);
    expect(res.closedInApp).toBe(0);
  });
});
