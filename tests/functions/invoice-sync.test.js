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
  // v600 E1 (2026-08-24): B es 'confirmed' (no 'BO'). Bajo la nueva semantica
  // post-split, lineas BO nunca reciben invoice — nunca viajaron a SAP como
  // parte de este SQ. Tests dedicados al skip BO estan mas abajo.
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
            state: 'confirmed',
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
    expect(p.lines[1].state).toBe('confirmed'); // no cambio: qtyOpen>0
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
                // v600 E1: cambiado de 'BO' a 'confirmed'. Bajo nueva semantica
                // lineas BO no reciben invoice. El intent del test es validar
                // el calculo qtyOpen = qty - invoiced - cancelled - recycled,
                // que aplica igual con state 'confirmed'.
                state: 'confirmed',
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

  // ============================================================
  // v600 E1 (2026-08-24): tests split de linea + skip BO/ASIG
  // ============================================================

  it('SPLIT: pedido con 2 lineas mismo SKU (confirmed + BO), invoice cubre confirmed -> solo confirmed invoiced', async () => {
    // Escenario post-E2/E3: cliente pidio 100 de SKU-X, disp al confirmar era
    // 70. Split creo 2 lineas: {qty:70, state:'confirmed'} y {qty:30, state:'BO'}.
    // El SQ mandado a SAP fue solo por 70 (linea confirmed). Ahora llega invoice
    // por 70 -> solo la linea confirmed debe recibir el invoice.
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P_SPLIT',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [
              {
                code: 'SKU-X',
                qty: 70,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 70,
                state: 'confirmed',
              },
              {
                code: 'SKU-X',
                qty: 30,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 30,
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
      invoiceDocEntry: 4001,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P_SPLIT',
      lines: [{ itemCode: 'SKU-X', qty: 70, lineNum: 0 }],
    };
    const r = await applyInvoiceMatch(deps, match);
    // Pedido no cerrado: la linea BO sigue abierta (30 qtyOpen).
    expect(r).toEqual({ closed: false });
    const p = fbDb._store.pedidos[0].data;
    // Linea confirmed (index 0): totalmente invoiced.
    expect(p.lines[0].qtyInvoiced).toBe(70);
    expect(p.lines[0].qtyOpen).toBe(0);
    expect(p.lines[0].state).toBe('invoiced');
    // Linea BO (index 1): INTACTA. NO recibe invoice.
    expect(p.lines[1].qtyInvoiced).toBe(0);
    expect(p.lines[1].qtyOpen).toBe(30);
    expect(p.lines[1].state).toBe('BO');
  });

  it('SPLIT: 2 lineas confirmed mismo SKU, invoice parcial reparte FIFO', async () => {
    // Caso: 2 lineas confirmed del mismo SKU (ej: 2 productos agregados por
    // separado con el mismo code). Invoice parcial debe repartir consumiendo
    // en orden de aparicion (FIFO por lineIndex).
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P_MULTI',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [
              {
                code: 'SKU-Y',
                qty: 50,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 50,
                state: 'confirmed',
              },
              {
                code: 'SKU-Y',
                qty: 20,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 20,
                state: 'confirmed',
              },
            ],
            sapLinkage: {},
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 4002,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P_MULTI',
      lines: [{ itemCode: 'SKU-Y', qty: 60, lineNum: 0 }],
    };
    await applyInvoiceMatch(deps, match);
    const p = fbDb._store.pedidos[0].data;
    // Primera linea consume 50 (openBefore=50, applyQty=min(60,50)=50).
    expect(p.lines[0].qtyInvoiced).toBe(50);
    expect(p.lines[0].qtyOpen).toBe(0);
    expect(p.lines[0].state).toBe('invoiced');
    // Segunda linea consume el remaining 10.
    expect(p.lines[1].qtyInvoiced).toBe(10);
    expect(p.lines[1].qtyOpen).toBe(10);
    expect(p.lines[1].state).toBe('confirmed');
  });

  it('SPLIT: invoice sobre linea BO unica (edge case hybrid mode) -> NO se aplica', async () => {
    // Escenario hybrid: SAP-source genera invoice para un SKU que en el
    // pedido-app quedo state='BO'. Bajo nueva semantica: la linea BO no
    // recibe el invoice (nunca viajo a SAP como este SQ). El invoice queda
    // "orphan" desde la perspectiva del pedido-app — se logea pero no se
    // aplica. Comportamiento intencional.
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P_BO_ONLY',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [
              {
                code: 'SKU-Z',
                qty: 20,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 20,
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
      invoiceDocEntry: 4003,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P_BO_ONLY',
      lines: [{ itemCode: 'SKU-Z', qty: 20, lineNum: 0 }],
    };
    const r = await applyInvoiceMatch(deps, match);
    // No hubo cambios en lineas -> return null (idempotencia natural).
    expect(r).toBeNull();
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyInvoiced).toBe(0);
    expect(p.lines[0].state).toBe('BO');
  });

  it('SPLIT: overflow (nota de credito) sobre confirmed con hermana BO -> solo confirmed', async () => {
    // Caso overflow: linea A confirmed ya invoiced 70. Llega ajuste por 5
    // adicionales (credit note / correccion). Debe aplicar a A, NO a la
    // hermana BO aunque tenga el mismo code.
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P_OVERFLOW',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [
              {
                code: 'SKU-W',
                qty: 70,
                qtyInvoiced: 70,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 0,
                state: 'invoiced',
              },
              {
                code: 'SKU-W',
                qty: 30,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 30,
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
      invoiceDocEntry: 4004,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P_OVERFLOW',
      lines: [{ itemCode: 'SKU-W', qty: 5, lineNum: 0 }],
    };
    await applyInvoiceMatch(deps, match);
    const p = fbDb._store.pedidos[0].data;
    // Linea invoiced recibe el overflow (75 total, > qty=70).
    expect(p.lines[0].qtyInvoiced).toBe(75);
    // Linea BO INTACTA.
    expect(p.lines[1].qtyInvoiced).toBe(0);
    expect(p.lines[1].qtyOpen).toBe(30);
    expect(p.lines[1].state).toBe('BO');
  });

  it('SPLIT: linea ASIG tampoco recibe invoice (mismo skip que BO)', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P_ASIG',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [
              {
                code: 'SKU-V',
                qty: 40,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 40,
                state: 'confirmed',
              },
              {
                code: 'SKU-V',
                qty: 10,
                qtyInvoiced: 0,
                qtyCancelled: 0,
                qtyRecycled: 0,
                qtyOpen: 10,
                state: 'ASIG',
              },
            ],
            sapLinkage: {},
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const match = {
      invoiceDocEntry: 4005,
      invoiceDocNum: 1,
      invoiceDocDate: '',
      cardCode: 'C001',
      sqDocEntry: 999,
      soDocEntry: 888,
      pedidoAppId: 'P_ASIG',
      lines: [{ itemCode: 'SKU-V', qty: 40, lineNum: 0 }],
    };
    await applyInvoiceMatch(deps, match);
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyInvoiced).toBe(40);
    expect(p.lines[0].state).toBe('invoiced');
    expect(p.lines[1].qtyInvoiced).toBe(0);
    expect(p.lines[1].state).toBe('ASIG');
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
