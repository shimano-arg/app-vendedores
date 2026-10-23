// @ts-check
/**
 * §63 Fase 3 Capa 1 (2026-10-23 v1444) — sync SAP catalog + stock → Firestore.
 *
 * Port del core de `scripts/sync_sap_to_firestore.py` a Node para que corra
 * como Cloud Function scheduled cada 5 min (Cloud Scheduler nativo via
 * firebase-functions onSchedule, más confiable que GHA cron que saltea).
 *
 * ALCANCE: solo Items + stock snapshot + product_catalog chunks. BPs, states,
 * backorder audit siguen en el workflow GHA Python (otros endpoints SL,
 * cadencia menos crítica).
 *
 * ESCRITURAS:
 *   - product_catalog/chunk_N          (merge preservando fam/sub/cat/img)
 *   - app_config/product_catalog_meta  ({syncBatchId, totalItems, syncedAt, source})
 *   - app_config/stock_snapshot        ({stock, quantities, warehouseBreakdown,
 *                                        warehouseCommitted, price, preLanzamiento,
 *                                        updatedAt, source, _syncRun})
 *   - operations_log/{auto}            ({type:'stock_sync_run', ...})
 *
 * CAMPO `source` nuevo (§Fase 3 Capa 1):
 *   - 'cf-scheduled'  → esta CF.
 *   - 'gha-cron'      → workflow Python cron.
 *   - 'manual-dispatch' → workflow_dispatch manual.
 *   El último que escribe gana (rollout paralelo 2 días hábiles).
 */

import { acquireSession, releaseSession } from './sap-sl-session.js';

const NON_SALES_WHS = new Set(['05', '06']);
const PESCA_PRICE_LIST_NUM = 12;
const CHUNK_SIZE = 4000;
const SAFETY_MAX_ITEMS = 50000;

/**
 * @typedef {Object} SapConfig
 * @property {string} url
 * @property {string} companyDB
 * @property {string} userName
 * @property {string} password
 * @property {typeof fetch} [fetch]
 */

/**
 * @typedef {Object} SyncDeps
 * @property {any} fbDb Firestore (admin SDK).
 * @property {SapConfig} sapConfig
 * @property {(msg: string, extra?: any) => void} [log]
 * @property {() => number} [now] default Date.now
 * @property {string} [source] 'cf-scheduled' default.
 */

/**
 * @typedef {Object} SyncResult
 * @property {boolean} ok
 * @property {number} itemsSynced
 * @property {number} withStock
 * @property {number} withPrice
 * @property {number} withPreLanzamiento
 * @property {number} durationMs
 * @property {string} source
 * @property {string} syncBatchId
 * @property {number} slRequests
 * @property {string[]} errors
 */

/**
 * Resuelve ItemGroupCode del grupo PESCA (necesario para filter server-side).
 * @param {SapConfig} cfg
 * @param {string} cookie
 */
async function resolvePescaGroupCode(cfg, cookie) {
  const fetchFn = cfg.fetch || globalThis.fetch;
  const url = `${cfg.url}/b1s/v1/ItemGroups?$filter=GroupName eq 'PESCA'&$select=Number,GroupName`;
  const r = await fetchFn(url, {
    headers: { Cookie: `B1SESSION=${cookie}` },
  });
  if (!r.ok) {
    throw new Error(`resolvePescaGroupCode HTTP ${r.status}`);
  }
  const data = await r.json();
  const groups = (data && data.value) || [];
  if (groups.length === 0) {
    throw new Error('ItemGroup PESCA no existe en SAP');
  }
  return groups[0].Number;
}

/**
 * Pagina /Items con filter PESCA + select breakdown.
 * @param {SapConfig} cfg
 * @param {string} cookie
 * @param {number} pescaGroupCode
 * @param {(msg: string) => void} log
 */
