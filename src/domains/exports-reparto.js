// @ts-nocheck
/**
 * exports-reparto (v1505, 2026-10-28) — chunk lazy para el flow de export +
 * import Excel del Reparto de ingresos.
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

    await ws.protect('', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      sort: false,
      autoFilter: true,
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
  const previewEl = modal.querySelector('#reparto-import-preview');
  if (previewEl) {
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
  }
  const applyBtn = modal.querySelector('#reparto-import-apply-btn');
  if (applyBtn) {
    /** @type {any} */ (applyBtn).disabled = true;
    /** @type {any} */ (applyBtn).style.opacity = '0.4';
  }
  const fileInput = modal.querySelector('#reparto-import-file');
  if (fileInput) /** @type {any} */ (fileInput).value = '';
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
  const previewEl = document.getElementById('reparto-import-preview');
  const applyBtn = document.getElementById('reparto-import-apply-btn');
  if (previewEl) {
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    previewEl.textContent = 'Leyendo Excel…';
  }
  if (applyBtn) {
    /** @type {any} */ (applyBtn).disabled = true;
    /** @type {any} */ (applyBtn).style.opacity = '0.4';
  }
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
    if (previewEl) {
      while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
      const errDiv = document.createElement('div');
      errDiv.style.cssText =
        'color:#c7372f;padding:12px;background:rgba(255,59,48,.08);border-radius:8px';
      errDiv.textContent = 'Error leyendo Excel: ' + msg;
      previewEl.appendChild(errDiv);
    }
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

