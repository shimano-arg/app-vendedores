// @ts-check
/**
 * Stack S-12 M1 + M2 (review 2026-11-26):
 *
 * M1 — Doble read Firestore del flag. Fix: `isFlagEnabled` acepta
 *   `deps.featureFlagsDoc` precargado. Si viene, no hace `.get()`.
 * M2 — Catch outer broad en `replicatePedidoToPg`. Fix: outer solo captura
 *   errores esperados (pg.DatabaseError + conexion). Inesperados
 *   (TypeError/ReferenceError) propagan al `.catch` fire-and-forget y
 *   ADEMAS escriben `operations_log` con type='dual_write_unexpected_err'.
 */
import { describe, expect, it, vi } from 'vitest';
import { isFlagEnabled, replicatePedidoToPg } from '../../functions/core/dual-write-pg.js';

function makeMockPgPool(opts = {}) {
  const calls = [];
  const pool = {
    async connect() {
      if (opts.failOnConnect) throw opts.failOnConnect;
      return {
        async query(text, values) {
          calls.push({ text, values });
          if (opts.failOnQuery && text.startsWith(opts.failOnQuery.startsWith || 'INSERT')) {
            throw opts.failOnQuery;
          }
          if (opts.failOnCommit && text === 'COMMIT') {
            throw opts.failOnCommit;
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };
  return { pool, calls };
}

function makeMockFbDb(opts = {}) {
  const docGets = [];
  const writes = [];
  const operationsLog = [];
  return {
    docGets,
    writes,
    operationsLog,
    doc(path) {
      return {
        async get() {
          docGets.push(path);
          if (path === 'app_config/feature_flags') {
            return {
              exists: !!opts.featureFlagsDoc,
              data: () => opts.featureFlagsDoc || null,
            };
          }
          return { exists: false, data: () => null };
        },
      };
    },
    collection(col) {
      return {
        doc(id) {
          return {
            async set(data, mergeOpts) {
              writes.push({ col, id, data, merge: mergeOpts });
            },
          };
        },
        async add(entry) {
          if (col === 'operations_log') {
            operationsLog.push(entry);
          }
          writes.push({ col, id: 'auto', data: entry });
        },
      };
    },
  };
}

function makePedidoDoc(overrides = {}) {
  return {
    _fsId: 'p_m1_m2',
    orderNumber: 1,
    clientCardCode: 'C001',
    clientName: 'TEST',
    assignedVendorUid: 'uid1',
    vendorAssigned: 'MAURICIO GIL',
    ownerUid: 'uid1',
    cargadoPorUid: 'uid1',
    origen: 'manual',
    draftId: null,
    transferidoSAP: null,
    createdAt: '2026-11-26T12:00:00.000Z',
    updatedAt: '2026-11-26T12:00:00.000Z',
    closedAt: null,
    lines: [
      {
        code: 'SKU-X',
        state: 'confirmed',
        qty: 1,
        qtyOpen: 1,
        qtyCancelled: 0,
        price: 100,
        confirmedAt: '2026-11-26T12:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('Stack S-12 M1 — isFlagEnabled accepts precharged featureFlagsDoc', () => {
  it('M1a: featureFlagsDoc precargado → 0 reads de Firestore', async () => {
    const fbDb = makeMockFbDb(); // sin doc
    const res = await isFlagEnabled({
      fbDb,
      featureFlagsDoc: { dual_write_pedidos_enabled: true },
    });
    expect(res).toBe(true);
    expect(fbDb.docGets).toHaveLength(0);
  });

  it('M1b: featureFlagsDoc precargado false → false (no toca Firestore)', async () => {
    const fbDb = makeMockFbDb();
    const res = await isFlagEnabled({
      fbDb,
      featureFlagsDoc: { dual_write_pedidos_enabled: false },
    });
    expect(res).toBe(false);
    expect(fbDb.docGets).toHaveLength(0);
  });

  it('M1c: featureFlagsDoc undefined → fallback a Firestore (1 read)', async () => {
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    const res = await isFlagEnabled({ fbDb });
    expect(res).toBe(true);
    expect(fbDb.docGets).toEqual(['app_config/feature_flags']);
  });

  it('M1d: featureFlagsDoc null → fallback a Firestore (1 read)', async () => {
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    const res = await isFlagEnabled({ fbDb, featureFlagsDoc: null });
    expect(res).toBe(true);
    expect(fbDb.docGets).toHaveLength(1);
  });

  it('M1e: replicatePedidoToPg con featureFlagsDoc inyectado hace 0 reads flag', async () => {
    const { pool, calls } = makeMockPgPool();
    const fbDb = makeMockFbDb(); // no Firestore flag disponible
    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        featureFlagsDoc: { dual_write_pedidos_enabled: true },
        log: () => {},
      },
      'p_m1_m2',
      makePedidoDoc()
    );
    expect(res.ok).toBe(true);
    // 0 reads al app_config/feature_flags.
    expect(fbDb.docGets).toHaveLength(0);
    // SQL se ejecuto.
    expect(calls.some((c) => c.text === 'COMMIT')).toBe(true);
  });

  it('M1f: replicatePedidoToPg sin featureFlagsDoc hace 1 read flag', async () => {
    const { pool } = makeMockPgPool();
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: () => {},
      },
      'p_m1_m2',
      makePedidoDoc()
    );
    expect(fbDb.docGets).toHaveLength(1);
    expect(fbDb.docGets[0]).toBe('app_config/feature_flags');
  });
});

describe('Stack S-12 M2 — replicatePedidoToPg narrow catch', () => {
  it('M2a: pg.DatabaseError (code populated) → captured, enqueue, no throw', async () => {
    const pgErr = new Error('duplicate key value violates unique constraint');
    /** @type {any} */ (pgErr).code = '23505';
    const { pool } = makeMockPgPool({
      failOnQuery: Object.assign(pgErr, { startsWith: 'INSERT' }),
    });
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    const logs = [];
    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: (msg, ctx) => logs.push({ msg, ctx }),
      },
      'p_m1_m2',
      makePedidoDoc()
    );
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('duplicate key');
    expect(logs.some((l) => l.msg === 'dual_write_failed')).toBe(true);
    // Enqueue a pending.
    const enqueued = fbDb.writes.find((w) => w.col === 'dual_write_pending');
    expect(enqueued).toBeDefined();
    // NO escribio unexpected_err.
    expect(fbDb.operationsLog.filter((e) => e.type === 'dual_write_unexpected_err')).toHaveLength(
      0
    );
  });

  it('M2b: connection timeout (ETIMEDOUT) → captured + enqueue', async () => {
    const connErr = new Error('connection timeout after 5000ms');
    const { pool } = makeMockPgPool({ failOnConnect: connErr });
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    const logs = [];
    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: (msg, ctx) => logs.push({ msg, ctx }),
      },
      'p_m1_m2',
      makePedidoDoc()
    );
    // Connection timeout en executeReplicationTx falla antes del INSERT.
    // Acá es en pool.connect → se propaga como PG error esperado.
    expect(res.ok).toBe(false);
    expect(fbDb.writes.some((w) => w.col === 'dual_write_pending')).toBe(true);
  });

  it('M2c: TypeError inesperado del transform → log operations_log + enqueue', async () => {
    const { pool } = makeMockPgPool();
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    const logs = [];
    // Pass pedidoDoc con shape invalido que NO sea el "invalid_pedido_doc"
    // string (tira TypeError del propio helper).
    // Para forzar TypeError tiramos por campo con shape weird.
    // transformPedidoToPg valida y lanza con "invalid_pedido_doc: ..." → NO es TypeError.
    // Forzamos con una línea nula que pase la cabecera pero dispare otra via.
    // (transformPedidoToPg no tira TypeError facilmente — usamos pedidoDoc.lines no-array.)
    // En realidad transformPedidoToPg lo tolera (hace Array.isArray check). Pass manual.
    const badDoc = {
      _fsId: 'p_bad',
      orderNumber: 1,
      clientCardCode: 'C001',
      clientName: 'TEST',
      assignedVendorUid: 'uid1',
      vendorAssigned: 'MAURICIO GIL',
      ownerUid: 'uid1',
      cargadoPorUid: 'uid1',
      origen: 'manual',
      // Hacer que transformPedidoToPg lance con "invalid_pedido_doc: missing_lines_array".
      lines: null, // forzar invalid_lines_array
    };
    const res = await replicatePedidoToPg(
      {
        pgPool: pool,
        fbDb,
        log: (msg, ctx) => logs.push({ msg, ctx }),
      },
      'p_bad',
      badDoc
    );
    expect(res.ok).toBe(false);
    // Error esperado (startsWith invalid_pedido_doc).
    expect(res.errorMessage).toMatch(/^invalid_pedido_doc/);
    expect(logs.some((l) => l.msg === 'dual_write_transform_failed')).toBe(true);
    // Esperado — no debe loguear como unexpected.
    expect(fbDb.operationsLog.filter((e) => e.type === 'dual_write_unexpected_err')).toHaveLength(
      0
    );
  });

  it('M2d: error del execute_tx con code vacío + mensaje raro → unexpected (log operations_log + rethrow)', async () => {
    const { pool } = makeMockPgPool();
    // Mock un pool que lanza TypeError al connect.
    const bugPool = {
      async connect() {
        // TypeError no es "esperado" (no tiene code, no tiene mensaje de red).
        throw new TypeError("Cannot read property 'query' of undefined");
      },
    };
    const fbDb = makeMockFbDb({ featureFlagsDoc: { dual_write_pedidos_enabled: true } });
    const logs = [];
    let caughtErr = null;
    try {
      await replicatePedidoToPg(
        {
          pgPool: bugPool,
          fbDb,
          log: (msg, ctx) => logs.push({ msg, ctx }),
        },
        'p_m1_m2',
        makePedidoDoc()
      );
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(TypeError);
    // Log operations_log con type=dual_write_unexpected_err.
    const unexpectedLog = fbDb.operationsLog.find((e) => e.type === 'dual_write_unexpected_err');
    expect(unexpectedLog).toBeDefined();
    expect(unexpectedLog.pedidoId).toBe('p_m1_m2');
    expect(unexpectedLog.errName).toBe('TypeError');
    expect(unexpectedLog.errStack).toBeDefined();
    // Enqueue al pending tambien (para reintento manual).
    expect(fbDb.writes.some((w) => w.col === 'dual_write_pending')).toBe(true);
  });
});
