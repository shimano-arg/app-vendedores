// @ts-check
/**
 * reparto-export-rows (v1497 §96, 2026-10-27) — pure fn para armar filas
 * del export de Reparto de ingresos.
 *
 * Antecedente: v1492 §91 agregó el botón "Exportar Excel" al modal Reparto
 * de ingresos. v1497 §96 fixea:
 *
 *   1. El handler era `window.exportRepartoToExcel` pero no estaba en los
 *      stubs del chunk `exports-core` → si el user abría el modal Reparto
 *      SIN pasar antes por "Exportar" del header, el chunk no se cargaba
 *      y el click al botón corto-circuitaba silencioso (`window.X && ...`).
 *   2. Campos faltantes (clientName vacío, cardCode null, localidad
 *      undefined) rompían la cadena por ser `undefined` en lugar de "-".
 *
 * Fuente única: esta pure fn. Reutilizable + testeable + idempotente.
 *
 * Shape de entrada (array de `ingresos_reparto` del listener Firestore):
 *   {_id, sku, qtyIngresada, status, detectedAt, clientesBO: [
 *     {clientName, cardCode, vendorKey, locality, qtyBO, ...}
 *   ]}
 *
 * Shape de salida: 2 hojas (Resumen + Detalle) con columnas específicas
 * del Reparto (Stock_fisico, Qty_ingresada, N_clientes_BO, Suma_BO_solicitada,
 * Qty_asignada, Vuelve_a_BO). Fila TOTAL al final.
 *
 * Regla defensiva: TODO campo string ausente/null/undefined/empty → `'-'`.
 * TODO campo numeric ausente → `0`. Nunca lanza. Nunca propaga undefined
 * a xlsx (ExcelJS maneja mal undefined — algunas cells se corrompen).
 */

const DASH = '-';

/**
 * Normaliza un valor string para la hoja: trim + fallback a "-".
 * @param {any} v
 * @returns {string}
 */
export function safeStr(v) {
  if (v == null) return DASH;
  const s = String(v).trim();
  return s === '' ? DASH : s;
}

/**
 * Normaliza un valor numeric: Number || 0.
 * @param {any} v
 * @returns {number}
 */
export function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Formatea Firestore Timestamp / Date / string / number a `YYYY-MM-DD HH:mm:ss`.
 * Devuelve "-" si no parseable.
 * @param {any} ts
 * @returns {string}
 */
export function safeTs(ts) {
  if (ts == null) return DASH;
  try {
    if (typeof ts === 'string') {
      const t = ts.trim();
      if (!t) return DASH;
      return t.length >= 19 ? t.slice(0, 19).replace('T', ' ') : t;
    }
    if (ts instanceof Date) {
      const n = ts.getTime();
      if (Number.isNaN(n)) return DASH;
      return ts.toISOString().slice(0, 19).replace('T', ' ');
    }
    if (typeof ts === 'object') {
      if (typeof ts.toDate === 'function') {
        try {
          const d = ts.toDate();
          if (d instanceof Date && !Number.isNaN(d.getTime())) {
            return d.toISOString().slice(0, 19).replace('T', ' ');
          }
        } catch (_e) {
          /* fall through */
        }
      }
      if (typeof ts.seconds === 'number') {
        const d = new Date(ts.seconds * 1000);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
      }
      if (typeof ts._seconds === 'number') {
        const d = new Date(ts._seconds * 1000);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
      }
    }
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
    }
  } catch (_e) {
    /* fall through */
  }
  return DASH;
}

/**
 * @typedef {Object} RepartoFiltros
 * @property {string} [search] - query del input de búsqueda (SKU o cliente).
 * @property {boolean} [hideNoStock] - true si el toggle "Ocultar SKU sin stock físico" está tildado.
 */

/**
 * Aplica el mismo filtro que el modal (search + hideNoStock) al array de
 * ingresos y devuelve el subset filtrado. Idempotente, puro.
 *
 * @param {Array<any>} ingresos
 * @param {RepartoFiltros} filtros
 * @param {(sku:string) => number} [getStockFisico] - si no se pasa, hideNoStock = no-op.
 * @returns {Array<any>}
 */
export function filterIngresosForExport(ingresos, filtros, getStockFisico) {
  if (!Array.isArray(ingresos)) return [];
  const f = filtros || {};
  const q = String(f.search || '')
    .toLowerCase()
    .trim();
  const hideNoStock = f.hideNoStock !== false; // default true (match modal UI)
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
  // Sort por qty asc (match modal).
  return out.slice().sort((a, b) => {
    const qa = Number(a.qtyIngresada) || 0;
    const qb = Number(b.qtyIngresada) || 0;
    if (qa !== qb) return qa - qb;
    return String(a.sku || '').localeCompare(String(b.sku || ''));
  });
}

/**
 * Formatea los filtros aplicados para una fila de encabezado del xlsx.
 * @param {RepartoFiltros} filtros
 * @returns {string}
 */
