// @ts-check
/**
 * reconcile-app-only-core (incidente Federico 2026-11-20, v1568+)
 *
 * Problema: pedidos `app_only` con `reason='sap_item_not_found_all_lines'`
 * quedan marcados `requiresManualResend=true` esperando que admin ejecute
 * un retry manual. Si Mariano crea el alta en SAP (sync poblado en el
 * próximo `syncSapCatalogStockCF` cada 5 min), la app no re-dispara sola
 * el envío. Resultado: el pedido queda invisible a SAP indefinidamente
 * hasta acción humana explícita.
 *
 * Solución: scheduled Cloud Function cada 15 min que escanea pedidos
 * `requiresManualResend=true` con `reason='sap_item_not_found_all_lines'`,
 * verifica si los `missingSkus` ahora existen en `app_config/stock_snapshot
 * .quantities`, y si es así, DELETE `transferidoSAP` del doc para re-
 * disparar el trigger existente `onPedidoConfirmedSendToSap` (que reusa
 * `handleAutoSendSap`).
 *
 * Alcance acotado:
 *   - Solo `reason='sap_item_not_found_all_lines'` (guard LOW riesgo).
 *     Otros `app_only` (SKIP_ALL_BO, SKIP_STOCK_RECHECK_ALL_DEGRADED) NO
 *     se tocan — tienen otra semántica (todo backorder vs todas las líneas
 *     degradadas por re-check live).
 *   - Max 5 attempts por pedido (`reconcileAttempts`). Al 5to intento sin
 *     éxito, se marca `reconcileMaxRetriesAt` y se deja de reintentar (admin
 *     tiene que investigar).
 *
 * Fail-open (§77): si `app_config/stock_snapshot` falta, es muy viejo
 * (> `snapshotMaxAgeMs`, default 30 min), o `quantities` no parsea, se
 * retorna `{processed:0, reDispatched:0, ...}` + log subtype → próxima
 * corrida lo retomará cuando el snapshot esté fresco.
 *
 * §58 (ALL reads before ALL writes): el lock + lectura del pedido viven
 * en runTransaction con reads primero (lockRef.get → pedidoRef.get) y
 * writes después (set lockRef + update pedido). Segunda invocación
 * concurrente sobre el mismo pedidoId ve lockHeld → skip.
 *
 * El trigger existente `onPedidoConfirmedSendToSap` (functions/index.js)
 * se re-dispara al borrar `transferidoSAP` del doc (el update activa
 * `onDocumentWritten`). handleAutoSendSap detecta `!transferidoSAP` +
 * `stage='confirmed'` y procede con el envío normal.
 */

/**
 * @typedef {Object} ReconcileResult
 * @property {number} processed Pedidos para los que se tomó lock + intentó re-dispatch.
 * @property {number} reDispatched Pedidos que efectivamente borraron `transferidoSAP`.
 * @property {number} skipped Pedidos saltados (SKUs faltan, cerrados, ya con docNum, non-catalog reason, lock held).
 * @property {number} maxRetriesExceeded Pedidos que llegaron al límite de attempts.
 * @property {Array<{pedidoId: string, err: string}>} errors Errores non-fatal por pedido.
 */

/**
 * @typedef {Object} ReconcileDeps
 * @property {any} fbDb Firestore Admin SDK.
 * @property {{ delete: () => any }} FieldValue firestore.FieldValue (para `.delete()`).
 * @property {() => number} now Timestamp en ms.
 * @property {string} runId Identificador único de esta corrida (para logs).
 * @property {(msg: string, extra?: any) => void} log
 * @property {number} [snapshotMaxAgeMs] Default 30 * 60 * 1000.
 * @property {number} [maxAttempts] Default 5.
 */

/**
 * Lee `app_config/stock_snapshot` y devuelve el map `{sku:uppercase → qty}`.
 * Fail-open si el doc falta, es stale, o `quantities` no parsea.
 *
 * @param {ReconcileDeps} deps
 * @returns {Promise<{map: Map<string, number>|null, reason?: string, ageMs?: number, updatedAtMs?: number|null}>}
 */
