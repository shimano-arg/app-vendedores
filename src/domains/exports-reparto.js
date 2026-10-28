// @ts-nocheck
/**
 * exports-reparto (v1514, 2026-10-28) — chunk lazy para el flow de export +
 * import Excel del Reparto de ingresos.
 *
 * v1514 §T3: UI rework modal + preview Fase B. 4 estados mutuamente
 * exclusivos (idle/validating/preview-ok/errors) + dropzone drag+drop +
 * resumen de 3 cards (Asignadas/VueleBO/Eliminadas) + tabla 5 columnas
 * (SKU/Cliente/Asignado/VueleBO/Eliminado) + consistency rule
 * (Asignado + VueleABackorder + Eliminar == backorderActual).
 *
 * v1505 (base): export + import Excel del Reparto de ingresos.
 *
 * Dos handlers principales expuestos a window:
 *   - window.exportRepartoManualExcel()  — template editable con 9 columnas
 *     (7 visibles + 2 técnicas al final, grises y protegidas).
 *   - window.openRepartoImportDialog()   — modal con <input type=file>,
 *     preview de validación, y botón "Aplicar reparto importado".
 *
 * Fuente única: pure fns
 *   - src/pure/reparto-excel-export-rows.js — armado de filas.
 *   - src/pure/reparto-excel-import-validator.js — validación por fila.
 *
 * Payload server: SIEMPRE via `applyRepartoManualCF` (callable). NUNCA
 * escritura directa a Firestore (CLAUDE.md §63 pattern).
 *
 * Log: `reparto_log` con `origen='import'` + fileName + importedByUid + ...
 */

/**
 * Lazy loader para ExcelJS.
 * @returns {Promise<void>}
 */
async function _ensureExcelJS() {
  const w = /** @type {any} */ (window);
  if (typeof w.loadExcelJS === 'function') await w.loadExcelJS();
  if (!w.ExcelJS) throw new Error('ExcelJS no disponible');
}

/**
 * @param {string} msg
 * @param {number} [ms]
 */
function _syncTag(msg, ms) {
  const w = /** @type {any} */ (window);
  if (typeof w.showSyncTag === 'function') {
    try {
      w.showSyncTag(msg, ms);
    } catch (_e) {
      /* ignore */
    }
  }
}

/**
 * @param {string} sku
 * @returns {number}
 */
function _getStockFisico(sku) {
  const w = /** @type {any} */ (window);
  if (typeof w.getStockDisponibleVenta !== 'function') return 0;
  try {
    return Number(w.getStockDisponibleVenta(sku)) || 0;
  } catch (_e) {
    return 0;
  }
}

/**
 * @returns {{search: string, hideNoStock: boolean}}
 */
function _readFiltrosModalReparto() {
  const sEl = typeof document !== 'undefined' ? document.getElementById('reparto-search') : null;
  const hEl =
    typeof document !== 'undefined' ? document.getElementById('reparto-hide-nostock') : null;
  return {
    search: sEl ? String(/** @type {any} */ (sEl).value || '').trim() : '',
    hideNoStock: hEl ? !!(/** @type {any} */ (hEl).checked) : true,
  };
}

/**
 * @param {string} exportKind
 * @param {string} msg
 */
function _logExportError(exportKind, msg) {
  try {
    const w = /** @type {any} */ (window);
    if (!w.fbDb || typeof w.fbDb.collection !== 'function') return;
    w.fbDb
      .collection('operations_log')
      .add({
        type: 'export_failed',
        exportKind,
        error: msg.slice(0, 500),
        userUid: (w.currentUser && w.currentUser.uid) || null,
        userEmail: (w.currentUser && w.currentUser.email) || null,
        timestamp: new Date(),
      })
      .catch(() => {
        /* ignore */
      });
  } catch (_e) {
    /* ignore */
  }
}

// ============================================================
// PARTE 1 — Export manual (template editable)
// ============================================================