async function fetchAllPescaItems(cfg, cookie, pescaGroupCode, log) {
  const fetchFn = cfg.fetch || globalThis.fetch;
  const base = `${cfg.url}`;
  let path =
    `/b1s/v1/Items?$filter=ItemsGroupCode eq ${pescaGroupCode}` +
    `&$select=ItemCode,ItemName,ItemWarehouseInfoCollection,ItemPrices,U_CICLO_PROD`;
  const items = [];
  let pages = 0;
  let slRequests = 0;
  while (path) {
    const url = path.startsWith('http') ? path : base + path;
    const r = await fetchFn(url, {
      headers: { Cookie: `B1SESSION=${cookie}` },
    });
    slRequests++;
    if (!r.ok) {
      throw new Error(`Items page ${pages} HTTP ${r.status}`);
    }
    const data = await r.json();
    const arr = (data && data.value) || [];
    items.push(...arr);
    pages++;
    const nextLink = data['@odata.nextLink'] || data['odata.nextLink'] || null;
    if (!nextLink) break;
    if (nextLink.startsWith('http')) {
      const idx = nextLink.indexOf('/b1s/v1/');
      path = idx >= 0 ? nextLink.slice(idx) : nextLink;
    } else if (nextLink.startsWith('/')) {
      path = nextLink;
    } else {
      path = '/b1s/v1/' + nextLink;
    }
    if (items.length > SAFETY_MAX_ITEMS) {
      log(`[SL] safety cap ${SAFETY_MAX_ITEMS} alcanzado, cortando`);
      break;
    }
  }
  log(`[SL] fetched ${items.length} items en ${pages} páginas (${slRequests} requests)`);
  return { items, pages, slRequests };
}

/**
 * Compute maps desde la lista de Items.
 * Replica la lógica de Python líneas 342-424.
 * @param {any[]} items
 */
function computeMapsFromItems(items) {
  /** @type {Record<string, boolean>} */
  const stockMap = {};
  /** @type {Record<string, number>} */
  const qtyMap = {};
  /** @type {Record<string, Record<string, number>>} */
  const whsMap = {};
  /** @type {Record<string, Record<string, number>>} */
  const whsCommittedMap = {};
  /** @type {Record<string, number>} */
  const priceMap = {};
  /** @type {Record<string, boolean>} */
  const preLanzamientoMap = {};
  /** @type {Array<{code: string, desc: string}>} */
  const catalogItems = [];
  let withStock = 0;
  let withPrice = 0;
  let withPreLanzamiento = 0;

  for (const it of items) {
    const code = String((it && it.ItemCode) || '').trim();
    if (!code) continue;
    const name = String((it && it.ItemName) || '').trim();
    const ciclo = String((it && it.U_CICLO_PROD) || '')
      .trim()
      .toUpperCase();
    if (ciclo === 'PRE LANZAMIENTO') {
      preLanzamientoMap[code] = true;
      withPreLanzamiento++;
    }
    const whsList = (it && it.ItemWarehouseInfoCollection) || [];
    let totalQty = 0;
    /** @type {Record<string, number>} */
    const whsBreakdown = {};
    /** @type {Record<string, number>} */
    const whsCommitted = {};
    for (const w of whsList) {
      const whsCode = String(w.WarehouseCode || '');
      if (NON_SALES_WHS.has(whsCode)) continue;
      const stk = Number(w.InStock || 0);
      const cmt = Number(w.Committed || 0);
      if (!Number.isFinite(stk) || !Number.isFinite(cmt)) continue;
      // §26 (v839): disponible neto = InStock - Committed.
      const dispNeto = Math.max(stk - cmt, 0);
      totalQty += dispNeto;
      if (dispNeto > 0) whsBreakdown[whsCode] = Math.round(dispNeto);
      if (cmt > 0) whsCommitted[whsCode] = Math.round(cmt);
    }
    // §26 (v1002): has_stk solo si whs 11 > 0.
    const hasStk = (whsBreakdown['11'] || 0) > 0;
    catalogItems.push({ code, desc: name });
    stockMap[code] = hasStk;
    qtyMap[code] = Math.round(totalQty);
    if (Object.keys(whsBreakdown).length > 0) whsMap[code] = whsBreakdown;
    if (Object.keys(whsCommitted).length > 0) whsCommittedMap[code] = whsCommitted;
    for (const ip of (it && it.ItemPrices) || []) {
      if (ip.PriceList === PESCA_PRICE_LIST_NUM) {
        const price = ip.Price;
        if (price != null && price !== 0 && Number.isFinite(Number(price))) {
          priceMap[code] = Number(price);
          withPrice++;
        }
        break;
      }
    }
    if (hasStk) withStock++;
  }
  return {
    stockMap,
    qtyMap,
    whsMap,
    whsCommittedMap,
    priceMap,
    preLanzamientoMap,
    catalogItems,
    withStock,
    withPrice,
    withPreLanzamiento,
  };
}

