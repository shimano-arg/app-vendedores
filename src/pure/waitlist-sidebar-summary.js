// @ts-check
/**
 * Panel "Pedidos en espera" (sidebar izquierdo del mapa): filtro por
 * vendedor + card "Disponible (Con Stock)".
 *
 * Filtro por vendedor: las opciones salen SOLO de las órdenes que el rol ya
 * ve (la lista que llega acá ya pasó por el filtro de visibilidad §59). El
 * selector nunca agrega órdenes, solo achica la lista.
 *
 * Card "Disponible (Con Stock)": cuánto se podría facturar si se confirmaran
 * TODAS las órdenes visibles. Usa la misma fórmula por línea que el detalle
 * de la orden ("Subtotal del pedido (Con Stock)"):
 *
 *   disp(cliente) = min(físico, reservasFirmesPropias(cliente) + sobrante)
 *   sobrante      = libre para la venta (físico − reservas, §40.2)
 *
 * pero repartiendo el stock entre las órdenes en vez de contarlo una vez por
 * orden. Si dos órdenes piden el mismo SKU y el sobrante alcanza para una,
 * el detalle de cada una muestra el SKU "con stock", pero la card lo cuenta
 * una sola vez. Las reservas firmes (ASIG + confirmadas vigentes) de cada
 * cliente solo cubren órdenes de ese cliente. Como el precio es por SKU, el
 * total no depende de qué orden se lleva el sobrante.
 */

/** Valor del selector para "todos los vendedores". */
export const VENDOR_FILTER_ALL = '__ALL__';
/** Valor del selector para órdenes sin vendedor asignado. */
export const VENDOR_FILTER_NONE = '__NONE__';

/**
 * Vendedor de una orden en espera (del cliente master, §44).
 *
 * @param {any} w
 * @returns {string} vendorKey en mayúsculas, o '' si no tiene.
 */
export function waitlistVendorKey(w) {
  if (!w) return '';
  const raw = w.vendorAssigned || w.assignedVendorKey || w.ownerVendor || '';
  return String(raw).trim().toUpperCase();
}

/**
 * Opciones del selector de vendedor a partir de las órdenes visibles.
 *
 * @param {any[]} list - órdenes que el rol ya ve.
 * @returns {{value: string, key: string, count: number}[]} ordenadas por
 *   nombre; "sin vendedor" al final.
 */
export function buildVendorFilterOptions(list) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const w of Array.isArray(list) ? list : []) {
    const k = waitlistVendorKey(w);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const named = [...counts.keys()].filter((k) => k).sort((a, b) => a.localeCompare(b, 'es'));
  const out = named.map((k) => ({ value: k, key: k, count: counts.get(k) || 0 }));
  if (counts.has('')) out.push({ value: VENDOR_FILTER_NONE, key: '', count: counts.get('') || 0 });
  return out;
}

/**
 * Aplica el filtro del selector.
 *
 * @param {any[]} list
 * @param {string} value - VENDOR_FILTER_ALL, VENDOR_FILTER_NONE o un vendorKey.
 * @returns {any[]}
 */
export function filterWaitlistsByVendor(list, value) {
  const arr = Array.isArray(list) ? list : [];
  if (!value || value === VENDOR_FILTER_ALL) return arr;
  if (value === VENDOR_FILTER_NONE) return arr.filter((w) => waitlistVendorKey(w) === '');
  const target = String(value).trim().toUpperCase();
  return arr.filter((w) => waitlistVendorKey(w) === target);
}

/**
 * Índice de reservas firmes por cliente y SKU: suma de qtyOpen de líneas
 * ASIG o confirmed vigentes en pedidos abiertos. Misma regla que el detalle
 * de la orden (v1361).
 *
 * @param {any[]} pedidos - globalPedidos.
 * @param {((line: any, nowMs: number, pedido: any) => boolean) | null} lineReservesStock
 * @param {number} nowMs
 * @returns {Map<string, number>} clave `cardCode|SKU`.
 */
export function buildFirmesPropiasIndex(pedidos, lineReservesStock, nowMs) {
  /** @type {Map<string, number>} */
  const idx = new Map();
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (!p || p.closedAt) continue;
    const cc = String(p.clientCardCode || '').trim();
    if (!cc) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (l.state !== 'ASIG' && l.state !== 'confirmed') continue;
      if (lineReservesStock && !lineReservesStock(l, nowMs, p)) continue;
      const key = cc + '|' + String(l.code).toUpperCase();
      idx.set(key, (idx.get(key) || 0) + (Number(l.qtyOpen) || 0));
    }
  }
  return idx;
}

