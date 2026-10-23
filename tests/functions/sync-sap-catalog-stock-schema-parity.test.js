// @ts-check
/**
 * §63 Fase 3 Capa 1 FIX URGENTE (2026-10-23) — PARITY test entre schema
 * del snapshot producido por `scripts/sync_sap_to_firestore.py` (Python,
 * fuente de verdad) y el producido por `syncSapCatalogStockCore` (CF Node).
 *
 * Mariano reporte: la CF escribió el snapshot con shape incorrecto (dicts
 * en vez de JSON strings) → cliente parsea como string JSON → stock=0 en
 * todas las pantallas. Prod bloqueado 2026-10-23 ~16:25 ART hasta restaurar
 * con workflow Python dispatch.
 *
 * Este test garantiza que la CF escribe EXACTAMENTE el mismo shape que
 * Python para el mismo input Items. Se corre antes de cada reanudación
 * del Scheduler para prevenir regresión.
 *
 * Qué compara:
 *   1. TOP-LEVEL field names.
 *   2. Qué fields son JSON strings vs objects.
 *   3. Deep equality de los contenidos parseados.
 *   4. Rename warehouseCommittedBreakdown (NO warehouseCommitted).
 *   5. Rename preLanzamientoBySku (NO preLanzamiento).
 */
import { describe, expect, it, vi } from 'vitest';
import { _resetPool } from '../../functions/core/sap-sl-session.js';
import { syncSapCatalogStockCore } from '../../functions/core/sync-sap-catalog-stock-core.js';

const SAP_CFG = {
  url: 'https://sap.test',
  companyDB: 'TEST',
  userName: 'U',
  password: 'P',
};

function makeFirestore() {
  const state = { app_config: {}, product_catalog: {}, operations_log: {} };
  const written = [];
  const makeDoc = (col, id) => ({
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data, opts) {
      state[col] ||= {};
      if (opts && opts.merge) {
        state[col][id] = { ...(state[col][id] || {}), ...data };
      } else {
        state[col][id] = data;
      }
      written.push({ op: opts && opts.merge ? 'set+merge' : 'set', path: `${col}/${id}`, data });
    },
    async update(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
    },
    async delete() {
      if (state[col]) delete state[col][id];
    },
  });
  const makeCol = (col) => ({
    doc(id) {
      return makeDoc(col, id || 'auto');
    },
    add(d) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = d;
      return Promise.resolve({ id });
    },
    async get() {
      const colData = state[col] || {};
      const docs = Object.entries(colData).map(([id, data]) => ({ id, data: () => data }));
      return { forEach: (fn) => docs.forEach(fn) };
    },
  });
  return {
    fbDb: {
      collection: (c) => makeCol(c),
      doc(path) {
        const [c, id] = path.split('/');
        return makeDoc(c, id);
      },
    },
    _state: state,
    _written: written,
  };
}

function makeFetchMock(items) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/Login')) {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (n) => (n.toLowerCase() === 'set-cookie' ? 'B1SESSION=X; path=/' : null),
        },
      };
    }
    if (u.endsWith('/Logout')) {
      return { ok: true, status: 204, headers: { get: () => null } };
    }
    if (u.includes('/ItemGroups?')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { value: [{ Number: 102, GroupName: 'PESCA' }] };
        },
      };
    }
    if (u.includes('/Items?')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { value: items };
        },
      };
    }
    throw new Error('unexpected ' + u);
  });
}

/**
 * Fixture canónico — 3 Items con shape SAP SL.
 * Mix: whs 11 only, whs 11+12, PRE LANZAMIENTO, item sin ItemPrices, Committed > 0.
 */
