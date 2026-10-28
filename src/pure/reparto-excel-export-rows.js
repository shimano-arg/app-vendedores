// @ts-check
/**
 * reparto-excel-export-rows (v1505, 2026-10-28) — pure fn para armar filas
 * del Excel de EXPORT MANUAL del Reparto que Pablo trabaja offline.
 *
 * Diferente a `reparto-export-rows.js` (v1497 §96): aquel es un reporte
 * resumen de ingresos pending (2 hojas Resumen+Detalle). Este nuevo export
 * (v1505) es un **template editable** con 1 fila por cliente+SKU y 2
 * columnas protegidas al final (`Reparto ID` + `CardCode`) que sirven como
 * clave para el reimport.
 *
 * Columnas (en orden exacto, nombres literales):
 *   1. Codigo
 *   2. Cliente
 *   3. Backorder
 *   4. Stock disponible
 *   5. Asignado
 *   6. Vuelve a backorder   (fórmula =C{row}-E{row}-G{row})
 *   7. Eliminar
 *   8. Reparto ID            (técnica, celda gris + protegida)
 *   9. CardCode              (técnica, celda gris + protegida)
 *
 * Reglas:
 *   - 1 fila por cliente+SKU (match con `consolidateClientesBO` v1498 §97).
 *   - Mismo valor que la UI (BO consolidado, stock físico actual).
 *   - Respetar filtros del modal (search + hideNoStock).
 *   - `Asignado` + `Eliminar` arrancan en 0 (editables).
 *   - Resto locked para que Pablo no rompa el shape por accidente.
 *
 * Fuente única: cualquier re-render del Excel pasa por esta función.
 */

const DASH = '-';

/**
 * Normaliza string con fallback a "-".
 * @param {any} v
 * @returns {string}
 */
export function safeStr(v) {
  if (v == null) return DASH;
  const s = String(v).trim();
  return s === '' ? DASH : s;
}

/**
 * Normaliza numero con fallback a 0.
 * @param {any} v
 * @returns {number}
 */
export function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @typedef {Object} RepartoExcelFiltros
 * @property {string} [search]
 * @property {boolean} [hideNoStock]
 */

/**
 * Aplica el mismo filtro que el modal UI (search por SKU/cliente +
 * hideNoStock) sobre un array de ingresos. Idempotente.
 *
 * @param {Array<any>} ingresos
 * @param {RepartoExcelFiltros} filtros
 * @param {(sku:string) => number} [getStockFisico]
 * @returns {Array<any>}
 */
export function filterIngresosForExcelExport(ingresos, filtros, getStockFisico) {
  if (!Array.isArray(ingresos)) return [];
  const f = filtros || {};
  const q = String(f.search || '')
    .toLowerCase()
    .trim();
  const hideNoStock = f.hideNoStock !== false; // default true (match UI)
  let out = ingresos.filter(
    (i) => i != null && Array.isArray(i.clientesBO) && i.clientesBO.length > 0
  );
  if (hideNoStock && typeof getStockFisico === 'function') {
    out = out.filter((i) => {
      try {
        return (Number(getStockFisico(i.sku)) || 0) > 0;
      } catch (_e) {
        return false;
      }
    });
  }
  if (q) {
    out = out.filter((i) => {
      const skuHit = String(i.sku || '')
        .toLowerCase()
        .includes(q);
      if (skuHit) return true;
      const snap = Array.isArray(i.clientesBO) ? i.clientesBO : [];
      return snap.some((/** @type {any} */ c) =>
        String((c && c.clientName) || '')
          .toLowerCase()
          .includes(q)
      );
    });
  }
  return out.slice().sort((a, b) => {
    const qa = Number(a.qtyIngresada) || 0;
    const qb = Number(b.qtyIngresada) || 0;
    if (qa !== qb) return qa - qb;
    return String(a.sku || '').localeCompare(String(b.sku || ''));
  });
}

/**
 * @typedef {Object} RepartoExcelRow
 * @property {string} Codigo
 * @property {string} Cliente
 * @property {number} Backorder
 * @property {number} StockDisponible
 * @property {number} Asignado
 * @property {string} VueleABackorder - fórmula Excel ej. "=C2-E2-G2"
 * @property {number} Eliminar
 * @property {string} RepartoId
 * @property {string} CardCode
 */

/**
 * Arma las filas del Excel. Devuelve `rows[]` ordenado por (SKU, Cliente)
 * + metadata para el header del archivo.
 *
 * Idempotente, puro, sin ExcelJS dependency.
 *
 * @param {Array<any>} ingresos - array de `ingresos_reparto` con `clientesBO[]`.
 * @param {RepartoExcelFiltros} filtros
 * @param {{getStockFisico?: (sku:string) => number, consolidateFn?: (entries:Array<any>) => Array<any>}} [deps]
 * @returns {{
 *   rows: Array<RepartoExcelRow>,
 *   totalFilas: number,
 *   totalBackorder: number,
 *   totalStock: number,
 *   filtrosAplicados: RepartoExcelFiltros,
 * }}
 */
