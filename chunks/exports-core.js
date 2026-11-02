"use strict";
(() => {
  // src/pure/export-scope.js
  function normVendorKey(k) {
    return String(k || "").trim().toUpperCase();
  }
  function masterVendorKey(p, resolve) {
    if (!p || typeof resolve !== "function") return "";
    try {
      return normVendorKey(resolve(String(p.clientCardCode || ""), String(p.clientName || "")));
    } catch (_e) {
      return "";
    }
  }
  function resolvePedidoVendorKey(p, resolve) {
    if (!p) return "";
    return masterVendorKey(p, resolve) || normVendorKey(p.vendorAssigned);
  }
  function vendorColumnForPedido(p, resolve) {
    if (!p) return "";
    return masterVendorKey(p, resolve) || String(p.vendorAssigned || "").trim() || String(p.ownerVendor || "").trim();
  }
  function toNormSet(s) {
    if (!s) return null;
    const out = /* @__PURE__ */ new Set();
    for (
      const k of
      /** @type {Iterable<string>} */
      s
    ) {
      const n = normVendorKey(k);
      if (n) out.add(n);
    }
    return out;
  }
  function buildExportScope(args) {
    const a = args || /** @type {ExportScopeArgs} */
    { role: null };
    const role = String(a.role || "");
    const myUid = String(a.myUid || "").trim();
    const myKey = normVendorKey(a.myVendorKey);
    const resolve = typeof a.resolveVendorForClient === "function" ? a.resolveVendorForClient : void 0;
    const vendorColumn = (p) => vendorColumnForPedido(p, resolve);
    const compact = (arr) => Array.isArray(arr) ? arr.filter(Boolean) : [];
    if (role === "vendedor") {
      return {
        isGlobal: false,
        visitsQueryByOwnerUid: true,
        vendorColumnForPedido: vendorColumn,
        filterPedidos: (arr) => {
          if (!myUid || !myKey) return [];
          return compact(arr).filter(
            (p) => String(p.assignedVendorUid || "") === myUid && resolvePedidoVendorKey(p, resolve) === myKey
          );
        },
        filterVisits: (arr) => {
          if (!myUid) return [];
          return compact(arr).filter((v) => String(v.ownerUid || "") === myUid);
        }
      };
    }
    if (role === "interno") {
      const set = toNormSet(a.effectiveVendorSet);
      const partners = new Set(
        Array.from(
          /** @type {Iterable<string>} */
          a.partnerUids || []
        ).map((u) => String(u || "").trim()).filter(Boolean)
      );
      return {
        isGlobal: false,
        visitsQueryByOwnerUid: false,
        vendorColumnForPedido: vendorColumn,
        filterPedidos: (arr) => {
          if (!set || set.size === 0) return [];
          return compact(arr).filter((p) => {
            const k = resolvePedidoVendorKey(p, resolve);
            return !!k && set.has(k);
          });
        },
        filterVisits: (arr) => compact(arr).filter((v) => {
          const owner = String(v.ownerUid || "");
          if (myUid && (owner === myUid || String(v.createdByUid || "") === myUid)) return true;
          if (owner && partners.has(owner)) return true;
          const k = normVendorKey(v.vendor);
          return !!set && !!k && set.has(k);
        })
      };
    }
    return {
      isGlobal: true,
      visitsQueryByOwnerUid: false,
      vendorColumnForPedido: vendorColumn,
      filterPedidos: (arr) => compact(arr),
      filterVisits: (arr) => compact(arr)
    };
  }

  // src/domains/exports-core.js
  function _exportScope() {
    const w = (
      /** @type {any} */
      typeof window !== "undefined" ? window : {}
    );
    const role = typeof userRole !== "undefined" ? userRole : null;
    let myUid = "";
    try {
      const u = w.firebase && w.firebase.auth && w.firebase.auth().currentUser;
      myUid = u && u.uid || "";
    } catch (_e) {
      myUid = "";
    }
    const myVendorKey = typeof assignedVendor !== "undefined" ? assignedVendor : "";
    let effectiveVendorSet = null;
    try {
      effectiveVendorSet = typeof getMyAllowedVendorKeys === "function" ? getMyAllowedVendorKeys() : null;
    } catch (_e) {
      effectiveVendorSet = null;
    }
    let partnerUids = [];
    try {
      partnerUids = ((typeof myExternalPartners !== "undefined" && Array.isArray(myExternalPartners) ? myExternalPartners : []) || []).map((x) => x && x.uid).filter(Boolean);
    } catch (_e) {
      partnerUids = [];
    }
    const memo = /* @__PURE__ */ new Map();
    const resolveVendorForClient = (cardCode, clientName) => {
      const k = String(cardCode || "") + "|" + String(clientName || "");
      if (memo.has(k)) return memo.get(k);
      let vk = "";
      try {
        const r = typeof w._resolveClientVendorFromMaster === "function" ? w._resolveClientVendorFromMaster({ cardCode, clientName }) : null;
        vk = r && r.vendorKey || "";
      } catch (_e) {
        vk = "";
      }
      memo.set(k, vk);
      return vk;
    };
    return buildExportScope({
      role,
      myUid,
      myVendorKey,
      effectiveVendorSet,
      partnerUids,
      resolveVendorForClient
    });
  }
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
    const scope = _exportScope();
    let snap;
    try {
      let q = fbDb.collection("visits");
      if (scope.visitsQueryByOwnerUid) {
        const u = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        q = q.where("ownerUid", "==", u && u.uid || "__sin_usuario__");
      }
      snap = await q.get();
    } catch (e) {
      alert("Error leyendo visitas: " + (e.message || e));
      return;
    }
    const targetMes = monthIdx !== null ? MESES[monthIdx].toUpperCase() : null;
    const all = [];
    snap.forEach((d) => {
      const v = d.data() || {};
      if (parseInt(v.anio, 10) !== anio) return;
      if (targetMes && (v.mes || "").toUpperCase() !== targetMes) return;
      all.push(v);
    });
    const items = scope.filterVisits(all);
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
  function _iteratePedidosMes(anio, monthIdx, scope) {
    const arr = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
    const sc = scope || _exportScope();
    return sc.filterPedidos(arr).filter((p) => {
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
    const arr = _exportScope().filterPedidos(
      typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : []
    );
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
  window.exportStockAsigAll = async function() {
    showSyncTag("Generando export de Stock Asignado (snapshot actual)...");
    const arr = _exportScope().filterPedidos(
      typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : []
    );
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
    const scope = _exportScope();
    const pedidos = _iteratePedidosMes(anio, monthIdx, scope);
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
          // v1534: vendedor del master actual (fallback vendorAssigned, después ownerVendor).
          Vendedor: scope.vendorColumnForPedido(p),
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzIiwgIi4uL3NyYy9kb21haW5zL2V4cG9ydHMtY29yZS5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIHYxNTM0ICgyMDI2LTExLTAyKSBcdTIwMTQgQWxjYW5jZSBwb3Igcm9sIGRlIGxhcyBleHBvcnRhY2lvbmVzIGRlbCBtb2RhbFxuICogXCJSZXBvcnRlcyBFeGNlbFwiIChhdWRpdG9yXHUwMEVEYSBkb2NzL2F1ZGl0b3JpYS80NiwgRXRhcGEgMSkuXG4gKlxuICogUmVnbGFzIChkZWNpc2lvbmVzIGRlIE1hcmlhbm8pOlxuICogICAtIFwiTG9zIGNsaWVudGVzIGRlIHVuIHZlbmRlZG9yXCIgPSBlbCBtYXN0ZXIgQUNUVUFMIGRlbCBjbGllbnRlIChQT0lOVFMgK1xuICogICAgIHZlbmRvcl9vdmVycmlkZXMgKyBhcHByb3ZlZEFsdGFzLCBDTEFVREUubWQgXHUwMEE3NDYvXHUwMEE3NTApLiBOTyBlbCB2ZW5kZWRvclxuICogICAgIHF1ZSBxdWVkXHUwMEYzIGd1YXJkYWRvIGVuIGVsIHBlZGlkbyAoYXNzaWduZWRWZW5kb3JVaWQgc2UgZ3JhYmEgYWwgY3JlYXIgeVxuICogICAgIG5vIHNlIHJlLXNpbmNyb25pemEgY3VhbmRvIGNhbWJpYSBlbCBtYXN0ZXIpLlxuICogICAtIFZlbmRlZG9yIChWREUpOiB1biBwZWRpZG8gZW50cmEgc29sbyBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1XG4gKiAgICAgY2xpZW50ZSBlcyBlbCBzdXlvIFkgYWRlbVx1MDBFMXMgYGFzc2lnbmVkVmVuZG9yVWlkID09PSBteVVpZGAgKGRlZmVuc2EgZW5cbiAqICAgICBwcm9mdW5kaWRhZDogYG15VWlkYCBzYWxlIGRlIEZpcmViYXNlIEF1dGgsIG5vIGRlIGB1c2VyUm9sZWApLlxuICogICAtIEludGVybm8gKFZESSk6IHVuIHBlZGlkbyBlbnRyYSBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1IGNsaWVudGVcbiAqICAgICBlc3RcdTAwRTEgZW4gc3UgY29uanVudG8gZGUgdmVuZGVkb3JlcyAoc3Ugem9uYSArIHN1cyBwYXJlamFzLCBlbCBtaXNtbyBxdWVcbiAqICAgICB1c2EgZWwgbWFwYTogZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cyAvIGdldEVmZmVjdGl2ZVZlbmRvclNldCgnQUxMJykpLlxuICogICAtIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlciAvIG90cm9zOiBzaW4gY2FtYmlvIChnbG9iYWwpLlxuICogICAtIFZpc2l0YXM6IGVsIHZlbmRlZG9yIHZlIHNvbG8gbGFzIHF1ZSBjYXJnXHUwMEYzIFx1MDBFOWwgKGBvd25lclVpZCA9PT0gbXlVaWRgKTtcbiAqICAgICBlbCBpbnRlcm5vIHZlIGxhcyBzdXlhcyArIGxhcyBkZSBzdXMgcGFyZWphcyAocG9yIGBvd25lclVpZGAgZGUgdW5hXG4gKiAgICAgcGFyZWphLCBwb3IgYGNyZWF0ZWRCeVVpZGAgcHJvcGlvIG8gcG9yIGB2ZW5kb3JgIFx1MjIwOCBzdSBjb25qdW50bykuXG4gKlxuICogU2kgZWwgbWFzdGVyIG5vIHJlc3VlbHZlIGFsIGNsaWVudGUgKGNsaWVudGUgbnVldm8gLyBwcm9zcGVjdG8gc2luIHpvbmEpLFxuICogc2UgdXNhIGVsIGB2ZW5kb3JBc3NpZ25lZGAgZ3VhcmRhZG8gZW4gZWwgcGVkaWRvLiBgb3duZXJWZW5kb3JgICg9IHF1aVx1MDBFOW4gbG9cbiAqIGNhcmdcdTAwRjMsIGxlZ2FjeSkgTk8gc2UgdXNhIHBhcmEgZGVjaWRpciBlbCBhbGNhbmNlOyBzb2xvIGNvbW8gXHUwMEZBbHRpbW8gcmVjdXJzb1xuICogcGFyYSBsYSBjb2x1bW5hIFwiVmVuZGVkb3JcIiBkZWwgRXhjZWwuXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7KGNhcmRDb2RlOiBzdHJpbmcsIGNsaWVudE5hbWU6IHN0cmluZykgPT4gc3RyaW5nfSBSZXNvbHZlVmVuZG9yRm9yQ2xpZW50XG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBFeHBvcnRTY29wZUFyZ3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfG51bGx8dW5kZWZpbmVkfSByb2xlXG4gKiBAcHJvcGVydHkge3N0cmluZ3xudWxsfHVuZGVmaW5lZH0gW215VWlkXVxuICogQHByb3BlcnR5IHtzdHJpbmd8bnVsbHx1bmRlZmluZWR9IFtteVZlbmRvcktleV1cbiAqIEBwcm9wZXJ0eSB7U2V0PHN0cmluZz58QXJyYXk8c3RyaW5nPnxudWxsfHVuZGVmaW5lZH0gW2VmZmVjdGl2ZVZlbmRvclNldF1cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8c3RyaW5nPnxTZXQ8c3RyaW5nPnxudWxsfHVuZGVmaW5lZH0gW3BhcnRuZXJVaWRzXVxuICogQHByb3BlcnR5IHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fSBbcmVzb2x2ZVZlbmRvckZvckNsaWVudF1cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IEV4cG9ydFNjb3BlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzR2xvYmFsXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHZpc2l0c1F1ZXJ5QnlPd25lclVpZCAtIHRydWU6IGNvbnN1bHRhciB2aXNpdHMgY29uIHdoZXJlKCdvd25lclVpZCcsJz09Jyx1aWQpLlxuICogQHByb3BlcnR5IHsocGVkaWRvczogQXJyYXk8YW55PikgPT4gQXJyYXk8YW55Pn0gZmlsdGVyUGVkaWRvc1xuICogQHByb3BlcnR5IHsodmlzaXRzOiBBcnJheTxhbnk+KSA9PiBBcnJheTxhbnk+fSBmaWx0ZXJWaXNpdHNcbiAqIEBwcm9wZXJ0eSB7KHA6IGFueSkgPT4gc3RyaW5nfSB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG9cbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6YSB1biB2ZW5kb3JLZXk6IHRyaW0gKyBtYXlcdTAwRkFzY3VsYXMuXG4gKiBAcGFyYW0ge2FueX0ga1xuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1WZW5kb3JLZXkoaykge1xuICByZXR1cm4gU3RyaW5nKGsgfHwgJycpXG4gICAgLnRyaW0oKVxuICAgIC50b1VwcGVyQ2FzZSgpO1xufVxuXG4vKipcbiAqIFZlbmRlZG9yIGRlbCBtYXN0ZXIgYWN0dWFsIHBhcmEgZWwgY2xpZW50ZSBkZWwgcGVkaWRvLiAnJyBzaSBubyByZXN1ZWx2ZS5cbiAqIEBwYXJhbSB7YW55fSBwXG4gKiBAcGFyYW0ge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR8dW5kZWZpbmVkfSByZXNvbHZlXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5mdW5jdGlvbiBtYXN0ZXJWZW5kb3JLZXkocCwgcmVzb2x2ZSkge1xuICBpZiAoIXAgfHwgdHlwZW9mIHJlc29sdmUgIT09ICdmdW5jdGlvbicpIHJldHVybiAnJztcbiAgdHJ5IHtcbiAgICByZXR1cm4gbm9ybVZlbmRvcktleShyZXNvbHZlKFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKSwgU3RyaW5nKHAuY2xpZW50TmFtZSB8fCAnJykpKTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuLyoqXG4gKiBWZW5kZWRvciBxdWUgZGVmaW5lIGVsIGFsY2FuY2UgZGVsIHBlZGlkbzogbWFzdGVyIGFjdHVhbDsgc2kgZWwgbWFzdGVyIG5vXG4gKiByZXN1ZWx2ZSwgZWwgYHZlbmRvckFzc2lnbmVkYCBndWFyZGFkbyBlbiBlbCBwZWRpZG8uXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fSBbcmVzb2x2ZV1cbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpIHtcbiAgaWYgKCFwKSByZXR1cm4gJyc7XG4gIHJldHVybiBtYXN0ZXJWZW5kb3JLZXkocCwgcmVzb2x2ZSkgfHwgbm9ybVZlbmRvcktleShwLnZlbmRvckFzc2lnbmVkKTtcbn1cblxuLyoqXG4gKiBWYWxvciBkZSBsYSBjb2x1bW5hIFwiVmVuZGVkb3JcIiBkZWwgRXhjZWwgZGUgUGVkaWRvcyBkZWwgbWVzOiBtYXN0ZXIgYWN0dWFsLFxuICogZGVzcHVcdTAwRTlzIGB2ZW5kb3JBc3NpZ25lZGAsIHkgYG93bmVyVmVuZG9yYCBzb2xvIHNpIG5vIGhheSBvdHJhIGNvc2EuXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fSBbcmVzb2x2ZV1cbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG8ocCwgcmVzb2x2ZSkge1xuICBpZiAoIXApIHJldHVybiAnJztcbiAgcmV0dXJuIChcbiAgICBtYXN0ZXJWZW5kb3JLZXkocCwgcmVzb2x2ZSkgfHxcbiAgICBTdHJpbmcocC52ZW5kb3JBc3NpZ25lZCB8fCAnJykudHJpbSgpIHx8XG4gICAgU3RyaW5nKHAub3duZXJWZW5kb3IgfHwgJycpLnRyaW0oKVxuICApO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7U2V0PHN0cmluZz58QXJyYXk8c3RyaW5nPnxudWxsfHVuZGVmaW5lZH0gc1xuICogQHJldHVybnMge1NldDxzdHJpbmc+fG51bGx9XG4gKi9cbmZ1bmN0aW9uIHRvTm9ybVNldChzKSB7XG4gIGlmICghcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG91dCA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBrIG9mIC8qKiBAdHlwZSB7SXRlcmFibGU8c3RyaW5nPn0gKi8gKHMpKSB7XG4gICAgY29uc3QgbiA9IG5vcm1WZW5kb3JLZXkoayk7XG4gICAgaWYgKG4pIG91dC5hZGQobik7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBBcm1hIGxvcyBmaWx0cm9zIGRlIGV4cG9ydGFjaVx1MDBGM24gcGFyYSBlbCByb2wgZGVsIHVzdWFyaW8uXG4gKiBAcGFyYW0ge0V4cG9ydFNjb3BlQXJnc30gYXJnc1xuICogQHJldHVybnMge0V4cG9ydFNjb3BlfVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRFeHBvcnRTY29wZShhcmdzKSB7XG4gIGNvbnN0IGEgPSBhcmdzIHx8IC8qKiBAdHlwZSB7RXhwb3J0U2NvcGVBcmdzfSAqLyAoeyByb2xlOiBudWxsIH0pO1xuICBjb25zdCByb2xlID0gU3RyaW5nKGEucm9sZSB8fCAnJyk7XG4gIGNvbnN0IG15VWlkID0gU3RyaW5nKGEubXlVaWQgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgbXlLZXkgPSBub3JtVmVuZG9yS2V5KGEubXlWZW5kb3JLZXkpO1xuICBjb25zdCByZXNvbHZlID1cbiAgICB0eXBlb2YgYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50ID09PSAnZnVuY3Rpb24nID8gYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50IDogdW5kZWZpbmVkO1xuICAvKiogQHBhcmFtIHthbnl9IHAgKi9cbiAgY29uc3QgdmVuZG9yQ29sdW1uID0gKHApID0+IHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKTtcbiAgLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gYXJyICovXG4gIGNvbnN0IGNvbXBhY3QgPSAoYXJyKSA9PiAoQXJyYXkuaXNBcnJheShhcnIpID8gYXJyLmZpbHRlcihCb29sZWFuKSA6IFtdKTtcblxuICBpZiAocm9sZSA9PT0gJ3ZlbmRlZG9yJykge1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IHRydWUsXG4gICAgICB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG86IHZlbmRvckNvbHVtbixcbiAgICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IHtcbiAgICAgICAgaWYgKCFteVVpZCB8fCAhbXlLZXkpIHJldHVybiBbXTtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QoYXJyKS5maWx0ZXIoXG4gICAgICAgICAgKHApID0+XG4gICAgICAgICAgICBTdHJpbmcocC5hc3NpZ25lZFZlbmRvclVpZCB8fCAnJykgPT09IG15VWlkICYmXG4gICAgICAgICAgICByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpID09PSBteUtleVxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIGZpbHRlclZpc2l0czogKGFycikgPT4ge1xuICAgICAgICBpZiAoIW15VWlkKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKCh2KSA9PiBTdHJpbmcodi5vd25lclVpZCB8fCAnJykgPT09IG15VWlkKTtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmIChyb2xlID09PSAnaW50ZXJubycpIHtcbiAgICBjb25zdCBzZXQgPSB0b05vcm1TZXQoYS5lZmZlY3RpdmVWZW5kb3JTZXQpO1xuICAgIGNvbnN0IHBhcnRuZXJzID0gbmV3IFNldChcbiAgICAgIEFycmF5LmZyb20oLyoqIEB0eXBlIHtJdGVyYWJsZTxzdHJpbmc+fSAqLyAoYS5wYXJ0bmVyVWlkcyB8fCBbXSkpXG4gICAgICAgIC5tYXAoKHUpID0+IFN0cmluZyh1IHx8ICcnKS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoYXJyKSA9PiB7XG4gICAgICAgIGlmICghc2V0IHx8IHNldC5zaXplID09PSAwKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKChwKSA9PiB7XG4gICAgICAgICAgY29uc3QgayA9IHJlc29sdmVQZWRpZG9WZW5kb3JLZXkocCwgcmVzb2x2ZSk7XG4gICAgICAgICAgcmV0dXJuICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+XG4gICAgICAgIGNvbXBhY3QoYXJyKS5maWx0ZXIoKHYpID0+IHtcbiAgICAgICAgICBjb25zdCBvd25lciA9IFN0cmluZyh2Lm93bmVyVWlkIHx8ICcnKTtcbiAgICAgICAgICBpZiAobXlVaWQgJiYgKG93bmVyID09PSBteVVpZCB8fCBTdHJpbmcodi5jcmVhdGVkQnlVaWQgfHwgJycpID09PSBteVVpZCkpIHJldHVybiB0cnVlO1xuICAgICAgICAgIGlmIChvd25lciAmJiBwYXJ0bmVycy5oYXMob3duZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICBjb25zdCBrID0gbm9ybVZlbmRvcktleSh2LnZlbmRvcik7XG4gICAgICAgICAgcmV0dXJuICEhc2V0ICYmICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KSxcbiAgICB9O1xuICB9XG5cbiAgLy8gQWRtaW4gLyBnZXJlbnRlIC8gdmlld2VyIC8gb3Ryb3M6IHNpbiBjYW1iaW8uXG4gIHJldHVybiB7XG4gICAgaXNHbG9iYWw6IHRydWUsXG4gICAgdmlzaXRzUXVlcnlCeU93bmVyVWlkOiBmYWxzZSxcbiAgICB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG86IHZlbmRvckNvbHVtbixcbiAgICBmaWx0ZXJQZWRpZG9zOiAoYXJyKSA9PiBjb21wYWN0KGFyciksXG4gICAgZmlsdGVyVmlzaXRzOiAoYXJyKSA9PiBjb21wYWN0KGFyciksXG4gIH07XG59XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIEVYUE9SVFMtQ09SRTogbWFzdGVyZmlsZSBjbGllbnRlcyArIHByZWNpb3Mvc3RvY2sgKyBtb2RhbCBkZSBleHBvcnRhciArXG4vLyBtb250aCBwaWNrZXIgKyBleHBvcnRzIHBvciBtZXMgKyBleHBvcnRUYXJnZXRzWm9uYXMgKyBvcGVuRXhwb3J0QW5hbGlzaXMuXG4vLyBFeHRyYVx1MDBFRGRvIHZlcmJhdGltIGRlIGluZGV4Lmh0bWwgKGxcdTAwRURuZWFzIDY4ODYtNzkyMSBwcmUtRTIubi4xKS5cbi8vIEZyYWdtZW50b3MgcmVzdGFudGVzIGRlbCBkb21pbmlvIGV4cG9ydHM6IGFkdmFuY2VkICh+MTAzMDItMTE0NTEpIHkgU0FQXG4vLyAofjE4MTIzLTE5ODEyKSByZXF1ZXJpclx1MDBFMW4gRTIubi4yIHkgRTIubi4zIChyZWdsYSAjMTQgQ0xBVURFLm1kKS5cbi8vIENyb3NzLXNjb3BlIHN0YXRlOiBOT05FLiBTaW4gbGlzdGVuZXJzLlxuaW1wb3J0IHsgYnVpbGRFeHBvcnRTY29wZSB9IGZyb20gJy4uL3B1cmUvZXhwb3J0LXNjb3BlLmpzJztcblxuLy8gdjE1MzQgKDIwMjYtMTEtMDIpIFx1MjAxNCBhbGNhbmNlIHBvciByb2wgZGUgbGFzIGV4cG9ydGFjaW9uZXMgKGF1ZGl0b3JcdTAwRURhIDQ2LFxuLy8gRXRhcGEgMSkuIFJlZ2xhIGVuIHNyYy9wdXJlL2V4cG9ydC1zY29wZS5qczogZWwgdmVuZGVkb3IgdmUgc29sbyBwZWRpZG9zIGRlXG4vLyBjbGllbnRlcyBxdWUgSE9ZIHNvbiBzdXlvcyBlbiBlbCBtYXN0ZXIgKFBPSU5UUyArIHZlbmRvcl9vdmVycmlkZXMgK1xuLy8gYXBwcm92ZWRBbHRhcywgXHUwMEE3NDYvXHUwMEE3NTApIHkgYWRlbVx1MDBFMXMgY29uIGFzc2lnbmVkVmVuZG9yVWlkID0gc3UgdXN1YXJpbzsgZWxcbi8vIGludGVybm8gdmUgbG9zIGNsaWVudGVzIGRlIHN1IHpvbmEgKyBzdXMgcGFyZWphcyAoZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cyxcbi8vIGVsIG1pc21vIGFsY2FuY2UgZGVsIG1hcGEpOyBhZG1pbi9nZXJlbnRlIHNpbiBjYW1iaW8uIEVsIHVpZCBzYWxlIGRlXG4vLyBGaXJlYmFzZSBBdXRoIChubyBkZSB1c2VyUm9sZSwgcXVlIGVzIHVuYSB2YXJpYWJsZSBnbG9iYWwgZWRpdGFibGUpLlxuZnVuY3Rpb24gX2V4cG9ydFNjb3BlKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3Qgcm9sZSA9IHR5cGVvZiB1c2VyUm9sZSAhPT0gJ3VuZGVmaW5lZCcgPyB1c2VyUm9sZSA6IG51bGw7XG4gIGxldCBteVVpZCA9ICcnO1xuICB0cnkge1xuICAgIGNvbnN0IHUgPSB3LmZpcmViYXNlICYmIHcuZmlyZWJhc2UuYXV0aCAmJiB3LmZpcmViYXNlLmF1dGgoKS5jdXJyZW50VXNlcjtcbiAgICBteVVpZCA9ICh1ICYmIHUudWlkKSB8fCAnJztcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBteVVpZCA9ICcnO1xuICB9XG4gIGNvbnN0IG15VmVuZG9yS2V5ID0gdHlwZW9mIGFzc2lnbmVkVmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGFzc2lnbmVkVmVuZG9yIDogJyc7XG4gIGxldCBlZmZlY3RpdmVWZW5kb3JTZXQgPSBudWxsO1xuICB0cnkge1xuICAgIGVmZmVjdGl2ZVZlbmRvclNldCA9XG4gICAgICB0eXBlb2YgZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cyA9PT0gJ2Z1bmN0aW9uJyA/IGdldE15QWxsb3dlZFZlbmRvcktleXMoKSA6IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgZWZmZWN0aXZlVmVuZG9yU2V0ID0gbnVsbDtcbiAgfVxuICBsZXQgcGFydG5lclVpZHMgPSBbXTtcbiAgdHJ5IHtcbiAgICBwYXJ0bmVyVWlkcyA9IChcbiAgICAgICh0eXBlb2YgbXlFeHRlcm5hbFBhcnRuZXJzICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KG15RXh0ZXJuYWxQYXJ0bmVycylcbiAgICAgICAgPyBteUV4dGVybmFsUGFydG5lcnNcbiAgICAgICAgOiBbXSkgfHwgW11cbiAgICApXG4gICAgICAubWFwKCh4KSA9PiB4ICYmIHgudWlkKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBwYXJ0bmVyVWlkcyA9IFtdO1xuICB9XG4gIC8vIFJlc29sdmVyIGRlbCBtYXN0ZXIgY29uIG1lbW8gcG9yIGNsaWVudGUgKHVuYSBwYXNhZGEgcG9yIGV4cG9ydCkuXG4gIGNvbnN0IG1lbW8gPSBuZXcgTWFwKCk7XG4gIGNvbnN0IHJlc29sdmVWZW5kb3JGb3JDbGllbnQgPSAoY2FyZENvZGUsIGNsaWVudE5hbWUpID0+IHtcbiAgICBjb25zdCBrID0gU3RyaW5nKGNhcmRDb2RlIHx8ICcnKSArICd8JyArIFN0cmluZyhjbGllbnROYW1lIHx8ICcnKTtcbiAgICBpZiAobWVtby5oYXMoaykpIHJldHVybiBtZW1vLmdldChrKTtcbiAgICBsZXQgdmsgPSAnJztcbiAgICB0cnkge1xuICAgICAgY29uc3QgciA9XG4gICAgICAgIHR5cGVvZiB3Ll9yZXNvbHZlQ2xpZW50VmVuZG9yRnJvbU1hc3RlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gdy5fcmVzb2x2ZUNsaWVudFZlbmRvckZyb21NYXN0ZXIoeyBjYXJkQ29kZSwgY2xpZW50TmFtZSB9KVxuICAgICAgICAgIDogbnVsbDtcbiAgICAgIHZrID0gKHIgJiYgci52ZW5kb3JLZXkpIHx8ICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICB2ayA9ICcnO1xuICAgIH1cbiAgICBtZW1vLnNldChrLCB2ayk7XG4gICAgcmV0dXJuIHZrO1xuICB9O1xuICByZXR1cm4gYnVpbGRFeHBvcnRTY29wZSh7XG4gICAgcm9sZSxcbiAgICBteVVpZCxcbiAgICBteVZlbmRvcktleSxcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQsXG4gICAgcGFydG5lclVpZHMsXG4gICAgcmVzb2x2ZVZlbmRvckZvckNsaWVudCxcbiAgfSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIE1BU1RFUkZJTEUgREUgQ0xJRU5URVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxuLy8gbm9tYnJlLCB0aXBvIChjbGllbnRlL3Byb3NwZWN0byksIHpvbmEgZGVsIHZlbmRlZG9yLCBhc2Vzb3IgZXh0ZXJubywgYXNlc29yXG4vLyBpbnRlcm5vIChkZWR1Y2lkbyBwb3IgcGFyZWphIFZESSksIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBkZXBhcnRhbWVudG8sXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxuLy8gY29vcmRlbmFkYXMgZ2VvY29kaWZpY2FkYXMsIGVzdGFkbyAoSGFiaWxpdGFkby9QZW5kaWVudGUvQ2FuY2VsYWRvKSxcbi8vIGNhdGVnb3JpYSAoUmVndWxhci9WZW50YXMgRXNwZWNpYWxlcy9EaXN0cmlidWlkb3IpLlxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIVBPSU5UUyB8fCAhUE9JTlRTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgY2FyZ2Fkb3MgdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBtYXN0ZXJmaWxlIGRlIGNsaWVudGVzLi4uJyk7XG5cbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGNhcmdhciBjbGllbnRfYnV5ZXJfc3RhdHMgZW4gYmxvcXVlICgxIGRvYyBwb3IgY2FyZENvZGUgU0FQKVxuICAvLyBBTlRFUyBkZSBhcm1hciBsYXMgZmlsYXMsIGFzXHUwMEVEIGNhZGEgZmlsYSB0aWVuZSBzdSBidXllciBzdGF0cyArIGZlY2hhXG4gIC8vIFx1MDBGQWx0aW1hIGNvbXByYSBzaW4gcm9tcGVyIGVsIGZsdWpvLiBGaXJlLWFuZC1mb3JnZXQgc2kgZmFsbGE6IGNhZGEgZmlsYVxuICAvLyBjYWUgYSBcIi1cIiBlbiBsb3MgY2FtcG9zIEJ1eWVyLiBBZG1pbi9nZXJlbnRlIHZlIHRvZGEgbGEgY29sZWNjaVx1MDBGM247XG4gIC8vIHZlbmRlZG9yIHZlIHNcdTAwRjNsbyBsb3Mgc3V5b3MgKHJ1bGVzKS4gU2kgbGEgcnVsZSBibG9xdWVhIFx1MjE5MiBjYXRjaCBcdTIxOTIgdmFjXHUwMEVEby5cbiAgLy8gUGVkaWRvIE1hcmlhbm86IG5vIGludmVudGFyIGNcdTAwRTFsY3VsbyBkZSBcIkZlY2hhIFx1MDBGQWx0aW1hIGNvbXByYVwiOyBzaSBub1xuICAvLyBleGlzdGUgc2Ugb21pdGUuIGJ1eWVyX3N0YXRzLnN0YXRzXzEybS51bHRpbWFDb21wcmEgWUEgZXhpc3RlLlxuICBjb25zdCBidXllclN0YXRzSWR4ID0gbmV3IE1hcCgpO1xuICB0cnkge1xuICAgIGNvbnN0IGJzU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2J1eWVyX3N0YXRzJykuZ2V0KCk7XG4gICAgYnNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGJ1eWVyU3RhdHNJZHguc2V0KGQuaWQsIGQuZGF0YSgpIHx8IHt9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICAnW21hc3RlcmZpbGVdIGNsaWVudF9idXllcl9zdGF0cyBubyBjYXJnYWRvIChydWxlIGRlbmllZCBvIHJlZCk6JyxcbiAgICAgIF9lICYmIF9lLm1lc3NhZ2VcbiAgICApO1xuICB9XG4gIC8vIEhlbHBlcnMgZGVsIHB1cmUgZm4gKGZhbGxiYWNrIGlubGluZSBzaSBidW5kbGUgbm8gY2FyZ1x1MDBGMykuXG4gIGNvbnN0IF9mY0xhYmVscyA9XG4gICAgKHdpbmRvdy5fX3BoYXNlMCAmJiB3aW5kb3cuX19waGFzZTAucHVyZSAmJiB3aW5kb3cuX19waGFzZTAucHVyZS5maWNoYUNsaWVudGVMYWJlbHMpIHx8IG51bGw7XG4gIGNvbnN0IF9jbGFzaWZSb3cgPSAoY21kKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVDbGFzaWZSb3coY21kKVxuICAgICAgOiB7XG4gICAgICAgICAgJ1RpcG8gZGUgY2xpZW50ZSc6ICctJyxcbiAgICAgICAgICBGaWRlbGlkYWQ6ICctJyxcbiAgICAgICAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAnLScsXG4gICAgICAgICAgVGFtYVx1MDBGMW86ICctJyxcbiAgICAgICAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogJy0nLFxuICAgICAgICAgICdUaXBvIGRlIGxvY2FsJzogJy0nLFxuICAgICAgICAgICdDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJzogY21kICYmIGNtZC5jcmVkaXRvQ2hlcXVlID8gTnVtYmVyKGNtZC5jcmVkaXRvQ2hlcXVlKSA6ICctJyxcbiAgICAgICAgfTtcbiAgY29uc3QgX2J1eWVyUm93ID0gKGJzKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQnV5ZXJSb3dcbiAgICAgID8gX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93KGJzLCAnMTJtJylcbiAgICAgIDoge1xuICAgICAgICAgICdNb250byB0b3RhbCAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRmFjdHVyYXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1Byb21lZGlvIHBvciBmYWN0dXJhICgxMm0pJzogJy0nLFxuICAgICAgICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1ByaW1lcmEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9maWxsRGFzaCA9IChyb3cpID0+XG4gICAgX2ZjTGFiZWxzICYmIF9mY0xhYmVscy5maWxsRGFzaEluRW1wdHkgPyBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5KHJvdykgOiByb3c7XG4gIC8vIHYxNDg1IFx1MDBBNzg0ICgyMDI2LTEwLTI3IEJVRyBGSVgpOiBiXHUwMEZBc3F1ZWRhIHBvciBjYXJkQ29kZSAoZnVlbnRlIGF1dG9yaXRhdGl2YSkuXG4gIC8vIHYxNDgyIHVzYWJhIGBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoY2xpZW50TG9jSWQocHJvdiwgbG9jLCBuYW1lKSlgIFx1MjAxNCBzbHVnXG4gIC8vIGRlcml2YWRvIGRlIFBPSU5UUy4gUGFyYSBNQVhFUkEsIFBPSU5UUyBkaWNlIFwiUGFsZXJtbyAoQzE0KVwiIHBlcm8gbGEgRmljaGFcbiAgLy8gcGVyc2lzdGUgY29uIFwiQ09MRUdJQUxFU1wiIFx1MjE5MiBkb2NJZCBtaXNtYXRjaCBcdTIxOTIgY21EYXRhIHVuZGVmaW5lZCBcdTIxOTIgNSBjYW1wb3NcbiAgLy8gRmljaGEgc2FsXHUwMEVEYW4gXCItXCIgYXVucXVlIGNhcmdhZG9zLiBmaW5kQ21EYXRhQnlDYXJkQ29kZSBlc2NhbmVhIHBvclxuICAvLyBzYXBDYXJkQ29kZSBPUiBjYXJkQ29kZVNhcCAoYW1ib3MgYWxpYXNlcykgeSByZXRvcm5hIGVsIGRvYyBjb3JyZWN0by5cbiAgY29uc3QgX2ZpbmRCeUNhcmQgPVxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmluZENtRGF0YUJ5Q2FyZENvZGVcbiAgICAgID8gX2ZjTGFiZWxzLmZpbmRDbURhdGFCeUNhcmRDb2RlXG4gICAgICA6IChjYXJkQ29kZSwgY2FjaGUpID0+IHtcbiAgICAgICAgICBpZiAoIWNhcmRDb2RlIHx8ICFjYWNoZSB8fCB0eXBlb2YgY2FjaGUuZm9yRWFjaCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG51bGw7XG4gICAgICAgICAgbGV0IGZvdW5kID0gbnVsbDtcbiAgICAgICAgICBjYWNoZS5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgICAgICBpZiAoZm91bmQgfHwgIWQpIHJldHVybjtcbiAgICAgICAgICAgIGNvbnN0IGNjMSA9IFN0cmluZyhkLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICAgICAgICBjb25zdCBjYzIgPSBTdHJpbmcoZC5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgICAgICAgICAgaWYgKGNjMSA9PT0gY2FyZENvZGUgfHwgY2MyID09PSBjYXJkQ29kZSkgZm91bmQgPSBkO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBmb3VuZDtcbiAgICAgICAgfTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gbG9va3VwWm9uZSh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYuem9uZSA6ICcnO1xuICB9XG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xuICAgIHJldHVybiB2ID8gdi5sYWJlbCA6IHZlbmRvcktleSB8fCAnJztcbiAgfVxuXG4gIC8vIHY0NTAgKDIwMjYtMDgtMTEpOiBpbmRpY2UgZGUgY2xhc2lmaWNhY2lvbiBkZXNkZSB2aXNpdHMuIFBhcmEgY2FkYVxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXG4gIC8vIGVzcGVjaWFsaXphY2lvbi9jYW5hbENvbXByYS9wb3AvdGlwb1ZlbnRhL2V0Yy4pIGRlbCBmb3JtdWxhcmlvIGRlXG4gIC8vIHZpc2l0YS9jb250YWN0YWRvLiBQb2xpdGljYTogY2FtcG8gcG9yIGNhbXBvLCB0b21hciBlbCBwcmltZXIgdmFsb3JcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cbiAgLy8gdmUgbGEgY2xhc2lmaWNhY2lvbiBtYXMgYWN0dWFsaXphZGEsIHBlcm8gc2kgZWwgdWx0aW1vIGNvbnRhY3RvIG5vIGxsZW5hXG4gIC8vIHVuIGNhbXBvIChjb250YWN0b3MgdGllbmVuIG1lbm9zIGNhbXBvcyBxdWUgdmlzaXRhcyksIGNhZSBhbCBhbnRlcmlvclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcbiAgLy8gaW50ZXJhY2Npb24gcGVybyBubyBwZXJkZXIgaW5mbyB1dGlsIGRlIGxhcyBhbnRlcmlvcmVzXCIuXG4gIGNvbnN0IENMQVNTSUZfRklFTERTID0gW1xuICAgICd0aXBvJyxcbiAgICAnbG9jYWwnLFxuICAgICd0YW1hbm8nLFxuICAgICdmaWRlbGlkYWQnLFxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxuICAgICdjYW5hbENvbXByYScsXG4gICAgJ3JlbGV2YW5jaWEnLFxuICAgICdwb3AnLFxuICAgICduZWNlc2lkYWRQdW50dWFsJyxcbiAgICAndGlwb1ZlbnRhJyxcbiAgICAncG9uZGVyYWNpb25Nb3N0cmFkbycsXG4gICAgJ3BvbmRlcmFjaW9uRWNvbW1lcmNlJyxcbiAgICAnY29tcGV0ZW5jaWEnLFxuICAgICdvcG9ydHVuaWRhZCcsXG4gICAgJ21hc1ZlbmRpZG8nLFxuICAgICdtYXNQcmVndW50YW4nLFxuICAgICdheXVkYVRpZW5kYScsXG4gIF07XG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIChwcm92IHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkudHJpbSgpICtcbiAgICAgICd8JyArXG4gICAgICAobG9jIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcbiAgICApO1xuICB9XG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xuICAgIGlmICh2ICYmIHYuY3JlYXRlZEF0ICYmIHYuY3JlYXRlZEF0LnRvTWlsbGlzKSByZXR1cm4gdi5jcmVhdGVkQXQudG9NaWxsaXMoKTtcbiAgICBpZiAodiAmJiB2LmZlY2hhKSByZXR1cm4gbmV3IERhdGUodi5mZWNoYSkuZ2V0VGltZSgpIHx8IDA7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgY29uc3QgY2xhc3NpZkluZGV4ID0gbmV3IE1hcCgpOyAvLyBrZXkgLT4geyBsYXN0OiB7Y2FtcG9zfSwgbGFzdEZlY2hhLCBsYXN0VHlwZSwgdmlzaXRhcywgY29udGFjdG9zIH1cbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcbiAgICBjb25zdCBieUtleSA9IG5ldyBNYXAoKTtcbiAgICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICBpZiAoIXYpIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSBfY2xhc3NpZktleSh2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcbiAgICAgIGlmICghYnlLZXkuaGFzKGspKSBieUtleS5zZXQoaywgW10pO1xuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XG4gICAgfSk7XG4gICAgYnlLZXkuZm9yRWFjaCgoYXJyLCBrKSA9PiB7XG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxuICAgICAgY29uc3QgbWVyZ2VkID0ge307XG4gICAgICBhcnIuZm9yRWFjaCgodikgPT4ge1xuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICAgICAgaWYgKG1lcmdlZFtmXSAhPSBudWxsICYmIG1lcmdlZFtmXSAhPT0gJycgJiYgbWVyZ2VkW2ZdICE9PSAwKSByZXR1cm47XG4gICAgICAgICAgY29uc3QgdmFsID0gdltmXTtcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xuICAgICAgY2xhc3NpZkluZGV4LnNldChrLCB7XG4gICAgICAgIG1lcmdlZCxcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXG4gICAgICAgIGxhc3RUeXBlOiBsYXRlc3QuaW50ZXJhY3Rpb25UeXBlIHx8IChsYXRlc3QuZXNwYWNpbyA/ICd2aXNpdGEnIDogJycpLFxuICAgICAgICB2aXNpdGFzOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIGNvbnN0IGVudHJ5ID0gY2xhc3NpZkluZGV4LmdldChfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkpO1xuICAgIGlmICghZW50cnkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAnJyxcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUb3RhbCB2aXNpdGFzJzogMCxcbiAgICAgICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IDAsXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXG4gICAgICAgIExvY2FsOiAnJyxcbiAgICAgICAgVGFtYW5vOiAnJyxcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcbiAgICAgICAgRXNwZWNpYWxpemFjaW9uOiAnJyxcbiAgICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6ICcnLFxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcbiAgICAgICAgUE9QOiAnJyxcbiAgICAgICAgJ05lY2VzaWRhZCBwdW50dWFsJzogJycsXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6ICcnLFxuICAgICAgICBDb21wZXRlbmNpYTogJycsXG4gICAgICAgIE9wb3J0dW5pZGFkOiAnJyxcbiAgICAgICAgJ01hcyB2ZW5kaWRvJzogJycsXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXG4gICAgICAgICdBeXVkYSB0aWVuZGEnOiAnJyxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IG0gPSBlbnRyeS5tZXJnZWQgfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXG4gICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0VHlwZSxcbiAgICAgICdUb3RhbCB2aXNpdGFzJzogZW50cnkudmlzaXRhcyxcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXG4gICAgICAnVGlwbyBjb21lcmNpbyc6IG0udGlwbyB8fCAnJyxcbiAgICAgIExvY2FsOiBtLmxvY2FsIHx8ICcnLFxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcbiAgICAgIEZpZGVsaWRhZDogbS5maWRlbGlkYWQgfHwgJycsXG4gICAgICBFc3BlY2lhbGl6YWNpb246IG0uZXNwZWNpYWxpemFjaW9uIHx8ICcnLFxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXG4gICAgICBSZWxldmFuY2lhOiBtLnJlbGV2YW5jaWEgIT0gbnVsbCA/IG0ucmVsZXZhbmNpYSA6ICcnLFxuICAgICAgUE9QOiBtLnBvcCB8fCAnJyxcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAgICdUaXBvIGRlIHZlbnRhJzogbS50aXBvVmVudGEgfHwgJycsXG4gICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyAhPSBudWxsID8gbS5wb25kZXJhY2lvbk1vc3RyYWRvIDogJycsXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgICBDb21wZXRlbmNpYTogbS5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIE9wb3J0dW5pZGFkOiBtLm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgJ01hcyBwcmVndW50YW4nOiBtLm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgICdBeXVkYSB0aWVuZGEnOiBtLmF5dWRhVGllbmRhIHx8ICcnLFxuICAgIH07XG4gIH1cblxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxuICAvLyBlbCBtYXBhIHkgc2UgY3VlbnRhbiBlbiBlbCBzdGF0IEhBQklMSVRBRE9TLiBBbnRlcyBlbCBtYXN0ZXJmaWxlIGJhamFiYVxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxuICBjb25zdCByb3dzID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xuICAgIGNvbnN0IGxvY2FsaXR5TWFwID0gcC5uYW1lIHx8ICcnO1xuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XG4gICAgLy8gdjMzMTogZmlsdHJhciBwb3Igc2NvcGUgZGUgdmVuZG9yIGRlbCB1c3VhcmlvIHF1ZSBleHBvcnRhLlxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XG4gICAgLy8gU29sbyBjbGllbnRlcyByZWd1bGFyZXMgKG5vIHByb3NwZWN0cywgbm8gZGlzdHJpYnVpZG9yZXMpIHF1ZSBwYXNlblxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY29uc3QgayA9ICdDfCcgKyBwcm92aW5jZSArICd8JyArIGxvY2FsaXR5TWFwICsgJ3wnICsgbmFtZTtcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXG4gICAgICBpZiAodHlwZW9mIGNhbmNlbGVkICE9PSAndW5kZWZpbmVkJyAmJiBjYW5jZWxlZCAmJiBjYW5jZWxlZC5oYXMgJiYgY2FuY2VsZWQuaGFzKGspKVxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cbiAgICAgIGNvbnN0IG1ldGEgPSB0eXBlb2YgY2xpZW50TWV0YSAhPT0gJ3VuZGVmaW5lZCcgJiYgY2xpZW50TWV0YSA/IGNsaWVudE1ldGFba10gfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cbiAgICAgIGNvbnN0IGRvY0lkID1cbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xuICAgICAgY29uc3QgY21EYXRhID1cbiAgICAgICAgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBkb2NJZCA/IGNsaWVudE1hc3RlckNhY2hlLmdldChkb2NJZCkgfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XG4gICAgICBjb25zdCBjdXN0b21MYXQgPSBtZXRhLmxhdCAhPSBudWxsID8gbWV0YS5sYXQgOiAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxuICAgICAgbGV0IGNhcmRDb2RlID0gY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnO1xuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XG4gICAgICAgIGNvbnN0IGFsdGFzID0gYXBwcm92ZWRBbHRhc0J5TG9jW2tleV0gfHwgW107XG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XG4gICAgICB9XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogQnV5ZXIgc3RhdHMgaW5kZXhhZG8gcG9yIGNhcmRDb2RlIFNBUC5cbiAgICAgIGNvbnN0IF9idXllclN0YXRzID0gY2FyZENvZGUgPyBidXllclN0YXRzSWR4LmdldChjYXJkQ29kZSkgfHwgbnVsbCA6IG51bGw7XG4gICAgICAvLyB2MTQ4NSBcdTAwQTc4NCBCVUcgRklYOiBidXNjYXIgY21EYXRhIGF1dG9yaXRhdGl2byBwb3IgY2FyZENvZGUuIEVsXG4gICAgICAvLyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIGRlIGFycmliYSB1c2Egc2x1ZyBjbGllbnRMb2NJZCBxdWUgcHVlZGVcbiAgICAgIC8vIGFwdW50YXIgYWwgZG9jIEVRVUlWT0NBRE8gKHZlciBjb21tZW50IGFycmliYSkuIF9maW5kQnlDYXJkIHNjYW4gcG9yXG4gICAgICAvLyBzYXBDYXJkQ29kZSBnYXJhbnRpemEgZW5jb250cmFyIGVsIGRvYyBjb24gbG9zIGNhbXBvcyBGaWNoYS5cbiAgICAgIGNvbnN0IF9jbURhdGFGb3JGaWNoYSA9IF9maW5kQnlDYXJkKGNhcmRDb2RlLCBjbGllbnRNYXN0ZXJDYWNoZSkgfHwgY21EYXRhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBjYXJkQ29kZSxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbmFtZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcbiAgICAgICAgICAgIFRpcG86ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGVzdGFkbyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jYWxpdHlNYXAsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86IGRlcHQsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGFkZHJlc3MsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvY2FsaXR5Q3VzdCxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogY3VzdG9tTG5nIHx8IGxvbixcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBPUkRFTiBpbXBvcnRhLiBMZWdhY3kgdmlzaXRhcyBQUklNRVJPIChmYWxsYmFjayksXG4gICAgICAgICAgLy8gbHVlZ28gRmljaGEgQ2xpZW50ZSBQSVNBIGNvbiBsYWJlbHMgZGUgbGEgZnVlbnRlIGF1dG9yaXRhdGl2YVxuICAgICAgICAgIC8vIChlai4gXCJGaWRlbGlkYWRcIiBGaWNoYSBwaXNhIGxhIG1lcmdlYWRhIGRlIHZpc2l0YXMgcXVlIHB1ZWRlXG4gICAgICAgICAgLy8gZXN0YXIgZGVzYWN0dWFsaXphZGEpLiBCdXllciBzdGF0cyBhbCBmaW5hbCAodmVudGFuYSAxMm0pLlxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfY21EYXRhRm9yRmljaGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG4gIC8vIElueWVjdGFyIGFsdGFzIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgKGFwcHJvdmVkQWx0YXNMaXN0KTpcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxuICAvLyAgICAgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS4gVmFuIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLiBTZVxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXG4gIC8vICAgICBMb3MgcHJvdmlzb3Jpb3MgcHVlZGVuIG5vIHRlbmVyIGRpcmVjY2lvbiB0b2RhdmlhIC0+IHNlIGFjZXB0YW4gaWd1YWwuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIHNlZW4uYWRkKFxuICAgICAgKHIuUHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgKTtcbiAgfSk7XG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xuICAgIGFwcHJvdmVkQWx0YXNMaXN0LmZvckVhY2goKGEpID0+IHtcbiAgICAgIGlmICghYSkgcmV0dXJuO1xuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XG4gICAgICAvLyBIYWJpbGl0YWRvczogc2lndWVuIGV4aWdpZW5kbyBjYXJkQ29kZSArIGRpcmVjY2lvbiAoY29tcG9ydGFtaWVudG8gcHJlLXYzMTEpLlxuICAgICAgLy8gUHJvdmlzb3Jpb3M6IHNpbiBjYXJkQ29kZSBuaSBkaXJlY2Npb24sIHZhbiBpZ3VhbCBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy5cbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XG4gICAgICAgIGlmICghYS5jYXJkQ29kZVNhcCkgcmV0dXJuO1xuICAgICAgICBpZiAoIShhLmNhbGxlIHx8IGEuYWRkcmVzcykpIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByb3YgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBub21icmUgPVxuICAgICAgICBhLmNvbWVyY2lvIHx8XG4gICAgICAgIGEuZmFudGFzaWEgfHxcbiAgICAgICAgKGEuY2FyZENvZGVTYXAgPyAnU0FQICcgKyBhLmNhcmRDb2RlU2FwLnNsaWNlKDAsIDgpIDogYS50aXR1bGFyIHx8ICdQcm92aXNvcmlvJyk7XG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChzZWVuLmhhcyhkdXBLZXkpKSByZXR1cm47XG4gICAgICBzZWVuLmFkZChkdXBLZXkpO1xuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICAgIC8vIHYzMzE6IG1pc21vIGZpbHRybyBkZSBzY29wZSBhcGxpY2EgYSBhbHRhcyBTQVAvcHJvdmlzb3JpYXMuXG4gICAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcbiAgICAgIGNvbnN0IGxvYyA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyhzaW4gbG9jYWxpZGFkKSc7XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogcGFyYSBhbHRhcywgYnV5ZXIgc3RhdHMga2V5ZWQgcG9yIGNhcmRDb2RlU2FwIChzaSBleGlzdGUpLlxuICAgICAgY29uc3QgX2FsdGFCdXllclN0YXRzID0gYS5jYXJkQ29kZVNhcCA/IGJ1eWVyU3RhdHNJZHguZ2V0KGEuY2FyZENvZGVTYXApIHx8IG51bGwgOiBudWxsO1xuICAgICAgLy8gdjE0ODUgXHUwMEE3ODQgQlVHIEZJWDogcGFyYSBhbHRhcyBjb24gY2FyZENvZGUsIGVsIGRvYyBhdXRvcml0YXRpdm8gY29uXG4gICAgICAvLyBjYW1wb3MgRmljaGEgdml2ZSBlbiBjbGllbnRfbWFzdGVyIChsbyBlc2NyaWJlIHNhdmVDbGllbnRDYXRlZ29yaWFGcm9tTW9kYWxcbiAgICAgIC8vIHZpYSBGaWNoYSkuIF9maW5kQnlDYXJkIHJldG9ybmEgZXNlIGRvYy4gRmFsbGJhY2sgYWwgcHJvcGlvIGFsdGEgYGFgXG4gICAgICAvLyBzaSBlbCBjbGllbnRlIG5vIGVzdFx1MDBFMSBlbiBjbGllbnRfbWFzdGVyIChlai4gcHJvdmlzb3JpbyBzaW4gY2FyZENvZGUpLlxuICAgICAgY29uc3QgX2FsdGFDbURhdGEgPSBhLmNhcmRDb2RlU2FwID8gX2ZpbmRCeUNhcmQoYS5jYXJkQ29kZVNhcCwgY2xpZW50TWFzdGVyQ2FjaGUpIHx8IGEgOiBhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxuICAgICAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBub21icmUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxuICAgICAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbycgOiAnSGFiaWxpdGFkbycsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86ICcnLFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jLFxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogbWlzbW8gb3JkZW4gcXVlIFBPSU5UUyBcdTIwMTQgbGVnYWN5IHZpc2l0YXMgcHJpbWVybyxcbiAgICAgICAgICAvLyBGaWNoYSBwaXNhLCBCdXllciBhbCBmaW5hbC5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfYWx0YUNtRGF0YSksXG4gICAgICAgICAgX2J1eWVyUm93KF9hbHRhQnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXG4gIHJvd3Muc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKGFbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xuICB9KTtcblxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXG4gICAgICAgICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJyArXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCBoZWxwZXIgKGVzdGlsbyB2ZXJkZSArIGNlbnRlcmVkXG4gIC8vIHVuaWZvcm1lKS4gQW50ZXMgdXNhYmEgWExTWC53cml0ZUZpbGUgZGlyZWN0byBjb24gU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmFcbiAgLy8gZXN0aWxvcy4gQWhvcmEgaGVyZWRhZG8gZGVsIGhlbHBlciBcdTIwMTQgbWlzbWEgVUkgcXVlIFZlbnRhcy9WaXNpdGFzL2V0Yy5cbiAgLy8gdjEwNDMgKDIwMjYtMDktMjMpOiBwb3N0LXByb2Nlc28gXHUyMDE0IHNhY2FyIGNvbHVtbmFzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIC8vIFJlcG9ydGUgTWFyaWFubzogbWFzdGVyZmlsZSBleHBvcnRhYmEgMzcgY29sdW1uYXMgZG9uZGUgbXVjaGFzIHZlblx1MDBFRGFuXG4gIC8vIHZhY1x1MDBFRGFzIHBvcnF1ZSBubyBoYWJcdTAwRURhIHZpc2l0YXMvY29udGFjdG9zIGNhcmdhZG9zIHBhcmEgZXNvcyBjbGllbnRlcy5cbiAgLy8gRml4OiBpZGVudGlmaWNhciBrZXlzIGRvbmRlIFRPREFTIGxhcyBmaWxhcyB0aWVuZW4gdmFsb3IgXCJ2YWNcdTAwRURvXCIgKGVtcHR5XG4gIC8vIHN0cmluZywgbnVsbCwgdW5kZWZpbmVkKSB5IHJlbW92ZXJsYXMgYW50ZXMgZGVsIHNoZWV0LiBMb3MgY29udGVvc1xuICAvLyAoVG90YWwgdmlzaXRhcy9jb250YWN0b3MpIHNlIGNvbnNpZGVyYW4gdmFjXHUwMEVEb3Mgc2kgdG9kb3Mgc29uIDAuXG4gIC8vIFdpZHRocyBwb3IgY29sdW1uLW5hbWUgKGVuIHZleiBkZSBwb3NpY2lvbmFsKSBwYXJhIHF1ZSBlbCBmaWx0ZXIgbm9cbiAgLy8gZGVzYWxpbmVlIGVsIHNoZWV0IGN1YW5kbyByZW1vdmVtb3MgY29sdW1uYXMuXG4gIGNvbnN0IENPTF9XSURUSFMgPSB7XG4gICAgJ0NhcmRDb2RlIFNBUCc6IDE2LFxuICAgICdOb21icmUgdGllbmRhJzogMzgsXG4gICAgJ0FsaWFzIChtb2RhbCknOiAyOCxcbiAgICBUaXBvOiAxNCxcbiAgICBFc3RhZG86IDE0LFxuICAgIFByb3ZpbmNpYTogMjIsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknOiAyMixcbiAgICBEZXBhcnRhbWVudG86IDIyLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogMjgsXG4gICAgWm9uYTogOCxcbiAgICAnRXRpcXVldGEgem9uYSc6IDQ4LFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IDI4LFxuICAgIERpcmVjY2lvbjogMzgsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiAyNCxcbiAgICAnTGF0IChnZW9jb2RlKSc6IDE0LFxuICAgICdMbmcgKGdlb2NvZGUpJzogMTQsXG4gICAgLy8gdjE0ODIgXHUwMEE3ODI6IGNvbHVtbmFzIGRlIGxhIEZpY2hhIENsaWVudGUgKHBlc3RhXHUwMEYxYSBDbGFzaWZpY2FjaVx1MDBGM24pICtcbiAgICAvLyBCdXllciAocGVzdGFcdTAwRjFhIEJ1eWVyLCB2ZW50YW5hIDEybSkuIE9yZGVuIGV4YWN0byBxdWUgbGxlZ2EgZGVzZGVcbiAgICAvLyBfY2xhc2lmUm93IChPYmplY3QuYXNzaWduIHByZXNlcnZhIG9yZGVuIGRlIGtleXMpLlxuICAgICdUaXBvIGRlIGNsaWVudGUnOiAzNixcbiAgICBGaWRlbGlkYWQ6IDEwLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0byc6IDIwLFxuICAgIFRhbWFcdTAwRjFvOiAxMCxcbiAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogMjAsXG4gICAgJ1RpcG8gZGUgbG9jYWwnOiAxNCxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IDE4LFxuICAgICdNb250byB0b3RhbCAoMTJtKSc6IDE2LFxuICAgICdGYWN0dXJhcyAoMTJtKSc6IDEyLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6IDIwLFxuICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAyMCxcbiAgICAnRmFjdHVyYXMgcG9yIG1lcyAoMTJtKSc6IDE2LFxuICAgICdQcmltZXJhIGNvbXByYSc6IDE0LFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAxNCxcbiAgICAnRFx1MDBFRGFzIGRlc2RlIFx1MDBGQWx0aW1hIGNvbXByYSc6IDE4LFxuICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVG90YWwgdmlzaXRhcyc6IDEwLFxuICAgICdUb3RhbCBjb250YWN0b3MnOiAxMCxcbiAgICAnVGlwbyBjb21lcmNpbyc6IDE4LFxuICAgIExvY2FsOiAxNixcbiAgICAnQ2FuYWwgZGUgY29tcHJhJzogMjAsXG4gICAgUmVsZXZhbmNpYTogMTAsXG4gICAgUE9QOiA4LFxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IDI2LFxuICAgICdUaXBvIGRlIHZlbnRhJzogMTYsXG4gICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAxOCxcbiAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAxOCxcbiAgICBDb21wZXRlbmNpYTogMjYsXG4gICAgT3BvcnR1bmlkYWQ6IDI2LFxuICAgICdNYXMgdmVuZGlkbyc6IDIyLFxuICAgICdNYXMgcHJlZ3VudGFuJzogMjIsXG4gICAgJ0F5dWRhIHRpZW5kYSc6IDI2LFxuICB9O1xuICAvLyBEZXRlY3RhciBrZXlzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIGNvbnN0IGFsbEtleXMgPSBPYmplY3Qua2V5cyhDT0xfV0lEVEhTKTtcbiAgY29uc3QgTlVNRVJJQ19aRVJPX09LID0gbmV3IFNldChbJ1RvdGFsIHZpc2l0YXMnLCAnVG90YWwgY29udGFjdG9zJ10pO1xuICAvLyB2MTQ4MiBcdTAwQTc4MiArIHYxNDg1IFx1MDBBNzg0IG1lam9yYTogY29sdW1uYXMgRmljaGEgKyBlc3RydWN0dXJhbGVzIChDYXJkQ29kZSxcbiAgLy8gWm9uYSwgVmVuZGVkb3IsIERpcmVjY2lcdTAwRjNuLCBldGMuKSBOVU5DQSBzZSBvbWl0ZW4uIE1hcmlhbm8gcGlkaVx1MDBGMzpcbiAgLy8gXCJubyBvY3VsdGFyIGNvbHVtbmFzIHBvciByb2w7IFBBQ0hJIHJlY2liZSBsYXMgbWlzbWFzIGNvbHVtbmFzIHF1ZVxuICAvLyBhZG1pbiwgc29sbyBzdXMgY2xpZW50ZXNcIi4gRWwgZXhwb3J0IFZERS9QQUNISSByZXNwZXRhIGVzdGUgY29udHJhdG9cbiAgLy8gcG9ycXVlIGxhcyBzdHJ1Y3R1cmFsZXMgZXN0XHUwMEUxbiBwcm90ZWdpZGFzIGF1bnF1ZSBlbCBzY29wZSByZWR1Y2lkbyBub1xuICAvLyB0ZW5nYSBkYXRvcyBwYXJhIGFsZ3VuYSBkZSBlbGxhcy5cbiAgY29uc3QgU1RSVUNUVVJBTF9QUk9URUNURUQgPSBuZXcgU2V0KFtcbiAgICAnQ2FyZENvZGUgU0FQJyxcbiAgICAnTm9tYnJlIHRpZW5kYScsXG4gICAgJ0FsaWFzIChtb2RhbCknLFxuICAgICdUaXBvJyxcbiAgICAnRXN0YWRvJyxcbiAgICAnUHJvdmluY2lhJyxcbiAgICAnTG9jYWxpZGFkIChtYXBhKScsXG4gICAgJ0RlcGFydGFtZW50bycsXG4gICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknLFxuICAgICdab25hJyxcbiAgICAnRXRpcXVldGEgem9uYScsXG4gICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJyxcbiAgICAnRGlyZWNjaW9uJyxcbiAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYScsXG4gICAgJ0xhdCAoZ2VvY29kZSknLFxuICAgICdMbmcgKGdlb2NvZGUpJyxcbiAgXSk7XG4gIGNvbnN0IEZJQ0hBX1BST1RFQ1RFRCA9IG5ldyBTZXQoW1xuICAgICdUaXBvIGRlIGNsaWVudGUnLFxuICAgICdGaWRlbGlkYWQnLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0bycsXG4gICAgJ1RhbWFcdTAwRjFvJyxcbiAgICAnRXNwZWNpYWxpemFjaVx1MDBGM24nLFxuICAgICdUaXBvIGRlIGxvY2FsJyxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKScsXG4gICAgJ01vbnRvIHRvdGFsICgxMm0pJyxcbiAgICAnRmFjdHVyYXMgKDEybSknLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKScsXG4gICAgJ0ZyZWN1ZW5jaWEgKGRcdTAwRURhcyBlbnRyZSBjb21wcmFzKScsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknLFxuICAgICdQcmltZXJhIGNvbXByYScsXG4gICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnLFxuICBdKTtcbiAgY29uc3QgZW1wdHlLZXlzID0gbmV3IFNldChcbiAgICBhbGxLZXlzLmZpbHRlcigoaykgPT4ge1xuICAgICAgaWYgKFNUUlVDVFVSQUxfUFJPVEVDVEVELmhhcyhrKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKEZJQ0hBX1BST1RFQ1RFRC5oYXMoaykpIHJldHVybiBmYWxzZTtcbiAgICAgIHJldHVybiByb3dzLmV2ZXJ5KChyKSA9PiB7XG4gICAgICAgIGNvbnN0IHYgPSByW2tdO1xuICAgICAgICBpZiAodiA9PT0gJycgfHwgdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgICAgICBpZiAoTlVNRVJJQ19aRVJPX09LLmhhcyhrKSAmJiB2ID09PSAwKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gICAgfSlcbiAgKTtcbiAgY29uc3Qga2VwdEtleXMgPSBhbGxLZXlzLmZpbHRlcigoaykgPT4gIWVtcHR5S2V5cy5oYXMoaykpO1xuICAvLyB2MTQ4MiBcdTAwQTc4MjogcmVnbGEgXCJuaW5ndW5hIGNlbGRhIHZhY1x1MDBFRGFcIiBcdTIwMTQgZmlsbERhc2hJbkVtcHR5IHNvYnJlIFRPREFTXG4gIC8vIGxhcyBjb2x1bW5hcyBmaW5hbGVzIChjbGFzaWYgKyBidXllciArIGxlZ2FjeSB2aXNpdGFzKS5cbiAgY29uc3Qgcm93c0ZpbHRlcmVkID0gcm93cy5tYXAoKHIpID0+IHtcbiAgICBjb25zdCBvdXQgPSB7fTtcbiAgICBrZXB0S2V5cy5mb3JFYWNoKChrKSA9PiB7XG4gICAgICBvdXRba10gPSByW2tdO1xuICAgIH0pO1xuICAgIHJldHVybiBfZmlsbERhc2gob3V0KTtcbiAgfSk7XG4gIGNvbnN0IHJlbW92ZWRDb3VudCA9IGVtcHR5S2V5cy5zaXplO1xuICBpZiAocmVtb3ZlZENvdW50ID4gMCkge1xuICAgIGNvbnNvbGUubG9nKGBbbWFzdGVyZmlsZV0gcmVtb3ZpZGFzICR7cmVtb3ZlZENvdW50fSBjb2xzIHZhY1x1MDBFRGFzOmAsIFsuLi5lbXB0eUtleXNdLmpvaW4oJywgJykpO1xuICB9XG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxuICAvLyB2MTQ4MiBcdTAwQTc4MjogYWdyZWdhciBjb250ZW8gcG9yIFRpcG8gZGUgY2xpZW50ZSArIEZpZGVsaWRhZCAoZG9zIG51ZXZhc1xuICAvLyBjb2x1bW5hcyBjb24gZGV0YWxsZSBwb3Igem9uYSkuIEZvcm1hdG8gYnJldmUgXCJBOiBOLCBCOiBNLCAtOiBLXCIgcGFyYVxuICAvLyBjYWJlciBlbiB1bmEgc29sYSBjZWxkYSBsZWdpYmxlLlxuICBjb25zdCBieVpvbmUgPSB7fTtcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xuICAgIGlmICghYnlab25lW3pdKSB7XG4gICAgICBieVpvbmVbel0gPSB7XG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBoYWJpbGl0YWRvczogMCxcbiAgICAgICAgY2FuY2VsYWRvczogMCxcbiAgICAgICAgdGlwb3M6IHt9LFxuICAgICAgICBmaWRlbGlkYWRlczoge30sXG4gICAgICB9O1xuICAgIH1cbiAgICBieVpvbmVbel0udG90YWwrKztcbiAgICBpZiAoci5Fc3RhZG8gPT09ICdIYWJpbGl0YWRvJykgYnlab25lW3pdLmhhYmlsaXRhZG9zKys7XG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xuICAgIC8vIFRpcG8gZGUgY2xpZW50ZTogdG9tYXIgcHJpbWVyIGNoYXIgZGVsIGxhYmVsIChcIkEgLSAuLi5cIiwgXCJCIC0gLi4uXCIsXG4gICAgLy8gXCJQIChQcmVtaXVtKS4uLlwiLCBcIkMgLSAuLi5cIikuIFNpIGxhYmVsIGVzIFwiLVwiIFx1MjE5MiBcIi1cIi5cbiAgICBjb25zdCB0aXBvTGJsID0gclsnVGlwbyBkZSBjbGllbnRlJ10gfHwgJy0nO1xuICAgIGNvbnN0IHRpcG9LZXkgPSB0aXBvTGJsID09PSAnLScgPyAnLScgOiBTdHJpbmcodGlwb0xibCkudHJpbSgpLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpO1xuICAgIGJ5Wm9uZVt6XS50aXBvc1t0aXBvS2V5XSA9IChieVpvbmVbel0udGlwb3NbdGlwb0tleV0gfHwgMCkgKyAxO1xuICAgIGNvbnN0IGZpZCA9IHIuRmlkZWxpZGFkIHx8ICctJztcbiAgICBieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSA9IChieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSB8fCAwKSArIDE7XG4gIH0pO1xuICBmdW5jdGlvbiBfZm10RGlzdChkaXN0KSB7XG4gICAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGRpc3QpLnNvcnQoKGEsIGIpID0+IGJbMV0gLSBhWzFdKTtcbiAgICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVybiAnLSc7XG4gICAgcmV0dXJuIGVudHJpZXMubWFwKChbaywgdl0pID0+IGAke2t9OiAke3Z9YCkuam9pbignLCAnKTtcbiAgfVxuICBjb25zdCByZXN1bWVuUm93cyA9IE9iamVjdC5lbnRyaWVzKGJ5Wm9uZSlcbiAgICAubWFwKChbeiwgZF0pID0+ICh7XG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcbiAgICAgICdUb3RhbCB0aWVuZGFzJzogZC50b3RhbCxcbiAgICAgIEhhYmlsaXRhZGFzOiBkLmhhYmlsaXRhZG9zLFxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxuICAgICAgJ1BvciBUaXBvIGRlIGNsaWVudGUnOiBfZm10RGlzdChkLnRpcG9zKSxcbiAgICAgICdQb3IgRmlkZWxpZGFkJzogX2ZtdERpc3QoZC5maWRlbGlkYWRlcyksXG4gICAgfSkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAvLyB2MzMxOiBzdWZpam8gY29uIGVsIHNjb3BlIGFwbGljYWRvIHBhcmEgZGlmZXJlbmNpYXIgZWwgYXJjaGl2byBkZWwgVkRFL1ZESVxuICAvLyBkZWwgZXhwb3J0IGdsb2JhbCBkZWwgYWRtaW4uXG4gIGNvbnN0IHNjb3BlTGJsID1cbiAgICBzY29wZVNldCA9PT0gbnVsbFxuICAgICAgPyAnVE9ET1MnXG4gICAgICA6IHNjb3BlU2V0LnNpemUgPT09IDFcbiAgICAgICAgPyBbLi4uc2NvcGVTZXRdWzBdLnNwbGl0KCcgJylbMF1cbiAgICAgICAgOiAnbWlzLXpvbmFzLScgKyBzY29wZVNldC5zaXplO1xuICBjb25zdCBmbmFtZSA9ICdNYXN0ZXJmaWxlX0NsaWVudGVzX1NBUF8nICsgc2NvcGVMYmwgKyAnXycgKyB0cyArICcueGxzeCc7XG4gIGF3YWl0IGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ0NsaWVudGVzIGhhYmlsaXRhZG9zIFNBUCcsIHJvd3M6IHJvd3NGaWx0ZXJlZCB9LFxuICAgIHsgbmFtZTogJ1Jlc3VtZW4gcG9yIHpvbmEnLCByb3dzOiByZXN1bWVuUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArXG4gICAgICAoc2NvcGVTZXQgPT09IG51bGwgPyAnJyA6ICcgKHNjb3BlOiAnICsgWy4uLnNjb3BlU2V0XS5qb2luKCcsICcpICsgJyknKVxuICApO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcbi8vIEZpcmVzdG9yZSkgeSBTVE9DS19NQVAgKGJvb2xlYW5vIHBvciBTS1UgZGVsIHN0b2NrLmpzb24gZGVsIHJlcG8pLlxuLy8gSG9qYXM6XG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXG4vLyAgICAobG8gbWFzIGNvbXVuIHBhcmEgcmV2aXNhciBkaXNwb25pYmlsaWRhZCArIHByZWNpbykuXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cbi8vICAtIFwiSW5mb1wiOiBmZWNoYSBkZSBsb3Mgc25hcHNob3RzIHkgZnVlbnRlcy5cbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoUFJPRFVDVFMpIHx8ICFQUk9EVUNUUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XG4gIC8vIHY1NzQgKDIwMjYtMDgtMjEpOiBtb3N0cmFyIFVOSURBREVTIG51bWVyaWNhcyBleGFjdGFzIGRlbCBkZXBvc2l0byAxMS5cbiAgLy8gdjEzNjMgKDIwMjYtMTAtMTkpOiBwZWRpZG8gTWFyaWFubyBcdTIwMTQgY2FtYmlhciBkZSBcInN0b2NrIGZcdTAwRURzaWNvIGRlcCAxMVwiIGFcbiAgLy8gXCJsaWJyZSBwYXJhIGxhIHZlbnRhXCIgKD0gZGVwIDExIFx1MjIxMiByZXNlcnZhcyBjb25maXJtZWQvQk8vQVNJRy93YWl0bGlzdCkuXG4gIC8vIFJhelx1MDBGM246IGVudmlhciBhbCBjbGllbnRlIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGxlIHB1ZWRlIHByb21ldGVyIEhPWS5cbiAgLy8gU2kgc29sbyBtb3N0cmFtb3Mgc3RvY2sgZlx1MDBFRHNpY28sIHB1ZWRlIHBhc2FyIHF1ZSBoYXlhIDV1IHBlcm8gbGFzIDUgZXN0XHUwMEU5blxuICAvLyByZXNlcnZhZGFzIFx1MjE5MiBlbCBjbGllbnRlIHNlIGVudGVyYSByZWNpXHUwMEU5biBhbCBoYWNlciBlbCBwZWRpZG8gcXVlIG5vIGhheS5cbiAgLy8gVXNhIGdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSAocHVyZSBmdW5jdGlvbiwgZmlsdHJhIFRUTHMpLiBSZXRvcm5hICcnIHNpXG4gIC8vIG5vIGhheSBzbmFwc2hvdCBjYXJnYWRvOyAwIHNpIG5vIGhheSBsaWJyZS5cbiAgZnVuY3Rpb24gZm10U3RvY2soc2t1KSB7XG4gICAgY29uc3QgZm5SZWFsID1cbiAgICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZVxuICAgICAgICA6IG51bGw7XG4gICAgaWYgKGZuUmVhbCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdiA9IGZuUmVhbChza3UpO1xuICAgICAgICBpZiAodiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgICAgIHJldHVybiBOdW1iZXIodikgfHwgMDtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIC8vIGZhbGxiYWNrIGEgc3RvY2sgZlx1MDBFRHNpY28gYWJham9cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gRmFsbGJhY2s6IHN0b2NrIGZcdTAwRURzaWNvIGRlcCAxMSAoc2kgZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlIG5vIGVzdFx1MDBFMSBkaXNwb25pYmxlLFxuICAgIC8vIGVqLiBib290c3RyYXAgbXV5IHRlbXByYW5vKS5cbiAgICBjb25zdCBmbkZpc2ljbyA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXG4gICAgICAgIDogbnVsbDtcbiAgICBjb25zdCB2RiA9IGZuRmlzaWNvID8gZm5GaXNpY28oc2t1KSA6IG51bGw7XG4gICAgaWYgKHZGID09IG51bGwpIHJldHVybiAnJztcbiAgICByZXR1cm4gTnVtYmVyKHZGKSB8fCAwO1xuICB9XG4gIGZ1bmN0aW9uIGZtdFByZWNpbyhza3UpIHtcbiAgICBjb25zdCBwID0gdHlwZW9mIFBSSUNFX0xJU1RfTUFQID09PSAnb2JqZWN0JyAmJiBQUklDRV9MSVNUX01BUCA/IFBSSUNFX0xJU1RfTUFQW3NrdV0gOiBudWxsO1xuICAgIGlmIChwID09IG51bGwpIHJldHVybiAnJztcbiAgICByZXR1cm4gTnVtYmVyKHApIHx8IDA7XG4gIH1cbiAgLy8gdjEzNjQgKDIwMjYtMTAtMTkpOiByZXdvcmsgZGVsIGV4cG9ydCBwb3IgcGVkaWRvIE1hcmlhbm86XG4gIC8vIC0gSG9qYSBwcmluY2lwYWwgcmVub21icmFkYSBcIlByZWNpb3MgeSBTdG9ja1wiIC0+IFwiTGlzdGEgZGUgcHJlY2lvc1wiLlxuICAvLyAtIE51ZXZhIGNvbHVtbmEgXCJEaXNwb25pYmlsaWRhZFwiIChESVNQT05JQkxFIHZlcmRlIHNpIFN0b2NrPjAsIE5PIERJU1BPTklCTEVcbiAgLy8gICByb2pvIHNpIFN0b2NrPD0wIG8gdmFjaW8pLlxuICAvLyAtIEhvamEgXCJJbmZvXCIgZWxpbWluYWRhLlxuICAvLyAtIE5vbWJyZSBhcmNoaXZvOiBQcmVjaW9zX3lfU3RvY2tfWVlZWS1NTS1ERC54bHN4IC0+IExpc3RhX2RlX1ByZWNpb3NfWVlZWS1NTS1ERC54bHN4LlxuICAvLyBIb2phcyBcIlByZWNpb3NcIiB5IFwiU3RvY2tcIiBzZSBtYW50aWVuZW4gcG9yIHNpIE1hcmlhbm8gbGFzIHVzYS5cbiAgZnVuY3Rpb24gZGlzcExhYmVsKHN0b2NrVmFsKSB7XG4gICAgaWYgKHN0b2NrVmFsID09PSAnJyB8fCBzdG9ja1ZhbCA9PSBudWxsKSByZXR1cm4gJ05PIERJU1BPTklCTEUnO1xuICAgIHJldHVybiBOdW1iZXIoc3RvY2tWYWwpID4gMCA/ICdESVNQT05JQkxFJyA6ICdOTyBESVNQT05JQkxFJztcbiAgfVxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiB7XG4gICAgY29uc3Qgc3QgPSBmbXRTdG9jayhwLmNvZGUpO1xuICAgIHJldHVybiB7XG4gICAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgICBGYW1pbGlhOiBwLmZhbSB8fCAnJyxcbiAgICAgIFN1YmZhbWlsaWE6IHAuc3ViIHx8ICcnLFxuICAgICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcbiAgICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gICAgICBTdG9jazogc3QsXG4gICAgICBEaXNwb25pYmlsaWRhZDogZGlzcExhYmVsKHN0KSxcbiAgICB9O1xuICB9KS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCBwcmVjaW9zUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gIH0pKVxuICAgIC5maWx0ZXIoKHIpID0+IHJbJ1ByZWNpbyBBUlMnXSAhPT0gJycpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHN0b2NrUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4ge1xuICAgIGNvbnN0IHN0ID0gZm10U3RvY2socC5jb2RlKTtcbiAgICByZXR1cm4ge1xuICAgICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICAgU3RvY2s6IHN0LFxuICAgICAgRGlzcG9uaWJpbGlkYWQ6IGRpc3BMYWJlbChzdCksXG4gICAgfTtcbiAgfSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBhd2FpdCBkb3dubG9hZFhsc3goXG4gICAgJ0xpc3RhX2RlX1ByZWNpb3NfJyArIHRzICsgJy54bHN4JyxcbiAgICBbXG4gICAgICB7IG5hbWU6ICdMaXN0YSBkZSBwcmVjaW9zJywgcm93cyB9LFxuICAgICAgeyBuYW1lOiAnUHJlY2lvcycsIHJvd3M6IHByZWNpb3NSb3dzIH0sXG4gICAgICB7IG5hbWU6ICdTdG9jaycsIHJvd3M6IHN0b2NrUm93cyB9LFxuICAgIF0sXG4gICAge1xuICAgICAgLy8gUGFpbnRlciBhcGxpY2FkbyBwb3N0LXJlbmRlciBwb3IgZG93bmxvYWRYbHN4LiBQaW50YSBsYSBjb2x1bW5hXG4gICAgICAvLyBcIkRpc3BvbmliaWxpZGFkXCIgc2VndW4gc3UgdmFsb3I6IHZlcmRlK2JsYW5jbyBzaSBESVNQT05JQkxFLFxuICAgICAgLy8gcm9qbytibGFuY28gc2kgTk8gRElTUE9OSUJMRS4gQ2VudHJhZG8gKyBib2xkIHBhcmEgbGVnaWJpbGlkYWQuXG4gICAgICBjZWxsU3R5bGVyOiAoY2VsbCwgY29sdW1uTmFtZSwgX3ZhbHVlLCBfcm93SW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGNvbHVtbk5hbWUgIT09ICdEaXNwb25pYmlsaWRhZCcpIHJldHVybjtcbiAgICAgICAgY29uc3QgdHh0ID0gU3RyaW5nKGNlbGwudmFsdWUgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIGlmICh0eHQgPT09ICdESVNQT05JQkxFJykge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2QTM0QScgfSB9OyAvLyBncmVlbi02MDBcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9IGVsc2UgaWYgKHR4dCA9PT0gJ05PIERJU1BPTklCTEUnKSB7XG4gICAgICAgICAgY2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGREMyNjI2JyB9IH07IC8vIHJlZC02MDBcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH1cbiAgKTtcbiAgc2hvd1N5bmNUYWcocm93cy5sZW5ndGggKyAnIFNLVXMgZXhwb3J0YWRvcyAobGlzdGEgZGUgcHJlY2lvcyArIGRpc3BvbmliaWxpZGFkKScpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxud2luZG93LmV4cG9ydFRvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cbiAgLy8gICB2ZW5kZWRvcjogb3BlcmF0aXZvIGRpYXJpbyAoVmVudGFzIC8gVmlzaXRhcyAvIFJ1dGFzKSArIENsaWVudGVzIGRlIHN1IHpvbmFcbiAgLy8gICAgIChleHBvcnRNYXN0ZXJDbGllbnRlcyB5YSBmaWx0cmEgcG9yIGdldEVmZmVjdGl2ZVZlbmRvclNldCAtPiBzb2xvIHN1IHZlbmRvcikuXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxuICAvLyAgICAgcHJvcGlvIHNpIGVsaWdpbyBzdSBub21icmUgZW4gZWwgZHJvcGRvd24gZGUgem9uYXMpLlxuICAvLyAgIGFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogdmVuIHRvZG8gZWwgbGlzdGFkbyAobnVsbCA9IHNpbiBmaWx0cm8pLlxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBWRU5UQVMgeSBSVVRBUyBlbGltaW5hZG9zIGRlbCBVSSBwb3IgcGVkaWRvIGRlIE1hcmlhbm8uXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gIH07XG4gIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cbiAgLy8gdjE0MTMgXHUwMEE3NTEgKyB2MTQxNCBcdTAwQTc1MS4xICgyMDI2LTEwLTIyKTogSU5GUkFDQ0lPTkVTX01FTEkgd2hpdGVsaXN0IHBvclxuICAvLyBlbWFpbC4gTWFudGVuZXIgc2luY3Jvbml6YWRvIGNvbiBjYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSgpIGRlXG4gIC8vIGZpcmVzdG9yZS5ydWxlcy4gUmVhZGVyczogTWFyaWFubyAoMiBlbWFpbHMpICsgRGllZ28gVmFsc2kuXG4gIGNvbnN0IElORlJBQ0NJT05FU19NRUxJX1JFQURFUlMgPSBbXG4gICAgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJyxcbiAgICAnbWFyaWFuby5lcmJpbm9Ac2hpbWFuby5jb20uYXInLFxuICAgICdkaWVnby52YWxzaUBzaGltYW5vLnV5JyxcbiAgXTtcbiAgY29uc3QgX2NhblJlYWRJbmZyYWNjaW9uZXNNZWxpID1cbiAgICB0eXBlb2YgY3VycmVudFVzZXIgIT09ICd1bmRlZmluZWQnICYmXG4gICAgY3VycmVudFVzZXIgJiZcbiAgICBJTkZSQUNDSU9ORVNfTUVMSV9SRUFERVJTLmluY2x1ZGVzKChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSk7XG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNleHBvcnQtbW9kYWwgLmV4cC1vcHQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgIGNvbnN0IGtpbmQgPSBlbC5kYXRhc2V0LmV4cEtpbmQgfHwgJyc7XG4gICAgbGV0IHNob3cgPSAhYWxsb3dlZCB8fCBhbGxvd2VkLmhhcyhraW5kKTtcbiAgICBpZiAoa2luZCA9PT0gJ0lORlJBQ0NJT05FU19NRUxJJyAmJiAhX2NhblJlYWRJbmZyYWNjaW9uZXNNZWxpKSBzaG93ID0gZmFsc2U7XG4gICAgZWwuc3R5bGUuZGlzcGxheSA9IHNob3cgPyAnJyA6ICdub25lJztcbiAgfSk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmxldCBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XG4gIFZFTlRBUzogJ1ZlbnRhcycsXG4gIFZJU0lUQVM6ICdWaXNpdGFzJyxcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXG4gIFJVVEFTOiAnUnV0YXMnLFxuICBBTFRBUzogJ0FsdGFzIGRlIGNsaWVudGVzJyxcbiAgQkFDS09SREVSOiAnQmFja29yZGVyJyxcbiAgU1RPQ0tfQVNJRzogJ1N0b2NrIEFzaWduYWRvJyxcbiAgUEVESURPU19NRVM6ICdQZWRpZG9zIGRlbCBtZXMnLFxufTtcblxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uICh0aXBvKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXRpdGxlJyk7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcbiAgc3VidC50ZXh0Q29udGVudCA9ICdFbGVnaSBlbCBtZXMgeSBhXHUwMEYxbyBxdWUgcXVlcmVzIGRlc2Nhcmdhci4nO1xuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1lc1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKTtcbiAgbWVzU2VsLmlubmVySFRNTCA9XG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xuICBsZXQgeW9wdHMgPSAnJztcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXG4gICAgeW9wdHMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgeSArICdcIj4nICsgeSArICc8L29wdGlvbj4nO1xuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG59O1xuXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB0aXBvID0gcGVuZGluZ0V4cG9ydFR5cGU7XG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcbiAgY29uc3QgbW9udGhJZHggPSBtZXNSYXcgPT09ICdBTEwnID8gbnVsbCA6IHBhcnNlSW50KG1lc1JhdywgMTApO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG4gIGlmICghdGlwbykgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWSVNJVEFTJykgZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQUxUQVMnKSBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQkFDS09SREVSJykgZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdTVE9DS19BU0lHJykgZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdQRURJRE9TX01FUycpIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZFTlRBU19BUlRfQ0xJJykgZXhwb3J0VmVudGFzQXJ0Q2xpRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgYWxlcnQoJ1RpcG8gZGVzY29ub2NpZG86ICcgKyB0aXBvKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydCAnICsgdGlwbywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBleHBvcnQ6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHJldHVybiBTdHJpbmcoYW5pbyk7XG4gIHJldHVybiBNRVNFU1ttb250aElkeF0gKyAnXycgKyBhbmlvO1xufVxuXG4vLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZXNjcml0byBjb24gRXhjZWxKUyBwYXJhIGRhciBVSSB1bmlmb3JtZSBhIFRPRE9TIGxvc1xuLy8gZXhwb3J0cyAoaGVhZGVyIHZlcmRlICsgY2VsZGFzIGNlbnRlcmVkICsgYm9yZGVyIHN1dGlsICsgYXV0by1maXQgd2lkdGgpLlxuLy8gQW50ZXMgdXNhYmEgWExTWCBTaGVldEpTIGZyZWUgcXVlIGlnbm9yYSBzaWxlbnRseSBsb3MgZXN0aWxvcyBkZSBjZWxkYS4gRWxcbi8vIHBhdHRlcm4gdmVyZGUgcmVwbGljYSBlbCBUT1RBTCBiYXIgZGUgZXhwb3J0QmFja29yZGVyc1RvRXhjZWwgKG1vZGFsXG4vLyBCYWNrb3JkZXIgdjcyMCspLiBFeGNlbEpTIHlhIHNlIGNhcmdhIG9uLWRlbWFuZCB2aWEgd2luZG93LmxvYWRFeGNlbEpTLlxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRYbHN4KGZpbGVuYW1lLCBzaGVldHMsIG9wdHMpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCB3aW5kb3cubG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdObyBzZSBwdWRvIGNhcmdhciBFeGNlbEpTOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgY29uc3QgSEVBREVSX0ZJTEwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYxNjY1MzQnIH0gfTtcbiAgY29uc3QgSEVBREVSX0ZPTlQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSwgc2l6ZTogMTIgfTtcbiAgY29uc3QgQ0VOVEVSID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICBjb25zdCBCT1JERVJfVEhJTiA9IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH07XG4gIGNvbnN0IEJPUkRFUiA9IHsgdG9wOiBCT1JERVJfVEhJTiwgbGVmdDogQk9SREVSX1RISU4sIGJvdHRvbTogQk9SREVSX1RISU4sIHJpZ2h0OiBCT1JERVJfVEhJTiB9O1xuICAvLyB2MTM2NDogY2VsbFN0eWxlciBvcGNpb25hbCBwYXJhIGNvbG9yZWFyIGNlbGRhcyBwb3IgdmFsb3IgKGVqLiBjb2x1bW5hXG4gIC8vIERpc3BvbmliaWxpZGFkIERJU1BPTklCTEUgdmVyZGUgLyBOTyBESVNQT05JQkxFIHJvam8gZW4gZWwgZXhwb3J0XG4gIC8vIExpc3RhIGRlIHByZWNpb3MpLiBTaWduYXR1cmU6IChjZWxsLCBjb2x1bW5OYW1lLCB2YWx1ZSwgcm93SW5kZXgpID0+IHZvaWQuXG4gIGNvbnN0IGNlbGxTdHlsZXIgPSBvcHRzICYmIHR5cGVvZiBvcHRzLmNlbGxTdHlsZXIgPT09ICdmdW5jdGlvbicgPyBvcHRzLmNlbGxTdHlsZXIgOiBudWxsO1xuXG4gIGZvciAoY29uc3QgcyBvZiBzaGVldHMpIHtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldChzLm5hbWUuc2xpY2UoMCwgMzEpKTtcbiAgICBjb25zdCByb3dzID0gcy5yb3dzLmxlbmd0aCA/IHMucm93cyA6IFt7IEF2aXNvOiAnU2luIGRhdG9zIHBhcmEgZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8nIH1dO1xuICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3Qua2V5cyhyb3dzWzBdKTtcblxuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmFkZFJvdyhoZWFkZXJzKTtcbiAgICBoZWFkZXJSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgIGNlbGwuZmlsbCA9IEhFQURFUl9GSUxMO1xuICAgICAgY2VsbC5mb250ID0gSEVBREVSX0ZPTlQ7XG4gICAgICBjZWxsLmFsaWdubWVudCA9IENFTlRFUjtcbiAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgIH0pO1xuICAgIGhlYWRlclJvdy5oZWlnaHQgPSAyNjtcblxuICAgIGZvciAobGV0IHJJZHggPSAwOyBySWR4IDwgcm93cy5sZW5ndGg7IHJJZHgrKykge1xuICAgICAgY29uc3Qgcm93ID0gcm93c1tySWR4XTtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IGhlYWRlcnMubWFwKChoKSA9PiAocm93W2hdICE9PSB1bmRlZmluZWQgJiYgcm93W2hdICE9PSBudWxsID8gcm93W2hdIDogJycpKTtcbiAgICAgIGNvbnN0IGRhdGFSb3cgPSB3cy5hZGRSb3codmFsdWVzKTtcbiAgICAgIGRhdGFSb3cuZWFjaENlbGwoKGNlbGwsIGNvbE51bWJlcikgPT4ge1xuICAgICAgICBjZWxsLmFsaWdubWVudCA9IENFTlRFUjtcbiAgICAgICAgY2VsbC5ib3JkZXIgPSBCT1JERVI7XG4gICAgICAgIGlmIChjZWxsU3R5bGVyKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNlbGxTdHlsZXIoY2VsbCwgaGVhZGVyc1tjb2xOdW1iZXIgLSAxXSwgdmFsdWVzW2NvbE51bWJlciAtIDFdLCBySWR4KTtcbiAgICAgICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAgICAgLy8gbm8tb3A6IG5vIHJvbXBlciBlbCBleHBvcnQgcG9yIHVuIGVycm9yIGRlIHN0eWxlclxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaGVhZGVycy5mb3JFYWNoKChoLCBpKSA9PiB7XG4gICAgICBsZXQgbWF4TGVuID0gU3RyaW5nKGgpLmxlbmd0aDtcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgdiA9IFN0cmluZyhyb3dbaF0gPT09IHVuZGVmaW5lZCB8fCByb3dbaF0gPT09IG51bGwgPyAnJyA6IHJvd1toXSkuc3BsaXQoJ1xcbicpWzBdO1xuICAgICAgICBpZiAodi5sZW5ndGggPiBtYXhMZW4pIG1heExlbiA9IHYubGVuZ3RoO1xuICAgICAgfVxuICAgICAgd3MuZ2V0Q29sdW1uKGkgKyAxKS53aWR0aCA9IE1hdGgubWluKDYwLCBNYXRoLm1heCgxMCwgbWF4TGVuICsgNCkpO1xuICAgIH0pO1xuXG4gICAgd3Mudmlld3MgPSBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XTtcbiAgfVxuXG4gIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XG4gICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgfSk7XG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIGEuaHJlZiA9IHVybDtcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICBhLmNsaWNrKCk7XG4gIGEucmVtb3ZlKCk7XG4gIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWRU5UQVM6IHBlZGlkb3MgY29uZmlybWFkb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmVudGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHBlZGlkb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBwID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHAueWVhciwgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KHAubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBjb25zdCBsaW5lcyA9IHAubGluZXMgfHwgW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCB2ZW5kb3JLZXkgPSBwLnZlbmRvciB8fCBsb29rdXBWZW5kb3JGb3JDbGllbnQocC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpIHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvckluZm8gPSB2ZW5kb3JMb29rdXBbdmVuZG9yS2V5XSB8fCB7fTtcbiAgICBjb25zdCBmYWN0b3IgPSB0eXBlb2YgcGVkaWRvRGlzY291bnRGYWN0b3IgPT09ICdmdW5jdGlvbicgPyBwZWRpZG9EaXNjb3VudEZhY3RvcihwKSA6IDE7XG4gICAgY29uc3QgZGlzY1BjdCA9IChwLmRpc2NvdW50U25hcHNob3QgJiYgcC5kaXNjb3VudFNuYXBzaG90LnBjdFRvdGFsKSB8fCAwO1xuICAgIGxpbmVzLmZvckVhY2goKGwpID0+IHtcbiAgICAgIGNvbnN0IHF0eSA9IHBhcnNlRmxvYXQobC5xdHkpIHx8IDA7XG4gICAgICBjb25zdCBwcmVjaW8gPSBwYXJzZUZsb2F0KGwucHJlY2lvKSB8fCAwO1xuICAgICAgY29uc3QgZ3Jvc3MgPSBxdHkgKiBwcmVjaW87XG4gICAgICBjb25zdCBuZXQgPSBncm9zcyAqIGZhY3RvcjtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgRmVjaGFfQ29uZmlybWFkbzogcC5jb25maXJtZWRBdCA/IFN0cmluZyhwLmNvbmZpcm1lZEF0KS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgICAgRXN0YWRvOiBwLnN0YWdlIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvcktleSB8fCAnJyksXG4gICAgICAgIFpvbmE6IHZlbmRvckluZm8uem9uZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENvZGlnb19TS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCAnJyxcbiAgICAgICAgQ2F0ZWdvcmlhOiBsLmNhdCB8fCAnJyxcbiAgICAgICAgRmFtaWxpYTogbC5mYW0gfHwgJycsXG4gICAgICAgIFN1YmZhbWlsaWE6IGwuc3ViIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcbiAgICAgICAgLy8gU3VidG90YWxfQVJTID0gTkVUTyAoY29uIGRlc2N1ZW50byBhcGxpY2FkbykgLSBlcyBsbyBxdWUgY3VlbnRhXG4gICAgICAgIC8vIHBhcmEgZWwgdGFyZ2V0IGRlbCB2ZW5kZWRvci4gU3VidG90YWxfQnJ1dG9fQVJTIG11ZXN0cmEgZWwgdmFsb3JcbiAgICAgICAgLy8gZGUgbGlzdGEgc2luIGRlc2N1ZW50byBwYXJhIHRyYXphYmlsaWRhZC5cbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKG5ldCksXG4gICAgICAgIFN1YnRvdGFsX0JydXRvX0FSUzogTWF0aC5yb3VuZChncm9zcyksXG4gICAgICAgIERlc2N1ZW50b19QY3Q6IGRpc2NQY3QsXG4gICAgICAgIEVuX05vbWJyZV9EZV9WREU6IHAub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxuICAgICAgICBDYXJnYWRvX1BvcjogcC5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCBwLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1ZlbnRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnVmVudGFzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgVmVudGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuZnVuY3Rpb24gbG9va3VwVmVuZG9yRm9yQ2xpZW50KHByb3YsIGxvY05hbWUsIF9jbGllbnROYW1lKSB7XG4gIGlmICghcHJvdiB8fCAhbG9jTmFtZSkgcmV0dXJuICcnO1xuICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92ICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XG4gIHJldHVybiBwdCA/IHB0LnZlbmRvciB8fCAnJyA6ICcnO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZJU0lUQVM6IGRldGFsbGUgZGUgdmlzaXRhcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmlzaXRhcyArIENvbnRhY3Rvcy4uLicpO1xuICAvLyB2MTUzNDogZWwgdmVuZGVkb3IgY29uc3VsdGEgc29sbyBzdXMgdmlzaXRhcyAobGFzIHJlZ2xhcyBubyBsZSBkZWphblxuICAvLyBsaXN0YXIgdG9kYXMpOyBlbCBpbnRlcm5vIHZlIGxhcyBzdXlhcyArIGxhcyBkZSBzdXMgcGFyZWphcy5cbiAgY29uc3Qgc2NvcGUgPSBfZXhwb3J0U2NvcGUoKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgbGV0IHEgPSBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpO1xuICAgIGlmIChzY29wZS52aXNpdHNRdWVyeUJ5T3duZXJVaWQpIHtcbiAgICAgIGNvbnN0IHUgPSB3aW5kb3cuZmlyZWJhc2UgJiYgd2luZG93LmZpcmViYXNlLmF1dGggJiYgd2luZG93LmZpcmViYXNlLmF1dGgoKS5jdXJyZW50VXNlcjtcbiAgICAgIHEgPSBxLndoZXJlKCdvd25lclVpZCcsICc9PScsICh1ICYmIHUudWlkKSB8fCAnX19zaW5fdXN1YXJpb19fJyk7XG4gICAgfVxuICAgIHNuYXAgPSBhd2FpdCBxLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gdmlzaXRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YXJnZXRNZXMgPSBtb250aElkeCAhPT0gbnVsbCA/IE1FU0VTW21vbnRoSWR4XS50b1VwcGVyQ2FzZSgpIDogbnVsbDtcbiAgY29uc3QgYWxsID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHYgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAocGFyc2VJbnQodi5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAodGFyZ2V0TWVzICYmICh2Lm1lcyB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdGFyZ2V0TWVzKSByZXR1cm47XG4gICAgYWxsLnB1c2godik7XG4gIH0pO1xuICBjb25zdCBpdGVtcyA9IHNjb3BlLmZpbHRlclZpc2l0cyhhbGwpO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMgeSBDb250YWN0b3MnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnQW5pbycsIGtleTogJ2FuaW8nLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnSW50ZXJhY2Npb24nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnRm9ybWEgQ29udGFjdG8nLCBrZXk6ICdmb3JtYUNvbnRhY3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdSZXN1bHRhZG8gQ29udGFjdG8nLCBrZXk6ICdyZXN1bHRhZG9DdCcsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnUHJvdmluY2lhJywga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRmlkZWxpZGFkJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdOZWNlc2lkYWQgUHVudHVhbCcsIGtleTogJ25lYycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBWZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01hcyBQcmVndW50YW4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnQXl1ZGEgVGllbmRhJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gVmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgTW9zdHJhZG9yJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BvbmQgRWNvbW1lcmNlJywga2V5OiAncEVjb20nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBTdGF0dXMnLCBrZXk6ICdncHNTdCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnR1BTIERpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFbiBub21icmUgZGUgVkRFJywga2V5OiAnb25CZWhhbGYnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NhcmdhZG8gUG9yJywga2V5OiAnY3JlYXRlZEJ5Jywgd2lkdGg6IDI0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcbiAgY29uc3QgUk9XX0ggPSAxMDA7XG4gIGNvbnN0IElNR19XID0gMTMwO1xuICBjb25zdCBJTUdfSCA9IDkwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XG4gICAgaWYgKGlzQ29udGFjdG8pIHtcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcbiAgICB9XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcbiAgICAgIGFuaW86IHYuYW5pbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcbiAgICAgIGZvcm1hQ29udGFjdG86IGZvcm1hQ29udGFjdG9MYmwsXG4gICAgICByZXN1bHRhZG9DdDogcmVzdWx0YWRvQ3RMYmwsXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgbmVjOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxuICAgICAgZ3BzU3Q6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdi5ncHNEaXN0YW5jZU0gIT0gbnVsbCA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXG4gICAgICBvbkJlaGFsZjogdi5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICBjcmVhdGVkQnk6IHYuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgdi5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXG4gICAgeyBoZWFkZXI6ICdPd25lciBFbWFpbCcsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdDb25jZXB0bycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdOIFRpY2tldCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnTW9kbyBwYWdvJywga2V5OiAnbW9kb1BhZ28nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gZ2FzdG8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0RpdmlzaW9uJywga2V5OiAnZGl2aXNpb24nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNb25lZGEnLCBrZXk6ICdtb25lZGEnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ltcG9ydGUgVVNEJywga2V5OiAnaW1wb3J0ZVVzZCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnT2JzZXJ2YWNpb25lcycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnRm90byB0aWNrZXQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFc3RhZG8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvcicsIGtleTogJ2Fwcm9iYWRvcicsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQXByb2JhZG8gZW4nLCBrZXk6ICdhcHJvYmFkb0VuJywgd2lkdGg6IDE0IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcbiAgY29uc3QgUk9XX0ggPSAxMTA7XG4gIGNvbnN0IElNR19XID0gMTQwO1xuICBjb25zdCBJTUdfSCA9IDEwMDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgciA9IGl0LnI7XG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XG4gICAgY29uc3Qgb2JzU3RyID1cbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBlbWFpbDogci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxuICAgICAgbW9kb1BhZ286IHIubW9kb1BhZ28gfHwgJycsXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxuICAgICAgZGl2aXNpb246IHIuZGl2aXNpb25HYXN0byB8fCAnJyxcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXG4gICAgICBtb25lZGE6IHIubW9uZWRhIHx8ICdQRVNPUycsXG4gICAgICBpbXBvcnRlVXNkOiByLmltcG9ydGVVc2QgIT0gbnVsbCAmJiByLmltcG9ydGVVc2QgIT09IDAgPyByLmltcG9ydGVVc2QgOiAnJyxcbiAgICAgIG9iczogb2JzU3RyLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcbiAgICAgIGFwcm9iYWRvcjogci5hcHByb3ZlckVtYWlsIHx8IHIuYXByb2JhZG9yIHx8ICcnLFxuICAgICAgYXByb2JhZG9FbjpcbiAgICAgICAgci5hcHByb3ZlZEF0ICYmIHIuYXBwcm92ZWRBdC50b0RhdGUgPyByLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBTSUVNUFJFIGVtYmViZXIgbGEgZm90byAobm8gZGVqYXIgaHlwZXJsaW5rKS5cbiAgICAvLyBBbnRlczogc2kgZm90b1RpY2tldFVybCAoU3RvcmFnZSksIHF1ZWRhYmEgY29tbyBoeXBlcmxpbmsgQWJyaXIgdGlja2V0LlxuICAgIC8vIEFob3JhOiBmZXRjaCBkZWwgVVJMICsgY29udmVydGlyIGEgYXJyYXlCdWZmZXIgKyBlbWJlYmVyIGlndWFsIHF1ZSBkYXRhVVJMLlxuICAgIC8vIEZhbGxiYWNrIGEgaHlwZXJsaW5rIHNvbG8gc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCwgZXRjKS5cbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBmZXRjaCBsYSBmb3RvIGRlc2RlIFN0b3JhZ2UgeSBlbWJlYmVybGEgY29tbyBpbWFnZW4uXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2goci5mb3RvVGlja2V0VXJsKTtcbiAgICAgICAgaWYgKCFyZXNwLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHJlc3Auc3RhdHVzKTtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwLmhlYWRlcnMuZ2V0KCdjb250ZW50LXR5cGUnKSB8fCAnaW1hZ2UvanBlZyc7XG4gICAgICAgIGxldCBleHQgPSBjb250ZW50VHlwZS5zcGxpdCgnLycpWzFdIHx8ICdqcGVnJztcbiAgICAgICAgZXh0ID0gZXh0LnNwbGl0KCc7JylbMF0udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHJlc3AuYXJyYXlCdWZmZXIoKTtcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYnVmZmVyOiBidWYsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBGYWxsYmFjazogc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCksIGRlamFyIGh5cGVybGluayBjb21vIGFudGVzLlxuICAgICAgICBjb25zb2xlLndhcm4oJ2ZldGNoIGZvdG8gcmVuZGljaW9uIGZhbGxvLCBkZWpvIGh5cGVybGluaycsIGl0LmlkLCBlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XG4gICAgICAgICAgY2VsbC52YWx1ZSA9IHtcbiAgICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxuICAgICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXG4gICAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXIgKGZldGNoIGZhbGxvKScsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XG4gICAgICAgIH0gY2F0Y2ggKF9lMikge31cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUlVUQVM6IHJ1dGFzIGFzaWduYWRhcyBkZWwgcGVyaW9kbyArIG92ZXJyaWRlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPVxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXG4gICAgICA6IGFzc2lnbmVkVmVuZG9yXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxuICAgICAgICA6IFtdO1xuICBjb25zdCBtb250aHNUb0V4cG9ydCA9IG1vbnRoSWR4ICE9PSBudWxsID8gW21vbnRoSWR4XSA6IFswLCAxLCAyLCAzLCA0LCA1LCA2LCA3LCA4LCA5LCAxMCwgMTFdO1xuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2YgbW9udGhzVG9FeHBvcnQpIHtcbiAgICAgIGxldCBydXRhcztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgcnV0YXMgPSBbXTtcbiAgICAgIH1cbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPdmVycmlkZXNcbiAgbGV0IG92clNuYXA7XG4gIHRyeSB7XG4gICAgb3ZyU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm91dGVfb3ZlcnJpZGVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgb3ZyU25hcCA9IG51bGw7XG4gIH1cbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xuICBpZiAob3ZyU25hcCkge1xuICAgIG92clNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxuICAgICAgICBNZXM6IE1FU0VTW3BhcnNlSW50KG8ubW9udGhJZHgsIDEwKV0gfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBvLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcbiAgICAgICAgRGVyaXZhZGFfQTogby5kZXJpdmFkYUEgfHwgJycsXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX1Bvcjogby5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX0VuOlxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1J1dGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcbiAgICB7IG5hbWU6ICdEZXJpdmFjaW9uZXMtUmVhZ2VuZGFzJywgcm93czogb3ZlcnJpZGVzUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBSdXRhcyBsaXN0byAoJyArIHJ1dGFzUm93cy5sZW5ndGggKyAnIHRpZW5kYXMsICcgKyBvdmVycmlkZXNSb3dzLmxlbmd0aCArICcgb3ZlcnJpZGVzKScsXG4gICAgMjQwMFxuICApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFMVEFTOiBzb2xpY2l0dWRlcyBkZSBhbHRhIGRlIGNsaWVudGUgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSAnJztcbiAgICBpZiAoYS5jcmVhdGVkQXQgJiYgYS5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXG4gICAgICBBcHJvYmFkb19FbjpcbiAgICAgICAgYS5hcHByb3ZlZEF0ICYmIGEuYXBwcm92ZWRBdC50b0RhdGUgPyBhLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEFsdGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIHNvbGljaXR1ZGVzKScsIDI0MDApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHY3MDkgKDIwMjYtMDgtMjgpOiAzIGV4cG9ydHMgbnVldm9zIHBlZGlkb3MgcG9yIE1hcmlhbm8uXG4vLyAtIEJBQ0tPUkRFUjogbGluZWFzIHN0YXRlPUJPIG9wZW4gcG9yIG1lcyBkZSBjcmVhdGVkQXQgZGVsIHBlZGlkby5cbi8vIC0gU1RPQ0tfQVNJRzogbGluZWFzIEFTSUcgb3BlbiAobyBCTytzdG9jayBkaXNwKSBwb3IgbWVzIGRlIGNyZWF0ZWRBdC5cbi8vIC0gUEVESURPU19NRVM6IFRPRE9TIGxvcyBwZWRpZG9zIGNyZWFkb3MgZW4gZWwgbWVzL2FuaW8gKGN1YWxxdWllciBzdGFnZSkuXG4vLyBGdWVudGU6IGdsb2JhbFBlZGlkb3MgKGxvIHF1ZSBsYSBhcHAgeWEgdGllbmUgZW4gbWVtb3JpYSkuXG4vLyBGaWx0ZXIgbWVzL2FcdTAwRjFvOiBzb2JyZSBjcmVhdGVkQXQgZGVsIHBlZGlkby4gbW9udGhJZHg9bnVsbCAtPiBhXHUwMEYxbyBlbnRlcm8uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmZ1bmN0aW9uIF9wZWRpZG9Nb250aFllYXIocCkge1xuICBjb25zdCBjYSA9IHAuY3JlYXRlZEF0O1xuICBpZiAoIWNhKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIGxldCBkdCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY2EgPT09ICdzdHJpbmcnKSBkdCA9IG5ldyBEYXRlKGNhKTtcbiAgZWxzZSBpZiAodHlwZW9mIGNhLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICBkdCA9IGNhLnRvRGF0ZSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGVsc2UgaWYgKHR5cGVvZiBjYSA9PT0gJ251bWJlcicpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBpZiAoIWR0IHx8IE51bWJlci5pc05hTihkdC5nZXRUaW1lKCkpKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIHJldHVybiB7IHk6IGR0LmdldEZ1bGxZZWFyKCksIG06IGR0LmdldE1vbnRoKCkgfTtcbn1cblxuZnVuY3Rpb24gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4LCBzY29wZSkge1xuICBjb25zdCBhcnIgPVxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xuICAvLyB2MTUzNDogYWxjYW5jZSBwb3Igcm9sICh2ZW5kZWRvciA9IGNsaWVudGVzIGRlIHN1IG1hc3RlcjsgaW50ZXJubyA9IHBhcmVqYXMpLlxuICBjb25zdCBzYyA9IHNjb3BlIHx8IF9leHBvcnRTY29wZSgpO1xuICByZXR1cm4gc2MuZmlsdGVyUGVkaWRvcyhhcnIpLmZpbHRlcigocCkgPT4ge1xuICAgIGlmICghcCkgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IHsgeSwgbSB9ID0gX3BlZGlkb01vbnRoWWVhcihwKTtcbiAgICBpZiAoeSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHkgIT09IGFuaW8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgbSAhPT0gbW9udGhJZHgpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlci4uLicpO1xuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8uIEZpbHRyYSBwb3IgbWVzIHZcdTAwRURhIGZpbHRlcnMubWVzWVlZWU1NXG4gIC8vIChxdWUgZWwgbVx1MDBGM2R1bG8gYXBsaWNhIHNvYnJlIGNvbmZpcm1lZEF0KS4gQ29pbmNpZGUgY29uIGVsIG1vZGFsLlxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IG1lc1lZWVlNTSA9IGFuaW8gKyAnLScgKyBTdHJpbmcobW9udGhJZHggKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgLy8gdjExMDEgKDIwMjYtMDktMzApOiBidXNjYXIgcHJpbWVybyBwb3Igc2FwQ2FyZENvZGUgKFx1MDBGQW5pY28sIG5vIGRlcGVuZGUgZGVcbiAgLy8gbm9ybWFsaXphY2lcdTAwRjNuIGRlIHN0cmluZ3MpIHkgc1x1MDBGM2xvIGNhZXIgYWwgY2xpZW50TG9jSWQgY29tbyBcdTAwRkFsdGltbyByZWN1cnNvLlxuICAvLyBWZXIgY29tZW50YXJpbyBleHRlbmRpZG8gZW4gaW5kZXguaHRtbDpleHBvcnRCYWNrb3JkZXJzVG9FeGNlbC5cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlID0gdy5jbGllbnRNYXN0ZXJDYWNoZTtcbiAgICAgIGlmICghY2FjaGUpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNjID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmIChjYyAmJiB0eXBlb2YgY2FjaGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBsZXQgZm91bmQgPSAnJztcbiAgICAgICAgY2FjaGUuZm9yRWFjaCgoY21EYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm47XG4gICAgICAgICAgaWYgKGNtRGF0YSAmJiBTdHJpbmcoY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCkgPT09IGNjICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikge1xuICAgICAgICAgICAgZm91bmQgPSBjbURhdGEuYXNzaWduZWRWZW5kb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIGNhY2hlLmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICAgIGNvbnN0IGNtRGF0YSA9IGNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgcGVkaWRvcyxcbiAgICAgICAgJ3VyZ2VudGUnLFxuICAgICAgICB7IG1lc1lZWVlNTSB9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxbyA9IGMucXR5QmFja29yZGVyIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgY2FudGlkYWRQZWRpZGEgPSBxbztcbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgICAgY2FudGlkYWRQZWRpZGEgPSBOdW1iZXIocC5saW5lc1tpZHhdLnF0eSkgfHwgcW87XG4gICAgICAgIGxpbmVhSWR4ID0gaWR4O1xuICAgICAgfVxuICAgIH1cbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9QZWRpZGE6IGNhbnRpZGFkUGVkaWRhLFxuICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcbiAgICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZChxbyAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl8nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQmFja29yZGVyJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8uLi4nKTtcbiAgLy8gdjExMDA6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvIG1vZG8gYXNpZ25hY2lvbi4gQ29pbmNpZGUgY29uIGVsIG1vZGFsLlxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IG1lc1lZWVlNTSA9IGFuaW8gKyAnLScgKyBTdHJpbmcobW9udGhJZHggKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgLy8gdjExMDEgKDIwMjYtMDktMzApOiBidXNjYXIgcHJpbWVybyBwb3Igc2FwQ2FyZENvZGUgKFx1MDBGQW5pY28sIG5vIGRlcGVuZGUgZGVcbiAgLy8gbm9ybWFsaXphY2lcdTAwRjNuIGRlIHN0cmluZ3MpIHkgc1x1MDBGM2xvIGNhZXIgYWwgY2xpZW50TG9jSWQgY29tbyBcdTAwRkFsdGltbyByZWN1cnNvLlxuICAvLyBWZXIgY29tZW50YXJpbyBleHRlbmRpZG8gZW4gaW5kZXguaHRtbDpleHBvcnRCYWNrb3JkZXJzVG9FeGNlbC5cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlID0gdy5jbGllbnRNYXN0ZXJDYWNoZTtcbiAgICAgIGlmICghY2FjaGUpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNjID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmIChjYyAmJiB0eXBlb2YgY2FjaGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBsZXQgZm91bmQgPSAnJztcbiAgICAgICAgY2FjaGUuZm9yRWFjaCgoY21EYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm47XG4gICAgICAgICAgaWYgKGNtRGF0YSAmJiBTdHJpbmcoY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCkgPT09IGNjICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikge1xuICAgICAgICAgICAgZm91bmQgPSBjbURhdGEuYXNzaWduZWRWZW5kb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIGNhY2hlLmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICAgIGNvbnN0IGNtRGF0YSA9IGNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgcGVkaWRvcyxcbiAgICAgICAgJ2FzaWduYWNpb24nLFxuICAgICAgICB7IG1lc1lZWVlNTSB9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxdHkgPSBjLnF0eUFzaWduYWRhIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xuICAgIH1cbiAgICBsZXQgZXN0YWRvUmVhbCA9ICdBU0lHJztcbiAgICBpZiAoYy5zdGF0ZSA9PT0gJ0JPJykgZXN0YWRvUmVhbCA9ICdCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRyknO1xuICAgIGVsc2UgaWYgKGMuc3RhdGUgPT09ICdjb25maXJtZWQnKSBlc3RhZG9SZWFsID0gJ2NvbmZpcm1lZCAoU1EgZW4gU0FQKSc7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXG4gICAgICBNZXM6IChwICYmIHAubW9udGgpIHx8ICcnLFxuICAgICAgQ2xpZW50ZTogYy5ub21icmUgfHwgJycsXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBjLnByb3ZpbmNpYSB8fCAocCAmJiBwLnByb3ZpbmNlKSB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYy5jaXVkYWQgfHwgKHAgJiYgcC5sb2NOYW1lKSB8fCAnJyxcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcbiAgICAgIFNLVTogcmwuc2t1IHx8ICcnLFxuICAgICAgUHJvZHVjdG86IHJsLnByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ2FudGlkYWRfUmVzZXJ2YWRhOiBxdHksXG4gICAgICBFc3RhZG9fUmVhbDogZXN0YWRvUmVhbCxcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcbiAgICAgIFN1YnRvdGFsX1Jlc2VydmFkb19BUlM6IE1hdGgucm91bmQocXR5ICogKGMucHJlY2lvIHx8IDApKSxcbiAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXG4gICAgfSk7XG4gIH0pO1xuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG4vLyB2NzM3ICgyMDI2LTA4LTMwKTogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG9zIGxvcyBiYWNrb3JkZXJzIG9wZW4gKHNpbiBmaWx0cm9cbi8vIGRlIG1lcykuIE1vdGl2bzogbG9zIDYyIHBlZGlkb3MgbWlncmFkb3MgZGVzZGUgU0FQIGVsIDIwMjYtMDgtMjggdGllbmVuXG4vLyBjcmVhdGVkQXQgZGUgZmVjaGFzIHZpZWphcyBkZWwgU0FQIFNRIG9yaWdpbmFsLCBlbnRvbmNlcyBlbCBleHBvcnQgcG9yIG1lc1xuLy8gbm8gbG9zIGluY2x1aWEuIFZlcnNpb24gXCJjdXJyZW50IHN0YXR1c1wiIHF1ZSBpdGVyYSBnbG9iYWxQZWRpZG9zIGNvbXBsZXRvLlxud2luZG93LmV4cG9ydEJhY2tvcmRlckFsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XG4gIC8vIHYxNDg4IFx1MDBBNzg2ICgyMDI2LTEwLTI3IEJVRyBGSVgpOiB1c2FyIGxhIE1JU01BIHB1cmUgZm4gcXVlIGVsIG1vZGFsIGV4cG9ydFxuICAvLyAoYGNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzYCkuIEFudGVzIHYxNDg4OiBwYW5lbCB1c2FiYVxuICAvLyBgY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzKHt9KWAgc2luIGBpbmNsdWRlRXhwaXJlZGAgXHUyMTkyIG9jdWx0YWJhIEJPcyA+IDkwZC5cbiAgLy8gTW9kYWwgdXNhYmEgYGNvbXB1dGVCYWNrb3JkZXJTa3VNYXAoLi4uLCB7aW5jbHVkZUV4cGlyZWQ6dHJ1ZX0pYCBcdTIxOTIgbG9zXG4gIC8vIGluY2x1XHUwMEVEYS4gRGVsdGEgbWVkaWRvIGVuIHByb2Q6IDIyMiB1bmlkYWRlcyAobW9kYWwgNzY5NiB2cyBwYW5lbCA3NDc0KS5cbiAgLy8gRml4OiBwdXJlIGZuIFx1MDBGQW5pY2EgY29uIGRlZmF1bHQgYGluY2x1ZGVFeHBpcmVkPXRydWVgIChhbGluZWFkbyBjb24gXHUwMEE3NDAuMVxuICAvLyB5IGdldFN0b2NrQnJlYWtkb3duLmJhY2tvcmRlckFwcC50b3RhbCBcdTIwMTQgbGEgY29sYSBjb21wbGV0YSkuXG4gIC8vIHYxNTM0OiBhbGNhbmNlIHBvciByb2wgKHZlbmRlZG9yID0gY2xpZW50ZXMgZGUgc3UgbWFzdGVyOyBpbnRlcm5vID0gcGFyZWphcykuXG4gIGNvbnN0IGFyciA9IF9leHBvcnRTY29wZSgpLmZpbHRlclBlZGlkb3MoXG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW11cbiAgKTtcbiAgY29uc3QgdG90YWxQZWRpZG9zT3BlbiA9IGFyci5maWx0ZXIoKHApID0+IHAgJiYgIXAuY2xvc2VkQXQpLmxlbmd0aDtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgIT09ICdmdW5jdGlvbicgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICBjb25zdCBjbURhdGEgPSB3LmNsaWVudE1hc3RlckNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogcHVyZSBmbiBcdTAwRkFuaWNhIGBjb21wdXRlQmFja29yZGVyRXhwb3J0Um93c2AgKHJlZW1wbGF6YSBlbFxuICAvLyBwYXRoIGhpc3RcdTAwRjNyaWNvIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXNgIHF1ZSBubyBjb25zb2xpZGFiYSB5IHBlcmRcdTAwRURhXG4gIC8vIEJPcyA+IDkwZCkuIFBhbmVsIHBhc2EgYHt9YCBcdTIxOTIgdHJhZSB0b2RhIGxhIGNvbGEgc2luIGZpbHRyb3MgbWFudWFsZXMuXG4gIGNvbnN0IF9leHBvcnRGbiA9XG4gICAgdy5fX3BoYXNlMCAmJlxuICAgIHcuX19waGFzZTAucHVyZSAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0LmNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzO1xuICBjb25zdCBkZXBzID0ge1xuICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICBjYW5vblZlbmRvcjpcbiAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9leHBvcnRSZXN1bHQgPSBfZXhwb3J0Rm5cbiAgICA/IF9leHBvcnRGbihhcnIsIHt9LCBkZXBzKVxuICAgIDogeyByb3dzOiBbXSwgdG90YWxVbmlkYWRlczogMCwgdG90YWxGaWxhczogMCwgZmlsdHJvc0FwbGljYWRvczoge30gfTtcbiAgY29uc3Qgcm93cyA9IF9leHBvcnRSZXN1bHQucm93cztcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoXG4gICAgICAnRXhwb3J0IEJhY2tvcmRlciB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlCYWNrb3JkZXI+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IGJhY2tvcmRlciBhYmllcnRvIGFob3JhIG1pc21vICh0b2RvIGNvbmZpcm1lZCwgY2VycmFkbyBvIHZlbmNpZG8pXFxuJyArXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcbiAgICAgICAgJzMuIFRvZGFzIGxhcyBsaW5lYXMgQk8gdGllbmVuIHN0b2NrIGRpc3BvbmlibGUgKGZ1ZXJvbiBwcm9tb3ZpZGFzIGEgQVNJRyB2aXJ0dWFsKSdcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICAvLyB2MTM2NiAoMjAyNi0xMC0xOSk6IGhvamEgXCJSZXN1bWVuXCIgY29uIGxvcyBNSVNNT1MgdG90YWxlcyBxdWUgZWwgbW9kYWxcbiAgLy8gQmFja29yZGVyIChjb21wdXRlQmFja29yZGVyU2t1TWFwIHBvc3QtY29uc29saWRhY2lvbiBwb3IgY2xpZW50ZSkuIEFudGVzXG4gIC8vIGVsIGV4cG9ydCBkdW1wZWFiYSBsaW5lYXMgY3J1ZGFzIHNpbiBuaW5ndW4gdG90YWwgXHUyMTkyIE1hcmlhbm8gc3VtYWJhIGxhXG4gIC8vIGNvbHVtbmEgU3VidG90YWxfQk9fQVJTIHkgZWwgdmFsb3IgcG9kaWEgZGl2ZXJnZXIgZGVsIG1vZGFsIGN1YW5kbyB1blxuICAvLyBjbGllbnRlIHRlbmlhIHZhcmlhcyBsaW5lYXMgQk8gZGVsIG1pc21vIFNLVSBjb24gcHJlY2lvcyBkaXN0aW50b3MgKGVsXG4gIC8vIG1vZGFsIGNvbnNvbGlkYSB1c2FuZG8gZWwgcHJlY2lvIGRlIGxhIDFyYSBsaW5lYSBwcm9jZXNhZGE7IGVsIGV4cG9ydFxuICAvLyB1c2EgZWwgcHJlY2lvIGRlIGNhZGEgbGluZWEgaW5kaXZpZHVhbCkuXG4gIGNvbnN0IF9jb21wdXRlU2t1TWFwRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclNrdU1hcDtcbiAgY29uc3QgX21vZGFsRGVwcyA9IHtcbiAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgY2Fub25WZW5kb3I6XG4gICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgYmFja29yZGVyTGluZXM6IEFycmF5LmlzQXJyYXkody5iYWNrb3JkZXJMaW5lcykgPyB3LmJhY2tvcmRlckxpbmVzIDogW10sXG4gICAgc2FwR2V0Q2xpZW50ZUNvZGU6IHR5cGVvZiB3LnNhcEdldENsaWVudGVDb2RlID09PSAnZnVuY3Rpb24nID8gdy5zYXBHZXRDbGllbnRlQ29kZSA6IHVuZGVmaW5lZCxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9tb2RhbEZpbHRlcnMgPSB7XG4gICAgdGllbmRhUXVlcnk6ICcnLFxuICAgIHZlbmRvcktleTogJycsXG4gICAgbWVzWVlZWU1NOiAnJyxcbiAgICB1cmdlbmN5RmlsdGVyOiAnJyxcbiAgICBpbmNsdWRlRXhwaXJlZDogdHJ1ZSxcbiAgICBhZ2dyZWdhdGlvbk1vZGU6ICdmaWZvJyxcbiAgfTtcbiAgY29uc3QgX21vZGFsUmVzdWx0ID0gX2NvbXB1dGVTa3VNYXBGblxuICAgID8gX2NvbXB1dGVTa3VNYXBGbihhcnIsICd1cmdlbnRlJywgX21vZGFsRmlsdGVycywgX21vZGFsRGVwcylcbiAgICA6IHsgc2t1czogW10sIHRvdGFsVW5pZGFkZXM6IDAsIHRvdGFsQ2xpZW50ZXM6IDAgfTtcbiAgbGV0IHRvdGFsUGVzb3NNb2RhbCA9IDA7XG4gIGNvbnN0IHN1YnRvdGFsZXNQb3JVcmdlbmN5ID0geyB1cmdlbnRlOiAwLCBwYXJjaWFsOiAwIH07XG4gIGZvciAoY29uc3QgZyBvZiBfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkge1xuICAgIGNvbnN0IHVyZyA9IGcudXJnZW5jeSB8fCAndXJnZW50ZSc7XG4gICAgZm9yIChjb25zdCBjIG9mIGcuY2xpZW50ZXMgfHwgW10pIHtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihjLnF0eUJhY2tvcmRlcikgfHwgMDtcbiAgICAgIGlmIChxdHkgPD0gMCkgY29udGludWU7XG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIoYy5wcmVjaW8pIHx8IDA7XG4gICAgICBjb25zdCBzdWIgPSBxdHkgKiBwcmVjaW87XG4gICAgICB0b3RhbFBlc29zTW9kYWwgKz0gc3ViO1xuICAgICAgaWYgKHVyZyA9PT0gJ3BhcmNpYWwnKSBzdWJ0b3RhbGVzUG9yVXJnZW5jeS5wYXJjaWFsICs9IHN1YjtcbiAgICAgIGVsc2Ugc3VidG90YWxlc1BvclVyZ2VuY3kudXJnZW50ZSArPSBzdWI7XG4gICAgfVxuICB9XG4gIGNvbnN0IHRvdGFsVW5pZGFkZXNNb2RhbCA9IF9leHBvcnRSZXN1bHQudG90YWxVbmlkYWRlcyB8fCBfbW9kYWxSZXN1bHQudG90YWxVbmlkYWRlcyB8fCAwO1xuICBjb25zdCB0b3RhbENsaWVudGVzTW9kYWwgPSBfbW9kYWxSZXN1bHQudG90YWxDbGllbnRlcyB8fCAwO1xuICBjb25zdCB0b3RhbFNrdXNNb2RhbCA9IChfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkubGVuZ3RoO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogZmlsYSBkZSBlbmNhYmV6YWRvIFwiRmlsdHJvcyBhcGxpY2Fkb3NcIiBwYXJhIHRyYW5zcGFyZW5jaWEuXG4gIGNvbnN0IF9mbXRGaWx0cm9zID1cbiAgICB3Ll9fcGhhc2UwICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydCAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQuZm9ybWF0QmFja29yZGVyRmlsdHJvc0hlYWRlcjtcbiAgY29uc3QgZmlsdHJvc0xibCA9IF9mbXRGaWx0cm9zID8gX2ZtdEZpbHRyb3MoX2V4cG9ydFJlc3VsdC5maWx0cm9zQXBsaWNhZG9zKSA6ICdGaWx0cm9zOiBuaW5ndW5vJztcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXG4gICAgeyBNZXRyaWNhOiBmaWx0cm9zTGJsLCBWYWxvcjogJycgfSxcbiAgICB7IE1ldHJpY2E6ICdUT1RBTCBCYWNrb3JkZXIgQVJTJywgVmFsb3I6IE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1NLVXMgY29uIGJhY2tvcmRlcicsIFZhbG9yOiB0b3RhbFNrdXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1VuaWRhZGVzIHBlbmRpZW50ZXMnLCBWYWxvcjogTWF0aC5yb3VuZCh0b3RhbFVuaWRhZGVzTW9kYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnUGFyZXMgY2xpZW50ZStTS1UgKGZpbGFzIGVuIGhvamEgQmFja29yZGVyKScsIFZhbG9yOiByb3dzLmxlbmd0aCB9LFxuICAgIHsgTWV0cmljYTogJ0NsaWVudGVzIGFmZWN0YWRvcycsIFZhbG9yOiB0b3RhbENsaWVudGVzTW9kYWwgfSxcbiAgICB7IE1ldHJpY2E6ICdcdTIwMTQgU3VidG90YWwgU0lOIFJFUE9TSUNJT04nLCBWYWxvcjogTWF0aC5yb3VuZChzdWJ0b3RhbGVzUG9yVXJnZW5jeS51cmdlbnRlKSB9LFxuICAgIHsgTWV0cmljYTogJ1x1MjAxNCBTdWJ0b3RhbCBQQVJDSUFMJywgVmFsb3I6IE1hdGgucm91bmQoc3VidG90YWxlc1BvclVyZ2VuY3kucGFyY2lhbCkgfSxcbiAgICB7IE1ldHJpY2E6ICdTbmFwc2hvdCBnZW5lcmFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXG4gIF07XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBmaWxhIFRPVEFMIGFsaW5lYWRhIGNvbiBlbCBudWV2byBzaGFwZSAoc2luIGNvbHVtbmFzIGxlZ2FjeVxuICAvLyBGZWNoYV9QZWRpZG8gLyBNZXMgLyBDYW50aWRhZF9QZWRpZGEgLyBQZWRpZG9fSUQgLyBMaW5lYV9JZHggLyBldGMuKS5cbiAgLy8gTGFzIG51ZXZhcyBjb2x1bW5hcyAoZGUgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3MpOiBTS1UsIFByb2R1Y3RvLFxuICAvLyBDbGllbnRlLCBDYXJkQ29kZSwgUHJvdmluY2lhLCBMb2NhbGlkYWQsIFZlbmRlZG9yLCBDYW50aWRhZF9QZW5kaWVudGVfQk8sXG4gIC8vIFByZWNpb19Vbml0X0FSUywgU3VidG90YWxfQk9fQVJTLCBFZGFkX0JPX2RpYXMsIEVzdGFkbywgUGVkaWRvcy5cbiAgY29uc3QgdG90YWxSb3cgPSB7XG4gICAgU0tVOiAnJyxcbiAgICBQcm9kdWN0bzogJycsXG4gICAgQ2xpZW50ZTogJ1RPVEFMJyxcbiAgICBDYXJkQ29kZTogJycsXG4gICAgUHJvdmluY2lhOiAnJyxcbiAgICBMb2NhbGlkYWQ6ICcnLFxuICAgIFZlbmRlZG9yOiAnJyxcbiAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IE1hdGgucm91bmQodG90YWxVbmlkYWRlc01vZGFsKSxcbiAgICBQcmVjaW9fVW5pdF9BUlM6ICcnLFxuICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpLFxuICAgIEVkYWRfQk9fZGlhczogJycsXG4gICAgRXN0YWRvOiAnJyxcbiAgICBQZWRpZG9zOiAnJyxcbiAgfTtcbiAgcm93cy5wdXNoKHRvdGFsUm93KTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl9TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goXG4gICAgZm5hbWUsXG4gICAgW1xuICAgICAgeyBuYW1lOiAnUmVzdW1lbicsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgICB7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH0sXG4gICAgXSxcbiAgICB7XG4gICAgICAvLyBQaW50YXIgbGEgZmlsYSBUT1RBTCBkZSBsYSBob2phIEJhY2tvcmRlciArIGZpbGEgMSAoVE9UQUwpIGRlIFJlc3VtZW4uXG4gICAgICBjZWxsU3R5bGVyOiAoY2VsbCwgY29sdW1uTmFtZSwgX3ZhbHVlLCByb3dJbmRleCkgPT4ge1xuICAgICAgICAvLyBIb2phIFJlc3VtZW46IGZpbGEgVE9UQUwgPSByb3dJbmRleCAwIChwcmltZXJhIGRhdGEgcm93IHBvc3QgaGVhZGVyKS5cbiAgICAgICAgLy8gSG9qYSBCYWNrb3JkZXI6IGZpbGEgVE9UQUwgPSB1bHRpbWEgcm93IChyb3dJbmRleCA9PT0gcm93cy5sZW5ndGggLSAxKS5cbiAgICAgICAgLy8gTm8gdGVuZW1vcyBhY2Nlc28gYWwgbm9tYnJlIGRlIGxhIGhvamEgZW4gZWwgc3R5bGVyLCBwZXJvIHBpbnRhbW9zXG4gICAgICAgIC8vIHBvciBjZWxkYTogc2kgY29sdW1uTmFtZT09J01ldHJpY2EnIHkgZXMgJ1RPVEFMIEJhY2tvcmRlciBBUlMuLi4nLFxuICAgICAgICAvLyBvIHNpIGNvbHVtbk5hbWU9PSdDbGllbnRlJyB5IGVsIHZhbG9yIGluY2x1eWUgJ1RPVEFMJy5cbiAgICAgICAgY29uc3QgdHh0ID0gU3RyaW5nKGNlbGwudmFsdWUgfHwgJycpO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgKGNvbHVtbk5hbWUgPT09ICdNZXRyaWNhJyAmJiB0eHQuaW5jbHVkZXMoJ1RPVEFMIEJhY2tvcmRlcicpKSB8fFxuICAgICAgICAgIChjb2x1bW5OYW1lID09PSAnQ2xpZW50ZScgJiYgdHh0LmluY2x1ZGVzKCdUT1RBTCcpKVxuICAgICAgICApIHtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjk5MUIxQicgfSB9OyAvLyByZWQtODAwXG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2VsZGFzIGRlIGxhIE1JU01BIEZJTEEgVE9UQUwgKGxvcyBudW1lcm9zKVxuICAgICAgICBpZiAocm93SW5kZXggPT09IDAgJiYgY29sdW1uTmFtZSA9PT0gJ1ZhbG9yJykge1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH1cbiAgKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgK1xuICAgICAgKHJvd3MubGVuZ3RoIC0gMSkgK1xuICAgICAgJyBsaW5lYXMgKyBSZXN1bWVuIGNvbiB0b3RhbCAkJyArXG4gICAgICBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgJyknLFxuICAgIDMwMDBcbiAgKTtcbn07XG5cbi8vIHYxNTExICgyMDI2LTEwLTI4KTogaGFuZGxlciB3aW5kb3cuZXhwb3J0UmVwYXJ0b1RvRXhjZWwgcmVtb3ZpZG8ganVudG8gY29uIGVsXG4vLyBib3RvbiBcIkV4cG9ydGFyIHJlcG9ydGVcIiBkZWwgbW9kYWwgUmVwYXJ0by4gUmVlbXBsYXphZG8gcG9yIGVsIGZsb3cgZWRpdGFibGVcbi8vIFwiRXhwb3J0YXIgRXhjZWxcIiArIFwiSW1wb3J0YXIgRXhjZWxcIiBkZWwgUFIgIzEyNzMgKHYxNTA1KS5cbi8vIFByZXNlcnZhZG86IHNyYy9wdXJlL3JlcGFydG8tZXhwb3J0LXJvd3MuanMgKHNoYXBlIGRlIHJvd3MgYXVuIHVzYWRvIHBvciBvdHJvcyBleHBvcnRzKS5cblxuLy8gdjczNzogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG8gZWwgU3RvY2sgQXNpZ25hZG8gKHNpbiBmaWx0cm8gZGUgbWVzKS4gTWlzbW9cbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxud2luZG93LmV4cG9ydFN0b2NrQXNpZ0FsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8gKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjExMDAgKDIwMjYtMDktMzApOiBtaXNtbyBtXHUwMEYzZHVsbyBwdXJvIHF1ZSByZW5kZXJCYWNrb3JkZXJzVGFiIGVuIG1vZG9cbiAgLy8gYXNpZ25hY2lvbi4gQWhvcmEgZWwgcmVwb3J0ZSBjb2luY2lkZSBjb24gZWwgbW9kYWw6IEZJRk8gY2FwIHBvciBkaXNwU2FwLFxuICAvLyBmaWx0cm8gdmVuY2lkYXMgKEFTSUcgPjE1ZCBmdWVyYSwgQVNJRyBzaW4gcmVzZXJ2YSB2aWdlbnRlIGFkZW50cm8pLFxuICAvLyBjb25maXJtZWQgaW5jbHVpZG8sIHNpbiBsXHUwMEVEbmVhcyBcInZpcnR1YWxfQVNJR1wiIGZhbnRhc21hLlxuICAvLyB2MTUzNDogYWxjYW5jZSBwb3Igcm9sICh2ZW5kZWRvciA9IGNsaWVudGVzIGRlIHN1IG1hc3RlcjsgaW50ZXJubyA9IHBhcmVqYXMpLlxuICBjb25zdCBhcnIgPSBfZXhwb3J0U2NvcGUoKS5maWx0ZXJQZWRpZG9zKFxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdXG4gICk7XG4gIGNvbnN0IHRvdGFsUGVkaWRvc09wZW4gPSBhcnIuZmlsdGVyKChwKSA9PiBwICYmICFwLmNsb3NlZEF0KS5sZW5ndGg7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkICE9PSAnZnVuY3Rpb24nIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlLmdldClcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgY29uc3QgY21EYXRhID0gdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgYXJyLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHt9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIGFycikgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIC8vIEVzdGFkb19SZWFsOiBoaXN0XHUwMEYzcmljbyBcIkJPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKVwiIHZzIFwiQVNJR1wiLiB2MTEwMDpcbiAgICAvLyBhaG9yYSBgY29uZmlybWVkYCB0YW1iaVx1MDBFOW4gZW50cmEgKHY5NjIpLiBQcmVzZXJ2YW1vcyBldGlxdWV0YSBsZWdhY3lcbiAgICAvLyBwb3IgY29tcGF0aWJpbGlkYWQgY29uIHF1aWVuIGNvbnN1bWUgZWwgRXhjZWwuXG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XG4gICAgaWYgKGMuc3RhdGUgPT09ICdCTycpIGVzdGFkb1JlYWwgPSAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJztcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcXR5LFxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHF0eSAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXG4gICAgICAvLyB2MTEwMDogY29udGV4dG8gXHUwMEZBdGlsIHBhcmEgZGVidWdnaW5nIHBhcmlkYWQgbW9kYWxcdTIxOTRyZXBvcnRlLlxuICAgICAgU3RvY2tfRGlzcF9TS1U6IHJsLmRpc3BTYXAgfHwgMCxcbiAgICB9KTtcbiAgfSk7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlBc2lnbmFkYT4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgc3RvY2sgYXNpZ25hZG8gYWhvcmEgbWlzbW9cXG4nICtcbiAgICAgICAgJzIuIFRvZG9zIGxvcyBBU0lHIGVzdGFuIHZlbmNpZG9zICg+MTVkIGRlc2RlIGFzaWdBdClcXG4nICtcbiAgICAgICAgJzMuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fU25hcHNob3RfJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59O1xuXG4vLyB2MTM5NiAoMjAyNi0xMC0yMSk6IG51ZXZvIGV4cG9ydCBcIlBlbmRpZW50ZSBkZSBBc2lnbmFjaVx1MDBGM24gLSBQYWJsb1wiLiBMaXN0YVxuLy8gbG9zIHJlcGFydG9zIGFiaWVydG9zIChpbmdyZXNvc19yZXBhcnRvIHBlbmRpbmcvaW5fcHJvZ3Jlc3MpIHBvciBTS1UgK1xuLy8gY2xpZW50ZXMgZW4gY29sYS4gUmVlbXBsYXphIHNlbVx1MDBFMW50aWNhbWVudGUgYWwgdmllam8gXCJTdG9jayBBc2lnbmFkb1wiIGVuIGVsXG4vLyBtb2RhbCAoZWwgdmllam8gcGFzYSBhIFwiU3RvY2sgQXNpZ25hZG8gLSBsXHUwMEVEbmVhc1wiIGNvbW8gYXV4aWxpYXIpLlxuLy8gRG9zIGhvamFzOlxuLy8gICBSZXN1bWVuIHJlcGFydG8gXHUyMDE0IHVuYSBmaWxhIHBvciBkb2MgaW5ncmVzb3NfcmVwYXJ0by5cbi8vICAgQ2xpZW50ZXMgZW4gY29sYSBcdTIwMTQgdW5hIGZpbGEgcG9yIGNsaWVudGUgQk8gZGUgY2FkYSByZXBhcnRvLlxud2luZG93LmV4cG9ydFBlbmRpZW50ZURlQXNpZ25hY2lvblBhYmxvID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG8uLi4nKTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGZiRGIgPSB3LmZiRGI7XG4gIGlmICghZmJEYikge1xuICAgIGFsZXJ0KCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvLiBSZWludGVudFx1MDBFMSBlbiB1bm9zIHNlZ3VuZG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyAxLiBSZXBhcnRvcyBhYmllcnRvcy5cbiAgbGV0IHJlcGFydG9zRG9jcztcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ2luZ3Jlc29zX3JlcGFydG8nKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ3BlbmRpbmcnLCAnaW5fcHJvZ3Jlc3MnXSlcbiAgICAgIC5nZXQoKTtcbiAgICByZXBhcnRvc0RvY3MgPSBzbmFwLmRvY3M7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgY2FyZ2FuZG8gaW5ncmVzb3NfcmVwYXJ0bzogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXJlcGFydG9zRG9jcyB8fCByZXBhcnRvc0RvY3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZXBhcnRvcyBwZW5kaW5nL2luX3Byb2dyZXNzIGFob3JhIG1pc21vLicpO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUGFibG86IDAgcmVwYXJ0b3MnLCAyNDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMi4gU25hcHNob3Qgc3RvY2sgKyBnZXRTdG9ja0JyZWFrZG93biBwb3IgU0tVLlxuICBjb25zdCBzdG9ja1NuYXAgPVxuICAgIHR5cGVvZiB3LmdldFN0b2NrU25hcHNob3QgPT09ICdmdW5jdGlvbidcbiAgICAgID8gdy5nZXRTdG9ja1NuYXBzaG90KClcbiAgICAgIDogdy5fc3RvY2tTbmFwc2hvdENhY2hlIHx8IHsgd2FyZWhvdXNlQnJlYWtkb3duOiB7fSB9O1xuICBjb25zdCB3aHMgPVxuICAgIHR5cGVvZiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24gfHwge307XG4gIGNvbnN0IHBlZGlkb3MgPSBBcnJheS5pc0FycmF5KHcuZ2xvYmFsUGVkaWRvcykgPyB3Lmdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgY29uc3Qgd2FpdGxpc3RFbnRyaWVzID1cbiAgICB0eXBlb2Ygdy5fZ2V0V2FpdGxpc3RDcHN0RW50cmllcyA9PT0gJ2Z1bmN0aW9uJyA/IHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMoKSA6IFtdO1xuICBjb25zdCBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zID0gcmVwYXJ0b3NEb2NzLm1hcCgoZCkgPT5cbiAgICBPYmplY3QuYXNzaWduKHsgX2ZzSWQ6IGQuaWQgfSwgZC5kYXRhKCkgfHwge30pXG4gICk7XG4gIGNvbnN0IGdldEJyZWFrZG93biA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5nZXRTdG9ja0JyZWFrZG93bjtcbiAgLy8gMy4gUmVzb2x2ZXIgcHJvZHVjdG8gcG9yIFNLVS5cbiAgY29uc3QgcHJvZEJ5U2t1ID0gbmV3IE1hcCgpO1xuICBjb25zdCBQUk9EVUNUUyA9IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW107XG4gIGZvciAoY29uc3QgcCBvZiBQUk9EVUNUUykge1xuICAgIGlmIChwICYmIHAuc2t1KSBwcm9kQnlTa3Uuc2V0KFN0cmluZyhwLnNrdSkudG9VcHBlckNhc2UoKSwgcCk7XG4gIH1cbiAgY29uc3Qgbm93TXMgPSBEYXRlLm5vdygpO1xuICBjb25zdCByZXN1bWVuUm93cyA9IFtdO1xuICBjb25zdCBjb2xhUm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IGRvYyBvZiByZXBhcnRvc0RvY3MpIHtcbiAgICBjb25zdCBkYXRhID0gZG9jLmRhdGEoKSB8fCB7fTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoZGF0YS5za3UgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcHJvZCA9IHByb2RCeVNrdS5nZXQoc2t1KSB8fCBudWxsO1xuICAgIGNvbnN0IGZpc2ljb0RlcDExID0gTnVtYmVyKCh3aHNbc2t1XSAmJiB3aHNbc2t1XVsnMTEnXSkgfHwgMCk7XG4gICAgY29uc3QgcXR5SW5ncmVzYWRhID0gTnVtYmVyKGRhdGEucXR5SW5ncmVzYWRhIHx8IDApO1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0gQXJyYXkuaXNBcnJheShkYXRhLmFzc2lnbm1lbnRzKSA/IGRhdGEuYXNzaWdubWVudHMgOiBbXTtcbiAgICBsZXQgcXR5WWFBc2lnbmFkYSA9IDA7XG4gICAgZm9yIChjb25zdCBhIG9mIGFzc2lnbm1lbnRzKSBxdHlZYUFzaWduYWRhICs9IE51bWJlcigoYSAmJiBhLnF0eUFzaWduYWRhKSB8fCAwKTtcbiAgICBsZXQgcXR5QVJlcGFydGlyID0gTWF0aC5tYXgoMCwgcXR5SW5ncmVzYWRhIC0gcXR5WWFBc2lnbmFkYSk7XG4gICAgaWYgKGdldEJyZWFrZG93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYmsgPSBnZXRCcmVha2Rvd24oXG4gICAgICAgICAgc2t1LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGdldFN0b2NrRmlzaWNvOiAoKSA9PiBmaXNpY29EZXAxMSxcbiAgICAgICAgICAgIHBlZGlkb3MsXG4gICAgICAgICAgICB3YWl0bGlzdEVudHJpZXMsXG4gICAgICAgICAgICBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBub3c6IG5vd01zIH1cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGJrICYmIGJrLnJlcGFydG9BYmllcnRvICYmIHR5cGVvZiBiay5yZXBhcnRvQWJpZXJ0by5xdHkgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgcXR5QVJlcGFydGlyID0gYmsucmVwYXJ0b0FiaWVydG8ucXR5O1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvKiBmYWxsYmFjayBhIGNcdTAwRTFsY3VsbyBsb2NhbCAqL1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjbGllbnRlc0JPID0gQXJyYXkuaXNBcnJheShkYXRhLmNsaWVudGVzQk8pID8gZGF0YS5jbGllbnRlc0JPIDogW107XG4gICAgbGV0IGRldGVjdGVkQXQgPSBkYXRhLmRldGVjdGVkQXQgfHwgJyc7XG4gICAgaWYgKGRldGVjdGVkQXQgJiYgdHlwZW9mIGRldGVjdGVkQXQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkZXRlY3RlZEF0ID0gZGV0ZWN0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9ICcnO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBib1RvdGFsUXR5ID0gY2xpZW50ZXNCTy5yZWR1Y2UoKHMsIGMpID0+IHMgKyBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksIDApO1xuICAgIHJlc3VtZW5Sb3dzLnB1c2goe1xuICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgU0tVOiBza3UsXG4gICAgICBQcm9kdWN0bzogKHByb2QgJiYgKHByb2QubmFtZSB8fCBwcm9kLmRlc2NyaXB0aW9uKSkgfHwgJycsXG4gICAgICBGaXNpY29fRGVwMTE6IGZpc2ljb0RlcDExLFxuICAgICAgUXR5X0luZ3Jlc2FkYTogcXR5SW5ncmVzYWRhLFxuICAgICAgUXR5X1lhX0FzaWduYWRhOiBxdHlZYUFzaWduYWRhLFxuICAgICAgUXR5X0FfUmVwYXJ0aXI6IHF0eUFSZXBhcnRpcixcbiAgICAgIENsaWVudGVzX0VuX0NvbGE6IGNsaWVudGVzQk8ubGVuZ3RoLFxuICAgICAgQk9fVG90YWxfUXR5OiBib1RvdGFsUXR5LFxuICAgICAgRGV0ZWN0ZWRBdDogdHlwZW9mIGRldGVjdGVkQXQgPT09ICdzdHJpbmcnID8gZGV0ZWN0ZWRBdC5zbGljZSgwLCAxOSkucmVwbGFjZSgnVCcsICcgJykgOiAnJyxcbiAgICAgIFN0YXR1czogZGF0YS5zdGF0dXMgfHwgJycsXG4gICAgfSk7XG4gICAgZm9yIChjb25zdCBjIG9mIGNsaWVudGVzQk8pIHtcbiAgICAgIGxldCBmZWNoYVBlZCA9IGMucGVkaWRvQ3JlYXRlZEF0IHx8ICcnO1xuICAgICAgaWYgKGZlY2hhUGVkICYmIHR5cGVvZiBmZWNoYVBlZC50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmZWNoYVBlZCA9IGZlY2hhUGVkLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSAnJztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gVmVuZGVkb3I6IGJ1c2NhciBlbiBnbG9iYWxQZWRpZG9zIHBvciBwZWRpZG9JZC5cbiAgICAgIGxldCB2ZW5kZWRvciA9IGMudmVuZG9yS2V5IHx8ICcnO1xuICAgICAgaWYgKCF2ZW5kZWRvciAmJiBjLnBlZGlkb0lkKSB7XG4gICAgICAgIGNvbnN0IHAgPSBwZWRpZG9zLmZpbmQoKHgpID0+IHggJiYgeC5fZnNJZCA9PT0gYy5wZWRpZG9JZCk7XG4gICAgICAgIGlmIChwKSB2ZW5kZWRvciA9IHAub3duZXJWZW5kb3IgfHwgcC52ZW5kb3JBc3NpZ25lZCB8fCAnJztcbiAgICAgIH1cbiAgICAgIGNvbGFSb3dzLnB1c2goe1xuICAgICAgICBSZXBhcnRvX0lEOiBkb2MuaWQsXG4gICAgICAgIFNLVTogc2t1LFxuICAgICAgICBDbGllbnRlOiBjLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENhcmRDb2RlOiBjLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IGMuY2xpZW50UHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogYy5jbGllbnRMb2NhbGl0eSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHZlbmRlZG9yLFxuICAgICAgICBRdHlfQk86IE51bWJlcihjLnF0eUJhY2tvcmRlciB8fCAwKSxcbiAgICAgICAgRmVjaGFfUGVkaWRvX09yaWdpbmFsOiB0eXBlb2YgZmVjaGFQZWQgPT09ICdzdHJpbmcnID8gZmVjaGFQZWQuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXN1bWVuUm93cy5zb3J0KChhLCBiKSA9PiBiLlF0eV9BX1JlcGFydGlyIC0gYS5RdHlfQV9SZXBhcnRpcik7XG4gIGNvbGFSb3dzLnNvcnQoXG4gICAgKGEsIGIpID0+XG4gICAgICAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpIHx8XG4gICAgICAoYS5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpXG4gICk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZW5kaWVudGVEZUFzaWduYWNpb25fUGFibG9fJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUmVzdW1lbiByZXBhcnRvJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBlbiBjb2xhJywgcm93czogY29sYVJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUGFibG86ICcgKyByZXN1bWVuUm93cy5sZW5ndGggKyAnIHJlcGFydG9zIC8gJyArIGNvbGFSb3dzLmxlbmd0aCArICcgY2xpZW50ZXMgZW4gY29sYScsXG4gICAgMjgwMFxuICApO1xufTtcblxuLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc3VlbHZlIG5vbWJyZSBkZSBmYW50YXNpYSBwYXJhIHVuIHBlZGlkbyB1c2FuZG8gZWxcbi8vIG1pc21vIHBhdHRlcm4gcXVlIGxhcyBjYXJkcyBkZWwgbWFwYSAoaW5kZXguaHRtbDo5OTE1LTk5MzUpOlxuLy8gICAxKSBjbGllbnRNZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYSAoZWRpdGFkbyBkZXNkZSBlbCBtb2RhbCBjbGllbnRlKVxuLy8gICAyKSBhcHByb3ZlZEFsdGFzTGlzdFtdLmZhbnRhc2lhIG1hdGNoZWFkbyBwb3IgY29tZXJjaW8gPT0gY2xpZW50TmFtZVxuZnVuY3Rpb24gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKSB7XG4gIGNvbnN0IGNhcmRDb2RlID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgaWYgKGNhcmRDb2RlKSB7XG4gICAgY29uc3QgbWV0YSA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuY2xpZW50TWV0YTtcbiAgICBjb25zdCBjdXN0b20gPSBtZXRhICYmIG1ldGFbY2FyZENvZGVdICYmIG1ldGFbY2FyZENvZGVdLmN1c3RvbUZhbnRhc2lhO1xuICAgIGlmIChjdXN0b20gJiYgU3RyaW5nKGN1c3RvbSkudHJpbSgpKSByZXR1cm4gU3RyaW5nKGN1c3RvbSkudHJpbSgpO1xuICB9XG4gIGNvbnN0IGFsdGFzID0gLyoqIEB0eXBlIHthbnl9ICovIChnbG9iYWxUaGlzKS5hcHByb3ZlZEFsdGFzTGlzdDtcbiAgaWYgKEFycmF5LmlzQXJyYXkoYWx0YXMpKSB7XG4gICAgY29uc3QgbmFtZUxvd2VyID0gU3RyaW5nKHAuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChuYW1lTG93ZXIpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4ge1xuICAgICAgICBpZiAoIWEpIHJldHVybiBmYWxzZTtcbiAgICAgICAgY29uc3QgYyA9IFN0cmluZyhhLmNvbWVyY2lvIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZiA9IFN0cmluZyhhLmZhbnRhc2lhIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIGMgPT09IG5hbWVMb3dlciB8fCBmID09PSBuYW1lTG93ZXI7XG4gICAgICB9KTtcbiAgICAgIGlmIChtYXRjaCAmJiBtYXRjaC5mYW50YXNpYSAmJiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnJztcbn1cblxuLy8gdjEyMzMgKDIwMjYtMTAtMDkpOiByZXBvcnRlIFwiVmVudGFzIHggYXJ0aWN1bG8geCBjbGllbnRlL3ZlbmRlZG9yXCIgdmlhIENGLlxuLy8gQWRtaW4vZ2VyZW50ZSBvbmx5LiBUYXJkYSB+MzAtNjBzIChCUSBxdWVyeSArIGV4Y2VsanMgYnVpbGQgc2VydmVyLXNpZGUpLlxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzQXJ0Q2xpRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHtcbiAgICBhbGVydCgnRWxlZ1x1MDBFRCB1biBNRVMgZXNwZWNcdTAwRURmaWNvIChubyBcIlRvZG8gZWwgYVx1MDBGMW9cIikgXHUyMDE0IGVzdGUgcmVwb3J0ZSBlcyBtZW5zdWFsLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBtb250aElkeCB2aWVuZSAwLWJhc2VkIGRlc2RlIGVsIHBpY2tlciAoZW5lPTApLiBDRiBlc3BlcmEgMS1iYXNlZC5cbiAgY29uc3QgbW9udGggPSBtb250aElkeCArIDE7XG4gIGNvbnN0IHllYXIgPSBhbmlvO1xuICBjb25zdCBwZXJpb2RvID0gKHdpbmRvdy5NRVNFUyA/IHdpbmRvdy5NRVNFU1ttb250aElkeF0gOiBtb250aCkgKyAnICcgKyB5ZWFyO1xuICBjb25zdCBjb25maXJtTXNnID1cbiAgICAnR2VuZXJhciByZXBvcnRlIFwiVkVOVEFTIHggQVJUSUNVTE8geCBDTElFTlRFL1ZFTkRFRE9SXCIgZGUgJyArXG4gICAgcGVyaW9kbyArXG4gICAgJz9cXG5cXG4nICtcbiAgICAnRnVlbnRlOiBTQVAgdmlhIEJpZ1F1ZXJ5IChkYXRvcyBleGFjdG9zKS5cXG4nICtcbiAgICAnUHVlZGUgdGFyZGFyIDMwLTYwIHNlZ3VuZG9zLlxcbicgK1xuICAgICdBbCB0ZXJtaW5hciBzZSBkZXNjYXJnYSBhdXRvbWF0aWNhbWVudGUgZWwgeGxzeC4nO1xuICBpZiAoIWNvbmZpcm0oY29uZmlybU1zZykpIHJldHVybjtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyByZXBvcnRlIHNlcnZlci1zaWRlIChCUSkuLi4gcHVlZGUgdGFyZGFyIH42MHMnKTtcbiAgdHJ5IHtcbiAgICAvLyB2MTAwMCBwYXR0ZXJuOiByZWZyZXNoIElEVG9rZW4gYW50ZXMgZGUgY2FsbGFibGUgY3JpdGljby5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdSA9IHdpbmRvdy5maXJlYmFzZS5hdXRoICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoKCkuY3VycmVudFVzZXI7XG4gICAgICBpZiAodSAmJiB1LmdldElkVG9rZW4pIGF3YWl0IHUuZ2V0SWRUb2tlbih0cnVlKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgICBjb25zdCBjYWxsYWJsZSA9IHdpbmRvdy5maXJlYmFzZVxuICAgICAgLmFwcCgpXG4gICAgICAuZnVuY3Rpb25zKCdzb3V0aGFtZXJpY2EtZWFzdDEnKVxuICAgICAgLmh0dHBzQ2FsbGFibGUoJ2dlbmVyYXRlVmVudGFzUmVwb3J0Q0YnKTtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgY2FsbGFibGUoeyB5ZWFyLCBtb250aCB9KTtcbiAgICBjb25zdCByID0gKHJlc3AgJiYgcmVzcC5kYXRhKSB8fCB7fTtcbiAgICBpZiAoIXIub2sgfHwgIXIuYnl0ZXNCYXNlNjQpIHtcbiAgICAgIGFsZXJ0KCdDRiBkZXZvbHZpbyBlcnJvcjogJyArIChyLmVycm9yIHx8IEpTT04uc3RyaW5naWZ5KHIpKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIERlY29kZSBiYXNlNjQgXHUyMTkyIEJsb2IgXHUyMTkyIGRvd25sb2FkIHRyaWdnZXIuXG4gICAgY29uc3QgYmluID0gYXRvYihyLmJ5dGVzQmFzZTY0KTtcbiAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbi5sZW5ndGgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbi5jaGFyQ29kZUF0KGkpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnl0ZXNdLCB7XG4gICAgICB0eXBlOiByLm1pbWVUeXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID1cbiAgICAgIHIuZmlsZW5hbWUgfHxcbiAgICAgICd2ZW50YXNfeF9hcnRpY3Vsb19jbGllbnRlXycgKyB5ZWFyICsgJy0nICsgU3RyaW5nKG1vbnRoKS5wYWRTdGFydCgyLCAnMCcpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgICAgIGEucmVtb3ZlKCk7XG4gICAgfSwgMTAwMCk7XG4gICAgY29uc3Qgc3RhdHMgPSByLnN0YXRzIHx8IHt9O1xuICAgIHNob3dTeW5jVGFnKFxuICAgICAgJ09LOiAnICtcbiAgICAgICAgKHN0YXRzLnZlbnRhcyB8fCAwKSArXG4gICAgICAgICcgdmVudGFzIC8gJyArXG4gICAgICAgIChzdGF0cy5pdGVtcyB8fCAwKSArXG4gICAgICAgICcgU0tVcyAvICcgK1xuICAgICAgICAoc3RhdHMuY2xpZW50cyB8fCAwKSArXG4gICAgICAgICcgY2xpZW50ZXMnXG4gICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnRWZW50YXNBcnRDbGldIGVycm9yJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCByZXBvcnRlOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpKSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFBlZGlkb3MgZGVsIG1lcy4uLicpO1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IHNjb3BlID0gX2V4cG9ydFNjb3BlKCk7XG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgsIHNjb3BlKTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcbiAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXG4gICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgOiAnJztcbiAgICAvLyB2OTc1ICgyMDI2LTA5LTE3KTogcmVzb2x2ZXIgZmFudGFzaWEgdW5hIHZleiBwb3IgcGVkaWRvIChubyBwb3IgbGluZWEpIFx1MjAxNFxuICAgIC8vIGVsIGxvb2t1cCBlbiBjbGllbnRNZXRhICsgYXBwcm92ZWRBbHRhc0xpc3QgZXMgY29uc3RhbnRlIHBhcmEgdG9kbyBlbCBwZWRpZG8uXG4gICAgY29uc3Qgbm9tYnJlTG9jYWxGYW50YXNpYSA9IF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCk7XG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XG4gICAgICBpZiAoIWwpIHJldHVybjtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKTtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGEsXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgTm9tYnJlX0xvY2FsX0ZhbnRhc2lhOiBub21icmVMb2NhbEZhbnRhc2lhLFxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgLy8gdjE1MzQ6IHZlbmRlZG9yIGRlbCBtYXN0ZXIgYWN0dWFsIChmYWxsYmFjayB2ZW5kb3JBc3NpZ25lZCwgZGVzcHVcdTAwRTlzIG93bmVyVmVuZG9yKS5cbiAgICAgICAgVmVuZGVkb3I6IHNjb3BlLnZlbmRvckNvbHVtbkZvclBlZGlkbyhwKSxcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBDYW50aWRhZF9PcGVuOiBOdW1iZXIobC5xdHlPcGVuKSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9JbnZvaWNlZDogTnVtYmVyKGwucXR5SW52b2ljZWQpIHx8IDAsXG4gICAgICAgIENhbnRpZGFkX0NhbmNlbGxlZDogTnVtYmVyKGwucXR5Q2FuY2VsbGVkKSB8fCAwLFxuICAgICAgICBFc3RhZG9fTGluZWE6IGwuc3RhdGUgfHwgJycsXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQocXR5ICogcHJlY2lvKSxcbiAgICAgICAgQ2VycmFkbzogcC5jbG9zZWRBdCA/ICdTSScgOiAnTk8nLFxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5GZWNoYV9QZWRpZG8gfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG8gfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZWRpZG9zRGVsTWVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdQZWRpZG9zJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgUGVkaWRvcyBkZWwgbWVzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1Jztcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ05FQSc7XG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xuICAgIHJldHVybiAnJztcbiAgfVxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xuICAgIHJldHVybiBrZXk7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBsZXQgYWx0YXNTbmFwO1xuICB0cnkge1xuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcbiAgICAgIC5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXG4gICAgaWYgKCFjYXJkQ29kZSkge1xuICAgICAgc2tpcHBlZE5vU2FwKys7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xuICB9KTtcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgclsnTlJPIENURSddID0gaSArIDE7XG4gIH0pO1xuICAvLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZmFjdG9yIGEgZG93bmxvYWRYbHN4IChlc3RpbG8gdmVyZGUgdW5pZm9ybWUpLlxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRvd25sb2FkWGxzeCgnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcsIFtcbiAgICB7IG5hbWU6ICdDTElFTlRFU19aT05BUycsIHJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeGNlbCBleHBvcnRhZG86ICcgK1xuICAgICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcbiAgICAgIChza2lwcGVkTm9TYXAgPiAwID8gJyAoJyArIHNraXBwZWROb1NhcCArICcgc2luIENhcmRDb2RlIGRlc2NhcnRhZG9zKScgOiAnJylcbiAgKTtcbn07XG5cbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwaW4gPSBwcm9tcHQoXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xuICApO1xuICBpZiAocGluID09PSBudWxsKSByZXR1cm47XG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxuICBjb25zdCBzYXBPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1zYXAtaW50ZWdyYXRpb24nKTtcbiAgaWYgKHNhcE9wdCkge1xuICAgIGNvbnN0IGlzTWFyaWFubyA9XG4gICAgICBjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSc7XG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPcGNpb24gQmFja3VwIG1lbnN1YWw6IHNvbG8gYWRtaW5cbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBhdmlzbyBhbCBjbGljayBwYXJhIFwiVmVudGFzIFx1MDBENyBhcnRcdTAwRURjdWxvIFx1MDBENyBjbGllbnRlXCIuXG4vLyBBZG1pbi9nZXJlbnRlIG9ubHkuIFRhcmRhIDMwLTYwcy4gQW50ZXMgbGEgbm90YSBlc3RhYmEgZW4gbGEgZGVzY3JpcGNpXHUwMEYzbiBkZWxcbi8vIGxpc3RhZG8gZGVsIG1vZGFsOyBhaG9yYSBlbCBsaXN0YWRvIHNvbG8gbXVlc3RyYSBpY29ubyArIHRpdHVsby5cbndpbmRvdy5fdmVudGFzQXJ0Q2xpQ2xpY2sgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdy51c2VyUm9sZSB8fCAnJztcbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ0VzdGUgcmVwb3J0ZSBlcyBzb2xvIHBhcmEgYWRtaW4gLyBnZXJlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBvayA9IGNvbmZpcm0oXG4gICAgJ1JlcG9ydGUgc2VydmVyLXNpZGUgKEJpZ1F1ZXJ5KS4gVGFyZGEgMzAtNjAgc2VndW5kb3MgeSBkZXNjYXJnYSB1biAueGxzeCBjb24gNCBob2phczpcXG4nICtcbiAgICAgICcgIFx1MjAyMiBQcm9kdWN0b3MgdmVuZGlkb3MgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIFByb2R1Y3RvcyBOTyB2ZW5kaWRvcyBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgQ09OIGNvbXByYSBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgU0lOIGNvbXByYSBwb3IgVkRFXFxuXFxuJyArXG4gICAgICAnQ29udGludWFyPydcbiAgKTtcbiAgaWYgKCFvaykgcmV0dXJuO1xuICBpZiAodHlwZW9mIHcuY2xvc2VFeHBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VFeHBvcnREaWFsb2coKTtcbiAgaWYgKHR5cGVvZiB3LnNob3dNb250aFBpY2tlciA9PT0gJ2Z1bmN0aW9uJykgdy5zaG93TW9udGhQaWNrZXIoJ1ZFTlRBU19BUlRfQ0xJJyk7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBdURPLFdBQVMsY0FBYyxHQUFHO0FBQy9CLFdBQU8sT0FBTyxLQUFLLEVBQUUsRUFDbEIsS0FBSyxFQUNMLFlBQVk7QUFBQSxFQUNqQjtBQVFBLFdBQVMsZ0JBQWdCLEdBQUcsU0FBUztBQUNuQyxRQUFJLENBQUMsS0FBSyxPQUFPLFlBQVksV0FBWSxRQUFPO0FBQ2hELFFBQUk7QUFDRixhQUFPLGNBQWMsUUFBUSxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsR0FBRyxPQUFPLEVBQUUsY0FBYyxFQUFFLENBQUMsQ0FBQztBQUFBLElBQzFGLFNBQVMsSUFBSTtBQUNYLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQVNPLFdBQVMsdUJBQXVCLEdBQUcsU0FBUztBQUNqRCxRQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsV0FBTyxnQkFBZ0IsR0FBRyxPQUFPLEtBQUssY0FBYyxFQUFFLGNBQWM7QUFBQSxFQUN0RTtBQVNPLFdBQVMsc0JBQXNCLEdBQUcsU0FBUztBQUNoRCxRQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsV0FDRSxnQkFBZ0IsR0FBRyxPQUFPLEtBQzFCLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxFQUFFLEtBQUssS0FDcEMsT0FBTyxFQUFFLGVBQWUsRUFBRSxFQUFFLEtBQUs7QUFBQSxFQUVyQztBQU1BLFdBQVMsVUFBVSxHQUFHO0FBQ3BCLFFBQUksQ0FBQyxFQUFHLFFBQU87QUFDZixVQUFNLE1BQU0sb0JBQUksSUFBSTtBQUNwQjtBQUFBLFlBQVc7QUFBQTtBQUFBLE1BQXNDO0FBQUEsTUFBSTtBQUNuRCxZ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QUFDO0FBQ0QsU0FBSyxRQUFRLENBQUMsR0FBRyxNQUFNO0FBQ3JCLFFBQUUsU0FBUyxJQUFJLElBQUk7QUFBQSxJQUNyQixDQUFDO0FBRUQsVUFBTSxNQUFLLG9CQUFJLEtBQUssR0FBRSxZQUFZLEVBQUUsTUFBTSxHQUFHLEVBQUU7QUFDL0MsVUFBTSxhQUFhLDhCQUE4QixLQUFLLFNBQVM7QUFBQSxNQUM3RCxFQUFFLE1BQU0sa0JBQWtCLEtBQUs7QUFBQSxJQUNqQyxDQUFDO0FBQ0Q7QUFBQSxNQUNFLHNCQUNFLEtBQUssU0FDTCwrQkFDQyxlQUFlLElBQUksT0FBTyxlQUFlLCtCQUErQjtBQUFBLElBQzdFO0FBQUEsRUFDRjtBQUVBLFNBQU8scUJBQXFCLFdBQVk7QUFDdEMsUUFBSSxPQUFPLFNBQVMsYUFBYTtBQUMvQixZQUFNLGlGQUFpRjtBQUN2RjtBQUFBLElBQ0Y7QUFDQSxVQUFNLE1BQU07QUFBQSxNQUNWO0FBQUEsSUFDRjtBQUNBLFFBQUksUUFBUSxLQUFNO0FBQ2xCLFFBQUksUUFBUSxjQUFjO0FBQ3hCLFlBQU0saUJBQWlCO0FBQ3ZCO0FBQUEsSUFDRjtBQUVBLFVBQU0sU0FBUyxTQUFTLGVBQWUseUJBQXlCO0FBQ2hFLFFBQUksUUFBUTtBQUNWLFlBQU0sWUFDSixnQkFBZ0IsWUFBWSxTQUFTLElBQUksWUFBWSxNQUFNO0FBQzdELGFBQU8sTUFBTSxVQUFVLFlBQVksS0FBSztBQUFBLElBQzFDO0FBRUEsVUFBTSxRQUFRLFNBQVMsZUFBZSx3QkFBd0I7QUFDOUQsUUFBSSxNQUFPLE9BQU0sTUFBTSxVQUFVLGFBQWEsVUFBVSxLQUFLO0FBQzdELGFBQVMsZUFBZSx1QkFBdUIsRUFBRSxVQUFVLElBQUksTUFBTTtBQUFBLEVBQ3ZFO0FBQ0EsU0FBTyxzQkFBc0IsV0FBWTtBQUN2QyxhQUFTLGVBQWUsdUJBQXVCLEVBQUUsVUFBVSxPQUFPLE1BQU07QUFBQSxFQUMxRTtBQVNBLFNBQU8scUJBQXFCLFdBQVk7QUFDdEMsVUFBTTtBQUFBO0FBQUEsTUFBd0IsT0FBTyxXQUFXLGNBQWMsU0FBUyxDQUFDO0FBQUE7QUFDeEUsVUFBTSxPQUFPLEVBQUUsWUFBWTtBQUMzQixRQUFJLFNBQVMsV0FBVyxTQUFTLFdBQVc7QUFDMUMsWUFBTSw0Q0FBNEM7QUFDbEQ7QUFBQSxJQUNGO0FBQ0EsVUFBTSxLQUFLO0FBQUEsTUFDVDtBQUFBLElBTUY7QUFDQSxRQUFJLENBQUMsR0FBSTtBQUNULFFBQUksT0FBTyxFQUFFLHNCQUFzQixXQUFZLEdBQUUsa0JBQWtCO0FBQ25FLFFBQUksT0FBTyxFQUFFLG9CQUFvQixXQUFZLEdBQUUsZ0JBQWdCLGdCQUFnQjtBQUFBLEVBQ2pGOyIsCiAgIm5hbWVzIjogWyJ3IiwgImZiRGIiLCAiUFJPRFVDVFMiXQp9Cg==