export function formatRepartoFiltrosHeader(filtros) {
  const f = filtros || {};
  const parts = [];
  if (f.search) parts.push(`búsqueda="${f.search}"`);
  parts.push(f.hideNoStock !== false ? 'solo con stock físico > 0' : 'incluye sin stock');
  return `Filtros: ${parts.join(', ')}`;
}

/**
 * Arma las filas del export de Reparto. Devuelve 2 hojas: Resumen (1 fila
 * por ingreso) + Detalle (1 fila por cliente). Fila TOTAL al final de cada.
 *
 * @param {Array<any>} ingresos
 * @param {RepartoFiltros} filtros
 * @param {{getStockFisico?: (sku:string) => number, getProductDesc?: (sku:string) => string}} [deps]
 * @returns {{resumenRows: Array<any>, detalleRows: Array<any>, totalIngresadas: number, totalBO: number, totalClientes: number, totalFilas: number, filtrosAplicados: RepartoFiltros}}
 */
export function computeRepartoExportRows(ingresos, filtros, deps) {
  const d = deps || {};
  const _stockFn = typeof d.getStockFisico === 'function' ? d.getStockFisico : null;
  const _descFn = typeof d.getProductDesc === 'function' ? d.getProductDesc : null;
  const f = filtros || {};
  const filtered = filterIngresosForExport(ingresos, f, _stockFn || undefined);

  /** @type {Array<any>} */
  const resumenRows = [];
  /** @type {Array<any>} */
  const detalleRows = [];
  let totalIngresadas = 0;
  let totalBO = 0;
  let totalClientes = 0;
  let totalAsignadas = 0;
  let totalVuelveBO = 0;

  for (const ing of filtered) {
    const sku = safeStr(ing && ing.sku);
    const producto = _descFn ? safeStr(_descFn(sku)) : DASH;
    const stockFis = _stockFn ? safeNum(_stockFn(sku)) : safeNum(ing && ing.qtyIngresada);
    const qtyIng = safeNum(ing && ing.qtyIngresada);
    const clientes = Array.isArray(ing && ing.clientesBO) ? ing.clientesBO : [];
    const sumaBO = clientes.reduce(
      (/** @type {number} */ s, /** @type {any} */ c) => s + safeNum(c && c.qtyBO),
      0
    );
    // Qty asignada: lo que ya fue aplicado del ingreso (si existe audit).
    const qtyAsignada = safeNum(ing && (ing.qtyAsignada || ing.qtyApplied || 0));
    // Vuelve a BO: lo que no alcanza del físico actual para cubrir sumaBO.
    const vuelveBO = Math.max(0, sumaBO - stockFis);
    const status = safeStr(ing && ing.status);
    const detectedAt = safeTs(ing && ing.detectedAt);

    resumenRows.push({
      SKU: sku,
      Producto: producto,
      Stock_fisico_dep11: stockFis,
      Qty_ingresada: qtyIng,
      N_clientes_BO: clientes.length,
      Suma_BO_solicitada: sumaBO,
      Qty_asignada: qtyAsignada,
      Vuelve_a_BO: vuelveBO,
      Status: status,
      Ingreso_detectado: detectedAt,
    });
    totalIngresadas += qtyIng;
    totalBO += sumaBO;
    totalClientes += clientes.length;
    totalAsignadas += qtyAsignada;
    totalVuelveBO += vuelveBO;

    for (const c of clientes) {
      detalleRows.push({
        SKU: sku,
        Producto: producto,
        Stock_fisico_dep11: stockFis,
        Cliente: safeStr(c && c.clientName),
        CardCode: safeStr(c && c.cardCode),
        Localidad: safeStr(c && (c.locality || c.locName)),
        Provincia: safeStr(c && (c.province || c.prov)),
        Vendedor: safeStr(c && (c.vendorKey || c.vendor)),
        Qty_BO_solicitada: safeNum(c && c.qtyBO),
        Status: status,
        Ingreso_detectado: detectedAt,
      });
    }
  }

  // Fila TOTAL al final de cada hoja.
  resumenRows.push({
    SKU: 'TOTAL',
    Producto: '',
    Stock_fisico_dep11: '',
    Qty_ingresada: totalIngresadas,
    N_clientes_BO: totalClientes,
    Suma_BO_solicitada: totalBO,
    Qty_asignada: totalAsignadas,
    Vuelve_a_BO: totalVuelveBO,
    Status: '',
    Ingreso_detectado: '',
  });
  detalleRows.push({
    SKU: 'TOTAL',
    Producto: '',
    Stock_fisico_dep11: '',
    Cliente: '',
    CardCode: '',
    Localidad: '',
    Provincia: '',
    Vendedor: '',
    Qty_BO_solicitada: totalBO,
    Status: '',
    Ingreso_detectado: '',
  });

  return {
    resumenRows,
    detalleRows,
    totalIngresadas,
    totalBO,
    totalClientes,
    totalFilas: detalleRows.length - 1, // sin la fila TOTAL
    filtrosAplicados: {
      search: String(f.search || ''),
      hideNoStock: f.hideNoStock !== false,
    },
  };
}
