// @ts-check
/**
 * v1015 (2026-09-22): sync SAP Sales Orders -> pedidos.transferidoSAP.orderDocEntry.
 * v1054 (2026-09-24): guardar tambien `orderDocNum`. `orderDocEntry` es PK
 * interna de SAP (invisible en la UI); el badge "SO:" en la card debe mostrar
 * DocNum (numero visible en SAP). Filtro re-procesa pedidos synced pre-v1054
 * sin orderDocNum para backfill idempotente.
 *
 * Objetivo: cuando en SAP se convierte una SQ (Sales Quotation) que originalmente
 * creo la app en una SO (Sales Order), reflejarlo en Firestore para que el
 * Planner Kanban clasifique el pedido en la columna "Órdenes" en vez de "Oferta".
 *
 * Reporte 2026-09-22 (Mariano): columna "Órdenes" en Planner mostraba 0 items,
 * cuando en SAP hay órdenes creadas. Root cause: nadie escribia `orderDocEntry`
 * (la regla del Planner existia pero el campo jamas se poblaba).
 *
 * ESTRATEGIA:
 * 1. Query Firestore: pedidos con `closedAt == null`, ordenados por updatedAt desc.
 * 2. Filtrar client-side: los que tengan `transferidoSAP.docEntry` seteado
 *    (=SQ ya creada en SAP) pero NO tengan `transferidoSAP.orderDocEntry`.
 * 3. Para cada pedido pendiente, GET a SAP consultando la SQ directamente
 *    (SAP SL no soporta $filter=DocumentLines/any(...) sobre /Orders):
 *      /b1s/v1/Quotations(<sqDocEntry>)?$select=DocEntry,DocumentLines&$expand=DocumentLines($select=TargetType,TargetEntry)
 *    - Buscar en DocumentLines la primera linea con TargetType=17 (Sales Order).
 *      Su TargetEntry es el DocEntry de la SO derivada.
 *    - Si hit -> update `transferidoSAP.orderDocEntry` + `transferidoSAP.orderSyncedAt`.
 *    - Si miss -> no-op (la SQ aun no fue convertida a SO).
 * 4. Retornar resumen `{checked, hits, misses, errors}`.
 *
 * IDEMPOTENCIA: el update es idempotente (mismo valor). Correr 2 veces = mismo estado.
 *
 * RATE LIMIT: 1 GET a SAP por pedido pendiente. Batch max 100 por corrida.
 * Si SAP tiene ~30-100 pedidos "en Oferta" en un momento dado, cada corrida
 * hace 30-100 GET. Aceptable con schedule cada 60min.
 *
 * Testeable con mocks de fetch + fbDb.
 */

import { sapGet, sapLogin, sapLogout } from './sap-sl-client.js';

const BASE_TYPE_QUOTATION = 23; // SAP: SO.Line.BaseType=23 -> linea originada en SQ
const DEFAULT_BATCH_SIZE = 100;
// v1045 (2026-09-23): aumentado de 500 → 2000. Reporte Mariano: pedidos Pesca
// que ya tenían SO en SAP no se sincronizaban al Planner. Diagnóstico: SAP DB
// tiene múltiples BUs (Pesca + Bike + Marketing + Muestras + Chile). El scan
// desc de 500 SOs quedaba dominado por otras BUs, dejando las SOs Pesca fuera.
// Cost extra: ~100 GETs/corrida (5x más) — cada 15min tick, page 20 default.
// Trade-off: si hay racha de >2000 SOs no-Pesca entre SOs Pesca vs Pesca en
// Firestore, seguiría faltando. Fix definitivo futuro: filter por BaseEntry
// range (requiere que SL soporte filter/any que actualmente no).
const ORDERS_LOOKAHEAD = 2000;

/**
 * @typedef {Object} SyncOrdersDeps
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {number} [batchSize] Cuantos pedidos por corrida (default 100).
 *
 * @typedef {Object} SyncOrdersResult
 * @property {number} checked Cuantos pedidos pendientes se procesaron.
 * @property {number} hits Cuantos se actualizaron con orderDocEntry.
 * @property {number} misses Cuantos NO tenian SO en SAP aun.
 * @property {number} errors Cuantos fallaron por GET fail o Firestore fail.
 */

