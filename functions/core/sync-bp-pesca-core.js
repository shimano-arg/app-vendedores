// @ts-check
/**
 * v1502 (2026-10-28) — Port del sync BPs pesca SAP → Firestore de Python a Node.
 *
 * **Contexto**: v1456 §60 UPDATE (2026-10-25) removió el cron GHA del workflow
 * `sync-sap-catalog-stock.yml`. La CF `syncSapCatalogStockCF` ya corre cada 5
 * min via Cloud Scheduler para Items + stock snapshot + backorder (§65 v1451),
 * **pero NO incluía el sync de BPs**. Resultado: desde 2026-10-26 01:06 UTC
 * los clientes nuevos de SAP no aparecen en la app automáticamente — hay que
 * disparar el workflow manual.
 *
 * **Este core**: reemplaza las funciones Python de BPs pesca por Node, se
 * engancha en `syncSapCatalogStockCore` después del compute de stock + antes
 * de escribir el snapshot. Mismos BPs → mismos payloads → paridad con el
 * Python original.
 *
 * **Side-by-side con Python** (`scripts/sync_sap_to_firestore.py`):
 * - `_normName` (Python _norm_name líneas 847-851).
 * - `_normCuit` (Python _norm_cuit líneas 854-857).
 * - `loadArProvincesMap` (Python líneas 860-893).
 * - `loadVendorUidsByEmail` (Python líneas 896-914).
 * - `fetchBpPescaFromSl` (Python líneas 917-982).
 * - `loadExistingClientApplications` (Python líneas 985-1000).
 * - `ratcliffObershelp` + `findMatch` (Python _fuzzy_similar + find_match líneas 1018-1109).
 * - `upsertBpPescaToFirestore` (Python líneas 1112-1404). Equivalencia exhaustiva.
 * - `syncBpPesca` orquestador (Python líneas 1407-1434).
 *
 * **Feature flag de seguridad**: `app_config/sap_integration.bpSyncByCF` boolean.
 * - `false` (default): el core corre en DRY-RUN mode (logs qué haría, no escribe).
 *   El workflow Python manual sigue siendo la fuente de verdad.
 * - `true`: el core escribe real. Se desactiva el workflow Python como seguridad.
 *
 * **Rollback plan**: setear `bpSyncByCF=false` + redeploy. El Python manual
 * sigue sin cambios.
 */

/* --------------------------------------------------------------------
 * Normalizers (Python _norm_name + _norm_cuit)
 * ------------------------------------------------------------------ */

/**
 * Normaliza un nombre: trim + uppercase. Replica de `sapNorm()` del cliente
 * (index.html) + `_norm_name` Python (scripts/sync_sap_to_firestore.py:847).
 *
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function _normName(s) {
  return String(s || '')
    .trim()
    .toUpperCase();
}

/**
 * Limpia un CUIT dejando solo dígitos. Replica de `_norm_cuit` Python
 * (scripts/sync_sap_to_firestore.py:854).
 *
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function _normCuit(s) {
  return String(s || '').replace(/[^0-9]/g, '');
}

/* --------------------------------------------------------------------
 * Fuzzy match (Ratcliff-Obershelp / difflib.SequenceMatcher ratio())
 * ------------------------------------------------------------------ */

/**
 * Devuelve 0..1 ratio de similaridad entre dos strings usando Ratcliff-Obershelp
 * (mismo algoritmo que `difflib.SequenceMatcher(None, a, b).ratio()` en Python).
 *
 * Fórmula: `ratio = 2.0 * M / T` donde M = matches entre a y b, T = |a| + |b|.
 * M se computa recursivamente: longest-common-substring + recursion a los dos
 * lados. Esto captura rearrangements que un simple LCS/edit distance no captura.
 *
 * Testing: paridad con Python se verifica en tests/functions/sync-bp-pesca-core.test.js.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function ratcliffObershelp(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (!sa.length || !sb.length) return 0;
  const total = sa.length + sb.length;
  const matches = _roMatches(sa, sb);
  return (2.0 * matches) / total;
}

/**
 * Core recursivo. Encuentra la LONGEST COMMON SUBSTRING entre a[0..] y b[0..],
 * suma su longitud, y recursea en los dos subrangos (antes y después del LCS).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function _roMatches(a, b) {
  if (!a.length || !b.length) return 0;
  // find longest common substring
  const nA = a.length;
  const nB = b.length;
  let bestLen = 0;
  let bestI = 0;
  let bestJ = 0;
  // DP table collapsed to two rows.
  /** @type {number[]} */
  let prev = new Array(nB + 1).fill(0);
  /** @type {number[]} */
  let curr = new Array(nB + 1).fill(0);
  for (let i = 1; i <= nA; i++) {
    for (let j = 1; j <= nB; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > bestLen) {
          bestLen = curr[j];
          bestI = i - bestLen;
          bestJ = j - bestLen;
        }
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  if (bestLen === 0) return 0;
  const left = _roMatches(a.slice(0, bestI), b.slice(0, bestJ));
  const right = _roMatches(a.slice(bestI + bestLen), b.slice(bestJ + bestLen));
  return bestLen + left + right;
}