window.exportRepartoManualExcel = async function () {
  const w = /** @type {any} */ (window);
  const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
  if (!ingresos.length) {
    alert('No hay ingresos de reparto para exportar. Abrí el modal "Reparto de ingresos" primero.');
    return;
  }
  _syncTag('Generando Excel editable…');
  try {
    const pureMod = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoExcelExport;
    if (!pureMod || typeof pureMod.computeRepartoExcelExportRows !== 'function') {
      throw new Error('pure fn repartoExcelExport no disponible');
    }
    const consolidateFn =
      w.__phase0 &&
      w.__phase0.pure &&
      w.__phase0.pure.repartoConsolidate &&
      w.__phase0.pure.repartoConsolidate.consolidateClientesBO;
    const filtros = _readFiltrosModalReparto();
    const result = pureMod.computeRepartoExcelExportRows(ingresos, filtros, {
      getStockFisico: _getStockFisico,
      consolidateFn: typeof consolidateFn === 'function' ? consolidateFn : undefined,
    });
    if (!result.rows.length) {
      alert(
        'No hay filas para exportar con los filtros actuales. Limpiá búsqueda o destildá "Ocultar sin stock".'
      );
      return;
    }

    await _ensureExcelJS();
    const ExcelJS = w.ExcelJS;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reparto');

    ws.columns = [
      { header: 'Codigo', key: 'Codigo', width: 18 },
      { header: 'Cliente', key: 'Cliente', width: 36 },
      { header: 'Backorder', key: 'Backorder', width: 12 },
      { header: 'Stock disponible', key: 'StockDisponible', width: 15 },
      { header: 'Asignado', key: 'Asignado', width: 12 },
      { header: 'Vuelve a backorder', key: 'VueleABackorder', width: 18 },
      { header: 'Eliminar', key: 'Eliminar', width: 12 },
      { header: 'Reparto ID', key: 'RepartoId', width: 24 },
      { header: 'CardCode', key: 'CardCode', width: 16 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      };
    });
    headerRow.height = 28;
    headerRow.getCell(8).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF888888' },
    };
    headerRow.getCell(9).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF888888' },
    };

    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows[i];
      // v1512 (2026-10-28): fila aviso SKU multi-reparto (Codigo === '', _notice=true).
      // Se renderiza con fondo amarillo + solo las celdas Codigo+Cliente ocupadas;
      // import validator la ignora por `Codigo === ''`.
      if (r && (r._notice === true || r.Codigo === '')) {
        const row = ws.addRow({
          Codigo: '',
          Cliente: r.Cliente || '',
          Backorder: null,
          StockDisponible: null,
          Asignado: null,
          VueleABackorder: null,
          Eliminar: null,
          RepartoId: '',
          CardCode: '',
        });
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB99' } };
          cell.font = { color: { argb: 'FF78350F' }, bold: true, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          // Fila aviso bloqueada (user no puede editar el aviso).
          cell.protection = { locked: true };
        });
        continue;
      }
      const row = ws.addRow({
        Codigo: r.Codigo,
        Cliente: r.Cliente,
        Backorder: r.Backorder,
        StockDisponible: r.StockDisponible,
        Asignado: r.Asignado,
        VueleABackorder: null,
        Eliminar: r.Eliminar,
        RepartoId: r.RepartoId,
        CardCode: r.CardCode,
      });
      row.getCell(6).value = {
        formula: r.VueleABackorder.replace(/^=/, ''),
        result: r.Backorder - r.Asignado - r.Eliminar,
      };
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFEEEEEE' } },
          left: { style: 'thin', color: { argb: 'FFEEEEEE' } },
          right: { style: 'thin', color: { argb: 'FFEEEEEE' } },
          bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } },
        };
      });
      row.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      row.getCell(8).font = { color: { argb: 'FF888888' }, size: 10 };
      row.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      row.getCell(9).font = { color: { argb: 'FF888888' }, size: 10 };
      row.getCell(1).protection = { locked: true };
      row.getCell(2).protection = { locked: true };
      row.getCell(3).protection = { locked: true };
      row.getCell(4).protection = { locked: true };
      row.getCell(5).protection = { locked: false };
      row.getCell(6).protection = { locked: true };
      row.getCell(7).protection = { locked: false };
      row.getCell(8).protection = { locked: true };
      row.getCell(9).protection = { locked: true };
    }

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // v1512 (2026-10-28): habilitar autofiltro + sort en la hoja protegida.
    // Pablo reportó que "Ordenar y filtrar" en Excel desktop aparecía deshabilitado:
    // faltaba `ws.autoFilter` que marca el rango como autofilter + `sort: true` en
    // la protección permite ordenar las celdas desbloqueadas (Asignado + Eliminar).
    // Las celdas bloqueadas (Codigo, Cliente, Backorder, Stock, VueleABO, RepartoId,
    // CardCode) siguen bloqueadas; sort y filter trabajan sobre el conjunto completo.
    const _lastRow = (result.rows ? result.rows.length : 0) + 1; // +1 por header
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: _lastRow, column: 9 } };

    await ws.protect('', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      sort: true, // v1512: permite ordenar
      autoFilter: true, // permite filtrar (ya estaba)
    });

    const filename = pureMod.buildRepartoExcelFileName
      ? pureMod.buildRepartoExcelFileName(new Date())
      : 'Reparto_' +
        new Date().toISOString().slice(0, 10) +
        '_' +
        new Date().toTimeString().slice(0, 5).replace(':', '') +
        '.xlsx';

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    _syncTag(
      'Excel editable listo (' + result.rows.length + ' filas · ' + result.totalBackorder + 'u BO)',
      3200
    );
  } catch (e) {
    const msg = (e && /** @type {any} */ (e).message) || String(e);
    console.error('[v1505 §Reparto] exportRepartoManualExcel falló:', e);
    alert('No pudimos generar el Excel editable. Volvé a intentar; si sigue, avisale a Mariano.');
    _logExportError('export_manual', msg);
  }
};

// ============================================================
// PARTE 2 — Import Excel
// ============================================================

let _importState = /** @type {null | {
  fileName: string,
  reconocidas: Array<any>,
  conCambios: Array<any>,
  errores: Array<any>,
  totalFilas: number,
  totalAsignado: number,
  totalEliminar: number,
}} */ (null);

/**
 * @returns {boolean}
 */
function _isAdminLikeForImport() {
  const w = /** @type {any} */ (window);
  const role = (w.userRole || '').toLowerCase();
  if (role === 'admin' || role === 'gerente') return true;
  const email = String((w.currentUser && w.currentUser.email) || '').toLowerCase();
  if (email === 'pablo.gonzalez@shimano.com.ar' || email === 'erbinomariano@gmail.com') return true;
  return false;
}

/**
 * v1514 §T3: alterna el estado visible del modal.
 * @param {('idle'|'validating'|'preview-ok'|'errors')} state
 */
