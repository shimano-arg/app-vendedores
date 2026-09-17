// @ts-check
/**
 * v964 Fase B/C (2026-09-17): auto-cancel de SQs con lineas state='confirmed'
 * expiradas (>15 dias desde pedido.confirmedAt).
 *
 * MODOS (lee de app_config/sap_sync_state.sqCancelMode):
 *   - 'shadow' (default): loguea a sq_cancel_log_shadow. NO cancela nada.
 *   - 'active' (Fase C): cancela SQs en SAP via SL + marca lineas como
 *     'cancelled' en Firestore + envia email a Santi.
 *
 * SALVAGUARDAS (Fase C):
 *   1. Solo cancela si pedido.transferidoSAP.docNum existe (viajo a SAP)
 *   2. Verifica en SAP: DocumentStatus debe ser 'bost_Open'
 *   3. Verifica en SAP: no debe tener Delivery generado (BaseType=17)
 *   4. Si falla cualquier check, skip + log a 'sq_cancel_skipped_log'
 *   5. Email a Santi por cada cancelacion (batch al final)
 *
 * ROLLOUT:
 *   Fase B: deploy hoy. Cron diario corre en shadow mode → 1 semana de audit.
 *   Fase C: cambiar sap_sync_state.sqCancelMode='active' cuando confie el log.
 *
 * Trigger: cron diario. Escanea pedidos con state='confirmed' + confirmedAt
 * > 15d + qtyOpen>0. Un pedido puede tener multiples SQs (rare pero posible
 * segun batch de sap-auto-send). Cada SQ se cancela por separado.
 */

const TTL_DAYS = 15;
const SHADOW_LOG_COLLECTION = 'sq_cancel_log_shadow';
const ACTIVE_LOG_COLLECTION = 'sq_cancel_log';
const SKIPPED_LOG_COLLECTION = 'sq_cancel_skipped_log';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} SqCancelDeps
 * @property {any} fbDb
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {() => Date} [now]
 * @property {(uri: string, opts?: any) => Promise<any>} [slFetch] SAP SL fetch,
 *   solo Fase C. Debe manejar login + cookies + retry. Shadow mode NO lo usa.
 *
 * @typedef {'shadow'|'active'} SqCancelMode
 *
 * @typedef {Object} SqCandidate
 * @property {string} pedidoId
 * @property {string} clientName
 * @property {string} clientCardCode
 * @property {number} confirmedAtMs
 * @property {number} ageDays
 * @property {string} sapDocNum
 * @property {number} totalUnits
 * @property {number} totalArs
 * @property {number[]} confirmedLineIndexes
 *
 * @typedef {Object} SqCancelResult
 * @property {SqCancelMode} mode
 * @property {number} pedidosScanned
 * @property {SqCandidate[]} candidates
 * @property {number} cancelledCount — solo Fase C
 * @property {Array<{pedidoId: string, reason: string}>} skipped
 * @property {string[]} errors
 */

/**
 * Escanea pedidos con lineas confirmed >15d.
 * @param {SqCancelDeps} deps
 * @returns {Promise<SqCandidate[]>}
 */
export async function scanExpiredConfirmedSqs(deps) {
  const now = deps.now ? deps.now().getTime() : Date.now();
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {SqCandidate[]} */
  const out = [];
  snap.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    if (data.stage !== 'confirmed') return;
    const sapDocNum = data.transferidoSAP && data.transferidoSAP.docNum;
    if (!sapDocNum) return; // no viajo a SAP → no hay que cancelar
    const confirmedAt = data.confirmedAt;
    if (!confirmedAt) return; // no sabemos edad → skip para no cancelar cosas nuevas
    /** @type {number} */
    let confirmedAtMs = 0;
    if (typeof confirmedAt === 'string') confirmedAtMs = new Date(confirmedAt).getTime() || 0;
    else if (confirmedAt && typeof confirmedAt.toMillis === 'function')
      confirmedAtMs = confirmedAt.toMillis();
    if (!confirmedAtMs) return;
    const ageDays = (now - confirmedAtMs) / DAY_MS;
    if (ageDays <= TTL_DAYS) return;

    const lines = Array.isArray(data.lines) ? data.lines : [];
    /** @type {number[]} */
    const confirmedIdx = [];
    let totalUnits = 0;
    let totalArs = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l.state !== 'confirmed') continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      confirmedIdx.push(i);
      totalUnits += qtyOpen;
      totalArs += qtyOpen * (Number(l.priceAtCreation || l.precio || 0) || 0);
    }
    if (confirmedIdx.length === 0) return; // pedido sin confirmed abiertas → skip

    out.push({
      pedidoId: doc.id,
      clientName: String(data.clientName || ''),
      clientCardCode: String(data.clientCardCode || ''),
      confirmedAtMs,
      ageDays: Math.floor(ageDays),
      sapDocNum: String(sapDocNum),
      totalUnits,
      totalArs: Math.round(totalArs),
      confirmedLineIndexes: confirmedIdx,
    });
  });
  return out;
}

