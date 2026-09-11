// @ts-check
/**
 * v818 (2026-09-07): auto-envio de pedidos confirmed a SAP como Sales Quotation
 * desde Cloud Function (Firestore trigger onDocumentWritten). Portado de
 * `src/domains/sap-auto-send-listener.js` (que corria client-side y solo en
 * sesion admin/gerente + SL enabled + toggle autoSendSL ON).
 *
 * Problema anterior:
 * - VDE confirmaba un pedido -> stage='confirmed' pero sin transferidoSAP.
 * - El auto-send client-side solo se disparaba cuando admin/gerente abria la
 *   app con SL activo. Si nadie abria la app, pedidos quedaban invisibles a
 *   SAP hasta que se descubriera al dia siguiente.
 *
 * Fix v818:
 * - Firestore trigger onDocumentWritten('pedidos/{id}') detecta la transicion
 *   a stage='confirmed' sin transferidoSAP y ejecuta el envio server-side.
 * - Reutiliza sap-sl-client.js (login/post/logout) + Secret Manager para creds.
 * - Idempotencia dual: (a) skip si ya tiene transferidoSAP; (b) cross-session
 *   lock via transaccion Firestore con TTL 300s (mismo TTL que el listener
 *   client-side v767+).
 * - Fallback: el auto-send client-side sigue vivo. Si el CF falla, admin al
 *   abrir la app puede disparar el retry manual. Ambos checkean transferidoSAP
 *   con transaction, no doblan envio.
 *
 * NO exporta funciones al CF wrapper — el wrapper hace toda la orquestacion
 * (loading configs, wiring deps, invocando handleAutoSendSap).
 */

import { sapLogin, sapLogout, sapPost } from './sap-sl-client.js';

/**
 * @typedef {Object} SlDeps
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {(msg: string, extra?: Record<string, unknown>) => void} log
 */

/**
 * @typedef {Object} PedidoLike
 * @property {string} clientName
 * @property {string} [clientCardCode]
 * @property {string} [ownerEmail]
 * @property {string} [ownerVendor]
 * @property {string} [condicionPago]
 * @property {any} [formaEntrega]
 * @property {Array<any>} lines
 * @property {any} [transferidoSAP]
 * @property {any} [sendingSapLock]
 * @property {string} stage
 * @property {string} [month]
 */

/**
 * @typedef {Object} CoreDeps
 * @property {SlDeps} sl                       Deps para el cliente SL.
 * @property {any} fbDb                        Firestore Admin SDK db instance.
 * @property {any} FieldValue                  firestore.FieldValue (serverTimestamp, delete).
 * @property {() => number} [now]              Timestamp actual en ms (default: Date.now).
 * @property {() => string} [genSessionId]     Session id unico (default: crypto.randomUUID).
 * @property {Map<string, string>} [sapClients]  clientName_normalized -> CardCode
 * @property {Map<string, string>} [sapProducts] appCode -> sapItemCode (mapeo manual)
 * @property {Map<string, number>} [sapVendors]  vendorKey -> slpCode
 * @property {number} [lockTtlMs]              default 300000 (5 min)
 * @property {number} [dueDateDays]            default 30
 */

/**
 * Estados del handler.
 */
export const AUTO_SEND_RESULT = /** @type {const} */ ({
  SKIP_STAGE: 'skip_stage', // stage no es 'confirmed' (o no cambio a confirmed)
  SKIP_ALREADY_SENT: 'skip_already_sent', // transferidoSAP ya existe
  SKIP_ALL_BO: 'skip_all_bo', // 100% backorder (via='app_only' via v607)
  SKIP_NO_CARDCODE: 'skip_no_cardcode', // cliente sin sapCardCode -> queda bloqueado
  SKIP_LOCKED: 'skip_locked', // otra sesion tiene lock activo
  SKIP_NO_LINES: 'skip_no_lines', // pedido sin lineas confirmed
  SENT_OK: 'sent_ok', // envio exitoso a SAP
  ERROR_SL: 'error_sl', // SL devolvio error (no reintentable auto)
  ERROR_RACE: 'error_race', // otra sesion completo despues del lock
});

