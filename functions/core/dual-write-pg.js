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
 * Clasifica un error como "esperado del flow PG/transform" (donde enqueue
 * tiene sentido — volver a reintentar manual/worker) vs "inesperado"
 * (ReferenceError, TypeError del helper mismo, bug en commitPedidoCore).
 *
 * M2 (review 2026-11-26): el outer catch antes atrapaba TODO, enmascarando
 * bugs internos (ej. `deps.undefined.undefined`). Ahora el outer solo loguea
 * + escribe `operations_log` con type `dual_write_unexpected_err` y stack
 * truncado a 2000 chars; el fire-and-forget del caller lo recibe pero no
 * lo propaga al cliente.
 *
 * Tipos considerados "esperados de PG":
 *   - pg.DatabaseError (code populated, ej. 23505 unique violation).
 *   - Errores de red con message incluyendo 'ECONNREFUSED', 'ETIMEDOUT',
 *     'connection timeout', 'connection terminated'.
 *   - Errores de pool exhausted.
 *
 * @param {any} err
 * @returns {boolean}
 */
function _isExpectedPgError(err) {
  if (!err) return false;
  // pg.DatabaseError tiene .code string (ej. '23505'). TypeErrors no.
  if (typeof err.code === 'string' && err.code.length > 0) return true;
  const msg = String(err.message || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('connection timeout') ||
    msg.includes('connection terminated') ||
    msg.includes('connection ended') ||
    msg.includes('pool is ended') ||
    msg.includes('too many clients')
  );
}

/**
 * Escribe un entry en `operations_log` con type='dual_write_unexpected_err'.
 * Fire-and-forget: nunca throws.
 *
 * @param {DualWriteDeps} deps
 * @param {string} pedidoId
 * @param {any} err
 */
async function _logUnexpectedToOperationsLog(deps, pedidoId, err) {
  if (!deps || !deps.fbDb) return;
  try {
    const anyErr = /** @type {any} */ (err || {});
    const stack = String(anyErr.stack || anyErr.message || String(err)).slice(0, 2000);
    await deps.fbDb.collection('operations_log').add({
      type: 'dual_write_unexpected_err',
      pedidoId: String(pedidoId || ''),
      errMessage: String(anyErr.message || '').slice(0, 2000),
      errName: String(anyErr.name || ''),
      errStack: stack,
      timestamp: new Date(),
    });
  } catch (_logErr) {
    // Fire-and-forget nested: no bloqueamos.
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
 * M2 (review 2026-11-26): el outer try/catch antes atrapaba TODO
 * (including TypeError/ReferenceError del propio helper) y lo silenciaba
 * con un log noise. Ahora los errores "esperados" (transform + PG) se
 * capturan inline + encolan; errores "inesperados" (bugs del helper)
 * propagan al .catch() del fire-and-forget y ADEMAS escriben a
 * operations_log con stack truncado para forensics.
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
  // Validaciones basicas — guards independientes del try/catch outer.
  if (!pedidoId || typeof pedidoId !== 'string') {
    log('dual_write_skipped_invalid_pedidoId', { pedidoId });
    return { ok: false, skipped: 'invalid_pedidoId' };
  }
  if (!pedidoDoc || typeof pedidoDoc !== 'object') {
    log('dual_write_skipped_invalid_pedidoDoc', { pedidoId });
    return { ok: false, skipped: 'invalid_pedidoDoc' };
  }

  // 1. Flag check (fail-closed). Si isFlagEnabled lanza inesperado, log + propaga.
  let enabled;
  try {
    enabled = await isFlagEnabled(deps);
  } catch (flagErr) {
    const e = /** @type {any} */ (flagErr);
    if (_isExpectedPgError(e)) {
      log('dual_write_flag_read_failed', { pedidoId, err: e && e.message });
      return { ok: false, errorMessage: e && e.message };
    }
    // Inesperado: log + operations_log + rethrow para que .catch() del
    // fire-and-forget lo vea.
    log('dual_write_unexpected_err', { pedidoId, err: e && e.message, phase: 'flag_check' });
    await _logUnexpectedToOperationsLog(deps, pedidoId, e);
    throw e;
  }
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
    // transformPedidoToPg lanza Errors con message 'invalid_pedido_doc: ...'
    // — esperados (shape invalido). Si cualquier otro tipo (TypeError
    // interno) → log operations_log + encolar igual (el shape no se puede
    // replicar; manual review).
    if (!e || (typeof e.message === 'string' && e.message.startsWith('invalid_pedido_doc'))) {
      log('dual_write_transform_failed', { pedidoId, err: e && e.message });
    } else {
      log('dual_write_unexpected_err', {
        pedidoId,
        err: e && e.message,
        phase: 'transform',
      });
      await _logUnexpectedToOperationsLog(deps, pedidoId, e);
    }
    await enqueuePendingRetry(deps, pedidoId, e);
    return { ok: false, errorMessage: e && e.message };
  }

  // 5. Execute tx. Outer catch acotado a errores esperados de PG.
  try {
    await executeReplicationTx(deps.pgPool, statements);
    log('dual_write_ok', { pedidoId, stmts: statements.length });
    return { ok: true };
  } catch (pgErr) {
    const e = /** @type {any} */ (pgErr);
    if (_isExpectedPgError(e)) {
      log('dual_write_failed', { pedidoId, err: e.message, code: e.code });
      await enqueuePendingRetry(deps, pedidoId, e);
      return { ok: false, errorMessage: e.message };
    }
    // Inesperado (TypeError/ReferenceError del codigo mismo): log +
    // operations_log + encolar + rethrow. El .catch del fire-and-forget
    // lo captura.
    log('dual_write_unexpected_err', {
      pedidoId,
      err: e && e.message,
      phase: 'execute_tx',
    });
    await _logUnexpectedToOperationsLog(deps, pedidoId, e);
    await enqueuePendingRetry(deps, pedidoId, e);
    throw e;
  }
}

export const DUAL_WRITE_PG_VERSION = 1;
