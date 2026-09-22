// @ts-check
/**
 * v1015 (2026-09-22): sync SAP Sales Orders -> pedidos.transferidoSAP.orderDocEntry.
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

const TARGET_TYPE_ORDER = 17; // SAP: SQ.Line.TargetType=17 -> linea convertida en SO
const DEFAULT_BATCH_SIZE = 100;

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
  const snap = await deps.fbDb
    .collection('pedidos')
    .where('closedAt', '==', null)
    .orderBy('updatedAt', 'desc')
    .limit(limit * 5) // grab wider slice, filter client-side (many won't match)
    .get();

  /** @type {Array<{id: string, sqDocEntry: number}>} */
  const pending = [];
  snap.forEach((/** @type {any} */ d) => {
    const data = d.data() || {};
    const t = data.transferidoSAP || {};
    const sqDocEntry = Number(t.docEntry);
    // Precondicion: SQ creada en SAP (docEntry seteado) + SO todavia no
    // reflejada (orderDocEntry ausente o null).
    if (Number.isFinite(sqDocEntry) && sqDocEntry > 0 && !t.orderDocEntry) {
      pending.push({ id: d.id, sqDocEntry });
    }
  });
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
    for (const p of pending) {
      try {
        // v1015 hotfix3: SAP SL NO permite $expand=DocumentLines sobre
        // /Quotations(id) (single-entity). Devuelve
        // "Cannot expand invalid navigation property 'DocumentLines'".
        // Solucion: usar el pattern collection query + $filter (mismo pattern
        // que sq-cancel-core.js:135 que ya funciona en prod).
        const selectParams = 'DocEntry,DocumentLines';
        const expandParams = 'DocumentLines($select=TargetType,TargetEntry)';
        const endpoint =
          `/b1s/v1/Quotations?$filter=DocEntry eq ${p.sqDocEntry}` +
          `&$select=${encodeURIComponent(selectParams)}` +
          `&$expand=${encodeURIComponent(expandParams)}` +
          `&$top=1`;
        const r = await sapGet(session, endpoint, deps);
        if (r.status !== 200) {
          const bodyStr =
            typeof r.body === 'string'
              ? r.body.slice(0, 500)
              : JSON.stringify(r.body).slice(0, 500);
          log('[sync-orders] SAP GET non-200', {
            pedidoId: p.id,
            status: r.status,
            sqDocEntry: p.sqDocEntry,
            endpoint,
            bodyPreview: bodyStr,
          });
          errors++;
          continue;
        }
        // Collection query -> value: [{DocEntry, DocumentLines: [...]}].
        const value = r.body && Array.isArray(r.body.value) ? r.body.value : [];
        if (value.length === 0) {
          log('[sync-orders] SQ no encontrada en SAP', {
            pedidoId: p.id,
            sqDocEntry: p.sqDocEntry,
          });
          errors++;
          continue;
        }
        const lines =
          value[0] && Array.isArray(value[0].DocumentLines) ? value[0].DocumentLines : [];
        const orderLine = lines.find(
          (/** @type {any} */ l) => Number(l && l.TargetType) === TARGET_TYPE_ORDER
        );
        if (!orderLine) {
          // SQ existe pero ninguna linea fue convertida a SO todavia.
          misses++;
          continue;
        }
        const orderDocEntry = Number(orderLine.TargetEntry);
        if (!Number.isFinite(orderDocEntry) || orderDocEntry <= 0) {
          log('[sync-orders] SAP devolvio TargetEntry invalido', {
            pedidoId: p.id,
            sqDocEntry: p.sqDocEntry,
            orderLine,
          });
          errors++;
          continue;
        }
        // Update Firestore. Usamos dot-notation para no pisar otros campos
        // de transferidoSAP (docNum, transferredAt, batchId, etc).
        await deps.fbDb.doc(`pedidos/${p.id}`).update({
          'transferidoSAP.orderDocEntry': orderDocEntry,
          'transferidoSAP.orderSyncedAt': new Date().toISOString(),
        });
        hits++;
        log('[sync-orders] hit', {
          pedidoId: p.id,
          sqDocEntry: p.sqDocEntry,
          orderDocEntry,
        });
      } catch (e) {
        log('[sync-orders] pedido exception', {
          pedidoId: p.id,
          err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
        });
        errors++;
      }
    }
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
