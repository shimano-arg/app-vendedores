// @ts-check
/**
 * BATCH B.2b SEC-H2 (2026-11-19): CF server-side confiable para pasar un
 * pedido de stage='pending' a stage='confirmed'. Reemplaza el call-site
 * cliente directo `src/domains/pedidos-modal.js:1042` que escribía
 * `pedidos.update({stage:'confirmed'})` sin pasar por commitPedidoCF.
 *
 * Objetivo: cerrar el vector SEC-H2 HIGH-P0 mediante un marker
 * `_commitVersion='confirmDefinitivo_v1'` que solo este core server-side
 * puede escribir (las rules A2.1/A1.1 prohíben que un VDE lo setee
 * directo).
 *
 * Reglas de acceso:
 *   - Admin / Gerente: pueden confirmar cualquier pedido.
 *   - Interno: puede confirmar cualquier pedido (patrón §63 blanket).
 *   - Vendedor: solo pedidos donde ownerUid == auth.uid O
 *     assignedVendorUid == auth.uid (patrón §44/§46/§59/§63).
 *
 * Validaciones:
 *   - Pedido existe + no borrado.
 *   - `stage` actual es `pending` (o `waitlist` si fuera futuro — hoy el
 *     flow pendiente→confirmado es el único que pasaba por el call-site
 *     cliente). Re-confirmar un pedido `confirmed` → idempotent OK (no
 *     escritura nueva, mismo _commitVersion).
 *   - No tiene `transferidoSAP.docNum` (ya enviado a SAP → no se puede
 *     re-confirmar sin pasar por `revertPedidoToPendingCF` primero).
 *
 * Idempotencia:
 *   - Si el pedido ya está `stage='confirmed'` + `_commitVersion` propio,
 *     devuelve ok:true sin re-escribir (idempotent hit).
 *   - §58: ALL reads before writes dentro del runTransaction.
 *
 * Audit trail:
 *   - `finalizedBy` lleva el email del user (observabilidad).
 *   - `_commitVersion='confirmDefinitivo_v1'` para que el trigger
 *     `onPedidoConfirmedSendToSap` (post-B.3) valide origen legítimo.
 *   - `operations_log` entry con `type='pedido_confirmed_definitivo'`.
 *
 * NO toca `transferidoSAP` ni `lines` ni montos — eso ya está persistido
 * por `commitPedidoCF` en la creación del pedido. Esta CF solo cambia
 * `stage` + `finalizedAt` + marker.
 */

export const CONFIRM_DEFINITIVO_RESULT = Object.freeze({
  OK: 'ok',
  OK_IDEMPOTENT: 'ok_idempotent',
  NOT_FOUND: 'not_found',
  PERMISSION_DENIED: 'permission_denied',
  INVALID_STAGE: 'invalid_stage',
  ALREADY_IN_SAP: 'already_in_sap',
  ERROR: 'error',
});

const COMMIT_VERSION = 'confirmDefinitivo_v1';

/**
 * Devuelve true si el caller puede confirmar el pedido según rol + ownership.
 *
 * @param {object} params
 * @param {string} params.callerRole 'admin' | 'gerente' | 'interno' | 'vendedor' | otro
 * @param {string} params.callerUid
 * @param {any} params.pedidoData
 * @returns {boolean}
 */
export function canConfirmPedido({ callerRole, callerUid, pedidoData }) {
  if (!callerUid) return false;
  if (callerRole === 'admin' || callerRole === 'gerente' || callerRole === 'interno') return true;
  if (callerRole === 'vendedor') {
    const ownerUid = pedidoData && pedidoData.ownerUid;
    const assignedVendorUid = pedidoData && pedidoData.assignedVendorUid;
    if (ownerUid && ownerUid === callerUid) return true;
    if (assignedVendorUid && assignedVendorUid === callerUid) return true;
    return false;
  }
  return false;
}

/**
 * @typedef {Object} ConfirmDefinitivoDeps
 * @property {any} fbDb Firestore Admin SDK.
 * @property {() => number} [now]
 */

/**
 * @typedef {Object} ConfirmDefinitivoPayload
 * @property {string} pedidoId
 * @property {string} callerUid
 * @property {string} callerEmail
 * @property {string} callerRole
 */

/**
 * @typedef {Object} ConfirmDefinitivoResponse
 * @property {string} result
 * @property {string} [pedidoId]
 * @property {string} [reason]
 * @property {boolean} [idempotentHit]
 */

/**
 * Core puro invocable desde el wrapper CF o desde tests.
 *
 * @param {ConfirmDefinitivoPayload} payload
 * @param {ConfirmDefinitivoDeps} deps
 * @returns {Promise<ConfirmDefinitivoResponse>}
 */
export async function confirmPedidoDefinitivoCore(payload, deps) {
  const { pedidoId, callerUid, callerEmail, callerRole } = payload;
  const nowMs = deps.now ? deps.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!pedidoId || typeof pedidoId !== 'string') {
    return { result: CONFIRM_DEFINITIVO_RESULT.ERROR, reason: 'pedidoId inválido' };
  }
  if (!callerUid) {
    return { result: CONFIRM_DEFINITIVO_RESULT.PERMISSION_DENIED, reason: 'auth requerido' };
  }

  const pedidoRef = deps.fbDb.collection('pedidos').doc(pedidoId);

  return await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    // FASE READ (§58).
    const snap = await tx.get(pedidoRef);
    if (!snap.exists) {
      return { result: CONFIRM_DEFINITIVO_RESULT.NOT_FOUND, pedidoId };
    }
    const data = snap.data() || {};

    // Permission check.
    if (!canConfirmPedido({ callerRole, callerUid, pedidoData: data })) {
      return {
        result: CONFIRM_DEFINITIVO_RESULT.PERMISSION_DENIED,
        pedidoId,
        reason: `role '${callerRole}' sin acceso al pedido`,
      };
    }

    // Idempotent: ya confirmed con nuestro marker → no re-escribir.
    if (data.stage === 'confirmed' && data._commitVersion === COMMIT_VERSION) {
      return {
        result: CONFIRM_DEFINITIVO_RESULT.OK_IDEMPOTENT,
        pedidoId,
        idempotentHit: true,
      };
    }

    // Guard: pedido ya en SAP.
    if (data.transferidoSAP && data.transferidoSAP.docNum) {
      return {
        result: CONFIRM_DEFINITIVO_RESULT.ALREADY_IN_SAP,
        pedidoId,
        reason: 'pedido ya transferido a SAP; requiere revertPedidoToPendingCF primero',
      };
    }

    // Guard: stage debe ser pending.
    if (data.stage !== 'pending') {
      return {
        result: CONFIRM_DEFINITIVO_RESULT.INVALID_STAGE,
        pedidoId,
        reason: `stage actual '${data.stage}' no es 'pending'`,
      };
    }

    // FASE WRITE (§58).
    tx.update(pedidoRef, {
      stage: 'confirmed',
      finalizedAt: nowIso,
      finalizedBy: callerEmail || callerUid,
      _commitVersion: COMMIT_VERSION,
    });

    return { result: CONFIRM_DEFINITIVO_RESULT.OK, pedidoId };
  });
}
