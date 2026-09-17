// @ts-check
/**
 * v701 (2026-08-28): Stock realmente disponible para vender.
 *
 * Contexto: Mariano decidio 2026-08-28 que la app sea dueña del stock. Al
 * enviar una SQ a SAP, esas unidades quedan comprometidas y no deben
 * ofrecerse al siguiente vendedor. Idem para BO/ASIG open: son demanda
 * pendiente que reservan stock futuro.
 *
 * Fórmula:
 *   disponible_real(sku) =
 *     max(0, stockFisico(sku) - Σ qtyOpen de todas las lineas en pedidos-app
 *            open con state IN ('confirmed', 'BO', 'ASIG'))
 *
 * Dedup: cada linea del pedido cuenta una sola vez (por indice). Si el mismo
 * cliente pide el mismo SKU en 2 pedidos-app distintos (dups heredados de
 * SAP), cuentan las 2 lineas — son 2 compromisos separados. Si un pedido
 * tiene 2 lineas con el mismo SKU (split v600: confirmed + BO), cuentan
 * ambas — son la misma demanda pero cada linea reserva su qty.
 *
 * Excluye:
 * - Pedidos con closedAt != null (ya cerrados)
 * - Lineas con state IN ('invoiced', 'cancelled', 'recycled', 'legacy')
 * - Lineas con qtyOpen <= 0
 */

/**
 * @typedef {Object} PedidoLike
 * @property {any} [closedAt]
 * @property {Array<any>} [lines]
 * @property {string} [clientCardCode]
 * @property {string} [_fsId]
 * @property {string} [_id]
 */

/**
 * @typedef {Object} StockRealDeps
 * @property {(sku: string) => number} getStockFisico Lookup del stock fisico (dep 11).
 * @property {Array<PedidoLike>} pedidos Lista de pedidos-app (typicamente globalPedidos).
 */

/**
 * Estados que reservan stock. `confirmed` fue enviado a SAP pero aun no
 * facturado; `BO` espera stock futuro; `ASIG` ya tiene stock reservado FIFO.
 */
const STATES_QUE_RESERVAN = new Set(['confirmed', 'BO', 'ASIG']);

// v957/v959: constantes para expiracion de reserva.
const RESERVA_TTL_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * v957 (Fase 2, 2026-09-16): decide si una linea reserva stock.
 * v959 (2026-09-16): agrega expiracion 15 dias desde asigAt para ASIG.
 * v963 (2026-09-17): agrega expiracion 15 dias desde confirmedAt/asigAt para
 *   confirmed. Rationale: si Santi no factura una SQ en 15d, el stock debe
 *   quedar disponible para otros pedidos (evita deuda tecnica de reservas
 *   olvidadas). La SQ sigue viva en SAP — solo la app deja de considerarla
 *   como reserva. Panel admin muestra las expiradas para revision manual.
 *   NO se aplica regla tier (P/A/B/C) porque 100% de clientes tienen
 *   cliTipo='unknown' al 2026-09-17 — el tier no discriminaria nada.
 * v969 (2026-09-17): agrega expiracion 15 dias desde pedido.createdAt para
 *   BO. Rationale: BOs olvidados (pedido de hace >15d que nunca llego stock)
 *   deben dejar de reservar demanda futura — si el vendedor no lo actualizo
 *   ni cancelo, probablemente el cliente ya no lo espera. La linea sigue
 *   viva en la app pero deja de bloquear stock para pedidos nuevos.
 *
 * Reglas:
 * - state='BO' con pedido.createdAt > 15d atras: no reserva (expirada)
 * - state='BO' con createdAt <= 15d o sin createdAt: reserva
 * - state='confirmed' con confirmedAt > 15d atras: no reserva (expirada)
 * - state='confirmed' con confirmedAt <= 15d o sin confirmedAt: reserva
 * - state='ASIG' con asigReserva===false: no reserva (cliente B/C)
 * - state='ASIG' con asigAt > 15d atras: no reserva (expirada)
 * - state='ASIG' con asigReserva!=false y asigAt<=15d o sin asigAt: reserva
 * - cualquier otro state: no reserva
 *
 * @param {any} line
 * @param {number} [nowMs] timestamp ms, inyectable para tests. Default Date.now().
 * @param {any} [pedido] pedido padre — para leer confirmedAt/createdAt
 *   (que viven en el pedido, no en la linea). Opcional para backwards-compat
 *   con callers que solo pasan la linea. Sin pedido, ni confirmed ni BO
 *   expiran nunca (comportamiento pre-v963/v969).
 * @returns {boolean}
 */
