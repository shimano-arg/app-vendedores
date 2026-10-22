// @ts-check
/**
 * E3: recalcula backorderBySkuApp / asigBySkuApp / asigByClientSkuApp desde
 * pedidos-app (fuente app-source) en modo HYBRID.
 *
 * NO reemplaza `stock_snapshot.backorderBySku` (SAP-source, sigue vivo).
 * Escribe keys paralelos:
 *   - backorderBySkuApp[sku]      = sum qtyOpen lines state='BO' en pedidos abiertos
 *   - asigBySkuApp[sku]           = sum qtyOpen lines state='ASIG' en pedidos abiertos
 *   - asigByClientSkuApp[card::sku] = idem por cliente (para modal reciclado)
 *
 * MODOS (lee de app_config/sap_sync_state.mode, misma llave que E2):
 *   - 'shadow' (default): escribe a `app_config/stock_snapshot_shadow_v3`
 *   - 'active' (E5): escribe a `app_config/stock_snapshot` (keys *App)
 *
 * Dedup en read side (E4/E5): la UI mergea SAP-source y app-source usando
 * `transferidoSAP.docEntry` <-> SQ.DocEntry como key. Este modulo NO deduplica —
 * solo agrega desde app-source. La dedup es responsabilidad del render.
 *
 * Trigger: on-write pedidos/{id}. La CF extrae SKUs afectados (union de
 * before.lines + after.lines) y recalcula solo esos.
 *
 * Testeable con mocks de fbDb (Firestore).
 */

const SYNC_STATE_DOC = 'app_config/sap_sync_state';
// v551+ (2026-08-19) fix bug arquitectural: sync_sap_to_firestore.py (cron
// externo cada 30 min) hace SET full replace sobre `stock_snapshot` pisando
// cualquier campo que le agreguemos con merge:true. Solucion: en active mode
// escribimos a un doc SEPARADO `stock_snapshot_app` que nadie mas toca.
// La UI listenea ambos docs y hace el merge en lectura.
const SNAPSHOT_DOC_ACTIVE = 'app_config/stock_snapshot_app';
const SNAPSHOT_DOC_SHADOW = 'app_config/stock_snapshot_shadow_v3';
const OPEN_STATES = new Set(['BO', 'ASIG']);

// v976 (2026-09-17): reglas de expiracion portadas de
// `src/pure/stock-realmente-disponible.js`. MANTENER SINCRONIZADO — si cambia
// alla, cambiar aca tambien. Se copia inline porque la CF vive en functions/
// y no puede importar de src/ (build de Firebase Functions es aislado).
// Bug #2 (post v1126): TTL_DAYS en functions/core/asig-ttl-core.js tambien
// debe mantenerse igual a este valor — la CF TTL marca lineas 'expired'
// en el mismo boundary donde dejan de reservar stock.
//
// v1380 (2026-10-20, fix D2): bajado 15 -> 7 para alinear con src/pure/
// (v1198 2026-10-08) y eliminar drift. Decidido por Mariano explicito tras
// medir prod (153/153 ASIG vivas <= 7d, drift puramente teorico pero
// sistemico). Test anti-divergencia en tests/unit/audit/ttl-sync.test.js.
const RESERVA_TTL_DAYS = 7;
// v1388 (2026-10-21): mirror src/pure (CLAUDE.md §37 BO no vence a 7d / §38
// confirmed hard cap 60d).
const _BO_TTL_DAYS = 90;
const CONFIRMED_HARD_CAP_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Normaliza un valor a timestamp ms. Igual que en
 * src/pure/stock-realmente-disponible.js (MANTENER SINCRONIZADO).
 * Soporta null/undefined, number, Date, Firestore Timestamp (toMillis),
 * plain {seconds, nanoseconds?}, string ISO.
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
 * Portado de src/pure/stock-realmente-disponible.js:lineReservesStock.
 * Retorna true si la linea reserva stock (segun state + edad + asigReserva).
 * @param {any} line
 * @param {number} nowMs
 * @param {any} pedido
 * @returns {boolean}
 */
