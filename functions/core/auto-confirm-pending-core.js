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
 * Stock re-validation (fix post-v921):
 * - Antes de promover pending->confirmed, re-lee app_config/stock_snapshot y
 *   verifica que las lineas state='confirmed' sigan teniendo stock whs 11
 *   disponible. En los 10 min entre pending y el tick, otro VDE pudo haber
 *   consumido el stock -> enviar un SQ a SAP por unidades que no existen
 *   fisicamente generaba BO/discrepancias downstream. Si alguna linea
 *   evaporo stock, SKIP el auto-confirm (queda en pending para intervencion
 *   manual) y se logea con reason='skipped_stock_evaporated'.
 * - El update del stage corre en runTransaction con re-read del doc y
 *   verificacion stage==='pending' para idempotencia frente a dos ticks
 *   concurrentes (CF scheduler every 2 min + retryCount 0 pero race posible
 *   si una invocacion previa corre lento).
 *
 * Retorna estructura auditable (processed IDs + errors) para logs de la CF.
 */

import { lineReservesStock } from './pedido-snapshot-core.js';

export const AUTO_CONFIRM_RESULT = Object.freeze({
  SKIP_DISABLED: 'skip_disabled',
  NO_PEDIDOS: 'no_pedidos',
  PROCESSED: 'processed',
});

/** Warehouse code para stock vendible pesca (mismo que sap-stock-recheck-core.js). */
const SALES_WAREHOUSE = '11';

/**
 * Parsea warehouseBreakdown desde el snapshot. El sync lo guarda como JSON
 * string para evitar el limite de 40k index entries de Firestore.
 * @param {any} snap
 * @returns {Record<string, Record<string, number>>}
 */
function _parseWarehouseBreakdown(snap) {
  const raw = snap && snap.warehouseBreakdown;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

/**
 * Para un SKU dado, calcula el stock whs 11 DISPONIBLE neto de reservas
 * de OTROS pedidos abiertos (confirmed/ASIG/BO) distintos del pedido que
 * estamos evaluando. Retorna la cantidad disponible (>= 0).
 *
 * El snapshot `warehouseBreakdown[sku]['11']` ya es NETO (InStock - Committed
 * desde SAP), pero NO cuenta reservas de pedidos-app que todavia no viajaron
 * a SAP. Por eso descontamos aqui las reservas vigentes de otros pedidos
 * usando lineReservesStock (misma logica que la UI).
 *
 * @param {string} sku
 * @param {Record<string, Record<string, number>>} warehouseBreakdown
 * @param {any[]} openPedidos pedidos con closedAt==null
 * @param {string} selfPedidoId pedido que estamos evaluando (se excluye)
 * @param {number} nowMs
 * @returns {number}
 */
function _computeAvailableWhs11(sku, warehouseBreakdown, openPedidos, selfPedidoId, nowMs) {
  const skuUp = String(sku).toUpperCase();
  const whsBreakdown = warehouseBreakdown[skuUp] || warehouseBreakdown[sku] || {};
  const physical = Number(whsBreakdown[SALES_WAREHOUSE]) || 0;
  let reservedByOthers = 0;
  for (const p of openPedidos) {
    if (!p || p.id === selfPedidoId) continue;
    if (p.data && p.data.closedAt) continue;
    const lines = (p.data && Array.isArray(p.data.lines)) ? p.data.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      if (!lineReservesStock(l, nowMs, p.data)) continue;
      const q = Number(l.qtyOpen || 0);
      if (q > 0) reservedByOthers += q;
    }
  }
  return Math.max(physical - reservedByOthers, 0);
}

/**
 * Carga todos los pedidos abiertos (closedAt==null) una sola vez por run,
 * para computar reservas por SKU sin N queries. En practica ~56 pedidos
 * abiertos tipicamente.
 * @param {any} fbDb
 * @returns {Promise<Array<{id: string, data: any}>>}
 */
async function _loadOpenPedidos(fbDb) {
  const snap = await fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id: string, data: any}>} */
  const out = [];
  snap.forEach((/** @type {any} */ doc) => {
    out.push({ id: doc.id, data: doc.data() || {} });
  });
  return out;
}

const DEFAULT_TIMEOUT_MINUTES = 10;

