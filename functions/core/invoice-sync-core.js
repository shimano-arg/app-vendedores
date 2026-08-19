// @ts-check
/**
 * E2: sync SAP Invoices -> pedidos-app (SHADOW MODE).
 *
 * Objetivo: cuando una Invoice se emite en SAP y su lineage remonta a
 * una SQ que originalmente creo la app (via sap-auto-send-listener),
 * marcar la linea del pedido-app como facturada (qtyInvoiced += qty).
 *
 * Lineage esperado: Invoice.Line.BaseType=17 (SO) -> SO.Line.BaseType=23 (SQ) -> pedidos-app
 * (matcheado por transferidoSAP.docEntry == sqDocEntry).
 *
 * MODOS:
 *   - 'shadow' (default): NO modifica pedidos. Solo escribe log a
 *     sap_sync_log con lo que HUBIERA hecho. Para validacion pre-cutover.
 *   - 'active' (E5 cutover): modifica pedidos.items[].qtyInvoiced +
 *     cierra pedido si todas las lineas estan facturadas.
 *
 * CURSOR:
 *   - Trackea ultimo DocEntry de Invoice procesado en
 *     app_config/sap_sync_state.lastInvoiceDocEntry
 *   - Query: /Invoices?$filter=DocEntry gt cursor&$orderby=DocEntry&$top=100
 *
 * Testeable con mocks de fetch + fbDb (Firestore).
 */

import { sapGet, sapLogin, sapLogout } from './sap-sl-client.js';

const BASE_TYPE_ORDER = 17; // Sales Order (Invoice -> SO)
const BASE_TYPE_QUOTATION = 23; // Sales Quotation (SO -> SQ)
const DEFAULT_BATCH_SIZE = 100;
const SYNC_STATE_DOC = 'app_config/sap_sync_state';

/**
 * @typedef {Object} InvoiceSyncDeps
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {number} [batchSize] Cuantas Invoices por corrida (default 100).
 *
 * @typedef {Object} SyncMatch
 * @property {number} invoiceDocEntry
 * @property {number|string} invoiceDocNum
 * @property {string} invoiceDocDate
 * @property {string} cardCode
 * @property {number} sqDocEntry
 * @property {number|null} soDocEntry
 * @property {string} pedidoAppId
 * @property {Array<{itemCode: string, qty: number, lineNum: number}>} lines
 *
 * @typedef {Object} SyncOrphan
 * @property {number} invoiceDocEntry
 * @property {number|string} invoiceDocNum
 * @property {'no_lineage_to_sq'|'no_pedido_match'|'multi_pedido_match'|'so_fetch_failed'} reason
 * @property {string} [detail]
 *
 * @typedef {Object} SyncResult
 * @property {number} cursorBefore
 * @property {number} cursorAfter
 * @property {number} invoicesRead
 * @property {SyncMatch[]} matches
 * @property {SyncOrphan[]} orphans
 * @property {string[]} errors
 * @property {'shadow'|'active'} mode
 */

/**
 * Lee el cursor actual de Firestore (app_config/sap_sync_state).
 * @param {InvoiceSyncDeps} deps
 * @returns {Promise<number>}
 */
async function readCursor(deps) {
  const doc = await deps.fbDb.doc(SYNC_STATE_DOC).get();
  if (!doc.exists) return 0;
  const data = doc.data() || {};
  return Number(data.lastInvoiceDocEntry || 0);
}

/**
 * Escribe el cursor + timestamp del ultimo run.
 * @param {InvoiceSyncDeps} deps
 * @param {number} cursor
 * @param {'shadow'|'active'} mode
 */
async function writeCursor(deps, cursor, mode) {
  await deps.fbDb.doc(SYNC_STATE_DOC).set(
    {
      lastInvoiceDocEntry: cursor,
      lastRunAt: new Date().toISOString(),
      mode,
    },
    { merge: true }
  );
}

