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
        if (typeof isSapConfirmed !== "function" || !isSapConfirmed(province, localityMap, name)) return;
        const k = "C|" + province + "|" + localityMap + "|" + name;
        let estado = "Habilitado";
        if (typeof canceled !== "undefined" && canceled && canceled.has && canceled.has(k)) estado = "Cancelado";
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
        rows.push({
          "CardCode SAP": cardCode,
          "Nombre tienda": name,
          "Alias (modal)": customName,
          "Tipo": "Cliente actual",
          "Estado": estado,
          "Provincia": typeof titleCase === "function" ? titleCase(province) : province,
          "Localidad (mapa)": localityMap,
          "Departamento": dept,
          "Vendedor externo (VDE)": vendor,
          "Zona": zone,
          "Etiqueta zona": lookupVendorLabel(vendor),
          "Asesor interno (VDI)": vdi,
          "Direccion": address,
          "Localidad declarada": localityCust,
          "Lat (geocode)": customLat || lat,
          "Lng (geocode)": customLng || lon
        });
      });
    });
    const seen = /* @__PURE__ */ new Set();
    rows.forEach((r) => seen.add((r.Provincia || "").toString().toUpperCase() + "|" + (r["Nombre tienda"] || "").toLowerCase()));
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
        rows.push({
          "CardCode SAP": a.cardCodeSap || "",
          "Nombre tienda": nombre,
          "Alias (modal)": "",
          "Tipo": isProvisorio ? "Provisorio (Alta rapida)" : "Cliente actual",
          "Estado": isProvisorio ? "Provisorio" : "Habilitado",
          "Provincia": typeof titleCase === "function" ? titleCase(prov) : prov,
          "Localidad (mapa)": loc,
          "Departamento": "",
          "Vendedor externo (VDE)": vendor,
          "Zona": zone,
          "Etiqueta zona": lookupVendorLabel(vendor),
          "Asesor interno (VDI)": vdi,
          "Direccion": a.calle || a.address || "",
          "Localidad declarada": loc,
          "Lat (geocode)": a.lat != null ? a.lat : "",
          "Lng (geocode)": a.lng != null ? a.lng : ""
        });
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
      alert("No hay clientes para exportar.\n\nEl masterfile incluye:\n  * Habilitados en SAP (cardCode + direccion cargados).\n  * Provisorios (Alta rapida pendiente de carga a SAP).\n\nSi no ves ninguno, revisa el modal SAP o Alta Clientes.");
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
      { wch: 14 }
      // Lng
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
      "Habilitadas": d.habilitados,
      "Canceladas": d.cancelados
    })).sort((a, b) => b["Total tiendas"] - a["Total tiendas"]);
    const wsRes = XLSX.utils.json_to_sheet(resumenRows);
    wsRes["!cols"] = [{ wch: 48 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsRes, "Resumen por zona");
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const scopeLbl = scopeSet === null ? "TODOS" : scopeSet.size === 1 ? [...scopeSet][0].split(" ")[0] : "mis-zonas-" + scopeSet.size;
    const fname = "Masterfile_Clientes_SAP_" + scopeLbl + "_" + ts + ".xlsx";
    XLSX.writeFile(wb, fname);
    showSyncTag(rows.length + " clientes exportados" + (scopeSet === null ? "" : " (scope: " + [...scopeSet].join(", ") + ")"));
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
      const v = typeof hasStock === "function" ? hasStock(sku) : null;
      if (v === true) return "Disponible";
      if (v === false) return "Sin stock";
      return "Sin dato";
    }
    function fmtPrecio(sku) {
      const p = typeof PRICE_LIST_MAP === "object" && PRICE_LIST_MAP ? PRICE_LIST_MAP[sku] : null;
      if (p == null) return "";
      return Number(p) || 0;
    }
    const rows = PRODUCTS.map((p) => ({
      "SKU": p.code || "",
      "Descripcion": p.desc || "",
      "Familia": p.fam || "",
      "Subfamilia": p.sub || "",
      "Categoria": p.cat || "",
      "Precio ARS": fmtPrecio(p.code),
      "Stock W11": fmtStock(p.code)
    })).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 60 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
    for (let i = 2; i <= rows.length + 1; i++) {
      const cell = ws["F" + i];
      if (cell && typeof cell.v === "number") cell.z = '"$"#,##0';
    }
    XLSX.utils.book_append_sheet(wb, ws, "Precios y Stock");
    const preciosRows = PRODUCTS.map((p) => ({ SKU: p.code || "", Descripcion: p.desc || "", "Precio ARS": fmtPrecio(p.code) })).filter((r) => r["Precio ARS"] !== "").sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const wsP = XLSX.utils.json_to_sheet(preciosRows);
    wsP["!cols"] = [{ wch: 14 }, { wch: 60 }, { wch: 14 }];
    for (let i = 2; i <= preciosRows.length + 1; i++) {
      const cell = wsP["C" + i];
      if (cell && typeof cell.v === "number") cell.z = '"$"#,##0';
    }
    XLSX.utils.book_append_sheet(wb, wsP, "Precios");
    const stockRows = PRODUCTS.map((p) => ({ SKU: p.code || "", Descripcion: p.desc || "", "Stock W11": fmtStock(p.code) })).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const wsS = XLSX.utils.json_to_sheet(stockRows);
    wsS["!cols"] = [{ wch: 14 }, { wch: 60 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsS, "Stock");
    const infoRows = [
      { Item: "Total SKUs en catalogo", Valor: PRODUCTS.length },
      { Item: "Total SKUs con precio cargado", Valor: preciosRows.length },
      { Item: "Total SKUs con stock disponible", Valor: PRODUCTS.filter((p) => hasStock(p.code) === true).length },
      { Item: "Total SKUs sin stock", Valor: PRODUCTS.filter((p) => hasStock(p.code) === false).length },
      { Item: "Total SKUs sin dato de stock", Valor: PRODUCTS.filter((p) => hasStock(p.code) == null).length },
      { Item: "Lista de precios moneda", Valor: typeof PRICE_LIST_CURRENCY !== "undefined" ? PRICE_LIST_CURRENCY : "ARS" },
      { Item: "Lista de precios actualizada", Valor: typeof PRICE_LIST_UPDATED_AT !== "undefined" && PRICE_LIST_UPDATED_AT ? new Date(PRICE_LIST_UPDATED_AT).toLocaleString("es-AR") : "(no cargada)" },
      { Item: "Stock snapshot actualizado", Valor: STOCK_UPDATED_AT ? new Date(STOCK_UPDATED_AT).toLocaleString("es-AR") : "(no cargado)" },
      { Item: "Exportado", Valor: (/* @__PURE__ */ new Date()).toLocaleString("es-AR") },
      { Item: "Exportado por", Valor: currentUser && (currentUser.email || currentUser.displayName) || "(desconocido)" }
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
      vendedor: /* @__PURE__ */ new Set(["VENTAS", "VISITAS", "RUTAS", "MASTER"]),
      interno: /* @__PURE__ */ new Set(["VENTAS", "VISITAS", "RUTAS", "MASTER"])
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
    ALTAS: "Altas de clientes"
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
    for (let y = year - 3; y <= year + 1; y++) yopts += '<option value="' + y + '">' + y + "</option>";
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
    const anio = parseInt(document.getElementById("em-anio").value);
    const monthIdx = mesRaw === "ALL" ? null : parseInt(mesRaw);
    document.getElementById("export-month-modal").classList.remove("open");
    pendingExportType = null;
    if (!tipo) return;
    try {
      if (tipo === "VENTAS") exportVentasForMonth(anio, monthIdx);
      else if (tipo === "VISITAS") exportVisitasForMonth(anio, monthIdx);
      else if (tipo === "RENDICIONES") exportRendicionesForMonth(anio, monthIdx);
      else if (tipo === "RUTAS") exportRutasForMonth(anio, monthIdx);
      else if (tipo === "ALTAS") exportAltasForMonth(anio, monthIdx);
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
      const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Aviso: "Sin datos para el periodo seleccionado" }]);
      if (s.rows.length) {
        const cols = Object.keys(s.rows[0]).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 4)) }));
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
      if (parseInt(p.year) !== anio) return;
      if (monthIdx !== null && parseInt(p.monthIdx) !== monthIdx) return;
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
  function lookupVendorForClient(prov, locName, clientName) {
    if (!prov || !locName) return "";
    const pt = POINTS.find((p) => p.province === prov && p.name === locName);
    return pt ? pt.vendor || "" : "";
  }
  async function exportVisitasForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Visitas...");
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
      if (parseInt(v.anio) !== anio) return;
      if (targetMes && (v.mes || "").toUpperCase() !== targetMes) return;
      items.push(v);
    });
    if (!items.length) {
      alert("No hay visitas en el periodo seleccionado.");
      return;
    }
    try {
      await loadExcelJS();
    } catch (e) {
      alert(e.message || e);
      return;
    }
    showSyncTag("Generando Excel con " + items.length + " visitas...", 3e3);
    const wb = new ExcelJS.Workbook();
    wb.creator = "App Vendedores Shimano";
    wb.created = /* @__PURE__ */ new Date();
    const ws = wb.addWorksheet("Visitas", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Mes", key: "mes", width: 10 },
      { header: "Anio", key: "anio", width: 8 },
      { header: "Vendedor", key: "vendedor", width: 22 },
      { header: "Owner Email", key: "email", width: 28 },
      { header: "Tipo Contacto", key: "tipoCt", width: 12 },
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
      const tipoContactoLbl = v.tipoContacto === "telefono" ? "Telefono" : "Presencial";
      const row = ws.addRow({
        fecha: v.fecha || "",
        mes: v.mes || "",
        anio: v.anio || "",
        vendedor: titleCase(v.vendor || ""),
        email: v.ownerEmail || "",
        tipoCt: tipoContactoLbl,
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
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Shimano_Visitas_" + periodLabel(anio, monthIdx) + ".xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5e3);
      showSyncTag("Export Visitas listo (" + items.length + " filas)", 2400);
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
        } catch (e) {
        }
      }
      if (!dt) return;
      const dObj = new Date(dt);
      if (isNaN(dObj.getTime())) return;
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
          cell.value = { text: "Abrir ticket", hyperlink: r.fotoTicketUrl, tooltip: "Abrir la foto del ticket en el browser" };
          cell.font = { color: { argb: "FF0563C1" }, underline: true };
        } catch (e) {
          console.warn("hyperlink foto rendicion", it.id, e);
        }
      }
    }
    try {
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
        } catch (e) {
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
    } catch (e) {
      ovrSnap = null;
    }
    const overridesRows = [];
    if (ovrSnap) {
      ovrSnap.forEach((d) => {
        const o = d.data() || {};
        if (parseInt(o.anio) !== anio) return;
        if (monthIdx !== null && parseInt(o.monthIdx) !== monthIdx) return;
        overridesRows.push({
          Anio: o.anio || "",
          Mes: MESES[parseInt(o.monthIdx)] || "",
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
    showSyncTag("Export Rutas listo (" + rutasRows.length + " tiendas, " + overridesRows.length + " overrides)", 2400);
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
        } catch (e) {
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
      if (["SANTA FE", "ENTRE RIOS", "CHACO", "CORRIENTES", "MISIONES", "FORMOSA"].includes(p)) return "NEA";
      if (["JUJUY", "SALTA", "TUCUMAN", "CATAMARCA", "SANTIAGO DEL ESTERO"].includes(p)) return "NOA";
      if (["NEUQUEN", "RIO NEGRO", "CHUBUT", "SANTA CRUZ", "TIERRA DEL FUEGO"].includes(p)) return "PATAGONIA";
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
        "REGION": regionOf(province),
        "PROVINCIA": province,
        "ASESOR EXTERNO": vendorLabelForExcel(vendor),
        "ASESOR INTERNO": VDE_TO_VDI[vendor] || "",
        "CALLE": a.calle || "",
        "NUMERO": a.numero || "",
        "LOCALIDAD": localityFinal,
        "CP": a.cp || "",
        "NOMBRE COMERCIAL": a.comercio || a.titular || "",
        "NOMBRE DE FANTASIA": a.fantasia || "",
        "CUIT": a.cuit || "",
        "CONDICION FISCAL": a.condicionFiscal || "",
        "TELEFONO": a.telefono || "",
        "CARDCODE SAP": cardCode
      });
    });
    if (!rows.length) {
      alert("No hay clientes habilitados en SAP todavia.\n\nUna alta entra al export solo cuando tiene CardCode SAP asignado.");
      return;
    }
    rows.sort((r1, r2) => {
      const p = (r1.PROVINCIA || "").localeCompare(r2.PROVINCIA || "");
      if (p !== 0) return p;
      const l = (r1.LOCALIDAD || "").localeCompare(r2.LOCALIDAD || "");
      if (l !== 0) return l;
      return (r1["NOMBRE COMERCIAL"] || "").localeCompare(r2["NOMBRE COMERCIAL"] || "");
    });
    rows.forEach((r, i) => r["NRO CTE"] = i + 1);
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
    showSyncTag("Excel exportado: " + rows.length + " clientes SAP habilitados" + (skippedNoSap > 0 ? " (" + skippedNoSap + " sin CardCode descartados)" : ""));
  };
  window.openExportAnalisis = function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.");
      return;
    }
    const pin = prompt("Esta seccion contiene formatos avanzados (Power BI, Python/ML, ZIP de fotos) destinados a analisis tecnico.\n\nIngresa el PIN para continuar:");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xyXG4vLyBFWFBPUlRTLUNPUkU6IG1hc3RlcmZpbGUgY2xpZW50ZXMgKyBwcmVjaW9zL3N0b2NrICsgbW9kYWwgZGUgZXhwb3J0YXIgK1xyXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxyXG4vLyBGcmFnbWVudG9zIHJlc3RhbnRlcyBkZWwgZG9taW5pbyBleHBvcnRzOiBhZHZhbmNlZCAofjEwMzAyLTExNDUxKSB5IFNBUFxyXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgTUFTVEVSRklMRSBERSBDTElFTlRFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxyXG4vLyBub21icmUsIHRpcG8gKGNsaWVudGUvcHJvc3BlY3RvKSwgem9uYSBkZWwgdmVuZGVkb3IsIGFzZXNvciBleHRlcm5vLCBhc2Vzb3JcclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxyXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxyXG4vLyBjb29yZGVuYWRhcyBnZW9jb2RpZmljYWRhcywgZXN0YWRvIChIYWJpbGl0YWRvL1BlbmRpZW50ZS9DYW5jZWxhZG8pLFxyXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cclxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIVBPSU5UUyB8fCAhUE9JTlRTLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBkYXRvcyBjYXJnYWRvcyB0b2RhdmlhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIG1hc3RlcmZpbGUgZGUgY2xpZW50ZXMuLi4nKTtcclxuICAvLyBTY29wZSBwb3IgdmVuZG9yICh2MzMxKTogZWwgZXhwb3J0IHJlc3BldGEgZWwgZmlsdHJvIGRlIHpvbmEgYWN0aXZvIGVuIGVsXHJcbiAgLy8gZHJvcGRvd24uIEFkbWluL2dlcmVudGUvdmlld2VyIGNvbiAnVG9kYXMnIG9idGllbmVuIG51bGwgLT4gc2luIGZpbHRyb1xyXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcclxuICAvLyBzdXMgcGFyZWphcyArIHByb3BpbyBzaSBlbGlnaW8gJ1RvZGFzIG1pcyB6b25hcycsIG8gc29sbyBlbCBzdWJzZXQgcXVlXHJcbiAgLy8gZWxpZ2lvIChwcm9waW8gLyB1bmEgcGFyZWphIGVzcGVjaWZpY2EpLiBGdWVyYSBkZSBlc3RlIHNldCwgbGFzIHRpZW5kYXNcclxuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcclxuICAvLyBlbiBlbCBtYXBhIHF1aWVuIGV4cG9ydGEuXHJcbiAgY29uc3Qgc2NvcGVTZXQgPSAodHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJylcclxuICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcclxuICAgIDogbnVsbDtcclxuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xyXG4gICAgaWYgKHNjb3BlU2V0ID09PSBudWxsKSByZXR1cm4gdHJ1ZTtcclxuICAgIGlmICghdmVuZG9yS2V5KSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XHJcbiAgfTtcclxuICAvLyBNYXBlbyBWREUgLT4gVkRJIChhIHBhcnRpciBkZSBsYXMgcGFyZWphcyBlc3RhbmRhcikuIEN1YW5kbyB1bmEgdGllbmRhXHJcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXHJcbiAgLy8gbyBNYXJ0aW4sIGVsIFZESSBlcyBTYW50aWFnby4gU2kgZW4gZWwgZnV0dXJvIHNlIHJlYXNpZ25hbiBwYXJlamFzIHZpYVxyXG4gIC8vIHBhbmVsIGFkbWluLCBlc3RvIHNlIHBvZHJpYSBsZWVyIGRlbCBGaXJlc3RvcmUgLSBwZXJvIHBhcmEgZWwgbWFzdGVyZmlsZVxyXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXHJcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcclxuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogICAgJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxyXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICAgICAgICAgICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICAgICdNQVJUSU4gQk9JRVJPJzogICAgICAgICAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgfTtcclxuICBmdW5jdGlvbiBsb29rdXBab25lKHZlbmRvcktleSl7XHJcbiAgICBjb25zdCB2ID0gKHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJykgPyBWRU5ET1JTLmZpbmQodnYgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcclxuICAgIHJldHVybiB2ID8gdi56b25lIDogJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSl7XHJcbiAgICBjb25zdCB2ID0gKHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJykgPyBWRU5ET1JTLmZpbmQodnYgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcclxuICAgIHJldHVybiB2ID8gdi5sYWJlbCA6ICh2ZW5kb3JLZXkgfHwgJycpO1xyXG4gIH1cclxuXHJcbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxyXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxyXG4gIC8vIGVsIG1hcGEgeSBzZSBjdWVudGFuIGVuIGVsIHN0YXQgSEFCSUxJVEFET1MuIEFudGVzIGVsIG1hc3RlcmZpbGUgYmFqYWJhXHJcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xyXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBQT0lOVFMuZm9yRWFjaChwID0+IHtcclxuICAgIGNvbnN0IHByb3ZpbmNlID0gcC5wcm92aW5jZSB8fCAnJztcclxuICAgIGNvbnN0IGxvY2FsaXR5TWFwID0gcC5uYW1lIHx8ICcnO1xyXG4gICAgY29uc3QgZGVwdCA9IHAuZGVwdCB8fCAnJztcclxuICAgIGNvbnN0IHZlbmRvciA9IHAudmVuZG9yIHx8ICcnO1xyXG4gICAgLy8gdjMzMTogZmlsdHJhciBwb3Igc2NvcGUgZGUgdmVuZG9yIGRlbCB1c3VhcmlvIHF1ZSBleHBvcnRhLlxyXG4gICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcclxuICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XHJcbiAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XHJcbiAgICBjb25zdCBsYXQgPSAocC5sYXQgIT0gbnVsbCkgPyBwLmxhdCA6ICcnO1xyXG4gICAgY29uc3QgbG9uID0gKHAubG9uICE9IG51bGwpID8gcC5sb24gOiAnJztcclxuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cclxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxyXG4gICAgKHAuY2xpZW50cyB8fCBbXSkuZm9yRWFjaChuYW1lID0+IHtcclxuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XHJcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpIHJldHVybjtcclxuICAgICAgY29uc3QgayA9ICdDfCcgKyBwcm92aW5jZSArICd8JyArIGxvY2FsaXR5TWFwICsgJ3wnICsgbmFtZTtcclxuICAgICAgLy8gRXN0YWRvOiBoYWJpbGl0YWRvL2NhbmNlbGFkby9wZW5kaWVudGUgKGxlZ2FjeSBjb250YWN0ZWQgc2V0KS5cclxuICAgICAgbGV0IGVzdGFkbyA9ICdIYWJpbGl0YWRvJzsgLy8gcG9yIGRlZmluaWNpb24geWEgZXN0YSBTQVAtY29uZmlybWFkb1xyXG4gICAgICBpZiAodHlwZW9mIGNhbmNlbGVkICE9PSAndW5kZWZpbmVkJyAmJiBjYW5jZWxlZCAmJiBjYW5jZWxlZC5oYXMgJiYgY2FuY2VsZWQuaGFzKGspKSBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcclxuICAgICAgLy8gTWV0YWRhdGEgY3VzdG9tIChkaXJlY2Npb24sIGxvY2FsaWRhZCBkZWNsYXJhZGEsIGdlb2NvZGUpLlxyXG4gICAgICBjb25zdCBtZXRhID0gKHR5cGVvZiBjbGllbnRNZXRhICE9PSAndW5kZWZpbmVkJyAmJiBjbGllbnRNZXRhKSA/IChjbGllbnRNZXRhW2tdIHx8IHt9KSA6IHt9O1xyXG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xyXG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cclxuICAgICAgY29uc3QgZG9jSWQgPSAodHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nKSA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcclxuICAgICAgY29uc3QgY21EYXRhID0gKHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQpID8gKGNsaWVudE1hc3RlckNhY2hlLmdldChkb2NJZCkgfHwge30pIDoge307XHJcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGxvY2FsaXR5Q3VzdCA9IGNtRGF0YS5sb2NhbGlkYWQgfHwgbWV0YS5sb2NhbGl0eSB8fCAnJztcclxuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gKG1ldGEubGF0ICE9IG51bGwpID8gbWV0YS5sYXQgOiAnJztcclxuICAgICAgY29uc3QgY3VzdG9tTG5nID0gKG1ldGEubG5nICE9IG51bGwpID8gbWV0YS5sbmcgOiAnJztcclxuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxyXG4gICAgICBsZXQgY2FyZENvZGUgPSBjbURhdGEuc2FwQ2FyZENvZGUgfHwgJyc7XHJcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XHJcbiAgICAgICAgY29uc3QgYWx0YXMgPSBhcHByb3ZlZEFsdGFzQnlMb2Nba2V5XSB8fCBbXTtcclxuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKGEgPT4gKGEuY29tZXJjaW8gfHwgYS5mYW50YXNpYSB8fCAnJykgPT09IG5hbWUpO1xyXG4gICAgICAgIGlmIChhbHRhTWF0Y2gpIGNhcmRDb2RlID0gYWx0YU1hdGNoLmNhcmRDb2RlU2FwIHx8ICcnO1xyXG4gICAgICB9XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgJ0NhcmRDb2RlIFNBUCc6ICAgICAgICAgICAgIGNhcmRDb2RlLFxyXG4gICAgICAgICdOb21icmUgdGllbmRhJzogICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICdBbGlhcyAobW9kYWwpJzogICAgICAgICAgICBjdXN0b21OYW1lLFxyXG4gICAgICAgICdUaXBvJzogICAgICAgICAgICAgICAgICAgICAnQ2xpZW50ZSBhY3R1YWwnLFxyXG4gICAgICAgICdFc3RhZG8nOiAgICAgICAgICAgICAgICAgICBlc3RhZG8sXHJcbiAgICAgICAgJ1Byb3ZpbmNpYSc6ICAgICAgICAgICAgICAgICh0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nKSA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcclxuICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6ICAgICAgICAgbG9jYWxpdHlNYXAsXHJcbiAgICAgICAgJ0RlcGFydGFtZW50byc6ICAgICAgICAgICAgIGRlcHQsXHJcbiAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiAgIHZlbmRvcixcclxuICAgICAgICAnWm9uYSc6ICAgICAgICAgICAgICAgICAgICAgem9uZSxcclxuICAgICAgICAnRXRpcXVldGEgem9uYSc6ICAgICAgICAgICAgbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcclxuICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiAgICAgdmRpLFxyXG4gICAgICAgICdEaXJlY2Npb24nOiAgICAgICAgICAgICAgICBhZGRyZXNzLFxyXG4gICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogICAgICBsb2NhbGl0eUN1c3QsXHJcbiAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiAgICAgICAgICAgIGN1c3RvbUxhdCB8fCBsYXQsXHJcbiAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiAgICAgICAgICAgIGN1c3RvbUxuZyB8fCBsb24sXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgLy8gSW55ZWN0YXIgYWx0YXMgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyAoYXBwcm92ZWRBbHRhc0xpc3QpOlxyXG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXHJcbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxyXG4gIC8vICAgICBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLiBWYW4gY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuIFNlXHJcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xyXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXHJcbiAgLy8gICAgIExvcyBwcm92aXNvcmlvcyBwdWVkZW4gbm8gdGVuZXIgZGlyZWNjaW9uIHRvZGF2aWEgLT4gc2UgYWNlcHRhbiBpZ3VhbC5cclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIHJvd3MuZm9yRWFjaChyID0+IHNlZW4uYWRkKCgoci5Qcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKSkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpKSk7XHJcbiAgaWYgKHR5cGVvZiBhcHByb3ZlZEFsdGFzTGlzdCAhPT0gJ3VuZGVmaW5lZCcgJiYgYXBwcm92ZWRBbHRhc0xpc3QubGVuZ3RoKSB7XHJcbiAgICBhcHByb3ZlZEFsdGFzTGlzdC5mb3JFYWNoKGEgPT4ge1xyXG4gICAgICBpZiAoIWEpIHJldHVybjtcclxuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XHJcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXHJcbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXHJcbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XHJcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XHJcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcclxuICAgICAgY29uc3Qgbm9tYnJlID0gYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8IChhLmNhcmRDb2RlU2FwXHJcbiAgICAgICAgPyAoJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSlcclxuICAgICAgICA6IChhLnRpdHVsYXIgfHwgJ1Byb3Zpc29yaW8nKSk7XHJcbiAgICAgIGNvbnN0IGR1cEtleSA9IHByb3YudG9VcHBlckNhc2UoKSArICd8JyArIG5vbWJyZS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICBpZiAoc2Vlbi5oYXMoZHVwS2V5KSkgcmV0dXJuO1xyXG4gICAgICBzZWVuLmFkZChkdXBLZXkpO1xyXG4gICAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xyXG4gICAgICAvLyB2MzMxOiBtaXNtbyBmaWx0cm8gZGUgc2NvcGUgYXBsaWNhIGEgYWx0YXMgU0FQL3Byb3Zpc29yaWFzLlxyXG4gICAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xyXG4gICAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xyXG4gICAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XHJcbiAgICAgIGNvbnN0IGxvYyA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyhzaW4gbG9jYWxpZGFkKSc7XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgJ0NhcmRDb2RlIFNBUCc6ICAgICAgICAgICAgIGEuY2FyZENvZGVTYXAgfHwgJycsXHJcbiAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiAgICAgICAgICAgIG5vbWJyZSxcclxuICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICAgICAgICAgICAgJycsXHJcbiAgICAgICAgJ1RpcG8nOiAgICAgICAgICAgICAgICAgICAgIGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvIChBbHRhIHJhcGlkYSknIDogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICAnRXN0YWRvJzogICAgICAgICAgICAgICAgICAgaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxyXG4gICAgICAgICdQcm92aW5jaWEnOiAgICAgICAgICAgICAgICAodHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJykgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxyXG4gICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogICAgICAgICBsb2MsXHJcbiAgICAgICAgJ0RlcGFydGFtZW50byc6ICAgICAgICAgICAgICcnLFxyXG4gICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogICB2ZW5kb3IsXHJcbiAgICAgICAgJ1pvbmEnOiAgICAgICAgICAgICAgICAgICAgIHpvbmUsXHJcbiAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiAgICAgICAgICAgIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXHJcbiAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogICAgIHZkaSxcclxuICAgICAgICAnRGlyZWNjaW9uJzogICAgICAgICAgICAgICAgYS5jYWxsZSB8fCBhLmFkZHJlc3MgfHwgJycsXHJcbiAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiAgICAgIGxvYyxcclxuICAgICAgICAnTGF0IChnZW9jb2RlKSc6ICAgICAgICAgICAgKGEubGF0ICE9IG51bGwgPyBhLmxhdCA6ICcnKSxcclxuICAgICAgICAnTG5nIChnZW9jb2RlKSc6ICAgICAgICAgICAgKGEubG5nICE9IG51bGwgPyBhLmxuZyA6ICcnKSxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcclxuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcclxuICAgIGNvbnN0IGwgPSAoYVsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJyk7XHJcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XHJcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xyXG4gIH0pO1xyXG5cclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJ1xyXG4gICAgICArICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJ1xyXG4gICAgICArICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJ1xyXG4gICAgICArICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJ1xyXG4gICAgICArICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHt3Y2g6MTZ9LCAvLyBDYXJkQ29kZSBTQVBcclxuICAgIHt3Y2g6Mzh9LCAvLyBOb21icmUgdGllbmRhXHJcbiAgICB7d2NoOjI4fSwgLy8gQWxpYXNcclxuICAgIHt3Y2g6MTR9LCAvLyBUaXBvXHJcbiAgICB7d2NoOjE0fSwgLy8gRXN0YWRvXHJcbiAgICB7d2NoOjIyfSwgLy8gUHJvdmluY2lhXHJcbiAgICB7d2NoOjIyfSwgLy8gTG9jYWxpZGFkIG1hcGFcclxuICAgIHt3Y2g6MjJ9LCAvLyBEZXBhcnRhbWVudG9cclxuICAgIHt3Y2g6Mjh9LCAvLyBWZW5kZWRvciBleHRlcm5vXHJcbiAgICB7d2NoOjh9LCAgLy8gWm9uYVxyXG4gICAge3djaDo0OH0sIC8vIEV0aXF1ZXRhIHpvbmFcclxuICAgIHt3Y2g6Mjh9LCAvLyBBc2Vzb3IgaW50ZXJub1xyXG4gICAge3djaDozOH0sIC8vIERpcmVjY2lvblxyXG4gICAge3djaDoyNH0sIC8vIExvY2FsaWRhZCBkZWNsYXJhZGFcclxuICAgIHt3Y2g6MTR9LCAvLyBMYXRcclxuICAgIHt3Y2g6MTR9LCAvLyBMbmdcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ2xpZW50ZXMgaGFiaWxpdGFkb3MgU0FQJyk7XHJcblxyXG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxyXG4gIGNvbnN0IGJ5Wm9uZSA9IHt9O1xyXG4gIHJvd3MuZm9yRWFjaChyID0+IHtcclxuICAgIGNvbnN0IHogPSByWydFdGlxdWV0YSB6b25hJ10gfHwgJ1NpbiB6b25hJztcclxuICAgIGlmICghYnlab25lW3pdKSBieVpvbmVbel0gPSB7dG90YWw6IDAsIGhhYmlsaXRhZG9zOiAwLCBjYW5jZWxhZG9zOiAwfTtcclxuICAgIGJ5Wm9uZVt6XS50b3RhbCsrO1xyXG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xyXG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gT2JqZWN0LmVudHJpZXMoYnlab25lKS5tYXAoKFt6LCBkXSkgPT4gKHtcclxuICAgICdab25hIC8gVmVuZGVkb3InOiB6LFxyXG4gICAgJ1RvdGFsIHRpZW5kYXMnOiAgIGQudG90YWwsXHJcbiAgICAnSGFiaWxpdGFkYXMnOiAgICAgZC5oYWJpbGl0YWRvcyxcclxuICAgICdDYW5jZWxhZGFzJzogICAgICBkLmNhbmNlbGFkb3MsXHJcbiAgfSkpLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XHJcbiAgY29uc3Qgd3NSZXMgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocmVzdW1lblJvd3MpO1xyXG4gIHdzUmVzWychY29scyddID0gW3t3Y2g6NDh9LHt3Y2g6MTR9LHt3Y2g6MTR9LHt3Y2g6MTR9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1JlcywgJ1Jlc3VtZW4gcG9yIHpvbmEnKTtcclxuXHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7XHJcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcclxuICAvLyBkZWwgZXhwb3J0IGdsb2JhbCBkZWwgYWRtaW4uXHJcbiAgY29uc3Qgc2NvcGVMYmwgPSAoc2NvcGVTZXQgPT09IG51bGwpXHJcbiAgICA/ICdUT0RPUydcclxuICAgIDogKHNjb3BlU2V0LnNpemUgPT09IDEgPyBbLi4uc2NvcGVTZXRdWzBdLnNwbGl0KCcgJylbMF0gOiAoJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZSkpO1xyXG4gIGNvbnN0IGZuYW1lID0gJ01hc3RlcmZpbGVfQ2xpZW50ZXNfU0FQXycgKyBzY29wZUxibCArICdfJyArIHRzICsgJy54bHN4JztcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgZm5hbWUpO1xyXG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArIChzY29wZVNldCA9PT0gbnVsbCA/ICcnIDogJyAoc2NvcGU6ICcgKyBbLi4uc2NvcGVTZXRdLmpvaW4oJywgJykgKyAnKScpKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcclxuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcclxuLy8gRmlyZXN0b3JlKSB5IFNUT0NLX01BUCAoYm9vbGVhbm8gcG9yIFNLVSBkZWwgc3RvY2suanNvbiBkZWwgcmVwbykuXHJcbi8vIEhvamFzOlxyXG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXHJcbi8vICAgIChsbyBtYXMgY29tdW4gcGFyYSByZXZpc2FyIGRpc3BvbmliaWxpZGFkICsgcHJlY2lvKS5cclxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXHJcbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cclxuLy8gIC0gXCJJbmZvXCI6IGZlY2hhIGRlIGxvcyBzbmFwc2hvdHMgeSBmdWVudGVzLlxyXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIUFycmF5LmlzQXJyYXkoUFJPRFVDVFMpIHx8ICFQUk9EVUNUUy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgY2F0YWxvZ28gZGUgcHJvZHVjdG9zIGNhcmdhZG8gdG9kYXZpYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBwcmVjaW9zICsgc3RvY2suLi4nKTtcclxuICAvLyBIZWxwZXIgZGUgZm9ybWF0byBkZSBzdG9jayBwYXJhIHF1ZSBzZWEgbGVnaWJsZSBlbiBFeGNlbC5cclxuICBmdW5jdGlvbiBmbXRTdG9jayhza3Upe1xyXG4gICAgY29uc3QgdiA9ICh0eXBlb2YgaGFzU3RvY2sgPT09ICdmdW5jdGlvbicpID8gaGFzU3RvY2soc2t1KSA6IG51bGw7XHJcbiAgICBpZiAodiA9PT0gdHJ1ZSkgcmV0dXJuICdEaXNwb25pYmxlJztcclxuICAgIGlmICh2ID09PSBmYWxzZSkgcmV0dXJuICdTaW4gc3RvY2snO1xyXG4gICAgcmV0dXJuICdTaW4gZGF0byc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGZtdFByZWNpbyhza3Upe1xyXG4gICAgY29uc3QgcCA9ICh0eXBlb2YgUFJJQ0VfTElTVF9NQVAgPT09ICdvYmplY3QnICYmIFBSSUNFX0xJU1RfTUFQKSA/IFBSSUNFX0xJU1RfTUFQW3NrdV0gOiBudWxsO1xyXG4gICAgaWYgKHAgPT0gbnVsbCkgcmV0dXJuICcnO1xyXG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xyXG4gIH1cclxuICAvLyBIb2phIDE6IGNvbWJvIGNvbXBsZXRvIChlcyBsYSBtYXMgcGVkaWRhKS5cclxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKHAgPT4gKHtcclxuICAgICdTS1UnOiAgICAgICAgICAgcC5jb2RlIHx8ICcnLFxyXG4gICAgJ0Rlc2NyaXBjaW9uJzogICBwLmRlc2MgfHwgJycsXHJcbiAgICAnRmFtaWxpYSc6ICAgICAgIHAuZmFtIHx8ICcnLFxyXG4gICAgJ1N1YmZhbWlsaWEnOiAgICBwLnN1YiB8fCAnJyxcclxuICAgICdDYXRlZ29yaWEnOiAgICAgcC5jYXQgfHwgJycsXHJcbiAgICAnUHJlY2lvIEFSUyc6ICAgIGZtdFByZWNpbyhwLmNvZGUpLFxyXG4gICAgJ1N0b2NrIFcxMSc6ICAgICBmbXRTdG9jayhwLmNvZGUpLFxyXG4gIH0pKS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFt7d2NoOjE0fSwge3djaDo2MH0sIHt3Y2g6MTh9LCB7d2NoOjIyfSwge3djaDoxOH0sIHt3Y2g6MTR9LCB7d2NoOjE0fV07XHJcbiAgLy8gQXBsaWNhciBmb3JtYXRvIG1vbmVkYSBhIGxhIGNvbHVtbmEgUHJlY2lvIEFSUyAoY29sdW1uYSBGID0gNikuXHJcbiAgZm9yIChsZXQgaSA9IDI7IGkgPD0gcm93cy5sZW5ndGggKyAxOyBpKyspIHtcclxuICAgIGNvbnN0IGNlbGwgPSB3c1snRicgKyBpXTtcclxuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XHJcbiAgfVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnUHJlY2lvcyB5IFN0b2NrJyk7XHJcblxyXG4gIC8vIEhvamEgMjogc29sbyBQcmVjaW9zXHJcbiAgY29uc3QgcHJlY2lvc1Jvd3MgPSBQUk9EVUNUU1xyXG4gICAgLm1hcChwID0+ICh7U0tVOiBwLmNvZGUgfHwgJycsIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSl9KSlcclxuICAgIC5maWx0ZXIociA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdzUCA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChwcmVjaW9zUm93cyk7XHJcbiAgd3NQWychY29scyddID0gW3t3Y2g6MTR9LCB7d2NoOjYwfSwge3djaDoxNH1dO1xyXG4gIGZvciAobGV0IGkgPSAyOyBpIDw9IHByZWNpb3NSb3dzLmxlbmd0aCArIDE7IGkrKykge1xyXG4gICAgY29uc3QgY2VsbCA9IHdzUFsnQycgKyBpXTtcclxuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XHJcbiAgfVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUCwgJ1ByZWNpb3MnKTtcclxuXHJcbiAgLy8gSG9qYSAzOiBzb2xvIFN0b2NrXHJcbiAgY29uc3Qgc3RvY2tSb3dzID0gUFJPRFVDVFNcclxuICAgIC5tYXAocCA9PiAoe1NLVTogcC5jb2RlIHx8ICcnLCBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLCAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKX0pKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdzUyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChzdG9ja1Jvd3MpO1xyXG4gIHdzU1snIWNvbHMnXSA9IFt7d2NoOjE0fSwge3djaDo2MH0sIHt3Y2g6MTR9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1MsICdTdG9jaycpO1xyXG5cclxuICAvLyBIb2phIDQ6IG1ldGFkYXRhIC0gY3VhbmRvIGZ1ZSBjYWRhIHNuYXBzaG90IHBhcmEgcXVlIGVsIGxlY3RvciBzZXBhXHJcbiAgLy8gc2kgbGEgbGlzdGEgZXN0YSBmcmVzY2EuXHJcbiAgY29uc3QgaW5mb1Jvd3MgPSBbXHJcbiAgICB7SXRlbTogJ1RvdGFsIFNLVXMgZW4gY2F0YWxvZ28nLCBWYWxvcjogUFJPRFVDVFMubGVuZ3RofSxcclxuICAgIHtJdGVtOiAnVG90YWwgU0tVcyBjb24gcHJlY2lvIGNhcmdhZG8nLCBWYWxvcjogcHJlY2lvc1Jvd3MubGVuZ3RofSxcclxuICAgIHtJdGVtOiAnVG90YWwgU0tVcyBjb24gc3RvY2sgZGlzcG9uaWJsZScsIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIocCA9PiBoYXNTdG9jayhwLmNvZGUpID09PSB0cnVlKS5sZW5ndGh9LFxyXG4gICAge0l0ZW06ICdUb3RhbCBTS1VzIHNpbiBzdG9jaycsIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIocCA9PiBoYXNTdG9jayhwLmNvZGUpID09PSBmYWxzZSkubGVuZ3RofSxcclxuICAgIHtJdGVtOiAnVG90YWwgU0tVcyBzaW4gZGF0byBkZSBzdG9jaycsIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIocCA9PiBoYXNTdG9jayhwLmNvZGUpID09IG51bGwpLmxlbmd0aH0sXHJcbiAgICB7SXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgbW9uZWRhJywgVmFsb3I6ICh0eXBlb2YgUFJJQ0VfTElTVF9DVVJSRU5DWSAhPT0gJ3VuZGVmaW5lZCcpID8gUFJJQ0VfTElTVF9DVVJSRU5DWSA6ICdBUlMnfSxcclxuICAgIHtJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBhY3R1YWxpemFkYScsIFZhbG9yOiAodHlwZW9mIFBSSUNFX0xJU1RfVVBEQVRFRF9BVCAhPT0gJ3VuZGVmaW5lZCcgJiYgUFJJQ0VfTElTVF9VUERBVEVEX0FUKSA/IG5ldyBEYXRlKFBSSUNFX0xJU1RfVVBEQVRFRF9BVCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgOiAnKG5vIGNhcmdhZGEpJ30sXHJcbiAgICB7SXRlbTogJ1N0b2NrIHNuYXBzaG90IGFjdHVhbGl6YWRvJywgVmFsb3I6IFNUT0NLX1VQREFURURfQVQgPyBuZXcgRGF0ZShTVE9DS19VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcobm8gY2FyZ2FkbyknfSxcclxuICAgIHtJdGVtOiAnRXhwb3J0YWRvJywgVmFsb3I6IG5ldyBEYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyl9LFxyXG4gICAge0l0ZW06ICdFeHBvcnRhZG8gcG9yJywgVmFsb3I6IChjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgY3VycmVudFVzZXIuZGlzcGxheU5hbWUpKSB8fCAnKGRlc2Nvbm9jaWRvKSd9LFxyXG4gIF07XHJcbiAgY29uc3Qgd3NJID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGluZm9Sb3dzKTtcclxuICB3c0lbJyFjb2xzJ10gPSBbe3djaDozNn0sIHt3Y2g6MzZ9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0ksICdJbmZvJyk7XHJcblxyXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnUHJlY2lvc195X1N0b2NrXycgKyB0cyArICcueGxzeCcpO1xyXG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKHByZWNpb3MgKyBzdG9jayknKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3NcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cclxuICAvLyAgIHZlbmRlZG9yOiBvcGVyYXRpdm8gZGlhcmlvIChWZW50YXMgLyBWaXNpdGFzIC8gUnV0YXMpICsgQ2xpZW50ZXMgZGUgc3Ugem9uYVxyXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxyXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxyXG4gIC8vICAgICBwcm9waW8gc2kgZWxpZ2lvIHN1IG5vbWJyZSBlbiBlbCBkcm9wZG93biBkZSB6b25hcykuXHJcbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cclxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xyXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWRU5UQVMnLCAnVklTSVRBUycsICdSVVRBUycsICdNQVNURVInXSksXHJcbiAgICBpbnRlcm5vOiAgbmV3IFNldChbJ1ZFTlRBUycsICdWSVNJVEFTJywgJ1JVVEFTJywgJ01BU1RFUiddKSxcclxuICB9O1xyXG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cclxuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaChlbCA9PiB7XHJcbiAgICBjb25zdCBraW5kID0gZWwuZGF0YXNldC5leHBLaW5kIHx8ICcnO1xyXG4gICAgZWwuc3R5bGUuZGlzcGxheSA9ICghYWxsb3dlZCB8fCBhbGxvd2VkLmhhcyhraW5kKSkgPyAnJyA6ICdub25lJztcclxuICB9KTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VFeHBvcnREaWFsb2cgPSBmdW5jdGlvbigpe1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gTW9udGggcGlja2VyIHJldXRpbGl6YWJsZSBwYXJhIGxvcyA1IHRpcG9zIGRlIGV4cG9ydFxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxubGV0IHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxuY29uc3QgRVhQT1JUX1RZUEVfTEFCRUxTID0ge1xyXG4gIFZFTlRBUzogJ1ZlbnRhcycsXHJcbiAgVklTSVRBUzogJ1Zpc2l0YXMnLFxyXG4gIFJFTkRJQ0lPTkVTOiAnUmVuZGljaW9uZXMnLFxyXG4gIFJVVEFTOiAnUnV0YXMnLFxyXG4gIEFMVEFTOiAnQWx0YXMgZGUgY2xpZW50ZXMnLFxyXG59O1xyXG5cclxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uKHRpcG8pe1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gdGlwbztcclxuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xyXG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xyXG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0V4cG9ydGFyICcgKyAoRVhQT1JUX1RZUEVfTEFCRUxTW3RpcG9dIHx8IHRpcG8pO1xyXG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcclxuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXHJcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XHJcbiAgbWVzU2VsLmlubmVySFRNTCA9ICc8b3B0aW9uIHZhbHVlPVwiQUxMXCI+VG9kb3MgbG9zIG1lc2VzIChhXHUwMEYxbyBlbnRlcm8pPC9vcHRpb24+JyArXHJcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XHJcbiAgbWVzU2VsLnZhbHVlID0gbm93LmdldE1vbnRoKCk7XHJcbiAgY29uc3QgYW5pb1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJyk7XHJcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xyXG4gIGxldCB5b3B0cyA9ICcnO1xyXG4gIGZvciAobGV0IHkgPSB5ZWFyIC0gMzsgeSA8PSB5ZWFyICsgMTsgeSsrKSB5b3B0cyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyB5ICsgJ1wiPicgKyB5ICsgJzwvb3B0aW9uPic7XHJcbiAgYW5pb1NlbC5pbm5lckhUTUwgPSB5b3B0cztcclxuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlTW9udGhQaWNrZXIgPSBmdW5jdGlvbigpe1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xyXG59O1xyXG5cclxud2luZG93LmNvbmZpcm1Nb250aFBpY2tlciA9IGZ1bmN0aW9uKCl7XHJcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xyXG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcclxuICBjb25zdCBhbmlvID0gcGFyc2VJbnQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKS52YWx1ZSk7XHJcbiAgY29uc3QgbW9udGhJZHggPSAobWVzUmF3ID09PSAnQUxMJykgPyBudWxsIDogcGFyc2VJbnQobWVzUmF3KTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxuICBpZiAoIXRpcG8pIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgaWYgKHRpcG8gPT09ICdWRU5UQVMnKSAgICAgICBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSVVRBUycpICAgZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQUxUQVMnKSAgIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0ICcgKyB0aXBvLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpe1xyXG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gU3RyaW5nKGFuaW8pO1xyXG4gIHJldHVybiBNRVNFU1ttb250aElkeF0gKyAnXycgKyBhbmlvO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkb3dubG9hZFhsc3goZmlsZW5hbWUsIHNoZWV0cyl7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgZm9yIChjb25zdCBzIG9mIHNoZWV0cykge1xyXG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocy5yb3dzLmxlbmd0aCA/IHMucm93cyA6IFt7QXZpc286ICdTaW4gZGF0b3MgcGFyYSBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkbyd9XSk7XHJcbiAgICBpZiAocy5yb3dzLmxlbmd0aCkge1xyXG4gICAgICBjb25zdCBjb2xzID0gT2JqZWN0LmtleXMocy5yb3dzWzBdKS5tYXAoayA9PiAoe3djaDogTWF0aC5taW4oNDAsIE1hdGgubWF4KDEwLCBrLmxlbmd0aCArIDQpKX0pKTtcclxuICAgICAgd3NbJyFjb2xzJ10gPSBjb2xzO1xyXG4gICAgfVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsIHMubmFtZS5zbGljZSgwLCAzMSkpO1xyXG4gIH1cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgZmlsZW5hbWUpO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCl7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmVudGFzLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHsgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpOyB9XHJcbiAgY2F0Y2goZSkgeyBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7IHJldHVybjsgfVxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goZCA9PiB7XHJcbiAgICBjb25zdCBwID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBpZiAocGFyc2VJbnQocC55ZWFyKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KHAubW9udGhJZHgpICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xyXG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIHJldHVybjtcclxuICAgIGNvbnN0IHZlbmRvcktleSA9IHAudmVuZG9yIHx8IGxvb2t1cFZlbmRvckZvckNsaWVudChwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSkgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XHJcbiAgICBjb25zdCBmYWN0b3IgPSAodHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nKSA/IHBlZGlkb0Rpc2NvdW50RmFjdG9yKHApIDogMTtcclxuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcclxuICAgIGxpbmVzLmZvckVhY2gobCA9PiB7XHJcbiAgICAgIGNvbnN0IHF0eSA9IHBhcnNlRmxvYXQobC5xdHkpIHx8IDA7XHJcbiAgICAgIGNvbnN0IHByZWNpbyA9IHBhcnNlRmxvYXQobC5wcmVjaW8pIHx8IDA7XHJcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xyXG4gICAgICBjb25zdCBuZXQgPSBncm9zcyAqIGZhY3RvcjtcclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgRmVjaGFfQ29uZmlybWFkbzogcC5jb25maXJtZWRBdCA/IFN0cmluZyhwLmNvbmZpcm1lZEF0KS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgICAgICBFc3RhZG86IHAuc3RhZ2UgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxyXG4gICAgICAgIFpvbmE6IHZlbmRvckluZm8uem9uZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlIHx8ICcnKSxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQ29kaWdvX1NLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXHJcbiAgICAgICAgQ2F0ZWdvcmlhOiBsLmNhdCB8fCAnJyxcclxuICAgICAgICBGYW1pbGlhOiBsLmZhbSB8fCAnJyxcclxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZDogcXR5LFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxyXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxyXG4gICAgICAgIC8vIHBhcmEgZWwgdGFyZ2V0IGRlbCB2ZW5kZWRvci4gU3VidG90YWxfQnJ1dG9fQVJTIG11ZXN0cmEgZWwgdmFsb3JcclxuICAgICAgICAvLyBkZSBsaXN0YSBzaW4gZGVzY3VlbnRvIHBhcmEgdHJhemFiaWxpZGFkLlxyXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxyXG4gICAgICAgIFN1YnRvdGFsX0JydXRvX0FSUzogTWF0aC5yb3VuZChncm9zcyksXHJcbiAgICAgICAgRGVzY3VlbnRvX1BjdDogZGlzY1BjdCxcclxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcclxuICAgICAgICBDYXJnYWRvX1BvcjogcC5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCBwLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fVmVudGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3tuYW1lOiAnVmVudGFzJywgcm93c31dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBjbGllbnROYW1lKXtcclxuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcclxuICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKHAgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xyXG4gIHJldHVybiBwdCA/IChwdC52ZW5kb3IgfHwgJycpIDogJyc7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCl7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmlzaXRhcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmdldCgpOyB9XHJcbiAgY2F0Y2goZSkgeyBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7IHJldHVybjsgfVxyXG4gIGNvbnN0IHRhcmdldE1lcyA9IChtb250aElkeCAhPT0gbnVsbCkgPyBNRVNFU1ttb250aElkeF0udG9VcHBlckNhc2UoKSA6IG51bGw7XHJcbiAgY29uc3QgaXRlbXMgPSBbXTtcclxuICBzbmFwLmZvckVhY2goZCA9PiB7XHJcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBpZiAocGFyc2VJbnQodi5hbmlvKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xyXG4gICAgaXRlbXMucHVzaCh2KTtcclxuICB9KTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGRlbCBmcmVudGUgZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBMYXp5IGxvYWQuXHJcbiAgdHJ5IHsgYXdhaXQgbG9hZEV4Y2VsSlMoKTsgfVxyXG4gIGNhdGNoKGUpIHsgYWxlcnQoZS5tZXNzYWdlIHx8IGUpOyByZXR1cm47IH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgaXRlbXMubGVuZ3RoICsgJyB2aXNpdGFzLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzJywge3ZpZXdzOiBbe3N0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxfV19KTtcclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAge2hlYWRlcjogJ0ZlY2hhJywgICAgICAgICAgICAga2V5OiAnZmVjaGEnLCAgICAgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdNZXMnLCAgICAgICAgICAgICAgIGtleTogJ21lcycsICAgICAgIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnQW5pbycsICAgICAgICAgICAgICBrZXk6ICdhbmlvJywgICAgICB3aWR0aDogOH0sXHJcbiAgICB7aGVhZGVyOiAnVmVuZGVkb3InLCAgICAgICAgICBrZXk6ICd2ZW5kZWRvcicsICB3aWR0aDogMjJ9LFxyXG4gICAge2hlYWRlcjogJ093bmVyIEVtYWlsJywgICAgICAga2V5OiAnZW1haWwnLCAgICAgd2lkdGg6IDI4fSxcclxuICAgIHtoZWFkZXI6ICdUaXBvIENvbnRhY3RvJywgICAgIGtleTogJ3RpcG9DdCcsICAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnQ29tZW50YXJpbycsICAgICAgICBrZXk6ICdjb21lbnQnLCAgICB3aWR0aDogMzB9LFxyXG4gICAge2hlYWRlcjogJ1Byb3ZpbmNpYScsICAgICAgICAga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2fSxcclxuICAgIHtoZWFkZXI6ICdMb2NhbGlkYWQnLCAgICAgICAgIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOH0sXHJcbiAgICB7aGVhZGVyOiAnVGllbmRhJywgICAgICAgICAgICBrZXk6ICd0aWVuZGEnLCAgICB3aWR0aDogMjh9LFxyXG4gICAge2hlYWRlcjogJ1RpcG8nLCAgICAgICAgICAgICAga2V5OiAndGlwbycsICAgICAgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdMb2NhbCcsICAgICAgICAgICAgIGtleTogJ2xvY2FsJywgICAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnVGFtYW5vJywgICAgICAgICAgICBrZXk6ICd0YW1hbm8nLCAgICB3aWR0aDogMTB9LFxyXG4gICAge2hlYWRlcjogJ0ZpZGVsaWRhZCcsICAgICAgICAga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwfSxcclxuICAgIHtoZWFkZXI6ICdSZWxldmFuY2lhJywgICAgICAgIGtleTogJ3JlbGV2JywgICAgIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnUE9QJywgICAgICAgICAgICAgICBrZXk6ICdwb3AnLCAgICAgICB3aWR0aDogOH0sXHJcbiAgICB7aGVhZGVyOiAnTmVjZXNpZGFkIFB1bnR1YWwnLCBrZXk6ICduZWMnLCAgICAgICB3aWR0aDogMjJ9LFxyXG4gICAge2hlYWRlcjogJ09wb3J0dW5pZGFkJywgICAgICAga2V5OiAnb3BvcnR1JywgICAgd2lkdGg6IDI0fSxcclxuICAgIHtoZWFkZXI6ICdNYXMgVmVuZGlkbycsICAgICAgIGtleTogJ21hc1ZlJywgICAgIHdpZHRoOiAyNH0sXHJcbiAgICB7aGVhZGVyOiAnTWFzIFByZWd1bnRhbicsICAgICBrZXk6ICdtYXNQcicsICAgICB3aWR0aDogMjR9LFxyXG4gICAge2hlYWRlcjogJ0F5dWRhIFRpZW5kYScsICAgICAga2V5OiAnYXl1ZGEnLCAgICAgd2lkdGg6IDIyfSxcclxuICAgIHtoZWFkZXI6ICdUaXBvIFZlbnRhJywgICAgICAgIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnUG9uZCBNb3N0cmFkb3InLCAgICBrZXk6ICdwTW9zdCcsICAgICB3aWR0aDogMTB9LFxyXG4gICAge2hlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywgICAga2V5OiAncEVjb20nLCAgICAgd2lkdGg6IDEwfSxcclxuICAgIHtoZWFkZXI6ICdDb21wZXRlbmNpYScsICAgICAgIGtleTogJ2NvbXBlJywgICAgIHdpZHRoOiAxNn0sXHJcbiAgICB7aGVhZGVyOiAnR1BTIFN0YXR1cycsICAgICAgICBrZXk6ICdncHNTdCcsICAgICB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ0dQUyBEaXN0IChtKScsICAgICAga2V5OiAnZ3BzRGlzdCcsICAgd2lkdGg6IDEwfSxcclxuICAgIHtoZWFkZXI6ICdGb3RvIGZyZW50ZScsICAgICAgIGtleTogJ2ZvdG8nLCAgICAgIHdpZHRoOiAyMn0sXHJcbiAgICB7aGVhZGVyOiAnRW4gbm9tYnJlIGRlIFZERScsICBrZXk6ICdvbkJlaGFsZicsICB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ0NhcmdhZG8gUG9yJywgICAgICAga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0fSxcclxuICBdO1xyXG4gIHdzLmdldFJvdygxKS5mb250ID0ge2JvbGQ6IHRydWUsIGNvbG9yOiB7YXJnYjogJ0ZGRkZGRkZGJ319O1xyXG4gIHdzLmdldFJvdygxKS5maWxsID0ge3R5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjoge2FyZ2I6ICdGRjBDNEE2RSd9fTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0ge3ZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcid9O1xyXG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcclxuXHJcbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcclxuICBjb25zdCBST1dfSCA9IDEwMDtcclxuICBjb25zdCBJTUdfVyA9IDEzMDtcclxuICBjb25zdCBJTUdfSCA9IDkwO1xyXG5cclxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXHJcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IHYgb2YgaXRlbXMpIHtcclxuICAgIGNvbnN0IHRpcG9Db250YWN0b0xibCA9ICh2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJykgPyAnVGVsZWZvbm8nIDogJ1ByZXNlbmNpYWwnO1xyXG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6ICAgICB2LmZlY2hhIHx8ICcnLFxyXG4gICAgICBtZXM6ICAgICAgIHYubWVzIHx8ICcnLFxyXG4gICAgICBhbmlvOiAgICAgIHYuYW5pbyB8fCAnJyxcclxuICAgICAgdmVuZGVkb3I6ICB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxyXG4gICAgICBlbWFpbDogICAgIHYub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgdGlwb0N0OiAgICB0aXBvQ29udGFjdG9MYmwsXHJcbiAgICAgIGNvbWVudDogICAgdi5jb21lbnRhcmlvIHx8ICcnLFxyXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXHJcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICAgIHRpZW5kYTogICAgdi50aWVuZGEgfHwgJycsXHJcbiAgICAgIHRpcG86ICAgICAgdi50aXBvIHx8ICcnLFxyXG4gICAgICBsb2NhbDogICAgIHYubG9jYWwgfHwgJycsXHJcbiAgICAgIHRhbWFubzogICAgdi50YW1hbm8gfHwgJycsXHJcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXHJcbiAgICAgIHJlbGV2OiAgICAgdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgICBwb3A6ICAgICAgIHYucG9wIHx8ICcnLFxyXG4gICAgICBuZWM6ICAgICAgIHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcclxuICAgICAgb3BvcnR1OiAgICB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxyXG4gICAgICBtYXNWZTogICAgIHYubWFzVmVuZGlkbyB8fCAnJyxcclxuICAgICAgbWFzUHI6ICAgICB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcclxuICAgICAgYXl1ZGE6ICAgICB2LmF5dWRhVGllbmRhIHx8ICcnLFxyXG4gICAgICB0aXBvVmVudGE6ICh2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogKHYudGlwb1ZlbnRhIHx8ICcnKSksXHJcbiAgICAgIHBNb3N0OiAgICAgdi5wb25kZXJhY2lvbk1vc3RyYWRvIHx8ICcnLFxyXG4gICAgICBwRWNvbTogICAgIHYucG9uZGVyYWNpb25FY29tbWVyY2UgfHwgJycsXHJcbiAgICAgIGNvbXBlOiAgICAgdi5jb21wZXRlbmNpYSB8fCAnJyxcclxuICAgICAgZ3BzU3Q6ICAgICB2Lmdwc1N0YXR1cyB8fCAnJyxcclxuICAgICAgZ3BzRGlzdDogICB2Lmdwc0Rpc3RhbmNlTSAhPSBudWxsID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcclxuICAgICAgZm90bzogICAgICAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXHJcbiAgICAgIG9uQmVoYWxmOiAgdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgIGNyZWF0ZWRCeTogdi5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCB2LmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XHJcbiAgICByb3cuYWxpZ25tZW50ID0ge3ZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWV9O1xyXG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XHJcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcclxuICAgICAgICBpZiAobSkgeyBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7IGI2NCA9IG1bMl07IH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7YmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0fSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHtjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMX0sXHJcbiAgICAgICAgICBleHQ6IHt3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0h9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2goZSkgeyBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byB2aXNpdGEnLCBlKTsgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge3R5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCd9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpOyBhLmNsaWNrKCk7IGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFZpc2l0YXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCl7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUmVuZGljaW9uZXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkgeyBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpOyB9XHJcbiAgY2F0Y2goZSkgeyBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpOyByZXR1cm47IH1cclxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgc25hcC5mb3JFYWNoKGQgPT4ge1xyXG4gICAgY29uc3QgciA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XHJcbiAgICBpZiAoIWR0ICYmIHIuY3JlYXRlZEF0ICYmIHIuY3JlYXRlZEF0LnRvRGF0ZSkge1xyXG4gICAgICB0cnkgeyBkdCA9IHIuY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApOyB9IGNhdGNoKGUpIHt9XHJcbiAgICB9XHJcbiAgICBpZiAoIWR0KSByZXR1cm47XHJcbiAgICBjb25zdCBkT2JqID0gbmV3IERhdGUoZHQpO1xyXG4gICAgaWYgKGlzTmFOKGRPYmouZ2V0VGltZSgpKSkgcmV0dXJuO1xyXG4gICAgaWYgKGRPYmouZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgIGl0ZW1zLnB1c2goe2lkOiBkLmlkLCBmZWNoYTogZHQsIHI6IHJ9KTtcclxuICB9KTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXHJcbiAgdHJ5IHsgYXdhaXQgbG9hZEV4Y2VsSlMoKTsgfVxyXG4gIGNhdGNoKGUpIHsgYWxlcnQoZS5tZXNzYWdlIHx8IGUpOyByZXR1cm47IH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgaXRlbXMubGVuZ3RoICsgJyByZW5kaWNpb25lcy4uLicsIDMwMDApO1xyXG5cclxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XHJcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcclxuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcclxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7dmlld3M6IFt7c3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDF9XX0pO1xyXG4gIHdzLmNvbHVtbnMgPSBbXHJcbiAgICB7aGVhZGVyOiAnRmVjaGEnLCAgICAgICAgICAgIGtleTogJ2ZlY2hhJywgICAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnVGlwbycsICAgICAgICAgICAgIGtleTogJ3RpcG8nLCAgICAgIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnVmVuZGVkb3InLCAgICAgICAgIGtleTogJ3ZlbmRlZG9yJywgIHdpZHRoOiAyNn0sXHJcbiAgICB7aGVhZGVyOiAnT3duZXIgRW1haWwnLCAgICAgIGtleTogJ2VtYWlsJywgICAgIHdpZHRoOiAyOH0sXHJcbiAgICB7aGVhZGVyOiAnQ29uY2VwdG8nLCAgICAgICAgIGtleTogJ2NvbmNlcHRvJywgIHdpZHRoOiAxOH0sXHJcbiAgICB7aGVhZGVyOiAnTiBUaWNrZXQnLCAgICAgICAgIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNH0sXHJcbiAgICB7aGVhZGVyOiAnTW9kbyBwYWdvJywgICAgICAgIGtleTogJ21vZG9QYWdvJywgIHdpZHRoOiAxNH0sXHJcbiAgICB7aGVhZGVyOiAnVGlwbyBnYXN0bycsICAgICAgIGtleTogJ3RpcG9HYXN0bycsIHdpZHRoOiAyNH0sXHJcbiAgICB7aGVhZGVyOiAnRGl2aXNpb24nLCAgICAgICAgIGtleTogJ2RpdmlzaW9uJywgIHdpZHRoOiAxNH0sXHJcbiAgICB7aGVhZGVyOiAnSW1wb3J0ZScsICAgICAgICAgIGtleTogJ2ltcG9ydGUnLCAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnTW9uZWRhJywgICAgICAgICAgIGtleTogJ21vbmVkYScsICAgIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnSW1wb3J0ZSBVU0QnLCAgICAgIGtleTogJ2ltcG9ydGVVc2QnLHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsICAgIGtleTogJ29icycsICAgICAgIHdpZHRoOiAzMH0sXHJcbiAgICB7aGVhZGVyOiAnRm90byB0aWNrZXQnLCAgICAgIGtleTogJ2ZvdG8nLCAgICAgIHdpZHRoOiAyMn0sXHJcbiAgICB7aGVhZGVyOiAnRXN0YWRvJywgICAgICAgICAgIGtleTogJ2VzdGFkbycsICAgIHdpZHRoOiAxOH0sXHJcbiAgICB7aGVhZGVyOiAnQXByb2JhZG9yJywgICAgICAgIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOH0sXHJcbiAgICB7aGVhZGVyOiAnQXByb2JhZG8gZW4nLCAgICAgIGtleTogJ2Fwcm9iYWRvRW4nLHdpZHRoOiAxNH0sXHJcbiAgXTtcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHtib2xkOiB0cnVlLCBjb2xvcjoge2FyZ2I6ICdGRkZGRkZGRid9fTtcclxuICB3cy5nZXRSb3coMSkuZmlsbCA9IHt0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHthcmdiOiAnRkY3RTIyQ0UnfX07XHJcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHt2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInfTtcclxuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XHJcblxyXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXHJcbiAgY29uc3QgUk9XX0ggPSAxMTA7XHJcbiAgY29uc3QgSU1HX1cgPSAxNDA7XHJcbiAgY29uc3QgSU1HX0ggPSAxMDA7XHJcblxyXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcclxuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcblxyXG4gIGZvciAoY29uc3QgaXQgb2YgaXRlbXMpIHtcclxuICAgIGNvbnN0IHIgPSBpdC5yO1xyXG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcclxuICAgIGNvbnN0IGNvbmNlcHRTdHIgPSBpc0dhc3RvID8gKHIuZGVzY3JpcGNpb24gfHwgJycpIDogKHIudGlwb09wZXJhY2lvbiB8fCByLm1vdGl2byB8fCAnJyk7XHJcbiAgICBjb25zdCBvYnNTdHIgPSAoci5vYnNlcnZhY2lvbmVzIHx8IHIubm90YXMgfHwgJycpICsgKGlzR2FzdG8gPyAnJyA6IChyLnNvbGljaXRhZG9Qb3IgPyAoJyB8IFNvbGljaXRhZG8gcG9yOiAnICsgci5zb2xpY2l0YWRvUG9yKSA6ICcnKSk7XHJcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xyXG4gICAgICBmZWNoYTogICAgICBpdC5mZWNoYSxcclxuICAgICAgdGlwbzogICAgICAgci50aXBvIHx8ICcnLFxyXG4gICAgICB2ZW5kZWRvcjogICByLm93bmVyTmFtZSB8fCByLnZlbmRvck5hbWUgfHwgci5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBlbWFpbDogICAgICByLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIGNvbmNlcHRvOiAgIGNvbmNlcHRTdHIsXHJcbiAgICAgIG51bVRpY2tldDogIHIubnVtZXJvVGlja2V0IHx8ICcnLFxyXG4gICAgICBtb2RvUGFnbzogICByLm1vZG9QYWdvIHx8ICcnLFxyXG4gICAgICB0aXBvR2FzdG86ICByLnRpcG9HYXN0byB8fCAnJyxcclxuICAgICAgZGl2aXNpb246ICAgci5kaXZpc2lvbkdhc3RvIHx8ICcnLFxyXG4gICAgICBpbXBvcnRlOiAgICByLmltcG9ydGUgIT0gbnVsbCA/IHIuaW1wb3J0ZSA6ICcnLFxyXG4gICAgICBtb25lZGE6ICAgICByLm1vbmVkYSB8fCAnUEVTT1MnLFxyXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcclxuICAgICAgb2JzOiAgICAgICAgb2JzU3RyLFxyXG4gICAgICBmb3RvOiAgICAgICAnJywgLy8gY2VsZGEgdmFjaWEgLSBlbmNpbWEgdmEgbGEgaW1hZ2VuXHJcbiAgICAgIGVzdGFkbzogICAgIHIuc3RhdHVzIHx8IHIuZXN0YWRvIHx8ICcnLFxyXG4gICAgICBhcHJvYmFkb3I6ICByLmFwcHJvdmVyRW1haWwgfHwgci5hcHJvYmFkb3IgfHwgJycsXHJcbiAgICAgIGFwcm9iYWRvRW46IHIuYXBwcm92ZWRBdCAmJiByLmFwcHJvdmVkQXQudG9EYXRlID8gci5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCkgOiAnJyxcclxuICAgIH0pO1xyXG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xyXG4gICAgcm93LmFsaWdubWVudCA9IHt2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlfTtcclxuICAgIC8vIEVtYmViZXIgZm90byBkZWwgdGlja2V0IHNpIGV4aXN0ZS4gdjMwOCs6IHByZWZlcmlyIGJhc2U2NCBlbWJlYmlkb1xyXG4gICAgLy8gKGZvdG9UaWNrZXQgLyBhZGp1bnRvKSBwb3IgY29tcGF0LCBzaW5vIHVzYXIgZm90b1RpY2tldFVybCBjb21vIEhZUEVSTElOSy5cclxuICAgIC8vIEEgbml2ZWwgRXhjZWwgdW4gZGF0YVVSTCBiYXNlNjQgc2UgcHVlZGUgaW5zZXJ0YXIgY29tbyBpbWFnZW4gaW5saW5lLFxyXG4gICAgLy8gbWllbnRyYXMgcXVlIHVuYSBVUkwgZGUgU3RvcmFnZSBzZSBhZ3JlZ2EgY29tbyBsaW5rIGNsaWNrZWFibGUgKGVsXHJcbiAgICAvLyB1c3VhcmlvIGFicmUgZW4gZWwgYnJvd3NlciBzaW4gbmVjZXNpZGFkIGRlIHF1ZSBFeGNlbCBkZXNjYXJndWUpLlxyXG4gICAgY29uc3QgZm90b1NyYyA9IHIuZm90b1RpY2tldCB8fCByLmFkanVudG8gfHwgJyc7XHJcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGV0IGI2NCA9IGZvdG9TcmM7XHJcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcclxuICAgICAgICBpZiAobSkgeyBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7IGI2NCA9IG1bMl07IH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7YmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0fSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHtjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMX0sXHJcbiAgICAgICAgICBleHQ6IHt3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0h9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2goZSkgeyBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7IH1cclxuICAgIH0gZWxzZSBpZiAoci5mb3RvVGlja2V0VXJsICYmIHR5cGVvZiByLmZvdG9UaWNrZXRVcmwgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIC8vIERvY3MgbnVldm9zICh2MzA4Kyk6IGZvdG8gZW4gU3RvcmFnZSwgaW5zZXJ0YW1vcyBjb21vIGh5cGVybGluay5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XHJcbiAgICAgICAgY2VsbC52YWx1ZSA9IHt0ZXh0OiAnQWJyaXIgdGlja2V0JywgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsIHRvb2x0aXA6ICdBYnJpciBsYSBmb3RvIGRlbCB0aWNrZXQgZW4gZWwgYnJvd3Nlcid9O1xyXG4gICAgICAgIGNlbGwuZm9udCA9IHtjb2xvcjoge2FyZ2I6ICdGRjA1NjNDMSd9LCB1bmRlcmxpbmU6IHRydWV9O1xyXG4gICAgICB9IGNhdGNoKGUpIHsgY29uc29sZS53YXJuKCdoeXBlcmxpbmsgZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7IH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHt0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19SZW5kaWNpb25lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7IGEuY2xpY2soKTsgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUmVuZGljaW9uZXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpe1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XHJcbiAgLy8gTGFzIHJ1dGFzIHNlIGdlbmVyYW4gZW4gcnVudGltZSBwYXJhIGNhZGEgdmVuZGVkb3I7IGVuIGNhbWJpbyBsb3Mgb3ZlcnJpZGVzXHJcbiAgLy8gKGRlcml2YWNpb25lcyAvIHJlYWdlbmRhcykgdml2ZW4gZW4gcm91dGVfb3ZlcnJpZGVzLiBFeHBvcnRhbW9zOlxyXG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXHJcbiAgLy8gICAgZGVsIHJvbCBhY3R1YWwgbyB0b2RvcyBzaSBhZG1pbilcclxuICAvLyAgLSB1bmEgaG9qYSBjb24gbG9zIG92ZXJyaWRlcyBkZWwgcGVyaW9kb1xyXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPSAodXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICd2aWV3ZXInKVxyXG4gICAgPyBWRU5ET1JTLm1hcCh2ID0+IHYua2V5KVxyXG4gICAgOiAoYXNzaWduZWRWZW5kb3IgPyBbYXNzaWduZWRWZW5kb3JdIDogW10pO1xyXG4gIGNvbnN0IG1vbnRoc1RvRXhwb3J0ID0gKG1vbnRoSWR4ICE9PSBudWxsKSA/IFttb250aElkeF0gOiBbMCwxLDIsMyw0LDUsNiw3LDgsOSwxMCwxMV07XHJcbiAgY29uc3QgcnV0YXNSb3dzID0gW107XHJcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcclxuICAgIGZvciAoY29uc3QgbSBvZiBtb250aHNUb0V4cG9ydCkge1xyXG4gICAgICBsZXQgcnV0YXM7XHJcbiAgICAgIHRyeSB7IHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pOyB9IGNhdGNoKGUpIHsgcnV0YXMgPSBbXTsgfVxyXG4gICAgICAocnV0YXMgfHwgW10pLmZvckVhY2gocnV0YSA9PiB7XHJcbiAgICAgICAgKHJ1dGEudGllbmRhcyB8fCBbXSkuZm9yRWFjaCgodCwgaSkgPT4ge1xyXG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xyXG4gICAgICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmQpLFxyXG4gICAgICAgICAgICBBbmlvOiBhbmlvLFxyXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxyXG4gICAgICAgICAgICBSdXRhX0lEOiBydXRhLmlkIHx8ICcnLFxyXG4gICAgICAgICAgICBSdXRhX05vbWJyZTogcnV0YS5ub21icmUgfHwgJycsXHJcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXHJcbiAgICAgICAgICAgIE9yZGVuOiBpICsgMSxcclxuICAgICAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UodC5wcm92aW5jZSB8fCAnJyksXHJcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgICAgICBUaWVuZGE6IHQuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICAgICAgVGlwbzogdC50aXBvIHx8ICcnLFxyXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICAvLyBPdmVycmlkZXNcclxuICBsZXQgb3ZyU25hcDtcclxuICB0cnkgeyBvdnJTbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb3V0ZV9vdmVycmlkZXMnKS5nZXQoKTsgfVxyXG4gIGNhdGNoKGUpIHsgb3ZyU25hcCA9IG51bGw7IH1cclxuICBjb25zdCBvdmVycmlkZXNSb3dzID0gW107XHJcbiAgaWYgKG92clNuYXApIHtcclxuICAgIG92clNuYXAuZm9yRWFjaChkID0+IHtcclxuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBpZiAocGFyc2VJbnQoby5hbmlvKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICAgIG92ZXJyaWRlc1Jvd3MucHVzaCh7XHJcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxyXG4gICAgICAgIE1lczogTUVTRVNbcGFyc2VJbnQoby5tb250aElkeCldIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKG8ucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIEFjY2lvbjogby5hY3Rpb24gfHwgby50aXBvIHx8ICcnLFxyXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxyXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcclxuICAgICAgICBNb3Rpdm86IG8ubW90aXZvIHx8ICcnLFxyXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgICAgQ3JlYWRvX0VuOiBvLmNyZWF0ZWRBdCAmJiBvLmNyZWF0ZWRBdC50b0RhdGUgPyBvLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApIDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUnV0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXHJcbiAgICB7bmFtZTogJ1J1dGFzIHBsYW5pZmljYWRhcycsIHJvd3M6IHJ1dGFzUm93c30sXHJcbiAgICB7bmFtZTogJ0Rlcml2YWNpb25lcy1SZWFnZW5kYXMnLCByb3dzOiBvdmVycmlkZXNSb3dzfSxcclxuICBdKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFJ1dGFzIGxpc3RvICgnICsgcnV0YXNSb3dzLmxlbmd0aCArICcgdGllbmRhcywgJyArIG92ZXJyaWRlc1Jvd3MubGVuZ3RoICsgJyBvdmVycmlkZXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KXtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKTsgfVxyXG4gIGNhdGNoKGUpIHsgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTsgcmV0dXJuOyB9XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaChkID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGxldCBkdCA9ICcnO1xyXG4gICAgaWYgKGEuY3JlYXRlZEF0ICYmIGEuY3JlYXRlZEF0LnRvRGF0ZSkge1xyXG4gICAgICB0cnkgeyBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpOyB9IGNhdGNoKGUpIHt9XHJcbiAgICB9XHJcbiAgICBpZiAoIWR0KSByZXR1cm47XHJcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGR0LmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxyXG4gICAgICBFc3RhZG86IGEuc3RhdHVzIHx8ICcnLFxyXG4gICAgICBDb21lcmNpbzogYS5jb21lcmNpbyB8fCAnJyxcclxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXHJcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcclxuICAgICAgQ29uZGljaW9uX0Zpc2NhbDogYS5jb25kRmlzY2FsIHx8ICcnLFxyXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcclxuICAgICAgTnVtZXJvOiBhLm51bWVybyB8fCAnJyxcclxuICAgICAgTG9jYWxpZGFkOiBhLmxvY2FsaWRhZCB8fCAnJyxcclxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcclxuICAgICAgQ1A6IGEuY3AgfHwgJycsXHJcbiAgICAgIFRlbGVmb25vOiBhLnRlbGVmb25vIHx8ICcnLFxyXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcclxuICAgICAgVmVuZGVkb3JfU29saWNpdGFudGU6IGEudmVuZG9yTmFtZSB8fCBhLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIE93bmVyX0VtYWlsOiBhLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcclxuICAgICAgQXByb2JhZG9fUG9yOiBhLmFwcHJvdmVkQnlFbWFpbCB8fCAnJyxcclxuICAgICAgQXByb2JhZG9fRW46IGEuYXBwcm92ZWRBdCAmJiBhLmFwcHJvdmVkQXQudG9EYXRlID8gYS5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCkgOiAnJyxcclxuICAgICAgUmVjaGF6YWRvX01vdGl2bzogYS5yZWplY3RlZFJlYXNvbiB8fCAnJyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQWx0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbe25hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3N9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBBbHRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBzb2xpY2l0dWRlcyknLCAyNDAwKTtcclxufVxyXG5cclxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cclxuY29uc3QgQU5BTElTSVNfUElOID0gJzEyMzUnO1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIGxhIGhvamEgQ0xJRU5URVNfWk9OQVMgY29uIFVOQSBmaWxhIHBvciBCUCBxdWUgZXN0YSB2aXZvIGVuIFNBUDpcclxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxyXG4vLyBhc2lnbmFkby4gRXhjbHV5ZSBQT0lOVFMgLyBkaXN0cmlidWlkb3JlcyAvIHByb3NwZWN0b3MgLyBhbHRhcyBzaW5cclxuLy8gQ2FyZENvZGUgKG1vY2tzIG8gcGVuZGllbnRlcyBkZSBTQVApLiBFcyBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBmYWN0dXJhLlxyXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcclxuLy8gQ0FMTEUsIE5VTUVSTywgTE9DQUxJREFELCBDUCwgTk9NQlJFIENPTUVSQ0lBTCwgTk9NQlJFIERFIEZBTlRBU0lBLCBDVUlULFxyXG4vLyBDT05ESUNJT04gRklTQ0FMLCBURUxFRk9OTywgQ0FSRENPREUgU0FQLlxyXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaWNcdTAwRTEgdHUgY29uZXhpXHUwMEYzbiB5IHJlaW50ZW50XHUwMEUxLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGV4cG9ydGFyIGVsIG1hc3Rlci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBUQVJHRVRTLVpPTkFTLi4uJyk7XHJcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcclxuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogICAgJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxyXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICAgICAgICAgICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICAgICdNQVJUSU4gQk9JRVJPJzogICAgICAgICAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgfTtcclxuICBmdW5jdGlvbiByZWdpb25PZihwcm92KXtcclxuICAgIGNvbnN0IHAgPSAocHJvdiB8fCAnJykudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsJ0NBUElUQUwgRkVERVJBTCcsJ0xBIFBBTVBBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQlVFTk9TIEFJUkVTJztcclxuICAgIGlmIChbJ0NPUkRPQkEnLCdTQU4gTFVJUycsJ01FTkRPWkEnLCdTQU4gSlVBTicsJ0xBIFJJT0pBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQ1VZTyc7XHJcbiAgICBpZiAoWydTQU5UQSBGRScsJ0VOVFJFIFJJT1MnLCdDSEFDTycsJ0NPUlJJRU5URVMnLCdNSVNJT05FUycsJ0ZPUk1PU0EnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdORUEnO1xyXG4gICAgaWYgKFsnSlVKVVknLCdTQUxUQScsJ1RVQ1VNQU4nLCdDQVRBTUFSQ0EnLCdTQU5USUFHTyBERUwgRVNURVJPJ10uaW5jbHVkZXMocCkpIHJldHVybiAnTk9BJztcclxuICAgIGlmIChbJ05FVVFVRU4nLCdSSU8gTkVHUk8nLCdDSFVCVVQnLCdTQU5UQSBDUlVaJywnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ1BBVEFHT05JQSc7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHZlbmRvckxhYmVsRm9yRXhjZWwoa2V5KXtcclxuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XHJcbiAgICBpZiAoa2V5ID09PSAnX19ESVNUUklCVVRPUl9fJykgcmV0dXJuICdESVNUUklCVUlET1JFUyc7XHJcbiAgICByZXR1cm4ga2V5O1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgbGV0IGFsdGFzU25hcDtcclxuICB0cnkgeyBhbHRhc1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJykuZ2V0KCk7IH1cclxuICBjYXRjaChlKSB7IGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpOyByZXR1cm47IH1cclxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcclxuICBhbHRhc1NuYXAuZm9yRWFjaChkID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcclxuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXHJcbiAgICBpZiAoIWNhcmRDb2RlKSB7IHNraXBwZWROb1NhcCsrOyByZXR1cm47IH1cclxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcclxuICAgIGNvbnN0IGxvY2FsaXR5RmluYWwgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcnO1xyXG4gICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIFRJUE86ICdEQURPIERFIEFMVEEnLFxyXG4gICAgICAnTlJPIENURSc6IDAsIC8vIHNlIHJlbnVtZXJhIGRlc3B1ZXMgZGVsIHNvcnRcclxuICAgICAgJ1JFR0lPTic6IHJlZ2lvbk9mKHByb3ZpbmNlKSxcclxuICAgICAgJ1BST1ZJTkNJQSc6IHByb3ZpbmNlLFxyXG4gICAgICAnQVNFU09SIEVYVEVSTk8nOiB2ZW5kb3JMYWJlbEZvckV4Y2VsKHZlbmRvciksXHJcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcclxuICAgICAgJ0NBTExFJzogYS5jYWxsZSB8fCAnJyxcclxuICAgICAgJ05VTUVSTyc6IGEubnVtZXJvIHx8ICcnLFxyXG4gICAgICAnTE9DQUxJREFEJzogbG9jYWxpdHlGaW5hbCxcclxuICAgICAgJ0NQJzogYS5jcCB8fCAnJyxcclxuICAgICAgJ05PTUJSRSBDT01FUkNJQUwnOiBhLmNvbWVyY2lvIHx8IGEudGl0dWxhciB8fCAnJyxcclxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXHJcbiAgICAgICdDVUlUJzogYS5jdWl0IHx8ICcnLFxyXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxyXG4gICAgICAnVEVMRUZPTk8nOiBhLnRlbGVmb25vIHx8ICcnLFxyXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKHIxLlBST1ZJTkNJQSB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5QUk9WSU5DSUEgfHwgJycpO1xyXG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xyXG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcclxuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcclxuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcclxuICB9KTtcclxuICByb3dzLmZvckVhY2goKHIsIGkpID0+IHJbJ05STyBDVEUnXSA9IGkgKyAxKTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHt3Y2g6MTR9LCB7d2NoOjEwfSwge3djaDoxNn0sIHt3Y2g6MjJ9LCB7d2NoOjI4fSxcclxuICAgIHt3Y2g6Mjh9LCB7d2NoOjI4fSwge3djaDoxMH0sIHt3Y2g6MjJ9LCB7d2NoOjEwfSxcclxuICAgIHt3Y2g6Mzh9LCB7d2NoOjMyfSwge3djaDoxNH0sIHt3Y2g6MjR9LCB7d2NoOjE4fSwge3djaDoxNH0sXHJcbiAgXTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0NMSUVOVEVTX1pPTkFTJyk7XHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdUQVJHRVRTX1ZFTkRFRE9SRVNfWk9OQVNfJyArIHRzICsgJy54bHN4Jyk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4Y2VsIGV4cG9ydGFkbzogJyArIHJvd3MubGVuZ3RoICsgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICsgKHNraXBwZWROb1NhcCA+IDAgPyAnICgnICsgc2tpcHBlZE5vU2FwICsgJyBzaW4gQ2FyZENvZGUgZGVzY2FydGFkb3MpJyA6ICcnKSk7XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBwaW4gPSBwcm9tcHQoJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6Jyk7XHJcbiAgaWYgKHBpbiA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xyXG4gICAgYWxlcnQoJ1BJTiBpbmNvcnJlY3RvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBPcGNpb24gSW50ZWdyYWNpb24gU0FQOiBzb2xvIHBhcmEgTWFyaWFubyAoZXJiaW5vbWFyaWFub0BnbWFpbC5jb20pXHJcbiAgY29uc3Qgc2FwT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtc2FwLWludGVncmF0aW9uJyk7XHJcbiAgaWYgKHNhcE9wdCkge1xyXG4gICAgY29uc3QgaXNNYXJpYW5vID0gY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nO1xyXG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcclxuICB9XHJcbiAgLy8gT3BjaW9uIEJhY2t1cCBtZW5zdWFsOiBzb2xvIGFkbWluXHJcbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xyXG4gIGlmIChia09wdCkgYmtPcHQuc3R5bGUuZGlzcGxheSA9ICh1c2VyUm9sZSA9PT0gJ2FkbWluJykgPyAnJyA6ICdub25lJztcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VFeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uKCl7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXHJcbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXHJcbi8vIHNvbG8gZGVudHJvIGRlIGVzdGUgYmxvcXVlICh2ZXJpZmljYWRvIHByZS1leHRyYWNjaVx1MDBGM24pLlxyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFnQkEsU0FBTyx1QkFBdUIsV0FBVTtBQUN0QyxRQUFJLE9BQU8sU0FBUyxhQUFhO0FBQy9CLFlBQU0saUZBQWlGO0FBQ3ZGO0FBQUEsSUFDRjtBQUNBLFFBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxRQUFRO0FBQzdCLFlBQU0sZ0NBQWdDO0FBQ3RDO0FBQUEsSUFDRjtBQUNBLGdCQUFZLHFDQUFxQztBQVFqRCxVQUFNLFdBQVksT0FBTywwQkFBMEIsYUFDL0Msc0JBQXNCLE9BQU8sa0JBQWtCLGNBQWMsZ0JBQWdCLEtBQUssSUFDbEY7QUFDSixVQUFNLFVBQVUsQ0FBQyxjQUFjO0FBQzdCLFVBQUksYUFBYSxLQUFNLFFBQU87QUFDOUIsVUFBSSxDQUFDLFVBQVcsUUFBTztBQUN2QixhQUFP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
