// @ts-check
/**
 * §65 (2026-10-25 v1451) — Port del cómputo backorder desde SAP SQs.
 *
 * Reemplaza progresivamente a la función Python `sl_fetch_backorder_by_sku`
 * (scripts/sync_sap_to_firestore.py:640). GHA scheduler saltea runs del
 * workflow (cadencia efectiva 2-5h vs cada 5 min declarada, §60) → el bucket
 * backorder del snapshot queda stale → UI muestra "Stock Liberado" incorrecto.
 *
 * Portar a Node + correr dentro de `syncSapCatalogStockCF` (que ya corre con
 * Cloud Scheduler confiable cada 5 min) elimina el delay operativo.
 *
 * ALCANCE del core puro:
 *  - Input: array de SQ docs (shape idéntico al Service Layer /Quotations).
 *  - Output: `{ [sku]: { total, porCliente: { [cardCode]: qty } } }`.
 *
 * EXTENSIÓN sobre Python: Python devolvía `{ [sku]: total }`. Este core
 * extiende con `porCliente` para que downstream (reparto, auditoría demanda
 * SAP sin cubrir, bucket backorder del breakdown §39) sepa quién pidió cada
 * unidad en el back order SAP sin tener que re-leer /Quotations.
 *
 * CRITERIO Backorder Shimano (idem Python + v_backorder_lineas en BQ:V8):
 *  - DocumentStatus = 'bost_Open'.
 *  - Cancelled = 'tNO'.
 *  - DocumentLines[].RemainingOpenQuantity > 0.
 *
 * COMPAT (bytes-level) con Python para el shape viejo `{sku: int}`:
 *  - `collectBackorderBySku` devuelve el shape viejo byte-a-byte (int + sort
 *    de keys como Python no las sorta, Node tampoco → preservar insertion).
 *  - El wrapper del CF escribe:
 *      backorderBySku       = JSON.stringify({sku: int})      — compat UI.
 *      backorderBySkuDetail = JSON.stringify({sku: {total, porCliente}}) — nuevo.
 *
 * ROLLBACK: borrar la invocación en syncSapCatalogStockCore + redeploy.
 * Workflow Python GHA sigue escribiendo `backorderBySku` (set merge:true
 * preserva).
 */

/**
 * @typedef {Object} SapConfig
 * @property {string} url Base URL del Service Layer, ej. "https://sap.shimano.local:50000".
 * @property {string} companyDB
 * @property {string} userName
 * @property {string} password
 * @property {typeof fetch} [fetch]
 */

/**
 * @typedef {Object} SqLineRaw
 * @property {string} [ItemCode]
 * @property {number|string|null} [RemainingOpenQuantity]
 * @property {number|string|null} [OpenQuantity] Fallback si RemainingOpenQuantity no viene (poco común).
 */

/**
 * @typedef {Object} SqDocRaw
 * @property {number|string} [DocEntry]
 * @property {string} [CardCode]
 * @property {string} [DocumentStatus]  'bost_Open' | 'bost_Close'.
 * @property {string} [Cancelled]       'tYES' | 'tNO'.
 * @property {SqLineRaw[]} [DocumentLines]
 */

/**
 * @typedef {Object} BackorderBySkuDetail
 * @property {number} total Suma de RemainingOpenQuantity por SKU, enteros.
 * @property {Record<string, number>} porCliente { [cardCode]: qty acumulada }.
 */

/**
 * Normaliza un entero a partir de un valor del Service Layer. SAP SL puede
 * devolver "20.000000" (string decimal) o 20 (number). Round-half-up al int
 * más cercano. Si no es finito, 0.
 *
 * @param {unknown} v
 * @returns {number}
 */