/**
 * Lee el modo actual del sync desde Firestore. Default 'shadow' si no existe.
 * @param {InvoiceSyncDeps} deps
 * @returns {Promise<'shadow'|'active'>}
 */
export async function readSyncMode(deps) {
  const doc = await deps.fbDb.doc(SYNC_STATE_DOC).get();
  if (!doc.exists) return 'shadow';
  const data = doc.data() || {};
  return data.mode === 'active' ? 'active' : 'shadow';
}

/**
 * Query SAP: /Invoices?$filter=DocEntry gt cursor&$select=...&$orderby=DocEntry&$top=batch
 * @param {any} session
 * @param {number} cursor
 * @param {number} batchSize
 * @param {InvoiceSyncDeps} deps
 * @returns {Promise<any[]>} Array de Invoices con DocumentLines expandidas.
 */
async function fetchInvoices(session, cursor, batchSize, deps) {
  const select = 'DocEntry,DocNum,DocDate,DocumentStatus,CardCode,CardName,DocumentLines';
  const endpoint =
    `/b1s/v1/Invoices?$filter=DocEntry gt ${cursor}` +
    `&$select=${encodeURIComponent(select)}` +
    `&$orderby=DocEntry&$top=${batchSize}`;
  const res = await sapGet(session, endpoint, deps);
  if (res.status !== 200) {
    throw new Error(`fetchInvoices status=${res.status}`);
  }
  return (res.body && res.body.value) || [];
}

/**
 * Query SAP: /Orders({soDocEntry})?$select=DocEntry,DocumentLines
 * @param {any} session
 * @param {number} soDocEntry
 * @param {InvoiceSyncDeps} deps
 * @returns {Promise<any|null>}
 */
async function fetchSalesOrder(session, soDocEntry, deps) {
  const endpoint = `/b1s/v1/Orders(${soDocEntry})?$select=DocEntry,DocumentLines`;
  const res = await sapGet(session, endpoint, deps);
  if (res.status !== 200) return null;
  return res.body || null;
}

/**
 * Dada una Invoice, resuelve el sqDocEntry a partir del lineage.
 * Invoice.Line.BaseType=17 -> SO.DocEntry.
 * Luego SO.Line.BaseType=23 -> SQ.DocEntry.
 *
 * Puede haber multiples SQ referenciadas si una SO se armo con lineas de
 * varias SQ. Devolvemos array de {sqDocEntry, soDocEntry, itemCode, qty, lineNum}.
 *
 * @param {any} session
 * @param {any} invoice
 * @param {InvoiceSyncDeps} deps
 * @returns {Promise<{sqDocEntry: number, soDocEntry: number, itemCode: string, qty: number, lineNum: number}[]>}
 */
async function resolveLineage(session, invoice, deps) {
  const out = [];
  const lines = invoice.DocumentLines || [];
  // Cache de SO fetches para evitar re-fetch de la misma SO si aparece
  // en multiples lineas de la invoice.
  const soCache = new Map();

  for (const line of lines) {
    if (line.BaseType !== BASE_TYPE_ORDER) continue; // solo lineas Invoice->SO
    const soDocEntry = Number(line.BaseEntry);
    if (!soDocEntry) continue;

    /** @type {any} */
    let so;
    if (soCache.has(soDocEntry)) {
      so = soCache.get(soDocEntry);
    } else {
      so = await fetchSalesOrder(session, soDocEntry, deps);
      soCache.set(soDocEntry, so);
    }
    if (!so || !Array.isArray(so.DocumentLines)) continue;

    // BaseLine matchea line-por-line entre Invoice.Line y SO.Line.
    const soLine = so.DocumentLines.find(
      (/** @type {any} */ l) => Number(l.LineNum) === Number(line.BaseLine)
    );
    if (!soLine) continue;
    if (soLine.BaseType !== BASE_TYPE_QUOTATION) continue;

    const sqDocEntry = Number(soLine.BaseEntry);
    if (!sqDocEntry) continue;

    out.push({
      sqDocEntry,
      soDocEntry,
      itemCode: line.ItemCode,
      qty: Number(line.Quantity) || 0,
      lineNum: Number(line.LineNum) || 0,
    });
  }

  return out;
}

