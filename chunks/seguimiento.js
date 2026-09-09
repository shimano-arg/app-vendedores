"use strict";
(() => {
  // src/domains/seguimiento.js
  if (typeof window.unsubSegNotes === "undefined") window.unsubSegNotes = null;
  if (typeof window.unsubSegStatus === "undefined") window.unsubSegStatus = null;
  var segVisitsCache = [];
  var segNotesCache = [];
  var segStatusCache = {};
  var segCurrentTab = "resumen";
  var currentSegTimelineKey = null;
  var _segDebounceTimer = null;
  function segPedidoVendor(p) {
    if (!p) return "";
    if (p.vendor) return p.vendor;
    if (p.assignedVendor) return p.assignedVendor;
    if (typeof getVendorForKey === "function" && p.key) return getVendorForKey(p.key);
    return "";
  }
  function isContacto(v) {
    return !!(v && v.interactionType === "contacto");
  }
  window.openSeguimientoModal = async function() {
    if (!canViewSeguimiento()) {
      alert("Tu rol no tiene acceso a Seguimiento.");
      return;
    }
    const set = getSeguimientoExternalSet();
    if (!set.size) {
      alert(
        'Todavia no tenes vendedores externos asignados.\n\nSi sos vendedor interno (Santiago / Ioannis), pedile al admin que en Panel Usuarios -> tu VDE -> "Pareja interno" te asocie como pareja.'
      );
      return;
    }
    document.getElementById("seguimiento-modal").classList.add("open");
    populateSegFilters();
    const desdeEl = document.getElementById("seg-fdesde");
    const hastaEl = document.getElementById("seg-fhasta");
    if (desdeEl && !desdeEl.value) {
      const now = /* @__PURE__ */ new Date();
      const desde = new Date(now.getFullYear(), now.getMonth(), 1);
      desdeEl.value = desde.toISOString().slice(0, 10);
      hastaEl.value = now.toISOString().slice(0, 10);
    }
    document.getElementById("seg-content").innerHTML = '<div class="seg-empty">Cargando datos...</div>';
    await loadSegVisits();
    attachSegNotesListener();
    attachSegStatusListener();
    setSeguimientoTab(segCurrentTab);
  };
  window.closeSeguimientoModal = function() {
    document.getElementById("seguimiento-modal").classList.remove("open");
  };
  function populateSegFilters() {
    const set = getSeguimientoExternalSet();
    const sel = document.getElementById("seg-fvendor");
    if (!sel) return;
    const cur = sel.value || "ALL";
    const opts = ['<option value="ALL">Todos</option>'].concat(
      [...set].sort().map(
        (v) => '<option value="' + escapeAttr(v) + '">' + escapeHtml(displayVendorName(v)) + "</option>"
      )
    );
    sel.innerHTML = opts.join("");
    sel.value = set.has(cur) || cur === "ALL" ? cur : "ALL";
    sel.onchange = () => renderSeguimientoTab();
    document.getElementById("seg-fdesde").onchange = () => {
      loadSegVisits().then(() => renderSeguimientoTab());
    };
    document.getElementById("seg-fhasta").onchange = () => {
      loadSegVisits().then(() => renderSeguimientoTab());
    };
    const cli = document.getElementById("seg-fcliente");
    cli.oninput = function() {
      if (_segDebounceTimer) clearTimeout(_segDebounceTimer);
      _segDebounceTimer = setTimeout(() => renderSeguimientoTab(), 300);
    };
    document.getElementById("seg-festado").onchange = () => renderSeguimientoTab();
  }
  async function loadSegVisits() {
    const set = getSeguimientoExternalSet();
    if (!set.size || !fbDb) {
      segVisitsCache = [];
      return;
    }
    try {
      const list = [...set];
      const qs = await fbDb.collection("visits").where("vendor", "in", list).get();
      segVisitsCache = [];
      qs.forEach((d) => segVisitsCache.push(Object.assign({ id: d.id }, d.data())));
    } catch (e) {
      console.error("[Seguimiento] error cargando visitas:", e);
      segVisitsCache = [];
      if (e && e.code === "permission-denied") {
        alert(
          "Tu rol no tiene permisos en Firestore para leer las visitas del scope.\n\nEl admin tiene que actualizar las rules para permitir a interno/gerente leer visits de sus VDEs asignados."
        );
      }
    }
  }
  function attachSegNotesListener() {
    if (window.unsubSegNotes) {
      window.unsubSegNotes();
      window.unsubSegNotes = null;
    }
    const set = getSeguimientoExternalSet();
    if (!set.size || !fbDb) return;
    try {
      window.unsubSegNotes = fbDb.collection("seguimiento_notes").where("vendorExt", "in", [...set]).onSnapshot(
        (qs) => {
          segNotesCache = [];
          qs.forEach((d) => segNotesCache.push(Object.assign({ id: d.id }, d.data())));
          if (currentSegTimelineKey) openSegTimeline(currentSegTimelineKey);
        },
        (err) => console.warn("[Seguimiento] notes listener", err)
      );
    } catch (e) {
      console.warn("[Seguimiento] notes attach", e);
    }
  }
  function attachSegStatusListener() {
    if (window.unsubSegStatus) {
      window.unsubSegStatus();
      window.unsubSegStatus = null;
    }
    const set = getSeguimientoExternalSet();
    if (!set.size || !fbDb) return;
    try {
      window.unsubSegStatus = fbDb.collection("seguimiento_status").where("vendorExt", "in", [...set]).onSnapshot(
        (qs) => {
          segStatusCache = {};
          qs.forEach((d) => {
            const dd = d.data() || {};
            if (dd.clientKey) segStatusCache[dd.clientKey] = dd.status || "";
          });
          renderSeguimientoTab();
        },
        (err) => console.warn("[Seguimiento] status listener", err)
      );
    } catch (e) {
      console.warn("[Seguimiento] status attach", e);
    }
  }
  window.setSeguimientoTab = function(tab) {
    segCurrentTab = tab;
    document.querySelectorAll(".seg-tab").forEach((b) => b.classList.toggle("active", b.dataset.segTab === tab));
    renderSeguimientoTab();
  };
  function getSegFilters() {
    return {
      vendor: document.getElementById("seg-fvendor").value || "ALL",
      desde: document.getElementById("seg-fdesde").value || "",
      hasta: document.getElementById("seg-fhasta").value || "",
      cliente: (document.getElementById("seg-fcliente").value || "").toLowerCase().trim(),
      estado: document.getElementById("seg-festado").value || "ALL",
      soloPend: !!document.getElementById("seg-fpend").checked
    };
  }
  function getSegDataset() {
    const set = getSeguimientoExternalSet();
    const f = getSegFilters();
    const inScope = (v) => set.has(v);
    const inDate = (d) => {
      if (!d) return true;
      if (f.desde && d < f.desde) return false;
      if (f.hasta && d > f.hasta) return false;
      return true;
    };
    const matchVendor = (v) => f.vendor === "ALL" ? true : v === f.vendor;
    const matchCliente = (name) => f.cliente ? (name || "").toLowerCase().includes(f.cliente) : true;
    const visits = (segVisitsCache || []).filter((v) => {
      if (!inScope(v.vendor)) return false;
      if (!matchVendor(v.vendor)) return false;
      if (!inDate((v.fecha || "").slice(0, 10))) return false;
      if (!matchCliente(v.tienda)) return false;
      return true;
    });
    const pedidos = (globalPedidos || []).map((p) => Object.assign({}, p, { vendor: segPedidoVendor(p) })).filter((p) => {
      if (!inScope(p.vendor)) return false;
      if (!matchVendor(p.vendor)) return false;
      const dt = (p.confirmedAt || "").slice(0, 10) || (p.finalizedAt || "").slice(0, 10) || "";
      if (!inDate(dt)) return false;
      if (!matchCliente(p.clientName)) return false;
      return true;
    });
    return { visits, pedidos };
  }
  function buildSegAggregates(visits, pedidos) {
    const set = getSeguimientoExternalSet();
    const byVendor = {};
    set.forEach((v) => {
      byVendor[v] = {
        visits: 0,
        // solo presenciales (interactionType != 'contacto')
        contactos: 0,
        // v443: no presenciales (WhatsApp/tel/email)
        pedidos: 0,
        facturacion: 0,
        pendientesPedidos: 0,
        lastActivity: "",
        clientsActive: /* @__PURE__ */ new Set(),
        clientsVisited: /* @__PURE__ */ new Set()
      };
    });
    visits.forEach((v) => {
      const b = byVendor[v.vendor];
      if (!b) return;
      if (isContacto(v)) b.contactos++;
      else b.visits++;
      if (v.tienda) b.clientsVisited.add(v.tienda + "|" + (v.localidad || ""));
      const d = (v.fecha || "").slice(0, 10);
      if (d && d > b.lastActivity) b.lastActivity = d;
    });
    pedidos.forEach((p) => {
      const b = byVendor[p.vendor];
      if (!b) return;
      b.pedidos++;
      const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs != null ? p.subtotalArs : 0;
      if (p.stage === "confirmed") b.facturacion += +amt || 0;
      if (p.stage === "pending") b.pendientesPedidos++;
      if (p.clientName) b.clientsActive.add(p.clientName + "|" + (p.locName || ""));
      const d = (p.confirmedAt || "").slice(0, 10) || (p.finalizedAt || "").slice(0, 10);
      if (d && d > b.lastActivity) b.lastActivity = d;
    });
    return byVendor;
  }
  function segMakeKey(vendor, prov, loc, name) {
    return [vendor || "", prov || "", loc || "", name || ""].join("|");
  }
  function detectSegPendientes(visits, pedidos) {
    const items = [];
    const byClient = {};
    visits.forEach((v) => {
      const k = segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda);
      if (!byClient[k])
        byClient[k] = {
          vendor: v.vendor,
          prov: v.provincia,
          loc: v.localidad,
          name: v.tienda,
          visits: [],
          orders: []
        };
      byClient[k].visits.push(v);
    });
    pedidos.forEach((p) => {
      const k = segMakeKey(p.vendor, p.province, p.locName, p.clientName);
      if (!byClient[k])
        byClient[k] = {
          vendor: p.vendor,
          prov: p.province,
          loc: p.locName,
          name: p.clientName,
          visits: [],
          orders: []
        };
      byClient[k].orders.push(p);
    });
    Object.entries(byClient).forEach(([k, c]) => {
      if (!c.visits.length) return;
      const hasConfirmed = c.orders.some((o) => o.stage === "confirmed");
      if (hasConfirmed) return;
      if (segStatusCache[k] === "resuelto") return;
      const latestV = c.visits.map((v) => v.fecha || "").sort().pop();
      const daysAgo = latestV ? Math.floor((Date.now() - new Date(latestV).getTime()) / 864e5) : 0;
      if (daysAgo >= 7) {
        items.push({
          kind: "visit-no-order",
          clientKey: k,
          client: c.name,
          vendor: c.vendor,
          prov: c.prov,
          loc: c.loc,
          problema: "Visitado sin pedido hace " + daysAgo + " dias",
          accion: "Contactar y ofrecer cierre",
          ultimaAccion: "Visita: " + latestV,
          status: daysAgo > 14 ? "red" : "yellow"
        });
      }
    });
    pedidos.forEach((p) => {
      if (p.stage !== "pending") return;
      const dt = (p.finalizedAt || "").slice(0, 10) || (p.confirmedAt || "").slice(0, 10) || "";
      const daysAgo = dt ? Math.floor((Date.now() - new Date(dt).getTime()) / 864e5) : 0;
      items.push({
        kind: "pedido-pending",
        pedidoFsId: p._fsId || "",
        clientKey: segMakeKey(p.vendor, p.province, p.locName, p.clientName),
        client: p.clientName,
        vendor: p.vendor,
        prov: p.province,
        loc: p.locName,
        problema: "Pedido pendiente de confirmar" + (daysAgo ? " hace " + daysAgo + " dias" : ""),
        accion: "Revisar stock y llamar al cliente",
        ultimaAccion: "Pedido: " + (dt || "(s/f)"),
        status: daysAgo >= 5 ? "red" : "yellow"
      });
    });
    return items;
  }
  function detectSegSinMovimiento(visits, pedidos) {
    const map = {};
    visits.forEach((v) => {
      const k = segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda);
      if (!map[k])
        map[k] = {
          vendor: v.vendor,
          prov: v.provincia,
          loc: v.localidad,
          name: v.tienda,
          lastV: "",
          lastO: "",
          facturacion: 0
        };
      if ((v.fecha || "") > map[k].lastV) map[k].lastV = v.fecha;
    });
    pedidos.forEach((p) => {
      const k = segMakeKey(p.vendor, p.province, p.locName, p.clientName);
      if (!map[k])
        map[k] = {
          vendor: p.vendor,
          prov: p.province,
          loc: p.locName,
          name: p.clientName,
          lastV: "",
          lastO: "",
          facturacion: 0
        };
      const dt = (p.confirmedAt || "").slice(0, 10);
      if (p.stage === "confirmed" && dt > map[k].lastO) map[k].lastO = dt;
      if (p.stage === "confirmed") {
        const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
        map[k].facturacion += +amt || 0;
      }
    });
    const out = [];
    Object.entries(map).forEach(([k, c]) => {
      const lastVdays = c.lastV ? Math.floor((Date.now() - new Date(c.lastV).getTime()) / 864e5) : Infinity;
      const lastOdays = c.lastO ? Math.floor((Date.now() - new Date(c.lastO).getTime()) / 864e5) : Infinity;
      if (lastVdays > 30 && lastOdays > 45) {
        const lastDays = Math.min(lastVdays, lastOdays);
        out.push({
          clientKey: k,
          client: c.name,
          vendor: c.vendor,
          prov: c.prov,
          loc: c.loc,
          lastVisit: c.lastV || "-",
          lastOrder: c.lastO || "-",
          daysAgo: Number.isFinite(lastDays) ? lastDays : "999+",
          facturacion: c.facturacion,
          accion: c.facturacion > 0 ? "Recontactar - cliente con historial" : "Recontactar - puede ser oportunidad",
          status: c.facturacion > 1e5 && lastDays > 60 ? "red" : "yellow"
        });
      }
    });
    return out.sort((a, b) => (b.facturacion || 0) - (a.facturacion || 0));
  }
  function detectSegOportunidades(visits, _pedidos) {
    const items = [];
    const keys = [
      "interesad",
      "potencial",
      "cierre",
      "reposici",
      "oferta",
      "descuento",
      "volver",
      "cotiz"
    ];
    visits.forEach((v) => {
      const txt = ((v.comentario || "") + " " + (v.observaciones || "")).toLowerCase();
      if (keys.some((kw) => txt.includes(kw))) {
        items.push({
          clientKey: segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda),
          client: v.tienda,
          vendor: v.vendor,
          prov: v.provincia,
          loc: v.localidad,
          problema: 'Comentario comercial: "' + (v.comentario || v.observaciones || "").slice(0, 80) + '"',
          accion: "Coordinar cierre con el VDE",
          ultimaAccion: "Visita: " + (v.fecha || "-"),
          status: "yellow"
        });
      }
    });
    return items;
  }
  function buildSegDuplas(visits, pedidos) {
    const externalToInternal = {};
    Object.entries(VENDOR_INCLUDES_OTHERS).forEach(
      ([interno, ext]) => ext.forEach((e) => externalToInternal[e] = interno)
    );
    const duplas = {};
    const ensure = (interno, externo) => {
      const k = interno + " + " + externo;
      if (!duplas[k])
        duplas[k] = {
          interno,
          externo,
          visitas: 0,
          pedidos: 0,
          pedidosConf: 0,
          fact: 0,
          clientes: /* @__PURE__ */ new Set(),
          pendientes: 0,
          lastAct: ""
        };
      return duplas[k];
    };
    visits.forEach((v) => {
      const interno = externalToInternal[v.vendor];
      if (!interno) return;
      const d = ensure(interno, v.vendor);
      d.visitas++;
      if (v.tienda) d.clientes.add(v.tienda + "|" + (v.localidad || ""));
      const dt = (v.fecha || "").slice(0, 10);
      if (dt > d.lastAct) d.lastAct = dt;
    });
    pedidos.forEach((p) => {
      const interno = externalToInternal[p.vendor];
      if (!interno) return;
      const d = ensure(interno, p.vendor);
      d.pedidos++;
      if (p.stage === "confirmed") {
        d.pedidosConf++;
        const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
        d.fact += +amt || 0;
      } else if (p.stage === "pending") d.pendientes++;
      if (p.clientName) d.clientes.add(p.clientName + "|" + (p.locName || ""));
      const dt = (p.confirmedAt || "").slice(0, 10);
      if (dt > d.lastAct) d.lastAct = dt;
    });
    return duplas;
  }
  window.renderSeguimientoTab = function() {
    if (!canViewSeguimiento()) {
      document.getElementById("seg-content").innerHTML = '<div class="seg-empty">Sin permisos.</div>';
      return;
    }
    const { visits, pedidos } = getSegDataset();
    renderSegTopStats(visits, pedidos);
    const pendientes = detectSegPendientes(visits, pedidos);
    const dead = detectSegSinMovimiento(visits, pedidos);
    const opps = detectSegOportunidades(visits, pedidos);
    document.getElementById("seg-count-visitas").textContent = visits.length;
    document.getElementById("seg-count-pedidos").textContent = pedidos.length;
    document.getElementById("seg-count-pendientes").textContent = pendientes.length;
    document.getElementById("seg-count-dead").textContent = dead.length;
    document.getElementById("seg-count-opp").textContent = opps.length;
    const tab = segCurrentTab || "resumen";
    const f = getSegFilters();
    const filterByEstado = (arr) => f.estado === "ALL" ? arr : arr.filter((x) => x.status === f.estado);
    let html = "";
    if (tab === "resumen") html = renderSegResumen(visits, pedidos);
    else if (tab === "visitas") {
      let rows = visits.slice();
      if (f.soloPend) {
        const pendSet = new Set(pendientes.map((p) => p.clientKey));
        rows = rows.filter(
          (v) => pendSet.has(segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda))
        );
      }
      html = renderSegVisitas(rows);
    } else if (tab === "pedidos") {
      let rows = pedidos.slice();
      if (f.soloPend) rows = rows.filter((p) => p.stage === "pending");
      html = renderSegPedidos(rows);
    } else if (tab === "pendientes") html = renderSegPendientes(filterByEstado(pendientes));
    else if (tab === "dead") html = renderSegDead(filterByEstado(dead));
    else if (tab === "opp") html = renderSegOpps(filterByEstado(opps));
    else if (tab === "duplas") html = renderSegDuplas(buildSegDuplas(visits, pedidos));
    document.getElementById("seg-content").innerHTML = html;
  };
  function renderSegTopStats(visits, pedidos) {
    let fact = 0, conf = 0, _pend = 0, lastAct = "";
    pedidos.forEach((p) => {
      if (p.stage === "confirmed") {
        conf++;
        const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
        fact += +amt || 0;
      } else if (p.stage === "pending") _pend++;
      const dt = (p.confirmedAt || "").slice(0, 10) || (p.finalizedAt || "").slice(0, 10);
      if (dt > lastAct) lastAct = dt;
    });
    visits.forEach((v) => {
      const d = (v.fecha || "").slice(0, 10);
      if (d > lastAct) lastAct = d;
    });
    const pendientes = detectSegPendientes(visits, pedidos);
    const dead = detectSegSinMovimiento(visits, pedidos);
    const opps = detectSegOportunidades(visits, pedidos);
    const visitasPres = visits.filter((v) => !isContacto(v)).length;
    const contactos = visits.filter(isContacto).length;
    const conv = visits.length > 0 ? Math.round(conf / visits.length * 100) : 0;
    const fmtMon = (n) => "$" + Math.round(n).toLocaleString("es-AR");
    const html = '<div class="seg-stat visitas"><div class="num">' + visitasPres + '</div><div class="lbl">Visitas</div></div><div class="seg-stat contactos"><div class="num">' + contactos + '</div><div class="lbl">Contactos</div></div><div class="seg-stat pedidos"><div class="num">' + pedidos.length + '</div><div class="lbl">Pedidos</div></div><div class="seg-stat fact"><div class="num">' + fmtMon(fact) + '</div><div class="lbl">Facturado</div></div><div class="seg-stat pend"><div class="num">' + pendientes.length + '</div><div class="lbl">Pendientes</div></div><div class="seg-stat opp"><div class="num">' + opps.length + '</div><div class="lbl">Oportunidades</div></div><div class="seg-stat dead"><div class="num">' + dead.length + '</div><div class="lbl">Sin movimiento</div></div><div class="seg-stat conv"><div class="num">' + conv + '%</div><div class="lbl">Conv v&rarr;p</div></div><div class="seg-stat"><div class="num" style="font-size:13px">' + (lastAct || "-") + '</div><div class="lbl">Ultima actividad</div></div>';
    document.getElementById("seg-stats").innerHTML = html;
  }
  function renderSegResumen(visits, pedidos) {
    const agg = buildSegAggregates(visits, pedidos);
    let html = "";
    Object.entries(agg).sort().forEach(([vendor, b]) => {
      const conv = b.visits ? Math.round(b.pedidos / b.visits * 100) : 0;
      const lastDays = b.lastActivity ? Math.floor((Date.now() - new Date(b.lastActivity).getTime()) / 864e5) : Infinity;
      const cardCls = lastDays > 7 ? "yellow" : lastDays > 15 ? "red" : "";
      html += '<div class="seg-vendor-card ' + cardCls + '">';
      html += "<h4>" + escapeHtml(displayVendorName(vendor)) + "</h4>";
      html += '<div class="vmetrics"><div class="vm"><b>' + b.visits + '</b>Visitas</div><div class="vm"><b>' + b.contactos + '</b>Contactos</div><div class="vm"><b>' + b.pedidos + '</b>Pedidos</div><div class="vm"><b>$' + Math.round(b.facturacion).toLocaleString("es-AR") + '</b>Facturacion</div><div class="vm"><b>' + b.clientsActive.size + '</b>Clientes activos</div><div class="vm"><b>' + b.clientsVisited.size + '</b>Clientes visitados</div><div class="vm"><b>' + b.pendientesPedidos + '</b>Pend. confirmar</div><div class="vm"><b>' + conv + '%</b>Conv. v&rarr;p</div><div class="vm"><b>' + (b.lastActivity || "-") + "</b>Ult. actividad</div></div></div>";
    });
    if (!html) html = '<div class="seg-empty">No hay vendedores externos en el scope.</div>';
    return html;
  }
  function renderSegVisitas(visits) {
    if (!visits.length) return '<div class="seg-empty">No hay visitas en el rango.</div>';
    const sorted = visits.slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    const canDel = userRole === "admin" || userRole === "gerente";
    let html = '<div class="seg-row head"><div>Fecha</div><div>Vendedor</div><div>Cliente / Tienda</div><div>Localidad</div><div>Observaciones</div></div>';
    sorted.forEach((v) => {
      const k = segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda);
      const delBtn = canDel && v.id ? ` <button onclick="event.stopPropagation();deleteSegVisita('` + escapeAttr(v.id) + "','" + escapeAttr(v.tienda || "") + `')" title="Eliminar esta visita (admin/gerente)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:var(--color-danger);color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128465; Borrar</button>` : "";
      const contacto = isContacto(v);
      const tipoBadge = contacto ? '<span style="display:inline-block;background:#ccfbf1;color:#0d5c56;font-size:8px;font-weight:800;padding:2px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.4px;margin-left:6px">&#128172; Contacto</span>' : '<span style="display:inline-block;background:#ede9fe;color:var(--color-accent-violet);font-size:8px;font-weight:800;padding:2px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.4px;margin-left:6px">&#128663; Visita</span>';
      html += `<div class="seg-row" onclick="openSegTimeline('` + escapeAttr(k) + `')">`;
      html += "<div>" + escapeHtml((v.fecha || "").slice(0, 10) || "-") + tipoBadge + "</div>";
      html += "<div>" + escapeHtml(titleCase(v.vendor || "")) + "</div>";
      html += "<div><b>" + escapeHtml(v.tienda || "-") + "</b></div>";
      html += "<div>" + escapeHtml(v.localidad || "-") + "</div>";
      html += '<div style="color:var(--text-secondary)">' + escapeHtml((v.comentario || v.observaciones || "").slice(0, 140)) + (v.proximaAccion ? '<br><span style="color:#0d9488;font-weight:700">Proxima: ' + escapeHtml(v.proximaAccion) + "</span>" : "") + delBtn + "</div>";
      html += "</div>";
    });
    return html;
  }
  window.deleteSegVisita = async function(visitId, tienda) {
    if (!visitId) return;
    if (userRole !== "admin" && userRole !== "gerente") {
      alert("Solo admin o gerente puede eliminar visitas.");
      return;
    }
    const lbl = tienda ? '"' + tienda + '"' : "esta visita";
    if (!confirm(
      "Eliminar la visita a " + lbl + " del historial?\n\nEsta accion es IRREVERSIBLE: la visita desaparece de Seguimiento, rutas, dashboard y stats del vendedor externo."
    ))
      return;
    try {
      await fbDb.collection("visits").doc(visitId).delete();
      if (typeof showSyncTag === "function") showSyncTag("Visita eliminada");
      await loadSegVisits();
      renderSeguimientoTab();
    } catch (e) {
      console.error("deleteSegVisita", e);
      alert("Error: " + (e.message || e));
    }
  };
  function renderSegPedidos(pedidos) {
    if (!pedidos.length) return '<div class="seg-empty">No hay pedidos en el rango.</div>';
    const sorted = pedidos.slice().sort(
      (a, b) => (b.confirmedAt || b.finalizedAt || "").localeCompare(a.confirmedAt || a.finalizedAt || "")
    );
    const canDel = userRole === "admin" || userRole === "gerente";
    let html = '<div class="seg-row head"><div>Fecha</div><div>Vendedor</div><div>Cliente</div><div>Unidades</div><div>Importe + Estado</div></div>';
    sorted.forEach((p) => {
      const k = segMakeKey(p.vendor, p.province, p.locName, p.clientName);
      const dt = (p.confirmedAt || p.finalizedAt || "").slice(0, 10);
      const units = (p.lines || []).reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
      const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
      const badgeCls = p.stage === "confirmed" ? "green" : "yellow";
      const badgeTxt = p.stage === "confirmed" ? "Confirmado" : "Pendiente";
      const delBtn = canDel && p._fsId ? ` <button onclick="event.stopPropagation();deleteSegPedido('` + escapeAttr(p._fsId) + "','" + escapeAttr(p.clientName || "") + `')" title="Eliminar este pedido del historial (admin/gerente)" style="margin-left:8px;padding:3px 8px;border:none;border-radius:4px;background:var(--color-danger);color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128465; Borrar</button>` : "";
      html += `<div class="seg-row" onclick="openSegTimeline('` + escapeAttr(k) + `')">`;
      html += "<div>" + escapeHtml(dt || "-") + "</div>";
      html += "<div>" + escapeHtml(titleCase(p.vendor || "")) + "</div>";
      html += "<div><b>" + escapeHtml(p.clientName || "-") + '</b><br><span style="font-size:10px;color:var(--text-muted)">' + escapeHtml(p.locName || "") + "</span></div>";
      html += "<div>" + units.toFixed(0) + " u</div>";
      html += "<div>$" + Math.round(amt).toLocaleString("es-AR") + ' <span class="seg-badge ' + badgeCls + '">' + badgeTxt + "</span>" + delBtn + "</div>";
      html += "</div>";
    });
    return html;
  }
  window.deleteSegPedido = async function(fsId, clientName) {
    if (!fsId) return;
    if (userRole !== "admin" && userRole !== "gerente") {
      alert("Solo admin o gerente puede eliminar pedidos.");
      return;
    }
    const lbl = clientName ? '"' + clientName + '"' : "este pedido";
    if (!confirm(
      "Eliminar el pedido de " + lbl + " del historial?\n\nEsta accion es IRREVERSIBLE: el pedido desaparece de Seguimiento, Dashboard, exports y campa\xF1as."
    ))
      return;
    try {
      await fbDb.collection("pedidos").doc(fsId).delete();
      if (typeof showSyncTag === "function") showSyncTag("Pedido eliminado");
      setTimeout(() => {
        try {
          renderSeguimientoTab();
        } catch (_e) {
        }
      }, 250);
    } catch (e) {
      console.error("deleteSegPedido", e);
      alert("Error: " + (e.message || e));
    }
  };
  function renderSegPendientes(items) {
    if (!items.length) return '<div class="seg-empty">Sin pendientes en el rango.</div>';
    items = items.slice().sort((a, _b) => a.status === "red" ? -1 : 1);
    const canDel = userRole === "admin" || userRole === "gerente";
    const isSegUser = userRole === "admin" || userRole === "gerente" || userRole === "interno";
    let html = '<div class="seg-row head"><div>Estado</div><div>Vendedor</div><div>Cliente</div><div>Ult. accion</div><div>Problema + accion sugerida</div></div>';
    items.forEach((it) => {
      const lbl = it.status === "red" ? "CRITICO" : it.status === "yellow" ? "REVISAR" : "OK";
      let actionBtn = "";
      if (it.kind === "pedido-pending" && canDel && it.pedidoFsId) {
        actionBtn = ` <button onclick="event.stopPropagation();deleteSegPedido('` + escapeAttr(it.pedidoFsId) + "','" + escapeAttr(it.client || "") + `')" title="Eliminar el pedido pendiente del historial (admin/gerente)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:var(--color-danger);color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128465; Borrar pedido</button>`;
      } else if (it.kind === "visit-no-order" && isSegUser) {
        actionBtn = ` <button onclick="event.stopPropagation();setSegStatus('` + escapeAttr(it.clientKey) + `','resuelto')" title="Marcar este cliente como resuelto - se oculta de Pendientes (no borra visitas)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:#0d9488;color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#10003; Resolver</button>`;
      }
      html += `<div class="seg-row" onclick="openSegTimeline('` + escapeAttr(it.clientKey) + `')">`;
      html += '<div><span class="seg-status-dot ' + it.status + '"></span><span class="seg-badge ' + it.status + '">' + lbl + "</span></div>";
      html += "<div>" + escapeHtml(titleCase(it.vendor || "")) + "</div>";
      html += "<div><b>" + escapeHtml(it.client || "-") + '</b><br><span style="font-size:10px;color:var(--text-muted)">' + escapeHtml(it.loc || "") + "</span></div>";
      html += '<div style="font-size:10px;color:var(--text-muted)">' + escapeHtml(it.ultimaAccion || "-") + "</div>";
      html += "<div><b>" + escapeHtml(it.problema || "-") + '</b><br><span style="color:#0d9488;font-weight:700">&rarr; ' + escapeHtml(it.accion || "") + "</span>" + actionBtn + "</div>";
      html += "</div>";
    });
    return html;
  }
  function renderSegDead(items) {
    if (!items.length)
      return '<div class="seg-empty">Todos los clientes tuvieron actividad reciente. Umbrales aplicados: sin visita 30d Y sin pedido 45d.</div>';
    let html = '<div class="seg-row head"><div>Estado</div><div>Vendedor</div><div>Cliente</div><div>Dias sin act.</div><div>Ult. visita / pedido + facturacion + accion</div></div>';
    items.forEach((it) => {
      const lbl = it.status === "red" ? "CRITICO" : "REVISAR";
      html += `<div class="seg-row" onclick="openSegTimeline('` + escapeAttr(it.clientKey) + `')">`;
      html += '<div><span class="seg-status-dot ' + it.status + '"></span><span class="seg-badge ' + it.status + '">' + lbl + "</span></div>";
      html += "<div>" + escapeHtml(titleCase(it.vendor || "")) + "</div>";
      html += "<div><b>" + escapeHtml(it.client || "-") + '</b><br><span style="font-size:10px;color:var(--text-muted)">' + escapeHtml(it.loc || "") + "</span></div>";
      html += '<div><b style="color:var(--color-danger)">' + it.daysAgo + "d</b></div>";
      html += "<div>Visita: " + escapeHtml(it.lastVisit || "-") + " &middot; Pedido: " + escapeHtml(it.lastOrder || "-") + (it.facturacion ? "<br>Facturacion historica: <b>$" + Math.round(it.facturacion).toLocaleString("es-AR") + "</b>" : "") + '<br><span style="color:#0d9488;font-weight:700">&rarr; ' + escapeHtml(it.accion || "") + "</span></div>";
      html += "</div>";
    });
    return html;
  }
  function renderSegOpps(items) {
    if (!items.length)
      return '<div class="seg-empty">No detect&eacute; oportunidades en el rango.<br>Las oportunidades se detectan por palabras clave en los comentarios de visita (interesado, potencial, cierre, reposicion, cotiza...).</div>';
    return renderSegPendientes(items);
  }
  function renderSegDuplas(duplas) {
    const arr = Object.values(duplas);
    if (!arr.length) return '<div class="seg-empty">No hay duplas con actividad en el rango.</div>';
    let html = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;font-weight:700;padding:8px 12px;background:#f0fdfa;border-left:3px solid #0d9488;border-radius:5px">Tasa de conversion visita &rarr; pedido = pedidos confirmados / visitas. Es la metrica clave para evaluar si las visitas generan negocio real.</div>';
    arr.sort((a, b) => (b.fact || 0) - (a.fact || 0));
    arr.forEach((d) => {
      const conv = d.visitas ? Math.round(d.pedidosConf / d.visitas * 100) : 0;
      const cls = conv >= 50 ? "" : conv >= 25 ? "yellow" : "red";
      const convBg = conv >= 50 ? "#dcfce7" : conv >= 25 ? "#fef3c7" : "#fee2e2";
      html += '<div class="seg-vendor-card ' + cls + '">';
      html += "<h4>" + escapeHtml(titleCase(d.interno)) + " &middot; " + escapeHtml(titleCase(d.externo)) + "</h4>";
      html += '<div class="vmetrics"><div class="vm"><b>' + d.visitas + '</b>Visitas</div><div class="vm"><b>' + d.pedidos + '</b>Pedidos</div><div class="vm"><b>' + d.pedidosConf + '</b>Confirmados</div><div class="vm" style="background:' + convBg + '"><b>' + conv + '%</b>Conv v&rarr;p</div><div class="vm"><b>$' + Math.round(d.fact).toLocaleString("es-AR") + '</b>Facturacion</div><div class="vm"><b>' + d.clientes.size + '</b>Clientes</div><div class="vm"><b>' + d.pendientes + '</b>Pend. confirmar</div><div class="vm"><b>' + (d.lastAct || "-") + "</b>Ult. actividad</div></div></div>";
    });
    return html;
  }
  window.openSegTimeline = function(clientKey) {
    if (!canViewSeguimiento()) return;
    const parts = (clientKey || "").split("|");
    const vendor = parts[0], prov = parts[1], loc = parts[2], name = parts[3];
    if (!vendorInSeguimientoScope(vendor)) {
      alert("No tenes permisos para ver este cliente.");
      return;
    }
    currentSegTimelineKey = clientKey;
    document.getElementById("seg-tl-title").textContent = name || "(cliente)";
    document.getElementById("seg-tl-sub").innerHTML = escapeHtml(titleCase(vendor || "")) + " &middot; " + escapeHtml(loc || "") + " / " + escapeHtml(titleCase(prov || ""));
    const items = [];
    (segVisitsCache || []).filter(
      (v) => v.vendor === vendor && v.provincia === prov && v.localidad === loc && v.tienda === name
    ).forEach((v) => {
      items.push({
        type: "visit",
        date: (v.fecha || "").slice(0, 10),
        title: "Visita",
        body: (v.comentario || v.observaciones || "(sin comentarios)") + (v.proximaAccion ? "\nProxima accion: " + v.proximaAccion : "")
      });
    });
    (globalPedidos || []).filter(
      (p) => segPedidoVendor(p) === vendor && p.province === prov && p.locName === loc && p.clientName === name
    ).forEach((p) => {
      const dt = (p.confirmedAt || p.finalizedAt || "").slice(0, 10);
      const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
      const units = (p.lines || []).reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
      items.push({
        type: "order",
        date: dt,
        title: "Pedido " + (p.stage === "confirmed" ? "confirmado" : p.stage === "pending" ? "pendiente" : p.stage),
        body: "$" + Math.round(amt).toLocaleString("es-AR") + " / " + units.toFixed(0) + " u / " + // v605 E5: SKUs unicos (con v600 split, un SKU puede aparecer en 2 lineas)
        new Set((p.lines || []).map((l) => l && l.code).filter(Boolean)).size + " SKU(s)"
      });
    });
    (segNotesCache || []).filter((n) => n.clientKey === clientKey).forEach((n) => {
      const dt = n.createdAt && n.createdAt.toDate ? n.createdAt.toDate().toISOString().slice(0, 10) : "";
      items.push({
        type: "note",
        date: dt,
        title: "Nota interna - " + (n.authorName || n.authorEmail || ""),
        body: n.text || ""
      });
    });
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    let html = '<div class="seg-timeline">';
    if (!items.length)
      html += '<div class="seg-empty">Sin actividad registrada para este cliente.</div>';
    items.forEach((it) => {
      html += '<div class="seg-timeline-item ' + it.type + '">';
      html += '<div class="seg-timeline-date">' + escapeHtml(it.date || "(s/f)") + "</div>";
      html += '<div class="seg-timeline-title">' + escapeHtml(it.title) + "</div>";
      html += '<div class="seg-timeline-body">' + escapeHtml(it.body || "").replace(/\n/g, "<br>") + "</div>";
      html += "</div>";
    });
    html += "</div>";
    const curStatus = segStatusCache[clientKey] || "";
    html += '<div style="background:var(--bg-secondary);border-top:1px solid var(--border-subtle);padding:10px 12px;margin-top:14px;border-radius:6px">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Estado de seguimiento interno (no afecta visita ni pedido original)</div>';
    html += '<div class="seg-status-row">';
    [
      ["pendiente", "Marcar pendiente"],
      ["revisado", "Marcar revisado"],
      ["resuelto", "Marcar resuelto"]
    ].forEach((s) => {
      const act = curStatus === s[0] ? "active" : "";
      html += '<button class="seg-status-btn ' + act + `" onclick="setSegStatus('` + escapeAttr(clientKey) + "','" + s[0] + `')">` + s[1] + "</button>";
    });
    html += "</div></div>";
    html += '<div class="seg-note-form">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--color-warning);text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px">Nota interna entre interno y externo (no modifica la visita)</div>';
    html += '<textarea id="seg-note-input" placeholder="Ej: revisado, lo llamo ma\xF1ana para cerrar reposicion"></textarea>';
    html += `<button onclick="saveSegNote('` + escapeAttr(clientKey) + `')">Guardar nota</button>`;
    html += "</div>";
    document.getElementById("seg-tl-content").innerHTML = html;
    document.getElementById("seg-timeline-modal").classList.add("open");
  };
  window.closeSegTimeline = function() {
    document.getElementById("seg-timeline-modal").classList.remove("open");
    currentSegTimelineKey = null;
  };
  window.saveSegNote = async function(clientKey) {
    if (!canViewSeguimiento()) return;
    const parts = (clientKey || "").split("|");
    const vendor = parts[0];
    if (!vendorInSeguimientoScope(vendor)) {
      alert("Sin permisos.");
      return;
    }
    const ta = document.getElementById("seg-note-input");
    const text = (ta && ta.value || "").trim();
    if (!text) return;
    try {
      await fbDb.collection("seguimiento_notes").add({
        clientKey,
        vendorExt: vendor,
        prov: parts[1],
        loc: parts[2],
        clientName: parts[3],
        authorUid: currentUser.uid,
        authorEmail: currentUser.email || "",
        authorName: currentUser.displayName || currentUser.email || "",
        authorRole: userRole,
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (ta) ta.value = "";
      if (typeof showSyncTag === "function") showSyncTag("Nota interna guardada");
    } catch (e) {
      alert(
        "Error guardando nota: " + (e.message || e) + '\n\nProbable: faltan rules en Firestore para "seguimiento_notes".'
      );
    }
  };
  window.setSegStatus = async function(clientKey, status) {
    if (!canViewSeguimiento()) return;
    const parts = (clientKey || "").split("|");
    const vendor = parts[0];
    if (!vendorInSeguimientoScope(vendor)) {
      alert("Sin permisos.");
      return;
    }
    const docId = clientKey.replace(/[/\\#?]/g, "_").slice(0, 400) + "__" + (currentUser.uid || "");
    try {
      await fbDb.collection("seguimiento_status").doc(docId).set(
        {
          clientKey,
          vendorExt: vendor,
          prov: parts[1],
          loc: parts[2],
          clientName: parts[3],
          authorUid: currentUser.uid,
          status,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      if (typeof showSyncTag === "function") showSyncTag("Estado: " + status);
    } catch (e) {
      alert("Error: " + (e.message || e) + '\n\nProbable: faltan rules para "seguimiento_status".');
    }
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvc2VndWltaWVudG8uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBHbG9iYWxzIGxlXHUwMEVEZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XG4vLyBmYkRiLCBmaXJlYmFzZSwgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBWRU5ET1JfSU5DTFVERVNfT1RIRVJTLCBnbG9iYWxQZWRpZG9zLFxuLy8gZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLCBzaG93U3luY1RhZywgY2FuVmlld1NlZ3VpbWllbnRvLFxuLy8gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCwgdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlLCBnZXRWZW5kb3JGb3JLZXlcbi8vIChkYXNoYm9hcmQgYnVuZGxlKS4gTVx1MDBGM2R1bG8gZXh0cmFcdTAwRURkbyB2ZXJiYXRpbTogdGlwYWRvIHJlYWwgZnVlcmEgZGUgc2NvcGUgRTIuZC5cbi8vXG4vLyBTRUdVSU1JRU5UTyAtIFBhbmVsIGRlIGdlc3RpXHUwMEYzbiBjb21lcmNpYWwgcGFyYSB2ZW5kZWRvcmVzIGludGVybm9zLlxuLy8gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sIChsXHUwMEVEbmVhcyAyNjcxMy0yNzQwOCBwcmUtRTIuZCkgY29tbyBwYXJ0ZVxuLy8gZGUgRTIuZCAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuIFByZXNlcnZhIDEwMCUgY29tcG9ydGFtaWVudG8uXG4vL1xuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGUgKHZpYSB3aW5kb3cpOlxuLy8gLSB3aW5kb3cudW5zdWJTZWdOb3RlcyAvIHdpbmRvdy51bnN1YlNlZ1N0YXR1czogbGlzdGVuZXJzIGNvbiBjbGVhbnVwIGVuXG4vLyAgIGRldGFjaEZpcmViYXNlTGlzdGVuZXJzKCkgaW5saW5lIChsXHUwMEVEbmVhcyAyNjE0OC00OSBwcmUtRTIuZCkuXG4vLyBMb2NhbHMgYWwgbVx1MDBGM2R1bG86IHNlZ1Zpc2l0c0NhY2hlLCBzZWdOb3Rlc0NhY2hlLCBzZWdTdGF0dXNDYWNoZSxcbi8vIHNlZ0N1cnJlbnRUYWIsIGN1cnJlbnRTZWdUaW1lbGluZUtleSwgX3NlZ0RlYm91bmNlVGltZXIuXG5cbi8vIEluaXQgY3Jvc3Mtc2NvcGUgc3RhdGUgKGJ1bmRsZSBJSUZFIGNvcnJlIHByZS1pbmxpbmU7IGdhcmFudGl6YSBxdWUgbGFzXG4vLyB2YXJzIHVuc3ViKiBleGlzdGVuIGVuIHdpbmRvdyBhbnRlcyBkZSBxdWUgZGV0YWNoRmlyZWJhc2VMaXN0ZW5lcnMgbGFzIGxlYSkuXG5pZiAodHlwZW9mIHdpbmRvdy51bnN1YlNlZ05vdGVzID09PSAndW5kZWZpbmVkJykgd2luZG93LnVuc3ViU2VnTm90ZXMgPSBudWxsO1xuaWYgKHR5cGVvZiB3aW5kb3cudW5zdWJTZWdTdGF0dXMgPT09ICd1bmRlZmluZWQnKSB3aW5kb3cudW5zdWJTZWdTdGF0dXMgPSBudWxsO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUdVSU1JRU5UTyAtIFBhbmVsIGRlIGdlc3Rpb24gY29tZXJjaWFsIHBhcmEgdmVuZGVkb3JlcyBpbnRlcm5vcy5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1vZGVsbzpcbi8vICAgdmlzaXRhcyAgICAgIC0+IGNvbGxlY3Rpb24gJ3Zpc2l0cycgKGNhcmdhZGEgMXggY29uIHdoZXJlIHZlbmRvciBpbiBbLi4uXSlcbi8vICAgcGVkaWRvcyAgICAgIC0+IGdsb2JhbFBlZGlkb3MgKHlhIGxpc3RlbmVyYWRvIHBhcmEgc3VnZXJlbmNpYXMgY3J1emFkYXMpXG4vLyAgIG5vdGFzICAgICAgICAtPiBjb2xsZWN0aW9uICdzZWd1aW1pZW50b19ub3Rlcydcbi8vICAgZXN0YWRvcyAgICAgIC0+IGNvbGxlY3Rpb24gJ3NlZ3VpbWllbnRvX3N0YXR1cycgIChyZXZpc2FkbyAvIHBlbmRpZW50ZSAvIHJlc3VlbHRvKVxuLy8gUGVybWlzb3M6IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKSBlcyBlbCBndWFyZC4gQ2FkYSBhY2Npb24gKG9wZW4sXG4vLyByZW5kZXIsIHNhdmUsIHNldFN0YXR1cykgcmUtdmFsaWRhIHZlbmRvckluU2VndWltaWVudG9TY29wZSh2ZW5kb3IpIHBhcmFcbi8vIHF1ZSBsYSBtYW5pcHVsYWNpb24gZGVsIGZyb250ZW5kIG5vIHB1ZWRhIGZvcnphciBhY2Nlc28gYSB1biBWREUgYWplbm8uXG5sZXQgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcbmxldCBzZWdOb3Rlc0NhY2hlID0gW107XG5sZXQgc2VnU3RhdHVzQ2FjaGUgPSB7fTtcbmxldCBzZWdDdXJyZW50VGFiID0gJ3Jlc3VtZW4nO1xubGV0IGN1cnJlbnRTZWdUaW1lbGluZUtleSA9IG51bGw7XG5sZXQgX3NlZ0RlYm91bmNlVGltZXIgPSBudWxsO1xuXG5mdW5jdGlvbiBzZWdQZWRpZG9WZW5kb3IocCkge1xuICBpZiAoIXApIHJldHVybiAnJztcbiAgaWYgKHAudmVuZG9yKSByZXR1cm4gcC52ZW5kb3I7XG4gIGlmIChwLmFzc2lnbmVkVmVuZG9yKSByZXR1cm4gcC5hc3NpZ25lZFZlbmRvcjtcbiAgaWYgKHR5cGVvZiBnZXRWZW5kb3JGb3JLZXkgPT09ICdmdW5jdGlvbicgJiYgcC5rZXkpIHJldHVybiBnZXRWZW5kb3JGb3JLZXkocC5rZXkpO1xuICByZXR1cm4gJyc7XG59XG5cbi8vIHY0NDMgKDIwMjYtMDgtMTEpOiBkaXN0aW5ndWlyIHZpc2l0YSBwcmVzZW5jaWFsIHZzIGNvbnRhY3RvIG5vIHByZXNlbmNpYWxcbi8vIChXaGF0c0FwcC90ZWwvZW1haWwpLiBFbCBjYW1wbyBgaW50ZXJhY3Rpb25UeXBlYCBzZSBzZXRlYSBlbiB2aXNpdGFzLmpzIGFsXG4vLyBhYnJpciBlbCBtb2RhbCAobW9kbyAndmlzaXRhJyB2cyAnY29udGFjdG8nKSB5IHF1ZWRhIGVuIGVsIGRvYyBkZSBGaXJlc3RvcmUuXG4vLyBEb2NzIHZpZWpvcyBzaW4gZXNlIGNhbXBvIHNlIGFzdW1lbiAndmlzaXRhJyBwb3IgZGVmZWN0byAocmV0cm9jb21wYXQpLlxuZnVuY3Rpb24gaXNDb250YWN0byh2KSB7XG4gIHJldHVybiAhISh2ICYmIHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKTtcbn1cblxud2luZG93Lm9wZW5TZWd1aW1pZW50b01vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSB7XG4gICAgYWxlcnQoJ1R1IHJvbCBubyB0aWVuZSBhY2Nlc28gYSBTZWd1aW1pZW50by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplKSB7XG4gICAgYWxlcnQoXG4gICAgICAnVG9kYXZpYSBubyB0ZW5lcyB2ZW5kZWRvcmVzIGV4dGVybm9zIGFzaWduYWRvcy5cXG5cXG5TaSBzb3MgdmVuZGVkb3IgaW50ZXJubyAoU2FudGlhZ28gLyBJb2FubmlzKSwgcGVkaWxlIGFsIGFkbWluIHF1ZSBlbiBQYW5lbCBVc3VhcmlvcyAtPiB0dSBWREUgLT4gXCJQYXJlamEgaW50ZXJub1wiIHRlIGFzb2NpZSBjb21vIHBhcmVqYS4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZ3VpbWllbnRvLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBwb3B1bGF0ZVNlZ0ZpbHRlcnMoKTtcbiAgY29uc3QgZGVzZGVFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZmRlc2RlJyk7XG4gIGNvbnN0IGhhc3RhRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZoYXN0YScpO1xuICBpZiAoZGVzZGVFbCAmJiAhZGVzZGVFbC52YWx1ZSkge1xuICAgIC8vIHY0NDEgKDIwMjYtMDgtMTEpOiBkZWZhdWx0ID0gcHJpbWVyIGRcdTAwRURhIGRlbCBtZXMgZW4gY3Vyc28gXHUyMTkyIGhveS5cbiAgICAvLyBGZWVkYmFjayBNYXJpYW5vOiBlcmEgaG95LTkwZCwgbXV5IGFtcGxpbzsgZWwgZXF1aXBvIGNvbWVyY2lhbCBtaXJhXG4gICAgLy8gc2VndWltaWVudG8gZGVsIG1lcyB2aWdlbnRlIGNhc2kgc2llbXByZS5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGNvbnN0IGRlc2RlID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxKTtcbiAgICBkZXNkZUVsLnZhbHVlID0gZGVzZGUudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgaGFzdGFFbC52YWx1ZSA9IG5vdy50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgfVxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPVxuICAgICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Q2FyZ2FuZG8gZGF0b3MuLi48L2Rpdj4nO1xuICBhd2FpdCBsb2FkU2VnVmlzaXRzKCk7XG4gIGF0dGFjaFNlZ05vdGVzTGlzdGVuZXIoKTtcbiAgYXR0YWNoU2VnU3RhdHVzTGlzdGVuZXIoKTtcbiAgc2V0U2VndWltaWVudG9UYWIoc2VnQ3VycmVudFRhYik7XG59O1xud2luZG93LmNsb3NlU2VndWltaWVudG9Nb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZ3VpbWllbnRvLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuZnVuY3Rpb24gcG9wdWxhdGVTZWdGaWx0ZXJzKCkge1xuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XG4gIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZnZlbmRvcicpO1xuICBpZiAoIXNlbCkgcmV0dXJuO1xuICBjb25zdCBjdXIgPSBzZWwudmFsdWUgfHwgJ0FMTCc7XG4gIGNvbnN0IG9wdHMgPSBbJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2Rvczwvb3B0aW9uPiddLmNvbmNhdChcbiAgICBbLi4uc2V0XVxuICAgICAgLnNvcnQoKVxuICAgICAgLm1hcChcbiAgICAgICAgKHYpID0+XG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih2KSArICdcIj4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2KSkgKyAnPC9vcHRpb24+J1xuICAgICAgKVxuICApO1xuICBzZWwuaW5uZXJIVE1MID0gb3B0cy5qb2luKCcnKTtcbiAgc2VsLnZhbHVlID0gc2V0LmhhcyhjdXIpIHx8IGN1ciA9PT0gJ0FMTCcgPyBjdXIgOiAnQUxMJztcbiAgc2VsLm9uY2hhbmdlID0gKCkgPT4gcmVuZGVyU2VndWltaWVudG9UYWIoKTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZGVzZGUnKS5vbmNoYW5nZSA9ICgpID0+IHtcbiAgICBsb2FkU2VnVmlzaXRzKCkudGhlbigoKSA9PiByZW5kZXJTZWd1aW1pZW50b1RhYigpKTtcbiAgfTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1maGFzdGEnKS5vbmNoYW5nZSA9ICgpID0+IHtcbiAgICBsb2FkU2VnVmlzaXRzKCkudGhlbigoKSA9PiByZW5kZXJTZWd1aW1pZW50b1RhYigpKTtcbiAgfTtcbiAgY29uc3QgY2xpID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mY2xpZW50ZScpO1xuICBjbGkub25pbnB1dCA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoX3NlZ0RlYm91bmNlVGltZXIpIGNsZWFyVGltZW91dChfc2VnRGVib3VuY2VUaW1lcik7XG4gICAgX3NlZ0RlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCksIDMwMCk7XG4gIH07XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZmVzdGFkbycpLm9uY2hhbmdlID0gKCkgPT4gcmVuZGVyU2VndWltaWVudG9UYWIoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZFNlZ1Zpc2l0cygpIHtcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplIHx8ICFmYkRiKSB7XG4gICAgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBsaXN0ID0gWy4uLnNldF07XG4gICAgLy8gRmlyZXN0b3JlIElOIG1heCAxMCAtIGFjYSB0ZW5lbW9zIDItNCwgT0suXG4gICAgY29uc3QgcXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLndoZXJlKCd2ZW5kb3InLCAnaW4nLCBsaXN0KS5nZXQoKTtcbiAgICBzZWdWaXNpdHNDYWNoZSA9IFtdO1xuICAgIHFzLmZvckVhY2goKGQpID0+IHNlZ1Zpc2l0c0NhY2hlLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW1NlZ3VpbWllbnRvXSBlcnJvciBjYXJnYW5kbyB2aXNpdGFzOicsIGUpO1xuICAgIHNlZ1Zpc2l0c0NhY2hlID0gW107XG4gICAgaWYgKGUgJiYgZS5jb2RlID09PSAncGVybWlzc2lvbi1kZW5pZWQnKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ1R1IHJvbCBubyB0aWVuZSBwZXJtaXNvcyBlbiBGaXJlc3RvcmUgcGFyYSBsZWVyIGxhcyB2aXNpdGFzIGRlbCBzY29wZS5cXG5cXG5FbCBhZG1pbiB0aWVuZSBxdWUgYWN0dWFsaXphciBsYXMgcnVsZXMgcGFyYSBwZXJtaXRpciBhIGludGVybm8vZ2VyZW50ZSBsZWVyIHZpc2l0cyBkZSBzdXMgVkRFcyBhc2lnbmFkb3MuJ1xuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXR0YWNoU2VnTm90ZXNMaXN0ZW5lcigpIHtcbiAgaWYgKHdpbmRvdy51bnN1YlNlZ05vdGVzKSB7XG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMoKTtcbiAgICB3aW5kb3cudW5zdWJTZWdOb3RlcyA9IG51bGw7XG4gIH1cbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplIHx8ICFmYkRiKSByZXR1cm47XG4gIHRyeSB7XG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMgPSBmYkRiXG4gICAgICAuY29sbGVjdGlvbignc2VndWltaWVudG9fbm90ZXMnKVxuICAgICAgLndoZXJlKCd2ZW5kb3JFeHQnLCAnaW4nLCBbLi4uc2V0XSlcbiAgICAgIC5vblNuYXBzaG90KFxuICAgICAgICAocXMpID0+IHtcbiAgICAgICAgICBzZWdOb3Rlc0NhY2hlID0gW107XG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4gc2VnTm90ZXNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcbiAgICAgICAgICBpZiAoY3VycmVudFNlZ1RpbWVsaW5lS2V5KSBvcGVuU2VnVGltZWxpbmUoY3VycmVudFNlZ1RpbWVsaW5lS2V5KTtcbiAgICAgICAgfSxcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIG5vdGVzIGxpc3RlbmVyJywgZXJyKVxuICAgICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW1NlZ3VpbWllbnRvXSBub3RlcyBhdHRhY2gnLCBlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhdHRhY2hTZWdTdGF0dXNMaXN0ZW5lcigpIHtcbiAgaWYgKHdpbmRvdy51bnN1YlNlZ1N0YXR1cykge1xuICAgIHdpbmRvdy51bnN1YlNlZ1N0YXR1cygpO1xuICAgIHdpbmRvdy51bnN1YlNlZ1N0YXR1cyA9IG51bGw7XG4gIH1cbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplIHx8ICFmYkRiKSByZXR1cm47XG4gIHRyeSB7XG4gICAgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX3N0YXR1cycpXG4gICAgICAud2hlcmUoJ3ZlbmRvckV4dCcsICdpbicsIFsuLi5zZXRdKVxuICAgICAgLm9uU25hcHNob3QoXG4gICAgICAgIChxcykgPT4ge1xuICAgICAgICAgIHNlZ1N0YXR1c0NhY2hlID0ge307XG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGQgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgICAgICAgIGlmIChkZC5jbGllbnRLZXkpIHNlZ1N0YXR1c0NhY2hlW2RkLmNsaWVudEtleV0gPSBkZC5zdGF0dXMgfHwgJyc7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmVuZGVyU2VndWltaWVudG9UYWIoKTtcbiAgICAgICAgfSxcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIHN0YXR1cyBsaXN0ZW5lcicsIGVycilcbiAgICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tTZWd1aW1pZW50b10gc3RhdHVzIGF0dGFjaCcsIGUpO1xuICB9XG59XG5cbndpbmRvdy5zZXRTZWd1aW1pZW50b1RhYiA9IGZ1bmN0aW9uICh0YWIpIHtcbiAgc2VnQ3VycmVudFRhYiA9IHRhYjtcbiAgZG9jdW1lbnRcbiAgICAucXVlcnlTZWxlY3RvckFsbCgnLnNlZy10YWInKVxuICAgIC5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIGIuZGF0YXNldC5zZWdUYWIgPT09IHRhYikpO1xuICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xufTtcblxuZnVuY3Rpb24gZ2V0U2VnRmlsdGVycygpIHtcbiAgcmV0dXJuIHtcbiAgICB2ZW5kb3I6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZnZlbmRvcicpLnZhbHVlIHx8ICdBTEwnLFxuICAgIGRlc2RlOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZkZXNkZScpLnZhbHVlIHx8ICcnLFxuICAgIGhhc3RhOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZoYXN0YScpLnZhbHVlIHx8ICcnLFxuICAgIGNsaWVudGU6IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZjbGllbnRlJykudmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpLFxuICAgIGVzdGFkbzogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZXN0YWRvJykudmFsdWUgfHwgJ0FMTCcsXG4gICAgc29sb1BlbmQ6ICEhZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mcGVuZCcpLmNoZWNrZWQsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldFNlZ0RhdGFzZXQoKSB7XG4gIGNvbnN0IHNldCA9IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKTtcbiAgY29uc3QgZiA9IGdldFNlZ0ZpbHRlcnMoKTtcbiAgY29uc3QgaW5TY29wZSA9ICh2KSA9PiBzZXQuaGFzKHYpO1xuICBjb25zdCBpbkRhdGUgPSAoZCkgPT4ge1xuICAgIGlmICghZCkgcmV0dXJuIHRydWU7IC8vIHRvbGVyYXIgcmVnaXN0cm9zIHNpbiBmZWNoYVxuICAgIGlmIChmLmRlc2RlICYmIGQgPCBmLmRlc2RlKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGYuaGFzdGEgJiYgZCA+IGYuaGFzdGEpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcbiAgY29uc3QgbWF0Y2hWZW5kb3IgPSAodikgPT4gKGYudmVuZG9yID09PSAnQUxMJyA/IHRydWUgOiB2ID09PSBmLnZlbmRvcik7XG4gIGNvbnN0IG1hdGNoQ2xpZW50ZSA9IChuYW1lKSA9PlxuICAgIGYuY2xpZW50ZSA/IChuYW1lIHx8ICcnKS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKGYuY2xpZW50ZSkgOiB0cnVlO1xuICBjb25zdCB2aXNpdHMgPSAoc2VnVmlzaXRzQ2FjaGUgfHwgW10pLmZpbHRlcigodikgPT4ge1xuICAgIGlmICghaW5TY29wZSh2LnZlbmRvcikpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoIW1hdGNoVmVuZG9yKHYudmVuZG9yKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghaW5EYXRlKCh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCkpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCFtYXRjaENsaWVudGUodi50aWVuZGEpKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xuICBjb25zdCBwZWRpZG9zID0gKGdsb2JhbFBlZGlkb3MgfHwgW10pXG4gICAgLm1hcCgocCkgPT4gT2JqZWN0LmFzc2lnbih7fSwgcCwgeyB2ZW5kb3I6IHNlZ1BlZGlkb1ZlbmRvcihwKSB9KSlcbiAgICAuZmlsdGVyKChwKSA9PiB7XG4gICAgICBpZiAoIWluU2NvcGUocC52ZW5kb3IpKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoIW1hdGNoVmVuZG9yKHAudmVuZG9yKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgY29uc3QgZHQgPSAocC5jb25maXJtZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmZpbmFsaXplZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XG4gICAgICBpZiAoIWluRGF0ZShkdCkpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmICghbWF0Y2hDbGllbnRlKHAuY2xpZW50TmFtZSkpIHJldHVybiBmYWxzZTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICByZXR1cm4geyB2aXNpdHMsIHBlZGlkb3MgfTtcbn1cblxuZnVuY3Rpb24gYnVpbGRTZWdBZ2dyZWdhdGVzKHZpc2l0cywgcGVkaWRvcykge1xuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XG4gIGNvbnN0IGJ5VmVuZG9yID0ge307XG4gIHNldC5mb3JFYWNoKCh2KSA9PiB7XG4gICAgYnlWZW5kb3Jbdl0gPSB7XG4gICAgICB2aXNpdHM6IDAsIC8vIHNvbG8gcHJlc2VuY2lhbGVzIChpbnRlcmFjdGlvblR5cGUgIT0gJ2NvbnRhY3RvJylcbiAgICAgIGNvbnRhY3RvczogMCwgLy8gdjQ0Mzogbm8gcHJlc2VuY2lhbGVzIChXaGF0c0FwcC90ZWwvZW1haWwpXG4gICAgICBwZWRpZG9zOiAwLFxuICAgICAgZmFjdHVyYWNpb246IDAsXG4gICAgICBwZW5kaWVudGVzUGVkaWRvczogMCxcbiAgICAgIGxhc3RBY3Rpdml0eTogJycsXG4gICAgICBjbGllbnRzQWN0aXZlOiBuZXcgU2V0KCksXG4gICAgICBjbGllbnRzVmlzaXRlZDogbmV3IFNldCgpLFxuICAgIH07XG4gIH0pO1xuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IGIgPSBieVZlbmRvclt2LnZlbmRvcl07XG4gICAgaWYgKCFiKSByZXR1cm47XG4gICAgaWYgKGlzQ29udGFjdG8odikpIGIuY29udGFjdG9zKys7XG4gICAgZWxzZSBiLnZpc2l0cysrO1xuICAgIGlmICh2LnRpZW5kYSkgYi5jbGllbnRzVmlzaXRlZC5hZGQodi50aWVuZGEgKyAnfCcgKyAodi5sb2NhbGlkYWQgfHwgJycpKTtcbiAgICBjb25zdCBkID0gKHYuZmVjaGEgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBpZiAoZCAmJiBkID4gYi5sYXN0QWN0aXZpdHkpIGIubGFzdEFjdGl2aXR5ID0gZDtcbiAgfSk7XG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IGIgPSBieVZlbmRvcltwLnZlbmRvcl07XG4gICAgaWYgKCFiKSByZXR1cm47XG4gICAgYi5wZWRpZG9zKys7XG4gICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyAhPSBudWxsID8gcC5zdWJ0b3RhbEFycyA6IDA7XG4gICAgaWYgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnKSBiLmZhY3R1cmFjaW9uICs9ICthbXQgfHwgMDtcbiAgICBpZiAocC5zdGFnZSA9PT0gJ3BlbmRpbmcnKSBiLnBlbmRpZW50ZXNQZWRpZG9zKys7XG4gICAgaWYgKHAuY2xpZW50TmFtZSkgYi5jbGllbnRzQWN0aXZlLmFkZChwLmNsaWVudE5hbWUgKyAnfCcgKyAocC5sb2NOYW1lIHx8ICcnKSk7XG4gICAgY29uc3QgZCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgKHAuZmluYWxpemVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBpZiAoZCAmJiBkID4gYi5sYXN0QWN0aXZpdHkpIGIubGFzdEFjdGl2aXR5ID0gZDtcbiAgfSk7XG4gIHJldHVybiBieVZlbmRvcjtcbn1cblxuZnVuY3Rpb24gc2VnTWFrZUtleSh2ZW5kb3IsIHByb3YsIGxvYywgbmFtZSkge1xuICByZXR1cm4gW3ZlbmRvciB8fCAnJywgcHJvdiB8fCAnJywgbG9jIHx8ICcnLCBuYW1lIHx8ICcnXS5qb2luKCd8Jyk7XG59XG5cbmZ1bmN0aW9uIGRldGVjdFNlZ1BlbmRpZW50ZXModmlzaXRzLCBwZWRpZG9zKSB7XG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIGNvbnN0IGJ5Q2xpZW50ID0ge307XG4gIHZpc2l0cy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xuICAgIGlmICghYnlDbGllbnRba10pXG4gICAgICBieUNsaWVudFtrXSA9IHtcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcbiAgICAgICAgcHJvdjogdi5wcm92aW5jaWEsXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXG4gICAgICAgIG5hbWU6IHYudGllbmRhLFxuICAgICAgICB2aXNpdHM6IFtdLFxuICAgICAgICBvcmRlcnM6IFtdLFxuICAgICAgfTtcbiAgICBieUNsaWVudFtrXS52aXNpdHMucHVzaCh2KTtcbiAgfSk7XG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IGsgPSBzZWdNYWtlS2V5KHAudmVuZG9yLCBwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSk7XG4gICAgaWYgKCFieUNsaWVudFtrXSlcbiAgICAgIGJ5Q2xpZW50W2tdID0ge1xuICAgICAgICB2ZW5kb3I6IHAudmVuZG9yLFxuICAgICAgICBwcm92OiBwLnByb3ZpbmNlLFxuICAgICAgICBsb2M6IHAubG9jTmFtZSxcbiAgICAgICAgbmFtZTogcC5jbGllbnROYW1lLFxuICAgICAgICB2aXNpdHM6IFtdLFxuICAgICAgICBvcmRlcnM6IFtdLFxuICAgICAgfTtcbiAgICBieUNsaWVudFtrXS5vcmRlcnMucHVzaChwKTtcbiAgfSk7XG4gIE9iamVjdC5lbnRyaWVzKGJ5Q2xpZW50KS5mb3JFYWNoKChbaywgY10pID0+IHtcbiAgICBpZiAoIWMudmlzaXRzLmxlbmd0aCkgcmV0dXJuO1xuICAgIGNvbnN0IGhhc0NvbmZpcm1lZCA9IGMub3JkZXJzLnNvbWUoKG8pID0+IG8uc3RhZ2UgPT09ICdjb25maXJtZWQnKTtcbiAgICBpZiAoaGFzQ29uZmlybWVkKSByZXR1cm47XG4gICAgLy8gRWwgdXN1YXJpbyBtYXJjbyBlbCBjYXNvIGNvbW8gJ3Jlc3VlbHRvJyBkZXNkZSBlbCB0aW1lbGluZSBvIGVsXG4gICAgLy8gYm90b24gWCBkZSBwZW5kaWVudGVzIC0+IG5vIHZvbHZlbW9zIGEgbGlzdGFybG8uXG4gICAgaWYgKHNlZ1N0YXR1c0NhY2hlW2tdID09PSAncmVzdWVsdG8nKSByZXR1cm47XG4gICAgY29uc3QgbGF0ZXN0ViA9IGMudmlzaXRzXG4gICAgICAubWFwKCh2KSA9PiB2LmZlY2hhIHx8ICcnKVxuICAgICAgLnNvcnQoKVxuICAgICAgLnBvcCgpO1xuICAgIGNvbnN0IGRheXNBZ28gPSBsYXRlc3RWID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGxhdGVzdFYpLmdldFRpbWUoKSkgLyA4NjQwMDAwMCkgOiAwO1xuICAgIGlmIChkYXlzQWdvID49IDcpIHtcbiAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICBraW5kOiAndmlzaXQtbm8tb3JkZXInLFxuICAgICAgICBjbGllbnRLZXk6IGssXG4gICAgICAgIGNsaWVudDogYy5uYW1lLFxuICAgICAgICB2ZW5kb3I6IGMudmVuZG9yLFxuICAgICAgICBwcm92OiBjLnByb3YsXG4gICAgICAgIGxvYzogYy5sb2MsXG4gICAgICAgIHByb2JsZW1hOiAnVmlzaXRhZG8gc2luIHBlZGlkbyBoYWNlICcgKyBkYXlzQWdvICsgJyBkaWFzJyxcbiAgICAgICAgYWNjaW9uOiAnQ29udGFjdGFyIHkgb2ZyZWNlciBjaWVycmUnLFxuICAgICAgICB1bHRpbWFBY2Npb246ICdWaXNpdGE6ICcgKyBsYXRlc3RWLFxuICAgICAgICBzdGF0dXM6IGRheXNBZ28gPiAxNCA/ICdyZWQnIDogJ3llbGxvdycsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBpZiAocC5zdGFnZSAhPT0gJ3BlbmRpbmcnKSByZXR1cm47XG4gICAgY29uc3QgZHQgPSAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XG4gICAgY29uc3QgZGF5c0FnbyA9IGR0ID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGR0KS5nZXRUaW1lKCkpIC8gODY0MDAwMDApIDogMDtcbiAgICBpdGVtcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdwZWRpZG8tcGVuZGluZycsXG4gICAgICBwZWRpZG9Gc0lkOiBwLl9mc0lkIHx8ICcnLFxuICAgICAgY2xpZW50S2V5OiBzZWdNYWtlS2V5KHAudmVuZG9yLCBwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSksXG4gICAgICBjbGllbnQ6IHAuY2xpZW50TmFtZSxcbiAgICAgIHZlbmRvcjogcC52ZW5kb3IsXG4gICAgICBwcm92OiBwLnByb3ZpbmNlLFxuICAgICAgbG9jOiBwLmxvY05hbWUsXG4gICAgICBwcm9ibGVtYTogJ1BlZGlkbyBwZW5kaWVudGUgZGUgY29uZmlybWFyJyArIChkYXlzQWdvID8gJyBoYWNlICcgKyBkYXlzQWdvICsgJyBkaWFzJyA6ICcnKSxcbiAgICAgIGFjY2lvbjogJ1JldmlzYXIgc3RvY2sgeSBsbGFtYXIgYWwgY2xpZW50ZScsXG4gICAgICB1bHRpbWFBY2Npb246ICdQZWRpZG86ICcgKyAoZHQgfHwgJyhzL2YpJyksXG4gICAgICBzdGF0dXM6IGRheXNBZ28gPj0gNSA/ICdyZWQnIDogJ3llbGxvdycsXG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gaXRlbXM7XG59XG5cbmZ1bmN0aW9uIGRldGVjdFNlZ1Npbk1vdmltaWVudG8odmlzaXRzLCBwZWRpZG9zKSB7XG4gIGNvbnN0IG1hcCA9IHt9O1xuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IGsgPSBzZWdNYWtlS2V5KHYudmVuZG9yLCB2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcbiAgICBpZiAoIW1hcFtrXSlcbiAgICAgIG1hcFtrXSA9IHtcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcbiAgICAgICAgcHJvdjogdi5wcm92aW5jaWEsXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXG4gICAgICAgIG5hbWU6IHYudGllbmRhLFxuICAgICAgICBsYXN0VjogJycsXG4gICAgICAgIGxhc3RPOiAnJyxcbiAgICAgICAgZmFjdHVyYWNpb246IDAsXG4gICAgICB9O1xuICAgIGlmICgodi5mZWNoYSB8fCAnJykgPiBtYXBba10ubGFzdFYpIG1hcFtrXS5sYXN0ViA9IHYuZmVjaGE7XG4gIH0pO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCBrID0gc2VnTWFrZUtleShwLnZlbmRvciwgcC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpO1xuICAgIGlmICghbWFwW2tdKVxuICAgICAgbWFwW2tdID0ge1xuICAgICAgICB2ZW5kb3I6IHAudmVuZG9yLFxuICAgICAgICBwcm92OiBwLnByb3ZpbmNlLFxuICAgICAgICBsb2M6IHAubG9jTmFtZSxcbiAgICAgICAgbmFtZTogcC5jbGllbnROYW1lLFxuICAgICAgICBsYXN0VjogJycsXG4gICAgICAgIGxhc3RPOiAnJyxcbiAgICAgICAgZmFjdHVyYWNpb246IDAsXG4gICAgICB9O1xuICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgJiYgZHQgPiBtYXBba10ubGFzdE8pIG1hcFtrXS5sYXN0TyA9IGR0O1xuICAgIGlmIChwLnN0YWdlID09PSAnY29uZmlybWVkJykge1xuICAgICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyB8fCAwO1xuICAgICAgbWFwW2tdLmZhY3R1cmFjaW9uICs9ICthbXQgfHwgMDtcbiAgICB9XG4gIH0pO1xuICBjb25zdCBvdXQgPSBbXTtcbiAgT2JqZWN0LmVudHJpZXMobWFwKS5mb3JFYWNoKChbaywgY10pID0+IHtcbiAgICBjb25zdCBsYXN0VmRheXMgPSBjLmxhc3RWXG4gICAgICA/IE1hdGguZmxvb3IoKERhdGUubm93KCkgLSBuZXcgRGF0ZShjLmxhc3RWKS5nZXRUaW1lKCkpIC8gODY0MDAwMDApXG4gICAgICA6IEluZmluaXR5O1xuICAgIGNvbnN0IGxhc3RPZGF5cyA9IGMubGFzdE9cbiAgICAgID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGMubGFzdE8pLmdldFRpbWUoKSkgLyA4NjQwMDAwMClcbiAgICAgIDogSW5maW5pdHk7XG4gICAgaWYgKGxhc3RWZGF5cyA+IDMwICYmIGxhc3RPZGF5cyA+IDQ1KSB7XG4gICAgICBjb25zdCBsYXN0RGF5cyA9IE1hdGgubWluKGxhc3RWZGF5cywgbGFzdE9kYXlzKTtcbiAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgY2xpZW50S2V5OiBrLFxuICAgICAgICBjbGllbnQ6IGMubmFtZSxcbiAgICAgICAgdmVuZG9yOiBjLnZlbmRvcixcbiAgICAgICAgcHJvdjogYy5wcm92LFxuICAgICAgICBsb2M6IGMubG9jLFxuICAgICAgICBsYXN0VmlzaXQ6IGMubGFzdFYgfHwgJy0nLFxuICAgICAgICBsYXN0T3JkZXI6IGMubGFzdE8gfHwgJy0nLFxuICAgICAgICBkYXlzQWdvOiBOdW1iZXIuaXNGaW5pdGUobGFzdERheXMpID8gbGFzdERheXMgOiAnOTk5KycsXG4gICAgICAgIGZhY3R1cmFjaW9uOiBjLmZhY3R1cmFjaW9uLFxuICAgICAgICBhY2Npb246XG4gICAgICAgICAgYy5mYWN0dXJhY2lvbiA+IDBcbiAgICAgICAgICAgID8gJ1JlY29udGFjdGFyIC0gY2xpZW50ZSBjb24gaGlzdG9yaWFsJ1xuICAgICAgICAgICAgOiAnUmVjb250YWN0YXIgLSBwdWVkZSBzZXIgb3BvcnR1bmlkYWQnLFxuICAgICAgICBzdGF0dXM6IGMuZmFjdHVyYWNpb24gPiAxMDAwMDAgJiYgbGFzdERheXMgPiA2MCA/ICdyZWQnIDogJ3llbGxvdycsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gb3V0LnNvcnQoKGEsIGIpID0+IChiLmZhY3R1cmFjaW9uIHx8IDApIC0gKGEuZmFjdHVyYWNpb24gfHwgMCkpO1xufVxuXG5mdW5jdGlvbiBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgX3BlZGlkb3MpIHtcbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgY29uc3Qga2V5cyA9IFtcbiAgICAnaW50ZXJlc2FkJyxcbiAgICAncG90ZW5jaWFsJyxcbiAgICAnY2llcnJlJyxcbiAgICAncmVwb3NpY2knLFxuICAgICdvZmVydGEnLFxuICAgICdkZXNjdWVudG8nLFxuICAgICd2b2x2ZXInLFxuICAgICdjb3RpeicsXG4gIF07XG4gIHZpc2l0cy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdHh0ID0gKCh2LmNvbWVudGFyaW8gfHwgJycpICsgJyAnICsgKHYub2JzZXJ2YWNpb25lcyB8fCAnJykpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGtleXMuc29tZSgoa3cpID0+IHR4dC5pbmNsdWRlcyhrdykpKSB7XG4gICAgICBpdGVtcy5wdXNoKHtcbiAgICAgICAgY2xpZW50S2V5OiBzZWdNYWtlS2V5KHYudmVuZG9yLCB2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKSxcbiAgICAgICAgY2xpZW50OiB2LnRpZW5kYSxcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcbiAgICAgICAgcHJvdjogdi5wcm92aW5jaWEsXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXG4gICAgICAgIHByb2JsZW1hOlxuICAgICAgICAgICdDb21lbnRhcmlvIGNvbWVyY2lhbDogXCInICsgKHYuY29tZW50YXJpbyB8fCB2Lm9ic2VydmFjaW9uZXMgfHwgJycpLnNsaWNlKDAsIDgwKSArICdcIicsXG4gICAgICAgIGFjY2lvbjogJ0Nvb3JkaW5hciBjaWVycmUgY29uIGVsIFZERScsXG4gICAgICAgIHVsdGltYUFjY2lvbjogJ1Zpc2l0YTogJyArICh2LmZlY2hhIHx8ICctJyksXG4gICAgICAgIHN0YXR1czogJ3llbGxvdycsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gaXRlbXM7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkU2VnRHVwbGFzKHZpc2l0cywgcGVkaWRvcykge1xuICBjb25zdCBleHRlcm5hbFRvSW50ZXJuYWwgPSB7fTtcbiAgT2JqZWN0LmVudHJpZXMoVkVORE9SX0lOQ0xVREVTX09USEVSUykuZm9yRWFjaCgoW2ludGVybm8sIGV4dF0pID0+XG4gICAgZXh0LmZvckVhY2goKGUpID0+IChleHRlcm5hbFRvSW50ZXJuYWxbZV0gPSBpbnRlcm5vKSlcbiAgKTtcbiAgY29uc3QgZHVwbGFzID0ge307XG4gIGNvbnN0IGVuc3VyZSA9IChpbnRlcm5vLCBleHRlcm5vKSA9PiB7XG4gICAgY29uc3QgayA9IGludGVybm8gKyAnICsgJyArIGV4dGVybm87XG4gICAgaWYgKCFkdXBsYXNba10pXG4gICAgICBkdXBsYXNba10gPSB7XG4gICAgICAgIGludGVybm8sXG4gICAgICAgIGV4dGVybm8sXG4gICAgICAgIHZpc2l0YXM6IDAsXG4gICAgICAgIHBlZGlkb3M6IDAsXG4gICAgICAgIHBlZGlkb3NDb25mOiAwLFxuICAgICAgICBmYWN0OiAwLFxuICAgICAgICBjbGllbnRlczogbmV3IFNldCgpLFxuICAgICAgICBwZW5kaWVudGVzOiAwLFxuICAgICAgICBsYXN0QWN0OiAnJyxcbiAgICAgIH07XG4gICAgcmV0dXJuIGR1cGxhc1trXTtcbiAgfTtcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCBpbnRlcm5vID0gZXh0ZXJuYWxUb0ludGVybmFsW3YudmVuZG9yXTtcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcbiAgICBjb25zdCBkID0gZW5zdXJlKGludGVybm8sIHYudmVuZG9yKTtcbiAgICBkLnZpc2l0YXMrKztcbiAgICBpZiAodi50aWVuZGEpIGQuY2xpZW50ZXMuYWRkKHYudGllbmRhICsgJ3wnICsgKHYubG9jYWxpZGFkIHx8ICcnKSk7XG4gICAgY29uc3QgZHQgPSAodi5mZWNoYSB8fCAnJykuc2xpY2UoMCwgMTApO1xuICAgIGlmIChkdCA+IGQubGFzdEFjdCkgZC5sYXN0QWN0ID0gZHQ7XG4gIH0pO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCBpbnRlcm5vID0gZXh0ZXJuYWxUb0ludGVybmFsW3AudmVuZG9yXTtcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcbiAgICBjb25zdCBkID0gZW5zdXJlKGludGVybm8sIHAudmVuZG9yKTtcbiAgICBkLnBlZGlkb3MrKztcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIHtcbiAgICAgIGQucGVkaWRvc0NvbmYrKztcbiAgICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcbiAgICAgIGQuZmFjdCArPSArYW10IHx8IDA7XG4gICAgfSBlbHNlIGlmIChwLnN0YWdlID09PSAncGVuZGluZycpIGQucGVuZGllbnRlcysrO1xuICAgIGlmIChwLmNsaWVudE5hbWUpIGQuY2xpZW50ZXMuYWRkKHAuY2xpZW50TmFtZSArICd8JyArIChwLmxvY05hbWUgfHwgJycpKTtcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XG4gICAgaWYgKGR0ID4gZC5sYXN0QWN0KSBkLmxhc3RBY3QgPSBkdDtcbiAgfSk7XG4gIHJldHVybiBkdXBsYXM7XG59XG5cbndpbmRvdy5yZW5kZXJTZWd1aW1pZW50b1RhYiA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFjYW5WaWV3U2VndWltaWVudG8oKSkge1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY29udGVudCcpLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+U2luIHBlcm1pc29zLjwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHsgdmlzaXRzLCBwZWRpZG9zIH0gPSBnZXRTZWdEYXRhc2V0KCk7XG4gIHJlbmRlclNlZ1RvcFN0YXRzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IHBlbmRpZW50ZXMgPSBkZXRlY3RTZWdQZW5kaWVudGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IGRlYWQgPSBkZXRlY3RTZWdTaW5Nb3ZpbWllbnRvKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IG9wcHMgPSBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY291bnQtdmlzaXRhcycpLnRleHRDb250ZW50ID0gdmlzaXRzLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1wZWRpZG9zJykudGV4dENvbnRlbnQgPSBwZWRpZG9zLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1wZW5kaWVudGVzJykudGV4dENvbnRlbnQgPSBwZW5kaWVudGVzLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1kZWFkJykudGV4dENvbnRlbnQgPSBkZWFkLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1vcHAnKS50ZXh0Q29udGVudCA9IG9wcHMubGVuZ3RoO1xuICBjb25zdCB0YWIgPSBzZWdDdXJyZW50VGFiIHx8ICdyZXN1bWVuJztcbiAgY29uc3QgZiA9IGdldFNlZ0ZpbHRlcnMoKTtcbiAgY29uc3QgZmlsdGVyQnlFc3RhZG8gPSAoYXJyKSA9PlxuICAgIGYuZXN0YWRvID09PSAnQUxMJyA/IGFyciA6IGFyci5maWx0ZXIoKHgpID0+IHguc3RhdHVzID09PSBmLmVzdGFkbyk7XG4gIGxldCBodG1sID0gJyc7XG4gIGlmICh0YWIgPT09ICdyZXN1bWVuJykgaHRtbCA9IHJlbmRlclNlZ1Jlc3VtZW4odmlzaXRzLCBwZWRpZG9zKTtcbiAgZWxzZSBpZiAodGFiID09PSAndmlzaXRhcycpIHtcbiAgICBsZXQgcm93cyA9IHZpc2l0cy5zbGljZSgpO1xuICAgIGlmIChmLnNvbG9QZW5kKSB7XG4gICAgICBjb25zdCBwZW5kU2V0ID0gbmV3IFNldChwZW5kaWVudGVzLm1hcCgocCkgPT4gcC5jbGllbnRLZXkpKTtcbiAgICAgIHJvd3MgPSByb3dzLmZpbHRlcigodikgPT5cbiAgICAgICAgcGVuZFNldC5oYXMoc2VnTWFrZUtleSh2LnZlbmRvciwgdi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSkpXG4gICAgICApO1xuICAgIH1cbiAgICBodG1sID0gcmVuZGVyU2VnVmlzaXRhcyhyb3dzKTtcbiAgfSBlbHNlIGlmICh0YWIgPT09ICdwZWRpZG9zJykge1xuICAgIGxldCByb3dzID0gcGVkaWRvcy5zbGljZSgpO1xuICAgIGlmIChmLnNvbG9QZW5kKSByb3dzID0gcm93cy5maWx0ZXIoKHApID0+IHAuc3RhZ2UgPT09ICdwZW5kaW5nJyk7XG4gICAgaHRtbCA9IHJlbmRlclNlZ1BlZGlkb3Mocm93cyk7XG4gIH0gZWxzZSBpZiAodGFiID09PSAncGVuZGllbnRlcycpIGh0bWwgPSByZW5kZXJTZWdQZW5kaWVudGVzKGZpbHRlckJ5RXN0YWRvKHBlbmRpZW50ZXMpKTtcbiAgZWxzZSBpZiAodGFiID09PSAnZGVhZCcpIGh0bWwgPSByZW5kZXJTZWdEZWFkKGZpbHRlckJ5RXN0YWRvKGRlYWQpKTtcbiAgZWxzZSBpZiAodGFiID09PSAnb3BwJykgaHRtbCA9IHJlbmRlclNlZ09wcHMoZmlsdGVyQnlFc3RhZG8ob3BwcykpO1xuICBlbHNlIGlmICh0YWIgPT09ICdkdXBsYXMnKSBodG1sID0gcmVuZGVyU2VnRHVwbGFzKGJ1aWxkU2VnRHVwbGFzKHZpc2l0cywgcGVkaWRvcykpO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZnVuY3Rpb24gcmVuZGVyU2VnVG9wU3RhdHModmlzaXRzLCBwZWRpZG9zKSB7XG4gIGxldCBmYWN0ID0gMCxcbiAgICBjb25mID0gMCxcbiAgICBfcGVuZCA9IDAsXG4gICAgbGFzdEFjdCA9ICcnO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIHtcbiAgICAgIGNvbmYrKztcbiAgICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcbiAgICAgIGZhY3QgKz0gK2FtdCB8fCAwO1xuICAgIH0gZWxzZSBpZiAocC5zdGFnZSA9PT0gJ3BlbmRpbmcnKSBfcGVuZCsrO1xuICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKSB8fCAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xuICAgIGlmIChkdCA+IGxhc3RBY3QpIGxhc3RBY3QgPSBkdDtcbiAgfSk7XG4gIHZpc2l0cy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgZCA9ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCk7XG4gICAgaWYgKGQgPiBsYXN0QWN0KSBsYXN0QWN0ID0gZDtcbiAgfSk7XG4gIGNvbnN0IHBlbmRpZW50ZXMgPSBkZXRlY3RTZWdQZW5kaWVudGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IGRlYWQgPSBkZXRlY3RTZWdTaW5Nb3ZpbWllbnRvKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IG9wcHMgPSBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIC8vIHY0NDM6IHNlcGFyYXIgdmlzaXRhcyBwcmVzZW5jaWFsZXMgZGUgY29udGFjdG9zIG5vIHByZXNlbmNpYWxlcy5cbiAgY29uc3QgdmlzaXRhc1ByZXMgPSB2aXNpdHMuZmlsdGVyKCh2KSA9PiAhaXNDb250YWN0byh2KSkubGVuZ3RoO1xuICBjb25zdCBjb250YWN0b3MgPSB2aXNpdHMuZmlsdGVyKGlzQ29udGFjdG8pLmxlbmd0aDtcbiAgY29uc3QgY29udiA9IHZpc2l0cy5sZW5ndGggPiAwID8gTWF0aC5yb3VuZCgoY29uZiAvIHZpc2l0cy5sZW5ndGgpICogMTAwKSA6IDA7XG4gIGNvbnN0IGZtdE1vbiA9IChuKSA9PiAnJCcgKyBNYXRoLnJvdW5kKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xuICBjb25zdCBodG1sID1cbiAgICAnJyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCB2aXNpdGFzXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xuICAgIHZpc2l0YXNQcmVzICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPlZpc2l0YXM8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGNvbnRhY3Rvc1wiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBjb250YWN0b3MgK1xuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+Q29udGFjdG9zPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBwZWRpZG9zXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xuICAgIHBlZGlkb3MubGVuZ3RoICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPlBlZGlkb3M8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGZhY3RcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXG4gICAgZm10TW9uKGZhY3QpICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPkZhY3R1cmFkbzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgcGVuZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBwZW5kaWVudGVzLmxlbmd0aCArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5QZW5kaWVudGVzPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBvcHBcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXG4gICAgb3Bwcy5sZW5ndGggK1xuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+T3BvcnR1bmlkYWRlczwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgZGVhZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBkZWFkLmxlbmd0aCArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5TaW4gbW92aW1pZW50bzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgY29udlwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBjb252ICtcbiAgICAnJTwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5Db252IHYmcmFycjtwPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdFwiPjxkaXYgY2xhc3M9XCJudW1cIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4XCI+JyArXG4gICAgKGxhc3RBY3QgfHwgJy0nKSArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5VbHRpbWEgYWN0aXZpZGFkPC9kaXY+PC9kaXY+JztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1zdGF0cycpLmlubmVySFRNTCA9IGh0bWw7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNlZ1Jlc3VtZW4odmlzaXRzLCBwZWRpZG9zKSB7XG4gIGNvbnN0IGFnZyA9IGJ1aWxkU2VnQWdncmVnYXRlcyh2aXNpdHMsIHBlZGlkb3MpO1xuICBsZXQgaHRtbCA9ICcnO1xuICBPYmplY3QuZW50cmllcyhhZ2cpXG4gICAgLnNvcnQoKVxuICAgIC5mb3JFYWNoKChbdmVuZG9yLCBiXSkgPT4ge1xuICAgICAgY29uc3QgY29udiA9IGIudmlzaXRzID8gTWF0aC5yb3VuZCgoYi5wZWRpZG9zIC8gYi52aXNpdHMpICogMTAwKSA6IDA7XG4gICAgICBjb25zdCBsYXN0RGF5cyA9IGIubGFzdEFjdGl2aXR5XG4gICAgICAgID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGIubGFzdEFjdGl2aXR5KS5nZXRUaW1lKCkpIC8gODY0MDAwMDApXG4gICAgICAgIDogSW5maW5pdHk7XG4gICAgICBjb25zdCBjYXJkQ2xzID0gbGFzdERheXMgPiA3ID8gJ3llbGxvdycgOiBsYXN0RGF5cyA+IDE1ID8gJ3JlZCcgOiAnJztcbiAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctdmVuZG9yLWNhcmQgJyArIGNhcmRDbHMgKyAnXCI+JztcbiAgICAgIGh0bWwgKz0gJzxoND4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpKSArICc8L2g0Pic7XG4gICAgICBodG1sICs9XG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1ldHJpY3NcIj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgICBiLnZpc2l0cyArXG4gICAgICAgICc8L2I+VmlzaXRhczwvZGl2PicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICAgIGIuY29udGFjdG9zICtcbiAgICAgICAgJzwvYj5Db250YWN0b3M8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgICBiLnBlZGlkb3MgK1xuICAgICAgICAnPC9iPlBlZGlkb3M8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPiQnICtcbiAgICAgICAgTWF0aC5yb3VuZChiLmZhY3R1cmFjaW9uKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAgICc8L2I+RmFjdHVyYWNpb248L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgICBiLmNsaWVudHNBY3RpdmUuc2l6ZSArXG4gICAgICAgICc8L2I+Q2xpZW50ZXMgYWN0aXZvczwvZGl2PicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICAgIGIuY2xpZW50c1Zpc2l0ZWQuc2l6ZSArXG4gICAgICAgICc8L2I+Q2xpZW50ZXMgdmlzaXRhZG9zPC9kaXY+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgICAgYi5wZW5kaWVudGVzUGVkaWRvcyArXG4gICAgICAgICc8L2I+UGVuZC4gY29uZmlybWFyPC9kaXY+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgICAgY29udiArXG4gICAgICAgICclPC9iPkNvbnYuIHYmcmFycjtwPC9kaXY+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgICAgKGIubGFzdEFjdGl2aXR5IHx8ICctJykgK1xuICAgICAgICAnPC9iPlVsdC4gYWN0aXZpZGFkPC9kaXY+JyArXG4gICAgICAgICc8L2Rpdj48L2Rpdj4nO1xuICAgIH0pO1xuICBpZiAoIWh0bWwpIGh0bWwgPSAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGhheSB2ZW5kZWRvcmVzIGV4dGVybm9zIGVuIGVsIHNjb3BlLjwvZGl2Pic7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTZWdWaXNpdGFzKHZpc2l0cykge1xuICBpZiAoIXZpc2l0cy5sZW5ndGgpIHJldHVybiAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGhheSB2aXNpdGFzIGVuIGVsIHJhbmdvLjwvZGl2Pic7XG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcbiAgY29uc3QgY2FuRGVsID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJztcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5GZWNoYTwvZGl2PjxkaXY+VmVuZGVkb3I8L2Rpdj48ZGl2PkNsaWVudGUgLyBUaWVuZGE8L2Rpdj48ZGl2PkxvY2FsaWRhZDwvZGl2PjxkaXY+T2JzZXJ2YWNpb25lczwvZGl2PjwvZGl2Pic7XG4gIHNvcnRlZC5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xuICAgIGNvbnN0IGRlbEJ0biA9XG4gICAgICBjYW5EZWwgJiYgdi5pZFxuICAgICAgICA/ICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7ZGVsZXRlU2VnVmlzaXRhKFxcJycgK1xuICAgICAgICAgIGVzY2FwZUF0dHIodi5pZCkgK1xuICAgICAgICAgIFwiJywnXCIgK1xuICAgICAgICAgIGVzY2FwZUF0dHIodi50aWVuZGEgfHwgJycpICtcbiAgICAgICAgICAnXFwnKVwiIHRpdGxlPVwiRWxpbWluYXIgZXN0YSB2aXNpdGEgKGFkbWluL2dlcmVudGUpXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo2cHg7cGFkZGluZzozcHggOHB4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3ItZGFuZ2VyKTtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2N1cnNvcjpwb2ludGVyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4XCI+JiMxMjg0NjU7IEJvcnJhcjwvYnV0dG9uPidcbiAgICAgICAgOiAnJztcbiAgICAvLyB2NDQzOiBiYWRnZSB0aXBvIChWSVNJVEEgcHJlc2VuY2lhbCB2cyBDT05UQUNUTyBubyBwcmVzZW5jaWFsKS5cbiAgICBjb25zdCBjb250YWN0byA9IGlzQ29udGFjdG8odik7XG4gICAgY29uc3QgdGlwb0JhZGdlID0gY29udGFjdG9cbiAgICAgID8gJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDojY2NmYmYxO2NvbG9yOiMwZDVjNTY7Zm9udC1zaXplOjhweDtmb250LXdlaWdodDo4MDA7cGFkZGluZzoycHggNXB4O2JvcmRlci1yYWRpdXM6M3B4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1sZWZ0OjZweFwiPiYjMTI4MTcyOyBDb250YWN0bzwvc3Bhbj4nXG4gICAgICA6ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO2JhY2tncm91bmQ6I2VkZTlmZTtjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTtmb250LXNpemU6OHB4O2ZvbnQtd2VpZ2h0OjgwMDtwYWRkaW5nOjJweCA1cHg7Ym9yZGVyLXJhZGl1czozcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWxlZnQ6NnB4XCI+JiMxMjg2NjM7IFZpc2l0YTwvc3Bhbj4nO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihrKSArICdcXCcpXCI+JztcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKCh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJy0nKSArIHRpcG9CYWRnZSArICc8L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSkgKyAnPC9kaXY+JztcbiAgICBodG1sICs9ICc8ZGl2PjxiPicgKyBlc2NhcGVIdG1sKHYudGllbmRhIHx8ICctJykgKyAnPC9iPjwvZGl2Pic7XG4gICAgaHRtbCArPSAnPGRpdj4nICsgZXNjYXBlSHRtbCh2LmxvY2FsaWRhZCB8fCAnLScpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwoKHYuY29tZW50YXJpbyB8fCB2Lm9ic2VydmFjaW9uZXMgfHwgJycpLnNsaWNlKDAsIDE0MCkpICtcbiAgICAgICh2LnByb3hpbWFBY2Npb25cbiAgICAgICAgPyAnPGJyPjxzcGFuIHN0eWxlPVwiY29sb3I6IzBkOTQ4ODtmb250LXdlaWdodDo3MDBcIj5Qcm94aW1hOiAnICtcbiAgICAgICAgICBlc2NhcGVIdG1sKHYucHJveGltYUFjY2lvbikgK1xuICAgICAgICAgICc8L3NwYW4+J1xuICAgICAgICA6ICcnKSArXG4gICAgICBkZWxCdG4gK1xuICAgICAgJzwvZGl2Pic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSk7XG4gIHJldHVybiBodG1sO1xufVxuXG4vLyBFbGltaW5hIHVuYSB2aXNpdGEuIFNvbG8gYWRtaW4vZ2VyZW50ZSAobGFzIHJ1bGVzIGFkZW1hcyBhdXRvcml6YW4gYWxcbi8vIG93bmVyLCBwZXJvIGRlc2RlIFNlZ3VpbWllbnRvIGxhIGFjY2lvbiBlcyBkZSByZXZpc2lvbi9saW1waWV6YSkuXG53aW5kb3cuZGVsZXRlU2VnVmlzaXRhID0gYXN5bmMgZnVuY3Rpb24gKHZpc2l0SWQsIHRpZW5kYSkge1xuICBpZiAoIXZpc2l0SWQpIHJldHVybjtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZWxpbWluYXIgdmlzaXRhcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgbGJsID0gdGllbmRhID8gJ1wiJyArIHRpZW5kYSArICdcIicgOiAnZXN0YSB2aXNpdGEnO1xuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnRWxpbWluYXIgbGEgdmlzaXRhIGEgJyArXG4gICAgICAgIGxibCArXG4gICAgICAgICcgZGVsIGhpc3RvcmlhbD9cXG5cXG5Fc3RhIGFjY2lvbiBlcyBJUlJFVkVSU0lCTEU6IGxhIHZpc2l0YSBkZXNhcGFyZWNlIGRlIFNlZ3VpbWllbnRvLCBydXRhcywgZGFzaGJvYXJkIHkgc3RhdHMgZGVsIHZlbmRlZG9yIGV4dGVybm8uJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmRvYyh2aXNpdElkKS5kZWxldGUoKTtcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnVmlzaXRhIGVsaW1pbmFkYScpO1xuICAgIC8vIFJlLWZldGNoIGxvY2FsIChubyBoYXkgbGlzdGVuZXIgZGUgdmlzaXRzIGdsb2JhbCkuIERlc3B1ZXMgcmUtcmVuZGVyLlxuICAgIGF3YWl0IGxvYWRTZWdWaXNpdHMoKTtcbiAgICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlU2VnVmlzaXRhJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHJlbmRlclNlZ1BlZGlkb3MocGVkaWRvcykge1xuICBpZiAoIXBlZGlkb3MubGVuZ3RoKSByZXR1cm4gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5ObyBoYXkgcGVkaWRvcyBlbiBlbCByYW5nby48L2Rpdj4nO1xuICBjb25zdCBzb3J0ZWQgPSBwZWRpZG9zXG4gICAgLnNsaWNlKClcbiAgICAuc29ydCgoYSwgYikgPT5cbiAgICAgIChiLmNvbmZpcm1lZEF0IHx8IGIuZmluYWxpemVkQXQgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5jb25maXJtZWRBdCB8fCBhLmZpbmFsaXplZEF0IHx8ICcnKVxuICAgICk7XG4gIGNvbnN0IGNhbkRlbCA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cInNlZy1yb3cgaGVhZFwiPjxkaXY+RmVjaGE8L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlPC9kaXY+PGRpdj5VbmlkYWRlczwvZGl2PjxkaXY+SW1wb3J0ZSArIEVzdGFkbzwvZGl2PjwvZGl2Pic7XG4gIHNvcnRlZC5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkocC52ZW5kb3IsIHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKTtcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8IHAuZmluYWxpemVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBjb25zdCB1bml0cyA9IChwLmxpbmVzIHx8IFtdKS5yZWR1Y2UoKHMsIGwpID0+IHMgKyAocGFyc2VGbG9hdChsLnF0eSkgfHwgMCksIDApO1xuICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcbiAgICBjb25zdCBiYWRnZUNscyA9IHAuc3RhZ2UgPT09ICdjb25maXJtZWQnID8gJ2dyZWVuJyA6ICd5ZWxsb3cnO1xuICAgIGNvbnN0IGJhZGdlVHh0ID0gcC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgPyAnQ29uZmlybWFkbycgOiAnUGVuZGllbnRlJztcbiAgICAvLyBCb3RvbiBFTElNSU5BUjogc29sbyBhZG1pbi9nZXJlbnRlLiBVdGlsIHBhcmEgbGltcGlhciBwZWRpZG9zIFRFU1QuXG4gICAgLy8gc3RvcFByb3BhZ2F0aW9uIGV2aXRhIHF1ZSBlbCBjbGljayBkaXNwYXJlIGVsIHRpbWVsaW5lIGRlbCBjbGllbnRlLlxuICAgIGNvbnN0IGRlbEJ0biA9XG4gICAgICBjYW5EZWwgJiYgcC5fZnNJZFxuICAgICAgICA/ICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7ZGVsZXRlU2VnUGVkaWRvKFxcJycgK1xuICAgICAgICAgIGVzY2FwZUF0dHIocC5fZnNJZCkgK1xuICAgICAgICAgIFwiJywnXCIgK1xuICAgICAgICAgIGVzY2FwZUF0dHIocC5jbGllbnROYW1lIHx8ICcnKSArXG4gICAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkVsaW1pbmFyIGVzdGUgcGVkaWRvIGRlbCBoaXN0b3JpYWwgKGFkbWluL2dlcmVudGUpXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo4cHg7cGFkZGluZzozcHggOHB4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3ItZGFuZ2VyKTtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2N1cnNvcjpwb2ludGVyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4XCI+JiMxMjg0NjU7IEJvcnJhcjwvYnV0dG9uPidcbiAgICAgICAgOiAnJztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXJvd1wiIG9uY2xpY2s9XCJvcGVuU2VnVGltZWxpbmUoXFwnJyArIGVzY2FwZUF0dHIoaykgKyAnXFwnKVwiPic7XG4gICAgaHRtbCArPSAnPGRpdj4nICsgZXNjYXBlSHRtbChkdCB8fCAnLScpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPSAnPGRpdj4nICsgZXNjYXBlSHRtbCh0aXRsZUNhc2UocC52ZW5kb3IgfHwgJycpKSArICc8L2Rpdj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2PjxiPicgK1xuICAgICAgZXNjYXBlSHRtbChwLmNsaWVudE5hbWUgfHwgJy0nKSArXG4gICAgICAnPC9iPjxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sKHAubG9jTmFtZSB8fCAnJykgK1xuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzxkaXY+JyArIHVuaXRzLnRvRml4ZWQoMCkgKyAnIHU8L2Rpdj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2PiQnICtcbiAgICAgIE1hdGgucm91bmQoYW10KS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAnIDxzcGFuIGNsYXNzPVwic2VnLWJhZGdlICcgK1xuICAgICAgYmFkZ2VDbHMgK1xuICAgICAgJ1wiPicgK1xuICAgICAgYmFkZ2VUeHQgK1xuICAgICAgJzwvc3Bhbj4nICtcbiAgICAgIGRlbEJ0biArXG4gICAgICAnPC9kaXY+JztcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuICB9KTtcbiAgcmV0dXJuIGh0bWw7XG59XG5cbi8vIEVsaW1pbmEgdW4gcGVkaWRvIGRlbCBoaXN0b3JpYWwuIFNvbG8gYWRtaW4vZ2VyZW50ZS4gTGFzIHJ1bGVzIHlhIGxvXG4vLyBwZXJtaXRlbiB2aWEgJ2FsbG93IHVwZGF0ZSwgZGVsZXRlOiBpZiBpc0FkbWluT3JHZXJlbnRlKCkgfHwgLi4uJy5cbi8vIFBlbnNhZG8gcGFyYSBsaW1waWFyIHBlZGlkb3MgZGUgVEVTVCBvIGR1cGxpY2Fkb3Mgc2luIHRlbmVyIHF1ZSBzYWxpclxuLy8gZGUgU2VndWltaWVudG8uIEFjdGlvbiBpcnJldmVyc2libGU6IGJvcnJhIGVsIGRvYyBlbiAvcGVkaWRvcy97aWR9Llxud2luZG93LmRlbGV0ZVNlZ1BlZGlkbyA9IGFzeW5jIGZ1bmN0aW9uIChmc0lkLCBjbGllbnROYW1lKSB7XG4gIGlmICghZnNJZCkgcmV0dXJuO1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBlbGltaW5hciBwZWRpZG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBsYmwgPSBjbGllbnROYW1lID8gJ1wiJyArIGNsaWVudE5hbWUgKyAnXCInIDogJ2VzdGUgcGVkaWRvJztcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0VsaW1pbmFyIGVsIHBlZGlkbyBkZSAnICtcbiAgICAgICAgbGJsICtcbiAgICAgICAgJyBkZWwgaGlzdG9yaWFsP1xcblxcbkVzdGEgYWNjaW9uIGVzIElSUkVWRVJTSUJMRTogZWwgcGVkaWRvIGRlc2FwYXJlY2UgZGUgU2VndWltaWVudG8sIERhc2hib2FyZCwgZXhwb3J0cyB5IGNhbXBhXHUwMEYxYXMuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5kb2MoZnNJZCkuZGVsZXRlKCk7XG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykgc2hvd1N5bmNUYWcoJ1BlZGlkbyBlbGltaW5hZG8nKTtcbiAgICAvLyBFbCBsaXN0ZW5lciBnbG9iYWwgZGUgcGVkaWRvcyByZWZyZXNjYSBnbG9iYWxQZWRpZG9zIHNvbG8uIFBlcm9cbiAgICAvLyBwb3IgdGltaW5nLCBmb3J6YW1vcyB1biByZS1yZW5kZXIgcG9yIHNpIHRvZGF2aWEgbm8gbGxlZ28gZWxcbiAgICAvLyBzbmFwc2hvdCB1cGRhdGVkLlxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVuZGVyU2VndWltaWVudG9UYWIoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH0sIDI1MCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVTZWdQZWRpZG8nLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcmVuZGVyU2VnUGVuZGllbnRlcyhpdGVtcykge1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+U2luIHBlbmRpZW50ZXMgZW4gZWwgcmFuZ28uPC9kaXY+JztcbiAgaXRlbXMgPSBpdGVtcy5zbGljZSgpLnNvcnQoKGEsIF9iKSA9PiAoYS5zdGF0dXMgPT09ICdyZWQnID8gLTEgOiAxKSk7XG4gIGNvbnN0IGNhbkRlbCA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XG4gIGNvbnN0IGlzU2VnVXNlciA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZScgfHwgdXNlclJvbGUgPT09ICdpbnRlcm5vJztcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5Fc3RhZG88L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlPC9kaXY+PGRpdj5VbHQuIGFjY2lvbjwvZGl2PjxkaXY+UHJvYmxlbWEgKyBhY2Npb24gc3VnZXJpZGE8L2Rpdj48L2Rpdj4nO1xuICBpdGVtcy5mb3JFYWNoKChpdCkgPT4ge1xuICAgIGNvbnN0IGxibCA9IGl0LnN0YXR1cyA9PT0gJ3JlZCcgPyAnQ1JJVElDTycgOiBpdC5zdGF0dXMgPT09ICd5ZWxsb3cnID8gJ1JFVklTQVInIDogJ09LJztcbiAgICAvLyBCb3RvbiBkZSBlbGltaW5hci9yZXNvbHZlciBzZWd1biBvcmlnZW4gZGVsIHBlbmRpZW50ZTpcbiAgICAvLyAgLSBwZWRpZG8tcGVuZGluZzogYm9ycmFyIGVsIGRvYyBkZWwgcGVkaWRvIChzb2xvIGFkbWluL2dlcmVudGUpLlxuICAgIC8vICAtIHZpc2l0LW5vLW9yZGVyOiBtYXJjYXIgZWwgY2xpZW50S2V5IGNvbW8gJ3Jlc3VlbHRvJyBlblxuICAgIC8vICAgIHNlZ3VpbWllbnRvX3N0YXR1cyBwYXJhIHF1ZSBkZXRlY3RTZWdQZW5kaWVudGVzIGxvIG9jdWx0ZVxuICAgIC8vICAgIChjdWFscXVpZXIgdXNlciBkZSBTZWd1aW1pZW50byBwdWVkZSByZXNvbHZlcmxvKS5cbiAgICBsZXQgYWN0aW9uQnRuID0gJyc7XG4gICAgaWYgKGl0LmtpbmQgPT09ICdwZWRpZG8tcGVuZGluZycgJiYgY2FuRGVsICYmIGl0LnBlZGlkb0ZzSWQpIHtcbiAgICAgIGFjdGlvbkJ0biA9XG4gICAgICAgICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7ZGVsZXRlU2VnUGVkaWRvKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKGl0LnBlZGlkb0ZzSWQpICtcbiAgICAgICAgXCInLCdcIiArXG4gICAgICAgIGVzY2FwZUF0dHIoaXQuY2xpZW50IHx8ICcnKSArXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJFbGltaW5hciBlbCBwZWRpZG8gcGVuZGllbnRlIGRlbCBoaXN0b3JpYWwgKGFkbWluL2dlcmVudGUpXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo2cHg7cGFkZGluZzozcHggOHB4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3ItZGFuZ2VyKTtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2N1cnNvcjpwb2ludGVyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4XCI+JiMxMjg0NjU7IEJvcnJhciBwZWRpZG88L2J1dHRvbj4nO1xuICAgIH0gZWxzZSBpZiAoaXQua2luZCA9PT0gJ3Zpc2l0LW5vLW9yZGVyJyAmJiBpc1NlZ1VzZXIpIHtcbiAgICAgIGFjdGlvbkJ0biA9XG4gICAgICAgICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7c2V0U2VnU3RhdHVzKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKGl0LmNsaWVudEtleSkgK1xuICAgICAgICAnXFwnLFxcJ3Jlc3VlbHRvXFwnKVwiIHRpdGxlPVwiTWFyY2FyIGVzdGUgY2xpZW50ZSBjb21vIHJlc3VlbHRvIC0gc2Ugb2N1bHRhIGRlIFBlbmRpZW50ZXMgKG5vIGJvcnJhIHZpc2l0YXMpXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo2cHg7cGFkZGluZzozcHggOHB4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2N1cnNvcjpwb2ludGVyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4XCI+JiMxMDAwMzsgUmVzb2x2ZXI8L2J1dHRvbj4nO1xuICAgIH1cbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXJvd1wiIG9uY2xpY2s9XCJvcGVuU2VnVGltZWxpbmUoXFwnJyArIGVzY2FwZUF0dHIoaXQuY2xpZW50S2V5KSArICdcXCcpXCI+JztcbiAgICBodG1sICs9XG4gICAgICAnPGRpdj48c3BhbiBjbGFzcz1cInNlZy1zdGF0dXMtZG90ICcgK1xuICAgICAgaXQuc3RhdHVzICtcbiAgICAgICdcIj48L3NwYW4+PHNwYW4gY2xhc3M9XCJzZWctYmFkZ2UgJyArXG4gICAgICBpdC5zdGF0dXMgK1xuICAgICAgJ1wiPicgK1xuICAgICAgbGJsICtcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHRpdGxlQ2FzZShpdC52ZW5kb3IgfHwgJycpKSArICc8L2Rpdj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2PjxiPicgK1xuICAgICAgZXNjYXBlSHRtbChpdC5jbGllbnQgfHwgJy0nKSArXG4gICAgICAnPC9iPjxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sKGl0LmxvYyB8fCAnJykgK1xuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwoaXQudWx0aW1hQWNjaW9uIHx8ICctJykgK1xuICAgICAgJzwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXY+PGI+JyArXG4gICAgICBlc2NhcGVIdG1sKGl0LnByb2JsZW1hIHx8ICctJykgK1xuICAgICAgJzwvYj48YnI+PHNwYW4gc3R5bGU9XCJjb2xvcjojMGQ5NDg4O2ZvbnQtd2VpZ2h0OjcwMFwiPiZyYXJyOyAnICtcbiAgICAgIGVzY2FwZUh0bWwoaXQuYWNjaW9uIHx8ICcnKSArXG4gICAgICAnPC9zcGFuPicgK1xuICAgICAgYWN0aW9uQnRuICtcbiAgICAgICc8L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH0pO1xuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyU2VnRGVhZChpdGVtcykge1xuICBpZiAoIWl0ZW1zLmxlbmd0aClcbiAgICByZXR1cm4gKFxuICAgICAgJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5Ub2RvcyBsb3MgY2xpZW50ZXMgdHV2aWVyb24gYWN0aXZpZGFkIHJlY2llbnRlLiAnICtcbiAgICAgICdVbWJyYWxlcyBhcGxpY2Fkb3M6IHNpbiB2aXNpdGEgMzBkIFkgc2luIHBlZGlkbyA0NWQuPC9kaXY+J1xuICAgICk7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cInNlZy1yb3cgaGVhZFwiPjxkaXY+RXN0YWRvPC9kaXY+PGRpdj5WZW5kZWRvcjwvZGl2PjxkaXY+Q2xpZW50ZTwvZGl2PjxkaXY+RGlhcyBzaW4gYWN0LjwvZGl2PjxkaXY+VWx0LiB2aXNpdGEgLyBwZWRpZG8gKyBmYWN0dXJhY2lvbiArIGFjY2lvbjwvZGl2PjwvZGl2Pic7XG4gIGl0ZW1zLmZvckVhY2goKGl0KSA9PiB7XG4gICAgY29uc3QgbGJsID0gaXQuc3RhdHVzID09PSAncmVkJyA/ICdDUklUSUNPJyA6ICdSRVZJU0FSJztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXJvd1wiIG9uY2xpY2s9XCJvcGVuU2VnVGltZWxpbmUoXFwnJyArIGVzY2FwZUF0dHIoaXQuY2xpZW50S2V5KSArICdcXCcpXCI+JztcbiAgICBodG1sICs9XG4gICAgICAnPGRpdj48c3BhbiBjbGFzcz1cInNlZy1zdGF0dXMtZG90ICcgK1xuICAgICAgaXQuc3RhdHVzICtcbiAgICAgICdcIj48L3NwYW4+PHNwYW4gY2xhc3M9XCJzZWctYmFkZ2UgJyArXG4gICAgICBpdC5zdGF0dXMgK1xuICAgICAgJ1wiPicgK1xuICAgICAgbGJsICtcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHRpdGxlQ2FzZShpdC52ZW5kb3IgfHwgJycpKSArICc8L2Rpdj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2PjxiPicgK1xuICAgICAgZXNjYXBlSHRtbChpdC5jbGllbnQgfHwgJy0nKSArXG4gICAgICAnPC9iPjxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sKGl0LmxvYyB8fCAnJykgK1xuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzxkaXY+PGIgc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1kYW5nZXIpXCI+JyArIGl0LmRheXNBZ28gKyAnZDwvYj48L2Rpdj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2PlZpc2l0YTogJyArXG4gICAgICBlc2NhcGVIdG1sKGl0Lmxhc3RWaXNpdCB8fCAnLScpICtcbiAgICAgICcgJm1pZGRvdDsgUGVkaWRvOiAnICtcbiAgICAgIGVzY2FwZUh0bWwoaXQubGFzdE9yZGVyIHx8ICctJykgK1xuICAgICAgKGl0LmZhY3R1cmFjaW9uXG4gICAgICAgID8gJzxicj5GYWN0dXJhY2lvbiBoaXN0b3JpY2E6IDxiPiQnICtcbiAgICAgICAgICBNYXRoLnJvdW5kKGl0LmZhY3R1cmFjaW9uKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAgICAgJzwvYj4nXG4gICAgICAgIDogJycpICtcbiAgICAgICc8YnI+PHNwYW4gc3R5bGU9XCJjb2xvcjojMGQ5NDg4O2ZvbnQtd2VpZ2h0OjcwMFwiPiZyYXJyOyAnICtcbiAgICAgIGVzY2FwZUh0bWwoaXQuYWNjaW9uIHx8ICcnKSArXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSk7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTZWdPcHBzKGl0ZW1zKSB7XG4gIGlmICghaXRlbXMubGVuZ3RoKVxuICAgIHJldHVybiAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGRldGVjdCZlYWN1dGU7IG9wb3J0dW5pZGFkZXMgZW4gZWwgcmFuZ28uPGJyPkxhcyBvcG9ydHVuaWRhZGVzIHNlIGRldGVjdGFuIHBvciBwYWxhYnJhcyBjbGF2ZSBlbiBsb3MgY29tZW50YXJpb3MgZGUgdmlzaXRhIChpbnRlcmVzYWRvLCBwb3RlbmNpYWwsIGNpZXJyZSwgcmVwb3NpY2lvbiwgY290aXphLi4uKS48L2Rpdj4nO1xuICByZXR1cm4gcmVuZGVyU2VnUGVuZGllbnRlcyhpdGVtcyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNlZ0R1cGxhcyhkdXBsYXMpIHtcbiAgY29uc3QgYXJyID0gT2JqZWN0LnZhbHVlcyhkdXBsYXMpO1xuICBpZiAoIWFyci5sZW5ndGgpIHJldHVybiAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGhheSBkdXBsYXMgY29uIGFjdGl2aWRhZCBlbiBlbCByYW5nby48L2Rpdj4nO1xuICBsZXQgaHRtbCA9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tYm90dG9tOjhweDtmb250LXdlaWdodDo3MDA7cGFkZGluZzo4cHggMTJweDtiYWNrZ3JvdW5kOiNmMGZkZmE7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo1cHhcIj5UYXNhIGRlIGNvbnZlcnNpb24gdmlzaXRhICZyYXJyOyBwZWRpZG8gPSBwZWRpZG9zIGNvbmZpcm1hZG9zIC8gdmlzaXRhcy4gRXMgbGEgbWV0cmljYSBjbGF2ZSBwYXJhIGV2YWx1YXIgc2kgbGFzIHZpc2l0YXMgZ2VuZXJhbiBuZWdvY2lvIHJlYWwuPC9kaXY+JztcbiAgYXJyLnNvcnQoKGEsIGIpID0+IChiLmZhY3QgfHwgMCkgLSAoYS5mYWN0IHx8IDApKTtcbiAgYXJyLmZvckVhY2goKGQpID0+IHtcbiAgICBjb25zdCBjb252ID0gZC52aXNpdGFzID8gTWF0aC5yb3VuZCgoZC5wZWRpZG9zQ29uZiAvIGQudmlzaXRhcykgKiAxMDApIDogMDtcbiAgICBjb25zdCBjbHMgPSBjb252ID49IDUwID8gJycgOiBjb252ID49IDI1ID8gJ3llbGxvdycgOiAncmVkJztcbiAgICBjb25zdCBjb252QmcgPSBjb252ID49IDUwID8gJyNkY2ZjZTcnIDogY29udiA+PSAyNSA/ICcjZmVmM2M3JyA6ICcjZmVlMmUyJztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXZlbmRvci1jYXJkICcgKyBjbHMgKyAnXCI+JztcbiAgICBodG1sICs9XG4gICAgICAnPGg0PicgK1xuICAgICAgZXNjYXBlSHRtbCh0aXRsZUNhc2UoZC5pbnRlcm5vKSkgK1xuICAgICAgJyAmbWlkZG90OyAnICtcbiAgICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKGQuZXh0ZXJubykpICtcbiAgICAgICc8L2g0Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJ2bWV0cmljc1wiPicgK1xuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgZC52aXNpdGFzICtcbiAgICAgICc8L2I+VmlzaXRhczwvZGl2PicgK1xuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgZC5wZWRpZG9zICtcbiAgICAgICc8L2I+UGVkaWRvczwvZGl2PicgK1xuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgZC5wZWRpZG9zQ29uZiArXG4gICAgICAnPC9iPkNvbmZpcm1hZG9zPC9kaXY+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOicgK1xuICAgICAgY29udkJnICtcbiAgICAgICdcIj48Yj4nICtcbiAgICAgIGNvbnYgK1xuICAgICAgJyU8L2I+Q29udiB2JnJhcnI7cDwvZGl2PicgK1xuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPiQnICtcbiAgICAgIE1hdGgucm91bmQoZC5mYWN0KS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAnPC9iPkZhY3R1cmFjaW9uPC9kaXY+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICBkLmNsaWVudGVzLnNpemUgK1xuICAgICAgJzwvYj5DbGllbnRlczwvZGl2PicgK1xuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgZC5wZW5kaWVudGVzICtcbiAgICAgICc8L2I+UGVuZC4gY29uZmlybWFyPC9kaXY+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICAoZC5sYXN0QWN0IHx8ICctJykgK1xuICAgICAgJzwvYj5VbHQuIGFjdGl2aWRhZDwvZGl2PicgK1xuICAgICAgJzwvZGl2PjwvZGl2Pic7XG4gIH0pO1xuICByZXR1cm4gaHRtbDtcbn1cblxud2luZG93Lm9wZW5TZWdUaW1lbGluZSA9IGZ1bmN0aW9uIChjbGllbnRLZXkpIHtcbiAgaWYgKCFjYW5WaWV3U2VndWltaWVudG8oKSkgcmV0dXJuO1xuICBjb25zdCBwYXJ0cyA9IChjbGllbnRLZXkgfHwgJycpLnNwbGl0KCd8Jyk7XG4gIGNvbnN0IHZlbmRvciA9IHBhcnRzWzBdLFxuICAgIHByb3YgPSBwYXJ0c1sxXSxcbiAgICBsb2MgPSBwYXJ0c1syXSxcbiAgICBuYW1lID0gcGFydHNbM107XG4gIGlmICghdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikpIHtcbiAgICBhbGVydCgnTm8gdGVuZXMgcGVybWlzb3MgcGFyYSB2ZXIgZXN0ZSBjbGllbnRlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjdXJyZW50U2VnVGltZWxpbmVLZXkgPSBjbGllbnRLZXk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGwtdGl0bGUnKS50ZXh0Q29udGVudCA9IG5hbWUgfHwgJyhjbGllbnRlKSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGwtc3ViJykuaW5uZXJIVE1MID1cbiAgICBlc2NhcGVIdG1sKHRpdGxlQ2FzZSh2ZW5kb3IgfHwgJycpKSArXG4gICAgJyAmbWlkZG90OyAnICtcbiAgICBlc2NhcGVIdG1sKGxvYyB8fCAnJykgK1xuICAgICcgLyAnICtcbiAgICBlc2NhcGVIdG1sKHRpdGxlQ2FzZShwcm92IHx8ICcnKSk7XG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIChzZWdWaXNpdHNDYWNoZSB8fCBbXSlcbiAgICAuZmlsdGVyKFxuICAgICAgKHYpID0+IHYudmVuZG9yID09PSB2ZW5kb3IgJiYgdi5wcm92aW5jaWEgPT09IHByb3YgJiYgdi5sb2NhbGlkYWQgPT09IGxvYyAmJiB2LnRpZW5kYSA9PT0gbmFtZVxuICAgIClcbiAgICAuZm9yRWFjaCgodikgPT4ge1xuICAgICAgaXRlbXMucHVzaCh7XG4gICAgICAgIHR5cGU6ICd2aXNpdCcsXG4gICAgICAgIGRhdGU6ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCksXG4gICAgICAgIHRpdGxlOiAnVmlzaXRhJyxcbiAgICAgICAgYm9keTpcbiAgICAgICAgICAodi5jb21lbnRhcmlvIHx8IHYub2JzZXJ2YWNpb25lcyB8fCAnKHNpbiBjb21lbnRhcmlvcyknKSArXG4gICAgICAgICAgKHYucHJveGltYUFjY2lvbiA/ICdcXG5Qcm94aW1hIGFjY2lvbjogJyArIHYucHJveGltYUFjY2lvbiA6ICcnKSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICAoZ2xvYmFsUGVkaWRvcyB8fCBbXSlcbiAgICAuZmlsdGVyKFxuICAgICAgKHApID0+XG4gICAgICAgIHNlZ1BlZGlkb1ZlbmRvcihwKSA9PT0gdmVuZG9yICYmXG4gICAgICAgIHAucHJvdmluY2UgPT09IHByb3YgJiZcbiAgICAgICAgcC5sb2NOYW1lID09PSBsb2MgJiZcbiAgICAgICAgcC5jbGllbnROYW1lID09PSBuYW1lXG4gICAgKVxuICAgIC5mb3JFYWNoKChwKSA9PiB7XG4gICAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8IHAuZmluYWxpemVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcbiAgICAgIGNvbnN0IHVuaXRzID0gKHAubGluZXMgfHwgW10pLnJlZHVjZSgocywgbCkgPT4gcyArIChwYXJzZUZsb2F0KGwucXR5KSB8fCAwKSwgMCk7XG4gICAgICBpdGVtcy5wdXNoKHtcbiAgICAgICAgdHlwZTogJ29yZGVyJyxcbiAgICAgICAgZGF0ZTogZHQsXG4gICAgICAgIHRpdGxlOlxuICAgICAgICAgICdQZWRpZG8gJyArXG4gICAgICAgICAgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnID8gJ2NvbmZpcm1hZG8nIDogcC5zdGFnZSA9PT0gJ3BlbmRpbmcnID8gJ3BlbmRpZW50ZScgOiBwLnN0YWdlKSxcbiAgICAgICAgYm9keTpcbiAgICAgICAgICAnJCcgK1xuICAgICAgICAgIE1hdGgucm91bmQoYW10KS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAgICAgJyAvICcgK1xuICAgICAgICAgIHVuaXRzLnRvRml4ZWQoMCkgK1xuICAgICAgICAgICcgdSAvICcgK1xuICAgICAgICAgIC8vIHY2MDUgRTU6IFNLVXMgdW5pY29zIChjb24gdjYwMCBzcGxpdCwgdW4gU0tVIHB1ZWRlIGFwYXJlY2VyIGVuIDIgbGluZWFzKVxuICAgICAgICAgIG5ldyBTZXQoKHAubGluZXMgfHwgW10pLm1hcCgobCkgPT4gbCAmJiBsLmNvZGUpLmZpbHRlcihCb29sZWFuKSkuc2l6ZSArXG4gICAgICAgICAgJyBTS1UocyknLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIChzZWdOb3Rlc0NhY2hlIHx8IFtdKVxuICAgIC5maWx0ZXIoKG4pID0+IG4uY2xpZW50S2V5ID09PSBjbGllbnRLZXkpXG4gICAgLmZvckVhY2goKG4pID0+IHtcbiAgICAgIGNvbnN0IGR0ID1cbiAgICAgICAgbi5jcmVhdGVkQXQgJiYgbi5jcmVhdGVkQXQudG9EYXRlID8gbi5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJztcbiAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICB0eXBlOiAnbm90ZScsXG4gICAgICAgIGRhdGU6IGR0LFxuICAgICAgICB0aXRsZTogJ05vdGEgaW50ZXJuYSAtICcgKyAobi5hdXRob3JOYW1lIHx8IG4uYXV0aG9yRW1haWwgfHwgJycpLFxuICAgICAgICBib2R5OiBuLnRleHQgfHwgJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZGF0ZSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmRhdGUgfHwgJycpKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBjbGFzcz1cInNlZy10aW1lbGluZVwiPic7XG4gIGlmICghaXRlbXMubGVuZ3RoKVxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5TaW4gYWN0aXZpZGFkIHJlZ2lzdHJhZGEgcGFyYSBlc3RlIGNsaWVudGUuPC9kaXY+JztcbiAgaXRlbXMuZm9yRWFjaCgoaXQpID0+IHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lLWl0ZW0gJyArIGl0LnR5cGUgKyAnXCI+JztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lLWRhdGVcIj4nICsgZXNjYXBlSHRtbChpdC5kYXRlIHx8ICcocy9mKScpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy10aW1lbGluZS10aXRsZVwiPicgKyBlc2NhcGVIdG1sKGl0LnRpdGxlKSArICc8L2Rpdj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lLWJvZHlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwoaXQuYm9keSB8fCAnJykucmVwbGFjZSgvXFxuL2csICc8YnI+JykgK1xuICAgICAgJzwvZGl2Pic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSk7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGNvbnN0IGN1clN0YXR1cyA9IHNlZ1N0YXR1c0NhY2hlW2NsaWVudEtleV0gfHwgJyc7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItdG9wOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtwYWRkaW5nOjEwcHggMTJweDttYXJnaW4tdG9wOjE0cHg7Ym9yZGVyLXJhZGl1czo2cHhcIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4O21hcmdpbi1ib3R0b206NnB4XCI+RXN0YWRvIGRlIHNlZ3VpbWllbnRvIGludGVybm8gKG5vIGFmZWN0YSB2aXNpdGEgbmkgcGVkaWRvIG9yaWdpbmFsKTwvZGl2Pic7XG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctc3RhdHVzLXJvd1wiPic7XG4gIFtcbiAgICBbJ3BlbmRpZW50ZScsICdNYXJjYXIgcGVuZGllbnRlJ10sXG4gICAgWydyZXZpc2FkbycsICdNYXJjYXIgcmV2aXNhZG8nXSxcbiAgICBbJ3Jlc3VlbHRvJywgJ01hcmNhciByZXN1ZWx0byddLFxuICBdLmZvckVhY2goKHMpID0+IHtcbiAgICBjb25zdCBhY3QgPSBjdXJTdGF0dXMgPT09IHNbMF0gPyAnYWN0aXZlJyA6ICcnO1xuICAgIGh0bWwgKz1cbiAgICAgICc8YnV0dG9uIGNsYXNzPVwic2VnLXN0YXR1cy1idG4gJyArXG4gICAgICBhY3QgK1xuICAgICAgJ1wiIG9uY2xpY2s9XCJzZXRTZWdTdGF0dXMoXFwnJyArXG4gICAgICBlc2NhcGVBdHRyKGNsaWVudEtleSkgK1xuICAgICAgXCInLCdcIiArXG4gICAgICBzWzBdICtcbiAgICAgICdcXCcpXCI+JyArXG4gICAgICBzWzFdICtcbiAgICAgICc8L2J1dHRvbj4nO1xuICB9KTtcbiAgaHRtbCArPSAnPC9kaXY+PC9kaXY+JztcbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy1ub3RlLWZvcm1cIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tY29sb3Itd2FybmluZyk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4zcHg7bWFyZ2luLWJvdHRvbTo1cHhcIj5Ob3RhIGludGVybmEgZW50cmUgaW50ZXJubyB5IGV4dGVybm8gKG5vIG1vZGlmaWNhIGxhIHZpc2l0YSk8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzx0ZXh0YXJlYSBpZD1cInNlZy1ub3RlLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJFajogcmV2aXNhZG8sIGxvIGxsYW1vIG1hXHUwMEYxYW5hIHBhcmEgY2VycmFyIHJlcG9zaWNpb25cIj48L3RleHRhcmVhPic7XG4gIGh0bWwgKz0gJzxidXR0b24gb25jbGljaz1cInNhdmVTZWdOb3RlKFxcJycgKyBlc2NhcGVBdHRyKGNsaWVudEtleSkgKyAnXFwnKVwiPkd1YXJkYXIgbm90YTwvYnV0dG9uPic7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGwtY29udGVudCcpLmlubmVySFRNTCA9IGh0bWw7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGltZWxpbmUtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xuXG53aW5kb3cuY2xvc2VTZWdUaW1lbGluZSA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10aW1lbGluZS1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgY3VycmVudFNlZ1RpbWVsaW5lS2V5ID0gbnVsbDtcbn07XG5cbndpbmRvdy5zYXZlU2VnTm90ZSA9IGFzeW5jIGZ1bmN0aW9uIChjbGllbnRLZXkpIHtcbiAgaWYgKCFjYW5WaWV3U2VndWltaWVudG8oKSkgcmV0dXJuO1xuICBjb25zdCBwYXJ0cyA9IChjbGllbnRLZXkgfHwgJycpLnNwbGl0KCd8Jyk7XG4gIGNvbnN0IHZlbmRvciA9IHBhcnRzWzBdO1xuICBpZiAoIXZlbmRvckluU2VndWltaWVudG9TY29wZSh2ZW5kb3IpKSB7XG4gICAgYWxlcnQoJ1NpbiBwZXJtaXNvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGEgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLW5vdGUtaW5wdXQnKTtcbiAgY29uc3QgdGV4dCA9ICgodGEgJiYgdGEudmFsdWUpIHx8ICcnKS50cmltKCk7XG4gIGlmICghdGV4dCkgcmV0dXJuO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignc2VndWltaWVudG9fbm90ZXMnKS5hZGQoe1xuICAgICAgY2xpZW50S2V5LFxuICAgICAgdmVuZG9yRXh0OiB2ZW5kb3IsXG4gICAgICBwcm92OiBwYXJ0c1sxXSxcbiAgICAgIGxvYzogcGFydHNbMl0sXG4gICAgICBjbGllbnROYW1lOiBwYXJ0c1szXSxcbiAgICAgIGF1dGhvclVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgYXV0aG9yRW1haWw6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgYXV0aG9yTmFtZTogY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICBhdXRob3JSb2xlOiB1c2VyUm9sZSxcbiAgICAgIHRleHQsXG4gICAgICBjcmVhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgIH0pO1xuICAgIGlmICh0YSkgdGEudmFsdWUgPSAnJztcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnTm90YSBpbnRlcm5hIGd1YXJkYWRhJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydChcbiAgICAgICdFcnJvciBndWFyZGFuZG8gbm90YTogJyArXG4gICAgICAgIChlLm1lc3NhZ2UgfHwgZSkgK1xuICAgICAgICAnXFxuXFxuUHJvYmFibGU6IGZhbHRhbiBydWxlcyBlbiBGaXJlc3RvcmUgcGFyYSBcInNlZ3VpbWllbnRvX25vdGVzXCIuJ1xuICAgICk7XG4gIH1cbn07XG5cbndpbmRvdy5zZXRTZWdTdGF0dXMgPSBhc3luYyBmdW5jdGlvbiAoY2xpZW50S2V5LCBzdGF0dXMpIHtcbiAgaWYgKCFjYW5WaWV3U2VndWltaWVudG8oKSkgcmV0dXJuO1xuICBjb25zdCBwYXJ0cyA9IChjbGllbnRLZXkgfHwgJycpLnNwbGl0KCd8Jyk7XG4gIGNvbnN0IHZlbmRvciA9IHBhcnRzWzBdO1xuICBpZiAoIXZlbmRvckluU2VndWltaWVudG9TY29wZSh2ZW5kb3IpKSB7XG4gICAgYWxlcnQoJ1NpbiBwZXJtaXNvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZG9jSWQgPSBjbGllbnRLZXkucmVwbGFjZSgvWy9cXFxcIz9dL2csICdfJykuc2xpY2UoMCwgNDAwKSArICdfXycgKyAoY3VycmVudFVzZXIudWlkIHx8ICcnKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX3N0YXR1cycpLmRvYyhkb2NJZCkuc2V0KFxuICAgICAge1xuICAgICAgICBjbGllbnRLZXksXG4gICAgICAgIHZlbmRvckV4dDogdmVuZG9yLFxuICAgICAgICBwcm92OiBwYXJ0c1sxXSxcbiAgICAgICAgbG9jOiBwYXJ0c1syXSxcbiAgICAgICAgY2xpZW50TmFtZTogcGFydHNbM10sXG4gICAgICAgIGF1dGhvclVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICBzdGF0dXMsXG4gICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICB9LFxuICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgKTtcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnRXN0YWRvOiAnICsgc3RhdHVzKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkgKyAnXFxuXFxuUHJvYmFibGU6IGZhbHRhbiBydWxlcyBwYXJhIFwic2VndWltaWVudG9fc3RhdHVzXCIuJyk7XG4gIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFtQkEsTUFBSSxPQUFPLE9BQU8sa0JBQWtCLFlBQWEsUUFBTyxnQkFBZ0I7QUFDeEUsTUFBSSxPQUFPLE9BQU8sbUJBQW1CLFlBQWEsUUFBTyxpQkFBaUI7QUFhMUUsTUFBSSxpQkFBaUIsQ0FBQztBQUN0QixNQUFJLGdCQUFnQixDQUFDO0FBQ3JCLE1BQUksaUJBQWlCLENBQUM7QUFDdEIsTUFBSSxnQkFBZ0I7QUFDcEIsTUFBSSx3QkFBd0I7QUFDNUIsTUFBSSxvQkFBb0I7QUFFeEIsV0FBUyxnQkFBZ0IsR0FBRztBQUMxQixRQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsUUFBSSxFQUFFLE9BQVEsUUFBTyxFQUFFO0FBQ3ZCLFFBQUksRUFBRSxlQUFnQixRQUFPLEVBQUU7QUFDL0IsUUFBSSxPQUFPLG9CQUFvQixjQUFjLEVBQUUsSUFBSyxRQUFPLGdCQUFnQixFQUFFLEdBQUc7QUFDaEYsV0FBTztBQUFBLEVBQ1Q7QUFNQSxXQUFTLFdBQVcsR0FBRztBQUNyQixXQUFPLENBQUMsRUFBRSxLQUFLLEVBQUUsb0JBQW9CO0FB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
