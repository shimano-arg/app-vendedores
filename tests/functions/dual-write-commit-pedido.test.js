// @ts-check
/**
 * S-12 Phase 2 (ADR-0016): unit tests del modulo `functions/core/dual-write-pg.js`.
 *
 * Mocks:
 *   - `pg.Pool` en memoria con tracker de queries + fallos simulables.
 *   - `fbDb` con doc + collection + set/update + feature-flags.
 *
 * NO toca Postgres real. La integracion vive en
 * `backend-new/db/tests/dual-write-integration.test.js`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DUAL_WRITE_PENDING_COLLECTION,
  enqueuePendingRetry,
  executeReplicationTx,
  isFlagEnabled,
  replicatePedidoToPg,
} from '../../functions/core/dual-write-pg.js';

/**
 * Mock minimal de pg.Pool.
 *
 * @param {Object} [opts]
 * @param {Error} [opts.failOnCommit] - si viene, el COMMIT lanza este error.
 * @param {Error} [opts.failOnConnect] - si viene, connect lanza.
 * @param {Error} [opts.failOnFirstInsert] - si viene, el primer INSERT lanza.
 * @returns {{pool: any, calls: Array<{text: string, values?: unknown[]}>, released: number}}
 */
function makeMockPgPool(opts = {}) {
  const calls = [];
  let released = 0;
  const pool = {
    async connect() {
      if (opts.failOnConnect) throw opts.failOnConnect;
      let firstInsertSeen = false;
      return {
        async query(text, values) {
          calls.push({ text, values });
          if (opts.failOnFirstInsert && /^INSERT INTO pedidos/.test(text) && !firstInsertSeen) {
            firstInsertSeen = true;
            throw opts.failOnFirstInsert;
          }
          if (opts.failOnCommit && text === 'COMMIT') {
            throw opts.failOnCommit;
          }
          return { rows: [], rowCount: 0 };
        },
        release() {
          released += 1;
        },
      };
    },
  };
  return {
    pool,
    calls,
    get released() {
      return released;
    },
  };
}

/**
 * Mock fbDb minimal. Solo soporta:
 *   - fbDb.doc('app_config/feature_flags').get() → feature flags doc.
 *   - fbDb.collection('dual_write_pending').doc(id).set(data, {merge}).
 *
 * @param {Object} [opts]
 * @param {Record<string, any>} [opts.featureFlagsDoc]
 * @param {boolean} [opts.failFlagRead] - si true, .doc('app_config/feature_flags').get() throws.
 * @param {boolean} [opts.failPendingSet] - si true, set a dual_write_pending throws.
 */
function makeMockFbDb(opts = {}) {
  const pendingWrites = [];
  return {
    pendingWrites,
    doc(path) {
      return {
        async get() {
          if (path === 'app_config/feature_flags') {
            if (opts.failFlagRead) throw new Error('feature flags read fail');
            return {
              exists: !!opts.featureFlagsDoc,
              data: () => opts.featureFlagsDoc || null,
            };
          }
          return { exists: false, data: () => null };
        },
      };
    },
    collection(colName) {
      return {
        doc(docId) {
          return {
            async set(data, mergeOpts) {
              if (opts.failPendingSet) throw new Error('pending set fail');
              pendingWrites.push({ colName, docId, data, merge: mergeOpts });
            },
          };
        },
      };
    },
  };
}

/**
 * Fixture de un pedido Firestore valido (alta tipica VDE).
 */
