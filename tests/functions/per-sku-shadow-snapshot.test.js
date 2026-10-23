// @ts-check
/**
 * E1 §stock-servidor-atomico — test que verifica que `recalcSnapshotForSkus`
 * escribe en AMBOS: `app_config/stock_snapshot_app` (legacy) + `stock_snapshot/{SKU}`
 * (shadow).
 */
import { describe, expect, it, vi } from 'vitest';
import { recalcSnapshotForSkus } from '../../functions/core/pedido-snapshot-core.js';

function makeDeps(pedidosFixture, modeDocData = { mode: 'active' }) {
  const writes = [];
  const perSkuWrites = [];
  const fbDb = {
    collection(name) {
      const col = {
        _name: name,
        where() {
          return col;
        },
        async get() {
          if (name === 'pedidos') {
            const docs = pedidosFixture.map((p, idx) => ({
              id: p._fsId || 'p' + idx,
              data: () => p,
            }));
            return {
              empty: false,
              docs,
              forEach(fn) {
                docs.forEach(fn);
              },
            };
          }
          return { empty: true, docs: [], forEach() {} };
        },
        doc(docId) {
          return {
            _docId: docId,
            async get() {
              if (name === 'app_config' && docId === 'sap_sync_state') {
                return { exists: true, data: () => modeDocData };
              }
              if (name === 'app_config') {
                return { exists: true, data: () => ({}) };
              }
              return { exists: false, data: () => null };
            },
            async set(data, opts) {
              const path = name + '/' + docId;
              if (name === 'stock_snapshot') {
                perSkuWrites.push({ sku: docId, data });
              } else {
                writes.push({ path, op: 'set', data, opts });
              }
            },
            async update(data) {
              const path = name + '/' + docId;
              writes.push({ path, op: 'update', data });
            },
          };
        },
      };
      return col;
    },
    doc(path) {
      const [col, id] = path.split('/');
      return this.collection(col).doc(id);
    },
  };
  return {
    fbDb,
    log: vi.fn(),
    FieldValue: { delete: () => '__DELETE__', serverTimestamp: () => '__TS__' },
    _writes: writes,
    _perSkuWrites: perSkuWrites,
  };
}

describe('E1 §stock-servidor-atomico — per-SKU shadow snapshot', () => {
  it('recalcSnapshotForSkus escribe stock_snapshot/{SKU} además del snapshot global', async () => {
    const pedidos = [
      {
        _fsId: 'ped1',
        closedAt: null,
        clientCardCode: 'C001',
        clientName: 'CLIENTE X',
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        transferidoSAP: { docEntry: 123, docNum: 123, transferredAt: new Date().toISOString() },
        lines: [
          { code: 'SKU-A', state: 'ASIG', qty: 3, qtyOpen: 3, asigAt: new Date().toISOString() },
        ],
      },
      {
        _fsId: 'ped2',
        closedAt: null,
        clientCardCode: 'C002',
        clientName: 'CLIENTE Y',
        createdAt: new Date().toISOString(),
        transferidoSAP: { docEntry: 124, docNum: 124, transferredAt: new Date().toISOString() },
        lines: [
          { code: 'SKU-A', state: 'BO', qty: 2, qtyOpen: 2 },
          { code: 'SKU-B', state: 'BO', qty: 5, qtyOpen: 5 },
        ],
      },
    ];
    const deps = makeDeps(pedidos);
    const affectedSkus = new Set(['SKU-A', 'SKU-B']);

    const result = await recalcSnapshotForSkus(deps, affectedSkus);

    // Verificar global write
    expect(deps._writes.length).toBeGreaterThanOrEqual(1);

    // Verificar per-SKU shadow writes
    expect(deps._perSkuWrites.length).toBe(2);
    const skuAWrite = deps._perSkuWrites.find((w) => w.sku === 'SKU-A');
    const skuBWrite = deps._perSkuWrites.find((w) => w.sku === 'SKU-B');
    expect(skuAWrite).toBeTruthy();
    expect(skuBWrite).toBeTruthy();
    expect(skuAWrite.data.sku).toBe('SKU-A');
    expect(skuAWrite.data.asignadas.total).toBe(3);
    expect(skuAWrite.data.backorderApp.total).toBe(2);
    expect(skuBWrite.data.asignadas.total).toBe(0);
    expect(skuBWrite.data.backorderApp.total).toBe(5);
    expect(skuAWrite.data._version).toBe('app_v8_shadow_e1');

    expect(result.perSkuShadowWritten).toBe(2);
  });

  it('byClient preservado en el shadow', async () => {
    const pedidos = [
      {
        _fsId: 'ped1',
        closedAt: null,
        clientCardCode: 'C001',
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        transferidoSAP: { docEntry: 123, docNum: 123, transferredAt: new Date().toISOString() },
        lines: [
          { code: 'SKU-X', state: 'ASIG', qty: 2, qtyOpen: 2, asigAt: new Date().toISOString() },
        ],
      },
      {
        _fsId: 'ped2',
        closedAt: null,
        clientCardCode: 'C002',
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        transferidoSAP: { docEntry: 123, docNum: 123, transferredAt: new Date().toISOString() },
        lines: [
          { code: 'SKU-X', state: 'ASIG', qty: 5, qtyOpen: 5, asigAt: new Date().toISOString() },
        ],
      },
    ];
    const deps = makeDeps(pedidos);
    await recalcSnapshotForSkus(deps, new Set(['SKU-X']));

    const skuXWrite = deps._perSkuWrites.find((w) => w.sku === 'SKU-X');
    expect(skuXWrite).toBeTruthy();
    expect(skuXWrite.data.asignadas.byClient).toEqual({ C001: 2, C002: 5 });
    expect(skuXWrite.data.asignadas.total).toBe(7);
  });

  it('affectedSkus vacío → nada se escribe en shadow', async () => {
    const deps = makeDeps([]);
    const result = await recalcSnapshotForSkus(deps, new Set());
    expect(deps._perSkuWrites.length).toBe(0);
    expect(result.skusRecalculated).toBe(0);
  });
});
