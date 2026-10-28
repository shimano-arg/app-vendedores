"use strict";
(() => {
  // src/domains/exports-reparto.js
  async function _ensureExcelJS() {
    const w = (
      /** @type {any} */
      window
    );
    if (typeof w.loadExcelJS === "function") await w.loadExcelJS();
    if (!w.ExcelJS) throw new Error("ExcelJS no disponible");
  }
  function _syncTag(msg, ms) {
    const w = (
      /** @type {any} */
      window
    );
    if (typeof w.showSyncTag === "function") {
      try {
        w.showSyncTag(msg, ms);
      } catch (_e) {
      }
    }
  }
  function _getStockFisico(sku) {
    const w = (
      /** @type {any} */
      window
    );
    if (typeof w.getStockDisponibleVenta !== "function") return 0;
    try {
      return Number(w.getStockDisponibleVenta(sku)) || 0;
    } catch (_e) {
      return 0;
    }
  }
  function _readFiltrosModalReparto() {
    const sEl = typeof document !== "undefined" ? document.getElementById("reparto-search") : null;
    const hEl = typeof document !== "undefined" ? document.getElementById("reparto-hide-nostock") : null;
    return {
      search: sEl ? String(
        /** @type {any} */
        sEl.value || ""
      ).trim() : "",
      hideNoStock: hEl ? !!/** @type {any} */
      hEl.checked : true
    };
  }
  function _logExportError(exportKind, msg) {
    try {
      const w = (
        /** @type {any} */
        window
      );
      if (!w.fbDb || typeof w.fbDb.collection !== "function") return;
      w.fbDb.collection("operations_log").add({
        type: "export_failed",
        exportKind,
        error: msg.slice(0, 500),
        userUid: w.currentUser && w.currentUser.uid || null,
        userEmail: w.currentUser && w.currentUser.email || null,
        timestamp: /* @__PURE__ */ new Date()
      }).catch(() => {
      });
    } catch (_e) {
    }
  }
  window.exportRepartoManualExcel = async function() {
    const w = (
      /** @type {any} */
      window
    );
    const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
    if (!ingresos.length) {
      alert('No hay ingresos de reparto para exportar. Abr\xED el modal "Reparto de ingresos" primero.');
      return;
    }
    _syncTag("Generando Excel editable\u2026");
    try {
      const pureMod = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoExcelExport;
      if (!pureMod || typeof pureMod.computeRepartoExcelExportRows !== "function") {
        throw new Error("pure fn repartoExcelExport no disponible");
      }
      const consolidateFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoConsolidate && w.__phase0.pure.repartoConsolidate.consolidateClientesBO;
      const filtros = _readFiltrosModalReparto();
      const result = pureMod.computeRepartoExcelExportRows(ingresos, filtros, {
        getStockFisico: _getStockFisico,
        consolidateFn: typeof consolidateFn === "function" ? consolidateFn : void 0
      });
      if (!result.rows.length) {
        alert(
          'No hay filas para exportar con los filtros actuales. Limpi\xE1 b\xFAsqueda o destild\xE1 "Ocultar sin stock".'
        );
        return;
      }
      await _ensureExcelJS();
      const ExcelJS = w.ExcelJS;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Reparto");
      ws.columns = [
        { header: "Codigo", key: "Codigo", width: 18 },
        { header: "Cliente", key: "Cliente", width: 36 },
        { header: "Backorder", key: "Backorder", width: 12 },
        { header: "Stock disponible", key: "StockDisponible", width: 15 },
        { header: "Asignado", key: "Asignado", width: 12 },
        { header: "Vuelve a backorder", key: "VueleABackorder", width: 18 },
        { header: "Eliminar", key: "Eliminar", width: 12 },
        { header: "Reparto ID", key: "RepartoId", width: 24 },
        { header: "CardCode", key: "CardCode", width: 16 }
      ];
      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF166534" } };
        cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 12 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFCCCCCC" } },
          left: { style: "thin", color: { argb: "FFCCCCCC" } },
          right: { style: "thin", color: { argb: "FFCCCCCC" } },
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } }
        };
      });
      headerRow.height = 28;
      headerRow.getCell(8).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF888888" }
      };
      headerRow.getCell(9).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF888888" }
      };
      for (let i = 0; i < result.rows.length; i++) {
        const r = result.rows[i];
        if (r && (r._notice === true || r.Codigo === "")) {
          const row2 = ws.addRow({
            Codigo: "",
            Cliente: r.Cliente || "",
            Backorder: null,
            StockDisponible: null,
            Asignado: null,
            VueleABackorder: null,
            Eliminar: null,
            RepartoId: "",
            CardCode: ""
          });
          row2.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB99" } };
            cell.font = { color: { argb: "FF78350F" }, bold: true, size: 11 };
            cell.alignment = { vertical: "middle", horizontal: "center" };
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
          CardCode: r.CardCode
        });
        row.getCell(6).value = {
          formula: r.VueleABackorder.replace(/^=/, ""),
          result: r.Backorder - r.Asignado - r.Eliminar
        };
        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = {
            top: { style: "thin", color: { argb: "FFEEEEEE" } },
            left: { style: "thin", color: { argb: "FFEEEEEE" } },
            right: { style: "thin", color: { argb: "FFEEEEEE" } },
            bottom: { style: "thin", color: { argb: "FFEEEEEE" } }
          };
        });
        row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
        row.getCell(8).font = { color: { argb: "FF888888" }, size: 10 };
        row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
        row.getCell(9).font = { color: { argb: "FF888888" }, size: 10 };
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
      ws.views = [{ state: "frozen", ySplit: 1 }];
      const _lastRow = (result.rows ? result.rows.length : 0) + 1;
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: _lastRow, column: 9 } };
      await ws.protect("", {
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatCells: false,
        sort: true,
        // v1512: permite ordenar
        autoFilter: true
        // permite filtrar (ya estaba)
      });
      const filename = pureMod.buildRepartoExcelFileName ? pureMod.buildRepartoExcelFileName(/* @__PURE__ */ new Date()) : "Reparto_" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + "_" + (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5).replace(":", "") + ".xlsx";
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      _syncTag(
        "Excel editable listo (" + result.rows.length + " filas \xB7 " + result.totalBackorder + "u BO)",
        3200
      );
    } catch (e) {
      const msg = e && /** @type {any} */
      e.message || String(e);
      console.error("[v1505 \xA7Reparto] exportRepartoManualExcel fall\xF3:", e);
      alert("No pudimos generar el Excel editable. Volv\xE9 a intentar; si sigue, avisale a Mariano.");
      _logExportError("export_manual", msg);
    }
  };
  var _importState = (
    /** @type {null | {
      fileName: string,
      reconocidas: Array<any>,
      conCambios: Array<any>,
      errores: Array<any>,
      totalFilas: number,
      totalAsignado: number,
      totalEliminar: number,
    }} */
    null
  );
  function _isAdminLikeForImport() {
    const w = (
      /** @type {any} */
      window
    );
    const role = (w.userRole || "").toLowerCase();
    if (role === "admin" || role === "gerente") return true;
    const email = String(w.currentUser && w.currentUser.email || "").toLowerCase();
    if (email === "pablo.gonzalez@shimano.com.ar" || email === "erbinomariano@gmail.com") return true;
    return false;
  }
  function _setImportModalState(state) {
    const modal = document.getElementById("reparto-import-modal");
    if (!modal) return;
    modal.setAttribute("data-state", state);
    const ids = {
      idle: "reparto-import-dropzone",
      validating: "reparto-import-validating",
      "preview-ok": "reparto-import-preview-ok",
      errors: "reparto-import-errors"
    };
    for (const [st, id] of Object.entries(ids)) {
      const el = modal.querySelector("#" + id);
      if (!el) continue;
      el.style.display = st === state ? "flex" : "none";
    }
    const applyBtn = modal.querySelector("#reparto-import-apply-btn");
    if (applyBtn) {
      applyBtn.style.display = state === "preview-ok" ? "inline-block" : "none";
    }
  }
  window.openRepartoImportDialog = async function() {
    if (!_isAdminLikeForImport()) {
      alert("Solo admin o gerente puede importar reparto.");
      return;
    }
    const w = (
      /** @type {any} */
      window
    );
    const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
    if (!ingresos.length) {
      alert("No hay ingresos de reparto activos. Abr\xED el modal Reparto primero.");
      return;
    }
    let modal = document.getElementById("reparto-import-modal");
    if (!modal) {
      modal = _buildImportModalDom();
      document.body.appendChild(modal);
    }
    _importState = null;
    const okEl = modal.querySelector("#reparto-import-preview-ok");
    if (okEl) {
      while (okEl.firstChild) okEl.removeChild(okEl.firstChild);
    }
    const errEl = modal.querySelector("#reparto-import-errors");
    if (errEl) {
      while (errEl.firstChild) errEl.removeChild(errEl.firstChild);
    }
    const applyBtn = modal.querySelector("#reparto-import-apply-btn");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.style.opacity = "0.4";
    }
    const fileInput = modal.querySelector("#reparto-import-file");
    if (fileInput) fileInput.value = "";
    _setImportModalState("idle");
    modal.style.display = "flex";
  };
  window.closeRepartoImportDialog = function() {
    const modal = document.getElementById("reparto-import-modal");
    if (modal) modal.style.display = "none";
    _importState = null;
  };
  window.handleRepartoImportFileChange = async function(ev) {
    const w = (
      /** @type {any} */
      window
    );
    const tgt = (
      /** @type {HTMLInputElement} */
      ev.target
    );
    const file = tgt && tgt.files && tgt.files[0];
    if (!file) return;
    const applyBtn = document.getElementById("reparto-import-apply-btn");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.style.opacity = "0.4";
    }
    _setImportModalState("validating");
    try {
      await _ensureExcelJS();
      const buf = await file.arrayBuffer();
      const wb = new w.ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("Excel sin hojas");
      const headerMap = _buildHeaderMap(ws);
      const rows = [];
      ws.eachRow((row, rn) => {
        if (rn === 1) return;
        const obj = { __rowIndex: rn };
        row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
          const canonKey = headerMap[colIdx];
          if (!canonKey) return;
          let v = cell.value;
          if (v && typeof v === "object" && "text" in v) v = v.text;
          if (v && typeof v === "object" && "result" in v) v = v.result;
          obj[canonKey] = v;
        });
        if (!obj.RepartoId && !obj.CardCode && !obj.Codigo) return;
        rows.push(obj);
      });
      const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
      const repartosActivos = ingresos.map((i) => ({
        _id: i._id,
        sku: i.sku,
        status: i.status || "pending",
        stockDisponible: _getStockFisico(i.sku),
        clientesBO: Array.isArray(i.clientesBO) ? i.clientesBO : []
      }));
      const validator = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoExcelImport;
      if (!validator || typeof validator.validateRepartoExcelImport !== "function") {
        throw new Error("pure fn repartoExcelImport no disponible");
      }
      const result = validator.validateRepartoExcelImport(rows, repartosActivos);
      _importState = {
        fileName: file.name,
        reconocidas: result.reconocidas,
        conCambios: result.conCambios,
        errores: result.errores,
        totalFilas: result.totalFilas,
        totalAsignado: result.totalAsignado,
        totalEliminar: result.totalEliminar
      };
      _renderImportPreview();
    } catch (e) {
      const msg = e && /** @type {any} */
      e.message || String(e);
      console.error("[v1505 \xA7Reparto] handleRepartoImportFileChange error:", e);
      const errBoxEl = document.getElementById("reparto-import-errors");
      if (errBoxEl) {
        while (errBoxEl.firstChild) errBoxEl.removeChild(errBoxEl.firstChild);
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "color:var(--text-primary,#c7372f);padding:14px;background:var(--color-danger-bg,rgba(255,59,48,.08));border-left:3px solid var(--color-danger,#c7372f);border-radius:8px;width:100%";
        const t = document.createElement("div");
        t.style.cssText = "font-weight:700;margin-bottom:6px";
        t.textContent = "No se pudo leer el Excel";
        const d = document.createElement("div");
        d.style.cssText = "font-size:12.5px;line-height:1.5";
        d.textContent = msg;
        errDiv.appendChild(t);
        errDiv.appendChild(d);
        errBoxEl.appendChild(errDiv);
      }
      _setImportModalState("errors");
      _logExportError("import_read", msg);
    }
  };
  function _buildHeaderMap(ws) {
    const out = {};
    const headerRow = ws.getRow(1);
    headerRow.eachCell(
      { includeEmpty: false },
      (cell, col) => {
        let v = cell.value;
        if (v && typeof v === "object" && "text" in v) v = v.text;
        if (v && typeof v === "object" && "result" in v) v = v.result;
        const label = String(v || "").trim().toLowerCase();
        if (!label) return;
        if (label === "codigo" || label === "c\xF3digo") out[col] = "Codigo";
        else if (label === "cliente") out[col] = "Cliente";
        else if (label === "backorder") out[col] = "Backorder";
        else if (label === "stock disponible" || label === "stock_disponible")
          out[col] = "StockDisponible";
        else if (label === "asignado") out[col] = "Asignado";
        else if (label === "vuelve a backorder") out[col] = "VueleABackorder";
        else if (label === "eliminar") out[col] = "Eliminar";
        else if (label === "reparto id" || label === "repartoid" || label === "reparto_id")
          out[col] = "RepartoId";
        else if (label === "cardcode" || label === "card code" || label === "card_code")
          out[col] = "CardCode";
      }
    );
    return out;
  }
  function _mkDiv(styleCss, textValue) {
    const d = document.createElement("div");
    d.style.cssText = styleCss;
    if (textValue != null) d.textContent = textValue;
    return d;
  }
  function _computeConsistencyErrors(reconocidas) {
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
          sku: r.sku || "",
          cliente: r.clientName || "",
          msg: "Fila " + (r.rowIndex || 0) + " \xB7 " + (r.sku || "?") + " / " + (r.clientName || "?") + ": Asignado(" + asig + ") + Eliminar(" + elim + ") supera Backorder(" + bo + "). Revis\xE1 las unidades."
        });
      }
    }
    return out;
  }
  function _renderImportPreview() {
    const applyBtn = document.getElementById("reparto-import-apply-btn");
    if (!_importState) return;
    const s = _importState;
    let totalVueleBO = 0;
    for (const r of s.conCambios || []) {
      const bo = Number(r.backorderActual) || 0;
      const asig = Number(r.asignadoNuevo) || 0;
      const elim = Number(r.eliminarNuevo) || 0;
      const diff = bo - asig - elim;
      if (diff > 0) totalVueleBO += diff;
    }
    const consistencyErrors = _computeConsistencyErrors(s.reconocidas);
    const allErrors = (s.errores || []).concat(
      consistencyErrors.map((c) => ({
        rowIndex: c.rowIndex,
        type: "consistency_rule",
        msg: c.msg,
        sku: c.sku,
        cliente: c.cliente
      }))
    );
    if (allErrors.length) {
      _renderErrorsState(allErrors);
      _setImportModalState("errors");
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.style.opacity = "0.4";
      }
      return;
    }
    _renderPreviewOkState({
      totalAsignadas: s.totalAsignado || 0,
      totalVueleBO,
      totalEliminadas: s.totalEliminar || 0,
      reconocidas: s.reconocidas || []
    });
    _setImportModalState("preview-ok");
    if (applyBtn) {
      const canApply = s.conCambios.length > 0;
      applyBtn.disabled = !canApply;
      applyBtn.style.opacity = canApply ? "1" : "0.4";
    }
  }
  function _renderPreviewOkState(data) {
    const okEl = document.getElementById("reparto-import-preview-ok");
    if (!okEl) return;
    while (okEl.firstChild) okEl.removeChild(okEl.firstChild);
    const cards = document.createElement("div");
    cards.style.cssText = "display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:18px;width:100%";
    const mkCard = (label, n, bg, fg) => {
      const c = document.createElement("div");
      c.style.cssText = "flex:1 1 160px;min-width:160px;max-width:220px;padding:18px 14px;background:" + bg + ";border-radius:12px;color:" + fg + ";text-align:center";
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:12px;letter-spacing:.5px;text-transform:uppercase;opacity:.85";
      lbl.textContent = label;
      const num = document.createElement("div");
      num.style.cssText = "font-size:38px;font-weight:800;margin-top:6px;line-height:1";
      num.textContent = String(n);
      c.appendChild(lbl);
      c.appendChild(num);
      return c;
    };
    cards.appendChild(
      mkCard(
        "Asignadas",
        data.totalAsignadas,
        "var(--color-success-bg,rgba(52,199,89,.14))",
        "var(--color-success,#248a3d)"
      )
    );
    cards.appendChild(
      mkCard(
        "Vuelve a BO",
        data.totalVueleBO,
        "var(--color-warning-bg,rgba(255,204,0,.14))",
        "var(--color-warning,#8a6d00)"
      )
    );
    cards.appendChild(
      mkCard(
        "Eliminadas",
        data.totalEliminadas,
        "var(--color-danger-bg,rgba(255,59,48,.14))",
        "var(--color-danger,#c7372f)"
      )
    );
    okEl.appendChild(cards);
    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = "width:100%;max-height:360px;overflow-y:auto;overscroll-behavior:contain";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    trh.style.cssText = "background:var(--bg-secondary,#f5f5f7);position:sticky;top:0;z-index:1";
    for (const h of ["SKU", "Cliente", "Asignado", "Vuelve a BO", "Eliminado"]) {
      const th = document.createElement("th");
      th.style.cssText = "padding:8px;text-align:" + (h === "SKU" || h === "Cliente" ? "left" : "right") + ";color:var(--text-primary,#1d1d1f);font-weight:600";
      th.textContent = h;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    const rowsToShow = (data.reconocidas || []).slice(0, 200);
    for (const r of rowsToShow) {
      const tr = document.createElement("tr");
      tr.style.cssText = "border-bottom:1px solid var(--border-color,#eee)";
      const bo = Number(r.backorderActual) || 0;
      const asig = Number(r.asignadoNuevo) || 0;
      const elim = Number(r.eliminarNuevo) || 0;
      const vuelve = Math.max(0, bo - asig - elim);
      const addTd = (txt, css) => {
        const td = document.createElement("td");
        td.style.cssText = css;
        td.textContent = txt;
        tr.appendChild(td);
      };
      addTd(r.sku || "", "padding:6px 8px;font-family:monospace;color:var(--text-primary)");
      addTd(r.clientName || "", "padding:6px 8px;color:var(--text-primary)");
      addTd(
        asig ? String(asig) : "-",
        "padding:6px 8px;text-align:right;" + (asig ? "color:var(--color-success,#248a3d);font-weight:700" : "color:var(--text-secondary,#86868b)")
      );
      addTd(
        vuelve ? String(vuelve) : "-",
        "padding:6px 8px;text-align:right;" + (vuelve ? "color:var(--color-warning,#8a6d00);font-weight:700" : "color:var(--text-secondary,#86868b)")
      );
      addTd(
        elim ? String(elim) : "-",
        "padding:6px 8px;text-align:right;" + (elim ? "color:var(--color-danger,#c7372f);font-weight:700" : "color:var(--text-secondary,#86868b)")
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    okEl.appendChild(tableWrap);
    if ((data.reconocidas || []).length > 200) {
      okEl.appendChild(
        _mkDiv(
          "color:var(--text-secondary,#86868b);font-size:11px;margin-top:6px;text-align:center",
          "...y " + ((data.reconocidas || []).length - 200) + " filas m\xE1s"
        )
      );
    }
  }
  function _renderErrorsState(errors) {
    const errEl = document.getElementById("reparto-import-errors");
    if (!errEl) return;
    while (errEl.firstChild) errEl.removeChild(errEl.firstChild);
    const container = document.createElement("div");
    container.style.cssText = "width:100%;max-height:420px;overflow-y:auto";
    const header = _mkDiv(
      "padding:12px 14px;background:var(--color-danger-bg,rgba(255,59,48,.08));border-left:3px solid var(--color-danger,#c7372f);border-radius:6px;margin-bottom:12px;color:var(--color-danger,#c7372f);font-weight:700",
      "Hay " + errors.length + " error(es). Correg\xED el Excel y volv\xE9 a subirlo. No se aplica nada."
    );
    container.appendChild(header);
    const list = document.createElement("ul");
    list.style.cssText = "margin:0;padding-left:20px;color:var(--text-primary,#1d1d1f);font-size:13px;line-height:1.6";
    const slice = errors.slice(0, 100);
    for (const e of slice) {
      const li = document.createElement("li");
      li.textContent = e.msg;
      list.appendChild(li);
    }
    container.appendChild(list);
    if (errors.length > 100) {
      container.appendChild(
        _mkDiv(
          "color:var(--text-secondary,#86868b);font-size:11px;margin-top:6px",
          "...y " + (errors.length - 100) + " m\xE1s (ver consola)."
        )
      );
    }
    errEl.appendChild(container);
  }
  window.confirmRepartoImportApply = async function() {
    const w = (
      /** @type {any} */
      window
    );
    if (!_importState || _importState.conCambios.length === 0) return;
    if (_importState.errores.length) {
      alert("No se puede aplicar: hay errores en la vista previa.");
      return;
    }
    if (!_isAdminLikeForImport()) {
      alert("Solo admin o gerente puede aplicar reparto.");
      return;
    }
    const applyBtn = (
      /** @type {any} */
      document.getElementById("reparto-import-apply-btn")
    );
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = "Aplicando\u2026";
    }
    try {
      const validator = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoExcelImport;
      const groups = validator.groupImportMatchesByReparto(_importState.conCambios);
      const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
      const callable = w.firebase.app().functions("southamerica-east1").httpsCallable("applyRepartoManualCF");
      let okCount = 0;
      let failCount = 0;
      const failures = [];
      let totalAsignacionesAplicadas = 0;
      let totalEliminacionesAplicadas = 0;
      for (const g of groups) {
        const ing = ingresos.find((i) => i._id === g.repartoId);
        if (!ing) {
          failCount++;
          failures.push("Reparto " + g.repartoId + " ya no existe");
          continue;
        }
        const clientes = Array.isArray(ing.clientesBO) ? ing.clientesBO : [];
        const assignments = [];
        const eliminations = [];
        for (const a of g.assignments) {
          const c = clientes.find(
            (x) => String(x.clientCardCode || x.cardCode || "").toUpperCase().trim() === String(a.cardCode).toUpperCase().trim()
          );
          if (!c) {
            failures.push(
              "Reparto " + g.repartoId + " / CardCode " + a.cardCode + " ya no est\xE1 en BO"
            );
            continue;
          }
          assignments.push({
            pedidoId: c.pedidoId,
            lineIndex: Number(c.lineIndex) || 0,
            qtyAsignada: a.qtyAsignada
          });
        }
        for (const e of g.eliminations) {
          const c = clientes.find(
            (x) => String(x.clientCardCode || x.cardCode || "").toUpperCase().trim() === String(e.cardCode).toUpperCase().trim()
          );
          if (!c) {
            failures.push(
              "Reparto " + g.repartoId + " / CardCode " + e.cardCode + " ya no est\xE1 en BO"
            );
            continue;
          }
          eliminations.push({
            pedidoId: c.pedidoId,
            lineIndex: Number(c.lineIndex) || 0,
            qtyEliminar: e.qtyEliminar
          });
        }
        if (!assignments.length && !eliminations.length) continue;
        try {
          const res = await callable({
            ingresoId: g.repartoId,
            assignments,
            eliminations
          });
          const r = res.data || {};
          if (r.ok) {
            okCount++;
            totalAsignacionesAplicadas += assignments.length;
            totalEliminacionesAplicadas += eliminations.length;
          } else {
            failCount++;
            failures.push(
              g.repartoId + " (" + g.sku + "): " + ((r.errors || []).join("; ") || "error desconocido")
            );
          }
        } catch (callErr) {
          failCount++;
          failures.push(
            g.repartoId + " (" + g.sku + "): " + (callErr && /** @type {any} */
            callErr.message || String(callErr))
          );
        }
      }
      try {
        if (w.fbDb && typeof w.fbDb.collection === "function") {
          await w.fbDb.collection("reparto_log").add({
            origen: "import",
            fileName: _importState.fileName,
            importedByUid: w.currentUser && w.currentUser.uid || null,
            importedByEmail: w.currentUser && w.currentUser.email || null,
            rowsCount: _importState.totalFilas,
            assignmentsCount: totalAsignacionesAplicadas,
            eliminationsCount: totalEliminacionesAplicadas,
            repartosProcesados: groups.length,
            okCount,
            failCount,
            importedAt: (/* @__PURE__ */ new Date()).toISOString(),
            timestamp: /* @__PURE__ */ new Date()
          });
        }
      } catch (logErr) {
        console.warn("[v1505] reparto_log origen=import write failed", logErr);
      }
      const summary = totalAsignacionesAplicadas + " asignaciones aplicadas \xB7 " + totalEliminacionesAplicadas + " eliminaciones aplicadas" + (failCount ? "\n\nRepartos con error (" + failCount + "):\n" + failures.slice(0, 5).join("\n") : "");
      alert(summary);
      if (okCount > 0) _syncTag("Import Reparto aplicado \xB7 " + okCount + " reparto(s)", 3200);
      w.closeRepartoImportDialog && w.closeRepartoImportDialog();
    } catch (e) {
      const msg = e && /** @type {any} */
      e.message || String(e);
      console.error("[v1505 \xA7Reparto] confirmRepartoImportApply error:", e);
      alert("Error aplicando import: " + msg);
      _logExportError("import_apply", msg);
    } finally {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = "Aplicar reparto importado";
      }
    }
  };
  function _buildImportModalDom() {
    const modal = document.createElement("div");
    modal.id = "reparto-import-modal";
    modal.className = "modal-overlay";
    modal.setAttribute("data-state", "idle");
    modal.style.cssText = "display:none;align-items:center;justify-content:center";
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) {
        const w = (
          /** @type {any} */
          window
        );
        if (typeof w.closeRepartoImportDialog === "function") w.closeRepartoImportDialog();
      }
    });
    const box = document.createElement("div");
    box.className = "modal-box";
    box.style.cssText = "width:min(820px,96vw);max-height:90vh;display:flex;flex-direction:column;background:var(--bg-primary,#fff);color:var(--text-primary,#1d1d1f);border-radius:14px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.25)";
    const head = document.createElement("div");
    head.style.cssText = "padding:18px 22px;border-bottom:0.5px solid var(--border-color,rgba(0,0,0,.08));display:flex;align-items:center;gap:12px;flex-shrink:0";
    const headTitleWrap = document.createElement("div");
    headTitleWrap.style.cssText = "flex:1";
    const h2 = document.createElement("h2");
    h2.style.cssText = "margin:0 0 2px;font-size:18px;font-weight:700;letter-spacing:-0.4px;color:var(--text-primary,#1d1d1f)";
    h2.textContent = "Importar reparto desde Excel";
    headTitleWrap.appendChild(h2);
    const subt = document.createElement("div");
    subt.style.cssText = "font-size:12.5px;color:var(--text-secondary,#86868b)";
    subt.textContent = "Sub\xED el Excel editado offline. Se valida fila por fila antes de aplicar.";
    headTitleWrap.appendChild(subt);
    head.appendChild(headTitleWrap);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "\xD7";
    closeBtn.setAttribute("aria-label", "Cerrar");
    closeBtn.style.cssText = "border:none;background:var(--bg-secondary,rgba(120,120,128,.12));width:32px;height:32px;border-radius:50%;cursor:pointer;color:var(--text-secondary,#6e6e73);font-size:18px;line-height:1";
    closeBtn.addEventListener("click", () => {
      const w = (
        /** @type {any} */
        window
      );
      if (typeof w.closeRepartoImportDialog === "function") w.closeRepartoImportDialog();
    });
    head.appendChild(closeBtn);
    box.appendChild(head);
    const body = document.createElement("div");
    body.style.cssText = "padding:20px 22px;flex:1 1 auto;overflow-y:auto;min-height:0;display:flex;flex-direction:column";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "reparto-import-file";
    fileInput.accept = ".xlsx";
    fileInput.style.cssText = "display:none";
    fileInput.addEventListener("change", (ev) => {
      const w = (
        /** @type {any} */
        window
      );
      if (typeof w.handleRepartoImportFileChange === "function") w.handleRepartoImportFileChange(ev);
    });
    body.appendChild(fileInput);
    const dropzone = document.createElement("div");
    dropzone.id = "reparto-import-dropzone";
    dropzone.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed var(--border-color,#c7c7cc);border-radius:12px;padding:48px 24px;cursor:pointer;background:var(--bg-secondary,#fafafa);color:var(--text-primary,#1d1d1f);transition:background .15s ease,border-color .15s ease;min-height:220px";
    const dzIcon = document.createElement("div");
    dzIcon.style.cssText = "font-size:48px;line-height:1;margin-bottom:12px";
    dzIcon.textContent = "\u{1F4C2}";
    dropzone.appendChild(dzIcon);
    const dzTxt1 = document.createElement("div");
    dzTxt1.style.cssText = "font-size:15px;font-weight:600;color:var(--text-primary,#1d1d1f);margin-bottom:4px;text-align:center";
    dzTxt1.textContent = "Arrastr\xE1 el Excel ac\xE1 o hac\xE9 clic para elegirlo";
    dropzone.appendChild(dzTxt1);
    const dzTxt2 = document.createElement("div");
    dzTxt2.style.cssText = "font-size:12px;color:var(--text-secondary,#86868b);text-align:center";
    dzTxt2.textContent = "(.xlsx exportado del reparto)";
    dropzone.appendChild(dzTxt2);
    dropzone.addEventListener("click", () => {
      fileInput.click();
    });
    dropzone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      dropzone.classList.add("is-dragover");
      dropzone.style.borderColor = "var(--color-success,#248a3d)";
      dropzone.style.background = "var(--color-success-bg,rgba(52,199,89,.08))";
    });
    dropzone.addEventListener("dragleave", (ev) => {
      ev.preventDefault();
      dropzone.classList.remove("is-dragover");
      dropzone.style.borderColor = "var(--border-color,#c7c7cc)";
      dropzone.style.background = "var(--bg-secondary,#fafafa)";
    });
    dropzone.addEventListener("drop", (ev) => {
      ev.preventDefault();
      dropzone.classList.remove("is-dragover");
      dropzone.style.borderColor = "var(--border-color,#c7c7cc)";
      dropzone.style.background = "var(--bg-secondary,#fafafa)";
      const dt = (
        /** @type {any} */
        ev.dataTransfer
      );
      if (dt && dt.files && dt.files[0]) {
        const w = (
          /** @type {any} */
          window
        );
        if (typeof w.handleRepartoImportFileChange === "function") {
          w.handleRepartoImportFileChange({ target: { files: [dt.files[0]] } });
        }
      }
    });
    body.appendChild(dropzone);
    const validating = document.createElement("div");
    validating.id = "reparto-import-validating";
    validating.style.cssText = "display:none;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;min-height:220px;gap:14px";
    const spinner = document.createElement("div");
    spinner.setAttribute("role", "status");
    spinner.setAttribute("aria-label", "Validando");
    spinner.style.cssText = "width:40px;height:40px;border:3px solid var(--border-color,#e5e5ea);border-top-color:var(--color-success,#248a3d);border-radius:50%;animation:reparto-import-spin 0.8s linear infinite";
    validating.appendChild(spinner);
    const vTxt = document.createElement("div");
    vTxt.style.cssText = "font-size:14px;color:var(--text-secondary,#86868b);font-weight:500";
    vTxt.textContent = "Validando filas...";
    validating.appendChild(vTxt);
    if (!document.getElementById("reparto-import-spin-kf")) {
      const style = document.createElement("style");
      style.id = "reparto-import-spin-kf";
      style.textContent = "@keyframes reparto-import-spin{to{transform:rotate(360deg)}}";
      document.head.appendChild(style);
    }
    body.appendChild(validating);
    const previewOk = document.createElement("div");
    previewOk.id = "reparto-import-preview-ok";
    previewOk.style.cssText = "display:none;flex-direction:column;align-items:stretch;gap:4px;flex:1;min-height:0;width:100%";
    body.appendChild(previewOk);
    const errBox = document.createElement("div");
    errBox.id = "reparto-import-errors";
    errBox.style.cssText = "display:none;flex-direction:column;align-items:stretch;gap:4px;flex:1;min-height:0;width:100%";
    body.appendChild(errBox);
    box.appendChild(body);
    const foot = document.createElement("div");
    foot.style.cssText = "padding:14px 22px;border-top:0.5px solid var(--border-color,rgba(0,0,0,.08));display:flex;gap:10px;justify-content:flex-end;flex-shrink:0;background:var(--bg-primary,#fff)";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.style.cssText = "padding:10px 20px;border:0.5px solid var(--border-color,rgba(0,0,0,.12));background:var(--bg-primary,#fff);color:var(--text-primary,#1d1d1f);border-radius:999px;cursor:pointer;font-size:13px;font-weight:500";
    cancelBtn.addEventListener("click", () => {
      const w = (
        /** @type {any} */
        window
      );
      if (typeof w.closeRepartoImportDialog === "function") w.closeRepartoImportDialog();
    });
    foot.appendChild(cancelBtn);
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.id = "reparto-import-apply-btn";
    applyBtn.disabled = true;
    applyBtn.textContent = "Aplicar reparto";
    applyBtn.style.cssText = "display:none;padding:10px 20px;border:none;background:var(--color-success,#248a3d);color:#fff;border-radius:999px;cursor:pointer;font-size:13px;font-weight:600;opacity:0.4";
    applyBtn.addEventListener("click", () => {
      const w = (
        /** @type {any} */
        window
      );
      if (typeof w.confirmRepartoImportApply === "function") w.confirmRepartoImportApply();
    });
    foot.appendChild(applyBtn);
    box.appendChild(foot);
    modal.appendChild(box);
    return modal;
  }
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1yZXBhcnRvLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLyoqXG4gKiBleHBvcnRzLXJlcGFydG8gKHYxNTE0LCAyMDI2LTEwLTI4KSBcdTIwMTQgY2h1bmsgbGF6eSBwYXJhIGVsIGZsb3cgZGUgZXhwb3J0ICtcbiAqIGltcG9ydCBFeGNlbCBkZWwgUmVwYXJ0byBkZSBpbmdyZXNvcy5cbiAqXG4gKiB2MTUxNCBcdTAwQTdUMzogVUkgcmV3b3JrIG1vZGFsICsgcHJldmlldyBGYXNlIEIuIDQgZXN0YWRvcyBtdXR1YW1lbnRlXG4gKiBleGNsdXNpdm9zIChpZGxlL3ZhbGlkYXRpbmcvcHJldmlldy1vay9lcnJvcnMpICsgZHJvcHpvbmUgZHJhZytkcm9wICtcbiAqIHJlc3VtZW4gZGUgMyBjYXJkcyAoQXNpZ25hZGFzL1Z1ZWxlQk8vRWxpbWluYWRhcykgKyB0YWJsYSA1IGNvbHVtbmFzXG4gKiAoU0tVL0NsaWVudGUvQXNpZ25hZG8vVnVlbGVCTy9FbGltaW5hZG8pICsgY29uc2lzdGVuY3kgcnVsZVxuICogKEFzaWduYWRvICsgVnVlbGVBQmFja29yZGVyICsgRWxpbWluYXIgPT0gYmFja29yZGVyQWN0dWFsKS5cbiAqXG4gKiB2MTUwNSAoYmFzZSk6IGV4cG9ydCArIGltcG9ydCBFeGNlbCBkZWwgUmVwYXJ0byBkZSBpbmdyZXNvcy5cbiAqXG4gKiBEb3MgaGFuZGxlcnMgcHJpbmNpcGFsZXMgZXhwdWVzdG9zIGEgd2luZG93OlxuICogICAtIHdpbmRvdy5leHBvcnRSZXBhcnRvTWFudWFsRXhjZWwoKSAgXHUyMDE0IHRlbXBsYXRlIGVkaXRhYmxlIGNvbiA5IGNvbHVtbmFzXG4gKiAgICAgKDcgdmlzaWJsZXMgKyAyIHRcdTAwRTljbmljYXMgYWwgZmluYWwsIGdyaXNlcyB5IHByb3RlZ2lkYXMpLlxuICogICAtIHdpbmRvdy5vcGVuUmVwYXJ0b0ltcG9ydERpYWxvZygpICAgXHUyMDE0IG1vZGFsIGNvbiA8aW5wdXQgdHlwZT1maWxlPixcbiAqICAgICBwcmV2aWV3IGRlIHZhbGlkYWNpXHUwMEYzbiwgeSBib3RcdTAwRjNuIFwiQXBsaWNhciByZXBhcnRvIGltcG9ydGFkb1wiLlxuICpcbiAqIEZ1ZW50ZSBcdTAwRkFuaWNhOiBwdXJlIGZuc1xuICogICAtIHNyYy9wdXJlL3JlcGFydG8tZXhjZWwtZXhwb3J0LXJvd3MuanMgXHUyMDE0IGFybWFkbyBkZSBmaWxhcy5cbiAqICAgLSBzcmMvcHVyZS9yZXBhcnRvLWV4Y2VsLWltcG9ydC12YWxpZGF0b3IuanMgXHUyMDE0IHZhbGlkYWNpXHUwMEYzbiBwb3IgZmlsYS5cbiAqXG4gKiBQYXlsb2FkIHNlcnZlcjogU0lFTVBSRSB2aWEgYGFwcGx5UmVwYXJ0b01hbnVhbENGYCAoY2FsbGFibGUpLiBOVU5DQVxuICogZXNjcml0dXJhIGRpcmVjdGEgYSBGaXJlc3RvcmUgKENMQVVERS5tZCBcdTAwQTc2MyBwYXR0ZXJuKS5cbiAqXG4gKiBMb2c6IGByZXBhcnRvX2xvZ2AgY29uIGBvcmlnZW49J2ltcG9ydCdgICsgZmlsZU5hbWUgKyBpbXBvcnRlZEJ5VWlkICsgLi4uXG4gKi9cblxuLyoqXG4gKiBMYXp5IGxvYWRlciBwYXJhIEV4Y2VsSlMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gX2Vuc3VyZUV4Y2VsSlMoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5sb2FkRXhjZWxKUyA9PT0gJ2Z1bmN0aW9uJykgYXdhaXQgdy5sb2FkRXhjZWxKUygpO1xuICBpZiAoIXcuRXhjZWxKUykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbEpTIG5vIGRpc3BvbmlibGUnKTtcbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gbXNnXG4gKiBAcGFyYW0ge251bWJlcn0gW21zXVxuICovXG5mdW5jdGlvbiBfc3luY1RhZyhtc2csIG1zKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5zaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICB3LnNob3dTeW5jVGFnKG1zZywgbXMpO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gc2t1XG4gKiBAcmV0dXJucyB7bnVtYmVyfVxuICovXG5mdW5jdGlvbiBfZ2V0U3RvY2tGaXNpY28oc2t1KSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIDA7XG4gIHRyeSB7XG4gICAgcmV0dXJuIE51bWJlcih3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhKHNrdSkpIHx8IDA7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbn1cblxuLyoqXG4gKiBAcmV0dXJucyB7e3NlYXJjaDogc3RyaW5nLCBoaWRlTm9TdG9jazogYm9vbGVhbn19XG4gKi9cbmZ1bmN0aW9uIF9yZWFkRmlsdHJvc01vZGFsUmVwYXJ0bygpIHtcbiAgY29uc3Qgc0VsID0gdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyA/IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLXNlYXJjaCcpIDogbnVsbDtcbiAgY29uc3QgaEVsID1cbiAgICB0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnID8gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taGlkZS1ub3N0b2NrJykgOiBudWxsO1xuICByZXR1cm4ge1xuICAgIHNlYXJjaDogc0VsID8gU3RyaW5nKC8qKiBAdHlwZSB7YW55fSAqLyAoc0VsKS52YWx1ZSB8fCAnJykudHJpbSgpIDogJycsXG4gICAgaGlkZU5vU3RvY2s6IGhFbCA/ICEhKC8qKiBAdHlwZSB7YW55fSAqLyAoaEVsKS5jaGVja2VkKSA6IHRydWUsXG4gIH07XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IGV4cG9ydEtpbmRcbiAqIEBwYXJhbSB7c3RyaW5nfSBtc2dcbiAqL1xuZnVuY3Rpb24gX2xvZ0V4cG9ydEVycm9yKGV4cG9ydEtpbmQsIG1zZykge1xuICB0cnkge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKCF3LmZiRGIgfHwgdHlwZW9mIHcuZmJEYi5jb2xsZWN0aW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm47XG4gICAgdy5mYkRiXG4gICAgICAuY29sbGVjdGlvbignb3BlcmF0aW9uc19sb2cnKVxuICAgICAgLmFkZCh7XG4gICAgICAgIHR5cGU6ICdleHBvcnRfZmFpbGVkJyxcbiAgICAgICAgZXhwb3J0S2luZCxcbiAgICAgICAgZXJyb3I6IG1zZy5zbGljZSgwLCA1MDApLFxuICAgICAgICB1c2VyVWlkOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLnVpZCkgfHwgbnVsbCxcbiAgICAgICAgdXNlckVtYWlsOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCBudWxsLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgLyogaWdub3JlICovXG4gICAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICAvKiBpZ25vcmUgKi9cbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBUlRFIDEgXHUyMDE0IEV4cG9ydCBtYW51YWwgKHRlbXBsYXRlIGVkaXRhYmxlKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5leHBvcnRSZXBhcnRvTWFudWFsRXhjZWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIHBhcmEgZXhwb3J0YXIuIEFiclx1MDBFRCBlbCBtb2RhbCBcIlJlcGFydG8gZGUgaW5ncmVzb3NcIiBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBfc3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGVkaXRhYmxlXHUyMDI2Jyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcHVyZU1vZCA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5yZXBhcnRvRXhjZWxFeHBvcnQ7XG4gICAgaWYgKCFwdXJlTW9kIHx8IHR5cGVvZiBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B1cmUgZm4gcmVwYXJ0b0V4Y2VsRXhwb3J0IG5vIGRpc3BvbmlibGUnKTtcbiAgICB9XG4gICAgY29uc3QgY29uc29saWRhdGVGbiA9XG4gICAgICB3Ll9fcGhhc2UwICYmXG4gICAgICB3Ll9fcGhhc2UwLnB1cmUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUuY29uc29saWRhdGVDbGllbnRlc0JPO1xuICAgIGNvbnN0IGZpbHRyb3MgPSBfcmVhZEZpbHRyb3NNb2RhbFJlcGFydG8oKTtcbiAgICBjb25zdCByZXN1bHQgPSBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzKGluZ3Jlc29zLCBmaWx0cm9zLCB7XG4gICAgICBnZXRTdG9ja0Zpc2ljbzogX2dldFN0b2NrRmlzaWNvLFxuICAgICAgY29uc29saWRhdGVGbjogdHlwZW9mIGNvbnNvbGlkYXRlRm4gPT09ICdmdW5jdGlvbicgPyBjb25zb2xpZGF0ZUZuIDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICAgIGlmICghcmVzdWx0LnJvd3MubGVuZ3RoKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ05vIGhheSBmaWxhcyBwYXJhIGV4cG9ydGFyIGNvbiBsb3MgZmlsdHJvcyBhY3R1YWxlcy4gTGltcGlcdTAwRTEgYlx1MDBGQXNxdWVkYSBvIGRlc3RpbGRcdTAwRTEgXCJPY3VsdGFyIHNpbiBzdG9ja1wiLidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgX2Vuc3VyZUV4Y2VsSlMoKTtcbiAgICBjb25zdCBFeGNlbEpTID0gdy5FeGNlbEpTO1xuICAgIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVwYXJ0bycpO1xuXG4gICAgd3MuY29sdW1ucyA9IFtcbiAgICAgIHsgaGVhZGVyOiAnQ29kaWdvJywga2V5OiAnQ29kaWdvJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0NsaWVudGUnLCBrZXk6ICdDbGllbnRlJywgd2lkdGg6IDM2IH0sXG4gICAgICB7IGhlYWRlcjogJ0JhY2tvcmRlcicsIGtleTogJ0JhY2tvcmRlcicsIHdpZHRoOiAxMiB9LFxuICAgICAgeyBoZWFkZXI6ICdTdG9jayBkaXNwb25pYmxlJywga2V5OiAnU3RvY2tEaXNwb25pYmxlJywgd2lkdGg6IDE1IH0sXG4gICAgICB7IGhlYWRlcjogJ0FzaWduYWRvJywga2V5OiAnQXNpZ25hZG8nLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnVnVlbHZlIGEgYmFja29yZGVyJywga2V5OiAnVnVlbGVBQmFja29yZGVyJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0VsaW1pbmFyJywga2V5OiAnRWxpbWluYXInLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnUmVwYXJ0byBJRCcsIGtleTogJ1JlcGFydG9JZCcsIHdpZHRoOiAyNCB9LFxuICAgICAgeyBoZWFkZXI6ICdDYXJkQ29kZScsIGtleTogJ0NhcmRDb2RlJywgd2lkdGg6IDE2IH0sXG4gICAgXTtcblxuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmdldFJvdygxKTtcbiAgICBoZWFkZXJSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2NjUzNCcgfSB9O1xuICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAgIGNlbGwuYm9yZGVyID0ge1xuICAgICAgICB0b3A6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIGxlZnQ6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIHJpZ2h0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9LFxuICAgICAgICBib3R0b206IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICB9O1xuICAgIH0pO1xuICAgIGhlYWRlclJvdy5oZWlnaHQgPSAyODtcbiAgICBoZWFkZXJSb3cuZ2V0Q2VsbCg4KS5maWxsID0ge1xuICAgICAgdHlwZTogJ3BhdHRlcm4nLFxuICAgICAgcGF0dGVybjogJ3NvbGlkJyxcbiAgICAgIGZnQ29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LFxuICAgIH07XG4gICAgaGVhZGVyUm93LmdldENlbGwoOSkuZmlsbCA9IHtcbiAgICAgIHR5cGU6ICdwYXR0ZXJuJyxcbiAgICAgIHBhdHRlcm46ICdzb2xpZCcsXG4gICAgICBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjg4ODg4OCcgfSxcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN1bHQucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgciA9IHJlc3VsdC5yb3dzW2ldO1xuICAgICAgLy8gdjE1MTIgKDIwMjYtMTAtMjgpOiBmaWxhIGF2aXNvIFNLVSBtdWx0aS1yZXBhcnRvIChDb2RpZ28gPT09ICcnLCBfbm90aWNlPXRydWUpLlxuICAgICAgLy8gU2UgcmVuZGVyaXphIGNvbiBmb25kbyBhbWFyaWxsbyArIHNvbG8gbGFzIGNlbGRhcyBDb2RpZ28rQ2xpZW50ZSBvY3VwYWRhcztcbiAgICAgIC8vIGltcG9ydCB2YWxpZGF0b3IgbGEgaWdub3JhIHBvciBgQ29kaWdvID09PSAnJ2AuXG4gICAgICBpZiAociAmJiAoci5fbm90aWNlID09PSB0cnVlIHx8IHIuQ29kaWdvID09PSAnJykpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgICAgICBDb2RpZ286ICcnLFxuICAgICAgICAgIENsaWVudGU6IHIuQ2xpZW50ZSB8fCAnJyxcbiAgICAgICAgICBCYWNrb3JkZXI6IG51bGwsXG4gICAgICAgICAgU3RvY2tEaXNwb25pYmxlOiBudWxsLFxuICAgICAgICAgIEFzaWduYWRvOiBudWxsLFxuICAgICAgICAgIFZ1ZWxlQUJhY2tvcmRlcjogbnVsbCxcbiAgICAgICAgICBFbGltaW5hcjogbnVsbCxcbiAgICAgICAgICBSZXBhcnRvSWQ6ICcnLFxuICAgICAgICAgIENhcmRDb2RlOiAnJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkZGRUI5OScgfSB9O1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGNzgzNTBGJyB9LCBib2xkOiB0cnVlLCBzaXplOiAxMSB9O1xuICAgICAgICAgIGNlbGwuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gICAgICAgICAgLy8gRmlsYSBhdmlzbyBibG9xdWVhZGEgKHVzZXIgbm8gcHVlZGUgZWRpdGFyIGVsIGF2aXNvKS5cbiAgICAgICAgICBjZWxsLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgICBDb2RpZ286IHIuQ29kaWdvLFxuICAgICAgICBDbGllbnRlOiByLkNsaWVudGUsXG4gICAgICAgIEJhY2tvcmRlcjogci5CYWNrb3JkZXIsXG4gICAgICAgIFN0b2NrRGlzcG9uaWJsZTogci5TdG9ja0Rpc3BvbmlibGUsXG4gICAgICAgIEFzaWduYWRvOiByLkFzaWduYWRvLFxuICAgICAgICBWdWVsZUFCYWNrb3JkZXI6IG51bGwsXG4gICAgICAgIEVsaW1pbmFyOiByLkVsaW1pbmFyLFxuICAgICAgICBSZXBhcnRvSWQ6IHIuUmVwYXJ0b0lkLFxuICAgICAgICBDYXJkQ29kZTogci5DYXJkQ29kZSxcbiAgICAgIH0pO1xuICAgICAgcm93LmdldENlbGwoNikudmFsdWUgPSB7XG4gICAgICAgIGZvcm11bGE6IHIuVnVlbGVBQmFja29yZGVyLnJlcGxhY2UoL149LywgJycpLFxuICAgICAgICByZXN1bHQ6IHIuQmFja29yZGVyIC0gci5Bc2lnbmFkbyAtIHIuRWxpbWluYXIsXG4gICAgICB9O1xuICAgICAgcm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICAgIGNlbGwuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gICAgICAgIGNlbGwuYm9yZGVyID0ge1xuICAgICAgICAgIHRvcDogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgICBsZWZ0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICAgIHJpZ2h0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICAgIGJvdHRvbTogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgICAgcm93LmdldENlbGwoOCkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkY1RjVGNScgfSB9O1xuICAgICAgcm93LmdldENlbGwoOCkuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LCBzaXplOiAxMCB9O1xuICAgICAgcm93LmdldENlbGwoOSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkY1RjVGNScgfSB9O1xuICAgICAgcm93LmdldENlbGwoOSkuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LCBzaXplOiAxMCB9O1xuICAgICAgcm93LmdldENlbGwoMSkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCgyKS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDMpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoNCkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg1KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IGZhbHNlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg2KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDcpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogZmFsc2UgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDgpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoOSkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgfVxuXG4gICAgd3Mudmlld3MgPSBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XTtcblxuICAgIC8vIHYxNTEyICgyMDI2LTEwLTI4KTogaGFiaWxpdGFyIGF1dG9maWx0cm8gKyBzb3J0IGVuIGxhIGhvamEgcHJvdGVnaWRhLlxuICAgIC8vIFBhYmxvIHJlcG9ydFx1MDBGMyBxdWUgXCJPcmRlbmFyIHkgZmlsdHJhclwiIGVuIEV4Y2VsIGRlc2t0b3AgYXBhcmVjXHUwMEVEYSBkZXNoYWJpbGl0YWRvOlxuICAgIC8vIGZhbHRhYmEgYHdzLmF1dG9GaWx0ZXJgIHF1ZSBtYXJjYSBlbCByYW5nbyBjb21vIGF1dG9maWx0ZXIgKyBgc29ydDogdHJ1ZWAgZW5cbiAgICAvLyBsYSBwcm90ZWNjaVx1MDBGM24gcGVybWl0ZSBvcmRlbmFyIGxhcyBjZWxkYXMgZGVzYmxvcXVlYWRhcyAoQXNpZ25hZG8gKyBFbGltaW5hcikuXG4gICAgLy8gTGFzIGNlbGRhcyBibG9xdWVhZGFzIChDb2RpZ28sIENsaWVudGUsIEJhY2tvcmRlciwgU3RvY2ssIFZ1ZWxlQUJPLCBSZXBhcnRvSWQsXG4gICAgLy8gQ2FyZENvZGUpIHNpZ3VlbiBibG9xdWVhZGFzOyBzb3J0IHkgZmlsdGVyIHRyYWJhamFuIHNvYnJlIGVsIGNvbmp1bnRvIGNvbXBsZXRvLlxuICAgIGNvbnN0IF9sYXN0Um93ID0gKHJlc3VsdC5yb3dzID8gcmVzdWx0LnJvd3MubGVuZ3RoIDogMCkgKyAxOyAvLyArMSBwb3IgaGVhZGVyXG4gICAgd3MuYXV0b0ZpbHRlciA9IHsgZnJvbTogeyByb3c6IDEsIGNvbHVtbjogMSB9LCB0bzogeyByb3c6IF9sYXN0Um93LCBjb2x1bW46IDkgfSB9O1xuXG4gICAgYXdhaXQgd3MucHJvdGVjdCgnJywge1xuICAgICAgc2VsZWN0TG9ja2VkQ2VsbHM6IHRydWUsXG4gICAgICBzZWxlY3RVbmxvY2tlZENlbGxzOiB0cnVlLFxuICAgICAgZm9ybWF0Q2VsbHM6IGZhbHNlLFxuICAgICAgc29ydDogdHJ1ZSwgLy8gdjE1MTI6IHBlcm1pdGUgb3JkZW5hclxuICAgICAgYXV0b0ZpbHRlcjogdHJ1ZSwgLy8gcGVybWl0ZSBmaWx0cmFyICh5YSBlc3RhYmEpXG4gICAgfSk7XG5cbiAgICBjb25zdCBmaWxlbmFtZSA9IHB1cmVNb2QuYnVpbGRSZXBhcnRvRXhjZWxGaWxlTmFtZVxuICAgICAgPyBwdXJlTW9kLmJ1aWxkUmVwYXJ0b0V4Y2VsRmlsZU5hbWUobmV3IERhdGUoKSlcbiAgICAgIDogJ1JlcGFydG9fJyArXG4gICAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgK1xuICAgICAgICAnXycgK1xuICAgICAgICBuZXcgRGF0ZSgpLnRvVGltZVN0cmluZygpLnNsaWNlKDAsIDUpLnJlcGxhY2UoJzonLCAnJykgK1xuICAgICAgICAnLnhsc3gnO1xuXG4gICAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBhLnJlbW92ZSgpO1xuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcblxuICAgIF9zeW5jVGFnKFxuICAgICAgJ0V4Y2VsIGVkaXRhYmxlIGxpc3RvICgnICsgcmVzdWx0LnJvd3MubGVuZ3RoICsgJyBmaWxhcyBcdTAwQjcgJyArIHJlc3VsdC50b3RhbEJhY2tvcmRlciArICd1IEJPKScsXG4gICAgICAzMjAwXG4gICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IChlICYmIC8qKiBAdHlwZSB7YW55fSAqLyAoZSkubWVzc2FnZSkgfHwgU3RyaW5nKGUpO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1t2MTUwNSBcdTAwQTdSZXBhcnRvXSBleHBvcnRSZXBhcnRvTWFudWFsRXhjZWwgZmFsbFx1MDBGMzonLCBlKTtcbiAgICBhbGVydCgnTm8gcHVkaW1vcyBnZW5lcmFyIGVsIEV4Y2VsIGVkaXRhYmxlLiBWb2x2XHUwMEU5IGEgaW50ZW50YXI7IHNpIHNpZ3VlLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICBfbG9nRXhwb3J0RXJyb3IoJ2V4cG9ydF9tYW51YWwnLCBtc2cpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBUlRFIDIgXHUyMDE0IEltcG9ydCBFeGNlbFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmxldCBfaW1wb3J0U3RhdGUgPSAvKiogQHR5cGUge251bGwgfCB7XG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHJlY29ub2NpZGFzOiBBcnJheTxhbnk+LFxuICBjb25DYW1iaW9zOiBBcnJheTxhbnk+LFxuICBlcnJvcmVzOiBBcnJheTxhbnk+LFxuICB0b3RhbEZpbGFzOiBudW1iZXIsXG4gIHRvdGFsQXNpZ25hZG86IG51bWJlcixcbiAgdG90YWxFbGltaW5hcjogbnVtYmVyLFxufX0gKi8gKG51bGwpO1xuXG4vKipcbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5mdW5jdGlvbiBfaXNBZG1pbkxpa2VGb3JJbXBvcnQoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IHJvbGUgPSAody51c2VyUm9sZSB8fCAnJykudG9Mb3dlckNhc2UoKTtcbiAgaWYgKHJvbGUgPT09ICdhZG1pbicgfHwgcm9sZSA9PT0gJ2dlcmVudGUnKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgZW1haWwgPSBTdHJpbmcoKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGlmIChlbWFpbCA9PT0gJ3BhYmxvLmdvbnphbGV6QHNoaW1hbm8uY29tLmFyJyB8fCBlbWFpbCA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJykgcmV0dXJuIHRydWU7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiB2MTUxNCBcdTAwQTdUMzogYWx0ZXJuYSBlbCBlc3RhZG8gdmlzaWJsZSBkZWwgbW9kYWwuXG4gKiBAcGFyYW0geygnaWRsZSd8J3ZhbGlkYXRpbmcnfCdwcmV2aWV3LW9rJ3wnZXJyb3JzJyl9IHN0YXRlXG4gKi9cbmZ1bmN0aW9uIF9zZXRJbXBvcnRNb2RhbFN0YXRlKHN0YXRlKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHJldHVybjtcbiAgLyoqIEB0eXBlIHthbnl9ICovIChtb2RhbCkuc2V0QXR0cmlidXRlKCdkYXRhLXN0YXRlJywgc3RhdGUpO1xuICBjb25zdCBpZHMgPSB7XG4gICAgaWRsZTogJ3JlcGFydG8taW1wb3J0LWRyb3B6b25lJyxcbiAgICB2YWxpZGF0aW5nOiAncmVwYXJ0by1pbXBvcnQtdmFsaWRhdGluZycsXG4gICAgJ3ByZXZpZXctb2snOiAncmVwYXJ0by1pbXBvcnQtcHJldmlldy1vaycsXG4gICAgZXJyb3JzOiAncmVwYXJ0by1pbXBvcnQtZXJyb3JzJyxcbiAgfTtcbiAgZm9yIChjb25zdCBbc3QsIGlkXSBvZiBPYmplY3QuZW50cmllcyhpZHMpKSB7XG4gICAgY29uc3QgZWwgPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjJyArIGlkKTtcbiAgICBpZiAoIWVsKSBjb250aW51ZTtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGVsKS5zdHlsZS5kaXNwbGF5ID0gc3QgPT09IHN0YXRlID8gJ2ZsZXgnIDogJ25vbmUnO1xuICB9XG4gIC8vIEFwcGx5IGJ0biB2aXNpYmxlIHNvbG8gZW4gcHJldmlldy1vay5cbiAgY29uc3QgYXBwbHlCdG4gPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmIChhcHBseUJ0bikge1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLmRpc3BsYXkgPSBzdGF0ZSA9PT0gJ3ByZXZpZXctb2snID8gJ2lubGluZS1ibG9jaycgOiAnbm9uZSc7XG4gIH1cbn1cblxud2luZG93Lm9wZW5SZXBhcnRvSW1wb3J0RGlhbG9nID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIV9pc0FkbWluTGlrZUZvckltcG9ydCgpKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGltcG9ydGFyIHJlcGFydG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIGFjdGl2b3MuIEFiclx1MDBFRCBlbCBtb2RhbCBSZXBhcnRvIHByaW1lcm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSB7XG4gICAgbW9kYWwgPSBfYnVpbGRJbXBvcnRNb2RhbERvbSgpO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobW9kYWwpO1xuICB9XG4gIF9pbXBvcnRTdGF0ZSA9IG51bGw7XG4gIC8vIFJlc2V0IHByZXZpZXdzLlxuICBjb25zdCBva0VsID0gbW9kYWwucXVlcnlTZWxlY3RvcignI3JlcGFydG8taW1wb3J0LXByZXZpZXctb2snKTtcbiAgaWYgKG9rRWwpIHtcbiAgICB3aGlsZSAob2tFbC5maXJzdENoaWxkKSBva0VsLnJlbW92ZUNoaWxkKG9rRWwuZmlyc3RDaGlsZCk7XG4gIH1cbiAgY29uc3QgZXJyRWwgPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1pbXBvcnQtZXJyb3JzJyk7XG4gIGlmIChlcnJFbCkge1xuICAgIHdoaWxlIChlcnJFbC5maXJzdENoaWxkKSBlcnJFbC5yZW1vdmVDaGlsZChlcnJFbC5maXJzdENoaWxkKTtcbiAgfVxuICBjb25zdCBhcHBseUJ0biA9IG1vZGFsLnF1ZXJ5U2VsZWN0b3IoJyNyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nKTtcbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgLyoqIEB0eXBlIHthbnl9ICovIChhcHBseUJ0bikuZGlzYWJsZWQgPSB0cnVlO1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLm9wYWNpdHkgPSAnMC40JztcbiAgfVxuICBjb25zdCBmaWxlSW5wdXQgPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1pbXBvcnQtZmlsZScpO1xuICBpZiAoZmlsZUlucHV0KSAvKiogQHR5cGUge2FueX0gKi8gKGZpbGVJbnB1dCkudmFsdWUgPSAnJztcbiAgX3NldEltcG9ydE1vZGFsU3RhdGUoJ2lkbGUnKTtcbiAgLyoqIEB0eXBlIHthbnl9ICovIChtb2RhbCkuc3R5bGUuZGlzcGxheSA9ICdmbGV4Jztcbn07XG5cbndpbmRvdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgLyoqIEB0eXBlIHthbnl9ICovIChtb2RhbCkuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgX2ltcG9ydFN0YXRlID0gbnVsbDtcbn07XG5cbi8qKlxuICogQHBhcmFtIHtFdmVudH0gZXZcbiAqL1xud2luZG93LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlID0gYXN5bmMgZnVuY3Rpb24gKGV2KSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IHRndCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGV2LnRhcmdldCk7XG4gIGNvbnN0IGZpbGUgPSB0Z3QgJiYgdGd0LmZpbGVzICYmIHRndC5maWxlc1swXTtcbiAgaWYgKCFmaWxlKSByZXR1cm47XG4gIGNvbnN0IGFwcGx5QnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bicpO1xuICBpZiAoYXBwbHlCdG4pIHtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5kaXNhYmxlZCA9IHRydWU7XG4gICAgLyoqIEB0eXBlIHthbnl9ICovIChhcHBseUJ0bikuc3R5bGUub3BhY2l0eSA9ICcwLjQnO1xuICB9XG4gIC8vIHYxNTE0IFx1MDBBN1QzOiBlc3RhZG8gdmFsaWRhdGluZyBjb24gc3Bpbm5lci5cbiAgX3NldEltcG9ydE1vZGFsU3RhdGUoJ3ZhbGlkYXRpbmcnKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfZW5zdXJlRXhjZWxKUygpO1xuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcbiAgICBjb25zdCB3YiA9IG5ldyB3LkV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBhd2FpdCB3Yi54bHN4LmxvYWQoYnVmKTtcbiAgICBjb25zdCB3cyA9IHdiLndvcmtzaGVldHNbMF07XG4gICAgaWYgKCF3cykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBzaW4gaG9qYXMnKTtcblxuICAgIGNvbnN0IGhlYWRlck1hcCA9IF9idWlsZEhlYWRlck1hcCh3cyk7XG4gICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICB3cy5lYWNoUm93KChyb3csIHJuKSA9PiB7XG4gICAgICBpZiAocm4gPT09IDEpIHJldHVybjtcbiAgICAgIC8qKiBAdHlwZSB7YW55fSAqL1xuICAgICAgY29uc3Qgb2JqID0geyBfX3Jvd0luZGV4OiBybiB9O1xuICAgICAgcm93LmVhY2hDZWxsKHsgaW5jbHVkZUVtcHR5OiB0cnVlIH0sIChjZWxsLCBjb2xJZHgpID0+IHtcbiAgICAgICAgY29uc3QgY2Fub25LZXkgPSBoZWFkZXJNYXBbY29sSWR4XTtcbiAgICAgICAgaWYgKCFjYW5vbktleSkgcmV0dXJuO1xuICAgICAgICBsZXQgdiA9IGNlbGwudmFsdWU7XG4gICAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAndGV4dCcgaW4gdikgdiA9IHYudGV4dDtcbiAgICAgICAgaWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICdyZXN1bHQnIGluIHYpIHYgPSB2LnJlc3VsdDtcbiAgICAgICAgb2JqW2Nhbm9uS2V5XSA9IHY7XG4gICAgICB9KTtcbiAgICAgIGlmICghb2JqLlJlcGFydG9JZCAmJiAhb2JqLkNhcmRDb2RlICYmICFvYmouQ29kaWdvKSByZXR1cm47XG4gICAgICByb3dzLnB1c2gob2JqKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gICAgY29uc3QgcmVwYXJ0b3NBY3Rpdm9zID0gaW5ncmVzb3MubWFwKCgvKiogQHR5cGUge2FueX0gKi8gaSkgPT4gKHtcbiAgICAgIF9pZDogaS5faWQsXG4gICAgICBza3U6IGkuc2t1LFxuICAgICAgc3RhdHVzOiBpLnN0YXR1cyB8fCAncGVuZGluZycsXG4gICAgICBzdG9ja0Rpc3BvbmlibGU6IF9nZXRTdG9ja0Zpc2ljbyhpLnNrdSksXG4gICAgICBjbGllbnRlc0JPOiBBcnJheS5pc0FycmF5KGkuY2xpZW50ZXNCTykgPyBpLmNsaWVudGVzQk8gOiBbXSxcbiAgICB9KSk7XG5cbiAgICBjb25zdCB2YWxpZGF0b3IgPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0V4Y2VsSW1wb3J0O1xuICAgIGlmICghdmFsaWRhdG9yIHx8IHR5cGVvZiB2YWxpZGF0b3IudmFsaWRhdGVSZXBhcnRvRXhjZWxJbXBvcnQgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigncHVyZSBmbiByZXBhcnRvRXhjZWxJbXBvcnQgbm8gZGlzcG9uaWJsZScpO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSB2YWxpZGF0b3IudmFsaWRhdGVSZXBhcnRvRXhjZWxJbXBvcnQocm93cywgcmVwYXJ0b3NBY3Rpdm9zKTtcbiAgICBfaW1wb3J0U3RhdGUgPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZS5uYW1lLFxuICAgICAgcmVjb25vY2lkYXM6IHJlc3VsdC5yZWNvbm9jaWRhcyxcbiAgICAgIGNvbkNhbWJpb3M6IHJlc3VsdC5jb25DYW1iaW9zLFxuICAgICAgZXJyb3JlczogcmVzdWx0LmVycm9yZXMsXG4gICAgICB0b3RhbEZpbGFzOiByZXN1bHQudG90YWxGaWxhcyxcbiAgICAgIHRvdGFsQXNpZ25hZG86IHJlc3VsdC50b3RhbEFzaWduYWRvLFxuICAgICAgdG90YWxFbGltaW5hcjogcmVzdWx0LnRvdGFsRWxpbWluYXIsXG4gICAgfTtcbiAgICBfcmVuZGVySW1wb3J0UHJldmlldygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gKGUgJiYgLyoqIEB0eXBlIHthbnl9ICovIChlKS5tZXNzYWdlKSB8fCBTdHJpbmcoZSk7XG4gICAgY29uc29sZS5lcnJvcignW3YxNTA1IFx1MDBBN1JlcGFydG9dIGhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlIGVycm9yOicsIGUpO1xuICAgIC8vIHYxNTE0IFx1MDBBN1QzOiBtb3N0cmFyIGVycm9yIGRlIGxlY3R1cmEgZW4gZWwgZXN0YWRvIFwiZXJyb3JzXCIuXG4gICAgY29uc3QgZXJyQm94RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtZXJyb3JzJyk7XG4gICAgaWYgKGVyckJveEVsKSB7XG4gICAgICB3aGlsZSAoZXJyQm94RWwuZmlyc3RDaGlsZCkgZXJyQm94RWwucmVtb3ZlQ2hpbGQoZXJyQm94RWwuZmlyc3RDaGlsZCk7XG4gICAgICBjb25zdCBlcnJEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgIGVyckRpdi5zdHlsZS5jc3NUZXh0ID1cbiAgICAgICAgJ2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSwjYzczNzJmKTtwYWRkaW5nOjE0cHg7YmFja2dyb3VuZDp2YXIoLS1jb2xvci1kYW5nZXItYmcscmdiYSgyNTUsNTksNDgsLjA4KSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkIHZhcigtLWNvbG9yLWRhbmdlciwjYzczNzJmKTtib3JkZXItcmFkaXVzOjhweDt3aWR0aDoxMDAlJztcbiAgICAgIGNvbnN0IHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgIHQuc3R5bGUuY3NzVGV4dCA9ICdmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbTo2cHgnO1xuICAgICAgdC50ZXh0Q29udGVudCA9ICdObyBzZSBwdWRvIGxlZXIgZWwgRXhjZWwnO1xuICAgICAgY29uc3QgZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgZC5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxMi41cHg7bGluZS1oZWlnaHQ6MS41JztcbiAgICAgIGQudGV4dENvbnRlbnQgPSBtc2c7XG4gICAgICBlcnJEaXYuYXBwZW5kQ2hpbGQodCk7XG4gICAgICBlcnJEaXYuYXBwZW5kQ2hpbGQoZCk7XG4gICAgICBlcnJCb3hFbC5hcHBlbmRDaGlsZChlcnJEaXYpO1xuICAgIH1cbiAgICBfc2V0SW1wb3J0TW9kYWxTdGF0ZSgnZXJyb3JzJyk7XG4gICAgX2xvZ0V4cG9ydEVycm9yKCdpbXBvcnRfcmVhZCcsIG1zZyk7XG4gIH1cbn07XG5cbi8qKlxuICogQHBhcmFtIHthbnl9IHdzXG4gKiBAcmV0dXJucyB7T2JqZWN0PG51bWJlcixzdHJpbmc+fVxuICovXG5mdW5jdGlvbiBfYnVpbGRIZWFkZXJNYXAod3MpIHtcbiAgLyoqIEB0eXBlIHtPYmplY3Q8bnVtYmVyLHN0cmluZz59ICovXG4gIGNvbnN0IG91dCA9IHt9O1xuICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMSk7XG4gIGhlYWRlclJvdy5lYWNoQ2VsbChcbiAgICB7IGluY2x1ZGVFbXB0eTogZmFsc2UgfSxcbiAgICAoLyoqIEB0eXBlIHthbnl9ICovIGNlbGwsIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyBjb2wpID0+IHtcbiAgICAgIGxldCB2ID0gY2VsbC52YWx1ZTtcbiAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAndGV4dCcgaW4gdikgdiA9IHYudGV4dDtcbiAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAncmVzdWx0JyBpbiB2KSB2ID0gdi5yZXN1bHQ7XG4gICAgICBjb25zdCBsYWJlbCA9IFN0cmluZyh2IHx8ICcnKVxuICAgICAgICAudHJpbSgpXG4gICAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKCFsYWJlbCkgcmV0dXJuO1xuICAgICAgaWYgKGxhYmVsID09PSAnY29kaWdvJyB8fCBsYWJlbCA9PT0gJ2NcdTAwRjNkaWdvJykgb3V0W2NvbF0gPSAnQ29kaWdvJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnY2xpZW50ZScpIG91dFtjb2xdID0gJ0NsaWVudGUnO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdiYWNrb3JkZXInKSBvdXRbY29sXSA9ICdCYWNrb3JkZXInO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdzdG9jayBkaXNwb25pYmxlJyB8fCBsYWJlbCA9PT0gJ3N0b2NrX2Rpc3BvbmlibGUnKVxuICAgICAgICBvdXRbY29sXSA9ICdTdG9ja0Rpc3BvbmlibGUnO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdhc2lnbmFkbycpIG91dFtjb2xdID0gJ0FzaWduYWRvJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAndnVlbHZlIGEgYmFja29yZGVyJykgb3V0W2NvbF0gPSAnVnVlbGVBQmFja29yZGVyJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnZWxpbWluYXInKSBvdXRbY29sXSA9ICdFbGltaW5hcic7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ3JlcGFydG8gaWQnIHx8IGxhYmVsID09PSAncmVwYXJ0b2lkJyB8fCBsYWJlbCA9PT0gJ3JlcGFydG9faWQnKVxuICAgICAgICBvdXRbY29sXSA9ICdSZXBhcnRvSWQnO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdjYXJkY29kZScgfHwgbGFiZWwgPT09ICdjYXJkIGNvZGUnIHx8IGxhYmVsID09PSAnY2FyZF9jb2RlJylcbiAgICAgICAgb3V0W2NvbF0gPSAnQ2FyZENvZGUnO1xuICAgIH1cbiAgKTtcbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDcmVhIHVuIGRpdiBjb24gY2xhc3Mvc3R5bGUvdGV4dCBzZWd1cm9zLlxuICogQHBhcmFtIHtzdHJpbmd9IHN0eWxlQ3NzXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IHRleHRWYWx1ZVxuICogQHJldHVybnMge0hUTUxEaXZFbGVtZW50fVxuICovXG5mdW5jdGlvbiBfbWtEaXYoc3R5bGVDc3MsIHRleHRWYWx1ZSkge1xuICBjb25zdCBkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGQuc3R5bGUuY3NzVGV4dCA9IHN0eWxlQ3NzO1xuICBpZiAodGV4dFZhbHVlICE9IG51bGwpIGQudGV4dENvbnRlbnQgPSB0ZXh0VmFsdWU7XG4gIHJldHVybiBkO1xufVxuXG4vKipcbiAqIHYxNTE0IFx1MDBBN1QzOiBhcGxpY2EgbGEgY29uc2lzdGVuY3kgcnVsZSBwb3IgZmlsYS5cbiAqIGBBc2lnbmFkbyArIFZ1ZWxlQUJhY2tvcmRlciArIEVsaW1pbmFyID09IGJhY2tvcmRlckFjdHVhbGAgKGJhY2tvcmRlciBxdWVcbiAqIHZpZW5lIGRlbCBFeGNlbCwgZXF1aXZhbGUgYSBgYmFja29yZGVyQWN0dWFsYCBkZWwgbWF0Y2gpLlxuICogQHBhcmFtIHtBcnJheTxhbnk+fSByZWNvbm9jaWRhc1xuICogQHJldHVybnMge0FycmF5PHtyb3dJbmRleDpudW1iZXIsIHNrdTpzdHJpbmcsIGNsaWVudGU6c3RyaW5nLCBtc2c6c3RyaW5nfT59XG4gKi9cbmZ1bmN0aW9uIF9jb21wdXRlQ29uc2lzdGVuY3lFcnJvcnMocmVjb25vY2lkYXMpIHtcbiAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICBjb25zdCBvdXQgPSBbXTtcbiAgZm9yIChjb25zdCByIG9mIHJlY29ub2NpZGFzIHx8IFtdKSB7XG4gICAgaWYgKCFyKSBjb250aW51ZTtcbiAgICBjb25zdCBhc2lnID0gTnVtYmVyKHIuYXNpZ25hZG9OdWV2bykgfHwgMDtcbiAgICBjb25zdCBlbGltID0gTnVtYmVyKHIuZWxpbWluYXJOdWV2bykgfHwgMDtcbiAgICBjb25zdCBibyA9IE51bWJlcihyLmJhY2tvcmRlckFjdHVhbCkgfHwgMDtcbiAgICBjb25zdCB2dWVsdmUgPSBibyAtIGFzaWcgLSBlbGltO1xuICAgIGlmICh2dWVsdmUgPCAwKSB7XG4gICAgICBvdXQucHVzaCh7XG4gICAgICAgIHJvd0luZGV4OiByLnJvd0luZGV4IHx8IDAsXG4gICAgICAgIHNrdTogci5za3UgfHwgJycsXG4gICAgICAgIGNsaWVudGU6IHIuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgbXNnOlxuICAgICAgICAgICdGaWxhICcgK1xuICAgICAgICAgIChyLnJvd0luZGV4IHx8IDApICtcbiAgICAgICAgICAnIFx1MDBCNyAnICtcbiAgICAgICAgICAoci5za3UgfHwgJz8nKSArXG4gICAgICAgICAgJyAvICcgK1xuICAgICAgICAgIChyLmNsaWVudE5hbWUgfHwgJz8nKSArXG4gICAgICAgICAgJzogQXNpZ25hZG8oJyArXG4gICAgICAgICAgYXNpZyArXG4gICAgICAgICAgJykgKyBFbGltaW5hcignICtcbiAgICAgICAgICBlbGltICtcbiAgICAgICAgICAnKSBzdXBlcmEgQmFja29yZGVyKCcgK1xuICAgICAgICAgIGJvICtcbiAgICAgICAgICAnKS4gUmV2aXNcdTAwRTEgbGFzIHVuaWRhZGVzLicsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiB2MTUxNCBcdTAwQTdUMzogcmVuZGVyIGNvbiAzIGNhcmRzIGdyYW5kZXMgKyB0YWJsYSA1IGNvbHMgKyBlc3RhZG8gXHUwMEZBbmljby5cbiAqIFJldXNhIGBfaW1wb3J0U3RhdGVgLiBBZ3JlZ2EgY29uc2lzdGVuY3kgcnVsZSBhIGxvcyBlcnJvcmVzIGRlbCB2YWxpZGF0b3IuXG4gKi9cbmZ1bmN0aW9uIF9yZW5kZXJJbXBvcnRQcmV2aWV3KCkge1xuICBjb25zdCBhcHBseUJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nKTtcbiAgaWYgKCFfaW1wb3J0U3RhdGUpIHJldHVybjtcbiAgY29uc3QgcyA9IF9pbXBvcnRTdGF0ZTtcblxuICAvLyBUb3RhbGVzIGRlbCByZXN1bWVuIGRlIDMgY2FyZHM6XG4gIC8vICAgQXNpZ25hZGFzICA9IHN1bSBhc2lnbmFkb051ZXZvICh5YSBlbiBzLnRvdGFsQXNpZ25hZG8pLlxuICAvLyAgIEVsaW1pbmFkYXMgPSBzdW0gZWxpbWluYXJOdWV2byAoeWEgZW4gcy50b3RhbEVsaW1pbmFyKS5cbiAgLy8gICBWdWVsZUJPICAgID0gc3VtIG1heCgwLCBiYWNrb3JkZXJBY3R1YWwgLSBhc2lnbmFkbyAtIGVsaW1pbmFyKSBzb2JyZSByZWNvbm9jaWRhcyBjb24gY2FtYmlvcy5cbiAgbGV0IHRvdGFsVnVlbGVCTyA9IDA7XG4gIGZvciAoY29uc3QgciBvZiBzLmNvbkNhbWJpb3MgfHwgW10pIHtcbiAgICBjb25zdCBibyA9IE51bWJlcihyLmJhY2tvcmRlckFjdHVhbCkgfHwgMDtcbiAgICBjb25zdCBhc2lnID0gTnVtYmVyKHIuYXNpZ25hZG9OdWV2bykgfHwgMDtcbiAgICBjb25zdCBlbGltID0gTnVtYmVyKHIuZWxpbWluYXJOdWV2bykgfHwgMDtcbiAgICBjb25zdCBkaWZmID0gYm8gLSBhc2lnIC0gZWxpbTtcbiAgICBpZiAoZGlmZiA+IDApIHRvdGFsVnVlbGVCTyArPSBkaWZmO1xuICB9XG5cbiAgLy8gQ29uc2lzdGVuY3kgcnVsZSAocG9zdC12YWxpZGF0b3IpLiBTaSB1bmEgZmlsYSB0aWVuZSBkaWZmPDAsIHNlIHN1bWEgY29tbyBlcnJvci5cbiAgY29uc3QgY29uc2lzdGVuY3lFcnJvcnMgPSBfY29tcHV0ZUNvbnNpc3RlbmN5RXJyb3JzKHMucmVjb25vY2lkYXMpO1xuICBjb25zdCBhbGxFcnJvcnMgPSAocy5lcnJvcmVzIHx8IFtdKS5jb25jYXQoXG4gICAgY29uc2lzdGVuY3lFcnJvcnMubWFwKChjKSA9PiAoe1xuICAgICAgcm93SW5kZXg6IGMucm93SW5kZXgsXG4gICAgICB0eXBlOiAnY29uc2lzdGVuY3lfcnVsZScsXG4gICAgICBtc2c6IGMubXNnLFxuICAgICAgc2t1OiBjLnNrdSxcbiAgICAgIGNsaWVudGU6IGMuY2xpZW50ZSxcbiAgICB9KSlcbiAgKTtcblxuICAvLyBTaSBoYXkgZXJyb3JlcyBcdTIxOTIgZXN0YWRvICdlcnJvcnMnLiBTaSBubyBcdTIxOTIgZXN0YWRvICdwcmV2aWV3LW9rJy5cbiAgaWYgKGFsbEVycm9ycy5sZW5ndGgpIHtcbiAgICBfcmVuZGVyRXJyb3JzU3RhdGUoYWxsRXJyb3JzKTtcbiAgICBfc2V0SW1wb3J0TW9kYWxTdGF0ZSgnZXJyb3JzJyk7XG4gICAgaWYgKGFwcGx5QnRuKSB7XG4gICAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5kaXNhYmxlZCA9IHRydWU7XG4gICAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5zdHlsZS5vcGFjaXR5ID0gJzAuNCc7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuXG4gIF9yZW5kZXJQcmV2aWV3T2tTdGF0ZSh7XG4gICAgdG90YWxBc2lnbmFkYXM6IHMudG90YWxBc2lnbmFkbyB8fCAwLFxuICAgIHRvdGFsVnVlbGVCTyxcbiAgICB0b3RhbEVsaW1pbmFkYXM6IHMudG90YWxFbGltaW5hciB8fCAwLFxuICAgIHJlY29ub2NpZGFzOiBzLnJlY29ub2NpZGFzIHx8IFtdLFxuICB9KTtcbiAgX3NldEltcG9ydE1vZGFsU3RhdGUoJ3ByZXZpZXctb2snKTtcblxuICBpZiAoYXBwbHlCdG4pIHtcbiAgICBjb25zdCBjYW5BcHBseSA9IHMuY29uQ2FtYmlvcy5sZW5ndGggPiAwO1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gIWNhbkFwcGx5O1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLm9wYWNpdHkgPSBjYW5BcHBseSA/ICcxJyA6ICcwLjQnO1xuICB9XG59XG5cbi8qKlxuICogUmVuZGVyIGVzdGFkbyBcInByZXZpZXctb2tcIjogMyBjYXJkcyBncmFuZGVzICsgdGFibGEgNSBjb2x1bW5hcy5cbiAqIEBwYXJhbSB7e3RvdGFsQXNpZ25hZGFzOm51bWJlcix0b3RhbFZ1ZWxlQk86bnVtYmVyLHRvdGFsRWxpbWluYWRhczpudW1iZXIscmVjb25vY2lkYXM6QXJyYXk8YW55Pn19IGRhdGFcbiAqL1xuZnVuY3Rpb24gX3JlbmRlclByZXZpZXdPa1N0YXRlKGRhdGEpIHtcbiAgY29uc3Qgb2tFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1wcmV2aWV3LW9rJyk7XG4gIGlmICghb2tFbCkgcmV0dXJuO1xuICB3aGlsZSAob2tFbC5maXJzdENoaWxkKSBva0VsLnJlbW92ZUNoaWxkKG9rRWwuZmlyc3RDaGlsZCk7XG5cbiAgLy8gQ2FyZHMgZGUgcmVzdW1lbiAoMyBncmFuZGVzIGNlbnRyYWRhcykuXG4gIGNvbnN0IGNhcmRzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGNhcmRzLnN0eWxlLmNzc1RleHQgPVxuICAgICdkaXNwbGF5OmZsZXg7Z2FwOjE0cHg7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlcjttYXJnaW4tYm90dG9tOjE4cHg7d2lkdGg6MTAwJSc7XG5cbiAgLyoqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCBAcGFyYW0ge251bWJlcn0gbiBAcGFyYW0ge3N0cmluZ30gYmcgQHBhcmFtIHtzdHJpbmd9IGZnICovXG4gIGNvbnN0IG1rQ2FyZCA9IChsYWJlbCwgbiwgYmcsIGZnKSA9PiB7XG4gICAgY29uc3QgYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIGMuc3R5bGUuY3NzVGV4dCA9XG4gICAgICAnZmxleDoxIDEgMTYwcHg7bWluLXdpZHRoOjE2MHB4O21heC13aWR0aDoyMjBweDtwYWRkaW5nOjE4cHggMTRweDsnICtcbiAgICAgICdiYWNrZ3JvdW5kOicgK1xuICAgICAgYmcgK1xuICAgICAgJztib3JkZXItcmFkaXVzOjEycHg7Y29sb3I6JyArXG4gICAgICBmZyArXG4gICAgICAnO3RleHQtYWxpZ246Y2VudGVyJztcbiAgICBjb25zdCBsYmwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBsYmwuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtvcGFjaXR5Oi44NSc7XG4gICAgbGJsLnRleHRDb250ZW50ID0gbGFiZWw7XG4gICAgY29uc3QgbnVtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgbnVtLnN0eWxlLmNzc1RleHQgPSAnZm9udC1zaXplOjM4cHg7Zm9udC13ZWlnaHQ6ODAwO21hcmdpbi10b3A6NnB4O2xpbmUtaGVpZ2h0OjEnO1xuICAgIG51bS50ZXh0Q29udGVudCA9IFN0cmluZyhuKTtcbiAgICBjLmFwcGVuZENoaWxkKGxibCk7XG4gICAgYy5hcHBlbmRDaGlsZChudW0pO1xuICAgIHJldHVybiBjO1xuICB9O1xuXG4gIGNhcmRzLmFwcGVuZENoaWxkKFxuICAgIG1rQ2FyZChcbiAgICAgICdBc2lnbmFkYXMnLFxuICAgICAgZGF0YS50b3RhbEFzaWduYWRhcyxcbiAgICAgICd2YXIoLS1jb2xvci1zdWNjZXNzLWJnLHJnYmEoNTIsMTk5LDg5LC4xNCkpJyxcbiAgICAgICd2YXIoLS1jb2xvci1zdWNjZXNzLCMyNDhhM2QpJ1xuICAgIClcbiAgKTtcbiAgY2FyZHMuYXBwZW5kQ2hpbGQoXG4gICAgbWtDYXJkKFxuICAgICAgJ1Z1ZWx2ZSBhIEJPJyxcbiAgICAgIGRhdGEudG90YWxWdWVsZUJPLFxuICAgICAgJ3ZhcigtLWNvbG9yLXdhcm5pbmctYmcscmdiYSgyNTUsMjA0LDAsLjE0KSknLFxuICAgICAgJ3ZhcigtLWNvbG9yLXdhcm5pbmcsIzhhNmQwMCknXG4gICAgKVxuICApO1xuICBjYXJkcy5hcHBlbmRDaGlsZChcbiAgICBta0NhcmQoXG4gICAgICAnRWxpbWluYWRhcycsXG4gICAgICBkYXRhLnRvdGFsRWxpbWluYWRhcyxcbiAgICAgICd2YXIoLS1jb2xvci1kYW5nZXItYmcscmdiYSgyNTUsNTksNDgsLjE0KSknLFxuICAgICAgJ3ZhcigtLWNvbG9yLWRhbmdlciwjYzczNzJmKSdcbiAgICApXG4gICk7XG4gIG9rRWwuYXBwZW5kQ2hpbGQoY2FyZHMpO1xuXG4gIC8vIFRhYmxhIDUgY29sdW1uYXM6IFNLVSBcdTAwQjcgQ2xpZW50ZSBcdTAwQjcgQXNpZ25hZG8gXHUwMEI3IFZ1ZWxlQk8gXHUwMEI3IEVsaW1pbmFkby5cbiAgY29uc3QgdGFibGVXcmFwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHRhYmxlV3JhcC5zdHlsZS5jc3NUZXh0ID1cbiAgICAnd2lkdGg6MTAwJTttYXgtaGVpZ2h0OjM2MHB4O292ZXJmbG93LXk6YXV0bztvdmVyc2Nyb2xsLWJlaGF2aW9yOmNvbnRhaW4nO1xuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RhYmxlJyk7XG4gIHRhYmxlLnN0eWxlLmNzc1RleHQgPSAnd2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEzcHgnO1xuICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoZWFkJyk7XG4gIGNvbnN0IHRyaCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gIHRyaC5zdHlsZS5jc3NUZXh0ID0gJ2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5LCNmNWY1ZjcpO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDt6LWluZGV4OjEnO1xuICBmb3IgKGNvbnN0IGggb2YgWydTS1UnLCAnQ2xpZW50ZScsICdBc2lnbmFkbycsICdWdWVsdmUgYSBCTycsICdFbGltaW5hZG8nXSkge1xuICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcbiAgICB0aC5zdHlsZS5jc3NUZXh0ID1cbiAgICAgICdwYWRkaW5nOjhweDt0ZXh0LWFsaWduOicgK1xuICAgICAgKGggPT09ICdTS1UnIHx8IGggPT09ICdDbGllbnRlJyA/ICdsZWZ0JyA6ICdyaWdodCcpICtcbiAgICAgICc7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5LCMxZDFkMWYpO2ZvbnQtd2VpZ2h0OjYwMCc7XG4gICAgdGgudGV4dENvbnRlbnQgPSBoO1xuICAgIHRyaC5hcHBlbmRDaGlsZCh0aCk7XG4gIH1cbiAgdGhlYWQuYXBwZW5kQ2hpbGQodHJoKTtcbiAgdGFibGUuYXBwZW5kQ2hpbGQodGhlYWQpO1xuICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3Rib2R5Jyk7XG4gIC8vIE1vc3RyYXIgVE9EQVMgbGFzIHJlY29ub2NpZGFzIChjb24geSBzaW4gY2FtYmlvcykgcGFyYSBxdWUgZWwgcHJldmlldyBzZWFcbiAgLy8gZmllbCBhbCBFeGNlbC4gVnVlbGVCTyBwZXItZmlsYSA9IG1heCgwLCBibyAtIGFzaWcgLSBlbGltKS5cbiAgY29uc3Qgcm93c1RvU2hvdyA9IChkYXRhLnJlY29ub2NpZGFzIHx8IFtdKS5zbGljZSgwLCAyMDApO1xuICBmb3IgKGNvbnN0IHIgb2Ygcm93c1RvU2hvdykge1xuICAgIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgICB0ci5zdHlsZS5jc3NUZXh0ID0gJ2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1jb2xvciwjZWVlKSc7XG4gICAgY29uc3QgYm8gPSBOdW1iZXIoci5iYWNrb3JkZXJBY3R1YWwpIHx8IDA7XG4gICAgY29uc3QgYXNpZyA9IE51bWJlcihyLmFzaWduYWRvTnVldm8pIHx8IDA7XG4gICAgY29uc3QgZWxpbSA9IE51bWJlcihyLmVsaW1pbmFyTnVldm8pIHx8IDA7XG4gICAgY29uc3QgdnVlbHZlID0gTWF0aC5tYXgoMCwgYm8gLSBhc2lnIC0gZWxpbSk7XG4gICAgY29uc3QgYWRkVGQgPSAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHR4dCwgLyoqIEB0eXBlIHtzdHJpbmd9ICovIGNzcykgPT4ge1xuICAgICAgY29uc3QgdGQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICAgICAgdGQuc3R5bGUuY3NzVGV4dCA9IGNzcztcbiAgICAgIHRkLnRleHRDb250ZW50ID0gdHh0O1xuICAgICAgdHIuYXBwZW5kQ2hpbGQodGQpO1xuICAgIH07XG4gICAgYWRkVGQoci5za3UgfHwgJycsICdwYWRkaW5nOjZweCA4cHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSknKTtcbiAgICBhZGRUZChyLmNsaWVudE5hbWUgfHwgJycsICdwYWRkaW5nOjZweCA4cHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KScpO1xuICAgIGFkZFRkKFxuICAgICAgYXNpZyA/IFN0cmluZyhhc2lnKSA6ICctJyxcbiAgICAgICdwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpyaWdodDsnICtcbiAgICAgICAgKGFzaWdcbiAgICAgICAgICA/ICdjb2xvcjp2YXIoLS1jb2xvci1zdWNjZXNzLCMyNDhhM2QpO2ZvbnQtd2VpZ2h0OjcwMCdcbiAgICAgICAgICA6ICdjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSwjODY4NjhiKScpXG4gICAgKTtcbiAgICBhZGRUZChcbiAgICAgIHZ1ZWx2ZSA/IFN0cmluZyh2dWVsdmUpIDogJy0nLFxuICAgICAgJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0OycgK1xuICAgICAgICAodnVlbHZlXG4gICAgICAgICAgPyAnY29sb3I6dmFyKC0tY29sb3Itd2FybmluZywjOGE2ZDAwKTtmb250LXdlaWdodDo3MDAnXG4gICAgICAgICAgOiAnY29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnksIzg2ODY4YiknKVxuICAgICk7XG4gICAgYWRkVGQoXG4gICAgICBlbGltID8gU3RyaW5nKGVsaW0pIDogJy0nLFxuICAgICAgJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0OycgK1xuICAgICAgICAoZWxpbVxuICAgICAgICAgID8gJ2NvbG9yOnZhcigtLWNvbG9yLWRhbmdlciwjYzczNzJmKTtmb250LXdlaWdodDo3MDAnXG4gICAgICAgICAgOiAnY29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnksIzg2ODY4YiknKVxuICAgICk7XG4gICAgdGJvZHkuYXBwZW5kQ2hpbGQodHIpO1xuICB9XG4gIHRhYmxlLmFwcGVuZENoaWxkKHRib2R5KTtcbiAgdGFibGVXcmFwLmFwcGVuZENoaWxkKHRhYmxlKTtcbiAgb2tFbC5hcHBlbmRDaGlsZCh0YWJsZVdyYXApO1xuXG4gIGlmICgoZGF0YS5yZWNvbm9jaWRhcyB8fCBbXSkubGVuZ3RoID4gMjAwKSB7XG4gICAgb2tFbC5hcHBlbmRDaGlsZChcbiAgICAgIF9ta0RpdihcbiAgICAgICAgJ2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5LCM4Njg2OGIpO2ZvbnQtc2l6ZToxMXB4O21hcmdpbi10b3A6NnB4O3RleHQtYWxpZ246Y2VudGVyJyxcbiAgICAgICAgJy4uLnkgJyArICgoZGF0YS5yZWNvbm9jaWRhcyB8fCBbXSkubGVuZ3RoIC0gMjAwKSArICcgZmlsYXMgbVx1MDBFMXMnXG4gICAgICApXG4gICAgKTtcbiAgfVxufVxuXG4vKipcbiAqIFJlbmRlciBlc3RhZG8gXCJlcnJvcnNcIjogbGlzdGEgcm9qYSBkZSBmaWxhcyBjb24gZXJyb3IuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGVycm9yc1xuICovXG5mdW5jdGlvbiBfcmVuZGVyRXJyb3JzU3RhdGUoZXJyb3JzKSB7XG4gIGNvbnN0IGVyckVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LWVycm9ycycpO1xuICBpZiAoIWVyckVsKSByZXR1cm47XG4gIHdoaWxlIChlcnJFbC5maXJzdENoaWxkKSBlcnJFbC5yZW1vdmVDaGlsZChlcnJFbC5maXJzdENoaWxkKTtcbiAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGNvbnRhaW5lci5zdHlsZS5jc3NUZXh0ID0gJ3dpZHRoOjEwMCU7bWF4LWhlaWdodDo0MjBweDtvdmVyZmxvdy15OmF1dG8nO1xuICBjb25zdCBoZWFkZXIgPSBfbWtEaXYoXG4gICAgJ3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3ItZGFuZ2VyLWJnLHJnYmEoMjU1LDU5LDQ4LC4wOCkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCB2YXIoLS1jb2xvci1kYW5nZXIsI2M3MzcyZik7Ym9yZGVyLXJhZGl1czo2cHg7bWFyZ2luLWJvdHRvbToxMnB4O2NvbG9yOnZhcigtLWNvbG9yLWRhbmdlciwjYzczNzJmKTtmb250LXdlaWdodDo3MDAnLFxuICAgICdIYXkgJyArIGVycm9ycy5sZW5ndGggKyAnIGVycm9yKGVzKS4gQ29ycmVnXHUwMEVEIGVsIEV4Y2VsIHkgdm9sdlx1MDBFOSBhIHN1YmlybG8uIE5vIHNlIGFwbGljYSBuYWRhLidcbiAgKTtcbiAgY29udGFpbmVyLmFwcGVuZENoaWxkKGhlYWRlcik7XG4gIGNvbnN0IGxpc3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd1bCcpO1xuICBsaXN0LnN0eWxlLmNzc1RleHQgPVxuICAgICdtYXJnaW46MDtwYWRkaW5nLWxlZnQ6MjBweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnksIzFkMWQxZik7Zm9udC1zaXplOjEzcHg7bGluZS1oZWlnaHQ6MS42JztcbiAgY29uc3Qgc2xpY2UgPSBlcnJvcnMuc2xpY2UoMCwgMTAwKTtcbiAgZm9yIChjb25zdCBlIG9mIHNsaWNlKSB7XG4gICAgY29uc3QgbGkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdsaScpO1xuICAgIGxpLnRleHRDb250ZW50ID0gZS5tc2c7XG4gICAgbGlzdC5hcHBlbmRDaGlsZChsaSk7XG4gIH1cbiAgY29udGFpbmVyLmFwcGVuZENoaWxkKGxpc3QpO1xuICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEwMCkge1xuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChcbiAgICAgIF9ta0RpdihcbiAgICAgICAgJ2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5LCM4Njg2OGIpO2ZvbnQtc2l6ZToxMXB4O21hcmdpbi10b3A6NnB4JyxcbiAgICAgICAgJy4uLnkgJyArIChlcnJvcnMubGVuZ3RoIC0gMTAwKSArICcgbVx1MDBFMXMgKHZlciBjb25zb2xhKS4nXG4gICAgICApXG4gICAgKTtcbiAgfVxuICBlcnJFbC5hcHBlbmRDaGlsZChjb250YWluZXIpO1xufVxuXG53aW5kb3cuY29uZmlybVJlcGFydG9JbXBvcnRBcHBseSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgaWYgKCFfaW1wb3J0U3RhdGUgfHwgX2ltcG9ydFN0YXRlLmNvbkNhbWJpb3MubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGlmIChfaW1wb3J0U3RhdGUuZXJyb3Jlcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gc2UgcHVlZGUgYXBsaWNhcjogaGF5IGVycm9yZXMgZW4gbGEgdmlzdGEgcHJldmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIV9pc0FkbWluTGlrZUZvckltcG9ydCgpKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGFwbGljYXIgcmVwYXJ0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYXBwbHlCdG4gPSAvKiogQHR5cGUge2FueX0gKi8gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nKSk7XG4gIGlmIChhcHBseUJ0bikge1xuICAgIGFwcGx5QnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgICBhcHBseUJ0bi50ZXh0Q29udGVudCA9ICdBcGxpY2FuZG9cdTIwMjYnO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3QgdmFsaWRhdG9yID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLnJlcGFydG9FeGNlbEltcG9ydDtcbiAgICBjb25zdCBncm91cHMgPSB2YWxpZGF0b3IuZ3JvdXBJbXBvcnRNYXRjaGVzQnlSZXBhcnRvKF9pbXBvcnRTdGF0ZS5jb25DYW1iaW9zKTtcbiAgICBjb25zdCBpbmdyZXNvcyA9IEFycmF5LmlzQXJyYXkody5fcmVwYXJ0b0luZ3Jlc29zKSA/IHcuX3JlcGFydG9JbmdyZXNvcyA6IFtdO1xuXG4gICAgY29uc3QgY2FsbGFibGUgPSB3LmZpcmViYXNlXG4gICAgICAuYXBwKClcbiAgICAgIC5mdW5jdGlvbnMoJ3NvdXRoYW1lcmljYS1lYXN0MScpXG4gICAgICAuaHR0cHNDYWxsYWJsZSgnYXBwbHlSZXBhcnRvTWFudWFsQ0YnKTtcbiAgICBsZXQgb2tDb3VudCA9IDA7XG4gICAgbGV0IGZhaWxDb3VudCA9IDA7XG4gICAgY29uc3QgZmFpbHVyZXMgPSBbXTtcbiAgICBsZXQgdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMgPSAwO1xuICAgIGxldCB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMgPSAwO1xuXG4gICAgZm9yIChjb25zdCBnIG9mIGdyb3Vwcykge1xuICAgICAgY29uc3QgaW5nID0gaW5ncmVzb3MuZmluZCgoLyoqIEB0eXBlIHthbnl9ICovIGkpID0+IGkuX2lkID09PSBnLnJlcGFydG9JZCk7XG4gICAgICBpZiAoIWluZykge1xuICAgICAgICBmYWlsQ291bnQrKztcbiAgICAgICAgZmFpbHVyZXMucHVzaCgnUmVwYXJ0byAnICsgZy5yZXBhcnRvSWQgKyAnIHlhIG5vIGV4aXN0ZScpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNsaWVudGVzID0gQXJyYXkuaXNBcnJheShpbmcuY2xpZW50ZXNCTykgPyBpbmcuY2xpZW50ZXNCTyA6IFtdO1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgICAgY29uc3QgYXNzaWdubWVudHMgPSBbXTtcbiAgICAgIC8qKiBAdHlwZSB7QXJyYXk8YW55Pn0gKi9cbiAgICAgIGNvbnN0IGVsaW1pbmF0aW9ucyA9IFtdO1xuICAgICAgZm9yIChjb25zdCBhIG9mIGcuYXNzaWdubWVudHMpIHtcbiAgICAgICAgY29uc3QgYyA9IGNsaWVudGVzLmZpbmQoXG4gICAgICAgICAgKC8qKiBAdHlwZSB7YW55fSAqLyB4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKHguY2xpZW50Q2FyZENvZGUgfHwgeC5jYXJkQ29kZSB8fCAnJylcbiAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKClcbiAgICAgICAgICAgICAgLnRyaW0oKSA9PT0gU3RyaW5nKGEuY2FyZENvZGUpLnRvVXBwZXJDYXNlKCkudHJpbSgpXG4gICAgICAgICk7XG4gICAgICAgIGlmICghYykge1xuICAgICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgICAnUmVwYXJ0byAnICsgZy5yZXBhcnRvSWQgKyAnIC8gQ2FyZENvZGUgJyArIGEuY2FyZENvZGUgKyAnIHlhIG5vIGVzdFx1MDBFMSBlbiBCTydcbiAgICAgICAgICApO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGFzc2lnbm1lbnRzLnB1c2goe1xuICAgICAgICAgIHBlZGlkb0lkOiBjLnBlZGlkb0lkLFxuICAgICAgICAgIGxpbmVJbmRleDogTnVtYmVyKGMubGluZUluZGV4KSB8fCAwLFxuICAgICAgICAgIHF0eUFzaWduYWRhOiBhLnF0eUFzaWduYWRhLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZSBvZiBnLmVsaW1pbmF0aW9ucykge1xuICAgICAgICBjb25zdCBjID0gY2xpZW50ZXMuZmluZChcbiAgICAgICAgICAoLyoqIEB0eXBlIHthbnl9ICovIHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeC5jbGllbnRDYXJkQ29kZSB8fCB4LmNhcmRDb2RlIHx8ICcnKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKVxuICAgICAgICAgICAgICAudHJpbSgpID09PSBTdHJpbmcoZS5jYXJkQ29kZSkudG9VcHBlckNhc2UoKS50cmltKClcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFjKSB7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICAgICdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgLyBDYXJkQ29kZSAnICsgZS5jYXJkQ29kZSArICcgeWEgbm8gZXN0XHUwMEUxIGVuIEJPJ1xuICAgICAgICAgICk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZWxpbWluYXRpb25zLnB1c2goe1xuICAgICAgICAgIHBlZGlkb0lkOiBjLnBlZGlkb0lkLFxuICAgICAgICAgIGxpbmVJbmRleDogTnVtYmVyKGMubGluZUluZGV4KSB8fCAwLFxuICAgICAgICAgIHF0eUVsaW1pbmFyOiBlLnF0eUVsaW1pbmFyLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghYXNzaWdubWVudHMubGVuZ3RoICYmICFlbGltaW5hdGlvbnMubGVuZ3RoKSBjb250aW51ZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKHtcbiAgICAgICAgICBpbmdyZXNvSWQ6IGcucmVwYXJ0b0lkLFxuICAgICAgICAgIGFzc2lnbm1lbnRzLFxuICAgICAgICAgIGVsaW1pbmF0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHIgPSByZXMuZGF0YSB8fCB7fTtcbiAgICAgICAgaWYgKHIub2spIHtcbiAgICAgICAgICBva0NvdW50Kys7XG4gICAgICAgICAgdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMgKz0gYXNzaWdubWVudHMubGVuZ3RoO1xuICAgICAgICAgIHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyArPSBlbGltaW5hdGlvbnMubGVuZ3RoO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZhaWxDb3VudCsrO1xuICAgICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgICBnLnJlcGFydG9JZCArXG4gICAgICAgICAgICAgICcgKCcgK1xuICAgICAgICAgICAgICBnLnNrdSArXG4gICAgICAgICAgICAgICcpOiAnICtcbiAgICAgICAgICAgICAgKChyLmVycm9ycyB8fCBbXSkuam9pbignOyAnKSB8fCAnZXJyb3IgZGVzY29ub2NpZG8nKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGNhbGxFcnIpIHtcbiAgICAgICAgZmFpbENvdW50Kys7XG4gICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgZy5yZXBhcnRvSWQgK1xuICAgICAgICAgICAgJyAoJyArXG4gICAgICAgICAgICBnLnNrdSArXG4gICAgICAgICAgICAnKTogJyArXG4gICAgICAgICAgICAoKGNhbGxFcnIgJiYgLyoqIEB0eXBlIHthbnl9ICovIChjYWxsRXJyKS5tZXNzYWdlKSB8fCBTdHJpbmcoY2FsbEVycikpXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh3LmZiRGIgJiYgdHlwZW9mIHcuZmJEYi5jb2xsZWN0aW9uID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGF3YWl0IHcuZmJEYi5jb2xsZWN0aW9uKCdyZXBhcnRvX2xvZycpLmFkZCh7XG4gICAgICAgICAgb3JpZ2VuOiAnaW1wb3J0JyxcbiAgICAgICAgICBmaWxlTmFtZTogX2ltcG9ydFN0YXRlLmZpbGVOYW1lLFxuICAgICAgICAgIGltcG9ydGVkQnlVaWQ6ICh3LmN1cnJlbnRVc2VyICYmIHcuY3VycmVudFVzZXIudWlkKSB8fCBudWxsLFxuICAgICAgICAgIGltcG9ydGVkQnlFbWFpbDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgbnVsbCxcbiAgICAgICAgICByb3dzQ291bnQ6IF9pbXBvcnRTdGF0ZS50b3RhbEZpbGFzLFxuICAgICAgICAgIGFzc2lnbm1lbnRzQ291bnQ6IHRvdGFsQXNpZ25hY2lvbmVzQXBsaWNhZGFzLFxuICAgICAgICAgIGVsaW1pbmF0aW9uc0NvdW50OiB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMsXG4gICAgICAgICAgcmVwYXJ0b3NQcm9jZXNhZG9zOiBncm91cHMubGVuZ3RoLFxuICAgICAgICAgIG9rQ291bnQsXG4gICAgICAgICAgZmFpbENvdW50LFxuICAgICAgICAgIGltcG9ydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGxvZ0Vycikge1xuICAgICAgY29uc29sZS53YXJuKCdbdjE1MDVdIHJlcGFydG9fbG9nIG9yaWdlbj1pbXBvcnQgd3JpdGUgZmFpbGVkJywgbG9nRXJyKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdW1tYXJ5ID1cbiAgICAgIHRvdGFsQXNpZ25hY2lvbmVzQXBsaWNhZGFzICtcbiAgICAgICcgYXNpZ25hY2lvbmVzIGFwbGljYWRhcyBcdTAwQjcgJyArXG4gICAgICB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMgK1xuICAgICAgJyBlbGltaW5hY2lvbmVzIGFwbGljYWRhcycgK1xuICAgICAgKGZhaWxDb3VudFxuICAgICAgICA/ICdcXG5cXG5SZXBhcnRvcyBjb24gZXJyb3IgKCcgKyBmYWlsQ291bnQgKyAnKTpcXG4nICsgZmFpbHVyZXMuc2xpY2UoMCwgNSkuam9pbignXFxuJylcbiAgICAgICAgOiAnJyk7XG4gICAgYWxlcnQoc3VtbWFyeSk7XG4gICAgaWYgKG9rQ291bnQgPiAwKSBfc3luY1RhZygnSW1wb3J0IFJlcGFydG8gYXBsaWNhZG8gXHUwMEI3ICcgKyBva0NvdW50ICsgJyByZXBhcnRvKHMpJywgMzIwMCk7XG4gICAgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgJiYgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2coKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IChlICYmIC8qKiBAdHlwZSB7YW55fSAqLyAoZSkubWVzc2FnZSkgfHwgU3RyaW5nKGUpO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1t2MTUwNSBcdTAwQTdSZXBhcnRvXSBjb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5IGVycm9yOicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBhcGxpY2FuZG8gaW1wb3J0OiAnICsgbXNnKTtcbiAgICBfbG9nRXhwb3J0RXJyb3IoJ2ltcG9ydF9hcHBseScsIG1zZyk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGFwcGx5QnRuKSB7XG4gICAgICBhcHBseUJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgICAgYXBwbHlCdG4udGV4dENvbnRlbnQgPSAnQXBsaWNhciByZXBhcnRvIGltcG9ydGFkbyc7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIHYxNTE0IFx1MDBBN1QzOiBjb25zdHJ1eWUgZWwgbW9kYWwgRE9NIGNvbiA0IGVzdGFkb3MgbXV0dWFtZW50ZSBleGNsdXNpdm9zOlxuICogICAtICNyZXBhcnRvLWltcG9ydC1kcm9wem9uZSAoaWRsZSk6IGRhc2hlZCBib3JkZXIgKyBcdTAwRURjb25vICsgaGludC5cbiAqICAgLSAjcmVwYXJ0by1pbXBvcnQtdmFsaWRhdGluZzogc3Bpbm5lciArIFwiVmFsaWRhbmRvIGZpbGFzLi4uXCIuXG4gKiAgIC0gI3JlcGFydG8taW1wb3J0LXByZXZpZXctb2s6IDMgY2FyZHMgcmVzdW1lbiArIHRhYmxhIDUgY29scy5cbiAqICAgLSAjcmVwYXJ0by1pbXBvcnQtZXJyb3JzOiBsaXN0YSByb2phIGRlIGVycm9yZXMuXG4gKiBEcm9wem9uZSBzb3BvcnRhIGNsaWNrICsgZHJhZy9kcm9wLiBEYXJrLW1vZGUgdmlhIENTUyB2YXJzLlxuICogQHJldHVybnMge0hUTUxFbGVtZW50fVxuICovXG5mdW5jdGlvbiBfYnVpbGRJbXBvcnRNb2RhbERvbSgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbW9kYWwuaWQgPSAncmVwYXJ0by1pbXBvcnQtbW9kYWwnO1xuICBtb2RhbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIG1vZGFsLnNldEF0dHJpYnV0ZSgnZGF0YS1zdGF0ZScsICdpZGxlJyk7XG4gIG1vZGFsLnN0eWxlLmNzc1RleHQgPSAnZGlzcGxheTpub25lO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyJztcbiAgbW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXYpID0+IHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBtb2RhbCkge1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gICAgfVxuICB9KTtcbiAgY29uc3QgYm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGJveC5jbGFzc05hbWUgPSAnbW9kYWwtYm94JztcbiAgYm94LnN0eWxlLmNzc1RleHQgPVxuICAgICd3aWR0aDptaW4oODIwcHgsOTZ2dyk7bWF4LWhlaWdodDo5MHZoO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47JyArXG4gICAgJ2JhY2tncm91bmQ6dmFyKC0tYmctcHJpbWFyeSwjZmZmKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnksIzFkMWQxZik7JyArXG4gICAgJ2JvcmRlci1yYWRpdXM6MTRweDtvdmVyZmxvdzpoaWRkZW47JyArXG4gICAgJ2JveC1zaGFkb3c6MCAyMHB4IDUwcHggcmdiYSgwLDAsMCwuMjUpJztcblxuICAvLyA9PT0gSGVhZGVyID09PVxuICBjb25zdCBoZWFkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGhlYWQuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6MThweCAyMnB4O2JvcmRlci1ib3R0b206MC41cHggc29saWQgdmFyKC0tYm9yZGVyLWNvbG9yLHJnYmEoMCwwLDAsLjA4KSk7JyArXG4gICAgJ2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEycHg7ZmxleC1zaHJpbms6MCc7XG4gIGNvbnN0IGhlYWRUaXRsZVdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgaGVhZFRpdGxlV3JhcC5zdHlsZS5jc3NUZXh0ID0gJ2ZsZXg6MSc7XG4gIGNvbnN0IGgyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaDInKTtcbiAgaDIuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ21hcmdpbjowIDAgMnB4O2ZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzotMC40cHg7JyArXG4gICAgJ2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSwjMWQxZDFmKSc7XG4gIGgyLnRleHRDb250ZW50ID0gJ0ltcG9ydGFyIHJlcGFydG8gZGVzZGUgRXhjZWwnO1xuICBoZWFkVGl0bGVXcmFwLmFwcGVuZENoaWxkKGgyKTtcbiAgY29uc3Qgc3VidCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBzdWJ0LnN0eWxlLmNzc1RleHQgPSAnZm9udC1zaXplOjEyLjVweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSwjODY4NjhiKSc7XG4gIHN1YnQudGV4dENvbnRlbnQgPSAnU3ViXHUwMEVEIGVsIEV4Y2VsIGVkaXRhZG8gb2ZmbGluZS4gU2UgdmFsaWRhIGZpbGEgcG9yIGZpbGEgYW50ZXMgZGUgYXBsaWNhci4nO1xuICBoZWFkVGl0bGVXcmFwLmFwcGVuZENoaWxkKHN1YnQpO1xuICBoZWFkLmFwcGVuZENoaWxkKGhlYWRUaXRsZVdyYXApO1xuICBjb25zdCBjbG9zZUJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICBjbG9zZUJ0bi50eXBlID0gJ2J1dHRvbic7XG4gIGNsb3NlQnRuLnRleHRDb250ZW50ID0gJ1x1MDBENyc7XG4gIGNsb3NlQnRuLnNldEF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsICdDZXJyYXInKTtcbiAgY2xvc2VCdG4uc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2JvcmRlcjpub25lO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5LHJnYmEoMTIwLDEyMCwxMjgsLjEyKSk7JyArXG4gICAgJ3dpZHRoOjMycHg7aGVpZ2h0OjMycHg7Ym9yZGVyLXJhZGl1czo1MCU7Y3Vyc29yOnBvaW50ZXI7JyArXG4gICAgJ2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5LCM2ZTZlNzMpO2ZvbnQtc2l6ZToxOHB4O2xpbmUtaGVpZ2h0OjEnO1xuICBjbG9zZUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gIH0pO1xuICBoZWFkLmFwcGVuZENoaWxkKGNsb3NlQnRuKTtcbiAgYm94LmFwcGVuZENoaWxkKGhlYWQpO1xuXG4gIC8vID09PSBCb2R5ID09PVxuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGJvZHkuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6MjBweCAyMnB4O2ZsZXg6MSAxIGF1dG87b3ZlcmZsb3cteTphdXRvO21pbi1oZWlnaHQ6MDsnICtcbiAgICAnZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbic7XG5cbiAgLy8gSW5wdXQgZmlsZSBuYXRpdm8gb2N1bHRvLlxuICBjb25zdCBmaWxlSW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xuICBmaWxlSW5wdXQudHlwZSA9ICdmaWxlJztcbiAgZmlsZUlucHV0LmlkID0gJ3JlcGFydG8taW1wb3J0LWZpbGUnO1xuICBmaWxlSW5wdXQuYWNjZXB0ID0gJy54bHN4JztcbiAgZmlsZUlucHV0LnN0eWxlLmNzc1RleHQgPSAnZGlzcGxheTpub25lJztcbiAgZmlsZUlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIChldikgPT4ge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKHR5cGVvZiB3LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlID09PSAnZnVuY3Rpb24nKSB3LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlKGV2KTtcbiAgfSk7XG4gIGJvZHkuYXBwZW5kQ2hpbGQoZmlsZUlucHV0KTtcblxuICAvLyBFc3RhZG8gMTogZHJvcHpvbmUgKGlkbGUpLlxuICBjb25zdCBkcm9wem9uZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBkcm9wem9uZS5pZCA9ICdyZXBhcnRvLWltcG9ydC1kcm9wem9uZSc7XG4gIGRyb3B6b25lLnN0eWxlLmNzc1RleHQgPVxuICAgICdkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyOycgK1xuICAgICdib3JkZXI6MnB4IGRhc2hlZCB2YXIoLS1ib3JkZXItY29sb3IsI2M3YzdjYyk7JyArXG4gICAgJ2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjQ4cHggMjRweDtjdXJzb3I6cG9pbnRlcjsnICtcbiAgICAnYmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnksI2ZhZmFmYSk7JyArXG4gICAgJ2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSwjMWQxZDFmKTsnICtcbiAgICAndHJhbnNpdGlvbjpiYWNrZ3JvdW5kIC4xNXMgZWFzZSxib3JkZXItY29sb3IgLjE1cyBlYXNlO21pbi1oZWlnaHQ6MjIwcHgnO1xuICBjb25zdCBkekljb24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZHpJY29uLnN0eWxlLmNzc1RleHQgPSAnZm9udC1zaXplOjQ4cHg7bGluZS1oZWlnaHQ6MTttYXJnaW4tYm90dG9tOjEycHgnO1xuICBkekljb24udGV4dENvbnRlbnQgPSAnXHVEODNEXHVEQ0MyJztcbiAgZHJvcHpvbmUuYXBwZW5kQ2hpbGQoZHpJY29uKTtcbiAgY29uc3QgZHpUeHQxID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGR6VHh0MS5zdHlsZS5jc3NUZXh0ID1cbiAgICAnZm9udC1zaXplOjE1cHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSwjMWQxZDFmKTttYXJnaW4tYm90dG9tOjRweDt0ZXh0LWFsaWduOmNlbnRlcic7XG4gIGR6VHh0MS50ZXh0Q29udGVudCA9ICdBcnJhc3RyXHUwMEUxIGVsIEV4Y2VsIGFjXHUwMEUxIG8gaGFjXHUwMEU5IGNsaWMgcGFyYSBlbGVnaXJsbyc7XG4gIGRyb3B6b25lLmFwcGVuZENoaWxkKGR6VHh0MSk7XG4gIGNvbnN0IGR6VHh0MiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBkelR4dDIuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSwjODY4NjhiKTt0ZXh0LWFsaWduOmNlbnRlcic7XG4gIGR6VHh0Mi50ZXh0Q29udGVudCA9ICcoLnhsc3ggZXhwb3J0YWRvIGRlbCByZXBhcnRvKSc7XG4gIGRyb3B6b25lLmFwcGVuZENoaWxkKGR6VHh0Mik7XG4gIGRyb3B6b25lLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgIGZpbGVJbnB1dC5jbGljaygpO1xuICB9KTtcbiAgZHJvcHpvbmUuYWRkRXZlbnRMaXN0ZW5lcignZHJhZ292ZXInLCAoZXYpID0+IHtcbiAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGlmIChldi5kYXRhVHJhbnNmZXIpIGV2LmRhdGFUcmFuc2Zlci5kcm9wRWZmZWN0ID0gJ2NvcHknO1xuICAgIGRyb3B6b25lLmNsYXNzTGlzdC5hZGQoJ2lzLWRyYWdvdmVyJyk7XG4gICAgZHJvcHpvbmUuc3R5bGUuYm9yZGVyQ29sb3IgPSAndmFyKC0tY29sb3Itc3VjY2VzcywjMjQ4YTNkKSc7XG4gICAgZHJvcHpvbmUuc3R5bGUuYmFja2dyb3VuZCA9ICd2YXIoLS1jb2xvci1zdWNjZXNzLWJnLHJnYmEoNTIsMTk5LDg5LC4wOCkpJztcbiAgfSk7XG4gIGRyb3B6b25lLmFkZEV2ZW50TGlzdGVuZXIoJ2RyYWdsZWF2ZScsIChldikgPT4ge1xuICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZHJvcHpvbmUuY2xhc3NMaXN0LnJlbW92ZSgnaXMtZHJhZ292ZXInKTtcbiAgICBkcm9wem9uZS5zdHlsZS5ib3JkZXJDb2xvciA9ICd2YXIoLS1ib3JkZXItY29sb3IsI2M3YzdjYyknO1xuICAgIGRyb3B6b25lLnN0eWxlLmJhY2tncm91bmQgPSAndmFyKC0tYmctc2Vjb25kYXJ5LCNmYWZhZmEpJztcbiAgfSk7XG4gIGRyb3B6b25lLmFkZEV2ZW50TGlzdGVuZXIoJ2Ryb3AnLCAoZXYpID0+IHtcbiAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGRyb3B6b25lLmNsYXNzTGlzdC5yZW1vdmUoJ2lzLWRyYWdvdmVyJyk7XG4gICAgZHJvcHpvbmUuc3R5bGUuYm9yZGVyQ29sb3IgPSAndmFyKC0tYm9yZGVyLWNvbG9yLCNjN2M3Y2MpJztcbiAgICBkcm9wem9uZS5zdHlsZS5iYWNrZ3JvdW5kID0gJ3ZhcigtLWJnLXNlY29uZGFyeSwjZmFmYWZhKSc7XG4gICAgY29uc3QgZHQgPSAvKiogQHR5cGUge2FueX0gKi8gKGV2KS5kYXRhVHJhbnNmZXI7XG4gICAgaWYgKGR0ICYmIGR0LmZpbGVzICYmIGR0LmZpbGVzWzBdKSB7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHcuaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UoeyB0YXJnZXQ6IHsgZmlsZXM6IFtkdC5maWxlc1swXV0gfSB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICBib2R5LmFwcGVuZENoaWxkKGRyb3B6b25lKTtcblxuICAvLyBFc3RhZG8gMjogdmFsaWRhdGluZyAoc3Bpbm5lciArIG1lbnNhamUpLlxuICBjb25zdCB2YWxpZGF0aW5nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHZhbGlkYXRpbmcuaWQgPSAncmVwYXJ0by1pbXBvcnQtdmFsaWRhdGluZyc7XG4gIHZhbGlkYXRpbmcuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2Rpc3BsYXk6bm9uZTtmbGV4LWRpcmVjdGlvbjpjb2x1bW47YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7JyArXG4gICAgJ3BhZGRpbmc6NDhweCAyNHB4O21pbi1oZWlnaHQ6MjIwcHg7Z2FwOjE0cHgnO1xuICBjb25zdCBzcGlubmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHNwaW5uZXIuc2V0QXR0cmlidXRlKCdyb2xlJywgJ3N0YXR1cycpO1xuICBzcGlubmVyLnNldEF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsICdWYWxpZGFuZG8nKTtcbiAgc3Bpbm5lci5zdHlsZS5jc3NUZXh0ID1cbiAgICAnd2lkdGg6NDBweDtoZWlnaHQ6NDBweDtib3JkZXI6M3B4IHNvbGlkIHZhcigtLWJvcmRlci1jb2xvciwjZTVlNWVhKTsnICtcbiAgICAnYm9yZGVyLXRvcC1jb2xvcjp2YXIoLS1jb2xvci1zdWNjZXNzLCMyNDhhM2QpO2JvcmRlci1yYWRpdXM6NTAlOycgK1xuICAgICdhbmltYXRpb246cmVwYXJ0by1pbXBvcnQtc3BpbiAwLjhzIGxpbmVhciBpbmZpbml0ZSc7XG4gIHZhbGlkYXRpbmcuYXBwZW5kQ2hpbGQoc3Bpbm5lcik7XG4gIGNvbnN0IHZUeHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgdlR4dC5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxNHB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5LCM4Njg2OGIpO2ZvbnQtd2VpZ2h0OjUwMCc7XG4gIHZUeHQudGV4dENvbnRlbnQgPSAnVmFsaWRhbmRvIGZpbGFzLi4uJztcbiAgdmFsaWRhdGluZy5hcHBlbmRDaGlsZCh2VHh0KTtcbiAgLy8gSW55ZWN0YSBrZXlmcmFtZXMgdW5hIHNvbGEgdmV6LlxuICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1zcGluLWtmJykpIHtcbiAgICBjb25zdCBzdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgc3R5bGUuaWQgPSAncmVwYXJ0by1pbXBvcnQtc3Bpbi1rZic7XG4gICAgc3R5bGUudGV4dENvbnRlbnQgPSAnQGtleWZyYW1lcyByZXBhcnRvLWltcG9ydC1zcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19JztcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcbiAgfVxuICBib2R5LmFwcGVuZENoaWxkKHZhbGlkYXRpbmcpO1xuXG4gIC8vIEVzdGFkbyAzOiBwcmV2aWV3LW9rIChjYXJkcyArIHRhYmxhKS5cbiAgY29uc3QgcHJldmlld09rID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHByZXZpZXdPay5pZCA9ICdyZXBhcnRvLWltcG9ydC1wcmV2aWV3LW9rJztcbiAgcHJldmlld09rLnN0eWxlLmNzc1RleHQgPVxuICAgICdkaXNwbGF5Om5vbmU7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOnN0cmV0Y2g7Z2FwOjRweDtmbGV4OjE7bWluLWhlaWdodDowO3dpZHRoOjEwMCUnO1xuICBib2R5LmFwcGVuZENoaWxkKHByZXZpZXdPayk7XG5cbiAgLy8gRXN0YWRvIDQ6IGVycm9ycy5cbiAgY29uc3QgZXJyQm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVyckJveC5pZCA9ICdyZXBhcnRvLWltcG9ydC1lcnJvcnMnO1xuICBlcnJCb3guc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2Rpc3BsYXk6bm9uZTtmbGV4LWRpcmVjdGlvbjpjb2x1bW47YWxpZ24taXRlbXM6c3RyZXRjaDtnYXA6NHB4O2ZsZXg6MTttaW4taGVpZ2h0OjA7d2lkdGg6MTAwJSc7XG4gIGJvZHkuYXBwZW5kQ2hpbGQoZXJyQm94KTtcblxuICBib3guYXBwZW5kQ2hpbGQoYm9keSk7XG5cbiAgLy8gPT09IEZvb3RlciA9PT1cbiAgY29uc3QgZm9vdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBmb290LnN0eWxlLmNzc1RleHQgPVxuICAgICdwYWRkaW5nOjE0cHggMjJweDtib3JkZXItdG9wOjAuNXB4IHNvbGlkIHZhcigtLWJvcmRlci1jb2xvcixyZ2JhKDAsMCwwLC4wOCkpOycgK1xuICAgICdkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7anVzdGlmeS1jb250ZW50OmZsZXgtZW5kO2ZsZXgtc2hyaW5rOjA7JyArXG4gICAgJ2JhY2tncm91bmQ6dmFyKC0tYmctcHJpbWFyeSwjZmZmKSc7XG4gIGNvbnN0IGNhbmNlbEJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICBjYW5jZWxCdG4udHlwZSA9ICdidXR0b24nO1xuICBjYW5jZWxCdG4udGV4dENvbnRlbnQgPSAnQ2FuY2VsYXInO1xuICBjYW5jZWxCdG4uc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6MTBweCAyMHB4O2JvcmRlcjowLjVweCBzb2xpZCB2YXIoLS1ib3JkZXItY29sb3IscmdiYSgwLDAsMCwuMTIpKTsnICtcbiAgICAnYmFja2dyb3VuZDp2YXIoLS1iZy1wcmltYXJ5LCNmZmYpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSwjMWQxZDFmKTsnICtcbiAgICAnYm9yZGVyLXJhZGl1czo5OTlweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo1MDAnO1xuICBjYW5jZWxCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICBpZiAodHlwZW9mIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nID09PSAnZnVuY3Rpb24nKSB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZygpO1xuICB9KTtcbiAgZm9vdC5hcHBlbmRDaGlsZChjYW5jZWxCdG4pO1xuICBjb25zdCBhcHBseUJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICBhcHBseUJ0bi50eXBlID0gJ2J1dHRvbic7XG4gIGFwcGx5QnRuLmlkID0gJ3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bic7XG4gIGFwcGx5QnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgYXBwbHlCdG4udGV4dENvbnRlbnQgPSAnQXBsaWNhciByZXBhcnRvJztcbiAgYXBwbHlCdG4uc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2Rpc3BsYXk6bm9uZTtwYWRkaW5nOjEwcHggMjBweDtib3JkZXI6bm9uZTsnICtcbiAgICAnYmFja2dyb3VuZDp2YXIoLS1jb2xvci1zdWNjZXNzLCMyNDhhM2QpO2NvbG9yOiNmZmY7JyArXG4gICAgJ2JvcmRlci1yYWRpdXM6OTk5cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO29wYWNpdHk6MC40JztcbiAgYXBwbHlCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICBpZiAodHlwZW9mIHcuY29uZmlybVJlcGFydG9JbXBvcnRBcHBseSA9PT0gJ2Z1bmN0aW9uJykgdy5jb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5KCk7XG4gIH0pO1xuICBmb290LmFwcGVuZENoaWxkKGFwcGx5QnRuKTtcbiAgYm94LmFwcGVuZENoaWxkKGZvb3QpO1xuICBtb2RhbC5hcHBlbmRDaGlsZChib3gpO1xuICByZXR1cm4gbW9kYWw7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFpQ0EsaUJBQWUsaUJBQWlCO0FBQzlCLFVBQU07QUFBQTtBQUFBLE1BQXdCO0FBQUE7QUFDOUIsUUFBSSxPQUFPLEVBQUUsZ0JBQWdCLFdBQVksT0FBTSxFQUFFLFlBQVk7QUFDN0QsUUFBSSxDQUFDLEVBQUUsUUFBUyxPQUFNLElBQUksTUFBTSx1QkFBdUI7QUFBQSxFQUN6RDtBQU1BLFdBQVMsU0FBUyxLQUFLLElBQUk7QUFDekIsVUFBTTtBQUFBO0FBQUEsTUFBd0I7QUFBQTtBQUM5QixRQUFJLE9BQU8sRUFBRSxnQkFBZ0IsWUFBWTtBQUN2QyxVQUFJO0FBQ0YsVUFBRSxZQUFZLEtBQUssRUFBRTtBQUFBLE1BQ3ZCLFNBQVMsSUFBSTtBQUFBLE1BRWI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQU1BLFdBQVMsZ0JBQWdCLEtBQUs7QUFDNUIsVUFBTTtBQUFBO0FBQUEsTUFBd0I7QUFBQTtBQUM5QixRQUFJLE9BQU8sRUFBRSw0QkFBNEIsV0FBWSxRQUFPO0FBQzVELFFBQUk7QUFDRixhQUFPLE9BQU8sRUFBRSx3QkFBd0IsR0FBRyxDQUFDLEtBQUs7QUFBQSxJQUNuRCxTQUFTLElBQUk7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
