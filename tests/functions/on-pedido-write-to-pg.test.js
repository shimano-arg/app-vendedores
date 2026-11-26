/**
 * Tests del CF stub functions/dual-write/on-pedido-write-to-pg.js.
 *
 * Cubre:
 *  - Flag OFF (default) → no escribe en PG, no escribe en operations_log.
 *  - Flag ON → llama al transformer + pgClient.dualWriteUpsert.
 *  - DELETE path → PG update closed_at + closed_reason.
 *  - Error en PG → operations_log entry dual_write_write_failed.
 *  - Error en transform → operations_log entry dual_write_transform_failed.
 *  - Patrón CLAUDE.md §7: lógica inyectada via deps, no depende de firebase-admin.
 *  - Mock PG connection + mock Firestore.
 *
 * @module tests/functions/on-pedido-write-to-pg.test.js
 */

import { describe, expect, it, vi } from 'vitest';
import { onPedidoWriteToPgCore } from '../../functions/dual-write/on-pedido-write-to-pg.js';

/**
 * Mock minimalista Firestore para operations_log.add() + doc().get().
 */
function makeMockFbDb() {
  const writes = [];
  return {
    _writes: writes,
    collection(name) {
      return {
        add: vi.fn(async (data) => {
          writes.push({ collection: name, data });
          return { id: 'mock-id' };
        }),
      };
    },
    doc() {
      return { get: vi.fn(async () => ({ exists: false, data: () => null })) };
    },
  };
}

/**
 * Mock minimalista PG client. Trackea query() + dualWriteUpsert().
 *
 * @param {{ failUpsert?: boolean, failDelete?: boolean }} [opts]
 */
function makeMockPgClient(opts = {}) {
  const queries = [];
  const upserts = [];
  return {
    _queries: queries,
    _upserts: upserts,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (opts.failDelete && sql.includes('UPDATE pedidos')) {
        throw new Error('PG unavailable');
      }
      return { rowCount: 1 };
    }),
    dualWriteUpsert: vi.fn(async (shape) => {
      upserts.push(shape);
      if (opts.failUpsert) {
        throw new Error('PG constraint violation');
      }
    }),
  };
}

function makeFsDoc(overrides = {}, lines = []) {
  return Object.assign(
    {
      orderNumber: 1234,
      clientCardCode: 'C001',
      clientName: 'CLIENTE TEST',
      assignedVendorUid: 'uid-vde-01',
      vendorAssigned: 'MAURICIO GIL',
      ownerUid: 'uid-vde-01',
      cargadoPorUid: 'uid-vde-01',
      origen: 'manual',
      draftId: null,
      transferidoSAP: null,
      createdAt: '2026-11-26T12:00:00.000Z',
      updatedAt: '2026-11-26T12:05:00.000Z',
      closedAt: null,
      lines: lines,
    },
    overrides
  );
}

function makeLine() {
  return {
    code: 'SKU-A',
    state: 'ASIG',
    qty: 5,
    qtyOpen: 5,
    qtyCancelled: 0,
    price: 10000,
    discountPct: 0,
    enTransito: false,
    asigAt: '2026-11-26T11:00:00.000Z',
  };
}

describe('onPedidoWriteToPgCore — flag OFF (default)', () => {
  it('T1: flagsDoc null → skip, no escribe PG', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const event = {
      pedidoId: 'ped_001',
      beforeData: null,
      afterData: makeFsDoc({}, [makeLine()]),
    };
    const result = await onPedidoWriteToPgCore(event, null, { fbDb, pgClient });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('flag_off');
    expect(pgClient.query).not.toHaveBeenCalled();
    expect(pgClient.dualWriteUpsert).not.toHaveBeenCalled();
  });

  it('T2: flag false explícito → skip', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const result = await onPedidoWriteToPgCore(
      { pedidoId: 'p1', beforeData: null, afterData: makeFsDoc({}, [makeLine()]) },
      { dual_write_pedidos_enabled: false },
      { fbDb, pgClient }
    );
    expect(result.skipped).toBe(true);
    expect(pgClient.dualWriteUpsert).not.toHaveBeenCalled();
  });

  it('T3: flag doc sin la entry → skip (fail-open §77)', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const result = await onPedidoWriteToPgCore(
      { pedidoId: 'p1', beforeData: null, afterData: makeFsDoc({}, [makeLine()]) },
      { otra_cosa: true },
      { fbDb, pgClient }
    );
    expect(result.skipped).toBe(true);
  });
});

