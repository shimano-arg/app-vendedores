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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xyXG4vLyBFWFBPUlRTLUNPUkU6IG1hc3RlcmZpbGUgY2xpZW50ZXMgKyBwcmVjaW9zL3N0b2NrICsgbW9kYWwgZGUgZXhwb3J0YXIgK1xyXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxyXG4vLyBGcmFnbWVudG9zIHJlc3RhbnRlcyBkZWwgZG9taW5pbyBleHBvcnRzOiBhZHZhbmNlZCAofjEwMzAyLTExNDUxKSB5IFNBUFxyXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgTUFTVEVSRklMRSBERSBDTElFTlRFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxyXG4vLyBub21icmUsIHRpcG8gKGNsaWVudGUvcHJvc3BlY3RvKSwgem9uYSBkZWwgdmVuZGVkb3IsIGFzZXNvciBleHRlcm5vLCBhc2Vzb3JcclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxyXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxyXG4vLyBjb29yZGVuYWRhcyBnZW9jb2RpZmljYWRhcywgZXN0YWRvIChIYWJpbGl0YWRvL1BlbmRpZW50ZS9DYW5jZWxhZG8pLFxyXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cclxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghUE9JTlRTIHx8ICFQT0lOVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xyXG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcclxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXHJcbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxyXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcclxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xyXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxyXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cclxuICBjb25zdCBzY29wZVNldCA9XHJcbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcclxuICAgICAgOiBudWxsO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XHJcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcclxuICB9O1xyXG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcclxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cclxuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXHJcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXHJcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICB9O1xyXG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XHJcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcclxuICAgIHJldHVybiB2ID8gdi56b25lIDogJyc7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xyXG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XHJcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XHJcbiAgfVxyXG5cclxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcclxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXHJcbiAgLy8gZXNwZWNpYWxpemFjaW9uL2NhbmFsQ29tcHJhL3BvcC90aXBvVmVudGEvZXRjLikgZGVsIGZvcm11bGFyaW8gZGVcclxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXHJcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cclxuICAvLyB2ZSBsYSBjbGFzaWZpY2FjaW9uIG1hcyBhY3R1YWxpemFkYSwgcGVybyBzaSBlbCB1bHRpbW8gY29udGFjdG8gbm8gbGxlbmFcclxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcclxuICAvLyBpbnRlcmFjY2lvbiBwZXJvIG5vIHBlcmRlciBpbmZvIHV0aWwgZGUgbGFzIGFudGVyaW9yZXNcIi5cclxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcclxuICAgICd0aXBvJyxcclxuICAgICdsb2NhbCcsXHJcbiAgICAndGFtYW5vJyxcclxuICAgICdmaWRlbGlkYWQnLFxyXG4gICAgJ2VzcGVjaWFsaXphY2lvbicsXHJcbiAgICAnY2FuYWxDb21wcmEnLFxyXG4gICAgJ3JlbGV2YW5jaWEnLFxyXG4gICAgJ3BvcCcsXHJcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXHJcbiAgICAndGlwb1ZlbnRhJyxcclxuICAgICdwb25kZXJhY2lvbk1vc3RyYWRvJyxcclxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXHJcbiAgICAnY29tcGV0ZW5jaWEnLFxyXG4gICAgJ29wb3J0dW5pZGFkJyxcclxuICAgICdtYXNWZW5kaWRvJyxcclxuICAgICdtYXNQcmVndW50YW4nLFxyXG4gICAgJ2F5dWRhVGllbmRhJyxcclxuICBdO1xyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXHJcbiAgICAgICd8JyArXHJcbiAgICAgIChsb2MgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpICtcclxuICAgICAgJ3wnICtcclxuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcclxuICAgICk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xyXG4gICAgaWYgKHYgJiYgdi5jcmVhdGVkQXQgJiYgdi5jcmVhdGVkQXQudG9NaWxsaXMpIHJldHVybiB2LmNyZWF0ZWRBdC50b01pbGxpcygpO1xyXG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xyXG4gICAgcmV0dXJuIDA7XHJcbiAgfVxyXG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XHJcbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcclxuICAgIGNvbnN0IGJ5S2V5ID0gbmV3IE1hcCgpO1xyXG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgICBpZiAoIXYpIHJldHVybjtcclxuICAgICAgY29uc3QgayA9IF9jbGFzc2lmS2V5KHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcclxuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XHJcbiAgICB9KTtcclxuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xyXG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxyXG4gICAgICBjb25zdCBtZXJnZWQgPSB7fTtcclxuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcclxuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgICBpZiAobWVyZ2VkW2ZdICE9IG51bGwgJiYgbWVyZ2VkW2ZdICE9PSAnJyAmJiBtZXJnZWRbZl0gIT09IDApIHJldHVybjtcclxuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XHJcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xyXG4gICAgICBjbGFzc2lmSW5kZXguc2V0KGssIHtcclxuICAgICAgICBtZXJnZWQsXHJcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXHJcbiAgICAgICAgbGFzdFR5cGU6IGxhdGVzdC5pbnRlcmFjdGlvblR5cGUgfHwgKGxhdGVzdC5lc3BhY2lvID8gJ3Zpc2l0YScgOiAnJyksXHJcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcclxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIF9jbGFzc2lmUm93KHByb3YsIGxvYywgdGllbmRhKSB7XHJcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcclxuICAgIGlmICghZW50cnkpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXHJcbiAgICAgICAgJ1RvdGFsIHZpc2l0YXMnOiAwLFxyXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxyXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXHJcbiAgICAgICAgTG9jYWw6ICcnLFxyXG4gICAgICAgIFRhbWFubzogJycsXHJcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcclxuICAgICAgICBFc3BlY2lhbGl6YWNpb246ICcnLFxyXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcclxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcclxuICAgICAgICBQT1A6ICcnLFxyXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxyXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXHJcbiAgICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAnJyxcclxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcclxuICAgICAgICBDb21wZXRlbmNpYTogJycsXHJcbiAgICAgICAgT3BvcnR1bmlkYWQ6ICcnLFxyXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxyXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXHJcbiAgICAgICAgJ0F5dWRhIHRpZW5kYSc6ICcnLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgY29uc3QgbSA9IGVudHJ5Lm1lcmdlZCB8fCB7fTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXHJcbiAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RUeXBlLFxyXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXHJcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXHJcbiAgICAgICdUaXBvIGNvbWVyY2lvJzogbS50aXBvIHx8ICcnLFxyXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcclxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcclxuICAgICAgRmlkZWxpZGFkOiBtLmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcclxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXHJcbiAgICAgIFJlbGV2YW5jaWE6IG0ucmVsZXZhbmNpYSAhPSBudWxsID8gbS5yZWxldmFuY2lhIDogJycsXHJcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXHJcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcclxuICAgICAgJ1RpcG8gZGUgdmVudGEnOiBtLnRpcG9WZW50YSB8fCAnJyxcclxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxyXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXHJcbiAgICAgIENvbXBldGVuY2lhOiBtLmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgICAnTWFzIHByZWd1bnRhbic6IG0ubWFzUHJlZ3VudGFuIHx8ICcnLFxyXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXHJcbiAgLy8gdGllbmVuIGNhcmRDb2RlICsgZGlyZWNjaW9uLiBFc29zIHNvbiBsb3MgcXVlIGFwYXJlY2VuIGNvbW8gdmVyZGVzIGVuXHJcbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcclxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXHJcbiAgLy8gcmVhbCBvcGVyYWJsZSBob3kuXHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCBwcm92aW5jZSA9IHAucHJvdmluY2UgfHwgJyc7XHJcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcclxuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBwLnZlbmRvciB8fCAnJztcclxuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cclxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XHJcbiAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xyXG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xyXG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XHJcbiAgICBjb25zdCBsb24gPSBwLmxvbiAhPSBudWxsID8gcC5sb24gOiAnJztcclxuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cclxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxyXG4gICAgKHAuY2xpZW50cyB8fCBbXSkuZm9yRWFjaCgobmFtZSkgPT4ge1xyXG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcclxuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XHJcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXHJcbiAgICAgIGxldCBlc3RhZG8gPSAnSGFiaWxpdGFkbyc7IC8vIHBvciBkZWZpbmljaW9uIHlhIGVzdGEgU0FQLWNvbmZpcm1hZG9cclxuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcclxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcclxuICAgICAgLy8gTWV0YWRhdGEgY3VzdG9tIChkaXJlY2Npb24sIGxvY2FsaWRhZCBkZWNsYXJhZGEsIGdlb2NvZGUpLlxyXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XHJcbiAgICAgIC8vIEJ1c2NhciBhZGRyZXNzOiAxKSBjbGllbnRfbWFzdGVyLmFkZHJlc3MgKGFkbWluKSwgMikgY2xpZW50TWV0YS5hZGRyZXNzICh2ZW5kb3IpLlxyXG4gICAgICBjb25zdCBkb2NJZCA9XHJcbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xyXG4gICAgICBjb25zdCBjbURhdGEgPVxyXG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XHJcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGxvY2FsaXR5Q3VzdCA9IGNtRGF0YS5sb2NhbGlkYWQgfHwgbWV0YS5sb2NhbGl0eSB8fCAnJztcclxuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XHJcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xyXG4gICAgICAvLyBDYXJkQ29kZSBTQVAgKGRlIGNsaWVudF9tYXN0ZXIgbyBkZSBsYSBhbHRhIHZpbmN1bGFkYSkuXHJcbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcclxuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xyXG4gICAgICAgIGNvbnN0IGtleSA9IHByb3ZpbmNlLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBsb2NhbGl0eU1hcDtcclxuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcclxuICAgICAgICBpZiAoYWx0YU1hdGNoKSBjYXJkQ29kZSA9IGFsdGFNYXRjaC5jYXJkQ29kZVNhcCB8fCAnJztcclxuICAgICAgfVxyXG4gICAgICByb3dzLnB1c2goXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGNhcmRDb2RlLFxyXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXHJcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcclxuICAgICAgICAgICAgVGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXHJcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2NhbGl0eU1hcCxcclxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxyXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcclxuICAgICAgICAgICAgWm9uYTogem9uZSxcclxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxyXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXHJcbiAgICAgICAgICAgIERpcmVjY2lvbjogYWRkcmVzcyxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXHJcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcclxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBjdXN0b21MbmcgfHwgbG9uLFxyXG4gICAgICAgICAgICAvLyB2MTA1NSAoMjAyNi0wOS0yNCk6IGxpbWl0ZSBkZSBjcmVkaXRvIEFSUyBwYXJhIHBhZ2FyIGNvbiBjaGVxdWUuXHJcbiAgICAgICAgICAgIC8vIEVkaXRhYmxlIGFkbWluL2dlcmVudGUgZGVzZGUgTWFzdGVyIENsaWVudGVzIFVJLCBndWFyZGFkbyBlblxyXG4gICAgICAgICAgICAvLyBjbGllbnRfbWFzdGVyLmNyZWRpdG9DaGVxdWUgKHBhcmEgUE9JTlRTIG1hdGNoZWFkb3MgY29uIFNBUCkuXHJcbiAgICAgICAgICAgICdDcmVkaXRvIGNoZXF1ZSAoQVJTKSc6XHJcbiAgICAgICAgICAgICAgY21EYXRhLmNyZWRpdG9DaGVxdWUgIT0gbnVsbCA/IE51bWJlcihjbURhdGEuY3JlZGl0b0NoZXF1ZSkgOiAnJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpXHJcbiAgICAgICAgKVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgLy8gSW55ZWN0YXIgYWx0YXMgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyAoYXBwcm92ZWRBbHRhc0xpc3QpOlxyXG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXHJcbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxyXG4gIC8vICAgICBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLiBWYW4gY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuIFNlXHJcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xyXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXHJcbiAgLy8gICAgIExvcyBwcm92aXNvcmlvcyBwdWVkZW4gbm8gdGVuZXIgZGlyZWNjaW9uIHRvZGF2aWEgLT4gc2UgYWNlcHRhbiBpZ3VhbC5cclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xyXG4gICAgc2Vlbi5hZGQoXHJcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxyXG4gICAgKTtcclxuICB9KTtcclxuICBpZiAodHlwZW9mIGFwcHJvdmVkQWx0YXNMaXN0ICE9PSAndW5kZWZpbmVkJyAmJiBhcHByb3ZlZEFsdGFzTGlzdC5sZW5ndGgpIHtcclxuICAgIGFwcHJvdmVkQWx0YXNMaXN0LmZvckVhY2goKGEpID0+IHtcclxuICAgICAgaWYgKCFhKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IGlzUHJvdmlzb3JpbyA9ICEhYS5tYW51YWxTYXBQZW5kaW5nICYmICFhLmNhcmRDb2RlU2FwO1xyXG4gICAgICAvLyBIYWJpbGl0YWRvczogc2lndWVuIGV4aWdpZW5kbyBjYXJkQ29kZSArIGRpcmVjY2lvbiAoY29tcG9ydGFtaWVudG8gcHJlLXYzMTEpLlxyXG4gICAgICAvLyBQcm92aXNvcmlvczogc2luIGNhcmRDb2RlIG5pIGRpcmVjY2lvbiwgdmFuIGlndWFsIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLlxyXG4gICAgICBpZiAoIWlzUHJvdmlzb3Jpbykge1xyXG4gICAgICAgIGlmICghYS5jYXJkQ29kZVNhcCkgcmV0dXJuO1xyXG4gICAgICAgIGlmICghKGEuY2FsbGUgfHwgYS5hZGRyZXNzKSkgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHByb3YgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCk7XHJcbiAgICAgIGNvbnN0IG5vbWJyZSA9XHJcbiAgICAgICAgYS5jb21lcmNpbyB8fFxyXG4gICAgICAgIGEuZmFudGFzaWEgfHxcclxuICAgICAgICAoYS5jYXJkQ29kZVNhcCA/ICdTQVAgJyArIGEuY2FyZENvZGVTYXAuc2xpY2UoMCwgOCkgOiBhLnRpdHVsYXIgfHwgJ1Byb3Zpc29yaW8nKTtcclxuICAgICAgY29uc3QgZHVwS2V5ID0gcHJvdi50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbm9tYnJlLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChzZWVuLmhhcyhkdXBLZXkpKSByZXR1cm47XHJcbiAgICAgIHNlZW4uYWRkKGR1cEtleSk7XHJcbiAgICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XHJcbiAgICAgIC8vIHYzMzE6IG1pc21vIGZpbHRybyBkZSBzY29wZSBhcGxpY2EgYSBhbHRhcyBTQVAvcHJvdmlzb3JpYXMuXHJcbiAgICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XHJcbiAgICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcclxuICAgICAgY29uc3QgbG9jID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnKHNpbiBsb2NhbGlkYWQpJztcclxuICAgICAgcm93cy5wdXNoKFxyXG4gICAgICAgIE9iamVjdC5hc3NpZ24oXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxyXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5vbWJyZSxcclxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcclxuICAgICAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxyXG4gICAgICAgICAgICBFc3RhZG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvJyA6ICdIYWJpbGl0YWRvJyxcclxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXHJcbiAgICAgICAgICAgIERlcGFydGFtZW50bzogJycsXHJcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxyXG4gICAgICAgICAgICBab25hOiB6b25lLFxyXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXHJcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcclxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcclxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2MsXHJcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXHJcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXHJcbiAgICAgICAgICAgIC8vIHYxMDU1OiBtaXNtbyBjYW1wbyBwYXJhIGFsdGFzIFNBUCAoY2xpZW50X2FwcGxpY2F0aW9ucy5jcmVkaXRvQ2hlcXVlKS5cclxuICAgICAgICAgICAgJ0NyZWRpdG8gY2hlcXVlIChBUlMpJzogYS5jcmVkaXRvQ2hlcXVlICE9IG51bGwgPyBOdW1iZXIoYS5jcmVkaXRvQ2hlcXVlKSA6ICcnLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3YsIGxvYywgbm9tYnJlKVxyXG4gICAgICAgIClcclxuICAgICAgKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gT3JkZW5hciBwb3IgcHJvdmluY2lhLCBsb2NhbGlkYWQsIG5vbWJyZS5cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcclxuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xyXG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xyXG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcclxuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcclxuICAgIHJldHVybiAoYVsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS5sb2NhbGVDb21wYXJlKGJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJyk7XHJcbiAgfSk7XHJcblxyXG4gIGlmICghcm93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXHJcbiAgICAgICAgJ0VsIG1hc3RlcmZpbGUgaW5jbHV5ZTpcXG4nICtcclxuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xyXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXHJcbiAgICAgICAgJ1NpIG5vIHZlcyBuaW5ndW5vLCByZXZpc2EgZWwgbW9kYWwgU0FQIG8gQWx0YSBDbGllbnRlcy4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgLy8gdjEwNDMgKDIwMjYtMDktMjMpOiBwb3N0LXByb2Nlc28gXHUyMDE0IHNhY2FyIGNvbHVtbmFzIDEwMCUgdmFjXHUwMEVEYXMuXHJcbiAgLy8gUmVwb3J0ZSBNYXJpYW5vOiBtYXN0ZXJmaWxlIGV4cG9ydGFiYSAzNyBjb2x1bW5hcyBkb25kZSBtdWNoYXMgdmVuXHUwMEVEYW5cclxuICAvLyB2YWNcdTAwRURhcyBwb3JxdWUgbm8gaGFiXHUwMEVEYSB2aXNpdGFzL2NvbnRhY3RvcyBjYXJnYWRvcyBwYXJhIGVzb3MgY2xpZW50ZXMuXHJcbiAgLy8gRml4OiBpZGVudGlmaWNhciBrZXlzIGRvbmRlIFRPREFTIGxhcyBmaWxhcyB0aWVuZW4gdmFsb3IgXCJ2YWNcdTAwRURvXCIgKGVtcHR5XHJcbiAgLy8gc3RyaW5nLCBudWxsLCB1bmRlZmluZWQpIHkgcmVtb3ZlcmxhcyBhbnRlcyBkZWwgc2hlZXQuIExvcyBjb250ZW9zXHJcbiAgLy8gKFRvdGFsIHZpc2l0YXMvY29udGFjdG9zKSBzZSBjb25zaWRlcmFuIHZhY1x1MDBFRG9zIHNpIHRvZG9zIHNvbiAwLlxyXG4gIC8vIFdpZHRocyBwb3IgY29sdW1uLW5hbWUgKGVuIHZleiBkZSBwb3NpY2lvbmFsKSBwYXJhIHF1ZSBlbCBmaWx0ZXIgbm9cclxuICAvLyBkZXNhbGluZWUgZWwgc2hlZXQgY3VhbmRvIHJlbW92ZW1vcyBjb2x1bW5hcy5cclxuICBjb25zdCBDT0xfV0lEVEhTID0ge1xyXG4gICAgJ0NhcmRDb2RlIFNBUCc6IDE2LFxyXG4gICAgJ05vbWJyZSB0aWVuZGEnOiAzOCxcclxuICAgICdBbGlhcyAobW9kYWwpJzogMjgsXHJcbiAgICBUaXBvOiAxNCxcclxuICAgIEVzdGFkbzogMTQsXHJcbiAgICBQcm92aW5jaWE6IDIyLFxyXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknOiAyMixcclxuICAgIERlcGFydGFtZW50bzogMjIsXHJcbiAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IDI4LFxyXG4gICAgWm9uYTogOCxcclxuICAgICdFdGlxdWV0YSB6b25hJzogNDgsXHJcbiAgICAnQXNlc29yIGludGVybm8gKFZESSknOiAyOCxcclxuICAgIERpcmVjY2lvbjogMzgsXHJcbiAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IDI0LFxyXG4gICAgJ0xhdCAoZ2VvY29kZSknOiAxNCxcclxuICAgICdMbmcgKGdlb2NvZGUpJzogMTQsXHJcbiAgICAnQ3JlZGl0byBjaGVxdWUgKEFSUyknOiAxOCxcclxuICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcclxuICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IDE0LFxyXG4gICAgJ1RvdGFsIHZpc2l0YXMnOiAxMCxcclxuICAgICdUb3RhbCBjb250YWN0b3MnOiAxMCxcclxuICAgICdUaXBvIGNvbWVyY2lvJzogMTgsXHJcbiAgICBMb2NhbDogMTYsXHJcbiAgICBUYW1hbm86IDEyLFxyXG4gICAgRmlkZWxpZGFkOiAxNCxcclxuICAgIEVzcGVjaWFsaXphY2lvbjogMjAsXHJcbiAgICAnQ2FuYWwgZGUgY29tcHJhJzogMjAsXHJcbiAgICBSZWxldmFuY2lhOiAxMCxcclxuICAgIFBPUDogOCxcclxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IDI2LFxyXG4gICAgJ1RpcG8gZGUgdmVudGEnOiAxNixcclxuICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogMTgsXHJcbiAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAxOCxcclxuICAgIENvbXBldGVuY2lhOiAyNixcclxuICAgIE9wb3J0dW5pZGFkOiAyNixcclxuICAgICdNYXMgdmVuZGlkbyc6IDIyLFxyXG4gICAgJ01hcyBwcmVndW50YW4nOiAyMixcclxuICAgICdBeXVkYSB0aWVuZGEnOiAyNixcclxuICB9O1xyXG4gIC8vIERldGVjdGFyIGtleXMgMTAwJSB2YWNcdTAwRURhcy5cclxuICBjb25zdCBhbGxLZXlzID0gT2JqZWN0LmtleXMoQ09MX1dJRFRIUyk7XHJcbiAgY29uc3QgTlVNRVJJQ19aRVJPX09LID0gbmV3IFNldChbJ1RvdGFsIHZpc2l0YXMnLCAnVG90YWwgY29udGFjdG9zJywgJ0NyZWRpdG8gY2hlcXVlIChBUlMpJ10pO1xyXG4gIGNvbnN0IGVtcHR5S2V5cyA9IG5ldyBTZXQoXHJcbiAgICBhbGxLZXlzLmZpbHRlcigoaykgPT4ge1xyXG4gICAgICAvLyBTa2lwIGNvbHVtbmFzIGNvcmUgcXVlIFNJRU1QUkUgc2UgbXVlc3RyYW4gYXVucXVlIGVzdFx1MDBFOW4gdmFjXHUwMEVEYXMuXHJcbiAgICAgIC8vIChDYXJkQ29kZS9Ob21icmUgc29uIG9wY2lvbmFsZXMgdFx1MDBFOWNuaWNhbWVudGUgcGVybyBjbGllbnRlIHNpbiBub21icmVcclxuICAgICAgLy8geWEgbm8gbGxlZ2EgaGFzdGEgYWNcdTAwRTEuKVxyXG4gICAgICByZXR1cm4gcm93cy5ldmVyeSgocikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHYgPSByW2tdO1xyXG4gICAgICAgIGlmICh2ID09PSAnJyB8fCB2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgaWYgKE5VTUVSSUNfWkVST19PSy5oYXMoaykgJiYgdiA9PT0gMCkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICB9KTtcclxuICAgIH0pXHJcbiAgKTtcclxuICBjb25zdCBrZXB0S2V5cyA9IGFsbEtleXMuZmlsdGVyKChrKSA9PiAhZW1wdHlLZXlzLmhhcyhrKSk7XHJcbiAgY29uc3Qgcm93c0ZpbHRlcmVkID0gcm93cy5tYXAoKHIpID0+IHtcclxuICAgIGNvbnN0IG91dCA9IHt9O1xyXG4gICAga2VwdEtleXMuZm9yRWFjaCgoaykgPT4ge1xyXG4gICAgICBvdXRba10gPSByW2tdO1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gb3V0O1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlbW92ZWRDb3VudCA9IGVtcHR5S2V5cy5zaXplO1xyXG4gIGlmIChyZW1vdmVkQ291bnQgPiAwKSB7XHJcbiAgICBjb25zb2xlLmxvZyhgW21hc3RlcmZpbGVdIHJlbW92aWRhcyAke3JlbW92ZWRDb3VudH0gY29scyB2YWNcdTAwRURhczpgLCBbLi4uZW1wdHlLZXlzXS5qb2luKCcsICcpKTtcclxuICB9XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93c0ZpbHRlcmVkLCB7IGhlYWRlcjoga2VwdEtleXMgfSk7XHJcbiAgd3NbJyFjb2xzJ10gPSBrZXB0S2V5cy5tYXAoKGspID0+ICh7IHdjaDogQ09MX1dJRFRIU1trXSB8fCAxNSB9KSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdDbGllbnRlcyBoYWJpbGl0YWRvcyBTQVAnKTtcclxuXHJcbiAgLy8gSG9qYSByZXN1bWVuIHBvciB6b25hXHJcbiAgY29uc3QgYnlab25lID0ge307XHJcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XHJcbiAgICBjb25zdCB6ID0gclsnRXRpcXVldGEgem9uYSddIHx8ICdTaW4gem9uYSc7XHJcbiAgICBpZiAoIWJ5Wm9uZVt6XSkgYnlab25lW3pdID0geyB0b3RhbDogMCwgaGFiaWxpdGFkb3M6IDAsIGNhbmNlbGFkb3M6IDAgfTtcclxuICAgIGJ5Wm9uZVt6XS50b3RhbCsrO1xyXG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xyXG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gT2JqZWN0LmVudHJpZXMoYnlab25lKVxyXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xyXG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcclxuICAgICAgJ1RvdGFsIHRpZW5kYXMnOiBkLnRvdGFsLFxyXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcclxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxyXG4gICAgfSkpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVG90YWwgdGllbmRhcyddIC0gYVsnVG90YWwgdGllbmRhcyddKTtcclxuICBjb25zdCB3c1JlcyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyZXN1bWVuUm93cyk7XHJcbiAgd3NSZXNbJyFjb2xzJ10gPSBbeyB3Y2g6IDQ4IH0sIHsgd2NoOiAxNCB9LCB7IHdjaDogMTQgfSwgeyB3Y2g6IDE0IH1dO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUmVzLCAnUmVzdW1lbiBwb3Igem9uYScpO1xyXG5cclxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcclxuICAvLyBkZWwgZXhwb3J0IGdsb2JhbCBkZWwgYWRtaW4uXHJcbiAgY29uc3Qgc2NvcGVMYmwgPVxyXG4gICAgc2NvcGVTZXQgPT09IG51bGxcclxuICAgICAgPyAnVE9ET1MnXHJcbiAgICAgIDogc2NvcGVTZXQuc2l6ZSA9PT0gMVxyXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXHJcbiAgICAgICAgOiAnbWlzLXpvbmFzLScgKyBzY29wZVNldC5zaXplO1xyXG4gIGNvbnN0IGZuYW1lID0gJ01hc3RlcmZpbGVfQ2xpZW50ZXNfU0FQXycgKyBzY29wZUxibCArICdfJyArIHRzICsgJy54bHN4JztcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgZm5hbWUpO1xyXG4gIHNob3dTeW5jVGFnKFxyXG4gICAgcm93cy5sZW5ndGggK1xyXG4gICAgICAnIGNsaWVudGVzIGV4cG9ydGFkb3MnICtcclxuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcclxuICApO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4cG9ydDogUHJlY2lvcyArIFN0b2NrIHBvciBTS1VcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xyXG4vLyBlbiBtZW1vcmlhOiBQUk9EVUNUUyAobWFzdGVyIGRlIFNLVXMpLCBQUklDRV9MSVNUX01BUCAocHJlY2lvIEFSUyBkZVxyXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cclxuLy8gSG9qYXM6XHJcbi8vICAtIFwiUHJlY2lvcyB5IFN0b2NrXCI6IHVuYSBmaWxhIHBvciBTS1UgY29uIHRvZGFzIGxhcyBjb2x1bW5hcyBqdW50YXNcclxuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxyXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cclxuLy8gIC0gXCJTdG9ja1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgZXN0YWRvIGRlIHN0b2NrLlxyXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXHJcbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XHJcbiAgLy8gdjU3NCAoMjAyNi0wOC0yMSk6IHBlZGlkbyBkZSBNYXJpYW5vIFx1MjAxNCBtb3N0cmFyIFVOSURBREVTIG51bWVyaWNhc1xyXG4gIC8vIGV4YWN0YXMgZGVsIGRlcG9zaXRvIDExICh2ZW50YSkgZW4gdmV6IGRlIFwiRGlzcG9uaWJsZVwiL1wiU2luIHN0b2NrXCIuXHJcbiAgLy8gVXNhIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIHF1ZSBsZWUgU1RPQ0tfV0FSRUhPVVNFX0JSRUFLRE9XTltza3VdWycxMSddLlxyXG4gIC8vIFJldG9ybmEgJycgKGNlbGRhIHZhY2lhKSBjdWFuZG8gbm8gaGF5IGRhdG8gZGUgc3RvY2sgKHNuYXBzaG90IG5vIGNhcmdhZG9cclxuICAvLyBhdW4pOyAwIHNpIGVsIFNLVSBubyB0aWVuZSBzdG9jay4gTG9zIG51bWVyb3MgcGVybWl0ZW4gc29ydC9maWx0ZXIvc3VtIGVuXHJcbiAgLy8gRXhjZWwgXHUyMDE0IG5vIHBlcmRlbW9zIGVsIGVzdGFkbyBcIm5vIGRhdG9cIiB2cyBcIjAgdW5pZGFkZXNcIiBncmFjaWFzIGFsICcnLlxyXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xyXG4gICAgY29uc3QgZm4gPVxyXG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXHJcbiAgICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGFcclxuICAgICAgICA6IG51bGw7XHJcbiAgICBjb25zdCB2ID0gZm4gPyBmbihza3UpIDogbnVsbDtcclxuICAgIGlmICh2ID09IG51bGwpIHJldHVybiAnJztcclxuICAgIHJldHVybiBOdW1iZXIodikgfHwgMDtcclxuICB9XHJcbiAgZnVuY3Rpb24gZm10UHJlY2lvKHNrdSkge1xyXG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcclxuICAgIGlmIChwID09IG51bGwpIHJldHVybiAnJztcclxuICAgIHJldHVybiBOdW1iZXIocCkgfHwgMDtcclxuICB9XHJcbiAgLy8gSG9qYSAxOiBjb21ibyBjb21wbGV0byAoZXMgbGEgbWFzIHBlZGlkYSkuXHJcbiAgY29uc3Qgcm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcclxuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxyXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcclxuICAgIEZhbWlsaWE6IHAuZmFtIHx8ICcnLFxyXG4gICAgU3ViZmFtaWxpYTogcC5zdWIgfHwgJycsXHJcbiAgICBDYXRlZ29yaWE6IHAuY2F0IHx8ICcnLFxyXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcclxuICAgICdTdG9jayBXMTEnOiBmbXRTdG9jayhwLmNvZGUpLFxyXG4gIH0pKS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDYwIH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gIF07XHJcbiAgLy8gQXBsaWNhciBmb3JtYXRvIG1vbmVkYSBhIGxhIGNvbHVtbmEgUHJlY2lvIEFSUyAoY29sdW1uYSBGID0gNikuXHJcbiAgZm9yIChsZXQgaSA9IDI7IGkgPD0gcm93cy5sZW5ndGggKyAxOyBpKyspIHtcclxuICAgIGNvbnN0IGNlbGwgPSB3c1snRicgKyBpXTtcclxuICAgIGlmIChjZWxsICYmIHR5cGVvZiBjZWxsLnYgPT09ICdudW1iZXInKSBjZWxsLnogPSAnXCIkXCIjLCMjMCc7XHJcbiAgfVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnUHJlY2lvcyB5IFN0b2NrJyk7XHJcblxyXG4gIC8vIEhvamEgMjogc29sbyBQcmVjaW9zXHJcbiAgY29uc3QgcHJlY2lvc1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XHJcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcclxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXHJcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxyXG4gIH0pKVxyXG4gICAgLmZpbHRlcigocikgPT4gclsnUHJlY2lvIEFSUyddICE9PSAnJylcclxuICAgIC5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICBjb25zdCB3c1AgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocHJlY2lvc1Jvd3MpO1xyXG4gIHdzUFsnIWNvbHMnXSA9IFt7IHdjaDogMTQgfSwgeyB3Y2g6IDYwIH0sIHsgd2NoOiAxNCB9XTtcclxuICBmb3IgKGxldCBpID0gMjsgaSA8PSBwcmVjaW9zUm93cy5sZW5ndGggKyAxOyBpKyspIHtcclxuICAgIGNvbnN0IGNlbGwgPSB3c1BbJ0MnICsgaV07XHJcbiAgICBpZiAoY2VsbCAmJiB0eXBlb2YgY2VsbC52ID09PSAnbnVtYmVyJykgY2VsbC56ID0gJ1wiJFwiIywjIzAnO1xyXG4gIH1cclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1AsICdQcmVjaW9zJyk7XHJcblxyXG4gIC8vIEhvamEgMzogc29sbyBTdG9ja1xyXG4gIGNvbnN0IHN0b2NrUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcclxuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxyXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcclxuICAgICdTdG9jayBXMTEnOiBmbXRTdG9jayhwLmNvZGUpLFxyXG4gIH0pKS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICBjb25zdCB3c1MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoc3RvY2tSb3dzKTtcclxuICB3c1NbJyFjb2xzJ10gPSBbeyB3Y2g6IDE0IH0sIHsgd2NoOiA2MCB9LCB7IHdjaDogMTQgfV07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NTLCAnU3RvY2snKTtcclxuXHJcbiAgLy8gSG9qYSA0OiBtZXRhZGF0YSAtIGN1YW5kbyBmdWUgY2FkYSBzbmFwc2hvdCBwYXJhIHF1ZSBlbCBsZWN0b3Igc2VwYVxyXG4gIC8vIHNpIGxhIGxpc3RhIGVzdGEgZnJlc2NhLlxyXG4gIGNvbnN0IGluZm9Sb3dzID0gW1xyXG4gICAgeyBJdGVtOiAnVG90YWwgU0tVcyBlbiBjYXRhbG9nbycsIFZhbG9yOiBQUk9EVUNUUy5sZW5ndGggfSxcclxuICAgIHsgSXRlbTogJ1RvdGFsIFNLVXMgY29uIHByZWNpbyBjYXJnYWRvJywgVmFsb3I6IHByZWNpb3NSb3dzLmxlbmd0aCB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBjb24gc3RvY2sgZGlzcG9uaWJsZScsXHJcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT09IHRydWUpLmxlbmd0aCxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdUb3RhbCBTS1VzIHNpbiBzdG9jaycsXHJcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT09IGZhbHNlKS5sZW5ndGgsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnVG90YWwgU0tVcyBzaW4gZGF0byBkZSBzdG9jaycsXHJcbiAgICAgIFZhbG9yOiBQUk9EVUNUUy5maWx0ZXIoKHApID0+IGhhc1N0b2NrKHAuY29kZSkgPT0gbnVsbCkubGVuZ3RoLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ0xpc3RhIGRlIHByZWNpb3MgbW9uZWRhJyxcclxuICAgICAgVmFsb3I6IHR5cGVvZiBQUklDRV9MSVNUX0NVUlJFTkNZICE9PSAndW5kZWZpbmVkJyA/IFBSSUNFX0xJU1RfQ1VSUkVOQ1kgOiAnQVJTJyxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIEl0ZW06ICdMaXN0YSBkZSBwcmVjaW9zIGFjdHVhbGl6YWRhJyxcclxuICAgICAgVmFsb3I6XHJcbiAgICAgICAgdHlwZW9mIFBSSUNFX0xJU1RfVVBEQVRFRF9BVCAhPT0gJ3VuZGVmaW5lZCcgJiYgUFJJQ0VfTElTVF9VUERBVEVEX0FUXHJcbiAgICAgICAgICA/IG5ldyBEYXRlKFBSSUNFX0xJU1RfVVBEQVRFRF9BVCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJylcclxuICAgICAgICAgIDogJyhubyBjYXJnYWRhKScsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBJdGVtOiAnU3RvY2sgc25hcHNob3QgYWN0dWFsaXphZG8nLFxyXG4gICAgICBWYWxvcjogU1RPQ0tfVVBEQVRFRF9BVCA/IG5ldyBEYXRlKFNUT0NLX1VQREFURURfQVQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIDogJyhubyBjYXJnYWRvKScsXHJcbiAgICB9LFxyXG4gICAgeyBJdGVtOiAnRXhwb3J0YWRvJywgVmFsb3I6IG5ldyBEYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgfSxcclxuICAgIHtcclxuICAgICAgSXRlbTogJ0V4cG9ydGFkbyBwb3InLFxyXG4gICAgICBWYWxvcjogKGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSkpIHx8ICcoZGVzY29ub2NpZG8pJyxcclxuICAgIH0sXHJcbiAgXTtcclxuICBjb25zdCB3c0kgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoaW5mb1Jvd3MpO1xyXG4gIHdzSVsnIWNvbHMnXSA9IFt7IHdjaDogMzYgfSwgeyB3Y2g6IDM2IH1dO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzSSwgJ0luZm8nKTtcclxuXHJcbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnUHJlY2lvc195X1N0b2NrXycgKyB0cyArICcueGxzeCcpO1xyXG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKHByZWNpb3MgKyBzdG9jayknKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3NcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIEZpbHRyYXIgb3BjaW9uZXMgc2VndW4gcm9sLlxyXG4gIC8vICAgdmVuZGVkb3I6IG9wZXJhdGl2byBkaWFyaW8gKFZlbnRhcyAvIFZpc2l0YXMgLyBSdXRhcykgKyBDbGllbnRlcyBkZSBzdSB6b25hXHJcbiAgLy8gICAgIChleHBvcnRNYXN0ZXJDbGllbnRlcyB5YSBmaWx0cmEgcG9yIGdldEVmZmVjdGl2ZVZlbmRvclNldCAtPiBzb2xvIHN1IHZlbmRvcikuXHJcbiAgLy8gICBpbnRlcm5vIChWREkpOiBtaXNtbyBzY29wZSBvcGVyYXRpdm8gKyBDbGllbnRlcyBkZSBzdXMgcGFyZWphcyAobyBzb2xvIGVsXHJcbiAgLy8gICAgIHByb3BpbyBzaSBlbGlnaW8gc3Ugbm9tYnJlIGVuIGVsIGRyb3Bkb3duIGRlIHpvbmFzKS5cclxuICAvLyAgIGFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogdmVuIHRvZG8gZWwgbGlzdGFkbyAobnVsbCA9IHNpbiBmaWx0cm8pLlxyXG4gIGNvbnN0IGFsbG93ZWRCeVJvbGUgPSB7XHJcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogVkVOVEFTIHkgUlVUQVMgZWxpbWluYWRvcyBkZWwgVUkgcG9yIHBlZGlkbyBkZSBNYXJpYW5vLlxyXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcclxuICAgIGludGVybm86IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcclxuICB9O1xyXG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cclxuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcclxuICAgIGNvbnN0IGtpbmQgPSBlbC5kYXRhc2V0LmV4cEtpbmQgfHwgJyc7XHJcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCkgPyAnJyA6ICdub25lJztcclxuICB9KTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VFeHBvcnREaWFsb2cgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xyXG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XHJcbiAgVkVOVEFTOiAnVmVudGFzJyxcclxuICBWSVNJVEFTOiAnVmlzaXRhcycsXHJcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXHJcbiAgUlVUQVM6ICdSdXRhcycsXHJcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXHJcbiAgQkFDS09SREVSOiAnQmFja29yZGVyJyxcclxuICBTVE9DS19BU0lHOiAnU3RvY2sgQXNpZ25hZG8nLFxyXG4gIFBFRElET1NfTUVTOiAnUGVkaWRvcyBkZWwgbWVzJyxcclxufTtcclxuXHJcbndpbmRvdy5zaG93TW9udGhQaWNrZXIgPSBmdW5jdGlvbiAodGlwbykge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gdGlwbztcclxuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xyXG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xyXG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0V4cG9ydGFyICcgKyAoRVhQT1JUX1RZUEVfTEFCRUxTW3RpcG9dIHx8IHRpcG8pO1xyXG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcclxuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXHJcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XHJcbiAgbWVzU2VsLmlubmVySFRNTCA9XHJcbiAgICAnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zIGxvcyBtZXNlcyAoYVx1MDBGMW8gZW50ZXJvKTwvb3B0aW9uPicgK1xyXG4gICAgTUVTRVMubWFwKChtLCBpKSA9PiAnPG9wdGlvbiB2YWx1ZT1cIicgKyBpICsgJ1wiPicgKyBtICsgJzwvb3B0aW9uPicpLmpvaW4oJycpO1xyXG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xyXG4gIGNvbnN0IGFuaW9TZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpO1xyXG4gIGNvbnN0IHllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcclxuICBsZXQgeW9wdHMgPSAnJztcclxuICBmb3IgKGxldCB5ID0geWVhciAtIDM7IHkgPD0geWVhciArIDE7IHkrKylcclxuICAgIHlvcHRzICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIHkgKyAnXCI+JyArIHkgKyAnPC9vcHRpb24+JztcclxuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xyXG4gIGFuaW9TZWwudmFsdWUgPSB5ZWFyO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VNb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5jb25maXJtTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xyXG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcclxuICBjb25zdCBhbmlvID0gcGFyc2VJbnQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKS52YWx1ZSwgMTApO1xyXG4gIGNvbnN0IG1vbnRoSWR4ID0gbWVzUmF3ID09PSAnQUxMJyA/IG51bGwgOiBwYXJzZUludChtZXNSYXcsIDEwKTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcclxuICBpZiAoIXRpcG8pIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgaWYgKHRpcG8gPT09ICdWRU5UQVMnKSBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcclxuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSVVRBUycpIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0FMVEFTJykgZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQkFDS09SREVSJykgZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1NUT0NLX0FTSUcnKSBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCk7XHJcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUEVESURPU19NRVMnKSBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xyXG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydCAnICsgdGlwbywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGV4cG9ydDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHJldHVybiBTdHJpbmcoYW5pbyk7XHJcbiAgcmV0dXJuIE1FU0VTW21vbnRoSWR4XSArICdfJyArIGFuaW87XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzKSB7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgZm9yIChjb25zdCBzIG9mIHNoZWV0cykge1xyXG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXHJcbiAgICAgIHMucm93cy5sZW5ndGggPyBzLnJvd3MgOiBbeyBBdmlzbzogJ1NpbiBkYXRvcyBwYXJhIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvJyB9XVxyXG4gICAgKTtcclxuICAgIGlmIChzLnJvd3MubGVuZ3RoKSB7XHJcbiAgICAgIGNvbnN0IGNvbHMgPSBPYmplY3Qua2V5cyhzLnJvd3NbMF0pLm1hcCgoaykgPT4gKHtcclxuICAgICAgICB3Y2g6IE1hdGgubWluKDQwLCBNYXRoLm1heCgxMCwgay5sZW5ndGggKyA0KSksXHJcbiAgICAgIH0pKTtcclxuICAgICAgd3NbJyFjb2xzJ10gPSBjb2xzO1xyXG4gICAgfVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsIHMubmFtZS5zbGljZSgwLCAzMSkpO1xyXG4gIH1cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgZmlsZW5hbWUpO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcGVkaWRvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCBwID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBpZiAocGFyc2VJbnQocC55ZWFyLCAxMCkgIT09IGFuaW8pIHJldHVybjtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICBjb25zdCBsaW5lcyA9IHAubGluZXMgfHwgW107XHJcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgcmV0dXJuO1xyXG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcclxuICAgIGNvbnN0IHZlbmRvckluZm8gPSB2ZW5kb3JMb29rdXBbdmVuZG9yS2V5XSB8fCB7fTtcclxuICAgIGNvbnN0IGZhY3RvciA9IHR5cGVvZiBwZWRpZG9EaXNjb3VudEZhY3RvciA9PT0gJ2Z1bmN0aW9uJyA/IHBlZGlkb0Rpc2NvdW50RmFjdG9yKHApIDogMTtcclxuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcclxuICAgIGxpbmVzLmZvckVhY2goKGwpID0+IHtcclxuICAgICAgY29uc3QgcXR5ID0gcGFyc2VGbG9hdChsLnF0eSkgfHwgMDtcclxuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcclxuICAgICAgY29uc3QgZ3Jvc3MgPSBxdHkgKiBwcmVjaW87XHJcbiAgICAgIGNvbnN0IG5ldCA9IGdyb3NzICogZmFjdG9yO1xyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcclxuICAgICAgICBGZWNoYV9Db25maXJtYWRvOiBwLmNvbmZpcm1lZEF0ID8gU3RyaW5nKHAuY29uZmlybWVkQXQpLnNsaWNlKDAsIDEwKSA6ICcnLFxyXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvcktleSB8fCAnJyksXHJcbiAgICAgICAgWm9uYTogdmVuZG9ySW5mby56b25lIHx8ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxyXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCAnJyxcclxuICAgICAgICBDYXRlZ29yaWE6IGwuY2F0IHx8ICcnLFxyXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxyXG4gICAgICAgIFN1YmZhbWlsaWE6IGwuc3ViIHx8ICcnLFxyXG4gICAgICAgIENhbnRpZGFkOiBxdHksXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXHJcbiAgICAgICAgLy8gU3VidG90YWxfQVJTID0gTkVUTyAoY29uIGRlc2N1ZW50byBhcGxpY2FkbykgLSBlcyBsbyBxdWUgY3VlbnRhXHJcbiAgICAgICAgLy8gcGFyYSBlbCB0YXJnZXQgZGVsIHZlbmRlZG9yLiBTdWJ0b3RhbF9CcnV0b19BUlMgbXVlc3RyYSBlbCB2YWxvclxyXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXHJcbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKG5ldCksXHJcbiAgICAgICAgU3VidG90YWxfQnJ1dG9fQVJTOiBNYXRoLnJvdW5kKGdyb3NzKSxcclxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxyXG4gICAgICAgIEVuX05vbWJyZV9EZV9WREU6IHAub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxyXG4gICAgICAgIENhcmdhZG9fUG9yOiBwLmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHAuY3JlYXRlZEJ5RW1haWwgfHwgJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnVmVudGFzJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBWZW50YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBsb29rdXBWZW5kb3JGb3JDbGllbnQocHJvdiwgbG9jTmFtZSwgX2NsaWVudE5hbWUpIHtcclxuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcclxuICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92ICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XHJcbiAgcmV0dXJuIHB0ID8gcHQudmVuZG9yIHx8ICcnIDogJyc7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcclxuICBsZXQgc25hcDtcclxuICB0cnkge1xyXG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gdmlzaXRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCB0YXJnZXRNZXMgPSBtb250aElkeCAhPT0gbnVsbCA/IE1FU0VTW21vbnRoSWR4XS50b1VwcGVyQ2FzZSgpIDogbnVsbDtcclxuICBjb25zdCBpdGVtcyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgdiA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAodGFyZ2V0TWVzICYmICh2Lm1lcyB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdGFyZ2V0TWVzKSByZXR1cm47XHJcbiAgICBpdGVtcy5wdXNoKHYpO1xyXG4gIH0pO1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgbmkgY29udGFjdG9zIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBuVmlzaXRhcyA9IGl0ZW1zLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aDtcclxuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XHJcbiAgLy8gRXhjZWxKUyBjb24gZm90byBkZWwgZnJlbnRlIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gTGF6eSBsb2FkLlxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbDogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3Rvcy4uLicsIDMwMDApO1xyXG5cclxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XHJcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcclxuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcclxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnVmlzaXRhcyB5IENvbnRhY3RvcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xyXG4gIHdzLmNvbHVtbnMgPSBbXHJcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0FuaW8nLCBrZXk6ICdhbmlvJywgd2lkdGg6IDggfSxcclxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0ludGVyYWNjaW9uJywga2V5OiAnaW50ZXJhY2Npb24nLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnRm9ybWEgQ29udGFjdG8nLCBrZXk6ICdmb3JtYUNvbnRhY3RvJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1Jlc3VsdGFkbyBDb250YWN0bycsIGtleTogJ3Jlc3VsdGFkb0N0Jywgd2lkdGg6IDE2IH0sXHJcbiAgICB7IGhlYWRlcjogJ0NvbWVudGFyaW8nLCBrZXk6ICdjb21lbnQnLCB3aWR0aDogMzAgfSxcclxuICAgIHsgaGVhZGVyOiAnUHJvdmluY2lhJywga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2IH0sXHJcbiAgICB7IGhlYWRlcjogJ0xvY2FsaWRhZCcsIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaWVuZGEnLCBrZXk6ICd0aWVuZGEnLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnTG9jYWwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdUYW1hbm8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnRmlkZWxpZGFkJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1JlbGV2YW5jaWEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdOZWNlc2lkYWQgUHVudHVhbCcsIGtleTogJ25lYycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPcG9ydHVuaWRhZCcsIGtleTogJ29wb3J0dScsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdNYXMgVmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ01hcyBQcmVndW50YW4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdBeXVkYSBUaWVuZGEnLCBrZXk6ICdheXVkYScsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvIFZlbnRhJywga2V5OiAndGlwb1ZlbnRhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BvbmQgTW9zdHJhZG9yJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUG9uZCBFY29tbWVyY2UnLCBrZXk6ICdwRWNvbScsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb21wZXRlbmNpYScsIGtleTogJ2NvbXBlJywgd2lkdGg6IDE2IH0sXHJcbiAgICB7IGhlYWRlcjogJ0dQUyBTdGF0dXMnLCBrZXk6ICdncHNTdCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdHUFMgRGlzdCAobSknLCBrZXk6ICdncHNEaXN0Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ZvdG8gZnJlbnRlJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdFbiBub21icmUgZGUgVkRFJywga2V5OiAnb25CZWhhbGYnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnQ2FyZ2FkbyBQb3InLCBrZXk6ICdjcmVhdGVkQnknLCB3aWR0aDogMjQgfSxcclxuICBdO1xyXG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcclxuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XHJcblxyXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7XHJcbiAgY29uc3QgUk9XX0ggPSAxMDA7XHJcbiAgY29uc3QgSU1HX1cgPSAxMzA7XHJcbiAgY29uc3QgSU1HX0ggPSA5MDtcclxuXHJcbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xyXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcclxuXHJcbiAgZm9yIChjb25zdCB2IG9mIGl0ZW1zKSB7XHJcbiAgICBjb25zdCBpc0NvbnRhY3RvID0gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0byc7XHJcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XHJcbiAgICBjb25zdCBmb3JtYUNvbnRhY3RvTGJsID0gaXNDb250YWN0byA/IHYuZm9ybWFDb250YWN0byB8fCAnU2luIGVzcGVjaWZpY2FyJyA6ICdQcmVzZW5jaWFsJztcclxuICAgIGxldCByZXN1bHRhZG9DdExibCA9ICcnO1xyXG4gICAgaWYgKGlzQ29udGFjdG8pIHtcclxuICAgICAgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdyZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdSZXNwb25kaW8nO1xyXG4gICAgICBlbHNlIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAnbm9fcmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnTm8gcmVzcG9uZGlvJztcclxuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcclxuICAgIH1cclxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XHJcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxyXG4gICAgICBtZXM6IHYubWVzIHx8ICcnLFxyXG4gICAgICBhbmlvOiB2LmFuaW8gfHwgJycsXHJcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxyXG4gICAgICBlbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgICBpbnRlcmFjY2lvbjogaW50ZXJhY2Npb25MYmwsXHJcbiAgICAgIGZvcm1hQ29udGFjdG86IGZvcm1hQ29udGFjdG9MYmwsXHJcbiAgICAgIHJlc3VsdGFkb0N0OiByZXN1bHRhZG9DdExibCxcclxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXHJcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgICAgbG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcclxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcclxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxyXG4gICAgICBsb2NhbDogdi5sb2NhbCB8fCAnJyxcclxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcclxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgcmVsZXY6IHYucmVsZXZhbmNpYSB8fCAnJyxcclxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcclxuICAgICAgbmVjOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXHJcbiAgICAgIG9wb3J0dTogdi5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgbWFzVmU6IHYubWFzVmVuZGlkbyB8fCAnJyxcclxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxyXG4gICAgICBheXVkYTogdi5heXVkYVRpZW5kYSB8fCAnJyxcclxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXHJcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXHJcbiAgICAgIHBFY29tOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIHx8ICcnLFxyXG4gICAgICBjb21wZTogdi5jb21wZXRlbmNpYSB8fCAnJyxcclxuICAgICAgZ3BzU3Q6IHYuZ3BzU3RhdHVzIHx8ICcnLFxyXG4gICAgICBncHNEaXN0OiB2Lmdwc0Rpc3RhbmNlTSAhPSBudWxsID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcclxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gaW1hZ2VuIGVuY2ltYVxyXG4gICAgICBvbkJlaGFsZjogdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXHJcbiAgICAgIGNyZWF0ZWRCeTogdi5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCB2LmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XHJcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XHJcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcclxuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xyXG4gICAgICAgIGlmIChtKSB7XHJcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICBiNjQgPSBtWzJdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxyXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byB2aXNpdGEnLCBlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19WaXNpdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgIGEuY2xpY2soKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IGxpc3RvOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zJywgMjQwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XHJcbiAgbGV0IHNuYXA7XHJcbiAgdHJ5IHtcclxuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcmVuZGljaW9uZXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRmlsdHJhciBwb3IgbWVzL2FuaW9cclxuICBjb25zdCBpdGVtcyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgciA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XHJcbiAgICBpZiAoIWR0ICYmIHIuY3JlYXRlZEF0ICYmIHIuY3JlYXRlZEF0LnRvRGF0ZSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfVxyXG4gICAgaWYgKCFkdCkgcmV0dXJuO1xyXG4gICAgY29uc3QgZE9iaiA9IG5ldyBEYXRlKGR0KTtcclxuICAgIGlmIChOdW1iZXIuaXNOYU4oZE9iai5nZXRUaW1lKCkpKSByZXR1cm47XHJcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XHJcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZE9iai5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgaXRlbXMucHVzaCh7IGlkOiBkLmlkLCBmZWNoYTogZHQsIHI6IHIgfSk7XHJcbiAgfSk7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgcmVuZGljaW9uZXMgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBDYXJnYSBsYXp5LlxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcclxuXHJcbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XHJcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1JlbmRpY2lvbmVzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XHJcbiAgd3MuY29sdW1ucyA9IFtcclxuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXHJcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnQ29uY2VwdG8nLCBrZXk6ICdjb25jZXB0bycsIHdpZHRoOiAxOCB9LFxyXG4gICAgeyBoZWFkZXI6ICdOIFRpY2tldCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdNb2RvIHBhZ28nLCBrZXk6ICdtb2RvUGFnbycsIHdpZHRoOiAxNCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvIGdhc3RvJywga2V5OiAndGlwb0dhc3RvJywgd2lkdGg6IDI0IH0sXHJcbiAgICB7IGhlYWRlcjogJ0RpdmlzaW9uJywga2V5OiAnZGl2aXNpb24nLCB3aWR0aDogMTQgfSxcclxuICAgIHsgaGVhZGVyOiAnSW1wb3J0ZScsIGtleTogJ2ltcG9ydGUnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnTW9uZWRhJywga2V5OiAnbW9uZWRhJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUgVVNEJywga2V5OiAnaW1wb3J0ZVVzZCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPYnNlcnZhY2lvbmVzJywga2V5OiAnb2JzJywgd2lkdGg6IDMwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ZvdG8gdGlja2V0Jywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdFc3RhZG8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcclxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG9yJywga2V5OiAnYXByb2JhZG9yJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvIGVuJywga2V5OiAnYXByb2JhZG9FbicsIHdpZHRoOiAxNCB9LFxyXG4gIF07XHJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGN0UyMkNFJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xyXG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcclxuXHJcbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcclxuICBjb25zdCBST1dfSCA9IDExMDtcclxuICBjb25zdCBJTUdfVyA9IDE0MDtcclxuICBjb25zdCBJTUdfSCA9IDEwMDtcclxuXHJcbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xyXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcclxuXHJcbiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykge1xyXG4gICAgY29uc3QgciA9IGl0LnI7XHJcbiAgICBjb25zdCBpc0dhc3RvID0gci50aXBvID09PSAnZ2FzdG8nO1xyXG4gICAgY29uc3QgY29uY2VwdFN0ciA9IGlzR2FzdG8gPyByLmRlc2NyaXBjaW9uIHx8ICcnIDogci50aXBvT3BlcmFjaW9uIHx8IHIubW90aXZvIHx8ICcnO1xyXG4gICAgY29uc3Qgb2JzU3RyID1cclxuICAgICAgKHIub2JzZXJ2YWNpb25lcyB8fCByLm5vdGFzIHx8ICcnKSArXHJcbiAgICAgIChpc0dhc3RvID8gJycgOiByLnNvbGljaXRhZG9Qb3IgPyAnIHwgU29saWNpdGFkbyBwb3I6ICcgKyByLnNvbGljaXRhZG9Qb3IgOiAnJyk7XHJcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xyXG4gICAgICBmZWNoYTogaXQuZmVjaGEsXHJcbiAgICAgIHRpcG86IHIudGlwbyB8fCAnJyxcclxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIGVtYWlsOiByLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIGNvbmNlcHRvOiBjb25jZXB0U3RyLFxyXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxyXG4gICAgICBtb2RvUGFnbzogci5tb2RvUGFnbyB8fCAnJyxcclxuICAgICAgdGlwb0dhc3RvOiByLnRpcG9HYXN0byB8fCAnJyxcclxuICAgICAgZGl2aXNpb246IHIuZGl2aXNpb25HYXN0byB8fCAnJyxcclxuICAgICAgaW1wb3J0ZTogci5pbXBvcnRlICE9IG51bGwgPyByLmltcG9ydGUgOiAnJyxcclxuICAgICAgbW9uZWRhOiByLm1vbmVkYSB8fCAnUEVTT1MnLFxyXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcclxuICAgICAgb2JzOiBvYnNTdHIsXHJcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGVuY2ltYSB2YSBsYSBpbWFnZW5cclxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcclxuICAgICAgYXByb2JhZG9yOiByLmFwcHJvdmVyRW1haWwgfHwgci5hcHJvYmFkb3IgfHwgJycsXHJcbiAgICAgIGFwcm9iYWRvRW46XHJcbiAgICAgICAgci5hcHByb3ZlZEF0ICYmIHIuYXBwcm92ZWRBdC50b0RhdGUgPyByLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgIH0pO1xyXG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xyXG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xyXG4gICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IFNJRU1QUkUgZW1iZWJlciBsYSBmb3RvIChubyBkZWphciBoeXBlcmxpbmspLlxyXG4gICAgLy8gQW50ZXM6IHNpIGZvdG9UaWNrZXRVcmwgKFN0b3JhZ2UpLCBxdWVkYWJhIGNvbW8gaHlwZXJsaW5rIEFicmlyIHRpY2tldC5cclxuICAgIC8vIEFob3JhOiBmZXRjaCBkZWwgVVJMICsgY29udmVydGlyIGEgYXJyYXlCdWZmZXIgKyBlbWJlYmVyIGlndWFsIHF1ZSBkYXRhVVJMLlxyXG4gICAgLy8gRmFsbGJhY2sgYSBoeXBlcmxpbmsgc29sbyBzaSBlbCBmZXRjaCBmYWxsYSAoQ09SUywgcmVkLCBldGMpLlxyXG4gICAgY29uc3QgZm90b1NyYyA9IHIuZm90b1RpY2tldCB8fCByLmFkanVudG8gfHwgJyc7XHJcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGV0IGI2NCA9IGZvdG9TcmM7XHJcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcclxuICAgICAgICBpZiAobSkge1xyXG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgICAgYjY0ID0gbVsyXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcclxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gcmVuZGljaW9uJywgaXQuaWQsIGUpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKHIuZm90b1RpY2tldFVybCAmJiB0eXBlb2Ygci5mb3RvVGlja2V0VXJsID09PSAnc3RyaW5nJykge1xyXG4gICAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogZmV0Y2ggbGEgZm90byBkZXNkZSBTdG9yYWdlIHkgZW1iZWJlcmxhIGNvbW8gaW1hZ2VuLlxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBmZXRjaChyLmZvdG9UaWNrZXRVcmwpO1xyXG4gICAgICAgIGlmICghcmVzcC5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByZXNwLnN0YXR1cyk7XHJcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwLmhlYWRlcnMuZ2V0KCdjb250ZW50LXR5cGUnKSB8fCAnaW1hZ2UvanBlZyc7XHJcbiAgICAgICAgbGV0IGV4dCA9IGNvbnRlbnRUeXBlLnNwbGl0KCcvJylbMV0gfHwgJ2pwZWcnO1xyXG4gICAgICAgIGV4dCA9IGV4dC5zcGxpdCgnOycpWzBdLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgYnVmID0gYXdhaXQgcmVzcC5hcnJheUJ1ZmZlcigpO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJ1ZmZlcjogYnVmLCBleHRlbnNpb246IGV4dCB9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxyXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAvLyBGYWxsYmFjazogc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCksIGRlamFyIGh5cGVybGluayBjb21vIGFudGVzLlxyXG4gICAgICAgIGNvbnNvbGUud2FybignZmV0Y2ggZm90byByZW5kaWNpb24gZmFsbG8sIGRlam8gaHlwZXJsaW5rJywgaXQuaWQsIGUpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XHJcbiAgICAgICAgICBjZWxsLnZhbHVlID0ge1xyXG4gICAgICAgICAgICB0ZXh0OiAnQWJyaXIgdGlja2V0JyxcclxuICAgICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXHJcbiAgICAgICAgICAgIHRvb2x0aXA6ICdBYnJpciBsYSBmb3RvIGRlbCB0aWNrZXQgZW4gZWwgYnJvd3NlciAoZmV0Y2ggZmFsbG8pJyxcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XHJcbiAgICAgICAgfSBjYXRjaCAoX2UyKSB7fVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XHJcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1JlbmRpY2lvbmVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgIGEuY2xpY2soKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFJlbmRpY2lvbmVzIGxpc3RvICgnICsgaXRlbXMubGVuZ3RoICsgJyBmaWxhcyknLCAyNDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gUlVUQVM6IHJ1dGFzIGFzaWduYWRhcyBkZWwgcGVyaW9kbyArIG92ZXJyaWRlc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XHJcbiAgLy8gTGFzIHJ1dGFzIHNlIGdlbmVyYW4gZW4gcnVudGltZSBwYXJhIGNhZGEgdmVuZGVkb3I7IGVuIGNhbWJpbyBsb3Mgb3ZlcnJpZGVzXHJcbiAgLy8gKGRlcml2YWNpb25lcyAvIHJlYWdlbmRhcykgdml2ZW4gZW4gcm91dGVfb3ZlcnJpZGVzLiBFeHBvcnRhbW9zOlxyXG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXHJcbiAgLy8gICAgZGVsIHJvbCBhY3R1YWwgbyB0b2RvcyBzaSBhZG1pbilcclxuICAvLyAgLSB1bmEgaG9qYSBjb24gbG9zIG92ZXJyaWRlcyBkZWwgcGVyaW9kb1xyXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPVxyXG4gICAgdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICd2aWV3ZXInXHJcbiAgICAgID8gVkVORE9SUy5tYXAoKHYpID0+IHYua2V5KVxyXG4gICAgICA6IGFzc2lnbmVkVmVuZG9yXHJcbiAgICAgICAgPyBbYXNzaWduZWRWZW5kb3JdXHJcbiAgICAgICAgOiBbXTtcclxuICBjb25zdCBtb250aHNUb0V4cG9ydCA9IG1vbnRoSWR4ICE9PSBudWxsID8gW21vbnRoSWR4XSA6IFswLCAxLCAyLCAzLCA0LCA1LCA2LCA3LCA4LCA5LCAxMCwgMTFdO1xyXG4gIGNvbnN0IHJ1dGFzUm93cyA9IFtdO1xyXG4gIGZvciAoY29uc3QgdmVuZCBvZiB0YXJnZXRWZW5kb3JzKSB7XHJcbiAgICBmb3IgKGNvbnN0IG0gb2YgbW9udGhzVG9FeHBvcnQpIHtcclxuICAgICAgbGV0IHJ1dGFzO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pO1xyXG4gICAgICB9IGNhdGNoIChfZSkge1xyXG4gICAgICAgIHJ1dGFzID0gW107XHJcbiAgICAgIH1cclxuICAgICAgKHJ1dGFzIHx8IFtdKS5mb3JFYWNoKChydXRhKSA9PiB7XHJcbiAgICAgICAgKHJ1dGEudGllbmRhcyB8fCBbXSkuZm9yRWFjaCgodCwgaSkgPT4ge1xyXG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xyXG4gICAgICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmQpLFxyXG4gICAgICAgICAgICBBbmlvOiBhbmlvLFxyXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxyXG4gICAgICAgICAgICBSdXRhX0lEOiBydXRhLmlkIHx8ICcnLFxyXG4gICAgICAgICAgICBSdXRhX05vbWJyZTogcnV0YS5ub21icmUgfHwgJycsXHJcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXHJcbiAgICAgICAgICAgIE9yZGVuOiBpICsgMSxcclxuICAgICAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UodC5wcm92aW5jZSB8fCAnJyksXHJcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgICAgICBUaWVuZGE6IHQuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICAgICAgVGlwbzogdC50aXBvIHx8ICcnLFxyXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICAvLyBPdmVycmlkZXNcclxuICBsZXQgb3ZyU25hcDtcclxuICB0cnkge1xyXG4gICAgb3ZyU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm91dGVfb3ZlcnJpZGVzJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoX2UpIHtcclxuICAgIG92clNuYXAgPSBudWxsO1xyXG4gIH1cclxuICBjb25zdCBvdmVycmlkZXNSb3dzID0gW107XHJcbiAgaWYgKG92clNuYXApIHtcclxuICAgIG92clNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICBjb25zdCBvID0gZC5kYXRhKCkgfHwge307XHJcbiAgICAgIGlmIChwYXJzZUludChvLmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xyXG4gICAgICBvdmVycmlkZXNSb3dzLnB1c2goe1xyXG4gICAgICAgIEFuaW86IG8uYW5pbyB8fCAnJyxcclxuICAgICAgICBNZXM6IE1FU0VTW3BhcnNlSW50KG8ubW9udGhJZHgsIDEwKV0gfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZShvLnZlbmRvciB8fCAnJyksXHJcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uoby5wcm92aW5jZSB8fCAnJyksXHJcbiAgICAgICAgTG9jYWxpZGFkOiBvLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgVGllbmRhOiBvLmNsaWVudE5hbWUgfHwgJycsXHJcbiAgICAgICAgQWNjaW9uOiBvLmFjdGlvbiB8fCBvLnRpcG8gfHwgJycsXHJcbiAgICAgICAgRGVyaXZhZGFfQTogby5kZXJpdmFkYUEgfHwgJycsXHJcbiAgICAgICAgUmVhZ2VuZGFkYV9QYXJhOiBvLnJlYWdlbmRhZGFQYXJhIHx8ICcnLFxyXG4gICAgICAgIE1vdGl2bzogby5tb3Rpdm8gfHwgJycsXHJcbiAgICAgICAgQ3JlYWRvX1Bvcjogby5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcclxuICAgICAgICBDcmVhZG9fRW46XHJcbiAgICAgICAgICBvLmNyZWF0ZWRBdCAmJiBvLmNyZWF0ZWRBdC50b0RhdGUgPyBvLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1J1dGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xyXG4gICAgeyBuYW1lOiAnUnV0YXMgcGxhbmlmaWNhZGFzJywgcm93czogcnV0YXNSb3dzIH0sXHJcbiAgICB7IG5hbWU6ICdEZXJpdmFjaW9uZXMtUmVhZ2VuZGFzJywgcm93czogb3ZlcnJpZGVzUm93cyB9LFxyXG4gIF0pO1xyXG4gIHNob3dTeW5jVGFnKFxyXG4gICAgJ0V4cG9ydCBSdXRhcyBsaXN0byAoJyArIHJ1dGFzUm93cy5sZW5ndGggKyAnIHRpZW5kYXMsICcgKyBvdmVycmlkZXNSb3dzLmxlbmd0aCArICcgb3ZlcnJpZGVzKScsXHJcbiAgICAyNDAwXHJcbiAgKTtcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEFMVEFTOiBzb2xpY2l0dWRlcyBkZSBhbHRhIGRlIGNsaWVudGUgZGVsIHBlcmlvZG9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xyXG4gIGxldCBzbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgbGV0IGR0ID0gJyc7XHJcbiAgICBpZiAoYS5jcmVhdGVkQXQgJiYgYS5jcmVhdGVkQXQudG9EYXRlKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgZHQgPSBhLmNyZWF0ZWRBdC50b0RhdGUoKTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgICB9XHJcbiAgICBpZiAoIWR0KSByZXR1cm47XHJcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xyXG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGR0LmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxyXG4gICAgICBFc3RhZG86IGEuc3RhdHVzIHx8ICcnLFxyXG4gICAgICBDb21lcmNpbzogYS5jb21lcmNpbyB8fCAnJyxcclxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXHJcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcclxuICAgICAgQ29uZGljaW9uX0Zpc2NhbDogYS5jb25kRmlzY2FsIHx8ICcnLFxyXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcclxuICAgICAgTnVtZXJvOiBhLm51bWVybyB8fCAnJyxcclxuICAgICAgTG9jYWxpZGFkOiBhLmxvY2FsaWRhZCB8fCAnJyxcclxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcclxuICAgICAgQ1A6IGEuY3AgfHwgJycsXHJcbiAgICAgIFRlbGVmb25vOiBhLnRlbGVmb25vIHx8ICcnLFxyXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcclxuICAgICAgVmVuZGVkb3JfU29saWNpdGFudGU6IGEudmVuZG9yTmFtZSB8fCBhLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIE93bmVyX0VtYWlsOiBhLm93bmVyRW1haWwgfHwgJycsXHJcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcclxuICAgICAgQXByb2JhZG9fUG9yOiBhLmFwcHJvdmVkQnlFbWFpbCB8fCAnJyxcclxuICAgICAgQXByb2JhZG9fRW46XHJcbiAgICAgICAgYS5hcHByb3ZlZEF0ICYmIGEuYXBwcm92ZWRBdC50b0RhdGUgPyBhLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcclxuICAgICAgUmVjaGF6YWRvX01vdGl2bzogYS5yZWplY3RlZFJlYXNvbiB8fCAnJyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQWx0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQWx0YXMgZGUgY2xpZW50ZXMnLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IEFsdGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIHNvbGljaXR1ZGVzKScsIDI0MDApO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gdjcwOSAoMjAyNi0wOC0yOCk6IDMgZXhwb3J0cyBudWV2b3MgcGVkaWRvcyBwb3IgTWFyaWFuby5cclxuLy8gLSBCQUNLT1JERVI6IGxpbmVhcyBzdGF0ZT1CTyBvcGVuIHBvciBtZXMgZGUgY3JlYXRlZEF0IGRlbCBwZWRpZG8uXHJcbi8vIC0gU1RPQ0tfQVNJRzogbGluZWFzIEFTSUcgb3BlbiAobyBCTytzdG9jayBkaXNwKSBwb3IgbWVzIGRlIGNyZWF0ZWRBdC5cclxuLy8gLSBQRURJRE9TX01FUzogVE9ET1MgbG9zIHBlZGlkb3MgY3JlYWRvcyBlbiBlbCBtZXMvYW5pbyAoY3VhbHF1aWVyIHN0YWdlKS5cclxuLy8gRnVlbnRlOiBnbG9iYWxQZWRpZG9zIChsbyBxdWUgbGEgYXBwIHlhIHRpZW5lIGVuIG1lbW9yaWEpLlxyXG4vLyBGaWx0ZXIgbWVzL2FcdTAwRjFvOiBzb2JyZSBjcmVhdGVkQXQgZGVsIHBlZGlkby4gbW9udGhJZHg9bnVsbCAtPiBhXHUwMEYxbyBlbnRlcm8uXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5mdW5jdGlvbiBfcGVkaWRvTW9udGhZZWFyKHApIHtcclxuICBjb25zdCBjYSA9IHAuY3JlYXRlZEF0O1xyXG4gIGlmICghY2EpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcclxuICBsZXQgZHQgPSBudWxsO1xyXG4gIGlmICh0eXBlb2YgY2EgPT09ICdzdHJpbmcnKSBkdCA9IG5ldyBEYXRlKGNhKTtcclxuICBlbHNlIGlmICh0eXBlb2YgY2EudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBkdCA9IGNhLnRvRGF0ZSgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgfSBlbHNlIGlmICh0eXBlb2YgY2EgPT09ICdudW1iZXInKSBkdCA9IG5ldyBEYXRlKGNhKTtcclxuICBpZiAoIWR0IHx8IE51bWJlci5pc05hTihkdC5nZXRUaW1lKCkpKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XHJcbiAgcmV0dXJuIHsgeTogZHQuZ2V0RnVsbFllYXIoKSwgbTogZHQuZ2V0TW9udGgoKSB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpIHtcclxuICBjb25zdCBhcnIgPVxyXG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XHJcbiAgcmV0dXJuIGFyci5maWx0ZXIoKHApID0+IHtcclxuICAgIGlmICghcCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgY29uc3QgeyB5LCBtIH0gPSBfcGVkaWRvTW9udGhZZWFyKHApO1xyXG4gICAgaWYgKHkgPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKHkgIT09IGFuaW8pIHJldHVybiBmYWxzZTtcclxuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBtICE9PSBtb250aElkeCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyLi4uJyk7XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xyXG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSB7XHJcbiAgICBpZiAocC5jbG9zZWRBdCkgY29udGludWU7XHJcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XHJcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcclxuICAgICAgaWYgKCFsIHx8IGwuc3RhdGUgIT09ICdCTycpIHJldHVybjtcclxuICAgICAgY29uc3QgcW8gPSBOdW1iZXIobC5xdHlPcGVuKSB8fCAwO1xyXG4gICAgICBpZiAocW8gPD0gMCkgcmV0dXJuO1xyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIEZlY2hhX1BlZGlkbzogcC5jcmVhdGVkQXRcclxuICAgICAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xyXG4gICAgICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXHJcbiAgICAgICAgICAgICAgICAudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgOiAnJyxcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcclxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcclxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZF9QZWRpZGE6IE51bWJlcihsLnF0eSkgfHwgMCxcclxuICAgICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApLFxyXG4gICAgICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZChxbyAqIChOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCkgfHwgMCkpLFxyXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcclxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcclxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19CYWNrb3JkZXJfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQmFja29yZGVyJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFN0b2NrIEFzaWduYWRvLi4uJyk7XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xyXG4gIGNvbnN0IGdldFN0ayA9XHJcbiAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXHJcbiAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXHJcbiAgICAgIDogbnVsbDtcclxuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykge1xyXG4gICAgaWYgKHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xyXG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xyXG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XHJcbiAgICAgIGlmICghbCkgcmV0dXJuO1xyXG4gICAgICBjb25zdCBxbyA9IE51bWJlcihsLnF0eU9wZW4pIHx8IDA7XHJcbiAgICAgIGlmIChxbyA8PSAwKSByZXR1cm47XHJcbiAgICAgIGxldCB2aXJ0dWFsID0gZmFsc2U7XHJcbiAgICAgIGlmIChsLnN0YXRlID09PSAnQVNJRycpIHtcclxuICAgICAgICAvLyBvayByZXNlcnZhIGZpcm1lXHJcbiAgICAgIH0gZWxzZSBpZiAobC5zdGF0ZSA9PT0gJ0JPJykge1xyXG4gICAgICAgIC8vIHZpcnR1YWwgc29sbyBzaSBoYXkgc3RvY2sgZGlzcFxyXG4gICAgICAgIGlmICghZ2V0U3RrKSByZXR1cm47XHJcbiAgICAgICAgY29uc3Qgc3RrID0gZ2V0U3RrKGwuY29kZSkgfHwgMDtcclxuICAgICAgICBpZiAoc3RrIDw9IDApIHJldHVybjtcclxuICAgICAgICB2aXJ0dWFsID0gdHJ1ZTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBGZWNoYV9QZWRpZG86IHAuY3JlYXRlZEF0XHJcbiAgICAgICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcclxuICAgICAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcclxuICAgICAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxyXG4gICAgICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgICAgICAgIC5zbGljZSgwLCAxMClcclxuICAgICAgICAgIDogJycsXHJcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxyXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXHJcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWRfUmVzZXJ2YWRhOiBxbyxcclxuICAgICAgICBFc3RhZG9fUmVhbDogdmlydHVhbCA/ICdCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRyknIDogJ0FTSUcnLFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApLFxyXG4gICAgICAgIFN1YnRvdGFsX1Jlc2VydmFkb19BUlM6IE1hdGgucm91bmQocW8gKiAoTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApIHx8IDApKSxcclxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXHJcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XHJcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XHJcbn1cclxuXHJcbi8vIHY3MzcgKDIwMjYtMDgtMzApOiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kb3MgbG9zIGJhY2tvcmRlcnMgb3BlbiAoc2luIGZpbHRyb1xyXG4vLyBkZSBtZXMpLiBNb3Rpdm86IGxvcyA2MiBwZWRpZG9zIG1pZ3JhZG9zIGRlc2RlIFNBUCBlbCAyMDI2LTA4LTI4IHRpZW5lblxyXG4vLyBjcmVhdGVkQXQgZGUgZmVjaGFzIHZpZWphcyBkZWwgU0FQIFNRIG9yaWdpbmFsLCBlbnRvbmNlcyBlbCBleHBvcnQgcG9yIG1lc1xyXG4vLyBubyBsb3MgaW5jbHVpYS4gVmVyc2lvbiBcImN1cnJlbnQgc3RhdHVzXCIgcXVlIGl0ZXJhIGdsb2JhbFBlZGlkb3MgY29tcGxldG8uXHJcbndpbmRvdy5leHBvcnRCYWNrb3JkZXJBbGwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGNvbnN0IGFyciA9XHJcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcclxuICBsZXQgdG90YWxQZWRpZG9zT3BlbiA9IDA7XHJcbiAgZm9yIChjb25zdCBwIG9mIGFycikge1xyXG4gICAgaWYgKCFwIHx8IHAuY2xvc2VkQXQpIGNvbnRpbnVlO1xyXG4gICAgdG90YWxQZWRpZG9zT3BlbisrO1xyXG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xyXG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XHJcbiAgICAgIGlmICghbCB8fCBsLnN0YXRlICE9PSAnQk8nKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHFvID0gTnVtYmVyKGwucXR5T3BlbikgfHwgMDtcclxuICAgICAgaWYgKHFvIDw9IDApIHJldHVybjtcclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBGZWNoYV9QZWRpZG86IHAuY3JlYXRlZEF0XHJcbiAgICAgICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcclxuICAgICAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcclxuICAgICAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxyXG4gICAgICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgICAgICAgIC5zbGljZSgwLCAxMClcclxuICAgICAgICAgIDogJycsXHJcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxyXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcclxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXHJcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXHJcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXHJcbiAgICAgICAgQ2FudGlkYWRfUGVkaWRhOiBOdW1iZXIobC5xdHkpIHx8IDAsXHJcbiAgICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcclxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKSxcclxuICAgICAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQocW8gKiAoTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApIHx8IDApKSxcclxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXHJcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXHJcbiAgICAgICAgU1FfRG9jTnVtOiBwLnRyYW5zZmVyaWRvU0FQID8gcC50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gfHwgJycgOiAnJyxcclxuICAgICAgICBPcmlnZW46IHAubWlncmF0aW9uU291cmNlIHx8ICdhcHAnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnRXhwb3J0IEJhY2tvcmRlciB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXHJcbiAgICAgICAgJy0gVG90YWwgcGVkaWRvcyBlbiBnbG9iYWxQZWRpZG9zOiAnICtcclxuICAgICAgICBhcnIubGVuZ3RoICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJy0gUGVkaWRvcyBhYmllcnRvcyAoc2luIGNsb3NlZEF0KTogJyArXHJcbiAgICAgICAgdG90YWxQZWRpZG9zT3BlbiArXHJcbiAgICAgICAgJ1xcbicgK1xyXG4gICAgICAgICctIExpbmVhcyBzdGF0ZT1CTyBjb24gcXR5T3Blbj4wOiAwXFxuXFxuJyArXHJcbiAgICAgICAgJ1Bvc2libGVzIGNhdXNhczpcXG4nICtcclxuICAgICAgICAnMS4gTm8gaGF5IGJhY2tvcmRlciBhYmllcnRvIGFob3JhIG1pc21vICh0b2RvIGNvbmZpcm1lZCBvIGNlcnJhZG8pXFxuJyArXHJcbiAgICAgICAgJzIuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvIHBvciBlcnJvclxcbicgK1xyXG4gICAgICAgICczLiBMYXMgbGluZWFzIEJPIHRpZW5lbiBxdHlPcGVuPTAgKHlhIGRlc3BhY2hhZGFzIHZpYSBBU0lHLT5jbG9zZWQpJ1xyXG4gICAgKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xyXG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl9TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xyXG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufTtcclxuXHJcbi8vIHY3Mzc6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvIGVsIFN0b2NrIEFzaWduYWRvIChzaW4gZmlsdHJvIGRlIG1lcykuIE1pc21vXHJcbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxyXG53aW5kb3cuZXhwb3J0U3RvY2tBc2lnQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFN0b2NrIEFzaWduYWRvIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGNvbnN0IGFyciA9XHJcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcclxuICBjb25zdCBnZXRTdGsgPVxyXG4gICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xyXG4gICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxyXG4gICAgICA6IG51bGw7XHJcbiAgbGV0IHRvdGFsUGVkaWRvc09wZW4gPSAwO1xyXG4gIGxldCBhc2lnQ291bnQgPSAwO1xyXG4gIGxldCBib1dpdGhTdG9ja0NvdW50ID0gMDtcclxuICBmb3IgKGNvbnN0IHAgb2YgYXJyKSB7XHJcbiAgICBpZiAoIXAgfHwgcC5jbG9zZWRBdCkgY29udGludWU7XHJcbiAgICB0b3RhbFBlZGlkb3NPcGVuKys7XHJcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XHJcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcclxuICAgICAgaWYgKCFsKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHFvID0gTnVtYmVyKGwucXR5T3BlbikgfHwgMDtcclxuICAgICAgaWYgKHFvIDw9IDApIHJldHVybjtcclxuICAgICAgbGV0IHZpcnR1YWwgPSBmYWxzZTtcclxuICAgICAgaWYgKGwuc3RhdGUgPT09ICdBU0lHJykge1xyXG4gICAgICAgIGFzaWdDb3VudCsrO1xyXG4gICAgICB9IGVsc2UgaWYgKGwuc3RhdGUgPT09ICdCTycpIHtcclxuICAgICAgICBpZiAoIWdldFN0aykgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IHN0ayA9IGdldFN0ayhsLmNvZGUpIHx8IDA7XHJcbiAgICAgICAgaWYgKHN0ayA8PSAwKSByZXR1cm47XHJcbiAgICAgICAgdmlydHVhbCA9IHRydWU7XHJcbiAgICAgICAgYm9XaXRoU3RvY2tDb3VudCsrO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIEZlY2hhX1BlZGlkbzogcC5jcmVhdGVkQXRcclxuICAgICAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xyXG4gICAgICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXHJcbiAgICAgICAgICAgICAgICAudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxyXG4gICAgICAgICAgOiAnJyxcclxuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXHJcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxyXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogcC5wcm92aW5jZSB8fCAnJyxcclxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcclxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcclxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcclxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcclxuICAgICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHFvLFxyXG4gICAgICAgIEVzdGFkb19SZWFsOiB2aXJ0dWFsID8gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKScgOiAnQVNJRycsXHJcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCksXHJcbiAgICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxbyAqIChOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCkgfHwgMCkpLFxyXG4gICAgICAgIFBlZGlkb19JRDogcC5fZnNJZCB8fCAnJyxcclxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcclxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxyXG4gICAgICAgIE9yaWdlbjogcC5taWdyYXRpb25Tb3VyY2UgfHwgJ2FwcCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xyXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXHJcbiAgICAgICAgYXJyLmxlbmd0aCArXHJcbiAgICAgICAgJ1xcbicgK1xyXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xyXG4gICAgICAgIHRvdGFsUGVkaWRvc09wZW4gK1xyXG4gICAgICAgICdcXG4nICtcclxuICAgICAgICAnLSBMaW5lYXMgc3RhdGU9QVNJRyBjb24gcXR5T3Blbj4wOiAnICtcclxuICAgICAgICBhc2lnQ291bnQgK1xyXG4gICAgICAgICdcXG4nICtcclxuICAgICAgICAnLSBMaW5lYXMgc3RhdGU9Qk8gY29uIHN0b2NrIGRpc3BvbmlibGUgKHZpcnR1YWwgQVNJRyk6ICcgK1xyXG4gICAgICAgIGJvV2l0aFN0b2NrQ291bnQgK1xyXG4gICAgICAgICdcXG5cXG4nICtcclxuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xyXG4gICAgICAgICcxLiBObyBoYXkgc3RvY2sgYXNpZ25hZG8gYWhvcmEgbWlzbW9cXG4nICtcclxuICAgICAgICAnMi4gVG9kbyBlbCBzdG9jayBlc3RhIHBlbmRpZW50ZSBzaW4gYXNpZ25hciAobW9kZSBCTyBwdXJvIHNpbiBzdG9jaylcXG4nICtcclxuICAgICAgICAnMy4gTG9zIHBlZGlkb3MgdGllbmVuIGNsb3NlZEF0IHNldGVhZG8nXHJcbiAgICApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcclxuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcclxuICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWduYWRvIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufTtcclxuXHJcbi8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXN1ZWx2ZSBub21icmUgZGUgZmFudGFzaWEgcGFyYSB1biBwZWRpZG8gdXNhbmRvIGVsXHJcbi8vIG1pc21vIHBhdHRlcm4gcXVlIGxhcyBjYXJkcyBkZWwgbWFwYSAoaW5kZXguaHRtbDo5OTE1LTk5MzUpOlxyXG4vLyAgIDEpIGNsaWVudE1ldGFbY2FyZENvZGVdLmN1c3RvbUZhbnRhc2lhIChlZGl0YWRvIGRlc2RlIGVsIG1vZGFsIGNsaWVudGUpXHJcbi8vICAgMikgYXBwcm92ZWRBbHRhc0xpc3RbXS5mYW50YXNpYSBtYXRjaGVhZG8gcG9yIGNvbWVyY2lvID09IGNsaWVudE5hbWVcclxuZnVuY3Rpb24gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKSB7XHJcbiAgY29uc3QgY2FyZENvZGUgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xyXG4gIGlmIChjYXJkQ29kZSkge1xyXG4gICAgY29uc3QgbWV0YSA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuY2xpZW50TWV0YTtcclxuICAgIGNvbnN0IGN1c3RvbSA9IG1ldGEgJiYgbWV0YVtjYXJkQ29kZV0gJiYgbWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWE7XHJcbiAgICBpZiAoY3VzdG9tICYmIFN0cmluZyhjdXN0b20pLnRyaW0oKSkgcmV0dXJuIFN0cmluZyhjdXN0b20pLnRyaW0oKTtcclxuICB9XHJcbiAgY29uc3QgYWx0YXMgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmFwcHJvdmVkQWx0YXNMaXN0O1xyXG4gIGlmIChBcnJheS5pc0FycmF5KGFsdGFzKSkge1xyXG4gICAgY29uc3QgbmFtZUxvd2VyID0gU3RyaW5nKHAuY2xpZW50TmFtZSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChuYW1lTG93ZXIpIHtcclxuICAgICAgY29uc3QgbWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiB7XHJcbiAgICAgICAgaWYgKCFhKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgY29uc3QgYyA9IFN0cmluZyhhLmNvbWVyY2lvIHx8ICcnKVxyXG4gICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgY29uc3QgZiA9IFN0cmluZyhhLmZhbnRhc2lhIHx8ICcnKVxyXG4gICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgcmV0dXJuIGMgPT09IG5hbWVMb3dlciB8fCBmID09PSBuYW1lTG93ZXI7XHJcbiAgICAgIH0pO1xyXG4gICAgICBpZiAobWF0Y2ggJiYgbWF0Y2guZmFudGFzaWEgJiYgU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCkpIHtcclxuICAgICAgICByZXR1cm4gU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuICcnO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBQZWRpZG9zIGRlbCBtZXMuLi4nKTtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XHJcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcclxuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcclxuICAgIGlmICghbGluZXMubGVuZ3RoKSBjb250aW51ZTtcclxuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcclxuICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXHJcbiAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcclxuICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXHJcbiAgICAgICAgICAgIC50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICAgIC5zbGljZSgwLCAxMClcclxuICAgICAgOiAnJztcclxuICAgIC8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXNvbHZlciBmYW50YXNpYSB1bmEgdmV6IHBvciBwZWRpZG8gKG5vIHBvciBsaW5lYSkgXHUyMDE0XHJcbiAgICAvLyBlbCBsb29rdXAgZW4gY2xpZW50TWV0YSArIGFwcHJvdmVkQWx0YXNMaXN0IGVzIGNvbnN0YW50ZSBwYXJhIHRvZG8gZWwgcGVkaWRvLlxyXG4gICAgY29uc3Qgbm9tYnJlTG9jYWxGYW50YXNpYSA9IF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCk7XHJcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcclxuICAgICAgaWYgKCFsKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihsLnF0eSkgfHwgMDtcclxuICAgICAgY29uc3QgcHJlY2lvID0gTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApO1xyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGEsXHJcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxyXG4gICAgICAgIFN0YWdlOiBwLnN0YWdlIHx8ICcnLFxyXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcclxuICAgICAgICBOb21icmVfTG9jYWxfRmFudGFzaWE6IG5vbWJyZUxvY2FsRmFudGFzaWEsXHJcbiAgICAgICAgQ2FyZENvZGU6IHAuY2xpZW50Q2FyZENvZGUgfHwgJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxyXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxyXG4gICAgICAgIFZlbmRlZG9yOiBwLm93bmVyVmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxyXG4gICAgICAgIENhbnRpZGFkOiBxdHksXHJcbiAgICAgICAgQ2FudGlkYWRfT3BlbjogTnVtYmVyKGwucXR5T3BlbikgfHwgMCxcclxuICAgICAgICBDYW50aWRhZF9JbnZvaWNlZDogTnVtYmVyKGwucXR5SW52b2ljZWQpIHx8IDAsXHJcbiAgICAgICAgQ2FudGlkYWRfQ2FuY2VsbGVkOiBOdW1iZXIobC5xdHlDYW5jZWxsZWQpIHx8IDAsXHJcbiAgICAgICAgRXN0YWRvX0xpbmVhOiBsLnN0YXRlIHx8ICcnLFxyXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxyXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChxdHkgKiBwcmVjaW8pLFxyXG4gICAgICAgIENlcnJhZG86IHAuY2xvc2VkQXQgPyAnU0knIDogJ05PJyxcclxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXHJcbiAgICAgICAgTGluZWFfSWR4OiBpZHgsXHJcbiAgICAgICAgU1FfRG9jTnVtOiBwLnRyYW5zZmVyaWRvU0FQID8gcC50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gfHwgJycgOiAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5GZWNoYV9QZWRpZG8gfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG8gfHwgJycpKTtcclxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1BlZGlkb3NEZWxNZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XHJcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnUGVkaWRvcycsIHJvd3MgfV0pO1xyXG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgUGVkaWRvcyBkZWwgbWVzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcclxufVxyXG5cclxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cclxuY29uc3QgQU5BTElTSVNfUElOID0gJzEyMzUnO1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR2VuZXJhIGxhIGhvamEgQ0xJRU5URVNfWk9OQVMgY29uIFVOQSBmaWxhIHBvciBCUCBxdWUgZXN0YSB2aXZvIGVuIFNBUDpcclxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxyXG4vLyBhc2lnbmFkby4gRXhjbHV5ZSBQT0lOVFMgLyBkaXN0cmlidWlkb3JlcyAvIHByb3NwZWN0b3MgLyBhbHRhcyBzaW5cclxuLy8gQ2FyZENvZGUgKG1vY2tzIG8gcGVuZGllbnRlcyBkZSBTQVApLiBFcyBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBmYWN0dXJhLlxyXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcclxuLy8gQ0FMTEUsIE5VTUVSTywgTE9DQUxJREFELCBDUCwgTk9NQlJFIENPTUVSQ0lBTCwgTk9NQlJFIERFIEZBTlRBU0lBLCBDVUlULFxyXG4vLyBDT05ESUNJT04gRklTQ0FMLCBURUxFRk9OTywgQ0FSRENPREUgU0FQLlxyXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpY1x1MDBFMSB0dSBjb25leGlcdTAwRjNuIHkgcmVpbnRlbnRcdTAwRTEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XHJcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcclxuICBjb25zdCBWREVfVE9fVkRJID0ge1xyXG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxyXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcclxuICB9O1xyXG4gIGZ1bmN0aW9uIHJlZ2lvbk9mKHByb3YpIHtcclxuICAgIGNvbnN0IHAgPSAocHJvdiB8fCAnJykudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xyXG4gICAgaWYgKFsnQ09SRE9CQScsICdTQU4gTFVJUycsICdNRU5ET1pBJywgJ1NBTiBKVUFOJywgJ0xBIFJJT0pBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQ1VZTyc7XHJcbiAgICBpZiAoWydTQU5UQSBGRScsICdFTlRSRSBSSU9TJywgJ0NIQUNPJywgJ0NPUlJJRU5URVMnLCAnTUlTSU9ORVMnLCAnRk9STU9TQSddLmluY2x1ZGVzKHApKVxyXG4gICAgICByZXR1cm4gJ05FQSc7XHJcbiAgICBpZiAoWydKVUpVWScsICdTQUxUQScsICdUVUNVTUFOJywgJ0NBVEFNQVJDQScsICdTQU5USUFHTyBERUwgRVNURVJPJ10uaW5jbHVkZXMocCkpIHJldHVybiAnTk9BJztcclxuICAgIGlmIChbJ05FVVFVRU4nLCAnUklPIE5FR1JPJywgJ0NIVUJVVCcsICdTQU5UQSBDUlVaJywgJ1RJRVJSQSBERUwgRlVFR08nXS5pbmNsdWRlcyhwKSlcclxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xyXG4gICAgcmV0dXJuICcnO1xyXG4gIH1cclxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xyXG4gICAgaWYgKCFrZXkpIHJldHVybiAnJztcclxuICAgIGlmIChrZXkgPT09ICdfX0RJU1RSSUJVVE9SX18nKSByZXR1cm4gJ0RJU1RSSUJVSURPUkVTJztcclxuICAgIHJldHVybiBrZXk7XHJcbiAgfVxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBsZXQgYWx0YXNTbmFwO1xyXG4gIHRyeSB7XHJcbiAgICBhbHRhc1NuYXAgPSBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcclxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPT0nLCAnYXBwcm92ZWQnKVxyXG4gICAgICAuZ2V0KCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXMgYXByb2JhZGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGxldCBza2lwcGVkTm9TYXAgPSAwO1xyXG4gIGFsdGFzU25hcC5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XHJcbiAgICBjb25zdCBjYXJkQ29kZSA9IChhLmNhcmRDb2RlU2FwIHx8ICcnKS50cmltKCk7XHJcbiAgICAvLyBGaWx0cm8gY2xhdmU6IHNvbG8gQlBzIGNvbiBDYXJkQ29kZSBTQVAgYXNpZ25hZG8gKD0gaGFiaWxpdGFkbyBlbiBTQVApLlxyXG4gICAgaWYgKCFjYXJkQ29kZSkge1xyXG4gICAgICBza2lwcGVkTm9TYXArKztcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgcHJvdmluY2UgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvVXBwZXJDYXNlKCkudHJpbSgpO1xyXG4gICAgY29uc3QgbG9jYWxpdHlGaW5hbCA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyc7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xyXG4gICAgcm93cy5wdXNoKHtcclxuICAgICAgVElQTzogJ0RBRE8gREUgQUxUQScsXHJcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxyXG4gICAgICBSRUdJT046IHJlZ2lvbk9mKHByb3ZpbmNlKSxcclxuICAgICAgUFJPVklOQ0lBOiBwcm92aW5jZSxcclxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxyXG4gICAgICAnQVNFU09SIElOVEVSTk8nOiBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJycsXHJcbiAgICAgIENBTExFOiBhLmNhbGxlIHx8ICcnLFxyXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxyXG4gICAgICBMT0NBTElEQUQ6IGxvY2FsaXR5RmluYWwsXHJcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxyXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxyXG4gICAgICAnTk9NQlJFIERFIEZBTlRBU0lBJzogYS5mYW50YXNpYSB8fCAnJyxcclxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxyXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxyXG4gICAgICBURUxFRk9OTzogYS50ZWxlZm9ubyB8fCAnJyxcclxuICAgICAgJ0NBUkRDT0RFIFNBUCc6IGNhcmRDb2RlLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdObyBoYXkgY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQIHRvZGF2aWEuXFxuXFxuVW5hIGFsdGEgZW50cmEgYWwgZXhwb3J0IHNvbG8gY3VhbmRvIHRpZW5lIENhcmRDb2RlIFNBUCBhc2lnbmFkby4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICByb3dzLnNvcnQoKHIxLCByMikgPT4ge1xyXG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcclxuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcclxuICAgIGNvbnN0IGwgPSAocjEuTE9DQUxJREFEIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLkxPQ0FMSURBRCB8fCAnJyk7XHJcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XHJcbiAgICByZXR1cm4gKHIxWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUocjJbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJyk7XHJcbiAgfSk7XHJcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiB7XHJcbiAgICByWydOUk8gQ1RFJ10gPSBpICsgMTtcclxuICB9KTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDEwIH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDI4IH0sXHJcbiAgICB7IHdjaDogMjggfSxcclxuICAgIHsgd2NoOiAyOCB9LFxyXG4gICAgeyB3Y2g6IDEwIH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAxMCB9LFxyXG4gICAgeyB3Y2g6IDM4IH0sXHJcbiAgICB7IHdjaDogMzIgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDI0IH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gIF07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdDTElFTlRFU19aT05BUycpO1xyXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1RBUkdFVFNfVkVOREVET1JFU19aT05BU18nICsgdHMgKyAnLnhsc3gnKTtcclxuICBzaG93U3luY1RhZyhcclxuICAgICdFeGNlbCBleHBvcnRhZG86ICcgK1xyXG4gICAgICByb3dzLmxlbmd0aCArXHJcbiAgICAgICcgY2xpZW50ZXMgU0FQIGhhYmlsaXRhZG9zJyArXHJcbiAgICAgIChza2lwcGVkTm9TYXAgPiAwID8gJyAoJyArIHNraXBwZWROb1NhcCArICcgc2luIENhcmRDb2RlIGRlc2NhcnRhZG9zKScgOiAnJylcclxuICApO1xyXG59O1xyXG5cclxud2luZG93Lm9wZW5FeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBwaW4gPSBwcm9tcHQoXHJcbiAgICAnRXN0YSBzZWNjaW9uIGNvbnRpZW5lIGZvcm1hdG9zIGF2YW56YWRvcyAoUG93ZXIgQkksIFB5dGhvbi9NTCwgWklQIGRlIGZvdG9zKSBkZXN0aW5hZG9zIGEgYW5hbGlzaXMgdGVjbmljby5cXG5cXG5JbmdyZXNhIGVsIFBJTiBwYXJhIGNvbnRpbnVhcjonXHJcbiAgKTtcclxuICBpZiAocGluID09PSBudWxsKSByZXR1cm47XHJcbiAgaWYgKHBpbiAhPT0gQU5BTElTSVNfUElOKSB7XHJcbiAgICBhbGVydCgnUElOIGluY29ycmVjdG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIE9wY2lvbiBJbnRlZ3JhY2lvbiBTQVA6IHNvbG8gcGFyYSBNYXJpYW5vIChlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSlcclxuICBjb25zdCBzYXBPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1zYXAtaW50ZWdyYXRpb24nKTtcclxuICBpZiAoc2FwT3B0KSB7XHJcbiAgICBjb25zdCBpc01hcmlhbm8gPVxyXG4gICAgICBjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSc7XHJcbiAgICBzYXBPcHQuc3R5bGUuZGlzcGxheSA9IGlzTWFyaWFubyA/ICcnIDogJ25vbmUnO1xyXG4gIH1cclxuICAvLyBPcGNpb24gQmFja3VwIG1lbnN1YWw6IHNvbG8gYWRtaW5cclxuICBjb25zdCBia09wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LWJhY2t1cC1tZW5zdWFsJyk7XHJcbiAgaWYgKGJrT3B0KSBia09wdC5zdHlsZS5kaXNwbGF5ID0gdXNlclJvbGUgPT09ICdhZG1pbicgPyAnJyA6ICdub25lJztcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VFeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cclxuLy8gSGVscGVycyBpbnRlcm5vcyAoZG93bmxvYWRYbHN4LCBleHBvcnRWZW50YXNGb3JNb250aCwgZXRjLikgc29uIGNvbnN1bWlkb3NcclxuLy8gc29sbyBkZW50cm8gZGUgZXN0ZSBibG9xdWUgKHZlcmlmaWNhZG8gcHJlLWV4dHJhY2NpXHUwMEYzbikuXHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWdCQSxTQUFPLHVCQUF1QixXQUFZO0FBQ3hDLFFBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsWUFBTSxpRkFBaUY7QUFDdkY7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLFFBQVE7QUFDN0IsWUFBTSxnQ0FBZ0M7QUFDdEM7QUFBQSxJQUNGO0FBQ0EsZ0JBQVkscUNBQXFDO0FBUWpELFVBQU0sV0FDSixPQUFPLDBCQUEwQixhQUM3QixzQkFBc0IsT0FBTyxrQkFBa0IsY0FBYyxnQkFBZ0IsS0FBSyxJQUNsRjtBQUNOLFVBQU0sVUFBVSxDQUFDLGNBQWM7QUFDN0IsVUFBSSxhQUFhLEtBQU0sUUFBTztBQUM5QixVQUFJLENBQUMsVUFBVyxRQUFPO0FBQ3ZCLGFBQU8sU0FBUyxJQUFJLFNBQVM7QUFBQSxJQUMvQjtBQU1BLFVBQU0sYUFBYTtBQUFBLE1BQ2pCLHlCQUF5QjtBQUFBLE1BQ3pCLHNCQUFzQjtBQUFBLE1BQ3RCLGdCQUFnQjtBQUFBLE1BQ2hCLE9BQU87QUFBQSxJQUNUO0FBQ0EsYUFBUyxXQUFXLFdBQVc7QUFDN0IsWUFBTSxJQUFJLE9BQU8sWUFBWSxjQUFjLFFBQVEsS0FBSyxDQUFDLE9BQU8sR0FBRyxRQUFRLFNBQVMsSUFBSTtBQUN4RixhQUFPLElBQUksRUFBRSxPQUFPO0FBQUEsSUFDdEI7QUFDQSxhQUFTLGtCQUFrQixXQUFXO0FBQ3BDLFlBQU0sSUFBSSxPQUFPLFlBQVksY0FBYyxRQUFRLEtBQUssQ0FBQyxPQUFPLEdBQUcsUUFBUSxTQUFTLElBQUk7QUFDeEYsYUFBTyxJQUFJLEVBQUUsUUFBUSxhQUFhO0FBQUEsSUFDcEM7QUFXQSxVQUFNLGlCQUFpQjtBQUFBLE1BQ3JCO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNB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
