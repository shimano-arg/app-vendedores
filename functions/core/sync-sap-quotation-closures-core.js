// @ts-check
/**
 * v1053 (2026-09-24): syncSapQuotationClosures — detecta SQs cerradas
 * MANUALMENTE en SAP (Close Document, sin convertir a SO ni facturar) y
 * cierra el pedido-app correspondiente en Firestore.
 *
 * Precedente: 2026-09-23 Mariano reportó 4 pedidos que seguían en la
 * columna "Oferta" del Planner Kanban aunque los vendedores CERRARON las
 * SQs manualmente en SAP (SQs 2000123, 2000155, 2000220, 2000221). Fix
 * manual: scripts/close-manual-sap-sqs-2026-09-23.cjs. Este core es el
 * fix estructural para no depender de scripts one-shot cada vez.
 *
 * Diferencia con syncSapOrdersToApp: aquel detecta CONVERSIÓN SQ→SO
 * (BaseType=23 en /Orders/DocumentLines). Este detecta CIERRE MANUAL
 * (DocumentStatus='bost_Close' + Cancelled='tNO' + sin SO/Invoice
 * derivada). Son dos flows disjuntos — un pedido puede terminar por
 * conversion (van a syncSapOrdersToApp) o por cierre manual (aquí).
 *
 * Estrategia:
 * 1. Lista pedidos-app `closedAt=null` con `transferidoSAP.docEntry` seteado
 *    (=SQ ya creada en SAP), SIN `orderDocEntry` (=no fue convertida) y sin
 *    `qtyInvoiced` en ninguna línea (=no fue facturada). Estos son candidatos
 *    a ser cerrados si SAP los tiene como bost_Close manual.
 * 2. Enum /Quotations SAP paginado desc con
 *    $filter=DocumentStatus eq 'bost_Close' and Cancelled eq 'tNO'.
 *    Guarda Set<DocEntry>.
 * 3. Para cada candidato pedido-app cuyo docEntry esté en el Set:
 *    - Update Firestore con closedAt=now + reason=sap_manual_close +
 *      transferidoSAP.closedManuallyInSap=true + sapDocumentStatus.
 *    - El pedido desaparece del Planner (listener filtra closedAt==null).
 *
 * IDEMPOTENCIA: solo actualizamos pedidos con `closedAt=null`. Correr N veces
 * seguidas = mismo resultado.
 *
 * FAIL-SAFE (evita cierres accidentales):
 * - Filtro doble: SAP dice bost_Close + Cancelled=tNO (defensivo por si SAP
 *   cambia el semantics de Cancelled). Adicionalmente asegurar el pedido no
 *   tiene orderDocEntry ni qtyInvoiced ni paidStatus (=nunca facturamos algo
 *   que ya avanzó en el pipeline).
 * - Si el listado de pedidos-app está vacío → no consultamos SAP (ahorra 1
 *   login/session).
 *
 * COSTO: 1 SL session + N GETs a /Quotations (default 20/page,
 * LOOKAHEAD=2000 → ~100 GETs). Cada 15min tick.
 *
 * Testeable con mocks de fetch + fbDb.
 */

import { sapGet, sapLogin, sapLogout } from './sap-sl-client.js';

const DEFAULT_BATCH_SIZE = 100;
// LOOKAHEAD de SQs cerradas a escanear. Alineado con syncSapOrdersToApp v1045
// (ORDERS_LOOKAHEAD=2000) y syncSapPaymentsToApp v1048 (INVOICES_LOOKAHEAD=2000).
// A ~30 SQs/día closed en steady state, 2000 cubre ~66 días — más que suficiente
// para que un cierre manual no quede fuera de la ventana en 2 ticks (30min).
const DEFAULT_CLOSED_LOOKAHEAD = 2000;

