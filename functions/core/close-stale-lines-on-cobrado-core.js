// @ts-check
/**
 * close-stale-lines-on-cobrado-core.js (v1255, 2026-10-19)
 *
 * Funcion pura: dado un pedido cuyo paidStatus llegó a 'paid', devuelve
 * el patch para cerrar lineas "colgadas" (state='confirmed'/'ASIG' con
 * qtyOpen>0 que SAP ya dio por terminadas al cerrar el pedido).
 *
 * BUG motivador: SKU CUDC201XG reportado por Mariano 2026-10-19 — el modal
 * Backorder del CRM sumaba 71u contra 59u del tablero PBI/SAP. Diff = 12u
 * en 6 lineas state='confirmed' qtyOpen>0 dentro de pedidos con
 * sapEstado='COBRADO_COMPLETO' y paidStatus='paid' (YOEL SAIA, FATECHI parcial
 * 3/6, MUNDO ESTURION x2, KOVRA, CRISTIAN ACOSTA). Pedido ya cerrado en SAP
 * pero linea Firestore quedo abierta → FIFO compute del modal con stock=0
 * reclasifica esos qtyOpen al bucket backorder incorrectamente.
 *
 * Patron: alineado con incidente FATECHI 2026-10-06 (SQ huerfana no linkeada
 * por timeout CF). Mismo sintoma: SAP cerro bien, app no reconcilió la linea.
 *
 * POLICY:
 *   - Trigger: solo cuando pedido.paidStatus === 'paid'
 *     (no 'partial': aun quedan invoices pendientes de cobro, no es seguro cerrar)
 *   - Cerrar lineas con state in {'confirmed','ASIG'} y qtyOpen > 0
 *   - NO tocar state='BO' (backorder legitimo, SAP SQ sigue abierta;
 *     SAP recibira stock y facturara nueva invoice separada)
 *   - NO tocar invoiced/cancelled/recycled/closed_stale/legacy
 *   - Idempotente: si no hay nada que cerrar, newLines=null
 *
 * EFECTO POR LINEA (cuando corresponde cerrar):
 *   qtyCancelled += qtyOpen; qtyOpen = 0; state = 'closed_stale';
 *   closedStaleAt = ISO; closedStaleReason = 'pedido_paid_full_line_stale'
 *
 * Por que state='closed_stale' y no 'cancelled':
 *   - 'cancelled' lo usa el flujo manual de cancelacion por usuario; mezclar
 *     breaks reporting ("quien cancelo esto? → nadie, cerro automatico").
 *   - 'closed_stale' es sentinel nuevo: filtros existentes (BO/ASIG/confirmed)
 *     no lo matchean → no aparece en modal backorder, no se cuenta como
 *     reservando stock, no dispara emails. Reporte explicito.
 *
 * @typedef {Object} PedidoLine
 * @property {string} [code]
 * @property {string} [state]
 * @property {number} [qty]
 * @property {number} [qtyOpen]
 * @property {number} [qtyInvoiced]
 * @property {number} [qtyCancelled]
 * @property {number} [qtyRecycled]
 *
 * @typedef {Object} PedidoLike
 * @property {string} [paidStatus]
 * @property {PedidoLine[]} [lines]
 *
 * @typedef {Object} ClosedLineInfo
 * @property {number} idx
 * @property {string|null} code
 * @property {string} state
 * @property {number} qtyClosed
 *
 * @typedef {Object} ClosureResult
 * @property {ClosedLineInfo[]} closedLines
 * @property {PedidoLine[]|null} newLines  Null si no hay cambios (idempotente).
 */

const CLOSEABLE_STATES = new Set(['confirmed', 'ASIG']);

/**
 * @param {PedidoLike|undefined|null} pedido
 * @param {{nowIso?: string}} [opts]  Inyectable para tests.
 * @returns {ClosureResult}
 */
export function computeStaleLineClosure(pedido, opts = {}) {
  if (!pedido) return { closedLines: [], newLines: null };
  if (pedido.paidStatus !== 'paid') return { closedLines: [], newLines: null };
  const lines = Array.isArray(pedido.lines) ? pedido.lines : null;
  if (!lines || lines.length === 0) return { closedLines: [], newLines: null };

  const nowIso = opts.nowIso || new Date().toISOString();
  /** @type {ClosedLineInfo[]} */
  const closedLines = [];
  const newLines = lines.map((line, idx) => {
    if (!line || typeof line !== 'object') return line;
    const state = typeof line.state === 'string' ? line.state : '';
    if (!CLOSEABLE_STATES.has(state)) return line;
    const qtyOpen = Number(line.qtyOpen) || 0;
    if (qtyOpen <= 0) return line;

    closedLines.push({
      idx,
      code: typeof line.code === 'string' ? line.code : null,
      state,
      qtyClosed: qtyOpen,
    });
    return {
      ...line,
      qtyOpen: 0,
      qtyCancelled: (Number(line.qtyCancelled) || 0) + qtyOpen,
      state: 'closed_stale',
      closedStaleAt: nowIso,
      closedStaleReason: 'pedido_paid_full_line_stale',
    };
  });

  if (closedLines.length === 0) return { closedLines: [], newLines: null };
  return { closedLines, newLines };
}
