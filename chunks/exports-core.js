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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xyXG4vLyBFWFBPUlRTLUNPUkU6IG1hc3RlcmZpbGUgY2xpZW50ZXMgKyBwcmVjaW9zL3N0b2NrICsgbW9kYWwgZGUgZXhwb3J0YXIgK1xyXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxyXG4vLyBGcmFnbWVudG9zIHJlc3RhbnRlcyBkZWwgZG9taW5pbyBleHBvcnRzOiBhZHZhbmNlZCAofjEwMzAyLTExNDUxKSB5IFNBUFxyXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgTUFTVEVSRklMRSBERSBDTElFTlRFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxyXG4vLyBub21icmUsIHRpcG8gKGNsaWVudGUvcHJvc3BlY3RvKSwgem9uYSBkZWwgdmVuZGVkb3IsIGFzZXNvciBleHRlcm5vLCBhc2Vzb3JcclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxyXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxyXG4vLyBjb29yZGVuYWRhcyBnZW9jb2RpZmljYWRhcywgZXN0YWRvIChIYWJpbGl0YWRvL1BlbmRpZW50ZS9DYW5jZWxhZG8pLFxyXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cclxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xyXG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcclxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXHJcbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxyXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcclxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xyXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxyXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cclxuICBjb25zdCBzY29wZVNldCA9XHJcbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcclxuICAgICAgOiBudWxsO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XHJcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcclxuICB9O1xyXG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcclxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cclxuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXHJcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXHJcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICB9O1xyXG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XHJcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcclxuICAgIHJldHVybiB2ID8gdi56b25lIDogJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xyXG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XHJcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XHJcbiAgfVxyXG5cclxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcclxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXHJcbiAgLy8gZXNwZWNpYWxpemFjaW9uL2NhbmFsQ29tcHJhL3BvcC90aXBvVmVudGEvZXRjLikgZGVsIGZvcm11bGFyaW8gZGVcclxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXHJcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cclxuICAvLyB2ZSBsYSBjbGFzaWZpY2FjaW9uIG1hcyBhY3R1YWxpemFkYSwgcGVybyBzaSBlbCB1bHRpbW8gY29udGFjdG8gbm8gbGxlbmFcclxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcclxuICAvLyBpbnRlcmFjY2lvbiBwZXJvIG5vIHBlcmRlciBpbmZvIHV0aWwgZGUgbGFzIGFudGVyaW9yZXNcIi5cclxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcclxuICAgICd0aXBvJyxcclxuICAgICdsb2NhbCcsXHJcbiAgICAndGFtYW5vJyxcclxuICAgICdmaWRlbGlkYWQnLFxyXG4gICAgJ2VzcGVjaWFsaXphY2lvbicsXHJcbiAgICAnY2FuYWxDb21wcmEnLFxyXG4gICAgJ3JlbGV2YW5jaWEnLFxyXG4gICAgJ3BvcCcsXHJcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXHJcbiAgICAndGlwb1ZlbnRhJyxcclxuICAgICdwb25kZXJhY2lvbk1vc3RyYWRvJyxcclxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXHJcbiAgICAnY29tcGV0ZW5jaWEnLFxyXG4gICAgJ29wb3J0dW5pZGFkJyxcclxuICAgICdtYXNWZW5kaWRvJyxcclxuICAgICdtYXNQcmVndW50YW4nLFxyXG4gICAgJ2F5dWRhVGllbmRhJyxcclxuICBdO1xyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXHJcbiAgICAgICd8JyArXHJcbiAgICAgIChsb2MgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpICtcclxuICAgICAgJ3wnICtcclxuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcclxuICAgICk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xyXG4gICAgaWYgKHYgJiYgdi5jcmVhdGVkQXQgJiYgdi5jcmVhdGVkQXQudG9NaWxsaXMpIHJldHVybiB2LmNyZWF0ZWRBdC50b01pbGxpcygpO1xyXG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xyXG4gICAgcmV0dXJuIDA7XHJcbiAgfVxyXG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XHJcbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcclxuICAgIGNvbnN0IGJ5S2V5ID0gbmV3IE1hcCgpO1xyXG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgICBpZiAoIXYpIHJldHVybjtcclxuICAgICAgY29uc3QgayA9IF9jbGFzc2lmS2V5KHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcclxuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XHJcbiAgICB9KTtcclxuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xyXG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxyXG4gICAgICBjb25zdCBtZXJnZWQgPSB7fTtcclxuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcclxuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgICBpZiAobWVyZ2VkW2ZdICE9IG51bGwgJiYgbWVyZ2VkW2ZdICE9PSAnJyAmJiBtZXJnZWRbZl0gIT09IDApIHJldHVybjtcclxuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XHJcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xyXG4gICAgICBjbGFzc2lmSW5kZXguc2V0KGssIHtcclxuICAgICAgICBtZXJnZWQsXHJcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXHJcbiAgICAgICAgbGFzdFR5cGU6IGxhdGVzdC5pbnRlcmFjdGlvblR5cGUgfHwgKGxhdGVzdC5lc3BhY2lvID8gJ3Zpc2l0YScgOiAnJyksXHJcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcclxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmUm93KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcclxuICAgIGlmICghZW50cnkpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RvdGFsIHZpc2l0YXMnOiAwLFxyXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxyXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXHJcbiAgICAgICAgTG9jYWw6ICcnLFxyXG4gICAgICAgIFRhbWFubzogJycsXHJcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcclxuICAgICAgICBFc3BlY2lhbGl6YWNpb246ICcnLFxyXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcclxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcclxuICAgICAgICBQT1A6ICcnLFxyXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxyXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXHJcbiAgICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAnJyxcclxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcclxuICAgICAgICBDb21wZXRlbmNpYTogJycsXHJcbiAgICAgICAgT3BvcnR1bmlkYWQ6ICcnLFxyXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxyXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXHJcbiAgICAgICAgJ0F5dWRhIHRpZW5kYSc6ICcnLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgY29uc3QgbSA9IGVudHJ5Lm1lcmdlZCB8fCB7fTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXHJcbiAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RUeXBlLFxyXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXHJcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXHJcbiAgICAgICdUaXBvIGNvbWVyY2lvJzogbS50aXBvIHx8ICcnLFxyXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcclxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcclxuICAgICAgRmlkZWxpZGFkOiBtLmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcclxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXHJcbiAgICAgIFJlbGV2YW5jaWE6IG0ucmVsZXZhbmNpYSAhPSBudWxsID8gbS5yZWxldmFuY2lhIDogJycsXHJcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXHJcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcclxuICAgICAgJ1RpcG8gZGUgdmVudGEnOiBtLnRpcG9WZW50YSB8fCAnJyxcclxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxyXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXHJcbiAgICAgIENvbXBldGVuY2lhOiBtLmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgICAnTWFzIHByZWd1bnRhbic6IG0ubWFzUHJlZ3VudGFuIHx8ICcnLFxyXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXHJcbiAgLy8gdGllbmVuIGNhcmRDb2RlICsgZGlyZWNjaW9uLiBFc29zIHNvbiBsb3MgcXVlIGFwYXJlY2VuIGNvbW8gdmVyZGVzIGVuXHJcbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcclxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXHJcbiAgLy8gcmVhbCBvcGVyYWJsZSBob3kuXHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCBwcm92aW5jZSA9IHAucHJvdmluY2UgfHwgJyc7XHJcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcclxuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBwLnZlbmRvciB8fCAnJztcclxuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cclxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XHJcbiAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xyXG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XHJcbiAgICBjb25zdCBsb24gPSBwLmxvbiAhPSBudWxsID8gcC5sb24gOiAnJztcclxuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cclxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxyXG4gICAgKHAuY2xpZW50cyB8fCBbXSkuZm9yRWFjaCgobmFtZSkgPT4ge1xyXG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcclxuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XHJcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXHJcbiAgICAgIGxldCBlc3RhZG8gPSAnSGFiaWxpdGFkbyc7IC8vIHBvciBkZWZpbmljaW9uIHlhIGVzdGEgU0FQLWNvbmZpcm1hZG9cclxuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcclxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcclxuICAgICAgLy8gTWV0YWRhdGEgY3VzdG9tIChkaXJlY2Npb24sIGxvY2FsaWRhZCBkZWNsYXJhZGEsIGdlb2NvZGUpLlxyXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XHJcbiAgICAgIC8vIEJ1c2NhciBhZGRyZXNzOiAxKSBjbGllbnRfbWFzdGVyLmFkZHJlc3MgKGFkbWluKSwgMikgY2xpZW50TWV0YS5hZGRyZXNzICh2ZW5kb3IpLlxyXG4gICAgICBjb25zdCBkb2NJZCA9XHJcbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xyXG4gICAgICBjb25zdCBjbURhdGEgPVxyXG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGxvY2FsaXR5Q3VzdCA9IGNtRGF0YS5sb2NhbGlkYWQgfHwgbWV0YS5sb2NhbGl0eSB8fCAnJztcclxuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XHJcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xyXG4gICAgICAvLyBDYXJkQ29kZSBTQVAgKGRlIGNsaWVudF9tYXN0ZXIgbyBkZSBsYSBhbHRhIHZpbmN1bGFkYSkuXHJcbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcclxuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xyXG4gICAgICAgIGNvbnN0IGtleSA9IHByb3ZpbmNlLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBsb2NhbGl0eU1hcDtcclxuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcclxuICAgICAgICBpZiAoYWx0YU1hdGNoKSBjYXJkQ29kZSA9IGFsdGFNYXRjaC5jYXJkQ29kZVNhcCB8fCAnJztcclxuICAgICAgfVxyXG4gICAgICByb3dzLnB1c2goXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGNhcmRDb2RlLFxyXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXHJcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcclxuICAgICAgICAgICAgVGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXHJcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2NhbGl0eU1hcCxcclxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxyXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcclxuICAgICAgICAgICAgWm9uYTogem9uZSxcclxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxyXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXHJcbiAgICAgICAgICAgIERpcmVjY2lvbjogYWRkcmVzcyxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXHJcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcclxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBjdXN0b21MbmcgfHwgbG9uLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSlcclxuICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuICAvLyBJbnllY3RhciBhbHRhcyBkZSBjbGllbnRfYXBwbGljYXRpb25zIChhcHByb3ZlZEFsdGFzTGlzdCk6XHJcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cclxuICAvLyAgICogUFJPVklTT1JJT1MgKHYzMTErKTogbWFudWFsU2FwUGVuZGluZyAmJiAhY2FyZENvZGVTYXAgKEFsdGEgUmFwaWRhXHJcbiAgLy8gICAgIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuIFZhbiBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy4gU2VcclxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXHJcbiAgLy8gICAgIHF1ZSBlbCBnZXJlbnRlIGVzdGEgZ2VzdGlvbmFuZG8sIG5vIHNvbG8gbG9zIGNlcnJhZG9zIGVuIFNBUC5cclxuICAvLyAgICAgTG9zIHByb3Zpc29yaW9zIHB1ZWRlbiBubyB0ZW5lciBkaXJlY2Npb24gdG9kYXZpYSAtPiBzZSBhY2VwdGFuIGlndWFsLlxyXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XHJcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XHJcbiAgICBzZWVuLmFkZChcclxuICAgICAgKHIuUHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpXHJcbiAgICApO1xyXG4gIH0pO1xyXG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xyXG4gICAgYXBwcm92ZWRBbHRhc0xpc3QuZm9yRWFjaCgoYSkgPT4ge1xyXG4gICAgICBpZiAoIWEpIHJldHVybjtcclxuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XHJcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXHJcbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXHJcbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XHJcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XHJcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcclxuICAgICAgY29uc3Qgbm9tYnJlID1cclxuICAgICAgICBhLmNvbWVyY2lvIHx8XHJcbiAgICAgICAgYS5mYW50YXNpYSB8fFxyXG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xyXG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcclxuICAgICAgaWYgKHNlZW4uaGFzKGR1cEtleSkpIHJldHVybjtcclxuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcclxuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcclxuICAgICAgLy8gdjMzMTogbWlzbW8gZmlsdHJvIGRlIHNjb3BlIGFwbGljYSBhIGFsdGFzIFNBUC9wcm92aXNvcmlhcy5cclxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcclxuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcclxuICAgICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xyXG4gICAgICByb3dzLnB1c2goXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGEuY2FyZENvZGVTYXAgfHwgJycsXHJcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxyXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxyXG4gICAgICAgICAgICBUaXBvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbyAoQWx0YSByYXBpZGEpJyA6ICdDbGllbnRlIGFjdHVhbCcsXHJcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxyXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxyXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvYyxcclxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcclxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXHJcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXHJcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcclxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxyXG4gICAgICAgICAgICBEaXJlY2Npb246IGEuY2FsbGUgfHwgYS5hZGRyZXNzIHx8ICcnLFxyXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcclxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcclxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBhLmxuZyAhPSBudWxsID8gYS5sbmcgOiAnJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSlcclxuICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcclxuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcclxuICAgIGNvbnN0IGwgPSAoYVsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJyk7XHJcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XHJcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xyXG4gIH0pO1xyXG5cclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xyXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXHJcbiAgICAgICAgJyAgKiBIYWJpbGl0YWRvcyBlbiBTQVAgKGNhcmRDb2RlICsgZGlyZWNjaW9uIGNhcmdhZG9zKS5cXG4nICtcclxuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xyXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE2IH0sIC8vIENhcmRDb2RlIFNBUFxyXG4gICAgeyB3Y2g6IDM4IH0sIC8vIE5vbWJyZSB0aWVuZGFcclxuICAgIHsgd2NoOiAyOCB9LCAvLyBBbGlhc1xyXG4gICAgeyB3Y2g6IDE0IH0sIC8vIFRpcG9cclxuICAgIHsgd2NoOiAxNCB9LCAvLyBFc3RhZG9cclxuICAgIHsgd2NoOiAyMiB9LCAvLyBQcm92aW5jaWFcclxuICAgIHsgd2NoOiAyMiB9LCAvLyBMb2NhbGlkYWQgbWFwYVxyXG4gICAgeyB3Y2g6IDIyIH0sIC8vIERlcGFydGFtZW50b1xyXG4gICAgeyB3Y2g6IDI4IH0sIC8vIFZlbmRlZG9yIGV4dGVybm9cclxuICAgIHsgd2NoOiA4IH0sIC8vIFpvbmFcclxuICAgIHsgd2NoOiA0OCB9LCAvLyBFdGlxdWV0YSB6b25hXHJcbiAgICB7IHdjaDogMjggfSwgLy8gQXNlc29yIGludGVybm9cclxuICAgIHsgd2NoOiAzOCB9LCAvLyBEaXJlY2Npb25cclxuICAgIHsgd2NoOiAyNCB9LCAvLyBMb2NhbGlkYWQgZGVjbGFyYWRhXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gTGF0XHJcbiAgICB7IHdjaDogMTQgfSwgLy8gTG5nXHJcbiAgICAvLyB2NDUwOiBjbGFzaWZpY2FjaW9uIGRlc2RlIHZpc2l0cy9jb250YWN0b3MuXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gVWx0aW1hIGludGVyYWNjaW9uXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gVGlwbyB1bHRpbWEgaW50ZXJhY2Npb25cclxuICAgIHsgd2NoOiAxMCB9LCAvLyBUb3RhbCB2aXNpdGFzXHJcbiAgICB7IHdjaDogMTAgfSwgLy8gVG90YWwgY29udGFjdG9zXHJcbiAgICB7IHdjaDogMTggfSwgLy8gVGlwbyBjb21lcmNpb1xyXG4gICAgeyB3Y2g6IDE2IH0sIC8vIExvY2FsXHJcbiAgICB7IHdjaDogMTIgfSwgLy8gVGFtYW5vXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gRmlkZWxpZGFkXHJcbiAgICB7IHdjaDogMjAgfSwgLy8gRXNwZWNpYWxpemFjaW9uXHJcbiAgICB7IHdjaDogMjAgfSwgLy8gQ2FuYWwgZGUgY29tcHJhXHJcbiAgICB7IHdjaDogMTAgfSwgLy8gUmVsZXZhbmNpYVxyXG4gICAgeyB3Y2g6IDggfSwgLy8gUE9QXHJcbiAgICB7IHdjaDogMjYgfSwgLy8gTmVjZXNpZGFkIHB1bnR1YWxcclxuICAgIHsgd2NoOiAxNiB9LCAvLyBUaXBvIGRlIHZlbnRhXHJcbiAgICB7IHdjaDogMTggfSwgLy8gUG9uZGVyYWNpb24gbW9zdHJhZG9yXHJcbiAgICB7IHdjaDogMTggfSwgLy8gUG9uZGVyYWNpb24gZS1jb21tZXJjZVxyXG4gICAgeyB3Y2g6IDI2IH0sIC8vIENvbXBldGVuY2lhXHJcbiAgICB7IHdjaDogMjYgfSwgLy8gT3BvcnR1bmlkYWRcclxuICAgIHsgd2NoOiAyMiB9LCAvLyBNYXMgdmVuZGlkb1xyXG4gICAgeyB3Y2g6IDIyIH0sIC8vIE1hcyBwcmVndW50YW5cclxuICAgIHsgd2NoOiAyNiB9LCAvLyBBeXVkYSB0aWVuZGFcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ2xpZW50ZXMgaGFiaWxpdGFkb3MgU0FQJyk7XHJcblxyXG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxyXG4gIGNvbnN0IGJ5Wm9uZSA9IHt9O1xyXG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xyXG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xyXG4gICAgaWYgKCFieVpvbmVbel0pIGJ5Wm9uZVt6XSA9IHsgdG90YWw6IDAsIGhhYmlsaXRhZG9zOiAwLCBjYW5jZWxhZG9zOiAwIH07XHJcbiAgICBieVpvbmVbel0udG90YWwrKztcclxuICAgIGlmIChyLkVzdGFkbyA9PT0gJ0hhYmlsaXRhZG8nKSBieVpvbmVbel0uaGFiaWxpdGFkb3MrKztcclxuICAgIGVsc2UgaWYgKHIuRXN0YWRvID09PSAnQ2FuY2VsYWRvJykgYnlab25lW3pdLmNhbmNlbGFkb3MrKztcclxuICB9KTtcclxuICBjb25zdCByZXN1bWVuUm93cyA9IE9iamVjdC5lbnRyaWVzKGJ5Wm9uZSlcclxuICAgIC5tYXAoKFt6LCBkXSkgPT4gKHtcclxuICAgICAgJ1pvbmEgLyBWZW5kZWRvcic6IHosXHJcbiAgICAgICdUb3RhbCB0aWVuZGFzJzogZC50b3RhbCxcclxuICAgICAgSGFiaWxpdGFkYXM6IGQuaGFiaWxpdGFkb3MsXHJcbiAgICAgIENhbmNlbGFkYXM6IGQuY2FuY2VsYWRvcyxcclxuICAgIH0pKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XHJcbiAgY29uc3Qgd3NSZXMgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocmVzdW1lblJvd3MpO1xyXG4gIHdzUmVzWychY29scyddID0gW3sgd2NoOiA0OCB9LCB7IHdjaDogMTQgfSwgeyB3Y2g6IDE0IH0sIHsgd2NoOiAxNCB9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1JlcywgJ1Jlc3VtZW4gcG9yIHpvbmEnKTtcclxuXHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIC8vIHYzMzE6IHN1ZmlqbyBjb24gZWwgc2NvcGUgYXBsaWNhZG8gcGFyYSBkaWZlcmVuY2lhciBlbCBhcmNoaXZvIGRlbCBWREUvVkRJXHJcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxyXG4gIGNvbnN0IHNjb3BlTGJsID1cclxuICAgIHNjb3BlU2V0ID09PSBudWxsXHJcbiAgICAgID8gJ1RPRE9TJ1xyXG4gICAgICA6IHNjb3BlU2V0LnNpemUgPT09IDFcclxuICAgICAgICA/IFsuLi5zY29wZVNldF1bMF0uc3BsaXQoJyAnKVswXVxyXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcclxuICBjb25zdCBmbmFtZSA9ICdNYXN0ZXJmaWxlX0NsaWVudGVzX1NBUF8nICsgc2NvcGVMYmwgKyAnXycgKyB0cyArICcueGxzeCc7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsIGZuYW1lKTtcclxuICBzaG93U3luY1RhZyhcclxuICAgIHJvd3MubGVuZ3RoICtcclxuICAgICAgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArXHJcbiAgICAgIChzY29wZVNldCA9PT0gbnVsbCA/ICcnIDogJyAoc2NvcGU6ICcgKyBbLi4uc2NvcGVTZXRdLmpvaW4oJywgJykgKyAnKScpXHJcbiAgKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcclxuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcclxuLy8gRmlyZXN0b3JlKSB5IFNUT0NLX01BUCAoYm9vbGVhbm8gcG9yIFNLVSBkZWwgc3RvY2suanNvbiBkZWwgcmVwbykuXHJcbi8vIEhvamFzOlxyXG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXHJcbi8vICAgIChsbyBtYXMgY29tdW4gcGFyYSByZXZpc2FyIGRpc3BvbmliaWxpZGFkICsgcHJlY2lvKS5cclxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXHJcbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cclxuLy8gIC0gXCJJbmZvXCI6IGZlY2hhIGRlIGxvcyBzbmFwc2hvdHMgeSBmdWVudGVzLlxyXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghQXJyYXkuaXNBcnJheShQUk9EVUNUUykgfHwgIVBST0RVQ1RTLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBjYXRhbG9nbyBkZSBwcm9kdWN0b3MgY2FyZ2FkbyB0b2RhdmlhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIHByZWNpb3MgKyBzdG9jay4uLicpO1xyXG4gIC8vIHY1NzQgKDIwMjYtMDgtMjEpOiBwZWRpZG8gZGUgTWFyaWFubyBcdTIwMTQgbW9zdHJhciBVTklEQURFUyBudW1lcmljYXNcclxuICAvLyBleGFjdGFzIGRlbCBkZXBvc2l0byAxMSAodmVudGEpIGVuIHZleiBkZSBcIkRpc3BvbmlibGVcIi9cIlNpbiBzdG9ja1wiLlxyXG4gIC8vIFVzYSBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YSBxdWUgbGVlIFNUT0NLX1dBUkVIT1VTRV9CUkVBS0RPV05bc2t1XVsnMTEnXS5cclxuICAvLyBSZXRvcm5hICcnIChjZWxkYSB2YWNpYSkgY3VhbmRvIG5vIGhheSBkYXRvIGRlIHN0b2NrIChzbmFwc2hvdCBubyBjYXJnYWRvXHJcbiAgLy8gYXVuKTsgMCBzaSBlbCBTS1Ugbm8gdGllbmUgc3RvY2suIExvcyBudW1lcm9zIHBlcm1pdGVuIHNvcnQvZmlsdGVyL3N1bSBlblxyXG4gIC8vIEV4Y2VsIFx1MjAxNCBubyBwZXJkZW1vcyBlbCBlc3RhZG8gXCJubyBkYXRvXCIgdnMgXCIwIHVuaWRhZGVzXCIgZ3JhY2lhcyBhbCAnJy5cclxuICBmdW5jdGlvbiBmbXRTdG9jayhza3UpIHtcclxuICAgIGNvbnN0IGZuID1cclxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xyXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXHJcbiAgICAgICAgOiBudWxsO1xyXG4gICAgY29uc3QgdiA9IGZuID8gZm4oc2t1KSA6IG51bGw7XHJcbiAgICBpZiAodiA9PSBudWxsKSByZXR1cm4gJyc7XHJcbiAgICByZXR1cm4gTnVtYmVyKHYpIHx8IDA7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGZtdFByZWNpbyhza3UpIHtcclxuICAgIGNvbnN0IHAgPSB0eXBlb2YgUFJJQ0VfTElTVF9NQVAgPT09ICdvYmplY3QnICYmIFBSSUNFX0xJU1RfTUFQID8gUFJJQ0VfTElTVF9NQVBbc2t1XSA6IG51bGw7XHJcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XHJcbiAgICByZXR1cm4gTnVtYmVyKHApIHx8IDA7XHJcbiAgfVxyXG4gIC8vIEhvamEgMTogY29tYm8gY29tcGxldG8gKGVzIGxhIG1hcyBwZWRpZGEpLlxyXG4gIGNvbnN0IHJvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XHJcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcclxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXHJcbiAgICBGYW1pbGlhOiBwLmZhbSB8fCAnJyxcclxuICAgIFN1YmZhbWlsaWE6IHAuc3ViIHx8ICcnLFxyXG4gICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcclxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXHJcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcclxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiA2MCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICBdO1xyXG4gIC8vIEFwbGljYXIgZm9ybWF0byBtb25lZGEgYSBsYSBjb2x1bW5hIFByZWNpbyBBUlMgKGNvbHVtbmEgRiA9IDYpLlxyXG4gIGZvciAobGV0IGkgPSAyOyBpIDw9IHJvd3MubGVuZ3RoICsgMTsgaSsrKSB7XHJcbiAgICBjb25zdCBjZWxsID0gd3NbJ0YnICsgaV07XHJcbiAgICBpZiAoY2VsbCAmJiB0eXBlb2YgY2VsbC52ID09PSAnbnVtYmVyJykgY2VsbC56ID0gJ1wiJFwiIywjIzAnO1xyXG4gIH1cclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1ByZWNpb3MgeSBTdG9jaycpO1xyXG5cclxuICAvLyBIb2phIDI6IHNvbG8gUHJlY2lvc1xyXG4gIGNvbnN0IHByZWNpb3NSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXHJcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxyXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcclxuICB9KSlcclxuICAgIC5maWx0ZXIoKHIpID0+IHJbJ1ByZWNpbyBBUlMnXSAhPT0gJycpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3Qgd3NQID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHByZWNpb3NSb3dzKTtcclxuICB3c1BbJyFjb2xzJ10gPSBbeyB3Y2g6IDE0IH0sIHsgd2NoOiA2MCB9LCB7IHdjaDogMTQgfV07XHJcbiAgZm9yIChsZXQgaSA9IDI7IGkgPD0gcHJlY2lvc1Jvd3MubGVuZ3RoICsgMTsgaSsrKSB7XHJcbiAgICBjb25zdCBjZWxsID0gd3NQWydDJyArIGldO1xyXG4gICAgaWYgKGNlbGwgJiYgdHlwZW9mIGNlbGwudiA9PT0gJ251bWJlcicpIGNlbGwueiA9ICdcIiRcIiMsIyMwJztcclxuICB9XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NQLCAnUHJlY2lvcycpO1xyXG5cclxuICAvLyBIb2phIDM6IHNvbG8gU3RvY2tcclxuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XHJcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcclxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXHJcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcclxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3Qgd3NTID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHN0b2NrUm93cyk7XHJcbiAgd3NTWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUywgJ1N0b2NrJyk7XHJcblxyXG4gIC8vIEhvamEgNDogbWV0YWRhdGEgLSBjdWFuZG8gZnVlIGNhZGEgc25hcHNob3QgcGFyYSBxdWUgZWwgbGVjdG9yIHNlcGFcclxuICAvLyBzaSBsYSBsaXN0YSBlc3RhIGZyZXNjYS5cclxuICBjb25zdCBpbmZvUm93cyA9IFtcclxuICAgIHsgSXRlbTogJ1RvdGFsIFNLVXMgZW4gY2F0YWxvZ28nLCBWYWxvcjogUFJPRFVDVFMubGVuZ3RoIH0sXHJcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBwcmVjaW8gY2FyZ2FkbycsIFZhbG9yOiBwcmVjaW9zUm93cy5sZW5ndGggfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgY29uIHN0b2NrIGRpc3BvbmlibGUnLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSB0cnVlKS5sZW5ndGgsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gc3RvY2snLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSBmYWxzZSkubGVuZ3RoLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIGRhdG8gZGUgc3RvY2snLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09IG51bGwpLmxlbmd0aCxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdMaXN0YSBkZSBwcmVjaW9zIG1vbmVkYScsXHJcbiAgICAgIFZhbG9yOiB0eXBlb2YgUFJJQ0VfTElTVF9DVVJSRU5DWSAhPT0gJ3VuZGVmaW5lZCcgPyBQUklDRV9MSVNUX0NVUlJFTkNZIDogJ0FSUycsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBhY3R1YWxpemFkYScsXHJcbiAgICAgIFZhbG9yOlxyXG4gICAgICAgIHR5cGVvZiBQUklDRV9MSVNUX1VQREFURURfQVQgIT09ICd1bmRlZmluZWQnICYmIFBSSUNFX0xJU1RfVVBEQVRFRF9BVFxyXG4gICAgICAgICAgPyBuZXcgRGF0ZShQUklDRV9MSVNUX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXHJcbiAgICAgICAgICA6ICcobm8gY2FyZ2FkYSknLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1N0b2NrIHNuYXBzaG90IGFjdHVhbGl6YWRvJyxcclxuICAgICAgVmFsb3I6IFNUT0NLX1VQREFURURfQVQgPyBuZXcgRGF0ZShTVE9DS19VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcobm8gY2FyZ2FkbyknLFxyXG4gICAgfSxcclxuICAgIHsgSXRlbTogJ0V4cG9ydGFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdFeHBvcnRhZG8gcG9yJyxcclxuICAgICAgVmFsb3I6IChjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgY3VycmVudFVzZXIuZGlzcGxheU5hbWUpKSB8fCAnKGRlc2Nvbm9jaWRvKScsXHJcbiAgICB9LFxyXG4gIF07XHJcbiAgY29uc3Qgd3NJID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGluZm9Sb3dzKTtcclxuICB3c0lbJyFjb2xzJ10gPSBbeyB3Y2g6IDM2IH0sIHsgd2NoOiAzNiB9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0ksICdJbmZvJyk7XHJcblxyXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1ByZWNpb3NfeV9TdG9ja18nICsgdHMgKyAnLnhsc3gnKTtcclxuICBzaG93U3luY1RhZyhyb3dzLmxlbmd0aCArICcgU0tVcyBleHBvcnRhZG9zIChwcmVjaW9zICsgc3RvY2spJyk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRVhQT1JUIC0gZGlhbG9nbyBkZSBzZWxlY2Npb24gKyAzIGZvcm1hdG9zXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG53aW5kb3cuZXhwb3J0VG9FeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cclxuICAvLyAgIHZlbmRlZG9yOiBvcGVyYXRpdm8gZGlhcmlvIChWZW50YXMgLyBWaXNpdGFzIC8gUnV0YXMpICsgQ2xpZW50ZXMgZGUgc3Ugem9uYVxyXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxyXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxyXG4gIC8vICAgICBwcm9waW8gc2kgZWxpZ2lvIHN1IG5vbWJyZSBlbiBlbCBkcm9wZG93biBkZSB6b25hcykuXHJcbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cclxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xyXG4gICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IFZFTlRBUyB5IFJVVEFTIGVsaW1pbmFkb3MgZGVsIFVJIHBvciBwZWRpZG8gZGUgTWFyaWFuby5cclxuICAgIHZlbmRlZG9yOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXHJcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXHJcbiAgfTtcclxuICBjb25zdCBhbGxvd2VkID0gYWxsb3dlZEJ5Um9sZVt1c2VyUm9sZV0gfHwgbnVsbDsgLy8gbnVsbCA9IHZlciB0b2RvXHJcbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2V4cG9ydC1tb2RhbCAuZXhwLW9wdCcpLmZvckVhY2goKGVsKSA9PiB7XHJcbiAgICBjb25zdCBraW5kID0gZWwuZGF0YXNldC5leHBLaW5kIHx8ICcnO1xyXG4gICAgZWwuc3R5bGUuZGlzcGxheSA9ICFhbGxvd2VkIHx8IGFsbG93ZWQuaGFzKGtpbmQpID8gJycgOiAnbm9uZSc7XHJcbiAgfSk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxud2luZG93LmNsb3NlRXhwb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gTW9udGggcGlja2VyIHJldXRpbGl6YWJsZSBwYXJhIGxvcyA1IHRpcG9zIGRlIGV4cG9ydFxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxubGV0IHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxuY29uc3QgRVhQT1JUX1RZUEVfTEFCRUxTID0ge1xyXG4gIFZFTlRBUzogJ1ZlbnRhcycsXHJcbiAgVklTSVRBUzogJ1Zpc2l0YXMnLFxyXG4gIFJFTkRJQ0lPTkVTOiAnUmVuZGljaW9uZXMnLFxyXG4gIFJVVEFTOiAnUnV0YXMnLFxyXG4gIEFMVEFTOiAnQWx0YXMgZGUgY2xpZW50ZXMnLFxyXG4gIEJBQ0tPUkRFUjogJ0JhY2tvcmRlcicsXHJcbiAgU1RPQ0tfQVNJRzogJ1N0b2NrIEFzaWduYWRvJyxcclxuICBQRURJRE9TX01FUzogJ1BlZGlkb3MgZGVsIG1lcycsXHJcbn07XHJcblxyXG53aW5kb3cuc2hvd01vbnRoUGlja2VyID0gZnVuY3Rpb24gKHRpcG8pIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XHJcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tdGl0bGUnKTtcclxuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXN1YnQnKTtcclxuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcclxuICBzdWJ0LnRleHRDb250ZW50ID0gJ0VsZWdpIGVsIG1lcyB5IGFcdTAwRjFvIHF1ZSBxdWVyZXMgZGVzY2FyZ2FyLic7XHJcbiAgLy8gUG9wdWxhdGUgc2VsZWN0c1xyXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgbWVzU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpO1xyXG4gIG1lc1NlbC5pbm5lckhUTUwgPVxyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcclxuICAgIE1FU0VTLm1hcCgobSwgaSkgPT4gJzxvcHRpb24gdmFsdWU9XCInICsgaSArICdcIj4nICsgbSArICc8L29wdGlvbj4nKS5qb2luKCcnKTtcclxuICBtZXNTZWwudmFsdWUgPSBub3cuZ2V0TW9udGgoKTtcclxuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcclxuICBjb25zdCB5ZWFyID0gbm93LmdldEZ1bGxZZWFyKCk7XHJcbiAgbGV0IHlvcHRzID0gJyc7XHJcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXHJcbiAgICB5b3B0cyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyB5ICsgJ1wiPicgKyB5ICsgJzwvb3B0aW9uPic7XHJcbiAgYW5pb1NlbC5pbm5lckhUTUwgPSB5b3B0cztcclxuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XHJcbn07XHJcblxyXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHRpcG8gPSBwZW5kaW5nRXhwb3J0VHlwZTtcclxuICBjb25zdCBtZXNSYXcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJykudmFsdWU7XHJcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcclxuICBjb25zdCBtb250aElkeCA9IG1lc1JhdyA9PT0gJ0FMTCcgPyBudWxsIDogcGFyc2VJbnQobWVzUmF3LCAxMCk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XHJcbiAgaWYgKCF0aXBvKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZJU0lUQVMnKSBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JFTkRJQ0lPTkVTJykgZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdBTFRBUycpIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0JBQ0tPUkRFUicpIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdTVE9DS19BU0lHJykgZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1BFRElET1NfTUVTJykgZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgYWxlcnQoJ1RpcG8gZGVzY29ub2NpZG86ICcgKyB0aXBvKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnQgJyArIHRpcG8sIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBleHBvcnQ6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkge1xyXG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gU3RyaW5nKGFuaW8pO1xyXG4gIHJldHVybiBNRVNFU1ttb250aElkeF0gKyAnXycgKyBhbmlvO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkb3dubG9hZFhsc3goZmlsZW5hbWUsIHNoZWV0cykge1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGZvciAoY29uc3QgcyBvZiBzaGVldHMpIHtcclxuICAgIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxyXG4gICAgICBzLnJvd3MubGVuZ3RoID8gcy5yb3dzIDogW3sgQXZpc286ICdTaW4gZGF0b3MgcGFyYSBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkbycgfV1cclxuICAgICk7XHJcbiAgICBpZiAocy5yb3dzLmxlbmd0aCkge1xyXG4gICAgICBjb25zdCBjb2xzID0gT2JqZWN0LmtleXMocy5yb3dzWzBdKS5tYXAoKGspID0+ICh7XHJcbiAgICAgICAgd2NoOiBNYXRoLm1pbig0MCwgTWF0aC5tYXgoMTAsIGsubGVuZ3RoICsgNCkpLFxyXG4gICAgICB9KSk7XHJcbiAgICAgIHdzWychY29scyddID0gY29scztcclxuICAgIH1cclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCBzLm5hbWUuc2xpY2UoMCwgMzEpKTtcclxuICB9XHJcbiAgWExTWC53cml0ZUZpbGUod2IsIGZpbGVuYW1lKTtcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFZFTlRBUzogcGVkaWRvcyBjb25maXJtYWRvcyBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWZW50YXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHBlZGlkb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgaWYgKHBhcnNlSW50KHAueWVhciwgMTApICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQocC5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xyXG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIHJldHVybjtcclxuICAgIGNvbnN0IHZlbmRvcktleSA9IHAudmVuZG9yIHx8IGxvb2t1cFZlbmRvckZvckNsaWVudChwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSkgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XHJcbiAgICBjb25zdCBmYWN0b3IgPSB0eXBlb2YgcGVkaWRvRGlzY291bnRGYWN0b3IgPT09ICdmdW5jdGlvbicgPyBwZWRpZG9EaXNjb3VudEZhY3RvcihwKSA6IDE7XHJcbiAgICBjb25zdCBkaXNjUGN0ID0gKHAuZGlzY291bnRTbmFwc2hvdCAmJiBwLmRpc2NvdW50U25hcHNob3QucGN0VG90YWwpIHx8IDA7XHJcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XHJcbiAgICAgIGNvbnN0IHF0eSA9IHBhcnNlRmxvYXQobC5xdHkpIHx8IDA7XHJcbiAgICAgIGNvbnN0IHByZWNpbyA9IHBhcnNlRmxvYXQobC5wcmVjaW8pIHx8IDA7XHJcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xyXG4gICAgICBjb25zdCBuZXQgPSBncm9zcyAqIGZhY3RvcjtcclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgRmVjaGFfQ29uZmlybWFkbzogcC5jb25maXJtZWRBdCA/IFN0cmluZyhwLmNvbmZpcm1lZEF0KS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgICAgICBFc3RhZG86IHAuc3RhZ2UgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxyXG4gICAgICAgIFpvbmE6IHZlbmRvckluZm8uem9uZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlIHx8ICcnKSxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQ29kaWdvX1NLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXHJcbiAgICAgICAgQ2F0ZWdvcmlhOiBsLmNhdCB8fCAnJyxcclxuICAgICAgICBGYW1pbGlhOiBsLmZhbSB8fCAnJyxcclxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZDogcXR5LFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxyXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxyXG4gICAgICAgIC8vIHBhcmEgZWwgdGFyZ2V0IGRlbCB2ZW5kZWRvci4gU3VidG90YWxfQnJ1dG9fQVJTIG11ZXN0cmEgZWwgdmFsb3JcclxuICAgICAgICAvLyBkZSBsaXN0YSBzaW4gZGVzY3VlbnRvIHBhcmEgdHJhemFiaWxpZGFkLlxyXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxyXG4gICAgICAgIFN1YnRvdGFsX0JydXRvX0FSUzogTWF0aC5yb3VuZChncm9zcyksXHJcbiAgICAgICAgRGVzY3VlbnRvX1BjdDogZGlzY1BjdCxcclxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcclxuICAgICAgICBDYXJnYWRvX1BvcjogcC5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCBwLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fVmVudGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgVmVudGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbG9va3VwVmVuZG9yRm9yQ2xpZW50KHByb3YsIGxvY05hbWUsIF9jbGllbnROYW1lKSB7XHJcbiAgaWYgKCFwcm92IHx8ICFsb2NOYW1lKSByZXR1cm4gJyc7XHJcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xyXG4gIHJldHVybiBwdCA/IHB0LnZlbmRvciB8fCAnJyA6ICcnO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVklTSVRBUzogZGV0YWxsZSBkZSB2aXNpdGFzIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWaXNpdGFzICsgQ29udGFjdG9zLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHZpc2l0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgdGFyZ2V0TWVzID0gbW9udGhJZHggIT09IG51bGwgPyBNRVNFU1ttb250aElkeF0udG9VcHBlckNhc2UoKSA6IG51bGw7XHJcbiAgY29uc3QgaXRlbXMgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IHYgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGlmIChwYXJzZUludCh2LmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xyXG4gICAgaXRlbXMucHVzaCh2KTtcclxuICB9KTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIG5pIGNvbnRhY3RvcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgblZpc2l0YXMgPSBpdGVtcy5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGg7XHJcbiAgY29uc3QgbkNvbnRhY3RvcyA9IGl0ZW1zLmxlbmd0aCAtIG5WaXNpdGFzO1xyXG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWw6ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MuLi4nLCAzMDAwKTtcclxuXHJcbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XHJcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMgeSBDb250YWN0b3MnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBbmlvJywga2V5OiAnYW5pbycsIHdpZHRoOiA4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdJbnRlcmFjY2lvbicsIGtleTogJ2ludGVyYWNjaW9uJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0Zvcm1hIENvbnRhY3RvJywga2V5OiAnZm9ybWFDb250YWN0bycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdSZXN1bHRhZG8gQ29udGFjdG8nLCBrZXk6ICdyZXN1bHRhZG9DdCcsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcclxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcclxuICAgIHsgaGVhZGVyOiAnTmVjZXNpZGFkIFB1bnR1YWwnLCBrZXk6ICduZWMnLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnTWFzIFZlbmRpZG8nLCBrZXk6ICdtYXNWZScsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdNYXMgUHJlZ3VudGFuJywga2V5OiAnbWFzUHInLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnQXl1ZGEgVGllbmRhJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbyBWZW50YScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdQb25kIE1vc3RyYWRvcicsIGtleTogJ3BNb3N0Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywga2V5OiAncEVjb20nLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdHUFMgU3RhdHVzJywga2V5OiAnZ3BzU3QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnR1BTIERpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnRW4gbm9tYnJlIGRlIFZERScsIGtleTogJ29uQmVoYWxmJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0NhcmdhZG8gUG9yJywga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0IH0sXHJcbiAgXTtcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xyXG5cclxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxO1xyXG4gIGNvbnN0IFJPV19IID0gMTAwO1xyXG4gIGNvbnN0IElNR19XID0gMTMwO1xyXG4gIGNvbnN0IElNR19IID0gOTA7XHJcblxyXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcclxuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcblxyXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xyXG4gICAgY29uc3QgaXNDb250YWN0byA9IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nO1xyXG4gICAgY29uc3QgaW50ZXJhY2Npb25MYmwgPSBpc0NvbnRhY3RvID8gJ0NvbnRhY3RvJyA6ICdWaXNpdGEnO1xyXG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XHJcbiAgICBsZXQgcmVzdWx0YWRvQ3RMYmwgPSAnJztcclxuICAgIGlmIChpc0NvbnRhY3RvKSB7XHJcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcclxuICAgICAgZWxzZSBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ25vX3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ05vIHJlc3BvbmRpbyc7XHJcbiAgICAgIGVsc2UgcmVzdWx0YWRvQ3RMYmwgPSAnU2luIG1hcmNhcic7XHJcbiAgICB9XHJcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xyXG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcclxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcclxuICAgICAgYW5pbzogdi5hbmlvIHx8ICcnLFxyXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcclxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgaW50ZXJhY2Npb246IGludGVyYWNjaW9uTGJsLFxyXG4gICAgICBmb3JtYUNvbnRhY3RvOiBmb3JtYUNvbnRhY3RvTGJsLFxyXG4gICAgICByZXN1bHRhZG9DdDogcmVzdWx0YWRvQ3RMYmwsXHJcbiAgICAgIGNvbWVudDogdi5jb21lbnRhcmlvIHx8ICcnLFxyXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXHJcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICAgIHRpZW5kYTogdi50aWVuZGEgfHwgJycsXHJcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcclxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXHJcbiAgICAgIHRhbWFubzogdi50YW1hbm8gfHwgJycsXHJcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXHJcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXHJcbiAgICAgIHBvcDogdi5wb3AgfHwgJycsXHJcbiAgICAgIG5lYzogdi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxyXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXHJcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXHJcbiAgICAgIG1hc1ByOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcclxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXHJcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxyXG4gICAgICBwTW9zdDogdi5wb25kZXJhY2lvbk1vc3RyYWRvIHx8ICcnLFxyXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcclxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXHJcbiAgICAgIGdwc1N0OiB2Lmdwc1N0YXR1cyB8fCAnJyxcclxuICAgICAgZ3BzRGlzdDogdi5ncHNEaXN0YW5jZU0gIT0gbnVsbCA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXHJcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGltYWdlbiBlbmNpbWFcclxuICAgICAgb25CZWhhbGY6IHYub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxyXG4gICAgICBjcmVhdGVkQnk6IHYuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgdi5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xyXG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xyXG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XHJcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcclxuICAgICAgICBpZiAobSkge1xyXG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgICAgYjY0ID0gbVsyXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcclxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcclxuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0YXNGb3JNb250aCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJFTkRJQ0lPTkVTOiBnYXN0b3MgeSBhbnRpY2lwb3MgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSZW5kaWNpb25lcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHJlbmRpY2lvbmVzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIEZpbHRyYXIgcG9yIG1lcy9hbmlvXHJcbiAgY29uc3QgaXRlbXMgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IHIgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGxldCBkdCA9IHIuZmVjaGEgfHwgci5mZWNoYUdhc3RvIHx8ICcnO1xyXG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBkdCA9IHIuY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gICAgICB9IGNhdGNoIChfZSkge31cclxuICAgIH1cclxuICAgIGlmICghZHQpIHJldHVybjtcclxuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XHJcbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRPYmouZ2V0VGltZSgpKSkgcmV0dXJuO1xyXG4gICAgaWYgKGRPYmouZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgIGl0ZW1zLnB1c2goeyBpZDogZC5pZCwgZmVjaGE6IGR0LCByOiByIH0pO1xyXG4gIH0pO1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHJlbmRpY2lvbmVzIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gQ2FyZ2EgbGF6eS5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBpdGVtcy5sZW5ndGggKyAnIHJlbmRpY2lvbmVzLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdSZW5kaWNpb25lcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xyXG4gIHdzLmNvbHVtbnMgPSBbXHJcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0NvbmNlcHRvJywga2V5OiAnY29uY2VwdG8nLCB3aWR0aDogMTggfSxcclxuICAgIHsgaGVhZGVyOiAnTiBUaWNrZXQnLCBrZXk6ICdudW1UaWNrZXQnLCB3aWR0aDogMTQgfSxcclxuICAgIHsgaGVhZGVyOiAnTW9kbyBwYWdvJywga2V5OiAnbW9kb1BhZ28nLCB3aWR0aDogMTQgfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbyBnYXN0bycsIGtleTogJ3RpcG9HYXN0bycsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdEaXZpc2lvbicsIGtleTogJ2RpdmlzaW9uJywgd2lkdGg6IDE0IH0sXHJcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ01vbmVkYScsIGtleTogJ21vbmVkYScsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlIFVTRCcsIGtleTogJ2ltcG9ydGVVc2QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGb3RvIHRpY2tldCcsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnRXN0YWRvJywga2V5OiAnZXN0YWRvJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvcicsIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkbyBlbicsIGtleTogJ2Fwcm9iYWRvRW4nLCB3aWR0aDogMTQgfSxcclxuICBdO1xyXG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjdFMjJDRScgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcclxuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XHJcblxyXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXHJcbiAgY29uc3QgUk9XX0ggPSAxMTA7XHJcbiAgY29uc3QgSU1HX1cgPSAxNDA7XHJcbiAgY29uc3QgSU1HX0ggPSAxMDA7XHJcblxyXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcclxuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcblxyXG4gIGZvciAoY29uc3QgaXQgb2YgaXRlbXMpIHtcclxuICAgIGNvbnN0IHIgPSBpdC5yO1xyXG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcclxuICAgIGNvbnN0IGNvbmNlcHRTdHIgPSBpc0dhc3RvID8gci5kZXNjcmlwY2lvbiB8fCAnJyA6IHIudGlwb09wZXJhY2lvbiB8fCByLm1vdGl2byB8fCAnJztcclxuICAgIGNvbnN0IG9ic1N0ciA9XHJcbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xyXG4gICAgICAoaXNHYXN0byA/ICcnIDogci5zb2xpY2l0YWRvUG9yID8gJyB8IFNvbGljaXRhZG8gcG9yOiAnICsgci5zb2xpY2l0YWRvUG9yIDogJycpO1xyXG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxyXG4gICAgICB0aXBvOiByLnRpcG8gfHwgJycsXHJcbiAgICAgIHZlbmRlZG9yOiByLm93bmVyTmFtZSB8fCByLnZlbmRvck5hbWUgfHwgci5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBlbWFpbDogci5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBjb25jZXB0bzogY29uY2VwdFN0cixcclxuICAgICAgbnVtVGlja2V0OiByLm51bWVyb1RpY2tldCB8fCAnJyxcclxuICAgICAgbW9kb1BhZ286IHIubW9kb1BhZ28gfHwgJycsXHJcbiAgICAgIHRpcG9HYXN0bzogci50aXBvR2FzdG8gfHwgJycsXHJcbiAgICAgIGRpdmlzaW9uOiByLmRpdmlzaW9uR2FzdG8gfHwgJycsXHJcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXHJcbiAgICAgIG1vbmVkYTogci5tb25lZGEgfHwgJ1BFU09TJyxcclxuICAgICAgaW1wb3J0ZVVzZDogci5pbXBvcnRlVXNkICE9IG51bGwgJiYgci5pbXBvcnRlVXNkICE9PSAwID8gci5pbXBvcnRlVXNkIDogJycsXHJcbiAgICAgIG9iczogb2JzU3RyLFxyXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBlbmNpbWEgdmEgbGEgaW1hZ2VuXHJcbiAgICAgIGVzdGFkbzogci5zdGF0dXMgfHwgci5lc3RhZG8gfHwgJycsXHJcbiAgICAgIGFwcm9iYWRvcjogci5hcHByb3ZlckVtYWlsIHx8IHIuYXByb2JhZG9yIHx8ICcnLFxyXG4gICAgICBhcHJvYmFkb0VuOlxyXG4gICAgICAgIHIuYXBwcm92ZWRBdCAmJiByLmFwcHJvdmVkQXQudG9EYXRlID8gci5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICB9KTtcclxuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcclxuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcclxuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBTSUVNUFJFIGVtYmViZXIgbGEgZm90byAobm8gZGVqYXIgaHlwZXJsaW5rKS5cclxuICAgIC8vIEFudGVzOiBzaSBmb3RvVGlja2V0VXJsIChTdG9yYWdlKSwgcXVlZGFiYSBjb21vIGh5cGVybGluayBBYnJpciB0aWNrZXQuXHJcbiAgICAvLyBBaG9yYTogZmV0Y2ggZGVsIFVSTCArIGNvbnZlcnRpciBhIGFycmF5QnVmZmVyICsgZW1iZWJlciBpZ3VhbCBxdWUgZGF0YVVSTC5cclxuICAgIC8vIEZhbGxiYWNrIGEgaHlwZXJsaW5rIHNvbG8gc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCwgZXRjKS5cclxuICAgIGNvbnN0IGZvdG9TcmMgPSByLmZvdG9UaWNrZXQgfHwgci5hZGp1bnRvIHx8ICcnO1xyXG4gICAgaWYgKGZvdG9TcmMgJiYgdHlwZW9mIGZvdG9TcmMgPT09ICdzdHJpbmcnICYmIGZvdG9TcmMuc3RhcnRzV2l0aCgnZGF0YTppbWFnZS8nKSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBiNjQgPSBmb3RvU3JjO1xyXG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XHJcbiAgICAgICAgaWYgKG0pIHtcclxuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgIGI2NCA9IG1bMl07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXHJcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXHJcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IGZldGNoIGxhIGZvdG8gZGVzZGUgU3RvcmFnZSB5IGVtYmViZXJsYSBjb21vIGltYWdlbi5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2goci5mb3RvVGlja2V0VXJsKTtcclxuICAgICAgICBpZiAoIXJlc3Aub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgcmVzcC5zdGF0dXMpO1xyXG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcC5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykgfHwgJ2ltYWdlL2pwZWcnO1xyXG4gICAgICAgIGxldCBleHQgPSBjb250ZW50VHlwZS5zcGxpdCgnLycpWzFdIHx8ICdqcGVnJztcclxuICAgICAgICBleHQgPSBleHQuc3BsaXQoJzsnKVswXS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHJlc3AuYXJyYXlCdWZmZXIoKTtcclxuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBidWZmZXI6IGJ1ZiwgZXh0ZW5zaW9uOiBleHQgfSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcclxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgLy8gRmFsbGJhY2s6IHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQpLCBkZWphciBoeXBlcmxpbmsgY29tbyBhbnRlcy5cclxuICAgICAgICBjb25zb2xlLndhcm4oJ2ZldGNoIGZvdG8gcmVuZGljaW9uIGZhbGxvLCBkZWpvIGh5cGVybGluaycsIGl0LmlkLCBlKTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgY29uc3QgY2VsbCA9IHJvdy5nZXRDZWxsKEZPVE9fQ09MX0lEWCArIDEpO1xyXG4gICAgICAgICAgY2VsbC52YWx1ZSA9IHtcclxuICAgICAgICAgICAgdGV4dDogJ0FicmlyIHRpY2tldCcsXHJcbiAgICAgICAgICAgIGh5cGVybGluazogci5mb3RvVGlja2V0VXJsLFxyXG4gICAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXIgKGZldGNoIGZhbGxvKScsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkYwNTYzQzEnIH0sIHVuZGVybGluZTogdHJ1ZSB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKF9lMikge31cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19SZW5kaWNpb25lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSdXRhcy4uLicpO1xyXG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xyXG4gIC8vIChkZXJpdmFjaW9uZXMgLyByZWFnZW5kYXMpIHZpdmVuIGVuIHJvdXRlX292ZXJyaWRlcy4gRXhwb3J0YW1vczpcclxuICAvLyAgLSB1bmEgaG9qYSBjb24gbGFzIHJ1dGFzIHBsYW5pZmljYWRhcyBkZWwgcGVyaW9kbyAocGFyYSBsb3MgdmVuZGVkb3Jlc1xyXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXHJcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxvcyBvdmVycmlkZXMgZGVsIHBlcmlvZG9cclxuICBjb25zdCB0YXJnZXRWZW5kb3JzID1cclxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xyXG4gICAgICA/IFZFTkRPUlMubWFwKCh2KSA9PiB2LmtleSlcclxuICAgICAgOiBhc3NpZ25lZFZlbmRvclxyXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxyXG4gICAgICAgIDogW107XHJcbiAgY29uc3QgbW9udGhzVG9FeHBvcnQgPSBtb250aElkeCAhPT0gbnVsbCA/IFttb250aElkeF0gOiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgNywgOCwgOSwgMTAsIDExXTtcclxuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcclxuICBmb3IgKGNvbnN0IHZlbmQgb2YgdGFyZ2V0VmVuZG9ycykge1xyXG4gICAgZm9yIChjb25zdCBtIG9mIG1vbnRoc1RvRXhwb3J0KSB7XHJcbiAgICAgIGxldCBydXRhcztcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBydXRhcyA9IGdlbmVyYXJSdXRhc1ZlbmRvcih2ZW5kLCBtLCBhbmlvKTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHtcclxuICAgICAgICBydXRhcyA9IFtdO1xyXG4gICAgICB9XHJcbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xyXG4gICAgICAgIChydXRhLnRpZW5kYXMgfHwgW10pLmZvckVhY2goKHQsIGkpID0+IHtcclxuICAgICAgICAgIHJ1dGFzUm93cy5wdXNoKHtcclxuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcclxuICAgICAgICAgICAgQW5pbzogYW5pbyxcclxuICAgICAgICAgICAgTWVzOiBNRVNFU1ttXSxcclxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcclxuICAgICAgICAgICAgUnV0YV9Ob21icmU6IHJ1dGEubm9tYnJlIHx8ICcnLFxyXG4gICAgICAgICAgICBGZWNoYV9Bc2lnbmFkYTogcnV0YS5mZWNoYUFzaWduYWRhIHx8ICcnLFxyXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXHJcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHQucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgICAgICBMb2NhbGlkYWQ6IHQubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgICAgIFRpcG86IHQudGlwbyB8fCAnJyxcclxuICAgICAgICAgICAgRXN0YWRvOiB0LmVzdGFkbyB8fCAnJyxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gT3ZlcnJpZGVzXHJcbiAgbGV0IG92clNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIG92clNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvdXRlX292ZXJyaWRlcycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICBvdnJTbmFwID0gbnVsbDtcclxuICB9XHJcbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xyXG4gIGlmIChvdnJTbmFwKSB7XHJcbiAgICBvdnJTbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBpZiAocGFyc2VJbnQoby5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KG8ubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcclxuICAgICAgICBBbmlvOiBvLmFuaW8gfHwgJycsXHJcbiAgICAgICAgTWVzOiBNRVNFU1twYXJzZUludChvLm1vbnRoSWR4LCAxMCldIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKG8ucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIEFjY2lvbjogby5hY3Rpb24gfHwgby50aXBvIHx8ICcnLFxyXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxyXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcclxuICAgICAgICBNb3Rpdm86IG8ubW90aXZvIHx8ICcnLFxyXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgICAgQ3JlYWRvX0VuOlxyXG4gICAgICAgICAgby5jcmVhdGVkQXQgJiYgby5jcmVhdGVkQXQudG9EYXRlID8gby5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19SdXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcclxuICAgIHsgbmFtZTogJ1J1dGFzIHBsYW5pZmljYWRhcycsIHJvd3M6IHJ1dGFzUm93cyB9LFxyXG4gICAgeyBuYW1lOiAnRGVyaXZhY2lvbmVzLVJlYWdlbmRhcycsIHJvd3M6IG92ZXJyaWRlc1Jvd3MgfSxcclxuICBdKTtcclxuICBzaG93U3luY1RhZyhcclxuICAgICdFeHBvcnQgUnV0YXMgbGlzdG8gKCcgKyBydXRhc1Jvd3MubGVuZ3RoICsgJyB0aWVuZGFzLCAnICsgb3ZlcnJpZGVzUm93cy5sZW5ndGggKyAnIG92ZXJyaWRlcyknLFxyXG4gICAgMjQwMFxyXG4gICk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQWx0YXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGxldCBkdCA9ICcnO1xyXG4gICAgaWYgKGEuY3JlYXRlZEF0ICYmIGEuY3JlYXRlZEF0LnRvRGF0ZSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGR0ID0gYS5jcmVhdGVkQXQudG9EYXRlKCk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfVxyXG4gICAgaWYgKCFkdCkgcmV0dXJuO1xyXG4gICAgaWYgKGR0LmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgcm93cy5wdXNoKHtcclxuICAgICAgRmVjaGFfU29saWNpdHVkOiBkdC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSxcclxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcclxuICAgICAgQ29tZXJjaW86IGEuY29tZXJjaW8gfHwgJycsXHJcbiAgICAgIEZhbnRhc2lhOiBhLmZhbnRhc2lhIHx8ICcnLFxyXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXHJcbiAgICAgIENvbmRpY2lvbl9GaXNjYWw6IGEuY29uZEZpc2NhbCB8fCAnJyxcclxuICAgICAgQ2FsbGU6IGEuY2FsbGUgfHwgJycsXHJcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXHJcbiAgICAgIExvY2FsaWRhZDogYS5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICAgIFByb3ZpbmNpYTogYS5wcm92aW5jaWEgfHwgJycsXHJcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxyXG4gICAgICBUZWxlZm9ubzogYS50ZWxlZm9ubyB8fCAnJyxcclxuICAgICAgRW1haWw6IGEuZW1haWwgfHwgJycsXHJcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBPd25lcl9FbWFpbDogYS5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBTdWJtaXR0ZWRfQnlfUHVibGljX0Zvcm06IGEuc3VibWl0dGVkQnlQdWJsaWNGb3JtID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgIEFwcm9iYWRvX0VuOlxyXG4gICAgICAgIGEuYXBwcm92ZWRBdCAmJiBhLmFwcHJvdmVkQXQudG9EYXRlID8gYS5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0FsdGFzIGRlIGNsaWVudGVzJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBBbHRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBzb2xpY2l0dWRlcyknLCAyNDAwKTtcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIHY3MDkgKDIwMjYtMDgtMjgpOiAzIGV4cG9ydHMgbnVldm9zIHBlZGlkb3MgcG9yIE1hcmlhbm8uXHJcbi8vIC0gQkFDS09SREVSOiBsaW5lYXMgc3RhdGU9Qk8gb3BlbiBwb3IgbWVzIGRlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLlxyXG4vLyAtIFNUT0NLX0FTSUc6IGxpbmVhcyBBU0lHIG9wZW4gKG8gQk8rc3RvY2sgZGlzcCkgcG9yIG1lcyBkZSBjcmVhdGVkQXQuXHJcbi8vIC0gUEVESURPU19NRVM6IFRPRE9TIGxvcyBwZWRpZG9zIGNyZWFkb3MgZW4gZWwgbWVzL2FuaW8gKGN1YWxxdWllciBzdGFnZSkuXHJcbi8vIEZ1ZW50ZTogZ2xvYmFsUGVkaWRvcyAobG8gcXVlIGxhIGFwcCB5YSB0aWVuZSBlbiBtZW1vcmlhKS5cclxuLy8gRmlsdGVyIG1lcy9hXHUwMEYxbzogc29icmUgY3JlYXRlZEF0IGRlbCBwZWRpZG8uIG1vbnRoSWR4PW51bGwgLT4gYVx1MDBGMW8gZW50ZXJvLlxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuZnVuY3Rpb24gX3BlZGlkb01vbnRoWWVhcihwKSB7XHJcbiAgY29uc3QgY2EgPSBwLmNyZWF0ZWRBdDtcclxuICBpZiAoIWNhKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XHJcbiAgbGV0IGR0ID0gbnVsbDtcclxuICBpZiAodHlwZW9mIGNhID09PSAnc3RyaW5nJykgZHQgPSBuZXcgRGF0ZShjYSk7XHJcbiAgZWxzZSBpZiAodHlwZW9mIGNhLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgZHQgPSBjYS50b0RhdGUoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhID09PSAnbnVtYmVyJykgZHQgPSBuZXcgRGF0ZShjYSk7XHJcbiAgaWYgKCFkdCB8fCBOdW1iZXIuaXNOYU4oZHQuZ2V0VGltZSgpKSkgcmV0dXJuIHsgeTogbnVsbCwgbTogbnVsbCB9O1xyXG4gIHJldHVybiB7IHk6IGR0LmdldEZ1bGxZZWFyKCksIG06IGR0LmdldE1vbnRoKCkgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgY29uc3QgYXJyID1cclxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xyXG4gIHJldHVybiBhcnIuZmlsdGVyKChwKSA9PiB7XHJcbiAgICBpZiAoIXApIHJldHVybiBmYWxzZTtcclxuICAgIGNvbnN0IHsgeSwgbSB9ID0gX3BlZGlkb01vbnRoWWVhcihwKTtcclxuICAgIGlmICh5ID09IG51bGwpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICh5ICE9PSBhbmlvKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgbSAhPT0gbW9udGhJZHgpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlci4uLicpO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcclxuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykge1xyXG4gICAgaWYgKHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xyXG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xyXG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XHJcbiAgICAgIGlmICghbCB8fCBsLnN0YXRlICE9PSAnQk8nKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHFvID0gTnVtYmVyKGwucXR5T3BlbikgfHwgMDtcclxuICAgICAgaWYgKHFvIDw9IDApIHJldHVybjtcclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBGZWNoYV9QZWRpZG86IHAuY3JlYXRlZEF0XHJcbiAgICAgICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcclxuICAgICAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcclxuICAgICAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxyXG4gICAgICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgICAgICAgIC5zbGljZSgwLCAxMClcclxuICAgICAgICAgIDogJycsXHJcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxyXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXHJcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWRfUGVkaWRhOiBOdW1iZXIobC5xdHkpIHx8IDAsXHJcbiAgICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcclxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSxcclxuICAgICAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQocW8gKiAoTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApIHx8IDApKSxcclxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXHJcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXHJcbiAgICAgICAgU1FfRG9jTnVtOiBwLnRyYW5zZmVyaWRvU0FQID8gcC50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gfHwgJycgOiAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkby4uLicpO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcclxuICBjb25zdCBnZXRTdGsgPVxyXG4gICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xyXG4gICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxyXG4gICAgICA6IG51bGw7XHJcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcclxuICAgIGlmIChwLmNsb3NlZEF0KSBjb250aW51ZTtcclxuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcclxuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xyXG4gICAgICBpZiAoIWwpIHJldHVybjtcclxuICAgICAgY29uc3QgcW8gPSBOdW1iZXIobC5xdHlPcGVuKSB8fCAwO1xyXG4gICAgICBpZiAocW8gPD0gMCkgcmV0dXJuO1xyXG4gICAgICBsZXQgdmlydHVhbCA9IGZhbHNlO1xyXG4gICAgICBpZiAobC5zdGF0ZSA9PT0gJ0FTSUcnKSB7XHJcbiAgICAgICAgLy8gb2sgcmVzZXJ2YSBmaXJtZVxyXG4gICAgICB9IGVsc2UgaWYgKGwuc3RhdGUgPT09ICdCTycpIHtcclxuICAgICAgICAvLyB2aXJ0dWFsIHNvbG8gc2kgaGF5IHN0b2NrIGRpc3BcclxuICAgICAgICBpZiAoIWdldFN0aykgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IHN0ayA9IGdldFN0ayhsLmNvZGUpIHx8IDA7XHJcbiAgICAgICAgaWYgKHN0ayA8PSAwKSByZXR1cm47XHJcbiAgICAgICAgdmlydHVhbCA9IHRydWU7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBwLmNyZWF0ZWRBdFxyXG4gICAgICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcclxuICAgICAgICAgICAgICAgIC50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICAgICAgICAuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICA6ICcnLFxyXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcclxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxyXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxyXG4gICAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcW8sXHJcbiAgICAgICAgRXN0YWRvX1JlYWw6IHZpcnR1YWwgPyAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJyA6ICdBU0lHJyxcclxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSxcclxuICAgICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHFvICogKE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSB8fCAwKSksXHJcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxyXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdTdG9jayBBc2lnbmFkbycsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59XHJcblxyXG4vLyB2NzM3ICgyMDI2LTA4LTMwKTogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG9zIGxvcyBiYWNrb3JkZXJzIG9wZW4gKHNpbiBmaWx0cm9cclxuLy8gZGUgbWVzKS4gTW90aXZvOiBsb3MgNjIgcGVkaWRvcyBtaWdyYWRvcyBkZXNkZSBTQVAgZWwgMjAyNi0wOC0yOCB0aWVuZW5cclxuLy8gY3JlYXRlZEF0IGRlIGZlY2hhcyB2aWVqYXMgZGVsIFNBUCBTUSBvcmlnaW5hbCwgZW50b25jZXMgZWwgZXhwb3J0IHBvciBtZXNcclxuLy8gbm8gbG9zIGluY2x1aWEuIFZlcnNpb24gXCJjdXJyZW50IHN0YXR1c1wiIHF1ZSBpdGVyYSBnbG9iYWxQZWRpZG9zIGNvbXBsZXRvLlxyXG53aW5kb3cuZXhwb3J0QmFja29yZGVyQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlciAoc25hcHNob3QgYWN0dWFsKS4uLicpO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBhcnIgPVxyXG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XHJcbiAgbGV0IHRvdGFsUGVkaWRvc09wZW4gPSAwO1xyXG4gIGZvciAoY29uc3QgcCBvZiBhcnIpIHtcclxuICAgIGlmICghcCB8fCBwLmNsb3NlZEF0KSBjb250aW51ZTtcclxuICAgIHRvdGFsUGVkaWRvc09wZW4rKztcclxuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcclxuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xyXG4gICAgICBpZiAoIWwgfHwgbC5zdGF0ZSAhPT0gJ0JPJykgcmV0dXJuO1xyXG4gICAgICBjb25zdCBxbyA9IE51bWJlcihsLnF0eU9wZW4pIHx8IDA7XHJcbiAgICAgIGlmIChxbyA8PSAwKSByZXR1cm47XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBwLmNyZWF0ZWRBdFxyXG4gICAgICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcclxuICAgICAgICAgICAgICAgIC50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICAgICAgICAuc2xpY2UoMCwgMTApXHJcbiAgICAgICAgICA6ICcnLFxyXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcclxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxyXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxyXG4gICAgICAgIENhbnRpZGFkX1BlZGlkYTogTnVtYmVyKGwucXR5KSB8fCAwLFxyXG4gICAgICAgIENhbnRpZGFkX1BlbmRpZW50ZV9CTzogcW8sXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCksXHJcbiAgICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSB8fCAwKSksXHJcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxyXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxyXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXHJcbiAgICAgICAgT3JpZ2VuOiBwLm1pZ3JhdGlvblNvdXJjZSB8fCAnYXBwJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ0V4cG9ydCBCYWNrb3JkZXIgdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xyXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXHJcbiAgICAgICAgYXJyLmxlbmd0aCArXHJcbiAgICAgICAgJ1xcbicgK1xyXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xyXG4gICAgICAgIHRvdGFsUGVkaWRvc09wZW4gK1xyXG4gICAgICAgICdcXG4nICtcclxuICAgICAgICAnLSBMaW5lYXMgc3RhdGU9Qk8gY29uIHF0eU9wZW4+MDogMFxcblxcbicgK1xyXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXHJcbiAgICAgICAgJzEuIE5vIGhheSBiYWNrb3JkZXIgYWJpZXJ0byBhaG9yYSBtaXNtbyAodG9kbyBjb25maXJtZWQgbyBjZXJyYWRvKVxcbicgK1xyXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcclxuICAgICAgICAnMy4gTGFzIGxpbmVhcyBCTyB0aWVuZW4gcXR5T3Blbj0wICh5YSBkZXNwYWNoYWRhcyB2aWEgQVNJRy0+Y2xvc2VkKSdcclxuICAgICk7XHJcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlcjogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcclxuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19CYWNrb3JkZXJfU25hcHNob3RfJyArIHRvZGF5ICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn07XHJcblxyXG4vLyB2NzM3OiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kbyBlbCBTdG9jayBBc2lnbmFkbyAoc2luIGZpbHRybyBkZSBtZXMpLiBNaXNtb1xyXG4vLyBtb3Rpdm8gcXVlIGV4cG9ydEJhY2tvcmRlckFsbC5cclxud2luZG93LmV4cG9ydFN0b2NrQXNpZ0FsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkbyAoc25hcHNob3QgYWN0dWFsKS4uLicpO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBhcnIgPVxyXG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XHJcbiAgY29uc3QgZ2V0U3RrID1cclxuICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcclxuICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGFcclxuICAgICAgOiBudWxsO1xyXG4gIGxldCB0b3RhbFBlZGlkb3NPcGVuID0gMDtcclxuICBsZXQgYXNpZ0NvdW50ID0gMDtcclxuICBsZXQgYm9XaXRoU3RvY2tDb3VudCA9IDA7XHJcbiAgZm9yIChjb25zdCBwIG9mIGFycikge1xyXG4gICAgaWYgKCFwIHx8IHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xyXG4gICAgdG90YWxQZWRpZG9zT3BlbisrO1xyXG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xyXG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XHJcbiAgICAgIGlmICghbCkgcmV0dXJuO1xyXG4gICAgICBjb25zdCBxbyA9IE51bWJlcihsLnF0eU9wZW4pIHx8IDA7XHJcbiAgICAgIGlmIChxbyA8PSAwKSByZXR1cm47XHJcbiAgICAgIGxldCB2aXJ0dWFsID0gZmFsc2U7XHJcbiAgICAgIGlmIChsLnN0YXRlID09PSAnQVNJRycpIHtcclxuICAgICAgICBhc2lnQ291bnQrKztcclxuICAgICAgfSBlbHNlIGlmIChsLnN0YXRlID09PSAnQk8nKSB7XHJcbiAgICAgICAgaWYgKCFnZXRTdGspIHJldHVybjtcclxuICAgICAgICBjb25zdCBzdGsgPSBnZXRTdGsobC5jb2RlKSB8fCAwO1xyXG4gICAgICAgIGlmIChzdGsgPD0gMCkgcmV0dXJuO1xyXG4gICAgICAgIHZpcnR1YWwgPSB0cnVlO1xyXG4gICAgICAgIGJvV2l0aFN0b2NrQ291bnQrKztcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBGZWNoYV9QZWRpZG86IHAuY3JlYXRlZEF0XHJcbiAgICAgICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcclxuICAgICAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcclxuICAgICAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxyXG4gICAgICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgICAgICAgIC5zbGljZSgwLCAxMClcclxuICAgICAgICAgIDogJycsXHJcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxyXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXHJcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWRfUmVzZXJ2YWRhOiBxbyxcclxuICAgICAgICBFc3RhZG9fUmVhbDogdmlydHVhbCA/ICdCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRyknIDogJ0FTSUcnLFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApLFxyXG4gICAgICAgIFN1YnRvdGFsX1Jlc2VydmFkb19BUlM6IE1hdGgucm91bmQocW8gKiAoTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApIHx8IDApKSxcclxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXHJcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXHJcbiAgICAgICAgU1FfRG9jTnVtOiBwLnRyYW5zZmVyaWRvU0FQID8gcC50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gfHwgJycgOiAnJyxcclxuICAgICAgICBPcmlnZW46IHAubWlncmF0aW9uU291cmNlIHx8ICdhcHAnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnRXhwb3J0IFN0b2NrIEFzaWduYWRvIHZhY2lvLiBEaWFnbm9zdGljbzpcXG4nICtcclxuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xyXG4gICAgICAgIGFyci5sZW5ndGggK1xyXG4gICAgICAgICdcXG4nICtcclxuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcclxuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJy0gTGluZWFzIHN0YXRlPUFTSUcgY29uIHF0eU9wZW4+MDogJyArXHJcbiAgICAgICAgYXNpZ0NvdW50ICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJy0gTGluZWFzIHN0YXRlPUJPIGNvbiBzdG9jayBkaXNwb25pYmxlICh2aXJ0dWFsIEFTSUcpOiAnICtcclxuICAgICAgICBib1dpdGhTdG9ja0NvdW50ICtcclxuICAgICAgICAnXFxuXFxuJyArXHJcbiAgICAgICAgJ1Bvc2libGVzIGNhdXNhczpcXG4nICtcclxuICAgICAgICAnMS4gTm8gaGF5IHN0b2NrIGFzaWduYWRvIGFob3JhIG1pc21vXFxuJyArXHJcbiAgICAgICAgJzIuIFRvZG8gZWwgc3RvY2sgZXN0YSBwZW5kaWVudGUgc2luIGFzaWduYXIgKG1vZGUgQk8gcHVybyBzaW4gc3RvY2spXFxuJyArXHJcbiAgICAgICAgJzMuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvJ1xyXG4gICAgKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZzogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb19TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn07XHJcblxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBQZWRpZG9zIGRlbCBtZXMuLi4nKTtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XHJcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcclxuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcclxuICAgIGlmICghbGluZXMubGVuZ3RoKSBjb250aW51ZTtcclxuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcclxuICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcclxuICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXHJcbiAgICAgICAgICAgIC50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICAgIC5zbGljZSgwLCAxMClcclxuICAgICAgOiAnJztcclxuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xyXG4gICAgICBpZiAoIWwpIHJldHVybjtcclxuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGwucXR5KSB8fCAwO1xyXG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCk7XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYSxcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcclxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcclxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZDogcXR5LFxyXG4gICAgICAgIENhbnRpZGFkX09wZW46IE51bWJlcihsLnF0eU9wZW4pIHx8IDAsXHJcbiAgICAgICAgQ2FudGlkYWRfSW52b2ljZWQ6IE51bWJlcihsLnF0eUludm9pY2VkKSB8fCAwLFxyXG4gICAgICAgIENhbnRpZGFkX0NhbmNlbGxlZDogTnVtYmVyKGwucXR5Q2FuY2VsbGVkKSB8fCAwLFxyXG4gICAgICAgIEVzdGFkb19MaW5lYTogbC5zdGF0ZSB8fCAnJyxcclxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcclxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQocXR5ICogcHJlY2lvKSxcclxuICAgICAgICBDZXJyYWRvOiBwLmNsb3NlZEF0ID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxyXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxyXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuRmVjaGFfUGVkaWRvIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGFfUGVkaWRvIHx8ICcnKSk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZWRpZG9zRGVsTWVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1BlZGlkb3MnLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFBlZGlkb3MgZGVsIG1lcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbi8vIEV4cG9ydGFyIHBhcmEgQW5hbGlzaXM6IHByb3RlZ2lkbyBjb24gUElOXHJcbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1JztcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4cG9ydCBFeGNlbCBUQVJHRVRTLVpPTkFTIC0gc29sbyBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVBcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEdlbmVyYSBsYSBob2phIENMSUVOVEVTX1pPTkFTIGNvbiBVTkEgZmlsYSBwb3IgQlAgcXVlIGVzdGEgdml2byBlbiBTQVA6XHJcbi8vIGN1YWxxdWllciBhbHRhIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgY29uIHN0YXR1cz0nYXBwcm92ZWQnIFkgY2FyZENvZGVTYXBcclxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXHJcbi8vIENhcmRDb2RlIChtb2NrcyBvIHBlbmRpZW50ZXMgZGUgU0FQKS4gRXMgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgZmFjdHVyYS5cclxuLy8gQ29sdW1uYXM6IFRJUE8sIE5STyBDVEUsIFJFR0lPTiwgUFJPVklOQ0lBLCBBU0VTT1IgRVhURVJOTywgQVNFU09SIElOVEVSTk8sXHJcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcclxuLy8gQ09ORElDSU9OIEZJU0NBTCwgVEVMRUZPTk8sIENBUkRDT0RFIFNBUC5cclxud2luZG93LmV4cG9ydFRhcmdldHNab25hcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaWNcdTAwRTEgdHUgY29uZXhpXHUwMEYzbiB5IHJlaW50ZW50XHUwMEUxLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGV4cG9ydGFyIGVsIG1hc3Rlci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBUQVJHRVRTLVpPTkFTLi4uJyk7XHJcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcclxuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxyXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICAgIFBBQ0hJOiAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgfTtcclxuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XHJcbiAgICBjb25zdCBwID0gKHByb3YgfHwgJycpLnRvVXBwZXJDYXNlKCk7XHJcbiAgICBpZiAoWydCVUVOT1MgQUlSRVMnLCAnQ0FQSVRBTCBGRURFUkFMJywgJ0xBIFBBTVBBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQlVFTk9TIEFJUkVTJztcclxuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xyXG4gICAgaWYgKFsnU0FOVEEgRkUnLCAnRU5UUkUgUklPUycsICdDSEFDTycsICdDT1JSSUVOVEVTJywgJ01JU0lPTkVTJywgJ0ZPUk1PU0EnXS5pbmNsdWRlcyhwKSlcclxuICAgICAgcmV0dXJuICdORUEnO1xyXG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XHJcbiAgICBpZiAoWydORVVRVUVOJywgJ1JJTyBORUdSTycsICdDSFVCVVQnLCAnU0FOVEEgQ1JVWicsICdUSUVSUkEgREVMIEZVRUdPJ10uaW5jbHVkZXMocCkpXHJcbiAgICAgIHJldHVybiAnUEFUQUdPTklBJztcclxuICAgIHJldHVybiAnJztcclxuICB9XHJcbiAgZnVuY3Rpb24gdmVuZG9yTGFiZWxGb3JFeGNlbChrZXkpIHtcclxuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XHJcbiAgICBpZiAoa2V5ID09PSAnX19ESVNUUklCVVRPUl9fJykgcmV0dXJuICdESVNUUklCVUlET1JFUyc7XHJcbiAgICByZXR1cm4ga2V5O1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgbGV0IGFsdGFzU25hcDtcclxuICB0cnkge1xyXG4gICAgYWx0YXNTbmFwID0gYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXHJcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcclxuICAgICAgLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcclxuICBhbHRhc1NuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xyXG4gICAgLy8gRmlsdHJvIGNsYXZlOiBzb2xvIEJQcyBjb24gQ2FyZENvZGUgU0FQIGFzaWduYWRvICg9IGhhYmlsaXRhZG8gZW4gU0FQKS5cclxuICAgIGlmICghY2FyZENvZGUpIHtcclxuICAgICAgc2tpcHBlZE5vU2FwKys7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcclxuICAgIGNvbnN0IGxvY2FsaXR5RmluYWwgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcnO1xyXG4gICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIFRJUE86ICdEQURPIERFIEFMVEEnLFxyXG4gICAgICAnTlJPIENURSc6IDAsIC8vIHNlIHJlbnVtZXJhIGRlc3B1ZXMgZGVsIHNvcnRcclxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXHJcbiAgICAgIFBST1ZJTkNJQTogcHJvdmluY2UsXHJcbiAgICAgICdBU0VTT1IgRVhURVJOTyc6IHZlbmRvckxhYmVsRm9yRXhjZWwodmVuZG9yKSxcclxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxyXG4gICAgICBDQUxMRTogYS5jYWxsZSB8fCAnJyxcclxuICAgICAgTlVNRVJPOiBhLm51bWVybyB8fCAnJyxcclxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxyXG4gICAgICBDUDogYS5jcCB8fCAnJyxcclxuICAgICAgJ05PTUJSRSBDT01FUkNJQUwnOiBhLmNvbWVyY2lvIHx8IGEudGl0dWxhciB8fCAnJyxcclxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXHJcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcclxuICAgICAgJ0NPTkRJQ0lPTiBGSVNDQUwnOiBhLmNvbmRpY2lvbkZpc2NhbCB8fCAnJyxcclxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXHJcbiAgICAgICdDQVJEQ09ERSBTQVAnOiBjYXJkQ29kZSxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGlmICghcm93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgcm93cy5zb3J0KChyMSwgcjIpID0+IHtcclxuICAgIGNvbnN0IHAgPSAocjEuUFJPVklOQ0lBIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLlBST1ZJTkNJQSB8fCAnJyk7XHJcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XHJcbiAgICBjb25zdCBsID0gKHIxLkxPQ0FMSURBRCB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5MT0NBTElEQUQgfHwgJycpO1xyXG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xyXG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xyXG4gIH0pO1xyXG4gIHJvd3MuZm9yRWFjaCgociwgaSkgPT4ge1xyXG4gICAgclsnTlJPIENURSddID0gaSArIDE7XHJcbiAgfSk7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxMCB9LFxyXG4gICAgeyB3Y2g6IDE2IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAyOCB9LFxyXG4gICAgeyB3Y2g6IDI4IH0sXHJcbiAgICB7IHdjaDogMjggfSxcclxuICAgIHsgd2NoOiAxMCB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMTAgfSxcclxuICAgIHsgd2NoOiAzOCB9LFxyXG4gICAgeyB3Y2g6IDMyIH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ0xJRU5URVNfWk9OQVMnKTtcclxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdUQVJHRVRTX1ZFTkRFRE9SRVNfWk9OQVNfJyArIHRzICsgJy54bHN4Jyk7XHJcbiAgc2hvd1N5bmNUYWcoXHJcbiAgICAnRXhjZWwgZXhwb3J0YWRvOiAnICtcclxuICAgICAgcm93cy5sZW5ndGggK1xyXG4gICAgICAnIGNsaWVudGVzIFNBUCBoYWJpbGl0YWRvcycgK1xyXG4gICAgICAoc2tpcHBlZE5vU2FwID4gMCA/ICcgKCcgKyBza2lwcGVkTm9TYXAgKyAnIHNpbiBDYXJkQ29kZSBkZXNjYXJ0YWRvcyknIDogJycpXHJcbiAgKTtcclxufTtcclxuXHJcbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgcGluID0gcHJvbXB0KFxyXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xyXG4gICk7XHJcbiAgaWYgKHBpbiA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xyXG4gICAgYWxlcnQoJ1BJTiBpbmNvcnJlY3RvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBPcGNpb24gSW50ZWdyYWNpb24gU0FQOiBzb2xvIHBhcmEgTWFyaWFubyAoZXJiaW5vbWFyaWFub0BnbWFpbC5jb20pXHJcbiAgY29uc3Qgc2FwT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtc2FwLWludGVncmF0aW9uJyk7XHJcbiAgaWYgKHNhcE9wdCkge1xyXG4gICAgY29uc3QgaXNNYXJpYW5vID1cclxuICAgICAgY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nO1xyXG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcclxuICB9XHJcbiAgLy8gT3BjaW9uIEJhY2t1cCBtZW5zdWFsOiBzb2xvIGFkbWluXHJcbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xyXG4gIGlmIChia09wdCkgYmtPcHQuc3R5bGUuZGlzcGxheSA9IHVzZXJSb2xlID09PSAnYWRtaW4nID8gJycgOiAnbm9uZSc7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxud2luZG93LmNsb3NlRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXHJcbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXHJcbi8vIHNvbG8gZGVudHJvIGRlIGVzdGUgYmxvcXVlICh2ZXJpZmljYWRvIHByZS1leHRyYWNjaVx1MDBGM24pLlxyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFnQkEsU0FBTyx1QkFBdUIsV0FBWTtB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