export const FUZZY_THRESHOLD = 0.9;

/* --------------------------------------------------------------------
 * SAP SL fetches (loadArProvincesMap, fetchBpPescaFromSl)
 * ------------------------------------------------------------------ */

/**
 * Trae mapping code → name de provincias Argentina desde SAP SL
 * `/b1s/v1/States?$filter=Country eq 'AR'`. Replica de Python `load_ar_provinces_map`
 * (scripts/sync_sap_to_firestore.py:860).
 *
 * @param {object} params
 * @param {{url: string}} params.sapConfig
 * @param {string} params.cookie - cookie SL post-login (B1SESSION=...).
 * @param {(msg: string, ctx?: any) => void} [params.log]
 * @returns {Promise<{map: Record<string, string>, slRequests: number, error: string|null}>}
 */
export async function loadArProvincesMap({ sapConfig, cookie, log }) {
  const _log = log || (() => {});
  /** @type {Record<string, string>} */
  const result = {};
  const path = "/b1s/v1/States?$filter=Country eq 'AR'&$select=Code,Name";
  const url = sapConfig.url + path;
  let slRequests = 0;
  try {
    const resp = await fetch(url, { headers: { Cookie: cookie } });
    slRequests = 1;
    if (!resp.ok) {
      const msg = '[bp] load_ar_provinces: HTTP ' + resp.status + ' en /States';
      _log(msg);
      return { map: result, slRequests, error: msg };
    }
    /** @type {any} */
    const body = await resp.json();
    const states = (body && body.value) || [];
    for (const s of states) {
      const code = String((s && s.Code) || '').trim();
      const name = String((s && s.Name) || '')
        .trim()
        .toUpperCase();
      if (code && name) result[code] = name;
    }
  } catch (e) {
    const msg =
      '[bp] WARN load_ar_provinces: ' + ((e && /** @type {any} */ (e).message) || String(e));
    _log(msg);
    return { map: result, slRequests, error: msg };
  }
  _log('[bp] ' + Object.keys(result).length + ' codigos de provincia AR cargados desde SAP States');
  return { map: result, slRequests, error: null };
}

/**
 * Trae BPs pesca de SAP via SL con paginación. Replica de Python
 * `fetch_bp_pesca_from_sl` (scripts/sync_sap_to_firestore.py:917).
 *
 * Nota de paridad: el filtro `(CardType eq 'cCustomer' or CardType eq 'cLid')`
 * trae customers Y leads. El filtro DIVISION se aplica en memoria porque los
 * UDFs no matchean reliable con $filter en SL (ver comentario Python v285+).
 *
 * @param {object} params
 * @param {{url: string}} params.sapConfig
 * @param {string} params.cookie
 * @param {(msg: string, ctx?: any) => void} [params.log]
 * @returns {Promise<{bps: Array<any>, slRequests: number, pages: number, error: string|null}>}
 */
