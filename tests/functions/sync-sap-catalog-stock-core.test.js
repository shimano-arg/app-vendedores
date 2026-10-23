// @ts-check
/**
 * §63 Fase 3 Capa 1 (v1444) — tests para sync-sap-catalog-stock-core.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetPool } from '../../functions/core/sap-sl-session.js';
import { syncSapCatalogStockCore } from '../../functions/core/sync-sap-catalog-stock-core.js';

beforeEach(() => _resetPool());

function makeFirestore() {
  const state = { app_config: {}, product_catalog: {}, operations_log: {} };
  const written = [];
  const makeDoc = (col, id) => ({
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
      written.push({ op: 'set', path: `${col}/${id}`, data });
    },
    async update(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
      written.push({ op: 'update', path: `${col}/${id}`, data });
    },
    async delete() {
      if (state[col]) delete state[col][id];
      written.push({ op: 'delete', path: `${col}/${id}` });
    },
  });
  const makeCol = (col) => ({
    doc(id) {
      return makeDoc(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
    },
    add(d) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = d;
      written.push({ op: 'add', path: `${col}/${id}`, data: d });
      return Promise.resolve({ id });
    },
    async get() {
      const colData = state[col] || {};
      const docs = Object.entries(colData).map(([id, data]) => ({
        id,
        data: () => data,
        exists: true,
      }));
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

function makeFetchMock(itemsPayload) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/Login')) {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) =>
            name.toLowerCase() === 'set-cookie' ? 'B1SESSION=COOKIE_X; path=/; HttpOnly' : null,
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
          return { value: [{ Number: 100, GroupName: 'PESCA' }] };
        },
      };
    }
    if (u.includes('/Items?')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return itemsPayload;
        },
      };
    }
    throw new Error('unexpected ' + u);
  });
}

const SAP_CFG = {
  url: 'https://sap.test',
  companyDB: 'SBO_TEST',
  userName: 'MANAGER',
  password: 'xxx',
};

describe('§63 Capa 1 — sync-sap-catalog-stock-core', () => {
  it('T1 — happy path 2 items: stock_snapshot escrito con source + _syncRun', async () => {
    const { fbDb, _state, _written } = makeFirestore();
    const fetchFn = makeFetchMock({
      value: [
        {
          ItemCode: 'SKU1',
          ItemName: 'ITEM 1',
          ItemWarehouseInfoCollection: [
            { WarehouseCode: '11', InStock: 10, Committed: 2 },
            { WarehouseCode: '12', InStock: 5, Committed: 0 },
          ],
          ItemPrices: [{ PriceList: 12, Price: 100 }],
          U_CICLO_PROD: null,
        },
        {
          ItemCode: 'SKU2',
          ItemName: 'PRE-LANZ',
          ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 5, Committed: 0 }],
          ItemPrices: [],
          U_CICLO_PROD: 'PRE LANZAMIENTO',
        },
      ],
    });
    const result = await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: fetchFn },
      log: () => {},
      source: 'cf-scheduled',
      now: () => 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
    expect(result.itemsSynced).toBe(2);
    expect(result.withStock).toBe(2);
    expect(result.withPrice).toBe(1);
    expect(result.withPreLanzamiento).toBe(1);
    const snap = _state.app_config.stock_snapshot;
    expect(snap).toBeTruthy();
    expect(snap.source).toBe('cf-scheduled');
    expect(snap.stock.SKU1).toBe(true);
    expect(snap.quantities.SKU1).toBe(13);
    expect(snap.warehouseBreakdown.SKU1['11']).toBe(8); // InStock 10 - Committed 2
    expect(snap.warehouseCommitted.SKU1['11']).toBe(2);
    expect(snap.price.SKU1).toBe(100);
    expect(snap.preLanzamiento.SKU2).toBe(true);
    expect(snap._syncRun.source).toBe('cf-scheduled');
    expect(snap._syncRun.itemsSynced).toBe(2);
  });

  it('T2 — operations_log entry con type stock_sync_run + ok:true', async () => {
    const { fbDb, _state } = makeFirestore();
    const fetchFn = makeFetchMock({
      value: [
        {
          ItemCode: 'SKU1',
          ItemName: 'X',
          ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 1, Committed: 0 }],
          ItemPrices: [],
        },
      ],
    });
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: fetchFn },
      log: () => {},
      source: 'cf-scheduled',
    });
    const logs = Object.values(_state.operations_log || {});
    expect(logs.length).toBe(1);
    expect(logs[0].type).toBe('stock_sync_run');
    expect(logs[0].source).toBe('cf-scheduled');
    expect(logs[0].ok).toBe(true);
    expect(logs[0].itemsSynced).toBe(1);
  });

  it('T3 — product_catalog_meta escrito con source + syncBatchId', async () => {
    const { fbDb, _state } = makeFirestore();
    const fetchFn = makeFetchMock({ value: [] });
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: fetchFn },
      log: () => {},
      source: 'cf-scheduled',
    });
    const meta = _state.app_config.product_catalog_meta;
    expect(meta).toBeTruthy();
    expect(meta.source).toBe('cf-scheduled');
    expect(meta.syncBatchId).toBeTruthy();
    expect(meta.totalItems).toBe(0);
  });

  it('T4 — items con whs 05/06 (NON_SALES) → se excluyen del cálculo', async () => {
    const { fbDb, _state } = makeFirestore();
    const fetchFn = makeFetchMock({
      value: [
        {
          ItemCode: 'SKU1',
          ItemName: 'X',
          ItemWarehouseInfoCollection: [
            { WarehouseCode: '05', InStock: 100, Committed: 0 }, // marketing
            { WarehouseCode: '06', InStock: 50, Committed: 0 }, // devoluciones
            { WarehouseCode: '11', InStock: 3, Committed: 0 },
          ],
          ItemPrices: [],
        },
      ],
    });
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: fetchFn },
      log: () => {},
      source: 'cf-scheduled',
    });
    const snap = _state.app_config.stock_snapshot;
    expect(snap.quantities.SKU1).toBe(3); // solo whs 11
    expect(snap.warehouseBreakdown.SKU1['11']).toBe(3);
    expect(snap.warehouseBreakdown.SKU1['05']).toBeUndefined();
  });

  it('T5 — has_stk solo true si whs 11 > 0 (§26 v1002)', async () => {
    const { fbDb, _state } = makeFirestore();
    const fetchFn = makeFetchMock({
      value: [
        {
          ItemCode: 'SKU_07_ONLY',
          ItemName: 'solo whs 07',
          ItemWarehouseInfoCollection: [{ WarehouseCode: '07', InStock: 1, Committed: 0 }],
          ItemPrices: [],
        },
      ],
    });
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: fetchFn },
      log: () => {},
      source: 'cf-scheduled',
    });
    const snap = _state.app_config.stock_snapshot;
    expect(snap.stock.SKU_07_ONLY).toBe(false);
    expect(snap.quantities.SKU_07_ONLY).toBe(1);
  });

  it('T6 — preserva fam/sub/cat/img del product_catalog existente', async () => {
    const { fbDb, _state } = makeFirestore();
    _state.product_catalog = {
      chunk_0: {
        items: [
          { code: 'SKU1', desc: 'OLD DESC', fam: 'ROD', sub: 'SPIN', cat: 'A', img: 'u1.jpg' },
        ],
      },
    };
    const fetchFn = makeFetchMock({
      value: [
        {
          ItemCode: 'SKU1',
          ItemName: 'NEW DESC',
          ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 2, Committed: 0 }],
          ItemPrices: [],
        },
      ],
    });
    await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: fetchFn },
      log: () => {},
      source: 'cf-scheduled',
    });
    const chunk0 = _state.product_catalog.chunk_0;
    expect(chunk0.items[0].code).toBe('SKU1');
    expect(chunk0.items[0].desc).toBe('NEW DESC');
    expect(chunk0.items[0].fam).toBe('ROD');
    expect(chunk0.items[0].sub).toBe('SPIN');
    expect(chunk0.items[0].img).toBe('u1.jpg');
  });

  it('T7 — SL error (login fallo) → result.ok=false + operations_log ok:false', async () => {
    const { fbDb, _state } = makeFirestore();
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/Login')) {
        return {
          ok: false,
          status: 400,
          async text() {
            return 'cupo excedido';
          },
          headers: { get: () => null },
        };
      }
      throw new Error('unexpected');
    });
    const result = await syncSapCatalogStockCore({
      fbDb,
      sapConfig: { ...SAP_CFG, fetch: fetchFn },
      log: () => {},
      source: 'cf-scheduled',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const logs = Object.values(_state.operations_log || {});
    expect(logs[0].ok).toBe(false);
  });
});
