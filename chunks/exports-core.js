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
      "MARTIN BOIERO": "SANTIAGO ESTEBAN"
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
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 16 },
      // CardCode SAP
      { wch: 38 },
      // Nombre tienda
      { wch: 28 },
      // Alias
      { wch: 14 },
      // Tipo
      { wch: 14 },
      // Estado
      { wch: 22 },
      // Provincia
      { wch: 22 },
      // Localidad mapa
      { wch: 22 },
      // Departamento
      { wch: 28 },
      // Vendedor externo
      { wch: 8 },
      // Zona
      { wch: 48 },
      // Etiqueta zona
      { wch: 28 },
      // Asesor interno
      { wch: 38 },
      // Direccion
      { wch: 24 },
      // Localidad declarada
      { wch: 14 },
      // Lat
      { wch: 14 },
      // Lng
      // v450: clasificacion desde visits/contactos.
      { wch: 14 },
      // Ultima interaccion
      { wch: 14 },
      // Tipo ultima interaccion
      { wch: 10 },
      // Total visitas
      { wch: 10 },
      // Total contactos
      { wch: 18 },
      // Tipo comercio
      { wch: 16 },
      // Local
      { wch: 12 },
      // Tamano
      { wch: 14 },
      // Fidelidad
      { wch: 20 },
      // Especializacion
      { wch: 20 },
      // Canal de compra
      { wch: 10 },
      // Relevancia
      { wch: 8 },
      // POP
      { wch: 26 },
      // Necesidad puntual
      { wch: 16 },
      // Tipo de venta
      { wch: 18 },
      // Ponderacion mostrador
      { wch: 18 },
      // Ponderacion e-commerce
      { wch: 26 },
      // Competencia
      { wch: 26 },
      // Oportunidad
      { wch: 22 },
      // Mas vendido
      { wch: 22 },
      // Mas preguntan
      { wch: 26 }
      // Ayuda tienda
    ];
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
      // v709 (2026-08-28): agregar BACKORDER, STOCK_ASIG, PEDIDOS_MES.
      vendedor: /* @__PURE__ */ new Set([
        "VENTAS",
        "VISITAS",
        "RUTAS",
        "MASTER",
        "BACKORDER",
        "STOCK_ASIG",
        "PEDIDOS_MES"
      ]),
      interno: /* @__PURE__ */ new Set([
        "VENTAS",
        "VISITAS",
        "RUTAS",
        "MASTER",
        "BACKORDER",
        "STOCK_ASIG",
        "PEDIDOS_MES"
      ])
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
          const cell = row.getCell(FOTO_COL_IDX + 1);
          cell.value = {
            text: "Abrir ticket",
            hyperlink: r.fotoTicketUrl,
            tooltip: "Abrir la foto del ticket en el browser"
          };
          cell.font = { color: { argb: "FF0563C1" }, underline: true };
        } catch (e) {
          console.warn("hyperlink foto rendicion", it.id, e);
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
          Provincia: p.clientProvince || "",
          Localidad: p.clientLocality || "",
          Vendedor: p.vendedor || p.vendorAssigned || "",
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
          Provincia: p.clientProvince || "",
          Localidad: p.clientLocality || "",
          Vendedor: p.vendedor || p.vendorAssigned || "",
          SKU: l.code || "",
          Producto: l.desc || l.name || "",
          Cantidad_Reservada: qo,
          Estado_Real: virtual ? "BO_con_stock_(virtual_ASIG)" : "ASIG",
          Precio_Unit_ARS: Number(l.priceAtCreation || l.precio || 0),
          Subtotal_Reservado_ARS: Math.round(
            qo * (Number(l.priceAtCreation || l.precio || 0) || 0)
          ),
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
  async function exportPedidosMesForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Pedidos del mes...");
    const rows = [];
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    for (const p of pedidos) {
      const lines = Array.isArray(p.lines) ? p.lines : [];
      if (!lines.length) continue;
      const fecha = p.createdAt ? typeof p.createdAt === "string" ? p.createdAt.slice(0, 10) : new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt).toISOString().slice(0, 10) : "";
      lines.forEach((l, idx) => {
        if (!l) return;
        const qty = Number(l.qty) || 0;
        const precio = Number(l.priceAtCreation || l.precio || 0);
        rows.push({
          Fecha_Pedido: fecha,
          Mes: p.month || "",
          Stage: p.stage || "",
          Cliente: p.clientName || "",
          CardCode: p.clientCardCode || "",
          Provincia: p.clientProvince || "",
          Localidad: p.clientLocality || "",
          Vendedor: p.vendedor || p.vendorAssigned || "",
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
      "MARTIN BOIERO": "SANTIAGO ESTEBAN"
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBkYXRvcyBjYXJnYWRvcyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIG1hc3RlcmZpbGUgZGUgY2xpZW50ZXMuLi4nKTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgJ01BUlRJTiBCT0lFUk8nOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LnpvbmUgOiAnJztcbiAgfVxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XG4gIH1cblxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcbiAgLy8gY2xpZW50ZSwgbWVyZ2VhIGxvcyBjYW1wb3MgZGUgY2xhc2lmaWNhY2lvbiAodGlwby90YW1hbm8vZmlkZWxpZGFkL1xuICAvLyBlc3BlY2lhbGl6YWNpb24vY2FuYWxDb21wcmEvcG9wL3RpcG9WZW50YS9ldGMuKSBkZWwgZm9ybXVsYXJpbyBkZVxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXG4gIC8vIE5PIFZBQ0lPIGFsIHJlY29ycmVyIGRvY3MgZGUgbWFzIHJlY2llbnRlIGEgbWFzIGFudGlndW8uIEFzaSBlbCB1c3VhcmlvXG4gIC8vIHZlIGxhIGNsYXNpZmljYWNpb24gbWFzIGFjdHVhbGl6YWRhLCBwZXJvIHNpIGVsIHVsdGltbyBjb250YWN0byBubyBsbGVuYVxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcbiAgLy8gZW4gdmV6IGRlIGRlamFyIHZhY2lvLiBQZWRpZG8gZGUgTWFyaWFubzogXCJwcmlvcml6YXIgbGEgdWx0aW1hXG4gIC8vIGludGVyYWNjaW9uIHBlcm8gbm8gcGVyZGVyIGluZm8gdXRpbCBkZSBsYXMgYW50ZXJpb3Jlc1wiLlxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcbiAgICAndGlwbycsXG4gICAgJ2xvY2FsJyxcbiAgICAndGFtYW5vJyxcbiAgICAnZmlkZWxpZGFkJyxcbiAgICAnZXNwZWNpYWxpemFjaW9uJyxcbiAgICAnY2FuYWxDb21wcmEnLFxuICAgICdyZWxldmFuY2lhJyxcbiAgICAncG9wJyxcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXG4gICAgJ3RpcG9WZW50YScsXG4gICAgJ3BvbmRlcmFjaW9uTW9zdHJhZG8nLFxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXG4gICAgJ2NvbXBldGVuY2lhJyxcbiAgICAnb3BvcnR1bmlkYWQnLFxuICAgICdtYXNWZW5kaWRvJyxcbiAgICAnbWFzUHJlZ3VudGFuJyxcbiAgICAnYXl1ZGFUaWVuZGEnLFxuICBdO1xuICBmdW5jdGlvbiBfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIHJldHVybiAoXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKGxvYyB8fCAnJykudG9TdHJpbmcoKS50cmltKCkgK1xuICAgICAgJ3wnICtcbiAgICAgICh0aWVuZGEgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpXG4gICAgKTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlRzKHYpIHtcbiAgICBpZiAodiAmJiB2LmNyZWF0ZWRBdCAmJiB2LmNyZWF0ZWRBdC50b01pbGxpcykgcmV0dXJuIHYuY3JlYXRlZEF0LnRvTWlsbGlzKCk7XG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xuICAgIHJldHVybiAwO1xuICB9XG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XG4gIGlmICh0eXBlb2YgdmlzaXRzQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkodmlzaXRzQ2FjaGUpKSB7XG4gICAgY29uc3QgYnlLZXkgPSBuZXcgTWFwKCk7XG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgICAgaWYgKCF2KSByZXR1cm47XG4gICAgICBjb25zdCBrID0gX2NsYXNzaWZLZXkodi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSk7XG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcbiAgICAgIGJ5S2V5LmdldChrKS5wdXNoKHYpO1xuICAgIH0pO1xuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xuICAgICAgYXJyLnNvcnQoKGEsIGIpID0+IF9jbGFzc2lmVHMoYikgLSBfY2xhc3NpZlRzKGEpKTsgLy8gZGVzYyBwb3IgZmVjaGFcbiAgICAgIGNvbnN0IG1lcmdlZCA9IHt9O1xuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcbiAgICAgICAgQ0xBU1NJRl9GSUVMRFMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgICAgIGlmIChtZXJnZWRbZl0gIT0gbnVsbCAmJiBtZXJnZWRbZl0gIT09ICcnICYmIG1lcmdlZFtmXSAhPT0gMCkgcmV0dXJuO1xuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XG4gICAgICAgICAgaWYgKHZhbCAhPSBudWxsICYmIHZhbCAhPT0gJycpIG1lcmdlZFtmXSA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGFyclswXSB8fCB7fTtcbiAgICAgIGNsYXNzaWZJbmRleC5zZXQoaywge1xuICAgICAgICBtZXJnZWQsXG4gICAgICAgIGxhc3RGZWNoYTogbGF0ZXN0LmZlY2hhIHx8ICcnLFxuICAgICAgICBsYXN0VHlwZTogbGF0ZXN0LmludGVyYWN0aW9uVHlwZSB8fCAobGF0ZXN0LmVzcGFjaW8gPyAndmlzaXRhJyA6ICcnKSxcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcbiAgICAgICAgY29udGFjdG9zOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gX2NsYXNzaWZSb3cocHJvdiwgbG9jLCB0aWVuZGEpIHtcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxuICAgICAgICAnVG90YWwgdmlzaXRhcyc6IDAsXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxuICAgICAgICAnVGlwbyBjb21lcmNpbyc6ICcnLFxuICAgICAgICBMb2NhbDogJycsXG4gICAgICAgIFRhbWFubzogJycsXG4gICAgICAgIEZpZGVsaWRhZDogJycsXG4gICAgICAgIEVzcGVjaWFsaXphY2lvbjogJycsXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcbiAgICAgICAgUmVsZXZhbmNpYTogJycsXG4gICAgICAgIFBPUDogJycsXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxuICAgICAgICAnVGlwbyBkZSB2ZW50YSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcbiAgICAgICAgQ29tcGV0ZW5jaWE6ICcnLFxuICAgICAgICBPcG9ydHVuaWRhZDogJycsXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxuICAgICAgICAnTWFzIHByZWd1bnRhbic6ICcnLFxuICAgICAgICAnQXl1ZGEgdGllbmRhJzogJycsXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBtID0gZW50cnkubWVyZ2VkIHx8IHt9O1xuICAgIHJldHVybiB7XG4gICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdEZlY2hhLFxuICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdFR5cGUsXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXG4gICAgICAnVG90YWwgY29udGFjdG9zJzogZW50cnkuY29udGFjdG9zLFxuICAgICAgJ1RpcG8gY29tZXJjaW8nOiBtLnRpcG8gfHwgJycsXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcbiAgICAgIFRhbWFubzogbS50YW1hbm8gfHwgJycsXG4gICAgICBGaWRlbGlkYWQ6IG0uZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcbiAgICAgICdDYW5hbCBkZSBjb21wcmEnOiBtLmNhbmFsQ29tcHJhIHx8ICcnLFxuICAgICAgUmVsZXZhbmNpYTogbS5yZWxldmFuY2lhICE9IG51bGwgPyBtLnJlbGV2YW5jaWEgOiAnJyxcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXG4gICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiBtLm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICAnVGlwbyBkZSB2ZW50YSc6IG0udGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogbS5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gbS5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxuICAgICAgQ29tcGV0ZW5jaWE6IG0uY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgICdNYXMgdmVuZGlkbyc6IG0ubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgICdNYXMgcHJlZ3VudGFuJzogbS5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxuICAvLyB0aWVuZW4gY2FyZENvZGUgKyBkaXJlY2Npb24uIEVzb3Mgc29uIGxvcyBxdWUgYXBhcmVjZW4gY29tbyB2ZXJkZXMgZW5cbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xuICAvLyByZWFsIG9wZXJhYmxlIGhveS5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHByb3ZpbmNlID0gcC5wcm92aW5jZSB8fCAnJztcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcbiAgICBjb25zdCBkZXB0ID0gcC5kZXB0IHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvciA9IHAudmVuZG9yIHx8ICcnO1xuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cbiAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgIGNvbnN0IGxhdCA9IHAubGF0ICE9IG51bGwgPyBwLmxhdCA6ICcnO1xuICAgIGNvbnN0IGxvbiA9IHAubG9uICE9IG51bGwgPyBwLmxvbiA6ICcnO1xuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cbiAgICAvLyBlbCBmaWx0cm8gaXNTYXBDb25maXJtZWQ6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi5cbiAgICAocC5jbGllbnRzIHx8IFtdKS5mb3JFYWNoKChuYW1lKSA9PiB7XG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpXG4gICAgICAgIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XG4gICAgICAvLyBFc3RhZG86IGhhYmlsaXRhZG8vY2FuY2VsYWRvL3BlbmRpZW50ZSAobGVnYWN5IGNvbnRhY3RlZCBzZXQpLlxuICAgICAgbGV0IGVzdGFkbyA9ICdIYWJpbGl0YWRvJzsgLy8gcG9yIGRlZmluaWNpb24geWEgZXN0YSBTQVAtY29uZmlybWFkb1xuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcbiAgICAgICAgZXN0YWRvID0gJ0NhbmNlbGFkbyc7XG4gICAgICAvLyBNZXRhZGF0YSBjdXN0b20gKGRpcmVjY2lvbiwgbG9jYWxpZGFkIGRlY2xhcmFkYSwgZ2VvY29kZSkuXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xuICAgICAgLy8gQnVzY2FyIGFkZHJlc3M6IDEpIGNsaWVudF9tYXN0ZXIuYWRkcmVzcyAoYWRtaW4pLCAyKSBjbGllbnRNZXRhLmFkZHJlc3MgKHZlbmRvcikuXG4gICAgICBjb25zdCBkb2NJZCA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcbiAgICAgIGNvbnN0IGNtRGF0YSA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XG4gICAgICBjb25zdCBhZGRyZXNzID0gY21EYXRhLmFkZHJlc3MgfHwgbWV0YS5hZGRyZXNzIHx8ICcnO1xuICAgICAgY29uc3QgbG9jYWxpdHlDdXN0ID0gY21EYXRhLmxvY2FsaWRhZCB8fCBtZXRhLmxvY2FsaXR5IHx8ICcnO1xuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XG4gICAgICBjb25zdCBjdXN0b21MbmcgPSBtZXRhLmxuZyAhPSBudWxsID8gbWV0YS5sbmcgOiAnJztcbiAgICAgIC8vIENhcmRDb2RlIFNBUCAoZGUgY2xpZW50X21hc3RlciBvIGRlIGxhIGFsdGEgdmluY3VsYWRhKS5cbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcHJvdmluY2UudG9VcHBlckNhc2UoKSArICd8JyArIGxvY2FsaXR5TWFwO1xuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiAoYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8ICcnKSA9PT0gbmFtZSk7XG4gICAgICAgIGlmIChhbHRhTWF0Y2gpIGNhcmRDb2RlID0gYWx0YU1hdGNoLmNhcmRDb2RlU2FwIHx8ICcnO1xuICAgICAgfVxuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBjYXJkQ29kZSxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbmFtZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcbiAgICAgICAgICAgIFRpcG86ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGVzdGFkbyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jYWxpdHlNYXAsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86IGRlcHQsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGFkZHJlc3MsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvY2FsaXR5Q3VzdCxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogY3VzdG9tTG5nIHx8IGxvbixcbiAgICAgICAgICB9LFxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSlcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG4gIC8vIElueWVjdGFyIGFsdGFzIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgKGFwcHJvdmVkQWx0YXNMaXN0KTpcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxuICAvLyAgICAgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS4gVmFuIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLiBTZVxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXG4gIC8vICAgICBMb3MgcHJvdmlzb3Jpb3MgcHVlZGVuIG5vIHRlbmVyIGRpcmVjY2lvbiB0b2RhdmlhIC0+IHNlIGFjZXB0YW4gaWd1YWwuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIHNlZW4uYWRkKFxuICAgICAgKHIuUHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgKTtcbiAgfSk7XG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xuICAgIGFwcHJvdmVkQWx0YXNMaXN0LmZvckVhY2goKGEpID0+IHtcbiAgICAgIGlmICghYSkgcmV0dXJuO1xuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XG4gICAgICAvLyBIYWJpbGl0YWRvczogc2lndWVuIGV4aWdpZW5kbyBjYXJkQ29kZSArIGRpcmVjY2lvbiAoY29tcG9ydGFtaWVudG8gcHJlLXYzMTEpLlxuICAgICAgLy8gUHJvdmlzb3Jpb3M6IHNpbiBjYXJkQ29kZSBuaSBkaXJlY2Npb24sIHZhbiBpZ3VhbCBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy5cbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XG4gICAgICAgIGlmICghYS5jYXJkQ29kZVNhcCkgcmV0dXJuO1xuICAgICAgICBpZiAoIShhLmNhbGxlIHx8IGEuYWRkcmVzcykpIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByb3YgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBub21icmUgPVxuICAgICAgICBhLmNvbWVyY2lvIHx8XG4gICAgICAgIGEuZmFudGFzaWEgfHxcbiAgICAgICAgKGEuY2FyZENvZGVTYXAgPyAnU0FQICcgKyBhLmNhcmRDb2RlU2FwLnNsaWNlKDAsIDgpIDogYS50aXR1bGFyIHx8ICdQcm92aXNvcmlvJyk7XG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChzZWVuLmhhcyhkdXBLZXkpKSByZXR1cm47XG4gICAgICBzZWVuLmFkZChkdXBLZXkpO1xuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICAgIC8vIHYzMzE6IG1pc21vIGZpbHRybyBkZSBzY29wZSBhcGxpY2EgYSBhbHRhcyBTQVAvcHJvdmlzb3JpYXMuXG4gICAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcbiAgICAgIGNvbnN0IGxvYyA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyhzaW4gbG9jYWxpZGFkKSc7XG4gICAgICByb3dzLnB1c2goXG4gICAgICAgIE9iamVjdC5hc3NpZ24oXG4gICAgICAgICAge1xuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGEuY2FyZENvZGVTYXAgfHwgJycsXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5vbWJyZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogJycsXG4gICAgICAgICAgICBUaXBvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbyAoQWx0YSByYXBpZGEpJyA6ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvJyA6ICdIYWJpbGl0YWRvJyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92KSA6IHByb3YsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvYyxcbiAgICAgICAgICAgIERlcGFydGFtZW50bzogJycsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGEuY2FsbGUgfHwgYS5hZGRyZXNzIHx8ICcnLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2MsXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGEubGF0ICE9IG51bGwgPyBhLmxhdCA6ICcnLFxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBhLmxuZyAhPSBudWxsID8gYS5sbmcgOiAnJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3YsIGxvYywgbm9tYnJlKVxuICAgICAgICApXG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gT3JkZW5hciBwb3IgcHJvdmluY2lhLCBsb2NhbGlkYWQsIG5vbWJyZS5cbiAgcm93cy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgcCA9IChhLlByb3ZpbmNpYSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlByb3ZpbmNpYSB8fCAnJyk7XG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xuICAgIGNvbnN0IGwgPSAoYVsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJyk7XG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xuICAgIHJldHVybiAoYVsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJyk7XG4gIH0pO1xuXG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICBhbGVydChcbiAgICAgICdObyBoYXkgY2xpZW50ZXMgcGFyYSBleHBvcnRhci5cXG5cXG4nICtcbiAgICAgICAgJ0VsIG1hc3RlcmZpbGUgaW5jbHV5ZTpcXG4nICtcbiAgICAgICAgJyAgKiBIYWJpbGl0YWRvcyBlbiBTQVAgKGNhcmRDb2RlICsgZGlyZWNjaW9uIGNhcmdhZG9zKS5cXG4nICtcbiAgICAgICAgJyAgKiBQcm92aXNvcmlvcyAoQWx0YSByYXBpZGEgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS5cXG5cXG4nICtcbiAgICAgICAgJ1NpIG5vIHZlcyBuaW5ndW5vLCByZXZpc2EgZWwgbW9kYWwgU0FQIG8gQWx0YSBDbGllbnRlcy4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XG4gIHdzWychY29scyddID0gW1xuICAgIHsgd2NoOiAxNiB9LCAvLyBDYXJkQ29kZSBTQVBcbiAgICB7IHdjaDogMzggfSwgLy8gTm9tYnJlIHRpZW5kYVxuICAgIHsgd2NoOiAyOCB9LCAvLyBBbGlhc1xuICAgIHsgd2NoOiAxNCB9LCAvLyBUaXBvXG4gICAgeyB3Y2g6IDE0IH0sIC8vIEVzdGFkb1xuICAgIHsgd2NoOiAyMiB9LCAvLyBQcm92aW5jaWFcbiAgICB7IHdjaDogMjIgfSwgLy8gTG9jYWxpZGFkIG1hcGFcbiAgICB7IHdjaDogMjIgfSwgLy8gRGVwYXJ0YW1lbnRvXG4gICAgeyB3Y2g6IDI4IH0sIC8vIFZlbmRlZG9yIGV4dGVybm9cbiAgICB7IHdjaDogOCB9LCAvLyBab25hXG4gICAgeyB3Y2g6IDQ4IH0sIC8vIEV0aXF1ZXRhIHpvbmFcbiAgICB7IHdjaDogMjggfSwgLy8gQXNlc29yIGludGVybm9cbiAgICB7IHdjaDogMzggfSwgLy8gRGlyZWNjaW9uXG4gICAgeyB3Y2g6IDI0IH0sIC8vIExvY2FsaWRhZCBkZWNsYXJhZGFcbiAgICB7IHdjaDogMTQgfSwgLy8gTGF0XG4gICAgeyB3Y2g6IDE0IH0sIC8vIExuZ1xuICAgIC8vIHY0NTA6IGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzL2NvbnRhY3Rvcy5cbiAgICB7IHdjaDogMTQgfSwgLy8gVWx0aW1hIGludGVyYWNjaW9uXG4gICAgeyB3Y2g6IDE0IH0sIC8vIFRpcG8gdWx0aW1hIGludGVyYWNjaW9uXG4gICAgeyB3Y2g6IDEwIH0sIC8vIFRvdGFsIHZpc2l0YXNcbiAgICB7IHdjaDogMTAgfSwgLy8gVG90YWwgY29udGFjdG9zXG4gICAgeyB3Y2g6IDE4IH0sIC8vIFRpcG8gY29tZXJjaW9cbiAgICB7IHdjaDogMTYgfSwgLy8gTG9jYWxcbiAgICB7IHdjaDogMTIgfSwgLy8gVGFtYW5vXG4gICAgeyB3Y2g6IDE0IH0sIC8vIEZpZGVsaWRhZFxuICAgIHsgd2NoOiAyMCB9LCAvLyBFc3BlY2lhbGl6YWNpb25cbiAgICB7IHdjaDogMjAgfSwgLy8gQ2FuYWwgZGUgY29tcHJhXG4gICAgeyB3Y2g6IDEwIH0sIC8vIFJlbGV2YW5jaWFcbiAgICB7IHdjaDogOCB9LCAvLyBQT1BcbiAgICB7IHdjaDogMjYgfSwgLy8gTmVjZXNpZGFkIHB1bnR1YWxcbiAgICB7IHdjaDogMTYgfSwgLy8gVGlwbyBkZSB2ZW50YVxuICAgIHsgd2NoOiAxOCB9LCAvLyBQb25kZXJhY2lvbiBtb3N0cmFkb3JcbiAgICB7IHdjaDogMTggfSwgLy8gUG9uZGVyYWNpb24gZS1jb21tZXJjZVxuICAgIHsgd2NoOiAyNiB9LCAvLyBDb21wZXRlbmNpYVxuICAgIHsgd2NoOiAyNiB9LCAvLyBPcG9ydHVuaWRhZFxuICAgIHsgd2NoOiAyMiB9LCAvLyBNYXMgdmVuZGlkb1xuICAgIHsgd2NoOiAyMiB9LCAvLyBNYXMgcHJlZ3VudGFuXG4gICAgeyB3Y2g6IDI2IH0sIC8vIEF5dWRhIHRpZW5kYVxuICBdO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0NsaWVudGVzIGhhYmlsaXRhZG9zIFNBUCcpO1xuXG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxuICBjb25zdCBieVpvbmUgPSB7fTtcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xuICAgIGlmICghYnlab25lW3pdKSBieVpvbmVbel0gPSB7IHRvdGFsOiAwLCBoYWJpbGl0YWRvczogMCwgY2FuY2VsYWRvczogMCB9O1xuICAgIGJ5Wm9uZVt6XS50b3RhbCsrO1xuICAgIGlmIChyLkVzdGFkbyA9PT0gJ0hhYmlsaXRhZG8nKSBieVpvbmVbel0uaGFiaWxpdGFkb3MrKztcbiAgICBlbHNlIGlmIChyLkVzdGFkbyA9PT0gJ0NhbmNlbGFkbycpIGJ5Wm9uZVt6XS5jYW5jZWxhZG9zKys7XG4gIH0pO1xuICBjb25zdCByZXN1bWVuUm93cyA9IE9iamVjdC5lbnRyaWVzKGJ5Wm9uZSlcbiAgICAubWFwKChbeiwgZF0pID0+ICh7XG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcbiAgICAgICdUb3RhbCB0aWVuZGFzJzogZC50b3RhbCxcbiAgICAgIEhhYmlsaXRhZGFzOiBkLmhhYmlsaXRhZG9zLFxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydUb3RhbCB0aWVuZGFzJ10gLSBhWydUb3RhbCB0aWVuZGFzJ10pO1xuICBjb25zdCB3c1JlcyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyZXN1bWVuUm93cyk7XG4gIHdzUmVzWychY29scyddID0gW3sgd2NoOiA0OCB9LCB7IHdjaDogMTQgfSwgeyB3Y2g6IDE0IH0sIHsgd2NoOiAxNCB9XTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NSZXMsICdSZXN1bWVuIHBvciB6b25hJyk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAvLyB2MzMxOiBzdWZpam8gY29uIGVsIHNjb3BlIGFwbGljYWRvIHBhcmEgZGlmZXJlbmNpYXIgZWwgYXJjaGl2byBkZWwgVkRFL1ZESVxuICAvLyBkZWwgZXhwb3J0IGdsb2JhbCBkZWwgYWRtaW4uXG4gIGNvbnN0IHNjb3BlTGJsID1cbiAgICBzY29wZVNldCA9PT0gbnVsbFxuICAgICAgPyAnVE9ET1MnXG4gICAgICA6IHNjb3BlU2V0LnNpemUgPT09IDFcbiAgICAgICAgPyBbLi4uc2NvcGVTZXRdWzBdLnNwbGl0KCcgJylbMF1cbiAgICAgICAgOiAnbWlzLXpvbmFzLScgKyBzY29wZVNldC5zaXplO1xuICBjb25zdCBmbmFtZSA9ICdNYXN0ZXJmaWxlX0NsaWVudGVzX1NBUF8nICsgc2NvcGVMYmwgKyAnXycgKyB0cyArICcueGxzeCc7XG4gIFhMU1gud3JpdGVGaWxlKHdiLCBmbmFtZSk7XG4gIHNob3dTeW5jVGFnKFxuICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgZXhwb3J0YWRvcycgK1xuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcbiAgKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0OiBQcmVjaW9zICsgU3RvY2sgcG9yIFNLVVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcbi8vIGVuIG1lbW9yaWE6IFBST0RVQ1RTIChtYXN0ZXIgZGUgU0tVcyksIFBSSUNFX0xJU1RfTUFQIChwcmVjaW8gQVJTIGRlXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cbi8vIEhvamFzOlxuLy8gIC0gXCJQcmVjaW9zIHkgU3RvY2tcIjogdW5hIGZpbGEgcG9yIFNLVSBjb24gdG9kYXMgbGFzIGNvbHVtbmFzIGp1bnRhc1xuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXG4vLyAgLSBcIlN0b2NrXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBlc3RhZG8gZGUgc3RvY2suXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBjYXRhbG9nbyBkZSBwcm9kdWN0b3MgY2FyZ2FkbyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIHByZWNpb3MgKyBzdG9jay4uLicpO1xuICAvLyB2NTc0ICgyMDI2LTA4LTIxKTogcGVkaWRvIGRlIE1hcmlhbm8gXHUyMDE0IG1vc3RyYXIgVU5JREFERVMgbnVtZXJpY2FzXG4gIC8vIGV4YWN0YXMgZGVsIGRlcG9zaXRvIDExICh2ZW50YSkgZW4gdmV6IGRlIFwiRGlzcG9uaWJsZVwiL1wiU2luIHN0b2NrXCIuXG4gIC8vIFVzYSBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YSBxdWUgbGVlIFNUT0NLX1dBUkVIT1VTRV9CUkVBS0RPV05bc2t1XVsnMTEnXS5cbiAgLy8gUmV0b3JuYSAnJyAoY2VsZGEgdmFjaWEpIGN1YW5kbyBubyBoYXkgZGF0byBkZSBzdG9jayAoc25hcHNob3Qgbm8gY2FyZ2Fkb1xuICAvLyBhdW4pOyAwIHNpIGVsIFNLVSBubyB0aWVuZSBzdG9jay4gTG9zIG51bWVyb3MgcGVybWl0ZW4gc29ydC9maWx0ZXIvc3VtIGVuXG4gIC8vIEV4Y2VsIFx1MjAxNCBubyBwZXJkZW1vcyBlbCBlc3RhZG8gXCJubyBkYXRvXCIgdnMgXCIwIHVuaWRhZGVzXCIgZ3JhY2lhcyBhbCAnJy5cbiAgZnVuY3Rpb24gZm10U3RvY2soc2t1KSB7XG4gICAgY29uc3QgZm4gPVxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxuICAgICAgICA6IG51bGw7XG4gICAgY29uc3QgdiA9IGZuID8gZm4oc2t1KSA6IG51bGw7XG4gICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgIHJldHVybiBOdW1iZXIodikgfHwgMDtcbiAgfVxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xuICB9XG4gIC8vIEhvamEgMTogY29tYm8gY29tcGxldG8gKGVzIGxhIG1hcyBwZWRpZGEpLlxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXG4gICAgU3ViZmFtaWxpYTogcC5zdWIgfHwgJycsXG4gICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICAgICdTdG9jayBXMTEnOiBmbXRTdG9jayhwLmNvZGUpLFxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDYwIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gIF07XG4gIC8vIEFwbGljYXIgZm9ybWF0byBtb25lZGEgYSBsYSBjb2x1bW5hIFByZWNpbyBBUlMgKGNvbHVtbmEgRiA9IDYpLlxuICBmb3IgKGxldCBpID0gMjsgaSA8PSByb3dzLmxlbmd0aCArIDE7IGkrKykge1xuICAgIGNvbnN0IGNlbGwgPSB3c1snRicgKyBpXTtcbiAgICBpZiAoY2VsbCAmJiB0eXBlb2YgY2VsbC52ID09PSAnbnVtYmVyJykgY2VsbC56ID0gJ1wiJFwiIywjIzAnO1xuICB9XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnUHJlY2lvcyB5IFN0b2NrJyk7XG5cbiAgLy8gSG9qYSAyOiBzb2xvIFByZWNpb3NcbiAgY29uc3QgcHJlY2lvc1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICB9KSlcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxuICAgIC5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3Qgd3NQID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHByZWNpb3NSb3dzKTtcbiAgd3NQWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xuICBmb3IgKGxldCBpID0gMjsgaSA8PSBwcmVjaW9zUm93cy5sZW5ndGggKyAxOyBpKyspIHtcbiAgICBjb25zdCBjZWxsID0gd3NQWydDJyArIGldO1xuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XG4gIH1cbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NQLCAnUHJlY2lvcycpO1xuXG4gIC8vIEhvamEgMzogc29sbyBTdG9ja1xuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcbiAgfSkpLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCB3c1MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoc3RvY2tSb3dzKTtcbiAgd3NTWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1MsICdTdG9jaycpO1xuXG4gIC8vIEhvamEgNDogbWV0YWRhdGEgLSBjdWFuZG8gZnVlIGNhZGEgc25hcHNob3QgcGFyYSBxdWUgZWwgbGVjdG9yIHNlcGFcbiAgLy8gc2kgbGEgbGlzdGEgZXN0YSBmcmVzY2EuXG4gIGNvbnN0IGluZm9Sb3dzID0gW1xuICAgIHsgSXRlbTogJ1RvdGFsIFNLVXMgZW4gY2F0YWxvZ28nLCBWYWxvcjogUFJPRFVDVFMubGVuZ3RoIH0sXG4gICAgeyBJdGVtOiAnVG90YWwgU0tVcyBjb24gcHJlY2lvIGNhcmdhZG8nLCBWYWxvcjogcHJlY2lvc1Jvd3MubGVuZ3RoIH0sXG4gICAge1xuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgY29uIHN0b2NrIGRpc3BvbmlibGUnLFxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gdHJ1ZSkubGVuZ3RoLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIHN0b2NrJyxcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT09IGZhbHNlKS5sZW5ndGgsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gZGF0byBkZSBzdG9jaycsXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09IG51bGwpLmxlbmd0aCxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdMaXN0YSBkZSBwcmVjaW9zIG1vbmVkYScsXG4gICAgICBWYWxvcjogdHlwZW9mIFBSSUNFX0xJU1RfQ1VSUkVOQ1kgIT09ICd1bmRlZmluZWQnID8gUFJJQ0VfTElTVF9DVVJSRU5DWSA6ICdBUlMnLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgYWN0dWFsaXphZGEnLFxuICAgICAgVmFsb3I6XG4gICAgICAgIHR5cGVvZiBQUklDRV9MSVNUX1VQREFURURfQVQgIT09ICd1bmRlZmluZWQnICYmIFBSSUNFX0xJU1RfVVBEQVRFRF9BVFxuICAgICAgICAgID8gbmV3IERhdGUoUFJJQ0VfTElTVF9VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKVxuICAgICAgICAgIDogJyhubyBjYXJnYWRhKScsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnU3RvY2sgc25hcHNob3QgYWN0dWFsaXphZG8nLFxuICAgICAgVmFsb3I6IFNUT0NLX1VQREFURURfQVQgPyBuZXcgRGF0ZShTVE9DS19VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcobm8gY2FyZ2FkbyknLFxuICAgIH0sXG4gICAgeyBJdGVtOiAnRXhwb3J0YWRvJywgVmFsb3I6IG5ldyBEYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnRXhwb3J0YWRvIHBvcicsXG4gICAgICBWYWxvcjogKGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSkpIHx8ICcoZGVzY29ub2NpZG8pJyxcbiAgICB9LFxuICBdO1xuICBjb25zdCB3c0kgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoaW5mb1Jvd3MpO1xuICB3c0lbJyFjb2xzJ10gPSBbeyB3Y2g6IDM2IH0sIHsgd2NoOiAzNiB9XTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NJLCAnSW5mbycpO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdQcmVjaW9zX3lfU3RvY2tfJyArIHRzICsgJy54bHN4Jyk7XG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKHByZWNpb3MgKyBzdG9jayknKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIC0gZGlhbG9nbyBkZSBzZWxlY2Npb24gKyAzIGZvcm1hdG9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBvcGNpb25lcyBzZWd1biByb2wuXG4gIC8vICAgdmVuZGVkb3I6IG9wZXJhdGl2byBkaWFyaW8gKFZlbnRhcyAvIFZpc2l0YXMgLyBSdXRhcykgKyBDbGllbnRlcyBkZSBzdSB6b25hXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxuICAvLyAgIGludGVybm8gKFZESSk6IG1pc21vIHNjb3BlIG9wZXJhdGl2byArIENsaWVudGVzIGRlIHN1cyBwYXJlamFzIChvIHNvbG8gZWxcbiAgLy8gICAgIHByb3BpbyBzaSBlbGlnaW8gc3Ugbm9tYnJlIGVuIGVsIGRyb3Bkb3duIGRlIHpvbmFzKS5cbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cbiAgY29uc3QgYWxsb3dlZEJ5Um9sZSA9IHtcbiAgICAvLyB2NzA5ICgyMDI2LTA4LTI4KTogYWdyZWdhciBCQUNLT1JERVIsIFNUT0NLX0FTSUcsIFBFRElET1NfTUVTLlxuICAgIHZlbmRlZG9yOiBuZXcgU2V0KFtcbiAgICAgICdWRU5UQVMnLFxuICAgICAgJ1ZJU0lUQVMnLFxuICAgICAgJ1JVVEFTJyxcbiAgICAgICdNQVNURVInLFxuICAgICAgJ0JBQ0tPUkRFUicsXG4gICAgICAnU1RPQ0tfQVNJRycsXG4gICAgICAnUEVESURPU19NRVMnLFxuICAgIF0pLFxuICAgIGludGVybm86IG5ldyBTZXQoW1xuICAgICAgJ1ZFTlRBUycsXG4gICAgICAnVklTSVRBUycsXG4gICAgICAnUlVUQVMnLFxuICAgICAgJ01BU1RFUicsXG4gICAgICAnQkFDS09SREVSJyxcbiAgICAgICdTVE9DS19BU0lHJyxcbiAgICAgICdQRURJRE9TX01FUycsXG4gICAgXSksXG4gIH07XG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2V4cG9ydC1tb2RhbCAuZXhwLW9wdCcpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2luZCA9IGVsLmRhdGFzZXQuZXhwS2luZCB8fCAnJztcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCkgPyAnJyA6ICdub25lJztcbiAgfSk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmxldCBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XG4gIFZFTlRBUzogJ1ZlbnRhcycsXG4gIFZJU0lUQVM6ICdWaXNpdGFzJyxcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXG4gIFJVVEFTOiAnUnV0YXMnLFxuICBBTFRBUzogJ0FsdGFzIGRlIGNsaWVudGVzJyxcbiAgQkFDS09SREVSOiAnQmFja29yZGVyJyxcbiAgU1RPQ0tfQVNJRzogJ1N0b2NrIEFzaWduYWRvJyxcbiAgUEVESURPU19NRVM6ICdQZWRpZG9zIGRlbCBtZXMnLFxufTtcblxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uICh0aXBvKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXRpdGxlJyk7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcbiAgc3VidC50ZXh0Q29udGVudCA9ICdFbGVnaSBlbCBtZXMgeSBhXHUwMEYxbyBxdWUgcXVlcmVzIGRlc2Nhcmdhci4nO1xuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1lc1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKTtcbiAgbWVzU2VsLmlubmVySFRNTCA9XG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xuICBsZXQgeW9wdHMgPSAnJztcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXG4gICAgeW9wdHMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgeSArICdcIj4nICsgeSArICc8L29wdGlvbj4nO1xuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG59O1xuXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB0aXBvID0gcGVuZGluZ0V4cG9ydFR5cGU7XG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcbiAgY29uc3QgbW9udGhJZHggPSBtZXNSYXcgPT09ICdBTEwnID8gbnVsbCA6IHBhcnNlSW50KG1lc1JhdywgMTApO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG4gIGlmICghdGlwbykgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWSVNJVEFTJykgZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQUxUQVMnKSBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQkFDS09SREVSJykgZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdTVE9DS19BU0lHJykgZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdQRURJRE9TX01FUycpIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0ICcgKyB0aXBvLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGV4cG9ydDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkge1xuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkgcmV0dXJuIFN0cmluZyhhbmlvKTtcbiAgcmV0dXJuIE1FU0VTW21vbnRoSWR4XSArICdfJyArIGFuaW87XG59XG5cbmZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzKSB7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXG4gICAgICBzLnJvd3MubGVuZ3RoID8gcy5yb3dzIDogW3sgQXZpc286ICdTaW4gZGF0b3MgcGFyYSBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkbycgfV1cbiAgICApO1xuICAgIGlmIChzLnJvd3MubGVuZ3RoKSB7XG4gICAgICBjb25zdCBjb2xzID0gT2JqZWN0LmtleXMocy5yb3dzWzBdKS5tYXAoKGspID0+ICh7XG4gICAgICAgIHdjaDogTWF0aC5taW4oNDAsIE1hdGgubWF4KDEwLCBrLmxlbmd0aCArIDQpKSxcbiAgICAgIH0pKTtcbiAgICAgIHdzWychY29scyddID0gY29scztcbiAgICB9XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsIHMubmFtZS5zbGljZSgwLCAzMSkpO1xuICB9XG4gIFhMU1gud3JpdGVGaWxlKHdiLCBmaWxlbmFtZSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldE1lcyA9IG1vbnRoSWR4ICE9PSBudWxsID8gTUVTRVNbbW9udGhJZHhdLnRvVXBwZXJDYXNlKCkgOiBudWxsO1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xuICAgIGl0ZW1zLnB1c2godik7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMgeSBDb250YWN0b3MnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnQW5pbycsIGtleTogJ2FuaW8nLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnSW50ZXJhY2Npb24nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnRm9ybWEgQ29udGFjdG8nLCBrZXk6ICdmb3JtYUNvbnRhY3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdSZXN1bHRhZG8gQ29udGFjdG8nLCBrZXk6ICdyZXN1bHRhZG9DdCcsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnUHJvdmluY2lhJywga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRmlkZWxpZGFkJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdOZWNlc2lkYWQgUHVudHVhbCcsIGtleTogJ25lYycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBWZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBQcmVndW50YW4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnQXl1ZGEgVGllbmRhJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gVmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgTW9zdHJhZG9yJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywga2V5OiAncEVjb20nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBTdGF0dXMnLCBrZXk6ICdncHNTdCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnR1BTIERpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFbiBub21icmUgZGUgVkRFJywga2V5OiAnb25CZWhhbGYnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NhcmdhZG8gUG9yJywga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcbiAgY29uc3QgUk9XX0ggPSAxMDA7XG4gIGNvbnN0IElNR19XID0gMTMwO1xuICBjb25zdCBJTUdfSCA9IDkwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XG4gICAgaWYgKGlzQ29udGFjdG8pIHtcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcbiAgICB9XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcbiAgICAgIGFuaW86IHYuYW5pbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcbiAgICAgIGZvcm1hQ29udGFjdG86IGZvcm1hQ29udGFjdG9MYmwsXG4gICAgICByZXN1bHRhZG9DdDogcmVzdWx0YWRvQ3RMYmwsXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgbmVjOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxuICAgICAgZ3BzU3Q6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdi5ncHNEaXN0YW5jZU0gIT0gbnVsbCA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXG4gICAgICBvbkJlaGFsZjogdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICBjcmVhdGVkQnk6IHYuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgdi5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdDb25jZXB0bycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdOIFRpY2tldCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnTW9kbyBwYWdvJywga2V5OiAnbW9kb1BhZ28nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gZ2FzdG8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0RpdmlzaW9uJywga2V5OiAnZGl2aXNpb24nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNb25lZGEnLCBrZXk6ICdtb25lZGEnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUgVVNEJywga2V5OiAnaW1wb3J0ZVVzZCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byB0aWNrZXQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFc3RhZG8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvcicsIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG8gZW4nLCBrZXk6ICdhcHJvYmFkb0VuJywgd2lkdGg6IDE0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcbiAgY29uc3QgUk9XX0ggPSAxMTA7XG4gIGNvbnN0IElNR19XID0gMTQwO1xuICBjb25zdCBJTUdfSCA9IDEwMDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgciA9IGl0LnI7XG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XG4gICAgY29uc3Qgb2JzU3RyID1cbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBlbWFpbDogci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxuICAgICAgbW9kb1BhZ286IHIubW9kb1BhZ28gfHwgJycsXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxuICAgICAgZGl2aXNpb246IHIuZGl2aXNpb25HYXN0byB8fCAnJyxcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXG4gICAgICBtb25lZGE6IHIubW9uZWRhIHx8ICdQRVNPUycsXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcbiAgICAgIG9iczogb2JzU3RyLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcbiAgICAgIGFwcm9iYWRvcjogci5hcHByb3ZlckVtYWlsIHx8IHIuYXByb2JhZG9yIHx8ICcnLFxuICAgICAgYXByb2JhZG9FbjpcbiAgICAgICAgci5hcHByb3ZlZEF0ICYmIHIuYXBwcm92ZWRBdC50b0RhdGUgPyByLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIC8vIEVtYmViZXIgZm90byBkZWwgdGlja2V0IHNpIGV4aXN0ZS4gdjMwOCs6IHByZWZlcmlyIGJhc2U2NCBlbWJlYmlkb1xuICAgIC8vIChmb3RvVGlja2V0IC8gYWRqdW50bykgcG9yIGNvbXBhdCwgc2lubyB1c2FyIGZvdG9UaWNrZXRVcmwgY29tbyBIWVBFUkxJTksuXG4gICAgLy8gQSBuaXZlbCBFeGNlbCB1biBkYXRhVVJMIGJhc2U2NCBzZSBwdWVkZSBpbnNlcnRhciBjb21vIGltYWdlbiBpbmxpbmUsXG4gICAgLy8gbWllbnRyYXMgcXVlIHVuYSBVUkwgZGUgU3RvcmFnZSBzZSBhZ3JlZ2EgY29tbyBsaW5rIGNsaWNrZWFibGUgKGVsXG4gICAgLy8gdXN1YXJpbyBhYnJlIGVuIGVsIGJyb3dzZXIgc2luIG5lY2VzaWRhZCBkZSBxdWUgRXhjZWwgZGVzY2FyZ3VlKS5cbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIERvY3MgbnVldm9zICh2MzA4Kyk6IGZvdG8gZW4gU3RvcmFnZSwgaW5zZXJ0YW1vcyBjb21vIGh5cGVybGluay5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNlbGwgPSByb3cuZ2V0Q2VsbChGT1RPX0NPTF9JRFggKyAxKTtcbiAgICAgICAgY2VsbC52YWx1ZSA9IHtcbiAgICAgICAgICB0ZXh0OiAnQWJyaXIgdGlja2V0JyxcbiAgICAgICAgICBoeXBlcmxpbms6IHIuZm90b1RpY2tldFVybCxcbiAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXInLFxuICAgICAgICB9O1xuICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignaHlwZXJsaW5rIGZvdG8gcmVuZGljaW9uJywgaXQuaWQsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19SZW5kaWNpb25lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFJlbmRpY2lvbmVzIGxpc3RvICgnICsgaXRlbXMubGVuZ3RoICsgJyBmaWxhcyknLCAyNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSVVRBUzogcnV0YXMgYXNpZ25hZGFzIGRlbCBwZXJpb2RvICsgb3ZlcnJpZGVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUnV0YXMuLi4nKTtcbiAgLy8gTGFzIHJ1dGFzIHNlIGdlbmVyYW4gZW4gcnVudGltZSBwYXJhIGNhZGEgdmVuZGVkb3I7IGVuIGNhbWJpbyBsb3Mgb3ZlcnJpZGVzXG4gIC8vIChkZXJpdmFjaW9uZXMgLyByZWFnZW5kYXMpIHZpdmVuIGVuIHJvdXRlX292ZXJyaWRlcy4gRXhwb3J0YW1vczpcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxhcyBydXRhcyBwbGFuaWZpY2FkYXMgZGVsIHBlcmlvZG8gKHBhcmEgbG9zIHZlbmRlZG9yZXNcbiAgLy8gICAgZGVsIHJvbCBhY3R1YWwgbyB0b2RvcyBzaSBhZG1pbilcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxvcyBvdmVycmlkZXMgZGVsIHBlcmlvZG9cbiAgY29uc3QgdGFyZ2V0VmVuZG9ycyA9XG4gICAgdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICd2aWV3ZXInXG4gICAgICA/IFZFTkRPUlMubWFwKCh2KSA9PiB2LmtleSlcbiAgICAgIDogYXNzaWduZWRWZW5kb3JcbiAgICAgICAgPyBbYXNzaWduZWRWZW5kb3JdXG4gICAgICAgIDogW107XG4gIGNvbnN0IG1vbnRoc1RvRXhwb3J0ID0gbW9udGhJZHggIT09IG51bGwgPyBbbW9udGhJZHhdIDogWzAsIDEsIDIsIDMsIDQsIDUsIDYsIDcsIDgsIDksIDEwLCAxMV07XG4gIGNvbnN0IHJ1dGFzUm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IHZlbmQgb2YgdGFyZ2V0VmVuZG9ycykge1xuICAgIGZvciAoY29uc3QgbSBvZiBtb250aHNUb0V4cG9ydCkge1xuICAgICAgbGV0IHJ1dGFzO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcnV0YXMgPSBnZW5lcmFyUnV0YXNWZW5kb3IodmVuZCwgbSwgYW5pbyk7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICBydXRhcyA9IFtdO1xuICAgICAgfVxuICAgICAgKHJ1dGFzIHx8IFtdKS5mb3JFYWNoKChydXRhKSA9PiB7XG4gICAgICAgIChydXRhLnRpZW5kYXMgfHwgW10pLmZvckVhY2goKHQsIGkpID0+IHtcbiAgICAgICAgICBydXRhc1Jvd3MucHVzaCh7XG4gICAgICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmQpLFxuICAgICAgICAgICAgQW5pbzogYW5pbyxcbiAgICAgICAgICAgIE1lczogTUVTRVNbbV0sXG4gICAgICAgICAgICBSdXRhX0lEOiBydXRhLmlkIHx8ICcnLFxuICAgICAgICAgICAgUnV0YV9Ob21icmU6IHJ1dGEubm9tYnJlIHx8ICcnLFxuICAgICAgICAgICAgRmVjaGFfQXNpZ25hZGE6IHJ1dGEuZmVjaGFBc2lnbmFkYSB8fCAnJyxcbiAgICAgICAgICAgIE9yZGVuOiBpICsgMSxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHQucHJvdmluY2UgfHwgJycpLFxuICAgICAgICAgICAgTG9jYWxpZGFkOiB0LmxvY05hbWUgfHwgJycsXG4gICAgICAgICAgICBUaWVuZGE6IHQuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgICAgIFRpcG86IHQudGlwbyB8fCAnJyxcbiAgICAgICAgICAgIEVzdGFkbzogdC5lc3RhZG8gfHwgJycsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIC8vIE92ZXJyaWRlc1xuICBsZXQgb3ZyU25hcDtcbiAgdHJ5IHtcbiAgICBvdnJTbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb3V0ZV9vdmVycmlkZXMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBvdnJTbmFwID0gbnVsbDtcbiAgfVxuICBjb25zdCBvdmVycmlkZXNSb3dzID0gW107XG4gIGlmIChvdnJTbmFwKSB7XG4gICAgb3ZyU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBjb25zdCBvID0gZC5kYXRhKCkgfHwge307XG4gICAgICBpZiAocGFyc2VJbnQoby5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChvLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgICBvdmVycmlkZXNSb3dzLnB1c2goe1xuICAgICAgICBBbmlvOiBvLmFuaW8gfHwgJycsXG4gICAgICAgIE1lczogTUVTRVNbcGFyc2VJbnQoby5tb250aElkeCwgMTApXSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZShvLnZlbmRvciB8fCAnJyksXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKG8ucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IG8ubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgVGllbmRhOiBvLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIEFjY2lvbjogby5hY3Rpb24gfHwgby50aXBvIHx8ICcnLFxuICAgICAgICBEZXJpdmFkYV9BOiBvLmRlcml2YWRhQSB8fCAnJyxcbiAgICAgICAgUmVhZ2VuZGFkYV9QYXJhOiBvLnJlYWdlbmRhZGFQYXJhIHx8ICcnLFxuICAgICAgICBNb3Rpdm86IG8ubW90aXZvIHx8ICcnLFxuICAgICAgICBDcmVhZG9fUG9yOiBvLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgICBDcmVhZG9fRW46XG4gICAgICAgICAgby5jcmVhdGVkQXQgJiYgby5jcmVhdGVkQXQudG9EYXRlID8gby5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUnV0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1J1dGFzIHBsYW5pZmljYWRhcycsIHJvd3M6IHJ1dGFzUm93cyB9LFxuICAgIHsgbmFtZTogJ0Rlcml2YWNpb25lcy1SZWFnZW5kYXMnLCByb3dzOiBvdmVycmlkZXNSb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IFJ1dGFzIGxpc3RvICgnICsgcnV0YXNSb3dzLmxlbmd0aCArICcgdGllbmRhcywgJyArIG92ZXJyaWRlc1Jvd3MubGVuZ3RoICsgJyBvdmVycmlkZXMpJyxcbiAgICAyNDAwXG4gICk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQUxUQVM6IHNvbGljaXR1ZGVzIGRlIGFsdGEgZGUgY2xpZW50ZSBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEFsdGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9ICcnO1xuICAgIGlmIChhLmNyZWF0ZWRBdCAmJiBhLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gYS5jcmVhdGVkQXQudG9EYXRlKCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGlmIChkdC5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGR0LmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1NvbGljaXR1ZDogZHQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXG4gICAgICBFc3RhZG86IGEuc3RhdHVzIHx8ICcnLFxuICAgICAgQ29tZXJjaW86IGEuY29tZXJjaW8gfHwgJycsXG4gICAgICBGYW50YXNpYTogYS5mYW50YXNpYSB8fCAnJyxcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcbiAgICAgIENvbmRpY2lvbl9GaXNjYWw6IGEuY29uZEZpc2NhbCB8fCAnJyxcbiAgICAgIENhbGxlOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTnVtZXJvOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYS5sb2NhbGlkYWQgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGEucHJvdmluY2lhIHx8ICcnLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICBUZWxlZm9ubzogYS50ZWxlZm9ubyB8fCAnJyxcbiAgICAgIEVtYWlsOiBhLmVtYWlsIHx8ICcnLFxuICAgICAgVmVuZGVkb3JfU29saWNpdGFudGU6IGEudmVuZG9yTmFtZSB8fCBhLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBPd25lcl9FbWFpbDogYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgU3VibWl0dGVkX0J5X1B1YmxpY19Gb3JtOiBhLnN1Ym1pdHRlZEJ5UHVibGljRm9ybSA/ICdTSScgOiAnTk8nLFxuICAgICAgQXByb2JhZG9fUG9yOiBhLmFwcHJvdmVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIEFwcm9iYWRvX0VuOlxuICAgICAgICBhLmFwcHJvdmVkQXQgJiYgYS5hcHByb3ZlZEF0LnRvRGF0ZSA/IGEuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgUmVjaGF6YWRvX01vdGl2bzogYS5yZWplY3RlZFJlYXNvbiB8fCAnJyxcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQWx0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0FsdGFzIGRlIGNsaWVudGVzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQWx0YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgc29saWNpdHVkZXMpJywgMjQwMCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gdjcwOSAoMjAyNi0wOC0yOCk6IDMgZXhwb3J0cyBudWV2b3MgcGVkaWRvcyBwb3IgTWFyaWFuby5cbi8vIC0gQkFDS09SREVSOiBsaW5lYXMgc3RhdGU9Qk8gb3BlbiBwb3IgbWVzIGRlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLlxuLy8gLSBTVE9DS19BU0lHOiBsaW5lYXMgQVNJRyBvcGVuIChvIEJPK3N0b2NrIGRpc3ApIHBvciBtZXMgZGUgY3JlYXRlZEF0LlxuLy8gLSBQRURJRE9TX01FUzogVE9ET1MgbG9zIHBlZGlkb3MgY3JlYWRvcyBlbiBlbCBtZXMvYW5pbyAoY3VhbHF1aWVyIHN0YWdlKS5cbi8vIEZ1ZW50ZTogZ2xvYmFsUGVkaWRvcyAobG8gcXVlIGxhIGFwcCB5YSB0aWVuZSBlbiBtZW1vcmlhKS5cbi8vIEZpbHRlciBtZXMvYVx1MDBGMW86IHNvYnJlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLiBtb250aElkeD1udWxsIC0+IGFcdTAwRjFvIGVudGVyby5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuZnVuY3Rpb24gX3BlZGlkb01vbnRoWWVhcihwKSB7XG4gIGNvbnN0IGNhID0gcC5jcmVhdGVkQXQ7XG4gIGlmICghY2EpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgbGV0IGR0ID0gbnVsbDtcbiAgaWYgKHR5cGVvZiBjYSA9PT0gJ3N0cmluZycpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBlbHNlIGlmICh0eXBlb2YgY2EudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGR0ID0gY2EudG9EYXRlKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhID09PSAnbnVtYmVyJykgZHQgPSBuZXcgRGF0ZShjYSk7XG4gIGlmICghZHQgfHwgTnVtYmVyLmlzTmFOKGR0LmdldFRpbWUoKSkpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgcmV0dXJuIHsgeTogZHQuZ2V0RnVsbFllYXIoKSwgbTogZHQuZ2V0TW9udGgoKSB9O1xufVxuXG5mdW5jdGlvbiBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpIHtcbiAgY29uc3QgYXJyID1cbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgcmV0dXJuIGFyci5maWx0ZXIoKHApID0+IHtcbiAgICBpZiAoIXApIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCB7IHksIG0gfSA9IF9wZWRpZG9Nb250aFllYXIocCk7XG4gICAgaWYgKHkgPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh5ICE9PSBhbmlvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIG0gIT09IG1vbnRoSWR4KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIuLi4nKTtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcbiAgICBpZiAocC5jbG9zZWRBdCkgY29udGludWU7XG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xuICAgICAgaWYgKCFsIHx8IGwuc3RhdGUgIT09ICdCTycpIHJldHVybjtcbiAgICAgIGNvbnN0IHFvID0gTnVtYmVyKGwucXR5T3BlbikgfHwgMDtcbiAgICAgIGlmIChxbyA8PSAwKSByZXR1cm47XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBGZWNoYV9QZWRpZG86IHAuY3JlYXRlZEF0XG4gICAgICAgICAgPyAodHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXG4gICAgICAgICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDEwKSlcbiAgICAgICAgICA6ICcnLFxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogcC5jbGllbnRQcm92aW5jZSB8fCAnJyxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmNsaWVudExvY2FsaXR5IHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogcC52ZW5kZWRvciB8fCBwLnZlbmRvckFzc2lnbmVkIHx8ICcnLFxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXG4gICAgICAgIENhbnRpZGFkX1BlZGlkYTogTnVtYmVyKGwucXR5KSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSxcbiAgICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSB8fCAwKSksXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkby4uLicpO1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCBnZXRTdGsgPVxuICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcbiAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXG4gICAgICA6IG51bGw7XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSB7XG4gICAgaWYgKHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcbiAgICAgIGlmICghbCkgcmV0dXJuO1xuICAgICAgY29uc3QgcW8gPSBOdW1iZXIobC5xdHlPcGVuKSB8fCAwO1xuICAgICAgaWYgKHFvIDw9IDApIHJldHVybjtcbiAgICAgIGxldCB2aXJ0dWFsID0gZmFsc2U7XG4gICAgICBpZiAobC5zdGF0ZSA9PT0gJ0FTSUcnKSB7XG4gICAgICAgIC8vIG9rIHJlc2VydmEgZmlybWVcbiAgICAgIH0gZWxzZSBpZiAobC5zdGF0ZSA9PT0gJ0JPJykge1xuICAgICAgICAvLyB2aXJ0dWFsIHNvbG8gc2kgaGF5IHN0b2NrIGRpc3BcbiAgICAgICAgaWYgKCFnZXRTdGspIHJldHVybjtcbiAgICAgICAgY29uc3Qgc3RrID0gZ2V0U3RrKGwuY29kZSkgfHwgMDtcbiAgICAgICAgaWYgKHN0ayA8PSAwKSByZXR1cm47XG4gICAgICAgIHZpcnR1YWwgPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBwLmNyZWF0ZWRBdFxuICAgICAgICAgID8gKHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcbiAgICAgICAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxuICAgICAgICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCAxMCkpXG4gICAgICAgICAgOiAnJyxcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IHAuY2xpZW50UHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogcC5jbGllbnRMb2NhbGl0eSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHAudmVuZGVkb3IgfHwgcC52ZW5kb3JBc3NpZ25lZCB8fCAnJyxcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxuICAgICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHFvLFxuICAgICAgICBFc3RhZG9fUmVhbDogdmlydHVhbCA/ICdCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRyknIDogJ0FTSUcnLFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSxcbiAgICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChcbiAgICAgICAgICBxbyAqIChOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCkgfHwgMClcbiAgICAgICAgKSxcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBQZWRpZG9zIGRlbCBtZXMuLi4nKTtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcbiAgICAgID8gKHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcbiAgICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICAgICAgLnNsaWNlKDAsIDEwKSlcbiAgICAgIDogJyc7XG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XG4gICAgICBpZiAoIWwpIHJldHVybjtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKTtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGEsXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogcC5jbGllbnRQcm92aW5jZSB8fCAnJyxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmNsaWVudExvY2FsaXR5IHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogcC52ZW5kZWRvciB8fCBwLnZlbmRvckFzc2lnbmVkIHx8ICcnLFxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXG4gICAgICAgIENhbnRpZGFkOiBxdHksXG4gICAgICAgIENhbnRpZGFkX09wZW46IE51bWJlcihsLnF0eU9wZW4pIHx8IDAsXG4gICAgICAgIENhbnRpZGFkX0ludm9pY2VkOiBOdW1iZXIobC5xdHlJbnZvaWNlZCkgfHwgMCxcbiAgICAgICAgQ2FudGlkYWRfQ2FuY2VsbGVkOiBOdW1iZXIobC5xdHlDYW5jZWxsZWQpIHx8IDAsXG4gICAgICAgIEVzdGFkb19MaW5lYTogbC5zdGF0ZSB8fCAnJyxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChxdHkgKiBwcmVjaW8pLFxuICAgICAgICBDZXJyYWRvOiBwLmNsb3NlZEF0ID8gJ1NJJyA6ICdOTycsXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkZlY2hhX1BlZGlkbyB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhX1BlZGlkbyB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1BlZGlkb3NEZWxNZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1BlZGlkb3MnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBQZWRpZG9zIGRlbCBtZXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG4vLyBFeHBvcnRhciBwYXJhIEFuYWxpc2lzOiBwcm90ZWdpZG8gY29uIFBJTlxuY29uc3QgQU5BTElTSVNfUElOID0gJzEyMzUnO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQgRXhjZWwgVEFSR0VUUy1aT05BUyAtIHNvbG8gY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSBsYSBob2phIENMSUVOVEVTX1pPTkFTIGNvbiBVTkEgZmlsYSBwb3IgQlAgcXVlIGVzdGEgdml2byBlbiBTQVA6XG4vLyBjdWFscXVpZXIgYWx0YSBkZSBjbGllbnRfYXBwbGljYXRpb25zIGNvbiBzdGF0dXM9J2FwcHJvdmVkJyBZIGNhcmRDb2RlU2FwXG4vLyBhc2lnbmFkby4gRXhjbHV5ZSBQT0lOVFMgLyBkaXN0cmlidWlkb3JlcyAvIHByb3NwZWN0b3MgLyBhbHRhcyBzaW5cbi8vIENhcmRDb2RlIChtb2NrcyBvIHBlbmRpZW50ZXMgZGUgU0FQKS4gRXMgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgZmFjdHVyYS5cbi8vIENvbHVtbmFzOiBUSVBPLCBOUk8gQ1RFLCBSRUdJT04sIFBST1ZJTkNJQSwgQVNFU09SIEVYVEVSTk8sIEFTRVNPUiBJTlRFUk5PLFxuLy8gQ0FMTEUsIE5VTUVSTywgTE9DQUxJREFELCBDUCwgTk9NQlJFIENPTUVSQ0lBTCwgTk9NQlJFIERFIEZBTlRBU0lBLCBDVUlULFxuLy8gQ09ORElDSU9OIEZJU0NBTCwgVEVMRUZPTk8sIENBUkRDT0RFIFNBUC5cbndpbmRvdy5leHBvcnRUYXJnZXRzWm9uYXMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaWNcdTAwRTEgdHUgY29uZXhpXHUwMEYzbiB5IHJlaW50ZW50XHUwMEUxLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBleHBvcnRhciBlbCBtYXN0ZXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgVEFSR0VUUy1aT05BUy4uLicpO1xuICBjb25zdCBWREVfVE9fVkRJID0ge1xuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICAgICdNQVJUSU4gQk9JRVJPJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ05FQSc7XG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xuICAgIHJldHVybiAnJztcbiAgfVxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xuICAgIHJldHVybiBrZXk7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBsZXQgYWx0YXNTbmFwO1xuICB0cnkge1xuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcbiAgICAgIC5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXG4gICAgaWYgKCFjYXJkQ29kZSkge1xuICAgICAgc2tpcHBlZE5vU2FwKys7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xuICB9KTtcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgclsnTlJPIENURSddID0gaSArIDE7XG4gIH0pO1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XG4gIHdzWychY29scyddID0gW1xuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiAxNiB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAyOCB9LFxuICAgIHsgd2NoOiAyOCB9LFxuICAgIHsgd2NoOiAyOCB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiAzOCB9LFxuICAgIHsgd2NoOiAzMiB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAyNCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICBdO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0NMSUVOVEVTX1pPTkFTJyk7XG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdUQVJHRVRTX1ZFTkRFRE9SRVNfWk9OQVNfJyArIHRzICsgJy54bHN4Jyk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeGNlbCBleHBvcnRhZG86ICcgK1xuICAgICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcbiAgICAgIChza2lwcGVkTm9TYXAgPiAwID8gJyAoJyArIHNraXBwZWROb1NhcCArICcgc2luIENhcmRDb2RlIGRlc2NhcnRhZG9zKScgOiAnJylcbiAgKTtcbn07XG5cbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwaW4gPSBwcm9tcHQoXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xuICApO1xuICBpZiAocGluID09PSBudWxsKSByZXR1cm47XG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxuICBjb25zdCBzYXBPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1zYXAtaW50ZWdyYXRpb24nKTtcbiAgaWYgKHNhcE9wdCkge1xuICAgIGNvbnN0IGlzTWFyaWFubyA9XG4gICAgICBjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSc7XG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPcGNpb24gQmFja3VwIG1lbnN1YWw6IHNvbG8gYWRtaW5cbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWdCQSxTQUFPLHVCQUF1QixXQUFZO0FBQ3hDLFFBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsWUFBTSxpRkFBaUY7QUFDdkY7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLFFBQVE7QUFDN0IsWUFBTSxnQ0FBZ0M7QUFDdEM7QUFBQSxJQUNGO0FBQ0EsZ0JBQVkscUNBQXFDO0FBUWpELFVBQU0sV0FDSixPQUFPLDBCQUEwQixhQUM3QixzQkFBc0IsT0FBTyxrQkFBa0IsY0FBYyxnQkFBZ0IsS0FBSyxJQUNsRjtBQUNOLFVBQU0sVUFBVSxDQUFDLGNBQWM7QUFDN0IsVUFBSSxhQUFhLEtBQU0sUUFBTztBQUM5QixVQUFJLENBQUMsVUFBVyxRQUFPO0FBQ3ZCLGFBQU8sU0FBUyxJQUFJLFNBQVM7QUFBQSxJQUMvQjtBQU1BLFVBQU0sYUFBYTtBQUFBLE1BQ2pCLHlCQUF5QjtBQUFBLE1BQ3pCLHNCQUFzQjtBQUFBLE1BQ3RCLGdCQUFnQjtBQUFBLE1BQ2hCLGlCQUFpQjtBQUFBLElBQ25CO0FBQ0EsYUFBUyxXQUFX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QUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssRUFBRTtBQUFBO0FBQUEsTUFDVCxFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUE7QUFBQSxNQUVWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxFQUFFO0FBQUE7QUFBQSxNQUNULEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVB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