export async function fetchBpPescaFromSl({ sapConfig, cookie, log }) {
  const _log = log || (() => {});
  const typeFilter = "(CardType eq 'cCustomer' or CardType eq 'cLid')";
  const initialPath = '/b1s/v1/BusinessPartners?$filter=' + encodeURIComponent(typeFilter);
  /** @type {Array<any>} */
  const bps = [];
  let path = initialPath;
  let page = 0;
  let slRequests = 0;
  const SAFETY_CAP_PAGES = 500;
  while (path) {
    const url = path.startsWith('http') ? path : sapConfig.url + path;
    let resp;
    try {
      resp = await fetch(url, { headers: { Cookie: cookie } });
      slRequests++;
    } catch (e) {
      const msg =
        '[SL/BP] error de red pag ' +
        page +
        ': ' +
        ((e && /** @type {any} */ (e).message) || String(e));
      _log(msg);
      return { bps, slRequests, pages: page, error: msg };
    }
    if (!resp.ok) {
      let detail = '';
      try {
        /** @type {any} */
        const body = await resp.json();
        detail = (body && body.error && body.error.message && body.error.message.value) || '';
      } catch (_e) {
        try {
          detail = (await resp.text()).slice(0, 200);
        } catch (_e2) {
          detail = '(no body)';
        }
      }
      const msg = '[FATAL/BP] HTTP ' + resp.status + ' - ' + detail;
      _log(msg);
      // Devolver lo que llevemos — paridad con Python (no aborta el sync entero).
      return { bps, slRequests, pages: page, error: msg };
    }
    /** @type {any} */
    const body = await resp.json();
    const value = (body && body.value) || [];
    for (const bp of value) bps.push(bp);
    page++;
    const nextLink = (body && (body['@odata.nextLink'] || body['odata.nextLink'])) || null;
    if (!nextLink) break;
    // Normalizar nextLink → path.
    if (typeof nextLink === 'string' && nextLink.startsWith('http')) {
      const idx = nextLink.indexOf('/b1s/v1/');
      path = idx >= 0 ? nextLink.slice(idx) : nextLink;
    } else if (typeof nextLink === 'string' && nextLink.startsWith('/')) {
      path = nextLink;
    } else {
      path = '/b1s/v1/' + nextLink;
    }
    if (page > SAFETY_CAP_PAGES) {
      _log('[SL/BP] safety cap ' + SAFETY_CAP_PAGES + ' paginas alcanzado, cortando');
      break;
    }
  }
  _log('[SL/BP] total: ' + bps.length + ' BPs pesca en ' + page + ' paginas');
  return { bps, slRequests, pages: page, error: null };
}

/* --------------------------------------------------------------------
 * Firestore reads (vendor_uids, existing_apps)
 * ------------------------------------------------------------------ */

/**
 * Devuelve mapping `{email_lowercase: uid}` leyendo colección `roles`.
 * Replica de Python `load_vendor_uids_by_email` (scripts/sync_sap_to_firestore.py:896).
 *
 * @param {{fbDb: any, log?: (msg: string, ctx?: any) => void}} deps
 * @returns {Promise<Record<string, string>>}
 */
export async function loadVendorUidsByEmail(deps) {
  const _log = deps.log || (() => {});
  /** @type {Record<string, string>} */
  const result = {};
  try {
    const snap = await deps.fbDb.collection('roles').get();
    snap.forEach((/** @type {any} */ d) => {
      const data = d.data() || {};
      const email = String(data.email || '')
        .trim()
        .toLowerCase();
      if (email) result[email] = d.id;
    });
  } catch (e) {
    _log(
      '[WARN] load_vendor_uids_by_email: ' + ((e && /** @type {any} */ (e).message) || String(e))
    );
  }
  _log('[bp] ' + Object.keys(result).length + ' vendedores en /roles con email');
  return result;
}

/**
 * Lee TODA la colección `client_applications` para matchear en memoria.
 * Replica de Python `load_existing_client_applications` (scripts/sync_sap_to_firestore.py:985).
 *
 * Devuelve objetos con `__id` (doc id) y `__ref` (DocumentReference) — mismo
 * shape que Python para que `find_match` sea literal.
 *
 * @param {{fbDb: any, log?: (msg: string, ctx?: any) => void}} deps
 * @returns {Promise<Array<any>>}
 */
export async function loadExistingClientApplications(deps) {
  const _log = deps.log || (() => {});
  /** @type {Array<any>} */
  const out = [];
  try {
    const snap = await deps.fbDb.collection('client_applications').get();
    snap.forEach((/** @type {any} */ d) => {
      const data = d.data() || {};
      data.__id = d.id;
      data.__ref = d.ref;
      out.push(data);
    });
  } catch (e) {
    _log(
      '[WARN] load_existing_client_applications: ' +
        ((e && /** @type {any} */ (e).message) || String(e))
    );
  }
  _log('[bp] ' + out.length + ' client_applications cargados para matching');
  return out;
}

