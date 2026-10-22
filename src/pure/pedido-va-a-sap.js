// @ts-check
/**
 * v1418 §53 (2026-10-22) — "Va a SAP" neto unificado.
 *
 * Fuente única de verdad para los 3 lugares que muestran el monto que
 * efectivamente llega a SAP (modal detalle, Planner card, payload SL):
 *
 *   va_a_sap = sum(line.qty × line.precio para state='confirmed') × (1 - pctTotal/100)
 *
 * El backorder (`state='BO'`) NO va a SAP (queda como demanda pendiente en
 * la app). El descuento se aplica solo sobre las líneas confirmed.
 *
 * Prioridad:
 *   1. `pedido.sapDocTotal` (sync nightly del DocTotal real de SAP).
 *   2. Compute `confirmed_sum × (1 - discountPct/100)` si hay líneas confirmed.
 *   3. Fallback a `netAmountArs` / `subtotalArs` legacy si no hay confirmed
 *      todavía (pedidos pre-stage='confirmed').
 *
 * Precedente: SAP 2000425 PONTORIERO 2026-10-22 — modal detalle mostraba
 * "VA A SAP 2.389.570" pero Planner card mostraba `netAmountArs` (que incluía
 * backorder) y el payload enviaba DiscountPercent=0 (hardcode pre-v1418 §53).
 * Los 3 lugares divergían.
 */

/**
 * @typedef {Object} LineForVaASap
 * @property {string} [code]
 * @property {string} [state] 'confirmed' | 'BO' | 'ASIG' | 'cancelled' | ...
 * @property {number} [qty]
 * @property {number} [precio]
 * @property {number} [priceAtCreation]
 * @property {number} [price]
 */

/**
 * @typedef {Object} PedidoForVaASap
 * @property {number} [sapDocTotal]
 * @property {number} [discountPct]
 * @property {{pctTotal?:number}} [discountSnapshot]
 * @property {number} [netAmountArs]
 * @property {number} [subtotalArs]
 * @property {Array<LineForVaASap>} [lines]
 */

/**
 * Suma `qty × precio` de las líneas `state='confirmed'` (lo que efectivamente
 * viaja a SAP como DocumentLines). Resuelve el precio con cascada:
 *   `l.precio || l.priceAtCreation || l.price || 0`.
 *
 * @param {Array<LineForVaASap> | undefined} lines
 * @returns {number}
 */
export function sumConfirmedBruto(lines) {
  if (!Array.isArray(lines)) return 0;
  let sum = 0;
  for (const l of lines) {
    if (!l || l.state !== 'confirmed') continue;
    const qty = Number(l.qty) || 0;
    const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
    // G5.30: finite guard (ignora Infinity/NaN).
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    if (qty > 0 && price > 0) sum += qty * price;
  }
  return sum;
}

/**
 * Lee el descuento del pedido como porcentaje [0, 100]. Clamp defensivo.
 *
 * @param {PedidoForVaASap | null | undefined} pedido
 * @returns {number}
 */
export function readDiscountPct(pedido) {
  if (!pedido) return 0;
  const raw =
    Number(pedido.discountPct) ||
    (pedido.discountSnapshot && Number(pedido.discountSnapshot.pctTotal)) ||
    0;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (raw > 100) return 100;
  return raw;
}

/**
 * Devuelve el monto "va a SAP" (confirmed × (1 - discountPct/100)) con
 * prioridad al `sapDocTotal` sync-eado si existe.
 *
 * @param {PedidoForVaASap | null | undefined} pedido
 * @returns {number | null} Monto en ARS, o `null` si no hay datos suficientes.
 */
export function computeVaASap(pedido) {
  if (!pedido) return null;
  // 1. sapDocTotal real sync-eado desde SAP (fuente autoritativa).
  //    G5.30: Number.isFinite filtra NaN/Infinity por si entra data corrupta.
  if (Number.isFinite(pedido.sapDocTotal) && pedido.sapDocTotal > 0) {
    return pedido.sapDocTotal;
  }
  // 2. Compute desde líneas confirmed + discountPct.
  const bruto = sumConfirmedBruto(pedido.lines);
  if (bruto > 0) {
    const pct = readDiscountPct(pedido);
    const neto = bruto * (1 - pct / 100);
    if (!Number.isFinite(neto)) return null;
    return Math.round(neto);
  }
  // 3. Fallback legacy: pedidos pre-stage='confirmed' sin líneas.
  if (Number.isFinite(pedido.netAmountArs) && pedido.netAmountArs > 0) {
    return pedido.netAmountArs;
  }
  if (Number.isFinite(pedido.subtotalArs) && pedido.subtotalArs > 0) {
    return pedido.subtotalArs;
  }
  return null;
}
