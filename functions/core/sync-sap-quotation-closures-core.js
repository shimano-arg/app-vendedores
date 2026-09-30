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
 * @property {any} [FieldValue] firestore.FieldValue (para .delete() en race-victim repair).
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
  // v1102: dos queries — pedidos abiertos (comportamiento original) + pedidos
  // marcados closedManuallyInSap:true (one-shot recheck de race victims v1095).
  // Con el guard v1102 por NumAtCard, si un pedido fue marcado erróneamente
  // como manual close pero en realidad tiene SO derivada, el handler lo
  // salva automáticamente (unset closure flags + set orderDocEntry).
  // Cuando ya no queden race victims, esta segunda query devuelve 0 resultados
  // y no genera overhead adicional.
  const snapOpen = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  const snapClosedManually = await deps.fbDb
    .collection('pedidos')
    .where('transferidoSAP.closedManuallyInSap', '==', true)
    .get();
  /** @type {Array<{id: string, sqDocEntry: number, alreadyClosed?: boolean}>} */
  const candidates = [];
  /** @type {Set<string>} */
  const seenIds = new Set();
  /**
   * @param {any} d
   * @param {boolean} alreadyClosed
   */
  const push = (d, alreadyClosed) => {
    if (seenIds.has(d.id)) return;
    const data = d.data() || {};
    const t = data.transferidoSAP || {};
    const sqDocEntry = Number(t.docEntry);
    if (!Number.isFinite(sqDocEntry) || sqDocEntry <= 0) return;
    if (t.orderDocEntry) return;
    if (!alreadyClosed && t.closedManuallyInSap) return; // ya cerrados van al otro snap
    if (data.paidStatus === 'partial' || data.paidStatus === 'paid') return;
    const lineas = Array.isArray(data.lines)
      ? data.lines
      : Array.isArray(data.items)
        ? data.items
        : [];
    if (lineas.some((/** @type {any} */ l) => (Number(l?.qtyInvoiced) || 0) > 0)) return;
    candidates.push({ id: d.id, sqDocEntry, alreadyClosed });
    seenIds.add(d.id);
  };
  snapOpen.forEach((/** @type {any} */ d) => push(d, false));
  snapClosedManually.forEach((/** @type {any} */ d) => push(d, true));
  candidates.sort(
    (/** @type {{sqDocEntry: number}} */ a, /** @type {{sqDocEntry: number}} */ b) =>
      a.sqDocEntry - b.sqDocEntry
  );
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
 * v1095 (2026-09-29): fetch SQs que YA tienen SO derivada — anti-race guard.
 * Enumera /Orders paginado desc y extrae los BaseEntry cuando BaseType=23
 * (Quotation). Devuelve Set<sqDocEntry> con las SQs que se convirtieron a SO.
 *
 * Precedente SOLEDAD SANCHEZ (SQ 2000241 → SO 20056): el CF cerraba
 * pedidos-app como sap_manual_close cuando la SQ estaba bost_Close, pero
 * bost_Close también dispara cuando la SQ se convierte a SO. Race: el CF
 * corría antes que syncSapOrdersToApp seteara orderDocEntry en el pedido,
 * y cerraba erroneamente. Este guard lo evita.
 *
 * @param {import('./sap-sl-client.js').SapSession} session
 * @param {SyncQuotationClosuresDeps} deps
 * @param {number} closedLookahead
 * @returns {Promise<{ok: true, derivedSqSet: Set<number>, scanned: number} | {ok: false, error: string}>}
 */
