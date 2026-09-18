import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_SEND_RESULT,
  buildQuotationPayload,
  handleAutoSendSap,
  isEligibleForAutoSend,
  resolveCardCode,
  resolveItemCode,
  resolveSlpCode,
} from '../../functions/core/auto-send-sap-core.js';

// ---- Fixtures + helpers ---------------------------------------------------

/**
 * FieldValue mock. `.delete()` retorna un sentinel que el fake db reconoce
 * para hacer delete real del campo en la data cacheada.
 */
const FieldValue = {
  delete: () => ({ __delete: true }),
};

/** Fake Firestore db en memoria con soporte para .doc().get()/.update() +
 *  runTransaction. Suficiente para tests del handler. */
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
              // v982: soporte set con merge:true (usado por handleAutoSendSap
              // en el path all_bo para persistir transferidoSAP={via:'app_only'}).
              // Sin merge no aplica en este handler, pero manejamos ambos casos.
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
      // Simple in-memory: no snapshot isolation. Suficiente para tests que
      // no simulan conflicts concurrentes (los rules del handler cubren
      // idempotencia via ALREADY_SENT/OTHER_SESSION_LOCK).
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

/** Mock SL respuestas por endpoint. */
function makeSlFetch(scenarios) {
  return vi.fn(async (url, init) => {
    const isPost = init && init.method === 'POST';
    const isQuot = url.endsWith('/b1s/v1/Quotations') && isPost;
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
    if (isQuot) {
      if (scenarios.quotError) {
        return {
          ok: false,
          status: scenarios.quotError.status || 400,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              error: { message: { value: scenarios.quotError.msg || 'SL business error' } },
            }),
        };
      }
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

function makeDeps({
  dbDocs = {},
  slScenarios = {},
  sapClients,
  sapProducts,
  sapVendors,
  now = 1700000000000,
  sessionId = 'sess-1',
} = {}) {
  const fbDb = makeFakeDb(dbDocs);
  const fetch = makeSlFetch(slScenarios);
  return {
    fbDb,
    FieldValue,
    now: () => now,
    genSessionId: () => sessionId,
    sapClients,
    sapProducts,
    sapVendors,
    sl: {
      fetch,
      sapConfig: baseSlConfig,
      log: vi.fn(),
    },
  };
}

const validPedido = {
  clientName: 'PESCADERIA X',
  clientCardCode: 'C0001',
  ownerEmail: 'gonzalo@shimano.com.ar',
  ownerVendor: 'GONZALO DE LA ROSA',
  condicionPago: 'CONTADO',
  stage: 'confirmed',
  month: '2026-09',
  lines: [
    { code: 'CDC60H2', qty: 3, state: 'confirmed', desc: 'Curado' },
    { code: 'FX2500', qty: 2, state: 'confirmed', desc: 'FX' },
  ],
};

// ---- resolveCardCode ------------------------------------------------------

describe('resolveCardCode', () => {
  it('usa clientCardCode persistido si existe', () => {
    const deps = makeDeps();
    expect(resolveCardCode({ clientName: 'X', clientCardCode: 'C42' }, deps)).toBe('C42');
  });
  it('fallback: lookup en sapClients por nombre normalizado', () => {
    const deps = makeDeps({ sapClients: new Map([['PESCADERIA X', 'C99']]) });
    expect(resolveCardCode({ clientName: '  pescadería  x  ' }, deps)).toBe('C99');
  });
  it('vacio si no hay match', () => {
    const deps = makeDeps({ sapClients: new Map([['OTRO', 'C99']]) });
    expect(resolveCardCode({ clientName: 'Nuevo' }, deps)).toBe('');
  });
});

// ---- resolveItemCode ------------------------------------------------------

describe('resolveItemCode', () => {
  it('usa mapping manual si existe', () => {
    const deps = makeDeps({ sapProducts: new Map([['APP-CODE', 'SAP-999']]) });
    expect(resolveItemCode('APP-CODE', deps)).toBe('SAP-999');
  });
  it('parseInt para codes numericos con leading zeros', () => {
    const deps = makeDeps();
    expect(resolveItemCode('032737', deps)).toBe('32737');
  });
  it('fallback: mismo code', () => {
    const deps = makeDeps();
    expect(resolveItemCode('CDC60H2', deps)).toBe('CDC60H2');
  });
});

// ---- resolveSlpCode -------------------------------------------------------

describe('resolveSlpCode', () => {
  it('devuelve -1 si no hay mapping', () => {
    expect(resolveSlpCode('GONZALO', makeDeps())).toBe(-1);
  });
  it('lookup case-insensitive', () => {
    const deps = makeDeps({ sapVendors: new Map([['GONZALO DE LA ROSA', 12]]) });
    expect(resolveSlpCode('gonzalo de la rosa', deps)).toBe(12);
  });
});

// ---- isEligibleForAutoSend ------------------------------------------------

describe('isEligibleForAutoSend', () => {
  it('elegible: stage cambia null -> confirmed sin transferidoSAP', () => {
    expect(
      isEligibleForAutoSend(null, { stage: 'confirmed', lines: [{ state: 'confirmed', qty: 1 }] })
    ).toEqual({ eligible: true });
  });
  it('elegible: stage cambia pending -> confirmed sin transferidoSAP', () => {
    expect(
      isEligibleForAutoSend(
        { stage: 'pending' },
        { stage: 'confirmed', lines: [{ state: 'confirmed', qty: 1 }] }
      )
    ).toEqual({ eligible: true });
  });
  it('no elegible: after ya era confirmed antes (no es transicion)', () => {
    expect(
      isEligibleForAutoSend(
        { stage: 'confirmed' },
        { stage: 'confirmed', lines: [{ state: 'confirmed', qty: 1 }] }
      )
    ).toEqual({ eligible: false, reason: 'no_transition' });
  });
  it('no elegible: no confirmed', () => {
    expect(isEligibleForAutoSend(null, { stage: 'pending' })).toEqual({
      eligible: false,
      reason: 'not_confirmed',
    });
  });
  it('no elegible: transferidoSAP ya existe', () => {
    expect(
      isEligibleForAutoSend(null, {
        stage: 'confirmed',
        transferidoSAP: { docNum: 1 },
        lines: [],
      })
    ).toEqual({ eligible: false, reason: 'already_sent' });
  });
  it('no elegible: 100% BO', () => {
    expect(
      isEligibleForAutoSend(null, {
        stage: 'confirmed',
        lines: [
          { state: 'BO', qty: 2 },
          { state: 'BO', qty: 1 },
        ],
      })
    ).toEqual({ eligible: false, reason: 'all_bo' });
  });
  it('no elegible: sin lineas', () => {
    expect(isEligibleForAutoSend(null, { stage: 'confirmed', lines: [] })).toEqual({
      eligible: false,
      reason: 'no_lines',
    });
  });
});

// ---- buildQuotationPayload -----------------------------------------------

describe('buildQuotationPayload', () => {
  it('genera payload correcto happy path', () => {
    const deps = makeDeps();
    const r = buildQuotationPayload(validPedido, 'ped-1', deps);
    expect(r.ok).toBe(true);
    expect(r.payload.CardCode).toBe('C0001');
    expect(r.payload.NumAtCard).toBe('ped-1');
    expect(r.payload.U_AppOrderId).toBe('ped-1');
    expect(r.payload.DocumentLines).toHaveLength(2);
    expect(r.payload.DocumentLines[0]).toMatchObject({
      ItemCode: 'CDC60H2',
      Quantity: 3,
      WarehouseCode: '11',
      LineNum: 0,
    });
  });
  it('rechaza si no hay cardCode', () => {
    const deps = makeDeps();
    const r = buildQuotationPayload({ ...validPedido, clientCardCode: '' }, 'ped-1', deps);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_cardcode');
  });
  it('rechaza si no hay lineas confirmed', () => {
    const deps = makeDeps();
    const r = buildQuotationPayload(
      { ...validPedido, lines: [{ code: 'X', qty: 5, state: 'BO' }] },
      'ped-1',
      deps
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_lines');
  });
  it('deduplica lineas con mismo ItemCode sumando qtys (SAP error 23105)', () => {
    const deps = makeDeps();
    const p = {
      ...validPedido,
      lines: [
        { code: 'DUP', qty: 3, state: 'confirmed' },
        { code: 'DUP', qty: 2, state: 'confirmed' },
        { code: 'X', qty: 1, state: 'confirmed' },
      ],
    };
    const r = buildQuotationPayload(p, 'p', deps);
    expect(r.ok).toBe(true);
    expect(r.payload.DocumentLines).toHaveLength(2);
    const dupLine = r.payload.DocumentLines.find((l) => l.ItemCode === 'DUP');
    expect(dupLine.Quantity).toBe(5);
  });
  it('Comments truncado a 254 chars (limite SAP)', () => {
    const deps = makeDeps();
    const p = { ...validPedido, clientName: 'X'.repeat(300) };
    const r = buildQuotationPayload(p, 'p', deps);
    expect(r.ok).toBe(true);
    expect(r.payload.Comments.length).toBeLessThanOrEqual(254);
  });

  // v991 (SecAudit run-1 HIGH #5): trueVendor override
  describe('v991 trueVendor override (anti ownerVendor spoof)', () => {
    it('sin trueVendor: usa pedido.ownerVendor (retrocompat)', () => {
      const deps = makeDeps({ sapVendors: new Map([['GONZALO DE LA ROSA', 12]]) });
      const r = buildQuotationPayload(validPedido, 'p', deps);
      expect(r.ok).toBe(true);
      expect(r.payload.SalesPersonCode).toBe(12);
    });
    it('trueVendor="MARTIN": override pedido.ownerVendor="GONZALO"', () => {
      const deps = makeDeps({
        sapVendors: new Map([
          ['GONZALO DE LA ROSA', 12],
          ['MARTIN BOIERO', 7],
        ]),
      });
      const r = buildQuotationPayload(validPedido, 'p', deps, 'MARTIN BOIERO');
      expect(r.ok).toBe(true);
      // SlpCode debe ser del trueVendor (7), NO del pedido.ownerVendor (12).
      expect(r.payload.SalesPersonCode).toBe(7);
    });
    it('trueVendor null: cae al pedido.ownerVendor (fallback)', () => {
      const deps = makeDeps({ sapVendors: new Map([['GONZALO DE LA ROSA', 12]]) });
      const r = buildQuotationPayload(validPedido, 'p', deps, null);
      expect(r.ok).toBe(true);
      expect(r.payload.SalesPersonCode).toBe(12);
    });
    it('trueVendor sin mapping en sapVendors: SlpCode -1 (defensivo)', () => {
      const deps = makeDeps({ sapVendors: new Map([['GONZALO DE LA ROSA', 12]]) });
      const r = buildQuotationPayload(validPedido, 'p', deps, 'VENDEDOR NUEVO');
      expect(r.ok).toBe(true);
      expect(r.payload.SalesPersonCode).toBe(-1);
    });
  });
});

// ---- handleAutoSendSap ----------------------------------------------------

describe('handleAutoSendSap — happy path', () => {
  it('envia OK y escribe transferidoSAP.docNum', async () => {
    const deps = makeDeps({
      dbDocs: { 'pedidos/p1': { ...validPedido } },
      slScenarios: { docNum: 12345, docEntry: 999 },
    });
    const r = await handleAutoSendSap('p1', null, { ...validPedido }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK);
    expect(r.docNum).toBe(12345);
    const after = deps.fbDb._dump()['pedidos/p1'];
    expect(after.transferidoSAP.docNum).toBe(12345);
    expect(after.transferidoSAP.via).toBe('cf_auto');
    expect(after.sendingSapLock).toBeUndefined();
  });
});

describe('handleAutoSendSap — skips', () => {
  it('skip: transferidoSAP ya existe (guard en isEligible)', async () => {
    const deps = makeDeps();
    const r = await handleAutoSendSap(
      'p1',
      null,
      {
        ...validPedido,
        transferidoSAP: { docNum: 1 },
      },
      deps
    );
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_ALREADY_SENT);
    expect(deps.sl.fetch).not.toHaveBeenCalled();
  });
  it('skip: 100% BO', async () => {
    const deps = makeDeps();
    const r = await handleAutoSendSap(
      'p1',
      null,
      {
        ...validPedido,
        lines: [{ code: 'X', qty: 5, state: 'BO' }],
      },
      deps
    );
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_ALL_BO);
  });
  // v982 (2026-09-17): all_bo detectado server-side persiste marker
  // transferidoSAP.via='app_only' para observability (antes quedaba null).
  it('v982: 100% BO persiste transferidoSAP.via=app_only server-side', async () => {
    const deps = makeDeps();
    const r = await handleAutoSendSap(
      'p1',
      null,
      {
        ...validPedido,
        lines: [{ code: 'X', qty: 5, state: 'BO' }],
      },
      deps
    );
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_ALL_BO);
    const persisted = deps.fbDb._dump()['pedidos/p1'];
    expect(persisted).toBeDefined();
    expect(persisted.transferidoSAP).toBeDefined();
    expect(persisted.transferidoSAP.via).toBe('app_only');
    expect(persisted.transferidoSAP.reason).toBe('all_lines_bo_server_detected');
    expect(persisted.transferidoSAP.transferredAt).toBeDefined();
  });
  it('skip: cardCode vacio (cliente sin alta SAP)', async () => {
    const deps = makeDeps();
    const r = await handleAutoSendSap('p1', null, { ...validPedido, clientCardCode: '' }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_NO_CARDCODE);
    expect(deps.sl.fetch).not.toHaveBeenCalled();
  });
  it('skip: after ya era confirmed (no es transicion)', async () => {
    const deps = makeDeps();
    const r = await handleAutoSendSap(
      'p1',
      { ...validPedido },
      { ...validPedido, condicionPago: 'CHEQUE' },
      deps
    );
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_STAGE);
    expect(r.reason).toBe('no_transition');
  });
});

