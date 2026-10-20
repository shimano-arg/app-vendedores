// @ts-check
/**
 * Fase 2 v1035 (2026-09-22): sync SAP Invoices.PaidToDate → pedidos.paidAmount.
 *
 * Objetivo: cerrar la columna "Cobrado" del Planner Kanban que estaba vacía
 * porque nadie escribía `paidAmount` / `paidStatus` en Firestore.
 *
 * Flujo:
 * 1. Listar pedidos abiertos con `sapLinkage.appliedInvoiceDocEntries` no vacío.
 *    (Estos son los que tienen al menos 1 invoice asociada.)
 * 2. Enum `/Invoices?$orderby=DocEntry desc&$select=DocEntry,DocTotal,PaidToDate`
 *    paginado con $skip (mismo pattern que syncSapOrdersToApp por limitación del
 *    SL de la company — no admite $expand ni $top>20).
 * 3. Build map { docEntry → {DocTotal, PaidToDate} }.
 * 4. Para cada pedido, sumar invoicedAmount + paidAmount desde el map. Los
 *    invoices que no aparecen en el rango del enum (>500 hacia atrás) usan
 *    fallback null — se actualizan en próxima corrida si SAP los devuelve.
 * 5. Escribir en el pedido:
 *      - invoicedAmount (Σ DocTotal)
 *      - paidAmount (Σ PaidToDate)
 *      - paidStatus: 'paid' si paidAmount >= invoicedAmount y ambos > 0
 *                    'partial' si paidAmount > 0 pero < invoicedAmount
 *                    null si paidAmount == 0
 *
 * Con paidStatus='paid', computeColumn Rule 2 mueve el pedido a Cobrado
 * automáticamente en el próximo render del Planner.
 *
 * Idempotente. Cada corrida re-lee TODAS las invoices activas — cambios
 * incrementales (nuevos payments) se reflejan naturalmente.
 *
 * Costo: ~25 GETs por corrida (500 invoices / 20 default page). Cada 15min
 * = 100 GETs/hr — same order of magnitude que syncSapOrdersToApp.
 *
 * NO tiene modo shadow — es un enrichment de fields nuevos, no reemplaza dato
 * existente ni tiene side-effect en SAP. Safe para deploy directo.
 */

import { computeStaleLineClosure } from './close-stale-lines-on-cobrado-core.js';
import { sapGet, sapLogin, sapLogout } from './sap-sl-client.js';

// v1048 (2026-09-23): aumentado 500 → 2000 por mismo motivo que
// syncSapOrdersToApp v1045. SAP DB tiene múltiples BUs — el scan desc de
// invoices puede quedar dominado por otras BUs, dejando invoices Pesca
// viejas fuera. Con LOOKAHEAD=2000, cubrimos ~16 días de volumen contable
// típico. Cost: ~100 GETs/corrida (era 25).
const DEFAULT_INVOICES_LOOKAHEAD = 2000;
const DEFAULT_PAGE_SIZE = 20; // SL default; ignora $top mayor

/**
 * @typedef {Object} PaymentSyncDeps
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {number} [invoicesLookahead] Cuantas invoices scan por corrida (default 500).
 *
 * @typedef {Object} PaymentSyncResult
 * @property {number} pedidosChecked Pedidos con appliedInvoiceDocEntries no vacío
 * @property {number} invoicesScanned Total invoices leídas del SL
 * @property {number} pedidosUpdated Pedidos que efectivamente cambiaron
 * @property {number} pedidosPaidFull Pedidos que quedaron con paidStatus='paid'
 * @property {number} pedidosPaidPartial Pedidos con paidStatus='partial'
 * @property {number} invoicesMissedInWindow Invoices referenciadas pero fuera del rango scan
 * @property {number} errors
 * @property {number} linesClosedStale v1255: lineas cerradas por paid+confirmed/ASIG colgadas (CUDC201XG bug)
 * @property {number} pedidosWithStaleClosure v1255: pedidos distintos que tuvieron >=1 linea cerrada
 */

/**
 * Lista pedidos abiertos con al menos 1 invoice asociada. Devuelve doc data + id.
 *
 * @param {PaymentSyncDeps} deps
 * @returns {Promise<Array<{id: string, data: any}>>}
 */
