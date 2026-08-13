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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBkYXRvcyBjYXJnYWRvcyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIG1hc3RlcmZpbGUgZGUgY2xpZW50ZXMuLi4nKTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgJ01BUlRJTiBCT0lFUk8nOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LnpvbmUgOiAnJztcbiAgfVxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XG4gIH1cblxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcbiAgLy8gY2xpZW50ZSwgbWVyZ2VhIGxvcyBjYW1wb3MgZGUgY2xhc2lmaWNhY2lvbiAodGlwby90YW1hbm8vZmlkZWxpZGFkL1xuICAvLyBlc3BlY2lhbGl6YWNpb24vY2FuYWxDb21wcmEvcG9wL3RpcG9WZW50YS9ldGMuKSBkZWwgZm9ybXVsYXJpbyBkZVxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXG4gIC8vIE5PIFZBQ0lPIGFsIHJlY29ycmVyIGRvY3MgZGUgbWFzIHJlY2llbnRlIGEgbWFzIGFudGlndW8uIEFzaSBlbCB1c3VhcmlvXG4gIC8vIHZlIGxhIGNsYXNpZmljYWNpb24gbWFzIGFjdHVhbGl6YWRhLCBwZXJvIHNpIGVsIHVsdGltbyBjb250YWN0byBubyBsbGVuYVxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcbiAgLy8gZW4gdmV6IGRlIGRlamFyIHZhY2lvLiBQZWRpZG8gZGUgTWFyaWFubzogXCJwcmlvcml6YXIgbGEgdWx0aW1hXG4gIC8vIGludGVyYWNjaW9uIHBlcm8gbm8gcGVyZGVyIGluZm8gdXRpbCBkZSBsYXMgYW50ZXJpb3Jlc1wiLlxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcbiAgICAndGlwbycsXG4gICAgJ2xvY2FsJyxcbiAgICAndGFtYW5vJyxcbiAgICAnZmlkZWxpZGFkJyxcbiAgICAnZXNwZWNpYWxpemFjaW9uJyxcbiAgICAnY2FuYWxDb21wcmEnLFxuICAgICdyZWxldmFuY2lhJyxcbiAgICAncG9wJyxcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXG4gICAgJ3RpcG9WZW50YScsXG4gICAgJ3BvbmRlcmFjaW9uTW9zdHJhZG8nLFxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXG4gICAgJ2NvbXBldGVuY2lhJyxcbiAgICAnb3BvcnR1bmlkYWQnLFxuICAgICdtYXNWZW5kaWRvJyxcbiAgICAnbWFzUHJlZ3VudGFuJyxcbiAgICAnYXl1ZGFUaWVuZGEnLFxuICBdO1xuICBmdW5jdGlvbiBfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIHJldHVybiAoXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKGxvYyB8fCAnJykudG9TdHJpbmcoKS50cmltKCkgK1xuICAgICAgJ3wnICtcbiAgICAgICh0aWVuZGEgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpXG4gICAgKTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlRzKHYpIHtcbiAgICBpZiAodiAmJiB2LmNyZWF0ZWRBdCAmJiB2LmNyZWF0ZWRBdC50b01pbGxpcykgcmV0dXJuIHYuY3JlYXRlZEF0LnRvTWlsbGlzKCk7XG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xuICAgIHJldHVybiAwO1xuICB9XG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XG4gIGlmICh0eXBlb2YgdmlzaXRzQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkodmlzaXRzQ2FjaGUpKSB7XG4gICAgY29uc3QgYnlLZXkgPSBuZXcgTWFwKCk7XG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgICAgaWYgKCF2KSByZXR1cm47XG4gICAgICBjb25zdCBrID0gX2NsYXNzaWZLZXkodi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSk7XG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcbiAgICAgIGJ5S2V5LmdldChrKS5wdXNoKHYpO1xuICAgIH0pO1xuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xuICAgICAgYXJyLnNvcnQoKGEsIGIpID0+IF9jbGFzc2lmVHMoYikgLSBfY2xhc3NpZlRzKGEpKTsgLy8gZGVzYyBwb3IgZmVjaGFcbiAgICAgIGNvbnN0IG1lcmdlZCA9IHt9O1xuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcbiAgICAgICAgQ0xBU1NJRl9GSUVMRFMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgICAgIGlmIChtZXJnZWRbZl0gIT0gbnVsbCAmJiBtZXJnZWRbZl0gIT09ICcnICYmIG1lcmdlZFtmXSAhPT0gMCkgcmV0dXJuO1xuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XG4gICAgICAgICAgaWYgKHZhbCAhPSBudWxsICYmIHZhbCAhPT0gJycpIG1lcmdlZFtmXSA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGFyclswXSB8fCB7fTtcbiAgICAgIGNsYXNzaWZJbmRleC5zZXQoaywge1xuICAgICAgICBtZXJnZWQsXG4gICAgICAgIGxhc3RGZWNoYTogbGF0ZXN0LmZlY2hhIHx8ICcnLFxuICAgICAgICBsYXN0VHlwZTogbGF0ZXN0LmludGVyYWN0aW9uVHlwZSB8fCAobGF0ZXN0LmVzcGFjaW8gPyAndmlzaXRhJyA6ICcnKSxcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcbiAgICAgICAgY29udGFjdG9zOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gX2NsYXNzaWZSb3cocHJvdiwgbG9jLCB0aWVuZGEpIHtcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxuICAgICAgICAnVG90YWwgdmlzaXRhcyc6IDAsXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxuICAgICAgICAnVGlwbyBjb21lcmNpbyc6ICcnLFxuICAgICAgICBMb2NhbDogJycsXG4gICAgICAgIFRhbWFubzogJycsXG4gICAgICAgIEZpZGVsaWRhZDogJycsXG4gICAgICAgIEVzcGVjaWFsaXphY2lvbjogJycsXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcbiAgICAgICAgUmVsZXZhbmNpYTogJycsXG4gICAgICAgIFBPUDogJycsXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxuICAgICAgICAnVGlwbyBkZSB2ZW50YSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcbiAgICAgICAgQ29tcGV0ZW5jaWE6ICcnLFxuICAgICAgICBPcG9ydHVuaWRhZDogJycsXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxuICAgICAgICAnTWFzIHByZWd1bnRhbic6ICcnLFxuICAgICAgICAnQXl1ZGEgdGllbmRhJzogJycsXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBtID0gZW50cnkubWVyZ2VkIHx8IHt9O1xuICAgIHJldHVybiB7XG4gICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdEZlY2hhLFxuICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdFR5cGUsXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXG4gICAgICAnVG90YWwgY29udGFjdG9zJzogZW50cnkuY29udGFjdG9zLFxuICAgICAgJ1RpcG8gY29tZXJjaW8nOiBtLnRpcG8gfHwgJycsXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcbiAgICAgIFRhbWFubzogbS50YW1hbm8gfHwgJycsXG4gICAgICBGaWRlbGlkYWQ6IG0uZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcbiAgICAgICdDYW5hbCBkZSBjb21wcmEnOiBtLmNhbmFsQ29tcHJhIHx8ICcnLFxuICAgICAgUmVsZXZhbmNpYTogbS5yZWxldmFuY2lhICE9IG51bGwgPyBtLnJlbGV2YW5jaWEgOiAnJyxcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXG4gICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiBtLm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICAnVGlwbyBkZSB2ZW50YSc6IG0udGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogbS5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gbS5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxuICAgICAgQ29tcGV0ZW5jaWE6IG0uY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgICdNYXMgdmVuZGlkbyc6IG0ubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgICdNYXMgcHJlZ3VudGFuJzogbS5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxuICAvLyB0aWVuZW4gY2FyZENvZGUgKyBkaXJlY2Npb24uIEVzb3Mgc29uIGxvcyBxdWUgYXBhcmVjZW4gY29tbyB2ZXJkZXMgZW5cbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xuICAvLyByZWFsIG9wZXJhYmxlIGhveS5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHByb3ZpbmNlID0gcC5wcm92aW5jZSB8fCAnJztcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcbiAgICBjb25zdCBkZXB0ID0gcC5kZXB0IHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvciA9IHAudmVuZG9yIHx8ICcnO1xuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cbiAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgIGNvbnN0IGxhdCA9IHAubGF0ICE9IG51bGwgPyBwLmxhdCA6ICcnO1xuICAgIGNvbnN0IGxvbiA9IHAubG9uICE9IG51bGwgPyBwLmxvbiA6ICcnO1xuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cbiAgICAvLyBlbCBmaWx0cm8gaXNTYXBDb25maXJtZWQ6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi5cbiAgICAocC5jbGllbnRzIHx8IFtdKS5mb3JFYWNoKChuYW1lKSA9PiB7XG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpXG4gICAgICAgIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XG4gICAgICAvLyBFc3RhZG86IGhhYmlsaXRhZG8vY2FuY2VsYWRvL3BlbmRpZW50ZSAobGVnYWN5IGNvbnRhY3RlZCBzZXQpLlxuICAgICAgbGV0IGVzdGFkbyA9ICdIYWJpbGl0YWRvJzsgLy8gcG9yIGRlZmluaWNpb24geWEgZXN0YSBTQVAtY29uZmlybWFkb1xuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcbiAgICAgICAgZXN0YWRvID0gJ0NhbmNlbGFkbyc7XG4gICAgICAvLyBNZXRhZGF0YSBjdXN0b20gKGRpcmVjY2lvbiwgbG9jYWxpZGFkIGRlY2xhcmFkYSwgZ2VvY29kZSkuXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xuICAgICAgLy8gQnVzY2FyIGFkZHJlc3M6IDEpIGNsaWVudF9tYXN0ZXIuYWRkcmVzcyAoYWRtaW4pLCAyKSBjbGllbnRNZXRhLmFkZHJlc3MgKHZlbmRvcikuXG4gICAgICBjb25zdCBkb2NJZCA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcbiAgICAgIGNvbnN0IGNtRGF0YSA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XG4gICAgICBjb25zdCBhZGRyZXNzID0gY21EYXRhLmFkZHJlc3MgfHwgbWV0YS5hZGRyZXNzIHx8ICcnO1xuICAgICAgY29uc3QgbG9jYWxpdHlDdXN0ID0gY21EYXRhLmxvY2FsaWRhZCB8fCBtZXRhLmxvY2FsaXR5IHx8ICcnO1xuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XG4gICAgICBjb25zdCBjdXN0b21MbmcgPSBtZXRhLmxuZyAhPSBudWxsID8gbWV0YS5sbmcgOiAnJztcbiAgICAgIC8vIENhcmRDb2RlIFNBUCAoZGUgY2xpZW50X21hc3RlciBvIGRlIGxhIGFsdGEgdmluY3VsYWRhKS5cbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcHJvdmluY2UudG9VcHBlckNhc2UoKSArICd8JyArIGxvY2FsaXR5TWFwO1xuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiAoYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8ICcnKSA9PT0gbmFtZSk7XG4gICAgICAgIGlmIChhbHRhTWF0Y2gpIGNhcmRDb2RlID0gYWx0YU1hdGNoLmNhcmRDb2RlU2FwIHx8ICcnO1xuICAgICAgfVxuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBjYXJkQ29kZSxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbmFtZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcbiAgICAgICAgICAgIFRpcG86ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGVzdGFkbyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jYWxpdHlNYXAsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86IGRlcHQsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGFkZHJlc3MsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvY2FsaXR5Q3VzdCxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogY3VzdG9tTG5nIHx8IGxvbixcbiAgICAgICAgICB9LFxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSlcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG4gIC8vIElueWVjdGFyIGFsdGFzIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgKGFwcHJvdmVkQWx0YXNMaXN0KTpcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxuICAvLyAgICAgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS4gVmFuIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLiBTZVxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXG4gIC8vICAgICBMb3MgcHJvdmlzb3Jpb3MgcHVlZGVuIG5vIHRlbmVyIGRpcmVjY2lvbiB0b2RhdmlhIC0+IHNlIGFjZXB0YW4gaWd1YWwuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIHJvd3MuZm9yRWFjaCgocikgPT5cbiAgICBzZWVuLmFkZChcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxuICAgIClcbiAgKTtcbiAgaWYgKHR5cGVvZiBhcHByb3ZlZEFsdGFzTGlzdCAhPT0gJ3VuZGVmaW5lZCcgJiYgYXBwcm92ZWRBbHRhc0xpc3QubGVuZ3RoKSB7XG4gICAgYXBwcm92ZWRBbHRhc0xpc3QuZm9yRWFjaCgoYSkgPT4ge1xuICAgICAgaWYgKCFhKSByZXR1cm47XG4gICAgICBjb25zdCBpc1Byb3Zpc29yaW8gPSAhIWEubWFudWFsU2FwUGVuZGluZyAmJiAhYS5jYXJkQ29kZVNhcDtcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXG4gICAgICAvLyBQcm92aXNvcmlvczogc2luIGNhcmRDb2RlIG5pIGRpcmVjY2lvbiwgdmFuIGlndWFsIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLlxuICAgICAgaWYgKCFpc1Byb3Zpc29yaW8pIHtcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XG4gICAgICAgIGlmICghKGEuY2FsbGUgfHwgYS5hZGRyZXNzKSkgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IG5vbWJyZSA9XG4gICAgICAgIGEuY29tZXJjaW8gfHxcbiAgICAgICAgYS5mYW50YXNpYSB8fFxuICAgICAgICAoYS5jYXJkQ29kZVNhcCA/ICdTQVAgJyArIGEuY2FyZENvZGVTYXAuc2xpY2UoMCwgOCkgOiBhLnRpdHVsYXIgfHwgJ1Byb3Zpc29yaW8nKTtcbiAgICAgIGNvbnN0IGR1cEtleSA9IHByb3YudG9VcHBlckNhc2UoKSArICd8JyArIG5vbWJyZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHNlZW4uaGFzKGR1cEtleSkpIHJldHVybjtcbiAgICAgIHNlZW4uYWRkKGR1cEtleSk7XG4gICAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgICAgLy8gdjMzMTogbWlzbW8gZmlsdHJvIGRlIHNjb3BlIGFwbGljYSBhIGFsdGFzIFNBUC9wcm92aXNvcmlhcy5cbiAgICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xuICAgICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgICAgY29uc3QgbG9jID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnKHNpbiBsb2NhbGlkYWQpJztcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogYS5jYXJkQ29kZVNhcCB8fCAnJyxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcbiAgICAgICAgICAgIFRpcG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvIChBbHRhIHJhcGlkYSknIDogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICAgICAgWm9uYTogem9uZSxcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgICAgIERpcmVjY2lvbjogYS5jYWxsZSB8fCBhLmFkZHJlc3MgfHwgJycsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGEubG5nICE9IG51bGwgPyBhLmxuZyA6ICcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgX2NsYXNzaWZSb3cocHJvdiwgbG9jLCBub21icmUpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBPcmRlbmFyIHBvciBwcm92aW5jaWEsIGxvY2FsaWRhZCwgbm9tYnJlLlxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChhWydOb21icmUgdGllbmRhJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKTtcbiAgfSk7XG5cbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xuICAgICAgICAnRWwgbWFzdGVyZmlsZSBpbmNsdXllOlxcbicgK1xuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xuICAgICAgICAnU2kgbm8gdmVzIG5pbmd1bm8sIHJldmlzYSBlbCBtb2RhbCBTQVAgbyBBbHRhIENsaWVudGVzLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE2IH0sIC8vIENhcmRDb2RlIFNBUFxuICAgIHsgd2NoOiAzOCB9LCAvLyBOb21icmUgdGllbmRhXG4gICAgeyB3Y2g6IDI4IH0sIC8vIEFsaWFzXG4gICAgeyB3Y2g6IDE0IH0sIC8vIFRpcG9cbiAgICB7IHdjaDogMTQgfSwgLy8gRXN0YWRvXG4gICAgeyB3Y2g6IDIyIH0sIC8vIFByb3ZpbmNpYVxuICAgIHsgd2NoOiAyMiB9LCAvLyBMb2NhbGlkYWQgbWFwYVxuICAgIHsgd2NoOiAyMiB9LCAvLyBEZXBhcnRhbWVudG9cbiAgICB7IHdjaDogMjggfSwgLy8gVmVuZGVkb3IgZXh0ZXJub1xuICAgIHsgd2NoOiA4IH0sIC8vIFpvbmFcbiAgICB7IHdjaDogNDggfSwgLy8gRXRpcXVldGEgem9uYVxuICAgIHsgd2NoOiAyOCB9LCAvLyBBc2Vzb3IgaW50ZXJub1xuICAgIHsgd2NoOiAzOCB9LCAvLyBEaXJlY2Npb25cbiAgICB7IHdjaDogMjQgfSwgLy8gTG9jYWxpZGFkIGRlY2xhcmFkYVxuICAgIHsgd2NoOiAxNCB9LCAvLyBMYXRcbiAgICB7IHdjaDogMTQgfSwgLy8gTG5nXG4gICAgLy8gdjQ1MDogY2xhc2lmaWNhY2lvbiBkZXNkZSB2aXNpdHMvY29udGFjdG9zLlxuICAgIHsgd2NoOiAxNCB9LCAvLyBVbHRpbWEgaW50ZXJhY2Npb25cbiAgICB7IHdjaDogMTQgfSwgLy8gVGlwbyB1bHRpbWEgaW50ZXJhY2Npb25cbiAgICB7IHdjaDogMTAgfSwgLy8gVG90YWwgdmlzaXRhc1xuICAgIHsgd2NoOiAxMCB9LCAvLyBUb3RhbCBjb250YWN0b3NcbiAgICB7IHdjaDogMTggfSwgLy8gVGlwbyBjb21lcmNpb1xuICAgIHsgd2NoOiAxNiB9LCAvLyBMb2NhbFxuICAgIHsgd2NoOiAxMiB9LCAvLyBUYW1hbm9cbiAgICB7IHdjaDogMTQgfSwgLy8gRmlkZWxpZGFkXG4gICAgeyB3Y2g6IDIwIH0sIC8vIEVzcGVjaWFsaXphY2lvblxuICAgIHsgd2NoOiAyMCB9LCAvLyBDYW5hbCBkZSBjb21wcmFcbiAgICB7IHdjaDogMTAgfSwgLy8gUmVsZXZhbmNpYVxuICAgIHsgd2NoOiA4IH0sIC8vIFBPUFxuICAgIHsgd2NoOiAyNiB9LCAvLyBOZWNlc2lkYWQgcHVudHVhbFxuICAgIHsgd2NoOiAxNiB9LCAvLyBUaXBvIGRlIHZlbnRhXG4gICAgeyB3Y2g6IDE4IH0sIC8vIFBvbmRlcmFjaW9uIG1vc3RyYWRvclxuICAgIHsgd2NoOiAxOCB9LCAvLyBQb25kZXJhY2lvbiBlLWNvbW1lcmNlXG4gICAgeyB3Y2g6IDI2IH0sIC8vIENvbXBldGVuY2lhXG4gICAgeyB3Y2g6IDI2IH0sIC8vIE9wb3J0dW5pZGFkXG4gICAgeyB3Y2g6IDIyIH0sIC8vIE1hcyB2ZW5kaWRvXG4gICAgeyB3Y2g6IDIyIH0sIC8vIE1hcyBwcmVndW50YW5cbiAgICB7IHdjaDogMjYgfSwgLy8gQXl1ZGEgdGllbmRhXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ2xpZW50ZXMgaGFiaWxpdGFkb3MgU0FQJyk7XG5cbiAgLy8gSG9qYSByZXN1bWVuIHBvciB6b25hXG4gIGNvbnN0IGJ5Wm9uZSA9IHt9O1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBjb25zdCB6ID0gclsnRXRpcXVldGEgem9uYSddIHx8ICdTaW4gem9uYSc7XG4gICAgaWYgKCFieVpvbmVbel0pIGJ5Wm9uZVt6XSA9IHsgdG90YWw6IDAsIGhhYmlsaXRhZG9zOiAwLCBjYW5jZWxhZG9zOiAwIH07XG4gICAgYnlab25lW3pdLnRvdGFsKys7XG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xuICAgIGVsc2UgaWYgKHIuRXN0YWRvID09PSAnQ2FuY2VsYWRvJykgYnlab25lW3pdLmNhbmNlbGFkb3MrKztcbiAgfSk7XG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gT2JqZWN0LmVudHJpZXMoYnlab25lKVxuICAgIC5tYXAoKFt6LCBkXSkgPT4gKHtcbiAgICAgICdab25hIC8gVmVuZGVkb3InOiB6LFxuICAgICAgJ1RvdGFsIHRpZW5kYXMnOiBkLnRvdGFsLFxuICAgICAgSGFiaWxpdGFkYXM6IGQuaGFiaWxpdGFkb3MsXG4gICAgICBDYW5jZWxhZGFzOiBkLmNhbmNlbGFkb3MsXG4gICAgfSkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XG4gIGNvbnN0IHdzUmVzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW5Sb3dzKTtcbiAgd3NSZXNbJyFjb2xzJ10gPSBbeyB3Y2g6IDQ4IH0sIHsgd2NoOiAxNCB9LCB7IHdjaDogMTQgfSwgeyB3Y2g6IDE0IH1dO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1JlcywgJ1Jlc3VtZW4gcG9yIHpvbmEnKTtcblxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIC8vIHYzMzE6IHN1ZmlqbyBjb24gZWwgc2NvcGUgYXBsaWNhZG8gcGFyYSBkaWZlcmVuY2lhciBlbCBhcmNoaXZvIGRlbCBWREUvVkRJXG4gIC8vIGRlbCBleHBvcnQgZ2xvYmFsIGRlbCBhZG1pbi5cbiAgY29uc3Qgc2NvcGVMYmwgPVxuICAgIHNjb3BlU2V0ID09PSBudWxsXG4gICAgICA/ICdUT0RPUydcbiAgICAgIDogc2NvcGVTZXQuc2l6ZSA9PT0gMVxuICAgICAgICA/IFsuLi5zY29wZVNldF1bMF0uc3BsaXQoJyAnKVswXVxuICAgICAgICA6ICdtaXMtem9uYXMtJyArIHNjb3BlU2V0LnNpemU7XG4gIGNvbnN0IGZuYW1lID0gJ01hc3RlcmZpbGVfQ2xpZW50ZXNfU0FQXycgKyBzY29wZUxibCArICdfJyArIHRzICsgJy54bHN4JztcbiAgWExTWC53cml0ZUZpbGUod2IsIGZuYW1lKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArXG4gICAgICAoc2NvcGVTZXQgPT09IG51bGwgPyAnJyA6ICcgKHNjb3BlOiAnICsgWy4uLnNjb3BlU2V0XS5qb2luKCcsICcpICsgJyknKVxuICApO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcbi8vIEZpcmVzdG9yZSkgeSBTVE9DS19NQVAgKGJvb2xlYW5vIHBvciBTS1UgZGVsIHN0b2NrLmpzb24gZGVsIHJlcG8pLlxuLy8gSG9qYXM6XG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXG4vLyAgICAobG8gbWFzIGNvbXVuIHBhcmEgcmV2aXNhciBkaXNwb25pYmlsaWRhZCArIHByZWNpbykuXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cbi8vICAtIFwiSW5mb1wiOiBmZWNoYSBkZSBsb3Mgc25hcHNob3RzIHkgZnVlbnRlcy5cbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoUFJPRFVDVFMpIHx8ICFQUk9EVUNUUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XG4gIC8vIEhlbHBlciBkZSBmb3JtYXRvIGRlIHN0b2NrIHBhcmEgcXVlIHNlYSBsZWdpYmxlIGVuIEV4Y2VsLlxuICBmdW5jdGlvbiBmbXRTdG9jayhza3UpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIGhhc1N0b2NrID09PSAnZnVuY3Rpb24nID8gaGFzU3RvY2soc2t1KSA6IG51bGw7XG4gICAgaWYgKHYgPT09IHRydWUpIHJldHVybiAnRGlzcG9uaWJsZSc7XG4gICAgaWYgKHYgPT09IGZhbHNlKSByZXR1cm4gJ1NpbiBzdG9jayc7XG4gICAgcmV0dXJuICdTaW4gZGF0byc7XG4gIH1cbiAgZnVuY3Rpb24gZm10UHJlY2lvKHNrdSkge1xuICAgIGNvbnN0IHAgPSB0eXBlb2YgUFJJQ0VfTElTVF9NQVAgPT09ICdvYmplY3QnICYmIFBSSUNFX0xJU1RfTUFQID8gUFJJQ0VfTElTVF9NQVBbc2t1XSA6IG51bGw7XG4gICAgaWYgKHAgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgIHJldHVybiBOdW1iZXIocCkgfHwgMDtcbiAgfVxuICAvLyBIb2phIDE6IGNvbWJvIGNvbXBsZXRvIChlcyBsYSBtYXMgcGVkaWRhKS5cbiAgY29uc3Qgcm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgIEZhbWlsaWE6IHAuZmFtIHx8ICcnLFxuICAgIFN1YmZhbWlsaWE6IHAuc3ViIHx8ICcnLFxuICAgIENhdGVnb3JpYTogcC5jYXQgfHwgJycsXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcbiAgICAnU3RvY2sgVzExJzogZm10U3RvY2socC5jb2RlKSxcbiAgfSkpLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XG4gIHdzWychY29scyddID0gW1xuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiA2MCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICBdO1xuICAvLyBBcGxpY2FyIGZvcm1hdG8gbW9uZWRhIGEgbGEgY29sdW1uYSBQcmVjaW8gQVJTIChjb2x1bW5hIEYgPSA2KS5cbiAgZm9yIChsZXQgaSA9IDI7IGkgPD0gcm93cy5sZW5ndGggKyAxOyBpKyspIHtcbiAgICBjb25zdCBjZWxsID0gd3NbJ0YnICsgaV07XG4gICAgaWYgKGNlbGwgJiYgdHlwZW9mIGNlbGwudiA9PT0gJ251bWJlcicpIGNlbGwueiA9ICdcIiRcIiMsIyMwJztcbiAgfVxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1ByZWNpb3MgeSBTdG9jaycpO1xuXG4gIC8vIEhvamEgMjogc29sbyBQcmVjaW9zXG4gIGNvbnN0IHByZWNpb3NSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcbiAgfSkpXG4gICAgLmZpbHRlcigocikgPT4gclsnUHJlY2lvIEFSUyddICE9PSAnJylcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHdzUCA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChwcmVjaW9zUm93cyk7XG4gIHdzUFsnIWNvbHMnXSA9IFt7IHdjaDogMTQgfSwgeyB3Y2g6IDYwIH0sIHsgd2NoOiAxNCB9XTtcbiAgZm9yIChsZXQgaSA9IDI7IGkgPD0gcHJlY2lvc1Jvd3MubGVuZ3RoICsgMTsgaSsrKSB7XG4gICAgY29uc3QgY2VsbCA9IHdzUFsnQycgKyBpXTtcbiAgICBpZiAoY2VsbCAmJiB0eXBlb2YgY2VsbC52ID09PSAnbnVtYmVyJykgY2VsbC56ID0gJ1wiJFwiIywjIzAnO1xuICB9XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUCwgJ1ByZWNpb3MnKTtcblxuICAvLyBIb2phIDM6IHNvbG8gU3RvY2tcbiAgY29uc3Qgc3RvY2tSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgJ1N0b2NrIFcxMSc6IGZtdFN0b2NrKHAuY29kZSksXG4gIH0pKS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3Qgd3NTID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHN0b2NrUm93cyk7XG4gIHdzU1snIWNvbHMnXSA9IFt7IHdjaDogMTQgfSwgeyB3Y2g6IDYwIH0sIHsgd2NoOiAxNCB9XTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NTLCAnU3RvY2snKTtcblxuICAvLyBIb2phIDQ6IG1ldGFkYXRhIC0gY3VhbmRvIGZ1ZSBjYWRhIHNuYXBzaG90IHBhcmEgcXVlIGVsIGxlY3RvciBzZXBhXG4gIC8vIHNpIGxhIGxpc3RhIGVzdGEgZnJlc2NhLlxuICBjb25zdCBpbmZvUm93cyA9IFtcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGVuIGNhdGFsb2dvJywgVmFsb3I6IFBST0RVQ1RTLmxlbmd0aCB9LFxuICAgIHsgSXRlbTogJ1RvdGFsIFNLVXMgY29uIHByZWNpbyBjYXJnYWRvJywgVmFsb3I6IHByZWNpb3NSb3dzLmxlbmd0aCB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBzdG9jayBkaXNwb25pYmxlJyxcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT09IHRydWUpLmxlbmd0aCxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIHNpbiBzdG9jaycsXG4gICAgICBWYWxvcjogUFJPRFVDVFMuZmlsdGVyKChwKSA9PiBoYXNTdG9jayhwLmNvZGUpID09PSBmYWxzZSkubGVuZ3RoLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIGRhdG8gZGUgc3RvY2snLFxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PSBudWxsKS5sZW5ndGgsXG4gICAgfSxcbiAgICB7XG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBtb25lZGEnLFxuICAgICAgVmFsb3I6IHR5cGVvZiBQUklDRV9MSVNUX0NVUlJFTkNZICE9PSAndW5kZWZpbmVkJyA/IFBSSUNFX0xJU1RfQ1VSUkVOQ1kgOiAnQVJTJyxcbiAgICB9LFxuICAgIHtcbiAgICAgIEl0ZW06ICdMaXN0YSBkZSBwcmVjaW9zIGFjdHVhbGl6YWRhJyxcbiAgICAgIFZhbG9yOlxuICAgICAgICB0eXBlb2YgUFJJQ0VfTElTVF9VUERBVEVEX0FUICE9PSAndW5kZWZpbmVkJyAmJiBQUklDRV9MSVNUX1VQREFURURfQVRcbiAgICAgICAgICA/IG5ldyBEYXRlKFBSSUNFX0xJU1RfVVBEQVRFRF9BVCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJylcbiAgICAgICAgICA6ICcobm8gY2FyZ2FkYSknLFxuICAgIH0sXG4gICAge1xuICAgICAgSXRlbTogJ1N0b2NrIHNuYXBzaG90IGFjdHVhbGl6YWRvJyxcbiAgICAgIFZhbG9yOiBTVE9DS19VUERBVEVEX0FUID8gbmV3IERhdGUoU1RPQ0tfVVBEQVRFRF9BVCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgOiAnKG5vIGNhcmdhZG8pJyxcbiAgICB9LFxuICAgIHsgSXRlbTogJ0V4cG9ydGFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXG4gICAge1xuICAgICAgSXRlbTogJ0V4cG9ydGFkbyBwb3InLFxuICAgICAgVmFsb3I6IChjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgY3VycmVudFVzZXIuZGlzcGxheU5hbWUpKSB8fCAnKGRlc2Nvbm9jaWRvKScsXG4gICAgfSxcbiAgXTtcbiAgY29uc3Qgd3NJID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGluZm9Sb3dzKTtcbiAgd3NJWychY29scyddID0gW3sgd2NoOiAzNiB9LCB7IHdjaDogMzYgfV07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzSSwgJ0luZm8nKTtcblxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnUHJlY2lvc195X1N0b2NrXycgKyB0cyArICcueGxzeCcpO1xuICBzaG93U3luY1RhZyhyb3dzLmxlbmd0aCArICcgU0tVcyBleHBvcnRhZG9zIChwcmVjaW9zICsgc3RvY2spJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCAtIGRpYWxvZ28gZGUgc2VsZWNjaW9uICsgMyBmb3JtYXRvc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG53aW5kb3cuZXhwb3J0VG9FeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZpbHRyYXIgb3BjaW9uZXMgc2VndW4gcm9sLlxuICAvLyAgIHZlbmRlZG9yOiBvcGVyYXRpdm8gZGlhcmlvIChWZW50YXMgLyBWaXNpdGFzIC8gUnV0YXMpICsgQ2xpZW50ZXMgZGUgc3Ugem9uYVxuICAvLyAgICAgKGV4cG9ydE1hc3RlckNsaWVudGVzIHlhIGZpbHRyYSBwb3IgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0IC0+IHNvbG8gc3UgdmVuZG9yKS5cbiAgLy8gICBpbnRlcm5vIChWREkpOiBtaXNtbyBzY29wZSBvcGVyYXRpdm8gKyBDbGllbnRlcyBkZSBzdXMgcGFyZWphcyAobyBzb2xvIGVsXG4gIC8vICAgICBwcm9waW8gc2kgZWxpZ2lvIHN1IG5vbWJyZSBlbiBlbCBkcm9wZG93biBkZSB6b25hcykuXG4gIC8vICAgYWRtaW4gLyBnZXJlbnRlIC8gdmlld2VyOiB2ZW4gdG9kbyBlbCBsaXN0YWRvIChudWxsID0gc2luIGZpbHRybykuXG4gIGNvbnN0IGFsbG93ZWRCeVJvbGUgPSB7XG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWRU5UQVMnLCAnVklTSVRBUycsICdSVVRBUycsICdNQVNURVInXSksXG4gICAgaW50ZXJubzogbmV3IFNldChbJ1ZFTlRBUycsICdWSVNJVEFTJywgJ1JVVEFTJywgJ01BU1RFUiddKSxcbiAgfTtcbiAgY29uc3QgYWxsb3dlZCA9IGFsbG93ZWRCeVJvbGVbdXNlclJvbGVdIHx8IG51bGw7IC8vIG51bGwgPSB2ZXIgdG9kb1xuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICBjb25zdCBraW5kID0gZWwuZGF0YXNldC5leHBLaW5kIHx8ICcnO1xuICAgIGVsLnN0eWxlLmRpc3BsYXkgPSAhYWxsb3dlZCB8fCBhbGxvd2VkLmhhcyhraW5kKSA/ICcnIDogJ25vbmUnO1xuICB9KTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VFeHBvcnREaWFsb2cgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1vbnRoIHBpY2tlciByZXV0aWxpemFibGUgcGFyYSBsb3MgNSB0aXBvcyBkZSBleHBvcnRcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxubGV0IHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbmNvbnN0IEVYUE9SVF9UWVBFX0xBQkVMUyA9IHtcbiAgVkVOVEFTOiAnVmVudGFzJyxcbiAgVklTSVRBUzogJ1Zpc2l0YXMnLFxuICBSRU5ESUNJT05FUzogJ1JlbmRpY2lvbmVzJyxcbiAgUlVUQVM6ICdSdXRhcycsXG4gIEFMVEFTOiAnQWx0YXMgZGUgY2xpZW50ZXMnLFxufTtcblxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uICh0aXBvKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXRpdGxlJyk7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcbiAgc3VidC50ZXh0Q29udGVudCA9ICdFbGVnaSBlbCBtZXMgeSBhXHUwMEYxbyBxdWUgcXVlcmVzIGRlc2Nhcmdhci4nO1xuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1lc1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKTtcbiAgbWVzU2VsLmlubmVySFRNTCA9XG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xuICBsZXQgeW9wdHMgPSAnJztcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXG4gICAgeW9wdHMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgeSArICdcIj4nICsgeSArICc8L29wdGlvbj4nO1xuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG59O1xuXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB0aXBvID0gcGVuZGluZ0V4cG9ydFR5cGU7XG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcbiAgY29uc3QgbW9udGhJZHggPSBtZXNSYXcgPT09ICdBTEwnID8gbnVsbCA6IHBhcnNlSW50KG1lc1JhdywgMTApO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG4gIGlmICghdGlwbykgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWSVNJVEFTJykgZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQUxUQVMnKSBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGFsZXJ0KCdUaXBvIGRlc2Nvbm9jaWRvOiAnICsgdGlwbyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnQgJyArIHRpcG8sIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gU3RyaW5nKGFuaW8pO1xuICByZXR1cm4gTUVTRVNbbW9udGhJZHhdICsgJ18nICsgYW5pbztcbn1cblxuZnVuY3Rpb24gZG93bmxvYWRYbHN4KGZpbGVuYW1lLCBzaGVldHMpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGZvciAoY29uc3QgcyBvZiBzaGVldHMpIHtcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICAgIHMucm93cy5sZW5ndGggPyBzLnJvd3MgOiBbeyBBdmlzbzogJ1NpbiBkYXRvcyBwYXJhIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvJyB9XVxuICAgICk7XG4gICAgaWYgKHMucm93cy5sZW5ndGgpIHtcbiAgICAgIGNvbnN0IGNvbHMgPSBPYmplY3Qua2V5cyhzLnJvd3NbMF0pLm1hcCgoaykgPT4gKHtcbiAgICAgICAgd2NoOiBNYXRoLm1pbig0MCwgTWF0aC5tYXgoMTAsIGsubGVuZ3RoICsgNCkpLFxuICAgICAgfSkpO1xuICAgICAgd3NbJyFjb2xzJ10gPSBjb2xzO1xuICAgIH1cbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgcy5uYW1lLnNsaWNlKDAsIDMxKSk7XG4gIH1cbiAgWExTWC53cml0ZUZpbGUod2IsIGZpbGVuYW1lKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWRU5UQVM6IHBlZGlkb3MgY29uZmlybWFkb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmVudGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHBlZGlkb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBwID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHAueWVhciwgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KHAubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBjb25zdCBsaW5lcyA9IHAubGluZXMgfHwgW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCB2ZW5kb3JLZXkgPSBwLnZlbmRvciB8fCBsb29rdXBWZW5kb3JGb3JDbGllbnQocC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpIHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvckluZm8gPSB2ZW5kb3JMb29rdXBbdmVuZG9yS2V5XSB8fCB7fTtcbiAgICBjb25zdCBmYWN0b3IgPSB0eXBlb2YgcGVkaWRvRGlzY291bnRGYWN0b3IgPT09ICdmdW5jdGlvbicgPyBwZWRpZG9EaXNjb3VudEZhY3RvcihwKSA6IDE7XG4gICAgY29uc3QgZGlzY1BjdCA9IChwLmRpc2NvdW50U25hcHNob3QgJiYgcC5kaXNjb3VudFNuYXBzaG90LnBjdFRvdGFsKSB8fCAwO1xuICAgIGxpbmVzLmZvckVhY2goKGwpID0+IHtcbiAgICAgIGNvbnN0IHF0eSA9IHBhcnNlRmxvYXQobC5xdHkpIHx8IDA7XG4gICAgICBjb25zdCBwcmVjaW8gPSBwYXJzZUZsb2F0KGwucHJlY2lvKSB8fCAwO1xuICAgICAgY29uc3QgZ3Jvc3MgPSBxdHkgKiBwcmVjaW87XG4gICAgICBjb25zdCBuZXQgPSBncm9zcyAqIGZhY3RvcjtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgRmVjaGFfQ29uZmlybWFkbzogcC5jb25maXJtZWRBdCA/IFN0cmluZyhwLmNvbmZpcm1lZEF0KS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgICAgRXN0YWRvOiBwLnN0YWdlIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvcktleSB8fCAnJyksXG4gICAgICAgIFpvbmE6IHZlbmRvckluZm8uem9uZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENvZGlnb19TS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCAnJyxcbiAgICAgICAgQ2F0ZWdvcmlhOiBsLmNhdCB8fCAnJyxcbiAgICAgICAgRmFtaWxpYTogbC5mYW0gfHwgJycsXG4gICAgICAgIFN1YmZhbWlsaWE6IGwuc3ViIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcbiAgICAgICAgLy8gU3VidG90YWxfQVJTID0gTkVUTyAoY29uIGRlc2N1ZW50byBhcGxpY2FkbykgLSBlcyBsbyBxdWUgY3VlbnRhXG4gICAgICAgIC8vIHBhcmEgZWwgdGFyZ2V0IGRlbCB2ZW5kZWRvci4gU3VidG90YWxfQnJ1dG9fQVJTIG11ZXN0cmEgZWwgdmFsb3JcbiAgICAgICAgLy8gZGUgbGlzdGEgc2luIGRlc2N1ZW50byBwYXJhIHRyYXphYmlsaWRhZC5cbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKG5ldCksXG4gICAgICAgIFN1YnRvdGFsX0JydXRvX0FSUzogTWF0aC5yb3VuZChncm9zcyksXG4gICAgICAgIERlc2N1ZW50b19QY3Q6IGRpc2NQY3QsXG4gICAgICAgIEVuX05vbWJyZV9EZV9WREU6IHAub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxuICAgICAgICBDYXJnYWRvX1BvcjogcC5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCBwLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1ZlbnRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnVmVudGFzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgVmVudGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuZnVuY3Rpb24gbG9va3VwVmVuZG9yRm9yQ2xpZW50KHByb3YsIGxvY05hbWUsIF9jbGllbnROYW1lKSB7XG4gIGlmICghcHJvdiB8fCAhbG9jTmFtZSkgcmV0dXJuICcnO1xuICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92ICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XG4gIHJldHVybiBwdCA/IHB0LnZlbmRvciB8fCAnJyA6ICcnO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZJU0lUQVM6IGRldGFsbGUgZGUgdmlzaXRhcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmlzaXRhcyArIENvbnRhY3Rvcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHZpc2l0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGFyZ2V0TWVzID0gbW9udGhJZHggIT09IG51bGwgPyBNRVNFU1ttb250aElkeF0udG9VcHBlckNhc2UoKSA6IG51bGw7XG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHYgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAocGFyc2VJbnQodi5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAodGFyZ2V0TWVzICYmICh2Lm1lcyB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdGFyZ2V0TWVzKSByZXR1cm47XG4gICAgaXRlbXMucHVzaCh2KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIG5pIGNvbnRhY3RvcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgblZpc2l0YXMgPSBpdGVtcy5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGg7XG4gIGNvbnN0IG5Db250YWN0b3MgPSBpdGVtcy5sZW5ndGggLSBuVmlzaXRhcztcbiAgLy8gRXhjZWxKUyBjb24gZm90byBkZWwgZnJlbnRlIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gTGF6eSBsb2FkLlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWw6ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnVmlzaXRhcyB5IENvbnRhY3RvcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdBbmlvJywga2V5OiAnYW5pbycsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdJbnRlcmFjY2lvbicsIGtleTogJ2ludGVyYWNjaW9uJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdGb3JtYSBDb250YWN0bycsIGtleTogJ2Zvcm1hQ29udGFjdG8nLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1Jlc3VsdGFkbyBDb250YWN0bycsIGtleTogJ3Jlc3VsdGFkb0N0Jywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsaWRhZCcsIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1JlbGV2YW5jaWEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ05lY2VzaWRhZCBQdW50dWFsJywga2V5OiAnbmVjJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdPcG9ydHVuaWRhZCcsIGtleTogJ29wb3J0dScsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnTWFzIFZlbmRpZG8nLCBrZXk6ICdtYXNWZScsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnTWFzIFByZWd1bnRhbicsIGtleTogJ21hc1ByJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdBeXVkYSBUaWVuZGEnLCBrZXk6ICdheXVkYScsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbyBWZW50YScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnUG9uZCBNb3N0cmFkb3InLCBrZXk6ICdwTW9zdCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUG9uZCBFY29tbWVyY2UnLCBrZXk6ICdwRWNvbScsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnR1BTIFN0YXR1cycsIGtleTogJ2dwc1N0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgRGlzdCAobSknLCBrZXk6ICdncHNEaXN0Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ0VuIG5vbWJyZSBkZSBWREUnLCBrZXk6ICdvbkJlaGFsZicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnQ2FyZ2FkbyBQb3InLCBrZXk6ICdjcmVhdGVkQnknLCB3aWR0aDogMjQgfSxcbiAgXTtcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxO1xuICBjb25zdCBST1dfSCA9IDEwMDtcbiAgY29uc3QgSU1HX1cgPSAxMzA7XG4gIGNvbnN0IElNR19IID0gOTA7XG5cbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCB2IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgaXNDb250YWN0byA9IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nO1xuICAgIGNvbnN0IGludGVyYWNjaW9uTGJsID0gaXNDb250YWN0byA/ICdDb250YWN0bycgOiAnVmlzaXRhJztcbiAgICBjb25zdCBmb3JtYUNvbnRhY3RvTGJsID0gaXNDb250YWN0byA/IHYuZm9ybWFDb250YWN0byB8fCAnU2luIGVzcGVjaWZpY2FyJyA6ICdQcmVzZW5jaWFsJztcbiAgICBsZXQgcmVzdWx0YWRvQ3RMYmwgPSAnJztcbiAgICBpZiAoaXNDb250YWN0bykge1xuICAgICAgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdyZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdSZXNwb25kaW8nO1xuICAgICAgZWxzZSBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ25vX3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ05vIHJlc3BvbmRpbyc7XG4gICAgICBlbHNlIHJlc3VsdGFkb0N0TGJsID0gJ1NpbiBtYXJjYXInO1xuICAgIH1cbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IHYuZmVjaGEgfHwgJycsXG4gICAgICBtZXM6IHYubWVzIHx8ICcnLFxuICAgICAgYW5pbzogdi5hbmlvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXG4gICAgICBlbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgaW50ZXJhY2Npb246IGludGVyYWNjaW9uTGJsLFxuICAgICAgZm9ybWFDb250YWN0bzogZm9ybWFDb250YWN0b0xibCxcbiAgICAgIHJlc3VsdGFkb0N0OiByZXN1bHRhZG9DdExibCxcbiAgICAgIGNvbWVudDogdi5jb21lbnRhcmlvIHx8ICcnLFxuICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxuICAgICAgbG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcbiAgICAgIHRpZW5kYTogdi50aWVuZGEgfHwgJycsXG4gICAgICB0aXBvOiB2LnRpcG8gfHwgJycsXG4gICAgICBsb2NhbDogdi5sb2NhbCB8fCAnJyxcbiAgICAgIHRhbWFubzogdi50YW1hbm8gfHwgJycsXG4gICAgICBmaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgcmVsZXY6IHYucmVsZXZhbmNpYSB8fCAnJyxcbiAgICAgIHBvcDogdi5wb3AgfHwgJycsXG4gICAgICBuZWM6IHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAgIG9wb3J0dTogdi5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgICBtYXNQcjogdi5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICBheXVkYTogdi5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgcE1vc3Q6IHYucG9uZGVyYWNpb25Nb3N0cmFkbyB8fCAnJyxcbiAgICAgIHBFY29tOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIHx8ICcnLFxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBncHNTdDogdi5ncHNTdGF0dXMgfHwgJycsXG4gICAgICBncHNEaXN0OiB2Lmdwc0Rpc3RhbmNlTSAhPSBudWxsID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGltYWdlbiBlbmNpbWFcbiAgICAgIG9uQmVoYWxmOiB2Lm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgIGNyZWF0ZWRCeTogdi5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCB2LmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgIH0pO1xuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byB2aXNpdGEnLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IGxpc3RvOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdGFzRm9yTW9udGgnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSRU5ESUNJT05FUzogZ2FzdG9zIHkgYW50aWNpcG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUmVuZGljaW9uZXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncmVuZGljaW9uZXMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHJlbmRpY2lvbmVzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZpbHRyYXIgcG9yIG1lcy9hbmlvXG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHIgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSByLmZlY2hhIHx8IHIuZmVjaGFHYXN0byB8fCAnJztcbiAgICBpZiAoIWR0ICYmIHIuY3JlYXRlZEF0ICYmIHIuY3JlYXRlZEF0LnRvRGF0ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZHQgPSByLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBpZiAoIWR0KSByZXR1cm47XG4gICAgY29uc3QgZE9iaiA9IG5ldyBEYXRlKGR0KTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRPYmouZ2V0VGltZSgpKSkgcmV0dXJuO1xuICAgIGlmIChkT2JqLmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZE9iai5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIGl0ZW1zLnB1c2goeyBpZDogZC5pZCwgZmVjaGE6IGR0LCByOiByIH0pO1xuICB9KTtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHJlbmRpY2lvbmVzIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gQ2FyZ2EgbGF6eS5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgaXRlbXMubGVuZ3RoICsgJyByZW5kaWNpb25lcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdSZW5kaWNpb25lcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjYgfSxcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0NvbmNlcHRvJywga2V5OiAnY29uY2VwdG8nLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ04gVGlja2V0Jywga2V5OiAnbnVtVGlja2V0Jywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdNb2RvIHBhZ28nLCBrZXk6ICdtb2RvUGFnbycsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbyBnYXN0bycsIGtleTogJ3RpcG9HYXN0bycsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnRGl2aXNpb24nLCBrZXk6ICdkaXZpc2lvbicsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZScsIGtleTogJ2ltcG9ydGUnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ01vbmVkYScsIGtleTogJ21vbmVkYScsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZSBVU0QnLCBrZXk6ICdpbXBvcnRlVXNkJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdPYnNlcnZhY2lvbmVzJywga2V5OiAnb2JzJywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdGb3RvIHRpY2tldCcsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ0VzdGFkbycsIGtleTogJ2VzdGFkbycsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG9yJywga2V5OiAnYXByb2JhZG9yJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkbyBlbicsIGtleTogJ2Fwcm9iYWRvRW4nLCB3aWR0aDogMTQgfSxcbiAgXTtcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjdFMjJDRScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxuICBjb25zdCBST1dfSCA9IDExMDtcbiAgY29uc3QgSU1HX1cgPSAxNDA7XG4gIGNvbnN0IElNR19IID0gMTAwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgaXQgb2YgaXRlbXMpIHtcbiAgICBjb25zdCByID0gaXQucjtcbiAgICBjb25zdCBpc0dhc3RvID0gci50aXBvID09PSAnZ2FzdG8nO1xuICAgIGNvbnN0IGNvbmNlcHRTdHIgPSBpc0dhc3RvID8gci5kZXNjcmlwY2lvbiB8fCAnJyA6IHIudGlwb09wZXJhY2lvbiB8fCByLm1vdGl2byB8fCAnJztcbiAgICBjb25zdCBvYnNTdHIgPVxuICAgICAgKHIub2JzZXJ2YWNpb25lcyB8fCByLm5vdGFzIHx8ICcnKSArXG4gICAgICAoaXNHYXN0byA/ICcnIDogci5zb2xpY2l0YWRvUG9yID8gJyB8IFNvbGljaXRhZG8gcG9yOiAnICsgci5zb2xpY2l0YWRvUG9yIDogJycpO1xuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogaXQuZmVjaGEsXG4gICAgICB0aXBvOiByLnRpcG8gfHwgJycsXG4gICAgICB2ZW5kZWRvcjogci5vd25lck5hbWUgfHwgci52ZW5kb3JOYW1lIHx8IHIub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGVtYWlsOiByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBjb25jZXB0bzogY29uY2VwdFN0cixcbiAgICAgIG51bVRpY2tldDogci5udW1lcm9UaWNrZXQgfHwgJycsXG4gICAgICBtb2RvUGFnbzogci5tb2RvUGFnbyB8fCAnJyxcbiAgICAgIHRpcG9HYXN0bzogci50aXBvR2FzdG8gfHwgJycsXG4gICAgICBkaXZpc2lvbjogci5kaXZpc2lvbkdhc3RvIHx8ICcnLFxuICAgICAgaW1wb3J0ZTogci5pbXBvcnRlICE9IG51bGwgPyByLmltcG9ydGUgOiAnJyxcbiAgICAgIG1vbmVkYTogci5tb25lZGEgfHwgJ1BFU09TJyxcbiAgICAgIGltcG9ydGVVc2Q6IHIuaW1wb3J0ZVVzZCAhPSBudWxsICYmIHIuaW1wb3J0ZVVzZCAhPT0gMCA/IHIuaW1wb3J0ZVVzZCA6ICcnLFxuICAgICAgb2JzOiBvYnNTdHIsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBlbmNpbWEgdmEgbGEgaW1hZ2VuXG4gICAgICBlc3RhZG86IHIuc3RhdHVzIHx8IHIuZXN0YWRvIHx8ICcnLFxuICAgICAgYXByb2JhZG9yOiByLmFwcHJvdmVyRW1haWwgfHwgci5hcHJvYmFkb3IgfHwgJycsXG4gICAgICBhcHJvYmFkb0VuOlxuICAgICAgICByLmFwcHJvdmVkQXQgJiYgci5hcHByb3ZlZEF0LnRvRGF0ZSA/IHIuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgIH0pO1xuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgLy8gRW1iZWJlciBmb3RvIGRlbCB0aWNrZXQgc2kgZXhpc3RlLiB2MzA4KzogcHJlZmVyaXIgYmFzZTY0IGVtYmViaWRvXG4gICAgLy8gKGZvdG9UaWNrZXQgLyBhZGp1bnRvKSBwb3IgY29tcGF0LCBzaW5vIHVzYXIgZm90b1RpY2tldFVybCBjb21vIEhZUEVSTElOSy5cbiAgICAvLyBBIG5pdmVsIEV4Y2VsIHVuIGRhdGFVUkwgYmFzZTY0IHNlIHB1ZWRlIGluc2VydGFyIGNvbW8gaW1hZ2VuIGlubGluZSxcbiAgICAvLyBtaWVudHJhcyBxdWUgdW5hIFVSTCBkZSBTdG9yYWdlIHNlIGFncmVnYSBjb21vIGxpbmsgY2xpY2tlYWJsZSAoZWxcbiAgICAvLyB1c3VhcmlvIGFicmUgZW4gZWwgYnJvd3NlciBzaW4gbmVjZXNpZGFkIGRlIHF1ZSBFeGNlbCBkZXNjYXJndWUpLlxuICAgIGNvbnN0IGZvdG9TcmMgPSByLmZvdG9UaWNrZXQgfHwgci5hZGp1bnRvIHx8ICcnO1xuICAgIGlmIChmb3RvU3JjICYmIHR5cGVvZiBmb3RvU3JjID09PSAnc3RyaW5nJyAmJiBmb3RvU3JjLnN0YXJ0c1dpdGgoJ2RhdGE6aW1hZ2UvJykpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCBiNjQgPSBmb3RvU3JjO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHIuZm90b1RpY2tldFVybCAmJiB0eXBlb2Ygci5mb3RvVGlja2V0VXJsID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gRG9jcyBudWV2b3MgKHYzMDgrKTogZm90byBlbiBTdG9yYWdlLCBpbnNlcnRhbW9zIGNvbW8gaHlwZXJsaW5rLlxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY2VsbCA9IHJvdy5nZXRDZWxsKEZPVE9fQ09MX0lEWCArIDEpO1xuICAgICAgICBjZWxsLnZhbHVlID0ge1xuICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxuICAgICAgICAgIGh5cGVybGluazogci5mb3RvVGlja2V0VXJsLFxuICAgICAgICAgIHRvb2x0aXA6ICdBYnJpciBsYSBmb3RvIGRlbCB0aWNrZXQgZW4gZWwgYnJvd3NlcicsXG4gICAgICAgIH07XG4gICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGMDU2M0MxJyB9LCB1bmRlcmxpbmU6IHRydWUgfTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdoeXBlcmxpbmsgZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1JlbmRpY2lvbmVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUmVuZGljaW9uZXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSdXRhcy4uLicpO1xuICAvLyBMYXMgcnV0YXMgc2UgZ2VuZXJhbiBlbiBydW50aW1lIHBhcmEgY2FkYSB2ZW5kZWRvcjsgZW4gY2FtYmlvIGxvcyBvdmVycmlkZXNcbiAgLy8gKGRlcml2YWNpb25lcyAvIHJlYWdlbmRhcykgdml2ZW4gZW4gcm91dGVfb3ZlcnJpZGVzLiBFeHBvcnRhbW9zOlxuICAvLyAgLSB1bmEgaG9qYSBjb24gbGFzIHJ1dGFzIHBsYW5pZmljYWRhcyBkZWwgcGVyaW9kbyAocGFyYSBsb3MgdmVuZGVkb3Jlc1xuICAvLyAgICBkZWwgcm9sIGFjdHVhbCBvIHRvZG9zIHNpIGFkbWluKVxuICAvLyAgLSB1bmEgaG9qYSBjb24gbG9zIG92ZXJyaWRlcyBkZWwgcGVyaW9kb1xuICBjb25zdCB0YXJnZXRWZW5kb3JzID1cbiAgICB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ3ZpZXdlcidcbiAgICAgID8gVkVORE9SUy5tYXAoKHYpID0+IHYua2V5KVxuICAgICAgOiBhc3NpZ25lZFZlbmRvclxuICAgICAgICA/IFthc3NpZ25lZFZlbmRvcl1cbiAgICAgICAgOiBbXTtcbiAgY29uc3QgbW9udGhzVG9FeHBvcnQgPSBtb250aElkeCAhPT0gbnVsbCA/IFttb250aElkeF0gOiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgNywgOCwgOSwgMTAsIDExXTtcbiAgY29uc3QgcnV0YXNSb3dzID0gW107XG4gIGZvciAoY29uc3QgdmVuZCBvZiB0YXJnZXRWZW5kb3JzKSB7XG4gICAgZm9yIChjb25zdCBtIG9mIG1vbnRoc1RvRXhwb3J0KSB7XG4gICAgICBsZXQgcnV0YXM7XG4gICAgICB0cnkge1xuICAgICAgICBydXRhcyA9IGdlbmVyYXJSdXRhc1ZlbmRvcih2ZW5kLCBtLCBhbmlvKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIHJ1dGFzID0gW107XG4gICAgICB9XG4gICAgICAocnV0YXMgfHwgW10pLmZvckVhY2goKHJ1dGEpID0+IHtcbiAgICAgICAgKHJ1dGEudGllbmRhcyB8fCBbXSkuZm9yRWFjaCgodCwgaSkgPT4ge1xuICAgICAgICAgIHJ1dGFzUm93cy5wdXNoKHtcbiAgICAgICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZCksXG4gICAgICAgICAgICBBbmlvOiBhbmlvLFxuICAgICAgICAgICAgTWVzOiBNRVNFU1ttXSxcbiAgICAgICAgICAgIFJ1dGFfSUQ6IHJ1dGEuaWQgfHwgJycsXG4gICAgICAgICAgICBSdXRhX05vbWJyZTogcnV0YS5ub21icmUgfHwgJycsXG4gICAgICAgICAgICBGZWNoYV9Bc2lnbmFkYTogcnV0YS5mZWNoYUFzaWduYWRhIHx8ICcnLFxuICAgICAgICAgICAgT3JkZW46IGkgKyAxLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UodC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgICAgICBMb2NhbGlkYWQ6IHQubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgICAgIFRpZW5kYTogdC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGlwbzogdC50aXBvIHx8ICcnLFxuICAgICAgICAgICAgRXN0YWRvOiB0LmVzdGFkbyB8fCAnJyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gT3ZlcnJpZGVzXG4gIGxldCBvdnJTbmFwO1xuICB0cnkge1xuICAgIG92clNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvdXRlX292ZXJyaWRlcycpLmdldCgpO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG92clNuYXAgPSBudWxsO1xuICB9XG4gIGNvbnN0IG92ZXJyaWRlc1Jvd3MgPSBbXTtcbiAgaWYgKG92clNuYXApIHtcbiAgICBvdnJTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGNvbnN0IG8gPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgIGlmIChwYXJzZUludChvLmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KG8ubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICAgIG92ZXJyaWRlc1Jvd3MucHVzaCh7XG4gICAgICAgIEFuaW86IG8uYW5pbyB8fCAnJyxcbiAgICAgICAgTWVzOiBNRVNFU1twYXJzZUludChvLm1vbnRoSWR4LCAxMCldIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKG8udmVuZG9yIHx8ICcnKSxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uoby5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBUaWVuZGE6IG8uY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQWNjaW9uOiBvLmFjdGlvbiB8fCBvLnRpcG8gfHwgJycsXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxuICAgICAgICBSZWFnZW5kYWRhX1BhcmE6IG8ucmVhZ2VuZGFkYVBhcmEgfHwgJycsXG4gICAgICAgIE1vdGl2bzogby5tb3Rpdm8gfHwgJycsXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgICAgIENyZWFkb19FbjpcbiAgICAgICAgICBvLmNyZWF0ZWRBdCAmJiBvLmNyZWF0ZWRBdC50b0RhdGUgPyBvLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19SdXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUnV0YXMgcGxhbmlmaWNhZGFzJywgcm93czogcnV0YXNSb3dzIH0sXG4gICAgeyBuYW1lOiAnRGVyaXZhY2lvbmVzLVJlYWdlbmRhcycsIHJvd3M6IG92ZXJyaWRlc1Jvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUnV0YXMgbGlzdG8gKCcgKyBydXRhc1Jvd3MubGVuZ3RoICsgJyB0aWVuZGFzLCAnICsgb3ZlcnJpZGVzUm93cy5sZW5ndGggKyAnIG92ZXJyaWRlcyknLFxuICAgIDI0MDBcbiAgKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQWx0YXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gJyc7XG4gICAgaWYgKGEuY3JlYXRlZEF0ICYmIGEuY3JlYXRlZEF0LnRvRGF0ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZHQgPSBhLmNyZWF0ZWRBdC50b0RhdGUoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBpZiAoIWR0KSByZXR1cm47XG4gICAgaWYgKGR0LmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZHQuZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfU29saWNpdHVkOiBkdC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSxcbiAgICAgIEVzdGFkbzogYS5zdGF0dXMgfHwgJycsXG4gICAgICBDb21lcmNpbzogYS5jb21lcmNpbyB8fCAnJyxcbiAgICAgIEZhbnRhc2lhOiBhLmZhbnRhc2lhIHx8ICcnLFxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxuICAgICAgQ29uZGljaW9uX0Zpc2NhbDogYS5jb25kRmlzY2FsIHx8ICcnLFxuICAgICAgQ2FsbGU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOdW1lcm86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBhLmxvY2FsaWRhZCB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYS5wcm92aW5jaWEgfHwgJycsXG4gICAgICBDUDogYS5jcCB8fCAnJyxcbiAgICAgIFRlbGVmb25vOiBhLnRlbGVmb25vIHx8ICcnLFxuICAgICAgRW1haWw6IGEuZW1haWwgfHwgJycsXG4gICAgICBWZW5kZWRvcl9Tb2xpY2l0YW50ZTogYS52ZW5kb3JOYW1lIHx8IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIE93bmVyX0VtYWlsOiBhLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBTdWJtaXR0ZWRfQnlfUHVibGljX0Zvcm06IGEuc3VibWl0dGVkQnlQdWJsaWNGb3JtID8gJ1NJJyA6ICdOTycsXG4gICAgICBBcHJvYmFkb19Qb3I6IGEuYXBwcm92ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgQXByb2JhZG9fRW46XG4gICAgICAgIGEuYXBwcm92ZWRBdCAmJiBhLmFwcHJvdmVkQXQudG9EYXRlID8gYS5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICBSZWNoYXphZG9fTW90aXZvOiBhLnJlamVjdGVkUmVhc29uIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19BbHRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQWx0YXMgZGUgY2xpZW50ZXMnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBBbHRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBzb2xpY2l0dWRlcyknLCAyNDAwKTtcbn1cblxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1Jztcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICAnTUFSVElOIEJPSUVSTyc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gcmVnaW9uT2YocHJvdikge1xuICAgIGNvbnN0IHAgPSAocHJvdiB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICBpZiAoWydCVUVOT1MgQUlSRVMnLCAnQ0FQSVRBTCBGRURFUkFMJywgJ0xBIFBBTVBBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQlVFTk9TIEFJUkVTJztcbiAgICBpZiAoWydDT1JET0JBJywgJ1NBTiBMVUlTJywgJ01FTkRPWkEnLCAnU0FOIEpVQU4nLCAnTEEgUklPSkEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdDVVlPJztcbiAgICBpZiAoWydTQU5UQSBGRScsICdFTlRSRSBSSU9TJywgJ0NIQUNPJywgJ0NPUlJJRU5URVMnLCAnTUlTSU9ORVMnLCAnRk9STU9TQSddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdORUEnO1xuICAgIGlmIChbJ0pVSlVZJywgJ1NBTFRBJywgJ1RVQ1VNQU4nLCAnQ0FUQU1BUkNBJywgJ1NBTlRJQUdPIERFTCBFU1RFUk8nXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdOT0EnO1xuICAgIGlmIChbJ05FVVFVRU4nLCAnUklPIE5FR1JPJywgJ0NIVUJVVCcsICdTQU5UQSBDUlVaJywgJ1RJRVJSQSBERUwgRlVFR08nXS5pbmNsdWRlcyhwKSlcbiAgICAgIHJldHVybiAnUEFUQUdPTklBJztcbiAgICByZXR1cm4gJyc7XG4gIH1cbiAgZnVuY3Rpb24gdmVuZG9yTGFiZWxGb3JFeGNlbChrZXkpIHtcbiAgICBpZiAoIWtleSkgcmV0dXJuICcnO1xuICAgIGlmIChrZXkgPT09ICdfX0RJU1RSSUJVVE9SX18nKSByZXR1cm4gJ0RJU1RSSUJVSURPUkVTJztcbiAgICByZXR1cm4ga2V5O1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgbGV0IGFsdGFzU25hcDtcbiAgdHJ5IHtcbiAgICBhbHRhc1NuYXAgPSBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9PScsICdhcHByb3ZlZCcpXG4gICAgICAuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhcyBhcHJvYmFkYXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IHNraXBwZWROb1NhcCA9IDA7XG4gIGFsdGFzU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICAvLyBGaWx0cm8gY2xhdmU6IHNvbG8gQlBzIGNvbiBDYXJkQ29kZSBTQVAgYXNpZ25hZG8gKD0gaGFiaWxpdGFkbyBlbiBTQVApLlxuICAgIGlmICghY2FyZENvZGUpIHtcbiAgICAgIHNraXBwZWROb1NhcCsrO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBwcm92aW5jZSA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9VcHBlckNhc2UoKS50cmltKCk7XG4gICAgY29uc3QgbG9jYWxpdHlGaW5hbCA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgVElQTzogJ0RBRE8gREUgQUxUQScsXG4gICAgICAnTlJPIENURSc6IDAsIC8vIHNlIHJlbnVtZXJhIGRlc3B1ZXMgZGVsIHNvcnRcbiAgICAgIFJFR0lPTjogcmVnaW9uT2YocHJvdmluY2UpLFxuICAgICAgUFJPVklOQ0lBOiBwcm92aW5jZSxcbiAgICAgICdBU0VTT1IgRVhURVJOTyc6IHZlbmRvckxhYmVsRm9yRXhjZWwodmVuZG9yKSxcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcbiAgICAgIENBTExFOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTlVNRVJPOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExPQ0FMSURBRDogbG9jYWxpdHlGaW5hbCxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgJ05PTUJSRSBDT01FUkNJQUwnOiBhLmNvbWVyY2lvIHx8IGEudGl0dWxhciB8fCAnJyxcbiAgICAgICdOT01CUkUgREUgRkFOVEFTSUEnOiBhLmZhbnRhc2lhIHx8ICcnLFxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxuICAgICAgJ0NPTkRJQ0lPTiBGSVNDQUwnOiBhLmNvbmRpY2lvbkZpc2NhbCB8fCAnJyxcbiAgICAgIFRFTEVGT05POiBhLnRlbGVmb25vIHx8ICcnLFxuICAgICAgJ0NBUkRDT0RFIFNBUCc6IGNhcmRDb2RlLFxuICAgIH0pO1xuICB9KTtcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVAgdG9kYXZpYS5cXG5cXG5VbmEgYWx0YSBlbnRyYSBhbCBleHBvcnQgc29sbyBjdWFuZG8gdGllbmUgQ2FyZENvZGUgU0FQIGFzaWduYWRvLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKHIxLCByMikgPT4ge1xuICAgIGNvbnN0IHAgPSAocjEuUFJPVklOQ0lBIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLlBST1ZJTkNJQSB8fCAnJyk7XG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xuICAgIGNvbnN0IGwgPSAocjEuTE9DQUxJREFEIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLkxPQ0FMSURBRCB8fCAnJyk7XG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcbiAgfSk7XG4gIHJvd3MuZm9yRWFjaCgociwgaSkgPT4gKHJbJ05STyBDVEUnXSA9IGkgKyAxKSk7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDEwIH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDI4IH0sXG4gICAgeyB3Y2g6IDI4IH0sXG4gICAgeyB3Y2g6IDI4IH0sXG4gICAgeyB3Y2g6IDEwIH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDEwIH0sXG4gICAgeyB3Y2g6IDM4IH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ0xJRU5URVNfWk9OQVMnKTtcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1RBUkdFVFNfVkVOREVET1JFU19aT05BU18nICsgdHMgKyAnLnhsc3gnKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4Y2VsIGV4cG9ydGFkbzogJyArXG4gICAgICByb3dzLmxlbmd0aCArXG4gICAgICAnIGNsaWVudGVzIFNBUCBoYWJpbGl0YWRvcycgK1xuICAgICAgKHNraXBwZWROb1NhcCA+IDAgPyAnICgnICsgc2tpcHBlZE5vU2FwICsgJyBzaW4gQ2FyZENvZGUgZGVzY2FydGFkb3MpJyA6ICcnKVxuICApO1xufTtcblxud2luZG93Lm9wZW5FeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHBpbiA9IHByb21wdChcbiAgICAnRXN0YSBzZWNjaW9uIGNvbnRpZW5lIGZvcm1hdG9zIGF2YW56YWRvcyAoUG93ZXIgQkksIFB5dGhvbi9NTCwgWklQIGRlIGZvdG9zKSBkZXN0aW5hZG9zIGEgYW5hbGlzaXMgdGVjbmljby5cXG5cXG5JbmdyZXNhIGVsIFBJTiBwYXJhIGNvbnRpbnVhcjonXG4gICk7XG4gIGlmIChwaW4gPT09IG51bGwpIHJldHVybjtcbiAgaWYgKHBpbiAhPT0gQU5BTElTSVNfUElOKSB7XG4gICAgYWxlcnQoJ1BJTiBpbmNvcnJlY3RvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBPcGNpb24gSW50ZWdyYWNpb24gU0FQOiBzb2xvIHBhcmEgTWFyaWFubyAoZXJiaW5vbWFyaWFub0BnbWFpbC5jb20pXG4gIGNvbnN0IHNhcE9wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LXNhcC1pbnRlZ3JhdGlvbicpO1xuICBpZiAoc2FwT3B0KSB7XG4gICAgY29uc3QgaXNNYXJpYW5vID1cbiAgICAgIGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJztcbiAgICBzYXBPcHQuc3R5bGUuZGlzcGxheSA9IGlzTWFyaWFubyA/ICcnIDogJ25vbmUnO1xuICB9XG4gIC8vIE9wY2lvbiBCYWNrdXAgbWVuc3VhbDogc29sbyBhZG1pblxuICBjb25zdCBia09wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LWJhY2t1cC1tZW5zdWFsJyk7XG4gIGlmIChia09wdCkgYmtPcHQuc3R5bGUuZGlzcGxheSA9IHVzZXJSb2xlID09PSAnYWRtaW4nID8gJycgOiAnbm9uZSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxuLy8gSGVscGVycyBpbnRlcm5vcyAoZG93bmxvYWRYbHN4LCBleHBvcnRWZW50YXNGb3JNb250aCwgZXRjLikgc29uIGNvbnN1bWlkb3Ncbi8vIHNvbG8gZGVudHJvIGRlIGVzdGUgYmxvcXVlICh2ZXJpZmljYWRvIHByZS1leHRyYWNjaVx1MDBGM24pLlxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZ0JBLFNBQU8sdUJBQXVCLFdBQVk7QUFDeEMsUUFBSSxPQUFPLFNBQVMsYUFB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
