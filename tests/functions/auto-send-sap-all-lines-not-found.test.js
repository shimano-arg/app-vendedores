// @ts-check
/**
 * (incidente Federico 2026-11-20) — CAPA (c) edge case: TODAS las líneas
 * confirmed caen en `sap_item_not_found` + `keptLines=0` → marca el pedido
 * como `app_only` sin sapPost + log + email a Mariano.
 *
 * Contexto:
 *   - PR 2 §72 v1475 agregó la CAPA (b) `SKU_NOT_IN_SAP_CATALOG` en
 *     commit-pedido-core. Al removerla (commit anterior, incidente Federico),
 *     se expone este edge case: `auto-send-sap-core.js` ya tenía el branch
 *     parcial (`onlySapNotFound && keptLines > 0`) pero NO el edge total.
 *   - Si llega un pedido con TODAS las confirmed → `sap_item_not_found` por
 *     race entre sync y envío, el flow debe marcar `app_only` + liberar
 *     lock + email a Mariano, NO caer al `sapPost(... DocumentLines: [])`.
 *
 * Tests:
 *   - T1: pedido con 2 confirmed, SAP devuelve value=[] para ambas (todas
 *     sap_item_not_found) → result=SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES,
 *     NO POST a /Quotations, `transferidoSAP.via='app_only'` + lock liberado
 *     + email a Mariano + operations_log entry subtype=all_lines_app_only.
 *   - T2: anti-regresión del escenario parcial (1 OK + 1 not_found): sigue
 *     cayendo en el branch previo (envía keptLines + email), NO al nuevo.
 *   - T3: insufficient_stock (NO sap_item_not_found) sigue en v1179
 *     needsManualIntervention — el nuevo branch solo cubre sap_item_not_found.
 */
import { describe, expect, it, vi } from 'vitest';
import { AUTO_SEND_RESULT, handleAutoSendSap } from '../../functions/core/auto-send-sap-core.js';

// ---- Fixtures + helpers --------------------------------------------------

const FieldValue = {
  delete: () => ({ __delete: true }),
};