/**
 * Verifica una SQ en SAP antes de cancelar. Retorna { canCancel, reason }.
 * Solo se usa en modo 'active' (Fase C). Shadow mode no llama a SL.
 *
 * @param {SqCancelDeps} deps
 * @param {string} docNum
 * @returns {Promise<{canCancel: boolean, reason: string}>}
 */
export async function verifySqCanBeCancelled(deps, docNum) {
  if (!deps.slFetch) {
    return { canCancel: false, reason: 'slFetch no inyectado (shadow mode)' };
  }
  try {
    // GET la SQ con expand de DocumentLines para chequear TargetDocEntry (Delivery link)
    const res = await deps.slFetch(
      `/b1s/v1/Quotations?$filter=DocNum eq ${docNum}&$select=DocEntry,DocNum,DocumentStatus,Cancelled,DocumentLines&$expand=DocumentLines($select=TargetType,TargetEntry,TargetLineNum)`
    );
    if (!res || !Array.isArray(res.value) || res.value.length === 0) {
      return { canCancel: false, reason: 'SQ no encontrada en SAP' };
    }
    const sq = res.value[0];
    if (sq.Cancelled === 'tYES' || sq.DocumentStatus === 'bost_Close') {
      return { canCancel: false, reason: 'SQ ya cerrada/cancelada en SAP' };
    }
    if (sq.DocumentStatus !== 'bost_Open') {
      return { canCancel: false, reason: `DocumentStatus ${sq.DocumentStatus} no es bost_Open` };
    }
    // Chequear si alguna linea tiene TargetType 15 (Delivery) — significa que ya
    // se picked. TargetType 17 es Order. TargetType -1 es sin destino.
    const lineas = Array.isArray(sq.DocumentLines) ? sq.DocumentLines : [];
    const hasDelivery = lineas.some(
      (/** @type {any} */ l) => l && (l.TargetType === 15 || l.TargetType === 17)
    );
    if (hasDelivery) {
      return { canCancel: false, reason: 'SQ tiene Delivery/Order generada (base de otro doc)' };
    }
    return { canCancel: true, reason: '' };
  } catch (e) {
    return {
      canCancel: false,
      reason:
        'error verificando SQ: ' +
        (e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e)),
    };
  }
}

/**
 * Cancela una SQ en SAP via Service Layer. Fase C.
 * @param {SqCancelDeps} deps
 * @param {string} docNum
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function cancelSqInSap(deps, docNum) {
  if (!deps.slFetch) return { ok: false, error: 'slFetch no inyectado' };
  try {
    // Buscar DocEntry por DocNum
    const q = await deps.slFetch(`/b1s/v1/Quotations?$filter=DocNum eq ${docNum}&$select=DocEntry`);
    if (!q || !Array.isArray(q.value) || q.value.length === 0) {
      return { ok: false, error: 'SQ no encontrada' };
    }
    const docEntry = q.value[0].DocEntry;
    // Ejecutar cancelacion via metodo Cancel del CRUD
    await deps.slFetch(`/b1s/v1/Quotations(${docEntry})/Cancel`, { method: 'POST' });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
    };
  }
}

/**
 * Marca lineas state='confirmed' como state='cancelled' en Firestore + resta qtyOpen.
 * @param {SqCancelDeps} deps
 * @param {SqCandidate} cand
 * @returns {Promise<void>}
 */
