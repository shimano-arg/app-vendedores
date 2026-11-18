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
    const ultimaVisitaIdx = /* @__PURE__ */ new Map();
    try {
      const vSnap = await fbDb.collection("visits").get();
      vSnap.forEach((d) => {
        const v = d.data() || {};
        const cc = String(v.cardCode || v.clientCardCode || "").trim().toUpperCase();
        if (!cc) return;
        const raw = v.fecha || v.date || v.visitDate || v.createdAt || v.timestamp || null;
        let fechaIso = null;
        try {
          if (!raw) fechaIso = null;
          else if (typeof raw === "string") fechaIso = raw;
          else if (raw && typeof raw.toDate === "function") fechaIso = raw.toDate().toISOString();
          else if (raw && typeof raw.seconds === "number") fechaIso = new Date(raw.seconds * 1e3).toISOString();
        } catch {
          fechaIso = null;
        }
        if (!fechaIso) return;
        const prev = ultimaVisitaIdx.get(cc);
        if (!prev || String(fechaIso) > String(prev)) ultimaVisitaIdx.set(cc, fechaIso);
      });
    } catch (_eVisits) {
      console.warn("[masterfile] visits no cargado:", _eVisits && _eVisits.message);
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
      // v1566: formato DD/MM/YYYY desde el max(fecha) agregado en ultimaVisitaIdx.
      "ULTIMA_VISITA/CONTACTO_FECHA": (() => {
        const cc = String(r["CardCode SAP"] || "").trim().toUpperCase();
        const iso = cc ? ultimaVisitaIdx.get(cc) : null;
        if (!iso) return "";
        try {
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return "";
          return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
        } catch {
          return "";
        }
      })()
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
    const avg3MIdx = /* @__PURE__ */ new Map();
    try {
      const now = Date.now();
      const DAY_MS = 864e5;
      const _arrAll = typeof globalPedidos !== "undefined" && Array.isArray(globalPedidos) ? globalPedidos : [];
      const qtySum90 = /* @__PURE__ */ new Map();
      for (const p of _arrAll) {
        if (!p || !Array.isArray(p.lines)) continue;
        const _rawDate = p.transferidoSAP && (p.transferidoSAP.docDate || p.transferidoSAP.date) || p.sapInvoiceDate || p.closedAt || p.confirmedAt || null;
        if (!_rawDate) continue;
        let ms = null;
        try {
          if (typeof _rawDate === "string") ms = new Date(_rawDate).getTime();
          else if (_rawDate && typeof _rawDate.toDate === "function") ms = _rawDate.toDate().getTime();
          else if (_rawDate && typeof _rawDate.seconds === "number") ms = _rawDate.seconds * 1e3;
        } catch {
          ms = null;
        }
        if (!ms || Number.isNaN(ms)) continue;
        if (now - ms > 90 * DAY_MS) continue;
        for (const l of p.lines) {
          if (!l || !l.code) continue;
          const st = l.state || "";
          if (st === "BO" || st === "ASIG") continue;
          const q = Number(l.qty) || 0;
          if (q <= 0) continue;
          const sku = String(l.code).trim().toUpperCase();
          qtySum90.set(sku, (qtySum90.get(sku) || 0) + q);
        }
      }
      for (const [sku, total] of qtySum90) {
        avg3MIdx.set(sku, Math.round(total / 3 * 10) / 10);
      }
    } catch (_eAvg) {
      console.warn("[backorder] no se pudo computar PROMEDIO_VENTA_3M:", _eAvg && _eAvg.message);
    }
    const rowsSku = [];
    for (const [sku, agg] of skuAgg) {
      rowsSku.push({
        SKU: sku,
        CANTIDAD_BACKORDER: agg.qty,
        SUBTOTAL: Math.round(agg.sub),
        PROMEDIO_VENTA_3M: avg3MIdx.get(String(sku).trim().toUpperCase()) || 0
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzIiwgIi4uL3NyYy9kb21haW5zL2V4cG9ydHMtY29yZS5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIHYxNTM0ICgyMDI2LTExLTAyKSBcdTIwMTQgQWxjYW5jZSBwb3Igcm9sIGRlIGxhcyBleHBvcnRhY2lvbmVzIGRlbCBtb2RhbFxuICogXCJSZXBvcnRlcyBFeGNlbFwiIChhdWRpdG9yXHUwMEVEYSBkb2NzL2F1ZGl0b3JpYS80NiwgRXRhcGEgMSkuXG4gKlxuICogUmVnbGFzIChkZWNpc2lvbmVzIGRlIE1hcmlhbm8pOlxuICogICAtIFwiTG9zIGNsaWVudGVzIGRlIHVuIHZlbmRlZG9yXCIgPSBlbCBtYXN0ZXIgQUNUVUFMIGRlbCBjbGllbnRlIChQT0lOVFMgK1xuICogICAgIHZlbmRvcl9vdmVycmlkZXMgKyBhcHByb3ZlZEFsdGFzLCBDTEFVREUubWQgXHUwMEE3NDYvXHUwMEE3NTApLiBOTyBlbCB2ZW5kZWRvclxuICogICAgIHF1ZSBxdWVkXHUwMEYzIGd1YXJkYWRvIGVuIGVsIHBlZGlkbyAoYXNzaWduZWRWZW5kb3JVaWQgc2UgZ3JhYmEgYWwgY3JlYXIgeVxuICogICAgIG5vIHNlIHJlLXNpbmNyb25pemEgY3VhbmRvIGNhbWJpYSBlbCBtYXN0ZXIpLlxuICogICAtIFZlbmRlZG9yIChWREUpOiB1biBwZWRpZG8gZW50cmEgc29sbyBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1XG4gKiAgICAgY2xpZW50ZSBlcyBlbCBzdXlvIFkgYWRlbVx1MDBFMXMgYGFzc2lnbmVkVmVuZG9yVWlkID09PSBteVVpZGAgKGRlZmVuc2EgZW5cbiAqICAgICBwcm9mdW5kaWRhZDogYG15VWlkYCBzYWxlIGRlIEZpcmViYXNlIEF1dGgsIG5vIGRlIGB1c2VyUm9sZWApLlxuICogICAtIEludGVybm8gKFZESSk6IHVuIHBlZGlkbyBlbnRyYSBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1IGNsaWVudGVcbiAqICAgICBlc3RcdTAwRTEgZW4gc3UgY29uanVudG8gZGUgdmVuZGVkb3JlcyAoc3Ugem9uYSArIHN1cyBwYXJlamFzLCBlbCBtaXNtbyBxdWVcbiAqICAgICB1c2EgZWwgbWFwYTogZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cyAvIGdldEVmZmVjdGl2ZVZlbmRvclNldCgnQUxMJykpLlxuICogICAtIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS4gT3RybyByb2wgbyBzaW4gcm9sOiBuYWRhLlxuICogICAtIFZpc2l0YXM6IGVsIHZlbmRlZG9yIHZlIHNvbG8gbGFzIHF1ZSBjYXJnXHUwMEYzIFx1MDBFOWwgKGBvd25lclVpZCA9PT0gbXlVaWRgKTtcbiAqICAgICBlbCBpbnRlcm5vIHZlIGxhcyBzdXlhcyArIGxhcyBkZSBzdXMgcGFyZWphcyAocG9yIGBvd25lclVpZGAgZGUgdW5hXG4gKiAgICAgcGFyZWphLCBwb3IgYGNyZWF0ZWRCeVVpZGAgcHJvcGlvIG8gcG9yIGB2ZW5kb3JgIFx1MjIwOCBzdSBjb25qdW50bykuXG4gKlxuICogU29sbyB1biBwcm9zcGVjdG8gc2luIENhcmRDb2RlIFNBUCBjYWUgYWwgYHZlbmRvckFzc2lnbmVkYCBndWFyZGFkbyBlbiBlbFxuICogcGVkaWRvLiBVbiBDYXJkQ29kZSBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlLCBvIHVuYSB6b25hIHNpbiB2ZW5kZWRvcixcbiAqIHF1ZWRhIGZ1ZXJhIGRlbCBhbGNhbmNlIGRlIHZlbmRlZG9yIGUgaW50ZXJuby4gYG93bmVyVmVuZG9yYCAoPSBxdWlcdTAwRTluIGxvXG4gKiBjYXJnXHUwMEYzLCBsZWdhY3kpIE5PIHNlIHVzYSBwYXJhIGRlY2lkaXIgZWwgYWxjYW5jZTsgc29sbyBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc29cbiAqIHBhcmEgbGEgY29sdW1uYSBcIlZlbmRlZG9yXCIgZGVsIEV4Y2VsLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYgeyhjYXJkQ29kZTogc3RyaW5nLCBjbGllbnROYW1lOiBzdHJpbmcpID0+IChzdHJpbmd8e3ZlbmRvcktleT86IHN0cmluZywgcmVhc29uPzogc3RyaW5nfSl9IFJlc29sdmVWZW5kb3JGb3JDbGllbnRcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IEV4cG9ydFNjb3BlQXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd8bnVsbHx1bmRlZmluZWR9IHJvbGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfG51bGx8dW5kZWZpbmVkfSBbbXlVaWRdXG4gKiBAcHJvcGVydHkge3N0cmluZ3xudWxsfHVuZGVmaW5lZH0gW215VmVuZG9yS2V5XVxuICogQHByb3BlcnR5IHtTZXQ8c3RyaW5nPnxBcnJheTxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbZWZmZWN0aXZlVmVuZG9yU2V0XVxuICogQHByb3BlcnR5IHtBcnJheTxzdHJpbmc+fFNldDxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbcGFydG5lclVpZHNdXG4gKiBAcHJvcGVydHkge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlVmVuZG9yRm9yQ2xpZW50XVxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gRXhwb3J0U2NvcGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNHbG9iYWxcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdmlzaXRzUXVlcnlCeU93bmVyVWlkIC0gdHJ1ZTogY29uc3VsdGFyIHZpc2l0cyBjb24gd2hlcmUoJ293bmVyVWlkJywnPT0nLHVpZCkuXG4gKiBAcHJvcGVydHkgeyhwZWRpZG9zOiBBcnJheTxhbnk+KSA9PiBBcnJheTxhbnk+fSBmaWx0ZXJQZWRpZG9zXG4gKiBAcHJvcGVydHkgeyh2aXNpdHM6IEFycmF5PGFueT4pID0+IEFycmF5PGFueT59IGZpbHRlclZpc2l0c1xuICogQHByb3BlcnR5IHsocDogYW55KSA9PiBzdHJpbmd9IHZlbmRvckNvbHVtbkZvclBlZGlkb1xuICovXG5cbi8qKlxuICogTm9ybWFsaXphIHVuIHZlbmRvcktleTogdHJpbSArIG1heVx1MDBGQXNjdWxhcy5cbiAqIEBwYXJhbSB7YW55fSBrXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybVZlbmRvcktleShrKSB7XG4gIHJldHVybiBTdHJpbmcoayB8fCAnJylcbiAgICAudHJpbSgpXG4gICAgLnRvVXBwZXJDYXNlKCk7XG59XG5cbi8qKlxuICogUmVzdWx0YWRvIGRlbCBtYXN0ZXIgcGFyYSBlbCBjbGllbnRlIGRlbCBwZWRpZG8uIEFjZXB0YSB1biByZXNvbHZlciBxdWVcbiAqIGRldnVlbHZlIHN0cmluZyAodmVuZG9yS2V5KSBvIHt2ZW5kb3JLZXksIHJlYXNvbn0uXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fHVuZGVmaW5lZH0gcmVzb2x2ZVxuICogQHJldHVybnMge3t2ZW5kb3JLZXk6IHN0cmluZywgcmVhc29uOiBzdHJpbmd9fVxuICovXG5mdW5jdGlvbiBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSkge1xuICBpZiAoIXAgfHwgdHlwZW9mIHJlc29sdmUgIT09ICdmdW5jdGlvbicpIHJldHVybiB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gcmVzb2x2ZShTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJyksIFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpKTtcbiAgICBpZiAociAmJiB0eXBlb2YgciA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiB7IHZlbmRvcktleTogbm9ybVZlbmRvcktleShyLnZlbmRvcktleSksIHJlYXNvbjogU3RyaW5nKHIucmVhc29uIHx8ICcnKSB9O1xuICAgIH1cbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6IG5vcm1WZW5kb3JLZXkociksIHJlYXNvbjogJycgfTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgfVxufVxuXG4vKipcbiAqIFZlbmRlZG9yIHF1ZSBkZWZpbmUgZWwgYWxjYW5jZSBkZWwgcGVkaWRvOlxuICogICAtIGVsIGRlbCBtYXN0ZXIgYWN0dWFsLCBzaSByZXN1ZWx2ZTtcbiAqICAgLSB6b25hIHNpbiB2ZW5kZWRvciAoaW5jbHVpZG8gZGlzdHJpYnVpZG9yKTogJycgKGVsIG1hc3RlciBtYW5kYSk7XG4gKiAgIC0gcHJvc3BlY3RvIHNpbiBDYXJkQ29kZSBTQVA6IGVsIGB2ZW5kb3JBc3NpZ25lZGAgZ3VhcmRhZG8gZW4gZWwgcGVkaWRvO1xuICogICAtIENhcmRDb2RlIFNBUCBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlOiAnJyAoZmFsbGEgY2VycmFkbykuIEVqLjogdW4gYWx0YVxuICogICAgIHJlYXNpZ25hZGEgYSBvdHJvIHZlbmRlZG9yIGRlc2FwYXJlY2UgZGVsIGFwcHJvdmVkQWx0YXNMaXN0IGRlbCBWREUgeVxuICogICAgIGVsIGB2ZW5kb3JBc3NpZ25lZGAgdmllam8gbm8gdGllbmUgcXVlIHZvbHZlciBhIG1ldGVybGEuXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fSBbcmVzb2x2ZV1cbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpIHtcbiAgaWYgKCFwKSByZXR1cm4gJyc7XG4gIGNvbnN0IG0gPSBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSk7XG4gIGlmIChtLnZlbmRvcktleSkgcmV0dXJuIG0udmVuZG9yS2V5O1xuICBpZiAobS5yZWFzb24gPT09ICd6b25hX3Npbl92ZW5kZWRvcicpIHJldHVybiAnJztcbiAgaWYgKCFTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpKSByZXR1cm4gbm9ybVZlbmRvcktleShwLnZlbmRvckFzc2lnbmVkKTtcbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFZhbG9yIGRlIGxhIGNvbHVtbmEgXCJWZW5kZWRvclwiIGRlbCBFeGNlbCBkZSBQZWRpZG9zIGRlbCBtZXM6IG1hc3RlciBhY3R1YWwsXG4gKiBkZXNwdVx1MDBFOXMgYHZlbmRvckFzc2lnbmVkYCwgeSBgb3duZXJWZW5kb3JgIHNvbG8gc2kgbm8gaGF5IG90cmEgY29zYS5cbiAqIEBwYXJhbSB7YW55fSBwXG4gKiBAcGFyYW0ge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlXVxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKSB7XG4gIGlmICghcCkgcmV0dXJuICcnO1xuICBjb25zdCBtID0gbWFzdGVyTG9va3VwKHAsIHJlc29sdmUpO1xuICBpZiAobS52ZW5kb3JLZXkpIHJldHVybiBtLnZlbmRvcktleTtcbiAgLy8gWm9uYSBzaW4gdmVuZGVkb3I6IGxhIGNvbHVtbmEgcXVlZGEgdmFjXHUwMEVEYSAobm8gc2UgbXVlc3RyYSBlbCB2ZW5kZWRvciB2aWVqbykuXG4gIGlmIChtLnJlYXNvbiA9PT0gJ3pvbmFfc2luX3ZlbmRlZG9yJykgcmV0dXJuICcnO1xuICByZXR1cm4gU3RyaW5nKHAudmVuZG9yQXNzaWduZWQgfHwgJycpLnRyaW0oKSB8fCBTdHJpbmcocC5vd25lclZlbmRvciB8fCAnJykudHJpbSgpO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7U2V0PHN0cmluZz58QXJyYXk8c3RyaW5nPnxudWxsfHVuZGVmaW5lZH0gc1xuICogQHJldHVybnMge1NldDxzdHJpbmc+fG51bGx9XG4gKi9cbmZ1bmN0aW9uIHRvTm9ybVNldChzKSB7XG4gIGlmICghcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG91dCA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBrIG9mIC8qKiBAdHlwZSB7SXRlcmFibGU8c3RyaW5nPn0gKi8gKHMpKSB7XG4gICAgY29uc3QgbiA9IG5vcm1WZW5kb3JLZXkoayk7XG4gICAgaWYgKG4pIG91dC5hZGQobik7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBBcm1hIGxvcyBmaWx0cm9zIGRlIGV4cG9ydGFjaVx1MDBGM24gcGFyYSBlbCByb2wgZGVsIHVzdWFyaW8uXG4gKiBAcGFyYW0ge0V4cG9ydFNjb3BlQXJnc30gYXJnc1xuICogQHJldHVybnMge0V4cG9ydFNjb3BlfVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRFeHBvcnRTY29wZShhcmdzKSB7XG4gIGNvbnN0IGEgPSBhcmdzIHx8IC8qKiBAdHlwZSB7RXhwb3J0U2NvcGVBcmdzfSAqLyAoeyByb2xlOiBudWxsIH0pO1xuICBjb25zdCByb2xlID0gU3RyaW5nKGEucm9sZSB8fCAnJyk7XG4gIGNvbnN0IG15VWlkID0gU3RyaW5nKGEubXlVaWQgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgbXlLZXkgPSBub3JtVmVuZG9yS2V5KGEubXlWZW5kb3JLZXkpO1xuICBjb25zdCByZXNvbHZlID1cbiAgICB0eXBlb2YgYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50ID09PSAnZnVuY3Rpb24nID8gYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50IDogdW5kZWZpbmVkO1xuICAvKiogQHBhcmFtIHthbnl9IHAgKi9cbiAgY29uc3QgdmVuZG9yQ29sdW1uID0gKHApID0+IHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKTtcbiAgLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gYXJyICovXG4gIGNvbnN0IGNvbXBhY3QgPSAoYXJyKSA9PiAoQXJyYXkuaXNBcnJheShhcnIpID8gYXJyLmZpbHRlcihCb29sZWFuKSA6IFtdKTtcblxuICBpZiAocm9sZSA9PT0gJ3ZlbmRlZG9yJykge1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IHRydWUsXG4gICAgICB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG86IHZlbmRvckNvbHVtbixcbiAgICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IHtcbiAgICAgICAgaWYgKCFteVVpZCB8fCAhbXlLZXkpIHJldHVybiBbXTtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QoYXJyKS5maWx0ZXIoXG4gICAgICAgICAgKHApID0+XG4gICAgICAgICAgICBTdHJpbmcocC5hc3NpZ25lZFZlbmRvclVpZCB8fCAnJykgPT09IG15VWlkICYmXG4gICAgICAgICAgICByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpID09PSBteUtleVxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIGZpbHRlclZpc2l0czogKGFycikgPT4ge1xuICAgICAgICBpZiAoIW15VWlkKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKCh2KSA9PiBTdHJpbmcodi5vd25lclVpZCB8fCAnJykgPT09IG15VWlkKTtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmIChyb2xlID09PSAnaW50ZXJubycpIHtcbiAgICBjb25zdCBzZXQgPSB0b05vcm1TZXQoYS5lZmZlY3RpdmVWZW5kb3JTZXQpO1xuICAgIGNvbnN0IHBhcnRuZXJzID0gbmV3IFNldChcbiAgICAgIEFycmF5LmZyb20oLyoqIEB0eXBlIHtJdGVyYWJsZTxzdHJpbmc+fSAqLyAoYS5wYXJ0bmVyVWlkcyB8fCBbXSkpXG4gICAgICAgIC5tYXAoKHUpID0+IFN0cmluZyh1IHx8ICcnKS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoYXJyKSA9PiB7XG4gICAgICAgIGlmICghc2V0IHx8IHNldC5zaXplID09PSAwKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKChwKSA9PiB7XG4gICAgICAgICAgY29uc3QgayA9IHJlc29sdmVQZWRpZG9WZW5kb3JLZXkocCwgcmVzb2x2ZSk7XG4gICAgICAgICAgcmV0dXJuICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+XG4gICAgICAgIGNvbXBhY3QoYXJyKS5maWx0ZXIoKHYpID0+IHtcbiAgICAgICAgICBjb25zdCBvd25lciA9IFN0cmluZyh2Lm93bmVyVWlkIHx8ICcnKTtcbiAgICAgICAgICBpZiAobXlVaWQgJiYgKG93bmVyID09PSBteVVpZCB8fCBTdHJpbmcodi5jcmVhdGVkQnlVaWQgfHwgJycpID09PSBteVVpZCkpIHJldHVybiB0cnVlO1xuICAgICAgICAgIGlmIChvd25lciAmJiBwYXJ0bmVycy5oYXMob3duZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICBjb25zdCBrID0gbm9ybVZlbmRvcktleSh2LnZlbmRvcik7XG4gICAgICAgICAgcmV0dXJuICEhc2V0ICYmICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KSxcbiAgICB9O1xuICB9XG5cbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnICYmIHJvbGUgIT09ICd2aWV3ZXInKSB7XG4gICAgLy8gUm9sIHZhY1x1MDBFRG8sICd1bmFzc2lnbmVkJyBvIGRlc2Nvbm9jaWRvOiBubyBleHBvcnRhIG5hZGEgKGZhbGxhIGNlcnJhZG8pLlxuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoKSA9PiBbXSxcbiAgICAgIGZpbHRlclZpc2l0czogKCkgPT4gW10sXG4gICAgfTtcbiAgfVxuXG4gIC8vIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS5cbiAgcmV0dXJuIHtcbiAgICBpc0dsb2JhbDogdHJ1ZSxcbiAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgIHZlbmRvckNvbHVtbkZvclBlZGlkbzogdmVuZG9yQ29sdW1uLFxuICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgfTtcbn1cbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG5pbXBvcnQgeyBidWlsZEV4cG9ydFNjb3BlIH0gZnJvbSAnLi4vcHVyZS9leHBvcnQtc2NvcGUuanMnO1xuXG4vLyB2MTUzNCAoMjAyNi0xMS0wMikgXHUyMDE0IGFsY2FuY2UgcG9yIHJvbCBkZSBsYXMgZXhwb3J0YWNpb25lcyAoYXVkaXRvclx1MDBFRGEgNDYsXG4vLyBFdGFwYSAxKS4gUmVnbGEgZW4gc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzOiBlbCB2ZW5kZWRvciB2ZSBzb2xvIHBlZGlkb3MgZGVcbi8vIGNsaWVudGVzIHF1ZSBIT1kgc29uIHN1eW9zIGVuIGVsIG1hc3RlciAoUE9JTlRTICsgdmVuZG9yX292ZXJyaWRlcyArXG4vLyBhcHByb3ZlZEFsdGFzLCBcdTAwQTc0Ni9cdTAwQTc1MCkgeSBhZGVtXHUwMEUxcyBjb24gYXNzaWduZWRWZW5kb3JVaWQgPSBzdSB1c3VhcmlvOyBlbFxuLy8gaW50ZXJubyB2ZSBsb3MgY2xpZW50ZXMgZGUgc3Ugem9uYSArIHN1cyBwYXJlamFzIChnZXRNeUFsbG93ZWRWZW5kb3JLZXlzLFxuLy8gZWwgbWlzbW8gYWxjYW5jZSBkZWwgbWFwYSk7IGFkbWluL2dlcmVudGUgc2luIGNhbWJpby4gRWwgdWlkIHNhbGUgZGVcbi8vIEZpcmViYXNlIEF1dGggKG5vIGRlIHVzZXJSb2xlLCBxdWUgZXMgdW5hIHZhcmlhYmxlIGdsb2JhbCBlZGl0YWJsZSkuXG5mdW5jdGlvbiBfZXhwb3J0U2NvcGUoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdHlwZW9mIHVzZXJSb2xlICE9PSAndW5kZWZpbmVkJyA/IHVzZXJSb2xlIDogbnVsbDtcbiAgbGV0IG15VWlkID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHcuZmlyZWJhc2UgJiYgdy5maXJlYmFzZS5hdXRoICYmIHcuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgIG15VWlkID0gKHUgJiYgdS51aWQpIHx8ICcnO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG15VWlkID0gJyc7XG4gIH1cbiAgY29uc3QgbXlWZW5kb3JLZXkgPSB0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gYXNzaWduZWRWZW5kb3IgOiAnJztcbiAgbGV0IGVmZmVjdGl2ZVZlbmRvclNldCA9IG51bGw7XG4gIHRyeSB7XG4gICAgZWZmZWN0aXZlVmVuZG9yU2V0ID1cbiAgICAgIHR5cGVvZiBnZXRNeUFsbG93ZWRWZW5kb3JLZXlzID09PSAnZnVuY3Rpb24nID8gZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cygpIDogbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQgPSBudWxsO1xuICB9XG4gIGxldCBwYXJ0bmVyVWlkcyA9IFtdO1xuICB0cnkge1xuICAgIHBhcnRuZXJVaWRzID0gKFxuICAgICAgKHR5cGVvZiBteUV4dGVybmFsUGFydG5lcnMgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkobXlFeHRlcm5hbFBhcnRuZXJzKVxuICAgICAgICA/IG15RXh0ZXJuYWxQYXJ0bmVyc1xuICAgICAgICA6IFtdKSB8fCBbXVxuICAgIClcbiAgICAgIC5tYXAoKHgpID0+IHggJiYgeC51aWQpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHBhcnRuZXJVaWRzID0gW107XG4gIH1cbiAgLy8gUmVzb2x2ZXIgZGVsIG1hc3RlciBjb24gbWVtbyBwb3IgY2xpZW50ZSAodW5hIHBhc2FkYSBwb3IgZXhwb3J0KS5cbiAgLy8gRGV2dWVsdmUge3ZlbmRvcktleSwgcmVhc29ufSBwYXJhIHF1ZSBlbCBhbGNhbmNlIGRpc3RpbmdhIHByb3NwZWN0byBzaW5cbiAgLy8gQ2FyZENvZGUgKGNhZSBhIHZlbmRvckFzc2lnbmVkKSBkZSBDYXJkQ29kZSBubyByZXN1ZWx0byAoYWZ1ZXJhKS5cbiAgY29uc3QgbWVtbyA9IG5ldyBNYXAoKTtcbiAgY29uc3QgcmVzb2x2ZVZlbmRvckZvckNsaWVudCA9IChjYXJkQ29kZSwgY2xpZW50TmFtZSkgPT4ge1xuICAgIGNvbnN0IGsgPSBTdHJpbmcoY2FyZENvZGUgfHwgJycpICsgJ3wnICsgU3RyaW5nKGNsaWVudE5hbWUgfHwgJycpO1xuICAgIGlmIChtZW1vLmhhcyhrKSkgcmV0dXJuIG1lbW8uZ2V0KGspO1xuICAgIGxldCBvdXQgPSB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgciA9XG4gICAgICAgIHR5cGVvZiB3Ll9yZXNvbHZlQ2xpZW50VmVuZG9yRnJvbU1hc3RlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gdy5fcmVzb2x2ZUNsaWVudFZlbmRvckZyb21NYXN0ZXIoeyBjYXJkQ29kZSwgY2xpZW50TmFtZSB9KVxuICAgICAgICAgIDogbnVsbDtcbiAgICAgIGlmIChyKSBvdXQgPSB7IHZlbmRvcktleTogci52ZW5kb3JLZXkgfHwgJycsIHJlYXNvbjogci5yZWFzb24gfHwgJycgfTtcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgb3V0ID0geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgICB9XG4gICAgbWVtby5zZXQoaywgb3V0KTtcbiAgICByZXR1cm4gb3V0O1xuICB9O1xuICByZXR1cm4gYnVpbGRFeHBvcnRTY29wZSh7XG4gICAgcm9sZSxcbiAgICBteVVpZCxcbiAgICBteVZlbmRvcktleSxcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQsXG4gICAgcGFydG5lclVpZHMsXG4gICAgcmVzb2x2ZVZlbmRvckZvckNsaWVudCxcbiAgfSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIE1BU1RFUkZJTEUgREUgQ0xJRU5URVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxuLy8gbm9tYnJlLCB0aXBvIChjbGllbnRlL3Byb3NwZWN0byksIHpvbmEgZGVsIHZlbmRlZG9yLCBhc2Vzb3IgZXh0ZXJubywgYXNlc29yXG4vLyBpbnRlcm5vIChkZWR1Y2lkbyBwb3IgcGFyZWphIFZESSksIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBkZXBhcnRhbWVudG8sXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxuLy8gY29vcmRlbmFkYXMgZ2VvY29kaWZpY2FkYXMsIGVzdGFkbyAoSGFiaWxpdGFkby9QZW5kaWVudGUvQ2FuY2VsYWRvKSxcbi8vIGNhdGVnb3JpYSAoUmVndWxhci9WZW50YXMgRXNwZWNpYWxlcy9EaXN0cmlidWlkb3IpLlxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIVBPSU5UUyB8fCAhUE9JTlRTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgY2FyZ2Fkb3MgdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBtYXN0ZXJmaWxlIGRlIGNsaWVudGVzLi4uJyk7XG5cbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGNhcmdhciBjbGllbnRfYnV5ZXJfc3RhdHMgZW4gYmxvcXVlICgxIGRvYyBwb3IgY2FyZENvZGUgU0FQKVxuICAvLyBBTlRFUyBkZSBhcm1hciBsYXMgZmlsYXMsIGFzXHUwMEVEIGNhZGEgZmlsYSB0aWVuZSBzdSBidXllciBzdGF0cyArIGZlY2hhXG4gIC8vIFx1MDBGQWx0aW1hIGNvbXByYSBzaW4gcm9tcGVyIGVsIGZsdWpvLiBGaXJlLWFuZC1mb3JnZXQgc2kgZmFsbGE6IGNhZGEgZmlsYVxuICAvLyBjYWUgYSBcIi1cIiBlbiBsb3MgY2FtcG9zIEJ1eWVyLiBBZG1pbi9nZXJlbnRlIHZlIHRvZGEgbGEgY29sZWNjaVx1MDBGM247XG4gIC8vIHZlbmRlZG9yIHZlIHNcdTAwRjNsbyBsb3Mgc3V5b3MgKHJ1bGVzKS4gU2kgbGEgcnVsZSBibG9xdWVhIFx1MjE5MiBjYXRjaCBcdTIxOTIgdmFjXHUwMEVEby5cbiAgLy8gUGVkaWRvIE1hcmlhbm86IG5vIGludmVudGFyIGNcdTAwRTFsY3VsbyBkZSBcIkZlY2hhIFx1MDBGQWx0aW1hIGNvbXByYVwiOyBzaSBub1xuICAvLyBleGlzdGUgc2Ugb21pdGUuIGJ1eWVyX3N0YXRzLnN0YXRzXzEybS51bHRpbWFDb21wcmEgWUEgZXhpc3RlLlxuICBjb25zdCBidXllclN0YXRzSWR4ID0gbmV3IE1hcCgpO1xuICB0cnkge1xuICAgIGNvbnN0IGJzU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2J1eWVyX3N0YXRzJykuZ2V0KCk7XG4gICAgYnNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGJ1eWVyU3RhdHNJZHguc2V0KGQuaWQsIGQuZGF0YSgpIHx8IHt9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICAnW21hc3RlcmZpbGVdIGNsaWVudF9idXllcl9zdGF0cyBubyBjYXJnYWRvIChydWxlIGRlbmllZCBvIHJlZCk6JyxcbiAgICAgIF9lICYmIF9lLm1lc3NhZ2VcbiAgICApO1xuICB9XG5cbiAgLy8gdjE1NjYgKDIwMjYtMTEtMTgpOiBjYXJnYXIgdmlzaXRzIGVuIGJsb3F1ZSAoMSBxdWVyeSBncmFuZGUpIHkgYWdydXBhclxuICAvLyBwb3IgY2FyZENvZGUgY29uIE1BWChmZWNoYSkuIEFsaW1lbnRhIGxhIGNvbHVtbmFcbiAgLy8gVUxUSU1BX1ZJU0lUQS9DT05UQUNUT19GRUNIQS4gRmlyZS1hbmQtZm9yZ2V0IHNpIGZhbGxhOiBjb2x1bW5hIHZhY2lhLlxuICAvLyBSdWxlczogdmlzaXRzIHJlYWQgYWJpZXJ0byBhIGlzUmVhZGVyKCk7IFZERSB2ZSBzXHUwMEYzbG8gbGFzIHN1eWFzIHBvclxuICAvLyBvd25lclVpZCwgYWRtaW4vZ2VyZW50ZSBsYXMgdmUgdG9kYXMuXG4gIGNvbnN0IHVsdGltYVZpc2l0YUlkeCA9IG5ldyBNYXAoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCB2U25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XG4gICAgdlNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgdiA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcodi5jYXJkQ29kZSB8fCB2LmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgICAgIGlmICghY2MpIHJldHVybjtcbiAgICAgIGNvbnN0IHJhdyA9IHYuZmVjaGEgfHwgdi5kYXRlIHx8IHYudmlzaXREYXRlIHx8IHYuY3JlYXRlZEF0IHx8IHYudGltZXN0YW1wIHx8IG51bGw7XG4gICAgICBsZXQgZmVjaGFJc28gPSBudWxsO1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFyYXcpIGZlY2hhSXNvID0gbnVsbDtcbiAgICAgICAgZWxzZSBpZiAodHlwZW9mIHJhdyA9PT0gJ3N0cmluZycpIGZlY2hhSXNvID0gcmF3O1xuICAgICAgICBlbHNlIGlmIChyYXcgJiYgdHlwZW9mIHJhdy50b0RhdGUgPT09ICdmdW5jdGlvbicpIGZlY2hhSXNvID0gcmF3LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGVsc2UgaWYgKHJhdyAmJiB0eXBlb2YgcmF3LnNlY29uZHMgPT09ICdudW1iZXInKSBmZWNoYUlzbyA9IG5ldyBEYXRlKHJhdy5zZWNvbmRzICogMTAwMCkudG9JU09TdHJpbmcoKTtcbiAgICAgIH0gY2F0Y2ggeyBmZWNoYUlzbyA9IG51bGw7IH1cbiAgICAgIGlmICghZmVjaGFJc28pIHJldHVybjtcbiAgICAgIGNvbnN0IHByZXYgPSB1bHRpbWFWaXNpdGFJZHguZ2V0KGNjKTtcbiAgICAgIGlmICghcHJldiB8fCBTdHJpbmcoZmVjaGFJc28pID4gU3RyaW5nKHByZXYpKSB1bHRpbWFWaXNpdGFJZHguc2V0KGNjLCBmZWNoYUlzbyk7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKF9lVmlzaXRzKSB7XG4gICAgY29uc29sZS53YXJuKCdbbWFzdGVyZmlsZV0gdmlzaXRzIG5vIGNhcmdhZG86JywgX2VWaXNpdHMgJiYgX2VWaXNpdHMubWVzc2FnZSk7XG4gIH1cblxuICAvLyBIZWxwZXJzIGRlbCBwdXJlIGZuIChmYWxsYmFjayBpbmxpbmUgc2kgYnVuZGxlIG5vIGNhcmdcdTAwRjMpLlxuICBjb25zdCBfZmNMYWJlbHMgPVxuICAgICh3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUuZmljaGFDbGllbnRlTGFiZWxzKSB8fCBudWxsO1xuICBjb25zdCBfY2xhc2lmUm93ID0gKGNtZCkgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUNsYXNpZlJvd1xuICAgICAgPyBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93KGNtZClcbiAgICAgIDoge1xuICAgICAgICAgICdUaXBvIGRlIGNsaWVudGUnOiAnLScsXG4gICAgICAgICAgRmlkZWxpZGFkOiAnLScsXG4gICAgICAgICAgJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJzogJy0nLFxuICAgICAgICAgIFRhbWFcdTAwRjFvOiAnLScsXG4gICAgICAgICAgRXNwZWNpYWxpemFjaVx1MDBGM246ICctJyxcbiAgICAgICAgICAnVGlwbyBkZSBsb2NhbCc6ICctJyxcbiAgICAgICAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IGNtZCAmJiBjbWQuY3JlZGl0b0NoZXF1ZSA/IE51bWJlcihjbWQuY3JlZGl0b0NoZXF1ZSkgOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9idXllclJvdyA9IChicykgPT5cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVCdXllclJvdyhicywgJzEybScpXG4gICAgICA6IHtcbiAgICAgICAgICAnTW9udG8gdG90YWwgKDEybSknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogJy0nLFxuICAgICAgICAgICdGYWN0dXJhcyBwb3IgbWVzICgxMm0pJzogJy0nLFxuICAgICAgICAgICdQcmltZXJhIGNvbXByYSc6ICctJyxcbiAgICAgICAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJzogJy0nLFxuICAgICAgICB9O1xuICBjb25zdCBfZmlsbERhc2ggPSAocm93KSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5ID8gX2ZjTGFiZWxzLmZpbGxEYXNoSW5FbXB0eShyb3cpIDogcm93O1xuICAvLyB2MTQ4NSBcdTAwQTc4NCAoMjAyNi0xMC0yNyBCVUcgRklYKTogYlx1MDBGQXNxdWVkYSBwb3IgY2FyZENvZGUgKGZ1ZW50ZSBhdXRvcml0YXRpdmEpLlxuICAvLyB2MTQ4MiB1c2FiYSBgY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNsaWVudExvY0lkKHByb3YsIGxvYywgbmFtZSkpYCBcdTIwMTQgc2x1Z1xuICAvLyBkZXJpdmFkbyBkZSBQT0lOVFMuIFBhcmEgTUFYRVJBLCBQT0lOVFMgZGljZSBcIlBhbGVybW8gKEMxNClcIiBwZXJvIGxhIEZpY2hhXG4gIC8vIHBlcnNpc3RlIGNvbiBcIkNPTEVHSUFMRVNcIiBcdTIxOTIgZG9jSWQgbWlzbWF0Y2ggXHUyMTkyIGNtRGF0YSB1bmRlZmluZWQgXHUyMTkyIDUgY2FtcG9zXG4gIC8vIEZpY2hhIHNhbFx1MDBFRGFuIFwiLVwiIGF1bnF1ZSBjYXJnYWRvcy4gZmluZENtRGF0YUJ5Q2FyZENvZGUgZXNjYW5lYSBwb3JcbiAgLy8gc2FwQ2FyZENvZGUgT1IgY2FyZENvZGVTYXAgKGFtYm9zIGFsaWFzZXMpIHkgcmV0b3JuYSBlbCBkb2MgY29ycmVjdG8uXG4gIGNvbnN0IF9maW5kQnlDYXJkID1cbiAgICBfZmNMYWJlbHMgJiYgX2ZjTGFiZWxzLmZpbmRDbURhdGFCeUNhcmRDb2RlXG4gICAgICA/IF9mY0xhYmVscy5maW5kQ21EYXRhQnlDYXJkQ29kZVxuICAgICAgOiAoY2FyZENvZGUsIGNhY2hlKSA9PiB7XG4gICAgICAgICAgaWYgKCFjYXJkQ29kZSB8fCAhY2FjaGUgfHwgdHlwZW9mIGNhY2hlLmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHJldHVybiBudWxsO1xuICAgICAgICAgIGxldCBmb3VuZCA9IG51bGw7XG4gICAgICAgICAgY2FjaGUuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICAgICAgaWYgKGZvdW5kIHx8ICFkKSByZXR1cm47XG4gICAgICAgICAgICBjb25zdCBjYzEgPSBTdHJpbmcoZC5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgICAgICAgY29uc3QgY2MyID0gU3RyaW5nKGQuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgICAgIGlmIChjYzEgPT09IGNhcmRDb2RlIHx8IGNjMiA9PT0gY2FyZENvZGUpIGZvdW5kID0gZDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gZm91bmQ7XG4gICAgICAgIH07XG4gIC8vIFNjb3BlIHBvciB2ZW5kb3IgKHYzMzEpOiBlbCBleHBvcnQgcmVzcGV0YSBlbCBmaWx0cm8gZGUgem9uYSBhY3Rpdm8gZW4gZWxcbiAgLy8gZHJvcGRvd24uIEFkbWluL2dlcmVudGUvdmlld2VyIGNvbiAnVG9kYXMnIG9idGllbmVuIG51bGwgLT4gc2luIGZpbHRyb1xuICAvLyAoZXhwb3J0YSB0b2RvIGVsIHBhaXMpLiBWZW5kZWRvciBvYnRpZW5lIHthc3NpZ25lZFZlbmRvcn0uIFZESSBvYnRpZW5lXG4gIC8vIHN1cyBwYXJlamFzICsgcHJvcGlvIHNpIGVsaWdpbyAnVG9kYXMgbWlzIHpvbmFzJywgbyBzb2xvIGVsIHN1YnNldCBxdWVcbiAgLy8gZWxpZ2lvIChwcm9waW8gLyB1bmEgcGFyZWphIGVzcGVjaWZpY2EpLiBGdWVyYSBkZSBlc3RlIHNldCwgbGFzIHRpZW5kYXNcbiAgLy8gbm8gc2UgaW5jbHV5ZW4gZW4gZWwgRXhjZWwgLSBlbCBhcmNoaXZvIHJlZmxlamEgZXhhY3RhbWVudGUgbG8gcXVlIHZlXG4gIC8vIGVuIGVsIG1hcGEgcXVpZW4gZXhwb3J0YS5cbiAgY29uc3Qgc2NvcGVTZXQgPVxuICAgIHR5cGVvZiBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgPT09ICdmdW5jdGlvbidcbiAgICAgID8gZ2V0RWZmZWN0aXZlVmVuZG9yU2V0KHR5cGVvZiBjdXJyZW50VmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRWZW5kb3IgOiAnQUxMJylcbiAgICAgIDogbnVsbDtcbiAgY29uc3QgaW5TY29wZSA9ICh2ZW5kb3JLZXkpID0+IHtcbiAgICBpZiAoc2NvcGVTZXQgPT09IG51bGwpIHJldHVybiB0cnVlO1xuICAgIGlmICghdmVuZG9yS2V5KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHNjb3BlU2V0Lmhhcyh2ZW5kb3JLZXkpO1xuICB9O1xuICAvLyBNYXBlbyBWREUgLT4gVkRJIChhIHBhcnRpciBkZSBsYXMgcGFyZWphcyBlc3RhbmRhcikuIEN1YW5kbyB1bmEgdGllbmRhXG4gIC8vIHBlcnRlbmVjZSBhIEZlZGVyaWNvIG8gR29uemFsbywgZWwgVkRJIGVzIElvYW5uaXMuIEN1YW5kbyBlcyBkZSBNYXVyaWNpb1xuICAvLyBvIE1hcnRpbiwgZWwgVkRJIGVzIFNhbnRpYWdvLiBTaSBlbiBlbCBmdXR1cm8gc2UgcmVhc2lnbmFuIHBhcmVqYXMgdmlhXG4gIC8vIHBhbmVsIGFkbWluLCBlc3RvIHNlIHBvZHJpYSBsZWVyIGRlbCBGaXJlc3RvcmUgLSBwZXJvIHBhcmEgZWwgbWFzdGVyZmlsZVxuICAvLyBlc3RhdGljbywgdXNhbW9zIGVsIGVzdGFuZGFyLlxuICBjb25zdCBWREVfVE9fVkRJID0ge1xuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICAgIFBBQ0hJOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIGxvb2t1cFpvbmUodmVuZG9yS2V5KSB7XG4gICAgY29uc3QgdiA9IHR5cGVvZiBWRU5ET1JTICE9PSAndW5kZWZpbmVkJyA/IFZFTkRPUlMuZmluZCgodnYpID0+IHZ2LmtleSA9PT0gdmVuZG9yS2V5KSA6IG51bGw7XG4gICAgcmV0dXJuIHYgPyB2LnpvbmUgOiAnJztcbiAgfVxuICBmdW5jdGlvbiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYubGFiZWwgOiB2ZW5kb3JLZXkgfHwgJyc7XG4gIH1cblxuICAvLyB2NDUwICgyMDI2LTA4LTExKTogaW5kaWNlIGRlIGNsYXNpZmljYWNpb24gZGVzZGUgdmlzaXRzLiBQYXJhIGNhZGFcbiAgLy8gY2xpZW50ZSwgbWVyZ2VhIGxvcyBjYW1wb3MgZGUgY2xhc2lmaWNhY2lvbiAodGlwby90YW1hbm8vZmlkZWxpZGFkL1xuICAvLyBlc3BlY2lhbGl6YWNpb24vY2FuYWxDb21wcmEvcG9wL3RpcG9WZW50YS9ldGMuKSBkZWwgZm9ybXVsYXJpbyBkZVxuICAvLyB2aXNpdGEvY29udGFjdGFkby4gUG9saXRpY2E6IGNhbXBvIHBvciBjYW1wbywgdG9tYXIgZWwgcHJpbWVyIHZhbG9yXG4gIC8vIE5PIFZBQ0lPIGFsIHJlY29ycmVyIGRvY3MgZGUgbWFzIHJlY2llbnRlIGEgbWFzIGFudGlndW8uIEFzaSBlbCB1c3VhcmlvXG4gIC8vIHZlIGxhIGNsYXNpZmljYWNpb24gbWFzIGFjdHVhbGl6YWRhLCBwZXJvIHNpIGVsIHVsdGltbyBjb250YWN0byBubyBsbGVuYVxuICAvLyB1biBjYW1wbyAoY29udGFjdG9zIHRpZW5lbiBtZW5vcyBjYW1wb3MgcXVlIHZpc2l0YXMpLCBjYWUgYWwgYW50ZXJpb3JcbiAgLy8gZW4gdmV6IGRlIGRlamFyIHZhY2lvLiBQZWRpZG8gZGUgTWFyaWFubzogXCJwcmlvcml6YXIgbGEgdWx0aW1hXG4gIC8vIGludGVyYWNjaW9uIHBlcm8gbm8gcGVyZGVyIGluZm8gdXRpbCBkZSBsYXMgYW50ZXJpb3Jlc1wiLlxuICBjb25zdCBDTEFTU0lGX0ZJRUxEUyA9IFtcbiAgICAndGlwbycsXG4gICAgJ2xvY2FsJyxcbiAgICAndGFtYW5vJyxcbiAgICAnZmlkZWxpZGFkJyxcbiAgICAnZXNwZWNpYWxpemFjaW9uJyxcbiAgICAnY2FuYWxDb21wcmEnLFxuICAgICdyZWxldmFuY2lhJyxcbiAgICAncG9wJyxcbiAgICAnbmVjZXNpZGFkUHVudHVhbCcsXG4gICAgJ3RpcG9WZW50YScsXG4gICAgJ3BvbmRlcmFjaW9uTW9zdHJhZG8nLFxuICAgICdwb25kZXJhY2lvbkVjb21tZXJjZScsXG4gICAgJ2NvbXBldGVuY2lhJyxcbiAgICAnb3BvcnR1bmlkYWQnLFxuICAgICdtYXNWZW5kaWRvJyxcbiAgICAnbWFzUHJlZ3VudGFuJyxcbiAgICAnYXl1ZGFUaWVuZGEnLFxuICBdO1xuICBmdW5jdGlvbiBfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIHJldHVybiAoXG4gICAgICAocHJvdiB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKGxvYyB8fCAnJykudG9TdHJpbmcoKS50cmltKCkgK1xuICAgICAgJ3wnICtcbiAgICAgICh0aWVuZGEgfHwgJycpLnRvU3RyaW5nKCkudHJpbSgpXG4gICAgKTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlRzKHYpIHtcbiAgICBpZiAodiAmJiB2LmNyZWF0ZWRBdCAmJiB2LmNyZWF0ZWRBdC50b01pbGxpcykgcmV0dXJuIHYuY3JlYXRlZEF0LnRvTWlsbGlzKCk7XG4gICAgaWYgKHYgJiYgdi5mZWNoYSkgcmV0dXJuIG5ldyBEYXRlKHYuZmVjaGEpLmdldFRpbWUoKSB8fCAwO1xuICAgIHJldHVybiAwO1xuICB9XG4gIGNvbnN0IGNsYXNzaWZJbmRleCA9IG5ldyBNYXAoKTsgLy8ga2V5IC0+IHsgbGFzdDoge2NhbXBvc30sIGxhc3RGZWNoYSwgbGFzdFR5cGUsIHZpc2l0YXMsIGNvbnRhY3RvcyB9XG4gIGlmICh0eXBlb2YgdmlzaXRzQ2FjaGUgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkodmlzaXRzQ2FjaGUpKSB7XG4gICAgY29uc3QgYnlLZXkgPSBuZXcgTWFwKCk7XG4gICAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgICAgaWYgKCF2KSByZXR1cm47XG4gICAgICBjb25zdCBrID0gX2NsYXNzaWZLZXkodi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSk7XG4gICAgICBpZiAoIWJ5S2V5LmhhcyhrKSkgYnlLZXkuc2V0KGssIFtdKTtcbiAgICAgIGJ5S2V5LmdldChrKS5wdXNoKHYpO1xuICAgIH0pO1xuICAgIGJ5S2V5LmZvckVhY2goKGFyciwgaykgPT4ge1xuICAgICAgYXJyLnNvcnQoKGEsIGIpID0+IF9jbGFzc2lmVHMoYikgLSBfY2xhc3NpZlRzKGEpKTsgLy8gZGVzYyBwb3IgZmVjaGFcbiAgICAgIGNvbnN0IG1lcmdlZCA9IHt9O1xuICAgICAgYXJyLmZvckVhY2goKHYpID0+IHtcbiAgICAgICAgQ0xBU1NJRl9GSUVMRFMuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgICAgIGlmIChtZXJnZWRbZl0gIT0gbnVsbCAmJiBtZXJnZWRbZl0gIT09ICcnICYmIG1lcmdlZFtmXSAhPT0gMCkgcmV0dXJuO1xuICAgICAgICAgIGNvbnN0IHZhbCA9IHZbZl07XG4gICAgICAgICAgaWYgKHZhbCAhPSBudWxsICYmIHZhbCAhPT0gJycpIG1lcmdlZFtmXSA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGFyclswXSB8fCB7fTtcbiAgICAgIGNsYXNzaWZJbmRleC5zZXQoaywge1xuICAgICAgICBtZXJnZWQsXG4gICAgICAgIGxhc3RGZWNoYTogbGF0ZXN0LmZlY2hhIHx8ICcnLFxuICAgICAgICBsYXN0VHlwZTogbGF0ZXN0LmludGVyYWN0aW9uVHlwZSB8fCAobGF0ZXN0LmVzcGFjaW8gPyAndmlzaXRhJyA6ICcnKSxcbiAgICAgICAgdmlzaXRhczogYXJyLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aCxcbiAgICAgICAgY29udGFjdG9zOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gX2NsYXNzaWZSb3cocHJvdiwgbG9jLCB0aWVuZGEpIHtcbiAgICBjb25zdCBlbnRyeSA9IGNsYXNzaWZJbmRleC5nZXQoX2NsYXNzaWZLZXkocHJvdiwgbG9jLCB0aWVuZGEpKTtcbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUaXBvIHVsdGltYSBpbnRlcmFjY2lvbic6ICcnLFxuICAgICAgICAnVG90YWwgdmlzaXRhcyc6IDAsXG4gICAgICAgICdUb3RhbCBjb250YWN0b3MnOiAwLFxuICAgICAgICAnVGlwbyBjb21lcmNpbyc6ICcnLFxuICAgICAgICBMb2NhbDogJycsXG4gICAgICAgIFRhbWFubzogJycsXG4gICAgICAgIEZpZGVsaWRhZDogJycsXG4gICAgICAgIEVzcGVjaWFsaXphY2lvbjogJycsXG4gICAgICAgICdDYW5hbCBkZSBjb21wcmEnOiAnJyxcbiAgICAgICAgUmVsZXZhbmNpYTogJycsXG4gICAgICAgIFBPUDogJycsXG4gICAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICcnLFxuICAgICAgICAnVGlwbyBkZSB2ZW50YSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6ICcnLFxuICAgICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAnJyxcbiAgICAgICAgQ29tcGV0ZW5jaWE6ICcnLFxuICAgICAgICBPcG9ydHVuaWRhZDogJycsXG4gICAgICAgICdNYXMgdmVuZGlkbyc6ICcnLFxuICAgICAgICAnTWFzIHByZWd1bnRhbic6ICcnLFxuICAgICAgICAnQXl1ZGEgdGllbmRhJzogJycsXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBtID0gZW50cnkubWVyZ2VkIHx8IHt9O1xuICAgIHJldHVybiB7XG4gICAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdEZlY2hhLFxuICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogZW50cnkubGFzdFR5cGUsXG4gICAgICAnVG90YWwgdmlzaXRhcyc6IGVudHJ5LnZpc2l0YXMsXG4gICAgICAnVG90YWwgY29udGFjdG9zJzogZW50cnkuY29udGFjdG9zLFxuICAgICAgJ1RpcG8gY29tZXJjaW8nOiBtLnRpcG8gfHwgJycsXG4gICAgICBMb2NhbDogbS5sb2NhbCB8fCAnJyxcbiAgICAgIFRhbWFubzogbS50YW1hbm8gfHwgJycsXG4gICAgICBGaWRlbGlkYWQ6IG0uZmlkZWxpZGFkIHx8ICcnLFxuICAgICAgRXNwZWNpYWxpemFjaW9uOiBtLmVzcGVjaWFsaXphY2lvbiB8fCAnJyxcbiAgICAgICdDYW5hbCBkZSBjb21wcmEnOiBtLmNhbmFsQ29tcHJhIHx8ICcnLFxuICAgICAgUmVsZXZhbmNpYTogbS5yZWxldmFuY2lhICE9IG51bGwgPyBtLnJlbGV2YW5jaWEgOiAnJyxcbiAgICAgIFBPUDogbS5wb3AgfHwgJycsXG4gICAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiBtLm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgICAnVGlwbyBkZSB2ZW50YSc6IG0udGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiBtLnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxuICAgICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogbS5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gbS5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxuICAgICAgQ29tcGV0ZW5jaWE6IG0uY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBPcG9ydHVuaWRhZDogbS5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgICdNYXMgdmVuZGlkbyc6IG0ubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgICdNYXMgcHJlZ3VudGFuJzogbS5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICAnQXl1ZGEgdGllbmRhJzogbS5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRklMVFJPIFNBUDogc29sbyBzZSBleHBvcnRhbiBsb3MgY2xpZW50ZXMgSEFCSUxJVEFET1MgZW4gU0FQIC0gbG9zIHF1ZVxuICAvLyB0aWVuZW4gY2FyZENvZGUgKyBkaXJlY2Npb24uIEVzb3Mgc29uIGxvcyBxdWUgYXBhcmVjZW4gY29tbyB2ZXJkZXMgZW5cbiAgLy8gZWwgbWFwYSB5IHNlIGN1ZW50YW4gZW4gZWwgc3RhdCBIQUJJTElUQURPUy4gQW50ZXMgZWwgbWFzdGVyZmlsZSBiYWphYmFcbiAgLy8gbG9zIH4xMDAwIFBPSU5UUyBkZWwgcGFkcm9uIGhpc3RvcmljbywgcXVlIG5vIHJlcHJlc2VudGFiYSBlbCB1bml2ZXJzb1xuICAvLyByZWFsIG9wZXJhYmxlIGhveS5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHByb3ZpbmNlID0gcC5wcm92aW5jZSB8fCAnJztcbiAgICBjb25zdCBsb2NhbGl0eU1hcCA9IHAubmFtZSB8fCAnJztcbiAgICBjb25zdCBkZXB0ID0gcC5kZXB0IHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvciA9IHAudmVuZG9yIHx8ICcnO1xuICAgIC8vIHYzMzE6IGZpbHRyYXIgcG9yIHNjb3BlIGRlIHZlbmRvciBkZWwgdXN1YXJpbyBxdWUgZXhwb3J0YS5cbiAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgY29uc3QgdmRpID0gVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnO1xuICAgIGNvbnN0IGxhdCA9IHAubGF0ICE9IG51bGwgPyBwLmxhdCA6ICcnO1xuICAgIGNvbnN0IGxvbiA9IHAubG9uICE9IG51bGwgPyBwLmxvbiA6ICcnO1xuICAgIC8vIFNvbG8gY2xpZW50ZXMgcmVndWxhcmVzIChubyBwcm9zcGVjdHMsIG5vIGRpc3RyaWJ1aWRvcmVzKSBxdWUgcGFzZW5cbiAgICAvLyBlbCBmaWx0cm8gaXNTYXBDb25maXJtZWQ6IHRpZW5lbiBjYXJkQ29kZVNhcCArIGRpcmVjY2lvbi5cbiAgICAocC5jbGllbnRzIHx8IFtdKS5mb3JFYWNoKChuYW1lKSA9PiB7XG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgIGlmICh0eXBlb2YgaXNTYXBDb25maXJtZWQgIT09ICdmdW5jdGlvbicgfHwgIWlzU2FwQ29uZmlybWVkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkpXG4gICAgICAgIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSAnQ3wnICsgcHJvdmluY2UgKyAnfCcgKyBsb2NhbGl0eU1hcCArICd8JyArIG5hbWU7XG4gICAgICAvLyBFc3RhZG86IGhhYmlsaXRhZG8vY2FuY2VsYWRvL3BlbmRpZW50ZSAobGVnYWN5IGNvbnRhY3RlZCBzZXQpLlxuICAgICAgbGV0IGVzdGFkbyA9ICdIYWJpbGl0YWRvJzsgLy8gcG9yIGRlZmluaWNpb24geWEgZXN0YSBTQVAtY29uZmlybWFkb1xuICAgICAgaWYgKHR5cGVvZiBjYW5jZWxlZCAhPT0gJ3VuZGVmaW5lZCcgJiYgY2FuY2VsZWQgJiYgY2FuY2VsZWQuaGFzICYmIGNhbmNlbGVkLmhhcyhrKSlcbiAgICAgICAgZXN0YWRvID0gJ0NhbmNlbGFkbyc7XG4gICAgICAvLyBNZXRhZGF0YSBjdXN0b20gKGRpcmVjY2lvbiwgbG9jYWxpZGFkIGRlY2xhcmFkYSwgZ2VvY29kZSkuXG4gICAgICBjb25zdCBtZXRhID0gdHlwZW9mIGNsaWVudE1ldGEgIT09ICd1bmRlZmluZWQnICYmIGNsaWVudE1ldGEgPyBjbGllbnRNZXRhW2tdIHx8IHt9IDoge307XG4gICAgICBjb25zdCBjdXN0b21OYW1lID0gbWV0YS5jdXN0b21OYW1lIHx8ICcnO1xuICAgICAgLy8gQnVzY2FyIGFkZHJlc3M6IDEpIGNsaWVudF9tYXN0ZXIuYWRkcmVzcyAoYWRtaW4pLCAyKSBjbGllbnRNZXRhLmFkZHJlc3MgKHZlbmRvcikuXG4gICAgICBjb25zdCBkb2NJZCA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyA/IGNsaWVudExvY0lkKHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSkgOiAnJztcbiAgICAgIGNvbnN0IGNtRGF0YSA9XG4gICAgICAgIHR5cGVvZiBjbGllbnRNYXN0ZXJDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jSWQgPyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIHx8IHt9IDoge307XG4gICAgICBjb25zdCBhZGRyZXNzID0gY21EYXRhLmFkZHJlc3MgfHwgbWV0YS5hZGRyZXNzIHx8ICcnO1xuICAgICAgY29uc3QgbG9jYWxpdHlDdXN0ID0gY21EYXRhLmxvY2FsaWRhZCB8fCBtZXRhLmxvY2FsaXR5IHx8ICcnO1xuICAgICAgY29uc3QgY3VzdG9tTGF0ID0gbWV0YS5sYXQgIT0gbnVsbCA/IG1ldGEubGF0IDogJyc7XG4gICAgICBjb25zdCBjdXN0b21MbmcgPSBtZXRhLmxuZyAhPSBudWxsID8gbWV0YS5sbmcgOiAnJztcbiAgICAgIC8vIENhcmRDb2RlIFNBUCAoZGUgY2xpZW50X21hc3RlciBvIGRlIGxhIGFsdGEgdmluY3VsYWRhKS5cbiAgICAgIGxldCBjYXJkQ29kZSA9IGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJztcbiAgICAgIGlmICghY2FyZENvZGUgJiYgdHlwZW9mIGFwcHJvdmVkQWx0YXNCeUxvYyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcHJvdmluY2UudG9VcHBlckNhc2UoKSArICd8JyArIGxvY2FsaXR5TWFwO1xuICAgICAgICBjb25zdCBhbHRhcyA9IGFwcHJvdmVkQWx0YXNCeUxvY1trZXldIHx8IFtdO1xuICAgICAgICBjb25zdCBhbHRhTWF0Y2ggPSBhbHRhcy5maW5kKChhKSA9PiAoYS5jb21lcmNpbyB8fCBhLmZhbnRhc2lhIHx8ICcnKSA9PT0gbmFtZSk7XG4gICAgICAgIGlmIChhbHRhTWF0Y2gpIGNhcmRDb2RlID0gYWx0YU1hdGNoLmNhcmRDb2RlU2FwIHx8ICcnO1xuICAgICAgfVxuICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IEJ1eWVyIHN0YXRzIGluZGV4YWRvIHBvciBjYXJkQ29kZSBTQVAuXG4gICAgICBjb25zdCBfYnV5ZXJTdGF0cyA9IGNhcmRDb2RlID8gYnV5ZXJTdGF0c0lkeC5nZXQoY2FyZENvZGUpIHx8IG51bGwgOiBudWxsO1xuICAgICAgLy8gdjE0ODUgXHUwMEE3ODQgQlVHIEZJWDogYnVzY2FyIGNtRGF0YSBhdXRvcml0YXRpdm8gcG9yIGNhcmRDb2RlLiBFbFxuICAgICAgLy8gY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGRvY0lkKSBkZSBhcnJpYmEgdXNhIHNsdWcgY2xpZW50TG9jSWQgcXVlIHB1ZWRlXG4gICAgICAvLyBhcHVudGFyIGFsIGRvYyBFUVVJVk9DQURPICh2ZXIgY29tbWVudCBhcnJpYmEpLiBfZmluZEJ5Q2FyZCBzY2FuIHBvclxuICAgICAgLy8gc2FwQ2FyZENvZGUgZ2FyYW50aXphIGVuY29udHJhciBlbCBkb2MgY29uIGxvcyBjYW1wb3MgRmljaGEuXG4gICAgICBjb25zdCBfY21EYXRhRm9yRmljaGEgPSBfZmluZEJ5Q2FyZChjYXJkQ29kZSwgY2xpZW50TWFzdGVyQ2FjaGUpIHx8IGNtRGF0YTtcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogY2FyZENvZGUsXG4gICAgICAgICAgICAnTm9tYnJlIHRpZW5kYSc6IG5hbWUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6IGN1c3RvbU5hbWUsXG4gICAgICAgICAgICBUaXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBlc3RhZG8sXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdmluY2UpIDogcHJvdmluY2UsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIChtYXBhKSc6IGxvY2FsaXR5TWFwLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiBkZXB0LFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhZGRyZXNzLFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiBsb2NhbGl0eUN1c3QsXG4gICAgICAgICAgICAnTGF0IChnZW9jb2RlKSc6IGN1c3RvbUxhdCB8fCBsYXQsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGN1c3RvbUxuZyB8fCBsb24sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogT1JERU4gaW1wb3J0YS4gTGVnYWN5IHZpc2l0YXMgUFJJTUVSTyAoZmFsbGJhY2spLFxuICAgICAgICAgIC8vIGx1ZWdvIEZpY2hhIENsaWVudGUgUElTQSBjb24gbGFiZWxzIGRlIGxhIGZ1ZW50ZSBhdXRvcml0YXRpdmFcbiAgICAgICAgICAvLyAoZWouIFwiRmlkZWxpZGFkXCIgRmljaGEgcGlzYSBsYSBtZXJnZWFkYSBkZSB2aXNpdGFzIHF1ZSBwdWVkZVxuICAgICAgICAgIC8vIGVzdGFyIGRlc2FjdHVhbGl6YWRhKS4gQnV5ZXIgc3RhdHMgYWwgZmluYWwgKHZlbnRhbmEgMTJtKS5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92aW5jZSwgbG9jYWxpdHlNYXAsIG5hbWUpLFxuICAgICAgICAgIF9jbGFzaWZSb3coX2NtRGF0YUZvckZpY2hhKSxcbiAgICAgICAgICBfYnV5ZXJSb3coX2J1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuICAvLyBJbnllY3RhciBhbHRhcyBkZSBjbGllbnRfYXBwbGljYXRpb25zIChhcHByb3ZlZEFsdGFzTGlzdCk6XG4gIC8vICAgKiBIQUJJTElUQURPUzogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLiBWYW4gY29uIEVzdGFkbz0nSGFiaWxpdGFkbycuXG4gIC8vICAgKiBQUk9WSVNPUklPUyAodjMxMSspOiBtYW51YWxTYXBQZW5kaW5nICYmICFjYXJkQ29kZVNhcCAoQWx0YSBSYXBpZGFcbiAgLy8gICAgIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuIFZhbiBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy4gU2VcbiAgLy8gICAgIGluY2x1eWVuIHBhcmEgcXVlIGVsIGV4cG9ydCByZWZsZWplIGVsIHVuaXZlcnNvIGNvbWVyY2lhbCBjb21wbGV0b1xuICAvLyAgICAgcXVlIGVsIGdlcmVudGUgZXN0YSBnZXN0aW9uYW5kbywgbm8gc29sbyBsb3MgY2VycmFkb3MgZW4gU0FQLlxuICAvLyAgICAgTG9zIHByb3Zpc29yaW9zIHB1ZWRlbiBubyB0ZW5lciBkaXJlY2Npb24gdG9kYXZpYSAtPiBzZSBhY2VwdGFuIGlndWFsLlxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICByb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBzZWVuLmFkZChcbiAgICAgIChyLlByb3ZpbmNpYSB8fCAnJykudG9TdHJpbmcoKS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgKHJbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykudG9Mb3dlckNhc2UoKVxuICAgICk7XG4gIH0pO1xuICBpZiAodHlwZW9mIGFwcHJvdmVkQWx0YXNMaXN0ICE9PSAndW5kZWZpbmVkJyAmJiBhcHByb3ZlZEFsdGFzTGlzdC5sZW5ndGgpIHtcbiAgICBhcHByb3ZlZEFsdGFzTGlzdC5mb3JFYWNoKChhKSA9PiB7XG4gICAgICBpZiAoIWEpIHJldHVybjtcbiAgICAgIGNvbnN0IGlzUHJvdmlzb3JpbyA9ICEhYS5tYW51YWxTYXBQZW5kaW5nICYmICFhLmNhcmRDb2RlU2FwO1xuICAgICAgLy8gSGFiaWxpdGFkb3M6IHNpZ3VlbiBleGlnaWVuZG8gY2FyZENvZGUgKyBkaXJlY2Npb24gKGNvbXBvcnRhbWllbnRvIHByZS12MzExKS5cbiAgICAgIC8vIFByb3Zpc29yaW9zOiBzaW4gY2FyZENvZGUgbmkgZGlyZWNjaW9uLCB2YW4gaWd1YWwgY29uIEVzdGFkbz0nUHJvdmlzb3JpbycuXG4gICAgICBpZiAoIWlzUHJvdmlzb3Jpbykge1xuICAgICAgICBpZiAoIWEuY2FyZENvZGVTYXApIHJldHVybjtcbiAgICAgICAgaWYgKCEoYS5jYWxsZSB8fCBhLmFkZHJlc3MpKSByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwcm92ID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpO1xuICAgICAgY29uc3Qgbm9tYnJlID1cbiAgICAgICAgYS5jb21lcmNpbyB8fFxuICAgICAgICBhLmZhbnRhc2lhIHx8XG4gICAgICAgIChhLmNhcmRDb2RlU2FwID8gJ1NBUCAnICsgYS5jYXJkQ29kZVNhcC5zbGljZSgwLCA4KSA6IGEudGl0dWxhciB8fCAnUHJvdmlzb3JpbycpO1xuICAgICAgY29uc3QgZHVwS2V5ID0gcHJvdi50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbm9tYnJlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMoZHVwS2V5KSkgcmV0dXJuO1xuICAgICAgc2Vlbi5hZGQoZHVwS2V5KTtcbiAgICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgICAvLyB2MzMxOiBtaXNtbyBmaWx0cm8gZGUgc2NvcGUgYXBsaWNhIGEgYWx0YXMgU0FQL3Byb3Zpc29yaWFzLlxuICAgICAgaWYgKCFpblNjb3BlKHZlbmRvcikpIHJldHVybjtcbiAgICAgIGNvbnN0IHpvbmUgPSBsb29rdXBab25lKHZlbmRvcik7XG4gICAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgICBjb25zdCBsb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcoc2luIGxvY2FsaWRhZCknO1xuICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IHBhcmEgYWx0YXMsIGJ1eWVyIHN0YXRzIGtleWVkIHBvciBjYXJkQ29kZVNhcCAoc2kgZXhpc3RlKS5cbiAgICAgIGNvbnN0IF9hbHRhQnV5ZXJTdGF0cyA9IGEuY2FyZENvZGVTYXAgPyBidXllclN0YXRzSWR4LmdldChhLmNhcmRDb2RlU2FwKSB8fCBudWxsIDogbnVsbDtcbiAgICAgIC8vIHYxNDg1IFx1MDBBNzg0IEJVRyBGSVg6IHBhcmEgYWx0YXMgY29uIGNhcmRDb2RlLCBlbCBkb2MgYXV0b3JpdGF0aXZvIGNvblxuICAgICAgLy8gY2FtcG9zIEZpY2hhIHZpdmUgZW4gY2xpZW50X21hc3RlciAobG8gZXNjcmliZSBzYXZlQ2xpZW50Q2F0ZWdvcmlhRnJvbU1vZGFsXG4gICAgICAvLyB2aWEgRmljaGEpLiBfZmluZEJ5Q2FyZCByZXRvcm5hIGVzZSBkb2MuIEZhbGxiYWNrIGFsIHByb3BpbyBhbHRhIGBhYFxuICAgICAgLy8gc2kgZWwgY2xpZW50ZSBubyBlc3RcdTAwRTEgZW4gY2xpZW50X21hc3RlciAoZWouIHByb3Zpc29yaW8gc2luIGNhcmRDb2RlKS5cbiAgICAgIGNvbnN0IF9hbHRhQ21EYXRhID0gYS5jYXJkQ29kZVNhcCA/IF9maW5kQnlDYXJkKGEuY2FyZENvZGVTYXAsIGNsaWVudE1hc3RlckNhY2hlKSB8fCBhIDogYTtcbiAgICAgIHJvd3MucHVzaChcbiAgICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgICB7XG4gICAgICAgICAgICAnQ2FyZENvZGUgU0FQJzogYS5jYXJkQ29kZVNhcCB8fCAnJyxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbm9tYnJlLFxuICAgICAgICAgICAgJ0FsaWFzIChtb2RhbCknOiAnJyxcbiAgICAgICAgICAgIFRpcG86IGlzUHJvdmlzb3JpbyA/ICdQcm92aXNvcmlvIChBbHRhIHJhcGlkYSknIDogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgICAgIEVzdGFkbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8nIDogJ0hhYmlsaXRhZG8nLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3YpIDogcHJvdixcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jLFxuICAgICAgICAgICAgRGVwYXJ0YW1lbnRvOiAnJyxcbiAgICAgICAgICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogdmVuZG9yLFxuICAgICAgICAgICAgWm9uYTogem9uZSxcbiAgICAgICAgICAgICdFdGlxdWV0YSB6b25hJzogbG9va3VwVmVuZG9yTGFiZWwodmVuZG9yKSxcbiAgICAgICAgICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IHZkaSxcbiAgICAgICAgICAgIERpcmVjY2lvbjogYS5jYWxsZSB8fCBhLmFkZHJlc3MgfHwgJycsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvYyxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogYS5sYXQgIT0gbnVsbCA/IGEubGF0IDogJycsXG4gICAgICAgICAgICAnTG5nIChnZW9jb2RlKSc6IGEubG5nICE9IG51bGwgPyBhLmxuZyA6ICcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gdjE0ODIgXHUwMEE3ODI6IG1pc21vIG9yZGVuIHF1ZSBQT0lOVFMgXHUyMDE0IGxlZ2FjeSB2aXNpdGFzIHByaW1lcm8sXG4gICAgICAgICAgLy8gRmljaGEgcGlzYSwgQnV5ZXIgYWwgZmluYWwuXG4gICAgICAgICAgX2NsYXNzaWZSb3cocHJvdiwgbG9jLCBub21icmUpLFxuICAgICAgICAgIF9jbGFzaWZSb3coX2FsdGFDbURhdGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYWx0YUJ1eWVyU3RhdHMpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBPcmRlbmFyIHBvciBwcm92aW5jaWEsIGxvY2FsaWRhZCwgbm9tYnJlLlxuICByb3dzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBwID0gKGEuUHJvdmluY2lhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChhWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTG9jYWxpZGFkIChtYXBhKSddIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChhWydOb21icmUgdGllbmRhJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUoYlsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKTtcbiAgfSk7XG5cbiAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSBjbGllbnRlcyBwYXJhIGV4cG9ydGFyLlxcblxcbicgK1xuICAgICAgICAnRWwgbWFzdGVyZmlsZSBpbmNsdXllOlxcbicgK1xuICAgICAgICAnICAqIEhhYmlsaXRhZG9zIGVuIFNBUCAoY2FyZENvZGUgKyBkaXJlY2Npb24gY2FyZ2Fkb3MpLlxcbicgK1xuICAgICAgICAnICAqIFByb3Zpc29yaW9zIChBbHRhIHJhcGlkYSBwZW5kaWVudGUgZGUgY2FyZ2EgYSBTQVApLlxcblxcbicgK1xuICAgICAgICAnU2kgbm8gdmVzIG5pbmd1bm8sIHJldmlzYSBlbCBtb2RhbCBTQVAgbyBBbHRhIENsaWVudGVzLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggaGVscGVyIChlc3RpbG8gdmVyZGUgKyBjZW50ZXJlZFxuICAvLyB1bmlmb3JtZSkuIEFudGVzIHVzYWJhIFhMU1gud3JpdGVGaWxlIGRpcmVjdG8gY29uIFNoZWV0SlMgZnJlZSBxdWUgaWdub3JhXG4gIC8vIGVzdGlsb3MuIEFob3JhIGhlcmVkYWRvIGRlbCBoZWxwZXIgXHUyMDE0IG1pc21hIFVJIHF1ZSBWZW50YXMvVmlzaXRhcy9ldGMuXG4gIC8vIHYxMDQzICgyMDI2LTA5LTIzKTogcG9zdC1wcm9jZXNvIFx1MjAxNCBzYWNhciBjb2x1bW5hcyAxMDAlIHZhY1x1MDBFRGFzLlxuICAvLyBSZXBvcnRlIE1hcmlhbm86IG1hc3RlcmZpbGUgZXhwb3J0YWJhIDM3IGNvbHVtbmFzIGRvbmRlIG11Y2hhcyB2ZW5cdTAwRURhblxuICAvLyB2YWNcdTAwRURhcyBwb3JxdWUgbm8gaGFiXHUwMEVEYSB2aXNpdGFzL2NvbnRhY3RvcyBjYXJnYWRvcyBwYXJhIGVzb3MgY2xpZW50ZXMuXG4gIC8vIEZpeDogaWRlbnRpZmljYXIga2V5cyBkb25kZSBUT0RBUyBsYXMgZmlsYXMgdGllbmVuIHZhbG9yIFwidmFjXHUwMEVEb1wiIChlbXB0eVxuICAvLyBzdHJpbmcsIG51bGwsIHVuZGVmaW5lZCkgeSByZW1vdmVybGFzIGFudGVzIGRlbCBzaGVldC4gTG9zIGNvbnRlb3NcbiAgLy8gKFRvdGFsIHZpc2l0YXMvY29udGFjdG9zKSBzZSBjb25zaWRlcmFuIHZhY1x1MDBFRG9zIHNpIHRvZG9zIHNvbiAwLlxuICAvLyBXaWR0aHMgcG9yIGNvbHVtbi1uYW1lIChlbiB2ZXogZGUgcG9zaWNpb25hbCkgcGFyYSBxdWUgZWwgZmlsdGVyIG5vXG4gIC8vIGRlc2FsaW5lZSBlbCBzaGVldCBjdWFuZG8gcmVtb3ZlbW9zIGNvbHVtbmFzLlxuICBjb25zdCBDT0xfV0lEVEhTID0ge1xuICAgICdDYXJkQ29kZSBTQVAnOiAxNixcbiAgICAnTm9tYnJlIHRpZW5kYSc6IDM4LFxuICAgICdBbGlhcyAobW9kYWwpJzogMjgsXG4gICAgVGlwbzogMTQsXG4gICAgRXN0YWRvOiAxNCxcbiAgICBQcm92aW5jaWE6IDIyLFxuICAgICdMb2NhbGlkYWQgKG1hcGEpJzogMjIsXG4gICAgRGVwYXJ0YW1lbnRvOiAyMixcbiAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IDI4LFxuICAgIFpvbmE6IDgsXG4gICAgJ0V0aXF1ZXRhIHpvbmEnOiA0OCxcbiAgICAnQXNlc29yIGludGVybm8gKFZESSknOiAyOCxcbiAgICBEaXJlY2Npb246IDM4LFxuICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogMjQsXG4gICAgJ0xhdCAoZ2VvY29kZSknOiAxNCxcbiAgICAnTG5nIChnZW9jb2RlKSc6IDE0LFxuICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBjb2x1bW5hcyBkZSBsYSBGaWNoYSBDbGllbnRlIChwZXN0YVx1MDBGMWEgQ2xhc2lmaWNhY2lcdTAwRjNuKSArXG4gICAgLy8gQnV5ZXIgKHBlc3RhXHUwMEYxYSBCdXllciwgdmVudGFuYSAxMm0pLiBPcmRlbiBleGFjdG8gcXVlIGxsZWdhIGRlc2RlXG4gICAgLy8gX2NsYXNpZlJvdyAoT2JqZWN0LmFzc2lnbiBwcmVzZXJ2YSBvcmRlbiBkZSBrZXlzKS5cbiAgICAnVGlwbyBkZSBjbGllbnRlJzogMzYsXG4gICAgRmlkZWxpZGFkOiAxMCxcbiAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAyMCxcbiAgICBUYW1hXHUwMEYxbzogMTAsXG4gICAgRXNwZWNpYWxpemFjaVx1MDBGM246IDIwLFxuICAgICdUaXBvIGRlIGxvY2FsJzogMTQsXG4gICAgJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknOiAxOCxcbiAgICAnTW9udG8gdG90YWwgKDEybSknOiAxNixcbiAgICAnRmFjdHVyYXMgKDEybSknOiAxMixcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknOiAyMCxcbiAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzogMjAsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAxNixcbiAgICAnUHJpbWVyYSBjb21wcmEnOiAxNCxcbiAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogMTQsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAxOCxcbiAgICAnVWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogMTQsXG4gICAgJ1RvdGFsIHZpc2l0YXMnOiAxMCxcbiAgICAnVG90YWwgY29udGFjdG9zJzogMTAsXG4gICAgJ1RpcG8gY29tZXJjaW8nOiAxOCxcbiAgICBMb2NhbDogMTYsXG4gICAgJ0NhbmFsIGRlIGNvbXByYSc6IDIwLFxuICAgIFJlbGV2YW5jaWE6IDEwLFxuICAgIFBPUDogOCxcbiAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAyNixcbiAgICAnVGlwbyBkZSB2ZW50YSc6IDE2LFxuICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogMTgsXG4gICAgJ1BvbmRlcmFjaW9uIGUtY29tbWVyY2UgKCUpJzogMTgsXG4gICAgQ29tcGV0ZW5jaWE6IDI2LFxuICAgIE9wb3J0dW5pZGFkOiAyNixcbiAgICAnTWFzIHZlbmRpZG8nOiAyMixcbiAgICAnTWFzIHByZWd1bnRhbic6IDIyLFxuICAgICdBeXVkYSB0aWVuZGEnOiAyNixcbiAgfTtcbiAgLy8gRGV0ZWN0YXIga2V5cyAxMDAlIHZhY1x1MDBFRGFzLlxuICBjb25zdCBhbGxLZXlzID0gT2JqZWN0LmtleXMoQ09MX1dJRFRIUyk7XG4gIGNvbnN0IE5VTUVSSUNfWkVST19PSyA9IG5ldyBTZXQoWydUb3RhbCB2aXNpdGFzJywgJ1RvdGFsIGNvbnRhY3RvcyddKTtcbiAgLy8gdjE0ODIgXHUwMEE3ODIgKyB2MTQ4NSBcdTAwQTc4NCBtZWpvcmE6IGNvbHVtbmFzIEZpY2hhICsgZXN0cnVjdHVyYWxlcyAoQ2FyZENvZGUsXG4gIC8vIFpvbmEsIFZlbmRlZG9yLCBEaXJlY2NpXHUwMEYzbiwgZXRjLikgTlVOQ0Egc2Ugb21pdGVuLiBNYXJpYW5vIHBpZGlcdTAwRjM6XG4gIC8vIFwibm8gb2N1bHRhciBjb2x1bW5hcyBwb3Igcm9sOyBQQUNISSByZWNpYmUgbGFzIG1pc21hcyBjb2x1bW5hcyBxdWVcbiAgLy8gYWRtaW4sIHNvbG8gc3VzIGNsaWVudGVzXCIuIEVsIGV4cG9ydCBWREUvUEFDSEkgcmVzcGV0YSBlc3RlIGNvbnRyYXRvXG4gIC8vIHBvcnF1ZSBsYXMgc3RydWN0dXJhbGVzIGVzdFx1MDBFMW4gcHJvdGVnaWRhcyBhdW5xdWUgZWwgc2NvcGUgcmVkdWNpZG8gbm9cbiAgLy8gdGVuZ2EgZGF0b3MgcGFyYSBhbGd1bmEgZGUgZWxsYXMuXG4gIGNvbnN0IFNUUlVDVFVSQUxfUFJPVEVDVEVEID0gbmV3IFNldChbXG4gICAgJ0NhcmRDb2RlIFNBUCcsXG4gICAgJ05vbWJyZSB0aWVuZGEnLFxuICAgICdBbGlhcyAobW9kYWwpJyxcbiAgICAnVGlwbycsXG4gICAgJ0VzdGFkbycsXG4gICAgJ1Byb3ZpbmNpYScsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknLFxuICAgICdEZXBhcnRhbWVudG8nLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJyxcbiAgICAnWm9uYScsXG4gICAgJ0V0aXF1ZXRhIHpvbmEnLFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKScsXG4gICAgJ0RpcmVjY2lvbicsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnLFxuICAgICdMYXQgKGdlb2NvZGUpJyxcbiAgICAnTG5nIChnZW9jb2RlKScsXG4gIF0pO1xuICBjb25zdCBGSUNIQV9QUk9URUNURUQgPSBuZXcgU2V0KFtcbiAgICAnVGlwbyBkZSBjbGllbnRlJyxcbiAgICAnRmlkZWxpZGFkJyxcbiAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nLFxuICAgICdUYW1hXHUwMEYxbycsXG4gICAgJ0VzcGVjaWFsaXphY2lcdTAwRjNuJyxcbiAgICAnVGlwbyBkZSBsb2NhbCcsXG4gICAgJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknLFxuICAgICdNb250byB0b3RhbCAoMTJtKScsXG4gICAgJ0ZhY3R1cmFzICgxMm0pJyxcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknLFxuICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknLFxuICAgICdGYWN0dXJhcyBwb3IgbWVzICgxMm0pJyxcbiAgICAnUHJpbWVyYSBjb21wcmEnLFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnLFxuICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJyxcbiAgXSk7XG4gIGNvbnN0IGVtcHR5S2V5cyA9IG5ldyBTZXQoXG4gICAgYWxsS2V5cy5maWx0ZXIoKGspID0+IHtcbiAgICAgIGlmIChTVFJVQ1RVUkFMX1BST1RFQ1RFRC5oYXMoaykpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChGSUNIQV9QUk9URUNURUQuaGFzKGspKSByZXR1cm4gZmFsc2U7XG4gICAgICByZXR1cm4gcm93cy5ldmVyeSgocikgPT4ge1xuICAgICAgICBjb25zdCB2ID0gcltrXTtcbiAgICAgICAgaWYgKHYgPT09ICcnIHx8IHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgaWYgKE5VTUVSSUNfWkVST19PSy5oYXMoaykgJiYgdiA9PT0gMCkgcmV0dXJuIHRydWU7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICAgIH0pXG4gICk7XG4gIGNvbnN0IGtlcHRLZXlzID0gYWxsS2V5cy5maWx0ZXIoKGspID0+ICFlbXB0eUtleXMuaGFzKGspKTtcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IHJlZ2xhIFwibmluZ3VuYSBjZWxkYSB2YWNcdTAwRURhXCIgXHUyMDE0IGZpbGxEYXNoSW5FbXB0eSBzb2JyZSBUT0RBU1xuICAvLyBsYXMgY29sdW1uYXMgZmluYWxlcyAoY2xhc2lmICsgYnV5ZXIgKyBsZWdhY3kgdmlzaXRhcykuXG4gIGNvbnN0IHJvd3NGaWx0ZXJlZCA9IHJvd3MubWFwKChyKSA9PiB7XG4gICAgY29uc3Qgb3V0ID0ge307XG4gICAga2VwdEtleXMuZm9yRWFjaCgoaykgPT4ge1xuICAgICAgb3V0W2tdID0gcltrXTtcbiAgICB9KTtcbiAgICByZXR1cm4gX2ZpbGxEYXNoKG91dCk7XG4gIH0pO1xuICBjb25zdCByZW1vdmVkQ291bnQgPSBlbXB0eUtleXMuc2l6ZTtcbiAgaWYgKHJlbW92ZWRDb3VudCA+IDApIHtcbiAgICBjb25zb2xlLmxvZyhgW21hc3RlcmZpbGVdIHJlbW92aWRhcyAke3JlbW92ZWRDb3VudH0gY29scyB2YWNcdTAwRURhczpgLCBbLi4uZW1wdHlLZXlzXS5qb2luKCcsICcpKTtcbiAgfVxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHpvbmFcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGFncmVnYXIgY29udGVvIHBvciBUaXBvIGRlIGNsaWVudGUgKyBGaWRlbGlkYWQgKGRvcyBudWV2YXNcbiAgLy8gY29sdW1uYXMgY29uIGRldGFsbGUgcG9yIHpvbmEpLiBGb3JtYXRvIGJyZXZlIFwiQTogTiwgQjogTSwgLTogS1wiIHBhcmFcbiAgLy8gY2FiZXIgZW4gdW5hIHNvbGEgY2VsZGEgbGVnaWJsZS5cbiAgY29uc3QgYnlab25lID0ge307XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGNvbnN0IHogPSByWydFdGlxdWV0YSB6b25hJ10gfHwgJ1NpbiB6b25hJztcbiAgICBpZiAoIWJ5Wm9uZVt6XSkge1xuICAgICAgYnlab25lW3pdID0ge1xuICAgICAgICB0b3RhbDogMCxcbiAgICAgICAgaGFiaWxpdGFkb3M6IDAsXG4gICAgICAgIGNhbmNlbGFkb3M6IDAsXG4gICAgICAgIHRpcG9zOiB7fSxcbiAgICAgICAgZmlkZWxpZGFkZXM6IHt9LFxuICAgICAgfTtcbiAgICB9XG4gICAgYnlab25lW3pdLnRvdGFsKys7XG4gICAgaWYgKHIuRXN0YWRvID09PSAnSGFiaWxpdGFkbycpIGJ5Wm9uZVt6XS5oYWJpbGl0YWRvcysrO1xuICAgIGVsc2UgaWYgKHIuRXN0YWRvID09PSAnQ2FuY2VsYWRvJykgYnlab25lW3pdLmNhbmNlbGFkb3MrKztcbiAgICAvLyBUaXBvIGRlIGNsaWVudGU6IHRvbWFyIHByaW1lciBjaGFyIGRlbCBsYWJlbCAoXCJBIC0gLi4uXCIsIFwiQiAtIC4uLlwiLFxuICAgIC8vIFwiUCAoUHJlbWl1bSkuLi5cIiwgXCJDIC0gLi4uXCIpLiBTaSBsYWJlbCBlcyBcIi1cIiBcdTIxOTIgXCItXCIuXG4gICAgY29uc3QgdGlwb0xibCA9IHJbJ1RpcG8gZGUgY2xpZW50ZSddIHx8ICctJztcbiAgICBjb25zdCB0aXBvS2V5ID0gdGlwb0xibCA9PT0gJy0nID8gJy0nIDogU3RyaW5nKHRpcG9MYmwpLnRyaW0oKS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKTtcbiAgICBieVpvbmVbel0udGlwb3NbdGlwb0tleV0gPSAoYnlab25lW3pdLnRpcG9zW3RpcG9LZXldIHx8IDApICsgMTtcbiAgICBjb25zdCBmaWQgPSByLkZpZGVsaWRhZCB8fCAnLSc7XG4gICAgYnlab25lW3pdLmZpZGVsaWRhZGVzW2ZpZF0gPSAoYnlab25lW3pdLmZpZGVsaWRhZGVzW2ZpZF0gfHwgMCkgKyAxO1xuICB9KTtcbiAgZnVuY3Rpb24gX2ZtdERpc3QoZGlzdCkge1xuICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyhkaXN0KS5zb3J0KChhLCBiKSA9PiBiWzFdIC0gYVsxXSk7XG4gICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gJy0nO1xuICAgIHJldHVybiBlbnRyaWVzLm1hcCgoW2ssIHZdKSA9PiBgJHtrfTogJHt2fWApLmpvaW4oJywgJyk7XG4gIH1cbiAgY29uc3QgcmVzdW1lblJvd3MgPSBPYmplY3QuZW50cmllcyhieVpvbmUpXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xuICAgICAgJ1pvbmEgLyBWZW5kZWRvcic6IHosXG4gICAgICAnVG90YWwgdGllbmRhcyc6IGQudG90YWwsXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcbiAgICAgIENhbmNlbGFkYXM6IGQuY2FuY2VsYWRvcyxcbiAgICAgICdQb3IgVGlwbyBkZSBjbGllbnRlJzogX2ZtdERpc3QoZC50aXBvcyksXG4gICAgICAnUG9yIEZpZGVsaWRhZCc6IF9mbXREaXN0KGQuZmlkZWxpZGFkZXMpLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydUb3RhbCB0aWVuZGFzJ10gLSBhWydUb3RhbCB0aWVuZGFzJ10pO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxuICBjb25zdCBzY29wZUxibCA9XG4gICAgc2NvcGVTZXQgPT09IG51bGxcbiAgICAgID8gJ1RPRE9TJ1xuICAgICAgOiBzY29wZVNldC5zaXplID09PSAxXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcbiAgLy8gdjE1NjUgKDIwMjYtMTEtMTgpOiByZW1hcCBhIGxhcyAxNyBjb2x1bW5hcyBleGFjdGFzIHBvciBwZWRpZG8gTWFyaWFuby5cbiAgLy8gTm9tYnJlcyB5IG9yZGVuIHNvbiBmaWpvcy4gQ29sdW1uYXMgc2luIGZ1ZW50ZSBlc3RhYmxlIHF1ZWRhbiB2YWNpYXNcbiAgLy8gKGVqLiBVTFRJTUFfVklTSVRBL0NPTlRBQ1RPX0ZFQ0hBIHJlcXVpZXJlIGFncmVnYWRvIGFkaWNpb25hbCBkZXNkZVxuICAvLyB2aXNpdHM7IHZlciBkb2NzL0NIQU5HRUxPRy1leHBvcnRzLWNvbHVtbnMtcmVmYWN0b3IubWQgcGFyYSBlbCBsaXN0YWRvKS5cbiAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pn0gKi9cbiAgY29uc3Qgcm93c01hcmlhbm8gPSByb3dzRmlsdGVyZWQubWFwKChyKSA9PiAoe1xuICAgIENBUkRDT0RFX1NBUDogclsnQ2FyZENvZGUgU0FQJ10gfHwgJycsXG4gICAgTk9NQlJFX1RJRU5EQTogclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnLFxuICAgIFRJUE9fQ0xJRU5URTogci5UaXBvIHx8ICcnLCAvLyB2MTU2NTogVGlwbyAoQ2xpZW50ZSBhY3R1YWwgLyBQcm92aXNvcmlvKS5cbiAgICBQUk9WSU5DSUE6IHIuUHJvdmluY2lhIHx8ICcnLFxuICAgIExPQ0FMSURBRDogclsnTG9jYWxpZGFkIChtYXBhKSddIHx8IHJbJ0xvY2FsaWRhZCBkZWNsYXJhZGEnXSB8fCAnJyxcbiAgICBESVJFQ0NJT046IHIuRGlyZWNjaW9uIHx8ICcnLFxuICAgIFRJUE9fREVfQ0xJRU5URTogclsnVGlwbyBkZSBjbGllbnRlJ10gfHwgJycsIC8vIEZpY2hhIENsaWVudGUgKGNsYXNpZikuXG4gICAgJ1RBTUFcdTAwRDFPJzogclsnVGFtYVx1MDBGMW8nXSB8fCByLlRhbWFubyB8fCAnJyxcbiAgICBFU1BFQ0lBTElaQUNJT046IHJbJ0VzcGVjaWFsaXphY2lcdTAwRjNuJ10gfHwgci5Fc3BlY2lhbGl6YWNpb24gfHwgJycsXG4gICAgVElQT19ERV9MT0NBTDogclsnVGlwbyBkZSBsb2NhbCddIHx8ICcnLFxuICAgIFBSRUZFUkVOQ0lBU19DT05UQUNUTzogclsnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nXSB8fCAnJyxcbiAgICBDUkVESVRPX0NIRVFVRTogclsnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSddIHx8ICcnLFxuICAgIEZBQ1RVUkFDSU9OX0FDVU1VTEFEQV8xMk1FU0VTOiByWydNb250byB0b3RhbCAoMTJtKSddIHx8ICcnLFxuICAgICdGUkVDVUVOQ0lBX0NPTVBSQShESUFTKSc6IHJbJ0ZyZWN1ZW5jaWEgKGRcdTAwRURhcyBlbnRyZSBjb21wcmFzKSddIHx8ICcnLFxuICAgIFVMVElNQV9DT01QUkE6IHJbJ1x1MDBEQWx0aW1hIGNvbXByYSddIHx8ICcnLFxuICAgIFZFTkRFRE9SX0FTSUdOQURPOiByWydWZW5kZWRvciBleHRlcm5vIChWREUpJ10gfHwgJycsXG4gICAgLy8gdjE1NjY6IGZvcm1hdG8gREQvTU0vWVlZWSBkZXNkZSBlbCBtYXgoZmVjaGEpIGFncmVnYWRvIGVuIHVsdGltYVZpc2l0YUlkeC5cbiAgICAnVUxUSU1BX1ZJU0lUQS9DT05UQUNUT19GRUNIQSc6ICgoKSA9PiB7XG4gICAgICBjb25zdCBjYyA9IFN0cmluZyhyWydDYXJkQ29kZSBTQVAnXSB8fCAnJykudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gICAgICBjb25zdCBpc28gPSBjYyA/IHVsdGltYVZpc2l0YUlkeC5nZXQoY2MpIDogbnVsbDtcbiAgICAgIGlmICghaXNvKSByZXR1cm4gJyc7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkID0gbmV3IERhdGUoaXNvKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihkLmdldFRpbWUoKSkpIHJldHVybiAnJztcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICBTdHJpbmcoZC5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICAgICAgICcvJyArXG4gICAgICAgICAgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICAgICAgICcvJyArXG4gICAgICAgICAgZC5nZXRGdWxsWWVhcigpXG4gICAgICAgICk7XG4gICAgICB9IGNhdGNoIHsgcmV0dXJuICcnOyB9XG4gICAgfSkoKSxcbiAgfSkpO1xuICBjb25zdCBmbmFtZSA9ICdNYXN0ZXIgQ2xpZW50ZXNfJyArIHNjb3BlTGJsICsgJ18nICsgdHMgKyAnLnhsc3gnO1xuICBhd2FpdCBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdNYXN0ZXIgQ2xpZW50ZXMnLCByb3dzOiByb3dzTWFyaWFubyB9XSk7XG4gIHNob3dTeW5jVGFnKFxuICAgIHJvd3MubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMgZXhwb3J0YWRvcycgK1xuICAgICAgKHNjb3BlU2V0ID09PSBudWxsID8gJycgOiAnIChzY29wZTogJyArIFsuLi5zY29wZVNldF0uam9pbignLCAnKSArICcpJylcbiAgKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0OiBQcmVjaW9zICsgU3RvY2sgcG9yIFNLVVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgdW4gRXhjZWwgY29uIFRPRE8gZWwgY2F0YWxvZ28gY3J1emFuZG8gbG9zIDMgbWFwYXMgdmlnZW50ZXNcbi8vIGVuIG1lbW9yaWE6IFBST0RVQ1RTIChtYXN0ZXIgZGUgU0tVcyksIFBSSUNFX0xJU1RfTUFQIChwcmVjaW8gQVJTIGRlXG4vLyBGaXJlc3RvcmUpIHkgU1RPQ0tfTUFQIChib29sZWFubyBwb3IgU0tVIGRlbCBzdG9jay5qc29uIGRlbCByZXBvKS5cbi8vIEhvamFzOlxuLy8gIC0gXCJQcmVjaW9zIHkgU3RvY2tcIjogdW5hIGZpbGEgcG9yIFNLVSBjb24gdG9kYXMgbGFzIGNvbHVtbmFzIGp1bnRhc1xuLy8gICAgKGxvIG1hcyBjb211biBwYXJhIHJldmlzYXIgZGlzcG9uaWJpbGlkYWQgKyBwcmVjaW8pLlxuLy8gIC0gXCJQcmVjaW9zXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBwcmVjaW8gKHNpbiBzdG9jaykuXG4vLyAgLSBcIlN0b2NrXCI6IHNvbG8gU0tVICsgZGVzY3JpcGNpb24gKyBlc3RhZG8gZGUgc3RvY2suXG4vLyAgLSBcIkluZm9cIjogZmVjaGEgZGUgbG9zIHNuYXBzaG90cyB5IGZ1ZW50ZXMuXG53aW5kb3cuZXhwb3J0UHJlY2lvc1N0b2NrID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFBcnJheS5pc0FycmF5KFBST0RVQ1RTKSB8fCAhUFJPRFVDVFMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBjYXRhbG9nbyBkZSBwcm9kdWN0b3MgY2FyZ2FkbyB0b2RhdmlhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIHByZWNpb3MgKyBzdG9jay4uLicpO1xuICAvLyB2NTc0ICgyMDI2LTA4LTIxKTogbW9zdHJhciBVTklEQURFUyBudW1lcmljYXMgZXhhY3RhcyBkZWwgZGVwb3NpdG8gMTEuXG4gIC8vIHYxMzYzICgyMDI2LTEwLTE5KTogcGVkaWRvIE1hcmlhbm8gXHUyMDE0IGNhbWJpYXIgZGUgXCJzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTFcIiBhXG4gIC8vIFwibGlicmUgcGFyYSBsYSB2ZW50YVwiICg9IGRlcCAxMSBcdTIyMTIgcmVzZXJ2YXMgY29uZmlybWVkL0JPL0FTSUcvd2FpdGxpc3QpLlxuICAvLyBSYXpcdTAwRjNuOiBlbnZpYXIgYWwgY2xpZW50ZSBsbyBxdWUgZWZlY3RpdmFtZW50ZSBzZSBsZSBwdWVkZSBwcm9tZXRlciBIT1kuXG4gIC8vIFNpIHNvbG8gbW9zdHJhbW9zIHN0b2NrIGZcdTAwRURzaWNvLCBwdWVkZSBwYXNhciBxdWUgaGF5YSA1dSBwZXJvIGxhcyA1IGVzdFx1MDBFOW5cbiAgLy8gcmVzZXJ2YWRhcyBcdTIxOTIgZWwgY2xpZW50ZSBzZSBlbnRlcmEgcmVjaVx1MDBFOW4gYWwgaGFjZXIgZWwgcGVkaWRvIHF1ZSBubyBoYXkuXG4gIC8vIFVzYSBnZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgKHB1cmUgZnVuY3Rpb24sIGZpbHRyYSBUVExzKS4gUmV0b3JuYSAnJyBzaVxuICAvLyBubyBoYXkgc25hcHNob3QgY2FyZ2FkbzsgMCBzaSBubyBoYXkgbGlicmUuXG4gIGZ1bmN0aW9uIGZtdFN0b2NrKHNrdSkge1xuICAgIGNvbnN0IGZuUmVhbCA9XG4gICAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGVcbiAgICAgICAgOiBudWxsO1xuICAgIGlmIChmblJlYWwpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHYgPSBmblJlYWwoc2t1KTtcbiAgICAgICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgICAgICByZXR1cm4gTnVtYmVyKHYpIHx8IDA7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvLyBmYWxsYmFjayBhIHN0b2NrIGZcdTAwRURzaWNvIGFiYWpvXG4gICAgICB9XG4gICAgfVxuICAgIC8vIEZhbGxiYWNrOiBzdG9jayBmXHUwMEVEc2ljbyBkZXAgMTEgKHNpIGdldFN0b2NrUmVhbG1lbnRlRGlzcG9uaWJsZSBubyBlc3RcdTAwRTEgZGlzcG9uaWJsZSxcbiAgICAvLyBlai4gYm9vdHN0cmFwIG11eSB0ZW1wcmFubykuXG4gICAgY29uc3QgZm5GaXNpY28gPVxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHdpbmRvdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YVxuICAgICAgICA6IG51bGw7XG4gICAgY29uc3QgdkYgPSBmbkZpc2ljbyA/IGZuRmlzaWNvKHNrdSkgOiBudWxsO1xuICAgIGlmICh2RiA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcih2RikgfHwgMDtcbiAgfVxuICBmdW5jdGlvbiBmbXRQcmVjaW8oc2t1KSB7XG4gICAgY29uc3QgcCA9IHR5cGVvZiBQUklDRV9MSVNUX01BUCA9PT0gJ29iamVjdCcgJiYgUFJJQ0VfTElTVF9NQVAgPyBQUklDRV9MSVNUX01BUFtza3VdIDogbnVsbDtcbiAgICBpZiAocCA9PSBudWxsKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIE51bWJlcihwKSB8fCAwO1xuICB9XG4gIC8vIHYxMzY0ICgyMDI2LTEwLTE5KTogcmV3b3JrIGRlbCBleHBvcnQgcG9yIHBlZGlkbyBNYXJpYW5vOlxuICAvLyAtIEhvamEgcHJpbmNpcGFsIHJlbm9tYnJhZGEgXCJQcmVjaW9zIHkgU3RvY2tcIiAtPiBcIkxpc3RhIGRlIHByZWNpb3NcIi5cbiAgLy8gLSBOdWV2YSBjb2x1bW5hIFwiRGlzcG9uaWJpbGlkYWRcIiAoRElTUE9OSUJMRSB2ZXJkZSBzaSBTdG9jaz4wLCBOTyBESVNQT05JQkxFXG4gIC8vICAgcm9qbyBzaSBTdG9jazw9MCBvIHZhY2lvKS5cbiAgLy8gLSBIb2phIFwiSW5mb1wiIGVsaW1pbmFkYS5cbiAgLy8gLSBOb21icmUgYXJjaGl2bzogUHJlY2lvc195X1N0b2NrX1lZWVktTU0tREQueGxzeCAtPiBMaXN0YV9kZV9QcmVjaW9zX1lZWVktTU0tREQueGxzeC5cbiAgLy8gSG9qYXMgXCJQcmVjaW9zXCIgeSBcIlN0b2NrXCIgc2UgbWFudGllbmVuIHBvciBzaSBNYXJpYW5vIGxhcyB1c2EuXG4gIGZ1bmN0aW9uIGRpc3BMYWJlbChzdG9ja1ZhbCkge1xuICAgIGlmIChzdG9ja1ZhbCA9PT0gJycgfHwgc3RvY2tWYWwgPT0gbnVsbCkgcmV0dXJuICdOTyBESVNQT05JQkxFJztcbiAgICByZXR1cm4gTnVtYmVyKHN0b2NrVmFsKSA+IDAgPyAnRElTUE9OSUJMRScgOiAnTk8gRElTUE9OSUJMRSc7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFBST0RVQ1RTLm1hcCgocCkgPT4ge1xuICAgIGNvbnN0IHN0ID0gZm10U3RvY2socC5jb2RlKTtcbiAgICByZXR1cm4ge1xuICAgICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgICBEZXNjcmlwY2lvbjogcC5kZXNjIHx8ICcnLFxuICAgICAgRmFtaWxpYTogcC5mYW0gfHwgJycsXG4gICAgICBTdWJmYW1pbGlhOiBwLnN1YiB8fCAnJyxcbiAgICAgIENhdGVnb3JpYTogcC5jYXQgfHwgJycsXG4gICAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICAgICAgU3RvY2s6IHN0LFxuICAgICAgRGlzcG9uaWJpbGlkYWQ6IGRpc3BMYWJlbChzdCksXG4gICAgfTtcbiAgfSkuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3QgcHJlY2lvc1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgU0tVOiBwLmNvZGUgfHwgJycsXG4gICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAnUHJlY2lvIEFSUyc6IGZtdFByZWNpbyhwLmNvZGUpLFxuICB9KSlcbiAgICAuZmlsdGVyKChyKSA9PiByWydQcmVjaW8gQVJTJ10gIT09ICcnKVxuICAgIC5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCBzdG9ja1Jvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+IHtcbiAgICBjb25zdCBzdCA9IGZtdFN0b2NrKHAuY29kZSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAgIFN0b2NrOiBzdCxcbiAgICAgIERpc3BvbmliaWxpZGFkOiBkaXNwTGFiZWwoc3QpLFxuICAgIH07XG4gIH0pLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZG93bmxvYWRYbHN4KFxuICAgICdMaXN0YV9kZV9QcmVjaW9zXycgKyB0cyArICcueGxzeCcsXG4gICAgW1xuICAgICAgeyBuYW1lOiAnTGlzdGEgZGUgcHJlY2lvcycsIHJvd3MgfSxcbiAgICAgIHsgbmFtZTogJ1ByZWNpb3MnLCByb3dzOiBwcmVjaW9zUm93cyB9LFxuICAgICAgeyBuYW1lOiAnU3RvY2snLCByb3dzOiBzdG9ja1Jvd3MgfSxcbiAgICBdLFxuICAgIHtcbiAgICAgIC8vIFBhaW50ZXIgYXBsaWNhZG8gcG9zdC1yZW5kZXIgcG9yIGRvd25sb2FkWGxzeC4gUGludGEgbGEgY29sdW1uYVxuICAgICAgLy8gXCJEaXNwb25pYmlsaWRhZFwiIHNlZ3VuIHN1IHZhbG9yOiB2ZXJkZStibGFuY28gc2kgRElTUE9OSUJMRSxcbiAgICAgIC8vIHJvam8rYmxhbmNvIHNpIE5PIERJU1BPTklCTEUuIENlbnRyYWRvICsgYm9sZCBwYXJhIGxlZ2liaWxpZGFkLlxuICAgICAgY2VsbFN0eWxlcjogKGNlbGwsIGNvbHVtbk5hbWUsIF92YWx1ZSwgX3Jvd0luZGV4KSA9PiB7XG4gICAgICAgIGlmIChjb2x1bW5OYW1lICE9PSAnRGlzcG9uaWJpbGlkYWQnKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHR4dCA9IFN0cmluZyhjZWxsLnZhbHVlIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBpZiAodHh0ID09PSAnRElTUE9OSUJMRScpIHtcbiAgICAgICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYxNkEzNEEnIH0gfTsgLy8gZ3JlZW4tNjAwXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUgfTtcbiAgICAgICAgfSBlbHNlIGlmICh0eHQgPT09ICdOTyBESVNQT05JQkxFJykge1xuICAgICAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRkRDMjYyNicgfSB9OyAvLyByZWQtNjAwXG4gICAgICAgICAgY2VsbC5mb250ID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUgfTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9XG4gICk7XG4gIHNob3dTeW5jVGFnKHJvd3MubGVuZ3RoICsgJyBTS1VzIGV4cG9ydGFkb3MgKGxpc3RhIGRlIHByZWNpb3MgKyBkaXNwb25pYmlsaWRhZCknKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIC0gZGlhbG9nbyBkZSBzZWxlY2Npb24gKyAzIGZvcm1hdG9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbndpbmRvdy5leHBvcnRUb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBvcGNpb25lcyBzZWd1biByb2wuXG4gIC8vICAgdmVuZGVkb3I6IG9wZXJhdGl2byBkaWFyaW8gKFZlbnRhcyAvIFZpc2l0YXMgLyBSdXRhcykgKyBDbGllbnRlcyBkZSBzdSB6b25hXG4gIC8vICAgICAoZXhwb3J0TWFzdGVyQ2xpZW50ZXMgeWEgZmlsdHJhIHBvciBnZXRFZmZlY3RpdmVWZW5kb3JTZXQgLT4gc29sbyBzdSB2ZW5kb3IpLlxuICAvLyAgIGludGVybm8gKFZESSk6IG1pc21vIHNjb3BlIG9wZXJhdGl2byArIENsaWVudGVzIGRlIHN1cyBwYXJlamFzIChvIHNvbG8gZWxcbiAgLy8gICAgIHByb3BpbyBzaSBlbGlnaW8gc3Ugbm9tYnJlIGVuIGVsIGRyb3Bkb3duIGRlIHpvbmFzKS5cbiAgLy8gICBhZG1pbiAvIGdlcmVudGUgLyB2aWV3ZXI6IHZlbiB0b2RvIGVsIGxpc3RhZG8gKG51bGwgPSBzaW4gZmlsdHJvKS5cbiAgY29uc3QgYWxsb3dlZEJ5Um9sZSA9IHtcbiAgICAvLyB2NzExICgyMDI2LTA4LTI4KTogVkVOVEFTIHkgUlVUQVMgZWxpbWluYWRvcyBkZWwgVUkgcG9yIHBlZGlkbyBkZSBNYXJpYW5vLlxuICAgIHZlbmRlZG9yOiBuZXcgU2V0KFsnVklTSVRBUycsICdNQVNURVInLCAnQkFDS09SREVSJywgJ1NUT0NLX0FTSUcnLCAnUEVESURPU19NRVMnXSksXG4gICAgaW50ZXJubzogbmV3IFNldChbJ1ZJU0lUQVMnLCAnTUFTVEVSJywgJ0JBQ0tPUkRFUicsICdTVE9DS19BU0lHJywgJ1BFRElET1NfTUVTJ10pLFxuICB9O1xuICBsZXQgYWxsb3dlZCA9IGFsbG93ZWRCeVJvbGVbdXNlclJvbGVdIHx8IG51bGw7IC8vIG51bGwgPSB2ZXIgdG9kb1xuICAvLyB2MTUzNyAoMjAyNi0xMS0wMik6IFBBQ0hJIChwZXJmaWwgcmVzdHJpbmdpZG8pIHRhbWJpXHUwMEU5biB2ZSBcIlByZWNpb3MgKyBTdG9ja1wiXG4gIC8vIChsaXN0YSBkZSBwcmVjaW9zKS4gQXV0b3JpemFkbyBwb3IgTWFyaWFuby4gU29sbyBQQUNISSwgbm8gdG9kb3MgbG9zIFZERS5cbiAgaWYgKFxuICAgIGFsbG93ZWQgJiZcbiAgICB0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnICYmXG4gICAgZG9jdW1lbnQuYm9keSAmJlxuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmNvbnRhaW5zKCdpcy1wYWNoaS1yZXN0cmljdGVkJylcbiAgKSB7XG4gICAgLy8gdjE1NDM6ICsgQkFDS09SREVSICh5YSBlc3RcdTAwRTEgZW4gdmVuZGVkb3I7IHNlIGV4cGxpY2l0YSBwb3Igc2kgUEFDSElcbiAgICAvLyB0dXZpZXJhIG90cm8gcm9sKS4gRWwgZXhwb3J0IGZpbHRyYSBhIHN1cyBjbGllbnRlcyB2XHUwMEVEYSBleHBvcnQtc2NvcGUuXG4gICAgYWxsb3dlZCA9IG5ldyBTZXQoWy4uLmFsbG93ZWQsICdQUkVDSU9TX1NUT0NLJywgJ0JBQ0tPUkRFUiddKTtcbiAgfVxuICAvLyB2MTQxMyBcdTAwQTc1MSArIHYxNDE0IFx1MDBBNzUxLjEgKDIwMjYtMTAtMjIpOiBJTkZSQUNDSU9ORVNfTUVMSSB3aGl0ZWxpc3QgcG9yXG4gIC8vIGVtYWlsLiBNYW50ZW5lciBzaW5jcm9uaXphZG8gY29uIGNhblJlYWRJbmZyYWNjaW9uZXNNZWxpKCkgZGVcbiAgLy8gZmlyZXN0b3JlLnJ1bGVzLiBSZWFkZXJzOiBNYXJpYW5vICgyIGVtYWlscykgKyBEaWVnbyBWYWxzaS5cbiAgY29uc3QgSU5GUkFDQ0lPTkVTX01FTElfUkVBREVSUyA9IFtcbiAgICAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nLFxuICAgICdtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsXG4gICAgJ2RpZWdvLnZhbHNpQHNoaW1hbm8udXknLFxuICBdO1xuICBjb25zdCBfY2FuUmVhZEluZnJhY2Npb25lc01lbGkgPVxuICAgIHR5cGVvZiBjdXJyZW50VXNlciAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICBjdXJyZW50VXNlciAmJlxuICAgIElORlJBQ0NJT05FU19NRUxJX1JFQURFUlMuaW5jbHVkZXMoKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpKTtcbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2V4cG9ydC1tb2RhbCAuZXhwLW9wdCcpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2luZCA9IGVsLmRhdGFzZXQuZXhwS2luZCB8fCAnJztcbiAgICBsZXQgc2hvdyA9ICFhbGxvd2VkIHx8IGFsbG93ZWQuaGFzKGtpbmQpO1xuICAgIGlmIChraW5kID09PSAnSU5GUkFDQ0lPTkVTX01FTEknICYmICFfY2FuUmVhZEluZnJhY2Npb25lc01lbGkpIHNob3cgPSBmYWxzZTtcbiAgICBlbC5zdHlsZS5kaXNwbGF5ID0gc2hvdyA/ICcnIDogJ25vbmUnO1xuICB9KTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VFeHBvcnREaWFsb2cgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1vbnRoIHBpY2tlciByZXV0aWxpemFibGUgcGFyYSBsb3MgNSB0aXBvcyBkZSBleHBvcnRcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxubGV0IHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbmNvbnN0IEVYUE9SVF9UWVBFX0xBQkVMUyA9IHtcbiAgVkVOVEFTOiAnVmVudGFzJyxcbiAgVklTSVRBUzogJ1Zpc2l0YXMnLFxuICBSRU5ESUNJT05FUzogJ1JlbmRpY2lvbmVzJyxcbiAgUlVUQVM6ICdSdXRhcycsXG4gIEFMVEFTOiAnQWx0YXMgZGUgY2xpZW50ZXMnLFxuICBCQUNLT1JERVI6ICdCYWNrb3JkZXInLFxuICBTVE9DS19BU0lHOiAnU3RvY2sgQXNpZ25hZG8nLFxuICBQRURJRE9TX01FUzogJ1BlZGlkb3MgZGVsIG1lcycsXG59O1xuXG53aW5kb3cuc2hvd01vbnRoUGlja2VyID0gZnVuY3Rpb24gKHRpcG8pIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gdGlwbztcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tdGl0bGUnKTtcbiAgY29uc3Qgc3VidCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1zdWJ0Jyk7XG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0V4cG9ydGFyICcgKyAoRVhQT1JUX1RZUEVfTEFCRUxTW3RpcG9dIHx8IHRpcG8pO1xuICBzdWJ0LnRleHRDb250ZW50ID0gJ0VsZWdpIGVsIG1lcyB5IGFcdTAwRjFvIHF1ZSBxdWVyZXMgZGVzY2FyZ2FyLic7XG4gIC8vIFBvcHVsYXRlIHNlbGVjdHNcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgbWVzU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpO1xuICBtZXNTZWwuaW5uZXJIVE1MID1cbiAgICAnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zIGxvcyBtZXNlcyAoYVx1MDBGMW8gZW50ZXJvKTwvb3B0aW9uPicgK1xuICAgIE1FU0VTLm1hcCgobSwgaSkgPT4gJzxvcHRpb24gdmFsdWU9XCInICsgaSArICdcIj4nICsgbSArICc8L29wdGlvbj4nKS5qb2luKCcnKTtcbiAgbWVzU2VsLnZhbHVlID0gbm93LmdldE1vbnRoKCk7XG4gIGNvbnN0IGFuaW9TZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tYW5pbycpO1xuICBjb25zdCB5ZWFyID0gbm93LmdldEZ1bGxZZWFyKCk7XG4gIGxldCB5b3B0cyA9ICcnO1xuICBmb3IgKGxldCB5ID0geWVhciAtIDM7IHkgPD0geWVhciArIDE7IHkrKylcbiAgICB5b3B0cyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyB5ICsgJ1wiPicgKyB5ICsgJzwvb3B0aW9uPic7XG4gIGFuaW9TZWwuaW5uZXJIVE1MID0geW9wdHM7XG4gIGFuaW9TZWwudmFsdWUgPSB5ZWFyO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcblxud2luZG93LmNsb3NlTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbn07XG5cbndpbmRvdy5jb25maXJtTW9udGhQaWNrZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHRpcG8gPSBwZW5kaW5nRXhwb3J0VHlwZTtcbiAgY29uc3QgbWVzUmF3ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLW1lcycpLnZhbHVlO1xuICBjb25zdCBhbmlvID0gcGFyc2VJbnQoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKS52YWx1ZSwgMTApO1xuICBjb25zdCBtb250aElkeCA9IG1lc1JhdyA9PT0gJ0FMTCcgPyBudWxsIDogcGFyc2VJbnQobWVzUmF3LCAxMCk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9udGgtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHBlbmRpbmdFeHBvcnRUeXBlID0gbnVsbDtcbiAgaWYgKCF0aXBvKSByZXR1cm47XG4gIHRyeSB7XG4gICAgLy8gdjE1NjUgKDIwMjYtMTEtMTgpOiBvcGNpb25lcyBlbGltaW5hZGFzIGRlbCBtb2RhbCAoQUxUQVMsIFZFTlRBU19BUlRfQ0xJLFxuICAgIC8vIFNUT0NLX0FTSUcsIFBFTkRJRU5URV9BU0lHX1BBQkxPLCBJTkZSQUNDSU9ORVNfTUVMSSkuIERpc3BhdGNoZXIgcmVkdWNpZG8uXG4gICAgaWYgKHRpcG8gPT09ICdWRU5UQVMnKSBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1ZJU0lUQVMnKSBleHBvcnRWaXNpdGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSRU5ESUNJT05FUycpIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdSVVRBUycpIGV4cG9ydFJ1dGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdCQUNLT1JERVInKSBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBpZiAodGlwbyA9PT0gJ1BFRElET1NfTUVTJykgZXhwb3J0UGVkaWRvc01lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGFsZXJ0KCdUaXBvIGRlc2Nvbm9jaWRvOiAnICsgdGlwbyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnQgJyArIHRpcG8sIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZXhwb3J0OiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gU3RyaW5nKGFuaW8pO1xuICByZXR1cm4gTUVTRVNbbW9udGhJZHhdICsgJ18nICsgYW5pbztcbn1cblxuLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWVzY3JpdG8gY29uIEV4Y2VsSlMgcGFyYSBkYXIgVUkgdW5pZm9ybWUgYSBUT0RPUyBsb3Ncbi8vIGV4cG9ydHMgKGhlYWRlciB2ZXJkZSArIGNlbGRhcyBjZW50ZXJlZCArIGJvcmRlciBzdXRpbCArIGF1dG8tZml0IHdpZHRoKS5cbi8vIEFudGVzIHVzYWJhIFhMU1ggU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmEgc2lsZW50bHkgbG9zIGVzdGlsb3MgZGUgY2VsZGEuIEVsXG4vLyBwYXR0ZXJuIHZlcmRlIHJlcGxpY2EgZWwgVE9UQUwgYmFyIGRlIGV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsIChtb2RhbFxuLy8gQmFja29yZGVyIHY3MjArKS4gRXhjZWxKUyB5YSBzZSBjYXJnYSBvbi1kZW1hbmQgdmlhIHdpbmRvdy5sb2FkRXhjZWxKUy5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkWGxzeChmaWxlbmFtZSwgc2hlZXRzLCBvcHRzKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgd2luZG93LmxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnTm8gc2UgcHVkbyBjYXJnYXIgRXhjZWxKUzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIGNvbnN0IEhFQURFUl9GSUxMID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMTY2NTM0JyB9IH07XG4gIGNvbnN0IEhFQURFUl9GT05UID0geyBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIGJvbGQ6IHRydWUsIHNpemU6IDEyIH07XG4gIGNvbnN0IENFTlRFUiA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgY29uc3QgQk9SREVSX1RISU4gPSB7IHN0eWxlOiAndGhpbicsIGNvbG9yOiB7IGFyZ2I6ICdGRkNDQ0NDQycgfSB9O1xuICBjb25zdCBCT1JERVIgPSB7IHRvcDogQk9SREVSX1RISU4sIGxlZnQ6IEJPUkRFUl9USElOLCBib3R0b206IEJPUkRFUl9USElOLCByaWdodDogQk9SREVSX1RISU4gfTtcbiAgLy8gdjEzNjQ6IGNlbGxTdHlsZXIgb3BjaW9uYWwgcGFyYSBjb2xvcmVhciBjZWxkYXMgcG9yIHZhbG9yIChlai4gY29sdW1uYVxuICAvLyBEaXNwb25pYmlsaWRhZCBESVNQT05JQkxFIHZlcmRlIC8gTk8gRElTUE9OSUJMRSByb2pvIGVuIGVsIGV4cG9ydFxuICAvLyBMaXN0YSBkZSBwcmVjaW9zKS4gU2lnbmF0dXJlOiAoY2VsbCwgY29sdW1uTmFtZSwgdmFsdWUsIHJvd0luZGV4KSA9PiB2b2lkLlxuICBjb25zdCBjZWxsU3R5bGVyID0gb3B0cyAmJiB0eXBlb2Ygb3B0cy5jZWxsU3R5bGVyID09PSAnZnVuY3Rpb24nID8gb3B0cy5jZWxsU3R5bGVyIDogbnVsbDtcblxuICBmb3IgKGNvbnN0IHMgb2Ygc2hlZXRzKSB7XG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQocy5uYW1lLnNsaWNlKDAsIDMxKSk7XG4gICAgY29uc3Qgcm93cyA9IHMucm93cy5sZW5ndGggPyBzLnJvd3MgOiBbeyBBdmlzbzogJ1NpbiBkYXRvcyBwYXJhIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvJyB9XTtcbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmtleXMocm93c1swXSk7XG5cbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5hZGRSb3coaGVhZGVycyk7XG4gICAgaGVhZGVyUm93LmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICBjZWxsLmZpbGwgPSBIRUFERVJfRklMTDtcbiAgICAgIGNlbGwuZm9udCA9IEhFQURFUl9GT05UO1xuICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICBjZWxsLmJvcmRlciA9IEJPUkRFUjtcbiAgICB9KTtcbiAgICBoZWFkZXJSb3cuaGVpZ2h0ID0gMjY7XG5cbiAgICBmb3IgKGxldCBySWR4ID0gMDsgcklkeCA8IHJvd3MubGVuZ3RoOyBySWR4KyspIHtcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3NbcklkeF07XG4gICAgICBjb25zdCB2YWx1ZXMgPSBoZWFkZXJzLm1hcCgoaCkgPT4gKHJvd1toXSAhPT0gdW5kZWZpbmVkICYmIHJvd1toXSAhPT0gbnVsbCA/IHJvd1toXSA6ICcnKSk7XG4gICAgICBjb25zdCBkYXRhUm93ID0gd3MuYWRkUm93KHZhbHVlcyk7XG4gICAgICBkYXRhUm93LmVhY2hDZWxsKChjZWxsLCBjb2xOdW1iZXIpID0+IHtcbiAgICAgICAgY2VsbC5hbGlnbm1lbnQgPSBDRU5URVI7XG4gICAgICAgIGNlbGwuYm9yZGVyID0gQk9SREVSO1xuICAgICAgICBpZiAoY2VsbFN0eWxlcikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjZWxsU3R5bGVyKGNlbGwsIGhlYWRlcnNbY29sTnVtYmVyIC0gMV0sIHZhbHVlc1tjb2xOdW1iZXIgLSAxXSwgcklkeCk7XG4gICAgICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgICAgIC8vIG5vLW9wOiBubyByb21wZXIgZWwgZXhwb3J0IHBvciB1biBlcnJvciBkZSBzdHlsZXJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGhlYWRlcnMuZm9yRWFjaCgoaCwgaSkgPT4ge1xuICAgICAgbGV0IG1heExlbiA9IFN0cmluZyhoKS5sZW5ndGg7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHYgPSBTdHJpbmcocm93W2hdID09PSB1bmRlZmluZWQgfHwgcm93W2hdID09PSBudWxsID8gJycgOiByb3dbaF0pLnNwbGl0KCdcXG4nKVswXTtcbiAgICAgICAgaWYgKHYubGVuZ3RoID4gbWF4TGVuKSBtYXhMZW4gPSB2Lmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIHdzLmdldENvbHVtbihpICsgMSkud2lkdGggPSBNYXRoLm1pbig2MCwgTWF0aC5tYXgoMTAsIG1heExlbiArIDQpKTtcbiAgICB9KTtcblxuICAgIHdzLnZpZXdzID0gW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV07XG4gIH1cblxuICBjb25zdCBidWYgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gIH0pO1xuICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICBhLmhyZWYgPSB1cmw7XG4gIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgYS5jbGljaygpO1xuICBhLnJlbW92ZSgpO1xuICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVkVOVEFTOiBwZWRpZG9zIGNvbmZpcm1hZG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZlbnRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBwZWRpZG9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgcCA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludChwLnllYXIsIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBwYXJzZUludChwLm1vbnRoSWR4LCAxMCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgY29uc3QgbGluZXMgPSBwLmxpbmVzIHx8IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgdmVuZG9yS2V5ID0gcC52ZW5kb3IgfHwgbG9va3VwVmVuZG9yRm9yQ2xpZW50KHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKSB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3JJbmZvID0gdmVuZG9yTG9va3VwW3ZlbmRvcktleV0gfHwge307XG4gICAgY29uc3QgZmFjdG9yID0gdHlwZW9mIHBlZGlkb0Rpc2NvdW50RmFjdG9yID09PSAnZnVuY3Rpb24nID8gcGVkaWRvRGlzY291bnRGYWN0b3IocCkgOiAxO1xuICAgIGNvbnN0IGRpc2NQY3QgPSAocC5kaXNjb3VudFNuYXBzaG90ICYmIHAuZGlzY291bnRTbmFwc2hvdC5wY3RUb3RhbCkgfHwgMDtcbiAgICBsaW5lcy5mb3JFYWNoKChsKSA9PiB7XG4gICAgICBjb25zdCBxdHkgPSBwYXJzZUZsb2F0KGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gcGFyc2VGbG9hdChsLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IGdyb3NzID0gcXR5ICogcHJlY2lvO1xuICAgICAgY29uc3QgbmV0ID0gZ3Jvc3MgKiBmYWN0b3I7XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBNZXM6IHAubW9udGggfHwgJycsXG4gICAgICAgIEZlY2hhX0NvbmZpcm1hZG86IHAuY29uZmlybWVkQXQgPyBTdHJpbmcocC5jb25maXJtZWRBdCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICAgIEVzdGFkbzogcC5zdGFnZSB8fCAnJyxcbiAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3JLZXkgfHwgJycpLFxuICAgICAgICBab25hOiB2ZW5kb3JJbmZvLnpvbmUgfHwgJycsXG4gICAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UgfHwgJycpLFxuICAgICAgICBMb2NhbGlkYWQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgQ2xpZW50ZTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDb2RpZ29fU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIFByb2R1Y3RvOiBsLmRlc2MgfHwgJycsXG4gICAgICAgIENhdGVnb3JpYTogbC5jYXQgfHwgJycsXG4gICAgICAgIEZhbWlsaWE6IGwuZmFtIHx8ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiBsLnN1YiB8fCAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IHF0eSxcbiAgICAgICAgUHJlY2lvX1VuaXRfQVJTOiBwcmVjaW8sXG4gICAgICAgIC8vIFN1YnRvdGFsX0FSUyA9IE5FVE8gKGNvbiBkZXNjdWVudG8gYXBsaWNhZG8pIC0gZXMgbG8gcXVlIGN1ZW50YVxuICAgICAgICAvLyBwYXJhIGVsIHRhcmdldCBkZWwgdmVuZGVkb3IuIFN1YnRvdGFsX0JydXRvX0FSUyBtdWVzdHJhIGVsIHZhbG9yXG4gICAgICAgIC8vIGRlIGxpc3RhIHNpbiBkZXNjdWVudG8gcGFyYSB0cmF6YWJpbGlkYWQuXG4gICAgICAgIFN1YnRvdGFsX0FSUzogTWF0aC5yb3VuZChuZXQpLFxuICAgICAgICBTdWJ0b3RhbF9CcnV0b19BUlM6IE1hdGgucm91bmQoZ3Jvc3MpLFxuICAgICAgICBEZXNjdWVudG9fUGN0OiBkaXNjUGN0LFxuICAgICAgICBFbl9Ob21icmVfRGVfVkRFOiBwLm9uQmVoYWxmT2YgPyAnU0knIDogJ05PJyxcbiAgICAgICAgQ2FyZ2Fkb19Qb3I6IHAuY3JlYXRlZEJ5RGlzcGxheU5hbWUgfHwgcC5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19WZW50YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1ZlbnRhcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IFZlbnRhcyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmZ1bmN0aW9uIGxvb2t1cFZlbmRvckZvckNsaWVudChwcm92LCBsb2NOYW1lLCBfY2xpZW50TmFtZSkge1xuICBpZiAoIXByb3YgfHwgIWxvY05hbWUpIHJldHVybiAnJztcbiAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdiAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xuICByZXR1cm4gcHQgPyBwdC52ZW5kb3IgfHwgJycgOiAnJztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWSVNJVEFTOiBkZXRhbGxlIGRlIHZpc2l0YXMgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFZpc2l0YXMgKyBDb250YWN0b3MuLi4nKTtcbiAgLy8gdjE1MzQ6IGVsIHZlbmRlZG9yIGNvbnN1bHRhIHNvbG8gc3VzIHZpc2l0YXMgKGxhcyByZWdsYXMgbm8gbGUgZGVqYW5cbiAgLy8gbGlzdGFyIHRvZGFzKTsgZWwgaW50ZXJubyB2ZSBsYXMgc3V5YXMgKyBsYXMgZGUgc3VzIHBhcmVqYXMuXG4gIGNvbnN0IHNjb3BlID0gX2V4cG9ydFNjb3BlKCk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIGxldCBxID0gZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKTtcbiAgICBpZiAoc2NvcGUudmlzaXRzUXVlcnlCeU93bmVyVWlkKSB7XG4gICAgICBjb25zdCB1ID0gd2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoICYmIHdpbmRvdy5maXJlYmFzZS5hdXRoKCkuY3VycmVudFVzZXI7XG4gICAgICBxID0gcS53aGVyZSgnb3duZXJVaWQnLCAnPT0nLCAodSAmJiB1LnVpZCkgfHwgJ19fc2luX3VzdWFyaW9fXycpO1xuICAgIH1cbiAgICBzbmFwID0gYXdhaXQgcS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHZpc2l0YXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGFyZ2V0TWVzID0gbW9udGhJZHggIT09IG51bGwgPyBNRVNFU1ttb250aElkeF0udG9VcHBlckNhc2UoKSA6IG51bGw7XG4gIGNvbnN0IGFsbCA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCB2ID0gZC5kYXRhKCkgfHwge307XG4gICAgaWYgKHBhcnNlSW50KHYuYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKHRhcmdldE1lcyAmJiAodi5tZXMgfHwgJycpLnRvVXBwZXJDYXNlKCkgIT09IHRhcmdldE1lcykgcmV0dXJuO1xuICAgIGFsbC5wdXNoKHYpO1xuICB9KTtcbiAgY29uc3QgaXRlbXMgPSBzY29wZS5maWx0ZXJWaXNpdHMoYWxsKTtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgbmkgY29udGFjdG9zIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuVmlzaXRhcyA9IGl0ZW1zLmZpbHRlcigodikgPT4gdi5pbnRlcmFjdGlvblR5cGUgIT09ICdjb250YWN0bycpLmxlbmd0aDtcbiAgY29uc3QgbkNvbnRhY3RvcyA9IGl0ZW1zLmxlbmd0aCAtIG5WaXNpdGFzO1xuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGRlbCBmcmVudGUgZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBMYXp5IGxvYWQuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbDogJyArIG5WaXNpdGFzICsgJyB2aXNpdGFzICsgJyArIG5Db250YWN0b3MgKyAnIGNvbnRhY3Rvcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIC8vIHYxNTY1ICgyMDI2LTExLTE4KTogMTYgY29sdW1uYXMgZXhhY3RhcyBwb3IgcGVkaWRvIE1hcmlhbm8uIEhvamEgXCJWSVNJVEFTXCIuXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWSVNJVEFTJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGRUNIQV9ERV9WSVNJVEFTJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1ZFTkRFRE9SJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ0lOVEVSQUNDSU9OJywga2V5OiAnaW50ZXJhY2Npb24nLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ1RJUE8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdMT0NBTCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUQU1BXHUwMEQxTycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnRklERUxJREFEJywga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdSRUxFVkFOQ0lBJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXG4gICAgeyBoZWFkZXI6ICdNQVNfVkVORElETycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdNQVNfUFJFR1VOVEFOJywga2V5OiAnbWFzUHInLCB3aWR0aDogMjQgfSxcbiAgICB7IGhlYWRlcjogJ0FZVURBX1RJRU5EQScsIGtleTogJ2F5dWRhJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdUSVBPX0RFX1ZFTlRBJywga2V5OiAndGlwb1ZlbnRhJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdQT05ERVJBQ0lPTl9NT1NUUkFET1InLCBrZXk6ICdwTW9zdCcsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnUE9OREVSQUNJT05fRUNPTU1FUkNFJywga2V5OiAncEVjb20nLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ0ZPVE9fRlJFTlRFJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7XG4gIGNvbnN0IFJPV19IID0gMTAwO1xuICBjb25zdCBJTUdfVyA9IDEzMDtcbiAgY29uc3QgSU1HX0ggPSA5MDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IHYgb2YgaXRlbXMpIHtcbiAgICBjb25zdCBpc0NvbnRhY3RvID0gdi5pbnRlcmFjdGlvblR5cGUgPT09ICdjb250YWN0byc7XG4gICAgY29uc3QgaW50ZXJhY2Npb25MYmwgPSBpc0NvbnRhY3RvID8gJ0NvbnRhY3RvJyA6ICdWaXNpdGEnO1xuICAgIGNvbnN0IGZvcm1hQ29udGFjdG9MYmwgPSBpc0NvbnRhY3RvID8gdi5mb3JtYUNvbnRhY3RvIHx8ICdTaW4gZXNwZWNpZmljYXInIDogJ1ByZXNlbmNpYWwnO1xuICAgIGxldCByZXN1bHRhZG9DdExibCA9ICcnO1xuICAgIGlmIChpc0NvbnRhY3RvKSB7XG4gICAgICBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ1Jlc3BvbmRpbyc7XG4gICAgICBlbHNlIGlmICh2LmNvbnRhY3RvUmVzdWx0YWRvID09PSAnbm9fcmVzcG9uZGlvJykgcmVzdWx0YWRvQ3RMYmwgPSAnTm8gcmVzcG9uZGlvJztcbiAgICAgIGVsc2UgcmVzdWx0YWRvQ3RMYmwgPSAnU2luIG1hcmNhcic7XG4gICAgfVxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgaW50ZXJhY2Npb246IGludGVyYWNjaW9uTGJsLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgbWFzVmU6IHYubWFzVmVuZGlkbyB8fCAnJyxcbiAgICAgIG1hc1ByOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgIGF5dWRhOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgICBwTW9zdDogdi5wb25kZXJhY2lvbk1vc3RyYWRvIHx8ICcnLFxuICAgICAgcEVjb206IHYucG9uZGVyYWNpb25FY29tbWVyY2UgfHwgJycsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBpbWFnZW4gZW5jaW1hXG4gICAgfSk7XG4gICAgLy8gdjE1NjU6IGZvcm1hQ29udGFjdG8vcmVzdWx0YWRvQ3Qgc2lndWVuIGNvbXB1dGFkb3MgcGFyYSB1c28gZnV0dXJvIChubyBleHBvcnRhZGFzKS5cbiAgICB2b2lkIGZvcm1hQ29udGFjdG9MYmw7XG4gICAgdm9pZCByZXN1bHRhZG9DdExibDtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHJvdy5udW1iZXIgLSAxICsgMC4xIH0sXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gdmlzaXRhJywgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdWSVNJVEFTXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgbGlzdG86ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MnLCAyNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0YXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFTkRJQ0lPTkVTOiBnYXN0b3MgeSBhbnRpY2lwb3MgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSZW5kaWNpb25lcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcmVuZGljaW9uZXM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRmlsdHJhciBwb3IgbWVzL2FuaW9cbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgciA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9IHIuZmVjaGEgfHwgci5mZWNoYUdhc3RvIHx8ICcnO1xuICAgIGlmICghZHQgJiYgci5jcmVhdGVkQXQgJiYgci5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IHIuY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBjb25zdCBkT2JqID0gbmV3IERhdGUoZHQpO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oZE9iai5nZXRUaW1lKCkpKSByZXR1cm47XG4gICAgaWYgKGRPYmouZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkT2JqLmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgaXRlbXMucHVzaCh7IGlkOiBkLmlkLCBmZWNoYTogZHQsIHI6IHIgfSk7XG4gIH0pO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVuZGljaW9uZXMgZW4gZWwgcGVyaW9kbyBzZWxlY2Npb25hZG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEV4Y2VsSlMgY29uIGZvdG8gZW1iZWJpZGEgZW4gY2FkYSBmaWxhLiBDYXJnYSBsYXp5LlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBpdGVtcy5sZW5ndGggKyAnIHJlbmRpY2lvbmVzLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgLy8gdjE1NjUgKDIwMjYtMTEtMTgpOiAxMCBjb2x1bW5hcyBleGFjdGFzIHBvciBwZWRpZG8gTWFyaWFuby4gSG9qYSBcIlJlbmRpY2lvbmVzXCIuXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdSZW5kaWNpb25lcycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRkVDSEFfREVfUkVORElDSU9OJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1RJUE8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWRU5ERURPUicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDI2IH0sXG4gICAgeyBoZWFkZXI6ICdDT05DRVBUTycsIGtleTogJ2NvbmNlcHRvJywgd2lkdGg6IDIwIH0sXG4gICAgeyBoZWFkZXI6ICdOXHUwMEIwIFRJQ0tFVCcsIGtleTogJ251bVRpY2tldCcsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnVElQT19ERV9HQVNUTycsIGtleTogJ3RpcG9HYXN0bycsIHdpZHRoOiAyMCB9LFxuICAgIHsgaGVhZGVyOiAnSU1QT1JURScsIGtleTogJ2ltcG9ydGUnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ09CU0VSVkFDSU9ORVMnLCBrZXk6ICdvYnMnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ0ZPVE9fVElDS0VUJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnRVNUQURPJywga2V5OiAnZXN0YWRvJywgd2lkdGg6IDE4IH0sXG4gIF07XG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkY3RTIyQ0UnIH0gfTtcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XG5cbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcbiAgY29uc3QgUk9XX0ggPSAxMTA7XG4gIGNvbnN0IElNR19XID0gMTQwO1xuICBjb25zdCBJTUdfSCA9IDEwMDtcblxuICAvLyBPcmRlbiBjcm9ub2xvZ2ljbyBkZXNjXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcblxuICBmb3IgKGNvbnN0IGl0IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgciA9IGl0LnI7XG4gICAgY29uc3QgaXNHYXN0byA9IHIudGlwbyA9PT0gJ2dhc3RvJztcbiAgICBjb25zdCBjb25jZXB0U3RyID0gaXNHYXN0byA/IHIuZGVzY3JpcGNpb24gfHwgJycgOiByLnRpcG9PcGVyYWNpb24gfHwgci5tb3Rpdm8gfHwgJyc7XG4gICAgY29uc3Qgb2JzU3RyID1cbiAgICAgIChyLm9ic2VydmFjaW9uZXMgfHwgci5ub3RhcyB8fCAnJykgK1xuICAgICAgKGlzR2FzdG8gPyAnJyA6IHIuc29saWNpdGFkb1BvciA/ICcgfCBTb2xpY2l0YWRvIHBvcjogJyArIHIuc29saWNpdGFkb1BvciA6ICcnKTtcbiAgICAvLyB2MTU2NTogMTAgY29sdW1uYXMgZXhhY3Rhcy4gQ2FtcG9zIGxlZ2FjeSAoZW1haWwsIG1vZG9QYWdvLCBkaXZpc2lvbiwgbW9uZWRhLFxuICAgIC8vIGltcG9ydGVVc2QsIGFwcm9iYWRvciwgYXByb2JhZG9FbikgeWEgbm8gc2UgZXhwb3J0YW4gcG9yIHBlZGlkbyBNYXJpYW5vLlxuICAgIGNvbnN0IHJvdyA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogaXQuZmVjaGEsXG4gICAgICB0aXBvOiByLnRpcG8gfHwgJycsXG4gICAgICB2ZW5kZWRvcjogci5vd25lck5hbWUgfHwgci52ZW5kb3JOYW1lIHx8IHIub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIGNvbmNlcHRvOiBjb25jZXB0U3RyLFxuICAgICAgbnVtVGlja2V0OiByLm51bWVyb1RpY2tldCB8fCAnJyxcbiAgICAgIHRpcG9HYXN0bzogci50aXBvR2FzdG8gfHwgJycsXG4gICAgICBpbXBvcnRlOiByLmltcG9ydGUgIT0gbnVsbCA/IHIuaW1wb3J0ZSA6ICcnLFxuICAgICAgb2JzOiBvYnNTdHIsXG4gICAgICBmb3RvOiAnJywgLy8gY2VsZGEgdmFjaWEgLSBlbmNpbWEgdmEgbGEgaW1hZ2VuXG4gICAgICBlc3RhZG86IHIuc3RhdHVzIHx8IHIuZXN0YWRvIHx8ICcnLFxuICAgIH0pO1xuICAgIHJvdy5oZWlnaHQgPSBST1dfSDtcbiAgICByb3cuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IFNJRU1QUkUgZW1iZWJlciBsYSBmb3RvIChubyBkZWphciBoeXBlcmxpbmspLlxuICAgIC8vIEFudGVzOiBzaSBmb3RvVGlja2V0VXJsIChTdG9yYWdlKSwgcXVlZGFiYSBjb21vIGh5cGVybGluayBBYnJpciB0aWNrZXQuXG4gICAgLy8gQWhvcmE6IGZldGNoIGRlbCBVUkwgKyBjb252ZXJ0aXIgYSBhcnJheUJ1ZmZlciArIGVtYmViZXIgaWd1YWwgcXVlIGRhdGFVUkwuXG4gICAgLy8gRmFsbGJhY2sgYSBoeXBlcmxpbmsgc29sbyBzaSBlbCBmZXRjaCBmYWxsYSAoQ09SUywgcmVkLCBldGMpLlxuICAgIGNvbnN0IGZvdG9TcmMgPSByLmZvdG9UaWNrZXQgfHwgci5hZGp1bnRvIHx8ICcnO1xuICAgIGlmIChmb3RvU3JjICYmIHR5cGVvZiBmb3RvU3JjID09PSAnc3RyaW5nJyAmJiBmb3RvU3JjLnN0YXJ0c1dpdGgoJ2RhdGE6aW1hZ2UvJykpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCBiNjQgPSBmb3RvU3JjO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHJlbmRpY2lvbicsIGl0LmlkLCBlKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHIuZm90b1RpY2tldFVybCAmJiB0eXBlb2Ygci5mb3RvVGlja2V0VXJsID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IGZldGNoIGxhIGZvdG8gZGVzZGUgU3RvcmFnZSB5IGVtYmViZXJsYSBjb21vIGltYWdlbi5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBmZXRjaChyLmZvdG9UaWNrZXRVcmwpO1xuICAgICAgICBpZiAoIXJlc3Aub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgcmVzcC5zdGF0dXMpO1xuICAgICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlc3AuaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpIHx8ICdpbWFnZS9qcGVnJztcbiAgICAgICAgbGV0IGV4dCA9IGNvbnRlbnRUeXBlLnNwbGl0KCcvJylbMV0gfHwgJ2pwZWcnO1xuICAgICAgICBleHQgPSBleHQuc3BsaXQoJzsnKVswXS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgYnVmID0gYXdhaXQgcmVzcC5hcnJheUJ1ZmZlcigpO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBidWZmZXI6IGJ1ZiwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIEZhbGxiYWNrOiBzaSBlbCBmZXRjaCBmYWxsYSAoQ09SUywgcmVkKSwgZGVqYXIgaHlwZXJsaW5rIGNvbW8gYW50ZXMuXG4gICAgICAgIGNvbnNvbGUud2FybignZmV0Y2ggZm90byByZW5kaWNpb24gZmFsbG8sIGRlam8gaHlwZXJsaW5rJywgaXQuaWQsIGUpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGNlbGwgPSByb3cuZ2V0Q2VsbChGT1RPX0NPTF9JRFggKyAxKTtcbiAgICAgICAgICBjZWxsLnZhbHVlID0ge1xuICAgICAgICAgICAgdGV4dDogJ0FicmlyIHRpY2tldCcsXG4gICAgICAgICAgICBoeXBlcmxpbms6IHIuZm90b1RpY2tldFVybCxcbiAgICAgICAgICAgIHRvb2x0aXA6ICdBYnJpciBsYSBmb3RvIGRlbCB0aWNrZXQgZW4gZWwgYnJvd3NlciAoZmV0Y2ggZmFsbG8pJyxcbiAgICAgICAgICB9O1xuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGMDU2M0MxJyB9LCB1bmRlcmxpbmU6IHRydWUgfTtcbiAgICAgICAgfSBjYXRjaCAoX2UyKSB7fVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSAnUmVuZGljaW9uZXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBSZW5kaWNpb25lcyBsaXN0byAoJyArIGl0ZW1zLmxlbmd0aCArICcgZmlsYXMpJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUlVUQVM6IHJ1dGFzIGFzaWduYWRhcyBkZWwgcGVyaW9kbyArIG92ZXJyaWRlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFJ1dGFzLi4uJyk7XG4gIC8vIExhcyBydXRhcyBzZSBnZW5lcmFuIGVuIHJ1bnRpbWUgcGFyYSBjYWRhIHZlbmRlZG9yOyBlbiBjYW1iaW8gbG9zIG92ZXJyaWRlc1xuICAvLyAoZGVyaXZhY2lvbmVzIC8gcmVhZ2VuZGFzKSB2aXZlbiBlbiByb3V0ZV9vdmVycmlkZXMuIEV4cG9ydGFtb3M6XG4gIC8vICAtIHVuYSBob2phIGNvbiBsYXMgcnV0YXMgcGxhbmlmaWNhZGFzIGRlbCBwZXJpb2RvIChwYXJhIGxvcyB2ZW5kZWRvcmVzXG4gIC8vICAgIGRlbCByb2wgYWN0dWFsIG8gdG9kb3Mgc2kgYWRtaW4pXG4gIC8vICAtIHVuYSBob2phIGNvbiBsb3Mgb3ZlcnJpZGVzIGRlbCBwZXJpb2RvXG4gIGNvbnN0IHRhcmdldFZlbmRvcnMgPVxuICAgIHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAndmlld2VyJ1xuICAgICAgPyBWRU5ET1JTLm1hcCgodikgPT4gdi5rZXkpXG4gICAgICA6IGFzc2lnbmVkVmVuZG9yXG4gICAgICAgID8gW2Fzc2lnbmVkVmVuZG9yXVxuICAgICAgICA6IFtdO1xuICBjb25zdCBtb250aHNUb0V4cG9ydCA9IG1vbnRoSWR4ICE9PSBudWxsID8gW21vbnRoSWR4XSA6IFswLCAxLCAyLCAzLCA0LCA1LCA2LCA3LCA4LCA5LCAxMCwgMTFdO1xuICBjb25zdCBydXRhc1Jvd3MgPSBbXTtcbiAgZm9yIChjb25zdCB2ZW5kIG9mIHRhcmdldFZlbmRvcnMpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2YgbW9udGhzVG9FeHBvcnQpIHtcbiAgICAgIGxldCBydXRhcztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJ1dGFzID0gZ2VuZXJhclJ1dGFzVmVuZG9yKHZlbmQsIG0sIGFuaW8pO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgcnV0YXMgPSBbXTtcbiAgICAgIH1cbiAgICAgIChydXRhcyB8fCBbXSkuZm9yRWFjaCgocnV0YSkgPT4ge1xuICAgICAgICAocnV0YS50aWVuZGFzIHx8IFtdKS5mb3JFYWNoKCh0LCBpKSA9PiB7XG4gICAgICAgICAgcnV0YXNSb3dzLnB1c2goe1xuICAgICAgICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kKSxcbiAgICAgICAgICAgIEFuaW86IGFuaW8sXG4gICAgICAgICAgICBNZXM6IE1FU0VTW21dLFxuICAgICAgICAgICAgUnV0YV9JRDogcnV0YS5pZCB8fCAnJyxcbiAgICAgICAgICAgIFJ1dGFfTm9tYnJlOiBydXRhLm5vbWJyZSB8fCAnJyxcbiAgICAgICAgICAgIEZlY2hhX0FzaWduYWRhOiBydXRhLmZlY2hhQXNpZ25hZGEgfHwgJycsXG4gICAgICAgICAgICBPcmRlbjogaSArIDEsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh0LnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgICAgIExvY2FsaWRhZDogdC5sb2NOYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGllbmRhOiB0LmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgICAgICBUaXBvOiB0LnRpcG8gfHwgJycsXG4gICAgICAgICAgICBFc3RhZG86IHQuZXN0YWRvIHx8ICcnLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPdmVycmlkZXNcbiAgbGV0IG92clNuYXA7XG4gIHRyeSB7XG4gICAgb3ZyU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm91dGVfb3ZlcnJpZGVzJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgb3ZyU25hcCA9IG51bGw7XG4gIH1cbiAgY29uc3Qgb3ZlcnJpZGVzUm93cyA9IFtdO1xuICBpZiAob3ZyU25hcCkge1xuICAgIG92clNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgbyA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKHBhcnNlSW50KG8uYW5pbywgMTApICE9PSBhbmlvKSByZXR1cm47XG4gICAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQoby5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgICAgb3ZlcnJpZGVzUm93cy5wdXNoKHtcbiAgICAgICAgQW5pbzogby5hbmlvIHx8ICcnLFxuICAgICAgICBNZXM6IE1FU0VTW3BhcnNlSW50KG8ubW9udGhJZHgsIDEwKV0gfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uoby52ZW5kb3IgfHwgJycpLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShvLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBvLmxvY05hbWUgfHwgJycsXG4gICAgICAgIFRpZW5kYTogby5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBBY2Npb246IG8uYWN0aW9uIHx8IG8udGlwbyB8fCAnJyxcbiAgICAgICAgRGVyaXZhZGFfQTogby5kZXJpdmFkYUEgfHwgJycsXG4gICAgICAgIFJlYWdlbmRhZGFfUGFyYTogby5yZWFnZW5kYWRhUGFyYSB8fCAnJyxcbiAgICAgICAgTW90aXZvOiBvLm1vdGl2byB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX1Bvcjogby5jcmVhdGVkQnlFbWFpbCB8fCAnJyxcbiAgICAgICAgQ3JlYWRvX0VuOlxuICAgICAgICAgIG8uY3JlYXRlZEF0ICYmIG8uY3JlYXRlZEF0LnRvRGF0ZSA/IG8uY3JlYXRlZEF0LnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX1J1dGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFtcbiAgICB7IG5hbWU6ICdSdXRhcyBwbGFuaWZpY2FkYXMnLCByb3dzOiBydXRhc1Jvd3MgfSxcbiAgICB7IG5hbWU6ICdEZXJpdmFjaW9uZXMtUmVhZ2VuZGFzJywgcm93czogb3ZlcnJpZGVzUm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4cG9ydCBSdXRhcyBsaXN0byAoJyArIHJ1dGFzUm93cy5sZW5ndGggKyAnIHRpZW5kYXMsICcgKyBvdmVycmlkZXNSb3dzLmxlbmd0aCArICcgb3ZlcnJpZGVzKScsXG4gICAgMjQwMFxuICApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFMVEFTOiBzb2xpY2l0dWRlcyBkZSBhbHRhIGRlIGNsaWVudGUgZGVsIHBlcmlvZG9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QWx0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBBbHRhcy4uLicpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBhbHRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSAnJztcbiAgICBpZiAoYS5jcmVhdGVkQXQgJiYgYS5jcmVhdGVkQXQudG9EYXRlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkdCA9IGEuY3JlYXRlZEF0LnRvRGF0ZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIGlmICghZHQpIHJldHVybjtcbiAgICBpZiAoZHQuZ2V0RnVsbFllYXIoKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBkdC5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9Tb2xpY2l0dWQ6IGR0LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICAgRXN0YWRvOiBhLnN0YXR1cyB8fCAnJyxcbiAgICAgIENvbWVyY2lvOiBhLmNvbWVyY2lvIHx8ICcnLFxuICAgICAgRmFudGFzaWE6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICBDb25kaWNpb25fRmlzY2FsOiBhLmNvbmRGaXNjYWwgfHwgJycsXG4gICAgICBDYWxsZTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE51bWVybzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGEubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBhLnByb3ZpbmNpYSB8fCAnJyxcbiAgICAgIENQOiBhLmNwIHx8ICcnLFxuICAgICAgVGVsZWZvbm86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICBFbWFpbDogYS5lbWFpbCB8fCAnJyxcbiAgICAgIFZlbmRlZG9yX1NvbGljaXRhbnRlOiBhLnZlbmRvck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgT3duZXJfRW1haWw6IGEub3duZXJFbWFpbCB8fCAnJyxcbiAgICAgIFN1Ym1pdHRlZF9CeV9QdWJsaWNfRm9ybTogYS5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0gPyAnU0knIDogJ05PJyxcbiAgICAgIEFwcm9iYWRvX1BvcjogYS5hcHByb3ZlZEJ5RW1haWwgfHwgJycsXG4gICAgICBBcHJvYmFkb19FbjpcbiAgICAgICAgYS5hcHByb3ZlZEF0ICYmIGEuYXBwcm92ZWRBdC50b0RhdGUgPyBhLmFwcHJvdmVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJyxcbiAgICAgIFJlY2hhemFkb19Nb3Rpdm86IGEucmVqZWN0ZWRSZWFzb24gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmbmFtZSA9ICdTaGltYW5vX0FsdGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdBbHRhcyBkZSBjbGllbnRlcycsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEFsdGFzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIHNvbGljaXR1ZGVzKScsIDI0MDApO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHY3MDkgKDIwMjYtMDgtMjgpOiAzIGV4cG9ydHMgbnVldm9zIHBlZGlkb3MgcG9yIE1hcmlhbm8uXG4vLyAtIEJBQ0tPUkRFUjogbGluZWFzIHN0YXRlPUJPIG9wZW4gcG9yIG1lcyBkZSBjcmVhdGVkQXQgZGVsIHBlZGlkby5cbi8vIC0gU1RPQ0tfQVNJRzogbGluZWFzIEFTSUcgb3BlbiAobyBCTytzdG9jayBkaXNwKSBwb3IgbWVzIGRlIGNyZWF0ZWRBdC5cbi8vIC0gUEVESURPU19NRVM6IFRPRE9TIGxvcyBwZWRpZG9zIGNyZWFkb3MgZW4gZWwgbWVzL2FuaW8gKGN1YWxxdWllciBzdGFnZSkuXG4vLyBGdWVudGU6IGdsb2JhbFBlZGlkb3MgKGxvIHF1ZSBsYSBhcHAgeWEgdGllbmUgZW4gbWVtb3JpYSkuXG4vLyBGaWx0ZXIgbWVzL2FcdTAwRjFvOiBzb2JyZSBjcmVhdGVkQXQgZGVsIHBlZGlkby4gbW9udGhJZHg9bnVsbCAtPiBhXHUwMEYxbyBlbnRlcm8uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmZ1bmN0aW9uIF9wZWRpZG9Nb250aFllYXIocCkge1xuICBjb25zdCBjYSA9IHAuY3JlYXRlZEF0O1xuICBpZiAoIWNhKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIGxldCBkdCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY2EgPT09ICdzdHJpbmcnKSBkdCA9IG5ldyBEYXRlKGNhKTtcbiAgZWxzZSBpZiAodHlwZW9mIGNhLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICBkdCA9IGNhLnRvRGF0ZSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGVsc2UgaWYgKHR5cGVvZiBjYSA9PT0gJ251bWJlcicpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBpZiAoIWR0IHx8IE51bWJlci5pc05hTihkdC5nZXRUaW1lKCkpKSByZXR1cm4geyB5OiBudWxsLCBtOiBudWxsIH07XG4gIHJldHVybiB7IHk6IGR0LmdldEZ1bGxZZWFyKCksIG06IGR0LmdldE1vbnRoKCkgfTtcbn1cblxuZnVuY3Rpb24gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4LCBzY29wZSkge1xuICBjb25zdCBhcnIgPVxuICAgIHR5cGVvZiBnbG9iYWxQZWRpZG9zICE9PSAndW5kZWZpbmVkJyAmJiBBcnJheS5pc0FycmF5KGdsb2JhbFBlZGlkb3MpID8gZ2xvYmFsUGVkaWRvcyA6IFtdO1xuICAvLyB2MTUzNDogYWxjYW5jZSBwb3Igcm9sICh2ZW5kZWRvciA9IGNsaWVudGVzIGRlIHN1IG1hc3RlcjsgaW50ZXJubyA9IHBhcmVqYXMpLlxuICAvLyBQcmltZXJvIGVsIG1lcyAoYmFyYXRvKSB5IGRlc3B1XHUwMEU5cyBlbCBhbGNhbmNlIChyZXN1ZWx2ZSBlbCBtYXN0ZXIgcG9yIGNsaWVudGUpLlxuICBjb25zdCBkZWxNZXMgPSBhcnIuZmlsdGVyKChwKSA9PiB7XG4gICAgaWYgKCFwKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgeyB5LCBtIH0gPSBfcGVkaWRvTW9udGhZZWFyKHApO1xuICAgIGlmICh5ID09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoeSAhPT0gYW5pbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChtb250aElkeCAhPT0gbnVsbCAmJiBtICE9PSBtb250aElkeCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbiAgY29uc3Qgc2MgPSBzY29wZSB8fCBfZXhwb3J0U2NvcGUoKTtcbiAgcmV0dXJuIHNjLmZpbHRlclBlZGlkb3MoZGVsTWVzKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgQmFja29yZGVyLi4uJyk7XG4gIC8vIHYxMTAwOiBkZWxlZ2EgYWwgbVx1MDBGM2R1bG8gcHVyby4gRmlsdHJhIHBvciBtZXMgdlx1MDBFRGEgZmlsdGVycy5tZXNZWVlZTU1cbiAgLy8gKHF1ZSBlbCBtXHUwMEYzZHVsbyBhcGxpY2Egc29icmUgY29uZmlybWVkQXQpLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgbWVzWVlZWU1NID0gYW5pbyArICctJyArIFN0cmluZyhtb250aElkeCArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxuICAvLyBub3JtYWxpemFjaVx1MDBGM24gZGUgc3RyaW5ncykgeSBzXHUwMEYzbG8gY2FlciBhbCBjbGllbnRMb2NJZCBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc28uXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xuICAgICAgICBjYWNoZS5mb3JFYWNoKChjbURhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGNtRGF0YS5hc3NpZ25lZFZlbmRvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgICAgfVxuICAgICAgcmV0dXJuICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBwZWRpZG9zLFxuICAgICAgICAndXJnZW50ZScsXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHFvID0gYy5xdHlCYWNrb3JkZXIgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBjYW50aWRhZFBlZGlkYSA9IHFvO1xuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkge1xuICAgICAgICBjYW50aWRhZFBlZGlkYSA9IE51bWJlcihwLmxpbmVzW2lkeF0ucXR5KSB8fCBxbztcbiAgICAgICAgbGluZWFJZHggPSBpZHg7XG4gICAgICB9XG4gICAgfVxuICAgIHJvd3MucHVzaCh7XG4gICAgICBGZWNoYV9QZWRpZG86IGZlY2hhUGVkaWRvLFxuICAgICAgTWVzOiAocCAmJiBwLm1vbnRoKSB8fCAnJyxcbiAgICAgIENsaWVudGU6IGMubm9tYnJlIHx8ICcnLFxuICAgICAgQ2FyZENvZGU6IGMuY29kZSB8fCAocCAmJiBwLmNsaWVudENhcmRDb2RlKSB8fCAnJyxcbiAgICAgIFByb3ZpbmNpYTogYy5wcm92aW5jaWEgfHwgKHAgJiYgcC5wcm92aW5jZSkgfHwgJycsXG4gICAgICBMb2NhbGlkYWQ6IGMuY2l1ZGFkIHx8IChwICYmIHAubG9jTmFtZSkgfHwgJycsXG4gICAgICBWZW5kZWRvcjogYy52ZW5kb3JLZXkgfHwgJycsXG4gICAgICBTS1U6IHJsLnNrdSB8fCAnJyxcbiAgICAgIFByb2R1Y3RvOiBybC5wcm9kdWN0byB8fCAnJyxcbiAgICAgIENhbnRpZGFkX1BlZGlkYTogY2FudGlkYWRQZWRpZGEsXG4gICAgICBDYW50aWRhZF9QZW5kaWVudGVfQk86IHFvLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHFvICogKGMucHJlY2lvIHx8IDApKSxcbiAgICAgIFBlZGlkb19JRDogYy5wZWRpZG9JZCB8fCAnJyxcbiAgICAgIExpbmVhX0lkeDogbGluZWFJZHgsXG4gICAgICBTUV9Eb2NOdW06IGMuc3FEb2NOdW0gfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQmFja29yZGVyXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdCYWNrb3JkZXInLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXIgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkby4uLicpO1xuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8gbW9kbyBhc2lnbmFjaW9uLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgbWVzWVlZWU1NID0gYW5pbyArICctJyArIFN0cmluZyhtb250aElkeCArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxuICAvLyBub3JtYWxpemFjaVx1MDBGM24gZGUgc3RyaW5ncykgeSBzXHUwMEYzbG8gY2FlciBhbCBjbGllbnRMb2NJZCBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc28uXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xuICAgICAgICBjYWNoZS5mb3JFYWNoKChjbURhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGNtRGF0YS5hc3NpZ25lZFZlbmRvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgICAgfVxuICAgICAgcmV0dXJuICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBwZWRpZG9zLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbi8vIHY3MzcgKDIwMjYtMDgtMzApOiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kb3MgbG9zIGJhY2tvcmRlcnMgb3BlbiAoc2luIGZpbHRyb1xuLy8gZGUgbWVzKS4gTW90aXZvOiBsb3MgNjIgcGVkaWRvcyBtaWdyYWRvcyBkZXNkZSBTQVAgZWwgMjAyNi0wOC0yOCB0aWVuZW5cbi8vIGNyZWF0ZWRBdCBkZSBmZWNoYXMgdmllamFzIGRlbCBTQVAgU1Egb3JpZ2luYWwsIGVudG9uY2VzIGVsIGV4cG9ydCBwb3IgbWVzXG4vLyBubyBsb3MgaW5jbHVpYS4gVmVyc2lvbiBcImN1cnJlbnQgc3RhdHVzXCIgcXVlIGl0ZXJhIGdsb2JhbFBlZGlkb3MgY29tcGxldG8uXG53aW5kb3cuZXhwb3J0QmFja29yZGVyQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIgKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjE0ODggXHUwMEE3ODYgKDIwMjYtMTAtMjcgQlVHIEZJWCk6IHVzYXIgbGEgTUlTTUEgcHVyZSBmbiBxdWUgZWwgbW9kYWwgZXhwb3J0XG4gIC8vIChgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3NgKS4gQW50ZXMgdjE0ODg6IHBhbmVsIHVzYWJhXG4gIC8vIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXMoe30pYCBzaW4gYGluY2x1ZGVFeHBpcmVkYCBcdTIxOTIgb2N1bHRhYmEgQk9zID4gOTBkLlxuICAvLyBNb2RhbCB1c2FiYSBgY29tcHV0ZUJhY2tvcmRlclNrdU1hcCguLi4sIHtpbmNsdWRlRXhwaXJlZDp0cnVlfSlgIFx1MjE5MiBsb3NcbiAgLy8gaW5jbHVcdTAwRURhLiBEZWx0YSBtZWRpZG8gZW4gcHJvZDogMjIyIHVuaWRhZGVzIChtb2RhbCA3Njk2IHZzIHBhbmVsIDc0NzQpLlxuICAvLyBGaXg6IHB1cmUgZm4gXHUwMEZBbmljYSBjb24gZGVmYXVsdCBgaW5jbHVkZUV4cGlyZWQ9dHJ1ZWAgKGFsaW5lYWRvIGNvbiBcdTAwQTc0MC4xXG4gIC8vIHkgZ2V0U3RvY2tCcmVha2Rvd24uYmFja29yZGVyQXBwLnRvdGFsIFx1MjAxNCBsYSBjb2xhIGNvbXBsZXRhKS5cbiAgLy8gdjE1MzQ6IGFsY2FuY2UgcG9yIHJvbCAodmVuZGVkb3IgPSBjbGllbnRlcyBkZSBzdSBtYXN0ZXI7IGludGVybm8gPSBwYXJlamFzKS5cbiAgY29uc3QgYXJyID0gX2V4cG9ydFNjb3BlKCkuZmlsdGVyUGVkaWRvcyhcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXVxuICApO1xuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBwdXJlIGZuIFx1MDBGQW5pY2EgYGNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzYCAocmVlbXBsYXphIGVsXG4gIC8vIHBhdGggaGlzdFx1MDBGM3JpY28gYGNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lc2AgcXVlIG5vIGNvbnNvbGlkYWJhIHkgcGVyZFx1MDBFRGFcbiAgLy8gQk9zID4gOTBkKS4gUGFuZWwgcGFzYSBge31gIFx1MjE5MiB0cmFlIHRvZGEgbGEgY29sYSBzaW4gZmlsdHJvcyBtYW51YWxlcy5cbiAgY29uc3QgX2V4cG9ydEZuID1cbiAgICB3Ll9fcGhhc2UwICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydCAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQuY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3M7XG4gIGNvbnN0IGRlcHMgPSB7XG4gICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgIGNhbm9uVmVuZG9yOlxuICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgfTtcbiAgY29uc3QgX2V4cG9ydFJlc3VsdCA9IF9leHBvcnRGblxuICAgID8gX2V4cG9ydEZuKGFyciwge30sIGRlcHMpXG4gICAgOiB7IHJvd3M6IFtdLCB0b3RhbFVuaWRhZGVzOiAwLCB0b3RhbEZpbGFzOiAwLCBmaWx0cm9zQXBsaWNhZG9zOiB7fSB9O1xuICBjb25zdCByb3dzID0gX2V4cG9ydFJlc3VsdC5yb3dzO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydChcbiAgICAgICdFeHBvcnQgQmFja29yZGVyIHZhY2lvLiBEaWFnbm9zdGljbzpcXG4nICtcbiAgICAgICAgJy0gVG90YWwgcGVkaWRvcyBlbiBnbG9iYWxQZWRpZG9zOiAnICtcbiAgICAgICAgYXJyLmxlbmd0aCArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gUGVkaWRvcyBhYmllcnRvcyAoc2luIGNsb3NlZEF0KTogJyArXG4gICAgICAgIHRvdGFsUGVkaWRvc09wZW4gK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIExpbmVhcyBwb3N0LUZJRk8rdmVuY2lkYXMgY29uIHF0eUJhY2tvcmRlcj4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgYmFja29yZGVyIGFiaWVydG8gYWhvcmEgbWlzbW8gKHRvZG8gY29uZmlybWVkLCBjZXJyYWRvIG8gdmVuY2lkbylcXG4nICtcbiAgICAgICAgJzIuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvIHBvciBlcnJvclxcbicgK1xuICAgICAgICAnMy4gVG9kYXMgbGFzIGxpbmVhcyBCTyB0aWVuZW4gc3RvY2sgZGlzcG9uaWJsZSAoZnVlcm9uIHByb21vdmlkYXMgYSBBU0lHIHZpcnR1YWwpJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXI6IDAgbGluZWFzICh2ZXIgYWxlcnRhKScsIDMwMDApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIC8vIHYxMzY2ICgyMDI2LTEwLTE5KTogaG9qYSBcIlJlc3VtZW5cIiBjb24gbG9zIE1JU01PUyB0b3RhbGVzIHF1ZSBlbCBtb2RhbFxuICAvLyBCYWNrb3JkZXIgKGNvbXB1dGVCYWNrb3JkZXJTa3VNYXAgcG9zdC1jb25zb2xpZGFjaW9uIHBvciBjbGllbnRlKS4gQW50ZXNcbiAgLy8gZWwgZXhwb3J0IGR1bXBlYWJhIGxpbmVhcyBjcnVkYXMgc2luIG5pbmd1biB0b3RhbCBcdTIxOTIgTWFyaWFubyBzdW1hYmEgbGFcbiAgLy8gY29sdW1uYSBTdWJ0b3RhbF9CT19BUlMgeSBlbCB2YWxvciBwb2RpYSBkaXZlcmdlciBkZWwgbW9kYWwgY3VhbmRvIHVuXG4gIC8vIGNsaWVudGUgdGVuaWEgdmFyaWFzIGxpbmVhcyBCTyBkZWwgbWlzbW8gU0tVIGNvbiBwcmVjaW9zIGRpc3RpbnRvcyAoZWxcbiAgLy8gbW9kYWwgY29uc29saWRhIHVzYW5kbyBlbCBwcmVjaW8gZGUgbGEgMXJhIGxpbmVhIHByb2Nlc2FkYTsgZWwgZXhwb3J0XG4gIC8vIHVzYSBlbCBwcmVjaW8gZGUgY2FkYSBsaW5lYSBpbmRpdmlkdWFsKS5cbiAgY29uc3QgX2NvbXB1dGVTa3VNYXBGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyU2t1TWFwO1xuICBjb25zdCBfbW9kYWxEZXBzID0ge1xuICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICBjYW5vblZlbmRvcjpcbiAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICBiYWNrb3JkZXJMaW5lczogQXJyYXkuaXNBcnJheSh3LmJhY2tvcmRlckxpbmVzKSA/IHcuYmFja29yZGVyTGluZXMgOiBbXSxcbiAgICBzYXBHZXRDbGllbnRlQ29kZTogdHlwZW9mIHcuc2FwR2V0Q2xpZW50ZUNvZGUgPT09ICdmdW5jdGlvbicgPyB3LnNhcEdldENsaWVudGVDb2RlIDogdW5kZWZpbmVkLFxuICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgfTtcbiAgY29uc3QgX21vZGFsRmlsdGVycyA9IHtcbiAgICB0aWVuZGFRdWVyeTogJycsXG4gICAgdmVuZG9yS2V5OiAnJyxcbiAgICBtZXNZWVlZTU06ICcnLFxuICAgIHVyZ2VuY3lGaWx0ZXI6ICcnLFxuICAgIGluY2x1ZGVFeHBpcmVkOiB0cnVlLFxuICAgIGFnZ3JlZ2F0aW9uTW9kZTogJ2ZpZm8nLFxuICB9O1xuICBjb25zdCBfbW9kYWxSZXN1bHQgPSBfY29tcHV0ZVNrdU1hcEZuXG4gICAgPyBfY29tcHV0ZVNrdU1hcEZuKGFyciwgJ3VyZ2VudGUnLCBfbW9kYWxGaWx0ZXJzLCBfbW9kYWxEZXBzKVxuICAgIDogeyBza3VzOiBbXSwgdG90YWxVbmlkYWRlczogMCwgdG90YWxDbGllbnRlczogMCB9O1xuICBsZXQgdG90YWxQZXNvc01vZGFsID0gMDtcbiAgY29uc3Qgc3VidG90YWxlc1BvclVyZ2VuY3kgPSB7IHVyZ2VudGU6IDAsIHBhcmNpYWw6IDAgfTtcbiAgZm9yIChjb25zdCBnIG9mIF9tb2RhbFJlc3VsdC5za3VzIHx8IFtdKSB7XG4gICAgY29uc3QgdXJnID0gZy51cmdlbmN5IHx8ICd1cmdlbnRlJztcbiAgICBmb3IgKGNvbnN0IGMgb2YgZy5jbGllbnRlcyB8fCBbXSkge1xuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGMucXR5QmFja29yZGVyKSB8fCAwO1xuICAgICAgaWYgKHF0eSA8PSAwKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihjLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IHN1YiA9IHF0eSAqIHByZWNpbztcbiAgICAgIHRvdGFsUGVzb3NNb2RhbCArPSBzdWI7XG4gICAgICBpZiAodXJnID09PSAncGFyY2lhbCcpIHN1YnRvdGFsZXNQb3JVcmdlbmN5LnBhcmNpYWwgKz0gc3ViO1xuICAgICAgZWxzZSBzdWJ0b3RhbGVzUG9yVXJnZW5jeS51cmdlbnRlICs9IHN1YjtcbiAgICB9XG4gIH1cbiAgY29uc3QgdG90YWxVbmlkYWRlc01vZGFsID0gX2V4cG9ydFJlc3VsdC50b3RhbFVuaWRhZGVzIHx8IF9tb2RhbFJlc3VsdC50b3RhbFVuaWRhZGVzIHx8IDA7XG4gIGNvbnN0IHRvdGFsQ2xpZW50ZXNNb2RhbCA9IF9tb2RhbFJlc3VsdC50b3RhbENsaWVudGVzIHx8IDA7XG4gIGNvbnN0IHRvdGFsU2t1c01vZGFsID0gKF9tb2RhbFJlc3VsdC5za3VzIHx8IFtdKS5sZW5ndGg7XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBmaWxhIGRlIGVuY2FiZXphZG8gXCJGaWx0cm9zIGFwbGljYWRvc1wiIHBhcmEgdHJhbnNwYXJlbmNpYS5cbiAgY29uc3QgX2ZtdEZpbHRyb3MgPVxuICAgIHcuX19waGFzZTAgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0ICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydC5mb3JtYXRCYWNrb3JkZXJGaWx0cm9zSGVhZGVyO1xuICBjb25zdCBmaWx0cm9zTGJsID0gX2ZtdEZpbHRyb3MgPyBfZm10RmlsdHJvcyhfZXhwb3J0UmVzdWx0LmZpbHRyb3NBcGxpY2Fkb3MpIDogJ0ZpbHRyb3M6IG5pbmd1bm8nO1xuICBjb25zdCByZXN1bWVuUm93cyA9IFtcbiAgICB7IE1ldHJpY2E6IGZpbHRyb3NMYmwsIFZhbG9yOiAnJyB9LFxuICAgIHsgTWV0cmljYTogJ1RPVEFMIEJhY2tvcmRlciBBUlMnLCBWYWxvcjogTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnU0tVcyBjb24gYmFja29yZGVyJywgVmFsb3I6IHRvdGFsU2t1c01vZGFsIH0sXG4gICAgeyBNZXRyaWNhOiAnVW5pZGFkZXMgcGVuZGllbnRlcycsIFZhbG9yOiBNYXRoLnJvdW5kKHRvdGFsVW5pZGFkZXNNb2RhbCkgfSxcbiAgICB7IE1ldHJpY2E6ICdQYXJlcyBjbGllbnRlK1NLVSAoZmlsYXMgZW4gaG9qYSBCYWNrb3JkZXIpJywgVmFsb3I6IHJvd3MubGVuZ3RoIH0sXG4gICAgeyBNZXRyaWNhOiAnQ2xpZW50ZXMgYWZlY3RhZG9zJywgVmFsb3I6IHRvdGFsQ2xpZW50ZXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1x1MjAxNCBTdWJ0b3RhbCBTSU4gUkVQT1NJQ0lPTicsIFZhbG9yOiBNYXRoLnJvdW5kKHN1YnRvdGFsZXNQb3JVcmdlbmN5LnVyZ2VudGUpIH0sXG4gICAgeyBNZXRyaWNhOiAnXHUyMDE0IFN1YnRvdGFsIFBBUkNJQUwnLCBWYWxvcjogTWF0aC5yb3VuZChzdWJ0b3RhbGVzUG9yVXJnZW5jeS5wYXJjaWFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1NuYXBzaG90IGdlbmVyYWRvJywgVmFsb3I6IG5ldyBEYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgfSxcbiAgXTtcbiAgLy8gdjE0ODggXHUwMEE3ODY6IGZpbGEgVE9UQUwgYWxpbmVhZGEgY29uIGVsIG51ZXZvIHNoYXBlIChzaW4gY29sdW1uYXMgbGVnYWN5XG4gIC8vIEZlY2hhX1BlZGlkbyAvIE1lcyAvIENhbnRpZGFkX1BlZGlkYSAvIFBlZGlkb19JRCAvIExpbmVhX0lkeCAvIGV0Yy4pLlxuICAvLyBMYXMgbnVldmFzIGNvbHVtbmFzIChkZSBjb21wdXRlQmFja29yZGVyRXhwb3J0Um93cyk6IFNLVSwgUHJvZHVjdG8sXG4gIC8vIENsaWVudGUsIENhcmRDb2RlLCBQcm92aW5jaWEsIExvY2FsaWRhZCwgVmVuZGVkb3IsIENhbnRpZGFkX1BlbmRpZW50ZV9CTyxcbiAgLy8gUHJlY2lvX1VuaXRfQVJTLCBTdWJ0b3RhbF9CT19BUlMsIEVkYWRfQk9fZGlhcywgRXN0YWRvLCBQZWRpZG9zLlxuICBjb25zdCB0b3RhbFJvdyA9IHtcbiAgICBTS1U6ICcnLFxuICAgIFByb2R1Y3RvOiAnJyxcbiAgICBDbGllbnRlOiAnVE9UQUwnLFxuICAgIENhcmRDb2RlOiAnJyxcbiAgICBQcm92aW5jaWE6ICcnLFxuICAgIExvY2FsaWRhZDogJycsXG4gICAgVmVuZGVkb3I6ICcnLFxuICAgIENhbnRpZGFkX1BlbmRpZW50ZV9CTzogTWF0aC5yb3VuZCh0b3RhbFVuaWRhZGVzTW9kYWwpLFxuICAgIFByZWNpb19Vbml0X0FSUzogJycsXG4gICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCksXG4gICAgRWRhZF9CT19kaWFzOiAnJyxcbiAgICBFc3RhZG86ICcnLFxuICAgIFBlZGlkb3M6ICcnLFxuICB9O1xuICByb3dzLnB1c2godG90YWxSb3cpO1xuICAvLyB2MTU2NSAoMjAyNi0xMS0xOCk6IDIgaG9qYXMgZXhhY3RhcyBwb3IgcGVkaWRvIE1hcmlhbm8uXG4gIC8vIFwiQmFja29yZGVyX0NsaWVudGVzXCIgKFNLVSwgTk9NQlJFX0RFTF9QUk9EVUNUTywgQ0FOVElEQURfQkFDS09SREVSLFxuICAvLyAgIFNVQlRPVEFMLCBDTElFTlRFLCBJRF9QRURJRE8pICsgXCJCYWNrb3JkZXJfU0tVXCIgKFNLVSwgQ0FOVElEQURfQkFDS09SREVSLFxuICAvLyAgIFNVQlRPVEFMLCBQUk9NRURJT19WRU5UQV8zTSkuIENvbHVtbmEgUFJPTUVESU9fVkVOVEFfM00gcXVlZGEgdmFjaWFcbiAgLy8gICAocmVxdWllcmUgYWdyZWdhZG8gQlEgZnVlcmEgZGVsIGFsY2FuY2UgZGUgZXN0ZSBQUjsgZG9jdW1lbnRhZG8gZW5cbiAgLy8gICBkb2NzL0NIQU5HRUxPRy1leHBvcnRzLWNvbHVtbnMtcmVmYWN0b3IubWQpLiBSZXN1bWVuIGludGVybm8gY29uc2VydmFkb1xuICAvLyAgIHkgYXByb3ZlY2hhZG8gcGFyYSBlbCBhZ3JlZ2FkbyBwb3IgU0tVLlxuICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+fSAqL1xuICBjb25zdCByb3dzQ2xpZW50ZXMgPSByb3dzXG4gICAgLmZpbHRlcigocikgPT4gKHIuQ2xpZW50ZSB8fCAnJykgIT09ICdUT1RBTCcpXG4gICAgLm1hcCgocikgPT4gKHtcbiAgICAgIFNLVTogci5TS1UgfHwgJycsXG4gICAgICBOT01CUkVfREVMX1BST0RVQ1RPOiByLlByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ0FOVElEQURfQkFDS09SREVSOiBOdW1iZXIoci5DYW50aWRhZF9QZW5kaWVudGVfQk8pIHx8IDAsXG4gICAgICBTVUJUT1RBTDogTnVtYmVyKHIuU3VidG90YWxfQk9fQVJTKSB8fCAwLFxuICAgICAgQ0xJRU5URTogci5DbGllbnRlIHx8ICcnLFxuICAgICAgSURfUEVESURPOiByLlBlZGlkb3MgfHwgJycsXG4gICAgfSkpO1xuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHtxdHk6IG51bWJlciwgc3ViOiBudW1iZXIsIG5vbWJyZTogc3RyaW5nfT59ICovXG4gIGNvbnN0IHNrdUFnZyA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCByIG9mIHJvd3NDbGllbnRlcykge1xuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhyLlNLVSB8fCAnJykudHJpbSgpO1xuICAgIGlmICghc2t1KSBjb250aW51ZTtcbiAgICBjb25zdCBwcmV2ID0gc2t1QWdnLmdldChza3UpIHx8IHsgcXR5OiAwLCBzdWI6IDAsIG5vbWJyZTogci5OT01CUkVfREVMX1BST0RVQ1RPIH07XG4gICAgcHJldi5xdHkgKz0gTnVtYmVyKHIuQ0FOVElEQURfQkFDS09SREVSKSB8fCAwO1xuICAgIHByZXYuc3ViICs9IE51bWJlcihyLlNVQlRPVEFMKSB8fCAwO1xuICAgIGlmICghcHJldi5ub21icmUgJiYgci5OT01CUkVfREVMX1BST0RVQ1RPKSBwcmV2Lm5vbWJyZSA9IHIuTk9NQlJFX0RFTF9QUk9EVUNUTztcbiAgICBza3VBZ2cuc2V0KHNrdSwgcHJldik7XG4gIH1cbiAgLy8gdjE1NjYgKDIwMjYtMTEtMTgpOiBjb21wdXRhciBQUk9NRURJT19WRU5UQV8zTSBwb3IgU0tVIGRlc2RlIGdsb2JhbFBlZGlkb3NcbiAgLy8gKGxcdTAwRURuZWFzIGZhY3R1cmFkYXMgZW4gbG9zIFx1MDBGQWx0aW1vcyA5MCBkXHUwMEVEYXMgLyAzKS4gRnVlbnRlIGxvY2FsIHNpbiByZXF1ZXJpclxuICAvLyBhZ3JlZ2FkbyBCUTsgc2kgdW4gcGVkaWRvIG5vIHRpZW5lIGZlY2hhIGRlIGZhY3R1cmFjaVx1MDBGM24gdlx1MDBFMWxpZGEsIHNlIHNhbHRlYS5cbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICBjb25zdCBhdmczTUlkeCA9IG5ldyBNYXAoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IERBWV9NUyA9IDg2NDAwMDAwO1xuICAgIGNvbnN0IF9hcnJBbGwgPSB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXTtcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgcXR5U3VtOTAgPSBuZXcgTWFwKCk7XG4gICAgZm9yIChjb25zdCBwIG9mIF9hcnJBbGwpIHtcbiAgICAgIGlmICghcCB8fCAhQXJyYXkuaXNBcnJheShwLmxpbmVzKSkgY29udGludWU7XG4gICAgICAvLyBmZWNoYSBkZSBmYWN0dXJhY2lcdTAwRjNuIC8gZW50cmVnYSBhbCBTQVA6IHByZWZlcmlyIHNhcEludm9pY2VEYXRlIC9cbiAgICAgIC8vIHRyYW5zZmVyaWRvU0FQLmRvY0RhdGUgLyBjbG9zZWRBdCAvIGNvbmZpcm1lZEF0LlxuICAgICAgY29uc3QgX3Jhd0RhdGUgPSAocC50cmFuc2Zlcmlkb1NBUCAmJiAocC50cmFuc2Zlcmlkb1NBUC5kb2NEYXRlIHx8IHAudHJhbnNmZXJpZG9TQVAuZGF0ZSkpXG4gICAgICAgIHx8IHAuc2FwSW52b2ljZURhdGUgfHwgcC5jbG9zZWRBdCB8fCBwLmNvbmZpcm1lZEF0IHx8IG51bGw7XG4gICAgICBpZiAoIV9yYXdEYXRlKSBjb250aW51ZTtcbiAgICAgIGxldCBtcyA9IG51bGw7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAodHlwZW9mIF9yYXdEYXRlID09PSAnc3RyaW5nJykgbXMgPSBuZXcgRGF0ZShfcmF3RGF0ZSkuZ2V0VGltZSgpO1xuICAgICAgICBlbHNlIGlmIChfcmF3RGF0ZSAmJiB0eXBlb2YgX3Jhd0RhdGUudG9EYXRlID09PSAnZnVuY3Rpb24nKSBtcyA9IF9yYXdEYXRlLnRvRGF0ZSgpLmdldFRpbWUoKTtcbiAgICAgICAgZWxzZSBpZiAoX3Jhd0RhdGUgJiYgdHlwZW9mIF9yYXdEYXRlLnNlY29uZHMgPT09ICdudW1iZXInKSBtcyA9IF9yYXdEYXRlLnNlY29uZHMgKiAxMDAwO1xuICAgICAgfSBjYXRjaCB7IG1zID0gbnVsbDsgfVxuICAgICAgaWYgKCFtcyB8fCBOdW1iZXIuaXNOYU4obXMpKSBjb250aW51ZTtcbiAgICAgIGlmICgobm93IC0gbXMpID4gOTAgKiBEQVlfTVMpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCBsIG9mIHAubGluZXMpIHtcbiAgICAgICAgaWYgKCFsIHx8ICFsLmNvZGUpIGNvbnRpbnVlO1xuICAgICAgICAvLyBzXHUwMEYzbG8gY3VlbnRvIGxcdTAwRURuZWFzIGZhY3R1cmFkYXMvZW50cmVnYWRhcyAoc3RhdGUgY2FuY2VsbGVkIG8gc2luXG4gICAgICAgIC8vIHF0eU9wZW49MCBpbXBsaWNhbiBxdWUgbGEgdmVudGEgc2UgY29uY3JldFx1MDBGMykuXG4gICAgICAgIGNvbnN0IHN0ID0gbC5zdGF0ZSB8fCAnJztcbiAgICAgICAgaWYgKHN0ID09PSAnQk8nIHx8IHN0ID09PSAnQVNJRycpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBxID0gTnVtYmVyKGwucXR5KSB8fCAwO1xuICAgICAgICBpZiAocSA8PSAwKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgc2t1ID0gU3RyaW5nKGwuY29kZSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIHF0eVN1bTkwLnNldChza3UsIChxdHlTdW05MC5nZXQoc2t1KSB8fCAwKSArIHEpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBkaXZpZG8gcG9yIDMgbWVzZXMgXHUyMTkyIHByb21lZGlvIG1lbnN1YWxcbiAgICBmb3IgKGNvbnN0IFtza3UsIHRvdGFsXSBvZiBxdHlTdW05MCkge1xuICAgICAgYXZnM01JZHguc2V0KHNrdSwgTWF0aC5yb3VuZCgodG90YWwgLyAzKSAqIDEwKSAvIDEwKTtcbiAgICB9XG4gIH0gY2F0Y2ggKF9lQXZnKSB7XG4gICAgY29uc29sZS53YXJuKCdbYmFja29yZGVyXSBubyBzZSBwdWRvIGNvbXB1dGFyIFBST01FRElPX1ZFTlRBXzNNOicsIF9lQXZnICYmIF9lQXZnLm1lc3NhZ2UpO1xuICB9XG5cbiAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pn0gKi9cbiAgY29uc3Qgcm93c1NrdSA9IFtdO1xuICBmb3IgKGNvbnN0IFtza3UsIGFnZ10gb2Ygc2t1QWdnKSB7XG4gICAgcm93c1NrdS5wdXNoKHtcbiAgICAgIFNLVTogc2t1LFxuICAgICAgQ0FOVElEQURfQkFDS09SREVSOiBhZ2cucXR5LFxuICAgICAgU1VCVE9UQUw6IE1hdGgucm91bmQoYWdnLnN1YiksXG4gICAgICBQUk9NRURJT19WRU5UQV8zTTogYXZnM01JZHguZ2V0KFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSB8fCAwLFxuICAgIH0pO1xuICAgIHZvaWQgcmVzdW1lblJvd3M7XG4gIH1cbiAgcm93c1NrdS5zb3J0KChhLCBiKSA9PiAoYi5TVUJUT1RBTCB8fCAwKSAtIChhLlNVQlRPVEFMIHx8IDApKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdCQUNLT1JERVJfJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnQmFja29yZGVyX0NsaWVudGVzJywgcm93czogcm93c0NsaWVudGVzIH0sXG4gICAgeyBuYW1lOiAnQmFja29yZGVyX1NLVScsIHJvd3M6IHJvd3NTa3UgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICtcbiAgICAgIChyb3dzLmxlbmd0aCAtIDEpICtcbiAgICAgICcgbGluZWFzICsgUmVzdW1lbiBjb24gdG90YWwgJCcgK1xuICAgICAgTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICcpJyxcbiAgICAzMDAwXG4gICk7XG59O1xuXG4vLyB2MTUxMSAoMjAyNi0xMC0yOCk6IGhhbmRsZXIgd2luZG93LmV4cG9ydFJlcGFydG9Ub0V4Y2VsIHJlbW92aWRvIGp1bnRvIGNvbiBlbFxuLy8gYm90b24gXCJFeHBvcnRhciByZXBvcnRlXCIgZGVsIG1vZGFsIFJlcGFydG8uIFJlZW1wbGF6YWRvIHBvciBlbCBmbG93IGVkaXRhYmxlXG4vLyBcIkV4cG9ydGFyIEV4Y2VsXCIgKyBcIkltcG9ydGFyIEV4Y2VsXCIgZGVsIFBSICMxMjczICh2MTUwNSkuXG4vLyBQcmVzZXJ2YWRvOiBzcmMvcHVyZS9yZXBhcnRvLWV4cG9ydC1yb3dzLmpzIChzaGFwZSBkZSByb3dzIGF1biB1c2FkbyBwb3Igb3Ryb3MgZXhwb3J0cykuXG5cbi8vIHY3Mzc6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvIGVsIFN0b2NrIEFzaWduYWRvIChzaW4gZmlsdHJvIGRlIG1lcykuIE1pc21vXG4vLyBtb3Rpdm8gcXVlIGV4cG9ydEJhY2tvcmRlckFsbC5cbndpbmRvdy5leHBvcnRTdG9ja0FzaWdBbGwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFN0b2NrIEFzaWduYWRvIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XG4gIC8vIHYxMTAwICgyMDI2LTA5LTMwKTogbWlzbW8gbVx1MDBGM2R1bG8gcHVybyBxdWUgcmVuZGVyQmFja29yZGVyc1RhYiBlbiBtb2RvXG4gIC8vIGFzaWduYWNpb24uIEFob3JhIGVsIHJlcG9ydGUgY29pbmNpZGUgY29uIGVsIG1vZGFsOiBGSUZPIGNhcCBwb3IgZGlzcFNhcCxcbiAgLy8gZmlsdHJvIHZlbmNpZGFzIChBU0lHID4xNWQgZnVlcmEsIEFTSUcgc2luIHJlc2VydmEgdmlnZW50ZSBhZGVudHJvKSxcbiAgLy8gY29uZmlybWVkIGluY2x1aWRvLCBzaW4gbFx1MDBFRG5lYXMgXCJ2aXJ0dWFsX0FTSUdcIiBmYW50YXNtYS5cbiAgLy8gdjE1MzQ6IGFsY2FuY2UgcG9yIHJvbCAodmVuZGVkb3IgPSBjbGllbnRlcyBkZSBzdSBtYXN0ZXI7IGludGVybm8gPSBwYXJlamFzKS5cbiAgY29uc3QgYXJyID0gX2V4cG9ydFNjb3BlKCkuZmlsdGVyUGVkaWRvcyhcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXVxuICApO1xuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIGFycixcbiAgICAgICAgJ2FzaWduYWNpb24nLFxuICAgICAgICB7fSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBhcnIpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxdHkgPSBjLnF0eUFzaWduYWRhIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xuICAgIH1cbiAgICAvLyBFc3RhZG9fUmVhbDogaGlzdFx1MDBGM3JpY28gXCJCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRylcIiB2cyBcIkFTSUdcIi4gdjExMDA6XG4gICAgLy8gYWhvcmEgYGNvbmZpcm1lZGAgdGFtYmlcdTAwRTluIGVudHJhICh2OTYyKS4gUHJlc2VydmFtb3MgZXRpcXVldGEgbGVnYWN5XG4gICAgLy8gcG9yIGNvbXBhdGliaWxpZGFkIGNvbiBxdWllbiBjb25zdW1lIGVsIEV4Y2VsLlxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcbiAgICAgIE9yaWdlbjogKHAgJiYgcC5taWdyYXRpb25Tb3VyY2UpIHx8ICdhcHAnLFxuICAgICAgLy8gdjExMDA6IGNvbnRleHRvIFx1MDBGQXRpbCBwYXJhIGRlYnVnZ2luZyBwYXJpZGFkIG1vZGFsXHUyMTk0cmVwb3J0ZS5cbiAgICAgIFN0b2NrX0Rpc3BfU0tVOiBybC5kaXNwU2FwIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydChcbiAgICAgICdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xuICAgICAgICBhcnIubGVuZ3RoICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcbiAgICAgICAgdG90YWxQZWRpZG9zT3BlbiArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gTGluZWFzIHBvc3QtRklGTyt2ZW5jaWRhcyBjb24gcXR5QXNpZ25hZGE+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IHN0b2NrIGFzaWduYWRvIGFob3JhIG1pc21vXFxuJyArXG4gICAgICAgICcyLiBUb2RvcyBsb3MgQVNJRyBlc3RhbiB2ZW5jaWRvcyAoPjE1ZCBkZXNkZSBhc2lnQXQpXFxuJyArXG4gICAgICAgICczLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbydcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZzogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufTtcblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBudWV2byBleHBvcnQgXCJQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG9cIi4gTGlzdGFcbi8vIGxvcyByZXBhcnRvcyBhYmllcnRvcyAoaW5ncmVzb3NfcmVwYXJ0byBwZW5kaW5nL2luX3Byb2dyZXNzKSBwb3IgU0tVICtcbi8vIGNsaWVudGVzIGVuIGNvbGEuIFJlZW1wbGF6YSBzZW1cdTAwRTFudGljYW1lbnRlIGFsIHZpZWpvIFwiU3RvY2sgQXNpZ25hZG9cIiBlbiBlbFxuLy8gbW9kYWwgKGVsIHZpZWpvIHBhc2EgYSBcIlN0b2NrIEFzaWduYWRvIC0gbFx1MDBFRG5lYXNcIiBjb21vIGF1eGlsaWFyKS5cbi8vIERvcyBob2phczpcbi8vICAgUmVzdW1lbiByZXBhcnRvIFx1MjAxNCB1bmEgZmlsYSBwb3IgZG9jIGluZ3Jlc29zX3JlcGFydG8uXG4vLyAgIENsaWVudGVzIGVuIGNvbGEgXHUyMDE0IHVuYSBmaWxhIHBvciBjbGllbnRlIEJPIGRlIGNhZGEgcmVwYXJ0by5cbndpbmRvdy5leHBvcnRQZW5kaWVudGVEZUFzaWduYWNpb25QYWJsbyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgUGVuZGllbnRlIGRlIEFzaWduYWNpXHUwMEYzbiAtIFBhYmxvLi4uJyk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBmYkRiID0gdy5mYkRiO1xuICBpZiAoIWZiRGIpIHtcbiAgICBhbGVydCgnRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkby4gUmVpbnRlbnRcdTAwRTEgZW4gdW5vcyBzZWd1bmRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMS4gUmVwYXJ0b3MgYWJpZXJ0b3MuXG4gIGxldCByZXBhcnRvc0RvY3M7XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdpbmdyZXNvc19yZXBhcnRvJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJ2luJywgWydwZW5kaW5nJywgJ2luX3Byb2dyZXNzJ10pXG4gICAgICAuZ2V0KCk7XG4gICAgcmVwYXJ0b3NEb2NzID0gc25hcC5kb2NzO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGNhcmdhbmRvIGluZ3Jlc29zX3JlcGFydG86ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFyZXBhcnRvc0RvY3MgfHwgcmVwYXJ0b3NEb2NzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVwYXJ0b3MgcGVuZGluZy9pbl9wcm9ncmVzcyBhaG9yYSBtaXNtby4nKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFBhYmxvOiAwIHJlcGFydG9zJywgMjQwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIDIuIFNuYXBzaG90IHN0b2NrICsgZ2V0U3RvY2tCcmVha2Rvd24gcG9yIFNLVS5cbiAgY29uc3Qgc3RvY2tTbmFwID1cbiAgICB0eXBlb2Ygdy5nZXRTdG9ja1NuYXBzaG90ID09PSAnZnVuY3Rpb24nXG4gICAgICA/IHcuZ2V0U3RvY2tTbmFwc2hvdCgpXG4gICAgICA6IHcuX3N0b2NrU25hcHNob3RDYWNoZSB8fCB7IHdhcmVob3VzZUJyZWFrZG93bjoge30gfTtcbiAgY29uc3Qgd2hzID1cbiAgICB0eXBlb2Ygc3RvY2tTbmFwLndhcmVob3VzZUJyZWFrZG93biA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duKVxuICAgICAgOiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duIHx8IHt9O1xuICBjb25zdCBwZWRpZG9zID0gQXJyYXkuaXNBcnJheSh3Lmdsb2JhbFBlZGlkb3MpID8gdy5nbG9iYWxQZWRpZG9zIDogW107XG4gIGNvbnN0IHdhaXRsaXN0RW50cmllcyA9XG4gICAgdHlwZW9mIHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMgPT09ICdmdW5jdGlvbicgPyB3Ll9nZXRXYWl0bGlzdENwc3RFbnRyaWVzKCkgOiBbXTtcbiAgY29uc3QgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyA9IHJlcGFydG9zRG9jcy5tYXAoKGQpID0+XG4gICAgT2JqZWN0LmFzc2lnbih7IF9mc0lkOiBkLmlkIH0sIGQuZGF0YSgpIHx8IHt9KVxuICApO1xuICBjb25zdCBnZXRCcmVha2Rvd24gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuZ2V0U3RvY2tCcmVha2Rvd247XG4gIC8vIDMuIFJlc29sdmVyIHByb2R1Y3RvIHBvciBTS1UuXG4gIGNvbnN0IHByb2RCeVNrdSA9IG5ldyBNYXAoKTtcbiAgY29uc3QgUFJPRFVDVFMgPSBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdO1xuICBmb3IgKGNvbnN0IHAgb2YgUFJPRFVDVFMpIHtcbiAgICBpZiAocCAmJiBwLnNrdSkgcHJvZEJ5U2t1LnNldChTdHJpbmcocC5za3UpLnRvVXBwZXJDYXNlKCksIHApO1xuICB9XG4gIGNvbnN0IG5vd01zID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXTtcbiAgY29uc3QgY29sYVJvd3MgPSBbXTtcbiAgZm9yIChjb25zdCBkb2Mgb2YgcmVwYXJ0b3NEb2NzKSB7XG4gICAgY29uc3QgZGF0YSA9IGRvYy5kYXRhKCkgfHwge307XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKGRhdGEuc2t1IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IHByb2QgPSBwcm9kQnlTa3UuZ2V0KHNrdSkgfHwgbnVsbDtcbiAgICBjb25zdCBmaXNpY29EZXAxMSA9IE51bWJlcigod2hzW3NrdV0gJiYgd2hzW3NrdV1bJzExJ10pIHx8IDApO1xuICAgIGNvbnN0IHF0eUluZ3Jlc2FkYSA9IE51bWJlcihkYXRhLnF0eUluZ3Jlc2FkYSB8fCAwKTtcbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IEFycmF5LmlzQXJyYXkoZGF0YS5hc3NpZ25tZW50cykgPyBkYXRhLmFzc2lnbm1lbnRzIDogW107XG4gICAgbGV0IHF0eVlhQXNpZ25hZGEgPSAwO1xuICAgIGZvciAoY29uc3QgYSBvZiBhc3NpZ25tZW50cykgcXR5WWFBc2lnbmFkYSArPSBOdW1iZXIoKGEgJiYgYS5xdHlBc2lnbmFkYSkgfHwgMCk7XG4gICAgbGV0IHF0eUFSZXBhcnRpciA9IE1hdGgubWF4KDAsIHF0eUluZ3Jlc2FkYSAtIHF0eVlhQXNpZ25hZGEpO1xuICAgIGlmIChnZXRCcmVha2Rvd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJrID0gZ2V0QnJlYWtkb3duKFxuICAgICAgICAgIHNrdSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBnZXRTdG9ja0Zpc2ljbzogKCkgPT4gZmlzaWNvRGVwMTEsXG4gICAgICAgICAgICBwZWRpZG9zLFxuICAgICAgICAgICAgd2FpdGxpc3RFbnRyaWVzLFxuICAgICAgICAgICAgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgbm93OiBub3dNcyB9XG4gICAgICAgICk7XG4gICAgICAgIGlmIChiayAmJiBiay5yZXBhcnRvQWJpZXJ0byAmJiB0eXBlb2YgYmsucmVwYXJ0b0FiaWVydG8ucXR5ID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIHF0eUFSZXBhcnRpciA9IGJrLnJlcGFydG9BYmllcnRvLnF0eTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgLyogZmFsbGJhY2sgYSBjXHUwMEUxbGN1bG8gbG9jYWwgKi9cbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY2xpZW50ZXNCTyA9IEFycmF5LmlzQXJyYXkoZGF0YS5jbGllbnRlc0JPKSA/IGRhdGEuY2xpZW50ZXNCTyA6IFtdO1xuICAgIGxldCBkZXRlY3RlZEF0ID0gZGF0YS5kZXRlY3RlZEF0IHx8ICcnO1xuICAgIGlmIChkZXRlY3RlZEF0ICYmIHR5cGVvZiBkZXRlY3RlZEF0LnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9IGRldGVjdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIGRldGVjdGVkQXQgPSAnJztcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgYm9Ub3RhbFF0eSA9IGNsaWVudGVzQk8ucmVkdWNlKChzLCBjKSA9PiBzICsgTnVtYmVyKGMucXR5QmFja29yZGVyIHx8IDApLCAwKTtcbiAgICByZXN1bWVuUm93cy5wdXNoKHtcbiAgICAgIFJlcGFydG9fSUQ6IGRvYy5pZCxcbiAgICAgIFNLVTogc2t1LFxuICAgICAgUHJvZHVjdG86IChwcm9kICYmIChwcm9kLm5hbWUgfHwgcHJvZC5kZXNjcmlwdGlvbikpIHx8ICcnLFxuICAgICAgRmlzaWNvX0RlcDExOiBmaXNpY29EZXAxMSxcbiAgICAgIFF0eV9JbmdyZXNhZGE6IHF0eUluZ3Jlc2FkYSxcbiAgICAgIFF0eV9ZYV9Bc2lnbmFkYTogcXR5WWFBc2lnbmFkYSxcbiAgICAgIFF0eV9BX1JlcGFydGlyOiBxdHlBUmVwYXJ0aXIsXG4gICAgICBDbGllbnRlc19Fbl9Db2xhOiBjbGllbnRlc0JPLmxlbmd0aCxcbiAgICAgIEJPX1RvdGFsX1F0eTogYm9Ub3RhbFF0eSxcbiAgICAgIERldGVjdGVkQXQ6IHR5cGVvZiBkZXRlY3RlZEF0ID09PSAnc3RyaW5nJyA/IGRldGVjdGVkQXQuc2xpY2UoMCwgMTkpLnJlcGxhY2UoJ1QnLCAnICcpIDogJycsXG4gICAgICBTdGF0dXM6IGRhdGEuc3RhdHVzIHx8ICcnLFxuICAgIH0pO1xuICAgIGZvciAoY29uc3QgYyBvZiBjbGllbnRlc0JPKSB7XG4gICAgICBsZXQgZmVjaGFQZWQgPSBjLnBlZGlkb0NyZWF0ZWRBdCB8fCAnJztcbiAgICAgIGlmIChmZWNoYVBlZCAmJiB0eXBlb2YgZmVjaGFQZWQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSBmZWNoYVBlZC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAgIGZlY2hhUGVkID0gJyc7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFZlbmRlZG9yOiBidXNjYXIgZW4gZ2xvYmFsUGVkaWRvcyBwb3IgcGVkaWRvSWQuXG4gICAgICBsZXQgdmVuZGVkb3IgPSBjLnZlbmRvcktleSB8fCAnJztcbiAgICAgIGlmICghdmVuZGVkb3IgJiYgYy5wZWRpZG9JZCkge1xuICAgICAgICBjb25zdCBwID0gcGVkaWRvcy5maW5kKCh4KSA9PiB4ICYmIHguX2ZzSWQgPT09IGMucGVkaWRvSWQpO1xuICAgICAgICBpZiAocCkgdmVuZGVkb3IgPSBwLm93bmVyVmVuZG9yIHx8IHAudmVuZG9yQXNzaWduZWQgfHwgJyc7XG4gICAgICB9XG4gICAgICBjb2xhUm93cy5wdXNoKHtcbiAgICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgICBTS1U6IHNrdSxcbiAgICAgICAgQ2xpZW50ZTogYy5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDYXJkQ29kZTogYy5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBjLmNsaWVudFByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IGMuY2xpZW50TG9jYWxpdHkgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcbiAgICAgICAgUXR5X0JPOiBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksXG4gICAgICAgIEZlY2hhX1BlZGlkb19PcmlnaW5hbDogdHlwZW9mIGZlY2hhUGVkID09PSAnc3RyaW5nJyA/IGZlY2hhUGVkLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmVzdW1lblJvd3Muc29ydCgoYSwgYikgPT4gYi5RdHlfQV9SZXBhcnRpciAtIGEuUXR5X0FfUmVwYXJ0aXIpO1xuICBjb2xhUm93cy5zb3J0KFxuICAgIChhLCBiKSA9PlxuICAgICAgKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSB8fFxuICAgICAgKGEuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKVxuICApO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVuZGllbnRlRGVBc2lnbmFjaW9uX1BhYmxvXycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1Jlc3VtZW4gcmVwYXJ0bycsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgeyBuYW1lOiAnQ2xpZW50ZXMgZW4gY29sYScsIHJvd3M6IGNvbGFSb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IFBhYmxvOiAnICsgcmVzdW1lblJvd3MubGVuZ3RoICsgJyByZXBhcnRvcyAvICcgKyBjb2xhUm93cy5sZW5ndGggKyAnIGNsaWVudGVzIGVuIGNvbGEnLFxuICAgIDI4MDBcbiAgKTtcbn07XG5cbi8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXN1ZWx2ZSBub21icmUgZGUgZmFudGFzaWEgcGFyYSB1biBwZWRpZG8gdXNhbmRvIGVsXG4vLyBtaXNtbyBwYXR0ZXJuIHF1ZSBsYXMgY2FyZHMgZGVsIG1hcGEgKGluZGV4Lmh0bWw6OTkxNS05OTM1KTpcbi8vICAgMSkgY2xpZW50TWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWEgKGVkaXRhZG8gZGVzZGUgZWwgbW9kYWwgY2xpZW50ZSlcbi8vICAgMikgYXBwcm92ZWRBbHRhc0xpc3RbXS5mYW50YXNpYSBtYXRjaGVhZG8gcG9yIGNvbWVyY2lvID09IGNsaWVudE5hbWVcbmZ1bmN0aW9uIF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCkge1xuICBjb25zdCBjYXJkQ29kZSA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gIGlmIChjYXJkQ29kZSkge1xuICAgIGNvbnN0IG1ldGEgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmNsaWVudE1ldGE7XG4gICAgY29uc3QgY3VzdG9tID0gbWV0YSAmJiBtZXRhW2NhcmRDb2RlXSAmJiBtZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYTtcbiAgICBpZiAoY3VzdG9tICYmIFN0cmluZyhjdXN0b20pLnRyaW0oKSkgcmV0dXJuIFN0cmluZyhjdXN0b20pLnRyaW0oKTtcbiAgfVxuICBjb25zdCBhbHRhcyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuYXBwcm92ZWRBbHRhc0xpc3Q7XG4gIGlmIChBcnJheS5pc0FycmF5KGFsdGFzKSkge1xuICAgIGNvbnN0IG5hbWVMb3dlciA9IFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpXG4gICAgICAudHJpbSgpXG4gICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobmFtZUxvd2VyKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IHtcbiAgICAgICAgaWYgKCFhKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGNvbnN0IGMgPSBTdHJpbmcoYS5jb21lcmNpbyB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGYgPSBTdHJpbmcoYS5mYW50YXNpYSB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIHJldHVybiBjID09PSBuYW1lTG93ZXIgfHwgZiA9PT0gbmFtZUxvd2VyO1xuICAgICAgfSk7XG4gICAgICBpZiAobWF0Y2ggJiYgbWF0Y2guZmFudGFzaWEgJiYgU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhtYXRjaC5mYW50YXNpYSkudHJpbSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gJyc7XG59XG5cbi8vIHYxMjMzICgyMDI2LTEwLTA5KTogcmVwb3J0ZSBcIlZlbnRhcyB4IGFydGljdWxvIHggY2xpZW50ZS92ZW5kZWRvclwiIHZpYSBDRi5cbi8vIEFkbWluL2dlcmVudGUgb25seS4gVGFyZGEgfjMwLTYwcyAoQlEgcXVlcnkgKyBleGNlbGpzIGJ1aWxkIHNlcnZlci1zaWRlKS5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZlbnRhc0FydENsaUZvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIGlmIChtb250aElkeCA9PT0gbnVsbCB8fCBtb250aElkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgYWxlcnQoJ0VsZWdcdTAwRUQgdW4gTUVTIGVzcGVjXHUwMEVEZmljbyAobm8gXCJUb2RvIGVsIGFcdTAwRjFvXCIpIFx1MjAxNCBlc3RlIHJlcG9ydGUgZXMgbWVuc3VhbC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gbW9udGhJZHggdmllbmUgMC1iYXNlZCBkZXNkZSBlbCBwaWNrZXIgKGVuZT0wKS4gQ0YgZXNwZXJhIDEtYmFzZWQuXG4gIGNvbnN0IG1vbnRoID0gbW9udGhJZHggKyAxO1xuICBjb25zdCB5ZWFyID0gYW5pbztcbiAgY29uc3QgcGVyaW9kbyA9ICh3aW5kb3cuTUVTRVMgPyB3aW5kb3cuTUVTRVNbbW9udGhJZHhdIDogbW9udGgpICsgJyAnICsgeWVhcjtcbiAgY29uc3QgY29uZmlybU1zZyA9XG4gICAgJ0dlbmVyYXIgcmVwb3J0ZSBcIlZFTlRBUyB4IEFSVElDVUxPIHggQ0xJRU5URS9WRU5ERURPUlwiIGRlICcgK1xuICAgIHBlcmlvZG8gK1xuICAgICc/XFxuXFxuJyArXG4gICAgJ0Z1ZW50ZTogU0FQIHZpYSBCaWdRdWVyeSAoZGF0b3MgZXhhY3RvcykuXFxuJyArXG4gICAgJ1B1ZWRlIHRhcmRhciAzMC02MCBzZWd1bmRvcy5cXG4nICtcbiAgICAnQWwgdGVybWluYXIgc2UgZGVzY2FyZ2EgYXV0b21hdGljYW1lbnRlIGVsIHhsc3guJztcbiAgaWYgKCFjb25maXJtKGNvbmZpcm1Nc2cpKSByZXR1cm47XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gcmVwb3J0ZSBzZXJ2ZXItc2lkZSAoQlEpLi4uIHB1ZWRlIHRhcmRhciB+NjBzJyk7XG4gIHRyeSB7XG4gICAgLy8gdjEwMDAgcGF0dGVybjogcmVmcmVzaCBJRFRva2VuIGFudGVzIGRlIGNhbGxhYmxlIGNyaXRpY28uXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHUgPSB3aW5kb3cuZmlyZWJhc2UuYXV0aCAmJiB3aW5kb3cuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgICAgaWYgKHUgJiYgdS5nZXRJZFRva2VuKSBhd2FpdCB1LmdldElkVG9rZW4odHJ1ZSk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgY29uc3QgY2FsbGFibGUgPSB3aW5kb3cuZmlyZWJhc2VcbiAgICAgIC5hcHAoKVxuICAgICAgLmZ1bmN0aW9ucygnc291dGhhbWVyaWNhLWVhc3QxJylcbiAgICAgIC5odHRwc0NhbGxhYmxlKCdnZW5lcmF0ZVZlbnRhc1JlcG9ydENGJyk7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IGNhbGxhYmxlKHsgeWVhciwgbW9udGggfSk7XG4gICAgY29uc3QgciA9IChyZXNwICYmIHJlc3AuZGF0YSkgfHwge307XG4gICAgaWYgKCFyLm9rIHx8ICFyLmJ5dGVzQmFzZTY0KSB7XG4gICAgICBhbGVydCgnQ0YgZGV2b2x2aW8gZXJyb3I6ICcgKyAoci5lcnJvciB8fCBKU09OLnN0cmluZ2lmeShyKSkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBEZWNvZGUgYmFzZTY0IFx1MjE5MiBCbG9iIFx1MjE5MiBkb3dubG9hZCB0cmlnZ2VyLlxuICAgIGNvbnN0IGJpbiA9IGF0b2Ioci5ieXRlc0Jhc2U2NCk7XG4gICAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW4ubGVuZ3RoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbi5sZW5ndGg7IGkrKykgYnl0ZXNbaV0gPSBiaW4uY2hhckNvZGVBdChpKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J5dGVzXSwge1xuICAgICAgdHlwZTogci5taW1lVHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9XG4gICAgICByLmZpbGVuYW1lIHx8XG4gICAgICAndmVudGFzX3hfYXJ0aWN1bG9fY2xpZW50ZV8nICsgeWVhciArICctJyArIFN0cmluZyhtb250aCkucGFkU3RhcnQoMiwgJzAnKSArICcueGxzeCc7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gICAgICBhLnJlbW92ZSgpO1xuICAgIH0sIDEwMDApO1xuICAgIGNvbnN0IHN0YXRzID0gci5zdGF0cyB8fCB7fTtcbiAgICBzaG93U3luY1RhZyhcbiAgICAgICdPSzogJyArXG4gICAgICAgIChzdGF0cy52ZW50YXMgfHwgMCkgK1xuICAgICAgICAnIHZlbnRhcyAvICcgK1xuICAgICAgICAoc3RhdHMuaXRlbXMgfHwgMCkgK1xuICAgICAgICAnIFNLVXMgLyAnICtcbiAgICAgICAgKHN0YXRzLmNsaWVudHMgfHwgMCkgK1xuICAgICAgICAnIGNsaWVudGVzJ1xuICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbZXhwb3J0VmVudGFzQXJ0Q2xpXSBlcnJvcicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgcmVwb3J0ZTogJyArIChlICYmIGUubWVzc2FnZSA/IGUubWVzc2FnZSA6IFN0cmluZyhlKSkpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBQZWRpZG9zIGRlbCBtZXMuLi4nKTtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBzY29wZSA9IF9leHBvcnRTY29wZSgpO1xuICBjb25zdCBwZWRpZG9zID0gX2l0ZXJhdGVQZWRpZG9zTWVzKGFuaW8sIG1vbnRoSWR4LCBzY29wZSk7XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSB7XG4gICAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KHAubGluZXMpID8gcC5saW5lcyA6IFtdO1xuICAgIGlmICghbGluZXMubGVuZ3RoKSBjb250aW51ZTtcbiAgICBjb25zdCBmZWNoYSA9IHAuY3JlYXRlZEF0XG4gICAgICA/IHR5cGVvZiBwLmNyZWF0ZWRBdCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBwLmNyZWF0ZWRBdC5zbGljZSgwLCAxMClcbiAgICAgICAgOiBuZXcgRGF0ZShwLmNyZWF0ZWRBdC50b0RhdGUgPyBwLmNyZWF0ZWRBdC50b0RhdGUoKSA6IHAuY3JlYXRlZEF0KVxuICAgICAgICAgICAgLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICAgIC5zbGljZSgwLCAxMClcbiAgICAgIDogJyc7XG4gICAgLy8gdjk3NSAoMjAyNi0wOS0xNyk6IHJlc29sdmVyIGZhbnRhc2lhIHVuYSB2ZXogcG9yIHBlZGlkbyAobm8gcG9yIGxpbmVhKSBcdTIwMTRcbiAgICAvLyBlbCBsb29rdXAgZW4gY2xpZW50TWV0YSArIGFwcHJvdmVkQWx0YXNMaXN0IGVzIGNvbnN0YW50ZSBwYXJhIHRvZG8gZWwgcGVkaWRvLlxuICAgIGNvbnN0IG5vbWJyZUxvY2FsRmFudGFzaWEgPSBfcmVzb2x2ZUZhbnRhc2lhRm9yUGVkaWRvKHApO1xuICAgIGxpbmVzLmZvckVhY2goKGwsIGlkeCkgPT4ge1xuICAgICAgaWYgKCFsKSByZXR1cm47XG4gICAgICBjb25zdCBxdHkgPSBOdW1iZXIobC5xdHkpIHx8IDA7XG4gICAgICBjb25zdCBwcmVjaW8gPSBOdW1iZXIobC5wcmljZUF0Q3JlYXRpb24gfHwgbC5wcmVjaW8gfHwgMCk7XG4gICAgICAvLyB2MTU2NSAoMjAyNi0xMS0xOCk6IDggY29sdW1uYXMgZXhhY3RhcyBwb3IgcGVkaWRvIE1hcmlhbm8uXG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBGRUNIQV9ERV9QRURJRE86IGZlY2hhLFxuICAgICAgICBDTElFTlRFOiBwLmNsaWVudE5hbWUgfHwgJycsXG4gICAgICAgIElEX1BFRElETzogcC5fZnNJZCB8fCAnJyxcbiAgICAgICAgU0tVOiBsLmNvZGUgfHwgJycsXG4gICAgICAgIE5PTUJSRV9ERUxfUFJPRFVDVE86IGwuZGVzYyB8fCBsLm5hbWUgfHwgJycsXG4gICAgICAgIENBTlRJREFEOiBxdHksXG4gICAgICAgIFNVQlRPVEFMOiBNYXRoLnJvdW5kKHF0eSAqIHByZWNpbyksXG4gICAgICAgIExPQ0FMSURBRDogcC5sb2NOYW1lIHx8ICcnLFxuICAgICAgfSk7XG4gICAgICAvLyB2MTU2NTogbm9tYnJlTG9jYWxGYW50YXNpYSArIGlkeCBzaWd1ZW4gY29tcHV0YWRvcyAobm8gZXhwb3J0YWRvcykuXG4gICAgICB2b2lkIG5vbWJyZUxvY2FsRmFudGFzaWE7XG4gICAgICB2b2lkIGlkeDtcbiAgICAgIHZvaWQgc2NvcGU7XG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiAoYS5GRUNIQV9ERV9QRURJRE8gfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GRUNIQV9ERV9QRURJRE8gfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnUEVESURPUyBERUwgTUVTXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdQRURJRE9TIERFTCBNRVMnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBQZWRpZG9zIGRlbCBtZXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG4vLyBFeHBvcnRhciBwYXJhIEFuYWxpc2lzOiBwcm90ZWdpZG8gY29uIFBJTlxuY29uc3QgQU5BTElTSVNfUElOID0gJzEyMzUnO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeHBvcnQgRXhjZWwgVEFSR0VUUy1aT05BUyAtIHNvbG8gY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdlbmVyYSBsYSBob2phIENMSUVOVEVTX1pPTkFTIGNvbiBVTkEgZmlsYSBwb3IgQlAgcXVlIGVzdGEgdml2byBlbiBTQVA6XG4vLyBjdWFscXVpZXIgYWx0YSBkZSBjbGllbnRfYXBwbGljYXRpb25zIGNvbiBzdGF0dXM9J2FwcHJvdmVkJyBZIGNhcmRDb2RlU2FwXG4vLyBhc2lnbmFkby4gRXhjbHV5ZSBQT0lOVFMgLyBkaXN0cmlidWlkb3JlcyAvIHByb3NwZWN0b3MgLyBhbHRhcyBzaW5cbi8vIENhcmRDb2RlIChtb2NrcyBvIHBlbmRpZW50ZXMgZGUgU0FQKS4gRXMgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgZmFjdHVyYS5cbi8vIENvbHVtbmFzOiBUSVBPLCBOUk8gQ1RFLCBSRUdJT04sIFBST1ZJTkNJQSwgQVNFU09SIEVYVEVSTk8sIEFTRVNPUiBJTlRFUk5PLFxuLy8gQ0FMTEUsIE5VTUVSTywgTE9DQUxJREFELCBDUCwgTk9NQlJFIENPTUVSQ0lBTCwgTk9NQlJFIERFIEZBTlRBU0lBLCBDVUlULFxuLy8gQ09ORElDSU9OIEZJU0NBTCwgVEVMRUZPTk8sIENBUkRDT0RFIFNBUC5cbndpbmRvdy5leHBvcnRUYXJnZXRzWm9uYXMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaWNcdTAwRTEgdHUgY29uZXhpXHUwMEYzbiB5IHJlaW50ZW50XHUwMEUxLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBleHBvcnRhciBlbCBtYXN0ZXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgVEFSR0VUUy1aT05BUy4uLicpO1xuICBjb25zdCBWREVfVE9fVkRJID0ge1xuICAgICdGRURFUklDTyBDQVNURUxBTkVMTEknOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ0dPTlpBTE8gREUgTEEgUk9TQSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnTUFVUklDSU8gR0lMJzogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICAgIFBBQ0hJOiAnU0FOVElBR08gRVNURUJBTicsXG4gIH07XG4gIGZ1bmN0aW9uIHJlZ2lvbk9mKHByb3YpIHtcbiAgICBjb25zdCBwID0gKHByb3YgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgaWYgKFsnQlVFTk9TIEFJUkVTJywgJ0NBUElUQUwgRkVERVJBTCcsICdMQSBQQU1QQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0JVRU5PUyBBSVJFUyc7XG4gICAgaWYgKFsnQ09SRE9CQScsICdTQU4gTFVJUycsICdNRU5ET1pBJywgJ1NBTiBKVUFOJywgJ0xBIFJJT0pBJ10uaW5jbHVkZXMocCkpIHJldHVybiAnQ1VZTyc7XG4gICAgaWYgKFsnU0FOVEEgRkUnLCAnRU5UUkUgUklPUycsICdDSEFDTycsICdDT1JSSUVOVEVTJywgJ01JU0lPTkVTJywgJ0ZPUk1PU0EnXS5pbmNsdWRlcyhwKSlcbiAgICAgIHJldHVybiAnTkVBJztcbiAgICBpZiAoWydKVUpVWScsICdTQUxUQScsICdUVUNVTUFOJywgJ0NBVEFNQVJDQScsICdTQU5USUFHTyBERUwgRVNURVJPJ10uaW5jbHVkZXMocCkpIHJldHVybiAnTk9BJztcbiAgICBpZiAoWydORVVRVUVOJywgJ1JJTyBORUdSTycsICdDSFVCVVQnLCAnU0FOVEEgQ1JVWicsICdUSUVSUkEgREVMIEZVRUdPJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ1BBVEFHT05JQSc7XG4gICAgcmV0dXJuICcnO1xuICB9XG4gIGZ1bmN0aW9uIHZlbmRvckxhYmVsRm9yRXhjZWwoa2V5KSB7XG4gICAgaWYgKCFrZXkpIHJldHVybiAnJztcbiAgICBpZiAoa2V5ID09PSAnX19ESVNUUklCVVRPUl9fJykgcmV0dXJuICdESVNUUklCVUlET1JFUyc7XG4gICAgcmV0dXJuIGtleTtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIGxldCBhbHRhc1NuYXA7XG4gIHRyeSB7XG4gICAgYWx0YXNTbmFwID0gYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPT0nLCAnYXBwcm92ZWQnKVxuICAgICAgLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gYWx0YXMgYXByb2JhZGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBza2lwcGVkTm9TYXAgPSAwO1xuICBhbHRhc1NuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBjb25zdCBjYXJkQ29kZSA9IChhLmNhcmRDb2RlU2FwIHx8ICcnKS50cmltKCk7XG4gICAgLy8gRmlsdHJvIGNsYXZlOiBzb2xvIEJQcyBjb24gQ2FyZENvZGUgU0FQIGFzaWduYWRvICg9IGhhYmlsaXRhZG8gZW4gU0FQKS5cbiAgICBpZiAoIWNhcmRDb2RlKSB7XG4gICAgICBza2lwcGVkTm9TYXArKztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcHJvdmluY2UgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvVXBwZXJDYXNlKCkudHJpbSgpO1xuICAgIGNvbnN0IGxvY2FsaXR5RmluYWwgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcnO1xuICAgIGNvbnN0IHZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIFRJUE86ICdEQURPIERFIEFMVEEnLFxuICAgICAgJ05STyBDVEUnOiAwLCAvLyBzZSByZW51bWVyYSBkZXNwdWVzIGRlbCBzb3J0XG4gICAgICBSRUdJT046IHJlZ2lvbk9mKHByb3ZpbmNlKSxcbiAgICAgIFBST1ZJTkNJQTogcHJvdmluY2UsXG4gICAgICAnQVNFU09SIEVYVEVSTk8nOiB2ZW5kb3JMYWJlbEZvckV4Y2VsKHZlbmRvciksXG4gICAgICAnQVNFU09SIElOVEVSTk8nOiBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJycsXG4gICAgICBDQUxMRTogYS5jYWxsZSB8fCAnJyxcbiAgICAgIE5VTUVSTzogYS5udW1lcm8gfHwgJycsXG4gICAgICBMT0NBTElEQUQ6IGxvY2FsaXR5RmluYWwsXG4gICAgICBDUDogYS5jcCB8fCAnJyxcbiAgICAgICdOT01CUkUgQ09NRVJDSUFMJzogYS5jb21lcmNpbyB8fCBhLnRpdHVsYXIgfHwgJycsXG4gICAgICAnTk9NQlJFIERFIEZBTlRBU0lBJzogYS5mYW50YXNpYSB8fCAnJyxcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcbiAgICAgICdDT05ESUNJT04gRklTQ0FMJzogYS5jb25kaWNpb25GaXNjYWwgfHwgJycsXG4gICAgICBURUxFRk9OTzogYS50ZWxlZm9ubyB8fCAnJyxcbiAgICAgICdDQVJEQ09ERSBTQVAnOiBjYXJkQ29kZSxcbiAgICB9KTtcbiAgfSk7XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICBhbGVydChcbiAgICAgICdObyBoYXkgY2xpZW50ZXMgaGFiaWxpdGFkb3MgZW4gU0FQIHRvZGF2aWEuXFxuXFxuVW5hIGFsdGEgZW50cmEgYWwgZXhwb3J0IHNvbG8gY3VhbmRvIHRpZW5lIENhcmRDb2RlIFNBUCBhc2lnbmFkby4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcm93cy5zb3J0KChyMSwgcjIpID0+IHtcbiAgICBjb25zdCBwID0gKHIxLlBST1ZJTkNJQSB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5QUk9WSU5DSUEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKHIxLkxPQ0FMSURBRCB8fCAnJykubG9jYWxlQ29tcGFyZShyMi5MT0NBTElEQUQgfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKHIxWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpLmxvY2FsZUNvbXBhcmUocjJbJ05PTUJSRSBDT01FUkNJQUwnXSB8fCAnJyk7XG4gIH0pO1xuICByb3dzLmZvckVhY2goKHIsIGkpID0+IHtcbiAgICByWydOUk8gQ1RFJ10gPSBpICsgMTtcbiAgfSk7XG4gIC8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVmYWN0b3IgYSBkb3dubG9hZFhsc3ggKGVzdGlsbyB2ZXJkZSB1bmlmb3JtZSkuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZG93bmxvYWRYbHN4KCdUQVJHRVRTX1ZFTkRFRE9SRVNfWk9OQVNfJyArIHRzICsgJy54bHN4JywgW1xuICAgIHsgbmFtZTogJ0NMSUVOVEVTX1pPTkFTJywgcm93cyB9LFxuICBdKTtcbiAgc2hvd1N5bmNUYWcoXG4gICAgJ0V4Y2VsIGV4cG9ydGFkbzogJyArXG4gICAgICByb3dzLmxlbmd0aCArXG4gICAgICAnIGNsaWVudGVzIFNBUCBoYWJpbGl0YWRvcycgK1xuICAgICAgKHNraXBwZWROb1NhcCA+IDAgPyAnICgnICsgc2tpcHBlZE5vU2FwICsgJyBzaW4gQ2FyZENvZGUgZGVzY2FydGFkb3MpJyA6ICcnKVxuICApO1xufTtcblxud2luZG93Lm9wZW5FeHBvcnRBbmFsaXNpcyA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHBpbiA9IHByb21wdChcbiAgICAnRXN0YSBzZWNjaW9uIGNvbnRpZW5lIGZvcm1hdG9zIGF2YW56YWRvcyAoUG93ZXIgQkksIFB5dGhvbi9NTCwgWklQIGRlIGZvdG9zKSBkZXN0aW5hZG9zIGEgYW5hbGlzaXMgdGVjbmljby5cXG5cXG5JbmdyZXNhIGVsIFBJTiBwYXJhIGNvbnRpbnVhcjonXG4gICk7XG4gIGlmIChwaW4gPT09IG51bGwpIHJldHVybjtcbiAgaWYgKHBpbiAhPT0gQU5BTElTSVNfUElOKSB7XG4gICAgYWxlcnQoJ1BJTiBpbmNvcnJlY3RvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBPcGNpb24gSW50ZWdyYWNpb24gU0FQOiBzb2xvIHBhcmEgTWFyaWFubyAoZXJiaW5vbWFyaWFub0BnbWFpbC5jb20pXG4gIGNvbnN0IHNhcE9wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LXNhcC1pbnRlZ3JhdGlvbicpO1xuICBpZiAoc2FwT3B0KSB7XG4gICAgY29uc3QgaXNNYXJpYW5vID1cbiAgICAgIGN1cnJlbnRVc2VyICYmIChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSA9PT0gJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJztcbiAgICBzYXBPcHQuc3R5bGUuZGlzcGxheSA9IGlzTWFyaWFubyA/ICcnIDogJ25vbmUnO1xuICB9XG4gIC8vIE9wY2lvbiBCYWNrdXAgbWVuc3VhbDogc29sbyBhZG1pblxuICBjb25zdCBia09wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LWJhY2t1cC1tZW5zdWFsJyk7XG4gIGlmIChia09wdCkgYmtPcHQuc3R5bGUuZGlzcGxheSA9IHVzZXJSb2xlID09PSAnYWRtaW4nID8gJycgOiAnbm9uZSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtYW5hbGlzaXMtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxuLy8gSGVscGVycyBpbnRlcm5vcyAoZG93bmxvYWRYbHN4LCBleHBvcnRWZW50YXNGb3JNb250aCwgZXRjLikgc29uIGNvbnN1bWlkb3Ncbi8vIHNvbG8gZGVudHJvIGRlIGVzdGUgYmxvcXVlICh2ZXJpZmljYWRvIHByZS1leHRyYWNjaVx1MDBGM24pLlxuXG4vLyB2MTM5NiAoMjAyNi0xMC0yMSk6IGF2aXNvIGFsIGNsaWNrIHBhcmEgXCJWZW50YXMgXHUwMEQ3IGFydFx1MDBFRGN1bG8gXHUwMEQ3IGNsaWVudGVcIi5cbi8vIEFkbWluL2dlcmVudGUgb25seS4gVGFyZGEgMzAtNjBzLiBBbnRlcyBsYSBub3RhIGVzdGFiYSBlbiBsYSBkZXNjcmlwY2lcdTAwRjNuIGRlbFxuLy8gbGlzdGFkbyBkZWwgbW9kYWw7IGFob3JhIGVsIGxpc3RhZG8gc29sbyBtdWVzdHJhIGljb25vICsgdGl0dWxvLlxud2luZG93Ll92ZW50YXNBcnRDbGlDbGljayA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IHJvbGUgPSB3LnVzZXJSb2xlIHx8ICcnO1xuICBpZiAocm9sZSAhPT0gJ2FkbWluJyAmJiByb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnRXN0ZSByZXBvcnRlIGVzIHNvbG8gcGFyYSBhZG1pbiAvIGdlcmVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG9rID0gY29uZmlybShcbiAgICAnUmVwb3J0ZSBzZXJ2ZXItc2lkZSAoQmlnUXVlcnkpLiBUYXJkYSAzMC02MCBzZWd1bmRvcyB5IGRlc2NhcmdhIHVuIC54bHN4IGNvbiA0IGhvamFzOlxcbicgK1xuICAgICAgJyAgXHUyMDIyIFByb2R1Y3RvcyB2ZW5kaWRvcyBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgUHJvZHVjdG9zIE5PIHZlbmRpZG9zIHBvciBWREVcXG4nICtcbiAgICAgICcgIFx1MjAyMiBDbGllbnRlcyBDT04gY29tcHJhIHBvciBWREVcXG4nICtcbiAgICAgICcgIFx1MjAyMiBDbGllbnRlcyBTSU4gY29tcHJhIHBvciBWREVcXG5cXG4nICtcbiAgICAgICdDb250aW51YXI/J1xuICApO1xuICBpZiAoIW9rKSByZXR1cm47XG4gIGlmICh0eXBlb2Ygdy5jbG9zZUV4cG9ydERpYWxvZyA9PT0gJ2Z1bmN0aW9uJykgdy5jbG9zZUV4cG9ydERpYWxvZygpO1xuICBpZiAodHlwZW9mIHcuc2hvd01vbnRoUGlja2VyID09PSAnZnVuY3Rpb24nKSB3LnNob3dNb250aFBpY2tlcignVkVOVEFTX0FSVF9DTEknKTtcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUF3RE8sV0FBUyxjQUFjLEdBQUc7QUFDL0IsV0FBTyxPQUFPLEtBQUssRUFBRSxFQUNsQixLQUFLLEVBQ0wsWUFBWTtBQUFBLEVBQ2pCO0FBU0EsV0FBUyxhQUFhLEdBQUcsU0FBUztBQUNoQyxRQUFJLENBQUMsS0FBSyxPQUFPLFlBQVksV0FBWSxRQUFPLEVBQUUsV0FBVyxJQUFJLFFBQVEsZUFBZTtBQUN4RixRQUFJO0FBQ0YsWUFBTSxJQUFJLFFBQVEsT0FBTyxFQUFFLGtCQUFrQixFQUFFLEdBQUcsT0FBTyxFQUFFLGNBQWMsRUFBRSxDQUFDO0FBQzVFLFVBQUksS0FBSyxPQUFPLE1BQU0sVUFBVTtBQUM5QixlQUFPLEVBQUUsV0FBVyxjQUFjLEVBQUUsU0FBUyxHQUFHLFFBQVEsT0FBTyxFQUFFLFVBQVUsRUFBRSxFQUFFO0FBQUEsTUFDakY7QUFDQSxhQUFPLEVBQUUsV0FBVyxjQUFjLENBQUMsR0FBRyxRQUFRLEdBQUc7QUFBQSxJQUNuRCxTQUFTLElBQUk7QUFDWCxhQUFPLEVBQUUsV0FBVyxJQUFJLFFBQVEsUUFBUTtBQUFBLElBQzFDO0FBQUEsRUFDRjtBQWNPLFdBQVMsdUJBQXVCLEdBQUcsU0FBUztBQUNqRCxRQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsVUFBTSxJQUFJLGFBQWEsR0FBRyxPQUFPO0FBQ2pDLFFBQUksRUFBRSxVQUFXLFFBQU8sRUFBRTtBQUMxQixRQUFJLEVBQUUsV0FBVyxvQkFBcUIsUUFBTztBQUM3QyxRQUFJLENBQUMsT0FBTyxFQUFFLGtCQUFrQixFQUFFLEVBQUUsS0FBSyxFQUFHLFFBQU8sY0FBYyxFQUFFLGNBQWM7QUFDakYsV0FBTztBQUFBLEVBQ1Q7QUFTTyxXQUFTLHNCQUFzQixHQUFHLFNBQVM7QUFDaEQsUUFBSSxDQUFDLEVBQUcsUUFBTztBQUNmLFVBQU0sSUFBSSxhQUFhLEdB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