async function listPedidosWithInvoices(deps) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id: string, data: any}>} */
  const out = [];
  snap.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    const applied = data.sapLinkage?.appliedInvoiceDocEntries;
    if (Array.isArray(applied) && applied.length > 0) {
      out.push({ id: doc.id, data });
    }
  });
  return out;
}

/**
 * Enum /Invoices desc paginado. Devuelve map { docEntry → {DocTotal, PaidToDate} }.
 *
 * @param {any} session
 * @param {PaymentSyncDeps} deps
 * @param {number} lookahead
 * @returns {Promise<{map: Map<number, {docTotal: number, paidToDate: number}>, scanned: number}>}
 */
async function fetchRecentInvoicesPaymentInfo(session, deps, lookahead) {
  const map = new Map();
  let scanned = 0;
  const select = 'DocEntry,DocTotal,PaidToDate';
  for (let skip = 0; skip < lookahead; skip += DEFAULT_PAGE_SIZE) {
    const endpoint =
      `/b1s/v1/Invoices?$select=${encodeURIComponent(select)}` +
      `&$orderby=DocEntry desc&$skip=${skip}&$top=${DEFAULT_PAGE_SIZE}`;
    const res = await sapGet(session, endpoint, deps);
    if (res.status !== 200) {
      throw new Error(`fetchRecentInvoices skip=${skip} status=${res.status}`);
    }
    const rows = (res.body && res.body.value) || [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const de = Number(r.DocEntry);
      if (!de) continue;
      map.set(de, {
        docTotal: Number(r.DocTotal) || 0,
        paidToDate: Number(r.PaidToDate) || 0,
      });
    }
    scanned += rows.length;
    if (rows.length < DEFAULT_PAGE_SIZE) break; // fin de la data
  }
  return { map, scanned };
}

/**
 * Calcula paidStatus según los montos.
 * @param {number} paid
 * @param {number} invoiced
 * @returns {'paid'|'partial'|null}
 */
function calcPaidStatus(paid, invoiced) {
  if (invoiced <= 0) return null;
  if (paid <= 0) return null;
  // Tolerancia 1 peso para redondeos.
  if (paid >= invoiced - 1) return 'paid';
  return 'partial';
}

/**
 * Devuelve el "peso" de un pedido para calcular su share de una invoice
 * consolidada. Usa netAmountArs / subtotalArs / totalAmountArs como proxy
 * del tamaño del pedido en la invoice compartida.
 *
 * @param {any} data
 * @returns {number}
 */
function pedidoNetForShare(data) {
  if (typeof data.netAmountArs === 'number' && data.netAmountArs > 0) return data.netAmountArs;
  if (typeof data.subtotalArs === 'number' && data.subtotalArs > 0) return data.subtotalArs;
  if (typeof data.totalAmountArs === 'number' && data.totalAmountArs > 0)
    return data.totalAmountArs;
  return 0;
}

/**
 * Aplica el update a un pedido si los valores cambian.
 *
 * v1042 (2026-09-23): fix invoice consolidadas. Si una invoice está linkeada
 * a >1 pedido (factura SAP que agrupa líneas de varias SQs), splitear el
 * DocTotal + PaidToDate proporcional al `netAmountArs` de cada pedido para
 * NO duplicar el monto.
 *
 * @param {PaymentSyncDeps} deps
 * @param {string} pedidoId
 * @param {any} data
 * @param {Map<number, {docTotal: number, paidToDate: number}>} invoiceMap
 * @param {Map<number, Array<{id: string, net: number}>>} [invoiceShareMap] Optional. Si presente, splitea invoices compartidas.
 * @returns {Promise<{ updated: boolean, missedCount: number, invoicedAmount: number, paidAmount: number, paidStatus: 'paid'|'partial'|null, linesClosedStale: number }>}
 */
