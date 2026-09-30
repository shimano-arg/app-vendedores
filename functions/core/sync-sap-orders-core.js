// @ts-check
/**
 * v1015 (2026-09-22): sync SAP Sales Orders -> pedidos.transferidoSAP.orderDocEntry.
 * v1054 (2026-09-24): guardar tambien `orderDocNum` para badge visible en la card.
 *
 * v1102 (2026-09-30) — REESCRITURA: cambio de "reverse map scan" a
 * "NumAtCard targeted lookup".
 *
 * Contexto del cambio:
 * El approach previo (v1015 hotfix6-8 + v1045) enumeraba las 2000 SOs más
 * recientes de SAP y buscaba BaseType=23 apuntando a las SQ pending. Falló
 * empíricamente porque la SAP DB de esta company mezcla múltiples BUs
 * (Pesca + Bike + Marketing + Chile) en la misma tabla ORDR. Los 2000 SOs
 * recientes están dominados por bike; las SOs pesca correspondientes a las
 * SQ pending caen fuera del scan. Diagnóstico 2026-09-30: 11 pending SQs
 * pesca en rango 47941..52021 vs 2000 SOs escaneadas en rango 33234..37449
 * con 1890 BaseEntries únicos vistos, **cero matches**. La SO 20067 (REBORN,
 * DocEntry 37382) que SÍ está en scan range apunta a SQ 51970, que no está
 * en pending — coincidencia mala.
 *
 * Approach nuevo: `NumAtCard`. Cada SQ enviada por auto-send-sap-core lleva
 * `NumAtCard = pedidoId` (Firestore doc id). Cuando SAP convierte SQ → SO,
 * el nuevo SO **hereda ese NumAtCard** (confirmado empíricamente 2026-09-30:
 * SO 20067 tiene `NumAtCard: 'P1lcGYlt0HUt0sytfTqn'` = el pedidoId de REBORN).
 * Filter directo funciona: `$filter=NumAtCard eq '<pedidoId>'`.
 *
 * Costo: 1 GET por pending × batch=100 = ~100 GETs/tick. Similar al scan
 * pero determinístico — cubre TODA la historia SAP, no una ventana LOOKAHEAD.
 *
 * SL constraints reconfirmados 2026-09-30:
 * - $expand NO funciona en /Quotations ni /Orders (collection ni single-entity):
 *   400 "Cannot expand invalid navigation property 'DocumentLines' for entity
 *   type 'Document'".
 * - Sin $expand, /Quotations(sqDe) NO trae TargetType/TargetEntry (solo
 *   POTarget* que está en null).
 * - Sin $expand, /Orders sí trae DocumentLines inline con BaseType/BaseEntry
 *   (visto empíricamente en logs).
 *
 * v1053 anti-race guard (documentado en sync-sap-quotation-closures-core.js):
 * si `syncSapQuotationClosures` corre entre el momento en que SAP convierte
 * SQ → SO y el momento en que esta CF setea `orderDocEntry`, el pedido queda
 * marcado como `closedManuallyInSap:true` + `closedAt`, y NO aparece más en
 * pending (listPendingPedidos filtra por closedAt=null). Este core NO
 * recupera esos race victims — hay que arreglarlos manualmente o vía script
 * one-shot (ver scripts/repair-quotation-closure-race-victims.mjs).
 */

import { sapGet, sapLogin, sapLogout } from './sap-sl-client.js';

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
 *
 * @param {SyncOrdersDeps} deps
 * @param {number} limit
 * @returns {Promise<Array<{id: string, sqDocEntry: number}>>}
 */
async function listPendingPedidos(deps, limit) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id: string, sqDocEntry: number}>} */
  const pending = [];
  snap.forEach((/** @type {any} */ d) => {
    const data = d.data() || {};
    const t = data.transferidoSAP || {};
    const sqDocEntry = Number(t.docEntry);
    // Precondicion: SQ creada en SAP (docEntry seteado) + SO todavia no
    // reflejada (orderDocNum ausente o null).
    if (Number.isFinite(sqDocEntry) && sqDocEntry > 0 && !t.orderDocNum) {
      pending.push({ id: d.id, sqDocEntry });
    }
  });
  // Orden por sqDocEntry asc: los más viejos primero.
  pending.sort((a, b) => a.sqDocEntry - b.sqDocEntry);
  return pending.slice(0, limit);
}

/**
 * Busca en SAP la SO cuyo `NumAtCard` matchea el pedidoId dado. Retorna la
 * SO más reciente (mayor DocEntry) o null si no hay.
 *
 * @param {import('./sap-sl-client.js').SapSession} session
 * @param {SyncOrdersDeps} deps
 * @param {string} pedidoId
 * @returns {Promise<{docEntry: number, docNum: number|null} | null>}
 */
export async function findSoByNumAtCard(session, deps, pedidoId) {
  const escaped = String(pedidoId).replace(/'/g, "''");
  const endpoint =
    '/b1s/v1/Orders' +
    `?$filter=${encodeURIComponent(`NumAtCard eq '${escaped}'`)}` +
    `&$select=${encodeURIComponent('DocEntry,DocNum')}`;
  const r = await sapGet(session, endpoint, deps);
  if (r.status !== 200) {
    throw new Error(`findSoByNumAtCard status=${r.status} pedidoId=${pedidoId}`);
  }
  const rows = (r.body && r.body.value) || [];
  if (rows.length === 0) return null;
  // Múltiples matches (raro): tomar la más reciente (mayor DocEntry).
  rows.sort((a, b) => Number(b.DocEntry) - Number(a.DocEntry));
  const so = rows[0];
  const docEntry = Number(so.DocEntry);
  if (!Number.isFinite(docEntry) || docEntry <= 0) return null;
  const docNumRaw = Number(so.DocNum);
  const docNum = Number.isFinite(docNumRaw) ? docNumRaw : null;
  return { docEntry, docNum };
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
        const so = await findSoByNumAtCard(session, deps, p.id);
        if (!so) {
          misses++;
          continue;
        }
        /** @type {Record<string, any>} */
        const patch = {
          'transferidoSAP.orderDocEntry': so.docEntry,
          'transferidoSAP.orderSyncedAt': new Date().toISOString(),
        };
        if (so.docNum !== null) patch['transferidoSAP.orderDocNum'] = so.docNum;
        await deps.fbDb.doc(`pedidos/${p.id}`).update(patch);
        hits++;
        log('[sync-orders] hit', {
          pedidoId: p.id,
          sqDocEntry: p.sqDocEntry,
          soDocEntry: so.docEntry,
          soDocNum: so.docNum,
        });
      } catch (e) {
        errors++;
        log('[sync-orders] error', {
          pedidoId: p.id,
          sqDocEntry: p.sqDocEntry,
          err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
        });
      }
    }
  } finally {
    try {
      await sapLogout(session, deps);
    } catch (_e) {
      /* silent */
    }
  }

  log('[sync-orders] done', { checked: pending.length, hits, misses, errors });
  return { checked: pending.length, hits, misses, errors };
}