/**
 * Lista pedidos activos (closedAt=null) con SQ en SAP pero sin orderDocEntry.
 * Fetch a Firestore + filtro client-side (mas simple que compound where con
 * inequality en campo anidado, que requiere indice explicito).
 *
 * @param {SyncOrdersDeps} deps
 * @param {number} limit
 * @returns {Promise<Array<{id: string, sqDocEntry: number}>>}
 */
async function listPendingPedidos(deps, limit) {
  // v1047 (2026-09-23): removido `orderBy('updatedAt', 'desc').limit(limit*5)`.
  // Bug: pedidos con updatedAt viejo (activity syncs pushean updatedAt de los
  // recientes) quedaban FUERA del slice de 500 y nunca se procesaban. Fix:
  // traer TODOS los pedidos con closedAt=null (~260 hoy, crece ~30/día),
  // filter client-side, tomar los primeros `limit`. Ordenar por sqDocEntry
  // asc para priorizar los MÁS VIEJOS (que llevan más tiempo esperando match).
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();

  /** @type {Array<{id: string, sqDocEntry: number}>} */
  const pending = [];
  snap.forEach((/** @type {any} */ d) => {
    const data = d.data() || {};
    const t = data.transferidoSAP || {};
    const sqDocEntry = Number(t.docEntry);
    // Precondicion: SQ creada en SAP (docEntry seteado) + SO todavia no
    // reflejada (orderDocNum ausente o null).
    // v1054: filtro por orderDocNum (no orderDocEntry) para backfillear los
    // pedidos synced pre-v1054 que tienen orderDocEntry pero no orderDocNum.
    // Idempotente: una vez que todos tienen orderDocNum, el filtro los skipea.
    if (Number.isFinite(sqDocEntry) && sqDocEntry > 0 && !t.orderDocNum) {
      pending.push({ id: d.id, sqDocEntry });
    }
  });
  // Orden por sqDocEntry asc: los más viejos primero (los que llevan más
  // tiempo esperando match). Cuando el volumen crezca y sea >100 por tick,
  // esto garantiza que ningún pedido quede "atrás para siempre".
  pending.sort((a, b) => a.sqDocEntry - b.sqDocEntry);
  return pending.slice(0, limit);
}

/**
 * Handler principal. Se invoca desde un scheduled CF trigger.
 *
 * @param {SyncOrdersDeps} deps
 * @returns {Promise<SyncOrdersResult>}
 */
