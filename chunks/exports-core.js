"use strict";
(() => {
  // src/domains/exports-core.js
  window.exportMasterClientes = function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.");
      return;
    }
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
              "Lng (geocode)": customLng || lon
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
              "Lng (geocode)": a.lng != null ? a.lng : ""
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
    const wb = XLSX.utils.book_new();
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
    const NUMERIC_ZERO_OK = /* @__PURE__ */ new Set(["Total visitas", "Total contactos"]);
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
    const ws = XLSX.utils.json_to_sheet(rowsFiltered, { header: keptKeys });
    ws["!cols"] = keptKeys.map((k) => ({ wch: COL_WIDTHS[k] || 15 }));
    XLSX.utils.book_append_sheet(wb, ws, "Clientes habilitados SAP");
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
    const wsRes = XLSX.utils.json_to_sheet(resumenRows);
    wsRes["!cols"] = [{ wch: 48 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsRes, "Resumen por zona");
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const scopeLbl = scopeSet === null ? "TODOS" : scopeSet.size === 1 ? [...scopeSet][0].split(" ")[0] : "mis-zonas-" + scopeSet.size;
    const fname = "Masterfile_Clientes_SAP_" + scopeLbl + "_" + ts + ".xlsx";
    XLSX.writeFile(wb, fname);
    showSyncTag(
      rows.length + " clientes exportados" + (scopeSet === null ? "" : " (scope: " + [...scopeSet].join(", ") + ")")
    );
  };
  window.exportPreciosStock = function() {
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
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 14 },
      { wch: 60 },
      { wch: 18 },
      { wch: 22 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 }
    ];
    for (let i = 2; i <= rows.length + 1; i++) {
      const cell = ws["F" + i];
      if (cell && typeof cell.v === "number") cell.z = '"$"#,##0';
    }
    XLSX.utils.book_append_sheet(wb, ws, "Precios y Stock");
    const preciosRows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      "Precio ARS": fmtPrecio(p.code)
    })).filter((r) => r["Precio ARS"] !== "").sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const wsP = XLSX.utils.json_to_sheet(preciosRows);
    wsP["!cols"] = [{ wch: 14 }, { wch: 60 }, { wch: 14 }];
    for (let i = 2; i <= preciosRows.length + 1; i++) {
      const cell = wsP["C" + i];
      if (cell && typeof cell.v === "number") cell.z = '"$"#,##0';
    }
    XLSX.utils.book_append_sheet(wb, wsP, "Precios");
    const stockRows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      "Stock W11": fmtStock(p.code)
    })).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const wsS = XLSX.utils.json_to_sheet(stockRows);
    wsS["!cols"] = [{ wch: 14 }, { wch: 60 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsS, "Stock");
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
    const wsI = XLSX.utils.json_to_sheet(infoRows);
    wsI["!cols"] = [{ wch: 36 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, wsI, "Info");
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    XLSX.writeFile(wb, "Precios_y_Stock_" + ts + ".xlsx");
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
  function downloadXlsx(filename, sheets) {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.json_to_sheet(
        s.rows.length ? s.rows : [{ Aviso: "Sin datos para el periodo seleccionado" }]
      );
      if (s.rows.length) {
        const cols = Object.keys(s.rows[0]).map((k) => ({
          wch: Math.min(40, Math.max(10, k.length + 4))
        }));
        ws["!cols"] = cols;
      }
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    XLSX.writeFile(wb, filename);
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
    const rows = [];
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    for (const p of pedidos) {
      if (p.closedAt) continue;
      const lines = Array.isArray(p.lines) ? p.lines : [];
      lines.forEach((l, idx) => {
        if (!l || l.state !== "BO") return;
        const qo = Number(l.qtyOpen) || 0;
        if (qo <= 0) return;
        rows.push({
          Fecha_Pedido: p.createdAt ? typeof p.createdAt === "string" ? p.createdAt.slice(0, 10) : new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toISOString().slice(0, 10) : "",
          Mes: p.month || "",
          Cliente: p.clientName || "",
          CardCode: p.clientCardCode || "",
          Provincia: p.province || "",
          Localidad: p.locName || "",
          Vendedor: p.ownerVendor || "",
          SKU: l.code || "",
          Producto: l.desc || l.name || "",
          Cantidad_Pedida: Number(l.qty) || 0,
          Cantidad_Pendiente_BO: qo,
          Precio_Unit_ARS: Number(l.priceAtCreation || l.precio || 0),
          Subtotal_BO_ARS: Math.round(qo * (Number(l.priceAtCreation || l.precio || 0) || 0)),
          Pedido_ID: p._fsId || "",
          Linea_Idx: idx,
          SQ_DocNum: p.transferidoSAP ? p.transferidoSAP.docNum || "" : ""
        });
      });
    }
    rows.sort((a, b) => (a.Cliente || "").localeCompare(b.Cliente || ""));
    const fname = "Shimano_Backorder_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Backorder", rows }]);
    showSyncTag("Export Backorder listo (" + rows.length + " lineas)", 2400);
  }
  async function exportStockAsigForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Stock Asignado...");
    const rows = [];
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    const getStk = typeof window !== "undefined" && typeof window.getStockDisponibleVenta === "function" ? window.getStockDisponibleVenta : null;
    for (const p of pedidos) {
      if (p.closedAt) continue;
      const lines = Array.isArray(p.lines) ? p.lines : [];
      lines.forEach((l, idx) => {
        if (!l) return;
        const qo = Number(l.qtyOpen) || 0;
        if (qo <= 0) return;
        let virtual = false;
        if (l.state === "ASIG") {
        } else if (l.state === "BO") {
          if (!getStk) return;
          const stk = getStk(l.code) || 0;
          if (stk <= 0) return;
          virtual = true;
        } else {
          return;
        }
        rows.push({
          Fecha_Pedido: p.createdAt ? typeof p.createdAt === "string" ? p.createdAt.slice(0, 10) : new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toISOString().slice(0, 10) : "",
          Mes: p.month || "",
          Cliente: p.clientName || "",
          CardCode: p.clientCardCode || "",
          Provincia: p.province || "",
          Localidad: p.locName || "",
          Vendedor: p.ownerVendor || "",
          SKU: l.code || "",
          Producto: l.desc || l.name || "",
          Cantidad_Reservada: qo,
          Estado_Real: virtual ? "BO_con_stock_(virtual_ASIG)" : "ASIG",
          Precio_Unit_ARS: Number(l.priceAtCreation || l.precio || 0),
          Subtotal_Reservado_ARS: Math.round(qo * (Number(l.priceAtCreation || l.precio || 0) || 0)),
          Pedido_ID: p._fsId || "",
          Linea_Idx: idx
        });
      });
    }
    rows.sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const fname = "Shimano_StockAsignado_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Stock Asignado", rows }]);
    showSyncTag("Export Stock Asignado listo (" + rows.length + " lineas)", 2400);
  }
  window.exportBackorderAll = async function() {
    showSyncTag("Generando export de Backorder (snapshot actual)...");
    const rows = [];
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    let totalPedidosOpen = 0;
    for (const p of arr) {
      if (!p || p.closedAt) continue;
      totalPedidosOpen++;
      const lines = Array.isArray(p.lines) ? p.lines : [];
      lines.forEach((l, idx) => {
        if (!l || l.state !== "BO") return;
        const qo = Number(l.qtyOpen) || 0;
        if (qo <= 0) return;
        rows.push({
          Fecha_Pedido: p.createdAt ? typeof p.createdAt === "string" ? p.createdAt.slice(0, 10) : new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toISOString().slice(0, 10) : "",
          Mes: p.month || "",
          Cliente: p.clientName || "",
          CardCode: p.clientCardCode || "",
          Provincia: p.province || "",
          Localidad: p.locName || "",
          Vendedor: p.ownerVendor || "",
          SKU: l.code || "",
          Producto: l.desc || l.name || "",
          Cantidad_Pedida: Number(l.qty) || 0,
          Cantidad_Pendiente_BO: qo,
          Precio_Unit_ARS: Number(l.priceAtCreation || l.precio || 0),
          Subtotal_BO_ARS: Math.round(qo * (Number(l.priceAtCreation || l.precio || 0) || 0)),
          Pedido_ID: p._fsId || "",
          Linea_Idx: idx,
          SQ_DocNum: p.transferidoSAP ? p.transferidoSAP.docNum || "" : "",
          Origen: p.migrationSource || "app"
        });
      });
    }
    if (rows.length === 0) {
      alert(
        "Export Backorder vacio. Diagnostico:\n- Total pedidos en globalPedidos: " + arr.length + "\n- Pedidos abiertos (sin closedAt): " + totalPedidosOpen + "\n- Lineas state=BO con qtyOpen>0: 0\n\nPosibles causas:\n1. No hay backorder abierto ahora mismo (todo confirmed o cerrado)\n2. Los pedidos tienen closedAt seteado por error\n3. Las lineas BO tienen qtyOpen=0 (ya despachadas via ASIG->closed)"
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
    const rows = [];
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    const getStk = typeof window !== "undefined" && typeof window.getStockDisponibleVenta === "function" ? window.getStockDisponibleVenta : null;
    let totalPedidosOpen = 0;
    let asigCount = 0;
    let boWithStockCount = 0;
    for (const p of arr) {
      if (!p || p.closedAt) continue;
      totalPedidosOpen++;
      const lines = Array.isArray(p.lines) ? p.lines : [];
      lines.forEach((l, idx) => {
        if (!l) return;
        const qo = Number(l.qtyOpen) || 0;
        if (qo <= 0) return;
        let virtual = false;
        if (l.state === "ASIG") {
          asigCount++;
        } else if (l.state === "BO") {
          if (!getStk) return;
          const stk = getStk(l.code) || 0;
          if (stk <= 0) return;
          virtual = true;
          boWithStockCount++;
        } else {
          return;
        }
        rows.push({
          Fecha_Pedido: p.createdAt ? typeof p.createdAt === "string" ? p.createdAt.slice(0, 10) : new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toISOString().slice(0, 10) : "",
          Mes: p.month || "",
          Cliente: p.clientName || "",
          CardCode: p.clientCardCode || "",
          Provincia: p.province || "",
          Localidad: p.locName || "",
          Vendedor: p.ownerVendor || "",
          SKU: l.code || "",
          Producto: l.desc || l.name || "",
          Cantidad_Reservada: qo,
          Estado_Real: virtual ? "BO_con_stock_(virtual_ASIG)" : "ASIG",
          Precio_Unit_ARS: Number(l.priceAtCreation || l.precio || 0),
          Subtotal_Reservado_ARS: Math.round(qo * (Number(l.priceAtCreation || l.precio || 0) || 0)),
          Pedido_ID: p._fsId || "",
          Linea_Idx: idx,
          SQ_DocNum: p.transferidoSAP ? p.transferidoSAP.docNum || "" : "",
          Origen: p.migrationSource || "app"
        });
      });
    }
    if (rows.length === 0) {
      alert(
        "Export Stock Asignado vacio. Diagnostico:\n- Total pedidos en globalPedidos: " + arr.length + "\n- Pedidos abiertos (sin closedAt): " + totalPedidosOpen + "\n- Lineas state=ASIG con qtyOpen>0: " + asigCount + "\n- Lineas state=BO con stock disponible (virtual ASIG): " + boWithStockCount + "\n\nPosibles causas:\n1. No hay stock asignado ahora mismo\n2. Todo el stock esta pendiente sin asignar (mode BO puro sin stock)\n3. Los pedidos tienen closedAt seteado"
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
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 14 },
      { wch: 10 },
      { wch: 16 },
      { wch: 22 },
      { wch: 28 },
      { wch: 28 },
      { wch: 28 },
      { wch: 10 },
      { wch: 22 },
      { wch: 10 },
      { wch: 38 },
      { wch: 32 },
      { wch: 14 },
      { wch: 24 },
      { wch: 18 },
      { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "CLIENTES_ZONAS");
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    XLSX.writeFile(wb, "TARGETS_VENDEDORES_ZONAS_" + ts + ".xlsx");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xyXG4vLyBFWFBPUlRTLUNPUkU6IG1hc3RlcmZpbGUgY2xpZW50ZXMgKyBwcmVjaW9zL3N0b2NrICsgbW9kYWwgZGUgZXhwb3J0YXIgK1xyXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxyXG4vLyBGcmFnbWVudG9zIHJlc3RhbnRlcyBkZWwgZG9taW5pbyBleHBvcnRzOiBhZHZhbmNlZCAofjEwMzAyLTExNDUxKSB5IFNBUFxyXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgTUFTVEVSRklMRSBERSBDTElFTlRFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxyXG4vLyBub21icmUsIHRpcG8gKGNsaWVudGUvcHJvc3BlY3RvKSwgem9uYSBkZWwgdmVuZGVkb3IsIGFzZXNvciBleHRlcm5vLCBhc2Vzb3JcclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxyXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxyXG4vLyBjb29yZGVuYWRhcyBnZW9jb2RpZmljYWRhcywgZXN0YWRvIChIYWJpbGl0YWRvL1BlbmRpZW50ZS9DYW5jZWxhZG8pLFxyXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cclxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xyXG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcclxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXHJcbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxyXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcclxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xyXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxyXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cclxuICBjb25zdCBzY29wZVNldCA9XHJcbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcclxuICAgICAgOiBudWxsO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XHJcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcclxuICB9O1xyXG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcclxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cclxuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXHJcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXHJcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICB9O1xyXG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XHJcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcclxuICAgIHJldHVybiB2ID8gdi56b25lIDogJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xyXG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XHJcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XHJcbiAgfVxyXG5cclxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcclxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXHJcbiAgLy8gZXNwZWNpYWxpemFjaW9uL2NhbmFsQ29tcHJhL3BvcC90aXBvVmVudGEvZXRjLikgZGVsIGZvcm11bGFyaW8gZGVcclxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXHJcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cclxuICAvLyB2ZSBsYSBjbGFzaWZpY2FjaW9uIG1hcyBhY3R1YWxpemFkYSwgcGVybyBzaSBlbCB1bHRpbW8gY29udGFjdG8gbm8gbGxlbmFcclxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcclxuICAvLyBpbnRlcmFjY2lvbiBwZXJvIG5vIHBlcmRlciBpbmZvIHV0aWwgZGUgbGFzIGFudGVyaW9yZXNcIi5cclxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcclxuICAgICd0aXBvJyxcclxuICAgICdsb2NhbCcsXHJcbiAgICAndGFtYW5vJyxcclxuICAgICdmaWRlbGlkYWQnLFxyXG4gICAgJ2VzcGVjaWFsaXphY2lvbicsXHJcbiAgICAnY2FuYWxDb21wcmEnLFxyXG4gICAgJ3JlbGV2YW5jaWEnLFxyXG4gICAgJ3BvcCcsXHJcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXHJcbiAgICAndGlwb1ZlbnRhJyxcclxuICAgICdwb25kZXJhY2lvbk1vc3RyYWRvJyxcclxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXHJcbiAgICAnY29tcGV0ZW5jaWEnLFxyXG4gICAgJ29wb3J0dW5pZGFkJyxcclxuICAgICdtYXNWZW5kaWRvJyxcclxuICAgICdtYXNQcmVndW50YW4nLFxyXG4gICAgJ2F5dWRhVGllbmRhJyxcclxuICBdO1xyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXHJcbiAgICAgICd8JyArXHJcbiAgICAgIChsb2MgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpICtcclxuICAgICAgJ3wnICtcclxuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcclxuICAgICk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xyXG4gICAgaWYgKHYgJiYgdi5jcmVhdGVkQXQgJiYgdi5jcmVhdGVkQXQudG9NaWxsaXMpIHJldHVybiB2LmNyZWF0ZWRBdC50b01pbGxpcygpO1xyXG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xyXG4gICAgcmV0dXJuIDA7XHJcbiAgfVxyXG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XHJcbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcclxuICAgIGNvbnN0IGJ5S2V5ID0gbmV3IE1hcCgpO1xyXG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgICBpZiAoIXYpIHJldHVybjtcclxuICAgICAgY29uc3QgayA9IF9jbGFzc2lmS2V5KHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcclxuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XHJcbiAgICB9KTtcclxuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xyXG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxyXG4gICAgICBjb25zdCBtZXJnZWQgPSB7fTtcclxuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcclxuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgICBpZiAobWVyZ2VkW2ZdICE9IG51bGwgJiYgbWVyZ2VkW2ZdICE9PSAnJyAmJiBtZXJnZWRbZl0gIT09IDApIHJldHVybjtcclxuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XHJcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xyXG4gICAgICBjbGFzc2lmSW5kZXguc2V0KGssIHtcclxuICAgICAgICBtZXJnZWQsXHJcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXHJcbiAgICAgICAgbGFzdFR5cGU6IGxhdGVzdC5pbnRlcmFjdGlvblR5cGUgfHwgKGxhdGVzdC5lc3BhY2lvID8gJ3Zpc2l0YScgOiAnJyksXHJcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcclxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmUm93KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcclxuICAgIGlmICghZW50cnkpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RvdGFsIHZpc2l0YXMnOiAwLFxyXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxyXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXHJcbiAgICAgICAgTG9jYWw6ICcnLFxyXG4gICAgICAgIFRhbWFubzogJycsXHJcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcclxuICAgICAgICBFc3BlY2lhbGl6YWNpb246ICcnLFxyXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcclxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcclxuICAgICAgICBQT1A6ICcnLFxyXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxyXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXHJcbiAgICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAnJyxcclxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcclxuICAgICAgICBDb21wZXRlbmNpYTogJycsXHJcbiAgICAgICAgT3BvcnR1bmlkYWQ6ICcnLFxyXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxyXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXHJcbiAgICAgICAgJ0F5dWRhIHRpZW5kYSc6ICcnLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgY29uc3QgbSA9IGVudHJ5Lm1lcmdlZCB8fCB7fTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXHJcbiAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RUeXBlLFxyXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXHJcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXHJcbiAgICAgICdUaXBvIGNvbWVyY2lvJzogbS50aXBvIHx8ICcnLFxyXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcclxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcclxuICAgICAgRmlkZWxpZGFkOiBtLmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcclxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXHJcbiAgICAgIFJlbGV2YW5jaWE6IG0ucmVsZXZhbmNpYSAhPSBudWxsID8gbS5yZWxldmFuY2lhIDogJycsXHJcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXHJcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcclxuICAgICAgJ1RpcG8gZGUgdmVudGEnOiBtLnRpcG9WZW50YSB8fCAnJyxcclxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxyXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXHJcbiAgICAgIENvbXBldGVuY2lhOiBtLmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgICAnTWFzIHByZWd1bnRhbic6IG0ubWFzUHJlZ3VudGFuIHx8ICcnLFxyXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXHJcbiAgLy8gdGllbmVuIGNhcmRDb2RlICsgZGlyZWNjaW9uLiBFc29zIHNvbiBsb3MgcXVlIGFwYXJlY2VuIGNvbW8gdmVyZGVzIGVuXHJcbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcclxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXHJcbiAgLy8gcmVhbCBvcGVyYWJsZSBob3kuXHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCBwcm92aW5jZSA9IHAucHJvdmluY2UgfHwgJyc7XHJcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcclxuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBwLnZlbmRvciB8fCAnJztcclxuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cclxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XHJcbiAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xyXG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XHJcbiAgICBjb25zdCBsb24gPSBwLmxvbiAhPSBudWxsID8gcC5sb24gOiAnJztcclxuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cclxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxyXG4gICAgKHAuY2xpZW50cyB8fCBbXSkuZm9yRWFjaCgobmFtZSkgPT4ge1xyXG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcclxuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XHJcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXHJcbiAgICAgIGxldCBlc3RhZG8gPSAnSGFiaWxpdGFkbyc7IC8vIHBvciBkZWZpbmljaW9uIHlhIGVzdGEgU0FQLWNvbmZpcm1hZG9cclxuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcclxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcclxuICAgICAgLy8gTWV0YWRhdGEgY3VzdG9tIChkaXJlY2Npb24sIGxvY2FsaWRhZCBkZWNsYXJhZGEsIGdlb2NvZGUpLlxyXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XHJcbiAgICAgIC8vIEJ1c2NhciBhZGRyZXNzOiAxKSBjbGllbnRfbWFzdGVyLmFkZHJlc3MgKGFkbWluKSwgMikgY2xpZW50TWV0YS5hZGRyZXNzICh2ZW5kb3IpLlxyXG4gICAgICBjb25zdCBkb2NJZCA9XHJcbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xyXG4gICAgICBjb25zdCBjbURhdGEgPVxyXG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGxvY2FsaXR5Q3VzdCA9IGNtRGF0YS5sb2NhbGlkYWQgfHwgbWV0YS5sb2NhbGl0eSB8fCAnJztcclxuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XHJcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xyXG4gICAgICAvLyBDYXJkQ29kZSBTQVAgKGRlIGNsaWVudF9tYXN0ZXIgbyBkZSBsYSBhbHRhIHZpbmN1bGFkYSkuXHJcbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcclxuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xyXG4gICAgICAgIGNvbnN0IGtleSA9IHByb3ZpbmNlLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBsb2NhbGl0eU1hcDtcclxuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcclxuICAgICAgICBpZiAoYWx0YU1hdGNoKSBjYXJkQ29kZSA9IGFsdGFNYXRjaC5jYXJkQ29kZVNhcCB8fCAnJztcclxuICAgICAgfVxyXG4gICAgICByb3dzLnB1c2goXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGNhcmRDb2RlLFxyXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXHJcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcclxuICAgICAgICAgICAgVGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXHJcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2NhbGl0eU1hcCxcclxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxyXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcclxuICAgICAgICAgICAgWm9uYTogem9uZSxcclxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxyXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXHJcbiAgICAgICAgICAgIERpcmVjY2lvbjogYWRkcmVzcyxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXHJcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcclxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBjdXN0b21MbmcgfHwgbG9uLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSlcclxuICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuICAvLyBJbnllY3RhciBhbHRhcyBkZSBjbGllbnRfYXBwbGljYXRpb25zIChhcHByb3ZlZEFsdGFzTGlzdCk6XHJcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cclxuICAvLyAgICogUFJPVklTT1JJT1MgKHYzMTErKTogbWFudWFsU2FwUGVuZGluZyAmJiAhY2FyZENvZGVTYXAgKEFsdGEgUmFwaWRhXHJcbiAgLy8gICAgIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuIFZhbiBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy4gU2VcclxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXHJcbiAgLy8gICAgIHF1ZSBlbCBnZXJlbnRlIGVzdGEgZ2VzdGlvbmFuZG8sIG5vIHNvbG8gbG9zIGNlcnJhZG9zIGVuIFNBUC5cclxuICAvLyAgICAgTG9zIHByb3Zpc29yaW9zIHB1ZWRlbiBubyB0ZW5lciBkaXJlY2Npb24gdG9kYXZpYSAtPiBzZSBhY2VwdGFuIGlndWFsLlxyXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XHJcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XHJcbiAgICBzZWVuLmFkZChcclxuICAgICAgKHIuUHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpXHJcbiAgICApO1xyXG4gIH0pO1xyXG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xyXG4gICAgYXBwcm92ZWRBbHRhc0xpc3QuZm9yRWFjaCgoYSkgPT4ge1xyXG4gICAgICBpZiAoIWEpIHJldHVybjtcclxuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XHJcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXHJcbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXHJcbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XHJcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XHJcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcclxuICAgICAgY29uc3Qgbm9tYnJlID1cclxuICAgICAgICBhLmNvbWVyY2lvIHx8XHJcbiAgICAgICAgYS5mYW50YXNpYSB8fFxyXG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xyXG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcclxuICAgICAgaWYgKHNlZW4uaGFzKGR1cEtleSkpIHJldHVybjtcclxuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcclxuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcclxuICAgICAgLy8gdjMzMTogbWlzbW8gZmlsdHJvIGRlIHNjb3BlIGFwbGljYSBhIGFsdGFzIFNBUC9wcm92aXNvcmlhcy5cclxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcclxuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcclxuICAgICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xyXG4gICAgICByb3dzLnB1c2goXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGEuY2FyZENvZGVTYXAgfHwgJycsXHJcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxyXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxyXG4gICAgICAgICAgICBUaXBvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbyAoQWx0YSByYXBpZGEpJyA6ICdDbGllbnRlIGFjdHVhbCcsXHJcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxyXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxyXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvYyxcclxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcclxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXHJcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXHJcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcclxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxyXG4gICAgICAgICAgICBEaXJlY2Npb246IGEuY2FsbGUgfHwgYS5hZGRyZXNzIHx8ICcnLFxyXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcclxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcclxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBhLmxuZyAhPSBudWxsID8gYS5sbmcgOiAnJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSlcclxuICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcclxuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcclxuICAgIGNvbnN0IGwgPSAoYVsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJyk7XHJcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XHJcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xyXG4gIH0pO1xyXG5cclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xyXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXHJcbiAgICAgICAgJyAgKiBIYWJpbGl0YWRvcyBlbiBTQVAgKGNhcmRDb2RlICsgZGlyZWNjaW9uIGNhcmdhZG9zKS5cXG4nICtcclxuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xyXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIC8vIHYxMDQzICgyMDI2LTA5LTIzKTogcG9zdC1wcm9jZXNvIFx1MjAxNCBzYWNhciBjb2x1bW5hcyAxMDAlIHZhY1x1MDBFRGFzLlxyXG4gIC8vIFJlcG9ydGUgTWFyaWFubzogbWFzdGVyZmlsZSBleHBvcnRhYmEgMzcgY29sdW1uYXMgZG9uZGUgbXVjaGFzIHZlblx1MDBFRGFuXHJcbiAgLy8gdmFjXHUwMEVEYXMgcG9ycXVlIG5vIGhhYlx1MDBFRGEgdmlzaXRhcy9jb250YWN0b3MgY2FyZ2Fkb3MgcGFyYSBlc29zIGNsaWVudGVzLlxyXG4gIC8vIEZpeDogaWRlbnRpZmljYXIga2V5cyBkb25kZSBUT0RBUyBsYXMgZmlsYXMgdGllbmVuIHZhbG9yIFwidmFjXHUwMEVEb1wiIChlbXB0eVxyXG4gIC8vIHN0cmluZywgbnVsbCwgdW5kZWZpbmVkKSB5IHJlbW92ZXJsYXMgYW50ZXMgZGVsIHNoZWV0LiBMb3MgY29udGVvc1xyXG4gIC8vIChUb3RhbCB2aXNpdGFzL2NvbnRhY3Rvcykgc2UgY29uc2lkZXJhbiB2YWNcdTAwRURvcyBzaSB0b2RvcyBzb24gMC5cclxuICAvLyBXaWR0aHMgcG9yIGNvbHVtbi1uYW1lIChlbiB2ZXogZGUgcG9zaWNpb25hbCkgcGFyYSBxdWUgZWwgZmlsdGVyIG5vXHJcbiAgLy8gZGVzYWxpbmVlIGVsIHNoZWV0IGN1YW5kbyByZW1vdmVtb3MgY29sdW1uYXMuXHJcbiAgY29uc3QgQ09MX1dJRFRIUyA9IHtcclxuICAgICdDYXJkQ29kZSBTQVAnOiAxNixcclxuICAgICdOb21icmUgdGllbmRhJzogMzgsXHJcbiAgICAnQWxpYXMgKG1vZGFsKSc6IDI4LFxyXG4gICAgVGlwbzogMTQsXHJcbiAgICBFc3RhZG86IDE0LFxyXG4gICAgUHJvdmluY2lhOiAyMixcclxuICAgICdMb2NhbGlkYWQgKG1hcGEpJzogMjIsXHJcbiAgICBEZXBhcnRhbWVudG86IDIyLFxyXG4gICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiAyOCxcclxuICAgIFpvbmE6IDgsXHJcbiAgICAnRXRpcXVldGEgem9uYSc6IDQ4LFxyXG4gICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogMjgsXHJcbiAgICBEaXJlY2Npb246IDM4LFxyXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiAyNCxcclxuICAgICdMYXQgKGdlb2NvZGUpJzogMTQsXHJcbiAgICAnTG5nIChnZW9jb2RlKSc6IDE0LFxyXG4gICAgJ1VsdGltYSBpbnRlcmFjY2lvbic6IDE0LFxyXG4gICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogMTQsXHJcbiAgICAnVG90YWwgdmlzaXRhcyc6IDEwLFxyXG4gICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IDEwLFxyXG4gICAgJ1RpcG8gY29tZXJjaW8nOiAxOCxcclxuICAgIExvY2FsOiAxNixcclxuICAgIFRhbWFubzogMTIsXHJcbiAgICBGaWRlbGlkYWQ6IDE0LFxyXG4gICAgRXNwZWNpYWxpemFjaW9uOiAyMCxcclxuICAgICdDYW5hbCBkZSBjb21wcmEnOiAyMCxcclxuICAgIFJlbGV2YW5jaWE6IDEwLFxyXG4gICAgUE9QOiA4LFxyXG4gICAgJ05lY2VzaWRhZCBwdW50dWFsJzogMjYsXHJcbiAgICAnVGlwbyBkZSB2ZW50YSc6IDE2LFxyXG4gICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAxOCxcclxuICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6IDE4LFxyXG4gICAgQ29tcGV0ZW5jaWE6IDI2LFxyXG4gICAgT3BvcnR1bmlkYWQ6IDI2LFxyXG4gICAgJ01hcyB2ZW5kaWRvJzogMjIsXHJcbiAgICAnTWFzIHByZWd1bnRhbic6IDIyLFxyXG4gICAgJ0F5dWRhIHRpZW5kYSc6IDI2LFxyXG4gIH07XHJcbiAgLy8gRGV0ZWN0YXIga2V5cyAxMDAlIHZhY1x1MDBFRGFzLlxyXG4gIGNvbnN0IGFsbEtleXMgPSBPYmplY3Qua2V5cyhDT0xfV0lEVEhTKTtcclxuICBjb25zdCBOVU1FUklDX1pFUk9fT0sgPSBuZXcgU2V0KFsnVG90YWwgdmlzaXRhcycsICdUb3RhbCBjb250YWN0b3MnXSk7XHJcbiAgY29uc3QgZW1wdHlLZXlzID0gbmV3IFNldChcclxuICAgIGFsbEtleXMuZmlsdGVyKChrKSA9PiB7XHJcbiAgICAgIC8vIFNraXAgY29sdW1uYXMgY29yZSBxdWUgU0lFTVBSRSBzZSBtdWVzdHJhbiBhdW5xdWUgZXN0XHUwMEU5biB2YWNcdTAwRURhcy5cclxuICAgICAgLy8gKENhcmRDb2RlL05vbWJyZSBzb24gb3BjaW9uYWxlcyB0XHUwMEU5Y25pY2FtZW50ZSBwZXJvIGNsaWVudGUgc2luIG5vbWJyZVxyXG4gICAgICAvLyB5YSBubyBsbGVnYSBoYXN0YSBhY1x1MDBFMS4pXHJcbiAgICAgIHJldHVybiByb3dzLmV2ZXJ5KChyKSA9PiB7XHJcbiAgICAgICAgY29uc3QgdiA9IHJba107XHJcbiAgICAgICAgaWYgKHYgPT09ICcnIHx8IHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICBpZiAoTlVNRVJJQ19aRVJPX09LLmhhcyhrKSAmJiB2ID09PSAwKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgIH0pO1xyXG4gICAgfSlcclxuICApO1xyXG4gIGNvbnN0IGtlcHRLZXlzID0gYWxsS2V5cy5maWx0ZXIoKGspID0+ICFlbXB0eUtleXMuaGFzKGspKTtcclxuICBjb25zdCByb3dzRmlsdGVyZWQgPSByb3dzLm1hcCgocikgPT4ge1xyXG4gICAgY29uc3Qgb3V0ID0ge307XHJcbiAgICBrZXB0S2V5cy5mb3JFYWNoKChrKSA9PiB7XHJcbiAgICAgIG91dFtrXSA9IHJba107XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBvdXQ7XHJcbiAgfSk7XHJcbiAgY29uc3QgcmVtb3ZlZENvdW50ID0gZW1wdHlLZXlzLnNpemU7XHJcbiAgaWYgKHJlbW92ZWRDb3VudCA+IDApIHtcclxuICAgIGNvbnNvbGUubG9nKGBbbWFzdGVyZmlsZV0gcmVtb3ZpZGFzICR7cmVtb3ZlZENvdW50fSBjb2xzIHZhY1x1MDBFRGFzOmAsIFsuLi5lbXB0eUtleXNdLmpvaW4oJywgJykpO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzRmlsdGVyZWQsIHsgaGVhZGVyOiBrZXB0S2V5cyB9KTtcclxuICB3c1snIWNvbHMnXSA9IGtlcHRLZXlzLm1hcCgoaykgPT4gKHsgd2NoOiBDT0xfV0lEVEhTW2tdIHx8IDE1IH0pKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0NsaWVudGVzIGhhYmlsaXRhZG9zIFNBUCcpO1xyXG5cclxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHpvbmFcclxuICBjb25zdCBieVpvbmUgPSB7fTtcclxuICByb3dzLmZvckVhY2goKHIpID0+IHtcclxuICAgIGNvbnN0IHogPSByWydFdGlxdWV0YSB6b25hJ10gfHwgJ1NpbiB6b25hJztcclxuICAgIGlmICghYnlab25lW3pdKSBieVpvbmVbel0gPSB7IHRvdGFsOiAwLCBoYWJpbGl0YWRvczogMCwgY2FuY2VsYWRvczogMCB9O1xyXG4gICAgYnlab25lW3pdLnRvdGFsKys7XHJcbiAgICBpZiAoci5Fc3RhZG8gPT09ICdIYWJpbGl0YWRvJykgYnlab25lW3pdLmhhYmlsaXRhZG9zKys7XHJcbiAgICBlbHNlIGlmIChyLkVzdGFkbyA9PT0gJ0NhbmNlbGFkbycpIGJ5Wm9uZVt6XS5jYW5jZWxhZG9zKys7XHJcbiAgfSk7XHJcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBPYmplY3QuZW50cmllcyhieVpvbmUpXHJcbiAgICAubWFwKChbeiwgZF0pID0+ICh7XHJcbiAgICAgICdab25hIC8gVmVuZGVkb3InOiB6LFxyXG4gICAgICAnVG90YWwgdGllbmRhcyc6IGQudG90YWwsXHJcbiAgICAgIEhhYmlsaXRhZGFzOiBkLmhhYmlsaXRhZG9zLFxyXG4gICAgICBDYW5jZWxhZGFzOiBkLmNhbmNlbGFkb3MsXHJcbiAgICB9KSlcclxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydUb3RhbCB0aWVuZGFzJ10gLSBhWydUb3RhbCB0aWVuZGFzJ10pO1xyXG4gIGNvbnN0IHdzUmVzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW5Sb3dzKTtcclxuICB3c1Jlc1snIWNvbHMnXSA9IFt7IHdjaDogNDggfSwgeyB3Y2g6IDE0IH0sIHsgd2NoOiAxNCB9LCB7IHdjaDogMTQgfV07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NSZXMsICdSZXN1bWVuIHBvciB6b25hJyk7XHJcblxyXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICAvLyB2MzMxOiBzdWZpam8gY29uIGVsIHNjb3BlIGFwbGljYWRvIHBhcmEgZGlmZXJlbmNpYXIgZWwgYXJjaGl2byBkZWwgVkRFL1ZESVxyXG4gIC8vIGRlbCBleHBvcnQgZ2xvYmFsIGRlbCBhZG1pbi5cclxuICBjb25zdCBzY29wZUxibCA9XHJcbiAgICBzY29wZVNldCA9PT0gbnVsbFxyXG4gICAgICA/ICdUT0RPUydcclxuICAgICAgOiBzY29wZVNldC5zaXplID09PSAxXHJcbiAgICAgICAgPyBbLi4uc2NvcGVTZXRdWzBdLnNwbGl0KCcgJylbMF1cclxuICAgICAgICA6ICdtaXMtem9uYXMtJyArIHNjb3BlU2V0LnNpemU7XHJcbiAgY29uc3QgZm5hbWUgPSAnTWFzdGVyZmlsZV9DbGllbnRlc19TQVBfJyArIHNjb3BlTGJsICsgJ18nICsgdHMgKyAnLnhsc3gnO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCBmbmFtZSk7XHJcbiAgc2hvd1N5bmNUYWcoXHJcbiAgICByb3dzLmxlbmd0aCArXHJcbiAgICAgICcgY2xpZW50ZXMgZXhwb3J0YWRvcycgK1xyXG4gICAgICAoc2NvcGVTZXQgPT09IG51bGwgPyAnJyA6ICcgKHNjb3BlOiAnICsgWy4uLnNjb3BlU2V0XS5qb2luKCcsICcpICsgJyknKVxyXG4gICk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhwb3J0OiBQcmVjaW9zICsgU3RvY2sgcG9yIFNLVVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RPIGVsIGNhdGFsb2dvIGNydXphbmRvIGxvcyAzIG1hcGFzIHZpZ2VudGVzXHJcbi8vIGVuIG1lbW9yaWE6IFBST0RVQ1RTIChtYXN0ZXIgZGUgU0tVcyksIFBSSUNFX0xJU1RfTUFQIChwcmVjaW8gQVJTIGRlXHJcbi8vIEZpcmVzdG9yZSkgeSBTVE9DS19NQVAgKGJvb2xlYW5vIHBvciBTS1UgZGVsIHN0b2NrLmpzb24gZGVsIHJlcG8pLlxyXG4vLyBIb2phczpcclxuLy8gIC0gXCJQcmVjaW9zIHkgU3RvY2tcIjogdW5hIGZpbGEgcG9yIFNLVSBjb24gdG9kYXMgbGFzIGNvbHVtbmFzIGp1bnRhc1xyXG4vLyAgICAobG8gbWFzIGNvbXVuIHBhcmEgcmV2aXNhciBkaXNwb25pYmlsaWRhZCArIHByZWNpbykuXHJcbi8vICAtIFwiUHJlY2lvc1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgcHJlY2lvIChzaW4gc3RvY2spLlxyXG4vLyAgLSBcIlN0b2NrXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBlc3RhZG8gZGUgc3RvY2suXHJcbi8vICAtIFwiSW5mb1wiOiBmZWNoYSBkZSBsb3Mgc25hcHNob3RzIHkgZnVlbnRlcy5cclxud2luZG93LmV4cG9ydFByZWNpb3NTdG9jayA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIUFycmF5LmlzQXJyYXkoUFJPRFVDVFMpIHx8ICFQUk9EVUNUUy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgY2F0YWxvZ28gZGUgcHJvZHVjdG9zIGNhcmdhZG8gdG9kYXZpYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBwcmVjaW9zICsgc3RvY2suLi4nKTtcclxuICAvLyB2NTc0ICgyMDI2LTA4LTIxKTogcGVkaWRvIGRlIE1hcmlhbm8gXHUyMDE0IG1vc3RyYXIgVU5JREFERVMgbnVtZXJpY2FzXHJcbiAgLy8gZXhhY3RhcyBkZWwgZGVwb3NpdG8gMTEgKHZlbnRhKSBlbiB2ZXogZGUgXCJEaXNwb25pYmxlXCIvXCJTaW4gc3RvY2tcIi5cclxuICAvLyBVc2EgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgcXVlIGxlZSBTVE9DS19XQVJFSE9VU0VfQlJFQUtET1dOW3NrdV1bJzExJ10uXHJcbiAgLy8gUmV0b3JuYSAnJyAoY2VsZGEgdmFjaWEpIGN1YW5kbyBubyBoYXkgZGF0byBkZSBzdG9jayAoc25hcHNob3Qgbm8gY2FyZ2Fkb1xyXG4gIC8vIGF1bik7IDAgc2kgZWwgU0tVIG5vIHRpZW5lIHN0b2NrLiBMb3MgbnVtZXJvcyBwZXJtaXRlbiBzb3J0L2ZpbHRlci9zdW0gZW5cclxuICAvLyBFeGNlbCBcdTIwMTQgbm8gcGVyZGVtb3MgZWwgZXN0YWRvIFwibm8gZGF0b1wiIHZzIFwiMCB1bmlkYWRlc1wiIGdyYWNpYXMgYWwgJycuXHJcbiAgZnVuY3Rpb24gZm10U3RvY2soc2t1KSB7XHJcbiAgICBjb25zdCBmbiA9XHJcbiAgICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcclxuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxyXG4gICAgICAgIDogbnVsbDtcclxuICAgIGNvbnN0IHYgPSBmbiA/IGZuKHNrdSkgOiBudWxsO1xyXG4gICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuICcnO1xyXG4gICAgcmV0dXJuIE51bWJlcih2KSB8fCAwO1xyXG4gIH1cclxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XHJcbiAgICBjb25zdCBwID0gdHlwZW9mIFBSSUNFX0xJU1RfTUFQID09PSAnb2JqZWN0JyAmJiBQUklDRV9MSVNUX01BUCA/IFBSSUNFX0xJU1RfTUFQW3NrdV0gOiBudWxsO1xyXG4gICAgaWYgKHAgPT0gbnVsbCkgcmV0dXJuICcnO1xyXG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xyXG4gIH1cclxuICAvLyBIb2phIDE6IGNvbWJvIGNvbXBsZXRvIChlcyBsYSBtYXMgcGVkaWRhKS5cclxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXHJcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxyXG4gICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXHJcbiAgICBTdWJmYW1pbGlhOiBwLnN1YiB8fCAnJyxcclxuICAgIENhdGVnb3JpYTogcC5jYXQgfHwgJycsXHJcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxyXG4gICAgJ1N0b2NrIFcxMSc6IGZtdFN0b2NrKHAuY29kZSksXHJcbiAgfSkpLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogNjAgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgXTtcclxuICAvLyBBcGxpY2FyIGZvcm1hdG8gbW9uZWRhIGEgbGEgY29sdW1uYSBQcmVjaW8gQVJTIChjb2x1bW5hIEYgPSA2KS5cclxuICBmb3IgKGxldCBpID0gMjsgaSA8PSByb3dzLmxlbmd0aCArIDE7IGkrKykge1xyXG4gICAgY29uc3QgY2VsbCA9IHdzWydGJyArIGldO1xyXG4gICAgaWYgKGNlbGwgJiYgdHlwZW9mIGNlbGwudiA9PT0gJ251bWJlcicpIGNlbGwueiA9ICdcIiRcIiMsIyMwJztcclxuICB9XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdQcmVjaW9zIHkgU3RvY2snKTtcclxuXHJcbiAgLy8gSG9qYSAyOiBzb2xvIFByZWNpb3NcclxuICBjb25zdCBwcmVjaW9zUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcclxuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxyXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcclxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXHJcbiAgfSkpXHJcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdzUCA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChwcmVjaW9zUm93cyk7XHJcbiAgd3NQWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xyXG4gIGZvciAobGV0IGkgPSAyOyBpIDw9IHByZWNpb3NSb3dzLmxlbmd0aCArIDE7IGkrKykge1xyXG4gICAgY29uc3QgY2VsbCA9IHdzUFsnQycgKyBpXTtcclxuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XHJcbiAgfVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUCwgJ1ByZWNpb3MnKTtcclxuXHJcbiAgLy8gSG9qYSAzOiBzb2xvIFN0b2NrXHJcbiAgY29uc3Qgc3RvY2tSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXHJcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxyXG4gICAgJ1N0b2NrIFcxMSc6IGZtdFN0b2NrKHAuY29kZSksXHJcbiAgfSkpLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdzUyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChzdG9ja1Jvd3MpO1xyXG4gIHdzU1snIWNvbHMnXSA9IFt7IHdjaDogMTQgfSwgeyB3Y2g6IDYwIH0sIHsgd2NoOiAxNCB9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1MsICdTdG9jaycpO1xyXG5cclxuICAvLyBIb2phIDQ6IG1ldGFkYXRhIC0gY3VhbmRvIGZ1ZSBjYWRhIHNuYXBzaG90IHBhcmEgcXVlIGVsIGxlY3RvciBzZXBhXHJcbiAgLy8gc2kgbGEgbGlzdGEgZXN0YSBmcmVzY2EuXHJcbiAgY29uc3QgaW5mb1Jvd3MgPSBbXHJcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGVuIGNhdGFsb2dvJywgVmFsb3I6IFBST0RVQ1RTLmxlbmd0aCB9LFxyXG4gICAgeyBJdGVtOiAnVG90YWwgU0tVcyBjb24gcHJlY2lvIGNhcmdhZG8nLCBWYWxvcjogcHJlY2lvc1Jvd3MubGVuZ3RoIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBzdG9jayBkaXNwb25pYmxlJyxcclxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gdHJ1ZSkubGVuZ3RoLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIHN0b2NrJyxcclxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gZmFsc2UpLmxlbmd0aCxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIHNpbiBkYXRvIGRlIHN0b2NrJyxcclxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PSBudWxsKS5sZW5ndGgsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBtb25lZGEnLFxyXG4gICAgICBWYWxvcjogdHlwZW9mIFBSSUNFX0xJU1RfQ1VSUkVOQ1kgIT09ICd1bmRlZmluZWQnID8gUFJJQ0VfTElTVF9DVVJSRU5DWSA6ICdBUlMnLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgYWN0dWFsaXphZGEnLFxyXG4gICAgICBWYWxvcjpcclxuICAgICAgICB0eXBlb2YgUFJJQ0VfTElTVF9VUERBVEVEX0FUICE9PSAndW5kZWZpbmVkJyAmJiBQUklDRV9MSVNUX1VQREFURURfQVRcclxuICAgICAgICAgID8gbmV3IERhdGUoUFJJQ0VfTElTVF9VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKVxyXG4gICAgICAgICAgOiAnKG5vIGNhcmdhZGEpJyxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdTdG9jayBzbmFwc2hvdCBhY3R1YWxpemFkbycsXHJcbiAgICAgIFZhbG9yOiBTVE9DS19VUERBVEVEX0FUID8gbmV3IERhdGUoU1RPQ0tfVVBEQVRFRF9BVCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgOiAnKG5vIGNhcmdhZG8pJyxcclxuICAgIH0sXHJcbiAgICB7IEl0ZW06ICdFeHBvcnRhZG8nLCBWYWxvcjogbmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnRXhwb3J0YWRvIHBvcicsXHJcbiAgICAgIFZhbG9yOiAoY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lKSkgfHwgJyhkZXNjb25vY2lkbyknLFxyXG4gICAgfSxcclxuICBdO1xyXG4gIGNvbnN0IHdzSSA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChpbmZvUm93cyk7XHJcbiAgd3NJWychY29scyddID0gW3sgd2NoOiAzNiB9LCB7IHdjaDogMzYgfV07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NJLCAnSW5mbycpO1xyXG5cclxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdQcmVjaW9zX3lfU3RvY2tfJyArIHRzICsgJy54bHN4Jyk7XHJcbiAgc2hvd1N5bmNUYWcocm93cy5sZW5ndGggKyAnIFNLVXMgZXhwb3J0YWRvcyAocHJlY2lvcyArIHN0b2NrKScpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEVYUE9SVCAtIGRpYWxvZ28gZGUgc2VsZWNjaW9uICsgMyBmb3JtYXRvc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxud2luZG93LmV4cG9ydFRvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRmlsdHJhciBvcGNpb25lcyBzZWd1biByb2wuXHJcbiAgLy8gICB2ZW5kZWRvcjogb3BlcmF0aXZvIGRpYXJpbyAoVmVudGFzIC8gVmlzaXRhcyAvIFJ1dGFzKSArIENsaWVudGVzIGRlIHN1IHpvbmFcclxuICAvLyAgICAgKGV4cG9ydE1hc3RlckNsaWVudGVzIHlhIGZpbHRyYSBwb3IgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0IC0+IHNvbG8gc3UgdmVuZG9yKS5cclxuICAvLyAgIGludGVybm8gKFZESSk6IG1pc21vIHNjb3BlIG9wZXJhdGl2byArIENsaWVudGVzIGRlIHN1cyBwYXJlamFzIChvIHNvbG8gZWxcclxuICAvLyAgICAgcHJvcGlvIHNpIGVsaWdpbyBzdSBub21icmUgZW4gZWwgZHJvcGRvd24gZGUgem9uYXMpLlxyXG4gIC8vICAgYWRtaW4gLyBnZXJlbnRlIC8gdmlld2VyOiB2ZW4gdG9kbyBlbCBsaXN0YWRvIChudWxsID0gc2luIGZpbHRybykuXHJcbiAgY29uc3QgYWxsb3dlZEJ5Um9sZSA9IHtcclxuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBWRU5UQVMgeSBSVVRBUyBlbGltaW5hZG9zIGRlbCBVSSBwb3IgcGVkaWRvIGRlIE1hcmlhbm8uXHJcbiAgICB2ZW5kZWRvcjogbmV3IFNldChbJ1ZJU0lUQVMnLCAnTUFTVEVSJywgJ0JBQ0tPUkRFUicsICdTVE9DS19BU0lHJywgJ1BFRElET1NfTUVTJ10pLFxyXG4gICAgaW50ZXJubzogbmV3IFNldChbJ1ZJU0lUQVMnLCAnTUFTVEVSJywgJ0JBQ0tPUkRFUicsICdTVE9DS19BU0lHJywgJ1BFRElET1NfTUVTJ10pLFxyXG4gIH07XHJcbiAgY29uc3QgYWxsb3dlZCA9IGFsbG93ZWRCeVJvbGVbdXNlclJvbGVdIHx8IG51bGw7IC8vIG51bGwgPSB2ZXIgdG9kb1xyXG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNleHBvcnQtbW9kYWwgLmV4cC1vcHQnKS5mb3JFYWNoKChlbCkgPT4ge1xyXG4gICAgY29uc3Qga2luZCA9IGVsLmRhdGFzZXQuZXhwS2luZCB8fCAnJztcclxuICAgIGVsLnN0eWxlLmRpc3BsYXkgPSAhYWxsb3dlZCB8fCBhbGxvd2VkLmhhcyhraW5kKSA/ICcnIDogJ25vbmUnO1xyXG4gIH0pO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZUV4cG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIE1vbnRoIHBpY2tlciByZXV0aWxpemFibGUgcGFyYSBsb3MgNSB0aXBvcyBkZSBleHBvcnRcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmxldCBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XHJcbmNvbnN0IEVYUE9SVF9UWVBFX0xBQkVMUyA9IHtcclxuICBWRU5UQVM6ICdWZW50YXMnLFxyXG4gIFZJU0lUQVM6ICdWaXNpdGFzJyxcclxuICBSRU5ESUNJT05FUzogJ1JlbmRpY2lvbmVzJyxcclxuICBSVVRBUzogJ1J1dGFzJyxcclxuICBBTFRBUzogJ0FsdGFzIGRlIGNsaWVudGVzJyxcclxuICBCQUNLT1JERVI6ICdCYWNrb3JkZXInLFxyXG4gIFNUT0NLX0FTSUc6ICdTdG9jayBBc2lnbmFkbycsXHJcbiAgUEVESURPU19NRVM6ICdQZWRpZG9zIGRlbCBtZXMnLFxyXG59O1xyXG5cclxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uICh0aXBvKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSB0aXBvO1xyXG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXRpdGxlJyk7XHJcbiAgY29uc3Qgc3VidCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1zdWJ0Jyk7XHJcbiAgdGl0bGUudGV4dENvbnRlbnQgPSAnRXhwb3J0YXIgJyArIChFWFBPUlRfVFlQRV9MQUJFTFNbdGlwb10gfHwgdGlwbyk7XHJcbiAgc3VidC50ZXh0Q29udGVudCA9ICdFbGVnaSBlbCBtZXMgeSBhXHUwMEYxbyBxdWUgcXVlcmVzIGRlc2Nhcmdhci4nO1xyXG4gIC8vIFBvcHVsYXRlIHNlbGVjdHNcclxuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IG1lc1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKTtcclxuICBtZXNTZWwuaW5uZXJIVE1MID1cclxuICAgICc8b3B0aW9uIHZhbHVlPVwiQUxMXCI+VG9kb3MgbG9zIG1lc2VzIChhXHUwMEYxbyBlbnRlcm8pPC9vcHRpb24+JyArXHJcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XHJcbiAgbWVzU2VsLnZhbHVlID0gbm93LmdldE1vbnRoKCk7XHJcbiAgY29uc3QgYW5pb1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJyk7XHJcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xyXG4gIGxldCB5b3B0cyA9ICcnO1xyXG4gIGZvciAobGV0IHkgPSB5ZWFyIC0gMzsgeSA8PSB5ZWFyICsgMTsgeSsrKVxyXG4gICAgeW9wdHMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgeSArICdcIj4nICsgeSArICc8L29wdGlvbj4nO1xyXG4gIGFuaW9TZWwuaW5uZXJIVE1MID0geW9wdHM7XHJcbiAgYW5pb1NlbC52YWx1ZSA9IHllYXI7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xyXG59O1xyXG5cclxud2luZG93LmNvbmZpcm1Nb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCB0aXBvID0gcGVuZGluZ0V4cG9ydFR5cGU7XHJcbiAgY29uc3QgbWVzUmF3ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpLnZhbHVlO1xyXG4gIGNvbnN0IGFuaW8gPSBwYXJzZUludChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpLnZhbHVlLCAxMCk7XHJcbiAgY29uc3QgbW9udGhJZHggPSBtZXNSYXcgPT09ICdBTEwnID8gbnVsbCA6IHBhcnNlSW50KG1lc1JhdywgMTApO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xyXG4gIGlmICghdGlwbykgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBpZiAodGlwbyA9PT0gJ1ZFTlRBUycpIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWSVNJVEFTJykgZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSRU5ESUNJT05FUycpIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JVVEFTJykgZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQUxUQVMnKSBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdCQUNLT1JERVInKSBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnU1RPQ0tfQVNJRycpIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdQRURJRE9TX01FUycpIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGFsZXJ0KCdUaXBvIGRlc2Nvbm9jaWRvOiAnICsgdGlwbyk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0ICcgKyB0aXBvLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpIHtcclxuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkgcmV0dXJuIFN0cmluZyhhbmlvKTtcclxuICByZXR1cm4gTUVTRVNbbW9udGhJZHhdICsgJ18nICsgYW5pbztcclxufVxyXG5cclxuZnVuY3Rpb24gZG93bmxvYWRYbHN4KGZpbGVuYW1lLCBzaGVldHMpIHtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XHJcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgICAgcy5yb3dzLmxlbmd0aCA/IHMucm93cyA6IFt7IEF2aXNvOiAnU2luIGRhdG9zIHBhcmEgZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8nIH1dXHJcbiAgICApO1xyXG4gICAgaWYgKHMucm93cy5sZW5ndGgpIHtcclxuICAgICAgY29uc3QgY29scyA9IE9iamVjdC5rZXlzKHMucm93c1swXSkubWFwKChrKSA9PiAoe1xyXG4gICAgICAgIHdjaDogTWF0aC5taW4oNDAsIE1hdGgubWF4KDEwLCBrLmxlbmd0aCArIDQpKSxcclxuICAgICAgfSkpO1xyXG4gICAgICB3c1snIWNvbHMnXSA9IGNvbHM7XHJcbiAgICB9XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgcy5uYW1lLnNsaWNlKDAsIDMxKSk7XHJcbiAgfVxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCBmaWxlbmFtZSk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBWRU5UQVM6IHBlZGlkb3MgY29uZmlybWFkb3MgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmVudGFzLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IHAgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KHAubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgIGNvbnN0IGxpbmVzID0gcC5saW5lcyB8fCBbXTtcclxuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XHJcbiAgICBjb25zdCB2ZW5kb3JLZXkgPSBwLnZlbmRvciB8fCBsb29rdXBWZW5kb3JGb3JDbGllbnQocC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpIHx8ICcnO1xyXG4gICAgY29uc3QgdmVuZG9ySW5mbyA9IHZlbmRvckxvb2t1cFt2ZW5kb3JLZXldIHx8IHt9O1xyXG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xyXG4gICAgY29uc3QgZGlzY1BjdCA9IChwLmRpc2NvdW50U25hcHNob3QgJiYgcC5kaXNjb3VudFNuYXBzaG90LnBjdFRvdGFsKSB8fCAwO1xyXG4gICAgbGluZXMuZm9yRWFjaCgobCkgPT4ge1xyXG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xyXG4gICAgICBjb25zdCBwcmVjaW8gPSBwYXJzZUZsb2F0KGwucHJlY2lvKSB8fCAwO1xyXG4gICAgICBjb25zdCBncm9zcyA9IHF0eSAqIHByZWNpbztcclxuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxyXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICAgICAgRXN0YWRvOiBwLnN0YWdlIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yS2V5IHx8ICcnKSxcclxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSB8fCAnJyksXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIENvZGlnb19TS1U6IGwuY29kZSB8fCAnJyxcclxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8ICcnLFxyXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXHJcbiAgICAgICAgRmFtaWxpYTogbC5mYW0gfHwgJycsXHJcbiAgICAgICAgU3ViZmFtaWxpYTogbC5zdWIgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcclxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcclxuICAgICAgICAvLyBTdWJ0b3RhbF9BUlMgPSBORVRPIChjb24gZGVzY3VlbnRvIGFwbGljYWRvKSAtIGVzIGxvIHF1ZSBjdWVudGFcclxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXHJcbiAgICAgICAgLy8gZGUgbGlzdGEgc2luIGRlc2N1ZW50byBwYXJhIHRyYXphYmlsaWRhZC5cclxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQobmV0KSxcclxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxyXG4gICAgICAgIERlc2N1ZW50b19QY3Q6IGRpc2NQY3QsXHJcbiAgICAgICAgRW5fTm9tYnJlX0RlX1ZERTogcC5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1ZlbnRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdWZW50YXMnLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xyXG4gIGlmICghcHJvdiB8fCAhbG9jTmFtZSkgcmV0dXJuICcnO1xyXG4gIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3YgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcclxuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFZJU0lUQVM6IGRldGFsbGUgZGUgdmlzaXRhcyBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmlzaXRhcyArIENvbnRhY3Rvcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHRhcmdldE1lcyA9IG1vbnRoSWR4ICE9PSBudWxsID8gTUVTRVNbbW9udGhJZHhdLnRvVXBwZXJDYXNlKCkgOiBudWxsO1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBpZiAocGFyc2VJbnQodi5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmICh0YXJnZXRNZXMgJiYgKHYubWVzIHx8ICcnKS50b1VwcGVyQ2FzZSgpICE9PSB0YXJnZXRNZXMpIHJldHVybjtcclxuICAgIGl0ZW1zLnB1c2godik7XHJcbiAgfSk7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xyXG4gIGNvbnN0IG5Db250YWN0b3MgPSBpdGVtcy5sZW5ndGggLSBuVmlzaXRhcztcclxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGRlbCBmcmVudGUgZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBMYXp5IGxvYWQuXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzIHkgQ29udGFjdG9zJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XHJcbiAgd3MuY29sdW1ucyA9IFtcclxuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdNZXMnLCBrZXk6ICdtZXMnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnQW5pbycsIGtleTogJ2FuaW8nLCB3aWR0aDogOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnSW50ZXJhY2Npb24nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdGb3JtYSBDb250YWN0bycsIGtleTogJ2Zvcm1hQ29udGFjdG8nLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnUmVzdWx0YWRvIENvbnRhY3RvJywga2V5OiAncmVzdWx0YWRvQ3QnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXHJcbiAgICB7IGhlYWRlcjogJ05lY2VzaWRhZCBQdW50dWFsJywga2V5OiAnbmVjJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ01hcyBWZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnTWFzIFByZWd1bnRhbicsIGtleTogJ21hc1ByJywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ0F5dWRhIFRpZW5kYScsIGtleTogJ2F5dWRhJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gVmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnUG9uZCBNb3N0cmFkb3InLCBrZXk6ICdwTW9zdCcsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdQb25kIEVjb21tZXJjZScsIGtleTogJ3BFY29tJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnR1BTIFN0YXR1cycsIGtleTogJ2dwc1N0Jywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0dQUyBEaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0VuIG5vbWJyZSBkZSBWREUnLCBrZXk6ICdvbkJlaGFsZicsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdDYXJnYWRvIFBvcicsIGtleTogJ2NyZWF0ZWRCeScsIHdpZHRoOiAyNCB9LFxyXG4gIF07XHJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xyXG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcclxuXHJcbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcclxuICBjb25zdCBST1dfSCA9IDEwMDtcclxuICBjb25zdCBJTUdfVyA9IDEzMDtcclxuICBjb25zdCBJTUdfSCA9IDkwO1xyXG5cclxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXHJcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IHYgb2YgaXRlbXMpIHtcclxuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcclxuICAgIGNvbnN0IGludGVyYWNjaW9uTGJsID0gaXNDb250YWN0byA/ICdDb250YWN0bycgOiAnVmlzaXRhJztcclxuICAgIGNvbnN0IGZvcm1hQ29udGFjdG9MYmwgPSBpc0NvbnRhY3RvID8gdi5mb3JtYUNvbnRhY3RvIHx8ICdTaW4gZXNwZWNpZmljYXInIDogJ1ByZXNlbmNpYWwnO1xyXG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XHJcbiAgICBpZiAoaXNDb250YWN0bykge1xyXG4gICAgICBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ1Jlc3BvbmRpbyc7XHJcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xyXG4gICAgICBlbHNlIHJlc3VsdGFkb0N0TGJsID0gJ1NpbiBtYXJjYXInO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6IHYuZmVjaGEgfHwgJycsXHJcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXHJcbiAgICAgIGFuaW86IHYuYW5pbyB8fCAnJyxcclxuICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXHJcbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcclxuICAgICAgZm9ybWFDb250YWN0bzogZm9ybWFDb250YWN0b0xibCxcclxuICAgICAgcmVzdWx0YWRvQ3Q6IHJlc3VsdGFkb0N0TGJsLFxyXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcclxuICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxyXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxyXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxyXG4gICAgICB0aXBvOiB2LnRpcG8gfHwgJycsXHJcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxyXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxyXG4gICAgICBmaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxyXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxyXG4gICAgICBuZWM6IHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcclxuICAgICAgb3BvcnR1OiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxyXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgICBtYXNQcjogdi5tYXNQcmVndW50YW4gfHwgJycsXHJcbiAgICAgIGF5dWRhOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxyXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcclxuICAgICAgcE1vc3Q6IHYucG9uZGVyYWNpb25Nb3N0cmFkbyB8fCAnJyxcclxuICAgICAgcEVjb206IHYucG9uZGVyYWNpb25FY29tbWVyY2UgfHwgJycsXHJcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBncHNTdDogdi5ncHNTdGF0dXMgfHwgJycsXHJcbiAgICAgIGdwc0Rpc3Q6IHYuZ3BzRGlzdGFuY2VNICE9IG51bGwgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXHJcbiAgICAgIG9uQmVoYWxmOiB2Lm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcclxuICAgICAgY3JlYXRlZEJ5OiB2LmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHYuY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICB9KTtcclxuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcclxuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcclxuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xyXG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XHJcbiAgICAgICAgaWYgKG0pIHtcclxuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgIGI2NCA9IG1bMl07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXHJcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXHJcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHZpc2l0YScsIGUpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XHJcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgbGlzdG86ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MnLCAyNDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdGFzRm9yTW9udGgnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBSRU5ESUNJT05FUzogZ2FzdG9zIHkgYW50aWNpcG9zIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUmVuZGljaW9uZXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncmVuZGljaW9uZXMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBsZXQgZHQgPSByLmZlY2hhIHx8IHIuZmVjaGFHYXN0byB8fCAnJztcclxuICAgIGlmICghZHQgJiYgci5jcmVhdGVkQXQgJiYgci5jcmVhdGVkQXQudG9EYXRlKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgZHQgPSByLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgICB9XHJcbiAgICBpZiAoIWR0KSByZXR1cm47XHJcbiAgICBjb25zdCBkT2JqID0gbmV3IERhdGUoZHQpO1xyXG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcclxuICAgIGlmIChkT2JqLmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkT2JqLmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcclxuICB9KTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgaXRlbXMubGVuZ3RoICsgJyByZW5kaWNpb25lcy4uLicsIDMwMDApO1xyXG5cclxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XHJcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcclxuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcclxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjYgfSxcclxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb25jZXB0bycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ04gVGlja2V0Jywga2V5OiAnbnVtVGlja2V0Jywgd2lkdGg6IDE0IH0sXHJcbiAgICB7IGhlYWRlcjogJ01vZG8gcGFnbycsIGtleTogJ21vZG9QYWdvJywgd2lkdGg6IDE0IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gZ2FzdG8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnRGl2aXNpb24nLCBrZXk6ICdkaXZpc2lvbicsIHdpZHRoOiAxNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlJywga2V5OiAnaW1wb3J0ZScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdNb25lZGEnLCBrZXk6ICdtb25lZGEnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZSBVU0QnLCBrZXk6ICdpbXBvcnRlVXNkJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ09ic2VydmFjaW9uZXMnLCBrZXk6ICdvYnMnLCB3aWR0aDogMzAgfSxcclxuICAgIHsgaGVhZGVyOiAnRm90byB0aWNrZXQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0VzdGFkbycsIGtleTogJ2VzdGFkbycsIHdpZHRoOiAxOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkb3InLCBrZXk6ICdhcHJvYmFkb3InLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG8gZW4nLCBrZXk6ICdhcHJvYmFkb0VuJywgd2lkdGg6IDE0IH0sXHJcbiAgXTtcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xyXG5cclxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxyXG4gIGNvbnN0IFJPV19IID0gMTEwO1xyXG4gIGNvbnN0IElNR19XID0gMTQwO1xyXG4gIGNvbnN0IElNR19IID0gMTAwO1xyXG5cclxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXHJcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XHJcbiAgICBjb25zdCByID0gaXQucjtcclxuICAgIGNvbnN0IGlzR2FzdG8gPSByLnRpcG8gPT09ICdnYXN0byc7XHJcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XHJcbiAgICBjb25zdCBvYnNTdHIgPVxyXG4gICAgICAoci5vYnNlcnZhY2lvbmVzIHx8IHIubm90YXMgfHwgJycpICtcclxuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcclxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XHJcbiAgICAgIGZlY2hhOiBpdC5mZWNoYSxcclxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxyXG4gICAgICB2ZW5kZWRvcjogci5vd25lck5hbWUgfHwgci52ZW5kb3JOYW1lIHx8IHIub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgZW1haWw6IHIub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXHJcbiAgICAgIG51bVRpY2tldDogci5udW1lcm9UaWNrZXQgfHwgJycsXHJcbiAgICAgIG1vZG9QYWdvOiByLm1vZG9QYWdvIHx8ICcnLFxyXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxyXG4gICAgICBkaXZpc2lvbjogci5kaXZpc2lvbkdhc3RvIHx8ICcnLFxyXG4gICAgICBpbXBvcnRlOiByLmltcG9ydGUgIT0gbnVsbCA/IHIuaW1wb3J0ZSA6ICcnLFxyXG4gICAgICBtb25lZGE6IHIubW9uZWRhIHx8ICdQRVNPUycsXHJcbiAgICAgIGltcG9ydGVVc2Q6IHIuaW1wb3J0ZVVzZCAhPSBudWxsICYmIHIuaW1wb3J0ZVVzZCAhPT0gMCA/IHIuaW1wb3J0ZVVzZCA6ICcnLFxyXG4gICAgICBvYnM6IG9ic1N0cixcclxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxyXG4gICAgICBlc3RhZG86IHIuc3RhdHVzIHx8IHIuZXN0YWRvIHx8ICcnLFxyXG4gICAgICBhcHJvYmFkb3I6IHIuYXBwcm92ZXJFbWFpbCB8fCByLmFwcm9iYWRvciB8fCAnJyxcclxuICAgICAgYXByb2JhZG9FbjpcclxuICAgICAgICByLmFwcHJvdmVkQXQgJiYgci5hcHByb3ZlZEF0LnRvRGF0ZSA/IHIuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxyXG4gICAgfSk7XHJcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XHJcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XHJcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogU0lFTVBSRSBlbWJlYmVyIGxhIGZvdG8gKG5vIGRlamFyIGh5cGVybGluaykuXHJcbiAgICAvLyBBbnRlczogc2kgZm90b1RpY2tldFVybCAoU3RvcmFnZSksIHF1ZWRhYmEgY29tbyBoeXBlcmxpbmsgQWJyaXIgdGlja2V0LlxyXG4gICAgLy8gQWhvcmE6IGZldGNoIGRlbCBVUkwgKyBjb252ZXJ0aXIgYSBhcnJheUJ1ZmZlciArIGVtYmViZXIgaWd1YWwgcXVlIGRhdGFVUkwuXHJcbiAgICAvLyBGYWxsYmFjayBhIGh5cGVybGluayBzb2xvIHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQsIGV0YykuXHJcbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcclxuICAgIGlmIChmb3RvU3JjICYmIHR5cGVvZiBmb3RvU3JjID09PSAnc3RyaW5nJyAmJiBmb3RvU3JjLnN0YXJ0c1dpdGgoJ2RhdGE6aW1hZ2UvJykpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcclxuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xyXG4gICAgICAgIGlmIChtKSB7XHJcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICBiNjQgPSBtWzJdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxyXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAoci5mb3RvVGlja2V0VXJsICYmIHR5cGVvZiByLmZvdG9UaWNrZXRVcmwgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBmZXRjaCBsYSBmb3RvIGRlc2RlIFN0b3JhZ2UgeSBlbWJlYmVybGEgY29tbyBpbWFnZW4uXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKHIuZm90b1RpY2tldFVybCk7XHJcbiAgICAgICAgaWYgKCFyZXNwLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHJlc3Auc3RhdHVzKTtcclxuICAgICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlc3AuaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpIHx8ICdpbWFnZS9qcGVnJztcclxuICAgICAgICBsZXQgZXh0ID0gY29udGVudFR5cGUuc3BsaXQoJy8nKVsxXSB8fCAnanBlZyc7XHJcbiAgICAgICAgZXh0ID0gZXh0LnNwbGl0KCc7JylbMF0udHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBidWYgPSBhd2FpdCByZXNwLmFycmF5QnVmZmVyKCk7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYnVmZmVyOiBidWYsIGV4dGVuc2lvbjogZXh0IH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXHJcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXHJcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIC8vIEZhbGxiYWNrOiBzaSBlbCBmZXRjaCBmYWxsYSAoQ09SUywgcmVkKSwgZGVqYXIgaHlwZXJsaW5rIGNvbW8gYW50ZXMuXHJcbiAgICAgICAgY29uc29sZS53YXJuKCdmZXRjaCBmb3RvIHJlbmRpY2lvbiBmYWxsbywgZGVqbyBoeXBlcmxpbmsnLCBpdC5pZCwgZSk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IGNlbGwgPSByb3cuZ2V0Q2VsbChGT1RPX0NPTF9JRFggKyAxKTtcclxuICAgICAgICAgIGNlbGwudmFsdWUgPSB7XHJcbiAgICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxyXG4gICAgICAgICAgICBoeXBlcmxpbms6IHIuZm90b1RpY2tldFVybCxcclxuICAgICAgICAgICAgdG9vbHRpcDogJ0FicmlyIGxhIGZvdG8gZGVsIHRpY2tldCBlbiBlbCBicm93c2VyIChmZXRjaCBmYWxsbyknLFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGMDU2M0MxJyB9LCB1bmRlcmxpbmU6IHRydWUgfTtcclxuICAgICAgICB9IGNhdGNoIChfZTIpIHt9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcclxuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUmVuZGljaW9uZXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBSVVRBUzogcnV0YXMgYXNpZ25hZGFzIGRlbCBwZXJpb2RvICsgb3ZlcnJpZGVzXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUnV0YXMuLi4nKTtcclxuICAvLyBMYXMgcnV0YXMgc2UgZ2VuZXJhbiBlbiBydW50aW1lIHBhcmEgY2FkYSB2ZW5kZWRvcjsgZW4gY2FtYmlvIGxvcyBvdmVycmlkZXNcclxuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XHJcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxhcyBydXRhcyBwbGFuaWZpY2FkYXMgZGVsIHBlcmlvZG8gKHBhcmEgbG9zIHZlbmRlZG9yZXNcclxuICAvLyAgICBkZWwgcm9sIGFjdHVhbCBvIHRvZG9zIHNpIGFkbWluKVxyXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXHJcbiAgY29uc3QgdGFyZ2V0VmVuZG9ycyA9XHJcbiAgICB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ3ZpZXdlcidcclxuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXHJcbiAgICAgIDogYXNzaWduZWRWZW5kb3JcclxuICAgICAgICA/IFthc3NpZ25lZFZlbmRvcl1cclxuICAgICAgICA6IFtdO1xyXG4gIGNvbnN0IG1vbnRoc1RvRXhwb3J0ID0gbW9udGhJZHggIT09IG51bGwgPyBbbW9udGhJZHhdIDogWzAsIDEsIDIsIDMsIDQsIDUsIDYsIDcsIDgsIDksIDEwLCAxMV07XHJcbiAgY29uc3QgcnV0YXNSb3dzID0gW107XHJcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcclxuICAgIGZvciAoY29uc3QgbSBvZiBtb250aHNUb0V4cG9ydCkge1xyXG4gICAgICBsZXQgcnV0YXM7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcnV0YXMgPSBnZW5lcmFyUnV0YXNWZW5kb3IodmVuZCwgbSwgYW5pbyk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICAgICAgcnV0YXMgPSBbXTtcclxuICAgICAgfVxyXG4gICAgICAocnV0YXMgfHwgW10pLmZvckVhY2goKHJ1dGEpID0+IHtcclxuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XHJcbiAgICAgICAgICBydXRhc1Jvd3MucHVzaCh7XHJcbiAgICAgICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZCksXHJcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXHJcbiAgICAgICAgICAgIE1lczogTUVTRVNbbV0sXHJcbiAgICAgICAgICAgIFJ1dGFfSUQ6IHJ1dGEuaWQgfHwgJycsXHJcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcclxuICAgICAgICAgICAgRmVjaGFfQXNpZ25hZGE6IHJ1dGEuZmVjaGFBc2lnbmFkYSB8fCAnJyxcclxuICAgICAgICAgICAgT3JkZW46IGkgKyAxLFxyXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcclxuICAgICAgICAgICAgTG9jYWxpZGFkOiB0LmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgICAgIFRpZW5kYTogdC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXHJcbiAgICAgICAgICAgIEVzdGFkbzogdC5lc3RhZG8gfHwgJycsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIE92ZXJyaWRlc1xyXG4gIGxldCBvdnJTbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBvdnJTbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb3V0ZV9vdmVycmlkZXMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChfZSkge1xyXG4gICAgb3ZyU25hcCA9IG51bGw7XHJcbiAgfVxyXG4gIGNvbnN0IG92ZXJyaWRlc1Jvd3MgPSBbXTtcclxuICBpZiAob3ZyU25hcCkge1xyXG4gICAgb3ZyU25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICAgIGNvbnN0IG8gPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChvLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICAgIG92ZXJyaWRlc1Jvd3MucHVzaCh7XHJcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxyXG4gICAgICAgIE1lczogTUVTRVNbcGFyc2VJbnQoby5tb250aElkeCwgMTApXSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKG8udmVuZG9yIHx8ICcnKSxcclxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcclxuICAgICAgICBMb2NhbGlkYWQ6IG8ubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBUaWVuZGE6IG8uY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcclxuICAgICAgICBEZXJpdmFkYV9BOiBvLmRlcml2YWRhQSB8fCAnJyxcclxuICAgICAgICBSZWFnZW5kYWRhX1BhcmE6IG8ucmVhZ2VuZGFkYVBhcmEgfHwgJycsXHJcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcclxuICAgICAgICBDcmVhZG9fUG9yOiBvLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgICAgIENyZWFkb19FbjpcclxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUnV0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXHJcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcclxuICAgIHsgbmFtZTogJ0Rlcml2YWNpb25lcy1SZWFnZW5kYXMnLCByb3dzOiBvdmVycmlkZXNSb3dzIH0sXHJcbiAgXSk7XHJcbiAgc2hvd1N5bmNUYWcoXHJcbiAgICAnRXhwb3J0IFJ1dGFzIGxpc3RvICgnICsgcnV0YXNSb3dzLmxlbmd0aCArICcgdGllbmRhcywgJyArIG92ZXJyaWRlc1Jvd3MubGVuZ3RoICsgJyBvdmVycmlkZXMpJyxcclxuICAgIDI0MDBcclxuICApO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQUxUQVM6IHNvbGljaXR1ZGVzIGRlIGFsdGEgZGUgY2xpZW50ZSBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEFsdGFzLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBsZXQgZHQgPSAnJztcclxuICAgIGlmIChhLmNyZWF0ZWRBdCAmJiBhLmNyZWF0ZWRBdC50b0RhdGUpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xyXG4gICAgICB9IGNhdGNoIChfZSkge31cclxuICAgIH1cclxuICAgIGlmICghZHQpIHJldHVybjtcclxuICAgIGlmIChkdC5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZHQuZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIEZlY2hhX1NvbGljaXR1ZDogZHQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXHJcbiAgICAgIEVzdGFkbzogYS5zdGF0dXMgfHwgJycsXHJcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxyXG4gICAgICBGYW50YXNpYTogYS5mYW50YXNpYSB8fCAnJyxcclxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxyXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXHJcbiAgICAgIENhbGxlOiBhLmNhbGxlIHx8ICcnLFxyXG4gICAgICBOdW1lcm86IGEubnVtZXJvIHx8ICcnLFxyXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxyXG4gICAgICBQcm92aW5jaWE6IGEucHJvdmluY2lhIHx8ICcnLFxyXG4gICAgICBDUDogYS5jcCB8fCAnJyxcclxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXHJcbiAgICAgIEVtYWlsOiBhLmVtYWlsIHx8ICcnLFxyXG4gICAgICBWZW5kZWRvcl9Tb2xpY2l0YW50ZTogYS52ZW5kb3JOYW1lIHx8IGEub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgU3VibWl0dGVkX0J5X1B1YmxpY19Gb3JtOiBhLnN1Ym1pdHRlZEJ5UHVibGljRm9ybSA/ICdTSScgOiAnTk8nLFxyXG4gICAgICBBcHJvYmFkb19Qb3I6IGEuYXBwcm92ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgICBBcHJvYmFkb19FbjpcclxuICAgICAgICBhLmFwcHJvdmVkQXQgJiYgYS5hcHByb3ZlZEF0LnRvRGF0ZSA/IGEuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxyXG4gICAgICBSZWNoYXphZG9fTW90aXZvOiBhLnJlamVjdGVkUmVhc29uIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19BbHRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQWx0YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgc29saWNpdHVkZXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyB2NzA5ICgyMDI2LTA4LTI4KTogMyBleHBvcnRzIG51ZXZvcyBwZWRpZG9zIHBvciBNYXJpYW5vLlxyXG4vLyAtIEJBQ0tPUkRFUjogbGluZWFzIHN0YXRlPUJPIG9wZW4gcG9yIG1lcyBkZSBjcmVhdGVkQXQgZGVsIHBlZGlkby5cclxuLy8gLSBTVE9DS19BU0lHOiBsaW5lYXMgQVNJRyBvcGVuIChvIEJPK3N0b2NrIGRpc3ApIHBvciBtZXMgZGUgY3JlYXRlZEF0LlxyXG4vLyAtIFBFRElET1NfTUVTOiBUT0RPUyBsb3MgcGVkaWRvcyBjcmVhZG9zIGVuIGVsIG1lcy9hbmlvIChjdWFscXVpZXIgc3RhZ2UpLlxyXG4vLyBGdWVudGU6IGdsb2JhbFBlZGlkb3MgKGxvIHF1ZSBsYSBhcHAgeWEgdGllbmUgZW4gbWVtb3JpYSkuXHJcbi8vIEZpbHRlciBtZXMvYVx1MDBGMW86IHNvYnJlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLiBtb250aElkeD1udWxsIC0+IGFcdTAwRjFvIGVudGVyby5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmZ1bmN0aW9uIF9wZWRpZG9Nb250aFllYXIocCkge1xyXG4gIGNvbnN0IGNhID0gcC5jcmVhdGVkQXQ7XHJcbiAgaWYgKCFjYSkgcmV0dXJuIHsgeTogbnVsbCwgbTogbnVsbCB9O1xyXG4gIGxldCBkdCA9IG51bGw7XHJcbiAgaWYgKHR5cGVvZiBjYSA9PT0gJ3N0cmluZycpIGR0ID0gbmV3IERhdGUoY2EpO1xyXG4gIGVsc2UgaWYgKHR5cGVvZiBjYS50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGR0ID0gY2EudG9EYXRlKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGVsc2UgaWYgKHR5cGVvZiBjYSA9PT0gJ251bWJlcicpIGR0ID0gbmV3IERhdGUoY2EpO1xyXG4gIGlmICghZHQgfHwgTnVtYmVyLmlzTmFOKGR0LmdldFRpbWUoKSkpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcclxuICByZXR1cm4geyB5OiBkdC5nZXRGdWxsWWVhcigpLCBtOiBkdC5nZXRNb250aCgpIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCkge1xyXG4gIGNvbnN0IGFyciA9XHJcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcclxuICByZXR1cm4gYXJyLmZpbHRlcigocCkgPT4ge1xyXG4gICAgaWYgKCFwKSByZXR1cm4gZmFsc2U7XHJcbiAgICBjb25zdCB7IHksIG0gfSA9IF9wZWRpZG9Nb250aFllYXIocCk7XHJcbiAgICBpZiAoeSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoeSAhPT0gYW5pbykgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIG0gIT09IG1vbnRoSWR4KSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIuLi4nKTtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XHJcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcclxuICAgIGlmIChwLmNsb3NlZEF0KSBjb250aW51ZTtcclxuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcclxuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xyXG4gICAgICBpZiAoIWwgfHwgbC5zdGF0ZSAhPT0gJ0JPJykgcmV0dXJuO1xyXG4gICAgICBjb25zdCBxbyA9IE51bWJlcihsLnF0eU9wZW4pIHx8IDA7XHJcbiAgICAgIGlmIChxbyA8PSAwKSByZXR1cm47XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBwLmNyZWF0ZWRBdFxyXG4gICAgICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcclxuICAgICAgICAgICAgICAgIC50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICAgICAgICAuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICA6ICcnLFxyXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcclxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxyXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxyXG4gICAgICAgIENhbnRpZGFkX1BlZGlkYTogTnVtYmVyKGwucXR5KSB8fCAwLFxyXG4gICAgICAgIENhbnRpZGFkX1BlbmRpZW50ZV9CTzogcW8sXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCksXHJcbiAgICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSB8fCAwKSksXHJcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxyXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxyXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl8nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8uLi4nKTtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XHJcbiAgY29uc3QgZ2V0U3RrID1cclxuICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcclxuICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGFcclxuICAgICAgOiBudWxsO1xyXG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSB7XHJcbiAgICBpZiAocC5jbG9zZWRBdCkgY29udGludWU7XHJcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XHJcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcclxuICAgICAgaWYgKCFsKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHFvID0gTnVtYmVyKGwucXR5T3BlbikgfHwgMDtcclxuICAgICAgaWYgKHFvIDw9IDApIHJldHVybjtcclxuICAgICAgbGV0IHZpcnR1YWwgPSBmYWxzZTtcclxuICAgICAgaWYgKGwuc3RhdGUgPT09ICdBU0lHJykge1xyXG4gICAgICAgIC8vIG9rIHJlc2VydmEgZmlybWVcclxuICAgICAgfSBlbHNlIGlmIChsLnN0YXRlID09PSAnQk8nKSB7XHJcbiAgICAgICAgLy8gdmlydHVhbCBzb2xvIHNpIGhheSBzdG9jayBkaXNwXHJcbiAgICAgICAgaWYgKCFnZXRTdGspIHJldHVybjtcclxuICAgICAgICBjb25zdCBzdGsgPSBnZXRTdGsobC5jb2RlKSB8fCAwO1xyXG4gICAgICAgIGlmIChzdGsgPD0gMCkgcmV0dXJuO1xyXG4gICAgICAgIHZpcnR1YWwgPSB0cnVlO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIEZlY2hhX1BlZGlkbzogcC5jcmVhdGVkQXRcclxuICAgICAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xyXG4gICAgICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXHJcbiAgICAgICAgICAgICAgICAudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgOiAnJyxcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcclxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcclxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHFvLFxyXG4gICAgICAgIEVzdGFkb19SZWFsOiB2aXJ0dWFsID8gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKScgOiAnQVNJRycsXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCksXHJcbiAgICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxbyAqIChOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCkgfHwgMCkpLFxyXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcclxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWduYWRvIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufVxyXG5cclxuLy8gdjczNyAoMjAyNi0wOC0zMCk6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvcyBsb3MgYmFja29yZGVycyBvcGVuIChzaW4gZmlsdHJvXHJcbi8vIGRlIG1lcykuIE1vdGl2bzogbG9zIDYyIHBlZGlkb3MgbWlncmFkb3MgZGVzZGUgU0FQIGVsIDIwMjYtMDgtMjggdGllbmVuXHJcbi8vIGNyZWF0ZWRBdCBkZSBmZWNoYXMgdmllamFzIGRlbCBTQVAgU1Egb3JpZ2luYWwsIGVudG9uY2VzIGVsIGV4cG9ydCBwb3IgbWVzXHJcbi8vIG5vIGxvcyBpbmNsdWlhLiBWZXJzaW9uIFwiY3VycmVudCBzdGF0dXNcIiBxdWUgaXRlcmEgZ2xvYmFsUGVkaWRvcyBjb21wbGV0by5cclxud2luZG93LmV4cG9ydEJhY2tvcmRlckFsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIgKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29uc3QgYXJyID1cclxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xyXG4gIGxldCB0b3RhbFBlZGlkb3NPcGVuID0gMDtcclxuICBmb3IgKGNvbnN0IHAgb2YgYXJyKSB7XHJcbiAgICBpZiAoIXAgfHwgcC5jbG9zZWRBdCkgY29udGludWU7XHJcbiAgICB0b3RhbFBlZGlkb3NPcGVuKys7XHJcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XHJcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcclxuICAgICAgaWYgKCFsIHx8IGwuc3RhdGUgIT09ICdCTycpIHJldHVybjtcclxuICAgICAgY29uc3QgcW8gPSBOdW1iZXIobC5xdHlPcGVuKSB8fCAwO1xyXG4gICAgICBpZiAocW8gPD0gMCkgcmV0dXJuO1xyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIEZlY2hhX1BlZGlkbzogcC5jcmVhdGVkQXRcclxuICAgICAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xyXG4gICAgICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXHJcbiAgICAgICAgICAgICAgICAudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgOiAnJyxcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcclxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcclxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZF9QZWRpZGE6IE51bWJlcihsLnF0eSkgfHwgMCxcclxuICAgICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApLFxyXG4gICAgICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZChxbyAqIChOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCkgfHwgMCkpLFxyXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcclxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcclxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxyXG4gICAgICAgIE9yaWdlbjogcC5taWdyYXRpb25Tb3VyY2UgfHwgJ2FwcCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFeHBvcnQgQmFja29yZGVyIHZhY2lvLiBEaWFnbm9zdGljbzpcXG4nICtcclxuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xyXG4gICAgICAgIGFyci5sZW5ndGggK1xyXG4gICAgICAgICdcXG4nICtcclxuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcclxuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJy0gTGluZWFzIHN0YXRlPUJPIGNvbiBxdHlPcGVuPjA6IDBcXG5cXG4nICtcclxuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xyXG4gICAgICAgICcxLiBObyBoYXkgYmFja29yZGVyIGFiaWVydG8gYWhvcmEgbWlzbW8gKHRvZG8gY29uZmlybWVkIG8gY2VycmFkbylcXG4nICtcclxuICAgICAgICAnMi4gTG9zIHBlZGlkb3MgdGllbmVuIGNsb3NlZEF0IHNldGVhZG8gcG9yIGVycm9yXFxuJyArXHJcbiAgICAgICAgJzMuIExhcyBsaW5lYXMgQk8gdGllbmVuIHF0eU9wZW49MCAoeWEgZGVzcGFjaGFkYXMgdmlhIEFTSUctPmNsb3NlZCknXHJcbiAgICApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXI6IDAgbGluZWFzICh2ZXIgYWxlcnRhKScsIDMwMDApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XHJcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQmFja29yZGVyJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59O1xyXG5cclxuLy8gdjczNzogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG8gZWwgU3RvY2sgQXNpZ25hZG8gKHNpbiBmaWx0cm8gZGUgbWVzKS4gTWlzbW9cclxuLy8gbW90aXZvIHF1ZSBleHBvcnRCYWNrb3JkZXJBbGwuXHJcbndpbmRvdy5leHBvcnRTdG9ja0FzaWdBbGwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8gKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29uc3QgYXJyID1cclxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xyXG4gIGNvbnN0IGdldFN0ayA9XHJcbiAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXHJcbiAgICAgIDogbnVsbDtcclxuICBsZXQgdG90YWxQZWRpZG9zT3BlbiA9IDA7XHJcbiAgbGV0IGFzaWdDb3VudCA9IDA7XHJcbiAgbGV0IGJvV2l0aFN0b2NrQ291bnQgPSAwO1xyXG4gIGZvciAoY29uc3QgcCBvZiBhcnIpIHtcclxuICAgIGlmICghcCB8fCBwLmNsb3NlZEF0KSBjb250aW51ZTtcclxuICAgIHRvdGFsUGVkaWRvc09wZW4rKztcclxuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcclxuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xyXG4gICAgICBpZiAoIWwpIHJldHVybjtcclxuICAgICAgY29uc3QgcW8gPSBOdW1iZXIobC5xdHlPcGVuKSB8fCAwO1xyXG4gICAgICBpZiAocW8gPD0gMCkgcmV0dXJuO1xyXG4gICAgICBsZXQgdmlydHVhbCA9IGZhbHNlO1xyXG4gICAgICBpZiAobC5zdGF0ZSA9PT0gJ0FTSUcnKSB7XHJcbiAgICAgICAgYXNpZ0NvdW50Kys7XHJcbiAgICAgIH0gZWxzZSBpZiAobC5zdGF0ZSA9PT0gJ0JPJykge1xyXG4gICAgICAgIGlmICghZ2V0U3RrKSByZXR1cm47XHJcbiAgICAgICAgY29uc3Qgc3RrID0gZ2V0U3RrKGwuY29kZSkgfHwgMDtcclxuICAgICAgICBpZiAoc3RrIDw9IDApIHJldHVybjtcclxuICAgICAgICB2aXJ0dWFsID0gdHJ1ZTtcclxuICAgICAgICBib1dpdGhTdG9ja0NvdW50Kys7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBwLmNyZWF0ZWRBdFxyXG4gICAgICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcclxuICAgICAgICAgICAgICAgIC50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICAgICAgICAuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICA6ICcnLFxyXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcclxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxyXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxyXG4gICAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcW8sXHJcbiAgICAgICAgRXN0YWRvX1JlYWw6IHZpcnR1YWwgPyAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJyA6ICdBU0lHJyxcclxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSxcclxuICAgICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHFvICogKE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSB8fCAwKSksXHJcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxyXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxyXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXHJcbiAgICAgICAgT3JpZ2VuOiBwLm1pZ3JhdGlvblNvdXJjZSB8fCAnYXBwJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXHJcbiAgICAgICAgJy0gVG90YWwgcGVkaWRvcyBlbiBnbG9iYWxQZWRpZG9zOiAnICtcclxuICAgICAgICBhcnIubGVuZ3RoICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJy0gUGVkaWRvcyBhYmllcnRvcyAoc2luIGNsb3NlZEF0KTogJyArXHJcbiAgICAgICAgdG90YWxQZWRpZG9zT3BlbiArXHJcbiAgICAgICAgJ1xcbicgK1xyXG4gICAgICAgICctIExpbmVhcyBzdGF0ZT1BU0lHIGNvbiBxdHlPcGVuPjA6ICcgK1xyXG4gICAgICAgIGFzaWdDb3VudCArXHJcbiAgICAgICAgJ1xcbicgK1xyXG4gICAgICAgICctIExpbmVhcyBzdGF0ZT1CTyBjb24gc3RvY2sgZGlzcG9uaWJsZSAodmlydHVhbCBBU0lHKTogJyArXHJcbiAgICAgICAgYm9XaXRoU3RvY2tDb3VudCArXHJcbiAgICAgICAgJ1xcblxcbicgK1xyXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXHJcbiAgICAgICAgJzEuIE5vIGhheSBzdG9jayBhc2lnbmFkbyBhaG9yYSBtaXNtb1xcbicgK1xyXG4gICAgICAgICcyLiBUb2RvIGVsIHN0b2NrIGVzdGEgcGVuZGllbnRlIHNpbiBhc2lnbmFyIChtb2RlIEJPIHB1cm8gc2luIHN0b2NrKVxcbicgK1xyXG4gICAgICAgICczLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbydcclxuICAgICk7XHJcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWc6IDAgbGluZWFzICh2ZXIgYWxlcnRhKScsIDMwMDApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fU25hcHNob3RfJyArIHRvZGF5ICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdTdG9jayBBc2lnbmFkbycsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59O1xyXG5cclxuLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc3VlbHZlIG5vbWJyZSBkZSBmYW50YXNpYSBwYXJhIHVuIHBlZGlkbyB1c2FuZG8gZWxcclxuLy8gbWlzbW8gcGF0dGVybiBxdWUgbGFzIGNhcmRzIGRlbCBtYXBhIChpbmRleC5odG1sOjk5MTUtOTkzNSk6XHJcbi8vICAgMSkgY2xpZW50TWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWEgKGVkaXRhZG8gZGVzZGUgZWwgbW9kYWwgY2xpZW50ZSlcclxuLy8gICAyKSBhcHByb3ZlZEFsdGFzTGlzdFtdLmZhbnRhc2lhIG1hdGNoZWFkbyBwb3IgY29tZXJjaW8gPT0gY2xpZW50TmFtZVxyXG5mdW5jdGlvbiBfcmVzb2x2ZUZhbnRhc2lhRm9yUGVkaWRvKHApIHtcclxuICBjb25zdCBjYXJkQ29kZSA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XHJcbiAgaWYgKGNhcmRDb2RlKSB7XHJcbiAgICBjb25zdCBtZXRhID0gLyoqIEB0eXBlIHthbnl9ICovIChnbG9iYWxUaGlzKS5jbGllbnRNZXRhO1xyXG4gICAgY29uc3QgY3VzdG9tID0gbWV0YSAmJiBtZXRhW2NhcmRDb2RlXSAmJiBtZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYTtcclxuICAgIGlmIChjdXN0b20gJiYgU3RyaW5nKGN1c3RvbSkudHJpbSgpKSByZXR1cm4gU3RyaW5nKGN1c3RvbSkudHJpbSgpO1xyXG4gIH1cclxuICBjb25zdCBhbHRhcyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuYXBwcm92ZWRBbHRhc0xpc3Q7XHJcbiAgaWYgKEFycmF5LmlzQXJyYXkoYWx0YXMpKSB7XHJcbiAgICBjb25zdCBuYW1lTG93ZXIgPSBTdHJpbmcocC5jbGllbnROYW1lIHx8ICcnKVxyXG4gICAgICAudHJpbSgpXHJcbiAgICAgIC50b0xvd2VyQ2FzZSgpO1xyXG4gICAgaWYgKG5hbWVMb3dlcikge1xyXG4gICAgICBjb25zdCBtYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IHtcclxuICAgICAgICBpZiAoIWEpIHJldHVybiBmYWxzZTtcclxuICAgICAgICBjb25zdCBjID0gU3RyaW5nKGEuY29tZXJjaW8gfHwgJycpXHJcbiAgICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICBjb25zdCBmID0gU3RyaW5nKGEuZmFudGFzaWEgfHwgJycpXHJcbiAgICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gYyA9PT0gbmFtZUxvd2VyIHx8IGYgPT09IG5hbWVMb3dlcjtcclxuICAgICAgfSk7XHJcbiAgICAgIGlmIChtYXRjaCAmJiBtYXRjaC5mYW50YXNpYSAmJiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKSkge1xyXG4gICAgICAgIHJldHVybiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gJyc7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFBlZGlkb3MgZGVsIG1lcy4uLicpO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcclxuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykge1xyXG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xyXG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3QgZmVjaGEgPSBwLmNyZWF0ZWRBdFxyXG4gICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcclxuICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcclxuICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxyXG4gICAgICA6ICcnO1xyXG4gICAgLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc29sdmVyIGZhbnRhc2lhIHVuYSB2ZXogcG9yIHBlZGlkbyAobm8gcG9yIGxpbmVhKSBcdTIwMTRcclxuICAgIC8vIGVsIGxvb2t1cCBlbiBjbGllbnRNZXRhICsgYXBwcm92ZWRBbHRhc0xpc3QgZXMgY29uc3RhbnRlIHBhcmEgdG9kbyBlbCBwZWRpZG8uXHJcbiAgICBjb25zdCBub21icmVMb2NhbEZhbnRhc2lhID0gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKTtcclxuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xyXG4gICAgICBpZiAoIWwpIHJldHVybjtcclxuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGwucXR5KSB8fCAwO1xyXG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCk7XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYSxcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIE5vbWJyZV9Mb2NhbF9GYW50YXNpYTogbm9tYnJlTG9jYWxGYW50YXNpYSxcclxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXHJcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcclxuICAgICAgICBDYW50aWRhZF9PcGVuOiBOdW1iZXIobC5xdHlPcGVuKSB8fCAwLFxyXG4gICAgICAgIENhbnRpZGFkX0ludm9pY2VkOiBOdW1iZXIobC5xdHlJbnZvaWNlZCkgfHwgMCxcclxuICAgICAgICBDYW50aWRhZF9DYW5jZWxsZWQ6IE51bWJlcihsLnF0eUNhbmNlbGxlZCkgfHwgMCxcclxuICAgICAgICBFc3RhZG9fTGluZWE6IGwuc3RhdGUgfHwgJycsXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXHJcbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKHF0eSAqIHByZWNpbyksXHJcbiAgICAgICAgQ2VycmFkbzogcC5jbG9zZWRBdCA/ICdTSScgOiAnTk8nLFxyXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcclxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcclxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkZlY2hhX1BlZGlkbyB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhX1BlZGlkbyB8fCAnJykpO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVkaWRvc0RlbE1lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdQZWRpZG9zJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBQZWRpZG9zIGRlbCBtZXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59XHJcblxyXG4vLyBFeHBvcnRhciBwYXJhIEFuYWxpc2lzOiBwcm90ZWdpZG8gY29uIFBJTlxyXG5jb25zdCBBTkFMSVNJU19QSU4gPSAnMTIzNSc7XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeHBvcnQgRXhjZWwgVEFSR0VUUy1aT05BUyAtIHNvbG8gY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxyXG4vLyBjdWFscXVpZXIgYWx0YSBkZSBjbGllbnRfYXBwbGljYXRpb25zIGNvbiBzdGF0dXM9J2FwcHJvdmVkJyBZIGNhcmRDb2RlU2FwXHJcbi8vIGFzaWduYWRvLiBFeGNsdXllIFBPSU5UUyAvIGRpc3RyaWJ1aWRvcmVzIC8gcHJvc3BlY3RvcyAvIGFsdGFzIHNpblxyXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXHJcbi8vIENvbHVtbmFzOiBUSVBPLCBOUk8gQ1RFLCBSRUdJT04sIFBST1ZJTkNJQSwgQVNFU09SIEVYVEVSTk8sIEFTRVNPUiBJTlRFUk5PLFxyXG4vLyBDQUxMRSwgTlVNRVJPLCBMT0NBTElEQUQsIENQLCBOT01CUkUgQ09NRVJDSUFMLCBOT01CUkUgREUgRkFOVEFTSUEsIENVSVQsXHJcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXHJcbndpbmRvdy5leHBvcnRUYXJnZXRzWm9uYXMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBleHBvcnRhciBlbCBtYXN0ZXIuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgVEFSR0VUUy1aT05BUy4uLicpO1xyXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XHJcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxyXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gIH07XHJcbiAgZnVuY3Rpb24gcmVnaW9uT2YocHJvdikge1xyXG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgaWYgKFsnQlVFTk9TIEFJUkVTJywgJ0NBUElUQUwgRkVERVJBTCcsICdMQSBQQU1QQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0JVRU5PUyBBSVJFUyc7XHJcbiAgICBpZiAoWydDT1JET0JBJywgJ1NBTiBMVUlTJywgJ01FTkRPWkEnLCAnU0FOIEpVQU4nLCAnTEEgUklPSkEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdDVVlPJztcclxuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXHJcbiAgICAgIHJldHVybiAnTkVBJztcclxuICAgIGlmIChbJ0pVSlVZJywgJ1NBTFRBJywgJ1RVQ1VNQU4nLCAnQ0FUQU1BUkNBJywgJ1NBTlRJQUdPIERFTCBFU1RFUk8nXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdOT0EnO1xyXG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxyXG4gICAgICByZXR1cm4gJ1BBVEFHT05JQSc7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHZlbmRvckxhYmVsRm9yRXhjZWwoa2V5KSB7XHJcbiAgICBpZiAoIWtleSkgcmV0dXJuICcnO1xyXG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xyXG4gICAgcmV0dXJuIGtleTtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGxldCBhbHRhc1NuYXA7XHJcbiAgdHJ5IHtcclxuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKVxyXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9PScsICdhcHByb3ZlZCcpXHJcbiAgICAgIC5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhcyBhcHJvYmFkYXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgbGV0IHNraXBwZWROb1NhcCA9IDA7XHJcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcclxuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXHJcbiAgICBpZiAoIWNhcmRDb2RlKSB7XHJcbiAgICAgIHNraXBwZWROb1NhcCsrO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBwcm92aW5jZSA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9VcHBlckNhc2UoKS50cmltKCk7XHJcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcclxuICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcclxuICAgICAgJ05STyBDVEUnOiAwLCAvLyBzZSByZW51bWVyYSBkZXNwdWVzIGRlbCBzb3J0XHJcbiAgICAgIFJFR0lPTjogcmVnaW9uT2YocHJvdmluY2UpLFxyXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxyXG4gICAgICAnQVNFU09SIEVYVEVSTk8nOiB2ZW5kb3JMYWJlbEZvckV4Y2VsKHZlbmRvciksXHJcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcclxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXHJcbiAgICAgIE5VTUVSTzogYS5udW1lcm8gfHwgJycsXHJcbiAgICAgIExPQ0FMSURBRDogbG9jYWxpdHlGaW5hbCxcclxuICAgICAgQ1A6IGEuY3AgfHwgJycsXHJcbiAgICAgICdOT01CUkUgQ09NRVJDSUFMJzogYS5jb21lcmNpbyB8fCBhLnRpdHVsYXIgfHwgJycsXHJcbiAgICAgICdOT01CUkUgREUgRkFOVEFTSUEnOiBhLmZhbnRhc2lhIHx8ICcnLFxyXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXHJcbiAgICAgICdDT05ESUNJT04gRklTQ0FMJzogYS5jb25kaWNpb25GaXNjYWwgfHwgJycsXHJcbiAgICAgIFRFTEVGT05POiBhLnRlbGVmb25vIHx8ICcnLFxyXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVAgdG9kYXZpYS5cXG5cXG5VbmEgYWx0YSBlbnRyYSBhbCBleHBvcnQgc29sbyBjdWFuZG8gdGllbmUgQ2FyZENvZGUgU0FQIGFzaWduYWRvLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKHIxLlBST1ZJTkNJQSB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5QUk9WSU5DSUEgfHwgJycpO1xyXG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xyXG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcclxuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcclxuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcclxuICB9KTtcclxuICByb3dzLmZvckVhY2goKHIsIGkpID0+IHtcclxuICAgIHJbJ05STyBDVEUnXSA9IGkgKyAxO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTAgfSxcclxuICAgIHsgd2NoOiAxNiB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMjggfSxcclxuICAgIHsgd2NoOiAyOCB9LFxyXG4gICAgeyB3Y2g6IDI4IH0sXHJcbiAgICB7IHdjaDogMTAgfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDEwIH0sXHJcbiAgICB7IHdjaDogMzggfSxcclxuICAgIHsgd2NoOiAzMiB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgXTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0NMSUVOVEVTX1pPTkFTJyk7XHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcpO1xyXG4gIHNob3dTeW5jVGFnKFxyXG4gICAgJ0V4Y2VsIGV4cG9ydGFkbzogJyArXHJcbiAgICAgIHJvd3MubGVuZ3RoICtcclxuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcclxuICAgICAgKHNraXBwZWROb1NhcCA+IDAgPyAnICgnICsgc2tpcHBlZE5vU2FwICsgJyBzaW4gQ2FyZENvZGUgZGVzY2FydGFkb3MpJyA6ICcnKVxyXG4gICk7XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHBpbiA9IHByb21wdChcclxuICAgICdFc3RhIHNlY2Npb24gY29udGllbmUgZm9ybWF0b3MgYXZhbnphZG9zIChQb3dlciBCSSwgUHl0aG9uL01MLCBaSVAgZGUgZm90b3MpIGRlc3RpbmFkb3MgYSBhbmFsaXNpcyB0ZWNuaWNvLlxcblxcbkluZ3Jlc2EgZWwgUElOIHBhcmEgY29udGludWFyOidcclxuICApO1xyXG4gIGlmIChwaW4gPT09IG51bGwpIHJldHVybjtcclxuICBpZiAocGluICE9PSBBTkFMSVNJU19QSU4pIHtcclxuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxyXG4gIGNvbnN0IHNhcE9wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LXNhcC1pbnRlZ3JhdGlvbicpO1xyXG4gIGlmIChzYXBPcHQpIHtcclxuICAgIGNvbnN0IGlzTWFyaWFubyA9XHJcbiAgICAgIGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJztcclxuICAgIHNhcE9wdC5zdHlsZS5kaXNwbGF5ID0gaXNNYXJpYW5vID8gJycgOiAnbm9uZSc7XHJcbiAgfVxyXG4gIC8vIE9wY2lvbiBCYWNrdXAgbWVuc3VhbDogc29sbyBhZG1pblxyXG4gIGNvbnN0IGJrT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtYmFja3VwLW1lbnN1YWwnKTtcclxuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbn07XHJcblxyXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxyXG4vLyBIZWxwZXJzIGludGVybm9zIChkb3dubG9hZFhsc3gsIGV4cG9ydFZlbnRhc0Zvck1vbnRoLCBldGMuKSBzb24gY29uc3VtaWRvc1xyXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZ0JBLFNBQU8sdUJBQXVCLFdBQVk7QUFDeEMsUUFBSSxPQUFPLFNBQVMsYUFBYTtBQUMvQixZQUFNLGlGQUFpRjtBQUN2RjtBQUFBLElBQ0Y7QUFDQSxRQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sUUFBUTtBQUM3QixZQUFNLGdDQUFnQztBQUN0QztBQUFBLElBQ0Y7QUFDQSxnQkFBWSxxQ0FBcUM7QUFRakQsVUFBTSxXQUNKLE9BQU8sMEJBQTBCLGFBQzdCLHNCQUFzQixPQUFPLGtCQUFrQixjQUFjLGdCQUFnQixLQUFLLElBQ2xGO0FBQ04sVUFBTSxVQUFVLENBQUMsY0FBYztBQUM3QixVQUFJLGFBQWEsS0FBTSxRQUFPO0FBQzlCLFVBQUksQ0FBQyxVQUFXLFFBQU87QUFDdkIsYUFBTyxTQUFTLElBQUksU0FBUztBQUFBLElBQy9CO0FBTUEsVUFBTSxhQUFhO0FBQUEsTUFDakIseUJBQXlCO0FBQUEsTUFDekIsc0JBQXNCO0FBQUEsTUFDdEIsZ0JBQWdCO0FBQUEsTUFDaEIsT0FBTztBQUFBLElBQ1Q7QUFDQSxhQUFTLFdBQVcsV0FBVztBQUM3QixZ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