describe('handleAutoSendSap — idempotencia', () => {
  it('skip: lock activo de otra sesion', async () => {
    const now = 1700000000000;
    const deps = makeDeps({
      now,
      dbDocs: {
        'pedidos/p1': {
          ...validPedido,
          sendingSapLock: { sessionId: 'other', at: now - 60000, by: 'other-user' },
        },
      },
    });
    const r = await handleAutoSendSap('p1', null, { ...validPedido }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SKIP_LOCKED);
    expect(deps.sl.fetch).not.toHaveBeenCalled();
  });
  it('OK: lock EXPIRADO (>5min) — override + envia', async () => {
    const now = 1700000000000;
    const deps = makeDeps({
      now,
      dbDocs: {
        'pedidos/p1': {
          ...validPedido,
          sendingSapLock: { sessionId: 'stale', at: now - 400000, by: 'stale-user' },
        },
      },
    });
    const r = await handleAutoSendSap('p1', null, { ...validPedido }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK);
  });
});

// v991 (SecAudit run-1 HIGH #5): handleAutoSendSap resuelve trueVendor via
// deps.getUserVendor y lo pasa a buildQuotationPayload. Un VDE spoofeando
// ownerVendor via devtools YA no puede desviar comision.
describe('handleAutoSendSap — v991 trueVendor server-side lookup', () => {
  it('llama getUserVendor(ownerUid) y usa el resultado en SlpCode', async () => {
    const getUserVendor = vi.fn(async () => 'MARTIN BOIERO');
    const deps = makeDeps({
      dbDocs: {
        'pedidos/p1': {
          ...validPedido,
          ownerUid: 'u_atacante',
          ownerVendor: 'GONZALO DE LA ROSA', // spoofeado
        },
      },
      sapVendors: new Map([
        ['GONZALO DE LA ROSA', 12],
        ['MARTIN BOIERO', 7],
      ]),
    });
    deps.getUserVendor = getUserVendor;
    const r = await handleAutoSendSap(
      'p1',
      null,
      { ...validPedido, ownerUid: 'u_atacante', ownerVendor: 'GONZALO DE LA ROSA' },
      deps
    );
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK);
    expect(getUserVendor).toHaveBeenCalledWith('u_atacante');
    // La request POST a /Quotations debe haber usado SlpCode=7 (MARTIN, true),
    // NO 12 (GONZALO, spoofeado).
    const quotCall = deps.sl.fetch.mock.calls.find((c) => c[0].endsWith('/Quotations'));
    const body = JSON.parse(quotCall[1].body);
    expect(body.SalesPersonCode).toBe(7);
  });

  it('sin getUserVendor: fallback a pedido.ownerVendor (retrocompat tests core)', async () => {
    const deps = makeDeps({
      dbDocs: { 'pedidos/p1': { ...validPedido } },
      sapVendors: new Map([['GONZALO DE LA ROSA', 12]]),
    });
    // No getUserVendor inyectado
    const r = await handleAutoSendSap('p1', null, { ...validPedido }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK);
    const quotCall = deps.sl.fetch.mock.calls.find((c) => c[0].endsWith('/Quotations'));
    const body = JSON.parse(quotCall[1].body);
    expect(body.SalesPersonCode).toBe(12); // ownerVendor del pedido
  });

  it('getUserVendor throw: no bloquea envio, cae al fallback + loguea warning', async () => {
    const getUserVendor = vi.fn(async () => {
      throw new Error('firestore unavailable');
    });
    // Necesita ownerUid para que el core intente el getUserVendor lookup.
    const pedWithOwner = { ...validPedido, ownerUid: 'u_gonzalo' };
    const deps = makeDeps({
      dbDocs: { 'pedidos/p1': pedWithOwner },
      sapVendors: new Map([['GONZALO DE LA ROSA', 12]]),
    });
    deps.getUserVendor = getUserVendor;
    const r = await handleAutoSendSap('p1', null, pedWithOwner, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.SENT_OK);
    // Fallback: usa pedido.ownerVendor -> SlpCode 12
    const quotCall = deps.sl.fetch.mock.calls.find((c) => c[0].endsWith('/Quotations'));
    const body = JSON.parse(quotCall[1].body);
    expect(body.SalesPersonCode).toBe(12);
    // Loguea el error de getUserVendor
    const logCalls = deps.sl.log.mock.calls.map((c) => String(c[0]));
    expect(logCalls.some((m) => m.includes('getUserVendor fail'))).toBe(true);
  });

  it('trueVendor divergent: loguea warning con detalles (audit trail)', async () => {
    const getUserVendor = vi.fn(async () => 'MARTIN BOIERO'); // real
    const deps = makeDeps({
      dbDocs: {
        'pedidos/p1': {
          ...validPedido,
          ownerUid: 'u_x',
          ownerVendor: 'GONZALO DE LA ROSA', // spoof
        },
      },
      sapVendors: new Map([
        ['GONZALO DE LA ROSA', 12],
        ['MARTIN BOIERO', 7],
      ]),
    });
    deps.getUserVendor = getUserVendor;
    await handleAutoSendSap(
      'p1',
      null,
      { ...validPedido, ownerUid: 'u_x', ownerVendor: 'GONZALO DE LA ROSA' },
      deps
    );
    const warnCall = deps.sl.log.mock.calls.find((c) =>
      String(c[0]).includes('WARN ownerVendor divergent')
    );
    expect(warnCall).toBeDefined();
    expect(warnCall[1]).toMatchObject({
      ownerUid: 'u_x',
      pedidoOwnerVendor: 'GONZALO DE LA ROSA',
      trueVendor: 'MARTIN BOIERO',
    });
  });
});

describe('handleAutoSendSap — errores SL', () => {
  it('error SL: libera lock y retorna ERROR_SL', async () => {
    const deps = makeDeps({
      dbDocs: { 'pedidos/p1': { ...validPedido } },
      slScenarios: { quotError: { status: 400, msg: 'CardCode not found' } },
    });
    const r = await handleAutoSendSap('p1', null, { ...validPedido }, deps);
    expect(r.result).toBe(AUTO_SEND_RESULT.ERROR_SL);
    expect(r.error).toContain('CardCode');
    const after = deps.fbDb._dump()['pedidos/p1'];
    expect(after.sendingSapLock).toBeUndefined();
    expect(after.transferidoSAP).toBeUndefined();
  });
});
