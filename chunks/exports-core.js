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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xyXG4vLyBFWFBPUlRTLUNPUkU6IG1hc3RlcmZpbGUgY2xpZW50ZXMgKyBwcmVjaW9zL3N0b2NrICsgbW9kYWwgZGUgZXhwb3J0YXIgK1xyXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxyXG4vLyBGcmFnbWVudG9zIHJlc3RhbnRlcyBkZWwgZG9taW5pbyBleHBvcnRzOiBhZHZhbmNlZCAofjEwMzAyLTExNDUxKSB5IFNBUFxyXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgTUFTVEVSRklMRSBERSBDTElFTlRFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxyXG4vLyBub21icmUsIHRpcG8gKGNsaWVudGUvcHJvc3BlY3RvKSwgem9uYSBkZWwgdmVuZGVkb3IsIGFzZXNvciBleHRlcm5vLCBhc2Vzb3JcclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxyXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxyXG4vLyBjb29yZGVuYWRhcyBnZW9jb2RpZmljYWRhcywgZXN0YWRvIChIYWJpbGl0YWRvL1BlbmRpZW50ZS9DYW5jZWxhZG8pLFxyXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cclxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xyXG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcclxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXHJcbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxyXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcclxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xyXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxyXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cclxuICBjb25zdCBzY29wZVNldCA9XHJcbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcclxuICAgICAgOiBudWxsO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XHJcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcclxuICB9O1xyXG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcclxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cclxuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXHJcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXHJcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgJ01BUlRJTiBCT0lFUk8nOiAnU0FOVElBR08gRVNURUJBTicsXHJcbiAgfTtcclxuICBmdW5jdGlvbiBsb29rdXBab25lKHZlbmRvcktleSkge1xyXG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XHJcbiAgICByZXR1cm4gdiA/IHYuem9uZSA6ICcnO1xyXG4gIH1cclxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcclxuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xyXG4gICAgcmV0dXJuIHYgPyB2LmxhYmVsIDogdmVuZG9yS2V5IHx8ICcnO1xyXG4gIH1cclxuXHJcbiAgLy8gdjQ1MCAoMjAyNi0wOC0xMSk6IGluZGljZSBkZSBjbGFzaWZpY2FjaW9uIGRlc2RlIHZpc2l0cy4gUGFyYSBjYWRhXHJcbiAgLy8gY2xpZW50ZSwgbWVyZ2VhIGxvcyBjYW1wb3MgZGUgY2xhc2lmaWNhY2lvbiAodGlwby90YW1hbm8vZmlkZWxpZGFkL1xyXG4gIC8vIGVzcGVjaWFsaXphY2lvbi9jYW5hbENvbXByYS9wb3AvdGlwb1ZlbnRhL2V0Yy4pIGRlbCBmb3JtdWxhcmlvIGRlXHJcbiAgLy8gdmlzaXRhL2NvbnRhY3RhZG8uIFBvbGl0aWNhOiBjYW1wbyBwb3IgY2FtcG8sIHRvbWFyIGVsIHByaW1lciB2YWxvclxyXG4gIC8vIE5PIFZBQ0lPIGFsIHJlY29ycmVyIGRvY3MgZGUgbWFzIHJlY2llbnRlIGEgbWFzIGFudGlndW8uIEFzaSBlbCB1c3VhcmlvXHJcbiAgLy8gdmUgbGEgY2xhc2lmaWNhY2lvbiBtYXMgYWN0dWFsaXphZGEsIHBlcm8gc2kgZWwgdWx0aW1vIGNvbnRhY3RvIG5vIGxsZW5hXHJcbiAgLy8gdW4gY2FtcG8gKGNvbnRhY3RvcyB0aWVuZW4gbWVub3MgY2FtcG9zIHF1ZSB2aXNpdGFzKSwgY2FlIGFsIGFudGVyaW9yXHJcbiAgLy8gZW4gdmV6IGRlIGRlamFyIHZhY2lvLiBQZWRpZG8gZGUgTWFyaWFubzogXCJwcmlvcml6YXIgbGEgdWx0aW1hXHJcbiAgLy8gaW50ZXJhY2Npb24gcGVybyBubyBwZXJkZXIgaW5mbyB1dGlsIGRlIGxhcyBhbnRlcmlvcmVzXCIuXHJcbiAgY29uc3QgQ0xBU1NJRl9GSUVMRFMgPSBbXHJcbiAgICAndGlwbycsXHJcbiAgICAnbG9jYWwnLFxyXG4gICAgJ3RhbWFubycsXHJcbiAgICAnZmlkZWxpZGFkJyxcclxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxyXG4gICAgJ2NhbmFsQ29tcHJhJyxcclxuICAgICdyZWxldmFuY2lhJyxcclxuICAgICdwb3AnLFxyXG4gICAgJ25lY2VzaWRhZFB1bnR1YWwnLFxyXG4gICAgJ3RpcG9WZW50YScsXHJcbiAgICAncG9uZGVyYWNpb25Nb3N0cmFkbycsXHJcbiAgICAncG9uZGVyYWNpb25FY29tbWVyY2UnLFxyXG4gICAgJ2NvbXBldGVuY2lhJyxcclxuICAgICdvcG9ydHVuaWRhZCcsXHJcbiAgICAnbWFzVmVuZGlkbycsXHJcbiAgICAnbWFzUHJlZ3VudGFuJyxcclxuICAgICdheXVkYVRpZW5kYScsXHJcbiAgXTtcclxuICBmdW5jdGlvbiBfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkge1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgKHByb3YgfHwgJycpLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKS50cmltKCkgK1xyXG4gICAgICAnfCcgK1xyXG4gICAgICAobG9jIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKSArXHJcbiAgICAgICd8JyArXHJcbiAgICAgICh0aWVuZGEgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpXHJcbiAgICApO1xyXG4gIH1cclxuICBmdW5jdGlvbiBfY2xhc3NpZlRzKHYpIHtcclxuICAgIGlmICh2ICYmIHYuY3JlYXRlZEF0ICYmIHYuY3JlYXRlZEF0LnRvTWlsbGlzKSByZXR1cm4gdi5jcmVhdGVkQXQudG9NaWxsaXMoKTtcclxuICAgIGlmICh2ICYmIHYuZmVjaGEpIHJldHVybiBuZXcgRGF0ZSh2LmZlY2hhKS5nZXRUaW1lKCkgfHwgMDtcclxuICAgIHJldHVybiAwO1xyXG4gIH1cclxuICBjb25zdCBjbGFzc2lmSW5kZXggPSBuZXcgTWFwKCk7IC8vIGtleSAtPiB7IGxhc3Q6IHtjYW1wb3N9LCBsYXN0RmVjaGEsIGxhc3RUeXBlLCB2aXNpdGFzLCBjb250YWN0b3MgfVxyXG4gIGlmICh0eXBlb2YgdmlzaXRzQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkodmlzaXRzQ2FjaGUpKSB7XHJcbiAgICBjb25zdCBieUtleSA9IG5ldyBNYXAoKTtcclxuICAgIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcclxuICAgICAgaWYgKCF2KSByZXR1cm47XHJcbiAgICAgIGNvbnN0IGsgPSBfY2xhc3NpZktleSh2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcclxuICAgICAgaWYgKCFieUtleS5oYXMoaykpIGJ5S2V5LnNldChrLCBbXSk7XHJcbiAgICAgIGJ5S2V5LmdldChrKS5wdXNoKHYpO1xyXG4gICAgfSk7XHJcbiAgICBieUtleS5mb3JFYWNoKChhcnIsIGspID0+IHtcclxuICAgICAgYXJyLnNvcnQoKGEsIGIpID0+IF9jbGFzc2lmVHMoYikgLSBfY2xhc3NpZlRzKGEpKTsgLy8gZGVzYyBwb3IgZmVjaGFcclxuICAgICAgY29uc3QgbWVyZ2VkID0ge307XHJcbiAgICAgIGFyci5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICAgICAgQ0xBU1NJRl9GSUVMRFMuZm9yRWFjaCgoZikgPT4ge1xyXG4gICAgICAgICAgaWYgKG1lcmdlZFtmXSAhPSBudWxsICYmIG1lcmdlZFtmXSAhPT0gJycgJiYgbWVyZ2VkW2ZdICE9PSAwKSByZXR1cm47XHJcbiAgICAgICAgICBjb25zdCB2YWwgPSB2W2ZdO1xyXG4gICAgICAgICAgaWYgKHZhbCAhPSBudWxsICYmIHZhbCAhPT0gJycpIG1lcmdlZFtmXSA9IHZhbDtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGFyclswXSB8fCB7fTtcclxuICAgICAgY2xhc3NpZkluZGV4LnNldChrLCB7XHJcbiAgICAgICAgbWVyZ2VkLFxyXG4gICAgICAgIGxhc3RGZWNoYTogbGF0ZXN0LmZlY2hhIHx8ICcnLFxyXG4gICAgICAgIGxhc3RUeXBlOiBsYXRlc3QuaW50ZXJhY3Rpb25UeXBlIHx8IChsYXRlc3QuZXNwYWNpbyA/ICd2aXNpdGEnIDogJycpLFxyXG4gICAgICAgIHZpc2l0YXM6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGgsXHJcbiAgICAgICAgY29udGFjdG9zOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICBmdW5jdGlvbiBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIHRpZW5kYSkge1xyXG4gICAgY29uc3QgZW50cnkgPSBjbGFzc2lmSW5kZXguZ2V0KF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSk7XHJcbiAgICBpZiAoIWVudHJ5KSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgJ1VsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxyXG4gICAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxyXG4gICAgICAgICdUb3RhbCB2aXNpdGFzJzogMCxcclxuICAgICAgICAnVG90YWwgY29udGFjdG9zJzogMCxcclxuICAgICAgICAnVGlwbyBjb21lcmNpbyc6ICcnLFxyXG4gICAgICAgIExvY2FsOiAnJyxcclxuICAgICAgICBUYW1hbm86ICcnLFxyXG4gICAgICAgIEZpZGVsaWRhZDogJycsXHJcbiAgICAgICAgRXNwZWNpYWxpemFjaW9uOiAnJyxcclxuICAgICAgICAnQ2FuYWwgZGUgY29tcHJhJzogJycsXHJcbiAgICAgICAgUmVsZXZhbmNpYTogJycsXHJcbiAgICAgICAgUE9QOiAnJyxcclxuICAgICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAnJyxcclxuICAgICAgICAnVGlwbyBkZSB2ZW50YSc6ICcnLFxyXG4gICAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogJycsXHJcbiAgICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogJycsXHJcbiAgICAgICAgQ29tcGV0ZW5jaWE6ICcnLFxyXG4gICAgICAgIE9wb3J0dW5pZGFkOiAnJyxcclxuICAgICAgICAnTWFzIHZlbmRpZG8nOiAnJyxcclxuICAgICAgICAnTWFzIHByZWd1bnRhbic6ICcnLFxyXG4gICAgICAgICdBeXVkYSB0aWVuZGEnOiAnJyxcclxuICAgICAgfTtcclxuICAgIH1cclxuICAgIGNvbnN0IG0gPSBlbnRyeS5tZXJnZWQgfHwge307XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdEZlY2hhLFxyXG4gICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0VHlwZSxcclxuICAgICAgJ1RvdGFsIHZpc2l0YXMnOiBlbnRyeS52aXNpdGFzLFxyXG4gICAgICAnVG90YWwgY29udGFjdG9zJzogZW50cnkuY29udGFjdG9zLFxyXG4gICAgICAnVGlwbyBjb21lcmNpbyc6IG0udGlwbyB8fCAnJyxcclxuICAgICAgTG9jYWw6IG0ubG9jYWwgfHwgJycsXHJcbiAgICAgIFRhbWFubzogbS50YW1hbm8gfHwgJycsXHJcbiAgICAgIEZpZGVsaWRhZDogbS5maWRlbGlkYWQgfHwgJycsXHJcbiAgICAgIEVzcGVjaWFsaXphY2lvbjogbS5lc3BlY2lhbGl6YWNpb24gfHwgJycsXHJcbiAgICAgICdDYW5hbCBkZSBjb21wcmEnOiBtLmNhbmFsQ29tcHJhIHx8ICcnLFxyXG4gICAgICBSZWxldmFuY2lhOiBtLnJlbGV2YW5jaWEgIT0gbnVsbCA/IG0ucmVsZXZhbmNpYSA6ICcnLFxyXG4gICAgICBQT1A6IG0ucG9wIHx8ICcnLFxyXG4gICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiBtLm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXHJcbiAgICAgICdUaXBvIGRlIHZlbnRhJzogbS50aXBvVmVudGEgfHwgJycsXHJcbiAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogbS5wb25kZXJhY2lvbk1vc3RyYWRvICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gOiAnJyxcclxuICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogbS5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gbS5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxyXG4gICAgICBDb21wZXRlbmNpYTogbS5jb21wZXRlbmNpYSB8fCAnJyxcclxuICAgICAgT3BvcnR1bmlkYWQ6IG0ub3BvcnR1bmlkYWQgfHwgJycsXHJcbiAgICAgICdNYXMgdmVuZGlkbyc6IG0ubWFzVmVuZGlkbyB8fCAnJyxcclxuICAgICAgJ01hcyBwcmVndW50YW4nOiBtLm1hc1ByZWd1bnRhbiB8fCAnJyxcclxuICAgICAgJ0F5dWRhIHRpZW5kYSc6IG0uYXl1ZGFUaWVuZGEgfHwgJycsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxyXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxyXG4gIC8vIGVsIG1hcGEgeSBzZSBjdWVudGFuIGVuIGVsIHN0YXQgSEFCSUxJVEFET1MuIEFudGVzIGVsIG1hc3RlcmZpbGUgYmFqYWJhXHJcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xyXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xyXG4gICAgY29uc3QgbG9jYWxpdHlNYXAgPSBwLm5hbWUgfHwgJyc7XHJcbiAgICBjb25zdCBkZXB0ID0gcC5kZXB0IHx8ICcnO1xyXG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XHJcbiAgICAvLyB2MzMxOiBmaWx0cmFyIHBvciBzY29wZSBkZSB2ZW5kb3IgZGVsIHVzdWFyaW8gcXVlIGV4cG9ydGEuXHJcbiAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xyXG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcclxuICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcclxuICAgIGNvbnN0IGxhdCA9IHAubGF0ICE9IG51bGwgPyBwLmxhdCA6ICcnO1xyXG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XHJcbiAgICAvLyBTb2xvIGNsaWVudGVzIHJlZ3VsYXJlcyAobm8gcHJvc3BlY3RzLCBubyBkaXN0cmlidWlkb3JlcykgcXVlIHBhc2VuXHJcbiAgICAvLyBlbCBmaWx0cm8gaXNTYXBDb25maXJtZWQ6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi5cclxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcclxuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XHJcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICBjb25zdCBrID0gJ0N8JyArIHByb3ZpbmNlICsgJ3wnICsgbG9jYWxpdHlNYXAgKyAnfCcgKyBuYW1lO1xyXG4gICAgICAvLyBFc3RhZG86IGhhYmlsaXRhZG8vY2FuY2VsYWRvL3BlbmRpZW50ZSAobGVnYWN5IGNvbnRhY3RlZCBzZXQpLlxyXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXHJcbiAgICAgIGlmICh0eXBlb2YgY2FuY2VsZWQgIT09ICd1bmRlZmluZWQnICYmIGNhbmNlbGVkICYmIGNhbmNlbGVkLmhhcyAmJiBjYW5jZWxlZC5oYXMoaykpXHJcbiAgICAgICAgZXN0YWRvID0gJ0NhbmNlbGFkbyc7XHJcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cclxuICAgICAgY29uc3QgbWV0YSA9IHR5cGVvZiBjbGllbnRNZXRhICE9PSAndW5kZWZpbmVkJyAmJiBjbGllbnRNZXRhID8gY2xpZW50TWV0YVtrXSB8fCB7fSA6IHt9O1xyXG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xyXG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cclxuICAgICAgY29uc3QgZG9jSWQgPVxyXG4gICAgICAgIHR5cGVvZiBjbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcclxuICAgICAgY29uc3QgY21EYXRhID1cclxuICAgICAgICB0eXBlb2YgY2xpZW50TWFzdGVyQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIGRvY0lkID8gY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGRvY0lkKSB8fCB7fSA6IHt9O1xyXG4gICAgICBjb25zdCBhZGRyZXNzID0gY21EYXRhLmFkZHJlc3MgfHwgbWV0YS5hZGRyZXNzIHx8ICcnO1xyXG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGN1c3RvbUxhdCA9IG1ldGEubGF0ICE9IG51bGwgPyBtZXRhLmxhdCA6ICcnO1xyXG4gICAgICBjb25zdCBjdXN0b21MbmcgPSBtZXRhLmxuZyAhPSBudWxsID8gbWV0YS5sbmcgOiAnJztcclxuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxyXG4gICAgICBsZXQgY2FyZENvZGUgPSBjbURhdGEuc2FwQ2FyZENvZGUgfHwgJyc7XHJcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XHJcbiAgICAgICAgY29uc3QgYWx0YXMgPSBhcHByb3ZlZEFsdGFzQnlMb2Nba2V5XSB8fCBbXTtcclxuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiAoYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8ICcnKSA9PT0gbmFtZSk7XHJcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XHJcbiAgICAgIH1cclxuICAgICAgcm93cy5wdXNoKFxyXG4gICAgICAgIE9iamVjdC5hc3NpZ24oXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBjYXJkQ29kZSxcclxuICAgICAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBuYW1lLFxyXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6IGN1c3RvbU5hbWUsXHJcbiAgICAgICAgICAgIFRpcG86ICdDbGllbnRlIGFjdHVhbCcsXHJcbiAgICAgICAgICAgIEVzdGFkbzogZXN0YWRvLFxyXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdmluY2UpIDogcHJvdmluY2UsXHJcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jYWxpdHlNYXAsXHJcbiAgICAgICAgICAgIERlcGFydGFtZW50bzogZGVwdCxcclxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXHJcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXHJcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcclxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxyXG4gICAgICAgICAgICBEaXJlY2Npb246IGFkZHJlc3MsXHJcbiAgICAgICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jYWxpdHlDdXN0LFxyXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGN1c3RvbUxhdCB8fCBsYXQsXHJcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogY3VzdG9tTG5nIHx8IGxvbixcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpXHJcbiAgICAgICAgKVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgLy8gSW55ZWN0YXIgYWx0YXMgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyAoYXBwcm92ZWRBbHRhc0xpc3QpOlxyXG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXHJcbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxyXG4gIC8vICAgICBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLiBWYW4gY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuIFNlXHJcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xyXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXHJcbiAgLy8gICAgIExvcyBwcm92aXNvcmlvcyBwdWVkZW4gbm8gdGVuZXIgZGlyZWNjaW9uIHRvZGF2aWEgLT4gc2UgYWNlcHRhbiBpZ3VhbC5cclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIHJvd3MuZm9yRWFjaCgocikgPT5cclxuICAgIHNlZW4uYWRkKFxyXG4gICAgICAoci5Qcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKSArICd8JyArIChyWydOb21icmUgdGllbmRhJ10gfHwgJycpLnRvTG93ZXJDYXNlKClcclxuICAgIClcclxuICApO1xyXG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xyXG4gICAgYXBwcm92ZWRBbHRhc0xpc3QuZm9yRWFjaCgoYSkgPT4ge1xyXG4gICAgICBpZiAoIWEpIHJldHVybjtcclxuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XHJcbiAgICAgIC8vIEhhYmlsaXRhZG9zOiBzaWd1ZW4gZXhpZ2llbmRvIGNhcmRDb2RlICsgZGlyZWNjaW9uIChjb21wb3J0YW1pZW50byBwcmUtdjMxMSkuXHJcbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXHJcbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XHJcbiAgICAgICAgaWYgKCFhLmNhcmRDb2RlU2FwKSByZXR1cm47XHJcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgcHJvdiA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKTtcclxuICAgICAgY29uc3Qgbm9tYnJlID1cclxuICAgICAgICBhLmNvbWVyY2lvIHx8XHJcbiAgICAgICAgYS5mYW50YXNpYSB8fFxyXG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xyXG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcclxuICAgICAgaWYgKHNlZW4uaGFzKGR1cEtleSkpIHJldHVybjtcclxuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcclxuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcclxuICAgICAgLy8gdjMzMTogbWlzbW8gZmlsdHJvIGRlIHNjb3BlIGFwbGljYSBhIGFsdGFzIFNBUC9wcm92aXNvcmlhcy5cclxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcclxuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcclxuICAgICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xyXG4gICAgICByb3dzLnB1c2goXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGEuY2FyZENvZGVTYXAgfHwgJycsXHJcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxyXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxyXG4gICAgICAgICAgICBUaXBvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbyAoQWx0YSByYXBpZGEpJyA6ICdDbGllbnRlIGFjdHVhbCcsXHJcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxyXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxyXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvYyxcclxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcclxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXHJcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXHJcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcclxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxyXG4gICAgICAgICAgICBEaXJlY2Npb246IGEuY2FsbGUgfHwgYS5hZGRyZXNzIHx8ICcnLFxyXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcclxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcclxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBhLmxuZyAhPSBudWxsID8gYS5sbmcgOiAnJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSlcclxuICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcclxuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcclxuICAgIGNvbnN0IGwgPSAoYVsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJyk7XHJcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XHJcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xyXG4gIH0pO1xyXG5cclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xyXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXHJcbiAgICAgICAgJyAgKiBIYWJpbGl0YWRvcyBlbiBTQVAgKGNhcmRDb2RlICsgZGlyZWNjaW9uIGNhcmdhZG9zKS5cXG4nICtcclxuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xyXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE2IH0sIC8vIENhcmRDb2RlIFNBUFxyXG4gICAgeyB3Y2g6IDM4IH0sIC8vIE5vbWJyZSB0aWVuZGFcclxuICAgIHsgd2NoOiAyOCB9LCAvLyBBbGlhc1xyXG4gICAgeyB3Y2g6IDE0IH0sIC8vIFRpcG9cclxuICAgIHsgd2NoOiAxNCB9LCAvLyBFc3RhZG9cclxuICAgIHsgd2NoOiAyMiB9LCAvLyBQcm92aW5jaWFcclxuICAgIHsgd2NoOiAyMiB9LCAvLyBMb2NhbGlkYWQgbWFwYVxyXG4gICAgeyB3Y2g6IDIyIH0sIC8vIERlcGFydGFtZW50b1xyXG4gICAgeyB3Y2g6IDI4IH0sIC8vIFZlbmRlZG9yIGV4dGVybm9cclxuICAgIHsgd2NoOiA4IH0sIC8vIFpvbmFcclxuICAgIHsgd2NoOiA0OCB9LCAvLyBFdGlxdWV0YSB6b25hXHJcbiAgICB7IHdjaDogMjggfSwgLy8gQXNlc29yIGludGVybm9cclxuICAgIHsgd2NoOiAzOCB9LCAvLyBEaXJlY2Npb25cclxuICAgIHsgd2NoOiAyNCB9LCAvLyBMb2NhbGlkYWQgZGVjbGFyYWRhXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gTGF0XHJcbiAgICB7IHdjaDogMTQgfSwgLy8gTG5nXHJcbiAgICAvLyB2NDUwOiBjbGFzaWZpY2FjaW9uIGRlc2RlIHZpc2l0cy9jb250YWN0b3MuXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gVWx0aW1hIGludGVyYWNjaW9uXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gVGlwbyB1bHRpbWEgaW50ZXJhY2Npb25cclxuICAgIHsgd2NoOiAxMCB9LCAvLyBUb3RhbCB2aXNpdGFzXHJcbiAgICB7IHdjaDogMTAgfSwgLy8gVG90YWwgY29udGFjdG9zXHJcbiAgICB7IHdjaDogMTggfSwgLy8gVGlwbyBjb21lcmNpb1xyXG4gICAgeyB3Y2g6IDE2IH0sIC8vIExvY2FsXHJcbiAgICB7IHdjaDogMTIgfSwgLy8gVGFtYW5vXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gRmlkZWxpZGFkXHJcbiAgICB7IHdjaDogMjAgfSwgLy8gRXNwZWNpYWxpemFjaW9uXHJcbiAgICB7IHdjaDogMjAgfSwgLy8gQ2FuYWwgZGUgY29tcHJhXHJcbiAgICB7IHdjaDogMTAgfSwgLy8gUmVsZXZhbmNpYVxyXG4gICAgeyB3Y2g6IDggfSwgLy8gUE9QXHJcbiAgICB7IHdjaDogMjYgfSwgLy8gTmVjZXNpZGFkIHB1bnR1YWxcclxuICAgIHsgd2NoOiAxNiB9LCAvLyBUaXBvIGRlIHZlbnRhXHJcbiAgICB7IHdjaDogMTggfSwgLy8gUG9uZGVyYWNpb24gbW9zdHJhZG9yXHJcbiAgICB7IHdjaDogMTggfSwgLy8gUG9uZGVyYWNpb24gZS1jb21tZXJjZVxyXG4gICAgeyB3Y2g6IDI2IH0sIC8vIENvbXBldGVuY2lhXHJcbiAgICB7IHdjaDogMjYgfSwgLy8gT3BvcnR1bmlkYWRcclxuICAgIHsgd2NoOiAyMiB9LCAvLyBNYXMgdmVuZGlkb1xyXG4gICAgeyB3Y2g6IDIyIH0sIC8vIE1hcyBwcmVndW50YW5cclxuICAgIHsgd2NoOiAyNiB9LCAvLyBBeXVkYSB0aWVuZGFcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQ2xpZW50ZXMgaGFiaWxpdGFkb3MgU0FQJyk7XHJcblxyXG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxyXG4gIGNvbnN0IGJ5Wm9uZSA9IHt9O1xyXG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xyXG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xyXG4gICAgaWYgKCFieVpvbmVbel0pIGJ5Wm9uZVt6XSA9IHsgdG90YWw6IDAsIGhhYmlsaXRhZG9zOiAwLCBjYW5jZWxhZG9zOiAwIH07XHJcbiAgICBieVpvbmVbel0udG90YWwrKztcclxuICAgIGlmIChyLkVzdGFkbyA9PT0gJ0hhYmlsaXRhZG8nKSBieVpvbmVbel0uaGFiaWxpdGFkb3MrKztcclxuICAgIGVsc2UgaWYgKHIuRXN0YWRvID09PSAnQ2FuY2VsYWRvJykgYnlab25lW3pdLmNhbmNlbGFkb3MrKztcclxuICB9KTtcclxuICBjb25zdCByZXN1bWVuUm93cyA9IE9iamVjdC5lbnRyaWVzKGJ5Wm9uZSlcclxuICAgIC5tYXAoKFt6LCBkXSkgPT4gKHtcclxuICAgICAgJ1pvbmEgLyBWZW5kZWRvcic6IHosXHJcbiAgICAgICdUb3RhbCB0aWVuZGFzJzogZC50b3RhbCxcclxuICAgICAgSGFiaWxpdGFkYXM6IGQuaGFiaWxpdGFkb3MsXHJcbiAgICAgIENhbmNlbGFkYXM6IGQuY2FuY2VsYWRvcyxcclxuICAgIH0pKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XHJcbiAgY29uc3Qgd3NSZXMgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocmVzdW1lblJvd3MpO1xyXG4gIHdzUmVzWychY29scyddID0gW3sgd2NoOiA0OCB9LCB7IHdjaDogMTQgfSwgeyB3Y2g6IDE0IH0sIHsgd2NoOiAxNCB9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1JlcywgJ1Jlc3VtZW4gcG9yIHpvbmEnKTtcclxuXHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIC8vIHYzMzE6IHN1ZmlqbyBjb24gZWwgc2NvcGUgYXBsaWNhZG8gcGFyYSBkaWZlcmVuY2lhciBlbCBhcmNoaXZvIGRlbCBWREUvVkRJXHJcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxyXG4gIGNvbnN0IHNjb3BlTGJsID1cclxuICAgIHNjb3BlU2V0ID09PSBudWxsXHJcbiAgICAgID8gJ1RPRE9TJ1xyXG4gICAgICA6IHNjb3BlU2V0LnNpemUgPT09IDFcclxuICAgICAgICA/IFsuLi5zY29wZVNldF1bMF0uc3BsaXQoJyAnKVswXVxyXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcclxuICBjb25zdCBmbmFtZSA9ICdNYXN0ZXJmaWxlX0NsaWVudGVzX1NBUF8nICsgc2NvcGVMYmwgKyAnXycgKyB0cyArICcueGxzeCc7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsIGZuYW1lKTtcclxuICBzaG93U3luY1RhZyhcclxuICAgIHJvd3MubGVuZ3RoICtcclxuICAgICAgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArXHJcbiAgICAgIChzY29wZVNldCA9PT0gbnVsbCA/ICcnIDogJyAoc2NvcGU6ICcgKyBbLi4uc2NvcGVTZXRdLmpvaW4oJywgJykgKyAnKScpXHJcbiAgKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcclxuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcclxuLy8gRmlyZXN0b3JlKSB5IFNUT0NLX01BUCAoYm9vbGVhbm8gcG9yIFNLVSBkZWwgc3RvY2suanNvbiBkZWwgcmVwbykuXHJcbi8vIEhvamFzOlxyXG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXHJcbi8vICAgIChsbyBtYXMgY29tdW4gcGFyYSByZXZpc2FyIGRpc3BvbmliaWxpZGFkICsgcHJlY2lvKS5cclxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXHJcbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cclxuLy8gIC0gXCJJbmZvXCI6IGZlY2hhIGRlIGxvcyBzbmFwc2hvdHMgeSBmdWVudGVzLlxyXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghQXJyYXkuaXNBcnJheShQUk9EVUNUUykgfHwgIVBST0RVQ1RTLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBjYXRhbG9nbyBkZSBwcm9kdWN0b3MgY2FyZ2FkbyB0b2RhdmlhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIHByZWNpb3MgKyBzdG9jay4uLicpO1xyXG4gIC8vIEhlbHBlciBkZSBmb3JtYXRvIGRlIHN0b2NrIHBhcmEgcXVlIHNlYSBsZWdpYmxlIGVuIEV4Y2VsLlxyXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xyXG4gICAgY29uc3QgdiA9IHR5cGVvZiBoYXNTdG9jayA9PT0gJ2Z1bmN0aW9uJyA/IGhhc1N0b2NrKHNrdSkgOiBudWxsO1xyXG4gICAgaWYgKHYgPT09IHRydWUpIHJldHVybiAnRGlzcG9uaWJsZSc7XHJcbiAgICBpZiAodiA9PT0gZmFsc2UpIHJldHVybiAnU2luIHN0b2NrJztcclxuICAgIHJldHVybiAnU2luIGRhdG8nO1xyXG4gIH1cclxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XHJcbiAgICBjb25zdCBwID0gdHlwZW9mIFBSSUNFX0xJU1RfTUFQID09PSAnb2JqZWN0JyAmJiBQUklDRV9MSVNUX01BUCA/IFBSSUNFX0xJU1RfTUFQW3NrdV0gOiBudWxsO1xyXG4gICAgaWYgKHAgPT0gbnVsbCkgcmV0dXJuICcnO1xyXG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xyXG4gIH1cclxuICAvLyBIb2phIDE6IGNvbWJvIGNvbXBsZXRvIChlcyBsYSBtYXMgcGVkaWRhKS5cclxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXHJcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxyXG4gICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXHJcbiAgICBTdWJmYW1pbGlhOiBwLnN1YiB8fCAnJyxcclxuICAgIENhdGVnb3JpYTogcC5jYXQgfHwgJycsXHJcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxyXG4gICAgJ1N0b2NrIFcxMSc6IGZtdFN0b2NrKHAuY29kZSksXHJcbiAgfSkpLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogNjAgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgXTtcclxuICAvLyBBcGxpY2FyIGZvcm1hdG8gbW9uZWRhIGEgbGEgY29sdW1uYSBQcmVjaW8gQVJTIChjb2x1bW5hIEYgPSA2KS5cclxuICBmb3IgKGxldCBpID0gMjsgaSA8PSByb3dzLmxlbmd0aCArIDE7IGkrKykge1xyXG4gICAgY29uc3QgY2VsbCA9IHdzWydGJyArIGldO1xyXG4gICAgaWYgKGNlbGwgJiYgdHlwZW9mIGNlbGwudiA9PT0gJ251bWJlcicpIGNlbGwueiA9ICdcIiRcIiMsIyMwJztcclxuICB9XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdQcmVjaW9zIHkgU3RvY2snKTtcclxuXHJcbiAgLy8gSG9qYSAyOiBzb2xvIFByZWNpb3NcclxuICBjb25zdCBwcmVjaW9zUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcclxuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxyXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcclxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXHJcbiAgfSkpXHJcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdzUCA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChwcmVjaW9zUm93cyk7XHJcbiAgd3NQWychY29scyddID0gW3sgd2NoOiAxNCB9LCB7IHdjaDogNjAgfSwgeyB3Y2g6IDE0IH1dO1xyXG4gIGZvciAobGV0IGkgPSAyOyBpIDw9IHByZWNpb3NSb3dzLmxlbmd0aCArIDE7IGkrKykge1xyXG4gICAgY29uc3QgY2VsbCA9IHdzUFsnQycgKyBpXTtcclxuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XHJcbiAgfVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUCwgJ1ByZWNpb3MnKTtcclxuXHJcbiAgLy8gSG9qYSAzOiBzb2xvIFN0b2NrXHJcbiAgY29uc3Qgc3RvY2tSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXHJcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxyXG4gICAgJ1N0b2NrIFcxMSc6IGZtdFN0b2NrKHAuY29kZSksXHJcbiAgfSkpLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xyXG4gIGNvbnN0IHdzUyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChzdG9ja1Jvd3MpO1xyXG4gIHdzU1snIWNvbHMnXSA9IFt7IHdjaDogMTQgfSwgeyB3Y2g6IDYwIH0sIHsgd2NoOiAxNCB9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1MsICdTdG9jaycpO1xyXG5cclxuICAvLyBIb2phIDQ6IG1ldGFkYXRhIC0gY3VhbmRvIGZ1ZSBjYWRhIHNuYXBzaG90IHBhcmEgcXVlIGVsIGxlY3RvciBzZXBhXHJcbiAgLy8gc2kgbGEgbGlzdGEgZXN0YSBmcmVzY2EuXHJcbiAgY29uc3QgaW5mb1Jvd3MgPSBbXHJcbiAgICB7IEl0ZW06ICdUb3RhbCBTS1VzIGVuIGNhdGFsb2dvJywgVmFsb3I6IFBST0RVQ1RTLmxlbmd0aCB9LFxyXG4gICAgeyBJdGVtOiAnVG90YWwgU0tVcyBjb24gcHJlY2lvIGNhcmdhZG8nLCBWYWxvcjogcHJlY2lvc1Jvd3MubGVuZ3RoIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIGNvbiBzdG9jayBkaXNwb25pYmxlJyxcclxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gdHJ1ZSkubGVuZ3RoLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ1RvdGFsIFNLVXMgc2luIHN0b2NrJyxcclxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PT0gZmFsc2UpLmxlbmd0aCxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIHNpbiBkYXRvIGRlIHN0b2NrJyxcclxuICAgICAgVmFsb3I6IFBST0RVQ1RTLmZpbHRlcigocCkgPT4gaGFzU3RvY2socC5jb2RlKSA9PSBudWxsKS5sZW5ndGgsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnTGlzdGEgZGUgcHJlY2lvcyBtb25lZGEnLFxyXG4gICAgICBWYWxvcjogdHlwZW9mIFBSSUNFX0xJU1RfQ1VSUkVOQ1kgIT09ICd1bmRlZmluZWQnID8gUFJJQ0VfTElTVF9DVVJSRU5DWSA6ICdBUlMnLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgYWN0dWFsaXphZGEnLFxyXG4gICAgICBWYWxvcjpcclxuICAgICAgICB0eXBlb2YgUFJJQ0VfTElTVF9VUERBVEVEX0FUICE9PSAndW5kZWZpbmVkJyAmJiBQUklDRV9MSVNUX1VQREFURURfQVRcclxuICAgICAgICAgID8gbmV3IERhdGUoUFJJQ0VfTElTVF9VUERBVEVEX0FUKS50b0xvY2FsZVN0cmluZygnZXMtQVInKVxyXG4gICAgICAgICAgOiAnKG5vIGNhcmdhZGEpJyxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdTdG9jayBzbmFwc2hvdCBhY3R1YWxpemFkbycsXHJcbiAgICAgIFZhbG9yOiBTVE9DS19VUERBVEVEX0FUID8gbmV3IERhdGUoU1RPQ0tfVVBEQVRFRF9BVCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgOiAnKG5vIGNhcmdhZG8pJyxcclxuICAgIH0sXHJcbiAgICB7IEl0ZW06ICdFeHBvcnRhZG8nLCBWYWxvcjogbmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnRXhwb3J0YWRvIHBvcicsXHJcbiAgICAgIFZhbG9yOiAoY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lKSkgfHwgJyhkZXNjb25vY2lkbyknLFxyXG4gICAgfSxcclxuICBdO1xyXG4gIGNvbnN0IHdzSSA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChpbmZvUm93cyk7XHJcbiAgd3NJWychY29scyddID0gW3sgd2NoOiAzNiB9LCB7IHdjaDogMzYgfV07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NJLCAnSW5mbycpO1xyXG5cclxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdQcmVjaW9zX3lfU3RvY2tfJyArIHRzICsgJy54bHN4Jyk7XHJcbiAgc2hvd1N5bmNUYWcocm93cy5sZW5ndGggKyAnIFNLVXMgZXhwb3J0YWRvcyAocHJlY2lvcyArIHN0b2NrKScpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEVYUE9SVCAtIGRpYWxvZ28gZGUgc2VsZWNjaW9uICsgMyBmb3JtYXRvc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxud2luZG93LmV4cG9ydFRvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRmlsdHJhciBvcGNpb25lcyBzZWd1biByb2wuXHJcbiAgLy8gICB2ZW5kZWRvcjogb3BlcmF0aXZvIGRpYXJpbyAoVmVudGFzIC8gVmlzaXRhcyAvIFJ1dGFzKSArIENsaWVudGVzIGRlIHN1IHpvbmFcclxuICAvLyAgICAgKGV4cG9ydE1hc3RlckNsaWVudGVzIHlhIGZpbHRyYSBwb3IgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0IC0+IHNvbG8gc3UgdmVuZG9yKS5cclxuICAvLyAgIGludGVybm8gKFZESSk6IG1pc21vIHNjb3BlIG9wZXJhdGl2byArIENsaWVudGVzIGRlIHN1cyBwYXJlamFzIChvIHNvbG8gZWxcclxuICAvLyAgICAgcHJvcGlvIHNpIGVsaWdpbyBzdSBub21icmUgZW4gZWwgZHJvcGRvd24gZGUgem9uYXMpLlxyXG4gIC8vICAgYWRtaW4gLyBnZXJlbnRlIC8gdmlld2VyOiB2ZW4gdG9kbyBlbCBsaXN0YWRvIChudWxsID0gc2luIGZpbHRybykuXHJcbiAgY29uc3QgYWxsb3dlZEJ5Um9sZSA9IHtcclxuICAgIHZlbmRlZG9yOiBuZXcgU2V0KFsnVkVOVEFTJywgJ1ZJU0lUQVMnLCAnUlVUQVMnLCAnTUFTVEVSJ10pLFxyXG4gICAgaW50ZXJubzogbmV3IFNldChbJ1ZFTlRBUycsICdWSVNJVEFTJywgJ1JVVEFTJywgJ01BU1RFUiddKSxcclxuICB9O1xyXG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cclxuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcclxuICAgIGNvbnN0IGtpbmQgPSBlbC5kYXRhc2V0LmV4cEtpbmQgfHwgJyc7XHJcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCkgPyAnJyA6ICdub25lJztcclxuICB9KTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VFeHBvcnREaWFsb2cgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xyXG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XHJcbiAgVkVOVEFTOiAnVmVudGFzJyxcclxuICBWSVNJVEFTOiAnVmlzaXRhcycsXHJcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXHJcbiAgUlVUQVM6ICdSdXRhcycsXHJcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXHJcbn07XHJcblxyXG53aW5kb3cuc2hvd01vbnRoUGlja2VyID0gZnVuY3Rpb24gKHRpcG8pIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XHJcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tdGl0bGUnKTtcclxuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXN1YnQnKTtcclxuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcclxuICBzdWJ0LnRleHRDb250ZW50ID0gJ0VsZWdpIGVsIG1lcyB5IGFcdTAwRjFvIHF1ZSBxdWVyZXMgZGVzY2FyZ2FyLic7XHJcbiAgLy8gUG9wdWxhdGUgc2VsZWN0c1xyXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgbWVzU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpO1xyXG4gIG1lc1NlbC5pbm5lckhUTUwgPVxyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcclxuICAgIE1FU0VTLm1hcCgobSwgaSkgPT4gJzxvcHRpb24gdmFsdWU9XCInICsgaSArICdcIj4nICsgbSArICc8L29wdGlvbj4nKS5qb2luKCcnKTtcclxuICBtZXNTZWwudmFsdWUgPSBub3cuZ2V0TW9udGgoKTtcclxuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcclxuICBjb25zdCB5ZWFyID0gbm93LmdldEZ1bGxZZWFyKCk7XHJcbiAgbGV0IHlvcHRzID0gJyc7XHJcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXHJcbiAgICB5b3B0cyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyB5ICsgJ1wiPicgKyB5ICsgJzwvb3B0aW9uPic7XHJcbiAgYW5pb1NlbC5pbm5lckhUTUwgPSB5b3B0cztcclxuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XHJcbn07XHJcblxyXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHRpcG8gPSBwZW5kaW5nRXhwb3J0VHlwZTtcclxuICBjb25zdCBtZXNSYXcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJykudmFsdWU7XHJcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcclxuICBjb25zdCBtb250aElkeCA9IG1lc1JhdyA9PT0gJ0FMTCcgPyBudWxsIDogcGFyc2VJbnQobWVzUmF3LCAxMCk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XHJcbiAgaWYgKCF0aXBvKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZJU0lUQVMnKSBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JFTkRJQ0lPTkVTJykgZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdBTFRBUycpIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydCAnICsgdGlwbywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGV4cG9ydDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHJldHVybiBTdHJpbmcoYW5pbyk7XHJcbiAgcmV0dXJuIE1FU0VTW21vbnRoSWR4XSArICdfJyArIGFuaW87XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzKSB7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgZm9yIChjb25zdCBzIG9mIHNoZWV0cykge1xyXG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXHJcbiAgICAgIHMucm93cy5sZW5ndGggPyBzLnJvd3MgOiBbeyBBdmlzbzogJ1NpbiBkYXRvcyBwYXJhIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvJyB9XVxyXG4gICAgKTtcclxuICAgIGlmIChzLnJvd3MubGVuZ3RoKSB7XHJcbiAgICAgIGNvbnN0IGNvbHMgPSBPYmplY3Qua2V5cyhzLnJvd3NbMF0pLm1hcCgoaykgPT4gKHtcclxuICAgICAgICB3Y2g6IE1hdGgubWluKDQwLCBNYXRoLm1heCgxMCwgay5sZW5ndGggKyA0KSksXHJcbiAgICAgIH0pKTtcclxuICAgICAgd3NbJyFjb2xzJ10gPSBjb2xzO1xyXG4gICAgfVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsIHMubmFtZS5zbGljZSgwLCAzMSkpO1xyXG4gIH1cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgZmlsZW5hbWUpO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcGVkaWRvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCBwID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBpZiAocGFyc2VJbnQocC55ZWFyLCAxMCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICBjb25zdCBsaW5lcyA9IHAubGluZXMgfHwgW107XHJcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgcmV0dXJuO1xyXG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcclxuICAgIGNvbnN0IHZlbmRvckluZm8gPSB2ZW5kb3JMb29rdXBbdmVuZG9yS2V5XSB8fCB7fTtcclxuICAgIGNvbnN0IGZhY3RvciA9IHR5cGVvZiBwZWRpZG9EaXNjb3VudEZhY3RvciA9PT0gJ2Z1bmN0aW9uJyA/IHBlZGlkb0Rpc2NvdW50RmFjdG9yKHApIDogMTtcclxuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcclxuICAgIGxpbmVzLmZvckVhY2goKGwpID0+IHtcclxuICAgICAgY29uc3QgcXR5ID0gcGFyc2VGbG9hdChsLnF0eSkgfHwgMDtcclxuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcclxuICAgICAgY29uc3QgZ3Jvc3MgPSBxdHkgKiBwcmVjaW87XHJcbiAgICAgIGNvbnN0IG5ldCA9IGdyb3NzICogZmFjdG9yO1xyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcclxuICAgICAgICBGZWNoYV9Db25maXJtYWRvOiBwLmNvbmZpcm1lZEF0ID8gU3RyaW5nKHAuY29uZmlybWVkQXQpLnNsaWNlKDAsIDEwKSA6ICcnLFxyXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvcktleSB8fCAnJyksXHJcbiAgICAgICAgWm9uYTogdmVuZG9ySW5mby56b25lIHx8ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCAnJyxcclxuICAgICAgICBDYXRlZ29yaWE6IGwuY2F0IHx8ICcnLFxyXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxyXG4gICAgICAgIFN1YmZhbWlsaWE6IGwuc3ViIHx8ICcnLFxyXG4gICAgICAgIENhbnRpZGFkOiBxdHksXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXHJcbiAgICAgICAgLy8gU3VidG90YWxfQVJTID0gTkVUTyAoY29uIGRlc2N1ZW50byBhcGxpY2FkbykgLSBlcyBsbyBxdWUgY3VlbnRhXHJcbiAgICAgICAgLy8gcGFyYSBlbCB0YXJnZXQgZGVsIHZlbmRlZG9yLiBTdWJ0b3RhbF9CcnV0b19BUlMgbXVlc3RyYSBlbCB2YWxvclxyXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXHJcbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKG5ldCksXHJcbiAgICAgICAgU3VidG90YWxfQnJ1dG9fQVJTOiBNYXRoLnJvdW5kKGdyb3NzKSxcclxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxyXG4gICAgICAgIEVuX05vbWJyZV9EZV9WREU6IHAub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxyXG4gICAgICAgIENhcmdhZG9fUG9yOiBwLmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHAuY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnVmVudGFzJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBWZW50YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBsb29rdXBWZW5kb3JGb3JDbGllbnQocHJvdiwgbG9jTmFtZSwgX2NsaWVudE5hbWUpIHtcclxuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcclxuICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92ICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XHJcbiAgcmV0dXJuIHB0ID8gcHQudmVuZG9yIHx8ICcnIDogJyc7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gdmlzaXRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCB0YXJnZXRNZXMgPSBtb250aElkeCAhPT0gbnVsbCA/IE1FU0VTW21vbnRoSWR4XS50b1VwcGVyQ2FzZSgpIDogbnVsbDtcclxuICBjb25zdCBpdGVtcyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgdiA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAodGFyZ2V0TWVzICYmICh2Lm1lcyB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdGFyZ2V0TWVzKSByZXR1cm47XHJcbiAgICBpdGVtcy5wdXNoKHYpO1xyXG4gIH0pO1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgbmkgY29udGFjdG9zIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBuVmlzaXRhcyA9IGl0ZW1zLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aDtcclxuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XHJcbiAgLy8gRXhjZWxKUyBjb24gZm90byBkZWwgZnJlbnRlIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gTGF6eSBsb2FkLlxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbDogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3Rvcy4uLicsIDMwMDApO1xyXG5cclxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XHJcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcclxuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcclxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnVmlzaXRhcyB5IENvbnRhY3RvcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xyXG4gIHdzLmNvbHVtbnMgPSBbXHJcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0FuaW8nLCBrZXk6ICdhbmlvJywgd2lkdGg6IDggfSxcclxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0ludGVyYWNjaW9uJywga2V5OiAnaW50ZXJhY2Npb24nLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnRm9ybWEgQ29udGFjdG8nLCBrZXk6ICdmb3JtYUNvbnRhY3RvJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1Jlc3VsdGFkbyBDb250YWN0bycsIGtleTogJ3Jlc3VsdGFkb0N0Jywgd2lkdGg6IDE2IH0sXHJcbiAgICB7IGhlYWRlcjogJ0NvbWVudGFyaW8nLCBrZXk6ICdjb21lbnQnLCB3aWR0aDogMzAgfSxcclxuICAgIHsgaGVhZGVyOiAnUHJvdmluY2lhJywga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2IH0sXHJcbiAgICB7IGhlYWRlcjogJ0xvY2FsaWRhZCcsIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaWVuZGEnLCBrZXk6ICd0aWVuZGEnLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnTG9jYWwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdUYW1hbm8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnRmlkZWxpZGFkJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1JlbGV2YW5jaWEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdOZWNlc2lkYWQgUHVudHVhbCcsIGtleTogJ25lYycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPcG9ydHVuaWRhZCcsIGtleTogJ29wb3J0dScsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdNYXMgVmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ01hcyBQcmVndW50YW4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBeXVkYSBUaWVuZGEnLCBrZXk6ICdheXVkYScsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvIFZlbnRhJywga2V5OiAndGlwb1ZlbnRhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BvbmQgTW9zdHJhZG9yJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUG9uZCBFY29tbWVyY2UnLCBrZXk6ICdwRWNvbScsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb21wZXRlbmNpYScsIGtleTogJ2NvbXBlJywgd2lkdGg6IDE2IH0sXHJcbiAgICB7IGhlYWRlcjogJ0dQUyBTdGF0dXMnLCBrZXk6ICdncHNTdCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdHUFMgRGlzdCAobSknLCBrZXk6ICdncHNEaXN0Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ZvdG8gZnJlbnRlJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdFbiBub21icmUgZGUgVkRFJywga2V5OiAnb25CZWhhbGYnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnQ2FyZ2FkbyBQb3InLCBrZXk6ICdjcmVhdGVkQnknLCB3aWR0aDogMjQgfSxcclxuICBdO1xyXG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcclxuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XHJcblxyXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7XHJcbiAgY29uc3QgUk9XX0ggPSAxMDA7XHJcbiAgY29uc3QgSU1HX1cgPSAxMzA7XHJcbiAgY29uc3QgSU1HX0ggPSA5MDtcclxuXHJcbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xyXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcclxuXHJcbiAgZm9yIChjb25zdCB2IG9mIGl0ZW1zKSB7XHJcbiAgICBjb25zdCBpc0NvbnRhY3RvID0gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0byc7XHJcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XHJcbiAgICBjb25zdCBmb3JtYUNvbnRhY3RvTGJsID0gaXNDb250YWN0byA/IHYuZm9ybWFDb250YWN0byB8fCAnU2luIGVzcGVjaWZpY2FyJyA6ICdQcmVzZW5jaWFsJztcclxuICAgIGxldCByZXN1bHRhZG9DdExibCA9ICcnO1xyXG4gICAgaWYgKGlzQ29udGFjdG8pIHtcclxuICAgICAgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdyZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdSZXNwb25kaW8nO1xyXG4gICAgICBlbHNlIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAnbm9fcmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnTm8gcmVzcG9uZGlvJztcclxuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcclxuICAgIH1cclxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XHJcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxyXG4gICAgICBtZXM6IHYubWVzIHx8ICcnLFxyXG4gICAgICBhbmlvOiB2LmFuaW8gfHwgJycsXHJcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxyXG4gICAgICBlbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBpbnRlcmFjY2lvbjogaW50ZXJhY2Npb25MYmwsXHJcbiAgICAgIGZvcm1hQ29udGFjdG86IGZvcm1hQ29udGFjdG9MYmwsXHJcbiAgICAgIHJlc3VsdGFkb0N0OiByZXN1bHRhZG9DdExibCxcclxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXHJcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgICAgbG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcclxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcclxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxyXG4gICAgICBsb2NhbDogdi5sb2NhbCB8fCAnJyxcclxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcclxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgcmVsZXY6IHYucmVsZXZhbmNpYSB8fCAnJyxcclxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcclxuICAgICAgbmVjOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXHJcbiAgICAgIG9wb3J0dTogdi5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgbWFzVmU6IHYubWFzVmVuZGlkbyB8fCAnJyxcclxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxyXG4gICAgICBheXVkYTogdi5heXVkYVRpZW5kYSB8fCAnJyxcclxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXHJcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXHJcbiAgICAgIHBFY29tOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIHx8ICcnLFxyXG4gICAgICBjb21wZTogdi5jb21wZXRlbmNpYSB8fCAnJyxcclxuICAgICAgZ3BzU3Q6IHYuZ3BzU3RhdHVzIHx8ICcnLFxyXG4gICAgICBncHNEaXN0OiB2Lmdwc0Rpc3RhbmNlTSAhPSBudWxsID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcclxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gaW1hZ2VuIGVuY2ltYVxyXG4gICAgICBvbkJlaGFsZjogdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgIGNyZWF0ZWRCeTogdi5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCB2LmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XHJcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XHJcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcclxuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xyXG4gICAgICAgIGlmIChtKSB7XHJcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICBiNjQgPSBtWzJdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxyXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byB2aXNpdGEnLCBlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19WaXNpdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgIGEuY2xpY2soKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IGxpc3RvOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zJywgMjQwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcmVuZGljaW9uZXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRmlsdHJhciBwb3IgbWVzL2FuaW9cclxuICBjb25zdCBpdGVtcyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgciA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XHJcbiAgICBpZiAoIWR0ICYmIHIuY3JlYXRlZEF0ICYmIHIuY3JlYXRlZEF0LnRvRGF0ZSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfVxyXG4gICAgaWYgKCFkdCkgcmV0dXJuO1xyXG4gICAgY29uc3QgZE9iaiA9IG5ldyBEYXRlKGR0KTtcclxuICAgIGlmIChOdW1iZXIuaXNOYU4oZE9iai5nZXRUaW1lKCkpKSByZXR1cm47XHJcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZE9iai5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgaXRlbXMucHVzaCh7IGlkOiBkLmlkLCBmZWNoYTogZHQsIHI6IHIgfSk7XHJcbiAgfSk7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgcmVuZGljaW9uZXMgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBDYXJnYSBsYXp5LlxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcclxuXHJcbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XHJcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1JlbmRpY2lvbmVzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XHJcbiAgd3MuY29sdW1ucyA9IFtcclxuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXHJcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnQ29uY2VwdG8nLCBrZXk6ICdjb25jZXB0bycsIHdpZHRoOiAxOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdOIFRpY2tldCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdNb2RvIHBhZ28nLCBrZXk6ICdtb2RvUGFnbycsIHdpZHRoOiAxNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvIGdhc3RvJywga2V5OiAndGlwb0dhc3RvJywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ0RpdmlzaW9uJywga2V5OiAnZGl2aXNpb24nLCB3aWR0aDogMTQgfSxcclxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZScsIGtleTogJ2ltcG9ydGUnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnTW9uZWRhJywga2V5OiAnbW9uZWRhJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUgVVNEJywga2V5OiAnaW1wb3J0ZVVzZCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPYnNlcnZhY2lvbmVzJywga2V5OiAnb2JzJywgd2lkdGg6IDMwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ZvdG8gdGlja2V0Jywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdFc3RhZG8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcclxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG9yJywga2V5OiAnYXByb2JhZG9yJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvIGVuJywga2V5OiAnYXByb2JhZG9FbicsIHdpZHRoOiAxNCB9LFxyXG4gIF07XHJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGN0UyMkNFJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xyXG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcclxuXHJcbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcclxuICBjb25zdCBST1dfSCA9IDExMDtcclxuICBjb25zdCBJTUdfVyA9IDE0MDtcclxuICBjb25zdCBJTUdfSCA9IDEwMDtcclxuXHJcbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xyXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcclxuXHJcbiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykge1xyXG4gICAgY29uc3QgciA9IGl0LnI7XHJcbiAgICBjb25zdCBpc0dhc3RvID0gci50aXBvID09PSAnZ2FzdG8nO1xyXG4gICAgY29uc3QgY29uY2VwdFN0ciA9IGlzR2FzdG8gPyByLmRlc2NyaXBjaW9uIHx8ICcnIDogci50aXBvT3BlcmFjaW9uIHx8IHIubW90aXZvIHx8ICcnO1xyXG4gICAgY29uc3Qgb2JzU3RyID1cclxuICAgICAgKHIub2JzZXJ2YWNpb25lcyB8fCByLm5vdGFzIHx8ICcnKSArXHJcbiAgICAgIChpc0dhc3RvID8gJycgOiByLnNvbGljaXRhZG9Qb3IgPyAnIHwgU29saWNpdGFkbyBwb3I6ICcgKyByLnNvbGljaXRhZG9Qb3IgOiAnJyk7XHJcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xyXG4gICAgICBmZWNoYTogaXQuZmVjaGEsXHJcbiAgICAgIHRpcG86IHIudGlwbyB8fCAnJyxcclxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIGVtYWlsOiByLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIGNvbmNlcHRvOiBjb25jZXB0U3RyLFxyXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxyXG4gICAgICBtb2RvUGFnbzogci5tb2RvUGFnbyB8fCAnJyxcclxuICAgICAgdGlwb0dhc3RvOiByLnRpcG9HYXN0byB8fCAnJyxcclxuICAgICAgZGl2aXNpb246IHIuZGl2aXNpb25HYXN0byB8fCAnJyxcclxuICAgICAgaW1wb3J0ZTogci5pbXBvcnRlICE9IG51bGwgPyByLmltcG9ydGUgOiAnJyxcclxuICAgICAgbW9uZWRhOiByLm1vbmVkYSB8fCAnUEVTT1MnLFxyXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcclxuICAgICAgb2JzOiBvYnNTdHIsXHJcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGVuY2ltYSB2YSBsYSBpbWFnZW5cclxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcclxuICAgICAgYXByb2JhZG9yOiByLmFwcHJvdmVyRW1haWwgfHwgci5hcHJvYmFkb3IgfHwgJycsXHJcbiAgICAgIGFwcm9iYWRvRW46XHJcbiAgICAgICAgci5hcHByb3ZlZEF0ICYmIHIuYXBwcm92ZWRBdC50b0RhdGUgPyByLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgIH0pO1xyXG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xyXG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xyXG4gICAgLy8gRW1iZWJlciBmb3RvIGRlbCB0aWNrZXQgc2kgZXhpc3RlLiB2MzA4KzogcHJlZmVyaXIgYmFzZTY0IGVtYmViaWRvXHJcbiAgICAvLyAoZm90b1RpY2tldCAvIGFkanVudG8pIHBvciBjb21wYXQsIHNpbm8gdXNhciBmb3RvVGlja2V0VXJsIGNvbW8gSFlQRVJMSU5LLlxyXG4gICAgLy8gQSBuaXZlbCBFeGNlbCB1biBkYXRhVVJMIGJhc2U2NCBzZSBwdWVkZSBpbnNlcnRhciBjb21vIGltYWdlbiBpbmxpbmUsXHJcbiAgICAvLyBtaWVudHJhcyBxdWUgdW5hIFVSTCBkZSBTdG9yYWdlIHNlIGFncmVnYSBjb21vIGxpbmsgY2xpY2tlYWJsZSAoZWxcclxuICAgIC8vIHVzdWFyaW8gYWJyZSBlbiBlbCBicm93c2VyIHNpbiBuZWNlc2lkYWQgZGUgcXVlIEV4Y2VsIGRlc2Nhcmd1ZSkuXHJcbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcclxuICAgIGlmIChmb3RvU3JjICYmIHR5cGVvZiBmb3RvU3JjID09PSAnc3RyaW5nJyAmJiBmb3RvU3JjLnN0YXJ0c1dpdGgoJ2RhdGE6aW1hZ2UvJykpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcclxuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xyXG4gICAgICAgIGlmIChtKSB7XHJcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICBiNjQgPSBtWzJdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxyXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAoci5mb3RvVGlja2V0VXJsICYmIHR5cGVvZiByLmZvdG9UaWNrZXRVcmwgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIC8vIERvY3MgbnVldm9zICh2MzA4Kyk6IGZvdG8gZW4gU3RvcmFnZSwgaW5zZXJ0YW1vcyBjb21vIGh5cGVybGluay5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XHJcbiAgICAgICAgY2VsbC52YWx1ZSA9IHtcclxuICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxyXG4gICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXHJcbiAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXInLFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkYwNTYzQzEnIH0sIHVuZGVybGluZTogdHJ1ZSB9O1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdoeXBlcmxpbmsgZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcclxuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUmVuZGljaW9uZXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBSVVRBUzogcnV0YXMgYXNpZ25hZGFzIGRlbCBwZXJpb2RvICsgb3ZlcnJpZGVzXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUnV0YXMuLi4nKTtcclxuICAvLyBMYXMgcnV0YXMgc2UgZ2VuZXJhbiBlbiBydW50aW1lIHBhcmEgY2FkYSB2ZW5kZWRvcjsgZW4gY2FtYmlvIGxvcyBvdmVycmlkZXNcclxuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XHJcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxhcyBydXRhcyBwbGFuaWZpY2FkYXMgZGVsIHBlcmlvZG8gKHBhcmEgbG9zIHZlbmRlZG9yZXNcclxuICAvLyAgICBkZWwgcm9sIGFjdHVhbCBvIHRvZG9zIHNpIGFkbWluKVxyXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXHJcbiAgY29uc3QgdGFyZ2V0VmVuZG9ycyA9XHJcbiAgICB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ3ZpZXdlcidcclxuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXHJcbiAgICAgIDogYXNzaWduZWRWZW5kb3JcclxuICAgICAgICA/IFthc3NpZ25lZFZlbmRvcl1cclxuICAgICAgICA6IFtdO1xyXG4gIGNvbnN0IG1vbnRoc1RvRXhwb3J0ID0gbW9udGhJZHggIT09IG51bGwgPyBbbW9udGhJZHhdIDogWzAsIDEsIDIsIDMsIDQsIDUsIDYsIDcsIDgsIDksIDEwLCAxMV07XHJcbiAgY29uc3QgcnV0YXNSb3dzID0gW107XHJcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcclxuICAgIGZvciAoY29uc3QgbSBvZiBtb250aHNUb0V4cG9ydCkge1xyXG4gICAgICBsZXQgcnV0YXM7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcnV0YXMgPSBnZW5lcmFyUnV0YXNWZW5kb3IodmVuZCwgbSwgYW5pbyk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICAgICAgcnV0YXMgPSBbXTtcclxuICAgICAgfVxyXG4gICAgICAocnV0YXMgfHwgW10pLmZvckVhY2goKHJ1dGEpID0+IHtcclxuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XHJcbiAgICAgICAgICBydXRhc1Jvd3MucHVzaCh7XHJcbiAgICAgICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZCksXHJcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXHJcbiAgICAgICAgICAgIE1lczogTUVTRVNbbV0sXHJcbiAgICAgICAgICAgIFJ1dGFfSUQ6IHJ1dGEuaWQgfHwgJycsXHJcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcclxuICAgICAgICAgICAgRmVjaGFfQXNpZ25hZGE6IHJ1dGEuZmVjaGFBc2lnbmFkYSB8fCAnJyxcclxuICAgICAgICAgICAgT3JkZW46IGkgKyAxLFxyXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcclxuICAgICAgICAgICAgTG9jYWxpZGFkOiB0LmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgICAgIFRpZW5kYTogdC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXHJcbiAgICAgICAgICAgIEVzdGFkbzogdC5lc3RhZG8gfHwgJycsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIE92ZXJyaWRlc1xyXG4gIGxldCBvdnJTbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBvdnJTbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb3V0ZV9vdmVycmlkZXMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChfZSkge1xyXG4gICAgb3ZyU25hcCA9IG51bGw7XHJcbiAgfVxyXG4gIGNvbnN0IG92ZXJyaWRlc1Jvd3MgPSBbXTtcclxuICBpZiAob3ZyU25hcCkge1xyXG4gICAgb3ZyU25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICAgIGNvbnN0IG8gPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChvLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICAgIG92ZXJyaWRlc1Jvd3MucHVzaCh7XHJcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxyXG4gICAgICAgIE1lczogTUVTRVNbcGFyc2VJbnQoby5tb250aElkeCwgMTApXSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKG8udmVuZG9yIHx8ICcnKSxcclxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcclxuICAgICAgICBMb2NhbGlkYWQ6IG8ubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBUaWVuZGE6IG8uY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcclxuICAgICAgICBEZXJpdmFkYV9BOiBvLmRlcml2YWRhQSB8fCAnJyxcclxuICAgICAgICBSZWFnZW5kYWRhX1BhcmE6IG8ucmVhZ2VuZGFkYVBhcmEgfHwgJycsXHJcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcclxuICAgICAgICBDcmVhZG9fUG9yOiBvLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgICAgIENyZWFkb19FbjpcclxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUnV0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXHJcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcclxuICAgIHsgbmFtZTogJ0Rlcml2YWNpb25lcy1SZWFnZW5kYXMnLCByb3dzOiBvdmVycmlkZXNSb3dzIH0sXHJcbiAgXSk7XHJcbiAgc2hvd1N5bmNUYWcoXHJcbiAgICAnRXhwb3J0IFJ1dGFzIGxpc3RvICgnICsgcnV0YXNSb3dzLmxlbmd0aCArICcgdGllbmRhcywgJyArIG92ZXJyaWRlc1Jvd3MubGVuZ3RoICsgJyBvdmVycmlkZXMpJyxcclxuICAgIDI0MDBcclxuICApO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQUxUQVM6IHNvbGljaXR1ZGVzIGRlIGFsdGEgZGUgY2xpZW50ZSBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEFsdGFzLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBsZXQgZHQgPSAnJztcclxuICAgIGlmIChhLmNyZWF0ZWRBdCAmJiBhLmNyZWF0ZWRBdC50b0RhdGUpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xyXG4gICAgICB9IGNhdGNoIChfZSkge31cclxuICAgIH1cclxuICAgIGlmICghZHQpIHJldHVybjtcclxuICAgIGlmIChkdC5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZHQuZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIEZlY2hhX1NvbGljaXR1ZDogZHQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXHJcbiAgICAgIEVzdGFkbzogYS5zdGF0dXMgfHwgJycsXHJcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxyXG4gICAgICBGYW50YXNpYTogYS5mYW50YXNpYSB8fCAnJyxcclxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxyXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXHJcbiAgICAgIENhbGxlOiBhLmNhbGxlIHx8ICcnLFxyXG4gICAgICBOdW1lcm86IGEubnVtZXJvIHx8ICcnLFxyXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxyXG4gICAgICBQcm92aW5jaWE6IGEucHJvdmluY2lhIHx8ICcnLFxyXG4gICAgICBDUDogYS5jcCB8fCAnJyxcclxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXHJcbiAgICAgIEVtYWlsOiBhLmVtYWlsIHx8ICcnLFxyXG4gICAgICBWZW5kZWRvcl9Tb2xpY2l0YW50ZTogYS52ZW5kb3JOYW1lIHx8IGEub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcclxuICAgICAgU3VibWl0dGVkX0J5X1B1YmxpY19Gb3JtOiBhLnN1Ym1pdHRlZEJ5UHVibGljRm9ybSA/ICdTSScgOiAnTk8nLFxyXG4gICAgICBBcHJvYmFkb19Qb3I6IGEuYXBwcm92ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgICBBcHJvYmFkb19FbjpcclxuICAgICAgICBhLmFwcHJvdmVkQXQgJiYgYS5hcHByb3ZlZEF0LnRvRGF0ZSA/IGEuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxyXG4gICAgICBSZWNoYXphZG9fTW90aXZvOiBhLnJlamVjdGVkUmVhc29uIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19BbHRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcclxuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQWx0YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgc29saWNpdHVkZXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbi8vIEV4cG9ydGFyIHBhcmEgQW5hbGlzaXM6IHByb3RlZ2lkbyBjb24gUElOXHJcbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1JztcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4cG9ydCBFeGNlbCBUQVJHRVRTLVpPTkFTIC0gc29sbyBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVBcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEdlbmVyYSBsYSBob2phIENMSUVOVEVTX1pPTkFTIGNvbiBVTkEgZmlsYSBwb3IgQlAgcXVlIGVzdGEgdml2byBlbiBTQVA6XHJcbi8vIGN1YWxxdWllciBhbHRhIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgY29uIHN0YXR1cz0nYXBwcm92ZWQnIFkgY2FyZENvZGVTYXBcclxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXHJcbi8vIENhcmRDb2RlIChtb2NrcyBvIHBlbmRpZW50ZXMgZGUgU0FQKS4gRXMgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgZmFjdHVyYS5cclxuLy8gQ29sdW1uYXM6IFRJUE8sIE5STyBDVEUsIFJFR0lPTiwgUFJPVklOQ0lBLCBBU0VTT1IgRVhURVJOTywgQVNFU09SIElOVEVSTk8sXHJcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcclxuLy8gQ09ORElDSU9OIEZJU0NBTCwgVEVMRUZPTk8sIENBUkRDT0RFIFNBUC5cclxud2luZG93LmV4cG9ydFRhcmdldHNab25hcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaWNcdTAwRTEgdHUgY29uZXhpXHUwMEYzbiB5IHJlaW50ZW50XHUwMEUxLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGV4cG9ydGFyIGVsIG1hc3Rlci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBUQVJHRVRTLVpPTkFTLi4uJyk7XHJcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcclxuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxyXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICAgICdNQVJUSU4gQk9JRVJPJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gIH07XHJcbiAgZnVuY3Rpb24gcmVnaW9uT2YocHJvdikge1xyXG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgaWYgKFsnQlVFTk9TIEFJUkVTJywgJ0NBUElUQUwgRkVERVJBTCcsICdMQSBQQU1QQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0JVRU5PUyBBSVJFUyc7XHJcbiAgICBpZiAoWydDT1JET0JBJywgJ1NBTiBMVUlTJywgJ01FTkRPWkEnLCAnU0FOIEpVQU4nLCAnTEEgUklPSkEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdDVVlPJztcclxuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXHJcbiAgICAgIHJldHVybiAnTkVBJztcclxuICAgIGlmIChbJ0pVSlVZJywgJ1NBTFRBJywgJ1RVQ1VNQU4nLCAnQ0FUQU1BUkNBJywgJ1NBTlRJQUdPIERFTCBFU1RFUk8nXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdOT0EnO1xyXG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxyXG4gICAgICByZXR1cm4gJ1BBVEFHT05JQSc7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHZlbmRvckxhYmVsRm9yRXhjZWwoa2V5KSB7XHJcbiAgICBpZiAoIWtleSkgcmV0dXJuICcnO1xyXG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xyXG4gICAgcmV0dXJuIGtleTtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGxldCBhbHRhc1NuYXA7XHJcbiAgdHJ5IHtcclxuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKVxyXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9PScsICdhcHByb3ZlZCcpXHJcbiAgICAgIC5nZXQoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhcyBhcHJvYmFkYXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgbGV0IHNraXBwZWROb1NhcCA9IDA7XHJcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcclxuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXHJcbiAgICBpZiAoIWNhcmRDb2RlKSB7XHJcbiAgICAgIHNraXBwZWROb1NhcCsrO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBwcm92aW5jZSA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9VcHBlckNhc2UoKS50cmltKCk7XHJcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcclxuICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcclxuICAgICAgJ05STyBDVEUnOiAwLCAvLyBzZSByZW51bWVyYSBkZXNwdWVzIGRlbCBzb3J0XHJcbiAgICAgIFJFR0lPTjogcmVnaW9uT2YocHJvdmluY2UpLFxyXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxyXG4gICAgICAnQVNFU09SIEVYVEVSTk8nOiB2ZW5kb3JMYWJlbEZvckV4Y2VsKHZlbmRvciksXHJcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcclxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXHJcbiAgICAgIE5VTUVSTzogYS5udW1lcm8gfHwgJycsXHJcbiAgICAgIExPQ0FMSURBRDogbG9jYWxpdHlGaW5hbCxcclxuICAgICAgQ1A6IGEuY3AgfHwgJycsXHJcbiAgICAgICdOT01CUkUgQ09NRVJDSUFMJzogYS5jb21lcmNpbyB8fCBhLnRpdHVsYXIgfHwgJycsXHJcbiAgICAgICdOT01CUkUgREUgRkFOVEFTSUEnOiBhLmZhbnRhc2lhIHx8ICcnLFxyXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXHJcbiAgICAgICdDT05ESUNJT04gRklTQ0FMJzogYS5jb25kaWNpb25GaXNjYWwgfHwgJycsXHJcbiAgICAgIFRFTEVGT05POiBhLnRlbGVmb25vIHx8ICcnLFxyXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVAgdG9kYXZpYS5cXG5cXG5VbmEgYWx0YSBlbnRyYSBhbCBleHBvcnQgc29sbyBjdWFuZG8gdGllbmUgQ2FyZENvZGUgU0FQIGFzaWduYWRvLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XHJcbiAgICBjb25zdCBwID0gKHIxLlBST1ZJTkNJQSB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5QUk9WSU5DSUEgfHwgJycpO1xyXG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xyXG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcclxuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcclxuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcclxuICB9KTtcclxuICByb3dzLmZvckVhY2goKHIsIGkpID0+IChyWydOUk8gQ1RFJ10gPSBpICsgMSkpO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTAgfSxcclxuICAgIHsgd2NoOiAxNiB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMjggfSxcclxuICAgIHsgd2NoOiAyOCB9LFxyXG4gICAgeyB3Y2g6IDI4IH0sXHJcbiAgICB7IHdjaDogMTAgfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDEwIH0sXHJcbiAgICB7IHdjaDogMzggfSxcclxuICAgIHsgd2NoOiAzMiB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgXTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0NMSUVOVEVTX1pPTkFTJyk7XHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcpO1xyXG4gIHNob3dTeW5jVGFnKFxyXG4gICAgJ0V4Y2VsIGV4cG9ydGFkbzogJyArXHJcbiAgICAgIHJvd3MubGVuZ3RoICtcclxuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcclxuICAgICAgKHNraXBwZWROb1NhcCA+IDAgPyAnICgnICsgc2tpcHBlZE5vU2FwICsgJyBzaW4gQ2FyZENvZGUgZGVzY2FydGFkb3MpJyA6ICcnKVxyXG4gICk7XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHBpbiA9IHByb21wdChcclxuICAgICdFc3RhIHNlY2Npb24gY29udGllbmUgZm9ybWF0b3MgYXZhbnphZG9zIChQb3dlciBCSSwgUHl0aG9uL01MLCBaSVAgZGUgZm90b3MpIGRlc3RpbmFkb3MgYSBhbmFsaXNpcyB0ZWNuaWNvLlxcblxcbkluZ3Jlc2EgZWwgUElOIHBhcmEgY29udGludWFyOidcclxuICApO1xyXG4gIGlmIChwaW4gPT09IG51bGwpIHJldHVybjtcclxuICBpZiAocGluICE9PSBBTkFMSVNJU19QSU4pIHtcclxuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxyXG4gIGNvbnN0IHNhcE9wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LXNhcC1pbnRlZ3JhdGlvbicpO1xyXG4gIGlmIChzYXBPcHQpIHtcclxuICAgIGNvbnN0IGlzTWFyaWFubyA9XHJcbiAgICAgIGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJztcclxuICAgIHNhcE9wdC5zdHlsZS5kaXNwbGF5ID0gaXNNYXJpYW5vID8gJycgOiAnbm9uZSc7XHJcbiAgfVxyXG4gIC8vIE9wY2lvbiBCYWNrdXAgbWVuc3VhbDogc29sbyBhZG1pblxyXG4gIGNvbnN0IGJrT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtYmFja3VwLW1lbnN1YWwnKTtcclxuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbn07XHJcblxyXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxyXG4vLyBIZWxwZXJzIGludGVybm9zIChkb3dubG9hZFhsc3gsIGV4cG9ydFZlbnRhc0Zvck1vbnRoLCBldGMuKSBzb24gY29uc3VtaWRvc1xyXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZ0JBLFNBQU8sdUJBQXVCLFdBQVk7QUFDeEMsUUFBSSxPQUFPLFNBQVMsYUFBYTtBQUMvQixZQUFNLGlGQUFpRjtBQUN2RjtBQUFBLElBQ0Y7QUFDQSxRQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sUUFBUTtBQUM3QixZQUFNLGdDQUFnQztBQUN0QztBQUFBLElBQ0Y7QUFDQSxnQkFBWSxxQ0FBcUM7QUFRakQsVUFBTSxXQUNKLE9BQU8sMEJBQTBCLGFBQzdCLHNCQUFzQixPQUFPLGtCQUFrQixjQUFjLGdCQUFnQixLQUFLLElBQ2xGO0FBQ04sVUFBTSxVQUFVLENBQUMsY0FBYztBQUM3QixVQUFJLGFBQWEsS0FBTSxRQUFPO0FBQzlCLFVBQUksQ0FBQyxVQUFXLFFBQU87QUFDdkIsYUFBTyxTQUFTLElBQUksU0FBUztBQUFBLElBQy9CO0FBTUEsVUFBTSxhQUFhO0FBQUEsTUFDakIseUJBQXlCO0FBQUEsTUFDekIsc0JBQXNCO0FBQUEsTUFDdEIsZ0JBQWdCO0FBQUEsTUFDaEIsaUJBQWlCO0FBQUEsSUFDbkI7QUFDQSxhQUFTLFdBQVcsV0FBVztBQUM3QixZQUFNLElBQUksT0FBTyxZQUFZLGNBQWMsUUFBUSxLQUFLLENBQUMsT0FBTyxHQUFHLFFBQVEsU0FBUyxJQUFJO0FBQ3hGLGFBQU8sSUFBSSxFQUFFLE9BQU87QUFBQSxJQUN0QjtBQUNBLGFBQVMsa0JBQWtCLFdBQVc7QUFDcEMsWUFBTSxJQUFJLE9BQU8sWUFBWSxjQUFjLFFBQVEsS0FBSyxDQUFDLE9BQU8sR0FBRyxRQUFRLFNBQVMsSUFBSTtBQUN4RixhQUFPLElBQUksRUFBRSxRQUFRLGFBQWE7QUFBQSxJQUNwQztBQVdBLFVBQU0saUJBQWlCO0FBQUEsTUFDckI7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUNBLGFBQVMsWUFBWSxNQUFNLEtBQUssUUFBUTtBQUN0QyxjQUNHLFFBQVEsSUFBSSxTQUFTLEVBQUUsWUFBWSxFQUFFLEtBQUssSUFDM0MsT0FDQyxPQUFPLElBQUksU0FBUyxFQUFFLEtBQUssSUFDNUIsT0FDQyxVQUFVLElBQUksU0FBUyxFQUFFLEtBQUs7QUFBQSxJQUVuQztBQUNBLGFBQVMsV0FBVyxHQUFHO0FBQ3JCLFVBQUksS0FBSyxFQUFFLGFBQWEsRUFBRSxVQUFVLFNBQVUsUUFBTyxFQUFFLFVBQVUsU0FBUztBQUMxRSxVQUFJLEtBQUssRUFBRSxNQUFPLFFBQU8sSUFBSSxLQUFLLEVBQUUsS0FBSyxFQUFFLFFBQVEsS0FBSztBQUN4RCxhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sZUFBZSxvQkFBSSxJQUFJO0FBQzdCLFFBQUksT0FBTyxnQkFBZ0IsZUFBZSxNQUFNLFFBQVEsV0FBVyxHQUFHO0FBQ3BFLFlBQU0sUUFBUSxvQkFBSSxJQUFJO0FBQ3RCLGtCQUFZLFFBQVEsQ0FBQyxNQUFNO0FBQ3pCLFlBQUksQ0FBQyxFQUFHO0FBQ1IsY0FBTSxJQUFJLFlBQVksRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLE1BQU07QUFDeEQsWUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUcsT0FBTSxJQUFJLEdBQUcsQ0FBQyxDQUFDO0FBQ2xDLGNBQU0sSUFBSSxDQUFDLEVBQUUsS0FBSyxDQUFDO0FBQUEsTUFDckIsQ0FBQztBQUNELFlBQU0sUUFBUSxDQUFDLEtBQUssTUFBTTtBQUN4QixZQUFJLEtBQUssQ0FBQyxHQUFHLE1BQU0sV0FBVyxDQUFDLElBQUksV0FBVyxDQUFDLENBQUM7QUFDaEQsY0FBTSxTQUFTLENBQUM7QUFDaEIsWUFBSSxRQUFRLENBQUMsTUFBTTtBQUNqQix5QkFBZSxRQUFRLENBQUMsTUFBTTtBQUM1QixnQkFBSSxPQUFPLENBQUMsS0FBSyxRQUFRLE9BQU8sQ0FBQyxNQUFNLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRztBQUM5RCxrQkFBTSxNQUFNLEVBQUUsQ0FBQztBQUNmLGdCQUFJLE9BQU8sUUFBUSxRQUFRLEdBQUksUUFBTyxDQUFDLElBQUk7QUFBQSxVQUM3QyxDQUFDO0FBQUEsUUFDSCxDQUFDO0FBQ0QsY0FBTSxTQUFTLElBQUksQ0FBQyxLQUFLLENBQUM7QUFDMUIscUJBQWEsSUFBSSxHQUFHO0FBQUEsVUFDbEI7QUFBQSxVQUNBLFdBQVcsT0FBTyxTQUFTO0FBQUEsVUFDM0IsVUFBVSxPQUFPLG9CQUFvQixPQUFPLFVBQVUsV0FBVztBQUFBLFVBQ2pFLFNBQVMsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLG9CQUFvQixVQUFVLEVBQUU7QUFBQSxVQUM3RCxXQUFXLElBQUksT0FBTyxDQUFDLE1BQU0sRUFBRSxvQkFBb0IsVUFBVSxFQUFFO0FBQUEsUUFDakUsQ0FBQztBQUFBLE1BQ0gsQ0FBQztBQUFBLElBQ0g7QUFDQSxhQUFTLFlBQVksTUFBTSxLQUFLLFFBQVE7QUFDdEMsWUFBTSxRQUFRLGFBQWEsSUFBSSxZQUFZLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFDN0QsVUFBSSxDQUFDLE9BQU87QUFDVixlQUFPO0FBQUEsVUFDTCxzQkFBc0I7QUFBQSxVQUN0QiwyQkFBMkI7QUFBQSxVQUMzQixpQkFBaUI7QUFBQSxVQUNqQixtQkFBbUI7QUFBQSxVQUNuQixpQkFBaUI7QUFBQSxVQUNqQixPQUFPO0FBQUEsVUFDUCxRQUFRO0FBQUEsVUFDUixXQUFXO0FBQUEsVUFDWCxpQkFBaUI7QUFBQSxVQUNqQixtQkFBbUI7QUFBQSxVQUNuQixZQUFZO0FBQUEsVUFDWixLQUFLO0FBQUEsVUFDTCxxQkFBcUI7QUFBQSxVQUNyQixpQkFBaUI7QUFBQSxVQUNqQiw2QkFBNkI7QUFBQSxVQUM3Qiw4QkFBOEI7QUFBQSxVQUM5QixhQUFhO0FBQUEsVUFDYixhQUFhO0FBQUEsVUFDYixlQUFlO0FBQUEsVUFDZixpQkFBaUI7QUFBQSxVQUNqQixnQkFBZ0I7QUFBQSxRQUNsQjtBQUFBLE1BQ0Y7QUFDQSxZQUFNLElBQUksTUFBTSxVQUFVLENBQUM7QUFDM0IsYUFBTztBQUFBLFFBQ0wsc0JBQXNCLE1BQU07QUFBQSxRQUM1QiwyQkFBMkIsTUFBTTtBQUFBLFFBQ2pDLGlCQUFpQixNQUFNO0FBQUEsUUFDdkIsbUJBQW1CLE1BQU07QUFBQSxRQUN6QixpQkFBaUIsRUFBRSxRQUFRO0FBQUEsUUFDM0IsT0FBTyxFQUFFLFNBQVM7QUFBQSxRQUNsQixRQUFRLEVBQUUsVUFBVTtBQUFBLFFBQ3BCLFdBQVcsRUFBRSxhQUFhO0FBQUEsUUFDMUIsaUJBQWlCLEVBQUUsbUJBQW1CO0FBQUEsUUFDdEMsbUJBQW1CLEVBQUUsZUFBZTtBQUFBLFFBQ3BDLFlBQVksRUFBRSxjQUFjLE9BQU8sRUFBRSxhQUFhO0FBQUEsUUFDbEQsS0FBSyxFQUFFLE9BQU87QUFBQSxRQUNkLHFCQUFxQixFQUFFLG9CQUFvQjtBQUFBLFFBQzNDLGlCQUFpQixFQUFFLGFBQWE7QUFBQSxRQUNoQyw2QkFBNkIsRUFBRSx1QkFBdUIsT0FBTyxFQUFFLHNCQUFzQjtBQUFBLFFBQ3JGLDhCQUE4QixFQUFFLHdCQUF3QixPQUFPLEVBQUUsdUJBQXVCO0FBQUEsUUFDeEYsYUFBYSxFQUFFLGVBQWU7QUFBQSxRQUM5QixhQUFhLEVBQUUsZUFBZTtBQUFBLFFBQzlCLGVBQWUsRUFBRSxjQUFjO0FBQUEsUUFDL0IsaUJBQWlCLEVBQUUsZ0JBQWdCO0FBQUEsUUFDbkMsZ0JBQWdCLEVBQUUsZUFBZTtBQUFBLE1BQ25DO0FBQUEsSUFDRjtBQU9BLFVBQU0sT0FBTyxDQUFDO0FBQ2QsV0FBTyxRQUFRLENBQUMsTUFBTTtBQUNwQixZQUFNLFdBQVcsRUFBRSxZQUFZO0FBQy9CLFlBQU0sY0FBYyxFQUFFLFFBQVE7QUFDOUIsWUFBTSxPQUFPLEVBQUUsUUFBUTtBQUN2QixZQUFNLFNBQVMsRUFBRSxVQUFVO0FBRTNCLFVBQUksQ0FBQyxRQUFRLE1BQU0sRUFBRztBQUN0QixZQUFNLE9BQU8sV0FBVyxNQUFNO0FBQzlCLFlBQU0sTUFBTSxXQUFXLE1BQU0sS0FBSztBQUNsQyxZQUFNLE1BQU0sRUFBRSxPQUFPLE9BQU8sRUFBRSxNQUFNO0FBQ3BDLFlBQU0sTUFBTSxFQUFFLE9BQU8sT0FBTyxFQUFFLE1BQU07QUFHcEMsT0FBQyxFQUFFLFdBQVcsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxTQUFTO0FBQ2xDLFlBQUksQ0FBQyxLQUFNO0FBQ1gsWUFBSSxPQUFPLG1CQUFtQixjQUFjLENBQUMsZUFBZSxVQUFVLGFBQWEsSUFBSTtBQUNyRjtBQUNGLGNBQU0sSUFBSSxPQUFPLFdBQVcsTUFBTSxjQUFjLE1BQU07QUFFdEQsWUFBSSxTQUFTO0FBQ2IsWUFBSSxPQUFPLGFBQWEsZUFBZSxZQUFZLFNBQVMsT0FBTyxTQUFTLElBQUksQ0FBQztBQUMvRSxtQkFBUztBQUVYLGNBQU0sT0FBTyxPQUFPLGVBQWUsZUFBZSxhQUFhLFdBQVcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDO0FBQ3RGLGNBQU0sYUFBYSxLQUFLLGNBQWM7QUFFdEMsY0FBTSxRQUNKLE9BQU8sZ0JBQWdCLGFBQWEsWUFBWSxVQUFVLGFBQWEsSUFBSSxJQUFJO0FBQ2pGLGNBQU0sU0FDSixPQUFPLHNCQUFzQixlQUFlLFFBQVEsa0JBQWtCLElBQUksS0FBSyxLQUFLLENBQUMsSUFBSSxDQUFDO0FBQzVGLGNBQU0sVUFBVSxPQUFPLFdBQVcsS0FBSyxXQUFXO0FBQ2xELGNBQU0sZUFBZSxPQUFPLGFBQWEsS0FBSyxZQUFZO0FBQzFELGNBQU0sWUFBWSxLQUFLLE9BQU8sT0FBTyxLQUFLLE1BQU07QUFDaEQsY0FBTSxZQUFZLEtBQUssT0FBTyxPQUFPLEtBQUssTUFBTTtBQUVoRCxZQUFJLFdBQVcsT0FBTyxlQUFlO0FBQ3JDLFlBQUksQ0FBQyxZQUFZLE9BQU8sdUJBQXVCLGFBQWE7QUFDMUQsZ0JBQU0sTUFBTSxTQUFTLFlBQVksSUFBSSxNQUFNO0FBQzNDLGdCQUFNLFFBQVEsbUJBQW1CLEdBQUcsS0FBSyxDQUFDO0FBQzFDLGdCQUFNLFlBQVksTUFBTSxLQUFLLENBQUMsT0FBTyxFQUFFLFlBQVksRUFBRSxZQUFZLFFBQVEsSUFBSTtBQUM3RSxjQUFJLFVBQVcsWUFBVyxVQUFVLGVBQWU7QUFBQSxRQUNyRDtBQUNBLGFBQUs7QUFBQSxVQUNILE9BQU87QUFBQSxZQUNMO0FBQUEsY0FDRSxnQkFBZ0I7QUFBQSxjQUNoQixpQkFBaUI7QUFBQSxjQUNqQixpQkFBaUI7QUFBQSxjQUNqQixNQUFNO0FBQUEsY0FDTixRQUFRO0FBQUEsY0FDUixXQUFXLE9BQU8sY0FBYyxhQUFhLFVBQVUsUUFBUSxJQUFJO0FBQUEsY0FDbkUsb0JBQW9CO0FBQUEsY0FDcEIsY0FBYztBQUFBLGNBQ2QsMEJBQTBCO0FBQUEsY0FDMUIsTUFBTTtBQUFBLGNBQ04saUJBQWlCLGtCQUFrQixNQUFNO0FBQUEsY0FDekMsd0JBQXdCO0FBQUEsY0FDeEIsV0FBVztBQUFBLGNBQ1gsdUJBQXVCO0FBQUEsY0FDdkIsaUJBQWlCLGFBQWE7QUFBQSxjQUM5QixpQkFBaUIsYUFBYTtBQUFBLFlBQ2hDO0FBQUEsWUFDQSxZQUFZLFVBQVUsYUFBYSxJQUFJO0FBQUEsVUFDekM7QUFBQSxRQUNGO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBUUQsVUFBTSxPQUFPLG9CQUFJLElBQUk7QUFDckIsU0FBSztBQUFBLE1BQVEsQ0FBQyxNQUNaLEtBQUs7QUFBQSxTQUNGLEVBQUUsYUFBYSxJQUFJLFNBQVMsRUFBRSxZQUFZLElBQUksT0FBTyxFQUFFLGVBQWUsS0FBSyxJQUFJLFlBQVk7QUFBQSxNQUM5RjtBQUFBLElBQ0Y7QUFDQSxRQUFJLE9BQU8sc0JBQXNCLGVBQWUsa0JBQWtCLFFBQVE7QUFDeEUsd0JBQWtCLFFBQVEsQ0FBQyxNQUFNO0FBQy9CLFlBQUksQ0FBQyxFQUFHO0FBQ1IsY0FBTSxlQUFlLENBQUMsQ0FBQyxFQUFFLG9CQUFvQixDQUFDLEVBQUU7QUFHaEQsWUFBSSxDQUFDLGNBQWM7QUFDakIsY0FBSSxDQUFDLEVBQUUsWUFBYTtBQUNwQixjQUFJLEVBQUUsRUFBRSxTQUFTLEVBQUUsU0FBVTtBQUFBLFFBQy9CO0FBQ0EsY0FBTSxRQUFRLEVBQUUsYUFBYSxJQUFJLFNBQVM7QUFDMUMsY0FBTSxTQUNKLEVBQUUsWUFDRixFQUFFLGFBQ0QsRUFBRSxjQUFjLFNBQVMsRUFBRSxZQUFZLE1BQU0sR0FBRyxDQUFDLElBQUksRUFBRSxXQUFXO0FBQ3JFLGNBQU0sU0FBUyxLQUFLLFlBQVksSUFBSSxNQUFNLE9BQU8sWUFBWTtBQUM3RCxZQUFJLEtBQUssSUFBSSxNQUFNLEVBQUc7QUFDdEIsYUFBSyxJQUFJLE1BQU07QUFDZixjQUFNLFNBQVMsRUFBRSxrQkFBa0I7QUFFbkMsWUFBSSxDQUFDLFFBQVEsTUFBTSxFQUFHO0FBQ3RCLGNBQU0sT0FBTyxXQUFXLE1BQU07QUFDOUIsY0FBTSxNQUFNLFdBQVcsTUFBTSxLQUFLO0FBQ2xDLGNBQU0sTUFBTSxFQUFFLGtCQUFrQixFQUFFLGFBQWE7QUFDL0MsYUFBSztBQUFBLFVBQ0gsT0FBTztBQUFBLFlBQ0w7QUFBQSxjQUNFLGdCQUFnQixFQUFFLGVBQWU7QUFBQSxjQUNqQyxpQkFBaUI7QUFBQSxjQUNqQixpQkFBaUI7QUFBQSxjQUNqQixNQUFNLGVBQWUsNkJBQTZCO0FBQUEsY0FDbEQsUUFBUSxlQUFlLGVBQWU7QUFBQSxjQUN0QyxXQUFXLE9BQU8sY0FBYyxhQUFhLFVBQVUsSUFBSSxJQUFJO0FBQUEsY0FDL0Qsb0JBQW9CO0FBQUEsY0FDcEIsY0FBYztBQUFBLGNBQ2QsMEJBQTBCO0FBQUEsY0FDMUIsTUFBTTtBQUFBLGNBQ04saUJBQWlCLGtCQUFrQixNQUFNO0FBQUEsY0FDekMsd0JBQXdCO0FBQUEsY0FDeEIsV0FBVyxFQUFFLFNBQVMsRUFBRSxXQUFXO0FBQUEsY0FDbkMsdUJBQXVCO0FBQUEsY0FDdkIsaUJBQWlCLEVBQUUsT0FBTyxPQUFPLEVBQUUsTUFBTTtBQUFBLGNBQ3pDLGlCQUFpQixFQUFFLE9BQU8sT0FBTyxFQUFFLE1BQU07QUFBQSxZQUMzQztBQUFBLFlBQ0EsWUFBWSxNQUFNLEtBQUssTUFBTTtBQUFBLFVBQy9CO0FBQUEsUUFDRjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFHQSxTQUFLLEtBQUssQ0FBQyxHQUFHLE1BQU07QUFDbEIsWUFBTSxLQUFLLEVBQUUsYUFBYSxJQUFJLGNBQWMsRUFBRSxhQUFhLEVBQUU7QUFDN0QsVUFBSSxNQUFNLEVBQUcsUUFBTztBQUNwQixZQUFNLEtBQUssRUFBRSxrQkFBa0IsS0FBSyxJQUFJLGNBQWMsRUFBRSxrQkFBa0IsS0FBSyxFQUFFO0FBQ2pGLFVBQUksTUFBTSxFQUFHLFFBQU87QUFDcEIsY0FBUSxFQUFFLGVBQWUsS0FBSyxJQUFJLGNBQWMsRUFBRSxlQUFlLEtBQUssRUFBRTtBQUFBLElBQzFFLENBQUM7QUFFRCxRQUFJLENBQUMsS0FBSyxRQUFRO0FBQ2hCO0FBQUEsUUFDRTtBQUFBLE1BS0Y7QUFDQTtBQUFBLElBQ0Y7QUFFQSxVQUFNLEtBQUssS0FBSyxNQUFNLFNBQVM7QUFDL0IsVUFBTSxLQUFLLEtBQUssTUFBTSxjQUFjLElBQUk7QUFDeEMsT0FBRyxPQUFPLElBQUk7QUFBQSxNQUNaLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxFQUFFO0FBQUE7QUFBQSxNQUNULEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQTtBQUFBLE1BRVYsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEVBQUU7QUFBQTtBQUFBLE1BQ1QsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQTtBQUFBLElBQ1o7QUFDQSxTQUFLLE1BQU0sa0JBQWtCLElBQUksSUFBSSwwQkFBMEI7QUFHL0QsVUFBTSxTQUFTLENBQUM7QUFDaEIsU0FBSyxRQUFRLENBQUMsTUFBTTtBQUNsQixZQUFNLElBQUksRUFBRSxlQUFlLEtBQUs7QUFDaEMsVUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFHLFFBQU8sQ0FBQyxJQUFJLEVBQUUsT0FBTyxHQUFHLGFBQWEsR0FBRyxZQUFZLEVBQUU7QUFDdEUsYUFBTyxDQUFDLEVBQUU7QUFDVixVQUFJLEVB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
