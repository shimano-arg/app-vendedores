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
      const delBtn = canDel && v.id ? ` <button onclick="event.stopPropagation();deleteSegVisita('` + escapeAttr(v.id) + "','" + escapeAttr(v.tienda || "") + `')" title="Eliminar esta visita (admin/gerente)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:var(--color-danger);color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">Borrar</button>` : "";
      const contacto = isContacto(v);
      const tipoBadge = contacto ? '<span style="display:inline-block;background:#ccfbf1;color:#0d5c56;font-size:8px;font-weight:800;padding:2px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.4px;margin-left:6px">Contacto</span>' : '<span style="display:inline-block;background:#ede9fe;color:var(--color-accent-violet);font-size:8px;font-weight:800;padding:2px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.4px;margin-left:6px">Visita</span>';
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
      const delBtn = canDel && p._fsId ? ` <button onclick="event.stopPropagation();deleteSegPedido('` + escapeAttr(p._fsId) + "','" + escapeAttr(p.clientName || "") + `')" title="Eliminar este pedido del historial (admin/gerente)" style="margin-left:8px;padding:3px 8px;border:none;border-radius:4px;background:var(--color-danger);color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">Borrar</button>` : "";
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
        actionBtn = ` <button onclick="event.stopPropagation();deleteSegPedido('` + escapeAttr(it.pedidoFsId) + "','" + escapeAttr(it.client || "") + `')" title="Eliminar el pedido pendiente del historial (admin/gerente)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:var(--color-danger);color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">Borrar pedido</button>`;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvc2VndWltaWVudG8uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBHbG9iYWxzIGxlXHUwMEVEZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XG4vLyBmYkRiLCBmaXJlYmFzZSwgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBWRU5ET1JfSU5DTFVERVNfT1RIRVJTLCBnbG9iYWxQZWRpZG9zLFxuLy8gZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLCBzaG93U3luY1RhZywgY2FuVmlld1NlZ3VpbWllbnRvLFxuLy8gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCwgdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlLCBnZXRWZW5kb3JGb3JLZXlcbi8vIChkYXNoYm9hcmQgYnVuZGxlKS4gTVx1MDBGM2R1bG8gZXh0cmFcdTAwRURkbyB2ZXJiYXRpbTogdGlwYWRvIHJlYWwgZnVlcmEgZGUgc2NvcGUgRTIuZC5cbi8vXG4vLyBTRUdVSU1JRU5UTyAtIFBhbmVsIGRlIGdlc3RpXHUwMEYzbiBjb21lcmNpYWwgcGFyYSB2ZW5kZWRvcmVzIGludGVybm9zLlxuLy8gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sIChsXHUwMEVEbmVhcyAyNjcxMy0yNzQwOCBwcmUtRTIuZCkgY29tbyBwYXJ0ZVxuLy8gZGUgRTIuZCAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuIFByZXNlcnZhIDEwMCUgY29tcG9ydGFtaWVudG8uXG4vL1xuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGUgKHZpYSB3aW5kb3cpOlxuLy8gLSB3aW5kb3cudW5zdWJTZWdOb3RlcyAvIHdpbmRvdy51bnN1YlNlZ1N0YXR1czogbGlzdGVuZXJzIGNvbiBjbGVhbnVwIGVuXG4vLyBkZXRhY2hGaXJlYmFzZUxpc3RlbmVycygpIGlubGluZSAobFx1MDBFRG5lYXMgMjYxNDgtNDkgcHJlLUUyLmQpLlxuLy8gTG9jYWxzIGFsIG1cdTAwRjNkdWxvOiBzZWdWaXNpdHNDYWNoZSwgc2VnTm90ZXNDYWNoZSwgc2VnU3RhdHVzQ2FjaGUsXG4vLyBzZWdDdXJyZW50VGFiLCBjdXJyZW50U2VnVGltZWxpbmVLZXksIF9zZWdEZWJvdW5jZVRpbWVyLlxuXG4vLyBJbml0IGNyb3NzLXNjb3BlIHN0YXRlIChidW5kbGUgSUlGRSBjb3JyZSBwcmUtaW5saW5lOyBnYXJhbnRpemEgcXVlIGxhc1xuLy8gdmFycyB1bnN1YiogZXhpc3RlbiBlbiB3aW5kb3cgYW50ZXMgZGUgcXVlIGRldGFjaEZpcmViYXNlTGlzdGVuZXJzIGxhcyBsZWEpLlxuaWYgKHR5cGVvZiB3aW5kb3cudW5zdWJTZWdOb3RlcyA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51bnN1YlNlZ05vdGVzID0gbnVsbDtcbmlmICh0eXBlb2Ygd2luZG93LnVuc3ViU2VnU3RhdHVzID09PSAndW5kZWZpbmVkJykgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gbnVsbDtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VHVUlNSUVOVE8gLSBQYW5lbCBkZSBnZXN0aW9uIGNvbWVyY2lhbCBwYXJhIHZlbmRlZG9yZXMgaW50ZXJub3MuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNb2RlbG86XG4vLyB2aXNpdGFzIC0+IGNvbGxlY3Rpb24gJ3Zpc2l0cycgKGNhcmdhZGEgMXggY29uIHdoZXJlIHZlbmRvciBpbiBbLi4uXSlcbi8vIHBlZGlkb3MgLT4gZ2xvYmFsUGVkaWRvcyAoeWEgbGlzdGVuZXJhZG8gcGFyYSBzdWdlcmVuY2lhcyBjcnV6YWRhcylcbi8vIG5vdGFzIC0+IGNvbGxlY3Rpb24gJ3NlZ3VpbWllbnRvX25vdGVzJ1xuLy8gZXN0YWRvcyAtPiBjb2xsZWN0aW9uICdzZWd1aW1pZW50b19zdGF0dXMnIChyZXZpc2FkbyAvIHBlbmRpZW50ZSAvIHJlc3VlbHRvKVxuLy8gUGVybWlzb3M6IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKSBlcyBlbCBndWFyZC4gQ2FkYSBhY2Npb24gKG9wZW4sXG4vLyByZW5kZXIsIHNhdmUsIHNldFN0YXR1cykgcmUtdmFsaWRhIHZlbmRvckluU2VndWltaWVudG9TY29wZSh2ZW5kb3IpIHBhcmFcbi8vIHF1ZSBsYSBtYW5pcHVsYWNpb24gZGVsIGZyb250ZW5kIG5vIHB1ZWRhIGZvcnphciBhY2Nlc28gYSB1biBWREUgYWplbm8uXG5sZXQgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcbmxldCBzZWdOb3Rlc0NhY2hlID0gW107XG5sZXQgc2VnU3RhdHVzQ2FjaGUgPSB7fTtcbmxldCBzZWdDdXJyZW50VGFiID0gJ3Jlc3VtZW4nO1xubGV0IGN1cnJlbnRTZWdUaW1lbGluZUtleSA9IG51bGw7XG5sZXQgX3NlZ0RlYm91bmNlVGltZXIgPSBudWxsO1xuXG5mdW5jdGlvbiBzZWdQZWRpZG9WZW5kb3IocCkge1xuICBpZiAoIXApIHJldHVybiAnJztcbiAgaWYgKHAudmVuZG9yKSByZXR1cm4gcC52ZW5kb3I7XG4gIGlmIChwLmFzc2lnbmVkVmVuZG9yKSByZXR1cm4gcC5hc3NpZ25lZFZlbmRvcjtcbiAgaWYgKHR5cGVvZiBnZXRWZW5kb3JGb3JLZXkgPT09ICdmdW5jdGlvbicgJiYgcC5rZXkpIHJldHVybiBnZXRWZW5kb3JGb3JLZXkocC5rZXkpO1xuICByZXR1cm4gJyc7XG59XG5cbi8vIHY0NDMgKDIwMjYtMDgtMTEpOiBkaXN0aW5ndWlyIHZpc2l0YSBwcmVzZW5jaWFsIHZzIGNvbnRhY3RvIG5vIHByZXNlbmNpYWxcbi8vIChXaGF0c0FwcC90ZWwvZW1haWwpLiBFbCBjYW1wbyBgaW50ZXJhY3Rpb25UeXBlYCBzZSBzZXRlYSBlbiB2aXNpdGFzLmpzIGFsXG4vLyBhYnJpciBlbCBtb2RhbCAobW9kbyAndmlzaXRhJyB2cyAnY29udGFjdG8nKSB5IHF1ZWRhIGVuIGVsIGRvYyBkZSBGaXJlc3RvcmUuXG4vLyBEb2NzIHZpZWpvcyBzaW4gZXNlIGNhbXBvIHNlIGFzdW1lbiAndmlzaXRhJyBwb3IgZGVmZWN0byAocmV0cm9jb21wYXQpLlxuZnVuY3Rpb24gaXNDb250YWN0byh2KSB7XG4gIHJldHVybiAhISh2ICYmIHYuaW50ZXJhY3Rpb25UeXBlID09PSAnY29udGFjdG8nKTtcbn1cblxud2luZG93Lm9wZW5TZWd1aW1pZW50b01vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSB7XG4gICAgYWxlcnQoJ1R1IHJvbCBubyB0aWVuZSBhY2Nlc28gYSBTZWd1aW1pZW50by4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplKSB7XG4gICAgYWxlcnQoXG4gICAgICAnVG9kYXZpYSBubyB0ZW5lcyB2ZW5kZWRvcmVzIGV4dGVybm9zIGFzaWduYWRvcy5cXG5cXG5TaSBzb3MgdmVuZGVkb3IgaW50ZXJubyAoU2FudGlhZ28gLyBJb2FubmlzKSwgcGVkaWxlIGFsIGFkbWluIHF1ZSBlbiBQYW5lbCBVc3VhcmlvcyAtPiB0dSBWREUgLT4gXCJQYXJlamEgaW50ZXJub1wiIHRlIGFzb2NpZSBjb21vIHBhcmVqYS4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZ3VpbWllbnRvLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBwb3B1bGF0ZVNlZ0ZpbHRlcnMoKTtcbiAgY29uc3QgZGVzZGVFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZmRlc2RlJyk7XG4gIGNvbnN0IGhhc3RhRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZoYXN0YScpO1xuICBpZiAoZGVzZGVFbCAmJiAhZGVzZGVFbC52YWx1ZSkge1xuICAgIC8vIHY0NDEgKDIwMjYtMDgtMTEpOiBkZWZhdWx0ID0gcHJpbWVyIGRcdTAwRURhIGRlbCBtZXMgZW4gY3Vyc28gXHUyMTkyIGhveS5cbiAgICAvLyBGZWVkYmFjayBNYXJpYW5vOiBlcmEgaG95LTkwZCwgbXV5IGFtcGxpbzsgZWwgZXF1aXBvIGNvbWVyY2lhbCBtaXJhXG4gICAgLy8gc2VndWltaWVudG8gZGVsIG1lcyB2aWdlbnRlIGNhc2kgc2llbXByZS5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGNvbnN0IGRlc2RlID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxKTtcbiAgICBkZXNkZUVsLnZhbHVlID0gZGVzZGUudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgaGFzdGFFbC52YWx1ZSA9IG5vdy50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgfVxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPVxuICAgICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Q2FyZ2FuZG8gZGF0b3MuLi48L2Rpdj4nO1xuICBhd2FpdCBsb2FkU2VnVmlzaXRzKCk7XG4gIGF0dGFjaFNlZ05vdGVzTGlzdGVuZXIoKTtcbiAgYXR0YWNoU2VnU3RhdHVzTGlzdGVuZXIoKTtcbiAgc2V0U2VndWltaWVudG9UYWIoc2VnQ3VycmVudFRhYik7XG59O1xud2luZG93LmNsb3NlU2VndWltaWVudG9Nb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZ3VpbWllbnRvLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuZnVuY3Rpb24gcG9wdWxhdGVTZWdGaWx0ZXJzKCkge1xuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XG4gIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZnZlbmRvcicpO1xuICBpZiAoIXNlbCkgcmV0dXJuO1xuICBjb25zdCBjdXIgPSBzZWwudmFsdWUgfHwgJ0FMTCc7XG4gIGNvbnN0IG9wdHMgPSBbJzxvcHRpb24gdmFsdWU9XCJBTExcIj5Ub2Rvczwvb3B0aW9uPiddLmNvbmNhdChcbiAgICBbLi4uc2V0XVxuICAgICAgLnNvcnQoKVxuICAgICAgLm1hcChcbiAgICAgICAgKHYpID0+XG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih2KSArICdcIj4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2KSkgKyAnPC9vcHRpb24+J1xuICAgICAgKVxuICApO1xuICBzZWwuaW5uZXJIVE1MID0gb3B0cy5qb2luKCcnKTtcbiAgc2VsLnZhbHVlID0gc2V0LmhhcyhjdXIpIHx8IGN1ciA9PT0gJ0FMTCcgPyBjdXIgOiAnQUxMJztcbiAgc2VsLm9uY2hhbmdlID0gKCkgPT4gcmVuZGVyU2VndWltaWVudG9UYWIoKTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZGVzZGUnKS5vbmNoYW5nZSA9ICgpID0+IHtcbiAgICBsb2FkU2VnVmlzaXRzKCkudGhlbigoKSA9PiByZW5kZXJTZWd1aW1pZW50b1RhYigpKTtcbiAgfTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1maGFzdGEnKS5vbmNoYW5nZSA9ICgpID0+IHtcbiAgICBsb2FkU2VnVmlzaXRzKCkudGhlbigoKSA9PiByZW5kZXJTZWd1aW1pZW50b1RhYigpKTtcbiAgfTtcbiAgY29uc3QgY2xpID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mY2xpZW50ZScpO1xuICBjbGkub25pbnB1dCA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoX3NlZ0RlYm91bmNlVGltZXIpIGNsZWFyVGltZW91dChfc2VnRGVib3VuY2VUaW1lcik7XG4gICAgX3NlZ0RlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCksIDMwMCk7XG4gIH07XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZmVzdGFkbycpLm9uY2hhbmdlID0gKCkgPT4gcmVuZGVyU2VndWltaWVudG9UYWIoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZFNlZ1Zpc2l0cygpIHtcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplIHx8ICFmYkRiKSB7XG4gICAgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBsaXN0ID0gWy4uLnNldF07XG4gICAgLy8gRmlyZXN0b3JlIElOIG1heCAxMCAtIGFjYSB0ZW5lbW9zIDItNCwgT0suXG4gICAgY29uc3QgcXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLndoZXJlKCd2ZW5kb3InLCAnaW4nLCBsaXN0KS5nZXQoKTtcbiAgICBzZWdWaXNpdHNDYWNoZSA9IFtdO1xuICAgIHFzLmZvckVhY2goKGQpID0+IHNlZ1Zpc2l0c0NhY2hlLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW1NlZ3VpbWllbnRvXSBlcnJvciBjYXJnYW5kbyB2aXNpdGFzOicsIGUpO1xuICAgIHNlZ1Zpc2l0c0NhY2hlID0gW107XG4gICAgaWYgKGUgJiYgZS5jb2RlID09PSAncGVybWlzc2lvbi1kZW5pZWQnKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ1R1IHJvbCBubyB0aWVuZSBwZXJtaXNvcyBlbiBGaXJlc3RvcmUgcGFyYSBsZWVyIGxhcyB2aXNpdGFzIGRlbCBzY29wZS5cXG5cXG5FbCBhZG1pbiB0aWVuZSBxdWUgYWN0dWFsaXphciBsYXMgcnVsZXMgcGFyYSBwZXJtaXRpciBhIGludGVybm8vZ2VyZW50ZSBsZWVyIHZpc2l0cyBkZSBzdXMgVkRFcyBhc2lnbmFkb3MuJ1xuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXR0YWNoU2VnTm90ZXNMaXN0ZW5lcigpIHtcbiAgaWYgKHdpbmRvdy51bnN1YlNlZ05vdGVzKSB7XG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMoKTtcbiAgICB3aW5kb3cudW5zdWJTZWdOb3RlcyA9IG51bGw7XG4gIH1cbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplIHx8ICFmYkRiKSByZXR1cm47XG4gIHRyeSB7XG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMgPSBmYkRiXG4gICAgICAuY29sbGVjdGlvbignc2VndWltaWVudG9fbm90ZXMnKVxuICAgICAgLndoZXJlKCd2ZW5kb3JFeHQnLCAnaW4nLCBbLi4uc2V0XSlcbiAgICAgIC5vblNuYXBzaG90KFxuICAgICAgICAocXMpID0+IHtcbiAgICAgICAgICBzZWdOb3Rlc0NhY2hlID0gW107XG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4gc2VnTm90ZXNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcbiAgICAgICAgICBpZiAoY3VycmVudFNlZ1RpbWVsaW5lS2V5KSBvcGVuU2VnVGltZWxpbmUoY3VycmVudFNlZ1RpbWVsaW5lS2V5KTtcbiAgICAgICAgfSxcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIG5vdGVzIGxpc3RlbmVyJywgZXJyKVxuICAgICAgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW1NlZ3VpbWllbnRvXSBub3RlcyBhdHRhY2gnLCBlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhdHRhY2hTZWdTdGF0dXNMaXN0ZW5lcigpIHtcbiAgaWYgKHdpbmRvdy51bnN1YlNlZ1N0YXR1cykge1xuICAgIHdpbmRvdy51bnN1YlNlZ1N0YXR1cygpO1xuICAgIHdpbmRvdy51bnN1YlNlZ1N0YXR1cyA9IG51bGw7XG4gIH1cbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xuICBpZiAoIXNldC5zaXplIHx8ICFmYkRiKSByZXR1cm47XG4gIHRyeSB7XG4gICAgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX3N0YXR1cycpXG4gICAgICAud2hlcmUoJ3ZlbmRvckV4dCcsICdpbicsIFsuLi5zZXRdKVxuICAgICAgLm9uU25hcHNob3QoXG4gICAgICAgIChxcykgPT4ge1xuICAgICAgICAgIHNlZ1N0YXR1c0NhY2hlID0ge307XG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGQgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgICAgICAgIGlmIChkZC5jbGllbnRLZXkpIHNlZ1N0YXR1c0NhY2hlW2RkLmNsaWVudEtleV0gPSBkZC5zdGF0dXMgfHwgJyc7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmVuZGVyU2VndWltaWVudG9UYWIoKTtcbiAgICAgICAgfSxcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIHN0YXR1cyBsaXN0ZW5lcicsIGVycilcbiAgICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tTZWd1aW1pZW50b10gc3RhdHVzIGF0dGFjaCcsIGUpO1xuICB9XG59XG5cbndpbmRvdy5zZXRTZWd1aW1pZW50b1RhYiA9IGZ1bmN0aW9uICh0YWIpIHtcbiAgc2VnQ3VycmVudFRhYiA9IHRhYjtcbiAgZG9jdW1lbnRcbiAgICAucXVlcnlTZWxlY3RvckFsbCgnLnNlZy10YWInKVxuICAgIC5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIGIuZGF0YXNldC5zZWdUYWIgPT09IHRhYikpO1xuICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xufTtcblxuZnVuY3Rpb24gZ2V0U2VnRmlsdGVycygpIHtcbiAgcmV0dXJuIHtcbiAgICB2ZW5kb3I6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZnZlbmRvcicpLnZhbHVlIHx8ICdBTEwnLFxuICAgIGRlc2RlOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZkZXNkZScpLnZhbHVlIHx8ICcnLFxuICAgIGhhc3RhOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZoYXN0YScpLnZhbHVlIHx8ICcnLFxuICAgIGNsaWVudGU6IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZjbGllbnRlJykudmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpLFxuICAgIGVzdGFkbzogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZXN0YWRvJykudmFsdWUgfHwgJ0FMTCcsXG4gICAgc29sb1BlbmQ6ICEhZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mcGVuZCcpLmNoZWNrZWQsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldFNlZ0RhdGFzZXQoKSB7XG4gIGNvbnN0IHNldCA9IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKTtcbiAgY29uc3QgZiA9IGdldFNlZ0ZpbHRlcnMoKTtcbiAgY29uc3QgaW5TY29wZSA9ICh2KSA9PiBzZXQuaGFzKHYpO1xuICBjb25zdCBpbkRhdGUgPSAoZCkgPT4ge1xuICAgIGlmICghZCkgcmV0dXJuIHRydWU7IC8vIHRvbGVyYXIgcmVnaXN0cm9zIHNpbiBmZWNoYVxuICAgIGlmIChmLmRlc2RlICYmIGQgPCBmLmRlc2RlKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGYuaGFzdGEgJiYgZCA+IGYuaGFzdGEpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcbiAgY29uc3QgbWF0Y2hWZW5kb3IgPSAodikgPT4gKGYudmVuZG9yID09PSAnQUxMJyA/IHRydWUgOiB2ID09PSBmLnZlbmRvcik7XG4gIGNvbnN0IG1hdGNoQ2xpZW50ZSA9IChuYW1lKSA9PlxuICAgIGYuY2xpZW50ZSA/IChuYW1lIHx8ICcnKS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKGYuY2xpZW50ZSkgOiB0cnVlO1xuICBjb25zdCB2aXNpdHMgPSAoc2VnVmlzaXRzQ2FjaGUgfHwgW10pLmZpbHRlcigodikgPT4ge1xuICAgIGlmICghaW5TY29wZSh2LnZlbmRvcikpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoIW1hdGNoVmVuZG9yKHYudmVuZG9yKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghaW5EYXRlKCh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCkpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCFtYXRjaENsaWVudGUodi50aWVuZGEpKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xuICBjb25zdCBwZWRpZG9zID0gKGdsb2JhbFBlZGlkb3MgfHwgW10pXG4gICAgLm1hcCgocCkgPT4gT2JqZWN0LmFzc2lnbih7fSwgcCwgeyB2ZW5kb3I6IHNlZ1BlZGlkb1ZlbmRvcihwKSB9KSlcbiAgICAuZmlsdGVyKChwKSA9PiB7XG4gICAgICBpZiAoIWluU2NvcGUocC52ZW5kb3IpKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoIW1hdGNoVmVuZG9yKHAudmVuZG9yKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgY29uc3QgZHQgPSAocC5jb25maXJtZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmZpbmFsaXplZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XG4gICAgICBpZiAoIWluRGF0ZShkdCkpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmICghbWF0Y2hDbGllbnRlKHAuY2xpZW50TmFtZSkpIHJldHVybiBmYWxzZTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICByZXR1cm4geyB2aXNpdHMsIHBlZGlkb3MgfTtcbn1cblxuZnVuY3Rpb24gYnVpbGRTZWdBZ2dyZWdhdGVzKHZpc2l0cywgcGVkaWRvcykge1xuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XG4gIGNvbnN0IGJ5VmVuZG9yID0ge307XG4gIHNldC5mb3JFYWNoKCh2KSA9PiB7XG4gICAgYnlWZW5kb3Jbdl0gPSB7XG4gICAgICB2aXNpdHM6IDAsIC8vIHNvbG8gcHJlc2VuY2lhbGVzIChpbnRlcmFjdGlvblR5cGUgIT0gJ2NvbnRhY3RvJylcbiAgICAgIGNvbnRhY3RvczogMCwgLy8gdjQ0Mzogbm8gcHJlc2VuY2lhbGVzIChXaGF0c0FwcC90ZWwvZW1haWwpXG4gICAgICBwZWRpZG9zOiAwLFxuICAgICAgZmFjdHVyYWNpb246IDAsXG4gICAgICBwZW5kaWVudGVzUGVkaWRvczogMCxcbiAgICAgIGxhc3RBY3Rpdml0eTogJycsXG4gICAgICBjbGllbnRzQWN0aXZlOiBuZXcgU2V0KCksXG4gICAgICBjbGllbnRzVmlzaXRlZDogbmV3IFNldCgpLFxuICAgIH07XG4gIH0pO1xuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IGIgPSBieVZlbmRvclt2LnZlbmRvcl07XG4gICAgaWYgKCFiKSByZXR1cm47XG4gICAgaWYgKGlzQ29udGFjdG8odikpIGIuY29udGFjdG9zKys7XG4gICAgZWxzZSBiLnZpc2l0cysrO1xuICAgIGlmICh2LnRpZW5kYSkgYi5jbGllbnRzVmlzaXRlZC5hZGQodi50aWVuZGEgKyAnfCcgKyAodi5sb2NhbGlkYWQgfHwgJycpKTtcbiAgICBjb25zdCBkID0gKHYuZmVjaGEgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBpZiAoZCAmJiBkID4gYi5sYXN0QWN0aXZpdHkpIGIubGFzdEFjdGl2aXR5ID0gZDtcbiAgfSk7XG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IGIgPSBieVZlbmRvcltwLnZlbmRvcl07XG4gICAgaWYgKCFiKSByZXR1cm47XG4gICAgYi5wZWRpZG9zKys7XG4gICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyAhPSBudWxsID8gcC5zdWJ0b3RhbEFycyA6IDA7XG4gICAgaWYgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnKSBiLmZhY3R1cmFjaW9uICs9ICthbXQgfHwgMDtcbiAgICBpZiAocC5zdGFnZSA9PT0gJ3BlbmRpbmcnKSBiLnBlbmRpZW50ZXNQZWRpZG9zKys7XG4gICAgaWYgKHAuY2xpZW50TmFtZSkgYi5jbGllbnRzQWN0aXZlLmFkZChwLmNsaWVudE5hbWUgKyAnfCcgKyAocC5sb2NOYW1lIHx8ICcnKSk7XG4gICAgY29uc3QgZCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgKHAuZmluYWxpemVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBpZiAoZCAmJiBkID4gYi5sYXN0QWN0aXZpdHkpIGIubGFzdEFjdGl2aXR5ID0gZDtcbiAgfSk7XG4gIHJldHVybiBieVZlbmRvcjtcbn1cblxuZnVuY3Rpb24gc2VnTWFrZUtleSh2ZW5kb3IsIHByb3YsIGxvYywgbmFtZSkge1xuICByZXR1cm4gW3ZlbmRvciB8fCAnJywgcHJvdiB8fCAnJywgbG9jIHx8ICcnLCBuYW1lIHx8ICcnXS5qb2luKCd8Jyk7XG59XG5cbmZ1bmN0aW9uIGRldGVjdFNlZ1BlbmRpZW50ZXModmlzaXRzLCBwZWRpZG9zKSB7XG4gIGNvbnN0IGl0ZW1zID0gW107XG4gIGNvbnN0IGJ5Q2xpZW50ID0ge307XG4gIHZpc2l0cy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xuICAgIGlmICghYnlDbGllbnRba10pXG4gICAgICBieUNsaWVudFtrXSA9IHtcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcbiAgICAgICAgcHJvdjogdi5wcm92aW5jaWEsXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXG4gICAgICAgIG5hbWU6IHYudGllbmRhLFxuICAgICAgICB2aXNpdHM6IFtdLFxuICAgICAgICBvcmRlcnM6IFtdLFxuICAgICAgfTtcbiAgICBieUNsaWVudFtrXS52aXNpdHMucHVzaCh2KTtcbiAgfSk7XG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IGsgPSBzZWdNYWtlS2V5KHAudmVuZG9yLCBwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSk7XG4gICAgaWYgKCFieUNsaWVudFtrXSlcbiAgICAgIGJ5Q2xpZW50W2tdID0ge1xuICAgICAgICB2ZW5kb3I6IHAudmVuZG9yLFxuICAgICAgICBwcm92OiBwLnByb3ZpbmNlLFxuICAgICAgICBsb2M6IHAubG9jTmFtZSxcbiAgICAgICAgbmFtZTogcC5jbGllbnROYW1lLFxuICAgICAgICB2aXNpdHM6IFtdLFxuICAgICAgICBvcmRlcnM6IFtdLFxuICAgICAgfTtcbiAgICBieUNsaWVudFtrXS5vcmRlcnMucHVzaChwKTtcbiAgfSk7XG4gIE9iamVjdC5lbnRyaWVzKGJ5Q2xpZW50KS5mb3JFYWNoKChbaywgY10pID0+IHtcbiAgICBpZiAoIWMudmlzaXRzLmxlbmd0aCkgcmV0dXJuO1xuICAgIGNvbnN0IGhhc0NvbmZpcm1lZCA9IGMub3JkZXJzLnNvbWUoKG8pID0+IG8uc3RhZ2UgPT09ICdjb25maXJtZWQnKTtcbiAgICBpZiAoaGFzQ29uZmlybWVkKSByZXR1cm47XG4gICAgLy8gRWwgdXN1YXJpbyBtYXJjbyBlbCBjYXNvIGNvbW8gJ3Jlc3VlbHRvJyBkZXNkZSBlbCB0aW1lbGluZSBvIGVsXG4gICAgLy8gYm90b24gWCBkZSBwZW5kaWVudGVzIC0+IG5vIHZvbHZlbW9zIGEgbGlzdGFybG8uXG4gICAgaWYgKHNlZ1N0YXR1c0NhY2hlW2tdID09PSAncmVzdWVsdG8nKSByZXR1cm47XG4gICAgY29uc3QgbGF0ZXN0ViA9IGMudmlzaXRzXG4gICAgICAubWFwKCh2KSA9PiB2LmZlY2hhIHx8ICcnKVxuICAgICAgLnNvcnQoKVxuICAgICAgLnBvcCgpO1xuICAgIGNvbnN0IGRheXNBZ28gPSBsYXRlc3RWID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGxhdGVzdFYpLmdldFRpbWUoKSkgLyA4NjQwMDAwMCkgOiAwO1xuICAgIGlmIChkYXlzQWdvID49IDcpIHtcbiAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICBraW5kOiAndmlzaXQtbm8tb3JkZXInLFxuICAgICAgICBjbGllbnRLZXk6IGssXG4gICAgICAgIGNsaWVudDogYy5uYW1lLFxuICAgICAgICB2ZW5kb3I6IGMudmVuZG9yLFxuICAgICAgICBwcm92OiBjLnByb3YsXG4gICAgICAgIGxvYzogYy5sb2MsXG4gICAgICAgIHByb2JsZW1hOiAnVmlzaXRhZG8gc2luIHBlZGlkbyBoYWNlICcgKyBkYXlzQWdvICsgJyBkaWFzJyxcbiAgICAgICAgYWNjaW9uOiAnQ29udGFjdGFyIHkgb2ZyZWNlciBjaWVycmUnLFxuICAgICAgICB1bHRpbWFBY2Npb246ICdWaXNpdGE6ICcgKyBsYXRlc3RWLFxuICAgICAgICBzdGF0dXM6IGRheXNBZ28gPiAxNCA/ICdyZWQnIDogJ3llbGxvdycsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBpZiAocC5zdGFnZSAhPT0gJ3BlbmRpbmcnKSByZXR1cm47XG4gICAgY29uc3QgZHQgPSAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XG4gICAgY29uc3QgZGF5c0FnbyA9IGR0ID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGR0KS5nZXRUaW1lKCkpIC8gODY0MDAwMDApIDogMDtcbiAgICBpdGVtcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdwZWRpZG8tcGVuZGluZycsXG4gICAgICBwZWRpZG9Gc0lkOiBwLl9mc0lkIHx8ICcnLFxuICAgICAgY2xpZW50S2V5OiBzZWdNYWtlS2V5KHAudmVuZG9yLCBwLnByb3ZpbmNlLCBwLmxvY05hbWUsIHAuY2xpZW50TmFtZSksXG4gICAgICBjbGllbnQ6IHAuY2xpZW50TmFtZSxcbiAgICAgIHZlbmRvcjogcC52ZW5kb3IsXG4gICAgICBwcm92OiBwLnByb3ZpbmNlLFxuICAgICAgbG9jOiBwLmxvY05hbWUsXG4gICAgICBwcm9ibGVtYTogJ1BlZGlkbyBwZW5kaWVudGUgZGUgY29uZmlybWFyJyArIChkYXlzQWdvID8gJyBoYWNlICcgKyBkYXlzQWdvICsgJyBkaWFzJyA6ICcnKSxcbiAgICAgIGFjY2lvbjogJ1JldmlzYXIgc3RvY2sgeSBsbGFtYXIgYWwgY2xpZW50ZScsXG4gICAgICB1bHRpbWFBY2Npb246ICdQZWRpZG86ICcgKyAoZHQgfHwgJyhzL2YpJyksXG4gICAgICBzdGF0dXM6IGRheXNBZ28gPj0gNSA/ICdyZWQnIDogJ3llbGxvdycsXG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gaXRlbXM7XG59XG5cbmZ1bmN0aW9uIGRldGVjdFNlZ1Npbk1vdmltaWVudG8odmlzaXRzLCBwZWRpZG9zKSB7XG4gIGNvbnN0IG1hcCA9IHt9O1xuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IGsgPSBzZWdNYWtlS2V5KHYudmVuZG9yLCB2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKTtcbiAgICBpZiAoIW1hcFtrXSlcbiAgICAgIG1hcFtrXSA9IHtcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcbiAgICAgICAgcHJvdjogdi5wcm92aW5jaWEsXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXG4gICAgICAgIG5hbWU6IHYudGllbmRhLFxuICAgICAgICBsYXN0VjogJycsXG4gICAgICAgIGxhc3RPOiAnJyxcbiAgICAgICAgZmFjdHVyYWNpb246IDAsXG4gICAgICB9O1xuICAgIGlmICgodi5mZWNoYSB8fCAnJykgPiBtYXBba10ubGFzdFYpIG1hcFtrXS5sYXN0ViA9IHYuZmVjaGE7XG4gIH0pO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCBrID0gc2VnTWFrZUtleShwLnZlbmRvciwgcC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpO1xuICAgIGlmICghbWFwW2tdKVxuICAgICAgbWFwW2tdID0ge1xuICAgICAgICB2ZW5kb3I6IHAudmVuZG9yLFxuICAgICAgICBwcm92OiBwLnByb3ZpbmNlLFxuICAgICAgICBsb2M6IHAubG9jTmFtZSxcbiAgICAgICAgbmFtZTogcC5jbGllbnROYW1lLFxuICAgICAgICBsYXN0VjogJycsXG4gICAgICAgIGxhc3RPOiAnJyxcbiAgICAgICAgZmFjdHVyYWNpb246IDAsXG4gICAgICB9O1xuICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgJiYgZHQgPiBtYXBba10ubGFzdE8pIG1hcFtrXS5sYXN0TyA9IGR0O1xuICAgIGlmIChwLnN0YWdlID09PSAnY29uZmlybWVkJykge1xuICAgICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyB8fCAwO1xuICAgICAgbWFwW2tdLmZhY3R1cmFjaW9uICs9ICthbXQgfHwgMDtcbiAgICB9XG4gIH0pO1xuICBjb25zdCBvdXQgPSBbXTtcbiAgT2JqZWN0LmVudHJpZXMobWFwKS5mb3JFYWNoKChbaywgY10pID0+IHtcbiAgICBjb25zdCBsYXN0VmRheXMgPSBjLmxhc3RWXG4gICAgICA/IE1hdGguZmxvb3IoKERhdGUubm93KCkgLSBuZXcgRGF0ZShjLmxhc3RWKS5nZXRUaW1lKCkpIC8gODY0MDAwMDApXG4gICAgICA6IEluZmluaXR5O1xuICAgIGNvbnN0IGxhc3RPZGF5cyA9IGMubGFzdE9cbiAgICAgID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGMubGFzdE8pLmdldFRpbWUoKSkgLyA4NjQwMDAwMClcbiAgICAgIDogSW5maW5pdHk7XG4gICAgaWYgKGxhc3RWZGF5cyA+IDMwICYmIGxhc3RPZGF5cyA+IDQ1KSB7XG4gICAgICBjb25zdCBsYXN0RGF5cyA9IE1hdGgubWluKGxhc3RWZGF5cywgbGFzdE9kYXlzKTtcbiAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgY2xpZW50S2V5OiBrLFxuICAgICAgICBjbGllbnQ6IGMubmFtZSxcbiAgICAgICAgdmVuZG9yOiBjLnZlbmRvcixcbiAgICAgICAgcHJvdjogYy5wcm92LFxuICAgICAgICBsb2M6IGMubG9jLFxuICAgICAgICBsYXN0VmlzaXQ6IGMubGFzdFYgfHwgJy0nLFxuICAgICAgICBsYXN0T3JkZXI6IGMubGFzdE8gfHwgJy0nLFxuICAgICAgICBkYXlzQWdvOiBOdW1iZXIuaXNGaW5pdGUobGFzdERheXMpID8gbGFzdERheXMgOiAnOTk5KycsXG4gICAgICAgIGZhY3R1cmFjaW9uOiBjLmZhY3R1cmFjaW9uLFxuICAgICAgICBhY2Npb246XG4gICAgICAgICAgYy5mYWN0dXJhY2lvbiA+IDBcbiAgICAgICAgICAgID8gJ1JlY29udGFjdGFyIC0gY2xpZW50ZSBjb24gaGlzdG9yaWFsJ1xuICAgICAgICAgICAgOiAnUmVjb250YWN0YXIgLSBwdWVkZSBzZXIgb3BvcnR1bmlkYWQnLFxuICAgICAgICBzdGF0dXM6IGMuZmFjdHVyYWNpb24gPiAxMDAwMDAgJiYgbGFzdERheXMgPiA2MCA/ICdyZWQnIDogJ3llbGxvdycsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gb3V0LnNvcnQoKGEsIGIpID0+IChiLmZhY3R1cmFjaW9uIHx8IDApIC0gKGEuZmFjdHVyYWNpb24gfHwgMCkpO1xufVxuXG5mdW5jdGlvbiBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgX3BlZGlkb3MpIHtcbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgY29uc3Qga2V5cyA9IFtcbiAgICAnaW50ZXJlc2FkJyxcbiAgICAncG90ZW5jaWFsJyxcbiAgICAnY2llcnJlJyxcbiAgICAncmVwb3NpY2knLFxuICAgICdvZmVydGEnLFxuICAgICdkZXNjdWVudG8nLFxuICAgICd2b2x2ZXInLFxuICAgICdjb3RpeicsXG4gIF07XG4gIHZpc2l0cy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdHh0ID0gKCh2LmNvbWVudGFyaW8gfHwgJycpICsgJyAnICsgKHYub2JzZXJ2YWNpb25lcyB8fCAnJykpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGtleXMuc29tZSgoa3cpID0+IHR4dC5pbmNsdWRlcyhrdykpKSB7XG4gICAgICBpdGVtcy5wdXNoKHtcbiAgICAgICAgY2xpZW50S2V5OiBzZWdNYWtlS2V5KHYudmVuZG9yLCB2LnByb3ZpbmNpYSwgdi5sb2NhbGlkYWQsIHYudGllbmRhKSxcbiAgICAgICAgY2xpZW50OiB2LnRpZW5kYSxcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcbiAgICAgICAgcHJvdjogdi5wcm92aW5jaWEsXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXG4gICAgICAgIHByb2JsZW1hOlxuICAgICAgICAgICdDb21lbnRhcmlvIGNvbWVyY2lhbDogXCInICsgKHYuY29tZW50YXJpbyB8fCB2Lm9ic2VydmFjaW9uZXMgfHwgJycpLnNsaWNlKDAsIDgwKSArICdcIicsXG4gICAgICAgIGFjY2lvbjogJ0Nvb3JkaW5hciBjaWVycmUgY29uIGVsIFZERScsXG4gICAgICAgIHVsdGltYUFjY2lvbjogJ1Zpc2l0YTogJyArICh2LmZlY2hhIHx8ICctJyksXG4gICAgICAgIHN0YXR1czogJ3llbGxvdycsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gaXRlbXM7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkU2VnRHVwbGFzKHZpc2l0cywgcGVkaWRvcykge1xuICBjb25zdCBleHRlcm5hbFRvSW50ZXJuYWwgPSB7fTtcbiAgT2JqZWN0LmVudHJpZXMoVkVORE9SX0lOQ0xVREVTX09USEVSUykuZm9yRWFjaCgoW2ludGVybm8sIGV4dF0pID0+XG4gICAgZXh0LmZvckVhY2goKGUpID0+IChleHRlcm5hbFRvSW50ZXJuYWxbZV0gPSBpbnRlcm5vKSlcbiAgKTtcbiAgY29uc3QgZHVwbGFzID0ge307XG4gIGNvbnN0IGVuc3VyZSA9IChpbnRlcm5vLCBleHRlcm5vKSA9PiB7XG4gICAgY29uc3QgayA9IGludGVybm8gKyAnICsgJyArIGV4dGVybm87XG4gICAgaWYgKCFkdXBsYXNba10pXG4gICAgICBkdXBsYXNba10gPSB7XG4gICAgICAgIGludGVybm8sXG4gICAgICAgIGV4dGVybm8sXG4gICAgICAgIHZpc2l0YXM6IDAsXG4gICAgICAgIHBlZGlkb3M6IDAsXG4gICAgICAgIHBlZGlkb3NDb25mOiAwLFxuICAgICAgICBmYWN0OiAwLFxuICAgICAgICBjbGllbnRlczogbmV3IFNldCgpLFxuICAgICAgICBwZW5kaWVudGVzOiAwLFxuICAgICAgICBsYXN0QWN0OiAnJyxcbiAgICAgIH07XG4gICAgcmV0dXJuIGR1cGxhc1trXTtcbiAgfTtcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCBpbnRlcm5vID0gZXh0ZXJuYWxUb0ludGVybmFsW3YudmVuZG9yXTtcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcbiAgICBjb25zdCBkID0gZW5zdXJlKGludGVybm8sIHYudmVuZG9yKTtcbiAgICBkLnZpc2l0YXMrKztcbiAgICBpZiAodi50aWVuZGEpIGQuY2xpZW50ZXMuYWRkKHYudGllbmRhICsgJ3wnICsgKHYubG9jYWxpZGFkIHx8ICcnKSk7XG4gICAgY29uc3QgZHQgPSAodi5mZWNoYSB8fCAnJykuc2xpY2UoMCwgMTApO1xuICAgIGlmIChkdCA+IGQubGFzdEFjdCkgZC5sYXN0QWN0ID0gZHQ7XG4gIH0pO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCBpbnRlcm5vID0gZXh0ZXJuYWxUb0ludGVybmFsW3AudmVuZG9yXTtcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcbiAgICBjb25zdCBkID0gZW5zdXJlKGludGVybm8sIHAudmVuZG9yKTtcbiAgICBkLnBlZGlkb3MrKztcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIHtcbiAgICAgIGQucGVkaWRvc0NvbmYrKztcbiAgICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcbiAgICAgIGQuZmFjdCArPSArYW10IHx8IDA7XG4gICAgfSBlbHNlIGlmIChwLnN0YWdlID09PSAncGVuZGluZycpIGQucGVuZGllbnRlcysrO1xuICAgIGlmIChwLmNsaWVudE5hbWUpIGQuY2xpZW50ZXMuYWRkKHAuY2xpZW50TmFtZSArICd8JyArIChwLmxvY05hbWUgfHwgJycpKTtcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XG4gICAgaWYgKGR0ID4gZC5sYXN0QWN0KSBkLmxhc3RBY3QgPSBkdDtcbiAgfSk7XG4gIHJldHVybiBkdXBsYXM7XG59XG5cbndpbmRvdy5yZW5kZXJTZWd1aW1pZW50b1RhYiA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFjYW5WaWV3U2VndWltaWVudG8oKSkge1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY29udGVudCcpLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+U2luIHBlcm1pc29zLjwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHsgdmlzaXRzLCBwZWRpZG9zIH0gPSBnZXRTZWdEYXRhc2V0KCk7XG4gIHJlbmRlclNlZ1RvcFN0YXRzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IHBlbmRpZW50ZXMgPSBkZXRlY3RTZWdQZW5kaWVudGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IGRlYWQgPSBkZXRlY3RTZWdTaW5Nb3ZpbWllbnRvKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IG9wcHMgPSBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY291bnQtdmlzaXRhcycpLnRleHRDb250ZW50ID0gdmlzaXRzLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1wZWRpZG9zJykudGV4dENvbnRlbnQgPSBwZWRpZG9zLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1wZW5kaWVudGVzJykudGV4dENvbnRlbnQgPSBwZW5kaWVudGVzLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1kZWFkJykudGV4dENvbnRlbnQgPSBkZWFkLmxlbmd0aDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1vcHAnKS50ZXh0Q29udGVudCA9IG9wcHMubGVuZ3RoO1xuICBjb25zdCB0YWIgPSBzZWdDdXJyZW50VGFiIHx8ICdyZXN1bWVuJztcbiAgY29uc3QgZiA9IGdldFNlZ0ZpbHRlcnMoKTtcbiAgY29uc3QgZmlsdGVyQnlFc3RhZG8gPSAoYXJyKSA9PlxuICAgIGYuZXN0YWRvID09PSAnQUxMJyA/IGFyciA6IGFyci5maWx0ZXIoKHgpID0+IHguc3RhdHVzID09PSBmLmVzdGFkbyk7XG4gIGxldCBodG1sID0gJyc7XG4gIGlmICh0YWIgPT09ICdyZXN1bWVuJykgaHRtbCA9IHJlbmRlclNlZ1Jlc3VtZW4odmlzaXRzLCBwZWRpZG9zKTtcbiAgZWxzZSBpZiAodGFiID09PSAndmlzaXRhcycpIHtcbiAgICBsZXQgcm93cyA9IHZpc2l0cy5zbGljZSgpO1xuICAgIGlmIChmLnNvbG9QZW5kKSB7XG4gICAgICBjb25zdCBwZW5kU2V0ID0gbmV3IFNldChwZW5kaWVudGVzLm1hcCgocCkgPT4gcC5jbGllbnRLZXkpKTtcbiAgICAgIHJvd3MgPSByb3dzLmZpbHRlcigodikgPT5cbiAgICAgICAgcGVuZFNldC5oYXMoc2VnTWFrZUtleSh2LnZlbmRvciwgdi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSkpXG4gICAgICApO1xuICAgIH1cbiAgICBodG1sID0gcmVuZGVyU2VnVmlzaXRhcyhyb3dzKTtcbiAgfSBlbHNlIGlmICh0YWIgPT09ICdwZWRpZG9zJykge1xuICAgIGxldCByb3dzID0gcGVkaWRvcy5zbGljZSgpO1xuICAgIGlmIChmLnNvbG9QZW5kKSByb3dzID0gcm93cy5maWx0ZXIoKHApID0+IHAuc3RhZ2UgPT09ICdwZW5kaW5nJyk7XG4gICAgaHRtbCA9IHJlbmRlclNlZ1BlZGlkb3Mocm93cyk7XG4gIH0gZWxzZSBpZiAodGFiID09PSAncGVuZGllbnRlcycpIGh0bWwgPSByZW5kZXJTZWdQZW5kaWVudGVzKGZpbHRlckJ5RXN0YWRvKHBlbmRpZW50ZXMpKTtcbiAgZWxzZSBpZiAodGFiID09PSAnZGVhZCcpIGh0bWwgPSByZW5kZXJTZWdEZWFkKGZpbHRlckJ5RXN0YWRvKGRlYWQpKTtcbiAgZWxzZSBpZiAodGFiID09PSAnb3BwJykgaHRtbCA9IHJlbmRlclNlZ09wcHMoZmlsdGVyQnlFc3RhZG8ob3BwcykpO1xuICBlbHNlIGlmICh0YWIgPT09ICdkdXBsYXMnKSBodG1sID0gcmVuZGVyU2VnRHVwbGFzKGJ1aWxkU2VnRHVwbGFzKHZpc2l0cywgcGVkaWRvcykpO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZnVuY3Rpb24gcmVuZGVyU2VnVG9wU3RhdHModmlzaXRzLCBwZWRpZG9zKSB7XG4gIGxldCBmYWN0ID0gMCxcbiAgICBjb25mID0gMCxcbiAgICBfcGVuZCA9IDAsXG4gICAgbGFzdEFjdCA9ICcnO1xuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIHtcbiAgICAgIGNvbmYrKztcbiAgICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcbiAgICAgIGZhY3QgKz0gK2FtdCB8fCAwO1xuICAgIH0gZWxzZSBpZiAocC5zdGFnZSA9PT0gJ3BlbmRpbmcnKSBfcGVuZCsrO1xuICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKSB8fCAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xuICAgIGlmIChkdCA+IGxhc3RBY3QpIGxhc3RBY3QgPSBkdDtcbiAgfSk7XG4gIHZpc2l0cy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgZCA9ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCk7XG4gICAgaWYgKGQgPiBsYXN0QWN0KSBsYXN0QWN0ID0gZDtcbiAgfSk7XG4gIGNvbnN0IHBlbmRpZW50ZXMgPSBkZXRlY3RTZWdQZW5kaWVudGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IGRlYWQgPSBkZXRlY3RTZWdTaW5Nb3ZpbWllbnRvKHZpc2l0cywgcGVkaWRvcyk7XG4gIGNvbnN0IG9wcHMgPSBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgcGVkaWRvcyk7XG4gIC8vIHY0NDM6IHNlcGFyYXIgdmlzaXRhcyBwcmVzZW5jaWFsZXMgZGUgY29udGFjdG9zIG5vIHByZXNlbmNpYWxlcy5cbiAgY29uc3QgdmlzaXRhc1ByZXMgPSB2aXNpdHMuZmlsdGVyKCh2KSA9PiAhaXNDb250YWN0byh2KSkubGVuZ3RoO1xuICBjb25zdCBjb250YWN0b3MgPSB2aXNpdHMuZmlsdGVyKGlzQ29udGFjdG8pLmxlbmd0aDtcbiAgY29uc3QgY29udiA9IHZpc2l0cy5sZW5ndGggPiAwID8gTWF0aC5yb3VuZCgoY29uZiAvIHZpc2l0cy5sZW5ndGgpICogMTAwKSA6IDA7XG4gIGNvbnN0IGZtdE1vbiA9IChuKSA9PiAnJCcgKyBNYXRoLnJvdW5kKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xuICBjb25zdCBodG1sID1cbiAgICAnJyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCB2aXNpdGFzXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xuICAgIHZpc2l0YXNQcmVzICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPlZpc2l0YXM8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGNvbnRhY3Rvc1wiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBjb250YWN0b3MgK1xuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+Q29udGFjdG9zPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBwZWRpZG9zXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xuICAgIHBlZGlkb3MubGVuZ3RoICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPlBlZGlkb3M8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGZhY3RcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXG4gICAgZm10TW9uKGZhY3QpICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPkZhY3R1cmFkbzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgcGVuZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBwZW5kaWVudGVzLmxlbmd0aCArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5QZW5kaWVudGVzPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBvcHBcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXG4gICAgb3Bwcy5sZW5ndGggK1xuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+T3BvcnR1bmlkYWRlczwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgZGVhZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBkZWFkLmxlbmd0aCArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5TaW4gbW92aW1pZW50bzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgY29udlwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcbiAgICBjb252ICtcbiAgICAnJTwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5Db252IHYmcmFycjtwPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdFwiPjxkaXYgY2xhc3M9XCJudW1cIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4XCI+JyArXG4gICAgKGxhc3RBY3QgfHwgJy0nKSArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5VbHRpbWEgYWN0aXZpZGFkPC9kaXY+PC9kaXY+JztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1zdGF0cycpLmlubmVySFRNTCA9IGh0bWw7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNlZ1Jlc3VtZW4odmlzaXRzLCBwZWRpZG9zKSB7XG4gIGNvbnN0IGFnZyA9IGJ1aWxkU2VnQWdncmVnYXRlcyh2aXNpdHMsIHBlZGlkb3MpO1xuICBsZXQgaHRtbCA9ICcnO1xuICBPYmplY3QuZW50cmllcyhhZ2cpXG4gICAgLnNvcnQoKVxuICAgIC5mb3JFYWNoKChbdmVuZG9yLCBiXSkgPT4ge1xuICAgICAgY29uc3QgY29udiA9IGIudmlzaXRzID8gTWF0aC5yb3VuZCgoYi5wZWRpZG9zIC8gYi52aXNpdHMpICogMTAwKSA6IDA7XG4gICAgICBjb25zdCBsYXN0RGF5cyA9IGIubGFzdEFjdGl2aXR5XG4gICAgICAgID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGIubGFzdEFjdGl2aXR5KS5nZXRUaW1lKCkpIC8gODY0MDAwMDApXG4gICAgICAgIDogSW5maW5pdHk7XG4gICAgICBjb25zdCBjYXJkQ2xzID0gbGFzdERheXMgPiA3ID8gJ3llbGxvdycgOiBsYXN0RGF5cyA+IDE1ID8gJ3JlZCcgOiAnJztcbiAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctdmVuZG9yLWNhcmQgJyArIGNhcmRDbHMgKyAnXCI+JztcbiAgICAgIGh0bWwgKz0gJzxoND4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpKSArICc8L2g0Pic7XG4gICAgICBodG1sICs9XG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1ldHJpY3NcIj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgICBiLnZpc2l0cyArXG4gICAgICAgICc8L2I+VmlzaXRhczwvZGl2PicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICAgIGIuY29udGFjdG9zICtcbiAgICAgICAgJzwvYj5Db250YWN0b3M8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgICBiLnBlZGlkb3MgK1xuICAgICAgICAnPC9iPlBlZGlkb3M8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPiQnICtcbiAgICAgICAgTWF0aC5yb3VuZChiLmZhY3R1cmFjaW9uKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAgICc8L2I+RmFjdHVyYWNpb248L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xuICAgICAgICBiLmNsaWVudHNBY3RpdmUuc2l6ZSArXG4gICAgICAgICc8L2I+Q2xpZW50ZXMgYWN0aXZvczwvZGl2PicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICAgIGIuY2xpZW50c1Zpc2l0ZWQuc2l6ZSArXG4gICAgICAgICc8L2I+Q2xpZW50ZXMgdmlzaXRhZG9zPC9kaXY+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgICAgYi5wZW5kaWVudGVzUGVkaWRvcyArXG4gICAgICAgICc8L2I+UGVuZC4gY29uZmlybWFyPC9kaXY+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgICAgY29udiArXG4gICAgICAgICclPC9iPkNvbnYuIHYmcmFycjtwPC9kaXY+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgICAgKGIubGFzdEFjdGl2aXR5IHx8ICctJykgK1xuICAgICAgICAnPC9iPlVsdC4gYWN0aXZpZGFkPC9kaXY+JyArXG4gICAgICAgICc8L2Rpdj48L2Rpdj4nO1xuICAgIH0pO1xuICBpZiAoIWh0bWwpIGh0bWwgPSAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGhheSB2ZW5kZWRvcmVzIGV4dGVybm9zIGVuIGVsIHNjb3BlLjwvZGl2Pic7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTZWdWaXNpdGFzKHZpc2l0cykge1xuICBpZiAoIXZpc2l0cy5sZW5ndGgpIHJldHVybiAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGhheSB2aXNpdGFzIGVuIGVsIHJhbmdvLjwvZGl2Pic7XG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcbiAgY29uc3QgY2FuRGVsID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJztcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5GZWNoYTwvZGl2PjxkaXY+VmVuZGVkb3I8L2Rpdj48ZGl2PkNsaWVudGUgLyBUaWVuZGE8L2Rpdj48ZGl2PkxvY2FsaWRhZDwvZGl2PjxkaXY+T2JzZXJ2YWNpb25lczwvZGl2PjwvZGl2Pic7XG4gIHNvcnRlZC5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xuICAgIGNvbnN0IGRlbEJ0biA9XG4gICAgICBjYW5EZWwgJiYgdi5pZFxuICAgICAgICA/ICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7ZGVsZXRlU2VnVmlzaXRhKFxcJycgK1xuICAgICAgICAgIGVzY2FwZUF0dHIodi5pZCkgK1xuICAgICAgICAgIFwiJywnXCIgK1xuICAgICAgICAgIGVzY2FwZUF0dHIodi50aWVuZGEgfHwgJycpICtcbiAgICAgICAgICAnXFwnKVwiIHRpdGxlPVwiRWxpbWluYXIgZXN0YSB2aXNpdGEgKGFkbWluL2dlcmVudGUpXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo2cHg7cGFkZGluZzozcHggOHB4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3ItZGFuZ2VyKTtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2N1cnNvcjpwb2ludGVyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4XCI+Qm9ycmFyPC9idXR0b24+J1xuICAgICAgICA6ICcnO1xuICAgIC8vIHY0NDM6IGJhZGdlIHRpcG8gKFZJU0lUQSBwcmVzZW5jaWFsIHZzIENPTlRBQ1RPIG5vIHByZXNlbmNpYWwpLlxuICAgIGNvbnN0IGNvbnRhY3RvID0gaXNDb250YWN0byh2KTtcbiAgICBjb25zdCB0aXBvQmFkZ2UgPSBjb250YWN0b1xuICAgICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOiNjY2ZiZjE7Y29sb3I6IzBkNWM1Njtmb250LXNpemU6OHB4O2ZvbnQtd2VpZ2h0OjgwMDtwYWRkaW5nOjJweCA1cHg7Ym9yZGVyLXJhZGl1czozcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWxlZnQ6NnB4XCI+Q29udGFjdG88L3NwYW4+J1xuICAgICAgOiAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOiNlZGU5ZmU7Y29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7Zm9udC1zaXplOjhweDtmb250LXdlaWdodDo4MDA7cGFkZGluZzoycHggNXB4O2JvcmRlci1yYWRpdXM6M3B4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1sZWZ0OjZweFwiPlZpc2l0YTwvc3Bhbj4nO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihrKSArICdcXCcpXCI+JztcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKCh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJy0nKSArIHRpcG9CYWRnZSArICc8L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSkgKyAnPC9kaXY+JztcbiAgICBodG1sICs9ICc8ZGl2PjxiPicgKyBlc2NhcGVIdG1sKHYudGllbmRhIHx8ICctJykgKyAnPC9iPjwvZGl2Pic7XG4gICAgaHRtbCArPSAnPGRpdj4nICsgZXNjYXBlSHRtbCh2LmxvY2FsaWRhZCB8fCAnLScpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwoKHYuY29tZW50YXJpbyB8fCB2Lm9ic2VydmFjaW9uZXMgfHwgJycpLnNsaWNlKDAsIDE0MCkpICtcbiAgICAgICh2LnByb3hpbWFBY2Npb25cbiAgICAgICAgPyAnPGJyPjxzcGFuIHN0eWxlPVwiY29sb3I6IzBkOTQ4ODtmb250LXdlaWdodDo3MDBcIj5Qcm94aW1hOiAnICtcbiAgICAgICAgICBlc2NhcGVIdG1sKHYucHJveGltYUFjY2lvbikgK1xuICAgICAgICAgICc8L3NwYW4+J1xuICAgICAgICA6ICcnKSArXG4gICAgICBkZWxCdG4gK1xuICAgICAgJzwvZGl2Pic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSk7XG4gIHJldHVybiBodG1sO1xufVxuXG4vLyBFbGltaW5hIHVuYSB2aXNpdGEuIFNvbG8gYWRtaW4vZ2VyZW50ZSAobGFzIHJ1bGVzIGFkZW1hcyBhdXRvcml6YW4gYWxcbi8vIG93bmVyLCBwZXJvIGRlc2RlIFNlZ3VpbWllbnRvIGxhIGFjY2lvbiBlcyBkZSByZXZpc2lvbi9saW1waWV6YSkuXG53aW5kb3cuZGVsZXRlU2VnVmlzaXRhID0gYXN5bmMgZnVuY3Rpb24gKHZpc2l0SWQsIHRpZW5kYSkge1xuICBpZiAoIXZpc2l0SWQpIHJldHVybjtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGUgZWxpbWluYXIgdmlzaXRhcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgbGJsID0gdGllbmRhID8gJ1wiJyArIHRpZW5kYSArICdcIicgOiAnZXN0YSB2aXNpdGEnO1xuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnRWxpbWluYXIgbGEgdmlzaXRhIGEgJyArXG4gICAgICAgIGxibCArXG4gICAgICAgICcgZGVsIGhpc3RvcmlhbD9cXG5cXG5Fc3RhIGFjY2lvbiBlcyBJUlJFVkVSU0lCTEU6IGxhIHZpc2l0YSBkZXNhcGFyZWNlIGRlIFNlZ3VpbWllbnRvLCBydXRhcywgZGFzaGJvYXJkIHkgc3RhdHMgZGVsIHZlbmRlZG9yIGV4dGVybm8uJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmRvYyh2aXNpdElkKS5kZWxldGUoKTtcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnVmlzaXRhIGVsaW1pbmFkYScpO1xuICAgIC8vIFJlLWZldGNoIGxvY2FsIChubyBoYXkgbGlzdGVuZXIgZGUgdmlzaXRzIGdsb2JhbCkuIERlc3B1ZXMgcmUtcmVuZGVyLlxuICAgIGF3YWl0IGxvYWRTZWdWaXNpdHMoKTtcbiAgICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlU2VnVmlzaXRhJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHJlbmRlclNlZ1BlZGlkb3MocGVkaWRvcykge1xuICBpZiAoIXBlZGlkb3MubGVuZ3RoKSByZXR1cm4gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5ObyBoYXkgcGVkaWRvcyBlbiBlbCByYW5nby48L2Rpdj4nO1xuICBjb25zdCBzb3J0ZWQgPSBwZWRpZG9zXG4gICAgLnNsaWNlKClcbiAgICAuc29ydCgoYSwgYikgPT5cbiAgICAgIChiLmNvbmZpcm1lZEF0IHx8IGIuZmluYWxpemVkQXQgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5jb25maXJtZWRBdCB8fCBhLmZpbmFsaXplZEF0IHx8ICcnKVxuICAgICk7XG4gIGNvbnN0IGNhbkRlbCA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cInNlZy1yb3cgaGVhZFwiPjxkaXY+RmVjaGE8L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlPC9kaXY+PGRpdj5VbmlkYWRlczwvZGl2PjxkaXY+SW1wb3J0ZSArIEVzdGFkbzwvZGl2PjwvZGl2Pic7XG4gIHNvcnRlZC5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkocC52ZW5kb3IsIHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKTtcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8IHAuZmluYWxpemVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcbiAgICBjb25zdCB1bml0cyA9IChwLmxpbmVzIHx8IFtdKS5yZWR1Y2UoKHMsIGwpID0+IHMgKyAocGFyc2VGbG9hdChsLnF0eSkgfHwgMCksIDApO1xuICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcbiAgICBjb25zdCBiYWRnZUNscyA9IHAuc3RhZ2UgPT09ICdjb25maXJtZWQnID8gJ2dyZWVuJyA6ICd5ZWxsb3cnO1xuICAgIGNvbnN0IGJhZGdlVHh0ID0gcC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgPyAnQ29uZmlybWFkbycgOiAnUGVuZGllbnRlJztcbiAgICAvLyBCb3RvbiBFTElNSU5BUjogc29sbyBhZG1pbi9nZXJlbnRlLiBVdGlsIHBhcmEgbGltcGlhciBwZWRpZG9zIFRFU1QuXG4gICAgLy8gc3RvcFByb3BhZ2F0aW9uIGV2aXRhIHF1ZSBlbCBjbGljayBkaXNwYXJlIGVsIHRpbWVsaW5lIGRlbCBjbGllbnRlLlxuICAgIGNvbnN0IGRlbEJ0biA9XG4gICAgICBjYW5EZWwgJiYgcC5fZnNJZFxuICAgICAgICA/ICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7ZGVsZXRlU2VnUGVkaWRvKFxcJycgK1xuICAgICAgICAgIGVzY2FwZUF0dHIocC5fZnNJZCkgK1xuICAgICAgICAgIFwiJywnXCIgK1xuICAgICAgICAgIGVzY2FwZUF0dHIocC5jbGllbnROYW1lIHx8ICcnKSArXG4gICAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkVsaW1pbmFyIGVzdGUgcGVkaWRvIGRlbCBoaXN0b3JpYWwgKGFkbWluL2dlcmVudGUpXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo4cHg7cGFkZGluZzozcHggOHB4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3ItZGFuZ2VyKTtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2N1cnNvcjpwb2ludGVyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4XCI+Qm9ycmFyPC9idXR0b24+J1xuICAgICAgICA6ICcnO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihrKSArICdcXCcpXCI+JztcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKGR0IHx8ICctJykgKyAnPC9kaXY+JztcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXY+PGI+JyArXG4gICAgICBlc2NhcGVIdG1sKHAuY2xpZW50TmFtZSB8fCAnLScpICtcbiAgICAgICc8L2I+PGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwocC5sb2NOYW1lIHx8ICcnKSArXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XG4gICAgaHRtbCArPSAnPGRpdj4nICsgdW5pdHMudG9GaXhlZCgwKSArICcgdTwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXY+JCcgK1xuICAgICAgTWF0aC5yb3VuZChhbXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICcgPHNwYW4gY2xhc3M9XCJzZWctYmFkZ2UgJyArXG4gICAgICBiYWRnZUNscyArXG4gICAgICAnXCI+JyArXG4gICAgICBiYWRnZVR4dCArXG4gICAgICAnPC9zcGFuPicgK1xuICAgICAgZGVsQnRuICtcbiAgICAgICc8L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH0pO1xuICByZXR1cm4gaHRtbDtcbn1cblxuLy8gRWxpbWluYSB1biBwZWRpZG8gZGVsIGhpc3RvcmlhbC4gU29sbyBhZG1pbi9nZXJlbnRlLiBMYXMgcnVsZXMgeWEgbG9cbi8vIHBlcm1pdGVuIHZpYSAnYWxsb3cgdXBkYXRlLCBkZWxldGU6IGlmIGlzQWRtaW5PckdlcmVudGUoKSB8fCAuLi4nLlxuLy8gUGVuc2FkbyBwYXJhIGxpbXBpYXIgcGVkaWRvcyBkZSBURVNUIG8gZHVwbGljYWRvcyBzaW4gdGVuZXIgcXVlIHNhbGlyXG4vLyBkZSBTZWd1aW1pZW50by4gQWN0aW9uIGlycmV2ZXJzaWJsZTogYm9ycmEgZWwgZG9jIGVuIC9wZWRpZG9zL3tpZH0uXG53aW5kb3cuZGVsZXRlU2VnUGVkaWRvID0gYXN5bmMgZnVuY3Rpb24gKGZzSWQsIGNsaWVudE5hbWUpIHtcbiAgaWYgKCFmc0lkKSByZXR1cm47XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGVsaW1pbmFyIHBlZGlkb3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGxibCA9IGNsaWVudE5hbWUgPyAnXCInICsgY2xpZW50TmFtZSArICdcIicgOiAnZXN0ZSBwZWRpZG8nO1xuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnRWxpbWluYXIgZWwgcGVkaWRvIGRlICcgK1xuICAgICAgICBsYmwgK1xuICAgICAgICAnIGRlbCBoaXN0b3JpYWw/XFxuXFxuRXN0YSBhY2Npb24gZXMgSVJSRVZFUlNJQkxFOiBlbCBwZWRpZG8gZGVzYXBhcmVjZSBkZSBTZWd1aW1pZW50bywgRGFzaGJvYXJkLCBleHBvcnRzIHkgY2FtcGFcdTAwRjFhcy4nXG4gICAgKVxuICApXG4gICAgcmV0dXJuO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmRvYyhmc0lkKS5kZWxldGUoKTtcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnUGVkaWRvIGVsaW1pbmFkbycpO1xuICAgIC8vIEVsIGxpc3RlbmVyIGdsb2JhbCBkZSBwZWRpZG9zIHJlZnJlc2NhIGdsb2JhbFBlZGlkb3Mgc29sby4gUGVyb1xuICAgIC8vIHBvciB0aW1pbmcsIGZvcnphbW9zIHVuIHJlLXJlbmRlciBwb3Igc2kgdG9kYXZpYSBubyBsbGVnbyBlbFxuICAgIC8vIHNuYXBzaG90IHVwZGF0ZWQuXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfSwgMjUwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZVNlZ1BlZGlkbycsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiByZW5kZXJTZWdQZW5kaWVudGVzKGl0ZW1zKSB7XG4gIGlmICghaXRlbXMubGVuZ3RoKSByZXR1cm4gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5TaW4gcGVuZGllbnRlcyBlbiBlbCByYW5nby48L2Rpdj4nO1xuICBpdGVtcyA9IGl0ZW1zLnNsaWNlKCkuc29ydCgoYSwgX2IpID0+IChhLnN0YXR1cyA9PT0gJ3JlZCcgPyAtMSA6IDEpKTtcbiAgY29uc3QgY2FuRGVsID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJztcbiAgY29uc3QgaXNTZWdVc2VyID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJyB8fCB1c2VyUm9sZSA9PT0gJ2ludGVybm8nO1xuICBsZXQgaHRtbCA9XG4gICAgJzxkaXYgY2xhc3M9XCJzZWctcm93IGhlYWRcIj48ZGl2PkVzdGFkbzwvZGl2PjxkaXY+VmVuZGVkb3I8L2Rpdj48ZGl2PkNsaWVudGU8L2Rpdj48ZGl2PlVsdC4gYWNjaW9uPC9kaXY+PGRpdj5Qcm9ibGVtYSArIGFjY2lvbiBzdWdlcmlkYTwvZGl2PjwvZGl2Pic7XG4gIGl0ZW1zLmZvckVhY2goKGl0KSA9PiB7XG4gICAgY29uc3QgbGJsID0gaXQuc3RhdHVzID09PSAncmVkJyA/ICdDUklUSUNPJyA6IGl0LnN0YXR1cyA9PT0gJ3llbGxvdycgPyAnUkVWSVNBUicgOiAnT0snO1xuICAgIC8vIEJvdG9uIGRlIGVsaW1pbmFyL3Jlc29sdmVyIHNlZ3VuIG9yaWdlbiBkZWwgcGVuZGllbnRlOlxuICAgIC8vIC0gcGVkaWRvLXBlbmRpbmc6IGJvcnJhciBlbCBkb2MgZGVsIHBlZGlkbyAoc29sbyBhZG1pbi9nZXJlbnRlKS5cbiAgICAvLyAtIHZpc2l0LW5vLW9yZGVyOiBtYXJjYXIgZWwgY2xpZW50S2V5IGNvbW8gJ3Jlc3VlbHRvJyBlblxuICAgIC8vIHNlZ3VpbWllbnRvX3N0YXR1cyBwYXJhIHF1ZSBkZXRlY3RTZWdQZW5kaWVudGVzIGxvIG9jdWx0ZVxuICAgIC8vIChjdWFscXVpZXIgdXNlciBkZSBTZWd1aW1pZW50byBwdWVkZSByZXNvbHZlcmxvKS5cbiAgICBsZXQgYWN0aW9uQnRuID0gJyc7XG4gICAgaWYgKGl0LmtpbmQgPT09ICdwZWRpZG8tcGVuZGluZycgJiYgY2FuRGVsICYmIGl0LnBlZGlkb0ZzSWQpIHtcbiAgICAgIGFjdGlvbkJ0biA9XG4gICAgICAgICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7ZGVsZXRlU2VnUGVkaWRvKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKGl0LnBlZGlkb0ZzSWQpICtcbiAgICAgICAgXCInLCdcIiArXG4gICAgICAgIGVzY2FwZUF0dHIoaXQuY2xpZW50IHx8ICcnKSArXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJFbGltaW5hciBlbCBwZWRpZG8gcGVuZGllbnRlIGRlbCBoaXN0b3JpYWwgKGFkbWluL2dlcmVudGUpXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo2cHg7cGFkZGluZzozcHggOHB4O2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3ItZGFuZ2VyKTtjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2N1cnNvcjpwb2ludGVyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4XCI+Qm9ycmFyIHBlZGlkbzwvYnV0dG9uPic7XG4gICAgfSBlbHNlIGlmIChpdC5raW5kID09PSAndmlzaXQtbm8tb3JkZXInICYmIGlzU2VnVXNlcikge1xuICAgICAgYWN0aW9uQnRuID1cbiAgICAgICAgJyA8YnV0dG9uIG9uY2xpY2s9XCJldmVudC5zdG9wUHJvcGFnYXRpb24oKTtzZXRTZWdTdGF0dXMoXFwnJyArXG4gICAgICAgIGVzY2FwZUF0dHIoaXQuY2xpZW50S2V5KSArXG4gICAgICAgICdcXCcsXFwncmVzdWVsdG9cXCcpXCIgdGl0bGU9XCJNYXJjYXIgZXN0ZSBjbGllbnRlIGNvbW8gcmVzdWVsdG8gLSBzZSBvY3VsdGEgZGUgUGVuZGllbnRlcyAobm8gYm9ycmEgdmlzaXRhcylcIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OjZweDtwYWRkaW5nOjNweCA4cHg7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDA7Y3Vyc29yOnBvaW50ZXI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4zcHhcIj4mIzEwMDAzOyBSZXNvbHZlcjwvYnV0dG9uPic7XG4gICAgfVxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihpdC5jbGllbnRLZXkpICsgJ1xcJylcIj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2PjxzcGFuIGNsYXNzPVwic2VnLXN0YXR1cy1kb3QgJyArXG4gICAgICBpdC5zdGF0dXMgK1xuICAgICAgJ1wiPjwvc3Bhbj48c3BhbiBjbGFzcz1cInNlZy1iYWRnZSAnICtcbiAgICAgIGl0LnN0YXR1cyArXG4gICAgICAnXCI+JyArXG4gICAgICBsYmwgK1xuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKGl0LnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXY+PGI+JyArXG4gICAgICBlc2NhcGVIdG1sKGl0LmNsaWVudCB8fCAnLScpICtcbiAgICAgICc8L2I+PGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwoaXQubG9jIHx8ICcnKSArXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgZXNjYXBlSHRtbChpdC51bHRpbWFBY2Npb24gfHwgJy0nKSArXG4gICAgICAnPC9kaXY+JztcbiAgICBodG1sICs9XG4gICAgICAnPGRpdj48Yj4nICtcbiAgICAgIGVzY2FwZUh0bWwoaXQucHJvYmxlbWEgfHwgJy0nKSArXG4gICAgICAnPC9iPjxicj48c3BhbiBzdHlsZT1cImNvbG9yOiMwZDk0ODg7Zm9udC13ZWlnaHQ6NzAwXCI+JnJhcnI7ICcgK1xuICAgICAgZXNjYXBlSHRtbChpdC5hY2Npb24gfHwgJycpICtcbiAgICAgICc8L3NwYW4+JyArXG4gICAgICBhY3Rpb25CdG4gK1xuICAgICAgJzwvZGl2Pic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSk7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTZWdEZWFkKGl0ZW1zKSB7XG4gIGlmICghaXRlbXMubGVuZ3RoKVxuICAgIHJldHVybiAoXG4gICAgICAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPlRvZG9zIGxvcyBjbGllbnRlcyB0dXZpZXJvbiBhY3RpdmlkYWQgcmVjaWVudGUuICcgK1xuICAgICAgJ1VtYnJhbGVzIGFwbGljYWRvczogc2luIHZpc2l0YSAzMGQgWSBzaW4gcGVkaWRvIDQ1ZC48L2Rpdj4nXG4gICAgKTtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5Fc3RhZG88L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlPC9kaXY+PGRpdj5EaWFzIHNpbiBhY3QuPC9kaXY+PGRpdj5VbHQuIHZpc2l0YSAvIHBlZGlkbyArIGZhY3R1cmFjaW9uICsgYWNjaW9uPC9kaXY+PC9kaXY+JztcbiAgaXRlbXMuZm9yRWFjaCgoaXQpID0+IHtcbiAgICBjb25zdCBsYmwgPSBpdC5zdGF0dXMgPT09ICdyZWQnID8gJ0NSSVRJQ08nIDogJ1JFVklTQVInO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihpdC5jbGllbnRLZXkpICsgJ1xcJylcIj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2PjxzcGFuIGNsYXNzPVwic2VnLXN0YXR1cy1kb3QgJyArXG4gICAgICBpdC5zdGF0dXMgK1xuICAgICAgJ1wiPjwvc3Bhbj48c3BhbiBjbGFzcz1cInNlZy1iYWRnZSAnICtcbiAgICAgIGl0LnN0YXR1cyArXG4gICAgICAnXCI+JyArXG4gICAgICBsYmwgK1xuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKGl0LnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXY+PGI+JyArXG4gICAgICBlc2NhcGVIdG1sKGl0LmNsaWVudCB8fCAnLScpICtcbiAgICAgICc8L2I+PGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwoaXQubG9jIHx8ICcnKSArXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XG4gICAgaHRtbCArPSAnPGRpdj48YiBzdHlsZT1cImNvbG9yOnZhcigtLWNvbG9yLWRhbmdlcilcIj4nICsgaXQuZGF5c0FnbyArICdkPC9iPjwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXY+VmlzaXRhOiAnICtcbiAgICAgIGVzY2FwZUh0bWwoaXQubGFzdFZpc2l0IHx8ICctJykgK1xuICAgICAgJyAmbWlkZG90OyBQZWRpZG86ICcgK1xuICAgICAgZXNjYXBlSHRtbChpdC5sYXN0T3JkZXIgfHwgJy0nKSArXG4gICAgICAoaXQuZmFjdHVyYWNpb25cbiAgICAgICAgPyAnPGJyPkZhY3R1cmFjaW9uIGhpc3RvcmljYTogPGI+JCcgK1xuICAgICAgICAgIE1hdGgucm91bmQoaXQuZmFjdHVyYWNpb24pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICAgICAnPC9iPidcbiAgICAgICAgOiAnJykgK1xuICAgICAgJzxicj48c3BhbiBzdHlsZT1cImNvbG9yOiMwZDk0ODg7Zm9udC13ZWlnaHQ6NzAwXCI+JnJhcnI7ICcgK1xuICAgICAgZXNjYXBlSHRtbChpdC5hY2Npb24gfHwgJycpICtcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuICB9KTtcbiAgcmV0dXJuIGh0bWw7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNlZ09wcHMoaXRlbXMpIHtcbiAgaWYgKCFpdGVtcy5sZW5ndGgpXG4gICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Tm8gZGV0ZWN0JmVhY3V0ZTsgb3BvcnR1bmlkYWRlcyBlbiBlbCByYW5nby48YnI+TGFzIG9wb3J0dW5pZGFkZXMgc2UgZGV0ZWN0YW4gcG9yIHBhbGFicmFzIGNsYXZlIGVuIGxvcyBjb21lbnRhcmlvcyBkZSB2aXNpdGEgKGludGVyZXNhZG8sIHBvdGVuY2lhbCwgY2llcnJlLCByZXBvc2ljaW9uLCBjb3RpemEuLi4pLjwvZGl2Pic7XG4gIHJldHVybiByZW5kZXJTZWdQZW5kaWVudGVzKGl0ZW1zKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyU2VnRHVwbGFzKGR1cGxhcykge1xuICBjb25zdCBhcnIgPSBPYmplY3QudmFsdWVzKGR1cGxhcyk7XG4gIGlmICghYXJyLmxlbmd0aCkgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Tm8gaGF5IGR1cGxhcyBjb24gYWN0aXZpZGFkIGVuIGVsIHJhbmdvLjwvZGl2Pic7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1ib3R0b206OHB4O2ZvbnQtd2VpZ2h0OjcwMDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6I2YwZmRmYTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjVweFwiPlRhc2EgZGUgY29udmVyc2lvbiB2aXNpdGEgJnJhcnI7IHBlZGlkbyA9IHBlZGlkb3MgY29uZmlybWFkb3MgLyB2aXNpdGFzLiBFcyBsYSBtZXRyaWNhIGNsYXZlIHBhcmEgZXZhbHVhciBzaSBsYXMgdmlzaXRhcyBnZW5lcmFuIG5lZ29jaW8gcmVhbC48L2Rpdj4nO1xuICBhcnIuc29ydCgoYSwgYikgPT4gKGIuZmFjdCB8fCAwKSAtIChhLmZhY3QgfHwgMCkpO1xuICBhcnIuZm9yRWFjaCgoZCkgPT4ge1xuICAgIGNvbnN0IGNvbnYgPSBkLnZpc2l0YXMgPyBNYXRoLnJvdW5kKChkLnBlZGlkb3NDb25mIC8gZC52aXNpdGFzKSAqIDEwMCkgOiAwO1xuICAgIGNvbnN0IGNscyA9IGNvbnYgPj0gNTAgPyAnJyA6IGNvbnYgPj0gMjUgPyAneWVsbG93JyA6ICdyZWQnO1xuICAgIGNvbnN0IGNvbnZCZyA9IGNvbnYgPj0gNTAgPyAnI2RjZmNlNycgOiBjb252ID49IDI1ID8gJyNmZWYzYzcnIDogJyNmZWUyZTInO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctdmVuZG9yLWNhcmQgJyArIGNscyArICdcIj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8aDQ+JyArXG4gICAgICBlc2NhcGVIdG1sKHRpdGxlQ2FzZShkLmludGVybm8pKSArXG4gICAgICAnICZtaWRkb3Q7ICcgK1xuICAgICAgZXNjYXBlSHRtbCh0aXRsZUNhc2UoZC5leHRlcm5vKSkgK1xuICAgICAgJzwvaDQ+JztcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cInZtZXRyaWNzXCI+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICBkLnZpc2l0YXMgK1xuICAgICAgJzwvYj5WaXNpdGFzPC9kaXY+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICBkLnBlZGlkb3MgK1xuICAgICAgJzwvYj5QZWRpZG9zPC9kaXY+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICBkLnBlZGlkb3NDb25mICtcbiAgICAgICc8L2I+Q29uZmlybWFkb3M8L2Rpdj4nICtcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIiBzdHlsZT1cImJhY2tncm91bmQ6JyArXG4gICAgICBjb252QmcgK1xuICAgICAgJ1wiPjxiPicgK1xuICAgICAgY29udiArXG4gICAgICAnJTwvYj5Db252IHYmcmFycjtwPC9kaXY+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JCcgK1xuICAgICAgTWF0aC5yb3VuZChkLmZhY3QpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICc8L2I+RmFjdHVyYWNpb248L2Rpdj4nICtcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgIGQuY2xpZW50ZXMuc2l6ZSArXG4gICAgICAnPC9iPkNsaWVudGVzPC9kaXY+JyArXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXG4gICAgICBkLnBlbmRpZW50ZXMgK1xuICAgICAgJzwvYj5QZW5kLiBjb25maXJtYXI8L2Rpdj4nICtcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcbiAgICAgIChkLmxhc3RBY3QgfHwgJy0nKSArXG4gICAgICAnPC9iPlVsdC4gYWN0aXZpZGFkPC9kaXY+JyArXG4gICAgICAnPC9kaXY+PC9kaXY+JztcbiAgfSk7XG4gIHJldHVybiBodG1sO1xufVxuXG53aW5kb3cub3BlblNlZ1RpbWVsaW5lID0gZnVuY3Rpb24gKGNsaWVudEtleSkge1xuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSByZXR1cm47XG4gIGNvbnN0IHBhcnRzID0gKGNsaWVudEtleSB8fCAnJykuc3BsaXQoJ3wnKTtcbiAgY29uc3QgdmVuZG9yID0gcGFydHNbMF0sXG4gICAgcHJvdiA9IHBhcnRzWzFdLFxuICAgIGxvYyA9IHBhcnRzWzJdLFxuICAgIG5hbWUgPSBwYXJ0c1szXTtcbiAgaWYgKCF2ZW5kb3JJblNlZ3VpbWllbnRvU2NvcGUodmVuZG9yKSkge1xuICAgIGFsZXJ0KCdObyB0ZW5lcyBwZXJtaXNvcyBwYXJhIHZlciBlc3RlIGNsaWVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGN1cnJlbnRTZWdUaW1lbGluZUtleSA9IGNsaWVudEtleTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10bC10aXRsZScpLnRleHRDb250ZW50ID0gbmFtZSB8fCAnKGNsaWVudGUpJztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10bC1zdWInKS5pbm5lckhUTUwgPVxuICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKHZlbmRvciB8fCAnJykpICtcbiAgICAnICZtaWRkb3Q7ICcgK1xuICAgIGVzY2FwZUh0bWwobG9jIHx8ICcnKSArXG4gICAgJyAvICcgK1xuICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKHByb3YgfHwgJycpKTtcbiAgY29uc3QgaXRlbXMgPSBbXTtcbiAgKHNlZ1Zpc2l0c0NhY2hlIHx8IFtdKVxuICAgIC5maWx0ZXIoXG4gICAgICAodikgPT4gdi52ZW5kb3IgPT09IHZlbmRvciAmJiB2LnByb3ZpbmNpYSA9PT0gcHJvdiAmJiB2LmxvY2FsaWRhZCA9PT0gbG9jICYmIHYudGllbmRhID09PSBuYW1lXG4gICAgKVxuICAgIC5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICBpdGVtcy5wdXNoKHtcbiAgICAgICAgdHlwZTogJ3Zpc2l0JyxcbiAgICAgICAgZGF0ZTogKHYuZmVjaGEgfHwgJycpLnNsaWNlKDAsIDEwKSxcbiAgICAgICAgdGl0bGU6ICdWaXNpdGEnLFxuICAgICAgICBib2R5OlxuICAgICAgICAgICh2LmNvbWVudGFyaW8gfHwgdi5vYnNlcnZhY2lvbmVzIHx8ICcoc2luIGNvbWVudGFyaW9zKScpICtcbiAgICAgICAgICAodi5wcm94aW1hQWNjaW9uID8gJ1xcblByb3hpbWEgYWNjaW9uOiAnICsgdi5wcm94aW1hQWNjaW9uIDogJycpLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIChnbG9iYWxQZWRpZG9zIHx8IFtdKVxuICAgIC5maWx0ZXIoXG4gICAgICAocCkgPT5cbiAgICAgICAgc2VnUGVkaWRvVmVuZG9yKHApID09PSB2ZW5kb3IgJiZcbiAgICAgICAgcC5wcm92aW5jZSA9PT0gcHJvdiAmJlxuICAgICAgICBwLmxvY05hbWUgPT09IGxvYyAmJlxuICAgICAgICBwLmNsaWVudE5hbWUgPT09IG5hbWVcbiAgICApXG4gICAgLmZvckVhY2goKHApID0+IHtcbiAgICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgcC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xuICAgICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyB8fCAwO1xuICAgICAgY29uc3QgdW5pdHMgPSAocC5saW5lcyB8fCBbXSkucmVkdWNlKChzLCBsKSA9PiBzICsgKHBhcnNlRmxvYXQobC5xdHkpIHx8IDApLCAwKTtcbiAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICB0eXBlOiAnb3JkZXInLFxuICAgICAgICBkYXRlOiBkdCxcbiAgICAgICAgdGl0bGU6XG4gICAgICAgICAgJ1BlZGlkbyAnICtcbiAgICAgICAgICAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgPyAnY29uZmlybWFkbycgOiBwLnN0YWdlID09PSAncGVuZGluZycgPyAncGVuZGllbnRlJyA6IHAuc3RhZ2UpLFxuICAgICAgICBib2R5OlxuICAgICAgICAgICckJyArXG4gICAgICAgICAgTWF0aC5yb3VuZChhbXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICAgICAnIC8gJyArXG4gICAgICAgICAgdW5pdHMudG9GaXhlZCgwKSArXG4gICAgICAgICAgJyB1IC8gJyArXG4gICAgICAgICAgLy8gdjYwNSBFNTogU0tVcyB1bmljb3MgKGNvbiB2NjAwIHNwbGl0LCB1biBTS1UgcHVlZGUgYXBhcmVjZXIgZW4gMiBsaW5lYXMpXG4gICAgICAgICAgbmV3IFNldCgocC5saW5lcyB8fCBbXSkubWFwKChsKSA9PiBsICYmIGwuY29kZSkuZmlsdGVyKEJvb2xlYW4pKS5zaXplICtcbiAgICAgICAgICAnIFNLVShzKScsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgKHNlZ05vdGVzQ2FjaGUgfHwgW10pXG4gICAgLmZpbHRlcigobikgPT4gbi5jbGllbnRLZXkgPT09IGNsaWVudEtleSlcbiAgICAuZm9yRWFjaCgobikgPT4ge1xuICAgICAgY29uc3QgZHQgPVxuICAgICAgICBuLmNyZWF0ZWRBdCAmJiBuLmNyZWF0ZWRBdC50b0RhdGUgPyBuLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnO1xuICAgICAgaXRlbXMucHVzaCh7XG4gICAgICAgIHR5cGU6ICdub3RlJyxcbiAgICAgICAgZGF0ZTogZHQsXG4gICAgICAgIHRpdGxlOiAnTm90YSBpbnRlcm5hIC0gJyArIChuLmF1dGhvck5hbWUgfHwgbi5hdXRob3JFbWFpbCB8fCAnJyksXG4gICAgICAgIGJvZHk6IG4udGV4dCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICBpdGVtcy5zb3J0KChhLCBiKSA9PiAoYi5kYXRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZGF0ZSB8fCAnJykpO1xuICBsZXQgaHRtbCA9ICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lXCI+JztcbiAgaWYgKCFpdGVtcy5sZW5ndGgpXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPlNpbiBhY3RpdmlkYWQgcmVnaXN0cmFkYSBwYXJhIGVzdGUgY2xpZW50ZS48L2Rpdj4nO1xuICBpdGVtcy5mb3JFYWNoKChpdCkgPT4ge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctdGltZWxpbmUtaXRlbSAnICsgaXQudHlwZSArICdcIj4nO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctdGltZWxpbmUtZGF0ZVwiPicgKyBlc2NhcGVIdG1sKGl0LmRhdGUgfHwgJyhzL2YpJykgKyAnPC9kaXY+JztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lLXRpdGxlXCI+JyArIGVzY2FwZUh0bWwoaXQudGl0bGUpICsgJzwvZGl2Pic7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJzZWctdGltZWxpbmUtYm9keVwiPicgK1xuICAgICAgZXNjYXBlSHRtbChpdC5ib2R5IHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJzxicj4nKSArXG4gICAgICAnPC9kaXY+JztcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuICB9KTtcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgY29uc3QgY3VyU3RhdHVzID0gc2VnU3RhdHVzQ2FjaGVbY2xpZW50S2V5XSB8fCAnJztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO3BhZGRpbmc6MTBweCAxMnB4O21hcmdpbi10b3A6MTRweDtib3JkZXItcmFkaXVzOjZweFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4zcHg7bWFyZ2luLWJvdHRvbTo2cHhcIj5Fc3RhZG8gZGUgc2VndWltaWVudG8gaW50ZXJubyAobm8gYWZlY3RhIHZpc2l0YSBuaSBwZWRpZG8gb3JpZ2luYWwpPC9kaXY+JztcbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy1zdGF0dXMtcm93XCI+JztcbiAgW1xuICAgIFsncGVuZGllbnRlJywgJ01hcmNhciBwZW5kaWVudGUnXSxcbiAgICBbJ3JldmlzYWRvJywgJ01hcmNhciByZXZpc2FkbyddLFxuICAgIFsncmVzdWVsdG8nLCAnTWFyY2FyIHJlc3VlbHRvJ10sXG4gIF0uZm9yRWFjaCgocykgPT4ge1xuICAgIGNvbnN0IGFjdCA9IGN1clN0YXR1cyA9PT0gc1swXSA/ICdhY3RpdmUnIDogJyc7XG4gICAgaHRtbCArPVxuICAgICAgJzxidXR0b24gY2xhc3M9XCJzZWctc3RhdHVzLWJ0biAnICtcbiAgICAgIGFjdCArXG4gICAgICAnXCIgb25jbGljaz1cInNldFNlZ1N0YXR1cyhcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIoY2xpZW50S2V5KSArXG4gICAgICBcIicsJ1wiICtcbiAgICAgIHNbMF0gK1xuICAgICAgJ1xcJylcIj4nICtcbiAgICAgIHNbMV0gK1xuICAgICAgJzwvYnV0dG9uPic7XG4gIH0pO1xuICBodG1sICs9ICc8L2Rpdj48L2Rpdj4nO1xuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLW5vdGUtZm9ybVwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS1jb2xvci13YXJuaW5nKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweDttYXJnaW4tYm90dG9tOjVweFwiPk5vdGEgaW50ZXJuYSBlbnRyZSBpbnRlcm5vIHkgZXh0ZXJubyAobm8gbW9kaWZpY2EgbGEgdmlzaXRhKTwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPHRleHRhcmVhIGlkPVwic2VnLW5vdGUtaW5wdXRcIiBwbGFjZWhvbGRlcj1cIkVqOiByZXZpc2FkbywgbG8gbGxhbW8gbWFcdTAwRjFhbmEgcGFyYSBjZXJyYXIgcmVwb3NpY2lvblwiPjwvdGV4dGFyZWE+JztcbiAgaHRtbCArPSAnPGJ1dHRvbiBvbmNsaWNrPVwic2F2ZVNlZ05vdGUoXFwnJyArIGVzY2FwZUF0dHIoY2xpZW50S2V5KSArICdcXCcpXCI+R3VhcmRhciBub3RhPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10bC1jb250ZW50JykuaW5uZXJIVE1MID0gaHRtbDtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10aW1lbGluZS1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZVNlZ1RpbWVsaW5lID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLXRpbWVsaW5lLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBjdXJyZW50U2VnVGltZWxpbmVLZXkgPSBudWxsO1xufTtcblxud2luZG93LnNhdmVTZWdOb3RlID0gYXN5bmMgZnVuY3Rpb24gKGNsaWVudEtleSkge1xuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSByZXR1cm47XG4gIGNvbnN0IHBhcnRzID0gKGNsaWVudEtleSB8fCAnJykuc3BsaXQoJ3wnKTtcbiAgY29uc3QgdmVuZG9yID0gcGFydHNbMF07XG4gIGlmICghdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikpIHtcbiAgICBhbGVydCgnU2luIHBlcm1pc29zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctbm90ZS1pbnB1dCcpO1xuICBjb25zdCB0ZXh0ID0gKCh0YSAmJiB0YS52YWx1ZSkgfHwgJycpLnRyaW0oKTtcbiAgaWYgKCF0ZXh0KSByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19ub3RlcycpLmFkZCh7XG4gICAgICBjbGllbnRLZXksXG4gICAgICB2ZW5kb3JFeHQ6IHZlbmRvcixcbiAgICAgIHByb3Y6IHBhcnRzWzFdLFxuICAgICAgbG9jOiBwYXJ0c1syXSxcbiAgICAgIGNsaWVudE5hbWU6IHBhcnRzWzNdLFxuICAgICAgYXV0aG9yVWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICBhdXRob3JFbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICBhdXRob3JOYW1lOiBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSB8fCBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgIGF1dGhvclJvbGU6IHVzZXJSb2xlLFxuICAgICAgdGV4dCxcbiAgICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgfSk7XG4gICAgaWYgKHRhKSB0YS52YWx1ZSA9ICcnO1xuICAgIGlmICh0eXBlb2Ygc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHNob3dTeW5jVGFnKCdOb3RhIGludGVybmEgZ3VhcmRhZGEnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0Vycm9yIGd1YXJkYW5kbyBub3RhOiAnICtcbiAgICAgICAgKGUubWVzc2FnZSB8fCBlKSArXG4gICAgICAgICdcXG5cXG5Qcm9iYWJsZTogZmFsdGFuIHJ1bGVzIGVuIEZpcmVzdG9yZSBwYXJhIFwic2VndWltaWVudG9fbm90ZXNcIi4nXG4gICAgKTtcbiAgfVxufTtcblxud2luZG93LnNldFNlZ1N0YXR1cyA9IGFzeW5jIGZ1bmN0aW9uIChjbGllbnRLZXksIHN0YXR1cykge1xuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSByZXR1cm47XG4gIGNvbnN0IHBhcnRzID0gKGNsaWVudEtleSB8fCAnJykuc3BsaXQoJ3wnKTtcbiAgY29uc3QgdmVuZG9yID0gcGFydHNbMF07XG4gIGlmICghdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikpIHtcbiAgICBhbGVydCgnU2luIHBlcm1pc29zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBkb2NJZCA9IGNsaWVudEtleS5yZXBsYWNlKC9bL1xcXFwjP10vZywgJ18nKS5zbGljZSgwLCA0MDApICsgJ19fJyArIChjdXJyZW50VXNlci51aWQgfHwgJycpO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignc2VndWltaWVudG9fc3RhdHVzJykuZG9jKGRvY0lkKS5zZXQoXG4gICAgICB7XG4gICAgICAgIGNsaWVudEtleSxcbiAgICAgICAgdmVuZG9yRXh0OiB2ZW5kb3IsXG4gICAgICAgIHByb3Y6IHBhcnRzWzFdLFxuICAgICAgICBsb2M6IHBhcnRzWzJdLFxuICAgICAgICBjbGllbnROYW1lOiBwYXJ0c1szXSxcbiAgICAgICAgYXV0aG9yVWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgIHN0YXR1cyxcbiAgICAgICAgdXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIH0sXG4gICAgICB7IG1lcmdlOiB0cnVlIH1cbiAgICApO1xuICAgIGlmICh0eXBlb2Ygc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHNob3dTeW5jVGFnKCdFc3RhZG86ICcgKyBzdGF0dXMpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSArICdcXG5cXG5Qcm9iYWJsZTogZmFsdGFuIHJ1bGVzIHBhcmEgXCJzZWd1aW1pZW50b19zdGF0dXNcIi4nKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQW1CQSxNQUFJLE9BQU8sT0FBTyxrQkFBa0IsWUFBYSxRQUFPLGdCQUFnQjtBQUN4RSxNQUFJLE9BQU8sT0FBTyxtQkFBbUIsWUFBYSxRQUFPLGlCQUFpQjtBQWExRSxNQUFJLGlCQUFpQixDQUFDO0FBQ3RCLE1BQUksZ0JBQWdCLENBQUM7QUFDckIsTUFBSSxpQkFBaUIsQ0FBQztBQUN0QixNQUFJLGdCQUFnQjtBQUNwQixNQUFJLHdCQUF3QjtBQUM1QixNQUFJLG9CQUFvQjtBQUV4QixXQUFTLGdCQUFnQixHQUFHO0FBQzFCLFFBQUksQ0FBQyxFQUFHLFFBQU87QUFDZixRQUFJLEVBQUUsT0FBUSxRQUFPLEVBQUU7QUFDdkIsUUFBSSxFQUFFLGVBQWdCLFFBQU8sRUFBRTtBQUMvQixRQUFJLE9BQU8sb0JBQW9CLGNBQWMsRUFBRSxJQUFLLFFBQU8sZ0JBQWdCLEVBQUUsR0FBRztBQUNoRixXQUFPO0FBQUEsRUFDVDtBQU1BLFdBQVMsV0FBVyxHQUFHO0FBQ3JCLFdBQU8sQ0FBQyxFQUFFLEtBQUssRUFBRSxvQkFBb0I7QUFBQSxFQUN2QztBQUVBLFNBQU8sdUJBQXVCLGlCQUFrQjtBQUM5QyxRQUFJLENBQUMsbUJBQW1CLEdBQUc7QUFDekIsWUFBTSx1Q0FBdUM7QUFDN0M7QUFBQSxJ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
