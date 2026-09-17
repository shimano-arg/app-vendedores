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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBkYXRvcyBjYXJnYWRvcyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIG1hc3RlcmZpbGUgZGUgY2xpZW50ZXMuLi4nKTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gbG9va3VwWm9uZSh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYuem9uZSA6ICcnO1xuICB9XG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xuICAgIHJldHVybiB2ID8gdi5sYWJlbCA6IHZlbmRvcktleSB8fCAnJztcbiAgfVxuXG4gIC8vIHY0NTAgKDIwMjYtMDgtMTEpOiBpbmRpY2UgZGUgY2xhc2lmaWNhY2lvbiBkZXNkZSB2aXNpdHMuIFBhcmEgY2FkYVxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXG4gIC8vIGVzcGVjaWFsaXphY2lvbi9jYW5hbENvbXByYS9wb3AvdGlwb1ZlbnRhL2V0Yy4pIGRlbCBmb3JtdWxhcmlvIGRlXG4gIC8vIHZpc2l0YS9jb250YWN0YWRvLiBQb2xpdGljYTogY2FtcG8gcG9yIGNhbXBvLCB0b21hciBlbCBwcmltZXIgdmFsb3JcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cbiAgLy8gdmUgbGEgY2xhc2lmaWNhY2lvbiBtYXMgYWN0dWFsaXphZGEsIHBlcm8gc2kgZWwgdWx0aW1vIGNvbnRhY3RvIG5vIGxsZW5hXG4gIC8vIHVuIGNhbXBvIChjb250YWN0b3MgdGllbmVuIG1lbm9zIGNhbXBvcyBxdWUgdmlzaXRhcyksIGNhZSBhbCBhbnRlcmlvclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcbiAgLy8gaW50ZXJhY2Npb24gcGVybyBubyBwZXJkZXIgaW5mbyB1dGlsIGRlIGxhcyBhbnRlcmlvcmVzXCIuXG4gIGNvbnN0IENMQVNTSUZfRklFTERTID0gW1xuICAgICd0aXBvJyxcbiAgICAnbG9jYWwnLFxuICAgICd0YW1hbm8nLFxuICAgICdmaWRlbGlkYWQnLFxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxuICAgICdjYW5hbENvbXByYScsXG4gICAgJ3JlbGV2YW5jaWEnLFxuICAgICdwb3AnLFxuICAgICduZWNlc2lkYWRQdW50dWFsJyxcbiAgICAndGlwb1ZlbnRhJyxcbiAgICAncG9uZGVyYWNpb25Nb3N0cmFkbycsXG4gICAgJ3BvbmRlcmFjaW9uRWNvbW1lcmNlJyxcbiAgICAnY29tcGV0ZW5jaWEnLFxuICAgICdvcG9ydHVuaWRhZCcsXG4gICAgJ21hc1ZlbmRpZG8nLFxuICAgICdtYXNQcmVndW50YW4nLFxuICAgICdheXVkYVRpZW5kYScsXG4gIF07XG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIChwcm92IHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkudHJpbSgpICtcbiAgICAgICd8JyArXG4gICAgICAobG9jIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcbiAgICApO1xuICB9XG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xuICAgIGlmICh2ICYmIHYuY3JlYXRlZEF0ICYmIHYuY3JlYXRlZEF0LnRvTWlsbGlzKSByZXR1cm4gdi5jcmVhdGVkQXQudG9NaWxsaXMoKTtcbiAgICBpZiAodiAmJiB2LmZlY2hhKSByZXR1cm4gbmV3IERhdGUodi5mZWNoYSkuZ2V0VGltZSgpIHx8IDA7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgY29uc3QgY2xhc3NpZkluZGV4ID0gbmV3IE1hcCgpOyAvLyBrZXkgLT4geyBsYXN0OiB7Y2FtcG9zfSwgbGFzdEZlY2hhLCBsYXN0VHlwZSwgdmlzaXRhcywgY29udGFjdG9zIH1cbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcbiAgICBjb25zdCBieUtleSA9IG5ldyBNYXAoKTtcbiAgICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICBpZiAoIXYpIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSBfY2xhc3NpZktleSh2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcbiAgICAgIGlmICghYnlLZXkuaGFzKGspKSBieUtleS5zZXQoaywgW10pO1xuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XG4gICAgfSk7XG4gICAgYnlLZXkuZm9yRWFjaCgoYXJyLCBrKSA9PiB7XG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxuICAgICAgY29uc3QgbWVyZ2VkID0ge307XG4gICAgICBhcnIuZm9yRWFjaCgodikgPT4ge1xuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICAgICAgaWYgKG1lcmdlZFtmXSAhPSBudWxsICYmIG1lcmdlZFtmXSAhPT0gJycgJiYgbWVyZ2VkW2ZdICE9PSAwKSByZXR1cm47XG4gICAgICAgICAgY29uc3QgdmFsID0gdltmXTtcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xuICAgICAgY2xhc3NpZkluZGV4LnNldChrLCB7XG4gICAgICAgIG1lcmdlZCxcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXG4gICAgICAgIGxhc3RUeXBlOiBsYXRlc3QuaW50ZXJhY3Rpb25UeXBlIHx8IChsYXRlc3QuZXNwYWNpbyA/ICd2aXNpdGEnIDogJycpLFxuICAgICAgICB2aXNpdGFzOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIGNvbnN0IGVudHJ5ID0gY2xhc3NpZkluZGV4LmdldChfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkpO1xuICAgIGlmICghZW50cnkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAnJyxcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUb3RhbCB2aXNpdGFzJzogMCxcbiAgICAgICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IDAsXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXG4gICAgICAgIExvY2FsOiAnJyxcbiAgICAgICAgVGFtYW5vOiAnJyxcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcbiAgICAgICAgRXNwZWNpYWxpemFjaW9uOiAnJyxcbiAgICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6ICcnLFxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcbiAgICAgICAgUE9QOiAnJyxcbiAgICAgICAgJ05lY2VzaWRhZCBwdW50dWFsJzogJycsXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6ICcnLFxuICAgICAgICBDb21wZXRlbmNpYTogJycsXG4gICAgICAgIE9wb3J0dW5pZGFkOiAnJyxcbiAgICAgICAgJ01hcyB2ZW5kaWRvJzogJycsXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXG4gICAgICAgICdBeXVkYSB0aWVuZGEnOiAnJyxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IG0gPSBlbnRyeS5tZXJnZWQgfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXG4gICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0VHlwZSxcbiAgICAgICdUb3RhbCB2aXNpdGFzJzogZW50cnkudmlzaXRhcyxcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXG4gICAgICAnVGlwbyBjb21lcmNpbyc6IG0udGlwbyB8fCAnJyxcbiAgICAgIExvY2FsOiBtLmxvY2FsIHx8ICcnLFxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcbiAgICAgIEZpZGVsaWRhZDogbS5maWRlbGlkYWQgfHwgJycsXG4gICAgICBFc3BlY2lhbGl6YWNpb246IG0uZXNwZWNpYWxpemFjaW9uIHx8ICcnLFxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXG4gICAgICBSZWxldmFuY2lhOiBtLnJlbGV2YW5jaWEgIT0gbnVsbCA/IG0ucmVsZXZhbmNpYSA6ICcnLFxuICAgICAgUE9QOiBtLnBvcCB8fCAnJyxcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAgICdUaXBvIGRlIHZlbnRhJzogbS50aXBvVmVudGEgfHwgJycsXG4gICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyAhPSBudWxsID8gbS5wb25kZXJhY2lvbk1vc3RyYWRvIDogJycsXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgICBDb21wZXRlbmNpYTogbS5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIE9wb3J0dW5pZGFkOiBtLm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgJ01hcyBwcmVndW50YW4nOiBtLm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgICdBeXVkYSB0aWVuZGEnOiBtLmF5dWRhVGllbmRhIHx8ICcnLFxuICAgIH07XG4gIH1cblxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxuICAvLyBlbCBtYXBhIHkgc2UgY3VlbnRhbiBlbiBlbCBzdGF0IEhBQklMSVRBRE9TLiBBbnRlcyBlbCBtYXN0ZXJmaWxlIGJhamFiYVxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxuICBjb25zdCByb3dzID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xuICAgIGNvbnN0IGxvY2FsaXR5TWFwID0gcC5uYW1lIHx8ICcnO1xuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XG4gICAgLy8gdjMzMTogZmlsdHJhciBwb3Igc2NvcGUgZGUgdmVuZG9yIGRlbCB1c3VhcmlvIHF1ZSBleHBvcnRhLlxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XG4gICAgLy8gU29sbyBjbGllbnRlcyByZWd1bGFyZXMgKG5vIHByb3NwZWN0cywgbm8gZGlzdHJpYnVpZG9yZXMpIHF1ZSBwYXNlblxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY29uc3QgayA9ICdDfCcgKyBwcm92aW5jZSArICd8JyArIGxvY2FsaXR5TWFwICsgJ3wnICsgbmFtZTtcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXG4gICAgICBpZiAodHlwZW9mIGNhbmNlbGVkICE9PSAndW5kZWZpbmVkJyAmJiBjYW5jZWxlZCAmJiBjYW5jZWxlZC5oYXMgJiYgY2FuY2VsZWQuaGFzKGspKVxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cbiAgICAgIGNvbnN0IG1ldGEgPSB0eXBlb2YgY2xpZW50TWV0YSAhPT0gJ3VuZGVmaW5lZCcgJiYgY2xpZW50TWV0YSA/IGNsaWVudE1ldGFba10gfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cbiAgICAgIGNvbnN0IGRvY0lkID1cbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xuICAgICAgY29uc3QgY21EYXRhID1cbiAgICAgICAgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBkb2NJZCA/IGNsaWVudE1hc3RlckNhY2hlLmdldChkb2NJZCkgfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XG4gICAgICBjb25zdCBjdXN0b21MYXQgPSBtZXRhLmxhdCAhPSBudWxsID8gbWV0YS5sYXQgOiAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxuICAgICAgbGV0IGNhcmRDb2RlID0gY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnO1xuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XG4gICAgICAgIGNvbnN0IGFsdGFzID0gYXBwcm92ZWRBbHRhc0J5TG9jW2tleV0gfHwgW107XG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XG4gICAgICB9XG4gICAgICByb3dzLnB1c2goXG4gICAgICAgIE9iamVjdC5hc3NpZ24oXG4gICAgICAgICAge1xuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGNhcmRDb2RlLFxuICAgICAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBuYW1lLFxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiBjdXN0b21OYW1lLFxuICAgICAgICAgICAgVGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgICAgIEVzdGFkbzogZXN0YWRvLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3ZpbmNlKSA6IHByb3ZpbmNlLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2NhbGl0eU1hcCxcbiAgICAgICAgICAgIERlcGFydGFtZW50bzogZGVwdCxcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICAgICAgWm9uYTogem9uZSxcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgICAgIERpcmVjY2lvbjogYWRkcmVzcyxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jYWxpdHlDdXN0LFxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBjdXN0b21MYXQgfHwgbGF0LFxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBjdXN0b21MbmcgfHwgbG9uLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgX2NsYXNzaWZSb3cocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKVxuICAgICAgICApXG4gICAgICApO1xuICAgIH0pO1xuICB9KTtcbiAgLy8gSW55ZWN0YXIgYWx0YXMgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyAoYXBwcm92ZWRBbHRhc0xpc3QpOlxuICAvLyAgICogSEFCSUxJVEFET1M6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi4gVmFuIGNvbiBFc3RhZG89J0hhYmlsaXRhZG8nLlxuICAvLyAgICogUFJPVklTT1JJT1MgKHYzMTErKTogbWFudWFsU2FwUGVuZGluZyAmJiAhY2FyZENvZGVTYXAgKEFsdGEgUmFwaWRhXG4gIC8vICAgICBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLiBWYW4gY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuIFNlXG4gIC8vICAgICBpbmNsdXllbiBwYXJhIHF1ZSBlbCBleHBvcnQgcmVmbGVqZSBlbCB1bml2ZXJzbyBjb21lcmNpYWwgY29tcGxldG9cbiAgLy8gICAgIHF1ZSBlbCBnZXJlbnRlIGVzdGEgZ2VzdGlvbmFuZG8sIG5vIHNvbG8gbG9zIGNlcnJhZG9zIGVuIFNBUC5cbiAgLy8gICAgIExvcyBwcm92aXNvcmlvcyBwdWVkZW4gbm8gdGVuZXIgZGlyZWNjaW9uIHRvZGF2aWEgLT4gc2UgYWNlcHRhbiBpZ3VhbC5cbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgc2Vlbi5hZGQoXG4gICAgICAoci5Qcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKSArICd8JyArIChyWydOb21icmUgdGllbmRhJ10gfHwgJycpLnRvTG93ZXJDYXNlKClcbiAgICApO1xuICB9KTtcbiAgaWYgKHR5cGVvZiBhcHByb3ZlZEFsdGFzTGlzdCAhPT0gJ3VuZGVmaW5lZCcgJiYgYXBwcm92ZWRBbHRhc0xpc3QubGVuZ3RoKSB7XG4gICAgYXBwcm92ZWRBbHRhc0xpc3QuZm9yRWFjaCgoYSkgPT4ge1xuICAgICAgaWYgKCFhKSByZXR1cm47XG4gICAgICBjb25zdCBpc1Byb3Zpc29yaW8gPSAhIWEubWFudWFsU2FwUGVuZGluZyAmJiAhYS5jYXJkQ29kZVNhcDtcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXG4gICAgICAvLyBQcm92aXNvcmlvczogc2luIGNhcmRDb2RlIG5pIGRpcmVjY2lvbiwgdmFuIGlndWFsIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLlxuICAgICAgaWYgKCFpc1Byb3Zpc29yaW8pIHtcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XG4gICAgICAgIGlmICghKGEuY2FsbGUgfHwgYS5hZGRyZXNzKSkgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IG5vbWJyZSA9XG4gICAgICAgIGEuY29tZXJjaW8gfHxcbiAgICAgICAgYS5mYW50YXNpYSB8fFxuICAgICAgICAoYS5jYXJkQ29kZVNhcCA/ICdTQVAgJyArIGEuY2FyZENvZGVTYXAuc2xpY2UoMCwgOCkgOiBhLnRpdHVsYXIgfHwgJ1Byb3Zpc29yaW8nKTtcbiAgICAgIGNvbnN0IGR1cEtleSA9IHByb3YudG9VcHBlckNhc2UoKSArICd8JyArIG5vbWJyZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHNlZW4uaGFzKGR1cEtleSkpIHJldHVybjtcbiAgICAgIHNlZW4uYWRkKGR1cEtleSk7XG4gICAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgICAgLy8gdjMzMTogbWlzbW8gZmlsdHJvIGRlIHNjb3BlIGFwbGljYSBhIGFsdGFzIFNBUC9wcm92aXNvcmlhcy5cbiAgICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xuICAgICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgICAgY29uc3QgbG9jID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnKHNpbiBsb2NhbGlkYWQpJztcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogYS5jYXJkQ29kZVNhcCB8fCAnJyxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcbiAgICAgICAgICAgIFRpcG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvIChBbHRhIHJhcGlkYSknIDogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICAgICAgWm9uYTogem9uZSxcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgICAgIERpcmVjY2lvbjogYS5jYWxsZSB8fCBhLmFkZHJlc3MgfHwgJycsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGEubG5nICE9IG51bGwgPyBhLmxuZyA6ICcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgX2NsYXNzaWZSb3cocHJvdiwgbG9jLCBub21icmUpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBPcmRlbmFyIHBvciBwcm92aW5jaWEsIGxvY2FsaWRhZCwgbm9tYnJlLlxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChhWydOb21icmUgdGllbmRhJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKTtcbiAgfSk7XG5cbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xuICAgICAgICAnRWwgbWFzdGVyZmlsZSBpbmNsdXllOlxcbicgK1xuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xuICAgICAgICAnU2kgbm8gdmVzIG5pbmd1bm8sIHJldmlzYSBlbCBtb2RhbCBTQVAgbyBBbHRhIENsaWVudGVzLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE2IH0sIC8vIENhcmRDb2RlIFNBUFxuICAgIHsgd2NoOiAzOCB9LCAvLyBOb21icmUgdGllbmRhXG4gICAgeyB3Y2g6IDI4IH0sIC8vIEFsaWFzXG4gICAgeyB3Y2g6IDE0IH0sIC8vIFRpcG9cbiAgICB7IHdjaDogMTQgfSwgLy8gRXN0YWRvXG4gICAgeyB3Y2g6IDIyIH0sIC8vIFByb3ZpbmNpYVxuICAgIHsgd2NoOiAyMiB9LCAvLyBMb2NhbGlkYWQgbWFwYVxuICAgIHsgd2NoOiAyMiB9LCAvLyBEZXBhcnRhbWVudG9cbiAgICB7IHdjaDogMjggfSwgLy8gVmVuZGVkb3IgZXh0ZXJub1xuICAgIHsgd2NoOiA4IH0sIC8vIFpvbmFcbiAgICB7IHdjaDogNDggfSwgLy8gRXRpcXVldGEgem9uYVxuICAgIHsgd2NoOiAyOCB9LCAvLyBBc2Vzb3IgaW50ZXJub1xuICAgIHsgd2NoOiAzOCB9LCAvLyBEaXJlY2Npb25cbiAgICB7IHdjaDogMjQgfSwgLy8gTG9jYWxpZGFkIGRlY2xhcmFkYVxuICAgIHsgd2NoOiAxNCB9LCAvLyBMYXRcbiAgICB7IHdjaDogMTQgfSwgLy8gTG5nXG4gICAgLy8gdjQ1MDogY2xhc2lmaWNhY2lvbiBkZXNkZSB2aXNpdHMvY29udGFjdG9zLlxuICAgIHsgd2NoOiAxNCB9LCAvLyBVbHRpbWEgaW50ZXJhY2Npb25cbiAgICB7IHdjaDogMTQgfSwgLy8gVGlwbyB1bHRpbWEgaW50ZXJhY2Npb25cbiAgICB7IHdjaDogMTAgfSwgLy8gVG90YWwgdmlzaXRhc1xuICAgIHsgd2NoOiAxMCB9LCAvLyBUb3RhbCBjb250YWN0b3NcbiAgICB7IHdjaDogMTggfSwgLy8gVGlwbyBjb21lcmNpb1xuICAgIHsgd2NoOiAxNiB9LCAvLyBMb2NhbFxuICAgIHsgd2NoOiAxMiB9LCAvLyBUYW1hbm9cbiAgICB7IHdjaDogMTQgfSwgLy8gRmlkZWxpZGFkXG4gICAgeyB3Y2g6IDIwIH0sIC8vIEVzcGVjaWFsaXphY2lvblxuICAgIHsgd2NoOiAyMCB9LCAvLyBDYW5hbCBkZSBjb21wcmFcbiAgICB7IHdjaDogMTAgfSwgLy8gUmVsZXZhbmNpYVxuICAgIHsgd2NoOiA4IH0sIC8vIFBPUFxuICAgIHsgd2NoOiAyNiB9LCAvLyBOZWNlc2lkYWQgcHVudHVhbFxuICAgIHsgd2NoOiAxNiB9LCAvLyBUaXBvIGRlIHZlbnRhXG4gICAgeyB3Y2g6IDE4IH0sIC8vIFBvbmRlcmFjaW9uIG1vc3RyYWRvclxuICAgIHsgd2NoOiAxOCB9LCAvLyBQb25kZXJhY2lvbiBlLWNvbW1lcmNlXG4gICAgeyB3Y2g6IDI2IH0sIC8vIENvbXBldGVuY2lhXG4gICAgeyB3Y2g6IDI2IH0sIC8vIE9wb3J0dW5pZGFkXG4gICAgeyB3Y2g6IDIyIH0sIC8vIE1hcyB2ZW5kaWRvXG4gICAgeyB3Y2g6IDIyIH0sIC8vIE1hcyBwcmVndW50YW5cbiAgICB7IHdjaDogMjYgfSwgLy8gQXl1ZGEgdGllbmRhXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ2xpZW50ZXMgaGFiaWxpdGFkb3MgU0FQJyk7XG5cbiAgLy8gSG9qYSByZXN1bWVuIHBvciB6b25hXG4gIGNvbnN0IGJ5Wm9uZSA9IHt9O1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBjb25zdCB6ID0gclsnRXRpcXVldGEgem9uYSddIHx8ICdTaW4gem9uYSc7XG4gICAgaWYgKCFieVpvbmVbel0pIGJ5Wm9uZVt6XSA9IHsgdG90YWw6IDAsIGhhYmlsaXRhZG9zOiAwLCBjYW5jZWxhZG9zOiAwIH07XG4gICAgYnlab25lW3pdLnRvdGFsKys7XG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xuICAgIGVsc2UgaWYgKHIuRXN0YWRvID09PSAnQ2FuY2VsYWRvJykgYnlab25lW3pdLmNhbmNlbGFkb3MrKztcbiAgfSk7XG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gT2JqZWN0LmVudHJpZXMoYnlab25lKVxuICAgIC5tYXAoKFt6LCBkXSkgPT4gKHtcbiAgICAgICdab25hIC8gVmVuZGVkb3InOiB6LFxuICAgICAgJ1RvdGFsIHRpZW5kYXMnOiBkLnRvdGFsLFxuICAgICAgSGFiaWxpdGFkYXM6IGQuaGFiaWxpdGFkb3MsXG4gICAgICBDYW5jZWxhZGFzOiBkLmNhbmNlbGFkb3MsXG4gICAgfSkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XG4gIGNvbnN0IHdzUmVzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW5Sb3dzKTtcbiAgd3NSZXNbJyFjb2xzJ10gPSBbeyB3Y2g6IDQ4IH0sIHsgd2NoOiAxNCB9LCB7IHdjaDogMTQgfSwgeyB3Y2g6IDE0IH1dO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1JlcywgJ1Jlc3VtZW4gcG9yIHpvbmEnKTtcblxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIC8vIHYzMzE6IHN1ZmlqbyBjb24gZWwgc2NvcGUgYXBsaWNhZG8gcGFyYSBkaWZlcmVuY2lhciBlbCBhcmNoaXZvIGRlbCBWREUvVkRJXG4gIC8vIGRlbCBleHBvcnQgZ2xvYmFsIGRlbCBhZG1pbi5cbiAgY29uc3Qgc2NvcGVMYmwgPVxuICAgIHNjb3BlU2V0ID09PSBudWxsXG4gICAgICA/ICdUT0RPUydcbiAgICAgIDogc2NvcGVTZXQuc2l6ZSA9PT0gMVxuICAgICAgICA/IFsuLi5zY29wZVNldF1bMF0uc3BsaXQoJyAnKVswXVxuICAgICAgICA6ICdtaXMtem9uYXMtJyArIHNjb3BlU2V0LnNpemU7XG4gIGNvbnN0IGZuYW1lID0gJ01hc3RlcmZpbGVfQ2xpZW50ZXNfU0FQXycgKyBzY29wZUxibCArICdfJyArIHRzICsgJy54bHN4JztcbiAgWExTWC53cml0ZUZpbGUod2IsIGZuYW1lKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArXG4gICAgICAoc2NvcGVTZXQgPT09IG51bGwgPyAnJyA6ICcgKHNjb3BlOiAnICsgWy4uLnNjb3BlU2V0XS5qb2luKCcsICcpICsgJyknKVxuICApO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcbi8vIEZpcmVzdG9yZSkgeSBTVE9DS19NQVAgKGJvb2xlYW5vIHBvciBTS1UgZGVsIHN0b2NrLmpzb24gZGVsIHJlcG8pLlxuLy8gSG9qYXM6XG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXG4vLyAgICAobG8gbWFzIGNvbXVuIHBhcmEgcmV2aXNhciBkaXNwb25pYmlsaWRhZCArIHByZWNpbykuXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cbi8vICAtIFwiSW5mb1wiOiBmZWNoYSBkZSBsb3Mgc25hcHNob3RzIHkgZnVlbnRlcy5cbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoUFJPRFVDVFMpIHx8ICFQUk9EVUNUUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XG4gIC8vIHY1NzQgKDIwMjYtMDgtMjEpOiBwZWRpZG8gZGUgTWFyaWFubyBcdTIwMTQgbW9zdHJhciBVTklEQURFUyBudW1lcmljYXNcbiAgLy8gZXhhY3RhcyBkZWwgZGVwb3NpdG8gMTEgKHZlbnRhKSBlbiB2ZXogZGUgXCJEaXNwb25pYmxlXCIvXCJTaW4gc3RvY2tcIi5cbiAgLy8gVXNhIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIHF1ZSBsZWUgU1RPQ0tfV0FSRUhPVVNFX0JSRUFLRE9XTltza3VdWycxMSddLlxuICAvLyBSZXRvcm5hICcnIChjZWxkYSB2YWNpYSkgY3VhbmRvIG5vIGhheSBkYXRvIGRlIHN0b2NrIChzbmFwc2hvdCBubyBjYXJnYWRvXG4gIC8vIGF1bik7IDAgc2kgZWwgU0tVIG5vIHRpZW5lIHN0b2NrLiBMb3MgbnVtZXJvcyBwZXJtaXRlbiBzb3J0L2ZpbHRlci9zdW0gZW5cbiAgLy8gRXhjZWwgXHUyMDE0IG5vIHBlcmRlbW9zIGVsIGVzdGFkbyBcIm5vIGRhdG9cIiB2cyBcIjAgdW5pZGFkZXNcIiBncmFjaWFzIGFsICcnLlxuICBmdW5jdGlvbiBmbXRTdG9jayhza3UpIHtcbiAgICBjb25zdCBmbiA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXG4gICAgICAgIDogbnVsbDtcbiAgICBjb25zdCB2ID0gZm4gPyBmbihza3UpIDogbnVsbDtcbiAgICBpZiAodiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcih2KSB8fCAwO1xuICB9XG4gIGZ1bmN0aW9uIGZtdFByZWNpbyhza3UpIHtcbiAgICBjb25zdCBwID0gdHlwZW9mIFBSSUNFX0xJU1RfTUFQID09PSAnb2JqZWN0JyAmJiBQUklDRV9MSVNUX01BUCA/IFBSSUNFX0xJU1RfTUFQW3NrdV0gOiBudWxsO1xuICAgIGlmIChwID09IG51bGwpIHJldHVybiAnJztcbiAgICByZXR1cm4gTnVtYmVyKHApIHx8IDA7XG4gIH1cbiAgLy8gSG9qYSAxOiBjb21ibyBjb21wbGV0byAoZXMgbGEgbWFzIHBlZGlkYSkuXG4gIGNvbnN0IHJvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICBGYW1pbGlhOiBwLmZhbSB8fCAnJyxcbiAgICBTdWJmYW1pbGlhOiBwLnN1YiB8fCAnJyxcbiAgICBDYXRlZ29yaWE6IHAuY2F0IHx8ICcnLFxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gICAgJ1N0b2NrIFcxMSc6IGZtdFN0b2NrKHAuY29kZSksXG4gIH0pKS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogNjAgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgXTtcbiAgLy8gQXBsaWNhciBmb3JtYXRvIG1vbmVkYSBhIGxhIGNvbHVtbmEgUHJlY2lvIEFSUyAoY29sdW1uYSBGID0gNikuXG4gIGZvciAobGV0IGkgPSAyOyBpIDw9IHJvd3MubGVuZ3RoICsgMTsgaSsrKSB7XG4gICAgY29uc3QgY2VsbCA9IHdzWydGJyArIGldO1xuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XG4gIH1cbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdQcmVjaW9zIHkgU3RvY2snKTtcblxuICAvLyBIb2phIDI6IHNvbG8gUHJlY2lvc1xuICBjb25zdCBwcmVjaW9zUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gIH0pKVxuICAgIC5maWx0ZXIoKHIpID0+IHJbJ1ByZWNpbyBBUlMnXSAhPT0gJycpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCB3c1AgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocHJlY2lvc1Jvd3MpO1xuICB3c1BbJyFjb2xzJ10gPSBbeyB3Y2g6IDE0IH0sIHsgd2NoOiA2MCB9LCB7IHdjaDogMTQgfV07XG4gIGZvciAobGV0IGkgPSAyOyBpIDw9IHByZWNpb3NSb3dzLmxlbmd0aCArIDE7IGkrKykge1xuICAgIGNvbnN0IGNlbGwgPSB3c1BbJ0MnICsgaV07XG4gICAgaWYgKGNlbGwgJiYgdHlwZW9mIGNlbGwudiA9PT0gJ251bWJlcicpIGNlbGwueiA9ICdcIiRcIiMsIyMwJztcbiAgfVxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1AsICdQcmVjaW9zJyk7XG5cbiAgLy8gSG9qYSAzOiBzb2xvIFN0b2NrXG4gIGNvbnN0IHN0b2NrUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICdTdG9jayBXMTEnOiBmbXRTdG9jayhwLmNvZGUpLFxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHdzUyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChzdG9ja1Jvd3MpO1xuICB3c1NbJyFjb2xzJ10gPSBbeyB3Y2g6IDE0IH0sIHsgd2NoOiA2MCB9LCB7IHdjaDogMTQgfV07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUywgJ1N0b2NrJyk7XG5cbiAgLy8gSG9qYSA0OiBtZXRhZGF0YSAtIGN1YW5kbyBmdWUgY2FkYSBzbmFwc2hvdCBwYXJhIHF1ZSBlbCBsZWN0b3Igc2VwYVxuICAvLyBzaSBsYSBsaXN0YSBlc3RhIGZyZXNjYS5cbiAgY29uc3QgaW5mb1Jvd3MgPSBbXG4gICAgeyBJdGVtOiAnVG90YWwgU0tVcyBlbiBjYXRhbG9nbycsIFZhbG9yOiBQUk9EVUNUUy5sZW5ndGggfSxcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBwcmVjaW8gY2FyZ2FkbycsIFZhbG9yOiBwcmVjaW9zUm93cy5sZW5ndGggfSxcbiAgICB7XG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBjb24gc3RvY2sgZGlzcG9uaWJsZScsXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSB0cnVlKS5sZW5ndGgsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gc3RvY2snLFxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gZmFsc2UpLmxlbmd0aCxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIHNpbiBkYXRvIGRlIHN0b2NrJyxcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT0gbnVsbCkubGVuZ3RoLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgbW9uZWRhJyxcbiAgICAgIFZhbG9yOiB0eXBlb2YgUFJJQ0VfTElTVF9DVVJSRU5DWSAhPT0gJ3VuZGVmaW5lZCcgPyBQUklDRV9MSVNUX0NVUlJFTkNZIDogJ0FSUycsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBhY3R1YWxpemFkYScsXG4gICAgICBWYWxvcjpcbiAgICAgICAgdHlwZW9mIFBSSUNFX0xJU1RfVVBEQVRFRF9BVCAhPT0gJ3VuZGVmaW5lZCcgJiYgUFJJQ0VfTElTVF9VUERBVEVEX0FUXG4gICAgICAgICAgPyBuZXcgRGF0ZShQUklDRV9MSVNUX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXG4gICAgICAgICAgOiAnKG5vIGNhcmdhZGEpJyxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdTdG9jayBzbmFwc2hvdCBhY3R1YWxpemFkbycsXG4gICAgICBWYWxvcjogU1RPQ0tfVVBEQVRFRF9BVCA/IG5ldyBEYXRlKFNUT0NLX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIDogJyhubyBjYXJnYWRvKScsXG4gICAgfSxcbiAgICB7IEl0ZW06ICdFeHBvcnRhZG8nLCBWYWxvcjogbmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdFeHBvcnRhZG8gcG9yJyxcbiAgICAgIFZhbG9yOiAoY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lKSkgfHwgJyhkZXNjb25vY2lkbyknLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IHdzSSA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChpbmZvUm93cyk7XG4gIHdzSVsnIWNvbHMnXSA9IFt7IHdjaDogMzYgfSwgeyB3Y2g6IDM2IH1dO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0ksICdJbmZvJyk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1ByZWNpb3NfeV9TdG9ja18nICsgdHMgKyAnLnhsc3gnKTtcbiAgc2hvd1N5bmNUYWcocm93cy5sZW5ndGggKyAnIFNLVXMgZXhwb3J0YWRvcyAocHJlY2lvcyArIHN0b2NrKScpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxud2luZG93LmV4cG9ydFRvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cbiAgLy8gICB2ZW5kZWRvcjogb3BlcmF0aXZvIGRpYXJpbyAoVmVudGFzIC8gVmlzaXRhcyAvIFJ1dGFzKSArIENsaWVudGVzIGRlIHN1IHpvbmFcbiAgLy8gICAgIChleHBvcnRNYXN0ZXJDbGllbnRlcyB5YSBmaWx0cmEgcG9yIGdldEVmZmVjdGl2ZVZlbmRvclNldCAtPiBzb2xvIHN1IHZlbmRvcikuXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxuICAvLyAgICAgcHJvcGlvIHNpIGVsaWdpbyBzdSBub21icmUgZW4gZWwgZHJvcGRvd24gZGUgem9uYXMpLlxuICAvLyAgIGFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogdmVuIHRvZG8gZWwgbGlzdGFkbyAobnVsbCA9IHNpbiBmaWx0cm8pLlxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBWRU5UQVMgeSBSVVRBUyBlbGltaW5hZG9zIGRlbCBVSSBwb3IgcGVkaWRvIGRlIE1hcmlhbm8uXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gIH07XG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2V4cG9ydC1tb2RhbCAuZXhwLW9wdCcpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2luZCA9IGVsLmRhdGFzZXQuZXhwS2luZCB8fCAnJztcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCkgPyAnJyA6ICdub25lJztcbiAgfSk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmxldCBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XG4gIFZFTlRBUzogJ1ZlbnRhcycsXG4gIFZJU0lUQVM6ICdWaXNpdGFzJyxcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXG4gIFJVVEFTOiAnUnV0YXMnLFxuICBBTFRBUzogJ0FsdGFzIGRlIGNsaWVudGVzJyxcbiAgQkFDS09SREVSOiAnQmFja29yZGVyJyxcbiAgU1RPQ0tfQVNJRzogJ1N0b2NrIEFzaWduYWRvJyxcbiAgUEVESURPU19NRVM6ICdQZWRpZG9zIGRlbCBtZXMnLFxufTtcblxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uICh0aXBvKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXRpdGxlJyk7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcbiAgc3VidC50ZXh0Q29udGVudCA9ICdFbGVnaSBlbCBtZXMgeSBhXHUwMEYxbyBxdWUgcXVlcmVzIGRlc2Nhcmdhci4nO1xuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1lc1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKTtcbiAgbWVzU2VsLmlubmVySFRNTCA9XG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xuICBsZXQgeW9wdHMgPSAnJztcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXG4gICAgeW9wdHMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgeSArICdcIj4nICsgeSArICc8L29wdGlvbj4nO1xuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG59O1xuXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB0aXBvID0gcGVuZGluZ0V4cG9ydFR5cGU7XG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcbiAgY29uc3QgbW9udGhJZHggPSBtZXNSYXcgPT09ICdBTEwnID8gbnVsbCA6IHBhcnNlSW50KG1lc1JhdywgMTApO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG4gIGlmICghdGlwbykgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWSVNJVEFTJykgZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQUxUQVMnKSBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQkFDS09SREVSJykgZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdTVE9DS19BU0lHJykgZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdQRURJRE9TX01FUycpIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0ICcgKyB0aXBvLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGV4cG9ydDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkge1xuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkgcmV0dXJuIFN0cmluZyhhbmlvKTtcbiAgcmV0dXJuIE1FU0VTW21vbnRoSWR4XSArICdfJyArIGFuaW87XG59XG5cbmZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzKSB7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXG4gICAgICBzLnJvd3MubGVuZ3RoID8gcy5yb3dzIDogW3sgQXZpc286ICdTaW4gZGF0b3MgcGFyYSBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkbycgfV1cbiAgICApO1xuICAgIGlmIChzLnJvd3MubGVuZ3RoKSB7XG4gICAgICBjb25zdCBjb2xzID0gT2JqZWN0LmtleXMocy5yb3dzWzBdKS5tYXAoKGspID0+ICh7XG4gICAgICAgIHdjaDogTWF0aC5taW4oNDAsIE1hdGgubWF4KDEwLCBrLmxlbmd0aCArIDQpKSxcbiAgICAgIH0pKTtcbiAgICAgIHdzWychY29scyddID0gY29scztcbiAgICB9XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsIHMubmFtZS5zbGljZSgwLCAzMSkpO1xuICB9XG4gIFhMU1gud3JpdGVGaWxlKHdiLCBmaWxlbmFtZSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldE1lcyA9IG1vbnRoSWR4ICE9PSBudWxsID8gTUVTRVNbbW9udGhJZHhdLnRvVXBwZXJDYXNlKCkgOiBudWxsO1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xuICAgIGl0ZW1zLnB1c2godik7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMgeSBDb250YWN0b3MnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnQW5pbycsIGtleTogJ2FuaW8nLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnSW50ZXJhY2Npb24nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnRm9ybWEgQ29udGFjdG8nLCBrZXk6ICdmb3JtYUNvbnRhY3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdSZXN1bHRhZG8gQ29udGFjdG8nLCBrZXk6ICdyZXN1bHRhZG9DdCcsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnUHJvdmluY2lhJywga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRmlkZWxpZGFkJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdOZWNlc2lkYWQgUHVudHVhbCcsIGtleTogJ25lYycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBWZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBQcmVndW50YW4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnQXl1ZGEgVGllbmRhJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gVmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgTW9zdHJhZG9yJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywga2V5OiAncEVjb20nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBTdGF0dXMnLCBrZXk6ICdncHNTdCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnR1BTIERpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFbiBub21icmUgZGUgVkRFJywga2V5OiAnb25CZWhhbGYnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NhcmdhZG8gUG9yJywga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcbiAgY29uc3QgUk9XX0ggPSAxMDA7XG4gIGNvbnN0IElNR19XID0gMTMwO1xuICBjb25zdCBJTUdfSCA9IDkwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XG4gICAgaWYgKGlzQ29udGFjdG8pIHtcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcbiAgICB9XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcbiAgICAgIGFuaW86IHYuYW5pbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcbiAgICAgIGZvcm1hQ29udGFjdG86IGZvcm1hQ29udGFjdG9MYmwsXG4gICAgICByZXN1bHRhZG9DdDogcmVzdWx0YWRvQ3RMYmwsXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgbmVjOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxuICAgICAgZ3BzU3Q6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdi5ncHNEaXN0YW5jZU0gIT0gbnVsbCA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXG4gICAgICBvbkJlaGFsZjogdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICBjcmVhdGVkQnk6IHYuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgdi5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdDb25jZXB0bycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdOIFRpY2tldCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnTW9kbyBwYWdvJywga2V5OiAnbW9kb1BhZ28nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gZ2FzdG8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0RpdmlzaW9uJywga2V5OiAnZGl2aXNpb24nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNb25lZGEnLCBrZXk6ICdtb25lZGEnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUgVVNEJywga2V5OiAnaW1wb3J0ZVVzZCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byB0aWNrZXQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFc3RhZG8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvcicsIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG8gZW4nLCBrZXk6ICdhcHJvYmFkb0VuJywgd2lkdGg6IDE0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcbiAgY29uc3QgUk9XX0ggPSAxMTA7XG4gIGNvbnN0IElNR19XID0gMTQwO1xuICBjb25zdCBJTUdfSCA9IDEwMDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgciA9IGl0LnI7XG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XG4gICAgY29uc3Qgb2JzU3RyID1cbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBlbWFpbDogci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxuICAgICAgbW9kb1BhZ286IHIubW9kb1BhZ28gfHwgJycsXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxuICAgICAgZGl2aXNpb246IHIuZGl2aXNpb25HYXN0byB8fCAnJyxcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXG4gICAgICBtb25lZGE6IHIubW9uZWRhIHx8ICdQRVNPUycsXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcbiAgICAgIG9iczogb2JzU3RyLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcbiAgICAgIGFwcm9iYWRvcjogci5hcHByb3ZlckVtYWlsIHx8IHIuYXByb2JhZG9yIHx8ICcnLFxuICAgICAgYXByb2JhZG9FbjpcbiAgICAgICAgci5hcHByb3ZlZEF0ICYmIHIuYXBwcm92ZWRBdC50b0RhdGUgPyByLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBTSUVNUFJFIGVtYmViZXIgbGEgZm90byAobm8gZGVqYXIgaHlwZXJsaW5rKS5cbiAgICAvLyBBbnRlczogc2kgZm90b1RpY2tldFVybCAoU3RvcmFnZSksIHF1ZWRhYmEgY29tbyBoeXBlcmxpbmsgQWJyaXIgdGlja2V0LlxuICAgIC8vIEFob3JhOiBmZXRjaCBkZWwgVVJMICsgY29udmVydGlyIGEgYXJyYXlCdWZmZXIgKyBlbWJlYmVyIGlndWFsIHF1ZSBkYXRhVVJMLlxuICAgIC8vIEZhbGxiYWNrIGEgaHlwZXJsaW5rIHNvbG8gc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCwgZXRjKS5cbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBmZXRjaCBsYSBmb3RvIGRlc2RlIFN0b3JhZ2UgeSBlbWJlYmVybGEgY29tbyBpbWFnZW4uXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2goci5mb3RvVGlja2V0VXJsKTtcbiAgICAgICAgaWYgKCFyZXNwLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHJlc3Auc3RhdHVzKTtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwLmhlYWRlcnMuZ2V0KCdjb250ZW50LXR5cGUnKSB8fCAnaW1hZ2UvanBlZyc7XG4gICAgICAgIGxldCBleHQgPSBjb250ZW50VHlwZS5zcGxpdCgnLycpWzFdIHx8ICdqcGVnJztcbiAgICAgICAgZXh0ID0gZXh0LnNwbGl0KCc7JylbMF0udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHJlc3AuYXJyYXlCdWZmZXIoKTtcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYnVmZmVyOiBidWYsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBGYWxsYmFjazogc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCksIGRlamFyIGh5cGVybGluayBjb21vIGFudGVzLlxuICAgICAgICBjb25zb2xlLndhcm4oJ2ZldGNoIGZvdG8gcmVuZGljaW9uIGZhbGxvLCBkZWpvIGh5cGVybGluaycsIGl0LmlkLCBlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XG4gICAgICAgICAgY2VsbC52YWx1ZSA9IHtcbiAgICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxuICAgICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXG4gICAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXIgKGZldGNoIGZhbGxvKScsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XG4gICAgICAgIH0gY2F0Y2ggKF9lMikge31cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUlVUQVM6IHJ1dGFzIGFzaWduYWRhcyBkZWwgcGVyaW9kbyArIG92ZXJyaWRlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPVxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXG4gICAgICA6IGFzc2lnbmVkVmVuZG9yXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxuICAgICAgICA6IFtdO1xuICBjb25zdCBtb250aHNUb0V4cG9ydCA9IG1vbnRoSWR4ICE9PSBudWxsID8gW21vbnRoSWR4XSA6IFswLCAxLCAyLCAzLCA0LCA1LCA2LCA3LCA4LCA5LCAxMCwgMTFdO1xuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2YgbW9udGhzVG9FeHBvcnQpIHtcbiAgICAgIGxldCBydXRhcztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgcnV0YXMgPSBbXTtcbiAgICAgIH1cbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPdmVycmlkZXNcbiAgbGV0IG92clNuYXA7XG4gIHRyeSB7XG4gICAgb3ZyU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm91dGVfb3ZlcnJpZGVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgb3ZyU25hcCA9IG51bGw7XG4gIH1cbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xuICBpZiAob3ZyU25hcCkge1xuICAgIG92clNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxuICAgICAgICBNZXM6IE1FU0VTW3BhcnNlSW50KG8ubW9udGhJZHgsIDEwKV0gfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBvLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcbiAgICAgICAgRGVyaXZhZGFfQTogby5kZXJpdmFkYUEgfHwgJycsXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX1Bvcjogby5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX0VuOlxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1J1dGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcbiAgICB7IG5hbWU6ICdEZXJpdmFjaW9uZXMtUmVhZ2VuZGFzJywgcm93czogb3ZlcnJpZGVzUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBSdXRhcyBsaXN0byAoJyArIHJ1dGFzUm93cy5sZW5ndGggKyAnIHRpZW5kYXMsICcgKyBvdmVycmlkZXNSb3dzLmxlbmd0aCArICcgb3ZlcnJpZGVzKScsXG4gICAgMjQwMFxuICApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFMVEFTOiBzb2xpY2l0dWRlcyBkZSBhbHRhIGRlIGNsaWVudGUgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSAnJztcbiAgICBpZiAoYS5jcmVhdGVkQXQgJiYgYS5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXG4gICAgICBBcHJvYmFkb19FbjpcbiAgICAgICAgYS5hcHByb3ZlZEF0ICYmIGEuYXBwcm92ZWRBdC50b0RhdGUgPyBhLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEFsdGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIHNvbGljaXR1ZGVzKScsIDI0MDApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHY3MDkgKDIwMjYtMDgtMjgpOiAzIGV4cG9ydHMgbnVldm9zIHBlZGlkb3MgcG9yIE1hcmlhbm8uXG4vLyAtIEJBQ0tPUkRFUjogbGluZWFzIHN0YXRlPUJPIG9wZW4gcG9yIG1lcyBkZSBjcmVhdGVkQXQgZGVsIHBlZGlkby5cbi8vIC0gU1RPQ0tfQVNJRzogbGluZWFzIEFTSUcgb3BlbiAobyBCTytzdG9jayBkaXNwKSBwb3IgbWVzIGRlIGNyZWF0ZWRBdC5cbi8vIC0gUEVESURPU19NRVM6IFRPRE9TIGxvcyBwZWRpZG9zIGNyZWFkb3MgZW4gZWwgbWVzL2FuaW8gKGN1YWxxdWllciBzdGFnZSkuXG4vLyBGdWVudGU6IGdsb2JhbFBlZGlkb3MgKGxvIHF1ZSBsYSBhcHAgeWEgdGllbmUgZW4gbWVtb3JpYSkuXG4vLyBGaWx0ZXIgbWVzL2FcdTAwRjFvOiBzb2JyZSBjcmVhdGVkQXQgZGVsIHBlZGlkby4gbW9udGhJZHg9bnVsbCAtPiBhXHUwMEYxbyBlbnRlcm8uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmZ1bmN0aW9uIF9wZWRpZG9Nb250aFllYXIocCkge1xuICBjb25zdCBjYSA9IHAuY3JlYXRlZEF0O1xuICBpZiAoIWNhKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIGxldCBkdCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY2EgPT09ICdzdHJpbmcnKSBkdCA9IG5ldyBEYXRlKGNhKTtcbiAgZWxzZSBpZiAodHlwZW9mIGNhLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICBkdCA9IGNhLnRvRGF0ZSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGVsc2UgaWYgKHR5cGVvZiBjYSA9PT0gJ251bWJlcicpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBpZiAoIWR0IHx8IE51bWJlci5pc05hTihkdC5nZXRUaW1lKCkpKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIHJldHVybiB7IHk6IGR0LmdldEZ1bGxZZWFyKCksIG06IGR0LmdldE1vbnRoKCkgfTtcbn1cblxuZnVuY3Rpb24gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGNvbnN0IGFyciA9XG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gIHJldHVybiBhcnIuZmlsdGVyKChwKSA9PiB7XG4gICAgaWYgKCFwKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgeyB5LCBtIH0gPSBfcGVkaWRvTW9udGhZZWFyKHApO1xuICAgIGlmICh5ID09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoeSAhPT0gYW5pbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBtICE9PSBtb250aElkeCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyLi4uJyk7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSB7XG4gICAgaWYgKHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcbiAgICAgIGlmICghbCB8fCBsLnN0YXRlICE9PSAnQk8nKSByZXR1cm47XG4gICAgICBjb25zdCBxbyA9IE51bWJlcihsLnF0eU9wZW4pIHx8IDA7XG4gICAgICBpZiAocW8gPD0gMCkgcmV0dXJuO1xuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBwLmNyZWF0ZWRBdFxuICAgICAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcbiAgICAgICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcbiAgICAgICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgICAgIC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6ICcnLFxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXG4gICAgICAgIENhbnRpZGFkX1BlZGlkYTogTnVtYmVyKGwucXR5KSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSxcbiAgICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSB8fCAwKSksXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXG4gICAgICAgIFNRX0RvY051bTogcC50cmFuc2Zlcmlkb1NBUCA/IHAudHJhbnNmZXJpZG9TQVAuZG9jTnVtIHx8ICcnIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkby4uLicpO1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCBnZXRTdGsgPVxuICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcbiAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXG4gICAgICA6IG51bGw7XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSB7XG4gICAgaWYgKHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcbiAgICAgIGlmICghbCkgcmV0dXJuO1xuICAgICAgY29uc3QgcW8gPSBOdW1iZXIobC5xdHlPcGVuKSB8fCAwO1xuICAgICAgaWYgKHFvIDw9IDApIHJldHVybjtcbiAgICAgIGxldCB2aXJ0dWFsID0gZmFsc2U7XG4gICAgICBpZiAobC5zdGF0ZSA9PT0gJ0FTSUcnKSB7XG4gICAgICAgIC8vIG9rIHJlc2VydmEgZmlybWVcbiAgICAgIH0gZWxzZSBpZiAobC5zdGF0ZSA9PT0gJ0JPJykge1xuICAgICAgICAvLyB2aXJ0dWFsIHNvbG8gc2kgaGF5IHN0b2NrIGRpc3BcbiAgICAgICAgaWYgKCFnZXRTdGspIHJldHVybjtcbiAgICAgICAgY29uc3Qgc3RrID0gZ2V0U3RrKGwuY29kZSkgfHwgMDtcbiAgICAgICAgaWYgKHN0ayA8PSAwKSByZXR1cm47XG4gICAgICAgIHZpcnR1YWwgPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBwLmNyZWF0ZWRBdFxuICAgICAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcbiAgICAgICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcbiAgICAgICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgICAgIC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6ICcnLFxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXG4gICAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcW8sXG4gICAgICAgIEVzdGFkb19SZWFsOiB2aXJ0dWFsID8gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKScgOiAnQVNJRycsXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApLFxuICAgICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHFvICogKE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSB8fCAwKSksXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG4vLyB2NzM3ICgyMDI2LTA4LTMwKTogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG9zIGxvcyBiYWNrb3JkZXJzIG9wZW4gKHNpbiBmaWx0cm9cbi8vIGRlIG1lcykuIE1vdGl2bzogbG9zIDYyIHBlZGlkb3MgbWlncmFkb3MgZGVzZGUgU0FQIGVsIDIwMjYtMDgtMjggdGllbmVuXG4vLyBjcmVhdGVkQXQgZGUgZmVjaGFzIHZpZWphcyBkZWwgU0FQIFNRIG9yaWdpbmFsLCBlbnRvbmNlcyBlbCBleHBvcnQgcG9yIG1lc1xuLy8gbm8gbG9zIGluY2x1aWEuIFZlcnNpb24gXCJjdXJyZW50IHN0YXR1c1wiIHF1ZSBpdGVyYSBnbG9iYWxQZWRpZG9zIGNvbXBsZXRvLlxud2luZG93LmV4cG9ydEJhY2tvcmRlckFsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgY29uc3QgYXJyID1cbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgbGV0IHRvdGFsUGVkaWRvc09wZW4gPSAwO1xuICBmb3IgKGNvbnN0IHAgb2YgYXJyKSB7XG4gICAgaWYgKCFwIHx8IHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xuICAgIHRvdGFsUGVkaWRvc09wZW4rKztcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XG4gICAgICBpZiAoIWwgfHwgbC5zdGF0ZSAhPT0gJ0JPJykgcmV0dXJuO1xuICAgICAgY29uc3QgcW8gPSBOdW1iZXIobC5xdHlPcGVuKSB8fCAwO1xuICAgICAgaWYgKHFvIDw9IDApIHJldHVybjtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIEZlY2hhX1BlZGlkbzogcC5jcmVhdGVkQXRcbiAgICAgICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXG4gICAgICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXG4gICAgICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICAgICAgICAuc2xpY2UoMCwgMTApXG4gICAgICAgICAgOiAnJyxcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxuICAgICAgICBDYW50aWRhZF9QZWRpZGE6IE51bWJlcihsLnF0eSkgfHwgMCxcbiAgICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCksXG4gICAgICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZChxbyAqIChOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCkgfHwgMCkpLFxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxuICAgICAgICBPcmlnZW46IHAubWlncmF0aW9uU291cmNlIHx8ICdhcHAnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoXG4gICAgICAnRXhwb3J0IEJhY2tvcmRlciB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgc3RhdGU9Qk8gY29uIHF0eU9wZW4+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IGJhY2tvcmRlciBhYmllcnRvIGFob3JhIG1pc21vICh0b2RvIGNvbmZpcm1lZCBvIGNlcnJhZG8pXFxuJyArXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcbiAgICAgICAgJzMuIExhcyBsaW5lYXMgQk8gdGllbmVuIHF0eU9wZW49MCAoeWEgZGVzcGFjaGFkYXMgdmlhIEFTSUctPmNsb3NlZCknXG4gICAgKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlcjogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl9TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufTtcblxuLy8gdjczNzogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG8gZWwgU3RvY2sgQXNpZ25hZG8gKHNpbiBmaWx0cm8gZGUgbWVzKS4gTWlzbW9cbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxud2luZG93LmV4cG9ydFN0b2NrQXNpZ0FsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8gKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBhcnIgPVxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xuICBjb25zdCBnZXRTdGsgPVxuICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcbiAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXG4gICAgICA6IG51bGw7XG4gIGxldCB0b3RhbFBlZGlkb3NPcGVuID0gMDtcbiAgbGV0IGFzaWdDb3VudCA9IDA7XG4gIGxldCBib1dpdGhTdG9ja0NvdW50ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIGFycikge1xuICAgIGlmICghcCB8fCBwLmNsb3NlZEF0KSBjb250aW51ZTtcbiAgICB0b3RhbFBlZGlkb3NPcGVuKys7XG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xuICAgICAgaWYgKCFsKSByZXR1cm47XG4gICAgICBjb25zdCBxbyA9IE51bWJlcihsLnF0eU9wZW4pIHx8IDA7XG4gICAgICBpZiAocW8gPD0gMCkgcmV0dXJuO1xuICAgICAgbGV0IHZpcnR1YWwgPSBmYWxzZTtcbiAgICAgIGlmIChsLnN0YXRlID09PSAnQVNJRycpIHtcbiAgICAgICAgYXNpZ0NvdW50Kys7XG4gICAgICB9IGVsc2UgaWYgKGwuc3RhdGUgPT09ICdCTycpIHtcbiAgICAgICAgaWYgKCFnZXRTdGspIHJldHVybjtcbiAgICAgICAgY29uc3Qgc3RrID0gZ2V0U3RrKGwuY29kZSkgfHwgMDtcbiAgICAgICAgaWYgKHN0ayA8PSAwKSByZXR1cm47XG4gICAgICAgIHZpcnR1YWwgPSB0cnVlO1xuICAgICAgICBib1dpdGhTdG9ja0NvdW50Kys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBGZWNoYV9QZWRpZG86IHAuY3JlYXRlZEF0XG4gICAgICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxuICAgICAgICAgICAgICAgIC50b0lTT1N0cmluZygpXG4gICAgICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogJycsXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWRfUmVzZXJ2YWRhOiBxbyxcbiAgICAgICAgRXN0YWRvX1JlYWw6IHZpcnR1YWwgPyAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJyA6ICdBU0lHJyxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCksXG4gICAgICAgIFN1YnRvdGFsX1Jlc2VydmFkb19BUlM6IE1hdGgucm91bmQocW8gKiAoTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApIHx8IDApKSxcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcbiAgICAgICAgU1FfRG9jTnVtOiBwLnRyYW5zZmVyaWRvU0FQID8gcC50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gfHwgJycgOiAnJyxcbiAgICAgICAgT3JpZ2VuOiBwLm1pZ3JhdGlvblNvdXJjZSB8fCAnYXBwJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgc3RhdGU9QVNJRyBjb24gcXR5T3Blbj4wOiAnICtcbiAgICAgICAgYXNpZ0NvdW50ICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgc3RhdGU9Qk8gY29uIHN0b2NrIGRpc3BvbmlibGUgKHZpcnR1YWwgQVNJRyk6ICcgK1xuICAgICAgICBib1dpdGhTdG9ja0NvdW50ICtcbiAgICAgICAgJ1xcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IHN0b2NrIGFzaWduYWRvIGFob3JhIG1pc21vXFxuJyArXG4gICAgICAgICcyLiBUb2RvIGVsIHN0b2NrIGVzdGEgcGVuZGllbnRlIHNpbiBhc2lnbmFyIChtb2RlIEJPIHB1cm8gc2luIHN0b2NrKVxcbicgK1xuICAgICAgICAnMy4gTG9zIHBlZGlkb3MgdGllbmVuIGNsb3NlZEF0IHNldGVhZG8nXG4gICAgKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWc6IDAgbGluZWFzICh2ZXIgYWxlcnRhKScsIDMwMDApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb19TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdTdG9jayBBc2lnbmFkbycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWduYWRvIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn07XG5cbi8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXN1ZWx2ZSBub21icmUgZGUgZmFudGFzaWEgcGFyYSB1biBwZWRpZG8gdXNhbmRvIGVsXG4vLyBtaXNtbyBwYXR0ZXJuIHF1ZSBsYXMgY2FyZHMgZGVsIG1hcGEgKGluZGV4Lmh0bWw6OTkxNS05OTM1KTpcbi8vICAgMSkgY2xpZW50TWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWEgKGVkaXRhZG8gZGVzZGUgZWwgbW9kYWwgY2xpZW50ZSlcbi8vICAgMikgYXBwcm92ZWRBbHRhc0xpc3RbXS5mYW50YXNpYSBtYXRjaGVhZG8gcG9yIGNvbWVyY2lvID09IGNsaWVudE5hbWVcbmZ1bmN0aW9uIF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCkge1xuICBjb25zdCBjYXJkQ29kZSA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gIGlmIChjYXJkQ29kZSkge1xuICAgIGNvbnN0IG1ldGEgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmNsaWVudE1ldGE7XG4gICAgY29uc3QgY3VzdG9tID0gbWV0YSAmJiBtZXRhW2NhcmRDb2RlXSAmJiBtZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYTtcbiAgICBpZiAoY3VzdG9tICYmIFN0cmluZyhjdXN0b20pLnRyaW0oKSkgcmV0dXJuIFN0cmluZyhjdXN0b20pLnRyaW0oKTtcbiAgfVxuICBjb25zdCBhbHRhcyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuYXBwcm92ZWRBbHRhc0xpc3Q7XG4gIGlmIChBcnJheS5pc0FycmF5KGFsdGFzKSkge1xuICAgIGNvbnN0IG5hbWVMb3dlciA9IFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChuYW1lTG93ZXIpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4ge1xuICAgICAgICBpZiAoIWEpIHJldHVybiBmYWxzZTtcbiAgICAgICAgY29uc3QgYyA9IFN0cmluZyhhLmNvbWVyY2lvIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZiA9IFN0cmluZyhhLmZhbnRhc2lhIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIGMgPT09IG5hbWVMb3dlciB8fCBmID09PSBuYW1lTG93ZXI7XG4gICAgICB9KTtcbiAgICAgIGlmIChtYXRjaCAmJiBtYXRjaC5mYW50YXNpYSAmJiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnJztcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFBlZGlkb3MgZGVsIG1lcy4uLicpO1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykge1xuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgY29udGludWU7XG4gICAgY29uc3QgZmVjaGEgPSBwLmNyZWF0ZWRBdFxuICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXG4gICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcbiAgICAgICAgICAgIC50b0lTT1N0cmluZygpXG4gICAgICAgICAgICAuc2xpY2UoMCwgMTApXG4gICAgICA6ICcnO1xuICAgIC8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXNvbHZlciBmYW50YXNpYSB1bmEgdmV6IHBvciBwZWRpZG8gKG5vIHBvciBsaW5lYSkgXHUyMDE0XG4gICAgLy8gZWwgbG9va3VwIGVuIGNsaWVudE1ldGEgKyBhcHByb3ZlZEFsdGFzTGlzdCBlcyBjb25zdGFudGUgcGFyYSB0b2RvIGVsIHBlZGlkby5cbiAgICBjb25zdCBub21icmVMb2NhbEZhbnRhc2lhID0gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKTtcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcbiAgICAgIGlmICghbCkgcmV0dXJuO1xuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApO1xuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYSxcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxuICAgICAgICBTdGFnZTogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBOb21icmVfTG9jYWxfRmFudGFzaWE6IG5vbWJyZUxvY2FsRmFudGFzaWEsXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBDYW50aWRhZF9PcGVuOiBOdW1iZXIobC5xdHlPcGVuKSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9JbnZvaWNlZDogTnVtYmVyKGwucXR5SW52b2ljZWQpIHx8IDAsXG4gICAgICAgIENhbnRpZGFkX0NhbmNlbGxlZDogTnVtYmVyKGwucXR5Q2FuY2VsbGVkKSB8fCAwLFxuICAgICAgICBFc3RhZG9fTGluZWE6IGwuc3RhdGUgfHwgJycsXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQocXR5ICogcHJlY2lvKSxcbiAgICAgICAgQ2VycmFkbzogcC5jbG9zZWRBdCA/ICdTSScgOiAnTk8nLFxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5GZWNoYV9QZWRpZG8gfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG8gfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZWRpZG9zRGVsTWVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdQZWRpZG9zJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgUGVkaWRvcyBkZWwgbWVzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1Jztcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ05FQSc7XG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xuICAgIHJldHVybiAnJztcbiAgfVxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xuICAgIHJldHVybiBrZXk7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBsZXQgYWx0YXNTbmFwO1xuICB0cnkge1xuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcbiAgICAgIC5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXG4gICAgaWYgKCFjYXJkQ29kZSkge1xuICAgICAgc2tpcHBlZE5vU2FwKys7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xuICB9KTtcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgclsnTlJPIENURSddID0gaSArIDE7XG4gIH0pO1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XG4gIHdzWychY29scyddID0gW1xuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiAxNiB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAyOCB9LFxuICAgIHsgd2NoOiAyOCB9LFxuICAgIHsgd2NoOiAyOCB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiAzOCB9LFxuICAgIHsgd2NoOiAzMiB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAyNCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICBdO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0NMSUVOVEVTX1pPTkFTJyk7XG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdUQVJHRVRTX1ZFTkRFRE9SRVNfWk9OQVNfJyArIHRzICsgJy54bHN4Jyk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeGNlbCBleHBvcnRhZG86ICcgK1xuICAgICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcbiAgICAgIChza2lwcGVkTm9TYXAgPiAwID8gJyAoJyArIHNraXBwZWROb1NhcCArICcgc2luIENhcmRDb2RlIGRlc2NhcnRhZG9zKScgOiAnJylcbiAgKTtcbn07XG5cbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwaW4gPSBwcm9tcHQoXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xuICApO1xuICBpZiAocGluID09PSBudWxsKSByZXR1cm47XG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxuICBjb25zdCBzYXBPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1zYXAtaW50ZWdyYXRpb24nKTtcbiAgaWYgKHNhcE9wdCkge1xuICAgIGNvbnN0IGlzTWFyaWFubyA9XG4gICAgICBjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSc7XG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPcGNpb24gQmFja3VwIG1lbnN1YWw6IHNvbG8gYWRtaW5cbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWdCQSxTQUFPLHVCQUF1QixXQUFZO0FBQ3hDLFFBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsWUFBTSxpRkFBaUY7QUFDdkY7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLFFBQVE7QUFDN0IsWUFBTSxnQ0FBZ0M7QUFDdEM7QUFBQSxJQUNGO0FBQ0EsZ0JBQVkscUNBQXFDO0FBUWpELFVBQU0sV0FDSixPQUFPLDBCQUEwQixhQUM3QixzQkFBc0IsT0FBTyxr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LEtBQUssSUFBSSxjQUFjLEVBQUUsZUFBZSxLQUFLLEVBQUU7QUFBQSxJQUMxRSxDQUFDO0FBRUQsUUFBSSxDQUFDLEtBQUssUUFBUTtBQUNoQjtBQUFBLFFBQ0U7QUFBQSxNQUtGO0FBQ0E7QUFBQSxJQUNGO0FBRUEsVUFBTSxLQUFLLEtBQUssTUFBTSxTQUFTO0FBQy9CLFVBQU0sS0FBSyxLQUFLLE1BQU0sY0FBYyxJQUFJO0FBQ3hDLE9BQUcsT0FBTyxJQUFJO0FBQUEsTUFDWixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssRUFBRTtBQUFBO0FBQUEsTUFDVCxFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUE7QUFBQSxNQUVWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7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