async function loadQuantitiesMap(deps) {
  const maxAge = typeof deps.snapshotMaxAgeMs === 'number' ? deps.snapshotMaxAgeMs : 30 * 60 * 1000;
  let snap;
  try {
    snap = await deps.fbDb.doc('app_config/stock_snapshot').get();
  } catch (_e) {
    return { map: null, reason: 'snapshot_read_failed' };
  }
  if (!snap || !snap.exists) {
    return { map: null, reason: 'snapshot_missing' };
  }
  const data = snap.data() || {};
  // updatedAt puede ser Timestamp admin SDK (tiene toMillis) o Date.
  let updatedAtMs = null;
  const ua = data.updatedAt;
  if (ua) {
    if (typeof ua.toMillis === 'function') updatedAtMs = ua.toMillis();
    else if (ua instanceof Date) updatedAtMs = ua.getTime();
    else if (typeof ua.seconds === 'number') updatedAtMs = ua.seconds * 1000;
  }
  if (updatedAtMs !== null) {
    const age = deps.now() - updatedAtMs;
    if (age > maxAge) {
      return { map: null, reason: 'snapshot_stale', ageMs: age, updatedAtMs };
    }
  }
  const raw = data.quantities;
  if (!raw) return { map: null, reason: 'quantities_missing', updatedAtMs };
  /** @type {Record<string, number>} */
  let parsed;
  try {
    if (typeof raw === 'string') {
      parsed = JSON.parse(raw);
    } else if (typeof raw === 'object') {
      parsed = raw;
    } else {
      return { map: null, reason: 'quantities_invalid_type', updatedAtMs };
    }
  } catch (_e) {
    return { map: null, reason: 'quantities_parse_error', updatedAtMs };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { map: null, reason: 'quantities_empty', updatedAtMs };
  }
  const map = new Map();
  for (const [k, v] of Object.entries(parsed)) {
    if (!k) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    map.set(String(k).toUpperCase(), n);
  }
  if (map.size === 0) {
    return { map: null, reason: 'quantities_empty', updatedAtMs };
  }
  return { map, updatedAtMs };
}

/**
 * Reconcilia pedidos app_only con `reason='sap_item_not_found_all_lines'`
 * cuando los SKUs faltantes ya existen en el catálogo SAP.
 *
 * @param {ReconcileDeps} deps
 * @returns {Promise<ReconcileResult>}
 */
