// @ts-check
/**
 * v8 (2026-11-17, §E1 Reparto dep 12) — Buckets de tránsito dep 12.
 *
 * Shape v8 añade sub-totales de tránsito a asignadas + confirmadasSinFacturar:
 *   - asignadas.totalTransito: suma de ASIG con `line.enTransito === true`.
 *   - asignadas.totalFisico:   asignadas.total - totalTransito.
 *   - confirmadasSinFacturar.totalTransito / totalFisico: idem.
 *   - libreTransito: max(0, transitoDep12 - asignadas.totalTransito - confirmadas.totalTransito).
 *
 * El total existente `.total` sigue sumando TODO (físico + tránsito). Los
 * nuevos sub-totales son informativos. `reservadasTotal` cuenta SOLO la
 * porción físico (excluye enTransito). `utilizablePara` sigue usando `libre`
 * (físico) — NO cuenta `libreTransito` como consumible (regla E1).
 *
 * v1392 (2026-10-21, §40) — El back order NO reserva stock. Reservan solo
 * ASIG + confirmed + waitlistCpst. Reparto abierto es informativo.
 *
 * v1391 base: una sola fuente de verdad (§39).
 *
 * TTL centralizado — reusa lineReservesStock():
 *   - BO: §37 red seguridad 90d — PARA FILTRADO DEL BUCKET (cola + forecast).
 *   - confirmed: §38 soft 7d + hard cap 60d.
 *   - ASIG: 7d.
 *   - ASIG + enTransito: ignora soft 7d, hard cap 30d (§E1).
 *   - confirmed + enTransito: ignora soft 7d, hard cap 60d (§E1).
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
 * @typedef {Object} AsigDetalleItem
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {string} cardCode
 * @property {string} clientName
 * @property {string|null} asigAt
 * @property {number} qtyNominal
 * @property {number} qtyEntregable  Interno — usado por CF revertSobreAsignadas.
 * @property {number} sobreAsignada  Interno — post-reconcile siempre 0.
 */

/**
 * v1403 §40.11: eliminados `totalEntregable` + `totalSobreAsignada` del shape
 * público. La CF `revertSobreAsignadas` revierte el excedente a BO
 * proactivamente en cada tick, por lo que `asignadas.total === entregable`.
 *
 * Los campos `qtyEntregable` + `sobreAsignada` en `detalle[]` se preservan
 * como uso INTERNO de la CF reconcile — post-reconcile son siempre 0 para
 * líneas vigentes. No usar en UI; el modal Stock Asignado ya los ignora.
 *
 * v8 §E1: agregados sub-totales `totalFisico` + `totalTransito`.
 *   - `total` = `totalFisico + totalTransito` (nominal unificado, compat).
 *   - `totalTransito` solo contabiliza líneas con `line.enTransito === true`.
 *   - `detalle[]` incluye SOLO líneas físico (enTransito queda fuera, no
 *     consume dep 11 — el FIFO interno es exclusivamente contra físico).
 *
 * @typedef {Object} AsignadasBucket
 * @property {number} total  Total nominal (físico + tránsito).
 * @property {number} totalFisico  v8 §E1: ASIG sin enTransito.
 * @property {number} totalTransito  v8 §E1: ASIG con enTransito=true.
 * @property {PorClienteItem[]} porCliente
 * @property {AsigDetalleItem[]} detalle  FIFO por asigAt ASC — solo físico.
 */

/**
 * v8 §E1: bucket de confirmadas con sub-totales físico/tránsito.
 * @typedef {Object} ConfirmadasBucket
 * @property {number} total  Total nominal (físico + tránsito).
 * @property {number} totalFisico  v8 §E1: confirmed sin enTransito.
 * @property {number} totalTransito  v8 §E1: confirmed con enTransito=true.
 * @property {PorClienteItem[]} porCliente
 */

/**
 * @typedef {Object} StockBreakdown
 * @property {string} sku
 * @property {number} fisicoDep11
 * @property {number} transitoDep12
 * @property {number} libreTransito  v8 §E1: max(0, transitoDep12 - asigTransito - confTransito).
 * @property {BucketTotal} backorderApp  Cola BO con TTL §37 90d. NO reserva (v1392).
 * @property {ConfirmadasBucket} confirmadasSinFacturar  Reserva (TTL §38). v8 §E1: sub-totales físico/tránsito.
 * @property {AsignadasBucket} asignadas  Reserva (TTL 7d) + FIFO entregable (§40.3 v1395). v8 §E1: sub-totales físico/tránsito.
 * @property {BucketTotal} waitlistCpst  Reserva (sin TTL).
 * @property {{qty:number, repartoId:string|null, status:string|null}} repartoAbierto  v1392 informativo, NO reserva.
 * @property {number} reservadasTotal  v8 §E1: reservas contra físico (excluye tránsito). = asigFisico + confFisico, capped por fisicoDep11.
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
  libreTransito: 'Libre en tránsito',
  pendienteReparto: 'Pendientes de reparto',
});

/**
 * @param {string} sku
 * @param {StockBreakdownDeps} deps
 * @param {{now?: number}} [opts]
 * @returns {StockBreakdown}
 */