const CANONICAL_ITEMS = [
  {
    ItemCode: 'CLC70MHAAR',
    ItemName: 'CAÑA CLARUS 70MH ACC',
    ItemWarehouseInfoCollection: [
      { WarehouseCode: '11', InStock: 10, Committed: 2 },
      { WarehouseCode: '12', InStock: 5, Committed: 0 },
      { WarehouseCode: '05', InStock: 100, Committed: 0 }, // non-sales
    ],
    ItemPrices: [
      { PriceList: 1, Price: 0 },
      { PriceList: 12, Price: 34000 },
    ],
    U_CICLO_PROD: null,
  },
  {
    ItemCode: 'CLS70XH2CH',
    ItemName: 'CAÑA CLARUS 70XH SPIN',
    ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 2, Committed: 0 }],
    ItemPrices: [{ PriceList: 12, Price: 30000 }],
    U_CICLO_PROD: null,
  },
  {
    ItemCode: 'NEW-PRE',
    ItemName: 'ITEM PRE-LANZAMIENTO',
    ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 5, Committed: 0 }],
    ItemPrices: [],
    U_CICLO_PROD: 'PRE LANZAMIENTO',
  },
];

/**
 * Lo que Python escribe (fuente de verdad). Replica exacta del write de
 * scripts/sync_sap_to_firestore.py líneas 748-785.
 */
function computePythonExpectedSnapshot() {
  const stock = { CLC70MHAAR: true, CLS70XH2CH: true, 'NEW-PRE': true };
  const quantities = { CLC70MHAAR: 13, CLS70XH2CH: 2, 'NEW-PRE': 5 };
  const warehouseBreakdown = {
    CLC70MHAAR: { 11: 8, 12: 5 }, // 11: InStock 10 - Committed 2
    CLS70XH2CH: { 11: 2 },
    'NEW-PRE': { 11: 5 },
  };
  const warehouseCommitted = { CLC70MHAAR: { 11: 2 } };
  const price = { CLC70MHAAR: 34000, CLS70XH2CH: 30000 };
  const preLanzamiento = { 'NEW-PRE': true };
  return {
    stock,
    quantities: JSON.stringify(quantities),
    warehouseBreakdown: JSON.stringify(warehouseBreakdown),
    warehouseCommittedBreakdown: JSON.stringify(warehouseCommitted),
    price,
    preLanzamientoBySku: JSON.stringify(preLanzamiento),
    totalItems: 3,
    withStock: 3,
    warehouse: 'ALL_SALES',
    // backorderBySku NO lo escribe la CF; Python sí. merge:true preserva el
    // field previo. En este test (snapshot vacío inicial) backorderBySku
    // queda undefined; no se compara.
  };
}

