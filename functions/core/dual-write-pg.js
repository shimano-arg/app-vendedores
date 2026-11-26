/**
 * dual-write-pg.js — modulo servidor para replicar `pedidos` Firestore → PG.
 *
 * Stack S-12 Phase 2 (ADR-0016). Wiring post-commit dentro de
 * `commitPedidoCore`. Fire-and-forget: Firestore es fuente de verdad; PG
 * es espejo secundario. Si PG falla, encolamos en `dual_write_pending`
 * (Firestore) para reintento manual sin romper el commit.
 *
 * Diseño:
 *
 *   commitPedidoCore (tx Firestore OK)
 *     │
 *     └─ replicatePedidoToPg(deps, pedidoId, pedidoDoc)
 *            │
 *            ├─ si flag OFF → no-op + log skipped_flag_off.
 *            │
 *            ├─ si deps.pgPool undefined → no-op + log skipped_no_pool.
 *            │
 *            └─ transformPedidoToPg (pure) → BEGIN/stmt/COMMIT (pg.Pool)
 *                   │
 *                   ├─ OK → log dual_write_ok.
 *                   │
 *                   └─ ERR → log dual_write_failed + Firestore set en
 *                            `dual_write_pending/{pedidoId}` (merge:true,
 *                            attempts incrementado).
 *                            NUNCA throw — fire-and-forget.
 *
 * @module functions/core/dual-write-pg
 */

import { transformPedidoToPg } from './dual-write/transform-pedido-to-pg.js';
import { buildDualWritePendingEntry, buildReplicationStatements } from './dual-write-pg-helpers.js';
import { isDualWritePedidosEnabled } from './feature-flags.js';

/**
 * Nombre de la coleccion Firestore donde se encolan pedidos cuya
 * replicacion PG fallo. Doc id = pedidoId (dedupe natural).
 */
export const DUAL_WRITE_PENDING_COLLECTION = 'dual_write_pending';

/**
 * Nombre del flag en `app_config/feature_flags`. Lectura via pure fn
 * `isDualWritePedidosEnabled`.
 */
export const DUAL_WRITE_FLAG_NAME = 'dual_write_pedidos_enabled';

/**
 * Deps shape que acepta `replicatePedidoToPg`.
 *
 * @typedef {Object} DualWriteDeps
 * @property {any} [pgPool] - instancia `pg.Pool` del server. Si undefined,
 *   la replicacion se skipea (no-op + log).
 * @property {any} [fbDb] - instancia `firebase-admin/firestore` (para
 *   enqueue a `dual_write_pending`). Si undefined, el enqueue se skipea
 *   (solo log).
 * @property {Record<string, any> | null} [featureFlagsDoc] - doc
 *   `app_config/feature_flags` ya leido (shape pure). Si es null, se
 *   lee desde fbDb; si tampoco hay fbDb, se asume flag OFF (fail-closed).
 * @property {(message: string, context?: Record<string, any>) => void} [log]
 * @property {any} [FieldValue] - firebase-admin FieldValue (para
 *   increment(1) sobre attempts). Opcional.
 */

/**
 * Ejecuta la secuencia de SQL statements dentro de una transaccion PG.
 * BEGIN; stmts[i]; COMMIT. Si falla cualquier stmt, ROLLBACK + rethrow.
 *
 * @param {any} pgPool - pg.Pool instance.
 * @param {Array<{text: string, values: unknown[]}>} statements
 * @returns {Promise<void>}
 */
