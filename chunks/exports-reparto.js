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
      await ws.protect("", {
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatCells: false,
        sort: false,
        autoFilter: true
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1yZXBhcnRvLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogZXhwb3J0cy1yZXBhcnRvICh2MTUwNSwgMjAyNi0xMC0yOCkgXHUyMDE0IGNodW5rIGxhenkgcGFyYSBlbCBmbG93IGRlIGV4cG9ydCArXG4gKiBpbXBvcnQgRXhjZWwgZGVsIFJlcGFydG8gZGUgaW5ncmVzb3MuXG4gKlxuICogRG9zIGhhbmRsZXJzIHByaW5jaXBhbGVzIGV4cHVlc3RvcyBhIHdpbmRvdzpcbiAqICAgLSB3aW5kb3cuZXhwb3J0UmVwYXJ0b01hbnVhbEV4Y2VsKCkgIFx1MjAxNCB0ZW1wbGF0ZSBlZGl0YWJsZSBjb24gOSBjb2x1bW5hc1xuICogICAgICg3IHZpc2libGVzICsgMiB0XHUwMEU5Y25pY2FzIGFsIGZpbmFsLCBncmlzZXMgeSBwcm90ZWdpZGFzKS5cbiAqICAgLSB3aW5kb3cub3BlblJlcGFydG9JbXBvcnREaWFsb2coKSAgIFx1MjAxNCBtb2RhbCBjb24gPGlucHV0IHR5cGU9ZmlsZT4sXG4gKiAgICAgcHJldmlldyBkZSB2YWxpZGFjaVx1MDBGM24sIHkgYm90XHUwMEYzbiBcIkFwbGljYXIgcmVwYXJ0byBpbXBvcnRhZG9cIi5cbiAqXG4gKiBGdWVudGUgXHUwMEZBbmljYTogcHVyZSBmbnNcbiAqICAgLSBzcmMvcHVyZS9yZXBhcnRvLWV4Y2VsLWV4cG9ydC1yb3dzLmpzIFx1MjAxNCBhcm1hZG8gZGUgZmlsYXMuXG4gKiAgIC0gc3JjL3B1cmUvcmVwYXJ0by1leGNlbC1pbXBvcnQtdmFsaWRhdG9yLmpzIFx1MjAxNCB2YWxpZGFjaVx1MDBGM24gcG9yIGZpbGEuXG4gKlxuICogUGF5bG9hZCBzZXJ2ZXI6IFNJRU1QUkUgdmlhIGBhcHBseVJlcGFydG9NYW51YWxDRmAgKGNhbGxhYmxlKS4gTlVOQ0FcbiAqIGVzY3JpdHVyYSBkaXJlY3RhIGEgRmlyZXN0b3JlIChDTEFVREUubWQgXHUwMEE3NjMgcGF0dGVybikuXG4gKlxuICogTG9nOiBgcmVwYXJ0b19sb2dgIGNvbiBgb3JpZ2VuPSdpbXBvcnQnYCArIGZpbGVOYW1lICsgaW1wb3J0ZWRCeVVpZCArIC4uLlxuICovXG5cbi8qKlxuICogTGF6eSBsb2FkZXIgcGFyYSBFeGNlbEpTLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIF9lbnN1cmVFeGNlbEpTKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAodHlwZW9mIHcubG9hZEV4Y2VsSlMgPT09ICdmdW5jdGlvbicpIGF3YWl0IHcubG9hZEV4Y2VsSlMoKTtcbiAgaWYgKCF3LkV4Y2VsSlMpIHRocm93IG5ldyBFcnJvcignRXhjZWxKUyBubyBkaXNwb25pYmxlJyk7XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IG1zZ1xuICogQHBhcmFtIHtudW1iZXJ9IFttc11cbiAqL1xuZnVuY3Rpb24gX3N5bmNUYWcobXNnLCBtcykge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAodHlwZW9mIHcuc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0cnkge1xuICAgICAgdy5zaG93U3luY1RhZyhtc2csIG1zKTtcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgLyogaWdub3JlICovXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IHNrdVxuICogQHJldHVybnMge251bWJlcn1cbiAqL1xuZnVuY3Rpb24gX2dldFN0b2NrRmlzaWNvKHNrdSkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAodHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgIT09ICdmdW5jdGlvbicpIHJldHVybiAwO1xuICB0cnkge1xuICAgIHJldHVybiBOdW1iZXIody5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YShza3UpKSB8fCAwO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiAwO1xuICB9XG59XG5cbi8qKlxuICogQHJldHVybnMge3tzZWFyY2g6IHN0cmluZywgaGlkZU5vU3RvY2s6IGJvb2xlYW59fVxuICovXG5mdW5jdGlvbiBfcmVhZEZpbHRyb3NNb2RhbFJlcGFydG8oKSB7XG4gIGNvbnN0IHNFbCA9IHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgPyBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1zZWFyY2gnKSA6IG51bGw7XG4gIGNvbnN0IGhFbCA9XG4gICAgdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyA/IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWhpZGUtbm9zdG9jaycpIDogbnVsbDtcbiAgcmV0dXJuIHtcbiAgICBzZWFyY2g6IHNFbCA/IFN0cmluZygvKiogQHR5cGUge2FueX0gKi8gKHNFbCkudmFsdWUgfHwgJycpLnRyaW0oKSA6ICcnLFxuICAgIGhpZGVOb1N0b2NrOiBoRWwgPyAhISgvKiogQHR5cGUge2FueX0gKi8gKGhFbCkuY2hlY2tlZCkgOiB0cnVlLFxuICB9O1xufVxuXG4vKipcbiAqIEBwYXJhbSB7c3RyaW5nfSBleHBvcnRLaW5kXG4gKiBAcGFyYW0ge3N0cmluZ30gbXNnXG4gKi9cbmZ1bmN0aW9uIF9sb2dFeHBvcnRFcnJvcihleHBvcnRLaW5kLCBtc2cpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICghdy5mYkRiIHx8IHR5cGVvZiB3LmZiRGIuY29sbGVjdGlvbiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuO1xuICAgIHcuZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ29wZXJhdGlvbnNfbG9nJylcbiAgICAgIC5hZGQoe1xuICAgICAgICB0eXBlOiAnZXhwb3J0X2ZhaWxlZCcsXG4gICAgICAgIGV4cG9ydEtpbmQsXG4gICAgICAgIGVycm9yOiBtc2cuc2xpY2UoMCwgNTAwKSxcbiAgICAgICAgdXNlclVpZDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci51aWQpIHx8IG51bGwsXG4gICAgICAgIHVzZXJFbWFpbDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgbnVsbCxcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLFxuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgIC8qIGlnbm9yZSAqL1xuICAgICAgfSk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgLyogaWdub3JlICovXG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQQVJURSAxIFx1MjAxNCBFeHBvcnQgbWFudWFsICh0ZW1wbGF0ZSBlZGl0YWJsZSlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZXhwb3J0UmVwYXJ0b01hbnVhbEV4Y2VsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBjb25zdCBpbmdyZXNvcyA9IEFycmF5LmlzQXJyYXkody5fcmVwYXJ0b0luZ3Jlc29zKSA/IHcuX3JlcGFydG9JbmdyZXNvcyA6IFtdO1xuICBpZiAoIWluZ3Jlc29zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgaW5ncmVzb3MgZGUgcmVwYXJ0byBwYXJhIGV4cG9ydGFyLiBBYnJcdTAwRUQgZWwgbW9kYWwgXCJSZXBhcnRvIGRlIGluZ3Jlc29zXCIgcHJpbWVyby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgX3N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBlZGl0YWJsZVx1MjAyNicpO1xuICB0cnkge1xuICAgIGNvbnN0IHB1cmVNb2QgPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0V4Y2VsRXhwb3J0O1xuICAgIGlmICghcHVyZU1vZCB8fCB0eXBlb2YgcHVyZU1vZC5jb21wdXRlUmVwYXJ0b0V4Y2VsRXhwb3J0Um93cyAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdwdXJlIGZuIHJlcGFydG9FeGNlbEV4cG9ydCBubyBkaXNwb25pYmxlJyk7XG4gICAgfVxuICAgIGNvbnN0IGNvbnNvbGlkYXRlRm4gPVxuICAgICAgdy5fX3BoYXNlMCAmJlxuICAgICAgdy5fX3BoYXNlMC5wdXJlICYmXG4gICAgICB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0NvbnNvbGlkYXRlICYmXG4gICAgICB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0NvbnNvbGlkYXRlLmNvbnNvbGlkYXRlQ2xpZW50ZXNCTztcbiAgICBjb25zdCBmaWx0cm9zID0gX3JlYWRGaWx0cm9zTW9kYWxSZXBhcnRvKCk7XG4gICAgY29uc3QgcmVzdWx0ID0gcHVyZU1vZC5jb21wdXRlUmVwYXJ0b0V4Y2VsRXhwb3J0Um93cyhpbmdyZXNvcywgZmlsdHJvcywge1xuICAgICAgZ2V0U3RvY2tGaXNpY286IF9nZXRTdG9ja0Zpc2ljbyxcbiAgICAgIGNvbnNvbGlkYXRlRm46IHR5cGVvZiBjb25zb2xpZGF0ZUZuID09PSAnZnVuY3Rpb24nID8gY29uc29saWRhdGVGbiA6IHVuZGVmaW5lZCxcbiAgICB9KTtcbiAgICBpZiAoIXJlc3VsdC5yb3dzLmxlbmd0aCkge1xuICAgICAgYWxlcnQoXG4gICAgICAgICdObyBoYXkgZmlsYXMgcGFyYSBleHBvcnRhciBjb24gbG9zIGZpbHRyb3MgYWN0dWFsZXMuIExpbXBpXHUwMEUxIGJcdTAwRkFzcXVlZGEgbyBkZXN0aWxkXHUwMEUxIFwiT2N1bHRhciBzaW4gc3RvY2tcIi4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IF9lbnN1cmVFeGNlbEpTKCk7XG4gICAgY29uc3QgRXhjZWxKUyA9IHcuRXhjZWxKUztcbiAgICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1JlcGFydG8nKTtcblxuICAgIHdzLmNvbHVtbnMgPSBbXG4gICAgICB7IGhlYWRlcjogJ0NvZGlnbycsIGtleTogJ0NvZGlnbycsIHdpZHRoOiAxOCB9LFxuICAgICAgeyBoZWFkZXI6ICdDbGllbnRlJywga2V5OiAnQ2xpZW50ZScsIHdpZHRoOiAzNiB9LFxuICAgICAgeyBoZWFkZXI6ICdCYWNrb3JkZXInLCBrZXk6ICdCYWNrb3JkZXInLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnU3RvY2sgZGlzcG9uaWJsZScsIGtleTogJ1N0b2NrRGlzcG9uaWJsZScsIHdpZHRoOiAxNSB9LFxuICAgICAgeyBoZWFkZXI6ICdBc2lnbmFkbycsIGtleTogJ0FzaWduYWRvJywgd2lkdGg6IDEyIH0sXG4gICAgICB7IGhlYWRlcjogJ1Z1ZWx2ZSBhIGJhY2tvcmRlcicsIGtleTogJ1Z1ZWxlQUJhY2tvcmRlcicsIHdpZHRoOiAxOCB9LFxuICAgICAgeyBoZWFkZXI6ICdFbGltaW5hcicsIGtleTogJ0VsaW1pbmFyJywgd2lkdGg6IDEyIH0sXG4gICAgICB7IGhlYWRlcjogJ1JlcGFydG8gSUQnLCBrZXk6ICdSZXBhcnRvSWQnLCB3aWR0aDogMjQgfSxcbiAgICAgIHsgaGVhZGVyOiAnQ2FyZENvZGUnLCBrZXk6ICdDYXJkQ29kZScsIHdpZHRoOiAxNiB9LFxuICAgIF07XG5cbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMSk7XG4gICAgaGVhZGVyUm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYxNjY1MzQnIH0gfTtcbiAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBib2xkOiB0cnVlLCBzaXplOiAxMiB9O1xuICAgICAgY2VsbC5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgICBjZWxsLmJvcmRlciA9IHtcbiAgICAgICAgdG9wOiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9LFxuICAgICAgICBsZWZ0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9LFxuICAgICAgICByaWdodDogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZDQ0NDQ0MnIH0gfSxcbiAgICAgICAgYm90dG9tOiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9LFxuICAgICAgfTtcbiAgICB9KTtcbiAgICBoZWFkZXJSb3cuaGVpZ2h0ID0gMjg7XG4gICAgaGVhZGVyUm93LmdldENlbGwoOCkuZmlsbCA9IHtcbiAgICAgIHR5cGU6ICdwYXR0ZXJuJyxcbiAgICAgIHBhdHRlcm46ICdzb2xpZCcsXG4gICAgICBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjg4ODg4OCcgfSxcbiAgICB9O1xuICAgIGhlYWRlclJvdy5nZXRDZWxsKDkpLmZpbGwgPSB7XG4gICAgICB0eXBlOiAncGF0dGVybicsXG4gICAgICBwYXR0ZXJuOiAnc29saWQnLFxuICAgICAgZmdDb2xvcjogeyBhcmdiOiAnRkY4ODg4ODgnIH0sXG4gICAgfTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdWx0LnJvd3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHIgPSByZXN1bHQucm93c1tpXTtcbiAgICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICAgIENvZGlnbzogci5Db2RpZ28sXG4gICAgICAgIENsaWVudGU6IHIuQ2xpZW50ZSxcbiAgICAgICAgQmFja29yZGVyOiByLkJhY2tvcmRlcixcbiAgICAgICAgU3RvY2tEaXNwb25pYmxlOiByLlN0b2NrRGlzcG9uaWJsZSxcbiAgICAgICAgQXNpZ25hZG86IHIuQXNpZ25hZG8sXG4gICAgICAgIFZ1ZWxlQUJhY2tvcmRlcjogbnVsbCxcbiAgICAgICAgRWxpbWluYXI6IHIuRWxpbWluYXIsXG4gICAgICAgIFJlcGFydG9JZDogci5SZXBhcnRvSWQsXG4gICAgICAgIENhcmRDb2RlOiByLkNhcmRDb2RlLFxuICAgICAgfSk7XG4gICAgICByb3cuZ2V0Q2VsbCg2KS52YWx1ZSA9IHtcbiAgICAgICAgZm9ybXVsYTogci5WdWVsZUFCYWNrb3JkZXIucmVwbGFjZSgvXj0vLCAnJyksXG4gICAgICAgIHJlc3VsdDogci5CYWNrb3JkZXIgLSByLkFzaWduYWRvIC0gci5FbGltaW5hcixcbiAgICAgIH07XG4gICAgICByb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgICAgY2VsbC5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgICAgICAgY2VsbC5ib3JkZXIgPSB7XG4gICAgICAgICAgdG9wOiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICAgIGxlZnQ6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGRUVFRUVFJyB9IH0sXG4gICAgICAgICAgcmlnaHQ6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGRUVFRUVFJyB9IH0sXG4gICAgICAgICAgYm90dG9tOiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkVFRUVFRScgfSB9LFxuICAgICAgICB9O1xuICAgICAgfSk7XG4gICAgICByb3cuZ2V0Q2VsbCg4KS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGRjVGNUY1JyB9IH07XG4gICAgICByb3cuZ2V0Q2VsbCg4KS5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkY4ODg4ODgnIH0sIHNpemU6IDEwIH07XG4gICAgICByb3cuZ2V0Q2VsbCg5KS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGRjVGNUY1JyB9IH07XG4gICAgICByb3cuZ2V0Q2VsbCg5KS5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkY4ODg4ODgnIH0sIHNpemU6IDEwIH07XG4gICAgICByb3cuZ2V0Q2VsbCgxKS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDIpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoMykucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg0KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDUpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogZmFsc2UgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDYpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoNykucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiBmYWxzZSB9O1xuICAgICAgcm93LmdldENlbGwoOCkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg5KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICB9XG5cbiAgICB3cy52aWV3cyA9IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dO1xuXG4gICAgYXdhaXQgd3MucHJvdGVjdCgnJywge1xuICAgICAgc2VsZWN0TG9ja2VkQ2VsbHM6IHRydWUsXG4gICAgICBzZWxlY3RVbmxvY2tlZENlbGxzOiB0cnVlLFxuICAgICAgZm9ybWF0Q2VsbHM6IGZhbHNlLFxuICAgICAgc29ydDogZmFsc2UsXG4gICAgICBhdXRvRmlsdGVyOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZmlsZW5hbWUgPSBwdXJlTW9kLmJ1aWxkUmVwYXJ0b0V4Y2VsRmlsZU5hbWVcbiAgICAgID8gcHVyZU1vZC5idWlsZFJlcGFydG9FeGNlbEZpbGVOYW1lKG5ldyBEYXRlKCkpXG4gICAgICA6ICdSZXBhcnRvXycgK1xuICAgICAgICBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApICtcbiAgICAgICAgJ18nICtcbiAgICAgICAgbmV3IERhdGUoKS50b1RpbWVTdHJpbmcoKS5zbGljZSgwLCA1KS5yZXBsYWNlKCc6JywgJycpICtcbiAgICAgICAgJy54bHN4JztcblxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1Zl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgYS5yZW1vdmUoKTtcbiAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG5cbiAgICBfc3luY1RhZyhcbiAgICAgICdFeGNlbCBlZGl0YWJsZSBsaXN0byAoJyArIHJlc3VsdC5yb3dzLmxlbmd0aCArICcgZmlsYXMgXHUwMEI3ICcgKyByZXN1bHQudG90YWxCYWNrb3JkZXIgKyAndSBCTyknLFxuICAgICAgMzIwMFxuICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSAoZSAmJiAvKiogQHR5cGUge2FueX0gKi8gKGUpLm1lc3NhZ2UpIHx8IFN0cmluZyhlKTtcbiAgICBjb25zb2xlLmVycm9yKCdbdjE1MDUgXHUwMEE3UmVwYXJ0b10gZXhwb3J0UmVwYXJ0b01hbnVhbEV4Y2VsIGZhbGxcdTAwRjM6JywgZSk7XG4gICAgYWxlcnQoJ05vIHB1ZGltb3MgZ2VuZXJhciBlbCBFeGNlbCBlZGl0YWJsZS4gVm9sdlx1MDBFOSBhIGludGVudGFyOyBzaSBzaWd1ZSwgYXZpc2FsZSBhIE1hcmlhbm8uJyk7XG4gICAgX2xvZ0V4cG9ydEVycm9yKCdleHBvcnRfbWFudWFsJywgbXNnKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQQVJURSAyIFx1MjAxNCBJbXBvcnQgRXhjZWxcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5sZXQgX2ltcG9ydFN0YXRlID0gLyoqIEB0eXBlIHtudWxsIHwge1xuICBmaWxlTmFtZTogc3RyaW5nLFxuICByZWNvbm9jaWRhczogQXJyYXk8YW55PixcbiAgY29uQ2FtYmlvczogQXJyYXk8YW55PixcbiAgZXJyb3JlczogQXJyYXk8YW55PixcbiAgdG90YWxGaWxhczogbnVtYmVyLFxuICB0b3RhbEFzaWduYWRvOiBudW1iZXIsXG4gIHRvdGFsRWxpbWluYXI6IG51bWJlcixcbn19ICovIChudWxsKTtcblxuLyoqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuZnVuY3Rpb24gX2lzQWRtaW5MaWtlRm9ySW1wb3J0KCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBjb25zdCByb2xlID0gKHcudXNlclJvbGUgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGlmIChyb2xlID09PSAnYWRtaW4nIHx8IHJvbGUgPT09ICdnZXJlbnRlJykgcmV0dXJuIHRydWU7XG4gIGNvbnN0IGVtYWlsID0gU3RyaW5nKCh3LmN1cnJlbnRVc2VyICYmIHcuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoZW1haWwgPT09ICdwYWJsby5nb256YWxlekBzaGltYW5vLmNvbS5hcicgfHwgZW1haWwgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbScpIHJldHVybiB0cnVlO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbndpbmRvdy5vcGVuUmVwYXJ0b0ltcG9ydERpYWxvZyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfaXNBZG1pbkxpa2VGb3JJbXBvcnQoKSkge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBpbXBvcnRhciByZXBhcnRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBjb25zdCBpbmdyZXNvcyA9IEFycmF5LmlzQXJyYXkody5fcmVwYXJ0b0luZ3Jlc29zKSA/IHcuX3JlcGFydG9JbmdyZXNvcyA6IFtdO1xuICBpZiAoIWluZ3Jlc29zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgaW5ncmVzb3MgZGUgcmVwYXJ0byBhY3Rpdm9zLiBBYnJcdTAwRUQgZWwgbW9kYWwgUmVwYXJ0byBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkge1xuICAgIG1vZGFsID0gX2J1aWxkSW1wb3J0TW9kYWxEb20oKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG1vZGFsKTtcbiAgfVxuICBfaW1wb3J0U3RhdGUgPSBudWxsO1xuICBjb25zdCBwcmV2aWV3RWwgPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1pbXBvcnQtcHJldmlldycpO1xuICBpZiAocHJldmlld0VsKSB7XG4gICAgd2hpbGUgKHByZXZpZXdFbC5maXJzdENoaWxkKSBwcmV2aWV3RWwucmVtb3ZlQ2hpbGQocHJldmlld0VsLmZpcnN0Q2hpbGQpO1xuICB9XG4gIGNvbnN0IGFwcGx5QnRuID0gbW9kYWwucXVlcnlTZWxlY3RvcignI3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bicpO1xuICBpZiAoYXBwbHlCdG4pIHtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5kaXNhYmxlZCA9IHRydWU7XG4gICAgLyoqIEB0eXBlIHthbnl9ICovIChhcHBseUJ0bikuc3R5bGUub3BhY2l0eSA9ICcwLjQnO1xuICB9XG4gIGNvbnN0IGZpbGVJbnB1dCA9IG1vZGFsLnF1ZXJ5U2VsZWN0b3IoJyNyZXBhcnRvLWltcG9ydC1maWxlJyk7XG4gIGlmIChmaWxlSW5wdXQpIC8qKiBAdHlwZSB7YW55fSAqLyAoZmlsZUlucHV0KS52YWx1ZSA9ICcnO1xuICAvKiogQHR5cGUge2FueX0gKi8gKG1vZGFsKS5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnO1xufTtcblxud2luZG93LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtbW9kYWwnKTtcbiAgaWYgKG1vZGFsKSAvKiogQHR5cGUge2FueX0gKi8gKG1vZGFsKS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBfaW1wb3J0U3RhdGUgPSBudWxsO1xufTtcblxuLyoqXG4gKiBAcGFyYW0ge0V2ZW50fSBldlxuICovXG53aW5kb3cuaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UgPSBhc3luYyBmdW5jdGlvbiAoZXYpIHtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgY29uc3QgdGd0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAoZXYudGFyZ2V0KTtcbiAgY29uc3QgZmlsZSA9IHRndCAmJiB0Z3QuZmlsZXMgJiYgdGd0LmZpbGVzWzBdO1xuICBpZiAoIWZpbGUpIHJldHVybjtcbiAgY29uc3QgcHJldmlld0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LXByZXZpZXcnKTtcbiAgY29uc3QgYXBwbHlCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmIChwcmV2aWV3RWwpIHtcbiAgICB3aGlsZSAocHJldmlld0VsLmZpcnN0Q2hpbGQpIHByZXZpZXdFbC5yZW1vdmVDaGlsZChwcmV2aWV3RWwuZmlyc3RDaGlsZCk7XG4gICAgcHJldmlld0VsLnRleHRDb250ZW50ID0gJ0xleWVuZG8gRXhjZWxcdTIwMjYnO1xuICB9XG4gIGlmIChhcHBseUJ0bikge1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5zdHlsZS5vcGFjaXR5ID0gJzAuNCc7XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCBfZW5zdXJlRXhjZWxKUygpO1xuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcbiAgICBjb25zdCB3YiA9IG5ldyB3LkV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBhd2FpdCB3Yi54bHN4LmxvYWQoYnVmKTtcbiAgICBjb25zdCB3cyA9IHdiLndvcmtzaGVldHNbMF07XG4gICAgaWYgKCF3cykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBzaW4gaG9qYXMnKTtcblxuICAgIGNvbnN0IGhlYWRlck1hcCA9IF9idWlsZEhlYWRlck1hcCh3cyk7XG4gICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICB3cy5lYWNoUm93KChyb3csIHJuKSA9PiB7XG4gICAgICBpZiAocm4gPT09IDEpIHJldHVybjtcbiAgICAgIC8qKiBAdHlwZSB7YW55fSAqL1xuICAgICAgY29uc3Qgb2JqID0geyBfX3Jvd0luZGV4OiBybiB9O1xuICAgICAgcm93LmVhY2hDZWxsKHsgaW5jbHVkZUVtcHR5OiB0cnVlIH0sIChjZWxsLCBjb2xJZHgpID0+IHtcbiAgICAgICAgY29uc3QgY2Fub25LZXkgPSBoZWFkZXJNYXBbY29sSWR4XTtcbiAgICAgICAgaWYgKCFjYW5vbktleSkgcmV0dXJuO1xuICAgICAgICBsZXQgdiA9IGNlbGwudmFsdWU7XG4gICAgICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAndGV4dCcgaW4gdikgdiA9IHYudGV4dDtcbiAgICAgICAgaWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICdyZXN1bHQnIGluIHYpIHYgPSB2LnJlc3VsdDtcbiAgICAgICAgb2JqW2Nhbm9uS2V5XSA9IHY7XG4gICAgICB9KTtcbiAgICAgIGlmICghb2JqLlJlcGFydG9JZCAmJiAhb2JqLkNhcmRDb2RlICYmICFvYmouQ29kaWdvKSByZXR1cm47XG4gICAgICByb3dzLnB1c2gob2JqKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gICAgY29uc3QgcmVwYXJ0b3NBY3Rpdm9zID0gaW5ncmVzb3MubWFwKCgvKiogQHR5cGUge2FueX0gKi8gaSkgPT4gKHtcbiAgICAgIF9pZDogaS5faWQsXG4gICAgICBza3U6IGkuc2t1LFxuICAgICAgc3RhdHVzOiBpLnN0YXR1cyB8fCAncGVuZGluZycsXG4gICAgICBzdG9ja0Rpc3BvbmlibGU6IF9nZXRTdG9ja0Zpc2ljbyhpLnNrdSksXG4gICAgICBjbGllbnRlc0JPOiBBcnJheS5pc0FycmF5KGkuY2xpZW50ZXNCTykgPyBpLmNsaWVudGVzQk8gOiBbXSxcbiAgICB9KSk7XG5cbiAgICBjb25zdCB2YWxpZGF0b3IgPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0V4Y2VsSW1wb3J0O1xuICAgIGlmICghdmFsaWRhdG9yIHx8IHR5cGVvZiB2YWxpZGF0b3IudmFsaWRhdGVSZXBhcnRvRXhjZWxJbXBvcnQgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigncHVyZSBmbiByZXBhcnRvRXhjZWxJbXBvcnQgbm8gZGlzcG9uaWJsZScpO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSB2YWxpZGF0b3IudmFsaWRhdGVSZXBhcnRvRXhjZWxJbXBvcnQocm93cywgcmVwYXJ0b3NBY3Rpdm9zKTtcbiAgICBfaW1wb3J0U3RhdGUgPSB7XG4gICAgICBmaWxlTmFtZTogZmlsZS5uYW1lLFxuICAgICAgcmVjb25vY2lkYXM6IHJlc3VsdC5yZWNvbm9jaWRhcyxcbiAgICAgIGNvbkNhbWJpb3M6IHJlc3VsdC5jb25DYW1iaW9zLFxuICAgICAgZXJyb3JlczogcmVzdWx0LmVycm9yZXMsXG4gICAgICB0b3RhbEZpbGFzOiByZXN1bHQudG90YWxGaWxhcyxcbiAgICAgIHRvdGFsQXNpZ25hZG86IHJlc3VsdC50b3RhbEFzaWduYWRvLFxuICAgICAgdG90YWxFbGltaW5hcjogcmVzdWx0LnRvdGFsRWxpbWluYXIsXG4gICAgfTtcbiAgICBfcmVuZGVySW1wb3J0UHJldmlldygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gKGUgJiYgLyoqIEB0eXBlIHthbnl9ICovIChlKS5tZXNzYWdlKSB8fCBTdHJpbmcoZSk7XG4gICAgY29uc29sZS5lcnJvcignW3YxNTA1IFx1MDBBN1JlcGFydG9dIGhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlIGVycm9yOicsIGUpO1xuICAgIGlmIChwcmV2aWV3RWwpIHtcbiAgICAgIHdoaWxlIChwcmV2aWV3RWwuZmlyc3RDaGlsZCkgcHJldmlld0VsLnJlbW92ZUNoaWxkKHByZXZpZXdFbC5maXJzdENoaWxkKTtcbiAgICAgIGNvbnN0IGVyckRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgZXJyRGl2LnN0eWxlLmNzc1RleHQgPVxuICAgICAgICAnY29sb3I6I2M3MzcyZjtwYWRkaW5nOjEycHg7YmFja2dyb3VuZDpyZ2JhKDI1NSw1OSw0OCwuMDgpO2JvcmRlci1yYWRpdXM6OHB4JztcbiAgICAgIGVyckRpdi50ZXh0Q29udGVudCA9ICdFcnJvciBsZXllbmRvIEV4Y2VsOiAnICsgbXNnO1xuICAgICAgcHJldmlld0VsLmFwcGVuZENoaWxkKGVyckRpdik7XG4gICAgfVxuICAgIF9sb2dFeHBvcnRFcnJvcignaW1wb3J0X3JlYWQnLCBtc2cpO1xuICB9XG59O1xuXG4vKipcbiAqIEBwYXJhbSB7YW55fSB3c1xuICogQHJldHVybnMge09iamVjdDxudW1iZXIsc3RyaW5nPn1cbiAqL1xuZnVuY3Rpb24gX2J1aWxkSGVhZGVyTWFwKHdzKSB7XG4gIC8qKiBAdHlwZSB7T2JqZWN0PG51bWJlcixzdHJpbmc+fSAqL1xuICBjb25zdCBvdXQgPSB7fTtcbiAgY29uc3QgaGVhZGVyUm93ID0gd3MuZ2V0Um93KDEpO1xuICBoZWFkZXJSb3cuZWFjaENlbGwoXG4gICAgeyBpbmNsdWRlRW1wdHk6IGZhbHNlIH0sXG4gICAgKC8qKiBAdHlwZSB7YW55fSAqLyBjZWxsLCAvKiogQHR5cGUge251bWJlcn0gKi8gY29sKSA9PiB7XG4gICAgICBsZXQgdiA9IGNlbGwudmFsdWU7XG4gICAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgJ3RleHQnIGluIHYpIHYgPSB2LnRleHQ7XG4gICAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgJ3Jlc3VsdCcgaW4gdikgdiA9IHYucmVzdWx0O1xuICAgICAgY29uc3QgbGFiZWwgPSBTdHJpbmcodiB8fCAnJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICghbGFiZWwpIHJldHVybjtcbiAgICAgIGlmIChsYWJlbCA9PT0gJ2NvZGlnbycgfHwgbGFiZWwgPT09ICdjXHUwMEYzZGlnbycpIG91dFtjb2xdID0gJ0NvZGlnbyc7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ2NsaWVudGUnKSBvdXRbY29sXSA9ICdDbGllbnRlJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnYmFja29yZGVyJykgb3V0W2NvbF0gPSAnQmFja29yZGVyJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnc3RvY2sgZGlzcG9uaWJsZScgfHwgbGFiZWwgPT09ICdzdG9ja19kaXNwb25pYmxlJylcbiAgICAgICAgb3V0W2NvbF0gPSAnU3RvY2tEaXNwb25pYmxlJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnYXNpZ25hZG8nKSBvdXRbY29sXSA9ICdBc2lnbmFkbyc7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ3Z1ZWx2ZSBhIGJhY2tvcmRlcicpIG91dFtjb2xdID0gJ1Z1ZWxlQUJhY2tvcmRlcic7XG4gICAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ2VsaW1pbmFyJykgb3V0W2NvbF0gPSAnRWxpbWluYXInO1xuICAgICAgZWxzZSBpZiAobGFiZWwgPT09ICdyZXBhcnRvIGlkJyB8fCBsYWJlbCA9PT0gJ3JlcGFydG9pZCcgfHwgbGFiZWwgPT09ICdyZXBhcnRvX2lkJylcbiAgICAgICAgb3V0W2NvbF0gPSAnUmVwYXJ0b0lkJztcbiAgICAgIGVsc2UgaWYgKGxhYmVsID09PSAnY2FyZGNvZGUnIHx8IGxhYmVsID09PSAnY2FyZCBjb2RlJyB8fCBsYWJlbCA9PT0gJ2NhcmRfY29kZScpXG4gICAgICAgIG91dFtjb2xdID0gJ0NhcmRDb2RlJztcbiAgICB9XG4gICk7XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ3JlYSB1biBkaXYgY29uIGNsYXNzL3N0eWxlL3RleHQgc2VndXJvcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdHlsZUNzc1xuICogQHBhcmFtIHtzdHJpbmd9IHRleHRWYWx1ZVxuICogQHJldHVybnMge0hUTUxEaXZFbGVtZW50fVxuICovXG5mdW5jdGlvbiBfbWtEaXYoc3R5bGVDc3MsIHRleHRWYWx1ZSkge1xuICBjb25zdCBkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGQuc3R5bGUuY3NzVGV4dCA9IHN0eWxlQ3NzO1xuICBpZiAodGV4dFZhbHVlICE9IG51bGwpIGQudGV4dENvbnRlbnQgPSB0ZXh0VmFsdWU7XG4gIHJldHVybiBkO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVySW1wb3J0UHJldmlldygpIHtcbiAgY29uc3QgcHJldmlld0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LXByZXZpZXcnKTtcbiAgY29uc3QgYXBwbHlCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmICghcHJldmlld0VsIHx8ICFfaW1wb3J0U3RhdGUpIHJldHVybjtcbiAgY29uc3QgcyA9IF9pbXBvcnRTdGF0ZTtcbiAgd2hpbGUgKHByZXZpZXdFbC5maXJzdENoaWxkKSBwcmV2aWV3RWwucmVtb3ZlQ2hpbGQocHJldmlld0VsLmZpcnN0Q2hpbGQpO1xuXG4gIC8vIENoaXBzIGRlIHJlc3VtZW4uXG4gIGNvbnN0IGNoaXBzUm93ID0gX21rRGl2KCdkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7ZmxleC13cmFwOndyYXA7bWFyZ2luLWJvdHRvbToxNHB4JywgbnVsbCk7XG4gIGNvbnN0IGNoaXBSZWMgPSBfbWtEaXYoXG4gICAgJ2ZsZXg6MTttaW4td2lkdGg6MTQwcHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDpyZ2JhKDUyLDE5OSw4OSwuMTQpO2JvcmRlci1yYWRpdXM6OHB4O2NvbG9yOiMyNDhhM2QnLFxuICAgIG51bGxcbiAgKTtcbiAgY2hpcFJlYy5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOi41cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlJywgJ1JlY29ub2NpZGFzJylcbiAgKTtcbiAgY2hpcFJlYy5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tdG9wOjJweCcsIFN0cmluZyhzLnJlY29ub2NpZGFzLmxlbmd0aCkpXG4gICk7XG4gIGNoaXBzUm93LmFwcGVuZENoaWxkKGNoaXBSZWMpO1xuICBjb25zdCBjaGlwQ2FtYiA9IF9ta0RpdihcbiAgICAnZmxleDoxO21pbi13aWR0aDoxNDBweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOnJnYmEoMCwxMjIsMjU1LC4xNCk7Ym9yZGVyLXJhZGl1czo4cHg7Y29sb3I6IzAwNDBkZCcsXG4gICAgbnVsbFxuICApO1xuICBjaGlwQ2FtYi5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOi41cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlJywgJ0NvbiBjYW1iaW9zJylcbiAgKTtcbiAgY2hpcENhbWIuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MjJweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLXRvcDoycHgnLCBTdHJpbmcocy5jb25DYW1iaW9zLmxlbmd0aCkpXG4gICk7XG4gIGNoaXBzUm93LmFwcGVuZENoaWxkKGNoaXBDYW1iKTtcbiAgY29uc3QgY2hpcEVyciA9IF9ta0RpdihcbiAgICAnZmxleDoxO21pbi13aWR0aDoxNDBweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgKHMuZXJyb3Jlcy5sZW5ndGggPyAncmdiYSgyNTUsNTksNDgsLjE0KScgOiAncmdiYSgxMjAsMTIwLDEyOCwuMDgpJykgK1xuICAgICAgJztib3JkZXItcmFkaXVzOjhweDtjb2xvcjonICtcbiAgICAgIChzLmVycm9yZXMubGVuZ3RoID8gJyNjNzM3MmYnIDogJyM2ZTZlNzMnKSxcbiAgICBudWxsXG4gICk7XG4gIGNoaXBFcnIuYXBwZW5kQ2hpbGQoXG4gICAgX21rRGl2KCdmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzouNXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZScsICdFcnJvcmVzJylcbiAgKTtcbiAgY2hpcEVyci5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tdG9wOjJweCcsIFN0cmluZyhzLmVycm9yZXMubGVuZ3RoKSlcbiAgKTtcbiAgY2hpcHNSb3cuYXBwZW5kQ2hpbGQoY2hpcEVycik7XG4gIHByZXZpZXdFbC5hcHBlbmRDaGlsZChjaGlwc1Jvdyk7XG5cbiAgaWYgKHMuZXJyb3Jlcy5sZW5ndGgpIHtcbiAgICBjb25zdCBlcnJCb3ggPSBfbWtEaXYoXG4gICAgICAncGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDpyZ2JhKDI1NSw1OSw0OCwuMDgpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjYzczNzJmO2JvcmRlci1yYWRpdXM6NnB4O21hcmdpbi1ib3R0b206MTJweCcsXG4gICAgICBudWxsXG4gICAgKTtcbiAgICBlcnJCb3guYXBwZW5kQ2hpbGQoXG4gICAgICBfbWtEaXYoXG4gICAgICAgICdmb250LXdlaWdodDo3MDA7Y29sb3I6I2M3MzcyZjttYXJnaW4tYm90dG9tOjZweCcsXG4gICAgICAgICdIYXkgJyArXG4gICAgICAgICAgcy5lcnJvcmVzLmxlbmd0aCArXG4gICAgICAgICAgJyBlcnJvcihlcykuIENvcnJlZ2lsb3MgeSB2b2x2XHUwMEU5IGEgc3ViaXIgZWwgRXhjZWwuIE5vIHNlIGFwbGljYSBuYWRhLidcbiAgICAgIClcbiAgICApO1xuICAgIGNvbnN0IHVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndWwnKTtcbiAgICB1bC5zdHlsZS5jc3NUZXh0ID0gJ21hcmdpbjowO3BhZGRpbmctbGVmdDoxOHB4O2NvbG9yOiMxZDFkMWY7Zm9udC1zaXplOjEyLjVweDtsaW5lLWhlaWdodDoxLjUnO1xuICAgIGNvbnN0IHNsaWNlID0gcy5lcnJvcmVzLnNsaWNlKDAsIDUwKTtcbiAgICBmb3IgKGNvbnN0IGUgb2Ygc2xpY2UpIHtcbiAgICAgIGNvbnN0IGxpID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGknKTtcbiAgICAgIGxpLnRleHRDb250ZW50ID0gZS5tc2c7XG4gICAgICB1bC5hcHBlbmRDaGlsZChsaSk7XG4gICAgfVxuICAgIGVyckJveC5hcHBlbmRDaGlsZCh1bCk7XG4gICAgaWYgKHMuZXJyb3Jlcy5sZW5ndGggPiA1MCkge1xuICAgICAgZXJyQm94LmFwcGVuZENoaWxkKFxuICAgICAgICBfbWtEaXYoXG4gICAgICAgICAgJ2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjExcHg7bWFyZ2luLXRvcDo0cHgnLFxuICAgICAgICAgICcuLi55ICcgKyAocy5lcnJvcmVzLmxlbmd0aCAtIDUwKSArICcgbVx1MDBFMXMgKHZlciBjb25zb2xhKSdcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG4gICAgcHJldmlld0VsLmFwcGVuZENoaWxkKGVyckJveCk7XG4gIH1cblxuICBpZiAoIXMuZXJyb3Jlcy5sZW5ndGggJiYgcy5jb25DYW1iaW9zLmxlbmd0aCkge1xuICAgIHByZXZpZXdFbC5hcHBlbmRDaGlsZChcbiAgICAgIF9ta0RpdihcbiAgICAgICAgJ3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6cmdiYSg1MiwxOTksODksLjA4KTtib3JkZXItcmFkaXVzOjZweDttYXJnaW4tYm90dG9tOjEycHg7Zm9udC1zaXplOjEzcHgnLFxuICAgICAgICAnUmVzdW1lbiBhIGFwbGljYXI6ICcgK1xuICAgICAgICAgIHMuY29uQ2FtYmlvcy5sZW5ndGggK1xuICAgICAgICAgICcgY2FtYmlvKHMpIFx1MDBCNyAnICtcbiAgICAgICAgICBzLnRvdGFsQXNpZ25hZG8gK1xuICAgICAgICAgICcgdSBhc2lnbmFkYXMgXHUwMEI3ICcgK1xuICAgICAgICAgIHMudG90YWxFbGltaW5hciArXG4gICAgICAgICAgJyB1IGVsaW1pbmFkYXMnXG4gICAgICApXG4gICAgKTtcbiAgICAvLyBUYWJsYSBwcmV2aWV3LlxuICAgIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGFibGUnKTtcbiAgICB0YWJsZS5zdHlsZS5jc3NUZXh0ID0gJ3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4JztcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoZWFkJyk7XG4gICAgY29uc3QgdHJoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgICB0cmguc3R5bGUuY3NzVGV4dCA9ICdiYWNrZ3JvdW5kOiNmNWY1ZjcnO1xuICAgIGZvciAoY29uc3QgaCBvZiBbJ1NLVScsICdDbGllbnRlJywgJ0JPJywgJ0FzaWcuJywgJ0VsaW0uJ10pIHtcbiAgICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcbiAgICAgIHRoLnN0eWxlLmNzc1RleHQgPVxuICAgICAgICAncGFkZGluZzo2cHg7dGV4dC1hbGlnbjonICsgKGggPT09ICdTS1UnIHx8IGggPT09ICdDbGllbnRlJyA/ICdsZWZ0JyA6ICdyaWdodCcpO1xuICAgICAgdGgudGV4dENvbnRlbnQgPSBoO1xuICAgICAgdHJoLmFwcGVuZENoaWxkKHRoKTtcbiAgICB9XG4gICAgdGhlYWQuYXBwZW5kQ2hpbGQodHJoKTtcbiAgICB0YWJsZS5hcHBlbmRDaGlsZCh0aGVhZCk7XG4gICAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0Ym9keScpO1xuICAgIGNvbnN0IHByZXZpZXdSb3dzID0gcy5jb25DYW1iaW9zLnNsaWNlKDAsIDMwKTtcbiAgICBmb3IgKGNvbnN0IHIgb2YgcHJldmlld1Jvd3MpIHtcbiAgICAgIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgICAgIHRyLnN0eWxlLmNzc1RleHQgPSAnYm9yZGVyLWJvdHRvbToxcHggc29saWQgI2VlZSc7XG4gICAgICBjb25zdCBhZGRUZCA9ICgvKiogQHR5cGUge3N0cmluZ30gKi8gdHh0LCAvKiogQHR5cGUge3N0cmluZ30gKi8gY3NzKSA9PiB7XG4gICAgICAgIGNvbnN0IHRkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgICAgICAgdGQuc3R5bGUuY3NzVGV4dCA9IGNzcztcbiAgICAgICAgdGQudGV4dENvbnRlbnQgPSB0eHQ7XG4gICAgICAgIHRyLmFwcGVuZENoaWxkKHRkKTtcbiAgICAgIH07XG4gICAgICBhZGRUZChyLnNrdSwgJ3BhZGRpbmc6NHB4IDZweDtmb250LWZhbWlseTptb25vc3BhY2UnKTtcbiAgICAgIGFkZFRkKHIuY2xpZW50TmFtZSwgJ3BhZGRpbmc6NHB4IDZweCcpO1xuICAgICAgYWRkVGQoU3RyaW5nKHIuYmFja29yZGVyQWN0dWFsKSwgJ3BhZGRpbmc6NHB4IDZweDt0ZXh0LWFsaWduOnJpZ2h0Jyk7XG4gICAgICBhZGRUZChcbiAgICAgICAgci5hc2lnbmFkb051ZXZvID8gU3RyaW5nKHIuYXNpZ25hZG9OdWV2bykgOiAnJyxcbiAgICAgICAgJ3BhZGRpbmc6NHB4IDZweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOiMyNDhhM2Q7Zm9udC13ZWlnaHQ6NjAwJ1xuICAgICAgKTtcbiAgICAgIGFkZFRkKFxuICAgICAgICByLmVsaW1pbmFyTnVldm8gPyBTdHJpbmcoci5lbGltaW5hck51ZXZvKSA6ICcnLFxuICAgICAgICAncGFkZGluZzo0cHggNnB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6I2M3MzcyZjtmb250LXdlaWdodDo2MDAnXG4gICAgICApO1xuICAgICAgdGJvZHkuYXBwZW5kQ2hpbGQodHIpO1xuICAgIH1cbiAgICB0YWJsZS5hcHBlbmRDaGlsZCh0Ym9keSk7XG4gICAgcHJldmlld0VsLmFwcGVuZENoaWxkKHRhYmxlKTtcbiAgICBpZiAocy5jb25DYW1iaW9zLmxlbmd0aCA+IDMwKSB7XG4gICAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoXG4gICAgICAgIF9ta0RpdihcbiAgICAgICAgICAnY29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTFweDttYXJnaW4tdG9wOjRweCcsXG4gICAgICAgICAgJy4uLnkgJyArIChzLmNvbkNhbWJpb3MubGVuZ3RoIC0gMzApICsgJyBtXHUwMEUxcydcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXMuZXJyb3Jlcy5sZW5ndGggJiYgIXMuY29uQ2FtYmlvcy5sZW5ndGgpIHtcbiAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoXG4gICAgICBfbWtEaXYoXG4gICAgICAgICdwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnJnYmEoMjU1LDIwNCwwLC4xNCk7Ym9yZGVyLXJhZGl1czo2cHg7Y29sb3I6IzhhNmQwMCcsXG4gICAgICAgICdFbCBFeGNlbCBubyB0aWVuZSBjYW1iaW9zIChBc2lnbmFkbz0wIHkgRWxpbWluYXI9MCBlbiB0b2RhcyBsYXMgZmlsYXMpLiBOYWRhIHF1ZSBhcGxpY2FyLidcbiAgICAgIClcbiAgICApO1xuICB9XG5cbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgY29uc3QgY2FuQXBwbHkgPSBzLmVycm9yZXMubGVuZ3RoID09PSAwICYmIHMuY29uQ2FtYmlvcy5sZW5ndGggPiAwO1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gIWNhbkFwcGx5O1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLm9wYWNpdHkgPSBjYW5BcHBseSA/ICcxJyA6ICcwLjQnO1xuICB9XG59XG5cbndpbmRvdy5jb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAoIV9pbXBvcnRTdGF0ZSB8fCBfaW1wb3J0U3RhdGUuY29uQ2FtYmlvcy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgaWYgKF9pbXBvcnRTdGF0ZS5lcnJvcmVzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBzZSBwdWVkZSBhcGxpY2FyOiBoYXkgZXJyb3JlcyBlbiBsYSB2aXN0YSBwcmV2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghX2lzQWRtaW5MaWtlRm9ySW1wb3J0KCkpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgYXBsaWNhciByZXBhcnRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhcHBseUJ0biA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bicpKTtcbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgYXBwbHlCdG4uZGlzYWJsZWQgPSB0cnVlO1xuICAgIGFwcGx5QnRuLnRleHRDb250ZW50ID0gJ0FwbGljYW5kb1x1MjAyNic7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0V4Y2VsSW1wb3J0O1xuICAgIGNvbnN0IGdyb3VwcyA9IHZhbGlkYXRvci5ncm91cEltcG9ydE1hdGNoZXNCeVJlcGFydG8oX2ltcG9ydFN0YXRlLmNvbkNhbWJpb3MpO1xuICAgIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG5cbiAgICBjb25zdCBjYWxsYWJsZSA9IHcuZmlyZWJhc2VcbiAgICAgIC5hcHAoKVxuICAgICAgLmZ1bmN0aW9ucygnc291dGhhbWVyaWNhLWVhc3QxJylcbiAgICAgIC5odHRwc0NhbGxhYmxlKCdhcHBseVJlcGFydG9NYW51YWxDRicpO1xuICAgIGxldCBva0NvdW50ID0gMDtcbiAgICBsZXQgZmFpbENvdW50ID0gMDtcbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdO1xuICAgIGxldCB0b3RhbEFzaWduYWNpb25lc0FwbGljYWRhcyA9IDA7XG4gICAgbGV0IHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGcgb2YgZ3JvdXBzKSB7XG4gICAgICBjb25zdCBpbmcgPSBpbmdyZXNvcy5maW5kKCgvKiogQHR5cGUge2FueX0gKi8gaSkgPT4gaS5faWQgPT09IGcucmVwYXJ0b0lkKTtcbiAgICAgIGlmICghaW5nKSB7XG4gICAgICAgIGZhaWxDb3VudCsrO1xuICAgICAgICBmYWlsdXJlcy5wdXNoKCdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgeWEgbm8gZXhpc3RlJyk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgY2xpZW50ZXMgPSBBcnJheS5pc0FycmF5KGluZy5jbGllbnRlc0JPKSA/IGluZy5jbGllbnRlc0JPIDogW107XG4gICAgICAvKiogQHR5cGUge0FycmF5PGFueT59ICovXG4gICAgICBjb25zdCBhc3NpZ25tZW50cyA9IFtdO1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgICAgY29uc3QgZWxpbWluYXRpb25zID0gW107XG4gICAgICBmb3IgKGNvbnN0IGEgb2YgZy5hc3NpZ25tZW50cykge1xuICAgICAgICBjb25zdCBjID0gY2xpZW50ZXMuZmluZChcbiAgICAgICAgICAoLyoqIEB0eXBlIHthbnl9ICovIHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeC5jbGllbnRDYXJkQ29kZSB8fCB4LmNhcmRDb2RlIHx8ICcnKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKVxuICAgICAgICAgICAgICAudHJpbSgpID09PSBTdHJpbmcoYS5jYXJkQ29kZSkudG9VcHBlckNhc2UoKS50cmltKClcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFjKSB7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICAgICdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgLyBDYXJkQ29kZSAnICsgYS5jYXJkQ29kZSArICcgeWEgbm8gZXN0XHUwMEUxIGVuIEJPJ1xuICAgICAgICAgICk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYXNzaWdubWVudHMucHVzaCh7XG4gICAgICAgICAgcGVkaWRvSWQ6IGMucGVkaWRvSWQsXG4gICAgICAgICAgbGluZUluZGV4OiBOdW1iZXIoYy5saW5lSW5kZXgpIHx8IDAsXG4gICAgICAgICAgcXR5QXNpZ25hZGE6IGEucXR5QXNpZ25hZGEsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBlIG9mIGcuZWxpbWluYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjbGllbnRlcy5maW5kKFxuICAgICAgICAgICgvKiogQHR5cGUge2FueX0gKi8geCkgPT5cbiAgICAgICAgICAgIFN0cmluZyh4LmNsaWVudENhcmRDb2RlIHx8IHguY2FyZENvZGUgfHwgJycpXG4gICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpXG4gICAgICAgICAgICAgIC50cmltKCkgPT09IFN0cmluZyhlLmNhcmRDb2RlKS50b1VwcGVyQ2FzZSgpLnRyaW0oKVxuICAgICAgICApO1xuICAgICAgICBpZiAoIWMpIHtcbiAgICAgICAgICBmYWlsdXJlcy5wdXNoKFxuICAgICAgICAgICAgJ1JlcGFydG8gJyArIGcucmVwYXJ0b0lkICsgJyAvIENhcmRDb2RlICcgKyBlLmNhcmRDb2RlICsgJyB5YSBubyBlc3RcdTAwRTEgZW4gQk8nXG4gICAgICAgICAgKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBlbGltaW5hdGlvbnMucHVzaCh7XG4gICAgICAgICAgcGVkaWRvSWQ6IGMucGVkaWRvSWQsXG4gICAgICAgICAgbGluZUluZGV4OiBOdW1iZXIoYy5saW5lSW5kZXgpIHx8IDAsXG4gICAgICAgICAgcXR5RWxpbWluYXI6IGUucXR5RWxpbWluYXIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKCFhc3NpZ25tZW50cy5sZW5ndGggJiYgIWVsaW1pbmF0aW9ucy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgY2FsbGFibGUoe1xuICAgICAgICAgIGluZ3Jlc29JZDogZy5yZXBhcnRvSWQsXG4gICAgICAgICAgYXNzaWdubWVudHMsXG4gICAgICAgICAgZWxpbWluYXRpb25zLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgciA9IHJlcy5kYXRhIHx8IHt9O1xuICAgICAgICBpZiAoci5vaykge1xuICAgICAgICAgIG9rQ291bnQrKztcbiAgICAgICAgICB0b3RhbEFzaWduYWNpb25lc0FwbGljYWRhcyArPSBhc3NpZ25tZW50cy5sZW5ndGg7XG4gICAgICAgICAgdG90YWxFbGltaW5hY2lvbmVzQXBsaWNhZGFzICs9IGVsaW1pbmF0aW9ucy5sZW5ndGg7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZmFpbENvdW50Kys7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICAgIGcucmVwYXJ0b0lkICtcbiAgICAgICAgICAgICAgJyAoJyArXG4gICAgICAgICAgICAgIGcuc2t1ICtcbiAgICAgICAgICAgICAgJyk6ICcgK1xuICAgICAgICAgICAgICAoKHIuZXJyb3JzIHx8IFtdKS5qb2luKCc7ICcpIHx8ICdlcnJvciBkZXNjb25vY2lkbycpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoY2FsbEVycikge1xuICAgICAgICBmYWlsQ291bnQrKztcbiAgICAgICAgZmFpbHVyZXMucHVzaChcbiAgICAgICAgICBnLnJlcGFydG9JZCArXG4gICAgICAgICAgICAnICgnICtcbiAgICAgICAgICAgIGcuc2t1ICtcbiAgICAgICAgICAgICcpOiAnICtcbiAgICAgICAgICAgICgoY2FsbEVyciAmJiAvKiogQHR5cGUge2FueX0gKi8gKGNhbGxFcnIpLm1lc3NhZ2UpIHx8IFN0cmluZyhjYWxsRXJyKSlcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKHcuZmJEYiAmJiB0eXBlb2Ygdy5mYkRiLmNvbGxlY3Rpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgYXdhaXQgdy5mYkRiLmNvbGxlY3Rpb24oJ3JlcGFydG9fbG9nJykuYWRkKHtcbiAgICAgICAgICBvcmlnZW46ICdpbXBvcnQnLFxuICAgICAgICAgIGZpbGVOYW1lOiBfaW1wb3J0U3RhdGUuZmlsZU5hbWUsXG4gICAgICAgICAgaW1wb3J0ZWRCeVVpZDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci51aWQpIHx8IG51bGwsXG4gICAgICAgICAgaW1wb3J0ZWRCeUVtYWlsOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCBudWxsLFxuICAgICAgICAgIHJvd3NDb3VudDogX2ltcG9ydFN0YXRlLnRvdGFsRmlsYXMsXG4gICAgICAgICAgYXNzaWdubWVudHNDb3VudDogdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMsXG4gICAgICAgICAgZWxpbWluYXRpb25zQ291bnQ6IHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyxcbiAgICAgICAgICByZXBhcnRvc1Byb2Nlc2Fkb3M6IGdyb3Vwcy5sZW5ndGgsXG4gICAgICAgICAgb2tDb3VudCxcbiAgICAgICAgICBmYWlsQ291bnQsXG4gICAgICAgICAgaW1wb3J0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAobG9nRXJyKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1t2MTUwNV0gcmVwYXJ0b19sb2cgb3JpZ2VuPWltcG9ydCB3cml0ZSBmYWlsZWQnLCBsb2dFcnIpO1xuICAgIH1cblxuICAgIGNvbnN0IHN1bW1hcnkgPVxuICAgICAgdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMgK1xuICAgICAgJyBhc2lnbmFjaW9uZXMgYXBsaWNhZGFzIFx1MDBCNyAnICtcbiAgICAgIHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyArXG4gICAgICAnIGVsaW1pbmFjaW9uZXMgYXBsaWNhZGFzJyArXG4gICAgICAoZmFpbENvdW50XG4gICAgICAgID8gJ1xcblxcblJlcGFydG9zIGNvbiBlcnJvciAoJyArIGZhaWxDb3VudCArICcpOlxcbicgKyBmYWlsdXJlcy5zbGljZSgwLCA1KS5qb2luKCdcXG4nKVxuICAgICAgICA6ICcnKTtcbiAgICBhbGVydChzdW1tYXJ5KTtcbiAgICBpZiAob2tDb3VudCA+IDApIF9zeW5jVGFnKCdJbXBvcnQgUmVwYXJ0byBhcGxpY2FkbyBcdTAwQjcgJyArIG9rQ291bnQgKyAnIHJlcGFydG8ocyknLCAzMjAwKTtcbiAgICB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyAmJiB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gKGUgJiYgLyoqIEB0eXBlIHthbnl9ICovIChlKS5tZXNzYWdlKSB8fCBTdHJpbmcoZSk7XG4gICAgY29uc29sZS5lcnJvcignW3YxNTA1IFx1MDBBN1JlcGFydG9dIGNvbmZpcm1SZXBhcnRvSW1wb3J0QXBwbHkgZXJyb3I6JywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGFwbGljYW5kbyBpbXBvcnQ6ICcgKyBtc2cpO1xuICAgIF9sb2dFeHBvcnRFcnJvcignaW1wb3J0X2FwcGx5JywgbXNnKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYXBwbHlCdG4pIHtcbiAgICAgIGFwcGx5QnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBhcHBseUJ0bi50ZXh0Q29udGVudCA9ICdBcGxpY2FyIHJlcGFydG8gaW1wb3J0YWRvJztcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogQ29uc3RydXllIGVsIG1vZGFsIERPTSB2aWEgaGVscGVycyBzZWd1cm9zIChzaW4gaW5uZXJIVE1MIGNvbiBjb250ZW5pZG9cbiAqIGRpblx1MDBFMW1pY28gXHUyMDE0IGVsIERPTSBlcyBlc3RcdTAwRTF0aWNvKS4gUHJpbWVyYSBhcGVydHVyYSBjYWNoZWEuXG4gKiBAcmV0dXJucyB7SFRNTEVsZW1lbnR9XG4gKi9cbmZ1bmN0aW9uIF9idWlsZEltcG9ydE1vZGFsRG9tKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBtb2RhbC5pZCA9ICdyZXBhcnRvLWltcG9ydC1tb2RhbCc7XG4gIG1vZGFsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcbiAgbW9kYWwuc3R5bGUuY3NzVGV4dCA9ICdkaXNwbGF5Om5vbmU7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXInO1xuICBtb2RhbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChldikgPT4ge1xuICAgIGlmIChldi50YXJnZXQgPT09IG1vZGFsKSB7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyA9PT0gJ2Z1bmN0aW9uJykgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2coKTtcbiAgICB9XG4gIH0pO1xuICBjb25zdCBib3ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgYm94LmNsYXNzTmFtZSA9ICdtb2RhbC1ib3gnO1xuICBib3guc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3dpZHRoOm1pbig3NjBweCw5NnZ3KTttYXgtaGVpZ2h0Ojkwdmg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czoxNHB4O292ZXJmbG93OmhpZGRlbic7XG4gIC8vIEhlYWRlci5cbiAgY29uc3QgaGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBoZWFkLnN0eWxlLmNzc1RleHQgPVxuICAgICdwYWRkaW5nOjE4cHggMjJweDtib3JkZXItYm90dG9tOjAuNXB4IHNvbGlkIHJnYmEoMCwwLDAsLjA4KTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4JztcbiAgY29uc3QgaGVhZFRpdGxlV3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBoZWFkVGl0bGVXcmFwLnN0eWxlLmNzc1RleHQgPSAnZmxleDoxJztcbiAgY29uc3QgaDIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdoMicpO1xuICBoMi5zdHlsZS5jc3NUZXh0ID0gJ21hcmdpbjowIDAgMnB4O2ZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzotMC40cHgnO1xuICBoMi50ZXh0Q29udGVudCA9ICdJbXBvcnRhciByZXBhcnRvIGRlc2RlIEV4Y2VsJztcbiAgaGVhZFRpdGxlV3JhcC5hcHBlbmRDaGlsZChoMik7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgc3VidC5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxMi41cHg7Y29sb3I6Izg2ODY4Yic7XG4gIHN1YnQudGV4dENvbnRlbnQgPSAnU3ViXHUwMEVEIGVsIEV4Y2VsIGVkaXRhZG8gb2ZmbGluZS4gU2UgdmFsaWRhIGZpbGEgcG9yIGZpbGEgYW50ZXMgZGUgYXBsaWNhci4nO1xuICBoZWFkVGl0bGVXcmFwLmFwcGVuZENoaWxkKHN1YnQpO1xuICBoZWFkLmFwcGVuZENoaWxkKGhlYWRUaXRsZVdyYXApO1xuICBjb25zdCBjbG9zZUJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICBjbG9zZUJ0bi50eXBlID0gJ2J1dHRvbic7XG4gIGNsb3NlQnRuLnRleHRDb250ZW50ID0gJ1x1MDBENyc7XG4gIGNsb3NlQnRuLnN0eWxlLmNzc1RleHQgPVxuICAgICdib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjEyKTt3aWR0aDozMHB4O2hlaWdodDozMHB4O2JvcmRlci1yYWRpdXM6NTAlO2N1cnNvcjpwb2ludGVyO2NvbG9yOiM2ZTZlNzM7Zm9udC1zaXplOjE2cHgnO1xuICBjbG9zZUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gIH0pO1xuICBoZWFkLmFwcGVuZENoaWxkKGNsb3NlQnRuKTtcbiAgYm94LmFwcGVuZENoaWxkKGhlYWQpO1xuICAvLyBCb2R5LlxuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGJvZHkuc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjE2cHggMjJweDtmbGV4OjE7b3ZlcmZsb3cteTphdXRvO21pbi1oZWlnaHQ6MCc7XG4gIGNvbnN0IGZpbGVJbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XG4gIGZpbGVJbnB1dC50eXBlID0gJ2ZpbGUnO1xuICBmaWxlSW5wdXQuaWQgPSAncmVwYXJ0by1pbXBvcnQtZmlsZSc7XG4gIGZpbGVJbnB1dC5hY2NlcHQgPSAnLnhsc3gnO1xuICBmaWxlSW5wdXQuc3R5bGUuY3NzVGV4dCA9ICdtYXJnaW4tYm90dG9tOjE0cHgnO1xuICBmaWxlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICBpZiAodHlwZW9mIHcuaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UgPT09ICdmdW5jdGlvbicpIHcuaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UoZXYpO1xuICB9KTtcbiAgYm9keS5hcHBlbmRDaGlsZChmaWxlSW5wdXQpO1xuICBjb25zdCBwcmV2aWV3RGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHByZXZpZXdEaXYuaWQgPSAncmVwYXJ0by1pbXBvcnQtcHJldmlldyc7XG4gIHByZXZpZXdEaXYuc3R5bGUuY3NzVGV4dCA9ICdtaW4taGVpZ2h0OjQwcHgnO1xuICBib2R5LmFwcGVuZENoaWxkKHByZXZpZXdEaXYpO1xuICBib3guYXBwZW5kQ2hpbGQoYm9keSk7XG4gIC8vIEZvb3Rlci5cbiAgY29uc3QgZm9vdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBmb290LnN0eWxlLmNzc1RleHQgPVxuICAgICdwYWRkaW5nOjE0cHggMjJweDtib3JkZXItdG9wOjAuNXB4IHNvbGlkIHJnYmEoMCwwLDAsLjA4KTtkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7anVzdGlmeS1jb250ZW50OmZsZXgtZW5kJztcbiAgY29uc3QgY2FuY2VsQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gIGNhbmNlbEJ0bi50eXBlID0gJ2J1dHRvbic7XG4gIGNhbmNlbEJ0bi50ZXh0Q29udGVudCA9ICdDYW5jZWxhcic7XG4gIGNhbmNlbEJ0bi5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzo5cHggMThweDtib3JkZXI6MC41cHggc29saWQgcmdiYSgwLDAsMCwuMTIpO2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjk5OXB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4JztcbiAgY2FuY2VsQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKHR5cGVvZiB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZyA9PT0gJ2Z1bmN0aW9uJykgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2coKTtcbiAgfSk7XG4gIGZvb3QuYXBwZW5kQ2hpbGQoY2FuY2VsQnRuKTtcbiAgY29uc3QgYXBwbHlCdG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgYXBwbHlCdG4udHlwZSA9ICdidXR0b24nO1xuICBhcHBseUJ0bi5pZCA9ICdyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nO1xuICBhcHBseUJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gIGFwcGx5QnRuLnRleHRDb250ZW50ID0gJ0FwbGljYXIgcmVwYXJ0byBpbXBvcnRhZG8nO1xuICBhcHBseUJ0bi5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzo5cHggMThweDtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOiMyNDhhM2Q7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjk5OXB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtvcGFjaXR5OjAuNCc7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKHR5cGVvZiB3LmNvbmZpcm1SZXBhcnRvSW1wb3J0QXBwbHkgPT09ICdmdW5jdGlvbicpIHcuY29uZmlybVJlcGFydG9JbXBvcnRBcHBseSgpO1xuICB9KTtcbiAgZm9vdC5hcHBlbmRDaGlsZChhcHBseUJ0bik7XG4gIGJveC5hcHBlbmRDaGlsZChmb290KTtcbiAgbW9kYWwuYXBwZW5kQ2hpbGQoYm94KTtcbiAgcmV0dXJuIG1vZGFsO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBeUJBLGlCQUFlLGlCQUFp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eUJBQXlCO0FBQUEsSUFDbkYsQ0FBQztBQUNELFNBQUssWUFBWSxRQUFRO0FBQ3pCLFFBQUksWUFBWSxJQUFJO0FBRXBCLFVBQU0sT0FBTyxTQUFTLGNBQWMsS0FBSztBQUN6QyxTQUFLLE1BQU0sVUFBVTtBQUNyQixVQUFNLFlBQVksU0FBUyxjQUFjLE9BQU87QUFDaEQsY0FBVSxPQUFPO0FBQ2pCLGNBQVUsS0FBSztBQUNmLGNBQVUsU0FBUztBQUNuQixjQUFVLE1BQU0sVUFBVTtBQUMxQixjQUFVLGlCQUFpQixVQUFVLENBQUMsT0FBTztBQUMzQyxZQUFNO0FBQUE7QUFBQSxRQUF3QjtBQUFBO0FBQzlCLFVBQUksT0FBTyxFQUFFLGtDQUFrQyxXQUFZLEdBQUUsOEJBQThCLEVBQUU7QUFBQSxJQUMvRixDQUFDO0FBQ0QsU0FBSyxZQUFZLFNBQVM7QUFDMUIsVUFBTSxhQUFhLFNBQVMsY0FBYyxLQUFLO0FBQy9DLGVBQVcsS0FBSztBQUNoQixlQUFXLE1BQU0sVUFBVTtBQUMzQixTQUFLLFlBQVksVUFBVTtBQUMzQixRQUFJLFlBQVksSUFBSTtBQUVwQixVQUFNLE9BQU8sU0FBUyxjQUFjLEtBQUs7QUFDekMsU0FBSyxNQUFNLFVBQ1Q7QUFDRixVQUFNLFlBQVksU0FBUyxjQUFjLFFBQVE7QUFDakQsY0FBVSxPQUFPO0FBQ2pCLGNBQVUsY0FBYztBQUN4QixjQUFVLE1BQU0sVUFDZDtBQUNGLGNBQVUsaUJBQWlCLFNBQVMsTUFBTTtBQUN4QyxZQUFNO0FBQUE7QUFBQSxRQUF3QjtBQUFBO0FBQzlCLFVBQUksT0FBTyxFQUFFLDZCQUE2QixXQUFZLEdBQUUseUJBQXlCO0FBQUEsSUFDbkYsQ0FBQztBQUNELFNBQUssWUFBWSxTQUFTO0FBQzFCLFVBQU0sV0FBVyxTQUFTLGNBQWMsUUFBUTtBQUNoRCxhQUFTLE9BQU87QUFDaEIsYUFBUyxLQUFLO0FBQ2QsYUFBUyxXQUFXO0FBQ3BCLGFBQVMsY0FBYztBQUN2QixhQUFTLE1BQU0sVUFDYjtBQUNGLGFBQVMsaUJBQWlCLFNBQVMsTUFBTTtBQUN2QyxZQUFNO0FBQUE7QUFBQSxRQUF3QjtBQUFBO0FBQzlCLFVBQUksT0FBTyxFQUFFLDhCQUE4QixXQUFZLEdBQUUsMEJBQTBCO0FBQUEsSUFDckYsQ0FBQztBQUNELFNBQUssWUFBWSxRQUFRO0FBQ3pCLFFBQUksWUFBWSxJQUFJO0FBQ3BCLFVBQU0sWUFBWSxHQUFHO0FBQ3JCLFdBQU87QUFBQSxFQUNUOyIsCiAgIm5hbWVzIjogW10KfQo=