export async function applyPaymentUpdate(deps, pedidoId, data, invoiceMap, invoiceShareMap) {
  const applied = data.sapLinkage?.appliedInvoiceDocEntries || [];
  const myNet = pedidoNetForShare(data);
  let invoicedAmount = 0;
  let paidAmount = 0;
  let missedCount = 0;
  for (const de of applied) {
    const info = invoiceMap.get(Number(de));
    if (!info) {
      missedCount++;
      continue;
    }
    // v1042: si la invoice está compartida y tenemos el shareMap, aplicar fracción.
    let fraction = 1;
    if (invoiceShareMap) {
      const shares = invoiceShareMap.get(Number(de));
      if (shares && shares.length > 1) {
        const totalNet = shares.reduce((s, x) => s + (x.net || 0), 0);
        if (totalNet > 0 && myNet > 0) {
          fraction = myNet / totalNet;
        } else {
          // Fallback: split parejo si no tenemos net values.
          fraction = 1 / shares.length;
        }
      }
    }
    invoicedAmount += info.docTotal * fraction;
    paidAmount += info.paidToDate * fraction;
  }
  const paidStatus = calcPaidStatus(paidAmount, invoicedAmount);

  const currInvoiced = typeof data.invoicedAmount === 'number' ? data.invoicedAmount : null;
  const currPaid = typeof data.paidAmount === 'number' ? data.paidAmount : null;
  const currStatus = data.paidStatus || null;
  const amountsChanged =
    currInvoiced !== invoicedAmount || currPaid !== paidAmount || currStatus !== paidStatus;

  // v1281 (2026-10-19): cerrar lineas "colgadas" cuando pedido queda paid=full.
  // Corre SIEMPRE que paidStatus proyectado sea 'paid' (incluso si amounts no
  // cambiaron) para que pedidos ya cobrados pero con lineas state=confirmed/ASIG
  // qtyOpen>0 (incidente CUDC201XG 2026-10-19) se limpien en la proxima pasada.
  // Idempotente: si no hay nada que cerrar, newLines=null y skipeamos.
  //
  // Defensa: envolver en try/catch (silent-failure hunter #2 2026-10-19). Si el
  // helper tira por lines corruptas, logueamos y seguimos con amounts-only
  // update — nunca bloquear el update de amounts por un bug en closure.
  /** @type {{closedLines: Array<any>, newLines: any}} */
  let closure = { closedLines: [], newLines: null };
  try {
    const projectedForClosure = { ...data, paidStatus };
    closure = computeStaleLineClosure(projectedForClosure);
  } catch (e) {
    if (deps.log) {
      try {
        deps.log('syncSapPayments: closure helper failed', { pedidoId, err: String(e) });
      } catch (_logErr) {
        /* silent — logger inyectado no es contractualmente safe */
      }
    }
  }
  const hasClosure = closure.newLines !== null;

  if (!amountsChanged && !hasClosure) {
    return {
      updated: false,
      missedCount,
      invoicedAmount,
      paidAmount,
      paidStatus,
      linesClosedStale: 0,
    };
  }

  const nowIso = new Date().toISOString();

  // Writes separados (silent-failure hunter #2): si el write de lines falla
  // por una linea corrupta >1MiB, no perdemos el update de amounts. El de
  // amounts corre primero porque es el critical path (planner column).
  const docRef = deps.fbDb.collection('pedidos').doc(pedidoId);

  if (amountsChanged) {
    /** @type {Record<string, any>} */
    const amountsPatch = {
      invoicedAmount,
      paidAmount,
      paidStatus,
      paidSyncedAt: nowIso,
    };
    // Planner Kanban timestamp (Bug #2a — "cuánto tiempo lleva en Cobrado"):
    // registrar la primera vez que detectamos pago (paid|partial). Preserva la
    // primera fecha aunque haya ajustes posteriores (nunca se sobrescribe).
    if ((paidStatus === 'paid' || paidStatus === 'partial') && !data.cobradoAt) {
      amountsPatch.cobradoAt = nowIso;
    }
    await docRef.update(amountsPatch);
  }

  let linesClosedStale = 0;
  if (hasClosure) {
    const prevLog = Array.isArray(data.staleLinesLog) ? data.staleLinesLog : [];
    /** @type {Record<string, any>} */
    const closurePatch = {
      lines: closure.newLines,
      staleLinesClosedAt: nowIso,
      staleLinesLog: [
        ...prevLog.slice(-9), // retener solo las últimas 10 entradas
        {
          at: nowIso,
          closed: closure.closedLines,
          reason: 'pedido_paid_full_line_stale',
        },
      ],
    };
    try {
      await docRef.update(closurePatch);
      linesClosedStale = closure.closedLines.length;
      if (deps.log) {
        try {
          deps.log('syncSapPayments: closed stale lines', {
            pedidoId,
            count: closure.closedLines.length,
            skus: closure.closedLines.map((c) => c.code).filter(Boolean),
          });
        } catch (_logErr) {
          /* silent — logger inyectado no es contractualmente safe */
        }
      }
    } catch (e) {
      // No propagamos: el amounts update ya se completo. El closure se re-intentara
      // en la proxima pasada (idempotente). Logueamos para visibility.
      if (deps.log) {
        try {
          deps.log('syncSapPayments: closure write failed', {
            pedidoId,
            err: String(e),
            closedCount: closure.closedLines.length,
          });
        } catch (_logErr) {
          /* silent */
        }
      }
    }
  }

  return {
    updated: true,
    missedCount,
    invoicedAmount,
    paidAmount,
    paidStatus,
    linesClosedStale,
  };
}

