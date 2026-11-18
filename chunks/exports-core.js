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
          else if (raw && typeof raw.seconds === "number")
            fechaIso = new Date(raw.seconds * 1e3).toISOString();
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
    const _resumenRows = Object.entries(byZone).map(([z, d]) => ({
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
      TAMA\u00D1O: r.Tama\u00F1o || r.Tamano || "",
      ESPECIALIZACION: r.Especializaci\u00F3n || r.Especializacion || "",
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
          else if (_rawDate && typeof _rawDate.toDate === "function")
            ms = _rawDate.toDate().getTime();
          else if (_rawDate && typeof _rawDate.seconds === "number") ms = _rawDate.seconds * 1e3;
        } catch {
          ms = null;
        }
        if (!ms || Number.isNaN(ms)) continue;
        if (now - ms > 90 * DAY_MS) continue;
        for (const l of p.lines) {
          if (!l || !l.code) continue;
          const qi = Number(l.qtyInvoiced) || 0;
          if (qi <= 0) continue;
          const sku = String(l.code).trim().toUpperCase();
          qtySum90.set(sku, (qtySum90.get(sku) || 0) + qi);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzIiwgIi4uL3NyYy9kb21haW5zL2V4cG9ydHMtY29yZS5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIHYxNTM0ICgyMDI2LTExLTAyKSBcdTIwMTQgQWxjYW5jZSBwb3Igcm9sIGRlIGxhcyBleHBvcnRhY2lvbmVzIGRlbCBtb2RhbFxuICogXCJSZXBvcnRlcyBFeGNlbFwiIChhdWRpdG9yXHUwMEVEYSBkb2NzL2F1ZGl0b3JpYS80NiwgRXRhcGEgMSkuXG4gKlxuICogUmVnbGFzIChkZWNpc2lvbmVzIGRlIE1hcmlhbm8pOlxuICogICAtIFwiTG9zIGNsaWVudGVzIGRlIHVuIHZlbmRlZG9yXCIgPSBlbCBtYXN0ZXIgQUNUVUFMIGRlbCBjbGllbnRlIChQT0lOVFMgK1xuICogICAgIHZlbmRvcl9vdmVycmlkZXMgKyBhcHByb3ZlZEFsdGFzLCBDTEFVREUubWQgXHUwMEE3NDYvXHUwMEE3NTApLiBOTyBlbCB2ZW5kZWRvclxuICogICAgIHF1ZSBxdWVkXHUwMEYzIGd1YXJkYWRvIGVuIGVsIHBlZGlkbyAoYXNzaWduZWRWZW5kb3JVaWQgc2UgZ3JhYmEgYWwgY3JlYXIgeVxuICogICAgIG5vIHNlIHJlLXNpbmNyb25pemEgY3VhbmRvIGNhbWJpYSBlbCBtYXN0ZXIpLlxuICogICAtIFZlbmRlZG9yIChWREUpOiB1biBwZWRpZG8gZW50cmEgc29sbyBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1XG4gKiAgICAgY2xpZW50ZSBlcyBlbCBzdXlvIFkgYWRlbVx1MDBFMXMgYGFzc2lnbmVkVmVuZG9yVWlkID09PSBteVVpZGAgKGRlZmVuc2EgZW5cbiAqICAgICBwcm9mdW5kaWRhZDogYG15VWlkYCBzYWxlIGRlIEZpcmViYXNlIEF1dGgsIG5vIGRlIGB1c2VyUm9sZWApLlxuICogICAtIEludGVybm8gKFZESSk6IHVuIHBlZGlkbyBlbnRyYSBzaSBlbCB2ZW5kZWRvciBkZWwgbWFzdGVyIGRlIHN1IGNsaWVudGVcbiAqICAgICBlc3RcdTAwRTEgZW4gc3UgY29uanVudG8gZGUgdmVuZGVkb3JlcyAoc3Ugem9uYSArIHN1cyBwYXJlamFzLCBlbCBtaXNtbyBxdWVcbiAqICAgICB1c2EgZWwgbWFwYTogZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cyAvIGdldEVmZmVjdGl2ZVZlbmRvclNldCgnQUxMJykpLlxuICogICAtIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS4gT3RybyByb2wgbyBzaW4gcm9sOiBuYWRhLlxuICogICAtIFZpc2l0YXM6IGVsIHZlbmRlZG9yIHZlIHNvbG8gbGFzIHF1ZSBjYXJnXHUwMEYzIFx1MDBFOWwgKGBvd25lclVpZCA9PT0gbXlVaWRgKTtcbiAqICAgICBlbCBpbnRlcm5vIHZlIGxhcyBzdXlhcyArIGxhcyBkZSBzdXMgcGFyZWphcyAocG9yIGBvd25lclVpZGAgZGUgdW5hXG4gKiAgICAgcGFyZWphLCBwb3IgYGNyZWF0ZWRCeVVpZGAgcHJvcGlvIG8gcG9yIGB2ZW5kb3JgIFx1MjIwOCBzdSBjb25qdW50bykuXG4gKlxuICogU29sbyB1biBwcm9zcGVjdG8gc2luIENhcmRDb2RlIFNBUCBjYWUgYWwgYHZlbmRvckFzc2lnbmVkYCBndWFyZGFkbyBlbiBlbFxuICogcGVkaWRvLiBVbiBDYXJkQ29kZSBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlLCBvIHVuYSB6b25hIHNpbiB2ZW5kZWRvcixcbiAqIHF1ZWRhIGZ1ZXJhIGRlbCBhbGNhbmNlIGRlIHZlbmRlZG9yIGUgaW50ZXJuby4gYG93bmVyVmVuZG9yYCAoPSBxdWlcdTAwRTluIGxvXG4gKiBjYXJnXHUwMEYzLCBsZWdhY3kpIE5PIHNlIHVzYSBwYXJhIGRlY2lkaXIgZWwgYWxjYW5jZTsgc29sbyBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc29cbiAqIHBhcmEgbGEgY29sdW1uYSBcIlZlbmRlZG9yXCIgZGVsIEV4Y2VsLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYgeyhjYXJkQ29kZTogc3RyaW5nLCBjbGllbnROYW1lOiBzdHJpbmcpID0+IChzdHJpbmd8e3ZlbmRvcktleT86IHN0cmluZywgcmVhc29uPzogc3RyaW5nfSl9IFJlc29sdmVWZW5kb3JGb3JDbGllbnRcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IEV4cG9ydFNjb3BlQXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd8bnVsbHx1bmRlZmluZWR9IHJvbGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfG51bGx8dW5kZWZpbmVkfSBbbXlVaWRdXG4gKiBAcHJvcGVydHkge3N0cmluZ3xudWxsfHVuZGVmaW5lZH0gW215VmVuZG9yS2V5XVxuICogQHByb3BlcnR5IHtTZXQ8c3RyaW5nPnxBcnJheTxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbZWZmZWN0aXZlVmVuZG9yU2V0XVxuICogQHByb3BlcnR5IHtBcnJheTxzdHJpbmc+fFNldDxzdHJpbmc+fG51bGx8dW5kZWZpbmVkfSBbcGFydG5lclVpZHNdXG4gKiBAcHJvcGVydHkge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlVmVuZG9yRm9yQ2xpZW50XVxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gRXhwb3J0U2NvcGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNHbG9iYWxcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdmlzaXRzUXVlcnlCeU93bmVyVWlkIC0gdHJ1ZTogY29uc3VsdGFyIHZpc2l0cyBjb24gd2hlcmUoJ293bmVyVWlkJywnPT0nLHVpZCkuXG4gKiBAcHJvcGVydHkgeyhwZWRpZG9zOiBBcnJheTxhbnk+KSA9PiBBcnJheTxhbnk+fSBmaWx0ZXJQZWRpZG9zXG4gKiBAcHJvcGVydHkgeyh2aXNpdHM6IEFycmF5PGFueT4pID0+IEFycmF5PGFueT59IGZpbHRlclZpc2l0c1xuICogQHByb3BlcnR5IHsocDogYW55KSA9PiBzdHJpbmd9IHZlbmRvckNvbHVtbkZvclBlZGlkb1xuICovXG5cbi8qKlxuICogTm9ybWFsaXphIHVuIHZlbmRvcktleTogdHJpbSArIG1heVx1MDBGQXNjdWxhcy5cbiAqIEBwYXJhbSB7YW55fSBrXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybVZlbmRvcktleShrKSB7XG4gIHJldHVybiBTdHJpbmcoayB8fCAnJylcbiAgICAudHJpbSgpXG4gICAgLnRvVXBwZXJDYXNlKCk7XG59XG5cbi8qKlxuICogUmVzdWx0YWRvIGRlbCBtYXN0ZXIgcGFyYSBlbCBjbGllbnRlIGRlbCBwZWRpZG8uIEFjZXB0YSB1biByZXNvbHZlciBxdWVcbiAqIGRldnVlbHZlIHN0cmluZyAodmVuZG9yS2V5KSBvIHt2ZW5kb3JLZXksIHJlYXNvbn0uXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fHVuZGVmaW5lZH0gcmVzb2x2ZVxuICogQHJldHVybnMge3t2ZW5kb3JLZXk6IHN0cmluZywgcmVhc29uOiBzdHJpbmd9fVxuICovXG5mdW5jdGlvbiBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSkge1xuICBpZiAoIXAgfHwgdHlwZW9mIHJlc29sdmUgIT09ICdmdW5jdGlvbicpIHJldHVybiB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gcmVzb2x2ZShTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJyksIFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpKTtcbiAgICBpZiAociAmJiB0eXBlb2YgciA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiB7IHZlbmRvcktleTogbm9ybVZlbmRvcktleShyLnZlbmRvcktleSksIHJlYXNvbjogU3RyaW5nKHIucmVhc29uIHx8ICcnKSB9O1xuICAgIH1cbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6IG5vcm1WZW5kb3JLZXkociksIHJlYXNvbjogJycgfTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgfVxufVxuXG4vKipcbiAqIFZlbmRlZG9yIHF1ZSBkZWZpbmUgZWwgYWxjYW5jZSBkZWwgcGVkaWRvOlxuICogICAtIGVsIGRlbCBtYXN0ZXIgYWN0dWFsLCBzaSByZXN1ZWx2ZTtcbiAqICAgLSB6b25hIHNpbiB2ZW5kZWRvciAoaW5jbHVpZG8gZGlzdHJpYnVpZG9yKTogJycgKGVsIG1hc3RlciBtYW5kYSk7XG4gKiAgIC0gcHJvc3BlY3RvIHNpbiBDYXJkQ29kZSBTQVA6IGVsIGB2ZW5kb3JBc3NpZ25lZGAgZ3VhcmRhZG8gZW4gZWwgcGVkaWRvO1xuICogICAtIENhcmRDb2RlIFNBUCBxdWUgZWwgbWFzdGVyIG5vIHJlc3VlbHZlOiAnJyAoZmFsbGEgY2VycmFkbykuIEVqLjogdW4gYWx0YVxuICogICAgIHJlYXNpZ25hZGEgYSBvdHJvIHZlbmRlZG9yIGRlc2FwYXJlY2UgZGVsIGFwcHJvdmVkQWx0YXNMaXN0IGRlbCBWREUgeVxuICogICAgIGVsIGB2ZW5kb3JBc3NpZ25lZGAgdmllam8gbm8gdGllbmUgcXVlIHZvbHZlciBhIG1ldGVybGEuXG4gKiBAcGFyYW0ge2FueX0gcFxuICogQHBhcmFtIHtSZXNvbHZlVmVuZG9yRm9yQ2xpZW50fSBbcmVzb2x2ZV1cbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpIHtcbiAgaWYgKCFwKSByZXR1cm4gJyc7XG4gIGNvbnN0IG0gPSBtYXN0ZXJMb29rdXAocCwgcmVzb2x2ZSk7XG4gIGlmIChtLnZlbmRvcktleSkgcmV0dXJuIG0udmVuZG9yS2V5O1xuICBpZiAobS5yZWFzb24gPT09ICd6b25hX3Npbl92ZW5kZWRvcicpIHJldHVybiAnJztcbiAgaWYgKCFTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpKSByZXR1cm4gbm9ybVZlbmRvcktleShwLnZlbmRvckFzc2lnbmVkKTtcbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFZhbG9yIGRlIGxhIGNvbHVtbmEgXCJWZW5kZWRvclwiIGRlbCBFeGNlbCBkZSBQZWRpZG9zIGRlbCBtZXM6IG1hc3RlciBhY3R1YWwsXG4gKiBkZXNwdVx1MDBFOXMgYHZlbmRvckFzc2lnbmVkYCwgeSBgb3duZXJWZW5kb3JgIHNvbG8gc2kgbm8gaGF5IG90cmEgY29zYS5cbiAqIEBwYXJhbSB7YW55fSBwXG4gKiBAcGFyYW0ge1Jlc29sdmVWZW5kb3JGb3JDbGllbnR9IFtyZXNvbHZlXVxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKSB7XG4gIGlmICghcCkgcmV0dXJuICcnO1xuICBjb25zdCBtID0gbWFzdGVyTG9va3VwKHAsIHJlc29sdmUpO1xuICBpZiAobS52ZW5kb3JLZXkpIHJldHVybiBtLnZlbmRvcktleTtcbiAgLy8gWm9uYSBzaW4gdmVuZGVkb3I6IGxhIGNvbHVtbmEgcXVlZGEgdmFjXHUwMEVEYSAobm8gc2UgbXVlc3RyYSBlbCB2ZW5kZWRvciB2aWVqbykuXG4gIGlmIChtLnJlYXNvbiA9PT0gJ3pvbmFfc2luX3ZlbmRlZG9yJykgcmV0dXJuICcnO1xuICByZXR1cm4gU3RyaW5nKHAudmVuZG9yQXNzaWduZWQgfHwgJycpLnRyaW0oKSB8fCBTdHJpbmcocC5vd25lclZlbmRvciB8fCAnJykudHJpbSgpO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7U2V0PHN0cmluZz58QXJyYXk8c3RyaW5nPnxudWxsfHVuZGVmaW5lZH0gc1xuICogQHJldHVybnMge1NldDxzdHJpbmc+fG51bGx9XG4gKi9cbmZ1bmN0aW9uIHRvTm9ybVNldChzKSB7XG4gIGlmICghcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG91dCA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBrIG9mIC8qKiBAdHlwZSB7SXRlcmFibGU8c3RyaW5nPn0gKi8gKHMpKSB7XG4gICAgY29uc3QgbiA9IG5vcm1WZW5kb3JLZXkoayk7XG4gICAgaWYgKG4pIG91dC5hZGQobik7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBBcm1hIGxvcyBmaWx0cm9zIGRlIGV4cG9ydGFjaVx1MDBGM24gcGFyYSBlbCByb2wgZGVsIHVzdWFyaW8uXG4gKiBAcGFyYW0ge0V4cG9ydFNjb3BlQXJnc30gYXJnc1xuICogQHJldHVybnMge0V4cG9ydFNjb3BlfVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRFeHBvcnRTY29wZShhcmdzKSB7XG4gIGNvbnN0IGEgPSBhcmdzIHx8IC8qKiBAdHlwZSB7RXhwb3J0U2NvcGVBcmdzfSAqLyAoeyByb2xlOiBudWxsIH0pO1xuICBjb25zdCByb2xlID0gU3RyaW5nKGEucm9sZSB8fCAnJyk7XG4gIGNvbnN0IG15VWlkID0gU3RyaW5nKGEubXlVaWQgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgbXlLZXkgPSBub3JtVmVuZG9yS2V5KGEubXlWZW5kb3JLZXkpO1xuICBjb25zdCByZXNvbHZlID1cbiAgICB0eXBlb2YgYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50ID09PSAnZnVuY3Rpb24nID8gYS5yZXNvbHZlVmVuZG9yRm9yQ2xpZW50IDogdW5kZWZpbmVkO1xuICAvKiogQHBhcmFtIHthbnl9IHAgKi9cbiAgY29uc3QgdmVuZG9yQ29sdW1uID0gKHApID0+IHZlbmRvckNvbHVtbkZvclBlZGlkbyhwLCByZXNvbHZlKTtcbiAgLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gYXJyICovXG4gIGNvbnN0IGNvbXBhY3QgPSAoYXJyKSA9PiAoQXJyYXkuaXNBcnJheShhcnIpID8gYXJyLmZpbHRlcihCb29sZWFuKSA6IFtdKTtcblxuICBpZiAocm9sZSA9PT0gJ3ZlbmRlZG9yJykge1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IHRydWUsXG4gICAgICB2ZW5kb3JDb2x1bW5Gb3JQZWRpZG86IHZlbmRvckNvbHVtbixcbiAgICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IHtcbiAgICAgICAgaWYgKCFteVVpZCB8fCAhbXlLZXkpIHJldHVybiBbXTtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QoYXJyKS5maWx0ZXIoXG4gICAgICAgICAgKHApID0+XG4gICAgICAgICAgICBTdHJpbmcocC5hc3NpZ25lZFZlbmRvclVpZCB8fCAnJykgPT09IG15VWlkICYmXG4gICAgICAgICAgICByZXNvbHZlUGVkaWRvVmVuZG9yS2V5KHAsIHJlc29sdmUpID09PSBteUtleVxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIGZpbHRlclZpc2l0czogKGFycikgPT4ge1xuICAgICAgICBpZiAoIW15VWlkKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKCh2KSA9PiBTdHJpbmcodi5vd25lclVpZCB8fCAnJykgPT09IG15VWlkKTtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmIChyb2xlID09PSAnaW50ZXJubycpIHtcbiAgICBjb25zdCBzZXQgPSB0b05vcm1TZXQoYS5lZmZlY3RpdmVWZW5kb3JTZXQpO1xuICAgIGNvbnN0IHBhcnRuZXJzID0gbmV3IFNldChcbiAgICAgIEFycmF5LmZyb20oLyoqIEB0eXBlIHtJdGVyYWJsZTxzdHJpbmc+fSAqLyAoYS5wYXJ0bmVyVWlkcyB8fCBbXSkpXG4gICAgICAgIC5tYXAoKHUpID0+IFN0cmluZyh1IHx8ICcnKS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoYXJyKSA9PiB7XG4gICAgICAgIGlmICghc2V0IHx8IHNldC5zaXplID09PSAwKSByZXR1cm4gW107XG4gICAgICAgIHJldHVybiBjb21wYWN0KGFycikuZmlsdGVyKChwKSA9PiB7XG4gICAgICAgICAgY29uc3QgayA9IHJlc29sdmVQZWRpZG9WZW5kb3JLZXkocCwgcmVzb2x2ZSk7XG4gICAgICAgICAgcmV0dXJuICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+XG4gICAgICAgIGNvbXBhY3QoYXJyKS5maWx0ZXIoKHYpID0+IHtcbiAgICAgICAgICBjb25zdCBvd25lciA9IFN0cmluZyh2Lm93bmVyVWlkIHx8ICcnKTtcbiAgICAgICAgICBpZiAobXlVaWQgJiYgKG93bmVyID09PSBteVVpZCB8fCBTdHJpbmcodi5jcmVhdGVkQnlVaWQgfHwgJycpID09PSBteVVpZCkpIHJldHVybiB0cnVlO1xuICAgICAgICAgIGlmIChvd25lciAmJiBwYXJ0bmVycy5oYXMob3duZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICBjb25zdCBrID0gbm9ybVZlbmRvcktleSh2LnZlbmRvcik7XG4gICAgICAgICAgcmV0dXJuICEhc2V0ICYmICEhayAmJiBzZXQuaGFzKGspO1xuICAgICAgICB9KSxcbiAgICB9O1xuICB9XG5cbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnICYmIHJvbGUgIT09ICd2aWV3ZXInKSB7XG4gICAgLy8gUm9sIHZhY1x1MDBFRG8sICd1bmFzc2lnbmVkJyBvIGRlc2Nvbm9jaWRvOiBubyBleHBvcnRhIG5hZGEgKGZhbGxhIGNlcnJhZG8pLlxuICAgIHJldHVybiB7XG4gICAgICBpc0dsb2JhbDogZmFsc2UsXG4gICAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgICAgdmVuZG9yQ29sdW1uRm9yUGVkaWRvOiB2ZW5kb3JDb2x1bW4sXG4gICAgICBmaWx0ZXJQZWRpZG9zOiAoKSA9PiBbXSxcbiAgICAgIGZpbHRlclZpc2l0czogKCkgPT4gW10sXG4gICAgfTtcbiAgfVxuXG4gIC8vIEFkbWluIC8gZ2VyZW50ZSAvIHZpZXdlcjogc2luIGNhbWJpbyAoZ2xvYmFsKS5cbiAgcmV0dXJuIHtcbiAgICBpc0dsb2JhbDogdHJ1ZSxcbiAgICB2aXNpdHNRdWVyeUJ5T3duZXJVaWQ6IGZhbHNlLFxuICAgIHZlbmRvckNvbHVtbkZvclBlZGlkbzogdmVuZG9yQ29sdW1uLFxuICAgIGZpbHRlclBlZGlkb3M6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgICBmaWx0ZXJWaXNpdHM6IChhcnIpID0+IGNvbXBhY3QoYXJyKSxcbiAgfTtcbn1cbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gRVhQT1JUUy1DT1JFOiBtYXN0ZXJmaWxlIGNsaWVudGVzICsgcHJlY2lvcy9zdG9jayArIG1vZGFsIGRlIGV4cG9ydGFyICtcbi8vIG1vbnRoIHBpY2tlciArIGV4cG9ydHMgcG9yIG1lcyArIGV4cG9ydFRhcmdldHNab25hcyArIG9wZW5FeHBvcnRBbmFsaXNpcy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgNjg4Ni03OTIxIHByZS1FMi5uLjEpLlxuLy8gRnJhZ21lbnRvcyByZXN0YW50ZXMgZGVsIGRvbWluaW8gZXhwb3J0czogYWR2YW5jZWQgKH4xMDMwMi0xMTQ1MSkgeSBTQVBcbi8vICh+MTgxMjMtMTk4MTIpIHJlcXVlcmlyXHUwMEUxbiBFMi5uLjIgeSBFMi5uLjMgKHJlZ2xhICMxNCBDTEFVREUubWQpLlxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUuIFNpbiBsaXN0ZW5lcnMuXG5pbXBvcnQgeyBidWlsZEV4cG9ydFNjb3BlIH0gZnJvbSAnLi4vcHVyZS9leHBvcnQtc2NvcGUuanMnO1xuXG4vLyB2MTUzNCAoMjAyNi0xMS0wMikgXHUyMDE0IGFsY2FuY2UgcG9yIHJvbCBkZSBsYXMgZXhwb3J0YWNpb25lcyAoYXVkaXRvclx1MDBFRGEgNDYsXG4vLyBFdGFwYSAxKS4gUmVnbGEgZW4gc3JjL3B1cmUvZXhwb3J0LXNjb3BlLmpzOiBlbCB2ZW5kZWRvciB2ZSBzb2xvIHBlZGlkb3MgZGVcbi8vIGNsaWVudGVzIHF1ZSBIT1kgc29uIHN1eW9zIGVuIGVsIG1hc3RlciAoUE9JTlRTICsgdmVuZG9yX292ZXJyaWRlcyArXG4vLyBhcHByb3ZlZEFsdGFzLCBcdTAwQTc0Ni9cdTAwQTc1MCkgeSBhZGVtXHUwMEUxcyBjb24gYXNzaWduZWRWZW5kb3JVaWQgPSBzdSB1c3VhcmlvOyBlbFxuLy8gaW50ZXJubyB2ZSBsb3MgY2xpZW50ZXMgZGUgc3Ugem9uYSArIHN1cyBwYXJlamFzIChnZXRNeUFsbG93ZWRWZW5kb3JLZXlzLFxuLy8gZWwgbWlzbW8gYWxjYW5jZSBkZWwgbWFwYSk7IGFkbWluL2dlcmVudGUgc2luIGNhbWJpby4gRWwgdWlkIHNhbGUgZGVcbi8vIEZpcmViYXNlIEF1dGggKG5vIGRlIHVzZXJSb2xlLCBxdWUgZXMgdW5hIHZhcmlhYmxlIGdsb2JhbCBlZGl0YWJsZSkuXG5mdW5jdGlvbiBfZXhwb3J0U2NvcGUoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdHlwZW9mIHVzZXJSb2xlICE9PSAndW5kZWZpbmVkJyA/IHVzZXJSb2xlIDogbnVsbDtcbiAgbGV0IG15VWlkID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHcuZmlyZWJhc2UgJiYgdy5maXJlYmFzZS5hdXRoICYmIHcuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgIG15VWlkID0gKHUgJiYgdS51aWQpIHx8ICcnO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG15VWlkID0gJyc7XG4gIH1cbiAgY29uc3QgbXlWZW5kb3JLZXkgPSB0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gYXNzaWduZWRWZW5kb3IgOiAnJztcbiAgbGV0IGVmZmVjdGl2ZVZlbmRvclNldCA9IG51bGw7XG4gIHRyeSB7XG4gICAgZWZmZWN0aXZlVmVuZG9yU2V0ID1cbiAgICAgIHR5cGVvZiBnZXRNeUFsbG93ZWRWZW5kb3JLZXlzID09PSAnZnVuY3Rpb24nID8gZ2V0TXlBbGxvd2VkVmVuZG9yS2V5cygpIDogbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQgPSBudWxsO1xuICB9XG4gIGxldCBwYXJ0bmVyVWlkcyA9IFtdO1xuICB0cnkge1xuICAgIHBhcnRuZXJVaWRzID0gKFxuICAgICAgKHR5cGVvZiBteUV4dGVybmFsUGFydG5lcnMgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkobXlFeHRlcm5hbFBhcnRuZXJzKVxuICAgICAgICA/IG15RXh0ZXJuYWxQYXJ0bmVyc1xuICAgICAgICA6IFtdKSB8fCBbXVxuICAgIClcbiAgICAgIC5tYXAoKHgpID0+IHggJiYgeC51aWQpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHBhcnRuZXJVaWRzID0gW107XG4gIH1cbiAgLy8gUmVzb2x2ZXIgZGVsIG1hc3RlciBjb24gbWVtbyBwb3IgY2xpZW50ZSAodW5hIHBhc2FkYSBwb3IgZXhwb3J0KS5cbiAgLy8gRGV2dWVsdmUge3ZlbmRvcktleSwgcmVhc29ufSBwYXJhIHF1ZSBlbCBhbGNhbmNlIGRpc3RpbmdhIHByb3NwZWN0byBzaW5cbiAgLy8gQ2FyZENvZGUgKGNhZSBhIHZlbmRvckFzc2lnbmVkKSBkZSBDYXJkQ29kZSBubyByZXN1ZWx0byAoYWZ1ZXJhKS5cbiAgY29uc3QgbWVtbyA9IG5ldyBNYXAoKTtcbiAgY29uc3QgcmVzb2x2ZVZlbmRvckZvckNsaWVudCA9IChjYXJkQ29kZSwgY2xpZW50TmFtZSkgPT4ge1xuICAgIGNvbnN0IGsgPSBTdHJpbmcoY2FyZENvZGUgfHwgJycpICsgJ3wnICsgU3RyaW5nKGNsaWVudE5hbWUgfHwgJycpO1xuICAgIGlmIChtZW1vLmhhcyhrKSkgcmV0dXJuIG1lbW8uZ2V0KGspO1xuICAgIGxldCBvdXQgPSB7IHZlbmRvcktleTogJycsIHJlYXNvbjogJ3Npbl9yZXNvbHZlcicgfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgciA9XG4gICAgICAgIHR5cGVvZiB3Ll9yZXNvbHZlQ2xpZW50VmVuZG9yRnJvbU1hc3RlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gdy5fcmVzb2x2ZUNsaWVudFZlbmRvckZyb21NYXN0ZXIoeyBjYXJkQ29kZSwgY2xpZW50TmFtZSB9KVxuICAgICAgICAgIDogbnVsbDtcbiAgICAgIGlmIChyKSBvdXQgPSB7IHZlbmRvcktleTogci52ZW5kb3JLZXkgfHwgJycsIHJlYXNvbjogci5yZWFzb24gfHwgJycgfTtcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgb3V0ID0geyB2ZW5kb3JLZXk6ICcnLCByZWFzb246ICdlcnJvcicgfTtcbiAgICB9XG4gICAgbWVtby5zZXQoaywgb3V0KTtcbiAgICByZXR1cm4gb3V0O1xuICB9O1xuICByZXR1cm4gYnVpbGRFeHBvcnRTY29wZSh7XG4gICAgcm9sZSxcbiAgICBteVVpZCxcbiAgICBteVZlbmRvcktleSxcbiAgICBlZmZlY3RpdmVWZW5kb3JTZXQsXG4gICAgcGFydG5lclVpZHMsXG4gICAgcmVzb2x2ZVZlbmRvckZvckNsaWVudCxcbiAgfSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRVhQT1JUIE1BU1RFUkZJTEUgREUgQ0xJRU5URVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RBUyBsYXMgdGllbmRhcyBkZWwgbWFwYSBjb24gc3VzIGRhdG9zIGNsYXZlOlxuLy8gbm9tYnJlLCB0aXBvIChjbGllbnRlL3Byb3NwZWN0byksIHpvbmEgZGVsIHZlbmRlZG9yLCBhc2Vzb3IgZXh0ZXJubywgYXNlc29yXG4vLyBpbnRlcm5vIChkZWR1Y2lkbyBwb3IgcGFyZWphIFZESSksIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBkZXBhcnRhbWVudG8sXG4vLyBkaXJlY2Npb24gKyBsb2NhbGlkYWQgZGVjbGFyYWRhcyBlbiBlbCBtb2RhbCBBbHRhIGRlIGNsaWVudGUgKHNpIGV4aXN0ZW4pLFxuLy8gY29vcmRlbmFkYXMgZ2VvY29kaWZpY2FkYXMsIGVzdGFkbyAoSGFiaWxpdGFkby9QZW5kaWVudGUvQ2FuY2VsYWRvKSxcbi8vIGNhdGVnb3JpYSAoUmVndWxhci9WZW50YXMgRXNwZWNpYWxlcy9EaXN0cmlidWlkb3IpLlxud2luZG93LmV4cG9ydE1hc3RlckNsaWVudGVzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIVBPSU5UUyB8fCAhUE9JTlRTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgY2FyZ2Fkb3MgdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBtYXN0ZXJmaWxlIGRlIGNsaWVudGVzLi4uJyk7XG5cbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGNhcmdhciBjbGllbnRfYnV5ZXJfc3RhdHMgZW4gYmxvcXVlICgxIGRvYyBwb3IgY2FyZENvZGUgU0FQKVxuICAvLyBBTlRFUyBkZSBhcm1hciBsYXMgZmlsYXMsIGFzXHUwMEVEIGNhZGEgZmlsYSB0aWVuZSBzdSBidXllciBzdGF0cyArIGZlY2hhXG4gIC8vIFx1MDBGQWx0aW1hIGNvbXByYSBzaW4gcm9tcGVyIGVsIGZsdWpvLiBGaXJlLWFuZC1mb3JnZXQgc2kgZmFsbGE6IGNhZGEgZmlsYVxuICAvLyBjYWUgYSBcIi1cIiBlbiBsb3MgY2FtcG9zIEJ1eWVyLiBBZG1pbi9nZXJlbnRlIHZlIHRvZGEgbGEgY29sZWNjaVx1MDBGM247XG4gIC8vIHZlbmRlZG9yIHZlIHNcdTAwRjNsbyBsb3Mgc3V5b3MgKHJ1bGVzKS4gU2kgbGEgcnVsZSBibG9xdWVhIFx1MjE5MiBjYXRjaCBcdTIxOTIgdmFjXHUwMEVEby5cbiAgLy8gUGVkaWRvIE1hcmlhbm86IG5vIGludmVudGFyIGNcdTAwRTFsY3VsbyBkZSBcIkZlY2hhIFx1MDBGQWx0aW1hIGNvbXByYVwiOyBzaSBub1xuICAvLyBleGlzdGUgc2Ugb21pdGUuIGJ1eWVyX3N0YXRzLnN0YXRzXzEybS51bHRpbWFDb21wcmEgWUEgZXhpc3RlLlxuICBjb25zdCBidXllclN0YXRzSWR4ID0gbmV3IE1hcCgpO1xuICB0cnkge1xuICAgIGNvbnN0IGJzU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2J1eWVyX3N0YXRzJykuZ2V0KCk7XG4gICAgYnNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGJ1eWVyU3RhdHNJZHguc2V0KGQuaWQsIGQuZGF0YSgpIHx8IHt9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICAnW21hc3RlcmZpbGVdIGNsaWVudF9idXllcl9zdGF0cyBubyBjYXJnYWRvIChydWxlIGRlbmllZCBvIHJlZCk6JyxcbiAgICAgIF9lICYmIF9lLm1lc3NhZ2VcbiAgICApO1xuICB9XG5cbiAgLy8gdjE1NjYgKDIwMjYtMTEtMTgpOiBjYXJnYXIgdmlzaXRzIGVuIGJsb3F1ZSAoMSBxdWVyeSBncmFuZGUpIHkgYWdydXBhclxuICAvLyBwb3IgY2FyZENvZGUgY29uIE1BWChmZWNoYSkuIEFsaW1lbnRhIGxhIGNvbHVtbmFcbiAgLy8gVUxUSU1BX1ZJU0lUQS9DT05UQUNUT19GRUNIQS4gRmlyZS1hbmQtZm9yZ2V0IHNpIGZhbGxhOiBjb2x1bW5hIHZhY2lhLlxuICAvLyBSdWxlczogdmlzaXRzIHJlYWQgYWJpZXJ0byBhIGlzUmVhZGVyKCk7IFZERSB2ZSBzXHUwMEYzbG8gbGFzIHN1eWFzIHBvclxuICAvLyBvd25lclVpZCwgYWRtaW4vZ2VyZW50ZSBsYXMgdmUgdG9kYXMuXG4gIGNvbnN0IHVsdGltYVZpc2l0YUlkeCA9IG5ldyBNYXAoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCB2U25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCk7XG4gICAgdlNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgdiA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcodi5jYXJkQ29kZSB8fCB2LmNsaWVudENhcmRDb2RlIHx8ICcnKVxuICAgICAgICAudHJpbSgpXG4gICAgICAgIC50b1VwcGVyQ2FzZSgpO1xuICAgICAgaWYgKCFjYykgcmV0dXJuO1xuICAgICAgY29uc3QgcmF3ID0gdi5mZWNoYSB8fCB2LmRhdGUgfHwgdi52aXNpdERhdGUgfHwgdi5jcmVhdGVkQXQgfHwgdi50aW1lc3RhbXAgfHwgbnVsbDtcbiAgICAgIGxldCBmZWNoYUlzbyA9IG51bGw7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXJhdykgZmVjaGFJc28gPSBudWxsO1xuICAgICAgICBlbHNlIGlmICh0eXBlb2YgcmF3ID09PSAnc3RyaW5nJykgZmVjaGFJc28gPSByYXc7XG4gICAgICAgIGVsc2UgaWYgKHJhdyAmJiB0eXBlb2YgcmF3LnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykgZmVjaGFJc28gPSByYXcudG9EYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgZWxzZSBpZiAocmF3ICYmIHR5cGVvZiByYXcuc2Vjb25kcyA9PT0gJ251bWJlcicpXG4gICAgICAgICAgZmVjaGFJc28gPSBuZXcgRGF0ZShyYXcuc2Vjb25kcyAqIDEwMDApLnRvSVNPU3RyaW5nKCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgZmVjaGFJc28gPSBudWxsO1xuICAgICAgfVxuICAgICAgaWYgKCFmZWNoYUlzbykgcmV0dXJuO1xuICAgICAgY29uc3QgcHJldiA9IHVsdGltYVZpc2l0YUlkeC5nZXQoY2MpO1xuICAgICAgaWYgKCFwcmV2IHx8IFN0cmluZyhmZWNoYUlzbykgPiBTdHJpbmcocHJldikpIHVsdGltYVZpc2l0YUlkeC5zZXQoY2MsIGZlY2hhSXNvKTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoX2VWaXNpdHMpIHtcbiAgICBjb25zb2xlLndhcm4oJ1ttYXN0ZXJmaWxlXSB2aXNpdHMgbm8gY2FyZ2FkbzonLCBfZVZpc2l0cyAmJiBfZVZpc2l0cy5tZXNzYWdlKTtcbiAgfVxuXG4gIC8vIEhlbHBlcnMgZGVsIHB1cmUgZm4gKGZhbGxiYWNrIGlubGluZSBzaSBidW5kbGUgbm8gY2FyZ1x1MDBGMykuXG4gIGNvbnN0IF9mY0xhYmVscyA9XG4gICAgKHdpbmRvdy5fX3BoYXNlMCAmJiB3aW5kb3cuX19waGFzZTAucHVyZSAmJiB3aW5kb3cuX19waGFzZTAucHVyZS5maWNoYUNsaWVudGVMYWJlbHMpIHx8IG51bGw7XG4gIGNvbnN0IF9jbGFzaWZSb3cgPSAoY21kKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQ2xhc2lmUm93XG4gICAgICA/IF9mY0xhYmVscy5maWNoYUNsaWVudGVDbGFzaWZSb3coY21kKVxuICAgICAgOiB7XG4gICAgICAgICAgJ1RpcG8gZGUgY2xpZW50ZSc6ICctJyxcbiAgICAgICAgICBGaWRlbGlkYWQ6ICctJyxcbiAgICAgICAgICAnUHJlZmVyZW5jaWEgZGUgY29udGFjdG8nOiAnLScsXG4gICAgICAgICAgVGFtYVx1MDBGMW86ICctJyxcbiAgICAgICAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogJy0nLFxuICAgICAgICAgICdUaXBvIGRlIGxvY2FsJzogJy0nLFxuICAgICAgICAgICdDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJzogY21kICYmIGNtZC5jcmVkaXRvQ2hlcXVlID8gTnVtYmVyKGNtZC5jcmVkaXRvQ2hlcXVlKSA6ICctJyxcbiAgICAgICAgfTtcbiAgY29uc3QgX2J1eWVyUm93ID0gKGJzKSA9PlxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmljaGFDbGllbnRlQnV5ZXJSb3dcbiAgICAgID8gX2ZjTGFiZWxzLmZpY2hhQ2xpZW50ZUJ1eWVyUm93KGJzLCAnMTJtJylcbiAgICAgIDoge1xuICAgICAgICAgICdNb250byB0b3RhbCAoMTJtKSc6ICctJyxcbiAgICAgICAgICAnRmFjdHVyYXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1Byb21lZGlvIHBvciBmYWN0dXJhICgxMm0pJzogJy0nLFxuICAgICAgICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAnLScsXG4gICAgICAgICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOiAnLScsXG4gICAgICAgICAgJ1ByaW1lcmEgY29tcHJhJzogJy0nLFxuICAgICAgICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnOiAnLScsXG4gICAgICAgIH07XG4gIGNvbnN0IF9maWxsRGFzaCA9IChyb3cpID0+XG4gICAgX2ZjTGFiZWxzICYmIF9mY0xhYmVscy5maWxsRGFzaEluRW1wdHkgPyBfZmNMYWJlbHMuZmlsbERhc2hJbkVtcHR5KHJvdykgOiByb3c7XG4gIC8vIHYxNDg1IFx1MDBBNzg0ICgyMDI2LTEwLTI3IEJVRyBGSVgpOiBiXHUwMEZBc3F1ZWRhIHBvciBjYXJkQ29kZSAoZnVlbnRlIGF1dG9yaXRhdGl2YSkuXG4gIC8vIHYxNDgyIHVzYWJhIGBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoY2xpZW50TG9jSWQocHJvdiwgbG9jLCBuYW1lKSlgIFx1MjAxNCBzbHVnXG4gIC8vIGRlcml2YWRvIGRlIFBPSU5UUy4gUGFyYSBNQVhFUkEsIFBPSU5UUyBkaWNlIFwiUGFsZXJtbyAoQzE0KVwiIHBlcm8gbGEgRmljaGFcbiAgLy8gcGVyc2lzdGUgY29uIFwiQ09MRUdJQUxFU1wiIFx1MjE5MiBkb2NJZCBtaXNtYXRjaCBcdTIxOTIgY21EYXRhIHVuZGVmaW5lZCBcdTIxOTIgNSBjYW1wb3NcbiAgLy8gRmljaGEgc2FsXHUwMEVEYW4gXCItXCIgYXVucXVlIGNhcmdhZG9zLiBmaW5kQ21EYXRhQnlDYXJkQ29kZSBlc2NhbmVhIHBvclxuICAvLyBzYXBDYXJkQ29kZSBPUiBjYXJkQ29kZVNhcCAoYW1ib3MgYWxpYXNlcykgeSByZXRvcm5hIGVsIGRvYyBjb3JyZWN0by5cbiAgY29uc3QgX2ZpbmRCeUNhcmQgPVxuICAgIF9mY0xhYmVscyAmJiBfZmNMYWJlbHMuZmluZENtRGF0YUJ5Q2FyZENvZGVcbiAgICAgID8gX2ZjTGFiZWxzLmZpbmRDbURhdGFCeUNhcmRDb2RlXG4gICAgICA6IChjYXJkQ29kZSwgY2FjaGUpID0+IHtcbiAgICAgICAgICBpZiAoIWNhcmRDb2RlIHx8ICFjYWNoZSB8fCB0eXBlb2YgY2FjaGUuZm9yRWFjaCAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIG51bGw7XG4gICAgICAgICAgbGV0IGZvdW5kID0gbnVsbDtcbiAgICAgICAgICBjYWNoZS5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgICAgICBpZiAoZm91bmQgfHwgIWQpIHJldHVybjtcbiAgICAgICAgICAgIGNvbnN0IGNjMSA9IFN0cmluZyhkLnNhcENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICAgICAgICBjb25zdCBjYzIgPSBTdHJpbmcoZC5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgICAgICAgICAgaWYgKGNjMSA9PT0gY2FyZENvZGUgfHwgY2MyID09PSBjYXJkQ29kZSkgZm91bmQgPSBkO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBmb3VuZDtcbiAgICAgICAgfTtcbiAgLy8gU2NvcGUgcG9yIHZlbmRvciAodjMzMSk6IGVsIGV4cG9ydCByZXNwZXRhIGVsIGZpbHRybyBkZSB6b25hIGFjdGl2byBlbiBlbFxuICAvLyBkcm9wZG93bi4gQWRtaW4vZ2VyZW50ZS92aWV3ZXIgY29uICdUb2Rhcycgb2J0aWVuZW4gbnVsbCAtPiBzaW4gZmlsdHJvXG4gIC8vIChleHBvcnRhIHRvZG8gZWwgcGFpcykuIFZlbmRlZG9yIG9idGllbmUge2Fzc2lnbmVkVmVuZG9yfS4gVkRJIG9idGllbmVcbiAgLy8gc3VzIHBhcmVqYXMgKyBwcm9waW8gc2kgZWxpZ2lvICdUb2RhcyBtaXMgem9uYXMnLCBvIHNvbG8gZWwgc3Vic2V0IHF1ZVxuICAvLyBlbGlnaW8gKHByb3BpbyAvIHVuYSBwYXJlamEgZXNwZWNpZmljYSkuIEZ1ZXJhIGRlIGVzdGUgc2V0LCBsYXMgdGllbmRhc1xuICAvLyBubyBzZSBpbmNsdXllbiBlbiBlbCBFeGNlbCAtIGVsIGFyY2hpdm8gcmVmbGVqYSBleGFjdGFtZW50ZSBsbyBxdWUgdmVcbiAgLy8gZW4gZWwgbWFwYSBxdWllbiBleHBvcnRhLlxuICBjb25zdCBzY29wZVNldCA9XG4gICAgdHlwZW9mIGdldEVmZmVjdGl2ZVZlbmRvclNldCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgPyBnZXRFZmZlY3RpdmVWZW5kb3JTZXQodHlwZW9mIGN1cnJlbnRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFZlbmRvciA6ICdBTEwnKVxuICAgICAgOiBudWxsO1xuICBjb25zdCBpblNjb3BlID0gKHZlbmRvcktleSkgPT4ge1xuICAgIGlmIChzY29wZVNldCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKCF2ZW5kb3JLZXkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gc2NvcGVTZXQuaGFzKHZlbmRvcktleSk7XG4gIH07XG4gIC8vIE1hcGVvIFZERSAtPiBWREkgKGEgcGFydGlyIGRlIGxhcyBwYXJlamFzIGVzdGFuZGFyKS4gQ3VhbmRvIHVuYSB0aWVuZGFcbiAgLy8gcGVydGVuZWNlIGEgRmVkZXJpY28gbyBHb256YWxvLCBlbCBWREkgZXMgSW9hbm5pcy4gQ3VhbmRvIGVzIGRlIE1hdXJpY2lvXG4gIC8vIG8gTWFydGluLCBlbCBWREkgZXMgU2FudGlhZ28uIFNpIGVuIGVsIGZ1dHVybyBzZSByZWFzaWduYW4gcGFyZWphcyB2aWFcbiAgLy8gcGFuZWwgYWRtaW4sIGVzdG8gc2UgcG9kcmlhIGxlZXIgZGVsIEZpcmVzdG9yZSAtIHBlcm8gcGFyYSBlbCBtYXN0ZXJmaWxlXG4gIC8vIGVzdGF0aWNvLCB1c2Ftb3MgZWwgZXN0YW5kYXIuXG4gIGNvbnN0IFZERV9UT19WREkgPSB7XG4gICAgJ0ZFREVSSUNPIENBU1RFTEFORUxMSSc6ICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgICAnR09OWkFMTyBERSBMQSBST1NBJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdNQVVSSUNJTyBHSUwnOiAnU0FOVElBR08gRVNURUJBTicsXG4gICAgUEFDSEk6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgfTtcbiAgZnVuY3Rpb24gbG9va3VwWm9uZSh2ZW5kb3JLZXkpIHtcbiAgICBjb25zdCB2ID0gdHlwZW9mIFZFTkRPUlMgIT09ICd1bmRlZmluZWQnID8gVkVORE9SUy5maW5kKCh2dikgPT4gdnYua2V5ID09PSB2ZW5kb3JLZXkpIDogbnVsbDtcbiAgICByZXR1cm4gdiA/IHYuem9uZSA6ICcnO1xuICB9XG4gIGZ1bmN0aW9uIGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvcktleSkge1xuICAgIGNvbnN0IHYgPSB0eXBlb2YgVkVORE9SUyAhPT0gJ3VuZGVmaW5lZCcgPyBWRU5ET1JTLmZpbmQoKHZ2KSA9PiB2di5rZXkgPT09IHZlbmRvcktleSkgOiBudWxsO1xuICAgIHJldHVybiB2ID8gdi5sYWJlbCA6IHZlbmRvcktleSB8fCAnJztcbiAgfVxuXG4gIC8vIHY0NTAgKDIwMjYtMDgtMTEpOiBpbmRpY2UgZGUgY2xhc2lmaWNhY2lvbiBkZXNkZSB2aXNpdHMuIFBhcmEgY2FkYVxuICAvLyBjbGllbnRlLCBtZXJnZWEgbG9zIGNhbXBvcyBkZSBjbGFzaWZpY2FjaW9uICh0aXBvL3RhbWFuby9maWRlbGlkYWQvXG4gIC8vIGVzcGVjaWFsaXphY2lvbi9jYW5hbENvbXByYS9wb3AvdGlwb1ZlbnRhL2V0Yy4pIGRlbCBmb3JtdWxhcmlvIGRlXG4gIC8vIHZpc2l0YS9jb250YWN0YWRvLiBQb2xpdGljYTogY2FtcG8gcG9yIGNhbXBvLCB0b21hciBlbCBwcmltZXIgdmFsb3JcbiAgLy8gTk8gVkFDSU8gYWwgcmVjb3JyZXIgZG9jcyBkZSBtYXMgcmVjaWVudGUgYSBtYXMgYW50aWd1by4gQXNpIGVsIHVzdWFyaW9cbiAgLy8gdmUgbGEgY2xhc2lmaWNhY2lvbiBtYXMgYWN0dWFsaXphZGEsIHBlcm8gc2kgZWwgdWx0aW1vIGNvbnRhY3RvIG5vIGxsZW5hXG4gIC8vIHVuIGNhbXBvIChjb250YWN0b3MgdGllbmVuIG1lbm9zIGNhbXBvcyBxdWUgdmlzaXRhcyksIGNhZSBhbCBhbnRlcmlvclxuICAvLyBlbiB2ZXogZGUgZGVqYXIgdmFjaW8uIFBlZGlkbyBkZSBNYXJpYW5vOiBcInByaW9yaXphciBsYSB1bHRpbWFcbiAgLy8gaW50ZXJhY2Npb24gcGVybyBubyBwZXJkZXIgaW5mbyB1dGlsIGRlIGxhcyBhbnRlcmlvcmVzXCIuXG4gIGNvbnN0IENMQVNTSUZfRklFTERTID0gW1xuICAgICd0aXBvJyxcbiAgICAnbG9jYWwnLFxuICAgICd0YW1hbm8nLFxuICAgICdmaWRlbGlkYWQnLFxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxuICAgICdjYW5hbENvbXByYScsXG4gICAgJ3JlbGV2YW5jaWEnLFxuICAgICdwb3AnLFxuICAgICduZWNlc2lkYWRQdW50dWFsJyxcbiAgICAndGlwb1ZlbnRhJyxcbiAgICAncG9uZGVyYWNpb25Nb3N0cmFkbycsXG4gICAgJ3BvbmRlcmFjaW9uRWNvbW1lcmNlJyxcbiAgICAnY29tcGV0ZW5jaWEnLFxuICAgICdvcG9ydHVuaWRhZCcsXG4gICAgJ21hc1ZlbmRpZG8nLFxuICAgICdtYXNQcmVndW50YW4nLFxuICAgICdheXVkYVRpZW5kYScsXG4gIF07XG4gIGZ1bmN0aW9uIF9jbGFzc2lmS2V5KHByb3YsIGxvYywgdGllbmRhKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIChwcm92IHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkudHJpbSgpICtcbiAgICAgICd8JyArXG4gICAgICAobG9jIHx8ICcnKS50b1N0cmluZygpLnRyaW0oKSArXG4gICAgICAnfCcgK1xuICAgICAgKHRpZW5kYSB8fCAnJykudG9TdHJpbmcoKS50cmltKClcbiAgICApO1xuICB9XG4gIGZ1bmN0aW9uIF9jbGFzc2lmVHModikge1xuICAgIGlmICh2ICYmIHYuY3JlYXRlZEF0ICYmIHYuY3JlYXRlZEF0LnRvTWlsbGlzKSByZXR1cm4gdi5jcmVhdGVkQXQudG9NaWxsaXMoKTtcbiAgICBpZiAodiAmJiB2LmZlY2hhKSByZXR1cm4gbmV3IERhdGUodi5mZWNoYSkuZ2V0VGltZSgpIHx8IDA7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgY29uc3QgY2xhc3NpZkluZGV4ID0gbmV3IE1hcCgpOyAvLyBrZXkgLT4geyBsYXN0OiB7Y2FtcG9zfSwgbGFzdEZlY2hhLCBsYXN0VHlwZSwgdmlzaXRhcywgY29udGFjdG9zIH1cbiAgaWYgKHR5cGVvZiB2aXNpdHNDYWNoZSAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheSh2aXNpdHNDYWNoZSkpIHtcbiAgICBjb25zdCBieUtleSA9IG5ldyBNYXAoKTtcbiAgICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICBpZiAoIXYpIHJldHVybjtcbiAgICAgIGNvbnN0IGsgPSBfY2xhc3NpZktleSh2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcbiAgICAgIGlmICghYnlLZXkuaGFzKGspKSBieUtleS5zZXQoaywgW10pO1xuICAgICAgYnlLZXkuZ2V0KGspLnB1c2godik7XG4gICAgfSk7XG4gICAgYnlLZXkuZm9yRWFjaCgoYXJyLCBrKSA9PiB7XG4gICAgICBhcnIuc29ydCgoYSwgYikgPT4gX2NsYXNzaWZUcyhiKSAtIF9jbGFzc2lmVHMoYSkpOyAvLyBkZXNjIHBvciBmZWNoYVxuICAgICAgY29uc3QgbWVyZ2VkID0ge307XG4gICAgICBhcnIuZm9yRWFjaCgodikgPT4ge1xuICAgICAgICBDTEFTU0lGX0ZJRUxEUy5mb3JFYWNoKChmKSA9PiB7XG4gICAgICAgICAgaWYgKG1lcmdlZFtmXSAhPSBudWxsICYmIG1lcmdlZFtmXSAhPT0gJycgJiYgbWVyZ2VkW2ZdICE9PSAwKSByZXR1cm47XG4gICAgICAgICAgY29uc3QgdmFsID0gdltmXTtcbiAgICAgICAgICBpZiAodmFsICE9IG51bGwgJiYgdmFsICE9PSAnJykgbWVyZ2VkW2ZdID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGF0ZXN0ID0gYXJyWzBdIHx8IHt9O1xuICAgICAgY2xhc3NpZkluZGV4LnNldChrLCB7XG4gICAgICAgIG1lcmdlZCxcbiAgICAgICAgbGFzdEZlY2hhOiBsYXRlc3QuZmVjaGEgfHwgJycsXG4gICAgICAgIGxhc3RUeXBlOiBsYXRlc3QuaW50ZXJhY3Rpb25UeXBlIHx8IChsYXRlc3QuZXNwYWNpbyA/ICd2aXNpdGEnIDogJycpLFxuICAgICAgICB2aXNpdGFzOiBhcnIuZmlsdGVyKCh2KSA9PiB2LmludGVyYWN0aW9uVHlwZSAhPT0gJ2NvbnRhY3RvJykubGVuZ3RoLFxuICAgICAgICBjb250YWN0b3M6IGFyci5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKS5sZW5ndGgsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBmdW5jdGlvbiBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIHRpZW5kYSkge1xuICAgIGNvbnN0IGVudHJ5ID0gY2xhc3NpZkluZGV4LmdldChfY2xhc3NpZktleShwcm92LCBsb2MsIHRpZW5kYSkpO1xuICAgIGlmICghZW50cnkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAnJyxcbiAgICAgICAgJ1RpcG8gdWx0aW1hIGludGVyYWNjaW9uJzogJycsXG4gICAgICAgICdUb3RhbCB2aXNpdGFzJzogMCxcbiAgICAgICAgJ1RvdGFsIGNvbnRhY3Rvcyc6IDAsXG4gICAgICAgICdUaXBvIGNvbWVyY2lvJzogJycsXG4gICAgICAgIExvY2FsOiAnJyxcbiAgICAgICAgVGFtYW5vOiAnJyxcbiAgICAgICAgRmlkZWxpZGFkOiAnJyxcbiAgICAgICAgRXNwZWNpYWxpemFjaW9uOiAnJyxcbiAgICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6ICcnLFxuICAgICAgICBSZWxldmFuY2lhOiAnJyxcbiAgICAgICAgUE9QOiAnJyxcbiAgICAgICAgJ05lY2VzaWRhZCBwdW50dWFsJzogJycsXG4gICAgICAgICdUaXBvIGRlIHZlbnRhJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBtb3N0cmFkb3IgKCUpJzogJycsXG4gICAgICAgICdQb25kZXJhY2lvbiBlLWNvbW1lcmNlICglKSc6ICcnLFxuICAgICAgICBDb21wZXRlbmNpYTogJycsXG4gICAgICAgIE9wb3J0dW5pZGFkOiAnJyxcbiAgICAgICAgJ01hcyB2ZW5kaWRvJzogJycsXG4gICAgICAgICdNYXMgcHJlZ3VudGFuJzogJycsXG4gICAgICAgICdBeXVkYSB0aWVuZGEnOiAnJyxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IG0gPSBlbnRyeS5tZXJnZWQgfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0RmVjaGEsXG4gICAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiBlbnRyeS5sYXN0VHlwZSxcbiAgICAgICdUb3RhbCB2aXNpdGFzJzogZW50cnkudmlzaXRhcyxcbiAgICAgICdUb3RhbCBjb250YWN0b3MnOiBlbnRyeS5jb250YWN0b3MsXG4gICAgICAnVGlwbyBjb21lcmNpbyc6IG0udGlwbyB8fCAnJyxcbiAgICAgIExvY2FsOiBtLmxvY2FsIHx8ICcnLFxuICAgICAgVGFtYW5vOiBtLnRhbWFubyB8fCAnJyxcbiAgICAgIEZpZGVsaWRhZDogbS5maWRlbGlkYWQgfHwgJycsXG4gICAgICBFc3BlY2lhbGl6YWNpb246IG0uZXNwZWNpYWxpemFjaW9uIHx8ICcnLFxuICAgICAgJ0NhbmFsIGRlIGNvbXByYSc6IG0uY2FuYWxDb21wcmEgfHwgJycsXG4gICAgICBSZWxldmFuY2lhOiBtLnJlbGV2YW5jaWEgIT0gbnVsbCA/IG0ucmVsZXZhbmNpYSA6ICcnLFxuICAgICAgUE9QOiBtLnBvcCB8fCAnJyxcbiAgICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IG0ubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAgICdUaXBvIGRlIHZlbnRhJzogbS50aXBvVmVudGEgfHwgJycsXG4gICAgICAnUG9uZGVyYWNpb24gbW9zdHJhZG9yICglKSc6IG0ucG9uZGVyYWNpb25Nb3N0cmFkbyAhPSBudWxsID8gbS5wb25kZXJhY2lvbk1vc3RyYWRvIDogJycsXG4gICAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyBtLnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgICBDb21wZXRlbmNpYTogbS5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIE9wb3J0dW5pZGFkOiBtLm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICAgJ01hcyB2ZW5kaWRvJzogbS5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgJ01hcyBwcmVndW50YW4nOiBtLm1hc1ByZWd1bnRhbiB8fCAnJyxcbiAgICAgICdBeXVkYSB0aWVuZGEnOiBtLmF5dWRhVGllbmRhIHx8ICcnLFxuICAgIH07XG4gIH1cblxuICAvLyBGSUxUUk8gU0FQOiBzb2xvIHNlIGV4cG9ydGFuIGxvcyBjbGllbnRlcyBIQUJJTElUQURPUyBlbiBTQVAgLSBsb3MgcXVlXG4gIC8vIHRpZW5lbiBjYXJkQ29kZSArIGRpcmVjY2lvbi4gRXNvcyBzb24gbG9zIHF1ZSBhcGFyZWNlbiBjb21vIHZlcmRlcyBlblxuICAvLyBlbCBtYXBhIHkgc2UgY3VlbnRhbiBlbiBlbCBzdGF0IEhBQklMSVRBRE9TLiBBbnRlcyBlbCBtYXN0ZXJmaWxlIGJhamFiYVxuICAvLyBsb3MgfjEwMDAgUE9JTlRTIGRlbCBwYWRyb24gaGlzdG9yaWNvLCBxdWUgbm8gcmVwcmVzZW50YWJhIGVsIHVuaXZlcnNvXG4gIC8vIHJlYWwgb3BlcmFibGUgaG95LlxuICBjb25zdCByb3dzID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgcHJvdmluY2UgPSBwLnByb3ZpbmNlIHx8ICcnO1xuICAgIGNvbnN0IGxvY2FsaXR5TWFwID0gcC5uYW1lIHx8ICcnO1xuICAgIGNvbnN0IGRlcHQgPSBwLmRlcHQgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9yID0gcC52ZW5kb3IgfHwgJyc7XG4gICAgLy8gdjMzMTogZmlsdHJhciBwb3Igc2NvcGUgZGUgdmVuZG9yIGRlbCB1c3VhcmlvIHF1ZSBleHBvcnRhLlxuICAgIGlmICghaW5TY29wZSh2ZW5kb3IpKSByZXR1cm47XG4gICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICBjb25zdCB2ZGkgPSBWREVfVE9fVkRJW3ZlbmRvcl0gfHwgJyc7XG4gICAgY29uc3QgbGF0ID0gcC5sYXQgIT0gbnVsbCA/IHAubGF0IDogJyc7XG4gICAgY29uc3QgbG9uID0gcC5sb24gIT0gbnVsbCA/IHAubG9uIDogJyc7XG4gICAgLy8gU29sbyBjbGllbnRlcyByZWd1bGFyZXMgKG5vIHByb3NwZWN0cywgbm8gZGlzdHJpYnVpZG9yZXMpIHF1ZSBwYXNlblxuICAgIC8vIGVsIGZpbHRybyBpc1NhcENvbmZpcm1lZDogdGllbmVuIGNhcmRDb2RlU2FwICsgZGlyZWNjaW9uLlxuICAgIChwLmNsaWVudHMgfHwgW10pLmZvckVhY2goKG5hbWUpID0+IHtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKHR5cGVvZiBpc1NhcENvbmZpcm1lZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhaXNTYXBDb25maXJtZWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSlcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY29uc3QgayA9ICdDfCcgKyBwcm92aW5jZSArICd8JyArIGxvY2FsaXR5TWFwICsgJ3wnICsgbmFtZTtcbiAgICAgIC8vIEVzdGFkbzogaGFiaWxpdGFkby9jYW5jZWxhZG8vcGVuZGllbnRlIChsZWdhY3kgY29udGFjdGVkIHNldCkuXG4gICAgICBsZXQgZXN0YWRvID0gJ0hhYmlsaXRhZG8nOyAvLyBwb3IgZGVmaW5pY2lvbiB5YSBlc3RhIFNBUC1jb25maXJtYWRvXG4gICAgICBpZiAodHlwZW9mIGNhbmNlbGVkICE9PSAndW5kZWZpbmVkJyAmJiBjYW5jZWxlZCAmJiBjYW5jZWxlZC5oYXMgJiYgY2FuY2VsZWQuaGFzKGspKVxuICAgICAgICBlc3RhZG8gPSAnQ2FuY2VsYWRvJztcbiAgICAgIC8vIE1ldGFkYXRhIGN1c3RvbSAoZGlyZWNjaW9uLCBsb2NhbGlkYWQgZGVjbGFyYWRhLCBnZW9jb2RlKS5cbiAgICAgIGNvbnN0IG1ldGEgPSB0eXBlb2YgY2xpZW50TWV0YSAhPT0gJ3VuZGVmaW5lZCcgJiYgY2xpZW50TWV0YSA/IGNsaWVudE1ldGFba10gfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGN1c3RvbU5hbWUgPSBtZXRhLmN1c3RvbU5hbWUgfHwgJyc7XG4gICAgICAvLyBCdXNjYXIgYWRkcmVzczogMSkgY2xpZW50X21hc3Rlci5hZGRyZXNzIChhZG1pbiksIDIpIGNsaWVudE1ldGEuYWRkcmVzcyAodmVuZG9yKS5cbiAgICAgIGNvbnN0IGRvY0lkID1cbiAgICAgICAgdHlwZW9mIGNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nID8gY2xpZW50TG9jSWQocHJvdmluY2UsIGxvY2FsaXR5TWFwLCBuYW1lKSA6ICcnO1xuICAgICAgY29uc3QgY21EYXRhID1cbiAgICAgICAgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlICE9PSAndW5kZWZpbmVkJyAmJiBkb2NJZCA/IGNsaWVudE1hc3RlckNhY2hlLmdldChkb2NJZCkgfHwge30gOiB7fTtcbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBjbURhdGEuYWRkcmVzcyB8fCBtZXRhLmFkZHJlc3MgfHwgJyc7XG4gICAgICBjb25zdCBsb2NhbGl0eUN1c3QgPSBjbURhdGEubG9jYWxpZGFkIHx8IG1ldGEubG9jYWxpdHkgfHwgJyc7XG4gICAgICBjb25zdCBjdXN0b21MYXQgPSBtZXRhLmxhdCAhPSBudWxsID8gbWV0YS5sYXQgOiAnJztcbiAgICAgIGNvbnN0IGN1c3RvbUxuZyA9IG1ldGEubG5nICE9IG51bGwgPyBtZXRhLmxuZyA6ICcnO1xuICAgICAgLy8gQ2FyZENvZGUgU0FQIChkZSBjbGllbnRfbWFzdGVyIG8gZGUgbGEgYWx0YSB2aW5jdWxhZGEpLlxuICAgICAgbGV0IGNhcmRDb2RlID0gY21EYXRhLnNhcENhcmRDb2RlIHx8ICcnO1xuICAgICAgaWYgKCFjYXJkQ29kZSAmJiB0eXBlb2YgYXBwcm92ZWRBbHRhc0J5TG9jICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBjb25zdCBrZXkgPSBwcm92aW5jZS50b1VwcGVyQ2FzZSgpICsgJ3wnICsgbG9jYWxpdHlNYXA7XG4gICAgICAgIGNvbnN0IGFsdGFzID0gYXBwcm92ZWRBbHRhc0J5TG9jW2tleV0gfHwgW107XG4gICAgICAgIGNvbnN0IGFsdGFNYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IChhLmNvbWVyY2lvIHx8IGEuZmFudGFzaWEgfHwgJycpID09PSBuYW1lKTtcbiAgICAgICAgaWYgKGFsdGFNYXRjaCkgY2FyZENvZGUgPSBhbHRhTWF0Y2guY2FyZENvZGVTYXAgfHwgJyc7XG4gICAgICB9XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogQnV5ZXIgc3RhdHMgaW5kZXhhZG8gcG9yIGNhcmRDb2RlIFNBUC5cbiAgICAgIGNvbnN0IF9idXllclN0YXRzID0gY2FyZENvZGUgPyBidXllclN0YXRzSWR4LmdldChjYXJkQ29kZSkgfHwgbnVsbCA6IG51bGw7XG4gICAgICAvLyB2MTQ4NSBcdTAwQTc4NCBCVUcgRklYOiBidXNjYXIgY21EYXRhIGF1dG9yaXRhdGl2byBwb3IgY2FyZENvZGUuIEVsXG4gICAgICAvLyBjbGllbnRNYXN0ZXJDYWNoZS5nZXQoZG9jSWQpIGRlIGFycmliYSB1c2Egc2x1ZyBjbGllbnRMb2NJZCBxdWUgcHVlZGVcbiAgICAgIC8vIGFwdW50YXIgYWwgZG9jIEVRVUlWT0NBRE8gKHZlciBjb21tZW50IGFycmliYSkuIF9maW5kQnlDYXJkIHNjYW4gcG9yXG4gICAgICAvLyBzYXBDYXJkQ29kZSBnYXJhbnRpemEgZW5jb250cmFyIGVsIGRvYyBjb24gbG9zIGNhbXBvcyBGaWNoYS5cbiAgICAgIGNvbnN0IF9jbURhdGFGb3JGaWNoYSA9IF9maW5kQnlDYXJkKGNhcmRDb2RlLCBjbGllbnRNYXN0ZXJDYWNoZSkgfHwgY21EYXRhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBjYXJkQ29kZSxcbiAgICAgICAgICAgICdOb21icmUgdGllbmRhJzogbmFtZSxcbiAgICAgICAgICAgICdBbGlhcyAobW9kYWwpJzogY3VzdG9tTmFtZSxcbiAgICAgICAgICAgIFRpcG86ICdDbGllbnRlIGFjdHVhbCcsXG4gICAgICAgICAgICBFc3RhZG86IGVzdGFkbyxcbiAgICAgICAgICAgIFByb3ZpbmNpYTogdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZSkgOiBwcm92aW5jZSxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgKG1hcGEpJzogbG9jYWxpdHlNYXAsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86IGRlcHQsXG4gICAgICAgICAgICAnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSc6IHZlbmRvcixcbiAgICAgICAgICAgIFpvbmE6IHpvbmUsXG4gICAgICAgICAgICAnRXRpcXVldGEgem9uYSc6IGxvb2t1cFZlbmRvckxhYmVsKHZlbmRvciksXG4gICAgICAgICAgICAnQXNlc29yIGludGVybm8gKFZESSknOiB2ZGksXG4gICAgICAgICAgICBEaXJlY2Npb246IGFkZHJlc3MsXG4gICAgICAgICAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYSc6IGxvY2FsaXR5Q3VzdCxcbiAgICAgICAgICAgICdMYXQgKGdlb2NvZGUpJzogY3VzdG9tTGF0IHx8IGxhdCxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogY3VzdG9tTG5nIHx8IGxvbixcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIHYxNDgyIFx1MDBBNzgyOiBPUkRFTiBpbXBvcnRhLiBMZWdhY3kgdmlzaXRhcyBQUklNRVJPIChmYWxsYmFjayksXG4gICAgICAgICAgLy8gbHVlZ28gRmljaGEgQ2xpZW50ZSBQSVNBIGNvbiBsYWJlbHMgZGUgbGEgZnVlbnRlIGF1dG9yaXRhdGl2YVxuICAgICAgICAgIC8vIChlai4gXCJGaWRlbGlkYWRcIiBGaWNoYSBwaXNhIGxhIG1lcmdlYWRhIGRlIHZpc2l0YXMgcXVlIHB1ZWRlXG4gICAgICAgICAgLy8gZXN0YXIgZGVzYWN0dWFsaXphZGEpLiBCdXllciBzdGF0cyBhbCBmaW5hbCAodmVudGFuYSAxMm0pLlxuICAgICAgICAgIF9jbGFzc2lmUm93KHByb3ZpbmNlLCBsb2NhbGl0eU1hcCwgbmFtZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfY21EYXRhRm9yRmljaGEpLFxuICAgICAgICAgIF9idXllclJvdyhfYnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG4gIC8vIElueWVjdGFyIGFsdGFzIGRlIGNsaWVudF9hcHBsaWNhdGlvbnMgKGFwcHJvdmVkQWx0YXNMaXN0KTpcbiAgLy8gICAqIEhBQklMSVRBRE9TOiB0aWVuZW4gY2FyZENvZGVTYXAgKyBkaXJlY2Npb24uIFZhbiBjb24gRXN0YWRvPSdIYWJpbGl0YWRvJy5cbiAgLy8gICAqIFBST1ZJU09SSU9TICh2MzExKyk6IG1hbnVhbFNhcFBlbmRpbmcgJiYgIWNhcmRDb2RlU2FwIChBbHRhIFJhcGlkYVxuICAvLyAgICAgcGVuZGllbnRlIGRlIGNhcmdhIGEgU0FQKS4gVmFuIGNvbiBFc3RhZG89J1Byb3Zpc29yaW8nLiBTZVxuICAvLyAgICAgaW5jbHV5ZW4gcGFyYSBxdWUgZWwgZXhwb3J0IHJlZmxlamUgZWwgdW5pdmVyc28gY29tZXJjaWFsIGNvbXBsZXRvXG4gIC8vICAgICBxdWUgZWwgZ2VyZW50ZSBlc3RhIGdlc3Rpb25hbmRvLCBubyBzb2xvIGxvcyBjZXJyYWRvcyBlbiBTQVAuXG4gIC8vICAgICBMb3MgcHJvdmlzb3Jpb3MgcHVlZGVuIG5vIHRlbmVyIGRpcmVjY2lvbiB0b2RhdmlhIC0+IHNlIGFjZXB0YW4gaWd1YWwuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIHJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIHNlZW4uYWRkKFxuICAgICAgKHIuUHJvdmluY2lhIHx8ICcnKS50b1N0cmluZygpLnRvVXBwZXJDYXNlKCkgKyAnfCcgKyAoclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgKTtcbiAgfSk7XG4gIGlmICh0eXBlb2YgYXBwcm92ZWRBbHRhc0xpc3QgIT09ICd1bmRlZmluZWQnICYmIGFwcHJvdmVkQWx0YXNMaXN0Lmxlbmd0aCkge1xuICAgIGFwcHJvdmVkQWx0YXNMaXN0LmZvckVhY2goKGEpID0+IHtcbiAgICAgIGlmICghYSkgcmV0dXJuO1xuICAgICAgY29uc3QgaXNQcm92aXNvcmlvID0gISFhLm1hbnVhbFNhcFBlbmRpbmcgJiYgIWEuY2FyZENvZGVTYXA7XG4gICAgICAvLyBIYWJpbGl0YWRvczogc2lndWVuIGV4aWdpZW5kbyBjYXJkQ29kZSArIGRpcmVjY2lvbiAoY29tcG9ydGFtaWVudG8gcHJlLXYzMTEpLlxuICAgICAgLy8gUHJvdmlzb3Jpb3M6IHNpbiBjYXJkQ29kZSBuaSBkaXJlY2Npb24sIHZhbiBpZ3VhbCBjb24gRXN0YWRvPSdQcm92aXNvcmlvJy5cbiAgICAgIGlmICghaXNQcm92aXNvcmlvKSB7XG4gICAgICAgIGlmICghYS5jYXJkQ29kZVNhcCkgcmV0dXJuO1xuICAgICAgICBpZiAoIShhLmNhbGxlIHx8IGEuYWRkcmVzcykpIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByb3YgPSAoYS5wcm92aW5jaWEgfHwgJycpLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBub21icmUgPVxuICAgICAgICBhLmNvbWVyY2lvIHx8XG4gICAgICAgIGEuZmFudGFzaWEgfHxcbiAgICAgICAgKGEuY2FyZENvZGVTYXAgPyAnU0FQICcgKyBhLmNhcmRDb2RlU2FwLnNsaWNlKDAsIDgpIDogYS50aXR1bGFyIHx8ICdQcm92aXNvcmlvJyk7XG4gICAgICBjb25zdCBkdXBLZXkgPSBwcm92LnRvVXBwZXJDYXNlKCkgKyAnfCcgKyBub21icmUudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChzZWVuLmhhcyhkdXBLZXkpKSByZXR1cm47XG4gICAgICBzZWVuLmFkZChkdXBLZXkpO1xuICAgICAgY29uc3QgdmVuZG9yID0gYS5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgICAgIC8vIHYzMzE6IG1pc21vIGZpbHRybyBkZSBzY29wZSBhcGxpY2EgYSBhbHRhcyBTQVAvcHJvdmlzb3JpYXMuXG4gICAgICBpZiAoIWluU2NvcGUodmVuZG9yKSkgcmV0dXJuO1xuICAgICAgY29uc3Qgem9uZSA9IGxvb2t1cFpvbmUodmVuZG9yKTtcbiAgICAgIGNvbnN0IHZkaSA9IFZERV9UT19WRElbdmVuZG9yXSB8fCAnJztcbiAgICAgIGNvbnN0IGxvYyA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyhzaW4gbG9jYWxpZGFkKSc7XG4gICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogcGFyYSBhbHRhcywgYnV5ZXIgc3RhdHMga2V5ZWQgcG9yIGNhcmRDb2RlU2FwIChzaSBleGlzdGUpLlxuICAgICAgY29uc3QgX2FsdGFCdXllclN0YXRzID0gYS5jYXJkQ29kZVNhcCA/IGJ1eWVyU3RhdHNJZHguZ2V0KGEuY2FyZENvZGVTYXApIHx8IG51bGwgOiBudWxsO1xuICAgICAgLy8gdjE0ODUgXHUwMEE3ODQgQlVHIEZJWDogcGFyYSBhbHRhcyBjb24gY2FyZENvZGUsIGVsIGRvYyBhdXRvcml0YXRpdm8gY29uXG4gICAgICAvLyBjYW1wb3MgRmljaGEgdml2ZSBlbiBjbGllbnRfbWFzdGVyIChsbyBlc2NyaWJlIHNhdmVDbGllbnRDYXRlZ29yaWFGcm9tTW9kYWxcbiAgICAgIC8vIHZpYSBGaWNoYSkuIF9maW5kQnlDYXJkIHJldG9ybmEgZXNlIGRvYy4gRmFsbGJhY2sgYWwgcHJvcGlvIGFsdGEgYGFgXG4gICAgICAvLyBzaSBlbCBjbGllbnRlIG5vIGVzdFx1MDBFMSBlbiBjbGllbnRfbWFzdGVyIChlai4gcHJvdmlzb3JpbyBzaW4gY2FyZENvZGUpLlxuICAgICAgY29uc3QgX2FsdGFDbURhdGEgPSBhLmNhcmRDb2RlU2FwID8gX2ZpbmRCeUNhcmQoYS5jYXJkQ29kZVNhcCwgY2xpZW50TWFzdGVyQ2FjaGUpIHx8IGEgOiBhO1xuICAgICAgcm93cy5wdXNoKFxuICAgICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgICdDYXJkQ29kZSBTQVAnOiBhLmNhcmRDb2RlU2FwIHx8ICcnLFxuICAgICAgICAgICAgJ05vbWJyZSB0aWVuZGEnOiBub21icmUsXG4gICAgICAgICAgICAnQWxpYXMgKG1vZGFsKSc6ICcnLFxuICAgICAgICAgICAgVGlwbzogaXNQcm92aXNvcmlvID8gJ1Byb3Zpc29yaW8gKEFsdGEgcmFwaWRhKScgOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICAgICAgRXN0YWRvOiBpc1Byb3Zpc29yaW8gPyAnUHJvdmlzb3JpbycgOiAnSGFiaWxpdGFkbycsXG4gICAgICAgICAgICBQcm92aW5jaWE6IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdikgOiBwcm92LFxuICAgICAgICAgICAgJ0xvY2FsaWRhZCAobWFwYSknOiBsb2MsXG4gICAgICAgICAgICBEZXBhcnRhbWVudG86ICcnLFxuICAgICAgICAgICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknOiB2ZW5kb3IsXG4gICAgICAgICAgICBab25hOiB6b25lLFxuICAgICAgICAgICAgJ0V0aXF1ZXRhIHpvbmEnOiBsb29rdXBWZW5kb3JMYWJlbCh2ZW5kb3IpLFxuICAgICAgICAgICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJzogdmRpLFxuICAgICAgICAgICAgRGlyZWNjaW9uOiBhLmNhbGxlIHx8IGEuYWRkcmVzcyB8fCAnJyxcbiAgICAgICAgICAgICdMb2NhbGlkYWQgZGVjbGFyYWRhJzogbG9jLFxuICAgICAgICAgICAgJ0xhdCAoZ2VvY29kZSknOiBhLmxhdCAhPSBudWxsID8gYS5sYXQgOiAnJyxcbiAgICAgICAgICAgICdMbmcgKGdlb2NvZGUpJzogYS5sbmcgIT0gbnVsbCA/IGEubG5nIDogJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyB2MTQ4MiBcdTAwQTc4MjogbWlzbW8gb3JkZW4gcXVlIFBPSU5UUyBcdTIwMTQgbGVnYWN5IHZpc2l0YXMgcHJpbWVybyxcbiAgICAgICAgICAvLyBGaWNoYSBwaXNhLCBCdXllciBhbCBmaW5hbC5cbiAgICAgICAgICBfY2xhc3NpZlJvdyhwcm92LCBsb2MsIG5vbWJyZSksXG4gICAgICAgICAgX2NsYXNpZlJvdyhfYWx0YUNtRGF0YSksXG4gICAgICAgICAgX2J1eWVyUm93KF9hbHRhQnV5ZXJTdGF0cylcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE9yZGVuYXIgcG9yIHByb3ZpbmNpYSwgbG9jYWxpZGFkLCBub21icmUuXG4gIHJvd3Muc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IHAgPSAoYS5Qcm92aW5jaWEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEgfHwgJycpO1xuICAgIGlmIChwICE9PSAwKSByZXR1cm4gcDtcbiAgICBjb25zdCBsID0gKGFbJ0xvY2FsaWRhZCAobWFwYSknXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydMb2NhbGlkYWQgKG1hcGEpJ10gfHwgJycpO1xuICAgIGlmIChsICE9PSAwKSByZXR1cm4gbDtcbiAgICByZXR1cm4gKGFbJ05vbWJyZSB0aWVuZGEnXSB8fCAnJykubG9jYWxlQ29tcGFyZShiWydOb21icmUgdGllbmRhJ10gfHwgJycpO1xuICB9KTtcblxuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIHBhcmEgZXhwb3J0YXIuXFxuXFxuJyArXG4gICAgICAgICdFbCBtYXN0ZXJmaWxlIGluY2x1eWU6XFxuJyArXG4gICAgICAgICcgICogSGFiaWxpdGFkb3MgZW4gU0FQIChjYXJkQ29kZSArIGRpcmVjY2lvbiBjYXJnYWRvcykuXFxuJyArXG4gICAgICAgICcgICogUHJvdmlzb3Jpb3MgKEFsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBhIFNBUCkuXFxuXFxuJyArXG4gICAgICAgICdTaSBubyB2ZXMgbmluZ3VubywgcmV2aXNhIGVsIG1vZGFsIFNBUCBvIEFsdGEgQ2xpZW50ZXMuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gdjEwOTAgKDIwMjYtMDktMjkpOiByZWZhY3RvciBhIGRvd25sb2FkWGxzeCBoZWxwZXIgKGVzdGlsbyB2ZXJkZSArIGNlbnRlcmVkXG4gIC8vIHVuaWZvcm1lKS4gQW50ZXMgdXNhYmEgWExTWC53cml0ZUZpbGUgZGlyZWN0byBjb24gU2hlZXRKUyBmcmVlIHF1ZSBpZ25vcmFcbiAgLy8gZXN0aWxvcy4gQWhvcmEgaGVyZWRhZG8gZGVsIGhlbHBlciBcdTIwMTQgbWlzbWEgVUkgcXVlIFZlbnRhcy9WaXNpdGFzL2V0Yy5cbiAgLy8gdjEwNDMgKDIwMjYtMDktMjMpOiBwb3N0LXByb2Nlc28gXHUyMDE0IHNhY2FyIGNvbHVtbmFzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIC8vIFJlcG9ydGUgTWFyaWFubzogbWFzdGVyZmlsZSBleHBvcnRhYmEgMzcgY29sdW1uYXMgZG9uZGUgbXVjaGFzIHZlblx1MDBFRGFuXG4gIC8vIHZhY1x1MDBFRGFzIHBvcnF1ZSBubyBoYWJcdTAwRURhIHZpc2l0YXMvY29udGFjdG9zIGNhcmdhZG9zIHBhcmEgZXNvcyBjbGllbnRlcy5cbiAgLy8gRml4OiBpZGVudGlmaWNhciBrZXlzIGRvbmRlIFRPREFTIGxhcyBmaWxhcyB0aWVuZW4gdmFsb3IgXCJ2YWNcdTAwRURvXCIgKGVtcHR5XG4gIC8vIHN0cmluZywgbnVsbCwgdW5kZWZpbmVkKSB5IHJlbW92ZXJsYXMgYW50ZXMgZGVsIHNoZWV0LiBMb3MgY29udGVvc1xuICAvLyAoVG90YWwgdmlzaXRhcy9jb250YWN0b3MpIHNlIGNvbnNpZGVyYW4gdmFjXHUwMEVEb3Mgc2kgdG9kb3Mgc29uIDAuXG4gIC8vIFdpZHRocyBwb3IgY29sdW1uLW5hbWUgKGVuIHZleiBkZSBwb3NpY2lvbmFsKSBwYXJhIHF1ZSBlbCBmaWx0ZXIgbm9cbiAgLy8gZGVzYWxpbmVlIGVsIHNoZWV0IGN1YW5kbyByZW1vdmVtb3MgY29sdW1uYXMuXG4gIGNvbnN0IENPTF9XSURUSFMgPSB7XG4gICAgJ0NhcmRDb2RlIFNBUCc6IDE2LFxuICAgICdOb21icmUgdGllbmRhJzogMzgsXG4gICAgJ0FsaWFzIChtb2RhbCknOiAyOCxcbiAgICBUaXBvOiAxNCxcbiAgICBFc3RhZG86IDE0LFxuICAgIFByb3ZpbmNpYTogMjIsXG4gICAgJ0xvY2FsaWRhZCAobWFwYSknOiAyMixcbiAgICBEZXBhcnRhbWVudG86IDIyLFxuICAgICdWZW5kZWRvciBleHRlcm5vIChWREUpJzogMjgsXG4gICAgWm9uYTogOCxcbiAgICAnRXRpcXVldGEgem9uYSc6IDQ4LFxuICAgICdBc2Vzb3IgaW50ZXJubyAoVkRJKSc6IDI4LFxuICAgIERpcmVjY2lvbjogMzgsXG4gICAgJ0xvY2FsaWRhZCBkZWNsYXJhZGEnOiAyNCxcbiAgICAnTGF0IChnZW9jb2RlKSc6IDE0LFxuICAgICdMbmcgKGdlb2NvZGUpJzogMTQsXG4gICAgLy8gdjE0ODIgXHUwMEE3ODI6IGNvbHVtbmFzIGRlIGxhIEZpY2hhIENsaWVudGUgKHBlc3RhXHUwMEYxYSBDbGFzaWZpY2FjaVx1MDBGM24pICtcbiAgICAvLyBCdXllciAocGVzdGFcdTAwRjFhIEJ1eWVyLCB2ZW50YW5hIDEybSkuIE9yZGVuIGV4YWN0byBxdWUgbGxlZ2EgZGVzZGVcbiAgICAvLyBfY2xhc2lmUm93IChPYmplY3QuYXNzaWduIHByZXNlcnZhIG9yZGVuIGRlIGtleXMpLlxuICAgICdUaXBvIGRlIGNsaWVudGUnOiAzNixcbiAgICBGaWRlbGlkYWQ6IDEwLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0byc6IDIwLFxuICAgIFRhbWFcdTAwRjFvOiAxMCxcbiAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogMjAsXG4gICAgJ1RpcG8gZGUgbG9jYWwnOiAxNCxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6IDE4LFxuICAgICdNb250byB0b3RhbCAoMTJtKSc6IDE2LFxuICAgICdGYWN0dXJhcyAoMTJtKSc6IDEyLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKSc6IDIwLFxuICAgICdGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknOiAyMCxcbiAgICAnRmFjdHVyYXMgcG9yIG1lcyAoMTJtKSc6IDE2LFxuICAgICdQcmltZXJhIGNvbXByYSc6IDE0LFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnOiAxNCxcbiAgICAnRFx1MDBFRGFzIGRlc2RlIFx1MDBGQWx0aW1hIGNvbXByYSc6IDE4LFxuICAgICdVbHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVGlwbyB1bHRpbWEgaW50ZXJhY2Npb24nOiAxNCxcbiAgICAnVG90YWwgdmlzaXRhcyc6IDEwLFxuICAgICdUb3RhbCBjb250YWN0b3MnOiAxMCxcbiAgICAnVGlwbyBjb21lcmNpbyc6IDE4LFxuICAgIExvY2FsOiAxNixcbiAgICAnQ2FuYWwgZGUgY29tcHJhJzogMjAsXG4gICAgUmVsZXZhbmNpYTogMTAsXG4gICAgUE9QOiA4LFxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IDI2LFxuICAgICdUaXBvIGRlIHZlbnRhJzogMTYsXG4gICAgJ1BvbmRlcmFjaW9uIG1vc3RyYWRvciAoJSknOiAxOCxcbiAgICAnUG9uZGVyYWNpb24gZS1jb21tZXJjZSAoJSknOiAxOCxcbiAgICBDb21wZXRlbmNpYTogMjYsXG4gICAgT3BvcnR1bmlkYWQ6IDI2LFxuICAgICdNYXMgdmVuZGlkbyc6IDIyLFxuICAgICdNYXMgcHJlZ3VudGFuJzogMjIsXG4gICAgJ0F5dWRhIHRpZW5kYSc6IDI2LFxuICB9O1xuICAvLyBEZXRlY3RhciBrZXlzIDEwMCUgdmFjXHUwMEVEYXMuXG4gIGNvbnN0IGFsbEtleXMgPSBPYmplY3Qua2V5cyhDT0xfV0lEVEhTKTtcbiAgY29uc3QgTlVNRVJJQ19aRVJPX09LID0gbmV3IFNldChbJ1RvdGFsIHZpc2l0YXMnLCAnVG90YWwgY29udGFjdG9zJ10pO1xuICAvLyB2MTQ4MiBcdTAwQTc4MiArIHYxNDg1IFx1MDBBNzg0IG1lam9yYTogY29sdW1uYXMgRmljaGEgKyBlc3RydWN0dXJhbGVzIChDYXJkQ29kZSxcbiAgLy8gWm9uYSwgVmVuZGVkb3IsIERpcmVjY2lcdTAwRjNuLCBldGMuKSBOVU5DQSBzZSBvbWl0ZW4uIE1hcmlhbm8gcGlkaVx1MDBGMzpcbiAgLy8gXCJubyBvY3VsdGFyIGNvbHVtbmFzIHBvciByb2w7IFBBQ0hJIHJlY2liZSBsYXMgbWlzbWFzIGNvbHVtbmFzIHF1ZVxuICAvLyBhZG1pbiwgc29sbyBzdXMgY2xpZW50ZXNcIi4gRWwgZXhwb3J0IFZERS9QQUNISSByZXNwZXRhIGVzdGUgY29udHJhdG9cbiAgLy8gcG9ycXVlIGxhcyBzdHJ1Y3R1cmFsZXMgZXN0XHUwMEUxbiBwcm90ZWdpZGFzIGF1bnF1ZSBlbCBzY29wZSByZWR1Y2lkbyBub1xuICAvLyB0ZW5nYSBkYXRvcyBwYXJhIGFsZ3VuYSBkZSBlbGxhcy5cbiAgY29uc3QgU1RSVUNUVVJBTF9QUk9URUNURUQgPSBuZXcgU2V0KFtcbiAgICAnQ2FyZENvZGUgU0FQJyxcbiAgICAnTm9tYnJlIHRpZW5kYScsXG4gICAgJ0FsaWFzIChtb2RhbCknLFxuICAgICdUaXBvJyxcbiAgICAnRXN0YWRvJyxcbiAgICAnUHJvdmluY2lhJyxcbiAgICAnTG9jYWxpZGFkIChtYXBhKScsXG4gICAgJ0RlcGFydGFtZW50bycsXG4gICAgJ1ZlbmRlZG9yIGV4dGVybm8gKFZERSknLFxuICAgICdab25hJyxcbiAgICAnRXRpcXVldGEgem9uYScsXG4gICAgJ0FzZXNvciBpbnRlcm5vIChWREkpJyxcbiAgICAnRGlyZWNjaW9uJyxcbiAgICAnTG9jYWxpZGFkIGRlY2xhcmFkYScsXG4gICAgJ0xhdCAoZ2VvY29kZSknLFxuICAgICdMbmcgKGdlb2NvZGUpJyxcbiAgXSk7XG4gIGNvbnN0IEZJQ0hBX1BST1RFQ1RFRCA9IG5ldyBTZXQoW1xuICAgICdUaXBvIGRlIGNsaWVudGUnLFxuICAgICdGaWRlbGlkYWQnLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0bycsXG4gICAgJ1RhbWFcdTAwRjFvJyxcbiAgICAnRXNwZWNpYWxpemFjaVx1MDBGM24nLFxuICAgICdUaXBvIGRlIGxvY2FsJyxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKScsXG4gICAgJ01vbnRvIHRvdGFsICgxMm0pJyxcbiAgICAnRmFjdHVyYXMgKDEybSknLFxuICAgICdQcm9tZWRpbyBwb3IgZmFjdHVyYSAoMTJtKScsXG4gICAgJ0ZyZWN1ZW5jaWEgKGRcdTAwRURhcyBlbnRyZSBjb21wcmFzKScsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknLFxuICAgICdQcmltZXJhIGNvbXByYScsXG4gICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXG4gICAgJ0RcdTAwRURhcyBkZXNkZSBcdTAwRkFsdGltYSBjb21wcmEnLFxuICBdKTtcbiAgY29uc3QgZW1wdHlLZXlzID0gbmV3IFNldChcbiAgICBhbGxLZXlzLmZpbHRlcigoaykgPT4ge1xuICAgICAgaWYgKFNUUlVDVFVSQUxfUFJPVEVDVEVELmhhcyhrKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKEZJQ0hBX1BST1RFQ1RFRC5oYXMoaykpIHJldHVybiBmYWxzZTtcbiAgICAgIHJldHVybiByb3dzLmV2ZXJ5KChyKSA9PiB7XG4gICAgICAgIGNvbnN0IHYgPSByW2tdO1xuICAgICAgICBpZiAodiA9PT0gJycgfHwgdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgICAgICBpZiAoTlVNRVJJQ19aRVJPX09LLmhhcyhrKSAmJiB2ID09PSAwKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gICAgfSlcbiAgKTtcbiAgY29uc3Qga2VwdEtleXMgPSBhbGxLZXlzLmZpbHRlcigoaykgPT4gIWVtcHR5S2V5cy5oYXMoaykpO1xuICAvLyB2MTQ4MiBcdTAwQTc4MjogcmVnbGEgXCJuaW5ndW5hIGNlbGRhIHZhY1x1MDBFRGFcIiBcdTIwMTQgZmlsbERhc2hJbkVtcHR5IHNvYnJlIFRPREFTXG4gIC8vIGxhcyBjb2x1bW5hcyBmaW5hbGVzIChjbGFzaWYgKyBidXllciArIGxlZ2FjeSB2aXNpdGFzKS5cbiAgY29uc3Qgcm93c0ZpbHRlcmVkID0gcm93cy5tYXAoKHIpID0+IHtcbiAgICBjb25zdCBvdXQgPSB7fTtcbiAgICBrZXB0S2V5cy5mb3JFYWNoKChrKSA9PiB7XG4gICAgICBvdXRba10gPSByW2tdO1xuICAgIH0pO1xuICAgIHJldHVybiBfZmlsbERhc2gob3V0KTtcbiAgfSk7XG4gIGNvbnN0IHJlbW92ZWRDb3VudCA9IGVtcHR5S2V5cy5zaXplO1xuICBpZiAocmVtb3ZlZENvdW50ID4gMCkge1xuICAgIGNvbnNvbGUubG9nKGBbbWFzdGVyZmlsZV0gcmVtb3ZpZGFzICR7cmVtb3ZlZENvdW50fSBjb2xzIHZhY1x1MDBFRGFzOmAsIFsuLi5lbXB0eUtleXNdLmpvaW4oJywgJykpO1xuICB9XG4gIC8vIEhvamEgcmVzdW1lbiBwb3Igem9uYVxuICAvLyB2MTQ4MiBcdTAwQTc4MjogYWdyZWdhciBjb250ZW8gcG9yIFRpcG8gZGUgY2xpZW50ZSArIEZpZGVsaWRhZCAoZG9zIG51ZXZhc1xuICAvLyBjb2x1bW5hcyBjb24gZGV0YWxsZSBwb3Igem9uYSkuIEZvcm1hdG8gYnJldmUgXCJBOiBOLCBCOiBNLCAtOiBLXCIgcGFyYVxuICAvLyBjYWJlciBlbiB1bmEgc29sYSBjZWxkYSBsZWdpYmxlLlxuICBjb25zdCBieVpvbmUgPSB7fTtcbiAgcm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgeiA9IHJbJ0V0aXF1ZXRhIHpvbmEnXSB8fCAnU2luIHpvbmEnO1xuICAgIGlmICghYnlab25lW3pdKSB7XG4gICAgICBieVpvbmVbel0gPSB7XG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBoYWJpbGl0YWRvczogMCxcbiAgICAgICAgY2FuY2VsYWRvczogMCxcbiAgICAgICAgdGlwb3M6IHt9LFxuICAgICAgICBmaWRlbGlkYWRlczoge30sXG4gICAgICB9O1xuICAgIH1cbiAgICBieVpvbmVbel0udG90YWwrKztcbiAgICBpZiAoci5Fc3RhZG8gPT09ICdIYWJpbGl0YWRvJykgYnlab25lW3pdLmhhYmlsaXRhZG9zKys7XG4gICAgZWxzZSBpZiAoci5Fc3RhZG8gPT09ICdDYW5jZWxhZG8nKSBieVpvbmVbel0uY2FuY2VsYWRvcysrO1xuICAgIC8vIFRpcG8gZGUgY2xpZW50ZTogdG9tYXIgcHJpbWVyIGNoYXIgZGVsIGxhYmVsIChcIkEgLSAuLi5cIiwgXCJCIC0gLi4uXCIsXG4gICAgLy8gXCJQIChQcmVtaXVtKS4uLlwiLCBcIkMgLSAuLi5cIikuIFNpIGxhYmVsIGVzIFwiLVwiIFx1MjE5MiBcIi1cIi5cbiAgICBjb25zdCB0aXBvTGJsID0gclsnVGlwbyBkZSBjbGllbnRlJ10gfHwgJy0nO1xuICAgIGNvbnN0IHRpcG9LZXkgPSB0aXBvTGJsID09PSAnLScgPyAnLScgOiBTdHJpbmcodGlwb0xibCkudHJpbSgpLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpO1xuICAgIGJ5Wm9uZVt6XS50aXBvc1t0aXBvS2V5XSA9IChieVpvbmVbel0udGlwb3NbdGlwb0tleV0gfHwgMCkgKyAxO1xuICAgIGNvbnN0IGZpZCA9IHIuRmlkZWxpZGFkIHx8ICctJztcbiAgICBieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSA9IChieVpvbmVbel0uZmlkZWxpZGFkZXNbZmlkXSB8fCAwKSArIDE7XG4gIH0pO1xuICBmdW5jdGlvbiBfZm10RGlzdChkaXN0KSB7XG4gICAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGRpc3QpLnNvcnQoKGEsIGIpID0+IGJbMV0gLSBhWzFdKTtcbiAgICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVybiAnLSc7XG4gICAgcmV0dXJuIGVudHJpZXMubWFwKChbaywgdl0pID0+IGAke2t9OiAke3Z9YCkuam9pbignLCAnKTtcbiAgfVxuICBjb25zdCBfcmVzdW1lblJvd3MgPSBPYmplY3QuZW50cmllcyhieVpvbmUpXG4gICAgLm1hcCgoW3osIGRdKSA9PiAoe1xuICAgICAgJ1pvbmEgLyBWZW5kZWRvcic6IHosXG4gICAgICAnVG90YWwgdGllbmRhcyc6IGQudG90YWwsXG4gICAgICBIYWJpbGl0YWRhczogZC5oYWJpbGl0YWRvcyxcbiAgICAgIENhbmNlbGFkYXM6IGQuY2FuY2VsYWRvcyxcbiAgICAgICdQb3IgVGlwbyBkZSBjbGllbnRlJzogX2ZtdERpc3QoZC50aXBvcyksXG4gICAgICAnUG9yIEZpZGVsaWRhZCc6IF9mbXREaXN0KGQuZmlkZWxpZGFkZXMpLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydUb3RhbCB0aWVuZGFzJ10gLSBhWydUb3RhbCB0aWVuZGFzJ10pO1xuXG4gIGNvbnN0IHRzID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgLy8gdjMzMTogc3VmaWpvIGNvbiBlbCBzY29wZSBhcGxpY2FkbyBwYXJhIGRpZmVyZW5jaWFyIGVsIGFyY2hpdm8gZGVsIFZERS9WRElcbiAgLy8gZGVsIGV4cG9ydCBnbG9iYWwgZGVsIGFkbWluLlxuICBjb25zdCBzY29wZUxibCA9XG4gICAgc2NvcGVTZXQgPT09IG51bGxcbiAgICAgID8gJ1RPRE9TJ1xuICAgICAgOiBzY29wZVNldC5zaXplID09PSAxXG4gICAgICAgID8gWy4uLnNjb3BlU2V0XVswXS5zcGxpdCgnICcpWzBdXG4gICAgICAgIDogJ21pcy16b25hcy0nICsgc2NvcGVTZXQuc2l6ZTtcbiAgLy8gdjE1NjUgKDIwMjYtMTEtMTgpOiByZW1hcCBhIGxhcyAxNyBjb2x1bW5hcyBleGFjdGFzIHBvciBwZWRpZG8gTWFyaWFuby5cbiAgLy8gTm9tYnJlcyB5IG9yZGVuIHNvbiBmaWpvcy4gQ29sdW1uYXMgc2luIGZ1ZW50ZSBlc3RhYmxlIHF1ZWRhbiB2YWNpYXNcbiAgLy8gKGVqLiBVTFRJTUFfVklTSVRBL0NPTlRBQ1RPX0ZFQ0hBIHJlcXVpZXJlIGFncmVnYWRvIGFkaWNpb25hbCBkZXNkZVxuICAvLyB2aXNpdHM7IHZlciBkb2NzL0NIQU5HRUxPRy1leHBvcnRzLWNvbHVtbnMtcmVmYWN0b3IubWQgcGFyYSBlbCBsaXN0YWRvKS5cbiAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pn0gKi9cbiAgY29uc3Qgcm93c01hcmlhbm8gPSByb3dzRmlsdGVyZWQubWFwKChyKSA9PiAoe1xuICAgIENBUkRDT0RFX1NBUDogclsnQ2FyZENvZGUgU0FQJ10gfHwgJycsXG4gICAgTk9NQlJFX1RJRU5EQTogclsnTm9tYnJlIHRpZW5kYSddIHx8ICcnLFxuICAgIFRJUE9fQ0xJRU5URTogci5UaXBvIHx8ICcnLCAvLyB2MTU2NTogVGlwbyAoQ2xpZW50ZSBhY3R1YWwgLyBQcm92aXNvcmlvKS5cbiAgICBQUk9WSU5DSUE6IHIuUHJvdmluY2lhIHx8ICcnLFxuICAgIExPQ0FMSURBRDogclsnTG9jYWxpZGFkIChtYXBhKSddIHx8IHJbJ0xvY2FsaWRhZCBkZWNsYXJhZGEnXSB8fCAnJyxcbiAgICBESVJFQ0NJT046IHIuRGlyZWNjaW9uIHx8ICcnLFxuICAgIFRJUE9fREVfQ0xJRU5URTogclsnVGlwbyBkZSBjbGllbnRlJ10gfHwgJycsIC8vIEZpY2hhIENsaWVudGUgKGNsYXNpZikuXG4gICAgVEFNQVx1MDBEMU86IHIuVGFtYVx1MDBGMW8gfHwgci5UYW1hbm8gfHwgJycsXG4gICAgRVNQRUNJQUxJWkFDSU9OOiByLkVzcGVjaWFsaXphY2lcdTAwRjNuIHx8IHIuRXNwZWNpYWxpemFjaW9uIHx8ICcnLFxuICAgIFRJUE9fREVfTE9DQUw6IHJbJ1RpcG8gZGUgbG9jYWwnXSB8fCAnJyxcbiAgICBQUkVGRVJFTkNJQVNfQ09OVEFDVE86IHJbJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJ10gfHwgJycsXG4gICAgQ1JFRElUT19DSEVRVUU6IHJbJ0NyXHUwMEU5ZGl0byBjaGVxdWUgKEFSUyknXSB8fCAnJyxcbiAgICBGQUNUVVJBQ0lPTl9BQ1VNVUxBREFfMTJNRVNFUzogclsnTW9udG8gdG90YWwgKDEybSknXSB8fCAnJyxcbiAgICAnRlJFQ1VFTkNJQV9DT01QUkEoRElBUyknOiByWydGcmVjdWVuY2lhIChkXHUwMEVEYXMgZW50cmUgY29tcHJhcyknXSB8fCAnJyxcbiAgICBVTFRJTUFfQ09NUFJBOiByWydcdTAwREFsdGltYSBjb21wcmEnXSB8fCAnJyxcbiAgICBWRU5ERURPUl9BU0lHTkFETzogclsnVmVuZGVkb3IgZXh0ZXJubyAoVkRFKSddIHx8ICcnLFxuICAgIC8vIHYxNTY2OiBmb3JtYXRvIEREL01NL1lZWVkgZGVzZGUgZWwgbWF4KGZlY2hhKSBhZ3JlZ2FkbyBlbiB1bHRpbWFWaXNpdGFJZHguXG4gICAgJ1VMVElNQV9WSVNJVEEvQ09OVEFDVE9fRkVDSEEnOiAoKCkgPT4ge1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcoclsnQ2FyZENvZGUgU0FQJ10gfHwgJycpXG4gICAgICAgIC50cmltKClcbiAgICAgICAgLnRvVXBwZXJDYXNlKCk7XG4gICAgICBjb25zdCBpc28gPSBjYyA/IHVsdGltYVZpc2l0YUlkeC5nZXQoY2MpIDogbnVsbDtcbiAgICAgIGlmICghaXNvKSByZXR1cm4gJyc7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkID0gbmV3IERhdGUoaXNvKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihkLmdldFRpbWUoKSkpIHJldHVybiAnJztcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICBTdHJpbmcoZC5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICAgICAgICcvJyArXG4gICAgICAgICAgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICAgICAgICcvJyArXG4gICAgICAgICAgZC5nZXRGdWxsWWVhcigpXG4gICAgICAgICk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgfVxuICAgIH0pKCksXG4gIH0pKTtcbiAgY29uc3QgZm5hbWUgPSAnTWFzdGVyIENsaWVudGVzXycgKyBzY29wZUxibCArICdfJyArIHRzICsgJy54bHN4JztcbiAgYXdhaXQgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnTWFzdGVyIENsaWVudGVzJywgcm93czogcm93c01hcmlhbm8gfV0pO1xuICBzaG93U3luY1RhZyhcbiAgICByb3dzLmxlbmd0aCArXG4gICAgICAnIGNsaWVudGVzIGV4cG9ydGFkb3MnICtcbiAgICAgIChzY29wZVNldCA9PT0gbnVsbCA/ICcnIDogJyAoc2NvcGU6ICcgKyBbLi4uc2NvcGVTZXRdLmpvaW4oJywgJykgKyAnKScpXG4gICk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4cG9ydDogUHJlY2lvcyArIFN0b2NrIHBvciBTS1Vcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJhIHVuIEV4Y2VsIGNvbiBUT0RPIGVsIGNhdGFsb2dvIGNydXphbmRvIGxvcyAzIG1hcGFzIHZpZ2VudGVzXG4vLyBlbiBtZW1vcmlhOiBQUk9EVUNUUyAobWFzdGVyIGRlIFNLVXMpLCBQUklDRV9MSVNUX01BUCAocHJlY2lvIEFSUyBkZVxuLy8gRmlyZXN0b3JlKSB5IFNUT0NLX01BUCAoYm9vbGVhbm8gcG9yIFNLVSBkZWwgc3RvY2suanNvbiBkZWwgcmVwbykuXG4vLyBIb2phczpcbi8vICAtIFwiUHJlY2lvcyB5IFN0b2NrXCI6IHVuYSBmaWxhIHBvciBTS1UgY29uIHRvZGFzIGxhcyBjb2x1bW5hcyBqdW50YXNcbi8vICAgIChsbyBtYXMgY29tdW4gcGFyYSByZXZpc2FyIGRpc3BvbmliaWxpZGFkICsgcHJlY2lvKS5cbi8vICAtIFwiUHJlY2lvc1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgcHJlY2lvIChzaW4gc3RvY2spLlxuLy8gIC0gXCJTdG9ja1wiOiBzb2xvIFNLVSArIGRlc2NyaXBjaW9uICsgZXN0YWRvIGRlIHN0b2NrLlxuLy8gIC0gXCJJbmZvXCI6IGZlY2hhIGRlIGxvcyBzbmFwc2hvdHMgeSBmdWVudGVzLlxud2luZG93LmV4cG9ydFByZWNpb3NTdG9jayA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghQXJyYXkuaXNBcnJheShQUk9EVUNUUykgfHwgIVBST0RVQ1RTLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgY2F0YWxvZ28gZGUgcHJvZHVjdG9zIGNhcmdhZG8gdG9kYXZpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBwcmVjaW9zICsgc3RvY2suLi4nKTtcbiAgLy8gdjU3NCAoMjAyNi0wOC0yMSk6IG1vc3RyYXIgVU5JREFERVMgbnVtZXJpY2FzIGV4YWN0YXMgZGVsIGRlcG9zaXRvIDExLlxuICAvLyB2MTM2MyAoMjAyNi0xMC0xOSk6IHBlZGlkbyBNYXJpYW5vIFx1MjAxNCBjYW1iaWFyIGRlIFwic3RvY2sgZlx1MDBFRHNpY28gZGVwIDExXCIgYVxuICAvLyBcImxpYnJlIHBhcmEgbGEgdmVudGFcIiAoPSBkZXAgMTEgXHUyMjEyIHJlc2VydmFzIGNvbmZpcm1lZC9CTy9BU0lHL3dhaXRsaXN0KS5cbiAgLy8gUmF6XHUwMEYzbjogZW52aWFyIGFsIGNsaWVudGUgbG8gcXVlIGVmZWN0aXZhbWVudGUgc2UgbGUgcHVlZGUgcHJvbWV0ZXIgSE9ZLlxuICAvLyBTaSBzb2xvIG1vc3RyYW1vcyBzdG9jayBmXHUwMEVEc2ljbywgcHVlZGUgcGFzYXIgcXVlIGhheWEgNXUgcGVybyBsYXMgNSBlc3RcdTAwRTluXG4gIC8vIHJlc2VydmFkYXMgXHUyMTkyIGVsIGNsaWVudGUgc2UgZW50ZXJhIHJlY2lcdTAwRTluIGFsIGhhY2VyIGVsIHBlZGlkbyBxdWUgbm8gaGF5LlxuICAvLyBVc2EgZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlIChwdXJlIGZ1bmN0aW9uLCBmaWx0cmEgVFRMcykuIFJldG9ybmEgJycgc2lcbiAgLy8gbm8gaGF5IHNuYXBzaG90IGNhcmdhZG87IDAgc2kgbm8gaGF5IGxpYnJlLlxuICBmdW5jdGlvbiBmbXRTdG9jayhza3UpIHtcbiAgICBjb25zdCBmblJlYWwgPVxuICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5nZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tSZWFsbWVudGVEaXNwb25pYmxlXG4gICAgICAgIDogbnVsbDtcbiAgICBpZiAoZm5SZWFsKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB2ID0gZm5SZWFsKHNrdSk7XG4gICAgICAgIGlmICh2ID09IG51bGwpIHJldHVybiAnJztcbiAgICAgICAgcmV0dXJuIE51bWJlcih2KSB8fCAwO1xuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgLy8gZmFsbGJhY2sgYSBzdG9jayBmXHUwMEVEc2ljbyBhYmFqb1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBGYWxsYmFjazogc3RvY2sgZlx1MDBFRHNpY28gZGVwIDExIChzaSBnZXRTdG9ja1JlYWxtZW50ZURpc3BvbmlibGUgbm8gZXN0XHUwMEUxIGRpc3BvbmlibGUsXG4gICAgLy8gZWouIGJvb3RzdHJhcCBtdXkgdGVtcHJhbm8pLlxuICAgIGNvbnN0IGZuRmlzaWNvID1cbiAgICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGFcbiAgICAgICAgOiBudWxsO1xuICAgIGNvbnN0IHZGID0gZm5GaXNpY28gPyBmbkZpc2ljbyhza3UpIDogbnVsbDtcbiAgICBpZiAodkYgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgIHJldHVybiBOdW1iZXIodkYpIHx8IDA7XG4gIH1cbiAgZnVuY3Rpb24gZm10UHJlY2lvKHNrdSkge1xuICAgIGNvbnN0IHAgPSB0eXBlb2YgUFJJQ0VfTElTVF9NQVAgPT09ICdvYmplY3QnICYmIFBSSUNFX0xJU1RfTUFQID8gUFJJQ0VfTElTVF9NQVBbc2t1XSA6IG51bGw7XG4gICAgaWYgKHAgPT0gbnVsbCkgcmV0dXJuICcnO1xuICAgIHJldHVybiBOdW1iZXIocCkgfHwgMDtcbiAgfVxuICAvLyB2MTM2NCAoMjAyNi0xMC0xOSk6IHJld29yayBkZWwgZXhwb3J0IHBvciBwZWRpZG8gTWFyaWFubzpcbiAgLy8gLSBIb2phIHByaW5jaXBhbCByZW5vbWJyYWRhIFwiUHJlY2lvcyB5IFN0b2NrXCIgLT4gXCJMaXN0YSBkZSBwcmVjaW9zXCIuXG4gIC8vIC0gTnVldmEgY29sdW1uYSBcIkRpc3BvbmliaWxpZGFkXCIgKERJU1BPTklCTEUgdmVyZGUgc2kgU3RvY2s+MCwgTk8gRElTUE9OSUJMRVxuICAvLyAgIHJvam8gc2kgU3RvY2s8PTAgbyB2YWNpbykuXG4gIC8vIC0gSG9qYSBcIkluZm9cIiBlbGltaW5hZGEuXG4gIC8vIC0gTm9tYnJlIGFyY2hpdm86IFByZWNpb3NfeV9TdG9ja19ZWVlZLU1NLURELnhsc3ggLT4gTGlzdGFfZGVfUHJlY2lvc19ZWVlZLU1NLURELnhsc3guXG4gIC8vIEhvamFzIFwiUHJlY2lvc1wiIHkgXCJTdG9ja1wiIHNlIG1hbnRpZW5lbiBwb3Igc2kgTWFyaWFubyBsYXMgdXNhLlxuICBmdW5jdGlvbiBkaXNwTGFiZWwoc3RvY2tWYWwpIHtcbiAgICBpZiAoc3RvY2tWYWwgPT09ICcnIHx8IHN0b2NrVmFsID09IG51bGwpIHJldHVybiAnTk8gRElTUE9OSUJMRSc7XG4gICAgcmV0dXJuIE51bWJlcihzdG9ja1ZhbCkgPiAwID8gJ0RJU1BPTklCTEUnIDogJ05PIERJU1BPTklCTEUnO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBQUk9EVUNUUy5tYXAoKHApID0+IHtcbiAgICBjb25zdCBzdCA9IGZtdFN0b2NrKHAuY29kZSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgICAgRGVzY3JpcGNpb246IHAuZGVzYyB8fCAnJyxcbiAgICAgIEZhbWlsaWE6IHAuZmFtIHx8ICcnLFxuICAgICAgU3ViZmFtaWxpYTogcC5zdWIgfHwgJycsXG4gICAgICBDYXRlZ29yaWE6IHAuY2F0IHx8ICcnLFxuICAgICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcbiAgICAgIFN0b2NrOiBzdCxcbiAgICAgIERpc3BvbmliaWxpZGFkOiBkaXNwTGFiZWwoc3QpLFxuICAgIH07XG4gIH0pLnNvcnQoKGEsIGIpID0+IChhLlNLVSB8fCAnJykubG9jYWxlQ29tcGFyZShiLlNLVSB8fCAnJykpO1xuXG4gIGNvbnN0IHByZWNpb3NSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xuICAgIFNLVTogcC5jb2RlIHx8ICcnLFxuICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgJ1ByZWNpbyBBUlMnOiBmbXRQcmVjaW8ocC5jb2RlKSxcbiAgfSkpXG4gICAgLmZpbHRlcigocikgPT4gclsnUHJlY2lvIEFSUyddICE9PSAnJylcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG5cbiAgY29uc3Qgc3RvY2tSb3dzID0gUFJPRFVDVFMubWFwKChwKSA9PiB7XG4gICAgY29uc3Qgc3QgPSBmbXRTdG9jayhwLmNvZGUpO1xuICAgIHJldHVybiB7XG4gICAgICBTS1U6IHAuY29kZSB8fCAnJyxcbiAgICAgIERlc2NyaXBjaW9uOiBwLmRlc2MgfHwgJycsXG4gICAgICBTdG9jazogc3QsXG4gICAgICBEaXNwb25pYmlsaWRhZDogZGlzcExhYmVsKHN0KSxcbiAgICB9O1xuICB9KS5zb3J0KChhLCBiKSA9PiAoYS5TS1UgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5TS1UgfHwgJycpKTtcblxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRvd25sb2FkWGxzeChcbiAgICAnTGlzdGFfZGVfUHJlY2lvc18nICsgdHMgKyAnLnhsc3gnLFxuICAgIFtcbiAgICAgIHsgbmFtZTogJ0xpc3RhIGRlIHByZWNpb3MnLCByb3dzIH0sXG4gICAgICB7IG5hbWU6ICdQcmVjaW9zJywgcm93czogcHJlY2lvc1Jvd3MgfSxcbiAgICAgIHsgbmFtZTogJ1N0b2NrJywgcm93czogc3RvY2tSb3dzIH0sXG4gICAgXSxcbiAgICB7XG4gICAgICAvLyBQYWludGVyIGFwbGljYWRvIHBvc3QtcmVuZGVyIHBvciBkb3dubG9hZFhsc3guIFBpbnRhIGxhIGNvbHVtbmFcbiAgICAgIC8vIFwiRGlzcG9uaWJpbGlkYWRcIiBzZWd1biBzdSB2YWxvcjogdmVyZGUrYmxhbmNvIHNpIERJU1BPTklCTEUsXG4gICAgICAvLyByb2pvK2JsYW5jbyBzaSBOTyBESVNQT05JQkxFLiBDZW50cmFkbyArIGJvbGQgcGFyYSBsZWdpYmlsaWRhZC5cbiAgICAgIGNlbGxTdHlsZXI6IChjZWxsLCBjb2x1bW5OYW1lLCBfdmFsdWUsIF9yb3dJbmRleCkgPT4ge1xuICAgICAgICBpZiAoY29sdW1uTmFtZSAhPT0gJ0Rpc3BvbmliaWxpZGFkJykgcmV0dXJuO1xuICAgICAgICBjb25zdCB0eHQgPSBTdHJpbmcoY2VsbC52YWx1ZSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgaWYgKHR4dCA9PT0gJ0RJU1BPTklCTEUnKSB7XG4gICAgICAgICAgY2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMTZBMzRBJyB9IH07IC8vIGdyZWVuLTYwMFxuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBib2xkOiB0cnVlIH07XG4gICAgICAgIH0gZWxzZSBpZiAodHh0ID09PSAnTk8gRElTUE9OSUJMRScpIHtcbiAgICAgICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkZEQzI2MjYnIH0gfTsgLy8gcmVkLTYwMFxuICAgICAgICAgIGNlbGwuZm9udCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBib2xkOiB0cnVlIH07XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfVxuICApO1xuICBzaG93U3luY1RhZyhyb3dzLmxlbmd0aCArICcgU0tVcyBleHBvcnRhZG9zIChsaXN0YSBkZSBwcmVjaW9zICsgZGlzcG9uaWJpbGlkYWQpJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVYUE9SVCAtIGRpYWxvZ28gZGUgc2VsZWNjaW9uICsgMyBmb3JtYXRvc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG53aW5kb3cuZXhwb3J0VG9FeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZpbHRyYXIgb3BjaW9uZXMgc2VndW4gcm9sLlxuICAvLyAgIHZlbmRlZG9yOiBvcGVyYXRpdm8gZGlhcmlvIChWZW50YXMgLyBWaXNpdGFzIC8gUnV0YXMpICsgQ2xpZW50ZXMgZGUgc3Ugem9uYVxuICAvLyAgICAgKGV4cG9ydE1hc3RlckNsaWVudGVzIHlhIGZpbHRyYSBwb3IgZ2V0RWZmZWN0aXZlVmVuZG9yU2V0IC0+IHNvbG8gc3UgdmVuZG9yKS5cbiAgLy8gICBpbnRlcm5vIChWREkpOiBtaXNtbyBzY29wZSBvcGVyYXRpdm8gKyBDbGllbnRlcyBkZSBzdXMgcGFyZWphcyAobyBzb2xvIGVsXG4gIC8vICAgICBwcm9waW8gc2kgZWxpZ2lvIHN1IG5vbWJyZSBlbiBlbCBkcm9wZG93biBkZSB6b25hcykuXG4gIC8vICAgYWRtaW4gLyBnZXJlbnRlIC8gdmlld2VyOiB2ZW4gdG9kbyBlbCBsaXN0YWRvIChudWxsID0gc2luIGZpbHRybykuXG4gIGNvbnN0IGFsbG93ZWRCeVJvbGUgPSB7XG4gICAgLy8gdjcxMSAoMjAyNi0wOC0yOCk6IFZFTlRBUyB5IFJVVEFTIGVsaW1pbmFkb3MgZGVsIFVJIHBvciBwZWRpZG8gZGUgTWFyaWFuby5cbiAgICB2ZW5kZWRvcjogbmV3IFNldChbJ1ZJU0lUQVMnLCAnTUFTVEVSJywgJ0JBQ0tPUkRFUicsICdTVE9DS19BU0lHJywgJ1BFRElET1NfTUVTJ10pLFxuICAgIGludGVybm86IG5ldyBTZXQoWydWSVNJVEFTJywgJ01BU1RFUicsICdCQUNLT1JERVInLCAnU1RPQ0tfQVNJRycsICdQRURJRE9TX01FUyddKSxcbiAgfTtcbiAgbGV0IGFsbG93ZWQgPSBhbGxvd2VkQnlSb2xlW3VzZXJSb2xlXSB8fCBudWxsOyAvLyBudWxsID0gdmVyIHRvZG9cbiAgLy8gdjE1MzcgKDIwMjYtMTEtMDIpOiBQQUNISSAocGVyZmlsIHJlc3RyaW5naWRvKSB0YW1iaVx1MDBFOW4gdmUgXCJQcmVjaW9zICsgU3RvY2tcIlxuICAvLyAobGlzdGEgZGUgcHJlY2lvcykuIEF1dG9yaXphZG8gcG9yIE1hcmlhbm8uIFNvbG8gUEFDSEksIG5vIHRvZG9zIGxvcyBWREUuXG4gIGlmIChcbiAgICBhbGxvd2VkICYmXG4gICAgdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIGRvY3VtZW50LmJvZHkgJiZcbiAgICBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5jb250YWlucygnaXMtcGFjaGktcmVzdHJpY3RlZCcpXG4gICkge1xuICAgIC8vIHYxNTQzOiArIEJBQ0tPUkRFUiAoeWEgZXN0XHUwMEUxIGVuIHZlbmRlZG9yOyBzZSBleHBsaWNpdGEgcG9yIHNpIFBBQ0hJXG4gICAgLy8gdHV2aWVyYSBvdHJvIHJvbCkuIEVsIGV4cG9ydCBmaWx0cmEgYSBzdXMgY2xpZW50ZXMgdlx1MDBFRGEgZXhwb3J0LXNjb3BlLlxuICAgIGFsbG93ZWQgPSBuZXcgU2V0KFsuLi5hbGxvd2VkLCAnUFJFQ0lPU19TVE9DSycsICdCQUNLT1JERVInXSk7XG4gIH1cbiAgLy8gdjE0MTMgXHUwMEE3NTEgKyB2MTQxNCBcdTAwQTc1MS4xICgyMDI2LTEwLTIyKTogSU5GUkFDQ0lPTkVTX01FTEkgd2hpdGVsaXN0IHBvclxuICAvLyBlbWFpbC4gTWFudGVuZXIgc2luY3Jvbml6YWRvIGNvbiBjYW5SZWFkSW5mcmFjY2lvbmVzTWVsaSgpIGRlXG4gIC8vIGZpcmVzdG9yZS5ydWxlcy4gUmVhZGVyczogTWFyaWFubyAoMiBlbWFpbHMpICsgRGllZ28gVmFsc2kuXG4gIGNvbnN0IElORlJBQ0NJT05FU19NRUxJX1JFQURFUlMgPSBbXG4gICAgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJyxcbiAgICAnbWFyaWFuby5lcmJpbm9Ac2hpbWFuby5jb20uYXInLFxuICAgICdkaWVnby52YWxzaUBzaGltYW5vLnV5JyxcbiAgXTtcbiAgY29uc3QgX2NhblJlYWRJbmZyYWNjaW9uZXNNZWxpID1cbiAgICB0eXBlb2YgY3VycmVudFVzZXIgIT09ICd1bmRlZmluZWQnICYmXG4gICAgY3VycmVudFVzZXIgJiZcbiAgICBJTkZSQUNDSU9ORVNfTUVMSV9SRUFERVJTLmluY2x1ZGVzKChjdXJyZW50VXNlci5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSk7XG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNleHBvcnQtbW9kYWwgLmV4cC1vcHQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgIGNvbnN0IGtpbmQgPSBlbC5kYXRhc2V0LmV4cEtpbmQgfHwgJyc7XG4gICAgbGV0IHNob3cgPSAhYWxsb3dlZCB8fCBhbGxvd2VkLmhhcyhraW5kKTtcbiAgICBpZiAoa2luZCA9PT0gJ0lORlJBQ0NJT05FU19NRUxJJyAmJiAhX2NhblJlYWRJbmZyYWNjaW9uZXNNZWxpKSBzaG93ID0gZmFsc2U7XG4gICAgZWwuc3R5bGUuZGlzcGxheSA9IHNob3cgPyAnJyA6ICdub25lJztcbiAgfSk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlRXhwb3J0RGlhbG9nID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNb250aCBwaWNrZXIgcmV1dGlsaXphYmxlIHBhcmEgbG9zIDUgdGlwb3MgZGUgZXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmxldCBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG5jb25zdCBFWFBPUlRfVFlQRV9MQUJFTFMgPSB7XG4gIFZFTlRBUzogJ1ZlbnRhcycsXG4gIFZJU0lUQVM6ICdWaXNpdGFzJyxcbiAgUkVORElDSU9ORVM6ICdSZW5kaWNpb25lcycsXG4gIFJVVEFTOiAnUnV0YXMnLFxuICBBTFRBUzogJ0FsdGFzIGRlIGNsaWVudGVzJyxcbiAgQkFDS09SREVSOiAnQmFja29yZGVyJyxcbiAgU1RPQ0tfQVNJRzogJ1N0b2NrIEFzaWduYWRvJyxcbiAgUEVESURPU19NRVM6ICdQZWRpZG9zIGRlbCBtZXMnLFxufTtcblxud2luZG93LnNob3dNb250aFBpY2tlciA9IGZ1bmN0aW9uICh0aXBvKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBwZW5kaW5nRXhwb3J0VHlwZSA9IHRpcG87XG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLXRpdGxlJyk7XG4gIGNvbnN0IHN1YnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZW0tc3VidCcpO1xuICB0aXRsZS50ZXh0Q29udGVudCA9ICdFeHBvcnRhciAnICsgKEVYUE9SVF9UWVBFX0xBQkVMU1t0aXBvXSB8fCB0aXBvKTtcbiAgc3VidC50ZXh0Q29udGVudCA9ICdFbGVnaSBlbCBtZXMgeSBhXHUwMEYxbyBxdWUgcXVlcmVzIGRlc2Nhcmdhci4nO1xuICAvLyBQb3B1bGF0ZSBzZWxlY3RzXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1lc1NlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKTtcbiAgbWVzU2VsLmlubmVySFRNTCA9XG4gICAgJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2RvcyBsb3MgbWVzZXMgKGFcdTAwRjFvIGVudGVybyk8L29wdGlvbj4nICtcbiAgICBNRVNFUy5tYXAoKG0sIGkpID0+ICc8b3B0aW9uIHZhbHVlPVwiJyArIGkgKyAnXCI+JyArIG0gKyAnPC9vcHRpb24+Jykuam9pbignJyk7XG4gIG1lc1NlbC52YWx1ZSA9IG5vdy5nZXRNb250aCgpO1xuICBjb25zdCBhbmlvU2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2VtLWFuaW8nKTtcbiAgY29uc3QgeWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xuICBsZXQgeW9wdHMgPSAnJztcbiAgZm9yIChsZXQgeSA9IHllYXIgLSAzOyB5IDw9IHllYXIgKyAxOyB5KyspXG4gICAgeW9wdHMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgeSArICdcIj4nICsgeSArICc8L29wdGlvbj4nO1xuICBhbmlvU2VsLmlubmVySFRNTCA9IHlvcHRzO1xuICBhbmlvU2VsLnZhbHVlID0geWVhcjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1tb250aC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG59O1xuXG53aW5kb3cuY29uZmlybU1vbnRoUGlja2VyID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB0aXBvID0gcGVuZGluZ0V4cG9ydFR5cGU7XG4gIGNvbnN0IG1lc1JhdyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1tZXMnKS52YWx1ZTtcbiAgY29uc3QgYW5pbyA9IHBhcnNlSW50KGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdlbS1hbmlvJykudmFsdWUsIDEwKTtcbiAgY29uc3QgbW9udGhJZHggPSBtZXNSYXcgPT09ICdBTEwnID8gbnVsbCA6IHBhcnNlSW50KG1lc1JhdywgMTApO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LW1vbnRoLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBwZW5kaW5nRXhwb3J0VHlwZSA9IG51bGw7XG4gIGlmICghdGlwbykgcmV0dXJuO1xuICB0cnkge1xuICAgIC8vIHYxNTY1ICgyMDI2LTExLTE4KTogb3BjaW9uZXMgZWxpbWluYWRhcyBkZWwgbW9kYWwgKEFMVEFTLCBWRU5UQVNfQVJUX0NMSSxcbiAgICAvLyBTVE9DS19BU0lHLCBQRU5ESUVOVEVfQVNJR19QQUJMTywgSU5GUkFDQ0lPTkVTX01FTEkpLiBEaXNwYXRjaGVyIHJlZHVjaWRvLlxuICAgIGlmICh0aXBvID09PSAnVkVOVEFTJykgZXhwb3J0VmVudGFzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdWSVNJVEFTJykgZXhwb3J0VmlzaXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUkVORElDSU9ORVMnKSBleHBvcnRSZW5kaWNpb25lc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnUlVUQVMnKSBleHBvcnRSdXRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KTtcbiAgICBlbHNlIGlmICh0aXBvID09PSAnQkFDS09SREVSJykgZXhwb3J0QmFja29yZGVyRm9yTW9udGgoYW5pbywgbW9udGhJZHgpO1xuICAgIGVsc2UgaWYgKHRpcG8gPT09ICdQRURJRE9TX01FUycpIGV4cG9ydFBlZGlkb3NNZXNGb3JNb250aChhbmlvLCBtb250aElkeCk7XG4gICAgZWxzZSBhbGVydCgnVGlwbyBkZXNjb25vY2lkbzogJyArIHRpcG8pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0ICcgKyB0aXBvLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGV4cG9ydDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkge1xuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkgcmV0dXJuIFN0cmluZyhhbmlvKTtcbiAgcmV0dXJuIE1FU0VTW21vbnRoSWR4XSArICdfJyArIGFuaW87XG59XG5cbi8vIHYxMDkwICgyMDI2LTA5LTI5KTogcmVlc2NyaXRvIGNvbiBFeGNlbEpTIHBhcmEgZGFyIFVJIHVuaWZvcm1lIGEgVE9ET1MgbG9zXG4vLyBleHBvcnRzIChoZWFkZXIgdmVyZGUgKyBjZWxkYXMgY2VudGVyZWQgKyBib3JkZXIgc3V0aWwgKyBhdXRvLWZpdCB3aWR0aCkuXG4vLyBBbnRlcyB1c2FiYSBYTFNYIFNoZWV0SlMgZnJlZSBxdWUgaWdub3JhIHNpbGVudGx5IGxvcyBlc3RpbG9zIGRlIGNlbGRhLiBFbFxuLy8gcGF0dGVybiB2ZXJkZSByZXBsaWNhIGVsIFRPVEFMIGJhciBkZSBleHBvcnRCYWNrb3JkZXJzVG9FeGNlbCAobW9kYWxcbi8vIEJhY2tvcmRlciB2NzIwKykuIEV4Y2VsSlMgeWEgc2UgY2FyZ2Egb24tZGVtYW5kIHZpYSB3aW5kb3cubG9hZEV4Y2VsSlMuXG5hc3luYyBmdW5jdGlvbiBkb3dubG9hZFhsc3goZmlsZW5hbWUsIHNoZWV0cywgb3B0cykge1xuICB0cnkge1xuICAgIGF3YWl0IHdpbmRvdy5sb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIEV4Y2VsSlM6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICBjb25zdCBIRUFERVJfRklMTCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjE2NjUzNCcgfSB9O1xuICBjb25zdCBIRUFERVJfRk9OVCA9IHsgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBib2xkOiB0cnVlLCBzaXplOiAxMiB9O1xuICBjb25zdCBDRU5URVIgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicsIHdyYXBUZXh0OiB0cnVlIH07XG4gIGNvbnN0IEJPUkRFUl9USElOID0geyBzdHlsZTogJ3RoaW4nLCBjb2xvcjogeyBhcmdiOiAnRkZDQ0NDQ0MnIH0gfTtcbiAgY29uc3QgQk9SREVSID0geyB0b3A6IEJPUkRFUl9USElOLCBsZWZ0OiBCT1JERVJfVEhJTiwgYm90dG9tOiBCT1JERVJfVEhJTiwgcmlnaHQ6IEJPUkRFUl9USElOIH07XG4gIC8vIHYxMzY0OiBjZWxsU3R5bGVyIG9wY2lvbmFsIHBhcmEgY29sb3JlYXIgY2VsZGFzIHBvciB2YWxvciAoZWouIGNvbHVtbmFcbiAgLy8gRGlzcG9uaWJpbGlkYWQgRElTUE9OSUJMRSB2ZXJkZSAvIE5PIERJU1BPTklCTEUgcm9qbyBlbiBlbCBleHBvcnRcbiAgLy8gTGlzdGEgZGUgcHJlY2lvcykuIFNpZ25hdHVyZTogKGNlbGwsIGNvbHVtbk5hbWUsIHZhbHVlLCByb3dJbmRleCkgPT4gdm9pZC5cbiAgY29uc3QgY2VsbFN0eWxlciA9IG9wdHMgJiYgdHlwZW9mIG9wdHMuY2VsbFN0eWxlciA9PT0gJ2Z1bmN0aW9uJyA/IG9wdHMuY2VsbFN0eWxlciA6IG51bGw7XG5cbiAgZm9yIChjb25zdCBzIG9mIHNoZWV0cykge1xuICAgIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KHMubmFtZS5zbGljZSgwLCAzMSkpO1xuICAgIGNvbnN0IHJvd3MgPSBzLnJvd3MubGVuZ3RoID8gcy5yb3dzIDogW3sgQXZpc286ICdTaW4gZGF0b3MgcGFyYSBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkbycgfV07XG4gICAgY29uc3QgaGVhZGVycyA9IE9iamVjdC5rZXlzKHJvd3NbMF0pO1xuXG4gICAgY29uc3QgaGVhZGVyUm93ID0gd3MuYWRkUm93KGhlYWRlcnMpO1xuICAgIGhlYWRlclJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xuICAgICAgY2VsbC5maWxsID0gSEVBREVSX0ZJTEw7XG4gICAgICBjZWxsLmZvbnQgPSBIRUFERVJfRk9OVDtcbiAgICAgIGNlbGwuYWxpZ25tZW50ID0gQ0VOVEVSO1xuICAgICAgY2VsbC5ib3JkZXIgPSBCT1JERVI7XG4gICAgfSk7XG4gICAgaGVhZGVyUm93LmhlaWdodCA9IDI2O1xuXG4gICAgZm9yIChsZXQgcklkeCA9IDA7IHJJZHggPCByb3dzLmxlbmd0aDsgcklkeCsrKSB7XG4gICAgICBjb25zdCByb3cgPSByb3dzW3JJZHhdO1xuICAgICAgY29uc3QgdmFsdWVzID0gaGVhZGVycy5tYXAoKGgpID0+IChyb3dbaF0gIT09IHVuZGVmaW5lZCAmJiByb3dbaF0gIT09IG51bGwgPyByb3dbaF0gOiAnJykpO1xuICAgICAgY29uc3QgZGF0YVJvdyA9IHdzLmFkZFJvdyh2YWx1ZXMpO1xuICAgICAgZGF0YVJvdy5lYWNoQ2VsbCgoY2VsbCwgY29sTnVtYmVyKSA9PiB7XG4gICAgICAgIGNlbGwuYWxpZ25tZW50ID0gQ0VOVEVSO1xuICAgICAgICBjZWxsLmJvcmRlciA9IEJPUkRFUjtcbiAgICAgICAgaWYgKGNlbGxTdHlsZXIpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY2VsbFN0eWxlcihjZWxsLCBoZWFkZXJzW2NvbE51bWJlciAtIDFdLCB2YWx1ZXNbY29sTnVtYmVyIC0gMV0sIHJJZHgpO1xuICAgICAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgICAgICAvLyBuby1vcDogbm8gcm9tcGVyIGVsIGV4cG9ydCBwb3IgdW4gZXJyb3IgZGUgc3R5bGVyXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBoZWFkZXJzLmZvckVhY2goKGgsIGkpID0+IHtcbiAgICAgIGxldCBtYXhMZW4gPSBTdHJpbmcoaCkubGVuZ3RoO1xuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCB2ID0gU3RyaW5nKHJvd1toXSA9PT0gdW5kZWZpbmVkIHx8IHJvd1toXSA9PT0gbnVsbCA/ICcnIDogcm93W2hdKS5zcGxpdCgnXFxuJylbMF07XG4gICAgICAgIGlmICh2Lmxlbmd0aCA+IG1heExlbikgbWF4TGVuID0gdi5sZW5ndGg7XG4gICAgICB9XG4gICAgICB3cy5nZXRDb2x1bW4oaSArIDEpLndpZHRoID0gTWF0aC5taW4oNjAsIE1hdGgubWF4KDEwLCBtYXhMZW4gKyA0KSk7XG4gICAgfSk7XG5cbiAgICB3cy52aWV3cyA9IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dO1xuICB9XG5cbiAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1Zl0sIHtcbiAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICB9KTtcbiAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgYS5ocmVmID0gdXJsO1xuICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gIGEuY2xpY2soKTtcbiAgYS5yZW1vdmUoKTtcbiAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZFTlRBUzogcGVkaWRvcyBjb25maXJtYWRvcyBkZWwgcGVyaW9kb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5hc3luYyBmdW5jdGlvbiBleHBvcnRWZW50YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWZW50YXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gcGVkaWRvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHAgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAocGFyc2VJbnQocC55ZWFyLCAxMCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgcGFyc2VJbnQocC5tb250aElkeCwgMTApICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIGNvbnN0IGxpbmVzID0gcC5saW5lcyB8fCBbXTtcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgcmV0dXJuO1xuICAgIGNvbnN0IHZlbmRvcktleSA9IHAudmVuZG9yIHx8IGxvb2t1cFZlbmRvckZvckNsaWVudChwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSkgfHwgJyc7XG4gICAgY29uc3QgdmVuZG9ySW5mbyA9IHZlbmRvckxvb2t1cFt2ZW5kb3JLZXldIHx8IHt9O1xuICAgIGNvbnN0IGZhY3RvciA9IHR5cGVvZiBwZWRpZG9EaXNjb3VudEZhY3RvciA9PT0gJ2Z1bmN0aW9uJyA/IHBlZGlkb0Rpc2NvdW50RmFjdG9yKHApIDogMTtcbiAgICBjb25zdCBkaXNjUGN0ID0gKHAuZGlzY291bnRTbmFwc2hvdCAmJiBwLmRpc2NvdW50U25hcHNob3QucGN0VG90YWwpIHx8IDA7XG4gICAgbGluZXMuZm9yRWFjaCgobCkgPT4ge1xuICAgICAgY29uc3QgcXR5ID0gcGFyc2VGbG9hdChsLnF0eSkgfHwgMDtcbiAgICAgIGNvbnN0IHByZWNpbyA9IHBhcnNlRmxvYXQobC5wcmVjaW8pIHx8IDA7XG4gICAgICBjb25zdCBncm9zcyA9IHF0eSAqIHByZWNpbztcbiAgICAgIGNvbnN0IG5ldCA9IGdyb3NzICogZmFjdG9yO1xuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgTWVzOiBwLm1vbnRoIHx8ICcnLFxuICAgICAgICBGZWNoYV9Db25maXJtYWRvOiBwLmNvbmZpcm1lZEF0ID8gU3RyaW5nKHAuY29uZmlybWVkQXQpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgICBFc3RhZG86IHAuc3RhZ2UgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yS2V5IHx8ICcnKSxcbiAgICAgICAgWm9uYTogdmVuZG9ySW5mby56b25lIHx8ICcnLFxuICAgICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlIHx8ICcnKSxcbiAgICAgICAgTG9jYWxpZGFkOiBwLmxvY05hbWUgfHwgJycsXG4gICAgICAgIENsaWVudGU6IHAuY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQ29kaWdvX1NLVTogbC5jb2RlIHx8ICcnLFxuICAgICAgICBQcm9kdWN0bzogbC5kZXNjIHx8ICcnLFxuICAgICAgICBDYXRlZ29yaWE6IGwuY2F0IHx8ICcnLFxuICAgICAgICBGYW1pbGlhOiBsLmZhbSB8fCAnJyxcbiAgICAgICAgU3ViZmFtaWxpYTogbC5zdWIgfHwgJycsXG4gICAgICAgIENhbnRpZGFkOiBxdHksXG4gICAgICAgIFByZWNpb19Vbml0X0FSUzogcHJlY2lvLFxuICAgICAgICAvLyBTdWJ0b3RhbF9BUlMgPSBORVRPIChjb24gZGVzY3VlbnRvIGFwbGljYWRvKSAtIGVzIGxvIHF1ZSBjdWVudGFcbiAgICAgICAgLy8gcGFyYSBlbCB0YXJnZXQgZGVsIHZlbmRlZG9yLiBTdWJ0b3RhbF9CcnV0b19BUlMgbXVlc3RyYSBlbCB2YWxvclxuICAgICAgICAvLyBkZSBsaXN0YSBzaW4gZGVzY3VlbnRvIHBhcmEgdHJhemFiaWxpZGFkLlxuICAgICAgICBTdWJ0b3RhbF9BUlM6IE1hdGgucm91bmQobmV0KSxcbiAgICAgICAgU3VidG90YWxfQnJ1dG9fQVJTOiBNYXRoLnJvdW5kKGdyb3NzKSxcbiAgICAgICAgRGVzY3VlbnRvX1BjdDogZGlzY1BjdCxcbiAgICAgICAgRW5fTm9tYnJlX0RlX1ZERTogcC5vbkJlaGFsZk9mID8gJ1NJJyA6ICdOTycsXG4gICAgICAgIENhcmdhZG9fUG9yOiBwLmNyZWF0ZWRCeURpc3BsYXlOYW1lIHx8IHAuY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fVmVudGFzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICBkb3dubG9hZFhsc3goZm5hbWUsIFt7IG5hbWU6ICdWZW50YXMnLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBWZW50YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufVxuXG5mdW5jdGlvbiBsb29rdXBWZW5kb3JGb3JDbGllbnQocHJvdiwgbG9jTmFtZSwgX2NsaWVudE5hbWUpIHtcbiAgaWYgKCFwcm92IHx8ICFsb2NOYW1lKSByZXR1cm4gJyc7XG4gIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3YgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcbiAgcmV0dXJuIHB0ID8gcHQudmVuZG9yIHx8ICcnIDogJyc7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVklTSVRBUzogZGV0YWxsZSBkZSB2aXNpdGFzIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFZpc2l0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBWaXNpdGFzICsgQ29udGFjdG9zLi4uJyk7XG4gIC8vIHYxNTM0OiBlbCB2ZW5kZWRvciBjb25zdWx0YSBzb2xvIHN1cyB2aXNpdGFzIChsYXMgcmVnbGFzIG5vIGxlIGRlamFuXG4gIC8vIGxpc3RhciB0b2Rhcyk7IGVsIGludGVybm8gdmUgbGFzIHN1eWFzICsgbGFzIGRlIHN1cyBwYXJlamFzLlxuICBjb25zdCBzY29wZSA9IF9leHBvcnRTY29wZSgpO1xuICBsZXQgc25hcDtcbiAgdHJ5IHtcbiAgICBsZXQgcSA9IGZiRGIuY29sbGVjdGlvbigndmlzaXRzJyk7XG4gICAgaWYgKHNjb3BlLnZpc2l0c1F1ZXJ5QnlPd25lclVpZCkge1xuICAgICAgY29uc3QgdSA9IHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuYXV0aCAmJiB3aW5kb3cuZmlyZWJhc2UuYXV0aCgpLmN1cnJlbnRVc2VyO1xuICAgICAgcSA9IHEud2hlcmUoJ293bmVyVWlkJywgJz09JywgKHUgJiYgdS51aWQpIHx8ICdfX3Npbl91c3VhcmlvX18nKTtcbiAgICB9XG4gICAgc25hcCA9IGF3YWl0IHEuZ2V0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyB2aXNpdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldE1lcyA9IG1vbnRoSWR4ICE9PSBudWxsID8gTUVTRVNbbW9udGhJZHhdLnRvVXBwZXJDYXNlKCkgOiBudWxsO1xuICBjb25zdCBhbGwgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgdiA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGlmIChwYXJzZUludCh2LmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgIGlmICh0YXJnZXRNZXMgJiYgKHYubWVzIHx8ICcnKS50b1VwcGVyQ2FzZSgpICE9PSB0YXJnZXRNZXMpIHJldHVybjtcbiAgICBhbGwucHVzaCh2KTtcbiAgfSk7XG4gIGNvbnN0IGl0ZW1zID0gc2NvcGUuZmlsdGVyVmlzaXRzKGFsbCk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIG5pIGNvbnRhY3RvcyBlbiBlbCBwZXJpb2RvIHNlbGVjY2lvbmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgblZpc2l0YXMgPSBpdGVtcy5maWx0ZXIoKHYpID0+IHYuaW50ZXJhY3Rpb25UeXBlICE9PSAnY29udGFjdG8nKS5sZW5ndGg7XG4gIGNvbnN0IG5Db250YWN0b3MgPSBpdGVtcy5sZW5ndGggLSBuVmlzaXRhcztcbiAgLy8gRXhjZWxKUyBjb24gZm90byBkZWwgZnJlbnRlIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gTGF6eSBsb2FkLlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChlLm1lc3NhZ2UgfHwgZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWw6ICcgKyBuVmlzaXRhcyArICcgdmlzaXRhcyArICcgKyBuQ29udGFjdG9zICsgJyBjb250YWN0b3MuLi4nLCAzMDAwKTtcblxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xuICAvLyB2MTU2NSAoMjAyNi0xMS0xOCk6IDE2IGNvbHVtbmFzIGV4YWN0YXMgcG9yIHBlZGlkbyBNYXJpYW5vLiBIb2phIFwiVklTSVRBU1wiLlxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnVklTSVRBUycsIHsgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxIH1dIH0pO1xuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRkVDSEFfREVfVklTSVRBUycsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdWRU5ERURPUicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdJTlRFUkFDQ0lPTicsIGtleTogJ2ludGVyYWNjaW9uJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUSVBPJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTE9DQUwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVEFNQVx1MDBEMU8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZJREVMSURBRCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUkVMRVZBTkNJQScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnTUFTX1ZFTkRJRE8nLCBrZXk6ICdtYXNWZScsIHdpZHRoOiAyNCB9LFxuICAgIHsgaGVhZGVyOiAnTUFTX1BSRUdVTlRBTicsIGtleTogJ21hc1ByJywgd2lkdGg6IDI0IH0sXG4gICAgeyBoZWFkZXI6ICdBWVVEQV9USUVOREEnLCBrZXk6ICdheXVkYScsIHdpZHRoOiAyMiB9LFxuICAgIHsgaGVhZGVyOiAnVElQT19ERV9WRU5UQScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxNCB9LFxuICAgIHsgaGVhZGVyOiAnUE9OREVSQUNJT05fTU9TVFJBRE9SJywga2V5OiAncE1vc3QnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1BPTkRFUkFDSU9OX0VDT01NRVJDRScsIGtleTogJ3BFY29tJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdGT1RPX0ZSRU5URScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcbiAgXTtcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxO1xuICBjb25zdCBST1dfSCA9IDEwMDtcbiAgY29uc3QgSU1HX1cgPSAxMzA7XG4gIGNvbnN0IElNR19IID0gOTA7XG5cbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCB2IG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgaXNDb250YWN0byA9IHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nO1xuICAgIGNvbnN0IGludGVyYWNjaW9uTGJsID0gaXNDb250YWN0byA/ICdDb250YWN0bycgOiAnVmlzaXRhJztcbiAgICBjb25zdCBmb3JtYUNvbnRhY3RvTGJsID0gaXNDb250YWN0byA/IHYuZm9ybWFDb250YWN0byB8fCAnU2luIGVzcGVjaWZpY2FyJyA6ICdQcmVzZW5jaWFsJztcbiAgICBsZXQgcmVzdWx0YWRvQ3RMYmwgPSAnJztcbiAgICBpZiAoaXNDb250YWN0bykge1xuICAgICAgaWYgKHYuY29udGFjdG9SZXN1bHRhZG8gPT09ICdyZXNwb25kaW8nKSByZXN1bHRhZG9DdExibCA9ICdSZXNwb25kaW8nO1xuICAgICAgZWxzZSBpZiAodi5jb250YWN0b1Jlc3VsdGFkbyA9PT0gJ25vX3Jlc3BvbmRpbycpIHJlc3VsdGFkb0N0TGJsID0gJ05vIHJlc3BvbmRpbyc7XG4gICAgICBlbHNlIHJlc3VsdGFkb0N0TGJsID0gJ1NpbiBtYXJjYXInO1xuICAgIH1cbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IHYuZmVjaGEgfHwgJycsXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAgIGludGVyYWNjaW9uOiBpbnRlcmFjY2lvbkxibCxcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgICBtYXNQcjogdi5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgICBheXVkYTogdi5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgcE1vc3Q6IHYucG9uZGVyYWNpb25Nb3N0cmFkbyB8fCAnJyxcbiAgICAgIHBFY29tOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIHx8ICcnLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gaW1hZ2VuIGVuY2ltYVxuICAgIH0pO1xuICAgIC8vIHYxNTY1OiBmb3JtYUNvbnRhY3RvL3Jlc3VsdGFkb0N0IHNpZ3VlbiBjb21wdXRhZG9zIHBhcmEgdXNvIGZ1dHVybyAobm8gZXhwb3J0YWRhcykuXG4gICAgdm9pZCBmb3JtYUNvbnRhY3RvTGJsO1xuICAgIHZvaWQgcmVzdWx0YWRvQ3RMYmw7XG4gICAgcm93LmhlaWdodCA9IFJPV19IO1xuICAgIHJvdy5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByb3cubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIHZpc2l0YScsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSAnVklTSVRBU18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IGxpc3RvOiAnICsgblZpc2l0YXMgKyAnIHZpc2l0YXMgKyAnICsgbkNvbnRhY3RvcyArICcgY29udGFjdG9zJywgMjQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdGFzRm9yTW9udGgnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSRU5ESUNJT05FUzogZ2FzdG9zIHkgYW50aWNpcG9zIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIGV4cG9ydFJlbmRpY2lvbmVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUmVuZGljaW9uZXMuLi4nKTtcbiAgbGV0IHNuYXA7XG4gIHRyeSB7XG4gICAgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncmVuZGljaW9uZXMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIHJlbmRpY2lvbmVzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEZpbHRyYXIgcG9yIG1lcy9hbmlvXG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IHIgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICBsZXQgZHQgPSByLmZlY2hhIHx8IHIuZmVjaGFHYXN0byB8fCAnJztcbiAgICBpZiAoIWR0ICYmIHIuY3JlYXRlZEF0ICYmIHIuY3JlYXRlZEF0LnRvRGF0ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZHQgPSByLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBpZiAoIWR0KSByZXR1cm47XG4gICAgY29uc3QgZE9iaiA9IG5ldyBEYXRlKGR0KTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRPYmouZ2V0VGltZSgpKSkgcmV0dXJuO1xuICAgIGlmIChkT2JqLmdldEZ1bGxZZWFyKCkgIT09IGFuaW8pIHJldHVybjtcbiAgICBpZiAobW9udGhJZHggIT09IG51bGwgJiYgZE9iai5nZXRNb250aCgpICE9PSBtb250aElkeCkgcmV0dXJuO1xuICAgIGl0ZW1zLnB1c2goeyBpZDogZC5pZCwgZmVjaGE6IGR0LCByOiByIH0pO1xuICB9KTtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHJlbmRpY2lvbmVzIGVuIGVsIHBlcmlvZG8gc2VsZWNjaW9uYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBFeGNlbEpTIGNvbiBmb3RvIGVtYmViaWRhIGVuIGNhZGEgZmlsYS4gQ2FyZ2EgbGF6eS5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgaXRlbXMubGVuZ3RoICsgJyByZW5kaWNpb25lcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIC8vIHYxNTY1ICgyMDI2LTExLTE4KTogMTAgY29sdW1uYXMgZXhhY3RhcyBwb3IgcGVkaWRvIE1hcmlhbm8uIEhvamEgXCJSZW5kaWNpb25lc1wiLlxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnUmVuZGljaW9uZXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcbiAgd3MuY29sdW1ucyA9IFtcbiAgICB7IGhlYWRlcjogJ0ZFQ0hBX0RFX1JFTkRJQ0lPTicsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDE0IH0sXG4gICAgeyBoZWFkZXI6ICdUSVBPJywga2V5OiAndGlwbycsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnVkVOREVET1InLCBrZXk6ICd2ZW5kZWRvcicsIHdpZHRoOiAyNiB9LFxuICAgIHsgaGVhZGVyOiAnQ09OQ0VQVE8nLCBrZXk6ICdjb25jZXB0bycsIHdpZHRoOiAyMCB9LFxuICAgIHsgaGVhZGVyOiAnTlx1MDBCMCBUSUNLRVQnLCBrZXk6ICdudW1UaWNrZXQnLCB3aWR0aDogMTQgfSxcbiAgICB7IGhlYWRlcjogJ1RJUE9fREVfR0FTVE8nLCBrZXk6ICd0aXBvR2FzdG8nLCB3aWR0aDogMjAgfSxcbiAgICB7IGhlYWRlcjogJ0lNUE9SVEUnLCBrZXk6ICdpbXBvcnRlJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdPQlNFUlZBQ0lPTkVTJywga2V5OiAnb2JzJywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdGT1RPX1RJQ0tFVCcsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ0VTVEFETycsIGtleTogJ2VzdGFkbycsIHdpZHRoOiAxOCB9LFxuICBdO1xuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGN0UyMkNFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXG4gIGNvbnN0IFJPV19IID0gMTEwO1xuICBjb25zdCBJTUdfVyA9IDE0MDtcbiAgY29uc3QgSU1HX0ggPSAxMDA7XG5cbiAgLy8gT3JkZW4gY3Jvbm9sb2dpY28gZGVzY1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykge1xuICAgIGNvbnN0IHIgPSBpdC5yO1xuICAgIGNvbnN0IGlzR2FzdG8gPSByLnRpcG8gPT09ICdnYXN0byc7XG4gICAgY29uc3QgY29uY2VwdFN0ciA9IGlzR2FzdG8gPyByLmRlc2NyaXBjaW9uIHx8ICcnIDogci50aXBvT3BlcmFjaW9uIHx8IHIubW90aXZvIHx8ICcnO1xuICAgIGNvbnN0IG9ic1N0ciA9XG4gICAgICAoci5vYnNlcnZhY2lvbmVzIHx8IHIubm90YXMgfHwgJycpICtcbiAgICAgIChpc0dhc3RvID8gJycgOiByLnNvbGljaXRhZG9Qb3IgPyAnIHwgU29saWNpdGFkbyBwb3I6ICcgKyByLnNvbGljaXRhZG9Qb3IgOiAnJyk7XG4gICAgLy8gdjE1NjU6IDEwIGNvbHVtbmFzIGV4YWN0YXMuIENhbXBvcyBsZWdhY3kgKGVtYWlsLCBtb2RvUGFnbywgZGl2aXNpb24sIG1vbmVkYSxcbiAgICAvLyBpbXBvcnRlVXNkLCBhcHJvYmFkb3IsIGFwcm9iYWRvRW4pIHlhIG5vIHNlIGV4cG9ydGFuIHBvciBwZWRpZG8gTWFyaWFuby5cbiAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coe1xuICAgICAgZmVjaGE6IGl0LmZlY2hhLFxuICAgICAgdGlwbzogci50aXBvIHx8ICcnLFxuICAgICAgdmVuZGVkb3I6IHIub3duZXJOYW1lIHx8IHIudmVuZG9yTmFtZSB8fCByLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBjb25jZXB0bzogY29uY2VwdFN0cixcbiAgICAgIG51bVRpY2tldDogci5udW1lcm9UaWNrZXQgfHwgJycsXG4gICAgICB0aXBvR2FzdG86IHIudGlwb0dhc3RvIHx8ICcnLFxuICAgICAgaW1wb3J0ZTogci5pbXBvcnRlICE9IG51bGwgPyByLmltcG9ydGUgOiAnJyxcbiAgICAgIG9iczogb2JzU3RyLFxuICAgICAgZm90bzogJycsIC8vIGNlbGRhIHZhY2lhIC0gZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZXN0YWRvOiByLnN0YXR1cyB8fCByLmVzdGFkbyB8fCAnJyxcbiAgICB9KTtcbiAgICByb3cuaGVpZ2h0ID0gUk9XX0g7XG4gICAgcm93LmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBTSUVNUFJFIGVtYmViZXIgbGEgZm90byAobm8gZGVqYXIgaHlwZXJsaW5rKS5cbiAgICAvLyBBbnRlczogc2kgZm90b1RpY2tldFVybCAoU3RvcmFnZSksIHF1ZWRhYmEgY29tbyBoeXBlcmxpbmsgQWJyaXIgdGlja2V0LlxuICAgIC8vIEFob3JhOiBmZXRjaCBkZWwgVVJMICsgY29udmVydGlyIGEgYXJyYXlCdWZmZXIgKyBlbWJlYmVyIGlndWFsIHF1ZSBkYXRhVVJMLlxuICAgIC8vIEZhbGxiYWNrIGEgaHlwZXJsaW5rIHNvbG8gc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCwgZXRjKS5cbiAgICBjb25zdCBmb3RvU3JjID0gci5mb3RvVGlja2V0IHx8IHIuYWRqdW50byB8fCAnJztcbiAgICBpZiAoZm90b1NyYyAmJiB0eXBlb2YgZm90b1NyYyA9PT0gJ3N0cmluZycgJiYgZm90b1NyYy5zdGFydHNXaXRoKCdkYXRhOmltYWdlLycpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsZXQgYjY0ID0gZm90b1NyYztcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XG4gICAgICAgIGlmIChtKSB7XG4gICAgICAgICAgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGI2NCA9IG1bMl07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byByZW5kaWNpb24nLCBpdC5pZCwgZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChyLmZvdG9UaWNrZXRVcmwgJiYgdHlwZW9mIHIuZm90b1RpY2tldFVybCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIHY3MTEgKDIwMjYtMDgtMjgpOiBmZXRjaCBsYSBmb3RvIGRlc2RlIFN0b3JhZ2UgeSBlbWJlYmVybGEgY29tbyBpbWFnZW4uXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2goci5mb3RvVGlja2V0VXJsKTtcbiAgICAgICAgaWYgKCFyZXNwLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHJlc3Auc3RhdHVzKTtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwLmhlYWRlcnMuZ2V0KCdjb250ZW50LXR5cGUnKSB8fCAnaW1hZ2UvanBlZyc7XG4gICAgICAgIGxldCBleHQgPSBjb250ZW50VHlwZS5zcGxpdCgnLycpWzFdIHx8ICdqcGVnJztcbiAgICAgICAgZXh0ID0gZXh0LnNwbGl0KCc7JylbMF0udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHJlc3AuYXJyYXlCdWZmZXIoKTtcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYnVmZmVyOiBidWYsIGV4dGVuc2lvbjogZXh0IH0pO1xuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XG4gICAgICAgICAgdGw6IHsgY29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogcm93Lm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBGYWxsYmFjazogc2kgZWwgZmV0Y2ggZmFsbGEgKENPUlMsIHJlZCksIGRlamFyIGh5cGVybGluayBjb21vIGFudGVzLlxuICAgICAgICBjb25zb2xlLndhcm4oJ2ZldGNoIGZvdG8gcmVuZGljaW9uIGZhbGxvLCBkZWpvIGh5cGVybGluaycsIGl0LmlkLCBlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBjZWxsID0gcm93LmdldENlbGwoRk9UT19DT0xfSURYICsgMSk7XG4gICAgICAgICAgY2VsbC52YWx1ZSA9IHtcbiAgICAgICAgICAgIHRleHQ6ICdBYnJpciB0aWNrZXQnLFxuICAgICAgICAgICAgaHlwZXJsaW5rOiByLmZvdG9UaWNrZXRVcmwsXG4gICAgICAgICAgICB0b29sdGlwOiAnQWJyaXIgbGEgZm90byBkZWwgdGlja2V0IGVuIGVsIGJyb3dzZXIgKGZldGNoIGZhbGxvKScsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjZWxsLmZvbnQgPSB7IGNvbG9yOiB7IGFyZ2I6ICdGRjA1NjNDMScgfSwgdW5kZXJsaW5lOiB0cnVlIH07XG4gICAgICAgIH0gY2F0Y2ggKF9lMikge31cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1JlbmRpY2lvbmVzXycgKyBwZXJpb2RMYWJlbChhbmlvLCBtb250aElkeCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgUmVuZGljaW9uZXMgbGlzdG8gKCcgKyBpdGVtcy5sZW5ndGggKyAnIGZpbGFzKScsIDI0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0UmVuZGljaW9uZXNGb3JNb250aCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJVVEFTOiBydXRhcyBhc2lnbmFkYXMgZGVsIHBlcmlvZG8gKyBvdmVycmlkZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuYXN5bmMgZnVuY3Rpb24gZXhwb3J0UnV0YXNGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBSdXRhcy4uLicpO1xuICAvLyBMYXMgcnV0YXMgc2UgZ2VuZXJhbiBlbiBydW50aW1lIHBhcmEgY2FkYSB2ZW5kZWRvcjsgZW4gY2FtYmlvIGxvcyBvdmVycmlkZXNcbiAgLy8gKGRlcml2YWNpb25lcyAvIHJlYWdlbmRhcykgdml2ZW4gZW4gcm91dGVfb3ZlcnJpZGVzLiBFeHBvcnRhbW9zOlxuICAvLyAgLSB1bmEgaG9qYSBjb24gbGFzIHJ1dGFzIHBsYW5pZmljYWRhcyBkZWwgcGVyaW9kbyAocGFyYSBsb3MgdmVuZGVkb3Jlc1xuICAvLyAgICBkZWwgcm9sIGFjdHVhbCBvIHRvZG9zIHNpIGFkbWluKVxuICAvLyAgLSB1bmEgaG9qYSBjb24gbG9zIG92ZXJyaWRlcyBkZWwgcGVyaW9kb1xuICBjb25zdCB0YXJnZXRWZW5kb3JzID1cbiAgICB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ3ZpZXdlcidcbiAgICAgID8gVkVORE9SUy5tYXAoKHYpID0+IHYua2V5KVxuICAgICAgOiBhc3NpZ25lZFZlbmRvclxuICAgICAgICA/IFthc3NpZ25lZFZlbmRvcl1cbiAgICAgICAgOiBbXTtcbiAgY29uc3QgbW9udGhzVG9FeHBvcnQgPSBtb250aElkeCAhPT0gbnVsbCA/IFttb250aElkeF0gOiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgNywgOCwgOSwgMTAsIDExXTtcbiAgY29uc3QgcnV0YXNSb3dzID0gW107XG4gIGZvciAoY29uc3QgdmVuZCBvZiB0YXJnZXRWZW5kb3JzKSB7XG4gICAgZm9yIChjb25zdCBtIG9mIG1vbnRoc1RvRXhwb3J0KSB7XG4gICAgICBsZXQgcnV0YXM7XG4gICAgICB0cnkge1xuICAgICAgICBydXRhcyA9IGdlbmVyYXJSdXRhc1ZlbmRvcih2ZW5kLCBtLCBhbmlvKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIHJ1dGFzID0gW107XG4gICAgICB9XG4gICAgICAocnV0YXMgfHwgW10pLmZvckVhY2goKHJ1dGEpID0+IHtcbiAgICAgICAgKHJ1dGEudGllbmRhcyB8fCBbXSkuZm9yRWFjaCgodCwgaSkgPT4ge1xuICAgICAgICAgIHJ1dGFzUm93cy5wdXNoKHtcbiAgICAgICAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZCksXG4gICAgICAgICAgICBBbmlvOiBhbmlvLFxuICAgICAgICAgICAgTWVzOiBNRVNFU1ttXSxcbiAgICAgICAgICAgIFJ1dGFfSUQ6IHJ1dGEuaWQgfHwgJycsXG4gICAgICAgICAgICBSdXRhX05vbWJyZTogcnV0YS5ub21icmUgfHwgJycsXG4gICAgICAgICAgICBGZWNoYV9Bc2lnbmFkYTogcnV0YS5mZWNoYUFzaWduYWRhIHx8ICcnLFxuICAgICAgICAgICAgT3JkZW46IGkgKyAxLFxuICAgICAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UodC5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgICAgICBMb2NhbGlkYWQ6IHQubG9jTmFtZSB8fCAnJyxcbiAgICAgICAgICAgIFRpZW5kYTogdC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICAgICAgVGlwbzogdC50aXBvIHx8ICcnLFxuICAgICAgICAgICAgRXN0YWRvOiB0LmVzdGFkbyB8fCAnJyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gT3ZlcnJpZGVzXG4gIGxldCBvdnJTbmFwO1xuICB0cnkge1xuICAgIG92clNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvdXRlX292ZXJyaWRlcycpLmdldCgpO1xuICB9IGNhdGNoIChfZSkge1xuICAgIG92clNuYXAgPSBudWxsO1xuICB9XG4gIGNvbnN0IG92ZXJyaWRlc1Jvd3MgPSBbXTtcbiAgaWYgKG92clNuYXApIHtcbiAgICBvdnJTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGNvbnN0IG8gPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgIGlmIChwYXJzZUludChvLmFuaW8sIDEwKSAhPT0gYW5pbykgcmV0dXJuO1xuICAgICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIHBhcnNlSW50KG8ubW9udGhJZHgsIDEwKSAhPT0gbW9udGhJZHgpIHJldHVybjtcbiAgICAgIG92ZXJyaWRlc1Jvd3MucHVzaCh7XG4gICAgICAgIEFuaW86IG8uYW5pbyB8fCAnJyxcbiAgICAgICAgTWVzOiBNRVNFU1twYXJzZUludChvLm1vbnRoSWR4LCAxMCldIHx8ICcnLFxuICAgICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKG8udmVuZG9yIHx8ICcnKSxcbiAgICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uoby5wcm92aW5jZSB8fCAnJyksXG4gICAgICAgIExvY2FsaWRhZDogby5sb2NOYW1lIHx8ICcnLFxuICAgICAgICBUaWVuZGE6IG8uY2xpZW50TmFtZSB8fCAnJyxcbiAgICAgICAgQWNjaW9uOiBvLmFjdGlvbiB8fCBvLnRpcG8gfHwgJycsXG4gICAgICAgIERlcml2YWRhX0E6IG8uZGVyaXZhZGFBIHx8ICcnLFxuICAgICAgICBSZWFnZW5kYWRhX1BhcmE6IG8ucmVhZ2VuZGFkYVBhcmEgfHwgJycsXG4gICAgICAgIE1vdGl2bzogby5tb3Rpdm8gfHwgJycsXG4gICAgICAgIENyZWFkb19Qb3I6IG8uY3JlYXRlZEJ5RW1haWwgfHwgJycsXG4gICAgICAgIENyZWFkb19FbjpcbiAgICAgICAgICBvLmNyZWF0ZWRBdCAmJiBvLmNyZWF0ZWRBdC50b0RhdGUgPyBvLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19SdXRhc18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnUnV0YXMgcGxhbmlmaWNhZGFzJywgcm93czogcnV0YXNSb3dzIH0sXG4gICAgeyBuYW1lOiAnRGVyaXZhY2lvbmVzLVJlYWdlbmRhcycsIHJvd3M6IG92ZXJyaWRlc1Jvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgUnV0YXMgbGlzdG8gKCcgKyBydXRhc1Jvd3MubGVuZ3RoICsgJyB0aWVuZGFzLCAnICsgb3ZlcnJpZGVzUm93cy5sZW5ndGggKyAnIG92ZXJyaWRlcyknLFxuICAgIDI0MDBcbiAgKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBTFRBUzogc29saWNpdHVkZXMgZGUgYWx0YSBkZSBjbGllbnRlIGRlbCBwZXJpb2RvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmFzeW5jIGZ1bmN0aW9uIF9leHBvcnRBbHRhc0Zvck1vbnRoKGFuaW8sIG1vbnRoSWR4KSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIEFsdGFzLi4uJyk7XG4gIGxldCBzbmFwO1xuICB0cnkge1xuICAgIHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgY29uc3QgYSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgIGxldCBkdCA9ICcnO1xuICAgIGlmIChhLmNyZWF0ZWRBdCAmJiBhLmNyZWF0ZWRBdC50b0RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGR0ID0gYS5jcmVhdGVkQXQudG9EYXRlKCk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgaWYgKCFkdCkgcmV0dXJuO1xuICAgIGlmIChkdC5nZXRGdWxsWWVhcigpICE9PSBhbmlvKSByZXR1cm47XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIGR0LmdldE1vbnRoKCkgIT09IG1vbnRoSWR4KSByZXR1cm47XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1NvbGljaXR1ZDogZHQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXG4gICAgICBFc3RhZG86IGEuc3RhdHVzIHx8ICcnLFxuICAgICAgQ29tZXJjaW86IGEuY29tZXJjaW8gfHwgJycsXG4gICAgICBGYW50YXNpYTogYS5mYW50YXNpYSB8fCAnJyxcbiAgICAgIENVSVQ6IGEuY3VpdCB8fCAnJyxcbiAgICAgIENvbmRpY2lvbl9GaXNjYWw6IGEuY29uZEZpc2NhbCB8fCAnJyxcbiAgICAgIENhbGxlOiBhLmNhbGxlIHx8ICcnLFxuICAgICAgTnVtZXJvOiBhLm51bWVybyB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYS5sb2NhbGlkYWQgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGEucHJvdmluY2lhIHx8ICcnLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICBUZWxlZm9ubzogYS50ZWxlZm9ubyB8fCAnJyxcbiAgICAgIEVtYWlsOiBhLmVtYWlsIHx8ICcnLFxuICAgICAgVmVuZGVkb3JfU29saWNpdGFudGU6IGEudmVuZG9yTmFtZSB8fCBhLm93bmVyRW1haWwgfHwgJycsXG4gICAgICBPd25lcl9FbWFpbDogYS5vd25lckVtYWlsIHx8ICcnLFxuICAgICAgU3VibWl0dGVkX0J5X1B1YmxpY19Gb3JtOiBhLnN1Ym1pdHRlZEJ5UHVibGljRm9ybSA/ICdTSScgOiAnTk8nLFxuICAgICAgQXByb2JhZG9fUG9yOiBhLmFwcHJvdmVkQnlFbWFpbCB8fCAnJyxcbiAgICAgIEFwcm9iYWRvX0VuOlxuICAgICAgICBhLmFwcHJvdmVkQXQgJiYgYS5hcHByb3ZlZEF0LnRvRGF0ZSA/IGEuYXBwcm92ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgUmVjaGF6YWRvX01vdGl2bzogYS5yZWplY3RlZFJlYXNvbiB8fCAnJyxcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fQWx0YXNfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0FsdGFzIGRlIGNsaWVudGVzJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgQWx0YXMgbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgc29saWNpdHVkZXMpJywgMjQwMCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gdjcwOSAoMjAyNi0wOC0yOCk6IDMgZXhwb3J0cyBudWV2b3MgcGVkaWRvcyBwb3IgTWFyaWFuby5cbi8vIC0gQkFDS09SREVSOiBsaW5lYXMgc3RhdGU9Qk8gb3BlbiBwb3IgbWVzIGRlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLlxuLy8gLSBTVE9DS19BU0lHOiBsaW5lYXMgQVNJRyBvcGVuIChvIEJPK3N0b2NrIGRpc3ApIHBvciBtZXMgZGUgY3JlYXRlZEF0LlxuLy8gLSBQRURJRE9TX01FUzogVE9ET1MgbG9zIHBlZGlkb3MgY3JlYWRvcyBlbiBlbCBtZXMvYW5pbyAoY3VhbHF1aWVyIHN0YWdlKS5cbi8vIEZ1ZW50ZTogZ2xvYmFsUGVkaWRvcyAobG8gcXVlIGxhIGFwcCB5YSB0aWVuZSBlbiBtZW1vcmlhKS5cbi8vIEZpbHRlciBtZXMvYVx1MDBGMW86IHNvYnJlIGNyZWF0ZWRBdCBkZWwgcGVkaWRvLiBtb250aElkeD1udWxsIC0+IGFcdTAwRjFvIGVudGVyby5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuZnVuY3Rpb24gX3BlZGlkb01vbnRoWWVhcihwKSB7XG4gIGNvbnN0IGNhID0gcC5jcmVhdGVkQXQ7XG4gIGlmICghY2EpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgbGV0IGR0ID0gbnVsbDtcbiAgaWYgKHR5cGVvZiBjYSA9PT0gJ3N0cmluZycpIGR0ID0gbmV3IERhdGUoY2EpO1xuICBlbHNlIGlmICh0eXBlb2YgY2EudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGR0ID0gY2EudG9EYXRlKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gZWxzZSBpZiAodHlwZW9mIGNhID09PSAnbnVtYmVyJykgZHQgPSBuZXcgRGF0ZShjYSk7XG4gIGlmICghZHQgfHwgTnVtYmVyLmlzTmFOKGR0LmdldFRpbWUoKSkpIHJldHVybiB7IHk6IG51bGwsIG06IG51bGwgfTtcbiAgcmV0dXJuIHsgeTogZHQuZ2V0RnVsbFllYXIoKSwgbTogZHQuZ2V0TW9udGgoKSB9O1xufVxuXG5mdW5jdGlvbiBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgsIHNjb3BlKSB7XG4gIGNvbnN0IGFyciA9XG4gICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gIC8vIHYxNTM0OiBhbGNhbmNlIHBvciByb2wgKHZlbmRlZG9yID0gY2xpZW50ZXMgZGUgc3UgbWFzdGVyOyBpbnRlcm5vID0gcGFyZWphcykuXG4gIC8vIFByaW1lcm8gZWwgbWVzIChiYXJhdG8pIHkgZGVzcHVcdTAwRTlzIGVsIGFsY2FuY2UgKHJlc3VlbHZlIGVsIG1hc3RlciBwb3IgY2xpZW50ZSkuXG4gIGNvbnN0IGRlbE1lcyA9IGFyci5maWx0ZXIoKHApID0+IHtcbiAgICBpZiAoIXApIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCB7IHksIG0gfSA9IF9wZWRpZG9Nb250aFllYXIocCk7XG4gICAgaWYgKHkgPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh5ICE9PSBhbmlvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKG1vbnRoSWR4ICE9PSBudWxsICYmIG0gIT09IG1vbnRoSWR4KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xuICBjb25zdCBzYyA9IHNjb3BlIHx8IF9leHBvcnRTY29wZSgpO1xuICByZXR1cm4gc2MuZmlsdGVyUGVkaWRvcyhkZWxNZXMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRCYWNrb3JkZXJGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIuLi4nKTtcbiAgLy8gdjExMDA6IGRlbGVnYSBhbCBtXHUwMEYzZHVsbyBwdXJvLiBGaWx0cmEgcG9yIG1lcyB2XHUwMEVEYSBmaWx0ZXJzLm1lc1lZWVlNTVxuICAvLyAocXVlIGVsIG1cdTAwRjNkdWxvIGFwbGljYSBzb2JyZSBjb25maXJtZWRBdCkuIENvaW5jaWRlIGNvbiBlbCBtb2RhbC5cbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBjb21wdXRlRm4gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuY29tcHV0ZUJhY2tvcmRlclJhd0xpbmVzO1xuICBjb25zdCBtZXNZWVlZTU0gPSBhbmlvICsgJy0nICsgU3RyaW5nKG1vbnRoSWR4ICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgLyoqIEB0eXBlIHsocDogYW55KSA9PiBzdHJpbmd9ICovXG4gIC8vIHYxMTAxICgyMDI2LTA5LTMwKTogYnVzY2FyIHByaW1lcm8gcG9yIHNhcENhcmRDb2RlIChcdTAwRkFuaWNvLCBubyBkZXBlbmRlIGRlXG4gIC8vIG5vcm1hbGl6YWNpXHUwMEYzbiBkZSBzdHJpbmdzKSB5IHNcdTAwRjNsbyBjYWVyIGFsIGNsaWVudExvY0lkIGNvbW8gXHUwMEZBbHRpbW8gcmVjdXJzby5cbiAgLy8gVmVyIGNvbWVudGFyaW8gZXh0ZW5kaWRvIGVuIGluZGV4Lmh0bWw6ZXhwb3J0QmFja29yZGVyc1RvRXhjZWwuXG4gIGNvbnN0IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2sgPSAocCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZSA9IHcuY2xpZW50TWFzdGVyQ2FjaGU7XG4gICAgICBpZiAoIWNhY2hlKSByZXR1cm4gJyc7XG4gICAgICBjb25zdCBjYyA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gICAgICBpZiAoY2MgJiYgdHlwZW9mIGNhY2hlLmZvckVhY2ggPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgbGV0IGZvdW5kID0gJyc7XG4gICAgICAgIGNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgICAgICAgIGlmIChmb3VuZCkgcmV0dXJuO1xuICAgICAgICAgIGlmIChjbURhdGEgJiYgU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpID09PSBjYyAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHtcbiAgICAgICAgICAgIGZvdW5kID0gY21EYXRhLmFzc2lnbmVkVmVuZG9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGZvdW5kO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiB3LmNsaWVudExvY0lkID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiBjYWNoZS5nZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY29uc3QgY21Eb2NJZCA9IHcuY2xpZW50TG9jSWQocC5wcm92aW5jZSB8fCAnJywgcC5sb2NOYW1lIHx8ICcnLCBwLmNsaWVudE5hbWUgfHwgJycpO1xuICAgICAgICBjb25zdCBjbURhdGEgPSBjYWNoZS5nZXQoY21Eb2NJZCk7XG4gICAgICAgIHJldHVybiAoY21EYXRhICYmIGNtRGF0YS5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gICAgICB9XG4gICAgICByZXR1cm4gJyc7XG4gICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gIH07XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIHBlZGlkb3MsXG4gICAgICAgICd1cmdlbnRlJyxcbiAgICAgICAgeyBtZXNZWVlZTU0gfSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBwZWRpZG9zKSBpZiAocCAmJiBwLl9mc0lkKSBwZWRpZG9CeUlkW3AuX2ZzSWRdID0gcDtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICByYXdMaW5lcy5mb3JFYWNoKChybCkgPT4ge1xuICAgIGNvbnN0IGMgPSBybC5jbGllbnRlO1xuICAgIGNvbnN0IHAgPSBjLnBlZGlkb0lkID8gcGVkaWRvQnlJZFtjLnBlZGlkb0lkXSA6IG51bGw7XG4gICAgY29uc3QgcW8gPSBjLnF0eUJhY2tvcmRlciB8fCAwO1xuICAgIGxldCBmZWNoYVBlZGlkbyA9ICcnO1xuICAgIGlmIChjLnBlZGlkb0NyZWF0ZWRBdCkge1xuICAgICAgY29uc3QgZHQgPSBjLnBlZGlkb0NyZWF0ZWRBdDtcbiAgICAgIGZlY2hhUGVkaWRvID1cbiAgICAgICAgdHlwZW9mIGR0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZHQuc2xpY2UoMCwgMTApXG4gICAgICAgICAgOiBuZXcgRGF0ZShkdC50b0RhdGUgPyBkdC50b0RhdGUoKSA6IGR0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgICB9XG4gICAgbGV0IGNhbnRpZGFkUGVkaWRhID0gcW87XG4gICAgbGV0IGxpbmVhSWR4ID0gLTE7XG4gICAgaWYgKHAgJiYgQXJyYXkuaXNBcnJheShwLmxpbmVzKSkge1xuICAgICAgY29uc3QgaWR4ID0gcC5saW5lcy5maW5kSW5kZXgoXG4gICAgICAgIChsKSA9PiBsICYmIFN0cmluZyhsLmNvZGUgfHwgJycpLnRvVXBwZXJDYXNlKCkgPT09IHJsLnNrdSAmJiBsLnN0YXRlID09PSBjLnN0YXRlXG4gICAgICApO1xuICAgICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICAgIGNhbnRpZGFkUGVkaWRhID0gTnVtYmVyKHAubGluZXNbaWR4XS5xdHkpIHx8IHFvO1xuICAgICAgICBsaW5lYUlkeCA9IGlkeDtcbiAgICAgIH1cbiAgICB9XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIEZlY2hhX1BlZGlkbzogZmVjaGFQZWRpZG8sXG4gICAgICBNZXM6IChwICYmIHAubW9udGgpIHx8ICcnLFxuICAgICAgQ2xpZW50ZTogYy5ub21icmUgfHwgJycsXG4gICAgICBDYXJkQ29kZTogYy5jb2RlIHx8IChwICYmIHAuY2xpZW50Q2FyZENvZGUpIHx8ICcnLFxuICAgICAgUHJvdmluY2lhOiBjLnByb3ZpbmNpYSB8fCAocCAmJiBwLnByb3ZpbmNlKSB8fCAnJyxcbiAgICAgIExvY2FsaWRhZDogYy5jaXVkYWQgfHwgKHAgJiYgcC5sb2NOYW1lKSB8fCAnJyxcbiAgICAgIFZlbmRlZG9yOiBjLnZlbmRvcktleSB8fCAnJyxcbiAgICAgIFNLVTogcmwuc2t1IHx8ICcnLFxuICAgICAgUHJvZHVjdG86IHJsLnByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ2FudGlkYWRfUGVkaWRhOiBjYW50aWRhZFBlZGlkYSxcbiAgICAgIENhbnRpZGFkX1BlbmRpZW50ZV9CTzogcW8sXG4gICAgICBQcmVjaW9fVW5pdF9BUlM6IGMucHJlY2lvIHx8IDAsXG4gICAgICBTdWJ0b3RhbF9CT19BUlM6IE1hdGgucm91bmQocW8gKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuQ2xpZW50ZSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkNsaWVudGUgfHwgJycpKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19CYWNrb3JkZXJfJyArIHBlcmlvZExhYmVsKGFuaW8sIG1vbnRoSWR4KSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ0JhY2tvcmRlcicsIHJvd3MgfV0pO1xuICBzaG93U3luY1RhZygnRXhwb3J0IEJhY2tvcmRlciBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9leHBvcnRTdG9ja0FzaWdGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBTdG9jayBBc2lnbmFkby4uLicpO1xuICAvLyB2MTEwMDogZGVsZWdhIGFsIG1cdTAwRjNkdWxvIHB1cm8gbW9kbyBhc2lnbmFjaW9uLiBDb2luY2lkZSBjb24gZWwgbW9kYWwuXG4gIGNvbnN0IHBlZGlkb3MgPSBfaXRlcmF0ZVBlZGlkb3NNZXMoYW5pbywgbW9udGhJZHgpO1xuICBjb25zdCB3ID0gLyoqIEB0eXBlIHthbnl9ICovICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHt9KTtcbiAgY29uc3QgY29tcHV0ZUZuID0gdy5fX3BoYXNlMCAmJiB3Ll9fcGhhc2UwLnB1cmUgJiYgdy5fX3BoYXNlMC5wdXJlLmNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lcztcbiAgY29uc3QgbWVzWVlZWU1NID0gYW5pbyArICctJyArIFN0cmluZyhtb250aElkeCArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIC8qKiBAdHlwZSB7KHA6IGFueSkgPT4gc3RyaW5nfSAqL1xuICAvLyB2MTEwMSAoMjAyNi0wOS0zMCk6IGJ1c2NhciBwcmltZXJvIHBvciBzYXBDYXJkQ29kZSAoXHUwMEZBbmljbywgbm8gZGVwZW5kZSBkZVxuICAvLyBub3JtYWxpemFjaVx1MDBGM24gZGUgc3RyaW5ncykgeSBzXHUwMEYzbG8gY2FlciBhbCBjbGllbnRMb2NJZCBjb21vIFx1MDBGQWx0aW1vIHJlY3Vyc28uXG4gIC8vIFZlciBjb21lbnRhcmlvIGV4dGVuZGlkbyBlbiBpbmRleC5odG1sOmV4cG9ydEJhY2tvcmRlcnNUb0V4Y2VsLlxuICBjb25zdCBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrID0gKHApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGUgPSB3LmNsaWVudE1hc3RlckNhY2hlO1xuICAgICAgaWYgKCFjYWNoZSkgcmV0dXJuICcnO1xuICAgICAgY29uc3QgY2MgPSBTdHJpbmcocC5jbGllbnRDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKGNjICYmIHR5cGVvZiBjYWNoZS5mb3JFYWNoID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBmb3VuZCA9ICcnO1xuICAgICAgICBjYWNoZS5mb3JFYWNoKChjbURhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZm91bmQpIHJldHVybjtcbiAgICAgICAgICBpZiAoY21EYXRhICYmIFN0cmluZyhjbURhdGEuc2FwQ2FyZENvZGUgfHwgJycpLnRyaW0oKSA9PT0gY2MgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGNtRGF0YS5hc3NpZ25lZFZlbmRvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgY2FjaGUuZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY21EYXRhID0gY2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgICByZXR1cm4gKGNtRGF0YSAmJiBjbURhdGEuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICAgICAgfVxuICAgICAgcmV0dXJuICcnO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9O1xuICBjb25zdCByYXdMaW5lcyA9IGNvbXB1dGVGblxuICAgID8gY29tcHV0ZUZuKFxuICAgICAgICBwZWRpZG9zLFxuICAgICAgICAnYXNpZ25hY2lvbicsXG4gICAgICAgIHsgbWVzWVlZWU1NIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBnZXRTdG9ja0Rpc3BvbmlibGVWZW50YTpcbiAgICAgICAgICAgIHR5cGVvZiB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhID09PSAnZnVuY3Rpb24nID8gdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA6ICgpID0+IDAsXG4gICAgICAgICAgY2Fub25WZW5kb3I6XG4gICAgICAgICAgICB0eXBlb2Ygdy5fY2Fub25WZW5kb3IgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICAgICAgPyB3Ll9jYW5vblZlbmRvclxuICAgICAgICAgICAgICA6ICh4KSA9PlxuICAgICAgICAgICAgICAgICAgU3RyaW5nKHggfHwgJycpXG4gICAgICAgICAgICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAgICAgICAgICAgLnRvVXBwZXJDYXNlKCksXG4gICAgICAgICAgcHJvZHVjdHM6IEFycmF5LmlzQXJyYXkody5QUk9EVUNUUykgPyB3LlBST0RVQ1RTIDogW10sXG4gICAgICAgICAgcmVzb2x2ZVZlbmRvckZhbGxiYWNrOiBfcmVzb2x2ZVZlbmRvckZhbGxiYWNrLFxuICAgICAgICB9XG4gICAgICApXG4gICAgOiBbXTtcbiAgY29uc3QgcGVkaWRvQnlJZCA9IHt9O1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykgaWYgKHAgJiYgcC5fZnNJZCkgcGVkaWRvQnlJZFtwLl9mc0lkXSA9IHA7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgcmF3TGluZXMuZm9yRWFjaCgocmwpID0+IHtcbiAgICBjb25zdCBjID0gcmwuY2xpZW50ZTtcbiAgICBjb25zdCBwID0gYy5wZWRpZG9JZCA/IHBlZGlkb0J5SWRbYy5wZWRpZG9JZF0gOiBudWxsO1xuICAgIGNvbnN0IHF0eSA9IGMucXR5QXNpZ25hZGEgfHwgMDtcbiAgICBsZXQgZmVjaGFQZWRpZG8gPSAnJztcbiAgICBpZiAoYy5wZWRpZG9DcmVhdGVkQXQpIHtcbiAgICAgIGNvbnN0IGR0ID0gYy5wZWRpZG9DcmVhdGVkQXQ7XG4gICAgICBmZWNoYVBlZGlkbyA9XG4gICAgICAgIHR5cGVvZiBkdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGR0LnNsaWNlKDAsIDEwKVxuICAgICAgICAgIDogbmV3IERhdGUoZHQudG9EYXRlID8gZHQudG9EYXRlKCkgOiBkdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgfVxuICAgIGxldCBsaW5lYUlkeCA9IC0xO1xuICAgIGlmIChwICYmIEFycmF5LmlzQXJyYXkocC5saW5lcykpIHtcbiAgICAgIGNvbnN0IGlkeCA9IHAubGluZXMuZmluZEluZGV4KFxuICAgICAgICAobCkgPT4gbCAmJiBTdHJpbmcobC5jb2RlIHx8ICcnKS50b1VwcGVyQ2FzZSgpID09PSBybC5za3UgJiYgbC5zdGF0ZSA9PT0gYy5zdGF0ZVxuICAgICAgKTtcbiAgICAgIGlmIChpZHggPj0gMCkgbGluZWFJZHggPSBpZHg7XG4gICAgfVxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fU3RvY2tBc2lnbmFkb18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnU3RvY2sgQXNpZ25hZG8nLCByb3dzIH1dKTtcbiAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBTdG9jayBBc2lnbmFkbyBsaXN0byAoJyArIHJvd3MubGVuZ3RoICsgJyBsaW5lYXMpJywgMjQwMCk7XG59XG5cbi8vIHY3MzcgKDIwMjYtMDgtMzApOiBTTkFQU0hPVCBBQ1RVQUwgZGUgdG9kb3MgbG9zIGJhY2tvcmRlcnMgb3BlbiAoc2luIGZpbHRyb1xuLy8gZGUgbWVzKS4gTW90aXZvOiBsb3MgNjIgcGVkaWRvcyBtaWdyYWRvcyBkZXNkZSBTQVAgZWwgMjAyNi0wOC0yOCB0aWVuZW5cbi8vIGNyZWF0ZWRBdCBkZSBmZWNoYXMgdmllamFzIGRlbCBTQVAgU1Egb3JpZ2luYWwsIGVudG9uY2VzIGVsIGV4cG9ydCBwb3IgbWVzXG4vLyBubyBsb3MgaW5jbHVpYS4gVmVyc2lvbiBcImN1cnJlbnQgc3RhdHVzXCIgcXVlIGl0ZXJhIGdsb2JhbFBlZGlkb3MgY29tcGxldG8uXG53aW5kb3cuZXhwb3J0QmFja29yZGVyQWxsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIGV4cG9ydCBkZSBCYWNrb3JkZXIgKHNuYXBzaG90IGFjdHVhbCkuLi4nKTtcbiAgLy8gdjE0ODggXHUwMEE3ODYgKDIwMjYtMTAtMjcgQlVHIEZJWCk6IHVzYXIgbGEgTUlTTUEgcHVyZSBmbiBxdWUgZWwgbW9kYWwgZXhwb3J0XG4gIC8vIChgY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3NgKS4gQW50ZXMgdjE0ODg6IHBhbmVsIHVzYWJhXG4gIC8vIGBjb21wdXRlQmFja29yZGVyUmF3TGluZXMoe30pYCBzaW4gYGluY2x1ZGVFeHBpcmVkYCBcdTIxOTIgb2N1bHRhYmEgQk9zID4gOTBkLlxuICAvLyBNb2RhbCB1c2FiYSBgY29tcHV0ZUJhY2tvcmRlclNrdU1hcCguLi4sIHtpbmNsdWRlRXhwaXJlZDp0cnVlfSlgIFx1MjE5MiBsb3NcbiAgLy8gaW5jbHVcdTAwRURhLiBEZWx0YSBtZWRpZG8gZW4gcHJvZDogMjIyIHVuaWRhZGVzIChtb2RhbCA3Njk2IHZzIHBhbmVsIDc0NzQpLlxuICAvLyBGaXg6IHB1cmUgZm4gXHUwMEZBbmljYSBjb24gZGVmYXVsdCBgaW5jbHVkZUV4cGlyZWQ9dHJ1ZWAgKGFsaW5lYWRvIGNvbiBcdTAwQTc0MC4xXG4gIC8vIHkgZ2V0U3RvY2tCcmVha2Rvd24uYmFja29yZGVyQXBwLnRvdGFsIFx1MjAxNCBsYSBjb2xhIGNvbXBsZXRhKS5cbiAgLy8gdjE1MzQ6IGFsY2FuY2UgcG9yIHJvbCAodmVuZGVkb3IgPSBjbGllbnRlcyBkZSBzdSBtYXN0ZXI7IGludGVybm8gPSBwYXJlamFzKS5cbiAgY29uc3QgYXJyID0gX2V4cG9ydFNjb3BlKCkuZmlsdGVyUGVkaWRvcyhcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXVxuICApO1xuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBwdXJlIGZuIFx1MDBGQW5pY2EgYGNvbXB1dGVCYWNrb3JkZXJFeHBvcnRSb3dzYCAocmVlbXBsYXphIGVsXG4gIC8vIHBhdGggaGlzdFx1MDBGM3JpY28gYGNvbXB1dGVCYWNrb3JkZXJSYXdMaW5lc2AgcXVlIG5vIGNvbnNvbGlkYWJhIHkgcGVyZFx1MDBFRGFcbiAgLy8gQk9zID4gOTBkKS4gUGFuZWwgcGFzYSBge31gIFx1MjE5MiB0cmFlIHRvZGEgbGEgY29sYSBzaW4gZmlsdHJvcyBtYW51YWxlcy5cbiAgY29uc3QgX2V4cG9ydEZuID1cbiAgICB3Ll9fcGhhc2UwICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydCAmJlxuICAgIHcuX19waGFzZTAucHVyZS5iYWNrb3JkZXJFeHBvcnQuY29tcHV0ZUJhY2tvcmRlckV4cG9ydFJvd3M7XG4gIGNvbnN0IGRlcHMgPSB7XG4gICAgZ2V0U3RvY2tEaXNwb25pYmxlVmVudGE6XG4gICAgICB0eXBlb2Ygdy5nZXRTdG9ja0Rpc3BvbmlibGVWZW50YSA9PT0gJ2Z1bmN0aW9uJyA/IHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgOiAoKSA9PiAwLFxuICAgIGNhbm9uVmVuZG9yOlxuICAgICAgdHlwZW9mIHcuX2Nhbm9uVmVuZG9yID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gdy5fY2Fub25WZW5kb3JcbiAgICAgICAgOiAoeCkgPT5cbiAgICAgICAgICAgIFN0cmluZyh4IHx8ICcnKVxuICAgICAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgICAgIC50b1VwcGVyQ2FzZSgpLFxuICAgIHByb2R1Y3RzOiBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdLFxuICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgfTtcbiAgY29uc3QgX2V4cG9ydFJlc3VsdCA9IF9leHBvcnRGblxuICAgID8gX2V4cG9ydEZuKGFyciwge30sIGRlcHMpXG4gICAgOiB7IHJvd3M6IFtdLCB0b3RhbFVuaWRhZGVzOiAwLCB0b3RhbEZpbGFzOiAwLCBmaWx0cm9zQXBsaWNhZG9zOiB7fSB9O1xuICBjb25zdCByb3dzID0gX2V4cG9ydFJlc3VsdC5yb3dzO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydChcbiAgICAgICdFeHBvcnQgQmFja29yZGVyIHZhY2lvLiBEaWFnbm9zdGljbzpcXG4nICtcbiAgICAgICAgJy0gVG90YWwgcGVkaWRvcyBlbiBnbG9iYWxQZWRpZG9zOiAnICtcbiAgICAgICAgYXJyLmxlbmd0aCArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gUGVkaWRvcyBhYmllcnRvcyAoc2luIGNsb3NlZEF0KTogJyArXG4gICAgICAgIHRvdGFsUGVkaWRvc09wZW4gK1xuICAgICAgICAnXFxuJyArXG4gICAgICAgICctIExpbmVhcyBwb3N0LUZJRk8rdmVuY2lkYXMgY29uIHF0eUJhY2tvcmRlcj4wOiAwXFxuXFxuJyArXG4gICAgICAgICdQb3NpYmxlcyBjYXVzYXM6XFxuJyArXG4gICAgICAgICcxLiBObyBoYXkgYmFja29yZGVyIGFiaWVydG8gYWhvcmEgbWlzbW8gKHRvZG8gY29uZmlybWVkLCBjZXJyYWRvIG8gdmVuY2lkbylcXG4nICtcbiAgICAgICAgJzIuIExvcyBwZWRpZG9zIHRpZW5lbiBjbG9zZWRBdCBzZXRlYWRvIHBvciBlcnJvclxcbicgK1xuICAgICAgICAnMy4gVG9kYXMgbGFzIGxpbmVhcyBCTyB0aWVuZW4gc3RvY2sgZGlzcG9uaWJsZSAoZnVlcm9uIHByb21vdmlkYXMgYSBBU0lHIHZpcnR1YWwpJ1xuICAgICk7XG4gICAgc2hvd1N5bmNUYWcoJ0V4cG9ydCBCYWNrb3JkZXI6IDAgbGluZWFzICh2ZXIgYWxlcnRhKScsIDMwMDApO1xuICAgIHJldHVybjtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IChhLkNsaWVudGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlIHx8ICcnKSk7XG4gIC8vIHYxMzY2ICgyMDI2LTEwLTE5KTogaG9qYSBcIlJlc3VtZW5cIiBjb24gbG9zIE1JU01PUyB0b3RhbGVzIHF1ZSBlbCBtb2RhbFxuICAvLyBCYWNrb3JkZXIgKGNvbXB1dGVCYWNrb3JkZXJTa3VNYXAgcG9zdC1jb25zb2xpZGFjaW9uIHBvciBjbGllbnRlKS4gQW50ZXNcbiAgLy8gZWwgZXhwb3J0IGR1bXBlYWJhIGxpbmVhcyBjcnVkYXMgc2luIG5pbmd1biB0b3RhbCBcdTIxOTIgTWFyaWFubyBzdW1hYmEgbGFcbiAgLy8gY29sdW1uYSBTdWJ0b3RhbF9CT19BUlMgeSBlbCB2YWxvciBwb2RpYSBkaXZlcmdlciBkZWwgbW9kYWwgY3VhbmRvIHVuXG4gIC8vIGNsaWVudGUgdGVuaWEgdmFyaWFzIGxpbmVhcyBCTyBkZWwgbWlzbW8gU0tVIGNvbiBwcmVjaW9zIGRpc3RpbnRvcyAoZWxcbiAgLy8gbW9kYWwgY29uc29saWRhIHVzYW5kbyBlbCBwcmVjaW8gZGUgbGEgMXJhIGxpbmVhIHByb2Nlc2FkYTsgZWwgZXhwb3J0XG4gIC8vIHVzYSBlbCBwcmVjaW8gZGUgY2FkYSBsaW5lYSBpbmRpdmlkdWFsKS5cbiAgY29uc3QgX2NvbXB1dGVTa3VNYXBGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyU2t1TWFwO1xuICBjb25zdCBfbW9kYWxEZXBzID0ge1xuICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICBjYW5vblZlbmRvcjpcbiAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICBiYWNrb3JkZXJMaW5lczogQXJyYXkuaXNBcnJheSh3LmJhY2tvcmRlckxpbmVzKSA/IHcuYmFja29yZGVyTGluZXMgOiBbXSxcbiAgICBzYXBHZXRDbGllbnRlQ29kZTogdHlwZW9mIHcuc2FwR2V0Q2xpZW50ZUNvZGUgPT09ICdmdW5jdGlvbicgPyB3LnNhcEdldENsaWVudGVDb2RlIDogdW5kZWZpbmVkLFxuICAgIHJlc29sdmVWZW5kb3JGYWxsYmFjazogX3Jlc29sdmVWZW5kb3JGYWxsYmFjayxcbiAgfTtcbiAgY29uc3QgX21vZGFsRmlsdGVycyA9IHtcbiAgICB0aWVuZGFRdWVyeTogJycsXG4gICAgdmVuZG9yS2V5OiAnJyxcbiAgICBtZXNZWVlZTU06ICcnLFxuICAgIHVyZ2VuY3lGaWx0ZXI6ICcnLFxuICAgIGluY2x1ZGVFeHBpcmVkOiB0cnVlLFxuICAgIGFnZ3JlZ2F0aW9uTW9kZTogJ2ZpZm8nLFxuICB9O1xuICBjb25zdCBfbW9kYWxSZXN1bHQgPSBfY29tcHV0ZVNrdU1hcEZuXG4gICAgPyBfY29tcHV0ZVNrdU1hcEZuKGFyciwgJ3VyZ2VudGUnLCBfbW9kYWxGaWx0ZXJzLCBfbW9kYWxEZXBzKVxuICAgIDogeyBza3VzOiBbXSwgdG90YWxVbmlkYWRlczogMCwgdG90YWxDbGllbnRlczogMCB9O1xuICBsZXQgdG90YWxQZXNvc01vZGFsID0gMDtcbiAgY29uc3Qgc3VidG90YWxlc1BvclVyZ2VuY3kgPSB7IHVyZ2VudGU6IDAsIHBhcmNpYWw6IDAgfTtcbiAgZm9yIChjb25zdCBnIG9mIF9tb2RhbFJlc3VsdC5za3VzIHx8IFtdKSB7XG4gICAgY29uc3QgdXJnID0gZy51cmdlbmN5IHx8ICd1cmdlbnRlJztcbiAgICBmb3IgKGNvbnN0IGMgb2YgZy5jbGllbnRlcyB8fCBbXSkge1xuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGMucXR5QmFja29yZGVyKSB8fCAwO1xuICAgICAgaWYgKHF0eSA8PSAwKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHByZWNpbyA9IE51bWJlcihjLnByZWNpbykgfHwgMDtcbiAgICAgIGNvbnN0IHN1YiA9IHF0eSAqIHByZWNpbztcbiAgICAgIHRvdGFsUGVzb3NNb2RhbCArPSBzdWI7XG4gICAgICBpZiAodXJnID09PSAncGFyY2lhbCcpIHN1YnRvdGFsZXNQb3JVcmdlbmN5LnBhcmNpYWwgKz0gc3ViO1xuICAgICAgZWxzZSBzdWJ0b3RhbGVzUG9yVXJnZW5jeS51cmdlbnRlICs9IHN1YjtcbiAgICB9XG4gIH1cbiAgY29uc3QgdG90YWxVbmlkYWRlc01vZGFsID0gX2V4cG9ydFJlc3VsdC50b3RhbFVuaWRhZGVzIHx8IF9tb2RhbFJlc3VsdC50b3RhbFVuaWRhZGVzIHx8IDA7XG4gIGNvbnN0IHRvdGFsQ2xpZW50ZXNNb2RhbCA9IF9tb2RhbFJlc3VsdC50b3RhbENsaWVudGVzIHx8IDA7XG4gIGNvbnN0IHRvdGFsU2t1c01vZGFsID0gKF9tb2RhbFJlc3VsdC5za3VzIHx8IFtdKS5sZW5ndGg7XG4gIC8vIHYxNDg4IFx1MDBBNzg2OiBmaWxhIGRlIGVuY2FiZXphZG8gXCJGaWx0cm9zIGFwbGljYWRvc1wiIHBhcmEgdHJhbnNwYXJlbmNpYS5cbiAgY29uc3QgX2ZtdEZpbHRyb3MgPVxuICAgIHcuX19waGFzZTAgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUgJiZcbiAgICB3Ll9fcGhhc2UwLnB1cmUuYmFja29yZGVyRXhwb3J0ICYmXG4gICAgdy5fX3BoYXNlMC5wdXJlLmJhY2tvcmRlckV4cG9ydC5mb3JtYXRCYWNrb3JkZXJGaWx0cm9zSGVhZGVyO1xuICBjb25zdCBmaWx0cm9zTGJsID0gX2ZtdEZpbHRyb3MgPyBfZm10RmlsdHJvcyhfZXhwb3J0UmVzdWx0LmZpbHRyb3NBcGxpY2Fkb3MpIDogJ0ZpbHRyb3M6IG5pbmd1bm8nO1xuICBjb25zdCByZXN1bWVuUm93cyA9IFtcbiAgICB7IE1ldHJpY2E6IGZpbHRyb3NMYmwsIFZhbG9yOiAnJyB9LFxuICAgIHsgTWV0cmljYTogJ1RPVEFMIEJhY2tvcmRlciBBUlMnLCBWYWxvcjogTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpIH0sXG4gICAgeyBNZXRyaWNhOiAnU0tVcyBjb24gYmFja29yZGVyJywgVmFsb3I6IHRvdGFsU2t1c01vZGFsIH0sXG4gICAgeyBNZXRyaWNhOiAnVW5pZGFkZXMgcGVuZGllbnRlcycsIFZhbG9yOiBNYXRoLnJvdW5kKHRvdGFsVW5pZGFkZXNNb2RhbCkgfSxcbiAgICB7IE1ldHJpY2E6ICdQYXJlcyBjbGllbnRlK1NLVSAoZmlsYXMgZW4gaG9qYSBCYWNrb3JkZXIpJywgVmFsb3I6IHJvd3MubGVuZ3RoIH0sXG4gICAgeyBNZXRyaWNhOiAnQ2xpZW50ZXMgYWZlY3RhZG9zJywgVmFsb3I6IHRvdGFsQ2xpZW50ZXNNb2RhbCB9LFxuICAgIHsgTWV0cmljYTogJ1x1MjAxNCBTdWJ0b3RhbCBTSU4gUkVQT1NJQ0lPTicsIFZhbG9yOiBNYXRoLnJvdW5kKHN1YnRvdGFsZXNQb3JVcmdlbmN5LnVyZ2VudGUpIH0sXG4gICAgeyBNZXRyaWNhOiAnXHUyMDE0IFN1YnRvdGFsIFBBUkNJQUwnLCBWYWxvcjogTWF0aC5yb3VuZChzdWJ0b3RhbGVzUG9yVXJnZW5jeS5wYXJjaWFsKSB9LFxuICAgIHsgTWV0cmljYTogJ1NuYXBzaG90IGdlbmVyYWRvJywgVmFsb3I6IG5ldyBEYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgfSxcbiAgXTtcbiAgLy8gdjE0ODggXHUwMEE3ODY6IGZpbGEgVE9UQUwgYWxpbmVhZGEgY29uIGVsIG51ZXZvIHNoYXBlIChzaW4gY29sdW1uYXMgbGVnYWN5XG4gIC8vIEZlY2hhX1BlZGlkbyAvIE1lcyAvIENhbnRpZGFkX1BlZGlkYSAvIFBlZGlkb19JRCAvIExpbmVhX0lkeCAvIGV0Yy4pLlxuICAvLyBMYXMgbnVldmFzIGNvbHVtbmFzIChkZSBjb21wdXRlQmFja29yZGVyRXhwb3J0Um93cyk6IFNLVSwgUHJvZHVjdG8sXG4gIC8vIENsaWVudGUsIENhcmRDb2RlLCBQcm92aW5jaWEsIExvY2FsaWRhZCwgVmVuZGVkb3IsIENhbnRpZGFkX1BlbmRpZW50ZV9CTyxcbiAgLy8gUHJlY2lvX1VuaXRfQVJTLCBTdWJ0b3RhbF9CT19BUlMsIEVkYWRfQk9fZGlhcywgRXN0YWRvLCBQZWRpZG9zLlxuICBjb25zdCB0b3RhbFJvdyA9IHtcbiAgICBTS1U6ICcnLFxuICAgIFByb2R1Y3RvOiAnJyxcbiAgICBDbGllbnRlOiAnVE9UQUwnLFxuICAgIENhcmRDb2RlOiAnJyxcbiAgICBQcm92aW5jaWE6ICcnLFxuICAgIExvY2FsaWRhZDogJycsXG4gICAgVmVuZGVkb3I6ICcnLFxuICAgIENhbnRpZGFkX1BlbmRpZW50ZV9CTzogTWF0aC5yb3VuZCh0b3RhbFVuaWRhZGVzTW9kYWwpLFxuICAgIFByZWNpb19Vbml0X0FSUzogJycsXG4gICAgU3VidG90YWxfQk9fQVJTOiBNYXRoLnJvdW5kKHRvdGFsUGVzb3NNb2RhbCksXG4gICAgRWRhZF9CT19kaWFzOiAnJyxcbiAgICBFc3RhZG86ICcnLFxuICAgIFBlZGlkb3M6ICcnLFxuICB9O1xuICByb3dzLnB1c2godG90YWxSb3cpO1xuICAvLyB2MTU2NSAoMjAyNi0xMS0xOCk6IDIgaG9qYXMgZXhhY3RhcyBwb3IgcGVkaWRvIE1hcmlhbm8uXG4gIC8vIFwiQmFja29yZGVyX0NsaWVudGVzXCIgKFNLVSwgTk9NQlJFX0RFTF9QUk9EVUNUTywgQ0FOVElEQURfQkFDS09SREVSLFxuICAvLyAgIFNVQlRPVEFMLCBDTElFTlRFLCBJRF9QRURJRE8pICsgXCJCYWNrb3JkZXJfU0tVXCIgKFNLVSwgQ0FOVElEQURfQkFDS09SREVSLFxuICAvLyAgIFNVQlRPVEFMLCBQUk9NRURJT19WRU5UQV8zTSkuIENvbHVtbmEgUFJPTUVESU9fVkVOVEFfM00gcXVlZGEgdmFjaWFcbiAgLy8gICAocmVxdWllcmUgYWdyZWdhZG8gQlEgZnVlcmEgZGVsIGFsY2FuY2UgZGUgZXN0ZSBQUjsgZG9jdW1lbnRhZG8gZW5cbiAgLy8gICBkb2NzL0NIQU5HRUxPRy1leHBvcnRzLWNvbHVtbnMtcmVmYWN0b3IubWQpLiBSZXN1bWVuIGludGVybm8gY29uc2VydmFkb1xuICAvLyAgIHkgYXByb3ZlY2hhZG8gcGFyYSBlbCBhZ3JlZ2FkbyBwb3IgU0tVLlxuICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+fSAqL1xuICBjb25zdCByb3dzQ2xpZW50ZXMgPSByb3dzXG4gICAgLmZpbHRlcigocikgPT4gKHIuQ2xpZW50ZSB8fCAnJykgIT09ICdUT1RBTCcpXG4gICAgLm1hcCgocikgPT4gKHtcbiAgICAgIFNLVTogci5TS1UgfHwgJycsXG4gICAgICBOT01CUkVfREVMX1BST0RVQ1RPOiByLlByb2R1Y3RvIHx8ICcnLFxuICAgICAgQ0FOVElEQURfQkFDS09SREVSOiBOdW1iZXIoci5DYW50aWRhZF9QZW5kaWVudGVfQk8pIHx8IDAsXG4gICAgICBTVUJUT1RBTDogTnVtYmVyKHIuU3VidG90YWxfQk9fQVJTKSB8fCAwLFxuICAgICAgQ0xJRU5URTogci5DbGllbnRlIHx8ICcnLFxuICAgICAgSURfUEVESURPOiByLlBlZGlkb3MgfHwgJycsXG4gICAgfSkpO1xuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHtxdHk6IG51bWJlciwgc3ViOiBudW1iZXIsIG5vbWJyZTogc3RyaW5nfT59ICovXG4gIGNvbnN0IHNrdUFnZyA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCByIG9mIHJvd3NDbGllbnRlcykge1xuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhyLlNLVSB8fCAnJykudHJpbSgpO1xuICAgIGlmICghc2t1KSBjb250aW51ZTtcbiAgICBjb25zdCBwcmV2ID0gc2t1QWdnLmdldChza3UpIHx8IHsgcXR5OiAwLCBzdWI6IDAsIG5vbWJyZTogci5OT01CUkVfREVMX1BST0RVQ1RPIH07XG4gICAgcHJldi5xdHkgKz0gTnVtYmVyKHIuQ0FOVElEQURfQkFDS09SREVSKSB8fCAwO1xuICAgIHByZXYuc3ViICs9IE51bWJlcihyLlNVQlRPVEFMKSB8fCAwO1xuICAgIGlmICghcHJldi5ub21icmUgJiYgci5OT01CUkVfREVMX1BST0RVQ1RPKSBwcmV2Lm5vbWJyZSA9IHIuTk9NQlJFX0RFTF9QUk9EVUNUTztcbiAgICBza3VBZ2cuc2V0KHNrdSwgcHJldik7XG4gIH1cbiAgLy8gdjE1NjYgKDIwMjYtMTEtMTgpOiBjb21wdXRhciBQUk9NRURJT19WRU5UQV8zTSBwb3IgU0tVIGRlc2RlIGdsb2JhbFBlZGlkb3NcbiAgLy8gKGxcdTAwRURuZWFzIGZhY3R1cmFkYXMgZW4gbG9zIFx1MDBGQWx0aW1vcyA5MCBkXHUwMEVEYXMgLyAzKS4gRnVlbnRlIGxvY2FsIHNpbiByZXF1ZXJpclxuICAvLyBhZ3JlZ2FkbyBCUTsgc2kgdW4gcGVkaWRvIG5vIHRpZW5lIGZlY2hhIGRlIGZhY3R1cmFjaVx1MDBGM24gdlx1MDBFMWxpZGEsIHNlIHNhbHRlYS5cbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICBjb25zdCBhdmczTUlkeCA9IG5ldyBNYXAoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IERBWV9NUyA9IDg2NDAwMDAwO1xuICAgIGNvbnN0IF9hcnJBbGwgPVxuICAgICAgdHlwZW9mIGdsb2JhbFBlZGlkb3MgIT09ICd1bmRlZmluZWQnICYmIEFycmF5LmlzQXJyYXkoZ2xvYmFsUGVkaWRvcykgPyBnbG9iYWxQZWRpZG9zIDogW107XG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHF0eVN1bTkwID0gbmV3IE1hcCgpO1xuICAgIGZvciAoY29uc3QgcCBvZiBfYXJyQWxsKSB7XG4gICAgICBpZiAoIXAgfHwgIUFycmF5LmlzQXJyYXkocC5saW5lcykpIGNvbnRpbnVlO1xuICAgICAgLy8gZmVjaGEgZGUgZmFjdHVyYWNpXHUwMEYzbiAvIGVudHJlZ2EgYWwgU0FQOiBwcmVmZXJpciBzYXBJbnZvaWNlRGF0ZSAvXG4gICAgICAvLyB0cmFuc2Zlcmlkb1NBUC5kb2NEYXRlIC8gY2xvc2VkQXQgLyBjb25maXJtZWRBdC5cbiAgICAgIGNvbnN0IF9yYXdEYXRlID1cbiAgICAgICAgKHAudHJhbnNmZXJpZG9TQVAgJiYgKHAudHJhbnNmZXJpZG9TQVAuZG9jRGF0ZSB8fCBwLnRyYW5zZmVyaWRvU0FQLmRhdGUpKSB8fFxuICAgICAgICBwLnNhcEludm9pY2VEYXRlIHx8XG4gICAgICAgIHAuY2xvc2VkQXQgfHxcbiAgICAgICAgcC5jb25maXJtZWRBdCB8fFxuICAgICAgICBudWxsO1xuICAgICAgaWYgKCFfcmF3RGF0ZSkgY29udGludWU7XG4gICAgICBsZXQgbXMgPSBudWxsO1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiBfcmF3RGF0ZSA9PT0gJ3N0cmluZycpIG1zID0gbmV3IERhdGUoX3Jhd0RhdGUpLmdldFRpbWUoKTtcbiAgICAgICAgZWxzZSBpZiAoX3Jhd0RhdGUgJiYgdHlwZW9mIF9yYXdEYXRlLnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgICBtcyA9IF9yYXdEYXRlLnRvRGF0ZSgpLmdldFRpbWUoKTtcbiAgICAgICAgZWxzZSBpZiAoX3Jhd0RhdGUgJiYgdHlwZW9mIF9yYXdEYXRlLnNlY29uZHMgPT09ICdudW1iZXInKSBtcyA9IF9yYXdEYXRlLnNlY29uZHMgKiAxMDAwO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIG1zID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGlmICghbXMgfHwgTnVtYmVyLmlzTmFOKG1zKSkgY29udGludWU7XG4gICAgICBpZiAobm93IC0gbXMgPiA5MCAqIERBWV9NUykgY29udGludWU7XG4gICAgICBmb3IgKGNvbnN0IGwgb2YgcC5saW5lcykge1xuICAgICAgICBpZiAoIWwgfHwgIWwuY29kZSkgY29udGludWU7XG4gICAgICAgIC8vIHYxNTY3ICgyMDI2LTExLTE4KTogZml4IFBST01FRElPX1ZFTlRBXzNNLiBTXHUwMEYzbG8gY3VlbnRvIHVuaWRhZGVzXG4gICAgICAgIC8vIFJFQUxNRU5URSBmYWN0dXJhZGFzIGVuIFNBUCAobC5xdHlJbnZvaWNlZCksIE5PIGwucXR5IChxdWUgaW5jbHV5ZVxuICAgICAgICAvLyBsbyBwZWRpZG8gcGVybyBubyBmYWN0dXJhZG8pLiBQYXRyXHUwMEYzbiBpZFx1MDBFOW50aWNvIGFsIGRlXG4gICAgICAgIC8vIHNyYy9kb21haW5zL3BsYW5uZXIvY29tcHV0ZS1jb2x1bW4uanM6MTYgKHJlZ2xhICdmYWN0dXJhcicpLlxuICAgICAgICAvLyBSZXBvcnRlIE1hcmlhbm8gMjAyNi0xMS0xODogU0tVIDAzMjczNyBtb3N0cmFiYSBwcm9tZWRpbz0zMyBzaW5cbiAgICAgICAgLy8gaGFiZXIgdHJhXHUwMEVEZG8gbmkgdmVuZGlkbyB1bmEgc29sYSB1bmlkYWQgKGNvbmZpcm1hZG8gZW4gUG93ZXJCSSkuXG4gICAgICAgIC8vIENhdXNhIHJhXHUwMEVEejogbGEgZlx1MDBGM3JtdWxhIHZpZWphIGNvbnRhYmEgbC5xdHkgY29uIHN0YXRlIT1CTy9BU0lHLFxuICAgICAgICAvLyBlcyBkZWNpciBzdW1hYmEgbFx1MDBFRG5lYXMgJ2NvbmZpcm1lZCcgKyAnY2FuY2VsbGVkJyBjb24gcXR5IHBlZGlkYS5cbiAgICAgICAgY29uc3QgcWkgPSBOdW1iZXIobC5xdHlJbnZvaWNlZCkgfHwgMDtcbiAgICAgICAgaWYgKHFpIDw9IDApIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBza3UgPSBTdHJpbmcobC5jb2RlKS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgICAgICAgcXR5U3VtOTAuc2V0KHNrdSwgKHF0eVN1bTkwLmdldChza3UpIHx8IDApICsgcWkpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBkaXZpZG8gcG9yIDMgbWVzZXMgXHUyMTkyIHByb21lZGlvIG1lbnN1YWxcbiAgICBmb3IgKGNvbnN0IFtza3UsIHRvdGFsXSBvZiBxdHlTdW05MCkge1xuICAgICAgYXZnM01JZHguc2V0KHNrdSwgTWF0aC5yb3VuZCgodG90YWwgLyAzKSAqIDEwKSAvIDEwKTtcbiAgICB9XG4gIH0gY2F0Y2ggKF9lQXZnKSB7XG4gICAgY29uc29sZS53YXJuKCdbYmFja29yZGVyXSBubyBzZSBwdWRvIGNvbXB1dGFyIFBST01FRElPX1ZFTlRBXzNNOicsIF9lQXZnICYmIF9lQXZnLm1lc3NhZ2UpO1xuICB9XG5cbiAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pn0gKi9cbiAgY29uc3Qgcm93c1NrdSA9IFtdO1xuICBmb3IgKGNvbnN0IFtza3UsIGFnZ10gb2Ygc2t1QWdnKSB7XG4gICAgcm93c1NrdS5wdXNoKHtcbiAgICAgIFNLVTogc2t1LFxuICAgICAgQ0FOVElEQURfQkFDS09SREVSOiBhZ2cucXR5LFxuICAgICAgU1VCVE9UQUw6IE1hdGgucm91bmQoYWdnLnN1YiksXG4gICAgICBQUk9NRURJT19WRU5UQV8zTTogYXZnM01JZHguZ2V0KFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSB8fCAwLFxuICAgIH0pO1xuICAgIHZvaWQgcmVzdW1lblJvd3M7XG4gIH1cbiAgcm93c1NrdS5zb3J0KChhLCBiKSA9PiAoYi5TVUJUT1RBTCB8fCAwKSAtIChhLlNVQlRPVEFMIHx8IDApKTtcbiAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBjb25zdCBmbmFtZSA9ICdCQUNLT1JERVJfJyArIHRvZGF5ICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbXG4gICAgeyBuYW1lOiAnQmFja29yZGVyX0NsaWVudGVzJywgcm93czogcm93c0NsaWVudGVzIH0sXG4gICAgeyBuYW1lOiAnQmFja29yZGVyX1NLVScsIHJvd3M6IHJvd3NTa3UgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeHBvcnQgQmFja29yZGVyIGxpc3RvICgnICtcbiAgICAgIChyb3dzLmxlbmd0aCAtIDEpICtcbiAgICAgICcgbGluZWFzICsgUmVzdW1lbiBjb24gdG90YWwgJCcgK1xuICAgICAgTWF0aC5yb3VuZCh0b3RhbFBlc29zTW9kYWwpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICcpJyxcbiAgICAzMDAwXG4gICk7XG59O1xuXG4vLyB2MTUxMSAoMjAyNi0xMC0yOCk6IGhhbmRsZXIgd2luZG93LmV4cG9ydFJlcGFydG9Ub0V4Y2VsIHJlbW92aWRvIGp1bnRvIGNvbiBlbFxuLy8gYm90b24gXCJFeHBvcnRhciByZXBvcnRlXCIgZGVsIG1vZGFsIFJlcGFydG8uIFJlZW1wbGF6YWRvIHBvciBlbCBmbG93IGVkaXRhYmxlXG4vLyBcIkV4cG9ydGFyIEV4Y2VsXCIgKyBcIkltcG9ydGFyIEV4Y2VsXCIgZGVsIFBSICMxMjczICh2MTUwNSkuXG4vLyBQcmVzZXJ2YWRvOiBzcmMvcHVyZS9yZXBhcnRvLWV4cG9ydC1yb3dzLmpzIChzaGFwZSBkZSByb3dzIGF1biB1c2FkbyBwb3Igb3Ryb3MgZXhwb3J0cykuXG5cbi8vIHY3Mzc6IFNOQVBTSE9UIEFDVFVBTCBkZSB0b2RvIGVsIFN0b2NrIEFzaWduYWRvIChzaW4gZmlsdHJvIGRlIG1lcykuIE1pc21vXG4vLyBtb3Rpdm8gcXVlIGV4cG9ydEJhY2tvcmRlckFsbC5cbndpbmRvdy5leHBvcnRTdG9ja0FzaWdBbGwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gZXhwb3J0IGRlIFN0b2NrIEFzaWduYWRvIChzbmFwc2hvdCBhY3R1YWwpLi4uJyk7XG4gIC8vIHYxMTAwICgyMDI2LTA5LTMwKTogbWlzbW8gbVx1MDBGM2R1bG8gcHVybyBxdWUgcmVuZGVyQmFja29yZGVyc1RhYiBlbiBtb2RvXG4gIC8vIGFzaWduYWNpb24uIEFob3JhIGVsIHJlcG9ydGUgY29pbmNpZGUgY29uIGVsIG1vZGFsOiBGSUZPIGNhcCBwb3IgZGlzcFNhcCxcbiAgLy8gZmlsdHJvIHZlbmNpZGFzIChBU0lHID4xNWQgZnVlcmEsIEFTSUcgc2luIHJlc2VydmEgdmlnZW50ZSBhZGVudHJvKSxcbiAgLy8gY29uZmlybWVkIGluY2x1aWRvLCBzaW4gbFx1MDBFRG5lYXMgXCJ2aXJ0dWFsX0FTSUdcIiBmYW50YXNtYS5cbiAgLy8gdjE1MzQ6IGFsY2FuY2UgcG9yIHJvbCAodmVuZGVkb3IgPSBjbGllbnRlcyBkZSBzdSBtYXN0ZXI7IGludGVybm8gPSBwYXJlamFzKS5cbiAgY29uc3QgYXJyID0gX2V4cG9ydFNjb3BlKCkuZmlsdGVyUGVkaWRvcyhcbiAgICB0eXBlb2YgZ2xvYmFsUGVkaWRvcyAhPT0gJ3VuZGVmaW5lZCcgJiYgQXJyYXkuaXNBcnJheShnbG9iYWxQZWRpZG9zKSA/IGdsb2JhbFBlZGlkb3MgOiBbXVxuICApO1xuICBjb25zdCB0b3RhbFBlZGlkb3NPcGVuID0gYXJyLmZpbHRlcigocCkgPT4gcCAmJiAhcC5jbG9zZWRBdCkubGVuZ3RoO1xuICAvKiogQHR5cGUgeyhwOiBhbnkpID0+IHN0cmluZ30gKi9cbiAgY29uc3QgX3Jlc29sdmVWZW5kb3JGYWxsYmFjayA9IChwKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuICcnO1xuICAgICAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KTtcbiAgICAgIGlmICh0eXBlb2Ygdy5jbGllbnRMb2NJZCAhPT0gJ2Z1bmN0aW9uJyB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZSB8fCAhdy5jbGllbnRNYXN0ZXJDYWNoZS5nZXQpXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGNtRG9jSWQgPSB3LmNsaWVudExvY0lkKHAucHJvdmluY2UgfHwgJycsIHAubG9jTmFtZSB8fCAnJywgcC5jbGllbnROYW1lIHx8ICcnKTtcbiAgICAgIGNvbnN0IGNtRGF0YSA9IHcuY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNtRG9jSWQpO1xuICAgICAgcmV0dXJuIChjbURhdGEgJiYgY21EYXRhLmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgdyA9IC8qKiBAdHlwZSB7YW55fSAqLyAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB7fSk7XG4gIGNvbnN0IGNvbXB1dGVGbiA9IHcuX19waGFzZTAgJiYgdy5fX3BoYXNlMC5wdXJlICYmIHcuX19waGFzZTAucHVyZS5jb21wdXRlQmFja29yZGVyUmF3TGluZXM7XG4gIGNvbnN0IHJhd0xpbmVzID0gY29tcHV0ZUZuXG4gICAgPyBjb21wdXRlRm4oXG4gICAgICAgIGFycixcbiAgICAgICAgJ2FzaWduYWNpb24nLFxuICAgICAgICB7fSxcbiAgICAgICAge1xuICAgICAgICAgIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhOlxuICAgICAgICAgICAgdHlwZW9mIHcuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicgPyB3LmdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIDogKCkgPT4gMCxcbiAgICAgICAgICBjYW5vblZlbmRvcjpcbiAgICAgICAgICAgIHR5cGVvZiB3Ll9jYW5vblZlbmRvciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICA/IHcuX2Nhbm9uVmVuZG9yXG4gICAgICAgICAgICAgIDogKHgpID0+XG4gICAgICAgICAgICAgICAgICBTdHJpbmcoeCB8fCAnJylcbiAgICAgICAgICAgICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgICAgICAgICAgICAudG9VcHBlckNhc2UoKSxcbiAgICAgICAgICBwcm9kdWN0czogQXJyYXkuaXNBcnJheSh3LlBST0RVQ1RTKSA/IHcuUFJPRFVDVFMgOiBbXSxcbiAgICAgICAgICByZXNvbHZlVmVuZG9yRmFsbGJhY2s6IF9yZXNvbHZlVmVuZG9yRmFsbGJhY2ssXG4gICAgICAgIH1cbiAgICAgIClcbiAgICA6IFtdO1xuICBjb25zdCBwZWRpZG9CeUlkID0ge307XG4gIGZvciAoY29uc3QgcCBvZiBhcnIpIGlmIChwICYmIHAuX2ZzSWQpIHBlZGlkb0J5SWRbcC5fZnNJZF0gPSBwO1xuICBjb25zdCByb3dzID0gW107XG4gIHJhd0xpbmVzLmZvckVhY2goKHJsKSA9PiB7XG4gICAgY29uc3QgYyA9IHJsLmNsaWVudGU7XG4gICAgY29uc3QgcCA9IGMucGVkaWRvSWQgPyBwZWRpZG9CeUlkW2MucGVkaWRvSWRdIDogbnVsbDtcbiAgICBjb25zdCBxdHkgPSBjLnF0eUFzaWduYWRhIHx8IDA7XG4gICAgbGV0IGZlY2hhUGVkaWRvID0gJyc7XG4gICAgaWYgKGMucGVkaWRvQ3JlYXRlZEF0KSB7XG4gICAgICBjb25zdCBkdCA9IGMucGVkaWRvQ3JlYXRlZEF0O1xuICAgICAgZmVjaGFQZWRpZG8gPVxuICAgICAgICB0eXBlb2YgZHQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBkdC5zbGljZSgwLCAxMClcbiAgICAgICAgICA6IG5ldyBEYXRlKGR0LnRvRGF0ZSA/IGR0LnRvRGF0ZSgpIDogZHQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICAgIH1cbiAgICBsZXQgbGluZWFJZHggPSAtMTtcbiAgICBpZiAocCAmJiBBcnJheS5pc0FycmF5KHAubGluZXMpKSB7XG4gICAgICBjb25zdCBpZHggPSBwLmxpbmVzLmZpbmRJbmRleChcbiAgICAgICAgKGwpID0+IGwgJiYgU3RyaW5nKGwuY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSA9PT0gcmwuc2t1ICYmIGwuc3RhdGUgPT09IGMuc3RhdGVcbiAgICAgICk7XG4gICAgICBpZiAoaWR4ID49IDApIGxpbmVhSWR4ID0gaWR4O1xuICAgIH1cbiAgICAvLyBFc3RhZG9fUmVhbDogaGlzdFx1MDBGM3JpY28gXCJCT19jb25fc3RvY2tfKHZpcnR1YWxfQVNJRylcIiB2cyBcIkFTSUdcIi4gdjExMDA6XG4gICAgLy8gYWhvcmEgYGNvbmZpcm1lZGAgdGFtYmlcdTAwRTluIGVudHJhICh2OTYyKS4gUHJlc2VydmFtb3MgZXRpcXVldGEgbGVnYWN5XG4gICAgLy8gcG9yIGNvbXBhdGliaWxpZGFkIGNvbiBxdWllbiBjb25zdW1lIGVsIEV4Y2VsLlxuICAgIGxldCBlc3RhZG9SZWFsID0gJ0FTSUcnO1xuICAgIGlmIChjLnN0YXRlID09PSAnQk8nKSBlc3RhZG9SZWFsID0gJ0JPX2Nvbl9zdG9ja18odmlydHVhbF9BU0lHKSc7XG4gICAgZWxzZSBpZiAoYy5zdGF0ZSA9PT0gJ2NvbmZpcm1lZCcpIGVzdGFkb1JlYWwgPSAnY29uZmlybWVkIChTUSBlbiBTQVApJztcbiAgICByb3dzLnB1c2goe1xuICAgICAgRmVjaGFfUGVkaWRvOiBmZWNoYVBlZGlkbyxcbiAgICAgIE1lczogKHAgJiYgcC5tb250aCkgfHwgJycsXG4gICAgICBDbGllbnRlOiBjLm5vbWJyZSB8fCAnJyxcbiAgICAgIENhcmRDb2RlOiBjLmNvZGUgfHwgKHAgJiYgcC5jbGllbnRDYXJkQ29kZSkgfHwgJycsXG4gICAgICBQcm92aW5jaWE6IGMucHJvdmluY2lhIHx8IChwICYmIHAucHJvdmluY2UpIHx8ICcnLFxuICAgICAgTG9jYWxpZGFkOiBjLmNpdWRhZCB8fCAocCAmJiBwLmxvY05hbWUpIHx8ICcnLFxuICAgICAgVmVuZGVkb3I6IGMudmVuZG9yS2V5IHx8ICcnLFxuICAgICAgU0tVOiBybC5za3UgfHwgJycsXG4gICAgICBQcm9kdWN0bzogcmwucHJvZHVjdG8gfHwgJycsXG4gICAgICBDYW50aWRhZF9SZXNlcnZhZGE6IHF0eSxcbiAgICAgIEVzdGFkb19SZWFsOiBlc3RhZG9SZWFsLFxuICAgICAgUHJlY2lvX1VuaXRfQVJTOiBjLnByZWNpbyB8fCAwLFxuICAgICAgU3VidG90YWxfUmVzZXJ2YWRvX0FSUzogTWF0aC5yb3VuZChxdHkgKiAoYy5wcmVjaW8gfHwgMCkpLFxuICAgICAgUGVkaWRvX0lEOiBjLnBlZGlkb0lkIHx8ICcnLFxuICAgICAgTGluZWFfSWR4OiBsaW5lYUlkeCxcbiAgICAgIFNRX0RvY051bTogYy5zcURvY051bSB8fCAnJyxcbiAgICAgIE9yaWdlbjogKHAgJiYgcC5taWdyYXRpb25Tb3VyY2UpIHx8ICdhcHAnLFxuICAgICAgLy8gdjExMDA6IGNvbnRleHRvIFx1MDBGQXRpbCBwYXJhIGRlYnVnZ2luZyBwYXJpZGFkIG1vZGFsXHUyMTk0cmVwb3J0ZS5cbiAgICAgIFN0b2NrX0Rpc3BfU0tVOiBybC5kaXNwU2FwIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydChcbiAgICAgICdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gdmFjaW8uIERpYWdub3N0aWNvOlxcbicgK1xuICAgICAgICAnLSBUb3RhbCBwZWRpZG9zIGVuIGdsb2JhbFBlZGlkb3M6ICcgK1xuICAgICAgICBhcnIubGVuZ3RoICtcbiAgICAgICAgJ1xcbicgK1xuICAgICAgICAnLSBQZWRpZG9zIGFiaWVydG9zIChzaW4gY2xvc2VkQXQpOiAnICtcbiAgICAgICAgdG90YWxQZWRpZG9zT3BlbiArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJy0gTGluZWFzIHBvc3QtRklGTyt2ZW5jaWRhcyBjb24gcXR5QXNpZ25hZGE+MDogMFxcblxcbicgK1xuICAgICAgICAnUG9zaWJsZXMgY2F1c2FzOlxcbicgK1xuICAgICAgICAnMS4gTm8gaGF5IHN0b2NrIGFzaWduYWRvIGFob3JhIG1pc21vXFxuJyArXG4gICAgICAgICcyLiBUb2RvcyBsb3MgQVNJRyBlc3RhbiB2ZW5jaWRvcyAoPjE1ZCBkZXNkZSBhc2lnQXQpXFxuJyArXG4gICAgICAgICczLiBMb3MgcGVkaWRvcyB0aWVuZW4gY2xvc2VkQXQgc2V0ZWFkbydcbiAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZzogMCBsaW5lYXMgKHZlciBhbGVydGEpJywgMzAwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSk7XG4gIGNvbnN0IHRvZGF5ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgY29uc3QgZm5hbWUgPSAnU2hpbWFub19TdG9ja0FzaWduYWRvX1NuYXBzaG90XycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW3sgbmFtZTogJ1N0b2NrIEFzaWduYWRvJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgU3RvY2sgQXNpZ25hZG8gbGlzdG8gKCcgKyByb3dzLmxlbmd0aCArICcgbGluZWFzKScsIDI0MDApO1xufTtcblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBudWV2byBleHBvcnQgXCJQZW5kaWVudGUgZGUgQXNpZ25hY2lcdTAwRjNuIC0gUGFibG9cIi4gTGlzdGFcbi8vIGxvcyByZXBhcnRvcyBhYmllcnRvcyAoaW5ncmVzb3NfcmVwYXJ0byBwZW5kaW5nL2luX3Byb2dyZXNzKSBwb3IgU0tVICtcbi8vIGNsaWVudGVzIGVuIGNvbGEuIFJlZW1wbGF6YSBzZW1cdTAwRTFudGljYW1lbnRlIGFsIHZpZWpvIFwiU3RvY2sgQXNpZ25hZG9cIiBlbiBlbFxuLy8gbW9kYWwgKGVsIHZpZWpvIHBhc2EgYSBcIlN0b2NrIEFzaWduYWRvIC0gbFx1MDBFRG5lYXNcIiBjb21vIGF1eGlsaWFyKS5cbi8vIERvcyBob2phczpcbi8vICAgUmVzdW1lbiByZXBhcnRvIFx1MjAxNCB1bmEgZmlsYSBwb3IgZG9jIGluZ3Jlc29zX3JlcGFydG8uXG4vLyAgIENsaWVudGVzIGVuIGNvbGEgXHUyMDE0IHVuYSBmaWxhIHBvciBjbGllbnRlIEJPIGRlIGNhZGEgcmVwYXJ0by5cbndpbmRvdy5leHBvcnRQZW5kaWVudGVEZUFzaWduYWNpb25QYWJsbyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgUGVuZGllbnRlIGRlIEFzaWduYWNpXHUwMEYzbiAtIFBhYmxvLi4uJyk7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCBmYkRiID0gdy5mYkRiO1xuICBpZiAoIWZiRGIpIHtcbiAgICBhbGVydCgnRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkby4gUmVpbnRlbnRcdTAwRTEgZW4gdW5vcyBzZWd1bmRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gMS4gUmVwYXJ0b3MgYWJpZXJ0b3MuXG4gIGxldCByZXBhcnRvc0RvY3M7XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdpbmdyZXNvc19yZXBhcnRvJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJ2luJywgWydwZW5kaW5nJywgJ2luX3Byb2dyZXNzJ10pXG4gICAgICAuZ2V0KCk7XG4gICAgcmVwYXJ0b3NEb2NzID0gc25hcC5kb2NzO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yIGNhcmdhbmRvIGluZ3Jlc29zX3JlcGFydG86ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFyZXBhcnRvc0RvY3MgfHwgcmVwYXJ0b3NEb2NzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFsZXJ0KCdObyBoYXkgcmVwYXJ0b3MgcGVuZGluZy9pbl9wcm9ncmVzcyBhaG9yYSBtaXNtby4nKTtcbiAgICBzaG93U3luY1RhZygnRXhwb3J0IFBhYmxvOiAwIHJlcGFydG9zJywgMjQwMCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIDIuIFNuYXBzaG90IHN0b2NrICsgZ2V0U3RvY2tCcmVha2Rvd24gcG9yIFNLVS5cbiAgY29uc3Qgc3RvY2tTbmFwID1cbiAgICB0eXBlb2Ygdy5nZXRTdG9ja1NuYXBzaG90ID09PSAnZnVuY3Rpb24nXG4gICAgICA/IHcuZ2V0U3RvY2tTbmFwc2hvdCgpXG4gICAgICA6IHcuX3N0b2NrU25hcHNob3RDYWNoZSB8fCB7IHdhcmVob3VzZUJyZWFrZG93bjoge30gfTtcbiAgY29uc3Qgd2hzID1cbiAgICB0eXBlb2Ygc3RvY2tTbmFwLndhcmVob3VzZUJyZWFrZG93biA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duKVxuICAgICAgOiBzdG9ja1NuYXAud2FyZWhvdXNlQnJlYWtkb3duIHx8IHt9O1xuICBjb25zdCBwZWRpZG9zID0gQXJyYXkuaXNBcnJheSh3Lmdsb2JhbFBlZGlkb3MpID8gdy5nbG9iYWxQZWRpZG9zIDogW107XG4gIGNvbnN0IHdhaXRsaXN0RW50cmllcyA9XG4gICAgdHlwZW9mIHcuX2dldFdhaXRsaXN0Q3BzdEVudHJpZXMgPT09ICdmdW5jdGlvbicgPyB3Ll9nZXRXYWl0bGlzdENwc3RFbnRyaWVzKCkgOiBbXTtcbiAgY29uc3QgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyA9IHJlcGFydG9zRG9jcy5tYXAoKGQpID0+XG4gICAgT2JqZWN0LmFzc2lnbih7IF9mc0lkOiBkLmlkIH0sIGQuZGF0YSgpIHx8IHt9KVxuICApO1xuICBjb25zdCBnZXRCcmVha2Rvd24gPSB3Ll9fcGhhc2UwICYmIHcuX19waGFzZTAucHVyZSAmJiB3Ll9fcGhhc2UwLnB1cmUuZ2V0U3RvY2tCcmVha2Rvd247XG4gIC8vIDMuIFJlc29sdmVyIHByb2R1Y3RvIHBvciBTS1UuXG4gIGNvbnN0IHByb2RCeVNrdSA9IG5ldyBNYXAoKTtcbiAgY29uc3QgUFJPRFVDVFMgPSBBcnJheS5pc0FycmF5KHcuUFJPRFVDVFMpID8gdy5QUk9EVUNUUyA6IFtdO1xuICBmb3IgKGNvbnN0IHAgb2YgUFJPRFVDVFMpIHtcbiAgICBpZiAocCAmJiBwLnNrdSkgcHJvZEJ5U2t1LnNldChTdHJpbmcocC5za3UpLnRvVXBwZXJDYXNlKCksIHApO1xuICB9XG4gIGNvbnN0IG5vd01zID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgcmVzdW1lblJvd3MgPSBbXTtcbiAgY29uc3QgY29sYVJvd3MgPSBbXTtcbiAgZm9yIChjb25zdCBkb2Mgb2YgcmVwYXJ0b3NEb2NzKSB7XG4gICAgY29uc3QgZGF0YSA9IGRvYy5kYXRhKCkgfHwge307XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKGRhdGEuc2t1IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IHByb2QgPSBwcm9kQnlTa3UuZ2V0KHNrdSkgfHwgbnVsbDtcbiAgICBjb25zdCBmaXNpY29EZXAxMSA9IE51bWJlcigod2hzW3NrdV0gJiYgd2hzW3NrdV1bJzExJ10pIHx8IDApO1xuICAgIGNvbnN0IHF0eUluZ3Jlc2FkYSA9IE51bWJlcihkYXRhLnF0eUluZ3Jlc2FkYSB8fCAwKTtcbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IEFycmF5LmlzQXJyYXkoZGF0YS5hc3NpZ25tZW50cykgPyBkYXRhLmFzc2lnbm1lbnRzIDogW107XG4gICAgbGV0IHF0eVlhQXNpZ25hZGEgPSAwO1xuICAgIGZvciAoY29uc3QgYSBvZiBhc3NpZ25tZW50cykgcXR5WWFBc2lnbmFkYSArPSBOdW1iZXIoKGEgJiYgYS5xdHlBc2lnbmFkYSkgfHwgMCk7XG4gICAgbGV0IHF0eUFSZXBhcnRpciA9IE1hdGgubWF4KDAsIHF0eUluZ3Jlc2FkYSAtIHF0eVlhQXNpZ25hZGEpO1xuICAgIGlmIChnZXRCcmVha2Rvd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJrID0gZ2V0QnJlYWtkb3duKFxuICAgICAgICAgIHNrdSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBnZXRTdG9ja0Zpc2ljbzogKCkgPT4gZmlzaWNvRGVwMTEsXG4gICAgICAgICAgICBwZWRpZG9zLFxuICAgICAgICAgICAgd2FpdGxpc3RFbnRyaWVzLFxuICAgICAgICAgICAgaW5ncmVzb3NSZXBhcnRvQWN0aXZvcyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgbm93OiBub3dNcyB9XG4gICAgICAgICk7XG4gICAgICAgIGlmIChiayAmJiBiay5yZXBhcnRvQWJpZXJ0byAmJiB0eXBlb2YgYmsucmVwYXJ0b0FiaWVydG8ucXR5ID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIHF0eUFSZXBhcnRpciA9IGJrLnJlcGFydG9BYmllcnRvLnF0eTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgLyogZmFsbGJhY2sgYSBjXHUwMEUxbGN1bG8gbG9jYWwgKi9cbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY2xpZW50ZXNCTyA9IEFycmF5LmlzQXJyYXkoZGF0YS5jbGllbnRlc0JPKSA/IGRhdGEuY2xpZW50ZXNCTyA6IFtdO1xuICAgIGxldCBkZXRlY3RlZEF0ID0gZGF0YS5kZXRlY3RlZEF0IHx8ICcnO1xuICAgIGlmIChkZXRlY3RlZEF0ICYmIHR5cGVvZiBkZXRlY3RlZEF0LnRvRGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZGV0ZWN0ZWRBdCA9IGRldGVjdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAgIGRldGVjdGVkQXQgPSAnJztcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgYm9Ub3RhbFF0eSA9IGNsaWVudGVzQk8ucmVkdWNlKChzLCBjKSA9PiBzICsgTnVtYmVyKGMucXR5QmFja29yZGVyIHx8IDApLCAwKTtcbiAgICByZXN1bWVuUm93cy5wdXNoKHtcbiAgICAgIFJlcGFydG9fSUQ6IGRvYy5pZCxcbiAgICAgIFNLVTogc2t1LFxuICAgICAgUHJvZHVjdG86IChwcm9kICYmIChwcm9kLm5hbWUgfHwgcHJvZC5kZXNjcmlwdGlvbikpIHx8ICcnLFxuICAgICAgRmlzaWNvX0RlcDExOiBmaXNpY29EZXAxMSxcbiAgICAgIFF0eV9JbmdyZXNhZGE6IHF0eUluZ3Jlc2FkYSxcbiAgICAgIFF0eV9ZYV9Bc2lnbmFkYTogcXR5WWFBc2lnbmFkYSxcbiAgICAgIFF0eV9BX1JlcGFydGlyOiBxdHlBUmVwYXJ0aXIsXG4gICAgICBDbGllbnRlc19Fbl9Db2xhOiBjbGllbnRlc0JPLmxlbmd0aCxcbiAgICAgIEJPX1RvdGFsX1F0eTogYm9Ub3RhbFF0eSxcbiAgICAgIERldGVjdGVkQXQ6IHR5cGVvZiBkZXRlY3RlZEF0ID09PSAnc3RyaW5nJyA/IGRldGVjdGVkQXQuc2xpY2UoMCwgMTkpLnJlcGxhY2UoJ1QnLCAnICcpIDogJycsXG4gICAgICBTdGF0dXM6IGRhdGEuc3RhdHVzIHx8ICcnLFxuICAgIH0pO1xuICAgIGZvciAoY29uc3QgYyBvZiBjbGllbnRlc0JPKSB7XG4gICAgICBsZXQgZmVjaGFQZWQgPSBjLnBlZGlkb0NyZWF0ZWRBdCB8fCAnJztcbiAgICAgIGlmIChmZWNoYVBlZCAmJiB0eXBlb2YgZmVjaGFQZWQudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZmVjaGFQZWQgPSBmZWNoYVBlZC50b0RhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAgIGZlY2hhUGVkID0gJyc7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFZlbmRlZG9yOiBidXNjYXIgZW4gZ2xvYmFsUGVkaWRvcyBwb3IgcGVkaWRvSWQuXG4gICAgICBsZXQgdmVuZGVkb3IgPSBjLnZlbmRvcktleSB8fCAnJztcbiAgICAgIGlmICghdmVuZGVkb3IgJiYgYy5wZWRpZG9JZCkge1xuICAgICAgICBjb25zdCBwID0gcGVkaWRvcy5maW5kKCh4KSA9PiB4ICYmIHguX2ZzSWQgPT09IGMucGVkaWRvSWQpO1xuICAgICAgICBpZiAocCkgdmVuZGVkb3IgPSBwLm93bmVyVmVuZG9yIHx8IHAudmVuZG9yQXNzaWduZWQgfHwgJyc7XG4gICAgICB9XG4gICAgICBjb2xhUm93cy5wdXNoKHtcbiAgICAgICAgUmVwYXJ0b19JRDogZG9jLmlkLFxuICAgICAgICBTS1U6IHNrdSxcbiAgICAgICAgQ2xpZW50ZTogYy5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBDYXJkQ29kZTogYy5jbGllbnRDYXJkQ29kZSB8fCAnJyxcbiAgICAgICAgUHJvdmluY2lhOiBjLmNsaWVudFByb3ZpbmNlIHx8ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6IGMuY2xpZW50TG9jYWxpdHkgfHwgJycsXG4gICAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcbiAgICAgICAgUXR5X0JPOiBOdW1iZXIoYy5xdHlCYWNrb3JkZXIgfHwgMCksXG4gICAgICAgIEZlY2hhX1BlZGlkb19PcmlnaW5hbDogdHlwZW9mIGZlY2hhUGVkID09PSAnc3RyaW5nJyA/IGZlY2hhUGVkLnNsaWNlKDAsIDEwKSA6ICcnLFxuICAgICAgICBQZWRpZG9fSUQ6IGMucGVkaWRvSWQgfHwgJycsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmVzdW1lblJvd3Muc29ydCgoYSwgYikgPT4gYi5RdHlfQV9SZXBhcnRpciAtIGEuUXR5X0FfUmVwYXJ0aXIpO1xuICBjb2xhUm93cy5zb3J0KFxuICAgIChhLCBiKSA9PlxuICAgICAgKGEuU0tVIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuU0tVIHx8ICcnKSB8fFxuICAgICAgKGEuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGFfUGVkaWRvX09yaWdpbmFsIHx8ICcnKVxuICApO1xuICBjb25zdCB0b2RheSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGNvbnN0IGZuYW1lID0gJ1NoaW1hbm9fUGVuZGllbnRlRGVBc2lnbmFjaW9uX1BhYmxvXycgKyB0b2RheSArICcueGxzeCc7XG4gIGRvd25sb2FkWGxzeChmbmFtZSwgW1xuICAgIHsgbmFtZTogJ1Jlc3VtZW4gcmVwYXJ0bycsIHJvd3M6IHJlc3VtZW5Sb3dzIH0sXG4gICAgeyBuYW1lOiAnQ2xpZW50ZXMgZW4gY29sYScsIHJvd3M6IGNvbGFSb3dzIH0sXG4gIF0pO1xuICBzaG93U3luY1RhZyhcbiAgICAnRXhwb3J0IFBhYmxvOiAnICsgcmVzdW1lblJvd3MubGVuZ3RoICsgJyByZXBhcnRvcyAvICcgKyBjb2xhUm93cy5sZW5ndGggKyAnIGNsaWVudGVzIGVuIGNvbGEnLFxuICAgIDI4MDBcbiAgKTtcbn07XG5cbi8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXN1ZWx2ZSBub21icmUgZGUgZmFudGFzaWEgcGFyYSB1biBwZWRpZG8gdXNhbmRvIGVsXG4vLyBtaXNtbyBwYXR0ZXJuIHF1ZSBsYXMgY2FyZHMgZGVsIG1hcGEgKGluZGV4Lmh0bWw6OTkxNS05OTM1KTpcbi8vICAgMSkgY2xpZW50TWV0YVtjYXJkQ29kZV0uY3VzdG9tRmFudGFzaWEgKGVkaXRhZG8gZGVzZGUgZWwgbW9kYWwgY2xpZW50ZSlcbi8vICAgMikgYXBwcm92ZWRBbHRhc0xpc3RbXS5mYW50YXNpYSBtYXRjaGVhZG8gcG9yIGNvbWVyY2lvID09IGNsaWVudE5hbWVcbmZ1bmN0aW9uIF9yZXNvbHZlRmFudGFzaWFGb3JQZWRpZG8ocCkge1xuICBjb25zdCBjYXJkQ29kZSA9IFN0cmluZyhwLmNsaWVudENhcmRDb2RlIHx8ICcnKS50cmltKCk7XG4gIGlmIChjYXJkQ29kZSkge1xuICAgIGNvbnN0IG1ldGEgPSAvKiogQHR5cGUge2FueX0gKi8gKGdsb2JhbFRoaXMpLmNsaWVudE1ldGE7XG4gICAgY29uc3QgY3VzdG9tID0gbWV0YSAmJiBtZXRhW2NhcmRDb2RlXSAmJiBtZXRhW2NhcmRDb2RlXS5jdXN0b21GYW50YXNpYTtcbiAgICBpZiAoY3VzdG9tICYmIFN0cmluZyhjdXN0b20pLnRyaW0oKSkgcmV0dXJuIFN0cmluZyhjdXN0b20pLnRyaW0oKTtcbiAgfVxuICBjb25zdCBhbHRhcyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoZ2xvYmFsVGhpcykuYXBwcm92ZWRBbHRhc0xpc3Q7XG4gIGlmIChBcnJheS5pc0FycmF5KGFsdGFzKSkge1xuICAgIGNvbnN0IG5hbWVMb3dlciA9IFN0cmluZyhwLmNsaWVudE5hbWUgfHwgJycpXG4gICAgICAudHJpbSgpXG4gICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobmFtZUxvd2VyKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGFsdGFzLmZpbmQoKGEpID0+IHtcbiAgICAgICAgaWYgKCFhKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGNvbnN0IGMgPSBTdHJpbmcoYS5jb21lcmNpbyB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGYgPSBTdHJpbmcoYS5mYW50YXNpYSB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIHJldHVybiBjID09PSBuYW1lTG93ZXIgfHwgZiA9PT0gbmFtZUxvd2VyO1xuICAgICAgfSk7XG4gICAgICBpZiAobWF0Y2ggJiYgbWF0Y2guZmFudGFzaWEgJiYgU3RyaW5nKG1hdGNoLmZhbnRhc2lhKS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhtYXRjaC5mYW50YXNpYSkudHJpbSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gJyc7XG59XG5cbi8vIHYxMjMzICgyMDI2LTEwLTA5KTogcmVwb3J0ZSBcIlZlbnRhcyB4IGFydGljdWxvIHggY2xpZW50ZS92ZW5kZWRvclwiIHZpYSBDRi5cbi8vIEFkbWluL2dlcmVudGUgb25seS4gVGFyZGEgfjMwLTYwcyAoQlEgcXVlcnkgKyBleGNlbGpzIGJ1aWxkIHNlcnZlci1zaWRlKS5cbmFzeW5jIGZ1bmN0aW9uIF9leHBvcnRWZW50YXNBcnRDbGlGb3JNb250aChhbmlvLCBtb250aElkeCkge1xuICBpZiAobW9udGhJZHggPT09IG51bGwgfHwgbW9udGhJZHggPT09IHVuZGVmaW5lZCkge1xuICAgIGFsZXJ0KCdFbGVnXHUwMEVEIHVuIE1FUyBlc3BlY1x1MDBFRGZpY28gKG5vIFwiVG9kbyBlbCBhXHUwMEYxb1wiKSBcdTIwMTQgZXN0ZSByZXBvcnRlIGVzIG1lbnN1YWwuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIG1vbnRoSWR4IHZpZW5lIDAtYmFzZWQgZGVzZGUgZWwgcGlja2VyIChlbmU9MCkuIENGIGVzcGVyYSAxLWJhc2VkLlxuICBjb25zdCBtb250aCA9IG1vbnRoSWR4ICsgMTtcbiAgY29uc3QgeWVhciA9IGFuaW87XG4gIGNvbnN0IHBlcmlvZG8gPSAod2luZG93Lk1FU0VTID8gd2luZG93Lk1FU0VTW21vbnRoSWR4XSA6IG1vbnRoKSArICcgJyArIHllYXI7XG4gIGNvbnN0IGNvbmZpcm1Nc2cgPVxuICAgICdHZW5lcmFyIHJlcG9ydGUgXCJWRU5UQVMgeCBBUlRJQ1VMTyB4IENMSUVOVEUvVkVOREVET1JcIiBkZSAnICtcbiAgICBwZXJpb2RvICtcbiAgICAnP1xcblxcbicgK1xuICAgICdGdWVudGU6IFNBUCB2aWEgQmlnUXVlcnkgKGRhdG9zIGV4YWN0b3MpLlxcbicgK1xuICAgICdQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuXFxuJyArXG4gICAgJ0FsIHRlcm1pbmFyIHNlIGRlc2NhcmdhIGF1dG9tYXRpY2FtZW50ZSBlbCB4bHN4Lic7XG4gIGlmICghY29uZmlybShjb25maXJtTXNnKSkgcmV0dXJuO1xuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIHJlcG9ydGUgc2VydmVyLXNpZGUgKEJRKS4uLiBwdWVkZSB0YXJkYXIgfjYwcycpO1xuICB0cnkge1xuICAgIC8vIHYxMDAwIHBhdHRlcm46IHJlZnJlc2ggSURUb2tlbiBhbnRlcyBkZSBjYWxsYWJsZSBjcml0aWNvLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCB1ID0gd2luZG93LmZpcmViYXNlLmF1dGggJiYgd2luZG93LmZpcmViYXNlLmF1dGgoKS5jdXJyZW50VXNlcjtcbiAgICAgIGlmICh1ICYmIHUuZ2V0SWRUb2tlbikgYXdhaXQgdS5nZXRJZFRva2VuKHRydWUpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIGNvbnN0IGNhbGxhYmxlID0gd2luZG93LmZpcmViYXNlXG4gICAgICAuYXBwKClcbiAgICAgIC5mdW5jdGlvbnMoJ3NvdXRoYW1lcmljYS1lYXN0MScpXG4gICAgICAuaHR0cHNDYWxsYWJsZSgnZ2VuZXJhdGVWZW50YXNSZXBvcnRDRicpO1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBjYWxsYWJsZSh7IHllYXIsIG1vbnRoIH0pO1xuICAgIGNvbnN0IHIgPSAocmVzcCAmJiByZXNwLmRhdGEpIHx8IHt9O1xuICAgIGlmICghci5vayB8fCAhci5ieXRlc0Jhc2U2NCkge1xuICAgICAgYWxlcnQoJ0NGIGRldm9sdmlvIGVycm9yOiAnICsgKHIuZXJyb3IgfHwgSlNPTi5zdHJpbmdpZnkocikpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gRGVjb2RlIGJhc2U2NCBcdTIxOTIgQmxvYiBcdTIxOTIgZG93bmxvYWQgdHJpZ2dlci5cbiAgICBjb25zdCBiaW4gPSBhdG9iKHIuYnl0ZXNCYXNlNjQpO1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluLmxlbmd0aCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW4ubGVuZ3RoOyBpKyspIGJ5dGVzW2ldID0gYmluLmNoYXJDb2RlQXQoaSk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtieXRlc10sIHtcbiAgICAgIHR5cGU6IHIubWltZVR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPVxuICAgICAgci5maWxlbmFtZSB8fFxuICAgICAgJ3ZlbnRhc194X2FydGljdWxvX2NsaWVudGVfJyArIHllYXIgKyAnLScgKyBTdHJpbmcobW9udGgpLnBhZFN0YXJ0KDIsICcwJykgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICAgICAgYS5yZW1vdmUoKTtcbiAgICB9LCAxMDAwKTtcbiAgICBjb25zdCBzdGF0cyA9IHIuc3RhdHMgfHwge307XG4gICAgc2hvd1N5bmNUYWcoXG4gICAgICAnT0s6ICcgK1xuICAgICAgICAoc3RhdHMudmVudGFzIHx8IDApICtcbiAgICAgICAgJyB2ZW50YXMgLyAnICtcbiAgICAgICAgKHN0YXRzLml0ZW1zIHx8IDApICtcbiAgICAgICAgJyBTS1VzIC8gJyArXG4gICAgICAgIChzdGF0cy5jbGllbnRzIHx8IDApICtcbiAgICAgICAgJyBjbGllbnRlcydcbiAgICApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW2V4cG9ydFZlbnRhc0FydENsaV0gZXJyb3InLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIHJlcG9ydGU6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkpKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBleHBvcnRQZWRpZG9zTWVzRm9yTW9udGgoYW5pbywgbW9udGhJZHgpIHtcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBleHBvcnQgZGUgUGVkaWRvcyBkZWwgbWVzLi4uJyk7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgY29uc3Qgc2NvcGUgPSBfZXhwb3J0U2NvcGUoKTtcbiAgY29uc3QgcGVkaWRvcyA9IF9pdGVyYXRlUGVkaWRvc01lcyhhbmlvLCBtb250aElkeCwgc2NvcGUpO1xuICBmb3IgKGNvbnN0IHAgb2YgcGVkaWRvcykge1xuICAgIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShwLmxpbmVzKSA/IHAubGluZXMgOiBbXTtcbiAgICBpZiAoIWxpbmVzLmxlbmd0aCkgY29udGludWU7XG4gICAgY29uc3QgZmVjaGEgPSBwLmNyZWF0ZWRBdFxuICAgICAgPyB0eXBlb2YgcC5jcmVhdGVkQXQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gcC5jcmVhdGVkQXQuc2xpY2UoMCwgMTApXG4gICAgICAgIDogbmV3IERhdGUocC5jcmVhdGVkQXQudG9EYXRlID8gcC5jcmVhdGVkQXQudG9EYXRlKCkgOiBwLmNyZWF0ZWRBdClcbiAgICAgICAgICAgIC50b0lTT1N0cmluZygpXG4gICAgICAgICAgICAuc2xpY2UoMCwgMTApXG4gICAgICA6ICcnO1xuICAgIC8vIHY5NzUgKDIwMjYtMDktMTcpOiByZXNvbHZlciBmYW50YXNpYSB1bmEgdmV6IHBvciBwZWRpZG8gKG5vIHBvciBsaW5lYSkgXHUyMDE0XG4gICAgLy8gZWwgbG9va3VwIGVuIGNsaWVudE1ldGEgKyBhcHByb3ZlZEFsdGFzTGlzdCBlcyBjb25zdGFudGUgcGFyYSB0b2RvIGVsIHBlZGlkby5cbiAgICBjb25zdCBub21icmVMb2NhbEZhbnRhc2lhID0gX3Jlc29sdmVGYW50YXNpYUZvclBlZGlkbyhwKTtcbiAgICBsaW5lcy5mb3JFYWNoKChsLCBpZHgpID0+IHtcbiAgICAgIGlmICghbCkgcmV0dXJuO1xuICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGwucXR5KSB8fCAwO1xuICAgICAgY29uc3QgcHJlY2lvID0gTnVtYmVyKGwucHJpY2VBdENyZWF0aW9uIHx8IGwucHJlY2lvIHx8IDApO1xuICAgICAgLy8gdjE1NjUgKDIwMjYtMTEtMTgpOiA4IGNvbHVtbmFzIGV4YWN0YXMgcG9yIHBlZGlkbyBNYXJpYW5vLlxuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgRkVDSEFfREVfUEVESURPOiBmZWNoYSxcbiAgICAgICAgQ0xJRU5URTogcC5jbGllbnROYW1lIHx8ICcnLFxuICAgICAgICBJRF9QRURJRE86IHAuX2ZzSWQgfHwgJycsXG4gICAgICAgIFNLVTogbC5jb2RlIHx8ICcnLFxuICAgICAgICBOT01CUkVfREVMX1BST0RVQ1RPOiBsLmRlc2MgfHwgbC5uYW1lIHx8ICcnLFxuICAgICAgICBDQU5USURBRDogcXR5LFxuICAgICAgICBTVUJUT1RBTDogTWF0aC5yb3VuZChxdHkgKiBwcmVjaW8pLFxuICAgICAgICBMT0NBTElEQUQ6IHAubG9jTmFtZSB8fCAnJyxcbiAgICAgIH0pO1xuICAgICAgLy8gdjE1NjU6IG5vbWJyZUxvY2FsRmFudGFzaWEgKyBpZHggc2lndWVuIGNvbXB1dGFkb3MgKG5vIGV4cG9ydGFkb3MpLlxuICAgICAgdm9pZCBub21icmVMb2NhbEZhbnRhc2lhO1xuICAgICAgdm9pZCBpZHg7XG4gICAgICB2b2lkIHNjb3BlO1xuICAgIH0pO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gKGEuRkVDSEFfREVfUEVESURPIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRkVDSEFfREVfUEVESURPIHx8ICcnKSk7XG4gIGNvbnN0IGZuYW1lID0gJ1BFRElET1MgREVMIE1FU18nICsgcGVyaW9kTGFiZWwoYW5pbywgbW9udGhJZHgpICsgJy54bHN4JztcbiAgZG93bmxvYWRYbHN4KGZuYW1lLCBbeyBuYW1lOiAnUEVESURPUyBERUwgTUVTJywgcm93cyB9XSk7XG4gIHNob3dTeW5jVGFnKCdFeHBvcnQgUGVkaWRvcyBkZWwgbWVzIGxpc3RvICgnICsgcm93cy5sZW5ndGggKyAnIGxpbmVhcyknLCAyNDAwKTtcbn1cblxuLy8gRXhwb3J0YXIgcGFyYSBBbmFsaXNpczogcHJvdGVnaWRvIGNvbiBQSU5cbmNvbnN0IEFOQUxJU0lTX1BJTiA9ICcxMjM1Jztcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhwb3J0IEV4Y2VsIFRBUkdFVFMtWk9OQVMgLSBzb2xvIGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmEgbGEgaG9qYSBDTElFTlRFU19aT05BUyBjb24gVU5BIGZpbGEgcG9yIEJQIHF1ZSBlc3RhIHZpdm8gZW4gU0FQOlxuLy8gY3VhbHF1aWVyIGFsdGEgZGUgY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgWSBjYXJkQ29kZVNhcFxuLy8gYXNpZ25hZG8uIEV4Y2x1eWUgUE9JTlRTIC8gZGlzdHJpYnVpZG9yZXMgLyBwcm9zcGVjdG9zIC8gYWx0YXMgc2luXG4vLyBDYXJkQ29kZSAobW9ja3MgbyBwZW5kaWVudGVzIGRlIFNBUCkuIEVzIGxvIHF1ZSBlZmVjdGl2YW1lbnRlIHNlIGZhY3R1cmEuXG4vLyBDb2x1bW5hczogVElQTywgTlJPIENURSwgUkVHSU9OLCBQUk9WSU5DSUEsIEFTRVNPUiBFWFRFUk5PLCBBU0VTT1IgSU5URVJOTyxcbi8vIENBTExFLCBOVU1FUk8sIExPQ0FMSURBRCwgQ1AsIE5PTUJSRSBDT01FUkNJQUwsIE5PTUJSRSBERSBGQU5UQVNJQSwgQ1VJVCxcbi8vIENPTkRJQ0lPTiBGSVNDQUwsIFRFTEVGT05PLCBDQVJEQ09ERSBTQVAuXG53aW5kb3cuZXhwb3J0VGFyZ2V0c1pvbmFzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmljXHUwMEUxIHR1IGNvbmV4aVx1MDBGM24geSByZWludGVudFx1MDBFMS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZXhwb3J0YXIgZWwgbWFzdGVyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIFRBUkdFVFMtWk9OQVMuLi4nKTtcbiAgY29uc3QgVkRFX1RPX1ZESSA9IHtcbiAgICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJzogJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAgICdHT05aQUxPIERFIExBIFJPU0EnOiAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXG4gICAgJ01BVVJJQ0lPIEdJTCc6ICdTQU5USUFHTyBFU1RFQkFOJyxcbiAgICBQQUNISTogJ1NBTlRJQUdPIEVTVEVCQU4nLFxuICB9O1xuICBmdW5jdGlvbiByZWdpb25PZihwcm92KSB7XG4gICAgY29uc3QgcCA9IChwcm92IHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChbJ0JVRU5PUyBBSVJFUycsICdDQVBJVEFMIEZFREVSQUwnLCAnTEEgUEFNUEEnXS5pbmNsdWRlcyhwKSkgcmV0dXJuICdCVUVOT1MgQUlSRVMnO1xuICAgIGlmIChbJ0NPUkRPQkEnLCAnU0FOIExVSVMnLCAnTUVORE9aQScsICdTQU4gSlVBTicsICdMQSBSSU9KQSddLmluY2x1ZGVzKHApKSByZXR1cm4gJ0NVWU8nO1xuICAgIGlmIChbJ1NBTlRBIEZFJywgJ0VOVFJFIFJJT1MnLCAnQ0hBQ08nLCAnQ09SUklFTlRFUycsICdNSVNJT05FUycsICdGT1JNT1NBJ10uaW5jbHVkZXMocCkpXG4gICAgICByZXR1cm4gJ05FQSc7XG4gICAgaWYgKFsnSlVKVVknLCAnU0FMVEEnLCAnVFVDVU1BTicsICdDQVRBTUFSQ0EnLCAnU0FOVElBR08gREVMIEVTVEVSTyddLmluY2x1ZGVzKHApKSByZXR1cm4gJ05PQSc7XG4gICAgaWYgKFsnTkVVUVVFTicsICdSSU8gTkVHUk8nLCAnQ0hVQlVUJywgJ1NBTlRBIENSVVonLCAnVElFUlJBIERFTCBGVUVHTyddLmluY2x1ZGVzKHApKVxuICAgICAgcmV0dXJuICdQQVRBR09OSUEnO1xuICAgIHJldHVybiAnJztcbiAgfVxuICBmdW5jdGlvbiB2ZW5kb3JMYWJlbEZvckV4Y2VsKGtleSkge1xuICAgIGlmICgha2V5KSByZXR1cm4gJyc7XG4gICAgaWYgKGtleSA9PT0gJ19fRElTVFJJQlVUT1JfXycpIHJldHVybiAnRElTVFJJQlVJRE9SRVMnO1xuICAgIHJldHVybiBrZXk7XG4gIH1cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBsZXQgYWx0YXNTbmFwO1xuICB0cnkge1xuICAgIGFsdGFzU25hcCA9IGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz09JywgJ2FwcHJvdmVkJylcbiAgICAgIC5nZXQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGFsdGFzIGFwcm9iYWRhczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgc2tpcHBlZE5vU2FwID0gMDtcbiAgYWx0YXNTbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBhID0gZC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgY2FyZENvZGUgPSAoYS5jYXJkQ29kZVNhcCB8fCAnJykudHJpbSgpO1xuICAgIC8vIEZpbHRybyBjbGF2ZTogc29sbyBCUHMgY29uIENhcmRDb2RlIFNBUCBhc2lnbmFkbyAoPSBoYWJpbGl0YWRvIGVuIFNBUCkuXG4gICAgaWYgKCFjYXJkQ29kZSkge1xuICAgICAgc2tpcHBlZE5vU2FwKys7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByb3ZpbmNlID0gKGEucHJvdmluY2lhIHx8ICcnKS50b1VwcGVyQ2FzZSgpLnRyaW0oKTtcbiAgICBjb25zdCBsb2NhbGl0eUZpbmFsID0gYS5sb2NhbGlkYWRGaW5hbCB8fCBhLmxvY2FsaWRhZCB8fCAnJztcbiAgICBjb25zdCB2ZW5kb3IgPSBhLmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUSVBPOiAnREFETyBERSBBTFRBJyxcbiAgICAgICdOUk8gQ1RFJzogMCwgLy8gc2UgcmVudW1lcmEgZGVzcHVlcyBkZWwgc29ydFxuICAgICAgUkVHSU9OOiByZWdpb25PZihwcm92aW5jZSksXG4gICAgICBQUk9WSU5DSUE6IHByb3ZpbmNlLFxuICAgICAgJ0FTRVNPUiBFWFRFUk5PJzogdmVuZG9yTGFiZWxGb3JFeGNlbCh2ZW5kb3IpLFxuICAgICAgJ0FTRVNPUiBJTlRFUk5PJzogVkRFX1RPX1ZESVt2ZW5kb3JdIHx8ICcnLFxuICAgICAgQ0FMTEU6IGEuY2FsbGUgfHwgJycsXG4gICAgICBOVU1FUk86IGEubnVtZXJvIHx8ICcnLFxuICAgICAgTE9DQUxJREFEOiBsb2NhbGl0eUZpbmFsLFxuICAgICAgQ1A6IGEuY3AgfHwgJycsXG4gICAgICAnTk9NQlJFIENPTUVSQ0lBTCc6IGEuY29tZXJjaW8gfHwgYS50aXR1bGFyIHx8ICcnLFxuICAgICAgJ05PTUJSRSBERSBGQU5UQVNJQSc6IGEuZmFudGFzaWEgfHwgJycsXG4gICAgICBDVUlUOiBhLmN1aXQgfHwgJycsXG4gICAgICAnQ09ORElDSU9OIEZJU0NBTCc6IGEuY29uZGljaW9uRmlzY2FsIHx8ICcnLFxuICAgICAgVEVMRUZPTk86IGEudGVsZWZvbm8gfHwgJycsXG4gICAgICAnQ0FSRENPREUgU0FQJzogY2FyZENvZGUsXG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IGNsaWVudGVzIGhhYmlsaXRhZG9zIGVuIFNBUCB0b2RhdmlhLlxcblxcblVuYSBhbHRhIGVudHJhIGFsIGV4cG9ydCBzb2xvIGN1YW5kbyB0aWVuZSBDYXJkQ29kZSBTQVAgYXNpZ25hZG8uJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJvd3Muc29ydCgocjEsIHIyKSA9PiB7XG4gICAgY29uc3QgcCA9IChyMS5QUk9WSU5DSUEgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuUFJPVklOQ0lBIHx8ICcnKTtcbiAgICBpZiAocCAhPT0gMCkgcmV0dXJuIHA7XG4gICAgY29uc3QgbCA9IChyMS5MT0NBTElEQUQgfHwgJycpLmxvY2FsZUNvbXBhcmUocjIuTE9DQUxJREFEIHx8ICcnKTtcbiAgICBpZiAobCAhPT0gMCkgcmV0dXJuIGw7XG4gICAgcmV0dXJuIChyMVsnTk9NQlJFIENPTUVSQ0lBTCddIHx8ICcnKS5sb2NhbGVDb21wYXJlKHIyWydOT01CUkUgQ09NRVJDSUFMJ10gfHwgJycpO1xuICB9KTtcbiAgcm93cy5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgclsnTlJPIENURSddID0gaSArIDE7XG4gIH0pO1xuICAvLyB2MTA5MCAoMjAyNi0wOS0yOSk6IHJlZmFjdG9yIGEgZG93bmxvYWRYbHN4IChlc3RpbG8gdmVyZGUgdW5pZm9ybWUpLlxuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRvd25sb2FkWGxzeCgnVEFSR0VUU19WRU5ERURPUkVTX1pPTkFTXycgKyB0cyArICcueGxzeCcsIFtcbiAgICB7IG5hbWU6ICdDTElFTlRFU19aT05BUycsIHJvd3MgfSxcbiAgXSk7XG4gIHNob3dTeW5jVGFnKFxuICAgICdFeGNlbCBleHBvcnRhZG86ICcgK1xuICAgICAgcm93cy5sZW5ndGggK1xuICAgICAgJyBjbGllbnRlcyBTQVAgaGFiaWxpdGFkb3MnICtcbiAgICAgIChza2lwcGVkTm9TYXAgPiAwID8gJyAoJyArIHNraXBwZWROb1NhcCArICcgc2luIENhcmRDb2RlIGRlc2NhcnRhZG9zKScgOiAnJylcbiAgKTtcbn07XG5cbndpbmRvdy5vcGVuRXhwb3J0QW5hbGlzaXMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwaW4gPSBwcm9tcHQoXG4gICAgJ0VzdGEgc2VjY2lvbiBjb250aWVuZSBmb3JtYXRvcyBhdmFuemFkb3MgKFBvd2VyIEJJLCBQeXRob24vTUwsIFpJUCBkZSBmb3RvcykgZGVzdGluYWRvcyBhIGFuYWxpc2lzIHRlY25pY28uXFxuXFxuSW5ncmVzYSBlbCBQSU4gcGFyYSBjb250aW51YXI6J1xuICApO1xuICBpZiAocGluID09PSBudWxsKSByZXR1cm47XG4gIGlmIChwaW4gIT09IEFOQUxJU0lTX1BJTikge1xuICAgIGFsZXJ0KCdQSU4gaW5jb3JyZWN0by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3BjaW9uIEludGVncmFjaW9uIFNBUDogc29sbyBwYXJhIE1hcmlhbm8gKGVyYmlub21hcmlhbm9AZ21haWwuY29tKVxuICBjb25zdCBzYXBPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1zYXAtaW50ZWdyYXRpb24nKTtcbiAgaWYgKHNhcE9wdCkge1xuICAgIGNvbnN0IGlzTWFyaWFubyA9XG4gICAgICBjdXJyZW50VXNlciAmJiAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSc7XG4gICAgc2FwT3B0LnN0eWxlLmRpc3BsYXkgPSBpc01hcmlhbm8gPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPcGNpb24gQmFja3VwIG1lbnN1YWw6IHNvbG8gYWRtaW5cbiAgY29uc3QgYmtPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1iYWNrdXAtbWVuc3VhbCcpO1xuICBpZiAoYmtPcHQpIGJrT3B0LnN0eWxlLmRpc3BsYXkgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyA/ICcnIDogJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZUV4cG9ydEFuYWxpc2lzID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWFuYWxpc2lzLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbi8vIEhlbHBlcnMgaW50ZXJub3MgKGRvd25sb2FkWGxzeCwgZXhwb3J0VmVudGFzRm9yTW9udGgsIGV0Yy4pIHNvbiBjb25zdW1pZG9zXG4vLyBzb2xvIGRlbnRybyBkZSBlc3RlIGJsb3F1ZSAodmVyaWZpY2FkbyBwcmUtZXh0cmFjY2lcdTAwRjNuKS5cblxuLy8gdjEzOTYgKDIwMjYtMTAtMjEpOiBhdmlzbyBhbCBjbGljayBwYXJhIFwiVmVudGFzIFx1MDBENyBhcnRcdTAwRURjdWxvIFx1MDBENyBjbGllbnRlXCIuXG4vLyBBZG1pbi9nZXJlbnRlIG9ubHkuIFRhcmRhIDMwLTYwcy4gQW50ZXMgbGEgbm90YSBlc3RhYmEgZW4gbGEgZGVzY3JpcGNpXHUwMEYzbiBkZWxcbi8vIGxpc3RhZG8gZGVsIG1vZGFsOyBhaG9yYSBlbCBsaXN0YWRvIHNvbG8gbXVlc3RyYSBpY29ubyArIHRpdHVsby5cbndpbmRvdy5fdmVudGFzQXJ0Q2xpQ2xpY2sgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHcgPSAvKiogQHR5cGUge2FueX0gKi8gKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnID8gd2luZG93IDoge30pO1xuICBjb25zdCByb2xlID0gdy51c2VyUm9sZSB8fCAnJztcbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ0VzdGUgcmVwb3J0ZSBlcyBzb2xvIHBhcmEgYWRtaW4gLyBnZXJlbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBvayA9IGNvbmZpcm0oXG4gICAgJ1JlcG9ydGUgc2VydmVyLXNpZGUgKEJpZ1F1ZXJ5KS4gVGFyZGEgMzAtNjAgc2VndW5kb3MgeSBkZXNjYXJnYSB1biAueGxzeCBjb24gNCBob2phczpcXG4nICtcbiAgICAgICcgIFx1MjAyMiBQcm9kdWN0b3MgdmVuZGlkb3MgcG9yIFZERVxcbicgK1xuICAgICAgJyAgXHUyMDIyIFByb2R1Y3RvcyBOTyB2ZW5kaWRvcyBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgQ09OIGNvbXByYSBwb3IgVkRFXFxuJyArXG4gICAgICAnICBcdTIwMjIgQ2xpZW50ZXMgU0lOIGNvbXByYSBwb3IgVkRFXFxuXFxuJyArXG4gICAgICAnQ29udGludWFyPydcbiAgKTtcbiAgaWYgKCFvaykgcmV0dXJuO1xuICBpZiAodHlwZW9mIHcuY2xvc2VFeHBvcnREaWFsb2cgPT09ICdmdW5jdGlvbicpIHcuY2xvc2VFeHBvcnREaWFsb2coKTtcbiAgaWYgKHR5cGVvZiB3LnNob3dNb250aFBpY2tlciA9PT0gJ2Z1bmN0aW9uJykgdy5zaG93TW9udGhQaWNrZXIoJ1ZFTlRBU19BUlRfQ0xJJyk7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBd0RPLFdBQVMsY0FBYyxHQUFHO0FBQy9CLFdBQU8sT0FBTyxLQUFLLEVBQUUsRUFDbEIsS0FBSyxFQUNMLFlBQVk7QUFBQSxFQUNqQjtBQVNBLFdBQVMsYUFBYSxHQUFHLFNBQVM7QUFDaEMsUUFBSSxDQUFDLEtBQUssT0FBTyxZQUFZLFdBQVksUUFBTyxFQUFFLFdBQVcsSUFBSSxRQUFRLGVBQWU7QUFDeEYsUUFBSTtBQUNGLFlBQU0sSUFBSSxRQUFRLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxHQUFHLE9BQU8sRUFBRSxjQUFjLEVBQUUsQ0FB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
