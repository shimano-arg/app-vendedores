// @ts-nocheck
/**
 * BUG-REV capa 2 (2026-10-29) — el chequeo idempotente por NumAtCard del
 * trigger NO debe vincular una SQ cancelada.
 *
 * Escenario: admin revierte un pedido confirmado a pendiente
 * (`volverAPendientes`), la SQ se cancela en SAP, el pedido se vuelve a
 * confirmar. El trigger consulta `Quotations?$filter=NumAtCard eq '<pedidoId>'`
 * y antes tomaba la primera fila (la SQ cancelada) → `transferidoSAP` apuntaba a
 * una SQ cancelada: el pedido figuraba "en SAP" pero SAP no lo procesaba.
 *
 * Datos ficticios; el Service Layer es un mock. No hay llamadas a SAP real.
 */
import { describe, expect, it, vi } from 'vitest';
import { AUTO_SEND_RESULT, handleAutoSendSap } from '../../functions/core/auto-send-sap-core.js';

const FieldValue = {
  delete: () => ({ __delete: true }),
};

function makeFakeDb(initialDocs) {
  const store = new Map(Object.entries(initialDocs || {}));
  const _apply = (docPath, patch) => {
    const existing = store.get(docPath) || {};
    const merged = { ...existing };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && v.__delete) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    store.set(docPath, merged);
  };
  const db = {
    _dump: () => Object.fromEntries(store),
    _patch: _apply,
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          const ref = {
            id,
            _path: path,
            async get() {
              const data = store.get(path);
              return { exists: data !== undefined, data: () => (data ? { ...data } : null) };
            },
            async update(patch) {
              if (!store.has(path)) throw new Error('doc not found');
              _apply(path, patch);
            },
            async set(patch, opts) {
              if (opts && opts.merge) {
                _apply(path, patch);
              } else {
                store.set(path, { ...patch });
              }
            },
          };
          return ref;
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, patch) {
          _apply(ref._path, patch);
        },
      };
      return fn(tx);
    },
  };
  return db;
}

/**
 * Mock SL fetch con control fino sobre:
 *  - idempotentHit: GET /Quotations?$filter=NumAtCard=... retorna este SQ.
 *  - itemsStock: Map ItemCode->available en whs 11 (default 999).
 *  - quotError / docNum / docEntry: control del POST.
 *  - postThrow: hace throw en el POST (simula fetch aborted por timeout).
 */
function makeSlFetch(scenarios) {
  return vi.fn(async (url, init) => {
    const method = (init && init.method) || 'GET';
    const isPost = method === 'POST';
    if (url.endsWith('/b1s/v1/Login')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'B1SESSION=fake; path=/, ROUTEID=.n1; path=/' },
        text: async () => JSON.stringify({ SessionId: 'fake' }),
      };
    }
    if (url.endsWith('/b1s/v1/Logout')) {
      return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
    }
    // GET /Items?$filter=... (stock recheck v1051).
    if (/\/b1s\/v1\/Items\?/.test(url) && !isPost) {
      const decoded = decodeURIComponent(url);
      const codes = Array.from(decoded.matchAll(/ItemCode eq '([^']+)'/g)).map((m) => m[1]);
      const stockMap = scenarios.itemsStock || {};
      const value = codes.map((code) => ({
        ItemCode: code,
        ItemWarehouseInfoCollection: [
          {
            WarehouseCode: '11',
            InStock: Object.hasOwn(stockMap, code) ? stockMap[code] : 999,
            Committed: 0,
            Ordered: 0,
          },
        ],
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ value }),
      };
    }
    // GET /Quotations?$filter=NumAtCard eq '...' (idempotent check v1006).
    const isQuotGet = /\/b1s\/v1\/Quotations\?/.test(url) && !isPost;
    if (isQuotGet) {
      if (scenarios.idempotentList || scenarios.idempotentHit) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              value: scenarios.idempotentList || [scenarios.idempotentHit],
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ value: [] }),
      };
    }
    // POST /Quotations.
    if (url.endsWith('/b1s/v1/Quotations') && isPost) {
      if (scenarios.postThrow) {
        // Simula AbortController timeout (v1172): fetch rechaza con AbortError.
        const err = new Error(scenarios.postThrow);
        err.name = 'AbortError';
        throw err;
      }
      if (scenarios.quotError) {
        return {
          ok: false,
          status: scenarios.quotError.status || 400,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              error: { message: { value: scenarios.quotError.msg || 'SL error' } },
            }),
        };
      }
      return {
        ok: true,
        status: 201,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            DocEntry: scenarios.docEntry ?? 7777,
            DocNum: scenarios.docNum ?? 2000284,
          }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({}),
    };
  });
}