/**
 * Normaliza un string (upper, trim, sin diacriticos, sin espacios extra).
 * Usado para lookup fuzzy en sapClients cache.
 * @param {string} s
 */
function norm(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resuelve CardCode del cliente. Primero busca en pedido.clientCardCode
 * (ya persistido al confirmar). Fallback: lookup en sapClients cache.
 *
 * @param {PedidoLike} pedido
 * @param {CoreDeps} deps
 * @returns {string}
 */
export function resolveCardCode(pedido, deps) {
  const persisted = String(pedido.clientCardCode || '').trim();
  if (persisted) return persisted;
  const map = deps.sapClients;
  if (!map) return '';
  const key = norm(pedido.clientName);
  return map.get(key) || '';
}

/**
 * Resuelve ItemCode SAP para una linea del pedido. Prioridad:
 * 1. sapProducts mapping manual (window.sapProductsMap client-side).
 * 2. Auto: si es codigo numerico con ceros a la izquierda, parseInt.
 * 3. Fallback: mismo codigo del app.
 *
 * @param {string} appCode
 * @param {CoreDeps} deps
 * @returns {string}
 */
export function resolveItemCode(appCode, deps) {
  const code = String(appCode || '').trim();
  if (!code) return '';
  const map = deps.sapProducts;
  if (map) {
    const mapped = map.get(code);
    if (mapped) return mapped;
  }
  // Auto: '032737' -> '32737' (SAP normaliza numerics sin leading zeros).
  if (/^0\d+$/.test(code)) {
    const parsed = parseInt(code, 10);
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  }
  return code;
}

/**
 * Resuelve SLP code del vendedor. Lookup case-insensitive en sapVendors.
 * @param {string} vendorKey
 * @param {CoreDeps} deps
 * @returns {number}
 */
export function resolveSlpCode(vendorKey, deps) {
  const map = deps.sapVendors;
  if (!map) return -1;
  const key = norm(vendorKey);
  const code = map.get(key);
  return typeof code === 'number' && Number.isFinite(code) ? code : -1;
}

/**
 * Construye el payload del Sales Quotation. Verbatim del pattern client-side
 * (src/domains/sap-service-layer.js:319-436) adaptado a fn pura.
 *
 * @param {PedidoLike} pedido
 * @param {string} pedidoId Firestore doc id (para NumAtCard + U_AppOrderId).
 * @param {CoreDeps} deps
 * @returns {{ok: false, reason: string} | {ok: true, payload: any, linesCount: number}}
 */
export function buildQuotationPayload(pedido, pedidoId, deps) {
  const cardCode = resolveCardCode(pedido, deps);
  if (!cardCode) {
    return { ok: false, reason: 'no_cardcode' };
  }

  // Filtro lineas: solo confirmed (state='confirmed') + qty>0. BO/ASIG lines
  // NO van a SAP (esperan stock o son reservas). Si el pedido es 100% BO
  // (via='app_only'), _shouldSendToSap ya filtro antes de llamar buildPayload.
  const linesRaw = Array.isArray(pedido.lines) ? pedido.lines : [];
  const confirmedLines = linesRaw.filter(
    (l) => l && l.state === 'confirmed' && (Number(l.qty) || 0) > 0
  );
  if (!confirmedLines.length) {
    return { ok: false, reason: 'no_lines' };
  }

  // Dedup por ItemCode sumando qtys (SAP error 23105 si vienen 2 lines mismo item).
  /** @type {Map<string, {ItemCode: string, Quantity: number, WarehouseCode: string, UoMEntry: number, LineNum: number}>} */
  const dedupMap = new Map();
  let lineNum = 0;
  for (const l of confirmedLines) {
    const itemCode = resolveItemCode(String(l.code || ''), deps);
    if (!itemCode) continue;
    const qty = Number(l.qty) || 0;
    if (qty <= 0) continue;
    const existing = dedupMap.get(itemCode);
    if (existing) {
      existing.Quantity += qty;
    } else {
      dedupMap.set(itemCode, {
        ItemCode: itemCode,
        Quantity: qty,
        WarehouseCode: '11',
        // v867 (2026-09-11): fix "1470000315 - specify a UoM code". SAP
        // dejo de asumir default UoM del item. Todos los items Shimano AR
        // usan Manual Management con IUoMEntry=1 (Unidad).
        UoMEntry: 1,
        LineNum: lineNum++,
      });
    }
  }
  const documentLines = Array.from(dedupMap.values());
  if (!documentLines.length) {
    return { ok: false, reason: 'no_lines' };
  }

  const now = deps.now ? deps.now() : Date.now();
  /** @param {number} ms */
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const dueDateDays = deps.dueDateDays ?? 30;
  const docDate = isoDate(now);
  const docDueDate = isoDate(now + dueDateDays * 24 * 3600 * 1000);
  const slpCode = resolveSlpCode(pedido.ownerVendor || '', deps);
  const batchId = 'CF-AUTO-' + now;
  const entregaSuffix = _buildEntregaSuffix(pedido.formaEntrega);
  const comments = [
    'AppShimano',
    pedido.clientName || '',
    pedido.month || '',
    pedido.ownerEmail || '',
    pedido.condicionPago || 'CONDICION',
    entregaSuffix,
  ]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 254); // SAP Comments field max 254 chars.

  const payload = {
    CardCode: cardCode,
    DocDate: docDate,
    DocDueDate: docDueDate,
    TaxDate: docDate,
    SalesPersonCode: slpCode,
    Comments: comments,
    NumAtCard: pedidoId,
    DiscountPercent: 0,
    U_AppOrigen: 'SHIMANO_APP_VENDEDORES',
    U_AppOrderId: pedidoId,
    U_AppBatchId: batchId,
    U_TipoGasto: pedido.condicionPago || 'CONDICION',
    DocumentLines: documentLines,
  };
  return { ok: true, payload, linesCount: documentLines.length };
}

