// @ts-nocheck
/**
 * Regression test — FATECHI race condition (2026-10-06).
 *
 * Precedente: CF `onPedidoConfirmedSendToSap` disparo contra SAP para pedido
 * FATECHI. SAP tardo >5 min en responder al POST /Quotations. El AbortController
 * (90s timeout, v1172) corto el fetch del lado CF → `fetchErr` capturado → el
 * handler marco `needsManualVerification=true` y NO limpio el `sendingSapLock`
 * (dejandolo expirar via TTL para evitar un segundo POST). Sin embargo, SAP
 * efectivamente commiteo la SQ 2000283. Cuando el TTL del lock expiro (~5 min
 * mas tarde) y el trigger disparo de nuevo, el pre-check idempotente
 * `findQuotationByNumAtCard` (v1006) debio encontrar la SQ 2000283 y marcar
 * `transferidoSAP.via='cf_auto_idempotent'` SIN re-POST.
 *
 * El bug real de FATECHI fue en el flow MANUAL (batch admin) que NO tenia el
 * check idempotente — v1157 shipped el fix en el flow manual. ESTE test valida
 * que el flow AUTO (CF trigger) sigue cerrando el gap correctamente.
 *
 * Cases:
 * 1. First attempt crea SQ 2000283 OK (feliz). Second attempt simula lock
 *    expirado + idempotent GET hit -> SENT_OK_IDEMPOTENT sin re-POST.
 * 2. First attempt timeout (fetch aborted), SAP si commiteo. Second attempt
 *    lock expired + idempotent GET hit -> SENT_OK_IDEMPOTENT.
 * 3. First attempt timeout, SAP NO commiteo (nada en SAP). Second attempt
 *    lock expired + idempotent GET miss -> POST normal, SENT_OK.
 *
 * NO reproducimos el bug del flow manual aca (eso vive en src/domains tests);
 * aca validamos el flow CF, que es el escenario del handler core.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_SEND_RESULT, handleAutoSendSap } from '../../functions/core/auto-send-sap-core.js';

// ---- Fixtures compartidos (reusar pattern de auto-send-sap.test.js) --------

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
      if (scenarios.idempotentHit) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              value: [scenarios.idempotentHit],
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

// Pedido base — mimica FATECHI (CardCode valido, 2 lineas confirmed).
const fatechiPedido = () => ({
  clientName: 'FATECHI SRL',
  clientCardCode: 'C-FATECHI',
  ownerEmail: 'vendedor@shimano.com.ar',
  ownerVendor: 'GONZALO DE LA ROSA',
  condicionPago: 'CONTADO',
  stage: 'confirmed',
  month: '2026-10',
  lines: [
    { code: 'SKU-A', qty: 5, state: 'confirmed', desc: 'Item A' },
    { code: 'SKU-B', qty: 3, state: 'confirmed', desc: 'Item B' },
  ],
});

// ============================================================================
// Case 1: First attempt crea SQ OK → lock expira → Second attempt idempotent
// ============================================================================
describe('FATECHI race regression — first OK, lock expires, second idempotent', () => {
  it('first attempt POST OK (2000283), lock expired, second attempt pre-check encuentra SQ existente → SENT_OK_IDEMPOTENT sin re-POST', async () => {
    const now = 1759801200000;
    const pedidoId = 'ped-fatechi-001';

    // Fase 1: first attempt — POST crea SQ 2000283.
    const depsFirst = makeDeps({
      dbDocs: { [`pedidos/${pedidoId}`]: fatechiPedido() },
      slScenarios: { docNum: 2000283, docEntry: 5555 },
      now,
    });
    const r1 = await handleAutoSendSap(pedidoId, null, fatechiPedido(), depsFirst);
    expect(r1.result).toBe(AUTO_SEND_RESULT.SENT_OK);
    expect(r1.docNum).toBe(2000283);
    // Simulamos manualmente que el write de transferidoSAP falló (ej: Firestore
    // latency, network hiccup entre SAP commit y Firestore write). El pedido
    // tiene SQ en SAP pero no en Firestore. Mimicamos esto borrando el
    // transferidoSAP escrito y mantenemos un sendingSapLock stale.
    depsFirst.fbDb._patch(`pedidos/${pedidoId}`, {
      transferidoSAP: { __delete: true },
      sendingSapLock: {
        sessionId: 'sess-stale',
        at: now - 400000, // 400s atras → EXPIRADO (> 5min TTL)
        by: 'cf-auto',
      },
    });

    // Fase 2: second attempt — trigger re-dispara. Lock expiro, pre-check
    // idempotent GET /Quotations?$filter=NumAtCard eq 'ped-fatechi-001' hit.
    const nowSecond = now + 400000;
    const depsSecond = makeDeps({
      dbDocs: depsFirst.fbDb._dump(),
      slScenarios: {
        idempotentHit: {
          DocEntry: 5555,
          DocNum: 2000283,
          NumAtCard: pedidoId,
        },
        // Si el POST se dispara por error, lo detectamos con docNum distinto.
        docNum: 2000284,
        docEntry: 6666,
      },
      now: nowSecond,
    });
    const r2 = await handleAutoSendSap(
      pedidoId,
      null,
      depsSecond.fbDb._dump()[`pedidos/${pedidoId}`],
      depsSecond
    );
    expect(r2.result).toBe(AUTO_SEND_RESULT.SENT_OK_IDEMPOTENT);
    expect(r2.docNum).toBe(2000283); // NO 2000284 — pre-check gano, NO re-POST
    expect(r2.docEntry).toBe(5555);

    // Asserción crítica: POST /Quotations NO se disparó en el 2do intento.
    const postCalls = depsSecond.sl.fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/b1s/v1/Quotations') && init && init.method === 'POST'
    );
    expect(postCalls).toHaveLength(0);

    // Firestore: transferidoSAP.docNum = SQ existente + via = idempotent.
    const after = depsSecond.fbDb._dump()[`pedidos/${pedidoId}`];
    expect(after.transferidoSAP.docNum).toBe(2000283);
    expect(after.transferidoSAP.via).toBe('cf_auto_idempotent');
    expect(after.transferidoSAP.batchId).toMatch(/^CF-AUTO-IDEMPOTENT-/);
    expect(after.sendingSapLock).toBeUndefined();
  });
});

// ============================================================================
// Case 2: First attempt timeout (SAP commiteó), Second attempt idempotent
// ============================================================================
describe('FATECHI race regression — first timeout but SAP commiteó, second idempotent', () => {
  it('first attempt POST aborta (fetch failed), SAP commiteó SQ 2000283 silent, second attempt lock expired + pre-check hit → SENT_OK_IDEMPOTENT', async () => {
    const now = 1759801200000;
    const pedidoId = 'ped-fatechi-002';

    // Fase 1: first attempt — POST aborta por timeout. El handler marca
    // needsManualVerification=true y NO borra el lock (lo deja expirar por TTL).
    const depsFirst = makeDeps({
      dbDocs: { [`pedidos/${pedidoId}`]: fatechiPedido() },
      slScenarios: { postThrow: 'fetch failed: AbortError' },
      now,
    });
    const r1 = await handleAutoSendSap(pedidoId, null, fatechiPedido(), depsFirst);
    expect(r1.result).toBe(AUTO_SEND_RESULT.ERROR_SL);
    expect(r1.error).toMatch(/post_aborted/);
    const afterFirst = depsFirst.fbDb._dump()[`pedidos/${pedidoId}`];
    // v1172: lock NO se borra para prevenir doble POST concurrent — expira por TTL.
    expect(afterFirst.sendingSapLock).toBeDefined();
    // Marker auditable para operations: pedido necesita verificacion manual.
    expect(afterFirst.transferError).toBeDefined();
    expect(afterFirst.transferError.needsManualVerification).toBe(true);

    // Fase 2: ~5min después, el lock expira naturalmente. El trigger CF corre
    // de nuevo. SAP SI tenia la SQ 2000283 commiteada (el POST hizo write
    // pero el ACK TCP no volvió). Pre-check idempotent la encuentra.
    const nowSecond = now + 400000; // > 5min después → lock stale.
    // Simular estado post-TTL expiry: lock sigue en Firestore pero su `at` es
    // viejo (> lockTtlMs). El handler lo trata como stale y override.
    const depsSecond = makeDeps({
      dbDocs: depsFirst.fbDb._dump(),
      slScenarios: {
        idempotentHit: {
          DocEntry: 5555,
          DocNum: 2000283,
          NumAtCard: pedidoId,
        },
        // Si el POST se dispara, usa docNum DIFERENTE para detectar la regression.
        docNum: 2000284,
        docEntry: 6666,
      },
      now: nowSecond,
    });
    const r2 = await handleAutoSendSap(
      pedidoId,
      null,
      depsSecond.fbDb._dump()[`pedidos/${pedidoId}`],
      depsSecond
    );
    expect(r2.result).toBe(AUTO_SEND_RESULT.SENT_OK_IDEMPOTENT);
    expect(r2.docNum).toBe(2000283); // La SQ original, NO una nueva.

    // Critico: solo 1 POST a /Quotations EN TODO EL TEST (el primero que abortó).
    // El segundo intento NO POST.
    const postCallsSecond = depsSecond.sl.fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/b1s/v1/Quotations') && init && init.method === 'POST'
    );
    expect(postCallsSecond).toHaveLength(0);

    const afterSecond = depsSecond.fbDb._dump()[`pedidos/${pedidoId}`];
    expect(afterSecond.transferidoSAP.via).toBe('cf_auto_idempotent');
    expect(afterSecond.transferidoSAP.docNum).toBe(2000283);
  });
});

// ============================================================================
// Case 3: First timeout + SAP NO commiteó → Second attempt POST normal
// ============================================================================
describe('FATECHI race regression — first timeout AND SAP NO commiteó, second POST normal', () => {
  it('first attempt POST aborta, SAP NO tiene nada, second attempt lock expired + pre-check empty → POST normal, SENT_OK', async () => {
    const now = 1759801200000;
    const pedidoId = 'ped-fatechi-003';

    // Fase 1: first attempt — POST aborta.
    const depsFirst = makeDeps({
      dbDocs: { [`pedidos/${pedidoId}`]: fatechiPedido() },
      slScenarios: { postThrow: 'fetch failed: timeout' },
      now,
    });
    const r1 = await handleAutoSendSap(pedidoId, null, fatechiPedido(), depsFirst);
    expect(r1.result).toBe(AUTO_SEND_RESULT.ERROR_SL);
    expect(r1.error).toMatch(/post_aborted/);

    // Fase 2: lock expired, pre-check idempotent GET devuelve value:[] (SAP NO
    // tiene la SQ — el POST original realmente nunca llego). POST normal se
    // ejecuta y crea SQ 2000284.
    const nowSecond = now + 400000;
    const depsSecond = makeDeps({
      dbDocs: depsFirst.fbDb._dump(),
      slScenarios: {
        // Sin idempotentHit → GET devuelve value: [] (default).
        docNum: 2000284,
        docEntry: 6666,
      },
      now: nowSecond,
    });
    const r2 = await handleAutoSendSap(
      pedidoId,
      null,
      depsSecond.fbDb._dump()[`pedidos/${pedidoId}`],
      depsSecond
    );
    expect(r2.result).toBe(AUTO_SEND_RESULT.SENT_OK);
    expect(r2.docNum).toBe(2000284);

    // POST a /Quotations SI se disparo (uno solo, el segundo intento).
    const postCallsSecond = depsSecond.sl.fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/b1s/v1/Quotations') && init && init.method === 'POST'
    );
    expect(postCallsSecond).toHaveLength(1);

    const afterSecond = depsSecond.fbDb._dump()[`pedidos/${pedidoId}`];
    expect(afterSecond.transferidoSAP.docNum).toBe(2000284);
    expect(afterSecond.transferidoSAP.via).toBe('cf_auto');
    expect(afterSecond.sendingSapLock).toBeUndefined();
  });
});
