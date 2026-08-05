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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBkYXRvcyBjYXJnYWRvcyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIG1hc3RlcmZpbGUgZGUgY2xpZW50ZXMuLi4nKTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgJ01BUlRJTiBCT0lFUk8nOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LnpvbmUgOiAnJztcbiAgfVxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XG4gIH1cblxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxuICAvLyBlbCBtYXBhIHkgc2UgY3VlbnRhbiBlbiBlbCBzdGF0IEhBQklMSVRBRE9TLiBBbnRlcyBlbCBtYXN0ZXJmaWxlIGJhamFiYVxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxuICBjb25zdCByb3dzID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xuICAgIGNvbnN0IGxvY2FsaXR5TWFwID0gcC5uYW1lIHx8ICcnO1xuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XG4gICAgLy8gdjMzMTogZmlsdHJhciBwb3Igc2NvcGUgZGUgdmVuZG9yIGRlbCB1c3VhcmlvIHF1ZSBleHBvcnRhLlxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XG4gICAgLy8gU29sbyBjbGllbnRlcyByZWd1bGFyZXMgKG5vIHByb3NwZWN0cywgbm8gZGlzdHJpYnVpZG9yZXMpIHF1ZSBwYXNlblxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY29uc3QgayA9ICdDfCcgKyBwcm92aW5jZSArICd8JyArIGxvY2FsaXR5TWFwICsgJ3wnICsgbmFtZTtcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXG4gICAgICBpZiAodHlwZW9mIGNhbmNlbGVkICE9PSAndW5kZWZpbmVkJyAmJiBjYW5jZWxlZCAmJiBjYW5jZWxlZC5oYXMgJiYgY2FuY2VsZWQuaGFzKGspKVxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cbiAgICAgIGNvbnN0IG1ldGEgPSB0eXBlb2YgY2xpZW50TWV0YSAhPT0gJ3VuZGVmaW5lZCcgJiYgY2xpZW50TWV0YSA/IGNsaWVudE1ldGFba10gfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cbiAgICAgIGNvbnN0IGRvY0lkID1cbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xuICAgICAgY29uc3QgY21EYXRhID1cbiAgICAgICAgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBkb2NJZCA/IGNsaWVudE1hc3RlckNhY2hlLmdldChkb2NJZCkgfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XG4gICAgICBjb25zdCBjdXN0b21MYXQgPSBtZXRhLmxhdCAhPSBudWxsID8gbWV0YS5sYXQgOiAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxuICAgICAgbGV0IGNhcmRDb2RlID0gY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnO1xuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XG4gICAgICAgIGNvbnN0IGFsdGFzID0gYXBwcm92ZWRBbHRhc0J5TG9jW2tleV0gfHwgW107XG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XG4gICAgICB9XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICAnQ2FyZENvZGUgU0FQJzogY2FyZENvZGUsXG4gICAgICAgICdOb21icmUgdGllbmRhJzogbmFtZSxcbiAgICAgICAgJ0FsaWFzIChtb2RhbCknOiBjdXN0b21OYW1lLFxuICAgICAgICBUaXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICBFc3RhZG86IGVzdGFkbyxcbiAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3ZpbmNlKSA6IHByb3ZpbmNlLFxuICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvY2FsaXR5TWFwLFxuICAgICAgICBEZXBhcnRhbWVudG86IGRlcHQsXG4gICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgRGlyZWNjaW9uOiBhZGRyZXNzLFxuICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvY2FsaXR5Q3VzdCxcbiAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBjdXN0b21MYXQgfHwgbGF0LFxuICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGN1c3RvbUxuZyB8fCBsb24sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIC8vIElueWVjdGFyIGFsdGFzIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgKGFwcHJvdmVkQWx0YXNMaXN0KTpcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxuICAvLyAgICAgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS4gVmFuIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLiBTZVxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXG4gIC8vICAgICBMb3MgcHJvdmlzb3Jpb3MgcHVlZGVuIG5vIHRlbmVyIGRpcmVjY2lvbiB0b2RhdmlhIC0+IHNlIGFjZXB0YW4gaWd1YWwuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIHJvd3MuZm9yRWFjaCgocikgPT5cbiAgICBzZWVuLmFkZChcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxuICAgIClcbiAgKTtcbiAgaWYgKHR5cGVvZiBhcHByb3ZlZEFsdGFzTGlzdCAhPT0gJ3VuZGVmaW5lZCcgJiYgYXBwcm92ZWRBbHRhc0xpc3QubGVuZ3RoKSB7XG4gICAgYXBwcm92ZWRBbHRhc0xpc3QuZm9yRWFjaCgoYSkgPT4ge1xuICAgICAgaWYgKCFhKSByZXR1cm47XG4gICAgICBjb25zdCBpc1Byb3Zpc29yaW8gPSAhIWEubWFudWFsU2FwUGVuZGluZyAmJiAhYS5jYXJkQ29kZVNhcDtcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXG4gICAgICAvLyBQcm92aXNvcmlvczogc2luIGNhcmRDb2RlIG5pIGRpcmVjY2lvbiwgdmFuIGlndWFsIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLlxuICAgICAgaWYgKCFpc1Byb3Zpc29yaW8pIHtcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XG4gICAgICAgIGlmICghKGEuY2FsbGUgfHwgYS5hZGRyZXNzKSkgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IG5vbWJyZSA9XG4gICAgICAgIGEuY29tZXJjaW8gfHxcbiAgICAgICAgYS5mYW50YXNpYSB8fFxuICAgICAgICAoYS5jYXJkQ29kZVNhcCA/ICdTQVAgJyArIGEuY2FyZENvZGVTYXAuc2xpY2UoMCwgOCkgOiBhLnRpdHVsYXIgfHwgJ1Byb3Zpc29yaW8nKTtcbiAgICAgIGNvbnN0IGR1cEtleSA9IHByb3YudG9VcHBlckNhc2UoKSArICd8JyArIG5vbWJyZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHNlZW4uaGFzKGR1cEtleSkpIHJldHVybjtcbiAgICAgIHNlZW4uYWRkKGR1cEtleSk7XG4gICAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgICAgLy8gdjMzMTogbWlzbW8gZmlsdHJvIGRlIHNjb3BlIGFwbGljYSBhIGFsdGFzIFNBUC9wcm92aXNvcmlhcy5cbiAgICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xuICAgICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgICAgY29uc3QgbG9jID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnKHNpbiBsb2NhbGlkYWQpJztcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxuICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5vbWJyZSxcbiAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcbiAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICBFc3RhZG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvJyA6ICdIYWJpbGl0YWRvJyxcbiAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcbiAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXG4gICAgICAgIERlcGFydGFtZW50bzogJycsXG4gICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcbiAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2MsXG4gICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXG4gICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXG4gIHJvd3Muc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKGFbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xuICB9KTtcblxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXG4gICAgICAgICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJyArXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTYgfSwgLy8gQ2FyZENvZGUgU0FQXG4gICAgeyB3Y2g6IDM4IH0sIC8vIE5vbWJyZSB0aWVuZGFcbiAgICB7IHdjaDogMjggfSwgLy8gQWxpYXNcbiAgICB7IHdjaDogMTQgfSwgLy8gVGlwb1xuICAgIHsgd2NoOiAxNCB9LCAvLyBFc3RhZG9cbiAgICB7IHdjaDogMjIgfSwgLy8gUHJvdmluY2lhXG4gICAgeyB3Y2g6IDIyIH0sIC8vIExvY2FsaWRhZCBtYXBhXG4gICAgeyB3Y2g6IDIyIH0sIC8vIERlcGFydGFtZW50b1xuICAgIHsgd2NoOiAyOCB9LCAvLyBWZW5kZWRvciBleHRlcm5vXG4gICAgeyB3Y2g6IDggfSwgLy8gWm9uYVxuICAgIHsgd2NoOiA0OCB9LCAvLyBFdGlxdWV0YSB6b25hXG4gICAgeyB3Y2g6IDI4IH0sIC8vIEFzZXNvciBpbnRlcm5vXG4gICAgeyB3Y2g6IDM4IH0sIC8vIERpcmVjY2lvblxuICAgIHsgd2NoOiAyNCB9LCAvLyBMb2NhbGlkYWQgZGVjbGFyYWRhXG4gICAgeyB3Y2g6IDE0IH0sIC8vIExhdFxuICAgIHsgd2NoOiAxNCB9LCAvLyBMbmdcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdDbGllbnRlcyBoYWJpbGl0YWRvcyBTQVAnKTtcblxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHpvbmFcbiAgY29uc3QgYnlab25lID0ge307XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGNvbnN0IHogPSByWydFdGlxdWV0YSB6b25hJ10gfHwgJ1NpbiB6b25hJztcbiAgICBpZiAoIWJ5Wm9uZVt6XSkgYnlab25lW3pdID0geyB0b3RhbDogMCwgaGFiaWxpdGFkb3M6IDAsIGNhbmNlbGFkb3M6IDAgfTtcbiAgICBieVpvbmVbel0udG90YWwrKztcbiAgICBpZiAoci5Fc3RhZG8gPT09ICdIYWJpbGl0YWRvJykgYnlab25lW3pdLmhhYmlsaXRhZG9zKys7XG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xuICB9KTtcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBPYmplY3QuZW50cmllcyhieVpvbmUpXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xuICAgICAgJ1pvbmEgLyBWZW5kZWRvcic6IHosXG4gICAgICAnVG90YWwgdGllbmRhcyc6IGQudG90YWwsXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcbiAgICAgIENhbmNlbGFkYXM6IGQuY2FuY2VsYWRvcyxcbiAgICB9KSlcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVG90YWwgdGllbmRhcyddIC0gYVsnVG90YWwgdGllbmRhcyddKTtcbiAgY29uc3Qgd3NSZXMgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocmVzdW1lblJvd3MpO1xuICB3c1Jlc1snIWNvbHMnXSA9IFt7IHdjaDogNDggfSwgeyB3Y2g6IDE0IH0sIHsgd2NoOiAxNCB9LCB7IHdjaDogMTQgfV07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUmVzLCAnUmVzdW1lbiBwb3Igem9uYScpO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxuICBjb25zdCBzY29wZUxibCA9XG4gICAgc2NvcGVTZXQgPT09IG51bGxcbiAgICAgID8gJ1RPRE9TJ1xuICAgICAgOiBzY29wZVNldC5zaXplID09PSAxXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcbiAgY29uc3QgZm5hbWUgPSAnTWFzdGVyZmlsZV9DbGllbnRlc19TQVBfJyArIHNjb3BlTGJsICsgJ18nICsgdHMgKyAnLnhsc3gnO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgZm5hbWUpO1xuICBzaG93U3luY1RhZyhcbiAgICByb3dzLmxlbmd0aCArXG4gICAgICAnIGNsaWVudGVzIGV4cG9ydGFkb3MnICtcbiAgICAgIChzY29wZVNldCA9PT0gbnVsbCA/ICcnIDogJyAoc2NvcGU6ICcgKyBbLi4uc2NvcGVTZXRdLmpvaW4oJywgJykgKyAnKScpXG4gICk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4cG9ydDogUHJlY2lvcyArIFN0b2NrIHBvciBTS1Vcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RPIGVsIGNhdGFsb2dvIGNydXphbmRvIGxvcyAzIG1hcGFzIHZpZ2VudGVzXG4vLyBlbiBtZW1vcmlhOiBQUk9EVUNUUyAobWFzdGVyIGRlIFNLVXMpLCBQUklDRV9MSVNUX01BUCAocHJlY2lvIEFSUyBkZVxuLy8gRmlyZXN0b3JlKSB5IFNUT0NLX01BUCAoYm9vbGVhbm8gcG9yIFNLVSBkZWwgc3RvY2suanNvbiBkZWwgcmVwbykuXG4vLyBIb2phczpcbi8vICAtIFwiUHJlY2lvcyB5IFN0b2NrXCI6IHVuYSBmaWxhIHBvciBTS1UgY29uIHRvZGFzIGxhcyBjb2x1bW5hcyBqdW50YXNcbi8vICAgIChsbyBtYXMgY29tdW4gcGFyYSByZXZpc2FyIGRpc3BvbmliaWxpZGFkICsgcHJlY2lvKS5cbi8vICAtIFwiUHJlY2lvc1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgcHJlY2lvIChzaW4gc3RvY2spLlxuLy8gIC0gXCJTdG9ja1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgZXN0YWRvIGRlIHN0b2NrLlxuLy8gIC0gXCJJbmZvXCI6IGZlY2hhIGRlIGxvcyBzbmFwc2hvdHMgeSBmdWVudGVzLlxud2luZG93LmV4cG9ydFByZWNpb3NTdG9jayA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghQXJyYXkuaXNBcnJheShQUk9EVUNUUykgfHwgIVBST0RVQ1RTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgY2F0YWxvZ28gZGUgcHJvZHVjdG9zIGNhcmdhZG8gdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBwcmVjaW9zICsgc3RvY2suLi4nKTtcbiAgLy8gSGVscGVyIGRlIGZvcm1hdG8gZGUgc3RvY2sgcGFyYSBxdWUgc2VhIGxlZ2libGUgZW4gRXhjZWwuXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgaGFzU3RvY2sgPT09ICdmdW5jdGlvbicgPyBoYXNTdG9jayhza3UpIDogbnVsbDtcbiAgICBpZiAodiA9PT0gdHJ1ZSkgcmV0dXJuICdEaXNwb25pYmxlJztcbiAgICBpZiAodiA9PT0gZmFsc2UpIHJldHVybiAnU2luIHN0b2NrJztcbiAgICByZXR1cm4gJ1NpbiBkYXRvJztcbiAgfVxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xuICB9XG4gIC8vIEhvamEgMTogY29tYm8gY29tcGxldG8gKGVzIGxhIG1hcyBwZWRpZGEpLlxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXG4gICAgU3ViZmFtaWxpYTogcC5zdWIgfHwgJycsXG4gICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICAgICdTdG9jayBXMTEnOiBmbXRTdG9jayhwLmNvZGUpLFxuICB9KSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDYwIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gIF07XG4gIC8vIEFwbGljYXIgZm9ybWF0byBtb25lZGEgYSBsYSBjb2x1bW5hIFByZWNpbyBBUlMgKGNvbHVtbmEgRiA9IDYpLlxuICBmb3IgKGxldCBpID0gMjsgaSA8PSByb3dzLmxlbmd0aCArIDE7IGkrKykge1xuICAgIGNvbnN0IGNlbGwgPSB3c1snRicgKyBpXTtcbiAgICBpZiAoY2VsbCAmJiB0eXBlb2YgY2VsbC52ID09PSAnbnVtYmVyJykgY2VsbC56ID0gJ1wiJFwiIywjIzAnO1xuICB9XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnUHJlY2lvcyB5IFN0b2NrJyk7XG5cbiAgLy8gSG9qYSAyOiBzb2xvIFByZWNpb3NcbiAgY29uc3QgcHJlY2lvc1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICB9KSlcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxuICAgIC5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3Qgd3NQID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHByZWNpb3NSb3dzKTtcbiAgd3NQWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xuICBmb3IgKGxldCBpID0gMjsgaSA8PSBwcmVjaW9zUm93cy5sZW5ndGggKyAxOyBpKyspIHtcbiAgICBjb25zdCBjZWxsID0gd3NQWydDJyArIGldO1xuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XG4gIH1cbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NQLCAnUHJlY2lvcycpO1xuXG4gIC8vIEhvamEgMzogc29sbyBTdG9ja1xuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcbiAgfSkpLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCB3c1MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoc3RvY2tSb3dzKTtcbiAgd3NTWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1MsICdTdG9jaycpO1xuXG4gIC8vIEhvamEgNDogbWV0YWRhdGEgLSBjdWFuZG8gZnVlIGNhZGEgc25hcHNob3QgcGFyYSBxdWUgZWwgbGVjdG9yIHNlcGFcbiAgLy8gc2kgbGEgbGlzdGEgZXN0YSBmcmVzY2EuXG4gIGNvbnN0IGluZm9Sb3dzID0gW1xuICAgIHsgSXRlbTogJ1RvdGFsIFNLVXMgZW4gY2F0YWxvZ28nLCBWYWxvcjogUFJPRFVDVFMubGVuZ3RoIH0sXG4gICAgeyBJdGVtOiAnVG90YWwgU0tVcyBjb24gcHJlY2lvIGNhcmdhZG8nLCBWYWxvcjogcHJlY2lvc1Jvd3MubGVuZ3RoIH0sXG4gICAge1xuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgY29uIHN0b2NrIGRpc3BvbmlibGUnLFxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gdHJ1ZSkubGVuZ3RoLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIHN0b2NrJyxcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT09IGZhbHNlKS5sZW5ndGgsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gZGF0byBkZSBzdG9jaycsXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09IG51bGwpLmxlbmd0aCxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdMaXN0YSBkZSBwcmVjaW9zIG1vbmVkYScsXG4gICAgICBWYWxvcjogdHlwZW9mIFBSSUNFX0xJU1RfQ1VSUkVOQ1kgIT09ICd1bmRlZmluZWQnID8gUFJJQ0VfTElTVF9DVVJSRU5DWSA6ICdBUlMnLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgYWN0dWFsaXphZGEnLFxuICAgICAgVmFsb3I6XG4gICAgICAgIHR5cGVvZiBQUklDRV9MSVNUX1VQREFURURfQVQgIT09ICd1bmRlZmluZWQnICYmIFBSSUNFX0xJU1RfVVBEQVRFRF9BVFxuICAgICAgICAgID8gbmV3IERhdGUoUFJJQ0VfTElTVF9VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKVxuICAgICAgICAgIDogJyhubyBjYXJnYWRhKScsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnU3RvY2sgc25hcHNob3QgYWN0dWFsaXphZG8nLFxuICAgICAgVmFsb3I6IFNUT0NLX1VQREFURURfQVQgPyBuZXcgRGF0ZShTVE9DS19VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcobm8gY2FyZ2FkbyknLFxuICAgIH0sXG4gICAgeyBJdGVtOiAnRXhwb3J0YWRvJywgVmFsb3I6IG5ldyBEYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnRXhwb3J0YWRvIHBvcicsXG4gICAgICBWYWxvcjogKGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSkpIHx8ICcoZGVzY29ub2NpZG8pJyxcbiAgICB9LFxuICBdO1xuICBjb25zdCB3c0kgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoaW5mb1Jvd3MpO1xuICB3c0lbJyFjb2xzJ10gPSBbeyB3Y2g6IDM2IH0sIHsgd2NoOiAzNiB9XTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NJLCAnSW5mbycpO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdQcmVjaW9zX3lfU3RvY2tfJyArIHRzICsgJy54bHN4Jyk7XG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKHByZWNpb3MgKyBzdG9jayknKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIC0gZGlhbG9nbyBkZSBzZWxlY2Npb24gKyAzIGZvcm1hdG9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBvcGNpb25lcyBzZWd1biByb2wuXG4gIC8vICAgdmVuZGVkb3I6IG9wZXJhdGl2byBkaWFyaW8gKFZlbnRhcyAvIFZpc2l0YXMgLyBSdXRhcykgKyBDbGllbnRlcyBkZSBzdSB6b25hXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxuICAvLyAgIGludGVybm8gKFZESSk6IG1pc21vIHNjb3BlIG9wZXJhdGl2byArIENsaWVudGVzIGRlIHN1cyBwYXJlamFzIChvIHNvbG8gZWxcbiAgLy8gICAgIHByb3BpbyBzaSBlbGlnaW8gc3Ugbm9tYnJlIGVuIGVsIGRyb3Bkb3duIGRlIHpvbmFzKS5cbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cbiAgY29uc3QgYWxsb3dlZEJ5Um9sZSA9IHtcbiAgICB2ZW5kZWRvcjogbmV3IFNldChbJ1ZFTlRBUycsICdWSVNJVEFTJywgJ1JVVEFTJywgJ01BU1RFUiddKSxcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVkVOVEFTJywgJ1ZJU0lUQVMnLCAnUlVUQVMnLCAnTUFTVEVSJ10pLFxuICB9O1xuICBjb25zdCBhbGxvd2VkID0gYWxsb3dlZEJ5Um9sZVt1c2VyUm9sZV0gfHwgbnVsbDsgLy8gbnVsbCA9IHZlciB0b2RvXG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNleHBvcnQtbW9kYWwgLmV4cC1vcHQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgIGNvbnN0IGtpbmQgPSBlbC5kYXRhc2V0LmV4cEtpbmQgfHwgJyc7XG4gICAgZWwuc3R5bGUuZGlzcGxheSA9ICFhbGxvd2VkIHx8IGFsbG93ZWQuaGFzKGtpbmQpID8gJycgOiAnbm9uZSc7XG4gIH0pO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTW9udGggcGlja2VyIHJldXRpbGl6YWJsZSBwYXJhIGxvcyA1IHRpcG9zIGRlIGV4cG9ydFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuY29uc3QgRVhQT1JUX1RZUEVfTEFCRUxTID0ge1xuICBWRU5UQVM6ICdWZW50YXMnLFxuICBWSVNJVEFTOiAnVmlzaXRhcycsXG4gIFJFTkRJQ0lPTkVTOiAnUmVuZGljaW9uZXMnLFxuICBSVVRBUzogJ1J1dGFzJyxcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXG59O1xuXG53aW5kb3cuc2hvd01vbnRoUGlja2VyID0gZnVuY3Rpb24gKHRpcG8pIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gdGlwbztcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tdGl0bGUnKTtcbiAgY29uc3Qgc3VidCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1zdWJ0Jyk7XG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0V4cG9ydGFyICcgKyAoRVhQT1JUX1RZUEVfTEFCRUxTW3RpcG9dIHx8IHRpcG8pO1xuICBzdWJ0LnRleHRDb250ZW50ID0gJ0VsZWdpIGVsIG1lcyB5IGFcdTAwRjFvIHF1ZSBxdWVyZXMgZGVzY2FyZ2FyLic7XG4gIC8vIFBvcHVsYXRlIHNlbGVjdHNcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgbWVzU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpO1xuICBtZXNTZWwuaW5uZXJIVE1MID1cbiAgICAnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zIGxvcyBtZXNlcyAoYVx1MDBGMW8gZW50ZXJvKTwvb3B0aW9uPicgK1xuICAgIE1FU0VTLm1hcCgobSwgaSkgPT4gJzxvcHRpb24gdmFsdWU9XCInICsgaSArICdcIj4nICsgbSArICc8L29wdGlvbj4nKS5qb2luKCcnKTtcbiAgbWVzU2VsLnZhbHVlID0gbm93LmdldE1vbnRoKCk7XG4gIGNvbnN0IGFuaW9TZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpO1xuICBjb25zdCB5ZWFyID0gbm93LmdldEZ1bGxZZWFyKCk7XG4gIGxldCB5b3B0cyA9ICcnO1xuICBmb3IgKGxldCB5ID0geWVhciAtIDM7IHkgPD0geWVhciArIDE7IHkrKylcbiAgICB5b3B0cyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyB5ICsgJ1wiPicgKyB5ICsgJzwvb3B0aW9uPic7XG4gIGFuaW9TZWwuaW5uZXJIVE1MID0geW9wdHM7XG4gIGFuaW9TZWwudmFsdWUgPSB5ZWFyO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcblxud2luZG93LmNsb3NlTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbn07XG5cbndpbmRvdy5jb25maXJtTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHRpcG8gPSBwZW5kaW5nRXhwb3J0VHlwZTtcbiAgY29uc3QgbWVzUmF3ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpLnZhbHVlO1xuICBjb25zdCBhbmlvID0gcGFyc2VJbnQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKS52YWx1ZSwgMTApO1xuICBjb25zdCBtb250aElkeCA9IG1lc1JhdyA9PT0gJ0FMTCcgPyBudWxsIDogcGFyc2VJbnQobWVzUmF3LCAxMCk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbiAgaWYgKCF0aXBvKSByZXR1cm47XG4gIHRyeSB7XG4gICAgaWYgKHRpcG8gPT09ICdWRU5UQVMnKSBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZJU0lUQVMnKSBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSRU5ESUNJT05FUycpIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSVVRBUycpIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdBTFRBUycpIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgYWxlcnQoJ1RpcG8gZGVzY29ub2NpZG86ICcgKyB0aXBvKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydCAnICsgdGlwbywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBleHBvcnQ6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHJldHVybiBTdHJpbmcoYW5pbyk7XG4gIHJldHVybiBNRVNFU1ttb250aElkeF0gKyAnXycgKyBhbmlvO1xufVxuXG5mdW5jdGlvbiBkb3dubG9hZFhsc3goZmlsZW5hbWUsIHNoZWV0cykge1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgZm9yIChjb25zdCBzIG9mIHNoZWV0cykge1xuICAgIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxuICAgICAgcy5yb3dzLmxlbmd0aCA/IHMucm93cyA6IFt7IEF2aXNvOiAnU2luIGRhdG9zIHBhcmEgZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8nIH1dXG4gICAgKTtcbiAgICBpZiAocy5yb3dzLmxlbmd0aCkge1xuICAgICAgY29uc3QgY29scyA9IE9iamVjdC5rZXlzKHMucm93c1swXSkubWFwKChrKSA9PiAoe1xuICAgICAgICB3Y2g6IE1hdGgubWluKDQwLCBNYXRoLm1heCgxMCwgay5sZW5ndGggKyA0KSksXG4gICAgICB9KSk7XG4gICAgICB3c1snIWNvbHMnXSA9IGNvbHM7XG4gICAgfVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCBzLm5hbWUuc2xpY2UoMCwgMzEpKTtcbiAgfVxuICBYTFNYLndyaXRlRmlsZSh3YiwgZmlsZW5hbWUpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZFTlRBUzogcGVkaWRvcyBjb25maXJtYWRvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWZW50YXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcGVkaWRvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHAgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAocGFyc2VJbnQocC55ZWFyLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQocC5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIGNvbnN0IGxpbmVzID0gcC5saW5lcyB8fCBbXTtcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgcmV0dXJuO1xuICAgIGNvbnN0IHZlbmRvcktleSA9IHAudmVuZG9yIHx8IGxvb2t1cFZlbmRvckZvckNsaWVudChwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSkgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9ySW5mbyA9IHZlbmRvckxvb2t1cFt2ZW5kb3JLZXldIHx8IHt9O1xuICAgIGNvbnN0IGZhY3RvciA9IHR5cGVvZiBwZWRpZG9EaXNjb3VudEZhY3RvciA9PT0gJ2Z1bmN0aW9uJyA/IHBlZGlkb0Rpc2NvdW50RmFjdG9yKHApIDogMTtcbiAgICBjb25zdCBkaXNjUGN0ID0gKHAuZGlzY291bnRTbmFwc2hvdCAmJiBwLmRpc2NvdW50U25hcHNob3QucGN0VG90YWwpIHx8IDA7XG4gICAgbGluZXMuZm9yRWFjaCgobCkgPT4ge1xuICAgICAgY29uc3QgcXR5ID0gcGFyc2VGbG9hdChsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IHBhcnNlRmxvYXQobC5wcmVjaW8pIHx8IDA7XG4gICAgICBjb25zdCBncm9zcyA9IHF0eSAqIHByZWNpbztcbiAgICAgIGNvbnN0IG5ldCA9IGdyb3NzICogZmFjdG9yO1xuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxuICAgICAgICBGZWNoYV9Db25maXJtYWRvOiBwLmNvbmZpcm1lZEF0ID8gU3RyaW5nKHAuY29uZmlybWVkQXQpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgICBFc3RhZG86IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yS2V5IHx8ICcnKSxcbiAgICAgICAgWm9uYTogdmVuZG9ySW5mby56b25lIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQ29kaWdvX1NLVTogbC5jb2RlIHx8ICcnLFxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8ICcnLFxuICAgICAgICBDYXRlZ29yaWE6IGwuY2F0IHx8ICcnLFxuICAgICAgICBGYW1pbGlhOiBsLmZhbSB8fCAnJyxcbiAgICAgICAgU3ViZmFtaWxpYTogbC5zdWIgfHwgJycsXG4gICAgICAgIENhbnRpZGFkOiBxdHksXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxuICAgICAgICAvLyBTdWJ0b3RhbF9BUlMgPSBORVRPIChjb24gZGVzY3VlbnRvIGFwbGljYWRvKSAtIGVzIGxvIHF1ZSBjdWVudGFcbiAgICAgICAgLy8gcGFyYSBlbCB0YXJnZXQgZGVsIHZlbmRlZG9yLiBTdWJ0b3RhbF9CcnV0b19BUlMgbXVlc3RyYSBlbCB2YWxvclxuICAgICAgICAvLyBkZSBsaXN0YSBzaW4gZGVzY3VlbnRvIHBhcmEgdHJhemFiaWxpZGFkLlxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQobmV0KSxcbiAgICAgICAgU3VidG90YWxfQnJ1dG9fQVJTOiBNYXRoLnJvdW5kKGdyb3NzKSxcbiAgICAgICAgRGVzY3VlbnRvX1BjdDogZGlzY1BjdCxcbiAgICAgICAgRW5fTm9tYnJlX0RlX1ZERTogcC5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICAgIENhcmdhZG9fUG9yOiBwLmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHAuY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fVmVudGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdWZW50YXMnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBWZW50YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5mdW5jdGlvbiBsb29rdXBWZW5kb3JGb3JDbGllbnQocHJvdiwgbG9jTmFtZSwgX2NsaWVudE5hbWUpIHtcbiAgaWYgKCFwcm92IHx8ICFsb2NOYW1lKSByZXR1cm4gJyc7XG4gIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3YgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcbiAgcmV0dXJuIHB0ID8gcHQudmVuZG9yIHx8ICcnIDogJyc7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVklTSVRBUzogZGV0YWxsZSBkZSB2aXNpdGFzIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWaXNpdGFzICsgQ29udGFjdG9zLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gdmlzaXRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YXJnZXRNZXMgPSBtb250aElkeCAhPT0gbnVsbCA/IE1FU0VTW21vbnRoSWR4XS50b1VwcGVyQ2FzZSgpIDogbnVsbDtcbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgdiA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludCh2LmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmICh0YXJnZXRNZXMgJiYgKHYubWVzIHx8ICcnKS50b1VwcGVyQ2FzZSgpICE9PSB0YXJnZXRNZXMpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHYpO1xuICB9KTtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgbmkgY29udGFjdG9zIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuVmlzaXRhcyA9IGl0ZW1zLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aDtcbiAgY29uc3QgbkNvbnRhY3RvcyA9IGl0ZW1zLmxlbmd0aCAtIG5WaXNpdGFzO1xuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGRlbCBmcmVudGUgZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBMYXp5IGxvYWQuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbDogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3Rvcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzIHkgQ29udGFjdG9zJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNZXMnLCBrZXk6ICdtZXMnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0FuaW8nLCBrZXk6ICdhbmlvJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0ludGVyYWNjaW9uJywga2V5OiAnaW50ZXJhY2Npb24nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0Zvcm1hIENvbnRhY3RvJywga2V5OiAnZm9ybWFDb250YWN0bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnUmVzdWx0YWRvIENvbnRhY3RvJywga2V5OiAncmVzdWx0YWRvQ3QnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0NvbWVudGFyaW8nLCBrZXk6ICdjb21lbnQnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdUaWVuZGEnLCBrZXk6ICd0aWVuZGEnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUYW1hbm8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnTmVjZXNpZGFkIFB1bnR1YWwnLCBrZXk6ICduZWMnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdNYXMgVmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdNYXMgUHJlZ3VudGFuJywga2V5OiAnbWFzUHInLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0F5dWRhIFRpZW5kYScsIGtleTogJ2F5dWRhJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIFZlbnRhJywga2V5OiAndGlwb1ZlbnRhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdQb25kIE1vc3RyYWRvcicsIGtleTogJ3BNb3N0Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQb25kIEVjb21tZXJjZScsIGtleTogJ3BFY29tJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdDb21wZXRlbmNpYScsIGtleTogJ2NvbXBlJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgU3RhdHVzJywga2V5OiAnZ3BzU3QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBEaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gZnJlbnRlJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnRW4gbm9tYnJlIGRlIFZERScsIGtleTogJ29uQmVoYWxmJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdDYXJnYWRvIFBvcicsIGtleTogJ2NyZWF0ZWRCeScsIHdpZHRoOiAyNCB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7XG4gIGNvbnN0IFJPV19IID0gMTAwO1xuICBjb25zdCBJTUdfVyA9IDEzMDtcbiAgY29uc3QgSU1HX0ggPSA5MDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IHYgb2YgaXRlbXMpIHtcbiAgICBjb25zdCBpc0NvbnRhY3RvID0gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0byc7XG4gICAgY29uc3QgaW50ZXJhY2Npb25MYmwgPSBpc0NvbnRhY3RvID8gJ0NvbnRhY3RvJyA6ICdWaXNpdGEnO1xuICAgIGNvbnN0IGZvcm1hQ29udGFjdG9MYmwgPSBpc0NvbnRhY3RvID8gdi5mb3JtYUNvbnRhY3RvIHx8ICdTaW4gZXNwZWNpZmljYXInIDogJ1ByZXNlbmNpYWwnO1xuICAgIGxldCByZXN1bHRhZG9DdExibCA9ICcnO1xuICAgIGlmIChpc0NvbnRhY3RvKSB7XG4gICAgICBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ1Jlc3BvbmRpbyc7XG4gICAgICBlbHNlIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAnbm9fcmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnTm8gcmVzcG9uZGlvJztcbiAgICAgIGVsc2UgcmVzdWx0YWRvQ3RMYmwgPSAnU2luIG1hcmNhcic7XG4gICAgfVxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXG4gICAgICBhbmlvOiB2LmFuaW8gfHwgJycsXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXG4gICAgICBpbnRlcmFjY2lvbjogaW50ZXJhY2Npb25MYmwsXG4gICAgICBmb3JtYUNvbnRhY3RvOiBmb3JtYUNvbnRhY3RvTGJsLFxuICAgICAgcmVzdWx0YWRvQ3Q6IHJlc3VsdGFkb0N0TGJsLFxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcbiAgICAgIG5lYzogdi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxuICAgICAgb3BvcnR1OiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgbWFzVmU6IHYubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgIG1hc1ByOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgIGF5dWRhOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgICBwTW9zdDogdi5wb25kZXJhY2lvbk1vc3RyYWRvIHx8ICcnLFxuICAgICAgcEVjb206IHYucG9uZGVyYWNpb25FY29tbWVyY2UgfHwgJycsXG4gICAgICBjb21wZTogdi5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIGdwc1N0OiB2Lmdwc1N0YXR1cyB8fCAnJyxcbiAgICAgIGdwc0Rpc3Q6IHYuZ3BzRGlzdGFuY2VNICE9IG51bGwgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gaW1hZ2VuIGVuY2ltYVxuICAgICAgb25CZWhhbGY6IHYub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxuICAgICAgY3JlYXRlZEJ5OiB2LmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHYuY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgfSk7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHZpc2l0YScsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19WaXNpdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgbGlzdG86ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MnLCAyNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0YXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFTkRJQ0lPTkVTOiBnYXN0b3MgeSBhbnRpY2lwb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSZW5kaWNpb25lcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcmVuZGljaW9uZXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBwb3IgbWVzL2FuaW9cbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgciA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9IHIuZmVjaGEgfHwgci5mZWNoYUdhc3RvIHx8ICcnO1xuICAgIGlmICghZHQgJiYgci5jcmVhdGVkQXQgJiYgci5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IHIuY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBjb25zdCBkT2JqID0gbmV3IERhdGUoZHQpO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oZE9iai5nZXRUaW1lKCkpKSByZXR1cm47XG4gICAgaWYgKGRPYmouZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkT2JqLmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgaXRlbXMucHVzaCh7IGlkOiBkLmlkLCBmZWNoYTogZHQsIHI6IHIgfSk7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVuZGljaW9uZXMgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBDYXJnYSBsYXp5LlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBpdGVtcy5sZW5ndGggKyAnIHJlbmRpY2lvbmVzLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1JlbmRpY2lvbmVzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyNiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQ29uY2VwdG8nLCBrZXk6ICdjb25jZXB0bycsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnTiBUaWNrZXQnLCBrZXk6ICdudW1UaWNrZXQnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ01vZG8gcGFnbycsIGtleTogJ21vZG9QYWdvJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIGdhc3RvJywga2V5OiAndGlwb0dhc3RvJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdEaXZpc2lvbicsIGtleTogJ2RpdmlzaW9uJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlJywga2V5OiAnaW1wb3J0ZScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTW9uZWRhJywga2V5OiAnbW9uZWRhJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlIFVTRCcsIGtleTogJ2ltcG9ydGVVc2QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ09ic2VydmFjaW9uZXMnLCBrZXk6ICdvYnMnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gdGlja2V0Jywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnRXN0YWRvJywga2V5OiAnZXN0YWRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkb3InLCBrZXk6ICdhcHJvYmFkb3InLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvIGVuJywga2V5OiAnYXByb2JhZG9FbicsIHdpZHRoOiAxNCB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGN0UyMkNFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXG4gIGNvbnN0IFJPV19IID0gMTEwO1xuICBjb25zdCBJTUdfVyA9IDE0MDtcbiAgY29uc3QgSU1HX0ggPSAxMDA7XG5cbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykge1xuICAgIGNvbnN0IHIgPSBpdC5yO1xuICAgIGNvbnN0IGlzR2FzdG8gPSByLnRpcG8gPT09ICdnYXN0byc7XG4gICAgY29uc3QgY29uY2VwdFN0ciA9IGlzR2FzdG8gPyByLmRlc2NyaXBjaW9uIHx8ICcnIDogci50aXBvT3BlcmFjaW9uIHx8IHIubW90aXZvIHx8ICcnO1xuICAgIGNvbnN0IG9ic1N0ciA9XG4gICAgICAoci5vYnNlcnZhY2lvbmVzIHx8IHIubm90YXMgfHwgJycpICtcbiAgICAgIChpc0dhc3RvID8gJycgOiByLnNvbGljaXRhZG9Qb3IgPyAnIHwgU29saWNpdGFkbyBwb3I6ICcgKyByLnNvbGljaXRhZG9Qb3IgOiAnJyk7XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiBpdC5mZWNoYSxcbiAgICAgIHRpcG86IHIudGlwbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiByLm93bmVyTmFtZSB8fCByLnZlbmRvck5hbWUgfHwgci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgZW1haWw6IHIub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGNvbmNlcHRvOiBjb25jZXB0U3RyLFxuICAgICAgbnVtVGlja2V0OiByLm51bWVyb1RpY2tldCB8fCAnJyxcbiAgICAgIG1vZG9QYWdvOiByLm1vZG9QYWdvIHx8ICcnLFxuICAgICAgdGlwb0dhc3RvOiByLnRpcG9HYXN0byB8fCAnJyxcbiAgICAgIGRpdmlzaW9uOiByLmRpdmlzaW9uR2FzdG8gfHwgJycsXG4gICAgICBpbXBvcnRlOiByLmltcG9ydGUgIT0gbnVsbCA/IHIuaW1wb3J0ZSA6ICcnLFxuICAgICAgbW9uZWRhOiByLm1vbmVkYSB8fCAnUEVTT1MnLFxuICAgICAgaW1wb3J0ZVVzZDogci5pbXBvcnRlVXNkICE9IG51bGwgJiYgci5pbXBvcnRlVXNkICE9PSAwID8gci5pbXBvcnRlVXNkIDogJycsXG4gICAgICBvYnM6IG9ic1N0cixcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGVuY2ltYSB2YSBsYSBpbWFnZW5cbiAgICAgIGVzdGFkbzogci5zdGF0dXMgfHwgci5lc3RhZG8gfHwgJycsXG4gICAgICBhcHJvYmFkb3I6IHIuYXBwcm92ZXJFbWFpbCB8fCByLmFwcm9iYWRvciB8fCAnJyxcbiAgICAgIGFwcm9iYWRvRW46XG4gICAgICAgIHIuYXBwcm92ZWRBdCAmJiByLmFwcHJvdmVkQXQudG9EYXRlID8gci5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgfSk7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAvLyBFbWJlYmVyIGZvdG8gZGVsIHRpY2tldCBzaSBleGlzdGUuIHYzMDgrOiBwcmVmZXJpciBiYXNlNjQgZW1iZWJpZG9cbiAgICAvLyAoZm90b1RpY2tldCAvIGFkanVudG8pIHBvciBjb21wYXQsIHNpbm8gdXNhciBmb3RvVGlja2V0VXJsIGNvbW8gSFlQRVJMSU5LLlxuICAgIC8vIEEgbml2ZWwgRXhjZWwgdW4gZGF0YVVSTCBiYXNlNjQgc2UgcHVlZGUgaW5zZXJ0YXIgY29tbyBpbWFnZW4gaW5saW5lLFxuICAgIC8vIG1pZW50cmFzIHF1ZSB1bmEgVVJMIGRlIFN0b3JhZ2Ugc2UgYWdyZWdhIGNvbW8gbGluayBjbGlja2VhYmxlIChlbFxuICAgIC8vIHVzdWFyaW8gYWJyZSBlbiBlbCBicm93c2VyIHNpbiBuZWNlc2lkYWQgZGUgcXVlIEV4Y2VsIGRlc2Nhcmd1ZSkuXG4gICAgY29uc3QgZm90b1NyYyA9IHIuZm90b1RpY2tldCB8fCByLmFkanVudG8gfHwgJyc7XG4gICAgaWYgKGZvdG9TcmMgJiYgdHlwZW9mIGZvdG9TcmMgPT09ICdzdHJpbmcnICYmIGZvdG9TcmMuc3RhcnRzV2l0aCgnZGF0YTppbWFnZS8nKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IGZvdG9TcmM7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gcmVuZGljaW9uJywgaXQuaWQsIGUpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoci5mb3RvVGlja2V0VXJsICYmIHR5cGVvZiByLmZvdG9UaWNrZXRVcmwgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyBEb2NzIG51ZXZvcyAodjMwOCspOiBmb3RvIGVuIFN0b3JhZ2UsIGluc2VydGFtb3MgY29tbyBoeXBlcmxpbmsuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XG4gICAgICAgIGNlbGwudmFsdWUgPSB7XG4gICAgICAgICAgdGV4dDogJ0FicmlyIHRpY2tldCcsXG4gICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXG4gICAgICAgICAgdG9vbHRpcDogJ0FicmlyIGxhIGZvdG8gZGVsIHRpY2tldCBlbiBlbCBicm93c2VyJyxcbiAgICAgICAgfTtcbiAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkYwNTYzQzEnIH0sIHVuZGVybGluZTogdHJ1ZSB9O1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2h5cGVybGluayBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUlVUQVM6IHJ1dGFzIGFzaWduYWRhcyBkZWwgcGVyaW9kbyArIG92ZXJyaWRlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPVxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXG4gICAgICA6IGFzc2lnbmVkVmVuZG9yXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxuICAgICAgICA6IFtdO1xuICBjb25zdCBtb250aHNUb0V4cG9ydCA9IG1vbnRoSWR4ICE9PSBudWxsID8gW21vbnRoSWR4XSA6IFswLCAxLCAyLCAzLCA0LCA1LCA2LCA3LCA4LCA5LCAxMCwgMTFdO1xuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2YgbW9udGhzVG9FeHBvcnQpIHtcbiAgICAgIGxldCBydXRhcztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgcnV0YXMgPSBbXTtcbiAgICAgIH1cbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPdmVycmlkZXNcbiAgbGV0IG92clNuYXA7XG4gIHRyeSB7XG4gICAgb3ZyU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm91dGVfb3ZlcnJpZGVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgb3ZyU25hcCA9IG51bGw7XG4gIH1cbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xuICBpZiAob3ZyU25hcCkge1xuICAgIG92clNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxuICAgICAgICBNZXM6IE1FU0VTW3BhcnNlSW50KG8ubW9udGhJZHgsIDEwKV0gfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBvLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcbiAgICAgICAgRGVyaXZhZGFfQTogby5kZXJpdmFkYUEgfHwgJycsXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX1Bvcjogby5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX0VuOlxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1J1dGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcbiAgICB7IG5hbWU6ICdEZXJpdmFjaW9uZXMtUmVhZ2VuZGFzJywgcm93czogb3ZlcnJpZGVzUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBSdXRhcyBsaXN0byAoJyArIHJ1dGFzUm93cy5sZW5ndGggKyAnIHRpZW5kYXMsICcgKyBvdmVycmlkZXNSb3dzLmxlbmd0aCArICcgb3ZlcnJpZGVzKScsXG4gICAgMjQwMFxuICApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFMVEFTOiBzb2xpY2l0dWRlcyBkZSBhbHRhIGRlIGNsaWVudGUgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSAnJztcbiAgICBpZiAoYS5jcmVhdGVkQXQgJiYgYS5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXG4gICAgICBBcHJvYmFkb19FbjpcbiAgICAgICAgYS5hcHByb3ZlZEF0ICYmIGEuYXBwcm92ZWRBdC50b0RhdGUgPyBhLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEFsdGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIHNvbGljaXR1ZGVzKScsIDI0MDApO1xufVxuXG4vLyBFeHBvcnRhciBwYXJhIEFuYWxpc2lzOiBwcm90ZWdpZG8gY29uIFBJTlxuY29uc3QgQU5BTElTSVNfUElOID0gJzEyMzUnO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQgRXhjZWwgVEFSR0VUUy1aT05BUyAtIHNvbG8gY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSBsYSBob2phIENMSUVOVEVTX1pPTkFTIGNvbiBVTkEgZmlsYSBwb3IgQlAgcXVlIGVzdGEgdml2byBlbiBTQVA6XG4vLyBjdWFscXVpZXIgYWx0YSBkZSBjbGllbnRfYXBwbGljYXRpb25zIGNvbiBzdGF0dXM9J2FwcHJvdmVkJyBZIGNhcmRDb2RlU2FwXG4vLyBhc2lnbmFkby4gRXhjbHV5ZSBQT0lOVFMgLyBkaXN0cmlidWlkb3JlcyAvIHByb3NwZWN0b3MgLyBhbHRhcyBzaW5cbi8vIENhcmRDb2RlIChtb2NrcyBvIHBlbmRpZW50ZXMgZGUgU0FQKS4gRXMgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgZmFjdHVyYS5cbi8vIENvbHVtbmFzOiBUSVBPLCBOUk8gQ1RFLCBSRUdJT04sIFBST1ZJTkNJQSwgQVNFU09SIEVYVEVSTk8sIEFTRVNPUiBJTlRFUk5PLFxuLy8gQ0FMTEUsIE5VTUVSTywgTE9DQUxJREFELCBDUCwgTk9NQlJFIENPTUVSQ0lBTCwgTk9NQlJFIERFIEZBTlRBU0lBLCBDVUlULFxuLy8gQ09ORElDSU9OIEZJU0NBTCwgVEVMRUZPTk8sIENBUkRDT0RFIFNBUC5cbndpbmRvdy5leHBvcnRUYXJnZXRzWm9uYXMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaWNcdTAwRTEgdHUgY29uZXhpXHUwMEYzbiB5IHJlaW50ZW50XHUwMEUxLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBleHBvcnRhciBlbCBtYXN0ZXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgVEFSR0VUUy1aT05BUy4uLicpO1xuICBjb25zdCBWREVfVE9fVkRJID0ge1xuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICAgICdNQVJUSU4gQk9JRVJPJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ05FQSc7XG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xuICAgIHJldHVybiAnJztcbiAgfVxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xuICAgIHJldHVybiBrZXk7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBsZXQgYWx0YXNTbmFwO1xuICB0cnkge1xuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcbiAgICAgIC5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXG4gICAgaWYgKCFjYXJkQ29kZSkge1xuICAgICAgc2tpcHBlZE5vU2FwKys7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xuICB9KTtcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiAoclsnTlJPIENURSddID0gaSArIDEpKTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTAgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMjggfSxcbiAgICB7IHdjaDogMjggfSxcbiAgICB7IHdjaDogMjggfSxcbiAgICB7IHdjaDogMTAgfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMTAgfSxcbiAgICB7IHdjaDogMzggfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdDTElFTlRFU19aT05BUycpO1xuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcpO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhjZWwgZXhwb3J0YWRvOiAnICtcbiAgICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgU0FQIGhhYmlsaXRhZG9zJyArXG4gICAgICAoc2tpcHBlZE5vU2FwID4gMCA/ICcgKCcgKyBza2lwcGVkTm9TYXAgKyAnIHNpbiBDYXJkQ29kZSBkZXNjYXJ0YWRvcyknIDogJycpXG4gICk7XG59O1xuXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcGluID0gcHJvbXB0KFxuICAgICdFc3RhIHNlY2Npb24gY29udGllbmUgZm9ybWF0b3MgYXZhbnphZG9zIChQb3dlciBCSSwgUHl0aG9uL01MLCBaSVAgZGUgZm90b3MpIGRlc3RpbmFkb3MgYSBhbmFsaXNpcyB0ZWNuaWNvLlxcblxcbkluZ3Jlc2EgZWwgUElOIHBhcmEgY29udGludWFyOidcbiAgKTtcbiAgaWYgKHBpbiA9PT0gbnVsbCkgcmV0dXJuO1xuICBpZiAocGluICE9PSBBTkFMSVNJU19QSU4pIHtcbiAgICBhbGVydCgnUElOIGluY29ycmVjdG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE9wY2lvbiBJbnRlZ3JhY2lvbiBTQVA6IHNvbG8gcGFyYSBNYXJpYW5vIChlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSlcbiAgY29uc3Qgc2FwT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtc2FwLWludGVncmF0aW9uJyk7XG4gIGlmIChzYXBPcHQpIHtcbiAgICBjb25zdCBpc01hcmlhbm8gPVxuICAgICAgY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nO1xuICAgIHNhcE9wdC5zdHlsZS5kaXNwbGF5ID0gaXNNYXJpYW5vID8gJycgOiAnbm9uZSc7XG4gIH1cbiAgLy8gT3BjaW9uIEJhY2t1cCBtZW5zdWFsOiBzb2xvIGFkbWluXG4gIGNvbnN0IGJrT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtYmFja3VwLW1lbnN1YWwnKTtcbiAgaWYgKGJrT3B0KSBia09wdC5zdHlsZS5kaXNwbGF5ID0gdXNlclJvbGUgPT09ICdhZG1pbicgPyAnJyA6ICdub25lJztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VFeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXG4vLyBIZWxwZXJzIGludGVybm9zIChkb3dubG9hZFhsc3gsIGV4cG9ydFZlbnRhc0Zvck1vbnRoLCBldGMuKSBzb24gY29uc3VtaWRvc1xuLy8gc29sbyBkZW50cm8gZGUgZXN0ZSBibG9xdWUgKHZlcmlmaWNhZG8gcHJlLWV4dHJhY2NpXHUwMEYzbikuXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFnQkEsU0FBTyx1QkFBdUIsV0FBWTtBQUN4QyxRQUFJLE9BQU8sU0FBUyxhQUFhO0FBQy9CLFlBQU0saUZBQWlGO0FBQ3ZGO0FBQUEsSUFDRjtBQUNBLFFBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxRQUFRO0FBQzdCLFlBQU0sZ0NBQWdDO0FBQ3RDO0FBQUEsSUFDRjtBQUNBLGdCQUFZLHFDQUFxQztBQVFqRCxVQUFNLFdBQ0osT0FBTywwQkFBMEIsYUFDN0Isc0JBQXNCLE9BQU8sa0JBQWtCLGNBQWMsZ0JBQWdCLEtBQUssSUFDbEY7QUFDTixVQUFNLFVBQVUsQ0FBQyxjQUFjO0FBQzdCLFVBQUks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
