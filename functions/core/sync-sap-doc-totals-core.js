// @ts-check
/**
 * v1087 (2026-09-29): syncSapDocTotalsToApp — persiste el DocTotal real de
 * las Sales Quotations y Sales Orders de SAP en pedido.sapDocTotal para que
 * el Planner Kanban muestre EXACTAMENTE lo mismo que SAP.
 *
 * Precedente: 2026-09-29 MAXERA orden 204 SAP:2000212 tenía la línea
 * CVC66MH4SACO con state='confirmed' en el pedido-app, pero SAP nunca la
 * recibió (la SQ 2000212 sólo tiene 4 líneas). El fix v1083 sumaba las 5
 * `confirmed` lines = $1.124.000, pero SAP mostraba $822.800. Discrepancias
 * similares aparecen cada vez que el flujo app → SAP pierde/edita líneas
 * (rechazo por catálogo, split BO/confirmed post-envío, edición manual en
 * oficina).
 *
 * Solución (Opción B — session 2026-09-29): CF scheduled cada 30 min que:
 *   1. Lista pedidos-app abiertos con `transferidoSAP.docNum` seteado y
 *      `paidStatus != 'paid'` (los que están en Oferta/Pending/Confirmado —
 *      Facturado/Cobrado siguen usando invoicedAmount/paidAmount de la CF
 *      syncSapPaymentsToApp).
 *   2. Enum /Quotations y /Orders paginados desc con
 *      $select=DocEntry,DocNum,DocTotal, construye 2 maps.
 *   3. Para cada pedido, prioriza SO DocTotal si orderDocEntry existe (SO
 *      es el nodo más avanzado del pipeline SAP). Sino, SQ DocTotal desde
 *      transferidoSAP.docEntry.
 *   4. Delta write en `pedido.sapDocTotal` + `sapDocTotalSource` ('SO'|'SQ')
 *      + `sapDocTotalSyncedAt`.
 *
 * Frontend cambia `_plannerComputeTotal` a:
 *   pedido.sapDocTotal || sum_confirmed_lines(v1083) || netAmountArs
 *
 * Idempotente. Cada corrida re-lee — cambios en SAP (edición manual de líneas,
 * descuentos post-carga) se reflejan solos.
 *
 * Costo: ~100 GETs por corrida (LOOKAHEAD=2000 / page=20 × 2 endpoints).
 * Alineado con syncSapOrdersToApp v1045 y syncSapPaymentsToApp v1048.
 *
 * NO tiene modo shadow — enrichment de field nuevo, cero riesgo de write-back
 * a SAP. Safe para deploy directo.
 */

import { sapGet, sapLogin, sapLogout } from './sap-sl-client.js';

const DEFAULT_LOOKAHEAD = 2000;
const DEFAULT_PAGE_SIZE = 20; // SL default; ignora $top mayor por config de la company.

/**
 * @typedef {Object} DocTotalsSyncDeps
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {number} [lookahead] Cuantos docs SAP scan por endpoint (default 2000).
 *
 * @typedef {Object} DocTotalsSyncResult
 * @property {number} pedidosChecked
 * @property {number} sqScanned
 * @property {number} soScanned
 * @property {number} pedidosUpdated
 * @property {number} pedidosFromSO
 * @property {number} pedidosFromSQ
 * @property {number} pedidosMissed Pedidos cuyo DocEntry no estaba en el rango scan.
 * @property {number} errors
 */

/**
 * Lista pedidos candidatos:
 *  - closedAt = null (Facturado/Cobrado quedan afuera implícitamente si su
 *    computeColumn los movió a `facturar`/`cobrado` — igual sapDocTotal se
 *    escribe sin problema si aplica, pero el frontend prefiere invoicedAmount
 *    en esas columnas).
 *  - transferidoSAP.docNum truthy (tiene SQ generada en SAP).
 *  - paidStatus !== 'paid' (Cobrado ya cerrado, no vale la pena refrescar).
 *
 * @param {DocTotalsSyncDeps} deps
 * @returns {Promise<Array<{id: string, data: any}>>}
 */
export async function listCandidatePedidos(deps) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id: string, data: any}>} */
  const out = [];
  snap.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    const t = data.transferidoSAP || {};
    // Doble-check closedAt aunque el where lo filtre — defensivo por si el
    // where fuese removido en el futuro o el mock no lo respetase.
    if (data.closedAt != null) return;
    if (!t.docNum) return;
    if (data.paidStatus === 'paid') return;
    out.push({ id: doc.id, data });
  });
  return out;
}

/**
 * Enum genérico paginado desc de un endpoint SAP SL. Devuelve map DocEntry → DocTotal.
 *
 * @param {any} session
 * @param {DocTotalsSyncDeps} deps
 * @param {string} endpointBase Ej '/b1s/v1/Quotations' o '/b1s/v1/Orders'
 * @param {number} lookahead
 * @returns {Promise<{map: Map<number, number>, scanned: number}>}
 */