/**
 * Busca pedidos-app que matcheen los sqDocEntry dados. Devuelve
 * un Map<sqDocEntry, [pedidoAppId]> (puede haber multiples pedidos que
 * apunten al mismo sqDocEntry — anomalia, se reporta como orphan).
 *
 * @param {InvoiceSyncDeps} deps
 * @param {number[]} sqDocEntries
 * @returns {Promise<Map<number, string[]>>}
 */
async function findPedidosBySqDocEntry(deps, sqDocEntries) {
  const result = new Map();
  if (!sqDocEntries.length) return result;
  // Firestore no permite `in` con >30 valores en el mismo query.
  const chunks = [];
  for (let i = 0; i < sqDocEntries.length; i += 30) {
    chunks.push(sqDocEntries.slice(i, i + 30));
  }
  for (const chunk of chunks) {
    const snap = await deps.fbDb
      .collection('pedidos')
      .where('transferidoSAP.docEntry', 'in', chunk)
      .get();
    snap.forEach((/** @type {any} */ doc) => {
      const data = doc.data() || {};
      const de = Number(data.transferidoSAP && data.transferidoSAP.docEntry);
      if (!de) return;
      const list = result.get(de) || [];
      list.push(doc.id);
      result.set(de, list);
    });
  }
  return result;
}

/**
 * Aplica un match Invoice->pedido: incrementa qtyInvoiced en las lineas
 * correspondientes, recalcula qtyOpen, marca state='invoiced' si qtyOpen<=0,
 * cierra el pedido si TODAS las lineas quedaron cerradas.
 *
 * IDEMPOTENCIA: cada pedido lleva sapLinkage.appliedInvoiceDocEntries[]. Si
 * este invoiceDocEntry ya esta, retorna null (skip). Sin esta guardia, un
 * rerun de la CF (o un reprocesamiento manual) duplicaria qtyInvoiced.
 *
 * MATCHING POR SKU: SAP puede tener varias lineas con el mismo itemCode en
 * una Invoice (poco frecuente pero posible). Sumamos todas antes de asignar
 * a la (unica) linea del pedido con ese code.
 *
 * ATOMICIDAD: read-then-update sin transaccion. Race window: si dos ticks
 * simultaneos leen la misma pedido antes de escribir, uno pisa al otro. La
 * chance es baja (CF single-instance por defecto) pero real. Mejora futura:
 * runTransaction. Por ahora la guardia de appliedInvoiceDocEntries mitiga
 * el double-count si detectamos el race post-facto.
 *
 * @param {InvoiceSyncDeps} deps
 * @param {SyncMatch} match
 * @returns {Promise<{ closed: boolean } | null>} null si skip por idempotencia
 */