export function lineReservesStock(line, nowMs, pedido) {
  if (!line) return false;
  const state = line.state;
  if (state === 'BO') {
    // v1392 (2026-10-21, CLAUDE.md §40 reemplaza §34): BO NO reserva stock.
    // Mirror src/pure. TTL §37 90d queda en el bucket backorderApp del
    // breakdown (cola + forecast), NO en reservas.
    return false;
  }
  if (state === 'confirmed') {
    // v1269 (2026-10-14): asigReserva=false libera reserva tambien para
    // confirmed. Mirror client-side (src/pure/stock-realmente-disponible.js).
    if (line.asigReserva === false || line.asigReserva === 0) return false;
    // v1400 §40.8 D3 mirror: si la SQ ya se convirtió en SO en SAP
    // (orderDocEntry presente), SAP la cubre en Available → la app NO
    // reserva (evita doble conteo).
    if (pedido && pedido.transferidoSAP && pedido.transferidoSAP.orderDocEntry != null) {
      return false;
    }
    // v963: expira desde pedido.confirmedAt (TTL 7d post-v1198).
    // v1384 (2026-10-21): guard defensivo — sin pedido.confirmedAt se trata
    // como data corrupta y NO reserva. CLAUDE.md §36.
    if (!pedido || !pedido.confirmedAt) return false;
    const confirmedAtMs = toMillisSafe(pedido.confirmedAt);
    if (confirmedAtMs === null) return false;
    const ageDays = (nowMs - confirmedAtMs) / DAY_MS;
    if (ageDays > RESERVA_TTL_DAYS) return false;
    // v1388 (CLAUDE.md §38): hard cap 60d.
    if (ageDays > CONFIRMED_HARD_CAP_DAYS) return false;
    return true;
  }
  if (state === 'ASIG') {
    // v1402 §40.10 mirror: ASIG siempre reserva (§40). Guard asigReserva=false
    // eliminado. Toggle UI "destildar" revierte a BO (ver _toggleAsigReserva).
    // v959: expira 15d desde asigAt.
    if (line.asigAt) {
      const asigAtMs = toMillisSafe(line.asigAt);
      if (asigAtMs !== null && (nowMs - asigAtMs) / DAY_MS > RESERVA_TTL_DAYS) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * v1391 (2026-10-21, CLAUDE.md §39) — Espejo de src/pure/stock-breakdown.js.
 * Mantener sincronizado via tests/unit/audit/stock-breakdown-sync.test.js.
 *
 * @param {string} sku
 * @param {{
 *   getStockFisico: (sku:string) => number,
 *   getStockTransito?: (sku:string) => number,
 *   pedidos: Array<any>,
 *   waitlistEntries?: Array<any>,
 *   ingresosRepartoActivos?: Array<any>,
 *   sapBackorderSnapshot?: Object|null,
 * }} deps
 * @param {{now?: number}} [opts]
 */
export function getStockBreakdown(sku, deps, opts) {
  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now();
  const skuUp = String(sku || '').toUpperCase();
  const fisicoDep11 = skuUp ? Number(deps.getStockFisico(skuUp)) || 0 : 0;
  const transitoDep12 =
    skuUp && typeof deps.getStockTransito === 'function'
      ? Number(deps.getStockTransito(skuUp)) || 0
      : 0;

  const buckets = {
    BO: new Map(),
    confirmed: new Map(),
    ASIG: new Map(),
  };
  // v1400 §40.8: buckets stale eliminados — demandaSapSinCubrir removido del shape.

  /**
   * @param {Map<string, any>} map
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

  // v1395 §40.3 mirror: raw ASIG + confirmed para FIFO.
  /** @type {Array<{pedidoId:string, lineIndex:number, cardCode:string, clientName:string, asigAt:string|null, qtyNominal:number}>} */
  const asigRaw = [];
  /** @type {Array<{confirmedAt:string|null, qtyNominal:number}>} */
  const confirmedRaw = [];

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
        // v1392 §40 mirror: BO al bucket por TTL 90d (cola+forecast), no reserva.
        let incluir = false;
        if (st === 'BO') {
          if (p.createdAt) {
            const createdMs = typeof p.createdAt === 'string' ? Date.parse(p.createdAt) : null;
            if (createdMs !== null && (now - createdMs) / DAY_MS <= 90) {
              incluir = true;
            } else if (createdMs === null) {
              incluir = true;
            }
          } else {
            incluir = true;
          }
        } else {
          incluir = lineReservesStock(l, now, p);
        }
        if (incluir) {
          const _map = /** @type {Map<string, any>} */ (
            buckets[/** @type {'BO'|'confirmed'|'ASIG'} */ (st)]
          );
          _push(_map, p.clientCardCode, p.clientName, qo, p._fsId || p.id || '', i);
          // v1395 §40.3 mirror: capturo raw.
          if (st === 'ASIG') {
            asigRaw.push({
              pedidoId: String(p._fsId || p.id || ''),
              lineIndex: i,
              cardCode: String(p.clientCardCode || ''),
              clientName: String(p.clientName || ''),
              asigAt: l.asigAt || null,
              qtyNominal: qo,
            });
          } else if (st === 'confirmed') {
            confirmedRaw.push({
              confirmedAt: p.confirmedAt || null,
              qtyNominal: qo,
            });
          }
        }
      }
    }
  }

  /** @param {Map<string, any>} map */
  const _toBucket = (map) => {
    const porCliente = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
    const total = porCliente.reduce((s, c) => s + c.qty, 0);
    return { total, porCliente };
  };

  // v1198+ revision_waitlist CPST (source='stock-asignado-batch') también reserva.
  const bucketWaitlist = new Map();
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
  const asignadasBase = _toBucket(buckets.ASIG);
  const waitlistCpst = _toBucket(bucketWaitlist);

  // v1395 §40.3 mirror: FIFO distribution.
  const _tsOrInf = (/** @type {string|null} */ iso) => {
    if (!iso) return Number.POSITIVE_INFINITY;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  confirmedRaw.sort((a, b) => _tsOrInf(a.confirmedAt) - _tsOrInf(b.confirmedAt));
  let fisicoRestante = fisicoDep11;
  for (const c of confirmedRaw) {
    const take = Math.min(c.qtyNominal, Math.max(0, fisicoRestante));
    fisicoRestante -= take;
  }
  asigRaw.sort((a, b) => _tsOrInf(a.asigAt) - _tsOrInf(b.asigAt));
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
  const asignadas = {
    total: asignadasBase.total,
    porCliente: asignadasBase.porCliente,
    detalle: asigDetalle,
  };

  // v1392 §40 mirror: repartoAbierto informativo (NO reserva).
  let repartoAbierto = { qty: 0, repartoId: null, status: null };
  if (Array.isArray(deps.ingresosRepartoActivos)) {
    const match = deps.ingresosRepartoActivos.find(
      (r) => r && String(r.sku || '').toUpperCase() === skuUp
    );
    if (match) {
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

  // v1394 §40.2 mirror: cap por fisico. reservadasTotal = min(ASIG+conf, fisico).
  const reservasNominales = confirmadasSinFacturar.total + asignadas.total;
  const reservadasTotal = Math.min(reservasNominales, fisicoDep11);
  const libre = Math.max(0, fisicoDep11 - reservadasTotal);

  /** @param {string} cardCode */
  const utilizablePara = (cardCode) => {
    if (!cardCode) return libre;
    const key = String(cardCode).trim();
    let reservasPropias = 0;
    // v1393 §40.1: waitlist no reserva (draft VDE). Solo ASIG + confirmed propios.
    for (const map of [buckets.confirmed, buckets.ASIG]) {
      const own = map.get(key);
      if (own) reservasPropias += own.qty;
    }
    return Math.min(fisicoDep11, libre + reservasPropias);
  };

  return {
    sku: skuUp,
    fisicoDep11,
    transitoDep12,
    backorderApp,
    confirmadasSinFacturar,
    asignadas,
    waitlistCpst,
    repartoAbierto, // v1392 informativo
    reservadasTotal,
    libre,
    utilizablePara,
    pendienteReparto: { qty: repartoAbierto.qty, repartoId: repartoAbierto.repartoId },
    _version: 7,
  };
}

export const STOCK_LABELS_SERVER = Object.freeze({
  backorderApp: 'Back order (app)',
  confirmadasSinFacturar: 'Confirmadas sin facturar',
  asignadas: 'Asignadas',
  waitlistCpst: 'En lista de espera (CPST)',
  repartoAbierto: 'En reparto pendiente (no reserva)',
  reservadasTotal: 'Reservadas',
  fisicoDep11: 'Stock físico (dep 11)',
  transitoDep12: 'En tránsito (dep 12)',
  libre: 'Libre para la venta',
  pendienteReparto: 'Pendientes de reparto',
});

/**
 * @typedef {Object} PedidoLine
 * @property {string} code
 * @property {number} qtyOpen
 * @property {'BO'|'ASIG'|'confirmed'|'invoiced'|'cancelled'|'recycled'|'legacy'} state
 * @property {any} [asigReserva] undefined | true | false (v957)
 * @property {any} [asigAt] ISO string cuando la linea paso a ASIG (v959)
 *
 * @typedef {Object} PedidoDoc
 * @property {string} clientCardCode
 * @property {PedidoLine[]} lines
 * @property {any} closedAt
 * @property {any} [transferidoSAP] Objeto con via/docNum/docEntry o null si aun no se envio a SAP.
 * @property {any} [createdAt] Timestamp/ISO cuando el VDE cargo el pedido (v969: expira BO).
 * @property {any} [confirmedAt] Timestamp/ISO cuando el pedido paso a confirmed (v963: expira confirmed).
 *
 * @typedef {Object} SnapshotDeps
 * @property {any} fbDb Firestore Admin instance.
 * @property {any} [FieldValue] Firestore FieldValue class (for FieldValue.delete()).
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 */

/**
 * Extrae los SKUs afectados de un pedido (union of before/after lines).
 * Los SKUs con state='legacy' se ignoran (no cuentan en app-source hasta cutover).
 * @param {any} beforeData
 * @param {any} afterData
 * @returns {Set<string>}
 */
export function extractAffectedSkus(beforeData, afterData) {
  const skus = new Set();
  const collect = (/** @type {any} */ data) => {
    if (!data || !Array.isArray(data.lines)) return;
    for (const l of data.lines) {
      if (!l || !l.code) continue;
      // Solo contamos si el line tiene state relevante (BO/ASIG) o pudo haberlo cambiado.
      // Para seguridad: si state cambia, tanto before como after se cuentan como afectados.
      if (l.state === 'legacy') continue;
      skus.add(String(l.code).toUpperCase());
    }
  };
  collect(beforeData);
  collect(afterData);
  return skus;
}

/**
 * Lee el modo actual del sync desde Firestore. Default 'shadow' si no existe.
 * @param {SnapshotDeps} deps
 * @returns {Promise<'shadow'|'active'>}
 */
export async function readSyncMode(deps) {
  const doc = await deps.fbDb.doc(SYNC_STATE_DOC).get();
  if (!doc.exists) return 'shadow';
  const data = doc.data() || {};
  return data.mode === 'active' ? 'active' : 'shadow';
}

/**
 * Suma qtyOpen por state para un SKU dado, iterando pedidos abiertos.
 * Retorna { bo, asig, asigByClient, boByClient }.
 * v567 (2026-08-20): agregado boByClient para poder mostrar en el modal
 * cliente qué SKUs tiene esperando reposición de stock (paralelo a la
 * seccion asig).
 * @param {PedidoDoc[]} pedidos
 * @param {string} sku
 * @param {number} [nowMs] v976: timestamp inyectable para tests. Default Date.now().
 */
export function aggregateForSku(pedidos, sku, nowMs) {
  let bo = 0;
  let asig = 0;
  const asigByClient = new Map();
  const boByClient = new Map();
  const skuUp = String(sku).toUpperCase();
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  for (const p of pedidos) {
    if (p.closedAt) continue; // pedido cerrado no cuenta
    // v578 (2026-08-21): solo pedidos procesados por auto-send cuentan.
    // Pedidos pendientes de envio a SAP (transferidoSAP=null) NO deben
    // generar backorder. Bug reportado por Mariano: CARNADAS LOBERIA sin
    // transferidoSAP aparecia en backorderByClientSkuApp.
    if (!p.transferidoSAP) continue;
    const lines = p.lines || [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      if (!OPEN_STATES.has(l.state)) continue;
      const q = Number(l.qtyOpen || 0);
      if (q <= 0) continue;
      // v976 (2026-09-17): aplicar lineReservesStock — no contar como
      // reserva a las ASIG vencidas (asigAt >15d), ASIG sin reserva
      // (asigReserva=false para clientes B/C), ni BO vencidos (createdAt >15d).
      // Bug reportado: STOCK_ASIG_APP contaba todo state='ASIG' sin filtrar
      // -> alert Master mostraba "reservado" > realidad, doble descuento vs
      // getStockRealmenteDisponible que si filtra.
      // v1392 §40: `lineReservesStock('BO')` ahora devuelve false. Para el
      // snapshot informativo (STOCK_BACKORDER_APP + backorderByClientSkuApp),
      // seguimos CONTANDO BO si está dentro de TTL §37 90d (cola + forecast).
      // ASIG mantiene el filtro completo de `lineReservesStock` (reserva real).
      const cc = String(p.clientCardCode || '').trim();
      if (l.state === 'BO') {
        // Filtro TTL §37 90d solo para el bucket informativo.
        if (p.createdAt) {
          const createdAtMs = toMillisSafe(p.createdAt);
          if (createdAtMs !== null && (now - createdAtMs) / DAY_MS > 90) continue;
        }
        bo += q;
        if (cc) boByClient.set(cc, (boByClient.get(cc) || 0) + q);
      } else if (l.state === 'ASIG') {
        if (!lineReservesStock(l, now, p)) continue;
        asig += q;
        if (cc) asigByClient.set(cc, (asigByClient.get(cc) || 0) + q);
      }
    }
  }
  return { bo, asig, asigByClient, boByClient };
}

/**
 * Query Firestore: pedidos WHERE closedAt == null. Filtra en memoria por sku.
 * Nota: hoy son ~56 pedidos, full read es viable. Cuando escale, indexar
 * por sku es opcion (subcollection lines/{sku}).
 * @param {SnapshotDeps} deps
 * @returns {Promise<PedidoDoc[]>}
 */
async function loadOpenPedidos(deps) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {PedidoDoc[]} */
  const out = [];
  snap.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    out.push({
      clientCardCode: data.clientCardCode || '',
      lines: Array.isArray(data.lines) ? data.lines : [],
      closedAt: data.closedAt,
      transferidoSAP: data.transferidoSAP || null,
      // v976: createdAt/confirmedAt necesarios para lineReservesStock (v963/v969).
      createdAt: data.createdAt || null,
      confirmedAt: data.confirmedAt || null,
    });
  });
  return out;
}

