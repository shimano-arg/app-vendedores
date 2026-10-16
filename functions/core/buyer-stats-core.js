// @ts-check
/**
 * Agregación pura de rows BQ v_ventas_lineas → stats por ventana (3/6/12/24m) por cardCode.
 *
 * Function puro: cero IO, cero Firestore, cero BQ. Recibe rows + nowDate, devuelve
 * un Map(cardCode → { cardName, stats_3m, stats_6m, stats_12m, stats_24m }).
 *
 * Para cada ventana calcula:
 * - montoTotal, facturasCount, montoPromedio
 * - primeraCompra, ultimaCompra (ISO date yyyy-mm-dd)
 * - frecuenciaDias (dias promedio entre facturas)
 * - facturasPorMes
 * - diasDesdeUltima
 * - topSkus (top 25 por monto)
 * - topCategorias (todas, con % share)
 */

const WINDOWS = [3, 6, 12, 24];

/**
 * @typedef {Object} VentaRow
 * @property {string} card_code
 * @property {string} card_name
 * @property {string} item_code
 * @property {string} descripcion_linea
 * @property {number} cantidad
 * @property {number} importe_linea_ars
 * @property {number} doc_entry
 * @property {'INVOICE'|'CREDIT_NOTE'} doc_kind
 * @property {string} fecha              // ISO date yyyy-mm-dd
 * @property {string|null} [categoria]
 * @property {string|null} [familia]
 * @property {string|null} [subfamilia]
 */

/**
 * @param {string} fechaIso yyyy-mm-dd
 * @param {Date} nowDate
 * @returns {number} dias
 */
function daysBetween(fechaIso, nowDate) {
  const d = new Date(fechaIso + 'T00:00:00Z');
  const now = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()));
  const ms = now.getTime() - d.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * @param {Date} nowDate
 * @param {number} months
 * @returns {string} yyyy-mm-dd
 */
function monthsAgo(nowDate, months) {
  const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - months, nowDate.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/**
 * Calcula stats de una ventana para un set de rows filtrado.
 * @param {VentaRow[]} rows
 * @param {Date} nowDate
 * @param {number} windowMonths
 */
function computeWindowStats(rows, nowDate, windowMonths) {
  if (rows.length === 0) {
    return {
      montoTotal: 0, facturasCount: 0, montoPromedio: 0,
      primeraCompra: null, ultimaCompra: null,
      frecuenciaDias: null, facturasPorMes: 0, diasDesdeUltima: null,
      topSkus: [], topCategorias: [],
    };
  }
  let montoTotal = 0;
  const facturasSet = new Set();
  let primera = rows[0].fecha;
  let ultima = rows[0].fecha;
  /** @type {Map<string, {sku:string, nombre:string, qty:number, monto:number, categoria:string}>} */
  const bySku = new Map();
  /** @type {Map<string, number>} */
  const byCat = new Map();

  for (const r of rows) {
    montoTotal += r.importe_linea_ars || 0;
    if (r.doc_kind === 'INVOICE') facturasSet.add(r.doc_entry);
    if (r.fecha < primera) primera = r.fecha;
    if (r.fecha > ultima) ultima = r.fecha;

    const sku = r.item_code;
    if (sku) {
      const existing = bySku.get(sku);
      if (existing) {
        existing.qty += r.cantidad || 0;
        existing.monto += r.importe_linea_ars || 0;
      } else {
        bySku.set(sku, {
          sku,
          nombre: r.descripcion_linea || sku,
          qty: r.cantidad || 0,
          monto: r.importe_linea_ars || 0,
          categoria: r.categoria || r.familia || 'OTRO',
        });
      }
    }
    const cat = r.categoria || r.familia || 'OTRO';
    byCat.set(cat, (byCat.get(cat) || 0) + (r.importe_linea_ars || 0));
  }

  const facturasCount = facturasSet.size;
  const montoPromedio = facturasCount > 0 ? montoTotal / facturasCount : 0;
  const facturasPorMes = windowMonths > 0 ? facturasCount / windowMonths : 0;
  const diasDesdeUltima = daysBetween(ultima, nowDate);

  // Frecuencia días: diferencia primera-ultima dividido facturas (si >= 2)
  let frecuenciaDias = null;
  if (facturasCount >= 2 && primera !== ultima) {
    const spanDays = daysBetween(primera, new Date(ultima + 'T00:00:00Z'));
    frecuenciaDias = Math.abs(spanDays) / (facturasCount - 1);
  }

  // Top 25 SKUs por monto
  const topSkus = Array.from(bySku.values())
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 25)
    .map(s => ({
      sku: s.sku,
      nombre: s.nombre,
      qty: Math.round(s.qty * 100) / 100,
      monto: Math.round(s.monto),
      pctMonto: montoTotal > 0 ? Math.round((s.monto / montoTotal) * 1000) / 10 : 0,
      categoria: s.categoria,
    }));

  // Top categorias con % share
  const topCategorias = Array.from(byCat.entries())
    .map(([categoria, monto]) => ({
      categoria,
      monto: Math.round(monto),
      pctMonto: montoTotal > 0 ? Math.round((monto / montoTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.monto - a.monto);

  return {
    montoTotal: Math.round(montoTotal),
    facturasCount,
    montoPromedio: Math.round(montoPromedio),
    primeraCompra: primera,
    ultimaCompra: ultima,
    frecuenciaDias: frecuenciaDias != null ? Math.round(frecuenciaDias * 10) / 10 : null,
    facturasPorMes: Math.round(facturasPorMes * 100) / 100,
    diasDesdeUltima,
    topSkus,
    topCategorias,
  };
}

/**
 * Agrega todas las rows BQ en stats por cardCode y ventana.
 * @param {VentaRow[]} rows
 * @param {Date} nowDate
 * @returns {Map<string, Object>}
 */
export function aggregateVentasIntoBuyerStats(rows, nowDate) {
  /** @type {Map<string, VentaRow[]>} */
  const byCard = new Map();
  /** @type {Map<string, string>} */
  const cardNames = new Map();
  for (const r of rows) {
    if (!r.card_code) continue;
    const list = byCard.get(r.card_code);
    if (list) list.push(r);
    else byCard.set(r.card_code, [r]);
    if (!cardNames.has(r.card_code) && r.card_name) {
      cardNames.set(r.card_code, r.card_name);
    }
  }

  /** @type {Map<string, Record<string, any>>} */
  const result = new Map();
  for (const [cardCode, cardRows] of byCard.entries()) {
    /** @type {Record<string, any>} */
    const doc = {
      cardCode,
      cardName: cardNames.get(cardCode) || null,
    };
    for (const w of WINDOWS) {
      const threshold = monthsAgo(nowDate, w);
      const windowRows = cardRows.filter(r => r.fecha >= threshold);
      doc['stats_' + w + 'm'] = computeWindowStats(windowRows, nowDate, w);
    }
    result.set(cardCode, doc);
  }
  return result;
}