export async function applyInvoiceMatch(deps, match) {
  const pedidoRef = deps.fbDb.collection('pedidos').doc(match.pedidoAppId);
  const snap = await pedidoRef.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const sapLinkage = data.sapLinkage || {};
  const applied = Array.isArray(sapLinkage.appliedInvoiceDocEntries)
    ? sapLinkage.appliedInvoiceDocEntries
    : [];
  if (applied.includes(match.invoiceDocEntry)) return null; // idempotent

  // Sumar qty por itemCode (SAP puede tener multiples lineas mismo SKU).
  /** @type {Map<string, number>} */
  const invoicedByCode = new Map();
  for (const il of match.lines || []) {
    const code = String(il.itemCode || '').toUpperCase();
    if (!code) continue;
    invoicedByCode.set(code, (invoicedByCode.get(code) || 0) + (Number(il.qty) || 0));
  }

  const lines = Array.isArray(data.lines) ? [...data.lines] : [];
  let anyLineChanged = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || !l.code) continue;
    const up = String(l.code).toUpperCase();
    const invNow = invoicedByCode.get(up);
    if (!invNow) continue;
    const qty = Number(l.qty) || 0;
    const already = Number(l.qtyInvoiced) || 0;
    const cancelled = Number(l.qtyCancelled) || 0;
    const recycled = Number(l.qtyRecycled) || 0;
    const newInvoiced = already + invNow;
    const qtyOpen = Math.max(qty - newInvoiced - cancelled - recycled, 0);
    /** @type {Record<string, any>} */
    const patch = { qtyInvoiced: newInvoiced, qtyOpen };
    if (qtyOpen <= 0 && l.state !== 'invoiced' && l.state !== 'cancelled') {
      patch.state = 'invoiced';
    }
    lines[i] = Object.assign({}, l, patch);
    anyLineChanged = true;
  }
  if (!anyLineChanged) return null;

  const nowIso = new Date().toISOString();
  const anyStillOpen = lines.some((l) => (Number(l && l.qtyOpen) || 0) > 0);
  /** @type {Record<string, any>} */
  const update = {
    lines,
    updatedAt: nowIso,
    sapLinkage: Object.assign({}, sapLinkage, {
      lastInvoiceDocEntry: match.invoiceDocEntry,
      lastSyncAt: nowIso,
      appliedInvoiceDocEntries: [...applied, match.invoiceDocEntry],
    }),
  };
  let closed = false;
  if (!anyStillOpen && !data.closedAt) {
    update.closedAt = nowIso;
    update.closedReason = 'all_invoiced';
    closed = true;
  }
  await pedidoRef.update(update);
  return { closed };
}

/**
 * Ejecuta un run del sync.
 * @param {InvoiceSyncDeps} deps
 * @returns {Promise<SyncResult>}
 */