/**
 * @param {object} params
 * @param {any} params.fbDb Firestore admin instance.
 * @param {any} params.FieldValue Firestore FieldValue for serverTimestamp.
 * @param {number} [params.timeoutMinutes] Default when app_config no está seteado.
 * @param {number} [params.batchLimit] Máx de pedidos a procesar por corrida (safety).
 * @param {(msg: string, extra?: any) => void} [params.log]
 * @param {() => number} [params.now] Injectable clock para tests.
 * @returns {Promise<{result: string, processed: number, processedIds: any[], skippedForStock?: any[], errors: any[]}>}
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

  // Pre-cargar stock_snapshot + pedidos abiertos UNA sola vez para computar
  // disponibilidad al re-validar las lineas confirmed. FAIL-OPEN: si no hay
  // snapshot (anomalia que no deberia bloquear la promocion) o la carga
  // falla, saltamos la re-validacion de stock (stockCheckEnabled=false) y
  // solo aplicamos el guard transaccional (que resuelve el bug principal
  // de dos ticks concurrentes).
  /** @type {Record<string, Record<string, number>> | null} */
  let warehouseBreakdown = null;
  /** @type {Array<any>} */
  let openPedidos = [];
  let stockCheckEnabled = false;
  try {
    const stockSnap = await fbDb.doc('app_config/stock_snapshot').get();
    if (stockSnap.exists) {
      warehouseBreakdown = _parseWarehouseBreakdown(stockSnap.data() || {});
      openPedidos = await _loadOpenPedidos(fbDb);
      stockCheckEnabled = true;
    } else {
      log('autoConfirmPendingPedidos: stock_snapshot no existe (fail-open, skip stock recheck)');
    }
  } catch (e) {
    log('autoConfirmPendingPedidos: no se pudo cargar stock/pedidos para re-validacion', {
      err: e && e.message ? e.message : String(e),
    });
    // Fail-open: seguimos sin re-validacion.
  }

  const processedIds = [];
  const skippedForStock = [];
  const errors = [];
  for (const p of eligibles) {
    try {
      // Re-validar stock de las lineas 'confirmed'. Si en los N min desde
      // que el VDE confirmo, otro VDE consumio el stock, saltar este pedido
      // (queda en pending para intervencion manual).
      if (stockCheckEnabled) {
        const confirmedLines = (p.data.lines || []).filter(
          (/** @type {any} */ l) => l && l.state === 'confirmed'
        );
        /** @type {Array<{sku: string, wanted: number, available: number}>} */
        const stockShortfalls = [];
        for (const l of confirmedLines) {
          const wanted = Number(l.qtyOpen || l.qty || 0);
          if (wanted <= 0) continue;
          const sku = String(l.code || '').toUpperCase();
          if (!sku) continue;
          const available = _computeAvailableWhs11(
            sku,
            warehouseBreakdown || {},
            openPedidos,
            p.id,
            nowMs
          );
          if (wanted > available) {
            stockShortfalls.push({ sku, wanted, available });
          }
        }
        if (stockShortfalls.length > 0) {
          log('autoConfirmPendingPedidos skipped_stock_evaporated', {
            pedidoId: p.id,
            clientName: p.data.clientName,
            shortfalls: stockShortfalls,
          });
          skippedForStock.push({
            id: p.id,
            clientName: p.data.clientName,
            shortfalls: stockShortfalls,
          });
          continue;
        }
      }

      // Transaccion: re-lee el pedido y verifica que stage siga en 'pending'
      // antes de promover. Garantiza idempotencia frente a dos ticks de la
      // CF concurrentes que ambos entren con el mismo pedido elegible.
      const pedidoRef = fbDb.collection('pedidos').doc(p.id);
      const finalizedAtIso = new Date(nowMs).toISOString();
      const didUpdate = await fbDb.runTransaction(async (/** @type {any} */ tx) => {
        const freshSnap = await tx.get(pedidoRef);
        if (!freshSnap.exists) return false;
        const freshData = freshSnap.data() || {};
        if (freshData.stage !== 'pending') return false; // otro tick ya la promovio
        if (freshData.finalizedAt) return false; // defensa doble-tick
        if (freshData.transferidoSAP && freshData.transferidoSAP.docNum) return false;
        tx.update(pedidoRef, {
          stage: 'confirmed',
          finalizedAt: finalizedAtIso,
          finalizedBy: 'auto/' + minutes + 'min-timeout',
          autoConfirmed: {
            triggeredAt: finalizedAtIso,
            reason: 'pending_timeout',
            minutesInPending: p.ageMinutes,
          },
        });
        return true;
      });
      if (!didUpdate) {
        log('autoConfirmPendingPedidos skipped_stage_changed', { pedidoId: p.id });
        continue;
      }
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
    skippedForStock,
    errors,
  };
}