/**
 * Construye el suffix de entrega para Comments (v269+ client-side pattern).
 * @param {any} formaEntrega
 * @returns {string}
 */
function _buildEntregaSuffix(formaEntrega) {
  if (!formaEntrega || !formaEntrega.tipo) return '';
  const t = formaEntrega.tipo;
  if (t === 'TRANSPORTISTA') {
    const parts = [
      formaEntrega.transpNombre && 'Transp: ' + formaEntrega.transpNombre,
      formaEntrega.transpDireccion && 'Dir: ' + formaEntrega.transpDireccion,
      formaEntrega.clienteDireccion && 'Entrega: ' + formaEntrega.clienteDireccion,
    ].filter(Boolean);
    return parts.join(' - ');
  }
  if (t === 'SUCURSAL') {
    return formaEntrega.sucursalDireccion
      ? 'Sucursal: ' + formaEntrega.sucursalDireccion
      : 'SUCURSAL';
  }
  if (t === 'RETIRO_DEPOSITO') {
    const parts = [
      formaEntrega.retiroNombre &&
        'Retira: ' + formaEntrega.retiroNombre + ' ' + (formaEntrega.retiroApellido || ''),
      formaEntrega.retiroDni && 'DNI: ' + formaEntrega.retiroDni,
      formaEntrega.retiroPatente && 'Patente: ' + formaEntrega.retiroPatente,
    ].filter(Boolean);
    return parts.join(' - ');
  }
  return '';
}

/**
 * Chequea si un pedido cumple los criterios para auto-envio.
 * Guard change-detection: solo si transicionó a stage='confirmed'.
 *
 * @param {any} beforeData
 * @param {any} afterData
 * @returns {{eligible: boolean, reason?: string}}
 */