export function getStockBreakdown(sku, deps, opts) {
  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now();
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
  // v1400 §40.8: buckets stale eliminados — demandaSapSinCubrir removido.

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

  /**
   * v1395 §40.3: raw ASIG + confirmed lines capturadas con asigAt/confirmedAt
   * para FIFO (confirmed-first, ASIG después). Más viejas consumen físico primero.
   * v8 §E1: incluye `enTransito` para split físico vs tránsito.
   * @type {Array<{pedidoId:string, lineIndex:number, cardCode:string, clientName:string, asigAt:string|null, qtyNominal:number, enTransito:boolean}>}
   */
  const asigRaw = [];
  /** @type {Array<{confirmedAt:string|null, qtyNominal:number, enTransito:boolean}>} */
  const confirmedRaw = [];
  // v8 §E1: sub-totales de tránsito (ASIG/confirmed con line.enTransito=true).
  let asigTotalTransito = 0;
  let confTotalTransito = 0;

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
          // v8 §E1: separar lineas tránsito.
          const _enTransito = l.enTransito === true;
          // v1395 §40.3: capturo raw para FIFO distribution (solo físico).
          if (st === 'ASIG') {
            if (_enTransito) {
              asigTotalTransito += qo;
            } else {
              asigRaw.push({
                pedidoId: String(p._fsId || p.id || ''),
                lineIndex: i,
                cardCode: String(p.clientCardCode || ''),
                clientName: String(p.clientName || ''),
                asigAt: l.asigAt || null,
                qtyNominal: qo,
                enTransito: false,
              });
            }
          } else if (st === 'confirmed') {
            if (_enTransito) {
              confTotalTransito += qo;
            } else {
              confirmedRaw.push({
                confirmedAt: p.confirmedAt || null,
                qtyNominal: qo,
                enTransito: false,
              });
            }
          }
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
  const confirmadasBase = _toBucket(buckets.confirmed);
  const asignadasBase = _toBucket(buckets.ASIG);
  const waitlistCpst = _toBucket(bucketWaitlist);
  // v8 §E1: wrap confirmadas con sub-totales físico/tránsito.
  /** @type {ConfirmadasBucket} */
  const confirmadasSinFacturar = {
    total: confirmadasBase.total,
    totalFisico: Math.max(0, confirmadasBase.total - confTotalTransito),
    totalTransito: confTotalTransito,
    porCliente: confirmadasBase.porCliente,
  };

  // v1395 §40.3: FIFO distribution por asigAt ASC. Confirmed consume físico
  // primero (más viejas), después ASIG. Lo que queda sin físico es sobre-asignado.
  const _tsOrInf = (/** @type {string|null} */ iso) => {
    if (!iso) return Number.POSITIVE_INFINITY;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  confirmedRaw.sort((a, b) => _tsOrInf(a.confirmedAt) - _tsOrInf(b.confirmedAt));
  let fisicoRestante = fisicoDep11;
  // Confirmed consume primero (sin tracking por ahora — solo descuenta físico).
  for (const c of confirmedRaw) {
    const take = Math.min(c.qtyNominal, Math.max(0, fisicoRestante));
    fisicoRestante -= take;
  }
  // ASIG FIFO por asigAt ASC. Nulos al final.
  asigRaw.sort((a, b) => _tsOrInf(a.asigAt) - _tsOrInf(b.asigAt));
  /** @type {AsigDetalleItem[]} */
  const asigDetalle = [];
  let asigTotalEntregable = 0;
  let asigTotalSobre = 0;
  for (const a of asigRaw) {
    const entregable = Math.min(a.qtyNominal, Math.max(0, fisicoRestante));
    const sobre = a.qtyNominal - entregable;
    fisicoRestante -= entregable;
    asigDetalle.push({
      pedidoId: a.pedidoId,
      lineIndex: a.lineIndex,
      cardCode: a.cardCode,
      clientName: a.clientName,
      asigAt: a.asigAt,
      qtyNominal: a.qtyNominal,
      qtyEntregable: entregable,
      sobreAsignada: sobre,
    });
    asigTotalEntregable += entregable;
    asigTotalSobre += sobre;
  }
  /** @type {AsignadasBucket} */
  const asignadas = {
    total: asignadasBase.total,
    // v8 §E1: sub-totales físico/tránsito. asignadasBase.total ya incluye
    // tanto físico (asigRaw) como tránsito (asigTotalTransito acumulado aparte),
    // porque _push se llama para TODAS las líneas que reservan.
    totalFisico: Math.max(0, asignadasBase.total - asigTotalTransito),
    totalTransito: asigTotalTransito,
    porCliente: asignadasBase.porCliente,
    detalle: asigDetalle,
  };

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
  // v1394 §40.2: cap por físico.
  // v8 §E1: reservadasTotal cuenta SOLO la porción físico (excluye enTransito).
  // Las líneas enTransito reservan contra dep 12 (libreTransito), no contra dep 11.
  // Precedente: BENGOCHEA 597151 (2026-10-21) ASIG 6 con fisico 2 → muestra 2.
  const reservasNominales = confirmadasSinFacturar.totalFisico + asignadas.totalFisico;
  const reservadasTotal = Math.min(reservasNominales, fisicoDep11);
  const libre = Math.max(0, fisicoDep11 - reservadasTotal);
  // v8 §E1: libreTransito paralelo contra dep 12.
  const reservasTransito = confirmadasSinFacturar.totalTransito + asignadas.totalTransito;
  const reservadasTransitoCap = Math.min(reservasTransito, transitoDep12);
  const libreTransito = Math.max(0, transitoDep12 - reservadasTransitoCap);

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
    libreTransito, // v8 §E1
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
    _version: 8,
  };
}
