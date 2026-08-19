import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyInvoiceMatch, syncSapInvoices } from '../../functions/core/invoice-sync-core.js';

/** Fake Firestore que emula .doc().get()/.set() y .collection().where().get() */
function makeFakeFbDb(initialState = {}) {
  const store = {
    syncState: initialState.syncState || null,
    pedidos: initialState.pedidos || [], // array de { id, data }
  };
  const writes = [];
  return {
    _writes: writes,
    _store: store,
    doc(path) {
      return {
        async get() {
          if (path === 'app_config/sap_sync_state') {
            return {
              exists: !!store.syncState,
              data: () => store.syncState || {},
            };
          }
          if (path.startsWith('pedidos/')) {
            const id = path.split('/')[1];
            const p = store.pedidos.find((x) => x.id === id);
            return { exists: !!p, data: () => (p ? p.data : {}) };
          }
          return { exists: false, data: () => ({}) };
        },
        async set(data, opts) {
          if (path === 'app_config/sap_sync_state') {
            store.syncState = { ...(store.syncState || {}), ...data };
            writes.push({ type: 'set', path, data, opts });
          }
        },
        async update(data) {
          if (path.startsWith('pedidos/')) {
            const id = path.split('/')[1];
            const p = store.pedidos.find((x) => x.id === id);
            if (p) p.data = { ...p.data, ...data };
            writes.push({ type: 'update', path, data });
          }
        },
      };
    },
    collection(name) {
      const parent = this;
      return {
        doc(id) {
          return parent.doc(`${name}/${id}`);
        },
        where(field, op, values) {
          return {
            async get() {
              if (name !== 'pedidos' || field !== 'transferidoSAP.docEntry' || op !== 'in') {
                return { forEach: () => {} };
              }
              const set = new Set(values);
              const matches = store.pedidos.filter((p) => {
                const de = p.data && p.data.transferidoSAP && p.data.transferidoSAP.docEntry;
                return set.has(de);
              });
              return {
                forEach(cb) {
                  for (const m of matches) cb({ id: m.id, data: () => m.data });
                },
              };
            },
          };
        },
      };
    },
  };
}

/** Helpers para armar respuestas SAP mock. */
function slLoginResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'B1SESSION=abc; path=/, ROUTEID=.n1; path=/' },
    text: async () => JSON.stringify({ SessionId: 'abc' }),
  };
}

function slLogoutResponse() {
  return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
}

function slJsonResponse(body, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

function makeDeps(over = {}) {
  return {
    fetch: vi.fn(),
    sapConfig: {
      url: 'https://sap.test',
      companyDB: 'DB',
      userName: 'U',
      password: 'P',
    },
    fbDb: makeFakeFbDb(),
    log: vi.fn(),
    ...over,
  };
}

/**
 * Configura el mock de fetch para responder a login/logout/Invoices/Orders
 * segun el URL. `routes` es un dict de path->body.
 */
function wireFetch(deps, routes) {
  deps.fetch.mockImplementation(async (url) => {
    if (url.endsWith('/b1s/v1/Login')) return slLoginResponse();
    if (url.endsWith('/b1s/v1/Logout')) return slLogoutResponse();
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) return slJsonResponse(body);
    }
    return slJsonResponse({ value: [] });
  });
}