export function isEligibleForAutoSend(beforeData, afterData) {
  if (!afterData) return { eligible: false, reason: 'no_after' };
  if (afterData.stage !== 'confirmed') return { eligible: false, reason: 'not_confirmed' };
  if (afterData.transferidoSAP) return { eligible: false, reason: 'already_sent' };
  // Guard 100% BO: pedido con todas las lineas state='BO' NO va a SAP (el
  // client-side v607 lo marca via='app_only'). Si llegamos aca sin transferidoSAP
  // y todas las lines son BO, es porque el auto-confirm client-side no corrio
  // (raro pero posible). Marcarlo con via='app_only' server-side para evitar
  // que quede pending forever.
  /** @type {any[]} */
  const lines = Array.isArray(afterData.lines) ? afterData.lines : [];
  if (lines.length === 0) return { eligible: false, reason: 'no_lines' };
  const allBo = lines.every((/** @type {any} */ l) => l && l.state === 'BO');
  if (allBo) return { eligible: false, reason: 'all_bo' };
  // Cambio real de stage: si before ya era 'confirmed', esto es un update
  // secundario (ej: qty edit). Solo procesamos la TRANSICION a confirmed.
  // Excepcion: si before es null (doc created directo como confirmed), procesar.
  const beforeStage = beforeData ? beforeData.stage : null;
  if (beforeStage === 'confirmed') return { eligible: false, reason: 'no_transition' };
  return { eligible: true };
}

/**
 * Handler principal. Se invoca desde el CF trigger.
 *
 * Flujo:
 * 1. Chequea eligibilidad (guard change-detection).
 * 2. Adquiere lock via transaccion (previene doble-envio cross-session).
 * 3. Construye payload SQ desde pedido.
 * 4. sapLogin -> sapPost /Quotations -> sapLogout.
 * 5. Escribe transferidoSAP.docNum en el pedido (via transaccion, doble-check
 *    de race — otra sesion pudo haber ganado).
 *
 * @param {string} pedidoId
 * @param {any} beforeData snapshot antes del write
 * @param {any} afterData snapshot despues del write
 * @param {CoreDeps} deps
 * @returns {Promise<{result: string, docNum?: number, docEntry?: number, error?: string, reason?: string}>}
 */