/* --------------------------------------------------------------------
 * Match (cardCodeSap → cuit → nombre exacto → fuzzy)
 * ------------------------------------------------------------------ */

/**
 * Busca un doc de `client_applications` que matchee con el BP SAP. 4 pasadas:
 *   1. Match por cardCodeSap exacto.
 *   2. Match por CUIT normalizado.
 *   3. Match por nombre normalizado exacto (comercio/fantasia/razonSocial).
 *   4. Fuzzy match contra PROVISORIOS (sin cardCodeSap) con misma provincia +
 *      ratio ≥ FUZZY_THRESHOLD (0.9).
 *
 * Marca el match con `__fuzzy_matched/__fuzzy_score/__fuzzy_field` cuando viene
 * de la pasada 4 — el caller lo usa para escribir audit en `lead_merge_log`.
 *
 * Replica de Python `find_match` (scripts/sync_sap_to_firestore.py:1027).
 *
 * @param {any} bp
 * @param {Array<any>} existingApps
 * @param {object} [opts]
 * @param {boolean} [opts.logFuzzy=true]
 * @param {(msg: string, ctx?: any) => void} [opts.log]
 * @returns {any|null}
 */
export function findMatch(bp, existingApps, opts) {
  const options = opts || {};
  const _log = options.log || (() => {});
  const logFuzzy = options.logFuzzy !== false;
  const bpCardCode = String((bp && bp.CardCode) || '').trim();
  const bpCuit = _normCuit((bp && bp.FederalTaxID) || '');
  const bpNameNorm = _normName((bp && bp.CardName) || '');

  // 1. cardCodeSap exacto.
  if (bpCardCode) {
    for (const app of existingApps) {
      if (String(app.cardCodeSap || '').trim() === bpCardCode) return app;
    }
  }
  // 2. CUIT exacto.
  if (bpCuit) {
    for (const app of existingApps) {
      const appCuit = _normCuit(app.cuit || app.cuitCliente || '');
      if (appCuit && appCuit === bpCuit) return app;
    }
  }
  // 3. Nombre normalizado exacto.
  if (bpNameNorm) {
    for (const app of existingApps) {
      for (const field of ['comercio', 'fantasia', 'razonSocial']) {
        const valNorm = _normName(app[field] || '');
        if (valNorm && valNorm === bpNameNorm) return app;
      }
    }
  }
  // 4. Fuzzy (solo contra provisorios, misma provincia, ratio ≥ threshold).
  if (bpNameNorm) {
    let bpProv = _normName((bp && (bp.U_SH_PCIA || bp.Province)) || '');
    if (!bpProv) {
      const addrs = (bp && bp.BPAddresses) || [];
      for (const addr of addrs) {
        const p = _normName((addr && (addr.State || addr.State1)) || '');
        if (p) {
          bpProv = p;
          break;
        }
      }
    }
    let best = null;
    let bestScore = 0.0;
    let bestField = '';
    for (const app of existingApps) {
      if (String(app.cardCodeSap || '').trim()) continue; // solo provisorios
      const appProv = _normName(app.provincia || '');
      if (!bpProv || !appProv || appProv !== bpProv) continue;
      for (const field of ['comercio', 'fantasia', 'razonSocial']) {
        const valNorm = _normName(app[field] || '');
        if (!valNorm) continue;
        const score = ratcliffObershelp(valNorm, bpNameNorm);
        if (score > bestScore) {
          bestScore = score;
          best = app;
          bestField = field;
        }
      }
    }
    if (best !== null && bestScore >= FUZZY_THRESHOLD) {
      if (logFuzzy) {
        _log(
          '[bp/fuzzy] MATCH bp=' +
            JSON.stringify(bpCardCode) +
            ' bp_name=' +
            JSON.stringify(bpNameNorm) +
            ' -> lead=' +
            JSON.stringify(best.__id) +
            ' lead_' +
            bestField +
            '=' +
            JSON.stringify(_normName(best[bestField])) +
            ' score=' +
            bestScore.toFixed(3) +
            ' prov=' +
            JSON.stringify(bpProv)
        );
      }
      best.__fuzzy_matched = true;
      best.__fuzzy_score = bestScore;
      best.__fuzzy_field = bestField;
      return best;
    } else if (best !== null && logFuzzy && bestScore >= 0.6) {
      _log(
        '[bp/fuzzy] casi-match (no auto-merge) bp=' +
          JSON.stringify(bpCardCode) +
          ' bp_name=' +
          JSON.stringify(bpNameNorm) +
          ' -> lead=' +
          JSON.stringify(best.__id) +
          ' score=' +
          bestScore.toFixed(3) +
          ' (umbral ' +
          FUZZY_THRESHOLD +
          ')'
      );
    }
  }
  return null;
}

