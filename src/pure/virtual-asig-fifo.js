// @ts-check
/**
 * computeVirtualAsigFifo(pedidos, getStk)
 *
 * Pre-aloca el stock fisico disponible (whs 11) a las lineas state='BO' de los
 * pedidos abiertos, orden FIFO por pedido.createdAt ASC. Devuelve un Map
 * keyed por `${pedidoId}:${lineIndex}` con la cantidad real que corresponde
 * promover a "virtual ASIG" para esa linea.
 *
 * Contexto: antes de v1123, el modal "Pedido en espera" > seccion
 * STOCK ASIGNADO promovia una linea BO a "virtual ASIG" si getStk(sku) > 0,
 * pero mostraba el qtyOpen total del BO (ej 4u) aunque el stock real fuera
 * menor (ej 1u). El vendedor le prometia al cliente las 4u y al facturar solo
 * salia 1. Peor: el chequeo era por-cliente, sin considerar que otros clientes
 * estan compitiendo por el mismo stock -> 3 clientes podian ver "2u virtual
 * ASIG" cada uno contra 1u real.
 *
 * Esta fn fija ambos problemas:
 *   1. Pre-pasada global: suma de ASIG qtyOpen por SKU se descuenta del fisico
 *      ANTES de considerar virtual ASIG (las ASIG son reservas committed, ganan).
 *   2. FIFO por antiguedad del pedido: solo el cliente mas viejo recibe la
 *      porcion de stock libre; si queda remaining, pasa al siguiente.
 *
 * El caller usa el Map asi:
 *   const virtualAsigMap = computeVirtualAsigFifo(globalPedidos, getStk);
 *   // ... per cliente, por cada linea state='BO':
 *   const key = `${pedidoId}:${lineIndex}`;
 *   const virtualAsigQty = virtualAsigMap.get(key) || 0;
 *   const virtualBoQty = line.qtyOpen - virtualAsigQty;
 *   // virtualAsigQty > 0 -> fila en STOCK ASIGNADO con qty = virtualAsigQty
 *   // virtualBoQty > 0 -> fila en BACKORDER con qty = virtualBoQty
 *
 * @param {any[]|null|undefined} pedidos - lista de pedidos (cerrados se filtran aca)
 * @param {(sku: string) => number} getStk - fn que devuelve stock fisico disp venta por SKU
 * @returns {Map<string, number>} key = `${pedidoId}:${lineIndex}`, value = virtualAsigQty (>0)
 */
export function computeVirtualAsigFifo(pedidos, getStk) {
  /** @type {Map<string, number>} */
  const virtualAsigMap = new Map();
  if (!Array.isArray(pedidos) || typeof getStk !== 'function') return virtualAsigMap;

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
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const code = String(l.code).toUpperCase();
      if (l.state === 'ASIG') {
        asigConsumedBySku.set(code, (asigConsumedBySku.get(code) || 0) + qo);
      } else if (l.state === 'BO') {
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
