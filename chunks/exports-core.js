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
    const rowsMariano = rowsFiltered.map((r) => ({
      CARDCODE_SAP: r["CardCode SAP"] || "",
      NOMBRE_TIENDA: r["Nombre tienda"] || "",
      TIPO_CLIENTE: r.Tipo || "",
      // v1565: Tipo (Cliente actual / Provisorio).
      PROVINCIA: r.Provincia || "",
      LOCALIDAD: r["Localidad (mapa)"] || r["Localidad declarada"] || "",
      DIRECCION: r.Direccion || "",
      TIPO_DE_CLIENTE: r["Tipo de cliente"] || "",
      // Ficha Cliente (clasif).
      "TAMA\xD1O": r["Tama\xF1o"] || r.Tamano || "",
      ESPECIALIZACION: r["Especializaci\xF3n"] || r.Especializacion || "",
      TIPO_DE_LOCAL: r["Tipo de local"] || "",
      PREFERENCIAS_CONTACTO: r["Preferencia de contacto"] || "",
      CREDITO_CHEQUE: r["Cr\xE9dito cheque (ARS)"] || "",
      FACTURACION_ACUMULADA_12MESES: r["Monto total (12m)"] || "",
      "FRECUENCIA_COMPRA(DIAS)": r["Frecuencia (d\xEDas entre compras)"] || "",
      ULTIMA_COMPRA: r["\xDAltima compra"] || "",
      VENDEDOR_ASIGNADO: r["Vendedor externo (VDE)"] || "",
      "ULTIMA_VISITA/CONTACTO_FECHA": ""
      // v1565 pendiente: requiere query extra a visits.
    }));
    const fname = "Master Clientes_" + scopeLbl + "_" + ts + ".xlsx";
    await downloadXlsx(fname, [{ name: "Master Clientes", rows: rowsMariano }]);
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
      else if (tipo === "BACKORDER") exportBackorderForMonth(anio, monthIdx);
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
    const ws = wb.addWorksheet("VISITAS", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "FECHA_DE_VISITAS", key: "fecha", width: 14 },
      { header: "VENDEDOR", key: "vendedor", width: 22 },
      { header: "INTERACCION", key: "interaccion", width: 12 },
      { header: "TIPO", key: "tipo", width: 12 },
      { header: "LOCAL", key: "local", width: 12 },
      { header: "TAMA\xD1O", key: "tamano", width: 10 },
      { header: "FIDELIDAD", key: "fidelidad", width: 10 },
      { header: "RELEVANCIA", key: "relev", width: 10 },
      { header: "POP", key: "pop", width: 8 },
      { header: "MAS_VENDIDO", key: "masVe", width: 24 },
      { header: "MAS_PREGUNTAN", key: "masPr", width: 24 },
      { header: "AYUDA_TIENDA", key: "ayuda", width: 22 },
      { header: "TIPO_DE_VENTA", key: "tipoVenta", width: 14 },
      { header: "PONDERACION_MOSTRADOR", key: "pMost", width: 14 },
      { header: "PONDERACION_ECOMMERCE", key: "pEcom", width: 14 },
      { header: "FOTO_FRENTE", key: "foto", width: 22 }
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
        vendedor: titleCase(v.vendor || ""),
        interaccion: interaccionLbl,
        tipo: v.tipo || "",
        local: v.local || "",
        tamano: v.tamano || "",
        fidelidad: v.fidelidad || "",
        relev: v.relevancia || "",
        pop: v.pop || "",
        masVe: v.masVendido || "",
        masPr: v.masPreguntan || "",
        ayuda: v.ayudaTienda || "",
        tipoVenta: v.tipoVenta === "MOSTRADO" ? "MOSTRADOR" : v.tipoVenta || "",
        pMost: v.ponderacionMostrado || "",
        pEcom: v.ponderacionEcommerce || "",
        foto: ""
        // celda vacia - imagen encima
      });
      void formaContactoLbl;
      void resultadoCtLbl;
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
      a.download = "VISITAS_" + periodLabel(anio, monthIdx) + ".xlsx";
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
      { header: "FECHA_DE_RENDICION", key: "fecha", width: 14 },
      { header: "TIPO", key: "tipo", width: 10 },
      { header: "VENDEDOR", key: "vendedor", width: 26 },
      { header: "CONCEPTO", key: "concepto", width: 20 },
      { header: "N\xB0 TICKET", key: "numTicket", width: 14 },
      { header: "TIPO_DE_GASTO", key: "tipoGasto", width: 20 },
      { header: "IMPORTE", key: "importe", width: 12 },
      { header: "OBSERVACIONES", key: "obs", width: 30 },
      { header: "FOTO_TICKET", key: "foto", width: 22 },
      { header: "ESTADO", key: "estado", width: 18 }
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
        concepto: conceptStr,
        numTicket: r.numeroTicket || "",
        tipoGasto: r.tipoGasto || "",
        importe: r.importe != null ? r.importe : "",
        obs: obsStr,
        foto: "",
        // celda vacia - encima va la imagen
        estado: r.status || r.estado || ""
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
      a.download = "Rendiciones_" + periodLabel(anio, monthIdx) + ".xlsx";
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
    const rowsClientes = rows.filter((r) => (r.Cliente || "") !== "TOTAL").map((r) => ({
      SKU: r.SKU || "",
      NOMBRE_DEL_PRODUCTO: r.Producto || "",
      CANTIDAD_BACKORDER: Number(r.Cantidad_Pendiente_BO) || 0,
      SUBTOTAL: Number(r.Subtotal_BO_ARS) || 0,
      CLIENTE: r.Cliente || "",
      ID_PEDIDO: r.Pedidos || ""
    }));
    const skuAgg = /* @__PURE__ */ new Map();
    for (const r of rowsClientes) {
      const sku = String(r.SKU || "").trim();
      if (!sku) continue;
      const prev = skuAgg.get(sku) || { qty: 0, sub: 0, nombre: r.NOMBRE_DEL_PRODUCTO };
      prev.qty += Number(r.CANTIDAD_BACKORDER) || 0;
      prev.sub += Number(r.SUBTOTAL) || 0;
      if (!prev.nombre && r.NOMBRE_DEL_PRODUCTO) prev.nombre = r.NOMBRE_DEL_PRODUCTO;
      skuAgg.set(sku, prev);
    }
    const rowsSku = [];
    for (const [sku, agg] of skuAgg) {
      rowsSku.push({
        SKU: sku,
        CANTIDAD_BACKORDER: agg.qty,
        SUBTOTAL: Math.round(agg.sub),
        PROMEDIO_VENTA_3M: ""
        // v1565 pendiente: requiere agregado BQ (ver changelog).
      });
      void resumenRows;
    }
    rowsSku.sort((a, b) => (b.SUBTOTAL || 0) - (a.SUBTOTAL || 0));
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fname = "BACKORDER_" + today + ".xlsx";
    downloadXlsx(fname, [
      { name: "Backorder_Clientes", rows: rowsClientes },
      { name: "Backorder_SKU", rows: rowsSku }
    ]);
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
          FECHA_DE_PEDIDO: fecha,
          CLIENTE: p.clientName || "",
          ID_PEDIDO: p._fsId || "",
          SKU: l.code || "",
          NOMBRE_DEL_PRODUCTO: l.desc || l.name || "",
          CANTIDAD: qty,
          SUBTOTAL: Math.round(qty * precio),
          LOCALIDAD: p.locName || ""
        });
        void nombreLocalFantasia;
        void idx;
        void scope;
      });
    }
    rows.sort((a, b) => (a.FECHA_DE_PEDIDO || "").localeCompare(b.FECHA_DE_PEDIDO || ""));
    const fname = "PEDIDOS DEL MES_" + periodLabel(anio, monthIdx) + ".xlsx";
    downloadXlsx(fname, [{ name: "PEDIDOS DEL MES", rows }]);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzIiwgIi4uL3NyYy9kb21haW5zL2V4cG9ydHMtY29yZS5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIHYxNTM0ICgyMDI2LTExLTAyKSBcdTIwMTQgQWxjYW5jZSBwb3Igcm9sIGRlIGxhcyBleHBvcnRhY2lvbmVzIGRlbCBtb2RhbFxuICogXCJSZXBvcnRlcyBFeGNlbFwiIChhdWRpdG9yXHUwMEVEYSBkb2NzL2F1ZGl0b3JpYS80NiwgRXRhcGEgMSkuXG4gKlxuICogUmVnbGFzIChkZWNpc2lvbmVzIGRlIE1hcmlhbm8pOlxuICogICAtIFwiTG9zIGNsaWVudGVzIGRlIHVuIHZlbmRlZG9yXCIgPSBlbCBtYXN0ZXIgQUNUVUFMIGRlbCBjbGllbnRlIChQT0lOVFMgK1xuICogICAgIHZlbmRvcl9vdmVycmlkZXMgKyBhcHByb3ZlZEFsdGFzLCBDTEFVREUubWQgXHUwMEE3NDYvXHUwMEE3NTApLiBOTyBlbCB2ZW5kZWRvclxuICogICAgIHF1ZSBxdWVkXHUwMEYzIGd1YXJkYWRvIGVuIGVsIHBlZGlkbyAoYXNzaWduZWRWZW5kb3JVaWQgc2UgZ3JhYmEgYWwgY3JlYXIgeVxuICogICAgIG5vIHNlIHJlLXNpbmNyb25pemEgY3VhbmRvIGNhbWJpYSBlbCBtYXN0ZXIpLlxuICogICAtIFZlbmRlZG9yIChWREUpOiB1biBwZWRpZG8gZW50cmEgc29sbyBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1XG4gKiAgICAgY2xpZW50ZSBlcyBlbCBzdXlvIFkgYWRlbVx1MDBFMXMgYGFzc2lnbmVkVmVuZG9yVWlkID09PSBteVVpZGAgKGRlZmVuc2EgZW5cbiAqICAgICBwcm9mdW5kaWRhZDogYG15VWlkYCBzYWxlIGRlIEZpcmViYXNlIEF1dGgsIG5vIGRlIGB1c2VyUm9sZWApLlxuICogICAtIEludGVybm8gKFZESSk6IHVuIHBlZGlkbyBlbnRyYSBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1IGNsaWVudGVcbiAqICAgICBlc3RcdTAwRTEgZW4gc3UgY29uanVudG8gZGUgdmVuZGVkb3JlcyAoc3Ugem9uYSArIHN1cyBwYXJlamFzLCBlbCBtaXNtbyBxdWVcbiAqICAgICB1c2EgZWwgbWFwYTogZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cyAvIGdldEVmZmVjdGl2ZVZlbmRvclNldCgnQUxMJykpLlxuICogICAtIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS4gT3RybyByb2wgbyBzaW4gcm9sOiBuYWRhLlxuICogICAtIFZpc2l0YXM6IGVsIHZlbmRlZG9yIHZlIHNvbG8gbGFzIHF1ZSBjYXJnXHUwMEYzIFx1MDBFOWwgKGBvd25lclVpZCA9PT0gbXlVaWRgKTtcbiAqICAgICBlbCBpbnRlcm5vIHZlIGxhcyBzdXlhcyArIGxhcyBkZSBzdXMgcGFyZWphcyAocG9yIGBvd25lclVpZGAgZGUgdW5hXG4gKiAgICAgcGFyZWphLCBwb3IgYGNyZWF0ZWRCeVVpZGAgcHJvcGlvIG8gcG9yIGB2ZW5kb3JgIFx1MjIwOCBzdSBjb25qdW50bykuXG4gKlxuICogU29sbyB1biBwcm9zcGVjdG8gc2luIENhcmRDb2RlIFNBUCBjYWUgYWwgYHZlbmRvckFzc2lnbmVkYCBndWFyZGFkbyBlbiBlbFxuICogcGVkaWRvLiBVbiBDYXJkQ29kZSBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlLCBvIHVuYSB6b25hIHNpbiB2ZW5kZWRvcixcbiAqIHF1ZWRhIGZ1ZXJhIGRlbCBhbGNhbmNlIGRlIHZlbmRlZG9yIGUgaW50ZXJuby4gYG93bmVyVmVuZG9yYCAoPSBxdWlcdTAwRTluIGxvXG4gKiBjYXJnXHUwMEYzLCBsZWdhY3kpIE5PIHNlIHVzYSBwYXJhIGRlY2lkaXIgZWwgYWxjYW5jZTsgc29sbyBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc29cbiAqIHBhcmEgbGEgY29sdW1uYSBcIlZlbmRlZG9yXCIgZGVsIEV4Y2VsLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYgeyhjYXJkQ29kZTogc3RyaW5nLCBjbGllbnROYW1lOiBzdHJpbmcpID0+IChzdHJpbmd8e3ZlbmRvcktleT86IHN0cmluZywgcmVhc29uPzogc3RyaW5nfSl9IFJlc29sdmVWZW5kb3JGb3JDbGllbnRcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IEV4cG9ydFNjb3BlQXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd8bnVsbHx1bmRlZmluZWR9IHJvbGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfG51bGx8dW5kZWZpbmVkfSBbbXlVaWRdXG4gKiBAcHJvcGVydHkge3N0cmluZ3xudWxsfHVuZGVmaW5lZH0gW215VmVuZG9yS2V5XVxuICogQHByb3BlcnR5IHtTZXQ8c3RyaW5nPnxBcnJheTxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbZWZmZWN0aXZlVmVuZG9yU2V0XVxuICogQHByb3BlcnR5IHtBcnJheTxzdHJpbmc+fFNldDxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbcGFydG5lclVpZHNdXG4gKiBAcHJvcGVydHkge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlVmVuZG9yRm9yQ2xpZW50XVxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gRXhwb3J0U2NvcGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNHbG9iYWxcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdmlzaXRzUXVlcnlCeU93bmVyVWlkIC0gdHJ1ZTogY29uc3VsdGFyIHZpc2l0cyBjb24gd2hlcmUoJ293bmVyVWlkJywnPT0nLHVpZCkuXG4gKiBAcHJvcGVydHkgeyhwZWRpZG9zOiBBcnJheTxhbnk+KSA9PiBBcnJheTxhbnk+fSBmaWx0ZXJQZWRpZG9zXG4gKiBAcHJvcGVydHkgeyh2aXNpdHM6IEFycmF5PGFueT4pID0+IEFycmF5PGFueT59IGZpbHRlclZpc2l0c1xuICogQHByb3BlcnR5IHsocDogYW55KSA9PiBzdHJpbmd9IHZlbmRvckNvbHVtbkZvclBlZGlkb1xuICovXG5cbi8qKlxuICogTm9ybWFsaXphIHVuIHZlbmRvcktleTogdHJpbSArIG1heVx1MDBGQXNjdWxhcy5cbiAqIEBwYXJhbSB7YW55fSBrXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybVZlbmRvcktleShrKSB7XG4gIHJldHVybiBTdHJpbmcoayB8fCAnJylcbiAgICAudHJpbSgpXG4gICAgLnRvVXBwZXJDYXNlKCk7XG59XG5cbi8qKlxuICogUmVzdWx0YWRvIGRlbCBtYXN0ZXIgcGFyYSBlbCBjbGllbnRlIGRlbCBwZWRpZG8uIEFjZXB0YSB1biByZXNvbHZlciBxdWVcbiAqIGRldnVlbHZlIHN0cmluZyAodmVuZG9yS2V5KSBvIHt2ZW5kb3JLZXksIHJlYXNvbn0uXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fHVuZGVmaW5lZH0gcmVzb2x2ZVxuICogQHJldHVybnMge3t2ZW5kb3JLZXk6IHN0cmluZywgcmVhc29uOiBzdHJpbmd9fVxuICovXG5mdW5jdGlvbiBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSkge1xuICBpZiAoIXAgfHwgdHlwZW9mIHJlc29sdmUgIT09ICdmdW5jdGlvbicpIHJldHVybiB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gcmVzb2x2ZShTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJyksIFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpKTtcbiAgICBpZiAociAmJiB0eXBlb2YgciA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiB7IHZlbmRvcktleTogbm9ybVZlbmRvcktleShyLnZlbmRvcktleSksIHJlYXNvbjogU3RyaW5nKHIucmVhc29uIHx8ICcnKSB9O1xuICAgIH1cbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6IG5vcm1WZW5kb3JLZXkociksIHJlYXNvbjogJycgfTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgfVxufVxuXG4vKipcbiAqIFZlbmRlZG9yIHF1ZSBkZWZpbmUgZWwgYWxjYW5jZSBkZWwgcGVkaWRvOlxuICogICAtIGVsIGRlbCBtYXN0ZXIgYWN0dWFsLCBzaSByZXN1ZWx2ZTtcbiAqICAgLSB6b25hIHNpbiB2ZW5kZWRvciAoaW5jbHVpZG8gZGlzdHJpYnVpZG9yKTogJycgKGVsIG1hc3RlciBtYW5kYSk7XG4gKiAgIC0gcHJvc3BlY3RvIHNpbiBDYXJkQ29kZSBTQVA6IGVsIGB2ZW5kb3JBc3NpZ25lZGAgZ3VhcmRhZG8gZW4gZWwgcGVkaWRvO1xuICogICAtIENhcmRDb2RlIFNBUCBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlOiAnJyAoZmFsbGEgY2VycmFkbykuIEVqLjogdW4gYWx0YVxuICogICAgIHJlYXNpZ25hZGEgYSBvdHJvIHZlbmRlZG9yIGRlc2FwYXJlY2UgZGVsIGFwcHJvdmVkQWx0YXNMaXN0IGRlbCBWREUgeVxuICogICAgIGVsIGB2ZW5kb3JBc3NpZ25lZGAgdmllam8gbm8gdGllbmUgcXVlIHZvbHZlciBhIG1ldGVybGEuXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fSBbcmVzb2x2ZV1cbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpIHtcbiAgaWYgKCFwKSByZXR1cm4gJyc7XG4gIGNvbnN0IG0gPSBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSk7XG4gIGlmIChtLnZlbmRvcktleSkgcmV0dXJuIG0udmVuZG9yS2V5O1xuICBpZiAobS5yZWFzb24gPT09ICd6b25hX3Npbl92ZW5kZWRvcicpIHJldHVybiAnJztcbiAgaWYgKCFTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpKSByZXR1cm4gbm9ybVZlbmRvcktleShwLnZlbmRvckFzc2lnbmVkKTtcbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFZhbG9yIGRlIGxhIGNvbHVtbmEgXCJWZW5kZWRvclwiIGRlbCBFeGNlbCBkZSBQZWRpZG9zIGRlbCBtZXM6IG1hc3RlciBhY3R1YWwsXG4gKiBkZXNwdVx1MDBFOXMgYHZlbmRvckFzc2lnbmVkYCwgeSBgb3duZXJWZW5kb3JgIHNvbG8gc2kgbm8gaGF5IG90cmEgY29zYS5cbiAqIEBwYXJhbSB7YW55fSBwXG4gKiBAcGFyYW0ge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlXVxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKSB7XG4gIGlmICghcCkgcmV0dXJuICcnO1xuICBjb25zdCBtID0gbWFzdGVyTG9va3VwKHAsIHJlc29sdmUpO1xuICBpZiAobS52ZW5kb3JLZXkpIHJldHVybiBtLnZlbmRvcktleTtcbiAgLy8gWm9uYSBzaW4gdmVuZGVkb3I6IGxhIGNvbHVtbmEgcXVlZGEgdmFjXHUwMEVEYSAobm8gc2UgbXVlc3RyYSBlbCB2ZW5kZWRvciB2aWVqbykuXG4gIGlmIChtLnJlYXNvbiA9PT0gJ3pvbmFfc2luX3ZlbmRlZG9yJykgcmV0dXJuICcnO1xuICByZXR1cm4gU3RyaW5nKHAudmVuZG9yQXNzaWduZWQgfHwgJycpLnRyaW0oKSB8fCBTdHJpbmcocC5vd25lclZlbmRvciB8fCAnJykudHJpbSgpO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7U2V0PHN0cmluZz58QXJyYXk8c3RyaW5nPnxudWxsfHVuZGVmaW5lZH0gc1xuICogQHJldHVybnMge1NldDxzdHJpbmc+fG51bGx9XG4gKi9cbmZ1bmN0aW9uIHRvTm9ybVNldChzKSB7XG4gIGlmICghcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG91dCA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBrIG9mIC8qKiBAdHlwZSB7SXRlcmFibGU8c3RyaW5nPn0gKi8gKHMpKSB7XG4gICAgY29uc3QgbiA9IG5vcm1WZW5kb3JLZXkoayk7XG4gICAgaWYgKG4pIG91dC5hZGQobik7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBBcm1hIGxvcyBmaWx0cm9zIGRlIGV4cG9ydGFjaVx1MDBGM24gcGFyYSBlbCByb2wgZGVsIHVzdWFyaW8uXG4gKiBAcGFyYW0ge0V4cG9ydFNjb3BlQXJnc30gYXJnc1xuICogQHJldHVybnMge0V4cG9ydFNjb3BlfVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRFeHBvcnRTY29wZShhcmdzKSB7XG4gIGNvbnN0IGEgPSBhcmdzIHx8IC8qKiBAdHlwZSB7RXhwb3J0U2NvcGVBcmdzfSAqLyAoeyByb2xlOiBudWxsIH0pO1xuICBjb25zdCByb2xlID0gU3RyaW5nKGEucm9sZSB8fCAnJyk7XG4gIGNvbnN0IG15VWlkID0gU3RyaW5nKGEubXlVaWQgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgbXlLZXkgPSBub3JtVmVuZG9yS2V5KGEubXlWZW5kb3JLZXkpO1xuICBjb25zdCByZXNvbHZlID1cbiAgICB0eXBlb2YgYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50ID09PSAnZnVuY3Rpb24nID8gYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50IDogdW5kZWZpbmVkO1xuICAvKiogQHBhcmFtIHthbnl9IHAgKi9cbiAgY29uc3QgdmVuZG9yQ29sdW1uID0gKHApID0+IHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKTtcbiAgLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gYXJyICovXG4gIGNvbnN0IGNvbXBhY3QgPSAoYXJyKSA9PiAoQXJyYXkuaXNBcnJheShhcnIpID8gYXJyLmZpbHRlcihCb29sZWFuKSA6IFtdKTtcblxuICBpZiAocm9sZSA9PT0gJ3ZlbmRlZG9yJykge1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IHRydWUsXG4gICAgICB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG86IHZlbmRvckNvbHVtbixcbiAgICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IHtcbiAgICAgICAgaWYgKCFteVVpZCB8fCAhbXlLZXkpIHJldHVybiBbXTtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QoYXJyKS5maWx0ZXIoXG4gICAgICAgICAgKHApID0+XG4gICAgICAgICAgICBTdHJpbmcocC5hc3NpZ25lZFZlbmRvclVpZCB8fCAnJykgPT09IG15VWlkICYmXG4gICAgICAgICAgICByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpID09PSBteUtleVxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIGZpbHRlclZpc2l0czogKGFycikgPT4ge1xuICAgICAgICBpZiAoIW15VWlkKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKCh2KSA9PiBTdHJpbmcodi5vd25lclVpZCB8fCAnJykgPT09IG15VWlkKTtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmIChyb2xlID09PSAnaW50ZXJubycpIHtcbiAgICBjb25zdCBzZXQgPSB0b05vcm1TZXQoYS5lZmZlY3RpdmVWZW5kb3JTZXQpO1xuICAgIGNvbnN0IHBhcnRuZXJzID0gbmV3IFNldChcbiAgICAgIEFycmF5LmZyb20oLyoqIEB0eXBlIHtJdGVyYWJsZTxzdHJpbmc+fSAqLyAoYS5wYXJ0bmVyVWlkcyB8fCBbXSkpXG4gICAgICAgIC5tYXAoKHUpID0+IFN0cmluZyh1IHx8ICcnKS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoYXJyKSA9PiB7XG4gICAgICAgIGlmICghc2V0IHx8IHNldC5zaXplID09PSAwKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKChwKSA9PiB7XG4gICAgICAgICAgY29uc3QgayA9IHJlc29sdmVQZWRpZG9WZW5kb3JLZXkocCwgcmVzb2x2ZSk7XG4gICAgICAgICAgcmV0dXJuICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+XG4gICAgICAgIGNvbXBhY3QoYXJyKS5maWx0ZXIoKHYpID0+IHtcbiAgICAgICAgICBjb25zdCBvd25lciA9IFN0cmluZyh2Lm93bmVyVWlkIHx8ICcnKTtcbiAgICAgICAgICBpZiAobXlVaWQgJiYgKG93bmVyID09PSBteVVpZCB8fCBTdHJpbmcodi5jcmVhdGVkQnlVaWQgfHwgJycpID09PSBteVVpZCkpIHJldHVybiB0cnVlO1xuICAgICAgICAgIGlmIChvd25lciAmJiBwYXJ0bmVycy5oYXMob3duZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICBjb25zdCBrID0gbm9ybVZlbmRvcktleSh2LnZlbmRvcik7XG4gICAgICAgICAgcmV0dXJuICEhc2V0ICYmICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KSxcbiAgICB9O1xuICB9XG5cbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnICYmIHJvbGUgIT09ICd2aWV3ZXInKSB7XG4gICAgLy8gUm9sIHZhY1x1MDBFRG8sICd1bmFzc2lnbmVkJyBvIGRlc2Nvbm9jaWRvOiBubyBleHBvcnRhIG5hZGEgKGZhbGxhIGNlcnJhZG8pLlxuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoKSA9PiBbXSxcbiAgICAgIGZpbHRlclZpc2l0czogKCkgPT4gW10sXG4gICAgfTtcbiAgfVxuXG4gIC8vIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS5cbiAgcmV0dXJuIHtcbiAgICBpc0dsb2JhbDogdHJ1ZSxcbiAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgIHZlbmRvckNvbHVtbkZvclBlZGlkbzogdmVuZG9yQ29sdW1uLFxuICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgfTtcbn1cbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG5pbXBvcnQgeyBidWlsZEV4cG9ydFNjb3BlIH0gZnJvbSAnLi4vcHVyZS9leHBvcnQtc2NvcGUuanMnO1xuXG4vLyB2MTUzNCAoMjAyNi0xMS0wMikgXHUyMDE0IGFsY2FuY2UgcG9yIHJvbCBkZSBsYXMgZXhwb3J0YWNpb25lcyAoYXVkaXRvclx1MDBFRGEgNDYsXG4vLyBFdGFwYSAxKS4gUmVnbGEgZW4gc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzOiBlbCB2ZW5kZWRvciB2ZSBzb2xvIHBlZGlkb3MgZGVcbi8vIGNsaWVudGVzIHF1ZSBIT1kgc29uIHN1eW9zIGVuIGVsIG1hc3RlciAoUE9JTlRTICsgdmVuZG9yX292ZXJyaWRlcyArXG4vLyBhcHByb3ZlZEFsdGFzLCBcdTAwQTc0Ni9cdTAwQTc1MCkgeSBhZGVtXHUwMEUxcyBjb24gYXNzaWduZWRWZW5kb3JVaWQgPSBzdSB1c3VhcmlvOyBlbFxuLy8gaW50ZXJubyB2ZSBsb3MgY2xpZW50ZXMgZGUgc3Ugem9uYSArIHN1cyBwYXJlamFzIChnZXRNeUFsbG93ZWRWZW5kb3JLZXlzLFxuLy8gZWwgbWlzbW8gYWxjYW5jZSBkZWwgbWFwYSk7IGFkbWluL2dlcmVudGUgc2luIGNhbWJpby4gRWwgdWlkIHNhbGUgZGVcbi8vIEZpcmViYXNlIEF1dGggKG5vIGRlIHVzZXJSb2xlLCBxdWUgZXMgdW5hIHZhcmlhYmxlIGdsb2JhbCBlZGl0YWJsZSkuXG5mdW5jdGlvbiBfZXhwb3J0U2NvcGUoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdHlwZW9mIHVzZXJSb2xlICE9PSAndW5kZWZpbmVkJyA/IHVzZXJSb2xlIDogbnVsbDtcbiAgbGV0IG15VWlkID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHcuZmlyZWJhc2UgJiYgdy5maXJlYmFzZS5hdXRoICYmIHcuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgIG15VWlkID0gKHUgJiYgdS51aWQpIHx8ICcnO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG15VWlkID0gJyc7XG4gIH1cbiAgY29uc3QgbXlWZW5kb3JLZXkgPSB0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gYXNzaWduZWRWZW5kb3IgOiAnJztcbiAgbGV0IGVmZmVjdGl2ZVZlbmRvclNldCA9IG51bGw7XG4gIHRyeSB7XG4gICAgZWZmZWN0aXZlVmVuZG9yU2V0ID1cbiAgICAgIHR5cGVvZiBnZXRNeUFsbG93ZWRWZW5kb3JLZXlzID09PSAnZnVuY3Rpb24nID8gZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cygpIDogbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQgPSBudWxsO1xuICB9XG4gIGxldCBwYXJ0bmVyVWlkcyA9IFtdO1xuICB0cnkge1xuICAgIHBhcnRuZXJVaWRzID0gKFxuICAgICAgKHR5cGVvZiBteUV4dGVybmFsUGFydG5lcnMgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkobXlFeHRlcm5hbFBhcnRuZXJzKVxuICAgICAgICA/IG15RXh0ZXJuYWxQYXJ0bmVyc1xuICAgICAgICA6IFtdKSB8fCBbXVxuICAgIClcbiAgICAgIC5tYXAoKHgpID0+IHggJiYgeC51aWQpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHBhcnRuZXJVaWRzID0gW107XG4gIH1cbiAgLy8gUmVzb2x2ZXIgZGVsIG1hc3RlciBjb24gbWVtbyBwb3IgY2xpZW50ZSAodW5hIHBhc2FkYSBwb3IgZXhwb3J0KS5cbiAgLy8gRGV2dWVsdmUge3ZlbmRvcktleSwgcmVhc29ufSBwYXJhIHF1ZSBlbCBhbGNhbmNlIGRpc3RpbmdhIHByb3NwZWN0byBzaW5cbiAgLy8gQ2FyZENvZGUgKGNhZSBhIHZlbmRvckFzc2lnbmVkKSBkZSBDYXJkQ29kZSBubyByZXN1ZWx0byAoYWZ1ZXJhKS5cbiAgY29uc3QgbWVtbyA9IG5ldyBNYXAoKTtcbiAgY29uc3QgcmVzb2x2ZVZlbmRvckZvckNsaWVudCA9IChjYXJkQ29kZSwgY2xpZW50TmFtZSkgPT4ge1xuICAgIGNvbnN0IGsgPSBTdHJpbmcoY2FyZENvZGUgfHwgJycpICsgJ3wnICsgU3RyaW5nKGNsaWVudE5hbWUgfHwgJycpO1xuICAgIGlmIChtZW1vLmhhcyhrKSkgcmV0dXJuIG1lbW8uZ2V0KGspO1xuICAgIGxldCBvdXQgPSB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgciA9XG4gICAgICAgIHR5cGVvZiB3Ll9yZXNvbHZlQ2xpZW50VmVuZG9yRnJvbU1hc3RlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gdy5fcmVzb2x2ZUNsaWVudFZlbmRvckZyb21NYXN0ZXIoeyBjYXJkQ29kZSwgY2xpZW50TmFtZSB9KVxuICAgICAgICAgIDogbnVsbDtcbiAgICAgIGlmIChyKSBvdXQgPSB7IHZlbmRvcktleTogci52ZW5kb3JLZXkgfHwgJycsIHJlYXNvbjogci5yZWFzb24gfHwgJycgfTtcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgb3V0ID0geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgICB9XG4gICAgbWVtby5zZXQoaywgb3V0KTtcbiAgICByZXR1cm4gb3V0O1xuICB9O1xuICByZXR1cm4gYnVpbGRFeHBvcnRTY29wZSh7XG4gICAgcm9sZSxcbiAgICBteVVpZCxcbiAgICBteVZlbmRvcktleSxcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQsXG4gICAgcGFydG5lclVpZHMsXG4gICAgcmVzb2x2ZVZlbmRvckZvckNsaWVudCxcbiAgfSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIE1BU1RFUkZJTEUgREUgQ0xJRU5URVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxuLy8gbm9tYnJlLCB0aXBvIChjbGllbnRlL3Byb3NwZWN0byksIHpvbmEgZGVsIHZlbmRlZG9yLCBhc2Vzb3IgZXh0ZXJubywgYXNlc29yXG4vLyBpbnRlcm5vIChkZWR1Y2lkbyBwb3IgcGFyZWphIFZESSksIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBkZXBhcnRhbWVudG8sXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxuLy8gY29vcmRlbmFkYXMgZ2VvY29kaWZpY2FkYXMsIGVzdGFkbyAoSGFiaWxpdGFkby9QZW5kaWVudGUvQ2FuY2VsYWRvKSxcbi8vIGNhdGVnb3JpYSAoUmVndWxhci9WZW50YXMgRXNwZWNpYWxlcy9EaXN0cmlidWlkb3IpLlxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIVBPSU5UUyB8fCAhUE9JTlRTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgY2FyZ2Fkb3MgdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBtYXN0ZXJmaWxlIGRlIGNsaWVudGVzLi4uJyk7XG5cbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGNhcmdhciBjbGllbnRfYnV5ZXJfc3RhdHMgZW4gYmxvcXVlICgxIGRvYyBwb3IgY2FyZENvZGUgU0FQKVxuICAvLyBBTlRFUyBkZSBhcm1hciBsYXMgZmlsYXMsIGFzXHUwMEVEIGNhZGEgZmlsYSB0aWVuZSBzdSBidXllciBzdGF0cyArIGZlY2hhXG4gIC8vIFx1MDBGQWx0aW1hIGNvbXByYSBzaW4gcm9tcGVyIGVsIGZsdWpvLiBGaXJlLWFuZC1mb3JnZXQgc2kgZmFsbGE6IGNhZGEgZmlsYVxuICAvLyBjYWUgYSBcIi1cIiBlbiBsb3MgY2FtcG9zIEJ1eWVyLiBBZG1pbi9nZXJlbnRlIHZlIHRvZGEgbGEgY29sZWNjaVx1MDBGM247XG4gIC8vIHZlbmRlZG9yIHZlIHNcdTAwRjNsbyBsb3Mgc3V5b3MgKHJ1bGVzKS4gU2kgbGEgcnVsZSBibG9xdWVhIFx1MjE5MiBjYXRjaCBcdTIxOTIgdmFjXHUwMEVEby5cbiAgLy8gUGVkaWRvIE1hcmlhbm86IG5vIGludmVudGFyIGNcdTAwRTFsY3VsbyBkZSBcIkZlY2hhIFx1MDBGQWx0aW1hIGNvbXByYVwiOyBzaSBub1xuICAvLyBleGlzdGUgc2Ugb21pdGUuIGJ1eWVyX3N0YXRzLnN0YXRzXzEybS51bHRpbWFDb21wcmEgWUEgZXhpc3RlLlxuICBjb25zdCBidXllclN0YXRzSWR4ID0gbmV3IE1hcCgpO1xuICB0cnkge1xuICAgIGNvbnN0IGJzU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2J1eWVyX3N0YXRzJykuZ2V0KCk7XG4gICAgYnNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGJ1eWVyU3RhdHNJZHguc2V0KGQuaWQsIGQuZGF0YSgpIHx8IHt9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICAnW21hc3RlcmZpbGVdIGNsaWVudF9idXllcl9zdGF0cyBubyBjYXJnYWRvIChydWxlIGRlbmllZCBvIHJlZCk6JyxcbiAgICAgIF9lICYmIF9lLm1lc3NhZ2VcbiAgICApO1xuICB9XG4gIC8vIEhlbHBlcnMgZGVsIHB1cmUgZm4gKGZhbGxiYWNrIGlubGluZSBzaSBidW5kbGUgbm8gY2FyZ1x1MDBGMykuXG4gIGNvbnN0IF9mY0xhYmVscyA9XG4gICAgKHdpbmRvdy5fX3BoYXNlMCAmJiB3aW5kb3cuX19waGFzZTAucHVyZSAmJiB3aW5kb3cuX19waGFzZTAucHVyZS5maWNoYUNsaWVudGVMYWJlbHMpIHx8IG51bGw7XG4gIGNvbnN0IF9jbGFzaWZSb3cgPSAoY21kKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVDbGFzaWZSb3coY21kKVxuICAgICAgOiB7XG4gICAgICAgICAgJ1RpcG8gZGUgY2xpZW50ZSc6ICctJyxcbiAgICAgICAgICBGaWRlbGlkYWQ6ICctJyxcbiAgICAgICAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAnLScsXG4gICAgICAgICAgVGFtYVx1MDBGMW86ICctJyxcbiAgICAgICAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogJy0nLFxuICAgICAgICAgICdUaXBvIGRlIGxvY2FsJzogJy0nLFxuICAgICAgICAgICdDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJzogY21kICYmIGNtZC5jcmVkaXRvQ2hlcXVlID8gTnVtYmVyKGNtZC5jcmVkaXRvQ2hlcXVlKSA6ICctJyxcbiAgICAgICAgfTtcbiAgY29uc3QgX2J1eWVyUm93ID0gKGJzKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQnV5ZXJSb3dcbiAgICAgID8gX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93KGJzLCAnMTJtJylcbiAgICAgIDoge1xuICAgICAgICAgICdNb250byB0b3RhbCAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRmFjdHVyYXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1Byb21lZGlvIHBvciBmYWN0dXJhICgxMm0pJzogJy0nLFxuICAgICAgICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1ByaW1lcmEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9maWxsRGFzaCA9IChyb3cpID0+XG4gICAgX2ZjTGFiZWxzICYmIF9mY0xhYmVscy5maWxsRGFzaEluRW1wdHkgPyBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5KHJvdykgOiByb3c7XG4gIC8vIHYxNDg1IFx1MDBBNzg0ICgyMDI2LTEwLTI3IEJVRyBGSVgpOiBiXHUwMEZBc3F1ZWRhIHBvciBjYXJkQ29kZSAoZnVlbnRlIGF1dG9yaXRhdGl2YSkuXG4gIC8vIHYxNDgyIHVzYWJhIGBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoY2xpZW50TG9jSWQocHJvdiwgbG9jLCBuYW1lKSlgIFx1MjAxNCBzbHVnXG4gIC8vIGRlcml2YWRvIGRlIFBPSU5UUy4gUGFyYSBNQVhFUkEsIFBPSU5UUyBkaWNlIFwiUGFsZXJtbyAoQzE0KVwiIHBlcm8gbGEgRmljaGFcbiAgLy8gcGVyc2lzdGUgY29uIFwiQ09MRUdJQUxFU1wiIFx1MjE5MiBkb2NJZCBtaXNtYXRjaCBcdTIxOTIgY21EYXRhIHVuZGVmaW5lZCBcdTIxOTIgNSBjYW1wb3NcbiAgLy8gRmljaGEgc2FsXHUwMEVEYW4gXCItXCIgYXVucXVlIGNhcmdhZG9zLiBmaW5kQ21EYXRhQnlDYXJkQ29kZSBlc2NhbmVhIHBvclxuICAvLyBzYXBDYXJkQ29kZSBPUiBjYXJkQ29kZVNhcCAoYW1ib3MgYWxpYXNlcykgeSByZXRvcm5hIGVsIGRvYyBjb3JyZWN0by5cbiAgY29uc3QgX2ZpbmRCeUNhcmQgPVxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmluZENtRGF0YUJ5Q2FyZENvZGVcbiAgICAgID8gX2ZjTGFiZWxzLmZpbmRDbURhdGFCeUNhcmRDb2RlXG4gICAgICA6IChjYXJkQ29kZSwgY2FjaGUpID0+IHtcbiAgICAgICAgICBpZiAoIWNhcmRDb2RlIHx8ICFjYWNoZSB8fCB0eXBlb2YgY2FjaGUuZm9yRWFjaCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG51bGw7XG4gICAgICAgICAgbGV0IGZvdW5kID0gbnVsbDtcbiAgICAgICAgICBjYWNoZS5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgICAgICBpZiAoZm91bmQgfHwgIWQpIHJldHVybjtcbiAgICAgICAgICAgIGNvbnN0IGNjMSA9IFN0cmluZyhkLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICAgICAgICBjb25zdCBjYzIgPSBTdHJpbmcoZC5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgICAgICAgICAgaWYgKGNjMSA9PT0gY2FyZENvZGUgfHwgY2MyID09PSBjYXJkQ29kZSkgZm91bmQgPSBkO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBmb3VuZDtcbiAgICAgICAgfTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gbG9va3VwWm9uZSh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYuem9uZSA6ICcnO1xuICB9XG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xuICAgIHJldHVybiB2ID8gdi5sYWJlbCA6IHZlbmRvcktleSB8fCAnJztcbiAgfVxuXG4gIC8vIHY0NTAgKDIwMjYtMDgtMTEpOiBpbmRpY2UgZGUgY2xhc2lmaWNhY2lvbiBkZXNkZSB2aXNpdHMuIFBhcmEgY2FkYVxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXG4gIC8vIGVzcGVjaWFsaXphY2lvbi9jYW5hbENvbXByYS9wb3AvdGlwb1ZlbnRhL2V0Yy4pIGRlbCBmb3JtdWxhcmlvIGRlXG4gIC8vIHZpc2l0YS9jb250YWN0YWRvLiBQb2xpdGljYTogY2FtcG8gcG9yIGNhbXBvLCB0b21hciBlbCBwcmltZXIgdmFsb3JcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cbiAgLy8gdmUgbGEgY2xhc2lmaWNhY2lvbiBtYXMgYWN0dWFsaXphZGEsIHBlcm8gc2kgZWwgdWx0aW1vIGNvbnRhY3RvIG5vIGxsZW5hXG4gIC8vIHVuIGNhbXBvIChjb250YWN0b3MgdGllbmVuIG1lbm9zIGNhbXBvcyBxdWUgdmlzaXRhcyksIGNhZSBhbCBhbnRlcmlvclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcbiAgLy8gaW50ZXJhY2Npb24gcGVybyBubyBwZXJkZXIgaW5mbyB1dGlsIGRlIGxhcyBhbnRlcmlvcmVzXCIuXG4gIGNvbnN0IENMQVNTSUZfRklFTERTID0gW1xuICAgICd0aXBvJyxcbiAgICAnbG9jYWwnLFxuICAgICd0YW1hbm8nLFxuICAgICdmaWRlbGlkYWQnLFxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxuICAgICdjYW5hbENvbXByYScsXG4gICAgJ3JlbGV2YW5jaWEnLFxuICAgICdwb3AnLFxuICAgICduZWNlc2lkYWRQdW50dWFsJyxcbiAgICAndGlwb1ZlbnRhJyxcbiAgICAncG9uZGVyYWNpb25Nb3N0cmFkbycsXG4gICAgJ3BvbmRlcmFjaW9uRWNvbW1lcmNlJyxcbiAgICAnY29tcGV0ZW5jaWEnLFxuICAgICdvcG9ydHVuaWRhZCcsXG4gICAgJ21hc1ZlbmRpZG8nLFxuICAgICdtYXNQcmVndW50YW4nLFxuICAgICdheXVkYVRpZW5kYScsXG4gIF07XG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIChwcm92IHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkudHJpbSgpICtcbiAgICAgICd8JyArXG4gICAgICAobG9jIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcbiAgICApO1xuICB9XG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xuICAgIGlmICh2ICYmIHYuY3JlYXRlZEF0ICYmIHYuY3JlYXRlZEF0LnRvTWlsbGlzKSByZXR1cm4gdi5jcmVhdGVkQXQudG9NaWxsaXMoKTtcbiAgICBpZiAodiAmJiB2LmZlY2hhKSByZXR1cm4gbmV3IERhdGUodi5mZWNoYSkuZ2V0VGltZSgpIHx8IDA7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgY29uc3QgY2xhc3NpZkluZGV4ID0gbmV3IE1hcCgpOyAvLyBrZXkgLT4geyBsYXN0OiB7Y2FtcG9zfSwgbGFzdEZlY2hhLCBsYXN0VHlwZSwgdmlzaXRhcywgY29udGFjdG9zIH1cbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcbiAgICBjb25zdCBieUtleSA9IG5ldyBNYXAoKTtcbiAgICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICBpZiAoIXYpIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSBfY2xhc3NpZktleSh2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcbiAgICAgIGlmICghYnlLZXkuaGFzKGspKSBieUtleS5zZXQoaywgW10pO1xuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XG4gICAgfSk7XG4gICAgYnlLZXkuZm9yRWFjaCgoYXJyLCBrKSA9PiB7XG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxuICAgICAgY29uc3QgbWVyZ2VkID0ge307XG4gICAgICBhcnIuZm9yRWFjaCgodikgPT4ge1xuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICAgICAgaWYgKG1lcmdlZFtmXSAhPSBudWxsICYmIG1lcmdlZFtmXSAhPT0gJycgJiYgbWVyZ2VkW2ZdICE9PSAwKSByZXR1cm47XG4gICAgICAgICAgY29uc3QgdmFsID0gdltmXTtcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xuICAgICAgY2xhc3NpZkluZGV4LnNldChrLCB7XG4gICAgICAgIG1lcmdlZCxcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXG4gICAgICAgIGxhc3RUeXBlOiBsYXRlc3QuaW50ZXJhY3Rpb25UeXBlIHx8IChsYXRlc3QuZXNwYWNpbyA/ICd2aXNpdGEnIDogJycpLFxuICAgICAgICB2aXNpdGFzOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIGNvbnN0IGVudHJ5ID0gY2xhc3NpZkluZGV4LmdldChfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkpO1xuICAgIGlmICghZW50cnkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAnJyxcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUb3RhbCB2aXNpdGFzJzogMCxcbiAgICAgICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IDAsXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXG4gICAgICAgIExvY2FsOiAnJyxcbiAgICAgICAgVGFtYW5vOiAnJyxcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcbiAgICAgICAgRXNwZWNpYWxpemFjaW9uOiAnJyxcbiAgICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6ICcnLFxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcbiAgICAgICAgUE9QOiAnJyxcbiAgICAgICAgJ05lY2VzaWRhZCBwdW50dWFsJzogJycsXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6ICcnLFxuICAgICAgICBDb21wZXRlbmNpYTogJycsXG4gICAgICAgIE9wb3J0dW5pZGFkOiAnJyxcbiAgICAgICAgJ01hcyB2ZW5kaWRvJzogJycsXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXG4gICAgICAgICdBeXVkYSB0aWVuZGEnOiAnJyxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IG0gPSBlbnRyeS5tZXJnZWQgfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXG4gICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0VHlwZSxcbiAgICAgICdUb3RhbCB2aXNpdGFzJzogZW50cnkudmlzaXRhcyxcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXG4gICAgICAnVGlwbyBjb21lcmNpbyc6IG0udGlwbyB8fCAnJyxcbiAgICAgIExvY2FsOiBtLmxvY2FsIHx8ICcnLFxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcbiAgICAgIEZpZGVsaWRhZDogbS5maWRlbGlkYWQgfHwgJycsXG4gICAgICBFc3BlY2lhbGl6YWNpb246IG0uZXNwZWNpYWxpemFjaW9uIHx8ICcnLFxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXG4gICAgICBSZWxldmFuY2lhOiBtLnJlbGV2YW5jaWEgIT0gbnVsbCA/IG0ucmVsZXZhbmNpYSA6ICcnLFxuICAgICAgUE9QOiBtLnBvcCB8fCAnJyxcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAgICdUaXBvIGRlIHZlbnRhJzogbS50aXBvVmVudGEgfHwgJycsXG4gICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyAhPSBudWxsID8gbS5wb25kZXJhY2lvbk1vc3RyYWRvIDogJycsXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgICBDb21wZXRlbmNpYTogbS5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIE9wb3J0dW5pZGFkOiBtLm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgJ01hcyBwcmVndW50YW4nOiBtLm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgICdBeXVkYSB0aWVuZGEnOiBtLmF5dWRhVGllbmRhIHx8ICcnLFxuICAgIH07XG4gIH1cblxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxuICAvLyBlbCBtYXBhIHkgc2UgY3VlbnRhbiBlbiBlbCBzdGF0IEhBQklMSVRBRE9TLiBBbnRlcyBlbCBtYXN0ZXJmaWxlIGJhamFiYVxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxuICBjb25zdCByb3dzID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xuICAgIGNvbnN0IGxvY2FsaXR5TWFwID0gcC5uYW1lIHx8ICcnO1xuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XG4gICAgLy8gdjMzMTogZmlsdHJhciBwb3Igc2NvcGUgZGUgdmVuZG9yIGRlbCB1c3VhcmlvIHF1ZSBleHBvcnRhLlxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XG4gICAgLy8gU29sbyBjbGllbnRlcyByZWd1bGFyZXMgKG5vIHByb3NwZWN0cywgbm8gZGlzdHJpYnVpZG9yZXMpIHF1ZSBwYXNlblxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY29uc3QgayA9ICdDfCcgKyBwcm92aW5jZSArICd8JyArIGxvY2FsaXR5TWFwICsgJ3wnICsgbmFtZTtcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXG4gICAgICBpZiAodHlwZW9mIGNhbmNlbGVkICE9PSAndW5kZWZpbmVkJyAmJiBjYW5jZWxlZCAmJiBjYW5jZWxlZC5oYXMgJiYgY2FuY2VsZWQuaGFzKGspKVxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cbiAgICAgIGNvbnN0IG1ldGEgPSB0eXBlb2YgY2xpZW50TWV0YSAhPT0gJ3VuZGVmaW5lZCcgJiYgY2xpZW50TWV0YSA/IGNsaWVudE1ldGFba10gfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cbiAgICAgIGNvbnN0IGRvY0lkID1cbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xuICAgICAgY29uc3QgY21EYXRhID1cbiAgICAgICAgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBkb2NJZCA/IGNsaWVudE1hc3RlckNhY2hlLmdldChkb2NJZCkgfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XG4gICAgICBjb25zdCBjdXN0b21MYXQgPSBtZXRhLmxhdCAhPSBudWxsID8gbWV0YS5sYXQgOiAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxuICAgICAgbGV0IGNhcmRDb2RlID0gY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnO1xuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XG4gICAgICAgIGNvbnN0IGFsdGFzID0gYXBwcm92ZWRBbHRhc0J5TG9jW2tleV0gfHwgW107XG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XG4gICAgICB9XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogQnV5ZXIgc3RhdHMgaW5kZXhhZG8gcG9yIGNhcmRDb2RlIFNBUC5cbiAgICAgIGNvbnN0IF9idXllclN0YXRzID0gY2FyZENvZGUgPyBidXllclN0YXRzSWR4LmdldChjYXJkQ29kZSkgfHwgbnVsbCA6IG51bGw7XG4gICAgICAvLyB2MTQ4NSBcdTAwQTc4NCBCVUcgRklYOiBidXNjYXIgY21EYXRhIGF1dG9yaXRhdGl2byBwb3IgY2FyZENvZGUuIEVsXG4gICAgICAvLyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIGRlIGFycmliYSB1c2Egc2x1ZyBjbGllbnRMb2NJZCBxdWUgcHVlZGVcbiAgICAgIC8vIGFwdW50YXIgYWwgZG9jIEVRVUlWT0NBRE8gKHZlciBjb21tZW50IGFycmliYSkuIF9maW5kQnlDYXJkIHNjYW4gcG9yXG4gICAgICAvLyBzYXBDYXJkQ29kZSBnYXJhbnRpemEgZW5jb250cmFyIGVsIGRvYyBjb24gbG9zIGNhbXBvcyBGaWNoYS5cbiAgICAgIGNvbnN0IF9jbURhdGFGb3JGaWNoYSA9IF9maW5kQnlDYXJkKGNhcmRDb2RlLCBjbGllbnRNYXN0ZXJDYWNoZSkgfHwgY21EYXRhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBjYXJkQ29kZSxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbmFtZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcbiAgICAgICAgICAgIFRpcG86ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGVzdGFkbyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jYWxpdHlNYXAsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86IGRlcHQsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGFkZHJlc3MsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvY2FsaXR5Q3VzdCxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogY3VzdG9tTG5nIHx8IGxvbixcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBPUkRFTiBpbXBvcnRhLiBMZWdhY3kgdmlzaXRhcyBQUklNRVJPIChmYWxsYmFjayksXG4gICAgICAgICAgLy8gbHVlZ28gRmljaGEgQ2xpZW50ZSBQSVNBIGNvbiBsYWJlbHMgZGUgbGEgZnVlbnRlIGF1dG9yaXRhdGl2YVxuICAgICAgICAgIC8vIChlai4gXCJGaWRlbGlkYWRcIiBGaWNoYSBwaXNhIGxhIG1lcmdlYWRhIGRlIHZpc2l0YXMgcXVlIHB1ZWRlXG4gICAgICAgICAgLy8gZXN0YXIgZGVzYWN0dWFsaXphZGEpLiBCdXllciBzdGF0cyBhbCBmaW5hbCAodmVudGFuYSAxMm0pLlxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfY21EYXRhRm9yRmljaGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG4gIC8vIElueWVjdGFyIGFsdGFzIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgKGFwcHJvdmVkQWx0YXNMaXN0KTpcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxuICAvLyAgICAgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS4gVmFuIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLiBTZVxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXG4gIC8vICAgICBMb3MgcHJvdmlzb3Jpb3MgcHVlZGVuIG5vIHRlbmVyIGRpcmVjY2lvbiB0b2RhdmlhIC0+IHNlIGFjZXB0YW4gaWd1YWwuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIHNlZW4uYWRkKFxuICAgICAgKHIuUHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgKTtcbiAgfSk7XG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xuICAgIGFwcHJvdmVkQWx0YXNMaXN0LmZvckVhY2goKGEpID0+IHtcbiAgICAgIGlmICghYSkgcmV0dXJuO1xuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XG4gICAgICAvLyBIYWJpbGl0YWRvczogc2lndWVuIGV4aWdpZW5kbyBjYXJkQ29kZSArIGRpcmVjY2lvbiAoY29tcG9ydGFtaWVudG8gcHJlLXYzMTEpLlxuICAgICAgLy8gUHJvdmlzb3Jpb3M6IHNpbiBjYXJkQ29kZSBuaSBkaXJlY2Npb24sIHZhbiBpZ3VhbCBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy5cbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XG4gICAgICAgIGlmICghYS5jYXJkQ29kZVNhcCkgcmV0dXJuO1xuICAgICAgICBpZiAoIShhLmNhbGxlIHx8IGEuYWRkcmVzcykpIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByb3YgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBub21icmUgPVxuICAgICAgICBhLmNvbWVyY2lvIHx8XG4gICAgICAgIGEuZmFudGFzaWEgfHxcbiAgICAgICAgKGEuY2FyZENvZGVTYXAgPyAnU0FQICcgKyBhLmNhcmRDb2RlU2FwLnNsaWNlKDAsIDgpIDogYS50aXR1bGFyIHx8ICdQcm92aXNvcmlvJyk7XG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChzZWVuLmhhcyhkdXBLZXkpKSByZXR1cm47XG4gICAgICBzZWVuLmFkZChkdXBLZXkpO1xuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICAgIC8vIHYzMzE6IG1pc21vIGZpbHRybyBkZSBzY29wZSBhcGxpY2EgYSBhbHRhcyBTQVAvcHJvdmlzb3JpYXMuXG4gICAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcbiAgICAgIGNvbnN0IGxvYyA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyhzaW4gbG9jYWxpZGFkKSc7XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogcGFyYSBhbHRhcywgYnV5ZXIgc3RhdHMga2V5ZWQgcG9yIGNhcmRDb2RlU2FwIChzaSBleGlzdGUpLlxuICAgICAgY29uc3QgX2FsdGFCdXllclN0YXRzID0gYS5jYXJkQ29kZVNhcCA/IGJ1eWVyU3RhdHNJZHguZ2V0KGEuY2FyZENvZGVTYXApIHx8IG51bGwgOiBudWxsO1xuICAgICAgLy8gdjE0ODUgXHUwMEE3ODQgQlVHIEZJWDogcGFyYSBhbHRhcyBjb24gY2FyZENvZGUsIGVsIGRvYyBhdXRvcml0YXRpdm8gY29uXG4gICAgICAvLyBjYW1wb3MgRmljaGEgdml2ZSBlbiBjbGllbnRfbWFzdGVyIChsbyBlc2NyaWJlIHNhdmVDbGllbnRDYXRlZ29yaWFGcm9tTW9kYWxcbiAgICAgIC8vIHZpYSBGaWNoYSkuIF9maW5kQnlDYXJkIHJldG9ybmEgZXNlIGRvYy4gRmFsbGJhY2sgYWwgcHJvcGlvIGFsdGEgYGFgXG4gICAgICAvLyBzaSBlbCBjbGllbnRlIG5vIGVzdFx1MDBFMSBlbiBjbGllbnRfbWFzdGVyIChlai4gcHJvdmlzb3JpbyBzaW4gY2FyZENvZGUpLlxuICAgICAgY29uc3QgX2FsdGFDbURhdGEgPSBhLmNhcmRDb2RlU2FwID8gX2ZpbmRCeUNhcmQoYS5jYXJkQ29kZVNhcCwgY2xpZW50TWFzdGVyQ2FjaGUpIHx8IGEgOiBhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxuICAgICAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBub21icmUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxuICAgICAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbycgOiAnSGFiaWxpdGFkbycsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86ICcnLFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jLFxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogbWlzbW8gb3JkZW4gcXVlIFBPSU5UUyBcdTIwMTQgbGVnYWN5IHZpc2l0YXMgcHJpbWVybyxcbiAgICAgICAgICAvLyBGaWNoYSBwaXNhLCBCdXllciBhbCBmaW5hbC5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfYWx0YUNtRGF0YSksXG4gICAgICAgICAgX2J1eWVyUm93KF9hbHRhQnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXG4gIHJvd3Muc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKGFbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xuICB9KTtcblxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXG4gICAgICAgICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJyArXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCBoZWxwZXIgKGVzdGlsbyB2ZXJkZSArIGNlbnRlcmVkXG4gIC8vIHVuaWZvcm1lKS4gQW50ZXMgdXNhYmEgWExTWC53cml0ZUZpbGUgZGlyZWN0byBjb24gU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmFcbiAgLy8gZXN0aWxvcy4gQWhvcmEgaGVyZWRhZG8gZGVsIGhlbHBlciBcdTIwMTQgbWlzbWEgVUkgcXVlIFZlbnRhcy9WaXNpdGFzL2V0Yy5cbiAgLy8gdjEwNDMgKDIwMjYtMDktMjMpOiBwb3N0LXByb2Nlc28gXHUyMDE0IHNhY2FyIGNvbHVtbmFzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIC8vIFJlcG9ydGUgTWFyaWFubzogbWFzdGVyZmlsZSBleHBvcnRhYmEgMzcgY29sdW1uYXMgZG9uZGUgbXVjaGFzIHZlblx1MDBFRGFuXG4gIC8vIHZhY1x1MDBFRGFzIHBvcnF1ZSBubyBoYWJcdTAwRURhIHZpc2l0YXMvY29udGFjdG9zIGNhcmdhZG9zIHBhcmEgZXNvcyBjbGllbnRlcy5cbiAgLy8gRml4OiBpZGVudGlmaWNhciBrZXlzIGRvbmRlIFRPREFTIGxhcyBmaWxhcyB0aWVuZW4gdmFsb3IgXCJ2YWNcdTAwRURvXCIgKGVtcHR5XG4gIC8vIHN0cmluZywgbnVsbCwgdW5kZWZpbmVkKSB5IHJlbW92ZXJsYXMgYW50ZXMgZGVsIHNoZWV0LiBMb3MgY29udGVvc1xuICAvLyAoVG90YWwgdmlzaXRhcy9jb250YWN0b3MpIHNlIGNvbnNpZGVyYW4gdmFjXHUwMEVEb3Mgc2kgdG9kb3Mgc29uIDAuXG4gIC8vIFdpZHRocyBwb3IgY29sdW1uLW5hbWUgKGVuIHZleiBkZSBwb3NpY2lvbmFsKSBwYXJhIHF1ZSBlbCBmaWx0ZXIgbm9cbiAgLy8gZGVzYWxpbmVlIGVsIHNoZWV0IGN1YW5kbyByZW1vdmVtb3MgY29sdW1uYXMuXG4gIGNvbnN0IENPTF9XSURUSFMgPSB7XG4gICAgJ0NhcmRDb2RlIFNBUCc6IDE2LFxuICAgICdOb21icmUgdGllbmRhJzogMzgsXG4gICAgJ0FsaWFzIChtb2RhbCknOiAyOCxcbiAgICBUaXBvOiAxNCxcbiAgICBFc3RhZG86IDE0LFxuICAgIFByb3ZpbmNpYTogMjIsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknOiAyMixcbiAgICBEZXBhcnRhbWVudG86IDIyLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogMjgsXG4gICAgWm9uYTogOCxcbiAgICAnRXRpcXVldGEgem9uYSc6IDQ4LFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IDI4LFxuICAgIERpcmVjY2lvbjogMzgsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiAyNCxcbiAgICAnTGF0IChnZW9jb2RlKSc6IDE0LFxuICAgICdMbmcgKGdlb2NvZGUpJzogMTQsXG4gICAgLy8gdjE0ODIgXHUwMEE3ODI6IGNvbHVtbmFzIGRlIGxhIEZpY2hhIENsaWVudGUgKHBlc3RhXHUwMEYxYSBDbGFzaWZpY2FjaVx1MDBGM24pICtcbiAgICAvLyBCdXllciAocGVzdGFcdTAwRjFhIEJ1eWVyLCB2ZW50YW5hIDEybSkuIE9yZGVuIGV4YWN0byBxdWUgbGxlZ2EgZGVzZGVcbiAgICAvLyBfY2xhc2lmUm93IChPYmplY3QuYXNzaWduIHByZXNlcnZhIG9yZGVuIGRlIGtleXMpLlxuICAgICdUaXBvIGRlIGNsaWVudGUnOiAzNixcbiAgICBGaWRlbGlkYWQ6IDEwLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0byc6IDIwLFxuICAgIFRhbWFcdTAwRjFvOiAxMCxcbiAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogMjAsXG4gICAgJ1RpcG8gZGUgbG9jYWwnOiAxNCxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IDE4LFxuICAgICdNb250byB0b3RhbCAoMTJtKSc6IDE2LFxuICAgICdGYWN0dXJhcyAoMTJtKSc6IDEyLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6IDIwLFxuICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAyMCxcbiAgICAnRmFjdHVyYXMgcG9yIG1lcyAoMTJtKSc6IDE2LFxuICAgICdQcmltZXJhIGNvbXByYSc6IDE0LFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAxNCxcbiAgICAnRFx1MDBFRGFzIGRlc2RlIFx1MDBGQWx0aW1hIGNvbXByYSc6IDE4LFxuICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVG90YWwgdmlzaXRhcyc6IDEwLFxuICAgICdUb3RhbCBjb250YWN0b3MnOiAxMCxcbiAgICAnVGlwbyBjb21lcmNpbyc6IDE4LFxuICAgIExvY2FsOiAxNixcbiAgICAnQ2FuYWwgZGUgY29tcHJhJzogMjAsXG4gICAgUmVsZXZhbmNpYTogMTAsXG4gICAgUE9QOiA4LFxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IDI2LFxuICAgICdUaXBvIGRlIHZlbnRhJzogMTYsXG4gICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAxOCxcbiAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAxOCxcbiAgICBDb21wZXRlbmNpYTogMjYsXG4gICAgT3BvcnR1bmlkYWQ6IDI2LFxuICAgICdNYXMgdmVuZGlkbyc6IDIyLFxuICAgICdNYXMgcHJlZ3VudGFuJzogMjIsXG4gICAgJ0F5dWRhIHRpZW5kYSc6IDI2LFxuICB9O1xuICAvLyBEZXRlY3RhciBrZXlzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIGNvbnN0IGFsbEtleXMgPSBPYmplY3Qua2V5cyhDT0xfV0lEVEhTKTtcbiAgY29uc3QgTlVNRVJJQ19aRVJPX09LID0gbmV3IFNldChbJ1RvdGFsIHZpc2l0YXMnLCAnVG90YWwgY29udGFjdG9zJ10pO1xuICAvLyB2MTQ4MiBcdTAwQTc4MiArIHYxNDg1IFx1MDBBNzg0IG1lam9yYTogY29sdW1uYXMgRmljaGEgKyBlc3RydWN0dXJhbGVzIChDYXJkQ29kZSxcbiAgLy8gWm9uYSwgVmVuZGVkb3IsIERpcmVjY2lcdTAwRjNuLCBldGMuKSBOVU5DQSBzZSBvbWl0ZW4uIE1hcmlhbm8gcGlkaVx1MDBGMzpcbiAgLy8gXCJubyBvY3VsdGFyIGNvbHVtbmFzIHBvciByb2w7IFBBQ0hJIHJlY2liZSBsYXMgbWlzbWFzIGNvbHVtbmFzIHF1ZVxuICAvLyBhZG1pbiwgc29sbyBzdXMgY2xpZW50ZXNcIi4gRWwgZXhwb3J0IFZERS9QQUNISSByZXNwZXRhIGVzdGUgY29udHJhdG9cbiAgLy8gcG9ycXVlIGxhcyBzdHJ1Y3R1cmFsZXMgZXN0XHUwMEUxbiBwcm90ZWdpZGFzIGF1bnF1ZSBlbCBzY29wZSByZWR1Y2lkbyBub1xuICAvLyB0ZW5nYSBkYXRvcyBwYXJhIGFsZ3VuYSBkZSBlbGxhcy5cbiAgY29uc3QgU1RSVUNUVVJBTF9QUk9URUNURUQgPSBuZXcgU2V0KFtcbiAgICAnQ2FyZENvZGUgU0FQJyxcbiAgICAnTm9tYnJlIHRpZW5kYScsXG4gICAgJ0FsaWFzIChtb2RhbCknLFxuICAgICdUaXBvJyxcbiAgICAnRXN0YWRvJyxcbiAgICAnUHJvdmluY2lhJyxcbiAgICAnTG9jYWxpZGFkIChtYXBhKScsXG4gICAgJ0RlcGFydGFtZW50bycsXG4gICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknLFxuICAgICdab25hJyxcbiAgICAnRXRpcXVldGEgem9uYScsXG4gICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJyxcbiAgICAnRGlyZWNjaW9uJyxcbiAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYScsXG4gICAgJ0xhdCAoZ2VvY29kZSknLFxuICAgICdMbmcgKGdlb2NvZGUpJyxcbiAgXSk7XG4gIGNvbnN0IEZJQ0hBX1BST1RFQ1RFRCA9IG5ldyBTZXQoW1xuICAgICdUaXBvIGRlIGNsaWVudGUnLFxuICAgICdGaWRlbGlkYWQnLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0bycsXG4gICAgJ1RhbWFcdTAwRjFvJyxcbiAgICAnRXNwZWNpYWxpemFjaVx1MDBGM24nLFxuICAgICdUaXBvIGRlIGxvY2FsJyxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKScsXG4gICAgJ01vbnRvIHRvdGFsICgxMm0pJyxcbiAgICAnRmFjdHVyYXMgKDEybSknLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKScsXG4gICAgJ0ZyZWN1ZW5jaWEgKGRcdTAwRURhcyBlbnRyZSBjb21wcmFzKScsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknLFxuICAgICdQcmltZXJhIGNvbXByYScsXG4gICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnLFxuICBdKTtcbiAgY29uc3QgZW1wdHlLZXlzID0gbmV3IFNldChcbiAgICBhbGxLZXlzLmZpbHRlcigoaykgPT4ge1xuICAgICAgaWYgKFNUUlVDVFVSQUxfUFJPVEVDVEVELmhhcyhrKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKEZJQ0hBX1BST1RFQ1RFRC5oYXMoaykpIHJldHVybiBmYWxzZTtcbiAgICAgIHJldHVybiByb3dzLmV2ZXJ5KChyKSA9PiB7XG4gICAgICAgIGNvbnN0IHYgPSByW2tdO1xuICAgICAgICBpZiAodiA9PT0gJycgfHwgdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgICAgICBpZiAoTlVNRVJJQ19aRVJPX09LLmhhcyhrKSAmJiB2ID09PSAwKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gICAgfSlcbiAgKTtcbiAgY29uc3Qga2VwdEtleXMgPSBhbGxLZXlzLmZpbHRlcigoaykgPT4gIWVtcHR5S2V5cy5oYXMoaykpO1xuICAvLyB2MTQ4MiBcdTAwQTc4MjogcmVnbGEgXCJuaW5ndW5hIGNlbGRhIHZhY1x1MDBFRGFcIiBcdTIwMTQgZmlsbERhc2hJbkVtcHR5IHNvYnJlIFRPREFTXG4gIC8vIGxhcyBjb2x1bW5hcyBmaW5hbGVzIChjbGFzaWYgKyBidXllciArIGxlZ2FjeSB2aXNpdGFzKS5cbiAgY29uc3Qgcm93c0ZpbHRlcmVkID0gcm93cy5tYXAoKHIpID0+IHtcbiAgICBjb25zdCBvdXQgPSB7fTtcbiAgICBrZXB0S2V5cy5mb3JFYWNoKChrKSA9PiB7XG4gICAgICBvdXRba10gPSByW2tdO1xuICAgIH0pO1xuICAgIHJldHVybiBfZmlsbERhc2gob3V0KTtcbiAgfSk7XG4gIGNvbnN0IHJlbW92ZWRDb3VudCA9IGVtcHR5S2V5cy5zaXplO1xuICBpZiAocmVtb3ZlZENvdW50ID4gMCkge1xuICAgIGNvbnNvbGUubG9nKGBbbWFzdGVyZmlsZV0gcmVtb3ZpZGFzICR7cmVtb3ZlZENvdW50fSBjb2xzIHZhY1x1MDBFRGFzOmAsIFsuLi5lbXB0eUtleXNdLmpvaW4oJywgJykpO1xuICB9XG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxuICAvLyB2MTQ4MiBcdTAwQTc4MjogYWdyZWdhciBjb250ZW8gcG9yIFRpcG8gZGUgY2xpZW50ZSArIEZpZGVsaWRhZCAoZG9zIG51ZXZhc1xuICAvLyBjb2x1bW5hcyBjb24gZGV0YWxsZSBwb3Igem9uYSkuIEZvcm1hdG8gYnJldmUgXCJBOiBOLCBCOiBNLCAtOiBLXCIgcGFyYVxuICAvLyBjYWJlciBlbiB1bmEgc29sYSBjZWxkYSBsZWdpYmxlLlxuICBjb25zdCBieVpvbmUgPSB7fTtcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xuICAgIGlmICghYnlab25lW3pdKSB7XG4gICAgICBieVpvbmVbel0gPSB7XG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBoYWJpbGl0YWRvczogMCxcbiAgICAgICAgY2FuY2VsYWRvczogMCxcbiAgICAgICAgdGlwb3M6IHt9LFxuICAgICAgICBmaWRlbGlkYWRlczoge30sXG4gICAgICB9O1xuICAgIH1cbiAgICBieVpvbmVbel0udG90YWwrKztcbiAgICBpZiAoci5Fc3RhZG8gPT09ICdIYWJpbGl0YWRvJykgYnlab25lW3pdLmhhYmlsaXRhZG9zKys7XG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xuICAgIC8vIFRpcG8gZGUgY2xpZW50ZTogdG9tYXIgcHJpbWVyIGNoYXIgZGVsIGxhYmVsIChcIkEgLSAuLi5cIiwgXCJCIC0gLi4uXCIsXG4gICAgLy8gXCJQIChQcmVtaXVtKS4uLlwiLCBcIkMgLSAuLi5cIikuIFNpIGxhYmVsIGVzIFwiLVwiIFx1MjE5MiBcIi1cIi5cbiAgICBjb25zdCB0aXBvTGJsID0gclsnVGlwbyBkZSBjbGllbnRlJ10gfHwgJy0nO1xuICAgIGNvbnN0IHRpcG9LZXkgPSB0aXBvTGJsID09PSAnLScgPyAnLScgOiBTdHJpbmcodGlwb0xibCkudHJpbSgpLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpO1xuICAgIGJ5Wm9uZVt6XS50aXBvc1t0aXBvS2V5XSA9IChieVpvbmVbel0udGlwb3NbdGlwb0tleV0gfHwgMCkgKyAxO1xuICAgIGNvbnN0IGZpZCA9IHIuRmlkZWxpZGFkIHx8ICctJztcbiAgICBieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSA9IChieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSB8fCAwKSArIDE7XG4gIH0pO1xuICBmdW5jdGlvbiBfZm10RGlzdChkaXN0KSB7XG4gICAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGRpc3QpLnNvcnQoKGEsIGIpID0+IGJbMV0gLSBhWzFdKTtcbiAgICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVybiAnLSc7XG4gICAgcmV0dXJuIGVudHJpZXMubWFwKChbaywgdl0pID0+IGAke2t9OiAke3Z9YCkuam9pbignLCAnKTtcbiAgfVxuICBjb25zdCByZXN1bWVuUm93cyA9IE9iamVjdC5lbnRyaWVzKGJ5Wm9uZSlcbiAgICAubWFwKChbeiwgZF0pID0+ICh7XG4gICAgICAnWm9uYSAvIFZlbmRlZG9yJzogeixcbiAgICAgICdUb3RhbCB0aWVuZGFzJzogZC50b3RhbCxcbiAgICAgIEhhYmlsaXRhZGFzOiBkLmhhYmlsaXRhZG9zLFxuICAgICAgQ2FuY2VsYWRhczogZC5jYW5jZWxhZG9zLFxuICAgICAgJ1BvciBUaXBvIGRlIGNsaWVudGUnOiBfZm10RGlzdChkLnRpcG9zKSxcbiAgICAgICdQb3IgRmlkZWxpZGFkJzogX2ZtdERpc3QoZC5maWRlbGlkYWRlcyksXG4gICAgfSkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1RvdGFsIHRpZW5kYXMnXSAtIGFbJ1RvdGFsIHRpZW5kYXMnXSk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAvLyB2MzMxOiBzdWZpam8gY29uIGVsIHNjb3BlIGFwbGljYWRvIHBhcmEgZGlmZXJlbmNpYXIgZWwgYXJjaGl2byBkZWwgVkRFL1ZESVxuICAvLyBkZWwgZXhwb3J0IGdsb2JhbCBkZWwgYWRtaW4uXG4gIGNvbnN0IHNjb3BlTGJsID1cbiAgICBzY29wZVNldCA9PT0gbnVsbFxuICAgICAgPyAnVE9ET1MnXG4gICAgICA6IHNjb3BlU2V0LnNpemUgPT09IDFcbiAgICAgICAgPyBbLi4uc2NvcGVTZXRdWzBdLnNwbGl0KCcgJylbMF1cbiAgICAgICAgOiAnbWlzLXpvbmFzLScgKyBzY29wZVNldC5zaXplO1xuICAvLyB2MTU2NSAoMjAyNi0xMS0xOCk6IHJlbWFwIGEgbGFzIDE3IGNvbHVtbmFzIGV4YWN0YXMgcG9yIHBlZGlkbyBNYXJpYW5vLlxuICAvLyBOb21icmVzIHkgb3JkZW4gc29uIGZpam9zLiBDb2x1bW5hcyBzaW4gZnVlbnRlIGVzdGFibGUgcXVlZGFuIHZhY2lhc1xuICAvLyAoZWouIFVMVElNQV9WSVNJVEEvQ09OVEFDVE9fRkVDSEEgcmVxdWllcmUgYWdyZWdhZG8gYWRpY2lvbmFsIGRlc2RlXG4gIC8vIHZpc2l0czsgdmVyIGRvY3MvQ0hBTkdFTE9HLWV4cG9ydHMtY29sdW1ucy1yZWZhY3Rvci5tZCBwYXJhIGVsIGxpc3RhZG8pLlxuICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+fSAqL1xuICBjb25zdCByb3dzTWFyaWFubyA9IHJvd3NGaWx0ZXJlZC5tYXAoKHIpID0+ICh7XG4gICAgQ0FSRENPREVfU0FQOiByWydDYXJkQ29kZSBTQVAnXSB8fCAnJyxcbiAgICBOT01CUkVfVElFTkRBOiByWydOb21icmUgdGllbmRhJ10gfHwgJycsXG4gICAgVElQT19DTElFTlRFOiByLlRpcG8gfHwgJycsIC8vIHYxNTY1OiBUaXBvIChDbGllbnRlIGFjdHVhbCAvIFByb3Zpc29yaW8pLlxuICAgIFBST1ZJTkNJQTogci5Qcm92aW5jaWEgfHwgJycsXG4gICAgTE9DQUxJREFEOiByWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgclsnTG9jYWxpZGFkIGRlY2xhcmFkYSddIHx8ICcnLFxuICAgIERJUkVDQ0lPTjogci5EaXJlY2Npb24gfHwgJycsXG4gICAgVElQT19ERV9DTElFTlRFOiByWydUaXBvIGRlIGNsaWVudGUnXSB8fCAnJywgLy8gRmljaGEgQ2xpZW50ZSAoY2xhc2lmKS5cbiAgICAnVEFNQVx1MDBEMU8nOiByWydUYW1hXHUwMEYxbyddIHx8IHIuVGFtYW5vIHx8ICcnLFxuICAgIEVTUEVDSUFMSVpBQ0lPTjogclsnRXNwZWNpYWxpemFjaVx1MDBGM24nXSB8fCByLkVzcGVjaWFsaXphY2lvbiB8fCAnJyxcbiAgICBUSVBPX0RFX0xPQ0FMOiByWydUaXBvIGRlIGxvY2FsJ10gfHwgJycsXG4gICAgUFJFRkVSRU5DSUFTX0NPTlRBQ1RPOiByWydQcmVmZXJlbmNpYSBkZSBjb250YWN0byddIHx8ICcnLFxuICAgIENSRURJVE9fQ0hFUVVFOiByWydDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJ10gfHwgJycsXG4gICAgRkFDVFVSQUNJT05fQUNVTVVMQURBXzEyTUVTRVM6IHJbJ01vbnRvIHRvdGFsICgxMm0pJ10gfHwgJycsXG4gICAgJ0ZSRUNVRU5DSUFfQ09NUFJBKERJQVMpJzogclsnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJ10gfHwgJycsXG4gICAgVUxUSU1BX0NPTVBSQTogclsnXHUwMERBbHRpbWEgY29tcHJhJ10gfHwgJycsXG4gICAgVkVOREVET1JfQVNJR05BRE86IHJbJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknXSB8fCAnJyxcbiAgICAnVUxUSU1BX1ZJU0lUQS9DT05UQUNUT19GRUNIQSc6ICcnLCAvLyB2MTU2NSBwZW5kaWVudGU6IHJlcXVpZXJlIHF1ZXJ5IGV4dHJhIGEgdmlzaXRzLlxuICB9KSk7XG4gIGNvbnN0IGZuYW1lID0gJ01hc3RlciBDbGllbnRlc18nICsgc2NvcGVMYmwgKyAnXycgKyB0cyArICcueGxzeCc7XG4gIGF3YWl0IGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ01hc3RlciBDbGllbnRlcycsIHJvd3M6IHJvd3NNYXJpYW5vIH1dKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBleHBvcnRhZG9zJyArXG4gICAgICAoc2NvcGVTZXQgPT09IG51bGwgPyAnJyA6ICcgKHNjb3BlOiAnICsgWy4uLnNjb3BlU2V0XS5qb2luKCcsICcpICsgJyknKVxuICApO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQ6IFByZWNpb3MgKyBTdG9jayBwb3IgU0tVXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSB1biBFeGNlbCBjb24gVE9ETyBlbCBjYXRhbG9nbyBjcnV6YW5kbyBsb3MgMyBtYXBhcyB2aWdlbnRlc1xuLy8gZW4gbWVtb3JpYTogUFJPRFVDVFMgKG1hc3RlciBkZSBTS1VzKSwgUFJJQ0VfTElTVF9NQVAgKHByZWNpbyBBUlMgZGVcbi8vIEZpcmVzdG9yZSkgeSBTVE9DS19NQVAgKGJvb2xlYW5vIHBvciBTS1UgZGVsIHN0b2NrLmpzb24gZGVsIHJlcG8pLlxuLy8gSG9qYXM6XG4vLyAgLSBcIlByZWNpb3MgeSBTdG9ja1wiOiB1bmEgZmlsYSBwb3IgU0tVIGNvbiB0b2RhcyBsYXMgY29sdW1uYXMganVudGFzXG4vLyAgICAobG8gbWFzIGNvbXVuIHBhcmEgcmV2aXNhciBkaXNwb25pYmlsaWRhZCArIHByZWNpbykuXG4vLyAgLSBcIlByZWNpb3NcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIHByZWNpbyAoc2luIHN0b2NrKS5cbi8vICAtIFwiU3RvY2tcIjogc29sbyBTS1UgKyBkZXNjcmlwY2lvbiArIGVzdGFkbyBkZSBzdG9jay5cbi8vICAtIFwiSW5mb1wiOiBmZWNoYSBkZSBsb3Mgc25hcHNob3RzIHkgZnVlbnRlcy5cbndpbmRvdy5leHBvcnRQcmVjaW9zU3RvY2sgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoUFJPRFVDVFMpIHx8ICFQUk9EVUNUUy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGNhdGFsb2dvIGRlIHByb2R1Y3RvcyBjYXJnYWRvIHRvZGF2aWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgcHJlY2lvcyArIHN0b2NrLi4uJyk7XG4gIC8vIHY1NzQgKDIwMjYtMDgtMjEpOiBtb3N0cmFyIFVOSURBREVTIG51bWVyaWNhcyBleGFjdGFzIGRlbCBkZXBvc2l0byAxMS5cbiAgLy8gdjEzNjMgKDIwMjYtMTAtMTkpOiBwZWRpZG8gTWFyaWFubyBcdTIwMTQgY2FtYmlhciBkZSBcInN0b2NrIGZcdTAwRURzaWNvIGRlcCAxMVwiIGFcbiAgLy8gXCJsaWJyZSBwYXJhIGxhIHZlbnRhXCIgKD0gZGVwIDExIFx1MjIxMiByZXNlcnZhcyBjb25maXJtZWQvQk8vQVNJRy93YWl0bGlzdCkuXG4gIC8vIFJhelx1MDBGM246IGVudmlhciBhbCBjbGllbnRlIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGxlIHB1ZWRlIHByb21ldGVyIEhPWS5cbiAgLy8gU2kgc29sbyBtb3N0cmFtb3Mgc3RvY2sgZlx1MDBFRHNpY28sIHB1ZWRlIHBhc2FyIHF1ZSBoYXlhIDV1IHBlcm8gbGFzIDUgZXN0XHUwMEU5blxuICAvLyByZXNlcnZhZGFzIFx1MjE5MiBlbCBjbGllbnRlIHNlIGVudGVyYSByZWNpXHUwMEU5biBhbCBoYWNlciBlbCBwZWRpZG8gcXVlIG5vIGhheS5cbiAgLy8gVXNhIGdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSAocHVyZSBmdW5jdGlvbiwgZmlsdHJhIFRUTHMpLiBSZXRvcm5hICcnIHNpXG4gIC8vIG5vIGhheSBzbmFwc2hvdCBjYXJnYWRvOyAwIHNpIG5vIGhheSBsaWJyZS5cbiAgZnVuY3Rpb24gZm10U3RvY2soc2t1KSB7XG4gICAgY29uc3QgZm5SZWFsID1cbiAgICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZVxuICAgICAgICA6IG51bGw7XG4gICAgaWYgKGZuUmVhbCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdiA9IGZuUmVhbChza3UpO1xuICAgICAgICBpZiAodiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgICAgIHJldHVybiBOdW1iZXIodikgfHwgMDtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIC8vIGZhbGxiYWNrIGEgc3RvY2sgZlx1MDBFRHNpY28gYWJham9cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gRmFsbGJhY2s6IHN0b2NrIGZcdTAwRURzaWNvIGRlcCAxMSAoc2kgZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlIG5vIGVzdFx1MDBFMSBkaXNwb25pYmxlLFxuICAgIC8vIGVqLiBib290c3RyYXAgbXV5IHRlbXByYW5vKS5cbiAgICBjb25zdCBmbkZpc2ljbyA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gd2luZG93LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhXG4gICAgICAgIDogbnVsbDtcbiAgICBjb25zdCB2RiA9IGZuRmlzaWNvID8gZm5GaXNpY28oc2t1KSA6IG51bGw7XG4gICAgaWYgKHZGID09IG51bGwpIHJldHVybiAnJztcbiAgICByZXR1cm4gTnVtYmVyKHZGKSB8fCAwO1xuICB9XG4gIGZ1bmN0aW9uIGZtdFByZWNpbyhza3UpIHtcbiAgICBjb25zdCBwID0gdHlwZW9mIFBSSUNFX0xJU1RfTUFQID09PSAnb2JqZWN0JyAmJiBQUklDRV9MSVNUX01BUCA/IFBSSUNFX0xJU1RfTUFQW3NrdV0gOiBudWxsO1xuICAgIGlmIChwID09IG51bGwpIHJldHVybiAnJztcbiAgICByZXR1cm4gTnVtYmVyKHApIHx8IDA7XG4gIH1cbiAgLy8gdjEzNjQgKDIwMjYtMTAtMTkpOiByZXdvcmsgZGVsIGV4cG9ydCBwb3IgcGVkaWRvIE1hcmlhbm86XG4gIC8vIC0gSG9qYSBwcmluY2lwYWwgcmVub21icmFkYSBcIlByZWNpb3MgeSBTdG9ja1wiIC0+IFwiTGlzdGEgZGUgcHJlY2lvc1wiLlxuICAvLyAtIE51ZXZhIGNvbHVtbmEgXCJEaXNwb25pYmlsaWRhZFwiIChESVNQT05JQkxFIHZlcmRlIHNpIFN0b2NrPjAsIE5PIERJU1BPTklCTEVcbiAgLy8gICByb2pvIHNpIFN0b2NrPD0wIG8gdmFjaW8pLlxuICAvLyAtIEhvamEgXCJJbmZvXCIgZWxpbWluYWRhLlxuICAvLyAtIE5vbWJyZSBhcmNoaXZvOiBQcmVjaW9zX3lfU3RvY2tfWVlZWS1NTS1ERC54bHN4IC0+IExpc3RhX2RlX1ByZWNpb3NfWVlZWS1NTS1ERC54bHN4LlxuICAvLyBIb2phcyBcIlByZWNpb3NcIiB5IFwiU3RvY2tcIiBzZSBtYW50aWVuZW4gcG9yIHNpIE1hcmlhbm8gbGFzIHVzYS5cbiAgZnVuY3Rpb24gZGlzcExhYmVsKHN0b2NrVmFsKSB7XG4gICAgaWYgKHN0b2NrVmFsID09PSAnJyB8fCBzdG9ja1ZhbCA9PSBudWxsKSByZXR1cm4gJ05PIERJU1BPTklCTEUnO1xuICAgIHJldHVybiBOdW1iZXIoc3RvY2tWYWwpID4gMCA/ICdESVNQT05JQkxFJyA6ICdOTyBESVNQT05JQkxFJztcbiAgfVxuICBjb25zdCByb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiB7XG4gICAgY29uc3Qgc3QgPSBmbXRTdG9jayhwLmNvZGUpO1xuICAgIHJldHVybiB7XG4gICAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgICBGYW1pbGlhOiBwLmZhbSB8fCAnJyxcbiAgICAgIFN1YmZhbWlsaWE6IHAuc3ViIHx8ICcnLFxuICAgICAgQ2F0ZWdvcmlhOiBwLmNhdCB8fCAnJyxcbiAgICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gICAgICBTdG9jazogc3QsXG4gICAgICBEaXNwb25pYmlsaWRhZDogZGlzcExhYmVsKHN0KSxcbiAgICB9O1xuICB9KS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCBwcmVjaW9zUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICdQcmVjaW8gQVJTJzogZm10UHJlY2lvKHAuY29kZSksXG4gIH0pKVxuICAgIC5maWx0ZXIoKHIpID0+IHJbJ1ByZWNpbyBBUlMnXSAhPT0gJycpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHN0b2NrUm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4ge1xuICAgIGNvbnN0IHN0ID0gZm10U3RvY2socC5jb2RlKTtcbiAgICByZXR1cm4ge1xuICAgICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICAgU3RvY2s6IHN0LFxuICAgICAgRGlzcG9uaWJpbGlkYWQ6IGRpc3BMYWJlbChzdCksXG4gICAgfTtcbiAgfSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBhd2FpdCBkb3dubG9hZFhsc3goXG4gICAgJ0xpc3RhX2RlX1ByZWNpb3NfJyArIHRzICsgJy54bHN4JyxcbiAgICBbXG4gICAgICB7IG5hbWU6ICdMaXN0YSBkZSBwcmVjaW9zJywgcm93cyB9LFxuICAgICAgeyBuYW1lOiAnUHJlY2lvcycsIHJvd3M6IHByZWNpb3NSb3dzIH0sXG4gICAgICB7IG5hbWU6ICdTdG9jaycsIHJvd3M6IHN0b2NrUm93cyB9LFxuICAgIF0sXG4gICAge1xuICAgICAgLy8gUGFpbnRlciBhcGxpY2FkbyBwb3N0LXJlbmRlciBwb3IgZG93bmxvYWRYbHN4LiBQaW50YSBsYSBjb2x1bW5hXG4gICAgICAvLyBcIkRpc3BvbmliaWxpZGFkXCIgc2VndW4gc3UgdmFsb3I6IHZlcmRlK2JsYW5jbyBzaSBESVNQT05JQkxFLFxuICAgICAgLy8gcm9qbytibGFuY28gc2kgTk8gRElTUE9OSUJMRS4gQ2VudHJhZG8gKyBib2xkIHBhcmEgbGVnaWJpbGlkYWQuXG4gICAgICBjZWxsU3R5bGVyOiAoY2VsbCwgY29sdW1uTmFtZSwgX3ZhbHVlLCBfcm93SW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGNvbHVtbk5hbWUgIT09ICdEaXNwb25pYmlsaWRhZCcpIHJldHVybjtcbiAgICAgICAgY29uc3QgdHh0ID0gU3RyaW5nKGNlbGwudmFsdWUgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIGlmICh0eHQgPT09ICdESVNQT05JQkxFJykge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2QTM0QScgfSB9OyAvLyBncmVlbi02MDBcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9IGVsc2UgaWYgKHR4dCA9PT0gJ05PIERJU1BPTklCTEUnKSB7XG4gICAgICAgICAgY2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGREMyNjI2JyB9IH07IC8vIHJlZC02MDBcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSB9O1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH1cbiAgKTtcbiAgc2hvd1N5bmNUYWcocm93cy5sZW5ndGggKyAnIFNLVXMgZXhwb3J0YWRvcyAobGlzdGEgZGUgcHJlY2lvcyArIGRpc3BvbmliaWxpZGFkKScpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFWFBPUlQgLSBkaWFsb2dvIGRlIHNlbGVjY2lvbiArIDMgZm9ybWF0b3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxud2luZG93LmV4cG9ydFRvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIG9wY2lvbmVzIHNlZ3VuIHJvbC5cbiAgLy8gICB2ZW5kZWRvcjogb3BlcmF0aXZvIGRpYXJpbyAoVmVudGFzIC8gVmlzaXRhcyAvIFJ1dGFzKSArIENsaWVudGVzIGRlIHN1IHpvbmFcbiAgLy8gICAgIChleHBvcnRNYXN0ZXJDbGllbnRlcyB5YSBmaWx0cmEgcG9yIGdldEVmZmVjdGl2ZVZlbmRvclNldCAtPiBzb2xvIHN1IHZlbmRvcikuXG4gIC8vICAgaW50ZXJubyAoVkRJKTogbWlzbW8gc2NvcGUgb3BlcmF0aXZvICsgQ2xpZW50ZXMgZGUgc3VzIHBhcmVqYXMgKG8gc29sbyBlbFxuICAvLyAgICAgcHJvcGlvIHNpIGVsaWdpbyBzdSBub21icmUgZW4gZWwgZHJvcGRvd24gZGUgem9uYXMpLlxuICAvLyAgIGFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogdmVuIHRvZG8gZWwgbGlzdGFkbyAobnVsbCA9IHNpbiBmaWx0cm8pLlxuICBjb25zdCBhbGxvd2VkQnlSb2xlID0ge1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBWRU5UQVMgeSBSVVRBUyBlbGltaW5hZG9zIGRlbCBVSSBwb3IgcGVkaWRvIGRlIE1hcmlhbm8uXG4gICAgdmVuZGVkb3I6IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcbiAgICBpbnRlcm5vOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gIH07XG4gIGxldCBhbGxvd2VkID0gYWxsb3dlZEJ5Um9sZVt1c2VyUm9sZV0gfHwgbnVsbDsgLy8gbnVsbCA9IHZlciB0b2RvXG4gIC8vIHYxNTM3ICgyMDI2LTExLTAyKTogUEFDSEkgKHBlcmZpbCByZXN0cmluZ2lkbykgdGFtYmlcdTAwRTluIHZlIFwiUHJlY2lvcyArIFN0b2NrXCJcbiAgLy8gKGxpc3RhIGRlIHByZWNpb3MpLiBBdXRvcml6YWRvIHBvciBNYXJpYW5vLiBTb2xvIFBBQ0hJLCBubyB0b2RvcyBsb3MgVkRFLlxuICBpZiAoXG4gICAgYWxsb3dlZCAmJlxuICAgIHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICBkb2N1bWVudC5ib2R5ICYmXG4gICAgZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QuY29udGFpbnMoJ2lzLXBhY2hpLXJlc3RyaWN0ZWQnKVxuICApIHtcbiAgICAvLyB2MTU0MzogKyBCQUNLT1JERVIgKHlhIGVzdFx1MDBFMSBlbiB2ZW5kZWRvcjsgc2UgZXhwbGljaXRhIHBvciBzaSBQQUNISVxuICAgIC8vIHR1dmllcmEgb3RybyByb2wpLiBFbCBleHBvcnQgZmlsdHJhIGEgc3VzIGNsaWVudGVzIHZcdTAwRURhIGV4cG9ydC1zY29wZS5cbiAgICBhbGxvd2VkID0gbmV3IFNldChbLi4uYWxsb3dlZCwgJ1BSRUNJT1NfU1RPQ0snLCAnQkFDS09SREVSJ10pO1xuICB9XG4gIC8vIHYxNDEzIFx1MDBBNzUxICsgdjE0MTQgXHUwMEE3NTEuMSAoMjAyNi0xMC0yMik6IElORlJBQ0NJT05FU19NRUxJIHdoaXRlbGlzdCBwb3JcbiAgLy8gZW1haWwuIE1hbnRlbmVyIHNpbmNyb25pemFkbyBjb24gY2FuUmVhZEluZnJhY2Npb25lc01lbGkoKSBkZVxuICAvLyBmaXJlc3RvcmUucnVsZXMuIFJlYWRlcnM6IE1hcmlhbm8gKDIgZW1haWxzKSArIERpZWdvIFZhbHNpLlxuICBjb25zdCBJTkZSQUNDSU9ORVNfTUVMSV9SRUFERVJTID0gW1xuICAgICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbScsXG4gICAgJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJyxcbiAgICAnZGllZ28udmFsc2lAc2hpbWFuby51eScsXG4gIF07XG4gIGNvbnN0IF9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSA9XG4gICAgdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIGN1cnJlbnRVc2VyICYmXG4gICAgSU5GUkFDQ0lPTkVTX01FTElfUkVBREVSUy5pbmNsdWRlcygoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpO1xuICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZXhwb3J0LW1vZGFsIC5leHAtb3B0JykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICBjb25zdCBraW5kID0gZWwuZGF0YXNldC5leHBLaW5kIHx8ICcnO1xuICAgIGxldCBzaG93ID0gIWFsbG93ZWQgfHwgYWxsb3dlZC5oYXMoa2luZCk7XG4gICAgaWYgKGtpbmQgPT09ICdJTkZSQUNDSU9ORVNfTUVMSScgJiYgIV9jYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSkgc2hvdyA9IGZhbHNlO1xuICAgIGVsLnN0eWxlLmRpc3BsYXkgPSBzaG93ID8gJycgOiAnbm9uZSc7XG4gIH0pO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydERpYWxvZyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTW9udGggcGlja2VyIHJldXRpbGl6YWJsZSBwYXJhIGxvcyA1IHRpcG9zIGRlIGV4cG9ydFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5sZXQgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuY29uc3QgRVhQT1JUX1RZUEVfTEFCRUxTID0ge1xuICBWRU5UQVM6ICdWZW50YXMnLFxuICBWSVNJVEFTOiAnVmlzaXRhcycsXG4gIFJFTkRJQ0lPTkVTOiAnUmVuZGljaW9uZXMnLFxuICBSVVRBUzogJ1J1dGFzJyxcbiAgQUxUQVM6ICdBbHRhcyBkZSBjbGllbnRlcycsXG4gIEJBQ0tPUkRFUjogJ0JhY2tvcmRlcicsXG4gIFNUT0NLX0FTSUc6ICdTdG9jayBBc2lnbmFkbycsXG4gIFBFRElET1NfTUVTOiAnUGVkaWRvcyBkZWwgbWVzJyxcbn07XG5cbndpbmRvdy5zaG93TW9udGhQaWNrZXIgPSBmdW5jdGlvbiAodGlwbykge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSB0aXBvO1xuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS10aXRsZScpO1xuICBjb25zdCBzdWJ0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXN1YnQnKTtcbiAgdGl0bGUudGV4dENvbnRlbnQgPSAnRXhwb3J0YXIgJyArIChFWFBPUlRfVFlQRV9MQUJFTFNbdGlwb10gfHwgdGlwbyk7XG4gIHN1YnQudGV4dENvbnRlbnQgPSAnRWxlZ2kgZWwgbWVzIHkgYVx1MDBGMW8gcXVlIHF1ZXJlcyBkZXNjYXJnYXIuJztcbiAgLy8gUG9wdWxhdGUgc2VsZWN0c1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBtZXNTZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJyk7XG4gIG1lc1NlbC5pbm5lckhUTUwgPVxuICAgICc8b3B0aW9uIHZhbHVlPVwiQUxMXCI+VG9kb3MgbG9zIG1lc2VzIChhXHUwMEYxbyBlbnRlcm8pPC9vcHRpb24+JyArXG4gICAgTUVTRVMubWFwKChtLCBpKSA9PiAnPG9wdGlvbiB2YWx1ZT1cIicgKyBpICsgJ1wiPicgKyBtICsgJzwvb3B0aW9uPicpLmpvaW4oJycpO1xuICBtZXNTZWwudmFsdWUgPSBub3cuZ2V0TW9udGgoKTtcbiAgY29uc3QgYW5pb1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJyk7XG4gIGNvbnN0IHllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcbiAgbGV0IHlvcHRzID0gJyc7XG4gIGZvciAobGV0IHkgPSB5ZWFyIC0gMzsgeSA8PSB5ZWFyICsgMTsgeSsrKVxuICAgIHlvcHRzICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIHkgKyAnXCI+JyArIHkgKyAnPC9vcHRpb24+JztcbiAgYW5pb1NlbC5pbm5lckhUTUwgPSB5b3B0cztcbiAgYW5pb1NlbC52YWx1ZSA9IHllYXI7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xuXG53aW5kb3cuY2xvc2VNb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xufTtcblxud2luZG93LmNvbmZpcm1Nb250aFBpY2tlciA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdGlwbyA9IHBlbmRpbmdFeHBvcnRUeXBlO1xuICBjb25zdCBtZXNSYXcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tbWVzJykudmFsdWU7XG4gIGNvbnN0IGFuaW8gPSBwYXJzZUludChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpLnZhbHVlLCAxMCk7XG4gIGNvbnN0IG1vbnRoSWR4ID0gbWVzUmF3ID09PSAnQUxMJyA/IG51bGwgOiBwYXJzZUludChtZXNSYXcsIDEwKTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgcGVuZGluZ0V4cG9ydFR5cGUgPSBudWxsO1xuICBpZiAoIXRpcG8pIHJldHVybjtcbiAgdHJ5IHtcbiAgICAvLyB2MTU2NSAoMjAyNi0xMS0xOCk6IG9wY2lvbmVzIGVsaW1pbmFkYXMgZGVsIG1vZGFsIChBTFRBUywgVkVOVEFTX0FSVF9DTEksXG4gICAgLy8gU1RPQ0tfQVNJRywgUEVORElFTlRFX0FTSUdfUEFCTE8sIElORlJBQ0NJT05FU19NRUxJKS4gRGlzcGF0Y2hlciByZWR1Y2lkby5cbiAgICBpZiAodGlwbyA9PT0gJ1ZFTlRBUycpIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnVklTSVRBUycpIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JFTkRJQ0lPTkVTJykgZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1JVVEFTJykgZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ0JBQ0tPUkRFUicpIGV4cG9ydEJhY2tvcmRlckZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUEVESURPU19NRVMnKSBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgYWxlcnQoJ1RpcG8gZGVzY29ub2NpZG86ICcgKyB0aXBvKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydCAnICsgdGlwbywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBleHBvcnQ6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHJldHVybiBTdHJpbmcoYW5pbyk7XG4gIHJldHVybiBNRVNFU1ttb250aElkeF0gKyAnXycgKyBhbmlvO1xufVxuXG4vLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZXNjcml0byBjb24gRXhjZWxKUyBwYXJhIGRhciBVSSB1bmlmb3JtZSBhIFRPRE9TIGxvc1xuLy8gZXhwb3J0cyAoaGVhZGVyIHZlcmRlICsgY2VsZGFzIGNlbnRlcmVkICsgYm9yZGVyIHN1dGlsICsgYXV0by1maXQgd2lkdGgpLlxuLy8gQW50ZXMgdXNhYmEgWExTWCBTaGVldEpTIGZyZWUgcXVlIGlnbm9yYSBzaWxlbnRseSBsb3MgZXN0aWxvcyBkZSBjZWxkYS4gRWxcbi8vIHBhdHRlcm4gdmVyZGUgcmVwbGljYSBlbCBUT1RBTCBiYXIgZGUgZXhwb3J0QmFja29yZGVyc1RvRXhjZWwgKG1vZGFsXG4vLyBCYWNrb3JkZXIgdjcyMCspLiBFeGNlbEpTIHlhIHNlIGNhcmdhIG9uLWRlbWFuZCB2aWEgd2luZG93LmxvYWRFeGNlbEpTLlxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRYbHN4KGZpbGVuYW1lLCBzaGVldHMsIG9wdHMpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCB3aW5kb3cubG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdObyBzZSBwdWRvIGNhcmdhciBFeGNlbEpTOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgY29uc3QgSEVBREVSX0ZJTEwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYxNjY1MzQnIH0gfTtcbiAgY29uc3QgSEVBREVSX0ZPTlQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgYm9sZDogdHJ1ZSwgc2l6ZTogMTIgfTtcbiAgY29uc3QgQ0VOVEVSID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICBjb25zdCBCT1JERVJfVEhJTiA9IHsgc3R5bGU6ICd0aGluJywgY29sb3I6IHsgYXJnYjogJ0ZGQ0NDQ0NDJyB9IH07XG4gIGNvbnN0IEJPUkRFUiA9IHsgdG9wOiBCT1JERVJfVEhJTiwgbGVmdDogQk9SREVSX1RISU4sIGJvdHRvbTogQk9SREVSX1RISU4sIHJpZ2h0OiBCT1JERVJfVEhJTiB9O1xuICAvLyB2MTM2NDogY2VsbFN0eWxlciBvcGNpb25hbCBwYXJhIGNvbG9yZWFyIGNlbGRhcyBwb3IgdmFsb3IgKGVqLiBjb2x1bW5hXG4gIC8vIERpc3BvbmliaWxpZGFkIERJU1BPTklCTEUgdmVyZGUgLyBOTyBESVNQT05JQkxFIHJvam8gZW4gZWwgZXhwb3J0XG4gIC8vIExpc3RhIGRlIHByZWNpb3MpLiBTaWduYXR1cmU6IChjZWxsLCBjb2x1bW5OYW1lLCB2YWx1ZSwgcm93SW5kZXgpID0+IHZvaWQuXG4gIGNvbnN0IGNlbGxTdHlsZXIgPSBvcHRzICYmIHR5cGVvZiBvcHRzLmNlbGxTdHlsZXIgPT09ICdmdW5jdGlvbicgPyBvcHRzLmNlbGxTdHlsZXIgOiBudWxsO1xuXG4gIGZvciAoY29uc3QgcyBvZiBzaGVldHMpIHtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldChzLm5hbWUuc2xpY2UoMCwgMzEpKTtcbiAgICBjb25zdCByb3dzID0gcy5yb3dzLmxlbmd0aCA/IHMucm93cyA6IFt7IEF2aXNvOiAnU2luIGRhdG9zIHBhcmEgZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8nIH1dO1xuICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3Qua2V5cyhyb3dzWzBdKTtcblxuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmFkZFJvdyhoZWFkZXJzKTtcbiAgICBoZWFkZXJSb3cuZWFjaENlbGwoKGNlbGwpID0+IHtcbiAgICAgIGNlbGwuZmlsbCA9IEhFQURFUl9GSUxMO1xuICAgICAgY2VsbC5mb250ID0gSEVBREVSX0ZPTlQ7XG4gICAgICBjZWxsLmFsaWdubWVudCA9IENFTlRFUjtcbiAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgIH0pO1xuICAgIGhlYWRlclJvdy5oZWlnaHQgPSAyNjtcblxuICAgIGZvciAobGV0IHJJZHggPSAwOyBySWR4IDwgcm93cy5sZW5ndGg7IHJJZHgrKykge1xuICAgICAgY29uc3Qgcm93ID0gcm93c1tySWR4XTtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IGhlYWRlcnMubWFwKChoKSA9PiAocm93W2hdICE9PSB1bmRlZmluZWQgJiYgcm93W2hdICE9PSBudWxsID8gcm93W2hdIDogJycpKTtcbiAgICAgIGNvbnN0IGRhdGFSb3cgPSB3cy5hZGRSb3codmFsdWVzKTtcbiAgICAgIGRhdGFSb3cuZWFjaENlbGwoKGNlbGwsIGNvbE51bWJlcikgPT4ge1xuICAgICAgICBjZWxsLmFsaWdubWVudCA9IENFTlRFUjtcbiAgICAgICAgY2VsbC5ib3JkZXIgPSBCT1JERVI7XG4gICAgICAgIGlmIChjZWxsU3R5bGVyKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNlbGxTdHlsZXIoY2VsbCwgaGVhZGVyc1tjb2xOdW1iZXIgLSAxXSwgdmFsdWVzW2NvbE51bWJlciAtIDFdLCBySWR4KTtcbiAgICAgICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAgICAgLy8gbm8tb3A6IG5vIHJvbXBlciBlbCBleHBvcnQgcG9yIHVuIGVycm9yIGRlIHN0eWxlclxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaGVhZGVycy5mb3JFYWNoKChoLCBpKSA9PiB7XG4gICAgICBsZXQgbWF4TGVuID0gU3RyaW5nKGgpLmxlbmd0aDtcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgdiA9IFN0cmluZyhyb3dbaF0gPT09IHVuZGVmaW5lZCB8fCByb3dbaF0gPT09IG51bGwgPyAnJyA6IHJvd1toXSkuc3BsaXQoJ1xcbicpWzBdO1xuICAgICAgICBpZiAodi5sZW5ndGggPiBtYXhMZW4pIG1heExlbiA9IHYubGVuZ3RoO1xuICAgICAgfVxuICAgICAgd3MuZ2V0Q29sdW1uKGkgKyAxKS53aWR0aCA9IE1hdGgubWluKDYwLCBNYXRoLm1heCgxMCwgbWF4TGVuICsgNCkpO1xuICAgIH0pO1xuXG4gICAgd3Mudmlld3MgPSBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XTtcbiAgfVxuXG4gIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XG4gICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgfSk7XG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIGEuaHJlZiA9IHVybDtcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICBhLmNsaWNrKCk7XG4gIGEucmVtb3ZlKCk7XG4gIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWRU5UQVM6IHBlZGlkb3MgY29uZmlybWFkb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmVudGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHBlZGlkb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBwID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHAueWVhciwgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KHAubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBjb25zdCBsaW5lcyA9IHAubGluZXMgfHwgW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCB2ZW5kb3JLZXkgPSBwLnZlbmRvciB8fCBsb29rdXBWZW5kb3JGb3JDbGllbnQocC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpIHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvckluZm8gPSB2ZW5kb3JMb29rdXBbdmVuZG9yS2V5XSB8fCB7fTtcbiAgICBjb25zdCBmYWN0b3IgPSB0eXBlb2YgcGVkaWRvRGlzY291bnRGYWN0b3IgPT09ICdmdW5jdGlvbicgPyBwZWRpZG9EaXNjb3VudEZhY3RvcihwKSA6IDE7XG4gICAgY29uc3QgZGlzY1BjdCA9IChwLmRpc2NvdW50U25hcHNob3QgJiYgcC5kaXNjb3VudFNuYXBzaG90LnBjdFRvdGFsKSB8fCAwO1xuICAgIGxpbmVzLmZvckVhY2goKGwpID0+IHtcbiAgICAgIGNvbnN0IHF0eSA9IHBhcnNlRmxvYXQobC5xdHkpIHx8IDA7XG4gICAgICBjb25zdCBwcmVjaW8gPSBwYXJzZUZsb2F0KGwucHJlY2lvKSB8fCAwO1xuICAgICAgY29uc3QgZ3Jvc3MgPSBxdHkgKiBwcmVjaW87XG4gICAgICBjb25zdCBuZXQgPSBncm9zcyAqIGZhY3RvcjtcbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIE1lczogcC5tb250aCB8fCAnJyxcbiAgICAgICAgRmVjaGFfQ29uZmlybWFkbzogcC5jb25maXJtZWRBdCA/IFN0cmluZyhwLmNvbmZpcm1lZEF0KS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgICAgRXN0YWRvOiBwLnN0YWdlIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvcktleSB8fCAnJyksXG4gICAgICAgIFpvbmE6IHZlbmRvckluZm8uem9uZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBDbGllbnRlOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENvZGlnb19TS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgUHJvZHVjdG86IGwuZGVzYyB8fCAnJyxcbiAgICAgICAgQ2F0ZWdvcmlhOiBsLmNhdCB8fCAnJyxcbiAgICAgICAgRmFtaWxpYTogbC5mYW0gfHwgJycsXG4gICAgICAgIFN1YmZhbWlsaWE6IGwuc3ViIHx8ICcnLFxuICAgICAgICBDYW50aWRhZDogcXR5LFxuICAgICAgICBQcmVjaW9fVW5pdF9BUlM6IHByZWNpbyxcbiAgICAgICAgLy8gU3VidG90YWxfQVJTID0gTkVUTyAoY29uIGRlc2N1ZW50byBhcGxpY2FkbykgLSBlcyBsbyBxdWUgY3VlbnRhXG4gICAgICAgIC8vIHBhcmEgZWwgdGFyZ2V0IGRlbCB2ZW5kZWRvci4gU3VidG90YWxfQnJ1dG9fQVJTIG11ZXN0cmEgZWwgdmFsb3JcbiAgICAgICAgLy8gZGUgbGlzdGEgc2luIGRlc2N1ZW50byBwYXJhIHRyYXphYmlsaWRhZC5cbiAgICAgICAgU3VidG90YWxfQVJTOiBNYXRoLnJvdW5kKG5ldCksXG4gICAgICAgIFN1YnRvdGFsX0JydXRvX0FSUzogTWF0aC5yb3VuZChncm9zcyksXG4gICAgICAgIERlc2N1ZW50b19QY3Q6IGRpc2NQY3QsXG4gICAgICAgIEVuX05vbWJyZV9EZV9WREU6IHAub25CZWhhbGZPZiA/ICdTSScgOiAnTk8nLFxuICAgICAgICBDYXJnYWRvX1BvcjogcC5jcmVhdGVkQnlEaXNwbGF5TmFtZSB8fCBwLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1ZlbnRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnVmVudGFzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgVmVudGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuZnVuY3Rpb24gbG9va3VwVmVuZG9yRm9yQ2xpZW50KHByb3YsIGxvY05hbWUsIF9jbGllbnROYW1lKSB7XG4gIGlmICghcHJvdiB8fCAhbG9jTmFtZSkgcmV0dXJuICcnO1xuICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92ICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XG4gIHJldHVybiBwdCA/IHB0LnZlbmRvciB8fCAnJyA6ICcnO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZJU0lUQVM6IGRldGFsbGUgZGUgdmlzaXRhcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgVmlzaXRhcyArIENvbnRhY3Rvcy4uLicpO1xuICAvLyB2MTUzNDogZWwgdmVuZGVkb3IgY29uc3VsdGEgc29sbyBzdXMgdmlzaXRhcyAobGFzIHJlZ2xhcyBubyBsZSBkZWphblxuICAvLyBsaXN0YXIgdG9kYXMpOyBlbCBpbnRlcm5vIHZlIGxhcyBzdXlhcyArIGxhcyBkZSBzdXMgcGFyZWphcy5cbiAgY29uc3Qgc2NvcGUgPSBfZXhwb3J0U2NvcGUoKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgbGV0IHEgPSBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpO1xuICAgIGlmIChzY29wZS52aXNpdHNRdWVyeUJ5T3duZXJVaWQpIHtcbiAgICAgIGNvbnN0IHUgPSB3aW5kb3cuZmlyZWJhc2UgJiYgd2luZG93LmZpcmViYXNlLmF1dGggJiYgd2luZG93LmZpcmViYXNlLmF1dGgoKS5jdXJyZW50VXNlcjtcbiAgICAgIHEgPSBxLndoZXJlKCdvd25lclVpZCcsICc9PScsICh1ICYmIHUudWlkKSB8fCAnX19zaW5fdXN1YXJpb19fJyk7XG4gICAgfVxuICAgIHNuYXAgPSBhd2FpdCBxLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gdmlzaXRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YXJnZXRNZXMgPSBtb250aElkeCAhPT0gbnVsbCA/IE1FU0VTW21vbnRoSWR4XS50b1VwcGVyQ2FzZSgpIDogbnVsbDtcbiAgY29uc3QgYWxsID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHYgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAocGFyc2VJbnQodi5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAodGFyZ2V0TWVzICYmICh2Lm1lcyB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdGFyZ2V0TWVzKSByZXR1cm47XG4gICAgYWxsLnB1c2godik7XG4gIH0pO1xuICBjb25zdCBpdGVtcyA9IHNjb3BlLmZpbHRlclZpc2l0cyhhbGwpO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyBuaSBjb250YWN0b3MgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG5WaXNpdGFzID0gaXRlbXMuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoO1xuICBjb25zdCBuQ29udGFjdG9zID0gaXRlbXMubGVuZ3RoIC0gblZpc2l0YXM7XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZGVsIGZyZW50ZSBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIExhenkgbG9hZC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgLy8gdjE1NjUgKDIwMjYtMTEtMTgpOiAxNiBjb2x1bW5hcyBleGFjdGFzIHBvciBwZWRpZG8gTWFyaWFuby4gSG9qYSBcIlZJU0lUQVNcIi5cbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1ZJU0lUQVMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZFQ0hBX0RFX1ZJU0lUQVMnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnVkVOREVET1InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnSU5URVJBQ0NJT04nLCBrZXk6ICdpbnRlcmFjY2lvbicsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVElQTycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0xPQ0FMJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RBTUFcdTAwRDFPJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGSURFTElEQUQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1JFTEVWQU5DSUEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ01BU19WRU5ESURPJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ01BU19QUkVHVU5UQU4nLCBrZXk6ICdtYXNQcicsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnQVlVREFfVElFTkRBJywga2V5OiAnYXl1ZGEnLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RJUE9fREVfVkVOVEEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1BPTkRFUkFDSU9OX01PU1RSQURPUicsIGtleTogJ3BNb3N0Jywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdQT05ERVJBQ0lPTl9FQ09NTUVSQ0UnLCBrZXk6ICdwRWNvbScsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnRk9UT19GUkVOVEUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTtcbiAgY29uc3QgUk9XX0ggPSAxMDA7XG4gIGNvbnN0IElNR19XID0gMTMwO1xuICBjb25zdCBJTUdfSCA9IDkwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBpdGVtcykge1xuICAgIGNvbnN0IGlzQ29udGFjdG8gPSB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJztcbiAgICBjb25zdCBpbnRlcmFjY2lvbkxibCA9IGlzQ29udGFjdG8gPyAnQ29udGFjdG8nIDogJ1Zpc2l0YSc7XG4gICAgY29uc3QgZm9ybWFDb250YWN0b0xibCA9IGlzQ29udGFjdG8gPyB2LmZvcm1hQ29udGFjdG8gfHwgJ1NpbiBlc3BlY2lmaWNhcicgOiAnUHJlc2VuY2lhbCc7XG4gICAgbGV0IHJlc3VsdGFkb0N0TGJsID0gJyc7XG4gICAgaWYgKGlzQ29udGFjdG8pIHtcbiAgICAgIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAncmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnUmVzcG9uZGlvJztcbiAgICAgIGVsc2UgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdub19yZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdObyByZXNwb25kaW8nO1xuICAgICAgZWxzZSByZXN1bHRhZG9DdExibCA9ICdTaW4gbWFyY2FyJztcbiAgICB9XG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXG4gICAgICBpbnRlcmFjY2lvbjogaW50ZXJhY2Npb25MYmwsXG4gICAgICB0aXBvOiB2LnRpcG8gfHwgJycsXG4gICAgICBsb2NhbDogdi5sb2NhbCB8fCAnJyxcbiAgICAgIHRhbWFubzogdi50YW1hbm8gfHwgJycsXG4gICAgICBmaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgcmVsZXY6IHYucmVsZXZhbmNpYSB8fCAnJyxcbiAgICAgIHBvcDogdi5wb3AgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgbWFzUHI6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICAgYXl1ZGE6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAgIHBNb3N0OiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gfHwgJycsXG4gICAgICBwRWNvbTogdi5wb25kZXJhY2lvbkVjb21tZXJjZSB8fCAnJyxcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGltYWdlbiBlbmNpbWFcbiAgICB9KTtcbiAgICAvLyB2MTU2NTogZm9ybWFDb250YWN0by9yZXN1bHRhZG9DdCBzaWd1ZW4gY29tcHV0YWRvcyBwYXJhIHVzbyBmdXR1cm8gKG5vIGV4cG9ydGFkYXMpLlxuICAgIHZvaWQgZm9ybWFDb250YWN0b0xibDtcbiAgICB2b2lkIHJlc3VsdGFkb0N0TGJsO1xuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byB2aXNpdGEnLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1ZJU0lUQVNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBsaXN0bzogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3RvcycsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRhc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVORElDSU9ORVM6IGdhc3RvcyB5IGFudGljaXBvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJlbmRpY2lvbmVzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyByZW5kaWNpb25lczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBGaWx0cmFyIHBvciBtZXMvYW5pb1xuICBjb25zdCBpdGVtcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCByID0gZC5kYXRhKCkgfHwge307XG4gICAgbGV0IGR0ID0gci5mZWNoYSB8fCByLmZlY2hhR2FzdG8gfHwgJyc7XG4gICAgaWYgKCFkdCAmJiByLmNyZWF0ZWRBdCAmJiByLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gci5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGNvbnN0IGRPYmogPSBuZXcgRGF0ZShkdCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkT2JqLmdldFRpbWUoKSkpIHJldHVybjtcbiAgICBpZiAoZE9iai5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGRPYmouZ2V0TW9udGgoKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICBpdGVtcy5wdXNoKHsgaWQ6IGQuaWQsIGZlY2hhOiBkdCwgcjogciB9KTtcbiAgfSk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZW5kaWNpb25lcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRXhjZWxKUyBjb24gZm90byBlbWJlYmlkYSBlbiBjYWRhIGZpbGEuIENhcmdhIGxhenkuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIGl0ZW1zLmxlbmd0aCArICcgcmVuZGljaW9uZXMuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICAvLyB2MTU2NSAoMjAyNi0xMS0xOCk6IDEwIGNvbHVtbmFzIGV4YWN0YXMgcG9yIHBlZGlkbyBNYXJpYW5vLiBIb2phIFwiUmVuZGljaW9uZXNcIi5cbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1JlbmRpY2lvbmVzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGRUNIQV9ERV9SRU5ESUNJT04nLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnVElQTycsIGtleTogJ3RpcG8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1ZFTkRFRE9SJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjYgfSxcbiAgICB7IGhlYWRlcjogJ0NPTkNFUFRPJywga2V5OiAnY29uY2VwdG8nLCB3aWR0aDogMjAgfSxcbiAgICB7IGhlYWRlcjogJ05cdTAwQjAgVElDS0VUJywga2V5OiAnbnVtVGlja2V0Jywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdUSVBPX0RFX0dBU1RPJywga2V5OiAndGlwb0dhc3RvJywgd2lkdGg6IDIwIH0sXG4gICAgeyBoZWFkZXI6ICdJTVBPUlRFJywga2V5OiAnaW1wb3J0ZScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnT0JTRVJWQUNJT05FUycsIGtleTogJ29icycsIHdpZHRoOiAzMCB9LFxuICAgIHsgaGVhZGVyOiAnRk9UT19USUNLRVQnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdFU1RBRE8nLCBrZXk6ICdlc3RhZG8nLCB3aWR0aDogMTggfSxcbiAgXTtcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjdFMjJDRScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxuICBjb25zdCBST1dfSCA9IDExMDtcbiAgY29uc3QgSU1HX1cgPSAxNDA7XG4gIGNvbnN0IElNR19IID0gMTAwO1xuXG4gIC8vIE9yZGVuIGNyb25vbG9naWNvIGRlc2NcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgaXQgb2YgaXRlbXMpIHtcbiAgICBjb25zdCByID0gaXQucjtcbiAgICBjb25zdCBpc0dhc3RvID0gci50aXBvID09PSAnZ2FzdG8nO1xuICAgIGNvbnN0IGNvbmNlcHRTdHIgPSBpc0dhc3RvID8gci5kZXNjcmlwY2lvbiB8fCAnJyA6IHIudGlwb09wZXJhY2lvbiB8fCByLm1vdGl2byB8fCAnJztcbiAgICBjb25zdCBvYnNTdHIgPVxuICAgICAgKHIub2JzZXJ2YWNpb25lcyB8fCByLm5vdGFzIHx8ICcnKSArXG4gICAgICAoaXNHYXN0byA/ICcnIDogci5zb2xpY2l0YWRvUG9yID8gJyB8IFNvbGljaXRhZG8gcG9yOiAnICsgci5zb2xpY2l0YWRvUG9yIDogJycpO1xuICAgIC8vIHYxNTY1OiAxMCBjb2x1bW5hcyBleGFjdGFzLiBDYW1wb3MgbGVnYWN5IChlbWFpbCwgbW9kb1BhZ28sIGRpdmlzaW9uLCBtb25lZGEsXG4gICAgLy8gaW1wb3J0ZVVzZCwgYXByb2JhZG9yLCBhcHJvYmFkb0VuKSB5YSBubyBzZSBleHBvcnRhbiBwb3IgcGVkaWRvIE1hcmlhbm8uXG4gICAgY29uc3Qgcm93ID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiBpdC5mZWNoYSxcbiAgICAgIHRpcG86IHIudGlwbyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiByLm93bmVyTmFtZSB8fCByLnZlbmRvck5hbWUgfHwgci5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgY29uY2VwdG86IGNvbmNlcHRTdHIsXG4gICAgICBudW1UaWNrZXQ6IHIubnVtZXJvVGlja2V0IHx8ICcnLFxuICAgICAgdGlwb0dhc3RvOiByLnRpcG9HYXN0byB8fCAnJyxcbiAgICAgIGltcG9ydGU6IHIuaW1wb3J0ZSAhPSBudWxsID8gci5pbXBvcnRlIDogJycsXG4gICAgICBvYnM6IG9ic1N0cixcbiAgICAgIGZvdG86ICcnLCAvLyBjZWxkYSB2YWNpYSAtIGVuY2ltYSB2YSBsYSBpbWFnZW5cbiAgICAgIGVzdGFkbzogci5zdGF0dXMgfHwgci5lc3RhZG8gfHwgJycsXG4gICAgfSk7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogU0lFTVBSRSBlbWJlYmVyIGxhIGZvdG8gKG5vIGRlamFyIGh5cGVybGluaykuXG4gICAgLy8gQW50ZXM6IHNpIGZvdG9UaWNrZXRVcmwgKFN0b3JhZ2UpLCBxdWVkYWJhIGNvbW8gaHlwZXJsaW5rIEFicmlyIHRpY2tldC5cbiAgICAvLyBBaG9yYTogZmV0Y2ggZGVsIFVSTCArIGNvbnZlcnRpciBhIGFycmF5QnVmZmVyICsgZW1iZWJlciBpZ3VhbCBxdWUgZGF0YVVSTC5cbiAgICAvLyBGYWxsYmFjayBhIGh5cGVybGluayBzb2xvIHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQsIGV0YykuXG4gICAgY29uc3QgZm90b1NyYyA9IHIuZm90b1RpY2tldCB8fCByLmFkanVudG8gfHwgJyc7XG4gICAgaWYgKGZvdG9TcmMgJiYgdHlwZW9mIGZvdG9TcmMgPT09ICdzdHJpbmcnICYmIGZvdG9TcmMuc3RhcnRzV2l0aCgnZGF0YTppbWFnZS8nKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IGZvdG9TcmM7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gcmVuZGljaW9uJywgaXQuaWQsIGUpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoci5mb3RvVGlja2V0VXJsICYmIHR5cGVvZiByLmZvdG9UaWNrZXRVcmwgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogZmV0Y2ggbGEgZm90byBkZXNkZSBTdG9yYWdlIHkgZW1iZWJlcmxhIGNvbW8gaW1hZ2VuLlxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKHIuZm90b1RpY2tldFVybCk7XG4gICAgICAgIGlmICghcmVzcC5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByZXNwLnN0YXR1cyk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcC5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykgfHwgJ2ltYWdlL2pwZWcnO1xuICAgICAgICBsZXQgZXh0ID0gY29udGVudFR5cGUuc3BsaXQoJy8nKVsxXSB8fCAnanBlZyc7XG4gICAgICAgIGV4dCA9IGV4dC5zcGxpdCgnOycpWzBdLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBidWYgPSBhd2FpdCByZXNwLmFycmF5QnVmZmVyKCk7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJ1ZmZlcjogYnVmLCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gRmFsbGJhY2s6IHNpIGVsIGZldGNoIGZhbGxhIChDT1JTLCByZWQpLCBkZWphciBoeXBlcmxpbmsgY29tbyBhbnRlcy5cbiAgICAgICAgY29uc29sZS53YXJuKCdmZXRjaCBmb3RvIHJlbmRpY2lvbiBmYWxsbywgZGVqbyBoeXBlcmxpbmsnLCBpdC5pZCwgZSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgY2VsbCA9IHJvdy5nZXRDZWxsKEZPVE9fQ09MX0lEWCArIDEpO1xuICAgICAgICAgIGNlbGwudmFsdWUgPSB7XG4gICAgICAgICAgICB0ZXh0OiAnQWJyaXIgdGlja2V0JyxcbiAgICAgICAgICAgIGh5cGVybGluazogci5mb3RvVGlja2V0VXJsLFxuICAgICAgICAgICAgdG9vbHRpcDogJ0FicmlyIGxhIGZvdG8gZGVsIHRpY2tldCBlbiBlbCBicm93c2VyIChmZXRjaCBmYWxsbyknLFxuICAgICAgICAgIH07XG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkYwNTYzQzEnIH0sIHVuZGVybGluZTogdHJ1ZSB9O1xuICAgICAgICB9IGNhdGNoIChfZTIpIHt9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdSZW5kaWNpb25lc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFJlbmRpY2lvbmVzIGxpc3RvICgnICsgaXRlbXMubGVuZ3RoICsgJyBmaWxhcyknLCAyNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSVVRBUzogcnV0YXMgYXNpZ25hZGFzIGRlbCBwZXJpb2RvICsgb3ZlcnJpZGVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUnV0YXMuLi4nKTtcbiAgLy8gTGFzIHJ1dGFzIHNlIGdlbmVyYW4gZW4gcnVudGltZSBwYXJhIGNhZGEgdmVuZGVkb3I7IGVuIGNhbWJpbyBsb3Mgb3ZlcnJpZGVzXG4gIC8vIChkZXJpdmFjaW9uZXMgLyByZWFnZW5kYXMpIHZpdmVuIGVuIHJvdXRlX292ZXJyaWRlcy4gRXhwb3J0YW1vczpcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxhcyBydXRhcyBwbGFuaWZpY2FkYXMgZGVsIHBlcmlvZG8gKHBhcmEgbG9zIHZlbmRlZG9yZXNcbiAgLy8gICAgZGVsIHJvbCBhY3R1YWwgbyB0b2RvcyBzaSBhZG1pbilcbiAgLy8gIC0gdW5hIGhvamEgY29uIGxvcyBvdmVycmlkZXMgZGVsIHBlcmlvZG9cbiAgY29uc3QgdGFyZ2V0VmVuZG9ycyA9XG4gICAgdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICd2aWV3ZXInXG4gICAgICA/IFZFTkRPUlMubWFwKCh2KSA9PiB2LmtleSlcbiAgICAgIDogYXNzaWduZWRWZW5kb3JcbiAgICAgICAgPyBbYXNzaWduZWRWZW5kb3JdXG4gICAgICAgIDogW107XG4gIGNvbnN0IG1vbnRoc1RvRXhwb3J0ID0gbW9udGhJZHggIT09IG51bGwgPyBbbW9udGhJZHhdIDogWzAsIDEsIDIsIDMsIDQsIDUsIDYsIDcsIDgsIDksIDEwLCAxMV07XG4gIGNvbnN0IHJ1dGFzUm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IHZlbmQgb2YgdGFyZ2V0VmVuZG9ycykge1xuICAgIGZvciAoY29uc3QgbSBvZiBtb250aHNUb0V4cG9ydCkge1xuICAgICAgbGV0IHJ1dGFzO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcnV0YXMgPSBnZW5lcmFyUnV0YXNWZW5kb3IodmVuZCwgbSwgYW5pbyk7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICBydXRhcyA9IFtdO1xuICAgICAgfVxuICAgICAgKHJ1dGFzIHx8IFtdKS5mb3JFYWNoKChydXRhKSA9PiB7XG4gICAgICAgIChydXRhLnRpZW5kYXMgfHwgW10pLmZvckVhY2goKHQsIGkpID0+IHtcbiAgICAgICAgICBydXRhc1Jvd3MucHVzaCh7XG4gICAgICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmQpLFxuICAgICAgICAgICAgQW5pbzogYW5pbyxcbiAgICAgICAgICAgIE1lczogTUVTRVNbbV0sXG4gICAgICAgICAgICBSdXRhX0lEOiBydXRhLmlkIHx8ICcnLFxuICAgICAgICAgICAgUnV0YV9Ob21icmU6IHJ1dGEubm9tYnJlIHx8ICcnLFxuICAgICAgICAgICAgRmVjaGFfQXNpZ25hZGE6IHJ1dGEuZmVjaGFBc2lnbmFkYSB8fCAnJyxcbiAgICAgICAgICAgIE9yZGVuOiBpICsgMSxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHQucHJvdmluY2UgfHwgJycpLFxuICAgICAgICAgICAgTG9jYWxpZGFkOiB0LmxvY05hbWUgfHwgJycsXG4gICAgICAgICAgICBUaWVuZGE6IHQuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgICAgIFRpcG86IHQudGlwbyB8fCAnJyxcbiAgICAgICAgICAgIEVzdGFkbzogdC5lc3RhZG8gfHwgJycsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIC8vIE92ZXJyaWRlc1xuICBsZXQgb3ZyU25hcDtcbiAgdHJ5IHtcbiAgICBvdnJTbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb3V0ZV9vdmVycmlkZXMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBvdnJTbmFwID0gbnVsbDtcbiAgfVxuICBjb25zdCBvdmVycmlkZXNSb3dzID0gW107XG4gIGlmIChvdnJTbmFwKSB7XG4gICAgb3ZyU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBjb25zdCBvID0gZC5kYXRhKCkgfHwge307XG4gICAgICBpZiAocGFyc2VJbnQoby5hbmlvLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChvLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgICBvdmVycmlkZXNSb3dzLnB1c2goe1xuICAgICAgICBBbmlvOiBvLmFuaW8gfHwgJycsXG4gICAgICAgIE1lczogTUVTRVNbcGFyc2VJbnQoby5tb250aElkeCwgMTApXSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZShvLnZlbmRvciB8fCAnJyksXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKG8ucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IG8ubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgVGllbmRhOiBvLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIEFjY2lvbjogby5hY3Rpb24gfHwgby50aXBvIHx8ICcnLFxuICAgICAgICBEZXJpdmFkYV9BOiBvLmRlcml2YWRhQSB8fCAnJyxcbiAgICAgICAgUmVhZ2VuZGFkYV9QYXJhOiBvLnJlYWdlbmRhZGFQYXJhIHx8ICcnLFxuICAgICAgICBNb3Rpdm86IG8ubW90aXZvIHx8ICcnLFxuICAgICAgICBDcmVhZG9fUG9yOiBvLmNyZWF0ZWRCeUVtYWlsIHx8ICcnLFxuICAgICAgICBDcmVhZG9fRW46XG4gICAgICAgICAgby5jcmVhdGVkQXQgJiYgby5jcmVhdGVkQXQudG9EYXRlID8gby5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUnV0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1J1dGFzIHBsYW5pZmljYWRhcycsIHJvd3M6IHJ1dGFzUm93cyB9LFxuICAgIHsgbmFtZTogJ0Rlcml2YWNpb25lcy1SZWFnZW5kYXMnLCByb3dzOiBvdmVycmlkZXNSb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IFJ1dGFzIGxpc3RvICgnICsgcnV0YXNSb3dzLmxlbmd0aCArICcgdGllbmRhcywgJyArIG92ZXJyaWRlc1Jvd3MubGVuZ3RoICsgJyBvdmVycmlkZXMpJyxcbiAgICAyNDAwXG4gICk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQUxUQVM6IHNvbGljaXR1ZGVzIGRlIGFsdGEgZGUgY2xpZW50ZSBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEFsdGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9ICcnO1xuICAgIGlmIChhLmNyZWF0ZWRBdCAmJiBhLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gYS5jcmVhdGVkQXQudG9EYXRlKCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGlmIChkdC5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGR0LmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1NvbGljaXR1ZDogZHQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXG4gICAgICBFc3RhZG86IGEuc3RhdHVzIHx8ICcnLFxuICAgICAgQ29tZXJjaW86IGEuY29tZXJjaW8gfHwgJycsXG4gICAgICBGYW50YXNpYTogYS5mYW50YXNpYSB8fCAnJyxcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcbiAgICAgIENvbmRpY2lvbl9GaXNjYWw6IGEuY29uZEZpc2NhbCB8fCAnJyxcbiAgICAgIENhbGxlOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTnVtZXJvOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYS5sb2NhbGlkYWQgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGEucHJvdmluY2lhIHx8ICcnLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICBUZWxlZm9ubzogYS50ZWxlZm9ubyB8fCAnJyxcbiAgICAgIEVtYWlsOiBhLmVtYWlsIHx8ICcnLFxuICAgICAgVmVuZGVkb3JfU29saWNpdGFudGU6IGEudmVuZG9yTmFtZSB8fCBhLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBPd25lcl9FbWFpbDogYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgU3VibWl0dGVkX0J5X1B1YmxpY19Gb3JtOiBhLnN1Ym1pdHRlZEJ5UHVibGljRm9ybSA/ICdTSScgOiAnTk8nLFxuICAgICAgQXByb2JhZG9fUG9yOiBhLmFwcHJvdmVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIEFwcm9iYWRvX0VuOlxuICAgICAgICBhLmFwcHJvdmVkQXQgJiYgYS5hcHByb3ZlZEF0LnRvRGF0ZSA/IGEuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgUmVjaGF6YWRvX01vdGl2bzogYS5yZWplY3RlZFJlYXNvbiB8fCAnJyxcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQWx0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0FsdGFzIGRlIGNsaWVudGVzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQWx0YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgc29saWNpdHVkZXMpJywgMjQwMCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gdjcwOSAoMjAyNi0wOC0yOCk6IDMgZXhwb3J0cyBudWV2b3MgcGVkaWRvcyBwb3IgTWFyaWFuby5cbi8vIC0gQkFDS09SREVSOiBsaW5lYXMgc3RhdGU9Qk8gb3BlbiBwb3IgbWVzIGRlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLlxuLy8gLSBTVE9DS19BU0lHOiBsaW5lYXMgQVNJRyBvcGVuIChvIEJPK3N0b2NrIGRpc3ApIHBvciBtZXMgZGUgY3JlYXRlZEF0LlxuLy8gLSBQRURJRE9TX01FUzogVE9ET1MgbG9zIHBlZGlkb3MgY3JlYWRvcyBlbiBlbCBtZXMvYW5pbyAoY3VhbHF1aWVyIHN0YWdlKS5cbi8vIEZ1ZW50ZTogZ2xvYmFsUGVkaWRvcyAobG8gcXVlIGxhIGFwcCB5YSB0aWVuZSBlbiBtZW1vcmlhKS5cbi8vIEZpbHRlciBtZXMvYVx1MDBGMW86IHNvYnJlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLiBtb250aElkeD1udWxsIC0+IGFcdTAwRjFvIGVudGVyby5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuZnVuY3Rpb24gX3BlZGlkb01vbnRoWWVhcihwKSB7XG4gIGNvbnN0IGNhID0gcC5jcmVhdGVkQXQ7XG4gIGlmICghY2EpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgbGV0IGR0ID0gbnVsbDtcbiAgaWYgKHR5cGVvZiBjYSA9PT0gJ3N0cmluZycpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBlbHNlIGlmICh0eXBlb2YgY2EudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGR0ID0gY2EudG9EYXRlKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhID09PSAnbnVtYmVyJykgZHQgPSBuZXcgRGF0ZShjYSk7XG4gIGlmICghZHQgfHwgTnVtYmVyLmlzTmFOKGR0LmdldFRpbWUoKSkpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgcmV0dXJuIHsgeTogZHQuZ2V0RnVsbFllYXIoKSwgbTogZHQuZ2V0TW9udGgoKSB9O1xufVxuXG5mdW5jdGlvbiBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgsIHNjb3BlKSB7XG4gIGNvbnN0IGFyciA9XG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gIC8vIHYxNTM0OiBhbGNhbmNlIHBvciByb2wgKHZlbmRlZG9yID0gY2xpZW50ZXMgZGUgc3UgbWFzdGVyOyBpbnRlcm5vID0gcGFyZWphcykuXG4gIC8vIFByaW1lcm8gZWwgbWVzIChiYXJhdG8pIHkgZGVzcHVcdTAwRTlzIGVsIGFsY2FuY2UgKHJlc3VlbHZlIGVsIG1hc3RlciBwb3IgY2xpZW50ZSkuXG4gIGNvbnN0IGRlbE1lcyA9IGFyci5maWx0ZXIoKHApID0+IHtcbiAgICBpZiAoIXApIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCB7IHksIG0gfSA9IF9wZWRpZG9Nb250aFllYXIocCk7XG4gICAgaWYgKHkgPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh5ICE9PSBhbmlvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIG0gIT09IG1vbnRoSWR4KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xuICBjb25zdCBzYyA9IHNjb3BlIHx8IF9leHBvcnRTY29wZSgpO1xuICByZXR1cm4gc2MuZmlsdGVyUGVkaWRvcyhkZWxNZXMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIuLi4nKTtcbiAgLy8gdjExMDA6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvLiBGaWx0cmEgcG9yIG1lcyB2XHUwMEVEYSBmaWx0ZXJzLm1lc1lZWVlNTVxuICAvLyAocXVlIGVsIG1cdTAwRjNkdWxvIGFwbGljYSBzb2JyZSBjb25maXJtZWRBdCkuIENvaW5jaWRlIGNvbiBlbCBtb2RhbC5cbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBjb21wdXRlRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzO1xuICBjb25zdCBtZXNZWVlZTU0gPSBhbmlvICsgJy0nICsgU3RyaW5nKG1vbnRoSWR4ICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIC8vIHYxMTAxICgyMDI2LTA5LTMwKTogYnVzY2FyIHByaW1lcm8gcG9yIHNhcENhcmRDb2RlIChcdTAwRkFuaWNvLCBubyBkZXBlbmRlIGRlXG4gIC8vIG5vcm1hbGl6YWNpXHUwMEYzbiBkZSBzdHJpbmdzKSB5IHNcdTAwRjNsbyBjYWVyIGFsIGNsaWVudExvY0lkIGNvbW8gXHUwMEZBbHRpbW8gcmVjdXJzby5cbiAgLy8gVmVyIGNvbWVudGFyaW8gZXh0ZW5kaWRvIGVuIGluZGV4Lmh0bWw6ZXhwb3J0QmFja29yZGVyc1RvRXhjZWwuXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZSA9IHcuY2xpZW50TWFzdGVyQ2FjaGU7XG4gICAgICBpZiAoIWNhY2hlKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjYyA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICBpZiAoY2MgJiYgdHlwZW9mIGNhY2hlLmZvckVhY2ggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgbGV0IGZvdW5kID0gJyc7XG4gICAgICAgIGNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgICAgICAgIGlmIChmb3VuZCkgcmV0dXJuO1xuICAgICAgICAgIGlmIChjbURhdGEgJiYgU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpID09PSBjYyAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHtcbiAgICAgICAgICAgIGZvdW5kID0gY21EYXRhLmFzc2lnbmVkVmVuZG9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiBjYWNoZS5nZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgICBjb25zdCBjbURhdGEgPSBjYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgICB9XG4gICAgICByZXR1cm4gJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIHBlZGlkb3MsXG4gICAgICAgICd1cmdlbnRlJyxcbiAgICAgICAgeyBtZXNZWVlZTU0gfSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSBpZiAocCAmJiBwLl9mc0lkKSBwZWRpZG9CeUlkW3AuX2ZzSWRdID0gcDtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICByYXdMaW5lcy5mb3JFYWNoKChybCkgPT4ge1xuICAgIGNvbnN0IGMgPSBybC5jbGllbnRlO1xuICAgIGNvbnN0IHAgPSBjLnBlZGlkb0lkID8gcGVkaWRvQnlJZFtjLnBlZGlkb0lkXSA6IG51bGw7XG4gICAgY29uc3QgcW8gPSBjLnF0eUJhY2tvcmRlciB8fCAwO1xuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xuICAgIGlmIChjLnBlZGlkb0NyZWF0ZWRBdCkge1xuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcbiAgICAgIGZlY2hhUGVkaWRvID1cbiAgICAgICAgdHlwZW9mIGR0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICB9XG4gICAgbGV0IGNhbnRpZGFkUGVkaWRhID0gcW87XG4gICAgbGV0IGxpbmVhSWR4ID0gLTE7XG4gICAgaWYgKHAgJiYgQXJyYXkuaXNBcnJheShwLmxpbmVzKSkge1xuICAgICAgY29uc3QgaWR4ID0gcC5saW5lcy5maW5kSW5kZXgoXG4gICAgICAgIChsKSA9PiBsICYmIFN0cmluZyhsLmNvZGUgfHwgJycpLnRvVXBwZXJDYXNlKCkgPT09IHJsLnNrdSAmJiBsLnN0YXRlID09PSBjLnN0YXRlXG4gICAgICApO1xuICAgICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICAgIGNhbnRpZGFkUGVkaWRhID0gTnVtYmVyKHAubGluZXNbaWR4XS5xdHkpIHx8IHFvO1xuICAgICAgICBsaW5lYUlkeCA9IGlkeDtcbiAgICAgIH1cbiAgICB9XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXG4gICAgICBNZXM6IChwICYmIHAubW9udGgpIHx8ICcnLFxuICAgICAgQ2xpZW50ZTogYy5ub21icmUgfHwgJycsXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBjLnByb3ZpbmNpYSB8fCAocCAmJiBwLnByb3ZpbmNlKSB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYy5jaXVkYWQgfHwgKHAgJiYgcC5sb2NOYW1lKSB8fCAnJyxcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcbiAgICAgIFNLVTogcmwuc2t1IHx8ICcnLFxuICAgICAgUHJvZHVjdG86IHJsLnByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ2FudGlkYWRfUGVkaWRhOiBjYW50aWRhZFBlZGlkYSxcbiAgICAgIENhbnRpZGFkX1BlbmRpZW50ZV9CTzogcW8sXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQocW8gKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19CYWNrb3JkZXJfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFN0b2NrQXNpZ0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFN0b2NrIEFzaWduYWRvLi4uJyk7XG4gIC8vIHYxMTAwOiBkZWxlZ2EgYWwgbVx1MDBGM2R1bG8gcHVybyBtb2RvIGFzaWduYWNpb24uIENvaW5jaWRlIGNvbiBlbCBtb2RhbC5cbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBjb21wdXRlRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzO1xuICBjb25zdCBtZXNZWVlZTU0gPSBhbmlvICsgJy0nICsgU3RyaW5nKG1vbnRoSWR4ICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIC8vIHYxMTAxICgyMDI2LTA5LTMwKTogYnVzY2FyIHByaW1lcm8gcG9yIHNhcENhcmRDb2RlIChcdTAwRkFuaWNvLCBubyBkZXBlbmRlIGRlXG4gIC8vIG5vcm1hbGl6YWNpXHUwMEYzbiBkZSBzdHJpbmdzKSB5IHNcdTAwRjNsbyBjYWVyIGFsIGNsaWVudExvY0lkIGNvbW8gXHUwMEZBbHRpbW8gcmVjdXJzby5cbiAgLy8gVmVyIGNvbWVudGFyaW8gZXh0ZW5kaWRvIGVuIGluZGV4Lmh0bWw6ZXhwb3J0QmFja29yZGVyc1RvRXhjZWwuXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZSA9IHcuY2xpZW50TWFzdGVyQ2FjaGU7XG4gICAgICBpZiAoIWNhY2hlKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjYyA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICBpZiAoY2MgJiYgdHlwZW9mIGNhY2hlLmZvckVhY2ggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgbGV0IGZvdW5kID0gJyc7XG4gICAgICAgIGNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgICAgICAgIGlmIChmb3VuZCkgcmV0dXJuO1xuICAgICAgICAgIGlmIChjbURhdGEgJiYgU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpID09PSBjYyAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHtcbiAgICAgICAgICAgIGZvdW5kID0gY21EYXRhLmFzc2lnbmVkVmVuZG9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiBjYWNoZS5nZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgICBjb25zdCBjbURhdGEgPSBjYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgICB9XG4gICAgICByZXR1cm4gJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIHBlZGlkb3MsXG4gICAgICAgICdhc2lnbmFjaW9uJyxcbiAgICAgICAgeyBtZXNZWVlZTU0gfSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSBpZiAocCAmJiBwLl9mc0lkKSBwZWRpZG9CeUlkW3AuX2ZzSWRdID0gcDtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICByYXdMaW5lcy5mb3JFYWNoKChybCkgPT4ge1xuICAgIGNvbnN0IGMgPSBybC5jbGllbnRlO1xuICAgIGNvbnN0IHAgPSBjLnBlZGlkb0lkID8gcGVkaWRvQnlJZFtjLnBlZGlkb0lkXSA6IG51bGw7XG4gICAgY29uc3QgcXR5ID0gYy5xdHlBc2lnbmFkYSB8fCAwO1xuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xuICAgIGlmIChjLnBlZGlkb0NyZWF0ZWRBdCkge1xuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcbiAgICAgIGZlY2hhUGVkaWRvID1cbiAgICAgICAgdHlwZW9mIGR0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICB9XG4gICAgbGV0IGxpbmVhSWR4ID0gLTE7XG4gICAgaWYgKHAgJiYgQXJyYXkuaXNBcnJheShwLmxpbmVzKSkge1xuICAgICAgY29uc3QgaWR4ID0gcC5saW5lcy5maW5kSW5kZXgoXG4gICAgICAgIChsKSA9PiBsICYmIFN0cmluZyhsLmNvZGUgfHwgJycpLnRvVXBwZXJDYXNlKCkgPT09IHJsLnNrdSAmJiBsLnN0YXRlID09PSBjLnN0YXRlXG4gICAgICApO1xuICAgICAgaWYgKGlkeCA+PSAwKSBsaW5lYUlkeCA9IGlkeDtcbiAgICB9XG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XG4gICAgaWYgKGMuc3RhdGUgPT09ICdCTycpIGVzdGFkb1JlYWwgPSAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJztcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcXR5LFxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHF0eSAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgIH0pO1xuICB9KTtcbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdTdG9jayBBc2lnbmFkbycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFN0b2NrIEFzaWduYWRvIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuLy8gdjczNyAoMjAyNi0wOC0zMCk6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvcyBsb3MgYmFja29yZGVycyBvcGVuIChzaW4gZmlsdHJvXG4vLyBkZSBtZXMpLiBNb3Rpdm86IGxvcyA2MiBwZWRpZG9zIG1pZ3JhZG9zIGRlc2RlIFNBUCBlbCAyMDI2LTA4LTI4IHRpZW5lblxuLy8gY3JlYXRlZEF0IGRlIGZlY2hhcyB2aWVqYXMgZGVsIFNBUCBTUSBvcmlnaW5hbCwgZW50b25jZXMgZWwgZXhwb3J0IHBvciBtZXNcbi8vIG5vIGxvcyBpbmNsdWlhLiBWZXJzaW9uIFwiY3VycmVudCBzdGF0dXNcIiBxdWUgaXRlcmEgZ2xvYmFsUGVkaWRvcyBjb21wbGV0by5cbndpbmRvdy5leHBvcnRCYWNrb3JkZXJBbGwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEJhY2tvcmRlciAoc25hcHNob3QgYWN0dWFsKS4uLicpO1xuICAvLyB2MTQ4OCBcdTAwQTc4NiAoMjAyNi0xMC0yNyBCVUcgRklYKTogdXNhciBsYSBNSVNNQSBwdXJlIGZuIHF1ZSBlbCBtb2RhbCBleHBvcnRcbiAgLy8gKGBjb21wdXRlQmFja29yZGVyRXhwb3J0Um93c2ApLiBBbnRlcyB2MTQ4ODogcGFuZWwgdXNhYmFcbiAgLy8gYGNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcyh7fSlgIHNpbiBgaW5jbHVkZUV4cGlyZWRgIFx1MjE5MiBvY3VsdGFiYSBCT3MgPiA5MGQuXG4gIC8vIE1vZGFsIHVzYWJhIGBjb21wdXRlQmFja29yZGVyU2t1TWFwKC4uLiwge2luY2x1ZGVFeHBpcmVkOnRydWV9KWAgXHUyMTkyIGxvc1xuICAvLyBpbmNsdVx1MDBFRGEuIERlbHRhIG1lZGlkbyBlbiBwcm9kOiAyMjIgdW5pZGFkZXMgKG1vZGFsIDc2OTYgdnMgcGFuZWwgNzQ3NCkuXG4gIC8vIEZpeDogcHVyZSBmbiBcdTAwRkFuaWNhIGNvbiBkZWZhdWx0IGBpbmNsdWRlRXhwaXJlZD10cnVlYCAoYWxpbmVhZG8gY29uIFx1MDBBNzQwLjFcbiAgLy8geSBnZXRTdG9ja0JyZWFrZG93bi5iYWNrb3JkZXJBcHAudG90YWwgXHUyMDE0IGxhIGNvbGEgY29tcGxldGEpLlxuICAvLyB2MTUzNDogYWxjYW5jZSBwb3Igcm9sICh2ZW5kZWRvciA9IGNsaWVudGVzIGRlIHN1IG1hc3RlcjsgaW50ZXJubyA9IHBhcmVqYXMpLlxuICBjb25zdCBhcnIgPSBfZXhwb3J0U2NvcGUoKS5maWx0ZXJQZWRpZG9zKFxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdXG4gICk7XG4gIGNvbnN0IHRvdGFsUGVkaWRvc09wZW4gPSBhcnIuZmlsdGVyKChwKSA9PiBwICYmICFwLmNsb3NlZEF0KS5sZW5ndGg7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkICE9PSAnZnVuY3Rpb24nIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlLmdldClcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgY29uc3QgY21EYXRhID0gdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgLy8gdjE0ODggXHUwMEE3ODY6IHB1cmUgZm4gXHUwMEZBbmljYSBgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3NgIChyZWVtcGxhemEgZWxcbiAgLy8gcGF0aCBoaXN0XHUwMEYzcmljbyBgY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzYCBxdWUgbm8gY29uc29saWRhYmEgeSBwZXJkXHUwMEVEYVxuICAvLyBCT3MgPiA5MGQpLiBQYW5lbCBwYXNhIGB7fWAgXHUyMTkyIHRyYWUgdG9kYSBsYSBjb2xhIHNpbiBmaWx0cm9zIG1hbnVhbGVzLlxuICBjb25zdCBfZXhwb3J0Rm4gPVxuICAgIHcuX19waGFzZTAgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0ICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydC5jb21wdXRlQmFja29yZGVyRXhwb3J0Um93cztcbiAgY29uc3QgZGVwcyA9IHtcbiAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgY2Fub25WZW5kb3I6XG4gICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICB9O1xuICBjb25zdCBfZXhwb3J0UmVzdWx0ID0gX2V4cG9ydEZuXG4gICAgPyBfZXhwb3J0Rm4oYXJyLCB7fSwgZGVwcylcbiAgICA6IHsgcm93czogW10sIHRvdGFsVW5pZGFkZXM6IDAsIHRvdGFsRmlsYXM6IDAsIGZpbHRyb3NBcGxpY2Fkb3M6IHt9IH07XG4gIGNvbnN0IHJvd3MgPSBfZXhwb3J0UmVzdWx0LnJvd3M7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0V4cG9ydCBCYWNrb3JkZXIgdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xuICAgICAgICBhcnIubGVuZ3RoICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcbiAgICAgICAgdG90YWxQZWRpZG9zT3BlbiArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gTGluZWFzIHBvc3QtRklGTyt2ZW5jaWRhcyBjb24gcXR5QmFja29yZGVyPjA6IDBcXG5cXG4nICtcbiAgICAgICAgJ1Bvc2libGVzIGNhdXNhczpcXG4nICtcbiAgICAgICAgJzEuIE5vIGhheSBiYWNrb3JkZXIgYWJpZXJ0byBhaG9yYSBtaXNtbyAodG9kbyBjb25maXJtZWQsIGNlcnJhZG8gbyB2ZW5jaWRvKVxcbicgK1xuICAgICAgICAnMi4gTG9zIHBlZGlkb3MgdGllbmVuIGNsb3NlZEF0IHNldGVhZG8gcG9yIGVycm9yXFxuJyArXG4gICAgICAgICczLiBUb2RhcyBsYXMgbGluZWFzIEJPIHRpZW5lbiBzdG9jayBkaXNwb25pYmxlIChmdWVyb24gcHJvbW92aWRhcyBhIEFTSUcgdmlydHVhbCknXG4gICAgKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlcjogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcbiAgLy8gdjEzNjYgKDIwMjYtMTAtMTkpOiBob2phIFwiUmVzdW1lblwiIGNvbiBsb3MgTUlTTU9TIHRvdGFsZXMgcXVlIGVsIG1vZGFsXG4gIC8vIEJhY2tvcmRlciAoY29tcHV0ZUJhY2tvcmRlclNrdU1hcCBwb3N0LWNvbnNvbGlkYWNpb24gcG9yIGNsaWVudGUpLiBBbnRlc1xuICAvLyBlbCBleHBvcnQgZHVtcGVhYmEgbGluZWFzIGNydWRhcyBzaW4gbmluZ3VuIHRvdGFsIFx1MjE5MiBNYXJpYW5vIHN1bWFiYSBsYVxuICAvLyBjb2x1bW5hIFN1YnRvdGFsX0JPX0FSUyB5IGVsIHZhbG9yIHBvZGlhIGRpdmVyZ2VyIGRlbCBtb2RhbCBjdWFuZG8gdW5cbiAgLy8gY2xpZW50ZSB0ZW5pYSB2YXJpYXMgbGluZWFzIEJPIGRlbCBtaXNtbyBTS1UgY29uIHByZWNpb3MgZGlzdGludG9zIChlbFxuICAvLyBtb2RhbCBjb25zb2xpZGEgdXNhbmRvIGVsIHByZWNpbyBkZSBsYSAxcmEgbGluZWEgcHJvY2VzYWRhOyBlbCBleHBvcnRcbiAgLy8gdXNhIGVsIHByZWNpbyBkZSBjYWRhIGxpbmVhIGluZGl2aWR1YWwpLlxuICBjb25zdCBfY29tcHV0ZVNrdU1hcEZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJTa3VNYXA7XG4gIGNvbnN0IF9tb2RhbERlcHMgPSB7XG4gICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgIGNhbm9uVmVuZG9yOlxuICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgIGJhY2tvcmRlckxpbmVzOiBBcnJheS5pc0FycmF5KHcuYmFja29yZGVyTGluZXMpID8gdy5iYWNrb3JkZXJMaW5lcyA6IFtdLFxuICAgIHNhcEdldENsaWVudGVDb2RlOiB0eXBlb2Ygdy5zYXBHZXRDbGllbnRlQ29kZSA9PT0gJ2Z1bmN0aW9uJyA/IHcuc2FwR2V0Q2xpZW50ZUNvZGUgOiB1bmRlZmluZWQsXG4gICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICB9O1xuICBjb25zdCBfbW9kYWxGaWx0ZXJzID0ge1xuICAgIHRpZW5kYVF1ZXJ5OiAnJyxcbiAgICB2ZW5kb3JLZXk6ICcnLFxuICAgIG1lc1lZWVlNTTogJycsXG4gICAgdXJnZW5jeUZpbHRlcjogJycsXG4gICAgaW5jbHVkZUV4cGlyZWQ6IHRydWUsXG4gICAgYWdncmVnYXRpb25Nb2RlOiAnZmlmbycsXG4gIH07XG4gIGNvbnN0IF9tb2RhbFJlc3VsdCA9IF9jb21wdXRlU2t1TWFwRm5cbiAgICA/IF9jb21wdXRlU2t1TWFwRm4oYXJyLCAndXJnZW50ZScsIF9tb2RhbEZpbHRlcnMsIF9tb2RhbERlcHMpXG4gICAgOiB7IHNrdXM6IFtdLCB0b3RhbFVuaWRhZGVzOiAwLCB0b3RhbENsaWVudGVzOiAwIH07XG4gIGxldCB0b3RhbFBlc29zTW9kYWwgPSAwO1xuICBjb25zdCBzdWJ0b3RhbGVzUG9yVXJnZW5jeSA9IHsgdXJnZW50ZTogMCwgcGFyY2lhbDogMCB9O1xuICBmb3IgKGNvbnN0IGcgb2YgX21vZGFsUmVzdWx0LnNrdXMgfHwgW10pIHtcbiAgICBjb25zdCB1cmcgPSBnLnVyZ2VuY3kgfHwgJ3VyZ2VudGUnO1xuICAgIGZvciAoY29uc3QgYyBvZiBnLmNsaWVudGVzIHx8IFtdKSB7XG4gICAgICBjb25zdCBxdHkgPSBOdW1iZXIoYy5xdHlCYWNrb3JkZXIpIHx8IDA7XG4gICAgICBpZiAocXR5IDw9IDApIGNvbnRpbnVlO1xuICAgICAgY29uc3QgcHJlY2lvID0gTnVtYmVyKGMucHJlY2lvKSB8fCAwO1xuICAgICAgY29uc3Qgc3ViID0gcXR5ICogcHJlY2lvO1xuICAgICAgdG90YWxQZXNvc01vZGFsICs9IHN1YjtcbiAgICAgIGlmICh1cmcgPT09ICdwYXJjaWFsJykgc3VidG90YWxlc1BvclVyZ2VuY3kucGFyY2lhbCArPSBzdWI7XG4gICAgICBlbHNlIHN1YnRvdGFsZXNQb3JVcmdlbmN5LnVyZ2VudGUgKz0gc3ViO1xuICAgIH1cbiAgfVxuICBjb25zdCB0b3RhbFVuaWRhZGVzTW9kYWwgPSBfZXhwb3J0UmVzdWx0LnRvdGFsVW5pZGFkZXMgfHwgX21vZGFsUmVzdWx0LnRvdGFsVW5pZGFkZXMgfHwgMDtcbiAgY29uc3QgdG90YWxDbGllbnRlc01vZGFsID0gX21vZGFsUmVzdWx0LnRvdGFsQ2xpZW50ZXMgfHwgMDtcbiAgY29uc3QgdG90YWxTa3VzTW9kYWwgPSAoX21vZGFsUmVzdWx0LnNrdXMgfHwgW10pLmxlbmd0aDtcbiAgLy8gdjE0ODggXHUwMEE3ODY6IGZpbGEgZGUgZW5jYWJlemFkbyBcIkZpbHRyb3MgYXBsaWNhZG9zXCIgcGFyYSB0cmFuc3BhcmVuY2lhLlxuICBjb25zdCBfZm10RmlsdHJvcyA9XG4gICAgdy5fX3BoYXNlMCAmJlxuICAgIHcuX19waGFzZTAucHVyZSAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0LmZvcm1hdEJhY2tvcmRlckZpbHRyb3NIZWFkZXI7XG4gIGNvbnN0IGZpbHRyb3NMYmwgPSBfZm10RmlsdHJvcyA/IF9mbXRGaWx0cm9zKF9leHBvcnRSZXN1bHQuZmlsdHJvc0FwbGljYWRvcykgOiAnRmlsdHJvczogbmluZ3Vubyc7XG4gIGNvbnN0IHJlc3VtZW5Sb3dzID0gW1xuICAgIHsgTWV0cmljYTogZmlsdHJvc0xibCwgVmFsb3I6ICcnIH0sXG4gICAgeyBNZXRyaWNhOiAnVE9UQUwgQmFja29yZGVyIEFSUycsIFZhbG9yOiBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCkgfSxcbiAgICB7IE1ldHJpY2E6ICdTS1VzIGNvbiBiYWNrb3JkZXInLCBWYWxvcjogdG90YWxTa3VzTW9kYWwgfSxcbiAgICB7IE1ldHJpY2E6ICdVbmlkYWRlcyBwZW5kaWVudGVzJywgVmFsb3I6IE1hdGgucm91bmQodG90YWxVbmlkYWRlc01vZGFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1BhcmVzIGNsaWVudGUrU0tVIChmaWxhcyBlbiBob2phIEJhY2tvcmRlciknLCBWYWxvcjogcm93cy5sZW5ndGggfSxcbiAgICB7IE1ldHJpY2E6ICdDbGllbnRlcyBhZmVjdGFkb3MnLCBWYWxvcjogdG90YWxDbGllbnRlc01vZGFsIH0sXG4gICAgeyBNZXRyaWNhOiAnXHUyMDE0IFN1YnRvdGFsIFNJTiBSRVBPU0lDSU9OJywgVmFsb3I6IE1hdGgucm91bmQoc3VidG90YWxlc1BvclVyZ2VuY3kudXJnZW50ZSkgfSxcbiAgICB7IE1ldHJpY2E6ICdcdTIwMTQgU3VidG90YWwgUEFSQ0lBTCcsIFZhbG9yOiBNYXRoLnJvdW5kKHN1YnRvdGFsZXNQb3JVcmdlbmN5LnBhcmNpYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnU25hcHNob3QgZ2VuZXJhZG8nLCBWYWxvcjogbmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSB9LFxuICBdO1xuICAvLyB2MTQ4OCBcdTAwQTc4NjogZmlsYSBUT1RBTCBhbGluZWFkYSBjb24gZWwgbnVldm8gc2hhcGUgKHNpbiBjb2x1bW5hcyBsZWdhY3lcbiAgLy8gRmVjaGFfUGVkaWRvIC8gTWVzIC8gQ2FudGlkYWRfUGVkaWRhIC8gUGVkaWRvX0lEIC8gTGluZWFfSWR4IC8gZXRjLikuXG4gIC8vIExhcyBudWV2YXMgY29sdW1uYXMgKGRlIGNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzKTogU0tVLCBQcm9kdWN0byxcbiAgLy8gQ2xpZW50ZSwgQ2FyZENvZGUsIFByb3ZpbmNpYSwgTG9jYWxpZGFkLCBWZW5kZWRvciwgQ2FudGlkYWRfUGVuZGllbnRlX0JPLFxuICAvLyBQcmVjaW9fVW5pdF9BUlMsIFN1YnRvdGFsX0JPX0FSUywgRWRhZF9CT19kaWFzLCBFc3RhZG8sIFBlZGlkb3MuXG4gIGNvbnN0IHRvdGFsUm93ID0ge1xuICAgIFNLVTogJycsXG4gICAgUHJvZHVjdG86ICcnLFxuICAgIENsaWVudGU6ICdUT1RBTCcsXG4gICAgQ2FyZENvZGU6ICcnLFxuICAgIFByb3ZpbmNpYTogJycsXG4gICAgTG9jYWxpZGFkOiAnJyxcbiAgICBWZW5kZWRvcjogJycsXG4gICAgQ2FudGlkYWRfUGVuZGllbnRlX0JPOiBNYXRoLnJvdW5kKHRvdGFsVW5pZGFkZXNNb2RhbCksXG4gICAgUHJlY2lvX1VuaXRfQVJTOiAnJyxcbiAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQodG90YWxQZXNvc01vZGFsKSxcbiAgICBFZGFkX0JPX2RpYXM6ICcnLFxuICAgIEVzdGFkbzogJycsXG4gICAgUGVkaWRvczogJycsXG4gIH07XG4gIHJvd3MucHVzaCh0b3RhbFJvdyk7XG4gIC8vIHYxNTY1ICgyMDI2LTExLTE4KTogMiBob2phcyBleGFjdGFzIHBvciBwZWRpZG8gTWFyaWFuby5cbiAgLy8gXCJCYWNrb3JkZXJfQ2xpZW50ZXNcIiAoU0tVLCBOT01CUkVfREVMX1BST0RVQ1RPLCBDQU5USURBRF9CQUNLT1JERVIsXG4gIC8vICAgU1VCVE9UQUwsIENMSUVOVEUsIElEX1BFRElETykgKyBcIkJhY2tvcmRlcl9TS1VcIiAoU0tVLCBDQU5USURBRF9CQUNLT1JERVIsXG4gIC8vICAgU1VCVE9UQUwsIFBST01FRElPX1ZFTlRBXzNNKS4gQ29sdW1uYSBQUk9NRURJT19WRU5UQV8zTSBxdWVkYSB2YWNpYVxuICAvLyAgIChyZXF1aWVyZSBhZ3JlZ2FkbyBCUSBmdWVyYSBkZWwgYWxjYW5jZSBkZSBlc3RlIFBSOyBkb2N1bWVudGFkbyBlblxuICAvLyAgIGRvY3MvQ0hBTkdFTE9HLWV4cG9ydHMtY29sdW1ucy1yZWZhY3Rvci5tZCkuIFJlc3VtZW4gaW50ZXJubyBjb25zZXJ2YWRvXG4gIC8vICAgeSBhcHJvdmVjaGFkbyBwYXJhIGVsIGFncmVnYWRvIHBvciBTS1UuXG4gIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgYW55Pj59ICovXG4gIGNvbnN0IHJvd3NDbGllbnRlcyA9IHJvd3NcbiAgICAuZmlsdGVyKChyKSA9PiAoci5DbGllbnRlIHx8ICcnKSAhPT0gJ1RPVEFMJylcbiAgICAubWFwKChyKSA9PiAoe1xuICAgICAgU0tVOiByLlNLVSB8fCAnJyxcbiAgICAgIE5PTUJSRV9ERUxfUFJPRFVDVE86IHIuUHJvZHVjdG8gfHwgJycsXG4gICAgICBDQU5USURBRF9CQUNLT1JERVI6IE51bWJlcihyLkNhbnRpZGFkX1BlbmRpZW50ZV9CTykgfHwgMCxcbiAgICAgIFNVQlRPVEFMOiBOdW1iZXIoci5TdWJ0b3RhbF9CT19BUlMpIHx8IDAsXG4gICAgICBDTElFTlRFOiByLkNsaWVudGUgfHwgJycsXG4gICAgICBJRF9QRURJRE86IHIuUGVkaWRvcyB8fCAnJyxcbiAgICB9KSk7XG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywge3F0eTogbnVtYmVyLCBzdWI6IG51bWJlciwgbm9tYnJlOiBzdHJpbmd9Pn0gKi9cbiAgY29uc3Qgc2t1QWdnID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IHIgb2Ygcm93c0NsaWVudGVzKSB7XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHIuU0tVIHx8ICcnKS50cmltKCk7XG4gICAgaWYgKCFza3UpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHByZXYgPSBza3VBZ2cuZ2V0KHNrdSkgfHwgeyBxdHk6IDAsIHN1YjogMCwgbm9tYnJlOiByLk5PTUJSRV9ERUxfUFJPRFVDVE8gfTtcbiAgICBwcmV2LnF0eSArPSBOdW1iZXIoci5DQU5USURBRF9CQUNLT1JERVIpIHx8IDA7XG4gICAgcHJldi5zdWIgKz0gTnVtYmVyKHIuU1VCVE9UQUwpIHx8IDA7XG4gICAgaWYgKCFwcmV2Lm5vbWJyZSAmJiByLk5PTUJSRV9ERUxfUFJPRFVDVE8pIHByZXYubm9tYnJlID0gci5OT01CUkVfREVMX1BST0RVQ1RPO1xuICAgIHNrdUFnZy5zZXQoc2t1LCBwcmV2KTtcbiAgfVxuICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+fSAqL1xuICBjb25zdCByb3dzU2t1ID0gW107XG4gIGZvciAoY29uc3QgW3NrdSwgYWdnXSBvZiBza3VBZ2cpIHtcbiAgICByb3dzU2t1LnB1c2goe1xuICAgICAgU0tVOiBza3UsXG4gICAgICBDQU5USURBRF9CQUNLT1JERVI6IGFnZy5xdHksXG4gICAgICBTVUJUT1RBTDogTWF0aC5yb3VuZChhZ2cuc3ViKSxcbiAgICAgIFBST01FRElPX1ZFTlRBXzNNOiAnJywgLy8gdjE1NjUgcGVuZGllbnRlOiByZXF1aWVyZSBhZ3JlZ2FkbyBCUSAodmVyIGNoYW5nZWxvZykuXG4gICAgfSk7XG4gICAgdm9pZCByZXN1bWVuUm93cztcbiAgfVxuICByb3dzU2t1LnNvcnQoKGEsIGIpID0+IChiLlNVQlRPVEFMIHx8IDApIC0gKGEuU1VCVE9UQUwgfHwgMCkpO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ0JBQ0tPUkRFUl8nICsgdG9kYXkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdCYWNrb3JkZXJfQ2xpZW50ZXMnLCByb3dzOiByb3dzQ2xpZW50ZXMgfSxcbiAgICB7IG5hbWU6ICdCYWNrb3JkZXJfU0tVJywgcm93czogcm93c1NrdSB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgK1xuICAgICAgKHJvd3MubGVuZ3RoIC0gMSkgK1xuICAgICAgJyBsaW5lYXMgKyBSZXN1bWVuIGNvbiB0b3RhbCAkJyArXG4gICAgICBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgJyknLFxuICAgIDMwMDBcbiAgKTtcbn07XG5cbi8vIHYxNTExICgyMDI2LTEwLTI4KTogaGFuZGxlciB3aW5kb3cuZXhwb3J0UmVwYXJ0b1RvRXhjZWwgcmVtb3ZpZG8ganVudG8gY29uIGVsXG4vLyBib3RvbiBcIkV4cG9ydGFyIHJlcG9ydGVcIiBkZWwgbW9kYWwgUmVwYXJ0by4gUmVlbXBsYXphZG8gcG9yIGVsIGZsb3cgZWRpdGFibGVcbi8vIFwiRXhwb3J0YXIgRXhjZWxcIiArIFwiSW1wb3J0YXIgRXhjZWxcIiBkZWwgUFIgIzEyNzMgKHYxNTA1KS5cbi8vIFByZXNlcnZhZG86IHNyYy9wdXJlL3JlcGFydG8tZXhwb3J0LXJvd3MuanMgKHNoYXBlIGRlIHJvd3MgYXVuIHVzYWRvIHBvciBvdHJvcyBleHBvcnRzKS5cblxuLy8gdjczNzogU05BUFNIT1QgQUNUVUFMIGRlIHRvZG8gZWwgU3RvY2sgQXNpZ25hZG8gKHNpbiBmaWx0cm8gZGUgbWVzKS4gTWlzbW9cbi8vIG1vdGl2byBxdWUgZXhwb3J0QmFja29yZGVyQWxsLlxud2luZG93LmV4cG9ydFN0b2NrQXNpZ0FsbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgU3RvY2sgQXNpZ25hZG8gKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjExMDAgKDIwMjYtMDktMzApOiBtaXNtbyBtXHUwMEYzZHVsbyBwdXJvIHF1ZSByZW5kZXJCYWNrb3JkZXJzVGFiIGVuIG1vZG9cbiAgLy8gYXNpZ25hY2lvbi4gQWhvcmEgZWwgcmVwb3J0ZSBjb2luY2lkZSBjb24gZWwgbW9kYWw6IEZJRk8gY2FwIHBvciBkaXNwU2FwLFxuICAvLyBmaWx0cm8gdmVuY2lkYXMgKEFTSUcgPjE1ZCBmdWVyYSwgQVNJRyBzaW4gcmVzZXJ2YSB2aWdlbnRlIGFkZW50cm8pLFxuICAvLyBjb25maXJtZWQgaW5jbHVpZG8sIHNpbiBsXHUwMEVEbmVhcyBcInZpcnR1YWxfQVNJR1wiIGZhbnRhc21hLlxuICAvLyB2MTUzNDogYWxjYW5jZSBwb3Igcm9sICh2ZW5kZWRvciA9IGNsaWVudGVzIGRlIHN1IG1hc3RlcjsgaW50ZXJubyA9IHBhcmVqYXMpLlxuICBjb25zdCBhcnIgPSBfZXhwb3J0U2NvcGUoKS5maWx0ZXJQZWRpZG9zKFxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdXG4gICk7XG4gIGNvbnN0IHRvdGFsUGVkaWRvc09wZW4gPSBhcnIuZmlsdGVyKChwKSA9PiBwICYmICFwLmNsb3NlZEF0KS5sZW5ndGg7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpO1xuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkICE9PSAnZnVuY3Rpb24nIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlIHx8ICF3LmNsaWVudE1hc3RlckNhY2hlLmdldClcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgY29uc3QgY21EYXRhID0gdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgcmF3TGluZXMgPSBjb21wdXRlRm5cbiAgICA/IGNvbXB1dGVGbihcbiAgICAgICAgYXJyLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHt9LFxuICAgICAgICB7XG4gICAgICAgICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICAgICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgICAgICAgIGNhbm9uVmVuZG9yOlxuICAgICAgICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgICAgICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgICAgICAgfVxuICAgICAgKVxuICAgIDogW107XG4gIGNvbnN0IHBlZGlkb0J5SWQgPSB7fTtcbiAgZm9yIChjb25zdCBwIG9mIGFycikgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIC8vIEVzdGFkb19SZWFsOiBoaXN0XHUwMEYzcmljbyBcIkJPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKVwiIHZzIFwiQVNJR1wiLiB2MTEwMDpcbiAgICAvLyBhaG9yYSBgY29uZmlybWVkYCB0YW1iaVx1MDBFOW4gZW50cmEgKHY5NjIpLiBQcmVzZXJ2YW1vcyBldGlxdWV0YSBsZWdhY3lcbiAgICAvLyBwb3IgY29tcGF0aWJpbGlkYWQgY29uIHF1aWVuIGNvbnN1bWUgZWwgRXhjZWwuXG4gICAgbGV0IGVzdGFkb1JlYWwgPSAnQVNJRyc7XG4gICAgaWYgKGMuc3RhdGUgPT09ICdCTycpIGVzdGFkb1JlYWwgPSAnQk9fY29uX3N0b2NrXyh2aXJ0dWFsX0FTSUcpJztcbiAgICBlbHNlIGlmIChjLnN0YXRlID09PSAnY29uZmlybWVkJykgZXN0YWRvUmVhbCA9ICdjb25maXJtZWQgKFNRIGVuIFNBUCknO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1Jlc2VydmFkYTogcXR5LFxuICAgICAgRXN0YWRvX1JlYWw6IGVzdGFkb1JlYWwsXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9SZXNlcnZhZG9fQVJTOiBNYXRoLnJvdW5kKHF0eSAqIChjLnByZWNpbyB8fCAwKSksXG4gICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICBMaW5lYV9JZHg6IGxpbmVhSWR4LFxuICAgICAgU1FfRG9jTnVtOiBjLnNxRG9jTnVtIHx8ICcnLFxuICAgICAgT3JpZ2VuOiAocCAmJiBwLm1pZ3JhdGlvblNvdXJjZSkgfHwgJ2FwcCcsXG4gICAgICAvLyB2MTEwMDogY29udGV4dG8gXHUwMEZBdGlsIHBhcmEgZGVidWdnaW5nIHBhcmlkYWQgbW9kYWxcdTIxOTRyZXBvcnRlLlxuICAgICAgU3RvY2tfRGlzcF9TS1U6IHJsLmRpc3BTYXAgfHwgMCxcbiAgICB9KTtcbiAgfSk7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyB2YWNpby4gRGlhZ25vc3RpY286XFxuJyArXG4gICAgICAgICctIFRvdGFsIHBlZGlkb3MgZW4gZ2xvYmFsUGVkaWRvczogJyArXG4gICAgICAgIGFyci5sZW5ndGggK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIFBlZGlkb3MgYWJpZXJ0b3MgKHNpbiBjbG9zZWRBdCk6ICcgK1xuICAgICAgICB0b3RhbFBlZGlkb3NPcGVuICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBMaW5lYXMgcG9zdC1GSUZPK3ZlbmNpZGFzIGNvbiBxdHlBc2lnbmFkYT4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgc3RvY2sgYXNpZ25hZG8gYWhvcmEgbWlzbW9cXG4nICtcbiAgICAgICAgJzIuIFRvZG9zIGxvcyBBU0lHIGVzdGFuIHZlbmNpZG9zICg+MTVkIGRlc2RlIGFzaWdBdClcXG4nICtcbiAgICAgICAgJzMuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnOiAwIGxpbmVhcyAodmVyIGFsZXJ0YSknLCAzMDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1N0b2NrQXNpZ25hZG9fU25hcHNob3RfJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59O1xuXG4vLyB2MTM5NiAoMjAyNi0xMC0yMSk6IG51ZXZvIGV4cG9ydCBcIlBlbmRpZW50ZSBkZSBBc2lnbmFjaVx1MDBGM24gLSBQYWJsb1wiLiBMaXN0YVxuLy8gbG9zIHJlcGFydG9zIGFiaWVydG9zIChpbmdyZXNvc19yZXBhcnRvIHBlbmRpbmcvaW5fcHJvZ3Jlc3MpIHBvciBTS1UgK1xuLy8gY2xpZW50ZXMgZW4gY29sYS4gUmVlbXBsYXphIHNlbVx1MDBFMW50aWNhbWVudGUgYWwgdmllam8gXCJTdG9jayBBc2lnbmFkb1wiIGVuIGVsXG4vLyBtb2RhbCAoZWwgdmllam8gcGFzYSBhIFwiU3RvY2sgQXNpZ25hZG8gLSBsXHUwMEVEbmVhc1wiIGNvbW8gYXV4aWxpYXIpLlxuLy8gRG9zIGhvamFzOlxuLy8gICBSZXN1bWVuIHJlcGFydG8gXHUyMDE0IHVuYSBmaWxhIHBvciBkb2MgaW5ncmVzb3NfcmVwYXJ0by5cbi8vICAgQ2xpZW50ZXMgZW4gY29sYSBcdTIwMTQgdW5hIGZpbGEgcG9yIGNsaWVudGUgQk8gZGUgY2FkYSByZXBhcnRvLlxud2luZG93LmV4cG9ydFBlbmRpZW50ZURlQXNpZ25hY2lvblBhYmxvID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG8uLi4nKTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGZiRGIgPSB3LmZiRGI7XG4gIGlmICghZmJEYikge1xuICAgIGFsZXJ0KCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvLiBSZWludGVudFx1MDBFMSBlbiB1bm9zIHNlZ3VuZG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyAxLiBSZXBhcnRvcyBhYmllcnRvcy5cbiAgbGV0IHJlcGFydG9zRG9jcztcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ2luZ3Jlc29zX3JlcGFydG8nKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ3BlbmRpbmcnLCAnaW5fcHJvZ3Jlc3MnXSlcbiAgICAgIC5nZXQoKTtcbiAgICByZXBhcnRvc0RvY3MgPSBzbmFwLmRvY3M7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgY2FyZ2FuZG8gaW5ncmVzb3NfcmVwYXJ0bzogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXJlcGFydG9zRG9jcyB8fCByZXBhcnRvc0RvY3MubGVuZ3RoID09PSAwKSB7XG4gICAgYWxlcnQoJ05vIGhheSByZXBhcnRvcyBwZW5kaW5nL2luX3Byb2dyZXNzIGFob3JhIG1pc21vLicpO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUGFibG86IDAgcmVwYXJ0b3MnLCAyNDAwKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMi4gU25hcHNob3Qgc3RvY2sgKyBnZXRTdG9ja0JyZWFrZG93biBwb3IgU0tVLlxuICBjb25zdCBzdG9ja1NuYXAgPVxuICAgIHR5cGVvZiB3LmdldFN0b2NrU25hcHNob3QgPT09ICdmdW5jdGlvbidcbiAgICAgID8gdy5nZXRTdG9ja1NuYXBzaG90KClcbiAgICAgIDogdy5fc3RvY2tTbmFwc2hvdENhY2hlIHx8IHsgd2FyZWhvdXNlQnJlYWtkb3duOiB7fSB9O1xuICBjb25zdCB3aHMgPVxuICAgIHR5cGVvZiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHN0b2NrU25hcC53YXJlaG91c2VCcmVha2Rvd24gfHwge307XG4gIGNvbnN0IHBlZGlkb3MgPSBBcnJheS5pc0FycmF5KHcuZ2xvYmFsUGVkaWRvcykgPyB3Lmdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgY29uc3Qgd2FpdGxpc3RFbnRyaWVzID1cbiAgICB0eXBlb2Ygdy5fZ2V0V2FpdGxpc3RDcHN0RW50cmllcyA9PT0gJ2Z1bmN0aW9uJyA/IHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMoKSA6IFtdO1xuICBjb25zdCBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zID0gcmVwYXJ0b3NEb2NzLm1hcCgoZCkgPT5cbiAgICBPYmplY3QuYXNzaWduKHsgX2ZzSWQ6IGQuaWQgfSwgZC5kYXRhKCkgfHwge30pXG4gICk7XG4gIGNvbnN0IGdldEJyZWFrZG93biA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5nZXRTdG9ja0JyZWFrZG93bjtcbiAgLy8gMy4gUmVzb2x2ZXIgcHJvZHVjdG8gcG9yIFNLVS5cbiAgY29uc3QgcHJvZEJ5U2t1ID0gbmV3IE1hcCgpO1xuICBjb25zdCBQUk9EVUNUUyA9IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW107XG4gIGZvciAoY29uc3QgcCBvZiBQUk9EVUNUUykge1xuICAgIGlmIChwICYmIHAuc2t1KSBwcm9kQnlTa3Uuc2V0KFN0cmluZyhwLnNrdSkudG9VcHBlckNhc2UoKSwgcCk7XG4gIH1cbiAgY29uc3Qgbm93TXMgPSBEYXRlLm5vdygpO1xuICBjb25zdCByZXN1bWVuUm93cyA9IFtdO1xuICBjb25zdCBjb2xhUm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IGRvYyBvZiByZXBhcnRvc0RvY3MpIHtcbiAgICBjb25zdCBkYXRhID0gZG9jLmRhdGEoKSB8fCB7fTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoZGF0YS5za3UgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcHJvZCA9IHByb2RCeVNrdS5nZXQoc2t1KSB8fCBudWxsO1xuICAgIGNvbnN0IGZpc2ljb0RlcDExID0gTnVtYmVyKCh3aHNbc2t1XSAmJiB3aHNbc2t1XVsnMTEnXSkgfHwgMCk7XG4gICAgY29uc3QgcXR5SW5ncmVzYWRhID0gTnVtYmVyKGRhdGEucXR5SW5ncmVzYWRhIHx8IDApO1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0gQXJyYXkuaXNBcnJheShkYXRhLmFzc2lnbm1lbnRzKSA/IGRhdGEuYXNzaWdubWVudHMgOiBbXTtcbiAgICBsZXQgcXR5WWFBc2lnbmFkYSA9IDA7XG4gICAgZm9yIChjb25zdCBhIG9mIGFzc2lnbm1lbnRzKSBxdHlZYUFzaWduYWRhICs9IE51bWJlcigoYSAmJiBhLnF0eUFzaWduYWRhKSB8fCAwKTtcbiAgICBsZXQgcXR5QVJlcGFydGlyID0gTWF0aC5tYXgoMCwgcXR5SW5ncmVzYWRhIC0gcXR5WWFBc2lnbmFkYSk7XG4gICAgaWYgKGdldEJyZWFrZG93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYmsgPSBnZXRCcmVha2Rvd24oXG4gICAgICAgICAgc2t1LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGdldFN0b2NrRmlzaWNvOiAoKSA9PiBmaXNpY29EZXAxMSxcbiAgICAgICAgICAgIHBlZGlkb3MsXG4gICAgICAgICAgICB3YWl0bGlzdEVudHJpZXMsXG4gICAgICAgICAgICBpbmdyZXNvc1JlcGFydG9BY3Rpdm9zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBub3c6IG5vd01zIH1cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGJrICYmIGJrLnJlcGFydG9BYmllcnRvICYmIHR5cGVvZiBiay5yZXBhcnRvQWJpZXJ0by5xdHkgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgcXR5QVJlcGFydGlyID0gYmsucmVwYXJ0b0FiaWVydG8ucXR5O1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvKiBmYWxsYmFjayBhIGNcdTAwRTFsY3VsbyBsb2NhbCAqL1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjbGllbnRlc0JPID0gQXJyYXkuaXNBcnJheShkYXRhLmNsaWVudGVzQk8pID8gZGF0YS5jbGllbnRlc0JPIDogW107XG4gICAgbGV0IGRldGVjdGVkQXQgPSBkYXRhLmRldGVjdGVkQXQgfHwgJyc7XG4gICAgaWYgKGRldGVjdGVkQXQgJiYgdHlwZW9mIGRldGVjdGVkQXQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkZXRlY3RlZEF0ID0gZGV0ZWN0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9ICcnO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBib1RvdGFsUXR5ID0gY2xpZW50ZXNCTy5yZWR1Y2UoKHMsIGMpID0+IHMgKyBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksIDApO1xuICAgIHJlc3VtZW5Sb3dzLnB1c2goe1xuICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgU0tVOiBza3UsXG4gICAgICBQcm9kdWN0bzogKHByb2QgJiYgKHByb2QubmFtZSB8fCBwcm9kLmRlc2NyaXB0aW9uKSkgfHwgJycsXG4gICAgICBGaXNpY29fRGVwMTE6IGZpc2ljb0RlcDExLFxuICAgICAgUXR5X0luZ3Jlc2FkYTogcXR5SW5ncmVzYWRhLFxuICAgICAgUXR5X1lhX0FzaWduYWRhOiBxdHlZYUFzaWduYWRhLFxuICAgICAgUXR5X0FfUmVwYXJ0aXI6IHF0eUFSZXBhcnRpcixcbiAgICAgIENsaWVudGVzX0VuX0NvbGE6IGNsaWVudGVzQk8ubGVuZ3RoLFxuICAgICAgQk9fVG90YWxfUXR5OiBib1RvdGFsUXR5LFxuICAgICAgRGV0ZWN0ZWRBdDogdHlwZW9mIGRldGVjdGVkQXQgPT09ICdzdHJpbmcnID8gZGV0ZWN0ZWRBdC5zbGljZSgwLCAxOSkucmVwbGFjZSgnVCcsICcgJykgOiAnJyxcbiAgICAgIFN0YXR1czogZGF0YS5zdGF0dXMgfHwgJycsXG4gICAgfSk7XG4gICAgZm9yIChjb25zdCBjIG9mIGNsaWVudGVzQk8pIHtcbiAgICAgIGxldCBmZWNoYVBlZCA9IGMucGVkaWRvQ3JlYXRlZEF0IHx8ICcnO1xuICAgICAgaWYgKGZlY2hhUGVkICYmIHR5cGVvZiBmZWNoYVBlZC50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmZWNoYVBlZCA9IGZlY2hhUGVkLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSAnJztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gVmVuZGVkb3I6IGJ1c2NhciBlbiBnbG9iYWxQZWRpZG9zIHBvciBwZWRpZG9JZC5cbiAgICAgIGxldCB2ZW5kZWRvciA9IGMudmVuZG9yS2V5IHx8ICcnO1xuICAgICAgaWYgKCF2ZW5kZWRvciAmJiBjLnBlZGlkb0lkKSB7XG4gICAgICAgIGNvbnN0IHAgPSBwZWRpZG9zLmZpbmQoKHgpID0+IHggJiYgeC5fZnNJZCA9PT0gYy5wZWRpZG9JZCk7XG4gICAgICAgIGlmIChwKSB2ZW5kZWRvciA9IHAub3duZXJWZW5kb3IgfHwgcC52ZW5kb3JBc3NpZ25lZCB8fCAnJztcbiAgICAgIH1cbiAgICAgIGNvbGFSb3dzLnB1c2goe1xuICAgICAgICBSZXBhcnRvX0lEOiBkb2MuaWQsXG4gICAgICAgIFNLVTogc2t1LFxuICAgICAgICBDbGllbnRlOiBjLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIENhcmRDb2RlOiBjLmNsaWVudENhcmRDb2RlIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IGMuY2xpZW50UHJvdmluY2UgfHwgJycsXG4gICAgICAgIExvY2FsaWRhZDogYy5jbGllbnRMb2NhbGl0eSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHZlbmRlZG9yLFxuICAgICAgICBRdHlfQk86IE51bWJlcihjLnF0eUJhY2tvcmRlciB8fCAwKSxcbiAgICAgICAgRmVjaGFfUGVkaWRvX09yaWdpbmFsOiB0eXBlb2YgZmVjaGFQZWQgPT09ICdzdHJpbmcnID8gZmVjaGFQZWQuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXN1bWVuUm93cy5zb3J0KChhLCBiKSA9PiBiLlF0eV9BX1JlcGFydGlyIC0gYS5RdHlfQV9SZXBhcnRpcik7XG4gIGNvbGFSb3dzLnNvcnQoXG4gICAgKGEsIGIpID0+XG4gICAgICAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpIHx8XG4gICAgICAoYS5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYV9QZWRpZG9fT3JpZ2luYWwgfHwgJycpXG4gICk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19QZW5kaWVudGVEZUFzaWduYWNpb25fUGFibG9fJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUmVzdW1lbiByZXBhcnRvJywgcm93czogcmVzdW1lblJvd3MgfSxcbiAgICB7IG5hbWU6ICdDbGllbnRlcyBlbiBjb2xhJywgcm93czogY29sYVJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUGFibG86ICcgKyByZXN1bWVuUm93cy5sZW5ndGggKyAnIHJlcGFydG9zIC8gJyArIGNvbGFSb3dzLmxlbmd0aCArICcgY2xpZW50ZXMgZW4gY29sYScsXG4gICAgMjgwMFxuICApO1xufTtcblxuLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc3VlbHZlIG5vbWJyZSBkZSBmYW50YXNpYSBwYXJhIHVuIHBlZGlkbyB1c2FuZG8gZWxcbi8vIG1pc21vIHBhdHRlcm4gcXVlIGxhcyBjYXJkcyBkZWwgbWFwYSAoaW5kZXguaHRtbDo5OTE1LTk5MzUpOlxuLy8gICAxKSBjbGllbnRNZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYSAoZWRpdGFkbyBkZXNkZSBlbCBtb2RhbCBjbGllbnRlKVxuLy8gICAyKSBhcHByb3ZlZEFsdGFzTGlzdFtdLmZhbnRhc2lhIG1hdGNoZWFkbyBwb3IgY29tZXJjaW8gPT0gY2xpZW50TmFtZVxuZnVuY3Rpb24gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKSB7XG4gIGNvbnN0IGNhcmRDb2RlID0gU3RyaW5nKHAuY2xpZW50Q2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgaWYgKGNhcmRDb2RlKSB7XG4gICAgY29uc3QgbWV0YSA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuY2xpZW50TWV0YTtcbiAgICBjb25zdCBjdXN0b20gPSBtZXRhICYmIG1ldGFbY2FyZENvZGVdICYmIG1ldGFbY2FyZENvZGVdLmN1c3RvbUZhbnRhc2lhO1xuICAgIGlmIChjdXN0b20gJiYgU3RyaW5nKGN1c3RvbSkudHJpbSgpKSByZXR1cm4gU3RyaW5nKGN1c3RvbSkudHJpbSgpO1xuICB9XG4gIGNvbnN0IGFsdGFzID0gLyoqIEB0eXBlIHthbnl9ICovIChnbG9iYWxUaGlzKS5hcHByb3ZlZEFsdGFzTGlzdDtcbiAgaWYgKEFycmF5LmlzQXJyYXkoYWx0YXMpKSB7XG4gICAgY29uc3QgbmFtZUxvd2VyID0gU3RyaW5nKHAuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChuYW1lTG93ZXIpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gYWx0YXMuZmluZCgoYSkgPT4ge1xuICAgICAgICBpZiAoIWEpIHJldHVybiBmYWxzZTtcbiAgICAgICAgY29uc3QgYyA9IFN0cmluZyhhLmNvbWVyY2lvIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZiA9IFN0cmluZyhhLmZhbnRhc2lhIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIGMgPT09IG5hbWVMb3dlciB8fCBmID09PSBuYW1lTG93ZXI7XG4gICAgICB9KTtcbiAgICAgIGlmIChtYXRjaCAmJiBtYXRjaC5mYW50YXNpYSAmJiBTdHJpbmcobWF0Y2guZmFudGFzaWEpLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnJztcbn1cblxuLy8gdjEyMzMgKDIwMjYtMTAtMDkpOiByZXBvcnRlIFwiVmVudGFzIHggYXJ0aWN1bG8geCBjbGllbnRlL3ZlbmRlZG9yXCIgdmlhIENGLlxuLy8gQWRtaW4vZ2VyZW50ZSBvbmx5LiBUYXJkYSB+MzAtNjBzIChCUSBxdWVyeSArIGV4Y2VsanMgYnVpbGQgc2VydmVyLXNpZGUpLlxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmVudGFzQXJ0Q2xpRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgaWYgKG1vbnRoSWR4ID09PSBudWxsIHx8IG1vbnRoSWR4ID09PSB1bmRlZmluZWQpIHtcbiAgICBhbGVydCgnRWxlZ1x1MDBFRCB1biBNRVMgZXNwZWNcdTAwRURmaWNvIChubyBcIlRvZG8gZWwgYVx1MDBGMW9cIikgXHUyMDE0IGVzdGUgcmVwb3J0ZSBlcyBtZW5zdWFsLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBtb250aElkeCB2aWVuZSAwLWJhc2VkIGRlc2RlIGVsIHBpY2tlciAoZW5lPTApLiBDRiBlc3BlcmEgMS1iYXNlZC5cbiAgY29uc3QgbW9udGggPSBtb250aElkeCArIDE7XG4gIGNvbnN0IHllYXIgPSBhbmlvO1xuICBjb25zdCBwZXJpb2RvID0gKHdpbmRvdy5NRVNFUyA/IHdpbmRvdy5NRVNFU1ttb250aElkeF0gOiBtb250aCkgKyAnICcgKyB5ZWFyO1xuICBjb25zdCBjb25maXJtTXNnID1cbiAgICAnR2VuZXJhciByZXBvcnRlIFwiVkVOVEFTIHggQVJUSUNVTE8geCBDTElFTlRFL1ZFTkRFRE9SXCIgZGUgJyArXG4gICAgcGVyaW9kbyArXG4gICAgJz9cXG5cXG4nICtcbiAgICAnRnVlbnRlOiBTQVAgdmlhIEJpZ1F1ZXJ5IChkYXRvcyBleGFjdG9zKS5cXG4nICtcbiAgICAnUHVlZGUgdGFyZGFyIDMwLTYwIHNlZ3VuZG9zLlxcbicgK1xuICAgICdBbCB0ZXJtaW5hciBzZSBkZXNjYXJnYSBhdXRvbWF0aWNhbWVudGUgZWwgeGxzeC4nO1xuICBpZiAoIWNvbmZpcm0oY29uZmlybU1zZykpIHJldHVybjtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyByZXBvcnRlIHNlcnZlci1zaWRlIChCUSkuLi4gcHVlZGUgdGFyZGFyIH42MHMnKTtcbiAgdHJ5IHtcbiAgICAvLyB2MTAwMCBwYXR0ZXJuOiByZWZyZXNoIElEVG9rZW4gYW50ZXMgZGUgY2FsbGFibGUgY3JpdGljby5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdSA9IHdpbmRvdy5maXJlYmFzZS5hdXRoICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoKCkuY3VycmVudFVzZXI7XG4gICAgICBpZiAodSAmJiB1LmdldElkVG9rZW4pIGF3YWl0IHUuZ2V0SWRUb2tlbih0cnVlKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgICBjb25zdCBjYWxsYWJsZSA9IHdpbmRvdy5maXJlYmFzZVxuICAgICAgLmFwcCgpXG4gICAgICAuZnVuY3Rpb25zKCdzb3V0aGFtZXJpY2EtZWFzdDEnKVxuICAgICAgLmh0dHBzQ2FsbGFibGUoJ2dlbmVyYXRlVmVudGFzUmVwb3J0Q0YnKTtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgY2FsbGFibGUoeyB5ZWFyLCBtb250aCB9KTtcbiAgICBjb25zdCByID0gKHJlc3AgJiYgcmVzcC5kYXRhKSB8fCB7fTtcbiAgICBpZiAoIXIub2sgfHwgIXIuYnl0ZXNCYXNlNjQpIHtcbiAgICAgIGFsZXJ0KCdDRiBkZXZvbHZpbyBlcnJvcjogJyArIChyLmVycm9yIHx8IEpTT04uc3RyaW5naWZ5KHIpKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIERlY29kZSBiYXNlNjQgXHUyMTkyIEJsb2IgXHUyMTkyIGRvd25sb2FkIHRyaWdnZXIuXG4gICAgY29uc3QgYmluID0gYXRvYihyLmJ5dGVzQmFzZTY0KTtcbiAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbi5sZW5ndGgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbi5jaGFyQ29kZUF0KGkpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnl0ZXNdLCB7XG4gICAgICB0eXBlOiByLm1pbWVUeXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID1cbiAgICAgIHIuZmlsZW5hbWUgfHxcbiAgICAgICd2ZW50YXNfeF9hcnRpY3Vsb19jbGllbnRlXycgKyB5ZWFyICsgJy0nICsgU3RyaW5nKG1vbnRoKS5wYWRTdGFydCgyLCAnMCcpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgICAgIGEucmVtb3ZlKCk7XG4gICAgfSwgMTAwMCk7XG4gICAgY29uc3Qgc3RhdHMgPSByLnN0YXRzIHx8IHt9O1xuICAgIHNob3dTeW5jVGFnKFxuICAgICAgJ09LOiAnICtcbiAgICAgICAgKHN0YXRzLnZlbnRhcyB8fCAwKSArXG4gICAgICAgICcgdmVudGFzIC8gJyArXG4gICAgICAgIChzdGF0cy5pdGVtcyB8fCAwKSArXG4gICAgICAgICcgU0tVcyAvICcgK1xuICAgICAgICAoc3RhdHMuY2xpZW50cyB8fCAwKSArXG4gICAgICAgICcgY2xpZW50ZXMnXG4gICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnRWZW50YXNBcnRDbGldIGVycm9yJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCByZXBvcnRlOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpKSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFBlZGlkb3MgZGVsIG1lcy4uLicpO1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IHNjb3BlID0gX2V4cG9ydFNjb3BlKCk7XG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgsIHNjb3BlKTtcbiAgZm9yIChjb25zdCBwIG9mIHBlZGlkb3MpIHtcbiAgICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkocC5saW5lcykgPyBwLmxpbmVzIDogW107XG4gICAgaWYgKCFsaW5lcy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZlY2hhID0gcC5jcmVhdGVkQXRcbiAgICAgID8gdHlwZW9mIHAuY3JlYXRlZEF0ID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHAuY3JlYXRlZEF0LnNsaWNlKDAsIDEwKVxuICAgICAgICA6IG5ldyBEYXRlKHAuY3JlYXRlZEF0LnRvRGF0ZSA/IHAuY3JlYXRlZEF0LnRvRGF0ZSgpIDogcC5jcmVhdGVkQXQpXG4gICAgICAgICAgICAudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgOiAnJztcbiAgICAvLyB2OTc1ICgyMDI2LTA5LTE3KTogcmVzb2x2ZXIgZmFudGFzaWEgdW5hIHZleiBwb3IgcGVkaWRvIChubyBwb3IgbGluZWEpIFx1MjAxNFxuICAgIC8vIGVsIGxvb2t1cCBlbiBjbGllbnRNZXRhICsgYXBwcm92ZWRBbHRhc0xpc3QgZXMgY29uc3RhbnRlIHBhcmEgdG9kbyBlbCBwZWRpZG8uXG4gICAgY29uc3Qgbm9tYnJlTG9jYWxGYW50YXNpYSA9IF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCk7XG4gICAgbGluZXMuZm9yRWFjaCgobCwgaWR4KSA9PiB7XG4gICAgICBpZiAoIWwpIHJldHVybjtcbiAgICAgIGNvbnN0IHF0eSA9IE51bWJlcihsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihsLnByaWNlQXRDcmVhdGlvbiB8fCBsLnByZWNpbyB8fCAwKTtcbiAgICAgIC8vIHYxNTY1ICgyMDI2LTExLTE4KTogOCBjb2x1bW5hcyBleGFjdGFzIHBvciBwZWRpZG8gTWFyaWFuby5cbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIEZFQ0hBX0RFX1BFRElETzogZmVjaGEsXG4gICAgICAgIENMSUVOVEU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgSURfUEVESURPOiBwLl9mc0lkIHx8ICcnLFxuICAgICAgICBTS1U6IGwuY29kZSB8fCAnJyxcbiAgICAgICAgTk9NQlJFX0RFTF9QUk9EVUNUTzogbC5kZXNjIHx8IGwubmFtZSB8fCAnJyxcbiAgICAgICAgQ0FOVElEQUQ6IHF0eSxcbiAgICAgICAgU1VCVE9UQUw6IE1hdGgucm91bmQocXR5ICogcHJlY2lvKSxcbiAgICAgICAgTE9DQUxJREFEOiBwLmxvY05hbWUgfHwgJycsXG4gICAgICB9KTtcbiAgICAgIC8vIHYxNTY1OiBub21icmVMb2NhbEZhbnRhc2lhICsgaWR4IHNpZ3VlbiBjb21wdXRhZG9zIChubyBleHBvcnRhZG9zKS5cbiAgICAgIHZvaWQgbm9tYnJlTG9jYWxGYW50YXNpYTtcbiAgICAgIHZvaWQgaWR4O1xuICAgICAgdm9pZCBzY29wZTtcbiAgICB9KTtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkZFQ0hBX0RFX1BFRElETyB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZFQ0hBX0RFX1BFRElETyB8fCAnJykpO1xuICBjb25zdCBmbmFtZSA9ICdQRURJRE9TIERFTCBNRVNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1BFRElET1MgREVMIE1FUycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFBlZGlkb3MgZGVsIG1lcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbi8vIEV4cG9ydGFyIHBhcmEgQW5hbGlzaXM6IHByb3RlZ2lkbyBjb24gUElOXG5jb25zdCBBTkFMSVNJU19QSU4gPSAnMTIzNSc7XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4cG9ydCBFeGNlbCBUQVJHRVRTLVpPTkFTIC0gc29sbyBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVBcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIGxhIGhvamEgQ0xJRU5URVNfWk9OQVMgY29uIFVOQSBmaWxhIHBvciBCUCBxdWUgZXN0YSB2aXZvIGVuIFNBUDpcbi8vIGN1YWxxdWllciBhbHRhIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgY29uIHN0YXR1cz0nYXBwcm92ZWQnIFkgY2FyZENvZGVTYXBcbi8vIGFzaWduYWRvLiBFeGNsdXllIFBPSU5UUyAvIGRpc3RyaWJ1aWRvcmVzIC8gcHJvc3BlY3RvcyAvIGFsdGFzIHNpblxuLy8gQ2FyZENvZGUgKG1vY2tzIG8gcGVuZGllbnRlcyBkZSBTQVApLiBFcyBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBmYWN0dXJhLlxuLy8gQ29sdW1uYXM6IFRJUE8sIE5STyBDVEUsIFJFR0lPTiwgUFJPVklOQ0lBLCBBU0VTT1IgRVhURVJOTywgQVNFU09SIElOVEVSTk8sXG4vLyBDQUxMRSwgTlVNRVJPLCBMT0NBTElEQUQsIENQLCBOT01CUkUgQ09NRVJDSUFMLCBOT01CUkUgREUgRkFOVEFTSUEsIENVSVQsXG4vLyBDT05ESUNJT04gRklTQ0FMLCBURUxFRk9OTywgQ0FSRENPREUgU0FQLlxud2luZG93LmV4cG9ydFRhcmdldHNab25hcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpY1x1MDBFMSB0dSBjb25leGlcdTAwRjNuIHkgcmVpbnRlbnRcdTAwRTEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGV4cG9ydGFyIGVsIG1hc3Rlci4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBUQVJHRVRTLVpPTkFTLi4uJyk7XG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gcmVnaW9uT2YocHJvdikge1xuICAgIGNvbnN0IHAgPSAocHJvdiB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICBpZiAoWydCVUVOT1MgQUlSRVMnLCAnQ0FQSVRBTCBGRURFUkFMJywgJ0xBIFBBTVBBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQlVFTk9TIEFJUkVTJztcbiAgICBpZiAoWydDT1JET0JBJywgJ1NBTiBMVUlTJywgJ01FTkRPWkEnLCAnU0FOIEpVQU4nLCAnTEEgUklPSkEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdDVVlPJztcbiAgICBpZiAoWydTQU5UQSBGRScsICdFTlRSRSBSSU9TJywgJ0NIQUNPJywgJ0NPUlJJRU5URVMnLCAnTUlTSU9ORVMnLCAnRk9STU9TQSddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdORUEnO1xuICAgIGlmIChbJ0pVSlVZJywgJ1NBTFRBJywgJ1RVQ1VNQU4nLCAnQ0FUQU1BUkNBJywgJ1NBTlRJQUdPIERFTCBFU1RFUk8nXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdOT0EnO1xuICAgIGlmIChbJ05FVVFVRU4nLCAnUklPIE5FR1JPJywgJ0NIVUJVVCcsICdTQU5UQSBDUlVaJywgJ1RJRVJSQSBERUwgRlVFR08nXS5pbmNsdWRlcyhwKSlcbiAgICAgIHJldHVybiAnUEFUQUdPTklBJztcbiAgICByZXR1cm4gJyc7XG4gIH1cbiAgZnVuY3Rpb24gdmVuZG9yTGFiZWxGb3JFeGNlbChrZXkpIHtcbiAgICBpZiAoIWtleSkgcmV0dXJuICcnO1xuICAgIGlmIChrZXkgPT09ICdfX0RJU1RSSUJVVE9SX18nKSByZXR1cm4gJ0RJU1RSSUJVSURPUkVTJztcbiAgICByZXR1cm4ga2V5O1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgbGV0IGFsdGFzU25hcDtcbiAgdHJ5IHtcbiAgICBhbHRhc1NuYXAgPSBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9PScsICdhcHByb3ZlZCcpXG4gICAgICAuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhcyBhcHJvYmFkYXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IHNraXBwZWROb1NhcCA9IDA7XG4gIGFsdGFzU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGNvbnN0IGNhcmRDb2RlID0gKGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICAvLyBGaWx0cm8gY2xhdmU6IHNvbG8gQlBzIGNvbiBDYXJkQ29kZSBTQVAgYXNpZ25hZG8gKD0gaGFiaWxpdGFkbyBlbiBTQVApLlxuICAgIGlmICghY2FyZENvZGUpIHtcbiAgICAgIHNraXBwZWROb1NhcCsrO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBwcm92aW5jZSA9IChhLnByb3ZpbmNpYSB8fCAnJykudG9VcHBlckNhc2UoKS50cmltKCk7XG4gICAgY29uc3QgbG9jYWxpdHlGaW5hbCA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgVElQTzogJ0RBRE8gREUgQUxUQScsXG4gICAgICAnTlJPIENURSc6IDAsIC8vIHNlIHJlbnVtZXJhIGRlc3B1ZXMgZGVsIHNvcnRcbiAgICAgIFJFR0lPTjogcmVnaW9uT2YocHJvdmluY2UpLFxuICAgICAgUFJPVklOQ0lBOiBwcm92aW5jZSxcbiAgICAgICdBU0VTT1IgRVhURVJOTyc6IHZlbmRvckxhYmVsRm9yRXhjZWwodmVuZG9yKSxcbiAgICAgICdBU0VTT1IgSU5URVJOTyc6IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJyxcbiAgICAgIENBTExFOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTlVNRVJPOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExPQ0FMSURBRDogbG9jYWxpdHlGaW5hbCxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgJ05PTUJSRSBDT01FUkNJQUwnOiBhLmNvbWVyY2lvIHx8IGEudGl0dWxhciB8fCAnJyxcbiAgICAgICdOT01CUkUgREUgRkFOVEFTSUEnOiBhLmZhbnRhc2lhIHx8ICcnLFxuICAgICAgQ1VJVDogYS5jdWl0IHx8ICcnLFxuICAgICAgJ0NPTkRJQ0lPTiBGSVNDQUwnOiBhLmNvbmRpY2lvbkZpc2NhbCB8fCAnJyxcbiAgICAgIFRFTEVGT05POiBhLnRlbGVmb25vIHx8ICcnLFxuICAgICAgJ0NBUkRDT0RFIFNBUCc6IGNhcmRDb2RlLFxuICAgIH0pO1xuICB9KTtcbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBoYWJpbGl0YWRvcyBlbiBTQVAgdG9kYXZpYS5cXG5cXG5VbmEgYWx0YSBlbnRyYSBhbCBleHBvcnQgc29sbyBjdWFuZG8gdGllbmUgQ2FyZENvZGUgU0FQIGFzaWduYWRvLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKHIxLCByMikgPT4ge1xuICAgIGNvbnN0IHAgPSAocjEuUFJPVklOQ0lBIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLlBST1ZJTkNJQSB8fCAnJyk7XG4gICAgaWYgKHAgIT09IDApIHJldHVybiBwO1xuICAgIGNvbnN0IGwgPSAocjEuTE9DQUxJREFEIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyLkxPQ0FMSURBRCB8fCAnJyk7XG4gICAgaWYgKGwgIT09IDApIHJldHVybiBsO1xuICAgIHJldHVybiAocjFbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJykubG9jYWxlQ29tcGFyZShyMlsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKTtcbiAgfSk7XG4gIHJvd3MuZm9yRWFjaCgociwgaSkgPT4ge1xuICAgIHJbJ05STyBDVEUnXSA9IGkgKyAxO1xuICB9KTtcbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCAoZXN0aWxvIHZlcmRlIHVuaWZvcm1lKS5cbiAgY29uc3QgdHMgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBhd2FpdCBkb3dubG9hZFhsc3goJ1RBUkdFVFNfVkVOREVET1JFU19aT05BU18nICsgdHMgKyAnLnhsc3gnLCBbXG4gICAgeyBuYW1lOiAnQ0xJRU5URVNfWk9OQVMnLCByb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhjZWwgZXhwb3J0YWRvOiAnICtcbiAgICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgU0FQIGhhYmlsaXRhZG9zJyArXG4gICAgICAoc2tpcHBlZE5vU2FwID4gMCA/ICcgKCcgKyBza2lwcGVkTm9TYXAgKyAnIHNpbiBDYXJkQ29kZSBkZXNjYXJ0YWRvcyknIDogJycpXG4gICk7XG59O1xuXG53aW5kb3cub3BlbkV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcGluID0gcHJvbXB0KFxuICAgICdFc3RhIHNlY2Npb24gY29udGllbmUgZm9ybWF0b3MgYXZhbnphZG9zIChQb3dlciBCSSwgUHl0aG9uL01MLCBaSVAgZGUgZm90b3MpIGRlc3RpbmFkb3MgYSBhbmFsaXNpcyB0ZWNuaWNvLlxcblxcbkluZ3Jlc2EgZWwgUElOIHBhcmEgY29udGludWFyOidcbiAgKTtcbiAgaWYgKHBpbiA9PT0gbnVsbCkgcmV0dXJuO1xuICBpZiAocGluICE9PSBBTkFMSVNJU19QSU4pIHtcbiAgICBhbGVydCgnUElOIGluY29ycmVjdG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE9wY2lvbiBJbnRlZ3JhY2lvbiBTQVA6IHNvbG8gcGFyYSBNYXJpYW5vIChlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSlcbiAgY29uc3Qgc2FwT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtc2FwLWludGVncmF0aW9uJyk7XG4gIGlmIChzYXBPcHQpIHtcbiAgICBjb25zdCBpc01hcmlhbm8gPVxuICAgICAgY3VycmVudFVzZXIgJiYgKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nO1xuICAgIHNhcE9wdC5zdHlsZS5kaXNwbGF5ID0gaXNNYXJpYW5vID8gJycgOiAnbm9uZSc7XG4gIH1cbiAgLy8gT3BjaW9uIEJhY2t1cCBtZW5zdWFsOiBzb2xvIGFkbWluXG4gIGNvbnN0IGJrT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtYmFja3VwLW1lbnN1YWwnKTtcbiAgaWYgKGJrT3B0KSBia09wdC5zdHlsZS5kaXNwbGF5ID0gdXNlclJvbGUgPT09ICdhZG1pbicgPyAnJyA6ICdub25lJztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VFeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1hbmFsaXNpcy1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXG4vLyBIZWxwZXJzIGludGVybm9zIChkb3dubG9hZFhsc3gsIGV4cG9ydFZlbnRhc0Zvck1vbnRoLCBldGMuKSBzb24gY29uc3VtaWRvc1xuLy8gc29sbyBkZW50cm8gZGUgZXN0ZSBibG9xdWUgKHZlcmlmaWNhZG8gcHJlLWV4dHJhY2NpXHUwMEYzbikuXG5cbi8vIHYxMzk2ICgyMDI2LTEwLTIxKTogYXZpc28gYWwgY2xpY2sgcGFyYSBcIlZlbnRhcyBcdTAwRDcgYXJ0XHUwMEVEY3VsbyBcdTAwRDcgY2xpZW50ZVwiLlxuLy8gQWRtaW4vZ2VyZW50ZSBvbmx5LiBUYXJkYSAzMC02MHMuIEFudGVzIGxhIG5vdGEgZXN0YWJhIGVuIGxhIGRlc2NyaXBjaVx1MDBGM24gZGVsXG4vLyBsaXN0YWRvIGRlbCBtb2RhbDsgYWhvcmEgZWwgbGlzdGFkbyBzb2xvIG11ZXN0cmEgaWNvbm8gKyB0aXR1bG8uXG53aW5kb3cuX3ZlbnRhc0FydENsaUNsaWNrID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3Qgcm9sZSA9IHcudXNlclJvbGUgfHwgJyc7XG4gIGlmIChyb2xlICE9PSAnYWRtaW4nICYmIHJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdFc3RlIHJlcG9ydGUgZXMgc29sbyBwYXJhIGFkbWluIC8gZ2VyZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgb2sgPSBjb25maXJtKFxuICAgICdSZXBvcnRlIHNlcnZlci1zaWRlIChCaWdRdWVyeSkuIFRhcmRhIDMwLTYwIHNlZ3VuZG9zIHkgZGVzY2FyZ2EgdW4gLnhsc3ggY29uIDQgaG9qYXM6XFxuJyArXG4gICAgICAnICBcdTIwMjIgUHJvZHVjdG9zIHZlbmRpZG9zIHBvciBWREVcXG4nICtcbiAgICAgICcgIFx1MjAyMiBQcm9kdWN0b3MgTk8gdmVuZGlkb3MgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIENsaWVudGVzIENPTiBjb21wcmEgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIENsaWVudGVzIFNJTiBjb21wcmEgcG9yIFZERVxcblxcbicgK1xuICAgICAgJ0NvbnRpbnVhcj8nXG4gICk7XG4gIGlmICghb2spIHJldHVybjtcbiAgaWYgKHR5cGVvZiB3LmNsb3NlRXhwb3J0RGlhbG9nID09PSAnZnVuY3Rpb24nKSB3LmNsb3NlRXhwb3J0RGlhbG9nKCk7XG4gIGlmICh0eXBlb2Ygdy5zaG93TW9udGhQaWNrZXIgPT09ICdmdW5jdGlvbicpIHcuc2hvd01vbnRoUGlja2VyKCdWRU5UQVNfQVJUX0NMSScpO1xufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQXdETyxXQUFTLGNBQWMsR0FBRztBQUMvQixXQUFPLE9BQU8sS0FBSyxFQUFFLEVBQ2xCLEtBQUssRUFDTCxZQUFZO0FBQUEsRUFDakI7QUFTQSxXQUFTLGFBQWEsR0FBRyxTQUFTO0FBQ2hDLFFBQUksQ0FBQyxLQUFLLE9BQU8sWUFBWSxXQUFZLFFBQU8sRUFBRSxXQUFXLElBQUksUUFBUSxlQUFlO0FBQ3hGLFFBQUk7QUFDRixZQUFNLElBQUksUUFBUSxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsR0FBRyxPQUFPLEVBQUUsY0FBYyxFQUFFLENBQUM7QUFDNUUsVUFBSSxLQUFLLE9BQU8sTUFBTSxVQUFVO0FBQzlCLGVBQU8sRUFBRSxXQUFXLGNBQWMsRUFBRSxTQUFTLEdBQUcsUUFBUSxPQUFPLEVBQUUsVUFBVSxFQUFFLEVBQUU7QUFBQSxNQUNqRjtBQUNBLGFBQU8sRUFBRSxXQUFXLGNBQWMsQ0FBQyxHQUFHLFFBQVEsR0FBRztBQUFBLElBQ25ELFNBQVMsSUFBSTtBQUNYLGFB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SUFDbEYsQ0FBQztBQUNELFNBQUssUUFBUSxDQUFDLEdBQUcsTUFBTTtBQUNyQixRQUFFLFNBQVMsSUFBSSxJQUFJO0FBQUEsSUFDckIsQ0FBQztBQUVELFVBQU0sTUFBSyxvQkFBSSxLQUFLLEdBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQy9DLFVBQU0sYUFBYSw4QkFBOEIsS0FBSyxTQUFTO0FBQUEsTUFDN0QsRUFBRSxNQUFNLGtCQUFrQixLQUFLO0FBQUEsSUFDakMsQ0FBQztBQUNEO0FBQUEsTUFDRSxzQkFDRSxLQUFLLFNBQ0wsK0JBQ0MsZUFBZSxJQUFJLE9BQU8sZUFBZSwrQkFBK0I7QUFBQSxJQUM3RTtBQUFBLEVBQ0Y7QUFFQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFFBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsWUFBTSxpRkFBaUY7QUFDdkY7QUFBQSxJQUNGO0FBQ0EsVUFBTSxNQUFNO0FBQUEsTUFDVjtBQUFBLElBQ0Y7QUFDQSxRQUFJLFFBQVEsS0FBTTtBQUNsQixRQUFJLFFBQVEsY0FBYztBQUN4QixZQUFNLGlCQUFpQjtBQUN2QjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFNBQVMsU0FBUyxlQUFlLHlCQUF5QjtBQUNoRSxRQUFJLFFBQVE7QUFDVixZQUFNLFlBQ0osZ0JBQWdCLFlBQVksU0FBUyxJQUFJLFlBQVksTUFBTTtBQUM3RCxhQUFPLE1BQU0sVUFBVSxZQUFZLEtBQUs7QUFBQSxJQUMxQztBQUVBLFVBQU0sUUFBUSxTQUFTLGVBQWUsd0JBQXdCO0FBQzlELFFBQUksTUFBTyxPQUFNLE1BQU0sVUFBVSxhQUFhLFVBQVUsS0FBSztBQUM3RCxhQUFTLGVBQWUsdUJBQXVCLEVBQUUsVUFBVSxJQUFJLE1BQU07QUFBQSxFQUN2RTtBQUNBLFNBQU8sc0JBQXNCLFdBQVk7QUFDdkMsYUFBUyxlQUFlLHVCQUF1QixFQUFFLFVBQVUsT0FBTyxNQUFNO0FBQUEsRUFDMUU7QUFTQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFVBQU07QUFBQTtBQUFBLE1BQXdCLE9BQU8sV0FBVyxjQUFjLFNBQVMsQ0FBQztBQUFBO0FBQ3hFLFVBQU0sT0FBTyxFQUFFLFlBQVk7QUFDM0IsUUFBSSxTQUFTLFdBQVcsU0FBUyxXQUFXO0FBQzFDLFlBQU0sNENBQTRDO0FBQ2xEO0FBQUEsSUFDRjtBQUNBLFVBQU0sS0FBSztBQUFBLE1BQ1Q7QUFBQSxJQU1GO0FBQ0EsUUFBSSxDQUFDLEdBQUk7QUFDVCxRQUFJLE9BQU8sRUFBRSxzQkFBc0IsV0FBWSxHQUFFLGtCQUFrQjtBQUNuRSxRQUFJLE9BQU8sRUFBRSxvQkFBb0IsV0FBWSxHQUFFLGdCQUFnQixnQkFBZ0I7QUFBQSxFQUNqRjsiLAogICJuYW1lcyI6IFsidyIsICJmYkRiIiwgIlBST0RVQ1RTIl0KfQo=