function makePedidoDoc(overrides = {}) {
  return {
    _fsId: 'p_abc123',
    orderNumber: 100,
    clientCardCode: 'C001',
    clientName: 'ACME',
    assignedVendorUid: 'uid_vde_1',
    vendorAssigned: 'MAURICIO GIL',
    ownerUid: 'uid_vde_1',
    cargadoPorUid: 'uid_vde_1',
    origen: 'manual',
    draftId: null,
    transferidoSAP: {},
    createdAt: '2026-11-26T12:00:00.000Z',
    updatedAt: '2026-11-26T12:00:00.000Z',
    closedAt: null,
    lines: [
      {
        code: 'SKU-AAA-001',
        state: 'ASIG',
        qty: 3,
        qtyOpen: 3,
        qtyCancelled: 0,
        price: 1500,
        asigAt: '2026-11-26T12:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('dual-write-pg — replicatePedidoToPg (unit, mock pg)', () => {
  it('T1: flag OFF → no-op (no se llama pgPool.connect)', async () => {
    const { pool, calls } = makeMockPgPool();
    const logs = [];
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: false } });
    const log = (msg, ctx) => logs.push({ msg, ctx });

    const res = await replicatePedidoToPg({ pgPool: pool, fbDb, log }, 'p_abc123', makePedidoDoc());

    expect(res.ok).toBe(false);
    expect(res.skipped).toBe('flag_off');
    expect(calls).toHaveLength(0);
    expect(logs.some((l) => l.msg === 'dual_write_skipped_flag_off')).toBe(true);
    expect(fbDb.pendingWrites).toHaveLength(0);
  });

  it('T2: flag ON + commit exitoso → BEGIN/DELETE/INSERT/COMMIT', async () => {
    const { pool, calls } = makeMockPgPool();
    const logs = [];
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });

    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: (msg, ctx) => logs.push({ msg, ctx }),
      },
      'p_abc123',
      makePedidoDoc()
    );

    expect(res.ok).toBe(true);
    // Order: BEGIN, DELETE, INSERT pedidos, INSERT lines, COMMIT.
    expect(calls[0].text).toBe('BEGIN');
    expect(calls[1].text).toMatch(/^DELETE FROM pedidos/);
    expect(calls[1].values).toEqual(['p_abc123']);
    expect(calls[2].text).toMatch(/^INSERT INTO pedidos/);
    expect(calls[3].text).toMatch(/^INSERT INTO pedido_lines/);
    expect(calls[4].text).toBe('COMMIT');
    expect(logs.some((l) => l.msg === 'dual_write_ok')).toBe(true);
    expect(fbDb.pendingWrites).toHaveLength(0);
  });

  it('T3: flag ON + PG falla (connect) → enqueue dual_write_pending + no throw', async () => {
    const connErr = new Error('ECONNREFUSED 127.0.0.1:5433');
    /** @type {any} */ (connErr).code = 'ECONNREFUSED';
    const { pool } = makeMockPgPool({ failOnConnect: connErr });
    const logs = [];
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });

    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: (msg, ctx) => logs.push({ msg, ctx }),
      },
      'p_abc123',
      makePedidoDoc()
    );

    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('ECONNREFUSED');
    expect(fbDb.pendingWrites).toHaveLength(1);
    expect(fbDb.pendingWrites[0].colName).toBe(DUAL_WRITE_PENDING_COLLECTION);
    expect(fbDb.pendingWrites[0].docId).toBe('p_abc123');
    expect(fbDb.pendingWrites[0].merge?.merge).toBe(true);
    expect(fbDb.pendingWrites[0].data.errorCode).toBe('ECONNREFUSED');
    expect(logs.some((l) => l.msg === 'dual_write_failed')).toBe(true);
  });

  it('T4: 2 ejecuciones consecutivas con mismo pedidoId → idempotente (DELETE antes de cada INSERT)', async () => {
    const { pool, calls } = makeMockPgPool();
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    const deps = { pgPool: pool, fbDb, log: () => {} };

    const doc = makePedidoDoc();
    await replicatePedidoToPg(deps, 'p_abc123', doc);
    await replicatePedidoToPg(deps, 'p_abc123', doc);

    // Debe haber 2 ciclos BEGIN/DELETE/INSERT/INSERT/COMMIT.
    const deleteOps = calls.filter((c) => /^DELETE FROM pedidos/.test(c.text));
    const pedidosInsertOps = calls.filter((c) => /^INSERT INTO pedidos/.test(c.text));
    expect(deleteOps).toHaveLength(2);
    expect(pedidosInsertOps).toHaveLength(2);
    // Cada DELETE usa el mismo pedidoId.
    expect(deleteOps[0].values).toEqual(['p_abc123']);
    expect(deleteOps[1].values).toEqual(['p_abc123']);
  });

  it('T5: flag ON pero deps.pgPool undefined → log skipped_no_pool sin throw', async () => {
    const logs = [];
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });

    const res = await replicatePedidoToPg(
      { fbDb, log: (msg, ctx) => logs.push({ msg, ctx }) },
      'p_abc123',
      makePedidoDoc()
    );

    expect(res.ok).toBe(false);
    expect(res.skipped).toBe('no_pool');
    expect(logs.some((l) => l.msg === 'dual_write_skipped_no_pool')).toBe(true);
    expect(fbDb.pendingWrites).toHaveLength(0);
  });

  it('T6: cancelacion (lines=[]) → DELETE + INSERT pedidos sin lineas (reservations liberadas por cascade)', async () => {
    const { pool, calls } = makeMockPgPool();
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });

    const cancelado = makePedidoDoc({
      closedAt: '2026-11-26T13:00:00.000Z',
      closedReason: 'cancelado_cliente',
      closedBy: 'uid_pablo',
      lines: [],
    });

    const res = await replicatePedidoToPg(
      { pgPool: pool, fbDb, log: () => {} },
      'p_abc123',
      cancelado
    );

    expect(res.ok).toBe(true);
    // Debe haber BEGIN, DELETE, INSERT pedidos, COMMIT (sin INSERT lines).
    expect(calls.map((c) => c.text)).toEqual([
      'BEGIN',
      'DELETE FROM pedidos WHERE id = $1',
      expect.stringMatching(/^INSERT INTO pedidos/),
      'COMMIT',
    ]);
  });

  it('T7: pedidoDoc invalido (missing orderNumber) → encola en dual_write_pending + no throw', async () => {
    const { pool } = makeMockPgPool();
    const logs = [];
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });

    const invalid = makePedidoDoc();
    // Vacio orderNumber para forzar validatePedidoHeader fail.
    delete invalid.orderNumber;

    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: (msg, ctx) => logs.push({ msg, ctx }),
      },
      'p_abc123',
      /** @type {any} */ (invalid)
    );

    expect(res.ok).toBe(false);
    expect(fbDb.pendingWrites).toHaveLength(1);
    expect(logs.some((l) => l.msg === 'dual_write_transform_failed')).toBe(true);
  });

  it('T8: flag read falla → fail-closed (asume OFF) y no escribe PG', async () => {
    const { pool, calls } = makeMockPgPool();
    const logs = [];
    const fbDb = makeMockFbDb({ failFlagRead: true });

    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: (msg, ctx) => logs.push({ msg, ctx }),
      },
      'p_abc123',
      makePedidoDoc()
    );

    expect(res.ok).toBe(false);
    expect(res.skipped).toBe('flag_off');
    expect(calls).toHaveLength(0);
  });
});