export function computeRepartoExcelExportRows(ingresos, filtros, deps) {
  const d = deps || {};
  const stockFn = typeof d.getStockFisico === 'function' ? d.getStockFisico : null;
  const consolidateFn = typeof d.consolidateFn === 'function' ? d.consolidateFn : null;
  const f = filtros || {};
  const filtered = filterIngresosForExcelExport(ingresos, f, stockFn || undefined);

  /** @type {Array<RepartoExcelRow>} */
  const rows = [];
  let totalBackorder = 0;
  let totalStock = 0;

  // v1512 (2026-10-28): agrupar por Reparto ID dentro de cada SKU + insertar
  // fila aviso en amarillo cuando un SKU aparece en >1 reparto abierto.
  // Pablo reportó: CLC66HAR aparece 3 veces por cliente con 3 Reparto ID distintos.
  // Sin aviso visual, Pablo podría asignar la misma unidad en los 3 repartos.
  //
  // La fila aviso tiene Codigo='' (marcador) + Cliente con el texto.
  // El import validator debe skipearlas por `Codigo === ''`.
  //
  // Esto se elimina cuando entre PR2 Paso 3 (fuente única backorder) — por
  // construcción solo habrá 1 reparto por SKU vigente.
  const _repartoCountBySku = new Map();
  for (const ing of filtered) {
    const _sku = safeStr(ing && ing.sku);
    if (!_sku) continue;
    const _rid = safeStr(ing && (ing._id || ing.id));
    if (!_rid) continue;
    if (!_repartoCountBySku.has(_sku)) _repartoCountBySku.set(_sku, new Set());
    _repartoCountBySku.get(_sku).add(_rid);
  }
  // Ordenar ingresos por SKU ascendente + por repartoId ascendente para que las
  // filas del mismo SKU queden juntas y los repartos dentro del SKU en orden estable.
  const _sortedFiltered = filtered.slice().sort((a, b) => {
    const skuA = safeStr(a && a.sku);
    const skuB = safeStr(b && b.sku);
    const cmpSku = skuA.localeCompare(skuB);
    if (cmpSku !== 0) return cmpSku;
    const ridA = safeStr(a && (a._id || a.id));
    const ridB = safeStr(b && (b._id || b.id));
    return ridA.localeCompare(ridB);
  });

  let _lastSku = null;
  for (const ing of _sortedFiltered) {
    const sku = safeStr(ing && ing.sku);
    const repartoId = safeStr(ing && (ing._id || ing.id));
    // Insertar fila aviso ANTES del primer reparto de un SKU multi-reparto.
    if (sku && sku !== _lastSku) {
      const _skuRepartos = _repartoCountBySku.get(sku);
      const _count = _skuRepartos ? _skuRepartos.size : 1;
      if (_count > 1) {
        rows.push({
          Codigo: '',  // Marcador fila aviso — import ignora.
          Cliente: 'Este SKU (' + sku + ') tiene ' + _count + ' repartos abiertos: asigna en uno solo',
          Backorder: null,
          StockDisponible: null,
          Asignado: null,
          VueleABackorder: '',
          Eliminar: null,
          RepartoId: '',
          CardCode: '',
          _notice: true,  // Flag para que el renderer aplique estilo amarillo.
        });
      }
      _lastSku = sku;
    }
    const stockFis = stockFn ? safeNum(stockFn(ing.sku)) : safeNum(ing && ing.qtyIngresada);
    totalStock += stockFis;
    const rawClis = Array.isArray(ing && ing.clientesBO) ? ing.clientesBO : [];
    // v1498 §97: consolidar cliente+SKU usando pure fn si está disponible.
    const clientes = consolidateFn ? consolidateFn(rawClis) : rawClis;
    // Sort by cliente name para consistencia.
    const sorted = clientes
      .slice()
      .sort((/** @type {any} */ a, /** @type {any} */ b) =>
        String(a.clientName || '').localeCompare(String(b.clientName || ''))
      );
    for (const c of sorted) {
      const cardCode = safeStr(c && (c.clientCardCode || c.cardCode));
      const clientName = safeStr(c && c.clientName);
      const backorder = safeNum(c && c.qtyBackorder);
      if (backorder <= 0) continue;
      // Fórmula Excel para "Vuelve a backorder" = Backorder - Asignado - Eliminar.
      // El row + 2 (header fila 1 + 1-indexed → first data row es 2).
      const excelRowIdx = rows.length + 2;
      rows.push({
        Codigo: sku,
        Cliente: clientName,
        Backorder: backorder,
        StockDisponible: stockFis,
        Asignado: 0,
        VueleABackorder: '=C' + excelRowIdx + '-E' + excelRowIdx + '-G' + excelRowIdx,
        Eliminar: 0,
        RepartoId: repartoId,
        CardCode: cardCode,
      });
      totalBackorder += backorder;
    }
  }

  return {
    rows,
    totalFilas: rows.length,
    totalBackorder,
    totalStock,
    filtrosAplicados: {
      search: String(f.search || ''),
      hideNoStock: f.hideNoStock !== false,
    },
  };
}

/**
 * Devuelve el nombre de archivo canónico: `Reparto_AAAA-MM-DD_HHMM.xlsx`.
 * @param {Date} [date]
 * @returns {string}
 */
export function buildRepartoExcelFileName(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return (
    'Reparto_' +
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    '.xlsx'
  );
}