/**
 * Aplica el update al snapshot doc para los SKUs dados.
 *
 * BUG FIX 2026-08-19: el Admin SDK JS trata dotted paths en `.set(x, {merge:true})`
 * como nombres literales de campo (no anida). Antes escribiamos claves como
 * `backorderBySkuApp.SKU1` que quedaban planas en el doc → los lectores no
 * las encontraban en `d.backorderBySkuApp`. Ahora armamos nested maps y
 * confiamos en `merge: true` para hacer deep merge de los sub-maps (SKUs
 * NO tocados en el recalc actual quedan intactos).
 * @param {SnapshotDeps} deps
 * @param {string} snapshotDocPath
 * @param {Map<string, {bo: number, asig: number, asigByClient: Map<string, number>, boByClient: Map<string, number>}>} perSku
 */
/**
 * E1 shadow §stock-servidor-atomico (2026-10-23): escribe un doc por SKU
 * en la colección `stock_snapshot/{SKU}` con el aggregate app-source.
 *
 * Objetivo: evitar el hot-spot del único doc global `app_config/stock_snapshot_app`
 * cuando commitPedidoCF corra en paralelo (p95 22 líneas/SKU en prod →
 * contention sobre 1 doc). Con 1 doc por SKU, dos txn que confirman el MISMO
 * SKU reintentan; dos txn sobre SKUs distintos pasan sin contención.
 *
 * **Shadow 24h**: este helper escribe en paralelo al snapshot global. En E2
 * `commitPedidoCF` leerá `stock_snapshot/{SKU}` dentro de runTransaction.
 * El snapshot global sigue para compatibilidad con lectores viejos.
 *
 * @param {SnapshotDeps} deps
 * @param {Map<string, {bo: number, asig: number, asigByClient: Map<string, number>, boByClient: Map<string, number>}>} perSku
 * @param {string} nowIso
 */
