// @ts-check
/**
 * Stack S-12 H2 (review 2026-11-26): tests del worker scheduled del
 * `dual_write_pending`.
 *
 * Mock fbDb + mock replicate. Cubre:
 *   T1 — Happy path: entry pendiente con nextRetryAt vencido → replicate OK
 *        → resolvedAt seteado.
 *   T2 — Fallo simple: replicate devuelve ok:false con error de PG → attempts++
 *        + nextRetryAt agendado con backoff exponencial (5 min default).
 *   T3 — Backoff progresivo: entry con attempts=2 falla → nextRetryAt =
 *        now + 1hr (schedule[2]).
 *   T4 — Pedido no existe en Firestore → marca resolved con reason.
 *   T5 — Stale: entry con attempts=11 falla → marca stale + log operations_log.
 *   T6 — Stale by age: entry con firstFailedAt > 24h ago → marca stale.
 *   T7 — Flag OFF / no pool: incrementa nextRetryAt +15min pero no attempts.
 *   T8 — Replicate throws → trata como fallo + loguea error.
 *   T9 — Query falla → termina gracefully con errors[].
 *   T10 — Empty pending → scanned=0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runDualWriteRetryWorker } from '../../functions/core/dual-write-retry-worker-core.js';

/**
 * Mock Firestore minimo. Soporta:
 *   - fbDb.collection('dual_write_pending').where(...).where(...).limit(N).get()
 *   - fbDb.collection('dual_write_pending').doc(id).set(data, {merge:true})
 *   - fbDb.collection('pedidos').doc(id).get()
 *   - fbDb.collection('operations_log').add(entry)
 */
function makeMockFbDb(opts = {}) {
  const pendingDocs = opts.pendingDocs || []; // array of {id, data}
  const pedidos = opts.pedidos || {}; // {id: data}
  const writes = [];
  const operationsLog = [];
  const queryErrOnce = opts.queryErrOnce;
  let queriedOnce = false;
  return {
    pendingDocs,
    pedidos,
    writes,
    operationsLog,
    collection(name) {
      return {
        where(_field, _op, _value) {
          return this;
        },
        limit(_n) {
          return this;
        },
        async get() {
          if (name === 'dual_write_pending') {
            if (queryErrOnce && !queriedOnce) {
              queriedOnce = true;
              throw queryErrOnce;
            }
            return {
              forEach(cb) {
                for (const d of pendingDocs) {
                  cb({ id: d.id, data: () => d.data });
                }
              },
            };
          }
          return { forEach() {} };
        },
        doc(id) {
          return {
            async get() {
              if (name === 'pedidos') {
                const data = pedidos[id];
                return {
                  exists: !!data,
                  data: () => data || null,
                };
              }
              return { exists: false, data: () => null };
            },
            async set(data, mergeOpts) {
              writes.push({ col: name, id, data, merge: mergeOpts });
            },
          };
        },
        async add(entry) {
          if (name === 'operations_log') {
            operationsLog.push(entry);
          }
        },
      };
    },
  };
}

const NOW_ISO = '2026-11-26T18:00:00.000Z';
const NOW_MS = new Date(NOW_ISO).getTime();