/* --------------------------------------------------------------------
 * Payload builder + upsert loop (upsertBpPescaToFirestore)
 * ------------------------------------------------------------------ */

const UDF_DIVISION_KEYS = /** @type {const} */ ([
  'U_DIVISION',
  'U_Division',
  'U_division',
  'U_DIV',
  'U_Categoria',
  'U_CATEGORIA',
]);
const PESCA_DIVISION_VALUES = new Set(['2', '3', 'PESCA', 'BIKE & PESCA', 'BIKE&PESCA']);

/**
 * Devuelve el valor del UDF DIVISION probando variantes del nombre (SL es
 * picky con UDFs). Devuelve string trimmed uppercase.
 *
 * @param {any} bp
 * @returns {string}
 */
export function getBpDivision(bp) {
  if (!bp) return '';
  for (const k of UDF_DIVISION_KEYS) {
    const v = bp[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim().toUpperCase();
    }
  }
  return '';
}

/**
 * Construye el payload base para upsert. Replica línea-por-línea de Python
 * (scripts/sync_sap_to_firestore.py:1221-1270).
 *
 * NO escribe aún — es helper puro.
 *
 * @param {any} bp
 * @param {Record<string, string>} provincesMap
 * @param {any} FieldValue - firestore.FieldValue (SERVER_TIMESTAMP sentinel).
 * @returns {{payload: Record<string, any>, cardcode: string, cardname: string, provincia_final: string}}
 */
export function buildBpBasePayload(bp, provincesMap, FieldValue) {
  const cardcode = String((bp && bp.CardCode) || '').trim();
  const cardname = String((bp && bp.CardName) || '').trim();
  let slpHeader = bp && bp.SalesPersonCode;
  if (slpHeader !== undefined && slpHeader !== null) {
    const n = Number(slpHeader);
    slpHeader = Number.isFinite(n) ? n : null;
  } else {
    slpHeader = null;
  }
  const provCodeRaw = String((bp && (bp.U_SH_PCIA || bp.Province)) || '').trim();
  let provName = '';
  if (provCodeRaw && provincesMap) provName = provincesMap[provCodeRaw] || '';
  if (!provName) {
    const addrs = (bp && bp.BPAddresses) || [];
    for (const addr of addrs) {
      const st = String((addr && (addr.State || addr.State1)) || '').trim();
      if (st && provincesMap) {
        provName = provincesMap[st] || '';
        if (provName) break;
      }
    }
  }
  const provinciaFinal = provName || provCodeRaw || '';
  const serverTs =
    FieldValue && FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : new Date();
  /** @type {Record<string, any>} */
  const payload = {
    comercio: cardname,
    fantasia: cardname,
    cardCodeSap: cardcode,
    cuit: _normCuit((bp && bp.FederalTaxID) || ''),
    calle: (bp && bp.Address) || '',
    localidad: (bp && bp.City) || '',
    localidadFinal: (bp && bp.City) || '',
    codigoPostal: (bp && bp.ZipCode) || '',
    provincia: provinciaFinal ? provinciaFinal.toUpperCase() : '',
    telefonoContacto: (bp && (bp.Phone1 || bp.Cellular)) || '',
    email: (bp && bp.EmailAddress) || '',
    sapCardType: (bp && bp.CardType) || '',
    sapSalesPersonCode: slpHeader,
    sapDivision: (bp && bp.U_DIVISION) || '',
    sapValid: (bp && bp.Valid) || '',
    sapFrozen: (bp && bp.Frozen) || '',
    sapUpdateDate: (bp && bp.UpdateDate) || '',
    sapProvinceRaw: provCodeRaw,
    sapReadyForSL:
      (bp && bp.CardType) === 'cCustomer' &&
      (bp && bp.Valid) === 'tYES' &&
      (bp && bp.Frozen) !== 'tYES',
    status: 'approved',
    manualSapPending: false,
    source: 'sap_sync',
    syncedAt: serverTs,
    updatedAt: serverTs,
  };
  // v291+: NO pisar localidad/provincia/calle/codigoPostal si SAP está vacío.
  if (!String((bp && bp.City) || '').trim()) {
    delete payload.localidad;
    delete payload.localidadFinal;
  }
  if (!provinciaFinal) {
    delete payload.provincia;
  }
  if (!String((bp && bp.Address) || '').trim()) {
    delete payload.calle;
  }
  if (!String((bp && bp.ZipCode) || '').trim()) {
    delete payload.codigoPostal;
  }
  return { payload, cardcode, cardname, provincia_final: provinciaFinal };
}