async function writePerSkuShadowSnapshot(deps, perSku, nowIso) {
  if (!perSku.size) return { written: 0 };
  const col = deps.fbDb.collection('stock_snapshot');
  let written = 0;
  for (const [sku, agg] of perSku) {
    const asigByClient = Object.fromEntries(agg.asigByClient);
    const boByClient = Object.fromEntries(agg.boByClient);
    const docData = {
      sku,
      asignadas: { total: agg.asig, byClient: asigByClient },
      backorderApp: { total: agg.bo, byClient: boByClient },
      // confirmadasSinFacturar: {} // TODO sesión 2 — incluir en aggregate
      _version: 'app_v8_shadow_e1',
      _computedAt: nowIso,
      _source: 'onPedidoWriteRecalcSnapshot',
    };
    try {
      await col.doc(sku).set(docData, { merge: true });
      written++;
    } catch (e) {
      // No bloqueamos el write global por errores shadow. Log + sigue.
      if (deps.log)
        deps.log('writePerSkuShadowSnapshot FAIL', { sku, err: (e && e.message) || String(e) });
    }
  }
  return { written };
}

async function writeSnapshot(deps, snapshotDocPath, perSku) {
  if (!perSku.size) return;
  // v554+ (bugfix): NO usar `set({field: {}}, {merge: true})` con maps vacios
  // porque el Admin SDK JS pisa el field entero con {} — deja el mapa vacio
  // (perdemos keys previas). Solucion: usar `update()` con dotted paths, que
  // hace merge nested correcto en Firestore. Como el doc debe existir para
  // update, primero garantizamos su existencia con un set base minimalista.
  //
  // v558+ (bugfix stale keys): para asigByClientSkuApp, si un cliente ANTES
  // contribuia al SKU pero AHORA no (todas sus lineas se reciclaron/cancelaron),
  // la key vieja persiste con qty stale porque solo escribimos las que estan
  // en el aggregate. Fix: leer snapshot actual y borrar (DELETE_FIELD) las
  // claves cc::sku para SKUs procesados que ya no aparecen en el aggregate.
  const ref = deps.fbDb.doc(snapshotDocPath);
  await ref.set(
    {
      sourceApp: 'app_pedidos_v3',
      updatedAtApp: new Date().toISOString(),
    },
    { merge: true }
  );
  // Leer snapshot actual para detectar claves cc::sku a borrar.
  const currentSnap = await ref.get();
  const currentData = currentSnap.exists ? currentSnap.data() || {} : {};
  const currentAsigByClient =
    (currentData.asigByClientSkuApp && typeof currentData.asigByClientSkuApp === 'object'
      ? currentData.asigByClientSkuApp
      : {}) || {};
  const currentBoByClient =
    (currentData.backorderByClientSkuApp && typeof currentData.backorderByClientSkuApp === 'object'
      ? currentData.backorderByClientSkuApp
      : {}) || {};
  const FieldValue = deps.FieldValue || (deps.fbDb.constructor && deps.fbDb.constructor.FieldValue);
  /** @type {Record<string, any>} */
  const update = {};
  for (const [sku, agg] of perSku) {
    update[`backorderBySkuApp.${sku}`] = agg.bo;
    update[`asigBySkuApp.${sku}`] = agg.asig;
    // asigByClient: escribir claves cc::sku vigentes.
    const clientesAsigEnAgg = new Set();
    for (const [cc, qty] of agg.asigByClient) {
      update[`asigByClientSkuApp.${cc}::${sku}`] = qty;
      clientesAsigEnAgg.add(cc);
    }
    // v567: boByClient — mismo pattern que asigByClient. Poblado para poder
    // mostrar en el modal cliente qué SKUs tiene esperando reposición.
    const clientesBoEnAgg = new Set();
    for (const [cc, qty] of agg.boByClient) {
      update[`backorderByClientSkuApp.${cc}::${sku}`] = qty;
      clientesBoEnAgg.add(cc);
    }
    // Stale cleanup asigByClient: claves cc::sku existentes NO en aggregate → delete.
    const skuSuffix = `::${sku}`;
    for (const key of Object.keys(currentAsigByClient)) {
      if (!key.endsWith(skuSuffix)) continue;
      const cc = key.substring(0, key.length - skuSuffix.length);
      if (clientesAsigEnAgg.has(cc)) continue;
      if (FieldValue && typeof FieldValue.delete === 'function') {
        update[`asigByClientSkuApp.${key}`] = FieldValue.delete();
      } else {
        update[`asigByClientSkuApp.${key}`] = 0;
      }
    }
    // Stale cleanup boByClient: mismo pattern.
    for (const key of Object.keys(currentBoByClient)) {
      if (!key.endsWith(skuSuffix)) continue;
      const cc = key.substring(0, key.length - skuSuffix.length);
      if (clientesBoEnAgg.has(cc)) continue;
      if (FieldValue && typeof FieldValue.delete === 'function') {
        update[`backorderByClientSkuApp.${key}`] = FieldValue.delete();
      } else {
        update[`backorderByClientSkuApp.${key}`] = 0;
      }
    }
  }
  update.updatedAtApp = new Date().toISOString();
  await ref.update(update);
}