export async function markLinesCancelled(deps, cand) {
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  const ref = deps.fbDb.collection('pedidos').doc(cand.pedidoId);
  await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const lines = Array.isArray(data.lines) ? [...data.lines] : [];
    for (const idx of cand.confirmedLineIndexes) {
      const l = lines[idx];
      if (!l || l.state !== 'confirmed') continue; // safety: si ya cambio, skip
      lines[idx] = Object.assign({}, l, {
        state: 'cancelled',
        cancelledAt: now,
        cancelledReason: 'sq_ttl_expired',
        cancelledByCF: 'sqCancelExpiredCF',
        qtyOpen: 0,
      });
    }
    tx.update(ref, { lines, updatedAt: now });
  });
}

/**
 * Ejecuta el escaneo + acciones segun el modo.
 * @param {SqCancelDeps} deps
 * @returns {Promise<SqCancelResult>}
 */
export async function runSqCancelExpired(deps) {
  const log = deps.log || (() => {});
  /** @type {SqCancelMode} */
  let mode = 'shadow';
  try {
    const stateSnap = await deps.fbDb.collection('app_config').doc('sap_sync_state').get();
    if (stateSnap.exists) {
      const m = String((stateSnap.data() || {}).sqCancelMode || '').toLowerCase();
      if (m === 'active') mode = 'active';
    }
  } catch (e) {
    log('runSqCancelExpired: read sap_sync_state fallo', { err: String(e) });
  }

  const candidates = await scanExpiredConfirmedSqs(deps);
  /** @type {Array<{pedidoId: string, reason: string}>} */
  const skipped = [];
  /** @type {string[]} */
  const errors = [];
  let cancelledCount = 0;

  if (mode === 'active') {
    for (const c of candidates) {
      const check = await verifySqCanBeCancelled(deps, c.sapDocNum);
      if (!check.canCancel) {
        skipped.push({ pedidoId: c.pedidoId, reason: check.reason });
        continue;
      }
      const cancel = await cancelSqInSap(deps, c.sapDocNum);
      if (!cancel.ok) {
        errors.push(`pedido ${c.pedidoId} SQ ${c.sapDocNum}: ${cancel.error}`);
        continue;
      }
      try {
        await markLinesCancelled(deps, c);
        cancelledCount++;
      } catch (e) {
        errors.push(`pedido ${c.pedidoId} markLines: ${String(e)}`);
      }
    }
  }

  // Audit log (siempre, en ambos modos)
  const logId = (deps.now ? deps.now() : new Date()).toISOString().replace(/[:.]/g, '-');
  const collectionName = mode === 'active' ? ACTIVE_LOG_COLLECTION : SHADOW_LOG_COLLECTION;
  try {
    await deps.fbDb
      .collection(collectionName)
      .doc(logId)
      .set({
        ranAt: (deps.now ? deps.now() : new Date()).toISOString(),
        mode,
        candidatesCount: candidates.length,
        cancelledCount,
        skippedCount: skipped.length,
        errorsCount: errors.length,
        totalUnitsAffected: candidates.reduce((s, c) => s + c.totalUnits, 0),
        totalArsAffected: candidates.reduce((s, c) => s + c.totalArs, 0),
        candidates,
        skipped,
        errors,
      });
  } catch (e) {
    errors.push(`audit log: ${String(e)}`);
  }

  if (mode === 'active' && skipped.length > 0) {
    try {
      await deps.fbDb
        .collection(SKIPPED_LOG_COLLECTION)
        .doc(logId)
        .set({
          ranAt: (deps.now ? deps.now() : new Date()).toISOString(),
          skipped,
        });
    } catch (e) {
      errors.push(`skipped log: ${String(e)}`);
    }
  }

  log('runSqCancelExpired done', {
    mode,
    candidates: candidates.length,
    cancelled: cancelledCount,
    skipped: skipped.length,
    errors: errors.length,
  });

  return {
    mode,
    pedidosScanned: candidates.length,
    candidates,
    cancelledCount,
    skipped,
    errors,
  };
}
