// @ts-check
/**
 * v1392 (2026-10-21, §40 reemplaza §34) — El back order NO reserva stock.
 * Reservan solo ASIG + confirmed + waitlistCpst. Reparto abierto es
 * informativo (bucket repartoAbierto no suma a reservadasTotal).
 *
 * v1391 base: una sola fuente de verdad.
 *
 * Regla CLAUDE.md §39: ninguna pantalla calcula disponibilidad por su
 * cuenta. Toda lectura pasa por getStockBreakdown(sku, deps, opts).
 *
 * TTL centralizado — reusa lineReservesStock():
 *   - BO: §37 red seguridad 90d — PARA FILTRADO DEL BUCKET (cola + forecast).
 *     NO para reservas (lineReservesStock('BO') devuelve false en v1392).
 *   - confirmed: §38 soft 7d + hard cap 60d. §36 guard sin confirmedAt.
 *   - ASIG: 7d.
 *
 * `demandaSapSinCubrir` — DEPRECATED en v1392. Siempre null. Eliminar en v1393.
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
 * @property {{total:number, porCliente:PorClienteItem[]}|null} demandaSapSinCubrir  DEPRECATED v1392
 * @property {BucketTotal} backorderApp  Cola BO con TTL §37 90d. NO reserva (v1392).
 * @property {BucketTotal} confirmadasSinFacturar  Reserva (TTL §38).
 * @property {BucketTotal} asignadas  Reserva (TTL 7d).
 * @property {BucketTotal} waitlistCpst  Reserva (sin TTL).
 * @property {{qty:number, repartoId:string|null, status:string|null}} repartoAbierto  v1392 informativo, NO reserva.
 * @property {number} reservadasTotal  = asignadas + confirmed + waitlistCpst (SIN BO, SIN repartoAbierto).
 * @property {number} libre
 * @property {(cardCode:string) => number} utilizablePara
 * @property {{qty:number, repartoId:string|null}} pendienteReparto  Alias de repartoAbierto (compat v1391).
 * @property {number} _version
 */

export const STOCK_LABELS = Object.freeze({
  backorderApp: 'Back order (app)',
  confirmadasSinFacturar: 'Confirmadas sin facturar',
  asignadas: 'Asignadas',
  waitlistCpst: 'En lista de espera (CPST)',
  repartoAbierto: 'En reparto pendiente (no reserva)',
  reservadasTotal: 'Reservadas',
  fisicoDep11: 'Stock físico (dep 11)',
  transitoDep12: 'En tránsito (dep 12)',
  libre: 'Libre para la venta',
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

  /**
   * @param {Map<string, PorClienteItem>} map
   * @param {string|undefined} cardCode
   * @param {string|undefined} clientName
   * @param {number} qty
   * @param {string} pedidoId
   * @param {number} lineIndex
   */
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
      if (st === 'BO' || st === 'confirmed' || st === 'ASIG') {
        // v1392 §40: BO va al bucket backorderApp filtrado por TTL §37 90d
        //            (para cola + forecast), pero lineReservesStock('BO')=false.
        // Confirmed/ASIG usan lineReservesStock como filtro de reserva real.
        let incluir = false;
        if (st === 'BO') {
          // TTL §37 90d sobre createdAt — para el bucket, no para reserva.
          if (p.createdAt) {
            const createdMs = typeof p.createdAt === 'string' ? Date.parse(p.createdAt) : null;
            if (createdMs !== null && (now - createdMs) / (24 * 60 * 60 * 1000) <= 90) {
              incluir = true;
            } else if (createdMs === null) {
              incluir = true; // edge compat
            }
          } else {
            incluir = true;
          }
        } else {
          incluir = lineReservesStock(l, now, p);
        }
        if (incluir) {
          const _map = /** @type {Map<string, PorClienteItem>} */ (
            buckets[/** @type {'BO'|'confirmed'|'ASIG'} */ (st)]
          );
          _push(_map, p.clientCardCode, p.clientName, qo, p._fsId || p.id || '', i);
        }
        // stale (sin TTL) solo para BO y confirmed (DEPRECATED v1392).
        if (includeStale && (st === 'BO' || st === 'confirmed')) {
          const _staleMap = /** @type {Map<string, PorClienteItem>} */ (
            bucketsStale[/** @type {'BO'|'confirmed'} */ (st)]
          );
          _push(_staleMap, p.clientCardCode, p.clientName, qo, p._fsId || p.id || '', i);
        }
      }
    }
  }

  /** @param {Map<string, PorClienteItem>} map */
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

  // v1392 §40: repartoAbierto es INFORMATIVO (NO suma a reservadasTotal).
  // Lo único que reserva: ASIG + confirmed + waitlistCpst.
  /** @type {{qty:number, repartoId:string|null, status:string|null}} */
  let repartoAbierto = { qty: 0, repartoId: null, status: null };
  if (Array.isArray(deps.ingresosRepartoActivos)) {
    const match = deps.ingresosRepartoActivos.find(
      (r) => r && String(r.sku || '').toUpperCase() === skuUp
    );
    if (match) {
      // qty = qtyIngresada - sum(assignments ya aplicadas)
      const qtyIng = Number(match.qtyIngresada) || 0;
      const assignments = /** @type {any[]} */ (
        Array.isArray(match.assignments) ? match.assignments : []
      );
      /** @type {number} */
      let asignadoYa = 0;
      for (const a of assignments) asignadoYa += Number((a && a.qtyAsignada) || 0);
      repartoAbierto = {
        qty: Math.max(0, qtyIng - asignadoYa),
        repartoId: match._fsId || match.id || null,
        status: match.status || null,
      };
    }
  }

  // v1393 §40.1: reservadasTotal = ASIG + confirmed (SIN BO, SIN reparto, SIN waitlistCpst).
  // waitlistCpst sigue en el shape como INFORMATIVO. Es draft del VDE desde
  // Stock Asignado — la ASIG original ya reserva, contar waitlist = doble conteo.
  // Precedente: BENGOCHEA 597151 ORDEN 467 (2026-10-21) ASIG 6 + waitlist 6
  // mismo cliente/SKU → breakdown contaba 12 u reservadas con fisico 2.
  const reservadasTotal = confirmadasSinFacturar.total + asignadas.total;
  const libre = Math.max(0, fisicoDep11 - reservadasTotal);

  // demandaSapSinCubrir DEPRECATED v1392 — queda null para no romper
  // consumidores que lo lean. Eliminar del shape en v1393.
  /** @type {{total:number, porCliente:PorClienteItem[]}|null} */
  const demandaSapSinCubrir = null;

  /** @param {string} cardCode */
  const utilizablePara = (cardCode) => {
    if (!cardCode) return libre;
    const key = String(cardCode).trim();
    let reservasPropias = 0;
    // v1393 §40.1: BO no reserva + waitlistCpst no reserva (draft VDE).
    // Solo ASIG + confirmed del cliente cuentan como reserva propia.
    for (const map of [buckets.confirmed, buckets.ASIG]) {
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
    demandaSapSinCubrir, // DEPRECATED v1392 — siempre null
    backorderApp,
    confirmadasSinFacturar,
    asignadas,
    waitlistCpst,
    repartoAbierto, // v1392 informativo
    reservadasTotal,
    libre,
    utilizablePara,
    // Alias compat v1391 — mismo info que repartoAbierto.
    pendienteReparto: { qty: repartoAbierto.qty, repartoId: repartoAbierto.repartoId },
    _version: 3,
  };
}
