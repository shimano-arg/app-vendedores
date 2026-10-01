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
 *   1. Pre-pasada global: suma de ASIG qtyOpen por SKU (filtrada por
 *      lineReservesStock si nowMs) se descuenta del fisico ANTES de considerar
 *      virtual ASIG (las ASIG committed ganan).
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
  /** @type {Map<string, number>} */
  const asigConsumedBySku = new Map();

  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    const pedidoId = p._fsId || p._id || '';
    if (!pedidoId) continue;
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
    const pedidoShim = applyFreshness
      ? Object.assign({}, p, { createdAt: createdAt ? new Date(createdAt) : null })
      : p;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const code = String(l.code).toUpperCase();
      if (l.state === 'ASIG') {
        // v1124: skipear ASIG expirada (asigAt > 15d) o asigReserva=false.
        // lineReservesStock(line, nowMs, pedido) devuelve false en esos casos.
        if (applyFreshness && !lineReservesStock(l, nowMs, pedidoShim)) continue;
        asigConsumedBySku.set(code, (asigConsumedBySku.get(code) || 0) + qo);
      } else if (l.state === 'BO') {
        // v1124: skipear BO expirado (pedido.createdAt > 15d) — ya no es cola activa.
        if (applyFreshness && !lineReservesStock(l, nowMs, pedidoShim)) continue;
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
    const asigReserved = asigConsumedBySku.get(code) || 0;
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
