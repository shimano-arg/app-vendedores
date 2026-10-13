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
      const fn = typeof window !== "undefined" && typeof window.getStockDisponibleVenta === "function" ? window.getStockDisponibleVenta : null;
      const v = fn ? fn(sku) : null;
      if (v == null) return "";
      return Number(v) || 0;
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
      "Stock W11": fmtStock(p.code)
    })).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const preciosRows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      "Precio ARS": fmtPrecio(p.code)
    })).filter((r) => r["Precio ARS"] !== "").sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const stockRows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      "Stock W11": fmtStock(p.code)
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xyXG4vLyBFWFBPUlRTLUNPUkU6IG1hc3RlcmZpbGUgY2xpZW50ZXMgKyBwcmVjaW9zL3N0b2NrICsgbW9kYWwgZGUgZXhwb3J0YXIgK1xyXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxyXG4vLyBGcmFnbWVudG9zIHJlc3RhbnRlcyBkZWwgZG9taW5pbyBleHBvcnRzOiBhZHZhbmNlZCAofjEwMzAyLTExNDUxKSB5IFNBUFxyXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgTUFTVEVSRklMRSBERSBDTElFTlRFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxyXG4vLyBub21icmUsIHRpcG8gKGNsaWVudGUvcHJvc3BlY3RvKSwgem9uYSBkZWwgdmVuZGVkb3IsIGFzZXNvciBleHRlcm5vLCBhc2Vzb3JcclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxyXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxyXG4vLyBjb29yZGVuYWRhcyBnZW9jb2RpZmljYWRhcywgZXN0YWRvIChIYWJpbGl0YWRvL1BlbmRpZW50ZS9DYW5jZWxhZG8pLFxyXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cclxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xyXG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcclxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXHJcbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxyXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcclxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xyXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxyXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cclxuICBjb25zdCBzY29wZVNldCA9XHJcbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcclxuICAgICAgOiBudWxsO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XHJcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcclxuICB9O1xyXG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcclxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cclxuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXHJcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXHJcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICB9O1xyXG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XHJcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcclxuICAgIHJldHVybiB2ID8gdi56b25lIDogJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xyXG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XHJcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XHJcbiAgfVxyXG5cclxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcclxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXHJcbiAgLy8gZXNwZWNpYWxpemFjaW9uL2NhbmFsQ29tcHJhL3BvcC90aXBvVmVudGEvZXRjLikgZGVsIGZvcm11bGFyaW8gZGVcclxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXHJcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cclxuICAvLyB2ZSBsYSBjbGFzaWZpY2FjaW9uIG1hcyBhY3R1YWxpemFkYSwgcGVybyBzaSBlbCB1bHRpbW8gY29udGFjdG8gbm8gbGxlbmFcclxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcclxuICAvLyBpbnRlcmFjY2lvbiBwZXJvIG5vIHBlcmRlciBpbmZvIHV0aWwgZGUgbGFzIGFudGVyaW9yZXNcIi5cclxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcclxuICAgICd0aXBvJyxcclxuICAgICdsb2NhbCcsXHJcbiAgICAndGFtYW5vJyxcclxuICAgICdmaWRlbGlkYWQnLFxyXG4gICAgJ2VzcGVjaWFsaXphY2lvbicsXHJcbiAgICAnY2FuYWxDb21wcmEnLFxyXG4gICAgJ3JlbGV2YW5jaWEnLFxyXG4gICAgJ3BvcCcsXHJcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXHJcbiAgICAndGlwb1ZlbnRhJyxcclxuICAgICdwb25kZXJhY2lvbk1vc3RyYWRvJyxcclxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXHJcbiAgICAnY29tcGV0ZW5jaWEnLFxyXG4gICAgJ29wb3J0dW5pZGFkJyxcclxuICAgICdtYXNWZW5kaWRvJyxcclxuICAgICdtYXNQcmVndW50YW4nLFxyXG4gICAgJ2F5dWRhVGllbmRhJyxcclxuICBdO1xyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXHJcbiAgICAgICd8JyArXHJcbiAgICAgIChsb2MgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpICtcclxuICAgICAgJ3wnICtcclxuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcclxuICAgICk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xyXG4gICAgaWYgKHYgJiYgdi5jcmVhdGVkQXQgJiYgdi5jcmVhdGVkQXQudG9NaWxsaXMpIHJldHVybiB2LmNyZWF0ZWRBdC50b01pbGxpcygpO1xyXG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xyXG4gICAgcmV0dXJuIDA7XHJcbiAgfVxyXG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XHJcbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcclxuICAgIGNvbnN0IGJ5S2V5ID0gbmV3IE1hcCgpO1xyXG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgICBpZiAoIXYpIHJldHVybjtcclxuICAgICAgY29uc3QgayA9IF9jbGFzc2lmS2V5KHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcclxuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XHJcbiAgICB9KTtcclxuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xyXG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxyXG4gICAgICBjb25zdCBtZXJnZWQgPSB7fTtcclxuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcclxuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgICBpZiAobWVyZ2VkW2ZdICE9IG51bGwgJiYgbWVyZ2VkW2ZdICE9PSAnJyAmJiBtZXJnZWRbZl0gIT09IDApIHJldHVybjtcclxuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XHJcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xyXG4gICAgICBjbGFzc2lmSW5kZXguc2V0KGssIHtcclxuICAgICAgICBtZXJnZWQsXHJcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXHJcbiAgICAgICAgbGFzdFR5cGU6IGxhdGVzdC5pbnRlcmFjdGlvblR5cGUgfHwgKGxhdGVzdC5lc3BhY2lvID8gJ3Zpc2l0YScgOiAnJyksXHJcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcclxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmUm93KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcclxuICAgIGlmICghZW50cnkpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RvdGFsIHZpc2l0YXMnOiAwLFxyXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxyXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXHJcbiAgICAgICAgTG9jYWw6ICcnLFxyXG4gICAgICAgIFRhbWFubzogJycsXHJcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcclxuICAgICAgICBFc3BlY2lhbGl6YWNpb246ICcnLFxyXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcclxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcclxuICAgICAgICBQT1A6ICcnLFxyXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxyXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXHJcbiAgICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAnJyxcclxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcclxuICAgICAgICBDb21wZXRlbmNpYTogJycsXHJcbiAgICAgICAgT3BvcnR1bmlkYWQ6ICcnLFxyXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxyXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXHJcbiAgICAgICAgJ0F5dWRhIHRpZW5kYSc6ICcnLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgY29uc3QgbSA9IGVudHJ5Lm1lcmdlZCB8fCB7fTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXHJcbiAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RUeXBlLFxyXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXHJcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXHJcbiAgICAgICdUaXBvIGNvbWVyY2lvJzogbS50aXBvIHx8ICcnLFxyXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcclxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcclxuICAgICAgRmlkZWxpZGFkOiBtLmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcclxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXHJcbiAgICAgIFJlbGV2YW5jaWE6IG0ucmVsZXZhbmNpYSAhPSBudWxsID8gbS5yZWxldmFuY2lhIDogJycsXHJcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXHJcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcclxuICAgICAgJ1RpcG8gZGUgdmVudGEnOiBtLnRpcG9WZW50YSB8fCAnJyxcclxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxyXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXHJcbiAgICAgIENvbXBldGVuY2lhOiBtLmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgICAnTWFzIHByZWd1bnRhbic6IG0ubWFzUHJlZ3VudGFuIHx8ICcnLFxyXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXHJcbiAgLy8gdGllbmVuIGNhcmRDb2RlICsgZGlyZWNjaW9uLiBFc29zIHNvbiBsb3MgcXVlIGFwYXJlY2VuIGNvbW8gdmVyZGVzIGVuXHJcbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcclxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXHJcbiAgLy8gcmVhbCBvcGVyYWJsZSBob3kuXHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCBwcm92aW5jZSA9IHAucHJvdmluY2UgfHwgJyc7XHJcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcclxuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBwLnZlbmRvciB8fCAnJztcclxuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cclxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XHJcbiAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xyXG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XHJcbiAgICBjb25zdCBsb24gPSBwLmxvbiAhPSBudWxsID8gcC5sb24gOiAnJztcclxuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cclxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxyXG4gICAgKHAuY2xpZW50cyB8fCBbXSkuZm9yRWFjaCgobmFtZSkgPT4ge1xyXG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcclxuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XHJcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXHJcbiAgICAgIGxldCBlc3RhZG8gPSAnSGFiaWxpdGFkbyc7IC8vIHBvciBkZWZpbmljaW9uIHlhIGVzdGEgU0FQLWNvbmZpcm1hZG9cclxuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcclxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcclxuICAgICAgLy8gTWV0YWRhdGEgY3VzdG9tIChkaXJlY2Npb24sIGxvY2FsaWRhZCBkZWNsYXJhZGEsIGdlb2NvZGUpLlxyXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XHJcbiAgICAgIC8vIEJ1c2NhciBhZGRyZXNzOiAxKSBjbGllbnRfbWFzdGVyLmFkZHJlc3MgKGFkbWluKSwgMikgY2xpZW50TWV0YS5hZGRyZXNzICh2ZW5kb3IpLlxyXG4gICAgICBjb25zdCBkb2NJZCA9XHJcbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xyXG4gICAgICBjb25zdCBjbURhdGEgPVxyXG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGxvY2FsaXR5Q3VzdCA9IGNtRGF0YS5sb2NhbGlkYWQgfHwgbWV0YS5sb2NhbGl0eSB8fCAnJztcclxuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XHJcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xyXG4gICAgICAvLyBDYXJkQ29kZSBTQVAgKGRlIGNsaWVudF9tYXN0ZXIgbyBkZSBsYSBhbHRhIHZpbmN1bGFkYSkuXHJcbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcclxuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xyXG4gICAgICAgIGNvbnN0IGtleSA9IHByb3ZpbmNlLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBsb2NhbGl0eU1hcDtcclxuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcclxuICAgICAgICBpZiAoYWx0YU1hdGNoKSBjYXJkQ29kZSA9IGFsdGFNYXRjaC5jYXJkQ29kZVNhcCB8fCAnJztcclxuICAgICAgfVxyXG4gICAgICByb3dzLnB1c2goXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGNhcmRDb2RlLFxyXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXHJcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcclxuICAgICAgICAgICAgVGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXHJcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2NhbGl0eU1hcCxcclxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxyXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcclxuICAgICAgICAgICAgWm9uYTogem9uZSxcclxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxyXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXHJcbiAgICAgICAgICAgIERpcmVjY2lvbjogYWRkcmVzcyxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXHJcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcclxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBjdXN0b21MbmcgfHwgbG9uLFxyXG4gICAgICAgICAgICAvLyB2MTA1NSAoMjAyNi0wOS0yNCk6IGxpbWl0ZSBkZSBjcmVkaXRvIEFSUyBwYXJhIHBhZ2FyIGNvbiBjaGVxdWUuXHJcbiAgICAgICAgICAgIC8vIEVkaXRhYmxlIGFkbWluL2dlcmVudGUgZGVzZGUgTWFzdGVyIENsaWVudGVzIFVJLCBndWFyZGFkbyBlblxyXG4gICAgICAgICAgICAvLyBjbGllbnRfbWFzdGVyLmNyZWRpdG9DaGVxdWUgKHBhcmEgUE9JTlRTIG1hdGNoZWFkb3MgY29uIFNBUCkuXHJcbiAgICAgICAgICAgICdDcmVkaXRvIGNoZXF1ZSAoQVJTKSc6XHJcbiAgICAgICAgICAgICAgY21EYXRhLmNyZWRpdG9DaGVxdWUgIT0gbnVsbCA/IE51bWJlcihjbURhdGEuY3JlZGl0b0NoZXF1ZSkgOiAnJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpXHJcbiAgICAgICAgKVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgLy8gSW55ZWN0YXIgYWx0YXMgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyAoYXBwcm92ZWRBbHRhc0xpc3QpOlxyXG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXHJcbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxyXG4gIC8vICAgICBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLiBWYW4gY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuIFNlXHJcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xyXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXHJcbiAgLy8gICAgIExvcyBwcm92aXNvcmlvcyBwdWVkZW4gbm8gdGVuZXIgZGlyZWNjaW9uIHRvZGF2aWEgLT4gc2UgYWNlcHRhbiBpZ3VhbC5cclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xyXG4gICAgc2Vlbi5hZGQoXHJcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxyXG4gICAgKTtcclxuICB9KTtcclxuICBpZiAodHlwZW9mIGFwcHJvdmVkQWx0YXNMaXN0ICE9PSAndW5kZWZpbmVkJyAmJiBhcHByb3ZlZEFsdGFzTGlzdC5sZW5ndGgpIHtcclxuICAgIGFwcHJvdmVkQWx0YXNMaXN0LmZvckVhY2goKGEpID0+IHtcclxuICAgICAgaWYgKCFhKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IGlzUHJvdmlzb3JpbyA9ICEhYS5tYW51YWxTYXBQZW5kaW5nICYmICFhLmNhcmRDb2RlU2FwO1xyXG4gICAgICAvLyBIYWJpbGl0YWRvczogc2lndWVuIGV4aWdpZW5kbyBjYXJkQ29kZSArIGRpcmVjY2lvbiAoY29tcG9ydGFtaWVudG8gcHJlLXYzMTEpLlxyXG4gICAgICAvLyBQcm92aXNvcmlvczogc2luIGNhcmRDb2RlIG5pIGRpcmVjY2lvbiwgdmFuIGlndWFsIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLlxyXG4gICAgICBpZiAoIWlzUHJvdmlzb3Jpbykge1xyXG4gICAgICAgIGlmICghYS5jYXJkQ29kZVNhcCkgcmV0dXJuO1xyXG4gICAgICAgIGlmICghKGEuY2FsbGUgfHwgYS5hZGRyZXNzKSkgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHByb3YgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCk7XHJcbiAgICAgIGNvbnN0IG5vbWJyZSA9XHJcbiAgICAgICAgYS5jb21lcmNpbyB8fFxyXG4gICAgICAgIGEuZmFudGFzaWEgfHxcclxuICAgICAgICAoYS5jYXJkQ29kZVNhcCA/ICdTQVAgJyArIGEuY2FyZENvZGVTYXAuc2xpY2UoMCwgOCkgOiBhLnRpdHVsYXIgfHwgJ1Byb3Zpc29yaW8nKTtcclxuICAgICAgY29uc3QgZHVwS2V5ID0gcHJvdi50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbm9tYnJlLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChzZWVuLmhhcyhkdXBLZXkpKSByZXR1cm47XHJcbiAgICAgIHNlZW4uYWRkKGR1cEtleSk7XHJcbiAgICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XHJcbiAgICAgIC8vIHYzMzE6IG1pc21vIGZpbHRybyBkZSBzY29wZSBhcGxpY2EgYSBhbHRhcyBTQVAvcHJvdmlzb3JpYXMuXHJcbiAgICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XHJcbiAgICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcclxuICAgICAgY29uc3QgbG9jID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnKHNpbiBsb2NhbGlkYWQpJztcclxuICAgICAgcm93cy5wdXNoKFxyXG4gICAgICAgIE9iamVjdC5hc3NpZ24oXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxyXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5vbWJyZSxcclxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcclxuICAgICAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxyXG4gICAgICAgICAgICBFc3RhZG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvJyA6ICdIYWJpbGl0YWRvJyxcclxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXHJcbiAgICAgICAgICAgIERlcGFydGFtZW50bzogJycsXHJcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxyXG4gICAgICAgICAgICBab25hOiB6b25lLFxyXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXHJcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcclxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2MsXHJcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXHJcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXHJcbiAgICAgICAgICAgIC8vIHYxMDU1OiBtaXNtbyBjYW1wbyBwYXJhIGFsdGFzIFNBUCAoY2xpZW50X2FwcGxpY2F0aW9ucy5jcmVkaXRvQ2hlcXVlKS5cclxuICAgICAgICAgICAgJ0NyZWRpdG8gY2hlcXVlIChBUlMpJzogYS5jcmVkaXRvQ2hlcXVlICE9IG51bGwgPyBOdW1iZXIoYS5jcmVkaXRvQ2hlcXVlKSA6ICcnLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3YsIGxvYywgbm9tYnJlKVxyXG4gICAgICAgIClcclxuICAgICAgKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gT3JkZW5hciBwb3IgcHJvdmluY2lhLCBsb2NhbGlkYWQsIG5vbWJyZS5cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcclxuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xyXG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xyXG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcclxuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcclxuICAgIHJldHVybiAoYVsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJyk7XHJcbiAgfSk7XHJcblxyXG4gIGlmICghcm93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXHJcbiAgICAgICAgJ0VsIG1hc3RlcmZpbGUgaW5jbHV5ZTpcXG4nICtcclxuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xyXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXHJcbiAgICAgICAgJ1NpIG5vIHZlcyBuaW5ndW5vLCByZXZpc2EgZWwgbW9kYWwgU0FQIG8gQWx0YSBDbGllbnRlcy4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCBoZWxwZXIgKGVzdGlsbyB2ZXJkZSArIGNlbnRlcmVkXHJcbiAgLy8gdW5pZm9ybWUpLiBBbnRlcyB1c2FiYSBYTFNYLndyaXRlRmlsZSBkaXJlY3RvIGNvbiBTaGVldEpTIGZyZWUgcXVlIGlnbm9yYVxyXG4gIC8vIGVzdGlsb3MuIEFob3JhIGhlcmVkYWRvIGRlbCBoZWxwZXIgXHUyMDE0IG1pc21hIFVJIHF1ZSBWZW50YXMvVmlzaXRhcy9ldGMuXHJcbiAgLy8gdjEwNDMgKDIwMjYtMDktMjMpOiBwb3N0LXByb2Nlc28gXHUyMDE0IHNhY2FyIGNvbHVtbmFzIDEwMCUgdmFjXHUwMEVEYXMuXHJcbiAgLy8gUmVwb3J0ZSBNYXJpYW5vOiBtYXN0ZXJmaWxlIGV4cG9ydGFiYSAzNyBjb2x1bW5hcyBkb25kZSBtdWNoYXMgdmVuXHUwMEVEYW5cclxuICAvLyB2YWNcdTAwRURhcyBwb3JxdWUgbm8gaGFiXHUwMEVEYSB2aXNpdGFzL2NvbnRhY3RvcyBjYXJnYWRvcyBwYXJhIGVzb3MgY2xpZW50ZXMuXHJcbiAgLy8gRml4OiBpZGVudGlmaWNhciBrZXlzIGRvbmRlIFRPREFTIGxhcyBmaWxhcyB0aWVuZW4gdmFsb3IgXCJ2YWNcdTAwRURvXCIgKGVtcHR5XHJcbiAgLy8gc3RyaW5nLCBudWxsLCB1bmRlZmluZWQpIHkgcmVtb3ZlcmxhcyBhbnRlcyBkZWwgc2hlZXQuIExvcyBjb250ZW9zXHJcbiAgLy8gKFRvdGFsIHZpc2l0YXMvY29udGFjdG9zKSBzZSBjb25zaWRlcmFuIHZhY1x1MDBFRG9zIHNpIHRvZG9zIHNvbiAwLlxyXG4gIC8vIFdpZHRocyBwb3IgY29sdW1uLW5hbWUgKGVuIHZleiBkZSBwb3NpY2lvbmFsKSBwYXJhIHF1ZSBlbCBmaWx0ZXIgbm9cclxuICAvLyBkZXNhbGluZWUgZWwgc2hlZXQgY3VhbmRvIHJlbW92ZW1vcyBjb2x1bW5hcy5cclxuICBjb25zdCBDT0xfV0lEVEhTID0ge1xyXG4gICAgJ0NhcmRDb2RlIFNBUCc6IDE2LFxyXG4gICAgJ05vbWJyZSB0aWVuZGEnOiAzOCxcclxuICAgICdBbGlhcyAobW9kYWwpJzogMjgsXHJcbiAgICBUaXBvOiAxNCxcclxuICAgIEVzdGFkbzogMTQsXHJcbiAgICBQcm92aW5jaWE6IDIyLFxyXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknOiAyMixcclxuICAgIERlcGFydGFtZW50bzogMjIsXHJcbiAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IDI4LFxyXG4gICAgWm9uYTogOCxcclxuICAgICdFdGlxdWV0YSB6b25hJzogNDgsXHJcbiAgICAnQXNlc29yIGludGVybm8gKFZESSknOiAyOCxcclxuICAgIERpcmVjY2lvbjogMzgsXHJcbiAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IDI0LFxyXG4gICAgJ0xhdCAoZ2VvY29kZSknOiAxNCxcclxuICAgICdMbmcgKGdlb2NvZGUpJzogMTQsXHJcbiAgICAnQ3JlZGl0byBjaGVxdWUgKEFSUyknOiAxOCxcclxuICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcclxuICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IDE0LFxyXG4gICAgJ1RvdGFsIHZpc2l0YXMnOiAxMCxcclxuICAgICdUb3RhbCBjb250YWN0b3MnOiAxMCxcclxuICAgICdUaXBvIGNvbWVyY2lvJzogMTgsXHJcbiAgICBMb2NhbDogMTYsXHJcbiAgICBUYW1hbm86IDEyLFxyXG4gICAgRmlkZWxpZGFkOiAxNCxcclxuICAgIEVzcGVjaWFsaXphY2lvbjogMjAsXHJcbiAgICAnQ2FuYWwgZGUgY29tcHJhJzogMjAsXHJcbiAgICBSZWxldmFuY2lhOiAxMCxcclxuICAgIFBPUDogOCxcclxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IDI2LFxyXG4gICAgJ1RpcG8gZGUgdmVudGEnOiAxNixcclxuICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogMTgsXHJcbiAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAxOCxcclxuICAgIENvbXBldGVuY2lhOiAyNixcclxuICAgIE9wb3J0dW5pZGFkOiAyNixcclxuICAgICdNYXMgdmVuZGlkbyc6IDIyLFxyXG4gICAgJ01hcyBwcmVndW50YW4nOiAyMixcclxuICAgICdBeXVkYSB0aWVuZGEnOiAyNixcclxuICB9O1xyXG4gIC8vIERldGVjdGFyIGtleXMgMTAwJSB2YWNcdTAwRURhcy5cclxuICBjb25zdCBhbGxLZXlzID0gT2JqZWN0LmtleXMoQ09MX1dJRFRIUyk7XHJcbiAgY29uc3QgTlVNRVJJQ19aRVJPX09LID0gbmV3IFNldChbJ1RvdGFsIHZpc2l0YXMnLCAnVG90YWwgY29udGFjdG9zJywgJ0NyZWRpdG8gY2hlcXVlIChBUlMpJ10pO1xyXG4gIGNvbnN0IGVtcHR5S2V5cyA9IG5ldyBTZXQoXHJcbiAgICBhbGxLZXlzLmZpbHRlcigoaykgPT4ge1xyXG4gICAgICAvLyBTa2lwIGNvbHVtbmFzIGNvcmUgcXVlIFNJRU1QUkUgc2UgbXVlc3RyYW4gYXVucXVlIGVzdFx1MDBFOW4gdmFjXHUwMEVEYXMuXHJcbiAgICAgIC8vIChDYXJkQ29kZS9Ob21icmUgc29uIG9wY2lvbmFsZXMgdFx1MDBFOWNuaWNhbWVudGUgcGVybyBjbGllbnRlIHNpbiBub21icmVcclxuICAgICAgLy8geWEgbm8gbGxlZ2EgaGFzdGEgYWNcdTAwRTEuKVxyXG4gICAgICByZXR1cm4gcm93cy5ldmVyeSgocikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHYgPSByW2tdO1xyXG4gICAgICAgIGlmICh2ID09PSAnJyB8fCB2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgaWYgKE5VTUVSSUNfWkVST19PSy5oYXMoaykgJiYgdiA9PT0gMCkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICB9KTtcclxuICAgIH0pXHJcbiAgKTtcclxuICBjb25zdCBrZXB0S2V5cyA9IGFsbEtleXMuZmlsdGVyKChrKSA9PiAhZW1wdHlLZXlzLmhhcyhrKSk7XHJcbiAgY29uc3Qgcm93c0ZpbHRlcmVkID0gcm93cy5tYXAoKHIpID0+IHtcclxuICAgIGNvbnN0IG91dCA9IHt9O1xyXG4gICAga2VwdEtleXMuZm9yRWFjaCgoaykgPT4ge1xyXG4gICAgICBvdXRba10gPSByW2tdO1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gb3V0O1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlbW92ZWRDb3VudCA9IGVtcHR5S2V5cy5zaXplO1xyXG4gIGlmIChyZW1vdmVkQ291bnQgPiAwKSB7XHJcbiAgICBjb25zb2xlLmxvZyhgW21hc3RlcmZpbGVdIHJlbW92aWRhcyAke3JlbW92ZWRDb3VudH0gY29scyB2YWNcdTAwRURhczpgLCBbLi4uZW1wdHlLZXlzXS5qb2luKCcsICcpKTtcclxuICB9XHJcbiAgLy8gSG9qYSByZXN1bWVuIHBvciB6b25hXHJcbiAgY29uc3QgYnlab25lID0ge307XHJcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XHJcbiAgICBjb25zdCB6ID0gclsnRXRpcXVldGEgem9uYSddIHx8ICdTaW4gem9uYSc7XHJcbiAgICBpZiAoIWJ5Wm9uZVt6XSkgYnlab25lW3pdID0geyB0b3RhbDogMCwgaGFiaWxpdGFkb3M6IDAsIGNhbmNlbGFkb3M6IDAgfTtcclxuICAgIGJ5Wm9uZVt6XS50b3RhbCsrO1xyXG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xyXG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gT2JqZWN0LmVudHJpZXMoYnlab25lKVxyXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xyXG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcclxuICAgICAgJ1RvdGFsIHRpZW5kYXMnOiBkLnRvdGFsLFxyXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcclxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxyXG4gICAgfSkpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVG90YWwgdGllbmRhcyddIC0gYVsnVG90YWwgdGllbmRhcyddKTtcclxuXHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIC8vIHYzMzE6IHN1ZmlqbyBjb24gZWwgc2NvcGUgYXBsaWNhZG8gcGFyYSBkaWZlcmVuY2lhciBlbCBhcmNoaXZvIGRlbCBWREUvVkRJXHJcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxyXG4gIGNvbnN0IHNjb3BlTGJsID1cclxuICAgIHNjb3BlU2V0ID09PSBudWxsXHJcbiAgICAgID8gJ1RPRE9TJ1xyXG4gICAgICA6IHNjb3BlU2V0LnNpemUgPT09IDFcclxuICAgICAgICA/IFsuLi5zY29wZVNldF1bMF0uc3BsaXQoJyAnKVswXVxyXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcclxuICBjb25zdCBmbmFtZSA9ICdNYXN0ZXJmaWxlX0NsaWVudGVzX1NBUF8nICsgc2NvcGVMYmwgKyAnXycgKyB0cyArICcueGxzeCc7XHJcbiAgYXdhaXQgZG93bmxvYWRYbHN4KGZuYW1lLCBbXHJcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBoYWJpbGl0YWRvcyBTQVAnLCByb3dzOiByb3dzRmlsdGVyZWQgfSxcclxuICAgIHsgbmFtZTogJ1Jlc3VtZW4gcG9yIHpvbmEnLCByb3dzOiByZXN1bWVuUm93cyB9LFxyXG4gIF0pO1xyXG4gIHNob3dTeW5jVGFnKFxyXG4gICAgcm93cy5sZW5ndGggK1xyXG4gICAgICAnIGNsaWVudGVzIGV4cG9ydGFkb3MnICtcclxuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcclxuICApO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4cG9ydDogUHJlY2lvcyArIFN0b2NrIHBvciBTS1VcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xyXG4vLyBlbiBtZW1vcmlhOiBQUk9EVUNUUyAobWFzdGVyIGRlIFNLVXMpLCBQUklDRV9MSVNUX01BUCAocHJlY2lvIEFSUyBkZVxyXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cclxuLy8gSG9qYXM6XHJcbi8vICAtIFwiUHJlY2lvcyB5IFN0b2NrXCI6IHVuYSBmaWxhIHBvciBTS1UgY29uIHRvZGFzIGxhcyBjb2x1bW5hcyBqdW50YXNcclxuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxyXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cclxuLy8gIC0gXCJTdG9ja1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgZXN0YWRvIGRlIHN0b2NrLlxyXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXHJcbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XHJcbiAgLy8gdjU3NCAoMjAyNi0wOC0yMSk6IHBlZGlkbyBkZSBNYXJpYW5vIFx1MjAxNCBtb3N0cmFyIFVOSURBREVTIG51bWVyaWNhc1xyXG4gIC8vIGV4YWN0YXMgZGVsIGRlcG9zaXRvIDExICh2ZW50YSkgZW4gdmV6IGRlIFwiRGlzcG9uaWJsZVwiL1wiU2luIHN0b2NrXCIuXHJcbiAgLy8gVXNhIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIHF1ZSBsZWUgU1RPQ0tfV0FSRUhPVVNFX0JSRUFLRE9XTltza3VdWycxMSddLlxyXG4gIC8vIFJldG9ybmEgJycgKGNlbGRhIHZhY2lhKSBjdWFuZG8gbm8gaGF5IGRhdG8gZGUgc3RvY2sgKHNuYXBzaG90IG5vIGNhcmdhZG9cclxuICAvLyBhdW4pOyAwIHNpIGVsIFNLVSBubyB0aWVuZSBzdG9jay4gTG9zIG51bWVyb3MgcGVybWl0ZW4gc29ydC9maWx0ZXIvc3VtIGVuXHJcbiAgLy8gRXhjZWwgXHUyMDE0IG5vIHBlcmRlbW9zIGVsIGVzdGFkbyBcIm5vIGRhdG9cIiB2cyBcIjAgdW5pZGFkZXNcIiBncmFjaWFzIGFsICcnLlxyXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xyXG4gICAgY29uc3QgZm4gPVxyXG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXHJcbiAgICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGFcclxuICAgICAgICA6IG51bGw7XHJcbiAgICBjb25zdCB2ID0gZm4gPyBmbihza3UpIDogbnVsbDtcclxuICAgIGlmICh2ID09IG51bGwpIHJldHVybiAnJztcclxuICAgIHJldHVybiBOdW1iZXIodikgfHwgMDtcclxuICB9XHJcbiAgZnVuY3Rpb24gZm10UHJlY2lvKHNrdSkge1xyXG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcclxuICAgIGlmIChwID09IG51bGwpIHJldHVybiAnJztcclxuICAgIHJldHVybiBOdW1iZXIocCkgfHwgMDtcclxuICB9XHJcbiAgLy8gSG9qYSAxOiBjb21ibyBjb21wbGV0byAoZXMgbGEgbWFzIHBlZGlkYSkuXHJcbiAgY29uc3Qgcm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcclxuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxyXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcclxuICAgIEZhbWlsaWE6IHAuZmFtIHx8ICcnLFxyXG4gICAgU3ViZmFtaWxpYTogcC5zdWIgfHwgJycsXHJcbiAgICBDYXRlZ29yaWE6IHAuY2F0IHx8ICcnLFxyXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcclxuICAgICdTdG9jayBXMTEnOiBmbXRTdG9jayhwLmNvZGUpLFxyXG4gIH0pKS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICAvLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZmFjdG9yIGEgZG93bmxvYWRYbHN4IGhlbHBlciAoZXN0aWxvIHZlcmRlIHVuaWZvcm1lKS5cclxuICAvLyBFbCBmb3JtYXRvIGRlIG1vbmVkYSBBUlMgZGUgbGEgY29sdW1uYSBQcmVjaW8gcXVlZGEgY29tbyBuXHUwMEZBbWVybyBzaW1wbGUgXHUyMDE0XHJcbiAgLy8gc2UgcGllcmRlIGVsIHByZWZpeCBcIiRcIiBwZXJvIHNlIGdhbmEgY29uc2lzdGVuY2lhIHZpc3VhbC4gRXhjZWwgcGVybWl0ZVxyXG4gIC8vIGFwbGljYXIgZm9ybWF0byBtYW51YWwgc2kgZWwgdXN1YXJpbyBsbyBuZWNlc2l0YS5cclxuXHJcbiAgLy8gSG9qYSAyOiBzb2xvIFByZWNpb3NcclxuICBjb25zdCBwcmVjaW9zUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcclxuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxyXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcclxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXHJcbiAgfSkpXHJcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG5cclxuICAvLyBIb2phIDM6IHNvbG8gU3RvY2tcclxuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XHJcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcclxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXHJcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcclxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcblxyXG4gIC8vIEhvamEgNDogbWV0YWRhdGEgLSBjdWFuZG8gZnVlIGNhZGEgc25hcHNob3QgcGFyYSBxdWUgZWwgbGVjdG9yIHNlcGFcclxuICAvLyBzaSBsYSBsaXN0YSBlc3RhIGZyZXNjYS5cclxuICBjb25zdCBpbmZvUm93cyA9IFtcclxuICAgIHsgSXRlbTogJ1RvdGFsIFNLVXMgZW4gY2F0YWxvZ28nLCBWYWxvcjogUFJPRFVDVFMubGVuZ3RoIH0sXHJcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBwcmVjaW8gY2FyZ2FkbycsIFZhbG9yOiBwcmVjaW9zUm93cy5sZW5ndGggfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgY29uIHN0b2NrIGRpc3BvbmlibGUnLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSB0cnVlKS5sZW5ndGgsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gc3RvY2snLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSBmYWxzZSkubGVuZ3RoLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIGRhdG8gZGUgc3RvY2snLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09IG51bGwpLmxlbmd0aCxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdMaXN0YSBkZSBwcmVjaW9zIG1vbmVkYScsXHJcbiAgICAgIFZhbG9yOiB0eXBlb2YgUFJJQ0VfTElTVF9DVVJSRU5DWSAhPT0gJ3VuZGVmaW5lZCcgPyBQUklDRV9MSVNUX0NVUlJFTkNZIDogJ0FSUycsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBhY3R1YWxpemFkYScsXHJcbiAgICAgIFZhbG9yOlxyXG4gICAgICAgIHR5cGVvZiBQUklDRV9MSVNUX1VQREFURURfQVQgIT09ICd1bmRlZmluZWQnICYmIFBSSUNFX0xJU1RfVVBEQVRFRF9BVFxyXG4gICAgICAgICAgPyBuZXcgRGF0ZShQUklDRV9MSVNUX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXHJcbiAgICAgICAgICA6ICcobm8gY2FyZ2FkYSknLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1N0b2NrIHNuYXBzaG90IGFjdHVhbGl6YWRvJyxcclxuICAgICAgVmFsb3I6IFNUT0NLX1VQREFURURfQVQgPyBuZXcgRGF0ZShTVE9DS19VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcobm8gY2FyZ2FkbyknLFxyXG4gICAgfSxcclxuICAgIHsgSXRlbTogJ0V4cG9ydGFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdFeHBvcnRhZG8gcG9yJyxcclxuICAgICAgVmFsb3I6IChjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgY3VycmVudFVzZXIuZGlzcGxheU5hbWUpKSB8fCAnKGRlc2Nvbm9jaWRvKScsXHJcbiAgICB9LFxyXG4gIF07XHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIGF3YWl0IGRvd25sb2FkWGxzeCgnUHJlY2lvc195X1N0b2NrXycgKyB0cyArICcueGxzeCcsIFtcclxuICAgIHsgbmFtZTogJ1ByZWNpb3MgeSBTdG9jaycsIHJvd3MgfSxcclxuICAgIHsgbmFtZTogJ1ByZWNpb3MnLCByb3dzOiBwcmVjaW9zUm93cyB9LFxyXG4gICAgeyBuYW1lOiAnU3RvY2snLCByb3dzOiBzdG9ja1Jvd3MgfSxcclxuICAgIHsgbmFtZTogJ0luZm8nLCByb3dzOiBpbmZvUm93cyB9LFxyXG4gIF0pO1xyXG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKHByZWNpb3MgKyBzdG9jayknKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3NcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIEZpbHRyYXIgb3BjaW9uZXMgc2VndW4gcm9sLlxyXG4gIC8vICAgdmVuZGVkb3I6IG9wZXJhdGl2byBkaWFyaW8gKFZlbnRhcyAvIFZpc2l0YXMgLyBSdXRhcykgKyBDbGllbnRlcyBkZSBzdSB6b25hXHJcbiAgLy8gICAgIChleHBvcnRNYXN0ZXJDbGllbnRlcyB5YSBmaWx0cmEgcG9yIGdldEVmZmVjdGl2ZVZlbmRvclNldCAtPiBzb2xvIHN1IHZlbmRvcikuXHJcbiAgLy8gICBpbnRlcm5vIChWREkpOiBtaXNtbyBzY29wZSBvcGVyYXRpdm8gKyBDbGllbnRlcyBkZSBzdXMgcGFyZWphcyAobyBzb2xvIGVsXHJcbiAgLy8gICAgIHByb3BpbyBzaSBlbGlnaW8gc3Ugbm9tYnJlIGVuIGVsIGRyb3Bkb3duIGRlIHpvbmFzKS5cclxuICAvLyAgIGFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogdmVuIHRvZG8gZWwgbGlzdGFkbyAobnVsbCA9IHNpbiBmaWx0cm8pLlxyXG4gIGNvbnN0IGFsbG93ZWRCeVJvbGUgPSB7XHJcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogVkVOVEFTIHkgUlVUQVMgZWxpbWluYWRvcyBkZWwgVUkgcG9yIHBlZGlkbyBkZSBNYXJpYW5vLlxyXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcclxuICAgIGludGVybm86IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcclxuICB9O1xyXG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cclxuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcclxuICAgIGNvbnN0IGtpbmQgPSBlbC5kYXRhc2V0LmV4cEtpbmQgfHwgJyc7XHJcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCkgPyAnJyA6ICdub25lJztcclxuICB9KTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VFeHBvcnREaWFsb2cgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xyXG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XHJcbiAgVkVOVEFTOiAnVmVudGFzJyxcclxuICBWSVNJVEFTOiAnVmlzaXRhcycsXHJcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXHJcbiAgUlVUQVM6ICdSdXRhcycsXHJcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXHJcbiAgQkFDS09SREVSOiAnQmFja29yZGVyJyxcclxuICBTVE9DS19BU0lHOiAnU3RvY2sgQXNpZ25hZG8nLFxyXG4gIFBFRElET1NfTUVTOiAnUGVkaWRvcyBkZWwgbWVzJyxcclxufTtcclxuXHJcbndpbmRvdy5zaG93TW9udGhQaWNrZXIgPSBmdW5jdGlvbiAodGlwbykge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gdGlwbztcclxuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xyXG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xyXG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0V4cG9ydGFyICcgKyAoRVhQT1JUX1RZUEVfTEFCRUxTW3RpcG9dIHx8IHRpcG8pO1xyXG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcclxuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXHJcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XHJcbiAgbWVzU2VsLmlubmVySFRNTCA9XHJcbiAgICAnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zIGxvcyBtZXNlcyAoYVx1MDBGMW8gZW50ZXJvKTwvb3B0aW9uPicgK1xyXG4gICAgTUVTRVMubWFwKChtLCBpKSA9PiAnPG9wdGlvbiB2YWx1ZT1cIicgKyBpICsgJ1wiPicgKyBtICsgJzwvb3B0aW9uPicpLmpvaW4oJycpO1xyXG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xyXG4gIGNvbnN0IGFuaW9TZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpO1xyXG4gIGNvbnN0IHllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcclxuICBsZXQgeW9wdHMgPSAnJztcclxuICBmb3IgKGxldCB5ID0geWVhciAtIDM7IHkgPD0geWVhciArIDE7IHkrKylcclxuICAgIHlvcHRzICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIHkgKyAnXCI+JyArIHkgKyAnPC9vcHRpb24+JztcclxuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xyXG4gIGFuaW9TZWwudmFsdWUgPSB5ZWFyO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VNb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5jb25maXJtTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xyXG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcclxuICBjb25zdCBhbmlvID0gcGFyc2VJbnQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKS52YWx1ZSwgMTApO1xyXG4gIGNvbnN0IG1vbnRoSWR4ID0gbWVzUmF3ID09PSAnQUxMJyA/IG51bGwgOiBwYXJzZUludChtZXNSYXcsIDEwKTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxuICBpZiAoIXRpcG8pIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgaWYgKHRpcG8gPT09ICdWRU5UQVMnKSBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSVVRBUycpIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0FMVEFTJykgZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQkFDS09SREVSJykgZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1NUT0NLX0FTSUcnKSBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUEVESURPU19NRVMnKSBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZFTlRBU19BUlRfQ0xJJykgZXhwb3J0VmVudGFzQXJ0Q2xpRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydCAnICsgdGlwbywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGV4cG9ydDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHJldHVybiBTdHJpbmcoYW5pbyk7XHJcbiAgcmV0dXJuIE1FU0VTW21vbnRoSWR4XSArICdfJyArIGFuaW87XHJcbn1cclxuXHJcbi8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVlc2NyaXRvIGNvbiBFeGNlbEpTIHBhcmEgZGFyIFVJIHVuaWZvcm1lIGEgVE9ET1MgbG9zXHJcbi8vIGV4cG9ydHMgKGhlYWRlciB2ZXJkZSArIGNlbGRhcyBjZW50ZXJlZCArIGJvcmRlciBzdXRpbCArIGF1dG8tZml0IHdpZHRoKS5cclxuLy8gQW50ZXMgdXNhYmEgWExTWCBTaGVldEpTIGZyZWUgcXVlIGlnbm9yYSBzaWxlbnRseSBsb3MgZXN0aWxvcyBkZSBjZWxkYS4gRWxcclxuLy8gcGF0dGVybiB2ZXJkZSByZXBsaWNhIGVsIFRPVEFMIGJhciBkZSBleHBvcnRCYWNrb3JkZXJzVG9FeGNlbCAobW9kYWxcclxuLy8gQmFja29yZGVyIHY3MjArKS4gRXhjZWxKUyB5YSBzZSBjYXJnYSBvbi1kZW1hbmQgdmlhIHdpbmRvdy5sb2FkRXhjZWxKUy5cclxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRYbHN4KGZpbGVuYW1lLCBzaGVldHMpIHtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgd2luZG93LmxvYWRFeGNlbEpTKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIEV4Y2VsSlM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gIGNvbnN0IEhFQURFUl9GSUxMID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMTY2NTM0JyB9IH07XHJcbiAgY29uc3QgSEVBREVSX0ZPTlQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSwgc2l6ZTogMTIgfTtcclxuICBjb25zdCBDRU5URVIgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicsIHdyYXBUZXh0OiB0cnVlIH07XHJcbiAgY29uc3QgQk9SREVSX1RISU4gPSB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9O1xyXG4gIGNvbnN0IEJPUkRFUiA9IHsgdG9wOiBCT1JERVJfVEhJTiwgbGVmdDogQk9SREVSX1RISU4sIGJvdHRvbTogQk9SREVSX1RISU4sIHJpZ2h0OiBCT1JERVJfVEhJTiB9O1xyXG5cclxuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XHJcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldChzLm5hbWUuc2xpY2UoMCwgMzEpKTtcclxuICAgIGNvbnN0IHJvd3MgPSBzLnJvd3MubGVuZ3RoID8gcy5yb3dzIDogW3sgQXZpc286ICdTaW4gZGF0b3MgcGFyYSBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkbycgfV07XHJcbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmtleXMocm93c1swXSk7XHJcblxyXG4gICAgY29uc3QgaGVhZGVyUm93ID0gd3MuYWRkUm93KGhlYWRlcnMpO1xyXG4gICAgaGVhZGVyUm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XHJcbiAgICAgIGNlbGwuZmlsbCA9IEhFQURFUl9GSUxMO1xyXG4gICAgICBjZWxsLmZvbnQgPSBIRUFERVJfRk9OVDtcclxuICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XHJcbiAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xyXG4gICAgfSk7XHJcbiAgICBoZWFkZXJSb3cuaGVpZ2h0ID0gMjY7XHJcblxyXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xyXG4gICAgICBjb25zdCB2YWx1ZXMgPSBoZWFkZXJzLm1hcCgoaCkgPT4gKHJvd1toXSAhPT0gdW5kZWZpbmVkICYmIHJvd1toXSAhPT0gbnVsbCA/IHJvd1toXSA6ICcnKSk7XHJcbiAgICAgIGNvbnN0IGRhdGFSb3cgPSB3cy5hZGRSb3codmFsdWVzKTtcclxuICAgICAgZGF0YVJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xyXG4gICAgICAgIGNlbGwuYWxpZ25tZW50ID0gQ0VOVEVSO1xyXG4gICAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBoZWFkZXJzLmZvckVhY2goKGgsIGkpID0+IHtcclxuICAgICAgbGV0IG1heExlbiA9IFN0cmluZyhoKS5sZW5ndGg7XHJcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcclxuICAgICAgICBjb25zdCB2ID0gU3RyaW5nKHJvd1toXSA9PT0gdW5kZWZpbmVkIHx8IHJvd1toXSA9PT0gbnVsbCA/ICcnIDogcm93W2hdKS5zcGxpdCgnXFxuJylbMF07XHJcbiAgICAgICAgaWYgKHYubGVuZ3RoID4gbWF4TGVuKSBtYXhMZW4gPSB2Lmxlbmd0aDtcclxuICAgICAgfVxyXG4gICAgICB3cy5nZXRDb2x1bW4oaSArIDEpLndpZHRoID0gTWF0aC5taW4oNjAsIE1hdGgubWF4KDEwLCBtYXhMZW4gKyA0KSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICB3cy52aWV3cyA9IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xyXG4gIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xyXG4gICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICB9KTtcclxuICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgYS5ocmVmID0gdXJsO1xyXG4gIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gIGEuY2xpY2soKTtcclxuICBhLnJlbW92ZSgpO1xyXG4gIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFZFTlRBUzogcGVkaWRvcyBjb25maXJtYWRvcyBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWZW50YXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHBlZGlkb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgaWYgKHBhcnNlSW50KHAueWVhciwgMTApICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQocC5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xyXG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIHJldHVybjtcclxuICAgIGNvbnN0IHZlbmRvcktleSA9IHAudmVuZG9yIHx8IGxvb2t1cFZlbmRvckZvckNsaWVudChwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSkgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XHJcbiAgICBjb25zdCBmYWN0b3IgPSB0eXBlb2YgcGVkaWRvRGlzY291bnRGYWN0b3IgPT09ICdmdW5jdGlvbicgPyBwZWRpZG9EaXNjb3VudEZhY3RvcihwKSA6IDE7XHJcbiAgICBjb25zdCBkaXNjUGN0ID0gKHAuZGlzY291bnRTbmFwc2hvdCAmJiBwLmRpc2NvdW50U25hcHNob3QucGN0VG90YWwpIHx8IDA7XHJcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XHJcbiAgICAgIGNvbnN0IHF0eSA9IHBhcnNlRmxvYXQobC5xdHkpIHx8IDA7XHJcbiAgICAgIGNvbnN0IHByZWNpbyA9IHBhcnNlRmxvYXQobC5wcmVjaW8pIHx8IDA7XHJcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xyXG4gICAgICBjb25zdCBuZXQgPSBncm9zcyAqIGZhY3RvcjtcclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgRmVjaGFfQ29uZmlybWFkbzogcC5jb25maXJtZWRBdCA/IFN0cmluZyhwLmNvbmZpcm1lZEF0KS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgICAgICBFc3RhZG86IHAuc3RhZ2UgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxyXG4gICAgICAgIFpvbmE6IHZlbmRvckluZm8uem9uZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlIHx8ICcnKSxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQ29kaWdvX1NLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXHJcbiAgICAgICAgQ2F0ZWdvcmlhOiBsLmNhdCB8fCAnJyxcclxuICAgICAgICBGYW1pbGlhOiBsLmZhbSB8fCAnJyxcclxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZDogcXR5LFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxyXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxyXG4gICAgICAgIC8vIHBhcmEgZWwgdGFyZ2V0IGRlbCB2ZW5kZWRvci4gU3VidG90YWxfQnJ1dG9fQVJTIG11ZXN0cmEgZWwgdmFsb3JcclxuICAgICAgICAvLyBkZSBsaXN0YSBzaW4gZGVzY3VlbnRvIHBhcmEgdHJhemFiaWxpZGFkLlxyXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxyXG4gICAgICAgIFN1YnRvdGFsX0JydXRvX0FSUzogTWF0aC5yb3VuZChncm9zcyksXHJcbiAgICAgICAgRGVzY3VlbnRvX1BjdDogZGlzY1BjdCxcclxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcclxuICAgICAgICBDYXJnYWRvX1BvcjogcC5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCBwLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fVmVudGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgVmVudGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbG9va3VwVmVuZG9yRm9yQ2xpZW50KHByb3YsIGxvY05hbWUsIF9jbGllbnROYW1lKSB7XHJcbiAgaWYgKCFwcm92IHx8ICFsb2NOYW1lKSByZXR1cm4gJyc7XHJcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xyXG4gIHJldHVybiBwdCA/IHB0LnZlbmRvciB8fCAnJyA6ICcnO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVklTSVRBUzogZGV0YWxsZSBkZSB2aXNpdGFzIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWaXNpdGFzICsgQ29udGFjdG9zLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHZpc2l0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgdGFyZ2V0TWVzID0gbW9udGhJZHggIT09IG51bGwgPyBNRVNFU1ttb250aElkeF0udG9VcHBlckNhc2UoKSA6IG51bGw7XHJcbiAgY29uc3QgaXRlbXMgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IHYgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGlmIChwYXJzZUludCh2LmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xyXG4gICAgaXRlbXMucHVzaCh2KTtcclxuICB9KTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIG5pIGNvbnRhY3RvcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgblZpc2l0YXMgPSBpdGVtcy5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGg7XHJcbiAgY29uc3QgbkNvbnRhY3RvcyA9IGl0ZW1zLmxlbmd0aCAtIG5WaXNpdGFzO1xyXG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWw6ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MuLi4nLCAzMDAwKTtcclxuXHJcbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XHJcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMgeSBDb250YWN0b3MnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBbmlvJywga2V5OiAnYW5pbycsIHdpZHRoOiA4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdJbnRlcmFjY2lvbicsIGtleTogJ2ludGVyYWNjaW9uJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0Zvcm1hIENvbnRhY3RvJywga2V5OiAnZm9ybWFDb250YWN0bycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdSZXN1bHRhZG8gQ29udGFjdG8nLCBrZXk6ICdyZXN1bHRhZG9DdCcsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcclxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcclxuICAgIHsgaGVhZGVyOiAnTmVjZXNpZGFkIFB1bnR1YWwnLCBrZXk6ICduZWMnLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnTWFzIFZlbmRpZG8nLCBrZXk6ICdtYXNWZScsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdNYXMgUHJlZ3VudGFuJywga2V5OiAnbWFzUHInLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnQXl1ZGEgVGllbmRhJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbyBWZW50YScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdQb25kIE1vc3RyYWRvcicsIGtleTogJ3BNb3N0Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywga2V5OiAncEVjb20nLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdHUFMgU3RhdHVzJywga2V5OiAnZ3BzU3QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnR1BTIERpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnRW4gbm9tYnJlIGRlIFZERScsIGtleTogJ29uQmVoYWxmJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0NhcmdhZG8gUG9yJywga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0IH0sXHJcbiAgXTtcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xyXG5cclxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxO1xyXG4gIGNvbnN0IFJPV19IID0gMTAwO1xyXG4gIGNvbnN0IElNR19XID0gMTMwO1xyXG4gIGNvbnN0IElNR19IID0gOTA7XHJcblxyXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcclxuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcblxyXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xyXG4gICAgY29uc3QgaXNDb250YWN0byA9IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nO1xyXG4gICAgY29uc3QgaW50ZXJhY2Npb25MYmwgPSBpc0NvbnRhY3RvID8gJ0NvbnRhY3RvJyA6ICdWaXNpdGEnO1xyXG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XHJcbiAgICBsZXQgcmVzdWx0YWRvQ3RMYmwgPSAnJztcclxuICAgIGlmIChpc0NvbnRhY3RvKSB7XHJcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcclxuICAgICAgZWxzZSBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ25vX3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ05vIHJlc3BvbmRpbyc7XHJcbiAgICAgIGVsc2UgcmVzdWx0YWRvQ3RMYmwgPSAnU2luIG1hcmNhcic7XHJcbiAgICB9XHJcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xyXG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcclxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcclxuICAgICAgYW5pbzogdi5hbmlvIHx8ICcnLFxyXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcclxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgaW50ZXJhY2Npb246IGludGVyYWNjaW9uTGJsLFxyXG4gICAgICBmb3JtYUNvbnRhY3RvOiBmb3JtYUNvbnRhY3RvTGJsLFxyXG4gICAgICByZXN1bHRhZG9DdDogcmVzdWx0YWRvQ3RMYmwsXHJcbiAgICAgIGNvbWVudDogdi5jb21lbnRhcmlvIHx8ICcnLFxyXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXHJcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICAgIHRpZW5kYTogdi50aWVuZGEgfHwgJycsXHJcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcclxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXHJcbiAgICAgIHRhbWFubzogdi50YW1hbm8gfHwgJycsXHJcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXHJcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXHJcbiAgICAgIHBvcDogdi5wb3AgfHwgJycsXHJcbiAgICAgIG5lYzogdi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxyXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXHJcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXHJcbiAgICAgIG1hc1ByOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcclxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXHJcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxyXG4gICAgICBwTW9zdDogdi5wb25kZXJhY2lvbk1vc3RyYWRvIHx8ICcnLFxyXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcclxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXHJcbiAgICAgIGdwc1N0OiB2Lmdwc1N0YXR1cyB8fCAnJyxcclxuICAgICAgZ3BzRGlzdDogdi5ncHNEaXN0YW5jZU0gIT0gbnVsbCA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXHJcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGltYWdlbiBlbmNpbWFcclxuICAgICAgb25CZWhhbGY6IHYub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxyXG4gICAgICBjcmVhdGVkQnk6IHYuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgdi5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xyXG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xyXG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XHJcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcclxuICAgICAgICBpZiAobSkge1xyXG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgICAgYjY0ID0gbVsyXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcclxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcclxuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0YXNGb3JNb250aCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJFTkRJQ0lPTkVTOiBnYXN0b3MgeSBhbnRpY2lwb3MgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSZW5kaWNpb25lcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHJlbmRpY2lvbmVzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIEZpbHRyYXIgcG9yIG1lcy9hbmlvXHJcbiAgY29uc3QgaXRlbXMgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IHIgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGxldCBkdCA9IHIuZmVjaGEgfHwgci5mZWNoYUdhc3RvIHx8ICcnO1xyXG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBkdCA9IHIuY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gICAgICB9IGNhdGNoIChfZSkge31cclxuICAgIH1cclxuICAgIGlmICghZHQpIHJldHVybjtcclxuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XHJcbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRPYmouZ2V0VGltZSgpKSkgcmV0dXJuO1xyXG4gICAgaWYgKGRPYmouZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgIGl0ZW1zLnB1c2goeyBpZDogZC5pZCwgZmVjaGE6IGR0LCByOiByIH0pO1xyXG4gIH0pO1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHJlbmRpY2lvbmVzIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gQ2FyZ2EgbGF6eS5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBpdGVtcy5sZW5ndGggKyAnIHJlbmRpY2lvbmVzLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdSZW5kaWNpb25lcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xyXG4gIHdzLmNvbHVtbnMgPSBbXHJcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0NvbmNlcHRvJywga2V5OiAnY29uY2VwdG8nLCB3aWR0aDogMTggfSxcclxuICAgIHsgaGVhZGVyOiAnTiBUaWNrZXQnLCBrZXk6ICdudW1UaWNrZXQnLCB3aWR0aDogMTQgfSxcclxuICAgIHsgaGVhZGVyOiAnTW9kbyBwYWdvJywga2V5OiAnbW9kb1BhZ28nLCB3aWR0aDogMTQgfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbyBnYXN0bycsIGtleTogJ3RpcG9HYXN0bycsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdEaXZpc2lvbicsIGtleTogJ2RpdmlzaW9uJywgd2lkdGg6IDE0IH0sXHJcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ01vbmVkYScsIGtleTogJ21vbmVkYScsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlIFVTRCcsIGtleTogJ2ltcG9ydGVVc2QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGb3RvIHRpY2tldCcsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnRXN0YWRvJywga2V5OiAnZXN0YWRvJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvcicsIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkbyBlbicsIGtleTogJ2Fwcm9iYWRvRW4nLCB3aWR0aDogMTQgfSxcclxuICBdO1xyXG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjdFMjJDRScgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcclxuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XHJcblxyXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXHJcbiAgY29uc3QgUk9XX0ggPSAxMTA7XHJcbiAgY29uc3QgSU1HX1cgPSAxNDA7XHJcbiAgY29uc3QgSU1HX0ggPSAxMDA7XHJcblxyXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcclxuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcblxyXG4gIGZvciAoY29uc3QgaXQgb2YgaXRlbXMpIHtcclxuICAgIGNvbnN0IHIgPSBpdC5yO1xyXG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcclxuICAgIGNvbnN0IGNvbmNlcHRTdHIgPSBpc0dhc3RvID8gci5kZXNjcmlwY2lvbiB8fCAnJyA6IHIudGlwb09wZXJhY2lvbiB8fCByLm1vdGl2byB8fCAnJztcclxuICAgIGNvbnN0IG9ic1N0ciA9XHJcbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xyXG4gICAgICAoaXNHYXN0byA/ICcnIDogci5zb2xpY2l0YWRvUG9yID8gJyB8IFNvbGljaXRhZG8gcG9yOiAnICsgci5zb2xpY2l0YWRvUG9yIDogJycpO1xyXG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxyXG4gICAgICB0aXBvOiByLnRpcG8gfHwgJycsXHJcbiAgICAgIHZlbmRlZG9yOiByLm93bmVyTmFtZSB8fCByLnZlbmRvck5hbWUgfHwgci5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBlbWFpbDogci5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBjb25jZXB0bzogY29uY2VwdFN0cixcclxuICAgICAgbnVtVGlja2V0OiByLm51bWVyb1RpY2tldCB8fCAnJyxcclxuICAgICAgbW9kb1BhZ286IHIubW9kb1BhZ28gfHwgJycsXHJcbiAgICAgIHRpcG9HYXN0bzogci50aXBvR2FzdG8gfHwgJycsXHJcbiAgICAgIGRpdmlzaW9uOiByLmRpdmlzaW9uR2FzdG8gfHwgJycsXHJcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXHJcbiAgICAgIG1vbmVkYTogci5tb25lZGEgfHwgJ1BFU09TJyxcclxuICAgICAgaW1wb3J0ZVVzZDogci5pbXBvcnRlVXNkICE9IG51bGwgJiYgci5pbXBvcnRlVXNkICE9PSAwID8gci5pbXBvcnRlVXNkIDogJycsXHJcbiAgICAgIG9iczogb2JzU3RyLFxyXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBlbmNpbWEgdmEgbGEgaW1hZ2VuXHJcbiAgICAgIGVzdGFkbzogci5zdGF0dXMgfHwgci5lc3RhZG8gfHwgJycsXHJcbiAgICAgIGFwcm9iYWRvcjogci5hcHByb3ZlckVtYWlsIHx8IHIuYXByb2JhZG9yIHx8ICcnLFxyXG4gICAgICBhcHJvYmFkb0VuOlxyXG4gICAgICAgIHIuYXBwcm92ZWRBdCAmJiByLmFwcHJvdmVkQXQudG9EYXRlID8gci5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICB9KTtcclxuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcclxuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcclxuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBTSUVNUFJFIGVtYmViZXIgbGEgZm90byAobm8gZGVqYXIgaHlwZXJsaW5rKS5cclxuICAgIC8vIEFudGVzOiBzaSBmb3RvVGlja2V0VXJsIChTdG9yYWdlKSwgcXVlZGFiYSBjb21vIGh5cGVybGluayBBYnJpciB0aWNrZXQuXHJcbiAgICAvLyBBaG9yYTogZmV0Y2ggZGVsIFVSTCArIGNvbnZlcnRpciBhIGFycmF5QnVmZmVyICsgZW1iZWJlciBpZ3VhbCBxdWUgZGF0YVVSTC5cclxuICAgIC8vIEZhbGxiYWNrIGEgaHlwZXJsaW5rIHNvbG8gc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCwgZXRjKS5cclxuICAgIGNvbnN0IGZvdG9TcmMgPSByLmZvdG9UaWNrZXQgfHwgci5hZGp1bnRvIHx8ICcnO1xyXG4gICAgaWYgKGZvdG9TcmMgJiYgdHlwZW9mIGZvdG9TcmMgPT09ICdzdHJpbmcnICYmIGZvdG9TcmMuc3RhcnRzV2l0aCgnZGF0YTppbWFnZS8nKSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBiNjQgPSBmb3RvU3JjO1xyXG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XHJcbiAgICAgICAgaWYgKG0pIHtcclxuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgIGI2NCA9IG1bMl07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXHJcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXHJcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IGZldGNoIGxhIGZvdG8gZGVzZGUgU3RvcmFnZSB5IGVtYmViZXJsYSBjb21vIGltYWdlbi5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2goci5mb3RvVGlja2V0VXJsKTtcclxuICAgICAgICBpZiAoIXJlc3Aub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgcmVzcC5zdGF0dXMpO1xyXG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcC5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykgfHwgJ2ltYWdlL2pwZWcnO1xyXG4gICAgICAgIGxldCBleHQgPSBjb250ZW50VHlwZS5zcGxpdCgnLycpWzFdIHx8ICdqcGVnJztcclxuICAgICAgICBleHQgPSBleHQuc3BsaXQoJzsnKVswXS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHJlc3AuYXJyYXlCdWZmZXIoKTtcclxuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBidWZmZXI6IGJ1ZiwgZXh0ZW5zaW9uOiBleHQgfSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcclxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgLy8gRmFsbGJhY2s6IHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQpLCBkZWphciBoeXBlcmxpbmsgY29tbyBhbnRlcy5cclxuICAgICAgICBjb25zb2xlLndhcm4oJ2ZldGNoIGZvdG8gcmVuZGljaW9uIGZhbGxvLCBkZWpvIGh5cGVybGluaycsIGl0LmlkLCBlKTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgY29uc3QgY2VsbCA9IHJvdy5nZXRDZWxsKEZPVE9fQ09MX0lEWCArIDEpO1xyXG4gICAgICAgICAgY2VsbC52YWx1ZSA9IHtcclxuICAgICAgICAgICAgdGV4dDogJ0FicmlyIHRpY2tldCcsXHJcbiAgICAgICAgICAgIGh5cGVybGluazogci5mb3RvVGlja2V0VXJsLFxyXG4gICAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXIgKGZldGNoIGZhbGxvKScsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkYwNTYzQzEnIH0sIHVuZGVybGluZTogdHJ1ZSB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKF9lMikge31cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19SZW5kaWNpb25lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSdXRhcy4uLicpO1xyXG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xyXG4gIC8vIChkZXJpdmFjaW9uZXMgLyByZWFnZW5kYXMpIHZpdmVuIGVuIHJvdXRlX292ZXJyaWRlcy4gRXhwb3J0YW1vczpcclxuICAvLyAgLSB1bmEgaG9qYSBjb24gbGFzIHJ1dGFzIHBsYW5pZmljYWRhcyBkZWwgcGVyaW9kbyAocGFyYSBsb3MgdmVuZGVkb3Jlc1xyXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXHJcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxvcyBvdmVycmlkZXMgZGVsIHBlcmlvZG9cclxuICBjb25zdCB0YXJnZXRWZW5kb3JzID1cclxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xyXG4gICAgICA/IFZFTkRPUlMubWFwKCh2KSA9PiB2LmtleSlcclxuICAgICAgOiBhc3NpZ25lZFZlbmRvclxyXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxyXG4gICAgICAgIDogW107XHJcbiAgY29uc3QgbW9udGhzVG9FeHBvcnQgPSBtb250aElkeCAhPT0gbnVsbCA/IFttb250aElkeF0gOiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgNywgOCwgOSwgMTAsIDExXTtcclxuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcclxuICBmb3IgKGNvbnN0IHZlbmQgb2YgdGFyZ2V0VmVuZG9ycykge1xyXG4gICAgZm9yIChjb25zdCBtIG9mIG1vbnRoc1RvRXhwb3J0KSB7XHJcbiAgICAgIGxldCBydXRhcztcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBydXRhcyA9IGdlbmVyYXJSdXRhc1ZlbmRvcih2ZW5kLCBtLCBhbmlvKTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHtcclxuICAgICAgICBydXRhcyA9IFtdO1xyXG4gICAgICB9XHJcbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xyXG4gICAgICAgIChydXRhLnRpZW5kYXMgfHwgW10pLmZvckVhY2goKHQsIGkpID0+IHtcclxuICAgICAgICAgIHJ1dGFzUm93cy5wdXNoKHtcclxuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcclxuICAgICAgICAgICAgQW5pbzogYW5pbyxcclxuICAgICAgICAgICAgTWVzOiBNRVNFU1ttXSxcclxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcclxuICAgICAgICAgICAgUnV0YV9Ob21icmU6IHJ1dGEubm9tYnJlIHx8ICcnLFxyXG4gICAgICAgICAgICBGZWNoYV9Bc2lnbmFkYTogcnV0YS5mZWNoYUFzaWduYWRhIHx8ICcnLFxyXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXHJcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHQucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgICAgICBMb2NhbGlkYWQ6IHQubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgICAgIFRpcG86IHQudGlwbyB8fCAnJyxcclxuICAgICAgICAgICAgRXN0YWRvOiB0LmVzdGFkbyB8fCAnJyxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gT3ZlcnJpZGVzXHJcbiAgbGV0IG92clNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIG92clNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvdXRlX292ZXJyaWRlcycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICBvdnJTbmFwID0gbnVsbDtcclxuICB9XHJcbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xyXG4gIGlmIChvdnJTbmFwKSB7XHJcbiAgICBvdnJTbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBpZiAocGFyc2VJbnQoby5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KG8ubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcclxuICAgICAgICBBbmlvOiBvLmFuaW8gfHwgJycsXHJcbiAgICAgICAgTWVzOiBNRVNFU1twYXJzZUludChvLm1vbnRoSWR4LCAxMCldIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKG8ucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIEFjY2lvbjogby5hY3Rpb24gfHwgby50aXBvIHx8ICcnLFxyXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxyXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcclxuICAgICAgICBNb3Rpdm86IG8ubW90aXZvIHx8ICcnLFxyXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgICAgQ3JlYWRvX0VuOlxyXG4gICAgICAgICAgby5jcmVhdGVkQXQgJiYgby5jcmVhdGVkQXQudG9EYXRlID8gby5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19SdXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcclxuICAgIHsgbmFtZTogJ1J1dGFzIHBsYW5pZmljYWRhcycsIHJvd3M6IHJ1dGFzUm93cyB9LFxyXG4gICAgeyBuYW1lOiAnRGVyaXZhY2lvbmVzLVJlYWdlbmRhcycsIHJvd3M6IG92ZXJyaWRlc1Jvd3MgfSxcclxuICBdKTtcclxuICBzaG93U3luY1RhZyhcclxuICAgICdFeHBvcnQgUnV0YXMgbGlzdG8gKCcgKyBydXRhc1Jvd3MubGVuZ3RoICsgJyB0aWVuZGFzLCAnICsgb3ZlcnJpZGVzUm93cy5sZW5ndGggKyAnIG92ZXJyaWRlcyknLFxyXG4gICAgMjQwMFxyXG4gICk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQWx0YXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGxldCBkdCA9ICcnO1xyXG4gICAgaWYgKGEuY3JlYXRlZEF0ICYmIGEuY3JlYXRlZEF0LnRvRGF0ZSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGR0ID0gYS5jcmVhdGVkQXQudG9EYXRlKCk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfVxyXG4gICAgaWYgKCFkdCkgcmV0dXJuO1xyXG4gICAgaWYgKGR0LmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgcm93cy5wdXNoKHtcclxuICAgICAgRmVjaGFfU29saWNpdHVkOiBkdC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSxcclxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcclxuICAgICAgQ29tZXJjaW86IGEuY29tZXJjaW8gfHwgJycsXHJcbiAgICAgIEZhbnRhc2lhOiBhLmZhbnRhc2lhIHx8ICcnLFxyXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXHJcbiAgICAgIENvbmRpY2lvbl9GaXNjYWw6IGEuY29uZEZpc2NhbCB8fCAnJyxcclxuICAgICAgQ2FsbGU6IGEuY2FsbGUgfHwgJycsXHJcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXHJcbiAgICAgIExvY2FsaWRhZDogYS5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICAgIFByb3ZpbmNpYTogYS5wcm92aW5jaWEgfHwgJycsXHJcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxyXG4gICAgICBUZWxlZm9ubzogYS50ZWxlZm9ubyB8fCAnJyxcclxuICAgICAgRW1haWw6IGEuZW1haWwgfHwgJycsXHJcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBPd25lcl9FbWFpbDogYS5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBTdWJtaXR0ZWRfQnlfUHVibGljX0Zvcm06IGEuc3VibWl0dGVkQnlQdWJsaWNGb3JtID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgIEFwcm9iYWRvX0VuOlxyXG4gICAgICAgIGEuYXBwcm92ZWRBdCAmJiBhLmFwcHJvdmVkQXQudG9EYXRlID8gYS5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0FsdGFzIGRlIGNsaWVudGVzJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBBbHRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBzb2xpY2l0dWRlcyknLCAyNDAwKTtcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIHY3MDkgKDIwMjYtMDgtMjgpOiAzIGV4cG9ydHMgbnVldm9zIHBlZGlkb3MgcG9yIE1hcmlhbm8uXHJcbi8vIC0gQkFDS09SREVSOiBsaW5lYXMgc3RhdGU9Qk8gb3BlbiBwb3IgbWVzIGRlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLlxyXG4vLyAtIFNUT0NLX0FTSUc6IGxpbmVhcyBBU0lHIG9wZW4gKG8gQk8rc3RvY2sgZGlzcCkgcG9yIG1lcyBkZSBjcmVhdGVkQXQuXHJcbi8vIC0gUEVESURPU19NRVM6IFRPRE9TIGxvcyBwZWRpZG9zIGNyZWFkb3MgZW4gZWwgbWVzL2FuaW8gKGN1YWxxdWllciBzdGFnZSkuXHJcbi8vIEZ1ZW50ZTogZ2xvYmFsUGVkaWRvcyAobG8gcXVlIGxhIGFwcCB5YSB0aWVuZSBlbiBtZW1vcmlhKS5cclxuLy8gRmlsdGVyIG1lcy9hXHUwMEYxbzogc29icmUgY3JlYXRlZEF0IGRlbCBwZWRpZG8uIG1vbnRoSWR4PW51bGwgLT4gYVx1MDBGMW8gZW50ZXJvLlxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuZnVuY3Rpb24gX3BlZGlkb01vbnRoWWVhcihwKSB7XHJcbiAgY29uc3QgY2EgPSBwLmNyZWF0ZWRBdDtcclxuICBpZiAoIWNhKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XHJcbiAgbGV0IGR0ID0gbnVsbDtcclxuICBpZiAodHlwZW9mIGNhID09PSAnc3RyaW5nJykgZHQgPSBuZXcgRGF0ZShjYSk7XHJcbiAgZWxzZSBpZiAodHlwZW9mIGNhLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgZHQgPSBjYS50b0RhdGUoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhID09PSAnbnVtYmVyJykgZHQgPSBuZXcgRGF0ZShjYSk7XHJcbiAgaWYgKCFkdCB8fCBOdW1iZXIuaXNOYU4oZHQuZ2V0VGltZSgpKSkgcmV0dXJuIHsgeTogbnVsbCwgbTogbnVsbCB9O1xyXG4gIHJldHVybiB7IHk6IGR0LmdldEZ1bGxZZWFyKCksIG06IGR0LmdldE1vbnRoKCkgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgY29uc3QgYXJyID1cclxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xyXG4gIHJldHVybiBhcnIuZmlsdGVyKChwKSA9PiB7XHJcbiAgICBpZiAoIXApIHJldHVybiBmYWxzZTtcclxuICAgIGNvbnN0IHsgeSwgbSB9ID0gX3BlZGlkb01vbnRoWWVhcihwKTtcclxuICAgIGlmICh5ID09IG51bGwpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICh5ICE9PSBhbmlvKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgbSAhPT0gbW9udGhJZHgpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlci4uLicpO1xyXG4gIC8vIHYxMTAwOiBkZWxlZ2EgYWwgbVx1MDBGM2R1bG8gcHVyby4gRmlsdHJhIHBvciBtZXMgdlx1MDBFRGEgZmlsdGVycy5tZXNZWVlZTU1cclxuICAvLyAocXVlIGVsIG1cdTAwRjNkdWxvIGFwbGljYSBzb2JyZSBjb25maXJtZWRBdCkuIENvaW5jaWRlIGNvbiBlbCBtb2RhbC5cclxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcclxuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcclxuICBjb25zdCBjb21wdXRlRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzO1xyXG4gIGNvbnN0IG1lc1lZWVlNTSA9IGFuaW8gKyAnLScgKyBTdHJpbmcobW9udGhJZHggKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xyXG4gIC8vIHYxMTAxICgyMDI2LTA5LTMwKTogYnVzY2FyIHByaW1lcm8gcG9yIHNhcENhcmRDb2RlIChcdTAwRkFuaWNvLCBubyBkZXBlbmRlIGRlXHJcbiAgLy8gbm9ybWFsaXphY2lcdTAwRjNuIGRlIHN0cmluZ3MpIHkgc1x1MDBGM2xvIGNhZXIgYWwgY2xpZW50TG9jSWQgY29tbyBcdTAwRkFsdGltbyByZWN1cnNvLlxyXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxyXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xyXG4gICAgICBpZiAoIWNhY2hlKSByZXR1cm4gJyc7XHJcbiAgICAgIGNvbnN0IGNjID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcclxuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgbGV0IGZvdW5kID0gJyc7XHJcbiAgICAgICAgY2FjaGUuZm9yRWFjaCgoY21EYXRhKSA9PiB7XHJcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcclxuICAgICAgICAgIGlmIChjbURhdGEgJiYgU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpID09PSBjYyAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHtcclxuICAgICAgICAgICAgZm91bmQgPSBjbURhdGEuYXNzaWduZWRWZW5kb3I7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiBjYWNoZS5nZXQgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XHJcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xyXG4gICAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfSBjYXRjaCAoX2UpIHtcclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfVxyXG4gIH07XHJcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cclxuICAgID8gY29tcHV0ZUZuKFxyXG4gICAgICAgIHBlZGlkb3MsXHJcbiAgICAgICAgJ3VyZ2VudGUnLFxyXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XHJcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXHJcbiAgICAgICAgICBjYW5vblZlbmRvcjpcclxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXHJcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxyXG4gICAgICAgICAgICAgIDogKHgpID0+XHJcbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxyXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcclxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcclxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxyXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxyXG4gICAgICAgIH1cclxuICAgICAgKVxyXG4gICAgOiBbXTtcclxuICBjb25zdCBwZWRpZG9CeUlkID0ge307XHJcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICByYXdMaW5lcy5mb3JFYWNoKChybCkgPT4ge1xyXG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XHJcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xyXG4gICAgY29uc3QgcW8gPSBjLnF0eUJhY2tvcmRlciB8fCAwO1xyXG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XHJcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcclxuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcclxuICAgICAgZmVjaGFQZWRpZG8gPVxyXG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcclxuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gICAgfVxyXG4gICAgbGV0IGNhbnRpZGFkUGVkaWRhID0gcW87XHJcbiAgICBsZXQgbGluZWFJZHggPSAtMTtcclxuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcclxuICAgICAgY29uc3QgaWR4ID0gcC5saW5lcy5maW5kSW5kZXgoXHJcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcclxuICAgICAgKTtcclxuICAgICAgaWYgKGlkeCA+PSAwKSB7XHJcbiAgICAgICAgY2FudGlkYWRQZWRpZGEgPSBOdW1iZXIocC5saW5lc1tpZHhdLnF0eSkgfHwgcW87XHJcbiAgICAgICAgbGluZWFJZHggPSBpZHg7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXHJcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXHJcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxyXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxyXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxyXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXHJcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcclxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXHJcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcclxuICAgICAgQ2FudGlkYWRfUGVkaWRhOiBjYW50aWRhZFBlZGlkYSxcclxuICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcclxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxyXG4gICAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQocW8gKiAoYy5wcmVjaW8gfHwgMCkpLFxyXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXHJcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXHJcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl8nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8uLi4nKTtcclxuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8gbW9kbyBhc2lnbmFjaW9uLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXHJcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XHJcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XHJcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcclxuICBjb25zdCBtZXNZWVlZTU0gPSBhbmlvICsgJy0nICsgU3RyaW5nKG1vbnRoSWR4ICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cclxuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxyXG4gIC8vIG5vcm1hbGl6YWNpXHUwMEYzbiBkZSBzdHJpbmdzKSB5IHNcdTAwRjNsbyBjYWVyIGFsIGNsaWVudExvY0lkIGNvbW8gXHUwMEZBbHRpbW8gcmVjdXJzby5cclxuICAvLyBWZXIgY29tZW50YXJpbyBleHRlbmRpZG8gZW4gaW5kZXguaHRtbDpleHBvcnRCYWNrb3JkZXJzVG9FeGNlbC5cclxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNhY2hlID0gdy5jbGllbnRNYXN0ZXJDYWNoZTtcclxuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xyXG4gICAgICBjb25zdCBjYyA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XHJcbiAgICAgIGlmIChjYyAmJiB0eXBlb2YgY2FjaGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xyXG4gICAgICAgIGNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xyXG4gICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm47XHJcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XHJcbiAgICAgICAgICAgIGZvdW5kID0gY21EYXRhLmFzc2lnbmVkVmVuZG9yO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xyXG4gICAgICAgIGNvbnN0IGNtRGF0YSA9IGNhY2hlLmdldChjbURvY0lkKTtcclxuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiAnJztcclxuICAgIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICAgIHJldHVybiAnJztcclxuICAgIH1cclxuICB9O1xyXG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXHJcbiAgICA/IGNvbXB1dGVGbihcclxuICAgICAgICBwZWRpZG9zLFxyXG4gICAgICAgICdhc2lnbmFjaW9uJyxcclxuICAgICAgICB7IG1lc1lZWVlNTSB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxyXG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxyXG4gICAgICAgICAgY2Fub25WZW5kb3I6XHJcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xyXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcclxuICAgICAgICAgICAgICA6ICh4KSA9PlxyXG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcclxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXHJcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcclxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcclxuICAgICAgICB9XHJcbiAgICAgIClcclxuICAgIDogW107XHJcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xyXG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSBpZiAocCAmJiBwLl9mc0lkKSBwZWRpZG9CeUlkW3AuX2ZzSWRdID0gcDtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcclxuICAgIGNvbnN0IGMgPSBybC5jbGllbnRlO1xyXG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcclxuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcclxuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xyXG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XHJcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XHJcbiAgICAgIGZlY2hhUGVkaWRvID1cclxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICAgIH1cclxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xyXG4gICAgaWYgKHAgJiYgQXJyYXkuaXNBcnJheShwLmxpbmVzKSkge1xyXG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcclxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxyXG4gICAgICApO1xyXG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xyXG4gICAgfVxyXG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XHJcbiAgICBpZiAoYy5zdGF0ZSA9PT0gJ0JPJykgZXN0YWRvUmVhbCA9ICdCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRyknO1xyXG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXHJcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXHJcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxyXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxyXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxyXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXHJcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcclxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXHJcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcclxuICAgICAgQ2FudGlkYWRfUmVzZXJ2YWRhOiBxdHksXHJcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxyXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXHJcbiAgICAgIFN1YnRvdGFsX1Jlc2VydmFkb19BUlM6IE1hdGgucm91bmQocXR5ICogKGMucHJlY2lvIHx8IDApKSxcclxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxyXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWduYWRvIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufVxyXG5cclxuLy8gdjczNyAoMjAyNi0wOC0zMCk6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvcyBsb3MgYmFja29yZGVycyBvcGVuIChzaW4gZmlsdHJvXHJcbi8vIGRlIG1lcykuIE1vdGl2bzogbG9zIDYyIHBlZGlkb3MgbWlncmFkb3MgZGVzZGUgU0FQIGVsIDIwMjYtMDgtMjggdGllbmVuXHJcbi8vIGNyZWF0ZWRBdCBkZSBmZWNoYXMgdmllamFzIGRlbCBTQVAgU1Egb3JpZ2luYWwsIGVudG9uY2VzIGVsIGV4cG9ydCBwb3IgbWVzXHJcbi8vIG5vIGxvcyBpbmNsdWlhLiBWZXJzaW9uIFwiY3VycmVudCBzdGF0dXNcIiBxdWUgaXRlcmEgZ2xvYmFsUGVkaWRvcyBjb21wbGV0by5cclxud2luZG93LmV4cG9ydEJhY2tvcmRlckFsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIgKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcclxuICAvLyB2MTEwMCAoMjAyNi0wOS0zMCk6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvIGJhY2tvcmRlci1za3UtbWFwIFx1MjAxNCBtaXNtb1xyXG4gIC8vIEZJRk8gKyBmaWx0cm8gdmVuY2lkYXMgKyBlc3RhZG9zIChCTytBU0lHK2NvbmZpcm1lZCkgcXVlIGVsIG1vZGFsLiBBbnRlc1xyXG4gIC8vIGVzdGUgZXhwb3J0IGVyYSB1biBkdW1wIGNydWRvIGRlIGxcdTAwRURuZWFzIHN0YXRlPUJPIHNpbiBjYXAgbmkgZmlsdHJvXHJcbiAgLy8gdmVuY2lkYXMsIGFzXHUwMEVEIHF1ZSBkaXZlcmdcdTAwRURhIGRlbCBtb2RhbC4gQWhvcmEgZXMgcGFyaWRhZCB0b3RhbC5cclxuICBjb25zdCBhcnIgPVxyXG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XHJcbiAgY29uc3QgdG90YWxQZWRpZG9zT3BlbiA9IGFyci5maWx0ZXIoKHApID0+IHAgJiYgIXAuY2xvc2VkQXQpLmxlbmd0aDtcclxuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cclxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xyXG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xyXG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgIT09ICdmdW5jdGlvbicgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KVxyXG4gICAgICAgIHJldHVybiAnJztcclxuICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xyXG4gICAgICBjb25zdCBjbURhdGEgPSB3LmNsaWVudE1hc3RlckNhY2hlLmdldChjbURvY0lkKTtcclxuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcclxuICAgIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICAgIHJldHVybiAnJztcclxuICAgIH1cclxuICB9O1xyXG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xyXG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XHJcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cclxuICAgID8gY29tcHV0ZUZuKFxyXG4gICAgICAgIGFycixcclxuICAgICAgICAndXJnZW50ZScsXHJcbiAgICAgICAge30sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XHJcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXHJcbiAgICAgICAgICBjYW5vblZlbmRvcjpcclxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXHJcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxyXG4gICAgICAgICAgICAgIDogKHgpID0+XHJcbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxyXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcclxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcclxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxyXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxyXG4gICAgICAgIH1cclxuICAgICAgKVxyXG4gICAgOiBbXTtcclxuICAvLyBcdTAwQ0RuZGljZSBwZWRpZG9JZCBcdTIxOTIgcGVkaWRvIHBhcmEgZW5yaXF1ZWNlciBjb24gY2FtcG9zIHF1ZSBlbCBtXHUwMEYzZHVsbyBubyBleHBvbmVcclxuICAvLyAoTWVzLCBDYW50aWRhZF9QZWRpZGEgb3JpZ2luYWwsIE9yaWdlbiwgTGluZWFfSWR4KS5cclxuICBjb25zdCBwZWRpZG9CeUlkID0ge307XHJcbiAgZm9yIChjb25zdCBwIG9mIGFycikgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XHJcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcclxuICAgIGNvbnN0IHAgPSBjLnBlZGlkb0lkID8gcGVkaWRvQnlJZFtjLnBlZGlkb0lkXSA6IG51bGw7XHJcbiAgICAvLyBDYW50aWRhZF9QZW5kaWVudGVfQk8gPSBxdHlCYWNrb3JkZXIgcG9zdC1GSUZPLlxyXG4gICAgY29uc3QgcW8gPSBjLnF0eUJhY2tvcmRlciB8fCAwO1xyXG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XHJcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcclxuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcclxuICAgICAgZmVjaGFQZWRpZG8gPVxyXG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcclxuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gICAgfVxyXG4gICAgLy8gUmVjdXBlcmFyIGxhIGxcdTAwRURuZWEgb3JpZ2luYWwgcGFyYSBDYW50aWRhZF9QZWRpZGEgKyBMaW5lYV9JZHggKHNpIGhheSBwZWRpZG8pLlxyXG4gICAgbGV0IGNhbnRpZGFkUGVkaWRhID0gcW87XHJcbiAgICBsZXQgbGluZWFJZHggPSAtMTtcclxuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcclxuICAgICAgY29uc3QgaWR4ID0gcC5saW5lcy5maW5kSW5kZXgoXHJcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcclxuICAgICAgKTtcclxuICAgICAgaWYgKGlkeCA+PSAwKSB7XHJcbiAgICAgICAgY2FudGlkYWRQZWRpZGEgPSBOdW1iZXIocC5saW5lc1tpZHhdLnF0eSkgfHwgcW87XHJcbiAgICAgICAgbGluZWFJZHggPSBpZHg7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXHJcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXHJcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxyXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxyXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxyXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXHJcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcclxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXHJcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcclxuICAgICAgQ2FudGlkYWRfUGVkaWRhOiBjYW50aWRhZFBlZGlkYSxcclxuICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcclxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxyXG4gICAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQocW8gKiAoYy5wcmVjaW8gfHwgMCkpLFxyXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXHJcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXHJcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcclxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXHJcbiAgICAgIC8vIHYxMTAwOiBjb250ZXh0byBcdTAwRkF0aWwgcGFyYSBkZWJ1Z2dpbmcgcGFyaWRhZCBtb2RhbFx1MjE5NHJlcG9ydGUuXHJcbiAgICAgIEVzdGFkbzogYy5zdGF0ZSB8fCAnQk8nLFxyXG4gICAgICBTdG9ja19EaXNwX1NLVTogcmwuZGlzcFNhcCB8fCAwLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ0V4cG9ydCBCYWNrb3JkZXIgdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xyXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXHJcbiAgICAgICAgYXJyLmxlbmd0aCArXHJcbiAgICAgICAgJ1xcbicgK1xyXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xyXG4gICAgICAgIHRvdGFsUGVkaWRvc09wZW4gK1xyXG4gICAgICAgICdcXG4nICtcclxuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlCYWNrb3JkZXI+MDogMFxcblxcbicgK1xyXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXHJcbiAgICAgICAgJzEuIE5vIGhheSBiYWNrb3JkZXIgYWJpZXJ0byBhaG9yYSBtaXNtbyAodG9kbyBjb25maXJtZWQsIGNlcnJhZG8gbyB2ZW5jaWRvKVxcbicgK1xyXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcclxuICAgICAgICAnMy4gVG9kYXMgbGFzIGxpbmVhcyBCTyB0aWVuZW4gc3RvY2sgZGlzcG9uaWJsZSAoZnVlcm9uIHByb21vdmlkYXMgYSBBU0lHIHZpcnR1YWwpJ1xyXG4gICAgKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xyXG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl9TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufTtcclxuXHJcbi8vIHY3Mzc6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvIGVsIFN0b2NrIEFzaWduYWRvIChzaW4gZmlsdHJvIGRlIG1lcykuIE1pc21vXHJcbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxyXG53aW5kb3cuZXhwb3J0U3RvY2tBc2lnQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFN0b2NrIEFzaWduYWRvIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XHJcbiAgLy8gdjExMDAgKDIwMjYtMDktMzApOiBtaXNtbyBtXHUwMEYzZHVsbyBwdXJvIHF1ZSByZW5kZXJCYWNrb3JkZXJzVGFiIGVuIG1vZG9cclxuICAvLyBhc2lnbmFjaW9uLiBBaG9yYSBlbCByZXBvcnRlIGNvaW5jaWRlIGNvbiBlbCBtb2RhbDogRklGTyBjYXAgcG9yIGRpc3BTYXAsXHJcbiAgLy8gZmlsdHJvIHZlbmNpZGFzIChBU0lHID4xNWQgZnVlcmEsIEFTSUcgc2luIHJlc2VydmEgdmlnZW50ZSBhZGVudHJvKSxcclxuICAvLyBjb25maXJtZWQgaW5jbHVpZG8sIHNpbiBsXHUwMEVEbmVhcyBcInZpcnR1YWxfQVNJR1wiIGZhbnRhc21hLlxyXG4gIGNvbnN0IGFyciA9XHJcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcclxuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xyXG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xyXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gJyc7XHJcbiAgICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XHJcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXHJcbiAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XHJcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xyXG4gICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xyXG4gICAgfSBjYXRjaCAoX2UpIHtcclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfVxyXG4gIH07XHJcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XHJcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcclxuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxyXG4gICAgPyBjb21wdXRlRm4oXHJcbiAgICAgICAgYXJyLFxyXG4gICAgICAgICdhc2lnbmFjaW9uJyxcclxuICAgICAgICB7fSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcclxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcclxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxyXG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcclxuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXHJcbiAgICAgICAgICAgICAgOiAoeCkgPT5cclxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXHJcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxyXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXHJcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXHJcbiAgICAgICAgfVxyXG4gICAgICApXHJcbiAgICA6IFtdO1xyXG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcclxuICBmb3IgKGNvbnN0IHAgb2YgYXJyKSBpZiAocCAmJiBwLl9mc0lkKSBwZWRpZG9CeUlkW3AuX2ZzSWRdID0gcDtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcclxuICAgIGNvbnN0IGMgPSBybC5jbGllbnRlO1xyXG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcclxuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcclxuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xyXG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XHJcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XHJcbiAgICAgIGZlY2hhUGVkaWRvID1cclxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICAgIH1cclxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xyXG4gICAgaWYgKHAgJiYgQXJyYXkuaXNBcnJheShwLmxpbmVzKSkge1xyXG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcclxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxyXG4gICAgICApO1xyXG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xyXG4gICAgfVxyXG4gICAgLy8gRXN0YWRvX1JlYWw6IGhpc3RcdTAwRjNyaWNvIFwiQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpXCIgdnMgXCJBU0lHXCIuIHYxMTAwOlxyXG4gICAgLy8gYWhvcmEgYGNvbmZpcm1lZGAgdGFtYmlcdTAwRTluIGVudHJhICh2OTYyKS4gUHJlc2VydmFtb3MgZXRpcXVldGEgbGVnYWN5XHJcbiAgICAvLyBwb3IgY29tcGF0aWJpbGlkYWQgY29uIHF1aWVuIGNvbnN1bWUgZWwgRXhjZWwuXHJcbiAgICBsZXQgZXN0YWRvUmVhbCA9ICdBU0lHJztcclxuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XHJcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xyXG4gICAgcm93cy5wdXNoKHtcclxuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcclxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcclxuICAgICAgQ2xpZW50ZTogYy5ub21icmUgfHwgJycsXHJcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXHJcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXHJcbiAgICAgIExvY2FsaWRhZDogYy5jaXVkYWQgfHwgKHAgJiYgcC5sb2NOYW1lKSB8fCAnJyxcclxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxyXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcclxuICAgICAgUHJvZHVjdG86IHJsLnByb2R1Y3RvIHx8ICcnLFxyXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcclxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXHJcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcclxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxyXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXHJcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXHJcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcclxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXHJcbiAgICAgIC8vIHYxMTAwOiBjb250ZXh0byBcdTAwRkF0aWwgcGFyYSBkZWJ1Z2dpbmcgcGFyaWRhZCBtb2RhbFx1MjE5NHJlcG9ydGUuXHJcbiAgICAgIFN0b2NrX0Rpc3BfU0tVOiBybC5kaXNwU2FwIHx8IDAsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnRXhwb3J0IFN0b2NrIEFzaWduYWRvIHZhY2lvLiBEaWFnbm9zdGljbzpcXG4nICtcclxuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xyXG4gICAgICAgIGFyci5sZW5ndGggK1xyXG4gICAgICAgICdcXG4nICtcclxuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcclxuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJy0gTGluZWFzIHBvc3QtRklGTyt2ZW5jaWRhcyBjb24gcXR5QXNpZ25hZGE+MDogMFxcblxcbicgK1xyXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXHJcbiAgICAgICAgJzEuIE5vIGhheSBzdG9jayBhc2lnbmFkbyBhaG9yYSBtaXNtb1xcbicgK1xyXG4gICAgICAgICcyLiBUb2RvcyBsb3MgQVNJRyBlc3RhbiB2ZW5jaWRvcyAoPjE1ZCBkZXNkZSBhc2lnQXQpXFxuJyArXHJcbiAgICAgICAgJzMuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvJ1xyXG4gICAgKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZzogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb19TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn07XHJcblxyXG4vLyB2OTc1ICgyMDI2LTA5LTE3KTogcmVzdWVsdmUgbm9tYnJlIGRlIGZhbnRhc2lhIHBhcmEgdW4gcGVkaWRvIHVzYW5kbyBlbFxyXG4vLyBtaXNtbyBwYXR0ZXJuIHF1ZSBsYXMgY2FyZHMgZGVsIG1hcGEgKGluZGV4Lmh0bWw6OTkxNS05OTM1KTpcclxuLy8gICAxKSBjbGllbnRNZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYSAoZWRpdGFkbyBkZXNkZSBlbCBtb2RhbCBjbGllbnRlKVxyXG4vLyAgIDIpIGFwcHJvdmVkQWx0YXNMaXN0W10uZmFudGFzaWEgbWF0Y2hlYWRvIHBvciBjb21lcmNpbyA9PSBjbGllbnROYW1lXHJcbmZ1bmN0aW9uIF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCkge1xyXG4gIGNvbnN0IGNhcmRDb2RlID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcclxuICBpZiAoY2FyZENvZGUpIHtcclxuICAgIGNvbnN0IG1ldGEgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmNsaWVudE1ldGE7XHJcbiAgICBjb25zdCBjdXN0b20gPSBtZXRhICYmIG1ldGFbY2FyZENvZGVdICYmIG1ldGFbY2FyZENvZGVdLmN1c3RvbUZhbnRhc2lhO1xyXG4gICAgaWYgKGN1c3RvbSAmJiBTdHJpbmcoY3VzdG9tKS50cmltKCkpIHJldHVybiBTdHJpbmcoY3VzdG9tKS50cmltKCk7XHJcbiAgfVxyXG4gIGNvbnN0IGFsdGFzID0gLyoqIEB0eXBlIHthbnl9ICovIChnbG9iYWxUaGlzKS5hcHByb3ZlZEFsdGFzTGlzdDtcclxuICBpZiAoQXJyYXkuaXNBcnJheShhbHRhcykpIHtcclxuICAgIGNvbnN0IG5hbWVMb3dlciA9IFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpXHJcbiAgICAgIC50cmltKClcclxuICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAobmFtZUxvd2VyKSB7XHJcbiAgICAgIGNvbnN0IG1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4ge1xyXG4gICAgICAgIGlmICghYSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIGNvbnN0IGMgPSBTdHJpbmcoYS5jb21lcmNpbyB8fCAnJylcclxuICAgICAgICAgIC50cmltKClcclxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIGNvbnN0IGYgPSBTdHJpbmcoYS5mYW50YXNpYSB8fCAnJylcclxuICAgICAgICAgIC50cmltKClcclxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiBjID09PSBuYW1lTG93ZXIgfHwgZiA9PT0gbmFtZUxvd2VyO1xyXG4gICAgICB9KTtcclxuICAgICAgaWYgKG1hdGNoICYmIG1hdGNoLmZhbnRhc2lhICYmIFN0cmluZyhtYXRjaC5mYW50YXNpYSkudHJpbSgpKSB7XHJcbiAgICAgICAgcmV0dXJuIFN0cmluZyhtYXRjaC5mYW50YXNpYSkudHJpbSgpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiAnJztcclxufVxyXG5cclxuLy8gdjEyMzMgKDIwMjYtMTAtMDkpOiByZXBvcnRlIFwiVmVudGFzIHggYXJ0aWN1bG8geCBjbGllbnRlL3ZlbmRlZG9yXCIgdmlhIENGLlxyXG4vLyBBZG1pbi9nZXJlbnRlIG9ubHkuIFRhcmRhIH4zMC02MHMgKEJRIHF1ZXJ5ICsgZXhjZWxqcyBidWlsZCBzZXJ2ZXItc2lkZSkuXHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0FydENsaUZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHtcclxuICAgIGFsZXJ0KCdFbGVnXHUwMEVEIHVuIE1FUyBlc3BlY1x1MDBFRGZpY28gKG5vIFwiVG9kbyBlbCBhXHUwMEYxb1wiKSBcdTIwMTQgZXN0ZSByZXBvcnRlIGVzIG1lbnN1YWwuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIG1vbnRoSWR4IHZpZW5lIDAtYmFzZWQgZGVzZGUgZWwgcGlja2VyIChlbmU9MCkuIENGIGVzcGVyYSAxLWJhc2VkLlxyXG4gIGNvbnN0IG1vbnRoID0gbW9udGhJZHggKyAxO1xyXG4gIGNvbnN0IHllYXIgPSBhbmlvO1xyXG4gIGNvbnN0IHBlcmlvZG8gPSAod2luZG93Lk1FU0VTID8gd2luZG93Lk1FU0VTW21vbnRoSWR4XSA6IG1vbnRoKSArICcgJyArIHllYXI7XHJcbiAgY29uc3QgY29uZmlybU1zZyA9XHJcbiAgICAnR2VuZXJhciByZXBvcnRlIFwiVkVOVEFTIHggQVJUSUNVTE8geCBDTElFTlRFL1ZFTkRFRE9SXCIgZGUgJyArXHJcbiAgICBwZXJpb2RvICtcclxuICAgICc/XFxuXFxuJyArXHJcbiAgICAnRnVlbnRlOiBTQVAgdmlhIEJpZ1F1ZXJ5IChkYXRvcyBleGFjdG9zKS5cXG4nICtcclxuICAgICdQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuXFxuJyArXHJcbiAgICAnQWwgdGVybWluYXIgc2UgZGVzY2FyZ2EgYXV0b21hdGljYW1lbnRlIGVsIHhsc3guJztcclxuICBpZiAoIWNvbmZpcm0oY29uZmlybU1zZykpIHJldHVybjtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIHJlcG9ydGUgc2VydmVyLXNpZGUgKEJRKS4uLiBwdWVkZSB0YXJkYXIgfjYwcycpO1xyXG4gIHRyeSB7XHJcbiAgICAvLyB2MTAwMCBwYXR0ZXJuOiByZWZyZXNoIElEVG9rZW4gYW50ZXMgZGUgY2FsbGFibGUgY3JpdGljby5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHUgPSB3aW5kb3cuZmlyZWJhc2UuYXV0aCAmJiB3aW5kb3cuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xyXG4gICAgICBpZiAodSAmJiB1LmdldElkVG9rZW4pIGF3YWl0IHUuZ2V0SWRUb2tlbih0cnVlKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgY29uc3QgY2FsbGFibGUgPSB3aW5kb3cuZmlyZWJhc2VcclxuICAgICAgLmFwcCgpXHJcbiAgICAgIC5mdW5jdGlvbnMoJ3NvdXRoYW1lcmljYS1lYXN0MScpXHJcbiAgICAgIC5odHRwc0NhbGxhYmxlKCdnZW5lcmF0ZVZlbnRhc1JlcG9ydENGJyk7XHJcbiAgICBjb25zdCByZXNwID0gYXdhaXQgY2FsbGFibGUoeyB5ZWFyLCBtb250aCB9KTtcclxuICAgIGNvbnN0IHIgPSAocmVzcCAmJiByZXNwLmRhdGEpIHx8IHt9O1xyXG4gICAgaWYgKCFyLm9rIHx8ICFyLmJ5dGVzQmFzZTY0KSB7XHJcbiAgICAgIGFsZXJ0KCdDRiBkZXZvbHZpbyBlcnJvcjogJyArIChyLmVycm9yIHx8IEpTT04uc3RyaW5naWZ5KHIpKSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIERlY29kZSBiYXNlNjQgXHUyMTkyIEJsb2IgXHUyMTkyIGRvd25sb2FkIHRyaWdnZXIuXHJcbiAgICBjb25zdCBiaW4gPSBhdG9iKHIuYnl0ZXNCYXNlNjQpO1xyXG4gICAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW4ubGVuZ3RoKTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbi5jaGFyQ29kZUF0KGkpO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtieXRlc10sIHtcclxuICAgICAgdHlwZTogci5taW1lVHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPVxyXG4gICAgICByLmZpbGVuYW1lIHx8XHJcbiAgICAgICd2ZW50YXNfeF9hcnRpY3Vsb19jbGllbnRlXycgKyB5ZWFyICsgJy0nICsgU3RyaW5nKG1vbnRoKS5wYWRTdGFydCgyLCAnMCcpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gICAgICBhLnJlbW92ZSgpO1xyXG4gICAgfSwgMTAwMCk7XHJcbiAgICBjb25zdCBzdGF0cyA9IHIuc3RhdHMgfHwge307XHJcbiAgICBzaG93U3luY1RhZyhcclxuICAgICAgJ09LOiAnICtcclxuICAgICAgICAoc3RhdHMudmVudGFzIHx8IDApICtcclxuICAgICAgICAnIHZlbnRhcyAvICcgK1xyXG4gICAgICAgIChzdGF0cy5pdGVtcyB8fCAwKSArXHJcbiAgICAgICAgJyBTS1VzIC8gJyArXHJcbiAgICAgICAgKHN0YXRzLmNsaWVudHMgfHwgMCkgK1xyXG4gICAgICAgICcgY2xpZW50ZXMnXHJcbiAgICApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnRWZW50YXNBcnRDbGldIGVycm9yJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIHJlcG9ydGU6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkpKTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFBlZGlkb3MgZGVsIG1lcy4uLicpO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcclxuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykge1xyXG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xyXG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3QgZmVjaGEgPSBwLmNyZWF0ZWRBdFxyXG4gICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcclxuICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcclxuICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxyXG4gICAgICA6ICcnO1xyXG4gICAgLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc29sdmVyIGZhbnRhc2lhIHVuYSB2ZXogcG9yIHBlZGlkbyAobm8gcG9yIGxpbmVhKSBcdTIwMTRcclxuICAgIC8vIGVsIGxvb2t1cCBlbiBjbGllbnRNZXRhICsgYXBwcm92ZWRBbHRhc0xpc3QgZXMgY29uc3RhbnRlIHBhcmEgdG9kbyBlbCBwZWRpZG8uXHJcbiAgICBjb25zdCBub21icmVMb2NhbEZhbnRhc2lhID0gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKTtcclxuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xyXG4gICAgICBpZiAoIWwpIHJldHVybjtcclxuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGwucXR5KSB8fCAwO1xyXG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCk7XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYSxcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIE5vbWJyZV9Mb2NhbF9GYW50YXNpYTogbm9tYnJlTG9jYWxGYW50YXNpYSxcclxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXHJcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcclxuICAgICAgICBDYW50aWRhZF9PcGVuOiBOdW1iZXIobC5xdHlPcGVuKSB8fCAwLFxyXG4gICAgICAgIENhbnRpZGFkX0ludm9pY2VkOiBOdW1iZXIobC5xdHlJbnZvaWNlZCkgfHwgMCxcclxuICAgICAgICBDYW50aWRhZF9DYW5jZWxsZWQ6IE51bWJlcihsLnF0eUNhbmNlbGxlZCkgfHwgMCxcclxuICAgICAgICBFc3RhZG9fTGluZWE6IGwuc3RhdGUgfHwgJycsXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXHJcbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKHF0eSAqIHByZWNpbyksXHJcbiAgICAgICAgQ2VycmFkbzogcC5jbG9zZWRBdCA/ICdTSScgOiAnTk8nLFxyXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcclxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcclxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkZlY2hhX1BlZGlkbyB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhX1BlZGlkbyB8fCAnJykpO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVkaWRvc0RlbE1lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdQZWRpZG9zJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBQZWRpZG9zIGRlbCBtZXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59XHJcblxyXG4vLyBFeHBvcnRhciBwYXJhIEFuYWxpc2lzOiBwcm90ZWdpZG8gY29uIFBJTlxyXG5jb25zdCBBTkFMSVNJU19QSU4gPSAnMTIzNSc7XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeHBvcnQgRXhjZWwgVEFSR0VUUy1aT05BUyAtIHNvbG8gY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxyXG4vLyBjdWFscXVpZXIgYWx0YSBkZSBjbGllbnRfYXBwbGljYXRpb25zIGNvbiBzdGF0dXM9J2FwcHJvdmVkJyBZIGNhcmRDb2RlU2FwXHJcbi8vIGFzaWduYWRvLiBFeGNsdXllIFBPSU5UUyAvIGRpc3RyaWJ1aWRvcmVzIC8gcHJvc3BlY3RvcyAvIGFsdGFzIHNpblxyXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXHJcbi8vIENvbHVtbmFzOiBUSVBPLCBOUk8gQ1RFLCBSRUdJT04sIFBST1ZJTkNJQSwgQVNFU09SIEVYVEVSTk8sIEFTRVNPUiBJTlRFUk5PLFxyXG4vLyBDQUxMRSwgTlVNRVJPLCBMT0NBTElEQUQsIENQLCBOT01CUkUgQ09NRVJDSUFMLCBOT01CUkUgREUgRkFOVEFTSUEsIENVSVQsXHJcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXHJcbndpbmRvdy5leHBvcnRUYXJnZXRzWm9uYXMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBleHBvcnRhciBlbCBtYXN0ZXIuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgVEFSR0VUUy1aT05BUy4uLicpO1xyXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XHJcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxyXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gIH07XHJcbiAgZnVuY3Rpb24gcmVnaW9uT2YocHJvdikge1xyXG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgaWYgKFsnQlVFTk9TIEFJUkVTJywgJ0NBUElUQUwgRkVERVJBTCcsICdMQSBQQU1QQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0JVRU5PUyBBSVJFUyc7XHJcbiAgICBpZiAoWydDT1JET0JBJywgJ1NBTiBMVUlTJywgJ01FTkRPWkEnLCAnU0FOIEpVQU4nLCAnTEEgUklPSkEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdDVVlPJztcclxuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXHJcbiAgICAgIHJldHVybiAnTkVBJztcclxuICAgIGlmIChbJ0pVSlVZJywgJ1NBTFRBJywgJ1RVQ1VNQU4nLCAnQ0FUQU1BUkNBJywgJ1NBTlRJQUdPIERFTCBFU1RFUk8nXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdOT0EnO1xyXG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxyXG4gICAgICByZXR1cm4gJ1BBVEFHT05JQSc7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHZlbmRvckxhYmVsRm9yRXhjZWwoa2V5KSB7XHJcbiAgICBpZiAoIWtleSkgcmV0dXJuICcnO1xyXG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xyXG4gICAgcmV0dXJuIGtleTtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGxldCBhbHRhc1NuYXA7XHJcbiAgdHJ5IHtcclxuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKVxyXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9PScsICdhcHByb3ZlZCcpXHJcbiAgICAgIC5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhcyBhcHJvYmFkYXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgbGV0IHNraXBwZWROb1NhcCA9IDA7XHJcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcclxuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXHJcbiAgICBpZiAoIWNhcmRDb2RlKSB7XHJcbiAgICAgIHNraXBwZWROb1NhcCsrO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBwcm92aW5jZSA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9VcHBlckNhc2UoKS50cmltKCk7XHJcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcclxuICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcclxuICAgICAgJ05STyBDVEUnOiAwLCAvLyBzZSByZW51bWVyYSBkZXNwdWVzIGRlbCBzb3J0XHJcbiAgICAgIFJFR0lPTjogcmVnaW9uT2YocHJvdmluY2UpLFxyXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxyXG4gICAgICAnQVNFU09SIEVYVEVSTk8nOiB2ZW5kb3JMYWJlbEZvckV4Y2VsKHZlbmRvciksXHJcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcclxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXHJcbiAgICAgIE5VTUVSTzogYS5udW1lcm8gfHwgJycsXHJcbiAgICAgIExPQ0FMSURBRDogbG9jYWxpdHlGaW5hbCxcclxuICAgICAgQ1A6IGEuY3AgfHwgJycsXHJcbiAgICAgICdOT01CUkUgQ09NRVJDSUFMJzogYS5jb21lcmNpbyB8fCBhLnRpdHVsYXIgfHwgJycsXHJcbiAgICAgICdOT01CUkUgREUgRkFOVEFTSUEnOiBhLmZhbnRhc2lhIHx8ICcnLFxyXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXHJcbiAgICAgICdDT05ESUNJT04gRklTQ0FMJzogYS5jb25kaWNpb25GaXNjYWwgfHwgJycsXHJcbiAgICAgIFRFTEVGT05POiBhLnRlbGVmb25vIHx8ICcnLFxyXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVAgdG9kYXZpYS5cXG5cXG5VbmEgYWx0YSBlbnRyYSBhbCBleHBvcnQgc29sbyBjdWFuZG8gdGllbmUgQ2FyZENvZGUgU0FQIGFzaWduYWRvLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKHIxLlBST1ZJTkNJQSB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5QUk9WSU5DSUEgfHwgJycpO1xyXG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xyXG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcclxuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcclxuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcclxuICB9KTtcclxuICByb3dzLmZvckVhY2goKHIsIGkpID0+IHtcclxuICAgIHJbJ05STyBDVEUnXSA9IGkgKyAxO1xyXG4gIH0pO1xyXG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggKGVzdGlsbyB2ZXJkZSB1bmlmb3JtZSkuXHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIGF3YWl0IGRvd25sb2FkWGxzeCgnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcsIFtcclxuICAgIHsgbmFtZTogJ0NMSUVOVEVTX1pPTkFTJywgcm93cyB9LFxyXG4gIF0pO1xyXG4gIHNob3dTeW5jVGFnKFxyXG4gICAgJ0V4Y2VsIGV4cG9ydGFkbzogJyArXHJcbiAgICAgIHJvd3MubGVuZ3RoICtcclxuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcclxuICAgICAgKHNraXBwZWROb1NhcCA+IDAgPyAnICgnICsgc2tpcHBlZE5vU2FwICsgJyBzaW4gQ2FyZENvZGUgZGVzY2FydGFkb3MpJyA6ICcnKVxyXG4gICk7XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHBpbiA9IHByb21wdChcclxuICAgICdFc3RhIHNlY2Npb24gY29udGllbmUgZm9ybWF0b3MgYXZhbnphZG9zIChQb3dlciBCSSwgUHl0aG9uL01MLCBaSVAgZGUgZm90b3MpIGRlc3RpbmFkb3MgYSBhbmFsaXNpcyB0ZWNuaWNvLlxcblxcbkluZ3Jlc2EgZWwgUElOIHBhcmEgY29udGludWFyOidcclxuICApO1xyXG4gIGlmIChwaW4gPT09IG51bGwpIHJldHVybjtcclxuICBpZiAocGluICE9PSBBTkFMSVNJU19QSU4pIHtcclxuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxyXG4gIGNvbnN0IHNhcE9wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LXNhcC1pbnRlZ3JhdGlvbicpO1xyXG4gIGlmIChzYXBPcHQpIHtcclxuICAgIGNvbnN0IGlzTWFyaWFubyA9XHJcbiAgICAgIGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJztcclxuICAgIHNhcE9wdC5zdHlsZS5kaXNwbGF5ID0gaXNNYXJpYW5vID8gJycgOiAnbm9uZSc7XHJcbiAgfVxyXG4gIC8vIE9wY2lvbiBCYWNrdXAgbWVuc3VhbDogc29sbyBhZG1pblxyXG4gIGNvbnN0IGJrT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtYmFja3VwLW1lbnN1YWwnKTtcclxuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbn07XHJcblxyXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxyXG4vLyBIZWxwZXJzIGludGVybm9zIChkb3dubG9hZFhsc3gsIGV4cG9ydFZlbnRhc0Zvck1vbnRoLCBldGMuKSBzb24gY29uc3VtaWRvc1xyXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZ0JBLFNBQU8sdUJBQXVCLGlCQUFrQjtBQUM5QyxRQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sUUFBUTtBQUM3QixZQUFNLGdDQUFnQztBQUN0QztBQUFBLElBQ0Y7QUFDQSxnQkFBWSxxQ0FBcUM7QUFRakQsVUFBTSxXQUNKLE9BQU8sMEJBQTBCLGFBQzdCLHNCQUFzQixPQUFPLGtCQUFrQixjQUFjLGdCQUFnQixLQUFLLElBQ2xGO0FBQ04sVUFBTSxVQUFVLENBQUMsY0FBYztBQUM3QixVQUFJLGFBQWEsS0FBTSxRQUFPO0FBQzlCLFVBQUksQ0FBQyxVQUFXLFFBQU87QUFDdkIsYUFBTyxTQUFTLElBQUksU0FBUztBQUFBLElBQy9CO0FBTUEsVUFBTSxhQUFhO0FBQUEsTUFDakIseUJBQXlCO0FBQUEsTUFDekIsc0JBQXNCO0FBQUEsTUFDdEIsZ0JBQWdCO0FBQUEsTUFDaEIsT0FBTztBQUFBLElBQ1Q7QUFDQSxhQUFTLFdBQVcsV0FBVztBQUM3QixZQUFNLElBQUksT0FBTyxZQUFZLGNBQWMsUUFBUSxLQUFLLENBQUMsT0FBTyxHQUFHLFFBQVEsU0FBUyxJ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
