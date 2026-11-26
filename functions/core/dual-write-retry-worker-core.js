/**
 * dual-write-retry-worker-core.js — core puro del worker de reintentos del
 * dual-write Firestore → PG.
 *
 * Stack S-12 H2 (review 2026-11-26): el `dual_write_pending` acumulaba
 * entries sin TTL ni worker. Este core implementa el flujo del scheduled CF
 * `scheduledDualWriteRetry` (cron cada 15 min):
 *
 *   1. Query `dual_write_pending` con `resolvedAt=null AND nextRetryAt<=now`
 *      (limit 50 por corrida).
 *   2. Para cada entry: re-leer `pedidos/{pedidoId}` + invocar replicar.
 *   3. Si OK → update `resolvedAt=now`.
 *   4. Si falla → `nextRetryAt = now + backoff(attempts)` + `attempts++` +
 *      `lastError`. Si attempts>10 OR firstFailedAt>24h → marcar stale +
 *      log operations_log con type='dual_write_pending_stale'.
 *
 * Fail-open: si Firestore o PG caen, el worker loguea + termina OK (la
 * proxima corrida reintentara). Nunca throws al scheduler.
 *
 * Testeable sin Firebase emulators via inyeccion de deps.
 *
 * @module functions/core/dual-write-retry-worker-core
 */

import { computeNextRetryAtIso, isDualWritePendingStale } from './dual-write-pg-helpers.js';

/**
 * @typedef {Object} RetryWorkerDeps
 * @property {any} fbDb - firestore admin instance.
 * @property {(deps: any, pedidoId: string, pedidoDoc: any) => Promise<any>} replicateFn
 *   - inyectable (default: replicatePedidoToPg). Para testing con mock.
 * @property {any} [pgPool] - pg pool para la replicacion.
 * @property {Record<string, any>} [featureFlagsDoc] - flags precargados.
 * @property {any} [FieldValue] - firebase-admin FieldValue.
 * @property {(msg: string, ctx?: any) => void} [log]
 * @property {() => number} [now] - para testing.
 * @property {number} [batchLimit] - max docs por run (default 50).
 */

/**
 * Nombre de la coleccion donde viven los pendings.
 */
export const DUAL_WRITE_PENDING_COLLECTION = 'dual_write_pending';

/**
 * Ejecuta una corrida del worker. Devuelve estadisticas para logging/testing.
 *
 * @param {RetryWorkerDeps} deps
 * @returns {Promise<{
 *   scanned: number,
 *   retried: number,
 *   resolved: number,
 *   failed: number,
 *   stale: number,
 *   errors: string[],
 * }>}
 */
