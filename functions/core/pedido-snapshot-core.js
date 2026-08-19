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
const SNAPSHOT_DOC_ACTIVE = 'app_config/stock_snapshot';
const SNAPSHOT_DOC_SHADOW = 'app_config/stock_snapshot_shadow_v3';
const OPEN_STATES = new Set(['BO', 'ASIG']);

/**
 * @typedef {Object} PedidoLine
 * @property {string} code
 * @property {number} qtyOpen
 * @property {'BO'|'ASIG'|'confirmed'|'invoiced'|'cancelled'|'recycled'|'legacy'} state
 *
 * @typedef {Object} PedidoDoc
 * @property {string} clientCardCode
 * @property {PedidoLine[]} lines
 * @property {any} closedAt
 *
 * @typedef {Object} SnapshotDeps
 * @property {any} fbDb Firestore Admin instance.
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
 * Retorna { bo, asig, asigByClient: Map<cardCode, qty> }.
 * @param {PedidoDoc[]} pedidos
 * @param {string} sku
 */
export function aggregateForSku(pedidos, sku) {
  let bo = 0;
  let asig = 0;
  const asigByClient = new Map();
  const skuUp = String(sku).toUpperCase();
  for (const p of pedidos) {
    if (p.closedAt) continue; // pedido cerrado no cuenta
    const lines = p.lines || [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      if (!OPEN_STATES.has(l.state)) continue;
      const q = Number(l.qtyOpen || 0);
      if (q <= 0) continue;
      if (l.state === 'BO') bo += q;
      else if (l.state === 'ASIG') {
        asig += q;
        const cc = String(p.clientCardCode || '').trim();
        if (cc) asigByClient.set(cc, (asigByClient.get(cc) || 0) + q);
      }
    }
  }
  return { bo, asig, asigByClient };
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
 * @param {Map<string, {bo: number, asig: number, asigByClient: Map<string, number>}>} perSku
 */
async function writeSnapshot(deps, snapshotDocPath, perSku) {
  if (!perSku.size) return;
  /** @type {Record<string, number>} */
  const backorderBySkuApp = {};
  /** @type {Record<string, number>} */
  const asigBySkuApp = {};
  /** @type {Record<string, number>} */
  const asigByClientSkuApp = {};
  for (const [sku, agg] of perSku) {
    backorderBySkuApp[sku] = agg.bo;
    asigBySkuApp[sku] = agg.asig;
    for (const [cc, qty] of agg.asigByClient) {
      asigByClientSkuApp[`${cc}::${sku}`] = qty;
    }
  }
  const update = {
    backorderBySkuApp,
    asigBySkuApp,
    asigByClientSkuApp,
    updatedAtApp: new Date().toISOString(),
    sourceApp: 'app_pedidos_v3',
  };
  await deps.fbDb.doc(snapshotDocPath).set(update, { merge: true });
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

  /** @type {Map<string, {bo: number, asig: number, asigByClient: Map<string, number>}>} */
  const perSku = new Map();
  /** @type {Record<string, {bo: number, asig: number}>} */
  const totals = {};
  for (const sku of affectedSkus) {
    const agg = aggregateForSku(pedidos, sku);
    perSku.set(sku, agg);
    totals[sku] = { bo: agg.bo, asig: agg.asig };
  }

  await writeSnapshot(deps, snapshotDoc, perSku);
  log('recalcSnapshotForSkus done', { mode, skus: affectedSkus.size, snapshotDoc });
  return { mode, skusRecalculated: affectedSkus.size, snapshotDoc, totals };
}