/**
 * Aplica guards v299+/v300+ sobre un payload cuando hay match existente.
 * Preserva fantasia manual + provincia/localidad bloqueadas por provinciaLocSource.
 *
 * MUTA el payload (remueve campos). Devuelve logs generados para el caller.
 *
 * @param {Record<string, any>} payload
 * @param {any} match - doc client_applications existente.
 * @param {string} cardcode
 * @param {string} cardname
 * @returns {{logs: string[]}}
 */
export function applyManualFieldPreservation(payload, match, cardcode, cardname) {
  /** @type {string[]} */
  const logs = [];
  if (!match) return { logs };
  // Preservar fantasia manual (v299+).
  const existingFant = String(match.fantasia || '').trim();
  const existingCom = String(match.comercio || '').trim();
  const hasManualFantasia =
    existingFant.length > 0 &&
    existingFant.toLowerCase() !== existingCom.toLowerCase() &&
    existingFant.toLowerCase() !== String(cardname).trim().toLowerCase();
  if (hasManualFantasia) {
    delete payload.fantasia;
    logs.push(
      '[bp] preserva fantasia manual: ' +
        cardcode +
        ' keep=' +
        JSON.stringify(existingFant) +
        ' (sap dice ' +
        JSON.stringify(cardname) +
        ')'
    );
  }
  // Preservar provincia/localidad si tiene marker manual (v300+).
  const provLockedMarker = String(match.provinciaLocSource || '').trim();
  if (provLockedMarker && provLockedMarker !== 'sap_sync') {
    if ('provincia' in payload) {
      logs.push(
        '[bp] preserva provincia manual: ' +
          cardcode +
          ' keep=' +
          JSON.stringify(match.provincia) +
          ' source=' +
          JSON.stringify(provLockedMarker) +
          ' (sap dice ' +
          JSON.stringify(payload.provincia) +
          ')'
      );
      delete payload.provincia;
    }
    if ('localidad' in payload) {
      delete payload.localidad;
      delete payload.localidadFinal;
    }
  }
  return { logs };
}

/**
 * Upsert loop principal. Replica línea-por-línea de Python
 * `upsert_bp_pesca_to_firestore` (scripts/sync_sap_to_firestore.py:1112).
 *
 * Dependencias inyectables:
 *   - `fbDb`: Firestore admin.
 *   - `FieldValue`: firestore.FieldValue (para serverTimestamp).
 *   - `log`: logger function.
 *   - `dryRun`: boolean — true → no escribe, solo loguea.
 *   - `provincesMap`: {code: name}.
 *   - `vendorUids`: {email: uid}. Reservado para uso futuro (hoy no se pobla
 *     vendor en el upsert — admin lo asigna manual).
 *
 * @param {object} params
 * @param {any} params.fbDb
 * @param {any} params.FieldValue
 * @param {Array<any>} params.bps - BPs SAP (sin filtro DIVISION aplicado).
 * @param {Record<string, string>} [params.vendorUids]
 * @param {Record<string, string>} [params.provincesMap]
 * @param {boolean} [params.dryRun]
 * @param {(msg: string, ctx?: any) => void} [params.log]
 * @returns {Promise<{created: number, updated_prov_to_conf: number, updated_existing: number, skipped_unknown_vendor: number, skipped_not_pesca: number}>}
 */
