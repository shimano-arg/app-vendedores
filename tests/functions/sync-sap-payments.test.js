import { describe, expect, it, vi } from 'vitest';
import {
  applyPaymentUpdate,
  handleSyncSapPayments,
} from '../../functions/core/sync-sap-payments-core.js';

// ---- Fake Firestore -------------------------------------------------------

function makeFakeFbDb(pedidos) {
  const store = new Map(pedidos.map((p) => [p.id, { ...p.data }]));
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    doc(_path) {
      throw new Error('doc() no soportado en este test');
    },
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
 * SL response mock. Devuelve invoices desde `invoicesByDocEntry` paginados.
 * Simula login/logout con 204/200 respectivamente.
 */
function makeFakeFetch(invoicesByDocEntry, opts = {}) {
  const invoicesArr = Object.entries(invoicesByDocEntry)
    .map(([de, info]) => ({
      DocEntry: Number(de),
      DocTotal: info.docTotal,
      PaidToDate: info.paidToDate,
    }))
    .sort((a, b) => b.DocEntry - a.DocEntry);
  const failAtScan = opts.failAtScan; // number of pages before throwing
  let scanCount = 0;
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
    if (url.includes('/Invoices?')) {
      scanCount++;
      if (failAtScan && scanCount > failAtScan) {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      const skipMatch = url.match(/\$skip=(\d+)/);
      const topMatch = url.match(/\$top=(\d+)/);
      const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
      const top = topMatch ? parseInt(topMatch[1], 10) : 20;
      const page = invoicesArr.slice(skip, skip + top);
      return new Response(JSON.stringify({ value: page }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected url ' + url }), { status: 404 });
  };
}

function makeDeps(pedidos, invoicesByDocEntry, opts = {}) {
  return {
    fetch: makeFakeFetch(invoicesByDocEntry, opts),
    sapConfig: { url: 'https://sap.test:50000', companyDB: 'test', userName: 'u', password: 'p' },
    fbDb: makeFakeFbDb(pedidos),
    log: vi.fn(),
    invoicesLookahead: 100,
  };
}

// ---- Tests ---------------------------------------------------------------

describe('handleSyncSapPayments', () => {
  it('case 1: sin pedidos → skip cero-cost, no session', async () => {
    const deps = makeDeps([], {});
    const r = await handleSyncSapPayments(deps);
    expect(r.pedidosChecked).toBe(0);
    expect(r.invoicesScanned).toBe(0);
    expect(r.pedidosUpdated).toBe(0);
  });

  it('case 2: pedido con 1 invoice fully paid → paidStatus=paid + update', async () => {
    const pedidos = [
      {
        id: 'ped-1',
        data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [1001] } },
      },
    ];
    const invoices = { 1001: { docTotal: 500000, paidToDate: 500000 } };
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    expect(r.pedidosChecked).toBe(1);
    expect(r.pedidosUpdated).toBe(1);
    expect(r.pedidosPaidFull).toBe(1);
    const stored = deps.fbDb._store.get('ped-1');
    expect(stored.paidStatus).toBe('paid');
    expect(stored.paidAmount).toBe(500000);
    expect(stored.invoicedAmount).toBe(500000);
  });

  it('case 3: pedido con 2 invoices parcialmente pagas → paidStatus=partial', async () => {
    const pedidos = [
      {
        id: 'ped-2',
        data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [2001, 2002] } },
      },
    ];
    const invoices = {
      2001: { docTotal: 300000, paidToDate: 150000 },
      2002: { docTotal: 200000, paidToDate: 0 },
    };
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    expect(r.pedidosPaidPartial).toBe(1);
    const stored = deps.fbDb._store.get('ped-2');
    expect(stored.paidStatus).toBe('partial');
    expect(stored.paidAmount).toBe(150000);
    expect(stored.invoicedAmount).toBe(500000);
  });

  it('case 4: pedido con paidToDate=0 → paidStatus=null', async () => {
    const pedidos = [
      {
        id: 'ped-3',
        data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [3001] } },
      },
    ];
    const invoices = { 3001: { docTotal: 100000, paidToDate: 0 } };
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    expect(r.pedidosPaidFull).toBe(0);
    expect(r.pedidosPaidPartial).toBe(0);
    const stored = deps.fbDb._store.get('ped-3');
    expect(stored.paidStatus).toBe(null);
  });

  it('case 5: idempotencia — misma corrida 2 veces solo actualiza 1', async () => {
    const pedidos = [
      {
        id: 'ped-4',
        data: {
          closedAt: null,
          sapLinkage: { appliedInvoiceDocEntries: [4001] },
          invoicedAmount: 400000,
          paidAmount: 400000,
          paidStatus: 'paid',
        },
      },
    ];
    const invoices = { 4001: { docTotal: 400000, paidToDate: 400000 } };
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    // Ya está en el estado final → no update
    expect(r.pedidosUpdated).toBe(0);
    expect(r.pedidosPaidFull).toBe(1); // el count sigue reflejando el estado
  });

  it('case 6: invoice fuera del rango scan (invoicesMissedInWindow > 0)', async () => {
    const pedidos = [
      {
        id: 'ped-5',
        data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [5001, 9999] } },
      },
    ];
    // Solo 5001 aparece en el enum. 9999 no está en el mock → miss.
    const invoices = { 5001: { docTotal: 100000, paidToDate: 50000 } };
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    expect(r.invoicesMissedInWindow).toBe(1);
    const stored = deps.fbDb._store.get('ped-5');
    // Solo contamos las invoices que sí aparecieron
    expect(stored.invoicedAmount).toBe(100000);
    expect(stored.paidAmount).toBe(50000);
    expect(stored.paidStatus).toBe('partial');
  });

  it('case 7: paginación — 30 invoices en 2 páginas (page size default 20)', async () => {
    const pedidos = [
      {
        id: 'ped-6',
        data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [6001, 6025] } },
      },
    ];
    const invoices = {};
    for (let i = 6001; i <= 6030; i++) {
      invoices[i] = { docTotal: 1000, paidToDate: 1000 };
    }
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    // Ambos docEntries están en el rango
    expect(r.invoicesScanned).toBe(30);
    expect(r.invoicesMissedInWindow).toBe(0);
    const stored = deps.fbDb._store.get('ped-6');
    expect(stored.paidStatus).toBe('paid');
  });

  it('case 8: pedido sin appliedInvoiceDocEntries → no aparece en listPedidos', async () => {
    const pedidos = [
      {
        id: 'ped-with',
        data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [8001] } },
      },
      { id: 'ped-without', data: { closedAt: null, sapLinkage: {} } },
      { id: 'ped-null-linkage', data: { closedAt: null } },
    ];
    const invoices = { 8001: { docTotal: 100, paidToDate: 100 } };
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    expect(r.pedidosChecked).toBe(1);
  });

  it('case 9: tolerancia $1 en paidStatus (paidToDate == docTotal - 0.5)', async () => {
    const pedidos = [
      {
        id: 'ped-tol',
        data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [9001] } },
      },
    ];
    const invoices = { 9001: { docTotal: 100000, paidToDate: 99999.5 } };
    const deps = makeDeps(pedidos, invoices);
    const r = await handleSyncSapPayments(deps);
    // 99999.5 >= 100000 - 1 → paid
    expect(r.pedidosPaidFull).toBe(1);
  });

  it('case 10: applyPaymentUpdate directo con invoiceMap manual', async () => {
    const deps = makeDeps(
      [{ id: 'ped-x', data: { sapLinkage: { appliedInvoiceDocEntries: [111, 222] } } }],
      {}
    );
    const invoiceMap = new Map([
      [111, { docTotal: 200, paidToDate: 100 }],
      [222, { docTotal: 300, paidToDate: 300 }],
    ]);
    const data = deps.fbDb._store.get('ped-x');
    const r = await applyPaymentUpdate(deps, 'ped-x', data, invoiceMap);
    expect(r.updated).toBe(true);
    expect(r.invoicedAmount).toBe(500);
    expect(r.paidAmount).toBe(400);
    expect(r.paidStatus).toBe('partial');
  });

  // v1042 (2026-09-23): fix invoice consolidada — split proporcional
  it('case 11 (v1042): invoice compartida por 2 pedidos → split proporcional al netAmountArs', async () => {
    // Simula caso real MUNDO ESTURION: 2 pedidos con invoice 33815 compartida.
    // Ped1 net=20.667.600, Ped2 net=9.965.000. Invoice docTotal=$21.536.159.
    // Split esperado: Ped1 68% ($14.6M), Ped2 32% ($7.0M). Total = $21.5M (no $43M).
    const pedidos = [
      {
        id: 'ped-esturion-1',
        data: {
          closedAt: null,
          netAmountArs: 20667600,
          sapLinkage: { appliedInvoiceDocEntries: [33815] },
        },
      },
      {
        id: 'ped-esturion-2',
        data: {
          closedAt: null,
          netAmountArs: 9965000,
          sapLinkage: { appliedInvoiceDocEntries: [33815] },
        },
      },
    ];
    const invoices = { 33815: { docTotal: 21536159.4, paidToDate: 21536159.4 } };
    const deps = makeDeps(pedidos, invoices);
    await handleSyncSapPayments(deps);
    const p1 = deps.fbDb._store.get('ped-esturion-1');
    const p2 = deps.fbDb._store.get('ped-esturion-2');
    // Verificar split (tolerancia 1 peso por floating point).
    const expected1 = 21536159.4 * (20667600 / (20667600 + 9965000));
    const expected2 = 21536159.4 * (9965000 / (20667600 + 9965000));
    expect(p1.paidAmount).toBeCloseTo(expected1, 0);
    expect(p2.paidAmount).toBeCloseTo(expected2, 0);
    // Suma debe reconstruir el total (no duplicar).
    expect(p1.paidAmount + p2.paidAmount).toBeCloseTo(21536159.4, 0);
  });

  it('case 12 (v1042): pedido sin netAmountArs cuando invoice compartida → split parejo (fallback 50/50)', async () => {
    const pedidos = [
      { id: 'ped-a', data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [999] } } },
      { id: 'ped-b', data: { closedAt: null, sapLinkage: { appliedInvoiceDocEntries: [999] } } },
    ];
    const invoices = { 999: { docTotal: 100000, paidToDate: 50000 } };
    const deps = makeDeps(pedidos, invoices);
    await handleSyncSapPayments(deps);
    const a = deps.fbDb._store.get('ped-a');
    const b = deps.fbDb._store.get('ped-b');
    expect(a.paidAmount).toBe(25000);
    expect(b.paidAmount).toBe(25000);
    expect(a.invoicedAmount).toBe(50000);
    expect(b.invoicedAmount).toBe(50000);
  });

  it('case 13 (v1042): invoice NO compartida sigue funcionando 1:1 sin fracción', async () => {
    const pedidos = [
      {
        id: 'ped-solo',
        data: {
          closedAt: null,
          netAmountArs: 500000,
          sapLinkage: { appliedInvoiceDocEntries: [77777] },
        },
      },
    ];
    const invoices = { 77777: { docTotal: 500000, paidToDate: 500000 } };
    const deps = makeDeps(pedidos, invoices);
    await handleSyncSapPayments(deps);
    const p = deps.fbDb._store.get('ped-solo');
    expect(p.paidAmount).toBe(500000);
    expect(p.invoicedAmount).toBe(500000);
    expect(p.paidStatus).toBe('paid');
  });
});
