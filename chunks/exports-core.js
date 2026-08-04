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
        rows.push({
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
        });
      });
    });
    const seen = /* @__PURE__ */ new Set();
    rows.forEach(
      (r) => seen.add(
        (r.Provincia || "").toString().toUpperCase() + "|" + (r["Nombre tienda"] || "").toLowerCase()
      )
    );
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xyXG4vLyBFWFBPUlRTLUNPUkU6IG1hc3RlcmZpbGUgY2xpZW50ZXMgKyBwcmVjaW9zL3N0b2NrICsgbW9kYWwgZGUgZXhwb3J0YXIgK1xyXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxyXG4vLyBGcmFnbWVudG9zIHJlc3RhbnRlcyBkZWwgZG9taW5pbyBleHBvcnRzOiBhZHZhbmNlZCAofjEwMzAyLTExNDUxKSB5IFNBUFxyXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgTUFTVEVSRklMRSBERSBDTElFTlRFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxyXG4vLyBub21icmUsIHRpcG8gKGNsaWVudGUvcHJvc3BlY3RvKSwgem9uYSBkZWwgdmVuZGVkb3IsIGFzZXNvciBleHRlcm5vLCBhc2Vzb3JcclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxyXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxyXG4vLyBjb29yZGVuYWRhcyBnZW9jb2RpZmljYWRhcywgZXN0YWRvIChIYWJpbGl0YWRvL1BlbmRpZW50ZS9DYW5jZWxhZG8pLFxyXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cclxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xyXG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcclxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXHJcbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxyXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcclxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xyXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxyXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cclxuICBjb25zdCBzY29wZVNldCA9XHJcbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcclxuICAgICAgOiBudWxsO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XHJcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcclxuICB9O1xyXG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcclxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cclxuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXHJcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXHJcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgJ01BUlRJTiBCT0lFUk8nOiAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgfTtcclxuICBmdW5jdGlvbiBsb29rdXBab25lKHZlbmRvcktleSkge1xyXG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XHJcbiAgICByZXR1cm4gdiA/IHYuem9uZSA6ICcnO1xyXG4gIH1cclxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcclxuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xyXG4gICAgcmV0dXJuIHYgPyB2LmxhYmVsIDogdmVuZG9yS2V5IHx8ICcnO1xyXG4gIH1cclxuXHJcbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxyXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxyXG4gIC8vIGVsIG1hcGEgeSBzZSBjdWVudGFuIGVuIGVsIHN0YXQgSEFCSUxJVEFET1MuIEFudGVzIGVsIG1hc3RlcmZpbGUgYmFqYWJhXHJcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xyXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xyXG4gICAgY29uc3QgbG9jYWxpdHlNYXAgPSBwLm5hbWUgfHwgJyc7XHJcbiAgICBjb25zdCBkZXB0ID0gcC5kZXB0IHx8ICcnO1xyXG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XHJcbiAgICAvLyB2MzMxOiBmaWx0cmFyIHBvciBzY29wZSBkZSB2ZW5kb3IgZGVsIHVzdWFyaW8gcXVlIGV4cG9ydGEuXHJcbiAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xyXG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcclxuICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcclxuICAgIGNvbnN0IGxhdCA9IHAubGF0ICE9IG51bGwgPyBwLmxhdCA6ICcnO1xyXG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XHJcbiAgICAvLyBTb2xvIGNsaWVudGVzIHJlZ3VsYXJlcyAobm8gcHJvc3BlY3RzLCBubyBkaXN0cmlidWlkb3JlcykgcXVlIHBhc2VuXHJcbiAgICAvLyBlbCBmaWx0cm8gaXNTYXBDb25maXJtZWQ6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi5cclxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcclxuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XHJcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICBjb25zdCBrID0gJ0N8JyArIHByb3ZpbmNlICsgJ3wnICsgbG9jYWxpdHlNYXAgKyAnfCcgKyBuYW1lO1xyXG4gICAgICAvLyBFc3RhZG86IGhhYmlsaXRhZG8vY2FuY2VsYWRvL3BlbmRpZW50ZSAobGVnYWN5IGNvbnRhY3RlZCBzZXQpLlxyXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXHJcbiAgICAgIGlmICh0eXBlb2YgY2FuY2VsZWQgIT09ICd1bmRlZmluZWQnICYmIGNhbmNlbGVkICYmIGNhbmNlbGVkLmhhcyAmJiBjYW5jZWxlZC5oYXMoaykpXHJcbiAgICAgICAgZXN0YWRvID0gJ0NhbmNlbGFkbyc7XHJcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cclxuICAgICAgY29uc3QgbWV0YSA9IHR5cGVvZiBjbGllbnRNZXRhICE9PSAndW5kZWZpbmVkJyAmJiBjbGllbnRNZXRhID8gY2xpZW50TWV0YVtrXSB8fCB7fSA6IHt9O1xyXG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xyXG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cclxuICAgICAgY29uc3QgZG9jSWQgPVxyXG4gICAgICAgIHR5cGVvZiBjbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcclxuICAgICAgY29uc3QgY21EYXRhID1cclxuICAgICAgICB0eXBlb2YgY2xpZW50TWFzdGVyQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIGRvY0lkID8gY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGRvY0lkKSB8fCB7fSA6IHt9O1xyXG4gICAgICBjb25zdCBhZGRyZXNzID0gY21EYXRhLmFkZHJlc3MgfHwgbWV0YS5hZGRyZXNzIHx8ICcnO1xyXG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGN1c3RvbUxhdCA9IG1ldGEubGF0ICE9IG51bGwgPyBtZXRhLmxhdCA6ICcnO1xyXG4gICAgICBjb25zdCBjdXN0b21MbmcgPSBtZXRhLmxuZyAhPSBudWxsID8gbWV0YS5sbmcgOiAnJztcclxuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxyXG4gICAgICBsZXQgY2FyZENvZGUgPSBjbURhdGEuc2FwQ2FyZENvZGUgfHwgJyc7XHJcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XHJcbiAgICAgICAgY29uc3QgYWx0YXMgPSBhcHByb3ZlZEFsdGFzQnlMb2Nba2V5XSB8fCBbXTtcclxuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiAoYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8ICcnKSA9PT0gbmFtZSk7XHJcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XHJcbiAgICAgIH1cclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICAnQ2FyZENvZGUgU0FQJzogY2FyZENvZGUsXHJcbiAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBuYW1lLFxyXG4gICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcclxuICAgICAgICBUaXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxyXG4gICAgICAgIEVzdGFkbzogZXN0YWRvLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcclxuICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvY2FsaXR5TWFwLFxyXG4gICAgICAgIERlcGFydGFtZW50bzogZGVwdCxcclxuICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcclxuICAgICAgICBab25hOiB6b25lLFxyXG4gICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcclxuICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXHJcbiAgICAgICAgRGlyZWNjaW9uOiBhZGRyZXNzLFxyXG4gICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jYWxpdHlDdXN0LFxyXG4gICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcclxuICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGN1c3RvbUxuZyB8fCBsb24sXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgLy8gSW55ZWN0YXIgYWx0YXMgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyAoYXBwcm92ZWRBbHRhc0xpc3QpOlxyXG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXHJcbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxyXG4gIC8vICAgICBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLiBWYW4gY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuIFNlXHJcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xyXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXHJcbiAgLy8gICAgIExvcyBwcm92aXNvcmlvcyBwdWVkZW4gbm8gdGVuZXIgZGlyZWNjaW9uIHRvZGF2aWEgLT4gc2UgYWNlcHRhbiBpZ3VhbC5cclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIHJvd3MuZm9yRWFjaCgocikgPT5cclxuICAgIHNlZW4uYWRkKFxyXG4gICAgICAoci5Qcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKSArICd8JyArIChyWydOb21icmUgdGllbmRhJ10gfHwgJycpLnRvTG93ZXJDYXNlKClcclxuICAgIClcclxuICApO1xyXG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xyXG4gICAgYXBwcm92ZWRBbHRhc0xpc3QuZm9yRWFjaCgoYSkgPT4ge1xyXG4gICAgICBpZiAoIWEpIHJldHVybjtcclxuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XHJcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXHJcbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXHJcbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XHJcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XHJcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcclxuICAgICAgY29uc3Qgbm9tYnJlID1cclxuICAgICAgICBhLmNvbWVyY2lvIHx8XHJcbiAgICAgICAgYS5mYW50YXNpYSB8fFxyXG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xyXG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcclxuICAgICAgaWYgKHNlZW4uaGFzKGR1cEtleSkpIHJldHVybjtcclxuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcclxuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcclxuICAgICAgLy8gdjMzMTogbWlzbW8gZmlsdHJvIGRlIHNjb3BlIGFwbGljYSBhIGFsdGFzIFNBUC9wcm92aXNvcmlhcy5cclxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcclxuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcclxuICAgICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxyXG4gICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxyXG4gICAgICAgICdBbGlhcyAobW9kYWwpJzogJycsXHJcbiAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxyXG4gICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92KSA6IHByb3YsXHJcbiAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXHJcbiAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcclxuICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcclxuICAgICAgICBab25hOiB6b25lLFxyXG4gICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcclxuICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXHJcbiAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcclxuICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcclxuICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGEubGF0ICE9IG51bGwgPyBhLmxhdCA6ICcnLFxyXG4gICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBPcmRlbmFyIHBvciBwcm92aW5jaWEsIGxvY2FsaWRhZCwgbm9tYnJlLlxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4ge1xyXG4gICAgY29uc3QgcCA9IChhLlByb3ZpbmNpYSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlByb3ZpbmNpYSB8fCAnJyk7XHJcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XHJcbiAgICBjb25zdCBsID0gKGFbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpO1xyXG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xyXG4gICAgcmV0dXJuIChhWydOb21icmUgdGllbmRhJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKTtcclxuICB9KTtcclxuXHJcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdObyBoYXkgY2xpZW50ZXMgcGFyYSBleHBvcnRhci5cXG5cXG4nICtcclxuICAgICAgICAnRWwgbWFzdGVyZmlsZSBpbmNsdXllOlxcbicgK1xyXG4gICAgICAgICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJyArXHJcbiAgICAgICAgJyAgKiBQcm92aXNvcmlvcyAoQWx0YSByYXBpZGEgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS5cXG5cXG4nICtcclxuICAgICAgICAnU2kgbm8gdmVzIG5pbmd1bm8sIHJldmlzYSBlbCBtb2RhbCBTQVAgbyBBbHRhIENsaWVudGVzLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxNiB9LCAvLyBDYXJkQ29kZSBTQVBcclxuICAgIHsgd2NoOiAzOCB9LCAvLyBOb21icmUgdGllbmRhXHJcbiAgICB7IHdjaDogMjggfSwgLy8gQWxpYXNcclxuICAgIHsgd2NoOiAxNCB9LCAvLyBUaXBvXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gRXN0YWRvXHJcbiAgICB7IHdjaDogMjIgfSwgLy8gUHJvdmluY2lhXHJcbiAgICB7IHdjaDogMjIgfSwgLy8gTG9jYWxpZGFkIG1hcGFcclxuICAgIHsgd2NoOiAyMiB9LCAvLyBEZXBhcnRhbWVudG9cclxuICAgIHsgd2NoOiAyOCB9LCAvLyBWZW5kZWRvciBleHRlcm5vXHJcbiAgICB7IHdjaDogOCB9LCAvLyBab25hXHJcbiAgICB7IHdjaDogNDggfSwgLy8gRXRpcXVldGEgem9uYVxyXG4gICAgeyB3Y2g6IDI4IH0sIC8vIEFzZXNvciBpbnRlcm5vXHJcbiAgICB7IHdjaDogMzggfSwgLy8gRGlyZWNjaW9uXHJcbiAgICB7IHdjaDogMjQgfSwgLy8gTG9jYWxpZGFkIGRlY2xhcmFkYVxyXG4gICAgeyB3Y2g6IDE0IH0sIC8vIExhdFxyXG4gICAgeyB3Y2g6IDE0IH0sIC8vIExuZ1xyXG4gIF07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdDbGllbnRlcyBoYWJpbGl0YWRvcyBTQVAnKTtcclxuXHJcbiAgLy8gSG9qYSByZXN1bWVuIHBvciB6b25hXHJcbiAgY29uc3QgYnlab25lID0ge307XHJcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XHJcbiAgICBjb25zdCB6ID0gclsnRXRpcXVldGEgem9uYSddIHx8ICdTaW4gem9uYSc7XHJcbiAgICBpZiAoIWJ5Wm9uZVt6XSkgYnlab25lW3pdID0geyB0b3RhbDogMCwgaGFiaWxpdGFkb3M6IDAsIGNhbmNlbGFkb3M6IDAgfTtcclxuICAgIGJ5Wm9uZVt6XS50b3RhbCsrO1xyXG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xyXG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gT2JqZWN0LmVudHJpZXMoYnlab25lKVxyXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xyXG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcclxuICAgICAgJ1RvdGFsIHRpZW5kYXMnOiBkLnRvdGFsLFxyXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcclxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxyXG4gICAgfSkpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVG90YWwgdGllbmRhcyddIC0gYVsnVG90YWwgdGllbmRhcyddKTtcclxuICBjb25zdCB3c1JlcyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyZXN1bWVuUm93cyk7XHJcbiAgd3NSZXNbJyFjb2xzJ10gPSBbeyB3Y2g6IDQ4IH0sIHsgd2NoOiAxNCB9LCB7IHdjaDogMTQgfSwgeyB3Y2g6IDE0IH1dO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUmVzLCAnUmVzdW1lbiBwb3Igem9uYScpO1xyXG5cclxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcclxuICAvLyBkZWwgZXhwb3J0IGdsb2JhbCBkZWwgYWRtaW4uXHJcbiAgY29uc3Qgc2NvcGVMYmwgPVxyXG4gICAgc2NvcGVTZXQgPT09IG51bGxcclxuICAgICAgPyAnVE9ET1MnXHJcbiAgICAgIDogc2NvcGVTZXQuc2l6ZSA9PT0gMVxyXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXHJcbiAgICAgICAgOiAnbWlzLXpvbmFzLScgKyBzY29wZVNldC5zaXplO1xyXG4gIGNvbnN0IGZuYW1lID0gJ01hc3RlcmZpbGVfQ2xpZW50ZXNfU0FQXycgKyBzY29wZUxibCArICdfJyArIHRzICsgJy54bHN4JztcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgZm5hbWUpO1xyXG4gIHNob3dTeW5jVGFnKFxyXG4gICAgcm93cy5sZW5ndGggK1xyXG4gICAgICAnIGNsaWVudGVzIGV4cG9ydGFkb3MnICtcclxuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcclxuICApO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4cG9ydDogUHJlY2lvcyArIFN0b2NrIHBvciBTS1VcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xyXG4vLyBlbiBtZW1vcmlhOiBQUk9EVUNUUyAobWFzdGVyIGRlIFNLVXMpLCBQUklDRV9MSVNUX01BUCAocHJlY2lvIEFSUyBkZVxyXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cclxuLy8gSG9qYXM6XHJcbi8vICAtIFwiUHJlY2lvcyB5IFN0b2NrXCI6IHVuYSBmaWxhIHBvciBTS1UgY29uIHRvZGFzIGxhcyBjb2x1bW5hcyBqdW50YXNcclxuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxyXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cclxuLy8gIC0gXCJTdG9ja1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgZXN0YWRvIGRlIHN0b2NrLlxyXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXHJcbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XHJcbiAgLy8gSGVscGVyIGRlIGZvcm1hdG8gZGUgc3RvY2sgcGFyYSBxdWUgc2VhIGxlZ2libGUgZW4gRXhjZWwuXHJcbiAgZnVuY3Rpb24gZm10U3RvY2soc2t1KSB7XHJcbiAgICBjb25zdCB2ID0gdHlwZW9mIGhhc1N0b2NrID09PSAnZnVuY3Rpb24nID8gaGFzU3RvY2soc2t1KSA6IG51bGw7XHJcbiAgICBpZiAodiA9PT0gdHJ1ZSkgcmV0dXJuICdEaXNwb25pYmxlJztcclxuICAgIGlmICh2ID09PSBmYWxzZSkgcmV0dXJuICdTaW4gc3RvY2snO1xyXG4gICAgcmV0dXJuICdTaW4gZGF0byc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGZtdFByZWNpbyhza3UpIHtcclxuICAgIGNvbnN0IHAgPSB0eXBlb2YgUFJJQ0VfTElTVF9NQVAgPT09ICdvYmplY3QnICYmIFBSSUNFX0xJU1RfTUFQID8gUFJJQ0VfTElTVF9NQVBbc2t1XSA6IG51bGw7XHJcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XHJcbiAgICByZXR1cm4gTnVtYmVyKHApIHx8IDA7XHJcbiAgfVxyXG4gIC8vIEhvamEgMTogY29tYm8gY29tcGxldG8gKGVzIGxhIG1hcyBwZWRpZGEpLlxyXG4gIGNvbnN0IHJvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XHJcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcclxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXHJcbiAgICBGYW1pbGlhOiBwLmZhbSB8fCAnJyxcclxuICAgIFN1YmZhbWlsaWE6IHAuc3ViIHx8ICcnLFxyXG4gICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcclxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXHJcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcclxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiA2MCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICBdO1xyXG4gIC8vIEFwbGljYXIgZm9ybWF0byBtb25lZGEgYSBsYSBjb2x1bW5hIFByZWNpbyBBUlMgKGNvbHVtbmEgRiA9IDYpLlxyXG4gIGZvciAobGV0IGkgPSAyOyBpIDw9IHJvd3MubGVuZ3RoICsgMTsgaSsrKSB7XHJcbiAgICBjb25zdCBjZWxsID0gd3NbJ0YnICsgaV07XHJcbiAgICBpZiAoY2VsbCAmJiB0eXBlb2YgY2VsbC52ID09PSAnbnVtYmVyJykgY2VsbC56ID0gJ1wiJFwiIywjIzAnO1xyXG4gIH1cclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1ByZWNpb3MgeSBTdG9jaycpO1xyXG5cclxuICAvLyBIb2phIDI6IHNvbG8gUHJlY2lvc1xyXG4gIGNvbnN0IHByZWNpb3NSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXHJcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxyXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcclxuICB9KSlcclxuICAgIC5maWx0ZXIoKHIpID0+IHJbJ1ByZWNpbyBBUlMnXSAhPT0gJycpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3Qgd3NQID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHByZWNpb3NSb3dzKTtcclxuICB3c1BbJyFjb2xzJ10gPSBbeyB3Y2g6IDE0IH0sIHsgd2NoOiA2MCB9LCB7IHdjaDogMTQgfV07XHJcbiAgZm9yIChsZXQgaSA9IDI7IGkgPD0gcHJlY2lvc1Jvd3MubGVuZ3RoICsgMTsgaSsrKSB7XHJcbiAgICBjb25zdCBjZWxsID0gd3NQWydDJyArIGldO1xyXG4gICAgaWYgKGNlbGwgJiYgdHlwZW9mIGNlbGwudiA9PT0gJ251bWJlcicpIGNlbGwueiA9ICdcIiRcIiMsIyMwJztcclxuICB9XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NQLCAnUHJlY2lvcycpO1xyXG5cclxuICAvLyBIb2phIDM6IHNvbG8gU3RvY2tcclxuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XHJcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcclxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXHJcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcclxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3Qgd3NTID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHN0b2NrUm93cyk7XHJcbiAgd3NTWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUywgJ1N0b2NrJyk7XHJcblxyXG4gIC8vIEhvamEgNDogbWV0YWRhdGEgLSBjdWFuZG8gZnVlIGNhZGEgc25hcHNob3QgcGFyYSBxdWUgZWwgbGVjdG9yIHNlcGFcclxuICAvLyBzaSBsYSBsaXN0YSBlc3RhIGZyZXNjYS5cclxuICBjb25zdCBpbmZvUm93cyA9IFtcclxuICAgIHsgSXRlbTogJ1RvdGFsIFNLVXMgZW4gY2F0YWxvZ28nLCBWYWxvcjogUFJPRFVDVFMubGVuZ3RoIH0sXHJcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBwcmVjaW8gY2FyZ2FkbycsIFZhbG9yOiBwcmVjaW9zUm93cy5sZW5ndGggfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgY29uIHN0b2NrIGRpc3BvbmlibGUnLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSB0cnVlKS5sZW5ndGgsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gc3RvY2snLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSBmYWxzZSkubGVuZ3RoLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIGRhdG8gZGUgc3RvY2snLFxyXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09IG51bGwpLmxlbmd0aCxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdMaXN0YSBkZSBwcmVjaW9zIG1vbmVkYScsXHJcbiAgICAgIFZhbG9yOiB0eXBlb2YgUFJJQ0VfTElTVF9DVVJSRU5DWSAhPT0gJ3VuZGVmaW5lZCcgPyBQUklDRV9MSVNUX0NVUlJFTkNZIDogJ0FSUycsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBhY3R1YWxpemFkYScsXHJcbiAgICAgIFZhbG9yOlxyXG4gICAgICAgIHR5cGVvZiBQUklDRV9MSVNUX1VQREFURURfQVQgIT09ICd1bmRlZmluZWQnICYmIFBSSUNFX0xJU1RfVVBEQVRFRF9BVFxyXG4gICAgICAgICAgPyBuZXcgRGF0ZShQUklDRV9MSVNUX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXHJcbiAgICAgICAgICA6ICcobm8gY2FyZ2FkYSknLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1N0b2NrIHNuYXBzaG90IGFjdHVhbGl6YWRvJyxcclxuICAgICAgVmFsb3I6IFNUT0NLX1VQREFURURfQVQgPyBuZXcgRGF0ZShTVE9DS19VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcobm8gY2FyZ2FkbyknLFxyXG4gICAgfSxcclxuICAgIHsgSXRlbTogJ0V4cG9ydGFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdFeHBvcnRhZG8gcG9yJyxcclxuICAgICAgVmFsb3I6IChjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgY3VycmVudFVzZXIuZGlzcGxheU5hbWUpKSB8fCAnKGRlc2Nvbm9jaWRvKScsXHJcbiAgICB9LFxyXG4gIF07XHJcbiAgY29uc3Qgd3NJID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGluZm9Sb3dzKTtcclxuICB3c0lbJyFjb2xzJ10gPSBbeyB3Y2g6IDM2IH0sIHsgd2NoOiAzNiB9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0ksICdJbmZvJyk7XHJcblxyXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1ByZWNpb3NfeV9TdG9ja18nICsgdHMgKyAnLnhsc3gnKTtcclxuICBzaG93U3luY1RhZyhyb3dzLmxlbmd0aCArICcgU0tVcyBleHBvcnRhZG9zIChwcmVjaW9zICsgc3RvY2spJyk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRVhQT1JUIC0gZGlhbG9nbyBkZSBzZWxlY2Npb24gKyAzIGZvcm1hdG9zXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG53aW5kb3cuZXhwb3J0VG9FeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cclxuICAvLyAgIHZlbmRlZG9yOiBvcGVyYXRpdm8gZGlhcmlvIChWZW50YXMgLyBWaXNpdGFzIC8gUnV0YXMpICsgQ2xpZW50ZXMgZGUgc3Ugem9uYVxyXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxyXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxyXG4gIC8vICAgICBwcm9waW8gc2kgZWxpZ2lvIHN1IG5vbWJyZSBlbiBlbCBkcm9wZG93biBkZSB6b25hcykuXHJcbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cclxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xyXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWRU5UQVMnLCAnVklTSVRBUycsICdSVVRBUycsICdNQVNURVInXSksXHJcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVkVOVEFTJywgJ1ZJU0lUQVMnLCAnUlVUQVMnLCAnTUFTVEVSJ10pLFxyXG4gIH07XHJcbiAgY29uc3QgYWxsb3dlZCA9IGFsbG93ZWRCeVJvbGVbdXNlclJvbGVdIHx8IG51bGw7IC8vIG51bGwgPSB2ZXIgdG9kb1xyXG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNleHBvcnQtbW9kYWwgLmV4cC1vcHQnKS5mb3JFYWNoKChlbCkgPT4ge1xyXG4gICAgY29uc3Qga2luZCA9IGVsLmRhdGFzZXQuZXhwS2luZCB8fCAnJztcclxuICAgIGVsLnN0eWxlLmRpc3BsYXkgPSAhYWxsb3dlZCB8fCBhbGxvd2VkLmhhcyhraW5kKSA/ICcnIDogJ25vbmUnO1xyXG4gIH0pO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZUV4cG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIE1vbnRoIHBpY2tlciByZXV0aWxpemFibGUgcGFyYSBsb3MgNSB0aXBvcyBkZSBleHBvcnRcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmxldCBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XHJcbmNvbnN0IEVYUE9SVF9UWVBFX0xBQkVMUyA9IHtcclxuICBWRU5UQVM6ICdWZW50YXMnLFxyXG4gIFZJU0lUQVM6ICdWaXNpdGFzJyxcclxuICBSRU5ESUNJT05FUzogJ1JlbmRpY2lvbmVzJyxcclxuICBSVVRBUzogJ1J1dGFzJyxcclxuICBBTFRBUzogJ0FsdGFzIGRlIGNsaWVudGVzJyxcclxufTtcclxuXHJcbndpbmRvdy5zaG93TW9udGhQaWNrZXIgPSBmdW5jdGlvbiAodGlwbykge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gdGlwbztcclxuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xyXG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xyXG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0V4cG9ydGFyICcgKyAoRVhQT1JUX1RZUEVfTEFCRUxTW3RpcG9dIHx8IHRpcG8pO1xyXG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcclxuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXHJcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XHJcbiAgbWVzU2VsLmlubmVySFRNTCA9XHJcbiAgICAnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zIGxvcyBtZXNlcyAoYVx1MDBGMW8gZW50ZXJvKTwvb3B0aW9uPicgK1xyXG4gICAgTUVTRVMubWFwKChtLCBpKSA9PiAnPG9wdGlvbiB2YWx1ZT1cIicgKyBpICsgJ1wiPicgKyBtICsgJzwvb3B0aW9uPicpLmpvaW4oJycpO1xyXG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xyXG4gIGNvbnN0IGFuaW9TZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpO1xyXG4gIGNvbnN0IHllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcclxuICBsZXQgeW9wdHMgPSAnJztcclxuICBmb3IgKGxldCB5ID0geWVhciAtIDM7IHkgPD0geWVhciArIDE7IHkrKylcclxuICAgIHlvcHRzICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIHkgKyAnXCI+JyArIHkgKyAnPC9vcHRpb24+JztcclxuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xyXG4gIGFuaW9TZWwudmFsdWUgPSB5ZWFyO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VNb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5jb25maXJtTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xyXG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcclxuICBjb25zdCBhbmlvID0gcGFyc2VJbnQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKS52YWx1ZSwgMTApO1xyXG4gIGNvbnN0IG1vbnRoSWR4ID0gbWVzUmF3ID09PSAnQUxMJyA/IG51bGwgOiBwYXJzZUludChtZXNSYXcsIDEwKTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxuICBpZiAoIXRpcG8pIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgaWYgKHRpcG8gPT09ICdWRU5UQVMnKSBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSVVRBUycpIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0FMVEFTJykgZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGFsZXJ0KCdUaXBvIGRlc2Nvbm9jaWRvOiAnICsgdGlwbyk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0ICcgKyB0aXBvLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpIHtcclxuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkgcmV0dXJuIFN0cmluZyhhbmlvKTtcclxuICByZXR1cm4gTUVTRVNbbW9udGhJZHhdICsgJ18nICsgYW5pbztcclxufVxyXG5cclxuZnVuY3Rpb24gZG93bmxvYWRYbHN4KGZpbGVuYW1lLCBzaGVldHMpIHtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XHJcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgICAgcy5yb3dzLmxlbmd0aCA/IHMucm93cyA6IFt7IEF2aXNvOiAnU2luIGRhdG9zIHBhcmEgZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8nIH1dXHJcbiAgICApO1xyXG4gICAgaWYgKHMucm93cy5sZW5ndGgpIHtcclxuICAgICAgY29uc3QgY29scyA9IE9iamVjdC5rZXlzKHMucm93c1swXSkubWFwKChrKSA9PiAoe1xyXG4gICAgICAgIHdjaDogTWF0aC5taW4oNDAsIE1hdGgubWF4KDEwLCBrLmxlbmd0aCArIDQpKSxcclxuICAgICAgfSkpO1xyXG4gICAgICB3c1snIWNvbHMnXSA9IGNvbHM7XHJcbiAgICB9XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgcy5uYW1lLnNsaWNlKDAsIDMxKSk7XHJcbiAgfVxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCBmaWxlbmFtZSk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBWRU5UQVM6IHBlZGlkb3MgY29uZmlybWFkb3MgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmVudGFzLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IHAgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KHAubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgIGNvbnN0IGxpbmVzID0gcC5saW5lcyB8fCBbXTtcclxuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XHJcbiAgICBjb25zdCB2ZW5kb3JLZXkgPSBwLnZlbmRvciB8fCBsb29rdXBWZW5kb3JGb3JDbGllbnQocC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpIHx8ICcnO1xyXG4gICAgY29uc3QgdmVuZG9ySW5mbyA9IHZlbmRvckxvb2t1cFt2ZW5kb3JLZXldIHx8IHt9O1xyXG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xyXG4gICAgY29uc3QgZGlzY1BjdCA9IChwLmRpc2NvdW50U25hcHNob3QgJiYgcC5kaXNjb3VudFNuYXBzaG90LnBjdFRvdGFsKSB8fCAwO1xyXG4gICAgbGluZXMuZm9yRWFjaCgobCkgPT4ge1xyXG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xyXG4gICAgICBjb25zdCBwcmVjaW8gPSBwYXJzZUZsb2F0KGwucHJlY2lvKSB8fCAwO1xyXG4gICAgICBjb25zdCBncm9zcyA9IHF0eSAqIHByZWNpbztcclxuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxyXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICAgICAgRXN0YWRvOiBwLnN0YWdlIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yS2V5IHx8ICcnKSxcclxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSB8fCAnJyksXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIENvZGlnb19TS1U6IGwuY29kZSB8fCAnJyxcclxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8ICcnLFxyXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXHJcbiAgICAgICAgRmFtaWxpYTogbC5mYW0gfHwgJycsXHJcbiAgICAgICAgU3ViZmFtaWxpYTogbC5zdWIgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcclxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcclxuICAgICAgICAvLyBTdWJ0b3RhbF9BUlMgPSBORVRPIChjb24gZGVzY3VlbnRvIGFwbGljYWRvKSAtIGVzIGxvIHF1ZSBjdWVudGFcclxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXHJcbiAgICAgICAgLy8gZGUgbGlzdGEgc2luIGRlc2N1ZW50byBwYXJhIHRyYXphYmlsaWRhZC5cclxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQobmV0KSxcclxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxyXG4gICAgICAgIERlc2N1ZW50b19QY3Q6IGRpc2NQY3QsXHJcbiAgICAgICAgRW5fTm9tYnJlX0RlX1ZERTogcC5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1ZlbnRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdWZW50YXMnLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xyXG4gIGlmICghcHJvdiB8fCAhbG9jTmFtZSkgcmV0dXJuICcnO1xyXG4gIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3YgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcclxuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFZJU0lUQVM6IGRldGFsbGUgZGUgdmlzaXRhcyBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmlzaXRhcyArIENvbnRhY3Rvcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHRhcmdldE1lcyA9IG1vbnRoSWR4ICE9PSBudWxsID8gTUVTRVNbbW9udGhJZHhdLnRvVXBwZXJDYXNlKCkgOiBudWxsO1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBpZiAocGFyc2VJbnQodi5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmICh0YXJnZXRNZXMgJiYgKHYubWVzIHx8ICcnKS50b1VwcGVyQ2FzZSgpICE9PSB0YXJnZXRNZXMpIHJldHVybjtcclxuICAgIGl0ZW1zLnB1c2godik7XHJcbiAgfSk7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xyXG4gIGNvbnN0IG5Db250YWN0b3MgPSBpdGVtcy5sZW5ndGggLSBuVmlzaXRhcztcclxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGRlbCBmcmVudGUgZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBMYXp5IGxvYWQuXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzIHkgQ29udGFjdG9zJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XHJcbiAgd3MuY29sdW1ucyA9IFtcclxuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdNZXMnLCBrZXk6ICdtZXMnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnQW5pbycsIGtleTogJ2FuaW8nLCB3aWR0aDogOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnSW50ZXJhY2Npb24nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdGb3JtYSBDb250YWN0bycsIGtleTogJ2Zvcm1hQ29udGFjdG8nLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnUmVzdWx0YWRvIENvbnRhY3RvJywga2V5OiAncmVzdWx0YWRvQ3QnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXHJcbiAgICB7IGhlYWRlcjogJ05lY2VzaWRhZCBQdW50dWFsJywga2V5OiAnbmVjJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ01hcyBWZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnTWFzIFByZWd1bnRhbicsIGtleTogJ21hc1ByJywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ0F5dWRhIFRpZW5kYScsIGtleTogJ2F5dWRhJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gVmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnUG9uZCBNb3N0cmFkb3InLCBrZXk6ICdwTW9zdCcsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdQb25kIEVjb21tZXJjZScsIGtleTogJ3BFY29tJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnR1BTIFN0YXR1cycsIGtleTogJ2dwc1N0Jywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0dQUyBEaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0VuIG5vbWJyZSBkZSBWREUnLCBrZXk6ICdvbkJlaGFsZicsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdDYXJnYWRvIFBvcicsIGtleTogJ2NyZWF0ZWRCeScsIHdpZHRoOiAyNCB9LFxyXG4gIF07XHJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xyXG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcclxuXHJcbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcclxuICBjb25zdCBST1dfSCA9IDEwMDtcclxuICBjb25zdCBJTUdfVyA9IDEzMDtcclxuICBjb25zdCBJTUdfSCA9IDkwO1xyXG5cclxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXHJcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IHYgb2YgaXRlbXMpIHtcclxuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcclxuICAgIGNvbnN0IGludGVyYWNjaW9uTGJsID0gaXNDb250YWN0byA/ICdDb250YWN0bycgOiAnVmlzaXRhJztcclxuICAgIGNvbnN0IGZvcm1hQ29udGFjdG9MYmwgPSBpc0NvbnRhY3RvID8gdi5mb3JtYUNvbnRhY3RvIHx8ICdTaW4gZXNwZWNpZmljYXInIDogJ1ByZXNlbmNpYWwnO1xyXG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XHJcbiAgICBpZiAoaXNDb250YWN0bykge1xyXG4gICAgICBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ1Jlc3BvbmRpbyc7XHJcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xyXG4gICAgICBlbHNlIHJlc3VsdGFkb0N0TGJsID0gJ1NpbiBtYXJjYXInO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6IHYuZmVjaGEgfHwgJycsXHJcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXHJcbiAgICAgIGFuaW86IHYuYW5pbyB8fCAnJyxcclxuICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXHJcbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcclxuICAgICAgZm9ybWFDb250YWN0bzogZm9ybWFDb250YWN0b0xibCxcclxuICAgICAgcmVzdWx0YWRvQ3Q6IHJlc3VsdGFkb0N0TGJsLFxyXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcclxuICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxyXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxyXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxyXG4gICAgICB0aXBvOiB2LnRpcG8gfHwgJycsXHJcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxyXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxyXG4gICAgICBmaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxyXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxyXG4gICAgICBuZWM6IHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcclxuICAgICAgb3BvcnR1OiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxyXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgICBtYXNQcjogdi5tYXNQcmVndW50YW4gfHwgJycsXHJcbiAgICAgIGF5dWRhOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxyXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcclxuICAgICAgcE1vc3Q6IHYucG9uZGVyYWNpb25Nb3N0cmFkbyB8fCAnJyxcclxuICAgICAgcEVjb206IHYucG9uZGVyYWNpb25FY29tbWVyY2UgfHwgJycsXHJcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBncHNTdDogdi5ncHNTdGF0dXMgfHwgJycsXHJcbiAgICAgIGdwc0Rpc3Q6IHYuZ3BzRGlzdGFuY2VNICE9IG51bGwgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXHJcbiAgICAgIG9uQmVoYWxmOiB2Lm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcclxuICAgICAgY3JlYXRlZEJ5OiB2LmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHYuY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICB9KTtcclxuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcclxuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcclxuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xyXG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XHJcbiAgICAgICAgaWYgKG0pIHtcclxuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgIGI2NCA9IG1bMl07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXHJcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXHJcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHZpc2l0YScsIGUpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XHJcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgbGlzdG86ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MnLCAyNDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdGFzRm9yTW9udGgnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBSRU5ESUNJT05FUzogZ2FzdG9zIHkgYW50aWNpcG9zIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUmVuZGljaW9uZXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncmVuZGljaW9uZXMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBsZXQgZHQgPSByLmZlY2hhIHx8IHIuZmVjaGFHYXN0byB8fCAnJztcclxuICAgIGlmICghZHQgJiYgci5jcmVhdGVkQXQgJiYgci5jcmVhdGVkQXQudG9EYXRlKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgZHQgPSByLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgICB9XHJcbiAgICBpZiAoIWR0KSByZXR1cm47XHJcbiAgICBjb25zdCBkT2JqID0gbmV3IERhdGUoZHQpO1xyXG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcclxuICAgIGlmIChkT2JqLmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkT2JqLmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcclxuICB9KTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgaXRlbXMubGVuZ3RoICsgJyByZW5kaWNpb25lcy4uLicsIDMwMDApO1xyXG5cclxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XHJcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcclxuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcclxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjYgfSxcclxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb25jZXB0bycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ04gVGlja2V0Jywga2V5OiAnbnVtVGlja2V0Jywgd2lkdGg6IDE0IH0sXHJcbiAgICB7IGhlYWRlcjogJ01vZG8gcGFnbycsIGtleTogJ21vZG9QYWdvJywgd2lkdGg6IDE0IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gZ2FzdG8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjQgfSxcclxuICAgIHsgaGVhZGVyOiAnRGl2aXNpb24nLCBrZXk6ICdkaXZpc2lvbicsIHdpZHRoOiAxNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlJywga2V5OiAnaW1wb3J0ZScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdNb25lZGEnLCBrZXk6ICdtb25lZGEnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZSBVU0QnLCBrZXk6ICdpbXBvcnRlVXNkJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ09ic2VydmFjaW9uZXMnLCBrZXk6ICdvYnMnLCB3aWR0aDogMzAgfSxcclxuICAgIHsgaGVhZGVyOiAnRm90byB0aWNrZXQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0VzdGFkbycsIGtleTogJ2VzdGFkbycsIHdpZHRoOiAxOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkb3InLCBrZXk6ICdhcHJvYmFkb3InLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG8gZW4nLCBrZXk6ICdhcHJvYmFkb0VuJywgd2lkdGg6IDE0IH0sXHJcbiAgXTtcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xyXG5cclxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxyXG4gIGNvbnN0IFJPV19IID0gMTEwO1xyXG4gIGNvbnN0IElNR19XID0gMTQwO1xyXG4gIGNvbnN0IElNR19IID0gMTAwO1xyXG5cclxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXHJcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XHJcbiAgICBjb25zdCByID0gaXQucjtcclxuICAgIGNvbnN0IGlzR2FzdG8gPSByLnRpcG8gPT09ICdnYXN0byc7XHJcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XHJcbiAgICBjb25zdCBvYnNTdHIgPVxyXG4gICAgICAoci5vYnNlcnZhY2lvbmVzIHx8IHIubm90YXMgfHwgJycpICtcclxuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcclxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XHJcbiAgICAgIGZlY2hhOiBpdC5mZWNoYSxcclxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxyXG4gICAgICB2ZW5kZWRvcjogci5vd25lck5hbWUgfHwgci52ZW5kb3JOYW1lIHx8IHIub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgZW1haWw6IHIub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXHJcbiAgICAgIG51bVRpY2tldDogci5udW1lcm9UaWNrZXQgfHwgJycsXHJcbiAgICAgIG1vZG9QYWdvOiByLm1vZG9QYWdvIHx8ICcnLFxyXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxyXG4gICAgICBkaXZpc2lvbjogci5kaXZpc2lvbkdhc3RvIHx8ICcnLFxyXG4gICAgICBpbXBvcnRlOiByLmltcG9ydGUgIT0gbnVsbCA/IHIuaW1wb3J0ZSA6ICcnLFxyXG4gICAgICBtb25lZGE6IHIubW9uZWRhIHx8ICdQRVNPUycsXHJcbiAgICAgIGltcG9ydGVVc2Q6IHIuaW1wb3J0ZVVzZCAhPSBudWxsICYmIHIuaW1wb3J0ZVVzZCAhPT0gMCA/IHIuaW1wb3J0ZVVzZCA6ICcnLFxyXG4gICAgICBvYnM6IG9ic1N0cixcclxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxyXG4gICAgICBlc3RhZG86IHIuc3RhdHVzIHx8IHIuZXN0YWRvIHx8ICcnLFxyXG4gICAgICBhcHJvYmFkb3I6IHIuYXBwcm92ZXJFbWFpbCB8fCByLmFwcm9iYWRvciB8fCAnJyxcclxuICAgICAgYXByb2JhZG9FbjpcclxuICAgICAgICByLmFwcHJvdmVkQXQgJiYgci5hcHByb3ZlZEF0LnRvRGF0ZSA/IHIuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxyXG4gICAgfSk7XHJcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XHJcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XHJcbiAgICAvLyBFbWJlYmVyIGZvdG8gZGVsIHRpY2tldCBzaSBleGlzdGUuIHYzMDgrOiBwcmVmZXJpciBiYXNlNjQgZW1iZWJpZG9cclxuICAgIC8vIChmb3RvVGlja2V0IC8gYWRqdW50bykgcG9yIGNvbXBhdCwgc2lubyB1c2FyIGZvdG9UaWNrZXRVcmwgY29tbyBIWVBFUkxJTksuXHJcbiAgICAvLyBBIG5pdmVsIEV4Y2VsIHVuIGRhdGFVUkwgYmFzZTY0IHNlIHB1ZWRlIGluc2VydGFyIGNvbW8gaW1hZ2VuIGlubGluZSxcclxuICAgIC8vIG1pZW50cmFzIHF1ZSB1bmEgVVJMIGRlIFN0b3JhZ2Ugc2UgYWdyZWdhIGNvbW8gbGluayBjbGlja2VhYmxlIChlbFxyXG4gICAgLy8gdXN1YXJpbyBhYnJlIGVuIGVsIGJyb3dzZXIgc2luIG5lY2VzaWRhZCBkZSBxdWUgRXhjZWwgZGVzY2FyZ3VlKS5cclxuICAgIGNvbnN0IGZvdG9TcmMgPSByLmZvdG9UaWNrZXQgfHwgci5hZGp1bnRvIHx8ICcnO1xyXG4gICAgaWYgKGZvdG9TcmMgJiYgdHlwZW9mIGZvdG9TcmMgPT09ICdzdHJpbmcnICYmIGZvdG9TcmMuc3RhcnRzV2l0aCgnZGF0YTppbWFnZS8nKSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBiNjQgPSBmb3RvU3JjO1xyXG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XHJcbiAgICAgICAgaWYgKG0pIHtcclxuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgIGI2NCA9IG1bMl07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXHJcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXHJcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgLy8gRG9jcyBudWV2b3MgKHYzMDgrKTogZm90byBlbiBTdG9yYWdlLCBpbnNlcnRhbW9zIGNvbW8gaHlwZXJsaW5rLlxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGNlbGwgPSByb3cuZ2V0Q2VsbChGT1RPX0NPTF9JRFggKyAxKTtcclxuICAgICAgICBjZWxsLnZhbHVlID0ge1xyXG4gICAgICAgICAgdGV4dDogJ0FicmlyIHRpY2tldCcsXHJcbiAgICAgICAgICBoeXBlcmxpbms6IHIuZm90b1RpY2tldFVybCxcclxuICAgICAgICAgIHRvb2x0aXA6ICdBYnJpciBsYSBmb3RvIGRlbCB0aWNrZXQgZW4gZWwgYnJvd3NlcicsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ2h5cGVybGluayBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19SZW5kaWNpb25lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSdXRhcy4uLicpO1xyXG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xyXG4gIC8vIChkZXJpdmFjaW9uZXMgLyByZWFnZW5kYXMpIHZpdmVuIGVuIHJvdXRlX292ZXJyaWRlcy4gRXhwb3J0YW1vczpcclxuICAvLyAgLSB1bmEgaG9qYSBjb24gbGFzIHJ1dGFzIHBsYW5pZmljYWRhcyBkZWwgcGVyaW9kbyAocGFyYSBsb3MgdmVuZGVkb3Jlc1xyXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXHJcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxvcyBvdmVycmlkZXMgZGVsIHBlcmlvZG9cclxuICBjb25zdCB0YXJnZXRWZW5kb3JzID1cclxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xyXG4gICAgICA/IFZFTkRPUlMubWFwKCh2KSA9PiB2LmtleSlcclxuICAgICAgOiBhc3NpZ25lZFZlbmRvclxyXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxyXG4gICAgICAgIDogW107XHJcbiAgY29uc3QgbW9udGhzVG9FeHBvcnQgPSBtb250aElkeCAhPT0gbnVsbCA/IFttb250aElkeF0gOiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgNywgOCwgOSwgMTAsIDExXTtcclxuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcclxuICBmb3IgKGNvbnN0IHZlbmQgb2YgdGFyZ2V0VmVuZG9ycykge1xyXG4gICAgZm9yIChjb25zdCBtIG9mIG1vbnRoc1RvRXhwb3J0KSB7XHJcbiAgICAgIGxldCBydXRhcztcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBydXRhcyA9IGdlbmVyYXJSdXRhc1ZlbmRvcih2ZW5kLCBtLCBhbmlvKTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHtcclxuICAgICAgICBydXRhcyA9IFtdO1xyXG4gICAgICB9XHJcbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xyXG4gICAgICAgIChydXRhLnRpZW5kYXMgfHwgW10pLmZvckVhY2goKHQsIGkpID0+IHtcclxuICAgICAgICAgIHJ1dGFzUm93cy5wdXNoKHtcclxuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcclxuICAgICAgICAgICAgQW5pbzogYW5pbyxcclxuICAgICAgICAgICAgTWVzOiBNRVNFU1ttXSxcclxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcclxuICAgICAgICAgICAgUnV0YV9Ob21icmU6IHJ1dGEubm9tYnJlIHx8ICcnLFxyXG4gICAgICAgICAgICBGZWNoYV9Bc2lnbmFkYTogcnV0YS5mZWNoYUFzaWduYWRhIHx8ICcnLFxyXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXHJcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHQucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgICAgICBMb2NhbGlkYWQ6IHQubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgICAgIFRpcG86IHQudGlwbyB8fCAnJyxcclxuICAgICAgICAgICAgRXN0YWRvOiB0LmVzdGFkbyB8fCAnJyxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gT3ZlcnJpZGVzXHJcbiAgbGV0IG92clNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIG92clNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvdXRlX292ZXJyaWRlcycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICBvdnJTbmFwID0gbnVsbDtcclxuICB9XHJcbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xyXG4gIGlmIChvdnJTbmFwKSB7XHJcbiAgICBvdnJTbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBpZiAocGFyc2VJbnQoby5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KG8ubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcclxuICAgICAgICBBbmlvOiBvLmFuaW8gfHwgJycsXHJcbiAgICAgICAgTWVzOiBNRVNFU1twYXJzZUludChvLm1vbnRoSWR4LCAxMCldIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKG8ucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIEFjY2lvbjogby5hY3Rpb24gfHwgby50aXBvIHx8ICcnLFxyXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxyXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcclxuICAgICAgICBNb3Rpdm86IG8ubW90aXZvIHx8ICcnLFxyXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgICAgQ3JlYWRvX0VuOlxyXG4gICAgICAgICAgby5jcmVhdGVkQXQgJiYgby5jcmVhdGVkQXQudG9EYXRlID8gby5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19SdXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcclxuICAgIHsgbmFtZTogJ1J1dGFzIHBsYW5pZmljYWRhcycsIHJvd3M6IHJ1dGFzUm93cyB9LFxyXG4gICAgeyBuYW1lOiAnRGVyaXZhY2lvbmVzLVJlYWdlbmRhcycsIHJvd3M6IG92ZXJyaWRlc1Jvd3MgfSxcclxuICBdKTtcclxuICBzaG93U3luY1RhZyhcclxuICAgICdFeHBvcnQgUnV0YXMgbGlzdG8gKCcgKyBydXRhc1Jvd3MubGVuZ3RoICsgJyB0aWVuZGFzLCAnICsgb3ZlcnJpZGVzUm93cy5sZW5ndGggKyAnIG92ZXJyaWRlcyknLFxyXG4gICAgMjQwMFxyXG4gICk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQWx0YXMuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGxldCBkdCA9ICcnO1xyXG4gICAgaWYgKGEuY3JlYXRlZEF0ICYmIGEuY3JlYXRlZEF0LnRvRGF0ZSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGR0ID0gYS5jcmVhdGVkQXQudG9EYXRlKCk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfVxyXG4gICAgaWYgKCFkdCkgcmV0dXJuO1xyXG4gICAgaWYgKGR0LmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgcm93cy5wdXNoKHtcclxuICAgICAgRmVjaGFfU29saWNpdHVkOiBkdC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSxcclxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcclxuICAgICAgQ29tZXJjaW86IGEuY29tZXJjaW8gfHwgJycsXHJcbiAgICAgIEZhbnRhc2lhOiBhLmZhbnRhc2lhIHx8ICcnLFxyXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXHJcbiAgICAgIENvbmRpY2lvbl9GaXNjYWw6IGEuY29uZEZpc2NhbCB8fCAnJyxcclxuICAgICAgQ2FsbGU6IGEuY2FsbGUgfHwgJycsXHJcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXHJcbiAgICAgIExvY2FsaWRhZDogYS5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICAgIFByb3ZpbmNpYTogYS5wcm92aW5jaWEgfHwgJycsXHJcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxyXG4gICAgICBUZWxlZm9ubzogYS50ZWxlZm9ubyB8fCAnJyxcclxuICAgICAgRW1haWw6IGEuZW1haWwgfHwgJycsXHJcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBPd25lcl9FbWFpbDogYS5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBTdWJtaXR0ZWRfQnlfUHVibGljX0Zvcm06IGEuc3VibWl0dGVkQnlQdWJsaWNGb3JtID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgIEFwcm9iYWRvX0VuOlxyXG4gICAgICAgIGEuYXBwcm92ZWRBdCAmJiBhLmFwcHJvdmVkQXQudG9EYXRlID8gYS5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0FsdGFzIGRlIGNsaWVudGVzJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBBbHRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBzb2xpY2l0dWRlcyknLCAyNDAwKTtcclxufVxyXG5cclxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cclxuY29uc3QgQU5BTElTSVNfUElOID0gJzEyMzUnO1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIGxhIGhvamEgQ0xJRU5URVNfWk9OQVMgY29uIFVOQSBmaWxhIHBvciBCUCBxdWUgZXN0YSB2aXZvIGVuIFNBUDpcclxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxyXG4vLyBhc2lnbmFkby4gRXhjbHV5ZSBQT0lOVFMgLyBkaXN0cmlidWlkb3JlcyAvIHByb3NwZWN0b3MgLyBhbHRhcyBzaW5cclxuLy8gQ2FyZENvZGUgKG1vY2tzIG8gcGVuZGllbnRlcyBkZSBTQVApLiBFcyBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBmYWN0dXJhLlxyXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcclxuLy8gQ0FMTEUsIE5VTUVSTywgTE9DQUxJREFELCBDUCwgTk9NQlJFIENPTUVSQ0lBTCwgTk9NQlJFIERFIEZBTlRBU0lBLCBDVUlULFxyXG4vLyBDT05ESUNJT04gRklTQ0FMLCBURUxFRk9OTywgQ0FSRENPREUgU0FQLlxyXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpY1x1MDBFMSB0dSBjb25leGlcdTAwRjNuIHkgcmVpbnRlbnRcdTAwRTEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XHJcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgJ01BUlRJTiBCT0lFUk8nOiAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgfTtcclxuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XHJcbiAgICBjb25zdCBwID0gKHByb3YgfHwgJycpLnRvVXBwZXJDYXNlKCk7XHJcbiAgICBpZiAoWydCVUVOT1MgQUlSRVMnLCAnQ0FQSVRBTCBGRURFUkFMJywgJ0xBIFBBTVBBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQlVFTk9TIEFJUkVTJztcclxuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xyXG4gICAgaWYgKFsnU0FOVEEgRkUnLCAnRU5UUkUgUklPUycsICdDSEFDTycsICdDT1JSSUVOVEVTJywgJ01JU0lPTkVTJywgJ0ZPUk1PU0EnXS5pbmNsdWRlcyhwKSlcclxuICAgICAgcmV0dXJuICdORUEnO1xyXG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XHJcbiAgICBpZiAoWydORVVRVUVOJywgJ1JJTyBORUdSTycsICdDSFVCVVQnLCAnU0FOVEEgQ1JVWicsICdUSUVSUkEgREVMIEZVRUdPJ10uaW5jbHVkZXMocCkpXHJcbiAgICAgIHJldHVybiAnUEFUQUdPTklBJztcclxuICAgIHJldHVybiAnJztcclxuICB9XHJcbiAgZnVuY3Rpb24gdmVuZG9yTGFiZWxGb3JFeGNlbChrZXkpIHtcclxuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XHJcbiAgICBpZiAoa2V5ID09PSAnX19ESVNUUklCVVRPUl9fJykgcmV0dXJuICdESVNUUklCVUlET1JFUyc7XHJcbiAgICByZXR1cm4ga2V5O1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgbGV0IGFsdGFzU25hcDtcclxuICB0cnkge1xyXG4gICAgYWx0YXNTbmFwID0gYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXHJcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcclxuICAgICAgLmdldCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcclxuICBhbHRhc1NuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xyXG4gICAgLy8gRmlsdHJvIGNsYXZlOiBzb2xvIEJQcyBjb24gQ2FyZENvZGUgU0FQIGFzaWduYWRvICg9IGhhYmlsaXRhZG8gZW4gU0FQKS5cclxuICAgIGlmICghY2FyZENvZGUpIHtcclxuICAgICAgc2tpcHBlZE5vU2FwKys7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcclxuICAgIGNvbnN0IGxvY2FsaXR5RmluYWwgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcnO1xyXG4gICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIFRJUE86ICdEQURPIERFIEFMVEEnLFxyXG4gICAgICAnTlJPIENURSc6IDAsIC8vIHNlIHJlbnVtZXJhIGRlc3B1ZXMgZGVsIHNvcnRcclxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXHJcbiAgICAgIFBST1ZJTkNJQTogcHJvdmluY2UsXHJcbiAgICAgICdBU0VTT1IgRVhURVJOTyc6IHZlbmRvckxhYmVsRm9yRXhjZWwodmVuZG9yKSxcclxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxyXG4gICAgICBDQUxMRTogYS5jYWxsZSB8fCAnJyxcclxuICAgICAgTlVNRVJPOiBhLm51bWVybyB8fCAnJyxcclxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxyXG4gICAgICBDUDogYS5jcCB8fCAnJyxcclxuICAgICAgJ05PTUJSRSBDT01FUkNJQUwnOiBhLmNvbWVyY2lvIHx8IGEudGl0dWxhciB8fCAnJyxcclxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXHJcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcclxuICAgICAgJ0NPTkRJQ0lPTiBGSVNDQUwnOiBhLmNvbmRpY2lvbkZpc2NhbCB8fCAnJyxcclxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXHJcbiAgICAgICdDQVJEQ09ERSBTQVAnOiBjYXJkQ29kZSxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGlmICghcm93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgcm93cy5zb3J0KChyMSwgcjIpID0+IHtcclxuICAgIGNvbnN0IHAgPSAocjEuUFJPVklOQ0lBIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLlBST1ZJTkNJQSB8fCAnJyk7XHJcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XHJcbiAgICBjb25zdCBsID0gKHIxLkxPQ0FMSURBRCB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5MT0NBTElEQUQgfHwgJycpO1xyXG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xyXG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xyXG4gIH0pO1xyXG4gIHJvd3MuZm9yRWFjaCgociwgaSkgPT4gKHJbJ05STyBDVEUnXSA9IGkgKyAxKSk7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxMCB9LFxyXG4gICAgeyB3Y2g6IDE2IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAyOCB9LFxyXG4gICAgeyB3Y2g6IDI4IH0sXHJcbiAgICB7IHdjaDogMjggfSxcclxuICAgIHsgd2NoOiAxMCB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMTAgfSxcclxuICAgIHsgd2NoOiAzOCB9LFxyXG4gICAgeyB3Y2g6IDMyIH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ0xJRU5URVNfWk9OQVMnKTtcclxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdUQVJHRVRTX1ZFTkRFRE9SRVNfWk9OQVNfJyArIHRzICsgJy54bHN4Jyk7XHJcbiAgc2hvd1N5bmNUYWcoXHJcbiAgICAnRXhjZWwgZXhwb3J0YWRvOiAnICtcclxuICAgICAgcm93cy5sZW5ndGggK1xyXG4gICAgICAnIGNsaWVudGVzIFNBUCBoYWJpbGl0YWRvcycgK1xyXG4gICAgICAoc2tpcHBlZE5vU2FwID4gMCA/ICcgKCcgKyBza2lwcGVkTm9TYXAgKyAnIHNpbiBDYXJkQ29kZSBkZXNjYXJ0YWRvcyknIDogJycpXHJcbiAgKTtcclxufTtcclxuXHJcbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgcGluID0gcHJvbXB0KFxyXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xyXG4gICk7XHJcbiAgaWYgKHBpbiA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xyXG4gICAgYWxlcnQoJ1BJTiBpbmNvcnJlY3RvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBPcGNpb24gSW50ZWdyYWNpb24gU0FQOiBzb2xvIHBhcmEgTWFyaWFubyAoZXJiaW5vbWFyaWFub0BnbWFpbC5jb20pXHJcbiAgY29uc3Qgc2FwT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtc2FwLWludGVncmF0aW9uJyk7XHJcbiAgaWYgKHNhcE9wdCkge1xyXG4gICAgY29uc3QgaXNNYXJpYW5vID1cclxuICAgICAgY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nO1xyXG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcclxuICB9XHJcbiAgLy8gT3BjaW9uIEJhY2t1cCBtZW5zdWFsOiBzb2xvIGFkbWluXHJcbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xyXG4gIGlmIChia09wdCkgYmtPcHQuc3R5bGUuZGlzcGxheSA9IHVzZXJSb2xlID09PSAnYWRtaW4nID8gJycgOiAnbm9uZSc7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxud2luZG93LmNsb3NlRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXHJcbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXHJcbi8vIHNvbG8gZGVudHJvIGRlIGVzdGUgYmxvcXVlICh2ZXJpZmljYWRvIHByZS1leHRyYWNjaVx1MDBGM24pLlxyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFnQkEsU0FBTyx1QkFBdUIsV0FBWTtBQUN4QyxRQUFJLE9BQU8sU0FBUyxhQUFhO0FBQy9CLFlBQU0saUZBQWlGO0FBQ3ZGO0FBQUEsSUFDRjtBQUNBLFFBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxRQUFRO0FBQzdCLFlBQU0sZ0NBQWdDO0FBQ3RDO0FBQUEsSUFDRjtBQUNBLGdCQUFZLHFDQUFxQztBQVFqRCxVQUFNLFdBQ0osT0FBTywwQkFBMEIsYUFDN0Isc0JBQXNCLE9BQU8sa0JBQWtCLGNBQWMsZ0JBQWdCLEtBQUssSUFDbEY7QUFDTixVQUFNLFVBQVUsQ0FBQyxjQUFjO0FBQzdCLFVBQUksYUFBYSxLQUFNLFFBQU87QUFDOUIsVUFBSSxDQUFDLFVBQVcsUUFBTztBQUN2QixhQUFPLFNBQVMsSUFBSSxTQUFTO0FBQUEsSUFDL0I7QUFNQSxVQUFNLGFBQWE7QUFBQSxNQUNqQix5QkFBeUI7QUFBQSxNQUN6QixzQkFBc0I7QUFBQSxNQUN0QixnQkFBZ0I7QUFBQSxNQUNoQixpQkFBaUI7QUFBQSxJQUNuQjtBQUNBLGFBQVMsV0FBVyxXQUFXO0FBQzdCLFlBQU0sSUFBSSxPQUFPLFlBQVksY0FBYyxRQUFRLEtBQUssQ0FB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
