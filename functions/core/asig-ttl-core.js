// @ts-check
/**
 * E7: TTL 30d para lineas ASIG. Diariamente libera lineas que llevan > 30 dias
 * en state='ASIG' sin reciclar ni cancelar.
 *
 * Efecto por linea expirada:
 *   - state = 'expired'
 *   - qtyExpired += qtyOpen
 *   - qtyOpen = 0
 *   - expiredAt = now (nuevo campo)
 *
 * Efecto por pedido:
 *   - si TODAS las lineas quedan cerradas (qtyOpen<=0) -> closedAt=now,
 *     closedReason='ttl_expired' (si no habia otro reason).
 *
 * Efecto sistema:
 *   - E3 dispara automatico por el pedido write -> stock_snapshot_app se
 *     actualiza (asig sale, backorder no aumenta porque line quedo 'expired').
 *   - Stock queda logicamente liberado; proximo tick E4.5 con delta positivo
 *     en dep 11 puede reasignar a otros clientes en cola FIFO.
 *
 * Audit log: 1 doc por corrida en `asig_ttl_log/{isoTimestamp}` con la lista
 * de lineas expiradas. Solo admin/gerente lee (rules).
 */

const TTL_DAYS = 30;
const ASIG_TTL_LOG_COLLECTION = 'asig_ttl_log';

/**
 * @typedef {Object} TtlDeps
 * @property {any} fbDb
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {() => Date} [now] Inyectable para tests.
 *
 * @typedef {Object} ExpiredLine
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {string} sku
 * @property {number} qty
 * @property {string} asigAt
 * @property {string} clientCardCode
 *
 * @typedef {Object} TtlResult
 * @property {number} pedidosScanned
 * @property {ExpiredLine[]} expiredLines
 * @property {number} pedidosClosed
 * @property {string[]} errors
 */

/**
 * @param {string|number|Date|null} v
 * @returns {number}
 */
function _toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (
    v &&
    typeof v === 'object' &&
    'toMillis' in v &&
    typeof (/** @type {any} */ (v).toMillis) === 'function'
  ) {
    return /** @type {any} */ (v).toMillis();
  }
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (v instanceof Date) return v.getTime();
  return 0;
}

/**
 * Ejecuta un tick del TTL. Idempotente por linea (skip si ya expirada).
 * @param {TtlDeps} deps
 * @returns {Promise<TtlResult>}
 */
export async function expireAsigLinesTTL(deps) {
  const now = (deps.now || (() => new Date()))();
  const cutoffMs = now.getTime() - TTL_DAYS * 24 * 60 * 60 * 1000;
  const log = deps.log || (() => {});

  /** @type {ExpiredLine[]} */
  const expiredLines = [];
  /** @type {string[]} */
  const errors = [];
  let pedidosClosed = 0;

  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {any[]} */
  const docs = [];
  snap.forEach((/** @type {any} */ d) => {
    docs.push(d);
  });

  for (const doc of docs) {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const clientCardCode = String(data.clientCardCode || '').trim();
    /** @type {number[]} */
    const linesToExpire = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l.state !== 'ASIG') continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      const asigMs = _toMs(l.asigAt);
      if (!asigMs) continue; // sin asigAt no podemos calcular edad
      if (asigMs > cutoffMs) continue; // dentro del TTL
      linesToExpire.push(i);
    }
    if (!linesToExpire.length) continue;

    try {
      // Mutacion transaccional (evita race con updateAsigLineStateCF).
      const ref = deps.fbDb.collection('pedidos').doc(doc.id);
      const nowIso = now.toISOString();
      await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        const freshSnap = await tx.get(ref);
        if (!freshSnap.exists) return;
        const freshData = freshSnap.data() || {};
        if (freshData.closedAt) return; // cerrado mientras esperabamos
        const freshLines = Array.isArray(freshData.lines) ? [...freshData.lines] : [];
        let mutated = false;
        for (const idx of linesToExpire) {
          const line = freshLines[idx];
          if (!line || line.state !== 'ASIG') continue; // ya cambio (recycle/cancel)
          const qtyOpen = Number(line.qtyOpen) || 0;
          if (qtyOpen <= 0) continue;
          const asigMs = _toMs(line.asigAt);
          if (asigMs > cutoffMs) continue; // re-check por si asigAt cambio
          freshLines[idx] = Object.assign({}, line, {
            state: 'expired',
            qtyExpired: (Number(line.qtyExpired) || 0) + qtyOpen,
            qtyOpen: 0,
            expiredAt: nowIso,
          });
          mutated = true;
          expiredLines.push({
            pedidoId: doc.id,
            lineIndex: idx,
            sku: String(line.code || ''),
            qty: qtyOpen,
            asigAt: String(line.asigAt || ''),
            clientCardCode,
          });
        }
        if (!mutated) return;
        const anyOpen = freshLines.some((l) => (Number(l && l.qtyOpen) || 0) > 0);
        /** @type {Record<string, any>} */
        const update = { lines: freshLines, updatedAt: nowIso };
        if (!anyOpen && !freshData.closedAt) {
          update.closedAt = nowIso;
          update.closedReason = 'ttl_expired';
          pedidosClosed += 1;
        }
        tx.update(ref, update);
      });
    } catch (e) {
      errors.push(`pedido=${doc.id}: ${String(e)}`);
    }
  }

  // Audit log (siempre, aun si vacio).
  const logId = now.toISOString().replace(/[:.]/g, '-');
  try {
    await deps.fbDb
      .collection(ASIG_TTL_LOG_COLLECTION)
      .doc(logId)
      .set({
        ranAt: now.toISOString(),
        ttlDays: TTL_DAYS,
        cutoffAt: new Date(cutoffMs).toISOString(),
        pedidosScanned: docs.length,
        expiredLines,
        pedidosClosed,
        errors,
      });
  } catch (e) {
    errors.push(`audit_log: ${String(e)}`);
  }

  log('expireAsigLinesTTL done', {
    pedidosScanned: docs.length,
    linesExpired: expiredLines.length,
    pedidosClosed,
    errors: errors.length,
  });

  return {
    pedidosScanned: docs.length,
    expiredLines,
    pedidosClosed,
    errors,
  };
}

export const _test = { _toMs, TTL_DAYS };