/**
 * Lee product_catalog existente, extrae fam/sub/cat/img por SKU para preservar.
 * @param {any} fbDb
 */
async function loadExistingCategorization(fbDb) {
  /** @type {Record<string, Record<string, any>>} */
  const map = {};
  const snap = await fbDb.collection('product_catalog').get();
  snap.forEach((/** @type {any} */ d) => {
    const data = d.data() || {};
    const list = (data && data.items) || [];
    for (const it of list) {
      if (!it || !it.code) continue;
      const preserve = {};
      if (it.fam) preserve.fam = it.fam;
      if (it.sub) preserve.sub = it.sub;
      if (it.cat) preserve.cat = it.cat;
      if (it.img) preserve.img = it.img;
      if (Object.keys(preserve).length > 0) map[it.code] = preserve;
    }
  });
  return map;
}

/**
 * Escribe chunks product_catalog preservando fam/sub/cat/img.
 * @param {any} fbDb
 * @param {Array<{code: string, desc: string}>} catalogItems
 * @param {Record<string, any>} existingCat
 * @param {string} syncBatchId
 */
async function writeCatalogChunks(fbDb, catalogItems, existingCat, syncBatchId) {
  const merged = catalogItems.map((it) => {
    const prev = existingCat[it.code] || {};
    return Object.assign({ code: it.code, desc: it.desc }, prev);
  });
  const chunks = [];
  for (let i = 0; i < merged.length; i += CHUNK_SIZE) {
    chunks.push(merged.slice(i, i + CHUNK_SIZE));
  }
  for (let i = 0; i < chunks.length; i++) {
    await fbDb.collection('product_catalog').doc(`chunk_${i}`).set({
      items: chunks[i],
      syncBatchId,
      chunkIndex: i,
      itemCount: chunks[i].length,
    });
  }
  // Borrar chunks viejos si bajamos de cantidad.
  const existingSnap = await fbDb.collection('product_catalog').get();
  /** @type {string[]} */
  const existingIds = [];
  existingSnap.forEach((/** @type {any} */ d) => existingIds.push(d.id));
  const activeIds = new Set(chunks.map((_, i) => `chunk_${i}`));
  for (const id of existingIds) {
    if (!activeIds.has(id) && id.startsWith('chunk_')) {
      await fbDb.collection('product_catalog').doc(id).delete();
    }
  }
  return chunks.length;
}

/**
 * Entry point del core sync. Llamable desde CF scheduled o test.
 * @param {SyncDeps} deps
 * @returns {Promise<SyncResult>}
 */