function _setImportModalState(state) {
  const modal = document.getElementById('reparto-import-modal');
  if (!modal) return;
  /** @type {any} */ (modal).setAttribute('data-state', state);
  const ids = {
    idle: 'reparto-import-dropzone',
    validating: 'reparto-import-validating',
    'preview-ok': 'reparto-import-preview-ok',
    errors: 'reparto-import-errors',
  };
  for (const [st, id] of Object.entries(ids)) {
    const el = modal.querySelector('#' + id);
    if (!el) continue;
    /** @type {any} */ (el).style.display = st === state ? 'flex' : 'none';
  }
  // Apply btn visible solo en preview-ok.
  const applyBtn = modal.querySelector('#reparto-import-apply-btn');
  if (applyBtn) {
    /** @type {any} */ (applyBtn).style.display = state === 'preview-ok' ? 'inline-block' : 'none';
  }
}

window.openRepartoImportDialog = async function () {
  if (!_isAdminLikeForImport()) {
    alert('Solo admin o gerente puede importar reparto.');
    return;
  }
  const w = /** @type {any} */ (window);
  const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
  if (!ingresos.length) {
    alert('No hay ingresos de reparto activos. Abrí el modal Reparto primero.');
    return;
  }
  let modal = document.getElementById('reparto-import-modal');
  if (!modal) {
    modal = _buildImportModalDom();
    document.body.appendChild(modal);
  }
  _importState = null;
  // Reset previews.
  const okEl = modal.querySelector('#reparto-import-preview-ok');
  if (okEl) {
    while (okEl.firstChild) okEl.removeChild(okEl.firstChild);
  }
  const errEl = modal.querySelector('#reparto-import-errors');
  if (errEl) {
    while (errEl.firstChild) errEl.removeChild(errEl.firstChild);
  }
  const applyBtn = modal.querySelector('#reparto-import-apply-btn');
  if (applyBtn) {
    /** @type {any} */ (applyBtn).disabled = true;
    /** @type {any} */ (applyBtn).style.opacity = '0.4';
  }
  const fileInput = modal.querySelector('#reparto-import-file');
  if (fileInput) /** @type {any} */ (fileInput).value = '';
  _setImportModalState('idle');
  /** @type {any} */ (modal).style.display = 'flex';
};

window.closeRepartoImportDialog = function () {
  const modal = document.getElementById('reparto-import-modal');
  if (modal) /** @type {any} */ (modal).style.display = 'none';
  _importState = null;
};

/**
 * @param {Event} ev
 */
window.handleRepartoImportFileChange = async function (ev) {
  const w = /** @type {any} */ (window);
  const tgt = /** @type {HTMLInputElement} */ (ev.target);
  const file = tgt && tgt.files && tgt.files[0];
  if (!file) return;
  const applyBtn = document.getElementById('reparto-import-apply-btn');
  if (applyBtn) {
    /** @type {any} */ (applyBtn).disabled = true;
    /** @type {any} */ (applyBtn).style.opacity = '0.4';
  }
  // v1514 §T3: estado validating con spinner.
  _setImportModalState('validating');
  try {
    await _ensureExcelJS();
    const buf = await file.arrayBuffer();
    const wb = new w.ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Excel sin hojas');

    const headerMap = _buildHeaderMap(ws);
    /** @type {Array<any>} */
    const rows = [];
    ws.eachRow((row, rn) => {
      if (rn === 1) return;
      /** @type {any} */
      const obj = { __rowIndex: rn };
      row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        const canonKey = headerMap[colIdx];
        if (!canonKey) return;
        let v = cell.value;
        if (v && typeof v === 'object' && 'text' in v) v = v.text;
        if (v && typeof v === 'object' && 'result' in v) v = v.result;
        obj[canonKey] = v;
      });
      if (!obj.RepartoId && !obj.CardCode && !obj.Codigo) return;
      rows.push(obj);
    });

    const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
    const repartosActivos = ingresos.map((/** @type {any} */ i) => ({
      _id: i._id,
      sku: i.sku,
      status: i.status || 'pending',
      stockDisponible: _getStockFisico(i.sku),
      clientesBO: Array.isArray(i.clientesBO) ? i.clientesBO : [],
    }));

    const validator = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoExcelImport;
    if (!validator || typeof validator.validateRepartoExcelImport !== 'function') {
      throw new Error('pure fn repartoExcelImport no disponible');
    }
    const result = validator.validateRepartoExcelImport(rows, repartosActivos);
    _importState = {
      fileName: file.name,
      reconocidas: result.reconocidas,
      conCambios: result.conCambios,
      errores: result.errores,
      totalFilas: result.totalFilas,
      totalAsignado: result.totalAsignado,
      totalEliminar: result.totalEliminar,
    };
    _renderImportPreview();
  } catch (e) {
    const msg = (e && /** @type {any} */ (e).message) || String(e);
    console.error('[v1505 §Reparto] handleRepartoImportFileChange error:', e);
    // v1514 §T3: mostrar error de lectura en el estado "errors".
    const errBoxEl = document.getElementById('reparto-import-errors');
    if (errBoxEl) {
      while (errBoxEl.firstChild) errBoxEl.removeChild(errBoxEl.firstChild);
      const errDiv = document.createElement('div');
      errDiv.style.cssText =
        'color:var(--text-primary,#c7372f);padding:14px;background:var(--color-danger-bg,rgba(255,59,48,.08));border-left:3px solid var(--color-danger,#c7372f);border-radius:8px;width:100%';
      const t = document.createElement('div');
      t.style.cssText = 'font-weight:700;margin-bottom:6px';
      t.textContent = 'No se pudo leer el Excel';
      const d = document.createElement('div');
      d.style.cssText = 'font-size:12.5px;line-height:1.5';
      d.textContent = msg;
      errDiv.appendChild(t);
      errDiv.appendChild(d);
      errBoxEl.appendChild(errDiv);
    }
    _setImportModalState('errors');
    _logExportError('import_read', msg);
  }
};

