// @ts-check
/**
 * v1432 §stock-servidor-atomico — cliente wrapper para commitPedidoCF.
 *
 * Lógica pura con deps inyectables: NO toca `window`, `firebase` directo ni
 * Firestore. El wrapper de index.html pasa los deps.
 *
 * Reglas v1431 + v1432:
 * 1. aborted/functions/aborted → retry 3× con backoff → CONTENTION_RETRY_EXHAUSTED.
 *    NUNCA fallback.
 * 2. Antes de fallback (unavailable/deadline-exceeded/cancelled/not-found/red):
 *    query _draftId. Si existe → post-hoc recovery. Si no → fallback + log.
 * 3. Errores de negocio (unauthenticated/permission-denied/invalid-argument/
 *    internal/etc.) → errorCode mapeado. NUNCA fallback.
 */

export const NETWORK_CODES = new Set([
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/cancelled',
  'functions/not-found',
  'unavailable',
  'deadline-exceeded',
  'cancelled',
  'not-found',
  'network-request-failed',
]);

export const ABORTED_CODES = new Set(['functions/aborted', 'aborted']);
export const ABORTED_BACKOFFS_MS = [100, 300, 900]; // 3 reintentos

/**
 * @typedef {Object} CommitClientDeps
 * @property {() => Promise<any>} callInvoke       Llama al CF, retorna {ok,...} o throws.
 * @property {(draftId: string) => Promise<{empty:boolean, docs: Array<any>}>} queryByDraftId
 *                                                   Firestore query por _draftId == draftId.
 * @property {(entry: any) => Promise<any>} logFallback  Escribe log (console + operations_log).
 * @property {(ms: number) => Promise<void>} [sleep]  Default setTimeout.
 */

/**
 * @typedef {Object} CommitPayload
 * @property {string} draftId
 * @property {string} cardCode
 * @property {string} origen
 * @property {any[]} lines
 * @property {string} clientVersion
 * @property {any} docDataForLog              Shape original para el log entry.
 */

const sleepDefault = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {CommitPayload} payload
 * @param {CommitClientDeps} deps
 * @returns {Promise<any>}
 */
export async function tryCommitPedidoClient(payload, deps) {
  const sleep = deps.sleep || sleepDefault;
  let abortedAttempts = 0;

  while (true) {
    try {
      const result = await deps.callInvoke();
      return result;
    } catch (e) {
      const err = /** @type {any} */ (e);
      const code = (err && err.code) || '';
      const message = (err && err.message) || String(err);

      // Rama ABORTED: retry hasta 3× con backoff. NUNCA fallback.
      if (ABORTED_CODES.has(code)) {
        if (abortedAttempts < ABORTED_BACKOFFS_MS.length) {
          const wait = ABORTED_BACKOFFS_MS[abortedAttempts];
          abortedAttempts++;
          await sleep(wait);
          continue;
        }
        return {
          ok: false,
          errorCode: 'CONTENTION_RETRY_EXHAUSTED',
          message: 'Contención de transacción agotó 3 reintentos: ' + message,
          _rawCode: code,
        };
      }

      // Rama RED: idempotency check pre-fallback.
      const isNetwork =
        NETWORK_CODES.has(code) || (!code && /network|fetch|offline|timeout/i.test(message));
      if (isNetwork) {
        // Query _draftId: si existe, usarlo (post-hoc recovery).
        try {
          const q = await deps.queryByDraftId(payload.draftId);
          if (q && !q.empty && q.docs.length > 0) {
            const doc = q.docs[0];
            await deps.logFallback({
              motivo: 'post_hoc_recovery',
              firebaseCode: code || 'no_code',
              draftId: payload.draftId,
              docData: payload.docDataForLog,
            });
            const dataPed = (doc.data && doc.data()) || {};
            return {
              ok: true,
              pedidoId: doc.id,
              lines: deriveLinesFromExistingPedido(dataPed),
              diffVsClient: null,
              idempotentHit: true,
              _postHocRecovery: true,
            };
          }
        } catch (_eIdem) {
          // Idempotency check falló: cae a fallback con log.
        }
        await deps.logFallback({
          motivo: 'network_or_cf_down',
          firebaseCode: code || 'no_code',
          draftId: payload.draftId,
          docData: payload.docDataForLog,
        });
        return null;
      }

      // Rama NEGOCIO: NUNCA fallback.
      const mappedErrorCode =
        code === 'functions/unauthenticated' || code === 'functions/permission-denied'
          ? 'PERMISSION_DENIED'
          : code === 'functions/invalid-argument'
            ? 'VALIDATION_ERROR'
            : 'INTERNAL';
      return {
        ok: false,
        errorCode: mappedErrorCode,
        message,
        _rawCode: code,
      };
    }
  }
}

/**
 * Deriva {sku, qtyConfirmed, qtyBO} desde un pedido ya persistido.
 * @param {any} pedidoData
 */
export function deriveLinesFromExistingPedido(pedidoData) {
  const result = [];
  const bySku = new Map();
  for (const l of (pedidoData && pedidoData.lines) || []) {
    if (!l || !l.code) continue;
    const code = String(l.code).toUpperCase();
    if (!bySku.has(code)) bySku.set(code, { qtyConfirmed: 0, qtyBO: 0 });
    const entry = /** @type {any} */ (bySku.get(code));
    const qty = Number(l.qty) || 0;
    if (l.state === 'confirmed' || l.state === 'ASIG') entry.qtyConfirmed += qty;
    else if (l.state === 'BO') entry.qtyBO += qty;
  }
  for (const [sku, e] of bySku) {
    const entry = /** @type {any} */ (e);
    // Omitir SKUs sin contribución (ej. todas las líneas cancelled/invoiced).
    if (entry.qtyConfirmed === 0 && entry.qtyBO === 0) continue;
    result.push({
      sku,
      qtyConfirmed: entry.qtyConfirmed,
      qtyBO: entry.qtyBO,
      reason: 'post_hoc_recovery',
    });
  }
  return result;
}