export async function syncSapCatalogStockCore(deps) {
  const log = deps.log || (() => {});
  const now = (deps.now || Date.now)();
  const startedAt = new Date(now).toISOString();
  const source = deps.source || 'cf-scheduled';
  const syncBatchId = `batch_${now}_${Math.random().toString(36).slice(2, 8)}`;
  /** @type {string[]} */
  const errors = [];
  let itemsSynced = 0;
  let withStock = 0;
  let withPrice = 0;
  let withPreLanzamiento = 0;
  let slRequests = 0;

  /** @type {any} */
  let sess = null;
  try {
    sess = await acquireSession(deps.sapConfig);
    const pescaCode = await resolvePescaGroupCode(deps.sapConfig, sess.cookie);
    log(`[sync] PESCA group code = ${pescaCode}`);
    const fetched = await fetchAllPescaItems(deps.sapConfig, sess.cookie, pescaCode, log);
    slRequests = fetched.slRequests + 2; // +login +resolvePescaGroup
    const maps = computeMapsFromItems(fetched.items);
    itemsSynced = maps.catalogItems.length;
    withStock = maps.withStock;
    withPrice = maps.withPrice;
    withPreLanzamiento = maps.withPreLanzamiento;

    const existingCat = await loadExistingCategorization(deps.fbDb);
    const chunksCount = await writeCatalogChunks(
      deps.fbDb,
      maps.catalogItems,
      existingCat,
      syncBatchId
    );

    const finishedAt = new Date(Date.now()).toISOString();
    const durationMs = Date.now() - now;
    // §63 Fase 3 Capa 1 FIX URGENTE (2026-10-23): el client lee estos 4 maps
    // como JSON STRINGS (patrón Python v368+/v377+/v827+/v839+ para evitar el
    // límite Firestore de ~40k index entries por doc). La CF previamente los
    // escribía como objetos → el client parsea como string → stock=0 en todas
    // las pantallas. Alineamos byte-a-byte con Python write_stock_snapshot.
    // Nombres de campos TAMBIÉN alineados: warehouseCommittedBreakdown (no
    // warehouseCommitted), preLanzamientoBySku (no preLanzamiento).
    const qtyJson = JSON.stringify(maps.qtyMap);
    const whsJson = JSON.stringify(maps.whsMap);
    const whsCommittedJson = JSON.stringify(maps.whsCommittedMap || {});
    const preLanzJson = JSON.stringify(maps.preLanzamientoMap || {});
    const snapshot = {
      stock: maps.stockMap,
      quantities: qtyJson,
      warehouseBreakdown: whsJson,
      warehouseCommittedBreakdown: whsCommittedJson,
      price: maps.priceMap,
      preLanzamientoBySku: preLanzJson,
      // backorderBySku NO lo computa esta CF (lo computa el workflow Python
      // leyendo SQ open). set({...}, {merge:true}) preserva el valor previo
      // del field escrito por la última corrida Python/GHA.
      totalItems: itemsSynced,
      withStock,
      warehouse: 'ALL_SALES',
      updatedAt: new Date(),
      updatedBy: 'cloud-function/syncSapCatalogStockCF',
      source,
      syncBatchId,
      _syncRun: {
        startedAt,
        finishedAt,
        durationMs,
        itemsSynced,
        withStock,
        withPrice,
        withPreLanzamiento,
        slRequests,
        source,
        syncBatchId,
        errors: errors.slice(),
      },
    };
    // merge:true preserva backorderBySku + cualquier otro field escrito por
    // Python que la CF no computa.
    await deps.fbDb.collection('app_config').doc('stock_snapshot').set(snapshot, { merge: true });
    // Alineado byte-a-byte con Python write_catalog_chunks:
    // totalItems/totalChunks/syncBatchId/updatedAt/updatedBy + source added.
    await deps.fbDb.collection('app_config').doc('product_catalog_meta').set(
      {
        totalItems: itemsSynced,
        totalChunks: chunksCount,
        syncBatchId,
        updatedAt: new Date(),
        updatedBy: 'cloud-function/syncSapCatalogStockCF',
        source,
      },
      { merge: true }
    );
    // operations_log entry
    try {
      await deps.fbDb.collection('operations_log').add({
        type: 'stock_sync_run',
        source,
        syncBatchId,
        startedAt,
        finishedAt,
        durationMs,
        itemsSynced,
        withStock,
        withPrice,
        withPreLanzamiento,
        slRequests,
        chunksCount,
        errors: errors.slice(),
        ok: true,
        timestamp: new Date(),
      });
    } catch (_e) {
      // operations_log best-effort; no bloquea.
    }
    return {
      ok: true,
      itemsSynced,
      withStock,
      withPrice,
      withPreLanzamiento,
      durationMs,
      source,
      syncBatchId,
      slRequests,
      errors,
    };
  } catch (e) {
    const errMsg = (e && e.message) || String(e);
    errors.push(errMsg);
    log(`[sync] ERROR: ${errMsg}`);
    const durationMs = Date.now() - now;
    const finishedAt = new Date(Date.now()).toISOString();
    try {
      await deps.fbDb.collection('operations_log').add({
        type: 'stock_sync_run',
        source,
        syncBatchId,
        startedAt,
        finishedAt,
        durationMs,
        itemsSynced,
        slRequests,
        errors: errors.slice(),
        ok: false,
        timestamp: new Date(),
      });
    } catch (_e2) {
      // best-effort
    }
    // La sesión queda inválida en 401 (si llegó a crearse).
    if (sess) {
      releaseSession(sess, !(errMsg.includes('401') || errMsg.includes('login failed')));
      sess = null;
    }
    return {
      ok: false,
      itemsSynced,
      withStock,
      withPrice,
      withPreLanzamiento,
      durationMs,
      source,
      syncBatchId,
      slRequests,
      errors,
    };
  } finally {
    // Si llegó a crearse la sesión y sigue inUse, liberarla OK.
    if (sess && sess.inUse) releaseSession(sess, true);
  }
}