export async function reconcileAppOnlyCore(deps) {
  if (!deps || !deps.fbDb || !deps.FieldValue || typeof deps.now !== 'function') {
    throw new Error('reconcileAppOnlyCore: deps inválidos');
  }
  const log = deps.log || (() => {});
  const runId = deps.runId || 'noid';
  const maxAttempts = typeof deps.maxAttempts === 'number' ? deps.maxAttempts : 5;

  /** @type {ReconcileResult} */
  const result = {
    processed: 0,
    reDispatched: 0,
    skipped: 0,
    maxRetriesExceeded: 0,
    errors: [],
  };

  // 1. Fail-open §77: leer snapshot.
  const q = await loadQuantitiesMap(deps);
  if (!q.map) {
    log('[reconcile-app-only] fail-open snapshot', {
      runId,
      subtype: q.reason,
      ageMs: q.ageMs,
    });
    return result;
  }
  const quantitiesMap = q.map;

  // 2. Query pedidos candidatos.
  // NOTA: index compuesto (stage, transferidoSAP.requiresManualResend) agregado
  // en firestore.indexes.json junto con este core. Firestore crea el índice
  // automáticamente al primer query que lo necesite.
  let qs;
  try {
    qs = await deps.fbDb
      .collection('pedidos')
      .where('stage', '==', 'confirmed')
      .where('transferidoSAP.requiresManualResend', '==', true)
      .limit(50)
      .get();
  } catch (e) {
    log('[reconcile-app-only] query failed', {
      runId,
      err: (e && e.message) || String(e),
    });
    result.errors.push({ pedidoId: '_query', err: (e && e.message) || String(e) });
    return result;
  }

  if (!qs || qs.empty) {
    log('[reconcile-app-only] no candidates', { runId });
    return result;
  }

  /** @type {Array<{id: string, data: any}>} */
  const candidates = [];
  qs.forEach((/** @type {any} */ d) => candidates.push({ id: d.id, data: d.data() || {} }));

  log('[reconcile-app-only] candidates', { runId, count: candidates.length });

  // 3. Procesar uno por uno.
  for (const { id: pedidoId, data: pedido } of candidates) {
    try {
      // 3.a. Skip docs cerrados o ya con docNum.
      if (pedido.closedAt) {
        result.skipped++;
        log('[reconcile-app-only] skip_closed', { runId, pedidoId });
        continue;
      }
      const tSAP = pedido.transferidoSAP || {};
      if (tSAP.docNum != null) {
        result.skipped++;
        log('[reconcile-app-only] skip_already_has_docnum', {
          runId,
          pedidoId,
          docNum: tSAP.docNum,
        });
        continue;
      }
      // 3.b. GUARD CRÍTICO LOW riesgo: solo 'sap_item_not_found_all_lines'.
      if (tSAP.reason !== 'sap_item_not_found_all_lines') {
        result.skipped++;
        log('[reconcile-app-only] skip_non_catalog_reason', {
          runId,
          pedidoId,
          reason: tSAP.reason || null,
        });
        continue;
      }
      // 3.c. Attempts + missingSkus.
      const attempts = Number(tSAP.reconcileAttempts || 0);
      const missingSkus = Array.isArray(tSAP.missingSkus) ? tSAP.missingSkus : [];

      // 3.d. Max retries.
      if (attempts >= maxAttempts) {
        // Marcar una sola vez (idempotente).
        if (!tSAP.reconcileMaxRetriesAt) {
          try {
            await deps.fbDb
              .collection('pedidos')
              .doc(pedidoId)
              .update({
                'transferidoSAP.reconcileMaxRetriesAt': new Date(deps.now()).toISOString(),
              });
          } catch (_e) {
            /* non-fatal */
          }
        }
        result.maxRetriesExceeded++;
        log('[reconcile-app-only] max_retries_exceeded', {
          runId,
          pedidoId,
          attempts,
          maxAttempts,
        });
        continue;
      }

      // 3.e. Verificar que TODOS los SKUs faltantes ahora existen en el catálogo.
      // Si `missingSkus` viene vacío (defensivo), lo tratamos como "no match" → skip.
      if (missingSkus.length === 0) {
        result.skipped++;
        log('[reconcile-app-only] skip_no_missing_skus', { runId, pedidoId });
        continue;
      }
      const stillMissing = missingSkus.filter(
        (/** @type {any} */ s) => !quantitiesMap.has(String(s || '').toUpperCase())
      );
      if (stillMissing.length > 0) {
        result.skipped++;
        log('[reconcile-app-only] still_missing', {
          runId,
          pedidoId,
          stillMissing,
          totalMissing: missingSkus.length,
        });
        continue;
      }

      // 3.f. Lock + marcar attempt (tx §58: ALL reads before ALL writes).
      const lockRef = deps.fbDb.collection('app_only_reconcile_locks').doc(pedidoId);
      const pedidoRef = deps.fbDb.collection('pedidos').doc(pedidoId);
      let lockAcquired = false;
      try {
        await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
          // READS
          const lockSnap = await tx.get(lockRef);
          const pedidoSnap = await tx.get(pedidoRef);
          // Validaciones.
          if (lockSnap.exists) {
            const ld = lockSnap.data() || {};
            const expiresAt = Number(ld.expiresAt || 0);
            if (expiresAt > deps.now()) {
              const err = /** @type {any} */ (new Error('LOCK_HELD'));
              err._skip = 'lock_held';
              throw err;
            }
          }
          if (!pedidoSnap.exists) {
            const err = /** @type {any} */ (new Error('DOC_GONE'));
            err._skip = 'doc_gone';
            throw err;
          }
          const fresh = pedidoSnap.data() || {};
          const freshT = fresh.transferidoSAP || {};
          if (freshT.requiresManualResend !== true) {
            const err = /** @type {any} */ (new Error('ALREADY_PROCESSED'));
            err._skip = 'already_processed';
            throw err;
          }
          if (freshT.docNum != null) {
            const err = /** @type {any} */ (new Error('ALREADY_HAS_DOCNUM'));
            err._skip = 'already_has_docnum';
            throw err;
          }
          // WRITES
          const nowMs = deps.now();
          const nowIso = new Date(nowMs).toISOString();
          tx.set(lockRef, {
            lockedAt: nowIso,
            lockedBy: `cf-reconcile-app-only/${runId}`,
            expiresAt: nowMs + 5 * 60 * 1000, // 5 min
            pedidoId,
          });
          tx.update(pedidoRef, {
            'transferidoSAP.reconcileAttempts': attempts + 1,
            'transferidoSAP.reconcileLastAt': nowIso,
            'transferidoSAP.reconcileRunId': runId,
          });
        });
        lockAcquired = true;
      } catch (eRaw) {
        const e = /** @type {any} */ (eRaw);
        if (e && e._skip) {
          result.skipped++;
          log('[reconcile-app-only] tx_skip', {
            runId,
            pedidoId,
            reason: e._skip,
          });
          continue;
        }
        // Error inesperado en la tx.
        result.errors.push({ pedidoId, err: (e && e.message) || String(e) });
        log('[reconcile-app-only] tx_failed', {
          runId,
          pedidoId,
          err: (e && e.message) || String(e),
        });
        continue;
      }

      if (!lockAcquired) continue;

      result.processed++;
      // Log de intento (fire-and-forget, non-blocking).
      deps.fbDb
        .collection('operations_log')
        .add({
          type: 'reconcile_app_only_attempt',
          subtype: 'reconcile_attempt_start',
          runId,
          pedidoId,
          cardCode: pedido.clientCardCode || null,
          clientName: pedido.clientName || null,
          missingSkus,
          attempt: attempts + 1,
          maxAttempts,
          timestamp: new Date(deps.now()),
        })
        .catch(() => {
          /* fire-and-forget */
        });

      // 3.g. PUNTO CRÍTICO — borrar transferidoSAP para re-disparar el trigger.
      try {
        await deps.fbDb.collection('pedidos').doc(pedidoId).update({
          transferidoSAP: deps.FieldValue.delete(),
        });
        result.reDispatched++;
        log('[reconcile-app-only] reconcile_resend_triggered', {
          runId,
          pedidoId,
          missingSkus,
          attempt: attempts + 1,
        });
        // Log del resend (fire-and-forget).
        deps.fbDb
          .collection('operations_log')
          .add({
            type: 'reconcile_app_only_attempt',
            subtype: 'reconcile_resend_triggered',
            runId,
            pedidoId,
            cardCode: pedido.clientCardCode || null,
            missingSkus,
            attempt: attempts + 1,
            timestamp: new Date(deps.now()),
          })
          .catch(() => {});
      } catch (deleteErr) {
        result.errors.push({
          pedidoId,
          err: (deleteErr && deleteErr.message) || String(deleteErr),
        });
        log('[reconcile-app-only] delete_transferidoSAP_failed', {
          runId,
          pedidoId,
          err: (deleteErr && deleteErr.message) || String(deleteErr),
        });
        // El lock queda escrito (expira en 5 min). La próxima corrida
        // reintentará si todavía aplica.
      }
    } catch (e) {
      // Catch defensivo por pedido — no detener el batch.
      result.errors.push({
        pedidoId,
        err: (e && e.message) || String(e),
      });
      log('[reconcile-app-only] pedido_loop_failed', {
        runId,
        pedidoId,
        err: (e && e.message) || String(e),
      });
    }
  }

  return result;
}
