// @ts-check
import { lineReservesStock } from './stock-realmente-disponible.js';

/**
 * computeVirtualAsigFifo(pedidos, getStk, nowMs?)
 *
 * Pre-aloca el stock fisico disponible (whs 11) a las lineas state='BO' de los
 * pedidos abiertos, orden FIFO por pedido.createdAt ASC. Devuelve un Map
 * keyed por `${pedidoId}:${lineIndex}` con la cantidad real que corresponde
 * promover a "virtual ASIG" para esa linea.
 *
 * v1124 (2026-10-01): agrega filtro `lineReservesStock` cuando se pasa `nowMs`.
 * Sin esto, ASIG expiradas (asigAt > 15d) y de clientes B/C (asigReserva=false)
 * descontaban del fisico sub-promoviendo BOs legitimos. Backwards-compat: sin
 * nowMs, mantiene el comportamiento v1123 (suma TODO ASIG como committed).
 *
 * Contexto v1123: antes el modal "Pedido en espera" > STOCK ASIGNADO promovia
 * una linea BO a "virtual ASIG" si getStk(sku) > 0, pero mostraba el qtyOpen
 * total del BO (ej 4u) aunque el stock real fuera menor (ej 1u). El vendedor
 * prometia 4u y facturaba 1u. Peor cross-cliente: 3 clientes podian ver "2u
 * virtual ASIG" cada uno contra 1u real.
 *
 * Esta fn fija ambos problemas:
 *   1. Pre-pasada global: suma de ASIG + confirmed qtyOpen por SKU (filtrada por
 *      lineReservesStock si nowMs) se descuenta del fisico ANTES de considerar
 *      virtual ASIG (las lineas committed ganan). Fix auditor 2026-10-02:
 *      confirmed tambien compite por el pool fisico — pre-fix solo ASIG lo
 *      hacia y los BOs quedaban sobre-promovidos cuando existian confirmed
 *      del mismo SKU.
 *   2. FIFO por antiguedad del pedido: solo el cliente mas viejo recibe la
 *      porcion de stock libre; si queda remaining, pasa al siguiente.
 *
 * El caller usa el Map asi:
 *   const virtualAsigMap = computeVirtualAsigFifo(globalPedidos, getStk, Date.now());
 *   // ... per cliente, por cada linea state='BO':
 *   const key = `${pedidoId}:${lineIndex}`;
 *   const virtualAsigQty = virtualAsigMap.get(key) || 0;
 *   const virtualBoQty = line.qtyOpen - virtualAsigQty;
 *
 * @param {any[]|null|undefined} pedidos - lista de pedidos (cerrados se filtran aca)
 * @param {(sku: string) => number} getStk - fn que devuelve stock fisico disp venta por SKU
 * @param {number} [nowMs] - timestamp ms para filtrar ASIG/BO expiradas via lineReservesStock.
 *   Omitirlo preserva el comportamiento v1123 (no filtra edad).
 * @returns {Map<string, number>} key = `${pedidoId}:${lineIndex}`, value = virtualAsigQty (>0)
 */
