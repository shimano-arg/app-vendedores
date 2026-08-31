// @ts-check
/**
 * v750 (2026-08-31): tracking de transiciones de state en lines pedidos-app.
 *
 * Objetivo negocio: medir mes-a-mes cuantas unidades que estaban en state=ASIG
 * terminan concretadas (confirmed/invoiced) vs eliminadas (cancelled/recycled).
 * Pedido explicito de Mariano para evaluar si vale la pena seguir con el
 * flow backorder o si las tiendas terminan cancelando.
 *
 * Mecanismo: on-write trigger sobre pedidos/{id}. La CF compara before.lines
 * vs after.lines y escribe un record a `asig_transitions/{auto-id}` por cada
 * cambio de state que involucre 'ASIG' (source o destino).
 *
 * Solo trackea CAMBIOS de state (no cambios de qtyOpen dentro del mismo state
 * para MVP - simplicidad + evita ruido de intermediate updates).
 *
 * Testeable con arrays puros (before/after de lines) sin depender de Firestore.
 */

const ASIG_STATE = 'ASIG';

/**
 * @typedef {Object} PedidoLine
 * @property {string} [code] SKU
 * @property {number} [qty] cantidad original pedida
 * @property {number} [qtyOpen] cantidad open (aun no facturada/cancelada)
 * @property {string} [state] BO | ASIG | confirmed | cancelled | recycled | invoiced
 */

/**
 * @typedef {Object} PedidoDoc
 * @property {string} [clientCardCode]
 * @property {string} [clientName]
 * @property {string} [ownerVendor]
 * @property {string} [province]
 * @property {string} [locName]
 * @property {any} [createdAt]
 * @property {PedidoLine[]} [lines]
 */

/**
 * @typedef {Object} AsigTransition
 * @property {string} pedidoId
 * @property {number} lineIdx
 * @property {string} sku
 * @property {string} clientCardCode
 * @property {string} clientName
 * @property {string} vendor
 * @property {string} province
 * @property {string} locName
 * @property {string} fromState
 * @property {string} toState
 * @property {number} qty  cantidad que transiciono
 */

/**
 * Detecta transiciones que involucren state='ASIG' entre before/after de un pedido.
 * Reglas:
 * - Solo trackea si el ESTADO cambio (before.state !== after.state).
 * - Solo trackea si el estado ANTES O DESPUES era 'ASIG' (entrada o salida de ASIG).
 * - Si after no tiene la linea (fue eliminada del array), asume toState='cancelled'.
 * - qty reportada = beforeLine.qtyOpen si before existia, sino afterLine.qtyOpen.
 * - Match por lineIdx: asume que las lines mantienen el orden. Si el schema cambia,
 *   refactorizar aca.
 *
 * @param {string} pedidoId
 * @param {PedidoDoc|null} before
 * @param {PedidoDoc|null} after
 * @returns {AsigTransition[]}
 */
export function detectAsigTransitions(pedidoId, before, after) {
  const transitions = [];
  if (!pedidoId) return transitions;
  // Si el doc es nuevo (before null) o eliminado (after null), tratar defensively.
  const beforeLines = Array.isArray(before?.lines) ? before.lines : [];
  const afterLines = Array.isArray(after?.lines) ? after.lines : [];

  // Fuente de metadata (cliente/vendedor). Priorizar after; fallback a before.
  const meta = after || before || {};
  const clientCardCode = String(meta.clientCardCode || '');
  const clientName = String(meta.clientName || '');
  const vendor = String(meta.ownerVendor || '');
  const province = String(meta.province || '');
  const locName = String(meta.locName || '');

  // Iterar por index max de ambas lists.
  const maxIdx = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxIdx; i++) {
    const b = beforeLines[i] || null;
    const a = afterLines[i] || null;
    const bState = b && typeof b.state === 'string' ? b.state : null;
    const aState = a && typeof a.state === 'string' ? a.state : null;

    // Caso: linea eliminada del array (after doesn't have this idx).
    if (b && !a) {
      if (bState === ASIG_STATE) {
        transitions.push(_makeTransition({
          pedidoId, lineIdx: i,
          sku: String(b.code || ''),
          clientCardCode, clientName, vendor, province, locName,
          fromState: ASIG_STATE,
          toState: 'cancelled',  // asume cancelacion cuando desaparece
          qty: Number(b.qtyOpen) || 0,
        }));
      }
      continue;
    }

    // Caso: linea nueva (before doesn't have this idx).
    if (!b && a) {
      // Solo trackear si la nueva linea entra directo a ASIG (raro pero posible).
      if (aState === ASIG_STATE) {
        transitions.push(_makeTransition({
          pedidoId, lineIdx: i,
          sku: String(a.code || ''),
          clientCardCode, clientName, vendor, province, locName,
          fromState: 'new',  // no habia estado previo
          toState: ASIG_STATE,
          qty: Number(a.qtyOpen) || 0,
        }));
      }
      continue;
    }

    // Caso: linea existe en ambos. Trackear solo si state cambio.
    if (b && a && bState !== aState) {
      // Solo trackear cambios que involucren ASIG (entrada o salida).
      if (bState !== ASIG_STATE && aState !== ASIG_STATE) continue;
      transitions.push(_makeTransition({
        pedidoId, lineIdx: i,
        sku: String((a.code || b.code) || ''),
        clientCardCode, clientName, vendor, province, locName,
        fromState: bState || 'unknown',
        toState: aState || 'unknown',
        // qty = qtyOpen antes de la transicion (lo que "salio" de ASIG)
        qty: bState === ASIG_STATE ? (Number(b.qtyOpen) || 0) : (Number(a.qtyOpen) || 0),
      }));
    }
    // Cambios de qtyOpen dentro del mismo state (ej. ASIG parcial) NO se
    // trackean en MVP. Se podria agregar en v2 si hace falta granularidad.
  }
  return transitions;
}

/**
 * Helper para instanciar el objeto transition con shape consistent.
 * @param {Omit<AsigTransition, never>} fields
 * @returns {AsigTransition}
 */
function _makeTransition(fields) {
  return {
    pedidoId: fields.pedidoId,
    lineIdx: fields.lineIdx,
    sku: fields.sku,
    clientCardCode: fields.clientCardCode,
    clientName: fields.clientName,
    vendor: fields.vendor,
    province: fields.province,
    locName: fields.locName,
    fromState: fields.fromState,
    toState: fields.toState,
    qty: fields.qty,
  };
}

/**
 * Escribe transiciones a Firestore. Fire-and-forget batch. Cada transicion
 * agrega tambien transitionedAt (serverTimestamp) y month (YYYY-MM) para
 * queries BQ mensuales sin group by expensivo.
 *
 * @param {{ fbDb: any, FieldValue: any, log?: (msg: string, extra?: any) => void }} deps
 * @param {AsigTransition[]} transitions
 * @returns {Promise<number>} count escrito
 */
export async function writeTransitionsBatch(deps, transitions) {
  if (!transitions.length) return 0;
  const { fbDb, FieldValue, log } = deps;
  const nowIso = new Date().toISOString();
  const month = nowIso.slice(0, 7);  // 'YYYY-MM'
  const batch = fbDb.batch();
  const coll = fbDb.collection('asig_transitions');
  for (const t of transitions) {
    const ref = coll.doc();  // auto-id
    batch.set(ref, {
      ...t,
      month,
      transitionedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  if (log) log('asig_transitions written', { count: transitions.length, month });
  return transitions.length;
}
