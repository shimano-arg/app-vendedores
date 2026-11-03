/**
 * Errores de envío a SAP (pedido.transferError): clasificación, armado y
 * decisiones de reintento. Fuente ÚNICA para la CF (espejo verbatim en
 * functions/core/sap-transfer-error.js, §57) y los caminos del navegador
 * (listener de auto-envío y envío manual).
 *
 * Contexto (2026-11-03, patch 4xx):
 *  - La CF guarda `transferError` con `via: 'cf_auto'` y `status` ante un 4xx.
 *    Esa escritura es un `modified` para el listener del navegador, que antes
 *    reenviaba el pedido con DiscountPercent 0 y, si SAP lo aceptaba, creaba la
 *    cotización sin el descuento y borraba el error.
 *  - Un rechazo por descuento (SAP 10000724) nunca se reintenta solo; el
 *    reenvío manual exige confirmación y el rechazo queda en el historial.
 */

/**
 * ¿El error de SAP es un rechazo por descuento? (usuario técnico sin permiso
 * para ese %: "Value in Discount field is greater than permitted", código
 * 10000724, a veces con signo; -5002 es genérico y solo cuenta si el texto
 * habla de descuento).
 * @param {any} sapCode
 * @param {any} message
 * @returns {boolean}
 */
export function isSapDiscountRejection(sapCode, message) {
  const msg = String(message || '');
  const code = sapCode == null ? '' : String(sapCode).replace(/^-/, '');
  if (code === '10000724' || /10000724/.test(msg)) return true;
  return (
    /discount/i.test(msg) &&
    /(greater than permitted|mayor (al|que el) permitido|not permitted|permitted)/i.test(msg)
  );
}

/**
 * ¿Es un rechazo determinístico de SAP registrado por la CF (`via: 'cf_auto'`)?
 * Rechazo por descuento, o HTTP 4xx distinto de 408/429 (transitorios). Los
 * ambiguos (5xx / timeout, `needsManualVerification`) no cuentan: los cubre el
 * lock con TTL y el pre-check idempotente.
 * @param {any} te pedido.transferError
 * @returns {boolean}
 */
export function isDeterministicCfRejection(te) {
  if (!te || typeof te !== 'object') return false;
  if (te.via !== 'cf_auto') return false;
  if (te.needsManualVerification === true) return false;
  if (te.discountRejected === true) return true;
  const st = Number(te.status);
  return Number.isInteger(st) && st >= 400 && st < 500 && st !== 408 && st !== 429;
}

/**
 * ¿El último error de envío registra un rechazo por descuento (de cualquier
 * camino: CF, listener o envío manual)?
 * @param {any} te
 * @returns {boolean}
 */
export function hasDiscountRejection(te) {
  return !!te && typeof te === 'object' && te.discountRejected === true;
}

/**
 * ¿El listener de auto-envío del navegador debe saltear este pedido?
 * Sí si hay un rechazo por descuento (de cualquier camino) o un rechazo
 * determinístico de la CF. El envío manual NO usa esta función: pide
 * confirmación (ver discountRetryConfirmText) y no bloquea.
 * @param {any} te
 * @returns {boolean}
 */
export function blocksAutoSend(te) {
  return hasDiscountRejection(te) || isDeterministicCfRejection(te);
}

/**
 * Arma `transferError` a partir de una respuesta fallida de Service Layer.
 * Sin campos `undefined` (Firestore los rechaza).
 *
 * @param {{
 *   status?: any, body?: any, error?: any, message?: any,
 *   via: string, at: string, attemptedBy?: string,
 *   discountPercentSent?: any,
 * }} o
 * @returns {Record<string, any>}
 */
export function buildSapTransferError(o) {
  const body = o && o.body && typeof o.body === 'object' ? o.body : null;
  const slMsg =
    body && body.error && body.error.message
      ? typeof body.error.message === 'object'
        ? body.error.message.value
        : body.error.message
      : '';
  const message = String(o.message || o.error || slMsg || 'Error desconocido').slice(0, 500);
  const rawCode = body && body.error && body.error.code != null ? body.error.code : null;
  const sapCode = rawCode == null ? null : String(rawCode).slice(0, 32);
  const st = Number(o.status);
  /** @type {Record<string, any>} */
  const te = {
    message,
    at: String(o.at),
    via: String(o.via),
    status: Number.isFinite(st) ? st : null,
    sapCode,
    discountRejected: isSapDiscountRejection(sapCode, message + ' ' + String(slMsg || '')),
    discountPercentSent: Number(o.discountPercentSent) || 0,
  };
  if (o.attemptedBy) te.attemptedBy = String(o.attemptedBy);
  return te;
}