export async function upsertBpPescaToFirestore(params) {
  const { fbDb, FieldValue, bps } = params;
  const dryRun = !!params.dryRun;
  const provincesMap = params.provincesMap || {};
  const _log = params.log || (() => {});
  const existingApps = await loadExistingClientApplications({ fbDb, log: _log });
  const stats = {
    created: 0,
    updated_prov_to_conf: 0,
    updated_existing: 0,
    skipped_unknown_vendor: 0,
    skipped_not_pesca: 0,
  };
  // Diagnóstico sample (Python v285+/v286+).
  if (bps.length) {
    const sample = bps[0];
    const udfKeys = Object.keys(sample).filter((k) => k.startsWith('U_'));
    _log(
      '[bp] sample BP CardCode=' + sample.CardCode + ', UDFs detectados: ' + JSON.stringify(udfKeys)
    );
  }
  for (const bp of bps) {
    const division = getBpDivision(bp);
    if (!PESCA_DIVISION_VALUES.has(division)) {
      stats.skipped_not_pesca++;
      continue;
    }
    const built = buildBpBasePayload(bp, provincesMap, FieldValue);
    const { payload, cardcode, cardname } = built;
    const match = findMatch(bp, existingApps, { log: _log });
    const preservation = applyManualFieldPreservation(payload, match, cardcode, cardname);
    for (const line of preservation.logs) _log(line);
    if (match === null) {
      // CREATE nuevo.
      payload.createdAt =
        FieldValue && FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : new Date();
      payload.assignedVendor = '';
      payload.ownerUid = '';
      payload.ownerEmail = '';
      payload.ownerName = '';
      if (dryRun) {
        _log('[DRY_RUN/bp] CREATE ' + cardcode + ' (' + cardname + ') sin vendedor asignado');
      } else {
        await fbDb.collection('client_applications').add(payload);
      }
      stats.created++;
      _log(
        '[bp] CREATED ' +
          cardcode +
          ' (' +
          cardname +
          ') - admin debe asignar vendedor+zona en la app'
      );
      continue;
    }
    const wasProvisorio = Boolean(match.manualSapPending) || !match.cardCodeSap;
    const wasFuzzy = Boolean(match.__fuzzy_matched);
    if (wasProvisorio) {
      // PROV → CONF (match + confirmación).
      if (wasFuzzy) {
        payload.mergedFromCardCode = cardcode;
        payload.mergedAt =
          FieldValue && FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : new Date();
        payload.mergedBy = 'cf/syncBpPescaCore/fuzzy_match';
        payload.mergedFuzzyScore = Number(match.__fuzzy_score) || 0;
        payload.mergedFuzzyField = String(match.__fuzzy_field || '');
      }
      if (dryRun) {
        _log(
          '[DRY_RUN/bp] PROV->CONF ' +
            match.__id +
            ' (' +
            cardname +
            ') -> cardCodeSap=' +
            cardcode +
            (wasFuzzy ? ' [FUZZY score=' + Number(match.__fuzzy_score || 0).toFixed(3) + ']' : '')
        );
      } else {
        await match.__ref.set(payload, { merge: true });
        if (wasFuzzy) {
          try {
            const nowIso = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
            const logId = nowIso + '_' + cardcode;
            await fbDb
              .collection('lead_merge_log')
              .doc(logId)
              .set({
                ranAt:
                  FieldValue && FieldValue.serverTimestamp
                    ? FieldValue.serverTimestamp()
                    : new Date(),
                by: 'cf/syncBpPescaCore/auto_fuzzy',
                leadFsId: match.__id,
                leadComercio: match.comercio || match.fantasia || '',
                leadProvincia: match.provincia || '',
                leadLocalidad: match.localidad || '',
                sapCardCode: cardcode,
                sapComercio: cardname,
                fuzzyScore: Number(match.__fuzzy_score) || 0,
                fuzzyField: String(match.__fuzzy_field || ''),
                trigger: 'auto',
              });
          } catch (e) {
            _log(
              '[WARN/bp] audit lead_merge_log fallo (no bloqueante): ' +
                ((e && /** @type {any} */ (e).message) || String(e))
            );
          }
        }
      }
      stats.updated_prov_to_conf++;
      _log(
        '[bp] PROV->CONF ' +
          match.__id +
          ' (' +
          cardname +
          ') cardCodeSap=' +
          cardcode +
          (wasFuzzy ? ' [AUTO-FUZZY ' + Number(match.__fuzzy_score || 0).toFixed(3) + ']' : '')
      );
    } else {
      // UPDATE existing.
      if (dryRun) {
        _log('[DRY_RUN/bp] UPDATE ' + match.__id + ' (' + cardname + ')');
      } else {
        await match.__ref.set(payload, { merge: true });
      }
      stats.updated_existing++;
      _log('[bp] UPDATED ' + match.__id + ' (' + cardname + ') cardCodeSap=' + cardcode);
    }
  }
  return stats;
}

