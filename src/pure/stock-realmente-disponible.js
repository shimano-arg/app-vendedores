// @ts-check
import { getStockBreakdown } from './stock-breakdown.js';

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
 * @typedef {Object} WaitlistEntryLike
 * @property {string} [source] Origen del entry — solo 'stock-asignado-batch' (CPST) reserva stock.
 * @property {string} [clientCardCode] CardCode SAP del cliente (para getStockPorCliente).
 * @property {Array<{code?: string, qty?: number}>} [items] Items del waitlist.
 *
 * @typedef {Object} StockRealDeps
 * @property {(sku: string) => number} getStockFisico Lookup del stock fisico (dep 11).
 * @property {Array<PedidoLike>} pedidos Lista de pedidos-app (typicamente globalPedidos).
 * @property {Array<WaitlistEntryLike>} [waitlistEntries] Opcional, v1198: entries de
 *   revision_waitlist. Solo los que tienen source='stock-asignado-batch' (CPST)
 *   reservan stock — las items del CPST ya estaban reservadas como ASIG para el
 *   cliente, y pasar al waitlist no debe liberarlas (sino otro VDE las robaria).
 *   Entries normales (VDE carga pedido manual) NO reservan — son pre-carga.
 */

/**
 * Estados que reservan stock. `confirmed` fue enviado a SAP pero aun no
 * facturado; `BO` espera stock futuro; `ASIG` ya tiene stock reservado FIFO.
 */
const _STATES_QUE_RESERVAN = new Set(['confirmed', 'BO', 'ASIG']);

// v957/v959: constantes para expiracion de reserva.
// v1198 (2026-10-08): bajado 15 -> 7 dias por pedido Mariano. Aplica ASIG + confirmed.
// v1388 (2026-10-21): BO NO vence a los 7 dias (regla CLAUDE.md §37). Hard cap
// de 90 dias como red de seguridad. confirmed sigue con 7 dias pero con hard
// cap de 60 dias sobre confirmedAt (regla §38). ASIG no cambia.
const RESERVA_TTL_DAYS = 7;
const _BO_TTL_DAYS = 90; // §37: BO no vence a 7d, red seguridad a 90d.
const CONFIRMED_HARD_CAP_DAYS = 60; // §38: aunque confirmedAt reciente, 60d es el tope duro.
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Normaliza un valor a timestamp ms. Acepta:
 *   - null/undefined → null
 *   - number → tal cual
 *   - Date → .getTime()
 *   - Firestore Timestamp (toMillis()) → .toMillis()
 *   - plain {seconds, nanoseconds?} → seconds*1000 + nanoseconds/1e6
 *   - string ISO → Date.parse (null si NaN)
 *   - cualquier otro → null
 *
 * Bug reportado por auditor (2026-10-02): `new Date(firestoreTimestamp).getTime()`
 * devuelve NaN, Number.isFinite(NaN)===false, el bloque de expiracion se saltea
 * silenciosamente y la fn se comporta como "reserva para siempre".
 *
 * @param {any} value
 * @returns {number|null}
 */
function toMillisSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      try {
        const t = value.toMillis();
        return typeof t === 'number' && Number.isFinite(t) ? t : null;
      } catch (_e) {
        return null;
      }
    }
    if (typeof value.seconds === 'number') {
      const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
      return value.seconds * 1000 + nanos / 1e6;
    }
    return null;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

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
 * - state='confirmed' con asigReserva===false: no reserva (v1269: toggle admin desde modal Stock Asignado)
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
    // v1392 (2026-10-21, CLAUDE.md §40 reemplaza §34): BO NO reserva stock.
    // El back order es cola de clientes esperando reparto + base de forecast.
    // Reservan solo ASIG + confirmed + waitlistCpst.
    // El TTL §37 90d sobre createdAt se mantiene en el bucket backorderApp
    // (para filtrar cola y forecast) pero NO afecta reservas.
    return false;
  }
  if (state === 'confirmed') {
    // v1269 (2026-10-14): asigReserva=false libera reserva tambien para
    // confirmed. El toggle del modal Stock Asignado permite al admin liberar
    // una row ya enviada a SAP sin esperar facturacion ni cancelar el pedido.
    // Explicito con 0/false (SAP serializa booleanos como 0/1; `0===false` es
    // false en JS). undefined/null mantienen "default true" historicamente.
    if (line.asigReserva === false || line.asigReserva === 0) return false;
    // v963: expiracion 15d (bajada a 7d en v1198) desde confirmedAt del pedido.
    // v1384 (2026-10-21): guard defensivo — si no hay NINGUNA fecha de
    // referencia (confirmedAt faltante y pedido indefinido), tratar la linea
    // como data corrupta y NO reservar. En prod hoy (2026-10-21) este caso
    // no existe (verificado con grep sobre 542 SKUs = 0 hits), pero el guard
    // previene bugs futuros si entra data corrupta. CLAUDE.md §36.
    if (!pedido || !pedido.confirmedAt) return false;
    const confirmedAtMs = toMillisSafe(pedido.confirmedAt);
    if (confirmedAtMs === null) return false;
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    const ageDays = (now - confirmedAtMs) / DAY_MS;
    if (ageDays > RESERVA_TTL_DAYS) return false;
    // v1388 (2026-10-21, CLAUDE.md §38): hard cap 60d como red de seguridad
    // sobre confirmedAt (incluso si asigReserva=true). Si una SQ sigue sin
    // facturar a los 60d, no reserva aunque el TTL soft (7d) este configurable.
    // En practica RESERVA_TTL_DAYS <= CONFIRMED_HARD_CAP_DAYS => el check de
    // arriba ya corta; este cap vive por si en el futuro se sube el TTL soft.
    if (ageDays > CONFIRMED_HARD_CAP_DAYS) return false;
    return true;
  }
  if (state === 'ASIG') {
    // Bug fix auditor 2026-10-02: SAP/legacy serializa booleanos como 0/1
    // enteros. `0 === false` es false en JS, por lo que el guard previo
    // (`asigReserva === false`) no cachaba el entero 0 → la linea reservaba
    // stock cuando no debia. Explicito con ambos valores; NO usamos
    // `!line.asigReserva` porque undefined/null significa "default true"
    // historicamente.
    if (line.asigReserva === false || line.asigReserva === 0) return false;
    // v959: expiracion 15 dias desde asigAt.
    if (line.asigAt) {
      const asigAtMs = toMillisSafe(line.asigAt);
      if (asigAtMs !== null) {
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
 * v1391 (2026-10-21, §39): wrapper fino sobre getStockBreakdown.
 * Preserva el shape histórico (number). Lógica dentro: libre del breakdown.
 *
 * @param {string} sku
 * @param {StockRealDeps} deps
 * @param {{now?: number}} [opts] - v959: now inyectable para tests.
 * @returns {number} Stock disponible >= 0.
 */
export function getStockRealmenteDisponible(sku, deps, opts) {
  return getStockBreakdown(sku, deps, opts).libre;
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
 * v1391 (2026-10-21, §39): wrapper sobre getStockBreakdown. Preserva el
 * shape histórico {fisico, reservadasPorCliente, reservadasPorOtros, ...}
 * mapeado desde los buckets porCliente del breakdown.
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
  const b = getStockBreakdown(skuUp, deps, opts);
  const fisico = b.fisicoDep11;
  if (!skuUp || !ccUp) {
    return {
      fisico,
      reservadasPorCliente: 0,
      reservadasPorOtros: 0,
      libreParaCliente: fisico,
      disponibleReal: fisico,
      yaEnOtroPedido: [],
    };
  }
  let reservadasPorCliente = 0;
  let reservadasPorOtros = 0;
  const yaEnOtroPedido = [];
  // v1392 §40: BO NO reserva, no cuenta como "reserva ajena" ni propia.
  // Las reservas son solo confirmed + ASIG + waitlistCpst.
  const buckets = [
    { bk: b.confirmadasSinFacturar, state: 'confirmed' },
    { bk: b.asignadas, state: 'ASIG' },
    { bk: b.waitlistCpst, state: 'WAITLIST_CPST' },
  ];
  for (const { bk, state } of buckets) {
    for (const c of bk.porCliente) {
      if (c.cardCode === ccUp) {
        reservadasPorCliente += c.qty;
        for (const o of c.origins || []) {
          yaEnOtroPedido.push({ pedidoId: o.pedidoId, qtyOpen: o.qty, state });
        }
      } else {
        reservadasPorOtros += c.qty;
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
 * v1380 (2026-10-20, fix H1): disponibilidad para pedido ORIGINADO en Stock
 * Asignado (CPST). Replica exacta de la formula del preview CPST
 * (`_cpstRenderPreview` v1362, `index.html:16872-16898`).
 *
 * Formula:
 *   firmesPropias = reservadasPorCliente(C)  (ASIG+confirmed vivas del cliente C)
 *   residual      = max(fisico - resPropias(C) - resOtros, 0)
 *   disp          = min(fisico, firmesPropias + residual)
 *
 * Por que: para un pedido ex-ASIG del cliente C, la ASIG(C) ya reservo el
 * stock para C. No tiene que restarse en su propia contra (como hace la
 * formula global `getStockRealmenteDisponible`). Si lo hiciera, pedidos
 * ex-ASIG con qty <= Reservado(propio) irian 100% a BO + app_only → SAP
 * nunca recibe (bug H1 confirmado 2026-10-20, ver docs/auditoria/).
 *
 * REGLA (CLAUDE.md §32 + §33): usar SOLO cuando el pedido es ex-ASIG,
 * identificado por `source='stock-asignado-batch'` o `pedidosOrigenes[]`
 * populated. Aplicarlo a pedidos normales crea bug H2 (reservas fantasma).
 *
 * @param {string} sku
 * @param {string} cardCode
 * @param {StockRealDeps} deps
 * @param {{now?: number}} [opts]
 * @returns {number} Stock disponible >= 0 para el cliente C en pedido ex-ASIG.
 */
export function getStockUtilizableParaClienteExAsig(sku, cardCode, deps, opts) {
  // v1391 (§39): delegado a breakdown.utilizablePara (mismo cálculo).
  if (cardCode) return getStockBreakdown(sku, deps, opts).utilizablePara(cardCode);
  const r = getStockPorCliente(sku, cardCode, deps, opts);
  const fisico = Number(r.fisico) || 0;
  if (fisico <= 0) return 0;
  const resPropias = Number(r.reservadasPorCliente) || 0;
  const resOtros = Number(r.reservadasPorOtros) || 0;
  const residual = Math.max(fisico - resPropias - resOtros, 0);
  return Math.min(fisico, resPropias + residual);
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
/**
 * v1391 (§39): wrapper sobre getStockBreakdown.
 * @param {string} sku
 * @param {StockRealDeps} deps
 * @param {{now?: number}} [opts]
 * @returns {{fisico: number, comprometido: number, real: number, breakdown: {confirmed: number, BO: number, ASIG: number, WAITLIST_CPST: number}}}
 */
export function getStockDesglose(sku, deps, opts) {
  const b = getStockBreakdown(sku, deps, opts);
  return {
    fisico: b.fisicoDep11,
    comprometido: b.reservadasTotal,
    real: b.libre,
    breakdown: {
      confirmed: b.confirmadasSinFacturar.total,
      BO: b.backorderApp.total,
      ASIG: b.asignadas.total,
      WAITLIST_CPST: b.waitlistCpst.total,
    },
  };
}