export function lineReservesStock(line, nowMs, pedido) {
  if (!line) return false;
  const state = line.state;
  if (state === 'BO') {
    // v969: expiracion 15d desde pedido.createdAt (BOs olvidados dejan de
    // reservar). Si el caller no pasa pedido o el pedido no tiene createdAt,
    // BO nunca expira (comportamiento pre-v969).
    if (pedido && pedido.createdAt) {
      const createdAtMs = new Date(pedido.createdAt).getTime();
      if (Number.isFinite(createdAtMs)) {
        const now = typeof nowMs === 'number' ? nowMs : Date.now();
        const ageDays = (now - createdAtMs) / DAY_MS;
        if (ageDays > RESERVA_TTL_DAYS) return false;
      }
    }
    return true;
  }
  if (state === 'confirmed') {
    // v963: expiracion 15d desde confirmedAt del pedido (no de la linea).
    // Si el caller no pasa pedido, mantener comportamiento pre-v963 (siempre reserva).
    if (pedido && pedido.confirmedAt) {
      const confirmedAtMs = new Date(pedido.confirmedAt).getTime();
      if (Number.isFinite(confirmedAtMs)) {
        const now = typeof nowMs === 'number' ? nowMs : Date.now();
        const ageDays = (now - confirmedAtMs) / DAY_MS;
        if (ageDays > RESERVA_TTL_DAYS) return false;
      }
    }
    return true;
  }
  if (state === 'ASIG') {
    if (line.asigReserva === false) return false;
    // v959: expiracion 15 dias desde asigAt.
    if (line.asigAt) {
      const asigAtMs = new Date(line.asigAt).getTime();
      if (Number.isFinite(asigAtMs)) {
        const now = typeof nowMs === 'number' ? nowMs : Date.now();
        const ageDays = (now - asigAtMs) / DAY_MS;
        if (ageDays > RESERVA_TTL_DAYS) return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Calcula el stock realmente disponible para un SKU dado.
 *
 * @param {string} sku
 * @param {StockRealDeps} deps
 * @param {{now?: number}} [opts] - v959: now inyectable para tests.
 * @returns {number} Stock disponible >= 0.
 */
export function getStockRealmenteDisponible(sku, deps, opts) {
  const skuUp = String(sku || '').toUpperCase();
  if (!skuUp) return 0;
  const fisico = Number(deps.getStockFisico(skuUp)) || 0;
  if (fisico <= 0) return 0;

  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now();
  let comprometido = 0;
  const pedidos = Array.isArray(deps.pedidos) ? deps.pedidos : [];
  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      // v957/v959/v963: skipear ASIG sin reserva/expirada + confirmed >15d expirada.
      if (!lineReservesStock(l, now, p)) continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      comprometido += qtyOpen;
    }
  }

  return Math.max(0, fisico - comprometido);
}

/**
 * Calcula el desglose por cliente: cuanto del stock esta reservado por ESTE
 * cliente vs por OTROS. Para la UI del modal Pedido en Espera donde el
 * "libre para la venta" se calcula desde la perspectiva del cliente actual:
 * las reservas del mismo cliente NO cuentan como "ocupando stock ajeno".
 *
 * v713.1 (2026-08-28): pedido de Mariano — si REBORN tiene 6u ASIG y pide
 * 2 mas, quiero ver:
 *   - reservadasPorCliente: 6 (las de el mismo)
 *   - libreParaCliente: 6 (fisico - reservas de OTROS = 6 - 0 = 6)
 *   - Pero al confirmar, el disponible REAL sigue siendo 0 (fisico - TODAS
 *     las reservas = 6 - 6 = 0). Sus 2u nuevas caen en BO.
 *
 * @param {string} sku
 * @param {string} cardCode CardCode del cliente actual
 * @param {StockRealDeps} deps
 * @param {{now?: number}} [opts] - v959: now inyectable para tests.
 * @returns {{fisico: number, reservadasPorCliente: number, reservadasPorOtros: number, libreParaCliente: number, disponibleReal: number, yaEnOtroPedido: {pedidoId: string, qtyOpen: number, state: string}[]}}
 */
export function getStockPorCliente(sku, cardCode, deps, opts) {
  const skuUp = String(sku || '').toUpperCase();
  const ccUp = String(cardCode || '').trim();
  const fisico = skuUp ? Number(deps.getStockFisico(skuUp)) || 0 : 0;
  const empty = {
    fisico,
    reservadasPorCliente: 0,
    reservadasPorOtros: 0,
    libreParaCliente: fisico,
    disponibleReal: fisico,
    yaEnOtroPedido: [],
  };
  if (!skuUp || !ccUp) return empty;

  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now();
  let reservadasPorCliente = 0;
  let reservadasPorOtros = 0;
  const yaEnOtroPedido = [];
  const pedidos = Array.isArray(deps.pedidos) ? deps.pedidos : [];
  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    const pCC = String(p.clientCardCode || '').trim();
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      // v957/v959/v963: skipear ASIG sin reserva/expirada + confirmed >15d expirada.
      if (!lineReservesStock(l, now, p)) continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      if (pCC === ccUp) {
        reservadasPorCliente += qtyOpen;
        yaEnOtroPedido.push({
          pedidoId: p._fsId || p._id || '',
          qtyOpen,
          state: l.state,
        });
      } else {
        reservadasPorOtros += qtyOpen;
      }
    }
  }
  return {
    fisico,
    reservadasPorCliente,
    reservadasPorOtros,
    libreParaCliente: Math.max(0, fisico - reservadasPorOtros),
    disponibleReal: Math.max(0, fisico - reservadasPorCliente - reservadasPorOtros),
    yaEnOtroPedido,
  };
}