function makeFakeDb(initialDocs) {
  const store = new Map(Object.entries(initialDocs || {}));
  const operationsLog = [];
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
    _operationsLog: operationsLog,
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
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
        },
        add(data) {
          const id = 'auto_' + Math.random().toString(36).slice(2, 10);
          store.set(`${name}/${id}`, data);
          if (name === 'operations_log') operationsLog.push(data);
          return Promise.resolve({ id });
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
 * Mock SL. Extensión de la mock estándar:
 *   - scenarios.itemsNotFound: array de ItemCodes que SAP debe excluir del
 *     value[] del GET /Items (simula `sap_item_not_found` real).
 *   - scenarios.itemsStock: override para codes PRESENTES (como el mock
 *     estándar). Codes que no están ni en itemsNotFound ni en itemsStock
 *     reciben stock=999 por default.
 */
function makeSlFetch(scenarios) {
  return vi.fn(async (url, init) => {
    const method = (init && init.method) || 'GET';
    const isPost = method === 'POST';
    const isQuotPost = url.endsWith('/b1s/v1/Quotations') && isPost;
    const isQuotGet = /\/b1s\/v1\/Quotations\?/.test(url) && !isPost;
    const isItemsGet = /\/b1s\/v1\/Items\?/.test(url) && !isPost;
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
    if (isItemsGet) {
      const decoded = decodeURIComponent(url);
      const codes = Array.from(decoded.matchAll(/ItemCode eq '([^']+)'/g)).map((m) => m[1]);
      const stockOverride = scenarios.itemsStock || {};
      const notFoundSet = new Set(scenarios.itemsNotFound || []);
      // SAP solo devuelve codes que SÍ existen (los que no están en notFoundSet).
      const value = codes
        .filter((code) => !notFoundSet.has(code))
        .map((code) => {
          const avail = Object.hasOwn(stockOverride, code) ? stockOverride[code] : 999;
          return {
            ItemCode: code,
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: avail, Committed: 0, Ordered: 0 },
            ],
          };
        });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ value }),
      };
    }
    if (isQuotGet) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ value: [] }),
      };
    }
    if (isQuotPost) {
      return {
        ok: true,
        status: 201,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            DocEntry: scenarios.docEntry ?? 12345,
            DocNum: scenarios.docNum ?? 67890,
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

const baseSlConfig = {
  url: 'https://sap.test',
  companyDB: 'DB',
  userName: 'user',
  password: 'pw',
};

const validPedido = {
  clientName: 'CLIENTE FEDERICO',
  clientCardCode: 'C_FED',
  ownerEmail: 'federico@shimano.com.ar',
  ownerVendor: 'FEDERICO CASTELANELLI',
  condicionPago: 'CONTADO',
  stage: 'confirmed',
  month: '2026-11',
  lines: [
    { code: 'NUEVO1', qty: 1, state: 'confirmed', desc: 'Producto nuevo 1' },
    { code: 'NUEVO2', qty: 2, state: 'confirmed', desc: 'Producto nuevo 2' },
  ],
};

function makeDeps({ dbDocs = {}, slScenarios = {}, sendAlertEmail, now = 1700000000000 } = {}) {
  const fbDb = makeFakeDb(dbDocs);
  const fetch = makeSlFetch(slScenarios);
  return {
    fbDb,
    FieldValue,
    now: () => now,
    genSessionId: () => 'sess-1',
    sl: {
      fetch,
      sapConfig: baseSlConfig,
      log: vi.fn(),
    },
    sendAlertEmail,
  };
}

// ---- Tests ---------------------------------------------------------------

describe('handleAutoSendSap — CAPA (c) edge case: todas las líneas sap_item_not_found', () => {
  it('T1 — TODAS las confirmed caen en sap_item_not_found → SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES', async () => {
    const emailCalls = [];
    const sendAlertEmail = vi.fn((args) => {
      emailCalls.push(args);
      return Promise.resolve();
    });
    const deps = makeDeps({
      dbDocs: { 'pedidos/pFed25': { ...validPedido } },
      slScenarios: {
        // Ambos ItemCodes NO existen en SAP → recheck marca sap_item_not_found
        // en las 2 líneas → keptLines=0.
        itemsNotFound: ['NUEVO1', 'NUEVO2'],
      },
      sendAlertEmail,
    });
    const r = await handleAutoSendSap('pFed25', null, { ...validPedido }, deps);

    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES);
    expect(r.reason).toBe('all_lines_sap_item_not_found');
    expect(r.degradedCount).toBe(2);
    expect(r.missingSkus.sort()).toEqual(['NUEVO1', 'NUEVO2']);

    // NO POST a /Quotations (no se envió NADA a SAP).
    const postCalls = deps.sl.fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/b1s/v1/Quotations') && init && init.method === 'POST'
    );
    expect(postCalls).toHaveLength(0);

    // Estado post-check: pedido con transferidoSAP.via='app_only' + requiere
    // reenvío manual + lock liberado + líneas marcadas con _degradedReason.
    const after = deps.fbDb._dump()['pedidos/pFed25'];
    expect(after.transferidoSAP).toBeDefined();
    expect(after.transferidoSAP.via).toBe('app_only');
    expect(after.transferidoSAP.reason).toBe('sap_item_not_found_all_lines');
    expect(after.transferidoSAP.requiresManualResend).toBe(true);
    expect(after.transferidoSAP.missingSkus.sort()).toEqual(['NUEVO1', 'NUEVO2']);
    expect(after.sendingSapLock).toBeUndefined();

    // Las líneas marcadas con _degradedReason.
    for (const l of after.lines) {
      expect(l._degradedReason).toBe('sap_item_not_found_app_only');
      expect(l._degradedAt).toBeTruthy();
    }

    // operations_log entry con type/subtype correctos.
    const log = deps.fbDb._operationsLog.find(
      (e) => e.type === 'sap_item_not_found_degraded' && e.subtype === 'all_lines_app_only'
    );
    expect(log).toBeDefined();
    expect(log.pedidoId).toBe('pFed25');
    expect(log.degradedCount).toBe(2);
    expect(log.keptCount).toBe(0);
    expect(log.missingSkus.sort()).toEqual(['NUEVO1', 'NUEVO2']);

    // Email a Mariano (fire-and-forget).
    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(emailCalls[0].to).toBe('erbinomariano@gmail.com');
    expect(emailCalls[0].subject).toMatch(/app_only/);
    expect(emailCalls[0].subject).toMatch(/2/); // 2 SKUs
    expect(emailCalls[0].text).toMatch(/NUEVO1/);
    expect(emailCalls[0].text).toMatch(/NUEVO2/);
    expect(emailCalls[0].text).toMatch(/Panel SAP/);
  });

  it('T2 — anti-regresión: parcial (1 OK + 1 not_found) sigue mandando keptLines a SAP', async () => {
    const emailCalls = [];
    const sendAlertEmail = vi.fn((args) => {
      emailCalls.push(args);
      return Promise.resolve();
    });
    const deps = makeDeps({
      dbDocs: { 'pedidos/pMixto': { ...validPedido } },
      slScenarios: {
        itemsNotFound: ['NUEVO1'],
        itemsStock: { NUEVO2: 999 },
      },
      sendAlertEmail,
    });
    const r = await handleAutoSendSap('pMixto', null, { ...validPedido }, deps);

    // Debe caer al branch PARCIAL (SENT_OK), NO al nuevo edge total.
    expect(r.result).not.toBe(AUTO_SEND_RESULT.SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK);

    // POST a /Quotations SÍ ocurrió (con solo NUEVO2 en DocumentLines).
    const postCalls = deps.sl.fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/b1s/v1/Quotations') && init && init.method === 'POST'
    );
    expect(postCalls).toHaveLength(1);
    const body = JSON.parse(postCalls[0][1].body);
    expect(body.DocumentLines).toHaveLength(1);
    expect(body.DocumentLines[0].ItemCode).toBe('NUEVO2');

    // operations_log entry parcial (sin subtype).
    const log = deps.fbDb._operationsLog.find(
      (e) => e.type === 'sap_item_not_found_degraded' && !e.subtype
    );
    expect(log).toBeDefined();
    expect(log.keptCount).toBe(1);

    // Email a Mariano también (branch parcial).
    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(emailCalls[0].subject).not.toMatch(/app_only/);
  });

  it('T3 — anti-regresión: insufficient_stock sigue en v1179 needsManualIntervention', async () => {
    // Pedido con 2 confirmed, ambas con stock insuficiente (NO sap_item_not_found).
    // El nuevo branch SOLO cubre sap_item_not_found.
    const deps = makeDeps({
      dbDocs: { 'pedidos/pStock': { ...validPedido } },
      slScenarios: {
        // Ambas qtys > stock disponible.
        itemsStock: { NUEVO1: 0, NUEVO2: 0 },
      },
    });
    const r = await handleAutoSendSap('pStock', null, { ...validPedido }, deps);

    // Debe caer al branch v1179 de all_degraded (app_only via legacy).
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_STOCK_RECHECK_ALL_DEGRADED);
    expect(r.reason).toBe('all_lines_degraded');

    // NO POST a /Quotations.
    const postCalls = deps.sl.fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/b1s/v1/Quotations') && init && init.method === 'POST'
    );
    expect(postCalls).toHaveLength(0);

    // Pedido queda con via='app_only' con reason legacy.
    const after = deps.fbDb._dump()['pedidos/pStock'];
    expect(after.transferidoSAP.via).toBe('app_only');
    expect(after.transferidoSAP.reason).toBe('stock_recheck_all_degraded');
    // No debe tener el reason del nuevo branch.
    expect(after.transferidoSAP.reason).not.toBe('sap_item_not_found_all_lines');
  });

  it('T4 — email es fire-and-forget: si sendAlertEmail falla no rompe el flow', async () => {
    const sendAlertEmail = vi.fn(() => Promise.reject(new Error('SMTP timeout')));
    const deps = makeDeps({
      dbDocs: { 'pedidos/pCrash': { ...validPedido } },
      slScenarios: {
        itemsNotFound: ['NUEVO1', 'NUEVO2'],
      },
      sendAlertEmail,
    });
    // No debe tirar.
    const r = await handleAutoSendSap('pCrash', null, { ...validPedido }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES);
    // El pedido queda marcado igual.
    const after = deps.fbDb._dump()['pedidos/pCrash'];
    expect(after.transferidoSAP.via).toBe('app_only');
  });

  it('T5 — sin deps.sendAlertEmail el flow funciona (solo log sin email)', async () => {
    const deps = makeDeps({
      dbDocs: { 'pedidos/pNoEmail': { ...validPedido } },
      slScenarios: {
        itemsNotFound: ['NUEVO1', 'NUEVO2'],
      },
      // sendAlertEmail: undefined (no se pasa).
    });
    const r = await handleAutoSendSap('pNoEmail', null, { ...validPedido }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES);
    // Log entry escrito.
    const log = deps.fbDb._operationsLog.find((e) => e.subtype === 'all_lines_app_only');
    expect(log).toBeDefined();
  });
});