describe('syncSapInvoices — shadow mode', () => {
  it('sin invoices nuevas: cursor no cambia', async () => {
    const deps = makeDeps({ fbDb: makeFakeFbDb({ syncState: { lastInvoiceDocEntry: 500 } }) });
    wireFetch(deps, { '/Invoices?': { value: [] } });
    const r = await syncSapInvoices(deps);
    expect(r.cursorBefore).toBe(500);
    expect(r.cursorAfter).toBe(500);
    expect(r.invoicesRead).toBe(0);
    expect(r.matches).toEqual([]);
    expect(r.mode).toBe('shadow');
  });

  it('cursor inicial 0 si no hay state', async () => {
    const deps = makeDeps();
    wireFetch(deps, { '/Invoices?': { value: [] } });
    const r = await syncSapInvoices(deps);
    expect(r.cursorBefore).toBe(0);
  });

  it('invoice con lineage completo -> match a pedido-app', async () => {
    const fbDb = makeFakeFbDb({
      syncState: { lastInvoiceDocEntry: 0 },
      pedidos: [
        {
          id: 'PEDIDO_APP_1',
          data: {
            transferidoSAP: { docEntry: 3001, docNum: 'SQ3001' },
            lines: [{ code: 'SKU-X', qty: 10 }],
          },
        },
      ],
    });
    const deps = makeDeps({ fbDb });
    wireFetch(deps, {
      '/Invoices?': {
        value: [
          {
            DocEntry: 101,
            DocNum: 'INV101',
            DocDate: '2026-08-18',
            DocumentStatus: 'bost_Close',
            CardCode: 'C001',
            DocumentLines: [
              {
                LineNum: 0,
                ItemCode: 'SKU-X',
                Quantity: 10,
                BaseType: 17,
                BaseEntry: 2001,
                BaseLine: 0,
              },
            ],
          },
        ],
      },
      '/Orders(2001)': {
        DocEntry: 2001,
        DocumentLines: [{ LineNum: 0, ItemCode: 'SKU-X', BaseType: 23, BaseEntry: 3001 }],
      },
    });
    const r = await syncSapInvoices(deps);
    expect(r.invoicesRead).toBe(1);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({
      invoiceDocEntry: 101,
      sqDocEntry: 3001,
      soDocEntry: 2001,
      pedidoAppId: 'PEDIDO_APP_1',
    });
    expect(r.matches[0].lines).toEqual([{ itemCode: 'SKU-X', qty: 10, lineNum: 0 }]);
    expect(r.cursorAfter).toBe(101);
    expect(r.orphans).toEqual([]);
  });

  it('invoice sin lineage (no BaseType=17) -> orphan no_lineage_to_sq', async () => {
    const deps = makeDeps();
    wireFetch(deps, {
      '/Invoices?': {
        value: [
          {
            DocEntry: 102,
            DocNum: 'INV102',
            DocDate: '2026-08-18',
            DocumentStatus: 'bost_Close',
            CardCode: 'C002',
            DocumentLines: [
              // Invoice sin BaseType (venta directa sin SO)
              { LineNum: 0, ItemCode: 'SKU-Y', Quantity: 5 },
            ],
          },
        ],
      },
    });
    const r = await syncSapInvoices(deps);
    expect(r.matches).toEqual([]);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0]).toMatchObject({
      invoiceDocEntry: 102,
      reason: 'no_lineage_to_sq',
    });
  });

  it('invoice con SQ sin pedido-app -> orphan no_pedido_match', async () => {
    const deps = makeDeps(); // fbDb vacio
    wireFetch(deps, {
      '/Invoices?': {
        value: [
          {
            DocEntry: 103,
            DocNum: 'INV103',
            DocumentLines: [
              {
                LineNum: 0,
                ItemCode: 'SKU-Z',
                Quantity: 3,
                BaseType: 17,
                BaseEntry: 2002,
                BaseLine: 0,
              },
            ],
          },
        ],
      },
      '/Orders(2002)': {
        DocEntry: 2002,
        DocumentLines: [{ LineNum: 0, ItemCode: 'SKU-Z', BaseType: 23, BaseEntry: 3999 }],
      },
    });
    const r = await syncSapInvoices(deps);
    expect(r.matches).toEqual([]);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0].reason).toBe('no_pedido_match');
  });

  it('invoice con SQ que matchea 2 pedidos-app -> orphan multi_pedido_match', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        { id: 'P1', data: { transferidoSAP: { docEntry: 4001 } } },
        { id: 'P2', data: { transferidoSAP: { docEntry: 4001 } } },
      ],
    });
    const deps = makeDeps({ fbDb });
    wireFetch(deps, {
      '/Invoices?': {
        value: [
          {
            DocEntry: 104,
            DocNum: 'INV104',
            DocumentLines: [
              {
                LineNum: 0,
                ItemCode: 'X',
                Quantity: 1,
                BaseType: 17,
                BaseEntry: 2003,
                BaseLine: 0,
              },
            ],
          },
        ],
      },
      '/Orders(2003)': {
        DocEntry: 2003,
        DocumentLines: [{ LineNum: 0, ItemCode: 'X', BaseType: 23, BaseEntry: 4001 }],
      },
    });
    const r = await syncSapInvoices(deps);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0].reason).toBe('multi_pedido_match');
  });

  it('shadow mode NUNCA modifica pedidos (solo escribe sync_state)', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [{ id: 'P1', data: { transferidoSAP: { docEntry: 5001 } } }],
    });
    const deps = makeDeps({ fbDb });
    wireFetch(deps, {
      '/Invoices?': {
        value: [
          {
            DocEntry: 200,
            DocumentLines: [
              {
                LineNum: 0,
                ItemCode: 'X',
                Quantity: 1,
                BaseType: 17,
                BaseEntry: 2004,
                BaseLine: 0,
              },
            ],
          },
        ],
      },
      '/Orders(2004)': {
        DocumentLines: [{ LineNum: 0, BaseType: 23, BaseEntry: 5001 }],
      },
    });
    await syncSapInvoices(deps);
    // Solo se escribio sync_state (cursor update). Ninguna escritura a pedidos.
    expect(fbDb._writes.every((w) => w.path === 'app_config/sap_sync_state')).toBe(true);
    expect(fbDb._writes.length).toBe(1);
  });

  it('cursor avanza al max DocEntry de la corrida', async () => {
    const deps = makeDeps();
    wireFetch(deps, {
      '/Invoices?': {
        value: [
          { DocEntry: 500, DocumentLines: [] },
          { DocEntry: 501, DocumentLines: [] },
          { DocEntry: 502, DocumentLines: [] },
        ],
      },
    });
    const r = await syncSapInvoices(deps);
    expect(r.cursorAfter).toBe(502);
  });
});