function toIntRound(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/**
 * Filtra las SQ docs al criterio Backorder (open + no cancelada + con líneas).
 *
 * @param {SqDocRaw[]} sqs
 * @returns {SqDocRaw[]}
 */
export function filterOpenNonCancelledSqs(sqs) {
  if (!Array.isArray(sqs)) return [];
  return sqs.filter((doc) => {
    if (!doc || typeof doc !== 'object') return false;
    if (doc.DocumentStatus !== 'bost_Open') return false;
    if (doc.Cancelled === 'tYES') return false;
    const lines = doc.DocumentLines;
    if (!Array.isArray(lines) || lines.length === 0) return false;
    return true;
  });
}

/**
 * Core puro: computa el shape detallado `{ [sku]: { total, porCliente } }`
 * desde la lista de SQ docs. Idempotente, zero IO, zero side effects.
 *
 * REGLAS (replican Python líneas 640-712, con extensión porCliente):
 *  - SQ con `DocumentStatus != 'bost_Open'` → ignorada (closed/other).
 *  - SQ con `Cancelled === 'tYES'` → ignorada.
 *  - Línea con `ItemCode` vacío/null → ignorada.
 *  - Línea con `RemainingOpenQuantity <= 0` → ignorada (ya facturada completa
 *    o nunca abierta).
 *  - Si `RemainingOpenQuantity` falta, intento fallback a `OpenQuantity`
 *    (shape alterno de SL en algunas versiones; no estaba en Python pero no
 *    rompe paridad porque Python solo leía RemainingOpenQuantity).
 *  - 2 SQs del mismo cliente con el mismo SKU → suman en `total` y en
 *    `porCliente[cardCode]`. Regla §56 ("un SKU una sola vez por orden"):
 *    cada ORIGEN SAP (SQ docs distintos) agrega. Dentro del mismo SQ, misma
 *    línea aparece una sola vez por diseño SAP.
 *  - CardCode vacío → se agrega bajo clave `""` en porCliente (es dato
 *    anómalo pero no quiero descartar silencioso una SQ sin dueño; log en
 *    wrapper si aparece).
 *
 * COMPAT bytes-level: el orden de inserción de keys en los objetos devueltos
 * refleja el orden de scan de las SQs (idem Python `result[code] =
 * result.get(code, 0) + x`). JSON.stringify preserva este orden en V8/Node y
 * en Python ≥3.7 (dict insertion-ordered). Si querés orden determinístico,
 * ordená afuera (p.ej. `Object.keys(x).sort()` antes del serialize).
 *
 * @param {SqDocRaw[]} sqs Array crudo de /Quotations?... value[].
 * @returns {Record<string, BackorderBySkuDetail>}
 */
export function collectBackorderFromSqs(sqs) {
  /** @type {Record<string, BackorderBySkuDetail>} */
  const result = {};
  if (!Array.isArray(sqs)) return result;

  for (const doc of sqs) {
    if (!doc || typeof doc !== 'object') continue;
    // Filtros a nivel doc (idem Python $filter server-side + check cliente).
    if (doc.DocumentStatus !== 'bost_Open') continue;
    if (doc.Cancelled === 'tYES') continue;
    const lines = doc.DocumentLines;
    if (!Array.isArray(lines)) continue;
    const cardCode = String(doc.CardCode || '').trim();

    for (const ln of lines) {
      if (!ln || typeof ln !== 'object') continue;
      const code = String(ln.ItemCode || '').trim();
      if (!code) continue;
      // Fallback OpenQuantity: Python NO lo tenía. Si RemainingOpenQuantity
      // viene undefined/null, miramos OpenQuantity (shape SL alterno). Para
      // la paridad bytes-level con Python basta que ambos campos existan
      // y tengan el mismo valor en SL (invariante operativa confirmada por
      // Santi 2026-07 testing SQ parciales). Si en un fixture Python ve 0
      // y OpenQuantity > 0, Python ignora; Node TAMBIÉN ignora (porque el
      // fallback solo dispara si RemainingOpenQuantity es null/undefined,
      // no 0).
      let remaining;
      if (ln.RemainingOpenQuantity === null || ln.RemainingOpenQuantity === undefined) {
        remaining = toIntRound(ln.OpenQuantity);
      } else {
        remaining = toIntRound(ln.RemainingOpenQuantity);
      }
      if (remaining <= 0) continue;

      if (!result[code]) {
        result[code] = { total: 0, porCliente: {} };
      }
      result[code].total += remaining;
      if (cardCode) {
        result[code].porCliente[cardCode] = (result[code].porCliente[cardCode] || 0) + remaining;
      } else {
        // SQ sin CardCode: agregamos bajo "" para no silenciar. Caso raro
        // (SAP permite SQ "cash" sin BP pero Shimano no lo usa).
        result[code].porCliente[''] = (result[code].porCliente[''] || 0) + remaining;
      }
    }
  }

  return result;
}

/**
 * Flatten del shape detallado al shape viejo `{ [sku]: int }` byte-compatible
 * con Python `sl_fetch_backorder_by_sku`.
 *
 * Permite seguir escribiendo `backorderBySku` en el snapshot sin cambiar el
 * consumidor UI (`index.html:31999` lee JSON.parse → `{sku: int}`).
 *
 * @param {Record<string, BackorderBySkuDetail>} detail
 * @returns {Record<string, number>}
 */
export function flattenBackorderDetailToTotals(detail) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!detail || typeof detail !== 'object') return out;
  for (const sku of Object.keys(detail)) {
    const d = detail[sku];
    if (d && Number.isFinite(d.total) && d.total > 0) {
      out[sku] = d.total;
    }
  }
  return out;
}