describe('dual-write-pg — executeReplicationTx (unit)', () => {
  it('BEGIN/COMMIT ok cuando todos los stmts suceden', async () => {
    const { pool, calls } = makeMockPgPool();
    await executeReplicationTx(pool, [
      { text: 'DELETE FROM pedidos WHERE id = $1', values: ['p_1'] },
      { text: 'INSERT INTO pedidos (id) VALUES ($1)', values: ['p_1'] },
    ]);
    expect(calls.map((c) => c.text)).toEqual([
      'BEGIN',
      'DELETE FROM pedidos WHERE id = $1',
      'INSERT INTO pedidos (id) VALUES ($1)',
      'COMMIT',
    ]);
  });

  it('ROLLBACK + rethrow cuando un stmt falla', async () => {
    const failErr = new Error('duplicate key violation');
    const { pool, calls } = makeMockPgPool({ failOnFirstInsert: failErr });
    await expect(
      executeReplicationTx(pool, [
        { text: 'DELETE FROM pedidos WHERE id = $1', values: ['p_1'] },
        { text: 'INSERT INTO pedidos (id) VALUES ($1)', values: ['p_1'] },
      ])
    ).rejects.toThrow('duplicate key violation');
    expect(calls.map((c) => c.text)).toContain('ROLLBACK');
  });

  it('no-op con statements vacios', async () => {
    const { pool, calls } = makeMockPgPool();
    await executeReplicationTx(pool, []);
    expect(calls).toHaveLength(0);
  });
});

describe('dual-write-pg — isFlagEnabled (unit)', () => {
  it('lee flag desde doc precargado si esta disponible', async () => {
    const r1 = await isFlagEnabled({
      featureFlagsDoc: { dual_write_pedidos_enabled: true },
    });
    expect(r1).toBe(true);
    const r2 = await isFlagEnabled({
      featureFlagsDoc: { dual_write_pedidos_enabled: false },
    });
    expect(r2).toBe(false);
  });

  it('fail-closed si no hay doc ni fbDb', async () => {
    const r = await isFlagEnabled({});
    expect(r).toBe(false);
  });

  it('fail-closed si fbDb lanza', async () => {
    const fbDb = makeMockFbDb({ failFlagRead: true });
    const r = await isFlagEnabled({ fbDb });
    expect(r).toBe(false);
  });
});

describe('dual-write-pg — enqueuePendingRetry (unit)', () => {
  it('escribe shape correcto en dual_write_pending/{pedidoId}', async () => {
    const fbDb = makeMockFbDb();
    const err = new Error('pg down');
    /** @type {any} */ (err).code = 'ECONNRESET';
    await enqueuePendingRetry({ fbDb, log: () => {} }, 'p_123', err);
    expect(fbDb.pendingWrites).toHaveLength(1);
    expect(fbDb.pendingWrites[0].docId).toBe('p_123');
    expect(fbDb.pendingWrites[0].data.errorCode).toBe('ECONNRESET');
    expect(fbDb.pendingWrites[0].data.errorMessage).toContain('pg down');
  });

  it('usa FieldValue.increment si viene en deps', async () => {
    const fbDb = makeMockFbDb();
    const sentinel = Symbol('increment-sentinel');
    const FieldValue = { increment: vi.fn(() => sentinel) };
    const err = new Error('x');
    await enqueuePendingRetry({ fbDb, FieldValue, log: () => {} }, 'p_123', err);
    expect(FieldValue.increment).toHaveBeenCalledWith(1);
    expect(fbDb.pendingWrites[0].data.attempts).toBe(sentinel);
  });

  it('no throw cuando el set falla (log solamente)', async () => {
    const fbDb = makeMockFbDb({ failPendingSet: true });
    const logs = [];
    await enqueuePendingRetry(
      { fbDb, log: (m, c) => logs.push({ m, c }) },
      'p_123',
      new Error('x')
    );
    expect(logs.some((l) => l.m === 'dual_write_enqueue_failed')).toBe(true);
  });
});
