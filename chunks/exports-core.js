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
    showSyncTag("Generando export Reparto\u2026");
    const _getStock = typeof w.getStockDisponibleVenta === "function" ? w.getStockDisponibleVenta : null;
    const _stockFisico = (ing) => {
      if (!ing || !ing.sku) return 0;
      if (!_getStock) return Number(ing.qtyIngresada) || 0;
      try {
        return Number(_getStock(ing.sku)) || 0;
      } catch (_e) {
        return 0;
      }
    };
    const _products = Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [];
    const _producto = (code) => {
      const u = String(code || "").toUpperCase().trim();
      const p = _products.find(
        (x) => String(x.code || "").toUpperCase().trim() === u
      );
      return p ? String(p.desc || p.name || "") : "";
    };
    const _fmtTs = (ts) => {
      try {
        if (!ts) return "";
        if (typeof ts === "string") return ts.slice(0, 19).replace("T", " ");
        if (ts.toDate) return ts.toDate().toISOString().slice(0, 19).replace("T", " ");
        if (typeof ts.seconds === "number")
          return new Date(ts.seconds * 1e3).toISOString().slice(0, 19).replace("T", " ");
        if (ts instanceof Date) return ts.toISOString().slice(0, 19).replace("T", " ");
        return "";
      } catch (_e) {
        return "";
      }
    };
    const resumenRows = [];
    const detalleRows = [];
    let totalIngresadas = 0;
    let totalBO = 0;
    let totalClientes = 0;
    const sorted = ingresos.slice().sort((a, b) => {
      const qa = Number(a.qtyIngresada) || 0;
      const qb = Number(b.qtyIngresada) || 0;
      if (qa !== qb) return qa - qb;
      return String(a.sku || "").localeCompare(String(b.sku || ""));
    });
    for (const ing of sorted) {
      const sku = String(ing.sku || "");
      const producto = _producto(sku);
      const stockFis = _stockFisico(ing);
      const qtyIng = Number(ing.qtyIngresada) || 0;
      const clientes = Array.isArray(ing.clientesBO) ? ing.clientesBO : [];
      const sumaBO = clientes.reduce(
        (s, c) => s + (Number(c.qtyBO) || 0),
        0
      );
      const status = String(ing.status || "");
      const detectedAt = _fmtTs(ing.detectedAt);
      resumenRows.push({
        SKU: sku,
        Producto: producto,
        Stock_fisico_dep11: stockFis,
        Qty_ingresada: qtyIng,
        N_clientes_BO: clientes.length,
        Suma_BO_solicitada: sumaBO,
        Status: status,
        Ingreso_detectado: detectedAt
      });
      totalIngresadas += qtyIng;
      totalBO += sumaBO;
      totalClientes += clientes.length;
      for (const c of clientes) {
        detalleRows.push({
          SKU: sku,
          Producto: producto,
          Stock_fisico_dep11: stockFis,
          Cliente: String(c.clientName || ""),
          CardCode: String(c.cardCode || ""),
          Vendedor: String(c.vendorKey || c.vendor || ""),
          Qty_BO_solicitada: Number(c.qtyBO) || 0,
          Status: status,
          Ingreso_detectado: detectedAt
        });
      }
    }
    resumenRows.push({
      SKU: "TOTAL",
      Producto: "",
      Stock_fisico_dep11: "",
      Qty_ingresada: totalIngresadas,
      N_clientes_BO: totalClientes,
      Suma_BO_solicitada: totalBO,
      Status: "",
      Ingreso_detectado: ""
    });
    detalleRows.push({
      SKU: "TOTAL",
      Producto: "",
      Stock_fisico_dep11: "",
      Cliente: "",
      CardCode: "",
      Vendedor: "",
      Qty_BO_solicitada: totalBO,
      Status: "",
      Ingreso_detectado: ""
    });
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fname = "Reparto_" + now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "_" + pad(now.getHours()) + pad(now.getMinutes()) + ".xlsx";
    await downloadXlsx(fname, [
      { name: "Resumen", rows: resumenRows },
      { name: "Detalle", rows: detalleRows }
    ]);
    showSyncTag(
      "Export Reparto listo (" + sorted.length + " ingresos \xB7 " + detalleRows.length + " filas detalle)",
      2800
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1jb3JlLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCBNQVNURVJGSUxFIERFIENMSUVOVEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9EQVMgbGFzIHRpZW5kYXMgZGVsIG1hcGEgY29uIHN1cyBkYXRvcyBjbGF2ZTpcbi8vIG5vbWJyZSwgdGlwbyAoY2xpZW50ZS9wcm9zcGVjdG8pLCB6b25hIGRlbCB2ZW5kZWRvciwgYXNlc29yIGV4dGVybm8sIGFzZXNvclxuLy8gaW50ZXJubyAoZGVkdWNpZG8gcG9yIHBhcmVqYSBWREkpLCBwcm92aW5jaWEsIGxvY2FsaWRhZCwgZGVwYXJ0YW1lbnRvLFxuLy8gZGlyZWNjaW9uICsgbG9jYWxpZGFkIGRlY2xhcmFkYXMgZW4gZWwgbW9kYWwgQWx0YSBkZSBjbGllbnRlIChzaSBleGlzdGVuKSxcbi8vIGNvb3JkZW5hZGFzIGdlb2NvZGlmaWNhZGFzLCBlc3RhZG8gKEhhYmlsaXRhZG8vUGVuZGllbnRlL0NhbmNlbGFkbyksXG4vLyBjYXRlZ29yaWEgKFJlZ3VsYXIvVmVudGFzIEVzcGVjaWFsZXMvRGlzdHJpYnVpZG9yKS5cbndpbmRvdy5leHBvcnRNYXN0ZXJDbGllbnRlcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFQT0lOVFMgfHwgIVBPSU5UUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIGNhcmdhZG9zIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gbWFzdGVyZmlsZSBkZSBjbGllbnRlcy4uLicpO1xuXG4gIC8vIHYxNDgyIFx1MDBBNzgyOiBjYXJnYXIgY2xpZW50X2J1eWVyX3N0YXRzIGVuIGJsb3F1ZSAoMSBkb2MgcG9yIGNhcmRDb2RlIFNBUClcbiAgLy8gQU5URVMgZGUgYXJtYXIgbGFzIGZpbGFzLCBhc1x1MDBFRCBjYWRhIGZpbGEgdGllbmUgc3UgYnV5ZXIgc3RhdHMgKyBmZWNoYVxuICAvLyBcdTAwRkFsdGltYSBjb21wcmEgc2luIHJvbXBlciBlbCBmbHVqby4gRmlyZS1hbmQtZm9yZ2V0IHNpIGZhbGxhOiBjYWRhIGZpbGFcbiAgLy8gY2FlIGEgXCItXCIgZW4gbG9zIGNhbXBvcyBCdXllci4gQWRtaW4vZ2VyZW50ZSB2ZSB0b2RhIGxhIGNvbGVjY2lcdTAwRjNuO1xuICAvLyB2ZW5kZWRvciB2ZSBzXHUwMEYzbG8gbG9zIHN1eW9zIChydWxlcykuIFNpIGxhIHJ1bGUgYmxvcXVlYSBcdTIxOTIgY2F0Y2ggXHUyMTkyIHZhY1x1MDBFRG8uXG4gIC8vIFBlZGlkbyBNYXJpYW5vOiBubyBpbnZlbnRhciBjXHUwMEUxbGN1bG8gZGUgXCJGZWNoYSBcdTAwRkFsdGltYSBjb21wcmFcIjsgc2kgbm9cbiAgLy8gZXhpc3RlIHNlIG9taXRlLiBidXllcl9zdGF0cy5zdGF0c18xMm0udWx0aW1hQ29tcHJhIFlBIGV4aXN0ZS5cbiAgY29uc3QgYnV5ZXJTdGF0c0lkeCA9IG5ldyBNYXAoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBic1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9idXllcl9zdGF0cycpLmdldCgpO1xuICAgIGJzU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBidXllclN0YXRzSWR4LnNldChkLmlkLCBkLmRhdGEoKSB8fCB7fSk7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgY29uc29sZS53YXJuKFxuICAgICAgJ1ttYXN0ZXJmaWxlXSBjbGllbnRfYnV5ZXJfc3RhdHMgbm8gY2FyZ2FkbyAocnVsZSBkZW5pZWQgbyByZWQpOicsXG4gICAgICBfZSAmJiBfZS5tZXNzYWdlXG4gICAgKTtcbiAgfVxuICAvLyBIZWxwZXJzIGRlbCBwdXJlIGZuIChmYWxsYmFjayBpbmxpbmUgc2kgYnVuZGxlIG5vIGNhcmdcdTAwRjMpLlxuICBjb25zdCBfZmNMYWJlbHMgPVxuICAgICh3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUuZmljaGFDbGllbnRlTGFiZWxzKSB8fCBudWxsO1xuICBjb25zdCBfY2xhc2lmUm93ID0gKGNtZCkgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUNsYXNpZlJvd1xuICAgICAgPyBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93KGNtZClcbiAgICAgIDoge1xuICAgICAgICAgICdUaXBvIGRlIGNsaWVudGUnOiAnLScsXG4gICAgICAgICAgRmlkZWxpZGFkOiAnLScsXG4gICAgICAgICAgJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJzogJy0nLFxuICAgICAgICAgIFRhbWFcdTAwRjFvOiAnLScsXG4gICAgICAgICAgRXNwZWNpYWxpemFjaVx1MDBGM246ICctJyxcbiAgICAgICAgICAnVGlwbyBkZSBsb2NhbCc6ICctJyxcbiAgICAgICAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IGNtZCAmJiBjbWQuY3JlZGl0b0NoZXF1ZSA/IE51bWJlcihjbWQuY3JlZGl0b0NoZXF1ZSkgOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9idXllclJvdyA9IChicykgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVCdXllclJvdyhicywgJzEybScpXG4gICAgICA6IHtcbiAgICAgICAgICAnTW9udG8gdG90YWwgKDEybSknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogJy0nLFxuICAgICAgICAgICdGYWN0dXJhcyBwb3IgbWVzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcmltZXJhIGNvbXByYSc6ICctJyxcbiAgICAgICAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICB9O1xuICBjb25zdCBfZmlsbERhc2ggPSAocm93KSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5ID8gX2ZjTGFiZWxzLmZpbGxEYXNoSW5FbXB0eShyb3cpIDogcm93O1xuICAvLyB2MTQ4NSBcdTAwQTc4NCAoMjAyNi0xMC0yNyBCVUcgRklYKTogYlx1MDBGQXNxdWVkYSBwb3IgY2FyZENvZGUgKGZ1ZW50ZSBhdXRvcml0YXRpdmEpLlxuICAvLyB2MTQ4MiB1c2FiYSBgY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNsaWVudExvY0lkKHByb3YsIGxvYywgbmFtZSkpYCBcdTIwMTQgc2x1Z1xuICAvLyBkZXJpdmFkbyBkZSBQT0lOVFMuIFBhcmEgTUFYRVJBLCBQT0lOVFMgZGljZSBcIlBhbGVybW8gKEMxNClcIiBwZXJvIGxhIEZpY2hhXG4gIC8vIHBlcnNpc3RlIGNvbiBcIkNPTEVHSUFMRVNcIiBcdTIxOTIgZG9jSWQgbWlzbWF0Y2ggXHUyMTkyIGNtRGF0YSB1bmRlZmluZWQgXHUyMTkyIDUgY2FtcG9zXG4gIC8vIEZpY2hhIHNhbFx1MDBFRGFuIFwiLVwiIGF1bnF1ZSBjYXJnYWRvcy4gZmluZENtRGF0YUJ5Q2FyZENvZGUgZXNjYW5lYSBwb3JcbiAgLy8gc2FwQ2FyZENvZGUgT1IgY2FyZENvZGVTYXAgKGFtYm9zIGFsaWFzZXMpIHkgcmV0b3JuYSBlbCBkb2MgY29ycmVjdG8uXG4gIGNvbnN0IF9maW5kQnlDYXJkID1cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpbmRDbURhdGFCeUNhcmRDb2RlXG4gICAgICA/IF9mY0xhYmVscy5maW5kQ21EYXRhQnlDYXJkQ29kZVxuICAgICAgOiAoY2FyZENvZGUsIGNhY2hlKSA9PiB7XG4gICAgICAgICAgaWYgKCFjYXJkQ29kZSB8fCAhY2FjaGUgfHwgdHlwZW9mIGNhY2hlLmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHJldHVybiBudWxsO1xuICAgICAgICAgIGxldCBmb3VuZCA9IG51bGw7XG4gICAgICAgICAgY2FjaGUuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICAgICAgaWYgKGZvdW5kIHx8ICFkKSByZXR1cm47XG4gICAgICAgICAgICBjb25zdCBjYzEgPSBTdHJpbmcoZC5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgICAgICAgY29uc3QgY2MyID0gU3RyaW5nKGQuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgICAgIGlmIChjYzEgPT09IGNhcmRDb2RlIHx8IGNjMiA9PT0gY2FyZENvZGUpIGZvdW5kID0gZDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gZm91bmQ7XG4gICAgICAgIH07XG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcbiAgLy8gZHJvcGRvd24uIEFkbWluL2dlcmVudGUvdmlld2VyIGNvbiAnVG9kYXMnIG9idGllbmVuIG51bGwgLT4gc2luIGZpbHRyb1xuICAvLyAoZXhwb3J0YSB0b2RvIGVsIHBhaXMpLiBWZW5kZWRvciBvYnRpZW5lIHthc3NpZ25lZFZlbmRvcn0uIFZESSBvYnRpZW5lXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcbiAgLy8gZWxpZ2lvIChwcm9waW8gLyB1bmEgcGFyZWphIGVzcGVjaWZpY2EpLiBGdWVyYSBkZSBlc3RlIHNldCwgbGFzIHRpZW5kYXNcbiAgLy8gbm8gc2UgaW5jbHV5ZW4gZW4gZWwgRXhjZWwgLSBlbCBhcmNoaXZvIHJlZmxlamEgZXhhY3RhbWVudGUgbG8gcXVlIHZlXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cbiAgY29uc3Qgc2NvcGVTZXQgPVxuICAgIHR5cGVvZiBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgPT09ICdmdW5jdGlvbidcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcbiAgICAgIDogbnVsbDtcbiAgY29uc3QgaW5TY29wZSA9ICh2ZW5kb3JLZXkpID0+IHtcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xuICAgIGlmICghdmVuZG9yS2V5KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHNjb3BlU2V0Lmhhcyh2ZW5kb3JLZXkpO1xuICB9O1xuICAvLyBNYXBlbyBWREUgLT4gVkRJIChhIHBhcnRpciBkZSBsYXMgcGFyZWphcyBlc3RhbmRhcikuIEN1YW5kbyB1bmEgdGllbmRhXG4gIC8vIHBlcnRlbmVjZSBhIEZlZGVyaWNvIG8gR29uemFsbywgZWwgVkRJIGVzIElvYW5uaXMuIEN1YW5kbyBlcyBkZSBNYXVyaWNpb1xuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXG4gIC8vIHBhbmVsIGFkbWluLCBlc3RvIHNlIHBvZHJpYSBsZWVyIGRlbCBGaXJlc3RvcmUgLSBwZXJvIHBhcmEgZWwgbWFzdGVyZmlsZVxuICAvLyBlc3RhdGljbywgdXNhbW9zIGVsIGVzdGFuZGFyLlxuICBjb25zdCBWREVfVE9fVkRJID0ge1xuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICAgIFBBQ0hJOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LnpvbmUgOiAnJztcbiAgfVxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XG4gIH1cblxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcbiAgLy8gY2xpZW50ZSwgbWVyZ2VhIGxvcyBjYW1wb3MgZGUgY2xhc2lmaWNhY2lvbiAodGlwby90YW1hbm8vZmlkZWxpZGFkL1xuICAvLyBlc3BlY2lhbGl6YWNpb24vY2FuYWxDb21wcmEvcG9wL3RpcG9WZW50YS9ldGMuKSBkZWwgZm9ybXVsYXJpbyBkZVxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXG4gIC8vIE5PIFZBQ0lPIGFsIHJlY29ycmVyIGRvY3MgZGUgbWFzIHJlY2llbnRlIGEgbWFzIGFudGlndW8uIEFzaSBlbCB1c3VhcmlvXG4gIC8vIHZlIGxhIGNsYXNpZmljYWNpb24gbWFzIGFjdHVhbGl6YWRhLCBwZXJvIHNpIGVsIHVsdGltbyBjb250YWN0byBubyBsbGVuYVxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcbiAgLy8gZW4gdmV6IGRlIGRlamFyIHZhY2lvLiBQZWRpZG8gZGUgTWFyaWFubzogXCJwcmlvcml6YXIgbGEgdWx0aW1hXG4gIC8vIGludGVyYWNjaW9uIHBlcm8gbm8gcGVyZGVyIGluZm8gdXRpbCBkZSBsYXMgYW50ZXJpb3Jlc1wiLlxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcbiAgICAndGlwbycsXG4gICAgJ2xvY2FsJyxcbiAgICAndGFtYW5vJyxcbiAgICAnZmlkZWxpZGFkJyxcbiAgICAnZXNwZWNpYWxpemFjaW9uJyxcbiAgICAnY2FuYWxDb21wcmEnLFxuICAgICdyZWxldmFuY2lhJyxcbiAgICAncG9wJyxcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXG4gICAgJ3RpcG9WZW50YScsXG4gICAgJ3BvbmRlcmFjaW9uTW9zdHJhZG8nLFxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXG4gICAgJ2NvbXBldGVuY2lhJyxcbiAgICAnb3BvcnR1bmlkYWQnLFxuICAgICdtYXNWZW5kaWRvJyxcbiAgICAnbWFzUHJlZ3VudGFuJyxcbiAgICAnYXl1ZGFUaWVuZGEnLFxuICBdO1xuICBmdW5jdGlvbiBfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIHJldHVybiAoXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKGxvYyB8fCAnJykudG9TdHJpbmcoKS50cmltKCkgK1xuICAgICAgJ3wnICtcbiAgICAgICh0aWVuZGEgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpXG4gICAgKTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlRzKHYpIHtcbiAgICBpZiAodiAmJiB2LmNyZWF0ZWRBdCAmJiB2LmNyZWF0ZWRBdC50b01pbGxpcykgcmV0dXJuIHYuY3JlYXRlZEF0LnRvTWlsbGlzKCk7XG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xuICAgIHJldHVybiAwO1xuICB9XG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XG4gIGlmICh0eXBlb2YgdmlzaXRzQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkodmlzaXRzQ2FjaGUpKSB7XG4gICAgY29uc3QgYnlLZXkgPSBuZXcgTWFwKCk7XG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgICAgaWYgKCF2KSByZXR1cm47XG4gICAgICBjb25zdCBrID0gX2NsYXNzaWZLZXkodi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSk7XG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcbiAgICAgIGJ5S2V5LmdldChrKS5wdXNoKHYpO1xuICAgIH0pO1xuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xuICAgICAgYXJyLnNvcnQoKGEsIGIpID0+IF9jbGFzc2lmVHMoYikgLSBfY2xhc3NpZlRzKGEpKTsgLy8gZGVzYyBwb3IgZmVjaGFcbiAgICAgIGNvbnN0IG1lcmdlZCA9IHt9O1xuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcbiAgICAgICAgQ0xBU1NJRl9GSUVMRFMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgICAgIGlmIChtZXJnZWRbZl0gIT0gbnVsbCAmJiBtZXJnZWRbZl0gIT09ICcnICYmIG1lcmdlZFtmXSAhPT0gMCkgcmV0dXJuO1xuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XG4gICAgICAgICAgaWYgKHZhbCAhPSBudWxsICYmIHZhbCAhPT0gJycpIG1lcmdlZFtmXSA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGFyclswXSB8fCB7fTtcbiAgICAgIGNsYXNzaWZJbmRleC5zZXQoaywge1xuICAgICAgICBtZXJnZWQsXG4gICAgICAgIGxhc3RGZWNoYTogbGF0ZXN0LmZlY2hhIHx8ICcnLFxuICAgICAgICBsYXN0VHlwZTogbGF0ZXN0LmludGVyYWN0aW9uVHlwZSB8fCAobGF0ZXN0LmVzcGFjaW8gPyAndmlzaXRhJyA6ICcnKSxcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcbiAgICAgICAgY29udGFjdG9zOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gX2NsYXNzaWZSb3cocHJvdiwgbG9jLCB0aWVuZGEpIHtcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxuICAgICAgICAnVG90YWwgdmlzaXRhcyc6IDAsXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxuICAgICAgICAnVGlwbyBjb21lcmNpbyc6ICcnLFxuICAgICAgICBMb2NhbDogJycsXG4gICAgICAgIFRhbWFubzogJycsXG4gICAgICAgIEZpZGVsaWRhZDogJycsXG4gICAgICAgIEVzcGVjaWFsaXphY2lvbjogJycsXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcbiAgICAgICAgUmVsZXZhbmNpYTogJycsXG4gICAgICAgIFBPUDogJycsXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxuICAgICAgICAnVGlwbyBkZSB2ZW50YSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcbiAgICAgICAgQ29tcGV0ZW5jaWE6ICcnLFxuICAgICAgICBPcG9ydHVuaWRhZDogJycsXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxuICAgICAgICAnTWFzIHByZWd1bnRhbic6ICcnLFxuICAgICAgICAnQXl1ZGEgdGllbmRhJzogJycsXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBtID0gZW50cnkubWVyZ2VkIHx8IHt9O1xuICAgIHJldHVybiB7XG4gICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdEZlY2hhLFxuICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdFR5cGUsXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXG4gICAgICAnVG90YWwgY29udGFjdG9zJzogZW50cnkuY29udGFjdG9zLFxuICAgICAgJ1RpcG8gY29tZXJjaW8nOiBtLnRpcG8gfHwgJycsXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcbiAgICAgIFRhbWFubzogbS50YW1hbm8gfHwgJycsXG4gICAgICBGaWRlbGlkYWQ6IG0uZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcbiAgICAgICdDYW5hbCBkZSBjb21wcmEnOiBtLmNhbmFsQ29tcHJhIHx8ICcnLFxuICAgICAgUmVsZXZhbmNpYTogbS5yZWxldmFuY2lhICE9IG51bGwgPyBtLnJlbGV2YW5jaWEgOiAnJyxcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXG4gICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiBtLm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICAnVGlwbyBkZSB2ZW50YSc6IG0udGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogbS5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gbS5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxuICAgICAgQ29tcGV0ZW5jaWE6IG0uY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgICdNYXMgdmVuZGlkbyc6IG0ubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgICdNYXMgcHJlZ3VudGFuJzogbS5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxuICAvLyB0aWVuZW4gY2FyZENvZGUgKyBkaXJlY2Npb24uIEVzb3Mgc29uIGxvcyBxdWUgYXBhcmVjZW4gY29tbyB2ZXJkZXMgZW5cbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xuICAvLyByZWFsIG9wZXJhYmxlIGhveS5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHByb3ZpbmNlID0gcC5wcm92aW5jZSB8fCAnJztcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcbiAgICBjb25zdCBkZXB0ID0gcC5kZXB0IHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvciA9IHAudmVuZG9yIHx8ICcnO1xuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cbiAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgIGNvbnN0IGxhdCA9IHAubGF0ICE9IG51bGwgPyBwLmxhdCA6ICcnO1xuICAgIGNvbnN0IGxvbiA9IHAubG9uICE9IG51bGwgPyBwLmxvbiA6ICcnO1xuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cbiAgICAvLyBlbCBmaWx0cm8gaXNTYXBDb25maXJtZWQ6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi5cbiAgICAocC5jbGllbnRzIHx8IFtdKS5mb3JFYWNoKChuYW1lKSA9PiB7XG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpXG4gICAgICAgIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XG4gICAgICAvLyBFc3RhZG86IGhhYmlsaXRhZG8vY2FuY2VsYWRvL3BlbmRpZW50ZSAobGVnYWN5IGNvbnRhY3RlZCBzZXQpLlxuICAgICAgbGV0IGVzdGFkbyA9ICdIYWJpbGl0YWRvJzsgLy8gcG9yIGRlZmluaWNpb24geWEgZXN0YSBTQVAtY29uZmlybWFkb1xuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcbiAgICAgICAgZXN0YWRvID0gJ0NhbmNlbGFkbyc7XG4gICAgICAvLyBNZXRhZGF0YSBjdXN0b20gKGRpcmVjY2lvbiwgbG9jYWxpZGFkIGRlY2xhcmFkYSwgZ2VvY29kZSkuXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xuICAgICAgLy8gQnVzY2FyIGFkZHJlc3M6IDEpIGNsaWVudF9tYXN0ZXIuYWRkcmVzcyAoYWRtaW4pLCAyKSBjbGllbnRNZXRhLmFkZHJlc3MgKHZlbmRvcikuXG4gICAgICBjb25zdCBkb2NJZCA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcbiAgICAgIGNvbnN0IGNtRGF0YSA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XG4gICAgICBjb25zdCBhZGRyZXNzID0gY21EYXRhLmFkZHJlc3MgfHwgbWV0YS5hZGRyZXNzIHx8ICcnO1xuICAgICAgY29uc3QgbG9jYWxpdHlDdXN0ID0gY21EYXRhLmxvY2FsaWRhZCB8fCBtZXRhLmxvY2FsaXR5IHx8ICcnO1xuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XG4gICAgICBjb25zdCBjdXN0b21MbmcgPSBtZXRhLmxuZyAhPSBudWxsID8gbWV0YS5sbmcgOiAnJztcbiAgICAgIC8vIENhcmRDb2RlIFNBUCAoZGUgY2xpZW50X21hc3RlciBvIGRlIGxhIGFsdGEgdmluY3VsYWRhKS5cbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcHJvdmluY2UudG9VcHBlckNhc2UoKSArICd8JyArIGxvY2FsaXR5TWFwO1xuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiAoYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8ICcnKSA9PT0gbmFtZSk7XG4gICAgICAgIGlmIChhbHRhTWF0Y2gpIGNhcmRDb2RlID0gYWx0YU1hdGNoLmNhcmRDb2RlU2FwIHx8ICcnO1xuICAgICAgfVxuICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IEJ1eWVyIHN0YXRzIGluZGV4YWRvIHBvciBjYXJkQ29kZSBTQVAuXG4gICAgICBjb25zdCBfYnV5ZXJTdGF0cyA9IGNhcmRDb2RlID8gYnV5ZXJTdGF0c0lkeC5nZXQoY2FyZENvZGUpIHx8IG51bGwgOiBudWxsO1xuICAgICAgLy8gdjE0ODUgXHUwMEE3ODQgQlVHIEZJWDogYnVzY2FyIGNtRGF0YSBhdXRvcml0YXRpdm8gcG9yIGNhcmRDb2RlLiBFbFxuICAgICAgLy8gY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGRvY0lkKSBkZSBhcnJpYmEgdXNhIHNsdWcgY2xpZW50TG9jSWQgcXVlIHB1ZWRlXG4gICAgICAvLyBhcHVudGFyIGFsIGRvYyBFUVVJVk9DQURPICh2ZXIgY29tbWVudCBhcnJpYmEpLiBfZmluZEJ5Q2FyZCBzY2FuIHBvclxuICAgICAgLy8gc2FwQ2FyZENvZGUgZ2FyYW50aXphIGVuY29udHJhciBlbCBkb2MgY29uIGxvcyBjYW1wb3MgRmljaGEuXG4gICAgICBjb25zdCBfY21EYXRhRm9yRmljaGEgPSBfZmluZEJ5Q2FyZChjYXJkQ29kZSwgY2xpZW50TWFzdGVyQ2FjaGUpIHx8IGNtRGF0YTtcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogY2FyZENvZGUsXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6IGN1c3RvbU5hbWUsXG4gICAgICAgICAgICBUaXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdmluY2UpIDogcHJvdmluY2UsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvY2FsaXR5TWFwLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhZGRyZXNzLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGN1c3RvbUxhdCB8fCBsYXQsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGN1c3RvbUxuZyB8fCBsb24sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogT1JERU4gaW1wb3J0YS4gTGVnYWN5IHZpc2l0YXMgUFJJTUVSTyAoZmFsbGJhY2spLFxuICAgICAgICAgIC8vIGx1ZWdvIEZpY2hhIENsaWVudGUgUElTQSBjb24gbGFiZWxzIGRlIGxhIGZ1ZW50ZSBhdXRvcml0YXRpdmFcbiAgICAgICAgICAvLyAoZWouIFwiRmlkZWxpZGFkXCIgRmljaGEgcGlzYSBsYSBtZXJnZWFkYSBkZSB2aXNpdGFzIHF1ZSBwdWVkZVxuICAgICAgICAgIC8vIGVzdGFyIGRlc2FjdHVhbGl6YWRhKS4gQnV5ZXIgc3RhdHMgYWwgZmluYWwgKHZlbnRhbmEgMTJtKS5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpLFxuICAgICAgICAgIF9jbGFzaWZSb3coX2NtRGF0YUZvckZpY2hhKSxcbiAgICAgICAgICBfYnV5ZXJSb3coX2J1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuICAvLyBJbnllY3RhciBhbHRhcyBkZSBjbGllbnRfYXBwbGljYXRpb25zIChhcHByb3ZlZEFsdGFzTGlzdCk6XG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXG4gIC8vICAgKiBQUk9WSVNPUklPUyAodjMxMSspOiBtYW51YWxTYXBQZW5kaW5nICYmICFjYXJkQ29kZVNhcCAoQWx0YSBSYXBpZGFcbiAgLy8gICAgIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuIFZhbiBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy4gU2VcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xuICAvLyAgICAgcXVlIGVsIGdlcmVudGUgZXN0YSBnZXN0aW9uYW5kbywgbm8gc29sbyBsb3MgY2VycmFkb3MgZW4gU0FQLlxuICAvLyAgICAgTG9zIHByb3Zpc29yaW9zIHB1ZWRlbiBubyB0ZW5lciBkaXJlY2Npb24gdG9kYXZpYSAtPiBzZSBhY2VwdGFuIGlndWFsLlxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBzZWVuLmFkZChcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxuICAgICk7XG4gIH0pO1xuICBpZiAodHlwZW9mIGFwcHJvdmVkQWx0YXNMaXN0ICE9PSAndW5kZWZpbmVkJyAmJiBhcHByb3ZlZEFsdGFzTGlzdC5sZW5ndGgpIHtcbiAgICBhcHByb3ZlZEFsdGFzTGlzdC5mb3JFYWNoKChhKSA9PiB7XG4gICAgICBpZiAoIWEpIHJldHVybjtcbiAgICAgIGNvbnN0IGlzUHJvdmlzb3JpbyA9ICEhYS5tYW51YWxTYXBQZW5kaW5nICYmICFhLmNhcmRDb2RlU2FwO1xuICAgICAgLy8gSGFiaWxpdGFkb3M6IHNpZ3VlbiBleGlnaWVuZG8gY2FyZENvZGUgKyBkaXJlY2Npb24gKGNvbXBvcnRhbWllbnRvIHByZS12MzExKS5cbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXG4gICAgICBpZiAoIWlzUHJvdmlzb3Jpbykge1xuICAgICAgICBpZiAoIWEuY2FyZENvZGVTYXApIHJldHVybjtcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwcm92ID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgY29uc3Qgbm9tYnJlID1cbiAgICAgICAgYS5jb21lcmNpbyB8fFxuICAgICAgICBhLmZhbnRhc2lhIHx8XG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xuICAgICAgY29uc3QgZHVwS2V5ID0gcHJvdi50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbm9tYnJlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMoZHVwS2V5KSkgcmV0dXJuO1xuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcbiAgICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgICAvLyB2MzMxOiBtaXNtbyBmaWx0cm8gZGUgc2NvcGUgYXBsaWNhIGEgYWx0YXMgU0FQL3Byb3Zpc29yaWFzLlxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcbiAgICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xuICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IHBhcmEgYWx0YXMsIGJ1eWVyIHN0YXRzIGtleWVkIHBvciBjYXJkQ29kZVNhcCAoc2kgZXhpc3RlKS5cbiAgICAgIGNvbnN0IF9hbHRhQnV5ZXJTdGF0cyA9IGEuY2FyZENvZGVTYXAgPyBidXllclN0YXRzSWR4LmdldChhLmNhcmRDb2RlU2FwKSB8fCBudWxsIDogbnVsbDtcbiAgICAgIC8vIHYxNDg1IFx1MDBBNzg0IEJVRyBGSVg6IHBhcmEgYWx0YXMgY29uIGNhcmRDb2RlLCBlbCBkb2MgYXV0b3JpdGF0aXZvIGNvblxuICAgICAgLy8gY2FtcG9zIEZpY2hhIHZpdmUgZW4gY2xpZW50X21hc3RlciAobG8gZXNjcmliZSBzYXZlQ2xpZW50Q2F0ZWdvcmlhRnJvbU1vZGFsXG4gICAgICAvLyB2aWEgRmljaGEpLiBfZmluZEJ5Q2FyZCByZXRvcm5hIGVzZSBkb2MuIEZhbGxiYWNrIGFsIHByb3BpbyBhbHRhIGBhYFxuICAgICAgLy8gc2kgZWwgY2xpZW50ZSBubyBlc3RcdTAwRTEgZW4gY2xpZW50X21hc3RlciAoZWouIHByb3Zpc29yaW8gc2luIGNhcmRDb2RlKS5cbiAgICAgIGNvbnN0IF9hbHRhQ21EYXRhID0gYS5jYXJkQ29kZVNhcCA/IF9maW5kQnlDYXJkKGEuY2FyZENvZGVTYXAsIGNsaWVudE1hc3RlckNhY2hlKSB8fCBhIDogYTtcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogYS5jYXJkQ29kZVNhcCB8fCAnJyxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcbiAgICAgICAgICAgIFRpcG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvIChBbHRhIHJhcGlkYSknIDogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICAgICAgWm9uYTogem9uZSxcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgICAgIERpcmVjY2lvbjogYS5jYWxsZSB8fCBhLmFkZHJlc3MgfHwgJycsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGEubG5nICE9IG51bGwgPyBhLmxuZyA6ICcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IG1pc21vIG9yZGVuIHF1ZSBQT0lOVFMgXHUyMDE0IGxlZ2FjeSB2aXNpdGFzIHByaW1lcm8sXG4gICAgICAgICAgLy8gRmljaGEgcGlzYSwgQnV5ZXIgYWwgZmluYWwuXG4gICAgICAgICAgX2NsYXNzaWZSb3cocHJvdiwgbG9jLCBub21icmUpLFxuICAgICAgICAgIF9jbGFzaWZSb3coX2FsdGFDbURhdGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYWx0YUJ1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBPcmRlbmFyIHBvciBwcm92aW5jaWEsIGxvY2FsaWRhZCwgbm9tYnJlLlxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChhWydOb21icmUgdGllbmRhJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKTtcbiAgfSk7XG5cbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xuICAgICAgICAnRWwgbWFzdGVyZmlsZSBpbmNsdXllOlxcbicgK1xuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xuICAgICAgICAnU2kgbm8gdmVzIG5pbmd1bm8sIHJldmlzYSBlbCBtb2RhbCBTQVAgbyBBbHRhIENsaWVudGVzLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggaGVscGVyIChlc3RpbG8gdmVyZGUgKyBjZW50ZXJlZFxuICAvLyB1bmlmb3JtZSkuIEFudGVzIHVzYWJhIFhMU1gud3JpdGVGaWxlIGRpcmVjdG8gY29uIFNoZWV0SlMgZnJlZSBxdWUgaWdub3JhXG4gIC8vIGVzdGlsb3MuIEFob3JhIGhlcmVkYWRvIGRlbCBoZWxwZXIgXHUyMDE0IG1pc21hIFVJIHF1ZSBWZW50YXMvVmlzaXRhcy9ldGMuXG4gIC8vIHYxMDQzICgyMDI2LTA5LTIzKTogcG9zdC1wcm9jZXNvIFx1MjAxNCBzYWNhciBjb2x1bW5hcyAxMDAlIHZhY1x1MDBFRGFzLlxuICAvLyBSZXBvcnRlIE1hcmlhbm86IG1hc3RlcmZpbGUgZXhwb3J0YWJhIDM3IGNvbHVtbmFzIGRvbmRlIG11Y2hhcyB2ZW5cdTAwRURhblxuICAvLyB2YWNcdTAwRURhcyBwb3JxdWUgbm8gaGFiXHUwMEVEYSB2aXNpdGFzL2NvbnRhY3RvcyBjYXJnYWRvcyBwYXJhIGVzb3MgY2xpZW50ZXMuXG4gIC8vIEZpeDogaWRlbnRpZmljYXIga2V5cyBkb25kZSBUT0RBUyBsYXMgZmlsYXMgdGllbmVuIHZhbG9yIFwidmFjXHUwMEVEb1wiIChlbXB0eVxuICAvLyBzdHJpbmcsIG51bGwsIHVuZGVmaW5lZCkgeSByZW1vdmVybGFzIGFudGVzIGRlbCBzaGVldC4gTG9zIGNvbnRlb3NcbiAgLy8gKFRvdGFsIHZpc2l0YXMvY29udGFjdG9zKSBzZSBjb25zaWRlcmFuIHZhY1x1MDBFRG9zIHNpIHRvZG9zIHNvbiAwLlxuICAvLyBXaWR0aHMgcG9yIGNvbHVtbi1uYW1lIChlbiB2ZXogZGUgcG9zaWNpb25hbCkgcGFyYSBxdWUgZWwgZmlsdGVyIG5vXG4gIC8vIGRlc2FsaW5lZSBlbCBzaGVldCBjdWFuZG8gcmVtb3ZlbW9zIGNvbHVtbmFzLlxuICBjb25zdCBDT0xfV0lEVEhTID0ge1xuICAgICdDYXJkQ29kZSBTQVAnOiAxNixcbiAgICAnTm9tYnJlIHRpZW5kYSc6IDM4LFxuICAgICdBbGlhcyAobW9kYWwpJzogMjgsXG4gICAgVGlwbzogMTQsXG4gICAgRXN0YWRvOiAxNCxcbiAgICBQcm92aW5jaWE6IDIyLFxuICAgICdMb2NhbGlkYWQgKG1hcGEpJzogMjIsXG4gICAgRGVwYXJ0YW1lbnRvOiAyMixcbiAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IDI4LFxuICAgIFpvbmE6IDgsXG4gICAgJ0V0aXF1ZXRhIHpvbmEnOiA0OCxcbiAgICAnQXNlc29yIGludGVybm8gKFZESSknOiAyOCxcbiAgICBEaXJlY2Npb246IDM4LFxuICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogMjQsXG4gICAgJ0xhdCAoZ2VvY29kZSknOiAxNCxcbiAgICAnTG5nIChnZW9jb2RlKSc6IDE0LFxuICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBjb2x1bW5hcyBkZSBsYSBGaWNoYSBDbGllbnRlIChwZXN0YVx1MDBGMWEgQ2xhc2lmaWNhY2lcdTAwRjNuKSArXG4gICAgLy8gQnV5ZXIgKHBlc3RhXHUwMEYxYSBCdXllciwgdmVudGFuYSAxMm0pLiBPcmRlbiBleGFjdG8gcXVlIGxsZWdhIGRlc2RlXG4gICAgLy8gX2NsYXNpZlJvdyAoT2JqZWN0LmFzc2lnbiBwcmVzZXJ2YSBvcmRlbiBkZSBrZXlzKS5cbiAgICAnVGlwbyBkZSBjbGllbnRlJzogMzYsXG4gICAgRmlkZWxpZGFkOiAxMCxcbiAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAyMCxcbiAgICBUYW1hXHUwMEYxbzogMTAsXG4gICAgRXNwZWNpYWxpemFjaVx1MDBGM246IDIwLFxuICAgICdUaXBvIGRlIGxvY2FsJzogMTQsXG4gICAgJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknOiAxOCxcbiAgICAnTW9udG8gdG90YWwgKDEybSknOiAxNixcbiAgICAnRmFjdHVyYXMgKDEybSknOiAxMixcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknOiAyMCxcbiAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogMjAsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAxNixcbiAgICAnUHJpbWVyYSBjb21wcmEnOiAxNCxcbiAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogMTQsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAxOCxcbiAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RvdGFsIHZpc2l0YXMnOiAxMCxcbiAgICAnVG90YWwgY29udGFjdG9zJzogMTAsXG4gICAgJ1RpcG8gY29tZXJjaW8nOiAxOCxcbiAgICBMb2NhbDogMTYsXG4gICAgJ0NhbmFsIGRlIGNvbXByYSc6IDIwLFxuICAgIFJlbGV2YW5jaWE6IDEwLFxuICAgIFBPUDogOCxcbiAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAyNixcbiAgICAnVGlwbyBkZSB2ZW50YSc6IDE2LFxuICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogMTgsXG4gICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogMTgsXG4gICAgQ29tcGV0ZW5jaWE6IDI2LFxuICAgIE9wb3J0dW5pZGFkOiAyNixcbiAgICAnTWFzIHZlbmRpZG8nOiAyMixcbiAgICAnTWFzIHByZWd1bnRhbic6IDIyLFxuICAgICdBeXVkYSB0aWVuZGEnOiAyNixcbiAgfTtcbiAgLy8gRGV0ZWN0YXIga2V5cyAxMDAlIHZhY1x1MDBFRGFzLlxuICBjb25zdCBhbGxLZXlzID0gT2JqZWN0LmtleXMoQ09MX1dJRFRIUyk7XG4gIGNvbnN0IE5VTUVSSUNfWkVST19PSyA9IG5ldyBTZXQoWydUb3RhbCB2aXNpdGFzJywgJ1RvdGFsIGNvbnRhY3RvcyddKTtcbiAgLy8gdjE0ODIgXHUwMEE3ODIgKyB2MTQ4NSBcdTAwQTc4NCBtZWpvcmE6IGNvbHVtbmFzIEZpY2hhICsgZXN0cnVjdHVyYWxlcyAoQ2FyZENvZGUsXG4gIC8vIFpvbmEsIFZlbmRlZG9yLCBEaXJlY2NpXHUwMEYzbiwgZXRjLikgTlVOQ0Egc2Ugb21pdGVuLiBNYXJpYW5vIHBpZGlcdTAwRjM6XG4gIC8vIFwibm8gb2N1bHRhciBjb2x1bW5hcyBwb3Igcm9sOyBQQUNISSByZWNpYmUgbGFzIG1pc21hcyBjb2x1bW5hcyBxdWVcbiAgLy8gYWRtaW4sIHNvbG8gc3VzIGNsaWVudGVzXCIuIEVsIGV4cG9ydCBWREUvUEFDSEkgcmVzcGV0YSBlc3RlIGNvbnRyYXRvXG4gIC8vIHBvcnF1ZSBsYXMgc3RydWN0dXJhbGVzIGVzdFx1MDBFMW4gcHJvdGVnaWRhcyBhdW5xdWUgZWwgc2NvcGUgcmVkdWNpZG8gbm9cbiAgLy8gdGVuZ2EgZGF0b3MgcGFyYSBhbGd1bmEgZGUgZWxsYXMuXG4gIGNvbnN0IFNUUlVDVFVSQUxfUFJPVEVDVEVEID0gbmV3IFNldChbXG4gICAgJ0NhcmRDb2RlIFNBUCcsXG4gICAgJ05vbWJyZSB0aWVuZGEnLFxuICAgICdBbGlhcyAobW9kYWwpJyxcbiAgICAnVGlwbycsXG4gICAgJ0VzdGFkbycsXG4gICAgJ1Byb3ZpbmNpYScsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknLFxuICAgICdEZXBhcnRhbWVudG8nLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJyxcbiAgICAnWm9uYScsXG4gICAgJ0V0aXF1ZXRhIHpvbmEnLFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKScsXG4gICAgJ0RpcmVjY2lvbicsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnLFxuICAgICdMYXQgKGdlb2NvZGUpJyxcbiAgICAnTG5nIChnZW9jb2RlKScsXG4gIF0pO1xuICBjb25zdCBGSUNIQV9QUk9URUNURUQgPSBuZXcgU2V0KFtcbiAgICAnVGlwbyBkZSBjbGllbnRlJyxcbiAgICAnRmlkZWxpZGFkJyxcbiAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nLFxuICAgICdUYW1hXHUwMEYxbycsXG4gICAgJ0VzcGVjaWFsaXphY2lcdTAwRjNuJyxcbiAgICAnVGlwbyBkZSBsb2NhbCcsXG4gICAgJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknLFxuICAgICdNb250byB0b3RhbCAoMTJtKScsXG4gICAgJ0ZhY3R1cmFzICgxMm0pJyxcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknLFxuICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknLFxuICAgICdGYWN0dXJhcyBwb3IgbWVzICgxMm0pJyxcbiAgICAnUHJpbWVyYSBjb21wcmEnLFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnLFxuICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJyxcbiAgXSk7XG4gIGNvbnN0IGVtcHR5S2V5cyA9IG5ldyBTZXQoXG4gICAgYWxsS2V5cy5maWx0ZXIoKGspID0+IHtcbiAgICAgIGlmIChTVFJVQ1RVUkFMX1BST1RFQ1RFRC5oYXMoaykpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChGSUNIQV9QUk9URUNURUQuaGFzKGspKSByZXR1cm4gZmFsc2U7XG4gICAgICByZXR1cm4gcm93cy5ldmVyeSgocikgPT4ge1xuICAgICAgICBjb25zdCB2ID0gcltrXTtcbiAgICAgICAgaWYgKHYgPT09ICcnIHx8IHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgaWYgKE5VTUVSSUNfWkVST19PSy5oYXMoaykgJiYgdiA9PT0gMCkgcmV0dXJuIHRydWU7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICAgIH0pXG4gICk7XG4gIGNvbnN0IGtlcHRLZXlzID0gYWxsS2V5cy5maWx0ZXIoKGspID0+ICFlbXB0eUtleXMuaGFzKGspKTtcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IHJlZ2xhIFwibmluZ3VuYSBjZWxkYSB2YWNcdTAwRURhXCIgXHUyMDE0IGZpbGxEYXNoSW5FbXB0eSBzb2JyZSBUT0RBU1xuICAvLyBsYXMgY29sdW1uYXMgZmluYWxlcyAoY2xhc2lmICsgYnV5ZXIgKyBsZWdhY3kgdmlzaXRhcykuXG4gIGNvbnN0IHJvd3NGaWx0ZXJlZCA9IHJvd3MubWFwKChyKSA9PiB7XG4gICAgY29uc3Qgb3V0ID0ge307XG4gICAga2VwdEtleXMuZm9yRWFjaCgoaykgPT4ge1xuICAgICAgb3V0W2tdID0gcltrXTtcbiAgICB9KTtcbiAgICByZXR1cm4gX2ZpbGxEYXNoKG91dCk7XG4gIH0pO1xuICBjb25zdCByZW1vdmVkQ291bnQgPSBlbXB0eUtleXMuc2l6ZTtcbiAgaWYgKHJlbW92ZWRDb3VudCA+IDApIHtcbiAgICBjb25zb2xlLmxvZyhgW21hc3RlcmZpbGVdIHJlbW92aWRhcyAke3JlbW92ZWRDb3VudH0gY29scyB2YWNcdTAwRURhczpgLCBbLi4uZW1wdHlLZXlzXS5qb2luKCcsICcpKTtcbiAgfVxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHpvbmFcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGFncmVnYXIgY29udGVvIHBvciBUaXBvIGRlIGNsaWVudGUgKyBGaWRlbGlkYWQgKGRvcyBudWV2YXNcbiAgLy8gY29sdW1uYXMgY29uIGRldGFsbGUgcG9yIHpvbmEpLiBGb3JtYXRvIGJyZXZlIFwiQTogTiwgQjogTSwgLTogS1wiIHBhcmFcbiAgLy8gY2FiZXIgZW4gdW5hIHNvbGEgY2VsZGEgbGVnaWJsZS5cbiAgY29uc3QgYnlab25lID0ge307XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGNvbnN0IHogPSByWydFdGlxdWV0YSB6b25hJ10gfHwgJ1NpbiB6b25hJztcbiAgICBpZiAoIWJ5Wm9uZVt6XSkge1xuICAgICAgYnlab25lW3pdID0ge1xuICAgICAgICB0b3RhbDogMCxcbiAgICAgICAgaGFiaWxpdGFkb3M6IDAsXG4gICAgICAgIGNhbmNlbGFkb3M6IDAsXG4gICAgICAgIHRpcG9zOiB7fSxcbiAgICAgICAgZmlkZWxpZGFkZXM6IHt9LFxuICAgICAgfTtcbiAgICB9XG4gICAgYnlab25lW3pdLnRvdGFsKys7XG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xuICAgIGVsc2UgaWYgKHIuRXN0YWRvID09PSAnQ2FuY2VsYWRvJykgYnlab25lW3pdLmNhbmNlbGFkb3MrKztcbiAgICAvLyBUaXBvIGRlIGNsaWVudGU6IHRvbWFyIHByaW1lciBjaGFyIGRlbCBsYWJlbCAoXCJBIC0gLi4uXCIsIFwiQiAtIC4uLlwiLFxuICAgIC8vIFwiUCAoUHJlbWl1bSkuLi5cIiwgXCJDIC0gLi4uXCIpLiBTaSBsYWJlbCBlcyBcIi1cIiBcdTIxOTIgXCItXCIuXG4gICAgY29uc3QgdGlwb0xibCA9IHJbJ1RpcG8gZGUgY2xpZW50ZSddIHx8ICctJztcbiAgICBjb25zdCB0aXBvS2V5ID0gdGlwb0xibCA9PT0gJy0nID8gJy0nIDogU3RyaW5nKHRpcG9MYmwpLnRyaW0oKS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKTtcbiAgICBieVpvbmVbel0udGlwb3NbdGlwb0tleV0gPSAoYnlab25lW3pdLnRpcG9zW3RpcG9LZXldIHx8IDApICsgMTtcbiAgICBjb25zdCBmaWQgPSByLkZpZGVsaWRhZCB8fCAnLSc7XG4gICAgYnlab25lW3pdLmZpZGVsaWRhZGVzW2ZpZF0gPSAoYnlab25lW3pdLmZpZGVsaWRhZGVzW2ZpZF0gfHwgMCkgKyAxO1xuICB9KTtcbiAgZnVuY3Rpb24gX2ZtdERpc3QoZGlzdCkge1xuICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyhkaXN0KS5zb3J0KChhLCBiKSA9PiBiWzFdIC0gYVsxXSk7XG4gICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gJy0nO1xuICAgIHJldHVybiBlbnRyaWVzLm1hcCgoW2ssIHZdKSA9PiBgJHtrfTogJHt2fWApLmpvaW4oJywgJyk7XG4gIH1cbiAgY29uc3QgcmVzdW1lblJvd3MgPSBPYmplY3QuZW50cmllcyhieVpvbmUpXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xuICAgICAgJ1pvbmEgLyBWZW5kZWRvcic6IHosXG4gICAgICAnVG90YWwgdGllbmRhcyc6IGQudG90YWwsXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcbiAgICAgIENhbmNlbGFkYXM6IGQuY2FuY2VsYWRvcyxcbiAgICAgICdQb3IgVGlwbyBkZSBjbGllbnRlJzogX2ZtdERpc3QoZC50aXBvcyksXG4gICAgICAnUG9yIEZpZGVsaWRhZCc6IF9mbXREaXN0KGQuZmlkZWxpZGFkZXMpLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydUb3RhbCB0aWVuZGFzJ10gLSBhWydUb3RhbCB0aWVuZGFzJ10pO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxuICBjb25zdCBzY29wZUxibCA9XG4gICAgc2NvcGVTZXQgPT09IG51bGxcbiAgICAgID8gJ1RPRE9TJ1xuICAgICAgOiBzY29wZVNldC5zaXplID09PSAxXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcbiAgY29uc3QgZm5hbWUgPSAnTWFzdGVyZmlsZV9DbGllbnRlc19TQVBfJyArIHNjb3BlTGJsICsgJ18nICsgdHMgKyAnLnhsc3gnO1xuICBhd2FpdCBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBoYWJpbGl0YWRvcyBTQVAnLCByb3dzOiByb3dzRmlsdGVyZWQgfSxcbiAgICB7IG5hbWU6ICdSZXN1bWVuIHBvciB6b25hJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgZXhwb3J0YWRvcycgK1xuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcbiAgKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0OiBQcmVjaW9zICsgU3RvY2sgcG9yIFNLVVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcbi8vIGVuIG1lbW9yaWE6IFBST0RVQ1RTIChtYXN0ZXIgZGUgU0tVcyksIFBSSUNFX0xJU1RfTUFQIChwcmVjaW8gQVJTIGRlXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cbi8vIEhvamFzOlxuLy8gIC0gXCJQcmVjaW9zIHkgU3RvY2tcIjogdW5hIGZpbGEgcG9yIFNLVSBjb24gdG9kYXMgbGFzIGNvbHVtbmFzIGp1bnRhc1xuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXG4vLyAgLSBcIlN0b2NrXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBlc3RhZG8gZGUgc3RvY2suXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBjYXRhbG9nbyBkZSBwcm9kdWN0b3MgY2FyZ2FkbyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIHByZWNpb3MgKyBzdG9jay4uLicpO1xuICAvLyB2NTc0ICgyMDI2LTA4LTIxKTogbW9zdHJhciBVTklEQURFUyBudW1lcmljYXMgZXhhY3RhcyBkZWwgZGVwb3NpdG8gMTEuXG4gIC8vIHYxMzYzICgyMDI2LTEwLTE5KTogcGVkaWRvIE1hcmlhbm8gXHUyMDE0IGNhbWJpYXIgZGUgXCJzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTFcIiBhXG4gIC8vIFwibGlicmUgcGFyYSBsYSB2ZW50YVwiICg9IGRlcCAxMSBcdTIyMTIgcmVzZXJ2YXMgY29uZmlybWVkL0JPL0FTSUcvd2FpdGxpc3QpLlxuICAvLyBSYXpcdTAwRjNuOiBlbnZpYXIgYWwgY2xpZW50ZSBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBsZSBwdWVkZSBwcm9tZXRlciBIT1kuXG4gIC8vIFNpIHNvbG8gbW9zdHJhbW9zIHN0b2NrIGZcdTAwRURzaWNvLCBwdWVkZSBwYXNhciBxdWUgaGF5YSA1dSBwZXJvIGxhcyA1IGVzdFx1MDBFOW5cbiAgLy8gcmVzZXJ2YWRhcyBcdTIxOTIgZWwgY2xpZW50ZSBzZSBlbnRlcmEgcmVjaVx1MDBFOW4gYWwgaGFjZXIgZWwgcGVkaWRvIHF1ZSBubyBoYXkuXG4gIC8vIFVzYSBnZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgKHB1cmUgZnVuY3Rpb24sIGZpbHRyYSBUVExzKS4gUmV0b3JuYSAnJyBzaVxuICAvLyBubyBoYXkgc25hcHNob3QgY2FyZ2FkbzsgMCBzaSBubyBoYXkgbGlicmUuXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xuICAgIGNvbnN0IGZuUmVhbCA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGVcbiAgICAgICAgOiBudWxsO1xuICAgIGlmIChmblJlYWwpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHYgPSBmblJlYWwoc2t1KTtcbiAgICAgICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgICAgICByZXR1cm4gTnVtYmVyKHYpIHx8IDA7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvLyBmYWxsYmFjayBhIHN0b2NrIGZcdTAwRURzaWNvIGFiYWpvXG4gICAgICB9XG4gICAgfVxuICAgIC8vIEZhbGxiYWNrOiBzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTEgKHNpIGdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSBubyBlc3RcdTAwRTEgZGlzcG9uaWJsZSxcbiAgICAvLyBlai4gYm9vdHN0cmFwIG11eSB0ZW1wcmFubykuXG4gICAgY29uc3QgZm5GaXNpY28gPVxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxuICAgICAgICA6IG51bGw7XG4gICAgY29uc3QgdkYgPSBmbkZpc2ljbyA/IGZuRmlzaWNvKHNrdSkgOiBudWxsO1xuICAgIGlmICh2RiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcih2RikgfHwgMDtcbiAgfVxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xuICB9XG4gIC8vIHYxMzY0ICgyMDI2LTEwLTE5KTogcmV3b3JrIGRlbCBleHBvcnQgcG9yIHBlZGlkbyBNYXJpYW5vOlxuICAvLyAtIEhvamEgcHJpbmNpcGFsIHJlbm9tYnJhZGEgXCJQcmVjaW9zIHkgU3RvY2tcIiAtPiBcIkxpc3RhIGRlIHByZWNpb3NcIi5cbiAgLy8gLSBOdWV2YSBjb2x1bW5hIFwiRGlzcG9uaWJpbGlkYWRcIiAoRElTUE9OSUJMRSB2ZXJkZSBzaSBTdG9jaz4wLCBOTyBESVNQT05JQkxFXG4gIC8vICAgcm9qbyBzaSBTdG9jazw9MCBvIHZhY2lvKS5cbiAgLy8gLSBIb2phIFwiSW5mb1wiIGVsaW1pbmFkYS5cbiAgLy8gLSBOb21icmUgYXJjaGl2bzogUHJlY2lvc195X1N0b2NrX1lZWVktTU0tREQueGxzeCAtPiBMaXN0YV9kZV9QcmVjaW9zX1lZWVktTU0tREQueGxzeC5cbiAgLy8gSG9qYXMgXCJQcmVjaW9zXCIgeSBcIlN0b2NrXCIgc2UgbWFudGllbmVuIHBvciBzaSBNYXJpYW5vIGxhcyB1c2EuXG4gIGZ1bmN0aW9uIGRpc3BMYWJlbChzdG9ja1ZhbCkge1xuICAgIGlmIChzdG9ja1ZhbCA9PT0gJycgfHwgc3RvY2tWYWwgPT0gbnVsbCkgcmV0dXJuICdOTyBESVNQT05JQkxFJztcbiAgICByZXR1cm4gTnVtYmVyKHN0b2NrVmFsKSA+IDAgPyAnRElTUE9OSUJMRScgOiAnTk8gRElTUE9OSUJMRSc7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4ge1xuICAgIGNvbnN0IHN0ID0gZm10U3RvY2socC5jb2RlKTtcbiAgICByZXR1cm4ge1xuICAgICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXG4gICAgICBTdWJmYW1pbGlhOiBwLnN1YiB8fCAnJyxcbiAgICAgIENhdGVnb3JpYTogcC5jYXQgfHwgJycsXG4gICAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICAgICAgU3RvY2s6IHN0LFxuICAgICAgRGlzcG9uaWJpbGlkYWQ6IGRpc3BMYWJlbChzdCksXG4gICAgfTtcbiAgfSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3QgcHJlY2lvc1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICB9KSlcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxuICAgIC5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+IHtcbiAgICBjb25zdCBzdCA9IGZtdFN0b2NrKHAuY29kZSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAgIFN0b2NrOiBzdCxcbiAgICAgIERpc3BvbmliaWxpZGFkOiBkaXNwTGFiZWwoc3QpLFxuICAgIH07XG4gIH0pLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZG93bmxvYWRYbHN4KFxuICAgICdMaXN0YV9kZV9QcmVjaW9zXycgKyB0cyArICcueGxzeCcsXG4gICAgW1xuICAgICAgeyBuYW1lOiAnTGlzdGEgZGUgcHJlY2lvcycsIHJvd3MgfSxcbiAgICAgIHsgbmFtZTogJ1ByZWNpb3MnLCByb3dzOiBwcmVjaW9zUm93cyB9LFxuICAgICAgeyBuYW1lOiAnU3RvY2snLCByb3dzOiBzdG9ja1Jvd3MgfSxcbiAgICBdLFxuICAgIHtcbiAgICAgIC8vIFBhaW50ZXIgYXBsaWNhZG8gcG9zdC1yZW5kZXIgcG9yIGRvd25sb2FkWGxzeC4gUGludGEgbGEgY29sdW1uYVxuICAgICAgLy8gXCJEaXNwb25pYmlsaWRhZFwiIHNlZ3VuIHN1IHZhbG9yOiB2ZXJkZStibGFuY28gc2kgRElTUE9OSUJMRSxcbiAgICAgIC8vIHJvam8rYmxhbmNvIHNpIE5PIERJU1BPTklCTEUuIENlbnRyYWRvICsgYm9sZCBwYXJhIGxlZ2liaWxpZGFkLlxuICAgICAgY2VsbFN0eWxlcjogKGNlbGwsIGNvbHVtbk5hbWUsIF92YWx1ZSwgX3Jvd0luZGV4KSA9PiB7XG4gICAgICAgIGlmIChjb2x1bW5OYW1lICE9PSAnRGlzcG9uaWJpbGlkYWQnKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHR4dCA9IFN0cmluZyhjZWxsLnZhbHVlIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBpZiAodHh0ID09PSAnRElTUE9OSUJMRScpIHtcbiAgICAgICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYxNkEzNEEnIH0gfTsgLy8gZ3JlZW4tNjAwXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUgfTtcbiAgICAgICAgfSBlbHNlIGlmICh0eHQgPT09ICdOTyBESVNQT05JQkxFJykge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkRDMjYyNicgfSB9OyAvLyByZWQtNjAwXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUgfTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9XG4gICk7XG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKGxpc3RhIGRlIHByZWNpb3MgKyBkaXNwb25pYmlsaWRhZCknKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIC0gZGlhbG9nbyBkZSBzZWxlY2Npb24gKyAzIGZvcm1hdG9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBvcGNpb25lcyBzZWd1biByb2wuXG4gIC8vICAgdmVuZGVkb3I6IG9wZXJhdGl2byBkaWFyaW8gKFZlbnRhcyAvIFZpc2l0YXMgLyBSdXRhcykgKyBDbGllbnRlcyBkZSBzdSB6b25hXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxuICAvLyAgIGludGVybm8gKFZESSk6IG1pc21vIHNjb3BlIG9wZXJhdGl2byArIENsaWVudGVzIGRlIHN1cyBwYXJlamFzIChvIHNvbG8gZWxcbiAgLy8gICAgIHByb3BpbyBzaSBlbGlnaW8gc3Ugbm9tYnJlIGVuIGVsIGRyb3Bkb3duIGRlIHpvbmFzKS5cbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cbiAgY29uc3QgYWxsb3dlZEJ5Um9sZSA9IHtcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogVkVOVEFTIHkgUlVUQVMgZWxpbWluYWRvcyBkZWwgVUkgcG9yIHBlZGlkbyBkZSBNYXJpYW5vLlxuICAgIHZlbmRlZG9yOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gICAgaW50ZXJubzogbmV3IFNldChbJ1ZJU0lUQVMnLCAnTUFTVEVSJywgJ0JBQ0tPUkRFUicsICdTVE9DS19BU0lHJywgJ1BFRElET1NfTUVTJ10pLFxuICB9O1xuICBjb25zdCBhbGxvd2VkID0gYWxsb3dlZEJ5Um9sZVt1c2VyUm9sZV0gfHwgbnVsbDsgLy8gbnVsbCA9IHZlciB0b2RvXG4gIC8vIHYxNDEzIFx1MDBBNzUxICsgdjE0MTQgXHUwMEE3NTEuMSAoMjAyNi0xMC0yMik6IElORlJBQ0NJT05FU19NRUxJIHdoaXRlbGlzdCBwb3JcbiAgLy8gZW1haWwuIE1hbnRlbmVyIHNpbmNyb25pemFkbyBjb24gY2FuUmVhZEluZnJhY2Npb25lc01lbGkoKSBkZVxuICAvLyBmaXJlc3RvcmUucnVsZXMuIFJlYWRlcnM6IE1hcmlhbm8gKDIgZW1haWxzKSArIERpZWdvIFZhbHNpLlxuICBjb25zdCBJTkZSQUNDSU9ORVNfTUVMSV9SRUFERVJTID0gW1xuICAgICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbScsXG4gICAgJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJyxcbiAgICAnZGllZ28udmFsc2lAc2hpbWFuby51eScsXG4gIF07XG4gIGNvbnN0IF9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSA9XG4gICAgdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIGN1cnJlbnRVc2VyICYmXG4gICAgSU5GUkFDQ0lPTkVTX01FTElfUkVBREVSUy5pbmNsdWRlcygoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpO1xuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICBjb25zdCBraW5kID0gZWwuZGF0YXNldC5leHBLaW5kIHx8ICcnO1xuICAgIGxldCBzaG93ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCk7XG4gICAgaWYgKGtpbmQgPT09ICdJTkZSQUNDSU9ORVNfTUVMSScgJiYgIV9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSkgc2hvdyA9IGZhbHNlO1xuICAgIGVsLnN0eWxlLmRpc3BsYXkgPSBzaG93ID8gJycgOiAnbm9uZSc7XG4gIH0pO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTW9udGggcGlja2VyIHJldXRpbGl6YWJsZSBwYXJhIGxvcyA1IHRpcG9zIGRlIGV4cG9ydFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuY29uc3QgRVhQT1JUX1RZUEVfTEFCRUxTID0ge1xuICBWRU5UQVM6ICdWZW50YXMnLFxuICBWSVNJVEFTOiAnVmlzaXRhcycsXG4gIFJFTkRJQ0lPTkVTOiAnUmVuZGljaW9uZXMnLFxuICBSVVRBUzogJ1J1dGFzJyxcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXG4gIEJBQ0tPUkRFUjogJ0JhY2tvcmRlcicsXG4gIFNUT0NLX0FTSUc6ICdTdG9jayBBc2lnbmFkbycsXG4gIFBFRElET1NfTUVTOiAnUGVkaWRvcyBkZWwgbWVzJyxcbn07XG5cbndpbmRvdy5zaG93TW9udGhQaWNrZXIgPSBmdW5jdGlvbiAodGlwbykge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSB0aXBvO1xuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXN1YnQnKTtcbiAgdGl0bGUudGV4dENvbnRlbnQgPSAnRXhwb3J0YXIgJyArIChFWFBPUlRfVFlQRV9MQUJFTFNbdGlwb10gfHwgdGlwbyk7XG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcbiAgLy8gUG9wdWxhdGUgc2VsZWN0c1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XG4gIG1lc1NlbC5pbm5lckhUTUwgPVxuICAgICc8b3B0aW9uIHZhbHVlPVwiQUxMXCI+VG9kb3MgbG9zIG1lc2VzIChhXHUwMEYxbyBlbnRlcm8pPC9vcHRpb24+JyArXG4gICAgTUVTRVMubWFwKChtLCBpKSA9PiAnPG9wdGlvbiB2YWx1ZT1cIicgKyBpICsgJ1wiPicgKyBtICsgJzwvb3B0aW9uPicpLmpvaW4oJycpO1xuICBtZXNTZWwudmFsdWUgPSBub3cuZ2V0TW9udGgoKTtcbiAgY29uc3QgYW5pb1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJyk7XG4gIGNvbnN0IHllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcbiAgbGV0IHlvcHRzID0gJyc7XG4gIGZvciAobGV0IHkgPSB5ZWFyIC0gMzsgeSA8PSB5ZWFyICsgMTsgeSsrKVxuICAgIHlvcHRzICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIHkgKyAnXCI+JyArIHkgKyAnPC9vcHRpb24+JztcbiAgYW5pb1NlbC5pbm5lckhUTUwgPSB5b3B0cztcbiAgYW5pb1NlbC52YWx1ZSA9IHllYXI7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xuXG53aW5kb3cuY2xvc2VNb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xufTtcblxud2luZG93LmNvbmZpcm1Nb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xuICBjb25zdCBtZXNSYXcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJykudmFsdWU7XG4gIGNvbnN0IGFuaW8gPSBwYXJzZUludChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpLnZhbHVlLCAxMCk7XG4gIGNvbnN0IG1vbnRoSWR4ID0gbWVzUmF3ID09PSAnQUxMJyA/IG51bGwgOiBwYXJzZUludChtZXNSYXcsIDEwKTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuICBpZiAoIXRpcG8pIHJldHVybjtcbiAgdHJ5IHtcbiAgICBpZiAodGlwbyA9PT0gJ1ZFTlRBUycpIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JFTkRJQ0lPTkVTJykgZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JVVEFTJykgZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0FMVEFTJykgZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0JBQ0tPUkRFUicpIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnU1RPQ0tfQVNJRycpIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUEVESURPU19NRVMnKSBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWRU5UQVNfQVJUX0NMSScpIGV4cG9ydFZlbnRhc0FydENsaUZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGFsZXJ0KCdUaXBvIGRlc2Nvbm9jaWRvOiAnICsgdGlwbyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnQgJyArIHRpcG8sIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gU3RyaW5nKGFuaW8pO1xuICByZXR1cm4gTUVTRVNbbW9udGhJZHhdICsgJ18nICsgYW5pbztcbn1cblxuLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWVzY3JpdG8gY29uIEV4Y2VsSlMgcGFyYSBkYXIgVUkgdW5pZm9ybWUgYSBUT0RPUyBsb3Ncbi8vIGV4cG9ydHMgKGhlYWRlciB2ZXJkZSArIGNlbGRhcyBjZW50ZXJlZCArIGJvcmRlciBzdXRpbCArIGF1dG8tZml0IHdpZHRoKS5cbi8vIEFudGVzIHVzYWJhIFhMU1ggU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmEgc2lsZW50bHkgbG9zIGVzdGlsb3MgZGUgY2VsZGEuIEVsXG4vLyBwYXR0ZXJuIHZlcmRlIHJlcGxpY2EgZWwgVE9UQUwgYmFyIGRlIGV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsIChtb2RhbFxuLy8gQmFja29yZGVyIHY3MjArKS4gRXhjZWxKUyB5YSBzZSBjYXJnYSBvbi1kZW1hbmQgdmlhIHdpbmRvdy5sb2FkRXhjZWxKUy5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzLCBvcHRzKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgd2luZG93LmxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnTm8gc2UgcHVkbyBjYXJnYXIgRXhjZWxKUzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIGNvbnN0IEhFQURFUl9GSUxMID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMTY2NTM0JyB9IH07XG4gIGNvbnN0IEhFQURFUl9GT05UID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gIGNvbnN0IENFTlRFUiA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgY29uc3QgQk9SREVSX1RISU4gPSB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9O1xuICBjb25zdCBCT1JERVIgPSB7IHRvcDogQk9SREVSX1RISU4sIGxlZnQ6IEJPUkRFUl9USElOLCBib3R0b206IEJPUkRFUl9USElOLCByaWdodDogQk9SREVSX1RISU4gfTtcbiAgLy8gdjEzNjQ6IGNlbGxTdHlsZXIgb3BjaW9uYWwgcGFyYSBjb2xvcmVhciBjZWxkYXMgcG9yIHZhbG9yIChlai4gY29sdW1uYVxuICAvLyBEaXNwb25pYmlsaWRhZCBESVNQT05JQkxFIHZlcmRlIC8gTk8gRElTUE9OSUJMRSByb2pvIGVuIGVsIGV4cG9ydFxuICAvLyBMaXN0YSBkZSBwcmVjaW9zKS4gU2lnbmF0dXJlOiAoY2VsbCwgY29sdW1uTmFtZSwgdmFsdWUsIHJvd0luZGV4KSA9PiB2b2lkLlxuICBjb25zdCBjZWxsU3R5bGVyID0gb3B0cyAmJiB0eXBlb2Ygb3B0cy5jZWxsU3R5bGVyID09PSAnZnVuY3Rpb24nID8gb3B0cy5jZWxsU3R5bGVyIDogbnVsbDtcblxuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQocy5uYW1lLnNsaWNlKDAsIDMxKSk7XG4gICAgY29uc3Qgcm93cyA9IHMucm93cy5sZW5ndGggPyBzLnJvd3MgOiBbeyBBdmlzbzogJ1NpbiBkYXRvcyBwYXJhIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvJyB9XTtcbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmtleXMocm93c1swXSk7XG5cbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5hZGRSb3coaGVhZGVycyk7XG4gICAgaGVhZGVyUm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICBjZWxsLmZpbGwgPSBIRUFERVJfRklMTDtcbiAgICAgIGNlbGwuZm9udCA9IEhFQURFUl9GT05UO1xuICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICBjZWxsLmJvcmRlciA9IEJPUkRFUjtcbiAgICB9KTtcbiAgICBoZWFkZXJSb3cuaGVpZ2h0ID0gMjY7XG5cbiAgICBmb3IgKGxldCBySWR4ID0gMDsgcklkeCA8IHJvd3MubGVuZ3RoOyBySWR4KyspIHtcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3NbcklkeF07XG4gICAgICBjb25zdCB2YWx1ZXMgPSBoZWFkZXJzLm1hcCgoaCkgPT4gKHJvd1toXSAhPT0gdW5kZWZpbmVkICYmIHJvd1toXSAhPT0gbnVsbCA/IHJvd1toXSA6ICcnKSk7XG4gICAgICBjb25zdCBkYXRhUm93ID0gd3MuYWRkUm93KHZhbHVlcyk7XG4gICAgICBkYXRhUm93LmVhY2hDZWxsKChjZWxsLCBjb2xOdW1iZXIpID0+IHtcbiAgICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgICAgICBpZiAoY2VsbFN0eWxlcikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjZWxsU3R5bGVyKGNlbGwsIGhlYWRlcnNbY29sTnVtYmVyIC0gMV0sIHZhbHVlc1tjb2xOdW1iZXIgLSAxXSwgcklkeCk7XG4gICAgICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgICAgIC8vIG5vLW9wOiBubyByb21wZXIgZWwgZXhwb3J0IHBvciB1biBlcnJvciBkZSBzdHlsZXJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGhlYWRlcnMuZm9yRWFjaCgoaCwgaSkgPT4ge1xuICAgICAgbGV0IG1heExlbiA9IFN0cmluZyhoKS5sZW5ndGg7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHYgPSBTdHJpbmcocm93W2hdID09PSB1bmRlZmluZWQgfHwgcm93W2hdID09PSBudWxsID8gJycgOiByb3dbaF0pLnNwbGl0KCdcXG4nKVswXTtcbiAgICAgICAgaWYgKHYubGVuZ3RoID4gbWF4TGVuKSBtYXhMZW4gPSB2Lmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIHdzLmdldENvbHVtbihpICsgMSkud2lkdGggPSBNYXRoLm1pbig2MCwgTWF0aC5tYXgoMTAsIG1heExlbiArIDQpKTtcbiAgICB9KTtcblxuICAgIHdzLnZpZXdzID0gW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV07XG4gIH1cblxuICBjb25zdCBidWYgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gIH0pO1xuICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICBhLmhyZWYgPSB1cmw7XG4gIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgYS5jbGljaygpO1xuICBhLnJlbW92ZSgpO1xuICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldE1lcyA9IG1vbnRoSWR4ICE9PSBudWxsID8gTUVTRVNbbW9udGhJZHhdLnRvVXBwZXJDYXNlKCkgOiBudWxsO1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xuICAgIGl0ZW1zLnB1c2godik7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMgeSBDb250YWN0b3MnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnQW5pbycsIGtleTogJ2FuaW8nLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnSW50ZXJhY2Npb24nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnRm9ybWEgQ29udGFjdG8nLCBrZXk6ICdmb3JtYUNvbnRhY3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdSZXN1bHRhZG8gQ29udGFjdG8nLCBrZXk6ICdyZXN1bHRhZG9DdCcsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnUHJvdmluY2lhJywga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRmlkZWxpZGFkJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdOZWNlc2lkYWQgUHVudHVhbCcsIGtleTogJ25lYycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBWZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBQcmVndW50YW4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnQXl1ZGEgVGllbmRhJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gVmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgTW9zdHJhZG9yJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywga2V5OiAncEVjb20nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBTdGF0dXMnLCBrZXk6ICdncHNTdCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnR1BTIERpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFbiBub21icmUgZGUgVkRFJywga2V5OiAnb25CZWhhbGYnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NhcmdhZG8gUG9yJywga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcbiAgY29uc3QgUk9XX0ggPSAxMDA7XG4gIGNvbnN0IElNR19XID0gMTMwO1xuICBjb25zdCBJTUdfSCA9IDkwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XG4gICAgaWYgKGlzQ29udGFjdG8pIHtcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcbiAgICB9XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcbiAgICAgIGFuaW86IHYuYW5pbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcbiAgICAgIGZvcm1hQ29udGFjdG86IGZvcm1hQ29udGFjdG9MYmwsXG4gICAgICByZXN1bHRhZG9DdDogcmVzdWx0YWRvQ3RMYmwsXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgbmVjOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxuICAgICAgZ3BzU3Q6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdi5ncHNEaXN0YW5jZU0gIT0gbnVsbCA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXG4gICAgICBvbkJlaGFsZjogdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICBjcmVhdGVkQnk6IHYuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgdi5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdDb25jZXB0bycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdOIFRpY2tldCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnTW9kbyBwYWdvJywga2V5OiAnbW9kb1BhZ28nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gZ2FzdG8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0RpdmlzaW9uJywga2V5OiAnZGl2aXNpb24nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNb25lZGEnLCBrZXk6ICdtb25lZGEnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUgVVNEJywga2V5OiAnaW1wb3J0ZVVzZCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byB0aWNrZXQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFc3RhZG8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvcicsIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG8gZW4nLCBrZXk6ICdhcHJvYmFkb0VuJywgd2lkdGg6IDE0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcbiAgY29uc3QgUk9XX0ggPSAxMTA7XG4gIGNvbnN0IElNR19XID0gMTQwO1xuICBjb25zdCBJTUdfSCA9IDEwMDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgciA9IGl0LnI7XG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XG4gICAgY29uc3Qgb2JzU3RyID1cbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBlbWFpbDogci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxuICAgICAgbW9kb1BhZ286IHIubW9kb1BhZ28gfHwgJycsXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxuICAgICAgZGl2aXNpb246IHIuZGl2aXNpb25HYXN0byB8fCAnJyxcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXG4gICAgICBtb25lZGE6IHIubW9uZWRhIHx8ICdQRVNPUycsXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcbiAgICAgIG9iczogb2JzU3RyLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcbiAgICAgIGFwcm9iYWRvcjogci5hcHByb3ZlckVtYWlsIHx8IHIuYXByb2JhZG9yIHx8ICcnLFxuICAgICAgYXByb2JhZG9FbjpcbiAgICAgICAgci5hcHByb3ZlZEF0ICYmIHIuYXBwcm92ZWRBdC50b0RhdGUgPyByLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBTSUVNUFJFIGVtYmViZXIgbGEgZm90byAobm8gZGVqYXIgaHlwZXJsaW5rKS5cbiAgICAvLyBBbnRlczogc2kgZm90b1RpY2tldFVybCAoU3RvcmFnZSksIHF1ZWRhYmEgY29tbyBoeXBlcmxpbmsgQWJyaXIgdGlja2V0LlxuICAgIC8vIEFob3JhOiBmZXRjaCBkZWwgVVJMICsgY29udmVydGlyIGEgYXJyYXlCdWZmZXIgKyBlbWJlYmVyIGlndWFsIHF1ZSBkYXRhVVJMLlxuICAgIC8vIEZhbGxiYWNrIGEgaHlwZXJsaW5rIHNvbG8gc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCwgZXRjKS5cbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBmZXRjaCBsYSBmb3RvIGRlc2RlIFN0b3JhZ2UgeSBlbWJlYmVybGEgY29tbyBpbWFnZW4uXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2goci5mb3RvVGlja2V0VXJsKTtcbiAgICAgICAgaWYgKCFyZXNwLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHJlc3Auc3RhdHVzKTtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwLmhlYWRlcnMuZ2V0KCdjb250ZW50LXR5cGUnKSB8fCAnaW1hZ2UvanBlZyc7XG4gICAgICAgIGxldCBleHQgPSBjb250ZW50VHlwZS5zcGxpdCgnLycpWzFdIHx8ICdqcGVnJztcbiAgICAgICAgZXh0ID0gZXh0LnNwbGl0KCc7JylbMF0udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHJlc3AuYXJyYXlCdWZmZXIoKTtcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYnVmZmVyOiBidWYsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBGYWxsYmFjazogc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCksIGRlamFyIGh5cGVybGluayBjb21vIGFudGVzLlxuICAgICAgICBjb25zb2xlLndhcm4oJ2ZldGNoIGZvdG8gcmVuZGljaW9uIGZhbGxvLCBkZWpvIGh5cGVybGluaycsIGl0LmlkLCBlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XG4gICAgICAgICAgY2VsbC52YWx1ZSA9IHtcbiAgICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxuICAgICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXG4gICAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXIgKGZldGNoIGZhbGxvKScsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XG4gICAgICAgIH0gY2F0Y2ggKF9lMikge31cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUlVUQVM6IHJ1dGFzIGFzaWduYWRhcyBkZWwgcGVyaW9kbyArIG92ZXJyaWRlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPVxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXG4gICAgICA6IGFzc2lnbmVkVmVuZG9yXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxuICAgICAgICA6IFtdO1xuICBjb25zdCBtb250aHNUb0V4cG9ydCA9IG1vbnRoSWR4ICE9PSBudWxsID8gW21vbnRoSWR4XSA6IFswLCAxLCAyLCAzLCA0LCA1LCA2LCA3LCA4LCA5LCAxMCwgMTFdO1xuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2YgbW9udGhzVG9FeHBvcnQpIHtcbiAgICAgIGxldCBydXRhcztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgcnV0YXMgPSBbXTtcbiAgICAgIH1cbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPdmVycmlkZXNcbiAgbGV0IG92clNuYXA7XG4gIHRyeSB7XG4gICAgb3ZyU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm91dGVfb3ZlcnJpZGVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgb3ZyU25hcCA9IG51bGw7XG4gIH1cbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xuICBpZiAob3ZyU25hcCkge1xuICAgIG92clNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxuICAgICAgICBNZXM6IE1FU0VTW3BhcnNlSW50KG8ubW9udGhJZHgsIDEwKV0gfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBvLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcbiAgICAgICAgRGVyaXZhZGFfQTogby5kZXJpdmFkYUEgfHwgJycsXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX1Bvcjogby5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX0VuOlxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1J1dGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcbiAgICB7IG5hbWU6ICdEZXJpdmFjaW9uZXMtUmVhZ2VuZGFzJywgcm93czogb3ZlcnJpZGVzUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBSdXRhcyBsaXN0byAoJyArIHJ1dGFzUm93cy5sZW5ndGggKyAnIHRpZW5kYXMsICcgKyBvdmVycmlkZXNSb3dzLmxlbmd0aCArICcgb3ZlcnJpZGVzKScsXG4gICAgMjQwMFxuICApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFMVEFTOiBzb2xpY2l0dWRlcyBkZSBhbHRhIGRlIGNsaWVudGUgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSAnJztcbiAgICBpZiAoYS5jcmVhdGVkQXQgJiYgYS5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXG4gICAgICBBcHJvYmFkb19FbjpcbiAgICAgICAgYS5hcHByb3ZlZEF0ICYmIGEuYXBwcm92ZWRBdC50b0RhdGUgPyBhLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEFsdGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIHNvbGljaXR1ZGVzKScsIDI0MDApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHY3MDkgKDIwMjYtMDgtMjgpOiAzIGV4cG9ydHMgbnVldm9zIHBlZGlkb3MgcG9yIE1hcmlhbm8uXG4vLyAtIEJBQ0tPUkRFUjogbGluZWFzIHN0YXRlPUJPIG9wZW4gcG9yIG1lcyBkZSBjcmVhdGVkQXQgZGVsIHBlZGlkby5cbi8vIC0gU1RPQ0tfQVNJRzogbGluZWFzIEFTSUcgb3BlbiAobyBCTytzdG9jayBkaXNwKSBwb3IgbWVzIGRlIGNyZWF0ZWRBdC5cbi8vIC0gUEVESURPU19NRVM6IFRPRE9TIGxvcyBwZWRpZG9zIGNyZWFkb3MgZW4gZWwgbWVzL2FuaW8gKGN1YWxxdWllciBzdGFnZSkuXG4vLyBGdWVudGU6IGdsb2JhbFBlZGlkb3MgKGxvIHF1ZSBsYSBhcHAgeWEgdGllbmUgZW4gbWVtb3JpYSkuXG4vLyBGaWx0ZXIgbWVzL2FcdTAwRjFvOiBzb2JyZSBjcmVhdGVkQXQgZGVsIHBlZGlkby4gbW9udGhJZHg9bnVsbCAtPiBhXHUwMEYxbyBlbnRlcm8uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmZ1bmN0aW9uIF9wZWRpZG9Nb250aFllYXIocCkge1xuICBjb25zdCBjYSA9IHAuY3JlYXRlZEF0O1xuICBpZiAoIWNhKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIGxldCBkdCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY2EgPT09ICdzdHJpbmcnKSBkdCA9IG5ldyBEYXRlKGNhKTtcbiAgZWxzZSBpZiAodHlwZW9mIGNhLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICBkdCA9IGNhLnRvRGF0ZSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGVsc2UgaWYgKHR5cGVvZiBjYSA9PT0gJ251bWJlcicpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBpZiAoIWR0IHx8IE51bWJlci5pc05hTihkdC5nZXRUaW1lKCkpKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIHJldHVybiB7IHk6IGR0LmdldEZ1bGxZZWFyKCksIG06IGR0LmdldE1vbnRoKCkgfTtcbn1cblxuZnVuY3Rpb24gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGNvbnN0IGFyciA9XG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gIHJldHVybiBhcnIuZmlsdGVyKChwKSA9PiB7XG4gICAgaWYgKCFwKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgeyB5LCBtIH0gPSBfcGVkaWRvTW9udGhZZWFyKHApO1xuICAgIGlmICh5ID09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoeSAhPT0gYW5pbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBtICE9PSBtb250aElkeCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyLi4uJyk7XG4gIC8vIHYxMTAwOiBkZWxlZ2EgYWwgbVx1MDBGM2R1bG8gcHVyby4gRmlsdHJhIHBvciBtZXMgdlx1MDBFRGEgZmlsdGVycy5tZXNZWVlZTU1cbiAgLy8gKHF1ZSBlbCBtXHUwMEYzZHVsbyBhcGxpY2Egc29icmUgY29uZmlybWVkQXQpLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgbWVzWVlZWU1NID0gYW5pbyArICctJyArIFN0cmluZyhtb250aElkeCArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxuICAvLyBub3JtYWxpemFjaVx1MDBGM24gZGUgc3RyaW5ncykgeSBzXHUwMEYzbG8gY2FlciBhbCBjbGllbnRMb2NJZCBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc28uXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xuICAgICAgICBjYWNoZS5mb3JFYWNoKChjbURhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGNtRGF0YS5hc3NpZ25lZFZlbmRvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgICAgfVxuICAgICAgcmV0dXJuICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBwZWRpZG9zLFxuICAgICAgICAndXJnZW50ZScsXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHFvID0gYy5xdHlCYWNrb3JkZXIgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBjYW50aWRhZFBlZGlkYSA9IHFvO1xuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkge1xuICAgICAgICBjYW50aWRhZFBlZGlkYSA9IE51bWJlcihwLmxpbmVzW2lkeF0ucXR5KSB8fCBxbztcbiAgICAgICAgbGluZWFJZHggPSBpZHg7XG4gICAgICB9XG4gICAgfVxuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1BlZGlkYTogY2FudGlkYWRQZWRpZGEsXG4gICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKGMucHJlY2lvIHx8IDApKSxcbiAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXG4gICAgICBTUV9Eb2NOdW06IGMuc3FEb2NOdW0gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkby4uLicpO1xuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8gbW9kbyBhc2lnbmFjaW9uLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgbWVzWVlZWU1NID0gYW5pbyArICctJyArIFN0cmluZyhtb250aElkeCArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxuICAvLyBub3JtYWxpemFjaVx1MDBGM24gZGUgc3RyaW5ncykgeSBzXHUwMEYzbG8gY2FlciBhbCBjbGllbnRMb2NJZCBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc28uXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xuICAgICAgICBjYWNoZS5mb3JFYWNoKChjbURhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGNtRGF0YS5hc3NpZ25lZFZlbmRvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgICAgfVxuICAgICAgcmV0dXJuICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBwZWRpZG9zLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbi8vIHY3MzcgKDIwMjYtMDgtMzApOiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kb3MgbG9zIGJhY2tvcmRlcnMgb3BlbiAoc2luIGZpbHRyb1xuLy8gZGUgbWVzKS4gTW90aXZvOiBsb3MgNjIgcGVkaWRvcyBtaWdyYWRvcyBkZXNkZSBTQVAgZWwgMjAyNi0wOC0yOCB0aWVuZW5cbi8vIGNyZWF0ZWRBdCBkZSBmZWNoYXMgdmllamFzIGRlbCBTQVAgU1Egb3JpZ2luYWwsIGVudG9uY2VzIGVsIGV4cG9ydCBwb3IgbWVzXG4vLyBubyBsb3MgaW5jbHVpYS4gVmVyc2lvbiBcImN1cnJlbnQgc3RhdHVzXCIgcXVlIGl0ZXJhIGdsb2JhbFBlZGlkb3MgY29tcGxldG8uXG53aW5kb3cuZXhwb3J0QmFja29yZGVyQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIgKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjE0ODggXHUwMEE3ODYgKDIwMjYtMTAtMjcgQlVHIEZJWCk6IHVzYXIgbGEgTUlTTUEgcHVyZSBmbiBxdWUgZWwgbW9kYWwgZXhwb3J0XG4gIC8vIChgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3NgKS4gQW50ZXMgdjE0ODg6IHBhbmVsIHVzYWJhXG4gIC8vIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXMoe30pYCBzaW4gYGluY2x1ZGVFeHBpcmVkYCBcdTIxOTIgb2N1bHRhYmEgQk9zID4gOTBkLlxuICAvLyBNb2RhbCB1c2FiYSBgY29tcHV0ZUJhY2tvcmRlclNrdU1hcCguLi4sIHtpbmNsdWRlRXhwaXJlZDp0cnVlfSlgIFx1MjE5MiBsb3NcbiAgLy8gaW5jbHVcdTAwRURhLiBEZWx0YSBtZWRpZG8gZW4gcHJvZDogMjIyIHVuaWRhZGVzIChtb2RhbCA3Njk2IHZzIHBhbmVsIDc0NzQpLlxuICAvLyBGaXg6IHB1cmUgZm4gXHUwMEZBbmljYSBjb24gZGVmYXVsdCBgaW5jbHVkZUV4cGlyZWQ9dHJ1ZWAgKGFsaW5lYWRvIGNvbiBcdTAwQTc0MC4xXG4gIC8vIHkgZ2V0U3RvY2tCcmVha2Rvd24uYmFja29yZGVyQXBwLnRvdGFsIFx1MjAxNCBsYSBjb2xhIGNvbXBsZXRhKS5cbiAgY29uc3QgYXJyID1cbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgY29uc3QgdG90YWxQZWRpZG9zT3BlbiA9IGFyci5maWx0ZXIoKHApID0+IHAgJiYgIXAuY2xvc2VkQXQpLmxlbmd0aDtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgIT09ICdmdW5jdGlvbicgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICBjb25zdCBjbURhdGEgPSB3LmNsaWVudE1hc3RlckNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogcHVyZSBmbiBcdTAwRkFuaWNhIGBjb21wdXRlQmFja29yZGVyRXhwb3J0Um93c2AgKHJlZW1wbGF6YSBlbFxuICAvLyBwYXRoIGhpc3RcdTAwRjNyaWNvIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXNgIHF1ZSBubyBjb25zb2xpZGFiYSB5IHBlcmRcdTAwRURhXG4gIC8vIEJPcyA+IDkwZCkuIFBhbmVsIHBhc2EgYHt9YCBcdTIxOTIgdHJhZSB0b2RhIGxhIGNvbGEgc2luIGZpbHRyb3MgbWFudWFsZXMuXG4gIGNvbnN0IF9leHBvcnRGbiA9XG4gICAgdy5fX3BoYXNlMCAmJlxuICAgIHcuX19waGFzZTAucHVyZSAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0LmNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzO1xuICBjb25zdCBkZXBzID0ge1xuICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICBjYW5vblZlbmRvcjpcbiAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9leHBvcnRSZXN1bHQgPSBfZXhwb3J0Rm5cbiAgICA/IF9leHBvcnRGbihhcnIsIHt9LCBkZXBzKVxuICAgIDogeyByb3dzOiBbXSwgdG90YWxVbmlkYWRlczogMCwgdG90YWxGaWxhczogMCwgZmlsdHJvc0FwbGljYWRvczoge30gfTtcbiAgY29uc3Qgcm93cyA9IF9leHBvcnRSZXN1bHQucm93cztcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoXG4gICAgICAnRXhwb3J0IEJhY2tvcmRlciB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlCYWNrb3JkZXI+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IGJhY2tvcmRlciBhYmllcnRvIGFob3JhIG1pc21vICh0b2RvIGNvbmZpcm1lZCwgY2VycmFkbyBvIHZlbmNpZG8pXFxuJyArXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcbiAgICAgICAgJzMuIFRvZGFzIGxhcyBsaW5lYXMgQk8gdGllbmVuIHN0b2NrIGRpc3BvbmlibGUgKGZ1ZXJvbiBwcm9tb3ZpZGFzIGEgQVNJRyB2aXJ0dWFsKSdcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICAvLyB2MTM2NiAoMjAyNi0xMC0xOSk6IGhvamEgXCJSZXN1bWVuXCIgY29uIGxvcyBNSVNNT1MgdG90YWxlcyBxdWUgZWwgbW9kYWxcbiAgLy8gQmFja29yZGVyIChjb21wdXRlQmFja29yZGVyU2t1TWFwIHBvc3QtY29uc29saWRhY2lvbiBwb3IgY2xpZW50ZSkuIEFudGVzXG4gIC8vIGVsIGV4cG9ydCBkdW1wZWFiYSBsaW5lYXMgY3J1ZGFzIHNpbiBuaW5ndW4gdG90YWwgXHUyMTkyIE1hcmlhbm8gc3VtYWJhIGxhXG4gIC8vIGNvbHVtbmEgU3VidG90YWxfQk9fQVJTIHkgZWwgdmFsb3IgcG9kaWEgZGl2ZXJnZXIgZGVsIG1vZGFsIGN1YW5kbyB1blxuICAvLyBjbGllbnRlIHRlbmlhIHZhcmlhcyBsaW5lYXMgQk8gZGVsIG1pc21vIFNLVSBjb24gcHJlY2lvcyBkaXN0aW50b3MgKGVsXG4gIC8vIG1vZGFsIGNvbnNvbGlkYSB1c2FuZG8gZWwgcHJlY2lvIGRlIGxhIDFyYSBsaW5lYSBwcm9jZXNhZGE7IGVsIGV4cG9ydFxuICAvLyB1c2EgZWwgcHJlY2lvIGRlIGNhZGEgbGluZWEgaW5kaXZpZHVhbCkuXG4gIGNvbnN0IF9jb21wdXRlU2t1TWFwRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclNrdU1hcDtcbiAgY29uc3QgX21vZGFsRGVwcyA9IHtcbiAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgY2Fub25WZW5kb3I6XG4gICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgYmFja29yZGVyTGluZXM6IEFycmF5LmlzQXJyYXkody5iYWNrb3JkZXJMaW5lcykgPyB3LmJhY2tvcmRlckxpbmVzIDogW10sXG4gICAgc2FwR2V0Q2xpZW50ZUNvZGU6IHR5cGVvZiB3LnNhcEdldENsaWVudGVDb2RlID09PSAnZnVuY3Rpb24nID8gdy5zYXBHZXRDbGllbnRlQ29kZSA6IHVuZGVmaW5lZCxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9tb2RhbEZpbHRlcnMgPSB7XG4gICAgdGllbmRhUXVlcnk6ICcnLFxuICAgIHZlbmRvcktleTogJycsXG4gICAgbWVzWVlZWU1NOiAnJyxcbiAgICB1cmdlbmN5RmlsdGVyOiAnJyxcbiAgICBpbmNsdWRlRXhwaXJlZDogdHJ1ZSxcbiAgICBhZ2dyZWdhdGlvbk1vZGU6ICdmaWZvJyxcbiAgfTtcbiAgY29uc3QgX21vZGFsUmVzdWx0ID0gX2NvbXB1dGVTa3VNYXBGblxuICAgID8gX2NvbXB1dGVTa3VNYXBGbihhcnIsICd1cmdlbnRlJywgX21vZGFsRmlsdGVycywgX21vZGFsRGVwcylcbiAgICA6IHsgc2t1czogW10sIHRvdGFsVW5pZGFkZXM6IDAsIHRvdGFsQ2xpZW50ZXM6IDAgfTtcbiAgbGV0IHRvdGFsUGVzb3NNb2RhbCA9IDA7XG4gIGNvbnN0IHN1YnRvdGFsZXNQb3JVcmdlbmN5ID0geyB1cmdlbnRlOiAwLCBwYXJjaWFsOiAwIH07XG4gIGZvciAoY29uc3QgZyBvZiBfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkge1xuICAgIGNvbnN0IHVyZyA9IGcudXJnZW5jeSB8fCAndXJnZW50ZSc7XG4gICAgZm9yIChjb25zdCBjIG9mIGcuY2xpZW50ZXMgfHwgW10pIHtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihjLnF0eUJhY2tvcmRlcikgfHwgMDtcbiAgICAgIGlmIChxdHkgPD0gMCkgY29udGludWU7XG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIoYy5wcmVjaW8pIHx8IDA7XG4gICAgICBjb25zdCBzdWIgPSBxdHkgKiBwcmVjaW87XG4gICAgICB0b3RhbFBlc29zTW9kYWwgKz0gc3ViO1xuICAgICAgaWYgKHVyZyA9PT0gJ3BhcmNpYWwnKSBzdWJ0b3RhbGVzUG9yVXJnZW5jeS5wYXJjaWFsICs9IHN1YjtcbiAgICAgIGVsc2Ugc3VidG90YWxlc1BvclVyZ2VuY3kudXJnZW50ZSArPSBzdWI7XG4gICAgfVxuICB9XG4gIGNvbnN0IHRvdGFsVW5pZGFkZXNNb2RhbCA9IF9leHBvcnRSZXN1bHQudG90YWxVbmlkYWRlcyB8fCBfbW9kYWxSZXN1bHQudG90YWxVbmlkYWRlcyB8fCAwO1xuICBjb25zdCB0b3RhbENsaWVudGVzTW9kYWwgPSBfbW9kYWxSZXN1bHQudG90YWxDbGllbnRlcyB8fCAwO1xuICBjb25zdCB0b3RhbFNrdXNNb2RhbCA9IChfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkubGVuZ3RoO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogZmlsYSBkZSBlbmNhYmV6YWRvIFwiRmlsdHJvcyBhcGxpY2Fkb3NcIiBwYXJhIHRyYW5zcGFyZW5jaWEuXG4gIGNvbnN0IF9mbXRGaWx0cm9zID1cbiAgICB3Ll9fcGhhc2UwICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydCAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQuZm9ybWF0QmFja29yZGVyRmlsdHJvc0hlYWRlcjtcbiAgY29uc3QgZmlsdHJvc0xibCA9IF9mbXRGaWx0cm9zID8gX2ZtdEZpbHRyb3MoX2V4cG9ydFJlc3VsdC5maWx0cm9zQXBsaWNhZG9zKSA6ICdGaWx0cm9zOiBuaW5ndW5vJztcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXG4gICAgeyBNZXRyaWNhOiBmaWx0cm9zTGJsLCBWYWxvcjogJycgfSxcbiAgICB7IE1ldHJpY2E6ICdUT1RBTCBCYWNrb3JkZXIgQVJTJywgVmFsb3I6IE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1NLVXMgY29uIGJhY2tvcmRlcicsIFZhbG9yOiB0b3RhbFNrdXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1VuaWRhZGVzIHBlbmRpZW50ZXMnLCBWYWxvcjogTWF0aC5yb3VuZCh0b3RhbFVuaWRhZGVzTW9kYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnUGFyZXMgY2xpZW50ZStTS1UgKGZpbGFzIGVuIGhvamEgQmFja29yZGVyKScsIFZhbG9yOiByb3dzLmxlbmd0aCB9LFxuICAgIHsgTWV0cmljYTogJ0NsaWVudGVzIGFmZWN0YWRvcycsIFZhbG9yOiB0b3RhbENsaWVudGVzTW9kYWwgfSxcbiAgICB7IE1ldHJpY2E6ICdcdTIwMTQgU3VidG90YWwgU0lOIFJFUE9TSUNJT04nLCBWYWxvcjogTWF0aC5yb3VuZChzdWJ0b3RhbGVzUG9yVXJnZW5jeS51cmdlbnRlKSB9LFxuICAgIHsgTWV0cmljYTogJ1x1MjAxNCBTdWJ0b3RhbCBQQVJDSUFMJywgVmFsb3I6IE1hdGgucm91bmQoc3VidG90YWxlc1BvclVyZ2VuY3kucGFyY2lhbCkgfSxcbiAgICB7IE1ldHJpY2E6ICdTbmFwc2hvdCBnZW5lcmFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXG4gIF07XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBmaWxhIFRPVEFMIGFsaW5lYWRhIGNvbiBlbCBudWV2byBzaGFwZSAoc2luIGNvbHVtbmFzIGxlZ2FjeVxuICAvLyBGZWNoYV9QZWRpZG8gLyBNZXMgLyBDYW50aWRhZF9QZWRpZGEgLyBQZWRpZG9fSUQgLyBMaW5lYV9JZHggLyBldGMuKS5cbiAgLy8gTGFzIG51ZXZhcyBjb2x1bW5hcyAoZGUgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3MpOiBTS1UsIFByb2R1Y3RvLFxuICAvLyBDbGllbnRlLCBDYXJkQ29kZSwgUHJvdmluY2lhLCBMb2NhbGlkYWQsIFZlbmRlZG9yLCBDYW50aWRhZF9QZW5kaWVudGVfQk8sXG4gIC8vIFByZWNpb19Vbml0X0FSUywgU3VidG90YWxfQk9fQVJTLCBFZGFkX0JPX2RpYXMsIEVzdGFkbywgUGVkaWRvcy5cbiAgY29uc3QgdG90YWxSb3cgPSB7XG4gICAgU0tVOiAnJyxcbiAgICBQcm9kdWN0bzogJycsXG4gICAgQ2xpZW50ZTogJ1RPVEFMJyxcbiAgICBDYXJkQ29kZTogJycsXG4gICAgUHJvdmluY2lhOiAnJyxcbiAgICBMb2NhbGlkYWQ6ICcnLFxuICAgIFZlbmRlZG9yOiAnJyxcbiAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IE1hdGgucm91bmQodG90YWxVbmlkYWRlc01vZGFsKSxcbiAgICBQcmVjaW9fVW5pdF9BUlM6ICcnLFxuICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpLFxuICAgIEVkYWRfQk9fZGlhczogJycsXG4gICAgRXN0YWRvOiAnJyxcbiAgICBQZWRpZG9zOiAnJyxcbiAgfTtcbiAgcm93cy5wdXNoKHRvdGFsUm93KTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl9TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goXG4gICAgZm5hbWUsXG4gICAgW1xuICAgICAgeyBuYW1lOiAnUmVzdW1lbicsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgICB7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH0sXG4gICAgXSxcbiAgICB7XG4gICAgICAvLyBQaW50YXIgbGEgZmlsYSBUT1RBTCBkZSBsYSBob2phIEJhY2tvcmRlciArIGZpbGEgMSAoVE9UQUwpIGRlIFJlc3VtZW4uXG4gICAgICBjZWxsU3R5bGVyOiAoY2VsbCwgY29sdW1uTmFtZSwgX3ZhbHVlLCByb3dJbmRleCkgPT4ge1xuICAgICAgICAvLyBIb2phIFJlc3VtZW46IGZpbGEgVE9UQUwgPSByb3dJbmRleCAwIChwcmltZXJhIGRhdGEgcm93IHBvc3QgaGVhZGVyKS5cbiAgICAgICAgLy8gSG9qYSBCYWNrb3JkZXI6IGZpbGEgVE9UQUwgPSB1bHRpbWEgcm93IChyb3dJbmRleCA9PT0gcm93cy5sZW5ndGggLSAxKS5cbiAgICAgICAgLy8gTm8gdGVuZW1vcyBhY2Nlc28gYWwgbm9tYnJlIGRlIGxhIGhvamEgZW4gZWwgc3R5bGVyLCBwZXJvIHBpbnRhbW9zXG4gICAgICAgIC8vIHBvciBjZWxkYTogc2kgY29sdW1uTmFtZT09J01ldHJpY2EnIHkgZXMgJ1RPVEFMIEJhY2tvcmRlciBBUlMuLi4nLFxuICAgICAgICAvLyBvIHNpIGNvbHVtbk5hbWU9PSdDbGllbnRlJyB5IGVsIHZhbG9yIGluY2x1eWUgJ1RPVEFMJy5cbiAgICAgICAgY29uc3QgdHh0ID0gU3RyaW5nKGNlbGwudmFsdWUgfHwgJycpO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgKGNvbHVtbk5hbWUgPT09ICdNZXRyaWNhJyAmJiB0eHQuaW5jbHVkZXMoJ1RPVEFMIEJhY2tvcmRlcicpKSB8fFxuICAgICAgICAgIChjb2x1bW5OYW1lID09PSAnQ2xpZW50ZScgJiYgdHh0LmluY2x1ZGVzKCdUT1RBTCcpKVxuICAgICAgICApIHtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjk5MUIxQicgfSB9OyAvLyByZWQtODAwXG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2VsZGFzIGRlIGxhIE1JU01BIEZJTEEgVE9UQUwgKGxvcyBudW1lcm9zKVxuICAgICAgICBpZiAocm93SW5kZXggPT09IDAgJiYgY29sdW1uTmFtZSA9PT0gJ1ZhbG9yJykge1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH1cbiAgKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgK1xuICAgICAgKHJvd3MubGVuZ3RoIC0gMSkgK1xuICAgICAgJyBsaW5lYXMgKyBSZXN1bWVuIGNvbiB0b3RhbCAkJyArXG4gICAgICBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgJyknLFxuICAgIDMwMDBcbiAgKTtcbn07XG5cbi8vIHYxNDkyIFx1MDBBNzkxICgyMDI2LTEwLTI3KTogZXhwb3J0IGRlbCBtXHUwMEYzZHVsbyBcIlJlcGFydG8gZGUgaW5ncmVzb3NcIi4gQm90XHUwMEYzbiBlblxuLy8gZWwgaGVhZGVyIGRlbCBtb2RhbC4gRnVlbnRlOiBgd2luZG93Ll9yZXBhcnRvSW5ncmVzb3NgIChhcnJheSBpbmxpbmUgcG9ibGFkb1xuLy8gcG9yIGBfcmVwYXJ0b1N1YnNjcmliZWAgZGVzZGUgYGluZ3Jlc29zX3JlcGFydG8ud2hlcmUoc3RhdHVzIGluIFtwZW5kaW5nLFxuLy8gaW5fcHJvZ3Jlc3NdKWApLiBEb3MgaG9qYXM6IFJlc3VtZW4gKHVuYSBmaWxhIHBvciBpbmdyZXNvKSB5IERldGFsbGUgKHVuYVxuLy8gZmlsYSBwb3IgY2xpZW50ZSBkZW50cm8gZGUgY2FkYSBpbmdyZXNvKS4gQ29sdW1uYXMgYWxpbmVhZGFzIGNvbiBlbCBtb2RhbC5cbndpbmRvdy5leHBvcnRSZXBhcnRvVG9FeGNlbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgY29uc3QgaW5ncmVzb3MgPSBBcnJheS5pc0FycmF5KHcuX3JlcGFydG9JbmdyZXNvcykgPyB3Ll9yZXBhcnRvSW5ncmVzb3MgOiBbXTtcbiAgaWYgKCFpbmdyZXNvcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGluZ3Jlc29zIGRlIHJlcGFydG8gcGFyYSBleHBvcnRhci4gQWJyXHUwMEVEIGVsIG1vZGFsIFwiUmVwYXJ0byBkZSBpbmdyZXNvc1wiIHByaW1lcm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IFJlcGFydG9cdTIwMjYnKTtcblxuICBjb25zdCBfZ2V0U3RvY2sgPVxuICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6IG51bGw7XG4gIC8qKiBAcGFyYW0ge2FueX0gaW5nICovXG4gIGNvbnN0IF9zdG9ja0Zpc2ljbyA9IChpbmcpID0+IHtcbiAgICBpZiAoIWluZyB8fCAhaW5nLnNrdSkgcmV0dXJuIDA7XG4gICAgaWYgKCFfZ2V0U3RvY2spIHJldHVybiBOdW1iZXIoaW5nLnF0eUluZ3Jlc2FkYSkgfHwgMDtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIE51bWJlcihfZ2V0U3RvY2soaW5nLnNrdSkpIHx8IDA7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAwO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgX3Byb2R1Y3RzID0gQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXTtcbiAgLyoqIEBwYXJhbSB7c3RyaW5nfSBjb2RlICovXG4gIGNvbnN0IF9wcm9kdWN0byA9IChjb2RlKSA9PiB7XG4gICAgY29uc3QgdSA9IFN0cmluZyhjb2RlIHx8ICcnKVxuICAgICAgLnRvVXBwZXJDYXNlKClcbiAgICAgIC50cmltKCk7XG4gICAgY29uc3QgcCA9IF9wcm9kdWN0cy5maW5kKFxuICAgICAgKHgpID0+XG4gICAgICAgIFN0cmluZyh4LmNvZGUgfHwgJycpXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKClcbiAgICAgICAgICAudHJpbSgpID09PSB1XG4gICAgKTtcbiAgICByZXR1cm4gcCA/IFN0cmluZyhwLmRlc2MgfHwgcC5uYW1lIHx8ICcnKSA6ICcnO1xuICB9O1xuICAvKiogQHBhcmFtIHthbnl9IHRzICovXG4gIGNvbnN0IF9mbXRUcyA9ICh0cykgPT4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAoIXRzKSByZXR1cm4gJyc7XG4gICAgICBpZiAodHlwZW9mIHRzID09PSAnc3RyaW5nJykgcmV0dXJuIHRzLnNsaWNlKDAsIDE5KS5yZXBsYWNlKCdUJywgJyAnKTtcbiAgICAgIGlmICh0cy50b0RhdGUpIHJldHVybiB0cy50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDE5KS5yZXBsYWNlKCdUJywgJyAnKTtcbiAgICAgIGlmICh0eXBlb2YgdHMuc2Vjb25kcyA9PT0gJ251bWJlcicpXG4gICAgICAgIHJldHVybiBuZXcgRGF0ZSh0cy5zZWNvbmRzICogMTAwMCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZSgnVCcsICcgJyk7XG4gICAgICBpZiAodHMgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdHMudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxOSkucmVwbGFjZSgnVCcsICcgJyk7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG5cbiAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICBjb25zdCByZXN1bWVuUm93cyA9IFtdO1xuICAvKiogQHR5cGUge0FycmF5PGFueT59ICovXG4gIGNvbnN0IGRldGFsbGVSb3dzID0gW107XG4gIGxldCB0b3RhbEluZ3Jlc2FkYXMgPSAwO1xuICBsZXQgdG90YWxCTyA9IDA7XG4gIGxldCB0b3RhbENsaWVudGVzID0gMDtcblxuICAvLyBTb3J0IHBvciBTS1UgKyBxdHlJbmdyZXNhZGEgYXNjIChtaXNtbyBvcmRlbiBxdWUgZWwgbW9kYWwgY29uIGZhbGxiYWNrKS5cbiAgY29uc3Qgc29ydGVkID0gaW5ncmVzb3Muc2xpY2UoKS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgcWEgPSBOdW1iZXIoYS5xdHlJbmdyZXNhZGEpIHx8IDA7XG4gICAgY29uc3QgcWIgPSBOdW1iZXIoYi5xdHlJbmdyZXNhZGEpIHx8IDA7XG4gICAgaWYgKHFhICE9PSBxYikgcmV0dXJuIHFhIC0gcWI7XG4gICAgcmV0dXJuIFN0cmluZyhhLnNrdSB8fCAnJykubG9jYWxlQ29tcGFyZShTdHJpbmcoYi5za3UgfHwgJycpKTtcbiAgfSk7XG5cbiAgZm9yIChjb25zdCBpbmcgb2Ygc29ydGVkKSB7XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKGluZy5za3UgfHwgJycpO1xuICAgIGNvbnN0IHByb2R1Y3RvID0gX3Byb2R1Y3RvKHNrdSk7XG4gICAgY29uc3Qgc3RvY2tGaXMgPSBfc3RvY2tGaXNpY28oaW5nKTtcbiAgICBjb25zdCBxdHlJbmcgPSBOdW1iZXIoaW5nLnF0eUluZ3Jlc2FkYSkgfHwgMDtcbiAgICBjb25zdCBjbGllbnRlcyA9IEFycmF5LmlzQXJyYXkoaW5nLmNsaWVudGVzQk8pID8gaW5nLmNsaWVudGVzQk8gOiBbXTtcbiAgICBjb25zdCBzdW1hQk8gPSBjbGllbnRlcy5yZWR1Y2UoXG4gICAgICAoLyoqIEB0eXBlIHtudW1iZXJ9ICovIHMsIC8qKiBAdHlwZSB7YW55fSAqLyBjKSA9PiBzICsgKE51bWJlcihjLnF0eUJPKSB8fCAwKSxcbiAgICAgIDBcbiAgICApO1xuICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyhpbmcuc3RhdHVzIHx8ICcnKTtcbiAgICBjb25zdCBkZXRlY3RlZEF0ID0gX2ZtdFRzKGluZy5kZXRlY3RlZEF0KTtcblxuICAgIHJlc3VtZW5Sb3dzLnB1c2goe1xuICAgICAgU0tVOiBza3UsXG4gICAgICBQcm9kdWN0bzogcHJvZHVjdG8sXG4gICAgICBTdG9ja19maXNpY29fZGVwMTE6IHN0b2NrRmlzLFxuICAgICAgUXR5X2luZ3Jlc2FkYTogcXR5SW5nLFxuICAgICAgTl9jbGllbnRlc19CTzogY2xpZW50ZXMubGVuZ3RoLFxuICAgICAgU3VtYV9CT19zb2xpY2l0YWRhOiBzdW1hQk8sXG4gICAgICBTdGF0dXM6IHN0YXR1cyxcbiAgICAgIEluZ3Jlc29fZGV0ZWN0YWRvOiBkZXRlY3RlZEF0LFxuICAgIH0pO1xuICAgIHRvdGFsSW5ncmVzYWRhcyArPSBxdHlJbmc7XG4gICAgdG90YWxCTyArPSBzdW1hQk87XG4gICAgdG90YWxDbGllbnRlcyArPSBjbGllbnRlcy5sZW5ndGg7XG5cbiAgICBmb3IgKGNvbnN0IGMgb2YgY2xpZW50ZXMpIHtcbiAgICAgIGRldGFsbGVSb3dzLnB1c2goe1xuICAgICAgICBTS1U6IHNrdSxcbiAgICAgICAgUHJvZHVjdG86IHByb2R1Y3RvLFxuICAgICAgICBTdG9ja19maXNpY29fZGVwMTE6IHN0b2NrRmlzLFxuICAgICAgICBDbGllbnRlOiBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKSxcbiAgICAgICAgQ2FyZENvZGU6IFN0cmluZyhjLmNhcmRDb2RlIHx8ICcnKSxcbiAgICAgICAgVmVuZGVkb3I6IFN0cmluZyhjLnZlbmRvcktleSB8fCBjLnZlbmRvciB8fCAnJyksXG4gICAgICAgIFF0eV9CT19zb2xpY2l0YWRhOiBOdW1iZXIoYy5xdHlCTykgfHwgMCxcbiAgICAgICAgU3RhdHVzOiBzdGF0dXMsXG4gICAgICAgIEluZ3Jlc29fZGV0ZWN0YWRvOiBkZXRlY3RlZEF0LFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gRmlsYSBUT1RBTCBhbCBmaW5hbCBkZSBjYWRhIGhvamEgKHBhdHJcdTAwRjNuIGV4aXN0ZW50ZSBkb3dubG9hZFhsc3gpLlxuICByZXN1bWVuUm93cy5wdXNoKHtcbiAgICBTS1U6ICdUT1RBTCcsXG4gICAgUHJvZHVjdG86ICcnLFxuICAgIFN0b2NrX2Zpc2ljb19kZXAxMTogJycsXG4gICAgUXR5X2luZ3Jlc2FkYTogdG90YWxJbmdyZXNhZGFzLFxuICAgIE5fY2xpZW50ZXNfQk86IHRvdGFsQ2xpZW50ZXMsXG4gICAgU3VtYV9CT19zb2xpY2l0YWRhOiB0b3RhbEJPLFxuICAgIFN0YXR1czogJycsXG4gICAgSW5ncmVzb19kZXRlY3RhZG86ICcnLFxuICB9KTtcbiAgZGV0YWxsZVJvd3MucHVzaCh7XG4gICAgU0tVOiAnVE9UQUwnLFxuICAgIFByb2R1Y3RvOiAnJyxcbiAgICBTdG9ja19maXNpY29fZGVwMTE6ICcnLFxuICAgIENsaWVudGU6ICcnLFxuICAgIENhcmRDb2RlOiAnJyxcbiAgICBWZW5kZWRvcjogJycsXG4gICAgUXR5X0JPX3NvbGljaXRhZGE6IHRvdGFsQk8sXG4gICAgU3RhdHVzOiAnJyxcbiAgICBJbmdyZXNvX2RldGVjdGFkbzogJycsXG4gIH0pO1xuXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHBhZCA9ICgvKiogQHR5cGUge251bWJlcn0gKi8gbikgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIGNvbnN0IGZuYW1lID1cbiAgICAnUmVwYXJ0b18nICtcbiAgICBub3cuZ2V0RnVsbFllYXIoKSArXG4gICAgJy0nICtcbiAgICBwYWQobm93LmdldE1vbnRoKCkgKyAxKSArXG4gICAgJy0nICtcbiAgICBwYWQobm93LmdldERhdGUoKSkgK1xuICAgICdfJyArXG4gICAgcGFkKG5vdy5nZXRIb3VycygpKSArXG4gICAgcGFkKG5vdy5nZXRNaW51dGVzKCkpICtcbiAgICAnLnhsc3gnO1xuXG4gIGF3YWl0IGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1Jlc3VtZW4nLCByb3dzOiByZXN1bWVuUm93cyB9LFxuICAgIHsgbmFtZTogJ0RldGFsbGUnLCByb3dzOiBkZXRhbGxlUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBSZXBhcnRvIGxpc3RvICgnICtcbiAgICAgIHNvcnRlZC5sZW5ndGggK1xuICAgICAgJyBpbmdyZXNvcyBcdTAwQjcgJyArXG4gICAgICBkZXRhbGxlUm93cy5sZW5ndGggK1xuICAgICAgJyBmaWxhcyBkZXRhbGxlKScsXG4gICAgMjgwMFxuICApO1xufTtcblxuLy8gdjczNzogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG8gZWwgU3RvY2sgQXNpZ25hZG8gKHNpbiBmaWx0cm8gZGUgbWVzKS4gTWlzbW9cbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxud2luZG93LmV4cG9ydFN0b2NrQXNpZ0FsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8gKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjExMDAgKDIwMjYtMDktMzApOiBtaXNtbyBtXHUwMEYzZHVsbyBwdXJvIHF1ZSByZW5kZXJCYWNrb3JkZXJzVGFiIGVuIG1vZG9cbiAgLy8gYXNpZ25hY2lvbi4gQWhvcmEgZWwgcmVwb3J0ZSBjb2luY2lkZSBjb24gZWwgbW9kYWw6IEZJRk8gY2FwIHBvciBkaXNwU2FwLFxuICAvLyBmaWx0cm8gdmVuY2lkYXMgKEFTSUcgPjE1ZCBmdWVyYSwgQVNJRyBzaW4gcmVzZXJ2YSB2aWdlbnRlIGFkZW50cm8pLFxuICAvLyBjb25maXJtZWQgaW5jbHVpZG8sIHNpbiBsXHUwMEVEbmVhcyBcInZpcnR1YWxfQVNJR1wiIGZhbnRhc21hLlxuICBjb25zdCBhcnIgPVxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIGFycixcbiAgICAgICAgJ2FzaWduYWNpb24nLFxuICAgICAgICB7fSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBhcnIpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxdHkgPSBjLnF0eUFzaWduYWRhIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xuICAgIH1cbiAgICAvLyBFc3RhZG9fUmVhbDogaGlzdFx1MDBGM3JpY28gXCJCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRylcIiB2cyBcIkFTSUdcIi4gdjExMDA6XG4gICAgLy8gYWhvcmEgYGNvbmZpcm1lZGAgdGFtYmlcdTAwRTluIGVudHJhICh2OTYyKS4gUHJlc2VydmFtb3MgZXRpcXVldGEgbGVnYWN5XG4gICAgLy8gcG9yIGNvbXBhdGliaWxpZGFkIGNvbiBxdWllbiBjb25zdW1lIGVsIEV4Y2VsLlxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcbiAgICAgIE9yaWdlbjogKHAgJiYgcC5taWdyYXRpb25Tb3VyY2UpIHx8ICdhcHAnLFxuICAgICAgLy8gdjExMDA6IGNvbnRleHRvIFx1MDBGQXRpbCBwYXJhIGRlYnVnZ2luZyBwYXJpZGFkIG1vZGFsXHUyMTk0cmVwb3J0ZS5cbiAgICAgIFN0b2NrX0Rpc3BfU0tVOiBybC5kaXNwU2FwIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydChcbiAgICAgICdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xuICAgICAgICBhcnIubGVuZ3RoICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcbiAgICAgICAgdG90YWxQZWRpZG9zT3BlbiArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gTGluZWFzIHBvc3QtRklGTyt2ZW5jaWRhcyBjb24gcXR5QXNpZ25hZGE+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IHN0b2NrIGFzaWduYWRvIGFob3JhIG1pc21vXFxuJyArXG4gICAgICAgICcyLiBUb2RvcyBsb3MgQVNJRyBlc3RhbiB2ZW5jaWRvcyAoPjE1ZCBkZXNkZSBhc2lnQXQpXFxuJyArXG4gICAgICAgICczLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbydcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZzogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufTtcblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBudWV2byBleHBvcnQgXCJQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG9cIi4gTGlzdGFcbi8vIGxvcyByZXBhcnRvcyBhYmllcnRvcyAoaW5ncmVzb3NfcmVwYXJ0byBwZW5kaW5nL2luX3Byb2dyZXNzKSBwb3IgU0tVICtcbi8vIGNsaWVudGVzIGVuIGNvbGEuIFJlZW1wbGF6YSBzZW1cdTAwRTFudGljYW1lbnRlIGFsIHZpZWpvIFwiU3RvY2sgQXNpZ25hZG9cIiBlbiBlbFxuLy8gbW9kYWwgKGVsIHZpZWpvIHBhc2EgYSBcIlN0b2NrIEFzaWduYWRvIC0gbFx1MDBFRG5lYXNcIiBjb21vIGF1eGlsaWFyKS5cbi8vIERvcyBob2phczpcbi8vICAgUmVzdW1lbiByZXBhcnRvIFx1MjAxNCB1bmEgZmlsYSBwb3IgZG9jIGluZ3Jlc29zX3JlcGFydG8uXG4vLyAgIENsaWVudGVzIGVuIGNvbGEgXHUyMDE0IHVuYSBmaWxhIHBvciBjbGllbnRlIEJPIGRlIGNhZGEgcmVwYXJ0by5cbndpbmRvdy5leHBvcnRQZW5kaWVudGVEZUFzaWduYWNpb25QYWJsbyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgUGVuZGllbnRlIGRlIEFzaWduYWNpXHUwMEYzbiAtIFBhYmxvLi4uJyk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBmYkRiID0gdy5mYkRiO1xuICBpZiAoIWZiRGIpIHtcbiAgICBhbGVydCgnRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkby4gUmVpbnRlbnRcdTAwRTEgZW4gdW5vcyBzZWd1bmRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMS4gUmVwYXJ0b3MgYWJpZXJ0b3MuXG4gIGxldCByZXBhcnRvc0RvY3M7XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdpbmdyZXNvc19yZXBhcnRvJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJ2luJywgWydwZW5kaW5nJywgJ2luX3Byb2dyZXNzJ10pXG4gICAgICAuZ2V0KCk7XG4gICAgcmVwYXJ0b3NEb2NzID0gc25hcC5kb2NzO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGNhcmdhbmRvIGluZ3Jlc29zX3JlcGFydG86ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFyZXBhcnRvc0RvY3MgfHwgcmVwYXJ0b3NEb2NzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVwYXJ0b3MgcGVuZGluZy9pbl9wcm9ncmVzcyBhaG9yYSBtaXNtby4nKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFBhYmxvOiAwIHJlcGFydG9zJywgMjQwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIDIuIFNuYXBzaG90IHN0b2NrICsgZ2V0U3RvY2tCcmVha2Rvd24gcG9yIFNLVS5cbiAgY29uc3Qgc3RvY2tTbmFwID1cbiAgICB0eXBlb2Ygdy5nZXRTdG9ja1NuYXBzaG90ID09PSAnZnVuY3Rpb24nXG4gICAgICA/IHcuZ2V0U3RvY2tTbmFwc2hvdCgpXG4gICAgICA6IHcuX3N0b2NrU25hcHNob3RDYWNoZSB8fCB7IHdhcmVob3VzZUJyZWFrZG93bjoge30gfTtcbiAgY29uc3Qgd2hzID1cbiAgICB0eXBlb2Ygc3RvY2tTbmFwLndhcmVob3VzZUJyZWFrZG93biA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duKVxuICAgICAgOiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duIHx8IHt9O1xuICBjb25zdCBwZWRpZG9zID0gQXJyYXkuaXNBcnJheSh3Lmdsb2JhbFBlZGlkb3MpID8gdy5nbG9iYWxQZWRpZG9zIDogW107XG4gIGNvbnN0IHdhaXRsaXN0RW50cmllcyA9XG4gICAgdHlwZW9mIHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMgPT09ICdmdW5jdGlvbicgPyB3Ll9nZXRXYWl0bGlzdENwc3RFbnRyaWVzKCkgOiBbXTtcbiAgY29uc3QgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyA9IHJlcGFydG9zRG9jcy5tYXAoKGQpID0+XG4gICAgT2JqZWN0LmFzc2lnbih7IF9mc0lkOiBkLmlkIH0sIGQuZGF0YSgpIHx8IHt9KVxuICApO1xuICBjb25zdCBnZXRCcmVha2Rvd24gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuZ2V0U3RvY2tCcmVha2Rvd247XG4gIC8vIDMuIFJlc29sdmVyIHByb2R1Y3RvIHBvciBTS1UuXG4gIGNvbnN0IHByb2RCeVNrdSA9IG5ldyBNYXAoKTtcbiAgY29uc3QgUFJPRFVDVFMgPSBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdO1xuICBmb3IgKGNvbnN0IHAgb2YgUFJPRFVDVFMpIHtcbiAgICBpZiAocCAmJiBwLnNrdSkgcHJvZEJ5U2t1LnNldChTdHJpbmcocC5za3UpLnRvVXBwZXJDYXNlKCksIHApO1xuICB9XG4gIGNvbnN0IG5vd01zID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXTtcbiAgY29uc3QgY29sYVJvd3MgPSBbXTtcbiAgZm9yIChjb25zdCBkb2Mgb2YgcmVwYXJ0b3NEb2NzKSB7XG4gICAgY29uc3QgZGF0YSA9IGRvYy5kYXRhKCkgfHwge307XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKGRhdGEuc2t1IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IHByb2QgPSBwcm9kQnlTa3UuZ2V0KHNrdSkgfHwgbnVsbDtcbiAgICBjb25zdCBmaXNpY29EZXAxMSA9IE51bWJlcigod2hzW3NrdV0gJiYgd2hzW3NrdV1bJzExJ10pIHx8IDApO1xuICAgIGNvbnN0IHF0eUluZ3Jlc2FkYSA9IE51bWJlcihkYXRhLnF0eUluZ3Jlc2FkYSB8fCAwKTtcbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IEFycmF5LmlzQXJyYXkoZGF0YS5hc3NpZ25tZW50cykgPyBkYXRhLmFzc2lnbm1lbnRzIDogW107XG4gICAgbGV0IHF0eVlhQXNpZ25hZGEgPSAwO1xuICAgIGZvciAoY29uc3QgYSBvZiBhc3NpZ25tZW50cykgcXR5WWFBc2lnbmFkYSArPSBOdW1iZXIoKGEgJiYgYS5xdHlBc2lnbmFkYSkgfHwgMCk7XG4gICAgbGV0IHF0eUFSZXBhcnRpciA9IE1hdGgubWF4KDAsIHF0eUluZ3Jlc2FkYSAtIHF0eVlhQXNpZ25hZGEpO1xuICAgIGlmIChnZXRCcmVha2Rvd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJrID0gZ2V0QnJlYWtkb3duKFxuICAgICAgICAgIHNrdSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBnZXRTdG9ja0Zpc2ljbzogKCkgPT4gZmlzaWNvRGVwMTEsXG4gICAgICAgICAgICBwZWRpZG9zLFxuICAgICAgICAgICAgd2FpdGxpc3RFbnRyaWVzLFxuICAgICAgICAgICAgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgbm93OiBub3dNcyB9XG4gICAgICAgICk7XG4gICAgICAgIGlmIChiayAmJiBiay5yZXBhcnRvQWJpZXJ0byAmJiB0eXBlb2YgYmsucmVwYXJ0b0FiaWVydG8ucXR5ID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIHF0eUFSZXBhcnRpciA9IGJrLnJlcGFydG9BYmllcnRvLnF0eTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgLyogZmFsbGJhY2sgYSBjXHUwMEUxbGN1bG8gbG9jYWwgKi9cbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY2xpZW50ZXNCTyA9IEFycmF5LmlzQXJyYXkoZGF0YS5jbGllbnRlc0JPKSA/IGRhdGEuY2xpZW50ZXNCTyA6IFtdO1xuICAgIGxldCBkZXRlY3RlZEF0ID0gZGF0YS5kZXRlY3RlZEF0IHx8ICcnO1xuICAgIGlmIChkZXRlY3RlZEF0ICYmIHR5cGVvZiBkZXRlY3RlZEF0LnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9IGRldGVjdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIGRldGVjdGVkQXQgPSAnJztcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgYm9Ub3RhbFF0eSA9IGNsaWVudGVzQk8ucmVkdWNlKChzLCBjKSA9PiBzICsgTnVtYmVyKGMucXR5QmFja29yZGVyIHx8IDApLCAwKTtcbiAgICByZXN1bWVuUm93cy5wdXNoKHtcbiAgICAgIFJlcGFydG9fSUQ6IGRvYy5pZCxcbiAgICAgIFNLVTogc2t1LFxuICAgICAgUHJvZHVjdG86IChwcm9kICYmIChwcm9kLm5hbWUgfHwgcHJvZC5kZXNjcmlwdGlvbikpIHx8ICcnLFxuICAgICAgRmlzaWNvX0RlcDExOiBmaXNpY29EZXAxMSxcbiAgICAgIFF0eV9JbmdyZXNhZGE6IHF0eUluZ3Jlc2FkYSxcbiAgICAgIFF0eV9ZYV9Bc2lnbmFkYTogcXR5WWFBc2lnbmFkYSxcbiAgICAgIFF0eV9BX1JlcGFydGlyOiBxdHlBUmVwYXJ0aXIsXG4gICAgICBDbGllbnRlc19Fbl9Db2xhOiBjbGllbnRlc0JPLmxlbmd0aCxcbiAgICAgIEJPX1RvdGFsX1F0eTogYm9Ub3RhbFF0eSxcbiAgICAgIERldGVjdGVkQXQ6IHR5cGVvZiBkZXRlY3RlZEF0ID09PSAnc3RyaW5nJyA/IGRldGVjdGVkQXQuc2xpY2UoMCwgMTkpLnJlcGxhY2UoJ1QnLCAnICcpIDogJycsXG4gICAgICBTdGF0dXM6IGRhdGEuc3RhdHVzIHx8ICcnLFxuICAgIH0pO1xuICAgIGZvciAoY29uc3QgYyBvZiBjbGllbnRlc0JPKSB7XG4gICAgICBsZXQgZmVjaGFQZWQgPSBjLnBlZGlkb0NyZWF0ZWRBdCB8fCAnJztcbiAgICAgIGlmIChmZWNoYVBlZCAmJiB0eXBlb2YgZmVjaGFQZWQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSBmZWNoYVBlZC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAgIGZlY2hhUGVkID0gJyc7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFZlbmRlZG9yOiBidXNjYXIgZW4gZ2xvYmFsUGVkaWRvcyBwb3IgcGVkaWRvSWQuXG4gICAgICBsZXQgdmVuZGVkb3IgPSBjLnZlbmRvcktleSB8fCAnJztcbiAgICAgIGlmICghdmVuZGVkb3IgJiYgYy5wZWRpZG9JZCkge1xuICAgICAgICBjb25zdCBwID0gcGVkaWRvcy5maW5kKCh4KSA9PiB4ICYmIHguX2ZzSWQgPT09IGMucGVkaWRvSWQpO1xuICAgICAgICBpZiAocCkgdmVuZGVkb3IgPSBwLm93bmVyVmVuZG9yIHx8IHAudmVuZG9yQXNzaWduZWQgfHwgJyc7XG4gICAgICB9XG4gICAgICBjb2xhUm93cy5wdXNoKHtcbiAgICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgICBTS1U6IHNrdSxcbiAgICAgICAgQ2xpZW50ZTogYy5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDYXJkQ29kZTogYy5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBjLmNsaWVudFByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IGMuY2xpZW50TG9jYWxpdHkgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcbiAgICAgICAgUXR5X0JPOiBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksXG4gICAgICAgIEZlY2hhX1BlZGlkb19PcmlnaW5hbDogdHlwZW9mIGZlY2hhUGVkID09PSAnc3RyaW5nJyA/IGZlY2hhUGVkLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmVzdW1lblJvd3Muc29ydCgoYSwgYikgPT4gYi5RdHlfQV9SZXBhcnRpciAtIGEuUXR5X0FfUmVwYXJ0aXIpO1xuICBjb2xhUm93cy5zb3J0KFxuICAgIChhLCBiKSA9PlxuICAgICAgKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSB8fFxuICAgICAgKGEuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKVxuICApO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVuZGllbnRlRGVBc2lnbmFjaW9uX1BhYmxvXycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1Jlc3VtZW4gcmVwYXJ0bycsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgeyBuYW1lOiAnQ2xpZW50ZXMgZW4gY29sYScsIHJvd3M6IGNvbGFSb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IFBhYmxvOiAnICsgcmVzdW1lblJvd3MubGVuZ3RoICsgJyByZXBhcnRvcyAvICcgKyBjb2xhUm93cy5sZW5ndGggKyAnIGNsaWVudGVzIGVuIGNvbGEnLFxuICAgIDI4MDBcbiAgKTtcbn07XG5cbi8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXN1ZWx2ZSBub21icmUgZGUgZmFudGFzaWEgcGFyYSB1biBwZWRpZG8gdXNhbmRvIGVsXG4vLyBtaXNtbyBwYXR0ZXJuIHF1ZSBsYXMgY2FyZHMgZGVsIG1hcGEgKGluZGV4Lmh0bWw6OTkxNS05OTM1KTpcbi8vICAgMSkgY2xpZW50TWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWEgKGVkaXRhZG8gZGVzZGUgZWwgbW9kYWwgY2xpZW50ZSlcbi8vICAgMikgYXBwcm92ZWRBbHRhc0xpc3RbXS5mYW50YXNpYSBtYXRjaGVhZG8gcG9yIGNvbWVyY2lvID09IGNsaWVudE5hbWVcbmZ1bmN0aW9uIF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCkge1xuICBjb25zdCBjYXJkQ29kZSA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gIGlmIChjYXJkQ29kZSkge1xuICAgIGNvbnN0IG1ldGEgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmNsaWVudE1ldGE7XG4gICAgY29uc3QgY3VzdG9tID0gbWV0YSAmJiBtZXRhW2NhcmRDb2RlXSAmJiBtZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYTtcbiAgICBpZiAoY3VzdG9tICYmIFN0cmluZyhjdXN0b20pLnRyaW0oKSkgcmV0dXJuIFN0cmluZyhjdXN0b20pLnRyaW0oKTtcbiAgfVxuICBjb25zdCBhbHRhcyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuYXBwcm92ZWRBbHRhc0xpc3Q7XG4gIGlmIChBcnJheS5pc0FycmF5KGFsdGFzKSkge1xuICAgIGNvbnN0IG5hbWVMb3dlciA9IFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpXG4gICAgICAudHJpbSgpXG4gICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobmFtZUxvd2VyKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IHtcbiAgICAgICAgaWYgKCFhKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGNvbnN0IGMgPSBTdHJpbmcoYS5jb21lcmNpbyB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGYgPSBTdHJpbmcoYS5mYW50YXNpYSB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIHJldHVybiBjID09PSBuYW1lTG93ZXIgfHwgZiA9PT0gbmFtZUxvd2VyO1xuICAgICAgfSk7XG4gICAgICBpZiAobWF0Y2ggJiYgbWF0Y2guZmFudGFzaWEgJiYgU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhtYXRjaC5mYW50YXNpYSkudHJpbSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gJyc7XG59XG5cbi8vIHYxMjMzICgyMDI2LTEwLTA5KTogcmVwb3J0ZSBcIlZlbnRhcyB4IGFydGljdWxvIHggY2xpZW50ZS92ZW5kZWRvclwiIHZpYSBDRi5cbi8vIEFkbWluL2dlcmVudGUgb25seS4gVGFyZGEgfjMwLTYwcyAoQlEgcXVlcnkgKyBleGNlbGpzIGJ1aWxkIHNlcnZlci1zaWRlKS5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0FydENsaUZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgYWxlcnQoJ0VsZWdcdTAwRUQgdW4gTUVTIGVzcGVjXHUwMEVEZmljbyAobm8gXCJUb2RvIGVsIGFcdTAwRjFvXCIpIFx1MjAxNCBlc3RlIHJlcG9ydGUgZXMgbWVuc3VhbC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gbW9udGhJZHggdmllbmUgMC1iYXNlZCBkZXNkZSBlbCBwaWNrZXIgKGVuZT0wKS4gQ0YgZXNwZXJhIDEtYmFzZWQuXG4gIGNvbnN0IG1vbnRoID0gbW9udGhJZHggKyAxO1xuICBjb25zdCB5ZWFyID0gYW5pbztcbiAgY29uc3QgcGVyaW9kbyA9ICh3aW5kb3cuTUVTRVMgPyB3aW5kb3cuTUVTRVNbbW9udGhJZHhdIDogbW9udGgpICsgJyAnICsgeWVhcjtcbiAgY29uc3QgY29uZmlybU1zZyA9XG4gICAgJ0dlbmVyYXIgcmVwb3J0ZSBcIlZFTlRBUyB4IEFSVElDVUxPIHggQ0xJRU5URS9WRU5ERURPUlwiIGRlICcgK1xuICAgIHBlcmlvZG8gK1xuICAgICc/XFxuXFxuJyArXG4gICAgJ0Z1ZW50ZTogU0FQIHZpYSBCaWdRdWVyeSAoZGF0b3MgZXhhY3RvcykuXFxuJyArXG4gICAgJ1B1ZWRlIHRhcmRhciAzMC02MCBzZWd1bmRvcy5cXG4nICtcbiAgICAnQWwgdGVybWluYXIgc2UgZGVzY2FyZ2EgYXV0b21hdGljYW1lbnRlIGVsIHhsc3guJztcbiAgaWYgKCFjb25maXJtKGNvbmZpcm1Nc2cpKSByZXR1cm47XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gcmVwb3J0ZSBzZXJ2ZXItc2lkZSAoQlEpLi4uIHB1ZWRlIHRhcmRhciB+NjBzJyk7XG4gIHRyeSB7XG4gICAgLy8gdjEwMDAgcGF0dGVybjogcmVmcmVzaCBJRFRva2VuIGFudGVzIGRlIGNhbGxhYmxlIGNyaXRpY28uXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHUgPSB3aW5kb3cuZmlyZWJhc2UuYXV0aCAmJiB3aW5kb3cuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgICAgaWYgKHUgJiYgdS5nZXRJZFRva2VuKSBhd2FpdCB1LmdldElkVG9rZW4odHJ1ZSk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgY29uc3QgY2FsbGFibGUgPSB3aW5kb3cuZmlyZWJhc2VcbiAgICAgIC5hcHAoKVxuICAgICAgLmZ1bmN0aW9ucygnc291dGhhbWVyaWNhLWVhc3QxJylcbiAgICAgIC5odHRwc0NhbGxhYmxlKCdnZW5lcmF0ZVZlbnRhc1JlcG9ydENGJyk7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IGNhbGxhYmxlKHsgeWVhciwgbW9udGggfSk7XG4gICAgY29uc3QgciA9IChyZXNwICYmIHJlc3AuZGF0YSkgfHwge307XG4gICAgaWYgKCFyLm9rIHx8ICFyLmJ5dGVzQmFzZTY0KSB7XG4gICAgICBhbGVydCgnQ0YgZGV2b2x2aW8gZXJyb3I6ICcgKyAoci5lcnJvciB8fCBKU09OLnN0cmluZ2lmeShyKSkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBEZWNvZGUgYmFzZTY0IFx1MjE5MiBCbG9iIFx1MjE5MiBkb3dubG9hZCB0cmlnZ2VyLlxuICAgIGNvbnN0IGJpbiA9IGF0b2Ioci5ieXRlc0Jhc2U2NCk7XG4gICAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW4ubGVuZ3RoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbi5sZW5ndGg7IGkrKykgYnl0ZXNbaV0gPSBiaW4uY2hhckNvZGVBdChpKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J5dGVzXSwge1xuICAgICAgdHlwZTogci5taW1lVHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9XG4gICAgICByLmZpbGVuYW1lIHx8XG4gICAgICAndmVudGFzX3hfYXJ0aWN1bG9fY2xpZW50ZV8nICsgeWVhciArICctJyArIFN0cmluZyhtb250aCkucGFkU3RhcnQoMiwgJzAnKSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gICAgICBhLnJlbW92ZSgpO1xuICAgIH0sIDEwMDApO1xuICAgIGNvbnN0IHN0YXRzID0gci5zdGF0cyB8fCB7fTtcbiAgICBzaG93U3luY1RhZyhcbiAgICAgICdPSzogJyArXG4gICAgICAgIChzdGF0cy52ZW50YXMgfHwgMCkgK1xuICAgICAgICAnIHZlbnRhcyAvICcgK1xuICAgICAgICAoc3RhdHMuaXRlbXMgfHwgMCkgK1xuICAgICAgICAnIFNLVXMgLyAnICtcbiAgICAgICAgKHN0YXRzLmNsaWVudHMgfHwgMCkgK1xuICAgICAgICAnIGNsaWVudGVzJ1xuICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbZXhwb3J0VmVudGFzQXJ0Q2xpXSBlcnJvcicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgcmVwb3J0ZTogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSkpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBQZWRpZG9zIGRlbCBtZXMuLi4nKTtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcbiAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXG4gICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgOiAnJztcbiAgICAvLyB2OTc1ICgyMDI2LTA5LTE3KTogcmVzb2x2ZXIgZmFudGFzaWEgdW5hIHZleiBwb3IgcGVkaWRvIChubyBwb3IgbGluZWEpIFx1MjAxNFxuICAgIC8vIGVsIGxvb2t1cCBlbiBjbGllbnRNZXRhICsgYXBwcm92ZWRBbHRhc0xpc3QgZXMgY29uc3RhbnRlIHBhcmEgdG9kbyBlbCBwZWRpZG8uXG4gICAgY29uc3Qgbm9tYnJlTG9jYWxGYW50YXNpYSA9IF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCk7XG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XG4gICAgICBpZiAoIWwpIHJldHVybjtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKTtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGEsXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgTm9tYnJlX0xvY2FsX0ZhbnRhc2lhOiBub21icmVMb2NhbEZhbnRhc2lhLFxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHAub3duZXJWZW5kb3IgfHwgJycsXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgQ2FudGlkYWRfT3BlbjogTnVtYmVyKGwucXR5T3BlbikgfHwgMCxcbiAgICAgICAgQ2FudGlkYWRfSW52b2ljZWQ6IE51bWJlcihsLnF0eUludm9pY2VkKSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9DYW5jZWxsZWQ6IE51bWJlcihsLnF0eUNhbmNlbGxlZCkgfHwgMCxcbiAgICAgICAgRXN0YWRvX0xpbmVhOiBsLnN0YXRlIHx8ICcnLFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKHF0eSAqIHByZWNpbyksXG4gICAgICAgIENlcnJhZG86IHAuY2xvc2VkQXQgPyAnU0knIDogJ05PJyxcbiAgICAgICAgUGVkaWRvX0lEOiBwLl9mc0lkIHx8ICcnLFxuICAgICAgICBMaW5lYV9JZHg6IGlkeCxcbiAgICAgICAgU1FfRG9jTnVtOiBwLnRyYW5zZmVyaWRvU0FQID8gcC50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gfHwgJycgOiAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuRmVjaGFfUGVkaWRvIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGFfUGVkaWRvIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVkaWRvc0RlbE1lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnUGVkaWRvcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFBlZGlkb3MgZGVsIG1lcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbi8vIEV4cG9ydGFyIHBhcmEgQW5hbGlzaXM6IHByb3RlZ2lkbyBjb24gUElOXG5jb25zdCBBTkFMSVNJU19QSU4gPSAnMTIzNSc7XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4cG9ydCBFeGNlbCBUQVJHRVRTLVpPTkFTIC0gc29sbyBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVBcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIGxhIGhvamEgQ0xJRU5URVNfWk9OQVMgY29uIFVOQSBmaWxhIHBvciBCUCBxdWUgZXN0YSB2aXZvIGVuIFNBUDpcbi8vIGN1YWxxdWllciBhbHRhIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgY29uIHN0YXR1cz0nYXBwcm92ZWQnIFkgY2FyZENvZGVTYXBcbi8vIGFzaWduYWRvLiBFeGNsdXllIFBPSU5UUyAvIGRpc3RyaWJ1aWRvcmVzIC8gcHJvc3BlY3RvcyAvIGFsdGFzIHNpblxuLy8gQ2FyZENvZGUgKG1vY2tzIG8gcGVuZGllbnRlcyBkZSBTQVApLiBFcyBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBmYWN0dXJhLlxuLy8gQ29sdW1uYXM6IFRJUE8sIE5STyBDVEUsIFJFR0lPTiwgUFJPVklOQ0lBLCBBU0VTT1IgRVhURVJOTywgQVNFU09SIElOVEVSTk8sXG4vLyBDQUxMRSwgTlVNRVJPLCBMT0NBTElEQUQsIENQLCBOT01CUkUgQ09NRVJDSUFMLCBOT01CUkUgREUgRkFOVEFTSUEsIENVSVQsXG4vLyBDT05ESUNJT04gRklTQ0FMLCBURUxFRk9OTywgQ0FSRENPREUgU0FQLlxud2luZG93LmV4cG9ydFRhcmdldHNab25hcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpY1x1MDBFMSB0dSBjb25leGlcdTAwRjNuIHkgcmVpbnRlbnRcdTAwRTEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGV4cG9ydGFyIGVsIG1hc3Rlci4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBUQVJHRVRTLVpPTkFTLi4uJyk7XG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gcmVnaW9uT2YocHJvdikge1xuICAgIGNvbnN0IHAgPSAocHJvdiB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICBpZiAoWydCVUVOT1MgQUlSRVMnLCAnQ0FQSVRBTCBGRURFUkFMJywgJ0xBIFBBTVBBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQlVFTk9TIEFJUkVTJztcbiAgICBpZiAoWydDT1JET0JBJywgJ1NBTiBMVUlTJywgJ01FTkRPWkEnLCAnU0FOIEpVQU4nLCAnTEEgUklPSkEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdDVVlPJztcbiAgICBpZiAoWydTQU5UQSBGRScsICdFTlRSRSBSSU9TJywgJ0NIQUNPJywgJ0NPUlJJRU5URVMnLCAnTUlTSU9ORVMnLCAnRk9STU9TQSddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdORUEnO1xuICAgIGlmIChbJ0pVSlVZJywgJ1NBTFRBJywgJ1RVQ1VNQU4nLCAnQ0FUQU1BUkNBJywgJ1NBTlRJQUdPIERFTCBFU1RFUk8nXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdOT0EnO1xuICAgIGlmIChbJ05FVVFVRU4nLCAnUklPIE5FR1JPJywgJ0NIVUJVVCcsICdTQU5UQSBDUlVaJywgJ1RJRVJSQSBERUwgRlVFR08nXS5pbmNsdWRlcyhwKSlcbiAgICAgIHJldHVybiAnUEFUQUdPTklBJztcbiAgICByZXR1cm4gJyc7XG4gIH1cbiAgZnVuY3Rpb24gdmVuZG9yTGFiZWxGb3JFeGNlbChrZXkpIHtcbiAgICBpZiAoIWtleSkgcmV0dXJuICcnO1xuICAgIGlmIChrZXkgPT09ICdfX0RJU1RSSUJVVE9SX18nKSByZXR1cm4gJ0RJU1RSSUJVSURPUkVTJztcbiAgICByZXR1cm4ga2V5O1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgbGV0IGFsdGFzU25hcDtcbiAgdHJ5IHtcbiAgICBhbHRhc1NuYXAgPSBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9PScsICdhcHByb3ZlZCcpXG4gICAgICAuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhcyBhcHJvYmFkYXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IHNraXBwZWROb1NhcCA9IDA7XG4gIGFsdGFzU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICAvLyBGaWx0cm8gY2xhdmU6IHNvbG8gQlBzIGNvbiBDYXJkQ29kZSBTQVAgYXNpZ25hZG8gKD0gaGFiaWxpdGFkbyBlbiBTQVApLlxuICAgIGlmICghY2FyZENvZGUpIHtcbiAgICAgIHNraXBwZWROb1NhcCsrO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBwcm92aW5jZSA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9VcHBlckNhc2UoKS50cmltKCk7XG4gICAgY29uc3QgbG9jYWxpdHlGaW5hbCA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgVElQTzogJ0RBRE8gREUgQUxUQScsXG4gICAgICAnTlJPIENURSc6IDAsIC8vIHNlIHJlbnVtZXJhIGRlc3B1ZXMgZGVsIHNvcnRcbiAgICAgIFJFR0lPTjogcmVnaW9uT2YocHJvdmluY2UpLFxuICAgICAgUFJPVklOQ0lBOiBwcm92aW5jZSxcbiAgICAgICdBU0VTT1IgRVhURVJOTyc6IHZlbmRvckxhYmVsRm9yRXhjZWwodmVuZG9yKSxcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcbiAgICAgIENBTExFOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTlVNRVJPOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExPQ0FMSURBRDogbG9jYWxpdHlGaW5hbCxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgJ05PTUJSRSBDT01FUkNJQUwnOiBhLmNvbWVyY2lvIHx8IGEudGl0dWxhciB8fCAnJyxcbiAgICAgICdOT01CUkUgREUgRkFOVEFTSUEnOiBhLmZhbnRhc2lhIHx8ICcnLFxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxuICAgICAgJ0NPTkRJQ0lPTiBGSVNDQUwnOiBhLmNvbmRpY2lvbkZpc2NhbCB8fCAnJyxcbiAgICAgIFRFTEVGT05POiBhLnRlbGVmb25vIHx8ICcnLFxuICAgICAgJ0NBUkRDT0RFIFNBUCc6IGNhcmRDb2RlLFxuICAgIH0pO1xuICB9KTtcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVAgdG9kYXZpYS5cXG5cXG5VbmEgYWx0YSBlbnRyYSBhbCBleHBvcnQgc29sbyBjdWFuZG8gdGllbmUgQ2FyZENvZGUgU0FQIGFzaWduYWRvLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKHIxLCByMikgPT4ge1xuICAgIGNvbnN0IHAgPSAocjEuUFJPVklOQ0lBIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLlBST1ZJTkNJQSB8fCAnJyk7XG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xuICAgIGNvbnN0IGwgPSAocjEuTE9DQUxJREFEIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLkxPQ0FMSURBRCB8fCAnJyk7XG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcbiAgfSk7XG4gIHJvd3MuZm9yRWFjaCgociwgaSkgPT4ge1xuICAgIHJbJ05STyBDVEUnXSA9IGkgKyAxO1xuICB9KTtcbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCAoZXN0aWxvIHZlcmRlIHVuaWZvcm1lKS5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBhd2FpdCBkb3dubG9hZFhsc3goJ1RBUkdFVFNfVkVOREVET1JFU19aT05BU18nICsgdHMgKyAnLnhsc3gnLCBbXG4gICAgeyBuYW1lOiAnQ0xJRU5URVNfWk9OQVMnLCByb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhjZWwgZXhwb3J0YWRvOiAnICtcbiAgICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgU0FQIGhhYmlsaXRhZG9zJyArXG4gICAgICAoc2tpcHBlZE5vU2FwID4gMCA/ICcgKCcgKyBza2lwcGVkTm9TYXAgKyAnIHNpbiBDYXJkQ29kZSBkZXNjYXJ0YWRvcyknIDogJycpXG4gICk7XG59O1xuXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcGluID0gcHJvbXB0KFxuICAgICdFc3RhIHNlY2Npb24gY29udGllbmUgZm9ybWF0b3MgYXZhbnphZG9zIChQb3dlciBCSSwgUHl0aG9uL01MLCBaSVAgZGUgZm90b3MpIGRlc3RpbmFkb3MgYSBhbmFsaXNpcyB0ZWNuaWNvLlxcblxcbkluZ3Jlc2EgZWwgUElOIHBhcmEgY29udGludWFyOidcbiAgKTtcbiAgaWYgKHBpbiA9PT0gbnVsbCkgcmV0dXJuO1xuICBpZiAocGluICE9PSBBTkFMSVNJU19QSU4pIHtcbiAgICBhbGVydCgnUElOIGluY29ycmVjdG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE9wY2lvbiBJbnRlZ3JhY2lvbiBTQVA6IHNvbG8gcGFyYSBNYXJpYW5vIChlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSlcbiAgY29uc3Qgc2FwT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtc2FwLWludGVncmF0aW9uJyk7XG4gIGlmIChzYXBPcHQpIHtcbiAgICBjb25zdCBpc01hcmlhbm8gPVxuICAgICAgY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nO1xuICAgIHNhcE9wdC5zdHlsZS5kaXNwbGF5ID0gaXNNYXJpYW5vID8gJycgOiAnbm9uZSc7XG4gIH1cbiAgLy8gT3BjaW9uIEJhY2t1cCBtZW5zdWFsOiBzb2xvIGFkbWluXG4gIGNvbnN0IGJrT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtYmFja3VwLW1lbnN1YWwnKTtcbiAgaWYgKGJrT3B0KSBia09wdC5zdHlsZS5kaXNwbGF5ID0gdXNlclJvbGUgPT09ICdhZG1pbicgPyAnJyA6ICdub25lJztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VFeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXG4vLyBIZWxwZXJzIGludGVybm9zIChkb3dubG9hZFhsc3gsIGV4cG9ydFZlbnRhc0Zvck1vbnRoLCBldGMuKSBzb24gY29uc3VtaWRvc1xuLy8gc29sbyBkZW50cm8gZGUgZXN0ZSBibG9xdWUgKHZlcmlmaWNhZG8gcHJlLWV4dHJhY2NpXHUwMEYzbikuXG5cbi8vIHYxMzk2ICgyMDI2LTEwLTIxKTogYXZpc28gYWwgY2xpY2sgcGFyYSBcIlZlbnRhcyBcdTAwRDcgYXJ0XHUwMEVEY3VsbyBcdTAwRDcgY2xpZW50ZVwiLlxuLy8gQWRtaW4vZ2VyZW50ZSBvbmx5LiBUYXJkYSAzMC02MHMuIEFudGVzIGxhIG5vdGEgZXN0YWJhIGVuIGxhIGRlc2NyaXBjaVx1MDBGM24gZGVsXG4vLyBsaXN0YWRvIGRlbCBtb2RhbDsgYWhvcmEgZWwgbGlzdGFkbyBzb2xvIG11ZXN0cmEgaWNvbm8gKyB0aXR1bG8uXG53aW5kb3cuX3ZlbnRhc0FydENsaUNsaWNrID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3Qgcm9sZSA9IHcudXNlclJvbGUgfHwgJyc7XG4gIGlmIChyb2xlICE9PSAnYWRtaW4nICYmIHJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdFc3RlIHJlcG9ydGUgZXMgc29sbyBwYXJhIGFkbWluIC8gZ2VyZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgb2sgPSBjb25maXJtKFxuICAgICdSZXBvcnRlIHNlcnZlci1zaWRlIChCaWdRdWVyeSkuIFRhcmRhIDMwLTYwIHNlZ3VuZG9zIHkgZGVzY2FyZ2EgdW4gLnhsc3ggY29uIDQgaG9qYXM6XFxuJyArXG4gICAgICAnICBcdTIwMjIgUHJvZHVjdG9zIHZlbmRpZG9zIHBvciBWREVcXG4nICtcbiAgICAgICcgIFx1MjAyMiBQcm9kdWN0b3MgTk8gdmVuZGlkb3MgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIENsaWVudGVzIENPTiBjb21wcmEgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIENsaWVudGVzIFNJTiBjb21wcmEgcG9yIFZERVxcblxcbicgK1xuICAgICAgJ0NvbnRpbnVhcj8nXG4gICk7XG4gIGlmICghb2spIHJldHVybjtcbiAgaWYgKHR5cGVvZiB3LmNsb3NlRXhwb3J0RGlhbG9nID09PSAnZnVuY3Rpb24nKSB3LmNsb3NlRXhwb3J0RGlhbG9nKCk7XG4gIGlmICh0eXBlb2Ygdy5zaG93TW9udGhQaWNrZXIgPT09ICdmdW5jdGlvbicpIHcuc2hvd01vbnRoUGlja2VyKCdWRU5UQVNfQVJUX0NMSScpO1xufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWdCQSxTQUFPLHVCQUF1QixpQkFBa0I7QUFDOUMsUUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLFFBQVE7QUFDN0IsWUFBTSxnQ0FBZ0M7QUFDdEM7QUFBQSxJQUNGO0FBQ0EsZ0JBQVkscUNBQXFDO0FBU2pELFVBQU0sZ0JBQWdCLG9CQUFJLElBQUk7QUFDOUIsUUFBSTtBQUNGLFlBQU0sU0FBUyxNQUFNLEtBQUssV0FBVyxvQkFBb0IsRUFBRSxJQUFJO0FBQy9ELGFBQU8sUUFBUSxDQUFDLE1BQU07QUFDcEIsc0JBQWMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEtBQUssQ0FBQyxDQUFDO0FBQUEsTUFDeEMsQ0FBQztBQUFBLElBQ0gsU0FBUyxJQUFJO0FBQ1gsY0FBUTtBQUFBLFFBQ047QUFBQSxRQUNBLE1BQU0sR0FBRztBQUFBLE1BQ1g7QUFBQSxJQUNGO0FBRUEsVUFBTSxZQUNILE9BQU8sWUFBWSxPQUFPLFNBQVMsUUFBUSxPQUFPLFNBQVMsS0FBSyxzQkFBdUI7QUFDMUYsVUFBTSxhQUFhLENBQUMsUUFDbEIsYUFBYSxVQUFVLHdCQUNuQixVQUFVLHNCQUFzQixHQUFHLElBQ25DO0FBQUEsTUFDRSxtQkFBbUI7QUFBQSxNQUNuQixXQUFXO0FBQUEsTUFDWCwyQkFBMkI7QUFBQSxNQUMzQixhQUFRO0FBQUEsTUFDUixzQkFBaUI7QUFBQSxNQUNqQixpQkFBaUI7QUFBQSxNQUNqQiwyQkFBd0IsT0FBTyxJQUFJLGdCQUFnQixPQUFP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QXVCLEVBQUUsVUFBVSxJQUFJLE1BQU07QUFBQSxFQUN2RTtBQUNBLFNBQU8sc0JBQXNCLFdBQVk7QUFDdkMsYUFBUyxlQUFlLHVCQUF1QixFQUFFLFVBQVUsT0FBTyxNQUFNO0FBQUEsRUFDMUU7QUFTQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFVBQU07QUFBQTtBQUFBLE1BQXdCLE9BQU8sV0FBVyxjQUFjLFNBQVMsQ0FBQztBQUFBO0FBQ3hFLFVBQU0sT0FBTyxFQUFFLFlBQVk7QUFDM0IsUUFBSSxTQUFTLFdBQVcsU0FBUyxXQUFXO0FBQzFDLFlBQU0sNENBQTRDO0FBQ2xEO0FBQUEsSUFDRjtBQUNBLFVBQU0sS0FBSztBQUFBLE1BQ1Q7QUFBQSxJQU1GO0FBQ0EsUUFBSSxDQUFDLEdBQUk7QUFDVCxRQUFJLE9BQU8sRUFBRSxzQkFBc0IsV0FBWSxHQUFFLGtCQUFrQjtBQUNuRSxRQUFJLE9BQU8sRUFBRSxvQkFBb0IsV0FBWSxHQUFFLGdCQUFnQixnQkFBZ0I7QUFBQSxFQUNqRjsiLAogICJuYW1lcyI6IFsidyIsICJmYkRiIiwgIlBST0RVQ1RTIl0KfQo=
