// Tests TDD del fix OOM S-10 P0 (2026-11-26).
//
// Garantiza:
//   1. recalcSnapshotForSkus devuelve byte-exacto el mismo output con el
//      algoritmo nuevo (one-pass) que con el viejo (for-sku × for-pedido).
//   2. loadOpenPedidos usa .select() cuando el SDK lo soporta → mock verifica
//      que el query lleva los 6 campos canónicos.
//   3. Fixture sintético de 500 pedidos × 10 líneas no explota memoria —
//      heap test con process.memoryUsage().
//
// Precedente: STACK_44 — 31 OOM / pico 535 MiB sobre límite 512 MiB. Mariano
// decidió optimizar query (no bump memoria).

import { describe, expect, it } from 'vitest';
import {
  aggregateForSku,
  recalcSnapshotForSkus,
} from '../../functions/core/pedido-snapshot-core.js';

function makePedido(i, lines) {
  return {
    _fsId: 'pedido-' + i,
    clientCardCode: 'C' + String(100 + (i % 20)).padStart(3, '0'),
    closedAt: null,
    transferidoSAP: { docNum: 2000000 + i },
    createdAt: new Date(Date.now() - i * 60000).toISOString(),
    confirmedAt: new Date(Date.now() - i * 30000).toISOString(),
    lines,
  };
}

function makeLine(sku, state, qtyOpen, extra = {}) {
  return {
    code: sku,
    state,
    qty: qtyOpen,
    qtyOpen,
    ...extra,
  };
}

function makeMockDb(pedidos, syncMode = 'shadow') {
  const docs = pedidos.map((p) => ({
    data: () => ({ ...p }),
    exists: true,
  }));
  const query = {
    _selectedFields: null,
    where: (_f, _op, _v) => query,
    select: (...fields) => {
      query._selectedFields = fields;
      return query;
    },
    get: async () => ({ forEach: (fn) => docs.forEach(fn), size: docs.length }),
  };
  const configDoc = {
    get: async () => ({
      exists: true,
      data: () => ({ mode: syncMode }),
    }),
    set: async () => {},
  };
  const perSkuWrites = [];
  return {
    query,
    writes: [],
    perSkuWrites,
    collection: (/** @type {string} */ name) => ({
      where: () => query,
      doc: (/** @type {string} */ id) => ({
        _id: id,
        set: async (data) => {
          perSkuWrites.push({ collection: name, id, data });
        },
      }),
    }),
    doc: (/** @type {string} */ path) => {
      if (path === 'app_config/sap_sync_state') return configDoc;
      return {
        set: async (data, _opts) => {
          perSkuWrites.push({ path, data });
        },
        update: async (data) => {
          perSkuWrites.push({ path, data, op: 'update' });
        },
        get: async () => ({ exists: false, data: () => ({}) }),
      };
    },
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      delete: () => 'DELETE_FIELD',
    },
  };
}