export async function syncSapOrders(deps) {
  const log = deps.log || (() => {});
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  const pending = await listPendingPedidos(deps, batchSize);
  log('[sync-orders] start', { pending: pending.length });

  if (pending.length === 0) {
    return { checked: 0, hits: 0, misses: 0, errors: 0 };
  }

  const session = await sapLogin(deps);
  let hits = 0;
  let misses = 0;
  let errors = 0;
  try {
    // v1015 hotfix6: REVERSE MAP approach. En vez de N queries a /Quotations
    // (que no permite $expand ni devuelve Target* sin expand), enumeramos las
    // ultimas SO en SAP con $expand=DocumentLines($select=BaseType,BaseEntry).
    // $expand SI funciona en COLLECTION queries (no en single-entity ni sobre
    // /Quotations). Buildeamos un map {sqDocEntry -> soDocEntry} y matcheamos.
    //
    // Ventajas: 1 SAP query total (vs N). Mucho mas escalable.
    // Trade-off: si una SO se creo hace mucho tiempo (>ORDERS_LOOKAHEAD SO
    // atras) queda invisible al sync. En steady state ~30 SO/dia esto cubre
    // ~16 dias hacia atras. Suficiente para el caso de uso.
    const pendingSqSet = new Set(pending.map((p) => p.sqDocEntry));
    const sqToPedido = new Map(pending.map((p) => [p.sqDocEntry, p.id]));

    // v1015 hotfix7: SAP SL de esta company NO permite $expand sobre ninguna
    // collection de tipo Document. Sin $expand, DocumentLines igual viene
    // inline con BaseType/BaseEntry por default (visto empiricamente).
    // v1015 hotfix8: SAP SL default page size = 20. $top=500 ignorado.
    // Paginamos con $skip hasta cubrir ORDERS_LOOKAHEAD.
    // v1054: agregamos DocNum al $select (numero visible en UI SAP; DocEntry
    // es PK interna invisible al usuario).
    const PAGE_SIZE = 20;
    /** @type {Map<number, {docEntry: number, docNum: number|null}>} */
    const sqToOrder = new Map();
    let totalOrdersScanned = 0;
    let orderFailAt = null;
    for (let skip = 0; skip < ORDERS_LOOKAHEAD; skip += PAGE_SIZE) {
      const ordersEndpoint =
        '/b1s/v1/Orders' +
        `?$select=${encodeURIComponent('DocEntry,DocNum,DocumentLines')}` +
        '&$orderby=DocEntry desc' +
        `&$skip=${skip}`;
      const rOrders = await sapGet(session, ordersEndpoint, deps);
      if (rOrders.status !== 200) {
        const bodyStr =
          typeof rOrders.body === 'string'
            ? rOrders.body.slice(0, 500)
            : JSON.stringify(rOrders.body).slice(0, 500);
        log('[sync-orders] SAP GET /Orders fallo', {
          status: rOrders.status,
          skip,
          endpoint: ordersEndpoint,
          bodyPreview: bodyStr,
        });
        orderFailAt = skip;
        break;
      }
      const orders = rOrders.body && Array.isArray(rOrders.body.value) ? rOrders.body.value : [];
      if (orders.length === 0) {
        // Sin mas SO — no vale la pena seguir paginando.
        break;
      }
      totalOrdersScanned += orders.length;
      for (const so of orders) {
        const soDocEntry = Number(so.DocEntry);
        if (!Number.isFinite(soDocEntry)) continue;
        const soDocNumRaw = Number(so.DocNum);
        const soDocNum = Number.isFinite(soDocNumRaw) ? soDocNumRaw : null;
        const lines = Array.isArray(so.DocumentLines) ? so.DocumentLines : [];
        for (const l of lines) {
          if (Number(l && l.BaseType) !== BASE_TYPE_QUOTATION) continue;
          const sqDe = Number(l.BaseEntry);
          if (!Number.isFinite(sqDe)) continue;
          // Si esta SQ es una de nuestras pending, guardar el match.
          // Solo el primer match gana (SO mas reciente por orderby DocEntry desc).
          if (pendingSqSet.has(sqDe) && !sqToOrder.has(sqDe)) {
            sqToOrder.set(sqDe, { docEntry: soDocEntry, docNum: soDocNum });
          }
        }
      }
      // Optimizacion: si ya matcheamos todas las pending, cortar.
      if (sqToOrder.size >= pendingSqSet.size) break;
    }
    log('[sync-orders] reverse map built', {
      ordersScanned: totalOrdersScanned,
      matchedSqCount: sqToOrder.size,
      pendingSqCount: pendingSqSet.size,
      orderFailAt,
    });
    if (orderFailAt !== null && sqToOrder.size === 0) {
      // Ninguna page se completo; no hay como matchear.
      return { checked: pending.length, hits: 0, misses: 0, errors: pending.length };
    }

    // Aplicar updates a Firestore.
    for (const [sqDe, so] of sqToOrder.entries()) {
      const pedidoId = sqToPedido.get(sqDe);
      if (!pedidoId) continue;
      try {
        /** @type {Record<string, any>} */
        const patch = {
          'transferidoSAP.orderDocEntry': so.docEntry,
          'transferidoSAP.orderSyncedAt': new Date().toISOString(),
        };
        if (so.docNum !== null) patch['transferidoSAP.orderDocNum'] = so.docNum;
        await deps.fbDb.doc(`pedidos/${pedidoId}`).update(patch);
        hits++;
        log('[sync-orders] hit', {
          pedidoId,
          sqDocEntry: sqDe,
          orderDocEntry: so.docEntry,
          orderDocNum: so.docNum,
        });
      } catch (e) {
        log('[sync-orders] update Firestore fallo', {
          pedidoId,
          sqDocEntry: sqDe,
          err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
        });
        errors++;
      }
    }
    misses = pending.length - hits - errors;
  } finally {
    try {
      await sapLogout(session, deps);
    } catch {
      /* swallow */
    }
  }

  log('[sync-orders] done', { checked: pending.length, hits, misses, errors });
  return { checked: pending.length, hits, misses, errors };
}