describe('onPedidoWriteToPgCore — flag ON (CREATE / UPDATE)', () => {
  it('T4: flag ON + afterData → llama upsert con shape PG completo', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const event = {
      pedidoId: 'ped_001',
      beforeData: null,
      afterData: makeFsDoc({}, [makeLine()]),
    };
    const flagsDoc = { dual_write_pedidos_enabled: true };
    const result = await onPedidoWriteToPgCore(event, flagsDoc, { fbDb, pgClient });
    expect(result.applied).toBe(true);
    expect(pgClient.dualWriteUpsert).toHaveBeenCalledTimes(1);
    const shape = pgClient._upserts[0];
    expect(shape.pedido.id).toBe('ped_001');
    expect(shape.pedido.order_number).toBe(1234);
    expect(shape.lines).toHaveLength(1);
    expect(shape.reservations).toHaveLength(1);
  });

  it('T5: flag ON + pgClient sin dualWriteUpsert → noop (v0 fallback)', async () => {
    const pgClient = { query: vi.fn() }; // sin dualWriteUpsert.
    const fbDb = makeMockFbDb();
    const logs = [];
    const event = {
      pedidoId: 'ped_002',
      beforeData: null,
      afterData: makeFsDoc({}, [makeLine()]),
    };
    const result = await onPedidoWriteToPgCore(
      event,
      { dual_write_pedidos_enabled: true },
      { fbDb, pgClient, log: (msg, extra) => logs.push({ msg, extra }) }
    );
    expect(result.applied).toBe(true);
    expect(logs.some((l) => l.msg === 'dual_write_upsert_noop_in_v0')).toBe(true);
  });

  it('T6: PG upsert falla → operations_log dual_write_write_failed', async () => {
    const pgClient = makeMockPgClient({ failUpsert: true });
    const fbDb = makeMockFbDb();
    const event = {
      pedidoId: 'ped_003',
      beforeData: null,
      afterData: makeFsDoc({}, [makeLine()]),
    };
    const result = await onPedidoWriteToPgCore(
      event,
      { dual_write_pedidos_enabled: true },
      { fbDb, pgClient }
    );
    expect(result.error).toBe('pg_upsert_failed');
    expect(fbDb._writes).toHaveLength(1);
    expect(fbDb._writes[0].collection).toBe('operations_log');
    expect(fbDb._writes[0].data.type).toBe('dual_write_write_failed');
    expect(fbDb._writes[0].data.stage).toBe('upsert');
    expect(fbDb._writes[0].data.pedidoId).toBe('ped_003');
  });

  it('T7: transform falla (doc inválido) → operations_log entry', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const badDoc = { lines: [] }; // sin orderNumber, etc.
    const result = await onPedidoWriteToPgCore(
      { pedidoId: 'ped_bad', beforeData: null, afterData: badDoc },
      { dual_write_pedidos_enabled: true },
      { fbDb, pgClient }
    );
    expect(result.error).toBe('transform_failed');
    expect(fbDb._writes).toHaveLength(1);
    expect(fbDb._writes[0].data.type).toBe('dual_write_write_failed');
    expect(fbDb._writes[0].data.stage).toBe('transform');
    expect(pgClient.dualWriteUpsert).not.toHaveBeenCalled();
  });
});

describe('onPedidoWriteToPgCore — DELETE path', () => {
  it('T8: afterData null + beforeData present → UPDATE closed_at en PG', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const event = {
      pedidoId: 'ped_del',
      beforeData: makeFsDoc({}, [makeLine()]),
      afterData: null,
    };
    const result = await onPedidoWriteToPgCore(
      event,
      { dual_write_pedidos_enabled: true },
      { fbDb, pgClient }
    );
    expect(result.applied).toBe(true);
    expect(pgClient.query).toHaveBeenCalledTimes(1);
    expect(pgClient._queries[0].sql).toContain('UPDATE pedidos');
    expect(pgClient._queries[0].params).toEqual(['firestore_doc_deleted', 'ped_del']);
  });

  it('T9: DELETE falla → operations_log entry stage=delete', async () => {
    const pgClient = makeMockPgClient({ failDelete: true });
    const fbDb = makeMockFbDb();
    const result = await onPedidoWriteToPgCore(
      { pedidoId: 'ped_del', beforeData: makeFsDoc({}, []), afterData: null },
      { dual_write_pedidos_enabled: true },
      { fbDb, pgClient }
    );
    expect(result.error).toBe('pg_delete_failed');
    expect(fbDb._writes[0].data.stage).toBe('delete');
  });
});

describe('onPedidoWriteToPgCore — contract', () => {
  it('T10: nunca throw al wrapper — siempre devuelve objeto resultado', async () => {
    const pgClient = makeMockPgClient({ failUpsert: true });
    const fbDb = makeMockFbDb();
    await expect(
      onPedidoWriteToPgCore(
        { pedidoId: 'p', beforeData: null, afterData: makeFsDoc({}, [makeLine()]) },
        { dual_write_pedidos_enabled: true },
        { fbDb, pgClient }
      )
    ).resolves.toBeDefined();
  });

  it('T11: flag OFF — no se invoca transform en absoluto', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    // Doc inválido pero flag OFF: NO debe explotar.
    const result = await onPedidoWriteToPgCore(
      { pedidoId: 'p', beforeData: null, afterData: { lines: [] } },
      null,
      { fbDb, pgClient }
    );
    expect(result.skipped).toBe(true);
    expect(fbDb._writes).toEqual([]); // no logs tampoco.
  });

  it('T12: flag ON + transform OK pero lineas con warnings → applied + log warnings', async () => {
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const logs = [];
    const lines = [makeLine(), { state: 'BOGUS', qty: 1, qtyOpen: 1, code: 'X' }];
    const result = await onPedidoWriteToPgCore(
      { pedidoId: 'p', beforeData: null, afterData: makeFsDoc({}, lines) },
      { dual_write_pedidos_enabled: true },
      { fbDb, pgClient, log: (msg, extra) => logs.push({ msg, extra }) }
    );
    expect(result.applied).toBe(true);
    expect(logs.some((l) => l.msg === 'dual_write_applied_with_warnings')).toBe(true);
  });
});

describe('nightly-parity-check stub — importable', () => {
  it('T13: nightlyParityCheckCore is importable + skip cuando flag OFF', async () => {
    const { nightlyParityCheckCore } = await import(
      '../../functions/dual-write/nightly-parity-check.js'
    );
    const pgClient = makeMockPgClient();
    const fbDb = makeMockFbDb();
    const result = await nightlyParityCheckCore(null, { fbDb, pgClient });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('flag_off');
  });
});
