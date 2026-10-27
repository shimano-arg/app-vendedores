// @ts-check
/**
 * backorder-export-rows (v1488 §86, 2026-10-27) — fuente única para armar
 * filas de export de backorder. Reemplaza la divergencia histórica entre
 * `exportBackorderAll` (panel izquierdo) y `exportBackordersToExcel` (modal).
 *
 * Antes v1488: ambos exports usaban variantes distintas del compute
 * (`computeBackorderRawLines` sin filtros vs `computeBackorderSkuMap` con
 * `includeExpired=true`). Resultado: 222 unidades de diferencia en prod
 * (modal 7696 vs panel 7474) por BOs > 90 días que el panel ocultaba.
 *
 * Decisión §40.1 + §65: la cola de backorder es TODA la demanda pendiente
 * independiente de edad (red §37 solo descarta como reserva, no como
 * demanda). Default `includeExpired=true` alineado con
 * `getStockBreakdown.backorderApp.total`.
 *
 * Esta fn:
 *   1. Llama `computeBackorderSkuMap` (consolida por cliente+SKU según §56).
 *   2. Aplana a filas con columnas estándar.
 *   3. Agrega "Edad_BO_dias" para que el admin filtre en Excel si quiere ver
 *      solo demanda joven.
 *
 * Call-sites post-v1488:
 *   - `src/domains/exports-core.js:exportBackorderAll` (panel).
 *   - `index.html:exportBackordersToExcel` (modal).
 */

import { computeBackorderSkuMap } from './backorder-sku-map.js';

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * @param {any} ts  Timestamp Firestore (toMillis / seconds / _seconds), string ISO, Date o number.
 * @returns {number | null} ms epoch o null si no parseable.
 */
function _toMillisSafe(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string' && ts) {
    const n = Date.parse(ts);
    return Number.isNaN(n) ? null : n;
  }
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'object') {
    if (typeof ts.toMillis === 'function') {
      try {
        return ts.toMillis();
      } catch (_e) {
        /* fall through */
      }
    }
    if (typeof ts.toDate === 'function') {
      try {
        return ts.toDate().getTime();
      } catch (_e) {
        /* fall through */
      }
    }
    if (typeof ts.seconds === 'number') {
      return (
        ts.seconds * 1000 +
        (typeof ts.nanoseconds === 'number' ? Math.floor(ts.nanoseconds / 1e6) : 0)
      );
    }
    if (typeof ts._seconds === 'number') {
      return (
        ts._seconds * 1000 +
        (typeof ts._nanoseconds === 'number' ? Math.floor(ts._nanoseconds / 1e6) : 0)
      );
    }
  }
  return null;
}

/**
 * @typedef {Object} ExportFilters
 * @property {string} [tiendaQuery]
 * @property {string} [vendorKey]
 * @property {string} [mesYYYYMM]
 * @property {string} [urgencyFilter]
 * @property {boolean} [includeExpired]  Default `true` (toda la cola §40.1).
 */

/**
 * @typedef {Object} ExportRow
 * @property {string} SKU
 * @property {string} Producto
 * @property {string} Cliente
 * @property {string} CardCode
 * @property {string} Provincia
 * @property {string} Localidad
 * @property {string} Vendedor
 * @property {number} Cantidad_Pendiente_BO
 * @property {number} Precio_Unit_ARS
 * @property {number} Subtotal_BO_ARS
 * @property {number | ''} Edad_BO_dias  Días desde el createdAt del pedido más viejo del par cliente+SKU.
 * @property {string} Estado  'BO' | 'ASIG' | 'confirmed' (post-FIFO del compute).
 * @property {string} Pedidos  Lista de pedidoIds (coma-separada) que suman a esta fila.
 */

/**
 * Arma las filas del export de backorder desde `pedidos` + filtros. Fuente
 * única para los 2 exports (panel + modal). Usa `computeBackorderSkuMap`
 * para consolidación §56 + §40.1 (incluye expired por default).
 *
 * @param {Array<any>} pedidos  globalPedidos de Firestore.
 * @param {ExportFilters | undefined} filters
 * @param {{getStockDisponibleVenta: Function, canonVendor: Function, products: Array<any>, resolveVendorFallback: Function}} deps
 * @returns {{rows: Array<ExportRow>, totalUnidades: number, totalFilas: number, filtrosAplicados: any}}
 */