describe('Stack S-12 H2 — scheduledDualWriteRetry worker', () => {
  it('T1 Happy path: entry vencido + replicate OK → marcado resolved', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-1',
          data: {
            attempts: 1,
            firstFailedAt: '2026-11-26T17:00:00.000Z',
            nextRetryAt: '2026-11-26T17:05:00.000Z',
          },
        },
      ],
      pedidos: { 'pedido-1': { foo: 'bar' } },
    });
    const replicateFn = vi.fn(async () => ({ ok: true }));
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    expect(stats.scanned).toBe(1);
    expect(stats.resolved).toBe(1);
    expect(stats.failed).toBe(0);
    expect(replicateFn).toHaveBeenCalledOnce();
    // Write a dual_write_pending con resolvedAt.
    const resolvedWrite = fbDb.writes.find(
      (w) => w.col === 'dual_write_pending' && w.data.resolvedAt
    );
    expect(resolvedWrite).toBeDefined();
    expect(resolvedWrite.data.resolvedAt).toBe(NOW_ISO);
    expect(resolvedWrite.data.resolvedReason).toBe('replicate_ok');
    expect(resolvedWrite.merge).toEqual({ merge: true });
  });

  it('T2 Fallo real: attempts++ + nextRetryAt con backoff (attempts=1 → 5min)', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-fail',
          data: {
            attempts: 0,
            firstFailedAt: '2026-11-26T17:59:00.000Z',
            nextRetryAt: '2026-11-26T17:59:30.000Z',
          },
        },
      ],
      pedidos: { 'pedido-fail': { foo: 'bar' } },
    });
    const pgErr = new Error('connection timeout');
    pgErr.code = 'ETIMEDOUT';
    const replicateFn = vi.fn(async () => ({
      ok: false,
      errorMessage: pgErr.message,
    }));
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    expect(stats.failed).toBe(1);
    expect(stats.resolved).toBe(0);
    expect(stats.stale).toBe(0);
    const updateWrite = fbDb.writes.find(
      (w) => w.col === 'dual_write_pending' && w.data.nextRetryAt
    );
    expect(updateWrite).toBeDefined();
    // attempts=1 → backoff 5 min.
    const expectedNext = new Date(NOW_MS + 5 * 60 * 1000).toISOString();
    expect(updateWrite.data.nextRetryAt).toBe(expectedNext);
    expect(updateWrite.data.lastError).toBe('connection timeout');
  });

  it('T3 Backoff progresivo: attempts=2 falla → nextRetryAt = now + 1hr', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-fail-2',
          data: {
            attempts: 2,
            firstFailedAt: '2026-11-26T15:00:00.000Z',
            nextRetryAt: '2026-11-26T17:59:00.000Z',
          },
        },
      ],
      pedidos: { 'pedido-fail-2': { foo: 'bar' } },
    });
    const replicateFn = vi.fn(async () => ({
      ok: false,
      errorMessage: 'pg error',
    }));
    await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    const updateWrite = fbDb.writes.find((w) => w.col === 'dual_write_pending');
    // attempts=2 (prev) +1 = 3 → backoff[2] = 1hr.
    const expectedNext = new Date(NOW_MS + 60 * 60 * 1000).toISOString();
    expect(updateWrite.data.nextRetryAt).toBe(expectedNext);
  });

  it('T4 Pedido no existe en Firestore → marca resolved con reason', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-ghost',
          data: {
            attempts: 1,
            firstFailedAt: '2026-11-26T17:00:00.000Z',
            nextRetryAt: '2026-11-26T17:05:00.000Z',
          },
        },
      ],
      pedidos: {}, // no pedidos → ghost
    });
    const replicateFn = vi.fn();
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    expect(stats.resolved).toBe(1);
    expect(replicateFn).not.toHaveBeenCalled();
    const write = fbDb.writes.find((w) => w.col === 'dual_write_pending');
    expect(write.data.resolvedReason).toBe('pedido_no_existe');
  });

  it('T5 Stale: entry con attempts=10 falla → marca stale + log operations_log', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-stale',
          data: {
            attempts: 10,
            firstFailedAt: '2026-11-26T17:00:00.000Z', // 1h atras, no stale por tiempo
            nextRetryAt: '2026-11-26T17:59:00.000Z',
            stale: false,
          },
        },
      ],
      pedidos: { 'pedido-stale': { foo: 'bar' } },
    });
    const replicateFn = vi.fn(async () => ({
      ok: false,
      errorMessage: 'persistent fail',
    }));
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    // attempts=10 prev +1 = 11 → stale.
    expect(stats.stale).toBe(1);
    const write = fbDb.writes.find((w) => w.col === 'dual_write_pending');
    expect(write.data.stale).toBe(true);
    expect(write.data.staleAt).toBe(NOW_ISO);
    // operations_log tiene el entry stale.
    const staleLog = fbDb.operationsLog.find((e) => e.type === 'dual_write_pending_stale');
    expect(staleLog).toBeDefined();
    expect(staleLog.pedidoId).toBe('pedido-stale');
    expect(staleLog.attempts).toBe(11);
  });

  it('T6 Stale by age: firstFailedAt > 24h ago → marca stale aunque attempts bajo', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-old',
          data: {
            attempts: 2,
            firstFailedAt: '2026-11-25T17:00:00.000Z', // 25 h atras
            nextRetryAt: '2026-11-26T17:00:00.000Z',
          },
        },
      ],
      pedidos: { 'pedido-old': { foo: 'bar' } },
    });
    const replicateFn = vi.fn(async () => ({
      ok: false,
      errorMessage: 'still failing',
    }));
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    expect(stats.stale).toBe(1);
    const write = fbDb.writes.find((w) => w.col === 'dual_write_pending');
    expect(write.data.stale).toBe(true);
  });

  it('T7 Flag OFF / no pool: incrementa nextRetryAt +15min pero no attempts', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-skip',
          data: {
            attempts: 1,
            firstFailedAt: '2026-11-26T17:00:00.000Z',
            nextRetryAt: '2026-11-26T17:59:00.000Z',
          },
        },
      ],
      pedidos: { 'pedido-skip': { foo: 'bar' } },
    });
    const replicateFn = vi.fn(async () => ({
      ok: false,
      skipped: 'flag_off',
    }));
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    // Skipped NO cuenta como failed ni resolved.
    expect(stats.resolved).toBe(0);
    expect(stats.failed).toBe(0);
    const write = fbDb.writes.find((w) => w.col === 'dual_write_pending');
    const expectedNext = new Date(NOW_MS + 15 * 60 * 1000).toISOString();
    expect(write.data.nextRetryAt).toBe(expectedNext);
    expect(write.data.lastSkipReason).toBe('flag_off');
    // NO deberia tener attempts update.
    expect(write.data.attempts).toBeUndefined();
  });

  it('T8 Replicate throws → trata como fallo + loguea error', async () => {
    const fbDb = makeMockFbDb({
      pendingDocs: [
        {
          id: 'pedido-throw',
          data: {
            attempts: 0,
            firstFailedAt: '2026-11-26T17:00:00.000Z',
            nextRetryAt: '2026-11-26T17:05:00.000Z',
          },
        },
      ],
      pedidos: { 'pedido-throw': { foo: 'bar' } },
    });
    const replicateFn = vi.fn(async () => {
      throw new Error('unexpected bug');
    });
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    expect(stats.failed).toBe(1);
    const write = fbDb.writes.find((w) => w.col === 'dual_write_pending');
    expect(write.data.lastError).toBe('unexpected bug');
  });

  it('T9 Query falla → termina gracefully con errors[]', async () => {
    const fbDb = makeMockFbDb({
      queryErrOnce: new Error('firestore down'),
    });
    const replicateFn = vi.fn();
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    expect(stats.scanned).toBe(0);
    expect(stats.errors.length).toBeGreaterThan(0);
    expect(stats.errors[0]).toContain('query:');
    expect(replicateFn).not.toHaveBeenCalled();
  });

  it('T10 Empty pending → scanned=0 sin side effects', async () => {
    const fbDb = makeMockFbDb({ pendingDocs: [] });
    const replicateFn = vi.fn();
    const stats = await runDualWriteRetryWorker({
      fbDb,
      replicateFn,
      now: () => NOW_MS,
    });
    expect(stats).toEqual({
      scanned: 0,
      retried: 0,
      resolved: 0,
      failed: 0,
      stale: 0,
      errors: [],
    });
    expect(replicateFn).not.toHaveBeenCalled();
  });
});