/**
 * @param {any} ws
 * @returns {Object<number,string>}
 */
function _buildHeaderMap(ws) {
  /** @type {Object<number,string>} */
  const out = {};
  const headerRow = ws.getRow(1);
  headerRow.eachCell(
    { includeEmpty: false },
    (/** @type {any} */ cell, /** @type {number} */ col) => {
      let v = cell.value;
      if (v && typeof v === 'object' && 'text' in v) v = v.text;
      if (v && typeof v === 'object' && 'result' in v) v = v.result;
      const label = String(v || '')
        .trim()
        .toLowerCase();
      if (!label) return;
      if (label === 'codigo' || label === 'código') out[col] = 'Codigo';
      else if (label === 'cliente') out[col] = 'Cliente';
      else if (label === 'backorder') out[col] = 'Backorder';
      else if (label === 'stock disponible' || label === 'stock_disponible')
        out[col] = 'StockDisponible';
      else if (label === 'asignado') out[col] = 'Asignado';
      else if (label === 'vuelve a backorder') out[col] = 'VueleABackorder';
      else if (label === 'eliminar') out[col] = 'Eliminar';
      else if (label === 'reparto id' || label === 'repartoid' || label === 'reparto_id')
        out[col] = 'RepartoId';
      else if (label === 'cardcode' || label === 'card code' || label === 'card_code')
        out[col] = 'CardCode';
    }
  );
  return out;
}

/**
 * Crea un div con class/style/text seguros.
 * @param {string} styleCss
 * @param {string | null} textValue
 * @returns {HTMLDivElement}
 */
function _mkDiv(styleCss, textValue) {
  const d = document.createElement('div');
  d.style.cssText = styleCss;
  if (textValue != null) d.textContent = textValue;
  return d;
}

/**
 * v1514 §T3: aplica la consistency rule por fila.
 * `Asignado + VueleABackorder + Eliminar == backorderActual` (backorder que
 * viene del Excel, equivale a `backorderActual` del match).
 * @param {Array<any>} reconocidas
 * @returns {Array<{rowIndex:number, sku:string, cliente:string, msg:string}>}
 */
function _computeConsistencyErrors(reconocidas) {
  /** @type {Array<any>} */
  const out = [];
  for (const r of reconocidas || []) {
    if (!r) continue;
    const asig = Number(r.asignadoNuevo) || 0;
    const elim = Number(r.eliminarNuevo) || 0;
    const bo = Number(r.backorderActual) || 0;
    const vuelve = bo - asig - elim;
    if (vuelve < 0) {
      out.push({
        rowIndex: r.rowIndex || 0,
        sku: r.sku || '',
        cliente: r.clientName || '',
        msg:
          'Fila ' +
          (r.rowIndex || 0) +
          ' · ' +
          (r.sku || '?') +
          ' / ' +
          (r.clientName || '?') +
          ': Asignado(' +
          asig +
          ') + Eliminar(' +
          elim +
          ') supera Backorder(' +
          bo +
          '). Revisá las unidades.',
      });
    }
  }
  return out;
}

/**
 * v1514 §T3: render con 3 cards grandes + tabla 5 cols + estado único.
 * Reusa `_importState`. Agrega consistency rule a los errores del validator.
 */
function _renderImportPreview() {
  const applyBtn = document.getElementById('reparto-import-apply-btn');
  if (!_importState) return;
  const s = _importState;

  // Totales del resumen de 3 cards:
  //   Asignadas  = sum asignadoNuevo (ya en s.totalAsignado).
  //   Eliminadas = sum eliminarNuevo (ya en s.totalEliminar).
  //   VueleBO    = sum max(0, backorderActual - asignado - eliminar) sobre reconocidas con cambios.
  let totalVueleBO = 0;
  for (const r of s.conCambios || []) {
    const bo = Number(r.backorderActual) || 0;
    const asig = Number(r.asignadoNuevo) || 0;
    const elim = Number(r.eliminarNuevo) || 0;
    const diff = bo - asig - elim;
    if (diff > 0) totalVueleBO += diff;
  }

  // Consistency rule (post-validator). Si una fila tiene diff<0, se suma como error.
  const consistencyErrors = _computeConsistencyErrors(s.reconocidas);
  const allErrors = (s.errores || []).concat(
    consistencyErrors.map((c) => ({
      rowIndex: c.rowIndex,
      type: 'consistency_rule',
      msg: c.msg,
      sku: c.sku,
      cliente: c.cliente,
    }))
  );

  // Si hay errores → estado 'errors'. Si no → estado 'preview-ok'.
  if (allErrors.length) {
    _renderErrorsState(allErrors);
    _setImportModalState('errors');
    if (applyBtn) {
      /** @type {any} */ (applyBtn).disabled = true;
      /** @type {any} */ (applyBtn).style.opacity = '0.4';
    }
    return;
  }

  _renderPreviewOkState({
    totalAsignadas: s.totalAsignado || 0,
    totalVueleBO,
    totalEliminadas: s.totalEliminar || 0,
    reconocidas: s.reconocidas || [],
  });
  _setImportModalState('preview-ok');

  if (applyBtn) {
    const canApply = s.conCambios.length > 0;
    /** @type {any} */ (applyBtn).disabled = !canApply;
    /** @type {any} */ (applyBtn).style.opacity = canApply ? '1' : '0.4';
  }
}

