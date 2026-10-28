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
    const previewEl = modal.querySelector("#reparto-import-preview");
    if (previewEl) {
      while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    }
    const applyBtn = modal.querySelector("#reparto-import-apply-btn");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.style.opacity = "0.4";
    }
    const fileInput = modal.querySelector("#reparto-import-file");
    if (fileInput) fileInput.value = "";
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
    const previewEl = document.getElementById("reparto-import-preview");
    const applyBtn = document.getElementById("reparto-import-apply-btn");
    if (previewEl) {
      while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
      previewEl.textContent = "Leyendo Excel\u2026";
    }
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.style.opacity = "0.4";
    }
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
      if (previewEl) {
        while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "color:#c7372f;padding:12px;background:rgba(255,59,48,.08);border-radius:8px";
        errDiv.textContent = "Error leyendo Excel: " + msg;
        previewEl.appendChild(errDiv);
      }
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
  function _renderImportPreview() {
    const previewEl = document.getElementById("reparto-import-preview");
    const applyBtn = document.getElementById("reparto-import-apply-btn");
    if (!previewEl || !_importState) return;
    const s = _importState;
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    const chipsRow = _mkDiv("display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px", null);
    const chipRec = _mkDiv(
      "flex:1;min-width:140px;padding:10px 14px;background:rgba(52,199,89,.14);border-radius:8px;color:#248a3d",
      null
    );
    chipRec.appendChild(
      _mkDiv("font-size:11px;letter-spacing:.5px;text-transform:uppercase", "Reconocidas")
    );
    chipRec.appendChild(
      _mkDiv("font-size:22px;font-weight:700;margin-top:2px", String(s.reconocidas.length))
    );
    chipsRow.appendChild(chipRec);
    const chipCamb = _mkDiv(
      "flex:1;min-width:140px;padding:10px 14px;background:rgba(0,122,255,.14);border-radius:8px;color:#0040dd",
      null
    );
    chipCamb.appendChild(
      _mkDiv("font-size:11px;letter-spacing:.5px;text-transform:uppercase", "Con cambios")
    );
    chipCamb.appendChild(
      _mkDiv("font-size:22px;font-weight:700;margin-top:2px", String(s.conCambios.length))
    );
    chipsRow.appendChild(chipCamb);
    const chipErr = _mkDiv(
      "flex:1;min-width:140px;padding:10px 14px;background:" + (s.errores.length ? "rgba(255,59,48,.14)" : "rgba(120,120,128,.08)") + ";border-radius:8px;color:" + (s.errores.length ? "#c7372f" : "#6e6e73"),
      null
    );
    chipErr.appendChild(
      _mkDiv("font-size:11px;letter-spacing:.5px;text-transform:uppercase", "Errores")
    );
    chipErr.appendChild(
      _mkDiv("font-size:22px;font-weight:700;margin-top:2px", String(s.errores.length))
    );
    chipsRow.appendChild(chipErr);
    previewEl.appendChild(chipsRow);
    if (s.errores.length) {
      const errBox = _mkDiv(
        "padding:12px 14px;background:rgba(255,59,48,.08);border-left:3px solid #c7372f;border-radius:6px;margin-bottom:12px",
        null
      );
      errBox.appendChild(
        _mkDiv(
          "font-weight:700;color:#c7372f;margin-bottom:6px",
          "Hay " + s.errores.length + " error(es). Corregilos y volv\xE9 a subir el Excel. No se aplica nada."
        )
      );
      const ul = document.createElement("ul");
      ul.style.cssText = "margin:0;padding-left:18px;color:#1d1d1f;font-size:12.5px;line-height:1.5";
      const slice = s.errores.slice(0, 50);
      for (const e of slice) {
        const li = document.createElement("li");
        li.textContent = e.msg;
        ul.appendChild(li);
      }
      errBox.appendChild(ul);
      if (s.errores.length > 50) {
        errBox.appendChild(
          _mkDiv(
            "color:#86868b;font-size:11px;margin-top:4px",
            "...y " + (s.errores.length - 50) + " m\xE1s (ver consola)"
          )
        );
      }
      previewEl.appendChild(errBox);
    }
    if (!s.errores.length && s.conCambios.length) {
      previewEl.appendChild(
        _mkDiv(
          "padding:10px 12px;background:rgba(52,199,89,.08);border-radius:6px;margin-bottom:12px;font-size:13px",
          "Resumen a aplicar: " + s.conCambios.length + " cambio(s) \xB7 " + s.totalAsignado + " u asignadas \xB7 " + s.totalEliminar + " u eliminadas"
        )
      );
      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      trh.style.cssText = "background:#f5f5f7";
      for (const h of ["SKU", "Cliente", "BO", "Asig.", "Elim."]) {
        const th = document.createElement("th");
        th.style.cssText = "padding:6px;text-align:" + (h === "SKU" || h === "Cliente" ? "left" : "right");
        th.textContent = h;
        trh.appendChild(th);
      }
      thead.appendChild(trh);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      const previewRows = s.conCambios.slice(0, 30);
      for (const r of previewRows) {
        const tr = document.createElement("tr");
        tr.style.cssText = "border-bottom:1px solid #eee";
        const addTd = (txt, css) => {
          const td = document.createElement("td");
          td.style.cssText = css;
          td.textContent = txt;
          tr.appendChild(td);
        };
        addTd(r.sku, "padding:4px 6px;font-family:monospace");
        addTd(r.clientName, "padding:4px 6px");
        addTd(String(r.backorderActual), "padding:4px 6px;text-align:right");
        addTd(
          r.asignadoNuevo ? String(r.asignadoNuevo) : "",
          "padding:4px 6px;text-align:right;color:#248a3d;font-weight:600"
        );
        addTd(
          r.eliminarNuevo ? String(r.eliminarNuevo) : "",
          "padding:4px 6px;text-align:right;color:#c7372f;font-weight:600"
        );
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      previewEl.appendChild(table);
      if (s.conCambios.length > 30) {
        previewEl.appendChild(
          _mkDiv(
            "color:#86868b;font-size:11px;margin-top:4px",
            "...y " + (s.conCambios.length - 30) + " m\xE1s"
          )
        );
      }
    }
    if (!s.errores.length && !s.conCambios.length) {
      previewEl.appendChild(
        _mkDiv(
          "padding:12px 14px;background:rgba(255,204,0,.14);border-radius:6px;color:#8a6d00",
          "El Excel no tiene cambios (Asignado=0 y Eliminar=0 en todas las filas). Nada que aplicar."
        )
      );
    }
    if (applyBtn) {
      const canApply = s.errores.length === 0 && s.conCambios.length > 0;
      applyBtn.disabled = !canApply;
      applyBtn.style.opacity = canApply ? "1" : "0.4";
    }
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
    box.style.cssText = "width:min(760px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;overflow:hidden";
    const head = document.createElement("div");
    head.style.cssText = "padding:18px 22px;border-bottom:0.5px solid rgba(0,0,0,.08);display:flex;align-items:center;gap:12px";
    const headTitleWrap = document.createElement("div");
    headTitleWrap.style.cssText = "flex:1";
    const h2 = document.createElement("h2");
    h2.style.cssText = "margin:0 0 2px;font-size:18px;font-weight:700;letter-spacing:-0.4px";
    h2.textContent = "Importar reparto desde Excel";
    headTitleWrap.appendChild(h2);
    const subt = document.createElement("div");
    subt.style.cssText = "font-size:12.5px;color:#86868b";
    subt.textContent = "Sub\xED el Excel editado offline. Se valida fila por fila antes de aplicar.";
    headTitleWrap.appendChild(subt);
    head.appendChild(headTitleWrap);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "\xD7";
    closeBtn.style.cssText = "border:none;background:rgba(120,120,128,.12);width:30px;height:30px;border-radius:50%;cursor:pointer;color:#6e6e73;font-size:16px";
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
    body.style.cssText = "padding:16px 22px;flex:1;overflow-y:auto;min-height:0";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "reparto-import-file";
    fileInput.accept = ".xlsx";
    fileInput.style.cssText = "margin-bottom:14px";
    fileInput.addEventListener("change", (ev) => {
      const w = (
        /** @type {any} */
        window
      );
      if (typeof w.handleRepartoImportFileChange === "function") w.handleRepartoImportFileChange(ev);
    });
    body.appendChild(fileInput);
    const previewDiv = document.createElement("div");
    previewDiv.id = "reparto-import-preview";
    previewDiv.style.cssText = "min-height:40px";
    body.appendChild(previewDiv);
    box.appendChild(body);
    const foot = document.createElement("div");
    foot.style.cssText = "padding:14px 22px;border-top:0.5px solid rgba(0,0,0,.08);display:flex;gap:10px;justify-content:flex-end";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.style.cssText = "padding:9px 18px;border:0.5px solid rgba(0,0,0,.12);background:#fff;border-radius:999px;cursor:pointer;font-size:13px";
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
    applyBtn.textContent = "Aplicar reparto importado";
    applyBtn.style.cssText = "padding:9px 18px;border:none;background:#248a3d;color:#fff;border-radius:999px;cursor:pointer;font-size:13px;font-weight:600;opacity:0.4";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1yZXBhcnRvLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLyoqXG4gKiBleHBvcnRzLXJlcGFydG8gKHYxNTA1LCAyMDI2LTEwLTI4KSBcdTIwMTQgY2h1bmsgbGF6eSBwYXJhIGVsIGZsb3cgZGUgZXhwb3J0ICtcbiAqIGltcG9ydCBFeGNlbCBkZWwgUmVwYXJ0byBkZSBpbmdyZXNvcy5cbiAqXG4gKiBEb3MgaGFuZGxlcnMgcHJpbmNpcGFsZXMgZXhwdWVzdG9zIGEgd2luZG93OlxuICogICAtIHdpbmRvdy5leHBvcnRSZXBhcnRvTWFudWFsRXhjZWwoKSAgXHUyMDE0IHRlbXBsYXRlIGVkaXRhYmxlIGNvbiA5IGNvbHVtbmFzXG4gKiAgICAgKDcgdmlzaWJsZXMgKyAyIHRcdTAwRTljbmljYXMgYWwgZmluYWwsIGdyaXNlcyB5IHByb3RlZ2lkYXMpLlxuICogICAtIHdpbmRvdy5vcGVuUmVwYXJ0b0ltcG9ydERpYWxvZygpICAgXHUyMDE0IG1vZGFsIGNvbiA8aW5wdXQgdHlwZT1maWxlPixcbiAqICAgICBwcmV2aWV3IGRlIHZhbGlkYWNpXHUwMEYzbiwgeSBib3RcdTAwRjNuIFwiQXBsaWNhciByZXBhcnRvIGltcG9ydGFkb1wiLlxuICpcbiAqIEZ1ZW50ZSBcdTAwRkFuaWNhOiBwdXJlIGZuc1xuICogICAtIHNyYy9wdXJlL3JlcGFydG8tZXhjZWwtZXhwb3J0LXJvd3MuanMgXHUyMDE0IGFybWFkbyBkZSBmaWxhcy5cbiAqICAgLSBzcmMvcHVyZS9yZXBhcnRvLWV4Y2VsLWltcG9ydC12YWxpZGF0b3IuanMgXHUyMDE0IHZhbGlkYWNpXHUwMEYzbiBwb3IgZmlsYS5cbiAqXG4gKiBQYXlsb2FkIHNlcnZlcjogU0lFTVBSRSB2aWEgYGFwcGx5UmVwYXJ0b01hbnVhbENGYCAoY2FsbGFibGUpLiBOVU5DQVxuICogZXNjcml0dXJhIGRpcmVjdGEgYSBGaXJlc3RvcmUgKENMQVVERS5tZCBcdTAwQTc2MyBwYXR0ZXJuKS5cbiAqXG4gKiBMb2c6IGByZXBhcnRvX2xvZ2AgY29uIGBvcmlnZW49J2ltcG9ydCdgICsgZmlsZU5hbWUgKyBpbXBvcnRlZEJ5VWlkICsgLi4uXG4gKi9cblxuLyoqXG4gKiBMYXp5IGxvYWRlciBwYXJhIEV4Y2VsSlMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gX2Vuc3VyZUV4Y2VsSlMoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5sb2FkRXhjZWxKUyA9PT0gJ2Z1bmN0aW9uJykgYXdhaXQgdy5sb2FkRXhjZWxKUygpO1xuICBpZiAoIXcuRXhjZWxKUykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbEpTIG5vIGRpc3BvbmlibGUnKTtcbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gbXNnXG4gKiBAcGFyYW0ge251bWJlcn0gW21zXVxuICovXG5mdW5jdGlvbiBfc3luY1RhZyhtc2csIG1zKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5zaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICB3LnNob3dTeW5jVGFnKG1zZywgbXMpO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gc2t1XG4gKiBAcmV0dXJucyB7bnVtYmVyfVxuICovXG5mdW5jdGlvbiBfZ2V0U3RvY2tGaXNpY28oc2t1KSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIDA7XG4gIHRyeSB7XG4gICAgcmV0dXJuIE51bWJlcih3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhKHNrdSkpIHx8IDA7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbn1cblxuLyoqXG4gKiBAcmV0dXJucyB7e3NlYXJjaDogc3RyaW5nLCBoaWRlTm9TdG9jazogYm9vbGVhbn19XG4gKi9cbmZ1bmN0aW9uIF9yZWFkRmlsdHJvc01vZGFsUmVwYXJ0bygpIHtcbiAgY29uc3Qgc0VsID0gdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyA/IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLXNlYXJjaCcpIDogbnVsbDtcbiAgY29uc3QgaEVsID1cbiAgICB0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnID8gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taGlkZS1ub3N0b2NrJykgOiBudWxsO1xuICByZXR1cm4ge1xuICAgIHNlYXJjaDogc0VsID8gU3RyaW5nKC8qKiBAdHlwZSB7YW55fSAqLyAoc0VsKS52YWx1ZSB8fCAnJykudHJpbSgpIDogJycsXG4gICAgaGlkZU5vU3RvY2s6IGhFbCA/ICEhKC8qKiBAdHlwZSB7YW55fSAqLyAoaEVsKS5jaGVja2VkKSA6IHRydWUsXG4gIH07XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IGV4cG9ydEtpbmRcbiAqIEBwYXJhbSB7c3RyaW5nfSBtc2dcbiAqL1xuZnVuY3Rpb24gX2xvZ0V4cG9ydEVycm9yKGV4cG9ydEtpbmQsIG1zZykge1xuICB0cnkge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKCF3LmZiRGIgfHwgdHlwZW9mIHcuZmJEYi5jb2xsZWN0aW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm47XG4gICAgdy5mYkRiXG4gICAgICAuY29sbGVjdGlvbignb3BlcmF0aW9uc19sb2cnKVxuICAgICAgLmFkZCh7XG4gICAgICAgIHR5cGU6ICdleHBvcnRfZmFpbGVkJyxcbiAgICAgICAgZXhwb3J0S2luZCxcbiAgICAgICAgZXJyb3I6IG1zZy5zbGljZSgwLCA1MDApLFxuICAgICAgICB1c2VyVWlkOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLnVpZCkgfHwgbnVsbCxcbiAgICAgICAgdXNlckVtYWlsOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCBudWxsLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgLyogaWdub3JlICovXG4gICAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICAvKiBpZ25vcmUgKi9cbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBUlRFIDEgXHUyMDE0IEV4cG9ydCBtYW51YWwgKHRlbXBsYXRlIGVkaXRhYmxlKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5leHBvcnRSZXBhcnRvTWFudWFsRXhjZWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIHBhcmEgZXhwb3J0YXIuIEFiclx1MDBFRCBlbCBtb2RhbCBcIlJlcGFydG8gZGUgaW5ncmVzb3NcIiBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBfc3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGVkaXRhYmxlXHUyMDI2Jyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcHVyZU1vZCA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5yZXBhcnRvRXhjZWxFeHBvcnQ7XG4gICAgaWYgKCFwdXJlTW9kIHx8IHR5cGVvZiBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B1cmUgZm4gcmVwYXJ0b0V4Y2VsRXhwb3J0IG5vIGRpc3BvbmlibGUnKTtcbiAgICB9XG4gICAgY29uc3QgY29uc29saWRhdGVGbiA9XG4gICAgICB3Ll9fcGhhc2UwICYmXG4gICAgICB3Ll9fcGhhc2UwLnB1cmUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUuY29uc29saWRhdGVDbGllbnRlc0JPO1xuICAgIGNvbnN0IGZpbHRyb3MgPSBfcmVhZEZpbHRyb3NNb2RhbFJlcGFydG8oKTtcbiAgICBjb25zdCByZXN1bHQgPSBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzKGluZ3Jlc29zLCBmaWx0cm9zLCB7XG4gICAgICBnZXRTdG9ja0Zpc2ljbzogX2dldFN0b2NrRmlzaWNvLFxuICAgICAgY29uc29saWRhdGVGbjogdHlwZW9mIGNvbnNvbGlkYXRlRm4gPT09ICdmdW5jdGlvbicgPyBjb25zb2xpZGF0ZUZuIDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICAgIGlmICghcmVzdWx0LnJvd3MubGVuZ3RoKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ05vIGhheSBmaWxhcyBwYXJhIGV4cG9ydGFyIGNvbiBsb3MgZmlsdHJvcyBhY3R1YWxlcy4gTGltcGlcdTAwRTEgYlx1MDBGQXNxdWVkYSBvIGRlc3RpbGRcdTAwRTEgXCJPY3VsdGFyIHNpbiBzdG9ja1wiLidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgX2Vuc3VyZUV4Y2VsSlMoKTtcbiAgICBjb25zdCBFeGNlbEpTID0gdy5FeGNlbEpTO1xuICAgIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVwYXJ0bycpO1xuXG4gICAgd3MuY29sdW1ucyA9IFtcbiAgICAgIHsgaGVhZGVyOiAnQ29kaWdvJywga2V5OiAnQ29kaWdvJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0NsaWVudGUnLCBrZXk6ICdDbGllbnRlJywgd2lkdGg6IDM2IH0sXG4gICAgICB7IGhlYWRlcjogJ0JhY2tvcmRlcicsIGtleTogJ0JhY2tvcmRlcicsIHdpZHRoOiAxMiB9LFxuICAgICAgeyBoZWFkZXI6ICdTdG9jayBkaXNwb25pYmxlJywga2V5OiAnU3RvY2tEaXNwb25pYmxlJywgd2lkdGg6IDE1IH0sXG4gICAgICB7IGhlYWRlcjogJ0FzaWduYWRvJywga2V5OiAnQXNpZ25hZG8nLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnVnVlbHZlIGEgYmFja29yZGVyJywga2V5OiAnVnVlbGVBQmFja29yZGVyJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0VsaW1pbmFyJywga2V5OiAnRWxpbWluYXInLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnUmVwYXJ0byBJRCcsIGtleTogJ1JlcGFydG9JZCcsIHdpZHRoOiAyNCB9LFxuICAgICAgeyBoZWFkZXI6ICdDYXJkQ29kZScsIGtleTogJ0NhcmRDb2RlJywgd2lkdGg6IDE2IH0sXG4gICAgXTtcblxuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmdldFJvdygxKTtcbiAgICBoZWFkZXJSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2NjUzNCcgfSB9O1xuICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAgIGNlbGwuYm9yZGVyID0ge1xuICAgICAgICB0b3A6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIGxlZnQ6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIHJpZ2h0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9LFxuICAgICAgICBib3R0b206IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICB9O1xuICAgIH0pO1xuICAgIGhlYWRlclJvdy5oZWlnaHQgPSAyODtcbiAgICBoZWFkZXJSb3cuZ2V0Q2VsbCg4KS5maWxsID0ge1xuICAgICAgdHlwZTogJ3BhdHRlcm4nLFxuICAgICAgcGF0dGVybjogJ3NvbGlkJyxcbiAgICAgIGZnQ29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LFxuICAgIH07XG4gICAgaGVhZGVyUm93LmdldENlbGwoOSkuZmlsbCA9IHtcbiAgICAgIHR5cGU6ICdwYXR0ZXJuJyxcbiAgICAgIHBhdHRlcm46ICdzb2xpZCcsXG4gICAgICBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjg4ODg4OCcgfSxcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN1bHQucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgciA9IHJlc3VsdC5yb3dzW2ldO1xuICAgICAgLy8gdjE1MTIgKDIwMjYtMTAtMjgpOiBmaWxhIGF2aXNvIFNLVSBtdWx0aS1yZXBhcnRvIChDb2RpZ28gPT09ICcnLCBfbm90aWNlPXRydWUpLlxuICAgICAgLy8gU2UgcmVuZGVyaXphIGNvbiBmb25kbyBhbWFyaWxsbyArIHNvbG8gbGFzIGNlbGRhcyBDb2RpZ28rQ2xpZW50ZSBvY3VwYWRhcztcbiAgICAgIC8vIGltcG9ydCB2YWxpZGF0b3IgbGEgaWdub3JhIHBvciBgQ29kaWdvID09PSAnJ2AuXG4gICAgICBpZiAociAmJiAoci5fbm90aWNlID09PSB0cnVlIHx8IHIuQ29kaWdvID09PSAnJykpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgICAgICBDb2RpZ286ICcnLFxuICAgICAgICAgIENsaWVudGU6IHIuQ2xpZW50ZSB8fCAnJyxcbiAgICAgICAgICBCYWNrb3JkZXI6IG51bGwsXG4gICAgICAgICAgU3RvY2tEaXNwb25pYmxlOiBudWxsLFxuICAgICAgICAgIEFzaWduYWRvOiBudWxsLFxuICAgICAgICAgIFZ1ZWxlQUJhY2tvcmRlcjogbnVsbCxcbiAgICAgICAgICBFbGltaW5hcjogbnVsbCxcbiAgICAgICAgICBSZXBhcnRvSWQ6ICcnLFxuICAgICAgICAgIENhcmRDb2RlOiAnJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkZGRUI5OScgfSB9O1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGNzgzNTBGJyB9LCBib2xkOiB0cnVlLCBzaXplOiAxMSB9O1xuICAgICAgICAgIGNlbGwuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gICAgICAgICAgLy8gRmlsYSBhdmlzbyBibG9xdWVhZGEgKHVzZXIgbm8gcHVlZGUgZWRpdGFyIGVsIGF2aXNvKS5cbiAgICAgICAgICBjZWxsLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgICBDb2RpZ286IHIuQ29kaWdvLFxuICAgICAgICBDbGllbnRlOiByLkNsaWVudGUsXG4gICAgICAgIEJhY2tvcmRlcjogci5CYWNrb3JkZXIsXG4gICAgICAgIFN0b2NrRGlzcG9uaWJsZTogci5TdG9ja0Rpc3BvbmlibGUsXG4gICAgICAgIEFzaWduYWRvOiByLkFzaWduYWRvLFxuICAgICAgICBWdWVsZUFCYWNrb3JkZXI6IG51bGwsXG4gICAgICAgIEVsaW1pbmFyOiByLkVsaW1pbmFyLFxuICAgICAgICBSZXBhcnRvSWQ6IHIuUmVwYXJ0b0lkLFxuICAgICAgICBDYXJkQ29kZTogci5DYXJkQ29kZSxcbiAgICAgIH0pO1xuICAgICAgcm93LmdldENlbGwoNikudmFsdWUgPSB7XG4gICAgICAgIGZvcm11bGE6IHIuVnVlbGVBQmFja29yZGVyLnJlcGxhY2UoL149LywgJycpLFxuICAgICAgICByZXN1bHQ6IHIuQmFja29yZGVyIC0gci5Bc2lnbmFkbyAtIHIuRWxpbWluYXIsXG4gICAgICB9O1xuICAgICAgcm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICAgIGNlbGwuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gICAgICAgIGNlbGwuYm9yZGVyID0ge1xuICAgICAgICAgIHRvcDogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgICBsZWZ0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICAgIHJpZ2h0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICAgIGJvdHRvbTogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgICAgcm93LmdldENlbGwoOCkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkY1RjVGNScgfSB9O1xuICAgICAgcm93LmdldENlbGwoOCkuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LCBzaXplOiAxMCB9O1xuICAgICAgcm93LmdldENlbGwoOSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkY1RjVGNScgfSB9O1xuICAgICAgcm93LmdldENlbGwoOSkuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LCBzaXplOiAxMCB9O1xuICAgICAgcm93LmdldENlbGwoMSkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCgyKS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDMpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoNCkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg1KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IGZhbHNlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg2KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDcpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogZmFsc2UgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDgpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoOSkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgfVxuXG4gICAgd3Mudmlld3MgPSBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XTtcblxuICAgIC8vIHYxNTEyICgyMDI2LTEwLTI4KTogaGFiaWxpdGFyIGF1dG9maWx0cm8gKyBzb3J0IGVuIGxhIGhvamEgcHJvdGVnaWRhLlxuICAgIC8vIFBhYmxvIHJlcG9ydFx1MDBGMyBxdWUgXCJPcmRlbmFyIHkgZmlsdHJhclwiIGVuIEV4Y2VsIGRlc2t0b3AgYXBhcmVjXHUwMEVEYSBkZXNoYWJpbGl0YWRvOlxuICAgIC8vIGZhbHRhYmEgYHdzLmF1dG9GaWx0ZXJgIHF1ZSBtYXJjYSBlbCByYW5nbyBjb21vIGF1dG9maWx0ZXIgKyBgc29ydDogdHJ1ZWAgZW5cbiAgICAvLyBsYSBwcm90ZWNjaVx1MDBGM24gcGVybWl0ZSBvcmRlbmFyIGxhcyBjZWxkYXMgZGVzYmxvcXVlYWRhcyAoQXNpZ25hZG8gKyBFbGltaW5hcikuXG4gICAgLy8gTGFzIGNlbGRhcyBibG9xdWVhZGFzIChDb2RpZ28sIENsaWVudGUsIEJhY2tvcmRlciwgU3RvY2ssIFZ1ZWxlQUJPLCBSZXBhcnRvSWQsXG4gICAgLy8gQ2FyZENvZGUpIHNpZ3VlbiBibG9xdWVhZGFzOyBzb3J0IHkgZmlsdGVyIHRyYWJhamFuIHNvYnJlIGVsIGNvbmp1bnRvIGNvbXBsZXRvLlxuICAgIGNvbnN0IF9sYXN0Um93ID0gKHJlc3VsdC5yb3dzID8gcmVzdWx0LnJvd3MubGVuZ3RoIDogMCkgKyAxOyAvLyArMSBwb3IgaGVhZGVyXG4gICAgd3MuYXV0b0ZpbHRlciA9IHsgZnJvbTogeyByb3c6IDEsIGNvbHVtbjogMSB9LCB0bzogeyByb3c6IF9sYXN0Um93LCBjb2x1bW46IDkgfSB9O1xuXG4gICAgYXdhaXQgd3MucHJvdGVjdCgnJywge1xuICAgICAgc2VsZWN0TG9ja2VkQ2VsbHM6IHRydWUsXG4gICAgICBzZWxlY3RVbmxvY2tlZENlbGxzOiB0cnVlLFxuICAgICAgZm9ybWF0Q2VsbHM6IGZhbHNlLFxuICAgICAgc29ydDogdHJ1ZSwgLy8gdjE1MTI6IHBlcm1pdGUgb3JkZW5hclxuICAgICAgYXV0b0ZpbHRlcjogdHJ1ZSwgLy8gcGVybWl0ZSBmaWx0cmFyICh5YSBlc3RhYmEpXG4gICAgfSk7XG5cbiAgICBjb25zdCBmaWxlbmFtZSA9IHB1cmVNb2QuYnVpbGRSZXBhcnRvRXhjZWxGaWxlTmFtZVxuICAgICAgPyBwdXJlTW9kLmJ1aWxkUmVwYXJ0b0V4Y2VsRmlsZU5hbWUobmV3IERhdGUoKSlcbiAgICAgIDogJ1JlcGFydG9fJyArXG4gICAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgK1xuICAgICAgICAnXycgK1xuICAgICAgICBuZXcgRGF0ZSgpLnRvVGltZVN0cmluZygpLnNsaWNlKDAsIDUpLnJlcGxhY2UoJzonLCAnJykgK1xuICAgICAgICAnLnhsc3gnO1xuXG4gICAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBhLnJlbW92ZSgpO1xuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcblxuICAgIF9zeW5jVGFnKFxuICAgICAgJ0V4Y2VsIGVkaXRhYmxlIGxpc3RvICgnICsgcmVzdWx0LnJvd3MubGVuZ3RoICsgJyBmaWxhcyBcdTAwQjcgJyArIHJlc3VsdC50b3RhbEJhY2tvcmRlciArICd1IEJPKScsXG4gICAgICAzMjAwXG4gICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IChlICYmIC8qKiBAdHlwZSB7YW55fSAqLyAoZSkubWVzc2FnZSkgfHwgU3RyaW5nKGUpO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1t2MTUwNSBcdTAwQTdSZXBhcnRvXSBleHBvcnRSZXBhcnRvTWFudWFsRXhjZWwgZmFsbFx1MDBGMzonLCBlKTtcbiAgICBhbGVydCgnTm8gcHVkaW1vcyBnZW5lcmFyIGVsIEV4Y2VsIGVkaXRhYmxlLiBWb2x2XHUwMEU5IGEgaW50ZW50YXI7IHNpIHNpZ3VlLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICBfbG9nRXhwb3J0RXJyb3IoJ2V4cG9ydF9tYW51YWwnLCBtc2cpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBUlRFIDIgXHUyMDE0IEltcG9ydCBFeGNlbFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmxldCBfaW1wb3J0U3RhdGUgPSAvKiogQHR5cGUge251bGwgfCB7XG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHJlY29ub2NpZGFzOiBBcnJheTxhbnk+LFxuICBjb25DYW1iaW9zOiBBcnJheTxhbnk+LFxuICBlcnJvcmVzOiBBcnJheTxhbnk+LFxuICB0b3RhbEZpbGFzOiBudW1iZXIsXG4gIHRvdGFsQXNpZ25hZG86IG51bWJlcixcbiAgdG90YWxFbGltaW5hcjogbnVtYmVyLFxufX0gKi8gKG51bGwpO1xuXG4vKipcbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5mdW5jdGlvbiBfaXNBZG1pbkxpa2VGb3JJbXBvcnQoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IHJvbGUgPSAody51c2VyUm9sZSB8fCAnJykudG9Mb3dlckNhc2UoKTtcbiAgaWYgKHJvbGUgPT09ICdhZG1pbicgfHwgcm9sZSA9PT0gJ2dlcmVudGUnKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgZW1haWwgPSBTdHJpbmcoKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGlmIChlbWFpbCA9PT0gJ3BhYmxvLmdvbnphbGV6QHNoaW1hbm8uY29tLmFyJyB8fCBlbWFpbCA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJykgcmV0dXJuIHRydWU7XG4gIHJldHVybiBmYWxzZTtcbn1cblxud2luZG93Lm9wZW5SZXBhcnRvSW1wb3J0RGlhbG9nID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIV9pc0FkbWluTGlrZUZvckltcG9ydCgpKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGltcG9ydGFyIHJlcGFydG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIGFjdGl2b3MuIEFiclx1MDBFRCBlbCBtb2RhbCBSZXBhcnRvIHByaW1lcm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSB7XG4gICAgbW9kYWwgPSBfYnVpbGRJbXBvcnRNb2RhbERvbSgpO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobW9kYWwpO1xuICB9XG4gIF9pbXBvcnRTdGF0ZSA9IG51bGw7XG4gIGNvbnN0IHByZXZpZXdFbCA9IG1vZGFsLnF1ZXJ5U2VsZWN0b3IoJyNyZXBhcnRvLWltcG9ydC1wcmV2aWV3Jyk7XG4gIGlmIChwcmV2aWV3RWwpIHtcbiAgICB3aGlsZSAocHJldmlld0VsLmZpcnN0Q2hpbGQpIHByZXZpZXdFbC5yZW1vdmVDaGlsZChwcmV2aWV3RWwuZmlyc3RDaGlsZCk7XG4gIH1cbiAgY29uc3QgYXBwbHlCdG4gPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmIChhcHBseUJ0bikge1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5zdHlsZS5vcGFjaXR5ID0gJzAuNCc7XG4gIH1cbiAgY29uc3QgZmlsZUlucHV0ID0gbW9kYWwucXVlcnlTZWxlY3RvcignI3JlcGFydG8taW1wb3J0LWZpbGUnKTtcbiAgaWYgKGZpbGVJbnB1dCkgLyoqIEB0eXBlIHthbnl9ICovIChmaWxlSW5wdXQpLnZhbHVlID0gJyc7XG4gIC8qKiBAdHlwZSB7YW55fSAqLyAobW9kYWwpLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7XG59O1xuXG53aW5kb3cuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1tb2RhbCcpO1xuICBpZiAobW9kYWwpIC8qKiBAdHlwZSB7YW55fSAqLyAobW9kYWwpLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIF9pbXBvcnRTdGF0ZSA9IG51bGw7XG59O1xuXG4vKipcbiAqIEBwYXJhbSB7RXZlbnR9IGV2XG4gKi9cbndpbmRvdy5oYW5kbGVSZXBhcnRvSW1wb3J0RmlsZUNoYW5nZSA9IGFzeW5jIGZ1bmN0aW9uIChldikge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBjb25zdCB0Z3QgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR9ICovIChldi50YXJnZXQpO1xuICBjb25zdCBmaWxlID0gdGd0ICYmIHRndC5maWxlcyAmJiB0Z3QuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICBjb25zdCBwcmV2aWV3RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtcHJldmlldycpO1xuICBjb25zdCBhcHBseUJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nKTtcbiAgaWYgKHByZXZpZXdFbCkge1xuICAgIHdoaWxlIChwcmV2aWV3RWwuZmlyc3RDaGlsZCkgcHJldmlld0VsLnJlbW92ZUNoaWxkKHByZXZpZXdFbC5maXJzdENoaWxkKTtcbiAgICBwcmV2aWV3RWwudGV4dENvbnRlbnQgPSAnTGV5ZW5kbyBFeGNlbFx1MjAyNic7XG4gIH1cbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgLyoqIEB0eXBlIHthbnl9ICovIChhcHBseUJ0bikuZGlzYWJsZWQgPSB0cnVlO1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLm9wYWNpdHkgPSAnMC40JztcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IF9lbnN1cmVFeGNlbEpTKCk7XG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xuICAgIGNvbnN0IHdiID0gbmV3IHcuRXhjZWxKUy5Xb3JrYm9vaygpO1xuICAgIGF3YWl0IHdiLnhsc3gubG9hZChidWYpO1xuICAgIGNvbnN0IHdzID0gd2Iud29ya3NoZWV0c1swXTtcbiAgICBpZiAoIXdzKSB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsIHNpbiBob2phcycpO1xuXG4gICAgY29uc3QgaGVhZGVyTWFwID0gX2J1aWxkSGVhZGVyTWFwKHdzKTtcbiAgICAvKiogQHR5cGUge0FycmF5PGFueT59ICovXG4gICAgY29uc3Qgcm93cyA9IFtdO1xuICAgIHdzLmVhY2hSb3coKHJvdywgcm4pID0+IHtcbiAgICAgIGlmIChybiA9PT0gMSkgcmV0dXJuO1xuICAgICAgLyoqIEB0eXBlIHthbnl9ICovXG4gICAgICBjb25zdCBvYmogPSB7IF9fcm93SW5kZXg6IHJuIH07XG4gICAgICByb3cuZWFjaENlbGwoeyBpbmNsdWRlRW1wdHk6IHRydWUgfSwgKGNlbGwsIGNvbElkeCkgPT4ge1xuICAgICAgICBjb25zdCBjYW5vbktleSA9IGhlYWRlck1hcFtjb2xJZHhdO1xuICAgICAgICBpZiAoIWNhbm9uS2V5KSByZXR1cm47XG4gICAgICAgIGxldCB2ID0gY2VsbC52YWx1ZTtcbiAgICAgICAgaWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICd0ZXh0JyBpbiB2KSB2ID0gdi50ZXh0O1xuICAgICAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgJ3Jlc3VsdCcgaW4gdikgdiA9IHYucmVzdWx0O1xuICAgICAgICBvYmpbY2Fub25LZXldID0gdjtcbiAgICAgIH0pO1xuICAgICAgaWYgKCFvYmouUmVwYXJ0b0lkICYmICFvYmouQ2FyZENvZGUgJiYgIW9iai5Db2RpZ28pIHJldHVybjtcbiAgICAgIHJvd3MucHVzaChvYmopO1xuICAgIH0pO1xuXG4gICAgY29uc3QgaW5ncmVzb3MgPSBBcnJheS5pc0FycmF5KHcuX3JlcGFydG9JbmdyZXNvcykgPyB3Ll9yZXBhcnRvSW5ncmVzb3MgOiBbXTtcbiAgICBjb25zdCByZXBhcnRvc0FjdGl2b3MgPSBpbmdyZXNvcy5tYXAoKC8qKiBAdHlwZSB7YW55fSAqLyBpKSA9PiAoe1xuICAgICAgX2lkOiBpLl9pZCxcbiAgICAgIHNrdTogaS5za3UsXG4gICAgICBzdGF0dXM6IGkuc3RhdHVzIHx8ICdwZW5kaW5nJyxcbiAgICAgIHN0b2NrRGlzcG9uaWJsZTogX2dldFN0b2NrRmlzaWNvKGkuc2t1KSxcbiAgICAgIGNsaWVudGVzQk86IEFycmF5LmlzQXJyYXkoaS5jbGllbnRlc0JPKSA/IGkuY2xpZW50ZXNCTyA6IFtdLFxuICAgIH0pKTtcblxuICAgIGNvbnN0IHZhbGlkYXRvciA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5yZXBhcnRvRXhjZWxJbXBvcnQ7XG4gICAgaWYgKCF2YWxpZGF0b3IgfHwgdHlwZW9mIHZhbGlkYXRvci52YWxpZGF0ZVJlcGFydG9FeGNlbEltcG9ydCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdwdXJlIGZuIHJlcGFydG9FeGNlbEltcG9ydCBubyBkaXNwb25pYmxlJyk7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IHZhbGlkYXRvci52YWxpZGF0ZVJlcGFydG9FeGNlbEltcG9ydChyb3dzLCByZXBhcnRvc0FjdGl2b3MpO1xuICAgIF9pbXBvcnRTdGF0ZSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlLm5hbWUsXG4gICAgICByZWNvbm9jaWRhczogcmVzdWx0LnJlY29ub2NpZGFzLFxuICAgICAgY29uQ2FtYmlvczogcmVzdWx0LmNvbkNhbWJpb3MsXG4gICAgICBlcnJvcmVzOiByZXN1bHQuZXJyb3JlcyxcbiAgICAgIHRvdGFsRmlsYXM6IHJlc3VsdC50b3RhbEZpbGFzLFxuICAgICAgdG90YWxBc2lnbmFkbzogcmVzdWx0LnRvdGFsQXNpZ25hZG8sXG4gICAgICB0b3RhbEVsaW1pbmFyOiByZXN1bHQudG90YWxFbGltaW5hcixcbiAgICB9O1xuICAgIF9yZW5kZXJJbXBvcnRQcmV2aWV3KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSAoZSAmJiAvKiogQHR5cGUge2FueX0gKi8gKGUpLm1lc3NhZ2UpIHx8IFN0cmluZyhlKTtcbiAgICBjb25zb2xlLmVycm9yKCdbdjE1MDUgXHUwMEE3UmVwYXJ0b10gaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UgZXJyb3I6JywgZSk7XG4gICAgaWYgKHByZXZpZXdFbCkge1xuICAgICAgd2hpbGUgKHByZXZpZXdFbC5maXJzdENoaWxkKSBwcmV2aWV3RWwucmVtb3ZlQ2hpbGQocHJldmlld0VsLmZpcnN0Q2hpbGQpO1xuICAgICAgY29uc3QgZXJyRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICBlcnJEaXYuc3R5bGUuY3NzVGV4dCA9XG4gICAgICAgICdjb2xvcjojYzczNzJmO3BhZGRpbmc6MTJweDtiYWNrZ3JvdW5kOnJnYmEoMjU1LDU5LDQ4LC4wOCk7Ym9yZGVyLXJhZGl1czo4cHgnO1xuICAgICAgZXJyRGl2LnRleHRDb250ZW50ID0gJ0Vycm9yIGxleWVuZG8gRXhjZWw6ICcgKyBtc2c7XG4gICAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoZXJyRGl2KTtcbiAgICB9XG4gICAgX2xvZ0V4cG9ydEVycm9yKCdpbXBvcnRfcmVhZCcsIG1zZyk7XG4gIH1cbn07XG5cbi8qKlxuICogQHBhcmFtIHthbnl9IHdzXG4gKiBAcmV0dXJucyB7T2JqZWN0PG51bWJlcixzdHJpbmc+fVxuICovXG5mdW5jdGlvbiBfYnVpbGRIZWFkZXJNYXAod3MpIHtcbiAgLyoqIEB0eXBlIHtPYmplY3Q8bnVtYmVyLHN0cmluZz59ICovXG4gIGNvbnN0IG91dCA9IHt9O1xuICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMSk7XG4gIGhlYWRlclJvdy5lYWNoQ2VsbChcbiAgICB7IGluY2x1ZGVFbXB0eTogZmFsc2UgfSxcbiAgICAoLyoqIEB0eXBlIHthbnl9ICovIGNlbGwsIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyBjb2wpID0+IHtcbiAgICAgIGxldCB2ID0gY2VsbC52YWx1ZTtcbiAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAndGV4dCcgaW4gdikgdiA9IHYudGV4dDtcbiAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAncmVzdWx0JyBpbiB2KSB2ID0gdi5yZXN1bHQ7XG4gICAgICBjb25zdCBsYWJlbCA9IFN0cmluZyh2IHx8ICcnKVxuICAgICAgICAudHJpbSgpXG4gICAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKCFsYWJlbCkgcmV0dXJuO1xuICAgICAgaWYgKGxhYmVsID09PSAnY29kaWdvJyB8fCBsYWJlbCA9PT0gJ2NcdTAwRjNkaWdvJykgb3V0W2NvbF0gPSAnQ29kaWdvJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnY2xpZW50ZScpIG91dFtjb2xdID0gJ0NsaWVudGUnO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdiYWNrb3JkZXInKSBvdXRbY29sXSA9ICdCYWNrb3JkZXInO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdzdG9jayBkaXNwb25pYmxlJyB8fCBsYWJlbCA9PT0gJ3N0b2NrX2Rpc3BvbmlibGUnKVxuICAgICAgICBvdXRbY29sXSA9ICdTdG9ja0Rpc3BvbmlibGUnO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdhc2lnbmFkbycpIG91dFtjb2xdID0gJ0FzaWduYWRvJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAndnVlbHZlIGEgYmFja29yZGVyJykgb3V0W2NvbF0gPSAnVnVlbGVBQmFja29yZGVyJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnZWxpbWluYXInKSBvdXRbY29sXSA9ICdFbGltaW5hcic7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ3JlcGFydG8gaWQnIHx8IGxhYmVsID09PSAncmVwYXJ0b2lkJyB8fCBsYWJlbCA9PT0gJ3JlcGFydG9faWQnKVxuICAgICAgICBvdXRbY29sXSA9ICdSZXBhcnRvSWQnO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdjYXJkY29kZScgfHwgbGFiZWwgPT09ICdjYXJkIGNvZGUnIHx8IGxhYmVsID09PSAnY2FyZF9jb2RlJylcbiAgICAgICAgb3V0W2NvbF0gPSAnQ2FyZENvZGUnO1xuICAgIH1cbiAgKTtcbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDcmVhIHVuIGRpdiBjb24gY2xhc3Mvc3R5bGUvdGV4dCBzZWd1cm9zLlxuICogQHBhcmFtIHtzdHJpbmd9IHN0eWxlQ3NzXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IHRleHRWYWx1ZVxuICogQHJldHVybnMge0hUTUxEaXZFbGVtZW50fVxuICovXG5mdW5jdGlvbiBfbWtEaXYoc3R5bGVDc3MsIHRleHRWYWx1ZSkge1xuICBjb25zdCBkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGQuc3R5bGUuY3NzVGV4dCA9IHN0eWxlQ3NzO1xuICBpZiAodGV4dFZhbHVlICE9IG51bGwpIGQudGV4dENvbnRlbnQgPSB0ZXh0VmFsdWU7XG4gIHJldHVybiBkO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVySW1wb3J0UHJldmlldygpIHtcbiAgY29uc3QgcHJldmlld0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LXByZXZpZXcnKTtcbiAgY29uc3QgYXBwbHlCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmICghcHJldmlld0VsIHx8ICFfaW1wb3J0U3RhdGUpIHJldHVybjtcbiAgY29uc3QgcyA9IF9pbXBvcnRTdGF0ZTtcbiAgd2hpbGUgKHByZXZpZXdFbC5maXJzdENoaWxkKSBwcmV2aWV3RWwucmVtb3ZlQ2hpbGQocHJldmlld0VsLmZpcnN0Q2hpbGQpO1xuXG4gIC8vIENoaXBzIGRlIHJlc3VtZW4uXG4gIGNvbnN0IGNoaXBzUm93ID0gX21rRGl2KCdkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7ZmxleC13cmFwOndyYXA7bWFyZ2luLWJvdHRvbToxNHB4JywgbnVsbCk7XG4gIGNvbnN0IGNoaXBSZWMgPSBfbWtEaXYoXG4gICAgJ2ZsZXg6MTttaW4td2lkdGg6MTQwcHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDpyZ2JhKDUyLDE5OSw4OSwuMTQpO2JvcmRlci1yYWRpdXM6OHB4O2NvbG9yOiMyNDhhM2QnLFxuICAgIG51bGxcbiAgKTtcbiAgY2hpcFJlYy5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOi41cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlJywgJ1JlY29ub2NpZGFzJylcbiAgKTtcbiAgY2hpcFJlYy5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tdG9wOjJweCcsIFN0cmluZyhzLnJlY29ub2NpZGFzLmxlbmd0aCkpXG4gICk7XG4gIGNoaXBzUm93LmFwcGVuZENoaWxkKGNoaXBSZWMpO1xuICBjb25zdCBjaGlwQ2FtYiA9IF9ta0RpdihcbiAgICAnZmxleDoxO21pbi13aWR0aDoxNDBweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOnJnYmEoMCwxMjIsMjU1LC4xNCk7Ym9yZGVyLXJhZGl1czo4cHg7Y29sb3I6IzAwNDBkZCcsXG4gICAgbnVsbFxuICApO1xuICBjaGlwQ2FtYi5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOi41cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlJywgJ0NvbiBjYW1iaW9zJylcbiAgKTtcbiAgY2hpcENhbWIuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MjJweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLXRvcDoycHgnLCBTdHJpbmcocy5jb25DYW1iaW9zLmxlbmd0aCkpXG4gICk7XG4gIGNoaXBzUm93LmFwcGVuZENoaWxkKGNoaXBDYW1iKTtcbiAgY29uc3QgY2hpcEVyciA9IF9ta0RpdihcbiAgICAnZmxleDoxO21pbi13aWR0aDoxNDBweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgKHMuZXJyb3Jlcy5sZW5ndGggPyAncmdiYSgyNTUsNTksNDgsLjE0KScgOiAncmdiYSgxMjAsMTIwLDEyOCwuMDgpJykgK1xuICAgICAgJztib3JkZXItcmFkaXVzOjhweDtjb2xvcjonICtcbiAgICAgIChzLmVycm9yZXMubGVuZ3RoID8gJyNjNzM3MmYnIDogJyM2ZTZlNzMnKSxcbiAgICBudWxsXG4gICk7XG4gIGNoaXBFcnIuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzouNXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZScsICdFcnJvcmVzJylcbiAgKTtcbiAgY2hpcEVyci5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tdG9wOjJweCcsIFN0cmluZyhzLmVycm9yZXMubGVuZ3RoKSlcbiAgKTtcbiAgY2hpcHNSb3cuYXBwZW5kQ2hpbGQoY2hpcEVycik7XG4gIHByZXZpZXdFbC5hcHBlbmRDaGlsZChjaGlwc1Jvdyk7XG5cbiAgaWYgKHMuZXJyb3Jlcy5sZW5ndGgpIHtcbiAgICBjb25zdCBlcnJCb3ggPSBfbWtEaXYoXG4gICAgICAncGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDpyZ2JhKDI1NSw1OSw0OCwuMDgpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjYzczNzJmO2JvcmRlci1yYWRpdXM6NnB4O21hcmdpbi1ib3R0b206MTJweCcsXG4gICAgICBudWxsXG4gICAgKTtcbiAgICBlcnJCb3guYXBwZW5kQ2hpbGQoXG4gICAgICBfbWtEaXYoXG4gICAgICAgICdmb250LXdlaWdodDo3MDA7Y29sb3I6I2M3MzcyZjttYXJnaW4tYm90dG9tOjZweCcsXG4gICAgICAgICdIYXkgJyArXG4gICAgICAgICAgcy5lcnJvcmVzLmxlbmd0aCArXG4gICAgICAgICAgJyBlcnJvcihlcykuIENvcnJlZ2lsb3MgeSB2b2x2XHUwMEU5IGEgc3ViaXIgZWwgRXhjZWwuIE5vIHNlIGFwbGljYSBuYWRhLidcbiAgICAgIClcbiAgICApO1xuICAgIGNvbnN0IHVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndWwnKTtcbiAgICB1bC5zdHlsZS5jc3NUZXh0ID0gJ21hcmdpbjowO3BhZGRpbmctbGVmdDoxOHB4O2NvbG9yOiMxZDFkMWY7Zm9udC1zaXplOjEyLjVweDtsaW5lLWhlaWdodDoxLjUnO1xuICAgIGNvbnN0IHNsaWNlID0gcy5lcnJvcmVzLnNsaWNlKDAsIDUwKTtcbiAgICBmb3IgKGNvbnN0IGUgb2Ygc2xpY2UpIHtcbiAgICAgIGNvbnN0IGxpID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGknKTtcbiAgICAgIGxpLnRleHRDb250ZW50ID0gZS5tc2c7XG4gICAgICB1bC5hcHBlbmRDaGlsZChsaSk7XG4gICAgfVxuICAgIGVyckJveC5hcHBlbmRDaGlsZCh1bCk7XG4gICAgaWYgKHMuZXJyb3Jlcy5sZW5ndGggPiA1MCkge1xuICAgICAgZXJyQm94LmFwcGVuZENoaWxkKFxuICAgICAgICBfbWtEaXYoXG4gICAgICAgICAgJ2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjExcHg7bWFyZ2luLXRvcDo0cHgnLFxuICAgICAgICAgICcuLi55ICcgKyAocy5lcnJvcmVzLmxlbmd0aCAtIDUwKSArICcgbVx1MDBFMXMgKHZlciBjb25zb2xhKSdcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG4gICAgcHJldmlld0VsLmFwcGVuZENoaWxkKGVyckJveCk7XG4gIH1cblxuICBpZiAoIXMuZXJyb3Jlcy5sZW5ndGggJiYgcy5jb25DYW1iaW9zLmxlbmd0aCkge1xuICAgIHByZXZpZXdFbC5hcHBlbmRDaGlsZChcbiAgICAgIF9ta0RpdihcbiAgICAgICAgJ3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6cmdiYSg1MiwxOTksODksLjA4KTtib3JkZXItcmFkaXVzOjZweDttYXJnaW4tYm90dG9tOjEycHg7Zm9udC1zaXplOjEzcHgnLFxuICAgICAgICAnUmVzdW1lbiBhIGFwbGljYXI6ICcgK1xuICAgICAgICAgIHMuY29uQ2FtYmlvcy5sZW5ndGggK1xuICAgICAgICAgICcgY2FtYmlvKHMpIFx1MDBCNyAnICtcbiAgICAgICAgICBzLnRvdGFsQXNpZ25hZG8gK1xuICAgICAgICAgICcgdSBhc2lnbmFkYXMgXHUwMEI3ICcgK1xuICAgICAgICAgIHMudG90YWxFbGltaW5hciArXG4gICAgICAgICAgJyB1IGVsaW1pbmFkYXMnXG4gICAgICApXG4gICAgKTtcbiAgICAvLyBUYWJsYSBwcmV2aWV3LlxuICAgIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGFibGUnKTtcbiAgICB0YWJsZS5zdHlsZS5jc3NUZXh0ID0gJ3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4JztcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoZWFkJyk7XG4gICAgY29uc3QgdHJoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgICB0cmguc3R5bGUuY3NzVGV4dCA9ICdiYWNrZ3JvdW5kOiNmNWY1ZjcnO1xuICAgIGZvciAoY29uc3QgaCBvZiBbJ1NLVScsICdDbGllbnRlJywgJ0JPJywgJ0FzaWcuJywgJ0VsaW0uJ10pIHtcbiAgICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcbiAgICAgIHRoLnN0eWxlLmNzc1RleHQgPVxuICAgICAgICAncGFkZGluZzo2cHg7dGV4dC1hbGlnbjonICsgKGggPT09ICdTS1UnIHx8IGggPT09ICdDbGllbnRlJyA/ICdsZWZ0JyA6ICdyaWdodCcpO1xuICAgICAgdGgudGV4dENvbnRlbnQgPSBoO1xuICAgICAgdHJoLmFwcGVuZENoaWxkKHRoKTtcbiAgICB9XG4gICAgdGhlYWQuYXBwZW5kQ2hpbGQodHJoKTtcbiAgICB0YWJsZS5hcHBlbmRDaGlsZCh0aGVhZCk7XG4gICAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0Ym9keScpO1xuICAgIGNvbnN0IHByZXZpZXdSb3dzID0gcy5jb25DYW1iaW9zLnNsaWNlKDAsIDMwKTtcbiAgICBmb3IgKGNvbnN0IHIgb2YgcHJldmlld1Jvd3MpIHtcbiAgICAgIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgICAgIHRyLnN0eWxlLmNzc1RleHQgPSAnYm9yZGVyLWJvdHRvbToxcHggc29saWQgI2VlZSc7XG4gICAgICBjb25zdCBhZGRUZCA9ICgvKiogQHR5cGUge3N0cmluZ30gKi8gdHh0LCAvKiogQHR5cGUge3N0cmluZ30gKi8gY3NzKSA9PiB7XG4gICAgICAgIGNvbnN0IHRkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgICAgICAgdGQuc3R5bGUuY3NzVGV4dCA9IGNzcztcbiAgICAgICAgdGQudGV4dENvbnRlbnQgPSB0eHQ7XG4gICAgICAgIHRyLmFwcGVuZENoaWxkKHRkKTtcbiAgICAgIH07XG4gICAgICBhZGRUZChyLnNrdSwgJ3BhZGRpbmc6NHB4IDZweDtmb250LWZhbWlseTptb25vc3BhY2UnKTtcbiAgICAgIGFkZFRkKHIuY2xpZW50TmFtZSwgJ3BhZGRpbmc6NHB4IDZweCcpO1xuICAgICAgYWRkVGQoU3RyaW5nKHIuYmFja29yZGVyQWN0dWFsKSwgJ3BhZGRpbmc6NHB4IDZweDt0ZXh0LWFsaWduOnJpZ2h0Jyk7XG4gICAgICBhZGRUZChcbiAgICAgICAgci5hc2lnbmFkb051ZXZvID8gU3RyaW5nKHIuYXNpZ25hZG9OdWV2bykgOiAnJyxcbiAgICAgICAgJ3BhZGRpbmc6NHB4IDZweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOiMyNDhhM2Q7Zm9udC13ZWlnaHQ6NjAwJ1xuICAgICAgKTtcbiAgICAgIGFkZFRkKFxuICAgICAgICByLmVsaW1pbmFyTnVldm8gPyBTdHJpbmcoci5lbGltaW5hck51ZXZvKSA6ICcnLFxuICAgICAgICAncGFkZGluZzo0cHggNnB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6I2M3MzcyZjtmb250LXdlaWdodDo2MDAnXG4gICAgICApO1xuICAgICAgdGJvZHkuYXBwZW5kQ2hpbGQodHIpO1xuICAgIH1cbiAgICB0YWJsZS5hcHBlbmRDaGlsZCh0Ym9keSk7XG4gICAgcHJldmlld0VsLmFwcGVuZENoaWxkKHRhYmxlKTtcbiAgICBpZiAocy5jb25DYW1iaW9zLmxlbmd0aCA+IDMwKSB7XG4gICAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoXG4gICAgICAgIF9ta0RpdihcbiAgICAgICAgICAnY29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTFweDttYXJnaW4tdG9wOjRweCcsXG4gICAgICAgICAgJy4uLnkgJyArIChzLmNvbkNhbWJpb3MubGVuZ3RoIC0gMzApICsgJyBtXHUwMEUxcydcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXMuZXJyb3Jlcy5sZW5ndGggJiYgIXMuY29uQ2FtYmlvcy5sZW5ndGgpIHtcbiAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoXG4gICAgICBfbWtEaXYoXG4gICAgICAgICdwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnJnYmEoMjU1LDIwNCwwLC4xNCk7Ym9yZGVyLXJhZGl1czo2cHg7Y29sb3I6IzhhNmQwMCcsXG4gICAgICAgICdFbCBFeGNlbCBubyB0aWVuZSBjYW1iaW9zIChBc2lnbmFkbz0wIHkgRWxpbWluYXI9MCBlbiB0b2RhcyBsYXMgZmlsYXMpLiBOYWRhIHF1ZSBhcGxpY2FyLidcbiAgICAgIClcbiAgICApO1xuICB9XG5cbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgY29uc3QgY2FuQXBwbHkgPSBzLmVycm9yZXMubGVuZ3RoID09PSAwICYmIHMuY29uQ2FtYmlvcy5sZW5ndGggPiAwO1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gIWNhbkFwcGx5O1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLm9wYWNpdHkgPSBjYW5BcHBseSA/ICcxJyA6ICcwLjQnO1xuICB9XG59XG5cbndpbmRvdy5jb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAoIV9pbXBvcnRTdGF0ZSB8fCBfaW1wb3J0U3RhdGUuY29uQ2FtYmlvcy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgaWYgKF9pbXBvcnRTdGF0ZS5lcnJvcmVzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBzZSBwdWVkZSBhcGxpY2FyOiBoYXkgZXJyb3JlcyBlbiBsYSB2aXN0YSBwcmV2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghX2lzQWRtaW5MaWtlRm9ySW1wb3J0KCkpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgYXBsaWNhciByZXBhcnRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhcHBseUJ0biA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bicpKTtcbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgYXBwbHlCdG4uZGlzYWJsZWQgPSB0cnVlO1xuICAgIGFwcGx5QnRuLnRleHRDb250ZW50ID0gJ0FwbGljYW5kb1x1MjAyNic7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0V4Y2VsSW1wb3J0O1xuICAgIGNvbnN0IGdyb3VwcyA9IHZhbGlkYXRvci5ncm91cEltcG9ydE1hdGNoZXNCeVJlcGFydG8oX2ltcG9ydFN0YXRlLmNvbkNhbWJpb3MpO1xuICAgIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG5cbiAgICBjb25zdCBjYWxsYWJsZSA9IHcuZmlyZWJhc2VcbiAgICAgIC5hcHAoKVxuICAgICAgLmZ1bmN0aW9ucygnc291dGhhbWVyaWNhLWVhc3QxJylcbiAgICAgIC5odHRwc0NhbGxhYmxlKCdhcHBseVJlcGFydG9NYW51YWxDRicpO1xuICAgIGxldCBva0NvdW50ID0gMDtcbiAgICBsZXQgZmFpbENvdW50ID0gMDtcbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdO1xuICAgIGxldCB0b3RhbEFzaWduYWNpb25lc0FwbGljYWRhcyA9IDA7XG4gICAgbGV0IHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGcgb2YgZ3JvdXBzKSB7XG4gICAgICBjb25zdCBpbmcgPSBpbmdyZXNvcy5maW5kKCgvKiogQHR5cGUge2FueX0gKi8gaSkgPT4gaS5faWQgPT09IGcucmVwYXJ0b0lkKTtcbiAgICAgIGlmICghaW5nKSB7XG4gICAgICAgIGZhaWxDb3VudCsrO1xuICAgICAgICBmYWlsdXJlcy5wdXNoKCdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgeWEgbm8gZXhpc3RlJyk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgY2xpZW50ZXMgPSBBcnJheS5pc0FycmF5KGluZy5jbGllbnRlc0JPKSA/IGluZy5jbGllbnRlc0JPIDogW107XG4gICAgICAvKiogQHR5cGUge0FycmF5PGFueT59ICovXG4gICAgICBjb25zdCBhc3NpZ25tZW50cyA9IFtdO1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgICAgY29uc3QgZWxpbWluYXRpb25zID0gW107XG4gICAgICBmb3IgKGNvbnN0IGEgb2YgZy5hc3NpZ25tZW50cykge1xuICAgICAgICBjb25zdCBjID0gY2xpZW50ZXMuZmluZChcbiAgICAgICAgICAoLyoqIEB0eXBlIHthbnl9ICovIHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeC5jbGllbnRDYXJkQ29kZSB8fCB4LmNhcmRDb2RlIHx8ICcnKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKVxuICAgICAgICAgICAgICAudHJpbSgpID09PSBTdHJpbmcoYS5jYXJkQ29kZSkudG9VcHBlckNhc2UoKS50cmltKClcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFjKSB7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICAgICdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgLyBDYXJkQ29kZSAnICsgYS5jYXJkQ29kZSArICcgeWEgbm8gZXN0XHUwMEUxIGVuIEJPJ1xuICAgICAgICAgICk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYXNzaWdubWVudHMucHVzaCh7XG4gICAgICAgICAgcGVkaWRvSWQ6IGMucGVkaWRvSWQsXG4gICAgICAgICAgbGluZUluZGV4OiBOdW1iZXIoYy5saW5lSW5kZXgpIHx8IDAsXG4gICAgICAgICAgcXR5QXNpZ25hZGE6IGEucXR5QXNpZ25hZGEsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBlIG9mIGcuZWxpbWluYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjbGllbnRlcy5maW5kKFxuICAgICAgICAgICgvKiogQHR5cGUge2FueX0gKi8geCkgPT5cbiAgICAgICAgICAgIFN0cmluZyh4LmNsaWVudENhcmRDb2RlIHx8IHguY2FyZENvZGUgfHwgJycpXG4gICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpXG4gICAgICAgICAgICAgIC50cmltKCkgPT09IFN0cmluZyhlLmNhcmRDb2RlKS50b1VwcGVyQ2FzZSgpLnRyaW0oKVxuICAgICAgICApO1xuICAgICAgICBpZiAoIWMpIHtcbiAgICAgICAgICBmYWlsdXJlcy5wdXNoKFxuICAgICAgICAgICAgJ1JlcGFydG8gJyArIGcucmVwYXJ0b0lkICsgJyAvIENhcmRDb2RlICcgKyBlLmNhcmRDb2RlICsgJyB5YSBubyBlc3RcdTAwRTEgZW4gQk8nXG4gICAgICAgICAgKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBlbGltaW5hdGlvbnMucHVzaCh7XG4gICAgICAgICAgcGVkaWRvSWQ6IGMucGVkaWRvSWQsXG4gICAgICAgICAgbGluZUluZGV4OiBOdW1iZXIoYy5saW5lSW5kZXgpIHx8IDAsXG4gICAgICAgICAgcXR5RWxpbWluYXI6IGUucXR5RWxpbWluYXIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKCFhc3NpZ25tZW50cy5sZW5ndGggJiYgIWVsaW1pbmF0aW9ucy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgY2FsbGFibGUoe1xuICAgICAgICAgIGluZ3Jlc29JZDogZy5yZXBhcnRvSWQsXG4gICAgICAgICAgYXNzaWdubWVudHMsXG4gICAgICAgICAgZWxpbWluYXRpb25zLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgciA9IHJlcy5kYXRhIHx8IHt9O1xuICAgICAgICBpZiAoci5vaykge1xuICAgICAgICAgIG9rQ291bnQrKztcbiAgICAgICAgICB0b3RhbEFzaWduYWNpb25lc0FwbGljYWRhcyArPSBhc3NpZ25tZW50cy5sZW5ndGg7XG4gICAgICAgICAgdG90YWxFbGltaW5hY2lvbmVzQXBsaWNhZGFzICs9IGVsaW1pbmF0aW9ucy5sZW5ndGg7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZmFpbENvdW50Kys7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICAgIGcucmVwYXJ0b0lkICtcbiAgICAgICAgICAgICAgJyAoJyArXG4gICAgICAgICAgICAgIGcuc2t1ICtcbiAgICAgICAgICAgICAgJyk6ICcgK1xuICAgICAgICAgICAgICAoKHIuZXJyb3JzIHx8IFtdKS5qb2luKCc7ICcpIHx8ICdlcnJvciBkZXNjb25vY2lkbycpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoY2FsbEVycikge1xuICAgICAgICBmYWlsQ291bnQrKztcbiAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICBnLnJlcGFydG9JZCArXG4gICAgICAgICAgICAnICgnICtcbiAgICAgICAgICAgIGcuc2t1ICtcbiAgICAgICAgICAgICcpOiAnICtcbiAgICAgICAgICAgICgoY2FsbEVyciAmJiAvKiogQHR5cGUge2FueX0gKi8gKGNhbGxFcnIpLm1lc3NhZ2UpIHx8IFN0cmluZyhjYWxsRXJyKSlcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKHcuZmJEYiAmJiB0eXBlb2Ygdy5mYkRiLmNvbGxlY3Rpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgYXdhaXQgdy5mYkRiLmNvbGxlY3Rpb24oJ3JlcGFydG9fbG9nJykuYWRkKHtcbiAgICAgICAgICBvcmlnZW46ICdpbXBvcnQnLFxuICAgICAgICAgIGZpbGVOYW1lOiBfaW1wb3J0U3RhdGUuZmlsZU5hbWUsXG4gICAgICAgICAgaW1wb3J0ZWRCeVVpZDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci51aWQpIHx8IG51bGwsXG4gICAgICAgICAgaW1wb3J0ZWRCeUVtYWlsOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCBudWxsLFxuICAgICAgICAgIHJvd3NDb3VudDogX2ltcG9ydFN0YXRlLnRvdGFsRmlsYXMsXG4gICAgICAgICAgYXNzaWdubWVudHNDb3VudDogdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMsXG4gICAgICAgICAgZWxpbWluYXRpb25zQ291bnQ6IHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyxcbiAgICAgICAgICByZXBhcnRvc1Byb2Nlc2Fkb3M6IGdyb3Vwcy5sZW5ndGgsXG4gICAgICAgICAgb2tDb3VudCxcbiAgICAgICAgICBmYWlsQ291bnQsXG4gICAgICAgICAgaW1wb3J0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAobG9nRXJyKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1t2MTUwNV0gcmVwYXJ0b19sb2cgb3JpZ2VuPWltcG9ydCB3cml0ZSBmYWlsZWQnLCBsb2dFcnIpO1xuICAgIH1cblxuICAgIGNvbnN0IHN1bW1hcnkgPVxuICAgICAgdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMgK1xuICAgICAgJyBhc2lnbmFjaW9uZXMgYXBsaWNhZGFzIFx1MDBCNyAnICtcbiAgICAgIHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyArXG4gICAgICAnIGVsaW1pbmFjaW9uZXMgYXBsaWNhZGFzJyArXG4gICAgICAoZmFpbENvdW50XG4gICAgICAgID8gJ1xcblxcblJlcGFydG9zIGNvbiBlcnJvciAoJyArIGZhaWxDb3VudCArICcpOlxcbicgKyBmYWlsdXJlcy5zbGljZSgwLCA1KS5qb2luKCdcXG4nKVxuICAgICAgICA6ICcnKTtcbiAgICBhbGVydChzdW1tYXJ5KTtcbiAgICBpZiAob2tDb3VudCA+IDApIF9zeW5jVGFnKCdJbXBvcnQgUmVwYXJ0byBhcGxpY2FkbyBcdTAwQjcgJyArIG9rQ291bnQgKyAnIHJlcGFydG8ocyknLCAzMjAwKTtcbiAgICB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyAmJiB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gKGUgJiYgLyoqIEB0eXBlIHthbnl9ICovIChlKS5tZXNzYWdlKSB8fCBTdHJpbmcoZSk7XG4gICAgY29uc29sZS5lcnJvcignW3YxNTA1IFx1MDBBN1JlcGFydG9dIGNvbmZpcm1SZXBhcnRvSW1wb3J0QXBwbHkgZXJyb3I6JywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGFwbGljYW5kbyBpbXBvcnQ6ICcgKyBtc2cpO1xuICAgIF9sb2dFeHBvcnRFcnJvcignaW1wb3J0X2FwcGx5JywgbXNnKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYXBwbHlCdG4pIHtcbiAgICAgIGFwcGx5QnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBhcHBseUJ0bi50ZXh0Q29udGVudCA9ICdBcGxpY2FyIHJlcGFydG8gaW1wb3J0YWRvJztcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogQ29uc3RydXllIGVsIG1vZGFsIERPTSB2aWEgaGVscGVycyBzZWd1cm9zIChzaW4gaW5uZXJIVE1MIGNvbiBjb250ZW5pZG9cbiAqIGRpblx1MDBFMW1pY28gXHUyMDE0IGVsIERPTSBlcyBlc3RcdTAwRTF0aWNvKS4gUHJpbWVyYSBhcGVydHVyYSBjYWNoZWEuXG4gKiBAcmV0dXJucyB7SFRNTEVsZW1lbnR9XG4gKi9cbmZ1bmN0aW9uIF9idWlsZEltcG9ydE1vZGFsRG9tKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBtb2RhbC5pZCA9ICdyZXBhcnRvLWltcG9ydC1tb2RhbCc7XG4gIG1vZGFsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcbiAgbW9kYWwuc3R5bGUuY3NzVGV4dCA9ICdkaXNwbGF5Om5vbmU7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXInO1xuICBtb2RhbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChldikgPT4ge1xuICAgIGlmIChldi50YXJnZXQgPT09IG1vZGFsKSB7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyA9PT0gJ2Z1bmN0aW9uJykgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2coKTtcbiAgICB9XG4gIH0pO1xuICBjb25zdCBib3ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgYm94LmNsYXNzTmFtZSA9ICdtb2RhbC1ib3gnO1xuICBib3guc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3dpZHRoOm1pbig3NjBweCw5NnZ3KTttYXgtaGVpZ2h0Ojkwdmg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czoxNHB4O292ZXJmbG93OmhpZGRlbic7XG4gIC8vIEhlYWRlci5cbiAgY29uc3QgaGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBoZWFkLnN0eWxlLmNzc1RleHQgPVxuICAgICdwYWRkaW5nOjE4cHggMjJweDtib3JkZXItYm90dG9tOjAuNXB4IHNvbGlkIHJnYmEoMCwwLDAsLjA4KTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4JztcbiAgY29uc3QgaGVhZFRpdGxlV3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBoZWFkVGl0bGVXcmFwLnN0eWxlLmNzc1RleHQgPSAnZmxleDoxJztcbiAgY29uc3QgaDIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdoMicpO1xuICBoMi5zdHlsZS5jc3NUZXh0ID0gJ21hcmdpbjowIDAgMnB4O2ZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzotMC40cHgnO1xuICBoMi50ZXh0Q29udGVudCA9ICdJbXBvcnRhciByZXBhcnRvIGRlc2RlIEV4Y2VsJztcbiAgaGVhZFRpdGxlV3JhcC5hcHBlbmRDaGlsZChoMik7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgc3VidC5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxMi41cHg7Y29sb3I6Izg2ODY4Yic7XG4gIHN1YnQudGV4dENvbnRlbnQgPSAnU3ViXHUwMEVEIGVsIEV4Y2VsIGVkaXRhZG8gb2ZmbGluZS4gU2UgdmFsaWRhIGZpbGEgcG9yIGZpbGEgYW50ZXMgZGUgYXBsaWNhci4nO1xuICBoZWFkVGl0bGVXcmFwLmFwcGVuZENoaWxkKHN1YnQpO1xuICBoZWFkLmFwcGVuZENoaWxkKGhlYWRUaXRsZVdyYXApO1xuICBjb25zdCBjbG9zZUJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICBjbG9zZUJ0bi50eXBlID0gJ2J1dHRvbic7XG4gIGNsb3NlQnRuLnRleHRDb250ZW50ID0gJ1x1MDBENyc7XG4gIGNsb3NlQnRuLnN0eWxlLmNzc1RleHQgPVxuICAgICdib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjEyKTt3aWR0aDozMHB4O2hlaWdodDozMHB4O2JvcmRlci1yYWRpdXM6NTAlO2N1cnNvcjpwb2ludGVyO2NvbG9yOiM2ZTZlNzM7Zm9udC1zaXplOjE2cHgnO1xuICBjbG9zZUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gIH0pO1xuICBoZWFkLmFwcGVuZENoaWxkKGNsb3NlQnRuKTtcbiAgYm94LmFwcGVuZENoaWxkKGhlYWQpO1xuICAvLyBCb2R5LlxuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGJvZHkuc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjE2cHggMjJweDtmbGV4OjE7b3ZlcmZsb3cteTphdXRvO21pbi1oZWlnaHQ6MCc7XG4gIGNvbnN0IGZpbGVJbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XG4gIGZpbGVJbnB1dC50eXBlID0gJ2ZpbGUnO1xuICBmaWxlSW5wdXQuaWQgPSAncmVwYXJ0by1pbXBvcnQtZmlsZSc7XG4gIGZpbGVJbnB1dC5hY2NlcHQgPSAnLnhsc3gnO1xuICBmaWxlSW5wdXQuc3R5bGUuY3NzVGV4dCA9ICdtYXJnaW4tYm90dG9tOjE0cHgnO1xuICBmaWxlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICBpZiAodHlwZW9mIHcuaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UgPT09ICdmdW5jdGlvbicpIHcuaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UoZXYpO1xuICB9KTtcbiAgYm9keS5hcHBlbmRDaGlsZChmaWxlSW5wdXQpO1xuICBjb25zdCBwcmV2aWV3RGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHByZXZpZXdEaXYuaWQgPSAncmVwYXJ0by1pbXBvcnQtcHJldmlldyc7XG4gIHByZXZpZXdEaXYuc3R5bGUuY3NzVGV4dCA9ICdtaW4taGVpZ2h0OjQwcHgnO1xuICBib2R5LmFwcGVuZENoaWxkKHByZXZpZXdEaXYpO1xuICBib3guYXBwZW5kQ2hpbGQoYm9keSk7XG4gIC8vIEZvb3Rlci5cbiAgY29uc3QgZm9vdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBmb290LnN0eWxlLmNzc1RleHQgPVxuICAgICdwYWRkaW5nOjE0cHggMjJweDtib3JkZXItdG9wOjAuNXB4IHNvbGlkIHJnYmEoMCwwLDAsLjA4KTtkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7anVzdGlmeS1jb250ZW50OmZsZXgtZW5kJztcbiAgY29uc3QgY2FuY2VsQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gIGNhbmNlbEJ0bi50eXBlID0gJ2J1dHRvbic7XG4gIGNhbmNlbEJ0bi50ZXh0Q29udGVudCA9ICdDYW5jZWxhcic7XG4gIGNhbmNlbEJ0bi5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzo5cHggMThweDtib3JkZXI6MC41cHggc29saWQgcmdiYSgwLDAsMCwuMTIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjk5OXB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4JztcbiAgY2FuY2VsQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKHR5cGVvZiB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyA9PT0gJ2Z1bmN0aW9uJykgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2coKTtcbiAgfSk7XG4gIGZvb3QuYXBwZW5kQ2hpbGQoY2FuY2VsQnRuKTtcbiAgY29uc3QgYXBwbHlCdG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgYXBwbHlCdG4udHlwZSA9ICdidXR0b24nO1xuICBhcHBseUJ0bi5pZCA9ICdyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nO1xuICBhcHBseUJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gIGFwcGx5QnRuLnRleHRDb250ZW50ID0gJ0FwbGljYXIgcmVwYXJ0byBpbXBvcnRhZG8nO1xuICBhcHBseUJ0bi5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzo5cHggMThweDtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOiMyNDhhM2Q7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjk5OXB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtvcGFjaXR5OjAuNCc7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKHR5cGVvZiB3LmNvbmZpcm1SZXBhcnRvSW1wb3J0QXBwbHkgPT09ICdmdW5jdGlvbicpIHcuY29uZmlybVJlcGFydG9JbXBvcnRBcHBseSgpO1xuICB9KTtcbiAgZm9vdC5hcHBlbmRDaGlsZChhcHBseUJ0bik7XG4gIGJveC5hcHBlbmRDaGlsZChmb290KTtcbiAgbW9kYWwuYXBwZW5kQ2hpbGQoYm94KTtcbiAgcmV0dXJuIG1vZGFsO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBeUJBLGlCQUFlLGlCQUFp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
