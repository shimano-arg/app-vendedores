// @ts-check
/**
 * v1051 (2026-09-23): re-check server-side de stock disponible en SAP whs 11
 * ANTES de POST-ear una SQ. Cierra la barrera faltante identificada en la
 * auditoria de 2026-09-23:
 *
 *   `buildQuotationPayload` filtra por `state === 'confirmed'` pero el `state`
 *   se decidió CLIENT-SIDE contra un snapshot local (STOCK_MAP) que puede
 *   tener hasta ~5 min de antigüedad + no considera pedidos concurrentes que
 *   otro VDE cargó en la misma ventana + no considera ventas hechas fuera de
 *   la app. Resultado: SQ con `Quantity > OnHandCommitted` de SAP.
 *
 * Estrategia:
 * 1. Extraer ItemCodes únicos de las `documentLines` post-build.
 * 2. GET a SAP `/Items?$filter=(ItemCode eq 'X') or (ItemCode eq 'Y')`
 *    con `$select=ItemCode,ItemWarehouseInfoCollection` (SL soporta el
 *    encoding `or` con paréntesis).
 * 3. Para cada Item, buscar el warehouse `11` en `ItemWarehouseInfoCollection`
 *    y computar `available = InStock - Committed - Ordered` (definición NETO;
 *    mismo cálculo que el sync `sync_sap_to_firestore.py:839+`, `v839`).
 * 4. Comparar cada `DocumentLine.Quantity` contra `available` de su ItemCode:
 *    - Si `Quantity <= available` → línea queda intacta.
 *    - Si `Quantity > available` → línea DEGRADED (removida del payload).
 * 5. Retornar `{keptLines, degradedLines[]}` para que el caller decida:
 *    - Todas degraded → skip envío (marcar `via='app_only'`).
 *    - Algunas degraded → mandar solo las que sobreviven + escribir auditoría.
 *
 * FAIL-OPEN por diseño: si el GET a SAP falla (500, timeout, parse error),
 * el caller sigue con el envío como antes (comportamiento previo a v1051).
 * Esta capa es DEFENSIVA — no debe empeorar el flujo si SAP tiene un hipo.
 *
 * Testeable con mocks de `sapGet` (todos los deps inyectados).
 */

import { sapGet } from './sap-sl-client.js';

/** Warehouse code para stock vendible pesca (v369+ definición canónica). */
export const SALES_WAREHOUSE = '11';
/** v1549: SAP SL pagina de a 20; consultamos en tandas de ese tamaño. */
export const LIVE_STOCK_CHUNK_SIZE = 20;
/** v1549: tope defensivo de páginas por tanda (con tandas de 20 debería ser 1). */
export const LIVE_STOCK_MAX_PAGES_PER_CHUNK = 10;

/**
 * @typedef {Object} DocumentLine
 * @property {string} ItemCode
 * @property {number} Quantity
 * @property {string} [WarehouseCode]
 *
 * @typedef {Object} StockRecheckResult
 * @property {Array<DocumentLine>} keptLines Líneas que caben en stock actual.
 * @property {Array<{itemCode: string, requested: number, available: number, reason: string}>} degradedLines Líneas removidas + motivo (para auditoría).
 * @property {Map<string, number>} availabilityMap Cache del check (itemCode → available whs 11).
 * @property {boolean} checkSucceeded true si el GET a SAP retornó OK. false = fail-open (todas las líneas quedan).
 * @property {string} [checkError] Motivo del fail-open, si aplica.
 */

/**
 * Query a SAP para stock neto disponible en whs `11` para una lista de ItemCodes.
 * Devuelve un Map itemCode -> availableNet (int, mínimo 0). Los ItemCodes que
 * SAP no reconozca quedan ausentes del Map (el caller los trata como 0).
 *
 * @param {import('./sap-sl-client.js').SapSession} session
 * @param {Array<string>} itemCodes
 * @param {import('./sap-sl-client.js').SapSlDeps} deps
 * @returns {Promise<{ok: true, map: Map<string, number>} | {ok: false, error: string}>}
 */