export async function runDualWriteRetryWorker(deps) {
  const log = (deps && deps.log) || (() => {});
  const now = deps && typeof deps.now === 'function' ? deps.now() : Date.now();
  const nowIso = new Date(now).toISOString();
  const batchLimit = deps && typeof deps.batchLimit === 'number' ? deps.batchLimit : 50;
  /** @type {string[]} */
  const errors = [];
  let scanned = 0;
  let retried = 0;
  let resolved = 0;
  let failed = 0;
  let stale = 0;

  if (!deps || !deps.fbDb) {
    log('dual_write_worker_skip_no_fbdb', {});
    return { scanned, retried, resolved, failed, stale, errors };
  }
  if (!deps.replicateFn || typeof deps.replicateFn !== 'function') {
    log('dual_write_worker_skip_no_replicate', {});
    return { scanned, retried, resolved, failed, stale, errors };
  }

  // 1. Query pending docs.
  /** @type {Array<{id: string, data: Record<string, any>}>} */
  const pending = [];
  try {
    const qs = await deps.fbDb
      .collection(DUAL_WRITE_PENDING_COLLECTION)
      .where('resolvedAt', '==', null)
      .where('nextRetryAt', '<=', nowIso)
      .limit(batchLimit)
      .get();
    qs.forEach((/** @type {any} */ d) => {
      pending.push({ id: d.id, data: d.data() });
    });
  } catch (qErr) {
    const e = /** @type {any} */ (qErr);
    log('dual_write_worker_query_failed', { err: e && e.message });
    errors.push('query: ' + (e && e.message));
    return { scanned, retried, resolved, failed, stale, errors };
  }

  scanned = pending.length;
  log('dual_write_worker_scan', { scanned, batchLimit, nowIso });

  // 2. Por cada entry: re-leer pedido + retry.
  for (const entry of pending) {
    const pedidoId = entry.id;
    const prevAttempts = Number(entry.data && entry.data.attempts) || 0;
    retried += 1;
    let pedidoDoc = null;
    // 2a. Re-leer el pedido de Firestore.
    try {
      const pedidoSnap = await deps.fbDb.collection('pedidos').doc(pedidoId).get();
      if (!pedidoSnap || !pedidoSnap.exists) {
        // El pedido no existe en Firestore — marca como resolved para
        // sacar el doc del loop (no tiene sentido reintentar).
        await deps.fbDb.collection(DUAL_WRITE_PENDING_COLLECTION).doc(pedidoId).set(
          {
            resolvedAt: nowIso,
            resolvedReason: 'pedido_no_existe',
            lastAttemptAt: nowIso,
          },
          { merge: true }
        );
        resolved += 1;
        log('dual_write_worker_resolved_no_pedido', { pedidoId });
        continue;
      }
      pedidoDoc = pedidoSnap.data() || {};
    } catch (readErr) {
      const e = /** @type {any} */ (readErr);
      log('dual_write_worker_read_pedido_failed', { pedidoId, err: e && e.message });
      errors.push('read ' + pedidoId + ': ' + (e && e.message));
      failed += 1;
      continue;
    }

    // 2b. Invocar replicar.
    let replicateResult = null;
    try {
      replicateResult = await deps.replicateFn(
        {
          fbDb: deps.fbDb,
          pgPool: deps.pgPool,
          featureFlagsDoc: deps.featureFlagsDoc,
          FieldValue: deps.FieldValue,
          log,
        },
        pedidoId,
        pedidoDoc
      );
    } catch (replErr) {
      const e = /** @type {any} */ (replErr);
      log('dual_write_worker_replicate_throw', { pedidoId, err: e && e.message });
      replicateResult = { ok: false, errorMessage: e && e.message };
    }

    // 2c. Procesar resultado.
    if (replicateResult && replicateResult.ok === true) {
      try {
        await deps.fbDb.collection(DUAL_WRITE_PENDING_COLLECTION).doc(pedidoId).set(
          {
            resolvedAt: nowIso,
            resolvedReason: 'replicate_ok',
            lastAttemptAt: nowIso,
          },
          { merge: true }
        );
        resolved += 1;
        log('dual_write_worker_resolved', { pedidoId, attempts: prevAttempts + 1 });
      } catch (markErr) {
        const e = /** @type {any} */ (markErr);
        log('dual_write_worker_mark_resolved_failed', { pedidoId, err: e && e.message });
        errors.push('mark resolved ' + pedidoId + ': ' + (e && e.message));
      }
      continue;
    }

    // Fallo: flag_off/no_pool skippea (no cuenta como retry real), otros
    // incrementan attempts + agendan proximo retry.
    if (replicateResult && replicateResult.skipped) {
      // flag OFF o pool caido — no incrementamos attempts. Dejamos el
      // next retry en +15 min default (sin exponenciar).
      try {
        await deps.fbDb
          .collection(DUAL_WRITE_PENDING_COLLECTION)
          .doc(pedidoId)
          .set(
            {
              lastAttemptAt: nowIso,
              lastSkipReason: replicateResult.skipped,
              nextRetryAt: new Date(now + 15 * 60 * 1000).toISOString(),
            },
            { merge: true }
          );
      } catch (_markSkipErr) {
        // no-op.
      }
      continue;
    }

    // Fallo real — exponenciar + evaluar stale.
    const newAttempts = prevAttempts + 1;
    const simulatedEntry = {
      attempts: newAttempts,
      firstFailedAt: entry.data && entry.data.firstFailedAt,
    };
    const isStale = isDualWritePendingStale(simulatedEntry, { nowIso });
    const nextRetryAt = computeNextRetryAtIso(newAttempts, { nowIso });

    /** @type {Record<string, any>} */
    const updatePayload = {
      attempts:
        deps.FieldValue && typeof deps.FieldValue.increment === 'function'
          ? deps.FieldValue.increment(1)
          : newAttempts,
      lastAttemptAt: nowIso,
      nextRetryAt,
      lastError: (replicateResult && replicateResult.errorMessage) || 'unknown',
    };
    if (isStale && !(entry.data && entry.data.stale)) {
      updatePayload.stale = true;
      updatePayload.staleAt = nowIso;
      stale += 1;
      log('dual_write_pending_stale', {
        pedidoId,
        attempts: newAttempts,
        firstFailedAt: entry.data && entry.data.firstFailedAt,
      });
      // Log a operations_log tambien (admin-visible).
      try {
        await deps.fbDb.collection('operations_log').add({
          type: 'dual_write_pending_stale',
          pedidoId,
          attempts: newAttempts,
          firstFailedAt: (entry.data && entry.data.firstFailedAt) || null,
          lastError: updatePayload.lastError,
          timestamp: new Date(now),
        });
      } catch (_logErr) {
        // no-op.
      }
    }

    try {
      await deps.fbDb
        .collection(DUAL_WRITE_PENDING_COLLECTION)
        .doc(pedidoId)
        .set(updatePayload, { merge: true });
      failed += 1;
    } catch (upErr) {
      const e = /** @type {any} */ (upErr);
      log('dual_write_worker_update_failed', { pedidoId, err: e && e.message });
      errors.push('update ' + pedidoId + ': ' + (e && e.message));
    }
  }

  log('dual_write_worker_done', { scanned, retried, resolved, failed, stale });
  return { scanned, retried, resolved, failed, stale, errors };
}

export const DUAL_WRITE_RETRY_WORKER_VERSION = 1;
