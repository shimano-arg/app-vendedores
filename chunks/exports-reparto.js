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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1yZXBhcnRvLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLyoqXG4gKiBleHBvcnRzLXJlcGFydG8gKHYxNTA1LCAyMDI2LTEwLTI4KSBcdTIwMTQgY2h1bmsgbGF6eSBwYXJhIGVsIGZsb3cgZGUgZXhwb3J0ICtcbiAqIGltcG9ydCBFeGNlbCBkZWwgUmVwYXJ0byBkZSBpbmdyZXNvcy5cbiAqXG4gKiBEb3MgaGFuZGxlcnMgcHJpbmNpcGFsZXMgZXhwdWVzdG9zIGEgd2luZG93OlxuICogICAtIHdpbmRvdy5leHBvcnRSZXBhcnRvTWFudWFsRXhjZWwoKSAgXHUyMDE0IHRlbXBsYXRlIGVkaXRhYmxlIGNvbiA5IGNvbHVtbmFzXG4gKiAgICAgKDcgdmlzaWJsZXMgKyAyIHRcdTAwRTljbmljYXMgYWwgZmluYWwsIGdyaXNlcyB5IHByb3RlZ2lkYXMpLlxuICogICAtIHdpbmRvdy5vcGVuUmVwYXJ0b0ltcG9ydERpYWxvZygpICAgXHUyMDE0IG1vZGFsIGNvbiA8aW5wdXQgdHlwZT1maWxlPixcbiAqICAgICBwcmV2aWV3IGRlIHZhbGlkYWNpXHUwMEYzbiwgeSBib3RcdTAwRjNuIFwiQXBsaWNhciByZXBhcnRvIGltcG9ydGFkb1wiLlxuICpcbiAqIEZ1ZW50ZSBcdTAwRkFuaWNhOiBwdXJlIGZuc1xuICogICAtIHNyYy9wdXJlL3JlcGFydG8tZXhjZWwtZXhwb3J0LXJvd3MuanMgXHUyMDE0IGFybWFkbyBkZSBmaWxhcy5cbiAqICAgLSBzcmMvcHVyZS9yZXBhcnRvLWV4Y2VsLWltcG9ydC12YWxpZGF0b3IuanMgXHUyMDE0IHZhbGlkYWNpXHUwMEYzbiBwb3IgZmlsYS5cbiAqXG4gKiBQYXlsb2FkIHNlcnZlcjogU0lFTVBSRSB2aWEgYGFwcGx5UmVwYXJ0b01hbnVhbENGYCAoY2FsbGFibGUpLiBOVU5DQVxuICogZXNjcml0dXJhIGRpcmVjdGEgYSBGaXJlc3RvcmUgKENMQVVERS5tZCBcdTAwQTc2MyBwYXR0ZXJuKS5cbiAqXG4gKiBMb2c6IGByZXBhcnRvX2xvZ2AgY29uIGBvcmlnZW49J2ltcG9ydCdgICsgZmlsZU5hbWUgKyBpbXBvcnRlZEJ5VWlkICsgLi4uXG4gKi9cblxuLyoqXG4gKiBMYXp5IGxvYWRlciBwYXJhIEV4Y2VsSlMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gX2Vuc3VyZUV4Y2VsSlMoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5sb2FkRXhjZWxKUyA9PT0gJ2Z1bmN0aW9uJykgYXdhaXQgdy5sb2FkRXhjZWxKUygpO1xuICBpZiAoIXcuRXhjZWxKUykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbEpTIG5vIGRpc3BvbmlibGUnKTtcbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gbXNnXG4gKiBAcGFyYW0ge251bWJlcn0gW21zXVxuICovXG5mdW5jdGlvbiBfc3luY1RhZyhtc2csIG1zKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5zaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICB3LnNob3dTeW5jVGFnKG1zZywgbXMpO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gc2t1XG4gKiBAcmV0dXJucyB7bnVtYmVyfVxuICovXG5mdW5jdGlvbiBfZ2V0U3RvY2tGaXNpY28oc2t1KSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGlmICh0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIDA7XG4gIHRyeSB7XG4gICAgcmV0dXJuIE51bWJlcih3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhKHNrdSkpIHx8IDA7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbn1cblxuLyoqXG4gKiBAcmV0dXJucyB7e3NlYXJjaDogc3RyaW5nLCBoaWRlTm9TdG9jazogYm9vbGVhbn19XG4gKi9cbmZ1bmN0aW9uIF9yZWFkRmlsdHJvc01vZGFsUmVwYXJ0bygpIHtcbiAgY29uc3Qgc0VsID0gdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyA/IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLXNlYXJjaCcpIDogbnVsbDtcbiAgY29uc3QgaEVsID1cbiAgICB0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnID8gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taGlkZS1ub3N0b2NrJykgOiBudWxsO1xuICByZXR1cm4ge1xuICAgIHNlYXJjaDogc0VsID8gU3RyaW5nKC8qKiBAdHlwZSB7YW55fSAqLyAoc0VsKS52YWx1ZSB8fCAnJykudHJpbSgpIDogJycsXG4gICAgaGlkZU5vU3RvY2s6IGhFbCA/ICEhKC8qKiBAdHlwZSB7YW55fSAqLyAoaEVsKS5jaGVja2VkKSA6IHRydWUsXG4gIH07XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IGV4cG9ydEtpbmRcbiAqIEBwYXJhbSB7c3RyaW5nfSBtc2dcbiAqL1xuZnVuY3Rpb24gX2xvZ0V4cG9ydEVycm9yKGV4cG9ydEtpbmQsIG1zZykge1xuICB0cnkge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKCF3LmZiRGIgfHwgdHlwZW9mIHcuZmJEYi5jb2xsZWN0aW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm47XG4gICAgdy5mYkRiXG4gICAgICAuY29sbGVjdGlvbignb3BlcmF0aW9uc19sb2cnKVxuICAgICAgLmFkZCh7XG4gICAgICAgIHR5cGU6ICdleHBvcnRfZmFpbGVkJyxcbiAgICAgICAgZXhwb3J0S2luZCxcbiAgICAgICAgZXJyb3I6IG1zZy5zbGljZSgwLCA1MDApLFxuICAgICAgICB1c2VyVWlkOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLnVpZCkgfHwgbnVsbCxcbiAgICAgICAgdXNlckVtYWlsOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCBudWxsLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgLyogaWdub3JlICovXG4gICAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICAvKiBpZ25vcmUgKi9cbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBUlRFIDEgXHUyMDE0IEV4cG9ydCBtYW51YWwgKHRlbXBsYXRlIGVkaXRhYmxlKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5leHBvcnRSZXBhcnRvTWFudWFsRXhjZWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIHBhcmEgZXhwb3J0YXIuIEFiclx1MDBFRCBlbCBtb2RhbCBcIlJlcGFydG8gZGUgaW5ncmVzb3NcIiBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBfc3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGVkaXRhYmxlXHUyMDI2Jyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcHVyZU1vZCA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5yZXBhcnRvRXhjZWxFeHBvcnQ7XG4gICAgaWYgKCFwdXJlTW9kIHx8IHR5cGVvZiBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B1cmUgZm4gcmVwYXJ0b0V4Y2VsRXhwb3J0IG5vIGRpc3BvbmlibGUnKTtcbiAgICB9XG4gICAgY29uc3QgY29uc29saWRhdGVGbiA9XG4gICAgICB3Ll9fcGhhc2UwICYmXG4gICAgICB3Ll9fcGhhc2UwLnB1cmUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUuY29uc29saWRhdGVDbGllbnRlc0JPO1xuICAgIGNvbnN0IGZpbHRyb3MgPSBfcmVhZEZpbHRyb3NNb2RhbFJlcGFydG8oKTtcbiAgICBjb25zdCByZXN1bHQgPSBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzKGluZ3Jlc29zLCBmaWx0cm9zLCB7XG4gICAgICBnZXRTdG9ja0Zpc2ljbzogX2dldFN0b2NrRmlzaWNvLFxuICAgICAgY29uc29saWRhdGVGbjogdHlwZW9mIGNvbnNvbGlkYXRlRm4gPT09ICdmdW5jdGlvbicgPyBjb25zb2xpZGF0ZUZuIDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICAgIGlmICghcmVzdWx0LnJvd3MubGVuZ3RoKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ05vIGhheSBmaWxhcyBwYXJhIGV4cG9ydGFyIGNvbiBsb3MgZmlsdHJvcyBhY3R1YWxlcy4gTGltcGlcdTAwRTEgYlx1MDBGQXNxdWVkYSBvIGRlc3RpbGRcdTAwRTEgXCJPY3VsdGFyIHNpbiBzdG9ja1wiLidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgX2Vuc3VyZUV4Y2VsSlMoKTtcbiAgICBjb25zdCBFeGNlbEpTID0gdy5FeGNlbEpTO1xuICAgIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVwYXJ0bycpO1xuXG4gICAgd3MuY29sdW1ucyA9IFtcbiAgICAgIHsgaGVhZGVyOiAnQ29kaWdvJywga2V5OiAnQ29kaWdvJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0NsaWVudGUnLCBrZXk6ICdDbGllbnRlJywgd2lkdGg6IDM2IH0sXG4gICAgICB7IGhlYWRlcjogJ0JhY2tvcmRlcicsIGtleTogJ0JhY2tvcmRlcicsIHdpZHRoOiAxMiB9LFxuICAgICAgeyBoZWFkZXI6ICdTdG9jayBkaXNwb25pYmxlJywga2V5OiAnU3RvY2tEaXNwb25pYmxlJywgd2lkdGg6IDE1IH0sXG4gICAgICB7IGhlYWRlcjogJ0FzaWduYWRvJywga2V5OiAnQXNpZ25hZG8nLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnVnVlbHZlIGEgYmFja29yZGVyJywga2V5OiAnVnVlbGVBQmFja29yZGVyJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0VsaW1pbmFyJywga2V5OiAnRWxpbWluYXInLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnUmVwYXJ0byBJRCcsIGtleTogJ1JlcGFydG9JZCcsIHdpZHRoOiAyNCB9LFxuICAgICAgeyBoZWFkZXI6ICdDYXJkQ29kZScsIGtleTogJ0NhcmRDb2RlJywgd2lkdGg6IDE2IH0sXG4gICAgXTtcblxuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmdldFJvdygxKTtcbiAgICBoZWFkZXJSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2NjUzNCcgfSB9O1xuICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAgIGNlbGwuYm9yZGVyID0ge1xuICAgICAgICB0b3A6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIGxlZnQ6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIHJpZ2h0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9LFxuICAgICAgICBib3R0b206IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICB9O1xuICAgIH0pO1xuICAgIGhlYWRlclJvdy5oZWlnaHQgPSAyODtcbiAgICBoZWFkZXJSb3cuZ2V0Q2VsbCg4KS5maWxsID0ge1xuICAgICAgdHlwZTogJ3BhdHRlcm4nLFxuICAgICAgcGF0dGVybjogJ3NvbGlkJyxcbiAgICAgIGZnQ29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LFxuICAgIH07XG4gICAgaGVhZGVyUm93LmdldENlbGwoOSkuZmlsbCA9IHtcbiAgICAgIHR5cGU6ICdwYXR0ZXJuJyxcbiAgICAgIHBhdHRlcm46ICdzb2xpZCcsXG4gICAgICBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjg4ODg4OCcgfSxcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN1bHQucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgciA9IHJlc3VsdC5yb3dzW2ldO1xuICAgICAgLy8gdjE1MTIgKDIwMjYtMTAtMjgpOiBmaWxhIGF2aXNvIFNLVSBtdWx0aS1yZXBhcnRvIChDb2RpZ28gPT09ICcnLCBfbm90aWNlPXRydWUpLlxuICAgICAgLy8gU2UgcmVuZGVyaXphIGNvbiBmb25kbyBhbWFyaWxsbyArIHNvbG8gbGFzIGNlbGRhcyBDb2RpZ28rQ2xpZW50ZSBvY3VwYWRhcztcbiAgICAgIC8vIGltcG9ydCB2YWxpZGF0b3IgbGEgaWdub3JhIHBvciBgQ29kaWdvID09PSAnJ2AuXG4gICAgICBpZiAociAmJiAoci5fbm90aWNlID09PSB0cnVlIHx8IHIuQ29kaWdvID09PSAnJykpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgICAgICBDb2RpZ286ICcnLFxuICAgICAgICAgIENsaWVudGU6IHIuQ2xpZW50ZSB8fCAnJyxcbiAgICAgICAgICBCYWNrb3JkZXI6IG51bGwsXG4gICAgICAgICAgU3RvY2tEaXNwb25pYmxlOiBudWxsLFxuICAgICAgICAgIEFzaWduYWRvOiBudWxsLFxuICAgICAgICAgIFZ1ZWxlQUJhY2tvcmRlcjogbnVsbCxcbiAgICAgICAgICBFbGltaW5hcjogbnVsbCxcbiAgICAgICAgICBSZXBhcnRvSWQ6ICcnLFxuICAgICAgICAgIENhcmRDb2RlOiAnJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkZGRUI5OScgfSB9O1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGNzgzNTBGJyB9LCBib2xkOiB0cnVlLCBzaXplOiAxMSB9O1xuICAgICAgICAgIGNlbGwuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gICAgICAgICAgLy8gRmlsYSBhdmlzbyBibG9xdWVhZGEgKHVzZXIgbm8gcHVlZGUgZWRpdGFyIGVsIGF2aXNvKS5cbiAgICAgICAgICBjZWxsLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgICBDb2RpZ286IHIuQ29kaWdvLFxuICAgICAgICBDbGllbnRlOiByLkNsaWVudGUsXG4gICAgICAgIEJhY2tvcmRlcjogci5CYWNrb3JkZXIsXG4gICAgICAgIFN0b2NrRGlzcG9uaWJsZTogci5TdG9ja0Rpc3BvbmlibGUsXG4gICAgICAgIEFzaWduYWRvOiByLkFzaWduYWRvLFxuICAgICAgICBWdWVsZUFCYWNrb3JkZXI6IG51bGwsXG4gICAgICAgIEVsaW1pbmFyOiByLkVsaW1pbmFyLFxuICAgICAgICBSZXBhcnRvSWQ6IHIuUmVwYXJ0b0lkLFxuICAgICAgICBDYXJkQ29kZTogci5DYXJkQ29kZSxcbiAgICAgIH0pO1xuICAgICAgcm93LmdldENlbGwoNikudmFsdWUgPSB7XG4gICAgICAgIGZvcm11bGE6IHIuVnVlbGVBQmFja29yZGVyLnJlcGxhY2UoL149LywgJycpLFxuICAgICAgICByZXN1bHQ6IHIuQmFja29yZGVyIC0gci5Bc2lnbmFkbyAtIHIuRWxpbWluYXIsXG4gICAgICB9O1xuICAgICAgcm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICAgIGNlbGwuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gICAgICAgIGNlbGwuYm9yZGVyID0ge1xuICAgICAgICAgIHRvcDogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgICBsZWZ0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICAgIHJpZ2h0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICAgIGJvdHRvbTogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgICAgcm93LmdldENlbGwoOCkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkY1RjVGNScgfSB9O1xuICAgICAgcm93LmdldENlbGwoOCkuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LCBzaXplOiAxMCB9O1xuICAgICAgcm93LmdldENlbGwoOSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkY1RjVGNScgfSB9O1xuICAgICAgcm93LmdldENlbGwoOSkuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9LCBzaXplOiAxMCB9O1xuICAgICAgcm93LmdldENlbGwoMSkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCgyKS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDMpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoNCkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg1KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IGZhbHNlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg2KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDcpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogZmFsc2UgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDgpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoOSkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgfVxuXG4gICAgd3Mudmlld3MgPSBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XTtcblxuICAgIC8vIHYxNTEyICgyMDI2LTEwLTI4KTogaGFiaWxpdGFyIGF1dG9maWx0cm8gKyBzb3J0IGVuIGxhIGhvamEgcHJvdGVnaWRhLlxuICAgIC8vIFBhYmxvIHJlcG9ydFx1MDBGMyBxdWUgXCJPcmRlbmFyIHkgZmlsdHJhclwiIGVuIEV4Y2VsIGRlc2t0b3AgYXBhcmVjXHUwMEVEYSBkZXNoYWJpbGl0YWRvOlxuICAgIC8vIGZhbHRhYmEgYHdzLmF1dG9GaWx0ZXJgIHF1ZSBtYXJjYSBlbCByYW5nbyBjb21vIGF1dG9maWx0ZXIgKyBgc29ydDogdHJ1ZWAgZW5cbiAgICAvLyBsYSBwcm90ZWNjaVx1MDBGM24gcGVybWl0ZSBvcmRlbmFyIGxhcyBjZWxkYXMgZGVzYmxvcXVlYWRhcyAoQXNpZ25hZG8gKyBFbGltaW5hcikuXG4gICAgLy8gTGFzIGNlbGRhcyBibG9xdWVhZGFzIChDb2RpZ28sIENsaWVudGUsIEJhY2tvcmRlciwgU3RvY2ssIFZ1ZWxlQUJPLCBSZXBhcnRvSWQsXG4gICAgLy8gQ2FyZENvZGUpIHNpZ3VlbiBibG9xdWVhZGFzOyBzb3J0IHkgZmlsdGVyIHRyYWJhamFuIHNvYnJlIGVsIGNvbmp1bnRvIGNvbXBsZXRvLlxuICAgIGNvbnN0IF9sYXN0Um93ID0gKHJlc3VsdC5yb3dzID8gcmVzdWx0LnJvd3MubGVuZ3RoIDogMCkgKyAxOyAvLyArMSBwb3IgaGVhZGVyXG4gICAgd3MuYXV0b0ZpbHRlciA9IHsgZnJvbTogeyByb3c6IDEsIGNvbHVtbjogMSB9LCB0bzogeyByb3c6IF9sYXN0Um93LCBjb2x1bW46IDkgfSB9O1xuXG4gICAgYXdhaXQgd3MucHJvdGVjdCgnJywge1xuICAgICAgc2VsZWN0TG9ja2VkQ2VsbHM6IHRydWUsXG4gICAgICBzZWxlY3RVbmxvY2tlZENlbGxzOiB0cnVlLFxuICAgICAgZm9ybWF0Q2VsbHM6IGZhbHNlLFxuICAgICAgc29ydDogdHJ1ZSwgICAgICAgICAvLyB2MTUxMjogcGVybWl0ZSBvcmRlbmFyXG4gICAgICBhdXRvRmlsdGVyOiB0cnVlLCAgIC8vIHBlcm1pdGUgZmlsdHJhciAoeWEgZXN0YWJhKVxuICAgIH0pO1xuXG4gICAgY29uc3QgZmlsZW5hbWUgPSBwdXJlTW9kLmJ1aWxkUmVwYXJ0b0V4Y2VsRmlsZU5hbWVcbiAgICAgID8gcHVyZU1vZC5idWlsZFJlcGFydG9FeGNlbEZpbGVOYW1lKG5ldyBEYXRlKCkpXG4gICAgICA6ICdSZXBhcnRvXycgK1xuICAgICAgICBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApICtcbiAgICAgICAgJ18nICtcbiAgICAgICAgbmV3IERhdGUoKS50b1RpbWVTdHJpbmcoKS5zbGljZSgwLCA1KS5yZXBsYWNlKCc6JywgJycpICtcbiAgICAgICAgJy54bHN4JztcblxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1Zl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgYS5yZW1vdmUoKTtcbiAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG5cbiAgICBfc3luY1RhZyhcbiAgICAgICdFeGNlbCBlZGl0YWJsZSBsaXN0byAoJyArIHJlc3VsdC5yb3dzLmxlbmd0aCArICcgZmlsYXMgXHUwMEI3ICcgKyByZXN1bHQudG90YWxCYWNrb3JkZXIgKyAndSBCTyknLFxuICAgICAgMzIwMFxuICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSAoZSAmJiAvKiogQHR5cGUge2FueX0gKi8gKGUpLm1lc3NhZ2UpIHx8IFN0cmluZyhlKTtcbiAgICBjb25zb2xlLmVycm9yKCdbdjE1MDUgXHUwMEE3UmVwYXJ0b10gZXhwb3J0UmVwYXJ0b01hbnVhbEV4Y2VsIGZhbGxcdTAwRjM6JywgZSk7XG4gICAgYWxlcnQoJ05vIHB1ZGltb3MgZ2VuZXJhciBlbCBFeGNlbCBlZGl0YWJsZS4gVm9sdlx1MDBFOSBhIGludGVudGFyOyBzaSBzaWd1ZSwgYXZpc2FsZSBhIE1hcmlhbm8uJyk7XG4gICAgX2xvZ0V4cG9ydEVycm9yKCdleHBvcnRfbWFudWFsJywgbXNnKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQQVJURSAyIFx1MjAxNCBJbXBvcnQgRXhjZWxcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5sZXQgX2ltcG9ydFN0YXRlID0gLyoqIEB0eXBlIHtudWxsIHwge1xuICBmaWxlTmFtZTogc3RyaW5nLFxuICByZWNvbm9jaWRhczogQXJyYXk8YW55PixcbiAgY29uQ2FtYmlvczogQXJyYXk8YW55PixcbiAgZXJyb3JlczogQXJyYXk8YW55PixcbiAgdG90YWxGaWxhczogbnVtYmVyLFxuICB0b3RhbEFzaWduYWRvOiBudW1iZXIsXG4gIHRvdGFsRWxpbWluYXI6IG51bWJlcixcbn19ICovIChudWxsKTtcblxuLyoqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuZnVuY3Rpb24gX2lzQWRtaW5MaWtlRm9ySW1wb3J0KCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBjb25zdCByb2xlID0gKHcudXNlclJvbGUgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGlmIChyb2xlID09PSAnYWRtaW4nIHx8IHJvbGUgPT09ICdnZXJlbnRlJykgcmV0dXJuIHRydWU7XG4gIGNvbnN0IGVtYWlsID0gU3RyaW5nKCh3LmN1cnJlbnRVc2VyICYmIHcuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoZW1haWwgPT09ICdwYWJsby5nb256YWxlekBzaGltYW5vLmNvbS5hcicgfHwgZW1haWwgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbScpIHJldHVybiB0cnVlO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbndpbmRvdy5vcGVuUmVwYXJ0b0ltcG9ydERpYWxvZyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfaXNBZG1pbkxpa2VGb3JJbXBvcnQoKSkge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBpbXBvcnRhciByZXBhcnRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBjb25zdCBpbmdyZXNvcyA9IEFycmF5LmlzQXJyYXkody5fcmVwYXJ0b0luZ3Jlc29zKSA/IHcuX3JlcGFydG9JbmdyZXNvcyA6IFtdO1xuICBpZiAoIWluZ3Jlc29zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgaW5ncmVzb3MgZGUgcmVwYXJ0byBhY3Rpdm9zLiBBYnJcdTAwRUQgZWwgbW9kYWwgUmVwYXJ0byBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkge1xuICAgIG1vZGFsID0gX2J1aWxkSW1wb3J0TW9kYWxEb20oKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG1vZGFsKTtcbiAgfVxuICBfaW1wb3J0U3RhdGUgPSBudWxsO1xuICBjb25zdCBwcmV2aWV3RWwgPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1pbXBvcnQtcHJldmlldycpO1xuICBpZiAocHJldmlld0VsKSB7XG4gICAgd2hpbGUgKHByZXZpZXdFbC5maXJzdENoaWxkKSBwcmV2aWV3RWwucmVtb3ZlQ2hpbGQocHJldmlld0VsLmZpcnN0Q2hpbGQpO1xuICB9XG4gIGNvbnN0IGFwcGx5QnRuID0gbW9kYWwucXVlcnlTZWxlY3RvcignI3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bicpO1xuICBpZiAoYXBwbHlCdG4pIHtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5kaXNhYmxlZCA9IHRydWU7XG4gICAgLyoqIEB0eXBlIHthbnl9ICovIChhcHBseUJ0bikuc3R5bGUub3BhY2l0eSA9ICcwLjQnO1xuICB9XG4gIGNvbnN0IGZpbGVJbnB1dCA9IG1vZGFsLnF1ZXJ5U2VsZWN0b3IoJyNyZXBhcnRvLWltcG9ydC1maWxlJyk7XG4gIGlmIChmaWxlSW5wdXQpIC8qKiBAdHlwZSB7YW55fSAqLyAoZmlsZUlucHV0KS52YWx1ZSA9ICcnO1xuICAvKiogQHR5cGUge2FueX0gKi8gKG1vZGFsKS5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnO1xufTtcblxud2luZG93LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtbW9kYWwnKTtcbiAgaWYgKG1vZGFsKSAvKiogQHR5cGUge2FueX0gKi8gKG1vZGFsKS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBfaW1wb3J0U3RhdGUgPSBudWxsO1xufTtcblxuLyoqXG4gKiBAcGFyYW0ge0V2ZW50fSBldlxuICovXG53aW5kb3cuaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UgPSBhc3luYyBmdW5jdGlvbiAoZXYpIHtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgY29uc3QgdGd0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAoZXYudGFyZ2V0KTtcbiAgY29uc3QgZmlsZSA9IHRndCAmJiB0Z3QuZmlsZXMgJiYgdGd0LmZpbGVzWzBdO1xuICBpZiAoIWZpbGUpIHJldHVybjtcbiAgY29uc3QgcHJldmlld0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LXByZXZpZXcnKTtcbiAgY29uc3QgYXBwbHlCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmIChwcmV2aWV3RWwpIHtcbiAgICB3aGlsZSAocHJldmlld0VsLmZpcnN0Q2hpbGQpIHByZXZpZXdFbC5yZW1vdmVDaGlsZChwcmV2aWV3RWwuZmlyc3RDaGlsZCk7XG4gICAgcHJldmlld0VsLnRleHRDb250ZW50ID0gJ0xleWVuZG8gRXhjZWxcdTIwMjYnO1xuICB9XG4gIGlmIChhcHBseUJ0bikge1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5zdHlsZS5vcGFjaXR5ID0gJzAuNCc7XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCBfZW5zdXJlRXhjZWxKUygpO1xuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcbiAgICBjb25zdCB3YiA9IG5ldyB3LkV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBhd2FpdCB3Yi54bHN4LmxvYWQoYnVmKTtcbiAgICBjb25zdCB3cyA9IHdiLndvcmtzaGVldHNbMF07XG4gICAgaWYgKCF3cykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBzaW4gaG9qYXMnKTtcblxuICAgIGNvbnN0IGhlYWRlck1hcCA9IF9idWlsZEhlYWRlck1hcCh3cyk7XG4gICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICB3cy5lYWNoUm93KChyb3csIHJuKSA9PiB7XG4gICAgICBpZiAocm4gPT09IDEpIHJldHVybjtcbiAgICAgIC8qKiBAdHlwZSB7YW55fSAqL1xuICAgICAgY29uc3Qgb2JqID0geyBfX3Jvd0luZGV4OiBybiB9O1xuICAgICAgcm93LmVhY2hDZWxsKHsgaW5jbHVkZUVtcHR5OiB0cnVlIH0sIChjZWxsLCBjb2xJZHgpID0+IHtcbiAgICAgICAgY29uc3QgY2Fub25LZXkgPSBoZWFkZXJNYXBbY29sSWR4XTtcbiAgICAgICAgaWYgKCFjYW5vbktleSkgcmV0dXJuO1xuICAgICAgICBsZXQgdiA9IGNlbGwudmFsdWU7XG4gICAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAndGV4dCcgaW4gdikgdiA9IHYudGV4dDtcbiAgICAgICAgaWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICdyZXN1bHQnIGluIHYpIHYgPSB2LnJlc3VsdDtcbiAgICAgICAgb2JqW2Nhbm9uS2V5XSA9IHY7XG4gICAgICB9KTtcbiAgICAgIGlmICghb2JqLlJlcGFydG9JZCAmJiAhb2JqLkNhcmRDb2RlICYmICFvYmouQ29kaWdvKSByZXR1cm47XG4gICAgICByb3dzLnB1c2gob2JqKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gICAgY29uc3QgcmVwYXJ0b3NBY3Rpdm9zID0gaW5ncmVzb3MubWFwKCgvKiogQHR5cGUge2FueX0gKi8gaSkgPT4gKHtcbiAgICAgIF9pZDogaS5faWQsXG4gICAgICBza3U6IGkuc2t1LFxuICAgICAgc3RhdHVzOiBpLnN0YXR1cyB8fCAncGVuZGluZycsXG4gICAgICBzdG9ja0Rpc3BvbmlibGU6IF9nZXRTdG9ja0Zpc2ljbyhpLnNrdSksXG4gICAgICBjbGllbnRlc0JPOiBBcnJheS5pc0FycmF5KGkuY2xpZW50ZXNCTykgPyBpLmNsaWVudGVzQk8gOiBbXSxcbiAgICB9KSk7XG5cbiAgICBjb25zdCB2YWxpZGF0b3IgPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0V4Y2VsSW1wb3J0O1xuICAgIGlmICghdmFsaWRhdG9yIHx8IHR5cGVvZiB2YWxpZGF0b3IudmFsaWRhdGVSZXBhcnRvRXhjZWxJbXBvcnQgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigncHVyZSBmbiByZXBhcnRvRXhjZWxJbXBvcnQgbm8gZGlzcG9uaWJsZScpO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSB2YWxpZGF0b3IudmFsaWRhdGVSZXBhcnRvRXhjZWxJbXBvcnQocm93cywgcmVwYXJ0b3NBY3Rpdm9zKTtcbiAgICBfaW1wb3J0U3RhdGUgPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZS5uYW1lLFxuICAgICAgcmVjb25vY2lkYXM6IHJlc3VsdC5yZWNvbm9jaWRhcyxcbiAgICAgIGNvbkNhbWJpb3M6IHJlc3VsdC5jb25DYW1iaW9zLFxuICAgICAgZXJyb3JlczogcmVzdWx0LmVycm9yZXMsXG4gICAgICB0b3RhbEZpbGFzOiByZXN1bHQudG90YWxGaWxhcyxcbiAgICAgIHRvdGFsQXNpZ25hZG86IHJlc3VsdC50b3RhbEFzaWduYWRvLFxuICAgICAgdG90YWxFbGltaW5hcjogcmVzdWx0LnRvdGFsRWxpbWluYXIsXG4gICAgfTtcbiAgICBfcmVuZGVySW1wb3J0UHJldmlldygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gKGUgJiYgLyoqIEB0eXBlIHthbnl9ICovIChlKS5tZXNzYWdlKSB8fCBTdHJpbmcoZSk7XG4gICAgY29uc29sZS5lcnJvcignW3YxNTA1IFx1MDBBN1JlcGFydG9dIGhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlIGVycm9yOicsIGUpO1xuICAgIGlmIChwcmV2aWV3RWwpIHtcbiAgICAgIHdoaWxlIChwcmV2aWV3RWwuZmlyc3RDaGlsZCkgcHJldmlld0VsLnJlbW92ZUNoaWxkKHByZXZpZXdFbC5maXJzdENoaWxkKTtcbiAgICAgIGNvbnN0IGVyckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgZXJyRGl2LnN0eWxlLmNzc1RleHQgPVxuICAgICAgICAnY29sb3I6I2M3MzcyZjtwYWRkaW5nOjEycHg7YmFja2dyb3VuZDpyZ2JhKDI1NSw1OSw0OCwuMDgpO2JvcmRlci1yYWRpdXM6OHB4JztcbiAgICAgIGVyckRpdi50ZXh0Q29udGVudCA9ICdFcnJvciBsZXllbmRvIEV4Y2VsOiAnICsgbXNnO1xuICAgICAgcHJldmlld0VsLmFwcGVuZENoaWxkKGVyckRpdik7XG4gICAgfVxuICAgIF9sb2dFeHBvcnRFcnJvcignaW1wb3J0X3JlYWQnLCBtc2cpO1xuICB9XG59O1xuXG4vKipcbiAqIEBwYXJhbSB7YW55fSB3c1xuICogQHJldHVybnMge09iamVjdDxudW1iZXIsc3RyaW5nPn1cbiAqL1xuZnVuY3Rpb24gX2J1aWxkSGVhZGVyTWFwKHdzKSB7XG4gIC8qKiBAdHlwZSB7T2JqZWN0PG51bWJlcixzdHJpbmc+fSAqL1xuICBjb25zdCBvdXQgPSB7fTtcbiAgY29uc3QgaGVhZGVyUm93ID0gd3MuZ2V0Um93KDEpO1xuICBoZWFkZXJSb3cuZWFjaENlbGwoXG4gICAgeyBpbmNsdWRlRW1wdHk6IGZhbHNlIH0sXG4gICAgKC8qKiBAdHlwZSB7YW55fSAqLyBjZWxsLCAvKiogQHR5cGUge251bWJlcn0gKi8gY29sKSA9PiB7XG4gICAgICBsZXQgdiA9IGNlbGwudmFsdWU7XG4gICAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgJ3RleHQnIGluIHYpIHYgPSB2LnRleHQ7XG4gICAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgJ3Jlc3VsdCcgaW4gdikgdiA9IHYucmVzdWx0O1xuICAgICAgY29uc3QgbGFiZWwgPSBTdHJpbmcodiB8fCAnJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICghbGFiZWwpIHJldHVybjtcbiAgICAgIGlmIChsYWJlbCA9PT0gJ2NvZGlnbycgfHwgbGFiZWwgPT09ICdjXHUwMEYzZGlnbycpIG91dFtjb2xdID0gJ0NvZGlnbyc7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ2NsaWVudGUnKSBvdXRbY29sXSA9ICdDbGllbnRlJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnYmFja29yZGVyJykgb3V0W2NvbF0gPSAnQmFja29yZGVyJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnc3RvY2sgZGlzcG9uaWJsZScgfHwgbGFiZWwgPT09ICdzdG9ja19kaXNwb25pYmxlJylcbiAgICAgICAgb3V0W2NvbF0gPSAnU3RvY2tEaXNwb25pYmxlJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnYXNpZ25hZG8nKSBvdXRbY29sXSA9ICdBc2lnbmFkbyc7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ3Z1ZWx2ZSBhIGJhY2tvcmRlcicpIG91dFtjb2xdID0gJ1Z1ZWxlQUJhY2tvcmRlcic7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ2VsaW1pbmFyJykgb3V0W2NvbF0gPSAnRWxpbWluYXInO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdyZXBhcnRvIGlkJyB8fCBsYWJlbCA9PT0gJ3JlcGFydG9pZCcgfHwgbGFiZWwgPT09ICdyZXBhcnRvX2lkJylcbiAgICAgICAgb3V0W2NvbF0gPSAnUmVwYXJ0b0lkJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnY2FyZGNvZGUnIHx8IGxhYmVsID09PSAnY2FyZCBjb2RlJyB8fCBsYWJlbCA9PT0gJ2NhcmRfY29kZScpXG4gICAgICAgIG91dFtjb2xdID0gJ0NhcmRDb2RlJztcbiAgICB9XG4gICk7XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ3JlYSB1biBkaXYgY29uIGNsYXNzL3N0eWxlL3RleHQgc2VndXJvcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdHlsZUNzc1xuICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSB0ZXh0VmFsdWVcbiAqIEByZXR1cm5zIHtIVE1MRGl2RWxlbWVudH1cbiAqL1xuZnVuY3Rpb24gX21rRGl2KHN0eWxlQ3NzLCB0ZXh0VmFsdWUpIHtcbiAgY29uc3QgZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBkLnN0eWxlLmNzc1RleHQgPSBzdHlsZUNzcztcbiAgaWYgKHRleHRWYWx1ZSAhPSBudWxsKSBkLnRleHRDb250ZW50ID0gdGV4dFZhbHVlO1xuICByZXR1cm4gZDtcbn1cblxuZnVuY3Rpb24gX3JlbmRlckltcG9ydFByZXZpZXcoKSB7XG4gIGNvbnN0IHByZXZpZXdFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1wcmV2aWV3Jyk7XG4gIGNvbnN0IGFwcGx5QnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bicpO1xuICBpZiAoIXByZXZpZXdFbCB8fCAhX2ltcG9ydFN0YXRlKSByZXR1cm47XG4gIGNvbnN0IHMgPSBfaW1wb3J0U3RhdGU7XG4gIHdoaWxlIChwcmV2aWV3RWwuZmlyc3RDaGlsZCkgcHJldmlld0VsLnJlbW92ZUNoaWxkKHByZXZpZXdFbC5maXJzdENoaWxkKTtcblxuICAvLyBDaGlwcyBkZSByZXN1bWVuLlxuICBjb25zdCBjaGlwc1JvdyA9IF9ta0RpdignZGlzcGxheTpmbGV4O2dhcDoxMHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTRweCcsIG51bGwpO1xuICBjb25zdCBjaGlwUmVjID0gX21rRGl2KFxuICAgICdmbGV4OjE7bWluLXdpZHRoOjE0MHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6cmdiYSg1MiwxOTksODksLjE0KTtib3JkZXItcmFkaXVzOjhweDtjb2xvcjojMjQ4YTNkJyxcbiAgICBudWxsXG4gICk7XG4gIGNoaXBSZWMuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzouNXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZScsICdSZWNvbm9jaWRhcycpXG4gICk7XG4gIGNoaXBSZWMuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MjJweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLXRvcDoycHgnLCBTdHJpbmcocy5yZWNvbm9jaWRhcy5sZW5ndGgpKVxuICApO1xuICBjaGlwc1Jvdy5hcHBlbmRDaGlsZChjaGlwUmVjKTtcbiAgY29uc3QgY2hpcENhbWIgPSBfbWtEaXYoXG4gICAgJ2ZsZXg6MTttaW4td2lkdGg6MTQwcHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDpyZ2JhKDAsMTIyLDI1NSwuMTQpO2JvcmRlci1yYWRpdXM6OHB4O2NvbG9yOiMwMDQwZGQnLFxuICAgIG51bGxcbiAgKTtcbiAgY2hpcENhbWIuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzouNXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZScsICdDb24gY2FtYmlvcycpXG4gICk7XG4gIGNoaXBDYW1iLmFwcGVuZENoaWxkKFxuICAgIF9ta0RpdignZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi10b3A6MnB4JywgU3RyaW5nKHMuY29uQ2FtYmlvcy5sZW5ndGgpKVxuICApO1xuICBjaGlwc1Jvdy5hcHBlbmRDaGlsZChjaGlwQ2FtYik7XG4gIGNvbnN0IGNoaXBFcnIgPSBfbWtEaXYoXG4gICAgJ2ZsZXg6MTttaW4td2lkdGg6MTQwcHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICtcbiAgICAgIChzLmVycm9yZXMubGVuZ3RoID8gJ3JnYmEoMjU1LDU5LDQ4LC4xNCknIDogJ3JnYmEoMTIwLDEyMCwxMjgsLjA4KScpICtcbiAgICAgICc7Ym9yZGVyLXJhZGl1czo4cHg7Y29sb3I6JyArXG4gICAgICAocy5lcnJvcmVzLmxlbmd0aCA/ICcjYzczNzJmJyA6ICcjNmU2ZTczJyksXG4gICAgbnVsbFxuICApO1xuICBjaGlwRXJyLmFwcGVuZENoaWxkKFxuICAgIF9ta0RpdignZm9udC1zaXplOjExcHg7bGV0dGVyLXNwYWNpbmc6LjVweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2UnLCAnRXJyb3JlcycpXG4gICk7XG4gIGNoaXBFcnIuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MjJweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLXRvcDoycHgnLCBTdHJpbmcocy5lcnJvcmVzLmxlbmd0aCkpXG4gICk7XG4gIGNoaXBzUm93LmFwcGVuZENoaWxkKGNoaXBFcnIpO1xuICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoY2hpcHNSb3cpO1xuXG4gIGlmIChzLmVycm9yZXMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyQm94ID0gX21rRGl2KFxuICAgICAgJ3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6cmdiYSgyNTUsNTksNDgsLjA4KTtib3JkZXItbGVmdDozcHggc29saWQgI2M3MzcyZjtib3JkZXItcmFkaXVzOjZweDttYXJnaW4tYm90dG9tOjEycHgnLFxuICAgICAgbnVsbFxuICAgICk7XG4gICAgZXJyQm94LmFwcGVuZENoaWxkKFxuICAgICAgX21rRGl2KFxuICAgICAgICAnZm9udC13ZWlnaHQ6NzAwO2NvbG9yOiNjNzM3MmY7bWFyZ2luLWJvdHRvbTo2cHgnLFxuICAgICAgICAnSGF5ICcgK1xuICAgICAgICAgIHMuZXJyb3Jlcy5sZW5ndGggK1xuICAgICAgICAgICcgZXJyb3IoZXMpLiBDb3JyZWdpbG9zIHkgdm9sdlx1MDBFOSBhIHN1YmlyIGVsIEV4Y2VsLiBObyBzZSBhcGxpY2EgbmFkYS4nXG4gICAgICApXG4gICAgKTtcbiAgICBjb25zdCB1bCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3VsJyk7XG4gICAgdWwuc3R5bGUuY3NzVGV4dCA9ICdtYXJnaW46MDtwYWRkaW5nLWxlZnQ6MThweDtjb2xvcjojMWQxZDFmO2ZvbnQtc2l6ZToxMi41cHg7bGluZS1oZWlnaHQ6MS41JztcbiAgICBjb25zdCBzbGljZSA9IHMuZXJyb3Jlcy5zbGljZSgwLCA1MCk7XG4gICAgZm9yIChjb25zdCBlIG9mIHNsaWNlKSB7XG4gICAgICBjb25zdCBsaSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xpJyk7XG4gICAgICBsaS50ZXh0Q29udGVudCA9IGUubXNnO1xuICAgICAgdWwuYXBwZW5kQ2hpbGQobGkpO1xuICAgIH1cbiAgICBlcnJCb3guYXBwZW5kQ2hpbGQodWwpO1xuICAgIGlmIChzLmVycm9yZXMubGVuZ3RoID4gNTApIHtcbiAgICAgIGVyckJveC5hcHBlbmRDaGlsZChcbiAgICAgICAgX21rRGl2KFxuICAgICAgICAgICdjb2xvcjojODY4NjhiO2ZvbnQtc2l6ZToxMXB4O21hcmdpbi10b3A6NHB4JyxcbiAgICAgICAgICAnLi4ueSAnICsgKHMuZXJyb3Jlcy5sZW5ndGggLSA1MCkgKyAnIG1cdTAwRTFzICh2ZXIgY29uc29sYSknXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuICAgIHByZXZpZXdFbC5hcHBlbmRDaGlsZChlcnJCb3gpO1xuICB9XG5cbiAgaWYgKCFzLmVycm9yZXMubGVuZ3RoICYmIHMuY29uQ2FtYmlvcy5sZW5ndGgpIHtcbiAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoXG4gICAgICBfbWtEaXYoXG4gICAgICAgICdwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnJnYmEoNTIsMTk5LDg5LC4wOCk7Ym9yZGVyLXJhZGl1czo2cHg7bWFyZ2luLWJvdHRvbToxMnB4O2ZvbnQtc2l6ZToxM3B4JyxcbiAgICAgICAgJ1Jlc3VtZW4gYSBhcGxpY2FyOiAnICtcbiAgICAgICAgICBzLmNvbkNhbWJpb3MubGVuZ3RoICtcbiAgICAgICAgICAnIGNhbWJpbyhzKSBcdTAwQjcgJyArXG4gICAgICAgICAgcy50b3RhbEFzaWduYWRvICtcbiAgICAgICAgICAnIHUgYXNpZ25hZGFzIFx1MDBCNyAnICtcbiAgICAgICAgICBzLnRvdGFsRWxpbWluYXIgK1xuICAgICAgICAgICcgdSBlbGltaW5hZGFzJ1xuICAgICAgKVxuICAgICk7XG4gICAgLy8gVGFibGEgcHJldmlldy5cbiAgICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RhYmxlJyk7XG4gICAgdGFibGUuc3R5bGUuY3NzVGV4dCA9ICd3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweCc7XG4gICAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0aGVhZCcpO1xuICAgIGNvbnN0IHRyaCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gICAgdHJoLnN0eWxlLmNzc1RleHQgPSAnYmFja2dyb3VuZDojZjVmNWY3JztcbiAgICBmb3IgKGNvbnN0IGggb2YgWydTS1UnLCAnQ2xpZW50ZScsICdCTycsICdBc2lnLicsICdFbGltLiddKSB7XG4gICAgICBjb25zdCB0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoJyk7XG4gICAgICB0aC5zdHlsZS5jc3NUZXh0ID1cbiAgICAgICAgJ3BhZGRpbmc6NnB4O3RleHQtYWxpZ246JyArIChoID09PSAnU0tVJyB8fCBoID09PSAnQ2xpZW50ZScgPyAnbGVmdCcgOiAncmlnaHQnKTtcbiAgICAgIHRoLnRleHRDb250ZW50ID0gaDtcbiAgICAgIHRyaC5hcHBlbmRDaGlsZCh0aCk7XG4gICAgfVxuICAgIHRoZWFkLmFwcGVuZENoaWxkKHRyaCk7XG4gICAgdGFibGUuYXBwZW5kQ2hpbGQodGhlYWQpO1xuICAgIGNvbnN0IHRib2R5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGJvZHknKTtcbiAgICBjb25zdCBwcmV2aWV3Um93cyA9IHMuY29uQ2FtYmlvcy5zbGljZSgwLCAzMCk7XG4gICAgZm9yIChjb25zdCByIG9mIHByZXZpZXdSb3dzKSB7XG4gICAgICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gICAgICB0ci5zdHlsZS5jc3NUZXh0ID0gJ2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNlZWUnO1xuICAgICAgY29uc3QgYWRkVGQgPSAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHR4dCwgLyoqIEB0eXBlIHtzdHJpbmd9ICovIGNzcykgPT4ge1xuICAgICAgICBjb25zdCB0ZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gICAgICAgIHRkLnN0eWxlLmNzc1RleHQgPSBjc3M7XG4gICAgICAgIHRkLnRleHRDb250ZW50ID0gdHh0O1xuICAgICAgICB0ci5hcHBlbmRDaGlsZCh0ZCk7XG4gICAgICB9O1xuICAgICAgYWRkVGQoci5za3UsICdwYWRkaW5nOjRweCA2cHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlJyk7XG4gICAgICBhZGRUZChyLmNsaWVudE5hbWUsICdwYWRkaW5nOjRweCA2cHgnKTtcbiAgICAgIGFkZFRkKFN0cmluZyhyLmJhY2tvcmRlckFjdHVhbCksICdwYWRkaW5nOjRweCA2cHg7dGV4dC1hbGlnbjpyaWdodCcpO1xuICAgICAgYWRkVGQoXG4gICAgICAgIHIuYXNpZ25hZG9OdWV2byA/IFN0cmluZyhyLmFzaWduYWRvTnVldm8pIDogJycsXG4gICAgICAgICdwYWRkaW5nOjRweCA2cHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjojMjQ4YTNkO2ZvbnQtd2VpZ2h0OjYwMCdcbiAgICAgICk7XG4gICAgICBhZGRUZChcbiAgICAgICAgci5lbGltaW5hck51ZXZvID8gU3RyaW5nKHIuZWxpbWluYXJOdWV2bykgOiAnJyxcbiAgICAgICAgJ3BhZGRpbmc6NHB4IDZweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOiNjNzM3MmY7Zm9udC13ZWlnaHQ6NjAwJ1xuICAgICAgKTtcbiAgICAgIHRib2R5LmFwcGVuZENoaWxkKHRyKTtcbiAgICB9XG4gICAgdGFibGUuYXBwZW5kQ2hpbGQodGJvZHkpO1xuICAgIHByZXZpZXdFbC5hcHBlbmRDaGlsZCh0YWJsZSk7XG4gICAgaWYgKHMuY29uQ2FtYmlvcy5sZW5ndGggPiAzMCkge1xuICAgICAgcHJldmlld0VsLmFwcGVuZENoaWxkKFxuICAgICAgICBfbWtEaXYoXG4gICAgICAgICAgJ2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjExcHg7bWFyZ2luLXRvcDo0cHgnLFxuICAgICAgICAgICcuLi55ICcgKyAocy5jb25DYW1iaW9zLmxlbmd0aCAtIDMwKSArICcgbVx1MDBFMXMnXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFzLmVycm9yZXMubGVuZ3RoICYmICFzLmNvbkNhbWJpb3MubGVuZ3RoKSB7XG4gICAgcHJldmlld0VsLmFwcGVuZENoaWxkKFxuICAgICAgX21rRGl2KFxuICAgICAgICAncGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDpyZ2JhKDI1NSwyMDQsMCwuMTQpO2JvcmRlci1yYWRpdXM6NnB4O2NvbG9yOiM4YTZkMDAnLFxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY2FtYmlvcyAoQXNpZ25hZG89MCB5IEVsaW1pbmFyPTAgZW4gdG9kYXMgbGFzIGZpbGFzKS4gTmFkYSBxdWUgYXBsaWNhci4nXG4gICAgICApXG4gICAgKTtcbiAgfVxuXG4gIGlmIChhcHBseUJ0bikge1xuICAgIGNvbnN0IGNhbkFwcGx5ID0gcy5lcnJvcmVzLmxlbmd0aCA9PT0gMCAmJiBzLmNvbkNhbWJpb3MubGVuZ3RoID4gMDtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5kaXNhYmxlZCA9ICFjYW5BcHBseTtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5zdHlsZS5vcGFjaXR5ID0gY2FuQXBwbHkgPyAnMScgOiAnMC40JztcbiAgfVxufVxuXG53aW5kb3cuY29uZmlybVJlcGFydG9JbXBvcnRBcHBseSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgaWYgKCFfaW1wb3J0U3RhdGUgfHwgX2ltcG9ydFN0YXRlLmNvbkNhbWJpb3MubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGlmIChfaW1wb3J0U3RhdGUuZXJyb3Jlcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gc2UgcHVlZGUgYXBsaWNhcjogaGF5IGVycm9yZXMgZW4gbGEgdmlzdGEgcHJldmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIV9pc0FkbWluTGlrZUZvckltcG9ydCgpKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGFwbGljYXIgcmVwYXJ0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYXBwbHlCdG4gPSAvKiogQHR5cGUge2FueX0gKi8gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nKSk7XG4gIGlmIChhcHBseUJ0bikge1xuICAgIGFwcGx5QnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgICBhcHBseUJ0bi50ZXh0Q29udGVudCA9ICdBcGxpY2FuZG9cdTIwMjYnO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3QgdmFsaWRhdG9yID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLnJlcGFydG9FeGNlbEltcG9ydDtcbiAgICBjb25zdCBncm91cHMgPSB2YWxpZGF0b3IuZ3JvdXBJbXBvcnRNYXRjaGVzQnlSZXBhcnRvKF9pbXBvcnRTdGF0ZS5jb25DYW1iaW9zKTtcbiAgICBjb25zdCBpbmdyZXNvcyA9IEFycmF5LmlzQXJyYXkody5fcmVwYXJ0b0luZ3Jlc29zKSA/IHcuX3JlcGFydG9JbmdyZXNvcyA6IFtdO1xuXG4gICAgY29uc3QgY2FsbGFibGUgPSB3LmZpcmViYXNlXG4gICAgICAuYXBwKClcbiAgICAgIC5mdW5jdGlvbnMoJ3NvdXRoYW1lcmljYS1lYXN0MScpXG4gICAgICAuaHR0cHNDYWxsYWJsZSgnYXBwbHlSZXBhcnRvTWFudWFsQ0YnKTtcbiAgICBsZXQgb2tDb3VudCA9IDA7XG4gICAgbGV0IGZhaWxDb3VudCA9IDA7XG4gICAgY29uc3QgZmFpbHVyZXMgPSBbXTtcbiAgICBsZXQgdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMgPSAwO1xuICAgIGxldCB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMgPSAwO1xuXG4gICAgZm9yIChjb25zdCBnIG9mIGdyb3Vwcykge1xuICAgICAgY29uc3QgaW5nID0gaW5ncmVzb3MuZmluZCgoLyoqIEB0eXBlIHthbnl9ICovIGkpID0+IGkuX2lkID09PSBnLnJlcGFydG9JZCk7XG4gICAgICBpZiAoIWluZykge1xuICAgICAgICBmYWlsQ291bnQrKztcbiAgICAgICAgZmFpbHVyZXMucHVzaCgnUmVwYXJ0byAnICsgZy5yZXBhcnRvSWQgKyAnIHlhIG5vIGV4aXN0ZScpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNsaWVudGVzID0gQXJyYXkuaXNBcnJheShpbmcuY2xpZW50ZXNCTykgPyBpbmcuY2xpZW50ZXNCTyA6IFtdO1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgICAgY29uc3QgYXNzaWdubWVudHMgPSBbXTtcbiAgICAgIC8qKiBAdHlwZSB7QXJyYXk8YW55Pn0gKi9cbiAgICAgIGNvbnN0IGVsaW1pbmF0aW9ucyA9IFtdO1xuICAgICAgZm9yIChjb25zdCBhIG9mIGcuYXNzaWdubWVudHMpIHtcbiAgICAgICAgY29uc3QgYyA9IGNsaWVudGVzLmZpbmQoXG4gICAgICAgICAgKC8qKiBAdHlwZSB7YW55fSAqLyB4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKHguY2xpZW50Q2FyZENvZGUgfHwgeC5jYXJkQ29kZSB8fCAnJylcbiAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKClcbiAgICAgICAgICAgICAgLnRyaW0oKSA9PT0gU3RyaW5nKGEuY2FyZENvZGUpLnRvVXBwZXJDYXNlKCkudHJpbSgpXG4gICAgICAgICk7XG4gICAgICAgIGlmICghYykge1xuICAgICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgICAnUmVwYXJ0byAnICsgZy5yZXBhcnRvSWQgKyAnIC8gQ2FyZENvZGUgJyArIGEuY2FyZENvZGUgKyAnIHlhIG5vIGVzdFx1MDBFMSBlbiBCTydcbiAgICAgICAgICApO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGFzc2lnbm1lbnRzLnB1c2goe1xuICAgICAgICAgIHBlZGlkb0lkOiBjLnBlZGlkb0lkLFxuICAgICAgICAgIGxpbmVJbmRleDogTnVtYmVyKGMubGluZUluZGV4KSB8fCAwLFxuICAgICAgICAgIHF0eUFzaWduYWRhOiBhLnF0eUFzaWduYWRhLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZSBvZiBnLmVsaW1pbmF0aW9ucykge1xuICAgICAgICBjb25zdCBjID0gY2xpZW50ZXMuZmluZChcbiAgICAgICAgICAoLyoqIEB0eXBlIHthbnl9ICovIHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeC5jbGllbnRDYXJkQ29kZSB8fCB4LmNhcmRDb2RlIHx8ICcnKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKVxuICAgICAgICAgICAgICAudHJpbSgpID09PSBTdHJpbmcoZS5jYXJkQ29kZSkudG9VcHBlckNhc2UoKS50cmltKClcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFjKSB7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICAgICdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgLyBDYXJkQ29kZSAnICsgZS5jYXJkQ29kZSArICcgeWEgbm8gZXN0XHUwMEUxIGVuIEJPJ1xuICAgICAgICAgICk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZWxpbWluYXRpb25zLnB1c2goe1xuICAgICAgICAgIHBlZGlkb0lkOiBjLnBlZGlkb0lkLFxuICAgICAgICAgIGxpbmVJbmRleDogTnVtYmVyKGMubGluZUluZGV4KSB8fCAwLFxuICAgICAgICAgIHF0eUVsaW1pbmFyOiBlLnF0eUVsaW1pbmFyLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghYXNzaWdubWVudHMubGVuZ3RoICYmICFlbGltaW5hdGlvbnMubGVuZ3RoKSBjb250aW51ZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKHtcbiAgICAgICAgICBpbmdyZXNvSWQ6IGcucmVwYXJ0b0lkLFxuICAgICAgICAgIGFzc2lnbm1lbnRzLFxuICAgICAgICAgIGVsaW1pbmF0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHIgPSByZXMuZGF0YSB8fCB7fTtcbiAgICAgICAgaWYgKHIub2spIHtcbiAgICAgICAgICBva0NvdW50Kys7XG4gICAgICAgICAgdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMgKz0gYXNzaWdubWVudHMubGVuZ3RoO1xuICAgICAgICAgIHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyArPSBlbGltaW5hdGlvbnMubGVuZ3RoO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZhaWxDb3VudCsrO1xuICAgICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgICBnLnJlcGFydG9JZCArXG4gICAgICAgICAgICAgICcgKCcgK1xuICAgICAgICAgICAgICBnLnNrdSArXG4gICAgICAgICAgICAgICcpOiAnICtcbiAgICAgICAgICAgICAgKChyLmVycm9ycyB8fCBbXSkuam9pbignOyAnKSB8fCAnZXJyb3IgZGVzY29ub2NpZG8nKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGNhbGxFcnIpIHtcbiAgICAgICAgZmFpbENvdW50Kys7XG4gICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgZy5yZXBhcnRvSWQgK1xuICAgICAgICAgICAgJyAoJyArXG4gICAgICAgICAgICBnLnNrdSArXG4gICAgICAgICAgICAnKTogJyArXG4gICAgICAgICAgICAoKGNhbGxFcnIgJiYgLyoqIEB0eXBlIHthbnl9ICovIChjYWxsRXJyKS5tZXNzYWdlKSB8fCBTdHJpbmcoY2FsbEVycikpXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh3LmZiRGIgJiYgdHlwZW9mIHcuZmJEYi5jb2xsZWN0aW9uID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGF3YWl0IHcuZmJEYi5jb2xsZWN0aW9uKCdyZXBhcnRvX2xvZycpLmFkZCh7XG4gICAgICAgICAgb3JpZ2VuOiAnaW1wb3J0JyxcbiAgICAgICAgICBmaWxlTmFtZTogX2ltcG9ydFN0YXRlLmZpbGVOYW1lLFxuICAgICAgICAgIGltcG9ydGVkQnlVaWQ6ICh3LmN1cnJlbnRVc2VyICYmIHcuY3VycmVudFVzZXIudWlkKSB8fCBudWxsLFxuICAgICAgICAgIGltcG9ydGVkQnlFbWFpbDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgbnVsbCxcbiAgICAgICAgICByb3dzQ291bnQ6IF9pbXBvcnRTdGF0ZS50b3RhbEZpbGFzLFxuICAgICAgICAgIGFzc2lnbm1lbnRzQ291bnQ6IHRvdGFsQXNpZ25hY2lvbmVzQXBsaWNhZGFzLFxuICAgICAgICAgIGVsaW1pbmF0aW9uc0NvdW50OiB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMsXG4gICAgICAgICAgcmVwYXJ0b3NQcm9jZXNhZG9zOiBncm91cHMubGVuZ3RoLFxuICAgICAgICAgIG9rQ291bnQsXG4gICAgICAgICAgZmFpbENvdW50LFxuICAgICAgICAgIGltcG9ydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGxvZ0Vycikge1xuICAgICAgY29uc29sZS53YXJuKCdbdjE1MDVdIHJlcGFydG9fbG9nIG9yaWdlbj1pbXBvcnQgd3JpdGUgZmFpbGVkJywgbG9nRXJyKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdW1tYXJ5ID1cbiAgICAgIHRvdGFsQXNpZ25hY2lvbmVzQXBsaWNhZGFzICtcbiAgICAgICcgYXNpZ25hY2lvbmVzIGFwbGljYWRhcyBcdTAwQjcgJyArXG4gICAgICB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMgK1xuICAgICAgJyBlbGltaW5hY2lvbmVzIGFwbGljYWRhcycgK1xuICAgICAgKGZhaWxDb3VudFxuICAgICAgICA/ICdcXG5cXG5SZXBhcnRvcyBjb24gZXJyb3IgKCcgKyBmYWlsQ291bnQgKyAnKTpcXG4nICsgZmFpbHVyZXMuc2xpY2UoMCwgNSkuam9pbignXFxuJylcbiAgICAgICAgOiAnJyk7XG4gICAgYWxlcnQoc3VtbWFyeSk7XG4gICAgaWYgKG9rQ291bnQgPiAwKSBfc3luY1RhZygnSW1wb3J0IFJlcGFydG8gYXBsaWNhZG8gXHUwMEI3ICcgKyBva0NvdW50ICsgJyByZXBhcnRvKHMpJywgMzIwMCk7XG4gICAgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgJiYgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2coKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IChlICYmIC8qKiBAdHlwZSB7YW55fSAqLyAoZSkubWVzc2FnZSkgfHwgU3RyaW5nKGUpO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1t2MTUwNSBcdTAwQTdSZXBhcnRvXSBjb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5IGVycm9yOicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBhcGxpY2FuZG8gaW1wb3J0OiAnICsgbXNnKTtcbiAgICBfbG9nRXhwb3J0RXJyb3IoJ2ltcG9ydF9hcHBseScsIG1zZyk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGFwcGx5QnRuKSB7XG4gICAgICBhcHBseUJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgICAgYXBwbHlCdG4udGV4dENvbnRlbnQgPSAnQXBsaWNhciByZXBhcnRvIGltcG9ydGFkbyc7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIENvbnN0cnV5ZSBlbCBtb2RhbCBET00gdmlhIGhlbHBlcnMgc2VndXJvcyAoc2luIGlubmVySFRNTCBjb24gY29udGVuaWRvXG4gKiBkaW5cdTAwRTFtaWNvIFx1MjAxNCBlbCBET00gZXMgZXN0XHUwMEUxdGljbykuIFByaW1lcmEgYXBlcnR1cmEgY2FjaGVhLlxuICogQHJldHVybnMge0hUTUxFbGVtZW50fVxuICovXG5mdW5jdGlvbiBfYnVpbGRJbXBvcnRNb2RhbERvbSgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbW9kYWwuaWQgPSAncmVwYXJ0by1pbXBvcnQtbW9kYWwnO1xuICBtb2RhbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIG1vZGFsLnN0eWxlLmNzc1RleHQgPSAnZGlzcGxheTpub25lO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyJztcbiAgbW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXYpID0+IHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBtb2RhbCkge1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gICAgfVxuICB9KTtcbiAgY29uc3QgYm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGJveC5jbGFzc05hbWUgPSAnbW9kYWwtYm94JztcbiAgYm94LnN0eWxlLmNzc1RleHQgPVxuICAgICd3aWR0aDptaW4oNzYwcHgsOTZ2dyk7bWF4LWhlaWdodDo5MHZoO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47YmFja2dyb3VuZDojZmZmO2JvcmRlci1yYWRpdXM6MTRweDtvdmVyZmxvdzpoaWRkZW4nO1xuICAvLyBIZWFkZXIuXG4gIGNvbnN0IGhlYWQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgaGVhZC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzoxOHB4IDIycHg7Ym9yZGVyLWJvdHRvbTowLjVweCBzb2xpZCByZ2JhKDAsMCwwLC4wOCk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweCc7XG4gIGNvbnN0IGhlYWRUaXRsZVdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgaGVhZFRpdGxlV3JhcC5zdHlsZS5jc3NUZXh0ID0gJ2ZsZXg6MSc7XG4gIGNvbnN0IGgyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaDInKTtcbiAgaDIuc3R5bGUuY3NzVGV4dCA9ICdtYXJnaW46MCAwIDJweDtmb250LXNpemU6MThweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LTAuNHB4JztcbiAgaDIudGV4dENvbnRlbnQgPSAnSW1wb3J0YXIgcmVwYXJ0byBkZXNkZSBFeGNlbCc7XG4gIGhlYWRUaXRsZVdyYXAuYXBwZW5kQ2hpbGQoaDIpO1xuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHN1YnQuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTIuNXB4O2NvbG9yOiM4Njg2OGInO1xuICBzdWJ0LnRleHRDb250ZW50ID0gJ1N1Ylx1MDBFRCBlbCBFeGNlbCBlZGl0YWRvIG9mZmxpbmUuIFNlIHZhbGlkYSBmaWxhIHBvciBmaWxhIGFudGVzIGRlIGFwbGljYXIuJztcbiAgaGVhZFRpdGxlV3JhcC5hcHBlbmRDaGlsZChzdWJ0KTtcbiAgaGVhZC5hcHBlbmRDaGlsZChoZWFkVGl0bGVXcmFwKTtcbiAgY29uc3QgY2xvc2VCdG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgY2xvc2VCdG4udHlwZSA9ICdidXR0b24nO1xuICBjbG9zZUJ0bi50ZXh0Q29udGVudCA9ICdcdTAwRDcnO1xuICBjbG9zZUJ0bi5zdHlsZS5jc3NUZXh0ID1cbiAgICAnYm9yZGVyOm5vbmU7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xMik7d2lkdGg6MzBweDtoZWlnaHQ6MzBweDtib3JkZXItcmFkaXVzOjUwJTtjdXJzb3I6cG9pbnRlcjtjb2xvcjojNmU2ZTczO2ZvbnQtc2l6ZToxNnB4JztcbiAgY2xvc2VCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICBpZiAodHlwZW9mIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nID09PSAnZnVuY3Rpb24nKSB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZygpO1xuICB9KTtcbiAgaGVhZC5hcHBlbmRDaGlsZChjbG9zZUJ0bik7XG4gIGJveC5hcHBlbmRDaGlsZChoZWFkKTtcbiAgLy8gQm9keS5cbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBib2R5LnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzoxNnB4IDIycHg7ZmxleDoxO292ZXJmbG93LXk6YXV0bzttaW4taGVpZ2h0OjAnO1xuICBjb25zdCBmaWxlSW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xuICBmaWxlSW5wdXQudHlwZSA9ICdmaWxlJztcbiAgZmlsZUlucHV0LmlkID0gJ3JlcGFydG8taW1wb3J0LWZpbGUnO1xuICBmaWxlSW5wdXQuYWNjZXB0ID0gJy54bHN4JztcbiAgZmlsZUlucHV0LnN0eWxlLmNzc1RleHQgPSAnbWFyZ2luLWJvdHRvbToxNHB4JztcbiAgZmlsZUlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIChldikgPT4ge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKHR5cGVvZiB3LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlID09PSAnZnVuY3Rpb24nKSB3LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlKGV2KTtcbiAgfSk7XG4gIGJvZHkuYXBwZW5kQ2hpbGQoZmlsZUlucHV0KTtcbiAgY29uc3QgcHJldmlld0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBwcmV2aWV3RGl2LmlkID0gJ3JlcGFydG8taW1wb3J0LXByZXZpZXcnO1xuICBwcmV2aWV3RGl2LnN0eWxlLmNzc1RleHQgPSAnbWluLWhlaWdodDo0MHB4JztcbiAgYm9keS5hcHBlbmRDaGlsZChwcmV2aWV3RGl2KTtcbiAgYm94LmFwcGVuZENoaWxkKGJvZHkpO1xuICAvLyBGb290ZXIuXG4gIGNvbnN0IGZvb3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZm9vdC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzoxNHB4IDIycHg7Ym9yZGVyLXRvcDowLjVweCBzb2xpZCByZ2JhKDAsMCwwLC4wOCk7ZGlzcGxheTpmbGV4O2dhcDoxMHB4O2p1c3RpZnktY29udGVudDpmbGV4LWVuZCc7XG4gIGNvbnN0IGNhbmNlbEJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICBjYW5jZWxCdG4udHlwZSA9ICdidXR0b24nO1xuICBjYW5jZWxCdG4udGV4dENvbnRlbnQgPSAnQ2FuY2VsYXInO1xuICBjYW5jZWxCdG4uc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6OXB4IDE4cHg7Ym9yZGVyOjAuNXB4IHNvbGlkIHJnYmEoMCwwLDAsLjEyKTtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czo5OTlweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweCc7XG4gIGNhbmNlbEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gIH0pO1xuICBmb290LmFwcGVuZENoaWxkKGNhbmNlbEJ0bik7XG4gIGNvbnN0IGFwcGx5QnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gIGFwcGx5QnRuLnR5cGUgPSAnYnV0dG9uJztcbiAgYXBwbHlCdG4uaWQgPSAncmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJztcbiAgYXBwbHlCdG4uZGlzYWJsZWQgPSB0cnVlO1xuICBhcHBseUJ0bi50ZXh0Q29udGVudCA9ICdBcGxpY2FyIHJlcGFydG8gaW1wb3J0YWRvJztcbiAgYXBwbHlCdG4uc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6OXB4IDE4cHg7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDojMjQ4YTNkO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo5OTlweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo2MDA7b3BhY2l0eTowLjQnO1xuICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICh0eXBlb2Ygdy5jb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5ID09PSAnZnVuY3Rpb24nKSB3LmNvbmZpcm1SZXBhcnRvSW1wb3J0QXBwbHkoKTtcbiAgfSk7XG4gIGZvb3QuYXBwZW5kQ2hpbGQoYXBwbHlCdG4pO1xuICBib3guYXBwZW5kQ2hpbGQoZm9vdCk7XG4gIG1vZGFsLmFwcGVuZENoaWxkKGJveCk7XG4gIHJldHVybiBtb2RhbDtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQXlCQSxp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
