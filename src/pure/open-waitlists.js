// @ts-check
/**
 * §57 (2026-10-23) — Un solo lugar para "waitlists abiertas de un cliente"
 * con exclusión de la propia waitlist de origen.
 *
 * Antes: la misma lógica vivía en:
 *   - `functions/core/commit-pedido-core.js:findOpenWaitlistForClient` (CF).
 *   - `src/domains/pedidos-modal.js:validateReviewAndPasarAPendientes`
 *     (guard §42.2 cliente con fresh query + excludeId v1418).
 *   - `index.html:_createOrUnifyWaitlistPayload` (§42 §42.1 v1415 helper CPST).
 *   - `src/pure/waitlist-unique-per-client.js:findOpenWaitlistsForClient`
 *     (pure 2-args usada por los 3 anteriores).
 *
 * Problema: la CF NO excluía la waitlist que originó el pedido. Al confirmar
 * un pedido desde `revision_waitlist` (CPST o manual), el CF buscaba por
 * cardCode y encontraba la propia waitlist (aún `closedAt=null` + `stage!=consumed`
 * porque el cliente la marcaba DESPUÉS del `pedidos.add` legacy) → devolvía
 * `CLIENT_HAS_OPEN_WAITLIST` false positive sobre sí misma.
 *
 * Fix: una única función `findOpenWaitlistsForClient(cardCode, excludeWaitlistId,
 * docs)` usada tanto en el cliente (guard informativo) como en el servidor
 * (autoridad). "Abierta" = `closedAt==null` AND `stage!=='consumed'`.
 * Excluye SIEMPRE el `excludeWaitlistId` si está presente.
 *
 * El `functions/core/open-waitlists.js` es un espejo verbatim. Test de
 * sincronía en `tests/unit/audit/open-waitlists-sync.test.js` falla si
 * divergen.
 */

/**
 * Devuelve las waitlists abiertas de un cliente, excluyendo la pasada por
 * `excludeWaitlistId`. Ordenadas por `createdAt` DESC (más nueva primero).
 *
 * @param {string} cardCode CardCode SAP del cliente (uppercase/trim respetado por caller).
 * @param {string | null | undefined} excludeWaitlistId Opcional. ID de la
 *   waitlist que originó el pedido en curso; se excluye del resultado.
 * @param {Array<any>} docs Array de documentos `revision_waitlist` con
 *   shape `{_id, clientCardCode, closedAt, stage, createdAt, ...}`.
 * @returns {Array<any>} Waitlists abiertas filtradas (sin la de origen),
 *   ordenadas por `createdAt` DESC. Nunca `null`.
 */
export function findOpenWaitlistsForClient(cardCode, excludeWaitlistId, docs) {
  if (!Array.isArray(docs) || !cardCode) return [];
  const cc = String(cardCode).trim();
  if (!cc) return [];
  const excludeId = excludeWaitlistId ? String(excludeWaitlistId) : null;
  const filtered = docs.filter((/** @type {any} */ w) => {
    if (!w) return false;
    // Exclusión por id (self-reference): la propia waitlist que originó el
    // pedido NO debe considerarse "abierta ajena".
    if (excludeId && String(w._id || '') === excludeId) return false;
    // "Abierta" = closedAt null + stage no consumed.
    if (w.closedAt) return false;
    if (w.stage === 'consumed') return false;
    const wcc = String(w.clientCardCode || '').trim();
    return wcc === cc;
  });
  filtered.sort((a, b) => {
    const _ms = (/** @type {any} */ w) => {
      const t = w.createdAt;
      if (!t) return 0;
      if (typeof t === 'string') return Date.parse(t) || 0;
      if (typeof t.toMillis === 'function') return t.toMillis();
      if (typeof t.toDate === 'function') return t.toDate().getTime();
      return 0;
    };
    return _ms(b) - _ms(a);
  });
  return filtered;
}

/**
 * Para el mensaje al VDE cuando el guard dispara. Idéntico al de
 * `src/pure/waitlist-unique-per-client.js:formatWaitlistForConfirm` para
 * mantener consistencia visual.
 *
 * @param {any} w
 * @returns {string}
 */
export function formatWaitlistForMessage(w) {
  if (!w) return '(sin datos)';
  const orderNum = w.orderNumber ? 'ORDEN ' + w.orderNumber : '(sin orden)';
  const items = Array.isArray(w.items) ? w.items : [];
  const skuCount = items.length;
  const unidades = items.reduce(
    (/** @type {number} */ s, /** @type {any} */ it) => s + (Number(it.qty) || 0),
    0
  );
  let fecha = '';
  const t = w.createdAt;
  if (t) {
    let d;
    if (typeof t === 'string') d = new Date(t);
    else if (typeof t.toDate === 'function') d = t.toDate();
    else if (typeof t.toMillis === 'function') d = new Date(t.toMillis());
    if (d && !Number.isNaN(d.getTime())) {
      fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    }
  }
  const owner = w.ownerDisplayName || w.ownerEmail || w.ownerVendor || '(sin owner)';
  return (
    orderNum +
    ' (' +
    skuCount +
    ' SKU, ' +
    unidades +
    ' unidades' +
    (fecha ? ', cargada el ' + fecha : '') +
    ' por ' +
    owner +
    ')'
  );
}
