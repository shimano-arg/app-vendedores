// @ts-check
/**
 * §63 Fase 3 Capa 2 (2026-10-23 v1445) — fetch fisicoDep11 live del SL.
 *
 * Al abrir el modal "Pedido en espera" y en commitPedidoCF, consultar el
 * físico del depósito 11 EN VIVO en el SL para los SKUs del pedido. Si no
 * responde dentro del timeout, cae al snapshot (fresco o vencido con
 * SAP_UNAVAILABLE según §Fallback).
 *
 * HALLAZGOS medición 2026-10-23 (ver design doc §4):
 *   - SL rechaza `$filter > 2700 chars` con HTTP 400. Max block_size = 50 SKUs.
 *   - $select anidado (ItemWarehouseInfoCollection/WarehouseCode) NO soportado
 *     por este SL. Expand options ($;) NO soportado. ItemWarehouseInfoCollection
 *     NO es navegación expandible. Filtramos whs 11 client-side.
 *   - Latencia 50 SKUs: median 285ms, P95 920ms. Body 1 MB por batch.
 *   - Timeout 3s por pedido total (no por batch). Paralelismo via Promise.all.
 *
 * STRATEGIES por tamaño del pedido:
 *   - ≤ 200 SKUs únicos: batch completo via SL en bloques de 50 paralelos.
 *   - > 200 SKUs: modo "líneas en riesgo" — SL solo donde
 *     qty_pedida >= libre_snapshot[sku]; resto va con snapshot.
 *
 * FALLBACK:
 *   - SL caído / timeout / 500 → snapshotFallback=true, usar snapshot.
 *   - Logs en operations_log con type='stock_live_fetched' o
 *     'stock_live_partial' o 'stock_live_fallback'.
 */

const BLOCK_SIZE = 50;
const TIMEOUT_MS = 3000;
const LINEAS_EN_RIESGO_THRESHOLD = 200;

/**
 * @typedef {Object} FetchDeps
 * @property {{url: string, companyDB: string, userName: string, password: string, fetch?: typeof fetch}} sapConfig
 * @property {any} fbDb Firestore admin.
 * @property {() => Promise<string>} acquireSlCookie Helper para traer una cookie B1SESSION del pool.
 * @property {(cookie: string, ok: boolean) => void} releaseSlCookie
 * @property {(msg: string, extra?: any) => void} [log]
 * @property {() => number} [now]
 */

/**
 * @typedef {Object} FetchParams
 * @property {string[]} skus Array deduplicado de SKUs únicos.
 * @property {Record<string, number>} [libreSnapshot] Mapa sku→libre del snapshot. Si viene y skus.length > 200, modo "líneas en riesgo".
 * @property {Record<string, number>} [qtyPedida] Mapa sku→qty del pedido. Idem.
 * @property {number} [timeoutMs] Default 3000.
 */

/**
 * @typedef {Object} FetchResult
 * @property {boolean} ok
 * @property {Record<string, number>} fisicoDep11 Map sku→fisicoDep11 live (o del snapshot si fallback).
 * @property {boolean} snapshotFallback true si NO se pudo fetchear nada live.
 * @property {boolean} partial true si solo se fetcheó un subset (modo líneas en riesgo).
 * @property {string[]} skusLive SKUs cuyo fisicoDep11 viene del SL.
 * @property {string[]} skusSnapshot SKUs cuyo fisicoDep11 viene del snapshot (en modo partial o fallback).
 * @property {string} [reason] 'ok' | 'timeout' | 'sl_error' | 'sl_disabled' | 'sl_not_configured' | 'partial_lineas_en_riesgo'.
 * @property {number} durationMs
 * @property {number} slRequests Count de batches enviados al SL.
 * @property {string} [error]
 */

/**
 * Separa un array de SKUs en bloques de BLOCK_SIZE.
 * @param {string[]} skus
 * @returns {string[][]}
 */
function chunkSkus(skus) {
  const chunks = [];
  for (let i = 0; i < skus.length; i += BLOCK_SIZE) {
    chunks.push(skus.slice(i, i + BLOCK_SIZE));
  }
  return chunks;
}

/**
 * Arma la URL para un batch SL. Filter `ItemCode eq 'A' or ItemCode eq 'B' or ...`.
 * $select limitado a lo necesario (reduce parse-time del response).
 * NOTA: $select anidado NO funciona en este SL (test 2026-10-23 run2), por eso
 * traemos ItemWarehouseInfoCollection completa y filtramos whs 11 client-side.
 */
function buildBatchUrl(/** @type {string} */ baseUrl, /** @type {string[]} */ skus) {
  const filter = skus
    .map((/** @type {string} */ s) => `ItemCode eq '${s.replace(/'/g, "''")}'`)
    .join(' or ');
  const select = 'ItemCode,ItemWarehouseInfoCollection';
  const qs = `?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(select)}`;
  return `${baseUrl}/b1s/v1/Items${qs}`;
}

/**
 * Ejecuta un batch de hasta BLOCK_SIZE SKUs. Devuelve Map sku→fisicoDep11.
 * @param {FetchDeps} deps
 * @param {string} cookie
 * @param {string[]} skus
 * @param {AbortSignal} signal
 * @returns {Promise<{ok: boolean, items: Record<string, number>, status?: number, error?: string}>}
 */