describe('applyInvoiceMatch (E5 active mode)', () => {
  function _pedido(overrides = {}) {
    return {
      id: 'P1',
      data: {
        clientCardCode: 'C001',
        closedAt: null,
        lines: [
          {
            code: 'SKU-A',
            qty: 10,
            qtyInvoiced: 0,
            qtyCancelled: 0,
            qtyRecycled: 0,
            qtyOpen: 10,
            state: 'confirmed',
          },
          {
            code: 'SKU-B',
            qty: 5,
            qtyInvoiced: 0,
            qtyCancelled: 0,
            qtyRecycled: 0,
            qtyOpen: 5,
            state: 'BO',
          },
        ],
        sapLinkage: {},
        ...overrides,
      },
    };
  }

  it('aplica qtyInvoiced += qty por linea y marca state="invoiced" al cerrar', async () => {
    const fbDb = makeFakeFbDb({ pedidos: [_pedido()] });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3001,
      invoiceDocNum: 12345,
      invoiceDocDate: '2026-08-19',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P1',
      lines: [
        { itemCode: 'SKU-A', qty: 10, lineNum: 0 },
        { itemCode: 'SKU-B', qty: 3, lineNum: 1 },
      ],
    };
    const r = await applyInvoiceMatch(deps, match);
    expect(r).toEqual({ closed: false }); // SKU-B queda con 2 abiertas
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyInvoiced).toBe(10);
    expect(p.lines[0].qtyOpen).toBe(0);
    expect(p.lines[0].state).toBe('invoiced');
    expect(p.lines[1].qtyInvoiced).toBe(3);
    expect(p.lines[1].qtyOpen).toBe(2);
    expect(p.lines[1].state).toBe('BO'); // no cambio: qtyOpen>0
    expect(p.sapLinkage.appliedInvoiceDocEntries).toEqual([3001]);
    expect(p.sapLinkage.lastInvoiceDocEntry).toBe(3001);
    expect(p.closedAt).toBeNull();
  });

  it('cierra el pedido cuando todas las lineas quedan en qtyOpen=0', async () => {
    const fbDb = makeFakeFbDb({ pedidos: [_pedido()] });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3002,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P1',
      lines: [
        { itemCode: 'SKU-A', qty: 10, lineNum: 0 },
        { itemCode: 'SKU-B', qty: 5, lineNum: 1 },
      ],
    };
    const r = await applyInvoiceMatch(deps, match);
    expect(r).toEqual({ closed: true });
    const p = fbDb._store.pedidos[0].data;
    expect(p.closedAt).not.toBeNull();
    expect(p.closedReason).toBe('all_invoiced');
    expect(p.lines.every((l) => l.state === 'invoiced')).toBe(true);
  });

  it('idempotencia: rerun con mismo invoiceDocEntry NO duplica qtyInvoiced', async () => {
    const fbDb = makeFakeFbDb({ pedidos: [_pedido()] });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3003,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P1',
      lines: [{ itemCode: 'SKU-A', qty: 4, lineNum: 0 }],
    };
    await applyInvoiceMatch(deps, match);
    const r2 = await applyInvoiceMatch(deps, match);
    expect(r2).toBeNull(); // skip
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyInvoiced).toBe(4); // no duplico
  });

  it('multiples lineas SAP con mismo itemCode suman antes de aplicar', async () => {
    const fbDb = makeFakeFbDb({ pedidos: [_pedido()] });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3004,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P1',
      lines: [
        { itemCode: 'SKU-A', qty: 3, lineNum: 0 },
        { itemCode: 'SKU-A', qty: 2, lineNum: 1 }, // split en 2 lineas SAP
      ],
    };
    await applyInvoiceMatch(deps, match);
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyInvoiced).toBe(5); // 3+2 sumados
    expect(p.lines[0].qtyOpen).toBe(5);
  });

  it('pedido inexistente: return null, sin error', async () => {
    const fbDb = makeFakeFbDb({ pedidos: [] });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3005,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'FANTASMA',
      lines: [{ itemCode: 'X', qty: 1, lineNum: 0 }],
    };
    const r = await applyInvoiceMatch(deps, match);
    expect(r).toBeNull();
  });

  it('SKUs de la Invoice que no matchean lineas del pedido: skip esa linea, sigue con las otras', async () => {
    const fbDb = makeFakeFbDb({ pedidos: [_pedido()] });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3006,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P1',
      lines: [
        { itemCode: 'SKU-Z', qty: 100, lineNum: 0 }, // no existe en pedido
        { itemCode: 'SKU-A', qty: 5, lineNum: 1 },
      ],
    };
    await applyInvoiceMatch(deps, match);
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyInvoiced).toBe(5); // solo SKU-A aplicado
    expect(p.lines[1].qtyInvoiced).toBe(0); // SKU-B sin invoice
  });

  it('respeta qtyCancelled y qtyRecycled en el calculo de qtyOpen', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P1',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [
              {
                code: 'X',
                qty: 10,
                qtyInvoiced: 0,
                qtyCancelled: 2,
                qtyRecycled: 3,
                qtyOpen: 5,
                state: 'BO',
              },
            ],
            sapLinkage: {},
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3007,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P1',
      lines: [{ itemCode: 'X', qty: 5, lineNum: 0 }],
    };
    const r = await applyInvoiceMatch(deps, match);
    // qtyOpen = 10 - 5 (invoiced) - 2 (cancelled) - 3 (recycled) = 0 -> closed
    expect(r).toEqual({ closed: true });
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyOpen).toBe(0);
    expect(p.lines[0].state).toBe('invoiced');
  });

  it('no re-abre pedido ya cerrado (idempotencia dura)', async () => {
    const closedAt = '2026-08-01T00:00:00Z';
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P1',
          data: {
            clientCardCode: 'C001',
            closedAt,
            closedReason: 'manual',
            lines: [
              {
                code: 'X',
                qty: 10,
                qtyInvoiced: 10,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 0,
                state: 'invoiced',
              },
            ],
            sapLinkage: {},
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 3008,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P1',
      lines: [{ itemCode: 'X', qty: 3, lineNum: 0 }],
    };
    await applyInvoiceMatch(deps, match);
    const p = fbDb._store.pedidos[0].data;
    // qtyInvoiced sube porque puede haber notas de credito o ajustes,
    // pero closedAt/closedReason NO se pisan.
    expect(p.qtyInvoiced || p.lines[0].qtyInvoiced).toBe(13);
    expect(p.closedAt).toBe(closedAt);
    expect(p.closedReason).toBe('manual');
  });
});