/**
 * % de descuento que el vendedor pidió, para mostrar (no para calcular).
 * @param {any} pedido
 * @param {any} te
 * @returns {number}
 */
export function requestedDiscountPctForDisplay(pedido, te) {
  const p = pedido || {};
  const snap = p.discountSnapshot && Number(p.discountSnapshot.pctTotal);
  const n = Number(p.discountPct) || snap || (te && Number(te.discountPercentSent)) || 0;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Texto de la confirmación obligatoria antes de reenviar a mano un pedido con
 * rechazo previo por descuento. Deja explícito que el descuento NO se aplica.
 * @param {any} pedido
 * @param {any} te
 * @returns {string}
 */
export function discountRetryConfirmText(pedido, te) {
  const p = pedido || {};
  const pct = requestedDiscountPctForDisplay(p, te);
  const cli =
    (p.clientName || '(sin cliente)') + (p.orderNumber ? ' (ORDEN ' + p.orderNumber + ')' : '');
  const motivo = String((te && te.message) || '').slice(0, 160);
  return (
    'ATENCIÓN: SAP rechazó antes el descuento de este pedido.\n\n' +
    'Cliente: ' +
    cli +
    '\n' +
    'Descuento solicitado: ' +
    pct +
    ' %\n' +
    (motivo ? 'Motivo de SAP: ' + motivo + '\n' : '') +
    '\nSi lo reenviás, SAP puede recibir la cotización SIN el descuento económico. ' +
    'El ' +
    pct +
    ' % queda solo como texto en los comentarios y NO se aplica: ' +
    'alguien con permiso tiene que cargarlo en SAP.\n\n' +
    '¿Reenviar igual, sabiendo que el descuento no queda aplicado?'
  );
}

/**
 * Copia de un `transferError` para `transferErrorHistory`, con el desenlace.
 * Sin campos `undefined`.
 * @param {any} te
 * @param {{by: string, at: string, resolution: string, pctEnviado?: any}} o
 * @returns {Record<string, any>}
 */
export function archiveTransferError(te, o) {
  const prev = te && typeof te === 'object' ? te : {};
  /** @type {Record<string, any>} */
  const archived = {};
  for (const [k, v] of Object.entries(prev)) if (v !== undefined) archived[k] = v;
  archived.resolvedAt = String(o.at);
  archived.resolvedBy = String(o.by || '');
  archived.resolution = String(o.resolution);
  archived.pctEnviadoEnReenvio = Number(o.pctEnviado) || 0;
  return archived;
}

/**
 * Campos a escribir cuando un reenvío manual confirmado tiene éxito: el
 * rechazo original queda en `transferErrorHistory` (arrayUnion) y
 * `descuentoRechazadoPrevio` deja constancia de qué se mandó realmente.
 *
 * @param {any} te transferError previo (con discountRejected)
 * @param {{pctSolicitado: number, pctEnviado: any, by: string, at: string, arrayUnion: (x: any) => any}} o
 * @returns {Record<string, any>}
 */
export function discountRetrySuccessFields(te, o) {
  const pctSolicitado = Number(o.pctSolicitado) || 0;
  const pctEnviado = Number(o.pctEnviado) || 0;
  return {
    transferErrorHistory: o.arrayUnion(
      archiveTransferError(te, {
        by: o.by,
        at: o.at,
        resolution: 'reenvio_manual_confirmado',
        pctEnviado,
      })
    ),
    descuentoRechazadoPrevio: {
      pctSolicitado,
      pctEnviado,
      aplicadoEnSap: pctEnviado > 0 && pctEnviado >= pctSolicitado,
      confirmadoPor: String(o.by || ''),
      at: String(o.at),
    },
  };
}