/**
 * Handler principal del sync.
 *
 * @param {PaymentSyncDeps} deps
 * @returns {Promise<PaymentSyncResult>}
 */
export async function handleSyncSapPayments(deps) {
  const log = deps.log || (() => {});
  const lookahead = deps.invoicesLookahead || DEFAULT_INVOICES_LOOKAHEAD;

  const pedidos = await listPedidosWithInvoices(deps);
  log('syncSapPayments: listed pedidos', { count: pedidos.length });
  if (pedidos.length === 0) {
    return {
      pedidosChecked: 0,
      invoicesScanned: 0,
      pedidosUpdated: 0,
      pedidosPaidFull: 0,
      pedidosPaidPartial: 0,
      invoicesMissedInWindow: 0,
      errors: 0,
      linesClosedStale: 0,
      pedidosWithStaleClosure: 0,
    };
  }

  const session = await sapLogin(deps);
  let invoicesScanned = 0;
  let invoiceMap;
  try {
    const enumResult = await fetchRecentInvoicesPaymentInfo(session, deps, lookahead);
    invoiceMap = enumResult.map;
    invoicesScanned = enumResult.scanned;
    log('syncSapPayments: invoices scanned', { invoicesScanned });
  } finally {
    try {
      await sapLogout(session, deps);
    } catch (_e) {
      /* silent */
    }
  }

  // v1042 (2026-09-23): build invoiceShareMap para fix de invoices consolidadas.
  // Map: invoiceDocEntry → [{id, net}] con TODOS los pedidos que la referencian.
  // Cuando `applyPaymentUpdate` procese un pedido, si su invoice está en >1
  // entrada, splitea el DocTotal/PaidToDate proporcional al net de cada pedido.
  /** @type {Map<number, Array<{id: string, net: number}>>} */
  const invoiceShareMap = new Map();
  let sharedCount = 0;
  for (const { id, data } of pedidos) {
    const applied = data.sapLinkage?.appliedInvoiceDocEntries || [];
    const net = pedidoNetForShare(data);
    for (const inv of applied) {
      const key = Number(inv);
      let arr = invoiceShareMap.get(key);
      if (!arr) {
        arr = [];
        invoiceShareMap.set(key, arr);
      }
      arr.push({ id, net });
    }
  }
  invoiceShareMap.forEach((arr) => {
    if (arr.length > 1) sharedCount++;
  });
  log('syncSapPayments: invoice share map built', {
    totalInvoices: invoiceShareMap.size,
    sharedInvoices: sharedCount,
  });

  let pedidosUpdated = 0;
  let pedidosPaidFull = 0;
  let pedidosPaidPartial = 0;
  let invoicesMissedInWindow = 0;
  let errors = 0;
  let linesClosedStale = 0;
  let pedidosWithStaleClosure = 0;
  for (const { id, data } of pedidos) {
    try {
      const r = await applyPaymentUpdate(deps, id, data, invoiceMap, invoiceShareMap);
      if (r.updated) pedidosUpdated++;
      if (r.paidStatus === 'paid') pedidosPaidFull++;
      if (r.paidStatus === 'partial') pedidosPaidPartial++;
      invoicesMissedInWindow += r.missedCount;
      if (r.linesClosedStale > 0) {
        linesClosedStale += r.linesClosedStale;
        pedidosWithStaleClosure++;
      }
    } catch (e) {
      errors++;
      log('syncSapPayments: pedido update failed', { pedidoId: id, err: String(e) });
    }
  }

  return {
    pedidosChecked: pedidos.length,
    invoicesScanned,
    pedidosUpdated,
    pedidosPaidFull,
    pedidosPaidPartial,
    invoicesMissedInWindow,
    errors,
    linesClosedStale,
    pedidosWithStaleClosure,
  };
}
