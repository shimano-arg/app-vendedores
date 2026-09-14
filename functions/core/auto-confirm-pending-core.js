// @ts-check
/**
 * v921 (2026-09-14): Auto-confirmar pedidos estancados en stage='pending'.
 *
 * Motivación (Mariano): VDEs suben pedidos a Pendientes pero olvidan tocar
 * "CONFIRMAR DEFINITIVO", quedando estacionados horas/días sin llegar a SAP.
 * Este core scanea pedidos con stage='pending' + confirmedAt < now - N min y
 * los promueve a stage='confirmed'. La CF trigger onPedidoConfirmedSendToSap
 * (v818) detecta la transición y hace el envío real a SAP como Sales Quotation.
 *
 * Guards:
 * - Kill switch: `app_config/auto_confirm.enabled` (default true).
 * - Timeout configurable: `app_config/auto_confirm.minutesTimeout` (default 10).
 * - Skip pedidos sin líneas (edge: doc raro).
 * - Skip pedidos ya con finalizedAt (edge: doble-tick).
 * - No re-envía a SAP: el trigger v818 chequea idempotencia via
 *   transferidoSAP + lock cross-session TTL 300s.
 *
 * Retorna estructura auditable (processed IDs + errors) para logs de la CF.
 */

export const AUTO_CONFIRM_RESULT = Object.freeze({
  SKIP_DISABLED: 'skip_disabled',
  NO_PEDIDOS: 'no_pedidos',
  PROCESSED: 'processed',
});

const DEFAULT_TIMEOUT_MINUTES = 10;

/**
 * @param {object} params
 * @param {any} params.fbDb Firestore admin instance.
 * @param {any} params.FieldValue Firestore FieldValue for serverTimestamp.
 * @param {number} [params.timeoutMinutes] Default when app_config no está seteado.
 * @param {number} [params.batchLimit] Máx de pedidos a procesar por corrida (safety).
 * @param {(msg: string, extra?: any) => void} [params.log]
 * @param {() => number} [params.now] Injectable clock para tests.
 * @returns {Promise<{result: string, processed: number, processedIds: any[], errors: any[]}>}
 */
export async function autoConfirmPendingPedidos({
  fbDb,
  FieldValue,
  timeoutMinutes = DEFAULT_TIMEOUT_MINUTES,
  batchLimit = 100,
  log = () => {},
  now = () => Date.now(),
}) {
  const cfgSnap = await fbDb.doc('app_config/auto_confirm').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() || {} : {};
  const enabled = cfg.enabled !== false; // default true
  if (!enabled) {
    log('autoConfirmPendingPedidos skip: disabled via app_config/auto_confirm.enabled=false');
    return {
      result: AUTO_CONFIRM_RESULT.SKIP_DISABLED,
      processed: 0,
      processedIds: [],
      errors: [],
    };
  }
  const minutes =
    Number.isFinite(Number(cfg.minutesTimeout)) && Number(cfg.minutesTimeout) > 0
      ? Number(cfg.minutesTimeout)
      : timeoutMinutes;

  const nowMs = now();
  const cutoffMs = nowMs - minutes * 60 * 1000;

  // confirmedAt es string ISO en pedidos (ver index.html:26411). Firestore no
  // permite range queries sobre string sin index; ordenamos ASC y limitamos.
  // Los pedidos más viejos quedan al principio y se procesan primero.
  const snap = await fbDb
    .collection('pedidos')
    .where('stage', '==', 'pending')
    .orderBy('confirmedAt', 'asc')
    .limit(batchLimit)
    .get();

  /** @type {Array<{id: string, data: any, ageMinutes: number}>} */
  const eligibles = [];
  snap.forEach((/** @type {any} */ doc) => {
    const d = doc.data() || {};
    const t = d.confirmedAt;
    if (!t) return;
    const ts = new Date(t).getTime();
    if (!Number.isFinite(ts)) return;
    if (ts > cutoffMs) return; // aún no cumplió el timeout
    if (d.finalizedAt) return; // ya finalizado (edge: doble-tick)
    if (!Array.isArray(d.lines) || d.lines.length === 0) return; // doc corrupto
    if (d.transferidoSAP && d.transferidoSAP.docNum) return; // ya en SAP
    eligibles.push({ id: doc.id, data: d, ageMinutes: Math.floor((nowMs - ts) / 60000) });
  });

  if (!eligibles.length) {
    log('autoConfirmPendingPedidos: no pedidos elegibles', { minutes, scanned: snap.size });
    return { result: AUTO_CONFIRM_RESULT.NO_PEDIDOS, processed: 0, processedIds: [], errors: [] };
  }

  const processedIds = [];
  const errors = [];
  for (const p of eligibles) {
    try {
      const finalizedAtIso = new Date(nowMs).toISOString();
      await fbDb
        .collection('pedidos')
        .doc(p.id)
        .update({
          stage: 'confirmed',
          finalizedAt: finalizedAtIso,
          finalizedBy: 'auto/' + minutes + 'min-timeout',
          autoConfirmed: {
            triggeredAt: finalizedAtIso,
            reason: 'pending_timeout',
            minutesInPending: p.ageMinutes,
          },
        });
      // Notificación in-app para el VDE dueño. El listener del frontend la
      // muestra como toast + queda en el bell.
      if (p.data.ownerUid) {
        try {
          await fbDb.collection('notifications').add({
            type: 'auto_confirm_timeout',
            targetUid: p.data.ownerUid,
            pedidoId: p.id,
            clientName: p.data.clientName || '',
            month: p.data.month || '',
            minutesInPending: p.ageMinutes,
            createdAt: FieldValue.serverTimestamp(),
            read: false,
          });
        } catch (nErr) {
          log('autoConfirmPendingPedidos notification error', {
            pedidoId: p.id,
            err: nErr && nErr.message ? nErr.message : String(nErr),
          });
        }
      }
      processedIds.push({
        id: p.id,
        clientName: p.data.clientName,
        ownerUid: p.data.ownerUid,
        ageMinutes: p.ageMinutes,
      });
      log('autoConfirmPendingPedidos processed', {
        pedidoId: p.id,
        clientName: p.data.clientName,
        ageMinutes: p.ageMinutes,
      });
    } catch (e) {
      errors.push({ id: p.id, err: e && e.message ? e.message : String(e) });
      log('autoConfirmPendingPedidos error', {
        pedidoId: p.id,
        err: e && e.message ? e.message : String(e),
      });
    }
  }

  return {
    result: AUTO_CONFIRM_RESULT.PROCESSED,
    processed: processedIds.length,
    processedIds,
    errors,
  };
}