/**
 * @typedef {Object} SyncQuotationClosuresDeps
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {number} [batchSize] Cuantos pedidos por corrida (default 100).
 * @property {number} [closedLookahead] Cuantas SQs cerradas escanear (default 2000).
 * @property {() => Date} [now] Inyectable para tests.
 *
 * @typedef {Object} SyncQuotationClosuresResult
 * @property {number} checked Cuantos pedidos-app candidatos se procesaron.
 * @property {number} closedInApp Cuantos se cerraron en Firestore por match.
 * @property {number} sapClosedScanned Cuantas SQs closed leyó de SAP.
 * @property {number} errors Cuantos fallaron por update Firestore.
 */

/**
 * Lista pedidos-app candidatos a cierre manual:
 * - closedAt = null (aún abiertos).
 * - transferidoSAP.docEntry seteado (SQ existe en SAP).
 * - transferidoSAP.orderDocEntry ausente (no convertida a SO).
 * - Ninguna línea con qtyInvoiced > 0 (no facturada).
 * - paidStatus ausente (no cobrada).
 *
 * @param {SyncQuotationClosuresDeps} deps
 * @param {number} limit
 * @returns {Promise<Array<{id: string, sqDocEntry: number}>>}
 */
export async function listCandidatePedidos(deps, limit) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id: string, sqDocEntry: number}>} */
  const candidates = [];
  snap.forEach((/** @type {any} */ d) => {
    const data = d.data() || {};
    const t = data.transferidoSAP || {};
    const sqDocEntry = Number(t.docEntry);
    if (!Number.isFinite(sqDocEntry) || sqDocEntry <= 0) return;
    if (t.orderDocEntry) return; // ya convertido a SO → no aplica
    if (t.closedManuallyInSap) return; // ya marcado (idempotencia soft)
    if (data.paidStatus === 'partial' || data.paidStatus === 'paid') return;
    const lineas = Array.isArray(data.lines)
      ? data.lines
      : Array.isArray(data.items)
        ? data.items
        : [];
    if (lineas.some((/** @type {any} */ l) => (Number(l?.qtyInvoiced) || 0) > 0)) return;
    candidates.push({ id: d.id, sqDocEntry });
  });
  candidates.sort((a, b) => a.sqDocEntry - b.sqDocEntry); // más viejos primero
  return candidates.slice(0, limit);
}

/**
 * Enum SQs cerradas manualmente en SAP (paginado desc por DocEntry).
 * Retorna Set<docEntry> con las que están bost_Close + Cancelled=tNO.
 *
 * SL default page size = 20 (los $top>20 son ignorados por esta company).
 * Paginamos con $skip hasta cubrir `closedLookahead`.
 *
 * @param {import('./sap-sl-client.js').SapSession} session
 * @param {SyncQuotationClosuresDeps} deps
 * @param {number} closedLookahead
 * @returns {Promise<{ok: true, closedSet: Set<number>, scanned: number} | {ok: false, error: string}>}
 */
