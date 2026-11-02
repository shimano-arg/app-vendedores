"use strict";
(() => {
  // src/pure/export-scope.js
  function normVendorKey(k) {
    return String(k || "").trim().toUpperCase();
  }
  function masterLookup(p, resolve) {
    if (!p || typeof resolve !== "function") return { vendorKey: "", reason: "sin_resolver" };
    try {
      const r = resolve(String(p.clientCardCode || ""), String(p.clientName || ""));
      if (r && typeof r === "object") {
        return { vendorKey: normVendorKey(r.vendorKey), reason: String(r.reason || "") };
      }
      return { vendorKey: normVendorKey(r), reason: "" };
    } catch (_e) {
      return { vendorKey: "", reason: "error" };
    }
  }
  function resolvePedidoVendorKey(p, resolve) {
    if (!p) return "";
    const m = masterLookup(p, resolve);
    if (m.vendorKey) return m.vendorKey;
    if (m.reason === "zona_sin_vendedor") return "";
    if (!String(p.clientCardCode || "").trim()) return normVendorKey(p.vendorAssigned);
    return "";
  }
  function vendorColumnForPedido(p, resolve) {
    if (!p) return "";
    const m = masterLookup(p, resolve);
    if (m.vendorKey) return m.vendorKey;
    if (m.reason === "zona_sin_vendedor") return "";
    return String(p.vendorAssigned || "").trim() || String(p.ownerVendor || "").trim();
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
    if (role !== "admin" && role !== "gerente" && role !== "viewer") {
      return {
        isGlobal: false,
        visitsQueryByOwnerUid: false,
        vendorColumnForPedido: vendorColumn,
        filterPedidos: () => [],
        filterVisits: () => []
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
      let out = { vendorKey: "", reason: "sin_resolver" };
      try {
        const r = typeof w._resolveClientVendorFromMaster === "function" ? w._resolveClientVendorFromMaster({ cardCode, clientName }) : null;
        if (r) out = { vendorKey: r.vendorKey || "", reason: r.reason || "" };
      } catch (_e) {
        out = { vendorKey: "", reason: "error" };
      }
      memo.set(k, out);
      return out;
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
    let allowed = allowedByRole[userRole] || null;
    if (allowed && typeof document !== "undefined" && document.body && document.body.classList.contains("is-pachi-restricted")) {
      allowed = /* @__PURE__ */ new Set([...allowed, "PRECIOS_STOCK", "BACKORDER"]);
    }
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
    const delMes = arr.filter((p) => {
      if (!p) return false;
      const { y, m } = _pedidoMonthYear(p);
      if (y == null) return false;
      if (y !== anio) return false;
      if (monthIdx !== null && m !== monthIdx) return false;
      return true;
    });
    const sc = scope || _exportScope();
    return sc.filterPedidos(delMes);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzIiwgIi4uL3NyYy9kb21haW5zL2V4cG9ydHMtY29yZS5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIHYxNTM0ICgyMDI2LTExLTAyKSBcdTIwMTQgQWxjYW5jZSBwb3Igcm9sIGRlIGxhcyBleHBvcnRhY2lvbmVzIGRlbCBtb2RhbFxuICogXCJSZXBvcnRlcyBFeGNlbFwiIChhdWRpdG9yXHUwMEVEYSBkb2NzL2F1ZGl0b3JpYS80NiwgRXRhcGEgMSkuXG4gKlxuICogUmVnbGFzIChkZWNpc2lvbmVzIGRlIE1hcmlhbm8pOlxuICogICAtIFwiTG9zIGNsaWVudGVzIGRlIHVuIHZlbmRlZG9yXCIgPSBlbCBtYXN0ZXIgQUNUVUFMIGRlbCBjbGllbnRlIChQT0lOVFMgK1xuICogICAgIHZlbmRvcl9vdmVycmlkZXMgKyBhcHByb3ZlZEFsdGFzLCBDTEFVREUubWQgXHUwMEE3NDYvXHUwMEE3NTApLiBOTyBlbCB2ZW5kZWRvclxuICogICAgIHF1ZSBxdWVkXHUwMEYzIGd1YXJkYWRvIGVuIGVsIHBlZGlkbyAoYXNzaWduZWRWZW5kb3JVaWQgc2UgZ3JhYmEgYWwgY3JlYXIgeVxuICogICAgIG5vIHNlIHJlLXNpbmNyb25pemEgY3VhbmRvIGNhbWJpYSBlbCBtYXN0ZXIpLlxuICogICAtIFZlbmRlZG9yIChWREUpOiB1biBwZWRpZG8gZW50cmEgc29sbyBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1XG4gKiAgICAgY2xpZW50ZSBlcyBlbCBzdXlvIFkgYWRlbVx1MDBFMXMgYGFzc2lnbmVkVmVuZG9yVWlkID09PSBteVVpZGAgKGRlZmVuc2EgZW5cbiAqICAgICBwcm9mdW5kaWRhZDogYG15VWlkYCBzYWxlIGRlIEZpcmViYXNlIEF1dGgsIG5vIGRlIGB1c2VyUm9sZWApLlxuICogICAtIEludGVybm8gKFZESSk6IHVuIHBlZGlkbyBlbnRyYSBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1IGNsaWVudGVcbiAqICAgICBlc3RcdTAwRTEgZW4gc3UgY29uanVudG8gZGUgdmVuZGVkb3JlcyAoc3Ugem9uYSArIHN1cyBwYXJlamFzLCBlbCBtaXNtbyBxdWVcbiAqICAgICB1c2EgZWwgbWFwYTogZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cyAvIGdldEVmZmVjdGl2ZVZlbmRvclNldCgnQUxMJykpLlxuICogICAtIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS4gT3RybyByb2wgbyBzaW4gcm9sOiBuYWRhLlxuICogICAtIFZpc2l0YXM6IGVsIHZlbmRlZG9yIHZlIHNvbG8gbGFzIHF1ZSBjYXJnXHUwMEYzIFx1MDBFOWwgKGBvd25lclVpZCA9PT0gbXlVaWRgKTtcbiAqICAgICBlbCBpbnRlcm5vIHZlIGxhcyBzdXlhcyArIGxhcyBkZSBzdXMgcGFyZWphcyAocG9yIGBvd25lclVpZGAgZGUgdW5hXG4gKiAgICAgcGFyZWphLCBwb3IgYGNyZWF0ZWRCeVVpZGAgcHJvcGlvIG8gcG9yIGB2ZW5kb3JgIFx1MjIwOCBzdSBjb25qdW50bykuXG4gKlxuICogU29sbyB1biBwcm9zcGVjdG8gc2luIENhcmRDb2RlIFNBUCBjYWUgYWwgYHZlbmRvckFzc2lnbmVkYCBndWFyZGFkbyBlbiBlbFxuICogcGVkaWRvLiBVbiBDYXJkQ29kZSBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlLCBvIHVuYSB6b25hIHNpbiB2ZW5kZWRvcixcbiAqIHF1ZWRhIGZ1ZXJhIGRlbCBhbGNhbmNlIGRlIHZlbmRlZG9yIGUgaW50ZXJuby4gYG93bmVyVmVuZG9yYCAoPSBxdWlcdTAwRTluIGxvXG4gKiBjYXJnXHUwMEYzLCBsZWdhY3kpIE5PIHNlIHVzYSBwYXJhIGRlY2lkaXIgZWwgYWxjYW5jZTsgc29sbyBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc29cbiAqIHBhcmEgbGEgY29sdW1uYSBcIlZlbmRlZG9yXCIgZGVsIEV4Y2VsLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYgeyhjYXJkQ29kZTogc3RyaW5nLCBjbGllbnROYW1lOiBzdHJpbmcpID0+IChzdHJpbmd8e3ZlbmRvcktleT86IHN0cmluZywgcmVhc29uPzogc3RyaW5nfSl9IFJlc29sdmVWZW5kb3JGb3JDbGllbnRcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IEV4cG9ydFNjb3BlQXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd8bnVsbHx1bmRlZmluZWR9IHJvbGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfG51bGx8dW5kZWZpbmVkfSBbbXlVaWRdXG4gKiBAcHJvcGVydHkge3N0cmluZ3xudWxsfHVuZGVmaW5lZH0gW215VmVuZG9yS2V5XVxuICogQHByb3BlcnR5IHtTZXQ8c3RyaW5nPnxBcnJheTxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbZWZmZWN0aXZlVmVuZG9yU2V0XVxuICogQHByb3BlcnR5IHtBcnJheTxzdHJpbmc+fFNldDxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbcGFydG5lclVpZHNdXG4gKiBAcHJvcGVydHkge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlVmVuZG9yRm9yQ2xpZW50XVxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gRXhwb3J0U2NvcGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNHbG9iYWxcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdmlzaXRzUXVlcnlCeU93bmVyVWlkIC0gdHJ1ZTogY29uc3VsdGFyIHZpc2l0cyBjb24gd2hlcmUoJ293bmVyVWlkJywnPT0nLHVpZCkuXG4gKiBAcHJvcGVydHkgeyhwZWRpZG9zOiBBcnJheTxhbnk+KSA9PiBBcnJheTxhbnk+fSBmaWx0ZXJQZWRpZG9zXG4gKiBAcHJvcGVydHkgeyh2aXNpdHM6IEFycmF5PGFueT4pID0+IEFycmF5PGFueT59IGZpbHRlclZpc2l0c1xuICogQHByb3BlcnR5IHsocDogYW55KSA9PiBzdHJpbmd9IHZlbmRvckNvbHVtbkZvclBlZGlkb1xuICovXG5cbi8qKlxuICogTm9ybWFsaXphIHVuIHZlbmRvcktleTogdHJpbSArIG1heVx1MDBGQXNjdWxhcy5cbiAqIEBwYXJhbSB7YW55fSBrXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybVZlbmRvcktleShrKSB7XG4gIHJldHVybiBTdHJpbmcoayB8fCAnJylcbiAgICAudHJpbSgpXG4gICAgLnRvVXBwZXJDYXNlKCk7XG59XG5cbi8qKlxuICogUmVzdWx0YWRvIGRlbCBtYXN0ZXIgcGFyYSBlbCBjbGllbnRlIGRlbCBwZWRpZG8uIEFjZXB0YSB1biByZXNvbHZlciBxdWVcbiAqIGRldnVlbHZlIHN0cmluZyAodmVuZG9yS2V5KSBvIHt2ZW5kb3JLZXksIHJlYXNvbn0uXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fHVuZGVmaW5lZH0gcmVzb2x2ZVxuICogQHJldHVybnMge3t2ZW5kb3JLZXk6IHN0cmluZywgcmVhc29uOiBzdHJpbmd9fVxuICovXG5mdW5jdGlvbiBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSkge1xuICBpZiAoIXAgfHwgdHlwZW9mIHJlc29sdmUgIT09ICdmdW5jdGlvbicpIHJldHVybiB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gcmVzb2x2ZShTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJyksIFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpKTtcbiAgICBpZiAociAmJiB0eXBlb2YgciA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiB7IHZlbmRvcktleTogbm9ybVZlbmRvcktleShyLnZlbmRvcktleSksIHJlYXNvbjogU3RyaW5nKHIucmVhc29uIHx8ICcnKSB9O1xuICAgIH1cbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6IG5vcm1WZW5kb3JLZXkociksIHJlYXNvbjogJycgfTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgfVxufVxuXG4vKipcbiAqIFZlbmRlZG9yIHF1ZSBkZWZpbmUgZWwgYWxjYW5jZSBkZWwgcGVkaWRvOlxuICogICAtIGVsIGRlbCBtYXN0ZXIgYWN0dWFsLCBzaSByZXN1ZWx2ZTtcbiAqICAgLSB6b25hIHNpbiB2ZW5kZWRvciAoaW5jbHVpZG8gZGlzdHJpYnVpZG9yKTogJycgKGVsIG1hc3RlciBtYW5kYSk7XG4gKiAgIC0gcHJvc3BlY3RvIHNpbiBDYXJkQ29kZSBTQVA6IGVsIGB2ZW5kb3JBc3NpZ25lZGAgZ3VhcmRhZG8gZW4gZWwgcGVkaWRvO1xuICogICAtIENhcmRDb2RlIFNBUCBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlOiAnJyAoZmFsbGEgY2VycmFkbykuIEVqLjogdW4gYWx0YVxuICogICAgIHJlYXNpZ25hZGEgYSBvdHJvIHZlbmRlZG9yIGRlc2FwYXJlY2UgZGVsIGFwcHJvdmVkQWx0YXNMaXN0IGRlbCBWREUgeVxuICogICAgIGVsIGB2ZW5kb3JBc3NpZ25lZGAgdmllam8gbm8gdGllbmUgcXVlIHZvbHZlciBhIG1ldGVybGEuXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fSBbcmVzb2x2ZV1cbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpIHtcbiAgaWYgKCFwKSByZXR1cm4gJyc7XG4gIGNvbnN0IG0gPSBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSk7XG4gIGlmIChtLnZlbmRvcktleSkgcmV0dXJuIG0udmVuZG9yS2V5O1xuICBpZiAobS5yZWFzb24gPT09ICd6b25hX3Npbl92ZW5kZWRvcicpIHJldHVybiAnJztcbiAgaWYgKCFTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpKSByZXR1cm4gbm9ybVZlbmRvcktleShwLnZlbmRvckFzc2lnbmVkKTtcbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFZhbG9yIGRlIGxhIGNvbHVtbmEgXCJWZW5kZWRvclwiIGRlbCBFeGNlbCBkZSBQZWRpZG9zIGRlbCBtZXM6IG1hc3RlciBhY3R1YWwsXG4gKiBkZXNwdVx1MDBFOXMgYHZlbmRvckFzc2lnbmVkYCwgeSBgb3duZXJWZW5kb3JgIHNvbG8gc2kgbm8gaGF5IG90cmEgY29zYS5cbiAqIEBwYXJhbSB7YW55fSBwXG4gKiBAcGFyYW0ge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlXVxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKSB7XG4gIGlmICghcCkgcmV0dXJuICcnO1xuICBjb25zdCBtID0gbWFzdGVyTG9va3VwKHAsIHJlc29sdmUpO1xuICBpZiAobS52ZW5kb3JLZXkpIHJldHVybiBtLnZlbmRvcktleTtcbiAgLy8gWm9uYSBzaW4gdmVuZGVkb3I6IGxhIGNvbHVtbmEgcXVlZGEgdmFjXHUwMEVEYSAobm8gc2UgbXVlc3RyYSBlbCB2ZW5kZWRvciB2aWVqbykuXG4gIGlmIChtLnJlYXNvbiA9PT0gJ3pvbmFfc2luX3ZlbmRlZG9yJykgcmV0dXJuICcnO1xuICByZXR1cm4gU3RyaW5nKHAudmVuZG9yQXNzaWduZWQgfHwgJycpLnRyaW0oKSB8fCBTdHJpbmcocC5vd25lclZlbmRvciB8fCAnJykudHJpbSgpO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7U2V0PHN0cmluZz58QXJyYXk8c3RyaW5nPnxudWxsfHVuZGVmaW5lZH0gc1xuICogQHJldHVybnMge1NldDxzdHJpbmc+fG51bGx9XG4gKi9cbmZ1bmN0aW9uIHRvTm9ybVNldChzKSB7XG4gIGlmICghcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG91dCA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBrIG9mIC8qKiBAdHlwZSB7SXRlcmFibGU8c3RyaW5nPn0gKi8gKHMpKSB7XG4gICAgY29uc3QgbiA9IG5vcm1WZW5kb3JLZXkoayk7XG4gICAgaWYgKG4pIG91dC5hZGQobik7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBBcm1hIGxvcyBmaWx0cm9zIGRlIGV4cG9ydGFjaVx1MDBGM24gcGFyYSBlbCByb2wgZGVsIHVzdWFyaW8uXG4gKiBAcGFyYW0ge0V4cG9ydFNjb3BlQXJnc30gYXJnc1xuICogQHJldHVybnMge0V4cG9ydFNjb3BlfVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRFeHBvcnRTY29wZShhcmdzKSB7XG4gIGNvbnN0IGEgPSBhcmdzIHx8IC8qKiBAdHlwZSB7RXhwb3J0U2NvcGVBcmdzfSAqLyAoeyByb2xlOiBudWxsIH0pO1xuICBjb25zdCByb2xlID0gU3RyaW5nKGEucm9sZSB8fCAnJyk7XG4gIGNvbnN0IG15VWlkID0gU3RyaW5nKGEubXlVaWQgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgbXlLZXkgPSBub3JtVmVuZG9yS2V5KGEubXlWZW5kb3JLZXkpO1xuICBjb25zdCByZXNvbHZlID1cbiAgICB0eXBlb2YgYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50ID09PSAnZnVuY3Rpb24nID8gYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50IDogdW5kZWZpbmVkO1xuICAvKiogQHBhcmFtIHthbnl9IHAgKi9cbiAgY29uc3QgdmVuZG9yQ29sdW1uID0gKHApID0+IHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKTtcbiAgLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gYXJyICovXG4gIGNvbnN0IGNvbXBhY3QgPSAoYXJyKSA9PiAoQXJyYXkuaXNBcnJheShhcnIpID8gYXJyLmZpbHRlcihCb29sZWFuKSA6IFtdKTtcblxuICBpZiAocm9sZSA9PT0gJ3ZlbmRlZG9yJykge1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IHRydWUsXG4gICAgICB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG86IHZlbmRvckNvbHVtbixcbiAgICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IHtcbiAgICAgICAgaWYgKCFteVVpZCB8fCAhbXlLZXkpIHJldHVybiBbXTtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QoYXJyKS5maWx0ZXIoXG4gICAgICAgICAgKHApID0+XG4gICAgICAgICAgICBTdHJpbmcocC5hc3NpZ25lZFZlbmRvclVpZCB8fCAnJykgPT09IG15VWlkICYmXG4gICAgICAgICAgICByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpID09PSBteUtleVxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIGZpbHRlclZpc2l0czogKGFycikgPT4ge1xuICAgICAgICBpZiAoIW15VWlkKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKCh2KSA9PiBTdHJpbmcodi5vd25lclVpZCB8fCAnJykgPT09IG15VWlkKTtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmIChyb2xlID09PSAnaW50ZXJubycpIHtcbiAgICBjb25zdCBzZXQgPSB0b05vcm1TZXQoYS5lZmZlY3RpdmVWZW5kb3JTZXQpO1xuICAgIGNvbnN0IHBhcnRuZXJzID0gbmV3IFNldChcbiAgICAgIEFycmF5LmZyb20oLyoqIEB0eXBlIHtJdGVyYWJsZTxzdHJpbmc+fSAqLyAoYS5wYXJ0bmVyVWlkcyB8fCBbXSkpXG4gICAgICAgIC5tYXAoKHUpID0+IFN0cmluZyh1IHx8ICcnKS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoYXJyKSA9PiB7XG4gICAgICAgIGlmICghc2V0IHx8IHNldC5zaXplID09PSAwKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKChwKSA9PiB7XG4gICAgICAgICAgY29uc3QgayA9IHJlc29sdmVQZWRpZG9WZW5kb3JLZXkocCwgcmVzb2x2ZSk7XG4gICAgICAgICAgcmV0dXJuICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+XG4gICAgICAgIGNvbXBhY3QoYXJyKS5maWx0ZXIoKHYpID0+IHtcbiAgICAgICAgICBjb25zdCBvd25lciA9IFN0cmluZyh2Lm93bmVyVWlkIHx8ICcnKTtcbiAgICAgICAgICBpZiAobXlVaWQgJiYgKG93bmVyID09PSBteVVpZCB8fCBTdHJpbmcodi5jcmVhdGVkQnlVaWQgfHwgJycpID09PSBteVVpZCkpIHJldHVybiB0cnVlO1xuICAgICAgICAgIGlmIChvd25lciAmJiBwYXJ0bmVycy5oYXMob3duZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICBjb25zdCBrID0gbm9ybVZlbmRvcktleSh2LnZlbmRvcik7XG4gICAgICAgICAgcmV0dXJuICEhc2V0ICYmICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KSxcbiAgICB9O1xuICB9XG5cbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnICYmIHJvbGUgIT09ICd2aWV3ZXInKSB7XG4gICAgLy8gUm9sIHZhY1x1MDBFRG8sICd1bmFzc2lnbmVkJyBvIGRlc2Nvbm9jaWRvOiBubyBleHBvcnRhIG5hZGEgKGZhbGxhIGNlcnJhZG8pLlxuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoKSA9PiBbXSxcbiAgICAgIGZpbHRlclZpc2l0czogKCkgPT4gW10sXG4gICAgfTtcbiAgfVxuXG4gIC8vIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS5cbiAgcmV0dXJuIHtcbiAgICBpc0dsb2JhbDogdHJ1ZSxcbiAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgIHZlbmRvckNvbHVtbkZvclBlZGlkbzogdmVuZG9yQ29sdW1uLFxuICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgfTtcbn1cbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG5pbXBvcnQgeyBidWlsZEV4cG9ydFNjb3BlIH0gZnJvbSAnLi4vcHVyZS9leHBvcnQtc2NvcGUuanMnO1xuXG4vLyB2MTUzNCAoMjAyNi0xMS0wMikgXHUyMDE0IGFsY2FuY2UgcG9yIHJvbCBkZSBsYXMgZXhwb3J0YWNpb25lcyAoYXVkaXRvclx1MDBFRGEgNDYsXG4vLyBFdGFwYSAxKS4gUmVnbGEgZW4gc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzOiBlbCB2ZW5kZWRvciB2ZSBzb2xvIHBlZGlkb3MgZGVcbi8vIGNsaWVudGVzIHF1ZSBIT1kgc29uIHN1eW9zIGVuIGVsIG1hc3RlciAoUE9JTlRTICsgdmVuZG9yX292ZXJyaWRlcyArXG4vLyBhcHByb3ZlZEFsdGFzLCBcdTAwQTc0Ni9cdTAwQTc1MCkgeSBhZGVtXHUwMEUxcyBjb24gYXNzaWduZWRWZW5kb3JVaWQgPSBzdSB1c3VhcmlvOyBlbFxuLy8gaW50ZXJubyB2ZSBsb3MgY2xpZW50ZXMgZGUgc3Ugem9uYSArIHN1cyBwYXJlamFzIChnZXRNeUFsbG93ZWRWZW5kb3JLZXlzLFxuLy8gZWwgbWlzbW8gYWxjYW5jZSBkZWwgbWFwYSk7IGFkbWluL2dlcmVudGUgc2luIGNhbWJpby4gRWwgdWlkIHNhbGUgZGVcbi8vIEZpcmViYXNlIEF1dGggKG5vIGRlIHVzZXJSb2xlLCBxdWUgZXMgdW5hIHZhcmlhYmxlIGdsb2JhbCBlZGl0YWJsZSkuXG5mdW5jdGlvbiBfZXhwb3J0U2NvcGUoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdHlwZW9mIHVzZXJSb2xlICE9PSAndW5kZWZpbmVkJyA/IHVzZXJSb2xlIDogbnVsbDtcbiAgbGV0IG15VWlkID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHcuZmlyZWJhc2UgJiYgdy5maXJlYmFzZS5hdXRoICYmIHcuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgIG15VWlkID0gKHUgJiYgdS51aWQpIHx8ICcnO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG15VWlkID0gJyc7XG4gIH1cbiAgY29uc3QgbXlWZW5kb3JLZXkgPSB0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gYXNzaWduZWRWZW5kb3IgOiAnJztcbiAgbGV0IGVmZmVjdGl2ZVZlbmRvclNldCA9IG51bGw7XG4gIHRyeSB7XG4gICAgZWZmZWN0aXZlVmVuZG9yU2V0ID1cbiAgICAgIHR5cGVvZiBnZXRNeUFsbG93ZWRWZW5kb3JLZXlzID09PSAnZnVuY3Rpb24nID8gZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cygpIDogbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQgPSBudWxsO1xuICB9XG4gIGxldCBwYXJ0bmVyVWlkcyA9IFtdO1xuICB0cnkge1xuICAgIHBhcnRuZXJVaWRzID0gKFxuICAgICAgKHR5cGVvZiBteUV4dGVybmFsUGFydG5lcnMgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkobXlFeHRlcm5hbFBhcnRuZXJzKVxuICAgICAgICA/IG15RXh0ZXJuYWxQYXJ0bmVyc1xuICAgICAgICA6IFtdKSB8fCBbXVxuICAgIClcbiAgICAgIC5tYXAoKHgpID0+IHggJiYgeC51aWQpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHBhcnRuZXJVaWRzID0gW107XG4gIH1cbiAgLy8gUmVzb2x2ZXIgZGVsIG1hc3RlciBjb24gbWVtbyBwb3IgY2xpZW50ZSAodW5hIHBhc2FkYSBwb3IgZXhwb3J0KS5cbiAgLy8gRGV2dWVsdmUge3ZlbmRvcktleSwgcmVhc29ufSBwYXJhIHF1ZSBlbCBhbGNhbmNlIGRpc3RpbmdhIHByb3NwZWN0byBzaW5cbiAgLy8gQ2FyZENvZGUgKGNhZSBhIHZlbmRvckFzc2lnbmVkKSBkZSBDYXJkQ29kZSBubyByZXN1ZWx0byAoYWZ1ZXJhKS5cbiAgY29uc3QgbWVtbyA9IG5ldyBNYXAoKTtcbiAgY29uc3QgcmVzb2x2ZVZlbmRvckZvckNsaWVudCA9IChjYXJkQ29kZSwgY2xpZW50TmFtZSkgPT4ge1xuICAgIGNvbnN0IGsgPSBTdHJpbmcoY2FyZENvZGUgfHwgJycpICsgJ3wnICsgU3RyaW5nKGNsaWVudE5hbWUgfHwgJycpO1xuICAgIGlmIChtZW1vLmhhcyhrKSkgcmV0dXJuIG1lbW8uZ2V0KGspO1xuICAgIGxldCBvdXQgPSB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgciA9XG4gICAgICAgIHR5cGVvZiB3Ll9yZXNvbHZlQ2xpZW50VmVuZG9yRnJvbU1hc3RlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gdy5fcmVzb2x2ZUNsaWVudFZlbmRvckZyb21NYXN0ZXIoeyBjYXJkQ29kZSwgY2xpZW50TmFtZSB9KVxuICAgICAgICAgIDogbnVsbDtcbiAgICAgIGlmIChyKSBvdXQgPSB7IHZlbmRvcktleTogci52ZW5kb3JLZXkgfHwgJycsIHJlYXNvbjogci5yZWFzb24gfHwgJycgfTtcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgb3V0ID0geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgICB9XG4gICAgbWVtby5zZXQoaywgb3V0KTtcbiAgICByZXR1cm4gb3V0O1xuICB9O1xuICByZXR1cm4gYnVpbGRFeHBvcnRTY29wZSh7XG4gICAgcm9sZSxcbiAgICBteVVpZCxcbiAgICBteVZlbmRvcktleSxcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQsXG4gICAgcGFydG5lclVpZHMsXG4gICAgcmVzb2x2ZVZlbmRvckZvckNsaWVudCxcbiAgfSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIE1BU1RFUkZJTEUgREUgQ0xJRU5URVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxuLy8gbm9tYnJlLCB0aXBvIChjbGllbnRlL3Byb3NwZWN0byksIHpvbmEgZGVsIHZlbmRlZG9yLCBhc2Vzb3IgZXh0ZXJubywgYXNlc29yXG4vLyBpbnRlcm5vIChkZWR1Y2lkbyBwb3IgcGFyZWphIFZESSksIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBkZXBhcnRhbWVudG8sXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxuLy8gY29vcmRlbmFkYXMgZ2VvY29kaWZpY2FkYXMsIGVzdGFkbyAoSGFiaWxpdGFkby9QZW5kaWVudGUvQ2FuY2VsYWRvKSxcbi8vIGNhdGVnb3JpYSAoUmVndWxhci9WZW50YXMgRXNwZWNpYWxlcy9EaXN0cmlidWlkb3IpLlxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIVBPSU5UUyB8fCAhUE9JTlRTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgY2FyZ2Fkb3MgdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBtYXN0ZXJmaWxlIGRlIGNsaWVudGVzLi4uJyk7XG5cbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGNhcmdhciBjbGllbnRfYnV5ZXJfc3RhdHMgZW4gYmxvcXVlICgxIGRvYyBwb3IgY2FyZENvZGUgU0FQKVxuICAvLyBBTlRFUyBkZSBhcm1hciBsYXMgZmlsYXMsIGFzXHUwMEVEIGNhZGEgZmlsYSB0aWVuZSBzdSBidXllciBzdGF0cyArIGZlY2hhXG4gIC8vIFx1MDBGQWx0aW1hIGNvbXByYSBzaW4gcm9tcGVyIGVsIGZsdWpvLiBGaXJlLWFuZC1mb3JnZXQgc2kgZmFsbGE6IGNhZGEgZmlsYVxuICAvLyBjYWUgYSBcIi1cIiBlbiBsb3MgY2FtcG9zIEJ1eWVyLiBBZG1pbi9nZXJlbnRlIHZlIHRvZGEgbGEgY29sZWNjaVx1MDBGM247XG4gIC8vIHZlbmRlZG9yIHZlIHNcdTAwRjNsbyBsb3Mgc3V5b3MgKHJ1bGVzKS4gU2kgbGEgcnVsZSBibG9xdWVhIFx1MjE5MiBjYXRjaCBcdTIxOTIgdmFjXHUwMEVEby5cbiAgLy8gUGVkaWRvIE1hcmlhbm86IG5vIGludmVudGFyIGNcdTAwRTFsY3VsbyBkZSBcIkZlY2hhIFx1MDBGQWx0aW1hIGNvbXByYVwiOyBzaSBub1xuICAvLyBleGlzdGUgc2Ugb21pdGUuIGJ1eWVyX3N0YXRzLnN0YXRzXzEybS51bHRpbWFDb21wcmEgWUEgZXhpc3RlLlxuICBjb25zdCBidXllclN0YXRzSWR4ID0gbmV3IE1hcCgpO1xuICB0cnkge1xuICAgIGNvbnN0IGJzU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2J1eWVyX3N0YXRzJykuZ2V0KCk7XG4gICAgYnNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGJ1eWVyU3RhdHNJZHguc2V0KGQuaWQsIGQuZGF0YSgpIHx8IHt9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICAnW21hc3RlcmZpbGVdIGNsaWVudF9idXllcl9zdGF0cyBubyBjYXJnYWRvIChydWxlIGRlbmllZCBvIHJlZCk6JyxcbiAgICAgIF9lICYmIF9lLm1lc3NhZ2VcbiAgICApO1xuICB9XG4gIC8vIEhlbHBlcnMgZGVsIHB1cmUgZm4gKGZhbGxiYWNrIGlubGluZSBzaSBidW5kbGUgbm8gY2FyZ1x1MDBGMykuXG4gIGNvbnN0IF9mY0xhYmVscyA9XG4gICAgKHdpbmRvdy5fX3BoYXNlMCAmJiB3aW5kb3cuX19waGFzZTAucHVyZSAmJiB3aW5kb3cuX19waGFzZTAucHVyZS5maWNoYUNsaWVudGVMYWJlbHMpIHx8IG51bGw7XG4gIGNvbnN0IF9jbGFzaWZSb3cgPSAoY21kKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVDbGFzaWZSb3coY21kKVxuICAgICAgOiB7XG4gICAgICAgICAgJ1RpcG8gZGUgY2xpZW50ZSc6ICctJyxcbiAgICAgICAgICBGaWRlbGlkYWQ6ICctJyxcbiAgICAgICAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAnLScsXG4gICAgICAgICAgVGFtYVx1MDBGMW86ICctJyxcbiAgICAgICAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogJy0nLFxuICAgICAgICAgICdUaXBvIGRlIGxvY2FsJzogJy0nLFxuICAgICAgICAgICdDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJzogY21kICYmIGNtZC5jcmVkaXRvQ2hlcXVlID8gTnVtYmVyKGNtZC5jcmVkaXRvQ2hlcXVlKSA6ICctJyxcbiAgICAgICAgfTtcbiAgY29uc3QgX2J1eWVyUm93ID0gKGJzKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQnV5ZXJSb3dcbiAgICAgID8gX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93KGJzLCAnMTJtJylcbiAgICAgIDoge1xuICAgICAgICAgICdNb250byB0b3RhbCAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRmFjdHVyYXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1Byb21lZGlvIHBvciBmYWN0dXJhICgxMm0pJzogJy0nLFxuICAgICAgICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1ByaW1lcmEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9maWxsRGFzaCA9IChyb3cpID0+XG4gICAgX2ZjTGFiZWxzICYmIF9mY0xhYmVscy5maWxsRGFzaEluRW1wdHkgPyBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5KHJvdykgOiByb3c7XG4gIC8vIHYxNDg1IFx1MDBBNzg0ICgyMDI2LTEwLTI3IEJVRyBGSVgpOiBiXHUwMEZBc3F1ZWRhIHBvciBjYXJkQ29kZSAoZnVlbnRlIGF1dG9yaXRhdGl2YSkuXG4gIC8vIHYxNDgyIHVzYWJhIGBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoY2xpZW50TG9jSWQocHJvdiwgbG9jLCBuYW1lKSlgIFx1MjAxNCBzbHVnXG4gIC8vIGRlcml2YWRvIGRlIFBPSU5UUy4gUGFyYSBNQVhFUkEsIFBPSU5UUyBkaWNlIFwiUGFsZXJtbyAoQzE0KVwiIHBlcm8gbGEgRmljaGFcbiAgLy8gcGVyc2lzdGUgY29uIFwiQ09MRUdJQUxFU1wiIFx1MjE5MiBkb2NJZCBtaXNtYXRjaCBcdTIxOTIgY21EYXRhIHVuZGVmaW5lZCBcdTIxOTIgNSBjYW1wb3NcbiAgLy8gRmljaGEgc2FsXHUwMEVEYW4gXCItXCIgYXVucXVlIGNhcmdhZG9zLiBmaW5kQ21EYXRhQnlDYXJkQ29kZSBlc2NhbmVhIHBvclxuICAvLyBzYXBDYXJkQ29kZSBPUiBjYXJkQ29kZVNhcCAoYW1ib3MgYWxpYXNlcykgeSByZXRvcm5hIGVsIGRvYyBjb3JyZWN0by5cbiAgY29uc3QgX2ZpbmRCeUNhcmQgPVxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmluZENtRGF0YUJ5Q2FyZENvZGVcbiAgICAgID8gX2ZjTGFiZWxzLmZpbmRDbURhdGFCeUNhcmRDb2RlXG4gICAgICA6IChjYXJkQ29kZSwgY2FjaGUpID0+IHtcbiAgICAgICAgICBpZiAoIWNhcmRDb2RlIHx8ICFjYWNoZSB8fCB0eXBlb2YgY2FjaGUuZm9yRWFjaCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG51bGw7XG4gICAgICAgICAgbGV0IGZvdW5kID0gbnVsbDtcbiAgICAgICAgICBjYWNoZS5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgICAgICBpZiAoZm91bmQgfHwgIWQpIHJldHVybjtcbiAgICAgICAgICAgIGNvbnN0IGNjMSA9IFN0cmluZyhkLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICAgICAgICBjb25zdCBjYzIgPSBTdHJpbmcoZC5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgICAgICAgICAgaWYgKGNjMSA9PT0gY2FyZENvZGUgfHwgY2MyID09PSBjYXJkQ29kZSkgZm91bmQgPSBkO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBmb3VuZDtcbiAgICAgICAgfTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gbG9va3VwWm9uZSh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYuem9uZSA6ICcnO1xuICB9XG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xuICAgIHJldHVybiB2ID8gdi5sYWJlbCA6IHZlbmRvcktleSB8fCAnJztcbiAgfVxuXG4gIC8vIHY0NTAgKDIwMjYtMDgtMTEpOiBpbmRpY2UgZGUgY2xhc2lmaWNhY2lvbiBkZXNkZSB2aXNpdHMuIFBhcmEgY2FkYVxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXG4gIC8vIGVzcGVjaWFsaXphY2lvbi9jYW5hbENvbXByYS9wb3AvdGlwb1ZlbnRhL2V0Yy4pIGRlbCBmb3JtdWxhcmlvIGRlXG4gIC8vIHZpc2l0YS9jb250YWN0YWRvLiBQb2xpdGljYTogY2FtcG8gcG9yIGNhbXBvLCB0b21hciBlbCBwcmltZXIgdmFsb3JcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cbiAgLy8gdmUgbGEgY2xhc2lmaWNhY2lvbiBtYXMgYWN0dWFsaXphZGEsIHBlcm8gc2kgZWwgdWx0aW1vIGNvbnRhY3RvIG5vIGxsZW5hXG4gIC8vIHVuIGNhbXBvIChjb250YWN0b3MgdGllbmVuIG1lbm9zIGNhbXBvcyBxdWUgdmlzaXRhcyksIGNhZSBhbCBhbnRlcmlvclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcbiAgLy8gaW50ZXJhY2Npb24gcGVybyBubyBwZXJkZXIgaW5mbyB1dGlsIGRlIGxhcyBhbnRlcmlvcmVzXCIuXG4gIGNvbnN0IENMQVNTSUZfRklFTERTID0gW1xuICAgICd0aXBvJyxcbiAgICAnbG9jYWwnLFxuICAgICd0YW1hbm8nLFxuICAgICdmaWRlbGlkYWQnLFxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxuICAgICdjYW5hbENvbXByYScsXG4gICAgJ3JlbGV2YW5jaWEnLFxuICAgICdwb3AnLFxuICAgICduZWNlc2lkYWRQdW50dWFsJyxcbiAgICAndGlwb1ZlbnRhJyxcbiAgICAncG9uZGVyYWNpb25Nb3N0cmFkbycsXG4gICAgJ3BvbmRlcmFjaW9uRWNvbW1lcmNlJyxcbiAgICAnY29tcGV0ZW5jaWEnLFxuICAgICdvcG9ydHVuaWRhZCcsXG4gICAgJ21hc1ZlbmRpZG8nLFxuICAgICdtYXNQcmVndW50YW4nLFxuICAgICdheXVkYVRpZW5kYScsXG4gIF07XG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIChwcm92IHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkudHJpbSgpICtcbiAgICAgICd8JyArXG4gICAgICAobG9jIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcbiAgICApO1xuICB9XG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xuICAgIGlmICh2ICYmIHYuY3JlYXRlZEF0ICYmIHYuY3JlYXRlZEF0LnRvTWlsbGlzKSByZXR1cm4gdi5jcmVhdGVkQXQudG9NaWxsaXMoKTtcbiAgICBpZiAodiAmJiB2LmZlY2hhKSByZXR1cm4gbmV3IERhdGUodi5mZWNoYSkuZ2V0VGltZSgpIHx8IDA7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgY29uc3QgY2xhc3NpZkluZGV4ID0gbmV3IE1hcCgpOyAvLyBrZXkgLT4geyBsYXN0OiB7Y2FtcG9zfSwgbGFzdEZlY2hhLCBsYXN0VHlwZSwgdmlzaXRhcywgY29udGFjdG9zIH1cbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcbiAgICBjb25zdCBieUtleSA9IG5ldyBNYXAoKTtcbiAgICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICBpZiAoIXYpIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSBfY2xhc3NpZktleSh2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcbiAgICAgIGlmICghYnlLZXkuaGFzKGspKSBieUtleS5zZXQoaywgW10pO1xuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XG4gICAgfSk7XG4gICAgYnlLZXkuZm9yRWFjaCgoYXJyLCBrKSA9PiB7XG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxuICAgICAgY29uc3QgbWVyZ2VkID0ge307XG4gICAgICBhcnIuZm9yRWFjaCgodikgPT4ge1xuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICAgICAgaWYgKG1lcmdlZFtmXSAhPSBudWxsICYmIG1lcmdlZFtmXSAhPT0gJycgJiYgbWVyZ2VkW2ZdICE9PSAwKSByZXR1cm47XG4gICAgICAgICAgY29uc3QgdmFsID0gdltmXTtcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xuICAgICAgY2xhc3NpZkluZGV4LnNldChrLCB7XG4gICAgICAgIG1lcmdlZCxcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXG4gICAgICAgIGxhc3RUeXBlOiBsYXRlc3QuaW50ZXJhY3Rpb25UeXBlIHx8IChsYXRlc3QuZXNwYWNpbyA/ICd2aXNpdGEnIDogJycpLFxuICAgICAgICB2aXNpdGFzOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIGNvbnN0IGVudHJ5ID0gY2xhc3NpZkluZGV4LmdldChfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkpO1xuICAgIGlmICghZW50cnkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAnJyxcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUb3RhbCB2aXNpdGFzJzogMCxcbiAgICAgICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IDAsXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXG4gICAgICAgIExvY2FsOiAnJyxcbiAgICAgICAgVGFtYW5vOiAnJyxcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcbiAgICAgICAgRXNwZWNpYWxpemFjaW9uOiAnJyxcbiAgICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6ICcnLFxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcbiAgICAgICAgUE9QOiAnJyxcbiAgICAgICAgJ05lY2VzaWRhZCBwdW50dWFsJzogJycsXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6ICcnLFxuICAgICAgICBDb21wZXRlbmNpYTogJycsXG4gICAgICAgIE9wb3J0dW5pZGFkOiAnJyxcbiAgICAgICAgJ01hcyB2ZW5kaWRvJzogJycsXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXG4gICAgICAgICdBeXVkYSB0aWVuZGEnOiAnJyxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IG0gPSBlbnRyeS5tZXJnZWQgfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXG4gICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0VHlwZSxcbiAgICAgICdUb3RhbCB2aXNpdGFzJzogZW50cnkudmlzaXRhcyxcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXG4gICAgICAnVGlwbyBjb21lcmNpbyc6IG0udGlwbyB8fCAnJyxcbiAgICAgIExvY2FsOiBtLmxvY2FsIHx8ICcnLFxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcbiAgICAgIEZpZGVsaWRhZDogbS5maWRlbGlkYWQgfHwgJycsXG4gICAgICBFc3BlY2lhbGl6YWNpb246IG0uZXNwZWNpYWxpemFjaW9uIHx8ICcnLFxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXG4gICAgICBSZWxldmFuY2lhOiBtLnJlbGV2YW5jaWEgIT0gbnVsbCA/IG0ucmVsZXZhbmNpYSA6ICcnLFxuICAgICAgUE9QOiBtLnBvcCB8fCAnJyxcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAgICdUaXBvIGRlIHZlbnRhJzogbS50aXBvVmVudGEgfHwgJycsXG4gICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyAhPSBudWxsID8gbS5wb25kZXJhY2lvbk1vc3RyYWRvIDogJycsXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgICBDb21wZXRlbmNpYTogbS5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIE9wb3J0dW5pZGFkOiBtLm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgJ01hcyBwcmVndW50YW4nOiBtLm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgICdBeXVkYSB0aWVuZGEnOiBtLmF5dWRhVGllbmRhIHx8ICcnLFxuICAgIH07XG4gIH1cblxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxuICAvLyBlbCBtYXBhIHkgc2UgY3VlbnRhbiBlbiBlbCBzdGF0IEhBQklMSVRBRE9TLiBBbnRlcyBlbCBtYXN0ZXJmaWxlIGJhamFiYVxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxuICBjb25zdCByb3dzID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xuICAgIGNvbnN0IGxvY2FsaXR5TWFwID0gcC5uYW1lIHx8ICcnO1xuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XG4gICAgLy8gdjMzMTogZmlsdHJhciBwb3Igc2NvcGUgZGUgdmVuZG9yIGRlbCB1c3VhcmlvIHF1ZSBleHBvcnRhLlxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XG4gICAgLy8gU29sbyBjbGllbnRlcyByZWd1bGFyZXMgKG5vIHByb3NwZWN0cywgbm8gZGlzdHJpYnVpZG9yZXMpIHF1ZSBwYXNlblxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY29uc3QgayA9ICdDfCcgKyBwcm92aW5jZSArICd8JyArIGxvY2FsaXR5TWFwICsgJ3wnICsgbmFtZTtcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXG4gICAgICBpZiAodHlwZW9mIGNhbmNlbGVkICE9PSAndW5kZWZpbmVkJyAmJiBjYW5jZWxlZCAmJiBjYW5jZWxlZC5oYXMgJiYgY2FuY2VsZWQuaGFzKGspKVxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cbiAgICAgIGNvbnN0IG1ldGEgPSB0eXBlb2YgY2xpZW50TWV0YSAhPT0gJ3VuZGVmaW5lZCcgJiYgY2xpZW50TWV0YSA/IGNsaWVudE1ldGFba10gfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cbiAgICAgIGNvbnN0IGRvY0lkID1cbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xuICAgICAgY29uc3QgY21EYXRhID1cbiAgICAgICAgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBkb2NJZCA/IGNsaWVudE1hc3RlckNhY2hlLmdldChkb2NJZCkgfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XG4gICAgICBjb25zdCBjdXN0b21MYXQgPSBtZXRhLmxhdCAhPSBudWxsID8gbWV0YS5sYXQgOiAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxuICAgICAgbGV0IGNhcmRDb2RlID0gY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnO1xuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XG4gICAgICAgIGNvbnN0IGFsdGFzID0gYXBwcm92ZWRBbHRhc0J5TG9jW2tleV0gfHwgW107XG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XG4gICAgICB9XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogQnV5ZXIgc3RhdHMgaW5kZXhhZG8gcG9yIGNhcmRDb2RlIFNBUC5cbiAgICAgIGNvbnN0IF9idXllclN0YXRzID0gY2FyZENvZGUgPyBidXllclN0YXRzSWR4LmdldChjYXJkQ29kZSkgfHwgbnVsbCA6IG51bGw7XG4gICAgICAvLyB2MTQ4NSBcdTAwQTc4NCBCVUcgRklYOiBidXNjYXIgY21EYXRhIGF1dG9yaXRhdGl2byBwb3IgY2FyZENvZGUuIEVsXG4gICAgICAvLyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIGRlIGFycmliYSB1c2Egc2x1ZyBjbGllbnRMb2NJZCBxdWUgcHVlZGVcbiAgICAgIC8vIGFwdW50YXIgYWwgZG9jIEVRVUlWT0NBRE8gKHZlciBjb21tZW50IGFycmliYSkuIF9maW5kQnlDYXJkIHNjYW4gcG9yXG4gICAgICAvLyBzYXBDYXJkQ29kZSBnYXJhbnRpemEgZW5jb250cmFyIGVsIGRvYyBjb24gbG9zIGNhbXBvcyBGaWNoYS5cbiAgICAgIGNvbnN0IF9jbURhdGFGb3JGaWNoYSA9IF9maW5kQnlDYXJkKGNhcmRDb2RlLCBjbGllbnRNYXN0ZXJDYWNoZSkgfHwgY21EYXRhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBjYXJkQ29kZSxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbmFtZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcbiAgICAgICAgICAgIFRpcG86ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGVzdGFkbyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jYWxpdHlNYXAsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86IGRlcHQsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGFkZHJlc3MsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvY2FsaXR5Q3VzdCxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogY3VzdG9tTG5nIHx8IGxvbixcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBPUkRFTiBpbXBvcnRhLiBMZWdhY3kgdmlzaXRhcyBQUklNRVJPIChmYWxsYmFjayksXG4gICAgICAgICAgLy8gbHVlZ28gRmljaGEgQ2xpZW50ZSBQSVNBIGNvbiBsYWJlbHMgZGUgbGEgZnVlbnRlIGF1dG9yaXRhdGl2YVxuICAgICAgICAgIC8vIChlai4gXCJGaWRlbGlkYWRcIiBGaWNoYSBwaXNhIGxhIG1lcmdlYWRhIGRlIHZpc2l0YXMgcXVlIHB1ZWRlXG4gICAgICAgICAgLy8gZXN0YXIgZGVzYWN0dWFsaXphZGEpLiBCdXllciBzdGF0cyBhbCBmaW5hbCAodmVudGFuYSAxMm0pLlxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfY21EYXRhRm9yRmljaGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG4gIC8vIElueWVjdGFyIGFsdGFzIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgKGFwcHJvdmVkQWx0YXNMaXN0KTpcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxuICAvLyAgICAgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS4gVmFuIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLiBTZVxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXG4gIC8vICAgICBMb3MgcHJvdmlzb3Jpb3MgcHVlZGVuIG5vIHRlbmVyIGRpcmVjY2lvbiB0b2RhdmlhIC0+IHNlIGFjZXB0YW4gaWd1YWwuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIHNlZW4uYWRkKFxuICAgICAgKHIuUHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgKTtcbiAgfSk7XG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xuICAgIGFwcHJvdmVkQWx0YXNMaXN0LmZvckVhY2goKGEpID0+IHtcbiAgICAgIGlmICghYSkgcmV0dXJuO1xuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XG4gICAgICAvLyBIYWJpbGl0YWRvczogc2lndWVuIGV4aWdpZW5kbyBjYXJkQ29kZSArIGRpcmVjY2lvbiAoY29tcG9ydGFtaWVudG8gcHJlLXYzMTEpLlxuICAgICAgLy8gUHJvdmlzb3Jpb3M6IHNpbiBjYXJkQ29kZSBuaSBkaXJlY2Npb24sIHZhbiBpZ3VhbCBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy5cbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XG4gICAgICAgIGlmICghYS5jYXJkQ29kZVNhcCkgcmV0dXJuO1xuICAgICAgICBpZiAoIShhLmNhbGxlIHx8IGEuYWRkcmVzcykpIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByb3YgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBub21icmUgPVxuICAgICAgICBhLmNvbWVyY2lvIHx8XG4gICAgICAgIGEuZmFudGFzaWEgfHxcbiAgICAgICAgKGEuY2FyZENvZGVTYXAgPyAnU0FQICcgKyBhLmNhcmRDb2RlU2FwLnNsaWNlKDAsIDgpIDogYS50aXR1bGFyIHx8ICdQcm92aXNvcmlvJyk7XG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChzZWVuLmhhcyhkdXBLZXkpKSByZXR1cm47XG4gICAgICBzZWVuLmFkZChkdXBLZXkpO1xuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICAgIC8vIHYzMzE6IG1pc21vIGZpbHRybyBkZSBzY29wZSBhcGxpY2EgYSBhbHRhcyBTQVAvcHJvdmlzb3JpYXMuXG4gICAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcbiAgICAgIGNvbnN0IGxvYyA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyhzaW4gbG9jYWxpZGFkKSc7XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogcGFyYSBhbHRhcywgYnV5ZXIgc3RhdHMga2V5ZWQgcG9yIGNhcmRDb2RlU2FwIChzaSBleGlzdGUpLlxuICAgICAgY29uc3QgX2FsdGFCdXllclN0YXRzID0gYS5jYXJkQ29kZVNhcCA/IGJ1eWVyU3RhdHNJZHguZ2V0KGEuY2FyZENvZGVTYXApIHx8IG51bGwgOiBudWxsO1xuICAgICAgLy8gdjE0ODUgXHUwMEE3ODQgQlVHIEZJWDogcGFyYSBhbHRhcyBjb24gY2FyZENvZGUsIGVsIGRvYyBhdXRvcml0YXRpdm8gY29uXG4gICAgICAvLyBjYW1wb3MgRmljaGEgdml2ZSBlbiBjbGllbnRfbWFzdGVyIChsbyBlc2NyaWJlIHNhdmVDbGllbnRDYXRlZ29yaWFGcm9tTW9kYWxcbiAgICAgIC8vIHZpYSBGaWNoYSkuIF9maW5kQnlDYXJkIHJldG9ybmEgZXNlIGRvYy4gRmFsbGJhY2sgYWwgcHJvcGlvIGFsdGEgYGFgXG4gICAgICAvLyBzaSBlbCBjbGllbnRlIG5vIGVzdFx1MDBFMSBlbiBjbGllbnRfbWFzdGVyIChlai4gcHJvdmlzb3JpbyBzaW4gY2FyZENvZGUpLlxuICAgICAgY29uc3QgX2FsdGFDbURhdGEgPSBhLmNhcmRDb2RlU2FwID8gX2ZpbmRCeUNhcmQoYS5jYXJkQ29kZVNhcCwgY2xpZW50TWFzdGVyQ2FjaGUpIHx8IGEgOiBhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxuICAgICAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBub21icmUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxuICAgICAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbycgOiAnSGFiaWxpdGFkbycsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86ICcnLFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jLFxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogbWlzbW8gb3JkZW4gcXVlIFBPSU5UUyBcdTIwMTQgbGVnYWN5IHZpc2l0YXMgcHJpbWVybyxcbiAgICAgICAgICAvLyBGaWNoYSBwaXNhLCBCdXllciBhbCBmaW5hbC5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfYWx0YUNtRGF0YSksXG4gICAgICAgICAgX2J1eWVyUm93KF9hbHRhQnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXG4gIHJvd3Muc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKGFbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xuICB9KTtcblxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXG4gICAgICAgICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJyArXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCBoZWxwZXIgKGVzdGlsbyB2ZXJkZSArIGNlbnRlcmVkXG4gIC8vIHVuaWZvcm1lKS4gQW50ZXMgdXNhYmEgWExTWC53cml0ZUZpbGUgZGlyZWN0byBjb24gU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmFcbiAgLy8gZXN0aWxvcy4gQWhvcmEgaGVyZWRhZG8gZGVsIGhlbHBlciBcdTIwMTQgbWlzbWEgVUkgcXVlIFZlbnRhcy9WaXNpdGFzL2V0Yy5cbiAgLy8gdjEwNDMgKDIwMjYtMDktMjMpOiBwb3N0LXByb2Nlc28gXHUyMDE0IHNhY2FyIGNvbHVtbmFzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIC8vIFJlcG9ydGUgTWFyaWFubzogbWFzdGVyZmlsZSBleHBvcnRhYmEgMzcgY29sdW1uYXMgZG9uZGUgbXVjaGFzIHZlblx1MDBFRGFuXG4gIC8vIHZhY1x1MDBFRGFzIHBvcnF1ZSBubyBoYWJcdTAwRURhIHZpc2l0YXMvY29udGFjdG9zIGNhcmdhZG9zIHBhcmEgZXNvcyBjbGllbnRlcy5cbiAgLy8gRml4OiBpZGVudGlmaWNhciBrZXlzIGRvbmRlIFRPREFTIGxhcyBmaWxhcyB0aWVuZW4gdmFsb3IgXCJ2YWNcdTAwRURvXCIgKGVtcHR5XG4gIC8vIHN0cmluZywgbnVsbCwgdW5kZWZpbmVkKSB5IHJlbW92ZXJsYXMgYW50ZXMgZGVsIHNoZWV0LiBMb3MgY29udGVvc1xuICAvLyAoVG90YWwgdmlzaXRhcy9jb250YWN0b3MpIHNlIGNvbnNpZGVyYW4gdmFjXHUwMEVEb3Mgc2kgdG9kb3Mgc29uIDAuXG4gIC8vIFdpZHRocyBwb3IgY29sdW1uLW5hbWUgKGVuIHZleiBkZSBwb3NpY2lvbmFsKSBwYXJhIHF1ZSBlbCBmaWx0ZXIgbm9cbiAgLy8gZGVzYWxpbmVlIGVsIHNoZWV0IGN1YW5kbyByZW1vdmVtb3MgY29sdW1uYXMuXG4gIGNvbnN0IENPTF9XSURUSFMgPSB7XG4gICAgJ0NhcmRDb2RlIFNBUCc6IDE2LFxuICAgICdOb21icmUgdGllbmRhJzogMzgsXG4gICAgJ0FsaWFzIChtb2RhbCknOiAyOCxcbiAgICBUaXBvOiAxNCxcbiAgICBFc3RhZG86IDE0LFxuICAgIFByb3ZpbmNpYTogMjIsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknOiAyMixcbiAgICBEZXBhcnRhbWVudG86IDIyLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogMjgsXG4gICAgWm9uYTogOCxcbiAgICAnRXRpcXVldGEgem9uYSc6IDQ4LFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IDI4LFxuICAgIERpcmVjY2lvbjogMzgsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiAyNCxcbiAgICAnTGF0IChnZW9jb2RlKSc6IDE0LFxuICAgICdMbmcgKGdlb2NvZGUpJzogMTQsXG4gICAgLy8gdjE0ODIgXHUwMEE3ODI6IGNvbHVtbmFzIGRlIGxhIEZpY2hhIENsaWVudGUgKHBlc3RhXHUwMEYxYSBDbGFzaWZpY2FjaVx1MDBGM24pICtcbiAgICAvLyBCdXllciAocGVzdGFcdTAwRjFhIEJ1eWVyLCB2ZW50YW5hIDEybSkuIE9yZGVuIGV4YWN0byBxdWUgbGxlZ2EgZGVzZGVcbiAgICAvLyBfY2xhc2lmUm93IChPYmplY3QuYXNzaWduIHByZXNlcnZhIG9yZGVuIGRlIGtleXMpLlxuICAgICdUaXBvIGRlIGNsaWVudGUnOiAzNixcbiAgICBGaWRlbGlkYWQ6IDEwLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0byc6IDIwLFxuICAgIFRhbWFcdTAwRjFvOiAxMCxcbiAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogMjAsXG4gICAgJ1RpcG8gZGUgbG9jYWwnOiAxNCxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IDE4LFxuICAgICdNb250byB0b3RhbCAoMTJtKSc6IDE2LFxuICAgICdGYWN0dXJhcyAoMTJtKSc6IDEyLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6IDIwLFxuICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAyMCxcbiAgICAnRmFjdHVyYXMgcG9yIG1lcyAoMTJtKSc6IDE2LFxuICAgICdQcmltZXJhIGNvbXByYSc6IDE0LFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAxNCxcbiAgICAnRFx1MDBFRGFzIGRlc2RlIFx1MDBGQWx0aW1hIGNvbXByYSc6IDE4LFxuICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVG90YWwgdmlzaXRhcyc6IDEwLFxuICAgICdUb3RhbCBjb250YWN0b3MnOiAxMCxcbiAgICAnVGlwbyBjb21lcmNpbyc6IDE4LFxuICAgIExvY2FsOiAxNixcbiAgICAnQ2FuYWwgZGUgY29tcHJhJzogMjAsXG4gICAgUmVsZXZhbmNpYTogMTAsXG4gICAgUE9QOiA4LFxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IDI2LFxuICAgICdUaXBvIGRlIHZlbnRhJzogMTYsXG4gICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAxOCxcbiAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAxOCxcbiAgICBDb21wZXRlbmNpYTogMjYsXG4gICAgT3BvcnR1bmlkYWQ6IDI2LFxuICAgICdNYXMgdmVuZGlkbyc6IDIyLFxuICAgICdNYXMgcHJlZ3VudGFuJzogMjIsXG4gICAgJ0F5dWRhIHRpZW5kYSc6IDI2LFxuICB9O1xuICAvLyBEZXRlY3RhciBrZXlzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIGNvbnN0IGFsbEtleXMgPSBPYmplY3Qua2V5cyhDT0xfV0lEVEhTKTtcbiAgY29uc3QgTlVNRVJJQ19aRVJPX09LID0gbmV3IFNldChbJ1RvdGFsIHZpc2l0YXMnLCAnVG90YWwgY29udGFjdG9zJ10pO1xuICAvLyB2MTQ4MiBcdTAwQTc4MiArIHYxNDg1IFx1MDBBNzg0IG1lam9yYTogY29sdW1uYXMgRmljaGEgKyBlc3RydWN0dXJhbGVzIChDYXJkQ29kZSxcbiAgLy8gWm9uYSwgVmVuZGVkb3IsIERpcmVjY2lcdTAwRjNuLCBldGMuKSBOVU5DQSBzZSBvbWl0ZW4uIE1hcmlhbm8gcGlkaVx1MDBGMzpcbiAgLy8gXCJubyBvY3VsdGFyIGNvbHVtbmFzIHBvciByb2w7IFBBQ0hJIHJlY2liZSBsYXMgbWlzbWFzIGNvbHVtbmFzIHF1ZVxuICAvLyBhZG1pbiwgc29sbyBzdXMgY2xpZW50ZXNcIi4gRWwgZXhwb3J0IFZERS9QQUNISSByZXNwZXRhIGVzdGUgY29udHJhdG9cbiAgLy8gcG9ycXVlIGxhcyBzdHJ1Y3R1cmFsZXMgZXN0XHUwMEUxbiBwcm90ZWdpZGFzIGF1bnF1ZSBlbCBzY29wZSByZWR1Y2lkbyBub1xuICAvLyB0ZW5nYSBkYXRvcyBwYXJhIGFsZ3VuYSBkZSBlbGxhcy5cbiAgY29uc3QgU1RSVUNUVVJBTF9QUk9URUNURUQgPSBuZXcgU2V0KFtcbiAgICAnQ2FyZENvZGUgU0FQJyxcbiAgICAnTm9tYnJlIHRpZW5kYScsXG4gICAgJ0FsaWFzIChtb2RhbCknLFxuICAgICdUaXBvJyxcbiAgICAnRXN0YWRvJyxcbiAgICAnUHJvdmluY2lhJyxcbiAgICAnTG9jYWxpZGFkIChtYXBhKScsXG4gICAgJ0RlcGFydGFtZW50bycsXG4gICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknLFxuICAgICdab25hJyxcbiAgICAnRXRpcXVldGEgem9uYScsXG4gICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJyxcbiAgICAnRGlyZWNjaW9uJyxcbiAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYScsXG4gICAgJ0xhdCAoZ2VvY29kZSknLFxuICAgICdMbmcgKGdlb2NvZGUpJyxcbiAgXSk7XG4gIGNvbnN0IEZJQ0hBX1BST1RFQ1RFRCA9IG5ldyBTZXQoW1xuICAgICdUaXBvIGRlIGNsaWVudGUnLFxuICAgICdGaWRlbGlkYWQnLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0bycsXG4gICAgJ1RhbWFcdTAwRjFvJyxcbiAgICAnRXNwZWNpYWxpemFjaVx1MDBGM24nLFxuICAgICdUaXBvIGRlIGxvY2FsJyxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKScsXG4gICAgJ01vbnRvIHRvdGFsICgxMm0pJyxcbiAgICAnRmFjdHVyYXMgKDEybSknLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKScsXG4gICAgJ0ZyZWN1ZW5jaWEgKGRcdTAwRURhcyBlbnRyZSBjb21wcmFzKScsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknLFxuICAgICdQcmltZXJhIGNvbXByYScsXG4gICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnLFxuICBdKTtcbiAgY29uc3QgZW1wdHlLZXlzID0gbmV3IFNldChcbiAgICBhbGxLZXlzLmZpbHRlcigoaykgPT4ge1xuICAgICAgaWYgKFNUUlVDVFVSQUxfUFJPVEVDVEVELmhhcyhrKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKEZJQ0hBX1BST1RFQ1RFRC5oYXMoaykpIHJldHVybiBmYWxzZTtcbiAgICAgIHJldHVybiByb3dzLmV2ZXJ5KChyKSA9PiB7XG4gICAgICAgIGNvbnN0IHYgPSByW2tdO1xuICAgICAgICBpZiAodiA9PT0gJycgfHwgdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgICAgICBpZiAoTlVNRVJJQ19aRVJPX09LLmhhcyhrKSAmJiB2ID09PSAwKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gICAgfSlcbiAgKTtcbiAgY29uc3Qga2VwdEtleXMgPSBhbGxLZXlzLmZpbHRlcigoaykgPT4gIWVtcHR5S2V5cy5oYXMoaykpO1xuICAvLyB2MTQ4MiBcdTAwQTc4MjogcmVnbGEgXCJuaW5ndW5hIGNlbGRhIHZhY1x1MDBFRGFcIiBcdTIwMTQgZmlsbERhc2hJbkVtcHR5IHNvYnJlIFRPREFTXG4gIC8vIGxhcyBjb2x1bW5hcyBmaW5hbGVzIChjbGFzaWYgKyBidXllciArIGxlZ2FjeSB2aXNpdGFzKS5cbiAgY29uc3Qgcm93c0ZpbHRlcmVkID0gcm93cy5tYXAoKHIpID0+IHtcbiAgICBjb25zdCBvdXQgPSB7fTtcbiAgICBrZXB0S2V5cy5mb3JFYWNoKChrKSA9PiB7XG4gICAgICBvdXRba10gPSByW2tdO1xuICAgIH0pO1xuICAgIHJldHVybiBfZmlsbERhc2gob3V0KTtcbiAgfSk7XG4gIGNvbnN0IHJlbW92ZWRDb3VudCA9IGVtcHR5S2V5cy5zaXplO1xuICBpZiAocmVtb3ZlZENvdW50ID4gMCkge1xuICAgIGNvbnNvbGUubG9nKGBbbWFzdGVyZmlsZV0gcmVtb3ZpZGFzICR7cmVtb3ZlZENvdW50fSBjb2xzIHZhY1x1MDBFRGFzOmAsIFsuLi5lbXB0eUtleXNdLmpvaW4oJywgJykpO1xuICB9XG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxuICAvLyB2MTQ4MiBcdTAwQTc4MjogYWdyZWdhciBjb250ZW8gcG9yIFRpcG8gZGUgY2xpZW50ZSArIEZpZGVsaWRhZCAoZG9zIG51ZXZhc1xuICAvLyBjb2x1bW5hcyBjb24gZGV0YWxsZSBwb3Igem9uYSkuIEZvcm1hdG8gYnJldmUgXCJBOiBOLCBCOiBNLCAtOiBLXCIgcGFyYVxuICAvLyBjYWJlciBlbiB1bmEgc29sYSBjZWxkYSBsZWdpYmxlLlxuICBjb25zdCBieVpvbmUgPSB7fTtcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xuICAgIGlmICghYnlab25lW3pdKSB7XG4gICAgICBieVpvbmVbel0gPSB7XG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBoYWJpbGl0YWRvczogMCxcbiAgICAgICAgY2FuY2VsYWRvczogMCxcbiAgICAgICAgdGlwb3M6IHt9LFxuICAgICAgICBmaWRlbGlkYWRlczoge30sXG4gICAgICB9O1xuICAgIH1cbiAgICBieVpvbmVbel0udG90YWwrKztcbiAgICBpZiAoci5Fc3RhZG8gPT09ICdIYWJpbGl0YWRvJykgYnlab25lW3pdLmhhYmlsaXRhZG9zKys7XG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xuICAgIC8vIFRpcG8gZGUgY2xpZW50ZTogdG9tYXIgcHJpbWVyIGNoYXIgZGVsIGxhYmVsIChcIkEgLSAuLi5cIiwgXCJCIC0gLi4uXCIsXG4gICAgLy8gXCJQIChQcmVtaXVtKS4uLlwiLCBcIkMgLSAuLi5cIikuIFNpIGxhYmVsIGVzIFwiLVwiIFx1MjE5MiBcIi1cIi5cbiAgICBjb25zdCB0aXBvTGJsID0gclsnVGlwbyBkZSBjbGllbnRlJ10gfHwgJy0nO1xuICAgIGNvbnN0IHRpcG9LZXkgPSB0aXBvTGJsID09PSAnLScgPyAnLScgOiBTdHJpbmcodGlwb0xibCkudHJpbSgpLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpO1xuICAgIGJ5Wm9uZVt6XS50aXBvc1t0aXBvS2V5XSA9IChieVpvbmVbel0udGlwb3NbdGlwb0tleV0gfHwgMCkgKyAxO1xuICAgIGNvbnN0IGZpZCA9IHIuRmlkZWxpZGFkIHx8ICctJztcbiAgICBieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSA9IChieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSB8fCAwKSArIDE7XG4gIH0pO1xuICBmdW5jdGlvbiBfZm10RGlzdChkaXN0KSB7XG4gICAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGRpc3QpLnNvcnQoKGEsIGIpID0+IGJbMV0gLSBhWzFdKTtcbiAgICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVybiAnLSc7XG4gICAgcmV0dXJuIGVudHJpZXMubWFwKChbaywgdl0pID0+IGAke2t9OiAke3Z9YCkuam9pbignLCAnKTtcbiAgfVxuICBjb25zdCByZXN1bWVuUm93cyA9IE9iamVjdC5lbnRyaWVzKGJ5Wm9uZSlcbiAgICAubWFwKChbeiwgZF0pID0+ICh7XG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcbiAgICAgICdUb3RhbCB0aWVuZGFzJzogZC50b3RhbCxcbiAgICAgIEhhYmlsaXRhZGFzOiBkLmhhYmlsaXRhZG9zLFxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxuICAgICAgJ1BvciBUaXBvIGRlIGNsaWVudGUnOiBfZm10RGlzdChkLnRpcG9zKSxcbiAgICAgICdQb3IgRmlkZWxpZGFkJzogX2ZtdERpc3QoZC5maWRlbGlkYWRlcyksXG4gICAgfSkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAvLyB2MzMxOiBzdWZpam8gY29uIGVsIHNjb3BlIGFwbGljYWRvIHBhcmEgZGlmZXJlbmNpYXIgZWwgYXJjaGl2byBkZWwgVkRFL1ZESVxuICAvLyBkZWwgZXhwb3J0IGdsb2JhbCBkZWwgYWRtaW4uXG4gIGNvbnN0IHNjb3BlTGJsID1cbiAgICBzY29wZVNldCA9PT0gbnVsbFxuICAgICAgPyAnVE9ET1MnXG4gICAgICA6IHNjb3BlU2V0LnNpemUgPT09IDFcbiAgICAgICAgPyBbLi4uc2NvcGVTZXRdWzBdLnNwbGl0KCcgJylbMF1cbiAgICAgICAgOiAnbWlzLXpvbmFzLScgKyBzY29wZVNldC5zaXplO1xuICBjb25zdCBmbmFtZSA9ICdNYXN0ZXJmaWxlX0NsaWVudGVzX1NBUF8nICsgc2NvcGVMYmwgKyAnXycgKyB0cyArICcueGxzeCc7XG4gIGF3YWl0IGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ0NsaWVudGVzIGhhYmlsaXRhZG9zIFNBUCcsIHJvd3M6IHJvd3NGaWx0ZXJlZCB9LFxuICAgIHsgbmFtZTogJ1Jlc3VtZW4gcG9yIHpvbmEnLCByb3dzOiByZXN1bWVuUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArXG4gICAgICAoc2NvcGVTZXQgPT09IG51bGwgPyAnJyA6ICcgKHNjb3BlOiAnICsgWy4uLnNjb3BlU2V0XS5qb2luKCcsICcpICsgJyknKVxuICApO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcbi8vIEZpcmVzdG9yZSkgeSBTVE9DS19NQVAgKGJvb2xlYW5vIHBvciBTS1UgZGVsIHN0b2NrLmpzb24gZGVsIHJlcG8pLlxuLy8gSG9qYXM6XG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXG4vLyAgICAobG8gbWFzIGNvbXVuIHBhcmEgcmV2aXNhciBkaXNwb25pYmlsaWRhZCArIHByZWNpbykuXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cbi8vICAtIFwiSW5mb1wiOiBmZWNoYSBkZSBsb3Mgc25hcHNob3RzIHkgZnVlbnRlcy5cbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoUFJPRFVDVFMpIHx8ICFQUk9EVUNUUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XG4gIC8vIHY1NzQgKDIwMjYtMDgtMjEpOiBtb3N0cmFyIFVOSURBREVTIG51bWVyaWNhcyBleGFjdGFzIGRlbCBkZXBvc2l0byAxMS5cbiAgLy8gdjEzNjMgKDIwMjYtMTAtMTkpOiBwZWRpZG8gTWFyaWFubyBcdTIwMTQgY2FtYmlhciBkZSBcInN0b2NrIGZcdTAwRURzaWNvIGRlcCAxMVwiIGFcbiAgLy8gXCJsaWJyZSBwYXJhIGxhIHZlbnRhXCIgKD0gZGVwIDExIFx1MjIxMiByZXNlcnZhcyBjb25maXJtZWQvQk8vQVNJRy93YWl0bGlzdCkuXG4gIC8vIFJhelx1MDBGM246IGVudmlhciBhbCBjbGllbnRlIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGxlIHB1ZWRlIHByb21ldGVyIEhPWS5cbiAgLy8gU2kgc29sbyBtb3N0cmFtb3Mgc3RvY2sgZlx1MDBFRHNpY28sIHB1ZWRlIHBhc2FyIHF1ZSBoYXlhIDV1IHBlcm8gbGFzIDUgZXN0XHUwMEU5blxuICAvLyByZXNlcnZhZGFzIFx1MjE5MiBlbCBjbGllbnRlIHNlIGVudGVyYSByZWNpXHUwMEU5biBhbCBoYWNlciBlbCBwZWRpZG8gcXVlIG5vIGhheS5cbiAgLy8gVXNhIGdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSAocHVyZSBmdW5jdGlvbiwgZmlsdHJhIFRUTHMpLiBSZXRvcm5hICcnIHNpXG4gIC8vIG5vIGhheSBzbmFwc2hvdCBjYXJnYWRvOyAwIHNpIG5vIGhheSBsaWJyZS5cbiAgZnVuY3Rpb24gZm10U3RvY2soc2t1KSB7XG4gICAgY29uc3QgZm5SZWFsID1cbiAgICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZVxuICAgICAgICA6IG51bGw7XG4gICAgaWYgKGZuUmVhbCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdiA9IGZuUmVhbChza3UpO1xuICAgICAgICBpZiAodiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgICAgIHJldHVybiBOdW1iZXIodikgfHwgMDtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIC8vIGZhbGxiYWNrIGEgc3RvY2sgZlx1MDBFRHNpY28gYWJham9cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gRmFsbGJhY2s6IHN0b2NrIGZcdTAwRURzaWNvIGRlcCAxMSAoc2kgZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlIG5vIGVzdFx1MDBFMSBkaXNwb25pYmxlLFxuICAgIC8vIGVqLiBib290c3RyYXAgbXV5IHRlbXByYW5vKS5cbiAgICBjb25zdCBmbkZpc2ljbyA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXG4gICAgICAgIDogbnVsbDtcbiAgICBjb25zdCB2RiA9IGZuRmlzaWNvID8gZm5GaXNpY28oc2t1KSA6IG51bGw7XG4gICAgaWYgKHZGID09IG51bGwpIHJldHVybiAnJztcbiAgICByZXR1cm4gTnVtYmVyKHZGKSB8fCAwO1xuICB9XG4gIGZ1bmN0aW9uIGZtdFByZWNpbyhza3UpIHtcbiAgICBjb25zdCBwID0gdHlwZW9mIFBSSUNFX0xJU1RfTUFQID09PSAnb2JqZWN0JyAmJiBQUklDRV9MSVNUX01BUCA/IFBSSUNFX0xJU1RfTUFQW3NrdV0gOiBudWxsO1xuICAgIGlmIChwID09IG51bGwpIHJldHVybiAnJztcbiAgICByZXR1cm4gTnVtYmVyKHApIHx8IDA7XG4gIH1cbiAgLy8gdjEzNjQgKDIwMjYtMTAtMTkpOiByZXdvcmsgZGVsIGV4cG9ydCBwb3IgcGVkaWRvIE1hcmlhbm86XG4gIC8vIC0gSG9qYSBwcmluY2lwYWwgcmVub21icmFkYSBcIlByZWNpb3MgeSBTdG9ja1wiIC0+IFwiTGlzdGEgZGUgcHJlY2lvc1wiLlxuICAvLyAtIE51ZXZhIGNvbHVtbmEgXCJEaXNwb25pYmlsaWRhZFwiIChESVNQT05JQkxFIHZlcmRlIHNpIFN0b2NrPjAsIE5PIERJU1BPTklCTEVcbiAgLy8gICByb2pvIHNpIFN0b2NrPD0wIG8gdmFjaW8pLlxuICAvLyAtIEhvamEgXCJJbmZvXCIgZWxpbWluYWRhLlxuICAvLyAtIE5vbWJyZSBhcmNoaXZvOiBQcmVjaW9zX3lfU3RvY2tfWVlZWS1NTS1ERC54bHN4IC0+IExpc3RhX2RlX1ByZWNpb3NfWVlZWS1NTS1ERC54bHN4LlxuICAvLyBIb2phcyBcIlByZWNpb3NcIiB5IFwiU3RvY2tcIiBzZSBtYW50aWVuZW4gcG9yIHNpIE1hcmlhbm8gbGFzIHVzYS5cbiAgZnVuY3Rpb24gZGlzcExhYmVsKHN0b2NrVmFsKSB7XG4gICAgaWYgKHN0b2NrVmFsID09PSAnJyB8fCBzdG9ja1ZhbCA9PSBudWxsKSByZXR1cm4gJ05PIERJU1BPTklCTEUnO1xuICAgIHJldHVybiBOdW1iZXIoc3RvY2tWYWwpID4gMCA/ICdESVNQT05JQkxFJyA6ICdOTyBESVNQT05JQkxFJztcbiAgfVxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiB7XG4gICAgY29uc3Qgc3QgPSBmbXRTdG9jayhwLmNvZGUpO1xuICAgIHJldHVybiB7XG4gICAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgICBGYW1pbGlhOiBwLmZhbSB8fCAnJyxcbiAgICAgIFN1YmZhbWlsaWE6IHAuc3ViIHx8ICcnLFxuICAgICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcbiAgICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gICAgICBTdG9jazogc3QsXG4gICAgICBEaXNwb25pYmlsaWRhZDogZGlzcExhYmVsKHN0KSxcbiAgICB9O1xuICB9KS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCBwcmVjaW9zUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gIH0pKVxuICAgIC5maWx0ZXIoKHIpID0+IHJbJ1ByZWNpbyBBUlMnXSAhPT0gJycpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHN0b2NrUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4ge1xuICAgIGNvbnN0IHN0ID0gZm10U3RvY2socC5jb2RlKTtcbiAgICByZXR1cm4ge1xuICAgICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICAgU3RvY2s6IHN0LFxuICAgICAgRGlzcG9uaWJpbGlkYWQ6IGRpc3BMYWJlbChzdCksXG4gICAgfTtcbiAgfSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBhd2FpdCBkb3dubG9hZFhsc3goXG4gICAgJ0xpc3RhX2RlX1ByZWNpb3NfJyArIHRzICsgJy54bHN4JyxcbiAgICBbXG4gICAgICB7IG5hbWU6ICdMaXN0YSBkZSBwcmVjaW9zJywgcm93cyB9LFxuICAgICAgeyBuYW1lOiAnUHJlY2lvcycsIHJvd3M6IHByZWNpb3NSb3dzIH0sXG4gICAgICB7IG5hbWU6ICdTdG9jaycsIHJvd3M6IHN0b2NrUm93cyB9LFxuICAgIF0sXG4gICAge1xuICAgICAgLy8gUGFpbnRlciBhcGxpY2FkbyBwb3N0LXJlbmRlciBwb3IgZG93bmxvYWRYbHN4LiBQaW50YSBsYSBjb2x1bW5hXG4gICAgICAvLyBcIkRpc3BvbmliaWxpZGFkXCIgc2VndW4gc3UgdmFsb3I6IHZlcmRlK2JsYW5jbyBzaSBESVNQT05JQkxFLFxuICAgICAgLy8gcm9qbytibGFuY28gc2kgTk8gRElTUE9OSUJMRS4gQ2VudHJhZG8gKyBib2xkIHBhcmEgbGVnaWJpbGlkYWQuXG4gICAgICBjZWxsU3R5bGVyOiAoY2VsbCwgY29sdW1uTmFtZSwgX3ZhbHVlLCBfcm93SW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGNvbHVtbk5hbWUgIT09ICdEaXNwb25pYmlsaWRhZCcpIHJldHVybjtcbiAgICAgICAgY29uc3QgdHh0ID0gU3RyaW5nKGNlbGwudmFsdWUgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIGlmICh0eHQgPT09ICdESVNQT05JQkxFJykge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2QTM0QScgfSB9OyAvLyBncmVlbi02MDBcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9IGVsc2UgaWYgKHR4dCA9PT0gJ05PIERJU1BPTklCTEUnKSB7XG4gICAgICAgICAgY2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGREMyNjI2JyB9IH07IC8vIHJlZC02MDBcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH1cbiAgKTtcbiAgc2hvd1N5bmNUYWcocm93cy5sZW5ndGggKyAnIFNLVXMgZXhwb3J0YWRvcyAobGlzdGEgZGUgcHJlY2lvcyArIGRpc3BvbmliaWxpZGFkKScpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxud2luZG93LmV4cG9ydFRvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cbiAgLy8gICB2ZW5kZWRvcjogb3BlcmF0aXZvIGRpYXJpbyAoVmVudGFzIC8gVmlzaXRhcyAvIFJ1dGFzKSArIENsaWVudGVzIGRlIHN1IHpvbmFcbiAgLy8gICAgIChleHBvcnRNYXN0ZXJDbGllbnRlcyB5YSBmaWx0cmEgcG9yIGdldEVmZmVjdGl2ZVZlbmRvclNldCAtPiBzb2xvIHN1IHZlbmRvcikuXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxuICAvLyAgICAgcHJvcGlvIHNpIGVsaWdpbyBzdSBub21icmUgZW4gZWwgZHJvcGRvd24gZGUgem9uYXMpLlxuICAvLyAgIGFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogdmVuIHRvZG8gZWwgbGlzdGFkbyAobnVsbCA9IHNpbiBmaWx0cm8pLlxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBWRU5UQVMgeSBSVVRBUyBlbGltaW5hZG9zIGRlbCBVSSBwb3IgcGVkaWRvIGRlIE1hcmlhbm8uXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gIH07XG4gIGxldCBhbGxvd2VkID0gYWxsb3dlZEJ5Um9sZVt1c2VyUm9sZV0gfHwgbnVsbDsgLy8gbnVsbCA9IHZlciB0b2RvXG4gIC8vIHYxNTM3ICgyMDI2LTExLTAyKTogUEFDSEkgKHBlcmZpbCByZXN0cmluZ2lkbykgdGFtYmlcdTAwRTluIHZlIFwiUHJlY2lvcyArIFN0b2NrXCJcbiAgLy8gKGxpc3RhIGRlIHByZWNpb3MpLiBBdXRvcml6YWRvIHBvciBNYXJpYW5vLiBTb2xvIFBBQ0hJLCBubyB0b2RvcyBsb3MgVkRFLlxuICBpZiAoXG4gICAgYWxsb3dlZCAmJlxuICAgIHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICBkb2N1bWVudC5ib2R5ICYmXG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuY29udGFpbnMoJ2lzLXBhY2hpLXJlc3RyaWN0ZWQnKVxuICApIHtcbiAgICAvLyB2MTU0MzogKyBCQUNLT1JERVIgKHlhIGVzdFx1MDBFMSBlbiB2ZW5kZWRvcjsgc2UgZXhwbGljaXRhIHBvciBzaSBQQUNISVxuICAgIC8vIHR1dmllcmEgb3RybyByb2wpLiBFbCBleHBvcnQgZmlsdHJhIGEgc3VzIGNsaWVudGVzIHZcdTAwRURhIGV4cG9ydC1zY29wZS5cbiAgICBhbGxvd2VkID0gbmV3IFNldChbLi4uYWxsb3dlZCwgJ1BSRUNJT1NfU1RPQ0snLCAnQkFDS09SREVSJ10pO1xuICB9XG4gIC8vIHYxNDEzIFx1MDBBNzUxICsgdjE0MTQgXHUwMEE3NTEuMSAoMjAyNi0xMC0yMik6IElORlJBQ0NJT05FU19NRUxJIHdoaXRlbGlzdCBwb3JcbiAgLy8gZW1haWwuIE1hbnRlbmVyIHNpbmNyb25pemFkbyBjb24gY2FuUmVhZEluZnJhY2Npb25lc01lbGkoKSBkZVxuICAvLyBmaXJlc3RvcmUucnVsZXMuIFJlYWRlcnM6IE1hcmlhbm8gKDIgZW1haWxzKSArIERpZWdvIFZhbHNpLlxuICBjb25zdCBJTkZSQUNDSU9ORVNfTUVMSV9SRUFERVJTID0gW1xuICAgICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbScsXG4gICAgJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJyxcbiAgICAnZGllZ28udmFsc2lAc2hpbWFuby51eScsXG4gIF07XG4gIGNvbnN0IF9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSA9XG4gICAgdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIGN1cnJlbnRVc2VyICYmXG4gICAgSU5GUkFDQ0lPTkVTX01FTElfUkVBREVSUy5pbmNsdWRlcygoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpO1xuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICBjb25zdCBraW5kID0gZWwuZGF0YXNldC5leHBLaW5kIHx8ICcnO1xuICAgIGxldCBzaG93ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCk7XG4gICAgaWYgKGtpbmQgPT09ICdJTkZSQUNDSU9ORVNfTUVMSScgJiYgIV9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSkgc2hvdyA9IGZhbHNlO1xuICAgIGVsLnN0eWxlLmRpc3BsYXkgPSBzaG93ID8gJycgOiAnbm9uZSc7XG4gIH0pO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTW9udGggcGlja2VyIHJldXRpbGl6YWJsZSBwYXJhIGxvcyA1IHRpcG9zIGRlIGV4cG9ydFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuY29uc3QgRVhQT1JUX1RZUEVfTEFCRUxTID0ge1xuICBWRU5UQVM6ICdWZW50YXMnLFxuICBWSVNJVEFTOiAnVmlzaXRhcycsXG4gIFJFTkRJQ0lPTkVTOiAnUmVuZGljaW9uZXMnLFxuICBSVVRBUzogJ1J1dGFzJyxcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXG4gIEJBQ0tPUkRFUjogJ0JhY2tvcmRlcicsXG4gIFNUT0NLX0FTSUc6ICdTdG9jayBBc2lnbmFkbycsXG4gIFBFRElET1NfTUVTOiAnUGVkaWRvcyBkZWwgbWVzJyxcbn07XG5cbndpbmRvdy5zaG93TW9udGhQaWNrZXIgPSBmdW5jdGlvbiAodGlwbykge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSB0aXBvO1xuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXN1YnQnKTtcbiAgdGl0bGUudGV4dENvbnRlbnQgPSAnRXhwb3J0YXIgJyArIChFWFBPUlRfVFlQRV9MQUJFTFNbdGlwb10gfHwgdGlwbyk7XG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcbiAgLy8gUG9wdWxhdGUgc2VsZWN0c1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XG4gIG1lc1NlbC5pbm5lckhUTUwgPVxuICAgICc8b3B0aW9uIHZhbHVlPVwiQUxMXCI+VG9kb3MgbG9zIG1lc2VzIChhXHUwMEYxbyBlbnRlcm8pPC9vcHRpb24+JyArXG4gICAgTUVTRVMubWFwKChtLCBpKSA9PiAnPG9wdGlvbiB2YWx1ZT1cIicgKyBpICsgJ1wiPicgKyBtICsgJzwvb3B0aW9uPicpLmpvaW4oJycpO1xuICBtZXNTZWwudmFsdWUgPSBub3cuZ2V0TW9udGgoKTtcbiAgY29uc3QgYW5pb1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJyk7XG4gIGNvbnN0IHllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcbiAgbGV0IHlvcHRzID0gJyc7XG4gIGZvciAobGV0IHkgPSB5ZWFyIC0gMzsgeSA8PSB5ZWFyICsgMTsgeSsrKVxuICAgIHlvcHRzICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIHkgKyAnXCI+JyArIHkgKyAnPC9vcHRpb24+JztcbiAgYW5pb1NlbC5pbm5lckhUTUwgPSB5b3B0cztcbiAgYW5pb1NlbC52YWx1ZSA9IHllYXI7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xuXG53aW5kb3cuY2xvc2VNb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xufTtcblxud2luZG93LmNvbmZpcm1Nb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xuICBjb25zdCBtZXNSYXcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJykudmFsdWU7XG4gIGNvbnN0IGFuaW8gPSBwYXJzZUludChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpLnZhbHVlLCAxMCk7XG4gIGNvbnN0IG1vbnRoSWR4ID0gbWVzUmF3ID09PSAnQUxMJyA/IG51bGwgOiBwYXJzZUludChtZXNSYXcsIDEwKTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuICBpZiAoIXRpcG8pIHJldHVybjtcbiAgdHJ5IHtcbiAgICBpZiAodGlwbyA9PT0gJ1ZFTlRBUycpIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JFTkRJQ0lPTkVTJykgZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JVVEFTJykgZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0FMVEFTJykgZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0JBQ0tPUkRFUicpIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnU1RPQ0tfQVNJRycpIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUEVESURPU19NRVMnKSBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWRU5UQVNfQVJUX0NMSScpIGV4cG9ydFZlbnRhc0FydENsaUZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGFsZXJ0KCdUaXBvIGRlc2Nvbm9jaWRvOiAnICsgdGlwbyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnQgJyArIHRpcG8sIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gU3RyaW5nKGFuaW8pO1xuICByZXR1cm4gTUVTRVNbbW9udGhJZHhdICsgJ18nICsgYW5pbztcbn1cblxuLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWVzY3JpdG8gY29uIEV4Y2VsSlMgcGFyYSBkYXIgVUkgdW5pZm9ybWUgYSBUT0RPUyBsb3Ncbi8vIGV4cG9ydHMgKGhlYWRlciB2ZXJkZSArIGNlbGRhcyBjZW50ZXJlZCArIGJvcmRlciBzdXRpbCArIGF1dG8tZml0IHdpZHRoKS5cbi8vIEFudGVzIHVzYWJhIFhMU1ggU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmEgc2lsZW50bHkgbG9zIGVzdGlsb3MgZGUgY2VsZGEuIEVsXG4vLyBwYXR0ZXJuIHZlcmRlIHJlcGxpY2EgZWwgVE9UQUwgYmFyIGRlIGV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsIChtb2RhbFxuLy8gQmFja29yZGVyIHY3MjArKS4gRXhjZWxKUyB5YSBzZSBjYXJnYSBvbi1kZW1hbmQgdmlhIHdpbmRvdy5sb2FkRXhjZWxKUy5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzLCBvcHRzKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgd2luZG93LmxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnTm8gc2UgcHVkbyBjYXJnYXIgRXhjZWxKUzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIGNvbnN0IEhFQURFUl9GSUxMID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMTY2NTM0JyB9IH07XG4gIGNvbnN0IEhFQURFUl9GT05UID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gIGNvbnN0IENFTlRFUiA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgY29uc3QgQk9SREVSX1RISU4gPSB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9O1xuICBjb25zdCBCT1JERVIgPSB7IHRvcDogQk9SREVSX1RISU4sIGxlZnQ6IEJPUkRFUl9USElOLCBib3R0b206IEJPUkRFUl9USElOLCByaWdodDogQk9SREVSX1RISU4gfTtcbiAgLy8gdjEzNjQ6IGNlbGxTdHlsZXIgb3BjaW9uYWwgcGFyYSBjb2xvcmVhciBjZWxkYXMgcG9yIHZhbG9yIChlai4gY29sdW1uYVxuICAvLyBEaXNwb25pYmlsaWRhZCBESVNQT05JQkxFIHZlcmRlIC8gTk8gRElTUE9OSUJMRSByb2pvIGVuIGVsIGV4cG9ydFxuICAvLyBMaXN0YSBkZSBwcmVjaW9zKS4gU2lnbmF0dXJlOiAoY2VsbCwgY29sdW1uTmFtZSwgdmFsdWUsIHJvd0luZGV4KSA9PiB2b2lkLlxuICBjb25zdCBjZWxsU3R5bGVyID0gb3B0cyAmJiB0eXBlb2Ygb3B0cy5jZWxsU3R5bGVyID09PSAnZnVuY3Rpb24nID8gb3B0cy5jZWxsU3R5bGVyIDogbnVsbDtcblxuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQocy5uYW1lLnNsaWNlKDAsIDMxKSk7XG4gICAgY29uc3Qgcm93cyA9IHMucm93cy5sZW5ndGggPyBzLnJvd3MgOiBbeyBBdmlzbzogJ1NpbiBkYXRvcyBwYXJhIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvJyB9XTtcbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmtleXMocm93c1swXSk7XG5cbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5hZGRSb3coaGVhZGVycyk7XG4gICAgaGVhZGVyUm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICBjZWxsLmZpbGwgPSBIRUFERVJfRklMTDtcbiAgICAgIGNlbGwuZm9udCA9IEhFQURFUl9GT05UO1xuICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICBjZWxsLmJvcmRlciA9IEJPUkRFUjtcbiAgICB9KTtcbiAgICBoZWFkZXJSb3cuaGVpZ2h0ID0gMjY7XG5cbiAgICBmb3IgKGxldCBySWR4ID0gMDsgcklkeCA8IHJvd3MubGVuZ3RoOyBySWR4KyspIHtcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3NbcklkeF07XG4gICAgICBjb25zdCB2YWx1ZXMgPSBoZWFkZXJzLm1hcCgoaCkgPT4gKHJvd1toXSAhPT0gdW5kZWZpbmVkICYmIHJvd1toXSAhPT0gbnVsbCA/IHJvd1toXSA6ICcnKSk7XG4gICAgICBjb25zdCBkYXRhUm93ID0gd3MuYWRkUm93KHZhbHVlcyk7XG4gICAgICBkYXRhUm93LmVhY2hDZWxsKChjZWxsLCBjb2xOdW1iZXIpID0+IHtcbiAgICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgICAgICBpZiAoY2VsbFN0eWxlcikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjZWxsU3R5bGVyKGNlbGwsIGhlYWRlcnNbY29sTnVtYmVyIC0gMV0sIHZhbHVlc1tjb2xOdW1iZXIgLSAxXSwgcklkeCk7XG4gICAgICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgICAgIC8vIG5vLW9wOiBubyByb21wZXIgZWwgZXhwb3J0IHBvciB1biBlcnJvciBkZSBzdHlsZXJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGhlYWRlcnMuZm9yRWFjaCgoaCwgaSkgPT4ge1xuICAgICAgbGV0IG1heExlbiA9IFN0cmluZyhoKS5sZW5ndGg7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHYgPSBTdHJpbmcocm93W2hdID09PSB1bmRlZmluZWQgfHwgcm93W2hdID09PSBudWxsID8gJycgOiByb3dbaF0pLnNwbGl0KCdcXG4nKVswXTtcbiAgICAgICAgaWYgKHYubGVuZ3RoID4gbWF4TGVuKSBtYXhMZW4gPSB2Lmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIHdzLmdldENvbHVtbihpICsgMSkud2lkdGggPSBNYXRoLm1pbig2MCwgTWF0aC5tYXgoMTAsIG1heExlbiArIDQpKTtcbiAgICB9KTtcblxuICAgIHdzLnZpZXdzID0gW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV07XG4gIH1cblxuICBjb25zdCBidWYgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gIH0pO1xuICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICBhLmhyZWYgPSB1cmw7XG4gIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgYS5jbGljaygpO1xuICBhLnJlbW92ZSgpO1xuICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcbiAgLy8gdjE1MzQ6IGVsIHZlbmRlZG9yIGNvbnN1bHRhIHNvbG8gc3VzIHZpc2l0YXMgKGxhcyByZWdsYXMgbm8gbGUgZGVqYW5cbiAgLy8gbGlzdGFyIHRvZGFzKTsgZWwgaW50ZXJubyB2ZSBsYXMgc3V5YXMgKyBsYXMgZGUgc3VzIHBhcmVqYXMuXG4gIGNvbnN0IHNjb3BlID0gX2V4cG9ydFNjb3BlKCk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIGxldCBxID0gZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKTtcbiAgICBpZiAoc2NvcGUudmlzaXRzUXVlcnlCeU93bmVyVWlkKSB7XG4gICAgICBjb25zdCB1ID0gd2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoKCkuY3VycmVudFVzZXI7XG4gICAgICBxID0gcS53aGVyZSgnb3duZXJVaWQnLCAnPT0nLCAodSAmJiB1LnVpZCkgfHwgJ19fc2luX3VzdWFyaW9fXycpO1xuICAgIH1cbiAgICBzbmFwID0gYXdhaXQgcS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHZpc2l0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGFyZ2V0TWVzID0gbW9udGhJZHggIT09IG51bGwgPyBNRVNFU1ttb250aElkeF0udG9VcHBlckNhc2UoKSA6IG51bGw7XG4gIGNvbnN0IGFsbCA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xuICAgIGFsbC5wdXNoKHYpO1xuICB9KTtcbiAgY29uc3QgaXRlbXMgPSBzY29wZS5maWx0ZXJWaXNpdHMoYWxsKTtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgbmkgY29udGFjdG9zIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuVmlzaXRhcyA9IGl0ZW1zLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aDtcbiAgY29uc3QgbkNvbnRhY3RvcyA9IGl0ZW1zLmxlbmd0aCAtIG5WaXNpdGFzO1xuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGRlbCBmcmVudGUgZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBMYXp5IGxvYWQuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbDogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3Rvcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzIHkgQ29udGFjdG9zJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNZXMnLCBrZXk6ICdtZXMnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0FuaW8nLCBrZXk6ICdhbmlvJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ093bmVyIEVtYWlsJywga2V5OiAnZW1haWwnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0ludGVyYWNjaW9uJywga2V5OiAnaW50ZXJhY2Npb24nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0Zvcm1hIENvbnRhY3RvJywga2V5OiAnZm9ybWFDb250YWN0bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnUmVzdWx0YWRvIENvbnRhY3RvJywga2V5OiAncmVzdWx0YWRvQ3QnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0NvbWVudGFyaW8nLCBrZXk6ICdjb21lbnQnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdUaWVuZGEnLCBrZXk6ICd0aWVuZGEnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUYW1hbm8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnTmVjZXNpZGFkIFB1bnR1YWwnLCBrZXk6ICduZWMnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdNYXMgVmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdNYXMgUHJlZ3VudGFuJywga2V5OiAnbWFzUHInLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0F5dWRhIFRpZW5kYScsIGtleTogJ2F5dWRhJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIFZlbnRhJywga2V5OiAndGlwb1ZlbnRhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdQb25kIE1vc3RyYWRvcicsIGtleTogJ3BNb3N0Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQb25kIEVjb21tZXJjZScsIGtleTogJ3BFY29tJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdDb21wZXRlbmNpYScsIGtleTogJ2NvbXBlJywgd2lkdGg6IDE2IH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgU3RhdHVzJywga2V5OiAnZ3BzU3QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBEaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gZnJlbnRlJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnRW4gbm9tYnJlIGRlIFZERScsIGtleTogJ29uQmVoYWxmJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdDYXJnYWRvIFBvcicsIGtleTogJ2NyZWF0ZWRCeScsIHdpZHRoOiAyNCB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7XG4gIGNvbnN0IFJPV19IID0gMTAwO1xuICBjb25zdCBJTUdfVyA9IDEzMDtcbiAgY29uc3QgSU1HX0ggPSA5MDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IHYgb2YgaXRlbXMpIHtcbiAgICBjb25zdCBpc0NvbnRhY3RvID0gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0byc7XG4gICAgY29uc3QgaW50ZXJhY2Npb25MYmwgPSBpc0NvbnRhY3RvID8gJ0NvbnRhY3RvJyA6ICdWaXNpdGEnO1xuICAgIGNvbnN0IGZvcm1hQ29udGFjdG9MYmwgPSBpc0NvbnRhY3RvID8gdi5mb3JtYUNvbnRhY3RvIHx8ICdTaW4gZXNwZWNpZmljYXInIDogJ1ByZXNlbmNpYWwnO1xuICAgIGxldCByZXN1bHRhZG9DdExibCA9ICcnO1xuICAgIGlmIChpc0NvbnRhY3RvKSB7XG4gICAgICBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ1Jlc3BvbmRpbyc7XG4gICAgICBlbHNlIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAnbm9fcmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnTm8gcmVzcG9uZGlvJztcbiAgICAgIGVsc2UgcmVzdWx0YWRvQ3RMYmwgPSAnU2luIG1hcmNhcic7XG4gICAgfVxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXG4gICAgICBhbmlvOiB2LmFuaW8gfHwgJycsXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXG4gICAgICBpbnRlcmFjY2lvbjogaW50ZXJhY2Npb25MYmwsXG4gICAgICBmb3JtYUNvbnRhY3RvOiBmb3JtYUNvbnRhY3RvTGJsLFxuICAgICAgcmVzdWx0YWRvQ3Q6IHJlc3VsdGFkb0N0TGJsLFxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcbiAgICAgIG5lYzogdi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxuICAgICAgb3BvcnR1OiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgbWFzVmU6IHYubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgIG1hc1ByOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgIGF5dWRhOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgICBwTW9zdDogdi5wb25kZXJhY2lvbk1vc3RyYWRvIHx8ICcnLFxuICAgICAgcEVjb206IHYucG9uZGVyYWNpb25FY29tbWVyY2UgfHwgJycsXG4gICAgICBjb21wZTogdi5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIGdwc1N0OiB2Lmdwc1N0YXR1cyB8fCAnJyxcbiAgICAgIGdwc0Rpc3Q6IHYuZ3BzRGlzdGFuY2VNICE9IG51bGwgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gaW1hZ2VuIGVuY2ltYVxuICAgICAgb25CZWhhbGY6IHYub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxuICAgICAgY3JlYXRlZEJ5OiB2LmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHYuY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgfSk7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHZpc2l0YScsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19WaXNpdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgbGlzdG86ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MnLCAyNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0YXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFTkRJQ0lPTkVTOiBnYXN0b3MgeSBhbnRpY2lwb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSZW5kaWNpb25lcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcmVuZGljaW9uZXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBwb3IgbWVzL2FuaW9cbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgciA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9IHIuZmVjaGEgfHwgci5mZWNoYUdhc3RvIHx8ICcnO1xuICAgIGlmICghZHQgJiYgci5jcmVhdGVkQXQgJiYgci5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IHIuY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBjb25zdCBkT2JqID0gbmV3IERhdGUoZHQpO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oZE9iai5nZXRUaW1lKCkpKSByZXR1cm47XG4gICAgaWYgKGRPYmouZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkT2JqLmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgaXRlbXMucHVzaCh7IGlkOiBkLmlkLCBmZWNoYTogZHQsIHI6IHIgfSk7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVuZGljaW9uZXMgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBDYXJnYSBsYXp5LlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBpdGVtcy5sZW5ndGggKyAnIHJlbmRpY2lvbmVzLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1JlbmRpY2lvbmVzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnVmVuZGVkb3InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyNiB9LFxuICAgIHsgaGVhZGVyOiAnT3duZXIgRW1haWwnLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICAgIHsgaGVhZGVyOiAnQ29uY2VwdG8nLCBrZXk6ICdjb25jZXB0bycsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnTiBUaWNrZXQnLCBrZXk6ICdudW1UaWNrZXQnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ01vZG8gcGFnbycsIGtleTogJ21vZG9QYWdvJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIGdhc3RvJywga2V5OiAndGlwb0dhc3RvJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdEaXZpc2lvbicsIGtleTogJ2RpdmlzaW9uJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlJywga2V5OiAnaW1wb3J0ZScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTW9uZWRhJywga2V5OiAnbW9uZWRhJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdJbXBvcnRlIFVTRCcsIGtleTogJ2ltcG9ydGVVc2QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ09ic2VydmFjaW9uZXMnLCBrZXk6ICdvYnMnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gdGlja2V0Jywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnRXN0YWRvJywga2V5OiAnZXN0YWRvJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdBcHJvYmFkb3InLCBrZXk6ICdhcHJvYmFkb3InLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0Fwcm9iYWRvIGVuJywga2V5OiAnYXByb2JhZG9FbicsIHdpZHRoOiAxNCB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGN0UyMkNFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXG4gIGNvbnN0IFJPV19IID0gMTEwO1xuICBjb25zdCBJTUdfVyA9IDE0MDtcbiAgY29uc3QgSU1HX0ggPSAxMDA7XG5cbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykge1xuICAgIGNvbnN0IHIgPSBpdC5yO1xuICAgIGNvbnN0IGlzR2FzdG8gPSByLnRpcG8gPT09ICdnYXN0byc7XG4gICAgY29uc3QgY29uY2VwdFN0ciA9IGlzR2FzdG8gPyByLmRlc2NyaXBjaW9uIHx8ICcnIDogci50aXBvT3BlcmFjaW9uIHx8IHIubW90aXZvIHx8ICcnO1xuICAgIGNvbnN0IG9ic1N0ciA9XG4gICAgICAoci5vYnNlcnZhY2lvbmVzIHx8IHIubm90YXMgfHwgJycpICtcbiAgICAgIChpc0dhc3RvID8gJycgOiByLnNvbGljaXRhZG9Qb3IgPyAnIHwgU29saWNpdGFkbyBwb3I6ICcgKyByLnNvbGljaXRhZG9Qb3IgOiAnJyk7XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiBpdC5mZWNoYSxcbiAgICAgIHRpcG86IHIudGlwbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiByLm93bmVyTmFtZSB8fCByLnZlbmRvck5hbWUgfHwgci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgZW1haWw6IHIub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGNvbmNlcHRvOiBjb25jZXB0U3RyLFxuICAgICAgbnVtVGlja2V0OiByLm51bWVyb1RpY2tldCB8fCAnJyxcbiAgICAgIG1vZG9QYWdvOiByLm1vZG9QYWdvIHx8ICcnLFxuICAgICAgdGlwb0dhc3RvOiByLnRpcG9HYXN0byB8fCAnJyxcbiAgICAgIGRpdmlzaW9uOiByLmRpdmlzaW9uR2FzdG8gfHwgJycsXG4gICAgICBpbXBvcnRlOiByLmltcG9ydGUgIT0gbnVsbCA/IHIuaW1wb3J0ZSA6ICcnLFxuICAgICAgbW9uZWRhOiByLm1vbmVkYSB8fCAnUEVTT1MnLFxuICAgICAgaW1wb3J0ZVVzZDogci5pbXBvcnRlVXNkICE9IG51bGwgJiYgci5pbXBvcnRlVXNkICE9PSAwID8gci5pbXBvcnRlVXNkIDogJycsXG4gICAgICBvYnM6IG9ic1N0cixcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGVuY2ltYSB2YSBsYSBpbWFnZW5cbiAgICAgIGVzdGFkbzogci5zdGF0dXMgfHwgci5lc3RhZG8gfHwgJycsXG4gICAgICBhcHJvYmFkb3I6IHIuYXBwcm92ZXJFbWFpbCB8fCByLmFwcm9iYWRvciB8fCAnJyxcbiAgICAgIGFwcm9iYWRvRW46XG4gICAgICAgIHIuYXBwcm92ZWRBdCAmJiByLmFwcHJvdmVkQXQudG9EYXRlID8gci5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgfSk7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogU0lFTVBSRSBlbWJlYmVyIGxhIGZvdG8gKG5vIGRlamFyIGh5cGVybGluaykuXG4gICAgLy8gQW50ZXM6IHNpIGZvdG9UaWNrZXRVcmwgKFN0b3JhZ2UpLCBxdWVkYWJhIGNvbW8gaHlwZXJsaW5rIEFicmlyIHRpY2tldC5cbiAgICAvLyBBaG9yYTogZmV0Y2ggZGVsIFVSTCArIGNvbnZlcnRpciBhIGFycmF5QnVmZmVyICsgZW1iZWJlciBpZ3VhbCBxdWUgZGF0YVVSTC5cbiAgICAvLyBGYWxsYmFjayBhIGh5cGVybGluayBzb2xvIHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQsIGV0YykuXG4gICAgY29uc3QgZm90b1NyYyA9IHIuZm90b1RpY2tldCB8fCByLmFkanVudG8gfHwgJyc7XG4gICAgaWYgKGZvdG9TcmMgJiYgdHlwZW9mIGZvdG9TcmMgPT09ICdzdHJpbmcnICYmIGZvdG9TcmMuc3RhcnRzV2l0aCgnZGF0YTppbWFnZS8nKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IGZvdG9TcmM7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gcmVuZGljaW9uJywgaXQuaWQsIGUpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoci5mb3RvVGlja2V0VXJsICYmIHR5cGVvZiByLmZvdG9UaWNrZXRVcmwgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogZmV0Y2ggbGEgZm90byBkZXNkZSBTdG9yYWdlIHkgZW1iZWJlcmxhIGNvbW8gaW1hZ2VuLlxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKHIuZm90b1RpY2tldFVybCk7XG4gICAgICAgIGlmICghcmVzcC5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByZXNwLnN0YXR1cyk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcC5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykgfHwgJ2ltYWdlL2pwZWcnO1xuICAgICAgICBsZXQgZXh0ID0gY29udGVudFR5cGUuc3BsaXQoJy8nKVsxXSB8fCAnanBlZyc7XG4gICAgICAgIGV4dCA9IGV4dC5zcGxpdCgnOycpWzBdLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBidWYgPSBhd2FpdCByZXNwLmFycmF5QnVmZmVyKCk7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJ1ZmZlcjogYnVmLCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gRmFsbGJhY2s6IHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQpLCBkZWphciBoeXBlcmxpbmsgY29tbyBhbnRlcy5cbiAgICAgICAgY29uc29sZS53YXJuKCdmZXRjaCBmb3RvIHJlbmRpY2lvbiBmYWxsbywgZGVqbyBoeXBlcmxpbmsnLCBpdC5pZCwgZSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgY2VsbCA9IHJvdy5nZXRDZWxsKEZPVE9fQ09MX0lEWCArIDEpO1xuICAgICAgICAgIGNlbGwudmFsdWUgPSB7XG4gICAgICAgICAgICB0ZXh0OiAnQWJyaXIgdGlja2V0JyxcbiAgICAgICAgICAgIGh5cGVybGluazogci5mb3RvVGlja2V0VXJsLFxuICAgICAgICAgICAgdG9vbHRpcDogJ0FicmlyIGxhIGZvdG8gZGVsIHRpY2tldCBlbiBlbCBicm93c2VyIChmZXRjaCBmYWxsbyknLFxuICAgICAgICAgIH07XG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkYwNTYzQzEnIH0sIHVuZGVybGluZTogdHJ1ZSB9O1xuICAgICAgICB9IGNhdGNoIChfZTIpIHt9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1JlbmRpY2lvbmVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUmVuZGljaW9uZXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSdXRhcy4uLicpO1xuICAvLyBMYXMgcnV0YXMgc2UgZ2VuZXJhbiBlbiBydW50aW1lIHBhcmEgY2FkYSB2ZW5kZWRvcjsgZW4gY2FtYmlvIGxvcyBvdmVycmlkZXNcbiAgLy8gKGRlcml2YWNpb25lcyAvIHJlYWdlbmRhcykgdml2ZW4gZW4gcm91dGVfb3ZlcnJpZGVzLiBFeHBvcnRhbW9zOlxuICAvLyAgLSB1bmEgaG9qYSBjb24gbGFzIHJ1dGFzIHBsYW5pZmljYWRhcyBkZWwgcGVyaW9kbyAocGFyYSBsb3MgdmVuZGVkb3Jlc1xuICAvLyAgICBkZWwgcm9sIGFjdHVhbCBvIHRvZG9zIHNpIGFkbWluKVxuICAvLyAgLSB1bmEgaG9qYSBjb24gbG9zIG92ZXJyaWRlcyBkZWwgcGVyaW9kb1xuICBjb25zdCB0YXJnZXRWZW5kb3JzID1cbiAgICB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ3ZpZXdlcidcbiAgICAgID8gVkVORE9SUy5tYXAoKHYpID0+IHYua2V5KVxuICAgICAgOiBhc3NpZ25lZFZlbmRvclxuICAgICAgICA/IFthc3NpZ25lZFZlbmRvcl1cbiAgICAgICAgOiBbXTtcbiAgY29uc3QgbW9udGhzVG9FeHBvcnQgPSBtb250aElkeCAhPT0gbnVsbCA/IFttb250aElkeF0gOiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgNywgOCwgOSwgMTAsIDExXTtcbiAgY29uc3QgcnV0YXNSb3dzID0gW107XG4gIGZvciAoY29uc3QgdmVuZCBvZiB0YXJnZXRWZW5kb3JzKSB7XG4gICAgZm9yIChjb25zdCBtIG9mIG1vbnRoc1RvRXhwb3J0KSB7XG4gICAgICBsZXQgcnV0YXM7XG4gICAgICB0cnkge1xuICAgICAgICBydXRhcyA9IGdlbmVyYXJSdXRhc1ZlbmRvcih2ZW5kLCBtLCBhbmlvKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIHJ1dGFzID0gW107XG4gICAgICB9XG4gICAgICAocnV0YXMgfHwgW10pLmZvckVhY2goKHJ1dGEpID0+IHtcbiAgICAgICAgKHJ1dGEudGllbmRhcyB8fCBbXSkuZm9yRWFjaCgodCwgaSkgPT4ge1xuICAgICAgICAgIHJ1dGFzUm93cy5wdXNoKHtcbiAgICAgICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZCksXG4gICAgICAgICAgICBBbmlvOiBhbmlvLFxuICAgICAgICAgICAgTWVzOiBNRVNFU1ttXSxcbiAgICAgICAgICAgIFJ1dGFfSUQ6IHJ1dGEuaWQgfHwgJycsXG4gICAgICAgICAgICBSdXRhX05vbWJyZTogcnV0YS5ub21icmUgfHwgJycsXG4gICAgICAgICAgICBGZWNoYV9Bc2lnbmFkYTogcnV0YS5mZWNoYUFzaWduYWRhIHx8ICcnLFxuICAgICAgICAgICAgT3JkZW46IGkgKyAxLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UodC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgICAgICBMb2NhbGlkYWQ6IHQubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgICAgIFRpZW5kYTogdC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGlwbzogdC50aXBvIHx8ICcnLFxuICAgICAgICAgICAgRXN0YWRvOiB0LmVzdGFkbyB8fCAnJyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gT3ZlcnJpZGVzXG4gIGxldCBvdnJTbmFwO1xuICB0cnkge1xuICAgIG92clNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvdXRlX292ZXJyaWRlcycpLmdldCgpO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG92clNuYXAgPSBudWxsO1xuICB9XG4gIGNvbnN0IG92ZXJyaWRlc1Jvd3MgPSBbXTtcbiAgaWYgKG92clNuYXApIHtcbiAgICBvdnJTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGNvbnN0IG8gPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgIGlmIChwYXJzZUludChvLmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KG8ubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICAgIG92ZXJyaWRlc1Jvd3MucHVzaCh7XG4gICAgICAgIEFuaW86IG8uYW5pbyB8fCAnJyxcbiAgICAgICAgTWVzOiBNRVNFU1twYXJzZUludChvLm1vbnRoSWR4LCAxMCldIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKG8udmVuZG9yIHx8ICcnKSxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uoby5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBUaWVuZGE6IG8uY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQWNjaW9uOiBvLmFjdGlvbiB8fCBvLnRpcG8gfHwgJycsXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxuICAgICAgICBSZWFnZW5kYWRhX1BhcmE6IG8ucmVhZ2VuZGFkYVBhcmEgfHwgJycsXG4gICAgICAgIE1vdGl2bzogby5tb3Rpdm8gfHwgJycsXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgICAgIENyZWFkb19FbjpcbiAgICAgICAgICBvLmNyZWF0ZWRBdCAmJiBvLmNyZWF0ZWRBdC50b0RhdGUgPyBvLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19SdXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUnV0YXMgcGxhbmlmaWNhZGFzJywgcm93czogcnV0YXNSb3dzIH0sXG4gICAgeyBuYW1lOiAnRGVyaXZhY2lvbmVzLVJlYWdlbmRhcycsIHJvd3M6IG92ZXJyaWRlc1Jvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUnV0YXMgbGlzdG8gKCcgKyBydXRhc1Jvd3MubGVuZ3RoICsgJyB0aWVuZGFzLCAnICsgb3ZlcnJpZGVzUm93cy5sZW5ndGggKyAnIG92ZXJyaWRlcyknLFxuICAgIDI0MDBcbiAgKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEFsdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQWx0YXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gJyc7XG4gICAgaWYgKGEuY3JlYXRlZEF0ICYmIGEuY3JlYXRlZEF0LnRvRGF0ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZHQgPSBhLmNyZWF0ZWRBdC50b0RhdGUoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBpZiAoIWR0KSByZXR1cm47XG4gICAgaWYgKGR0LmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZHQuZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfU29saWNpdHVkOiBkdC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSxcbiAgICAgIEVzdGFkbzogYS5zdGF0dXMgfHwgJycsXG4gICAgICBDb21lcmNpbzogYS5jb21lcmNpbyB8fCAnJyxcbiAgICAgIEZhbnRhc2lhOiBhLmZhbnRhc2lhIHx8ICcnLFxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxuICAgICAgQ29uZGljaW9uX0Zpc2NhbDogYS5jb25kRmlzY2FsIHx8ICcnLFxuICAgICAgQ2FsbGU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOdW1lcm86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBhLmxvY2FsaWRhZCB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYS5wcm92aW5jaWEgfHwgJycsXG4gICAgICBDUDogYS5jcCB8fCAnJyxcbiAgICAgIFRlbGVmb25vOiBhLnRlbGVmb25vIHx8ICcnLFxuICAgICAgRW1haWw6IGEuZW1haWwgfHwgJycsXG4gICAgICBWZW5kZWRvcl9Tb2xpY2l0YW50ZTogYS52ZW5kb3JOYW1lIHx8IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIE93bmVyX0VtYWlsOiBhLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBTdWJtaXR0ZWRfQnlfUHVibGljX0Zvcm06IGEuc3VibWl0dGVkQnlQdWJsaWNGb3JtID8gJ1NJJyA6ICdOTycsXG4gICAgICBBcHJvYmFkb19Qb3I6IGEuYXBwcm92ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgQXByb2JhZG9fRW46XG4gICAgICAgIGEuYXBwcm92ZWRBdCAmJiBhLmFwcHJvdmVkQXQudG9EYXRlID8gYS5hcHByb3ZlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICBSZWNoYXphZG9fTW90aXZvOiBhLnJlamVjdGVkUmVhc29uIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19BbHRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQWx0YXMgZGUgY2xpZW50ZXMnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBBbHRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBzb2xpY2l0dWRlcyknLCAyNDAwKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyB2NzA5ICgyMDI2LTA4LTI4KTogMyBleHBvcnRzIG51ZXZvcyBwZWRpZG9zIHBvciBNYXJpYW5vLlxuLy8gLSBCQUNLT1JERVI6IGxpbmVhcyBzdGF0ZT1CTyBvcGVuIHBvciBtZXMgZGUgY3JlYXRlZEF0IGRlbCBwZWRpZG8uXG4vLyAtIFNUT0NLX0FTSUc6IGxpbmVhcyBBU0lHIG9wZW4gKG8gQk8rc3RvY2sgZGlzcCkgcG9yIG1lcyBkZSBjcmVhdGVkQXQuXG4vLyAtIFBFRElET1NfTUVTOiBUT0RPUyBsb3MgcGVkaWRvcyBjcmVhZG9zIGVuIGVsIG1lcy9hbmlvIChjdWFscXVpZXIgc3RhZ2UpLlxuLy8gRnVlbnRlOiBnbG9iYWxQZWRpZG9zIChsbyBxdWUgbGEgYXBwIHlhIHRpZW5lIGVuIG1lbW9yaWEpLlxuLy8gRmlsdGVyIG1lcy9hXHUwMEYxbzogc29icmUgY3JlYXRlZEF0IGRlbCBwZWRpZG8uIG1vbnRoSWR4PW51bGwgLT4gYVx1MDBGMW8gZW50ZXJvLlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5mdW5jdGlvbiBfcGVkaWRvTW9udGhZZWFyKHApIHtcbiAgY29uc3QgY2EgPSBwLmNyZWF0ZWRBdDtcbiAgaWYgKCFjYSkgcmV0dXJuIHsgeTogbnVsbCwgbTogbnVsbCB9O1xuICBsZXQgZHQgPSBudWxsO1xuICBpZiAodHlwZW9mIGNhID09PSAnc3RyaW5nJykgZHQgPSBuZXcgRGF0ZShjYSk7XG4gIGVsc2UgaWYgKHR5cGVvZiBjYS50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0cnkge1xuICAgICAgZHQgPSBjYS50b0RhdGUoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBlbHNlIGlmICh0eXBlb2YgY2EgPT09ICdudW1iZXInKSBkdCA9IG5ldyBEYXRlKGNhKTtcbiAgaWYgKCFkdCB8fCBOdW1iZXIuaXNOYU4oZHQuZ2V0VGltZSgpKSkgcmV0dXJuIHsgeTogbnVsbCwgbTogbnVsbCB9O1xuICByZXR1cm4geyB5OiBkdC5nZXRGdWxsWWVhcigpLCBtOiBkdC5nZXRNb250aCgpIH07XG59XG5cbmZ1bmN0aW9uIF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCwgc2NvcGUpIHtcbiAgY29uc3QgYXJyID1cbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgLy8gdjE1MzQ6IGFsY2FuY2UgcG9yIHJvbCAodmVuZGVkb3IgPSBjbGllbnRlcyBkZSBzdSBtYXN0ZXI7IGludGVybm8gPSBwYXJlamFzKS5cbiAgLy8gUHJpbWVybyBlbCBtZXMgKGJhcmF0bykgeSBkZXNwdVx1MDBFOXMgZWwgYWxjYW5jZSAocmVzdWVsdmUgZWwgbWFzdGVyIHBvciBjbGllbnRlKS5cbiAgY29uc3QgZGVsTWVzID0gYXJyLmZpbHRlcigocCkgPT4ge1xuICAgIGlmICghcCkgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IHsgeSwgbSB9ID0gX3BlZGlkb01vbnRoWWVhcihwKTtcbiAgICBpZiAoeSA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHkgIT09IGFuaW8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgbSAhPT0gbW9udGhJZHgpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG4gIGNvbnN0IHNjID0gc2NvcGUgfHwgX2V4cG9ydFNjb3BlKCk7XG4gIHJldHVybiBzYy5maWx0ZXJQZWRpZG9zKGRlbE1lcyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlci4uLicpO1xuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8uIEZpbHRyYSBwb3IgbWVzIHZcdTAwRURhIGZpbHRlcnMubWVzWVlZWU1NXG4gIC8vIChxdWUgZWwgbVx1MDBGM2R1bG8gYXBsaWNhIHNvYnJlIGNvbmZpcm1lZEF0KS4gQ29pbmNpZGUgY29uIGVsIG1vZGFsLlxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IG1lc1lZWVlNTSA9IGFuaW8gKyAnLScgKyBTdHJpbmcobW9udGhJZHggKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgLy8gdjExMDEgKDIwMjYtMDktMzApOiBidXNjYXIgcHJpbWVybyBwb3Igc2FwQ2FyZENvZGUgKFx1MDBGQW5pY28sIG5vIGRlcGVuZGUgZGVcbiAgLy8gbm9ybWFsaXphY2lcdTAwRjNuIGRlIHN0cmluZ3MpIHkgc1x1MDBGM2xvIGNhZXIgYWwgY2xpZW50TG9jSWQgY29tbyBcdTAwRkFsdGltbyByZWN1cnNvLlxuICAvLyBWZXIgY29tZW50YXJpbyBleHRlbmRpZG8gZW4gaW5kZXguaHRtbDpleHBvcnRCYWNrb3JkZXJzVG9FeGNlbC5cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlID0gdy5jbGllbnRNYXN0ZXJDYWNoZTtcbiAgICAgIGlmICghY2FjaGUpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNjID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmIChjYyAmJiB0eXBlb2YgY2FjaGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBsZXQgZm91bmQgPSAnJztcbiAgICAgICAgY2FjaGUuZm9yRWFjaCgoY21EYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm47XG4gICAgICAgICAgaWYgKGNtRGF0YSAmJiBTdHJpbmcoY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCkgPT09IGNjICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikge1xuICAgICAgICAgICAgZm91bmQgPSBjbURhdGEuYXNzaWduZWRWZW5kb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIGNhY2hlLmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICAgIGNvbnN0IGNtRGF0YSA9IGNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgcGVkaWRvcyxcbiAgICAgICAgJ3VyZ2VudGUnLFxuICAgICAgICB7IG1lc1lZWVlNTSB9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxbyA9IGMucXR5QmFja29yZGVyIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgY2FudGlkYWRQZWRpZGEgPSBxbztcbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgICAgY2FudGlkYWRQZWRpZGEgPSBOdW1iZXIocC5saW5lc1tpZHhdLnF0eSkgfHwgcW87XG4gICAgICAgIGxpbmVhSWR4ID0gaWR4O1xuICAgICAgfVxuICAgIH1cbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9QZWRpZGE6IGNhbnRpZGFkUGVkaWRhLFxuICAgICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBxbyxcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcbiAgICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZChxbyAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl8nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnQmFja29yZGVyJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0U3RvY2tBc2lnRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8uLi4nKTtcbiAgLy8gdjExMDA6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvIG1vZG8gYXNpZ25hY2lvbi4gQ29pbmNpZGUgY29uIGVsIG1vZGFsLlxuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4KTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IG1lc1lZWVlNTSA9IGFuaW8gKyAnLScgKyBTdHJpbmcobW9udGhJZHggKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgLy8gdjExMDEgKDIwMjYtMDktMzApOiBidXNjYXIgcHJpbWVybyBwb3Igc2FwQ2FyZENvZGUgKFx1MDBGQW5pY28sIG5vIGRlcGVuZGUgZGVcbiAgLy8gbm9ybWFsaXphY2lcdTAwRjNuIGRlIHN0cmluZ3MpIHkgc1x1MDBGM2xvIGNhZXIgYWwgY2xpZW50TG9jSWQgY29tbyBcdTAwRkFsdGltbyByZWN1cnNvLlxuICAvLyBWZXIgY29tZW50YXJpbyBleHRlbmRpZG8gZW4gaW5kZXguaHRtbDpleHBvcnRCYWNrb3JkZXJzVG9FeGNlbC5cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlID0gdy5jbGllbnRNYXN0ZXJDYWNoZTtcbiAgICAgIGlmICghY2FjaGUpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNjID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmIChjYyAmJiB0eXBlb2YgY2FjaGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBsZXQgZm91bmQgPSAnJztcbiAgICAgICAgY2FjaGUuZm9yRWFjaCgoY21EYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm47XG4gICAgICAgICAgaWYgKGNtRGF0YSAmJiBTdHJpbmcoY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCkgPT09IGNjICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikge1xuICAgICAgICAgICAgZm91bmQgPSBjbURhdGEuYXNzaWduZWRWZW5kb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIGNhY2hlLmdldCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICAgIGNvbnN0IGNtRGF0YSA9IGNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgcGVkaWRvcyxcbiAgICAgICAgJ2FzaWduYWNpb24nLFxuICAgICAgICB7IG1lc1lZWVlNTSB9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxdHkgPSBjLnF0eUFzaWduYWRhIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xuICAgIH1cbiAgICBsZXQgZXN0YWRvUmVhbCA9ICdBU0lHJztcbiAgICBpZiAoYy5zdGF0ZSA9PT0gJ0JPJykgZXN0YWRvUmVhbCA9ICdCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRyknO1xuICAgIGVsc2UgaWYgKGMuc3RhdGUgPT09ICdjb25maXJtZWQnKSBlc3RhZG9SZWFsID0gJ2NvbmZpcm1lZCAoU1EgZW4gU0FQKSc7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXG4gICAgICBNZXM6IChwICYmIHAubW9udGgpIHx8ICcnLFxuICAgICAgQ2xpZW50ZTogYy5ub21icmUgfHwgJycsXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBjLnByb3ZpbmNpYSB8fCAocCAmJiBwLnByb3ZpbmNlKSB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYy5jaXVkYWQgfHwgKHAgJiYgcC5sb2NOYW1lKSB8fCAnJyxcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcbiAgICAgIFNLVTogcmwuc2t1IHx8ICcnLFxuICAgICAgUHJvZHVjdG86IHJsLnByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ2FudGlkYWRfUmVzZXJ2YWRhOiBxdHksXG4gICAgICBFc3RhZG9fUmVhbDogZXN0YWRvUmVhbCxcbiAgICAgIFByZWNpb19Vbml0X0FSUzogYy5wcmVjaW8gfHwgMCxcbiAgICAgIFN1YnRvdGFsX1Jlc2VydmFkb19BUlM6IE1hdGgucm91bmQocXR5ICogKGMucHJlY2lvIHx8IDApKSxcbiAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXG4gICAgfSk7XG4gIH0pO1xuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG4vLyB2NzM3ICgyMDI2LTA4LTMwKTogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG9zIGxvcyBiYWNrb3JkZXJzIG9wZW4gKHNpbiBmaWx0cm9cbi8vIGRlIG1lcykuIE1vdGl2bzogbG9zIDYyIHBlZGlkb3MgbWlncmFkb3MgZGVzZGUgU0FQIGVsIDIwMjYtMDgtMjggdGllbmVuXG4vLyBjcmVhdGVkQXQgZGUgZmVjaGFzIHZpZWphcyBkZWwgU0FQIFNRIG9yaWdpbmFsLCBlbnRvbmNlcyBlbCBleHBvcnQgcG9yIG1lc1xuLy8gbm8gbG9zIGluY2x1aWEuIFZlcnNpb24gXCJjdXJyZW50IHN0YXR1c1wiIHF1ZSBpdGVyYSBnbG9iYWxQZWRpZG9zIGNvbXBsZXRvLlxud2luZG93LmV4cG9ydEJhY2tvcmRlckFsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XG4gIC8vIHYxNDg4IFx1MDBBNzg2ICgyMDI2LTEwLTI3IEJVRyBGSVgpOiB1c2FyIGxhIE1JU01BIHB1cmUgZm4gcXVlIGVsIG1vZGFsIGV4cG9ydFxuICAvLyAoYGNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzYCkuIEFudGVzIHYxNDg4OiBwYW5lbCB1c2FiYVxuICAvLyBgY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzKHt9KWAgc2luIGBpbmNsdWRlRXhwaXJlZGAgXHUyMTkyIG9jdWx0YWJhIEJPcyA+IDkwZC5cbiAgLy8gTW9kYWwgdXNhYmEgYGNvbXB1dGVCYWNrb3JkZXJTa3VNYXAoLi4uLCB7aW5jbHVkZUV4cGlyZWQ6dHJ1ZX0pYCBcdTIxOTIgbG9zXG4gIC8vIGluY2x1XHUwMEVEYS4gRGVsdGEgbWVkaWRvIGVuIHByb2Q6IDIyMiB1bmlkYWRlcyAobW9kYWwgNzY5NiB2cyBwYW5lbCA3NDc0KS5cbiAgLy8gRml4OiBwdXJlIGZuIFx1MDBGQW5pY2EgY29uIGRlZmF1bHQgYGluY2x1ZGVFeHBpcmVkPXRydWVgIChhbGluZWFkbyBjb24gXHUwMEE3NDAuMVxuICAvLyB5IGdldFN0b2NrQnJlYWtkb3duLmJhY2tvcmRlckFwcC50b3RhbCBcdTIwMTQgbGEgY29sYSBjb21wbGV0YSkuXG4gIC8vIHYxNTM0OiBhbGNhbmNlIHBvciByb2wgKHZlbmRlZG9yID0gY2xpZW50ZXMgZGUgc3UgbWFzdGVyOyBpbnRlcm5vID0gcGFyZWphcykuXG4gIGNvbnN0IGFyciA9IF9leHBvcnRTY29wZSgpLmZpbHRlclBlZGlkb3MoXG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW11cbiAgKTtcbiAgY29uc3QgdG90YWxQZWRpZG9zT3BlbiA9IGFyci5maWx0ZXIoKHApID0+IHAgJiYgIXAuY2xvc2VkQXQpLmxlbmd0aDtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdyk7XG4gICAgICBpZiAodHlwZW9mIHcuY2xpZW50TG9jSWQgIT09ICdmdW5jdGlvbicgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUgfHwgIXcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjbURvY0lkID0gdy5jbGllbnRMb2NJZChwLnByb3ZpbmNlIHx8ICcnLCBwLmxvY05hbWUgfHwgJycsIHAuY2xpZW50TmFtZSB8fCAnJyk7XG4gICAgICBjb25zdCBjbURhdGEgPSB3LmNsaWVudE1hc3RlckNhY2hlLmdldChjbURvY0lkKTtcbiAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogcHVyZSBmbiBcdTAwRkFuaWNhIGBjb21wdXRlQmFja29yZGVyRXhwb3J0Um93c2AgKHJlZW1wbGF6YSBlbFxuICAvLyBwYXRoIGhpc3RcdTAwRjNyaWNvIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXNgIHF1ZSBubyBjb25zb2xpZGFiYSB5IHBlcmRcdTAwRURhXG4gIC8vIEJPcyA+IDkwZCkuIFBhbmVsIHBhc2EgYHt9YCBcdTIxOTIgdHJhZSB0b2RhIGxhIGNvbGEgc2luIGZpbHRyb3MgbWFudWFsZXMuXG4gIGNvbnN0IF9leHBvcnRGbiA9XG4gICAgdy5fX3BoYXNlMCAmJlxuICAgIHcuX19waGFzZTAucHVyZSAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0LmNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzO1xuICBjb25zdCBkZXBzID0ge1xuICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICBjYW5vblZlbmRvcjpcbiAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9leHBvcnRSZXN1bHQgPSBfZXhwb3J0Rm5cbiAgICA/IF9leHBvcnRGbihhcnIsIHt9LCBkZXBzKVxuICAgIDogeyByb3dzOiBbXSwgdG90YWxVbmlkYWRlczogMCwgdG90YWxGaWxhczogMCwgZmlsdHJvc0FwbGljYWRvczoge30gfTtcbiAgY29uc3Qgcm93cyA9IF9leHBvcnRSZXN1bHQucm93cztcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoXG4gICAgICAnRXhwb3J0IEJhY2tvcmRlciB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlCYWNrb3JkZXI+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IGJhY2tvcmRlciBhYmllcnRvIGFob3JhIG1pc21vICh0b2RvIGNvbmZpcm1lZCwgY2VycmFkbyBvIHZlbmNpZG8pXFxuJyArXG4gICAgICAgICcyLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbyBwb3IgZXJyb3JcXG4nICtcbiAgICAgICAgJzMuIFRvZGFzIGxhcyBsaW5lYXMgQk8gdGllbmVuIHN0b2NrIGRpc3BvbmlibGUgKGZ1ZXJvbiBwcm9tb3ZpZGFzIGEgQVNJRyB2aXJ0dWFsKSdcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgQmFja29yZGVyOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5DbGllbnRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSB8fCAnJykpO1xuICAvLyB2MTM2NiAoMjAyNi0xMC0xOSk6IGhvamEgXCJSZXN1bWVuXCIgY29uIGxvcyBNSVNNT1MgdG90YWxlcyBxdWUgZWwgbW9kYWxcbiAgLy8gQmFja29yZGVyIChjb21wdXRlQmFja29yZGVyU2t1TWFwIHBvc3QtY29uc29saWRhY2lvbiBwb3IgY2xpZW50ZSkuIEFudGVzXG4gIC8vIGVsIGV4cG9ydCBkdW1wZWFiYSBsaW5lYXMgY3J1ZGFzIHNpbiBuaW5ndW4gdG90YWwgXHUyMTkyIE1hcmlhbm8gc3VtYWJhIGxhXG4gIC8vIGNvbHVtbmEgU3VidG90YWxfQk9fQVJTIHkgZWwgdmFsb3IgcG9kaWEgZGl2ZXJnZXIgZGVsIG1vZGFsIGN1YW5kbyB1blxuICAvLyBjbGllbnRlIHRlbmlhIHZhcmlhcyBsaW5lYXMgQk8gZGVsIG1pc21vIFNLVSBjb24gcHJlY2lvcyBkaXN0aW50b3MgKGVsXG4gIC8vIG1vZGFsIGNvbnNvbGlkYSB1c2FuZG8gZWwgcHJlY2lvIGRlIGxhIDFyYSBsaW5lYSBwcm9jZXNhZGE7IGVsIGV4cG9ydFxuICAvLyB1c2EgZWwgcHJlY2lvIGRlIGNhZGEgbGluZWEgaW5kaXZpZHVhbCkuXG4gIGNvbnN0IF9jb21wdXRlU2t1TWFwRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclNrdU1hcDtcbiAgY29uc3QgX21vZGFsRGVwcyA9IHtcbiAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgY2Fub25WZW5kb3I6XG4gICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgYmFja29yZGVyTGluZXM6IEFycmF5LmlzQXJyYXkody5iYWNrb3JkZXJMaW5lcykgPyB3LmJhY2tvcmRlckxpbmVzIDogW10sXG4gICAgc2FwR2V0Q2xpZW50ZUNvZGU6IHR5cGVvZiB3LnNhcEdldENsaWVudGVDb2RlID09PSAnZnVuY3Rpb24nID8gdy5zYXBHZXRDbGllbnRlQ29kZSA6IHVuZGVmaW5lZCxcbiAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gIH07XG4gIGNvbnN0IF9tb2RhbEZpbHRlcnMgPSB7XG4gICAgdGllbmRhUXVlcnk6ICcnLFxuICAgIHZlbmRvcktleTogJycsXG4gICAgbWVzWVlZWU1NOiAnJyxcbiAgICB1cmdlbmN5RmlsdGVyOiAnJyxcbiAgICBpbmNsdWRlRXhwaXJlZDogdHJ1ZSxcbiAgICBhZ2dyZWdhdGlvbk1vZGU6ICdmaWZvJyxcbiAgfTtcbiAgY29uc3QgX21vZGFsUmVzdWx0ID0gX2NvbXB1dGVTa3VNYXBGblxuICAgID8gX2NvbXB1dGVTa3VNYXBGbihhcnIsICd1cmdlbnRlJywgX21vZGFsRmlsdGVycywgX21vZGFsRGVwcylcbiAgICA6IHsgc2t1czogW10sIHRvdGFsVW5pZGFkZXM6IDAsIHRvdGFsQ2xpZW50ZXM6IDAgfTtcbiAgbGV0IHRvdGFsUGVzb3NNb2RhbCA9IDA7XG4gIGNvbnN0IHN1YnRvdGFsZXNQb3JVcmdlbmN5ID0geyB1cmdlbnRlOiAwLCBwYXJjaWFsOiAwIH07XG4gIGZvciAoY29uc3QgZyBvZiBfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkge1xuICAgIGNvbnN0IHVyZyA9IGcudXJnZW5jeSB8fCAndXJnZW50ZSc7XG4gICAgZm9yIChjb25zdCBjIG9mIGcuY2xpZW50ZXMgfHwgW10pIHtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihjLnF0eUJhY2tvcmRlcikgfHwgMDtcbiAgICAgIGlmIChxdHkgPD0gMCkgY29udGludWU7XG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIoYy5wcmVjaW8pIHx8IDA7XG4gICAgICBjb25zdCBzdWIgPSBxdHkgKiBwcmVjaW87XG4gICAgICB0b3RhbFBlc29zTW9kYWwgKz0gc3ViO1xuICAgICAgaWYgKHVyZyA9PT0gJ3BhcmNpYWwnKSBzdWJ0b3RhbGVzUG9yVXJnZW5jeS5wYXJjaWFsICs9IHN1YjtcbiAgICAgIGVsc2Ugc3VidG90YWxlc1BvclVyZ2VuY3kudXJnZW50ZSArPSBzdWI7XG4gICAgfVxuICB9XG4gIGNvbnN0IHRvdGFsVW5pZGFkZXNNb2RhbCA9IF9leHBvcnRSZXN1bHQudG90YWxVbmlkYWRlcyB8fCBfbW9kYWxSZXN1bHQudG90YWxVbmlkYWRlcyB8fCAwO1xuICBjb25zdCB0b3RhbENsaWVudGVzTW9kYWwgPSBfbW9kYWxSZXN1bHQudG90YWxDbGllbnRlcyB8fCAwO1xuICBjb25zdCB0b3RhbFNrdXNNb2RhbCA9IChfbW9kYWxSZXN1bHQuc2t1cyB8fCBbXSkubGVuZ3RoO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogZmlsYSBkZSBlbmNhYmV6YWRvIFwiRmlsdHJvcyBhcGxpY2Fkb3NcIiBwYXJhIHRyYW5zcGFyZW5jaWEuXG4gIGNvbnN0IF9mbXRGaWx0cm9zID1cbiAgICB3Ll9fcGhhc2UwICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydCAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQuZm9ybWF0QmFja29yZGVyRmlsdHJvc0hlYWRlcjtcbiAgY29uc3QgZmlsdHJvc0xibCA9IF9mbXRGaWx0cm9zID8gX2ZtdEZpbHRyb3MoX2V4cG9ydFJlc3VsdC5maWx0cm9zQXBsaWNhZG9zKSA6ICdGaWx0cm9zOiBuaW5ndW5vJztcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXG4gICAgeyBNZXRyaWNhOiBmaWx0cm9zTGJsLCBWYWxvcjogJycgfSxcbiAgICB7IE1ldHJpY2E6ICdUT1RBTCBCYWNrb3JkZXIgQVJTJywgVmFsb3I6IE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1NLVXMgY29uIGJhY2tvcmRlcicsIFZhbG9yOiB0b3RhbFNrdXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1VuaWRhZGVzIHBlbmRpZW50ZXMnLCBWYWxvcjogTWF0aC5yb3VuZCh0b3RhbFVuaWRhZGVzTW9kYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnUGFyZXMgY2xpZW50ZStTS1UgKGZpbGFzIGVuIGhvamEgQmFja29yZGVyKScsIFZhbG9yOiByb3dzLmxlbmd0aCB9LFxuICAgIHsgTWV0cmljYTogJ0NsaWVudGVzIGFmZWN0YWRvcycsIFZhbG9yOiB0b3RhbENsaWVudGVzTW9kYWwgfSxcbiAgICB7IE1ldHJpY2E6ICdcdTIwMTQgU3VidG90YWwgU0lOIFJFUE9TSUNJT04nLCBWYWxvcjogTWF0aC5yb3VuZChzdWJ0b3RhbGVzUG9yVXJnZW5jeS51cmdlbnRlKSB9LFxuICAgIHsgTWV0cmljYTogJ1x1MjAxNCBTdWJ0b3RhbCBQQVJDSUFMJywgVmFsb3I6IE1hdGgucm91bmQoc3VidG90YWxlc1BvclVyZ2VuY3kucGFyY2lhbCkgfSxcbiAgICB7IE1ldHJpY2E6ICdTbmFwc2hvdCBnZW5lcmFkbycsIFZhbG9yOiBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIH0sXG4gIF07XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBmaWxhIFRPVEFMIGFsaW5lYWRhIGNvbiBlbCBudWV2byBzaGFwZSAoc2luIGNvbHVtbmFzIGxlZ2FjeVxuICAvLyBGZWNoYV9QZWRpZG8gLyBNZXMgLyBDYW50aWRhZF9QZWRpZGEgLyBQZWRpZG9fSUQgLyBMaW5lYV9JZHggLyBldGMuKS5cbiAgLy8gTGFzIG51ZXZhcyBjb2x1bW5hcyAoZGUgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3MpOiBTS1UsIFByb2R1Y3RvLFxuICAvLyBDbGllbnRlLCBDYXJkQ29kZSwgUHJvdmluY2lhLCBMb2NhbGlkYWQsIFZlbmRlZG9yLCBDYW50aWRhZF9QZW5kaWVudGVfQk8sXG4gIC8vIFByZWNpb19Vbml0X0FSUywgU3VidG90YWxfQk9fQVJTLCBFZGFkX0JPX2RpYXMsIEVzdGFkbywgUGVkaWRvcy5cbiAgY29uc3QgdG90YWxSb3cgPSB7XG4gICAgU0tVOiAnJyxcbiAgICBQcm9kdWN0bzogJycsXG4gICAgQ2xpZW50ZTogJ1RPVEFMJyxcbiAgICBDYXJkQ29kZTogJycsXG4gICAgUHJvdmluY2lhOiAnJyxcbiAgICBMb2NhbGlkYWQ6ICcnLFxuICAgIFZlbmRlZG9yOiAnJyxcbiAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IE1hdGgucm91bmQodG90YWxVbmlkYWRlc01vZGFsKSxcbiAgICBQcmVjaW9fVW5pdF9BUlM6ICcnLFxuICAgIFN1YnRvdGFsX0JPX0FSUzogTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpLFxuICAgIEVkYWRfQk9fZGlhczogJycsXG4gICAgRXN0YWRvOiAnJyxcbiAgICBQZWRpZG9zOiAnJyxcbiAgfTtcbiAgcm93cy5wdXNoKHRvdGFsUm93KTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0JhY2tvcmRlcl9TbmFwc2hvdF8nICsgdG9kYXkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goXG4gICAgZm5hbWUsXG4gICAgW1xuICAgICAgeyBuYW1lOiAnUmVzdW1lbicsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgICB7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH0sXG4gICAgXSxcbiAgICB7XG4gICAgICAvLyBQaW50YXIgbGEgZmlsYSBUT1RBTCBkZSBsYSBob2phIEJhY2tvcmRlciArIGZpbGEgMSAoVE9UQUwpIGRlIFJlc3VtZW4uXG4gICAgICBjZWxsU3R5bGVyOiAoY2VsbCwgY29sdW1uTmFtZSwgX3ZhbHVlLCByb3dJbmRleCkgPT4ge1xuICAgICAgICAvLyBIb2phIFJlc3VtZW46IGZpbGEgVE9UQUwgPSByb3dJbmRleCAwIChwcmltZXJhIGRhdGEgcm93IHBvc3QgaGVhZGVyKS5cbiAgICAgICAgLy8gSG9qYSBCYWNrb3JkZXI6IGZpbGEgVE9UQUwgPSB1bHRpbWEgcm93IChyb3dJbmRleCA9PT0gcm93cy5sZW5ndGggLSAxKS5cbiAgICAgICAgLy8gTm8gdGVuZW1vcyBhY2Nlc28gYWwgbm9tYnJlIGRlIGxhIGhvamEgZW4gZWwgc3R5bGVyLCBwZXJvIHBpbnRhbW9zXG4gICAgICAgIC8vIHBvciBjZWxkYTogc2kgY29sdW1uTmFtZT09J01ldHJpY2EnIHkgZXMgJ1RPVEFMIEJhY2tvcmRlciBBUlMuLi4nLFxuICAgICAgICAvLyBvIHNpIGNvbHVtbk5hbWU9PSdDbGllbnRlJyB5IGVsIHZhbG9yIGluY2x1eWUgJ1RPVEFMJy5cbiAgICAgICAgY29uc3QgdHh0ID0gU3RyaW5nKGNlbGwudmFsdWUgfHwgJycpO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgKGNvbHVtbk5hbWUgPT09ICdNZXRyaWNhJyAmJiB0eHQuaW5jbHVkZXMoJ1RPVEFMIEJhY2tvcmRlcicpKSB8fFxuICAgICAgICAgIChjb2x1bW5OYW1lID09PSAnQ2xpZW50ZScgJiYgdHh0LmluY2x1ZGVzKCdUT1RBTCcpKVxuICAgICAgICApIHtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjk5MUIxQicgfSB9OyAvLyByZWQtODAwXG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2VsZGFzIGRlIGxhIE1JU01BIEZJTEEgVE9UQUwgKGxvcyBudW1lcm9zKVxuICAgICAgICBpZiAocm93SW5kZXggPT09IDAgJiYgY29sdW1uTmFtZSA9PT0gJ1ZhbG9yJykge1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH1cbiAgKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgK1xuICAgICAgKHJvd3MubGVuZ3RoIC0gMSkgK1xuICAgICAgJyBsaW5lYXMgKyBSZXN1bWVuIGNvbiB0b3RhbCAkJyArXG4gICAgICBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgJyknLFxuICAgIDMwMDBcbiAgKTtcbn07XG5cbi8vIHYxNTExICgyMDI2LTEwLTI4KTogaGFuZGxlciB3aW5kb3cuZXhwb3J0UmVwYXJ0b1RvRXhjZWwgcmVtb3ZpZG8ganVudG8gY29uIGVsXG4vLyBib3RvbiBcIkV4cG9ydGFyIHJlcG9ydGVcIiBkZWwgbW9kYWwgUmVwYXJ0by4gUmVlbXBsYXphZG8gcG9yIGVsIGZsb3cgZWRpdGFibGVcbi8vIFwiRXhwb3J0YXIgRXhjZWxcIiArIFwiSW1wb3J0YXIgRXhjZWxcIiBkZWwgUFIgIzEyNzMgKHYxNTA1KS5cbi8vIFByZXNlcnZhZG86IHNyYy9wdXJlL3JlcGFydG8tZXhwb3J0LXJvd3MuanMgKHNoYXBlIGRlIHJvd3MgYXVuIHVzYWRvIHBvciBvdHJvcyBleHBvcnRzKS5cblxuLy8gdjczNzogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG8gZWwgU3RvY2sgQXNpZ25hZG8gKHNpbiBmaWx0cm8gZGUgbWVzKS4gTWlzbW9cbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxud2luZG93LmV4cG9ydFN0b2NrQXNpZ0FsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8gKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjExMDAgKDIwMjYtMDktMzApOiBtaXNtbyBtXHUwMEYzZHVsbyBwdXJvIHF1ZSByZW5kZXJCYWNrb3JkZXJzVGFiIGVuIG1vZG9cbiAgLy8gYXNpZ25hY2lvbi4gQWhvcmEgZWwgcmVwb3J0ZSBjb2luY2lkZSBjb24gZWwgbW9kYWw6IEZJRk8gY2FwIHBvciBkaXNwU2FwLFxuICAvLyBmaWx0cm8gdmVuY2lkYXMgKEFTSUcgPjE1ZCBmdWVyYSwgQVNJRyBzaW4gcmVzZXJ2YSB2aWdlbnRlIGFkZW50cm8pLFxuICAvLyBjb25maXJtZWQgaW5jbHVpZG8sIHNpbiBsXHUwMEVEbmVhcyBcInZpcnR1YWxfQVNJR1wiIGZhbnRhc21hLlxuICAvLyB2MTUzNDogYWxjYW5jZSBwb3Igcm9sICh2ZW5kZWRvciA9IGNsaWVudGVzIGRlIHN1IG1hc3RlcjsgaW50ZXJubyA9IHBhcmVqYXMpLlxuICBjb25zdCBhcnIgPSBfZXhwb3J0U2NvcGUoKS5maWx0ZXJQZWRpZG9zKFxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdXG4gICk7XG4gIGNvbnN0IHRvdGFsUGVkaWRvc09wZW4gPSBhcnIuZmlsdGVyKChwKSA9PiBwICYmICFwLmNsb3NlZEF0KS5sZW5ndGg7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkICE9PSAnZnVuY3Rpb24nIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlLmdldClcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgY29uc3QgY21EYXRhID0gdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgYXJyLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHt9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIGFycikgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIC8vIEVzdGFkb19SZWFsOiBoaXN0XHUwMEYzcmljbyBcIkJPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKVwiIHZzIFwiQVNJR1wiLiB2MTEwMDpcbiAgICAvLyBhaG9yYSBgY29uZmlybWVkYCB0YW1iaVx1MDBFOW4gZW50cmEgKHY5NjIpLiBQcmVzZXJ2YW1vcyBldGlxdWV0YSBsZWdhY3lcbiAgICAvLyBwb3IgY29tcGF0aWJpbGlkYWQgY29uIHF1aWVuIGNvbnN1bWUgZWwgRXhjZWwuXG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XG4gICAgaWYgKGMuc3RhdGUgPT09ICdCTycpIGVzdGFkb1JlYWwgPSAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJztcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcXR5LFxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHF0eSAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXG4gICAgICAvLyB2MTEwMDogY29udGV4dG8gXHUwMEZBdGlsIHBhcmEgZGVidWdnaW5nIHBhcmlkYWQgbW9kYWxcdTIxOTRyZXBvcnRlLlxuICAgICAgU3RvY2tfRGlzcF9TS1U6IHJsLmRpc3BTYXAgfHwgMCxcbiAgICB9KTtcbiAgfSk7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlBc2lnbmFkYT4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgc3RvY2sgYXNpZ25hZG8gYWhvcmEgbWlzbW9cXG4nICtcbiAgICAgICAgJzIuIFRvZG9zIGxvcyBBU0lHIGVzdGFuIHZlbmNpZG9zICg+MTVkIGRlc2RlIGFzaWdBdClcXG4nICtcbiAgICAgICAgJzMuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fU25hcHNob3RfJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59O1xuXG4vLyB2MTM5NiAoMjAyNi0xMC0yMSk6IG51ZXZvIGV4cG9ydCBcIlBlbmRpZW50ZSBkZSBBc2lnbmFjaVx1MDBGM24gLSBQYWJsb1wiLiBMaXN0YVxuLy8gbG9zIHJlcGFydG9zIGFiaWVydG9zIChpbmdyZXNvc19yZXBhcnRvIHBlbmRpbmcvaW5fcHJvZ3Jlc3MpIHBvciBTS1UgK1xuLy8gY2xpZW50ZXMgZW4gY29sYS4gUmVlbXBsYXphIHNlbVx1MDBFMW50aWNhbWVudGUgYWwgdmllam8gXCJTdG9jayBBc2lnbmFkb1wiIGVuIGVsXG4vLyBtb2RhbCAoZWwgdmllam8gcGFzYSBhIFwiU3RvY2sgQXNpZ25hZG8gLSBsXHUwMEVEbmVhc1wiIGNvbW8gYXV4aWxpYXIpLlxuLy8gRG9zIGhvamFzOlxuLy8gICBSZXN1bWVuIHJlcGFydG8gXHUyMDE0IHVuYSBmaWxhIHBvciBkb2MgaW5ncmVzb3NfcmVwYXJ0by5cbi8vICAgQ2xpZW50ZXMgZW4gY29sYSBcdTIwMTQgdW5hIGZpbGEgcG9yIGNsaWVudGUgQk8gZGUgY2FkYSByZXBhcnRvLlxud2luZG93LmV4cG9ydFBlbmRpZW50ZURlQXNpZ25hY2lvblBhYmxvID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG8uLi4nKTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGZiRGIgPSB3LmZiRGI7XG4gIGlmICghZmJEYikge1xuICAgIGFsZXJ0KCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvLiBSZWludGVudFx1MDBFMSBlbiB1bm9zIHNlZ3VuZG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyAxLiBSZXBhcnRvcyBhYmllcnRvcy5cbiAgbGV0IHJlcGFydG9zRG9jcztcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ2luZ3Jlc29zX3JlcGFydG8nKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ3BlbmRpbmcnLCAnaW5fcHJvZ3Jlc3MnXSlcbiAgICAgIC5nZXQoKTtcbiAgICByZXBhcnRvc0RvY3MgPSBzbmFwLmRvY3M7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgY2FyZ2FuZG8gaW5ncmVzb3NfcmVwYXJ0bzogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXJlcGFydG9zRG9jcyB8fCByZXBhcnRvc0RvY3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZXBhcnRvcyBwZW5kaW5nL2luX3Byb2dyZXNzIGFob3JhIG1pc21vLicpO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUGFibG86IDAgcmVwYXJ0b3MnLCAyNDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMi4gU25hcHNob3Qgc3RvY2sgKyBnZXRTdG9ja0JyZWFrZG93biBwb3IgU0tVLlxuICBjb25zdCBzdG9ja1NuYXAgPVxuICAgIHR5cGVvZiB3LmdldFN0b2NrU25hcHNob3QgPT09ICdmdW5jdGlvbidcbiAgICAgID8gdy5nZXRTdG9ja1NuYXBzaG90KClcbiAgICAgIDogdy5fc3RvY2tTbmFwc2hvdENhY2hlIHx8IHsgd2FyZWhvdXNlQnJlYWtkb3duOiB7fSB9O1xuICBjb25zdCB3aHMgPVxuICAgIHR5cGVvZiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24gfHwge307XG4gIGNvbnN0IHBlZGlkb3MgPSBBcnJheS5pc0FycmF5KHcuZ2xvYmFsUGVkaWRvcykgPyB3Lmdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgY29uc3Qgd2FpdGxpc3RFbnRyaWVzID1cbiAgICB0eXBlb2Ygdy5fZ2V0V2FpdGxpc3RDcHN0RW50cmllcyA9PT0gJ2Z1bmN0aW9uJyA/IHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMoKSA6IFtdO1xuICBjb25zdCBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zID0gcmVwYXJ0b3NEb2NzLm1hcCgoZCkgPT5cbiAgICBPYmplY3QuYXNzaWduKHsgX2ZzSWQ6IGQuaWQgfSwgZC5kYXRhKCkgfHwge30pXG4gICk7XG4gIGNvbnN0IGdldEJyZWFrZG93biA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5nZXRTdG9ja0JyZWFrZG93bjtcbiAgLy8gMy4gUmVzb2x2ZXIgcHJvZHVjdG8gcG9yIFNLVS5cbiAgY29uc3QgcHJvZEJ5U2t1ID0gbmV3IE1hcCgpO1xuICBjb25zdCBQUk9EVUNUUyA9IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW107XG4gIGZvciAoY29uc3QgcCBvZiBQUk9EVUNUUykge1xuICAgIGlmIChwICYmIHAuc2t1KSBwcm9kQnlTa3Uuc2V0KFN0cmluZyhwLnNrdSkudG9VcHBlckNhc2UoKSwgcCk7XG4gIH1cbiAgY29uc3Qgbm93TXMgPSBEYXRlLm5vdygpO1xuICBjb25zdCByZXN1bWVuUm93cyA9IFtdO1xuICBjb25zdCBjb2xhUm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IGRvYyBvZiByZXBhcnRvc0RvY3MpIHtcbiAgICBjb25zdCBkYXRhID0gZG9jLmRhdGEoKSB8fCB7fTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoZGF0YS5za3UgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcHJvZCA9IHByb2RCeVNrdS5nZXQoc2t1KSB8fCBudWxsO1xuICAgIGNvbnN0IGZpc2ljb0RlcDExID0gTnVtYmVyKCh3aHNbc2t1XSAmJiB3aHNbc2t1XVsnMTEnXSkgfHwgMCk7XG4gICAgY29uc3QgcXR5SW5ncmVzYWRhID0gTnVtYmVyKGRhdGEucXR5SW5ncmVzYWRhIHx8IDApO1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0gQXJyYXkuaXNBcnJheShkYXRhLmFzc2lnbm1lbnRzKSA/IGRhdGEuYXNzaWdubWVudHMgOiBbXTtcbiAgICBsZXQgcXR5WWFBc2lnbmFkYSA9IDA7XG4gICAgZm9yIChjb25zdCBhIG9mIGFzc2lnbm1lbnRzKSBxdHlZYUFzaWduYWRhICs9IE51bWJlcigoYSAmJiBhLnF0eUFzaWduYWRhKSB8fCAwKTtcbiAgICBsZXQgcXR5QVJlcGFydGlyID0gTWF0aC5tYXgoMCwgcXR5SW5ncmVzYWRhIC0gcXR5WWFBc2lnbmFkYSk7XG4gICAgaWYgKGdldEJyZWFrZG93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYmsgPSBnZXRCcmVha2Rvd24oXG4gICAgICAgICAgc2t1LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGdldFN0b2NrRmlzaWNvOiAoKSA9PiBmaXNpY29EZXAxMSxcbiAgICAgICAgICAgIHBlZGlkb3MsXG4gICAgICAgICAgICB3YWl0bGlzdEVudHJpZXMsXG4gICAgICAgICAgICBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBub3c6IG5vd01zIH1cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGJrICYmIGJrLnJlcGFydG9BYmllcnRvICYmIHR5cGVvZiBiay5yZXBhcnRvQWJpZXJ0by5xdHkgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgcXR5QVJlcGFydGlyID0gYmsucmVwYXJ0b0FiaWVydG8ucXR5O1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvKiBmYWxsYmFjayBhIGNcdTAwRTFsY3VsbyBsb2NhbCAqL1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjbGllbnRlc0JPID0gQXJyYXkuaXNBcnJheShkYXRhLmNsaWVudGVzQk8pID8gZGF0YS5jbGllbnRlc0JPIDogW107XG4gICAgbGV0IGRldGVjdGVkQXQgPSBkYXRhLmRldGVjdGVkQXQgfHwgJyc7XG4gICAgaWYgKGRldGVjdGVkQXQgJiYgdHlwZW9mIGRldGVjdGVkQXQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkZXRlY3RlZEF0ID0gZGV0ZWN0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9ICcnO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBib1RvdGFsUXR5ID0gY2xpZW50ZXNCTy5yZWR1Y2UoKHMsIGMpID0+IHMgKyBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksIDApO1xuICAgIHJlc3VtZW5Sb3dzLnB1c2goe1xuICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgU0tVOiBza3UsXG4gICAgICBQcm9kdWN0bzogKHByb2QgJiYgKHByb2QubmFtZSB8fCBwcm9kLmRlc2NyaXB0aW9uKSkgfHwgJycsXG4gICAgICBGaXNpY29fRGVwMTE6IGZpc2ljb0RlcDExLFxuICAgICAgUXR5X0luZ3Jlc2FkYTogcXR5SW5ncmVzYWRhLFxuICAgICAgUXR5X1lhX0FzaWduYWRhOiBxdHlZYUFzaWduYWRhLFxuICAgICAgUXR5X0FfUmVwYXJ0aXI6IHF0eUFSZXBhcnRpcixcbiAgICAgIENsaWVudGVzX0VuX0NvbGE6IGNsaWVudGVzQk8ubGVuZ3RoLFxuICAgICAgQk9fVG90YWxfUXR5OiBib1RvdGFsUXR5LFxuICAgICAgRGV0ZWN0ZWRBdDogdHlwZW9mIGRldGVjdGVkQXQgPT09ICdzdHJpbmcnID8gZGV0ZWN0ZWRBdC5zbGljZSgwLCAxOSkucmVwbGFjZSgnVCcsICcgJykgOiAnJyxcbiAgICAgIFN0YXR1czogZGF0YS5zdGF0dXMgfHwgJycsXG4gICAgfSk7XG4gICAgZm9yIChjb25zdCBjIG9mIGNsaWVudGVzQk8pIHtcbiAgICAgIGxldCBmZWNoYVBlZCA9IGMucGVkaWRvQ3JlYXRlZEF0IHx8ICcnO1xuICAgICAgaWYgKGZlY2hhUGVkICYmIHR5cGVvZiBmZWNoYVBlZC50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmZWNoYVBlZCA9IGZlY2hhUGVkLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSAnJztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gVmVuZGVkb3I6IGJ1c2NhciBlbiBnbG9iYWxQZWRpZG9zIHBvciBwZWRpZG9JZC5cbiAgICAgIGxldCB2ZW5kZWRvciA9IGMudmVuZG9yS2V5IHx8ICcnO1xuICAgICAgaWYgKCF2ZW5kZWRvciAmJiBjLnBlZGlkb0lkKSB7XG4gICAgICAgIGNvbnN0IHAgPSBwZWRpZG9zLmZpbmQoKHgpID0+IHggJiYgeC5fZnNJZCA9PT0gYy5wZWRpZG9JZCk7XG4gICAgICAgIGlmIChwKSB2ZW5kZWRvciA9IHAub3duZXJWZW5kb3IgfHwgcC52ZW5kb3JBc3NpZ25lZCB8fCAnJztcbiAgICAgIH1cbiAgICAgIGNvbGFSb3dzLnB1c2goe1xuICAgICAgICBSZXBhcnRvX0lEOiBkb2MuaWQsXG4gICAgICAgIFNLVTogc2t1LFxuICAgICAgICBDbGllbnRlOiBjLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENhcmRDb2RlOiBjLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IGMuY2xpZW50UHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogYy5jbGllbnRMb2NhbGl0eSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHZlbmRlZG9yLFxuICAgICAgICBRdHlfQk86IE51bWJlcihjLnF0eUJhY2tvcmRlciB8fCAwKSxcbiAgICAgICAgRmVjaGFfUGVkaWRvX09yaWdpbmFsOiB0eXBlb2YgZmVjaGFQZWQgPT09ICdzdHJpbmcnID8gZmVjaGFQZWQuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXN1bWVuUm93cy5zb3J0KChhLCBiKSA9PiBiLlF0eV9BX1JlcGFydGlyIC0gYS5RdHlfQV9SZXBhcnRpcik7XG4gIGNvbGFSb3dzLnNvcnQoXG4gICAgKGEsIGIpID0+XG4gICAgICAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpIHx8XG4gICAgICAoYS5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpXG4gICk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZW5kaWVudGVEZUFzaWduYWNpb25fUGFibG9fJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUmVzdW1lbiByZXBhcnRvJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBlbiBjb2xhJywgcm93czogY29sYVJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUGFibG86ICcgKyByZXN1bWVuUm93cy5sZW5ndGggKyAnIHJlcGFydG9zIC8gJyArIGNvbGFSb3dzLmxlbmd0aCArICcgY2xpZW50ZXMgZW4gY29sYScsXG4gICAgMjgwMFxuICApO1xufTtcblxuLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc3VlbHZlIG5vbWJyZSBkZSBmYW50YXNpYSBwYXJhIHVuIHBlZGlkbyB1c2FuZG8gZWxcbi8vIG1pc21vIHBhdHRlcm4gcXVlIGxhcyBjYXJkcyBkZWwgbWFwYSAoaW5kZXguaHRtbDo5OTE1LTk5MzUpOlxuLy8gICAxKSBjbGllbnRNZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYSAoZWRpdGFkbyBkZXNkZSBlbCBtb2RhbCBjbGllbnRlKVxuLy8gICAyKSBhcHByb3ZlZEFsdGFzTGlzdFtdLmZhbnRhc2lhIG1hdGNoZWFkbyBwb3IgY29tZXJjaW8gPT0gY2xpZW50TmFtZVxuZnVuY3Rpb24gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKSB7XG4gIGNvbnN0IGNhcmRDb2RlID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgaWYgKGNhcmRDb2RlKSB7XG4gICAgY29uc3QgbWV0YSA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuY2xpZW50TWV0YTtcbiAgICBjb25zdCBjdXN0b20gPSBtZXRhICYmIG1ldGFbY2FyZENvZGVdICYmIG1ldGFbY2FyZENvZGVdLmN1c3RvbUZhbnRhc2lhO1xuICAgIGlmIChjdXN0b20gJiYgU3RyaW5nKGN1c3RvbSkudHJpbSgpKSByZXR1cm4gU3RyaW5nKGN1c3RvbSkudHJpbSgpO1xuICB9XG4gIGNvbnN0IGFsdGFzID0gLyoqIEB0eXBlIHthbnl9ICovIChnbG9iYWxUaGlzKS5hcHByb3ZlZEFsdGFzTGlzdDtcbiAgaWYgKEFycmF5LmlzQXJyYXkoYWx0YXMpKSB7XG4gICAgY29uc3QgbmFtZUxvd2VyID0gU3RyaW5nKHAuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChuYW1lTG93ZXIpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4ge1xuICAgICAgICBpZiAoIWEpIHJldHVybiBmYWxzZTtcbiAgICAgICAgY29uc3QgYyA9IFN0cmluZyhhLmNvbWVyY2lvIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZiA9IFN0cmluZyhhLmZhbnRhc2lhIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIGMgPT09IG5hbWVMb3dlciB8fCBmID09PSBuYW1lTG93ZXI7XG4gICAgICB9KTtcbiAgICAgIGlmIChtYXRjaCAmJiBtYXRjaC5mYW50YXNpYSAmJiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnJztcbn1cblxuLy8gdjEyMzMgKDIwMjYtMTAtMDkpOiByZXBvcnRlIFwiVmVudGFzIHggYXJ0aWN1bG8geCBjbGllbnRlL3ZlbmRlZG9yXCIgdmlhIENGLlxuLy8gQWRtaW4vZ2VyZW50ZSBvbmx5LiBUYXJkYSB+MzAtNjBzIChCUSBxdWVyeSArIGV4Y2VsanMgYnVpbGQgc2VydmVyLXNpZGUpLlxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzQXJ0Q2xpRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHtcbiAgICBhbGVydCgnRWxlZ1x1MDBFRCB1biBNRVMgZXNwZWNcdTAwRURmaWNvIChubyBcIlRvZG8gZWwgYVx1MDBGMW9cIikgXHUyMDE0IGVzdGUgcmVwb3J0ZSBlcyBtZW5zdWFsLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBtb250aElkeCB2aWVuZSAwLWJhc2VkIGRlc2RlIGVsIHBpY2tlciAoZW5lPTApLiBDRiBlc3BlcmEgMS1iYXNlZC5cbiAgY29uc3QgbW9udGggPSBtb250aElkeCArIDE7XG4gIGNvbnN0IHllYXIgPSBhbmlvO1xuICBjb25zdCBwZXJpb2RvID0gKHdpbmRvdy5NRVNFUyA/IHdpbmRvdy5NRVNFU1ttb250aElkeF0gOiBtb250aCkgKyAnICcgKyB5ZWFyO1xuICBjb25zdCBjb25maXJtTXNnID1cbiAgICAnR2VuZXJhciByZXBvcnRlIFwiVkVOVEFTIHggQVJUSUNVTE8geCBDTElFTlRFL1ZFTkRFRE9SXCIgZGUgJyArXG4gICAgcGVyaW9kbyArXG4gICAgJz9cXG5cXG4nICtcbiAgICAnRnVlbnRlOiBTQVAgdmlhIEJpZ1F1ZXJ5IChkYXRvcyBleGFjdG9zKS5cXG4nICtcbiAgICAnUHVlZGUgdGFyZGFyIDMwLTYwIHNlZ3VuZG9zLlxcbicgK1xuICAgICdBbCB0ZXJtaW5hciBzZSBkZXNjYXJnYSBhdXRvbWF0aWNhbWVudGUgZWwgeGxzeC4nO1xuICBpZiAoIWNvbmZpcm0oY29uZmlybU1zZykpIHJldHVybjtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyByZXBvcnRlIHNlcnZlci1zaWRlIChCUSkuLi4gcHVlZGUgdGFyZGFyIH42MHMnKTtcbiAgdHJ5IHtcbiAgICAvLyB2MTAwMCBwYXR0ZXJuOiByZWZyZXNoIElEVG9rZW4gYW50ZXMgZGUgY2FsbGFibGUgY3JpdGljby5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdSA9IHdpbmRvdy5maXJlYmFzZS5hdXRoICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoKCkuY3VycmVudFVzZXI7XG4gICAgICBpZiAodSAmJiB1LmdldElkVG9rZW4pIGF3YWl0IHUuZ2V0SWRUb2tlbih0cnVlKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgICBjb25zdCBjYWxsYWJsZSA9IHdpbmRvdy5maXJlYmFzZVxuICAgICAgLmFwcCgpXG4gICAgICAuZnVuY3Rpb25zKCdzb3V0aGFtZXJpY2EtZWFzdDEnKVxuICAgICAgLmh0dHBzQ2FsbGFibGUoJ2dlbmVyYXRlVmVudGFzUmVwb3J0Q0YnKTtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgY2FsbGFibGUoeyB5ZWFyLCBtb250aCB9KTtcbiAgICBjb25zdCByID0gKHJlc3AgJiYgcmVzcC5kYXRhKSB8fCB7fTtcbiAgICBpZiAoIXIub2sgfHwgIXIuYnl0ZXNCYXNlNjQpIHtcbiAgICAgIGFsZXJ0KCdDRiBkZXZvbHZpbyBlcnJvcjogJyArIChyLmVycm9yIHx8IEpTT04uc3RyaW5naWZ5KHIpKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIERlY29kZSBiYXNlNjQgXHUyMTkyIEJsb2IgXHUyMTkyIGRvd25sb2FkIHRyaWdnZXIuXG4gICAgY29uc3QgYmluID0gYXRvYihyLmJ5dGVzQmFzZTY0KTtcbiAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbi5sZW5ndGgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbi5jaGFyQ29kZUF0KGkpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnl0ZXNdLCB7XG4gICAgICB0eXBlOiByLm1pbWVUeXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID1cbiAgICAgIHIuZmlsZW5hbWUgfHxcbiAgICAgICd2ZW50YXNfeF9hcnRpY3Vsb19jbGllbnRlXycgKyB5ZWFyICsgJy0nICsgU3RyaW5nKG1vbnRoKS5wYWRTdGFydCgyLCAnMCcpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgICAgIGEucmVtb3ZlKCk7XG4gICAgfSwgMTAwMCk7XG4gICAgY29uc3Qgc3RhdHMgPSByLnN0YXRzIHx8IHt9O1xuICAgIHNob3dTeW5jVGFnKFxuICAgICAgJ09LOiAnICtcbiAgICAgICAgKHN0YXRzLnZlbnRhcyB8fCAwKSArXG4gICAgICAgICcgdmVudGFzIC8gJyArXG4gICAgICAgIChzdGF0cy5pdGVtcyB8fCAwKSArXG4gICAgICAgICcgU0tVcyAvICcgK1xuICAgICAgICAoc3RhdHMuY2xpZW50cyB8fCAwKSArXG4gICAgICAgICcgY2xpZW50ZXMnXG4gICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnRWZW50YXNBcnRDbGldIGVycm9yJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCByZXBvcnRlOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpKSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFBlZGlkb3MgZGVsIG1lcy4uLicpO1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IHNjb3BlID0gX2V4cG9ydFNjb3BlKCk7XG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgsIHNjb3BlKTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcbiAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXG4gICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgOiAnJztcbiAgICAvLyB2OTc1ICgyMDI2LTA5LTE3KTogcmVzb2x2ZXIgZmFudGFzaWEgdW5hIHZleiBwb3IgcGVkaWRvIChubyBwb3IgbGluZWEpIFx1MjAxNFxuICAgIC8vIGVsIGxvb2t1cCBlbiBjbGllbnRNZXRhICsgYXBwcm92ZWRBbHRhc0xpc3QgZXMgY29uc3RhbnRlIHBhcmEgdG9kbyBlbCBwZWRpZG8uXG4gICAgY29uc3Qgbm9tYnJlTG9jYWxGYW50YXNpYSA9IF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCk7XG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XG4gICAgICBpZiAoIWwpIHJldHVybjtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKTtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGEsXG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgU3RhZ2U6IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgTm9tYnJlX0xvY2FsX0ZhbnRhc2lhOiBub21icmVMb2NhbEZhbnRhc2lhLFxuICAgICAgICBDYXJkQ29kZTogcC5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBwLnByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgLy8gdjE1MzQ6IHZlbmRlZG9yIGRlbCBtYXN0ZXIgYWN0dWFsIChmYWxsYmFjayB2ZW5kb3JBc3NpZ25lZCwgZGVzcHVcdTAwRTlzIG93bmVyVmVuZG9yKS5cbiAgICAgICAgVmVuZGVkb3I6IHNjb3BlLnZlbmRvckNvbHVtbkZvclBlZGlkbyhwKSxcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBDYW50aWRhZF9PcGVuOiBOdW1iZXIobC5xdHlPcGVuKSB8fCAwLFxuICAgICAgICBDYW50aWRhZF9JbnZvaWNlZDogTnVtYmVyKGwucXR5SW52b2ljZWQpIHx8IDAsXG4gICAgICAgIENhbnRpZGFkX0NhbmNlbGxlZDogTnVtYmVyKGwucXR5Q2FuY2VsbGVkKSB8fCAwLFxuICAgICAgICBFc3RhZG9fTGluZWE6IGwuc3RhdGUgfHwgJycsXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQocXR5ICogcHJlY2lvKSxcbiAgICAgICAgQ2VycmFkbzogcC5jbG9zZWRBdCA/ICdTSScgOiAnTk8nLFxuICAgICAgICBQZWRpZG9fSUQ6IHAuX2ZzSWQgfHwgJycsXG4gICAgICAgIExpbmVhX0lkeDogaWR4LFxuICAgICAgICBTUV9Eb2NOdW06IHAudHJhbnNmZXJpZG9TQVAgPyBwLnRyYW5zZmVyaWRvU0FQLmRvY051bSB8fCAnJyA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5GZWNoYV9QZWRpZG8gfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG8gfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZWRpZG9zRGVsTWVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdQZWRpZG9zJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgUGVkaWRvcyBkZWwgbWVzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1Jztcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ05FQSc7XG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xuICAgIHJldHVybiAnJztcbiAgfVxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xuICAgIHJldHVybiBrZXk7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBsZXQgYWx0YXNTbmFwO1xuICB0cnkge1xuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcbiAgICAgIC5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXG4gICAgaWYgKCFjYXJkQ29kZSkge1xuICAgICAgc2tpcHBlZE5vU2FwKys7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xuICB9KTtcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgclsnTlJPIENURSddID0gaSArIDE7XG4gIH0pO1xuICAvLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZmFjdG9yIGEgZG93bmxvYWRYbHN4IChlc3RpbG8gdmVyZGUgdW5pZm9ybWUpLlxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRvd25sb2FkWGxzeCgnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcsIFtcbiAgICB7IG5hbWU6ICdDTElFTlRFU19aT05BUycsIHJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeGNlbCBleHBvcnRhZG86ICcgK1xuICAgICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcbiAgICAgIChza2lwcGVkTm9TYXAgPiAwID8gJyAoJyArIHNraXBwZWROb1NhcCArICcgc2luIENhcmRDb2RlIGRlc2NhcnRhZG9zKScgOiAnJylcbiAgKTtcbn07XG5cbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwaW4gPSBwcm9tcHQoXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xuICApO1xuICBpZiAocGluID09PSBudWxsKSByZXR1cm47XG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxuICBjb25zdCBzYXBPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1zYXAtaW50ZWdyYXRpb24nKTtcbiAgaWYgKHNhcE9wdCkge1xuICAgIGNvbnN0IGlzTWFyaWFubyA9XG4gICAgICBjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSc7XG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPcGNpb24gQmFja3VwIG1lbnN1YWw6IHNvbG8gYWRtaW5cbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBhdmlzbyBhbCBjbGljayBwYXJhIFwiVmVudGFzIFx1MDBENyBhcnRcdTAwRURjdWxvIFx1MDBENyBjbGllbnRlXCIuXG4vLyBBZG1pbi9nZXJlbnRlIG9ubHkuIFRhcmRhIDMwLTYwcy4gQW50ZXMgbGEgbm90YSBlc3RhYmEgZW4gbGEgZGVzY3JpcGNpXHUwMEYzbiBkZWxcbi8vIGxpc3RhZG8gZGVsIG1vZGFsOyBhaG9yYSBlbCBsaXN0YWRvIHNvbG8gbXVlc3RyYSBpY29ubyArIHRpdHVsby5cbndpbmRvdy5fdmVudGFzQXJ0Q2xpQ2xpY2sgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdy51c2VyUm9sZSB8fCAnJztcbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ0VzdGUgcmVwb3J0ZSBlcyBzb2xvIHBhcmEgYWRtaW4gLyBnZXJlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBvayA9IGNvbmZpcm0oXG4gICAgJ1JlcG9ydGUgc2VydmVyLXNpZGUgKEJpZ1F1ZXJ5KS4gVGFyZGEgMzAtNjAgc2VndW5kb3MgeSBkZXNjYXJnYSB1biAueGxzeCBjb24gNCBob2phczpcXG4nICtcbiAgICAgICcgIFx1MjAyMiBQcm9kdWN0b3MgdmVuZGlkb3MgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIFByb2R1Y3RvcyBOTyB2ZW5kaWRvcyBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgQ09OIGNvbXByYSBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgU0lOIGNvbXByYSBwb3IgVkRFXFxuXFxuJyArXG4gICAgICAnQ29udGludWFyPydcbiAgKTtcbiAgaWYgKCFvaykgcmV0dXJuO1xuICBpZiAodHlwZW9mIHcuY2xvc2VFeHBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VFeHBvcnREaWFsb2coKTtcbiAgaWYgKHR5cGVvZiB3LnNob3dNb250aFBpY2tlciA9PT0gJ2Z1bmN0aW9uJykgdy5zaG93TW9udGhQaWNrZXIoJ1ZFTlRBU19BUlRfQ0xJJyk7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBd0RPLFdBQVMsY0FBYyxHQUFHO0FBQy9CLFdBQU8sT0FBTyxLQUFLLEVBQUUsRUFDbEIsS0FBSyxFQUNMLFlBQVk7QUFBQSxFQUNq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