/**
 * Render estado "preview-ok": 3 cards grandes + tabla 5 columnas.
 * @param {{totalAsignadas:number,totalVueleBO:number,totalEliminadas:number,reconocidas:Array<any>}} data
 */
function _renderPreviewOkState(data) {
  const okEl = document.getElementById('reparto-import-preview-ok');
  if (!okEl) return;
  while (okEl.firstChild) okEl.removeChild(okEl.firstChild);

  // Cards de resumen (3 grandes centradas).
  const cards = document.createElement('div');
  cards.style.cssText =
    'display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:18px;width:100%';

  /** @param {string} label @param {number} n @param {string} bg @param {string} fg */
  const mkCard = (label, n, bg, fg) => {
    const c = document.createElement('div');
    c.style.cssText =
      'flex:1 1 160px;min-width:160px;max-width:220px;padding:18px 14px;' +
      'background:' +
      bg +
      ';border-radius:12px;color:' +
      fg +
      ';text-align:center';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:12px;letter-spacing:.5px;text-transform:uppercase;opacity:.85';
    lbl.textContent = label;
    const num = document.createElement('div');
    num.style.cssText = 'font-size:38px;font-weight:800;margin-top:6px;line-height:1';
    num.textContent = String(n);
    c.appendChild(lbl);
    c.appendChild(num);
    return c;
  };

  cards.appendChild(
    mkCard(
      'Asignadas',
      data.totalAsignadas,
      'var(--color-success-bg,rgba(52,199,89,.14))',
      'var(--color-success,#248a3d)'
    )
  );
  cards.appendChild(
    mkCard(
      'Vuelve a BO',
      data.totalVueleBO,
      'var(--color-warning-bg,rgba(255,204,0,.14))',
      'var(--color-warning,#8a6d00)'
    )
  );
  cards.appendChild(
    mkCard(
      'Eliminadas',
      data.totalEliminadas,
      'var(--color-danger-bg,rgba(255,59,48,.14))',
      'var(--color-danger,#c7372f)'
    )
  );
  okEl.appendChild(cards);

  // Tabla 5 columnas: SKU · Cliente · Asignado · VueleBO · Eliminado.
  const tableWrap = document.createElement('div');
  tableWrap.style.cssText =
    'width:100%;max-height:360px;overflow-y:auto;overscroll-behavior:contain';
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.style.cssText = 'background:var(--bg-secondary,#f5f5f7);position:sticky;top:0;z-index:1';
  for (const h of ['SKU', 'Cliente', 'Asignado', 'Vuelve a BO', 'Eliminado']) {
    const th = document.createElement('th');
    th.style.cssText =
      'padding:8px;text-align:' +
      (h === 'SKU' || h === 'Cliente' ? 'left' : 'right') +
      ';color:var(--text-primary,#1d1d1f);font-weight:600';
    th.textContent = h;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  // Mostrar TODAS las reconocidas (con y sin cambios) para que el preview sea
  // fiel al Excel. VueleBO per-fila = max(0, bo - asig - elim).
  const rowsToShow = (data.reconocidas || []).slice(0, 200);
  for (const r of rowsToShow) {
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom:1px solid var(--border-color,#eee)';
    const bo = Number(r.backorderActual) || 0;
    const asig = Number(r.asignadoNuevo) || 0;
    const elim = Number(r.eliminarNuevo) || 0;
    const vuelve = Math.max(0, bo - asig - elim);
    const addTd = (/** @type {string} */ txt, /** @type {string} */ css) => {
      const td = document.createElement('td');
      td.style.cssText = css;
      td.textContent = txt;
      tr.appendChild(td);
    };
    addTd(r.sku || '', 'padding:6px 8px;font-family:monospace;color:var(--text-primary)');
    addTd(r.clientName || '', 'padding:6px 8px;color:var(--text-primary)');
    addTd(
      asig ? String(asig) : '-',
      'padding:6px 8px;text-align:right;' +
        (asig
          ? 'color:var(--color-success,#248a3d);font-weight:700'
          : 'color:var(--text-secondary,#86868b)')
    );
    addTd(
      vuelve ? String(vuelve) : '-',
      'padding:6px 8px;text-align:right;' +
        (vuelve
          ? 'color:var(--color-warning,#8a6d00);font-weight:700'
          : 'color:var(--text-secondary,#86868b)')
    );
    addTd(
      elim ? String(elim) : '-',
      'padding:6px 8px;text-align:right;' +
        (elim
          ? 'color:var(--color-danger,#c7372f);font-weight:700'
          : 'color:var(--text-secondary,#86868b)')
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  okEl.appendChild(tableWrap);

  if ((data.reconocidas || []).length > 200) {
    okEl.appendChild(
      _mkDiv(
        'color:var(--text-secondary,#86868b);font-size:11px;margin-top:6px;text-align:center',
        '...y ' + ((data.reconocidas || []).length - 200) + ' filas más'
      )
    );
  }
}

/**
 * Render estado "errors": lista roja de filas con error.
 * @param {Array<any>} errors
 */
function _renderErrorsState(errors) {
  const errEl = document.getElementById('reparto-import-errors');
  if (!errEl) return;
  while (errEl.firstChild) errEl.removeChild(errEl.firstChild);
  const container = document.createElement('div');
  container.style.cssText = 'width:100%;max-height:420px;overflow-y:auto';
  const header = _mkDiv(
    'padding:12px 14px;background:var(--color-danger-bg,rgba(255,59,48,.08));border-left:3px solid var(--color-danger,#c7372f);border-radius:6px;margin-bottom:12px;color:var(--color-danger,#c7372f);font-weight:700',
    'Hay ' + errors.length + ' error(es). Corregí el Excel y volvé a subirlo. No se aplica nada.'
  );
  container.appendChild(header);
  const list = document.createElement('ul');
  list.style.cssText =
    'margin:0;padding-left:20px;color:var(--text-primary,#1d1d1f);font-size:13px;line-height:1.6';
  const slice = errors.slice(0, 100);
  for (const e of slice) {
    const li = document.createElement('li');
    li.textContent = e.msg;
    list.appendChild(li);
  }
  container.appendChild(list);
  if (errors.length > 100) {
    container.appendChild(
      _mkDiv(
        'color:var(--text-secondary,#86868b);font-size:11px;margin-top:6px',
        '...y ' + (errors.length - 100) + ' más (ver consola).'
      )
    );
  }
  errEl.appendChild(container);
}

window.confirmRepartoImportApply = async function () {
  const w = /** @type {any} */ (window);
  if (!_importState || _importState.conCambios.length === 0) return;
  if (_importState.errores.length) {
    alert('No se puede aplicar: hay errores en la vista previa.');
    return;
  }
  if (!_isAdminLikeForImport()) {
    alert('Solo admin o gerente puede aplicar reparto.');
    return;
  }
  const applyBtn = /** @type {any} */ (document.getElementById('reparto-import-apply-btn'));
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Aplicando…';
  }
  try {
    const validator = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoExcelImport;
    const groups = validator.groupImportMatchesByReparto(_importState.conCambios);
    const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];

    const callable = w.firebase
      .app()
      .functions('southamerica-east1')
      .httpsCallable('applyRepartoManualCF');
    let okCount = 0;
    let failCount = 0;
    const failures = [];
    let totalAsignacionesAplicadas = 0;
    let totalEliminacionesAplicadas = 0;

    for (const g of groups) {
      const ing = ingresos.find((/** @type {any} */ i) => i._id === g.repartoId);
      if (!ing) {
        failCount++;
        failures.push('Reparto ' + g.repartoId + ' ya no existe');
        continue;
      }
      const clientes = Array.isArray(ing.clientesBO) ? ing.clientesBO : [];
      /** @type {Array<any>} */
      const assignments = [];
      /** @type {Array<any>} */
      const eliminations = [];
      for (const a of g.assignments) {
        const c = clientes.find(
          (/** @type {any} */ x) =>
            String(x.clientCardCode || x.cardCode || '')
              .toUpperCase()
              .trim() === String(a.cardCode).toUpperCase().trim()
        );
        if (!c) {
          failures.push(
            'Reparto ' + g.repartoId + ' / CardCode ' + a.cardCode + ' ya no está en BO'
          );
          continue;
        }
        assignments.push({
          pedidoId: c.pedidoId,
          lineIndex: Number(c.lineIndex) || 0,
          qtyAsignada: a.qtyAsignada,
        });
      }
      for (const e of g.eliminations) {
        const c = clientes.find(
          (/** @type {any} */ x) =>
            String(x.clientCardCode || x.cardCode || '')
              .toUpperCase()
              .trim() === String(e.cardCode).toUpperCase().trim()
        );
        if (!c) {
          failures.push(
            'Reparto ' + g.repartoId + ' / CardCode ' + e.cardCode + ' ya no está en BO'
          );
          continue;
        }
        eliminations.push({
          pedidoId: c.pedidoId,
          lineIndex: Number(c.lineIndex) || 0,
          qtyEliminar: e.qtyEliminar,
        });
      }
      if (!assignments.length && !eliminations.length) continue;
      try {
        const res = await callable({
          ingresoId: g.repartoId,
          assignments,
          eliminations,
        });
        const r = res.data || {};
        if (r.ok) {
          okCount++;
          totalAsignacionesAplicadas += assignments.length;
          totalEliminacionesAplicadas += eliminations.length;
        } else {
          failCount++;
          failures.push(
            g.repartoId +
              ' (' +
              g.sku +
              '): ' +
              ((r.errors || []).join('; ') || 'error desconocido')
          );
        }
      } catch (callErr) {
        failCount++;
        failures.push(
          g.repartoId +
            ' (' +
            g.sku +
            '): ' +
            ((callErr && /** @type {any} */ (callErr).message) || String(callErr))
        );
      }
    }

    try {
      if (w.fbDb && typeof w.fbDb.collection === 'function') {
        await w.fbDb.collection('reparto_log').add({
          origen: 'import',
          fileName: _importState.fileName,
          importedByUid: (w.currentUser && w.currentUser.uid) || null,
          importedByEmail: (w.currentUser && w.currentUser.email) || null,
          rowsCount: _importState.totalFilas,
          assignmentsCount: totalAsignacionesAplicadas,
          eliminationsCount: totalEliminacionesAplicadas,
          repartosProcesados: groups.length,
          okCount,
          failCount,
          importedAt: new Date().toISOString(),
          timestamp: new Date(),
        });
      }
    } catch (logErr) {
      console.warn('[v1505] reparto_log origen=import write failed', logErr);
    }

    const summary =
      totalAsignacionesAplicadas +
      ' asignaciones aplicadas · ' +
      totalEliminacionesAplicadas +
      ' eliminaciones aplicadas' +
      (failCount
        ? '\n\nRepartos con error (' + failCount + '):\n' + failures.slice(0, 5).join('\n')
        : '');
    alert(summary);
    if (okCount > 0) _syncTag('Import Reparto aplicado · ' + okCount + ' reparto(s)', 3200);
    w.closeRepartoImportDialog && w.closeRepartoImportDialog();
  } catch (e) {
    const msg = (e && /** @type {any} */ (e).message) || String(e);
    console.error('[v1505 §Reparto] confirmRepartoImportApply error:', e);
    alert('Error aplicando import: ' + msg);
    _logExportError('import_apply', msg);
  } finally {
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Aplicar reparto importado';
    }
  }
};

/**
 * v1514 §T3: construye el modal DOM con 4 estados mutuamente exclusivos:
 *   - #reparto-import-dropzone (idle): dashed border + ícono + hint.
 *   - #reparto-import-validating: spinner + "Validando filas...".
 *   - #reparto-import-preview-ok: 3 cards resumen + tabla 5 cols.
 *   - #reparto-import-errors: lista roja de errores.
 * Dropzone soporta click + drag/drop. Dark-mode via CSS vars.
 * @returns {HTMLElement}
 */
function _buildImportModalDom() {
  const modal = document.createElement('div');
  modal.id = 'reparto-import-modal';
  modal.className = 'modal-overlay';
  modal.setAttribute('data-state', 'idle');
  modal.style.cssText = 'display:none;align-items:center;justify-content:center';
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) {
      const w = /** @type {any} */ (window);
      if (typeof w.closeRepartoImportDialog === 'function') w.closeRepartoImportDialog();
    }
  });
  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.cssText =
    'width:min(820px,96vw);max-height:90vh;display:flex;flex-direction:column;' +
    'background:var(--bg-primary,#fff);color:var(--text-primary,#1d1d1f);' +
    'border-radius:14px;overflow:hidden;' +
    'box-shadow:0 20px 50px rgba(0,0,0,.25)';

  // === Header ===
  const head = document.createElement('div');
  head.style.cssText =
    'padding:18px 22px;border-bottom:0.5px solid var(--border-color,rgba(0,0,0,.08));' +
    'display:flex;align-items:center;gap:12px;flex-shrink:0';
  const headTitleWrap = document.createElement('div');
  headTitleWrap.style.cssText = 'flex:1';
  const h2 = document.createElement('h2');
  h2.style.cssText =
    'margin:0 0 2px;font-size:18px;font-weight:700;letter-spacing:-0.4px;' +
    'color:var(--text-primary,#1d1d1f)';
  h2.textContent = 'Importar reparto desde Excel';
  headTitleWrap.appendChild(h2);
  const subt = document.createElement('div');
  subt.style.cssText = 'font-size:12.5px;color:var(--text-secondary,#86868b)';
  subt.textContent = 'Subí el Excel editado offline. Se valida fila por fila antes de aplicar.';
  headTitleWrap.appendChild(subt);
  head.appendChild(headTitleWrap);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.style.cssText =
    'border:none;background:var(--bg-secondary,rgba(120,120,128,.12));' +
    'width:32px;height:32px;border-radius:50%;cursor:pointer;' +
    'color:var(--text-secondary,#6e6e73);font-size:18px;line-height:1';
  closeBtn.addEventListener('click', () => {
    const w = /** @type {any} */ (window);
    if (typeof w.closeRepartoImportDialog === 'function') w.closeRepartoImportDialog();
  });
  head.appendChild(closeBtn);
  box.appendChild(head);

  // === Body ===
  const body = document.createElement('div');
  body.style.cssText =
    'padding:20px 22px;flex:1 1 auto;overflow-y:auto;min-height:0;' +
    'display:flex;flex-direction:column';

  // Input file nativo oculto.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'reparto-import-file';
  fileInput.accept = '.xlsx';
  fileInput.style.cssText = 'display:none';
  fileInput.addEventListener('change', (ev) => {
    const w = /** @type {any} */ (window);
    if (typeof w.handleRepartoImportFileChange === 'function') w.handleRepartoImportFileChange(ev);
  });
  body.appendChild(fileInput);

  // Estado 1: dropzone (idle).
  const dropzone = document.createElement('div');
  dropzone.id = 'reparto-import-dropzone';
  dropzone.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'border:2px dashed var(--border-color,#c7c7cc);' +
    'border-radius:12px;padding:48px 24px;cursor:pointer;' +
    'background:var(--bg-secondary,#fafafa);' +
    'color:var(--text-primary,#1d1d1f);' +
    'transition:background .15s ease,border-color .15s ease;min-height:220px';
  const dzIcon = document.createElement('div');
  dzIcon.style.cssText = 'font-size:48px;line-height:1;margin-bottom:12px';
  dzIcon.textContent = '📂';
  dropzone.appendChild(dzIcon);
  const dzTxt1 = document.createElement('div');
  dzTxt1.style.cssText =
    'font-size:15px;font-weight:600;color:var(--text-primary,#1d1d1f);margin-bottom:4px;text-align:center';
  dzTxt1.textContent = 'Arrastrá el Excel acá o hacé clic para elegirlo';
  dropzone.appendChild(dzTxt1);
  const dzTxt2 = document.createElement('div');
  dzTxt2.style.cssText = 'font-size:12px;color:var(--text-secondary,#86868b);text-align:center';
  dzTxt2.textContent = '(.xlsx exportado del reparto)';
  dropzone.appendChild(dzTxt2);
  dropzone.addEventListener('click', () => {
    fileInput.click();
  });
  dropzone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-dragover');
    dropzone.style.borderColor = 'var(--color-success,#248a3d)';
    dropzone.style.background = 'var(--color-success-bg,rgba(52,199,89,.08))';
  });
  dropzone.addEventListener('dragleave', (ev) => {
    ev.preventDefault();
    dropzone.classList.remove('is-dragover');
    dropzone.style.borderColor = 'var(--border-color,#c7c7cc)';
    dropzone.style.background = 'var(--bg-secondary,#fafafa)';
  });
  dropzone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dropzone.classList.remove('is-dragover');
    dropzone.style.borderColor = 'var(--border-color,#c7c7cc)';
    dropzone.style.background = 'var(--bg-secondary,#fafafa)';
    const dt = /** @type {any} */ (ev).dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      const w = /** @type {any} */ (window);
      if (typeof w.handleRepartoImportFileChange === 'function') {
        w.handleRepartoImportFileChange({ target: { files: [dt.files[0]] } });
      }
    }
  });
  body.appendChild(dropzone);

  // Estado 2: validating (spinner + mensaje).
  const validating = document.createElement('div');
  validating.id = 'reparto-import-validating';
  validating.style.cssText =
    'display:none;flex-direction:column;align-items:center;justify-content:center;' +
    'padding:48px 24px;min-height:220px;gap:14px';
  const spinner = document.createElement('div');
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-label', 'Validando');
  spinner.style.cssText =
    'width:40px;height:40px;border:3px solid var(--border-color,#e5e5ea);' +
    'border-top-color:var(--color-success,#248a3d);border-radius:50%;' +
    'animation:reparto-import-spin 0.8s linear infinite';
  validating.appendChild(spinner);
  const vTxt = document.createElement('div');
  vTxt.style.cssText = 'font-size:14px;color:var(--text-secondary,#86868b);font-weight:500';
  vTxt.textContent = 'Validando filas...';
  validating.appendChild(vTxt);
  // Inyecta keyframes una sola vez.
  if (!document.getElementById('reparto-import-spin-kf')) {
    const style = document.createElement('style');
    style.id = 'reparto-import-spin-kf';
    style.textContent = '@keyframes reparto-import-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
  body.appendChild(validating);

  // Estado 3: preview-ok (cards + tabla).
  const previewOk = document.createElement('div');
  previewOk.id = 'reparto-import-preview-ok';
  previewOk.style.cssText =
    'display:none;flex-direction:column;align-items:stretch;gap:4px;flex:1;min-height:0;width:100%';
  body.appendChild(previewOk);

  // Estado 4: errors.
  const errBox = document.createElement('div');
  errBox.id = 'reparto-import-errors';
  errBox.style.cssText =
    'display:none;flex-direction:column;align-items:stretch;gap:4px;flex:1;min-height:0;width:100%';
  body.appendChild(errBox);

  box.appendChild(body);

  // === Footer ===
  const foot = document.createElement('div');
  foot.style.cssText =
    'padding:14px 22px;border-top:0.5px solid var(--border-color,rgba(0,0,0,.08));' +
    'display:flex;gap:10px;justify-content:flex-end;flex-shrink:0;' +
    'background:var(--bg-primary,#fff)';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.style.cssText =
    'padding:10px 20px;border:0.5px solid var(--border-color,rgba(0,0,0,.12));' +
    'background:var(--bg-primary,#fff);color:var(--text-primary,#1d1d1f);' +
    'border-radius:999px;cursor:pointer;font-size:13px;font-weight:500';
  cancelBtn.addEventListener('click', () => {
    const w = /** @type {any} */ (window);
    if (typeof w.closeRepartoImportDialog === 'function') w.closeRepartoImportDialog();
  });
  foot.appendChild(cancelBtn);
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.id = 'reparto-import-apply-btn';
  applyBtn.disabled = true;
  applyBtn.textContent = 'Aplicar reparto';
  applyBtn.style.cssText =
    'display:none;padding:10px 20px;border:none;' +
    'background:var(--color-success,#248a3d);color:#fff;' +
    'border-radius:999px;cursor:pointer;font-size:13px;font-weight:600;opacity:0.4';
  applyBtn.addEventListener('click', () => {
    const w = /** @type {any} */ (window);
    if (typeof w.confirmRepartoImportApply === 'function') w.confirmRepartoImportApply();
  });
  foot.appendChild(applyBtn);
  box.appendChild(foot);
  modal.appendChild(box);
  return modal;
}
