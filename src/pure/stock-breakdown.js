// @ts-check
/**
 * v1391 (2026-10-21) — Fuente única de verdad para el stock de un SKU.
 *
 * Regla CLAUDE.md §39: ninguna pantalla calcula disponibilidad por su
 * cuenta. Toda lectura pasa por getStockBreakdown(sku, deps, opts).
 *
 * TTL centralizado — reusa lineReservesStock() de stock-realmente-disponible.js:
 *   - BO: §37 red seguridad 90d.
 *   - confirmed: §38 soft 7d + hard cap 60d. §36 guard sin confirmedAt.
 *   - ASIG: 7d.
 *
 * `demandaSapSinCubrir` (opt-in con opts.includeStale=true): suma BO +
 * confirmed SIN TTL. Es lo que ve el Modal Backorder (fuente de verdad E0).
 */

import { lineReservesStock } from './stock-realmente-disponible.js';

/**
 * @typedef {Object} StockBreakdownDeps
 * @property {(sku:string) => number} getStockFisico Dep 11.
 * @property {(sku:string) => number} [getStockTransito] Dep 12. Default 0.
 * @property {Array<any>} pedidos globalPedidos.
 * @property {Array<any>} [waitlistEntries] CPST entries.
 * @property {Array<any>} [ingresosRepartoActivos] Docs ingresos_reparto
 *   status in [pending, in_progress]. Usado para `pendienteReparto.repartoId`.
 * @property {Object|null} [sapBackorderSnapshot] Reservado para futuro feed SAP.
 */

/**
 * @typedef {Object} PorClienteItem
 * @property {string} cardCode
 * @property {string} clientName
 * @property {number} qty
 * @property {Array<{pedidoId:string, lineIndex:number, qty:number}>} [origins]
 */

/**
 * @typedef {Object} BucketTotal
 * @property {number} total
 * @property {PorClienteItem[]} porCliente
 */

/**
 * @typedef {Object} StockBreakdown
 * @property {string} sku
 * @property {number} fisicoDep11
 * @property {number} transitoDep12
 * @property {{total:number, porCliente:PorClienteItem[]}|null} demandaSapSinCubrir
 * @property {BucketTotal} backorderApp
 * @property {BucketTotal} confirmadasSinFacturar
 * @property {BucketTotal} asignadas
 * @property {BucketTotal} waitlistCpst  // v1198+ revision_waitlist source='stock-asignado-batch'
 * @property {number} reservadasTotal
 * @property {number} libre
 * @property {(cardCode:string) => number} utilizablePara
 * @property {{qty:number, repartoId:string|null}} pendienteReparto
 * @property {number} _version
 */

export const STOCK_LABELS = Object.freeze({
  demandaSapSinCubrir: 'Demanda SAP sin cubrir',
  backorderApp: 'Back order (app)',
  confirmadasSinFacturar: 'Confirmadas sin facturar',
  asignadas: 'Asignadas',
  waitlistCpst: 'En lista de espera (CPST)',
  reservadasTotal: 'Reservadas',
  fisicoDep11: 'Stock físico (dep 11)',
  transitoDep12: 'En tránsito (dep 12)',
  libre: 'Libre para la venta',
  pendienteReparto: 'Pendientes de reparto',
});

/**
 * @param {string} sku
 * @param {StockBreakdownDeps} deps
 * @param {{now?: number, includeStale?: boolean}} [opts]
 * @returns {StockBreakdown}
 */
