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
        alert('No hay filas para exportar con los filtros actuales. Limpi\xE1 b\xFAsqueda o destild\xE1 "Ocultar sin stock".');
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
      headerRow.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF888888" } };
      headerRow.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF888888" } };
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
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      let v = cell.value;
      if (v && typeof v === "object" && "text" in v) v = v.text;
      if (v && typeof v === "object" && "result" in v) v = v.result;
      const label = String(v || "").trim().toLowerCase();
      if (!label) return;
      if (label === "codigo" || label === "c\xF3digo") out[col] = "Codigo";
      else if (label === "cliente") out[col] = "Cliente";
      else if (label === "backorder") out[col] = "Backorder";
      else if (label === "stock disponible" || label === "stock_disponible") out[col] = "StockDisponible";
      else if (label === "asignado") out[col] = "Asignado";
      else if (label === "vuelve a backorder") out[col] = "VueleABackorder";
      else if (label === "eliminar") out[col] = "Eliminar";
      else if (label === "reparto id" || label === "repartoid" || label === "reparto_id") out[col] = "RepartoId";
      else if (label === "cardcode" || label === "card code" || label === "card_code") out[col] = "CardCode";
    });
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
    chipRec.appendChild(_mkDiv("font-size:22px;font-weight:700;margin-top:2px", String(s.reconocidas.length)));
    chipsRow.appendChild(chipRec);
    const chipCamb = _mkDiv(
      "flex:1;min-width:140px;padding:10px 14px;background:rgba(0,122,255,.14);border-radius:8px;color:#0040dd",
      null
    );
    chipCamb.appendChild(_mkDiv("font-size:11px;letter-spacing:.5px;text-transform:uppercase", "Con cambios"));
    chipCamb.appendChild(_mkDiv("font-size:22px;font-weight:700;margin-top:2px", String(s.conCambios.length)));
    chipsRow.appendChild(chipCamb);
    const chipErr = _mkDiv(
      "flex:1;min-width:140px;padding:10px 14px;background:" + (s.errores.length ? "rgba(255,59,48,.14)" : "rgba(120,120,128,.08)") + ";border-radius:8px;color:" + (s.errores.length ? "#c7372f" : "#6e6e73"),
      null
    );
    chipErr.appendChild(_mkDiv("font-size:11px;letter-spacing:.5px;text-transform:uppercase", "Errores"));
    chipErr.appendChild(_mkDiv("font-size:22px;font-weight:700;margin-top:2px", String(s.errores.length)));
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
          _mkDiv("color:#86868b;font-size:11px;margin-top:4px", "...y " + (s.conCambios.length - 30) + " m\xE1s")
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
            failures.push("Reparto " + g.repartoId + " / CardCode " + a.cardCode + " ya no est\xE1 en BO");
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
            failures.push("Reparto " + g.repartoId + " / CardCode " + e.cardCode + " ya no est\xE1 en BO");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1yZXBhcnRvLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogZXhwb3J0cy1yZXBhcnRvICh2MTUwNSwgMjAyNi0xMC0yOCkgXHUyMDE0IGNodW5rIGxhenkgcGFyYSBlbCBmbG93IGRlIGV4cG9ydCArXG4gKiBpbXBvcnQgRXhjZWwgZGVsIFJlcGFydG8gZGUgaW5ncmVzb3MuXG4gKlxuICogRG9zIGhhbmRsZXJzIHByaW5jaXBhbGVzIGV4cHVlc3RvcyBhIHdpbmRvdzpcbiAqICAgLSB3aW5kb3cuZXhwb3J0UmVwYXJ0b01hbnVhbEV4Y2VsKCkgIFx1MjAxNCB0ZW1wbGF0ZSBlZGl0YWJsZSBjb24gOSBjb2x1bW5hc1xuICogICAgICg3IHZpc2libGVzICsgMiB0XHUwMEU5Y25pY2FzIGFsIGZpbmFsLCBncmlzZXMgeSBwcm90ZWdpZGFzKS5cbiAqICAgLSB3aW5kb3cub3BlblJlcGFydG9JbXBvcnREaWFsb2coKSAgIFx1MjAxNCBtb2RhbCBjb24gPGlucHV0IHR5cGU9ZmlsZT4sXG4gKiAgICAgcHJldmlldyBkZSB2YWxpZGFjaVx1MDBGM24sIHkgYm90XHUwMEYzbiBcIkFwbGljYXIgcmVwYXJ0byBpbXBvcnRhZG9cIi5cbiAqXG4gKiBGdWVudGUgXHUwMEZBbmljYTogcHVyZSBmbnNcbiAqICAgLSBzcmMvcHVyZS9yZXBhcnRvLWV4Y2VsLWV4cG9ydC1yb3dzLmpzIFx1MjAxNCBhcm1hZG8gZGUgZmlsYXMuXG4gKiAgIC0gc3JjL3B1cmUvcmVwYXJ0by1leGNlbC1pbXBvcnQtdmFsaWRhdG9yLmpzIFx1MjAxNCB2YWxpZGFjaVx1MDBGM24gcG9yIGZpbGEuXG4gKlxuICogUGF5bG9hZCBzZXJ2ZXI6IFNJRU1QUkUgdmlhIGBhcHBseVJlcGFydG9NYW51YWxDRmAgKGNhbGxhYmxlKS4gTlVOQ0FcbiAqIGVzY3JpdHVyYSBkaXJlY3RhIGEgRmlyZXN0b3JlIChDTEFVREUubWQgXHUwMEE3NjMgcGF0dGVybikuXG4gKlxuICogTG9nOiBgcmVwYXJ0b19sb2dgIGNvbiBgb3JpZ2VuPSdpbXBvcnQnYCArIGZpbGVOYW1lICsgaW1wb3J0ZWRCeVVpZCArIC4uLlxuICovXG5cbi8qKlxuICogTGF6eSBsb2FkZXIgcGFyYSBFeGNlbEpTLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIF9lbnN1cmVFeGNlbEpTKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAodHlwZW9mIHcubG9hZEV4Y2VsSlMgPT09ICdmdW5jdGlvbicpIGF3YWl0IHcubG9hZEV4Y2VsSlMoKTtcbiAgaWYgKCF3LkV4Y2VsSlMpIHRocm93IG5ldyBFcnJvcignRXhjZWxKUyBubyBkaXNwb25pYmxlJyk7XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IG1zZ1xuICogQHBhcmFtIHtudW1iZXJ9IFttc11cbiAqL1xuZnVuY3Rpb24gX3N5bmNUYWcobXNnLCBtcykge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAodHlwZW9mIHcuc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0cnkge1xuICAgICAgdy5zaG93U3luY1RhZyhtc2csIG1zKTtcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgLyogaWdub3JlICovXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IHNrdVxuICogQHJldHVybnMge251bWJlcn1cbiAqL1xuZnVuY3Rpb24gX2dldFN0b2NrRmlzaWNvKHNrdSkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAodHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgIT09ICdmdW5jdGlvbicpIHJldHVybiAwO1xuICB0cnkge1xuICAgIHJldHVybiBOdW1iZXIody5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YShza3UpKSB8fCAwO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiAwO1xuICB9XG59XG5cbi8qKlxuICogQHJldHVybnMge3tzZWFyY2g6IHN0cmluZywgaGlkZU5vU3RvY2s6IGJvb2xlYW59fVxuICovXG5mdW5jdGlvbiBfcmVhZEZpbHRyb3NNb2RhbFJlcGFydG8oKSB7XG4gIGNvbnN0IHNFbCA9XG4gICAgdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyA/IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLXNlYXJjaCcpIDogbnVsbDtcbiAgY29uc3QgaEVsID1cbiAgICB0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnID8gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taGlkZS1ub3N0b2NrJykgOiBudWxsO1xuICByZXR1cm4ge1xuICAgIHNlYXJjaDogc0VsID8gU3RyaW5nKC8qKiBAdHlwZSB7YW55fSAqLyAoc0VsKS52YWx1ZSB8fCAnJykudHJpbSgpIDogJycsXG4gICAgaGlkZU5vU3RvY2s6IGhFbCA/ICEhKC8qKiBAdHlwZSB7YW55fSAqLyAoaEVsKS5jaGVja2VkKSA6IHRydWUsXG4gIH07XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd9IGV4cG9ydEtpbmRcbiAqIEBwYXJhbSB7c3RyaW5nfSBtc2dcbiAqL1xuZnVuY3Rpb24gX2xvZ0V4cG9ydEVycm9yKGV4cG9ydEtpbmQsIG1zZykge1xuICB0cnkge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKCF3LmZiRGIgfHwgdHlwZW9mIHcuZmJEYi5jb2xsZWN0aW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm47XG4gICAgdy5mYkRiXG4gICAgICAuY29sbGVjdGlvbignb3BlcmF0aW9uc19sb2cnKVxuICAgICAgLmFkZCh7XG4gICAgICAgIHR5cGU6ICdleHBvcnRfZmFpbGVkJyxcbiAgICAgICAgZXhwb3J0S2luZCxcbiAgICAgICAgZXJyb3I6IG1zZy5zbGljZSgwLCA1MDApLFxuICAgICAgICB1c2VyVWlkOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLnVpZCkgfHwgbnVsbCxcbiAgICAgICAgdXNlckVtYWlsOiAody5jdXJyZW50VXNlciAmJiB3LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCBudWxsLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgLyogaWdub3JlICovXG4gICAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICAvKiBpZ25vcmUgKi9cbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBUlRFIDEgXHUyMDE0IEV4cG9ydCBtYW51YWwgKHRlbXBsYXRlIGVkaXRhYmxlKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5leHBvcnRSZXBhcnRvTWFudWFsRXhjZWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIHBhcmEgZXhwb3J0YXIuIEFiclx1MDBFRCBlbCBtb2RhbCBcIlJlcGFydG8gZGUgaW5ncmVzb3NcIiBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBfc3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGVkaXRhYmxlXHUyMDI2Jyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcHVyZU1vZCA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5yZXBhcnRvRXhjZWxFeHBvcnQ7XG4gICAgaWYgKCFwdXJlTW9kIHx8IHR5cGVvZiBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3B1cmUgZm4gcmVwYXJ0b0V4Y2VsRXhwb3J0IG5vIGRpc3BvbmlibGUnKTtcbiAgICB9XG4gICAgY29uc3QgY29uc29saWRhdGVGbiA9XG4gICAgICB3Ll9fcGhhc2UwICYmXG4gICAgICB3Ll9fcGhhc2UwLnB1cmUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUgJiZcbiAgICAgIHcuX19waGFzZTAucHVyZS5yZXBhcnRvQ29uc29saWRhdGUuY29uc29saWRhdGVDbGllbnRlc0JPO1xuICAgIGNvbnN0IGZpbHRyb3MgPSBfcmVhZEZpbHRyb3NNb2RhbFJlcGFydG8oKTtcbiAgICBjb25zdCByZXN1bHQgPSBwdXJlTW9kLmNvbXB1dGVSZXBhcnRvRXhjZWxFeHBvcnRSb3dzKGluZ3Jlc29zLCBmaWx0cm9zLCB7XG4gICAgICBnZXRTdG9ja0Zpc2ljbzogX2dldFN0b2NrRmlzaWNvLFxuICAgICAgY29uc29saWRhdGVGbjogdHlwZW9mIGNvbnNvbGlkYXRlRm4gPT09ICdmdW5jdGlvbicgPyBjb25zb2xpZGF0ZUZuIDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICAgIGlmICghcmVzdWx0LnJvd3MubGVuZ3RoKSB7XG4gICAgICBhbGVydCgnTm8gaGF5IGZpbGFzIHBhcmEgZXhwb3J0YXIgY29uIGxvcyBmaWx0cm9zIGFjdHVhbGVzLiBMaW1waVx1MDBFMSBiXHUwMEZBc3F1ZWRhIG8gZGVzdGlsZFx1MDBFMSBcIk9jdWx0YXIgc2luIHN0b2NrXCIuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgX2Vuc3VyZUV4Y2VsSlMoKTtcbiAgICBjb25zdCBFeGNlbEpTID0gdy5FeGNlbEpTO1xuICAgIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVwYXJ0bycpO1xuXG4gICAgd3MuY29sdW1ucyA9IFtcbiAgICAgIHsgaGVhZGVyOiAnQ29kaWdvJywga2V5OiAnQ29kaWdvJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0NsaWVudGUnLCBrZXk6ICdDbGllbnRlJywgd2lkdGg6IDM2IH0sXG4gICAgICB7IGhlYWRlcjogJ0JhY2tvcmRlcicsIGtleTogJ0JhY2tvcmRlcicsIHdpZHRoOiAxMiB9LFxuICAgICAgeyBoZWFkZXI6ICdTdG9jayBkaXNwb25pYmxlJywga2V5OiAnU3RvY2tEaXNwb25pYmxlJywgd2lkdGg6IDE1IH0sXG4gICAgICB7IGhlYWRlcjogJ0FzaWduYWRvJywga2V5OiAnQXNpZ25hZG8nLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnVnVlbHZlIGEgYmFja29yZGVyJywga2V5OiAnVnVlbGVBQmFja29yZGVyJywgd2lkdGg6IDE4IH0sXG4gICAgICB7IGhlYWRlcjogJ0VsaW1pbmFyJywga2V5OiAnRWxpbWluYXInLCB3aWR0aDogMTIgfSxcbiAgICAgIHsgaGVhZGVyOiAnUmVwYXJ0byBJRCcsIGtleTogJ1JlcGFydG9JZCcsIHdpZHRoOiAyNCB9LFxuICAgICAgeyBoZWFkZXI6ICdDYXJkQ29kZScsIGtleTogJ0NhcmRDb2RlJywgd2lkdGg6IDE2IH0sXG4gICAgXTtcblxuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmdldFJvdygxKTtcbiAgICBoZWFkZXJSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2NjUzNCcgfSB9O1xuICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAgIGNlbGwuYm9yZGVyID0ge1xuICAgICAgICB0b3A6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIGxlZnQ6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICAgIHJpZ2h0OiB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9LFxuICAgICAgICBib3R0b206IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH0sXG4gICAgICB9O1xuICAgIH0pO1xuICAgIGhlYWRlclJvdy5oZWlnaHQgPSAyODtcbiAgICBoZWFkZXJSb3cuZ2V0Q2VsbCg4KS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGODg4ODg4JyB9IH07XG4gICAgaGVhZGVyUm93LmdldENlbGwoOSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjg4ODg4OCcgfSB9O1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN1bHQucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgciA9IHJlc3VsdC5yb3dzW2ldO1xuICAgICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgICAgQ29kaWdvOiByLkNvZGlnbyxcbiAgICAgICAgQ2xpZW50ZTogci5DbGllbnRlLFxuICAgICAgICBCYWNrb3JkZXI6IHIuQmFja29yZGVyLFxuICAgICAgICBTdG9ja0Rpc3BvbmlibGU6IHIuU3RvY2tEaXNwb25pYmxlLFxuICAgICAgICBBc2lnbmFkbzogci5Bc2lnbmFkbyxcbiAgICAgICAgVnVlbGVBQmFja29yZGVyOiBudWxsLFxuICAgICAgICBFbGltaW5hcjogci5FbGltaW5hcixcbiAgICAgICAgUmVwYXJ0b0lkOiByLlJlcGFydG9JZCxcbiAgICAgICAgQ2FyZENvZGU6IHIuQ2FyZENvZGUsXG4gICAgICB9KTtcbiAgICAgIHJvdy5nZXRDZWxsKDYpLnZhbHVlID0ge1xuICAgICAgICBmb3JtdWxhOiByLlZ1ZWxlQUJhY2tvcmRlci5yZXBsYWNlKC9ePS8sICcnKSxcbiAgICAgICAgcmVzdWx0OiByLkJhY2tvcmRlciAtIHIuQXNpZ25hZG8gLSByLkVsaW1pbmFyLFxuICAgICAgfTtcbiAgICAgIHJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xuICAgICAgICBjZWxsLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICAgICAgICBjZWxsLmJvcmRlciA9IHtcbiAgICAgICAgICB0b3A6IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGRUVFRUVFJyB9IH0sXG4gICAgICAgICAgbGVmdDogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgICByaWdodDogeyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZFRUVFRUUnIH0gfSxcbiAgICAgICAgICBib3R0b206IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGRUVFRUVFJyB9IH0sXG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgICAgIHJvdy5nZXRDZWxsKDgpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkZGNUY1RjUnIH0gfTtcbiAgICAgIHJvdy5nZXRDZWxsKDgpLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjg4ODg4OCcgfSwgc2l6ZTogMTAgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDkpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkZGNUY1RjUnIH0gfTtcbiAgICAgIHJvdy5nZXRDZWxsKDkpLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjg4ODg4OCcgfSwgc2l6ZTogMTAgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDEpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoMikucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCgzKS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDQpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgICAgcm93LmdldENlbGwoNSkucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiBmYWxzZSB9O1xuICAgICAgcm93LmdldENlbGwoNikucHJvdGVjdGlvbiA9IHsgbG9ja2VkOiB0cnVlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg3KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IGZhbHNlIH07XG4gICAgICByb3cuZ2V0Q2VsbCg4KS5wcm90ZWN0aW9uID0geyBsb2NrZWQ6IHRydWUgfTtcbiAgICAgIHJvdy5nZXRDZWxsKDkpLnByb3RlY3Rpb24gPSB7IGxvY2tlZDogdHJ1ZSB9O1xuICAgIH1cblxuICAgIHdzLnZpZXdzID0gW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV07XG5cbiAgICBhd2FpdCB3cy5wcm90ZWN0KCcnLCB7XG4gICAgICBzZWxlY3RMb2NrZWRDZWxsczogdHJ1ZSxcbiAgICAgIHNlbGVjdFVubG9ja2VkQ2VsbHM6IHRydWUsXG4gICAgICBmb3JtYXRDZWxsczogZmFsc2UsXG4gICAgICBzb3J0OiBmYWxzZSxcbiAgICAgIGF1dG9GaWx0ZXI6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBmaWxlbmFtZSA9IHB1cmVNb2QuYnVpbGRSZXBhcnRvRXhjZWxGaWxlTmFtZVxuICAgICAgPyBwdXJlTW9kLmJ1aWxkUmVwYXJ0b0V4Y2VsRmlsZU5hbWUobmV3IERhdGUoKSlcbiAgICAgIDogJ1JlcGFydG9fJyArXG4gICAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgK1xuICAgICAgICAnXycgK1xuICAgICAgICBuZXcgRGF0ZSgpLnRvVGltZVN0cmluZygpLnNsaWNlKDAsIDUpLnJlcGxhY2UoJzonLCAnJykgK1xuICAgICAgICAnLnhsc3gnO1xuXG4gICAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBhLnJlbW92ZSgpO1xuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcblxuICAgIF9zeW5jVGFnKFxuICAgICAgJ0V4Y2VsIGVkaXRhYmxlIGxpc3RvICgnICsgcmVzdWx0LnJvd3MubGVuZ3RoICsgJyBmaWxhcyBcdTAwQjcgJyArIHJlc3VsdC50b3RhbEJhY2tvcmRlciArICd1IEJPKScsXG4gICAgICAzMjAwXG4gICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IChlICYmIC8qKiBAdHlwZSB7YW55fSAqLyAoZSkubWVzc2FnZSkgfHwgU3RyaW5nKGUpO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1t2MTUwNSBcdTAwQTdSZXBhcnRvXSBleHBvcnRSZXBhcnRvTWFudWFsRXhjZWwgZmFsbFx1MDBGMzonLCBlKTtcbiAgICBhbGVydCgnTm8gcHVkaW1vcyBnZW5lcmFyIGVsIEV4Y2VsIGVkaXRhYmxlLiBWb2x2XHUwMEU5IGEgaW50ZW50YXI7IHNpIHNpZ3VlLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICBfbG9nRXhwb3J0RXJyb3IoJ2V4cG9ydF9tYW51YWwnLCBtc2cpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBUlRFIDIgXHUyMDE0IEltcG9ydCBFeGNlbFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmxldCBfaW1wb3J0U3RhdGUgPSAvKiogQHR5cGUge251bGwgfCB7XG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHJlY29ub2NpZGFzOiBBcnJheTxhbnk+LFxuICBjb25DYW1iaW9zOiBBcnJheTxhbnk+LFxuICBlcnJvcmVzOiBBcnJheTxhbnk+LFxuICB0b3RhbEZpbGFzOiBudW1iZXIsXG4gIHRvdGFsQXNpZ25hZG86IG51bWJlcixcbiAgdG90YWxFbGltaW5hcjogbnVtYmVyLFxufX0gKi8gKG51bGwpO1xuXG4vKipcbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG5mdW5jdGlvbiBfaXNBZG1pbkxpa2VGb3JJbXBvcnQoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IHJvbGUgPSAody51c2VyUm9sZSB8fCAnJykudG9Mb3dlckNhc2UoKTtcbiAgaWYgKHJvbGUgPT09ICdhZG1pbicgfHwgcm9sZSA9PT0gJ2dlcmVudGUnKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgZW1haWwgPSBTdHJpbmcoKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gIGlmIChlbWFpbCA9PT0gJ3BhYmxvLmdvbnphbGV6QHNoaW1hbm8uY29tLmFyJyB8fCBlbWFpbCA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJykgcmV0dXJuIHRydWU7XG4gIHJldHVybiBmYWxzZTtcbn1cblxud2luZG93Lm9wZW5SZXBhcnRvSW1wb3J0RGlhbG9nID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIV9pc0FkbWluTGlrZUZvckltcG9ydCgpKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGltcG9ydGFyIHJlcGFydG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIGFjdGl2b3MuIEFiclx1MDBFRCBlbCBtb2RhbCBSZXBhcnRvIHByaW1lcm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSB7XG4gICAgbW9kYWwgPSBfYnVpbGRJbXBvcnRNb2RhbERvbSgpO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobW9kYWwpO1xuICB9XG4gIF9pbXBvcnRTdGF0ZSA9IG51bGw7XG4gIGNvbnN0IHByZXZpZXdFbCA9IG1vZGFsLnF1ZXJ5U2VsZWN0b3IoJyNyZXBhcnRvLWltcG9ydC1wcmV2aWV3Jyk7XG4gIGlmIChwcmV2aWV3RWwpIHtcbiAgICB3aGlsZSAocHJldmlld0VsLmZpcnN0Q2hpbGQpIHByZXZpZXdFbC5yZW1vdmVDaGlsZChwcmV2aWV3RWwuZmlyc3RDaGlsZCk7XG4gIH1cbiAgY29uc3QgYXBwbHlCdG4gPSBtb2RhbC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmIChhcHBseUJ0bikge1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAvKiogQHR5cGUge2FueX0gKi8gKGFwcGx5QnRuKS5zdHlsZS5vcGFjaXR5ID0gJzAuNCc7XG4gIH1cbiAgY29uc3QgZmlsZUlucHV0ID0gbW9kYWwucXVlcnlTZWxlY3RvcignI3JlcGFydG8taW1wb3J0LWZpbGUnKTtcbiAgaWYgKGZpbGVJbnB1dCkgLyoqIEB0eXBlIHthbnl9ICovIChmaWxlSW5wdXQpLnZhbHVlID0gJyc7XG4gIC8qKiBAdHlwZSB7YW55fSAqLyAobW9kYWwpLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7XG59O1xuXG53aW5kb3cuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1tb2RhbCcpO1xuICBpZiAobW9kYWwpIC8qKiBAdHlwZSB7YW55fSAqLyAobW9kYWwpLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIF9pbXBvcnRTdGF0ZSA9IG51bGw7XG59O1xuXG4vKipcbiAqIEBwYXJhbSB7RXZlbnR9IGV2XG4gKi9cbndpbmRvdy5oYW5kbGVSZXBhcnRvSW1wb3J0RmlsZUNoYW5nZSA9IGFzeW5jIGZ1bmN0aW9uIChldikge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBjb25zdCB0Z3QgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR9ICovIChldi50YXJnZXQpO1xuICBjb25zdCBmaWxlID0gdGd0ICYmIHRndC5maWxlcyAmJiB0Z3QuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICBjb25zdCBwcmV2aWV3RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtcHJldmlldycpO1xuICBjb25zdCBhcHBseUJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZXBhcnRvLWltcG9ydC1hcHBseS1idG4nKTtcbiAgaWYgKHByZXZpZXdFbCkge1xuICAgIHdoaWxlIChwcmV2aWV3RWwuZmlyc3RDaGlsZCkgcHJldmlld0VsLnJlbW92ZUNoaWxkKHByZXZpZXdFbC5maXJzdENoaWxkKTtcbiAgICBwcmV2aWV3RWwudGV4dENvbnRlbnQgPSAnTGV5ZW5kbyBFeGNlbFx1MjAyNic7XG4gIH1cbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgLyoqIEB0eXBlIHthbnl9ICovIChhcHBseUJ0bikuZGlzYWJsZWQgPSB0cnVlO1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLm9wYWNpdHkgPSAnMC40JztcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IF9lbnN1cmVFeGNlbEpTKCk7XG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xuICAgIGNvbnN0IHdiID0gbmV3IHcuRXhjZWxKUy5Xb3JrYm9vaygpO1xuICAgIGF3YWl0IHdiLnhsc3gubG9hZChidWYpO1xuICAgIGNvbnN0IHdzID0gd2Iud29ya3NoZWV0c1swXTtcbiAgICBpZiAoIXdzKSB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsIHNpbiBob2phcycpO1xuXG4gICAgY29uc3QgaGVhZGVyTWFwID0gX2J1aWxkSGVhZGVyTWFwKHdzKTtcbiAgICAvKiogQHR5cGUge0FycmF5PGFueT59ICovXG4gICAgY29uc3Qgcm93cyA9IFtdO1xuICAgIHdzLmVhY2hSb3coKHJvdywgcm4pID0+IHtcbiAgICAgIGlmIChybiA9PT0gMSkgcmV0dXJuO1xuICAgICAgLyoqIEB0eXBlIHthbnl9ICovXG4gICAgICBjb25zdCBvYmogPSB7IF9fcm93SW5kZXg6IHJuIH07XG4gICAgICByb3cuZWFjaENlbGwoeyBpbmNsdWRlRW1wdHk6IHRydWUgfSwgKGNlbGwsIGNvbElkeCkgPT4ge1xuICAgICAgICBjb25zdCBjYW5vbktleSA9IGhlYWRlck1hcFtjb2xJZHhdO1xuICAgICAgICBpZiAoIWNhbm9uS2V5KSByZXR1cm47XG4gICAgICAgIGxldCB2ID0gY2VsbC52YWx1ZTtcbiAgICAgICAgaWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICd0ZXh0JyBpbiB2KSB2ID0gdi50ZXh0O1xuICAgICAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgJ3Jlc3VsdCcgaW4gdikgdiA9IHYucmVzdWx0O1xuICAgICAgICBvYmpbY2Fub25LZXldID0gdjtcbiAgICAgIH0pO1xuICAgICAgaWYgKCFvYmouUmVwYXJ0b0lkICYmICFvYmouQ2FyZENvZGUgJiYgIW9iai5Db2RpZ28pIHJldHVybjtcbiAgICAgIHJvd3MucHVzaChvYmopO1xuICAgIH0pO1xuXG4gICAgY29uc3QgaW5ncmVzb3MgPSBBcnJheS5pc0FycmF5KHcuX3JlcGFydG9JbmdyZXNvcykgPyB3Ll9yZXBhcnRvSW5ncmVzb3MgOiBbXTtcbiAgICBjb25zdCByZXBhcnRvc0FjdGl2b3MgPSBpbmdyZXNvcy5tYXAoKC8qKiBAdHlwZSB7YW55fSAqLyBpKSA9PiAoe1xuICAgICAgX2lkOiBpLl9pZCxcbiAgICAgIHNrdTogaS5za3UsXG4gICAgICBzdGF0dXM6IGkuc3RhdHVzIHx8ICdwZW5kaW5nJyxcbiAgICAgIHN0b2NrRGlzcG9uaWJsZTogX2dldFN0b2NrRmlzaWNvKGkuc2t1KSxcbiAgICAgIGNsaWVudGVzQk86IEFycmF5LmlzQXJyYXkoaS5jbGllbnRlc0JPKSA/IGkuY2xpZW50ZXNCTyA6IFtdLFxuICAgIH0pKTtcblxuICAgIGNvbnN0IHZhbGlkYXRvciA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5yZXBhcnRvRXhjZWxJbXBvcnQ7XG4gICAgaWYgKCF2YWxpZGF0b3IgfHwgdHlwZW9mIHZhbGlkYXRvci52YWxpZGF0ZVJlcGFydG9FeGNlbEltcG9ydCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdwdXJlIGZuIHJlcGFydG9FeGNlbEltcG9ydCBubyBkaXNwb25pYmxlJyk7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IHZhbGlkYXRvci52YWxpZGF0ZVJlcGFydG9FeGNlbEltcG9ydChyb3dzLCByZXBhcnRvc0FjdGl2b3MpO1xuICAgIF9pbXBvcnRTdGF0ZSA9IHtcbiAgICAgIGZpbGVOYW1lOiBmaWxlLm5hbWUsXG4gICAgICByZWNvbm9jaWRhczogcmVzdWx0LnJlY29ub2NpZGFzLFxuICAgICAgY29uQ2FtYmlvczogcmVzdWx0LmNvbkNhbWJpb3MsXG4gICAgICBlcnJvcmVzOiByZXN1bHQuZXJyb3JlcyxcbiAgICAgIHRvdGFsRmlsYXM6IHJlc3VsdC50b3RhbEZpbGFzLFxuICAgICAgdG90YWxBc2lnbmFkbzogcmVzdWx0LnRvdGFsQXNpZ25hZG8sXG4gICAgICB0b3RhbEVsaW1pbmFyOiByZXN1bHQudG90YWxFbGltaW5hcixcbiAgICB9O1xuICAgIF9yZW5kZXJJbXBvcnRQcmV2aWV3KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSAoZSAmJiAvKiogQHR5cGUge2FueX0gKi8gKGUpLm1lc3NhZ2UpIHx8IFN0cmluZyhlKTtcbiAgICBjb25zb2xlLmVycm9yKCdbdjE1MDUgXHUwMEE3UmVwYXJ0b10gaGFuZGxlUmVwYXJ0b0ltcG9ydEZpbGVDaGFuZ2UgZXJyb3I6JywgZSk7XG4gICAgaWYgKHByZXZpZXdFbCkge1xuICAgICAgd2hpbGUgKHByZXZpZXdFbC5maXJzdENoaWxkKSBwcmV2aWV3RWwucmVtb3ZlQ2hpbGQocHJldmlld0VsLmZpcnN0Q2hpbGQpO1xuICAgICAgY29uc3QgZXJyRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICBlcnJEaXYuc3R5bGUuY3NzVGV4dCA9XG4gICAgICAgICdjb2xvcjojYzczNzJmO3BhZGRpbmc6MTJweDtiYWNrZ3JvdW5kOnJnYmEoMjU1LDU5LDQ4LC4wOCk7Ym9yZGVyLXJhZGl1czo4cHgnO1xuICAgICAgZXJyRGl2LnRleHRDb250ZW50ID0gJ0Vycm9yIGxleWVuZG8gRXhjZWw6ICcgKyBtc2c7XG4gICAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoZXJyRGl2KTtcbiAgICB9XG4gICAgX2xvZ0V4cG9ydEVycm9yKCdpbXBvcnRfcmVhZCcsIG1zZyk7XG4gIH1cbn07XG5cbi8qKlxuICogQHBhcmFtIHthbnl9IHdzXG4gKiBAcmV0dXJucyB7T2JqZWN0PG51bWJlcixzdHJpbmc+fVxuICovXG5mdW5jdGlvbiBfYnVpbGRIZWFkZXJNYXAod3MpIHtcbiAgLyoqIEB0eXBlIHtPYmplY3Q8bnVtYmVyLHN0cmluZz59ICovXG4gIGNvbnN0IG91dCA9IHt9O1xuICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMSk7XG4gIGhlYWRlclJvdy5lYWNoQ2VsbCh7IGluY2x1ZGVFbXB0eTogZmFsc2UgfSwgKC8qKiBAdHlwZSB7YW55fSAqLyBjZWxsLCAvKiogQHR5cGUge251bWJlcn0gKi8gY29sKSA9PiB7XG4gICAgbGV0IHYgPSBjZWxsLnZhbHVlO1xuICAgIGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAndGV4dCcgaW4gdikgdiA9IHYudGV4dDtcbiAgICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgJ3Jlc3VsdCcgaW4gdikgdiA9IHYucmVzdWx0O1xuICAgIGNvbnN0IGxhYmVsID0gU3RyaW5nKHYgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghbGFiZWwpIHJldHVybjtcbiAgICBpZiAobGFiZWwgPT09ICdjb2RpZ28nIHx8IGxhYmVsID09PSAnY1x1MDBGM2RpZ28nKSBvdXRbY29sXSA9ICdDb2RpZ28nO1xuICAgIGVsc2UgaWYgKGxhYmVsID09PSAnY2xpZW50ZScpIG91dFtjb2xdID0gJ0NsaWVudGUnO1xuICAgIGVsc2UgaWYgKGxhYmVsID09PSAnYmFja29yZGVyJykgb3V0W2NvbF0gPSAnQmFja29yZGVyJztcbiAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ3N0b2NrIGRpc3BvbmlibGUnIHx8IGxhYmVsID09PSAnc3RvY2tfZGlzcG9uaWJsZScpIG91dFtjb2xdID0gJ1N0b2NrRGlzcG9uaWJsZSc7XG4gICAgZWxzZSBpZiAobGFiZWwgPT09ICdhc2lnbmFkbycpIG91dFtjb2xdID0gJ0FzaWduYWRvJztcbiAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ3Z1ZWx2ZSBhIGJhY2tvcmRlcicpIG91dFtjb2xdID0gJ1Z1ZWxlQUJhY2tvcmRlcic7XG4gICAgZWxzZSBpZiAobGFiZWwgPT09ICdlbGltaW5hcicpIG91dFtjb2xdID0gJ0VsaW1pbmFyJztcbiAgICBlbHNlIGlmIChsYWJlbCA9PT0gJ3JlcGFydG8gaWQnIHx8IGxhYmVsID09PSAncmVwYXJ0b2lkJyB8fCBsYWJlbCA9PT0gJ3JlcGFydG9faWQnKSBvdXRbY29sXSA9ICdSZXBhcnRvSWQnO1xuICAgIGVsc2UgaWYgKGxhYmVsID09PSAnY2FyZGNvZGUnIHx8IGxhYmVsID09PSAnY2FyZCBjb2RlJyB8fCBsYWJlbCA9PT0gJ2NhcmRfY29kZScpIG91dFtjb2xdID0gJ0NhcmRDb2RlJztcbiAgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ3JlYSB1biBkaXYgY29uIGNsYXNzL3N0eWxlL3RleHQgc2VndXJvcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdHlsZUNzc1xuICogQHBhcmFtIHtzdHJpbmd9IHRleHRWYWx1ZVxuICogQHJldHVybnMge0hUTUxEaXZFbGVtZW50fVxuICovXG5mdW5jdGlvbiBfbWtEaXYoc3R5bGVDc3MsIHRleHRWYWx1ZSkge1xuICBjb25zdCBkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGQuc3R5bGUuY3NzVGV4dCA9IHN0eWxlQ3NzO1xuICBpZiAodGV4dFZhbHVlICE9IG51bGwpIGQudGV4dENvbnRlbnQgPSB0ZXh0VmFsdWU7XG4gIHJldHVybiBkO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVySW1wb3J0UHJldmlldygpIHtcbiAgY29uc3QgcHJldmlld0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LXByZXZpZXcnKTtcbiAgY29uc3QgYXBwbHlCdG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJyk7XG4gIGlmICghcHJldmlld0VsIHx8ICFfaW1wb3J0U3RhdGUpIHJldHVybjtcbiAgY29uc3QgcyA9IF9pbXBvcnRTdGF0ZTtcbiAgd2hpbGUgKHByZXZpZXdFbC5maXJzdENoaWxkKSBwcmV2aWV3RWwucmVtb3ZlQ2hpbGQocHJldmlld0VsLmZpcnN0Q2hpbGQpO1xuXG4gIC8vIENoaXBzIGRlIHJlc3VtZW4uXG4gIGNvbnN0IGNoaXBzUm93ID0gX21rRGl2KCdkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7ZmxleC13cmFwOndyYXA7bWFyZ2luLWJvdHRvbToxNHB4JywgbnVsbCk7XG4gIGNvbnN0IGNoaXBSZWMgPSBfbWtEaXYoXG4gICAgJ2ZsZXg6MTttaW4td2lkdGg6MTQwcHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDpyZ2JhKDUyLDE5OSw4OSwuMTQpO2JvcmRlci1yYWRpdXM6OHB4O2NvbG9yOiMyNDhhM2QnLFxuICAgIG51bGxcbiAgKTtcbiAgY2hpcFJlYy5hcHBlbmRDaGlsZChcbiAgICBfbWtEaXYoJ2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOi41cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlJywgJ1JlY29ub2NpZGFzJylcbiAgKTtcbiAgY2hpcFJlYy5hcHBlbmRDaGlsZChfbWtEaXYoJ2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tdG9wOjJweCcsIFN0cmluZyhzLnJlY29ub2NpZGFzLmxlbmd0aCkpKTtcbiAgY2hpcHNSb3cuYXBwZW5kQ2hpbGQoY2hpcFJlYyk7XG4gIGNvbnN0IGNoaXBDYW1iID0gX21rRGl2KFxuICAgICdmbGV4OjE7bWluLXdpZHRoOjE0MHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6cmdiYSgwLDEyMiwyNTUsLjE0KTtib3JkZXItcmFkaXVzOjhweDtjb2xvcjojMDA0MGRkJyxcbiAgICBudWxsXG4gICk7XG4gIGNoaXBDYW1iLmFwcGVuZENoaWxkKF9ta0RpdignZm9udC1zaXplOjExcHg7bGV0dGVyLXNwYWNpbmc6LjVweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2UnLCAnQ29uIGNhbWJpb3MnKSk7XG4gIGNoaXBDYW1iLmFwcGVuZENoaWxkKF9ta0RpdignZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi10b3A6MnB4JywgU3RyaW5nKHMuY29uQ2FtYmlvcy5sZW5ndGgpKSk7XG4gIGNoaXBzUm93LmFwcGVuZENoaWxkKGNoaXBDYW1iKTtcbiAgY29uc3QgY2hpcEVyciA9IF9ta0RpdihcbiAgICAnZmxleDoxO21pbi13aWR0aDoxNDBweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgKHMuZXJyb3Jlcy5sZW5ndGggPyAncmdiYSgyNTUsNTksNDgsLjE0KScgOiAncmdiYSgxMjAsMTIwLDEyOCwuMDgpJykgK1xuICAgICAgJztib3JkZXItcmFkaXVzOjhweDtjb2xvcjonICtcbiAgICAgIChzLmVycm9yZXMubGVuZ3RoID8gJyNjNzM3MmYnIDogJyM2ZTZlNzMnKSxcbiAgICBudWxsXG4gICk7XG4gIGNoaXBFcnIuYXBwZW5kQ2hpbGQoX21rRGl2KCdmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzouNXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZScsICdFcnJvcmVzJykpO1xuICBjaGlwRXJyLmFwcGVuZENoaWxkKF9ta0RpdignZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi10b3A6MnB4JywgU3RyaW5nKHMuZXJyb3Jlcy5sZW5ndGgpKSk7XG4gIGNoaXBzUm93LmFwcGVuZENoaWxkKGNoaXBFcnIpO1xuICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoY2hpcHNSb3cpO1xuXG4gIGlmIChzLmVycm9yZXMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyQm94ID0gX21rRGl2KFxuICAgICAgJ3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6cmdiYSgyNTUsNTksNDgsLjA4KTtib3JkZXItbGVmdDozcHggc29saWQgI2M3MzcyZjtib3JkZXItcmFkaXVzOjZweDttYXJnaW4tYm90dG9tOjEycHgnLFxuICAgICAgbnVsbFxuICAgICk7XG4gICAgZXJyQm94LmFwcGVuZENoaWxkKFxuICAgICAgX21rRGl2KFxuICAgICAgICAnZm9udC13ZWlnaHQ6NzAwO2NvbG9yOiNjNzM3MmY7bWFyZ2luLWJvdHRvbTo2cHgnLFxuICAgICAgICAnSGF5ICcgKyBzLmVycm9yZXMubGVuZ3RoICsgJyBlcnJvcihlcykuIENvcnJlZ2lsb3MgeSB2b2x2XHUwMEU5IGEgc3ViaXIgZWwgRXhjZWwuIE5vIHNlIGFwbGljYSBuYWRhLidcbiAgICAgIClcbiAgICApO1xuICAgIGNvbnN0IHVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndWwnKTtcbiAgICB1bC5zdHlsZS5jc3NUZXh0ID0gJ21hcmdpbjowO3BhZGRpbmctbGVmdDoxOHB4O2NvbG9yOiMxZDFkMWY7Zm9udC1zaXplOjEyLjVweDtsaW5lLWhlaWdodDoxLjUnO1xuICAgIGNvbnN0IHNsaWNlID0gcy5lcnJvcmVzLnNsaWNlKDAsIDUwKTtcbiAgICBmb3IgKGNvbnN0IGUgb2Ygc2xpY2UpIHtcbiAgICAgIGNvbnN0IGxpID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGknKTtcbiAgICAgIGxpLnRleHRDb250ZW50ID0gZS5tc2c7XG4gICAgICB1bC5hcHBlbmRDaGlsZChsaSk7XG4gICAgfVxuICAgIGVyckJveC5hcHBlbmRDaGlsZCh1bCk7XG4gICAgaWYgKHMuZXJyb3Jlcy5sZW5ndGggPiA1MCkge1xuICAgICAgZXJyQm94LmFwcGVuZENoaWxkKFxuICAgICAgICBfbWtEaXYoXG4gICAgICAgICAgJ2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjExcHg7bWFyZ2luLXRvcDo0cHgnLFxuICAgICAgICAgICcuLi55ICcgKyAocy5lcnJvcmVzLmxlbmd0aCAtIDUwKSArICcgbVx1MDBFMXMgKHZlciBjb25zb2xhKSdcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG4gICAgcHJldmlld0VsLmFwcGVuZENoaWxkKGVyckJveCk7XG4gIH1cblxuICBpZiAoIXMuZXJyb3Jlcy5sZW5ndGggJiYgcy5jb25DYW1iaW9zLmxlbmd0aCkge1xuICAgIHByZXZpZXdFbC5hcHBlbmRDaGlsZChcbiAgICAgIF9ta0RpdihcbiAgICAgICAgJ3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6cmdiYSg1MiwxOTksODksLjA4KTtib3JkZXItcmFkaXVzOjZweDttYXJnaW4tYm90dG9tOjEycHg7Zm9udC1zaXplOjEzcHgnLFxuICAgICAgICAnUmVzdW1lbiBhIGFwbGljYXI6ICcgK1xuICAgICAgICAgIHMuY29uQ2FtYmlvcy5sZW5ndGggK1xuICAgICAgICAgICcgY2FtYmlvKHMpIFx1MDBCNyAnICtcbiAgICAgICAgICBzLnRvdGFsQXNpZ25hZG8gK1xuICAgICAgICAgICcgdSBhc2lnbmFkYXMgXHUwMEI3ICcgK1xuICAgICAgICAgIHMudG90YWxFbGltaW5hciArXG4gICAgICAgICAgJyB1IGVsaW1pbmFkYXMnXG4gICAgICApXG4gICAgKTtcbiAgICAvLyBUYWJsYSBwcmV2aWV3LlxuICAgIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGFibGUnKTtcbiAgICB0YWJsZS5zdHlsZS5jc3NUZXh0ID0gJ3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4JztcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoZWFkJyk7XG4gICAgY29uc3QgdHJoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgICB0cmguc3R5bGUuY3NzVGV4dCA9ICdiYWNrZ3JvdW5kOiNmNWY1ZjcnO1xuICAgIGZvciAoY29uc3QgaCBvZiBbJ1NLVScsICdDbGllbnRlJywgJ0JPJywgJ0FzaWcuJywgJ0VsaW0uJ10pIHtcbiAgICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcbiAgICAgIHRoLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHg7dGV4dC1hbGlnbjonICsgKGggPT09ICdTS1UnIHx8IGggPT09ICdDbGllbnRlJyA/ICdsZWZ0JyA6ICdyaWdodCcpO1xuICAgICAgdGgudGV4dENvbnRlbnQgPSBoO1xuICAgICAgdHJoLmFwcGVuZENoaWxkKHRoKTtcbiAgICB9XG4gICAgdGhlYWQuYXBwZW5kQ2hpbGQodHJoKTtcbiAgICB0YWJsZS5hcHBlbmRDaGlsZCh0aGVhZCk7XG4gICAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0Ym9keScpO1xuICAgIGNvbnN0IHByZXZpZXdSb3dzID0gcy5jb25DYW1iaW9zLnNsaWNlKDAsIDMwKTtcbiAgICBmb3IgKGNvbnN0IHIgb2YgcHJldmlld1Jvd3MpIHtcbiAgICAgIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgICAgIHRyLnN0eWxlLmNzc1RleHQgPSAnYm9yZGVyLWJvdHRvbToxcHggc29saWQgI2VlZSc7XG4gICAgICBjb25zdCBhZGRUZCA9ICgvKiogQHR5cGUge3N0cmluZ30gKi8gdHh0LCAvKiogQHR5cGUge3N0cmluZ30gKi8gY3NzKSA9PiB7XG4gICAgICAgIGNvbnN0IHRkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgICAgICAgdGQuc3R5bGUuY3NzVGV4dCA9IGNzcztcbiAgICAgICAgdGQudGV4dENvbnRlbnQgPSB0eHQ7XG4gICAgICAgIHRyLmFwcGVuZENoaWxkKHRkKTtcbiAgICAgIH07XG4gICAgICBhZGRUZChyLnNrdSwgJ3BhZGRpbmc6NHB4IDZweDtmb250LWZhbWlseTptb25vc3BhY2UnKTtcbiAgICAgIGFkZFRkKHIuY2xpZW50TmFtZSwgJ3BhZGRpbmc6NHB4IDZweCcpO1xuICAgICAgYWRkVGQoU3RyaW5nKHIuYmFja29yZGVyQWN0dWFsKSwgJ3BhZGRpbmc6NHB4IDZweDt0ZXh0LWFsaWduOnJpZ2h0Jyk7XG4gICAgICBhZGRUZChcbiAgICAgICAgci5hc2lnbmFkb051ZXZvID8gU3RyaW5nKHIuYXNpZ25hZG9OdWV2bykgOiAnJyxcbiAgICAgICAgJ3BhZGRpbmc6NHB4IDZweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOiMyNDhhM2Q7Zm9udC13ZWlnaHQ6NjAwJ1xuICAgICAgKTtcbiAgICAgIGFkZFRkKFxuICAgICAgICByLmVsaW1pbmFyTnVldm8gPyBTdHJpbmcoci5lbGltaW5hck51ZXZvKSA6ICcnLFxuICAgICAgICAncGFkZGluZzo0cHggNnB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6I2M3MzcyZjtmb250LXdlaWdodDo2MDAnXG4gICAgICApO1xuICAgICAgdGJvZHkuYXBwZW5kQ2hpbGQodHIpO1xuICAgIH1cbiAgICB0YWJsZS5hcHBlbmRDaGlsZCh0Ym9keSk7XG4gICAgcHJldmlld0VsLmFwcGVuZENoaWxkKHRhYmxlKTtcbiAgICBpZiAocy5jb25DYW1iaW9zLmxlbmd0aCA+IDMwKSB7XG4gICAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoXG4gICAgICAgIF9ta0RpdignY29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTFweDttYXJnaW4tdG9wOjRweCcsICcuLi55ICcgKyAocy5jb25DYW1iaW9zLmxlbmd0aCAtIDMwKSArICcgbVx1MDBFMXMnKVxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXMuZXJyb3Jlcy5sZW5ndGggJiYgIXMuY29uQ2FtYmlvcy5sZW5ndGgpIHtcbiAgICBwcmV2aWV3RWwuYXBwZW5kQ2hpbGQoXG4gICAgICBfbWtEaXYoXG4gICAgICAgICdwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnJnYmEoMjU1LDIwNCwwLC4xNCk7Ym9yZGVyLXJhZGl1czo2cHg7Y29sb3I6IzhhNmQwMCcsXG4gICAgICAgICdFbCBFeGNlbCBubyB0aWVuZSBjYW1iaW9zIChBc2lnbmFkbz0wIHkgRWxpbWluYXI9MCBlbiB0b2RhcyBsYXMgZmlsYXMpLiBOYWRhIHF1ZSBhcGxpY2FyLidcbiAgICAgIClcbiAgICApO1xuICB9XG5cbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgY29uc3QgY2FuQXBwbHkgPSBzLmVycm9yZXMubGVuZ3RoID09PSAwICYmIHMuY29uQ2FtYmlvcy5sZW5ndGggPiAwO1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLmRpc2FibGVkID0gIWNhbkFwcGx5O1xuICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoYXBwbHlCdG4pLnN0eWxlLm9wYWNpdHkgPSBjYW5BcHBseSA/ICcxJyA6ICcwLjQnO1xuICB9XG59XG5cbndpbmRvdy5jb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICBpZiAoIV9pbXBvcnRTdGF0ZSB8fCBfaW1wb3J0U3RhdGUuY29uQ2FtYmlvcy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgaWYgKF9pbXBvcnRTdGF0ZS5lcnJvcmVzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBzZSBwdWVkZSBhcGxpY2FyOiBoYXkgZXJyb3JlcyBlbiBsYSB2aXN0YSBwcmV2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghX2lzQWRtaW5MaWtlRm9ySW1wb3J0KCkpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgYXBsaWNhciByZXBhcnRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhcHBseUJ0biA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taW1wb3J0LWFwcGx5LWJ0bicpKTtcbiAgaWYgKGFwcGx5QnRuKSB7XG4gICAgYXBwbHlCdG4uZGlzYWJsZWQgPSB0cnVlO1xuICAgIGFwcGx5QnRuLnRleHRDb250ZW50ID0gJ0FwbGljYW5kb1x1MjAyNic7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUucmVwYXJ0b0V4Y2VsSW1wb3J0O1xuICAgIGNvbnN0IGdyb3VwcyA9IHZhbGlkYXRvci5ncm91cEltcG9ydE1hdGNoZXNCeVJlcGFydG8oX2ltcG9ydFN0YXRlLmNvbkNhbWJpb3MpO1xuICAgIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG5cbiAgICBjb25zdCBjYWxsYWJsZSA9IHcuZmlyZWJhc2VcbiAgICAgIC5hcHAoKVxuICAgICAgLmZ1bmN0aW9ucygnc291dGhhbWVyaWNhLWVhc3QxJylcbiAgICAgIC5odHRwc0NhbGxhYmxlKCdhcHBseVJlcGFydG9NYW51YWxDRicpO1xuICAgIGxldCBva0NvdW50ID0gMDtcbiAgICBsZXQgZmFpbENvdW50ID0gMDtcbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdO1xuICAgIGxldCB0b3RhbEFzaWduYWNpb25lc0FwbGljYWRhcyA9IDA7XG4gICAgbGV0IHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGcgb2YgZ3JvdXBzKSB7XG4gICAgICBjb25zdCBpbmcgPSBpbmdyZXNvcy5maW5kKCgvKiogQHR5cGUge2FueX0gKi8gaSkgPT4gaS5faWQgPT09IGcucmVwYXJ0b0lkKTtcbiAgICAgIGlmICghaW5nKSB7XG4gICAgICAgIGZhaWxDb3VudCsrO1xuICAgICAgICBmYWlsdXJlcy5wdXNoKCdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgeWEgbm8gZXhpc3RlJyk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgY2xpZW50ZXMgPSBBcnJheS5pc0FycmF5KGluZy5jbGllbnRlc0JPKSA/IGluZy5jbGllbnRlc0JPIDogW107XG4gICAgICAvKiogQHR5cGUge0FycmF5PGFueT59ICovXG4gICAgICBjb25zdCBhc3NpZ25tZW50cyA9IFtdO1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICAgICAgY29uc3QgZWxpbWluYXRpb25zID0gW107XG4gICAgICBmb3IgKGNvbnN0IGEgb2YgZy5hc3NpZ25tZW50cykge1xuICAgICAgICBjb25zdCBjID0gY2xpZW50ZXMuZmluZChcbiAgICAgICAgICAoLyoqIEB0eXBlIHthbnl9ICovIHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoKHguY2xpZW50Q2FyZENvZGUgfHwgeC5jYXJkQ29kZSB8fCAnJykpLnRvVXBwZXJDYXNlKCkudHJpbSgpID09PVxuICAgICAgICAgICAgU3RyaW5nKGEuY2FyZENvZGUpLnRvVXBwZXJDYXNlKCkudHJpbSgpXG4gICAgICAgICk7XG4gICAgICAgIGlmICghYykge1xuICAgICAgICAgIGZhaWx1cmVzLnB1c2goJ1JlcGFydG8gJyArIGcucmVwYXJ0b0lkICsgJyAvIENhcmRDb2RlICcgKyBhLmNhcmRDb2RlICsgJyB5YSBubyBlc3RcdTAwRTEgZW4gQk8nKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBhc3NpZ25tZW50cy5wdXNoKHtcbiAgICAgICAgICBwZWRpZG9JZDogYy5wZWRpZG9JZCxcbiAgICAgICAgICBsaW5lSW5kZXg6IE51bWJlcihjLmxpbmVJbmRleCkgfHwgMCxcbiAgICAgICAgICBxdHlBc2lnbmFkYTogYS5xdHlBc2lnbmFkYSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgZy5lbGltaW5hdGlvbnMpIHtcbiAgICAgICAgY29uc3QgYyA9IGNsaWVudGVzLmZpbmQoXG4gICAgICAgICAgKC8qKiBAdHlwZSB7YW55fSAqLyB4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKCh4LmNsaWVudENhcmRDb2RlIHx8IHguY2FyZENvZGUgfHwgJycpKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSA9PT1cbiAgICAgICAgICAgIFN0cmluZyhlLmNhcmRDb2RlKS50b1VwcGVyQ2FzZSgpLnRyaW0oKVxuICAgICAgICApO1xuICAgICAgICBpZiAoIWMpIHtcbiAgICAgICAgICBmYWlsdXJlcy5wdXNoKCdSZXBhcnRvICcgKyBnLnJlcGFydG9JZCArICcgLyBDYXJkQ29kZSAnICsgZS5jYXJkQ29kZSArICcgeWEgbm8gZXN0XHUwMEUxIGVuIEJPJyk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZWxpbWluYXRpb25zLnB1c2goe1xuICAgICAgICAgIHBlZGlkb0lkOiBjLnBlZGlkb0lkLFxuICAgICAgICAgIGxpbmVJbmRleDogTnVtYmVyKGMubGluZUluZGV4KSB8fCAwLFxuICAgICAgICAgIHF0eUVsaW1pbmFyOiBlLnF0eUVsaW1pbmFyLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghYXNzaWdubWVudHMubGVuZ3RoICYmICFlbGltaW5hdGlvbnMubGVuZ3RoKSBjb250aW51ZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKHtcbiAgICAgICAgICBpbmdyZXNvSWQ6IGcucmVwYXJ0b0lkLFxuICAgICAgICAgIGFzc2lnbm1lbnRzLFxuICAgICAgICAgIGVsaW1pbmF0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHIgPSByZXMuZGF0YSB8fCB7fTtcbiAgICAgICAgaWYgKHIub2spIHtcbiAgICAgICAgICBva0NvdW50Kys7XG4gICAgICAgICAgdG90YWxBc2lnbmFjaW9uZXNBcGxpY2FkYXMgKz0gYXNzaWdubWVudHMubGVuZ3RoO1xuICAgICAgICAgIHRvdGFsRWxpbWluYWNpb25lc0FwbGljYWRhcyArPSBlbGltaW5hdGlvbnMubGVuZ3RoO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZhaWxDb3VudCsrO1xuICAgICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgICBnLnJlcGFydG9JZCArICcgKCcgKyBnLnNrdSArICcpOiAnICsgKChyLmVycm9ycyB8fCBbXSkuam9pbignOyAnKSB8fCAnZXJyb3IgZGVzY29ub2NpZG8nKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGNhbGxFcnIpIHtcbiAgICAgICAgZmFpbENvdW50Kys7XG4gICAgICAgIGZhaWx1cmVzLnB1c2goXG4gICAgICAgICAgZy5yZXBhcnRvSWQgK1xuICAgICAgICAgICAgJyAoJyArXG4gICAgICAgICAgICBnLnNrdSArXG4gICAgICAgICAgICAnKTogJyArXG4gICAgICAgICAgICAoKGNhbGxFcnIgJiYgLyoqIEB0eXBlIHthbnl9ICovIChjYWxsRXJyKS5tZXNzYWdlKSB8fCBTdHJpbmcoY2FsbEVycikpXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh3LmZiRGIgJiYgdHlwZW9mIHcuZmJEYi5jb2xsZWN0aW9uID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGF3YWl0IHcuZmJEYi5jb2xsZWN0aW9uKCdyZXBhcnRvX2xvZycpLmFkZCh7XG4gICAgICAgICAgb3JpZ2VuOiAnaW1wb3J0JyxcbiAgICAgICAgICBmaWxlTmFtZTogX2ltcG9ydFN0YXRlLmZpbGVOYW1lLFxuICAgICAgICAgIGltcG9ydGVkQnlVaWQ6ICh3LmN1cnJlbnRVc2VyICYmIHcuY3VycmVudFVzZXIudWlkKSB8fCBudWxsLFxuICAgICAgICAgIGltcG9ydGVkQnlFbWFpbDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgbnVsbCxcbiAgICAgICAgICByb3dzQ291bnQ6IF9pbXBvcnRTdGF0ZS50b3RhbEZpbGFzLFxuICAgICAgICAgIGFzc2lnbm1lbnRzQ291bnQ6IHRvdGFsQXNpZ25hY2lvbmVzQXBsaWNhZGFzLFxuICAgICAgICAgIGVsaW1pbmF0aW9uc0NvdW50OiB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMsXG4gICAgICAgICAgcmVwYXJ0b3NQcm9jZXNhZG9zOiBncm91cHMubGVuZ3RoLFxuICAgICAgICAgIG9rQ291bnQsXG4gICAgICAgICAgZmFpbENvdW50LFxuICAgICAgICAgIGltcG9ydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGxvZ0Vycikge1xuICAgICAgY29uc29sZS53YXJuKCdbdjE1MDVdIHJlcGFydG9fbG9nIG9yaWdlbj1pbXBvcnQgd3JpdGUgZmFpbGVkJywgbG9nRXJyKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdW1tYXJ5ID1cbiAgICAgIHRvdGFsQXNpZ25hY2lvbmVzQXBsaWNhZGFzICtcbiAgICAgICcgYXNpZ25hY2lvbmVzIGFwbGljYWRhcyBcdTAwQjcgJyArXG4gICAgICB0b3RhbEVsaW1pbmFjaW9uZXNBcGxpY2FkYXMgK1xuICAgICAgJyBlbGltaW5hY2lvbmVzIGFwbGljYWRhcycgK1xuICAgICAgKGZhaWxDb3VudFxuICAgICAgICA/ICdcXG5cXG5SZXBhcnRvcyBjb24gZXJyb3IgKCcgKyBmYWlsQ291bnQgKyAnKTpcXG4nICsgZmFpbHVyZXMuc2xpY2UoMCwgNSkuam9pbignXFxuJylcbiAgICAgICAgOiAnJyk7XG4gICAgYWxlcnQoc3VtbWFyeSk7XG4gICAgaWYgKG9rQ291bnQgPiAwKSBfc3luY1RhZygnSW1wb3J0IFJlcGFydG8gYXBsaWNhZG8gXHUwMEI3ICcgKyBva0NvdW50ICsgJyByZXBhcnRvKHMpJywgMzIwMCk7XG4gICAgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgJiYgdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2coKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IChlICYmIC8qKiBAdHlwZSB7YW55fSAqLyAoZSkubWVzc2FnZSkgfHwgU3RyaW5nKGUpO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1t2MTUwNSBcdTAwQTdSZXBhcnRvXSBjb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5IGVycm9yOicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBhcGxpY2FuZG8gaW1wb3J0OiAnICsgbXNnKTtcbiAgICBfbG9nRXhwb3J0RXJyb3IoJ2ltcG9ydF9hcHBseScsIG1zZyk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGFwcGx5QnRuKSB7XG4gICAgICBhcHBseUJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgICAgYXBwbHlCdG4udGV4dENvbnRlbnQgPSAnQXBsaWNhciByZXBhcnRvIGltcG9ydGFkbyc7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIENvbnN0cnV5ZSBlbCBtb2RhbCBET00gdmlhIGhlbHBlcnMgc2VndXJvcyAoc2luIGlubmVySFRNTCBjb24gY29udGVuaWRvXG4gKiBkaW5cdTAwRTFtaWNvIFx1MjAxNCBlbCBET00gZXMgZXN0XHUwMEUxdGljbykuIFByaW1lcmEgYXBlcnR1cmEgY2FjaGVhLlxuICogQHJldHVybnMge0hUTUxFbGVtZW50fVxuICovXG5mdW5jdGlvbiBfYnVpbGRJbXBvcnRNb2RhbERvbSgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbW9kYWwuaWQgPSAncmVwYXJ0by1pbXBvcnQtbW9kYWwnO1xuICBtb2RhbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIG1vZGFsLnN0eWxlLmNzc1RleHQgPSAnZGlzcGxheTpub25lO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyJztcbiAgbW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXYpID0+IHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBtb2RhbCkge1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gICAgfVxuICB9KTtcbiAgY29uc3QgYm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGJveC5jbGFzc05hbWUgPSAnbW9kYWwtYm94JztcbiAgYm94LnN0eWxlLmNzc1RleHQgPVxuICAgICd3aWR0aDptaW4oNzYwcHgsOTZ2dyk7bWF4LWhlaWdodDo5MHZoO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47YmFja2dyb3VuZDojZmZmO2JvcmRlci1yYWRpdXM6MTRweDtvdmVyZmxvdzpoaWRkZW4nO1xuICAvLyBIZWFkZXIuXG4gIGNvbnN0IGhlYWQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgaGVhZC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzoxOHB4IDIycHg7Ym9yZGVyLWJvdHRvbTowLjVweCBzb2xpZCByZ2JhKDAsMCwwLC4wOCk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweCc7XG4gIGNvbnN0IGhlYWRUaXRsZVdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgaGVhZFRpdGxlV3JhcC5zdHlsZS5jc3NUZXh0ID0gJ2ZsZXg6MSc7XG4gIGNvbnN0IGgyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaDInKTtcbiAgaDIuc3R5bGUuY3NzVGV4dCA9ICdtYXJnaW46MCAwIDJweDtmb250LXNpemU6MThweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LTAuNHB4JztcbiAgaDIudGV4dENvbnRlbnQgPSAnSW1wb3J0YXIgcmVwYXJ0byBkZXNkZSBFeGNlbCc7XG4gIGhlYWRUaXRsZVdyYXAuYXBwZW5kQ2hpbGQoaDIpO1xuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHN1YnQuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTIuNXB4O2NvbG9yOiM4Njg2OGInO1xuICBzdWJ0LnRleHRDb250ZW50ID0gJ1N1Ylx1MDBFRCBlbCBFeGNlbCBlZGl0YWRvIG9mZmxpbmUuIFNlIHZhbGlkYSBmaWxhIHBvciBmaWxhIGFudGVzIGRlIGFwbGljYXIuJztcbiAgaGVhZFRpdGxlV3JhcC5hcHBlbmRDaGlsZChzdWJ0KTtcbiAgaGVhZC5hcHBlbmRDaGlsZChoZWFkVGl0bGVXcmFwKTtcbiAgY29uc3QgY2xvc2VCdG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgY2xvc2VCdG4udHlwZSA9ICdidXR0b24nO1xuICBjbG9zZUJ0bi50ZXh0Q29udGVudCA9ICdcdTAwRDcnO1xuICBjbG9zZUJ0bi5zdHlsZS5jc3NUZXh0ID1cbiAgICAnYm9yZGVyOm5vbmU7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xMik7d2lkdGg6MzBweDtoZWlnaHQ6MzBweDtib3JkZXItcmFkaXVzOjUwJTtjdXJzb3I6cG9pbnRlcjtjb2xvcjojNmU2ZTczO2ZvbnQtc2l6ZToxNnB4JztcbiAgY2xvc2VCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICBpZiAodHlwZW9mIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nID09PSAnZnVuY3Rpb24nKSB3LmNsb3NlUmVwYXJ0b0ltcG9ydERpYWxvZygpO1xuICB9KTtcbiAgaGVhZC5hcHBlbmRDaGlsZChjbG9zZUJ0bik7XG4gIGJveC5hcHBlbmRDaGlsZChoZWFkKTtcbiAgLy8gQm9keS5cbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBib2R5LnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzoxNnB4IDIycHg7ZmxleDoxO292ZXJmbG93LXk6YXV0bzttaW4taGVpZ2h0OjAnO1xuICBjb25zdCBmaWxlSW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xuICBmaWxlSW5wdXQudHlwZSA9ICdmaWxlJztcbiAgZmlsZUlucHV0LmlkID0gJ3JlcGFydG8taW1wb3J0LWZpbGUnO1xuICBmaWxlSW5wdXQuYWNjZXB0ID0gJy54bHN4JztcbiAgZmlsZUlucHV0LnN0eWxlLmNzc1RleHQgPSAnbWFyZ2luLWJvdHRvbToxNHB4JztcbiAgZmlsZUlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIChldikgPT4ge1xuICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgaWYgKHR5cGVvZiB3LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlID09PSAnZnVuY3Rpb24nKSB3LmhhbmRsZVJlcGFydG9JbXBvcnRGaWxlQ2hhbmdlKGV2KTtcbiAgfSk7XG4gIGJvZHkuYXBwZW5kQ2hpbGQoZmlsZUlucHV0KTtcbiAgY29uc3QgcHJldmlld0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBwcmV2aWV3RGl2LmlkID0gJ3JlcGFydG8taW1wb3J0LXByZXZpZXcnO1xuICBwcmV2aWV3RGl2LnN0eWxlLmNzc1RleHQgPSAnbWluLWhlaWdodDo0MHB4JztcbiAgYm9keS5hcHBlbmRDaGlsZChwcmV2aWV3RGl2KTtcbiAgYm94LmFwcGVuZENoaWxkKGJvZHkpO1xuICAvLyBGb290ZXIuXG4gIGNvbnN0IGZvb3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZm9vdC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzoxNHB4IDIycHg7Ym9yZGVyLXRvcDowLjVweCBzb2xpZCByZ2JhKDAsMCwwLC4wOCk7ZGlzcGxheTpmbGV4O2dhcDoxMHB4O2p1c3RpZnktY29udGVudDpmbGV4LWVuZCc7XG4gIGNvbnN0IGNhbmNlbEJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICBjYW5jZWxCdG4udHlwZSA9ICdidXR0b24nO1xuICBjYW5jZWxCdG4udGV4dENvbnRlbnQgPSAnQ2FuY2VsYXInO1xuICBjYW5jZWxCdG4uc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6OXB4IDE4cHg7Ym9yZGVyOjAuNXB4IHNvbGlkIHJnYmEoMCwwLDAsLjEyKTtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czo5OTlweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweCc7XG4gIGNhbmNlbEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICh0eXBlb2Ygdy5jbG9zZVJlcGFydG9JbXBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VSZXBhcnRvSW1wb3J0RGlhbG9nKCk7XG4gIH0pO1xuICBmb290LmFwcGVuZENoaWxkKGNhbmNlbEJ0bik7XG4gIGNvbnN0IGFwcGx5QnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gIGFwcGx5QnRuLnR5cGUgPSAnYnV0dG9uJztcbiAgYXBwbHlCdG4uaWQgPSAncmVwYXJ0by1pbXBvcnQtYXBwbHktYnRuJztcbiAgYXBwbHlCdG4uZGlzYWJsZWQgPSB0cnVlO1xuICBhcHBseUJ0bi50ZXh0Q29udGVudCA9ICdBcGxpY2FyIHJlcGFydG8gaW1wb3J0YWRvJztcbiAgYXBwbHlCdG4uc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6OXB4IDE4cHg7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDojMjQ4YTNkO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo5OTlweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo2MDA7b3BhY2l0eTowLjQnO1xuICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgIGlmICh0eXBlb2Ygdy5jb25maXJtUmVwYXJ0b0ltcG9ydEFwcGx5ID09PSAnZnVuY3Rpb24nKSB3LmNvbmZpcm1SZXBhcnRvSW1wb3J0QXBwbHkoKTtcbiAgfSk7XG4gIGZvb3QuYXBwZW5kQ2hpbGQoYXBwbHlCdG4pO1xuICBib3guYXBwZW5kQ2hpbGQoZm9vdCk7XG4gIG1vZGFsLmFwcGVuZENoaWxkKGJveCk7XG4gIHJldHVybiBtb2RhbDtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQXlCQSxpQkFBZSxpQkFBaUI7QUFDOUIsVUFBTTtBQUFBO0FBQUEsTUFBd0I7QUFBQTtBQUM5QixRQUFJLE9BQU8sRUFBRSxnQkFBZ0IsV0FBWSxPQUFNLEVBQUUsWUFBWTtBQUM3RCxRQUFJLENBQUMsRUFBRSxRQUFTLE9BQU0sSUFBSSxNQUFNLHVCQUF1QjtBQUFBLEVBQ3pEO0FBTUEsV0FBUyxTQUFTLEtBQUssSUFBSTtBQUN6QixVQUFNO0FBQUE7QUFBQSxNQUF3QjtBQUFBO0FBQzlCLFFBQUksT0FBTyxFQUFFLGdCQUFnQixZQUFZO0FBQ3ZDLFVBQUk7QUFDRixVQUFFLFlBQVksS0FBSyxFQUFFO0FBQUEsTUFDdkIsU0FBUyxJQUFJO0FBQUEsTUFFYjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBTUEsV0FBUyxnQkFBZ0IsS0FBSztBQUM1QixVQUFNO0FBQUE7QUFBQSxNQUF3QjtBQUFBO0FBQzlCLFFBQUksT0FBTyxFQUFFLDRCQUE0QixXQUFZLFFBQU87QUFDNUQsUUFB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
