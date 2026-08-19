// @ts-check
/**
 * E4B step 2: recycle / reject de linea ASIG desde modal cliente.
 *
 * FLUJO (post-cutover E5, mode='active'):
 *   1. Cliente#A tuvo un pedido#1 con linea BO
 *   2. Entra stock, E4.5 promueve BO->ASIG (linea state='ASIG', qtyOpen intacto)
 *   3. Cliente#A vuelve; admin/gerente ve la linea ASIG en el piloto E4B
 *   4a. RECYCLE: cliente lo quiere -> mark linea 'recycled' + admin agrega SKU
 *       a la waitlist actual (nuevo pedido). Al cerrarse esa waitlist, va a
 *       SAP como SQ nueva.
 *   4b. REJECT: cliente NO lo quiere -> mark linea 'cancelled'. El stock
 *       "vuelve" al pool logicamente (nadie lo reserva); proximo tick E4.5
 *       podria promover otra BO al mismo SKU.
 *
 * ATOMICIDAD: la mutacion del pedido#1 es transaccional (runTransaction).
 * Auth: caller debe estar autenticado como @shimano.com.ar o @shimano.uy.
 *
 * IDEMPOTENCIA: el CF valida state='ASIG' antes de mutar. Un rerun con la
 * linea ya en 'recycled'/'cancelled' tira error validation — no doble-conteo.
 */

/**
 * @typedef {Object} RecycleDeps
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 *
 * @typedef {Object} RecycleAuth
 * @property {string} uid
 * @property {string} email
 *
 * @typedef {Object} UpdateAsigInput
 * @property {string} sourcePedidoId
 * @property {number} sourceLineIndex
 * @property {number} qty Cuanto reciclar / cancelar (<= line.qtyOpen).
 * @property {'recycled'|'cancelled'} action
 * @property {string} [targetPedidoId] Solo para 'recycled': id del pedido nuevo (informativo, se guarda en source.lines[i].recycledIntoPedidoId).
 *
 * @typedef {Object} UpdateAsigResult
 * @property {boolean} success
 * @property {'recycled'|'cancelled'} action
 * @property {string} sourcePedidoId
 * @property {number} qtyApplied
 * @property {boolean} pedidoClosed True si esta accion cerro el pedido source.
 */

const SHIMANO_DOMAINS = ['shimano.com.ar', 'shimano.uy'];

/**
 * @param {string} email
 * @returns {boolean}
 */
function _isShimanoEmail(email) {
  if (!email) return false;
  const lc = email.toLowerCase();
  return SHIMANO_DOMAINS.some((d) => lc.endsWith('@' + d));
}

/**
 * Ejecuta la mutacion transaccional de la linea ASIG.
 * @param {RecycleDeps} deps
 * @param {RecycleAuth|null} auth
 * @param {UpdateAsigInput} input
 * @returns {Promise<UpdateAsigResult>}
 */
export async function updateAsigLineState(deps, auth, input) {
  // 1) Auth
  if (!auth || !auth.email) {
    throw { code: 'unauthenticated', message: 'requiere login' };
  }
  if (!_isShimanoEmail(auth.email)) {
    throw { code: 'permission-denied', message: 'solo @shimano puede reciclar/rechazar ASIG' };
  }

  // 2) Input validation
  const { sourcePedidoId, sourceLineIndex, qty, action, targetPedidoId } =
    input || /** @type {any} */ ({});
  if (!sourcePedidoId || typeof sourcePedidoId !== 'string') {
    throw { code: 'invalid-argument', message: 'sourcePedidoId invalido' };
  }
  if (typeof sourceLineIndex !== 'number' || sourceLineIndex < 0) {
    throw { code: 'invalid-argument', message: 'sourceLineIndex invalido' };
  }
  const qtyNum = Number(qty);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    throw { code: 'invalid-argument', message: 'qty debe ser > 0' };
  }
  if (action !== 'recycled' && action !== 'cancelled') {
    throw { code: 'invalid-argument', message: 'action debe ser recycled|cancelled' };
  }
  if (action === 'recycled' && targetPedidoId && typeof targetPedidoId !== 'string') {
    throw { code: 'invalid-argument', message: 'targetPedidoId debe ser string si se pasa' };
  }

  // 3) Transaccion atomica sobre el pedido source
  const pedidoRef = deps.fbDb.collection('pedidos').doc(sourcePedidoId);
  const nowIso = new Date().toISOString();

  /** @type {UpdateAsigResult} */
  const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    const snap = await tx.get(pedidoRef);
    if (!snap.exists) {
      throw { code: 'not-found', message: `pedido ${sourcePedidoId} no existe` };
    }
    const data = snap.data() || {};
    if (data.closedAt) {
      throw { code: 'failed-precondition', message: 'pedido ya cerrado' };
    }
    const lines = Array.isArray(data.lines) ? [...data.lines] : [];
    const line = lines[sourceLineIndex];
    if (!line) {
      throw { code: 'not-found', message: `linea ${sourceLineIndex} no existe` };
    }
    if (line.state !== 'ASIG') {
      throw {
        code: 'failed-precondition',
        message: `linea state='${line.state}' (esperado 'ASIG')`,
      };
    }
    const currentOpen = Number(line.qtyOpen) || 0;
    if (qtyNum > currentOpen) {
      throw {
        code: 'failed-precondition',
        message: `qty=${qtyNum} > qtyOpen=${currentOpen}`,
      };
    }

    // Mutar la linea
    const newOpen = currentOpen - qtyNum;
    /** @type {Record<string, any>} */
    const patch = { qtyOpen: newOpen };
    if (action === 'recycled') {
      patch.qtyRecycled = (Number(line.qtyRecycled) || 0) + qtyNum;
      if (targetPedidoId) patch.recycledIntoPedidoId = targetPedidoId;
    } else {
      patch.qtyCancelled = (Number(line.qtyCancelled) || 0) + qtyNum;
    }
    // Si qtyOpen llega a 0, marcar state final. Si queda parcial, dejamos
    // state='ASIG' (permite reciclar/cancelar el resto en otra corrida).
    if (newOpen <= 0) {
      patch.state = action;
    }
    lines[sourceLineIndex] = Object.assign({}, line, patch);

    // Chequear si el pedido queda 100% cerrado (todas las lineas con qtyOpen<=0
    // y state final). Solo entonces marcamos closedAt.
    const anyOpen = lines.some((l) => (Number(l && l.qtyOpen) || 0) > 0);
    /** @type {Record<string, any>} */
    const update = {
      lines,
      updatedAt: nowIso,
    };
    let closed = false;
    if (!anyOpen && !data.closedAt) {
      update.closedAt = nowIso;
      update.closedReason = 'all_recycled_or_cancelled_or_invoiced';
      closed = true;
    }
    tx.update(pedidoRef, update);
    return {
      success: true,
      action,
      sourcePedidoId,
      qtyApplied: qtyNum,
      pedidoClosed: closed,
    };
  });

  const log = deps.log || (() => {});
  log('updateAsigLineState OK', {
    ...result,
    by: auth.email,
    lineIndex: sourceLineIndex,
  });
  return result;
}

export const _test = { _isShimanoEmail };