export function getStockBreakdown(sku, deps, opts) {
  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now();
  const includeStale = !!(opts && opts.includeStale);
  const skuUp = String(sku || '').toUpperCase();
  const fisicoDep11 = skuUp ? Number(deps.getStockFisico(skuUp)) || 0 : 0;
  const transitoDep12 =
    skuUp && typeof deps.getStockTransito === 'function'
      ? Number(deps.getStockTransito(skuUp)) || 0
      : 0;

  // Buckets vigentes (post TTL).
  const buckets = {
    BO: /** @type {Map<string, PorClienteItem>} */ (new Map()),
    confirmed: /** @type {Map<string, PorClienteItem>} */ (new Map()),
    ASIG: /** @type {Map<string, PorClienteItem>} */ (new Map()),
  };
  // Buckets stale (sin TTL) para demandaSapSinCubrir.
  const bucketsStale = {
    BO: /** @type {Map<string, PorClienteItem>} */ (new Map()),
    confirmed: /** @type {Map<string, PorClienteItem>} */ (new Map()),
  };

  const _push = (map, cardCode, clientName, qty, pedidoId, lineIndex) => {
    const key = String(cardCode || clientName || '(sin cliente)').trim() || '(sin cliente)';
    const existing = map.get(key);
    if (existing) {
      existing.qty += qty;
      if (!Array.isArray(existing.origins)) existing.origins = [];
      existing.origins.push({ pedidoId, lineIndex, qty });
    } else {
      map.set(key, {
        cardCode: String(cardCode || ''),
        clientName: String(clientName || ''),
        qty,
        origins: [{ pedidoId, lineIndex, qty }],
      });
    }
  };

  const pedidos = Array.isArray(deps.pedidos) ? deps.pedidos : [];
  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const st = l.state;
      const vig = lineReservesStock(l, now, p);
      if (st === 'BO' || st === 'confirmed' || st === 'ASIG') {
        if (vig) {
          _push(buckets[st], p.clientCardCode, p.clientName, qo, p._fsId || p.id || '', i);
        }
        // stale (sin TTL) solo para BO y confirmed (lo que ve Modal Backorder).
        if (includeStale && (st === 'BO' || st === 'confirmed')) {
          _push(bucketsStale[st], p.clientCardCode, p.clientName, qo, p._fsId || p.id || '', i);
        }
      }
    }
  }

  const _toBucket = (map) => {
    const porCliente = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
    const total = porCliente.reduce((s, c) => s + c.qty, 0);
    return { total, porCliente };
  };

  // v1198+ revision_waitlist CPST (source='stock-asignado-batch') también reserva.
  const bucketWaitlist = /** @type {Map<string, PorClienteItem>} */ (new Map());
  const waitlist = Array.isArray(deps.waitlistEntries) ? deps.waitlistEntries : [];
  for (const w of waitlist) {
    if (!w || w.source !== 'stock-asignado-batch') continue;
    const items = Array.isArray(w.items) ? w.items : [];
    for (const it of items) {
      if (!it || !it.code) continue;
      if (String(it.code).toUpperCase() !== skuUp) continue;
      const qty = Number(it.qty) || 0;
      if (qty <= 0) continue;
      _push(bucketWaitlist, w.clientCardCode, w.clientName, qty, w._id || w._fsId || '', 0);
    }
  }

  const backorderApp = _toBucket(buckets.BO);
  const confirmadasSinFacturar = _toBucket(buckets.confirmed);
  const asignadas = _toBucket(buckets.ASIG);
  const waitlistCpst = _toBucket(bucketWaitlist);
  const reservadasTotal =
    backorderApp.total + confirmadasSinFacturar.total + asignadas.total + waitlistCpst.total;
  const libre = Math.max(0, fisicoDep11 - reservadasTotal);

  // demandaSapSinCubrir: alias del concepto "demanda nominal cruda" del
  // Modal Backorder (sin TTL). Opt-in con includeStale=true.
  /** @type {{total:number, porCliente:PorClienteItem[]}|null} */
  let demandaSapSinCubrir = null;
  if (includeStale) {
    const combined = new Map();
    for (const map of [bucketsStale.BO, bucketsStale.confirmed]) {
      for (const [k, v] of map.entries()) {
        const existing = combined.get(k);
        if (existing) {
          existing.qty += v.qty;
          existing.origins = (existing.origins || []).concat(v.origins || []);
        } else {
          combined.set(k, Object.assign({}, v, { origins: (v.origins || []).slice() }));
        }
      }
    }
    const porCliente = Array.from(combined.values()).sort((a, b) => b.qty - a.qty);
    const total = porCliente.reduce((s, c) => s + c.qty, 0);
    demandaSapSinCubrir = { total, porCliente };
  }
  if (!includeStale && deps.sapBackorderSnapshot) {
    // Futuro: feed real SAP si existe. Hoy ignorado por diseño (E0 confirmó
    // que no hay fuente externa; sapBackorderSnapshot queda como extension point).
    demandaSapSinCubrir = /** @type {any} */ (deps.sapBackorderSnapshot[skuUp] || null);
  }

  // pendienteReparto: cuánto quedaría libre para repartir a BO vigentes
  // si todas las asignadas + confirmadas ya se consumieron.
  const _pendQty =
    backorderApp.total > 0
      ? Math.max(0, fisicoDep11 - asignadas.total - confirmadasSinFacturar.total)
      : 0;
  let _pendRepartoId = null;
  if (_pendQty > 0 && Array.isArray(deps.ingresosRepartoActivos)) {
    const match = deps.ingresosRepartoActivos.find(
      (r) => r && String(r.sku || '').toUpperCase() === skuUp
    );
    if (match) _pendRepartoId = match._fsId || match.id || null;
  }

  /** @param {string} cardCode */
  const utilizablePara = (cardCode) => {
    if (!cardCode) return libre;
    const key = String(cardCode).trim();
    let reservasPropias = 0;
    for (const map of [buckets.BO, buckets.confirmed, buckets.ASIG, bucketWaitlist]) {
      const own = map.get(key);
      if (own) reservasPropias += own.qty;
    }
    // §33/§35: la reserva propia NO cuenta como "ajeno comprometido".
    // utilizablePara = min(fisico, libre + reservas propias del cliente).
    return Math.min(fisicoDep11, libre + reservasPropias);
  };

  return {
    sku: skuUp,
    fisicoDep11,
    transitoDep12,
    demandaSapSinCubrir,
    backorderApp,
    confirmadasSinFacturar,
    asignadas,
    waitlistCpst,
    reservadasTotal,
    libre,
    utilizablePara,
    pendienteReparto: { qty: _pendQty, repartoId: _pendRepartoId },
    _version: 1,
  };
}