/**
 * @typedef {Object} FetchSqsResult
 * @property {SqDocRaw[]} sqs
 * @property {number} pages
 * @property {number} scannedDocs
 * @property {number} scannedLines
 * @property {number} slRequests
 * @property {string|null} error null si OK, mensaje si falló (HTTP != 2xx o
 *   excepción de red). El consumidor decide si usar `sqs` parciales o
 *   descartarlos y fallback al valor viejo.
 */

/**
 * Fetch de SQs abiertas desde Service Layer paginado via @odata.nextLink.
 * No es puro (hace IO) pero sigue el patrón del core: recibe fetch injectable
 * via `deps`. El `collectBackorderFromSqs` recibe la lista agregada.
 *
 * Replica Python lineas 663-711.
 *
 * @param {Object} deps
 * @param {SapConfig} deps.sapConfig
 * @param {string} deps.cookie Session cookie B1SESSION ya adquirida.
 * @param {(msg: string, extra?: any) => void} [deps.log]
 * @param {number} [deps.safetyMaxDocs] Default 20000 (idem Python).
 * @returns {Promise<FetchSqsResult>}
 */
export async function fetchOpenSqsFromServiceLayer(deps) {
  const log = deps.log || (() => {});
  const fetchFn = deps.sapConfig.fetch || globalThis.fetch;
  const safetyMax = deps.safetyMaxDocs || 20000;

  /** @type {SqDocRaw[]} */
  const sqs = [];
  let pages = 0;
  let scannedDocs = 0;
  let scannedLines = 0;
  let slRequests = 0;

  // $select y $filter alineados con Python línea 663 — misma URL para
  // mantener paridad en el fetch (y el server-side filter).
  let path =
    '/b1s/v1/Quotations' +
    '?$select=DocEntry,CardCode,DocumentStatus,Cancelled,DocumentLines' +
    "&$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'";
  const base = deps.sapConfig.url;

  let errorMsg = null;
  while (path) {
    const url = path.startsWith('http') ? path : base + path;
    let resp;
    try {
      resp = await fetchFn(url, {
        headers: { Cookie: `B1SESSION=${deps.cookie}` },
      });
    } catch (e) {
      errorMsg = (e && /** @type {any} */ (e).message) || String(e);
      log(`[BACKORDER] error de red página ${pages} (no bloqueante): ${errorMsg}`);
      return { sqs, pages, scannedDocs, scannedLines, slRequests, error: errorMsg };
    }
    slRequests++;
    if (!resp.ok) {
      errorMsg = `HTTP ${resp.status}`;
      log(`[BACKORDER] HTTP ${resp.status} (no bloqueante). Cortando.`);
      return { sqs, pages, scannedDocs, scannedLines, slRequests, error: errorMsg };
    }
    const data = await resp.json();
    const arr = (data && data.value) || [];
    for (const doc of arr) {
      scannedDocs++;
      const lines = (doc && doc.DocumentLines) || [];
      scannedLines += Array.isArray(lines) ? lines.length : 0;
      sqs.push(doc);
    }
    pages++;
    const nextLink = (data && (data['@odata.nextLink'] || data['odata.nextLink'])) || null;
    if (!nextLink) break;
    if (nextLink.startsWith('http')) {
      const idx = nextLink.indexOf('/b1s/v1/');
      path = idx >= 0 ? nextLink.slice(idx) : nextLink;
    } else if (nextLink.startsWith('/')) {
      path = nextLink;
    } else {
      path = '/b1s/v1/' + nextLink;
    }
    if (scannedDocs > safetyMax) {
      log(`[BACKORDER] safety cap ${safetyMax} SQs alcanzado, cortando`);
      break;
    }
  }
  log(
    `[BACKORDER] ${pages} páginas, ${scannedDocs} SQ open, ${scannedLines} líneas (${slRequests} requests)`
  );
  return { sqs, pages, scannedDocs, scannedLines, slRequests, error: null };
}