export async function syncSapInvoices(deps) {
  const log = deps.log || (() => {});
  const batchSize = deps.batchSize || DEFAULT_BATCH_SIZE;
  const mode = await readSyncMode(deps);
  const cursorBefore = await readCursor(deps);

  /** @type {SyncMatch[]} */
  const matches = [];
  /** @type {SyncOrphan[]} */
  const orphans = [];
  /** @type {string[]} */
  const errors = [];

  let session;
  try {
    session = await sapLogin(deps);
  } catch (e) {
    errors.push(`sapLogin: ${String(e)}`);
    return {
      cursorBefore,
      cursorAfter: cursorBefore,
      invoicesRead: 0,
      matches,
      orphans,
      errors,
      mode,
    };
  }

  let invoicesRead = 0;
  let maxDocEntry = cursorBefore;

  try {
    const invoices = await fetchInvoices(session, cursorBefore, batchSize, deps);
    invoicesRead = invoices.length;

    // 1) Resolver lineage de cada invoice
    /** @type {Map<number, {invoice: any, lineage: Array<{sqDocEntry: number, soDocEntry: number, itemCode: string, qty: number, lineNum: number}>}>} */
    const perInvoice = new Map();
    const allSqDocEntries = new Set();
    for (const inv of invoices) {
      const docEntry = Number(inv.DocEntry);
      if (docEntry > maxDocEntry) maxDocEntry = docEntry;
      try {
        const lineage = await resolveLineage(session, inv, deps);
        perInvoice.set(docEntry, { invoice: inv, lineage });
        for (const l of lineage) allSqDocEntries.add(l.sqDocEntry);
        if (!lineage.length) {
          orphans.push({
            invoiceDocEntry: docEntry,
            invoiceDocNum: inv.DocNum,
            reason: 'no_lineage_to_sq',
            detail: `Invoice sin lineas BaseType=17->23`,
          });
        }
      } catch (e) {
        orphans.push({
          invoiceDocEntry: docEntry,
          invoiceDocNum: inv.DocNum,
          reason: 'so_fetch_failed',
          detail: String(e),
        });
      }
    }

    // 2) Batch query a Firestore para matchear sqDocEntry -> pedidoAppId
    const sqToPedidos = await findPedidosBySqDocEntry(deps, Array.from(allSqDocEntries));

    // 3) Armar matches / orphans
    for (const [docEntry, { invoice, lineage }] of perInvoice) {
      if (!lineage.length) continue; // ya reportado arriba
      const linesBySq = new Map();
      for (const l of lineage) {
        const arr = linesBySq.get(l.sqDocEntry) || [];
        arr.push(l);
        linesBySq.set(l.sqDocEntry, arr);
      }
      for (const [sqDocEntry, lines] of linesBySq) {
        const pedidoIds = sqToPedidos.get(sqDocEntry) || [];
        if (!pedidoIds.length) {
          orphans.push({
            invoiceDocEntry: docEntry,
            invoiceDocNum: invoice.DocNum,
            reason: 'no_pedido_match',
            detail: `sqDocEntry=${sqDocEntry} sin pedido-app`,
          });
          continue;
        }
        if (pedidoIds.length > 1) {
          orphans.push({
            invoiceDocEntry: docEntry,
            invoiceDocNum: invoice.DocNum,
            reason: 'multi_pedido_match',
            detail: `sqDocEntry=${sqDocEntry} matchea ${pedidoIds.length} pedidos: ${pedidoIds.join(',')}`,
          });
          continue;
        }
        matches.push({
          invoiceDocEntry: docEntry,
          invoiceDocNum: invoice.DocNum,
          invoiceDocDate: invoice.DocDate || '',
          cardCode: invoice.CardCode || '',
          sqDocEntry,
          soDocEntry: lines[0] ? lines[0].soDocEntry : null,
          pedidoAppId: pedidoIds[0],
          lines: lines.map((/** @type {any} */ l) => ({
            itemCode: l.itemCode,
            qty: l.qty,
            lineNum: l.lineNum,
          })),
        });
      }
    }

    // 4) En modo 'active' (E5 cutover), aplicar los matches a los pedidos.
    // Idempotencia: cada linea del pedido trackea sapLinkage.appliedInvoiceDocEntries
    // -> un rerun no duplica qtyInvoiced. Errores individuales van a errors[]
    // sin abortar el batch (los pedidos que si aplican quedan actualizados;
    // los que fallan quedan intactos y no vuelven a intentarse hasta que la
    // Invoice reaparezca — no reaparece porque el cursor ya avanzo).
    if (mode === 'active') {
      for (const match of matches) {
        try {
          const applied = await applyInvoiceMatch(deps, match);
          if (applied)
            log('applyInvoiceMatch OK', {
              pedidoAppId: match.pedidoAppId,
              invoiceDocEntry: match.invoiceDocEntry,
              closed: applied.closed,
            });
        } catch (e) {
          errors.push(
            `applyInvoiceMatch pedidoAppId=${match.pedidoAppId} invoice=${match.invoiceDocEntry}: ${String(e)}`
          );
        }
      }
    }

    // 5) Escribir cursor
    if (maxDocEntry > cursorBefore) {
      await writeCursor(deps, maxDocEntry, mode);
    }
  } catch (e) {
    errors.push(`syncSapInvoices: ${String(e)}`);
  } finally {
    await sapLogout(session, deps);
  }

  log('syncSapInvoices done', {
    mode,
    cursorBefore,
    cursorAfter: maxDocEntry,
    invoicesRead,
    matches: matches.length,
    orphans: orphans.length,
    errors: errors.length,
  });

  return {
    cursorBefore,
    cursorAfter: maxDocEntry,
    invoicesRead,
    matches,
    orphans,
    errors,
    mode,
  };
}
