/**
 * nightly-parity-check.js — scheduled CF stub DESHABILITADA en v0.
 *
 * ADR-008 §Opción B paso 2 — audit nocturno que compara Firestore vs PG para
 * cada pedido abierto y reporta divergencias. Detrás del flag
 * `app_config/feature_flags.dual_write_pedidos_enabled` (default `false`).
 *
 * Shape del output:
 *   - Entry por pedido divergente en `operations_log` type=`dual_write_parity_failed`.
 *   - Entry resumen del run en `operations_log` type=`dual_write_parity_check`.
 *   - Alerta email si count > 0 (reusa pattern §60).
 *
 * Diseño S-10.3.2 (feat/s10-dual-write-design, 2026-11-26).
 *
 * ⚠️ IMPORTANTE: esta CF NO está exportada en `functions/index.js`. Deploy
 * manual + flip flag post-staging OK. Mariano autoriza explícitamente antes
 * de activar.
 *
 * Patrón CLAUDE.md §7: core puro + wrapper Firebase. Dependencias inyectadas.
 */

import { comparePedidoParity } from '../core/dual-write/compare-pedido-parity.js';
import { readFlag } from '../core/feature-flags.js';

/**
 * @typedef {Object} ParityCheckDeps
 * @property {Object} fbDb - admin SDK Firestore.
 * @property {Object} pgClient - PG client (.query compatible node-postgres).
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {number} [maxPedidos] - límite defensivo. Default 5000.
 */

/**
 * @typedef {Object} ParityCheckResult
 * @property {number} scanned
 * @property {number} ok
 * @property {number} failed
 * @property {number} skipped
 * @property {Array<{pedidoId: string, diffCount: number}>} failures
 */

/**
 * Lee el shape PG de un pedido para comparar. v0: delega al pgClient si
 * tiene `.getPedidoShapeForParity(pedidoId)`; si no, devuelve null (el core
 * detecta "PG vacío" como divergencia critical).
 *
 * @param {Object} pgClient
 * @param {string} pedidoId
 * @returns {Promise<{pedido: Record<string, any>, lines: Array<Record<string, any>>, reservations: Array<Record<string, any>>} | null>}
 */
async function fetchPgShape(pgClient, pedidoId) {
  if (pgClient && typeof pgClient.getPedidoShapeForParity === 'function') {
    return await pgClient.getPedidoShapeForParity(pedidoId);
  }
  return null;
}

/**
 * Audit nocturno. Itera pedidos abiertos en Firestore + compara contra PG.
 *
 * @param {Record<string, unknown> | null} flagsDoc
 * @param {ParityCheckDeps} deps
 * @returns {Promise<{skipped: boolean, reason?: string, result?: ParityCheckResult}>}
 */
export async function nightlyParityCheckCore(flagsDoc, deps) {
  const log = deps.log || (() => {});
  const maxPedidos = deps.maxPedidos || 5000;

  // ---- FASE 0: GATE DEL FLAG ----
  const dualWriteEnabled = readFlag(flagsDoc, 'dual_write_pedidos_enabled', false);
  if (!dualWriteEnabled) {
    log('nightly_parity_skipped_flag_off');
    return { skipped: true, reason: 'flag_off' };
  }

  // ---- FASE 1: QUERY DE PEDIDOS ABIERTOS ----
  // Patrón CLAUDE.md §39: all stock-related reads van por getStockBreakdown.
  // Aquí es un audit explícito; usamos query Firestore directa.
  /** @type {Array<{id: string, data: Object}>} */
  const abiertos = [];
  try {
    const qs = await deps.fbDb
      .collection('pedidos')
      .where('closedAt', '==', null)
      .limit(maxPedidos)
      .get();
    qs.forEach((d) => {
      abiertos.push({ id: d.id, data: d.data() });
    });
  } catch (e) {
    log('nightly_parity_firestore_query_failed', {
      err: e && e.message ? e.message : 'unknown',
    });
    return {
      skipped: true,
      reason: 'firestore_query_failed',
    };
  }

  // ---- FASE 2: COMPARE LOOP ----
  const result = {
    scanned: abiertos.length,
    ok: 0,
    failed: 0,
    skipped: 0,
    /** @type {Array<{pedidoId: string, diffCount: number}>} */
    failures: [],
  };

  for (const { id, data } of abiertos) {
    let pgShape;
    try {
      pgShape = await fetchPgShape(deps.pgClient, id);
    } catch (e) {
      result.skipped++;
      log('nightly_parity_pg_fetch_failed', {
        pedidoId: id,
        err: e && e.message ? e.message : 'unknown',
      });
      continue;
    }

    const fsDoc = Object.assign({ _fsId: id }, data);
    const parity = comparePedidoParity(fsDoc, pgShape);

    if (parity.ok) {
      result.ok++;
      continue;
    }

    result.failed++;
    const criticalDiffs = parity.diff.filter((d) => d.severity === 'critical');
    result.failures.push({ pedidoId: id, diffCount: criticalDiffs.length });

    // Escribir entry individual en operations_log.
    try {
      await deps.fbDb.collection('operations_log').add({
        type: 'dual_write_parity_failed',
        pedidoId: id,
        criticalCount: criticalDiffs.length,
        totalDiffCount: parity.diff.length,
        diff: parity.diff.slice(0, 50), // cap defensivo.
        timestamp: new Date(),
      });
    } catch (_e) {
      // operations_log write failure es tolerable — seguir con el run.
    }
  }

  // ---- FASE 3: RESUMEN ----
  try {
    await deps.fbDb.collection('operations_log').add({
      type: 'dual_write_parity_check',
      scanned: result.scanned,
      ok: result.ok,
      failed: result.failed,
      skipped: result.skipped,
      failureSample: result.failures.slice(0, 20),
      timestamp: new Date(),
    });
  } catch (_e) {
    // Idem.
  }

  log('nightly_parity_completed', {
    scanned: result.scanned,
    ok: result.ok,
    failed: result.failed,
    skipped: result.skipped,
  });

  return { skipped: false, result };
}

/**
 * Wrapper para `onSchedule('every 24 hours')`. Firma compatible con
 * firebase-functions Gen 2.
 *
 * ⚠️ Export DELIBERADAMENTE OMITIDO en `functions/index.js`. Deploy manual
 * cuando se autorice Fase 2.
 *
 * @param {Object} fbDb
 * @param {Object} pgClient
 * @param {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @returns {() => Promise<void>}
 */
export function createNightlyParityHandler(fbDb, pgClient, log) {
  return async function handler() {
    let flagsDoc = null;
    try {
      const snap = await fbDb.doc('app_config/feature_flags').get();
      if (snap.exists) flagsDoc = snap.data() || null;
    } catch (_e) {
      // Fail-open §77: sin flag doc, el core trata como OFF.
    }
    await nightlyParityCheckCore(flagsDoc, { fbDb, pgClient, log });
  };
}

export const NIGHTLY_PARITY_VERSION = 1;