async function fetchBatch(deps, cookie, skus, signal) {
  const fetchFn = deps.sapConfig.fetch || globalThis.fetch;
  const url = buildBatchUrl(deps.sapConfig.url, skus);
  try {
    const r = await fetchFn(url, {
      headers: { Cookie: `B1SESSION=${cookie}` },
      signal,
    });
    if (!r.ok) {
      return { ok: false, items: {}, status: r.status, error: `HTTP ${r.status}` };
    }
    const data = await r.json();
    /** @type {Record<string, number>} */
    const map = {};
    for (const it of data.value || []) {
      const code = String((it && it.ItemCode) || '').trim();
      if (!code) continue;
      const whs = (it && it.ItemWarehouseInfoCollection) || [];
      for (const w of whs) {
        if (String(w.WarehouseCode || '') === '11') {
          const stk = Number(w.InStock || 0);
          const cmt = Number(w.Committed || 0);
          const dispNeto = Math.max(stk - cmt, 0);
          map[code] = Math.round(dispNeto);
          break;
        }
      }
      // Si no está whs 11 en la collection → fisico = 0.
      if (!(code in map)) map[code] = 0;
    }
    return { ok: true, items: map };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, items: {}, error: msg };
  }
}

/**
 * Entry point del core. Dado una lista de SKUs, devuelve el físico dep 11
 * en vivo (con fallback a snapshot si corresponde).
 *
 * @param {FetchDeps} deps
 * @param {FetchParams} params
 * @returns {Promise<FetchResult>}
 */
export async function fetchStockLiveCore(deps, params) {
  const log = deps.log || (() => {});
  const now = (deps.now || Date.now)();
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : TIMEOUT_MS;
  const skusAll = Array.from(
    new Set((params.skus || []).map((s) => String(s || '').trim()).filter(Boolean))
  );

  if (skusAll.length === 0) {
    return {
      ok: true,
      fisicoDep11: {},
      snapshotFallback: false,
      partial: false,
      skusLive: [],
      skusSnapshot: [],
      reason: 'ok',
      durationMs: 0,
      slRequests: 0,
    };
  }

  // Modo "líneas en riesgo" si > 200 SKUs.
  let skusTarget = skusAll;
  let partial = false;
  /** @type {string[]} */
  const skusSnapshot = [];
  if (skusAll.length > LINEAS_EN_RIESGO_THRESHOLD && params.libreSnapshot && params.qtyPedida) {
    skusTarget = skusAll.filter((sku) => {
      const q = Number(params.qtyPedida?.[sku] || 0);
      const l = Number(params.libreSnapshot?.[sku] || 0);
      return q >= l; // en riesgo
    });
    for (const sku of skusAll) {
      if (!skusTarget.includes(sku)) skusSnapshot.push(sku);
    }
    partial = true;
    log('[live-sl] modo lineas-en-riesgo', {
      total: skusAll.length,
      target: skusTarget.length,
      snapshot: skusSnapshot.length,
    });
  }

  // Cookie SL (via pool).
  /** @type {string|null} */
  let cookie = null;
  try {
    cookie = await deps.acquireSlCookie();
  } catch (e) {
    const errMsg = (e && e.message) || String(e);
    log('[live-sl] no se pudo obtener cookie SL', { err: errMsg });
    return {
      ok: true,
      fisicoDep11: {},
      snapshotFallback: true,
      partial: false,
      skusLive: [],
      skusSnapshot: skusAll,
      reason: errMsg.includes('disabled') ? 'sl_disabled' : 'sl_not_configured',
      durationMs: Date.now() - now,
      slRequests: 0,
      error: errMsg,
    };
  }

  const chunks = chunkSkus(skusTarget);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  /** @type {Record<string, number>} */
  const fisicoDep11 = {};
  let okAll = true;
  let errSample = '';
  let slRequests = 0;
  try {
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        slRequests++;
        return fetchBatch(deps, /** @type {string} */ (cookie), chunk, controller.signal);
      })
    );
    for (const r of results) {
      if (!r.ok) {
        okAll = false;
        if (!errSample) errSample = r.error || `HTTP ${r.status}`;
      } else {
        Object.assign(fisicoDep11, r.items);
      }
    }
  } catch (e) {
    okAll = false;
    errSample = (e && e.message) || String(e);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const durationMs = Date.now() - t0;
  // Si la cookie recibió 401 en algún batch, descartarla.
  const is401 = errSample.includes('401');
  deps.releaseSlCookie(cookie, !is401);

  if (!okAll && Object.keys(fisicoDep11).length === 0) {
    // Todos los batches fallaron o se abortaron.
    log('[live-sl] fallback a snapshot', { err: errSample, durationMs });
    return {
      ok: true,
      fisicoDep11: {},
      snapshotFallback: true,
      partial: false,
      skusLive: [],
      skusSnapshot: skusAll,
      reason: errSample.includes('abort') || durationMs >= timeoutMs ? 'timeout' : 'sl_error',
      durationMs,
      slRequests,
      error: errSample,
    };
  }

  // Si partial, los que no vinieron del SL van a snapshot.
  const skusLive = Object.keys(fisicoDep11);
  if (partial) {
    for (const sku of skusTarget) {
      if (!(sku in fisicoDep11)) skusSnapshot.push(sku);
    }
  } else {
    // No-partial: cualquier SKU que no vino del SL (ej. SKU inexistente en catálogo) → cae a snapshot via fallback caller.
    for (const sku of skusAll) {
      if (!(sku in fisicoDep11)) skusSnapshot.push(sku);
    }
  }
  return {
    ok: true,
    fisicoDep11,
    snapshotFallback: false,
    partial,
    skusLive,
    skusSnapshot,
    reason: partial ? 'partial_lineas_en_riesgo' : 'ok',
    durationMs,
    slRequests,
  };
}

export const _INTERNAL = {
  BLOCK_SIZE,
  TIMEOUT_MS,
  LINEAS_EN_RIESGO_THRESHOLD,
  chunkSkus,
  buildBatchUrl,
};
