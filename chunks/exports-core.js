"use strict";
(() => {
  // src/domains/exports-core.js
  window.exportMasterClientes = async function() {
    if (!POINTS || !POINTS.length) {
      alert("No hay datos cargados todavia.");
      return;
    }
    showSyncTag("Generando masterfile de clientes...");
    const buyerStatsIdx = /* @__PURE__ */ new Map();
    try {
      const bsSnap = await fbDb.collection("client_buyer_stats").get();
      bsSnap.forEach((d) => {
        buyerStatsIdx.set(d.id, d.data() || {});
      });
    } catch (_e) {
      console.warn(
        "[masterfile] client_buyer_stats no cargado (rule denied o red):",
        _e && _e.message
      );
    }
    const _fcLabels = window.__phase0 && window.__phase0.pure && window.__phase0.pure.fichaClienteLabels || null;
    const _clasifRow = (cmd) => _fcLabels && _fcLabels.fichaClienteClasifRow ? _fcLabels.fichaClienteClasifRow(cmd) : {
      "Tipo de cliente": "-",
      Fidelidad: "-",
      "Preferencia de contacto": "-",
      Tama\u00F1o: "-",
      Especializaci\u00F3n: "-",
      "Tipo de local": "-",
      "Cr\xE9dito cheque (ARS)": cmd && cmd.creditoCheque ? Number(cmd.creditoCheque) : "-"
    };
    const _buyerRow = (bs) => _fcLabels && _fcLabels.fichaClienteBuyerRow ? _fcLabels.fichaClienteBuyerRow(bs, "12m") : {
      "Monto total (12m)": "-",
      "Facturas (12m)": "-",
      "Promedio por factura (12m)": "-",
      "Frecuencia (d\xEDas entre compras)": "-",
      "Facturas por mes (12m)": "-",
      "Primera compra": "-",
      "\xDAltima compra": "-",
      "D\xEDas desde \xFAltima compra": "-"
    };
    const _fillDash = (row) => _fcLabels && _fcLabels.fillDashInEmpty ? _fcLabels.fillDashInEmpty(row) : row;
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
        const _buyerStats = cardCode ? buyerStatsIdx.get(cardCode) || null : null;
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
            // v1482 §82: ORDEN importa. Legacy visitas PRIMERO (fallback),
            // luego Ficha Cliente PISA con labels de la fuente autoritativa
            // (ej. "Fidelidad" Ficha pisa la mergeada de visitas que puede
            // estar desactualizada). Buyer stats al final (ventana 12m).
            _classifRow(province, localityMap, name),
            _clasifRow(cmData),
            _buyerRow(_buyerStats)
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
        const _altaBuyerStats = a.cardCodeSap ? buyerStatsIdx.get(a.cardCodeSap) || null : null;
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
            // v1482 §82: mismo orden que POINTS — legacy visitas primero,
            // Ficha pisa, Buyer al final.
            _classifRow(prov, loc, nombre),
            _clasifRow(a),
            _buyerRow(_altaBuyerStats)
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
      // v1482 §82: columnas de la Ficha Cliente (pestaña Clasificación) +
      // Buyer (pestaña Buyer, ventana 12m). Orden exacto que llega desde
      // _clasifRow (Object.assign preserva orden de keys).
      "Tipo de cliente": 36,
      Fidelidad: 10,
      "Preferencia de contacto": 20,
      Tama\u00F1o: 10,
      Especializaci\u00F3n: 20,
      "Tipo de local": 14,
      "Cr\xE9dito cheque (ARS)": 18,
      "Monto total (12m)": 16,
      "Facturas (12m)": 12,
      "Promedio por factura (12m)": 20,
      "Frecuencia (d\xEDas entre compras)": 20,
      "Facturas por mes (12m)": 16,
      "Primera compra": 14,
      "\xDAltima compra": 14,
      "D\xEDas desde \xFAltima compra": 18,
      "Ultima interaccion": 14,
      "Tipo ultima interaccion": 14,
      "Total visitas": 10,
      "Total contactos": 10,
      "Tipo comercio": 18,
      Local: 16,
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
    const FICHA_PROTECTED = /* @__PURE__ */ new Set([
      "Tipo de cliente",
      "Fidelidad",
      "Preferencia de contacto",
      "Tama\xF1o",
      "Especializaci\xF3n",
      "Tipo de local",
      "Cr\xE9dito cheque (ARS)",
      "Monto total (12m)",
      "Facturas (12m)",
      "Promedio por factura (12m)",
      "Frecuencia (d\xEDas entre compras)",
      "Facturas por mes (12m)",
      "Primera compra",
      "\xDAltima compra",
      "D\xEDas desde \xFAltima compra"
    ]);
    const emptyKeys = new Set(
      allKeys.filter((k) => {
        if (FICHA_PROTECTED.has(k)) return false;
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
      return _fillDash(out);
    });
    const removedCount = emptyKeys.size;
    if (removedCount > 0) {
      console.log(`[masterfile] removidas ${removedCount} cols vac\xEDas:`, [...emptyKeys].join(", "));
    }
    const byZone = {};
    rows.forEach((r) => {
      const z = r["Etiqueta zona"] || "Sin zona";
      if (!byZone[z]) {
        byZone[z] = {
          total: 0,
          habilitados: 0,
          cancelados: 0,
          tipos: {},
          fidelidades: {}
        };
      }
      byZone[z].total++;
      if (r.Estado === "Habilitado") byZone[z].habilitados++;
      else if (r.Estado === "Cancelado") byZone[z].cancelados++;
      const tipoLbl = r["Tipo de cliente"] || "-";
      const tipoKey = tipoLbl === "-" ? "-" : String(tipoLbl).trim().charAt(0).toUpperCase();
      byZone[z].tipos[tipoKey] = (byZone[z].tipos[tipoKey] || 0) + 1;
      const fid = r.Fidelidad || "-";
      byZone[z].fidelidades[fid] = (byZone[z].fidelidades[fid] || 0) + 1;
    });
    function _fmtDist(dist) {
      const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) return "-";
      return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
    }
    const resumenRows = Object.entries(byZone).map(([z, d]) => ({
      "Zona / Vendedor": z,
      "Total tiendas": d.total,
      Habilitadas: d.habilitados,
      Canceladas: d.cancelados,
      "Por Tipo de cliente": _fmtDist(d.tipos),
      "Por Fidelidad": _fmtDist(d.fidelidades)
    })).sort((a, b) => b["Total tiendas"] - a["Total tiendas"]);
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const scopeLbl = scopeSet === null ? "TODOS" : scopeSet.size === 1 ? [...scopeSet][0].split(" ")[0] : "mis-zonas-" + scopeSet.size;
    const fname = "Masterfile_Clientes_SAP_" + scopeLbl + "_" + ts + ".xlsx";
    await downloadXlsx(fname, [
      { name: "Clientes habilitados SAP", rows: rowsFiltered },
      { name: "Resumen por zona", rows: resumenRows }
    ]);
    showSyncTag(
      rows.length + " clientes exportados" + (scopeSet === null ? "" : " (scope: " + [...scopeSet].join(", ") + ")")
    );
  };
  window.exportPreciosStock = async function() {
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
      const fnReal = typeof window !== "undefined" && typeof window.getStockRealmenteDisponible === "function" ? window.getStockRealmenteDisponible : null;
      if (fnReal) {
        try {
          const v = fnReal(sku);
          if (v == null) return "";
          return Number(v) || 0;
        } catch (_e) {
        }
      }
      const fnFisico = typeof window !== "undefined" && typeof window.getStockDisponibleVenta === "function" ? window.getStockDisponibleVenta : null;
      const vF = fnFisico ? fnFisico(sku) : null;
      if (vF == null) return "";
      return Number(vF) || 0;
    }
    function fmtPrecio(sku) {
      const p = typeof PRICE_LIST_MAP === "object" && PRICE_LIST_MAP ? PRICE_LIST_MAP[sku] : null;
      if (p == null) return "";
      return Number(p) || 0;
    }
    function dispLabel(stockVal) {
      if (stockVal === "" || stockVal == null) return "NO DISPONIBLE";
      return Number(stockVal) > 0 ? "DISPONIBLE" : "NO DISPONIBLE";
    }
    const rows = PRODUCTS.map((p) => {
      const st = fmtStock(p.code);
      return {
        SKU: p.code || "",
        Descripcion: p.desc || "",
        Familia: p.fam || "",
        Subfamilia: p.sub || "",
        Categoria: p.cat || "",
        "Precio ARS": fmtPrecio(p.code),
        Stock: st,
        Disponibilidad: dispLabel(st)
      };
    }).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const preciosRows = PRODUCTS.map((p) => ({
      SKU: p.code || "",
      Descripcion: p.desc || "",
      "Precio ARS": fmtPrecio(p.code)
    })).filter((r) => r["Precio ARS"] !== "").sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const stockRows = PRODUCTS.map((p) => {
      const st = fmtStock(p.code);
      return {
        SKU: p.code || "",
        Descripcion: p.desc || "",
        Stock: st,
        Disponibilidad: dispLabel(st)
      };
    }).sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    await downloadXlsx(
      "Lista_de_Precios_" + ts + ".xlsx",
      [
        { name: "Lista de precios", rows },
        { name: "Precios", rows: preciosRows },
        { name: "Stock", rows: stockRows }
      ],
      {
        // Painter aplicado post-render por downloadXlsx. Pinta la columna
        // "Disponibilidad" segun su valor: verde+blanco si DISPONIBLE,
        // rojo+blanco si NO DISPONIBLE. Centrado + bold para legibilidad.
        cellStyler: (cell, columnName, _value, _rowIndex) => {
          if (columnName !== "Disponibilidad") return;
          const txt = String(cell.value || "").toUpperCase();
          if (txt === "DISPONIBLE") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
            cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
          } else if (txt === "NO DISPONIBLE") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
            cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
          }
        }
      }
    );
    showSyncTag(rows.length + " SKUs exportados (lista de precios + disponibilidad)");
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
    const INFRACCIONES_MELI_READERS = [
      "erbinomariano@gmail.com",
      "mariano.erbino@shimano.com.ar",
      "diego.valsi@shimano.uy"
    ];
    const _canReadInfraccionesMeli = typeof currentUser !== "undefined" && currentUser && INFRACCIONES_MELI_READERS.includes((currentUser.email || "").toLowerCase());
    document.querySelectorAll("#export-modal .exp-opt").forEach((el) => {
      const kind = el.dataset.expKind || "";
      let show = !allowed || allowed.has(kind);
      if (kind === "INFRACCIONES_MELI" && !_canReadInfraccionesMeli) show = false;
      el.style.display = show ? "" : "none";
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
      else if (tipo === "VENTAS_ART_CLI") exportVentasArtCliForMonth(anio, monthIdx);
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
  async function downloadXlsx(filename, sheets, opts) {
    try {
      await window.loadExcelJS();
    } catch (e) {
      alert("No se pudo cargar ExcelJS: " + (e.message || e));
      return;
    }
    const wb = new ExcelJS.Workbook();
    const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF166534" } };
    const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true, size: 12 };
    const CENTER = { vertical: "middle", horizontal: "center", wrapText: true };
    const BORDER_THIN = { style: "thin", color: { argb: "FFCCCCCC" } };
    const BORDER = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };
    const cellStyler = opts && typeof opts.cellStyler === "function" ? opts.cellStyler : null;
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name.slice(0, 31));
      const rows = s.rows.length ? s.rows : [{ Aviso: "Sin datos para el periodo seleccionado" }];
      const headers = Object.keys(rows[0]);
      const headerRow = ws.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = CENTER;
        cell.border = BORDER;
      });
      headerRow.height = 26;
      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        const values = headers.map((h) => row[h] !== void 0 && row[h] !== null ? row[h] : "");
        const dataRow = ws.addRow(values);
        dataRow.eachCell((cell, colNumber) => {
          cell.alignment = CENTER;
          cell.border = BORDER;
          if (cellStyler) {
            try {
              cellStyler(cell, headers[colNumber - 1], values[colNumber - 1], rIdx);
            } catch (_e) {
            }
          }
        });
      }
      headers.forEach((h, i) => {
        let maxLen = String(h).length;
        for (const row of rows) {
          const v = String(row[h] === void 0 || row[h] === null ? "" : row[h]).split("\n")[0];
          if (v.length > maxLen) maxLen = v.length;
        }
        ws.getColumn(i + 1).width = Math.min(60, Math.max(10, maxLen + 4));
      });
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const mesYYYYMM = anio + "-" + String(monthIdx + 1).padStart(2, "0");
    const _resolveVendorFallback = (p) => {
      try {
        const cache = w.clientMasterCache;
        if (!cache) return "";
        const cc = String(p.clientCardCode || "").trim();
        if (cc && typeof cache.forEach === "function") {
          let found = "";
          cache.forEach((cmData) => {
            if (found) return;
            if (cmData && String(cmData.sapCardCode || "").trim() === cc && cmData.assignedVendor) {
              found = cmData.assignedVendor;
            }
          });
          if (found) return found;
        }
        if (typeof w.clientLocId === "function" && typeof cache.get === "function") {
          const cmDocId = w.clientLocId(p.province || "", p.locName || "", p.clientName || "");
          const cmData = cache.get(cmDocId);
          return cmData && cmData.assignedVendor || "";
        }
        return "";
      } catch (_e) {
        return "";
      }
    };
    const rawLines = computeFn ? computeFn(
      pedidos,
      "urgente",
      { mesYYYYMM },
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of pedidos) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qo = c.qtyBackorder || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let cantidadPedida = qo;
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) {
          cantidadPedida = Number(p.lines[idx].qty) || qo;
          lineaIdx = idx;
        }
      }
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Pedida: cantidadPedida,
        Cantidad_Pendiente_BO: qo,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_BO_ARS: Math.round(qo * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx,
        SQ_DocNum: c.sqDocNum || ""
      });
    });
    rows.sort((a, b) => (a.Cliente || "").localeCompare(b.Cliente || ""));
    const fname = "Shimano_Backorder_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Backorder", rows }]);
    showSyncTag("Export Backorder listo (" + rows.length + " lineas)", 2400);
  }
  async function exportStockAsigForMonth(anio, monthIdx) {
    showSyncTag("Generando export de Stock Asignado...");
    const pedidos = _iteratePedidosMes(anio, monthIdx);
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const mesYYYYMM = anio + "-" + String(monthIdx + 1).padStart(2, "0");
    const _resolveVendorFallback = (p) => {
      try {
        const cache = w.clientMasterCache;
        if (!cache) return "";
        const cc = String(p.clientCardCode || "").trim();
        if (cc && typeof cache.forEach === "function") {
          let found = "";
          cache.forEach((cmData) => {
            if (found) return;
            if (cmData && String(cmData.sapCardCode || "").trim() === cc && cmData.assignedVendor) {
              found = cmData.assignedVendor;
            }
          });
          if (found) return found;
        }
        if (typeof w.clientLocId === "function" && typeof cache.get === "function") {
          const cmDocId = w.clientLocId(p.province || "", p.locName || "", p.clientName || "");
          const cmData = cache.get(cmDocId);
          return cmData && cmData.assignedVendor || "";
        }
        return "";
      } catch (_e) {
        return "";
      }
    };
    const rawLines = computeFn ? computeFn(
      pedidos,
      "asignacion",
      { mesYYYYMM },
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of pedidos) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qty = c.qtyAsignada || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) lineaIdx = idx;
      }
      let estadoReal = "ASIG";
      if (c.state === "BO") estadoReal = "BO_con_stock_(virtual_ASIG)";
      else if (c.state === "confirmed") estadoReal = "confirmed (SQ en SAP)";
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Reservada: qty,
        Estado_Real: estadoReal,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_Reservado_ARS: Math.round(qty * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx
      });
    });
    rows.sort((a, b) => (a.SKU || "").localeCompare(b.SKU || ""));
    const fname = "Shimano_StockAsignado_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "Stock Asignado", rows }]);
    showSyncTag("Export Stock Asignado listo (" + rows.length + " lineas)", 2400);
  }
  window.exportBackorderAll = async function() {
    showSyncTag("Generando export de Backorder (snapshot actual)...");
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    const totalPedidosOpen = arr.filter((p) => p && !p.closedAt).length;
    const _resolveVendorFallback = (p) => {
      try {
        if (typeof window === "undefined") return "";
        const w2 = (
          /** @type {any} */
          window
        );
        if (typeof w2.clientLocId !== "function" || !w2.clientMasterCache || !w2.clientMasterCache.get)
          return "";
        const cmDocId = w2.clientLocId(p.province || "", p.locName || "", p.clientName || "");
        const cmData = w2.clientMasterCache.get(cmDocId);
        return cmData && cmData.assignedVendor || "";
      } catch (_e) {
        return "";
      }
    };
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const rawLines = computeFn ? computeFn(
      arr,
      "urgente",
      {},
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of arr) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qo = c.qtyBackorder || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let cantidadPedida = qo;
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) {
          cantidadPedida = Number(p.lines[idx].qty) || qo;
          lineaIdx = idx;
        }
      }
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Pedida: cantidadPedida,
        Cantidad_Pendiente_BO: qo,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_BO_ARS: Math.round(qo * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx,
        SQ_DocNum: c.sqDocNum || "",
        Origen: p && p.migrationSource || "app",
        // v1100: contexto útil para debugging paridad modal↔reporte.
        Estado: c.state || "BO",
        Stock_Disp_SKU: rl.dispSap || 0
      });
    });
    if (rows.length === 0) {
      alert(
        "Export Backorder vacio. Diagnostico:\n- Total pedidos en globalPedidos: " + arr.length + "\n- Pedidos abiertos (sin closedAt): " + totalPedidosOpen + "\n- Lineas post-FIFO+vencidas con qtyBackorder>0: 0\n\nPosibles causas:\n1. No hay backorder abierto ahora mismo (todo confirmed, cerrado o vencido)\n2. Los pedidos tienen closedAt seteado por error\n3. Todas las lineas BO tienen stock disponible (fueron promovidas a ASIG virtual)"
      );
      showSyncTag("Export Backorder: 0 lineas (ver alerta)", 3e3);
      return;
    }
    rows.sort((a, b) => (a.Cliente || "").localeCompare(b.Cliente || ""));
    const _computeSkuMapFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderSkuMap;
    const _modalDeps = {
      getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
      canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
      products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
      backorderLines: Array.isArray(w.backorderLines) ? w.backorderLines : [],
      sapGetClienteCode: typeof w.sapGetClienteCode === "function" ? w.sapGetClienteCode : void 0,
      resolveVendorFallback: _resolveVendorFallback
    };
    const _modalFilters = {
      tiendaQuery: "",
      vendorKey: "",
      mesYYYYMM: "",
      urgencyFilter: "",
      includeExpired: true,
      aggregationMode: "fifo"
    };
    const _modalResult = _computeSkuMapFn ? _computeSkuMapFn(arr, "urgente", _modalFilters, _modalDeps) : { skus: [], totalUnidades: 0, totalClientes: 0 };
    let totalPesosModal = 0;
    const subtotalesPorUrgency = { urgente: 0, parcial: 0 };
    for (const g of _modalResult.skus || []) {
      const urg = g.urgency || "urgente";
      for (const c of g.clientes || []) {
        const qty = Number(c.qtyBackorder) || 0;
        if (qty <= 0) continue;
        const precio = Number(c.precio) || 0;
        const sub = qty * precio;
        totalPesosModal += sub;
        if (urg === "parcial") subtotalesPorUrgency.parcial += sub;
        else subtotalesPorUrgency.urgente += sub;
      }
    }
    const totalUnidadesModal = _modalResult.totalUnidades || 0;
    const totalClientesModal = _modalResult.totalClientes || 0;
    const totalSkusModal = (_modalResult.skus || []).length;
    const resumenRows = [
      { Metrica: "TOTAL Backorder ARS (igual al modal)", Valor: Math.round(totalPesosModal) },
      { Metrica: "SKUs con backorder", Valor: totalSkusModal },
      { Metrica: "Unidades pendientes", Valor: Math.round(totalUnidadesModal) },
      { Metrica: "Clientes afectados", Valor: totalClientesModal },
      { Metrica: "\u2014 Subtotal SIN REPOSICION", Valor: Math.round(subtotalesPorUrgency.urgente) },
      { Metrica: "\u2014 Subtotal PARCIAL", Valor: Math.round(subtotalesPorUrgency.parcial) },
      {
        Metrica: "Lineas crudas en hoja Backorder (hay varias por cliente/SKU si hay multiples pedidos)",
        Valor: rows.length
      },
      { Metrica: "Snapshot generado", Valor: (/* @__PURE__ */ new Date()).toLocaleString("es-AR") }
    ];
    const totalRow = {
      Fecha_Pedido: "",
      Mes: "",
      Cliente: "TOTAL (igual al modal)",
      CardCode: "",
      Provincia: "",
      Localidad: "",
      Vendedor: "",
      SKU: "",
      Producto: "",
      Cantidad_Pedida: "",
      Cantidad_Pendiente_BO: Math.round(totalUnidadesModal),
      Precio_Unit_ARS: "",
      Subtotal_BO_ARS: Math.round(totalPesosModal),
      Pedido_ID: "",
      Linea_Idx: "",
      SQ_DocNum: "",
      Origen: "",
      Estado: "",
      Stock_Disp_SKU: ""
    };
    rows.push(totalRow);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fname = "Shimano_Backorder_Snapshot_" + today + ".xlsx";
    downloadXlsx(
      fname,
      [
        { name: "Resumen", rows: resumenRows },
        { name: "Backorder", rows }
      ],
      {
        // Pintar la fila TOTAL de la hoja Backorder + fila 1 (TOTAL) de Resumen.
        cellStyler: (cell, columnName, _value, rowIndex) => {
          const txt = String(cell.value || "");
          if (columnName === "Metrica" && txt.includes("TOTAL Backorder") || columnName === "Cliente" && txt.includes("TOTAL")) {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF991B1B" } };
          }
          if (rowIndex === 0 && columnName === "Valor") {
            cell.font = { bold: true };
          }
        }
      }
    );
    showSyncTag(
      "Export Backorder listo (" + (rows.length - 1) + " lineas + Resumen con total $" + Math.round(totalPesosModal).toLocaleString("es-AR") + ")",
      3e3
    );
  };
  window.exportStockAsigAll = async function() {
    showSyncTag("Generando export de Stock Asignado (snapshot actual)...");
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    const totalPedidosOpen = arr.filter((p) => p && !p.closedAt).length;
    const _resolveVendorFallback = (p) => {
      try {
        if (typeof window === "undefined") return "";
        const w2 = (
          /** @type {any} */
          window
        );
        if (typeof w2.clientLocId !== "function" || !w2.clientMasterCache || !w2.clientMasterCache.get)
          return "";
        const cmDocId = w2.clientLocId(p.province || "", p.locName || "", p.clientName || "");
        const cmData = w2.clientMasterCache.get(cmDocId);
        return cmData && cmData.assignedVendor || "";
      } catch (_e) {
        return "";
      }
    };
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
    const rawLines = computeFn ? computeFn(
      arr,
      "asignacion",
      {},
      {
        getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
        canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
        products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
        resolveVendorFallback: _resolveVendorFallback
      }
    ) : [];
    const pedidoById = {};
    for (const p of arr) if (p && p._fsId) pedidoById[p._fsId] = p;
    const rows = [];
    rawLines.forEach((rl) => {
      const c = rl.cliente;
      const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
      const qty = c.qtyAsignada || 0;
      let fechaPedido = "";
      if (c.pedidoCreatedAt) {
        const dt = c.pedidoCreatedAt;
        fechaPedido = typeof dt === "string" ? dt.slice(0, 10) : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
      }
      let lineaIdx = -1;
      if (p && Array.isArray(p.lines)) {
        const idx = p.lines.findIndex(
          (l) => l && String(l.code || "").toUpperCase() === rl.sku && l.state === c.state
        );
        if (idx >= 0) lineaIdx = idx;
      }
      let estadoReal = "ASIG";
      if (c.state === "BO") estadoReal = "BO_con_stock_(virtual_ASIG)";
      else if (c.state === "confirmed") estadoReal = "confirmed (SQ en SAP)";
      rows.push({
        Fecha_Pedido: fechaPedido,
        Mes: p && p.month || "",
        Cliente: c.nombre || "",
        CardCode: c.code || p && p.clientCardCode || "",
        Provincia: c.provincia || p && p.province || "",
        Localidad: c.ciudad || p && p.locName || "",
        Vendedor: c.vendorKey || "",
        SKU: rl.sku || "",
        Producto: rl.producto || "",
        Cantidad_Reservada: qty,
        Estado_Real: estadoReal,
        Precio_Unit_ARS: c.precio || 0,
        Subtotal_Reservado_ARS: Math.round(qty * (c.precio || 0)),
        Pedido_ID: c.pedidoId || "",
        Linea_Idx: lineaIdx,
        SQ_DocNum: c.sqDocNum || "",
        Origen: p && p.migrationSource || "app",
        // v1100: contexto útil para debugging paridad modal↔reporte.
        Stock_Disp_SKU: rl.dispSap || 0
      });
    });
    if (rows.length === 0) {
      alert(
        "Export Stock Asignado vacio. Diagnostico:\n- Total pedidos en globalPedidos: " + arr.length + "\n- Pedidos abiertos (sin closedAt): " + totalPedidosOpen + "\n- Lineas post-FIFO+vencidas con qtyAsignada>0: 0\n\nPosibles causas:\n1. No hay stock asignado ahora mismo\n2. Todos los ASIG estan vencidos (>15d desde asigAt)\n3. Los pedidos tienen closedAt seteado"
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
  window.exportPendienteDeAsignacionPablo = async function() {
    showSyncTag("Generando export Pendiente de Asignaci\xF3n - Pablo...");
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const fbDb2 = w.fbDb;
    if (!fbDb2) {
      alert("Firestore no inicializado. Reintent\xE1 en unos segundos.");
      return;
    }
    let repartosDocs;
    try {
      const snap = await fbDb2.collection("ingresos_reparto").where("status", "in", ["pending", "in_progress"]).get();
      repartosDocs = snap.docs;
    } catch (e) {
      alert("Error cargando ingresos_reparto: " + (e && e.message ? e.message : String(e)));
      return;
    }
    if (!repartosDocs || repartosDocs.length === 0) {
      alert("No hay repartos pending/in_progress ahora mismo.");
      showSyncTag("Export Pablo: 0 repartos", 2400);
      return;
    }
    const stockSnap = typeof w.getStockSnapshot === "function" ? w.getStockSnapshot() : w._stockSnapshotCache || { warehouseBreakdown: {} };
    const whs = typeof stockSnap.warehouseBreakdown === "string" ? JSON.parse(stockSnap.warehouseBreakdown) : stockSnap.warehouseBreakdown || {};
    const pedidos = Array.isArray(w.globalPedidos) ? w.globalPedidos : [];
    const waitlistEntries = typeof w._getWaitlistCpstEntries === "function" ? w._getWaitlistCpstEntries() : [];
    const ingresosRepartoActivos = repartosDocs.map(
      (d) => Object.assign({ _fsId: d.id }, d.data() || {})
    );
    const getBreakdown = w.__phase0 && w.__phase0.pure && w.__phase0.pure.getStockBreakdown;
    const prodBySku = /* @__PURE__ */ new Map();
    const PRODUCTS2 = Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [];
    for (const p of PRODUCTS2) {
      if (p && p.sku) prodBySku.set(String(p.sku).toUpperCase(), p);
    }
    const nowMs = Date.now();
    const resumenRows = [];
    const colaRows = [];
    for (const doc of repartosDocs) {
      const data = doc.data() || {};
      const sku = String(data.sku || "").toUpperCase();
      const prod = prodBySku.get(sku) || null;
      const fisicoDep11 = Number(whs[sku] && whs[sku]["11"] || 0);
      const qtyIngresada = Number(data.qtyIngresada || 0);
      const assignments = Array.isArray(data.assignments) ? data.assignments : [];
      let qtyYaAsignada = 0;
      for (const a of assignments) qtyYaAsignada += Number(a && a.qtyAsignada || 0);
      let qtyARepartir = Math.max(0, qtyIngresada - qtyYaAsignada);
      if (getBreakdown) {
        try {
          const bk = getBreakdown(
            sku,
            {
              getStockFisico: () => fisicoDep11,
              pedidos,
              waitlistEntries,
              ingresosRepartoActivos
            },
            { now: nowMs }
          );
          if (bk && bk.repartoAbierto && typeof bk.repartoAbierto.qty === "number") {
            qtyARepartir = bk.repartoAbierto.qty;
          }
        } catch (_e) {
        }
      }
      const clientesBO = Array.isArray(data.clientesBO) ? data.clientesBO : [];
      let detectedAt = data.detectedAt || "";
      if (detectedAt && typeof detectedAt.toDate === "function") {
        try {
          detectedAt = detectedAt.toDate().toISOString();
        } catch (_e) {
          detectedAt = "";
        }
      }
      const boTotalQty = clientesBO.reduce((s, c) => s + Number(c.qtyBackorder || 0), 0);
      resumenRows.push({
        Reparto_ID: doc.id,
        SKU: sku,
        Producto: prod && (prod.name || prod.description) || "",
        Fisico_Dep11: fisicoDep11,
        Qty_Ingresada: qtyIngresada,
        Qty_Ya_Asignada: qtyYaAsignada,
        Qty_A_Repartir: qtyARepartir,
        Clientes_En_Cola: clientesBO.length,
        BO_Total_Qty: boTotalQty,
        DetectedAt: typeof detectedAt === "string" ? detectedAt.slice(0, 19).replace("T", " ") : "",
        Status: data.status || ""
      });
      for (const c of clientesBO) {
        let fechaPed = c.pedidoCreatedAt || "";
        if (fechaPed && typeof fechaPed.toDate === "function") {
          try {
            fechaPed = fechaPed.toDate().toISOString();
          } catch (_e) {
            fechaPed = "";
          }
        }
        let vendedor = c.vendorKey || "";
        if (!vendedor && c.pedidoId) {
          const p = pedidos.find((x) => x && x._fsId === c.pedidoId);
          if (p) vendedor = p.ownerVendor || p.vendorAssigned || "";
        }
        colaRows.push({
          Reparto_ID: doc.id,
          SKU: sku,
          Cliente: c.clientName || "",
          CardCode: c.clientCardCode || "",
          Provincia: c.clientProvince || "",
          Localidad: c.clientLocality || "",
          Vendedor: vendedor,
          Qty_BO: Number(c.qtyBackorder || 0),
          Fecha_Pedido_Original: typeof fechaPed === "string" ? fechaPed.slice(0, 10) : "",
          Pedido_ID: c.pedidoId || ""
        });
      }
    }
    resumenRows.sort((a, b) => b.Qty_A_Repartir - a.Qty_A_Repartir);
    colaRows.sort(
      (a, b) => (a.SKU || "").localeCompare(b.SKU || "") || (a.Fecha_Pedido_Original || "").localeCompare(b.Fecha_Pedido_Original || "")
    );
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fname = "Shimano_PendienteDeAsignacion_Pablo_" + today + ".xlsx";
    downloadXlsx(fname, [
      { name: "Resumen reparto", rows: resumenRows },
      { name: "Clientes en cola", rows: colaRows }
    ]);
    showSyncTag(
      "Export Pablo: " + resumenRows.length + " repartos / " + colaRows.length + " clientes en cola",
      2800
    );
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
  async function exportVentasArtCliForMonth(anio, monthIdx) {
    if (monthIdx === null || monthIdx === void 0) {
      alert('Eleg\xED un MES espec\xEDfico (no "Todo el a\xF1o") \u2014 este reporte es mensual.');
      return;
    }
    const month = monthIdx + 1;
    const year = anio;
    const periodo = (window.MESES ? window.MESES[monthIdx] : month) + " " + year;
    const confirmMsg = 'Generar reporte "VENTAS x ARTICULO x CLIENTE/VENDEDOR" de ' + periodo + "?\n\nFuente: SAP via BigQuery (datos exactos).\nPuede tardar 30-60 segundos.\nAl terminar se descarga automaticamente el xlsx.";
    if (!confirm(confirmMsg)) return;
    showSyncTag("Generando reporte server-side (BQ)... puede tardar ~60s");
    try {
      try {
        const u = window.firebase.auth && window.firebase.auth().currentUser;
        if (u && u.getIdToken) await u.getIdToken(true);
      } catch (_e) {
      }
      const callable = window.firebase.app().functions("southamerica-east1").httpsCallable("generateVentasReportCF");
      const resp = await callable({ year, month });
      const r = resp && resp.data || {};
      if (!r.ok || !r.bytesBase64) {
        alert("CF devolvio error: " + (r.error || JSON.stringify(r)));
        return;
      }
      const bin = atob(r.bytesBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: r.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename || "ventas_x_articulo_cliente_" + year + "-" + String(month).padStart(2, "0") + ".xlsx";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1e3);
      const stats = r.stats || {};
      showSyncTag(
        "OK: " + (stats.ventas || 0) + " ventas / " + (stats.items || 0) + " SKUs / " + (stats.clients || 0) + " clientes"
      );
    } catch (e) {
      console.error("[exportVentasArtCli] error", e);
      alert("Error generando el reporte: " + (e && e.message ? e.message : String(e)));
    }
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
    const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    await downloadXlsx("TARGETS_VENDEDORES_ZONAS_" + ts + ".xlsx", [
      { name: "CLIENTES_ZONAS", rows }
    ]);
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
  window._ventasArtCliClick = function() {
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const role = w.userRole || "";
    if (role !== "admin" && role !== "gerente") {
      alert("Este reporte es solo para admin / gerente.");
      return;
    }
    const ok = confirm(
      "Reporte server-side (BigQuery). Tarda 30-60 segundos y descarga un .xlsx con 4 hojas:\n  \u2022 Productos vendidos por VDE\n  \u2022 Productos NO vendidos por VDE\n  \u2022 Clientes CON compra por VDE\n  \u2022 Clientes SIN compra por VDE\n\nContinuar?"
    );
    if (!ok) return;
    if (typeof w.closeExportDialog === "function") w.closeExportDialog();
    if (typeof w.showMonthPicker === "function") w.showMonthPicker("VENTAS_ART_CLI");
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFQT0lOVFMgfHwgIVBPSU5UUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xuXG4gIC8vIHYxNDgyIFx1MDBBNzgyOiBjYXJnYXIgY2xpZW50X2J1eWVyX3N0YXRzIGVuIGJsb3F1ZSAoMSBkb2MgcG9yIGNhcmRDb2RlIFNBUClcbiAgLy8gQU5URVMgZGUgYXJtYXIgbGFzIGZpbGFzLCBhc1x1MDBFRCBjYWRhIGZpbGEgdGllbmUgc3UgYnV5ZXIgc3RhdHMgKyBmZWNoYVxuICAvLyBcdTAwRkFsdGltYSBjb21wcmEgc2luIHJvbXBlciBlbCBmbHVqby4gRmlyZS1hbmQtZm9yZ2V0IHNpIGZhbGxhOiBjYWRhIGZpbGFcbiAgLy8gY2FlIGEgXCItXCIgZW4gbG9zIGNhbXBvcyBCdXllci4gQWRtaW4vZ2VyZW50ZSB2ZSB0b2RhIGxhIGNvbGVjY2lcdTAwRjNuO1xuICAvLyB2ZW5kZWRvciB2ZSBzXHUwMEYzbG8gbG9zIHN1eW9zIChydWxlcykuIFNpIGxhIHJ1bGUgYmxvcXVlYSBcdTIxOTIgY2F0Y2ggXHUyMTkyIHZhY1x1MDBFRG8uXG4gIC8vIFBlZGlkbyBNYXJpYW5vOiBubyBpbnZlbnRhciBjXHUwMEUxbGN1bG8gZGUgXCJGZWNoYSBcdTAwRkFsdGltYSBjb21wcmFcIjsgc2kgbm9cbiAgLy8gZXhpc3RlIHNlIG9taXRlLiBidXllcl9zdGF0cy5zdGF0c18xMm0udWx0aW1hQ29tcHJhIFlBIGV4aXN0ZS5cbiAgY29uc3QgYnV5ZXJTdGF0c0lkeCA9IG5ldyBNYXAoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBic1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9idXllcl9zdGF0cycpLmdldCgpO1xuICAgIGJzU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBidXllclN0YXRzSWR4LnNldChkLmlkLCBkLmRhdGEoKSB8fCB7fSk7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgY29uc29sZS53YXJuKFxuICAgICAgJ1ttYXN0ZXJmaWxlXSBjbGllbnRfYnV5ZXJfc3RhdHMgbm8gY2FyZ2FkbyAocnVsZSBkZW5pZWQgbyByZWQpOicsXG4gICAgICBfZSAmJiBfZS5tZXNzYWdlXG4gICAgKTtcbiAgfVxuICAvLyBIZWxwZXJzIGRlbCBwdXJlIGZuIChmYWxsYmFjayBpbmxpbmUgc2kgYnVuZGxlIG5vIGNhcmdcdTAwRjMpLlxuICBjb25zdCBfZmNMYWJlbHMgPVxuICAgICh3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUuZmljaGFDbGllbnRlTGFiZWxzKSB8fCBudWxsO1xuICBjb25zdCBfY2xhc2lmUm93ID0gKGNtZCkgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUNsYXNpZlJvd1xuICAgICAgPyBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93KGNtZClcbiAgICAgIDoge1xuICAgICAgICAgICdUaXBvIGRlIGNsaWVudGUnOiAnLScsXG4gICAgICAgICAgRmlkZWxpZGFkOiAnLScsXG4gICAgICAgICAgJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJzogJy0nLFxuICAgICAgICAgIFRhbWFcdTAwRjFvOiAnLScsXG4gICAgICAgICAgRXNwZWNpYWxpemFjaVx1MDBGM246ICctJyxcbiAgICAgICAgICAnVGlwbyBkZSBsb2NhbCc6ICctJyxcbiAgICAgICAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IGNtZCAmJiBjbWQuY3JlZGl0b0NoZXF1ZSA/IE51bWJlcihjbWQuY3JlZGl0b0NoZXF1ZSkgOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9idXllclJvdyA9IChicykgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVCdXllclJvdyhicywgJzEybScpXG4gICAgICA6IHtcbiAgICAgICAgICAnTW9udG8gdG90YWwgKDEybSknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogJy0nLFxuICAgICAgICAgICdGYWN0dXJhcyBwb3IgbWVzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcmltZXJhIGNvbXByYSc6ICctJyxcbiAgICAgICAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICB9O1xuICBjb25zdCBfZmlsbERhc2ggPSAocm93KSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5ID8gX2ZjTGFiZWxzLmZpbGxEYXNoSW5FbXB0eShyb3cpIDogcm93O1xuICAvLyBTY29wZSBwb3IgdmVuZG9yICh2MzMxKTogZWwgZXhwb3J0IHJlc3BldGEgZWwgZmlsdHJvIGRlIHpvbmEgYWN0aXZvIGVuIGVsXG4gIC8vIGRyb3Bkb3duLiBBZG1pbi9nZXJlbnRlL3ZpZXdlciBjb24gJ1RvZGFzJyBvYnRpZW5lbiBudWxsIC0+IHNpbiBmaWx0cm9cbiAgLy8gKGV4cG9ydGEgdG9kbyBlbCBwYWlzKS4gVmVuZGVkb3Igb2J0aWVuZSB7YXNzaWduZWRWZW5kb3J9LiBWREkgb2J0aWVuZVxuICAvLyBzdXMgcGFyZWphcyArIHByb3BpbyBzaSBlbGlnaW8gJ1RvZGFzIG1pcyB6b25hcycsIG8gc29sbyBlbCBzdWJzZXQgcXVlXG4gIC8vIGVsaWdpbyAocHJvcGlvIC8gdW5hIHBhcmVqYSBlc3BlY2lmaWNhKS4gRnVlcmEgZGUgZXN0ZSBzZXQsIGxhcyB0aWVuZGFzXG4gIC8vIG5vIHNlIGluY2x1eWVuIGVuIGVsIEV4Y2VsIC0gZWwgYXJjaGl2byByZWZsZWphIGV4YWN0YW1lbnRlIGxvIHF1ZSB2ZVxuICAvLyBlbiBlbCBtYXBhIHF1aWVuIGV4cG9ydGEuXG4gIGNvbnN0IHNjb3BlU2V0ID1cbiAgICB0eXBlb2YgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0ID09PSAnZnVuY3Rpb24nXG4gICAgICA/IGdldEVmZmVjdGl2ZVZlbmRvclNldCh0eXBlb2YgY3VycmVudFZlbmRvciAhPT0gJ3VuZGVmaW5lZCcgPyBjdXJyZW50VmVuZG9yIDogJ0FMTCcpXG4gICAgICA6IG51bGw7XG4gIGNvbnN0IGluU2NvcGUgPSAodmVuZG9yS2V5KSA9PiB7XG4gICAgaWYgKHNjb3BlU2V0ID09PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoIXZlbmRvcktleSkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBzY29wZVNldC5oYXModmVuZG9yS2V5KTtcbiAgfTtcbiAgLy8gTWFwZW8gVkRFIC0+IFZESSAoYSBwYXJ0aXIgZGUgbGFzIHBhcmVqYXMgZXN0YW5kYXIpLiBDdWFuZG8gdW5hIHRpZW5kYVxuICAvLyBwZXJ0ZW5lY2UgYSBGZWRlcmljbyBvIEdvbnphbG8sIGVsIFZESSBlcyBJb2FubmlzLiBDdWFuZG8gZXMgZGUgTWF1cmljaW9cbiAgLy8gbyBNYXJ0aW4sIGVsIFZESSBlcyBTYW50aWFnby4gU2kgZW4gZWwgZnV0dXJvIHNlIHJlYXNpZ25hbiBwYXJlamFzIHZpYVxuICAvLyBwYW5lbCBhZG1pbiwgZXN0byBzZSBwb2RyaWEgbGVlciBkZWwgRmlyZXN0b3JlIC0gcGVybyBwYXJhIGVsIG1hc3RlcmZpbGVcbiAgLy8gZXN0YXRpY28sIHVzYW1vcyBlbCBlc3RhbmRhci5cbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiBsb29rdXBab25lKHZlbmRvcktleSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xuICAgIHJldHVybiB2ID8gdi56b25lIDogJyc7XG4gIH1cbiAgZnVuY3Rpb24gbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LmxhYmVsIDogdmVuZG9yS2V5IHx8ICcnO1xuICB9XG5cbiAgLy8gdjQ1MCAoMjAyNi0wOC0xMSk6IGluZGljZSBkZSBjbGFzaWZpY2FjaW9uIGRlc2RlIHZpc2l0cy4gUGFyYSBjYWRhXG4gIC8vIGNsaWVudGUsIG1lcmdlYSBsb3MgY2FtcG9zIGRlIGNsYXNpZmljYWNpb24gKHRpcG8vdGFtYW5vL2ZpZGVsaWRhZC9cbiAgLy8gZXNwZWNpYWxpemFjaW9uL2NhbmFsQ29tcHJhL3BvcC90aXBvVmVudGEvZXRjLikgZGVsIGZvcm11bGFyaW8gZGVcbiAgLy8gdmlzaXRhL2NvbnRhY3RhZG8uIFBvbGl0aWNhOiBjYW1wbyBwb3IgY2FtcG8sIHRvbWFyIGVsIHByaW1lciB2YWxvclxuICAvLyBOTyBWQUNJTyBhbCByZWNvcnJlciBkb2NzIGRlIG1hcyByZWNpZW50ZSBhIG1hcyBhbnRpZ3VvLiBBc2kgZWwgdXN1YXJpb1xuICAvLyB2ZSBsYSBjbGFzaWZpY2FjaW9uIG1hcyBhY3R1YWxpemFkYSwgcGVybyBzaSBlbCB1bHRpbW8gY29udGFjdG8gbm8gbGxlbmFcbiAgLy8gdW4gY2FtcG8gKGNvbnRhY3RvcyB0aWVuZW4gbWVub3MgY2FtcG9zIHF1ZSB2aXNpdGFzKSwgY2FlIGFsIGFudGVyaW9yXG4gIC8vIGVuIHZleiBkZSBkZWphciB2YWNpby4gUGVkaWRvIGRlIE1hcmlhbm86IFwicHJpb3JpemFyIGxhIHVsdGltYVxuICAvLyBpbnRlcmFjY2lvbiBwZXJvIG5vIHBlcmRlciBpbmZvIHV0aWwgZGUgbGFzIGFudGVyaW9yZXNcIi5cbiAgY29uc3QgQ0xBU1NJRl9GSUVMRFMgPSBbXG4gICAgJ3RpcG8nLFxuICAgICdsb2NhbCcsXG4gICAgJ3RhbWFubycsXG4gICAgJ2ZpZGVsaWRhZCcsXG4gICAgJ2VzcGVjaWFsaXphY2lvbicsXG4gICAgJ2NhbmFsQ29tcHJhJyxcbiAgICAncmVsZXZhbmNpYScsXG4gICAgJ3BvcCcsXG4gICAgJ25lY2VzaWRhZFB1bnR1YWwnLFxuICAgICd0aXBvVmVudGEnLFxuICAgICdwb25kZXJhY2lvbk1vc3RyYWRvJyxcbiAgICAncG9uZGVyYWNpb25FY29tbWVyY2UnLFxuICAgICdjb21wZXRlbmNpYScsXG4gICAgJ29wb3J0dW5pZGFkJyxcbiAgICAnbWFzVmVuZGlkbycsXG4gICAgJ21hc1ByZWd1bnRhbicsXG4gICAgJ2F5dWRhVGllbmRhJyxcbiAgXTtcbiAgZnVuY3Rpb24gX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpIHtcbiAgICByZXR1cm4gKFxuICAgICAgKHByb3YgfHwgJycpLnRvU3RyaW5nKCkudG9VcHBlckNhc2UoKS50cmltKCkgK1xuICAgICAgJ3wnICtcbiAgICAgIChsb2MgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpICtcbiAgICAgICd8JyArXG4gICAgICAodGllbmRhIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKVxuICAgICk7XG4gIH1cbiAgZnVuY3Rpb24gX2NsYXNzaWZUcyh2KSB7XG4gICAgaWYgKHYgJiYgdi5jcmVhdGVkQXQgJiYgdi5jcmVhdGVkQXQudG9NaWxsaXMpIHJldHVybiB2LmNyZWF0ZWRBdC50b01pbGxpcygpO1xuICAgIGlmICh2ICYmIHYuZmVjaGEpIHJldHVybiBuZXcgRGF0ZSh2LmZlY2hhKS5nZXRUaW1lKCkgfHwgMDtcbiAgICByZXR1cm4gMDtcbiAgfVxuICBjb25zdCBjbGFzc2lmSW5kZXggPSBuZXcgTWFwKCk7IC8vIGtleSAtPiB7IGxhc3Q6IHtjYW1wb3N9LCBsYXN0RmVjaGEsIGxhc3RUeXBlLCB2aXNpdGFzLCBjb250YWN0b3MgfVxuICBpZiAodHlwZW9mIHZpc2l0c0NhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KHZpc2l0c0NhY2hlKSkge1xuICAgIGNvbnN0IGJ5S2V5ID0gbmV3IE1hcCgpO1xuICAgIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcbiAgICAgIGlmICghdikgcmV0dXJuO1xuICAgICAgY29uc3QgayA9IF9jbGFzc2lmS2V5KHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xuICAgICAgaWYgKCFieUtleS5oYXMoaykpIGJ5S2V5LnNldChrLCBbXSk7XG4gICAgICBieUtleS5nZXQoaykucHVzaCh2KTtcbiAgICB9KTtcbiAgICBieUtleS5mb3JFYWNoKChhcnIsIGspID0+IHtcbiAgICAgIGFyci5zb3J0KChhLCBiKSA9PiBfY2xhc3NpZlRzKGIpIC0gX2NsYXNzaWZUcyhhKSk7IC8vIGRlc2MgcG9yIGZlY2hhXG4gICAgICBjb25zdCBtZXJnZWQgPSB7fTtcbiAgICAgIGFyci5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICAgIENMQVNTSUZfRklFTERTLmZvckVhY2goKGYpID0+IHtcbiAgICAgICAgICBpZiAobWVyZ2VkW2ZdICE9IG51bGwgJiYgbWVyZ2VkW2ZdICE9PSAnJyAmJiBtZXJnZWRbZl0gIT09IDApIHJldHVybjtcbiAgICAgICAgICBjb25zdCB2YWwgPSB2W2ZdO1xuICAgICAgICAgIGlmICh2YWwgIT0gbnVsbCAmJiB2YWwgIT09ICcnKSBtZXJnZWRbZl0gPSB2YWw7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBjb25zdCBsYXRlc3QgPSBhcnJbMF0gfHwge307XG4gICAgICBjbGFzc2lmSW5kZXguc2V0KGssIHtcbiAgICAgICAgbWVyZ2VkLFxuICAgICAgICBsYXN0RmVjaGE6IGxhdGVzdC5mZWNoYSB8fCAnJyxcbiAgICAgICAgbGFzdFR5cGU6IGxhdGVzdC5pbnRlcmFjdGlvblR5cGUgfHwgKGxhdGVzdC5lc3BhY2lvID8gJ3Zpc2l0YScgOiAnJyksXG4gICAgICAgIHZpc2l0YXM6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGgsXG4gICAgICAgIGNvbnRhY3RvczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0bycpLmxlbmd0aCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIGZ1bmN0aW9uIF9jbGFzc2lmUm93KHByb3YsIGxvYywgdGllbmRhKSB7XG4gICAgY29uc3QgZW50cnkgPSBjbGFzc2lmSW5kZXguZ2V0KF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSk7XG4gICAgaWYgKCFlbnRyeSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgJ1VsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxuICAgICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiAnJyxcbiAgICAgICAgJ1RvdGFsIHZpc2l0YXMnOiAwLFxuICAgICAgICAnVG90YWwgY29udGFjdG9zJzogMCxcbiAgICAgICAgJ1RpcG8gY29tZXJjaW8nOiAnJyxcbiAgICAgICAgTG9jYWw6ICcnLFxuICAgICAgICBUYW1hbm86ICcnLFxuICAgICAgICBGaWRlbGlkYWQ6ICcnLFxuICAgICAgICBFc3BlY2lhbGl6YWNpb246ICcnLFxuICAgICAgICAnQ2FuYWwgZGUgY29tcHJhJzogJycsXG4gICAgICAgIFJlbGV2YW5jaWE6ICcnLFxuICAgICAgICBQT1A6ICcnLFxuICAgICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAnJyxcbiAgICAgICAgJ1RpcG8gZGUgdmVudGEnOiAnJyxcbiAgICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAnJyxcbiAgICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogJycsXG4gICAgICAgIENvbXBldGVuY2lhOiAnJyxcbiAgICAgICAgT3BvcnR1bmlkYWQ6ICcnLFxuICAgICAgICAnTWFzIHZlbmRpZG8nOiAnJyxcbiAgICAgICAgJ01hcyBwcmVndW50YW4nOiAnJyxcbiAgICAgICAgJ0F5dWRhIHRpZW5kYSc6ICcnLFxuICAgICAgfTtcbiAgICB9XG4gICAgY29uc3QgbSA9IGVudHJ5Lm1lcmdlZCB8fCB7fTtcbiAgICByZXR1cm4ge1xuICAgICAgJ1VsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RGZWNoYSxcbiAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6IGVudHJ5Lmxhc3RUeXBlLFxuICAgICAgJ1RvdGFsIHZpc2l0YXMnOiBlbnRyeS52aXNpdGFzLFxuICAgICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IGVudHJ5LmNvbnRhY3RvcyxcbiAgICAgICdUaXBvIGNvbWVyY2lvJzogbS50aXBvIHx8ICcnLFxuICAgICAgTG9jYWw6IG0ubG9jYWwgfHwgJycsXG4gICAgICBUYW1hbm86IG0udGFtYW5vIHx8ICcnLFxuICAgICAgRmlkZWxpZGFkOiBtLmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIEVzcGVjaWFsaXphY2lvbjogbS5lc3BlY2lhbGl6YWNpb24gfHwgJycsXG4gICAgICAnQ2FuYWwgZGUgY29tcHJhJzogbS5jYW5hbENvbXByYSB8fCAnJyxcbiAgICAgIFJlbGV2YW5jaWE6IG0ucmVsZXZhbmNpYSAhPSBudWxsID8gbS5yZWxldmFuY2lhIDogJycsXG4gICAgICBQT1A6IG0ucG9wIHx8ICcnLFxuICAgICAgJ05lY2VzaWRhZCBwdW50dWFsJzogbS5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxuICAgICAgJ1RpcG8gZGUgdmVudGEnOiBtLnRpcG9WZW50YSB8fCAnJyxcbiAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogbS5wb25kZXJhY2lvbk1vc3RyYWRvICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gOiAnJyxcbiAgICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6IG0ucG9uZGVyYWNpb25FY29tbWVyY2UgIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25FY29tbWVyY2UgOiAnJyxcbiAgICAgIENvbXBldGVuY2lhOiBtLmNvbXBldGVuY2lhIHx8ICcnLFxuICAgICAgT3BvcnR1bmlkYWQ6IG0ub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICAnTWFzIHZlbmRpZG8nOiBtLm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgICAnTWFzIHByZWd1bnRhbic6IG0ubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgJ0F5dWRhIHRpZW5kYSc6IG0uYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEZJTFRSTyBTQVA6IHNvbG8gc2UgZXhwb3J0YW4gbG9zIGNsaWVudGVzIEhBQklMSVRBRE9TIGVuIFNBUCAtIGxvcyBxdWVcbiAgLy8gdGllbmVuIGNhcmRDb2RlICsgZGlyZWNjaW9uLiBFc29zIHNvbiBsb3MgcXVlIGFwYXJlY2VuIGNvbW8gdmVyZGVzIGVuXG4gIC8vIGVsIG1hcGEgeSBzZSBjdWVudGFuIGVuIGVsIHN0YXQgSEFCSUxJVEFET1MuIEFudGVzIGVsIG1hc3RlcmZpbGUgYmFqYWJhXG4gIC8vIGxvcyB+MTAwMCBQT0lOVFMgZGVsIHBhZHJvbiBoaXN0b3JpY28sIHF1ZSBubyByZXByZXNlbnRhYmEgZWwgdW5pdmVyc29cbiAgLy8gcmVhbCBvcGVyYWJsZSBob3kuXG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgUE9JTlRTLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCBwcm92aW5jZSA9IHAucHJvdmluY2UgfHwgJyc7XG4gICAgY29uc3QgbG9jYWxpdHlNYXAgPSBwLm5hbWUgfHwgJyc7XG4gICAgY29uc3QgZGVwdCA9IHAuZGVwdCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBwLnZlbmRvciB8fCAnJztcbiAgICAvLyB2MzMxOiBmaWx0cmFyIHBvciBzY29wZSBkZSB2ZW5kb3IgZGVsIHVzdWFyaW8gcXVlIGV4cG9ydGEuXG4gICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcbiAgICBjb25zdCB6b25lID0gbG9va3VwWm9uZSh2ZW5kb3IpO1xuICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcbiAgICBjb25zdCBsYXQgPSBwLmxhdCAhPSBudWxsID8gcC5sYXQgOiAnJztcbiAgICBjb25zdCBsb24gPSBwLmxvbiAhPSBudWxsID8gcC5sb24gOiAnJztcbiAgICAvLyBTb2xvIGNsaWVudGVzIHJlZ3VsYXJlcyAobm8gcHJvc3BlY3RzLCBubyBkaXN0cmlidWlkb3JlcykgcXVlIHBhc2VuXG4gICAgLy8gZWwgZmlsdHJvIGlzU2FwQ29uZmlybWVkOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uXG4gICAgKHAuY2xpZW50cyB8fCBbXSkuZm9yRWFjaCgobmFtZSkgPT4ge1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBpZiAodHlwZW9mIGlzU2FwQ29uZmlybWVkICE9PSAnZnVuY3Rpb24nIHx8ICFpc1NhcENvbmZpcm1lZChwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpKVxuICAgICAgICByZXR1cm47XG4gICAgICBjb25zdCBrID0gJ0N8JyArIHByb3ZpbmNlICsgJ3wnICsgbG9jYWxpdHlNYXAgKyAnfCcgKyBuYW1lO1xuICAgICAgLy8gRXN0YWRvOiBoYWJpbGl0YWRvL2NhbmNlbGFkby9wZW5kaWVudGUgKGxlZ2FjeSBjb250YWN0ZWQgc2V0KS5cbiAgICAgIGxldCBlc3RhZG8gPSAnSGFiaWxpdGFkbyc7IC8vIHBvciBkZWZpbmljaW9uIHlhIGVzdGEgU0FQLWNvbmZpcm1hZG9cbiAgICAgIGlmICh0eXBlb2YgY2FuY2VsZWQgIT09ICd1bmRlZmluZWQnICYmIGNhbmNlbGVkICYmIGNhbmNlbGVkLmhhcyAmJiBjYW5jZWxlZC5oYXMoaykpXG4gICAgICAgIGVzdGFkbyA9ICdDYW5jZWxhZG8nO1xuICAgICAgLy8gTWV0YWRhdGEgY3VzdG9tIChkaXJlY2Npb24sIGxvY2FsaWRhZCBkZWNsYXJhZGEsIGdlb2NvZGUpLlxuICAgICAgY29uc3QgbWV0YSA9IHR5cGVvZiBjbGllbnRNZXRhICE9PSAndW5kZWZpbmVkJyAmJiBjbGllbnRNZXRhID8gY2xpZW50TWV0YVtrXSB8fCB7fSA6IHt9O1xuICAgICAgY29uc3QgY3VzdG9tTmFtZSA9IG1ldGEuY3VzdG9tTmFtZSB8fCAnJztcbiAgICAgIC8vIEJ1c2NhciBhZGRyZXNzOiAxKSBjbGllbnRfbWFzdGVyLmFkZHJlc3MgKGFkbWluKSwgMikgY2xpZW50TWV0YS5hZGRyZXNzICh2ZW5kb3IpLlxuICAgICAgY29uc3QgZG9jSWQgPVxuICAgICAgICB0eXBlb2YgY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgPyBjbGllbnRMb2NJZChwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpIDogJyc7XG4gICAgICBjb25zdCBjbURhdGEgPVxuICAgICAgICB0eXBlb2YgY2xpZW50TWFzdGVyQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIGRvY0lkID8gY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGRvY0lkKSB8fCB7fSA6IHt9O1xuICAgICAgY29uc3QgYWRkcmVzcyA9IGNtRGF0YS5hZGRyZXNzIHx8IG1ldGEuYWRkcmVzcyB8fCAnJztcbiAgICAgIGNvbnN0IGxvY2FsaXR5Q3VzdCA9IGNtRGF0YS5sb2NhbGlkYWQgfHwgbWV0YS5sb2NhbGl0eSB8fCAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxhdCA9IG1ldGEubGF0ICE9IG51bGwgPyBtZXRhLmxhdCA6ICcnO1xuICAgICAgY29uc3QgY3VzdG9tTG5nID0gbWV0YS5sbmcgIT0gbnVsbCA/IG1ldGEubG5nIDogJyc7XG4gICAgICAvLyBDYXJkQ29kZSBTQVAgKGRlIGNsaWVudF9tYXN0ZXIgbyBkZSBsYSBhbHRhIHZpbmN1bGFkYSkuXG4gICAgICBsZXQgY2FyZENvZGUgPSBjbURhdGEuc2FwQ2FyZENvZGUgfHwgJyc7XG4gICAgICBpZiAoIWNhcmRDb2RlICYmIHR5cGVvZiBhcHByb3ZlZEFsdGFzQnlMb2MgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGNvbnN0IGtleSA9IHByb3ZpbmNlLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBsb2NhbGl0eU1hcDtcbiAgICAgICAgY29uc3QgYWx0YXMgPSBhcHByb3ZlZEFsdGFzQnlMb2Nba2V5XSB8fCBbXTtcbiAgICAgICAgY29uc3QgYWx0YU1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4gKGEuY29tZXJjaW8gfHwgYS5mYW50YXNpYSB8fCAnJykgPT09IG5hbWUpO1xuICAgICAgICBpZiAoYWx0YU1hdGNoKSBjYXJkQ29kZSA9IGFsdGFNYXRjaC5jYXJkQ29kZVNhcCB8fCAnJztcbiAgICAgIH1cbiAgICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBCdXllciBzdGF0cyBpbmRleGFkbyBwb3IgY2FyZENvZGUgU0FQLlxuICAgICAgY29uc3QgX2J1eWVyU3RhdHMgPSBjYXJkQ29kZSA/IGJ1eWVyU3RhdHNJZHguZ2V0KGNhcmRDb2RlKSB8fCBudWxsIDogbnVsbDtcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogY2FyZENvZGUsXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6IGN1c3RvbU5hbWUsXG4gICAgICAgICAgICBUaXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdmluY2UpIDogcHJvdmluY2UsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvY2FsaXR5TWFwLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhZGRyZXNzLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGN1c3RvbUxhdCB8fCBsYXQsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGN1c3RvbUxuZyB8fCBsb24sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogT1JERU4gaW1wb3J0YS4gTGVnYWN5IHZpc2l0YXMgUFJJTUVSTyAoZmFsbGJhY2spLFxuICAgICAgICAgIC8vIGx1ZWdvIEZpY2hhIENsaWVudGUgUElTQSBjb24gbGFiZWxzIGRlIGxhIGZ1ZW50ZSBhdXRvcml0YXRpdmFcbiAgICAgICAgICAvLyAoZWouIFwiRmlkZWxpZGFkXCIgRmljaGEgcGlzYSBsYSBtZXJnZWFkYSBkZSB2aXNpdGFzIHF1ZSBwdWVkZVxuICAgICAgICAgIC8vIGVzdGFyIGRlc2FjdHVhbGl6YWRhKS4gQnV5ZXIgc3RhdHMgYWwgZmluYWwgKHZlbnRhbmEgMTJtKS5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpLFxuICAgICAgICAgIF9jbGFzaWZSb3coY21EYXRhKSxcbiAgICAgICAgICBfYnV5ZXJSb3coX2J1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuICAvLyBJbnllY3RhciBhbHRhcyBkZSBjbGllbnRfYXBwbGljYXRpb25zIChhcHByb3ZlZEFsdGFzTGlzdCk6XG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXG4gIC8vICAgKiBQUk9WSVNPUklPUyAodjMxMSspOiBtYW51YWxTYXBQZW5kaW5nICYmICFjYXJkQ29kZVNhcCAoQWx0YSBSYXBpZGFcbiAgLy8gICAgIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuIFZhbiBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy4gU2VcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xuICAvLyAgICAgcXVlIGVsIGdlcmVudGUgZXN0YSBnZXN0aW9uYW5kbywgbm8gc29sbyBsb3MgY2VycmFkb3MgZW4gU0FQLlxuICAvLyAgICAgTG9zIHByb3Zpc29yaW9zIHB1ZWRlbiBubyB0ZW5lciBkaXJlY2Npb24gdG9kYXZpYSAtPiBzZSBhY2VwdGFuIGlndWFsLlxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBzZWVuLmFkZChcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxuICAgICk7XG4gIH0pO1xuICBpZiAodHlwZW9mIGFwcHJvdmVkQWx0YXNMaXN0ICE9PSAndW5kZWZpbmVkJyAmJiBhcHByb3ZlZEFsdGFzTGlzdC5sZW5ndGgpIHtcbiAgICBhcHByb3ZlZEFsdGFzTGlzdC5mb3JFYWNoKChhKSA9PiB7XG4gICAgICBpZiAoIWEpIHJldHVybjtcbiAgICAgIGNvbnN0IGlzUHJvdmlzb3JpbyA9ICEhYS5tYW51YWxTYXBQZW5kaW5nICYmICFhLmNhcmRDb2RlU2FwO1xuICAgICAgLy8gSGFiaWxpdGFkb3M6IHNpZ3VlbiBleGlnaWVuZG8gY2FyZENvZGUgKyBkaXJlY2Npb24gKGNvbXBvcnRhbWllbnRvIHByZS12MzExKS5cbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXG4gICAgICBpZiAoIWlzUHJvdmlzb3Jpbykge1xuICAgICAgICBpZiAoIWEuY2FyZENvZGVTYXApIHJldHVybjtcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwcm92ID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgY29uc3Qgbm9tYnJlID1cbiAgICAgICAgYS5jb21lcmNpbyB8fFxuICAgICAgICBhLmZhbnRhc2lhIHx8XG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xuICAgICAgY29uc3QgZHVwS2V5ID0gcHJvdi50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbm9tYnJlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMoZHVwS2V5KSkgcmV0dXJuO1xuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcbiAgICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgICAvLyB2MzMxOiBtaXNtbyBmaWx0cm8gZGUgc2NvcGUgYXBsaWNhIGEgYWx0YXMgU0FQL3Byb3Zpc29yaWFzLlxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcbiAgICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xuICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IHBhcmEgYWx0YXMsIGJ1eWVyIHN0YXRzIGtleWVkIHBvciBjYXJkQ29kZVNhcCAoc2kgZXhpc3RlKS5cbiAgICAgIGNvbnN0IF9hbHRhQnV5ZXJTdGF0cyA9IGEuY2FyZENvZGVTYXAgPyBidXllclN0YXRzSWR4LmdldChhLmNhcmRDb2RlU2FwKSB8fCBudWxsIDogbnVsbDtcbiAgICAgIC8vIENsYXNpZiByb3c6IGFsdGFzIHB1ZWRlbiB0ZW5lciBjbGlUaXBvL2ZpZGVsaWRhZC9ldGMgZW4gZWwgcHJvcGlvXG4gICAgICAvLyBkb2MgY2xpZW50X2FwcGxpY2F0aW9ucyAobm8gZXhjbHVzaXZlIGRlIGNsaWVudF9tYXN0ZXIpOyBzaSBubywgXCItXCIuXG4gICAgICByb3dzLnB1c2goXG4gICAgICAgIE9iamVjdC5hc3NpZ24oXG4gICAgICAgICAge1xuICAgICAgICAgICAgJ0NhcmRDb2RlIFNBUCc6IGEuY2FyZENvZGVTYXAgfHwgJycsXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5vbWJyZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogJycsXG4gICAgICAgICAgICBUaXBvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbyAoQWx0YSByYXBpZGEpJyA6ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvJyA6ICdIYWJpbGl0YWRvJyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92KSA6IHByb3YsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvYyxcbiAgICAgICAgICAgIERlcGFydGFtZW50bzogJycsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGEuY2FsbGUgfHwgYS5hZGRyZXNzIHx8ICcnLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2MsXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGEubGF0ICE9IG51bGwgPyBhLmxhdCA6ICcnLFxuICAgICAgICAgICAgJ0xuZyAoZ2VvY29kZSknOiBhLmxuZyAhPSBudWxsID8gYS5sbmcgOiAnJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBtaXNtbyBvcmRlbiBxdWUgUE9JTlRTIFx1MjAxNCBsZWdhY3kgdmlzaXRhcyBwcmltZXJvLFxuICAgICAgICAgIC8vIEZpY2hhIHBpc2EsIEJ1eWVyIGFsIGZpbmFsLlxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3YsIGxvYywgbm9tYnJlKSxcbiAgICAgICAgICBfY2xhc2lmUm93KGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYWx0YUJ1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBPcmRlbmFyIHBvciBwcm92aW5jaWEsIGxvY2FsaWRhZCwgbm9tYnJlLlxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChhWydOb21icmUgdGllbmRhJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKTtcbiAgfSk7XG5cbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xuICAgICAgICAnRWwgbWFzdGVyZmlsZSBpbmNsdXllOlxcbicgK1xuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xuICAgICAgICAnU2kgbm8gdmVzIG5pbmd1bm8sIHJldmlzYSBlbCBtb2RhbCBTQVAgbyBBbHRhIENsaWVudGVzLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggaGVscGVyIChlc3RpbG8gdmVyZGUgKyBjZW50ZXJlZFxuICAvLyB1bmlmb3JtZSkuIEFudGVzIHVzYWJhIFhMU1gud3JpdGVGaWxlIGRpcmVjdG8gY29uIFNoZWV0SlMgZnJlZSBxdWUgaWdub3JhXG4gIC8vIGVzdGlsb3MuIEFob3JhIGhlcmVkYWRvIGRlbCBoZWxwZXIgXHUyMDE0IG1pc21hIFVJIHF1ZSBWZW50YXMvVmlzaXRhcy9ldGMuXG4gIC8vIHYxMDQzICgyMDI2LTA5LTIzKTogcG9zdC1wcm9jZXNvIFx1MjAxNCBzYWNhciBjb2x1bW5hcyAxMDAlIHZhY1x1MDBFRGFzLlxuICAvLyBSZXBvcnRlIE1hcmlhbm86IG1hc3RlcmZpbGUgZXhwb3J0YWJhIDM3IGNvbHVtbmFzIGRvbmRlIG11Y2hhcyB2ZW5cdTAwRURhblxuICAvLyB2YWNcdTAwRURhcyBwb3JxdWUgbm8gaGFiXHUwMEVEYSB2aXNpdGFzL2NvbnRhY3RvcyBjYXJnYWRvcyBwYXJhIGVzb3MgY2xpZW50ZXMuXG4gIC8vIEZpeDogaWRlbnRpZmljYXIga2V5cyBkb25kZSBUT0RBUyBsYXMgZmlsYXMgdGllbmVuIHZhbG9yIFwidmFjXHUwMEVEb1wiIChlbXB0eVxuICAvLyBzdHJpbmcsIG51bGwsIHVuZGVmaW5lZCkgeSByZW1vdmVybGFzIGFudGVzIGRlbCBzaGVldC4gTG9zIGNvbnRlb3NcbiAgLy8gKFRvdGFsIHZpc2l0YXMvY29udGFjdG9zKSBzZSBjb25zaWRlcmFuIHZhY1x1MDBFRG9zIHNpIHRvZG9zIHNvbiAwLlxuICAvLyBXaWR0aHMgcG9yIGNvbHVtbi1uYW1lIChlbiB2ZXogZGUgcG9zaWNpb25hbCkgcGFyYSBxdWUgZWwgZmlsdGVyIG5vXG4gIC8vIGRlc2FsaW5lZSBlbCBzaGVldCBjdWFuZG8gcmVtb3ZlbW9zIGNvbHVtbmFzLlxuICBjb25zdCBDT0xfV0lEVEhTID0ge1xuICAgICdDYXJkQ29kZSBTQVAnOiAxNixcbiAgICAnTm9tYnJlIHRpZW5kYSc6IDM4LFxuICAgICdBbGlhcyAobW9kYWwpJzogMjgsXG4gICAgVGlwbzogMTQsXG4gICAgRXN0YWRvOiAxNCxcbiAgICBQcm92aW5jaWE6IDIyLFxuICAgICdMb2NhbGlkYWQgKG1hcGEpJzogMjIsXG4gICAgRGVwYXJ0YW1lbnRvOiAyMixcbiAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IDI4LFxuICAgIFpvbmE6IDgsXG4gICAgJ0V0aXF1ZXRhIHpvbmEnOiA0OCxcbiAgICAnQXNlc29yIGludGVybm8gKFZESSknOiAyOCxcbiAgICBEaXJlY2Npb246IDM4LFxuICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogMjQsXG4gICAgJ0xhdCAoZ2VvY29kZSknOiAxNCxcbiAgICAnTG5nIChnZW9jb2RlKSc6IDE0LFxuICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBjb2x1bW5hcyBkZSBsYSBGaWNoYSBDbGllbnRlIChwZXN0YVx1MDBGMWEgQ2xhc2lmaWNhY2lcdTAwRjNuKSArXG4gICAgLy8gQnV5ZXIgKHBlc3RhXHUwMEYxYSBCdXllciwgdmVudGFuYSAxMm0pLiBPcmRlbiBleGFjdG8gcXVlIGxsZWdhIGRlc2RlXG4gICAgLy8gX2NsYXNpZlJvdyAoT2JqZWN0LmFzc2lnbiBwcmVzZXJ2YSBvcmRlbiBkZSBrZXlzKS5cbiAgICAnVGlwbyBkZSBjbGllbnRlJzogMzYsXG4gICAgRmlkZWxpZGFkOiAxMCxcbiAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAyMCxcbiAgICBUYW1hXHUwMEYxbzogMTAsXG4gICAgRXNwZWNpYWxpemFjaVx1MDBGM246IDIwLFxuICAgICdUaXBvIGRlIGxvY2FsJzogMTQsXG4gICAgJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknOiAxOCxcbiAgICAnTW9udG8gdG90YWwgKDEybSknOiAxNixcbiAgICAnRmFjdHVyYXMgKDEybSknOiAxMixcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknOiAyMCxcbiAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogMjAsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAxNixcbiAgICAnUHJpbWVyYSBjb21wcmEnOiAxNCxcbiAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogMTQsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAxOCxcbiAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RvdGFsIHZpc2l0YXMnOiAxMCxcbiAgICAnVG90YWwgY29udGFjdG9zJzogMTAsXG4gICAgJ1RpcG8gY29tZXJjaW8nOiAxOCxcbiAgICBMb2NhbDogMTYsXG4gICAgJ0NhbmFsIGRlIGNvbXByYSc6IDIwLFxuICAgIFJlbGV2YW5jaWE6IDEwLFxuICAgIFBPUDogOCxcbiAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAyNixcbiAgICAnVGlwbyBkZSB2ZW50YSc6IDE2LFxuICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogMTgsXG4gICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogMTgsXG4gICAgQ29tcGV0ZW5jaWE6IDI2LFxuICAgIE9wb3J0dW5pZGFkOiAyNixcbiAgICAnTWFzIHZlbmRpZG8nOiAyMixcbiAgICAnTWFzIHByZWd1bnRhbic6IDIyLFxuICAgICdBeXVkYSB0aWVuZGEnOiAyNixcbiAgfTtcbiAgLy8gRGV0ZWN0YXIga2V5cyAxMDAlIHZhY1x1MDBFRGFzLlxuICBjb25zdCBhbGxLZXlzID0gT2JqZWN0LmtleXMoQ09MX1dJRFRIUyk7XG4gIGNvbnN0IE5VTUVSSUNfWkVST19PSyA9IG5ldyBTZXQoWydUb3RhbCB2aXNpdGFzJywgJ1RvdGFsIGNvbnRhY3RvcyddKTtcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGNvbHVtbmFzIGRlIGxhIEZpY2hhIENsaWVudGUgTlVOQ0Egc2Ugb21pdGVuIGF1bnF1ZSBUT0RBU1xuICAvLyBsYXMgZmlsYXMgZXN0XHUwMEU5biBlbiBcIi1cIiBcdTIwMTQgTWFyaWFubyBxdWllcmUgdmVyIGVsIGhlYWRlciBjb25zaXN0ZW50ZS5cbiAgY29uc3QgRklDSEFfUFJPVEVDVEVEID0gbmV3IFNldChbXG4gICAgJ1RpcG8gZGUgY2xpZW50ZScsXG4gICAgJ0ZpZGVsaWRhZCcsXG4gICAgJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJyxcbiAgICAnVGFtYVx1MDBGMW8nLFxuICAgICdFc3BlY2lhbGl6YWNpXHUwMEYzbicsXG4gICAgJ1RpcG8gZGUgbG9jYWwnLFxuICAgICdDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJyxcbiAgICAnTW9udG8gdG90YWwgKDEybSknLFxuICAgICdGYWN0dXJhcyAoMTJtKScsXG4gICAgJ1Byb21lZGlvIHBvciBmYWN0dXJhICgxMm0pJyxcbiAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJyxcbiAgICAnRmFjdHVyYXMgcG9yIG1lcyAoMTJtKScsXG4gICAgJ1ByaW1lcmEgY29tcHJhJyxcbiAgICAnXHUwMERBbHRpbWEgY29tcHJhJyxcbiAgICAnRFx1MDBFRGFzIGRlc2RlIFx1MDBGQWx0aW1hIGNvbXByYScsXG4gIF0pO1xuICBjb25zdCBlbXB0eUtleXMgPSBuZXcgU2V0KFxuICAgIGFsbEtleXMuZmlsdGVyKChrKSA9PiB7XG4gICAgICBpZiAoRklDSEFfUFJPVEVDVEVELmhhcyhrKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgcmV0dXJuIHJvd3MuZXZlcnkoKHIpID0+IHtcbiAgICAgICAgY29uc3QgdiA9IHJba107XG4gICAgICAgIGlmICh2ID09PSAnJyB8fCB2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRydWU7XG4gICAgICAgIGlmIChOVU1FUklDX1pFUk9fT0suaGFzKGspICYmIHYgPT09IDApIHJldHVybiB0cnVlO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9KTtcbiAgICB9KVxuICApO1xuICBjb25zdCBrZXB0S2V5cyA9IGFsbEtleXMuZmlsdGVyKChrKSA9PiAhZW1wdHlLZXlzLmhhcyhrKSk7XG4gIC8vIHYxNDgyIFx1MDBBNzgyOiByZWdsYSBcIm5pbmd1bmEgY2VsZGEgdmFjXHUwMEVEYVwiIFx1MjAxNCBmaWxsRGFzaEluRW1wdHkgc29icmUgVE9EQVNcbiAgLy8gbGFzIGNvbHVtbmFzIGZpbmFsZXMgKGNsYXNpZiArIGJ1eWVyICsgbGVnYWN5IHZpc2l0YXMpLlxuICBjb25zdCByb3dzRmlsdGVyZWQgPSByb3dzLm1hcCgocikgPT4ge1xuICAgIGNvbnN0IG91dCA9IHt9O1xuICAgIGtlcHRLZXlzLmZvckVhY2goKGspID0+IHtcbiAgICAgIG91dFtrXSA9IHJba107XG4gICAgfSk7XG4gICAgcmV0dXJuIF9maWxsRGFzaChvdXQpO1xuICB9KTtcbiAgY29uc3QgcmVtb3ZlZENvdW50ID0gZW1wdHlLZXlzLnNpemU7XG4gIGlmIChyZW1vdmVkQ291bnQgPiAwKSB7XG4gICAgY29uc29sZS5sb2coYFttYXN0ZXJmaWxlXSByZW1vdmlkYXMgJHtyZW1vdmVkQ291bnR9IGNvbHMgdmFjXHUwMEVEYXM6YCwgWy4uLmVtcHR5S2V5c10uam9pbignLCAnKSk7XG4gIH1cbiAgLy8gSG9qYSByZXN1bWVuIHBvciB6b25hXG4gIC8vIHYxNDgyIFx1MDBBNzgyOiBhZ3JlZ2FyIGNvbnRlbyBwb3IgVGlwbyBkZSBjbGllbnRlICsgRmlkZWxpZGFkIChkb3MgbnVldmFzXG4gIC8vIGNvbHVtbmFzIGNvbiBkZXRhbGxlIHBvciB6b25hKS4gRm9ybWF0byBicmV2ZSBcIkE6IE4sIEI6IE0sIC06IEtcIiBwYXJhXG4gIC8vIGNhYmVyIGVuIHVuYSBzb2xhIGNlbGRhIGxlZ2libGUuXG4gIGNvbnN0IGJ5Wm9uZSA9IHt9O1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBjb25zdCB6ID0gclsnRXRpcXVldGEgem9uYSddIHx8ICdTaW4gem9uYSc7XG4gICAgaWYgKCFieVpvbmVbel0pIHtcbiAgICAgIGJ5Wm9uZVt6XSA9IHtcbiAgICAgICAgdG90YWw6IDAsXG4gICAgICAgIGhhYmlsaXRhZG9zOiAwLFxuICAgICAgICBjYW5jZWxhZG9zOiAwLFxuICAgICAgICB0aXBvczoge30sXG4gICAgICAgIGZpZGVsaWRhZGVzOiB7fSxcbiAgICAgIH07XG4gICAgfVxuICAgIGJ5Wm9uZVt6XS50b3RhbCsrO1xuICAgIGlmIChyLkVzdGFkbyA9PT0gJ0hhYmlsaXRhZG8nKSBieVpvbmVbel0uaGFiaWxpdGFkb3MrKztcbiAgICBlbHNlIGlmIChyLkVzdGFkbyA9PT0gJ0NhbmNlbGFkbycpIGJ5Wm9uZVt6XS5jYW5jZWxhZG9zKys7XG4gICAgLy8gVGlwbyBkZSBjbGllbnRlOiB0b21hciBwcmltZXIgY2hhciBkZWwgbGFiZWwgKFwiQSAtIC4uLlwiLCBcIkIgLSAuLi5cIixcbiAgICAvLyBcIlAgKFByZW1pdW0pLi4uXCIsIFwiQyAtIC4uLlwiKS4gU2kgbGFiZWwgZXMgXCItXCIgXHUyMTkyIFwiLVwiLlxuICAgIGNvbnN0IHRpcG9MYmwgPSByWydUaXBvIGRlIGNsaWVudGUnXSB8fCAnLSc7XG4gICAgY29uc3QgdGlwb0tleSA9IHRpcG9MYmwgPT09ICctJyA/ICctJyA6IFN0cmluZyh0aXBvTGJsKS50cmltKCkuY2hhckF0KDApLnRvVXBwZXJDYXNlKCk7XG4gICAgYnlab25lW3pdLnRpcG9zW3RpcG9LZXldID0gKGJ5Wm9uZVt6XS50aXBvc1t0aXBvS2V5XSB8fCAwKSArIDE7XG4gICAgY29uc3QgZmlkID0gci5GaWRlbGlkYWQgfHwgJy0nO1xuICAgIGJ5Wm9uZVt6XS5maWRlbGlkYWRlc1tmaWRdID0gKGJ5Wm9uZVt6XS5maWRlbGlkYWRlc1tmaWRdIHx8IDApICsgMTtcbiAgfSk7XG4gIGZ1bmN0aW9uIF9mbXREaXN0KGRpc3QpIHtcbiAgICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXMoZGlzdCkuc29ydCgoYSwgYikgPT4gYlsxXSAtIGFbMV0pO1xuICAgIGlmIChlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICctJztcbiAgICByZXR1cm4gZW50cmllcy5tYXAoKFtrLCB2XSkgPT4gYCR7a306ICR7dn1gKS5qb2luKCcsICcpO1xuICB9XG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gT2JqZWN0LmVudHJpZXMoYnlab25lKVxuICAgIC5tYXAoKFt6LCBkXSkgPT4gKHtcbiAgICAgICdab25hIC8gVmVuZGVkb3InOiB6LFxuICAgICAgJ1RvdGFsIHRpZW5kYXMnOiBkLnRvdGFsLFxuICAgICAgSGFiaWxpdGFkYXM6IGQuaGFiaWxpdGFkb3MsXG4gICAgICBDYW5jZWxhZGFzOiBkLmNhbmNlbGFkb3MsXG4gICAgICAnUG9yIFRpcG8gZGUgY2xpZW50ZSc6IF9mbXREaXN0KGQudGlwb3MpLFxuICAgICAgJ1BvciBGaWRlbGlkYWQnOiBfZm10RGlzdChkLmZpZGVsaWRhZGVzKSxcbiAgICB9KSlcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVG90YWwgdGllbmRhcyddIC0gYVsnVG90YWwgdGllbmRhcyddKTtcblxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIC8vIHYzMzE6IHN1ZmlqbyBjb24gZWwgc2NvcGUgYXBsaWNhZG8gcGFyYSBkaWZlcmVuY2lhciBlbCBhcmNoaXZvIGRlbCBWREUvVkRJXG4gIC8vIGRlbCBleHBvcnQgZ2xvYmFsIGRlbCBhZG1pbi5cbiAgY29uc3Qgc2NvcGVMYmwgPVxuICAgIHNjb3BlU2V0ID09PSBudWxsXG4gICAgICA/ICdUT0RPUydcbiAgICAgIDogc2NvcGVTZXQuc2l6ZSA9PT0gMVxuICAgICAgICA/IFsuLi5zY29wZVNldF1bMF0uc3BsaXQoJyAnKVswXVxuICAgICAgICA6ICdtaXMtem9uYXMtJyArIHNjb3BlU2V0LnNpemU7XG4gIGNvbnN0IGZuYW1lID0gJ01hc3RlcmZpbGVfQ2xpZW50ZXNfU0FQXycgKyBzY29wZUxibCArICdfJyArIHRzICsgJy54bHN4JztcbiAgYXdhaXQgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnQ2xpZW50ZXMgaGFiaWxpdGFkb3MgU0FQJywgcm93czogcm93c0ZpbHRlcmVkIH0sXG4gICAgeyBuYW1lOiAnUmVzdW1lbiBwb3Igem9uYScsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICByb3dzLmxlbmd0aCArXG4gICAgICAnIGNsaWVudGVzIGV4cG9ydGFkb3MnICtcbiAgICAgIChzY29wZVNldCA9PT0gbnVsbCA/ICcnIDogJyAoc2NvcGU6ICcgKyBbLi4uc2NvcGVTZXRdLmpvaW4oJywgJykgKyAnKScpXG4gICk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4cG9ydDogUHJlY2lvcyArIFN0b2NrIHBvciBTS1Vcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RPIGVsIGNhdGFsb2dvIGNydXphbmRvIGxvcyAzIG1hcGFzIHZpZ2VudGVzXG4vLyBlbiBtZW1vcmlhOiBQUk9EVUNUUyAobWFzdGVyIGRlIFNLVXMpLCBQUklDRV9MSVNUX01BUCAocHJlY2lvIEFSUyBkZVxuLy8gRmlyZXN0b3JlKSB5IFNUT0NLX01BUCAoYm9vbGVhbm8gcG9yIFNLVSBkZWwgc3RvY2suanNvbiBkZWwgcmVwbykuXG4vLyBIb2phczpcbi8vICAtIFwiUHJlY2lvcyB5IFN0b2NrXCI6IHVuYSBmaWxhIHBvciBTS1UgY29uIHRvZGFzIGxhcyBjb2x1bW5hcyBqdW50YXNcbi8vICAgIChsbyBtYXMgY29tdW4gcGFyYSByZXZpc2FyIGRpc3BvbmliaWxpZGFkICsgcHJlY2lvKS5cbi8vICAtIFwiUHJlY2lvc1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgcHJlY2lvIChzaW4gc3RvY2spLlxuLy8gIC0gXCJTdG9ja1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgZXN0YWRvIGRlIHN0b2NrLlxuLy8gIC0gXCJJbmZvXCI6IGZlY2hhIGRlIGxvcyBzbmFwc2hvdHMgeSBmdWVudGVzLlxud2luZG93LmV4cG9ydFByZWNpb3NTdG9jayA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghQXJyYXkuaXNBcnJheShQUk9EVUNUUykgfHwgIVBST0RVQ1RTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgY2F0YWxvZ28gZGUgcHJvZHVjdG9zIGNhcmdhZG8gdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBwcmVjaW9zICsgc3RvY2suLi4nKTtcbiAgLy8gdjU3NCAoMjAyNi0wOC0yMSk6IG1vc3RyYXIgVU5JREFERVMgbnVtZXJpY2FzIGV4YWN0YXMgZGVsIGRlcG9zaXRvIDExLlxuICAvLyB2MTM2MyAoMjAyNi0xMC0xOSk6IHBlZGlkbyBNYXJpYW5vIFx1MjAxNCBjYW1iaWFyIGRlIFwic3RvY2sgZlx1MDBFRHNpY28gZGVwIDExXCIgYVxuICAvLyBcImxpYnJlIHBhcmEgbGEgdmVudGFcIiAoPSBkZXAgMTEgXHUyMjEyIHJlc2VydmFzIGNvbmZpcm1lZC9CTy9BU0lHL3dhaXRsaXN0KS5cbiAgLy8gUmF6XHUwMEYzbjogZW52aWFyIGFsIGNsaWVudGUgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgbGUgcHVlZGUgcHJvbWV0ZXIgSE9ZLlxuICAvLyBTaSBzb2xvIG1vc3RyYW1vcyBzdG9jayBmXHUwMEVEc2ljbywgcHVlZGUgcGFzYXIgcXVlIGhheWEgNXUgcGVybyBsYXMgNSBlc3RcdTAwRTluXG4gIC8vIHJlc2VydmFkYXMgXHUyMTkyIGVsIGNsaWVudGUgc2UgZW50ZXJhIHJlY2lcdTAwRTluIGFsIGhhY2VyIGVsIHBlZGlkbyBxdWUgbm8gaGF5LlxuICAvLyBVc2EgZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlIChwdXJlIGZ1bmN0aW9uLCBmaWx0cmEgVFRMcykuIFJldG9ybmEgJycgc2lcbiAgLy8gbm8gaGF5IHNuYXBzaG90IGNhcmdhZG87IDAgc2kgbm8gaGF5IGxpYnJlLlxuICBmdW5jdGlvbiBmbXRTdG9jayhza3UpIHtcbiAgICBjb25zdCBmblJlYWwgPVxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlXG4gICAgICAgIDogbnVsbDtcbiAgICBpZiAoZm5SZWFsKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB2ID0gZm5SZWFsKHNrdSk7XG4gICAgICAgIGlmICh2ID09IG51bGwpIHJldHVybiAnJztcbiAgICAgICAgcmV0dXJuIE51bWJlcih2KSB8fCAwO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgLy8gZmFsbGJhY2sgYSBzdG9jayBmXHUwMEVEc2ljbyBhYmFqb1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBGYWxsYmFjazogc3RvY2sgZlx1MDBFRHNpY28gZGVwIDExIChzaSBnZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgbm8gZXN0XHUwMEUxIGRpc3BvbmlibGUsXG4gICAgLy8gZWouIGJvb3RzdHJhcCBtdXkgdGVtcHJhbm8pLlxuICAgIGNvbnN0IGZuRmlzaWNvID1cbiAgICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGFcbiAgICAgICAgOiBudWxsO1xuICAgIGNvbnN0IHZGID0gZm5GaXNpY28gPyBmbkZpc2ljbyhza3UpIDogbnVsbDtcbiAgICBpZiAodkYgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgIHJldHVybiBOdW1iZXIodkYpIHx8IDA7XG4gIH1cbiAgZnVuY3Rpb24gZm10UHJlY2lvKHNrdSkge1xuICAgIGNvbnN0IHAgPSB0eXBlb2YgUFJJQ0VfTElTVF9NQVAgPT09ICdvYmplY3QnICYmIFBSSUNFX0xJU1RfTUFQID8gUFJJQ0VfTElTVF9NQVBbc2t1XSA6IG51bGw7XG4gICAgaWYgKHAgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgIHJldHVybiBOdW1iZXIocCkgfHwgMDtcbiAgfVxuICAvLyB2MTM2NCAoMjAyNi0xMC0xOSk6IHJld29yayBkZWwgZXhwb3J0IHBvciBwZWRpZG8gTWFyaWFubzpcbiAgLy8gLSBIb2phIHByaW5jaXBhbCByZW5vbWJyYWRhIFwiUHJlY2lvcyB5IFN0b2NrXCIgLT4gXCJMaXN0YSBkZSBwcmVjaW9zXCIuXG4gIC8vIC0gTnVldmEgY29sdW1uYSBcIkRpc3BvbmliaWxpZGFkXCIgKERJU1BPTklCTEUgdmVyZGUgc2kgU3RvY2s+MCwgTk8gRElTUE9OSUJMRVxuICAvLyAgIHJvam8gc2kgU3RvY2s8PTAgbyB2YWNpbykuXG4gIC8vIC0gSG9qYSBcIkluZm9cIiBlbGltaW5hZGEuXG4gIC8vIC0gTm9tYnJlIGFyY2hpdm86IFByZWNpb3NfeV9TdG9ja19ZWVlZLU1NLURELnhsc3ggLT4gTGlzdGFfZGVfUHJlY2lvc19ZWVlZLU1NLURELnhsc3guXG4gIC8vIEhvamFzIFwiUHJlY2lvc1wiIHkgXCJTdG9ja1wiIHNlIG1hbnRpZW5lbiBwb3Igc2kgTWFyaWFubyBsYXMgdXNhLlxuICBmdW5jdGlvbiBkaXNwTGFiZWwoc3RvY2tWYWwpIHtcbiAgICBpZiAoc3RvY2tWYWwgPT09ICcnIHx8IHN0b2NrVmFsID09IG51bGwpIHJldHVybiAnTk8gRElTUE9OSUJMRSc7XG4gICAgcmV0dXJuIE51bWJlcihzdG9ja1ZhbCkgPiAwID8gJ0RJU1BPTklCTEUnIDogJ05PIERJU1BPTklCTEUnO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+IHtcbiAgICBjb25zdCBzdCA9IGZtdFN0b2NrKHAuY29kZSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAgIEZhbWlsaWE6IHAuZmFtIHx8ICcnLFxuICAgICAgU3ViZmFtaWxpYTogcC5zdWIgfHwgJycsXG4gICAgICBDYXRlZ29yaWE6IHAuY2F0IHx8ICcnLFxuICAgICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcbiAgICAgIFN0b2NrOiBzdCxcbiAgICAgIERpc3BvbmliaWxpZGFkOiBkaXNwTGFiZWwoc3QpLFxuICAgIH07XG4gIH0pLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHByZWNpb3NSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcbiAgfSkpXG4gICAgLmZpbHRlcigocikgPT4gclsnUHJlY2lvIEFSUyddICE9PSAnJylcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3Qgc3RvY2tSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiB7XG4gICAgY29uc3Qgc3QgPSBmbXRTdG9jayhwLmNvZGUpO1xuICAgIHJldHVybiB7XG4gICAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgICBTdG9jazogc3QsXG4gICAgICBEaXNwb25pYmlsaWRhZDogZGlzcExhYmVsKHN0KSxcbiAgICB9O1xuICB9KS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRvd25sb2FkWGxzeChcbiAgICAnTGlzdGFfZGVfUHJlY2lvc18nICsgdHMgKyAnLnhsc3gnLFxuICAgIFtcbiAgICAgIHsgbmFtZTogJ0xpc3RhIGRlIHByZWNpb3MnLCByb3dzIH0sXG4gICAgICB7IG5hbWU6ICdQcmVjaW9zJywgcm93czogcHJlY2lvc1Jvd3MgfSxcbiAgICAgIHsgbmFtZTogJ1N0b2NrJywgcm93czogc3RvY2tSb3dzIH0sXG4gICAgXSxcbiAgICB7XG4gICAgICAvLyBQYWludGVyIGFwbGljYWRvIHBvc3QtcmVuZGVyIHBvciBkb3dubG9hZFhsc3guIFBpbnRhIGxhIGNvbHVtbmFcbiAgICAgIC8vIFwiRGlzcG9uaWJpbGlkYWRcIiBzZWd1biBzdSB2YWxvcjogdmVyZGUrYmxhbmNvIHNpIERJU1BPTklCTEUsXG4gICAgICAvLyByb2pvK2JsYW5jbyBzaSBOTyBESVNQT05JQkxFLiBDZW50cmFkbyArIGJvbGQgcGFyYSBsZWdpYmlsaWRhZC5cbiAgICAgIGNlbGxTdHlsZXI6IChjZWxsLCBjb2x1bW5OYW1lLCBfdmFsdWUsIF9yb3dJbmRleCkgPT4ge1xuICAgICAgICBpZiAoY29sdW1uTmFtZSAhPT0gJ0Rpc3BvbmliaWxpZGFkJykgcmV0dXJuO1xuICAgICAgICBjb25zdCB0eHQgPSBTdHJpbmcoY2VsbC52YWx1ZSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgaWYgKHR4dCA9PT0gJ0RJU1BPTklCTEUnKSB7XG4gICAgICAgICAgY2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMTZBMzRBJyB9IH07IC8vIGdyZWVuLTYwMFxuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBib2xkOiB0cnVlIH07XG4gICAgICAgIH0gZWxzZSBpZiAodHh0ID09PSAnTk8gRElTUE9OSUJMRScpIHtcbiAgICAgICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkZEQzI2MjYnIH0gfTsgLy8gcmVkLTYwMFxuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBib2xkOiB0cnVlIH07XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfVxuICApO1xuICBzaG93U3luY1RhZyhyb3dzLmxlbmd0aCArICcgU0tVcyBleHBvcnRhZG9zIChsaXN0YSBkZSBwcmVjaW9zICsgZGlzcG9uaWJpbGlkYWQpJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCAtIGRpYWxvZ28gZGUgc2VsZWNjaW9uICsgMyBmb3JtYXRvc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG53aW5kb3cuZXhwb3J0VG9FeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZpbHRyYXIgb3BjaW9uZXMgc2VndW4gcm9sLlxuICAvLyAgIHZlbmRlZG9yOiBvcGVyYXRpdm8gZGlhcmlvIChWZW50YXMgLyBWaXNpdGFzIC8gUnV0YXMpICsgQ2xpZW50ZXMgZGUgc3Ugem9uYVxuICAvLyAgICAgKGV4cG9ydE1hc3RlckNsaWVudGVzIHlhIGZpbHRyYSBwb3IgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0IC0+IHNvbG8gc3UgdmVuZG9yKS5cbiAgLy8gICBpbnRlcm5vIChWREkpOiBtaXNtbyBzY29wZSBvcGVyYXRpdm8gKyBDbGllbnRlcyBkZSBzdXMgcGFyZWphcyAobyBzb2xvIGVsXG4gIC8vICAgICBwcm9waW8gc2kgZWxpZ2lvIHN1IG5vbWJyZSBlbiBlbCBkcm9wZG93biBkZSB6b25hcykuXG4gIC8vICAgYWRtaW4gLyBnZXJlbnRlIC8gdmlld2VyOiB2ZW4gdG9kbyBlbCBsaXN0YWRvIChudWxsID0gc2luIGZpbHRybykuXG4gIGNvbnN0IGFsbG93ZWRCeVJvbGUgPSB7XG4gICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IFZFTlRBUyB5IFJVVEFTIGVsaW1pbmFkb3MgZGVsIFVJIHBvciBwZWRpZG8gZGUgTWFyaWFuby5cbiAgICB2ZW5kZWRvcjogbmV3IFNldChbJ1ZJU0lUQVMnLCAnTUFTVEVSJywgJ0JBQ0tPUkRFUicsICdTVE9DS19BU0lHJywgJ1BFRElET1NfTUVTJ10pLFxuICAgIGludGVybm86IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcbiAgfTtcbiAgY29uc3QgYWxsb3dlZCA9IGFsbG93ZWRCeVJvbGVbdXNlclJvbGVdIHx8IG51bGw7IC8vIG51bGwgPSB2ZXIgdG9kb1xuICAvLyB2MTQxMyBcdTAwQTc1MSArIHYxNDE0IFx1MDBBNzUxLjEgKDIwMjYtMTAtMjIpOiBJTkZSQUNDSU9ORVNfTUVMSSB3aGl0ZWxpc3QgcG9yXG4gIC8vIGVtYWlsLiBNYW50ZW5lciBzaW5jcm9uaXphZG8gY29uIGNhblJlYWRJbmZyYWNjaW9uZXNNZWxpKCkgZGVcbiAgLy8gZmlyZXN0b3JlLnJ1bGVzLiBSZWFkZXJzOiBNYXJpYW5vICgyIGVtYWlscykgKyBEaWVnbyBWYWxzaS5cbiAgY29uc3QgSU5GUkFDQ0lPTkVTX01FTElfUkVBREVSUyA9IFtcbiAgICAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nLFxuICAgICdtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsXG4gICAgJ2RpZWdvLnZhbHNpQHNoaW1hbm8udXknLFxuICBdO1xuICBjb25zdCBfY2FuUmVhZEluZnJhY2Npb25lc01lbGkgPVxuICAgIHR5cGVvZiBjdXJyZW50VXNlciAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICBjdXJyZW50VXNlciAmJlxuICAgIElORlJBQ0NJT05FU19NRUxJX1JFQURFUlMuaW5jbHVkZXMoKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpKTtcbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2V4cG9ydC1tb2RhbCAuZXhwLW9wdCcpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2luZCA9IGVsLmRhdGFzZXQuZXhwS2luZCB8fCAnJztcbiAgICBsZXQgc2hvdyA9ICFhbGxvd2VkIHx8IGFsbG93ZWQuaGFzKGtpbmQpO1xuICAgIGlmIChraW5kID09PSAnSU5GUkFDQ0lPTkVTX01FTEknICYmICFfY2FuUmVhZEluZnJhY2Npb25lc01lbGkpIHNob3cgPSBmYWxzZTtcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gc2hvdyA/ICcnIDogJ25vbmUnO1xuICB9KTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VFeHBvcnREaWFsb2cgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1vbnRoIHBpY2tlciByZXV0aWxpemFibGUgcGFyYSBsb3MgNSB0aXBvcyBkZSBleHBvcnRcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxubGV0IHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbmNvbnN0IEVYUE9SVF9UWVBFX0xBQkVMUyA9IHtcbiAgVkVOVEFTOiAnVmVudGFzJyxcbiAgVklTSVRBUzogJ1Zpc2l0YXMnLFxuICBSRU5ESUNJT05FUzogJ1JlbmRpY2lvbmVzJyxcbiAgUlVUQVM6ICdSdXRhcycsXG4gIEFMVEFTOiAnQWx0YXMgZGUgY2xpZW50ZXMnLFxuICBCQUNLT1JERVI6ICdCYWNrb3JkZXInLFxuICBTVE9DS19BU0lHOiAnU3RvY2sgQXNpZ25hZG8nLFxuICBQRURJRE9TX01FUzogJ1BlZGlkb3MgZGVsIG1lcycsXG59O1xuXG53aW5kb3cuc2hvd01vbnRoUGlja2VyID0gZnVuY3Rpb24gKHRpcG8pIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gdGlwbztcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tdGl0bGUnKTtcbiAgY29uc3Qgc3VidCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1zdWJ0Jyk7XG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0V4cG9ydGFyICcgKyAoRVhQT1JUX1RZUEVfTEFCRUxTW3RpcG9dIHx8IHRpcG8pO1xuICBzdWJ0LnRleHRDb250ZW50ID0gJ0VsZWdpIGVsIG1lcyB5IGFcdTAwRjFvIHF1ZSBxdWVyZXMgZGVzY2FyZ2FyLic7XG4gIC8vIFBvcHVsYXRlIHNlbGVjdHNcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgbWVzU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpO1xuICBtZXNTZWwuaW5uZXJIVE1MID1cbiAgICAnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zIGxvcyBtZXNlcyAoYVx1MDBGMW8gZW50ZXJvKTwvb3B0aW9uPicgK1xuICAgIE1FU0VTLm1hcCgobSwgaSkgPT4gJzxvcHRpb24gdmFsdWU9XCInICsgaSArICdcIj4nICsgbSArICc8L29wdGlvbj4nKS5qb2luKCcnKTtcbiAgbWVzU2VsLnZhbHVlID0gbm93LmdldE1vbnRoKCk7XG4gIGNvbnN0IGFuaW9TZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpO1xuICBjb25zdCB5ZWFyID0gbm93LmdldEZ1bGxZZWFyKCk7XG4gIGxldCB5b3B0cyA9ICcnO1xuICBmb3IgKGxldCB5ID0geWVhciAtIDM7IHkgPD0geWVhciArIDE7IHkrKylcbiAgICB5b3B0cyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyB5ICsgJ1wiPicgKyB5ICsgJzwvb3B0aW9uPic7XG4gIGFuaW9TZWwuaW5uZXJIVE1MID0geW9wdHM7XG4gIGFuaW9TZWwudmFsdWUgPSB5ZWFyO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcblxud2luZG93LmNsb3NlTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbn07XG5cbndpbmRvdy5jb25maXJtTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHRpcG8gPSBwZW5kaW5nRXhwb3J0VHlwZTtcbiAgY29uc3QgbWVzUmF3ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpLnZhbHVlO1xuICBjb25zdCBhbmlvID0gcGFyc2VJbnQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKS52YWx1ZSwgMTApO1xuICBjb25zdCBtb250aElkeCA9IG1lc1JhdyA9PT0gJ0FMTCcgPyBudWxsIDogcGFyc2VJbnQobWVzUmF3LCAxMCk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbiAgaWYgKCF0aXBvKSByZXR1cm47XG4gIHRyeSB7XG4gICAgaWYgKHRpcG8gPT09ICdWRU5UQVMnKSBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZJU0lUQVMnKSBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSRU5ESUNJT05FUycpIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSVVRBUycpIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdBTFRBUycpIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdCQUNLT1JERVInKSBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1NUT0NLX0FTSUcnKSBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1BFRElET1NfTUVTJykgZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVkVOVEFTX0FSVF9DTEknKSBleHBvcnRWZW50YXNBcnRDbGlGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0ICcgKyB0aXBvLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGV4cG9ydDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkge1xuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkgcmV0dXJuIFN0cmluZyhhbmlvKTtcbiAgcmV0dXJuIE1FU0VTW21vbnRoSWR4XSArICdfJyArIGFuaW87XG59XG5cbi8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVlc2NyaXRvIGNvbiBFeGNlbEpTIHBhcmEgZGFyIFVJIHVuaWZvcm1lIGEgVE9ET1MgbG9zXG4vLyBleHBvcnRzIChoZWFkZXIgdmVyZGUgKyBjZWxkYXMgY2VudGVyZWQgKyBib3JkZXIgc3V0aWwgKyBhdXRvLWZpdCB3aWR0aCkuXG4vLyBBbnRlcyB1c2FiYSBYTFNYIFNoZWV0SlMgZnJlZSBxdWUgaWdub3JhIHNpbGVudGx5IGxvcyBlc3RpbG9zIGRlIGNlbGRhLiBFbFxuLy8gcGF0dGVybiB2ZXJkZSByZXBsaWNhIGVsIFRPVEFMIGJhciBkZSBleHBvcnRCYWNrb3JkZXJzVG9FeGNlbCAobW9kYWxcbi8vIEJhY2tvcmRlciB2NzIwKykuIEV4Y2VsSlMgeWEgc2UgY2FyZ2Egb24tZGVtYW5kIHZpYSB3aW5kb3cubG9hZEV4Y2VsSlMuXG5hc3luYyBmdW5jdGlvbiBkb3dubG9hZFhsc3goZmlsZW5hbWUsIHNoZWV0cywgb3B0cykge1xuICB0cnkge1xuICAgIGF3YWl0IHdpbmRvdy5sb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIEV4Y2VsSlM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICBjb25zdCBIRUFERVJfRklMTCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2NjUzNCcgfSB9O1xuICBjb25zdCBIRUFERVJfRk9OVCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBib2xkOiB0cnVlLCBzaXplOiAxMiB9O1xuICBjb25zdCBDRU5URVIgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicsIHdyYXBUZXh0OiB0cnVlIH07XG4gIGNvbnN0IEJPUkRFUl9USElOID0geyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZDQ0NDQ0MnIH0gfTtcbiAgY29uc3QgQk9SREVSID0geyB0b3A6IEJPUkRFUl9USElOLCBsZWZ0OiBCT1JERVJfVEhJTiwgYm90dG9tOiBCT1JERVJfVEhJTiwgcmlnaHQ6IEJPUkRFUl9USElOIH07XG4gIC8vIHYxMzY0OiBjZWxsU3R5bGVyIG9wY2lvbmFsIHBhcmEgY29sb3JlYXIgY2VsZGFzIHBvciB2YWxvciAoZWouIGNvbHVtbmFcbiAgLy8gRGlzcG9uaWJpbGlkYWQgRElTUE9OSUJMRSB2ZXJkZSAvIE5PIERJU1BPTklCTEUgcm9qbyBlbiBlbCBleHBvcnRcbiAgLy8gTGlzdGEgZGUgcHJlY2lvcykuIFNpZ25hdHVyZTogKGNlbGwsIGNvbHVtbk5hbWUsIHZhbHVlLCByb3dJbmRleCkgPT4gdm9pZC5cbiAgY29uc3QgY2VsbFN0eWxlciA9IG9wdHMgJiYgdHlwZW9mIG9wdHMuY2VsbFN0eWxlciA9PT0gJ2Z1bmN0aW9uJyA/IG9wdHMuY2VsbFN0eWxlciA6IG51bGw7XG5cbiAgZm9yIChjb25zdCBzIG9mIHNoZWV0cykge1xuICAgIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KHMubmFtZS5zbGljZSgwLCAzMSkpO1xuICAgIGNvbnN0IHJvd3MgPSBzLnJvd3MubGVuZ3RoID8gcy5yb3dzIDogW3sgQXZpc286ICdTaW4gZGF0b3MgcGFyYSBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkbycgfV07XG4gICAgY29uc3QgaGVhZGVycyA9IE9iamVjdC5rZXlzKHJvd3NbMF0pO1xuXG4gICAgY29uc3QgaGVhZGVyUm93ID0gd3MuYWRkUm93KGhlYWRlcnMpO1xuICAgIGhlYWRlclJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xuICAgICAgY2VsbC5maWxsID0gSEVBREVSX0ZJTEw7XG4gICAgICBjZWxsLmZvbnQgPSBIRUFERVJfRk9OVDtcbiAgICAgIGNlbGwuYWxpZ25tZW50ID0gQ0VOVEVSO1xuICAgICAgY2VsbC5ib3JkZXIgPSBCT1JERVI7XG4gICAgfSk7XG4gICAgaGVhZGVyUm93LmhlaWdodCA9IDI2O1xuXG4gICAgZm9yIChsZXQgcklkeCA9IDA7IHJJZHggPCByb3dzLmxlbmd0aDsgcklkeCsrKSB7XG4gICAgICBjb25zdCByb3cgPSByb3dzW3JJZHhdO1xuICAgICAgY29uc3QgdmFsdWVzID0gaGVhZGVycy5tYXAoKGgpID0+IChyb3dbaF0gIT09IHVuZGVmaW5lZCAmJiByb3dbaF0gIT09IG51bGwgPyByb3dbaF0gOiAnJykpO1xuICAgICAgY29uc3QgZGF0YVJvdyA9IHdzLmFkZFJvdyh2YWx1ZXMpO1xuICAgICAgZGF0YVJvdy5lYWNoQ2VsbCgoY2VsbCwgY29sTnVtYmVyKSA9PiB7XG4gICAgICAgIGNlbGwuYWxpZ25tZW50ID0gQ0VOVEVSO1xuICAgICAgICBjZWxsLmJvcmRlciA9IEJPUkRFUjtcbiAgICAgICAgaWYgKGNlbGxTdHlsZXIpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY2VsbFN0eWxlcihjZWxsLCBoZWFkZXJzW2NvbE51bWJlciAtIDFdLCB2YWx1ZXNbY29sTnVtYmVyIC0gMV0sIHJJZHgpO1xuICAgICAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgICAgICAvLyBuby1vcDogbm8gcm9tcGVyIGVsIGV4cG9ydCBwb3IgdW4gZXJyb3IgZGUgc3R5bGVyXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBoZWFkZXJzLmZvckVhY2goKGgsIGkpID0+IHtcbiAgICAgIGxldCBtYXhMZW4gPSBTdHJpbmcoaCkubGVuZ3RoO1xuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCB2ID0gU3RyaW5nKHJvd1toXSA9PT0gdW5kZWZpbmVkIHx8IHJvd1toXSA9PT0gbnVsbCA/ICcnIDogcm93W2hdKS5zcGxpdCgnXFxuJylbMF07XG4gICAgICAgIGlmICh2Lmxlbmd0aCA+IG1heExlbikgbWF4TGVuID0gdi5sZW5ndGg7XG4gICAgICB9XG4gICAgICB3cy5nZXRDb2x1bW4oaSArIDEpLndpZHRoID0gTWF0aC5taW4oNjAsIE1hdGgubWF4KDEwLCBtYXhMZW4gKyA0KSk7XG4gICAgfSk7XG5cbiAgICB3cy52aWV3cyA9IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dO1xuICB9XG5cbiAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1Zl0sIHtcbiAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICB9KTtcbiAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgYS5ocmVmID0gdXJsO1xuICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gIGEuY2xpY2soKTtcbiAgYS5yZW1vdmUoKTtcbiAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZFTlRBUzogcGVkaWRvcyBjb25maXJtYWRvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWZW50YXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcGVkaWRvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHAgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAocGFyc2VJbnQocC55ZWFyLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQocC5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIGNvbnN0IGxpbmVzID0gcC5saW5lcyB8fCBbXTtcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgcmV0dXJuO1xuICAgIGNvbnN0IHZlbmRvcktleSA9IHAudmVuZG9yIHx8IGxvb2t1cFZlbmRvckZvckNsaWVudChwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSkgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9ySW5mbyA9IHZlbmRvckxvb2t1cFt2ZW5kb3JLZXldIHx8IHt9O1xuICAgIGNvbnN0IGZhY3RvciA9IHR5cGVvZiBwZWRpZG9EaXNjb3VudEZhY3RvciA9PT0gJ2Z1bmN0aW9uJyA/IHBlZGlkb0Rpc2NvdW50RmFjdG9yKHApIDogMTtcbiAgICBjb25zdCBkaXNjUGN0ID0gKHAuZGlzY291bnRTbmFwc2hvdCAmJiBwLmRpc2NvdW50U25hcHNob3QucGN0VG90YWwpIHx8IDA7XG4gICAgbGluZXMuZm9yRWFjaCgobCkgPT4ge1xuICAgICAgY29uc3QgcXR5ID0gcGFyc2VGbG9hdChsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IHBhcnNlRmxvYXQobC5wcmVjaW8pIHx8IDA7XG4gICAgICBjb25zdCBncm9zcyA9IHF0eSAqIHByZWNpbztcbiAgICAgIGNvbnN0IG5ldCA9IGdyb3NzICogZmFjdG9yO1xuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxuICAgICAgICBGZWNoYV9Db25maXJtYWRvOiBwLmNvbmZpcm1lZEF0ID8gU3RyaW5nKHAuY29uZmlybWVkQXQpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgICBFc3RhZG86IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yS2V5IHx8ICcnKSxcbiAgICAgICAgWm9uYTogdmVuZG9ySW5mby56b25lIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQ29kaWdvX1NLVTogbC5jb2RlIHx8ICcnLFxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8ICcnLFxuICAgICAgICBDYXRlZ29yaWE6IGwuY2F0IHx8ICcnLFxuICAgICAgICBGYW1pbGlhOiBsLmZhbSB8fCAnJyxcbiAgICAgICAgU3ViZmFtaWxpYTogbC5zdWIgfHwgJycsXG4gICAgICAgIENhbnRpZGFkOiBxdHksXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxuICAgICAgICAvLyBTdWJ0b3RhbF9BUlMgPSBORVRPIChjb24gZGVzY3VlbnRvIGFwbGljYWRvKSAtIGVzIGxvIHF1ZSBjdWVudGFcbiAgICAgICAgLy8gcGFyYSBlbCB0YXJnZXQgZGVsIHZlbmRlZG9yLiBTdWJ0b3RhbF9CcnV0b19BUlMgbXVlc3RyYSBlbCB2YWxvclxuICAgICAgICAvLyBkZSBsaXN0YSBzaW4gZGVzY3VlbnRvIHBhcmEgdHJhemFiaWxpZGFkLlxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQobmV0KSxcbiAgICAgICAgU3VidG90YWxfQnJ1dG9fQVJTOiBNYXRoLnJvdW5kKGdyb3NzKSxcbiAgICAgICAgRGVzY3VlbnRvX1BjdDogZGlzY1BjdCxcbiAgICAgICAgRW5fTm9tYnJlX0RlX1ZERTogcC5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICAgIENhcmdhZG9fUG9yOiBwLmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHAuY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fVmVudGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdWZW50YXMnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBWZW50YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5mdW5jdGlvbiBsb29rdXBWZW5kb3JGb3JDbGllbnQocHJvdiwgbG9jTmFtZSwgX2NsaWVudE5hbWUpIHtcbiAgaWYgKCFwcm92IHx8ICFsb2NOYW1lKSByZXR1cm4gJyc7XG4gIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3YgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcbiAgcmV0dXJuIHB0ID8gcHQudmVuZG9yIHx8ICcnIDogJyc7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVklTSVRBUzogZGV0YWxsZSBkZSB2aXNpdGFzIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWaXNpdGFzICsgQ29udGFjdG9zLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gdmlzaXRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YXJnZXRNZXMgPSBtb250aElkeCAhPT0gbnVsbCA/IE1FU0VTW21vbnRoSWR4XS50b1VwcGVyQ2FzZSgpIDogbnVsbDtcbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgdiA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludCh2LmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmICh0YXJnZXRNZXMgJiYgKHYubWVzIHx8ICcnKS50b1VwcGVyQ2FzZSgpICE9PSB0YXJnZXRNZXMpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHYpO1xuICB9KTtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgbmkgY29udGFjdG9zIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuVmlzaXRhcyA9IGl0ZW1zLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aDtcbiAgY29uc3QgbkNvbnRhY3RvcyA9IGl0ZW1zLmxlbmd0aCAtIG5WaXNpdGFzO1xuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGRlbCBmcmVudGUgZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBMYXp5IGxvYWQuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbDogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3Rvcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzIHkgQ29udGFjdG9zJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNZXMnLCBrZXk6ICdtZXMnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0FuaW8nLCBrZXk6ICdhbmlvJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0ludGVyYWNjaW9uJywga2V5OiAnaW50ZXJhY2Npb24nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0Zvcm1hIENvbnRhY3RvJywga2V5OiAnZm9ybWFDb250YWN0bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnUmVzdWx0YWRvIENvbnRhY3RvJywga2V5OiAncmVzdWx0YWRvQ3QnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0NvbWVudGFyaW8nLCBrZXk6ICdjb21lbnQnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdUaWVuZGEnLCBrZXk6ICd0aWVuZGEnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUYW1hbm8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnTmVjZXNpZGFkIFB1bnR1YWwnLCBrZXk6ICduZWMnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdNYXMgVmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdNYXMgUHJlZ3VudGFuJywga2V5OiAnbWFzUHInLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0F5dWRhIFRpZW5kYScsIGtleTogJ2F5dWRhJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIFZlbnRhJywga2V5OiAndGlwb1ZlbnRhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdQb25kIE1vc3RyYWRvcicsIGtleTogJ3BNb3N0Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQb25kIEVjb21tZXJjZScsIGtleTogJ3BFY29tJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdDb21wZXRlbmNpYScsIGtleTogJ2NvbXBlJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgU3RhdHVzJywga2V5OiAnZ3BzU3QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBEaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gZnJlbnRlJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnRW4gbm9tYnJlIGRlIFZERScsIGtleTogJ29uQmVoYWxmJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdDYXJnYWRvIFBvcicsIGtleTogJ2NyZWF0ZWRCeScsIHdpZHRoOiAyNCB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7XG4gIGNvbnN0IFJPV19IID0gMTAwO1xuICBjb25zdCBJTUdfVyA9IDEzMDtcbiAgY29uc3QgSU1HX0ggPSA5MDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IHYgb2YgaXRlbXMpIHtcbiAgICBjb25zdCBpc0NvbnRhY3RvID0gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0byc7XG4gICAgY29uc3QgaW50ZXJhY2Npb25MYmwgPSBpc0NvbnRhY3RvID8gJ0NvbnRhY3RvJyA6ICdWaXNpdGEnO1xuICAgIGNvbnN0IGZvcm1hQ29udGFjdG9MYmwgPSBpc0NvbnRhY3RvID8gdi5mb3JtYUNvbnRhY3RvIHx8ICdTaW4gZXNwZWNpZmljYXInIDogJ1ByZXNlbmNpYWwnO1xuICAgIGxldCByZXN1bHRhZG9DdExibCA9ICcnO1xuICAgIGlmIChpc0NvbnRhY3RvKSB7XG4gICAgICBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ1Jlc3BvbmRpbyc7XG4gICAgICBlbHNlIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAnbm9fcmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnTm8gcmVzcG9uZGlvJztcbiAgICAgIGVsc2UgcmVzdWx0YWRvQ3RMYmwgPSAnU2luIG1hcmNhcic7XG4gICAgfVxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXG4gICAgICBhbmlvOiB2LmFuaW8gfHwgJycsXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXG4gICAgICBpbnRlcmFjY2lvbjogaW50ZXJhY2Npb25MYmwsXG4gICAgICBmb3JtYUNvbnRhY3RvOiBmb3JtYUNvbnRhY3RvTGJsLFxuICAgICAgcmVzdWx0YWRvQ3Q6IHJlc3VsdGFkb0N0TGJsLFxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcbiAgICAgIG5lYzogdi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxuICAgICAgb3BvcnR1OiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgbWFzVmU6IHYubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgIG1hc1ByOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgIGF5dWRhOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgICBwTW9zdDogdi5wb25kZXJhY2lvbk1vc3RyYWRvIHx8ICcnLFxuICAgICAgcEVjb206IHYucG9uZGVyYWNpb25FY29tbWVyY2UgfHwgJycsXG4gICAgICBjb21wZTogdi5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIGdwc1N0OiB2Lmdwc1N0YXR1cyB8fCAnJyxcbiAgICAgIGdwc0Rpc3Q6IHYuZ3BzRGlzdGFuY2VNICE9IG51bGwgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gaW1hZ2VuIGVuY2ltYVxuICAgICAgb25CZWhhbGY6IHYub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxuICAgICAgY3JlYXRlZEJ5OiB2LmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHYuY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgfSk7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHZpc2l0YScsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19WaXNpdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgbGlzdG86ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MnLCAyNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0YXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFTkRJQ0lPTkVTOiBnYXN0b3MgeSBhbnRpY2lwb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSZW5kaWNpb25lcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcmVuZGljaW9uZXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBwb3IgbWVzL2FuaW9cbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgciA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9IHIuZmVjaGEgfHwgci5mZWNoYUdhc3RvIHx8ICcnO1xuICAgIGlmICghZHQgJiYgci5jcmVhdGVkQXQgJiYgci5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IHIuY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBjb25zdCBkT2JqID0gbmV3IERhdGUoZHQpO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oZE9iai5nZXRUaW1lKCkpKSByZXR1cm47XG4gICAgaWYgKGRPYmouZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkT2JqLmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgaXRlbXMucHVzaCh7IGlkOiBkLmlkLCBmZWNoYTogZHQsIHI6IHIgfSk7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVuZGljaW9uZXMgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBDYXJnYSBsYXp5LlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBpdGVtcy5sZW5ndGggKyAnIHJlbmRpY2lvbmVzLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1JlbmRpY2lvbmVzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyNiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQ29uY2VwdG8nLCBrZXk6ICdjb25jZXB0bycsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnTiBUaWNrZXQnLCBrZXk6ICdudW1UaWNrZXQnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ01vZG8gcGFnbycsIGtleTogJ21vZG9QYWdvJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIGdhc3RvJywga2V5OiAndGlwb0dhc3RvJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdEaXZpc2lvbicsIGtleTogJ2RpdmlzaW9uJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlJywga2V5OiAnaW1wb3J0ZScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTW9uZWRhJywga2V5OiAnbW9uZWRhJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlIFVTRCcsIGtleTogJ2ltcG9ydGVVc2QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ09ic2VydmFjaW9uZXMnLCBrZXk6ICdvYnMnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gdGlja2V0Jywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnRXN0YWRvJywga2V5OiAnZXN0YWRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkb3InLCBrZXk6ICdhcHJvYmFkb3InLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvIGVuJywga2V5OiAnYXByb2JhZG9FbicsIHdpZHRoOiAxNCB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGN0UyMkNFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXG4gIGNvbnN0IFJPV19IID0gMTEwO1xuICBjb25zdCBJTUdfVyA9IDE0MDtcbiAgY29uc3QgSU1HX0ggPSAxMDA7XG5cbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykge1xuICAgIGNvbnN0IHIgPSBpdC5yO1xuICAgIGNvbnN0IGlzR2FzdG8gPSByLnRpcG8gPT09ICdnYXN0byc7XG4gICAgY29uc3QgY29uY2VwdFN0ciA9IGlzR2FzdG8gPyByLmRlc2NyaXBjaW9uIHx8ICcnIDogci50aXBvT3BlcmFjaW9uIHx8IHIubW90aXZvIHx8ICcnO1xuICAgIGNvbnN0IG9ic1N0ciA9XG4gICAgICAoci5vYnNlcnZhY2lvbmVzIHx8IHIubm90YXMgfHwgJycpICtcbiAgICAgIChpc0dhc3RvID8gJycgOiByLnNvbGljaXRhZG9Qb3IgPyAnIHwgU29saWNpdGFkbyBwb3I6ICcgKyByLnNvbGljaXRhZG9Qb3IgOiAnJyk7XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiBpdC5mZWNoYSxcbiAgICAgIHRpcG86IHIudGlwbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiByLm93bmVyTmFtZSB8fCByLnZlbmRvck5hbWUgfHwgci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgZW1haWw6IHIub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGNvbmNlcHRvOiBjb25jZXB0U3RyLFxuICAgICAgbnVtVGlja2V0OiByLm51bWVyb1RpY2tldCB8fCAnJyxcbiAgICAgIG1vZG9QYWdvOiByLm1vZG9QYWdvIHx8ICcnLFxuICAgICAgdGlwb0dhc3RvOiByLnRpcG9HYXN0byB8fCAnJyxcbiAgICAgIGRpdmlzaW9uOiByLmRpdmlzaW9uR2FzdG8gfHwgJycsXG4gICAgICBpbXBvcnRlOiByLmltcG9ydGUgIT0gbnVsbCA/IHIuaW1wb3J0ZSA6ICcnLFxuICAgICAgbW9uZWRhOiByLm1vbmVkYSB8fCAnUEVTT1MnLFxuICAgICAgaW1wb3J0ZVVzZDogci5pbXBvcnRlVXNkICE9IG51bGwgJiYgci5pbXBvcnRlVXNkICE9PSAwID8gci5pbXBvcnRlVXNkIDogJycsXG4gICAgICBvYnM6IG9ic1N0cixcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGVuY2ltYSB2YSBsYSBpbWFnZW5cbiAgICAgIGVzdGFkbzogci5zdGF0dXMgfHwgci5lc3RhZG8gfHwgJycsXG4gICAgICBhcHJvYmFkb3I6IHIuYXBwcm92ZXJFbWFpbCB8fCByLmFwcm9iYWRvciB8fCAnJyxcbiAgICAgIGFwcm9iYWRvRW46XG4gICAgICAgIHIuYXBwcm92ZWRBdCAmJiByLmFwcHJvdmVkQXQudG9EYXRlID8gci5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgfSk7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogU0lFTVBSRSBlbWJlYmVyIGxhIGZvdG8gKG5vIGRlamFyIGh5cGVybGluaykuXG4gICAgLy8gQW50ZXM6IHNpIGZvdG9UaWNrZXRVcmwgKFN0b3JhZ2UpLCBxdWVkYWJhIGNvbW8gaHlwZXJsaW5rIEFicmlyIHRpY2tldC5cbiAgICAvLyBBaG9yYTogZmV0Y2ggZGVsIFVSTCArIGNvbnZlcnRpciBhIGFycmF5QnVmZmVyICsgZW1iZWJlciBpZ3VhbCBxdWUgZGF0YVVSTC5cbiAgICAvLyBGYWxsYmFjayBhIGh5cGVybGluayBzb2xvIHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQsIGV0YykuXG4gICAgY29uc3QgZm90b1NyYyA9IHIuZm90b1RpY2tldCB8fCByLmFkanVudG8gfHwgJyc7XG4gICAgaWYgKGZvdG9TcmMgJiYgdHlwZW9mIGZvdG9TcmMgPT09ICdzdHJpbmcnICYmIGZvdG9TcmMuc3RhcnRzV2l0aCgnZGF0YTppbWFnZS8nKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IGZvdG9TcmM7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gcmVuZGljaW9uJywgaXQuaWQsIGUpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoci5mb3RvVGlja2V0VXJsICYmIHR5cGVvZiByLmZvdG9UaWNrZXRVcmwgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogZmV0Y2ggbGEgZm90byBkZXNkZSBTdG9yYWdlIHkgZW1iZWJlcmxhIGNvbW8gaW1hZ2VuLlxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKHIuZm90b1RpY2tldFVybCk7XG4gICAgICAgIGlmICghcmVzcC5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByZXNwLnN0YXR1cyk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcC5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykgfHwgJ2ltYWdlL2pwZWcnO1xuICAgICAgICBsZXQgZXh0ID0gY29udGVudFR5cGUuc3BsaXQoJy8nKVsxXSB8fCAnanBlZyc7XG4gICAgICAgIGV4dCA9IGV4dC5zcGxpdCgnOycpWzBdLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBidWYgPSBhd2FpdCByZXNwLmFycmF5QnVmZmVyKCk7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJ1ZmZlcjogYnVmLCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gRmFsbGJhY2s6IHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQpLCBkZWphciBoeXBlcmxpbmsgY29tbyBhbnRlcy5cbiAgICAgICAgY29uc29sZS53YXJuKCdmZXRjaCBmb3RvIHJlbmRpY2lvbiBmYWxsbywgZGVqbyBoeXBlcmxpbmsnLCBpdC5pZCwgZSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgY2VsbCA9IHJvdy5nZXRDZWxsKEZPVE9fQ09MX0lEWCArIDEpO1xuICAgICAgICAgIGNlbGwudmFsdWUgPSB7XG4gICAgICAgICAgICB0ZXh0OiAnQWJyaXIgdGlja2V0JyxcbiAgICAgICAgICAgIGh5cGVybGluazogci5mb3RvVGlja2V0VXJsLFxuICAgICAgICAgICAgdG9vbHRpcDogJ0FicmlyIGxhIGZvdG8gZGVsIHRpY2tldCBlbiBlbCBicm93c2VyIChmZXRjaCBmYWxsbyknLFxuICAgICAgICAgIH07XG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkYwNTYzQzEnIH0sIHVuZGVybGluZTogdHJ1ZSB9O1xuICAgICAgICB9IGNhdGNoIChfZTIpIHt9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1JlbmRpY2lvbmVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUmVuZGljaW9uZXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSdXRhcy4uLicpO1xuICAvLyBMYXMgcnV0YXMgc2UgZ2VuZXJhbiBlbiBydW50aW1lIHBhcmEgY2FkYSB2ZW5kZWRvcjsgZW4gY2FtYmlvIGxvcyBvdmVycmlkZXNcbiAgLy8gKGRlcml2YWNpb25lcyAvIHJlYWdlbmRhcykgdml2ZW4gZW4gcm91dGVfb3ZlcnJpZGVzLiBFeHBvcnRhbW9zOlxuICAvLyAgLSB1bmEgaG9qYSBjb24gbGFzIHJ1dGFzIHBsYW5pZmljYWRhcyBkZWwgcGVyaW9kbyAocGFyYSBsb3MgdmVuZGVkb3Jlc1xuICAvLyAgICBkZWwgcm9sIGFjdHVhbCBvIHRvZG9zIHNpIGFkbWluKVxuICAvLyAgLSB1bmEgaG9qYSBjb24gbG9zIG92ZXJyaWRlcyBkZWwgcGVyaW9kb1xuICBjb25zdCB0YXJnZXRWZW5kb3JzID1cbiAgICB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ3ZpZXdlcidcbiAgICAgID8gVkVORE9SUy5tYXAoKHYpID0+IHYua2V5KVxuICAgICAgOiBhc3NpZ25lZFZlbmRvclxuICAgICAgICA/IFthc3NpZ25lZFZlbmRvcl1cbiAgICAgICAgOiBbXTtcbiAgY29uc3QgbW9udGhzVG9FeHBvcnQgPSBtb250aElkeCAhPT0gbnVsbCA/IFttb250aElkeF0gOiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgNywgOCwgOSwgMTAsIDExXTtcbiAgY29uc3QgcnV0YXNSb3dzID0gW107XG4gIGZvciAoY29uc3QgdmVuZCBvZiB0YXJnZXRWZW5kb3JzKSB7XG4gICAgZm9yIChjb25zdCBtIG9mIG1vbnRoc1RvRXhwb3J0KSB7XG4gICAgICBsZXQgcnV0YXM7XG4gICAgICB0cnkge1xuICAgICAgICBydXRhcyA9IGdlbmVyYXJSdXRhc1ZlbmRvcih2ZW5kLCBtLCBhbmlvKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIHJ1dGFzID0gW107XG4gICAgICB9XG4gICAgICAocnV0YXMgfHwgW10pLmZvckVhY2goKHJ1dGEpID0+IHtcbiAgICAgICAgKHJ1dGEudGllbmRhcyB8fCBbXSkuZm9yRWFjaCgodCwgaSkgPT4ge1xuICAgICAgICAgIHJ1dGFzUm93cy5wdXNoKHtcbiAgICAgICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZCksXG4gICAgICAgICAgICBBbmlvOiBhbmlvLFxuICAgICAgICAgICAgTWVzOiBNRVNFU1ttXSxcbiAgICAgICAgICAgIFJ1dGFfSUQ6IHJ1dGEuaWQgfHwgJycsXG4gICAgICAgICAgICBSdXRhX05vbWJyZTogcnV0YS5ub21icmUgfHwgJycsXG4gICAgICAgICAgICBGZWNoYV9Bc2lnbmFkYTogcnV0YS5mZWNoYUFzaWduYWRhIHx8ICcnLFxuICAgICAgICAgICAgT3JkZW46IGkgKyAxLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UodC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgICAgICBMb2NhbGlkYWQ6IHQubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgICAgIFRpZW5kYTogdC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGlwbzogdC50aXBvIHx8ICcnLFxuICAgICAgICAgICAgRXN0YWRvOiB0LmVzdGFkbyB8fCAnJyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gT3ZlcnJpZGVzXG4gIGxldCBvdnJTbmFwO1xuICB0cnkge1xuICAgIG92clNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvdXRlX292ZXJyaWRlcycpLmdldCgpO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG92clNuYXAgPSBudWxsO1xuICB9XG4gIGNvbnN0IG92ZXJyaWRlc1Jvd3MgPSBbXTtcbiAgaWYgKG92clNuYXApIHtcbiAgICBvdnJTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGNvbnN0IG8gPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgIGlmIChwYXJzZUludChvLmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KG8ubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICAgIG92ZXJyaWRlc1Jvd3MucHVzaCh7XG4gICAgICAgIEFuaW86IG8uYW5pbyB8fCAnJyxcbiAgICAgICAgTWVzOiBNRVNFU1twYXJzZUludChvLm1vbnRoSWR4LCAxMCldIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKG8udmVuZG9yIHx8ICcnKSxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uoby5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBUaWVuZGE6IG8uY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQWNjaW9uOiBvLmFjdGlvbiB8fCBvLnRpcG8gfHwgJycsXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxuICAgICAgICBSZWFnZW5kYWRhX1BhcmE6IG8ucmVhZ2VuZGFkYVBhcmEgfHwgJycsXG4gICAgICAgIE1vdGl2bzogby5tb3Rpdm8gfHwgJycsXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgICAgIENyZWFkb19FbjpcbiAgICAgICAgICBvLmNyZWF0ZWRBdCAmJiBvLmNyZWF0ZWRBdC50b0RhdGUgPyBvLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19SdXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUnV0YXMgcGxhbmlmaWNhZGFzJywgcm93czogcnV0YXNSb3dzIH0sXG4gICAgeyBuYW1lOiAnRGVyaXZhY2lvbmVzLVJlYWdlbmRhcycsIHJvd3M6IG92ZXJyaWRlc1Jvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUnV0YXMgbGlzdG8gKCcgKyBydXRhc1Jvd3MubGVuZ3RoICsgJyB0aWVuZGFzLCAnICsgb3ZlcnJpZGVzUm93cy5sZW5ndGggKyAnIG92ZXJyaWRlcyknLFxuICAgIDI0MDBcbiAgKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQWx0YXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gJyc7XG4gICAgaWYgKGEuY3JlYXRlZEF0ICYmIGEuY3JlYXRlZEF0LnRvRGF0ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZHQgPSBhLmNyZWF0ZWRBdC50b0RhdGUoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBpZiAoIWR0KSByZXR1cm47XG4gICAgaWYgKGR0LmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZHQuZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfU29saWNpdHVkOiBkdC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSxcbiAgICAgIEVzdGFkbzogYS5zdGF0dXMgfHwgJycsXG4gICAgICBDb21lcmNpbzogYS5jb21lcmNpbyB8fCAnJyxcbiAgICAgIEZhbnRhc2lhOiBhLmZhbnRhc2lhIHx8ICcnLFxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxuICAgICAgQ29uZGljaW9uX0Zpc2NhbDogYS5jb25kRmlzY2FsIHx8ICcnLFxuICAgICAgQ2FsbGU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOdW1lcm86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBhLmxvY2FsaWRhZCB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYS5wcm92aW5jaWEgfHwgJycsXG4gICAgICBDUDogYS5jcCB8fCAnJyxcbiAgICAgIFRlbGVmb25vOiBhLnRlbGVmb25vIHx8ICcnLFxuICAgICAgRW1haWw6IGEuZW1haWwgfHwgJycsXG4gICAgICBWZW5kZWRvcl9Tb2xpY2l0YW50ZTogYS52ZW5kb3JOYW1lIHx8IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIE93bmVyX0VtYWlsOiBhLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBTdWJtaXR0ZWRfQnlfUHVibGljX0Zvcm06IGEuc3VibWl0dGVkQnlQdWJsaWNGb3JtID8gJ1NJJyA6ICdOTycsXG4gICAgICBBcHJvYmFkb19Qb3I6IGEuYXBwcm92ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgQXByb2JhZG9fRW46XG4gICAgICAgIGEuYXBwcm92ZWRBdCAmJiBhLmFwcHJvdmVkQXQudG9EYXRlID8gYS5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICBSZWNoYXphZG9fTW90aXZvOiBhLnJlamVjdGVkUmVhc29uIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19BbHRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQWx0YXMgZGUgY2xpZW50ZXMnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBBbHRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBzb2xpY2l0dWRlcyknLCAyNDAwKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyB2NzA5ICgyMDI2LTA4LTI4KTogMyBleHBvcnRzIG51ZXZvcyBwZWRpZG9zIHBvciBNYXJpYW5vLlxuLy8gLSBCQUNLT1JERVI6IGxpbmVhcyBzdGF0ZT1CTyBvcGVuIHBvciBtZXMgZGUgY3JlYXRlZEF0IGRlbCBwZWRpZG8uXG4vLyAtIFNUT0NLX0FTSUc6IGxpbmVhcyBBU0lHIG9wZW4gKG8gQk8rc3RvY2sgZGlzcCkgcG9yIG1lcyBkZSBjcmVhdGVkQXQuXG4vLyAtIFBFRElET1NfTUVTOiBUT0RPUyBsb3MgcGVkaWRvcyBjcmVhZG9zIGVuIGVsIG1lcy9hbmlvIChjdWFscXVpZXIgc3RhZ2UpLlxuLy8gRnVlbnRlOiBnbG9iYWxQZWRpZG9zIChsbyBxdWUgbGEgYXBwIHlhIHRpZW5lIGVuIG1lbW9yaWEpLlxuLy8gRmlsdGVyIG1lcy9hXHUwMEYxbzogc29icmUgY3JlYXRlZEF0IGRlbCBwZWRpZG8uIG1vbnRoSWR4PW51bGwgLT4gYVx1MDBGMW8gZW50ZXJvLlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5mdW5jdGlvbiBfcGVkaWRvTW9udGhZZWFyKHApIHtcbiAgY29uc3QgY2EgPSBwLmNyZWF0ZWRBdDtcbiAgaWYgKCFjYSkgcmV0dXJuIHsgeTogbnVsbCwgbTogbnVsbCB9O1xuICBsZXQgZHQgPSBudWxsO1xuICBpZiAodHlwZW9mIGNhID09PSAnc3RyaW5nJykgZHQgPSBuZXcgRGF0ZShjYSk7XG4gIGVsc2UgaWYgKHR5cGVvZiBjYS50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0cnkge1xuICAgICAgZHQgPSBjYS50b0RhdGUoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBlbHNlIGlmICh0eXBlb2YgY2EgPT09ICdudW1iZXInKSBkdCA9IG5ldyBEYXRlKGNhKTtcbiAgaWYgKCFkdCB8fCBOdW1iZXIuaXNOYU4oZHQuZ2V0VGltZSgpKSkgcmV0dXJuIHsgeTogbnVsbCwgbTogbnVsbCB9O1xuICByZXR1cm4geyB5OiBkdC5nZXRGdWxsWWVhcigpLCBtOiBkdC5nZXRNb250aCgpIH07XG59XG5cbmZ1bmN0aW9uIF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCkge1xuICBjb25zdCBhcnIgPVxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xuICByZXR1cm4gYXJyLmZpbHRlcigocCkgPT4ge1xuICAgIGlmICghcCkgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IHsgeSwgbSB9ID0gX3BlZGlkb01vbnRoWWVhcihwKTtcbiAgICBpZiAoeSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHkgIT09IGFuaW8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgbSAhPT0gbW9udGhJZHgpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlci4uLicpO1xuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8uIEZpbHRyYSBwb3IgbWVzIHZcdTAwRURhIGZpbHRlcnMubWVzWVlZWU1NXG4gIC8vIChxdWUgZWwgbVx1MDBGM2R1bG8gYXBsaWNhIHNvYnJlIGNvbmZpcm1lZEF0KS4gQ29pbmNpZGUgY29uIGVsIG1vZGFsLlxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IG1lc1lZWVlNTSA9IGFuaW8gKyAnLScgKyBTdHJpbmcobW9udGhJZHggKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgLy8gdjExMDEgKDIwMjYtMDktMzApOiBidXNjYXIgcHJpbWVybyBwb3Igc2FwQ2FyZENvZGUgKFx1MDBGQW5pY28sIG5vIGRlcGVuZGUgZGVcbiAgLy8gbm9ybWFsaXphY2lcdTAwRjNuIGRlIHN0cmluZ3MpIHkgc1x1MDBGM2xvIGNhZXIgYWwgY2xpZW50TG9jSWQgY29tbyBcdTAwRkFsdGltbyByZWN1cnNvLlxuICAvLyBWZXIgY29tZW50YXJpbyBleHRlbmRpZG8gZW4gaW5kZXguaHRtbDpleHBvcnRCYWNrb3JkZXJzVG9FeGNlbC5cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlID0gdy5jbGllbnRNYXN0ZXJDYWNoZTtcbiAgICAgIGlmICghY2FjaGUpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNjID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmIChjYyAmJiB0eXBlb2YgY2FjaGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBsZXQgZm91bmQgPSAnJztcbiAgICAgICAgY2FjaGUuZm9yRWFjaCgoY21EYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm47XG4gICAgICAgICAgaWYgKGNtRGF0YSAmJiBTdHJpbmcoY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCkgPT09IGNjICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikge1xuICAgICAgICAgICAgZm91bmQgPSBjbURhdGEuYXNzaWduZWRWZW5kb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIGNhY2hlLmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICAgIGNvbnN0IGNtRGF0YSA9IGNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgcGVkaWRvcyxcbiAgICAgICAgJ3VyZ2VudGUnLFxuICAgICAgICB7IG1lc1lZWVlNTSB9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxbyA9IGMucXR5QmFja29yZGVyIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgY2FudGlkYWRQZWRpZGEgPSBxbztcbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgICAgY2FudGlkYWRQZWRpZGEgPSBOdW1iZXIocC5saW5lc1tpZHhdLnF0eSkgfHwgcW87XG4gICAgICAgIGxpbmVhSWR4ID0gaWR4O1xuICAgICAgfVxuICAgIH1cbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9QZWRpZGE6IGNhbnRpZGFkUGVkaWRhLFxuICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcbiAgICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZChxbyAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl8nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQmFja29yZGVyJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8uLi4nKTtcbiAgLy8gdjExMDA6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvIG1vZG8gYXNpZ25hY2lvbi4gQ29pbmNpZGUgY29uIGVsIG1vZGFsLlxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IG1lc1lZWVlNTSA9IGFuaW8gKyAnLScgKyBTdHJpbmcobW9udGhJZHggKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgLy8gdjExMDEgKDIwMjYtMDktMzApOiBidXNjYXIgcHJpbWVybyBwb3Igc2FwQ2FyZENvZGUgKFx1MDBGQW5pY28sIG5vIGRlcGVuZGUgZGVcbiAgLy8gbm9ybWFsaXphY2lcdTAwRjNuIGRlIHN0cmluZ3MpIHkgc1x1MDBGM2xvIGNhZXIgYWwgY2xpZW50TG9jSWQgY29tbyBcdTAwRkFsdGltbyByZWN1cnNvLlxuICAvLyBWZXIgY29tZW50YXJpbyBleHRlbmRpZG8gZW4gaW5kZXguaHRtbDpleHBvcnRCYWNrb3JkZXJzVG9FeGNlbC5cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlID0gdy5jbGllbnRNYXN0ZXJDYWNoZTtcbiAgICAgIGlmICghY2FjaGUpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNjID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmIChjYyAmJiB0eXBlb2YgY2FjaGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBsZXQgZm91bmQgPSAnJztcbiAgICAgICAgY2FjaGUuZm9yRWFjaCgoY21EYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm47XG4gICAgICAgICAgaWYgKGNtRGF0YSAmJiBTdHJpbmcoY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCkgPT09IGNjICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikge1xuICAgICAgICAgICAgZm91bmQgPSBjbURhdGEuYXNzaWduZWRWZW5kb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIGNhY2hlLmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICAgIGNvbnN0IGNtRGF0YSA9IGNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgcGVkaWRvcyxcbiAgICAgICAgJ2FzaWduYWNpb24nLFxuICAgICAgICB7IG1lc1lZWVlNTSB9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxdHkgPSBjLnF0eUFzaWduYWRhIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xuICAgIH1cbiAgICBsZXQgZXN0YWRvUmVhbCA9ICdBU0lHJztcbiAgICBpZiAoYy5zdGF0ZSA9PT0gJ0JPJykgZXN0YWRvUmVhbCA9ICdCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRyknO1xuICAgIGVsc2UgaWYgKGMuc3RhdGUgPT09ICdjb25maXJtZWQnKSBlc3RhZG9SZWFsID0gJ2NvbmZpcm1lZCAoU1EgZW4gU0FQKSc7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXG4gICAgICBNZXM6IChwICYmIHAubW9udGgpIHx8ICcnLFxuICAgICAgQ2xpZW50ZTogYy5ub21icmUgfHwgJycsXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBjLnByb3ZpbmNpYSB8fCAocCAmJiBwLnByb3ZpbmNlKSB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYy5jaXVkYWQgfHwgKHAgJiYgcC5sb2NOYW1lKSB8fCAnJyxcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcbiAgICAgIFNLVTogcmwuc2t1IHx8ICcnLFxuICAgICAgUHJvZHVjdG86IHJsLnByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ2FudGlkYWRfUmVzZXJ2YWRhOiBxdHksXG4gICAgICBFc3RhZG9fUmVhbDogZXN0YWRvUmVhbCxcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcbiAgICAgIFN1YnRvdGFsX1Jlc2VydmFkb19BUlM6IE1hdGgucm91bmQocXR5ICogKGMucHJlY2lvIHx8IDApKSxcbiAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXG4gICAgfSk7XG4gIH0pO1xuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG4vLyB2NzM3ICgyMDI2LTA4LTMwKTogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG9zIGxvcyBiYWNrb3JkZXJzIG9wZW4gKHNpbiBmaWx0cm9cbi8vIGRlIG1lcykuIE1vdGl2bzogbG9zIDYyIHBlZGlkb3MgbWlncmFkb3MgZGVzZGUgU0FQIGVsIDIwMjYtMDgtMjggdGllbmVuXG4vLyBjcmVhdGVkQXQgZGUgZmVjaGFzIHZpZWphcyBkZWwgU0FQIFNRIG9yaWdpbmFsLCBlbnRvbmNlcyBlbCBleHBvcnQgcG9yIG1lc1xuLy8gbm8gbG9zIGluY2x1aWEuIFZlcnNpb24gXCJjdXJyZW50IHN0YXR1c1wiIHF1ZSBpdGVyYSBnbG9iYWxQZWRpZG9zIGNvbXBsZXRvLlxud2luZG93LmV4cG9ydEJhY2tvcmRlckFsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XG4gIC8vIHYxMTAwICgyMDI2LTA5LTMwKTogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8gYmFja29yZGVyLXNrdS1tYXAgXHUyMDE0IG1pc21vXG4gIC8vIEZJRk8gKyBmaWx0cm8gdmVuY2lkYXMgKyBlc3RhZG9zIChCTytBU0lHK2NvbmZpcm1lZCkgcXVlIGVsIG1vZGFsLiBBbnRlc1xuICAvLyBlc3RlIGV4cG9ydCBlcmEgdW4gZHVtcCBjcnVkbyBkZSBsXHUwMEVEbmVhcyBzdGF0ZT1CTyBzaW4gY2FwIG5pIGZpbHRyb1xuICAvLyB2ZW5jaWRhcywgYXNcdTAwRUQgcXVlIGRpdmVyZ1x1MDBFRGEgZGVsIG1vZGFsLiBBaG9yYSBlcyBwYXJpZGFkIHRvdGFsLlxuICBjb25zdCBhcnIgPVxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIGFycixcbiAgICAgICAgJ3VyZ2VudGUnLFxuICAgICAgICB7fSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICAvLyBcdTAwQ0RuZGljZSBwZWRpZG9JZCBcdTIxOTIgcGVkaWRvIHBhcmEgZW5yaXF1ZWNlciBjb24gY2FtcG9zIHF1ZSBlbCBtXHUwMEYzZHVsbyBubyBleHBvbmVcbiAgLy8gKE1lcywgQ2FudGlkYWRfUGVkaWRhIG9yaWdpbmFsLCBPcmlnZW4sIExpbmVhX0lkeCkuXG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIGFycikgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIC8vIENhbnRpZGFkX1BlbmRpZW50ZV9CTyA9IHF0eUJhY2tvcmRlciBwb3N0LUZJRk8uXG4gICAgY29uc3QgcW8gPSBjLnF0eUJhY2tvcmRlciB8fCAwO1xuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xuICAgIGlmIChjLnBlZGlkb0NyZWF0ZWRBdCkge1xuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcbiAgICAgIGZlY2hhUGVkaWRvID1cbiAgICAgICAgdHlwZW9mIGR0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICB9XG4gICAgLy8gUmVjdXBlcmFyIGxhIGxcdTAwRURuZWEgb3JpZ2luYWwgcGFyYSBDYW50aWRhZF9QZWRpZGEgKyBMaW5lYV9JZHggKHNpIGhheSBwZWRpZG8pLlxuICAgIGxldCBjYW50aWRhZFBlZGlkYSA9IHFvO1xuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkge1xuICAgICAgICBjYW50aWRhZFBlZGlkYSA9IE51bWJlcihwLmxpbmVzW2lkeF0ucXR5KSB8fCBxbztcbiAgICAgICAgbGluZWFJZHggPSBpZHg7XG4gICAgICB9XG4gICAgfVxuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1BlZGlkYTogY2FudGlkYWRQZWRpZGEsXG4gICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKGMucHJlY2lvIHx8IDApKSxcbiAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXG4gICAgICBTUV9Eb2NOdW06IGMuc3FEb2NOdW0gfHwgJycsXG4gICAgICBPcmlnZW46IChwICYmIHAubWlncmF0aW9uU291cmNlKSB8fCAnYXBwJyxcbiAgICAgIC8vIHYxMTAwOiBjb250ZXh0byBcdTAwRkF0aWwgcGFyYSBkZWJ1Z2dpbmcgcGFyaWRhZCBtb2RhbFx1MjE5NHJlcG9ydGUuXG4gICAgICBFc3RhZG86IGMuc3RhdGUgfHwgJ0JPJyxcbiAgICAgIFN0b2NrX0Rpc3BfU0tVOiBybC5kaXNwU2FwIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydChcbiAgICAgICdFeHBvcnQgQmFja29yZGVyIHZhY2lvLiBEaWFnbm9zdGljbzpcXG4nICtcbiAgICAgICAgJy0gVG90YWwgcGVkaWRvcyBlbiBnbG9iYWxQZWRpZG9zOiAnICtcbiAgICAgICAgYXJyLmxlbmd0aCArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gUGVkaWRvcyBhYmllcnRvcyAoc2luIGNsb3NlZEF0KTogJyArXG4gICAgICAgIHRvdGFsUGVkaWRvc09wZW4gK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIExpbmVhcyBwb3N0LUZJRk8rdmVuY2lkYXMgY29uIHF0eUJhY2tvcmRlcj4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgYmFja29yZGVyIGFiaWVydG8gYWhvcmEgbWlzbW8gKHRvZG8gY29uZmlybWVkLCBjZXJyYWRvIG8gdmVuY2lkbylcXG4nICtcbiAgICAgICAgJzIuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvIHBvciBlcnJvclxcbicgK1xuICAgICAgICAnMy4gVG9kYXMgbGFzIGxpbmVhcyBCTyB0aWVuZW4gc3RvY2sgZGlzcG9uaWJsZSAoZnVlcm9uIHByb21vdmlkYXMgYSBBU0lHIHZpcnR1YWwpJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXI6IDAgbGluZWFzICh2ZXIgYWxlcnRhKScsIDMwMDApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIC8vIHYxMzY2ICgyMDI2LTEwLTE5KTogaG9qYSBcIlJlc3VtZW5cIiBjb24gbG9zIE1JU01PUyB0b3RhbGVzIHF1ZSBlbCBtb2RhbFxuICAvLyBCYWNrb3JkZXIgKGNvbXB1dGVCYWNrb3JkZXJTa3VNYXAgcG9zdC1jb25zb2xpZGFjaW9uIHBvciBjbGllbnRlKS4gQW50ZXNcbiAgLy8gZWwgZXhwb3J0IGR1bXBlYWJhIGxpbmVhcyBjcnVkYXMgc2luIG5pbmd1biB0b3RhbCBcdTIxOTIgTWFyaWFubyBzdW1hYmEgbGFcbiAgLy8gY29sdW1uYSBTdWJ0b3RhbF9CT19BUlMgeSBlbCB2YWxvciBwb2RpYSBkaXZlcmdlciBkZWwgbW9kYWwgY3VhbmRvIHVuXG4gIC8vIGNsaWVudGUgdGVuaWEgdmFyaWFzIGxpbmVhcyBCTyBkZWwgbWlzbW8gU0tVIGNvbiBwcmVjaW9zIGRpc3RpbnRvcyAoZWxcbiAgLy8gbW9kYWwgY29uc29saWRhIHVzYW5kbyBlbCBwcmVjaW8gZGUgbGEgMXJhIGxpbmVhIHByb2Nlc2FkYTsgZWwgZXhwb3J0XG4gIC8vIHVzYSBlbCBwcmVjaW8gZGUgY2FkYSBsaW5lYSBpbmRpdmlkdWFsKS5cbiAgY29uc3QgX2NvbXB1dGVTa3VNYXBGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyU2t1TWFwO1xuICBjb25zdCBfbW9kYWxEZXBzID0ge1xuICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICBjYW5vblZlbmRvcjpcbiAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICBiYWNrb3JkZXJMaW5lczogQXJyYXkuaXNBcnJheSh3LmJhY2tvcmRlckxpbmVzKSA/IHcuYmFja29yZGVyTGluZXMgOiBbXSxcbiAgICBzYXBHZXRDbGllbnRlQ29kZTogdHlwZW9mIHcuc2FwR2V0Q2xpZW50ZUNvZGUgPT09ICdmdW5jdGlvbicgPyB3LnNhcEdldENsaWVudGVDb2RlIDogdW5kZWZpbmVkLFxuICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgfTtcbiAgY29uc3QgX21vZGFsRmlsdGVycyA9IHtcbiAgICB0aWVuZGFRdWVyeTogJycsXG4gICAgdmVuZG9yS2V5OiAnJyxcbiAgICBtZXNZWVlZTU06ICcnLFxuICAgIHVyZ2VuY3lGaWx0ZXI6ICcnLFxuICAgIGluY2x1ZGVFeHBpcmVkOiB0cnVlLFxuICAgIGFnZ3JlZ2F0aW9uTW9kZTogJ2ZpZm8nLFxuICB9O1xuICBjb25zdCBfbW9kYWxSZXN1bHQgPSBfY29tcHV0ZVNrdU1hcEZuXG4gICAgPyBfY29tcHV0ZVNrdU1hcEZuKGFyciwgJ3VyZ2VudGUnLCBfbW9kYWxGaWx0ZXJzLCBfbW9kYWxEZXBzKVxuICAgIDogeyBza3VzOiBbXSwgdG90YWxVbmlkYWRlczogMCwgdG90YWxDbGllbnRlczogMCB9O1xuICBsZXQgdG90YWxQZXNvc01vZGFsID0gMDtcbiAgY29uc3Qgc3VidG90YWxlc1BvclVyZ2VuY3kgPSB7IHVyZ2VudGU6IDAsIHBhcmNpYWw6IDAgfTtcbiAgZm9yIChjb25zdCBnIG9mIF9tb2RhbFJlc3VsdC5za3VzIHx8IFtdKSB7XG4gICAgY29uc3QgdXJnID0gZy51cmdlbmN5IHx8ICd1cmdlbnRlJztcbiAgICBmb3IgKGNvbnN0IGMgb2YgZy5jbGllbnRlcyB8fCBbXSkge1xuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGMucXR5QmFja29yZGVyKSB8fCAwO1xuICAgICAgaWYgKHF0eSA8PSAwKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihjLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IHN1YiA9IHF0eSAqIHByZWNpbztcbiAgICAgIHRvdGFsUGVzb3NNb2RhbCArPSBzdWI7XG4gICAgICBpZiAodXJnID09PSAncGFyY2lhbCcpIHN1YnRvdGFsZXNQb3JVcmdlbmN5LnBhcmNpYWwgKz0gc3ViO1xuICAgICAgZWxzZSBzdWJ0b3RhbGVzUG9yVXJnZW5jeS51cmdlbnRlICs9IHN1YjtcbiAgICB9XG4gIH1cbiAgY29uc3QgdG90YWxVbmlkYWRlc01vZGFsID0gX21vZGFsUmVzdWx0LnRvdGFsVW5pZGFkZXMgfHwgMDtcbiAgY29uc3QgdG90YWxDbGllbnRlc01vZGFsID0gX21vZGFsUmVzdWx0LnRvdGFsQ2xpZW50ZXMgfHwgMDtcbiAgY29uc3QgdG90YWxTa3VzTW9kYWwgPSAoX21vZGFsUmVzdWx0LnNrdXMgfHwgW10pLmxlbmd0aDtcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXG4gICAgeyBNZXRyaWNhOiAnVE9UQUwgQmFja29yZGVyIEFSUyAoaWd1YWwgYWwgbW9kYWwpJywgVmFsb3I6IE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1NLVXMgY29uIGJhY2tvcmRlcicsIFZhbG9yOiB0b3RhbFNrdXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1VuaWRhZGVzIHBlbmRpZW50ZXMnLCBWYWxvcjogTWF0aC5yb3VuZCh0b3RhbFVuaWRhZGVzTW9kYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnQ2xpZW50ZXMgYWZlY3RhZG9zJywgVmFsb3I6IHRvdGFsQ2xpZW50ZXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1x1MjAxNCBTdWJ0b3RhbCBTSU4gUkVQT1NJQ0lPTicsIFZhbG9yOiBNYXRoLnJvdW5kKHN1YnRvdGFsZXNQb3JVcmdlbmN5LnVyZ2VudGUpIH0sXG4gICAgeyBNZXRyaWNhOiAnXHUyMDE0IFN1YnRvdGFsIFBBUkNJQUwnLCBWYWxvcjogTWF0aC5yb3VuZChzdWJ0b3RhbGVzUG9yVXJnZW5jeS5wYXJjaWFsKSB9LFxuICAgIHtcbiAgICAgIE1ldHJpY2E6XG4gICAgICAgICdMaW5lYXMgY3J1ZGFzIGVuIGhvamEgQmFja29yZGVyIChoYXkgdmFyaWFzIHBvciBjbGllbnRlL1NLVSBzaSBoYXkgbXVsdGlwbGVzIHBlZGlkb3MpJyxcbiAgICAgIFZhbG9yOiByb3dzLmxlbmd0aCxcbiAgICB9LFxuICAgIHsgTWV0cmljYTogJ1NuYXBzaG90IGdlbmVyYWRvJywgVmFsb3I6IG5ldyBEYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgfSxcbiAgXTtcbiAgLy8gQWdyZWdhciBmaWxhIFRPVEFMIGFsIGZpbmFsIGRlIGxhIGhvamEgQmFja29yZGVyIHVzYW5kbyBsYSBNSVNNQSBmb3JtdWxhXG4gIC8vIHF1ZSBfbW9kYWxSZXN1bHQgKGNvbnNvbGlkYWRhIHBvciBjbGllbnRlKS4gU2luIGVzdG8sIHN1bWFyIGxhIGNvbHVtbmFcbiAgLy8gU3VidG90YWxfQk9fQVJTIGEgbWFubyBkYSBlbCB2YWxvciBjcnVkbyAocHVlZGUgZGl2ZXJnZXIpLlxuICBjb25zdCB0b3RhbFJvdyA9IHtcbiAgICBGZWNoYV9QZWRpZG86ICcnLFxuICAgIE1lczogJycsXG4gICAgQ2xpZW50ZTogJ1RPVEFMIChpZ3VhbCBhbCBtb2RhbCknLFxuICAgIENhcmRDb2RlOiAnJyxcbiAgICBQcm92aW5jaWE6ICcnLFxuICAgIExvY2FsaWRhZDogJycsXG4gICAgVmVuZGVkb3I6ICcnLFxuICAgIFNLVTogJycsXG4gICAgUHJvZHVjdG86ICcnLFxuICAgIENhbnRpZGFkX1BlZGlkYTogJycsXG4gICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBNYXRoLnJvdW5kKHRvdGFsVW5pZGFkZXNNb2RhbCksXG4gICAgUHJlY2lvX1VuaXRfQVJTOiAnJyxcbiAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKSxcbiAgICBQZWRpZG9fSUQ6ICcnLFxuICAgIExpbmVhX0lkeDogJycsXG4gICAgU1FfRG9jTnVtOiAnJyxcbiAgICBPcmlnZW46ICcnLFxuICAgIEVzdGFkbzogJycsXG4gICAgU3RvY2tfRGlzcF9TS1U6ICcnLFxuICB9O1xuICByb3dzLnB1c2godG90YWxSb3cpO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChcbiAgICBmbmFtZSxcbiAgICBbXG4gICAgICB7IG5hbWU6ICdSZXN1bWVuJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgICAgIHsgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfSxcbiAgICBdLFxuICAgIHtcbiAgICAgIC8vIFBpbnRhciBsYSBmaWxhIFRPVEFMIGRlIGxhIGhvamEgQmFja29yZGVyICsgZmlsYSAxIChUT1RBTCkgZGUgUmVzdW1lbi5cbiAgICAgIGNlbGxTdHlsZXI6IChjZWxsLCBjb2x1bW5OYW1lLCBfdmFsdWUsIHJvd0luZGV4KSA9PiB7XG4gICAgICAgIC8vIEhvamEgUmVzdW1lbjogZmlsYSBUT1RBTCA9IHJvd0luZGV4IDAgKHByaW1lcmEgZGF0YSByb3cgcG9zdCBoZWFkZXIpLlxuICAgICAgICAvLyBIb2phIEJhY2tvcmRlcjogZmlsYSBUT1RBTCA9IHVsdGltYSByb3cgKHJvd0luZGV4ID09PSByb3dzLmxlbmd0aCAtIDEpLlxuICAgICAgICAvLyBObyB0ZW5lbW9zIGFjY2VzbyBhbCBub21icmUgZGUgbGEgaG9qYSBlbiBlbCBzdHlsZXIsIHBlcm8gcGludGFtb3NcbiAgICAgICAgLy8gcG9yIGNlbGRhOiBzaSBjb2x1bW5OYW1lPT0nTWV0cmljYScgeSBlcyAnVE9UQUwgQmFja29yZGVyIEFSUy4uLicsXG4gICAgICAgIC8vIG8gc2kgY29sdW1uTmFtZT09J0NsaWVudGUnIHkgZWwgdmFsb3IgaW5jbHV5ZSAnVE9UQUwnLlxuICAgICAgICBjb25zdCB0eHQgPSBTdHJpbmcoY2VsbC52YWx1ZSB8fCAnJyk7XG4gICAgICAgIGlmIChcbiAgICAgICAgICAoY29sdW1uTmFtZSA9PT0gJ01ldHJpY2EnICYmIHR4dC5pbmNsdWRlcygnVE9UQUwgQmFja29yZGVyJykpIHx8XG4gICAgICAgICAgKGNvbHVtbk5hbWUgPT09ICdDbGllbnRlJyAmJiB0eHQuaW5jbHVkZXMoJ1RPVEFMJykpXG4gICAgICAgICkge1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gICAgICAgICAgY2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGOTkxQjFCJyB9IH07IC8vIHJlZC04MDBcbiAgICAgICAgfVxuICAgICAgICAvLyBDZWxkYXMgZGUgbGEgTUlTTUEgRklMQSBUT1RBTCAobG9zIG51bWVyb3MpXG4gICAgICAgIGlmIChyb3dJbmRleCA9PT0gMCAmJiBjb2x1bW5OYW1lID09PSAnVmFsb3InKSB7XG4gICAgICAgICAgY2VsbC5mb250ID0geyBib2xkOiB0cnVlIH07XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfVxuICApO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArXG4gICAgICAocm93cy5sZW5ndGggLSAxKSArXG4gICAgICAnIGxpbmVhcyArIFJlc3VtZW4gY29uIHRvdGFsICQnICtcbiAgICAgIE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAnKScsXG4gICAgMzAwMFxuICApO1xufTtcblxuLy8gdjczNzogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG8gZWwgU3RvY2sgQXNpZ25hZG8gKHNpbiBmaWx0cm8gZGUgbWVzKS4gTWlzbW9cbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxud2luZG93LmV4cG9ydFN0b2NrQXNpZ0FsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8gKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjExMDAgKDIwMjYtMDktMzApOiBtaXNtbyBtXHUwMEYzZHVsbyBwdXJvIHF1ZSByZW5kZXJCYWNrb3JkZXJzVGFiIGVuIG1vZG9cbiAgLy8gYXNpZ25hY2lvbi4gQWhvcmEgZWwgcmVwb3J0ZSBjb2luY2lkZSBjb24gZWwgbW9kYWw6IEZJRk8gY2FwIHBvciBkaXNwU2FwLFxuICAvLyBmaWx0cm8gdmVuY2lkYXMgKEFTSUcgPjE1ZCBmdWVyYSwgQVNJRyBzaW4gcmVzZXJ2YSB2aWdlbnRlIGFkZW50cm8pLFxuICAvLyBjb25maXJtZWQgaW5jbHVpZG8sIHNpbiBsXHUwMEVEbmVhcyBcInZpcnR1YWxfQVNJR1wiIGZhbnRhc21hLlxuICBjb25zdCBhcnIgPVxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIGFycixcbiAgICAgICAgJ2FzaWduYWNpb24nLFxuICAgICAgICB7fSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBhcnIpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxdHkgPSBjLnF0eUFzaWduYWRhIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xuICAgIH1cbiAgICAvLyBFc3RhZG9fUmVhbDogaGlzdFx1MDBGM3JpY28gXCJCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRylcIiB2cyBcIkFTSUdcIi4gdjExMDA6XG4gICAgLy8gYWhvcmEgYGNvbmZpcm1lZGAgdGFtYmlcdTAwRTluIGVudHJhICh2OTYyKS4gUHJlc2VydmFtb3MgZXRpcXVldGEgbGVnYWN5XG4gICAgLy8gcG9yIGNvbXBhdGliaWxpZGFkIGNvbiBxdWllbiBjb25zdW1lIGVsIEV4Y2VsLlxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcbiAgICAgIE9yaWdlbjogKHAgJiYgcC5taWdyYXRpb25Tb3VyY2UpIHx8ICdhcHAnLFxuICAgICAgLy8gdjExMDA6IGNvbnRleHRvIFx1MDBGQXRpbCBwYXJhIGRlYnVnZ2luZyBwYXJpZGFkIG1vZGFsXHUyMTk0cmVwb3J0ZS5cbiAgICAgIFN0b2NrX0Rpc3BfU0tVOiBybC5kaXNwU2FwIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydChcbiAgICAgICdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xuICAgICAgICBhcnIubGVuZ3RoICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcbiAgICAgICAgdG90YWxQZWRpZG9zT3BlbiArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gTGluZWFzIHBvc3QtRklGTyt2ZW5jaWRhcyBjb24gcXR5QXNpZ25hZGE+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IHN0b2NrIGFzaWduYWRvIGFob3JhIG1pc21vXFxuJyArXG4gICAgICAgICcyLiBUb2RvcyBsb3MgQVNJRyBlc3RhbiB2ZW5jaWRvcyAoPjE1ZCBkZXNkZSBhc2lnQXQpXFxuJyArXG4gICAgICAgICczLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbydcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZzogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufTtcblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBudWV2byBleHBvcnQgXCJQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG9cIi4gTGlzdGFcbi8vIGxvcyByZXBhcnRvcyBhYmllcnRvcyAoaW5ncmVzb3NfcmVwYXJ0byBwZW5kaW5nL2luX3Byb2dyZXNzKSBwb3IgU0tVICtcbi8vIGNsaWVudGVzIGVuIGNvbGEuIFJlZW1wbGF6YSBzZW1cdTAwRTFudGljYW1lbnRlIGFsIHZpZWpvIFwiU3RvY2sgQXNpZ25hZG9cIiBlbiBlbFxuLy8gbW9kYWwgKGVsIHZpZWpvIHBhc2EgYSBcIlN0b2NrIEFzaWduYWRvIC0gbFx1MDBFRG5lYXNcIiBjb21vIGF1eGlsaWFyKS5cbi8vIERvcyBob2phczpcbi8vICAgUmVzdW1lbiByZXBhcnRvIFx1MjAxNCB1bmEgZmlsYSBwb3IgZG9jIGluZ3Jlc29zX3JlcGFydG8uXG4vLyAgIENsaWVudGVzIGVuIGNvbGEgXHUyMDE0IHVuYSBmaWxhIHBvciBjbGllbnRlIEJPIGRlIGNhZGEgcmVwYXJ0by5cbndpbmRvdy5leHBvcnRQZW5kaWVudGVEZUFzaWduYWNpb25QYWJsbyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgUGVuZGllbnRlIGRlIEFzaWduYWNpXHUwMEYzbiAtIFBhYmxvLi4uJyk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBmYkRiID0gdy5mYkRiO1xuICBpZiAoIWZiRGIpIHtcbiAgICBhbGVydCgnRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkby4gUmVpbnRlbnRcdTAwRTEgZW4gdW5vcyBzZWd1bmRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMS4gUmVwYXJ0b3MgYWJpZXJ0b3MuXG4gIGxldCByZXBhcnRvc0RvY3M7XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdpbmdyZXNvc19yZXBhcnRvJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJ2luJywgWydwZW5kaW5nJywgJ2luX3Byb2dyZXNzJ10pXG4gICAgICAuZ2V0KCk7XG4gICAgcmVwYXJ0b3NEb2NzID0gc25hcC5kb2NzO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGNhcmdhbmRvIGluZ3Jlc29zX3JlcGFydG86ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFyZXBhcnRvc0RvY3MgfHwgcmVwYXJ0b3NEb2NzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVwYXJ0b3MgcGVuZGluZy9pbl9wcm9ncmVzcyBhaG9yYSBtaXNtby4nKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFBhYmxvOiAwIHJlcGFydG9zJywgMjQwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIDIuIFNuYXBzaG90IHN0b2NrICsgZ2V0U3RvY2tCcmVha2Rvd24gcG9yIFNLVS5cbiAgY29uc3Qgc3RvY2tTbmFwID1cbiAgICB0eXBlb2Ygdy5nZXRTdG9ja1NuYXBzaG90ID09PSAnZnVuY3Rpb24nXG4gICAgICA/IHcuZ2V0U3RvY2tTbmFwc2hvdCgpXG4gICAgICA6IHcuX3N0b2NrU25hcHNob3RDYWNoZSB8fCB7IHdhcmVob3VzZUJyZWFrZG93bjoge30gfTtcbiAgY29uc3Qgd2hzID1cbiAgICB0eXBlb2Ygc3RvY2tTbmFwLndhcmVob3VzZUJyZWFrZG93biA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duKVxuICAgICAgOiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duIHx8IHt9O1xuICBjb25zdCBwZWRpZG9zID0gQXJyYXkuaXNBcnJheSh3Lmdsb2JhbFBlZGlkb3MpID8gdy5nbG9iYWxQZWRpZG9zIDogW107XG4gIGNvbnN0IHdhaXRsaXN0RW50cmllcyA9XG4gICAgdHlwZW9mIHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMgPT09ICdmdW5jdGlvbicgPyB3Ll9nZXRXYWl0bGlzdENwc3RFbnRyaWVzKCkgOiBbXTtcbiAgY29uc3QgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyA9IHJlcGFydG9zRG9jcy5tYXAoKGQpID0+XG4gICAgT2JqZWN0LmFzc2lnbih7IF9mc0lkOiBkLmlkIH0sIGQuZGF0YSgpIHx8IHt9KVxuICApO1xuICBjb25zdCBnZXRCcmVha2Rvd24gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuZ2V0U3RvY2tCcmVha2Rvd247XG4gIC8vIDMuIFJlc29sdmVyIHByb2R1Y3RvIHBvciBTS1UuXG4gIGNvbnN0IHByb2RCeVNrdSA9IG5ldyBNYXAoKTtcbiAgY29uc3QgUFJPRFVDVFMgPSBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdO1xuICBmb3IgKGNvbnN0IHAgb2YgUFJPRFVDVFMpIHtcbiAgICBpZiAocCAmJiBwLnNrdSkgcHJvZEJ5U2t1LnNldChTdHJpbmcocC5za3UpLnRvVXBwZXJDYXNlKCksIHApO1xuICB9XG4gIGNvbnN0IG5vd01zID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXTtcbiAgY29uc3QgY29sYVJvd3MgPSBbXTtcbiAgZm9yIChjb25zdCBkb2Mgb2YgcmVwYXJ0b3NEb2NzKSB7XG4gICAgY29uc3QgZGF0YSA9IGRvYy5kYXRhKCkgfHwge307XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKGRhdGEuc2t1IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IHByb2QgPSBwcm9kQnlTa3UuZ2V0KHNrdSkgfHwgbnVsbDtcbiAgICBjb25zdCBmaXNpY29EZXAxMSA9IE51bWJlcigod2hzW3NrdV0gJiYgd2hzW3NrdV1bJzExJ10pIHx8IDApO1xuICAgIGNvbnN0IHF0eUluZ3Jlc2FkYSA9IE51bWJlcihkYXRhLnF0eUluZ3Jlc2FkYSB8fCAwKTtcbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IEFycmF5LmlzQXJyYXkoZGF0YS5hc3NpZ25tZW50cykgPyBkYXRhLmFzc2lnbm1lbnRzIDogW107XG4gICAgbGV0IHF0eVlhQXNpZ25hZGEgPSAwO1xuICAgIGZvciAoY29uc3QgYSBvZiBhc3NpZ25tZW50cykgcXR5WWFBc2lnbmFkYSArPSBOdW1iZXIoKGEgJiYgYS5xdHlBc2lnbmFkYSkgfHwgMCk7XG4gICAgbGV0IHF0eUFSZXBhcnRpciA9IE1hdGgubWF4KDAsIHF0eUluZ3Jlc2FkYSAtIHF0eVlhQXNpZ25hZGEpO1xuICAgIGlmIChnZXRCcmVha2Rvd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJrID0gZ2V0QnJlYWtkb3duKFxuICAgICAgICAgIHNrdSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBnZXRTdG9ja0Zpc2ljbzogKCkgPT4gZmlzaWNvRGVwMTEsXG4gICAgICAgICAgICBwZWRpZG9zLFxuICAgICAgICAgICAgd2FpdGxpc3RFbnRyaWVzLFxuICAgICAgICAgICAgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgbm93OiBub3dNcyB9XG4gICAgICAgICk7XG4gICAgICAgIGlmIChiayAmJiBiay5yZXBhcnRvQWJpZXJ0byAmJiB0eXBlb2YgYmsucmVwYXJ0b0FiaWVydG8ucXR5ID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIHF0eUFSZXBhcnRpciA9IGJrLnJlcGFydG9BYmllcnRvLnF0eTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgLyogZmFsbGJhY2sgYSBjXHUwMEUxbGN1bG8gbG9jYWwgKi9cbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY2xpZW50ZXNCTyA9IEFycmF5LmlzQXJyYXkoZGF0YS5jbGllbnRlc0JPKSA/IGRhdGEuY2xpZW50ZXNCTyA6IFtdO1xuICAgIGxldCBkZXRlY3RlZEF0ID0gZGF0YS5kZXRlY3RlZEF0IHx8ICcnO1xuICAgIGlmIChkZXRlY3RlZEF0ICYmIHR5cGVvZiBkZXRlY3RlZEF0LnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9IGRldGVjdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIGRldGVjdGVkQXQgPSAnJztcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgYm9Ub3RhbFF0eSA9IGNsaWVudGVzQk8ucmVkdWNlKChzLCBjKSA9PiBzICsgTnVtYmVyKGMucXR5QmFja29yZGVyIHx8IDApLCAwKTtcbiAgICByZXN1bWVuUm93cy5wdXNoKHtcbiAgICAgIFJlcGFydG9fSUQ6IGRvYy5pZCxcbiAgICAgIFNLVTogc2t1LFxuICAgICAgUHJvZHVjdG86IChwcm9kICYmIChwcm9kLm5hbWUgfHwgcHJvZC5kZXNjcmlwdGlvbikpIHx8ICcnLFxuICAgICAgRmlzaWNvX0RlcDExOiBmaXNpY29EZXAxMSxcbiAgICAgIFF0eV9JbmdyZXNhZGE6IHF0eUluZ3Jlc2FkYSxcbiAgICAgIFF0eV9ZYV9Bc2lnbmFkYTogcXR5WWFBc2lnbmFkYSxcbiAgICAgIFF0eV9BX1JlcGFydGlyOiBxdHlBUmVwYXJ0aXIsXG4gICAgICBDbGllbnRlc19Fbl9Db2xhOiBjbGllbnRlc0JPLmxlbmd0aCxcbiAgICAgIEJPX1RvdGFsX1F0eTogYm9Ub3RhbFF0eSxcbiAgICAgIERldGVjdGVkQXQ6IHR5cGVvZiBkZXRlY3RlZEF0ID09PSAnc3RyaW5nJyA/IGRldGVjdGVkQXQuc2xpY2UoMCwgMTkpLnJlcGxhY2UoJ1QnLCAnICcpIDogJycsXG4gICAgICBTdGF0dXM6IGRhdGEuc3RhdHVzIHx8ICcnLFxuICAgIH0pO1xuICAgIGZvciAoY29uc3QgYyBvZiBjbGllbnRlc0JPKSB7XG4gICAgICBsZXQgZmVjaGFQZWQgPSBjLnBlZGlkb0NyZWF0ZWRBdCB8fCAnJztcbiAgICAgIGlmIChmZWNoYVBlZCAmJiB0eXBlb2YgZmVjaGFQZWQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSBmZWNoYVBlZC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAgIGZlY2hhUGVkID0gJyc7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFZlbmRlZG9yOiBidXNjYXIgZW4gZ2xvYmFsUGVkaWRvcyBwb3IgcGVkaWRvSWQuXG4gICAgICBsZXQgdmVuZGVkb3IgPSBjLnZlbmRvcktleSB8fCAnJztcbiAgICAgIGlmICghdmVuZGVkb3IgJiYgYy5wZWRpZG9JZCkge1xuICAgICAgICBjb25zdCBwID0gcGVkaWRvcy5maW5kKCh4KSA9PiB4ICYmIHguX2ZzSWQgPT09IGMucGVkaWRvSWQpO1xuICAgICAgICBpZiAocCkgdmVuZGVkb3IgPSBwLm93bmVyVmVuZG9yIHx8IHAudmVuZG9yQXNzaWduZWQgfHwgJyc7XG4gICAgICB9XG4gICAgICBjb2xhUm93cy5wdXNoKHtcbiAgICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgICBTS1U6IHNrdSxcbiAgICAgICAgQ2xpZW50ZTogYy5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDYXJkQ29kZTogYy5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBjLmNsaWVudFByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IGMuY2xpZW50TG9jYWxpdHkgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcbiAgICAgICAgUXR5X0JPOiBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksXG4gICAgICAgIEZlY2hhX1BlZGlkb19PcmlnaW5hbDogdHlwZW9mIGZlY2hhUGVkID09PSAnc3RyaW5nJyA/IGZlY2hhUGVkLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmVzdW1lblJvd3Muc29ydCgoYSwgYikgPT4gYi5RdHlfQV9SZXBhcnRpciAtIGEuUXR5X0FfUmVwYXJ0aXIpO1xuICBjb2xhUm93cy5zb3J0KFxuICAgIChhLCBiKSA9PlxuICAgICAgKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSB8fFxuICAgICAgKGEuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKVxuICApO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVuZGllbnRlRGVBc2lnbmFjaW9uX1BhYmxvXycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1Jlc3VtZW4gcmVwYXJ0bycsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgeyBuYW1lOiAnQ2xpZW50ZXMgZW4gY29sYScsIHJvd3M6IGNvbGFSb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IFBhYmxvOiAnICsgcmVzdW1lblJvd3MubGVuZ3RoICsgJyByZXBhcnRvcyAvICcgKyBjb2xhUm93cy5sZW5ndGggKyAnIGNsaWVudGVzIGVuIGNvbGEnLFxuICAgIDI4MDBcbiAgKTtcbn07XG5cbi8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXN1ZWx2ZSBub21icmUgZGUgZmFudGFzaWEgcGFyYSB1biBwZWRpZG8gdXNhbmRvIGVsXG4vLyBtaXNtbyBwYXR0ZXJuIHF1ZSBsYXMgY2FyZHMgZGVsIG1hcGEgKGluZGV4Lmh0bWw6OTkxNS05OTM1KTpcbi8vICAgMSkgY2xpZW50TWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWEgKGVkaXRhZG8gZGVzZGUgZWwgbW9kYWwgY2xpZW50ZSlcbi8vICAgMikgYXBwcm92ZWRBbHRhc0xpc3RbXS5mYW50YXNpYSBtYXRjaGVhZG8gcG9yIGNvbWVyY2lvID09IGNsaWVudE5hbWVcbmZ1bmN0aW9uIF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCkge1xuICBjb25zdCBjYXJkQ29kZSA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gIGlmIChjYXJkQ29kZSkge1xuICAgIGNvbnN0IG1ldGEgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmNsaWVudE1ldGE7XG4gICAgY29uc3QgY3VzdG9tID0gbWV0YSAmJiBtZXRhW2NhcmRDb2RlXSAmJiBtZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYTtcbiAgICBpZiAoY3VzdG9tICYmIFN0cmluZyhjdXN0b20pLnRyaW0oKSkgcmV0dXJuIFN0cmluZyhjdXN0b20pLnRyaW0oKTtcbiAgfVxuICBjb25zdCBhbHRhcyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuYXBwcm92ZWRBbHRhc0xpc3Q7XG4gIGlmIChBcnJheS5pc0FycmF5KGFsdGFzKSkge1xuICAgIGNvbnN0IG5hbWVMb3dlciA9IFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpXG4gICAgICAudHJpbSgpXG4gICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobmFtZUxvd2VyKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IHtcbiAgICAgICAgaWYgKCFhKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGNvbnN0IGMgPSBTdHJpbmcoYS5jb21lcmNpbyB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGYgPSBTdHJpbmcoYS5mYW50YXNpYSB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIHJldHVybiBjID09PSBuYW1lTG93ZXIgfHwgZiA9PT0gbmFtZUxvd2VyO1xuICAgICAgfSk7XG4gICAgICBpZiAobWF0Y2ggJiYgbWF0Y2guZmFudGFzaWEgJiYgU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhtYXRjaC5mYW50YXNpYSkudHJpbSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gJyc7XG59XG5cbi8vIHYxMjMzICgyMDI2LTEwLTA5KTogcmVwb3J0ZSBcIlZlbnRhcyB4IGFydGljdWxvIHggY2xpZW50ZS92ZW5kZWRvclwiIHZpYSBDRi5cbi8vIEFkbWluL2dlcmVudGUgb25seS4gVGFyZGEgfjMwLTYwcyAoQlEgcXVlcnkgKyBleGNlbGpzIGJ1aWxkIHNlcnZlci1zaWRlKS5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0FydENsaUZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgYWxlcnQoJ0VsZWdcdTAwRUQgdW4gTUVTIGVzcGVjXHUwMEVEZmljbyAobm8gXCJUb2RvIGVsIGFcdTAwRjFvXCIpIFx1MjAxNCBlc3RlIHJlcG9ydGUgZXMgbWVuc3VhbC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gbW9udGhJZHggdmllbmUgMC1iYXNlZCBkZXNkZSBlbCBwaWNrZXIgKGVuZT0wKS4gQ0YgZXNwZXJhIDEtYmFzZWQuXG4gIGNvbnN0IG1vbnRoID0gbW9udGhJZHggKyAxO1xuICBjb25zdCB5ZWFyID0gYW5pbztcbiAgY29uc3QgcGVyaW9kbyA9ICh3aW5kb3cuTUVTRVMgPyB3aW5kb3cuTUVTRVNbbW9udGhJZHhdIDogbW9udGgpICsgJyAnICsgeWVhcjtcbiAgY29uc3QgY29uZmlybU1zZyA9XG4gICAgJ0dlbmVyYXIgcmVwb3J0ZSBcIlZFTlRBUyB4IEFSVElDVUxPIHggQ0xJRU5URS9WRU5ERURPUlwiIGRlICcgK1xuICAgIHBlcmlvZG8gK1xuICAgICc/XFxuXFxuJyArXG4gICAgJ0Z1ZW50ZTogU0FQIHZpYSBCaWdRdWVyeSAoZGF0b3MgZXhhY3RvcykuXFxuJyArXG4gICAgJ1B1ZWRlIHRhcmRhciAzMC02MCBzZWd1bmRvcy5cXG4nICtcbiAgICAnQWwgdGVybWluYXIgc2UgZGVzY2FyZ2EgYXV0b21hdGljYW1lbnRlIGVsIHhsc3guJztcbiAgaWYgKCFjb25maXJtKGNvbmZpcm1Nc2cpKSByZXR1cm47XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gcmVwb3J0ZSBzZXJ2ZXItc2lkZSAoQlEpLi4uIHB1ZWRlIHRhcmRhciB+NjBzJyk7XG4gIHRyeSB7XG4gICAgLy8gdjEwMDAgcGF0dGVybjogcmVmcmVzaCBJRFRva2VuIGFudGVzIGRlIGNhbGxhYmxlIGNyaXRpY28uXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHUgPSB3aW5kb3cuZmlyZWJhc2UuYXV0aCAmJiB3aW5kb3cuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgICAgaWYgKHUgJiYgdS5nZXRJZFRva2VuKSBhd2FpdCB1LmdldElkVG9rZW4odHJ1ZSk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgY29uc3QgY2FsbGFibGUgPSB3aW5kb3cuZmlyZWJhc2VcbiAgICAgIC5hcHAoKVxuICAgICAgLmZ1bmN0aW9ucygnc291dGhhbWVyaWNhLWVhc3QxJylcbiAgICAgIC5odHRwc0NhbGxhYmxlKCdnZW5lcmF0ZVZlbnRhc1JlcG9ydENGJyk7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IGNhbGxhYmxlKHsgeWVhciwgbW9udGggfSk7XG4gICAgY29uc3QgciA9IChyZXNwICYmIHJlc3AuZGF0YSkgfHwge307XG4gICAgaWYgKCFyLm9rIHx8ICFyLmJ5dGVzQmFzZTY0KSB7XG4gICAgICBhbGVydCgnQ0YgZGV2b2x2aW8gZXJyb3I6ICcgKyAoci5lcnJvciB8fCBKU09OLnN0cmluZ2lmeShyKSkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBEZWNvZGUgYmFzZTY0IFx1MjE5MiBCbG9iIFx1MjE5MiBkb3dubG9hZCB0cmlnZ2VyLlxuICAgIGNvbnN0IGJpbiA9IGF0b2Ioci5ieXRlc0Jhc2U2NCk7XG4gICAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW4ubGVuZ3RoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbi5sZW5ndGg7IGkrKykgYnl0ZXNbaV0gPSBiaW4uY2hhckNvZGVBdChpKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J5dGVzXSwge1xuICAgICAgdHlwZTogci5taW1lVHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9XG4gICAgICByLmZpbGVuYW1lIHx8XG4gICAgICAndmVudGFzX3hfYXJ0aWN1bG9fY2xpZW50ZV8nICsgeWVhciArICctJyArIFN0cmluZyhtb250aCkucGFkU3RhcnQoMiwgJzAnKSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gICAgICBhLnJlbW92ZSgpO1xuICAgIH0sIDEwMDApO1xuICAgIGNvbnN0IHN0YXRzID0gci5zdGF0cyB8fCB7fTtcbiAgICBzaG93U3luY1RhZyhcbiAgICAgICdPSzogJyArXG4gICAgICAgIChzdGF0cy52ZW50YXMgfHwgMCkgK1xuICAgICAgICAnIHZlbnRhcyAvICcgK1xuICAgICAgICAoc3RhdHMuaXRlbXMgfHwgMCkgK1xuICAgICAgICAnIFNLVXMgLyAnICtcbiAgICAgICAgKHN0YXRzLmNsaWVudHMgfHwgMCkgK1xuICAgICAgICAnIGNsaWVudGVzJ1xuICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbZXhwb3J0VmVudGFzQXJ0Q2xpXSBlcnJvcicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgcmVwb3J0ZTogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSkpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBQZWRpZG9zIGRlbCBtZXMuLi4nKTtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcbiAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXG4gICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgOiAnJztcbiAgICAvLyB2OTc1ICgyMDI2LTA5LTE3KTogcmVzb2x2ZXIgZmFudGFzaWEgdW5hIHZleiBwb3IgcGVkaWRvIChubyBwb3IgbGluZWEpIFx1MjAxNFxuICAgIC8vIGVsIGxvb2t1cCBlbiBjbGllbnRNZXRhICsgYXBwcm92ZWRBbHRhc0xpc3QgZXMgY29uc3RhbnRlIHBhcmEgdG9kbyBlbCBwZWRpZG8uXG4gICAgY29uc3Qgbm9tYnJlTG9jYWxGYW50YXNpYSA9IF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCk7XG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XG4gICAgICBpZiAoIWwpIHJldHVybjtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKTtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGEsXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgTm9tYnJlX0xvY2FsX0ZhbnRhc2lhOiBub21icmVMb2NhbEZhbnRhc2lhLFxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgQ2FudGlkYWRfT3BlbjogTnVtYmVyKGwucXR5T3BlbikgfHwgMCxcbiAgICAgICAgQ2FudGlkYWRfSW52b2ljZWQ6IE51bWJlcihsLnF0eUludm9pY2VkKSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9DYW5jZWxsZWQ6IE51bWJlcihsLnF0eUNhbmNlbGxlZCkgfHwgMCxcbiAgICAgICAgRXN0YWRvX0xpbmVhOiBsLnN0YXRlIHx8ICcnLFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKHF0eSAqIHByZWNpbyksXG4gICAgICAgIENlcnJhZG86IHAuY2xvc2VkQXQgPyAnU0knIDogJ05PJyxcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcbiAgICAgICAgU1FfRG9jTnVtOiBwLnRyYW5zZmVyaWRvU0FQID8gcC50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gfHwgJycgOiAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuRmVjaGFfUGVkaWRvIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGFfUGVkaWRvIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVkaWRvc0RlbE1lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnUGVkaWRvcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFBlZGlkb3MgZGVsIG1lcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbi8vIEV4cG9ydGFyIHBhcmEgQW5hbGlzaXM6IHByb3RlZ2lkbyBjb24gUElOXG5jb25zdCBBTkFMSVNJU19QSU4gPSAnMTIzNSc7XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4cG9ydCBFeGNlbCBUQVJHRVRTLVpPTkFTIC0gc29sbyBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVBcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIGxhIGhvamEgQ0xJRU5URVNfWk9OQVMgY29uIFVOQSBmaWxhIHBvciBCUCBxdWUgZXN0YSB2aXZvIGVuIFNBUDpcbi8vIGN1YWxxdWllciBhbHRhIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgY29uIHN0YXR1cz0nYXBwcm92ZWQnIFkgY2FyZENvZGVTYXBcbi8vIGFzaWduYWRvLiBFeGNsdXllIFBPSU5UUyAvIGRpc3RyaWJ1aWRvcmVzIC8gcHJvc3BlY3RvcyAvIGFsdGFzIHNpblxuLy8gQ2FyZENvZGUgKG1vY2tzIG8gcGVuZGllbnRlcyBkZSBTQVApLiBFcyBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBmYWN0dXJhLlxuLy8gQ29sdW1uYXM6IFRJUE8sIE5STyBDVEUsIFJFR0lPTiwgUFJPVklOQ0lBLCBBU0VTT1IgRVhURVJOTywgQVNFU09SIElOVEVSTk8sXG4vLyBDQUxMRSwgTlVNRVJPLCBMT0NBTElEQUQsIENQLCBOT01CUkUgQ09NRVJDSUFMLCBOT01CUkUgREUgRkFOVEFTSUEsIENVSVQsXG4vLyBDT05ESUNJT04gRklTQ0FMLCBURUxFRk9OTywgQ0FSRENPREUgU0FQLlxud2luZG93LmV4cG9ydFRhcmdldHNab25hcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpY1x1MDBFMSB0dSBjb25leGlcdTAwRjNuIHkgcmVpbnRlbnRcdTAwRTEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGV4cG9ydGFyIGVsIG1hc3Rlci4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBUQVJHRVRTLVpPTkFTLi4uJyk7XG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gcmVnaW9uT2YocHJvdikge1xuICAgIGNvbnN0IHAgPSAocHJvdiB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICBpZiAoWydCVUVOT1MgQUlSRVMnLCAnQ0FQSVRBTCBGRURFUkFMJywgJ0xBIFBBTVBBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQlVFTk9TIEFJUkVTJztcbiAgICBpZiAoWydDT1JET0JBJywgJ1NBTiBMVUlTJywgJ01FTkRPWkEnLCAnU0FOIEpVQU4nLCAnTEEgUklPSkEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdDVVlPJztcbiAgICBpZiAoWydTQU5UQSBGRScsICdFTlRSRSBSSU9TJywgJ0NIQUNPJywgJ0NPUlJJRU5URVMnLCAnTUlTSU9ORVMnLCAnRk9STU9TQSddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdORUEnO1xuICAgIGlmIChbJ0pVSlVZJywgJ1NBTFRBJywgJ1RVQ1VNQU4nLCAnQ0FUQU1BUkNBJywgJ1NBTlRJQUdPIERFTCBFU1RFUk8nXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdOT0EnO1xuICAgIGlmIChbJ05FVVFVRU4nLCAnUklPIE5FR1JPJywgJ0NIVUJVVCcsICdTQU5UQSBDUlVaJywgJ1RJRVJSQSBERUwgRlVFR08nXS5pbmNsdWRlcyhwKSlcbiAgICAgIHJldHVybiAnUEFUQUdPTklBJztcbiAgICByZXR1cm4gJyc7XG4gIH1cbiAgZnVuY3Rpb24gdmVuZG9yTGFiZWxGb3JFeGNlbChrZXkpIHtcbiAgICBpZiAoIWtleSkgcmV0dXJuICcnO1xuICAgIGlmIChrZXkgPT09ICdfX0RJU1RSSUJVVE9SX18nKSByZXR1cm4gJ0RJU1RSSUJVSURPUkVTJztcbiAgICByZXR1cm4ga2V5O1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgbGV0IGFsdGFzU25hcDtcbiAgdHJ5IHtcbiAgICBhbHRhc1NuYXAgPSBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9PScsICdhcHByb3ZlZCcpXG4gICAgICAuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhcyBhcHJvYmFkYXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IHNraXBwZWROb1NhcCA9IDA7XG4gIGFsdGFzU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICAvLyBGaWx0cm8gY2xhdmU6IHNvbG8gQlBzIGNvbiBDYXJkQ29kZSBTQVAgYXNpZ25hZG8gKD0gaGFiaWxpdGFkbyBlbiBTQVApLlxuICAgIGlmICghY2FyZENvZGUpIHtcbiAgICAgIHNraXBwZWROb1NhcCsrO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBwcm92aW5jZSA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9VcHBlckNhc2UoKS50cmltKCk7XG4gICAgY29uc3QgbG9jYWxpdHlGaW5hbCA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgVElQTzogJ0RBRE8gREUgQUxUQScsXG4gICAgICAnTlJPIENURSc6IDAsIC8vIHNlIHJlbnVtZXJhIGRlc3B1ZXMgZGVsIHNvcnRcbiAgICAgIFJFR0lPTjogcmVnaW9uT2YocHJvdmluY2UpLFxuICAgICAgUFJPVklOQ0lBOiBwcm92aW5jZSxcbiAgICAgICdBU0VTT1IgRVhURVJOTyc6IHZlbmRvckxhYmVsRm9yRXhjZWwodmVuZG9yKSxcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcbiAgICAgIENBTExFOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTlVNRVJPOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExPQ0FMSURBRDogbG9jYWxpdHlGaW5hbCxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgJ05PTUJSRSBDT01FUkNJQUwnOiBhLmNvbWVyY2lvIHx8IGEudGl0dWxhciB8fCAnJyxcbiAgICAgICdOT01CUkUgREUgRkFOVEFTSUEnOiBhLmZhbnRhc2lhIHx8ICcnLFxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxuICAgICAgJ0NPTkRJQ0lPTiBGSVNDQUwnOiBhLmNvbmRpY2lvbkZpc2NhbCB8fCAnJyxcbiAgICAgIFRFTEVGT05POiBhLnRlbGVmb25vIHx8ICcnLFxuICAgICAgJ0NBUkRDT0RFIFNBUCc6IGNhcmRDb2RlLFxuICAgIH0pO1xuICB9KTtcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVAgdG9kYXZpYS5cXG5cXG5VbmEgYWx0YSBlbnRyYSBhbCBleHBvcnQgc29sbyBjdWFuZG8gdGllbmUgQ2FyZENvZGUgU0FQIGFzaWduYWRvLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKHIxLCByMikgPT4ge1xuICAgIGNvbnN0IHAgPSAocjEuUFJPVklOQ0lBIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLlBST1ZJTkNJQSB8fCAnJyk7XG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xuICAgIGNvbnN0IGwgPSAocjEuTE9DQUxJREFEIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLkxPQ0FMSURBRCB8fCAnJyk7XG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcbiAgfSk7XG4gIHJvd3MuZm9yRWFjaCgociwgaSkgPT4ge1xuICAgIHJbJ05STyBDVEUnXSA9IGkgKyAxO1xuICB9KTtcbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCAoZXN0aWxvIHZlcmRlIHVuaWZvcm1lKS5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBhd2FpdCBkb3dubG9hZFhsc3goJ1RBUkdFVFNfVkVOREVET1JFU19aT05BU18nICsgdHMgKyAnLnhsc3gnLCBbXG4gICAgeyBuYW1lOiAnQ0xJRU5URVNfWk9OQVMnLCByb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhjZWwgZXhwb3J0YWRvOiAnICtcbiAgICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgU0FQIGhhYmlsaXRhZG9zJyArXG4gICAgICAoc2tpcHBlZE5vU2FwID4gMCA/ICcgKCcgKyBza2lwcGVkTm9TYXAgKyAnIHNpbiBDYXJkQ29kZSBkZXNjYXJ0YWRvcyknIDogJycpXG4gICk7XG59O1xuXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcGluID0gcHJvbXB0KFxuICAgICdFc3RhIHNlY2Npb24gY29udGllbmUgZm9ybWF0b3MgYXZhbnphZG9zIChQb3dlciBCSSwgUHl0aG9uL01MLCBaSVAgZGUgZm90b3MpIGRlc3RpbmFkb3MgYSBhbmFsaXNpcyB0ZWNuaWNvLlxcblxcbkluZ3Jlc2EgZWwgUElOIHBhcmEgY29udGludWFyOidcbiAgKTtcbiAgaWYgKHBpbiA9PT0gbnVsbCkgcmV0dXJuO1xuICBpZiAocGluICE9PSBBTkFMSVNJU19QSU4pIHtcbiAgICBhbGVydCgnUElOIGluY29ycmVjdG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE9wY2lvbiBJbnRlZ3JhY2lvbiBTQVA6IHNvbG8gcGFyYSBNYXJpYW5vIChlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSlcbiAgY29uc3Qgc2FwT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtc2FwLWludGVncmF0aW9uJyk7XG4gIGlmIChzYXBPcHQpIHtcbiAgICBjb25zdCBpc01hcmlhbm8gPVxuICAgICAgY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nO1xuICAgIHNhcE9wdC5zdHlsZS5kaXNwbGF5ID0gaXNNYXJpYW5vID8gJycgOiAnbm9uZSc7XG4gIH1cbiAgLy8gT3BjaW9uIEJhY2t1cCBtZW5zdWFsOiBzb2xvIGFkbWluXG4gIGNvbnN0IGJrT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtYmFja3VwLW1lbnN1YWwnKTtcbiAgaWYgKGJrT3B0KSBia09wdC5zdHlsZS5kaXNwbGF5ID0gdXNlclJvbGUgPT09ICdhZG1pbicgPyAnJyA6ICdub25lJztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VFeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXG4vLyBIZWxwZXJzIGludGVybm9zIChkb3dubG9hZFhsc3gsIGV4cG9ydFZlbnRhc0Zvck1vbnRoLCBldGMuKSBzb24gY29uc3VtaWRvc1xuLy8gc29sbyBkZW50cm8gZGUgZXN0ZSBibG9xdWUgKHZlcmlmaWNhZG8gcHJlLWV4dHJhY2NpXHUwMEYzbikuXG5cbi8vIHYxMzk2ICgyMDI2LTEwLTIxKTogYXZpc28gYWwgY2xpY2sgcGFyYSBcIlZlbnRhcyBcdTAwRDcgYXJ0XHUwMEVEY3VsbyBcdTAwRDcgY2xpZW50ZVwiLlxuLy8gQWRtaW4vZ2VyZW50ZSBvbmx5LiBUYXJkYSAzMC02MHMuIEFudGVzIGxhIG5vdGEgZXN0YWJhIGVuIGxhIGRlc2NyaXBjaVx1MDBGM24gZGVsXG4vLyBsaXN0YWRvIGRlbCBtb2RhbDsgYWhvcmEgZWwgbGlzdGFkbyBzb2xvIG11ZXN0cmEgaWNvbm8gKyB0aXR1bG8uXG53aW5kb3cuX3ZlbnRhc0FydENsaUNsaWNrID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3Qgcm9sZSA9IHcudXNlclJvbGUgfHwgJyc7XG4gIGlmIChyb2xlICE9PSAnYWRtaW4nICYmIHJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdFc3RlIHJlcG9ydGUgZXMgc29sbyBwYXJhIGFkbWluIC8gZ2VyZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgb2sgPSBjb25maXJtKFxuICAgICdSZXBvcnRlIHNlcnZlci1zaWRlIChCaWdRdWVyeSkuIFRhcmRhIDMwLTYwIHNlZ3VuZG9zIHkgZGVzY2FyZ2EgdW4gLnhsc3ggY29uIDQgaG9qYXM6XFxuJyArXG4gICAgICAnICBcdTIwMjIgUHJvZHVjdG9zIHZlbmRpZG9zIHBvciBWREVcXG4nICtcbiAgICAgICcgIFx1MjAyMiBQcm9kdWN0b3MgTk8gdmVuZGlkb3MgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIENsaWVudGVzIENPTiBjb21wcmEgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIENsaWVudGVzIFNJTiBjb21wcmEgcG9yIFZERVxcblxcbicgK1xuICAgICAgJ0NvbnRpbnVhcj8nXG4gICk7XG4gIGlmICghb2spIHJldHVybjtcbiAgaWYgKHR5cGVvZiB3LmNsb3NlRXhwb3J0RGlhbG9nID09PSAnZnVuY3Rpb24nKSB3LmNsb3NlRXhwb3J0RGlhbG9nKCk7XG4gIGlmICh0eXBlb2Ygdy5zaG93TW9udGhQaWNrZXIgPT09ICdmdW5jdGlvbicp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QUFJO0FBQUEsSUFDckIsQ0FBQztBQUVELFVBQU0sTUFBSyxvQkFBSSxLQUFLLEdBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQy9DLFVBQU0sYUFBYSw4QkFBOEIsS0FBSyxTQUFTO0FBQUEsTUFDN0QsRUFBRSxNQUFNLGtCQUFrQixLQUFLO0FBQUEsSUFDakMsQ0FBQztBQUNEO0FBQUEsTUFDRSxzQkFDRSxLQUFLLFNBQ0wsK0JBQ0MsZUFBZSxJQUFJLE9BQU8sZUFBZSwrQkFBK0I7QUFBQSxJQUM3RTtBQUFBLEVBQ0Y7QUFFQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFFBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsWUFBTSxpRkFBaUY7QUFDdkY7QUFBQSxJQUNGO0FBQ0EsVUFBTSxNQUFNO0FBQUEsTUFDVjtBQUFBLElBQ0Y7QUFDQSxRQUFJLFFBQVEsS0FBTTtBQUNsQixRQUFJLFFBQVEsY0FBYztBQUN4QixZQUFNLGlCQUFpQjtBQUN2QjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFNBQVMsU0FBUyxlQUFlLHlCQUF5QjtBQUNoRSxRQUFJLFFBQVE7QUFDVixZQUFNLFlBQ0osZ0JBQWdCLFlBQVksU0FBUyxJQUFJLFlBQVksTUFBTTtBQUM3RCxhQUFPLE1BQU0sVUFBVSxZQUFZLEtBQUs7QUFBQSxJQUMxQztBQUVBLFVBQU0sUUFBUSxTQUFTLGVBQWUsd0JBQXdCO0FBQzlELFFBQUksTUFBTyxPQUFNLE1BQU0sVUFBVSxhQUFhLFVBQVUsS0FBSztBQUM3RCxhQUFTLGVBQWUsdUJBQXVCLEVBQUUsVUFBVSxJQUFJLE1BQU07QUFBQSxFQUN2RTtBQUNBLFNBQU8sc0JBQXNCLFdBQVk7QUFDdkMsYUFBUyxlQUFlLHVCQUF1QixFQUFFLFVBQVUsT0FBTyxNQUFNO0FBQUEsRUFDMUU7QUFTQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFVBQU07QUFBQTtBQUFBLE1BQXdCLE9BQU8sV0FBVyxjQUFjLFNBQVMsQ0FBQztBQUFBO0FBQ3hFLFVBQU0sT0FBTyxFQUFFLFlBQVk7QUFDM0IsUUFBSSxTQUFTLFdBQVcsU0FBUyxXQUFXO0FBQzFDLFlBQU0sNENBQTRDO0FBQ2xEO0FBQUEsSUFDRjtBQUNBLFVBQU0sS0FBSztBQUFBLE1BQ1Q7QUFBQSxJQU1GO0FBQ0EsUUFBSSxDQUFDLEdBQUk7QUFDVCxRQUFJLE9BQU8sRUFBRSxzQkFBc0IsV0FBWSxHQUFFLGtCQUFrQjtBQUNuRSxRQUFJLE9BQU8sRUFBRSxvQkFBb0IsV0FBWSxHQUFFLGdCQUFnQixnQkFBZ0I7QUFBQSxFQUNqRjsiLAogICJuYW1lcyI6IFsidyIsICJmYkRiIiwgIlBST0RVQ1RTIl0KfQo=