describe('handleAutoSendSap — contrato: nuevo constant AUTO_SEND_RESULT', () => {
  it('T20 — SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES existe y tiene valor único', () => {
    expect(AUTO_SEND_RESULT.SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES).toBe(
      'skip_sap_item_not_found_all_lines'
    );
    // Único entre los otros results.
    const values = Object.values(AUTO_SEND_RESULT);
    const occurrences = values.filter(
      (v) => v === AUTO_SEND_RESULT.SKIP_SAP_ITEM_NOT_FOUND_ALL_LINES
    );
    expect(occurrences).toHaveLength(1);
  });
});

// FIX HIGH Adversarial (incidente Federico 2026-11-20): preservar
// reconcileAttempts + reconcileMaxRetriesAt del transferidoSAP previo.
// Sin esto, CAPA (c) reinicia attempts a 0 cada vez que re-degrada →
// reconcile loop infinito (96 ticks/día contra SL).
describe('handleAutoSendSap — CAPA (c) preserva reconcileAttempts en re-degradación', () => {
  it('T21 — CAPA (c) preserva reconcileAttempts previo (fix loop infinito)', async () => {
    // Pedido que ya fue reconciliado 3 veces y vuelve a caer en sap_item_not_found.
    const pedidoReDegradado = {
      ...validPedido,
      transferidoSAP: undefined, // reconcile acaba de borrar
    };
    // Inyectamos en el store el pedido con transferidoSAP previo (antes del reconcile).
    // handleAutoSendSap hace docRef.update() — después verificamos el estado final.
    const prevTransferidoSAP = {
      via: 'app_only',
      reason: 'sap_item_not_found_all_lines',
      requiresManualResend: true,
      missingSkus: ['SKU_INEXISTENTE_A', 'SKU_INEXISTENTE_B'],
      reconcileAttempts: 3,
      reconcileLastAt: '2026-11-20T10:00:00.000Z',
    };
    const after = { ...pedidoReDegradado, transferidoSAP: prevTransferidoSAP };
    const deps = makeDeps({
      dbDocs: { 'pedidos/pRedegraded': { ...after } },
      slScenarios: {
        itemsNotFound: ['NUEVO1', 'NUEVO2'],
      },
    });
    const before = { ...pedidoReDegradado, transferidoSAP: prevTransferidoSAP };
    // El wasReconciled path pasa el after SIN transferidoSAP.
    await handleAutoSendSap('pRedegraded', before, { ...pedidoReDegradado }, deps);
    // Verificar estado final del doc: transferidoSAP re-escrito CON reconcileAttempts preservado.
    const finalState = deps.fbDb._dump()['pedidos/pRedegraded'];
    expect(finalState.transferidoSAP).toBeDefined();
    expect(finalState.transferidoSAP.requiresManualResend).toBe(true);
    expect(finalState.transferidoSAP.reconcileAttempts).toBe(3);
  });

  it('T22 — CAPA (c) sin reconcileAttempts previo NO setea el campo (zero regresión)', async () => {
    // Primer intento: pedido no viene del reconcile (es la primera degradación).
    const deps = makeDeps({
      dbDocs: { 'pedidos/pFirstDegrade': { ...validPedido } },
      slScenarios: {
        itemsNotFound: ['NUEVO1', 'NUEVO2'],
      },
    });
    await handleAutoSendSap('pFirstDegrade', null, { ...validPedido }, deps);
    const finalState = deps.fbDb._dump()['pedidos/pFirstDegrade'];
    expect(finalState.transferidoSAP).toBeDefined();
    // No hay attempts previo → campo no se agrega.
    expect(finalState.transferidoSAP.reconcileAttempts).toBeUndefined();
    expect(finalState.transferidoSAP.requiresManualResend).toBe(true);
  });

  it('T23 — CAPA (c) preserva reconcileMaxRetriesAt previo (si ya alcanzó max)', async () => {
    const prevT = {
      via: 'app_only',
      reason: 'sap_item_not_found_all_lines',
      requiresManualResend: true,
      missingSkus: ['SKU_INEXISTENTE_A'],
      reconcileAttempts: 5,
      reconcileMaxRetriesAt: '2026-11-21T08:00:00.000Z',
    };
    const pedidoMaxRetries = {
      ...validPedido,
      transferidoSAP: prevT,
    };
    const deps = makeDeps({
      dbDocs: { 'pedidos/pMax': { ...pedidoMaxRetries } },
      slScenarios: {
        itemsNotFound: ['NUEVO1', 'NUEVO2'],
      },
    });
    const after = { ...pedidoMaxRetries, transferidoSAP: undefined };
    await handleAutoSendSap('pMax', pedidoMaxRetries, after, deps);
    const finalState = deps.fbDb._dump()['pedidos/pMax'];
    expect(finalState.transferidoSAP).toBeDefined();
    expect(finalState.transferidoSAP.reconcileAttempts).toBe(5);
    expect(finalState.transferidoSAP.reconcileMaxRetriesAt).toBe('2026-11-21T08:00:00.000Z');
  });
});
