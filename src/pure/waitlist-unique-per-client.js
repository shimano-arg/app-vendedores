// @ts-check
/**
 * v1404 (2026-10-22) §42 — un cliente tiene como máximo UNA orden abierta en
 * lista de espera. Aplica a los 3 caminos de carga: manual, Excel, CPST
 * (Crear Pedido Desde Stock Asignado).
 *
 * Antes de crear en `revision_waitlist`:
 *   1. Buscar órdenes abiertas (closedAt==null) del mismo cardCode.
 *   2. Si existe una → modal "Unificar / Cancelar". No existe "crear nueva".
 *   3. Si existen varias (datos previos a §42) → unificar contra la más nueva
 *      y absorber las demás en el mismo paso (como v1382 Unificar orden).
 */

/**
 * Encuentra órdenes abiertas (closedAt==null, stage!=consumed) de un cliente,
 * ordenadas por `createdAt` DESC. Primero = más nueva.
 *
 * @param {Array<any>} waitlists Lista completa de revision_waitlist en memoria.
 * @param {string} cardCode CardCode SAP del cliente.
 * @returns {Array<any>} Órdenes abiertas del cliente, más nuevas primero.
 */
export function findOpenWaitlistsForClient(waitlists, cardCode) {
  if (!Array.isArray(waitlists) || !cardCode) return [];
  const cc = String(cardCode).trim();
  if (!cc) return [];
  const filtered = waitlists.filter((/** @type {any} */ w) => {
    if (!w) return false;
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
 * Formatea un waitlist para el mensaje del modal confirm.
 *
 * @param {any} w
 * @returns {string} Ej: "ORDEN 445 (3 SKU, 12 unidades, cargada el 20/10 por juan@shimano.com.ar)"
 */
export function formatWaitlistForConfirm(w) {
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