/* --------------------------------------------------------------------
 * Orchestrador (sync_bp_pesca)
 * ------------------------------------------------------------------ */

/**
 * Orchestra el sync completo de BPs pesca. Replica de Python `sync_bp_pesca`
 * (scripts/sync_sap_to_firestore.py:1407).
 *
 * **Feature flag**: lee `app_config/sap_integration.bpSyncByCF`. Si es false
 * (default), corre en dryRun. Si true, escribe real.
 *
 * **Fallback explícito**: cualquier error se captura + loguea + se devuelve
 * `{ok: false, error}` sin abortar el sync principal (igual que Python).
 *
 * @param {object} params
 * @param {any} params.fbDb
 * @param {any} params.FieldValue
 * @param {{url: string}} params.sapConfig
 * @param {string} params.cookie - cookie SL ya logueada.
 * @param {boolean} [params.forceDryRun] - override del flag (para testing).
 * @param {(msg: string, ctx?: any) => void} [params.log]
 * @returns {Promise<{ok: boolean, stats?: any, error?: string, slRequests: number, bpSyncByCFFlag: boolean, dryRun: boolean}>}
 */
export async function syncBpPesca(params) {
  const { fbDb, FieldValue, sapConfig, cookie } = params;
  const _log = params.log || (() => {});
  _log('[bp] === sync BPs pesca START (CF) ===');
  let bpSyncByCFFlag = false;
  try {
    const flagDoc = await fbDb.doc('app_config/sap_integration').get();
    const flagData = flagDoc.exists ? flagDoc.data() || {} : {};
    bpSyncByCFFlag = Boolean(flagData.bpSyncByCF);
  } catch (e) {
    _log(
      '[bp] WARN leyendo bpSyncByCF (default false): ' +
        ((e && /** @type {any} */ (e).message) || String(e))
    );
  }
  const dryRun = params.forceDryRun === true || !bpSyncByCFFlag;
  _log('[bp] bpSyncByCF=' + bpSyncByCFFlag + ' → dryRun=' + dryRun);
  let slRequests = 0;
  try {
    const provRes = await loadArProvincesMap({ sapConfig, cookie, log: _log });
    slRequests += provRes.slRequests;
    const bpRes = await fetchBpPescaFromSl({ sapConfig, cookie, log: _log });
    slRequests += bpRes.slRequests;
    if (!bpRes.bps.length) {
      _log('[bp] SL devolvio 0 BPs pesca. No hago nada.');
      return {
        ok: true,
        stats: {
          created: 0,
          updated_prov_to_conf: 0,
          updated_existing: 0,
          skipped_unknown_vendor: 0,
          skipped_not_pesca: 0,
        },
        slRequests,
        bpSyncByCFFlag,
        dryRun,
      };
    }
    const stats = await upsertBpPescaToFirestore({
      fbDb,
      FieldValue,
      bps: bpRes.bps,
      provincesMap: provRes.map,
      dryRun,
      log: _log,
    });
    _log(
      '[bp] === sync BPs pesca END: created=' +
        stats.created +
        ', prov->conf=' +
        stats.updated_prov_to_conf +
        ', updated=' +
        stats.updated_existing +
        ', skipped_vendor=' +
        stats.skipped_unknown_vendor +
        ', skipped_not_pesca=' +
        stats.skipped_not_pesca +
        ' ==='
    );
    return { ok: true, stats, slRequests, bpSyncByCFFlag, dryRun };
  } catch (e) {
    const msg = (e && /** @type {any} */ (e).message) || String(e);
    _log('[bp] FATAL sync BPs pesca: ' + msg + '. Sigo sin abortar el sync general.');
    return { ok: false, error: msg, slRequests, bpSyncByCFFlag, dryRun };
  }
}
