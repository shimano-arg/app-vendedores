// @ts-check
/**
 * v1416 (2026-10-22) §42.2 — reemplazo del guard "N líneas con STOCK ASIGNADO
 * sin resolver" en el modal "Revisá tu pedido".
 *
 * Antes (v1370): si el cliente tenía ASIG previas no cubiertas por un CPST, el
 * guard bloqueaba el pasaje a Pendientes y pedía "resolve each line first".
 * Para órdenes grandes (ej. PONTORIERO 524 con 29 SKU) la salida era inviable.
 *
 * Ahora §42.2: si existe una orden abierta en `revision_waitlist` para el
 * cliente, ofrecer unificar sus líneas al pedido actual. Aceptar = merge +
 * cerrar waitlist + seguir confirmación. Cancelar = volver a editar.
 *
 * Reusa `findOpenWaitlistsForClient` (§42 v1404) para la lectura; `mergeWaitlistIntoOrderLines`
 * encapsula el pattern de merge preservando `origen` + `asigRefs` + `importedFromOrder`.
 */

/**
 * @typedef {Object} OrderLineForMerge
 * @property {string} code SKU
 * @property {number} qty Cantidad pedida
 * @property {number} [precio] Precio unitario (ARS)
 * @property {string} [desc] Descripción del SKU
 * @property {string | null} [origen] 'stock-asignado' o null
 * @property {Array<{pedidoId:string, lineIndex:number, qtyAsignada:number}> | null} [asigRefs]
 * @property {number | null} [importedFromOrder] orderNumber del waitlist origen
 * @property {string} [_unifiedFromWaitlistId] _id del waitlist absorbido
 */

/**
 * @typedef {Object} WaitlistForMerge
 * @property {string} _id Firestore doc id
 * @property {number} [orderNumber]
 * @property {Array<any>} [items]
 * @property {Array<any>} [pedidosOrigenes]
 */

/**
 * Mergea los items de un waitlist dentro de un array `ord` (orders[currentOrderKey]).
 *
 * - Append puro: no deduplica por SKU (si el pedido actual ya tiene el mismo
 *   SKU, se verá como fila duplicada en el modal — el VDE decide qué hacer).
 * - Preserva `origen` + `asigRefs` para que el bloque §33/§35 cancele las ASIG
 *   originales al transferir el pedido a SAP.
 * - Marca cada línea con `importedFromOrder` + `_unifiedFromWaitlistId` para
 *   auditoría visual (clase CSS `merge-reservado-imported`).
 *
 * @param {Array<OrderLineForMerge>} ord Array in-place a modificar.
 * @param {WaitlistForMerge} waitlist Doc revision_waitlist a absorber.
 * @returns {{added:number, totalUnidades:number}} Métricas del merge.
 */
export function mergeWaitlistIntoOrderLines(ord, waitlist) {
  if (!Array.isArray(ord)) {
    throw new Error('mergeWaitlistIntoOrderLines: ord debe ser array');
  }
  if (!waitlist || typeof waitlist !== 'object') {
    return { added: 0, totalUnidades: 0 };
  }
  const items = Array.isArray(waitlist.items) ? waitlist.items : [];
  const orderNum = Number(waitlist.orderNumber) || null;
  const waitlistId = String(waitlist._id || '') || null;
  let added = 0;
  let totalU = 0;
  for (const it of items) {
    if (!it || !it.code) continue;
    const qty = Number(it.qty) || 0;
    if (qty <= 0) continue;
    /** @type {OrderLineForMerge} */
    const line = {
      code: String(it.code),
      qty,
      precio: Number(it.precio) || 0,
      desc: String(it.desc || ''),
      origen: it.origen || null,
      asigRefs: Array.isArray(it.asigRefs) ? it.asigRefs.slice() : null,
      importedFromOrder: orderNum,
    };
    if (waitlistId) line._unifiedFromWaitlistId = waitlistId;
    ord.push(line);
    added++;
    totalU += qty;
  }
  return { added, totalUnidades: totalU };
}

/**
 * Payload para marcar un waitlist como `consumed` por unificación al review.
 *
 * @param {string} unifiedBy Email o UID del VDE que unificó.
 * @param {string} nowIso Timestamp ISO.
 * @returns {Record<string, any>}
 */
export function buildUnifiedAtReviewUpdate(unifiedBy, nowIso) {
  return {
    stage: 'consumed',
    closedAt: nowIso,
    closedReason: 'unified_at_review',
    unifiedIntoCurrentOrder: true,
    unifiedAt: nowIso,
    unifiedBy: String(unifiedBy || ''),
  };
}

/**
 * Mensaje para el `confirm()` nativo cuando se ofrece unificar.
 *
 * @param {WaitlistForMerge} w
 * @returns {string}
 */
export function formatUnifyConfirmMessage(w) {
  /** @type {Array<any>} */
  const items = w && Array.isArray(w.items) ? w.items : [];
  const totalU = items.reduce(
    (/** @type {number} */ s, /** @type {any} */ it) => s + (Number(it && it.qty) || 0),
    0
  );
  const orderLabel = w && w.orderNumber ? 'ORDEN ' + w.orderNumber : 'la orden abierta';
  return (
    'Este cliente tiene ' +
    orderLabel +
    ' abierta con ' +
    items.length +
    ' linea(s) reservada(s) (' +
    totalU +
    ' u).\n\n' +
    'Unificarla con este pedido antes de confirmar?\n\n' +
    'OK = Unificar (las lineas de ' +
    orderLabel +
    ' se agregan al pedido actual)\n' +
    'Cancelar = Volver a editar'
  );
}