async function fetchDocTotals(session, deps, endpointBase, lookahead) {
  /** @type {Map<number, number>} */
  const map = new Map();
  let scanned = 0;
  const select = 'DocEntry,DocNum,DocTotal';
  for (let skip = 0; skip < lookahead; skip += DEFAULT_PAGE_SIZE) {
    const endpoint =
      `${endpointBase}?$select=${encodeURIComponent(select)}` +
      `&$orderby=DocEntry desc&$skip=${skip}&$top=${DEFAULT_PAGE_SIZE}`;
    const res = await sapGet(session, endpoint, deps);
    if (res.status !== 200) {
      throw new Error(`fetchDocTotals ${endpointBase} skip=${skip} status=${res.status}`);
    }
    const rows = (res.body && res.body.value) || [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const de = Number(r.DocEntry);
      if (!de) continue;
      map.set(de, Number(r.DocTotal) || 0);
    }
    scanned += rows.length;
    if (rows.length < DEFAULT_PAGE_SIZE) break;
  }
  return { map, scanned };
}

/**
 * Aplica el update a un pedido. Prioriza SO > SQ. Delta write.
 *
 * @param {DocTotalsSyncDeps} deps
 * @param {string} pedidoId
 * @param {any} data
 * @param {Map<number, number>} sqMap
 * @param {Map<number, number>} soMap
 * @returns {Promise<{ updated: boolean, missed: boolean, source: 'SO'|'SQ'|null, docTotal: number|null }>}
 */
export async function applyDocTotalUpdate(deps, pedidoId, data, sqMap, soMap) {
  const t = data.transferidoSAP || {};
  const sqEntry = Number(t.docEntry);
  const soEntry = Number(t.orderDocEntry);

  /** @type {'SO'|'SQ'|null} */
  let source = null;
  /** @type {number|null} */
  let docTotal = null;

  // Prioridad 1: SO (más avanzado en el pipeline SAP)
  if (soEntry && soMap.has(soEntry)) {
    source = 'SO';
    docTotal = /** @type {number} */ (soMap.get(soEntry));
  } else if (sqEntry && sqMap.has(sqEntry)) {
    source = 'SQ';
    docTotal = /** @type {number} */ (sqMap.get(sqEntry));
  }

  if (source === null || docTotal === null) {
    return { updated: false, missed: true, source: null, docTotal: null };
  }

  const currTotal = typeof data.sapDocTotal === 'number' ? data.sapDocTotal : null;
  const currSource = data.sapDocTotalSource || null;

  if (currTotal === docTotal && currSource === source) {
    return { updated: false, missed: false, source, docTotal };
  }

  await deps.fbDb.collection('pedidos').doc(pedidoId).update({
    sapDocTotal: docTotal,
    sapDocTotalSource: source,
    sapDocTotalSyncedAt: new Date().toISOString(),
  });
  return { updated: true, missed: false, source, docTotal };
}

/**
 * Handler principal del sync.
 *
 * @param {DocTotalsSyncDeps} deps
 * @returns {Promise<DocTotalsSyncResult>}
 */
export async function handleSyncSapDocTotals(deps) {
  const log = deps.log || (() => {});
  const lookahead = deps.lookahead || DEFAULT_LOOKAHEAD;

  const pedidos = await listCandidatePedidos(deps);
  log('syncSapDocTotals: listed pedidos', { count: pedidos.length });
  if (pedidos.length === 0) {
    return {
      pedidosChecked: 0,
      sqScanned: 0,
      soScanned: 0,
      pedidosUpdated: 0,
      pedidosFromSO: 0,
      pedidosFromSQ: 0,
      pedidosMissed: 0,
      errors: 0,
    };
  }

  const session = await sapLogin(deps);
  /** @type {Map<number, number>} */
  let sqMap = new Map();
  /** @type {Map<number, number>} */
  let soMap = new Map();
  let sqScanned = 0;
  let soScanned = 0;
  try {
    const sqRes = await fetchDocTotals(session, deps, '/b1s/v1/Quotations', lookahead);
    sqMap = sqRes.map;
    sqScanned = sqRes.scanned;
    log('syncSapDocTotals: SQ scanned', { sqScanned, sqMapSize: sqMap.size });

    const soRes = await fetchDocTotals(session, deps, '/b1s/v1/Orders', lookahead);
    soMap = soRes.map;
    soScanned = soRes.scanned;
    log('syncSapDocTotals: SO scanned', { soScanned, soMapSize: soMap.size });
  } finally {
    try {
      await sapLogout(session, deps);
    } catch (_e) {
      /* silent */
    }
  }

  let pedidosUpdated = 0;
  let pedidosFromSO = 0;
  let pedidosFromSQ = 0;
  let pedidosMissed = 0;
  let errors = 0;
  for (const { id, data } of pedidos) {
    try {
      const r = await applyDocTotalUpdate(deps, id, data, sqMap, soMap);
      if (r.updated) pedidosUpdated++;
      if (r.source === 'SO') pedidosFromSO++;
      if (r.source === 'SQ') pedidosFromSQ++;
      if (r.missed) pedidosMissed++;
    } catch (e) {
      errors++;
      log('syncSapDocTotals: pedido update failed', { pedidoId: id, err: String(e) });
    }
  }

  return {
    pedidosChecked: pedidos.length,
    sqScanned,
    soScanned,
    pedidosUpdated,
    pedidosFromSO,
    pedidosFromSQ,
    pedidosMissed,
    errors,
  };
}