function makeDeps({ dbDocs = {}, slScenarios = {}, now = 1759801200000 } = {}) {
  const fbDb = makeFakeDb(dbDocs);
  const fetch = makeSlFetch(slScenarios);
  return {
    fbDb,
    FieldValue,
    now: () => now,
    genSessionId: () => 'sess-fatechi',
    sl: {
      fetch,
      sapConfig: {
        url: 'https://sap.test',
        companyDB: 'DB',
        userName: 'user',
        password: 'pw',
      },
      log: vi.fn(),
    },
    lockTtlMs: 300000, // 5 min — mismo valor que el default del CF.
  };
}

const pedido = () => ({
  clientName: 'CLIENTE FICTICIO SA',
  clientCardCode: 'C-TEST-001',
  ownerEmail: 'vendedor@test.invalid',
  ownerVendor: 'VENDEDOR TEST',
  condicionPago: 'CONTADO',
  stage: 'confirmed',
  month: '2026-10',
  revertedFromConfirmedAt: '2026-10-29T10:00:00.000Z',
  previousSapDocNum: 2000100,
  previousSapDocEntryCancelled: 900,
  lines: [{ code: 'SKU-A', qty: 2, state: 'confirmed', desc: 'Item A' }],
});

const PID = 'ped-rev-001';

function postCalls(deps) {
  return deps.sl.fetch.mock.calls.filter(
    ([url, init]) => url.endsWith('/b1s/v1/Quotations') && init && init.method === 'POST'
  );
}
function idempotentGets(deps) {
  return deps.sl.fetch.mock.calls.filter(
    ([url, init]) => /\/b1s\/v1\/Quotations\?/.test(url) && !(init && init.method === 'POST')
  );
}

describe('auto-send — idempotencia NumAtCard ignora SQs canceladas (BUG-REV capa 2)', () => {
  it('C1: la única SQ con ese NumAtCard está cancelada → NO la vincula, crea una SQ nueva', async () => {
    const deps = makeDeps({
      dbDocs: { [`pedidos/${PID}`]: pedido() },
      slScenarios: {
        idempotentList: [{ DocEntry: 900, DocNum: 2000100, NumAtCard: PID, Cancelled: 'tYES' }],
        docNum: 2000200,
        docEntry: 950,
      },
    });
    const r = await handleAutoSendSap(PID, null, pedido(), deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK);
    expect(r.docNum).toBe(2000200);
    expect(postCalls(deps)).toHaveLength(1);
    const saved = deps.fbDb._dump()[`pedidos/${PID}`];
    expect(saved.transferidoSAP.docNum).toBe(2000200);
  });

  it('C2: hay una cancelada y una abierta → vincula la abierta sin re-POST', async () => {
    const deps = makeDeps({
      dbDocs: { [`pedidos/${PID}`]: pedido() },
      slScenarios: {
        idempotentList: [
          { DocEntry: 900, DocNum: 2000100, NumAtCard: PID, Cancelled: 'tYES' },
          { DocEntry: 950, DocNum: 2000200, NumAtCard: PID, Cancelled: 'tNO' },
        ],
      },
    });
    const r = await handleAutoSendSap(PID, null, pedido(), deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK_IDEMPOTENT);
    expect(r.docNum).toBe(2000200);
    expect(postCalls(deps)).toHaveLength(0);
  });

  it('C3 (regresión FATECHI): SQ abierta → idempotente, sin re-POST', async () => {
    const deps = makeDeps({
      dbDocs: { [`pedidos/${PID}`]: pedido() },
      slScenarios: {
        idempotentList: [{ DocEntry: 950, DocNum: 2000200, NumAtCard: PID, Cancelled: 'tNO' }],
      },
    });
    const r = await handleAutoSendSap(PID, null, pedido(), deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK_IDEMPOTENT);
    expect(postCalls(deps)).toHaveLength(0);
  });

  it('C4: respuesta sin el campo Cancelled → se trata como abierta (comportamiento previo, sin re-POST)', async () => {
    const deps = makeDeps({
      dbDocs: { [`pedidos/${PID}`]: pedido() },
      slScenarios: { idempotentList: [{ DocEntry: 950, DocNum: 2000200, NumAtCard: PID }] },
    });
    const r = await handleAutoSendSap(PID, null, pedido(), deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK_IDEMPOTENT);
    expect(postCalls(deps)).toHaveLength(0);
  });

  it('C5: la consulta pide Cancelled en $select y ya no corta en $top=1', async () => {
    const deps = makeDeps({ dbDocs: { [`pedidos/${PID}`]: pedido() }, slScenarios: {} });
    await handleAutoSendSap(PID, null, pedido(), deps);
    const [url] = idempotentGets(deps)[0];
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain(`NumAtCard eq '${PID}'`);
    expect(decoded).toMatch(/\$select=[^&]*Cancelled/);
    expect(decoded).not.toMatch(/\$top=1(?!\d)/);
  });
});