export async function executeReplicationTx(pgPool, statements) {
  if (!pgPool) throw new Error('executeReplicationTx: pgPool is required');
  if (!Array.isArray(statements) || statements.length === 0) {
    return; // no-op cuando no hay statements.
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    for (const stmt of statements) {
      await client.query(stmt.text, stmt.values);
    }
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackErr) {
      // Swallow rollback err; original throw es mas util.
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Lee el feature flag `dual_write_pedidos_enabled`. Fail-closed: si no
 * puede leerlo, asume OFF (nunca escribir a PG sin autorizacion).
 *
 * @param {DualWriteDeps} deps
 * @returns {Promise<boolean>}
 */
export async function isFlagEnabled(deps) {
  // Preferencia: doc precargado (evita read extra).
  if (deps && deps.featureFlagsDoc !== undefined && deps.featureFlagsDoc !== null) {
    return isDualWritePedidosEnabled(deps.featureFlagsDoc);
  }
  if (!deps || !deps.fbDb) return false;
  try {
    const snap = await deps.fbDb.doc('app_config/feature_flags').get();
    if (!snap || !snap.exists) return false;
    return isDualWritePedidosEnabled(snap.data());
  } catch (_e) {
    // Fail-closed: cualquier error de lectura → flag OFF.
    return false;
  }
}

/**
 * Encola un entry en `dual_write_pending/{pedidoId}` con merge:true
 * (acumula attempts). Si FieldValue esta disponible, usa increment(1);
 * si no, hace write naive.
 *
 * @param {DualWriteDeps} deps
 * @param {string} pedidoId
 * @param {Error | {message?: string, code?: string}} err
 * @returns {Promise<void>}
 */
export async function enqueuePendingRetry(deps, pedidoId, err) {
  if (!deps || !deps.fbDb) return; // sin fbDb no podemos encolar.
  const log = (deps && deps.log) || (() => {});
  try {
    const entry = buildDualWritePendingEntry(pedidoId, err);
    const docRef = deps.fbDb.collection(DUAL_WRITE_PENDING_COLLECTION).doc(pedidoId);
    // Si tenemos FieldValue.increment, usamos para idempotencia en reintentos.
    if (deps.FieldValue && typeof deps.FieldValue.increment === 'function') {
      await docRef.set(
        {
          ...entry,
          attempts: deps.FieldValue.increment(1),
        },
        { merge: true }
      );
    } else {
      await docRef.set(entry, { merge: true });
    }
  } catch (enqueueErr) {
    log('dual_write_enqueue_failed', {
      pedidoId,
      err: enqueueErr && /** @type {any} */ (enqueueErr).message,
    });
  }
}

/**
 * Replica un documento `pedidos/{id}` de Firestore a PG. Fire-and-forget:
 * nunca propaga errores al caller.
 *
 * Flujo:
 *   1. Chequear flag `dual_write_pedidos_enabled` (fail-closed).
 *   2. Chequear `deps.pgPool` presente.
 *   3. transformPedidoToPg(pedidoDoc) → shape PG.
 *   4. buildReplicationStatements → DELETE + INSERT pedido + INSERT lines.
 *   5. executeReplicationTx (BEGIN/COMMIT atomico).
 *   6. Success → log 'dual_write_ok'.
 *   7. Failure → log 'dual_write_failed' + enqueuePendingRetry.
 *
 * Idempotente por `pedidoId`: 2 ejecuciones consecutivas con mismo
 * pedidoDoc producen el mismo estado final en PG (DELETE antes de INSERT
 * garantiza no duplicados; trigger PG sincroniza stock_reservations).
 *
 * @param {DualWriteDeps} deps
 * @param {string} pedidoId - id del pedido (tambien debe estar en pedidoDoc._fsId o pedidoDoc.id).
 * @param {Record<string, any>} pedidoDoc - documento Firestore con shape
 *   {orderNumber, lines[], clientCardCode, assignedVendorUid, ...}.
 * @returns {Promise<{ok: boolean, skipped?: string, errorMessage?: string}>}
 */
export async function replicatePedidoToPg(deps, pedidoId, pedidoDoc) {
  const log = (deps && deps.log) || (() => {});
  try {
    if (!pedidoId || typeof pedidoId !== 'string') {
      log('dual_write_skipped_invalid_pedidoId', { pedidoId });
      return { ok: false, skipped: 'invalid_pedidoId' };
    }
    if (!pedidoDoc || typeof pedidoDoc !== 'object') {
      log('dual_write_skipped_invalid_pedidoDoc', { pedidoId });
      return { ok: false, skipped: 'invalid_pedidoDoc' };
    }

    // 1. Flag check (fail-closed).
    const enabled = await isFlagEnabled(deps);
    if (!enabled) {
      log('dual_write_skipped_flag_off', { pedidoId });
      return { ok: false, skipped: 'flag_off' };
    }

    // 2. Pool check.
    if (!deps || !deps.pgPool) {
      log('dual_write_skipped_no_pool', { pedidoId });
      return { ok: false, skipped: 'no_pool' };
    }

    // 3. Transform + 4. Build statements.
    //   transformPedidoToPg lanza si header invalido. Lo capturamos y
    //   encolamos para debug (el pedido existe en Firestore pero no se
    //   puede replicar — bug en el shape, necesita manual review).
    let statements;
    try {
      const docWithId = { ...pedidoDoc, _fsId: pedidoDoc._fsId || pedidoDoc.id || pedidoId };
      const result = transformPedidoToPg(docWithId);
      statements = buildReplicationStatements(result);
      if (result.warnings && result.warnings.length > 0) {
        log('dual_write_warnings', { pedidoId, warnings: result.warnings });
      }
    } catch (transformErr) {
      const e = /** @type {any} */ (transformErr);
      log('dual_write_transform_failed', { pedidoId, err: e.message });
      await enqueuePendingRetry(deps, pedidoId, e);
      return { ok: false, errorMessage: e.message };
    }

    // 5. Execute tx.
    try {
      await executeReplicationTx(deps.pgPool, statements);
      log('dual_write_ok', { pedidoId, stmts: statements.length });
      return { ok: true };
    } catch (pgErr) {
      const e = /** @type {any} */ (pgErr);
      log('dual_write_failed', { pedidoId, err: e.message, code: e.code });
      await enqueuePendingRetry(deps, pedidoId, e);
      return { ok: false, errorMessage: e.message };
    }
  } catch (unexpectedErr) {
    // Red de seguridad: cualquier throw inesperado del propio helper NO
    // propaga al caller. Es fire-and-forget.
    const e = /** @type {any} */ (unexpectedErr);
    log('dual_write_fire_forget_err', { pedidoId, err: e && e.message });
    return { ok: false, errorMessage: e && e.message };
  }
}

export const DUAL_WRITE_PG_VERSION = 1;