export function computeVirtualAsigFifo(pedidos, getStk, nowMs) {
  /** @type {Map<string, number>} */
  const virtualAsigMap = new Map();
  if (!Array.isArray(pedidos) || typeof getStk !== 'function') return virtualAsigMap;
  const applyFreshness = typeof nowMs === 'number';

  /** @type {Map<string, {pedidoId: string, lineIndex: number, qtyOpen: number, createdAt: number}[]>} */
  const boLinesBySku = new Map();
  // Fix auditor 2026-10-02 (bug C3): antes solo state='ASIG' descontaba del
  // pool, pero state='confirmed' tambien reserva stock fisico segun
  // `_STATES_QUE_RESERVAN` en stock-realmente-disponible.js. Resultado: BOs
  // sobre-promovidos a virtual ASIG cuando existian confirmed del mismo SKU.
  // Renombrado a committedBySku para reflejar que ASIG + confirmed son ambos
  // "committed" para efectos del FIFO.
  /** @type {Map<string, number>} */
  const committedBySku = new Map();

  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    // Fix auditor 2026-10-02 (bug C1): pedido sin _fsId/_id (optimistic local
    // antes del commit Firestore) NO debe skippearse completo. Antes se saltaba
    // todas sus lineas incluyendo ASIG/confirmed → el pool fisico quedaba
    // sobre-estimado y mas BOs de otros pedidos recibian virtual ASIG que ya
    // no existia. getStockRealmenteDisponible no skippea por id → divergencia.
    //
    // Fix: dejamos que ASIG/confirmed de pedidos sin id SIEMPRE sumen a
    // committedBySku (porque reservan stock real), pero no agregamos sus BOs
    // a boLinesBySku — sin id estable, el caller no podria mapear la Key
    // `${pedidoId}:${lineIndex}` de vuelta a un pedido visible para el UI.
    const pedidoId = p._fsId || p._id || '';
    const hasStableId = !!pedidoId;
    let createdAt = 0;
    const c = p.createdAt;
    if (c) {
      if (typeof c.toMillis === 'function') createdAt = c.toMillis();
      else if (typeof c === 'number') createdAt = c;
      else if (c instanceof Date) createdAt = c.getTime();
      else if (typeof c.seconds === 'number') createdAt = c.seconds * 1000;
    }
    // v1124: shim pedido con createdAt normalizado a Date para que
    // lineReservesStock() funcione — su `new Date(pedido.createdAt).getTime()`
    // falla silenciosamente con Firestore Timestamp objects. Pasar createdAt
    // ya en ms resuelta nos aisla de la implementacion upstream.
    //
    // Fix auditor 2026-10-02: tambien normalizamos confirmedAt para que
    // lineReservesStock pueda chequear expiracion de state='confirmed'.
    const confirmedAtMs = (() => {
      const v = p.confirmedAt;
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (typeof v === 'number') return v;
      if (v instanceof Date) return v.getTime();
      if (typeof v.seconds === 'number') return v.seconds * 1000;
      if (typeof v === 'string') {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : 0;
      }
      return 0;
    })();
    const pedidoShim = applyFreshness
      ? Object.assign({}, p, {
          createdAt: createdAt ? new Date(createdAt) : null,
          confirmedAt: confirmedAtMs ? new Date(confirmedAtMs) : null,
        })
      : p;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const code = String(l.code).toUpperCase();
      if (l.state === 'ASIG' || l.state === 'confirmed') {
        // Fix auditor bug C3 2026-10-02: confirmed tambien reserva stock
        // (consistente con _STATES_QUE_RESERVAN en stock-realmente-disponible.js).
        // v1124: skipear ASIG/confirmed expirada o asigReserva=false.
        if (applyFreshness && !lineReservesStock(l, nowMs, pedidoShim)) continue;
        committedBySku.set(code, (committedBySku.get(code) || 0) + qo);
      } else if (l.state === 'BO') {
        // v1124: skipear BO expirado (pedido.createdAt > 15d) — ya no es cola activa.
        if (applyFreshness && !lineReservesStock(l, nowMs, pedidoShim)) continue;
        // Fix auditor 2026-10-02 (bug C1): sin id estable no agregamos este BO
        // como target de virtual ASIG (la Key `${pedidoId}:${lineIndex}` seria
        // '':i → el UI no podria resolver a que pedido pertenece). Las lineas
        // ASIG/confirmed del mismo pedido SI contaron arriba (reservan pool).
        if (!hasStableId) continue;
        let arr = boLinesBySku.get(code);
        if (!arr) {
          arr = [];
          boLinesBySku.set(code, arr);
        }
        arr.push({ pedidoId, lineIndex: i, qtyOpen: qo, createdAt });
      }
    }
  }

  for (const [code, boLines] of boLinesBySku) {
    const physStk = Number(getStk(code)) || 0;
    const asigReserved = committedBySku.get(code) || 0;
    let remaining = Math.max(0, physStk - asigReserved);
    if (remaining <= 0) continue;
    boLines.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      const pidCmp = a.pedidoId.localeCompare(b.pedidoId);
      if (pidCmp !== 0) return pidCmp;
      return a.lineIndex - b.lineIndex;
    });
    for (const b of boLines) {
      const allocated = Math.min(remaining, b.qtyOpen);
      if (allocated > 0) {
        virtualAsigMap.set(`${b.pedidoId}:${b.lineIndex}`, allocated);
        remaining -= allocated;
      }
      if (remaining <= 0) break;
    }
  }

  return virtualAsigMap;
}