export function computeBackorderExportRows(pedidos, filters, deps) {
  /** @type {any} */
  const f = filters || {};
  // v1488 §86: `includeExpired` default `true` — alinea con §40.1 (toda la
  // cola, incluyendo BOs > 90d que son "demanda vieja pero existente").
  const includeExpired = f.includeExpired !== false;
  const mapFilters = {
    tiendaQuery: f.tiendaQuery || '',
    vendorKey: f.vendorKey || '',
    mesYYYYMM: f.mesYYYYMM || '',
    aggregationMode: 'fifo',
    urgencyFilter: f.urgencyFilter || '',
    includeExpired,
  };
  const mapResult = computeBackorderSkuMap(
    pedidos || [],
    'urgente',
    /** @type {any} */ (mapFilters),
    /** @type {any} */ (deps)
  );
  // Index pedidoId → createdAt (para calcular Edad_BO_dias).
  /** @type {Map<string, number>} */
  const createdAtByPedido = new Map();
  for (const p of pedidos || []) {
    if (!p || !p._fsId) continue;
    const ms = _toMillisSafe(p.createdAt);
    if (ms !== null) createdAtByPedido.set(p._fsId, ms);
  }
  const now = Date.now();
  /** @type {Array<ExportRow>} */
  const rows = [];
  for (const g of mapResult.skus) {
    for (const c of g.clientes || []) {
      const qty = Number(c.qtyBackorder) || 0;
      if (qty <= 0) continue;
      // Edad: tomar el createdAt más viejo de los pedidos que suman a este cliente+SKU.
      /** @type {number | null} */
      let oldestMs = null;
      if (Array.isArray(c.pedidoIds)) {
        for (const p of c.pedidoIds) {
          const ms = p && p.pedidoId ? createdAtByPedido.get(p.pedidoId) : undefined;
          if (ms !== undefined && (oldestMs === null || ms < oldestMs)) oldestMs = ms;
        }
      }
      /** @type {number | ''} */
      const edadDias = oldestMs !== null ? Math.floor((now - oldestMs) / DAY_MS) : '';
      const pedidosStr = Array.isArray(c.pedidoIds)
        ? c.pedidoIds
            .map((p) => p.pedidoId)
            .filter(Boolean)
            .join(',')
        : '';
      rows.push({
        SKU: g.sku || '',
        Producto: g.producto || '',
        Cliente: c.nombre || '',
        CardCode: c.code || '',
        Provincia: c.provincia || '',
        Localidad: c.ciudad || '',
        Vendedor: c.vendorKey || '',
        Cantidad_Pendiente_BO: qty,
        Precio_Unit_ARS: Number(c.precio) || 0,
        Subtotal_BO_ARS: Math.round(qty * (Number(c.precio) || 0)),
        Edad_BO_dias: edadDias,
        Estado: c.state || 'BO',
        Pedidos: pedidosStr,
      });
    }
  }
  // Orden: por Cliente, luego SKU.
  rows.sort((a, b) => {
    const c = (a.Cliente || '').localeCompare(b.Cliente || '');
    if (c !== 0) return c;
    return (a.SKU || '').localeCompare(b.SKU || '');
  });
  const totalUnidades = rows.reduce((s, r) => s + r.Cantidad_Pendiente_BO, 0);
  const filtrosAplicados = {
    tiendaQuery: f.tiendaQuery || '',
    vendorKey: f.vendorKey || '',
    mesYYYYMM: f.mesYYYYMM || '',
    urgencyFilter: f.urgencyFilter || '',
    includeExpired,
  };
  return {
    rows,
    totalUnidades,
    totalFilas: rows.length,
    filtrosAplicados,
  };
}

/**
 * Formatea los filtros aplicados para una fila de encabezado del xlsx.
 * Mariano v1488: "mantener el filtro sobre la misma funcion y declararlo en
 * el nombre del archivo y en una fila de encabezado".
 *
 * @param {any} filtros  resultado.filtrosAplicados.
 * @returns {string}
 */
export function formatBackorderFiltrosHeader(filtros) {
  const f = filtros || {};
  const parts = [];
  if (f.tiendaQuery) parts.push(`tienda="${f.tiendaQuery}"`);
  if (f.vendorKey) parts.push(`vendedor="${f.vendorKey}"`);
  if (f.mesYYYYMM) parts.push(`mes=${f.mesYYYYMM}`);
  if (f.urgencyFilter) parts.push(`urgencia=${f.urgencyFilter}`);
  if (f.includeExpired === false) parts.push('solo_vigentes_90d');
  return parts.length > 0
    ? `Filtros: ${parts.join(', ')}`
    : 'Filtros: ninguno (toda la cola §40.1)';
}
