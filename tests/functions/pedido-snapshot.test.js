import { describe, expect, it, vi } from 'vitest';
import {
  aggregateForSku,
  extractAffectedSkus,
  readSyncMode,
  recalcSnapshotForSkus,
} from '../../functions/core/pedido-snapshot-core.js';

function makeFakeFbDb(initialState = {}) {
  const store = {
    syncState: initialState.syncState || null,
    pedidos: initialState.pedidos || [],
    snapshots: {},
  };
  const writes = [];
  return {
    _writes: writes,
    _store: store,
    doc(path) {
      return {
        async get() {
          if (path === 'app_config/sap_sync_state') {
            return { exists: !!store.syncState, data: () => store.syncState || {} };
          }
          return { exists: false, data: () => ({}) };
        },
        async set(data, opts) {
          store.snapshots[path] = { ...(store.snapshots[path] || {}), ...data };
          writes.push({ type: 'set', path, data, opts });
        },
      };
    },
    collection(name) {
      return {
        where(field, op, value) {
          return {
            async get() {
              if (name !== 'pedidos') return { forEach: () => {} };
              const filtered = store.pedidos.filter((p) => {
                if (field === 'closedAt' && op === '==' && value === null) {
                  return !p.data.closedAt;
                }
                return true;
              });
              return {
                forEach(cb) {
                  for (const p of filtered) cb({ id: p.id, data: () => p.data });
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('extractAffectedSkus', () => {
  it('union de before y after lines', () => {
    const before = {
      lines: [
        { code: 'A', state: 'BO' },
        { code: 'B', state: 'ASIG' },
      ],
    };
    const after = {
      lines: [
        { code: 'B', state: 'ASIG' },
        { code: 'C', state: 'BO' },
      ],
    };
    const skus = extractAffectedSkus(before, after);
    expect(Array.from(skus).sort()).toEqual(['A', 'B', 'C']);
  });

  it('ignora state=legacy', () => {
    const after = {
      lines: [
        { code: 'X', state: 'legacy' },
        { code: 'Y', state: 'BO' },
      ],
    };
    const skus = extractAffectedSkus(null, after);
    expect(Array.from(skus)).toEqual(['Y']);
  });

  it('normaliza SKU a upper', () => {
    const after = { lines: [{ code: 'sku-x', state: 'BO' }] };
    const skus = extractAffectedSkus(null, after);
    expect(Array.from(skus)).toEqual(['SKU-X']);
  });

  it('vacio si ambos undefined', () => {
    const skus = extractAffectedSkus(null, null);
    expect(skus.size).toBe(0);
  });
});

describe('aggregateForSku', () => {
  it('suma BO + ASIG separados', () => {
    const pedidos = [
      {
        clientCardCode: 'C001',
        closedAt: null,
        lines: [{ code: 'SKU-X', qtyOpen: 5, state: 'BO' }],
      },
      {
        clientCardCode: 'C002',
        closedAt: null,
        lines: [{ code: 'SKU-X', qtyOpen: 3, state: 'ASIG' }],
      },
      {
        clientCardCode: 'C003',
        closedAt: null,
        lines: [{ code: 'SKU-X', qtyOpen: 2, state: 'ASIG' }],
      },
    ];
    const r = aggregateForSku(pedidos, 'SKU-X');
    expect(r.bo).toBe(5);
    expect(r.asig).toBe(5);
    expect(r.asigByClient.get('C002')).toBe(3);
    expect(r.asigByClient.get('C003')).toBe(2);
  });

  it('excluye pedidos cerrados', () => {
    const pedidos = [
      { closedAt: '2026-08-01', lines: [{ code: 'X', qtyOpen: 5, state: 'BO' }] },
      { closedAt: null, lines: [{ code: 'X', qtyOpen: 3, state: 'BO' }] },
    ];
    const r = aggregateForSku(pedidos, 'X');
    expect(r.bo).toBe(3);
  });

  it('excluye state=legacy y state=confirmed', () => {
    const pedidos = [
      { closedAt: null, lines: [{ code: 'X', qtyOpen: 10, state: 'legacy' }] },
      { closedAt: null, lines: [{ code: 'X', qtyOpen: 20, state: 'confirmed' }] },
      { closedAt: null, lines: [{ code: 'X', qtyOpen: 5, state: 'BO' }] },
    ];
    const r = aggregateForSku(pedidos, 'X');
    expect(r.bo).toBe(5);
    expect(r.asig).toBe(0);
  });

  it('acumula ASIG del mismo cliente en varios pedidos', () => {
    const pedidos = [
      { clientCardCode: 'C1', closedAt: null, lines: [{ code: 'X', qtyOpen: 3, state: 'ASIG' }] },
      { clientCardCode: 'C1', closedAt: null, lines: [{ code: 'X', qtyOpen: 4, state: 'ASIG' }] },
    ];
    const r = aggregateForSku(pedidos, 'X');
    expect(r.asigByClient.get('C1')).toBe(7);
  });
});

describe('readSyncMode', () => {
  it('default shadow si no existe state', async () => {
    const deps = { fbDb: makeFakeFbDb(), log: vi.fn() };
    expect(await readSyncMode(deps)).toBe('shadow');
  });
  it('lee active si mode=active', async () => {
    const deps = { fbDb: makeFakeFbDb({ syncState: { mode: 'active' } }), log: vi.fn() };
    expect(await readSyncMode(deps)).toBe('active');
  });
  it('fallback shadow para valores desconocidos', async () => {
    const deps = { fbDb: makeFakeFbDb({ syncState: { mode: 'foo' } }), log: vi.fn() };
    expect(await readSyncMode(deps)).toBe('shadow');
  });
});

describe('recalcSnapshotForSkus — shadow', () => {
  it('escribe a stock_snapshot_shadow_v3 (no toca stock_snapshot)', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P1',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [{ code: 'SKU-X', qtyOpen: 5, state: 'BO' }],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const skus = new Set(['SKU-X']);
    const r = await recalcSnapshotForSkus(deps, skus);
    expect(r.mode).toBe('shadow');
    expect(r.snapshotDoc).toBe('app_config/stock_snapshot_shadow_v3');
    expect(r.totals['SKU-X']).toEqual({ bo: 5, asig: 0 });
    // NADIE escribio a stock_snapshot
    expect(fbDb._writes.every((w) => w.path === 'app_config/stock_snapshot_shadow_v3')).toBe(true);
  });

  it('active mode escribe a stock_snapshot_app (doc separado)', async () => {
    const fbDb = makeFakeFbDb({
      syncState: { mode: 'active' },
      pedidos: [
        {
          id: 'P1',
          data: {
            clientCardCode: 'C001',
            closedAt: null,
            lines: [{ code: 'X', qtyOpen: 3, state: 'ASIG' }],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const r = await recalcSnapshotForSkus(deps, new Set(['X']));
    expect(r.mode).toBe('active');
    expect(r.snapshotDoc).toBe('app_config/stock_snapshot_app');
    // Solo escribe keys nuevos (backorderBySkuApp, asigBySkuApp, asigByClientSkuApp)
    // — NO pisa backorderBySku (SAP-source).
    // Post-fix 2026-08-19: nested maps (no dotted paths, que el Admin SDK
    // trata literal). merge:true hace deep merge de los sub-maps.
    const write = fbDb._writes[0];
    expect(write.data.asigBySkuApp.X).toBe(3);
    expect(write.data.backorderBySkuApp.X).toBe(0);
    expect(write.data.asigByClientSkuApp['C001::X']).toBe(3);
    expect(write.data.backorderBySku).toBeUndefined(); // NO tocar key SAP-source
  });

  it('sin SKUs afectados: no escribe nada', async () => {
    const fbDb = makeFakeFbDb();
    const deps = { fbDb, log: vi.fn() };
    const r = await recalcSnapshotForSkus(deps, new Set());
    expect(r.skusRecalculated).toBe(0);
    expect(fbDb._writes.length).toBe(0);
  });

  it('agrega multiples SKUs en un solo write', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P1',
          data: {
            clientCardCode: 'C1',
            closedAt: null,
            lines: [
              { code: 'A', qtyOpen: 2, state: 'BO' },
              { code: 'B', qtyOpen: 3, state: 'ASIG' },
            ],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    await recalcSnapshotForSkus(deps, new Set(['A', 'B']));
    expect(fbDb._writes).toHaveLength(1);
    expect(fbDb._writes[0].data.backorderBySkuApp.A).toBe(2);
    expect(fbDb._writes[0].data.asigBySkuApp.B).toBe(3);
  });
});