describe('§63 Fase 3 Capa 1 — schema parity CF vs Python', () => {
  it('T1 — top-level field names iguales a Python', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
      now: () => 1_700_000_000_000,
    });
    const cfSnap = _state.app_config.stock_snapshot;
    const pyExpected = computePythonExpectedSnapshot();
    for (const key of Object.keys(pyExpected)) {
      expect(cfSnap, `falta field ${key}`).toHaveProperty(key);
    }
    // Nombres específicos que SE RENOMBRARON para parity:
    expect(cfSnap).toHaveProperty('warehouseCommittedBreakdown');
    expect(cfSnap).toHaveProperty('preLanzamientoBySku');
    // Nombres previos (incorrectos) NO deben estar.
    expect(cfSnap.warehouseCommitted).toBeUndefined();
    expect(cfSnap.preLanzamiento).toBeUndefined();
  });

  it('T2 — quantities es JSON STRING, no dict', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    expect(typeof cfSnap.quantities).toBe('string');
    const parsed = JSON.parse(cfSnap.quantities);
    expect(parsed).toEqual({ CLC70MHAAR: 13, CLS70XH2CH: 2, 'NEW-PRE': 5 });
  });

  it('T3 — warehouseBreakdown es JSON STRING, no dict', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    expect(typeof cfSnap.warehouseBreakdown).toBe('string');
    const parsed = JSON.parse(cfSnap.warehouseBreakdown);
    // Keys numericas 11, 12 → como strings "11", "12" (JSON standard)
    expect(parsed.CLC70MHAAR).toEqual({ 11: 8, 12: 5 });
    expect(parsed.CLS70XH2CH).toEqual({ 11: 2 });
    expect(parsed['NEW-PRE']).toEqual({ 11: 5 });
  });

  it('T4 — warehouseCommittedBreakdown es JSON STRING + solo SKUs con committed>0', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    expect(typeof cfSnap.warehouseCommittedBreakdown).toBe('string');
    const parsed = JSON.parse(cfSnap.warehouseCommittedBreakdown);
    expect(parsed.CLC70MHAAR).toEqual({ 11: 2 });
    expect(parsed.CLS70XH2CH).toBeUndefined(); // sin committed → no entra
  });

  it('T5 — preLanzamientoBySku es JSON STRING + solo SKUs PRE LANZAMIENTO', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    expect(typeof cfSnap.preLanzamientoBySku).toBe('string');
    const parsed = JSON.parse(cfSnap.preLanzamientoBySku);
    expect(parsed).toEqual({ 'NEW-PRE': true });
  });

  it('T6 — stock y price son dicts (NO JSON strings, igual a Python)', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    expect(typeof cfSnap.stock).toBe('object');
    expect(cfSnap.stock.CLC70MHAAR).toBe(true);
    expect(typeof cfSnap.price).toBe('object');
    expect(cfSnap.price.CLC70MHAAR).toBe(34000);
  });

  it('T7 — meta fields totalItems, withStock, warehouse presentes', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    expect(cfSnap.totalItems).toBe(3);
    expect(cfSnap.withStock).toBe(3);
    expect(cfSnap.warehouse).toBe('ALL_SALES');
    expect(cfSnap.source).toBe('cf-scheduled');
  });

  it('T8 — set() usa merge:true (preserva backorderBySku previo)', async () => {
    _resetPool();
    const { fbDb, _state, _written } = makeFirestore();
    // Simular que ya hay un snapshot previo (escrito por Python) con backorderBySku.
    _state.app_config.stock_snapshot = {
      backorderBySku: JSON.stringify({ CLC70MHAAR: 3 }),
      stock: { OLD: true },
    };
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    // backorderBySku previo preservado.
    expect(cfSnap.backorderBySku).toBe(JSON.stringify({ CLC70MHAAR: 3 }));
    // stock pisado por el nuevo.
    expect(cfSnap.stock.OLD).toBeUndefined();
    expect(cfSnap.stock.CLC70MHAAR).toBe(true);
    // Verificar que fue set+merge, no set.
    const setCall = _written.find((w) => w.path === 'app_config/stock_snapshot');
    expect(setCall.op).toBe('set+merge');
  });

  it('T9 — product_catalog_meta usa totalChunks (no chunksCount) + updatedAt (no syncedAt)', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const meta = _state.app_config.product_catalog_meta;
    expect(meta).toBeTruthy();
    expect(meta).toHaveProperty('totalChunks');
    expect(meta).toHaveProperty('updatedAt');
    expect(meta).toHaveProperty('updatedBy');
    expect(meta.chunksCount).toBeUndefined(); // nombre viejo removido
    expect(meta.syncedAt).toBeUndefined(); // nombre viejo removido
  });

  it('T10 — Python expected snapshot: parity completa en los 6 fields core', async () => {
    _resetPool();
    const { fbDb, _state } = makeFirestore();
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: makeFetchMock(CANONICAL_ITEMS) },
      log: () => {},
      source: 'cf-scheduled',
    });
    const cfSnap = _state.app_config.stock_snapshot;
    const py = computePythonExpectedSnapshot();
    // stock + price: dict literal.
    expect(cfSnap.stock).toEqual(py.stock);
    expect(cfSnap.price).toEqual(py.price);
    // quantities + warehouseBreakdown + warehouseCommittedBreakdown + preLanzamientoBySku: JSON string.
    expect(JSON.parse(cfSnap.quantities)).toEqual(JSON.parse(py.quantities));
    expect(JSON.parse(cfSnap.warehouseBreakdown)).toEqual(JSON.parse(py.warehouseBreakdown));
    expect(JSON.parse(cfSnap.warehouseCommittedBreakdown)).toEqual(
      JSON.parse(py.warehouseCommittedBreakdown)
    );
    expect(JSON.parse(cfSnap.preLanzamientoBySku)).toEqual(JSON.parse(py.preLanzamientoBySku));
    expect(cfSnap.totalItems).toBe(py.totalItems);
    expect(cfSnap.withStock).toBe(py.withStock);
    expect(cfSnap.warehouse).toBe(py.warehouse);
  });
});