/**
 * @typedef {Object} SkuStock
 * @property {boolean} hasData - hay snapshot de stock para el SKU.
 * @property {number} fisico - stock físico vendible (dep 11).
 * @property {number} sobrante - libre para la venta (físico − reservas).
 */

/**
 * @typedef {Object} DisponibleDeps
 * @property {(code: string) => SkuStock} getSkuStock
 * @property {Map<string, number>} firmesIndex - de buildFirmesPropiasIndex.
 * @property {(code: string) => number} getPrice
 */

/**
 * Total "Disponible (Con Stock)" de un conjunto de órdenes en espera.
 *
 * Paso 1: cada línea toma de las reservas firmes de su cliente.
 * Paso 2: lo que falta toma del sobrante compartido del SKU.
 * Todo con tope en el físico del SKU. Sin snapshot de stock la línea cuenta
 * entera (igual que el detalle de la orden).
 *
 * @param {any[]} waitlists
 * @param {DisponibleDeps} deps
 * @returns {{total: number, sumaPorOrden: number}} `sumaPorOrden` es la suma
 *   de los subtotales con stock de cada orden por separado (lo que da sumar
 *   los detalles); sirve para mostrar la diferencia.
 */
export function computeDisponibleConStockTotal(waitlists, deps) {
  /** @type {{code: string, cc: string, qty: number, price: number, stk: SkuStock}[]} */
  const lines = [];
  /** @type {Map<string, SkuStock>} */
  const stockCache = new Map();
  for (const w of Array.isArray(waitlists) ? waitlists : []) {
    if (!w) continue;
    const cc = String(w.clientCardCode || '').trim();
    for (const it of Array.isArray(w.items) ? w.items : []) {
      if (!it || !it.code) continue;
      const qty = Math.max(Number(it.qty) || 0, 0);
      if (qty <= 0) continue;
      const code = String(it.code).toUpperCase();
      let stk = stockCache.get(code);
      if (!stk) {
        stk = deps.getSkuStock(code);
        stockCache.set(code, stk);
      }
      lines.push({ code, cc, qty, price: Number(deps.getPrice(code)) || 0, stk });
    }
  }

  // Suma por orden (cada orden ve todo el stock para ella sola).
  let sumaPorOrden = 0;
  for (const ln of lines) {
    if (!ln.stk || !ln.stk.hasData) {
      sumaPorOrden += ln.qty * ln.price;
      continue;
    }
    const firmes = ln.cc ? deps.firmesIndex.get(ln.cc + '|' + ln.code) || 0 : 0;
    const disp = Math.min(Math.max(ln.stk.fisico, 0), firmes + Math.max(ln.stk.sobrante, 0));
    sumaPorOrden += Math.min(ln.qty, disp) * ln.price;
  }

  // Reparto conjunto.
  /** @type {Map<string, number>} */
  const firmesLeft = new Map();
  /** @type {Map<string, number>} */
  const sobranteLeft = new Map();
  /** @type {Map<string, number>} */
  const fisicoLeft = new Map();
  const covered = lines.map(() => 0);
  let total = 0;

  lines.forEach((ln, i) => {
    if (!ln.stk || !ln.stk.hasData) return;
    if (!fisicoLeft.has(ln.code)) {
      fisicoLeft.set(ln.code, Math.max(ln.stk.fisico, 0));
      sobranteLeft.set(ln.code, Math.max(ln.stk.sobrante, 0));
    }
    if (!ln.cc) return;
    const fk = ln.cc + '|' + ln.code;
    if (!firmesLeft.has(fk)) firmesLeft.set(fk, deps.firmesIndex.get(fk) || 0);
    const take = Math.min(ln.qty, firmesLeft.get(fk) || 0, fisicoLeft.get(ln.code) || 0);
    firmesLeft.set(fk, (firmesLeft.get(fk) || 0) - take);
    fisicoLeft.set(ln.code, (fisicoLeft.get(ln.code) || 0) - take);
    covered[i] = take;
  });

  lines.forEach((ln, i) => {
    if (!ln.stk || !ln.stk.hasData) {
      total += ln.qty * ln.price;
      return;
    }
    const falta = ln.qty - covered[i];
    const take = Math.min(falta, sobranteLeft.get(ln.code) || 0, fisicoLeft.get(ln.code) || 0);
    sobranteLeft.set(ln.code, (sobranteLeft.get(ln.code) || 0) - take);
    fisicoLeft.set(ln.code, (fisicoLeft.get(ln.code) || 0) - take);
    total += (covered[i] + take) * ln.price;
  });

  return { total, sumaPorOrden };
}