export async function fetchLiveWhs11Availability(session, itemCodes, deps) {
  if (!Array.isArray(itemCodes) || itemCodes.length === 0) {
    return { ok: true, map: new Map() };
  }
  // v1549 (2026-11-03) — bug ARIZAGA SQ 2000476: SAP Service Layer devuelve
  // como MÁXIMO 20 registros por página (+ `odata.nextLink`), aunque se pida
  // `$top=N`. Antes se hacía UN solo GET con todos los ItemCodes: los
  // productos después del 20 no volvían, quedaban fuera del map y
  // filterLinesByLiveStock los marcaba `sap_item_not_found` → la CAPA (c)
  // del auto-send los sacaba del envío en silencio (SAP recibió 20 líneas por
  // $2.615.000 de un pedido de $5.176.000). Ahora: tandas de 20 ItemCodes por
  // GET y, por las dudas, se sigue `odata.nextLink` dentro de cada tanda. Si
  // CUALQUIER página falla, el chequeo entero devuelve ok:false (el caller es
  // fail-safe §v1180: no envía, no degrada nada).
  /** @type {Map<string, number>} */
  const map = new Map();
  const select = 'ItemCode,ItemWarehouseInfoCollection';
  const uniqueCodes = Array.from(new Set(itemCodes.map((c) => String(c))));
  for (let i = 0; i < uniqueCodes.length; i += LIVE_STOCK_CHUNK_SIZE) {
    const chunk = uniqueCodes.slice(i, i + LIVE_STOCK_CHUNK_SIZE);
    // SAP SL /Items acepta $filter con `or` encadenado. Los ItemCodes son
    // alfanuméricos (validados por resolveItemCode upstream); igual sanitizamos
    // apostrofes por si acaso — SL respeta el escaping OData estándar (`''`).
    const clauses = chunk.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`);
    const filter = clauses.join(' or ');
    /** @type {string | null} */
    let endpoint =
      `/b1s/v1/Items?$filter=${encodeURIComponent(filter)}` +
      `&$select=${encodeURIComponent(select)}` +
      `&$top=${chunk.length}`;
    let pages = 0;
    while (endpoint) {
      pages++;
      if (pages > LIVE_STOCK_MAX_PAGES_PER_CHUNK) {
        return {
          ok: false,
          error: `SL Items paginación excedió ${LIVE_STOCK_MAX_PAGES_PER_CHUNK} páginas`,
        };
      }
      let resp;
      try {
        resp = await sapGet(session, endpoint, deps);
      } catch (e) {
        return { ok: false, error: 'sapGet threw: ' + ((e && e.message) || String(e)) };
      }
      if (resp.status !== 200) {
        return { ok: false, error: `SL Items GET status=${resp.status}` };
      }
      const body = resp.body && typeof resp.body === 'object' ? resp.body : {};
      const rows = Array.isArray(body.value) ? body.value : [];
      for (const row of rows) {
        const itemCode = row && row.ItemCode;
        if (!itemCode) continue;
        const whsList = Array.isArray(row.ItemWarehouseInfoCollection)
          ? row.ItemWarehouseInfoCollection
          : [];
        const whs11 = whsList.find(
          (/** @type {any} */ w) => String(w.WarehouseCode) === SALES_WAREHOUSE
        );
        if (!whs11) {
          map.set(itemCode, 0);
          continue;
        }
        const inStock = Number(whs11.InStock) || 0;
        const committed = Number(whs11.Committed) || 0;
        // v839+ definición NETO: available = InStock - Committed (`Ordered`
        // son compras entrantes, no se restan).
        const available = Math.max(0, Math.trunc(inStock - committed));
        map.set(itemCode, available);
      }
      endpoint = normalizeNextLink(body['@odata.nextLink'] || body['odata.nextLink'] || null);
    }
  }
  return { ok: true, map };
}

/**
 * v1549: convierte el `odata.nextLink` de SAP SL (absoluto, relativo a
 * /b1s/v1/ o con barra inicial) en el endpoint que espera `sapGet`.
 * @param {string | null} nextLink
 * @returns {string | null}
 */
export function normalizeNextLink(nextLink) {
  if (!nextLink || typeof nextLink !== 'string') return null;
  if (nextLink.startsWith('http')) {
    const idx = nextLink.indexOf('/b1s/v1/');
    return idx >= 0 ? nextLink.slice(idx) : null;
  }
  if (nextLink.startsWith('/b1s/')) return nextLink;
  if (nextLink.startsWith('/')) return '/b1s/v1' + nextLink;
  return '/b1s/v1/' + nextLink;
}

/**
 * Filtra `documentLines` por disponibilidad LIVE en SAP whs 11. Sólo mantiene
 * las líneas donde `Quantity <= available`. Las que excedan quedan out y se
 * reportan en `degradedLines` para auditoría en Firestore.
 *
 * FAIL-OPEN: si `fetchLiveWhs11Availability` falla (SAP down, timeout, parse),
 * retorna todas las líneas intactas con `checkSucceeded=false` + `checkError`.
 * El caller decide si logea y sigue (recomendado) o aborta.
 *
 * v1473 (2026-10-26) — `opts.skipByItemCode` para líneas CPST (origen=
 * stock-asignado + asigRefs). Esas líneas YA pasaron por
 * `breakdown.utilizablePara(cardCode)` en `commitPedidoCore` (CLAUDE.md §33 +
 * §35 + §39): la reserva propia del cliente las respalda. Re-chequear contra
 * whs 11 raw de SAP las degrada espuriamente porque SAP ya tiene esa qty
 * "Committed" en otro doc. Equivalente operacional a §39 utilizablePara en
 * el envío a SAP. Reportado Federico ORDEN 530 (único caso real HOY fue
 * sap_item_not_found, no insufficient; el skip es defensivo para prevenir el
 * bug equivalente a v1466 pero en el envío a SAP).
 *
 * @param {import('./sap-sl-client.js').SapSession} session
 * @param {Array<DocumentLine>} documentLines Post-dedup, post-buildQuotationPayload.
 * @param {import('./sap-sl-client.js').SapSlDeps} deps
 * @param {{skipByItemCode?: Set<string> | string[]}} [opts]
 * @returns {Promise<StockRecheckResult>}
 */
export async function filterLinesByLiveStock(session, documentLines, deps, opts) {
  const lines = Array.isArray(documentLines) ? documentLines : [];
  const _skipSetSrc = opts && opts.skipByItemCode ? opts.skipByItemCode : null;
  const skipSet =
    _skipSetSrc instanceof Set
      ? _skipSetSrc
      : Array.isArray(_skipSetSrc)
        ? new Set(_skipSetSrc.map((c) => String(c).toUpperCase()))
        : new Set();
  if (lines.length === 0) {
    return {
      keptLines: [],
      degradedLines: [],
      availabilityMap: new Map(),
      checkSucceeded: true,
    };
  }
  // Items que SI pasan por el recheck (los que NO están en skipSet).
  const itemCodesForQuery = Array.from(
    new Set(
      lines
        .map((l) => (l && l.ItemCode ? String(l.ItemCode) : ''))
        .filter(Boolean)
        .filter((c) => !skipSet.has(c.toUpperCase()))
    )
  );
  const avail =
    itemCodesForQuery.length > 0
      ? await fetchLiveWhs11Availability(session, itemCodesForQuery, deps)
      : /** @type {{ok: true, map: Map<string, number>}} */ ({ ok: true, map: new Map() });
  if (!avail.ok) {
    // Fail-open: mantener todas las líneas.
    return {
      keptLines: lines.slice(),
      degradedLines: [],
      availabilityMap: new Map(),
      checkSucceeded: false,
      checkError: /** @type {{ok: false, error: string}} */ (avail).error,
    };
  }
  const map = avail.map;
  /** @type {Array<DocumentLine>} */
  const kept = [];
  /** @type {Array<{itemCode: string, requested: number, available: number, reason: string}>} */
  const degraded = [];
  for (const l of lines) {
    if (!l || !l.ItemCode) continue;
    const itemCodeUp = String(l.ItemCode).toUpperCase();
    // v1473 §39: líneas CPST con reserva propia validada — NO re-chequear.
    if (skipSet.has(itemCodeUp)) {
      kept.push(l);
      continue;
    }
    const requested = Number(l.Quantity) || 0;
    const available = map.has(l.ItemCode) ? Number(map.get(l.ItemCode)) : 0;
    if (requested <= available) {
      kept.push(l);
    } else {
      degraded.push({
        itemCode: l.ItemCode,
        requested,
        available,
        reason: !map.has(l.ItemCode) ? 'sap_item_not_found' : 'insufficient_whs11_stock',
      });
    }
  }
  return {
    keptLines: kept,
    degradedLines: degraded,
    availabilityMap: map,
    checkSucceeded: true,
  };
}

/**
 * Construye el `skipByItemCode` Set desde `pedido.lines`: incluye SKUs que
 * tengan al menos una línea con `origen='stock-asignado'` + `asigRefs`
 * populated. Esos SKUs ya pasaron por `utilizablePara(cardCode)` en el
 * commit; el recheck contra whs11 raw los degrada espuriamente.
 *
 * CLAUDE.md §33 + §35 + §39 (equivalente operacional en el envío a SAP).
 *
 * @param {Array<any>} pedidoLines
 * @returns {Set<string>}
 */
export function buildSkipSetForCpstLines(pedidoLines) {
  const out = new Set();
  if (!Array.isArray(pedidoLines)) return out;
  for (const l of pedidoLines) {
    if (!l) continue;
    if (l.origen !== 'stock-asignado') continue;
    if (!Array.isArray(l.asigRefs) || l.asigRefs.length === 0) continue;
    const sku = String(l.code || l.sku || '')
      .toUpperCase()
      .trim();
    if (sku) out.add(sku);
  }
  return out;
}