/**
 * Recalcula el snapshot app-source para los SKUs afectados.
 * @param {SnapshotDeps} deps
 * @param {Set<string>} affectedSkus
 * @returns {Promise<{mode: 'shadow'|'active', skusRecalculated: number, snapshotDoc: string, totals: Record<string, {bo: number, asig: number}>}>}
 */
export async function recalcSnapshotForSkus(deps, affectedSkus) {
  const log = deps.log || (() => {});
  if (!affectedSkus.size) {
    return { mode: 'shadow', skusRecalculated: 0, snapshotDoc: '', totals: {} };
  }
  const mode = await readSyncMode(deps);
  const snapshotDoc = mode === 'active' ? SNAPSHOT_DOC_ACTIVE : SNAPSHOT_DOC_SHADOW;
  const pedidos = await loadOpenPedidos(deps);

  /** @type {Map<string, {bo: number, asig: number, asigByClient: Map<string, number>, boByClient: Map<string, number>}>} */
  const perSku = new Map();
  /** @type {Record<string, {bo: number, asig: number}>} */
  const totals = {};
  const now = Date.now();
  for (const sku of affectedSkus) {
    const agg = aggregateForSku(pedidos, sku, now);
    perSku.set(sku, agg);
    totals[sku] = { bo: agg.bo, asig: agg.asig };
  }

  await writeSnapshot(deps, snapshotDoc, perSku);
  // E1 shadow §stock-servidor-atomico: paralelo escribimos stock_snapshot/{SKU}
  // Si Firestore falla individualmente no bloqueamos el main write.
  const shadowResult = await writePerSkuShadowSnapshot(deps, perSku, new Date(now).toISOString());
  log('recalcSnapshotForSkus done', {
    mode,
    skus: affectedSkus.size,
    snapshotDoc,
    perSkuShadowWritten: shadowResult.written,
  });
  return {
    mode,
    skusRecalculated: affectedSkus.size,
    snapshotDoc,
    totals,
    perSkuShadowWritten: shadowResult.written,
  };
}
