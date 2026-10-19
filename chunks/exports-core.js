"use strict";
(() => {
  // src/domains/exports-core.js
  window.exportMasterClientes = async function() {
    if (!POINTS || !POINTS.length) {
      alert("No hay datos cargados todavia.");
      return;
    }
    showSyncTag("Generando masterfile de clientes...");
    const scopeSet = typeof getEffectiveVendorSet === "function" ? getEffectiveVendorSet(typeof currentVendor !== "undefined" ? currentVendor : "ALL") : null;
    const inScope = (vendorKey) => {
      if (scopeSet === null) return true;
      if (!vendorKey) return false;
      return scopeSet.has(vendorKey);
    };
    const VDE_TO_VDI = {
      "FEDERICO CASTELANELLI": "IOANNIS PALKOUDAKIS",
      "GONZALO DE LA ROSA": "IOANNIS PALKOUDAKIS",
      "MAURICIO GIL": "SANTIAGO ESTEBAN",
      PACHI: "SANTIAGO ESTEBAN"
    };
    function lookupZone(vendorKey) {
      const v = typeof VENDORS !== "undefined" ? VENDORS.find((vv) => vv.key === vendorKey) : null;
      return v ? v.zone : "";
    }
    function lookupVendorLabel(vendorKey) {
      const v = typeof VENDORS !== "undefined" ? VENDORS.find((vv) => vv.key === vendorKey) : null;
      return v ? v.label : vendorKey || "";
    }
    const CLASSIF_FIELDS = [
      "tipo",
      "local",
      "tamano",
      "fidelidad",
      "especializacion",
      "canalCompra",
      "relevancia",
      "pop",
      "necesidadPuntual",
      "tipoVenta",
      "ponderacionMostrado",
      "ponderacionEcommerce",
      "competencia",
      "oportunidad",
      "masVendido",
      "masPreguntan",
      "ayudaTienda"
    ];
    function _classifKey(prov, loc, tienda) {
      return (prov || "").toString().toUpperCase().trim() + "|" + (loc || "").toString().trim() + "|" + (tienda || "").toString().trim();
    }
    function _classifTs(v) {
      if (v && v.createdAt && v.createdAt.toMillis) return v.createdAt.toMillis();
      if (v && v.fecha) return new Date(v.fecha).getTime() || 0;
      return 0;
    }
    const classifIndex = /* @__PURE__ */ new Map();
    if (typeof visitsCache !== "undefined" && Array.isArray(visitsCache)) {
      const byKey = /* @__PURE__ */ new Map();
      visitsCache.forEach((v) => {
        if (!v) return;
        const k = _classifKey(v.provincia, v.localidad, v.tienda);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(v);
      });
      byKey.forEach((arr, k) => {
        arr.sort((a, b) => _classifTs(b) - _classifTs(a));
        const merged = {};
        arr.forEach((v) => {
          CLASSIF_FIELDS.forEach((f) => {
            if (merged[f] != null && merged[f] !== "" && merged[f] !== 0) return;
            const val = v[f];
            if (val != null && val !== "") merged[f] = val;
          });
        });
        const latest = arr[0] || {};
        classifIndex.set(k, {
          merged,
          lastFecha: latest.fecha || "",
          lastType: latest.interactionType || (latest.espacio ? "visita" : ""),
          visitas: arr.filter((v) => v.interactionType !== "contacto").length,
          contactos: arr.filter((v) => v.interactionType === "contacto").length
        });
      });
    }
    function _classifRow(prov, loc, tienda) {
      const entry = classifIndex.get(_classifKey(prov, loc, tienda));
      if (!entry) {
        return {
          "Ultima interaccion": "",
          "Tipo ultima interaccion": "",
          "Total visitas": 0,
          "Total contactos": 0,
          "Tipo comercio": "",
          Local: "",
          Tamano: "",
          Fidelidad: "",
          Especializacion: "",
          "Canal de compra": "",
          Relevancia: "",
          POP: "",
          "Necesidad puntual": "",
          "Tipo de venta": "",
          "Ponderacion mostrador (%)": "",
          "Ponderacion e-commerce (%)": "",
          Competencia: "",
          Oportunidad: "",
          "Mas vendido": "",
          "Mas preguntan": "",
          "Ayuda tienda": ""
        };
      }
      const m = entry.merged || {};
      return {
        "Ultima interaccion": entry.lastFecha,
        "Tipo ultima interaccion": entry.lastType,
        "Total visitas": entry.visitas,
        "Total contactos": entry.contactos,
        "Tipo comercio": m.tipo || "",
        Local: m.local || "",
        Tamano: m.tamano || "",
        Fidelidad: m.fidelidad || "",
        Especializacion: m.especializacion || "",
        "Canal de compra": m.canalCompra || "",
        Relevancia: m.relevancia != null ? m.relevancia : "",
        POP: m.pop || "",
        "Necesidad puntual": m.necesidadPuntual || "",
        "Tipo de venta": m.tipoVenta || "",
        "Ponderacion mostrador (%)": m.ponderacionMostrado != null ? m.ponderacionMostrado : "",
        "Ponderacion e-commerce (%)": m.ponderacionEcommerce != null ? m.ponderacionEcommerce : "",
        Competencia: m.competencia || "",
        Oportunidad: m.oportunidad || "",
        "Mas vendido": m.masVendido || "",
        "Mas preguntan": m.masPreguntan || "",
        "Ayuda tienda": m.ayudaTienda || ""
      };
    }
    const rows = [];
    POINTS.forEach((p) => {
      const province = p.province || "";
      const localityMap = p.name || "";
      const dept = p.dept || "";
      const vendor = p.vendor || "";
      if (!inScope(vendor)) return;
      const zone = lookupZone(vendor);
      const vdi = VDE_TO_VDI[vendor] || "";
      const lat = p.lat != null ? p.lat : "";
      const lon = p.lon != null ? p.lon : "";
      (p.clients || []).forEach((name) => {
        if (!name) return;
        if (typeof isSapConfirmed !== "function" || !isSapConfirmed(province, localityMap, name))
          return;
        const k = "C|" + province + "|" + localityMap + "|" + name;
        let estado = "Habilitado";
        if (typeof canceled !== "undefined" && canceled && canceled.has && canceled.has(k))
          estado = "Cancelado";
        const meta = typeof clientMeta !== "undefined" && clientMeta ? clientMeta[k] || {} : {};
        const customName = meta.customName || "";
        const docId = typeof clientLocId === "function" ? clientLocId(province, localityMap, name) : "";
        const cmData = typeof clientMasterCache !== "undefined" && docId ? clientMasterCache.get(docId) || {} : {};
        const address = cmData.address || meta.address || "";
        const localityCust = cmData.localidad || meta.locality || "";
        const customLat = meta.lat != null ? meta.lat : "";
        const customLng = meta.lng != null ? meta.lng : "";
        let cardCode = cmData.sapCardCode || "";
        if (!cardCode && typeof approvedAltasByLoc !== "undefined") {
          const key = province.toUpperCase() + "|" + localityMap;
          const altas = approvedAltasByLoc[key] || [];
          const altaMatch = altas.find((a) => (a.comercio || a.fantasia || "") === name);
          if (altaMatch) cardCode = altaMatch.cardCodeSap || "";
        }
        rows.push(
          Object.assign(
            {
              "CardCode SAP": cardCode,
              "Nombre tienda": name,
              "Alias (modal)": customName,
              Tipo: "Cliente actual",
              Estado: estado,
              Provincia: typeof titleCase === "function" ? titleCase(province) : province,
              "Localidad (mapa)": localityMap,
              Departamento: dept,
              "Vendedor externo (VDE)": vendor,
              Zona: zone,
              "Etiqueta zona": lookupVendorLabel(vendor),
              "Asesor interno (VDI)": vdi,
              Direccion: address,
              "Localidad declarada": localityCust,
              "Lat (geocode)": customLat || lat,
              "Lng (geocode)": customLng || lon,
              // v1055 (2026-09-24): limite de credito ARS para pagar con cheque.
              // Editable admin/gerente desde Master Clientes UI, guardado en
              // client_master.creditoCheque (para POINTS matcheados con SAP).
              "Credito cheque (ARS)": cmData.creditoCheque != null ? Number(cmData.creditoCheque) : ""
            },
            _classifRow(province, localityMap, name)
          )
        );
      });
    });
    const seen = /* @__PURE__ */ new Set();
    rows.forEach((r) => {
      seen.add(
        (r.Provincia || "").toString().toUpperCase() + "|" + (r["Nombre tienda"] || "").toLowerCase()
      );
    });
    if (typeof approvedAltasList !== "undefined" && approvedAltasList.length) {
      approvedAltasList.forEach((a) => {
        if (!a) return;
        const isProvisorio = !!a.manualSapPending && !a.cardCodeSap;
        if (!isProvisorio) {
          if (!a.cardCodeSap) return;
          if (!(a.calle || a.address)) return;
        }
        const prov = (a.provincia || "").toString();
        const nombre = a.comercio || a.fantasia || (a.cardCodeSap ? "SAP " + a.cardCodeSap.slice(0, 8) : a.titular || "Provisorio");
        const dupKey = prov.toUpperCase() + "|" + nombre.toLowerCase();
        if (seen.has(dupKey)) return;
        seen.add(dupKey);
        const vendor = a.assignedVendor || "";
        if (!inScope(vendor)) return;
        const zone = lookupZone(vendor);
        const vdi = VDE_TO_VDI[vendor] || "";
        const loc = a.localidadFinal || a.localidad || "(sin localidad)";
        rows.push(
          Object.assign(
            {
              "CardCode SAP": a.cardCodeSap || "",
              "Nombre tienda": nombre,
              "Alias (modal)": "",
              Tipo: isProvisorio ? "Provisorio (Alta rapida)" : "Cliente actual",
              Estado: isProvisorio ? "Provisorio" : "Habilitado",
              Provincia: typeof titleCase === "function" ? titleCase(prov) : prov,
              "Localidad (mapa)": loc,
              Departamento: "",
              "Vendedor externo (VDE)": vendor,
              Zona: zone,
              "Etiqueta zona": lookupVendorLabel(vendor),
              "Asesor interno (VDI)": vdi,
              Direccion: a.calle || a.address || "",
              "Localidad declarada": loc,
              "Lat (geocode)": a.lat != null ? a.lat : "",
              "Lng (geocode)": a.lng != null ? a.lng : "",
              // v1055: mismo campo para altas SAP (client_applications.creditoCheque).
              "Credito cheque (ARS)": a.creditoCheque != null ? Number(a.creditoCheque) : ""
            },
            _classifRow(prov, loc, nombre)
          )
        );
      });
    }
    rows.sort((a, b) => {
      const p = (a.Provincia || "").localeCompare(b.Provincia || "");
      if (p !== 0) return p;
      const l = (a["Localidad (mapa)"] || "").localeCompare(b["Localidad (mapa)"] || "");
      if (l !== 0) return l;
      return (a["Nombre tienda"] || "").localeCompare(b["Nombre tienda"] || "");
    });
    if (!rows.length) {
      alert(
        "No hay clientes para exportar.\n\nEl masterfile incluye:\n  * Habilitados en SAP (cardCode + direccion cargados).\n  * Provisorios (Alta rapida pendiente de carga a SAP).\n\nSi no ves ninguno, revisa el modal SAP o Alta Clientes."
      );
      return;
    }
    const COL_WIDTHS = {
      "CardCode SAP": 16,
      "Nombre tienda": 38,
      "Alias (modal)": 28,
      Tipo: 14,
      Estado: 14,
      Provincia: 22,
      "Localidad (mapa)": 22,
      Departamento: 22,
      "Vendedor externo (VDE)": 28,
      Zona: 8,
      "Etiqueta zona": 48,
      "Asesor interno (VDI)": 28,
      Direccion: 38,
      "Localidad declarada": 24,
      "Lat (geocode)": 14,
      "Lng (geocode)": 14,
      "Credito cheque (ARS)": 18,
      "Ultima interaccion": 14,
      "Tipo ultima interaccion": 14,
      "Total visitas": 10,
      "Total contactos": 10,
      "Tipo comercio": 18,
      Local: 16,
      Tamano: 12,
      Fidelidad: 14,
      Especializacion: 20,
      "Canal de compra": 20,
      Relevancia: 10,
      POP: 8,
      "Necesidad puntual": 26,
      "Tipo de venta": 16,
      "Ponderacion mostrador (%)": 18,
      "Ponderacion e-commerce (%)": 18,
      Competencia: 26,
      Oportunidad: 26,
      "Mas vendido": 22,
      "Mas preguntan": 22,
      "Ayuda tienda": 26
    };
    const allKeys = Object.keys(COL_WIDTHS);
    const NUMERIC_ZERO_OK = /* @__PURE__ */ new Set(["Total visitas", "Total contactos", "Credito cheque (ARS)"]);
    const emptyKeys = new Set(
      allKeys.filter((k) => {
        return rows.every((r) => {
          const v = r[k];
          if (v === "" || v === null || v === void 0) return true;
          if (NUMERIC_ZERO_OK.has(k) && v === 0) return true;
          return false;
        });
      })
    );
    const keptKeys = allKeys.filter((k) => !emptyKeys.has(k));
    const rowsFiltered = rows.map((r) => {
      const out = {};
      keptKeys.forEach((k) => {
        out[k] = r[k];
      });
      return out;
    });
    const removedCount = emptyKeys.size;
    if (removedCount > 0) {
      console.log(`[masterfile] removidas ${removedCount} cols vac\xEDas:`, [...emptyKeys].join(", "));
    }
    const byZone = {};
    rows.forEach((r) => {
      const z = r["Etiqueta zona"] || "Sin zona";
      if (!byZone[z]) byZone[z] = { total: 0, habilitados: 0, cancelados: 0 };
      byZone[z].total++;
      if (r.Estado === "Habilitado") byZone[z].habilitados++;
      else if (r.Estado === "Cancelado") byZone[z].cancelados++;
    });
    const resumenRows = Object.entries(byZone).map(([z, d]) => ({
      "Zona / Vendedor": z,
      "Total tiendas": d.total,
      Habilitadas: d.habilitados,
      Canceladas: d.cancelados
    })).sort((a, b) => b["Total tiendas"] - a["Total tiendas"]);
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const scopeLbl = scopeSet === null ? "TODOS" : scopeSet.size === 1 ? [...scopeSet][0].split(" ")[0] : "mis-zonas-" + scopeSet.size;
    const fname = "Masterfile_Clientes_SAP_" + scopeLbl + "_" + ts + ".xlsx";
    await downloadXlsx(fname, [
      { name: "Clientes habilitados SAP", rows: rowsFiltered },
      { name: "Resumen por zona", rows: resumenRows }
    ]);
    showSyncTag(
      rows.length + " clientes exportados" + (scopeSet === null ? "" : " (scope: " + [...scopeSet].join(", ") + ")")
    );
  };
  window.exportPreciosStock = async function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.");
      return;
    }
    if (!Array.isArray(PRODUCTS) || !PRODUCTS.length) {
      alert("No hay catalogo de productos cargado todavia.");
      return;
    }
    showSyncTag("Generando Excel precios + stock...");
    function fmtStock(sku) {
      const fnReal = typeof window !== "undefined" && typeof window.getStockRealmenteDisponible === "function" ? window.getStockRealmenteDisponible : null;
      if (fnReal) {
        try {
          const v = fnReal(sku);
          if (v == null) return "";
          return Number(v) || 0;
        } catch (_e) {
        }
      }
      const fnFisico = typeof window !== "undefined" && typeof window.getStockDisponibleVenta === "function" ? window.getStockDisponibleVenta : null;
      const vF = fnFisico ? fnFisico(sku) : null;
      if (vF == null) return "";
      return Number(vF) || 0;
    }
    function fmtPrecio(sku) {
      const p = typeof PRICE_LIST_MAP === "object" && PRICE_LIST_MAP ? PRICE_LIST_MAP[sku] : null;
      if (p == null) return "";
      return Number(p) || 0;
    }
    const rows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      Familia: p.fam || "",
      Subfamilia: p.sub || "",
      Categoria: p.cat || "",
      "Precio ARS": fmtPrecio(p.code),
      Stock: fmtStock(p.code)
    })).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const preciosRows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      "Precio ARS": fmtPrecio(p.code)
    })).filter((r) => r["Precio ARS"] !== "").sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const stockRows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      Stock: fmtStock(p.code)
    })).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const infoRows = [
      { Item: "Total SKUs en catalogo", Valor: PRODUCTS.length },
      { Item: "Total SKUs con precio cargado", Valor: preciosRows.length },
      {
        Item: "Total SKUs con stock disponible",
        Valor: PRODUCTS.filter((p) => hasStock(p.code) === true).length
      },
      {
        Item: "Total SKUs sin stock",
        Valor: PRODUCTS.filter((p) => hasStock(p.code) === false).length
      },
      {
        Item: "Total SKUs sin dato de stock",
        Valor: PRODUCTS.filter((p) => hasStock(p.code) == null).length
      },
      {
        Item: "Lista de precios moneda",
        Valor: typeof PRICE_LIST_CURRENCY !== "undefined" ? PRICE_LIST_CURRENCY : "ARS"
      },
      {
        Item: "Lista de precios actualizada",
        Valor: typeof PRICE_LIST_UPDATED_AT !== "undefined" && PRICE_LIST_UPDATED_AT ? new Date(PRICE_LIST_UPDATED_AT).toLocaleString("es-AR") : "(no cargada)"
      },
      {
        Item: "Stock snapshot actualizado",
        Valor: STOCK_UPDATED_AT ? new Date(STOCK_UPDATED_AT).toLocaleString("es-AR") : "(no cargado)"
      },
      { Item: "Exportado", Valor: (/* @__PURE__ */ new Date()).toLocaleString("es-AR") },
      {
        Item: "Exportado por",
        Valor: currentUser && (currentUser.email || currentUser.displayName) || "(desconocido)"
      }
    ];
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    await downloadXlsx("Precios_y_Stock_" + ts + ".xlsx", [
      { name: "Precios y Stock", rows },
      { name: "Precios", rows: preciosRows },
      { name: "Stock", rows: stockRows },
      { name: "Info", rows: infoRows }
    ]);
    showSyncTag(rows.length + " SKUs exportados (precios + stock)");
  };
  window.exportToExcel = function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.");
      return;
    }
    const allowedByRole = {
      // v711 (2026-08-28): VENTAS y RUTAS eliminados del UI por pedido de Mariano.
      vendedor: /* @__PURE__ */ new Set(["VISITAS", "MASTER", "BACKORDER", "STOCK_ASIG", "PEDIDOS_MES"]),
      interno: /* @__PURE__ */ new Set(["VISITAS", "MASTER", "BACKORDER", "STOCK_ASIG", "PEDIDOS_MES"])
    };
    const allowed = allowedByRole[userRole] || null;
    document.querySelectorAll("#export-modal .exp-opt").forEach((el) => {
      const kind = el.dataset.expKind || "";
      el.style.display = !allowed || allowed.has(kind) ? "" : "none";
    });
    document.getElementById("export-modal").classList.add("open");
  };
  window.closeExportDialog = function() {
    document.getElementById("export-modal").classList.remove("open");
  };
  var pendingExportType = null;
  var EXPORT_TYPE_LABELS = {
    VENTAS: "Ventas",
    VISITAS: "Visitas",
    RENDICIONES: "Rendiciones",
    RUTAS: "Rutas",
    ALTAS: "Altas de clientes",
    BACKORDER: "Backorder",
    STOCK_ASIG: "Stock Asignado",
    PEDIDOS_MES: "Pedidos del mes"
  };
  window.showMonthPicker = function(tipo) {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.");
      return;
    }
    pendingExportType = tipo;
    const title = document.getElementById("em-title");
    const subt = document.getElementById("em-subt");
    title.textContent = "Exportar " + (EXPORT_TYPE_LABELS[tipo] || tipo);
    subt.textContent = "Elegi el mes y a\xF1o que queres descargar.";
    const now = /* @__PURE__ */ new Date();
    const mesSel = document.getElementById("em-mes");
    mesSel.innerHTML = '<option value="ALL">Todos los meses (a\xF1o entero)</option>' + MESES.map((m, i) => '<option value="' + i + '">' + m + "</option>").join("");
    mesSel.value = now.getMonth();
    const anioSel = document.getElementById("em-anio");
    const year = now.getFullYear();
    let yopts = "";
    for (let y = year - 3; y <= year + 1; y++)
      yopts += '<option value="' + y + '">' + y + "</option>";
    anioSel.innerHTML = yopts;
    anioSel.value = year;
    document.getElementById("export-month-modal").classList.add("open");
  };
  window.closeMonthPicker = function() {
    document.getElementById("export-month-modal").classList.remove("open");
    pendingExportType = null;
  };
  window.confirmMonthPicker = function() {
    const tipo = pendingExportType;
    const mesRaw = document.getElementById("em-mes").value;
    const anio = parseInt(document.getElementById("em-anio").value, 10);
    const monthIdx = mesRaw === "ALL" ? null : parseInt(mesRaw, 10);
    document.getElementById("export-month-modal").classList.remove("open");
    pendingExportType = null;
    if (!tipo) return;
    try {
      if (tipo === "VENTAS") exportVentasForMonth(anio, monthIdx);
      else if (tipo === "VISITAS") exportVisitasForMonth(anio, monthIdx);
      else if (tipo === "RENDICIONES") exportRendicionesForMonth(anio, monthIdx);
      else if (tipo === "RUTAS") exportRutasForMonth(anio, monthIdx);
      else if (tipo === "ALTAS") exportAltasForMonth(anio, monthIdx);
      else if (tipo === "BACKORDER") exportBackorderForMonth(anio, monthIdx);
      else if (tipo === "STOCK_ASIG") exportStockAsigForMonth(anio, monthIdx);
      else if (tipo === "PEDIDOS_MES") exportPedidosMesForMonth(anio, monthIdx);
      else if (tipo === "VENTAS_ART_CLI") exportVentasArtCliForMonth(anio, monthIdx);
      else alert("Tipo desconocido: " + tipo);
    } catch (e) {
      console.error("export " + tipo, e);
      alert("Error generando export: " + (e.message || e));
    }
  };
  function periodLabel(anio, monthIdx) {
    if (monthIdx === null || monthIdx === void 0) return String(anio);
    return MESES[monthIdx] + "_" + anio;
  }
  async function downloadXlsx(filename, sheets) {
    try {
      await window.loadExcelJS();
    } catch (e) {
      alert("No se pudo cargar ExcelJS: " + (e.message || e));
      return;
    }
    const wb = new ExcelJS.Workbook();
    const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF166534" } };
    const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true, size: 12 };
    const CENTER = { vertical: "middle", horizontal: "center", wrapText: true };
    const BORDER_THIN = { style: "thin", color: { argb: "FFCCCCCC" } };
    const BORDER = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name.slice(0, 31));
      const rows = s.rows.length ? s.rows : [{ Aviso: "Sin datos para el periodo seleccionado" }];
      const headers = Object.keys(rows[0]);
      const headerRow = ws.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = CENTER;
        cell.border = BORDER;
      });
      headerRow.height = 26;
      for (const row of rows) {
        const values = headers.map((h) => row[h] !== void 0 && row[h] !== null ? row[h] : "");
        const dataRow = ws.addRow(values);
        dataRow.eachCell((cell) => {
          cell.alignment = CENTER;
          cell.border = BORDER;
        });
      }
      headers.forEach((h, i) => {
        let maxLen = String(h).length;
        for (const row of rows) {
          const v = String(row[h] === void 0 || row[h] === null ? "" : row[h]).split("\n")[0];
          if (v.length > maxLen) maxLen = v.length;
        }
        ws.getColumn(i + 1).width = Math.min(60, Math.max(10, maxLen + 4));
      });
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
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
  }
  async function exportVentasForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Ventas...");
    let snap;
    try {
      snap = await fbDb.collection("pedidos").get();
    } catch (e) {
      alert("Error leyendo pedidos: " + (e.message || e));
      return;
    }
    const rows = [];
    snap.forEach((d) => {
      const p = d.data() || {};
      if (parseInt(p.year, 10) !== anio) return;
      if (monthIdx !== null && parseInt(p.monthIdx, 10) !== monthIdx) return;
      const lines = p.lines || [];
      if (!lines.length) return;
      const vendorKey = p.vendor || lookupVendorForClient(p.province, p.locName, p.clientName) || "";
      const vendorInfo = vendorLookup[vendorKey] || {};
      const factor = typeof pedidoDiscountFactor === "function" ? pedidoDiscountFactor(p) : 1;
      const discPct = p.discountSnapshot && p.discountSnapshot.pctTotal || 0;
      lines.forEach((l) => {
        const qty = parseFloat(l.qty) || 0;
        const precio = parseFloat(l.precio) || 0;
        const gross = qty * precio;
        const net = gross * factor;
        rows.push({
          Mes: p.month || "",
          Fecha_Confirmado: p.confirmedAt ? String(p.confirmedAt).slice(0, 10) : "",
          Estado: p.stage || "",
          Vendedor: titleCase(vendorKey || ""),
          Zona: vendorInfo.zone || "",
          Provincia: titleCase(p.province || ""),
          Localidad: p.locName || "",
          Cliente: p.clientName || "",
          Codigo_SKU: l.code || "",
          Producto: l.desc || "",
          Categoria: l.cat || "",
          Familia: l.fam || "",
          Subfamilia: l.sub || "",
          Cantidad: qty,
          Precio_Unit_ARS: precio,
          // Subtotal_ARS = NETO (con descuento aplicado) - es lo que cuenta
          // para el target del vendedor. Subtotal_Bruto_ARS muestra el valor
          // de lista sin descuento para trazabilidad.
          Subtotal_ARS: Math.round(net),
          Subtotal_Bruto_ARS: Math.round(gross),
          Descuento_Pct: discPct,
          En_Nombre_De_VDE: p.onBehalfOf ? "SI" : "NO",
          Cargado_Por: p.createdByDisplayName || p.createdByEmail || ""
        });
      });
    });
    const fname = "Shimano_Ventas_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Ventas", rows }]);
    showSyncTag("Export Ventas listo (" + rows.length + " lineas)", 2400);
  }
  function lookupVendorForClient(prov, locName, _clientName) {
    if (!prov || !locName) return "";
    const pt = POINTS.find((p) => p.province === prov && p.name === locName);
    return pt ? pt.vendor || "" : "";
  }
  async function exportVisitasForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Visitas + Contactos...");
    let snap;
    try {
      snap = await fbDb.collection("visits").get();
    } catch (e) {
      alert("Error leyendo visitas: " + (e.message || e));
      return;
    }
    const targetMes = monthIdx !== null ? MESES[monthIdx].toUpperCase() : null;
    const items = [];
    snap.forEach((d) => {
      const v = d.data() || {};
      if (parseInt(v.anio, 10) !== anio) return;
      if (targetMes && (v.mes || "").toUpperCase() !== targetMes) return;
      items.push(v);
    });
    if (!items.length) {
      alert("No hay visitas ni contactos en el periodo seleccionado.");
      return;
    }
    const nVisitas = items.filter((v) => v.interactionType !== "contacto").length;
    const nContactos = items.length - nVisitas;
    try {
      await loadExcelJS();
    } catch (e) {
      alert(e.message || e);
      return;
    }
    showSyncTag("Generando Excel: " + nVisitas + " visitas + " + nContactos + " contactos...", 3e3);
    const wb = new ExcelJS.Workbook();
    wb.creator = "App Vendedores Shimano";
    wb.created = /* @__PURE__ */ new Date();
    const ws = wb.addWorksheet("Visitas y Contactos", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Mes", key: "mes", width: 10 },
      { header: "Anio", key: "anio", width: 8 },
      { header: "Vendedor", key: "vendedor", width: 22 },
      { header: "Owner Email", key: "email", width: 28 },
      { header: "Interaccion", key: "interaccion", width: 12 },
      { header: "Forma Contacto", key: "formaContacto", width: 22 },
      { header: "Resultado Contacto", key: "resultadoCt", width: 16 },
      { header: "Comentario", key: "coment", width: 30 },
      { header: "Provincia", key: "provincia", width: 16 },
      { header: "Localidad", key: "localidad", width: 18 },
      { header: "Tienda", key: "tienda", width: 28 },
      { header: "Tipo", key: "tipo", width: 12 },
      { header: "Local", key: "local", width: 12 },
      { header: "Tamano", key: "tamano", width: 10 },
      { header: "Fidelidad", key: "fidelidad", width: 10 },
      { header: "Relevancia", key: "relev", width: 10 },
      { header: "POP", key: "pop", width: 8 },
      { header: "Necesidad Puntual", key: "nec", width: 22 },
      { header: "Oportunidad", key: "oportu", width: 24 },
      { header: "Mas Vendido", key: "masVe", width: 24 },
      { header: "Mas Preguntan", key: "masPr", width: 24 },
      { header: "Ayuda Tienda", key: "ayuda", width: 22 },
      { header: "Tipo Venta", key: "tipoVenta", width: 12 },
      { header: "Pond Mostrador", key: "pMost", width: 10 },
      { header: "Pond Ecommerce", key: "pEcom", width: 10 },
      { header: "Competencia", key: "compe", width: 16 },
      { header: "GPS Status", key: "gpsSt", width: 12 },
      { header: "GPS Dist (m)", key: "gpsDist", width: 10 },
      { header: "Foto frente", key: "foto", width: 22 },
      { header: "En nombre de VDE", key: "onBehalf", width: 12 },
      { header: "Cargado Por", key: "createdBy", width: 24 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0C4A6E" } };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(1).height = 22;
    const FOTO_COL_IDX = ws.getColumn("foto").number - 1;
    const ROW_H = 100;
    const IMG_W = 130;
    const IMG_H = 90;
    items.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    for (const v of items) {
      const isContacto = v.interactionType === "contacto";
      const interaccionLbl = isContacto ? "Contacto" : "Visita";
      const formaContactoLbl = isContacto ? v.formaContacto || "Sin especificar" : "Presencial";
      let resultadoCtLbl = "";
      if (isContacto) {
        if (v.contactoResultado === "respondio") resultadoCtLbl = "Respondio";
        else if (v.contactoResultado === "no_respondio") resultadoCtLbl = "No respondio";
        else resultadoCtLbl = "Sin marcar";
      }
      const row = ws.addRow({
        fecha: v.fecha || "",
        mes: v.mes || "",
        anio: v.anio || "",
        vendedor: titleCase(v.vendor || ""),
        email: v.ownerEmail || "",
        interaccion: interaccionLbl,
        formaContacto: formaContactoLbl,
        resultadoCt: resultadoCtLbl,
        coment: v.comentario || "",
        provincia: titleCase(v.provincia || ""),
        localidad: v.localidad || "",
        tienda: v.tienda || "",
        tipo: v.tipo || "",
        local: v.local || "",
        tamano: v.tamano || "",
        fidelidad: v.fidelidad || "",
        relev: v.relevancia || "",
        pop: v.pop || "",
        nec: v.necesidadPuntual || "",
        oportu: v.oportunidad || "",
        masVe: v.masVendido || "",
        masPr: v.masPreguntan || "",
        ayuda: v.ayudaTienda || "",
        tipoVenta: v.tipoVenta === "MOSTRADO" ? "MOSTRADOR" : v.tipoVenta || "",
        pMost: v.ponderacionMostrado || "",
        pEcom: v.ponderacionEcommerce || "",
        compe: v.competencia || "",
        gpsSt: v.gpsStatus || "",
        gpsDist: v.gpsDistanceM != null ? v.gpsDistanceM : "",
        foto: "",
        // celda vacia - imagen encima
        onBehalf: v.onBehalfOf ? "SI" : "NO",
        createdBy: v.createdByDisplayName || v.createdByEmail || ""
      });
      row.height = ROW_H;
      row.alignment = { vertical: "middle", wrapText: true };
      if (v.frenteLocal && typeof v.frenteLocal === "string") {
        try {
          let b64 = v.frenteLocal;
          let ext = "jpeg";
          const m = /^data:image\/(\w+);base64,(.+)$/i.exec(b64);
          if (m) {
            ext = m[1].toLowerCase();
            b64 = m[2];
          }
          if (ext === "jpg") ext = "jpeg";
          const imageId = wb.addImage({ base64: b64, extension: ext });
          ws.addImage(imageId, {
            tl: { col: FOTO_COL_IDX + 0.1, row: row.number - 1 + 0.1 },
            ext: { width: IMG_W, height: IMG_H },
            editAs: "oneCell"
          });
        } catch (e) {
          console.warn("embebiendo foto visita", e);
        }
      }
    }
    try {
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Shimano_Visitas_" + periodLabel(anio, monthIdx) + ".xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5e3);
      showSyncTag("Export listo: " + nVisitas + " visitas + " + nContactos + " contactos", 2400);
    } catch (e) {
      console.error("exportVisitasForMonth", e);
      alert("Error generando el Excel: " + (e.message || e));
    }
  }
  async function exportRendicionesForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Rendiciones...");
    let snap;
    try {
      snap = await fbDb.collection("rendiciones").get();
    } catch (e) {
      alert("Error leyendo rendiciones: " + (e.message || e));
      return;
    }
    const items = [];
    snap.forEach((d) => {
      const r = d.data() || {};
      let dt = r.fecha || r.fechaGasto || "";
      if (!dt && r.createdAt && r.createdAt.toDate) {
        try {
          dt = r.createdAt.toDate().toISOString().slice(0, 10);
        } catch (_e) {
        }
      }
      if (!dt) return;
      const dObj = new Date(dt);
      if (Number.isNaN(dObj.getTime())) return;
      if (dObj.getFullYear() !== anio) return;
      if (monthIdx !== null && dObj.getMonth() !== monthIdx) return;
      items.push({ id: d.id, fecha: dt, r });
    });
    if (!items.length) {
      alert("No hay rendiciones en el periodo seleccionado.");
      return;
    }
    try {
      await loadExcelJS();
    } catch (e) {
      alert(e.message || e);
      return;
    }
    showSyncTag("Generando Excel con " + items.length + " rendiciones...", 3e3);
    const wb = new ExcelJS.Workbook();
    wb.creator = "App Vendedores Shimano";
    wb.created = /* @__PURE__ */ new Date();
    const ws = wb.addWorksheet("Rendiciones", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Tipo", key: "tipo", width: 10 },
      { header: "Vendedor", key: "vendedor", width: 26 },
      { header: "Owner Email", key: "email", width: 28 },
      { header: "Concepto", key: "concepto", width: 18 },
      { header: "N Ticket", key: "numTicket", width: 14 },
      { header: "Modo pago", key: "modoPago", width: 14 },
      { header: "Tipo gasto", key: "tipoGasto", width: 24 },
      { header: "Division", key: "division", width: 14 },
      { header: "Importe", key: "importe", width: 12 },
      { header: "Moneda", key: "moneda", width: 10 },
      { header: "Importe USD", key: "importeUsd", width: 12 },
      { header: "Observaciones", key: "obs", width: 30 },
      { header: "Foto ticket", key: "foto", width: 22 },
      { header: "Estado", key: "estado", width: 18 },
      { header: "Aprobador", key: "aprobador", width: 28 },
      { header: "Aprobado en", key: "aprobadoEn", width: 14 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7E22CE" } };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(1).height = 22;
    const FOTO_COL_IDX = ws.getColumn("foto").number - 1;
    const ROW_H = 110;
    const IMG_W = 140;
    const IMG_H = 100;
    items.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    for (const it of items) {
      const r = it.r;
      const isGasto = r.tipo === "gasto";
      const conceptStr = isGasto ? r.descripcion || "" : r.tipoOperacion || r.motivo || "";
      const obsStr = (r.observaciones || r.notas || "") + (isGasto ? "" : r.solicitadoPor ? " | Solicitado por: " + r.solicitadoPor : "");
      const row = ws.addRow({
        fecha: it.fecha,
        tipo: r.tipo || "",
        vendedor: r.ownerName || r.vendorName || r.ownerEmail || "",
        email: r.ownerEmail || "",
        concepto: conceptStr,
        numTicket: r.numeroTicket || "",
        modoPago: r.modoPago || "",
        tipoGasto: r.tipoGasto || "",
        division: r.divisionGasto || "",
        importe: r.importe != null ? r.importe : "",
        moneda: r.moneda || "PESOS",
        importeUsd: r.importeUsd != null && r.importeUsd !== 0 ? r.importeUsd : "",
        obs: obsStr,
        foto: "",
        // celda vacia - encima va la imagen
        estado: r.status || r.estado || "",
        aprobador: r.approverEmail || r.aprobador || "",
        aprobadoEn: r.approvedAt && r.approvedAt.toDate ? r.approvedAt.toDate().toISOString().slice(0, 10) : ""
      });
      row.height = ROW_H;
      row.alignment = { vertical: "middle", wrapText: true };
      const fotoSrc = r.fotoTicket || r.adjunto || "";
      if (fotoSrc && typeof fotoSrc === "string" && fotoSrc.startsWith("data:image/")) {
        try {
          let b64 = fotoSrc;
          let ext = "jpeg";
          const m = /^data:image\/(\w+);base64,(.+)$/i.exec(b64);
          if (m) {
            ext = m[1].toLowerCase();
            b64 = m[2];
          }
          if (ext === "jpg") ext = "jpeg";
          const imageId = wb.addImage({ base64: b64, extension: ext });
          ws.addImage(imageId, {
            tl: { col: FOTO_COL_IDX + 0.1, row: row.number - 1 + 0.1 },
            ext: { width: IMG_W, height: IMG_H },
            editAs: "oneCell"
          });
        } catch (e) {
          console.warn("embebiendo foto rendicion", it.id, e);
        }
      } else if (r.fotoTicketUrl && typeof r.fotoTicketUrl === "string") {
        try {
          const resp = await fetch(r.fotoTicketUrl);
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const contentType = resp.headers.get("content-type") || "image/jpeg";
          let ext = contentType.split("/")[1] || "jpeg";
          ext = ext.split(";")[0].trim().toLowerCase();
          if (ext === "jpg") ext = "jpeg";
          const buf = await resp.arrayBuffer();
          const imageId = wb.addImage({ buffer: buf, extension: ext });
          ws.addImage(imageId, {
            tl: { col: FOTO_COL_IDX + 0.1, row: row.number - 1 + 0.1 },
            ext: { width: IMG_W, height: IMG_H },
            editAs: "oneCell"
          });
        } catch (e) {
          console.warn("fetch foto rendicion fallo, dejo hyperlink", it.id, e);
          try {
            const cell = row.getCell(FOTO_COL_IDX + 1);
            cell.value = {
              text: "Abrir ticket",
              hyperlink: r.fotoTicketUrl,
              tooltip: "Abrir la foto del ticket en el browser (fetch fallo)"
            };
            cell.font = { color: { argb: "FF0563C1" }, underline: true };
          } catch (_e2) {
          }
        }
      }
    }
    try {
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Shimano_Rendiciones_" + periodLabel(anio, monthIdx) + ".xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5e3);
      showSyncTag("Export Rendiciones listo (" + items.length + " filas)", 2400);
    } catch (e) {
      console.error("exportRendicionesForMonth", e);
      alert("Error generando el Excel: " + (e.message || e));
    }
  }
  async function exportRutasForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Rutas...");
    const targetVendors = userRole === "admin" || userRole === "viewer" ? VENDORS.map((v) => v.key) : assignedVendor ? [assignedVendor] : [];
    const monthsToExport = monthIdx !== null ? [monthIdx] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const rutasRows = [];
    for (const vend of targetVendors) {
      for (const m of monthsToExport) {
        let rutas;
        try {
          rutas = generarRutasVendor(vend, m, anio);
        } catch (_e) {
          rutas = [];
        }
        (rutas || []).forEach((ruta) => {
          (ruta.tiendas || []).forEach((t, i) => {
            rutasRows.push({
              Vendedor: titleCase(vend),
              Anio: anio,
              Mes: MESES[m],
              Ruta_ID: ruta.id || "",
              Ruta_Nombre: ruta.nombre || "",
              Fecha_Asignada: ruta.fechaAsignada || "",
              Orden: i + 1,
              Provincia: titleCase(t.province || ""),
              Localidad: t.locName || "",
              Tienda: t.clientName || "",
              Tipo: t.tipo || "",
              Estado: t.estado || ""
            });
          });
        });
      }
    }
    let ovrSnap;
    try {
      ovrSnap = await fbDb.collection("route_overrides").get();
    } catch (_e) {
      ovrSnap = null;
    }
    const overridesRows = [];
    if (ovrSnap) {
      ovrSnap.forEach((d) => {
        const o = d.data() || {};
        if (parseInt(o.anio, 10) !== anio) return;
        if (monthIdx !== null && parseInt(o.monthIdx, 10) !== monthIdx) return;
        overridesRows.push({
          Anio: o.anio || "",
          Mes: MESES[parseInt(o.monthIdx, 10)] || "",
          Vendedor: titleCase(o.vendor || ""),
          Provincia: titleCase(o.province || ""),
          Localidad: o.locName || "",
          Tienda: o.clientName || "",
          Accion: o.action || o.tipo || "",
          Derivada_A: o.derivadaA || "",
          Reagendada_Para: o.reagendadaPara || "",
          Motivo: o.motivo || "",
          Creado_Por: o.createdByEmail || "",
          Creado_En: o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().toISOString().slice(0, 10) : ""
        });
      });
    }
    const fname = "Shimano_Rutas_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [
      { name: "Rutas planificadas", rows: rutasRows },
      { name: "Derivaciones-Reagendas", rows: overridesRows }
    ]);
    showSyncTag(
      "Export Rutas listo (" + rutasRows.length + " tiendas, " + overridesRows.length + " overrides)",
      2400
    );
  }
  async function exportAltasForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Altas...");
    let snap;
    try {
      snap = await fbDb.collection("client_applications").get();
    } catch (e) {
      alert("Error leyendo altas: " + (e.message || e));
      return;
    }
    const rows = [];
    snap.forEach((d) => {
      const a = d.data() || {};
      let dt = "";
      if (a.createdAt && a.createdAt.toDate) {
        try {
          dt = a.createdAt.toDate();
        } catch (_e) {
        }
      }
      if (!dt) return;
      if (dt.getFullYear() !== anio) return;
      if (monthIdx !== null && dt.getMonth() !== monthIdx) return;
      rows.push({
        Fecha_Solicitud: dt.toISOString().slice(0, 10),
        Estado: a.status || "",
        Comercio: a.comercio || "",
        Fantasia: a.fantasia || "",
        CUIT: a.cuit || "",
        Condicion_Fiscal: a.condFiscal || "",
        Calle: a.calle || "",
        Numero: a.numero || "",
        Localidad: a.localidad || "",
        Provincia: a.provincia || "",
        CP: a.cp || "",
        Telefono: a.telefono || "",
        Email: a.email || "",
        Vendedor_Solicitante: a.vendorName || a.ownerEmail || "",
        Owner_Email: a.ownerEmail || "",
        Submitted_By_Public_Form: a.submittedByPublicForm ? "SI" : "NO",
        Aprobado_Por: a.approvedByEmail || "",
        Aprobado_En: a.approvedAt && a.approvedAt.toDate ? a.approvedAt.toDate().toISOString().slice(0, 10) : "",
        Rechazado_Motivo: a.rejectedReason || ""
      });
    });
    const fname = "Shimano_Altas_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Altas de clientes", rows }]);
    showSyncTag("Export Altas listo (" + rows.length + " solicitudes)", 2400);
  }
  function _pedidoMonthYear(p) {
    const ca = p.createdAt;
    if (!ca) return { y: null, m: null };
    let dt = null;
    if (typeof ca === "string") dt = new Date(ca);
    else if (typeof ca.toDate === "function") {
      try {
        dt = ca.toDate();
      } catch (_e) {
      }
    } else if (typeof ca === "number") dt = new Date(ca);
    if (!dt || Number.isNaN(dt.getTime())) return { y: null, m: null };
    return { y: dt.getFullYear(), m: dt.getMonth() };
  }
  function _iteratePedidosMes(anio, monthIdx) {
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    return arr.filter((p) => {
      if (!p) return false;
      const { y, m } = _pedidoMonthYear(p);
      if (y == null) return false;
      if (y !== anio) return false;
      if (monthIdx !== null && m !== monthIdx) return false;
      return true;
    });
  }
  async function exportBackorderForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Backorder...");
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const mesYYYYMM = anio + "-" + String(monthIdx + 1).padStart(2, "0");
    const _resolveVendorFallback = (p) => {
      try {
        const cache = w.clientMasterCache;
        if (!cache) return "";
        const cc = String(p.clientCardCode || "").trim();
        if (cc && typeof cache.forEach === "function") {
          let found = "";
          cache.forEach((cmData) => {
            if (found) return;
            if (cmData && String(cmData.sapCardCode || "").trim() === cc && cmData.assignedVendor) {
              found = cmData.assignedVendor;
            }
          });
          if (found) return found;
        }
        if (typeof w.clientLocId === "function" && typeof cache.get === "function") {
          const cmDocId = w.clientLocId(p.province || "", p.locName || "", p.clientName || "");
          const cmData = cache.get(cmDocId);
          return cmData && cmData.assignedVendor || "";
        }
        return "";
      } catch (_e) {
        return "";
      }
    };
    const rawLines = computeFn ? computeFn(
      pedidos,
      "urgente",
      { mesYYYYMM },
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of pedidos) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qo = c.qtyBackorder || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let cantidadPedida = qo;
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) {
          cantidadPedida = Number(p.lines[idx].qty) || qo;
          lineaIdx = idx;
        }
      }
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Pedida: cantidadPedida,
        Cantidad_Pendiente_BO: qo,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_BO_ARS: Math.round(qo * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx,
        SQ_DocNum: c.sqDocNum || ""
      });
    });
    rows.sort((a, b) => (a.Cliente || "").localeCompare(b.Cliente || ""));
    const fname = "Shimano_Backorder_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Backorder", rows }]);
    showSyncTag("Export Backorder listo (" + rows.length + " lineas)", 2400);
  }
  async function exportStockAsigForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Stock Asignado...");
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const mesYYYYMM = anio + "-" + String(monthIdx + 1).padStart(2, "0");
    const _resolveVendorFallback = (p) => {
      try {
        const cache = w.clientMasterCache;
        if (!cache) return "";
        const cc = String(p.clientCardCode || "").trim();
        if (cc && typeof cache.forEach === "function") {
          let found = "";
          cache.forEach((cmData) => {
            if (found) return;
            if (cmData && String(cmData.sapCardCode || "").trim() === cc && cmData.assignedVendor) {
              found = cmData.assignedVendor;
            }
          });
          if (found) return found;
        }
        if (typeof w.clientLocId === "function" && typeof cache.get === "function") {
          const cmDocId = w.clientLocId(p.province || "", p.locName || "", p.clientName || "");
          const cmData = cache.get(cmDocId);
          return cmData && cmData.assignedVendor || "";
        }
        return "";
      } catch (_e) {
        return "";
      }
    };
    const rawLines = computeFn ? computeFn(
      pedidos,
      "asignacion",
      { mesYYYYMM },
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of pedidos) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qty = c.qtyAsignada || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) lineaIdx = idx;
      }
      let estadoReal = "ASIG";
      if (c.state === "BO") estadoReal = "BO_con_stock_(virtual_ASIG)";
      else if (c.state === "confirmed") estadoReal = "confirmed (SQ en SAP)";
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Reservada: qty,
        Estado_Real: estadoReal,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_Reservado_ARS: Math.round(qty * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx
      });
    });
    rows.sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const fname = "Shimano_StockAsignado_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Stock Asignado", rows }]);
    showSyncTag("Export Stock Asignado listo (" + rows.length + " lineas)", 2400);
  }
  window.exportBackorderAll = async function() {
    showSyncTag("Generando export de Backorder (snapshot actual)...");
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    const totalPedidosOpen = arr.filter((p) => p && !p.closedAt).length;
    const _resolveVendorFallback = (p) => {
      try {
        if (typeof window === "undefined") return "";
        const w2 = (
          /** @type {any} */
          window
        );
        if (typeof w2.clientLocId !== "function" || !w2.clientMasterCache || !w2.clientMasterCache.get)
          return "";
        const cmDocId = w2.clientLocId(p.province || "", p.locName || "", p.clientName || "");
        const cmData = w2.clientMasterCache.get(cmDocId);
        return cmData && cmData.assignedVendor || "";
      } catch (_e) {
        return "";
      }
    };
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const rawLines = computeFn ? computeFn(
      arr,
      "urgente",
      {},
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of arr) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qo = c.qtyBackorder || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let cantidadPedida = qo;
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) {
          cantidadPedida = Number(p.lines[idx].qty) || qo;
          lineaIdx = idx;
        }
      }
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Pedida: cantidadPedida,
        Cantidad_Pendiente_BO: qo,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_BO_ARS: Math.round(qo * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx,
        SQ_DocNum: c.sqDocNum || "",
        Origen: p && p.migrationSource || "app",
        // v1100: contexto útil para debugging paridad modal↔reporte.
        Estado: c.state || "BO",
        Stock_Disp_SKU: rl.dispSap || 0
      });
    });
    if (rows.length === 0) {
      alert(
        "Export Backorder vacio. Diagnostico:\n- Total pedidos en globalPedidos: " + arr.length + "\n- Pedidos abiertos (sin closedAt): " + totalPedidosOpen + "\n- Lineas post-FIFO+vencidas con qtyBackorder>0: 0\n\nPosibles causas:\n1. No hay backorder abierto ahora mismo (todo confirmed, cerrado o vencido)\n2. Los pedidos tienen closedAt seteado por error\n3. Todas las lineas BO tienen stock disponible (fueron promovidas a ASIG virtual)"
      );
      showSyncTag("Export Backorder: 0 lineas (ver alerta)", 3e3);
      return;
    }
    rows.sort((a, b) => (a.Cliente || "").localeCompare(b.Cliente || ""));
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fname = "Shimano_Backorder_Snapshot_" + today + ".xlsx";
    downloadXlsx(fname, [{ name: "Backorder", rows }]);
    showSyncTag("Export Backorder listo (" + rows.length + " lineas)", 2400);
  };
  window.exportStockAsigAll = async function() {
    showSyncTag("Generando export de Stock Asignado (snapshot actual)...");
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    const totalPedidosOpen = arr.filter((p) => p && !p.closedAt).length;
    const _resolveVendorFallback = (p) => {
      try {
        if (typeof window === "undefined") return "";
        const w2 = (
          /** @type {any} */
          window
        );
        if (typeof w2.clientLocId !== "function" || !w2.clientMasterCache || !w2.clientMasterCache.get)
          return "";
        const cmDocId = w2.clientLocId(p.province || "", p.locName || "", p.clientName || "");
        const cmData = w2.clientMasterCache.get(cmDocId);
        return cmData && cmData.assignedVendor || "";
      } catch (_e) {
        return "";
      }
    };
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const rawLines = computeFn ? computeFn(
      arr,
      "asignacion",
      {},
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of arr) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qty = c.qtyAsignada || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) lineaIdx = idx;
      }
      let estadoReal = "ASIG";
      if (c.state === "BO") estadoReal = "BO_con_stock_(virtual_ASIG)";
      else if (c.state === "confirmed") estadoReal = "confirmed (SQ en SAP)";
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Reservada: qty,
        Estado_Real: estadoReal,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_Reservado_ARS: Math.round(qty * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx,
        SQ_DocNum: c.sqDocNum || "",
        Origen: p && p.migrationSource || "app",
        // v1100: contexto útil para debugging paridad modal↔reporte.
        Stock_Disp_SKU: rl.dispSap || 0
      });
    });
    if (rows.length === 0) {
      alert(
        "Export Stock Asignado vacio. Diagnostico:\n- Total pedidos en globalPedidos: " + arr.length + "\n- Pedidos abiertos (sin closedAt): " + totalPedidosOpen + "\n- Lineas post-FIFO+vencidas con qtyAsignada>0: 0\n\nPosibles causas:\n1. No hay stock asignado ahora mismo\n2. Todos los ASIG estan vencidos (>15d desde asigAt)\n3. Los pedidos tienen closedAt seteado"
      );
      showSyncTag("Export Stock Asig: 0 lineas (ver alerta)", 3e3);
      return;
    }
    rows.sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fname = "Shimano_StockAsignado_Snapshot_" + today + ".xlsx";
    downloadXlsx(fname, [{ name: "Stock Asignado", rows }]);
    showSyncTag("Export Stock Asignado listo (" + rows.length + " lineas)", 2400);
  };
  function _resolveFantasiaForPedido(p) {
    const cardCode = String(p.clientCardCode || "").trim();
    if (cardCode) {
      const meta = (
        /** @type {any} */
        globalThis.clientMeta
      );
      const custom = meta && meta[cardCode] && meta[cardCode].customFantasia;
      if (custom && String(custom).trim()) return String(custom).trim();
    }
    const altas = (
      /** @type {any} */
      globalThis.approvedAltasList
    );
    if (Array.isArray(altas)) {
      const nameLower = String(p.clientName || "").trim().toLowerCase();
      if (nameLower) {
        const match = altas.find((a) => {
          if (!a) return false;
          const c = String(a.comercio || "").trim().toLowerCase();
          const f = String(a.fantasia || "").trim().toLowerCase();
          return c === nameLower || f === nameLower;
        });
        if (match && match.fantasia && String(match.fantasia).trim()) {
          return String(match.fantasia).trim();
        }
      }
    }
    return "";
  }
  async function exportVentasArtCliForMonth(anio, monthIdx) {
    if (monthIdx === null || monthIdx === void 0) {
      alert('Eleg\xED un MES espec\xEDfico (no "Todo el a\xF1o") \u2014 este reporte es mensual.');
      return;
    }
    const month = monthIdx + 1;
    const year = anio;
    const periodo = (window.MESES ? window.MESES[monthIdx] : month) + " " + year;
    const confirmMsg = 'Generar reporte "VENTAS x ARTICULO x CLIENTE/VENDEDOR" de ' + periodo + "?\n\nFuente: SAP via BigQuery (datos exactos).\nPuede tardar 30-60 segundos.\nAl terminar se descarga automaticamente el xlsx.";
    if (!confirm(confirmMsg)) return;
    showSyncTag("Generando reporte server-side (BQ)... puede tardar ~60s");
    try {
      try {
        const u = window.firebase.auth && window.firebase.auth().currentUser;
        if (u && u.getIdToken) await u.getIdToken(true);
      } catch (_e) {
      }
      const callable = window.firebase.app().functions("southamerica-east1").httpsCallable("generateVentasReportCF");
      const resp = await callable({ year, month });
      const r = resp && resp.data || {};
      if (!r.ok || !r.bytesBase64) {
        alert("CF devolvio error: " + (r.error || JSON.stringify(r)));
        return;
      }
      const bin = atob(r.bytesBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: r.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename || "ventas_x_articulo_cliente_" + year + "-" + String(month).padStart(2, "0") + ".xlsx";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1e3);
      const stats = r.stats || {};
      showSyncTag(
        "OK: " + (stats.ventas || 0) + " ventas / " + (stats.items || 0) + " SKUs / " + (stats.clients || 0) + " clientes"
      );
    } catch (e) {
      console.error("[exportVentasArtCli] error", e);
      alert("Error generando el reporte: " + (e && e.message ? e.message : String(e)));
    }
  }
  async function exportPedidosMesForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Pedidos del mes...");
    const rows = [];
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    for (const p of pedidos) {
      const lines = Array.isArray(p.lines) ? p.lines : [];
      if (!lines.length) continue;
      const fecha = p.createdAt ? typeof p.createdAt === "string" ? p.createdAt.slice(0, 10) : new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toISOString().slice(0, 10) : "";
      const nombreLocalFantasia = _resolveFantasiaForPedido(p);
      lines.forEach((l, idx) => {
        if (!l) return;
        const qty = Number(l.qty) || 0;
        const precio = Number(l.priceAtCreation || l.precio || 0);
        rows.push({
          Fecha_Pedido: fecha,
          Mes: p.month || "",
          Stage: p.stage || "",
          Cliente: p.clientName || "",
          Nombre_Local_Fantasia: nombreLocalFantasia,
          CardCode: p.clientCardCode || "",
          Provincia: p.province || "",
          Localidad: p.locName || "",
          Vendedor: p.ownerVendor || "",
          SKU: l.code || "",
          Producto: l.desc || l.name || "",
          Cantidad: qty,
          Cantidad_Open: Number(l.qtyOpen) || 0,
          Cantidad_Invoiced: Number(l.qtyInvoiced) || 0,
          Cantidad_Cancelled: Number(l.qtyCancelled) || 0,
          Estado_Linea: l.state || "",
          Precio_Unit_ARS: precio,
          Subtotal_ARS: Math.round(qty * precio),
          Cerrado: p.closedAt ? "SI" : "NO",
          Pedido_ID: p._fsId || "",
          Linea_Idx: idx,
          SQ_DocNum: p.transferidoSAP ? p.transferidoSAP.docNum || "" : ""
        });
      });
    }
    rows.sort((a, b) => (a.Fecha_Pedido || "").localeCompare(b.Fecha_Pedido || ""));
    const fname = "Shimano_PedidosDelMes_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Pedidos", rows }]);
    showSyncTag("Export Pedidos del mes listo (" + rows.length + " lineas)", 2400);
  }
  var ANALISIS_PIN = "1235";
  window.exportTargetsZonas = async function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verific\xE1 tu conexi\xF3n y reintent\xE1.");
      return;
    }
    if (userRole !== "admin" && userRole !== "gerente") {
      alert("Solo admin o gerente puede exportar el master.");
      return;
    }
    showSyncTag("Generando Excel TARGETS-ZONAS...");
    const VDE_TO_VDI = {
      "FEDERICO CASTELANELLI": "IOANNIS PALKOUDAKIS",
      "GONZALO DE LA ROSA": "IOANNIS PALKOUDAKIS",
      "MAURICIO GIL": "SANTIAGO ESTEBAN",
      PACHI: "SANTIAGO ESTEBAN"
    };
    function regionOf(prov) {
      const p = (prov || "").toUpperCase();
      if (["BUENOS AIRES", "CAPITAL FEDERAL", "LA PAMPA"].includes(p)) return "BUENOS AIRES";
      if (["CORDOBA", "SAN LUIS", "MENDOZA", "SAN JUAN", "LA RIOJA"].includes(p)) return "CUYO";
      if (["SANTA FE", "ENTRE RIOS", "CHACO", "CORRIENTES", "MISIONES", "FORMOSA"].includes(p))
        return "NEA";
      if (["JUJUY", "SALTA", "TUCUMAN", "CATAMARCA", "SANTIAGO DEL ESTERO"].includes(p)) return "NOA";
      if (["NEUQUEN", "RIO NEGRO", "CHUBUT", "SANTA CRUZ", "TIERRA DEL FUEGO"].includes(p))
        return "PATAGONIA";
      return "";
    }
    function vendorLabelForExcel(key) {
      if (!key) return "";
      if (key === "__DISTRIBUTOR__") return "DISTRIBUIDORES";
      return key;
    }
    const rows = [];
    let altasSnap;
    try {
      altasSnap = await fbDb.collection("client_applications").where("status", "==", "approved").get();
    } catch (e) {
      alert("Error leyendo altas aprobadas: " + (e.message || e));
      return;
    }
    let skippedNoSap = 0;
    altasSnap.forEach((d) => {
      const a = d.data() || {};
      const cardCode = (a.cardCodeSap || "").trim();
      if (!cardCode) {
        skippedNoSap++;
        return;
      }
      const province = (a.provincia || "").toUpperCase().trim();
      const localityFinal = a.localidadFinal || a.localidad || "";
      const vendor = a.assignedVendor || "";
      rows.push({
        TIPO: "DADO DE ALTA",
        "NRO CTE": 0,
        // se renumera despues del sort
        REGION: regionOf(province),
        PROVINCIA: province,
        "ASESOR EXTERNO": vendorLabelForExcel(vendor),
        "ASESOR INTERNO": VDE_TO_VDI[vendor] || "",
        CALLE: a.calle || "",
        NUMERO: a.numero || "",
        LOCALIDAD: localityFinal,
        CP: a.cp || "",
        "NOMBRE COMERCIAL": a.comercio || a.titular || "",
        "NOMBRE DE FANTASIA": a.fantasia || "",
        CUIT: a.cuit || "",
        "CONDICION FISCAL": a.condicionFiscal || "",
        TELEFONO: a.telefono || "",
        "CARDCODE SAP": cardCode
      });
    });
    if (!rows.length) {
      alert(
        "No hay clientes habilitados en SAP todavia.\n\nUna alta entra al export solo cuando tiene CardCode SAP asignado."
      );
      return;
    }
    rows.sort((r1, r2) => {
      const p = (r1.PROVINCIA || "").localeCompare(r2.PROVINCIA || "");
      if (p !== 0) return p;
      const l = (r1.LOCALIDAD || "").localeCompare(r2.LOCALIDAD || "");
      if (l !== 0) return l;
      return (r1["NOMBRE COMERCIAL"] || "").localeCompare(r2["NOMBRE COMERCIAL"] || "");
    });
    rows.forEach((r, i) => {
      r["NRO CTE"] = i + 1;
    });
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    await downloadXlsx("TARGETS_VENDEDORES_ZONAS_" + ts + ".xlsx", [
      { name: "CLIENTES_ZONAS", rows }
    ]);
    showSyncTag(
      "Excel exportado: " + rows.length + " clientes SAP habilitados" + (skippedNoSap > 0 ? " (" + skippedNoSap + " sin CardCode descartados)" : "")
    );
  };
  window.openExportAnalisis = function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.");
      return;
    }
    const pin = prompt(
      "Esta seccion contiene formatos avanzados (Power BI, Python/ML, ZIP de fotos) destinados a analisis tecnico.\n\nIngresa el PIN para continuar:"
    );
    if (pin === null) return;
    if (pin !== ANALISIS_PIN) {
      alert("PIN incorrecto.");
      return;
    }
    const sapOpt = document.getElementById("exp-opt-sap-integration");
    if (sapOpt) {
      const isMariano = currentUser && (currentUser.email || "").toLowerCase() === "erbinomariano@gmail.com";
      sapOpt.style.display = isMariano ? "" : "none";
    }
    const bkOpt = document.getElementById("exp-opt-backup-mensual");
    if (bkOpt) bkOpt.style.display = userRole === "admin" ? "" : "none";
    document.getElementById("export-analisis-modal").classList.add("open");
  };
  window.closeExportAnalisis = function() {
    document.getElementById("export-analisis-modal").classList.remove("open");
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFQT0lOVFMgfHwgIVBPSU5UUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xuICAvLyBTY29wZSBwb3IgdmVuZG9yICh2MzMxKTogZWwgZXhwb3J0IHJlc3BldGEgZWwgZmlsdHJvIGRlIHpvbmEgYWN0aXZvIGVuIGVsXG4gIC8vIGRyb3Bkb3duLiBBZG1pbi9nZXJlbnRlL3ZpZXdlciBjb24gJ1RvZGFzJyBvYnRpZW5lbiBudWxsIC0+IHNpbiBmaWx0cm9cbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxuICAvLyBzdXMgcGFyZWphcyArIHByb3BpbyBzaSBlbGlnaW8gJ1RvZGFzIG1pcyB6b25hcycsIG8gc29sbyBlbCBzdWJzZXQgcXVlXG4gIC8vIGVsaWdpbyAocHJvcGlvIC8gdW5hIHBhcmVqYSBlc3BlY2lmaWNhKS4gRnVlcmEgZGUgZXN0ZSBzZXQsIGxhcyB0aWVuZGFzXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxuICAvLyBlbiBlbCBtYXBhIHF1aWVuIGV4cG9ydGEuXG4gIGNvbnN0IHNjb3BlU2V0ID1cbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXG4gICAgICA/IGdldEVmZmVjdGl2ZVZlbmRvclNldCh0eXBlb2YgY3VycmVudFZlbmRvciAhPT0gJ3VuZGVmaW5lZCcgPyBjdXJyZW50VmVuZG9yIDogJ0FMTCcpXG4gICAgICA6IG51bGw7XG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XG4gICAgaWYgKHNjb3BlU2V0ID09PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoIXZlbmRvcktleSkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcbiAgfTtcbiAgLy8gTWFwZW8gVkRFIC0+IFZESSAoYSBwYXJ0aXIgZGUgbGFzIHBhcmVqYXMgZXN0YW5kYXIpLiBDdWFuZG8gdW5hIHRpZW5kYVxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cbiAgLy8gbyBNYXJ0aW4sIGVsIFZESSBlcyBTYW50aWFnby4gU2kgZW4gZWwgZnV0dXJvIHNlIHJlYXNpZ25hbiBwYXJlamFzIHZpYVxuICAvLyBwYW5lbCBhZG1pbiwgZXN0byBzZSBwb2RyaWEgbGVlciBkZWwgRmlyZXN0b3JlIC0gcGVybyBwYXJhIGVsIG1hc3RlcmZpbGVcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiBsb29rdXBab25lKHZlbmRvcktleSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xuICAgIHJldHVybiB2ID8gdi56b25lIDogJyc7XG4gIH1cbiAgZnVuY3Rpb24gbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LmxhYmVsIDogdmVuZG9yS2V5IHx8ICcnO1xuICB9XG5cbiAgLy8gdjQ1MCAoMjAyNi0wOC0xMSk6IGluZGljZSBkZSBjbGFzaWZpY2FjaW9uIGRlc2RlIHZpc2l0cy4gUGFyYSBjYWRhXG4gIC8vIGNsaWVudGUsIG1lcmdlYSBsb3MgY2FtcG9zIGRlIGNsYXNpZmljYWNpb24gKHRpcG8vdGFtYW5vL2ZpZGVsaWRhZC9cbiAgLy8gZXNwZWNpYWxpemFjaW9uL2NhbmFsQ29tcHJhL3BvcC90aXBvVmVudGEvZXRjLikgZGVsIGZvcm11bGFyaW8gZGVcbiAgLy8gdmlzaXRhL2NvbnRhY3RhZG8uIFBvbGl0aWNhOiBjYW1wbyBwb3IgY2FtcG8sIHRvbWFyIGVsIHByaW1lciB2YWxvclxuICAvLyBOTyBWQUNJTyBhbCByZWNvcnJlciBkb2NzIGRlIG1hcyByZWNpZW50ZSBhIG1hcyBhbnRpZ3VvLiBBc2kgZWwgdXN1YXJpb1xuICAvLyB2ZSBsYSBjbGFzaWZpY2FjaW9uIG1hcyBhY3R1YWxpemFkYSwgcGVybyBzaSBlbCB1bHRpbW8gY29udGFjdG8gbm8gbGxlbmFcbiAgLy8gdW4gY2FtcG8gKGNvbnRhY3RvcyB0aWVuZW4gbWVub3MgY2FtcG9zIHF1ZSB2aXNpdGFzKSwgY2FlIGFsIGFudGVyaW9yXG4gIC8vIGVuIHZleiBkZSBkZWphciB2YWNpby4gUGVkaWRvIGRlIE1hcmlhbm86IFwicHJpb3JpemFyIGxhIHVsdGltYVxuICAvLyBpbnRlcmFjY2lvbiBwZXJvIG5vIHBlcmRlciBpbmZvIHV0aWwgZGUgbGFzIGFudGVyaW9yZXNcIi5cbiAgY29uc3QgQ0xBU1NJRl9GSUVMRFMgPSBbXG4gICAgJ3RpcG8nLFxuICAgICdsb2NhbCcsXG4gICAgJ3RhbWFubycsXG4gICAgJ2ZpZGVsaWRhZCcsXG4gICAgJ2VzcGVjaWFsaXphY2lvbicsXG4gICAgJ2NhbmFsQ29tcHJhJyxcbiAgICAncmVsZXZhbmNpYScsXG4gICAgJ3BvcCcsXG4gICAgJ25lY2VzaWRhZFB1bnR1YWwnLFxuICAgICd0aXBvVmVudGEnLFxuICAgICdwb25kZXJhY2lvbk1vc3RyYWRvJyxcbiAgICAncG9uZGVyYWNpb25FY29tbWVyY2UnLFxuICAgICdjb21wZXRlbmNpYScsXG4gICAgJ29wb3J0dW5pZGFkJyxcbiAgICAnbWFzVmVuZGlkbycsXG4gICAgJ21hc1ByZWd1bnRhbicsXG4gICAgJ2F5dWRhVGllbmRhJyxcbiAgXTtcbiAgZnVuY3Rpb24gX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpIHtcbiAgICByZXR1cm4gKFxuICAgICAgKHByb3YgfHwgJycpLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKS50cmltKCkgK1xuICAgICAgJ3wnICtcbiAgICAgIChsb2MgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpICtcbiAgICAgICd8JyArXG4gICAgICAodGllbmRhIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKVxuICAgICk7XG4gIH1cbiAgZnVuY3Rpb24gX2NsYXNzaWZUcyh2KSB7XG4gICAgaWYgKHYgJiYgdi5jcmVhdGVkQXQgJiYgdi5jcmVhdGVkQXQudG9NaWxsaXMpIHJldHVybiB2LmNyZWF0ZWRBdC50b01pbGxpcygpO1xuICAgIGlmICh2ICYmIHYuZmVjaGEpIHJldHVybiBuZXcgRGF0ZSh2LmZlY2hhKS5nZXRUaW1lKCkgfHwgMDtcbiAgICByZXR1cm4gMDtcbiAgfVxuICBjb25zdCBjbGFzc2lmSW5kZXggPSBuZXcgTWFwKCk7IC8vIGtleSAtPiB7IGxhc3Q6IHtjYW1wb3N9LCBsYXN0RmVjaGEsIGxhc3RUeXBlLCB2aXNpdGFzLCBjb250YWN0b3MgfVxuICBpZiAodHlwZW9mIHZpc2l0c0NhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KHZpc2l0c0NhY2hlKSkge1xuICAgIGNvbnN0IGJ5S2V5ID0gbmV3IE1hcCgpO1xuICAgIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcbiAgICAgIGlmICghdikgcmV0dXJuO1xuICAgICAgY29uc3QgayA9IF9jbGFzc2lmS2V5KHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xuICAgICAgaWYgKCFieUtleS5oYXMoaykpIGJ5S2V5LnNldChrLCBbXSk7XG4gICAgICBieUtleS5nZXQoaykucHVzaCh2KTtcbiAgICB9KTtcbiAgICBieUtleS5mb3JFYWNoKChhcnIsIGspID0+IHtcbiAgICAgIGFyci5zb3J0KChhLCBiKSA9PiBfY2xhc3NpZlRzKGIpIC0gX2NsYXNzaWZUcyhhKSk7IC8vIGRlc2MgcG9yIGZlY2hhXG4gICAgICBjb25zdCBtZXJnZWQgPSB7fTtcbiAgICAgIGFyci5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICAgIENMQVNTSUZfRklFTERTLmZvckVhY2goKGYpID0+IHtcbiAgICAgICAgICBpZiAobWVyZ2VkW2ZdICE9IG51bGwgJiYgbWVyZ2VkW2ZdICE9PSAnJyAmJiBtZXJnZWRbZl0gIT09IDApIHJldHVybjtcbiAgICAgICAgICBjb25zdCB2YWwgPSB2W2ZdO1xuICAgICAgICAgIGlmICh2YWwgIT0gbnVsbCAmJiB2YWwgIT09ICcnKSBtZXJnZWRbZl0gPSB2YWw7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBjb25zdCBsYXRlc3QgPSBhcnJbMF0gfHwge307XG4gICAgICBjbGFzc2lmSW5kZXguc2V0KGssIHtcbiAgICAgICAgbWVyZ2VkLFxuICAgICAgICBsYXN0RmVjaGE6IGxhdGVzdC5mZWNoYSB8fCAnJyxcbiAgICAgICAgbGFzdFR5cGU6IGxhdGVzdC5pbnRlcmFjdGlvblR5cGUgfHwgKGxhdGVzdC5lc3BhY2lvID8gJ3Zpc2l0YScgOiAnJyksXG4gICAgICAgIHZpc2l0YXM6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGgsXG4gICAgICAgIGNvbnRhY3RvczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0bycpLmxlbmd0aCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIGZ1bmN0aW9uIF9jbGFzc2lmUm93KHByb3YsIGxvYywgdGllbmRhKSB7XG4gICAgY29uc3QgZW50cnkgPSBjbGFzc2lmSW5kZXguZ2V0KF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSk7XG4gICAgaWYgKCFlbnRyeSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgJ1VsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxuICAgICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiAnJyxcbiAgICAgICAgJ1RvdGFsIHZpc2l0YXMnOiAwLFxuICAgICAgICAnVG90YWwgY29udGFjdG9zJzogMCxcbiAgICAgICAgJ1RpcG8gY29tZXJjaW8nOiAnJyxcbiAgICAgICAgTG9jYWw6ICcnLFxuICAgICAgICBUYW1hbm86ICcnLFxuICAgICAgICBGaWRlbGlkYWQ6ICcnLFxuICAgICAgICBFc3BlY2lhbGl6YWNpb246ICcnLFxuICAgICAgICAnQ2FuYWwgZGUgY29tcHJhJzogJycsXG4gICAgICAgIFJlbGV2YW5jaWE6ICcnLFxuICAgICAgICBQT1A6ICcnLFxuICAgICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAnJyxcbiAgICAgICAgJ1RpcG8gZGUgdmVudGEnOiAnJyxcbiAgICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAnJyxcbiAgICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogJycsXG4gICAgICAgIENvbXBldGVuY2lhOiAnJyxcbiAgICAgICAgT3BvcnR1bmlkYWQ6ICcnLFxuICAgICAgICAnTWFzIHZlbmRpZG8nOiAnJyxcbiAgICAgICAgJ01hcyBwcmVndW50YW4nOiAnJyxcbiAgICAgICAgJ0F5dWRhIHRpZW5kYSc6ICcnLFxuICAgICAgfTtcbiAgICB9XG4gICAgY29uc3QgbSA9IGVudHJ5Lm1lcmdlZCB8fCB7fTtcbiAgICByZXR1cm4ge1xuICAgICAgJ1VsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RGZWNoYSxcbiAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RUeXBlLFxuICAgICAgJ1RvdGFsIHZpc2l0YXMnOiBlbnRyeS52aXNpdGFzLFxuICAgICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IGVudHJ5LmNvbnRhY3RvcyxcbiAgICAgICdUaXBvIGNvbWVyY2lvJzogbS50aXBvIHx8ICcnLFxuICAgICAgTG9jYWw6IG0ubG9jYWwgfHwgJycsXG4gICAgICBUYW1hbm86IG0udGFtYW5vIHx8ICcnLFxuICAgICAgRmlkZWxpZGFkOiBtLmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIEVzcGVjaWFsaXphY2lvbjogbS5lc3BlY2lhbGl6YWNpb24gfHwgJycsXG4gICAgICAnQ2FuYWwgZGUgY29tcHJhJzogbS5jYW5hbENvbXByYSB8fCAnJyxcbiAgICAgIFJlbGV2YW5jaWE6IG0ucmVsZXZhbmNpYSAhPSBudWxsID8gbS5yZWxldmFuY2lhIDogJycsXG4gICAgICBQT1A6IG0ucG9wIHx8ICcnLFxuICAgICAgJ05lY2VzaWRhZCBwdW50dWFsJzogbS5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxuICAgICAgJ1RpcG8gZGUgdmVudGEnOiBtLnRpcG9WZW50YSB8fCAnJyxcbiAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogbS5wb25kZXJhY2lvbk1vc3RyYWRvICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gOiAnJyxcbiAgICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6IG0ucG9uZGVyYWNpb25FY29tbWVyY2UgIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25FY29tbWVyY2UgOiAnJyxcbiAgICAgIENvbXBldGVuY2lhOiBtLmNvbXBldGVuY2lhIHx8ICcnLFxuICAgICAgT3BvcnR1bmlkYWQ6IG0ub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICAnTWFzIHZlbmRpZG8nOiBtLm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgICAnTWFzIHByZWd1bnRhbic6IG0ubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgJ0F5dWRhIHRpZW5kYSc6IG0uYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEZJTFRSTyBTQVA6IHNvbG8gc2UgZXhwb3J0YW4gbG9zIGNsaWVudGVzIEhBQklMSVRBRE9TIGVuIFNBUCAtIGxvcyBxdWVcbiAgLy8gdGllbmVuIGNhcmRDb2RlICsgZGlyZWNjaW9uLiBFc29zIHNvbiBsb3MgcXVlIGFwYXJlY2VuIGNvbW8gdmVyZGVzIGVuXG4gIC8vIGVsIG1hcGEgeSBzZSBjdWVudGFuIGVuIGVsIHN0YXQgSEFCSUxJVEFET1MuIEFudGVzIGVsIG1hc3RlcmZpbGUgYmFqYWJhXG4gIC8vIGxvcyB+MTAwMCBQT0lOVFMgZGVsIHBhZHJvbiBoaXN0b3JpY28sIHF1ZSBubyByZXByZXNlbnRhYmEgZWwgdW5pdmVyc29cbiAgLy8gcmVhbCBvcGVyYWJsZSBob3kuXG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgUE9JTlRTLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCBwcm92aW5jZSA9IHAucHJvdmluY2UgfHwgJyc7XG4gICAgY29uc3QgbG9jYWxpdHlNYXAgPSBwLm5hbWUgfHwgJyc7XG4gICAgY29uc3QgZGVwdCA9IHAuZGVwdCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBwLnZlbmRvciB8fCAnJztcbiAgICAvLyB2MzMxOiBmaWx0cmFyIHBvciBzY29wZSBkZSB2ZW5kb3IgZGVsIHVzdWFyaW8gcXVlIGV4cG9ydGEuXG4gICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcbiAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xuICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcbiAgICBjb25zdCBsYXQgPSBwLmxhdCAhPSBudWxsID8gcC5sYXQgOiAnJztcbiAgICBjb25zdCBsb24gPSBwLmxvbiAhPSBudWxsID8gcC5sb24gOiAnJztcbiAgICAvLyBTb2xvIGNsaWVudGVzIHJlZ3VsYXJlcyAobm8gcHJvc3BlY3RzLCBubyBkaXN0cmlidWlkb3JlcykgcXVlIHBhc2VuXG4gICAgLy8gZWwgZmlsdHJvIGlzU2FwQ29uZmlybWVkOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uXG4gICAgKHAuY2xpZW50cyB8fCBbXSkuZm9yRWFjaCgobmFtZSkgPT4ge1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBpZiAodHlwZW9mIGlzU2FwQ29uZmlybWVkICE9PSAnZnVuY3Rpb24nIHx8ICFpc1NhcENvbmZpcm1lZChwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpKVxuICAgICAgICByZXR1cm47XG4gICAgICBjb25zdCBrID0gJ0N8JyArIHByb3ZpbmNlICsgJ3wnICsgbG9jYWxpdHlNYXAgKyAnfCcgKyBuYW1lO1xuICAgICAgLy8gRXN0YWRvOiBoYWJpbGl0YWRvL2NhbmNlbGFkby9wZW5kaWVudGUgKGxlZ2FjeSBjb250YWN0ZWQgc2V0KS5cbiAgICAgIGxldCBlc3RhZG8gPSAnSGFiaWxpdGFkbyc7IC8vIHBvciBkZWZpbmljaW9uIHlhIGVzdGEgU0FQLWNvbmZpcm1hZG9cbiAgICAgIGlmICh0eXBlb2YgY2FuY2VsZWQgIT09ICd1bmRlZmluZWQnICYmIGNhbmNlbGVkICYmIGNhbmNlbGVkLmhhcyAmJiBjYW5jZWxlZC5oYXMoaykpXG4gICAgICAgIGVzdGFkbyA9ICdDYW5jZWxhZG8nO1xuICAgICAgLy8gTWV0YWRhdGEgY3VzdG9tIChkaXJlY2Npb24sIGxvY2FsaWRhZCBkZWNsYXJhZGEsIGdlb2NvZGUpLlxuICAgICAgY29uc3QgbWV0YSA9IHR5cGVvZiBjbGllbnRNZXRhICE9PSAndW5kZWZpbmVkJyAmJiBjbGllbnRNZXRhID8gY2xpZW50TWV0YVtrXSB8fCB7fSA6IHt9O1xuICAgICAgY29uc3QgY3VzdG9tTmFtZSA9IG1ldGEuY3VzdG9tTmFtZSB8fCAnJztcbiAgICAgIC8vIEJ1c2NhciBhZGRyZXNzOiAxKSBjbGllbnRfbWFzdGVyLmFkZHJlc3MgKGFkbWluKSwgMikgY2xpZW50TWV0YS5hZGRyZXNzICh2ZW5kb3IpLlxuICAgICAgY29uc3QgZG9jSWQgPVxuICAgICAgICB0eXBlb2YgY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgPyBjbGllbnRMb2NJZChwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpIDogJyc7XG4gICAgICBjb25zdCBjbURhdGEgPVxuICAgICAgICB0eXBlb2YgY2xpZW50TWFzdGVyQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIGRvY0lkID8gY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGRvY0lkKSB8fCB7fSA6IHt9O1xuICAgICAgY29uc3QgYWRkcmVzcyA9IGNtRGF0YS5hZGRyZXNzIHx8IG1ldGEuYWRkcmVzcyB8fCAnJztcbiAgICAgIGNvbnN0IGxvY2FsaXR5Q3VzdCA9IGNtRGF0YS5sb2NhbGlkYWQgfHwgbWV0YS5sb2NhbGl0eSB8fCAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxhdCA9IG1ldGEubGF0ICE9IG51bGwgPyBtZXRhLmxhdCA6ICcnO1xuICAgICAgY29uc3QgY3VzdG9tTG5nID0gbWV0YS5sbmcgIT0gbnVsbCA/IG1ldGEubG5nIDogJyc7XG4gICAgICAvLyBDYXJkQ29kZSBTQVAgKGRlIGNsaWVudF9tYXN0ZXIgbyBkZSBsYSBhbHRhIHZpbmN1bGFkYSkuXG4gICAgICBsZXQgY2FyZENvZGUgPSBjbURhdGEuc2FwQ2FyZENvZGUgfHwgJyc7XG4gICAgICBpZiAoIWNhcmRDb2RlICYmIHR5cGVvZiBhcHByb3ZlZEFsdGFzQnlMb2MgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGNvbnN0IGtleSA9IHByb3ZpbmNlLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBsb2NhbGl0eU1hcDtcbiAgICAgICAgY29uc3QgYWx0YXMgPSBhcHByb3ZlZEFsdGFzQnlMb2Nba2V5XSB8fCBbXTtcbiAgICAgICAgY29uc3QgYWx0YU1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4gKGEuY29tZXJjaW8gfHwgYS5mYW50YXNpYSB8fCAnJykgPT09IG5hbWUpO1xuICAgICAgICBpZiAoYWx0YU1hdGNoKSBjYXJkQ29kZSA9IGFsdGFNYXRjaC5jYXJkQ29kZVNhcCB8fCAnJztcbiAgICAgIH1cbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogY2FyZENvZGUsXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6IGN1c3RvbU5hbWUsXG4gICAgICAgICAgICBUaXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdmluY2UpIDogcHJvdmluY2UsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvY2FsaXR5TWFwLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhZGRyZXNzLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGN1c3RvbUxhdCB8fCBsYXQsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGN1c3RvbUxuZyB8fCBsb24sXG4gICAgICAgICAgICAvLyB2MTA1NSAoMjAyNi0wOS0yNCk6IGxpbWl0ZSBkZSBjcmVkaXRvIEFSUyBwYXJhIHBhZ2FyIGNvbiBjaGVxdWUuXG4gICAgICAgICAgICAvLyBFZGl0YWJsZSBhZG1pbi9nZXJlbnRlIGRlc2RlIE1hc3RlciBDbGllbnRlcyBVSSwgZ3VhcmRhZG8gZW5cbiAgICAgICAgICAgIC8vIGNsaWVudF9tYXN0ZXIuY3JlZGl0b0NoZXF1ZSAocGFyYSBQT0lOVFMgbWF0Y2hlYWRvcyBjb24gU0FQKS5cbiAgICAgICAgICAgICdDcmVkaXRvIGNoZXF1ZSAoQVJTKSc6XG4gICAgICAgICAgICAgIGNtRGF0YS5jcmVkaXRvQ2hlcXVlICE9IG51bGwgPyBOdW1iZXIoY21EYXRhLmNyZWRpdG9DaGVxdWUpIDogJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuICAvLyBJbnllY3RhciBhbHRhcyBkZSBjbGllbnRfYXBwbGljYXRpb25zIChhcHByb3ZlZEFsdGFzTGlzdCk6XG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXG4gIC8vICAgKiBQUk9WSVNPUklPUyAodjMxMSspOiBtYW51YWxTYXBQZW5kaW5nICYmICFjYXJkQ29kZVNhcCAoQWx0YSBSYXBpZGFcbiAgLy8gICAgIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuIFZhbiBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy4gU2VcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xuICAvLyAgICAgcXVlIGVsIGdlcmVudGUgZXN0YSBnZXN0aW9uYW5kbywgbm8gc29sbyBsb3MgY2VycmFkb3MgZW4gU0FQLlxuICAvLyAgICAgTG9zIHByb3Zpc29yaW9zIHB1ZWRlbiBubyB0ZW5lciBkaXJlY2Npb24gdG9kYXZpYSAtPiBzZSBhY2VwdGFuIGlndWFsLlxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBzZWVuLmFkZChcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxuICAgICk7XG4gIH0pO1xuICBpZiAodHlwZW9mIGFwcHJvdmVkQWx0YXNMaXN0ICE9PSAndW5kZWZpbmVkJyAmJiBhcHByb3ZlZEFsdGFzTGlzdC5sZW5ndGgpIHtcbiAgICBhcHByb3ZlZEFsdGFzTGlzdC5mb3JFYWNoKChhKSA9PiB7XG4gICAgICBpZiAoIWEpIHJldHVybjtcbiAgICAgIGNvbnN0IGlzUHJvdmlzb3JpbyA9ICEhYS5tYW51YWxTYXBQZW5kaW5nICYmICFhLmNhcmRDb2RlU2FwO1xuICAgICAgLy8gSGFiaWxpdGFkb3M6IHNpZ3VlbiBleGlnaWVuZG8gY2FyZENvZGUgKyBkaXJlY2Npb24gKGNvbXBvcnRhbWllbnRvIHByZS12MzExKS5cbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXG4gICAgICBpZiAoIWlzUHJvdmlzb3Jpbykge1xuICAgICAgICBpZiAoIWEuY2FyZENvZGVTYXApIHJldHVybjtcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwcm92ID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgY29uc3Qgbm9tYnJlID1cbiAgICAgICAgYS5jb21lcmNpbyB8fFxuICAgICAgICBhLmZhbnRhc2lhIHx8XG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xuICAgICAgY29uc3QgZHVwS2V5ID0gcHJvdi50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbm9tYnJlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMoZHVwS2V5KSkgcmV0dXJuO1xuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcbiAgICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgICAvLyB2MzMxOiBtaXNtbyBmaWx0cm8gZGUgc2NvcGUgYXBsaWNhIGEgYWx0YXMgU0FQL3Byb3Zpc29yaWFzLlxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcbiAgICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxuICAgICAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBub21icmUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxuICAgICAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbycgOiAnSGFiaWxpdGFkbycsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86ICcnLFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jLFxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXG4gICAgICAgICAgICAvLyB2MTA1NTogbWlzbW8gY2FtcG8gcGFyYSBhbHRhcyBTQVAgKGNsaWVudF9hcHBsaWNhdGlvbnMuY3JlZGl0b0NoZXF1ZSkuXG4gICAgICAgICAgICAnQ3JlZGl0byBjaGVxdWUgKEFSUyknOiBhLmNyZWRpdG9DaGVxdWUgIT0gbnVsbCA/IE51bWJlcihhLmNyZWRpdG9DaGVxdWUpIDogJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSlcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXG4gIHJvd3Muc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKGFbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xuICB9KTtcblxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXG4gICAgICAgICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJyArXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCBoZWxwZXIgKGVzdGlsbyB2ZXJkZSArIGNlbnRlcmVkXG4gIC8vIHVuaWZvcm1lKS4gQW50ZXMgdXNhYmEgWExTWC53cml0ZUZpbGUgZGlyZWN0byBjb24gU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmFcbiAgLy8gZXN0aWxvcy4gQWhvcmEgaGVyZWRhZG8gZGVsIGhlbHBlciBcdTIwMTQgbWlzbWEgVUkgcXVlIFZlbnRhcy9WaXNpdGFzL2V0Yy5cbiAgLy8gdjEwNDMgKDIwMjYtMDktMjMpOiBwb3N0LXByb2Nlc28gXHUyMDE0IHNhY2FyIGNvbHVtbmFzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIC8vIFJlcG9ydGUgTWFyaWFubzogbWFzdGVyZmlsZSBleHBvcnRhYmEgMzcgY29sdW1uYXMgZG9uZGUgbXVjaGFzIHZlblx1MDBFRGFuXG4gIC8vIHZhY1x1MDBFRGFzIHBvcnF1ZSBubyBoYWJcdTAwRURhIHZpc2l0YXMvY29udGFjdG9zIGNhcmdhZG9zIHBhcmEgZXNvcyBjbGllbnRlcy5cbiAgLy8gRml4OiBpZGVudGlmaWNhciBrZXlzIGRvbmRlIFRPREFTIGxhcyBmaWxhcyB0aWVuZW4gdmFsb3IgXCJ2YWNcdTAwRURvXCIgKGVtcHR5XG4gIC8vIHN0cmluZywgbnVsbCwgdW5kZWZpbmVkKSB5IHJlbW92ZXJsYXMgYW50ZXMgZGVsIHNoZWV0LiBMb3MgY29udGVvc1xuICAvLyAoVG90YWwgdmlzaXRhcy9jb250YWN0b3MpIHNlIGNvbnNpZGVyYW4gdmFjXHUwMEVEb3Mgc2kgdG9kb3Mgc29uIDAuXG4gIC8vIFdpZHRocyBwb3IgY29sdW1uLW5hbWUgKGVuIHZleiBkZSBwb3NpY2lvbmFsKSBwYXJhIHF1ZSBlbCBmaWx0ZXIgbm9cbiAgLy8gZGVzYWxpbmVlIGVsIHNoZWV0IGN1YW5kbyByZW1vdmVtb3MgY29sdW1uYXMuXG4gIGNvbnN0IENPTF9XSURUSFMgPSB7XG4gICAgJ0NhcmRDb2RlIFNBUCc6IDE2LFxuICAgICdOb21icmUgdGllbmRhJzogMzgsXG4gICAgJ0FsaWFzIChtb2RhbCknOiAyOCxcbiAgICBUaXBvOiAxNCxcbiAgICBFc3RhZG86IDE0LFxuICAgIFByb3ZpbmNpYTogMjIsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknOiAyMixcbiAgICBEZXBhcnRhbWVudG86IDIyLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogMjgsXG4gICAgWm9uYTogOCxcbiAgICAnRXRpcXVldGEgem9uYSc6IDQ4LFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IDI4LFxuICAgIERpcmVjY2lvbjogMzgsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiAyNCxcbiAgICAnTGF0IChnZW9jb2RlKSc6IDE0LFxuICAgICdMbmcgKGdlb2NvZGUpJzogMTQsXG4gICAgJ0NyZWRpdG8gY2hlcXVlIChBUlMpJzogMTgsXG4gICAgJ1VsdGltYSBpbnRlcmFjY2lvbic6IDE0LFxuICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IDE0LFxuICAgICdUb3RhbCB2aXNpdGFzJzogMTAsXG4gICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IDEwLFxuICAgICdUaXBvIGNvbWVyY2lvJzogMTgsXG4gICAgTG9jYWw6IDE2LFxuICAgIFRhbWFubzogMTIsXG4gICAgRmlkZWxpZGFkOiAxNCxcbiAgICBFc3BlY2lhbGl6YWNpb246IDIwLFxuICAgICdDYW5hbCBkZSBjb21wcmEnOiAyMCxcbiAgICBSZWxldmFuY2lhOiAxMCxcbiAgICBQT1A6IDgsXG4gICAgJ05lY2VzaWRhZCBwdW50dWFsJzogMjYsXG4gICAgJ1RpcG8gZGUgdmVudGEnOiAxNixcbiAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6IDE4LFxuICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6IDE4LFxuICAgIENvbXBldGVuY2lhOiAyNixcbiAgICBPcG9ydHVuaWRhZDogMjYsXG4gICAgJ01hcyB2ZW5kaWRvJzogMjIsXG4gICAgJ01hcyBwcmVndW50YW4nOiAyMixcbiAgICAnQXl1ZGEgdGllbmRhJzogMjYsXG4gIH07XG4gIC8vIERldGVjdGFyIGtleXMgMTAwJSB2YWNcdTAwRURhcy5cbiAgY29uc3QgYWxsS2V5cyA9IE9iamVjdC5rZXlzKENPTF9XSURUSFMpO1xuICBjb25zdCBOVU1FUklDX1pFUk9fT0sgPSBuZXcgU2V0KFsnVG90YWwgdmlzaXRhcycsICdUb3RhbCBjb250YWN0b3MnLCAnQ3JlZGl0byBjaGVxdWUgKEFSUyknXSk7XG4gIGNvbnN0IGVtcHR5S2V5cyA9IG5ldyBTZXQoXG4gICAgYWxsS2V5cy5maWx0ZXIoKGspID0+IHtcbiAgICAgIC8vIFNraXAgY29sdW1uYXMgY29yZSBxdWUgU0lFTVBSRSBzZSBtdWVzdHJhbiBhdW5xdWUgZXN0XHUwMEU5biB2YWNcdTAwRURhcy5cbiAgICAgIC8vIChDYXJkQ29kZS9Ob21icmUgc29uIG9wY2lvbmFsZXMgdFx1MDBFOWNuaWNhbWVudGUgcGVybyBjbGllbnRlIHNpbiBub21icmVcbiAgICAgIC8vIHlhIG5vIGxsZWdhIGhhc3RhIGFjXHUwMEUxLilcbiAgICAgIHJldHVybiByb3dzLmV2ZXJ5KChyKSA9PiB7XG4gICAgICAgIGNvbnN0IHYgPSByW2tdO1xuICAgICAgICBpZiAodiA9PT0gJycgfHwgdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgICAgICBpZiAoTlVNRVJJQ19aRVJPX09LLmhhcyhrKSAmJiB2ID09PSAwKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gICAgfSlcbiAgKTtcbiAgY29uc3Qga2VwdEtleXMgPSBhbGxLZXlzLmZpbHRlcigoaykgPT4gIWVtcHR5S2V5cy5oYXMoaykpO1xuICBjb25zdCByb3dzRmlsdGVyZWQgPSByb3dzLm1hcCgocikgPT4ge1xuICAgIGNvbnN0IG91dCA9IHt9O1xuICAgIGtlcHRLZXlzLmZvckVhY2goKGspID0+IHtcbiAgICAgIG91dFtrXSA9IHJba107XG4gICAgfSk7XG4gICAgcmV0dXJuIG91dDtcbiAgfSk7XG4gIGNvbnN0IHJlbW92ZWRDb3VudCA9IGVtcHR5S2V5cy5zaXplO1xuICBpZiAocmVtb3ZlZENvdW50ID4gMCkge1xuICAgIGNvbnNvbGUubG9nKGBbbWFzdGVyZmlsZV0gcmVtb3ZpZGFzICR7cmVtb3ZlZENvdW50fSBjb2xzIHZhY1x1MDBFRGFzOmAsIFsuLi5lbXB0eUtleXNdLmpvaW4oJywgJykpO1xuICB9XG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxuICBjb25zdCBieVpvbmUgPSB7fTtcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xuICAgIGlmICghYnlab25lW3pdKSBieVpvbmVbel0gPSB7IHRvdGFsOiAwLCBoYWJpbGl0YWRvczogMCwgY2FuY2VsYWRvczogMCB9O1xuICAgIGJ5Wm9uZVt6XS50b3RhbCsrO1xuICAgIGlmIChyLkVzdGFkbyA9PT0gJ0hhYmlsaXRhZG8nKSBieVpvbmVbel0uaGFiaWxpdGFkb3MrKztcbiAgICBlbHNlIGlmIChyLkVzdGFkbyA9PT0gJ0NhbmNlbGFkbycpIGJ5Wm9uZVt6XS5jYW5jZWxhZG9zKys7XG4gIH0pO1xuICBjb25zdCByZXN1bWVuUm93cyA9IE9iamVjdC5lbnRyaWVzKGJ5Wm9uZSlcbiAgICAubWFwKChbeiwgZF0pID0+ICh7XG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcbiAgICAgICdUb3RhbCB0aWVuZGFzJzogZC50b3RhbCxcbiAgICAgIEhhYmlsaXRhZGFzOiBkLmhhYmlsaXRhZG9zLFxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydUb3RhbCB0aWVuZGFzJ10gLSBhWydUb3RhbCB0aWVuZGFzJ10pO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxuICBjb25zdCBzY29wZUxibCA9XG4gICAgc2NvcGVTZXQgPT09IG51bGxcbiAgICAgID8gJ1RPRE9TJ1xuICAgICAgOiBzY29wZVNldC5zaXplID09PSAxXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcbiAgY29uc3QgZm5hbWUgPSAnTWFzdGVyZmlsZV9DbGllbnRlc19TQVBfJyArIHNjb3BlTGJsICsgJ18nICsgdHMgKyAnLnhsc3gnO1xuICBhd2FpdCBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBoYWJpbGl0YWRvcyBTQVAnLCByb3dzOiByb3dzRmlsdGVyZWQgfSxcbiAgICB7IG5hbWU6ICdSZXN1bWVuIHBvciB6b25hJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgZXhwb3J0YWRvcycgK1xuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcbiAgKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0OiBQcmVjaW9zICsgU3RvY2sgcG9yIFNLVVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcbi8vIGVuIG1lbW9yaWE6IFBST0RVQ1RTIChtYXN0ZXIgZGUgU0tVcyksIFBSSUNFX0xJU1RfTUFQIChwcmVjaW8gQVJTIGRlXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cbi8vIEhvamFzOlxuLy8gIC0gXCJQcmVjaW9zIHkgU3RvY2tcIjogdW5hIGZpbGEgcG9yIFNLVSBjb24gdG9kYXMgbGFzIGNvbHVtbmFzIGp1bnRhc1xuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXG4vLyAgLSBcIlN0b2NrXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBlc3RhZG8gZGUgc3RvY2suXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBjYXRhbG9nbyBkZSBwcm9kdWN0b3MgY2FyZ2FkbyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIHByZWNpb3MgKyBzdG9jay4uLicpO1xuICAvLyB2NTc0ICgyMDI2LTA4LTIxKTogbW9zdHJhciBVTklEQURFUyBudW1lcmljYXMgZXhhY3RhcyBkZWwgZGVwb3NpdG8gMTEuXG4gIC8vIHYxMzYzICgyMDI2LTEwLTE5KTogcGVkaWRvIE1hcmlhbm8gXHUyMDE0IGNhbWJpYXIgZGUgXCJzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTFcIiBhXG4gIC8vIFwibGlicmUgcGFyYSBsYSB2ZW50YVwiICg9IGRlcCAxMSBcdTIyMTIgcmVzZXJ2YXMgY29uZmlybWVkL0JPL0FTSUcvd2FpdGxpc3QpLlxuICAvLyBSYXpcdTAwRjNuOiBlbnZpYXIgYWwgY2xpZW50ZSBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBsZSBwdWVkZSBwcm9tZXRlciBIT1kuXG4gIC8vIFNpIHNvbG8gbW9zdHJhbW9zIHN0b2NrIGZcdTAwRURzaWNvLCBwdWVkZSBwYXNhciBxdWUgaGF5YSA1dSBwZXJvIGxhcyA1IGVzdFx1MDBFOW5cbiAgLy8gcmVzZXJ2YWRhcyBcdTIxOTIgZWwgY2xpZW50ZSBzZSBlbnRlcmEgcmVjaVx1MDBFOW4gYWwgaGFjZXIgZWwgcGVkaWRvIHF1ZSBubyBoYXkuXG4gIC8vIFVzYSBnZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgKHB1cmUgZnVuY3Rpb24sIGZpbHRyYSBUVExzKS4gUmV0b3JuYSAnJyBzaVxuICAvLyBubyBoYXkgc25hcHNob3QgY2FyZ2FkbzsgMCBzaSBubyBoYXkgbGlicmUuXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xuICAgIGNvbnN0IGZuUmVhbCA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGVcbiAgICAgICAgOiBudWxsO1xuICAgIGlmIChmblJlYWwpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHYgPSBmblJlYWwoc2t1KTtcbiAgICAgICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgICAgICByZXR1cm4gTnVtYmVyKHYpIHx8IDA7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvLyBmYWxsYmFjayBhIHN0b2NrIGZcdTAwRURzaWNvIGFiYWpvXG4gICAgICB9XG4gICAgfVxuICAgIC8vIEZhbGxiYWNrOiBzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTEgKHNpIGdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSBubyBlc3RcdTAwRTEgZGlzcG9uaWJsZSxcbiAgICAvLyBlai4gYm9vdHN0cmFwIG11eSB0ZW1wcmFubykuXG4gICAgY29uc3QgZm5GaXNpY28gPVxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxuICAgICAgICA6IG51bGw7XG4gICAgY29uc3QgdkYgPSBmbkZpc2ljbyA/IGZuRmlzaWNvKHNrdSkgOiBudWxsO1xuICAgIGlmICh2RiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcih2RikgfHwgMDtcbiAgfVxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xuICB9XG4gIC8vIEhvamEgMTogY29tYm8gY29tcGxldG8gKGVzIGxhIG1hcyBwZWRpZGEpLlxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXG4gICAgU3ViZmFtaWxpYTogcC5zdWIgfHwgJycsXG4gICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICAgIFN0b2NrOiBmbXRTdG9jayhwLmNvZGUpLFxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggaGVscGVyIChlc3RpbG8gdmVyZGUgdW5pZm9ybWUpLlxuICAvLyBFbCBmb3JtYXRvIGRlIG1vbmVkYSBBUlMgZGUgbGEgY29sdW1uYSBQcmVjaW8gcXVlZGEgY29tbyBuXHUwMEZBbWVybyBzaW1wbGUgXHUyMDE0XG4gIC8vIHNlIHBpZXJkZSBlbCBwcmVmaXggXCIkXCIgcGVybyBzZSBnYW5hIGNvbnNpc3RlbmNpYSB2aXN1YWwuIEV4Y2VsIHBlcm1pdGVcbiAgLy8gYXBsaWNhciBmb3JtYXRvIG1hbnVhbCBzaSBlbCB1c3VhcmlvIGxvIG5lY2VzaXRhLlxuXG4gIC8vIEhvamEgMjogc29sbyBQcmVjaW9zXG4gIGNvbnN0IHByZWNpb3NSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcbiAgfSkpXG4gICAgLmZpbHRlcigocikgPT4gclsnUHJlY2lvIEFSUyddICE9PSAnJylcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgLy8gSG9qYSAzOiBzb2xvIFN0b2NrXG4gIGNvbnN0IHN0b2NrUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgIFN0b2NrOiBmbXRTdG9jayhwLmNvZGUpLFxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgLy8gSG9qYSA0OiBtZXRhZGF0YSAtIGN1YW5kbyBmdWUgY2FkYSBzbmFwc2hvdCBwYXJhIHF1ZSBlbCBsZWN0b3Igc2VwYVxuICAvLyBzaSBsYSBsaXN0YSBlc3RhIGZyZXNjYS5cbiAgY29uc3QgaW5mb1Jvd3MgPSBbXG4gICAgeyBJdGVtOiAnVG90YWwgU0tVcyBlbiBjYXRhbG9nbycsIFZhbG9yOiBQUk9EVUNUUy5sZW5ndGggfSxcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBwcmVjaW8gY2FyZ2FkbycsIFZhbG9yOiBwcmVjaW9zUm93cy5sZW5ndGggfSxcbiAgICB7XG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBjb24gc3RvY2sgZGlzcG9uaWJsZScsXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSB0cnVlKS5sZW5ndGgsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gc3RvY2snLFxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gZmFsc2UpLmxlbmd0aCxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIHNpbiBkYXRvIGRlIHN0b2NrJyxcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT0gbnVsbCkubGVuZ3RoLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgbW9uZWRhJyxcbiAgICAgIFZhbG9yOiB0eXBlb2YgUFJJQ0VfTElTVF9DVVJSRU5DWSAhPT0gJ3VuZGVmaW5lZCcgPyBQUklDRV9MSVNUX0NVUlJFTkNZIDogJ0FSUycsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBhY3R1YWxpemFkYScsXG4gICAgICBWYWxvcjpcbiAgICAgICAgdHlwZW9mIFBSSUNFX0xJU1RfVVBEQVRFRF9BVCAhPT0gJ3VuZGVmaW5lZCcgJiYgUFJJQ0VfTElTVF9VUERBVEVEX0FUXG4gICAgICAgICAgPyBuZXcgRGF0ZShQUklDRV9MSVNUX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXG4gICAgICAgICAgOiAnKG5vIGNhcmdhZGEpJyxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdTdG9jayBzbmFwc2hvdCBhY3R1YWxpemFkbycsXG4gICAgICBWYWxvcjogU1RPQ0tfVVBEQVRFRF9BVCA/IG5ldyBEYXRlKFNUT0NLX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIDogJyhubyBjYXJnYWRvKScsXG4gICAgfSxcbiAgICB7IEl0ZW06ICdFeHBvcnRhZG8nLCBWYWxvcjogbmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdFeHBvcnRhZG8gcG9yJyxcbiAgICAgIFZhbG9yOiAoY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lKSkgfHwgJyhkZXNjb25vY2lkbyknLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZG93bmxvYWRYbHN4KCdQcmVjaW9zX3lfU3RvY2tfJyArIHRzICsgJy54bHN4JywgW1xuICAgIHsgbmFtZTogJ1ByZWNpb3MgeSBTdG9jaycsIHJvd3MgfSxcbiAgICB7IG5hbWU6ICdQcmVjaW9zJywgcm93czogcHJlY2lvc1Jvd3MgfSxcbiAgICB7IG5hbWU6ICdTdG9jaycsIHJvd3M6IHN0b2NrUm93cyB9LFxuICAgIHsgbmFtZTogJ0luZm8nLCByb3dzOiBpbmZvUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcocm93cy5sZW5ndGggKyAnIFNLVXMgZXhwb3J0YWRvcyAocHJlY2lvcyArIHN0b2NrKScpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxud2luZG93LmV4cG9ydFRvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cbiAgLy8gICB2ZW5kZWRvcjogb3BlcmF0aXZvIGRpYXJpbyAoVmVudGFzIC8gVmlzaXRhcyAvIFJ1dGFzKSArIENsaWVudGVzIGRlIHN1IHpvbmFcbiAgLy8gICAgIChleHBvcnRNYXN0ZXJDbGllbnRlcyB5YSBmaWx0cmEgcG9yIGdldEVmZmVjdGl2ZVZlbmRvclNldCAtPiBzb2xvIHN1IHZlbmRvcikuXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxuICAvLyAgICAgcHJvcGlvIHNpIGVsaWdpbyBzdSBub21icmUgZW4gZWwgZHJvcGRvd24gZGUgem9uYXMpLlxuICAvLyAgIGFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogdmVuIHRvZG8gZWwgbGlzdGFkbyAobnVsbCA9IHNpbiBmaWx0cm8pLlxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBWRU5UQVMgeSBSVVRBUyBlbGltaW5hZG9zIGRlbCBVSSBwb3IgcGVkaWRvIGRlIE1hcmlhbm8uXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gIH07XG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2V4cG9ydC1tb2RhbCAuZXhwLW9wdCcpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2luZCA9IGVsLmRhdGFzZXQuZXhwS2luZCB8fCAnJztcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCkgPyAnJyA6ICdub25lJztcbiAgfSk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmxldCBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XG4gIFZFTlRBUzogJ1ZlbnRhcycsXG4gIFZJU0lUQVM6ICdWaXNpdGFzJyxcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXG4gIFJVVEFTOiAnUnV0YXMnLFxuICBBTFRBUzogJ0FsdGFzIGRlIGNsaWVudGVzJyxcbiAgQkFDS09SREVSOiAnQmFja29yZGVyJyxcbiAgU1RPQ0tfQVNJRzogJ1N0b2NrIEFzaWduYWRvJyxcbiAgUEVESURPU19NRVM6ICdQZWRpZG9zIGRlbCBtZXMnLFxufTtcblxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uICh0aXBvKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXRpdGxlJyk7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcbiAgc3VidC50ZXh0Q29udGVudCA9ICdFbGVnaSBlbCBtZXMgeSBhXHUwMEYxbyBxdWUgcXVlcmVzIGRlc2Nhcmdhci4nO1xuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1lc1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKTtcbiAgbWVzU2VsLmlubmVySFRNTCA9XG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xuICBsZXQgeW9wdHMgPSAnJztcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXG4gICAgeW9wdHMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgeSArICdcIj4nICsgeSArICc8L29wdGlvbj4nO1xuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG59O1xuXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB0aXBvID0gcGVuZGluZ0V4cG9ydFR5cGU7XG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcbiAgY29uc3QgbW9udGhJZHggPSBtZXNSYXcgPT09ICdBTEwnID8gbnVsbCA6IHBhcnNlSW50KG1lc1JhdywgMTApO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG4gIGlmICghdGlwbykgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWSVNJVEFTJykgZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQUxUQVMnKSBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQkFDS09SREVSJykgZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdTVE9DS19BU0lHJykgZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdQRURJRE9TX01FUycpIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZFTlRBU19BUlRfQ0xJJykgZXhwb3J0VmVudGFzQXJ0Q2xpRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgYWxlcnQoJ1RpcG8gZGVzY29ub2NpZG86ICcgKyB0aXBvKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydCAnICsgdGlwbywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBleHBvcnQ6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHJldHVybiBTdHJpbmcoYW5pbyk7XG4gIHJldHVybiBNRVNFU1ttb250aElkeF0gKyAnXycgKyBhbmlvO1xufVxuXG4vLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZXNjcml0byBjb24gRXhjZWxKUyBwYXJhIGRhciBVSSB1bmlmb3JtZSBhIFRPRE9TIGxvc1xuLy8gZXhwb3J0cyAoaGVhZGVyIHZlcmRlICsgY2VsZGFzIGNlbnRlcmVkICsgYm9yZGVyIHN1dGlsICsgYXV0by1maXQgd2lkdGgpLlxuLy8gQW50ZXMgdXNhYmEgWExTWCBTaGVldEpTIGZyZWUgcXVlIGlnbm9yYSBzaWxlbnRseSBsb3MgZXN0aWxvcyBkZSBjZWxkYS4gRWxcbi8vIHBhdHRlcm4gdmVyZGUgcmVwbGljYSBlbCBUT1RBTCBiYXIgZGUgZXhwb3J0QmFja29yZGVyc1RvRXhjZWwgKG1vZGFsXG4vLyBCYWNrb3JkZXIgdjcyMCspLiBFeGNlbEpTIHlhIHNlIGNhcmdhIG9uLWRlbWFuZCB2aWEgd2luZG93LmxvYWRFeGNlbEpTLlxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRYbHN4KGZpbGVuYW1lLCBzaGVldHMpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCB3aW5kb3cubG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdObyBzZSBwdWRvIGNhcmdhciBFeGNlbEpTOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgY29uc3QgSEVBREVSX0ZJTEwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYxNjY1MzQnIH0gfTtcbiAgY29uc3QgSEVBREVSX0ZPTlQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSwgc2l6ZTogMTIgfTtcbiAgY29uc3QgQ0VOVEVSID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICBjb25zdCBCT1JERVJfVEhJTiA9IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH07XG4gIGNvbnN0IEJPUkRFUiA9IHsgdG9wOiBCT1JERVJfVEhJTiwgbGVmdDogQk9SREVSX1RISU4sIGJvdHRvbTogQk9SREVSX1RISU4sIHJpZ2h0OiBCT1JERVJfVEhJTiB9O1xuXG4gIGZvciAoY29uc3QgcyBvZiBzaGVldHMpIHtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldChzLm5hbWUuc2xpY2UoMCwgMzEpKTtcbiAgICBjb25zdCByb3dzID0gcy5yb3dzLmxlbmd0aCA/IHMucm93cyA6IFt7IEF2aXNvOiAnU2luIGRhdG9zIHBhcmEgZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8nIH1dO1xuICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3Qua2V5cyhyb3dzWzBdKTtcblxuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmFkZFJvdyhoZWFkZXJzKTtcbiAgICBoZWFkZXJSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgIGNlbGwuZmlsbCA9IEhFQURFUl9GSUxMO1xuICAgICAgY2VsbC5mb250ID0gSEVBREVSX0ZPTlQ7XG4gICAgICBjZWxsLmFsaWdubWVudCA9IENFTlRFUjtcbiAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgIH0pO1xuICAgIGhlYWRlclJvdy5oZWlnaHQgPSAyNjtcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IGhlYWRlcnMubWFwKChoKSA9PiAocm93W2hdICE9PSB1bmRlZmluZWQgJiYgcm93W2hdICE9PSBudWxsID8gcm93W2hdIDogJycpKTtcbiAgICAgIGNvbnN0IGRhdGFSb3cgPSB3cy5hZGRSb3codmFsdWVzKTtcbiAgICAgIGRhdGFSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaGVhZGVycy5mb3JFYWNoKChoLCBpKSA9PiB7XG4gICAgICBsZXQgbWF4TGVuID0gU3RyaW5nKGgpLmxlbmd0aDtcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgdiA9IFN0cmluZyhyb3dbaF0gPT09IHVuZGVmaW5lZCB8fCByb3dbaF0gPT09IG51bGwgPyAnJyA6IHJvd1toXSkuc3BsaXQoJ1xcbicpWzBdO1xuICAgICAgICBpZiAodi5sZW5ndGggPiBtYXhMZW4pIG1heExlbiA9IHYubGVuZ3RoO1xuICAgICAgfVxuICAgICAgd3MuZ2V0Q29sdW1uKGkgKyAxKS53aWR0aCA9IE1hdGgubWluKDYwLCBNYXRoLm1heCgxMCwgbWF4TGVuICsgNCkpO1xuICAgIH0pO1xuXG4gICAgd3Mudmlld3MgPSBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XTtcbiAgfVxuXG4gIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XG4gICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgfSk7XG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIGEuaHJlZiA9IHVybDtcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICBhLmNsaWNrKCk7XG4gIGEucmVtb3ZlKCk7XG4gIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWRU5UQVM6IHBlZGlkb3MgY29uZmlybWFkb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmVudGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHBlZGlkb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBwID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHAueWVhciwgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KHAubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBjb25zdCBsaW5lcyA9IHAubGluZXMgfHwgW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCB2ZW5kb3JLZXkgPSBwLnZlbmRvciB8fCBsb29rdXBWZW5kb3JGb3JDbGllbnQocC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpIHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvckluZm8gPSB2ZW5kb3JMb29rdXBbdmVuZG9yS2V5XSB8fCB7fTtcbiAgICBjb25zdCBmYWN0b3IgPSB0eXBlb2YgcGVkaWRvRGlzY291bnRGYWN0b3IgPT09ICdmdW5jdGlvbicgPyBwZWRpZG9EaXNjb3VudEZhY3RvcihwKSA6IDE7XG4gICAgY29uc3QgZGlzY1BjdCA9IChwLmRpc2NvdW50U25hcHNob3QgJiYgcC5kaXNjb3VudFNuYXBzaG90LnBjdFRvdGFsKSB8fCAwO1xuICAgIGxpbmVzLmZvckVhY2goKGwpID0+IHtcbiAgICAgIGNvbnN0IHF0eSA9IHBhcnNlRmxvYXQobC5xdHkpIHx8IDA7XG4gICAgICBjb25zdCBwcmVjaW8gPSBwYXJzZUZsb2F0KGwucHJlY2lvKSB8fCAwO1xuICAgICAgY29uc3QgZ3Jvc3MgPSBxdHkgKiBwcmVjaW87XG4gICAgICBjb25zdCBuZXQgPSBncm9zcyAqIGZhY3RvcjtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgRmVjaGFfQ29uZmlybWFkbzogcC5jb25maXJtZWRBdCA/IFN0cmluZyhwLmNvbmZpcm1lZEF0KS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgICAgRXN0YWRvOiBwLnN0YWdlIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvcktleSB8fCAnJyksXG4gICAgICAgIFpvbmE6IHZlbmRvckluZm8uem9uZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENvZGlnb19TS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCAnJyxcbiAgICAgICAgQ2F0ZWdvcmlhOiBsLmNhdCB8fCAnJyxcbiAgICAgICAgRmFtaWxpYTogbC5mYW0gfHwgJycsXG4gICAgICAgIFN1YmZhbWlsaWE6IGwuc3ViIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcbiAgICAgICAgLy8gU3VidG90YWxfQVJTID0gTkVUTyAoY29uIGRlc2N1ZW50byBhcGxpY2FkbykgLSBlcyBsbyBxdWUgY3VlbnRhXG4gICAgICAgIC8vIHBhcmEgZWwgdGFyZ2V0IGRlbCB2ZW5kZWRvci4gU3VidG90YWxfQnJ1dG9fQVJTIG11ZXN0cmEgZWwgdmFsb3JcbiAgICAgICAgLy8gZGUgbGlzdGEgc2luIGRlc2N1ZW50byBwYXJhIHRyYXphYmlsaWRhZC5cbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKG5ldCksXG4gICAgICAgIFN1YnRvdGFsX0JydXRvX0FSUzogTWF0aC5yb3VuZChncm9zcyksXG4gICAgICAgIERlc2N1ZW50b19QY3Q6IGRpc2NQY3QsXG4gICAgICAgIEVuX05vbWJyZV9EZV9WREU6IHAub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxuICAgICAgICBDYXJnYWRvX1BvcjogcC5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCBwLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1ZlbnRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnVmVudGFzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgVmVudGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuZnVuY3Rpb24gbG9va3VwVmVuZG9yRm9yQ2xpZW50KHByb3YsIGxvY05hbWUsIF9jbGllbnROYW1lKSB7XG4gIGlmICghcHJvdiB8fCAhbG9jTmFtZSkgcmV0dXJuICcnO1xuICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92ICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XG4gIHJldHVybiBwdCA/IHB0LnZlbmRvciB8fCAnJyA6ICcnO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZJU0lUQVM6IGRldGFsbGUgZGUgdmlzaXRhcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmlzaXRhcyArIENvbnRhY3Rvcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHZpc2l0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGFyZ2V0TWVzID0gbW9udGhJZHggIT09IG51bGwgPyBNRVNFU1ttb250aElkeF0udG9VcHBlckNhc2UoKSA6IG51bGw7XG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHYgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAocGFyc2VJbnQodi5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAodGFyZ2V0TWVzICYmICh2Lm1lcyB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdGFyZ2V0TWVzKSByZXR1cm47XG4gICAgaXRlbXMucHVzaCh2KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIG5pIGNvbnRhY3RvcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgblZpc2l0YXMgPSBpdGVtcy5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGg7XG4gIGNvbnN0IG5Db250YWN0b3MgPSBpdGVtcy5sZW5ndGggLSBuVmlzaXRhcztcbiAgLy8gRXhjZWxKUyBjb24gZm90byBkZWwgZnJlbnRlIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gTGF6eSBsb2FkLlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWw6ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnVmlzaXRhcyB5IENvbnRhY3RvcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdBbmlvJywga2V5OiAnYW5pbycsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdJbnRlcmFjY2lvbicsIGtleTogJ2ludGVyYWNjaW9uJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdGb3JtYSBDb250YWN0bycsIGtleTogJ2Zvcm1hQ29udGFjdG8nLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1Jlc3VsdGFkbyBDb250YWN0bycsIGtleTogJ3Jlc3VsdGFkb0N0Jywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsaWRhZCcsIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1JlbGV2YW5jaWEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ05lY2VzaWRhZCBQdW50dWFsJywga2V5OiAnbmVjJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdPcG9ydHVuaWRhZCcsIGtleTogJ29wb3J0dScsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnTWFzIFZlbmRpZG8nLCBrZXk6ICdtYXNWZScsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnTWFzIFByZWd1bnRhbicsIGtleTogJ21hc1ByJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdBeXVkYSBUaWVuZGEnLCBrZXk6ICdheXVkYScsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbyBWZW50YScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnUG9uZCBNb3N0cmFkb3InLCBrZXk6ICdwTW9zdCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUG9uZCBFY29tbWVyY2UnLCBrZXk6ICdwRWNvbScsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnR1BTIFN0YXR1cycsIGtleTogJ2dwc1N0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgRGlzdCAobSknLCBrZXk6ICdncHNEaXN0Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ0VuIG5vbWJyZSBkZSBWREUnLCBrZXk6ICdvbkJlaGFsZicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnQ2FyZ2FkbyBQb3InLCBrZXk6ICdjcmVhdGVkQnknLCB3aWR0aDogMjQgfSxcbiAgXTtcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxO1xuICBjb25zdCBST1dfSCA9IDEwMDtcbiAgY29uc3QgSU1HX1cgPSAxMzA7XG4gIGNvbnN0IElNR19IID0gOTA7XG5cbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCB2IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgaXNDb250YWN0byA9IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nO1xuICAgIGNvbnN0IGludGVyYWNjaW9uTGJsID0gaXNDb250YWN0byA/ICdDb250YWN0bycgOiAnVmlzaXRhJztcbiAgICBjb25zdCBmb3JtYUNvbnRhY3RvTGJsID0gaXNDb250YWN0byA/IHYuZm9ybWFDb250YWN0byB8fCAnU2luIGVzcGVjaWZpY2FyJyA6ICdQcmVzZW5jaWFsJztcbiAgICBsZXQgcmVzdWx0YWRvQ3RMYmwgPSAnJztcbiAgICBpZiAoaXNDb250YWN0bykge1xuICAgICAgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdyZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdSZXNwb25kaW8nO1xuICAgICAgZWxzZSBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ25vX3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ05vIHJlc3BvbmRpbyc7XG4gICAgICBlbHNlIHJlc3VsdGFkb0N0TGJsID0gJ1NpbiBtYXJjYXInO1xuICAgIH1cbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IHYuZmVjaGEgfHwgJycsXG4gICAgICBtZXM6IHYubWVzIHx8ICcnLFxuICAgICAgYW5pbzogdi5hbmlvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXG4gICAgICBlbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgaW50ZXJhY2Npb246IGludGVyYWNjaW9uTGJsLFxuICAgICAgZm9ybWFDb250YWN0bzogZm9ybWFDb250YWN0b0xibCxcbiAgICAgIHJlc3VsdGFkb0N0OiByZXN1bHRhZG9DdExibCxcbiAgICAgIGNvbWVudDogdi5jb21lbnRhcmlvIHx8ICcnLFxuICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxuICAgICAgbG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcbiAgICAgIHRpZW5kYTogdi50aWVuZGEgfHwgJycsXG4gICAgICB0aXBvOiB2LnRpcG8gfHwgJycsXG4gICAgICBsb2NhbDogdi5sb2NhbCB8fCAnJyxcbiAgICAgIHRhbWFubzogdi50YW1hbm8gfHwgJycsXG4gICAgICBmaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgcmVsZXY6IHYucmVsZXZhbmNpYSB8fCAnJyxcbiAgICAgIHBvcDogdi5wb3AgfHwgJycsXG4gICAgICBuZWM6IHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAgIG9wb3J0dTogdi5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgICBtYXNQcjogdi5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICBheXVkYTogdi5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgcE1vc3Q6IHYucG9uZGVyYWNpb25Nb3N0cmFkbyB8fCAnJyxcbiAgICAgIHBFY29tOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIHx8ICcnLFxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBncHNTdDogdi5ncHNTdGF0dXMgfHwgJycsXG4gICAgICBncHNEaXN0OiB2Lmdwc0Rpc3RhbmNlTSAhPSBudWxsID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGltYWdlbiBlbmNpbWFcbiAgICAgIG9uQmVoYWxmOiB2Lm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgIGNyZWF0ZWRCeTogdi5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCB2LmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgIH0pO1xuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byB2aXNpdGEnLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IGxpc3RvOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdGFzRm9yTW9udGgnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSRU5ESUNJT05FUzogZ2FzdG9zIHkgYW50aWNpcG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUmVuZGljaW9uZXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncmVuZGljaW9uZXMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHJlbmRpY2lvbmVzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZpbHRyYXIgcG9yIG1lcy9hbmlvXG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHIgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSByLmZlY2hhIHx8IHIuZmVjaGFHYXN0byB8fCAnJztcbiAgICBpZiAoIWR0ICYmIHIuY3JlYXRlZEF0ICYmIHIuY3JlYXRlZEF0LnRvRGF0ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZHQgPSByLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBpZiAoIWR0KSByZXR1cm47XG4gICAgY29uc3QgZE9iaiA9IG5ldyBEYXRlKGR0KTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRPYmouZ2V0VGltZSgpKSkgcmV0dXJuO1xuICAgIGlmIChkT2JqLmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZE9iai5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIGl0ZW1zLnB1c2goeyBpZDogZC5pZCwgZmVjaGE6IGR0LCByOiByIH0pO1xuICB9KTtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHJlbmRpY2lvbmVzIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gQ2FyZ2EgbGF6eS5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgaXRlbXMubGVuZ3RoICsgJyByZW5kaWNpb25lcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdSZW5kaWNpb25lcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjYgfSxcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0NvbmNlcHRvJywga2V5OiAnY29uY2VwdG8nLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ04gVGlja2V0Jywga2V5OiAnbnVtVGlja2V0Jywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdNb2RvIHBhZ28nLCBrZXk6ICdtb2RvUGFnbycsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbyBnYXN0bycsIGtleTogJ3RpcG9HYXN0bycsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnRGl2aXNpb24nLCBrZXk6ICdkaXZpc2lvbicsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZScsIGtleTogJ2ltcG9ydGUnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ01vbmVkYScsIGtleTogJ21vbmVkYScsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZSBVU0QnLCBrZXk6ICdpbXBvcnRlVXNkJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdPYnNlcnZhY2lvbmVzJywga2V5OiAnb2JzJywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdGb3RvIHRpY2tldCcsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ0VzdGFkbycsIGtleTogJ2VzdGFkbycsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG9yJywga2V5OiAnYXByb2JhZG9yJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkbyBlbicsIGtleTogJ2Fwcm9iYWRvRW4nLCB3aWR0aDogMTQgfSxcbiAgXTtcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjdFMjJDRScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxuICBjb25zdCBST1dfSCA9IDExMDtcbiAgY29uc3QgSU1HX1cgPSAxNDA7XG4gIGNvbnN0IElNR19IID0gMTAwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgaXQgb2YgaXRlbXMpIHtcbiAgICBjb25zdCByID0gaXQucjtcbiAgICBjb25zdCBpc0dhc3RvID0gci50aXBvID09PSAnZ2FzdG8nO1xuICAgIGNvbnN0IGNvbmNlcHRTdHIgPSBpc0dhc3RvID8gci5kZXNjcmlwY2lvbiB8fCAnJyA6IHIudGlwb09wZXJhY2lvbiB8fCByLm1vdGl2byB8fCAnJztcbiAgICBjb25zdCBvYnNTdHIgPVxuICAgICAgKHIub2JzZXJ2YWNpb25lcyB8fCByLm5vdGFzIHx8ICcnKSArXG4gICAgICAoaXNHYXN0byA/ICcnIDogci5zb2xpY2l0YWRvUG9yID8gJyB8IFNvbGljaXRhZG8gcG9yOiAnICsgci5zb2xpY2l0YWRvUG9yIDogJycpO1xuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogaXQuZmVjaGEsXG4gICAgICB0aXBvOiByLnRpcG8gfHwgJycsXG4gICAgICB2ZW5kZWRvcjogci5vd25lck5hbWUgfHwgci52ZW5kb3JOYW1lIHx8IHIub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGVtYWlsOiByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBjb25jZXB0bzogY29uY2VwdFN0cixcbiAgICAgIG51bVRpY2tldDogci5udW1lcm9UaWNrZXQgfHwgJycsXG4gICAgICBtb2RvUGFnbzogci5tb2RvUGFnbyB8fCAnJyxcbiAgICAgIHRpcG9HYXN0bzogci50aXBvR2FzdG8gfHwgJycsXG4gICAgICBkaXZpc2lvbjogci5kaXZpc2lvbkdhc3RvIHx8ICcnLFxuICAgICAgaW1wb3J0ZTogci5pbXBvcnRlICE9IG51bGwgPyByLmltcG9ydGUgOiAnJyxcbiAgICAgIG1vbmVkYTogci5tb25lZGEgfHwgJ1BFU09TJyxcbiAgICAgIGltcG9ydGVVc2Q6IHIuaW1wb3J0ZVVzZCAhPSBudWxsICYmIHIuaW1wb3J0ZVVzZCAhPT0gMCA/IHIuaW1wb3J0ZVVzZCA6ICcnLFxuICAgICAgb2JzOiBvYnNTdHIsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBlbmNpbWEgdmEgbGEgaW1hZ2VuXG4gICAgICBlc3RhZG86IHIuc3RhdHVzIHx8IHIuZXN0YWRvIHx8ICcnLFxuICAgICAgYXByb2JhZG9yOiByLmFwcHJvdmVyRW1haWwgfHwgci5hcHJvYmFkb3IgfHwgJycsXG4gICAgICBhcHJvYmFkb0VuOlxuICAgICAgICByLmFwcHJvdmVkQXQgJiYgci5hcHByb3ZlZEF0LnRvRGF0ZSA/IHIuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgIH0pO1xuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IFNJRU1QUkUgZW1iZWJlciBsYSBmb3RvIChubyBkZWphciBoeXBlcmxpbmspLlxuICAgIC8vIEFudGVzOiBzaSBmb3RvVGlja2V0VXJsIChTdG9yYWdlKSwgcXVlZGFiYSBjb21vIGh5cGVybGluayBBYnJpciB0aWNrZXQuXG4gICAgLy8gQWhvcmE6IGZldGNoIGRlbCBVUkwgKyBjb252ZXJ0aXIgYSBhcnJheUJ1ZmZlciArIGVtYmViZXIgaWd1YWwgcXVlIGRhdGFVUkwuXG4gICAgLy8gRmFsbGJhY2sgYSBoeXBlcmxpbmsgc29sbyBzaSBlbCBmZXRjaCBmYWxsYSAoQ09SUywgcmVkLCBldGMpLlxuICAgIGNvbnN0IGZvdG9TcmMgPSByLmZvdG9UaWNrZXQgfHwgci5hZGp1bnRvIHx8ICcnO1xuICAgIGlmIChmb3RvU3JjICYmIHR5cGVvZiBmb3RvU3JjID09PSAnc3RyaW5nJyAmJiBmb3RvU3JjLnN0YXJ0c1dpdGgoJ2RhdGE6aW1hZ2UvJykpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCBiNjQgPSBmb3RvU3JjO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHIuZm90b1RpY2tldFVybCAmJiB0eXBlb2Ygci5mb3RvVGlja2V0VXJsID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IGZldGNoIGxhIGZvdG8gZGVzZGUgU3RvcmFnZSB5IGVtYmViZXJsYSBjb21vIGltYWdlbi5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBmZXRjaChyLmZvdG9UaWNrZXRVcmwpO1xuICAgICAgICBpZiAoIXJlc3Aub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgcmVzcC5zdGF0dXMpO1xuICAgICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlc3AuaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpIHx8ICdpbWFnZS9qcGVnJztcbiAgICAgICAgbGV0IGV4dCA9IGNvbnRlbnRUeXBlLnNwbGl0KCcvJylbMV0gfHwgJ2pwZWcnO1xuICAgICAgICBleHQgPSBleHQuc3BsaXQoJzsnKVswXS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgYnVmID0gYXdhaXQgcmVzcC5hcnJheUJ1ZmZlcigpO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBidWZmZXI6IGJ1ZiwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIEZhbGxiYWNrOiBzaSBlbCBmZXRjaCBmYWxsYSAoQ09SUywgcmVkKSwgZGVqYXIgaHlwZXJsaW5rIGNvbW8gYW50ZXMuXG4gICAgICAgIGNvbnNvbGUud2FybignZmV0Y2ggZm90byByZW5kaWNpb24gZmFsbG8sIGRlam8gaHlwZXJsaW5rJywgaXQuaWQsIGUpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGNlbGwgPSByb3cuZ2V0Q2VsbChGT1RPX0NPTF9JRFggKyAxKTtcbiAgICAgICAgICBjZWxsLnZhbHVlID0ge1xuICAgICAgICAgICAgdGV4dDogJ0FicmlyIHRpY2tldCcsXG4gICAgICAgICAgICBoeXBlcmxpbms6IHIuZm90b1RpY2tldFVybCxcbiAgICAgICAgICAgIHRvb2x0aXA6ICdBYnJpciBsYSBmb3RvIGRlbCB0aWNrZXQgZW4gZWwgYnJvd3NlciAoZmV0Y2ggZmFsbG8pJyxcbiAgICAgICAgICB9O1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGMDU2M0MxJyB9LCB1bmRlcmxpbmU6IHRydWUgfTtcbiAgICAgICAgfSBjYXRjaCAoX2UyKSB7fVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19SZW5kaWNpb25lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFJlbmRpY2lvbmVzIGxpc3RvICgnICsgaXRlbXMubGVuZ3RoICsgJyBmaWxhcyknLCAyNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSVVRBUzogcnV0YXMgYXNpZ25hZGFzIGRlbCBwZXJpb2RvICsgb3ZlcnJpZGVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUnV0YXMuLi4nKTtcbiAgLy8gTGFzIHJ1dGFzIHNlIGdlbmVyYW4gZW4gcnVudGltZSBwYXJhIGNhZGEgdmVuZGVkb3I7IGVuIGNhbWJpbyBsb3Mgb3ZlcnJpZGVzXG4gIC8vIChkZXJpdmFjaW9uZXMgLyByZWFnZW5kYXMpIHZpdmVuIGVuIHJvdXRlX292ZXJyaWRlcy4gRXhwb3J0YW1vczpcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxhcyBydXRhcyBwbGFuaWZpY2FkYXMgZGVsIHBlcmlvZG8gKHBhcmEgbG9zIHZlbmRlZG9yZXNcbiAgLy8gICAgZGVsIHJvbCBhY3R1YWwgbyB0b2RvcyBzaSBhZG1pbilcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxvcyBvdmVycmlkZXMgZGVsIHBlcmlvZG9cbiAgY29uc3QgdGFyZ2V0VmVuZG9ycyA9XG4gICAgdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICd2aWV3ZXInXG4gICAgICA/IFZFTkRPUlMubWFwKCh2KSA9PiB2LmtleSlcbiAgICAgIDogYXNzaWduZWRWZW5kb3JcbiAgICAgICAgPyBbYXNzaWduZWRWZW5kb3JdXG4gICAgICAgIDogW107XG4gIGNvbnN0IG1vbnRoc1RvRXhwb3J0ID0gbW9udGhJZHggIT09IG51bGwgPyBbbW9udGhJZHhdIDogWzAsIDEsIDIsIDMsIDQsIDUsIDYsIDcsIDgsIDksIDEwLCAxMV07XG4gIGNvbnN0IHJ1dGFzUm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IHZlbmQgb2YgdGFyZ2V0VmVuZG9ycykge1xuICAgIGZvciAoY29uc3QgbSBvZiBtb250aHNUb0V4cG9ydCkge1xuICAgICAgbGV0IHJ1dGFzO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcnV0YXMgPSBnZW5lcmFyUnV0YXNWZW5kb3IodmVuZCwgbSwgYW5pbyk7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICBydXRhcyA9IFtdO1xuICAgICAgfVxuICAgICAgKHJ1dGFzIHx8IFtdKS5mb3JFYWNoKChydXRhKSA9PiB7XG4gICAgICAgIChydXRhLnRpZW5kYXMgfHwgW10pLmZvckVhY2goKHQsIGkpID0+IHtcbiAgICAgICAgICBydXRhc1Jvd3MucHVzaCh7XG4gICAgICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmQpLFxuICAgICAgICAgICAgQW5pbzogYW5pbyxcbiAgICAgICAgICAgIE1lczogTUVTRVNbbV0sXG4gICAgICAgICAgICBSdXRhX0lEOiBydXRhLmlkIHx8ICcnLFxuICAgICAgICAgICAgUnV0YV9Ob21icmU6IHJ1dGEubm9tYnJlIHx8ICcnLFxuICAgICAgICAgICAgRmVjaGFfQXNpZ25hZGE6IHJ1dGEuZmVjaGFBc2lnbmFkYSB8fCAnJyxcbiAgICAgICAgICAgIE9yZGVuOiBpICsgMSxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHQucHJvdmluY2UgfHwgJycpLFxuICAgICAgICAgICAgTG9jYWxpZGFkOiB0LmxvY05hbWUgfHwgJycsXG4gICAgICAgICAgICBUaWVuZGE6IHQuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgICAgIFRpcG86IHQudGlwbyB8fCAnJyxcbiAgICAgICAgICAgIEVzdGFkbzogdC5lc3RhZG8gfHwgJycsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIC8vIE92ZXJyaWRlc1xuICBsZXQgb3ZyU25hcDtcbiAgdHJ5IHtcbiAgICBvdnJTbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb3V0ZV9vdmVycmlkZXMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBvdnJTbmFwID0gbnVsbDtcbiAgfVxuICBjb25zdCBvdmVycmlkZXNSb3dzID0gW107XG4gIGlmIChvdnJTbmFwKSB7XG4gICAgb3ZyU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBjb25zdCBvID0gZC5kYXRhKCkgfHwge307XG4gICAgICBpZiAocGFyc2VJbnQoby5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChvLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgICBvdmVycmlkZXNSb3dzLnB1c2goe1xuICAgICAgICBBbmlvOiBvLmFuaW8gfHwgJycsXG4gICAgICAgIE1lczogTUVTRVNbcGFyc2VJbnQoby5tb250aElkeCwgMTApXSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZShvLnZlbmRvciB8fCAnJyksXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKG8ucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IG8ubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgVGllbmRhOiBvLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIEFjY2lvbjogby5hY3Rpb24gfHwgby50aXBvIHx8ICcnLFxuICAgICAgICBEZXJpdmFkYV9BOiBvLmRlcml2YWRhQSB8fCAnJyxcbiAgICAgICAgUmVhZ2VuZGFkYV9QYXJhOiBvLnJlYWdlbmRhZGFQYXJhIHx8ICcnLFxuICAgICAgICBNb3Rpdm86IG8ubW90aXZvIHx8ICcnLFxuICAgICAgICBDcmVhZG9fUG9yOiBvLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgICBDcmVhZG9fRW46XG4gICAgICAgICAgby5jcmVhdGVkQXQgJiYgby5jcmVhdGVkQXQudG9EYXRlID8gby5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUnV0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1J1dGFzIHBsYW5pZmljYWRhcycsIHJvd3M6IHJ1dGFzUm93cyB9LFxuICAgIHsgbmFtZTogJ0Rlcml2YWNpb25lcy1SZWFnZW5kYXMnLCByb3dzOiBvdmVycmlkZXNSb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IFJ1dGFzIGxpc3RvICgnICsgcnV0YXNSb3dzLmxlbmd0aCArICcgdGllbmRhcywgJyArIG92ZXJyaWRlc1Jvd3MubGVuZ3RoICsgJyBvdmVycmlkZXMpJyxcbiAgICAyNDAwXG4gICk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQUxUQVM6IHNvbGljaXR1ZGVzIGRlIGFsdGEgZGUgY2xpZW50ZSBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEFsdGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9ICcnO1xuICAgIGlmIChhLmNyZWF0ZWRBdCAmJiBhLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gYS5jcmVhdGVkQXQudG9EYXRlKCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGlmIChkdC5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGR0LmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1NvbGljaXR1ZDogZHQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXG4gICAgICBFc3RhZG86IGEuc3RhdHVzIHx8ICcnLFxuICAgICAgQ29tZXJjaW86IGEuY29tZXJjaW8gfHwgJycsXG4gICAgICBGYW50YXNpYTogYS5mYW50YXNpYSB8fCAnJyxcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcbiAgICAgIENvbmRpY2lvbl9GaXNjYWw6IGEuY29uZEZpc2NhbCB8fCAnJyxcbiAgICAgIENhbGxlOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTnVtZXJvOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYS5sb2NhbGlkYWQgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGEucHJvdmluY2lhIHx8ICcnLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICBUZWxlZm9ubzogYS50ZWxlZm9ubyB8fCAnJyxcbiAgICAgIEVtYWlsOiBhLmVtYWlsIHx8ICcnLFxuICAgICAgVmVuZGVkb3JfU29saWNpdGFudGU6IGEudmVuZG9yTmFtZSB8fCBhLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBPd25lcl9FbWFpbDogYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgU3VibWl0dGVkX0J5X1B1YmxpY19Gb3JtOiBhLnN1Ym1pdHRlZEJ5UHVibGljRm9ybSA/ICdTSScgOiAnTk8nLFxuICAgICAgQXByb2JhZG9fUG9yOiBhLmFwcHJvdmVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIEFwcm9iYWRvX0VuOlxuICAgICAgICBhLmFwcHJvdmVkQXQgJiYgYS5hcHByb3ZlZEF0LnRvRGF0ZSA/IGEuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgUmVjaGF6YWRvX01vdGl2bzogYS5yZWplY3RlZFJlYXNvbiB8fCAnJyxcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQWx0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0FsdGFzIGRlIGNsaWVudGVzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQWx0YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgc29saWNpdHVkZXMpJywgMjQwMCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gdjcwOSAoMjAyNi0wOC0yOCk6IDMgZXhwb3J0cyBudWV2b3MgcGVkaWRvcyBwb3IgTWFyaWFuby5cbi8vIC0gQkFDS09SREVSOiBsaW5lYXMgc3RhdGU9Qk8gb3BlbiBwb3IgbWVzIGRlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLlxuLy8gLSBTVE9DS19BU0lHOiBsaW5lYXMgQVNJRyBvcGVuIChvIEJPK3N0b2NrIGRpc3ApIHBvciBtZXMgZGUgY3JlYXRlZEF0LlxuLy8gLSBQRURJRE9TX01FUzogVE9ET1MgbG9zIHBlZGlkb3MgY3JlYWRvcyBlbiBlbCBtZXMvYW5pbyAoY3VhbHF1aWVyIHN0YWdlKS5cbi8vIEZ1ZW50ZTogZ2xvYmFsUGVkaWRvcyAobG8gcXVlIGxhIGFwcCB5YSB0aWVuZSBlbiBtZW1vcmlhKS5cbi8vIEZpbHRlciBtZXMvYVx1MDBGMW86IHNvYnJlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLiBtb250aElkeD1udWxsIC0+IGFcdTAwRjFvIGVudGVyby5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuZnVuY3Rpb24gX3BlZGlkb01vbnRoWWVhcihwKSB7XG4gIGNvbnN0IGNhID0gcC5jcmVhdGVkQXQ7XG4gIGlmICghY2EpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgbGV0IGR0ID0gbnVsbDtcbiAgaWYgKHR5cGVvZiBjYSA9PT0gJ3N0cmluZycpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBlbHNlIGlmICh0eXBlb2YgY2EudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGR0ID0gY2EudG9EYXRlKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhID09PSAnbnVtYmVyJykgZHQgPSBuZXcgRGF0ZShjYSk7XG4gIGlmICghZHQgfHwgTnVtYmVyLmlzTmFOKGR0LmdldFRpbWUoKSkpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgcmV0dXJuIHsgeTogZHQuZ2V0RnVsbFllYXIoKSwgbTogZHQuZ2V0TW9udGgoKSB9O1xufVxuXG5mdW5jdGlvbiBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpIHtcbiAgY29uc3QgYXJyID1cbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgcmV0dXJuIGFyci5maWx0ZXIoKHApID0+IHtcbiAgICBpZiAoIXApIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCB7IHksIG0gfSA9IF9wZWRpZG9Nb250aFllYXIocCk7XG4gICAgaWYgKHkgPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh5ICE9PSBhbmlvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIG0gIT09IG1vbnRoSWR4KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIuLi4nKTtcbiAgLy8gdjExMDA6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvLiBGaWx0cmEgcG9yIG1lcyB2XHUwMEVEYSBmaWx0ZXJzLm1lc1lZWVlNTVxuICAvLyAocXVlIGVsIG1cdTAwRjNkdWxvIGFwbGljYSBzb2JyZSBjb25maXJtZWRBdCkuIENvaW5jaWRlIGNvbiBlbCBtb2RhbC5cbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBjb21wdXRlRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzO1xuICBjb25zdCBtZXNZWVlZTU0gPSBhbmlvICsgJy0nICsgU3RyaW5nKG1vbnRoSWR4ICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIC8vIHYxMTAxICgyMDI2LTA5LTMwKTogYnVzY2FyIHByaW1lcm8gcG9yIHNhcENhcmRDb2RlIChcdTAwRkFuaWNvLCBubyBkZXBlbmRlIGRlXG4gIC8vIG5vcm1hbGl6YWNpXHUwMEYzbiBkZSBzdHJpbmdzKSB5IHNcdTAwRjNsbyBjYWVyIGFsIGNsaWVudExvY0lkIGNvbW8gXHUwMEZBbHRpbW8gcmVjdXJzby5cbiAgLy8gVmVyIGNvbWVudGFyaW8gZXh0ZW5kaWRvIGVuIGluZGV4Lmh0bWw6ZXhwb3J0QmFja29yZGVyc1RvRXhjZWwuXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZSA9IHcuY2xpZW50TWFzdGVyQ2FjaGU7XG4gICAgICBpZiAoIWNhY2hlKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjYyA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICBpZiAoY2MgJiYgdHlwZW9mIGNhY2hlLmZvckVhY2ggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgbGV0IGZvdW5kID0gJyc7XG4gICAgICAgIGNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgICAgICAgIGlmIChmb3VuZCkgcmV0dXJuO1xuICAgICAgICAgIGlmIChjbURhdGEgJiYgU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpID09PSBjYyAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHtcbiAgICAgICAgICAgIGZvdW5kID0gY21EYXRhLmFzc2lnbmVkVmVuZG9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiBjYWNoZS5nZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgICBjb25zdCBjbURhdGEgPSBjYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgICB9XG4gICAgICByZXR1cm4gJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIHBlZGlkb3MsXG4gICAgICAgICd1cmdlbnRlJyxcbiAgICAgICAgeyBtZXNZWVlZTU0gfSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSBpZiAocCAmJiBwLl9mc0lkKSBwZWRpZG9CeUlkW3AuX2ZzSWRdID0gcDtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICByYXdMaW5lcy5mb3JFYWNoKChybCkgPT4ge1xuICAgIGNvbnN0IGMgPSBybC5jbGllbnRlO1xuICAgIGNvbnN0IHAgPSBjLnBlZGlkb0lkID8gcGVkaWRvQnlJZFtjLnBlZGlkb0lkXSA6IG51bGw7XG4gICAgY29uc3QgcW8gPSBjLnF0eUJhY2tvcmRlciB8fCAwO1xuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xuICAgIGlmIChjLnBlZGlkb0NyZWF0ZWRBdCkge1xuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcbiAgICAgIGZlY2hhUGVkaWRvID1cbiAgICAgICAgdHlwZW9mIGR0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICB9XG4gICAgbGV0IGNhbnRpZGFkUGVkaWRhID0gcW87XG4gICAgbGV0IGxpbmVhSWR4ID0gLTE7XG4gICAgaWYgKHAgJiYgQXJyYXkuaXNBcnJheShwLmxpbmVzKSkge1xuICAgICAgY29uc3QgaWR4ID0gcC5saW5lcy5maW5kSW5kZXgoXG4gICAgICAgIChsKSA9PiBsICYmIFN0cmluZyhsLmNvZGUgfHwgJycpLnRvVXBwZXJDYXNlKCkgPT09IHJsLnNrdSAmJiBsLnN0YXRlID09PSBjLnN0YXRlXG4gICAgICApO1xuICAgICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICAgIGNhbnRpZGFkUGVkaWRhID0gTnVtYmVyKHAubGluZXNbaWR4XS5xdHkpIHx8IHFvO1xuICAgICAgICBsaW5lYUlkeCA9IGlkeDtcbiAgICAgIH1cbiAgICB9XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXG4gICAgICBNZXM6IChwICYmIHAubW9udGgpIHx8ICcnLFxuICAgICAgQ2xpZW50ZTogYy5ub21icmUgfHwgJycsXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBjLnByb3ZpbmNpYSB8fCAocCAmJiBwLnByb3ZpbmNlKSB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYy5jaXVkYWQgfHwgKHAgJiYgcC5sb2NOYW1lKSB8fCAnJyxcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcbiAgICAgIFNLVTogcmwuc2t1IHx8ICcnLFxuICAgICAgUHJvZHVjdG86IHJsLnByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ2FudGlkYWRfUGVkaWRhOiBjYW50aWRhZFBlZGlkYSxcbiAgICAgIENhbnRpZGFkX1BlbmRpZW50ZV9CTzogcW8sXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQocW8gKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19CYWNrb3JkZXJfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFN0b2NrIEFzaWduYWRvLi4uJyk7XG4gIC8vIHYxMTAwOiBkZWxlZ2EgYWwgbVx1MDBGM2R1bG8gcHVybyBtb2RvIGFzaWduYWNpb24uIENvaW5jaWRlIGNvbiBlbCBtb2RhbC5cbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBjb21wdXRlRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzO1xuICBjb25zdCBtZXNZWVlZTU0gPSBhbmlvICsgJy0nICsgU3RyaW5nKG1vbnRoSWR4ICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIC8vIHYxMTAxICgyMDI2LTA5LTMwKTogYnVzY2FyIHByaW1lcm8gcG9yIHNhcENhcmRDb2RlIChcdTAwRkFuaWNvLCBubyBkZXBlbmRlIGRlXG4gIC8vIG5vcm1hbGl6YWNpXHUwMEYzbiBkZSBzdHJpbmdzKSB5IHNcdTAwRjNsbyBjYWVyIGFsIGNsaWVudExvY0lkIGNvbW8gXHUwMEZBbHRpbW8gcmVjdXJzby5cbiAgLy8gVmVyIGNvbWVudGFyaW8gZXh0ZW5kaWRvIGVuIGluZGV4Lmh0bWw6ZXhwb3J0QmFja29yZGVyc1RvRXhjZWwuXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZSA9IHcuY2xpZW50TWFzdGVyQ2FjaGU7XG4gICAgICBpZiAoIWNhY2hlKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjYyA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICBpZiAoY2MgJiYgdHlwZW9mIGNhY2hlLmZvckVhY2ggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgbGV0IGZvdW5kID0gJyc7XG4gICAgICAgIGNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgICAgICAgIGlmIChmb3VuZCkgcmV0dXJuO1xuICAgICAgICAgIGlmIChjbURhdGEgJiYgU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpID09PSBjYyAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHtcbiAgICAgICAgICAgIGZvdW5kID0gY21EYXRhLmFzc2lnbmVkVmVuZG9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiBjYWNoZS5nZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgICBjb25zdCBjbURhdGEgPSBjYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgICB9XG4gICAgICByZXR1cm4gJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIHBlZGlkb3MsXG4gICAgICAgICdhc2lnbmFjaW9uJyxcbiAgICAgICAgeyBtZXNZWVlZTU0gfSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSBpZiAocCAmJiBwLl9mc0lkKSBwZWRpZG9CeUlkW3AuX2ZzSWRdID0gcDtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICByYXdMaW5lcy5mb3JFYWNoKChybCkgPT4ge1xuICAgIGNvbnN0IGMgPSBybC5jbGllbnRlO1xuICAgIGNvbnN0IHAgPSBjLnBlZGlkb0lkID8gcGVkaWRvQnlJZFtjLnBlZGlkb0lkXSA6IG51bGw7XG4gICAgY29uc3QgcXR5ID0gYy5xdHlBc2lnbmFkYSB8fCAwO1xuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xuICAgIGlmIChjLnBlZGlkb0NyZWF0ZWRBdCkge1xuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcbiAgICAgIGZlY2hhUGVkaWRvID1cbiAgICAgICAgdHlwZW9mIGR0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICB9XG4gICAgbGV0IGxpbmVhSWR4ID0gLTE7XG4gICAgaWYgKHAgJiYgQXJyYXkuaXNBcnJheShwLmxpbmVzKSkge1xuICAgICAgY29uc3QgaWR4ID0gcC5saW5lcy5maW5kSW5kZXgoXG4gICAgICAgIChsKSA9PiBsICYmIFN0cmluZyhsLmNvZGUgfHwgJycpLnRvVXBwZXJDYXNlKCkgPT09IHJsLnNrdSAmJiBsLnN0YXRlID09PSBjLnN0YXRlXG4gICAgICApO1xuICAgICAgaWYgKGlkeCA+PSAwKSBsaW5lYUlkeCA9IGlkeDtcbiAgICB9XG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XG4gICAgaWYgKGMuc3RhdGUgPT09ICdCTycpIGVzdGFkb1JlYWwgPSAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJztcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcXR5LFxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHF0eSAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgIH0pO1xuICB9KTtcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdTdG9jayBBc2lnbmFkbycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWduYWRvIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuLy8gdjczNyAoMjAyNi0wOC0zMCk6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvcyBsb3MgYmFja29yZGVycyBvcGVuIChzaW4gZmlsdHJvXG4vLyBkZSBtZXMpLiBNb3Rpdm86IGxvcyA2MiBwZWRpZG9zIG1pZ3JhZG9zIGRlc2RlIFNBUCBlbCAyMDI2LTA4LTI4IHRpZW5lblxuLy8gY3JlYXRlZEF0IGRlIGZlY2hhcyB2aWVqYXMgZGVsIFNBUCBTUSBvcmlnaW5hbCwgZW50b25jZXMgZWwgZXhwb3J0IHBvciBtZXNcbi8vIG5vIGxvcyBpbmNsdWlhLiBWZXJzaW9uIFwiY3VycmVudCBzdGF0dXNcIiBxdWUgaXRlcmEgZ2xvYmFsUGVkaWRvcyBjb21wbGV0by5cbndpbmRvdy5leHBvcnRCYWNrb3JkZXJBbGwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlciAoc25hcHNob3QgYWN0dWFsKS4uLicpO1xuICAvLyB2MTEwMCAoMjAyNi0wOS0zMCk6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvIGJhY2tvcmRlci1za3UtbWFwIFx1MjAxNCBtaXNtb1xuICAvLyBGSUZPICsgZmlsdHJvIHZlbmNpZGFzICsgZXN0YWRvcyAoQk8rQVNJRytjb25maXJtZWQpIHF1ZSBlbCBtb2RhbC4gQW50ZXNcbiAgLy8gZXN0ZSBleHBvcnQgZXJhIHVuIGR1bXAgY3J1ZG8gZGUgbFx1MDBFRG5lYXMgc3RhdGU9Qk8gc2luIGNhcCBuaSBmaWx0cm9cbiAgLy8gdmVuY2lkYXMsIGFzXHUwMEVEIHF1ZSBkaXZlcmdcdTAwRURhIGRlbCBtb2RhbC4gQWhvcmEgZXMgcGFyaWRhZCB0b3RhbC5cbiAgY29uc3QgYXJyID1cbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgY29uc3QgdG90YWxQZWRpZG9zT3BlbiA9IGFyci5maWx0ZXIoKHApID0+IHAgJiYgIXAuY2xvc2VkQXQpLmxlbmd0aDtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgIT09ICdmdW5jdGlvbicgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICBjb25zdCBjbURhdGEgPSB3LmNsaWVudE1hc3RlckNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBjb21wdXRlRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzO1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBhcnIsXG4gICAgICAgICd1cmdlbnRlJyxcbiAgICAgICAge30sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgLy8gXHUwMENEbmRpY2UgcGVkaWRvSWQgXHUyMTkyIHBlZGlkbyBwYXJhIGVucmlxdWVjZXIgY29uIGNhbXBvcyBxdWUgZWwgbVx1MDBGM2R1bG8gbm8gZXhwb25lXG4gIC8vIChNZXMsIENhbnRpZGFkX1BlZGlkYSBvcmlnaW5hbCwgT3JpZ2VuLCBMaW5lYV9JZHgpLlxuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBhcnIpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICAvLyBDYW50aWRhZF9QZW5kaWVudGVfQk8gPSBxdHlCYWNrb3JkZXIgcG9zdC1GSUZPLlxuICAgIGNvbnN0IHFvID0gYy5xdHlCYWNrb3JkZXIgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIC8vIFJlY3VwZXJhciBsYSBsXHUwMEVEbmVhIG9yaWdpbmFsIHBhcmEgQ2FudGlkYWRfUGVkaWRhICsgTGluZWFfSWR4IChzaSBoYXkgcGVkaWRvKS5cbiAgICBsZXQgY2FudGlkYWRQZWRpZGEgPSBxbztcbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgICAgY2FudGlkYWRQZWRpZGEgPSBOdW1iZXIocC5saW5lc1tpZHhdLnF0eSkgfHwgcW87XG4gICAgICAgIGxpbmVhSWR4ID0gaWR4O1xuICAgICAgfVxuICAgIH1cbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9QZWRpZGE6IGNhbnRpZGFkUGVkaWRhLFxuICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcbiAgICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZChxbyAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXG4gICAgICAvLyB2MTEwMDogY29udGV4dG8gXHUwMEZBdGlsIHBhcmEgZGVidWdnaW5nIHBhcmlkYWQgbW9kYWxcdTIxOTRyZXBvcnRlLlxuICAgICAgRXN0YWRvOiBjLnN0YXRlIHx8ICdCTycsXG4gICAgICBTdG9ja19EaXNwX1NLVTogcmwuZGlzcFNhcCB8fCAwLFxuICAgIH0pO1xuICB9KTtcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoXG4gICAgICAnRXhwb3J0IEJhY2tvcmRlciB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlCYWNrb3JkZXI+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IGJhY2tvcmRlciBhYmllcnRvIGFob3JhIG1pc21vICh0b2RvIGNvbmZpcm1lZCwgY2VycmFkbyBvIHZlbmNpZG8pXFxuJyArXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcbiAgICAgICAgJzMuIFRvZGFzIGxhcyBsaW5lYXMgQk8gdGllbmVuIHN0b2NrIGRpc3BvbmlibGUgKGZ1ZXJvbiBwcm9tb3ZpZGFzIGEgQVNJRyB2aXJ0dWFsKSdcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59O1xuXG4vLyB2NzM3OiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kbyBlbCBTdG9jayBBc2lnbmFkbyAoc2luIGZpbHRybyBkZSBtZXMpLiBNaXNtb1xuLy8gbW90aXZvIHF1ZSBleHBvcnRCYWNrb3JkZXJBbGwuXG53aW5kb3cuZXhwb3J0U3RvY2tBc2lnQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkbyAoc25hcHNob3QgYWN0dWFsKS4uLicpO1xuICAvLyB2MTEwMCAoMjAyNi0wOS0zMCk6IG1pc21vIG1cdTAwRjNkdWxvIHB1cm8gcXVlIHJlbmRlckJhY2tvcmRlcnNUYWIgZW4gbW9kb1xuICAvLyBhc2lnbmFjaW9uLiBBaG9yYSBlbCByZXBvcnRlIGNvaW5jaWRlIGNvbiBlbCBtb2RhbDogRklGTyBjYXAgcG9yIGRpc3BTYXAsXG4gIC8vIGZpbHRybyB2ZW5jaWRhcyAoQVNJRyA+MTVkIGZ1ZXJhLCBBU0lHIHNpbiByZXNlcnZhIHZpZ2VudGUgYWRlbnRybyksXG4gIC8vIGNvbmZpcm1lZCBpbmNsdWlkbywgc2luIGxcdTAwRURuZWFzIFwidmlydHVhbF9BU0lHXCIgZmFudGFzbWEuXG4gIGNvbnN0IGFyciA9XG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gIGNvbnN0IHRvdGFsUGVkaWRvc09wZW4gPSBhcnIuZmlsdGVyKChwKSA9PiBwICYmICFwLmNsb3NlZEF0KS5sZW5ndGg7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkICE9PSAnZnVuY3Rpb24nIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlLmdldClcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgY29uc3QgY21EYXRhID0gdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgYXJyLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHt9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIGFycikgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIC8vIEVzdGFkb19SZWFsOiBoaXN0XHUwMEYzcmljbyBcIkJPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKVwiIHZzIFwiQVNJR1wiLiB2MTEwMDpcbiAgICAvLyBhaG9yYSBgY29uZmlybWVkYCB0YW1iaVx1MDBFOW4gZW50cmEgKHY5NjIpLiBQcmVzZXJ2YW1vcyBldGlxdWV0YSBsZWdhY3lcbiAgICAvLyBwb3IgY29tcGF0aWJpbGlkYWQgY29uIHF1aWVuIGNvbnN1bWUgZWwgRXhjZWwuXG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XG4gICAgaWYgKGMuc3RhdGUgPT09ICdCTycpIGVzdGFkb1JlYWwgPSAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJztcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcXR5LFxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHF0eSAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXG4gICAgICAvLyB2MTEwMDogY29udGV4dG8gXHUwMEZBdGlsIHBhcmEgZGVidWdnaW5nIHBhcmlkYWQgbW9kYWxcdTIxOTRyZXBvcnRlLlxuICAgICAgU3RvY2tfRGlzcF9TS1U6IHJsLmRpc3BTYXAgfHwgMCxcbiAgICB9KTtcbiAgfSk7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlBc2lnbmFkYT4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgc3RvY2sgYXNpZ25hZG8gYWhvcmEgbWlzbW9cXG4nICtcbiAgICAgICAgJzIuIFRvZG9zIGxvcyBBU0lHIGVzdGFuIHZlbmNpZG9zICg+MTVkIGRlc2RlIGFzaWdBdClcXG4nICtcbiAgICAgICAgJzMuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fU25hcHNob3RfJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59O1xuXG4vLyB2OTc1ICgyMDI2LTA5LTE3KTogcmVzdWVsdmUgbm9tYnJlIGRlIGZhbnRhc2lhIHBhcmEgdW4gcGVkaWRvIHVzYW5kbyBlbFxuLy8gbWlzbW8gcGF0dGVybiBxdWUgbGFzIGNhcmRzIGRlbCBtYXBhIChpbmRleC5odG1sOjk5MTUtOTkzNSk6XG4vLyAgIDEpIGNsaWVudE1ldGFbY2FyZENvZGVdLmN1c3RvbUZhbnRhc2lhIChlZGl0YWRvIGRlc2RlIGVsIG1vZGFsIGNsaWVudGUpXG4vLyAgIDIpIGFwcHJvdmVkQWx0YXNMaXN0W10uZmFudGFzaWEgbWF0Y2hlYWRvIHBvciBjb21lcmNpbyA9PSBjbGllbnROYW1lXG5mdW5jdGlvbiBfcmVzb2x2ZUZhbnRhc2lhRm9yUGVkaWRvKHApIHtcbiAgY29uc3QgY2FyZENvZGUgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICBpZiAoY2FyZENvZGUpIHtcbiAgICBjb25zdCBtZXRhID0gLyoqIEB0eXBlIHthbnl9ICovIChnbG9iYWxUaGlzKS5jbGllbnRNZXRhO1xuICAgIGNvbnN0IGN1c3RvbSA9IG1ldGEgJiYgbWV0YVtjYXJkQ29kZV0gJiYgbWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWE7XG4gICAgaWYgKGN1c3RvbSAmJiBTdHJpbmcoY3VzdG9tKS50cmltKCkpIHJldHVybiBTdHJpbmcoY3VzdG9tKS50cmltKCk7XG4gIH1cbiAgY29uc3QgYWx0YXMgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmFwcHJvdmVkQWx0YXNMaXN0O1xuICBpZiAoQXJyYXkuaXNBcnJheShhbHRhcykpIHtcbiAgICBjb25zdCBuYW1lTG93ZXIgPSBTdHJpbmcocC5jbGllbnROYW1lIHx8ICcnKVxuICAgICAgLnRyaW0oKVxuICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKG5hbWVMb3dlcikge1xuICAgICAgY29uc3QgbWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiB7XG4gICAgICAgIGlmICghYSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBjID0gU3RyaW5nKGEuY29tZXJjaW8gfHwgJycpXG4gICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBjb25zdCBmID0gU3RyaW5nKGEuZmFudGFzaWEgfHwgJycpXG4gICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICByZXR1cm4gYyA9PT0gbmFtZUxvd2VyIHx8IGYgPT09IG5hbWVMb3dlcjtcbiAgICAgIH0pO1xuICAgICAgaWYgKG1hdGNoICYmIG1hdGNoLmZhbnRhc2lhICYmIFN0cmluZyhtYXRjaC5mYW50YXNpYSkudHJpbSgpKSB7XG4gICAgICAgIHJldHVybiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuICcnO1xufVxuXG4vLyB2MTIzMyAoMjAyNi0xMC0wOSk6IHJlcG9ydGUgXCJWZW50YXMgeCBhcnRpY3VsbyB4IGNsaWVudGUvdmVuZGVkb3JcIiB2aWEgQ0YuXG4vLyBBZG1pbi9nZXJlbnRlIG9ubHkuIFRhcmRhIH4zMC02MHMgKEJRIHF1ZXJ5ICsgZXhjZWxqcyBidWlsZCBzZXJ2ZXItc2lkZSkuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRWZW50YXNBcnRDbGlGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkge1xuICAgIGFsZXJ0KCdFbGVnXHUwMEVEIHVuIE1FUyBlc3BlY1x1MDBFRGZpY28gKG5vIFwiVG9kbyBlbCBhXHUwMEYxb1wiKSBcdTIwMTQgZXN0ZSByZXBvcnRlIGVzIG1lbnN1YWwuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIG1vbnRoSWR4IHZpZW5lIDAtYmFzZWQgZGVzZGUgZWwgcGlja2VyIChlbmU9MCkuIENGIGVzcGVyYSAxLWJhc2VkLlxuICBjb25zdCBtb250aCA9IG1vbnRoSWR4ICsgMTtcbiAgY29uc3QgeWVhciA9IGFuaW87XG4gIGNvbnN0IHBlcmlvZG8gPSAod2luZG93Lk1FU0VTID8gd2luZG93Lk1FU0VTW21vbnRoSWR4XSA6IG1vbnRoKSArICcgJyArIHllYXI7XG4gIGNvbnN0IGNvbmZpcm1Nc2cgPVxuICAgICdHZW5lcmFyIHJlcG9ydGUgXCJWRU5UQVMgeCBBUlRJQ1VMTyB4IENMSUVOVEUvVkVOREVET1JcIiBkZSAnICtcbiAgICBwZXJpb2RvICtcbiAgICAnP1xcblxcbicgK1xuICAgICdGdWVudGU6IFNBUCB2aWEgQmlnUXVlcnkgKGRhdG9zIGV4YWN0b3MpLlxcbicgK1xuICAgICdQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuXFxuJyArXG4gICAgJ0FsIHRlcm1pbmFyIHNlIGRlc2NhcmdhIGF1dG9tYXRpY2FtZW50ZSBlbCB4bHN4Lic7XG4gIGlmICghY29uZmlybShjb25maXJtTXNnKSkgcmV0dXJuO1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIHJlcG9ydGUgc2VydmVyLXNpZGUgKEJRKS4uLiBwdWVkZSB0YXJkYXIgfjYwcycpO1xuICB0cnkge1xuICAgIC8vIHYxMDAwIHBhdHRlcm46IHJlZnJlc2ggSURUb2tlbiBhbnRlcyBkZSBjYWxsYWJsZSBjcml0aWNvLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCB1ID0gd2luZG93LmZpcmViYXNlLmF1dGggJiYgd2luZG93LmZpcmViYXNlLmF1dGgoKS5jdXJyZW50VXNlcjtcbiAgICAgIGlmICh1ICYmIHUuZ2V0SWRUb2tlbikgYXdhaXQgdS5nZXRJZFRva2VuKHRydWUpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIGNvbnN0IGNhbGxhYmxlID0gd2luZG93LmZpcmViYXNlXG4gICAgICAuYXBwKClcbiAgICAgIC5mdW5jdGlvbnMoJ3NvdXRoYW1lcmljYS1lYXN0MScpXG4gICAgICAuaHR0cHNDYWxsYWJsZSgnZ2VuZXJhdGVWZW50YXNSZXBvcnRDRicpO1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBjYWxsYWJsZSh7IHllYXIsIG1vbnRoIH0pO1xuICAgIGNvbnN0IHIgPSAocmVzcCAmJiByZXNwLmRhdGEpIHx8IHt9O1xuICAgIGlmICghci5vayB8fCAhci5ieXRlc0Jhc2U2NCkge1xuICAgICAgYWxlcnQoJ0NGIGRldm9sdmlvIGVycm9yOiAnICsgKHIuZXJyb3IgfHwgSlNPTi5zdHJpbmdpZnkocikpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gRGVjb2RlIGJhc2U2NCBcdTIxOTIgQmxvYiBcdTIxOTIgZG93bmxvYWQgdHJpZ2dlci5cbiAgICBjb25zdCBiaW4gPSBhdG9iKHIuYnl0ZXNCYXNlNjQpO1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluLmxlbmd0aCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW4ubGVuZ3RoOyBpKyspIGJ5dGVzW2ldID0gYmluLmNoYXJDb2RlQXQoaSk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtieXRlc10sIHtcbiAgICAgIHR5cGU6IHIubWltZVR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPVxuICAgICAgci5maWxlbmFtZSB8fFxuICAgICAgJ3ZlbnRhc194X2FydGljdWxvX2NsaWVudGVfJyArIHllYXIgKyAnLScgKyBTdHJpbmcobW9udGgpLnBhZFN0YXJ0KDIsICcwJykgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICAgICAgYS5yZW1vdmUoKTtcbiAgICB9LCAxMDAwKTtcbiAgICBjb25zdCBzdGF0cyA9IHIuc3RhdHMgfHwge307XG4gICAgc2hvd1N5bmNUYWcoXG4gICAgICAnT0s6ICcgK1xuICAgICAgICAoc3RhdHMudmVudGFzIHx8IDApICtcbiAgICAgICAgJyB2ZW50YXMgLyAnICtcbiAgICAgICAgKHN0YXRzLml0ZW1zIHx8IDApICtcbiAgICAgICAgJyBTS1VzIC8gJyArXG4gICAgICAgIChzdGF0cy5jbGllbnRzIHx8IDApICtcbiAgICAgICAgJyBjbGllbnRlcydcbiAgICApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW2V4cG9ydFZlbnRhc0FydENsaV0gZXJyb3InLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIHJlcG9ydGU6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkpKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUGVkaWRvcyBkZWwgbWVzLi4uJyk7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSB7XG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSBjb250aW51ZTtcbiAgICBjb25zdCBmZWNoYSA9IHAuY3JlYXRlZEF0XG4gICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcbiAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxuICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICAgIC5zbGljZSgwLCAxMClcbiAgICAgIDogJyc7XG4gICAgLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc29sdmVyIGZhbnRhc2lhIHVuYSB2ZXogcG9yIHBlZGlkbyAobm8gcG9yIGxpbmVhKSBcdTIwMTRcbiAgICAvLyBlbCBsb29rdXAgZW4gY2xpZW50TWV0YSArIGFwcHJvdmVkQWx0YXNMaXN0IGVzIGNvbnN0YW50ZSBwYXJhIHRvZG8gZWwgcGVkaWRvLlxuICAgIGNvbnN0IG5vbWJyZUxvY2FsRmFudGFzaWEgPSBfcmVzb2x2ZUZhbnRhc2lhRm9yUGVkaWRvKHApO1xuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xuICAgICAgaWYgKCFsKSByZXR1cm47XG4gICAgICBjb25zdCBxdHkgPSBOdW1iZXIobC5xdHkpIHx8IDA7XG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCk7XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBGZWNoYV9QZWRpZG86IGZlY2hhLFxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIFN0YWdlOiBwLnN0YWdlIHx8ICcnLFxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIE5vbWJyZV9Mb2NhbF9GYW50YXNpYTogbm9tYnJlTG9jYWxGYW50YXNpYSxcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXG4gICAgICAgIENhbnRpZGFkOiBxdHksXG4gICAgICAgIENhbnRpZGFkX09wZW46IE51bWJlcihsLnF0eU9wZW4pIHx8IDAsXG4gICAgICAgIENhbnRpZGFkX0ludm9pY2VkOiBOdW1iZXIobC5xdHlJbnZvaWNlZCkgfHwgMCxcbiAgICAgICAgQ2FudGlkYWRfQ2FuY2VsbGVkOiBOdW1iZXIobC5xdHlDYW5jZWxsZWQpIHx8IDAsXG4gICAgICAgIEVzdGFkb19MaW5lYTogbC5zdGF0ZSB8fCAnJyxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChxdHkgKiBwcmVjaW8pLFxuICAgICAgICBDZXJyYWRvOiBwLmNsb3NlZEF0ID8gJ1NJJyA6ICdOTycsXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkZlY2hhX1BlZGlkbyB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhX1BlZGlkbyB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1BlZGlkb3NEZWxNZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1BlZGlkb3MnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBQZWRpZG9zIGRlbCBtZXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG4vLyBFeHBvcnRhciBwYXJhIEFuYWxpc2lzOiBwcm90ZWdpZG8gY29uIFBJTlxuY29uc3QgQU5BTElTSVNfUElOID0gJzEyMzUnO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQgRXhjZWwgVEFSR0VUUy1aT05BUyAtIHNvbG8gY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSBsYSBob2phIENMSUVOVEVTX1pPTkFTIGNvbiBVTkEgZmlsYSBwb3IgQlAgcXVlIGVzdGEgdml2byBlbiBTQVA6XG4vLyBjdWFscXVpZXIgYWx0YSBkZSBjbGllbnRfYXBwbGljYXRpb25zIGNvbiBzdGF0dXM9J2FwcHJvdmVkJyBZIGNhcmRDb2RlU2FwXG4vLyBhc2lnbmFkby4gRXhjbHV5ZSBQT0lOVFMgLyBkaXN0cmlidWlkb3JlcyAvIHByb3NwZWN0b3MgLyBhbHRhcyBzaW5cbi8vIENhcmRDb2RlIChtb2NrcyBvIHBlbmRpZW50ZXMgZGUgU0FQKS4gRXMgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgZmFjdHVyYS5cbi8vIENvbHVtbmFzOiBUSVBPLCBOUk8gQ1RFLCBSRUdJT04sIFBST1ZJTkNJQSwgQVNFU09SIEVYVEVSTk8sIEFTRVNPUiBJTlRFUk5PLFxuLy8gQ0FMTEUsIE5VTUVSTywgTE9DQUxJREFELCBDUCwgTk9NQlJFIENPTUVSQ0lBTCwgTk9NQlJFIERFIEZBTlRBU0lBLCBDVUlULFxuLy8gQ09ORElDSU9OIEZJU0NBTCwgVEVMRUZPTk8sIENBUkRDT0RFIFNBUC5cbndpbmRvdy5leHBvcnRUYXJnZXRzWm9uYXMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaWNcdTAwRTEgdHUgY29uZXhpXHUwMEYzbiB5IHJlaW50ZW50XHUwMEUxLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBleHBvcnRhciBlbCBtYXN0ZXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgVEFSR0VUUy1aT05BUy4uLicpO1xuICBjb25zdCBWREVfVE9fVkRJID0ge1xuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICAgIFBBQ0hJOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIHJlZ2lvbk9mKHByb3YpIHtcbiAgICBjb25zdCBwID0gKHByb3YgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgaWYgKFsnQlVFTk9TIEFJUkVTJywgJ0NBUElUQUwgRkVERVJBTCcsICdMQSBQQU1QQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0JVRU5PUyBBSVJFUyc7XG4gICAgaWYgKFsnQ09SRE9CQScsICdTQU4gTFVJUycsICdNRU5ET1pBJywgJ1NBTiBKVUFOJywgJ0xBIFJJT0pBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQ1VZTyc7XG4gICAgaWYgKFsnU0FOVEEgRkUnLCAnRU5UUkUgUklPUycsICdDSEFDTycsICdDT1JSSUVOVEVTJywgJ01JU0lPTkVTJywgJ0ZPUk1PU0EnXS5pbmNsdWRlcyhwKSlcbiAgICAgIHJldHVybiAnTkVBJztcbiAgICBpZiAoWydKVUpVWScsICdTQUxUQScsICdUVUNVTUFOJywgJ0NBVEFNQVJDQScsICdTQU5USUFHTyBERUwgRVNURVJPJ10uaW5jbHVkZXMocCkpIHJldHVybiAnTk9BJztcbiAgICBpZiAoWydORVVRVUVOJywgJ1JJTyBORUdSTycsICdDSFVCVVQnLCAnU0FOVEEgQ1JVWicsICdUSUVSUkEgREVMIEZVRUdPJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ1BBVEFHT05JQSc7XG4gICAgcmV0dXJuICcnO1xuICB9XG4gIGZ1bmN0aW9uIHZlbmRvckxhYmVsRm9yRXhjZWwoa2V5KSB7XG4gICAgaWYgKCFrZXkpIHJldHVybiAnJztcbiAgICBpZiAoa2V5ID09PSAnX19ESVNUUklCVVRPUl9fJykgcmV0dXJuICdESVNUUklCVUlET1JFUyc7XG4gICAgcmV0dXJuIGtleTtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIGxldCBhbHRhc1NuYXA7XG4gIHRyeSB7XG4gICAgYWx0YXNTbmFwID0gYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPT0nLCAnYXBwcm92ZWQnKVxuICAgICAgLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXMgYXByb2JhZGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBza2lwcGVkTm9TYXAgPSAwO1xuICBhbHRhc1NuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBjb25zdCBjYXJkQ29kZSA9IChhLmNhcmRDb2RlU2FwIHx8ICcnKS50cmltKCk7XG4gICAgLy8gRmlsdHJvIGNsYXZlOiBzb2xvIEJQcyBjb24gQ2FyZENvZGUgU0FQIGFzaWduYWRvICg9IGhhYmlsaXRhZG8gZW4gU0FQKS5cbiAgICBpZiAoIWNhcmRDb2RlKSB7XG4gICAgICBza2lwcGVkTm9TYXArKztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcHJvdmluY2UgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvVXBwZXJDYXNlKCkudHJpbSgpO1xuICAgIGNvbnN0IGxvY2FsaXR5RmluYWwgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIFRJUE86ICdEQURPIERFIEFMVEEnLFxuICAgICAgJ05STyBDVEUnOiAwLCAvLyBzZSByZW51bWVyYSBkZXNwdWVzIGRlbCBzb3J0XG4gICAgICBSRUdJT046IHJlZ2lvbk9mKHByb3ZpbmNlKSxcbiAgICAgIFBST1ZJTkNJQTogcHJvdmluY2UsXG4gICAgICAnQVNFU09SIEVYVEVSTk8nOiB2ZW5kb3JMYWJlbEZvckV4Y2VsKHZlbmRvciksXG4gICAgICAnQVNFU09SIElOVEVSTk8nOiBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJycsXG4gICAgICBDQUxMRTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE5VTUVSTzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMT0NBTElEQUQ6IGxvY2FsaXR5RmluYWwsXG4gICAgICBDUDogYS5jcCB8fCAnJyxcbiAgICAgICdOT01CUkUgQ09NRVJDSUFMJzogYS5jb21lcmNpbyB8fCBhLnRpdHVsYXIgfHwgJycsXG4gICAgICAnTk9NQlJFIERFIEZBTlRBU0lBJzogYS5mYW50YXNpYSB8fCAnJyxcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcbiAgICAgICdDT05ESUNJT04gRklTQ0FMJzogYS5jb25kaWNpb25GaXNjYWwgfHwgJycsXG4gICAgICBURUxFRk9OTzogYS50ZWxlZm9ubyB8fCAnJyxcbiAgICAgICdDQVJEQ09ERSBTQVAnOiBjYXJkQ29kZSxcbiAgICB9KTtcbiAgfSk7XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICBhbGVydChcbiAgICAgICdObyBoYXkgY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQIHRvZGF2aWEuXFxuXFxuVW5hIGFsdGEgZW50cmEgYWwgZXhwb3J0IHNvbG8gY3VhbmRvIHRpZW5lIENhcmRDb2RlIFNBUCBhc2lnbmFkby4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChyMSwgcjIpID0+IHtcbiAgICBjb25zdCBwID0gKHIxLlBST1ZJTkNJQSB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5QUk9WSU5DSUEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKHIxLkxPQ0FMSURBRCB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5MT0NBTElEQUQgfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKHIxWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUocjJbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJyk7XG4gIH0pO1xuICByb3dzLmZvckVhY2goKHIsIGkpID0+IHtcbiAgICByWydOUk8gQ1RFJ10gPSBpICsgMTtcbiAgfSk7XG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggKGVzdGlsbyB2ZXJkZSB1bmlmb3JtZSkuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZG93bmxvYWRYbHN4KCdUQVJHRVRTX1ZFTkRFRE9SRVNfWk9OQVNfJyArIHRzICsgJy54bHN4JywgW1xuICAgIHsgbmFtZTogJ0NMSUVOVEVTX1pPTkFTJywgcm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4Y2VsIGV4cG9ydGFkbzogJyArXG4gICAgICByb3dzLmxlbmd0aCArXG4gICAgICAnIGNsaWVudGVzIFNBUCBoYWJpbGl0YWRvcycgK1xuICAgICAgKHNraXBwZWROb1NhcCA+IDAgPyAnICgnICsgc2tpcHBlZE5vU2FwICsgJyBzaW4gQ2FyZENvZGUgZGVzY2FydGFkb3MpJyA6ICcnKVxuICApO1xufTtcblxud2luZG93Lm9wZW5FeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHBpbiA9IHByb21wdChcbiAgICAnRXN0YSBzZWNjaW9uIGNvbnRpZW5lIGZvcm1hdG9zIGF2YW56YWRvcyAoUG93ZXIgQkksIFB5dGhvbi9NTCwgWklQIGRlIGZvdG9zKSBkZXN0aW5hZG9zIGEgYW5hbGlzaXMgdGVjbmljby5cXG5cXG5JbmdyZXNhIGVsIFBJTiBwYXJhIGNvbnRpbnVhcjonXG4gICk7XG4gIGlmIChwaW4gPT09IG51bGwpIHJldHVybjtcbiAgaWYgKHBpbiAhPT0gQU5BTElTSVNfUElOKSB7XG4gICAgYWxlcnQoJ1BJTiBpbmNvcnJlY3RvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBPcGNpb24gSW50ZWdyYWNpb24gU0FQOiBzb2xvIHBhcmEgTWFyaWFubyAoZXJiaW5vbWFyaWFub0BnbWFpbC5jb20pXG4gIGNvbnN0IHNhcE9wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LXNhcC1pbnRlZ3JhdGlvbicpO1xuICBpZiAoc2FwT3B0KSB7XG4gICAgY29uc3QgaXNNYXJpYW5vID1cbiAgICAgIGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJztcbiAgICBzYXBPcHQuc3R5bGUuZGlzcGxheSA9IGlzTWFyaWFubyA/ICcnIDogJ25vbmUnO1xuICB9XG4gIC8vIE9wY2lvbiBCYWNrdXAgbWVuc3VhbDogc29sbyBhZG1pblxuICBjb25zdCBia09wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LWJhY2t1cC1tZW5zdWFsJyk7XG4gIGlmIChia09wdCkgYmtPcHQuc3R5bGUuZGlzcGxheSA9IHVzZXJSb2xlID09PSAnYWRtaW4nID8gJycgOiAnbm9uZSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxuLy8gSGVscGVycyBpbnRlcm5vcyAoZG93bmxvYWRYbHN4LCBleHBvcnRWZW50YXNGb3JNb250aCwgZXRjLikgc29uIGNvbnN1bWlkb3Ncbi8vIHNvbG8gZGVudHJvIGRlIGVzdGUgYmxvcXVlICh2ZXJpZmljYWRvIHByZS1leHRyYWNjaVx1MDBGM24pLlxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZ0JBLFNBQU8sdUJBQXVCLGlCQUFrQjtBQUM5QyxRQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sUUFBUTtBQUM3QixZQUFNLGdDQUFnQztBQUN0QztBQUFBLElBQ0Y7QUFDQSxnQkFBWSxxQ0FBcUM7QUFRakQsVUFBTSxXQUNKLE9BQU8sMEJBQTBCLGFBQzdCLHNCQUFzQixPQUFPLGtCQUFrQixjQUFjLGdCQUFnQixLQUFLLElBQ2xGO0FBQ04sVUFBTSxVQUFVLENBQUMsY0FBYztBQUM3QixVQUFJLGFBQWEsS0FBTSxRQUFPO0FBQzlCLFVBQUksQ0FBQyxVQUFXLFFBQU87QUFDdkIsYUFBTyxTQUFTLElBQUksU0FBUztBQUFBLElBQy9CO0FBTUEsVUFBTSxhQUFhO0FBQUEsTUFDakIseUJBQXlCO0FBQUEsTUFDekIsc0JBQXNCO0FBQUEsTUFDdEIsZ0JBQWdCO0FBQUEsTUFDaEIsT0FBTztBQUFBLElBQ1Q7QUFDQSxhQUFTLFdBQVcsV0FBVztBQUM3QixZQUFN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