export async function handleAutoSendSap(pedidoId, beforeData, afterData, deps) {
  const log = deps.sl.log || (() => {});

  const elig = isEligibleForAutoSend(beforeData, afterData);
  if (!elig.eligible) {
    log('[auto-send] skip', { pedidoId, reason: elig.reason });
    if (elig.reason === 'already_sent') return { result: AUTO_SEND_RESULT.SKIP_ALREADY_SENT };
    if (elig.reason === 'all_bo') return { result: AUTO_SEND_RESULT.SKIP_ALL_BO };
    if (elig.reason === 'no_lines') return { result: AUTO_SEND_RESULT.SKIP_NO_LINES };
    return { result: AUTO_SEND_RESULT.SKIP_STAGE, reason: elig.reason };
  }

  // Pre-check CardCode antes de tomar lock.
  const cardCode = resolveCardCode(afterData, deps);
  if (!cardCode) {
    log('[auto-send] skip', { pedidoId, reason: 'no_cardcode', clientName: afterData.clientName });
    return { result: AUTO_SEND_RESULT.SKIP_NO_CARDCODE };
  }

  // === LOCK (transaccional) ===
  const docRef = deps.fbDb.collection('pedidos').doc(pedidoId);
  const now = deps.now ? deps.now() : Date.now();
  const sessionId = deps.genSessionId ? deps.genSessionId() : 'cf-' + now;
  const lockTtlMs = deps.lockTtlMs ?? 300000;
  try {
    await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) throw new Error('DOC_GONE');
      const data = snap.data() || {};
      if (data.transferidoSAP) throw new Error('ALREADY_SENT');
      const existingLock = data.sendingSapLock;
      if (existingLock && existingLock.at && now - existingLock.at < lockTtlMs) {
        throw new Error('OTHER_SESSION_LOCK');
      }
      tx.update(docRef, {
        sendingSapLock: { sessionId, at: now, by: 'cf-auto' },
      });
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (msg === 'ALREADY_SENT') return { result: AUTO_SEND_RESULT.SKIP_ALREADY_SENT };
    if (msg === 'OTHER_SESSION_LOCK') return { result: AUTO_SEND_RESULT.SKIP_LOCKED };
    if (msg === 'DOC_GONE') return { result: AUTO_SEND_RESULT.ERROR_SL, error: 'doc_gone' };
    log('[auto-send] lock exception', { pedidoId, err: msg });
    return { result: AUTO_SEND_RESULT.ERROR_SL, error: 'lock_exception:' + msg };
  }

  // === BUILD PAYLOAD ===
  const built = buildQuotationPayload(afterData, pedidoId, deps);
  if (!built.ok) {
    log('[auto-send] build failed', { pedidoId, reason: built.reason });
    // Liberar lock para reintento manual.
    try {
      await docRef.update({ sendingSapLock: deps.FieldValue.delete() });
    } catch {
      /* swallow */
    }
    if (built.reason === 'no_cardcode') return { result: AUTO_SEND_RESULT.SKIP_NO_CARDCODE };
    if (built.reason === 'no_lines') return { result: AUTO_SEND_RESULT.SKIP_NO_LINES };
    return { result: AUTO_SEND_RESULT.ERROR_SL, error: 'build:' + built.reason };
  }

  // === SL LOGIN + POST + LOGOUT ===
  let session = null;
  try {
    session = await sapLogin(deps.sl);
    const resp = await sapPost(session, '/b1s/v1/Quotations', built.payload, deps.sl);
    if (resp.status !== 201) {
      const errMsg =
        (resp.body &&
          resp.body.error &&
          resp.body.error.message &&
          resp.body.error.message.value) ||
        `SL http ${resp.status}`;
      log('[auto-send] SL error', { pedidoId, status: resp.status, errMsg });
      // Liberar lock (no retry auto).
      try {
        await docRef.update({ sendingSapLock: deps.FieldValue.delete() });
      } catch {
        /* swallow */
      }
      return { result: AUTO_SEND_RESULT.ERROR_SL, error: errMsg };
    }
    const docNum = Number(resp.body && resp.body.DocNum);
    const docEntry = Number(resp.body && resp.body.DocEntry);
    if (!docNum || !docEntry) {
      log('[auto-send] SL respondio 201 sin DocNum/DocEntry', { pedidoId, body: resp.body });
      try {
        await docRef.update({ sendingSapLock: deps.FieldValue.delete() });
      } catch {
        /* swallow */
      }
      return { result: AUTO_SEND_RESULT.ERROR_SL, error: 'sl_no_docnum' };
    }

    // === WRITE transferidoSAP (transaccional, doble-check race) ===
    let winner = { docNum, docEntry, byUs: false };
    await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (data.transferidoSAP && data.transferidoSAP.docNum) {
        winner = {
          docNum: data.transferidoSAP.docNum,
          docEntry: data.transferidoSAP.docEntry,
          byUs: false,
        };
        return;
      }
      tx.update(docRef, {
        transferidoSAP: {
          via: 'cf_auto',
          docEntry,
          docNum,
          transferredAt: new Date(now).toISOString(),
          transferredBy: 'cf-auto/' + sessionId,
          sapDocRange: String(docNum),
          batchId: 'CF-AUTO-' + now,
        },
        sendingSapLock: deps.FieldValue.delete(),
      });
      winner = { docNum, docEntry, byUs: true };
    });

    if (!winner.byUs) {
      log('[auto-send] race lost', { pedidoId, ourDocNum: docNum, winnerDocNum: winner.docNum });
      return {
        result: AUTO_SEND_RESULT.ERROR_RACE,
        docNum: winner.docNum,
        docEntry: winner.docEntry,
      };
    }

    log('[auto-send] OK', { pedidoId, docNum, docEntry, linesCount: built.linesCount });
    return { result: AUTO_SEND_RESULT.SENT_OK, docNum, docEntry };
  } catch (e) {
    const msg = String((e && e.message) || e);
    log('[auto-send] exception', { pedidoId, err: msg });
    try {
      await docRef.update({ sendingSapLock: deps.FieldValue.delete() });
    } catch {
      /* swallow */
    }
    return { result: AUTO_SEND_RESULT.ERROR_SL, error: 'exception:' + msg };
  } finally {
    if (session) {
      try {
        await sapLogout(session, deps.sl);
      } catch {
        /* swallow */
      }
    }
  }
}