function _renderImportPreview() {
  const previewEl = document.getElementById('reparto-import-preview');
  const applyBtn = document.getElementById('reparto-import-apply-btn');
  if (!previewEl || !_importState) return;
  const s = _importState;
  while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);

  // Chips de resumen.
  const chipsRow = _mkDiv('display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px', null);
  const chipRec = _mkDiv(
    'flex:1;min-width:140px;padding:10px 14px;background:rgba(52,199,89,.14);border-radius:8px;color:#248a3d',
    null
  );
  chipRec.appendChild(
    _mkDiv('font-size:11px;letter-spacing:.5px;text-transform:uppercase', 'Reconocidas')
  );
  chipRec.appendChild(
    _mkDiv('font-size:22px;font-weight:700;margin-top:2px', String(s.reconocidas.length))
  );
  chipsRow.appendChild(chipRec);
  const chipCamb = _mkDiv(
    'flex:1;min-width:140px;padding:10px 14px;background:rgba(0,122,255,.14);border-radius:8px;color:#0040dd',
    null
  );
  chipCamb.appendChild(
    _mkDiv('font-size:11px;letter-spacing:.5px;text-transform:uppercase', 'Con cambios')
  );
  chipCamb.appendChild(
    _mkDiv('font-size:22px;font-weight:700;margin-top:2px', String(s.conCambios.length))
  );
  chipsRow.appendChild(chipCamb);
  const chipErr = _mkDiv(
    'flex:1;min-width:140px;padding:10px 14px;background:' +
      (s.errores.length ? 'rgba(255,59,48,.14)' : 'rgba(120,120,128,.08)') +
      ';border-radius:8px;color:' +
      (s.errores.length ? '#c7372f' : '#6e6e73'),
    null
  );
  chipErr.appendChild(
    _mkDiv('font-size:11px;letter-spacing:.5px;text-transform:uppercase', 'Errores')
  );
  chipErr.appendChild(
    _mkDiv('font-size:22px;font-weight:700;margin-top:2px', String(s.errores.length))
  );
  chipsRow.appendChild(chipErr);
  previewEl.appendChild(chipsRow);

  if (s.errores.length) {
    const errBox = _mkDiv(
      'padding:12px 14px;background:rgba(255,59,48,.08);border-left:3px solid #c7372f;border-radius:6px;margin-bottom:12px',
      null
    );
    errBox.appendChild(
      _mkDiv(
        'font-weight:700;color:#c7372f;margin-bottom:6px',
        'Hay ' +
          s.errores.length +
          ' error(es). Corregilos y volvé a subir el Excel. No se aplica nada.'
      )
    );
    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:0;padding-left:18px;color:#1d1d1f;font-size:12.5px;line-height:1.5';
    const slice = s.errores.slice(0, 50);
    for (const e of slice) {
      const li = document.createElement('li');
      li.textContent = e.msg;
      ul.appendChild(li);
    }
    errBox.appendChild(ul);
    if (s.errores.length > 50) {
      errBox.appendChild(
        _mkDiv(
          'color:#86868b;font-size:11px;margin-top:4px',
          '...y ' + (s.errores.length - 50) + ' más (ver consola)'
        )
      );
    }
    previewEl.appendChild(errBox);
  }

  if (!s.errores.length && s.conCambios.length) {
    previewEl.appendChild(
      _mkDiv(
        'padding:10px 12px;background:rgba(52,199,89,.08);border-radius:6px;margin-bottom:12px;font-size:13px',
        'Resumen a aplicar: ' +
          s.conCambios.length +
          ' cambio(s) · ' +
          s.totalAsignado +
          ' u asignadas · ' +
          s.totalEliminar +
          ' u eliminadas'
      )
    );
    // Tabla preview.
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.style.cssText = 'background:#f5f5f7';
    for (const h of ['SKU', 'Cliente', 'BO', 'Asig.', 'Elim.']) {
      const th = document.createElement('th');
      th.style.cssText =
        'padding:6px;text-align:' + (h === 'SKU' || h === 'Cliente' ? 'left' : 'right');
      th.textContent = h;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const previewRows = s.conCambios.slice(0, 30);
    for (const r of previewRows) {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #eee';
      const addTd = (/** @type {string} */ txt, /** @type {string} */ css) => {
        const td = document.createElement('td');
        td.style.cssText = css;
        td.textContent = txt;
        tr.appendChild(td);
      };
      addTd(r.sku, 'padding:4px 6px;font-family:monospace');
      addTd(r.clientName, 'padding:4px 6px');
      addTd(String(r.backorderActual), 'padding:4px 6px;text-align:right');
      addTd(
        r.asignadoNuevo ? String(r.asignadoNuevo) : '',
        'padding:4px 6px;text-align:right;color:#248a3d;font-weight:600'
      );
      addTd(
        r.eliminarNuevo ? String(r.eliminarNuevo) : '',
        'padding:4px 6px;text-align:right;color:#c7372f;font-weight:600'
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    previewEl.appendChild(table);
    if (s.conCambios.length > 30) {
      previewEl.appendChild(
        _mkDiv(
          'color:#86868b;font-size:11px;margin-top:4px',
          '...y ' + (s.conCambios.length - 30) + ' más'
        )
      );
    }
  }

  if (!s.errores.length && !s.conCambios.length) {
    previewEl.appendChild(
      _mkDiv(
        'padding:12px 14px;background:rgba(255,204,0,.14);border-radius:6px;color:#8a6d00',
        'El Excel no tiene cambios (Asignado=0 y Eliminar=0 en todas las filas). Nada que aplicar.'
      )
    );
  }

  if (applyBtn) {
    const canApply = s.errores.length === 0 && s.conCambios.length > 0;
    /** @type {any} */ (applyBtn).disabled = !canApply;
    /** @type {any} */ (applyBtn).style.opacity = canApply ? '1' : '0.4';
  }
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
 * Construye el modal DOM via helpers seguros (sin innerHTML con contenido
 * dinámico — el DOM es estático). Primera apertura cachea.
 * @returns {HTMLElement}
 */
function _buildImportModalDom() {
  const modal = document.createElement('div');
  modal.id = 'reparto-import-modal';
  modal.className = 'modal-overlay';
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
    'width:min(760px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;overflow:hidden';
  // Header.
  const head = document.createElement('div');
  head.style.cssText =
    'padding:18px 22px;border-bottom:0.5px solid rgba(0,0,0,.08);display:flex;align-items:center;gap:12px';
  const headTitleWrap = document.createElement('div');
  headTitleWrap.style.cssText = 'flex:1';
  const h2 = document.createElement('h2');
  h2.style.cssText = 'margin:0 0 2px;font-size:18px;font-weight:700;letter-spacing:-0.4px';
  h2.textContent = 'Importar reparto desde Excel';
  headTitleWrap.appendChild(h2);
  const subt = document.createElement('div');
  subt.style.cssText = 'font-size:12.5px;color:#86868b';
  subt.textContent = 'Subí el Excel editado offline. Se valida fila por fila antes de aplicar.';
  headTitleWrap.appendChild(subt);
  head.appendChild(headTitleWrap);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.style.cssText =
    'border:none;background:rgba(120,120,128,.12);width:30px;height:30px;border-radius:50%;cursor:pointer;color:#6e6e73;font-size:16px';
  closeBtn.addEventListener('click', () => {
    const w = /** @type {any} */ (window);
    if (typeof w.closeRepartoImportDialog === 'function') w.closeRepartoImportDialog();
  });
  head.appendChild(closeBtn);
  box.appendChild(head);
  // Body.
  const body = document.createElement('div');
  body.style.cssText = 'padding:16px 22px;flex:1;overflow-y:auto;min-height:0';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'reparto-import-file';
  fileInput.accept = '.xlsx';
  fileInput.style.cssText = 'margin-bottom:14px';
  fileInput.addEventListener('change', (ev) => {
    const w = /** @type {any} */ (window);
    if (typeof w.handleRepartoImportFileChange === 'function') w.handleRepartoImportFileChange(ev);
  });
  body.appendChild(fileInput);
  const previewDiv = document.createElement('div');
  previewDiv.id = 'reparto-import-preview';
  previewDiv.style.cssText = 'min-height:40px';
  body.appendChild(previewDiv);
  box.appendChild(body);
  // Footer.
  const foot = document.createElement('div');
  foot.style.cssText =
    'padding:14px 22px;border-top:0.5px solid rgba(0,0,0,.08);display:flex;gap:10px;justify-content:flex-end';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.style.cssText =
    'padding:9px 18px;border:0.5px solid rgba(0,0,0,.12);background:#fff;border-radius:999px;cursor:pointer;font-size:13px';
  cancelBtn.addEventListener('click', () => {
    const w = /** @type {any} */ (window);
    if (typeof w.closeRepartoImportDialog === 'function') w.closeRepartoImportDialog();
  });
  foot.appendChild(cancelBtn);
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.id = 'reparto-import-apply-btn';
  applyBtn.disabled = true;
  applyBtn.textContent = 'Aplicar reparto importado';
  applyBtn.style.cssText =
    'padding:9px 18px;border:none;background:#248a3d;color:#fff;border-radius:999px;cursor:pointer;font-size:13px;font-weight:600;opacity:0.4';
  applyBtn.addEventListener('click', () => {
    const w = /** @type {any} */ (window);
    if (typeof w.confirmRepartoImportApply === 'function') w.confirmRepartoImportApply();
  });
  foot.appendChild(applyBtn);
  box.appendChild(foot);
  modal.appendChild(box);
  return modal;
}
