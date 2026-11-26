/**
 * on-pedido-write-to-pg.js — Cloud Function stub DESHABILITADA en v0.
 *
 * ADR-008 §Opción B paso 1 — trigger `onDocumentWritten('pedidos/{pedidoId}')`
 * que replica cada mutación a PG. Detrás del flag
 * `app_config/feature_flags.dual_write_pedidos_enabled` (default `false`).
 *
 * Diseño S-10.3 (feat/s10-dual-write-design, 2026-11-26).
 *
 * ⚠️ IMPORTANTE: esta CF NO está exportada en `functions/index.js`. Deploy
 * manual + flip flag post-staging OK. Mariano autoriza explícitamente antes
 * de activar.
 *
 * Patrón CLAUDE.md §7: core puro + wrapper Firebase. Dependencias inyectadas.
 *
 * ESTE WRAPPER NO SE DISPARA EN PROD HOY. Es stub listo-para-activar.
 */

import { transformPedidoToPg } from '../core/dual-write/transform-pedido-to-pg.js';
import { readFlag } from '../core/feature-flags.js';

/**
 * @typedef {Object} DualWriteDeps
 * @property {Object} fbDb - admin SDK Firestore instance.
 * @property {Object} pgClient - PG client con `.query(sql, params)` (interfaz node-postgres compatible).
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 */

/**
 * @typedef {Object} DualWriteEvent
 * @property {string} pedidoId
 * @property {Object | null} beforeData - documento Firestore pre-write (null en create).
 * @property {Object | null} afterData - documento Firestore post-write (null en delete).
 */

/**
 * Core pure-ish (acepta deps). Flag-gated. Fail-open: nunca throw al wrapper.
 *
 * @param {DualWriteEvent} event
 * @param {Record<string, unknown> | null} flagsDoc - app_config/feature_flags data.
 * @param {DualWriteDeps} deps
 * @returns {Promise<{skipped: boolean, reason?: string, applied?: boolean, error?: string}>}
 */
export async function onPedidoWriteToPgCore(event, flagsDoc, deps) {
  const log = deps.log || (() => {});

  // ---- FASE 0: GATE DEL FLAG -----
  const dualWriteEnabled = readFlag(flagsDoc, 'dual_write_pedidos_enabled', false);
  if (!dualWriteEnabled) {
    log('dual_write_skipped_flag_off', { pedidoId: event.pedidoId });
    return { skipped: true, reason: 'flag_off' };
  }

  // ---- FASE 1: ROUTING -----
  // DELETE: soft-delete en PG. En v0 marcamos closed_at + closed_reason.
  if (event.afterData === null && event.beforeData !== null) {
    try {
      await deps.pgClient.query(
        'UPDATE pedidos SET closed_at = NOW(), closed_reason = $1 WHERE id = $2',
        ['firestore_doc_deleted', event.pedidoId]
      );
      log('dual_write_delete_applied', { pedidoId: event.pedidoId });
      return { applied: true };
    } catch (e) {
      log('dual_write_delete_failed', {
        pedidoId: event.pedidoId,
        err: e && e.message ? e.message : 'unknown',
      });
      await writeFailureLog(deps, event, 'delete', e);
      return { error: 'pg_delete_failed' };
    }
  }

  // CREATE o UPDATE: transformar y upsert.
  const doc = Object.assign({ _fsId: event.pedidoId }, event.afterData || {});

  /** @type {{pedido: Record<string, any>, lines: Array<Record<string, any>>, reservations: Array<Record<string, any>>, warnings: string[]}} */
  let transformed;
  try {
    transformed = transformPedidoToPg(doc);
  } catch (e) {
    log('dual_write_transform_failed', {
      pedidoId: event.pedidoId,
      err: e && e.message ? e.message : 'unknown',
    });
    await writeFailureLog(deps, event, 'transform', e);
    return { error: 'transform_failed' };
  }

  // ---- FASE 2: PG UPSERT ----
  // El upsert concreto es responsabilidad de la capa P1.3 (PG DAO layer).
  // v0 deja un wrapper que debe conectarse al DAO cuando P1.3 aterrize.
  try {
    await upsertPedidoInPg(deps.pgClient, transformed, event.pedidoId, log);
    if (transformed.warnings && transformed.warnings.length > 0) {
      log('dual_write_applied_with_warnings', {
        pedidoId: event.pedidoId,
        warnings: transformed.warnings,
      });
    } else {
      log('dual_write_applied', { pedidoId: event.pedidoId });
    }
    return { applied: true };
  } catch (e) {
    log('dual_write_pg_failed', {
      pedidoId: event.pedidoId,
      err: e && e.message ? e.message : 'unknown',
    });
    await writeFailureLog(deps, event, 'upsert', e);
    return { error: 'pg_upsert_failed' };
  }
}