export async function fetchQuotationsWithDerivedOrder(session, deps, closedLookahead) {
  const PAGE_SIZE = 20;
  /** @type {Set<number>} */
  const derivedSqSet = new Set();
  let scanned = 0;
  for (let skip = 0; skip < closedLookahead; skip += PAGE_SIZE) {
    const endpoint =
      '/b1s/v1/Orders' +
      `?$select=${encodeURIComponent('DocEntry,DocumentLines')}` +
      '&$orderby=DocEntry desc' +
      `&$skip=${skip}`;
    let resp;
    try {
      resp = await sapGet(session, endpoint, deps);
    } catch (e) {
      return {
        ok: false,
        error: 'sapGet Orders threw: ' + ((e && /** @type {any} */ (e).message) || String(e)),
      };
    }
    if (resp.status !== 200) {
      return { ok: false, error: `SL Orders GET status=${resp.status}` };
    }
    const rows = resp.body && Array.isArray(resp.body.value) ? resp.body.value : [];
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const o of rows) {
      const lines = Array.isArray(o.DocumentLines) ? o.DocumentLines : [];
      for (const l of lines) {
        const baseType = Number(l.BaseType);
        const baseEntry = Number(l.BaseEntry);
        if (baseType === 23 && Number.isFinite(baseEntry) && baseEntry > 0) {
          derivedSqSet.add(baseEntry);
        }
      }
    }
  }
  return { ok: true, derivedSqSet, scanned };
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

    // v1102 (2026-09-30): ANTI-RACE guard reescrito. El v1095 usaba
    // `fetchQuotationsWithDerivedOrder` que enumeraba las 2000 SOs recientes
    // globales (todas las BUs mezcladas). En prod la mayoría son bike, así
    // que las SOs pesca correspondientes a las SQ pending caen fuera del scan
    // y el guard NO detecta la race. Precedente REBORN 2026-09-29 (SQ 2000244
    // → SO 20067): la CF marcó `sap_manual_close` erróneamente.
    //
    // Nuevo approach: para cada candidato en bost_Close, hacer un GET
    // targeted /Orders?$filter=NumAtCard eq '<pedidoId>'. Si hay match, es
    // race víctima — saltear (o mejor: poblar orderDocEntry directamente para
    // evitar depender de otro tick del sync).
    //
    // Costo extra: 1 GET por candidato en bost_Close. Steady state esto es
    // ~1-5 candidatos por tick, costo despreciable.
    for (const _c of candidates) {
      const c = /** @type {{id: string, sqDocEntry: number, alreadyClosed?: boolean}} */ (_c);
      if (!closedSet.has(c.sqDocEntry)) continue;
      // Chequeo anti-race: ¿tiene la SQ una SO derivada?
      let derivedSo = null;
      try {
        const escaped = String(c.id).replace(/'/g, "''");
        const rSo = await sapGet(
          session,
          '/b1s/v1/Orders' +
            `?$filter=${encodeURIComponent(`NumAtCard eq '${escaped}'`)}` +
            `&$select=${encodeURIComponent('DocEntry,DocNum')}`,
          deps
        );
        if (rSo.status === 200) {
          const rows = (rSo.body && rSo.body.value) || [];
          if (rows.length > 0) {
            rows.sort(
              (/** @type {any} */ a, /** @type {any} */ b) =>
                Number(b.DocEntry) - Number(a.DocEntry)
            );
            const soDe = Number(rows[0].DocEntry);
            const soDnRaw = Number(rows[0].DocNum);
            if (Number.isFinite(soDe) && soDe > 0) {
              derivedSo = { docEntry: soDe, docNum: Number.isFinite(soDnRaw) ? soDnRaw : null };
            }
          }
        }
      } catch (e) {
        log('[sync-quot-closures] anti-race NumAtCard GET fallo (fail-open)', {
          pedidoId: c.id,
          err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
        });
      }
      if (derivedSo) {
        // Race víctima: SQ bost_Close por conversión a SO. Salvar poblando
        // orderDocEntry/orderDocNum directamente + (si aplica) limpiar los
        // closure flags que quedaron mal seteados por corridas previas (v1095).
        try {
          const nowIso = nowFn().toISOString();
          /** @type {Record<string, any>} */
          const patch = {
            'transferidoSAP.orderDocEntry': derivedSo.docEntry,
            'transferidoSAP.orderSyncedAt': nowIso,
          };
          if (derivedSo.docNum !== null) {
            patch['transferidoSAP.orderDocNum'] = derivedSo.docNum;
          }
          if (c.alreadyClosed) {
            // Fix retroactivo: pedido ya-cerrado erróneamente por v1095. Limpiar.
            const delSentinel =
              deps.FieldValue && typeof deps.FieldValue.delete === 'function'
                ? deps.FieldValue.delete()
                : null;
            patch.closedAt = delSentinel;
            patch.closedReason = delSentinel;
            patch.closedBy = delSentinel;
            patch['transferidoSAP.closedManuallyInSap'] = delSentinel;
            patch['transferidoSAP.sapDocumentStatus'] = delSentinel;
            patch['transferidoSAP.closedManuallyDetectedAt'] = delSentinel;
            patch['transferidoSAP.raceVictimRepairedAt'] = nowIso;
          }
          await deps.fbDb.doc(`pedidos/${c.id}`).update(patch);
          log('[sync-quot-closures] race-victim salvage', {
            pedidoId: c.id,
            sqDocEntry: c.sqDocEntry,
            soDocEntry: derivedSo.docEntry,
            soDocNum: derivedSo.docNum,
            wasAlreadyClosed: c.alreadyClosed || false,
          });
        } catch (e) {
          errors++;
          log('[sync-quot-closures] race-victim salvage fail', {
            pedidoId: c.id,
            err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
          });
        }
        continue;
      }
      // v1102: pedidos ya-cerrados (`alreadyClosed=true`) que NO son race
      // victims son cierres manuales legítimos — dejarlos como están.
      if (c.alreadyClosed) continue;
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