export async function fetchClosedQuotations(session, deps, closedLookahead) {
  const PAGE_SIZE = 20;
  /** @type {Set<number>} */
  const closedSet = new Set();
  let scanned = 0;
  const filter = "DocumentStatus eq 'bost_Close' and Cancelled eq 'tNO'";
  for (let skip = 0; skip < closedLookahead; skip += PAGE_SIZE) {
    const endpoint =
      '/b1s/v1/Quotations' +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$select=${encodeURIComponent('DocEntry,DocumentStatus,Cancelled')}` +
      '&$orderby=DocEntry desc' +
      `&$skip=${skip}`;
    let resp;
    try {
      resp = await sapGet(session, endpoint, deps);
    } catch (e) {
      return {
        ok: false,
        error: 'sapGet threw: ' + ((e && /** @type {any} */ (e).message) || String(e)),
      };
    }
    if (resp.status !== 200) {
      return { ok: false, error: `SL Quotations GET status=${resp.status}` };
    }
    const rows = resp.body && Array.isArray(resp.body.value) ? resp.body.value : [];
    if (rows.length === 0) break; // sin más
    scanned += rows.length;
    for (const q of rows) {
      const de = Number(q.DocEntry);
      // Defense in depth: refiltrar client-side por si SL ignora el filter
      // (visto en algunas versiones para fields custom).
      if (
        Number.isFinite(de) &&
        String(q.DocumentStatus) === 'bost_Close' &&
        String(q.Cancelled) !== 'tYES'
      ) {
        closedSet.add(de);
      }
    }
  }
  return { ok: true, closedSet, scanned };
}

/**
 * Handler principal. Se invoca desde un scheduled CF trigger.
 *
 * @param {SyncQuotationClosuresDeps} deps
 * @returns {Promise<SyncQuotationClosuresResult>}
 */
export async function syncSapQuotationClosures(deps) {
  const log = deps.log || (() => {});
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const closedLookahead = deps.closedLookahead ?? DEFAULT_CLOSED_LOOKAHEAD;
  const nowFn = deps.now || (() => new Date());

  const candidates = await listCandidatePedidos(deps, batchSize);
  log('[sync-quot-closures] start', { candidates: candidates.length });

  if (candidates.length === 0) {
    return { checked: 0, closedInApp: 0, sapClosedScanned: 0, errors: 0 };
  }

  const session = await sapLogin(deps);
  let closedInApp = 0;
  let sapClosedScanned = 0;
  let errors = 0;
  try {
    const result = await fetchClosedQuotations(session, deps, closedLookahead);
    if (!result.ok) {
      log('[sync-quot-closures] SAP fetch failed', { error: result.error });
      return {
        checked: candidates.length,
        closedInApp: 0,
        sapClosedScanned: 0,
        errors: candidates.length,
      };
    }
    sapClosedScanned = result.scanned;
    const closedSet = result.closedSet;
    log('[sync-quot-closures] SAP scan done', {
      sapClosedScanned,
      candidatesToCheck: candidates.length,
    });

    for (const c of candidates) {
      if (!closedSet.has(c.sqDocEntry)) continue;
      try {
        const nowIso = nowFn().toISOString();
        // Read-modify-write para preservar los otros campos de transferidoSAP.
        // Aceptamos race: si el pedido cambió state (facturación, cobro) entre
        // el read y write, el mismo update no bloquea nada — closedAt es last-
        // write-wins, y el listener del Planner igual lo remueve del Kanban.
        // Los campos qtyInvoiced/paidStatus persisten sin ser tocados.
        const docRef = deps.fbDb.doc(`pedidos/${c.id}`);
        const snap = await docRef.get();
        if (!snap.exists) {
          log('[sync-quot-closures] pedido gone', { pedidoId: c.id });
          continue;
        }
        const data = snap.data() || {};
        if (data.closedAt) continue; // ya cerrado en otro tick, skip
        const existingTsap = data.transferidoSAP || {};
        await docRef.update({
          closedAt: nowIso,
          closedReason: 'sap_manual_close',
          closedBy: 'cf-auto/syncSapQuotationClosures',
          transferidoSAP: {
            ...existingTsap,
            closedManuallyInSap: true,
            sapDocumentStatus: 'bost_Close',
            closedManuallyDetectedAt: nowIso,
          },
        });
        closedInApp++;
        log('[sync-quot-closures] closed', { pedidoId: c.id, sqDocEntry: c.sqDocEntry });
      } catch (e) {
        errors++;
        log('[sync-quot-closures] update Firestore fail', {
          pedidoId: c.id,
          sqDocEntry: c.sqDocEntry,
          err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
        });
      }
    }
  } finally {
    try {
      await sapLogout(session, deps);
    } catch {
      /* swallow */
    }
  }

  log('[sync-quot-closures] done', {
    checked: candidates.length,
    closedInApp,
    sapClosedScanned,
    errors,
  });
  return { checked: candidates.length, closedInApp, sapClosedScanned, errors };
}