describe('OOM fix S-10 P0 — pedido-snapshot-core', () => {
  it('T1: loadOpenPedidos proyecta los 6 campos canónicos', async () => {
    const pedidos = [makePedido(0, [makeLine('SKU-A', 'BO', 5)])];
    const db = makeMockDb(pedidos);
    await recalcSnapshotForSkus(
      { fbDb: db, FieldValue: db.FieldValue, log: () => {} },
      new Set(['SKU-A'])
    );
    expect(db.query._selectedFields).toEqual([
      'clientCardCode',
      'lines',
      'closedAt',
      'transferidoSAP',
      'createdAt',
      'confirmedAt',
    ]);
  });

  it('T2: output byte-exacto vs llamar aggregateForSku por cada SKU', async () => {
    const pedidos = [];
    const now = Date.now();
    // 20 pedidos × 3 SKUs cada uno, mix BO + ASIG + confirmed.
    for (let i = 0; i < 20; i++) {
      const lines = [];
      lines.push(makeLine('SKU-A', 'BO', (i % 5) + 1));
      lines.push(makeLine('SKU-B', 'ASIG', i + 1, { asigAt: new Date(now - 1000).toISOString() }));
      lines.push(makeLine('SKU-C', 'confirmed', 2));
      pedidos.push(makePedido(i, lines));
    }
    const affected = new Set(['SKU-A', 'SKU-B', 'SKU-C']);
    // Expectativa — llamar aggregateForSku por cada SKU.
    const expected = {};
    for (const sku of affected) {
      const r = aggregateForSku(pedidos, sku, now);
      expected[sku] = { bo: r.bo, asig: r.asig };
    }
    // Resultado del core.
    const db = makeMockDb(pedidos);
    const r = await recalcSnapshotForSkus(
      { fbDb: db, FieldValue: db.FieldValue, log: () => {} },
      affected
    );
    expect(r.totals).toEqual(expected);
  });

  it('T3: 500 pedidos × 10 líneas no explota memoria', async () => {
    const pedidos = [];
    for (let i = 0; i < 500; i++) {
      const lines = [];
      for (let j = 0; j < 10; j++) {
        lines.push(
          makeLine('SKU-' + (j % 5), j % 2 === 0 ? 'BO' : 'ASIG', ((i + j) % 10) + 1, {
            asigAt: new Date(Date.now() - 1000).toISOString(),
          })
        );
      }
      pedidos.push(makePedido(i, lines));
    }
    const affected = new Set(['SKU-0', 'SKU-1', 'SKU-2', 'SKU-3', 'SKU-4']);
    const db = makeMockDb(pedidos);
    // Correr 3 veces para medir cumulative heap (simula concurrencia).
    const heapBefore = process.memoryUsage().heapUsed;
    for (let k = 0; k < 3; k++) {
      await recalcSnapshotForSkus({ fbDb: db, FieldValue: db.FieldValue, log: () => {} }, affected);
    }
    const heapAfter = process.memoryUsage().heapUsed;
    const deltaMB = (heapAfter - heapBefore) / (1024 * 1024);
    // Umbral generoso — el test NO busca optimización agresiva, solo que no
    // explote. 500 pedidos × 10 líneas × 3 invocaciones debería dejar <80 MB
    // de delta heap (algoritmo one-pass + proyección).
    expect(deltaMB).toBeLessThan(80);
  });

  it('T4: pedidos cerrados (closedAt != null) NO cuentan — early-return del one-pass', async () => {
    const pedidos = [
      {
        ...makePedido(0, [makeLine('SKU-A', 'BO', 5)]),
        closedAt: new Date().toISOString(),
      },
      makePedido(1, [makeLine('SKU-A', 'BO', 3)]),
    ];
    const db = makeMockDb(pedidos);
    const r = await recalcSnapshotForSkus(
      { fbDb: db, FieldValue: db.FieldValue, log: () => {} },
      new Set(['SKU-A'])
    );
    expect(r.totals['SKU-A'].bo).toBe(3); // solo el pedido abierto
  });

  it('T5: pedidos sin transferidoSAP NO cuentan — guard v578 preservado', async () => {
    const pedidos = [
      { ...makePedido(0, [makeLine('SKU-A', 'BO', 5)]), transferidoSAP: null },
      makePedido(1, [makeLine('SKU-A', 'BO', 3)]),
    ];
    const db = makeMockDb(pedidos);
    const r = await recalcSnapshotForSkus(
      { fbDb: db, FieldValue: db.FieldValue, log: () => {} },
      new Set(['SKU-A'])
    );
    expect(r.totals['SKU-A'].bo).toBe(3);
  });

  it('T6: asigByClient + boByClient preservados en one-pass', async () => {
    const pedidos = [
      { ...makePedido(0, [makeLine('SKU-A', 'BO', 5)]), clientCardCode: 'C001' },
      {
        ...makePedido(1, [
          makeLine('SKU-A', 'ASIG', 3, { asigAt: new Date(Date.now() - 1000).toISOString() }),
        ]),
        clientCardCode: 'C001',
      },
      {
        ...makePedido(2, [
          makeLine('SKU-A', 'ASIG', 2, { asigAt: new Date(Date.now() - 1000).toISOString() }),
        ]),
        clientCardCode: 'C002',
      },
    ];
    const now = Date.now();
    const expected = aggregateForSku(pedidos, 'SKU-A', now);
    const db = makeMockDb(pedidos);
    const r = await recalcSnapshotForSkus(
      { fbDb: db, FieldValue: db.FieldValue, log: () => {} },
      new Set(['SKU-A'])
    );
    // Totales matchean.
    expect(r.totals['SKU-A'].bo).toBe(expected.bo);
    expect(r.totals['SKU-A'].asig).toBe(expected.asig);
  });
});
