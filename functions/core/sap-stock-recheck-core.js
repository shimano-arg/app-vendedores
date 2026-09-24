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
  // SAP SL /Items acepta $filter con `or` encadenado. Los ItemCodes son
  // alfanuméricos (validados por resolveItemCode upstream); igual sanitizamos
  // apostrofes por si acaso — SL respeta el escaping OData estándar (`''`).
  const clauses = itemCodes.map((c) => `ItemCode eq '${String(c).replace(/'/g, "''")}'`);
  const filter = clauses.join(' or ');
  const select = 'ItemCode,ItemWarehouseInfoCollection';
  const endpoint =
    `/b1s/v1/Items?$filter=${encodeURIComponent(filter)}` +
    `&$select=${encodeURIComponent(select)}` +
    `&$top=${itemCodes.length}`;

  let resp;
  try {
    resp = await sapGet(session, endpoint, deps);
  } catch (e) {
    return { ok: false, error: 'sapGet threw: ' + ((e && e.message) || String(e)) };
  }
  if (resp.status !== 200) {
    return { ok: false, error: `SL Items GET status=${resp.status}` };
  }
  const rows = resp.body && Array.isArray(resp.body.value) ? resp.body.value : [];
  /** @type {Map<string, number>} */
  const map = new Map();
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
    const ordered = Number(whs11.Ordered) || 0;
    // v839+ definición NETO: disponible = física - reservada por SOs abiertas
    // - órdenes de compra recibidas pero no facturadas. `Ordered` en SAP SL
    // representa las compras entrantes (aumenta stock futuro); NO lo restamos.
    // La fórmula correcta que usa sync_sap_to_firestore.py (v839+) es:
    //   available = InStock - Committed
    // dejamos `ordered` capturado por si en un futuro se pide considerar
    // reserva por PO adicional (no aplica hoy).
    void ordered;
    const available = Math.max(0, Math.trunc(inStock - committed));
    map.set(itemCode, available);
  }
  return { ok: true, map };
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
 * @param {import('./sap-sl-client.js').SapSession} session
 * @param {Array<DocumentLine>} documentLines Post-dedup, post-buildQuotationPayload.
 * @param {import('./sap-sl-client.js').SapSlDeps} deps
 * @returns {Promise<StockRecheckResult>}
 */
export async function filterLinesByLiveStock(session, documentLines, deps) {
  const lines = Array.isArray(documentLines) ? documentLines : [];
  if (lines.length === 0) {
    return {
      keptLines: [],
      degradedLines: [],
      availabilityMap: new Map(),
      checkSucceeded: true,
    };
  }
  const itemCodes = Array.from(
    new Set(lines.map((l) => (l && l.ItemCode ? String(l.ItemCode) : '')).filter(Boolean))
  );
  const avail = await fetchLiveWhs11Availability(session, itemCodes, deps);
  if (!avail.ok) {
    // Fail-open: mantener todas las líneas.
    return {
      keptLines: lines.slice(),
      degradedLines: [],
      availabilityMap: new Map(),
      checkSucceeded: false,
      checkError: avail.error,
    };
  }
  const map = avail.map;
  /** @type {Array<DocumentLine>} */
  const kept = [];
  /** @type {Array<{itemCode: string, requested: number, available: number, reason: string}>} */
  const degraded = [];
  for (const l of lines) {
    if (!l || !l.ItemCode) continue;
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