// v809 (2026-09-04, Loop iter 6): memoization de getStockPorCliente.
// _renderWaitlistCard llama esta fn en un loop por SKU (hasta 30-50 por
// cliente) y en cada tick de UI (edit qty, agregar SKU). Sin cache, cada
// call itera todo globalPedidos (500+ pedidos en clientes grandes) → 15-25k
// ops/frame. Bench iter 1 midio 142 µs/call, no cache — target −60% en
// repeat calls al mismo (sku, cardCode).
//
// Estrategia:
// - WeakMap keyed por pedidos array ref. Cuando globalPedidos se reemplaza
//   por nueva ref (Firestore onSnapshot), el WeakMap se GC → invalidacion
//   automatica.
// - Sub-cache por key = sku|cardCode|fisico. Incluir fisico invalida al
//   cambiar stock snapshot (fisico viene de deps.getStockFisico).
// - TTL fallback 5s: safety net contra mutacion in-place de globalPedidos
//   (v786 optimistic update lo hace). Entries con edad > 5s se descartan.
//
// Test unit: cache hit al 2do call con mismos args, miss al cambiar
// cardCode/sku/fisico, invalidacion al cambiar pedidos ref.
/** @type {WeakMap<object, Map<string, {result: any, ts: number}>>} */
const _stockPorClienteMemo = new WeakMap();
const MEMO_TTL_MS = 5000;

/**
 * Version memoizada de getStockPorCliente. Misma API + cache.
 *
 * @param {string} sku
 * @param {string} cardCode
 * @param {StockRealDeps} deps
 * @param {{now?: number}} [opts]
 * @returns {ReturnType<typeof getStockPorCliente>}
 */
export function getStockPorClienteMemo(sku, cardCode, deps, opts) {
  const pedidos = deps && deps.pedidos;
  // Si pedidos no es un array/obj (edge case bootstrap), fallback sin cache.
  if (!pedidos || typeof pedidos !== 'object') {
    return getStockPorCliente(sku, cardCode, deps, opts);
  }
  const skuUp = String(sku || '').toUpperCase();
  const ccUp = String(cardCode || '').trim();
  const fisico =
    skuUp && deps && typeof deps.getStockFisico === 'function'
      ? Number(deps.getStockFisico(skuUp)) || 0
      : 0;
  const key = skuUp + '|' + ccUp + '|' + fisico;

  let bucket = _stockPorClienteMemo.get(pedidos);
  const now = Date.now();
  if (bucket) {
    const cached = bucket.get(key);
    if (cached && now - cached.ts < MEMO_TTL_MS) {
      return cached.result;
    }
  } else {
    bucket = new Map();
    _stockPorClienteMemo.set(pedidos, bucket);
  }
  const result = getStockPorCliente(sku, cardCode, deps, opts);
  bucket.set(key, { result, ts: now });
  return result;
}

/**
 * Reset del cache — solo para tests.
 */
export function _resetStockPorClienteMemo() {
  // WeakMap no tiene clear(). Reasignamos, pero como es const, en su lugar
  // borramos todas las entries manualmente via API publica: no hay API para
  // enumerar WeakMap. Workaround: crear nueva WeakMap y reasignar via closure
  // no funciona con const. Solucion: exponemos el store y usamos delete + set
  // vacio en cada key conocida. Para tests, tipicamente el test pasa nuevos
  // pedidos arrays cada vez, asi que el WeakMap ni se toca — solo hace falta
  // resetear cuando el test reusa el mismo pedidos array a proposito.
  // Aqui no hacemos nada — los tests que necesiten reset deben usar arrays
  // distintos por escenario. Esta fn queda como marker para docs.
}

/**
 * Calcula el desglose (fisico, comprometido, real) para mostrar en UI.
 *
 * @param {string} sku
 * @param {StockRealDeps} deps
 * @param {{now?: number}} [opts] - v959: now inyectable para tests.
 * @returns {{fisico: number, comprometido: number, real: number, breakdown: {confirmed: number, BO: number, ASIG: number}}}
 */
export function getStockDesglose(sku, deps, opts) {
  const skuUp = String(sku || '').toUpperCase();
  const fisico = skuUp ? Number(deps.getStockFisico(skuUp)) || 0 : 0;
  const breakdown = { confirmed: 0, BO: 0, ASIG: 0 };
  if (!skuUp) return { fisico: 0, comprometido: 0, real: 0, breakdown };

  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now();
  const pedidos = Array.isArray(deps.pedidos) ? deps.pedidos : [];
  for (const p of pedidos) {
    if (!p || p.closedAt) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      const st = /** @type {'confirmed'|'BO'|'ASIG'} */ (l.state);
      // v957/v959/v963: skipear ASIG sin reserva/expirada + confirmed >15d expirada.
      if (!lineReservesStock(l, now, p)) continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      breakdown[st] = (breakdown[st] || 0) + qtyOpen;
    }
  }
  const comprometido = breakdown.confirmed + breakdown.BO + breakdown.ASIG;
  return {
    fisico,
    comprometido,
    real: Math.max(0, fisico - comprometido),
    breakdown,
  };
}