/**
 * Upsert del shape PG via transacción. El DAO concreto vive en la capa P1.3
 * (fuera de scope de este PR). v0: función con mismo shape que el DAO final
 * para que al wirearla no haya cambios en el core.
 *
 * @param {Object} pgClient - debe tener `.query(sql, params)` compatible node-postgres.
 * @param {{pedido: Record<string, any>, lines: Array<Record<string, any>>, reservations: Array<Record<string, any>>}} shape
 * @param {string} pedidoId
 * @param {(msg: string, extra?: Record<string, unknown>) => void} log
 */
async function upsertPedidoInPg(pgClient, shape, pedidoId, log) {
  // Nota: el DAO real (P1.3) implementará:
  //   BEGIN;
  //   pg_advisory_xact_lock(hashtext(pedidoId));
  //   INSERT INTO pedidos ... ON CONFLICT (id) DO UPDATE ...;
  //   DELETE FROM pedido_lines WHERE pedido_id=$1;
  //   INSERT INTO pedido_lines (...) VALUES ...;
  //   -- stock_reservations se derivan automaticamente por trigger (schema 0001).
  //   COMMIT;
  //
  // En v0 este helper es un placeholder que delega al pgClient si tiene un
  // método `.dualWriteUpsert(shape)`. Si no, loguea y hace no-op (fail-open
  // defensivo — nunca rompe el write Firestore que ya pasó).
  if (pgClient && typeof pgClient.dualWriteUpsert === 'function') {
    await pgClient.dualWriteUpsert(shape);
    return;
  }
  log('dual_write_upsert_noop_in_v0', { pedidoId });
}

/**
 * Escribe un log en `operations_log` sobre el fallo. Fire-and-forget con
 * await para garantizar persistencia antes de retornar (§64.2 pattern
 * centralizado). Si el write a operations_log tambien falla, se traga.
 *
 * @param {DualWriteDeps} deps
 * @param {DualWriteEvent} event
 * @param {'transform' | 'upsert' | 'delete'} stage
 * @param {unknown} err
 */
async function writeFailureLog(deps, event, stage, err) {
  if (!deps.fbDb) return;
  const errMsg =
    err && /** @type {any} */ (err).message ? /** @type {any} */ (err).message : 'unknown';
  try {
    await deps.fbDb.collection('operations_log').add({
      type: 'dual_write_write_failed',
      pedidoId: event.pedidoId,
      stage: stage,
      errMessage: String(errMsg).slice(0, 2000),
      // Firestore doc no se tocó — sigue siendo fuente de verdad en Fase 1.
      // Este log habilita backfill posterior cuando PG vuelva.
      timestamp: new Date(),
    });
  } catch (_e) {
    // Si operations_log falla también, seguimos. No bloquea el flow.
  }
}

/**
 * Lectura del flag + wiring del wrapper. Para uso cuando se exporte en
 * `functions/index.js` (activar en S-10.3.1).
 *
 * @param {Object} fbDb - admin SDK Firestore.
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function loadFeatureFlagsDoc(fbDb) {
  try {
    const snap = await fbDb.doc('app_config/feature_flags').get();
    if (!snap.exists) return null;
    return snap.data() || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Wrapper para el trigger `onDocumentWritten` de Firebase Functions Gen 2.
 * Firma compatible con `onDocumentWritten(path, (event) => Promise<void>)`.
 *
 * ⚠️ Export DELIBERADAMENTE OMITIDO en `functions/index.js`. Deploy manual
 * cuando se autorice Fase 1.
 *
 * @param {Object} fbDb
 * @param {Object} pgClient
 * @param {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @returns {(event: any) => Promise<void>}
 */
export function createOnPedidoWriteHandler(fbDb, pgClient, log) {
  return async function handler(event) {
    const pedidoId = event.params && event.params.pedidoId;
    if (!pedidoId) return;

    const beforeData =
      event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const afterData =
      event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;

    const flagsDoc = await loadFeatureFlagsDoc(fbDb);

    await onPedidoWriteToPgCore({ pedidoId, beforeData, afterData }, flagsDoc, {
      fbDb,
      pgClient,
      log,
    });
  };
}

export const DUAL_WRITE_TRIGGER_VERSION = 1;
