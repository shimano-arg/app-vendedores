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
    const _findByCard = _fcLabels && _fcLabels.findCmDataByCardCode ? _fcLabels.findCmDataByCardCode : (cardCode, cache) => {
      if (!cardCode || !cache || typeof cache.forEach !== "function") return null;
      let found = null;
      cache.forEach((d) => {
        if (found || !d) return;
        const cc1 = String(d.sapCardCode || "").trim();
        const cc2 = String(d.cardCodeSap || "").trim();
        if (cc1 === cardCode || cc2 === cardCode) found = d;
      });
      return found;
    };
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
        const _cmDataForFicha = _findByCard(cardCode, clientMasterCache) || cmData;
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
            _clasifRow(_cmDataForFicha),
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
        const _altaCmData = a.cardCodeSap ? _findByCard(a.cardCodeSap, clientMasterCache) || a : a;
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
            _clasifRow(_altaCmData),
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
    const STRUCTURAL_PROTECTED = /* @__PURE__ */ new Set([
      "CardCode SAP",
      "Nombre tienda",
      "Alias (modal)",
      "Tipo",
      "Estado",
      "Provincia",
      "Localidad (mapa)",
      "Departamento",
      "Vendedor externo (VDE)",
      "Zona",
      "Etiqueta zona",
      "Asesor interno (VDI)",
      "Direccion",
      "Localidad declarada",
      "Lat (geocode)",
      "Lng (geocode)"
    ]);
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
        if (STRUCTURAL_PROTECTED.has(k)) return false;
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
    const _exportFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.backorderExport && w.__phase0.pure.backorderExport.computeBackorderExportRows;
    const deps = {
      getStockDisponibleVenta: typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : () => 0,
      canonVendor: typeof w._canonVendor === "function" ? w._canonVendor : (x) => String(x || "").trim().toUpperCase(),
      products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
      resolveVendorFallback: _resolveVendorFallback
    };
    const _exportResult = _exportFn ? _exportFn(arr, {}, deps) : { rows: [], totalUnidades: 0, totalFilas: 0, filtrosAplicados: {} };
    const rows = _exportResult.rows;
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
    const totalUnidadesModal = _exportResult.totalUnidades || _modalResult.totalUnidades || 0;
    const totalClientesModal = _modalResult.totalClientes || 0;
    const totalSkusModal = (_modalResult.skus || []).length;
    const _fmtFiltros = w.__phase0 && w.__phase0.pure && w.__phase0.pure.backorderExport && w.__phase0.pure.backorderExport.formatBackorderFiltrosHeader;
    const filtrosLbl = _fmtFiltros ? _fmtFiltros(_exportResult.filtrosAplicados) : "Filtros: ninguno";
    const resumenRows = [
      { Metrica: filtrosLbl, Valor: "" },
      { Metrica: "TOTAL Backorder ARS", Valor: Math.round(totalPesosModal) },
      { Metrica: "SKUs con backorder", Valor: totalSkusModal },
      { Metrica: "Unidades pendientes", Valor: Math.round(totalUnidadesModal) },
      { Metrica: "Pares cliente+SKU (filas en hoja Backorder)", Valor: rows.length },
      { Metrica: "Clientes afectados", Valor: totalClientesModal },
      { Metrica: "\u2014 Subtotal SIN REPOSICION", Valor: Math.round(subtotalesPorUrgency.urgente) },
      { Metrica: "\u2014 Subtotal PARCIAL", Valor: Math.round(subtotalesPorUrgency.parcial) },
      { Metrica: "Snapshot generado", Valor: (/* @__PURE__ */ new Date()).toLocaleString("es-AR") }
    ];
    const totalRow = {
      SKU: "",
      Producto: "",
      Cliente: "TOTAL",
      CardCode: "",
      Provincia: "",
      Localidad: "",
      Vendedor: "",
      Cantidad_Pendiente_BO: Math.round(totalUnidadesModal),
      Precio_Unit_ARS: "",
      Subtotal_BO_ARS: Math.round(totalPesosModal),
      Edad_BO_dias: "",
      Estado: "",
      Pedidos: ""
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
  window.exportRepartoToExcel = async function() {
    const w = (
      /** @type {any} */
      window
    );
    const ingresos = Array.isArray(w._repartoIngresos) ? w._repartoIngresos : [];
    if (!ingresos.length) {
      alert('No hay ingresos de reparto para exportar. Abr\xED el modal "Reparto de ingresos" primero.');
      return;
    }
    const _searchEl = typeof document !== "undefined" ? document.getElementById("reparto-search") : null;
    const _hideEl = typeof document !== "undefined" ? document.getElementById("reparto-hide-nostock") : null;
    const filtros = {
      search: _searchEl ? String(
        /** @type {any} */
        _searchEl.value || ""
      ).trim() : "",
      hideNoStock: _hideEl ? !!/** @type {any} */
      _hideEl.checked : true
    };
    const _btn = typeof document !== "undefined" ? document.querySelector('#reparto-modal button[onclick*="exportRepartoToExcel"]') : null;
    const _origBtnText = _btn ? _btn.textContent : "";
    if (_btn) {
      _btn.disabled = true;
      _btn.textContent = "\u23F3 Generando\u2026";
    }
    showSyncTag("Generando export Reparto\u2026");
    try {
      const _pureMod = w.__phase0 && w.__phase0.pure && w.__phase0.pure.repartoExport;
      if (!_pureMod || typeof _pureMod.computeRepartoExportRows !== "function") {
        throw new Error(
          "exports-core.repartoExport pure fn no disponible (chunk no cargado completo)"
        );
      }
      const _products = Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [];
      const _getStockFisico = typeof w.getStockDisponibleVenta === "function" ? (sku) => {
        try {
          return Number(w.getStockDisponibleVenta(sku)) || 0;
        } catch (_e) {
          return 0;
        }
      } : (_sku) => 0;
      const _getProductDesc = (sku) => {
        try {
          const u = String(sku || "").toUpperCase().trim();
          const p = _products.find(
            (x) => String(x && x.code || "").toUpperCase().trim() === u
          );
          return p ? String(p.desc || p.name || "").trim() : "";
        } catch (_e) {
          return "";
        }
      };
      const result = _pureMod.computeRepartoExportRows(ingresos, filtros, {
        getStockFisico: _getStockFisico,
        getProductDesc: _getProductDesc
      });
      const filtrosLbl = _pureMod.formatRepartoFiltrosHeader ? _pureMod.formatRepartoFiltrosHeader(filtros) : "Filtros: (no reportados)";
      const filtrosRows = [
        { Metrica: filtrosLbl, Valor: "" },
        { Metrica: "Total ingresos", Valor: ingresos.length },
        {
          Metrica: "Ingresos filtrados",
          Valor: result.totalFilas > 0 ? result.resumenRows.length - 1 : 0
        },
        { Metrica: "Total unidades ingresadas", Valor: result.totalIngresadas },
        { Metrica: "Total unidades BO solicitadas", Valor: result.totalBO },
        { Metrica: "Total clientes esperando", Valor: result.totalClientes },
        {
          Metrica: "Exportado en",
          Valor: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ") + " UTC"
        }
      ];
      const now = /* @__PURE__ */ new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const fname = "Reparto_" + now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "_" + pad(now.getHours()) + pad(now.getMinutes()) + ".xlsx";
      await downloadXlsx(fname, [
        { name: "Filtros", rows: filtrosRows },
        { name: "Resumen", rows: result.resumenRows },
        { name: "Detalle", rows: result.detalleRows }
      ]);
      showSyncTag(
        "Export Reparto listo (" + (result.resumenRows.length - 1) + " ingresos \xB7 " + (result.detalleRows.length - 1) + " filas detalle)",
        2800
      );
    } catch (e) {
      const msg = e && /** @type {any} */
      e.message || String(e);
      console.error("[v1497 \xA796] exportRepartoToExcel fall\xF3:", e);
      alert(
        "No pudimos generar el Excel del Reparto. Volv\xE9 a intentar; si sigue, avisale a Mariano."
      );
      try {
        if (typeof w.fbDb !== "undefined" && w.fbDb && typeof w.fbDb.collection === "function") {
          w.fbDb.collection("operations_log").add({
            type: "export_failed",
            exportKind: "reparto",
            error: msg.slice(0, 500),
            userUid: w.currentUser && w.currentUser.uid || null,
            userEmail: w.currentUser && w.currentUser.email || null,
            totalIngresos: ingresos.length,
            filtros,
            timestamp: /* @__PURE__ */ new Date()
          }).catch(() => {
          });
        }
      } catch (_eLog) {
      }
    } finally {
      if (_btn) {
        _btn.disabled = false;
        _btn.textContent = _origBtnText;
      }
    }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFQT0lOVFMgfHwgIVBPSU5UUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xuXG4gIC8vIHYxNDgyIFx1MDBBNzgyOiBjYXJnYXIgY2xpZW50X2J1eWVyX3N0YXRzIGVuIGJsb3F1ZSAoMSBkb2MgcG9yIGNhcmRDb2RlIFNBUClcbiAgLy8gQU5URVMgZGUgYXJtYXIgbGFzIGZpbGFzLCBhc1x1MDBFRCBjYWRhIGZpbGEgdGllbmUgc3UgYnV5ZXIgc3RhdHMgKyBmZWNoYVxuICAvLyBcdTAwRkFsdGltYSBjb21wcmEgc2luIHJvbXBlciBlbCBmbHVqby4gRmlyZS1hbmQtZm9yZ2V0IHNpIGZhbGxhOiBjYWRhIGZpbGFcbiAgLy8gY2FlIGEgXCItXCIgZW4gbG9zIGNhbXBvcyBCdXllci4gQWRtaW4vZ2VyZW50ZSB2ZSB0b2RhIGxhIGNvbGVjY2lcdTAwRjNuO1xuICAvLyB2ZW5kZWRvciB2ZSBzXHUwMEYzbG8gbG9zIHN1eW9zIChydWxlcykuIFNpIGxhIHJ1bGUgYmxvcXVlYSBcdTIxOTIgY2F0Y2ggXHUyMTkyIHZhY1x1MDBFRG8uXG4gIC8vIFBlZGlkbyBNYXJpYW5vOiBubyBpbnZlbnRhciBjXHUwMEUxbGN1bG8gZGUgXCJGZWNoYSBcdTAwRkFsdGltYSBjb21wcmFcIjsgc2kgbm9cbiAgLy8gZXhpc3RlIHNlIG9taXRlLiBidXllcl9zdGF0cy5zdGF0c18xMm0udWx0aW1hQ29tcHJhIFlBIGV4aXN0ZS5cbiAgY29uc3QgYnV5ZXJTdGF0c0lkeCA9IG5ldyBNYXAoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBic1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9idXllcl9zdGF0cycpLmdldCgpO1xuICAgIGJzU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBidXllclN0YXRzSWR4LnNldChkLmlkLCBkLmRhdGEoKSB8fCB7fSk7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgY29uc29sZS53YXJuKFxuICAgICAgJ1ttYXN0ZXJmaWxlXSBjbGllbnRfYnV5ZXJfc3RhdHMgbm8gY2FyZ2FkbyAocnVsZSBkZW5pZWQgbyByZWQpOicsXG4gICAgICBfZSAmJiBfZS5tZXNzYWdlXG4gICAgKTtcbiAgfVxuICAvLyBIZWxwZXJzIGRlbCBwdXJlIGZuIChmYWxsYmFjayBpbmxpbmUgc2kgYnVuZGxlIG5vIGNhcmdcdTAwRjMpLlxuICBjb25zdCBfZmNMYWJlbHMgPVxuICAgICh3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUuZmljaGFDbGllbnRlTGFiZWxzKSB8fCBudWxsO1xuICBjb25zdCBfY2xhc2lmUm93ID0gKGNtZCkgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUNsYXNpZlJvd1xuICAgICAgPyBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93KGNtZClcbiAgICAgIDoge1xuICAgICAgICAgICdUaXBvIGRlIGNsaWVudGUnOiAnLScsXG4gICAgICAgICAgRmlkZWxpZGFkOiAnLScsXG4gICAgICAgICAgJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJzogJy0nLFxuICAgICAgICAgIFRhbWFcdTAwRjFvOiAnLScsXG4gICAgICAgICAgRXNwZWNpYWxpemFjaVx1MDBGM246ICctJyxcbiAgICAgICAgICAnVGlwbyBkZSBsb2NhbCc6ICctJyxcbiAgICAgICAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IGNtZCAmJiBjbWQuY3JlZGl0b0NoZXF1ZSA/IE51bWJlcihjbWQuY3JlZGl0b0NoZXF1ZSkgOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9idXllclJvdyA9IChicykgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVCdXllclJvdyhicywgJzEybScpXG4gICAgICA6IHtcbiAgICAgICAgICAnTW9udG8gdG90YWwgKDEybSknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogJy0nLFxuICAgICAgICAgICdGYWN0dXJhcyBwb3IgbWVzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcmltZXJhIGNvbXByYSc6ICctJyxcbiAgICAgICAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICB9O1xuICBjb25zdCBfZmlsbERhc2ggPSAocm93KSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5ID8gX2ZjTGFiZWxzLmZpbGxEYXNoSW5FbXB0eShyb3cpIDogcm93O1xuICAvLyB2MTQ4NSBcdTAwQTc4NCAoMjAyNi0xMC0yNyBCVUcgRklYKTogYlx1MDBGQXNxdWVkYSBwb3IgY2FyZENvZGUgKGZ1ZW50ZSBhdXRvcml0YXRpdmEpLlxuICAvLyB2MTQ4MiB1c2FiYSBgY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNsaWVudExvY0lkKHByb3YsIGxvYywgbmFtZSkpYCBcdTIwMTQgc2x1Z1xuICAvLyBkZXJpdmFkbyBkZSBQT0lOVFMuIFBhcmEgTUFYRVJBLCBQT0lOVFMgZGljZSBcIlBhbGVybW8gKEMxNClcIiBwZXJvIGxhIEZpY2hhXG4gIC8vIHBlcnNpc3RlIGNvbiBcIkNPTEVHSUFMRVNcIiBcdTIxOTIgZG9jSWQgbWlzbWF0Y2ggXHUyMTkyIGNtRGF0YSB1bmRlZmluZWQgXHUyMTkyIDUgY2FtcG9zXG4gIC8vIEZpY2hhIHNhbFx1MDBFRGFuIFwiLVwiIGF1bnF1ZSBjYXJnYWRvcy4gZmluZENtRGF0YUJ5Q2FyZENvZGUgZXNjYW5lYSBwb3JcbiAgLy8gc2FwQ2FyZENvZGUgT1IgY2FyZENvZGVTYXAgKGFtYm9zIGFsaWFzZXMpIHkgcmV0b3JuYSBlbCBkb2MgY29ycmVjdG8uXG4gIGNvbnN0IF9maW5kQnlDYXJkID1cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpbmRDbURhdGFCeUNhcmRDb2RlXG4gICAgICA/IF9mY0xhYmVscy5maW5kQ21EYXRhQnlDYXJkQ29kZVxuICAgICAgOiAoY2FyZENvZGUsIGNhY2hlKSA9PiB7XG4gICAgICAgICAgaWYgKCFjYXJkQ29kZSB8fCAhY2FjaGUgfHwgdHlwZW9mIGNhY2hlLmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHJldHVybiBudWxsO1xuICAgICAgICAgIGxldCBmb3VuZCA9IG51bGw7XG4gICAgICAgICAgY2FjaGUuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICAgICAgaWYgKGZvdW5kIHx8ICFkKSByZXR1cm47XG4gICAgICAgICAgICBjb25zdCBjYzEgPSBTdHJpbmcoZC5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgICAgICAgY29uc3QgY2MyID0gU3RyaW5nKGQuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgICAgIGlmIChjYzEgPT09IGNhcmRDb2RlIHx8IGNjMiA9PT0gY2FyZENvZGUpIGZvdW5kID0gZDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gZm91bmQ7XG4gICAgICAgIH07XG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcbiAgLy8gZHJvcGRvd24uIEFkbWluL2dlcmVudGUvdmlld2VyIGNvbiAnVG9kYXMnIG9idGllbmVuIG51bGwgLT4gc2luIGZpbHRyb1xuICAvLyAoZXhwb3J0YSB0b2RvIGVsIHBhaXMpLiBWZW5kZWRvciBvYnRpZW5lIHthc3NpZ25lZFZlbmRvcn0uIFZESSBvYnRpZW5lXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcbiAgLy8gZWxpZ2lvIChwcm9waW8gLyB1bmEgcGFyZWphIGVzcGVjaWZpY2EpLiBGdWVyYSBkZSBlc3RlIHNldCwgbGFzIHRpZW5kYXNcbiAgLy8gbm8gc2UgaW5jbHV5ZW4gZW4gZWwgRXhjZWwgLSBlbCBhcmNoaXZvIHJlZmxlamEgZXhhY3RhbWVudGUgbG8gcXVlIHZlXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cbiAgY29uc3Qgc2NvcGVTZXQgPVxuICAgIHR5cGVvZiBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgPT09ICdmdW5jdGlvbidcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcbiAgICAgIDogbnVsbDtcbiAgY29uc3QgaW5TY29wZSA9ICh2ZW5kb3JLZXkpID0+IHtcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xuICAgIGlmICghdmVuZG9yS2V5KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHNjb3BlU2V0Lmhhcyh2ZW5kb3JLZXkpO1xuICB9O1xuICAvLyBNYXBlbyBWREUgLT4gVkRJIChhIHBhcnRpciBkZSBsYXMgcGFyZWphcyBlc3RhbmRhcikuIEN1YW5kbyB1bmEgdGllbmRhXG4gIC8vIHBlcnRlbmVjZSBhIEZlZGVyaWNvIG8gR29uemFsbywgZWwgVkRJIGVzIElvYW5uaXMuIEN1YW5kbyBlcyBkZSBNYXVyaWNpb1xuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXG4gIC8vIHBhbmVsIGFkbWluLCBlc3RvIHNlIHBvZHJpYSBsZWVyIGRlbCBGaXJlc3RvcmUgLSBwZXJvIHBhcmEgZWwgbWFzdGVyZmlsZVxuICAvLyBlc3RhdGljbywgdXNhbW9zIGVsIGVzdGFuZGFyLlxuICBjb25zdCBWREVfVE9fVkRJID0ge1xuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICAgIFBBQ0hJOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LnpvbmUgOiAnJztcbiAgfVxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XG4gIH1cblxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcbiAgLy8gY2xpZW50ZSwgbWVyZ2VhIGxvcyBjYW1wb3MgZGUgY2xhc2lmaWNhY2lvbiAodGlwby90YW1hbm8vZmlkZWxpZGFkL1xuICAvLyBlc3BlY2lhbGl6YWNpb24vY2FuYWxDb21wcmEvcG9wL3RpcG9WZW50YS9ldGMuKSBkZWwgZm9ybXVsYXJpbyBkZVxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXG4gIC8vIE5PIFZBQ0lPIGFsIHJlY29ycmVyIGRvY3MgZGUgbWFzIHJlY2llbnRlIGEgbWFzIGFudGlndW8uIEFzaSBlbCB1c3VhcmlvXG4gIC8vIHZlIGxhIGNsYXNpZmljYWNpb24gbWFzIGFjdHVhbGl6YWRhLCBwZXJvIHNpIGVsIHVsdGltbyBjb250YWN0byBubyBsbGVuYVxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcbiAgLy8gZW4gdmV6IGRlIGRlamFyIHZhY2lvLiBQZWRpZG8gZGUgTWFyaWFubzogXCJwcmlvcml6YXIgbGEgdWx0aW1hXG4gIC8vIGludGVyYWNjaW9uIHBlcm8gbm8gcGVyZGVyIGluZm8gdXRpbCBkZSBsYXMgYW50ZXJpb3Jlc1wiLlxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcbiAgICAndGlwbycsXG4gICAgJ2xvY2FsJyxcbiAgICAndGFtYW5vJyxcbiAgICAnZmlkZWxpZGFkJyxcbiAgICAnZXNwZWNpYWxpemFjaW9uJyxcbiAgICAnY2FuYWxDb21wcmEnLFxuICAgICdyZWxldmFuY2lhJyxcbiAgICAncG9wJyxcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXG4gICAgJ3RpcG9WZW50YScsXG4gICAgJ3BvbmRlcmFjaW9uTW9zdHJhZG8nLFxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXG4gICAgJ2NvbXBldGVuY2lhJyxcbiAgICAnb3BvcnR1bmlkYWQnLFxuICAgICdtYXNWZW5kaWRvJyxcbiAgICAnbWFzUHJlZ3VudGFuJyxcbiAgICAnYXl1ZGFUaWVuZGEnLFxuICBdO1xuICBmdW5jdGlvbiBfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIHJldHVybiAoXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKGxvYyB8fCAnJykudG9TdHJpbmcoKS50cmltKCkgK1xuICAgICAgJ3wnICtcbiAgICAgICh0aWVuZGEgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpXG4gICAgKTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlRzKHYpIHtcbiAgICBpZiAodiAmJiB2LmNyZWF0ZWRBdCAmJiB2LmNyZWF0ZWRBdC50b01pbGxpcykgcmV0dXJuIHYuY3JlYXRlZEF0LnRvTWlsbGlzKCk7XG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xuICAgIHJldHVybiAwO1xuICB9XG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XG4gIGlmICh0eXBlb2YgdmlzaXRzQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkodmlzaXRzQ2FjaGUpKSB7XG4gICAgY29uc3QgYnlLZXkgPSBuZXcgTWFwKCk7XG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgICAgaWYgKCF2KSByZXR1cm47XG4gICAgICBjb25zdCBrID0gX2NsYXNzaWZLZXkodi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSk7XG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcbiAgICAgIGJ5S2V5LmdldChrKS5wdXNoKHYpO1xuICAgIH0pO1xuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xuICAgICAgYXJyLnNvcnQoKGEsIGIpID0+IF9jbGFzc2lmVHMoYikgLSBfY2xhc3NpZlRzKGEpKTsgLy8gZGVzYyBwb3IgZmVjaGFcbiAgICAgIGNvbnN0IG1lcmdlZCA9IHt9O1xuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcbiAgICAgICAgQ0xBU1NJRl9GSUVMRFMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgICAgIGlmIChtZXJnZWRbZl0gIT0gbnVsbCAmJiBtZXJnZWRbZl0gIT09ICcnICYmIG1lcmdlZFtmXSAhPT0gMCkgcmV0dXJuO1xuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XG4gICAgICAgICAgaWYgKHZhbCAhPSBudWxsICYmIHZhbCAhPT0gJycpIG1lcmdlZFtmXSA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGFyclswXSB8fCB7fTtcbiAgICAgIGNsYXNzaWZJbmRleC5zZXQoaywge1xuICAgICAgICBtZXJnZWQsXG4gICAgICAgIGxhc3RGZWNoYTogbGF0ZXN0LmZlY2hhIHx8ICcnLFxuICAgICAgICBsYXN0VHlwZTogbGF0ZXN0LmludGVyYWN0aW9uVHlwZSB8fCAobGF0ZXN0LmVzcGFjaW8gPyAndmlzaXRhJyA6ICcnKSxcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcbiAgICAgICAgY29udGFjdG9zOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gX2NsYXNzaWZSb3cocHJvdiwgbG9jLCB0aWVuZGEpIHtcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxuICAgICAgICAnVG90YWwgdmlzaXRhcyc6IDAsXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxuICAgICAgICAnVGlwbyBjb21lcmNpbyc6ICcnLFxuICAgICAgICBMb2NhbDogJycsXG4gICAgICAgIFRhbWFubzogJycsXG4gICAgICAgIEZpZGVsaWRhZDogJycsXG4gICAgICAgIEVzcGVjaWFsaXphY2lvbjogJycsXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcbiAgICAgICAgUmVsZXZhbmNpYTogJycsXG4gICAgICAgIFBPUDogJycsXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxuICAgICAgICAnVGlwbyBkZSB2ZW50YSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcbiAgICAgICAgQ29tcGV0ZW5jaWE6ICcnLFxuICAgICAgICBPcG9ydHVuaWRhZDogJycsXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxuICAgICAgICAnTWFzIHByZWd1bnRhbic6ICcnLFxuICAgICAgICAnQXl1ZGEgdGllbmRhJzogJycsXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBtID0gZW50cnkubWVyZ2VkIHx8IHt9O1xuICAgIHJldHVybiB7XG4gICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdEZlY2hhLFxuICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdFR5cGUsXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXG4gICAgICAnVG90YWwgY29udGFjdG9zJzogZW50cnkuY29udGFjdG9zLFxuICAgICAgJ1RpcG8gY29tZXJjaW8nOiBtLnRpcG8gfHwgJycsXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcbiAgICAgIFRhbWFubzogbS50YW1hbm8gfHwgJycsXG4gICAgICBGaWRlbGlkYWQ6IG0uZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcbiAgICAgICdDYW5hbCBkZSBjb21wcmEnOiBtLmNhbmFsQ29tcHJhIHx8ICcnLFxuICAgICAgUmVsZXZhbmNpYTogbS5yZWxldmFuY2lhICE9IG51bGwgPyBtLnJlbGV2YW5jaWEgOiAnJyxcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXG4gICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiBtLm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICAnVGlwbyBkZSB2ZW50YSc6IG0udGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogbS5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gbS5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxuICAgICAgQ29tcGV0ZW5jaWE6IG0uY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgICdNYXMgdmVuZGlkbyc6IG0ubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgICdNYXMgcHJlZ3VudGFuJzogbS5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxuICAvLyB0aWVuZW4gY2FyZENvZGUgKyBkaXJlY2Npb24uIEVzb3Mgc29uIGxvcyBxdWUgYXBhcmVjZW4gY29tbyB2ZXJkZXMgZW5cbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xuICAvLyByZWFsIG9wZXJhYmxlIGhveS5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHByb3ZpbmNlID0gcC5wcm92aW5jZSB8fCAnJztcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcbiAgICBjb25zdCBkZXB0ID0gcC5kZXB0IHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvciA9IHAudmVuZG9yIHx8ICcnO1xuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cbiAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgIGNvbnN0IGxhdCA9IHAubGF0ICE9IG51bGwgPyBwLmxhdCA6ICcnO1xuICAgIGNvbnN0IGxvbiA9IHAubG9uICE9IG51bGwgPyBwLmxvbiA6ICcnO1xuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cbiAgICAvLyBlbCBmaWx0cm8gaXNTYXBDb25maXJtZWQ6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi5cbiAgICAocC5jbGllbnRzIHx8IFtdKS5mb3JFYWNoKChuYW1lKSA9PiB7XG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpXG4gICAgICAgIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XG4gICAgICAvLyBFc3RhZG86IGhhYmlsaXRhZG8vY2FuY2VsYWRvL3BlbmRpZW50ZSAobGVnYWN5IGNvbnRhY3RlZCBzZXQpLlxuICAgICAgbGV0IGVzdGFkbyA9ICdIYWJpbGl0YWRvJzsgLy8gcG9yIGRlZmluaWNpb24geWEgZXN0YSBTQVAtY29uZmlybWFkb1xuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcbiAgICAgICAgZXN0YWRvID0gJ0NhbmNlbGFkbyc7XG4gICAgICAvLyBNZXRhZGF0YSBjdXN0b20gKGRpcmVjY2lvbiwgbG9jYWxpZGFkIGRlY2xhcmFkYSwgZ2VvY29kZSkuXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xuICAgICAgLy8gQnVzY2FyIGFkZHJlc3M6IDEpIGNsaWVudF9tYXN0ZXIuYWRkcmVzcyAoYWRtaW4pLCAyKSBjbGllbnRNZXRhLmFkZHJlc3MgKHZlbmRvcikuXG4gICAgICBjb25zdCBkb2NJZCA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcbiAgICAgIGNvbnN0IGNtRGF0YSA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XG4gICAgICBjb25zdCBhZGRyZXNzID0gY21EYXRhLmFkZHJlc3MgfHwgbWV0YS5hZGRyZXNzIHx8ICcnO1xuICAgICAgY29uc3QgbG9jYWxpdHlDdXN0ID0gY21EYXRhLmxvY2FsaWRhZCB8fCBtZXRhLmxvY2FsaXR5IHx8ICcnO1xuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XG4gICAgICBjb25zdCBjdXN0b21MbmcgPSBtZXRhLmxuZyAhPSBudWxsID8gbWV0YS5sbmcgOiAnJztcbiAgICAgIC8vIENhcmRDb2RlIFNBUCAoZGUgY2xpZW50X21hc3RlciBvIGRlIGxhIGFsdGEgdmluY3VsYWRhKS5cbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcHJvdmluY2UudG9VcHBlckNhc2UoKSArICd8JyArIGxvY2FsaXR5TWFwO1xuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiAoYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8ICcnKSA9PT0gbmFtZSk7XG4gICAgICAgIGlmIChhbHRhTWF0Y2gpIGNhcmRDb2RlID0gYWx0YU1hdGNoLmNhcmRDb2RlU2FwIHx8ICcnO1xuICAgICAgfVxuICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IEJ1eWVyIHN0YXRzIGluZGV4YWRvIHBvciBjYXJkQ29kZSBTQVAuXG4gICAgICBjb25zdCBfYnV5ZXJTdGF0cyA9IGNhcmRDb2RlID8gYnV5ZXJTdGF0c0lkeC5nZXQoY2FyZENvZGUpIHx8IG51bGwgOiBudWxsO1xuICAgICAgLy8gdjE0ODUgXHUwMEE3ODQgQlVHIEZJWDogYnVzY2FyIGNtRGF0YSBhdXRvcml0YXRpdm8gcG9yIGNhcmRDb2RlLiBFbFxuICAgICAgLy8gY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGRvY0lkKSBkZSBhcnJpYmEgdXNhIHNsdWcgY2xpZW50TG9jSWQgcXVlIHB1ZWRlXG4gICAgICAvLyBhcHVudGFyIGFsIGRvYyBFUVVJVk9DQURPICh2ZXIgY29tbWVudCBhcnJpYmEpLiBfZmluZEJ5Q2FyZCBzY2FuIHBvclxuICAgICAgLy8gc2FwQ2FyZENvZGUgZ2FyYW50aXphIGVuY29udHJhciBlbCBkb2MgY29uIGxvcyBjYW1wb3MgRmljaGEuXG4gICAgICBjb25zdCBfY21EYXRhRm9yRmljaGEgPSBfZmluZEJ5Q2FyZChjYXJkQ29kZSwgY2xpZW50TWFzdGVyQ2FjaGUpIHx8IGNtRGF0YTtcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogY2FyZENvZGUsXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6IGN1c3RvbU5hbWUsXG4gICAgICAgICAgICBUaXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdmluY2UpIDogcHJvdmluY2UsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvY2FsaXR5TWFwLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhZGRyZXNzLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGN1c3RvbUxhdCB8fCBsYXQsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGN1c3RvbUxuZyB8fCBsb24sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogT1JERU4gaW1wb3J0YS4gTGVnYWN5IHZpc2l0YXMgUFJJTUVSTyAoZmFsbGJhY2spLFxuICAgICAgICAgIC8vIGx1ZWdvIEZpY2hhIENsaWVudGUgUElTQSBjb24gbGFiZWxzIGRlIGxhIGZ1ZW50ZSBhdXRvcml0YXRpdmFcbiAgICAgICAgICAvLyAoZWouIFwiRmlkZWxpZGFkXCIgRmljaGEgcGlzYSBsYSBtZXJnZWFkYSBkZSB2aXNpdGFzIHF1ZSBwdWVkZVxuICAgICAgICAgIC8vIGVzdGFyIGRlc2FjdHVhbGl6YWRhKS4gQnV5ZXIgc3RhdHMgYWwgZmluYWwgKHZlbnRhbmEgMTJtKS5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpLFxuICAgICAgICAgIF9jbGFzaWZSb3coX2NtRGF0YUZvckZpY2hhKSxcbiAgICAgICAgICBfYnV5ZXJSb3coX2J1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuICAvLyBJbnllY3RhciBhbHRhcyBkZSBjbGllbnRfYXBwbGljYXRpb25zIChhcHByb3ZlZEFsdGFzTGlzdCk6XG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXG4gIC8vICAgKiBQUk9WSVNPUklPUyAodjMxMSspOiBtYW51YWxTYXBQZW5kaW5nICYmICFjYXJkQ29kZVNhcCAoQWx0YSBSYXBpZGFcbiAgLy8gICAgIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuIFZhbiBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy4gU2VcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xuICAvLyAgICAgcXVlIGVsIGdlcmVudGUgZXN0YSBnZXN0aW9uYW5kbywgbm8gc29sbyBsb3MgY2VycmFkb3MgZW4gU0FQLlxuICAvLyAgICAgTG9zIHByb3Zpc29yaW9zIHB1ZWRlbiBubyB0ZW5lciBkaXJlY2Npb24gdG9kYXZpYSAtPiBzZSBhY2VwdGFuIGlndWFsLlxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBzZWVuLmFkZChcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxuICAgICk7XG4gIH0pO1xuICBpZiAodHlwZW9mIGFwcHJvdmVkQWx0YXNMaXN0ICE9PSAndW5kZWZpbmVkJyAmJiBhcHByb3ZlZEFsdGFzTGlzdC5sZW5ndGgpIHtcbiAgICBhcHByb3ZlZEFsdGFzTGlzdC5mb3JFYWNoKChhKSA9PiB7XG4gICAgICBpZiAoIWEpIHJldHVybjtcbiAgICAgIGNvbnN0IGlzUHJvdmlzb3JpbyA9ICEhYS5tYW51YWxTYXBQZW5kaW5nICYmICFhLmNhcmRDb2RlU2FwO1xuICAgICAgLy8gSGFiaWxpdGFkb3M6IHNpZ3VlbiBleGlnaWVuZG8gY2FyZENvZGUgKyBkaXJlY2Npb24gKGNvbXBvcnRhbWllbnRvIHByZS12MzExKS5cbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXG4gICAgICBpZiAoIWlzUHJvdmlzb3Jpbykge1xuICAgICAgICBpZiAoIWEuY2FyZENvZGVTYXApIHJldHVybjtcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwcm92ID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgY29uc3Qgbm9tYnJlID1cbiAgICAgICAgYS5jb21lcmNpbyB8fFxuICAgICAgICBhLmZhbnRhc2lhIHx8XG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xuICAgICAgY29uc3QgZHVwS2V5ID0gcHJvdi50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbm9tYnJlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMoZHVwS2V5KSkgcmV0dXJuO1xuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcbiAgICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgICAvLyB2MzMxOiBtaXNtbyBmaWx0cm8gZGUgc2NvcGUgYXBsaWNhIGEgYWx0YXMgU0FQL3Byb3Zpc29yaWFzLlxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcbiAgICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xuICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IHBhcmEgYWx0YXMsIGJ1eWVyIHN0YXRzIGtleWVkIHBvciBjYXJkQ29kZVNhcCAoc2kgZXhpc3RlKS5cbiAgICAgIGNvbnN0IF9hbHRhQnV5ZXJTdGF0cyA9IGEuY2FyZENvZGVTYXAgPyBidXllclN0YXRzSWR4LmdldChhLmNhcmRDb2RlU2FwKSB8fCBudWxsIDogbnVsbDtcbiAgICAgIC8vIHYxNDg1IFx1MDBBNzg0IEJVRyBGSVg6IHBhcmEgYWx0YXMgY29uIGNhcmRDb2RlLCBlbCBkb2MgYXV0b3JpdGF0aXZvIGNvblxuICAgICAgLy8gY2FtcG9zIEZpY2hhIHZpdmUgZW4gY2xpZW50X21hc3RlciAobG8gZXNjcmliZSBzYXZlQ2xpZW50Q2F0ZWdvcmlhRnJvbU1vZGFsXG4gICAgICAvLyB2aWEgRmljaGEpLiBfZmluZEJ5Q2FyZCByZXRvcm5hIGVzZSBkb2MuIEZhbGxiYWNrIGFsIHByb3BpbyBhbHRhIGBhYFxuICAgICAgLy8gc2kgZWwgY2xpZW50ZSBubyBlc3RcdTAwRTEgZW4gY2xpZW50X21hc3RlciAoZWouIHByb3Zpc29yaW8gc2luIGNhcmRDb2RlKS5cbiAgICAgIGNvbnN0IF9hbHRhQ21EYXRhID0gYS5jYXJkQ29kZVNhcCA/IF9maW5kQnlDYXJkKGEuY2FyZENvZGVTYXAsIGNsaWVudE1hc3RlckNhY2hlKSB8fCBhIDogYTtcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogYS5jYXJkQ29kZVNhcCB8fCAnJyxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcbiAgICAgICAgICAgIFRpcG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvIChBbHRhIHJhcGlkYSknIDogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICAgICAgWm9uYTogem9uZSxcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgICAgIERpcmVjY2lvbjogYS5jYWxsZSB8fCBhLmFkZHJlc3MgfHwgJycsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGEubG5nICE9IG51bGwgPyBhLmxuZyA6ICcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IG1pc21vIG9yZGVuIHF1ZSBQT0lOVFMgXHUyMDE0IGxlZ2FjeSB2aXNpdGFzIHByaW1lcm8sXG4gICAgICAgICAgLy8gRmljaGEgcGlzYSwgQnV5ZXIgYWwgZmluYWwuXG4gICAgICAgICAgX2NsYXNzaWZSb3cocHJvdiwgbG9jLCBub21icmUpLFxuICAgICAgICAgIF9jbGFzaWZSb3coX2FsdGFDbURhdGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYWx0YUJ1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBPcmRlbmFyIHBvciBwcm92aW5jaWEsIGxvY2FsaWRhZCwgbm9tYnJlLlxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChhWydOb21icmUgdGllbmRhJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKTtcbiAgfSk7XG5cbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xuICAgICAgICAnRWwgbWFzdGVyZmlsZSBpbmNsdXllOlxcbicgK1xuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xuICAgICAgICAnU2kgbm8gdmVzIG5pbmd1bm8sIHJldmlzYSBlbCBtb2RhbCBTQVAgbyBBbHRhIENsaWVudGVzLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggaGVscGVyIChlc3RpbG8gdmVyZGUgKyBjZW50ZXJlZFxuICAvLyB1bmlmb3JtZSkuIEFudGVzIHVzYWJhIFhMU1gud3JpdGVGaWxlIGRpcmVjdG8gY29uIFNoZWV0SlMgZnJlZSBxdWUgaWdub3JhXG4gIC8vIGVzdGlsb3MuIEFob3JhIGhlcmVkYWRvIGRlbCBoZWxwZXIgXHUyMDE0IG1pc21hIFVJIHF1ZSBWZW50YXMvVmlzaXRhcy9ldGMuXG4gIC8vIHYxMDQzICgyMDI2LTA5LTIzKTogcG9zdC1wcm9jZXNvIFx1MjAxNCBzYWNhciBjb2x1bW5hcyAxMDAlIHZhY1x1MDBFRGFzLlxuICAvLyBSZXBvcnRlIE1hcmlhbm86IG1hc3RlcmZpbGUgZXhwb3J0YWJhIDM3IGNvbHVtbmFzIGRvbmRlIG11Y2hhcyB2ZW5cdTAwRURhblxuICAvLyB2YWNcdTAwRURhcyBwb3JxdWUgbm8gaGFiXHUwMEVEYSB2aXNpdGFzL2NvbnRhY3RvcyBjYXJnYWRvcyBwYXJhIGVzb3MgY2xpZW50ZXMuXG4gIC8vIEZpeDogaWRlbnRpZmljYXIga2V5cyBkb25kZSBUT0RBUyBsYXMgZmlsYXMgdGllbmVuIHZhbG9yIFwidmFjXHUwMEVEb1wiIChlbXB0eVxuICAvLyBzdHJpbmcsIG51bGwsIHVuZGVmaW5lZCkgeSByZW1vdmVybGFzIGFudGVzIGRlbCBzaGVldC4gTG9zIGNvbnRlb3NcbiAgLy8gKFRvdGFsIHZpc2l0YXMvY29udGFjdG9zKSBzZSBjb25zaWRlcmFuIHZhY1x1MDBFRG9zIHNpIHRvZG9zIHNvbiAwLlxuICAvLyBXaWR0aHMgcG9yIGNvbHVtbi1uYW1lIChlbiB2ZXogZGUgcG9zaWNpb25hbCkgcGFyYSBxdWUgZWwgZmlsdGVyIG5vXG4gIC8vIGRlc2FsaW5lZSBlbCBzaGVldCBjdWFuZG8gcmVtb3ZlbW9zIGNvbHVtbmFzLlxuICBjb25zdCBDT0xfV0lEVEhTID0ge1xuICAgICdDYXJkQ29kZSBTQVAnOiAxNixcbiAgICAnTm9tYnJlIHRpZW5kYSc6IDM4LFxuICAgICdBbGlhcyAobW9kYWwpJzogMjgsXG4gICAgVGlwbzogMTQsXG4gICAgRXN0YWRvOiAxNCxcbiAgICBQcm92aW5jaWE6IDIyLFxuICAgICdMb2NhbGlkYWQgKG1hcGEpJzogMjIsXG4gICAgRGVwYXJ0YW1lbnRvOiAyMixcbiAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IDI4LFxuICAgIFpvbmE6IDgsXG4gICAgJ0V0aXF1ZXRhIHpvbmEnOiA0OCxcbiAgICAnQXNlc29yIGludGVybm8gKFZESSknOiAyOCxcbiAgICBEaXJlY2Npb246IDM4LFxuICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogMjQsXG4gICAgJ0xhdCAoZ2VvY29kZSknOiAxNCxcbiAgICAnTG5nIChnZW9jb2RlKSc6IDE0LFxuICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBjb2x1bW5hcyBkZSBsYSBGaWNoYSBDbGllbnRlIChwZXN0YVx1MDBGMWEgQ2xhc2lmaWNhY2lcdTAwRjNuKSArXG4gICAgLy8gQnV5ZXIgKHBlc3RhXHUwMEYxYSBCdXllciwgdmVudGFuYSAxMm0pLiBPcmRlbiBleGFjdG8gcXVlIGxsZWdhIGRlc2RlXG4gICAgLy8gX2NsYXNpZlJvdyAoT2JqZWN0LmFzc2lnbiBwcmVzZXJ2YSBvcmRlbiBkZSBrZXlzKS5cbiAgICAnVGlwbyBkZSBjbGllbnRlJzogMzYsXG4gICAgRmlkZWxpZGFkOiAxMCxcbiAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAyMCxcbiAgICBUYW1hXHUwMEYxbzogMTAsXG4gICAgRXNwZWNpYWxpemFjaVx1MDBGM246IDIwLFxuICAgICdUaXBvIGRlIGxvY2FsJzogMTQsXG4gICAgJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknOiAxOCxcbiAgICAnTW9udG8gdG90YWwgKDEybSknOiAxNixcbiAgICAnRmFjdHVyYXMgKDEybSknOiAxMixcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknOiAyMCxcbiAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogMjAsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAxNixcbiAgICAnUHJpbWVyYSBjb21wcmEnOiAxNCxcbiAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogMTQsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAxOCxcbiAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RvdGFsIHZpc2l0YXMnOiAxMCxcbiAgICAnVG90YWwgY29udGFjdG9zJzogMTAsXG4gICAgJ1RpcG8gY29tZXJjaW8nOiAxOCxcbiAgICBMb2NhbDogMTYsXG4gICAgJ0NhbmFsIGRlIGNvbXByYSc6IDIwLFxuICAgIFJlbGV2YW5jaWE6IDEwLFxuICAgIFBPUDogOCxcbiAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAyNixcbiAgICAnVGlwbyBkZSB2ZW50YSc6IDE2LFxuICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogMTgsXG4gICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogMTgsXG4gICAgQ29tcGV0ZW5jaWE6IDI2LFxuICAgIE9wb3J0dW5pZGFkOiAyNixcbiAgICAnTWFzIHZlbmRpZG8nOiAyMixcbiAgICAnTWFzIHByZWd1bnRhbic6IDIyLFxuICAgICdBeXVkYSB0aWVuZGEnOiAyNixcbiAgfTtcbiAgLy8gRGV0ZWN0YXIga2V5cyAxMDAlIHZhY1x1MDBFRGFzLlxuICBjb25zdCBhbGxLZXlzID0gT2JqZWN0LmtleXMoQ09MX1dJRFRIUyk7XG4gIGNvbnN0IE5VTUVSSUNfWkVST19PSyA9IG5ldyBTZXQoWydUb3RhbCB2aXNpdGFzJywgJ1RvdGFsIGNvbnRhY3RvcyddKTtcbiAgLy8gdjE0ODIgXHUwMEE3ODIgKyB2MTQ4NSBcdTAwQTc4NCBtZWpvcmE6IGNvbHVtbmFzIEZpY2hhICsgZXN0cnVjdHVyYWxlcyAoQ2FyZENvZGUsXG4gIC8vIFpvbmEsIFZlbmRlZG9yLCBEaXJlY2NpXHUwMEYzbiwgZXRjLikgTlVOQ0Egc2Ugb21pdGVuLiBNYXJpYW5vIHBpZGlcdTAwRjM6XG4gIC8vIFwibm8gb2N1bHRhciBjb2x1bW5hcyBwb3Igcm9sOyBQQUNISSByZWNpYmUgbGFzIG1pc21hcyBjb2x1bW5hcyBxdWVcbiAgLy8gYWRtaW4sIHNvbG8gc3VzIGNsaWVudGVzXCIuIEVsIGV4cG9ydCBWREUvUEFDSEkgcmVzcGV0YSBlc3RlIGNvbnRyYXRvXG4gIC8vIHBvcnF1ZSBsYXMgc3RydWN0dXJhbGVzIGVzdFx1MDBFMW4gcHJvdGVnaWRhcyBhdW5xdWUgZWwgc2NvcGUgcmVkdWNpZG8gbm9cbiAgLy8gdGVuZ2EgZGF0b3MgcGFyYSBhbGd1bmEgZGUgZWxsYXMuXG4gIGNvbnN0IFNUUlVDVFVSQUxfUFJPVEVDVEVEID0gbmV3IFNldChbXG4gICAgJ0NhcmRDb2RlIFNBUCcsXG4gICAgJ05vbWJyZSB0aWVuZGEnLFxuICAgICdBbGlhcyAobW9kYWwpJyxcbiAgICAnVGlwbycsXG4gICAgJ0VzdGFkbycsXG4gICAgJ1Byb3ZpbmNpYScsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknLFxuICAgICdEZXBhcnRhbWVudG8nLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJyxcbiAgICAnWm9uYScsXG4gICAgJ0V0aXF1ZXRhIHpvbmEnLFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKScsXG4gICAgJ0RpcmVjY2lvbicsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnLFxuICAgICdMYXQgKGdlb2NvZGUpJyxcbiAgICAnTG5nIChnZW9jb2RlKScsXG4gIF0pO1xuICBjb25zdCBGSUNIQV9QUk9URUNURUQgPSBuZXcgU2V0KFtcbiAgICAnVGlwbyBkZSBjbGllbnRlJyxcbiAgICAnRmlkZWxpZGFkJyxcbiAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nLFxuICAgICdUYW1hXHUwMEYxbycsXG4gICAgJ0VzcGVjaWFsaXphY2lcdTAwRjNuJyxcbiAgICAnVGlwbyBkZSBsb2NhbCcsXG4gICAgJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknLFxuICAgICdNb250byB0b3RhbCAoMTJtKScsXG4gICAgJ0ZhY3R1cmFzICgxMm0pJyxcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknLFxuICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknLFxuICAgICdGYWN0dXJhcyBwb3IgbWVzICgxMm0pJyxcbiAgICAnUHJpbWVyYSBjb21wcmEnLFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnLFxuICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJyxcbiAgXSk7XG4gIGNvbnN0IGVtcHR5S2V5cyA9IG5ldyBTZXQoXG4gICAgYWxsS2V5cy5maWx0ZXIoKGspID0+IHtcbiAgICAgIGlmIChTVFJVQ1RVUkFMX1BST1RFQ1RFRC5oYXMoaykpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChGSUNIQV9QUk9URUNURUQuaGFzKGspKSByZXR1cm4gZmFsc2U7XG4gICAgICByZXR1cm4gcm93cy5ldmVyeSgocikgPT4ge1xuICAgICAgICBjb25zdCB2ID0gcltrXTtcbiAgICAgICAgaWYgKHYgPT09ICcnIHx8IHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgaWYgKE5VTUVSSUNfWkVST19PSy5oYXMoaykgJiYgdiA9PT0gMCkgcmV0dXJuIHRydWU7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICAgIH0pXG4gICk7XG4gIGNvbnN0IGtlcHRLZXlzID0gYWxsS2V5cy5maWx0ZXIoKGspID0+ICFlbXB0eUtleXMuaGFzKGspKTtcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IHJlZ2xhIFwibmluZ3VuYSBjZWxkYSB2YWNcdTAwRURhXCIgXHUyMDE0IGZpbGxEYXNoSW5FbXB0eSBzb2JyZSBUT0RBU1xuICAvLyBsYXMgY29sdW1uYXMgZmluYWxlcyAoY2xhc2lmICsgYnV5ZXIgKyBsZWdhY3kgdmlzaXRhcykuXG4gIGNvbnN0IHJvd3NGaWx0ZXJlZCA9IHJvd3MubWFwKChyKSA9PiB7XG4gICAgY29uc3Qgb3V0ID0ge307XG4gICAga2VwdEtleXMuZm9yRWFjaCgoaykgPT4ge1xuICAgICAgb3V0W2tdID0gcltrXTtcbiAgICB9KTtcbiAgICByZXR1cm4gX2ZpbGxEYXNoKG91dCk7XG4gIH0pO1xuICBjb25zdCByZW1vdmVkQ291bnQgPSBlbXB0eUtleXMuc2l6ZTtcbiAgaWYgKHJlbW92ZWRDb3VudCA+IDApIHtcbiAgICBjb25zb2xlLmxvZyhgW21hc3RlcmZpbGVdIHJlbW92aWRhcyAke3JlbW92ZWRDb3VudH0gY29scyB2YWNcdTAwRURhczpgLCBbLi4uZW1wdHlLZXlzXS5qb2luKCcsICcpKTtcbiAgfVxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHpvbmFcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGFncmVnYXIgY29udGVvIHBvciBUaXBvIGRlIGNsaWVudGUgKyBGaWRlbGlkYWQgKGRvcyBudWV2YXNcbiAgLy8gY29sdW1uYXMgY29uIGRldGFsbGUgcG9yIHpvbmEpLiBGb3JtYXRvIGJyZXZlIFwiQTogTiwgQjogTSwgLTogS1wiIHBhcmFcbiAgLy8gY2FiZXIgZW4gdW5hIHNvbGEgY2VsZGEgbGVnaWJsZS5cbiAgY29uc3QgYnlab25lID0ge307XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGNvbnN0IHogPSByWydFdGlxdWV0YSB6b25hJ10gfHwgJ1NpbiB6b25hJztcbiAgICBpZiAoIWJ5Wm9uZVt6XSkge1xuICAgICAgYnlab25lW3pdID0ge1xuICAgICAgICB0b3RhbDogMCxcbiAgICAgICAgaGFiaWxpdGFkb3M6IDAsXG4gICAgICAgIGNhbmNlbGFkb3M6IDAsXG4gICAgICAgIHRpcG9zOiB7fSxcbiAgICAgICAgZmlkZWxpZGFkZXM6IHt9LFxuICAgICAgfTtcbiAgICB9XG4gICAgYnlab25lW3pdLnRvdGFsKys7XG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xuICAgIGVsc2UgaWYgKHIuRXN0YWRvID09PSAnQ2FuY2VsYWRvJykgYnlab25lW3pdLmNhbmNlbGFkb3MrKztcbiAgICAvLyBUaXBvIGRlIGNsaWVudGU6IHRvbWFyIHByaW1lciBjaGFyIGRlbCBsYWJlbCAoXCJBIC0gLi4uXCIsIFwiQiAtIC4uLlwiLFxuICAgIC8vIFwiUCAoUHJlbWl1bSkuLi5cIiwgXCJDIC0gLi4uXCIpLiBTaSBsYWJlbCBlcyBcIi1cIiBcdTIxOTIgXCItXCIuXG4gICAgY29uc3QgdGlwb0xibCA9IHJbJ1RpcG8gZGUgY2xpZW50ZSddIHx8ICctJztcbiAgICBjb25zdCB0aXBvS2V5ID0gdGlwb0xibCA9PT0gJy0nID8gJy0nIDogU3RyaW5nKHRpcG9MYmwpLnRyaW0oKS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKTtcbiAgICBieVpvbmVbel0udGlwb3NbdGlwb0tleV0gPSAoYnlab25lW3pdLnRpcG9zW3RpcG9LZXldIHx8IDApICsgMTtcbiAgICBjb25zdCBmaWQgPSByLkZpZGVsaWRhZCB8fCAnLSc7XG4gICAgYnlab25lW3pdLmZpZGVsaWRhZGVzW2ZpZF0gPSAoYnlab25lW3pdLmZpZGVsaWRhZGVzW2ZpZF0gfHwgMCkgKyAxO1xuICB9KTtcbiAgZnVuY3Rpb24gX2ZtdERpc3QoZGlzdCkge1xuICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyhkaXN0KS5zb3J0KChhLCBiKSA9PiBiWzFdIC0gYVsxXSk7XG4gICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gJy0nO1xuICAgIHJldHVybiBlbnRyaWVzLm1hcCgoW2ssIHZdKSA9PiBgJHtrfTogJHt2fWApLmpvaW4oJywgJyk7XG4gIH1cbiAgY29uc3QgcmVzdW1lblJvd3MgPSBPYmplY3QuZW50cmllcyhieVpvbmUpXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xuICAgICAgJ1pvbmEgLyBWZW5kZWRvcic6IHosXG4gICAgICAnVG90YWwgdGllbmRhcyc6IGQudG90YWwsXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcbiAgICAgIENhbmNlbGFkYXM6IGQuY2FuY2VsYWRvcyxcbiAgICAgICdQb3IgVGlwbyBkZSBjbGllbnRlJzogX2ZtdERpc3QoZC50aXBvcyksXG4gICAgICAnUG9yIEZpZGVsaWRhZCc6IF9mbXREaXN0KGQuZmlkZWxpZGFkZXMpLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydUb3RhbCB0aWVuZGFzJ10gLSBhWydUb3RhbCB0aWVuZGFzJ10pO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxuICBjb25zdCBzY29wZUxibCA9XG4gICAgc2NvcGVTZXQgPT09IG51bGxcbiAgICAgID8gJ1RPRE9TJ1xuICAgICAgOiBzY29wZVNldC5zaXplID09PSAxXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcbiAgY29uc3QgZm5hbWUgPSAnTWFzdGVyZmlsZV9DbGllbnRlc19TQVBfJyArIHNjb3BlTGJsICsgJ18nICsgdHMgKyAnLnhsc3gnO1xuICBhd2FpdCBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBoYWJpbGl0YWRvcyBTQVAnLCByb3dzOiByb3dzRmlsdGVyZWQgfSxcbiAgICB7IG5hbWU6ICdSZXN1bWVuIHBvciB6b25hJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgZXhwb3J0YWRvcycgK1xuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcbiAgKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0OiBQcmVjaW9zICsgU3RvY2sgcG9yIFNLVVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcbi8vIGVuIG1lbW9yaWE6IFBST0RVQ1RTIChtYXN0ZXIgZGUgU0tVcyksIFBSSUNFX0xJU1RfTUFQIChwcmVjaW8gQVJTIGRlXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cbi8vIEhvamFzOlxuLy8gIC0gXCJQcmVjaW9zIHkgU3RvY2tcIjogdW5hIGZpbGEgcG9yIFNLVSBjb24gdG9kYXMgbGFzIGNvbHVtbmFzIGp1bnRhc1xuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXG4vLyAgLSBcIlN0b2NrXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBlc3RhZG8gZGUgc3RvY2suXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBjYXRhbG9nbyBkZSBwcm9kdWN0b3MgY2FyZ2FkbyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIHByZWNpb3MgKyBzdG9jay4uLicpO1xuICAvLyB2NTc0ICgyMDI2LTA4LTIxKTogbW9zdHJhciBVTklEQURFUyBudW1lcmljYXMgZXhhY3RhcyBkZWwgZGVwb3NpdG8gMTEuXG4gIC8vIHYxMzYzICgyMDI2LTEwLTE5KTogcGVkaWRvIE1hcmlhbm8gXHUyMDE0IGNhbWJpYXIgZGUgXCJzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTFcIiBhXG4gIC8vIFwibGlicmUgcGFyYSBsYSB2ZW50YVwiICg9IGRlcCAxMSBcdTIyMTIgcmVzZXJ2YXMgY29uZmlybWVkL0JPL0FTSUcvd2FpdGxpc3QpLlxuICAvLyBSYXpcdTAwRjNuOiBlbnZpYXIgYWwgY2xpZW50ZSBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBsZSBwdWVkZSBwcm9tZXRlciBIT1kuXG4gIC8vIFNpIHNvbG8gbW9zdHJhbW9zIHN0b2NrIGZcdTAwRURzaWNvLCBwdWVkZSBwYXNhciBxdWUgaGF5YSA1dSBwZXJvIGxhcyA1IGVzdFx1MDBFOW5cbiAgLy8gcmVzZXJ2YWRhcyBcdTIxOTIgZWwgY2xpZW50ZSBzZSBlbnRlcmEgcmVjaVx1MDBFOW4gYWwgaGFjZXIgZWwgcGVkaWRvIHF1ZSBubyBoYXkuXG4gIC8vIFVzYSBnZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgKHB1cmUgZnVuY3Rpb24sIGZpbHRyYSBUVExzKS4gUmV0b3JuYSAnJyBzaVxuICAvLyBubyBoYXkgc25hcHNob3QgY2FyZ2FkbzsgMCBzaSBubyBoYXkgbGlicmUuXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xuICAgIGNvbnN0IGZuUmVhbCA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGVcbiAgICAgICAgOiBudWxsO1xuICAgIGlmIChmblJlYWwpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHYgPSBmblJlYWwoc2t1KTtcbiAgICAgICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgICAgICByZXR1cm4gTnVtYmVyKHYpIHx8IDA7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvLyBmYWxsYmFjayBhIHN0b2NrIGZcdTAwRURzaWNvIGFiYWpvXG4gICAgICB9XG4gICAgfVxuICAgIC8vIEZhbGxiYWNrOiBzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTEgKHNpIGdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSBubyBlc3RcdTAwRTEgZGlzcG9uaWJsZSxcbiAgICAvLyBlai4gYm9vdHN0cmFwIG11eSB0ZW1wcmFubykuXG4gICAgY29uc3QgZm5GaXNpY28gPVxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxuICAgICAgICA6IG51bGw7XG4gICAgY29uc3QgdkYgPSBmbkZpc2ljbyA/IGZuRmlzaWNvKHNrdSkgOiBudWxsO1xuICAgIGlmICh2RiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcih2RikgfHwgMDtcbiAgfVxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xuICB9XG4gIC8vIHYxMzY0ICgyMDI2LTEwLTE5KTogcmV3b3JrIGRlbCBleHBvcnQgcG9yIHBlZGlkbyBNYXJpYW5vOlxuICAvLyAtIEhvamEgcHJpbmNpcGFsIHJlbm9tYnJhZGEgXCJQcmVjaW9zIHkgU3RvY2tcIiAtPiBcIkxpc3RhIGRlIHByZWNpb3NcIi5cbiAgLy8gLSBOdWV2YSBjb2x1bW5hIFwiRGlzcG9uaWJpbGlkYWRcIiAoRElTUE9OSUJMRSB2ZXJkZSBzaSBTdG9jaz4wLCBOTyBESVNQT05JQkxFXG4gIC8vICAgcm9qbyBzaSBTdG9jazw9MCBvIHZhY2lvKS5cbiAgLy8gLSBIb2phIFwiSW5mb1wiIGVsaW1pbmFkYS5cbiAgLy8gLSBOb21icmUgYXJjaGl2bzogUHJlY2lvc195X1N0b2NrX1lZWVktTU0tREQueGxzeCAtPiBMaXN0YV9kZV9QcmVjaW9zX1lZWVktTU0tREQueGxzeC5cbiAgLy8gSG9qYXMgXCJQcmVjaW9zXCIgeSBcIlN0b2NrXCIgc2UgbWFudGllbmVuIHBvciBzaSBNYXJpYW5vIGxhcyB1c2EuXG4gIGZ1bmN0aW9uIGRpc3BMYWJlbChzdG9ja1ZhbCkge1xuICAgIGlmIChzdG9ja1ZhbCA9PT0gJycgfHwgc3RvY2tWYWwgPT0gbnVsbCkgcmV0dXJuICdOTyBESVNQT05JQkxFJztcbiAgICByZXR1cm4gTnVtYmVyKHN0b2NrVmFsKSA+IDAgPyAnRElTUE9OSUJMRScgOiAnTk8gRElTUE9OSUJMRSc7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4ge1xuICAgIGNvbnN0IHN0ID0gZm10U3RvY2socC5jb2RlKTtcbiAgICByZXR1cm4ge1xuICAgICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXG4gICAgICBTdWJmYW1pbGlhOiBwLnN1YiB8fCAnJyxcbiAgICAgIENhdGVnb3JpYTogcC5jYXQgfHwgJycsXG4gICAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICAgICAgU3RvY2s6IHN0LFxuICAgICAgRGlzcG9uaWJpbGlkYWQ6IGRpc3BMYWJlbChzdCksXG4gICAgfTtcbiAgfSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3QgcHJlY2lvc1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICB9KSlcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxuICAgIC5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+IHtcbiAgICBjb25zdCBzdCA9IGZtdFN0b2NrKHAuY29kZSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAgIFN0b2NrOiBzdCxcbiAgICAgIERpc3BvbmliaWxpZGFkOiBkaXNwTGFiZWwoc3QpLFxuICAgIH07XG4gIH0pLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZG93bmxvYWRYbHN4KFxuICAgICdMaXN0YV9kZV9QcmVjaW9zXycgKyB0cyArICcueGxzeCcsXG4gICAgW1xuICAgICAgeyBuYW1lOiAnTGlzdGEgZGUgcHJlY2lvcycsIHJvd3MgfSxcbiAgICAgIHsgbmFtZTogJ1ByZWNpb3MnLCByb3dzOiBwcmVjaW9zUm93cyB9LFxuICAgICAgeyBuYW1lOiAnU3RvY2snLCByb3dzOiBzdG9ja1Jvd3MgfSxcbiAgICBdLFxuICAgIHtcbiAgICAgIC8vIFBhaW50ZXIgYXBsaWNhZG8gcG9zdC1yZW5kZXIgcG9yIGRvd25sb2FkWGxzeC4gUGludGEgbGEgY29sdW1uYVxuICAgICAgLy8gXCJEaXNwb25pYmlsaWRhZFwiIHNlZ3VuIHN1IHZhbG9yOiB2ZXJkZStibGFuY28gc2kgRElTUE9OSUJMRSxcbiAgICAgIC8vIHJvam8rYmxhbmNvIHNpIE5PIERJU1BPTklCTEUuIENlbnRyYWRvICsgYm9sZCBwYXJhIGxlZ2liaWxpZGFkLlxuICAgICAgY2VsbFN0eWxlcjogKGNlbGwsIGNvbHVtbk5hbWUsIF92YWx1ZSwgX3Jvd0luZGV4KSA9PiB7XG4gICAgICAgIGlmIChjb2x1bW5OYW1lICE9PSAnRGlzcG9uaWJpbGlkYWQnKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHR4dCA9IFN0cmluZyhjZWxsLnZhbHVlIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBpZiAodHh0ID09PSAnRElTUE9OSUJMRScpIHtcbiAgICAgICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYxNkEzNEEnIH0gfTsgLy8gZ3JlZW4tNjAwXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUgfTtcbiAgICAgICAgfSBlbHNlIGlmICh0eHQgPT09ICdOTyBESVNQT05JQkxFJykge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkRDMjYyNicgfSB9OyAvLyByZWQtNjAwXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUgfTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9XG4gICk7XG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKGxpc3RhIGRlIHByZWNpb3MgKyBkaXNwb25pYmlsaWRhZCknKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIC0gZGlhbG9nbyBkZSBzZWxlY2Npb24gKyAzIGZvcm1hdG9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBvcGNpb25lcyBzZWd1biByb2wuXG4gIC8vICAgdmVuZGVkb3I6IG9wZXJhdGl2byBkaWFyaW8gKFZlbnRhcyAvIFZpc2l0YXMgLyBSdXRhcykgKyBDbGllbnRlcyBkZSBzdSB6b25hXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxuICAvLyAgIGludGVybm8gKFZESSk6IG1pc21vIHNjb3BlIG9wZXJhdGl2byArIENsaWVudGVzIGRlIHN1cyBwYXJlamFzIChvIHNvbG8gZWxcbiAgLy8gICAgIHByb3BpbyBzaSBlbGlnaW8gc3Ugbm9tYnJlIGVuIGVsIGRyb3Bkb3duIGRlIHpvbmFzKS5cbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cbiAgY29uc3QgYWxsb3dlZEJ5Um9sZSA9IHtcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogVkVOVEFTIHkgUlVUQVMgZWxpbWluYWRvcyBkZWwgVUkgcG9yIHBlZGlkbyBkZSBNYXJpYW5vLlxuICAgIHZlbmRlZG9yOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gICAgaW50ZXJubzogbmV3IFNldChbJ1ZJU0lUQVMnLCAnTUFTVEVSJywgJ0JBQ0tPUkRFUicsICdTVE9DS19BU0lHJywgJ1BFRElET1NfTUVTJ10pLFxuICB9O1xuICBjb25zdCBhbGxvd2VkID0gYWxsb3dlZEJ5Um9sZVt1c2VyUm9sZV0gfHwgbnVsbDsgLy8gbnVsbCA9IHZlciB0b2RvXG4gIC8vIHYxNDEzIFx1MDBBNzUxICsgdjE0MTQgXHUwMEE3NTEuMSAoMjAyNi0xMC0yMik6IElORlJBQ0NJT05FU19NRUxJIHdoaXRlbGlzdCBwb3JcbiAgLy8gZW1haWwuIE1hbnRlbmVyIHNpbmNyb25pemFkbyBjb24gY2FuUmVhZEluZnJhY2Npb25lc01lbGkoKSBkZVxuICAvLyBmaXJlc3RvcmUucnVsZXMuIFJlYWRlcnM6IE1hcmlhbm8gKDIgZW1haWxzKSArIERpZWdvIFZhbHNpLlxuICBjb25zdCBJTkZSQUNDSU9ORVNfTUVMSV9SRUFERVJTID0gW1xuICAgICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbScsXG4gICAgJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJyxcbiAgICAnZGllZ28udmFsc2lAc2hpbWFuby51eScsXG4gIF07XG4gIGNvbnN0IF9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSA9XG4gICAgdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIGN1cnJlbnRVc2VyICYmXG4gICAgSU5GUkFDQ0lPTkVTX01FTElfUkVBREVSUy5pbmNsdWRlcygoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpO1xuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICBjb25zdCBraW5kID0gZWwuZGF0YXNldC5leHBLaW5kIHx8ICcnO1xuICAgIGxldCBzaG93ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCk7XG4gICAgaWYgKGtpbmQgPT09ICdJTkZSQUNDSU9ORVNfTUVMSScgJiYgIV9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSkgc2hvdyA9IGZhbHNlO1xuICAgIGVsLnN0eWxlLmRpc3BsYXkgPSBzaG93ID8gJycgOiAnbm9uZSc7XG4gIH0pO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTW9udGggcGlja2VyIHJldXRpbGl6YWJsZSBwYXJhIGxvcyA1IHRpcG9zIGRlIGV4cG9ydFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuY29uc3QgRVhQT1JUX1RZUEVfTEFCRUxTID0ge1xuICBWRU5UQVM6ICdWZW50YXMnLFxuICBWSVNJVEFTOiAnVmlzaXRhcycsXG4gIFJFTkRJQ0lPTkVTOiAnUmVuZGljaW9uZXMnLFxuICBSVVRBUzogJ1J1dGFzJyxcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXG4gIEJBQ0tPUkRFUjogJ0JhY2tvcmRlcicsXG4gIFNUT0NLX0FTSUc6ICdTdG9jayBBc2lnbmFkbycsXG4gIFBFRElET1NfTUVTOiAnUGVkaWRvcyBkZWwgbWVzJyxcbn07XG5cbndpbmRvdy5zaG93TW9udGhQaWNrZXIgPSBmdW5jdGlvbiAodGlwbykge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSB0aXBvO1xuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXN1YnQnKTtcbiAgdGl0bGUudGV4dENvbnRlbnQgPSAnRXhwb3J0YXIgJyArIChFWFBPUlRfVFlQRV9MQUJFTFNbdGlwb10gfHwgdGlwbyk7XG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcbiAgLy8gUG9wdWxhdGUgc2VsZWN0c1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XG4gIG1lc1NlbC5pbm5lckhUTUwgPVxuICAgICc8b3B0aW9uIHZhbHVlPVwiQUxMXCI+VG9kb3MgbG9zIG1lc2VzIChhXHUwMEYxbyBlbnRlcm8pPC9vcHRpb24+JyArXG4gICAgTUVTRVMubWFwKChtLCBpKSA9PiAnPG9wdGlvbiB2YWx1ZT1cIicgKyBpICsgJ1wiPicgKyBtICsgJzwvb3B0aW9uPicpLmpvaW4oJycpO1xuICBtZXNTZWwudmFsdWUgPSBub3cuZ2V0TW9udGgoKTtcbiAgY29uc3QgYW5pb1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJyk7XG4gIGNvbnN0IHllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcbiAgbGV0IHlvcHRzID0gJyc7XG4gIGZvciAobGV0IHkgPSB5ZWFyIC0gMzsgeSA8PSB5ZWFyICsgMTsgeSsrKVxuICAgIHlvcHRzICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIHkgKyAnXCI+JyArIHkgKyAnPC9vcHRpb24+JztcbiAgYW5pb1NlbC5pbm5lckhUTUwgPSB5b3B0cztcbiAgYW5pb1NlbC52YWx1ZSA9IHllYXI7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xuXG53aW5kb3cuY2xvc2VNb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xufTtcblxud2luZG93LmNvbmZpcm1Nb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xuICBjb25zdCBtZXNSYXcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJykudmFsdWU7XG4gIGNvbnN0IGFuaW8gPSBwYXJzZUludChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpLnZhbHVlLCAxMCk7XG4gIGNvbnN0IG1vbnRoSWR4ID0gbWVzUmF3ID09PSAnQUxMJyA/IG51bGwgOiBwYXJzZUludChtZXNSYXcsIDEwKTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuICBpZiAoIXRpcG8pIHJldHVybjtcbiAgdHJ5IHtcbiAgICBpZiAodGlwbyA9PT0gJ1ZFTlRBUycpIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JFTkRJQ0lPTkVTJykgZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JVVEFTJykgZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0FMVEFTJykgZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0JBQ0tPUkRFUicpIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnU1RPQ0tfQVNJRycpIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUEVESURPU19NRVMnKSBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWRU5UQVNfQVJUX0NMSScpIGV4cG9ydFZlbnRhc0FydENsaUZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGFsZXJ0KCdUaXBvIGRlc2Nvbm9jaWRvOiAnICsgdGlwbyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnQgJyArIHRpcG8sIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gU3RyaW5nKGFuaW8pO1xuICByZXR1cm4gTUVTRVNbbW9udGhJZHhdICsgJ18nICsgYW5pbztcbn1cblxuLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWVzY3JpdG8gY29uIEV4Y2VsSlMgcGFyYSBkYXIgVUkgdW5pZm9ybWUgYSBUT0RPUyBsb3Ncbi8vIGV4cG9ydHMgKGhlYWRlciB2ZXJkZSArIGNlbGRhcyBjZW50ZXJlZCArIGJvcmRlciBzdXRpbCArIGF1dG8tZml0IHdpZHRoKS5cbi8vIEFudGVzIHVzYWJhIFhMU1ggU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmEgc2lsZW50bHkgbG9zIGVzdGlsb3MgZGUgY2VsZGEuIEVsXG4vLyBwYXR0ZXJuIHZlcmRlIHJlcGxpY2EgZWwgVE9UQUwgYmFyIGRlIGV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsIChtb2RhbFxuLy8gQmFja29yZGVyIHY3MjArKS4gRXhjZWxKUyB5YSBzZSBjYXJnYSBvbi1kZW1hbmQgdmlhIHdpbmRvdy5sb2FkRXhjZWxKUy5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzLCBvcHRzKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgd2luZG93LmxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnTm8gc2UgcHVkbyBjYXJnYXIgRXhjZWxKUzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIGNvbnN0IEhFQURFUl9GSUxMID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMTY2NTM0JyB9IH07XG4gIGNvbnN0IEhFQURFUl9GT05UID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gIGNvbnN0IENFTlRFUiA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgY29uc3QgQk9SREVSX1RISU4gPSB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9O1xuICBjb25zdCBCT1JERVIgPSB7IHRvcDogQk9SREVSX1RISU4sIGxlZnQ6IEJPUkRFUl9USElOLCBib3R0b206IEJPUkRFUl9USElOLCByaWdodDogQk9SREVSX1RISU4gfTtcbiAgLy8gdjEzNjQ6IGNlbGxTdHlsZXIgb3BjaW9uYWwgcGFyYSBjb2xvcmVhciBjZWxkYXMgcG9yIHZhbG9yIChlai4gY29sdW1uYVxuICAvLyBEaXNwb25pYmlsaWRhZCBESVNQT05JQkxFIHZlcmRlIC8gTk8gRElTUE9OSUJMRSByb2pvIGVuIGVsIGV4cG9ydFxuICAvLyBMaXN0YSBkZSBwcmVjaW9zKS4gU2lnbmF0dXJlOiAoY2VsbCwgY29sdW1uTmFtZSwgdmFsdWUsIHJvd0luZGV4KSA9PiB2b2lkLlxuICBjb25zdCBjZWxsU3R5bGVyID0gb3B0cyAmJiB0eXBlb2Ygb3B0cy5jZWxsU3R5bGVyID09PSAnZnVuY3Rpb24nID8gb3B0cy5jZWxsU3R5bGVyIDogbnVsbDtcblxuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQocy5uYW1lLnNsaWNlKDAsIDMxKSk7XG4gICAgY29uc3Qgcm93cyA9IHMucm93cy5sZW5ndGggPyBzLnJvd3MgOiBbeyBBdmlzbzogJ1NpbiBkYXRvcyBwYXJhIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvJyB9XTtcbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmtleXMocm93c1swXSk7XG5cbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5hZGRSb3coaGVhZGVycyk7XG4gICAgaGVhZGVyUm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICBjZWxsLmZpbGwgPSBIRUFERVJfRklMTDtcbiAgICAgIGNlbGwuZm9udCA9IEhFQURFUl9GT05UO1xuICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICBjZWxsLmJvcmRlciA9IEJPUkRFUjtcbiAgICB9KTtcbiAgICBoZWFkZXJSb3cuaGVpZ2h0ID0gMjY7XG5cbiAgICBmb3IgKGxldCBySWR4ID0gMDsgcklkeCA8IHJvd3MubGVuZ3RoOyBySWR4KyspIHtcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3NbcklkeF07XG4gICAgICBjb25zdCB2YWx1ZXMgPSBoZWFkZXJzLm1hcCgoaCkgPT4gKHJvd1toXSAhPT0gdW5kZWZpbmVkICYmIHJvd1toXSAhPT0gbnVsbCA/IHJvd1toXSA6ICcnKSk7XG4gICAgICBjb25zdCBkYXRhUm93ID0gd3MuYWRkUm93KHZhbHVlcyk7XG4gICAgICBkYXRhUm93LmVhY2hDZWxsKChjZWxsLCBjb2xOdW1iZXIpID0+IHtcbiAgICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgICAgICBpZiAoY2VsbFN0eWxlcikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjZWxsU3R5bGVyKGNlbGwsIGhlYWRlcnNbY29sTnVtYmVyIC0gMV0sIHZhbHVlc1tjb2xOdW1iZXIgLSAxXSwgcklkeCk7XG4gICAgICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgICAgIC8vIG5vLW9wOiBubyByb21wZXIgZWwgZXhwb3J0IHBvciB1biBlcnJvciBkZSBzdHlsZXJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGhlYWRlcnMuZm9yRWFjaCgoaCwgaSkgPT4ge1xuICAgICAgbGV0IG1heExlbiA9IFN0cmluZyhoKS5sZW5ndGg7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHYgPSBTdHJpbmcocm93W2hdID09PSB1bmRlZmluZWQgfHwgcm93W2hdID09PSBudWxsID8gJycgOiByb3dbaF0pLnNwbGl0KCdcXG4nKVswXTtcbiAgICAgICAgaWYgKHYubGVuZ3RoID4gbWF4TGVuKSBtYXhMZW4gPSB2Lmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIHdzLmdldENvbHVtbihpICsgMSkud2lkdGggPSBNYXRoLm1pbig2MCwgTWF0aC5tYXgoMTAsIG1heExlbiArIDQpKTtcbiAgICB9KTtcblxuICAgIHdzLnZpZXdzID0gW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV07XG4gIH1cblxuICBjb25zdCBidWYgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gIH0pO1xuICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICBhLmhyZWYgPSB1cmw7XG4gIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgYS5jbGljaygpO1xuICBhLnJlbW92ZSgpO1xuICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldE1lcyA9IG1vbnRoSWR4ICE9PSBudWxsID8gTUVTRVNbbW9udGhJZHhdLnRvVXBwZXJDYXNlKCkgOiBudWxsO1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xuICAgIGl0ZW1zLnB1c2godik7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMgeSBDb250YWN0b3MnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnQW5pbycsIGtleTogJ2FuaW8nLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnSW50ZXJhY2Npb24nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnRm9ybWEgQ29udGFjdG8nLCBrZXk6ICdmb3JtYUNvbnRhY3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdSZXN1bHRhZG8gQ29udGFjdG8nLCBrZXk6ICdyZXN1bHRhZG9DdCcsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnUHJvdmluY2lhJywga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRmlkZWxpZGFkJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdOZWNlc2lkYWQgUHVudHVhbCcsIGtleTogJ25lYycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBWZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBQcmVndW50YW4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnQXl1ZGEgVGllbmRhJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gVmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgTW9zdHJhZG9yJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywga2V5OiAncEVjb20nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBTdGF0dXMnLCBrZXk6ICdncHNTdCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnR1BTIERpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFbiBub21icmUgZGUgVkRFJywga2V5OiAnb25CZWhhbGYnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NhcmdhZG8gUG9yJywga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcbiAgY29uc3QgUk9XX0ggPSAxMDA7XG4gIGNvbnN0IElNR19XID0gMTMwO1xuICBjb25zdCBJTUdfSCA9IDkwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XG4gICAgaWYgKGlzQ29udGFjdG8pIHtcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcbiAgICB9XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcbiAgICAgIGFuaW86IHYuYW5pbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcbiAgICAgIGZvcm1hQ29udGFjdG86IGZvcm1hQ29udGFjdG9MYmwsXG4gICAgICByZXN1bHRhZG9DdDogcmVzdWx0YWRvQ3RMYmwsXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgbmVjOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxuICAgICAgZ3BzU3Q6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdi5ncHNEaXN0YW5jZU0gIT0gbnVsbCA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXG4gICAgICBvbkJlaGFsZjogdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICBjcmVhdGVkQnk6IHYuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgdi5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdDb25jZXB0bycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdOIFRpY2tldCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnTW9kbyBwYWdvJywga2V5OiAnbW9kb1BhZ28nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gZ2FzdG8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0RpdmlzaW9uJywga2V5OiAnZGl2aXNpb24nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNb25lZGEnLCBrZXk6ICdtb25lZGEnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUgVVNEJywga2V5OiAnaW1wb3J0ZVVzZCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byB0aWNrZXQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFc3RhZG8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvcicsIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG8gZW4nLCBrZXk6ICdhcHJvYmFkb0VuJywgd2lkdGg6IDE0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcbiAgY29uc3QgUk9XX0ggPSAxMTA7XG4gIGNvbnN0IElNR19XID0gMTQwO1xuICBjb25zdCBJTUdfSCA9IDEwMDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgciA9IGl0LnI7XG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XG4gICAgY29uc3Qgb2JzU3RyID1cbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBlbWFpbDogci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxuICAgICAgbW9kb1BhZ286IHIubW9kb1BhZ28gfHwgJycsXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxuICAgICAgZGl2aXNpb246IHIuZGl2aXNpb25HYXN0byB8fCAnJyxcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXG4gICAgICBtb25lZGE6IHIubW9uZWRhIHx8ICdQRVNPUycsXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcbiAgICAgIG9iczogb2JzU3RyLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcbiAgICAgIGFwcm9iYWRvcjogci5hcHByb3ZlckVtYWlsIHx8IHIuYXByb2JhZG9yIHx8ICcnLFxuICAgICAgYXByb2JhZG9FbjpcbiAgICAgICAgci5hcHByb3ZlZEF0ICYmIHIuYXBwcm92ZWRBdC50b0RhdGUgPyByLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBTSUVNUFJFIGVtYmViZXIgbGEgZm90byAobm8gZGVqYXIgaHlwZXJsaW5rKS5cbiAgICAvLyBBbnRlczogc2kgZm90b1RpY2tldFVybCAoU3RvcmFnZSksIHF1ZWRhYmEgY29tbyBoeXBlcmxpbmsgQWJyaXIgdGlja2V0LlxuICAgIC8vIEFob3JhOiBmZXRjaCBkZWwgVVJMICsgY29udmVydGlyIGEgYXJyYXlCdWZmZXIgKyBlbWJlYmVyIGlndWFsIHF1ZSBkYXRhVVJMLlxuICAgIC8vIEZhbGxiYWNrIGEgaHlwZXJsaW5rIHNvbG8gc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCwgZXRjKS5cbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBmZXRjaCBsYSBmb3RvIGRlc2RlIFN0b3JhZ2UgeSBlbWJlYmVybGEgY29tbyBpbWFnZW4uXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2goci5mb3RvVGlja2V0VXJsKTtcbiAgICAgICAgaWYgKCFyZXNwLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHJlc3Auc3RhdHVzKTtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwLmhlYWRlcnMuZ2V0KCdjb250ZW50LXR5cGUnKSB8fCAnaW1hZ2UvanBlZyc7XG4gICAgICAgIGxldCBleHQgPSBjb250ZW50VHlwZS5zcGxpdCgnLycpWzFdIHx8ICdqcGVnJztcbiAgICAgICAgZXh0ID0gZXh0LnNwbGl0KCc7JylbMF0udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHJlc3AuYXJyYXlCdWZmZXIoKTtcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYnVmZmVyOiBidWYsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBGYWxsYmFjazogc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCksIGRlamFyIGh5cGVybGluayBjb21vIGFudGVzLlxuICAgICAgICBjb25zb2xlLndhcm4oJ2ZldGNoIGZvdG8gcmVuZGljaW9uIGZhbGxvLCBkZWpvIGh5cGVybGluaycsIGl0LmlkLCBlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XG4gICAgICAgICAgY2VsbC52YWx1ZSA9IHtcbiAgICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxuICAgICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXG4gICAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXIgKGZldGNoIGZhbGxvKScsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XG4gICAgICAgIH0gY2F0Y2ggKF9lMikge31cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUlVUQVM6IHJ1dGFzIGFzaWduYWRhcyBkZWwgcGVyaW9kbyArIG92ZXJyaWRlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPVxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXG4gICAgICA6IGFzc2lnbmVkVmVuZG9yXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxuICAgICAgICA6IFtdO1xuICBjb25zdCBtb250aHNUb0V4cG9ydCA9IG1vbnRoSWR4ICE9PSBudWxsID8gW21vbnRoSWR4XSA6IFswLCAxLCAyLCAzLCA0LCA1LCA2LCA3LCA4LCA5LCAxMCwgMTFdO1xuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2YgbW9udGhzVG9FeHBvcnQpIHtcbiAgICAgIGxldCBydXRhcztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgcnV0YXMgPSBbXTtcbiAgICAgIH1cbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPdmVycmlkZXNcbiAgbGV0IG92clNuYXA7XG4gIHRyeSB7XG4gICAgb3ZyU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm91dGVfb3ZlcnJpZGVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgb3ZyU25hcCA9IG51bGw7XG4gIH1cbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xuICBpZiAob3ZyU25hcCkge1xuICAgIG92clNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxuICAgICAgICBNZXM6IE1FU0VTW3BhcnNlSW50KG8ubW9udGhJZHgsIDEwKV0gfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBvLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcbiAgICAgICAgRGVyaXZhZGFfQTogby5kZXJpdmFkYUEgfHwgJycsXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX1Bvcjogby5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX0VuOlxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1J1dGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcbiAgICB7IG5hbWU6ICdEZXJpdmFjaW9uZXMtUmVhZ2VuZGFzJywgcm93czogb3ZlcnJpZGVzUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBSdXRhcyBsaXN0byAoJyArIHJ1dGFzUm93cy5sZW5ndGggKyAnIHRpZW5kYXMsICcgKyBvdmVycmlkZXNSb3dzLmxlbmd0aCArICcgb3ZlcnJpZGVzKScsXG4gICAgMjQwMFxuICApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFMVEFTOiBzb2xpY2l0dWRlcyBkZSBhbHRhIGRlIGNsaWVudGUgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSAnJztcbiAgICBpZiAoYS5jcmVhdGVkQXQgJiYgYS5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXG4gICAgICBBcHJvYmFkb19FbjpcbiAgICAgICAgYS5hcHByb3ZlZEF0ICYmIGEuYXBwcm92ZWRBdC50b0RhdGUgPyBhLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEFsdGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIHNvbGljaXR1ZGVzKScsIDI0MDApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHY3MDkgKDIwMjYtMDgtMjgpOiAzIGV4cG9ydHMgbnVldm9zIHBlZGlkb3MgcG9yIE1hcmlhbm8uXG4vLyAtIEJBQ0tPUkRFUjogbGluZWFzIHN0YXRlPUJPIG9wZW4gcG9yIG1lcyBkZSBjcmVhdGVkQXQgZGVsIHBlZGlkby5cbi8vIC0gU1RPQ0tfQVNJRzogbGluZWFzIEFTSUcgb3BlbiAobyBCTytzdG9jayBkaXNwKSBwb3IgbWVzIGRlIGNyZWF0ZWRBdC5cbi8vIC0gUEVESURPU19NRVM6IFRPRE9TIGxvcyBwZWRpZG9zIGNyZWFkb3MgZW4gZWwgbWVzL2FuaW8gKGN1YWxxdWllciBzdGFnZSkuXG4vLyBGdWVudGU6IGdsb2JhbFBlZGlkb3MgKGxvIHF1ZSBsYSBhcHAgeWEgdGllbmUgZW4gbWVtb3JpYSkuXG4vLyBGaWx0ZXIgbWVzL2FcdTAwRjFvOiBzb2JyZSBjcmVhdGVkQXQgZGVsIHBlZGlkby4gbW9udGhJZHg9bnVsbCAtPiBhXHUwMEYxbyBlbnRlcm8uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmZ1bmN0aW9uIF9wZWRpZG9Nb250aFllYXIocCkge1xuICBjb25zdCBjYSA9IHAuY3JlYXRlZEF0O1xuICBpZiAoIWNhKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIGxldCBkdCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY2EgPT09ICdzdHJpbmcnKSBkdCA9IG5ldyBEYXRlKGNhKTtcbiAgZWxzZSBpZiAodHlwZW9mIGNhLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICBkdCA9IGNhLnRvRGF0ZSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGVsc2UgaWYgKHR5cGVvZiBjYSA9PT0gJ251bWJlcicpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBpZiAoIWR0IHx8IE51bWJlci5pc05hTihkdC5nZXRUaW1lKCkpKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIHJldHVybiB7IHk6IGR0LmdldEZ1bGxZZWFyKCksIG06IGR0LmdldE1vbnRoKCkgfTtcbn1cblxuZnVuY3Rpb24gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGNvbnN0IGFyciA9XG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gIHJldHVybiBhcnIuZmlsdGVyKChwKSA9PiB7XG4gICAgaWYgKCFwKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgeyB5LCBtIH0gPSBfcGVkaWRvTW9udGhZZWFyKHApO1xuICAgIGlmICh5ID09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoeSAhPT0gYW5pbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBtICE9PSBtb250aElkeCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyLi4uJyk7XG4gIC8vIHYxMTAwOiBkZWxlZ2EgYWwgbVx1MDBGM2R1bG8gcHVyby4gRmlsdHJhIHBvciBtZXMgdlx1MDBFRGEgZmlsdGVycy5tZXNZWVlZTU1cbiAgLy8gKHF1ZSBlbCBtXHUwMEYzZHVsbyBhcGxpY2Egc29icmUgY29uZmlybWVkQXQpLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgbWVzWVlZWU1NID0gYW5pbyArICctJyArIFN0cmluZyhtb250aElkeCArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxuICAvLyBub3JtYWxpemFjaVx1MDBGM24gZGUgc3RyaW5ncykgeSBzXHUwMEYzbG8gY2FlciBhbCBjbGllbnRMb2NJZCBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc28uXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xuICAgICAgICBjYWNoZS5mb3JFYWNoKChjbURhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGNtRGF0YS5hc3NpZ25lZFZlbmRvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgICAgfVxuICAgICAgcmV0dXJuICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBwZWRpZG9zLFxuICAgICAgICAndXJnZW50ZScsXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHFvID0gYy5xdHlCYWNrb3JkZXIgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBjYW50aWRhZFBlZGlkYSA9IHFvO1xuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkge1xuICAgICAgICBjYW50aWRhZFBlZGlkYSA9IE51bWJlcihwLmxpbmVzW2lkeF0ucXR5KSB8fCBxbztcbiAgICAgICAgbGluZWFJZHggPSBpZHg7XG4gICAgICB9XG4gICAgfVxuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1BlZGlkYTogY2FudGlkYWRQZWRpZGEsXG4gICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKGMucHJlY2lvIHx8IDApKSxcbiAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXG4gICAgICBTUV9Eb2NOdW06IGMuc3FEb2NOdW0gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkby4uLicpO1xuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8gbW9kbyBhc2lnbmFjaW9uLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgbWVzWVlZWU1NID0gYW5pbyArICctJyArIFN0cmluZyhtb250aElkeCArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxuICAvLyBub3JtYWxpemFjaVx1MDBGM24gZGUgc3RyaW5ncykgeSBzXHUwMEYzbG8gY2FlciBhbCBjbGllbnRMb2NJZCBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc28uXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xuICAgICAgICBjYWNoZS5mb3JFYWNoKChjbURhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGNtRGF0YS5hc3NpZ25lZFZlbmRvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgICAgfVxuICAgICAgcmV0dXJuICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBwZWRpZG9zLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbi8vIHY3MzcgKDIwMjYtMDgtMzApOiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kb3MgbG9zIGJhY2tvcmRlcnMgb3BlbiAoc2luIGZpbHRyb1xuLy8gZGUgbWVzKS4gTW90aXZvOiBsb3MgNjIgcGVkaWRvcyBtaWdyYWRvcyBkZXNkZSBTQVAgZWwgMjAyNi0wOC0yOCB0aWVuZW5cbi8vIGNyZWF0ZWRBdCBkZSBmZWNoYXMgdmllamFzIGRlbCBTQVAgU1Egb3JpZ2luYWwsIGVudG9uY2VzIGVsIGV4cG9ydCBwb3IgbWVzXG4vLyBubyBsb3MgaW5jbHVpYS4gVmVyc2lvbiBcImN1cnJlbnQgc3RhdHVzXCIgcXVlIGl0ZXJhIGdsb2JhbFBlZGlkb3MgY29tcGxldG8uXG53aW5kb3cuZXhwb3J0QmFja29yZGVyQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIgKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjE0ODggXHUwMEE3ODYgKDIwMjYtMTAtMjcgQlVHIEZJWCk6IHVzYXIgbGEgTUlTTUEgcHVyZSBmbiBxdWUgZWwgbW9kYWwgZXhwb3J0XG4gIC8vIChgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3NgKS4gQW50ZXMgdjE0ODg6IHBhbmVsIHVzYWJhXG4gIC8vIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXMoe30pYCBzaW4gYGluY2x1ZGVFeHBpcmVkYCBcdTIxOTIgb2N1bHRhYmEgQk9zID4gOTBkLlxuICAvLyBNb2RhbCB1c2FiYSBgY29tcHV0ZUJhY2tvcmRlclNrdU1hcCguLi4sIHtpbmNsdWRlRXhwaXJlZDp0cnVlfSlgIFx1MjE5MiBsb3NcbiAgLy8gaW5jbHVcdTAwRURhLiBEZWx0YSBtZWRpZG8gZW4gcHJvZDogMjIyIHVuaWRhZGVzIChtb2RhbCA3Njk2IHZzIHBhbmVsIDc0NzQpLlxuICAvLyBGaXg6IHB1cmUgZm4gXHUwMEZBbmljYSBjb24gZGVmYXVsdCBgaW5jbHVkZUV4cGlyZWQ9dHJ1ZWAgKGFsaW5lYWRvIGNvbiBcdTAwQTc0MC4xXG4gIC8vIHkgZ2V0U3RvY2tCcmVha2Rvd24uYmFja29yZGVyQXBwLnRvdGFsIFx1MjAxNCBsYSBjb2xhIGNvbXBsZXRhKS5cbiAgY29uc3QgYXJyID1cbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgY29uc3QgdG90YWxQZWRpZG9zT3BlbiA9IGFyci5maWx0ZXIoKHApID0+IHAgJiYgIXAuY2xvc2VkQXQpLmxlbmd0aDtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgIT09ICdmdW5jdGlvbicgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICBjb25zdCBjbURhdGEgPSB3LmNsaWVudE1hc3RlckNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogcHVyZSBmbiBcdTAwRkFuaWNhIGBjb21wdXRlQmFja29yZGVyRXhwb3J0Um93c2AgKHJlZW1wbGF6YSBlbFxuICAvLyBwYXRoIGhpc3RcdTAwRjNyaWNvIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXNgIHF1ZSBubyBjb25zb2xpZGFiYSB5IHBlcmRcdTAwRURhXG4gIC8vIEJPcyA+IDkwZCkuIFBhbmVsIHBhc2EgYHt9YCBcdTIxOTIgdHJhZSB0b2RhIGxhIGNvbGEgc2luIGZpbHRyb3MgbWFudWFsZXMuXG4gIGNvbnN0IF9leHBvcnRGbiA9XG4gICAgdy5fX3BoYXNlMCAmJlxuICAgIHcuX19waGFzZTAucHVyZSAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0LmNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzO1xuICBjb25zdCBkZXBzID0ge1xuICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICBjYW5vblZlbmRvcjpcbiAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9leHBvcnRSZXN1bHQgPSBfZXhwb3J0Rm5cbiAgICA/IF9leHBvcnRGbihhcnIsIHt9LCBkZXBzKVxuICAgIDogeyByb3dzOiBbXSwgdG90YWxVbmlkYWRlczogMCwgdG90YWxGaWxhczogMCwgZmlsdHJvc0FwbGljYWRvczoge30gfTtcbiAgY29uc3Qgcm93cyA9IF9leHBvcnRSZXN1bHQucm93cztcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoXG4gICAgICAnRXhwb3J0IEJhY2tvcmRlciB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlCYWNrb3JkZXI+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IGJhY2tvcmRlciBhYmllcnRvIGFob3JhIG1pc21vICh0b2RvIGNvbmZpcm1lZCwgY2VycmFkbyBvIHZlbmNpZG8pXFxuJyArXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcbiAgICAgICAgJzMuIFRvZGFzIGxhcyBsaW5lYXMgQk8gdGllbmVuIHN0b2NrIGRpc3BvbmlibGUgKGZ1ZXJvbiBwcm9tb3ZpZGFzIGEgQVNJRyB2aXJ0dWFsKSdcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICAvLyB2MTM2NiAoMjAyNi0xMC0xOSk6IGhvamEgXCJSZXN1bWVuXCIgY29uIGxvcyBNSVNNT1MgdG90YWxlcyBxdWUgZWwgbW9kYWxcbiAgLy8gQmFja29yZGVyIChjb21wdXRlQmFja29yZGVyU2t1TWFwIHBvc3QtY29uc29saWRhY2lvbiBwb3IgY2xpZW50ZSkuIEFudGVzXG4gIC8vIGVsIGV4cG9ydCBkdW1wZWFiYSBsaW5lYXMgY3J1ZGFzIHNpbiBuaW5ndW4gdG90YWwgXHUyMTkyIE1hcmlhbm8gc3VtYWJhIGxhXG4gIC8vIGNvbHVtbmEgU3VidG90YWxfQk9fQVJTIHkgZWwgdmFsb3IgcG9kaWEgZGl2ZXJnZXIgZGVsIG1vZGFsIGN1YW5kbyB1blxuICAvLyBjbGllbnRlIHRlbmlhIHZhcmlhcyBsaW5lYXMgQk8gZGVsIG1pc21vIFNLVSBjb24gcHJlY2lvcyBkaXN0aW50b3MgKGVsXG4gIC8vIG1vZGFsIGNvbnNvbGlkYSB1c2FuZG8gZWwgcHJlY2lvIGRlIGxhIDFyYSBsaW5lYSBwcm9jZXNhZGE7IGVsIGV4cG9ydFxuICAvLyB1c2EgZWwgcHJlY2lvIGRlIGNhZGEgbGluZWEgaW5kaXZpZHVhbCkuXG4gIGNvbnN0IF9jb21wdXRlU2t1TWFwRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclNrdU1hcDtcbiAgY29uc3QgX21vZGFsRGVwcyA9IHtcbiAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgY2Fub25WZW5kb3I6XG4gICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgYmFja29yZGVyTGluZXM6IEFycmF5LmlzQXJyYXkody5iYWNrb3JkZXJMaW5lcykgPyB3LmJhY2tvcmRlckxpbmVzIDogW10sXG4gICAgc2FwR2V0Q2xpZW50ZUNvZGU6IHR5cGVvZiB3LnNhcEdldENsaWVudGVDb2RlID09PSAnZnVuY3Rpb24nID8gdy5zYXBHZXRDbGllbnRlQ29kZSA6IHVuZGVmaW5lZCxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9tb2RhbEZpbHRlcnMgPSB7XG4gICAgdGllbmRhUXVlcnk6ICcnLFxuICAgIHZlbmRvcktleTogJycsXG4gICAgbWVzWVlZWU1NOiAnJyxcbiAgICB1cmdlbmN5RmlsdGVyOiAnJyxcbiAgICBpbmNsdWRlRXhwaXJlZDogdHJ1ZSxcbiAgICBhZ2dyZWdhdGlvbk1vZGU6ICdmaWZvJyxcbiAgfTtcbiAgY29uc3QgX21vZGFsUmVzdWx0ID0gX2NvbXB1dGVTa3VNYXBGblxuICAgID8gX2NvbXB1dGVTa3VNYXBGbihhcnIsICd1cmdlbnRlJywgX21vZGFsRmlsdGVycywgX21vZGFsRGVwcylcbiAgICA6IHsgc2t1czogW10sIHRvdGFsVW5pZGFkZXM6IDAsIHRvdGFsQ2xpZW50ZXM6IDAgfTtcbiAgbGV0IHRvdGFsUGVzb3NNb2RhbCA9IDA7XG4gIGNvbnN0IHN1YnRvdGFsZXNQb3JVcmdlbmN5ID0geyB1cmdlbnRlOiAwLCBwYXJjaWFsOiAwIH07XG4gIGZvciAoY29uc3QgZyBvZiBfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkge1xuICAgIGNvbnN0IHVyZyA9IGcudXJnZW5jeSB8fCAndXJnZW50ZSc7XG4gICAgZm9yIChjb25zdCBjIG9mIGcuY2xpZW50ZXMgfHwgW10pIHtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihjLnF0eUJhY2tvcmRlcikgfHwgMDtcbiAgICAgIGlmIChxdHkgPD0gMCkgY29udGludWU7XG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIoYy5wcmVjaW8pIHx8IDA7XG4gICAgICBjb25zdCBzdWIgPSBxdHkgKiBwcmVjaW87XG4gICAgICB0b3RhbFBlc29zTW9kYWwgKz0gc3ViO1xuICAgICAgaWYgKHVyZyA9PT0gJ3BhcmNpYWwnKSBzdWJ0b3RhbGVzUG9yVXJnZW5jeS5wYXJjaWFsICs9IHN1YjtcbiAgICAgIGVsc2Ugc3VidG90YWxlc1BvclVyZ2VuY3kudXJnZW50ZSArPSBzdWI7XG4gICAgfVxuICB9XG4gIGNvbnN0IHRvdGFsVW5pZGFkZXNNb2RhbCA9IF9leHBvcnRSZXN1bHQudG90YWxVbmlkYWRlcyB8fCBfbW9kYWxSZXN1bHQudG90YWxVbmlkYWRlcyB8fCAwO1xuICBjb25zdCB0b3RhbENsaWVudGVzTW9kYWwgPSBfbW9kYWxSZXN1bHQudG90YWxDbGllbnRlcyB8fCAwO1xuICBjb25zdCB0b3RhbFNrdXNNb2RhbCA9IChfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkubGVuZ3RoO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogZmlsYSBkZSBlbmNhYmV6YWRvIFwiRmlsdHJvcyBhcGxpY2Fkb3NcIiBwYXJhIHRyYW5zcGFyZW5jaWEuXG4gIGNvbnN0IF9mbXRGaWx0cm9zID1cbiAgICB3Ll9fcGhhc2UwICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydCAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQuZm9ybWF0QmFja29yZGVyRmlsdHJvc0hlYWRlcjtcbiAgY29uc3QgZmlsdHJvc0xibCA9IF9mbXRGaWx0cm9zID8gX2ZtdEZpbHRyb3MoX2V4cG9ydFJlc3VsdC5maWx0cm9zQXBsaWNhZG9zKSA6ICdGaWx0cm9zOiBuaW5ndW5vJztcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXG4gICAgeyBNZXRyaWNhOiBmaWx0cm9zTGJsLCBWYWxvcjogJycgfSxcbiAgICB7IE1ldHJpY2E6ICdUT1RBTCBCYWNrb3JkZXIgQVJTJywgVmFsb3I6IE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1NLVXMgY29uIGJhY2tvcmRlcicsIFZhbG9yOiB0b3RhbFNrdXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1VuaWRhZGVzIHBlbmRpZW50ZXMnLCBWYWxvcjogTWF0aC5yb3VuZCh0b3RhbFVuaWRhZGVzTW9kYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnUGFyZXMgY2xpZW50ZStTS1UgKGZpbGFzIGVuIGhvamEgQmFja29yZGVyKScsIFZhbG9yOiByb3dzLmxlbmd0aCB9LFxuICAgIHsgTWV0cmljYTogJ0NsaWVudGVzIGFmZWN0YWRvcycsIFZhbG9yOiB0b3RhbENsaWVudGVzTW9kYWwgfSxcbiAgICB7IE1ldHJpY2E6ICdcdTIwMTQgU3VidG90YWwgU0lOIFJFUE9TSUNJT04nLCBWYWxvcjogTWF0aC5yb3VuZChzdWJ0b3RhbGVzUG9yVXJnZW5jeS51cmdlbnRlKSB9LFxuICAgIHsgTWV0cmljYTogJ1x1MjAxNCBTdWJ0b3RhbCBQQVJDSUFMJywgVmFsb3I6IE1hdGgucm91bmQoc3VidG90YWxlc1BvclVyZ2VuY3kucGFyY2lhbCkgfSxcbiAgICB7IE1ldHJpY2E6ICdTbmFwc2hvdCBnZW5lcmFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXG4gIF07XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBmaWxhIFRPVEFMIGFsaW5lYWRhIGNvbiBlbCBudWV2byBzaGFwZSAoc2luIGNvbHVtbmFzIGxlZ2FjeVxuICAvLyBGZWNoYV9QZWRpZG8gLyBNZXMgLyBDYW50aWRhZF9QZWRpZGEgLyBQZWRpZG9fSUQgLyBMaW5lYV9JZHggLyBldGMuKS5cbiAgLy8gTGFzIG51ZXZhcyBjb2x1bW5hcyAoZGUgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3MpOiBTS1UsIFByb2R1Y3RvLFxuICAvLyBDbGllbnRlLCBDYXJkQ29kZSwgUHJvdmluY2lhLCBMb2NhbGlkYWQsIFZlbmRlZG9yLCBDYW50aWRhZF9QZW5kaWVudGVfQk8sXG4gIC8vIFByZWNpb19Vbml0X0FSUywgU3VidG90YWxfQk9fQVJTLCBFZGFkX0JPX2RpYXMsIEVzdGFkbywgUGVkaWRvcy5cbiAgY29uc3QgdG90YWxSb3cgPSB7XG4gICAgU0tVOiAnJyxcbiAgICBQcm9kdWN0bzogJycsXG4gICAgQ2xpZW50ZTogJ1RPVEFMJyxcbiAgICBDYXJkQ29kZTogJycsXG4gICAgUHJvdmluY2lhOiAnJyxcbiAgICBMb2NhbGlkYWQ6ICcnLFxuICAgIFZlbmRlZG9yOiAnJyxcbiAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IE1hdGgucm91bmQodG90YWxVbmlkYWRlc01vZGFsKSxcbiAgICBQcmVjaW9fVW5pdF9BUlM6ICcnLFxuICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpLFxuICAgIEVkYWRfQk9fZGlhczogJycsXG4gICAgRXN0YWRvOiAnJyxcbiAgICBQZWRpZG9zOiAnJyxcbiAgfTtcbiAgcm93cy5wdXNoKHRvdGFsUm93KTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl9TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goXG4gICAgZm5hbWUsXG4gICAgW1xuICAgICAgeyBuYW1lOiAnUmVzdW1lbicsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgICB7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH0sXG4gICAgXSxcbiAgICB7XG4gICAgICAvLyBQaW50YXIgbGEgZmlsYSBUT1RBTCBkZSBsYSBob2phIEJhY2tvcmRlciArIGZpbGEgMSAoVE9UQUwpIGRlIFJlc3VtZW4uXG4gICAgICBjZWxsU3R5bGVyOiAoY2VsbCwgY29sdW1uTmFtZSwgX3ZhbHVlLCByb3dJbmRleCkgPT4ge1xuICAgICAgICAvLyBIb2phIFJlc3VtZW46IGZpbGEgVE9UQUwgPSByb3dJbmRleCAwIChwcmltZXJhIGRhdGEgcm93IHBvc3QgaGVhZGVyKS5cbiAgICAgICAgLy8gSG9qYSBCYWNrb3JkZXI6IGZpbGEgVE9UQUwgPSB1bHRpbWEgcm93IChyb3dJbmRleCA9PT0gcm93cy5sZW5ndGggLSAxKS5cbiAgICAgICAgLy8gTm8gdGVuZW1vcyBhY2Nlc28gYWwgbm9tYnJlIGRlIGxhIGhvamEgZW4gZWwgc3R5bGVyLCBwZXJvIHBpbnRhbW9zXG4gICAgICAgIC8vIHBvciBjZWxkYTogc2kgY29sdW1uTmFtZT09J01ldHJpY2EnIHkgZXMgJ1RPVEFMIEJhY2tvcmRlciBBUlMuLi4nLFxuICAgICAgICAvLyBvIHNpIGNvbHVtbk5hbWU9PSdDbGllbnRlJyB5IGVsIHZhbG9yIGluY2x1eWUgJ1RPVEFMJy5cbiAgICAgICAgY29uc3QgdHh0ID0gU3RyaW5nKGNlbGwudmFsdWUgfHwgJycpO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgKGNvbHVtbk5hbWUgPT09ICdNZXRyaWNhJyAmJiB0eHQuaW5jbHVkZXMoJ1RPVEFMIEJhY2tvcmRlcicpKSB8fFxuICAgICAgICAgIChjb2x1bW5OYW1lID09PSAnQ2xpZW50ZScgJiYgdHh0LmluY2x1ZGVzKCdUT1RBTCcpKVxuICAgICAgICApIHtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjk5MUIxQicgfSB9OyAvLyByZWQtODAwXG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2VsZGFzIGRlIGxhIE1JU01BIEZJTEEgVE9UQUwgKGxvcyBudW1lcm9zKVxuICAgICAgICBpZiAocm93SW5kZXggPT09IDAgJiYgY29sdW1uTmFtZSA9PT0gJ1ZhbG9yJykge1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH1cbiAgKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgK1xuICAgICAgKHJvd3MubGVuZ3RoIC0gMSkgK1xuICAgICAgJyBsaW5lYXMgKyBSZXN1bWVuIGNvbiB0b3RhbCAkJyArXG4gICAgICBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgJyknLFxuICAgIDMwMDBcbiAgKTtcbn07XG5cbi8vIHYxNDkyIFx1MDBBNzkxICgyMDI2LTEwLTI3KTogZXhwb3J0IGRlbCBtXHUwMEYzZHVsbyBcIlJlcGFydG8gZGUgaW5ncmVzb3NcIi4gRnVlbnRlOlxuLy8gYHdpbmRvdy5fcmVwYXJ0b0luZ3Jlc29zYC5cbi8vIHYxNDk3IFx1MDBBNzk2IEhPVEZJWCAoMjAyNi0xMC0yNyk6IHJlZmFjdG9yIGNvbXBsZXRvIHRyYXMgYnVnIHJlcG9ydGFkbyBwb3Jcbi8vIE1hcmlhbm8gXCJubyBkZXNjYXJnYSBuYWRhXCIuXG4vL1xuLy8gRG9zIGNhdXNhcyBpZGVudGlmaWNhZGFzOlxuLy8gICAxLiBgaW5zdGFsbENodW5rU3R1YnMoJ2V4cG9ydHMtY29yZScsIFsuLi5dKWAgTk8gaW5jbHVcdTAwRURhXG4vLyAgICAgIGBleHBvcnRSZXBhcnRvVG9FeGNlbGAgXHUyMTkyIHNpIGVsIHVzZXIgYWJyXHUwMEVEYSBtb2RhbCBSZXBhcnRvIFNJTiBwYXNhclxuLy8gICAgICBhbnRlcyBwb3IgXCJFeHBvcnRhclwiIGRlbCBoZWFkZXIsIGVsIGNodW5rIG5vIHNlIGNhcmdhYmEgeSBlbFxuLy8gICAgICBjbGljayBhbCBib3RcdTAwRjNuIGNvcnRvLWNpcmN1aXRhYmEgc2lsZW5jaW9zbyAoYHdpbmRvdy5YICYmIC4uLmApLlxuLy8gICAgICBGaXg6IGFncmVnYWRvIGFsIHN0dWJzIGFycmF5IGVuIHNyYy9tYWluLmpzLlxuLy8gICAyLiBDYW1wb3MgZmFsdGFudGVzIChjbGllbnROYW1lIG51bGwsIGxvY2FsaWRhZCB1bmRlZmluZWQsIGV0Yy4pXG4vLyAgICAgIHBvZFx1MDBFRGFuIHByb3BhZ2FyIGB1bmRlZmluZWRgIGEgRXhjZWxKUyBcdTIxOTIgZWwgYHdyaXRlQnVmZmVyKClgIGZhbGxhXG4vLyAgICAgIHNpbGVuY2lvc28gbyByb21wZSBlbCBibG9iLiBGaXg6IGZ1ZW50ZSBcdTAwRkFuaWNhIGBjb21wdXRlUmVwYXJ0b0V4cG9ydFJvd3NgXG4vLyAgICAgIGVuIHNyYy9wdXJlL3JlcGFydG8tZXhwb3J0LXJvd3MuanMgXHUyMDE0IHRvZG8gY2FtcG8gZmFsdGFudGUgXHUyMTkyIFwiLVwiLlxuLy9cbi8vIFBpcGVsaW5lOlxuLy8gICAxLiBHdWFyZCBcIm5vIGhheSBpbmdyZXNvc1wiICsgYWxlcnQgdGVtcHJhbm8uXG4vLyAgIDIuIFRyeS9jYXRjaCBnbG9iYWw6IGN1YWxxdWllciBleGNlcGNpXHUwMEYzbiBcdTIxOTIgYWxlcnQgXHUwMEE3NjggaHVtYW5vICsgbG9nXG4vLyAgICAgIGEgb3BlcmF0aW9uc19sb2cgY29uIHR5cGU9J2V4cG9ydF9mYWlsZWQnLlxuLy8gICAzLiBQdXJlIGZuIGFybWEgZmlsYXMgY29uIGZpbHRyb3MgYXBsaWNhZG9zIChzZWFyY2ggKyBoaWRlTm9TdG9jaykuXG4vLyAgIDQuIDMgaG9qYXM6IEZpbHRyb3MgKGVuY2FiZXphZG8pICsgUmVzdW1lbiAoMSBmaWxhIHBvciBpbmdyZXNvKSArXG4vLyAgICAgIERldGFsbGUgKDEgZmlsYSBwb3IgY2xpZW50ZSkuXG53aW5kb3cuZXhwb3J0UmVwYXJ0b1RvRXhjZWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gIGNvbnN0IGluZ3Jlc29zID0gQXJyYXkuaXNBcnJheSh3Ll9yZXBhcnRvSW5ncmVzb3MpID8gdy5fcmVwYXJ0b0luZ3Jlc29zIDogW107XG4gIGlmICghaW5ncmVzb3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBpbmdyZXNvcyBkZSByZXBhcnRvIHBhcmEgZXhwb3J0YXIuIEFiclx1MDBFRCBlbCBtb2RhbCBcIlJlcGFydG8gZGUgaW5ncmVzb3NcIiBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIExlZXIgZWwgZXN0YWRvIGFjdHVhbCBkZWwgbW9kYWwgKGZpbHRyb3MgYXBsaWNhZG9zKS5cbiAgY29uc3QgX3NlYXJjaEVsID1cbiAgICB0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnID8gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8tc2VhcmNoJykgOiBudWxsO1xuICBjb25zdCBfaGlkZUVsID1cbiAgICB0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnID8gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcGFydG8taGlkZS1ub3N0b2NrJykgOiBudWxsO1xuICBjb25zdCBmaWx0cm9zID0ge1xuICAgIHNlYXJjaDogX3NlYXJjaEVsID8gU3RyaW5nKC8qKiBAdHlwZSB7YW55fSAqLyAoX3NlYXJjaEVsKS52YWx1ZSB8fCAnJykudHJpbSgpIDogJycsXG4gICAgaGlkZU5vU3RvY2s6IF9oaWRlRWwgPyAhISgvKiogQHR5cGUge2FueX0gKi8gKF9oaWRlRWwpLmNoZWNrZWQpIDogdHJ1ZSxcbiAgfTtcblxuICAvLyBCb3RcdTAwRjNuIGVuIGVzdGFkbyBcIkdlbmVyYW5kb1x1MjAyNlwiLiB0ZXh0Q29udGVudCAobm8gaW5uZXJIVE1MIFx1MjAxNCBhbnRpLVhTUyBob29rKS5cbiAgY29uc3QgX2J0biA9XG4gICAgdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJ1xuICAgICAgPyBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjcmVwYXJ0by1tb2RhbCBidXR0b25bb25jbGljayo9XCJleHBvcnRSZXBhcnRvVG9FeGNlbFwiXScpXG4gICAgICA6IG51bGw7XG4gIGNvbnN0IF9vcmlnQnRuVGV4dCA9IF9idG4gPyBfYnRuLnRleHRDb250ZW50IDogJyc7XG4gIGlmIChfYnRuKSB7XG4gICAgLyoqIEB0eXBlIHthbnl9ICovIChfYnRuKS5kaXNhYmxlZCA9IHRydWU7XG4gICAgX2J0bi50ZXh0Q29udGVudCA9ICdcdTIzRjMgR2VuZXJhbmRvXHUyMDI2JztcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBSZXBhcnRvXHUyMDI2Jyk7XG5cbiAgdHJ5IHtcbiAgICAvLyBQdXJlIGZuIGZ1ZW50ZSBcdTAwRkFuaWNhLlxuICAgIGNvbnN0IF9wdXJlTW9kID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLnJlcGFydG9FeHBvcnQ7XG4gICAgaWYgKCFfcHVyZU1vZCB8fCB0eXBlb2YgX3B1cmVNb2QuY29tcHV0ZVJlcGFydG9FeHBvcnRSb3dzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdleHBvcnRzLWNvcmUucmVwYXJ0b0V4cG9ydCBwdXJlIGZuIG5vIGRpc3BvbmlibGUgKGNodW5rIG5vIGNhcmdhZG8gY29tcGxldG8pJ1xuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgX3Byb2R1Y3RzID0gQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXTtcbiAgICBjb25zdCBfZ2V0U3RvY2tGaXNpY28gPVxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHNrdSkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgcmV0dXJuIE51bWJlcih3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhKHNrdSkpIHx8IDA7XG4gICAgICAgICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIDogKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBfc2t1KSA9PiAwO1xuICAgIGNvbnN0IF9nZXRQcm9kdWN0RGVzYyA9ICgvKiogQHR5cGUge3N0cmluZ30gKi8gc2t1KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB1ID0gU3RyaW5nKHNrdSB8fCAnJylcbiAgICAgICAgICAudG9VcHBlckNhc2UoKVxuICAgICAgICAgIC50cmltKCk7XG4gICAgICAgIGNvbnN0IHAgPSBfcHJvZHVjdHMuZmluZChcbiAgICAgICAgICAoeCkgPT5cbiAgICAgICAgICAgIFN0cmluZygoeCAmJiB4LmNvZGUpIHx8ICcnKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKVxuICAgICAgICAgICAgICAudHJpbSgpID09PSB1XG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiBwID8gU3RyaW5nKHAuZGVzYyB8fCBwLm5hbWUgfHwgJycpLnRyaW0oKSA6ICcnO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgfVxuICAgIH07XG4gICAgY29uc3QgcmVzdWx0ID0gX3B1cmVNb2QuY29tcHV0ZVJlcGFydG9FeHBvcnRSb3dzKGluZ3Jlc29zLCBmaWx0cm9zLCB7XG4gICAgICBnZXRTdG9ja0Zpc2ljbzogX2dldFN0b2NrRmlzaWNvLFxuICAgICAgZ2V0UHJvZHVjdERlc2M6IF9nZXRQcm9kdWN0RGVzYyxcbiAgICB9KTtcbiAgICBjb25zdCBmaWx0cm9zTGJsID0gX3B1cmVNb2QuZm9ybWF0UmVwYXJ0b0ZpbHRyb3NIZWFkZXJcbiAgICAgID8gX3B1cmVNb2QuZm9ybWF0UmVwYXJ0b0ZpbHRyb3NIZWFkZXIoZmlsdHJvcylcbiAgICAgIDogJ0ZpbHRyb3M6IChubyByZXBvcnRhZG9zKSc7XG4gICAgY29uc3QgZmlsdHJvc1Jvd3MgPSBbXG4gICAgICB7IE1ldHJpY2E6IGZpbHRyb3NMYmwsIFZhbG9yOiAnJyB9LFxuICAgICAgeyBNZXRyaWNhOiAnVG90YWwgaW5ncmVzb3MnLCBWYWxvcjogaW5ncmVzb3MubGVuZ3RoIH0sXG4gICAgICB7XG4gICAgICAgIE1ldHJpY2E6ICdJbmdyZXNvcyBmaWx0cmFkb3MnLFxuICAgICAgICBWYWxvcjogcmVzdWx0LnRvdGFsRmlsYXMgPiAwID8gcmVzdWx0LnJlc3VtZW5Sb3dzLmxlbmd0aCAtIDEgOiAwLFxuICAgICAgfSxcbiAgICAgIHsgTWV0cmljYTogJ1RvdGFsIHVuaWRhZGVzIGluZ3Jlc2FkYXMnLCBWYWxvcjogcmVzdWx0LnRvdGFsSW5ncmVzYWRhcyB9LFxuICAgICAgeyBNZXRyaWNhOiAnVG90YWwgdW5pZGFkZXMgQk8gc29saWNpdGFkYXMnLCBWYWxvcjogcmVzdWx0LnRvdGFsQk8gfSxcbiAgICAgIHsgTWV0cmljYTogJ1RvdGFsIGNsaWVudGVzIGVzcGVyYW5kbycsIFZhbG9yOiByZXN1bHQudG90YWxDbGllbnRlcyB9LFxuICAgICAge1xuICAgICAgICBNZXRyaWNhOiAnRXhwb3J0YWRvIGVuJyxcbiAgICAgICAgVmFsb3I6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZSgnVCcsICcgJykgKyAnIFVUQycsXG4gICAgICB9LFxuICAgIF07XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGNvbnN0IHBhZCA9ICgvKiogQHR5cGUge251bWJlcn0gKi8gbikgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gICAgY29uc3QgZm5hbWUgPVxuICAgICAgJ1JlcGFydG9fJyArXG4gICAgICBub3cuZ2V0RnVsbFllYXIoKSArXG4gICAgICAnLScgK1xuICAgICAgcGFkKG5vdy5nZXRNb250aCgpICsgMSkgK1xuICAgICAgJy0nICtcbiAgICAgIHBhZChub3cuZ2V0RGF0ZSgpKSArXG4gICAgICAnXycgK1xuICAgICAgcGFkKG5vdy5nZXRIb3VycygpKSArXG4gICAgICBwYWQobm93LmdldE1pbnV0ZXMoKSkgK1xuICAgICAgJy54bHN4JztcblxuICAgIGF3YWl0IGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgICAgeyBuYW1lOiAnRmlsdHJvcycsIHJvd3M6IGZpbHRyb3NSb3dzIH0sXG4gICAgICB7IG5hbWU6ICdSZXN1bWVuJywgcm93czogcmVzdWx0LnJlc3VtZW5Sb3dzIH0sXG4gICAgICB7IG5hbWU6ICdEZXRhbGxlJywgcm93czogcmVzdWx0LmRldGFsbGVSb3dzIH0sXG4gICAgXSk7XG4gICAgc2hvd1N5bmNUYWcoXG4gICAgICAnRXhwb3J0IFJlcGFydG8gbGlzdG8gKCcgK1xuICAgICAgICAocmVzdWx0LnJlc3VtZW5Sb3dzLmxlbmd0aCAtIDEpICtcbiAgICAgICAgJyBpbmdyZXNvcyBcdTAwQjcgJyArXG4gICAgICAgIChyZXN1bHQuZGV0YWxsZVJvd3MubGVuZ3RoIC0gMSkgK1xuICAgICAgICAnIGZpbGFzIGRldGFsbGUpJyxcbiAgICAgIDI4MDBcbiAgICApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gKGUgJiYgLyoqIEB0eXBlIHthbnl9ICovIChlKS5tZXNzYWdlKSB8fCBTdHJpbmcoZSk7XG4gICAgY29uc29sZS5lcnJvcignW3YxNDk3IFx1MDBBNzk2XSBleHBvcnRSZXBhcnRvVG9FeGNlbCBmYWxsXHUwMEYzOicsIGUpO1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIHB1ZGltb3MgZ2VuZXJhciBlbCBFeGNlbCBkZWwgUmVwYXJ0by4gVm9sdlx1MDBFOSBhIGludGVudGFyOyBzaSBzaWd1ZSwgYXZpc2FsZSBhIE1hcmlhbm8uJ1xuICAgICk7XG4gICAgLy8gTG9nIGZpcmUtYW5kLWZvcmdldCBhIG9wZXJhdGlvbnNfbG9nIChzaSBmYkRiIGRpc3BvbmlibGUpLlxuICAgIHRyeSB7XG4gICAgICBpZiAodHlwZW9mIHcuZmJEYiAhPT0gJ3VuZGVmaW5lZCcgJiYgdy5mYkRiICYmIHR5cGVvZiB3LmZiRGIuY29sbGVjdGlvbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvKiogQHR5cGUge2FueX0gKi8gKHcuZmJEYilcbiAgICAgICAgICAuY29sbGVjdGlvbignb3BlcmF0aW9uc19sb2cnKVxuICAgICAgICAgIC5hZGQoe1xuICAgICAgICAgICAgdHlwZTogJ2V4cG9ydF9mYWlsZWQnLFxuICAgICAgICAgICAgZXhwb3J0S2luZDogJ3JlcGFydG8nLFxuICAgICAgICAgICAgZXJyb3I6IG1zZy5zbGljZSgwLCA1MDApLFxuICAgICAgICAgICAgdXNlclVpZDogKHcuY3VycmVudFVzZXIgJiYgdy5jdXJyZW50VXNlci51aWQpIHx8IG51bGwsXG4gICAgICAgICAgICB1c2VyRW1haWw6ICh3LmN1cnJlbnRVc2VyICYmIHcuY3VycmVudFVzZXIuZW1haWwpIHx8IG51bGwsXG4gICAgICAgICAgICB0b3RhbEluZ3Jlc29zOiBpbmdyZXNvcy5sZW5ndGgsXG4gICAgICAgICAgICBmaWx0cm9zLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAgIC8qIGlnbm9yZSAqL1xuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKF9lTG9nKSB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKF9idG4pIHtcbiAgICAgIC8qKiBAdHlwZSB7YW55fSAqLyAoX2J0bikuZGlzYWJsZWQgPSBmYWxzZTtcbiAgICAgIF9idG4udGV4dENvbnRlbnQgPSBfb3JpZ0J0blRleHQ7XG4gICAgfVxuICB9XG59O1xuXG4vLyB2NzM3OiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kbyBlbCBTdG9jayBBc2lnbmFkbyAoc2luIGZpbHRybyBkZSBtZXMpLiBNaXNtb1xuLy8gbW90aXZvIHF1ZSBleHBvcnRCYWNrb3JkZXJBbGwuXG53aW5kb3cuZXhwb3J0U3RvY2tBc2lnQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkbyAoc25hcHNob3QgYWN0dWFsKS4uLicpO1xuICAvLyB2MTEwMCAoMjAyNi0wOS0zMCk6IG1pc21vIG1cdTAwRjNkdWxvIHB1cm8gcXVlIHJlbmRlckJhY2tvcmRlcnNUYWIgZW4gbW9kb1xuICAvLyBhc2lnbmFjaW9uLiBBaG9yYSBlbCByZXBvcnRlIGNvaW5jaWRlIGNvbiBlbCBtb2RhbDogRklGTyBjYXAgcG9yIGRpc3BTYXAsXG4gIC8vIGZpbHRybyB2ZW5jaWRhcyAoQVNJRyA+MTVkIGZ1ZXJhLCBBU0lHIHNpbiByZXNlcnZhIHZpZ2VudGUgYWRlbnRybyksXG4gIC8vIGNvbmZpcm1lZCBpbmNsdWlkbywgc2luIGxcdTAwRURuZWFzIFwidmlydHVhbF9BU0lHXCIgZmFudGFzbWEuXG4gIGNvbnN0IGFyciA9XG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gIGNvbnN0IHRvdGFsUGVkaWRvc09wZW4gPSBhcnIuZmlsdGVyKChwKSA9PiBwICYmICFwLmNsb3NlZEF0KS5sZW5ndGg7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkICE9PSAnZnVuY3Rpb24nIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlLmdldClcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgY29uc3QgY21EYXRhID0gdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgYXJyLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHt9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIGFycikgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIC8vIEVzdGFkb19SZWFsOiBoaXN0XHUwMEYzcmljbyBcIkJPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKVwiIHZzIFwiQVNJR1wiLiB2MTEwMDpcbiAgICAvLyBhaG9yYSBgY29uZmlybWVkYCB0YW1iaVx1MDBFOW4gZW50cmEgKHY5NjIpLiBQcmVzZXJ2YW1vcyBldGlxdWV0YSBsZWdhY3lcbiAgICAvLyBwb3IgY29tcGF0aWJpbGlkYWQgY29uIHF1aWVuIGNvbnN1bWUgZWwgRXhjZWwuXG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XG4gICAgaWYgKGMuc3RhdGUgPT09ICdCTycpIGVzdGFkb1JlYWwgPSAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJztcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcXR5LFxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHF0eSAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXG4gICAgICAvLyB2MTEwMDogY29udGV4dG8gXHUwMEZBdGlsIHBhcmEgZGVidWdnaW5nIHBhcmlkYWQgbW9kYWxcdTIxOTRyZXBvcnRlLlxuICAgICAgU3RvY2tfRGlzcF9TS1U6IHJsLmRpc3BTYXAgfHwgMCxcbiAgICB9KTtcbiAgfSk7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlBc2lnbmFkYT4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgc3RvY2sgYXNpZ25hZG8gYWhvcmEgbWlzbW9cXG4nICtcbiAgICAgICAgJzIuIFRvZG9zIGxvcyBBU0lHIGVzdGFuIHZlbmNpZG9zICg+MTVkIGRlc2RlIGFzaWdBdClcXG4nICtcbiAgICAgICAgJzMuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fU25hcHNob3RfJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59O1xuXG4vLyB2MTM5NiAoMjAyNi0xMC0yMSk6IG51ZXZvIGV4cG9ydCBcIlBlbmRpZW50ZSBkZSBBc2lnbmFjaVx1MDBGM24gLSBQYWJsb1wiLiBMaXN0YVxuLy8gbG9zIHJlcGFydG9zIGFiaWVydG9zIChpbmdyZXNvc19yZXBhcnRvIHBlbmRpbmcvaW5fcHJvZ3Jlc3MpIHBvciBTS1UgK1xuLy8gY2xpZW50ZXMgZW4gY29sYS4gUmVlbXBsYXphIHNlbVx1MDBFMW50aWNhbWVudGUgYWwgdmllam8gXCJTdG9jayBBc2lnbmFkb1wiIGVuIGVsXG4vLyBtb2RhbCAoZWwgdmllam8gcGFzYSBhIFwiU3RvY2sgQXNpZ25hZG8gLSBsXHUwMEVEbmVhc1wiIGNvbW8gYXV4aWxpYXIpLlxuLy8gRG9zIGhvamFzOlxuLy8gICBSZXN1bWVuIHJlcGFydG8gXHUyMDE0IHVuYSBmaWxhIHBvciBkb2MgaW5ncmVzb3NfcmVwYXJ0by5cbi8vICAgQ2xpZW50ZXMgZW4gY29sYSBcdTIwMTQgdW5hIGZpbGEgcG9yIGNsaWVudGUgQk8gZGUgY2FkYSByZXBhcnRvLlxud2luZG93LmV4cG9ydFBlbmRpZW50ZURlQXNpZ25hY2lvblBhYmxvID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG8uLi4nKTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGZiRGIgPSB3LmZiRGI7XG4gIGlmICghZmJEYikge1xuICAgIGFsZXJ0KCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvLiBSZWludGVudFx1MDBFMSBlbiB1bm9zIHNlZ3VuZG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyAxLiBSZXBhcnRvcyBhYmllcnRvcy5cbiAgbGV0IHJlcGFydG9zRG9jcztcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ2luZ3Jlc29zX3JlcGFydG8nKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ3BlbmRpbmcnLCAnaW5fcHJvZ3Jlc3MnXSlcbiAgICAgIC5nZXQoKTtcbiAgICByZXBhcnRvc0RvY3MgPSBzbmFwLmRvY3M7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgY2FyZ2FuZG8gaW5ncmVzb3NfcmVwYXJ0bzogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXJlcGFydG9zRG9jcyB8fCByZXBhcnRvc0RvY3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZXBhcnRvcyBwZW5kaW5nL2luX3Byb2dyZXNzIGFob3JhIG1pc21vLicpO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUGFibG86IDAgcmVwYXJ0b3MnLCAyNDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMi4gU25hcHNob3Qgc3RvY2sgKyBnZXRTdG9ja0JyZWFrZG93biBwb3IgU0tVLlxuICBjb25zdCBzdG9ja1NuYXAgPVxuICAgIHR5cGVvZiB3LmdldFN0b2NrU25hcHNob3QgPT09ICdmdW5jdGlvbidcbiAgICAgID8gdy5nZXRTdG9ja1NuYXBzaG90KClcbiAgICAgIDogdy5fc3RvY2tTbmFwc2hvdENhY2hlIHx8IHsgd2FyZWhvdXNlQnJlYWtkb3duOiB7fSB9O1xuICBjb25zdCB3aHMgPVxuICAgIHR5cGVvZiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24gfHwge307XG4gIGNvbnN0IHBlZGlkb3MgPSBBcnJheS5pc0FycmF5KHcuZ2xvYmFsUGVkaWRvcykgPyB3Lmdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgY29uc3Qgd2FpdGxpc3RFbnRyaWVzID1cbiAgICB0eXBlb2Ygdy5fZ2V0V2FpdGxpc3RDcHN0RW50cmllcyA9PT0gJ2Z1bmN0aW9uJyA/IHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMoKSA6IFtdO1xuICBjb25zdCBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zID0gcmVwYXJ0b3NEb2NzLm1hcCgoZCkgPT5cbiAgICBPYmplY3QuYXNzaWduKHsgX2ZzSWQ6IGQuaWQgfSwgZC5kYXRhKCkgfHwge30pXG4gICk7XG4gIGNvbnN0IGdldEJyZWFrZG93biA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5nZXRTdG9ja0JyZWFrZG93bjtcbiAgLy8gMy4gUmVzb2x2ZXIgcHJvZHVjdG8gcG9yIFNLVS5cbiAgY29uc3QgcHJvZEJ5U2t1ID0gbmV3IE1hcCgpO1xuICBjb25zdCBQUk9EVUNUUyA9IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW107XG4gIGZvciAoY29uc3QgcCBvZiBQUk9EVUNUUykge1xuICAgIGlmIChwICYmIHAuc2t1KSBwcm9kQnlTa3Uuc2V0KFN0cmluZyhwLnNrdSkudG9VcHBlckNhc2UoKSwgcCk7XG4gIH1cbiAgY29uc3Qgbm93TXMgPSBEYXRlLm5vdygpO1xuICBjb25zdCByZXN1bWVuUm93cyA9IFtdO1xuICBjb25zdCBjb2xhUm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IGRvYyBvZiByZXBhcnRvc0RvY3MpIHtcbiAgICBjb25zdCBkYXRhID0gZG9jLmRhdGEoKSB8fCB7fTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoZGF0YS5za3UgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcHJvZCA9IHByb2RCeVNrdS5nZXQoc2t1KSB8fCBudWxsO1xuICAgIGNvbnN0IGZpc2ljb0RlcDExID0gTnVtYmVyKCh3aHNbc2t1XSAmJiB3aHNbc2t1XVsnMTEnXSkgfHwgMCk7XG4gICAgY29uc3QgcXR5SW5ncmVzYWRhID0gTnVtYmVyKGRhdGEucXR5SW5ncmVzYWRhIHx8IDApO1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0gQXJyYXkuaXNBcnJheShkYXRhLmFzc2lnbm1lbnRzKSA/IGRhdGEuYXNzaWdubWVudHMgOiBbXTtcbiAgICBsZXQgcXR5WWFBc2lnbmFkYSA9IDA7XG4gICAgZm9yIChjb25zdCBhIG9mIGFzc2lnbm1lbnRzKSBxdHlZYUFzaWduYWRhICs9IE51bWJlcigoYSAmJiBhLnF0eUFzaWduYWRhKSB8fCAwKTtcbiAgICBsZXQgcXR5QVJlcGFydGlyID0gTWF0aC5tYXgoMCwgcXR5SW5ncmVzYWRhIC0gcXR5WWFBc2lnbmFkYSk7XG4gICAgaWYgKGdldEJyZWFrZG93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYmsgPSBnZXRCcmVha2Rvd24oXG4gICAgICAgICAgc2t1LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGdldFN0b2NrRmlzaWNvOiAoKSA9PiBmaXNpY29EZXAxMSxcbiAgICAgICAgICAgIHBlZGlkb3MsXG4gICAgICAgICAgICB3YWl0bGlzdEVudHJpZXMsXG4gICAgICAgICAgICBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBub3c6IG5vd01zIH1cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGJrICYmIGJrLnJlcGFydG9BYmllcnRvICYmIHR5cGVvZiBiay5yZXBhcnRvQWJpZXJ0by5xdHkgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgcXR5QVJlcGFydGlyID0gYmsucmVwYXJ0b0FiaWVydG8ucXR5O1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvKiBmYWxsYmFjayBhIGNcdTAwRTFsY3VsbyBsb2NhbCAqL1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjbGllbnRlc0JPID0gQXJyYXkuaXNBcnJheShkYXRhLmNsaWVudGVzQk8pID8gZGF0YS5jbGllbnRlc0JPIDogW107XG4gICAgbGV0IGRldGVjdGVkQXQgPSBkYXRhLmRldGVjdGVkQXQgfHwgJyc7XG4gICAgaWYgKGRldGVjdGVkQXQgJiYgdHlwZW9mIGRldGVjdGVkQXQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkZXRlY3RlZEF0ID0gZGV0ZWN0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9ICcnO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBib1RvdGFsUXR5ID0gY2xpZW50ZXNCTy5yZWR1Y2UoKHMsIGMpID0+IHMgKyBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksIDApO1xuICAgIHJlc3VtZW5Sb3dzLnB1c2goe1xuICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgU0tVOiBza3UsXG4gICAgICBQcm9kdWN0bzogKHByb2QgJiYgKHByb2QubmFtZSB8fCBwcm9kLmRlc2NyaXB0aW9uKSkgfHwgJycsXG4gICAgICBGaXNpY29fRGVwMTE6IGZpc2ljb0RlcDExLFxuICAgICAgUXR5X0luZ3Jlc2FkYTogcXR5SW5ncmVzYWRhLFxuICAgICAgUXR5X1lhX0FzaWduYWRhOiBxdHlZYUFzaWduYWRhLFxuICAgICAgUXR5X0FfUmVwYXJ0aXI6IHF0eUFSZXBhcnRpcixcbiAgICAgIENsaWVudGVzX0VuX0NvbGE6IGNsaWVudGVzQk8ubGVuZ3RoLFxuICAgICAgQk9fVG90YWxfUXR5OiBib1RvdGFsUXR5LFxuICAgICAgRGV0ZWN0ZWRBdDogdHlwZW9mIGRldGVjdGVkQXQgPT09ICdzdHJpbmcnID8gZGV0ZWN0ZWRBdC5zbGljZSgwLCAxOSkucmVwbGFjZSgnVCcsICcgJykgOiAnJyxcbiAgICAgIFN0YXR1czogZGF0YS5zdGF0dXMgfHwgJycsXG4gICAgfSk7XG4gICAgZm9yIChjb25zdCBjIG9mIGNsaWVudGVzQk8pIHtcbiAgICAgIGxldCBmZWNoYVBlZCA9IGMucGVkaWRvQ3JlYXRlZEF0IHx8ICcnO1xuICAgICAgaWYgKGZlY2hhUGVkICYmIHR5cGVvZiBmZWNoYVBlZC50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmZWNoYVBlZCA9IGZlY2hhUGVkLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSAnJztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gVmVuZGVkb3I6IGJ1c2NhciBlbiBnbG9iYWxQZWRpZG9zIHBvciBwZWRpZG9JZC5cbiAgICAgIGxldCB2ZW5kZWRvciA9IGMudmVuZG9yS2V5IHx8ICcnO1xuICAgICAgaWYgKCF2ZW5kZWRvciAmJiBjLnBlZGlkb0lkKSB7XG4gICAgICAgIGNvbnN0IHAgPSBwZWRpZG9zLmZpbmQoKHgpID0+IHggJiYgeC5fZnNJZCA9PT0gYy5wZWRpZG9JZCk7XG4gICAgICAgIGlmIChwKSB2ZW5kZWRvciA9IHAub3duZXJWZW5kb3IgfHwgcC52ZW5kb3JBc3NpZ25lZCB8fCAnJztcbiAgICAgIH1cbiAgICAgIGNvbGFSb3dzLnB1c2goe1xuICAgICAgICBSZXBhcnRvX0lEOiBkb2MuaWQsXG4gICAgICAgIFNLVTogc2t1LFxuICAgICAgICBDbGllbnRlOiBjLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENhcmRDb2RlOiBjLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IGMuY2xpZW50UHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogYy5jbGllbnRMb2NhbGl0eSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHZlbmRlZG9yLFxuICAgICAgICBRdHlfQk86IE51bWJlcihjLnF0eUJhY2tvcmRlciB8fCAwKSxcbiAgICAgICAgRmVjaGFfUGVkaWRvX09yaWdpbmFsOiB0eXBlb2YgZmVjaGFQZWQgPT09ICdzdHJpbmcnID8gZmVjaGFQZWQuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXN1bWVuUm93cy5zb3J0KChhLCBiKSA9PiBiLlF0eV9BX1JlcGFydGlyIC0gYS5RdHlfQV9SZXBhcnRpcik7XG4gIGNvbGFSb3dzLnNvcnQoXG4gICAgKGEsIGIpID0+XG4gICAgICAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpIHx8XG4gICAgICAoYS5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpXG4gICk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZW5kaWVudGVEZUFzaWduYWNpb25fUGFibG9fJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUmVzdW1lbiByZXBhcnRvJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBlbiBjb2xhJywgcm93czogY29sYVJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUGFibG86ICcgKyByZXN1bWVuUm93cy5sZW5ndGggKyAnIHJlcGFydG9zIC8gJyArIGNvbGFSb3dzLmxlbmd0aCArICcgY2xpZW50ZXMgZW4gY29sYScsXG4gICAgMjgwMFxuICApO1xufTtcblxuLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc3VlbHZlIG5vbWJyZSBkZSBmYW50YXNpYSBwYXJhIHVuIHBlZGlkbyB1c2FuZG8gZWxcbi8vIG1pc21vIHBhdHRlcm4gcXVlIGxhcyBjYXJkcyBkZWwgbWFwYSAoaW5kZXguaHRtbDo5OTE1LTk5MzUpOlxuLy8gICAxKSBjbGllbnRNZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYSAoZWRpdGFkbyBkZXNkZSBlbCBtb2RhbCBjbGllbnRlKVxuLy8gICAyKSBhcHByb3ZlZEFsdGFzTGlzdFtdLmZhbnRhc2lhIG1hdGNoZWFkbyBwb3IgY29tZXJjaW8gPT0gY2xpZW50TmFtZVxuZnVuY3Rpb24gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKSB7XG4gIGNvbnN0IGNhcmRDb2RlID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgaWYgKGNhcmRDb2RlKSB7XG4gICAgY29uc3QgbWV0YSA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuY2xpZW50TWV0YTtcbiAgICBjb25zdCBjdXN0b20gPSBtZXRhICYmIG1ldGFbY2FyZENvZGVdICYmIG1ldGFbY2FyZENvZGVdLmN1c3RvbUZhbnRhc2lhO1xuICAgIGlmIChjdXN0b20gJiYgU3RyaW5nKGN1c3RvbSkudHJpbSgpKSByZXR1cm4gU3RyaW5nKGN1c3RvbSkudHJpbSgpO1xuICB9XG4gIGNvbnN0IGFsdGFzID0gLyoqIEB0eXBlIHthbnl9ICovIChnbG9iYWxUaGlzKS5hcHByb3ZlZEFsdGFzTGlzdDtcbiAgaWYgKEFycmF5LmlzQXJyYXkoYWx0YXMpKSB7XG4gICAgY29uc3QgbmFtZUxvd2VyID0gU3RyaW5nKHAuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChuYW1lTG93ZXIpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4ge1xuICAgICAgICBpZiAoIWEpIHJldHVybiBmYWxzZTtcbiAgICAgICAgY29uc3QgYyA9IFN0cmluZyhhLmNvbWVyY2lvIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZiA9IFN0cmluZyhhLmZhbnRhc2lhIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIGMgPT09IG5hbWVMb3dlciB8fCBmID09PSBuYW1lTG93ZXI7XG4gICAgICB9KTtcbiAgICAgIGlmIChtYXRjaCAmJiBtYXRjaC5mYW50YXNpYSAmJiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnJztcbn1cblxuLy8gdjEyMzMgKDIwMjYtMTAtMDkpOiByZXBvcnRlIFwiVmVudGFzIHggYXJ0aWN1bG8geCBjbGllbnRlL3ZlbmRlZG9yXCIgdmlhIENGLlxuLy8gQWRtaW4vZ2VyZW50ZSBvbmx5LiBUYXJkYSB+MzAtNjBzIChCUSBxdWVyeSArIGV4Y2VsanMgYnVpbGQgc2VydmVyLXNpZGUpLlxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzQXJ0Q2xpRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHtcbiAgICBhbGVydCgnRWxlZ1x1MDBFRCB1biBNRVMgZXNwZWNcdTAwRURmaWNvIChubyBcIlRvZG8gZWwgYVx1MDBGMW9cIikgXHUyMDE0IGVzdGUgcmVwb3J0ZSBlcyBtZW5zdWFsLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBtb250aElkeCB2aWVuZSAwLWJhc2VkIGRlc2RlIGVsIHBpY2tlciAoZW5lPTApLiBDRiBlc3BlcmEgMS1iYXNlZC5cbiAgY29uc3QgbW9udGggPSBtb250aElkeCArIDE7XG4gIGNvbnN0IHllYXIgPSBhbmlvO1xuICBjb25zdCBwZXJpb2RvID0gKHdpbmRvdy5NRVNFUyA/IHdpbmRvdy5NRVNFU1ttb250aElkeF0gOiBtb250aCkgKyAnICcgKyB5ZWFyO1xuICBjb25zdCBjb25maXJtTXNnID1cbiAgICAnR2VuZXJhciByZXBvcnRlIFwiVkVOVEFTIHggQVJUSUNVTE8geCBDTElFTlRFL1ZFTkRFRE9SXCIgZGUgJyArXG4gICAgcGVyaW9kbyArXG4gICAgJz9cXG5cXG4nICtcbiAgICAnRnVlbnRlOiBTQVAgdmlhIEJpZ1F1ZXJ5IChkYXRvcyBleGFjdG9zKS5cXG4nICtcbiAgICAnUHVlZGUgdGFyZGFyIDMwLTYwIHNlZ3VuZG9zLlxcbicgK1xuICAgICdBbCB0ZXJtaW5hciBzZSBkZXNjYXJnYSBhdXRvbWF0aWNhbWVudGUgZWwgeGxzeC4nO1xuICBpZiAoIWNvbmZpcm0oY29uZmlybU1zZykpIHJldHVybjtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyByZXBvcnRlIHNlcnZlci1zaWRlIChCUSkuLi4gcHVlZGUgdGFyZGFyIH42MHMnKTtcbiAgdHJ5IHtcbiAgICAvLyB2MTAwMCBwYXR0ZXJuOiByZWZyZXNoIElEVG9rZW4gYW50ZXMgZGUgY2FsbGFibGUgY3JpdGljby5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdSA9IHdpbmRvdy5maXJlYmFzZS5hdXRoICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoKCkuY3VycmVudFVzZXI7XG4gICAgICBpZiAodSAmJiB1LmdldElkVG9rZW4pIGF3YWl0IHUuZ2V0SWRUb2tlbih0cnVlKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgICBjb25zdCBjYWxsYWJsZSA9IHdpbmRvdy5maXJlYmFzZVxuICAgICAgLmFwcCgpXG4gICAgICAuZnVuY3Rpb25zKCdzb3V0aGFtZXJpY2EtZWFzdDEnKVxuICAgICAgLmh0dHBzQ2FsbGFibGUoJ2dlbmVyYXRlVmVudGFzUmVwb3J0Q0YnKTtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgY2FsbGFibGUoeyB5ZWFyLCBtb250aCB9KTtcbiAgICBjb25zdCByID0gKHJlc3AgJiYgcmVzcC5kYXRhKSB8fCB7fTtcbiAgICBpZiAoIXIub2sgfHwgIXIuYnl0ZXNCYXNlNjQpIHtcbiAgICAgIGFsZXJ0KCdDRiBkZXZvbHZpbyBlcnJvcjogJyArIChyLmVycm9yIHx8IEpTT04uc3RyaW5naWZ5KHIpKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIERlY29kZSBiYXNlNjQgXHUyMTkyIEJsb2IgXHUyMTkyIGRvd25sb2FkIHRyaWdnZXIuXG4gICAgY29uc3QgYmluID0gYXRvYihyLmJ5dGVzQmFzZTY0KTtcbiAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbi5sZW5ndGgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbi5jaGFyQ29kZUF0KGkpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnl0ZXNdLCB7XG4gICAgICB0eXBlOiByLm1pbWVUeXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID1cbiAgICAgIHIuZmlsZW5hbWUgfHxcbiAgICAgICd2ZW50YXNfeF9hcnRpY3Vsb19jbGllbnRlXycgKyB5ZWFyICsgJy0nICsgU3RyaW5nKG1vbnRoKS5wYWRTdGFydCgyLCAnMCcpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgICAgIGEucmVtb3ZlKCk7XG4gICAgfSwgMTAwMCk7XG4gICAgY29uc3Qgc3RhdHMgPSByLnN0YXRzIHx8IHt9O1xuICAgIHNob3dTeW5jVGFnKFxuICAgICAgJ09LOiAnICtcbiAgICAgICAgKHN0YXRzLnZlbnRhcyB8fCAwKSArXG4gICAgICAgICcgdmVudGFzIC8gJyArXG4gICAgICAgIChzdGF0cy5pdGVtcyB8fCAwKSArXG4gICAgICAgICcgU0tVcyAvICcgK1xuICAgICAgICAoc3RhdHMuY2xpZW50cyB8fCAwKSArXG4gICAgICAgICcgY2xpZW50ZXMnXG4gICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnRWZW50YXNBcnRDbGldIGVycm9yJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCByZXBvcnRlOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpKSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFBlZGlkb3MgZGVsIG1lcy4uLicpO1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykge1xuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgY29udGludWU7XG4gICAgY29uc3QgZmVjaGEgPSBwLmNyZWF0ZWRBdFxuICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXG4gICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcbiAgICAgICAgICAgIC50b0lTT1N0cmluZygpXG4gICAgICAgICAgICAuc2xpY2UoMCwgMTApXG4gICAgICA6ICcnO1xuICAgIC8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXNvbHZlciBmYW50YXNpYSB1bmEgdmV6IHBvciBwZWRpZG8gKG5vIHBvciBsaW5lYSkgXHUyMDE0XG4gICAgLy8gZWwgbG9va3VwIGVuIGNsaWVudE1ldGEgKyBhcHByb3ZlZEFsdGFzTGlzdCBlcyBjb25zdGFudGUgcGFyYSB0b2RvIGVsIHBlZGlkby5cbiAgICBjb25zdCBub21icmVMb2NhbEZhbnRhc2lhID0gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKTtcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcbiAgICAgIGlmICghbCkgcmV0dXJuO1xuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApO1xuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYSxcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxuICAgICAgICBTdGFnZTogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBOb21icmVfTG9jYWxfRmFudGFzaWE6IG5vbWJyZUxvY2FsRmFudGFzaWEsXG4gICAgICAgIENhcmRDb2RlOiBwLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IHAucHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogcC5vd25lclZlbmRvciB8fCAnJyxcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBDYW50aWRhZF9PcGVuOiBOdW1iZXIobC5xdHlPcGVuKSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9JbnZvaWNlZDogTnVtYmVyKGwucXR5SW52b2ljZWQpIHx8IDAsXG4gICAgICAgIENhbnRpZGFkX0NhbmNlbGxlZDogTnVtYmVyKGwucXR5Q2FuY2VsbGVkKSB8fCAwLFxuICAgICAgICBFc3RhZG9fTGluZWE6IGwuc3RhdGUgfHwgJycsXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQocXR5ICogcHJlY2lvKSxcbiAgICAgICAgQ2VycmFkbzogcC5jbG9zZWRBdCA/ICdTSScgOiAnTk8nLFxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5GZWNoYV9QZWRpZG8gfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG8gfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZWRpZG9zRGVsTWVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdQZWRpZG9zJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgUGVkaWRvcyBkZWwgbWVzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1Jztcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ05FQSc7XG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xuICAgIHJldHVybiAnJztcbiAgfVxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xuICAgIHJldHVybiBrZXk7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBsZXQgYWx0YXNTbmFwO1xuICB0cnkge1xuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcbiAgICAgIC5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXG4gICAgaWYgKCFjYXJkQ29kZSkge1xuICAgICAgc2tpcHBlZE5vU2FwKys7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xuICB9KTtcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgclsnTlJPIENURSddID0gaSArIDE7XG4gIH0pO1xuICAvLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZmFjdG9yIGEgZG93bmxvYWRYbHN4IChlc3RpbG8gdmVyZGUgdW5pZm9ybWUpLlxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRvd25sb2FkWGxzeCgnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcsIFtcbiAgICB7IG5hbWU6ICdDTElFTlRFU19aT05BUycsIHJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeGNlbCBleHBvcnRhZG86ICcgK1xuICAgICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcbiAgICAgIChza2lwcGVkTm9TYXAgPiAwID8gJyAoJyArIHNraXBwZWROb1NhcCArICcgc2luIENhcmRDb2RlIGRlc2NhcnRhZG9zKScgOiAnJylcbiAgKTtcbn07XG5cbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwaW4gPSBwcm9tcHQoXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xuICApO1xuICBpZiAocGluID09PSBudWxsKSByZXR1cm47XG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxuICBjb25zdCBzYXBPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1zYXAtaW50ZWdyYXRpb24nKTtcbiAgaWYgKHNhcE9wdCkge1xuICAgIGNvbnN0IGlzTWFyaWFubyA9XG4gICAgICBjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSc7XG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPcGNpb24gQmFja3VwIG1lbnN1YWw6IHNvbG8gYWRtaW5cbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBhdmlzbyBhbCBjbGljayBwYXJhIFwiVmVudGFzIFx1MDBENyBhcnRcdTAwRURjdWxvIFx1MDBENyBjbGllbnRlXCIuXG4vLyBBZG1pbi9nZXJlbnRlIG9ubHkuIFRhcmRhIDMwLTYwcy4gQW50ZXMgbGEgbm90YSBlc3RhYmEgZW4gbGEgZGVzY3JpcGNpXHUwMEYzbiBkZWxcbi8vIGxpc3RhZG8gZGVsIG1vZGFsOyBhaG9yYSBlbCBsaXN0YWRvIHNvbG8gbXVlc3RyYSBpY29ubyArIHRpdHVsby5cbndpbmRvdy5fdmVudGFzQXJ0Q2xpQ2xpY2sgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdy51c2VyUm9sZSB8fCAnJztcbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ0VzdGUgcmVwb3J0ZSBlcyBzb2xvIHBhcmEgYWRtaW4gLyBnZXJlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBvayA9IGNvbmZpcm0oXG4gICAgJ1JlcG9ydGUgc2VydmVyLXNpZGUgKEJpZ1F1ZXJ5KS4gVGFyZGEgMzAtNjAgc2VndW5kb3MgeSBkZXNjYXJnYSB1biAueGxzeCBjb24gNCBob2phczpcXG4nICtcbiAgICAgICcgIFx1MjAyMiBQcm9kdWN0b3MgdmVuZGlkb3MgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIFByb2R1Y3RvcyBOTyB2ZW5kaWRvcyBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgQ09OIGNvbXByYSBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgU0lOIGNvbXByYSBwb3IgVkRFXFxuXFxuJyArXG4gICAgICAnQ29udGludWFyPydcbiAgKTtcbiAgaWYgKCFvaykgcmV0dXJuO1xuICBpZiAodHlwZW9mIHcuY2xvc2VFeHBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VFeHBvcnREaWFsb2coKTtcbiAgaWYgKHR5cGVvZiB3LnNob3dNb250aFBpY2tlciA9PT0gJ2Z1bmN0aW9uJykg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
