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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvc2VndWltaWVudG8uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEdsb2JhbHMgbGVcdTAwRURkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcclxuLy8gZmJEYiwgZmlyZWJhc2UsIGN1cnJlbnRVc2VyLCB1c2VyUm9sZSwgVkVORE9SX0lOQ0xVREVTX09USEVSUywgZ2xvYmFsUGVkaWRvcyxcclxuLy8gZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLCBzaG93U3luY1RhZywgY2FuVmlld1NlZ3VpbWllbnRvLFxyXG4vLyBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0LCB2ZW5kb3JJblNlZ3VpbWllbnRvU2NvcGUsIGdldFZlbmRvckZvcktleVxyXG4vLyAoZGFzaGJvYXJkIGJ1bmRsZSkuIE1cdTAwRjNkdWxvIGV4dHJhXHUwMEVEZG8gdmVyYmF0aW06IHRpcGFkbyByZWFsIGZ1ZXJhIGRlIHNjb3BlIEUyLmQuXHJcbi8vXHJcbi8vIFNFR1VJTUlFTlRPIC0gUGFuZWwgZGUgZ2VzdGlcdTAwRjNuIGNvbWVyY2lhbCBwYXJhIHZlbmRlZG9yZXMgaW50ZXJub3MuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgMjY3MTMtMjc0MDggcHJlLUUyLmQpIGNvbW8gcGFydGVcclxuLy8gZGUgRTIuZCAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuIFByZXNlcnZhIDEwMCUgY29tcG9ydGFtaWVudG8uXHJcbi8vXHJcbi8vIENyb3NzLXNjb3BlIHN0YXRlICh2aWEgd2luZG93KTpcclxuLy8gLSB3aW5kb3cudW5zdWJTZWdOb3RlcyAvIHdpbmRvdy51bnN1YlNlZ1N0YXR1czogbGlzdGVuZXJzIGNvbiBjbGVhbnVwIGVuXHJcbi8vIGRldGFjaEZpcmViYXNlTGlzdGVuZXJzKCkgaW5saW5lIChsXHUwMEVEbmVhcyAyNjE0OC00OSBwcmUtRTIuZCkuXHJcbi8vIExvY2FscyBhbCBtXHUwMEYzZHVsbzogc2VnVmlzaXRzQ2FjaGUsIHNlZ05vdGVzQ2FjaGUsIHNlZ1N0YXR1c0NhY2hlLFxyXG4vLyBzZWdDdXJyZW50VGFiLCBjdXJyZW50U2VnVGltZWxpbmVLZXksIF9zZWdEZWJvdW5jZVRpbWVyLlxyXG5cclxuLy8gSW5pdCBjcm9zcy1zY29wZSBzdGF0ZSAoYnVuZGxlIElJRkUgY29ycmUgcHJlLWlubGluZTsgZ2FyYW50aXphIHF1ZSBsYXNcclxuLy8gdmFycyB1bnN1YiogZXhpc3RlbiBlbiB3aW5kb3cgYW50ZXMgZGUgcXVlIGRldGFjaEZpcmViYXNlTGlzdGVuZXJzIGxhcyBsZWEpLlxyXG5pZiAodHlwZW9mIHdpbmRvdy51bnN1YlNlZ05vdGVzID09PSAndW5kZWZpbmVkJykgd2luZG93LnVuc3ViU2VnTm90ZXMgPSBudWxsO1xyXG5pZiAodHlwZW9mIHdpbmRvdy51bnN1YlNlZ1N0YXR1cyA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51bnN1YlNlZ1N0YXR1cyA9IG51bGw7XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFR1VJTUlFTlRPIC0gUGFuZWwgZGUgZ2VzdGlvbiBjb21lcmNpYWwgcGFyYSB2ZW5kZWRvcmVzIGludGVybm9zLlxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIE1vZGVsbzpcclxuLy8gdmlzaXRhcyAtPiBjb2xsZWN0aW9uICd2aXNpdHMnIChjYXJnYWRhIDF4IGNvbiB3aGVyZSB2ZW5kb3IgaW4gWy4uLl0pXHJcbi8vIHBlZGlkb3MgLT4gZ2xvYmFsUGVkaWRvcyAoeWEgbGlzdGVuZXJhZG8gcGFyYSBzdWdlcmVuY2lhcyBjcnV6YWRhcylcclxuLy8gbm90YXMgLT4gY29sbGVjdGlvbiAnc2VndWltaWVudG9fbm90ZXMnXHJcbi8vIGVzdGFkb3MgLT4gY29sbGVjdGlvbiAnc2VndWltaWVudG9fc3RhdHVzJyAocmV2aXNhZG8gLyBwZW5kaWVudGUgLyByZXN1ZWx0bylcclxuLy8gUGVybWlzb3M6IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKSBlcyBlbCBndWFyZC4gQ2FkYSBhY2Npb24gKG9wZW4sXHJcbi8vIHJlbmRlciwgc2F2ZSwgc2V0U3RhdHVzKSByZS12YWxpZGEgdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikgcGFyYVxyXG4vLyBxdWUgbGEgbWFuaXB1bGFjaW9uIGRlbCBmcm9udGVuZCBubyBwdWVkYSBmb3J6YXIgYWNjZXNvIGEgdW4gVkRFIGFqZW5vLlxyXG5sZXQgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcclxubGV0IHNlZ05vdGVzQ2FjaGUgPSBbXTtcclxubGV0IHNlZ1N0YXR1c0NhY2hlID0ge307XHJcbmxldCBzZWdDdXJyZW50VGFiID0gJ3Jlc3VtZW4nO1xyXG5sZXQgY3VycmVudFNlZ1RpbWVsaW5lS2V5ID0gbnVsbDtcclxubGV0IF9zZWdEZWJvdW5jZVRpbWVyID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIHNlZ1BlZGlkb1ZlbmRvcihwKSB7XHJcbiAgaWYgKCFwKSByZXR1cm4gJyc7XHJcbiAgaWYgKHAudmVuZG9yKSByZXR1cm4gcC52ZW5kb3I7XHJcbiAgaWYgKHAuYXNzaWduZWRWZW5kb3IpIHJldHVybiBwLmFzc2lnbmVkVmVuZG9yO1xyXG4gIGlmICh0eXBlb2YgZ2V0VmVuZG9yRm9yS2V5ID09PSAnZnVuY3Rpb24nICYmIHAua2V5KSByZXR1cm4gZ2V0VmVuZG9yRm9yS2V5KHAua2V5KTtcclxuICByZXR1cm4gJyc7XHJcbn1cclxuXHJcbi8vIHY0NDMgKDIwMjYtMDgtMTEpOiBkaXN0aW5ndWlyIHZpc2l0YSBwcmVzZW5jaWFsIHZzIGNvbnRhY3RvIG5vIHByZXNlbmNpYWxcclxuLy8gKFdoYXRzQXBwL3RlbC9lbWFpbCkuIEVsIGNhbXBvIGBpbnRlcmFjdGlvblR5cGVgIHNlIHNldGVhIGVuIHZpc2l0YXMuanMgYWxcclxuLy8gYWJyaXIgZWwgbW9kYWwgKG1vZG8gJ3Zpc2l0YScgdnMgJ2NvbnRhY3RvJykgeSBxdWVkYSBlbiBlbCBkb2MgZGUgRmlyZXN0b3JlLlxyXG4vLyBEb2NzIHZpZWpvcyBzaW4gZXNlIGNhbXBvIHNlIGFzdW1lbiAndmlzaXRhJyBwb3IgZGVmZWN0byAocmV0cm9jb21wYXQpLlxyXG5mdW5jdGlvbiBpc0NvbnRhY3RvKHYpIHtcclxuICByZXR1cm4gISEodiAmJiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJyk7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuU2VndWltaWVudG9Nb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSB7XHJcbiAgICBhbGVydCgnVHUgcm9sIG5vIHRpZW5lIGFjY2VzbyBhIFNlZ3VpbWllbnRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XHJcbiAgaWYgKCFzZXQuc2l6ZSkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdUb2RhdmlhIG5vIHRlbmVzIHZlbmRlZG9yZXMgZXh0ZXJub3MgYXNpZ25hZG9zLlxcblxcblNpIHNvcyB2ZW5kZWRvciBpbnRlcm5vIChTYW50aWFnbyAvIElvYW5uaXMpLCBwZWRpbGUgYWwgYWRtaW4gcXVlIGVuIFBhbmVsIFVzdWFyaW9zIC0+IHR1IFZERSAtPiBcIlBhcmVqYSBpbnRlcm5vXCIgdGUgYXNvY2llIGNvbW8gcGFyZWphLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWd1aW1pZW50by1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxuICBwb3B1bGF0ZVNlZ0ZpbHRlcnMoKTtcclxuICBjb25zdCBkZXNkZUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZGVzZGUnKTtcclxuICBjb25zdCBoYXN0YUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1maGFzdGEnKTtcclxuICBpZiAoZGVzZGVFbCAmJiAhZGVzZGVFbC52YWx1ZSkge1xyXG4gICAgLy8gdjQ0MSAoMjAyNi0wOC0xMSk6IGRlZmF1bHQgPSBwcmltZXIgZFx1MDBFRGEgZGVsIG1lcyBlbiBjdXJzbyBcdTIxOTIgaG95LlxyXG4gICAgLy8gRmVlZGJhY2sgTWFyaWFubzogZXJhIGhveS05MGQsIG11eSBhbXBsaW87IGVsIGVxdWlwbyBjb21lcmNpYWwgbWlyYVxyXG4gICAgLy8gc2VndWltaWVudG8gZGVsIG1lcyB2aWdlbnRlIGNhc2kgc2llbXByZS5cclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICBjb25zdCBkZXNkZSA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMSk7XHJcbiAgICBkZXNkZUVsLnZhbHVlID0gZGVzZGUudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgICBoYXN0YUVsLnZhbHVlID0gbm93LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIH1cclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPVxyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5DYXJnYW5kbyBkYXRvcy4uLjwvZGl2Pic7XHJcbiAgYXdhaXQgbG9hZFNlZ1Zpc2l0cygpO1xyXG4gIGF0dGFjaFNlZ05vdGVzTGlzdGVuZXIoKTtcclxuICBhdHRhY2hTZWdTdGF0dXNMaXN0ZW5lcigpO1xyXG4gIHNldFNlZ3VpbWllbnRvVGFiKHNlZ0N1cnJlbnRUYWIpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VTZWd1aW1pZW50b01vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWd1aW1pZW50by1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbmZ1bmN0aW9uIHBvcHVsYXRlU2VnRmlsdGVycygpIHtcclxuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XHJcbiAgY29uc3Qgc2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mdmVuZG9yJyk7XHJcbiAgaWYgKCFzZWwpIHJldHVybjtcclxuICBjb25zdCBjdXIgPSBzZWwudmFsdWUgfHwgJ0FMTCc7XHJcbiAgY29uc3Qgb3B0cyA9IFsnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zPC9vcHRpb24+J10uY29uY2F0KFxyXG4gICAgWy4uLnNldF1cclxuICAgICAgLnNvcnQoKVxyXG4gICAgICAubWFwKFxyXG4gICAgICAgICh2KSA9PlxyXG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih2KSArICdcIj4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2KSkgKyAnPC9vcHRpb24+J1xyXG4gICAgICApXHJcbiAgKTtcclxuICBzZWwuaW5uZXJIVE1MID0gb3B0cy5qb2luKCcnKTtcclxuICBzZWwudmFsdWUgPSBzZXQuaGFzKGN1cikgfHwgY3VyID09PSAnQUxMJyA/IGN1ciA6ICdBTEwnO1xyXG4gIHNlbC5vbmNoYW5nZSA9ICgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZGVzZGUnKS5vbmNoYW5nZSA9ICgpID0+IHtcclxuICAgIGxvYWRTZWdWaXNpdHMoKS50aGVuKCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCkpO1xyXG4gIH07XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1maGFzdGEnKS5vbmNoYW5nZSA9ICgpID0+IHtcclxuICAgIGxvYWRTZWdWaXNpdHMoKS50aGVuKCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCkpO1xyXG4gIH07XHJcbiAgY29uc3QgY2xpID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mY2xpZW50ZScpO1xyXG4gIGNsaS5vbmlucHV0ID0gZnVuY3Rpb24gKCkge1xyXG4gICAgaWYgKF9zZWdEZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQoX3NlZ0RlYm91bmNlVGltZXIpO1xyXG4gICAgX3NlZ0RlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCksIDMwMCk7XHJcbiAgfTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZlc3RhZG8nKS5vbmNoYW5nZSA9ICgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGxvYWRTZWdWaXNpdHMoKSB7XHJcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xyXG4gIGlmICghc2V0LnNpemUgfHwgIWZiRGIpIHtcclxuICAgIHNlZ1Zpc2l0c0NhY2hlID0gW107XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBsaXN0ID0gWy4uLnNldF07XHJcbiAgICAvLyBGaXJlc3RvcmUgSU4gbWF4IDEwIC0gYWNhIHRlbmVtb3MgMi00LCBPSy5cclxuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS53aGVyZSgndmVuZG9yJywgJ2luJywgbGlzdCkuZ2V0KCk7XHJcbiAgICBzZWdWaXNpdHNDYWNoZSA9IFtdO1xyXG4gICAgcXMuZm9yRWFjaCgoZCkgPT4gc2VnVmlzaXRzQ2FjaGUucHVzaChPYmplY3QuYXNzaWduKHsgaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW1NlZ3VpbWllbnRvXSBlcnJvciBjYXJnYW5kbyB2aXNpdGFzOicsIGUpO1xyXG4gICAgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcclxuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ3Blcm1pc3Npb24tZGVuaWVkJykge1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnVHUgcm9sIG5vIHRpZW5lIHBlcm1pc29zIGVuIEZpcmVzdG9yZSBwYXJhIGxlZXIgbGFzIHZpc2l0YXMgZGVsIHNjb3BlLlxcblxcbkVsIGFkbWluIHRpZW5lIHF1ZSBhY3R1YWxpemFyIGxhcyBydWxlcyBwYXJhIHBlcm1pdGlyIGEgaW50ZXJuby9nZXJlbnRlIGxlZXIgdmlzaXRzIGRlIHN1cyBWREVzIGFzaWduYWRvcy4nXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhdHRhY2hTZWdOb3Rlc0xpc3RlbmVyKCkge1xyXG4gIGlmICh3aW5kb3cudW5zdWJTZWdOb3Rlcykge1xyXG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMoKTtcclxuICAgIHdpbmRvdy51bnN1YlNlZ05vdGVzID0gbnVsbDtcclxuICB9XHJcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xyXG4gIGlmICghc2V0LnNpemUgfHwgIWZiRGIpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMgPSBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19ub3RlcycpXHJcbiAgICAgIC53aGVyZSgndmVuZG9yRXh0JywgJ2luJywgWy4uLnNldF0pXHJcbiAgICAgIC5vblNuYXBzaG90KFxyXG4gICAgICAgIChxcykgPT4ge1xyXG4gICAgICAgICAgc2VnTm90ZXNDYWNoZSA9IFtdO1xyXG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4gc2VnTm90ZXNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcclxuICAgICAgICAgIGlmIChjdXJyZW50U2VnVGltZWxpbmVLZXkpIG9wZW5TZWdUaW1lbGluZShjdXJyZW50U2VnVGltZWxpbmVLZXkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIG5vdGVzIGxpc3RlbmVyJywgZXJyKVxyXG4gICAgICApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW1NlZ3VpbWllbnRvXSBub3RlcyBhdHRhY2gnLCBlKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGF0dGFjaFNlZ1N0YXR1c0xpc3RlbmVyKCkge1xyXG4gIGlmICh3aW5kb3cudW5zdWJTZWdTdGF0dXMpIHtcclxuICAgIHdpbmRvdy51bnN1YlNlZ1N0YXR1cygpO1xyXG4gICAgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gbnVsbDtcclxuICB9XHJcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xyXG4gIGlmICghc2V0LnNpemUgfHwgIWZiRGIpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignc2VndWltaWVudG9fc3RhdHVzJylcclxuICAgICAgLndoZXJlKCd2ZW5kb3JFeHQnLCAnaW4nLCBbLi4uc2V0XSlcclxuICAgICAgLm9uU25hcHNob3QoXHJcbiAgICAgICAgKHFzKSA9PiB7XHJcbiAgICAgICAgICBzZWdTdGF0dXNDYWNoZSA9IHt9O1xyXG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBkZCA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICAgICAgICBpZiAoZGQuY2xpZW50S2V5KSBzZWdTdGF0dXNDYWNoZVtkZC5jbGllbnRLZXldID0gZGQuc3RhdHVzIHx8ICcnO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIHN0YXR1cyBsaXN0ZW5lcicsIGVycilcclxuICAgICAgKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tTZWd1aW1pZW50b10gc3RhdHVzIGF0dGFjaCcsIGUpO1xyXG4gIH1cclxufVxyXG5cclxud2luZG93LnNldFNlZ3VpbWllbnRvVGFiID0gZnVuY3Rpb24gKHRhYikge1xyXG4gIHNlZ0N1cnJlbnRUYWIgPSB0YWI7XHJcbiAgZG9jdW1lbnRcclxuICAgIC5xdWVyeVNlbGVjdG9yQWxsKCcuc2VnLXRhYicpXHJcbiAgICAuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCBiLmRhdGFzZXQuc2VnVGFiID09PSB0YWIpKTtcclxuICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gZ2V0U2VnRmlsdGVycygpIHtcclxuICByZXR1cm4ge1xyXG4gICAgdmVuZG9yOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZ2ZW5kb3InKS52YWx1ZSB8fCAnQUxMJyxcclxuICAgIGRlc2RlOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZkZXNkZScpLnZhbHVlIHx8ICcnLFxyXG4gICAgaGFzdGE6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZmhhc3RhJykudmFsdWUgfHwgJycsXHJcbiAgICBjbGllbnRlOiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mY2xpZW50ZScpLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSxcclxuICAgIGVzdGFkbzogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZXN0YWRvJykudmFsdWUgfHwgJ0FMTCcsXHJcbiAgICBzb2xvUGVuZDogISFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZwZW5kJykuY2hlY2tlZCxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTZWdEYXRhc2V0KCkge1xyXG4gIGNvbnN0IHNldCA9IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKTtcclxuICBjb25zdCBmID0gZ2V0U2VnRmlsdGVycygpO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodikgPT4gc2V0Lmhhcyh2KTtcclxuICBjb25zdCBpbkRhdGUgPSAoZCkgPT4ge1xyXG4gICAgaWYgKCFkKSByZXR1cm4gdHJ1ZTsgLy8gdG9sZXJhciByZWdpc3Ryb3Mgc2luIGZlY2hhXHJcbiAgICBpZiAoZi5kZXNkZSAmJiBkIDwgZi5kZXNkZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKGYuaGFzdGEgJiYgZCA+IGYuaGFzdGEpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH07XHJcbiAgY29uc3QgbWF0Y2hWZW5kb3IgPSAodikgPT4gKGYudmVuZG9yID09PSAnQUxMJyA/IHRydWUgOiB2ID09PSBmLnZlbmRvcik7XHJcbiAgY29uc3QgbWF0Y2hDbGllbnRlID0gKG5hbWUpID0+XHJcbiAgICBmLmNsaWVudGUgPyAobmFtZSB8fCAnJykudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhmLmNsaWVudGUpIDogdHJ1ZTtcclxuICBjb25zdCB2aXNpdHMgPSAoc2VnVmlzaXRzQ2FjaGUgfHwgW10pLmZpbHRlcigodikgPT4ge1xyXG4gICAgaWYgKCFpblNjb3BlKHYudmVuZG9yKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKCFtYXRjaFZlbmRvcih2LnZlbmRvcikpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICghaW5EYXRlKCh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCkpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIW1hdGNoQ2xpZW50ZSh2LnRpZW5kYSkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHBlZGlkb3MgPSAoZ2xvYmFsUGVkaWRvcyB8fCBbXSlcclxuICAgIC5tYXAoKHApID0+IE9iamVjdC5hc3NpZ24oe30sIHAsIHsgdmVuZG9yOiBzZWdQZWRpZG9WZW5kb3IocCkgfSkpXHJcbiAgICAuZmlsdGVyKChwKSA9PiB7XHJcbiAgICAgIGlmICghaW5TY29wZShwLnZlbmRvcikpIHJldHVybiBmYWxzZTtcclxuICAgICAgaWYgKCFtYXRjaFZlbmRvcihwLnZlbmRvcikpIHJldHVybiBmYWxzZTtcclxuICAgICAgY29uc3QgZHQgPSAocC5jb25maXJtZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmZpbmFsaXplZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XHJcbiAgICAgIGlmICghaW5EYXRlKGR0KSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICBpZiAoIW1hdGNoQ2xpZW50ZShwLmNsaWVudE5hbWUpKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSk7XHJcbiAgcmV0dXJuIHsgdmlzaXRzLCBwZWRpZG9zIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkU2VnQWdncmVnYXRlcyh2aXNpdHMsIHBlZGlkb3MpIHtcclxuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XHJcbiAgY29uc3QgYnlWZW5kb3IgPSB7fTtcclxuICBzZXQuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgYnlWZW5kb3Jbdl0gPSB7XHJcbiAgICAgIHZpc2l0czogMCwgLy8gc29sbyBwcmVzZW5jaWFsZXMgKGludGVyYWN0aW9uVHlwZSAhPSAnY29udGFjdG8nKVxyXG4gICAgICBjb250YWN0b3M6IDAsIC8vIHY0NDM6IG5vIHByZXNlbmNpYWxlcyAoV2hhdHNBcHAvdGVsL2VtYWlsKVxyXG4gICAgICBwZWRpZG9zOiAwLFxyXG4gICAgICBmYWN0dXJhY2lvbjogMCxcclxuICAgICAgcGVuZGllbnRlc1BlZGlkb3M6IDAsXHJcbiAgICAgIGxhc3RBY3Rpdml0eTogJycsXHJcbiAgICAgIGNsaWVudHNBY3RpdmU6IG5ldyBTZXQoKSxcclxuICAgICAgY2xpZW50c1Zpc2l0ZWQ6IG5ldyBTZXQoKSxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IGIgPSBieVZlbmRvclt2LnZlbmRvcl07XHJcbiAgICBpZiAoIWIpIHJldHVybjtcclxuICAgIGlmIChpc0NvbnRhY3RvKHYpKSBiLmNvbnRhY3RvcysrO1xyXG4gICAgZWxzZSBiLnZpc2l0cysrO1xyXG4gICAgaWYgKHYudGllbmRhKSBiLmNsaWVudHNWaXNpdGVkLmFkZCh2LnRpZW5kYSArICd8JyArICh2LmxvY2FsaWRhZCB8fCAnJykpO1xyXG4gICAgY29uc3QgZCA9ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZCAmJiBkID4gYi5sYXN0QWN0aXZpdHkpIGIubGFzdEFjdGl2aXR5ID0gZDtcclxuICB9KTtcclxuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcclxuICAgIGNvbnN0IGIgPSBieVZlbmRvcltwLnZlbmRvcl07XHJcbiAgICBpZiAoIWIpIHJldHVybjtcclxuICAgIGIucGVkaWRvcysrO1xyXG4gICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyAhPSBudWxsID8gcC5zdWJ0b3RhbEFycyA6IDA7XHJcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIGIuZmFjdHVyYWNpb24gKz0gK2FtdCB8fCAwO1xyXG4gICAgaWYgKHAuc3RhZ2UgPT09ICdwZW5kaW5nJykgYi5wZW5kaWVudGVzUGVkaWRvcysrO1xyXG4gICAgaWYgKHAuY2xpZW50TmFtZSkgYi5jbGllbnRzQWN0aXZlLmFkZChwLmNsaWVudE5hbWUgKyAnfCcgKyAocC5sb2NOYW1lIHx8ICcnKSk7XHJcbiAgICBjb25zdCBkID0gKHAuY29uZmlybWVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKSB8fCAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xyXG4gICAgaWYgKGQgJiYgZCA+IGIubGFzdEFjdGl2aXR5KSBiLmxhc3RBY3Rpdml0eSA9IGQ7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGJ5VmVuZG9yO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzZWdNYWtlS2V5KHZlbmRvciwgcHJvdiwgbG9jLCBuYW1lKSB7XHJcbiAgcmV0dXJuIFt2ZW5kb3IgfHwgJycsIHByb3YgfHwgJycsIGxvYyB8fCAnJywgbmFtZSB8fCAnJ10uam9pbignfCcpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZXRlY3RTZWdQZW5kaWVudGVzKHZpc2l0cywgcGVkaWRvcykge1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgY29uc3QgYnlDbGllbnQgPSB7fTtcclxuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgaWYgKCFieUNsaWVudFtrXSlcclxuICAgICAgYnlDbGllbnRba10gPSB7XHJcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcclxuICAgICAgICBwcm92OiB2LnByb3ZpbmNpYSxcclxuICAgICAgICBsb2M6IHYubG9jYWxpZGFkLFxyXG4gICAgICAgIG5hbWU6IHYudGllbmRhLFxyXG4gICAgICAgIHZpc2l0czogW10sXHJcbiAgICAgICAgb3JkZXJzOiBbXSxcclxuICAgICAgfTtcclxuICAgIGJ5Q2xpZW50W2tdLnZpc2l0cy5wdXNoKHYpO1xyXG4gIH0pO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkocC52ZW5kb3IsIHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKTtcclxuICAgIGlmICghYnlDbGllbnRba10pXHJcbiAgICAgIGJ5Q2xpZW50W2tdID0ge1xyXG4gICAgICAgIHZlbmRvcjogcC52ZW5kb3IsXHJcbiAgICAgICAgcHJvdjogcC5wcm92aW5jZSxcclxuICAgICAgICBsb2M6IHAubG9jTmFtZSxcclxuICAgICAgICBuYW1lOiBwLmNsaWVudE5hbWUsXHJcbiAgICAgICAgdmlzaXRzOiBbXSxcclxuICAgICAgICBvcmRlcnM6IFtdLFxyXG4gICAgICB9O1xyXG4gICAgYnlDbGllbnRba10ub3JkZXJzLnB1c2gocCk7XHJcbiAgfSk7XHJcbiAgT2JqZWN0LmVudHJpZXMoYnlDbGllbnQpLmZvckVhY2goKFtrLCBjXSkgPT4ge1xyXG4gICAgaWYgKCFjLnZpc2l0cy5sZW5ndGgpIHJldHVybjtcclxuICAgIGNvbnN0IGhhc0NvbmZpcm1lZCA9IGMub3JkZXJzLnNvbWUoKG8pID0+IG8uc3RhZ2UgPT09ICdjb25maXJtZWQnKTtcclxuICAgIGlmIChoYXNDb25maXJtZWQpIHJldHVybjtcclxuICAgIC8vIEVsIHVzdWFyaW8gbWFyY28gZWwgY2FzbyBjb21vICdyZXN1ZWx0bycgZGVzZGUgZWwgdGltZWxpbmUgbyBlbFxyXG4gICAgLy8gYm90b24gWCBkZSBwZW5kaWVudGVzIC0+IG5vIHZvbHZlbW9zIGEgbGlzdGFybG8uXHJcbiAgICBpZiAoc2VnU3RhdHVzQ2FjaGVba10gPT09ICdyZXN1ZWx0bycpIHJldHVybjtcclxuICAgIGNvbnN0IGxhdGVzdFYgPSBjLnZpc2l0c1xyXG4gICAgICAubWFwKCh2KSA9PiB2LmZlY2hhIHx8ICcnKVxyXG4gICAgICAuc29ydCgpXHJcbiAgICAgIC5wb3AoKTtcclxuICAgIGNvbnN0IGRheXNBZ28gPSBsYXRlc3RWID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGxhdGVzdFYpLmdldFRpbWUoKSkgLyA4NjQwMDAwMCkgOiAwO1xyXG4gICAgaWYgKGRheXNBZ28gPj0gNykge1xyXG4gICAgICBpdGVtcy5wdXNoKHtcclxuICAgICAgICBraW5kOiAndmlzaXQtbm8tb3JkZXInLFxyXG4gICAgICAgIGNsaWVudEtleTogayxcclxuICAgICAgICBjbGllbnQ6IGMubmFtZSxcclxuICAgICAgICB2ZW5kb3I6IGMudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IGMucHJvdixcclxuICAgICAgICBsb2M6IGMubG9jLFxyXG4gICAgICAgIHByb2JsZW1hOiAnVmlzaXRhZG8gc2luIHBlZGlkbyBoYWNlICcgKyBkYXlzQWdvICsgJyBkaWFzJyxcclxuICAgICAgICBhY2Npb246ICdDb250YWN0YXIgeSBvZnJlY2VyIGNpZXJyZScsXHJcbiAgICAgICAgdWx0aW1hQWNjaW9uOiAnVmlzaXRhOiAnICsgbGF0ZXN0VixcclxuICAgICAgICBzdGF0dXM6IGRheXNBZ28gPiAxNCA/ICdyZWQnIDogJ3llbGxvdycsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH0pO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgaWYgKHAuc3RhZ2UgIT09ICdwZW5kaW5nJykgcmV0dXJuO1xyXG4gICAgY29uc3QgZHQgPSAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XHJcbiAgICBjb25zdCBkYXlzQWdvID0gZHQgPyBNYXRoLmZsb29yKChEYXRlLm5vdygpIC0gbmV3IERhdGUoZHQpLmdldFRpbWUoKSkgLyA4NjQwMDAwMCkgOiAwO1xyXG4gICAgaXRlbXMucHVzaCh7XHJcbiAgICAgIGtpbmQ6ICdwZWRpZG8tcGVuZGluZycsXHJcbiAgICAgIHBlZGlkb0ZzSWQ6IHAuX2ZzSWQgfHwgJycsXHJcbiAgICAgIGNsaWVudEtleTogc2VnTWFrZUtleShwLnZlbmRvciwgcC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpLFxyXG4gICAgICBjbGllbnQ6IHAuY2xpZW50TmFtZSxcclxuICAgICAgdmVuZG9yOiBwLnZlbmRvcixcclxuICAgICAgcHJvdjogcC5wcm92aW5jZSxcclxuICAgICAgbG9jOiBwLmxvY05hbWUsXHJcbiAgICAgIHByb2JsZW1hOiAnUGVkaWRvIHBlbmRpZW50ZSBkZSBjb25maXJtYXInICsgKGRheXNBZ28gPyAnIGhhY2UgJyArIGRheXNBZ28gKyAnIGRpYXMnIDogJycpLFxyXG4gICAgICBhY2Npb246ICdSZXZpc2FyIHN0b2NrIHkgbGxhbWFyIGFsIGNsaWVudGUnLFxyXG4gICAgICB1bHRpbWFBY2Npb246ICdQZWRpZG86ICcgKyAoZHQgfHwgJyhzL2YpJyksXHJcbiAgICAgIHN0YXR1czogZGF5c0FnbyA+PSA1ID8gJ3JlZCcgOiAneWVsbG93JyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIHJldHVybiBpdGVtcztcclxufVxyXG5cclxuZnVuY3Rpb24gZGV0ZWN0U2VnU2luTW92aW1pZW50byh2aXNpdHMsIHBlZGlkb3MpIHtcclxuICBjb25zdCBtYXAgPSB7fTtcclxuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgaWYgKCFtYXBba10pXHJcbiAgICAgIG1hcFtrXSA9IHtcclxuICAgICAgICB2ZW5kb3I6IHYudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IHYucHJvdmluY2lhLFxyXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXHJcbiAgICAgICAgbmFtZTogdi50aWVuZGEsXHJcbiAgICAgICAgbGFzdFY6ICcnLFxyXG4gICAgICAgIGxhc3RPOiAnJyxcclxuICAgICAgICBmYWN0dXJhY2lvbjogMCxcclxuICAgICAgfTtcclxuICAgIGlmICgodi5mZWNoYSB8fCAnJykgPiBtYXBba10ubGFzdFYpIG1hcFtrXS5sYXN0ViA9IHYuZmVjaGE7XHJcbiAgfSk7XHJcbiAgcGVkaWRvcy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCBrID0gc2VnTWFrZUtleShwLnZlbmRvciwgcC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpO1xyXG4gICAgaWYgKCFtYXBba10pXHJcbiAgICAgIG1hcFtrXSA9IHtcclxuICAgICAgICB2ZW5kb3I6IHAudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IHAucHJvdmluY2UsXHJcbiAgICAgICAgbG9jOiBwLmxvY05hbWUsXHJcbiAgICAgICAgbmFtZTogcC5jbGllbnROYW1lLFxyXG4gICAgICAgIGxhc3RWOiAnJyxcclxuICAgICAgICBsYXN0TzogJycsXHJcbiAgICAgICAgZmFjdHVyYWNpb246IDAsXHJcbiAgICAgIH07XHJcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgJiYgZHQgPiBtYXBba10ubGFzdE8pIG1hcFtrXS5sYXN0TyA9IGR0O1xyXG4gICAgaWYgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnKSB7XHJcbiAgICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcclxuICAgICAgbWFwW2tdLmZhY3R1cmFjaW9uICs9ICthbXQgfHwgMDtcclxuICAgIH1cclxuICB9KTtcclxuICBjb25zdCBvdXQgPSBbXTtcclxuICBPYmplY3QuZW50cmllcyhtYXApLmZvckVhY2goKFtrLCBjXSkgPT4ge1xyXG4gICAgY29uc3QgbGFzdFZkYXlzID0gYy5sYXN0VlxyXG4gICAgICA/IE1hdGguZmxvb3IoKERhdGUubm93KCkgLSBuZXcgRGF0ZShjLmxhc3RWKS5nZXRUaW1lKCkpIC8gODY0MDAwMDApXHJcbiAgICAgIDogSW5maW5pdHk7XHJcbiAgICBjb25zdCBsYXN0T2RheXMgPSBjLmxhc3RPXHJcbiAgICAgID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGMubGFzdE8pLmdldFRpbWUoKSkgLyA4NjQwMDAwMClcclxuICAgICAgOiBJbmZpbml0eTtcclxuICAgIGlmIChsYXN0VmRheXMgPiAzMCAmJiBsYXN0T2RheXMgPiA0NSkge1xyXG4gICAgICBjb25zdCBsYXN0RGF5cyA9IE1hdGgubWluKGxhc3RWZGF5cywgbGFzdE9kYXlzKTtcclxuICAgICAgb3V0LnB1c2goe1xyXG4gICAgICAgIGNsaWVudEtleTogayxcclxuICAgICAgICBjbGllbnQ6IGMubmFtZSxcclxuICAgICAgICB2ZW5kb3I6IGMudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IGMucHJvdixcclxuICAgICAgICBsb2M6IGMubG9jLFxyXG4gICAgICAgIGxhc3RWaXNpdDogYy5sYXN0ViB8fCAnLScsXHJcbiAgICAgICAgbGFzdE9yZGVyOiBjLmxhc3RPIHx8ICctJyxcclxuICAgICAgICBkYXlzQWdvOiBOdW1iZXIuaXNGaW5pdGUobGFzdERheXMpID8gbGFzdERheXMgOiAnOTk5KycsXHJcbiAgICAgICAgZmFjdHVyYWNpb246IGMuZmFjdHVyYWNpb24sXHJcbiAgICAgICAgYWNjaW9uOlxyXG4gICAgICAgICAgYy5mYWN0dXJhY2lvbiA+IDBcclxuICAgICAgICAgICAgPyAnUmVjb250YWN0YXIgLSBjbGllbnRlIGNvbiBoaXN0b3JpYWwnXHJcbiAgICAgICAgICAgIDogJ1JlY29udGFjdGFyIC0gcHVlZGUgc2VyIG9wb3J0dW5pZGFkJyxcclxuICAgICAgICBzdGF0dXM6IGMuZmFjdHVyYWNpb24gPiAxMDAwMDAgJiYgbGFzdERheXMgPiA2MCA/ICdyZWQnIDogJ3llbGxvdycsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH0pO1xyXG4gIHJldHVybiBvdXQuc29ydCgoYSwgYikgPT4gKGIuZmFjdHVyYWNpb24gfHwgMCkgLSAoYS5mYWN0dXJhY2lvbiB8fCAwKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRldGVjdFNlZ09wb3J0dW5pZGFkZXModmlzaXRzLCBfcGVkaWRvcykge1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgY29uc3Qga2V5cyA9IFtcclxuICAgICdpbnRlcmVzYWQnLFxyXG4gICAgJ3BvdGVuY2lhbCcsXHJcbiAgICAnY2llcnJlJyxcclxuICAgICdyZXBvc2ljaScsXHJcbiAgICAnb2ZlcnRhJyxcclxuICAgICdkZXNjdWVudG8nLFxyXG4gICAgJ3ZvbHZlcicsXHJcbiAgICAnY290aXonLFxyXG4gIF07XHJcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHR4dCA9ICgodi5jb21lbnRhcmlvIHx8ICcnKSArICcgJyArICh2Lm9ic2VydmFjaW9uZXMgfHwgJycpKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgaWYgKGtleXMuc29tZSgoa3cpID0+IHR4dC5pbmNsdWRlcyhrdykpKSB7XHJcbiAgICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICAgIGNsaWVudEtleTogc2VnTWFrZUtleSh2LnZlbmRvciwgdi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSksXHJcbiAgICAgICAgY2xpZW50OiB2LnRpZW5kYSxcclxuICAgICAgICB2ZW5kb3I6IHYudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IHYucHJvdmluY2lhLFxyXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXHJcbiAgICAgICAgcHJvYmxlbWE6XHJcbiAgICAgICAgICAnQ29tZW50YXJpbyBjb21lcmNpYWw6IFwiJyArICh2LmNvbWVudGFyaW8gfHwgdi5vYnNlcnZhY2lvbmVzIHx8ICcnKS5zbGljZSgwLCA4MCkgKyAnXCInLFxyXG4gICAgICAgIGFjY2lvbjogJ0Nvb3JkaW5hciBjaWVycmUgY29uIGVsIFZERScsXHJcbiAgICAgICAgdWx0aW1hQWNjaW9uOiAnVmlzaXRhOiAnICsgKHYuZmVjaGEgfHwgJy0nKSxcclxuICAgICAgICBzdGF0dXM6ICd5ZWxsb3cnLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9KTtcclxuICByZXR1cm4gaXRlbXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkU2VnRHVwbGFzKHZpc2l0cywgcGVkaWRvcykge1xyXG4gIGNvbnN0IGV4dGVybmFsVG9JbnRlcm5hbCA9IHt9O1xyXG4gIE9iamVjdC5lbnRyaWVzKFZFTkRPUl9JTkNMVURFU19PVEhFUlMpLmZvckVhY2goKFtpbnRlcm5vLCBleHRdKSA9PlxyXG4gICAgZXh0LmZvckVhY2goKGUpID0+IChleHRlcm5hbFRvSW50ZXJuYWxbZV0gPSBpbnRlcm5vKSlcclxuICApO1xyXG4gIGNvbnN0IGR1cGxhcyA9IHt9O1xyXG4gIGNvbnN0IGVuc3VyZSA9IChpbnRlcm5vLCBleHRlcm5vKSA9PiB7XHJcbiAgICBjb25zdCBrID0gaW50ZXJubyArICcgKyAnICsgZXh0ZXJubztcclxuICAgIGlmICghZHVwbGFzW2tdKVxyXG4gICAgICBkdXBsYXNba10gPSB7XHJcbiAgICAgICAgaW50ZXJubyxcclxuICAgICAgICBleHRlcm5vLFxyXG4gICAgICAgIHZpc2l0YXM6IDAsXHJcbiAgICAgICAgcGVkaWRvczogMCxcclxuICAgICAgICBwZWRpZG9zQ29uZjogMCxcclxuICAgICAgICBmYWN0OiAwLFxyXG4gICAgICAgIGNsaWVudGVzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgcGVuZGllbnRlczogMCxcclxuICAgICAgICBsYXN0QWN0OiAnJyxcclxuICAgICAgfTtcclxuICAgIHJldHVybiBkdXBsYXNba107XHJcbiAgfTtcclxuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgaW50ZXJubyA9IGV4dGVybmFsVG9JbnRlcm5hbFt2LnZlbmRvcl07XHJcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcclxuICAgIGNvbnN0IGQgPSBlbnN1cmUoaW50ZXJubywgdi52ZW5kb3IpO1xyXG4gICAgZC52aXNpdGFzKys7XHJcbiAgICBpZiAodi50aWVuZGEpIGQuY2xpZW50ZXMuYWRkKHYudGllbmRhICsgJ3wnICsgKHYubG9jYWxpZGFkIHx8ICcnKSk7XHJcbiAgICBjb25zdCBkdCA9ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZHQgPiBkLmxhc3RBY3QpIGQubGFzdEFjdCA9IGR0O1xyXG4gIH0pO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgaW50ZXJubyA9IGV4dGVybmFsVG9JbnRlcm5hbFtwLnZlbmRvcl07XHJcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcclxuICAgIGNvbnN0IGQgPSBlbnN1cmUoaW50ZXJubywgcC52ZW5kb3IpO1xyXG4gICAgZC5wZWRpZG9zKys7XHJcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIHtcclxuICAgICAgZC5wZWRpZG9zQ29uZisrO1xyXG4gICAgICBjb25zdCBhbXQgPSBwLm5ldEFtb3VudEFycyAhPSBudWxsID8gcC5uZXRBbW91bnRBcnMgOiBwLnN1YnRvdGFsQXJzIHx8IDA7XHJcbiAgICAgIGQuZmFjdCArPSArYW10IHx8IDA7XHJcbiAgICB9IGVsc2UgaWYgKHAuc3RhZ2UgPT09ICdwZW5kaW5nJykgZC5wZW5kaWVudGVzKys7XHJcbiAgICBpZiAocC5jbGllbnROYW1lKSBkLmNsaWVudGVzLmFkZChwLmNsaWVudE5hbWUgKyAnfCcgKyAocC5sb2NOYW1lIHx8ICcnKSk7XHJcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZHQgPiBkLmxhc3RBY3QpIGQubGFzdEFjdCA9IGR0O1xyXG4gIH0pO1xyXG4gIHJldHVybiBkdXBsYXM7XHJcbn1cclxuXHJcbndpbmRvdy5yZW5kZXJTZWd1aW1pZW50b1RhYiA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSB7XHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPlNpbiBwZXJtaXNvcy48L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCB7IHZpc2l0cywgcGVkaWRvcyB9ID0gZ2V0U2VnRGF0YXNldCgpO1xyXG4gIHJlbmRlclNlZ1RvcFN0YXRzKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgY29uc3QgcGVuZGllbnRlcyA9IGRldGVjdFNlZ1BlbmRpZW50ZXModmlzaXRzLCBwZWRpZG9zKTtcclxuICBjb25zdCBkZWFkID0gZGV0ZWN0U2VnU2luTW92aW1pZW50byh2aXNpdHMsIHBlZGlkb3MpO1xyXG4gIGNvbnN0IG9wcHMgPSBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC12aXNpdGFzJykudGV4dENvbnRlbnQgPSB2aXNpdHMubGVuZ3RoO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY291bnQtcGVkaWRvcycpLnRleHRDb250ZW50ID0gcGVkaWRvcy5sZW5ndGg7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1wZW5kaWVudGVzJykudGV4dENvbnRlbnQgPSBwZW5kaWVudGVzLmxlbmd0aDtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvdW50LWRlYWQnKS50ZXh0Q29udGVudCA9IGRlYWQubGVuZ3RoO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY291bnQtb3BwJykudGV4dENvbnRlbnQgPSBvcHBzLmxlbmd0aDtcclxuICBjb25zdCB0YWIgPSBzZWdDdXJyZW50VGFiIHx8ICdyZXN1bWVuJztcclxuICBjb25zdCBmID0gZ2V0U2VnRmlsdGVycygpO1xyXG4gIGNvbnN0IGZpbHRlckJ5RXN0YWRvID0gKGFycikgPT5cclxuICAgIGYuZXN0YWRvID09PSAnQUxMJyA/IGFyciA6IGFyci5maWx0ZXIoKHgpID0+IHguc3RhdHVzID09PSBmLmVzdGFkbyk7XHJcbiAgbGV0IGh0bWwgPSAnJztcclxuICBpZiAodGFiID09PSAncmVzdW1lbicpIGh0bWwgPSByZW5kZXJTZWdSZXN1bWVuKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgZWxzZSBpZiAodGFiID09PSAndmlzaXRhcycpIHtcclxuICAgIGxldCByb3dzID0gdmlzaXRzLnNsaWNlKCk7XHJcbiAgICBpZiAoZi5zb2xvUGVuZCkge1xyXG4gICAgICBjb25zdCBwZW5kU2V0ID0gbmV3IFNldChwZW5kaWVudGVzLm1hcCgocCkgPT4gcC5jbGllbnRLZXkpKTtcclxuICAgICAgcm93cyA9IHJvd3MuZmlsdGVyKCh2KSA9PlxyXG4gICAgICAgIHBlbmRTZXQuaGFzKHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpKVxyXG4gICAgICApO1xyXG4gICAgfVxyXG4gICAgaHRtbCA9IHJlbmRlclNlZ1Zpc2l0YXMocm93cyk7XHJcbiAgfSBlbHNlIGlmICh0YWIgPT09ICdwZWRpZG9zJykge1xyXG4gICAgbGV0IHJvd3MgPSBwZWRpZG9zLnNsaWNlKCk7XHJcbiAgICBpZiAoZi5zb2xvUGVuZCkgcm93cyA9IHJvd3MuZmlsdGVyKChwKSA9PiBwLnN0YWdlID09PSAncGVuZGluZycpO1xyXG4gICAgaHRtbCA9IHJlbmRlclNlZ1BlZGlkb3Mocm93cyk7XHJcbiAgfSBlbHNlIGlmICh0YWIgPT09ICdwZW5kaWVudGVzJykgaHRtbCA9IHJlbmRlclNlZ1BlbmRpZW50ZXMoZmlsdGVyQnlFc3RhZG8ocGVuZGllbnRlcykpO1xyXG4gIGVsc2UgaWYgKHRhYiA9PT0gJ2RlYWQnKSBodG1sID0gcmVuZGVyU2VnRGVhZChmaWx0ZXJCeUVzdGFkbyhkZWFkKSk7XHJcbiAgZWxzZSBpZiAodGFiID09PSAnb3BwJykgaHRtbCA9IHJlbmRlclNlZ09wcHMoZmlsdGVyQnlFc3RhZG8ob3BwcykpO1xyXG4gIGVsc2UgaWYgKHRhYiA9PT0gJ2R1cGxhcycpIGh0bWwgPSByZW5kZXJTZWdEdXBsYXMoYnVpbGRTZWdEdXBsYXModmlzaXRzLCBwZWRpZG9zKSk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb250ZW50JykuaW5uZXJIVE1MID0gaHRtbDtcclxufTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNlZ1RvcFN0YXRzKHZpc2l0cywgcGVkaWRvcykge1xyXG4gIGxldCBmYWN0ID0gMCxcclxuICAgIGNvbmYgPSAwLFxyXG4gICAgX3BlbmQgPSAwLFxyXG4gICAgbGFzdEFjdCA9ICcnO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgaWYgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnKSB7XHJcbiAgICAgIGNvbmYrKztcclxuICAgICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyB8fCAwO1xyXG4gICAgICBmYWN0ICs9ICthbXQgfHwgMDtcclxuICAgIH0gZWxzZSBpZiAocC5zdGFnZSA9PT0gJ3BlbmRpbmcnKSBfcGVuZCsrO1xyXG4gICAgY29uc3QgZHQgPSAocC5jb25maXJtZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmZpbmFsaXplZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZHQgPiBsYXN0QWN0KSBsYXN0QWN0ID0gZHQ7XHJcbiAgfSk7XHJcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IGQgPSAodi5mZWNoYSB8fCAnJykuc2xpY2UoMCwgMTApO1xyXG4gICAgaWYgKGQgPiBsYXN0QWN0KSBsYXN0QWN0ID0gZDtcclxuICB9KTtcclxuICBjb25zdCBwZW5kaWVudGVzID0gZGV0ZWN0U2VnUGVuZGllbnRlcyh2aXNpdHMsIHBlZGlkb3MpO1xyXG4gIGNvbnN0IGRlYWQgPSBkZXRlY3RTZWdTaW5Nb3ZpbWllbnRvKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgY29uc3Qgb3BwcyA9IGRldGVjdFNlZ09wb3J0dW5pZGFkZXModmlzaXRzLCBwZWRpZG9zKTtcclxuICAvLyB2NDQzOiBzZXBhcmFyIHZpc2l0YXMgcHJlc2VuY2lhbGVzIGRlIGNvbnRhY3RvcyBubyBwcmVzZW5jaWFsZXMuXHJcbiAgY29uc3QgdmlzaXRhc1ByZXMgPSB2aXNpdHMuZmlsdGVyKCh2KSA9PiAhaXNDb250YWN0byh2KSkubGVuZ3RoO1xyXG4gIGNvbnN0IGNvbnRhY3RvcyA9IHZpc2l0cy5maWx0ZXIoaXNDb250YWN0bykubGVuZ3RoO1xyXG4gIGNvbnN0IGNvbnYgPSB2aXNpdHMubGVuZ3RoID4gMCA/IE1hdGgucm91bmQoKGNvbmYgLyB2aXNpdHMubGVuZ3RoKSAqIDEwMCkgOiAwO1xyXG4gIGNvbnN0IGZtdE1vbiA9IChuKSA9PiAnJCcgKyBNYXRoLnJvdW5kKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xyXG4gIGNvbnN0IGh0bWwgPVxyXG4gICAgJycgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCB2aXNpdGFzXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xyXG4gICAgdmlzaXRhc1ByZXMgK1xyXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5WaXNpdGFzPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGNvbnRhY3Rvc1wiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIGNvbnRhY3RvcyArXHJcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPkNvbnRhY3RvczwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBwZWRpZG9zXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xyXG4gICAgcGVkaWRvcy5sZW5ndGggK1xyXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5QZWRpZG9zPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGZhY3RcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXHJcbiAgICBmbXRNb24oZmFjdCkgK1xyXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5GYWN0dXJhZG88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgcGVuZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIHBlbmRpZW50ZXMubGVuZ3RoICtcclxuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+UGVuZGllbnRlczwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBvcHBcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXHJcbiAgICBvcHBzLmxlbmd0aCArXHJcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPk9wb3J0dW5pZGFkZXM8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgZGVhZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIGRlYWQubGVuZ3RoICtcclxuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+U2luIG1vdmltaWVudG88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgY29udlwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIGNvbnYgK1xyXG4gICAgJyU8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+Q29udiB2JnJhcnI7cDwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdFwiPjxkaXYgY2xhc3M9XCJudW1cIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4XCI+JyArXHJcbiAgICAobGFzdEFjdCB8fCAnLScpICtcclxuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+VWx0aW1hIGFjdGl2aWRhZDwvZGl2PjwvZGl2Pic7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1zdGF0cycpLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNlZ1Jlc3VtZW4odmlzaXRzLCBwZWRpZG9zKSB7XHJcbiAgY29uc3QgYWdnID0gYnVpbGRTZWdBZ2dyZWdhdGVzKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgbGV0IGh0bWwgPSAnJztcclxuICBPYmplY3QuZW50cmllcyhhZ2cpXHJcbiAgICAuc29ydCgpXHJcbiAgICAuZm9yRWFjaCgoW3ZlbmRvciwgYl0pID0+IHtcclxuICAgICAgY29uc3QgY29udiA9IGIudmlzaXRzID8gTWF0aC5yb3VuZCgoYi5wZWRpZG9zIC8gYi52aXNpdHMpICogMTAwKSA6IDA7XHJcbiAgICAgIGNvbnN0IGxhc3REYXlzID0gYi5sYXN0QWN0aXZpdHlcclxuICAgICAgICA/IE1hdGguZmxvb3IoKERhdGUubm93KCkgLSBuZXcgRGF0ZShiLmxhc3RBY3Rpdml0eSkuZ2V0VGltZSgpKSAvIDg2NDAwMDAwKVxyXG4gICAgICAgIDogSW5maW5pdHk7XHJcbiAgICAgIGNvbnN0IGNhcmRDbHMgPSBsYXN0RGF5cyA+IDcgPyAneWVsbG93JyA6IGxhc3REYXlzID4gMTUgPyAncmVkJyA6ICcnO1xyXG4gICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXZlbmRvci1jYXJkICcgKyBjYXJkQ2xzICsgJ1wiPic7XHJcbiAgICAgIGh0bWwgKz0gJzxoND4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpKSArICc8L2g0Pic7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnPGRpdiBjbGFzcz1cInZtZXRyaWNzXCI+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xyXG4gICAgICAgIGIudmlzaXRzICtcclxuICAgICAgICAnPC9iPlZpc2l0YXM8L2Rpdj4nICtcclxuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgICAgYi5jb250YWN0b3MgK1xyXG4gICAgICAgICc8L2I+Q29udGFjdG9zPC9kaXY+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xyXG4gICAgICAgIGIucGVkaWRvcyArXHJcbiAgICAgICAgJzwvYj5QZWRpZG9zPC9kaXY+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPiQnICtcclxuICAgICAgICBNYXRoLnJvdW5kKGIuZmFjdHVyYWNpb24pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgICAnPC9iPkZhY3R1cmFjaW9uPC9kaXY+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xyXG4gICAgICAgIGIuY2xpZW50c0FjdGl2ZS5zaXplICtcclxuICAgICAgICAnPC9iPkNsaWVudGVzIGFjdGl2b3M8L2Rpdj4nICtcclxuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgICAgYi5jbGllbnRzVmlzaXRlZC5zaXplICtcclxuICAgICAgICAnPC9iPkNsaWVudGVzIHZpc2l0YWRvczwvZGl2PicgK1xyXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgICBiLnBlbmRpZW50ZXNQZWRpZG9zICtcclxuICAgICAgICAnPC9iPlBlbmQuIGNvbmZpcm1hcjwvZGl2PicgK1xyXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgICBjb252ICtcclxuICAgICAgICAnJTwvYj5Db252LiB2JnJhcnI7cDwvZGl2PicgK1xyXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgICAoYi5sYXN0QWN0aXZpdHkgfHwgJy0nKSArXHJcbiAgICAgICAgJzwvYj5VbHQuIGFjdGl2aWRhZDwvZGl2PicgK1xyXG4gICAgICAgICc8L2Rpdj48L2Rpdj4nO1xyXG4gICAgfSk7XHJcbiAgaWYgKCFodG1sKSBodG1sID0gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5ObyBoYXkgdmVuZGVkb3JlcyBleHRlcm5vcyBlbiBlbCBzY29wZS48L2Rpdj4nO1xyXG4gIHJldHVybiBodG1sO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJTZWdWaXNpdGFzKHZpc2l0cykge1xyXG4gIGlmICghdmlzaXRzLmxlbmd0aCkgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Tm8gaGF5IHZpc2l0YXMgZW4gZWwgcmFuZ28uPC9kaXY+JztcclxuICBjb25zdCBzb3J0ZWQgPSB2aXNpdHMuc2xpY2UoKS5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcbiAgY29uc3QgY2FuRGVsID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJztcclxuICBsZXQgaHRtbCA9XHJcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1yb3cgaGVhZFwiPjxkaXY+RmVjaGE8L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlIC8gVGllbmRhPC9kaXY+PGRpdj5Mb2NhbGlkYWQ8L2Rpdj48ZGl2Pk9ic2VydmFjaW9uZXM8L2Rpdj48L2Rpdj4nO1xyXG4gIHNvcnRlZC5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCBrID0gc2VnTWFrZUtleSh2LnZlbmRvciwgdi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSk7XHJcbiAgICBjb25zdCBkZWxCdG4gPVxyXG4gICAgICBjYW5EZWwgJiYgdi5pZFxyXG4gICAgICAgID8gJyA8YnV0dG9uIG9uY2xpY2s9XCJldmVudC5zdG9wUHJvcGFnYXRpb24oKTtkZWxldGVTZWdWaXNpdGEoXFwnJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHYuaWQpICtcclxuICAgICAgICAgIFwiJywnXCIgK1xyXG4gICAgICAgICAgZXNjYXBlQXR0cih2LnRpZW5kYSB8fCAnJykgK1xyXG4gICAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkVsaW1pbmFyIGVzdGEgdmlzaXRhIChhZG1pbi9nZXJlbnRlKVwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NnB4O3BhZGRpbmc6M3B4IDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweFwiPkJvcnJhcjwvYnV0dG9uPidcclxuICAgICAgICA6ICcnO1xyXG4gICAgLy8gdjQ0MzogYmFkZ2UgdGlwbyAoVklTSVRBIHByZXNlbmNpYWwgdnMgQ09OVEFDVE8gbm8gcHJlc2VuY2lhbCkuXHJcbiAgICBjb25zdCBjb250YWN0byA9IGlzQ29udGFjdG8odik7XHJcbiAgICBjb25zdCB0aXBvQmFkZ2UgPSBjb250YWN0b1xyXG4gICAgICA/ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO2JhY2tncm91bmQ6I2NjZmJmMTtjb2xvcjojMGQ1YzU2O2ZvbnQtc2l6ZTo4cHg7Zm9udC13ZWlnaHQ6ODAwO3BhZGRpbmc6MnB4IDVweDtib3JkZXItcmFkaXVzOjNweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tbGVmdDo2cHhcIj5Db250YWN0bzwvc3Bhbj4nXHJcbiAgICAgIDogJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDojZWRlOWZlO2NvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO2ZvbnQtc2l6ZTo4cHg7Zm9udC13ZWlnaHQ6ODAwO3BhZGRpbmc6MnB4IDVweDtib3JkZXItcmFkaXVzOjNweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tbGVmdDo2cHhcIj5WaXNpdGE8L3NwYW4+JztcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihrKSArICdcXCcpXCI+JztcclxuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwoKHYuZmVjaGEgfHwgJycpLnNsaWNlKDAsIDEwKSB8fCAnLScpICsgdGlwb0JhZGdlICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PjxiPicgKyBlc2NhcGVIdG1sKHYudGllbmRhIHx8ICctJykgKyAnPC9iPjwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHYubG9jYWxpZGFkIHx8ICctJykgKyAnPC9kaXY+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbCgodi5jb21lbnRhcmlvIHx8IHYub2JzZXJ2YWNpb25lcyB8fCAnJykuc2xpY2UoMCwgMTQwKSkgK1xyXG4gICAgICAodi5wcm94aW1hQWNjaW9uXHJcbiAgICAgICAgPyAnPGJyPjxzcGFuIHN0eWxlPVwiY29sb3I6IzBkOTQ4ODtmb250LXdlaWdodDo3MDBcIj5Qcm94aW1hOiAnICtcclxuICAgICAgICAgIGVzY2FwZUh0bWwodi5wcm94aW1hQWNjaW9uKSArXHJcbiAgICAgICAgICAnPC9zcGFuPidcclxuICAgICAgICA6ICcnKSArXHJcbiAgICAgIGRlbEJ0biArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9KTtcclxuICByZXR1cm4gaHRtbDtcclxufVxyXG5cclxuLy8gRWxpbWluYSB1bmEgdmlzaXRhLiBTb2xvIGFkbWluL2dlcmVudGUgKGxhcyBydWxlcyBhZGVtYXMgYXV0b3JpemFuIGFsXHJcbi8vIG93bmVyLCBwZXJvIGRlc2RlIFNlZ3VpbWllbnRvIGxhIGFjY2lvbiBlcyBkZSByZXZpc2lvbi9saW1waWV6YSkuXHJcbndpbmRvdy5kZWxldGVTZWdWaXNpdGEgPSBhc3luYyBmdW5jdGlvbiAodmlzaXRJZCwgdGllbmRhKSB7XHJcbiAgaWYgKCF2aXNpdElkKSByZXR1cm47XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBlbGltaW5hciB2aXNpdGFzLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBsYmwgPSB0aWVuZGEgPyAnXCInICsgdGllbmRhICsgJ1wiJyA6ICdlc3RhIHZpc2l0YSc7XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdFbGltaW5hciBsYSB2aXNpdGEgYSAnICtcclxuICAgICAgICBsYmwgK1xyXG4gICAgICAgICcgZGVsIGhpc3RvcmlhbD9cXG5cXG5Fc3RhIGFjY2lvbiBlcyBJUlJFVkVSU0lCTEU6IGxhIHZpc2l0YSBkZXNhcGFyZWNlIGRlIFNlZ3VpbWllbnRvLCBydXRhcywgZGFzaGJvYXJkIHkgc3RhdHMgZGVsIHZlbmRlZG9yIGV4dGVybm8uJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5kb2ModmlzaXRJZCkuZGVsZXRlKCk7XHJcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnVmlzaXRhIGVsaW1pbmFkYScpO1xyXG4gICAgLy8gUmUtZmV0Y2ggbG9jYWwgKG5vIGhheSBsaXN0ZW5lciBkZSB2aXNpdHMgZ2xvYmFsKS4gRGVzcHVlcyByZS1yZW5kZXIuXHJcbiAgICBhd2FpdCBsb2FkU2VnVmlzaXRzKCk7XHJcbiAgICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZVNlZ1Zpc2l0YScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gcmVuZGVyU2VnUGVkaWRvcyhwZWRpZG9zKSB7XHJcbiAgaWYgKCFwZWRpZG9zLmxlbmd0aCkgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Tm8gaGF5IHBlZGlkb3MgZW4gZWwgcmFuZ28uPC9kaXY+JztcclxuICBjb25zdCBzb3J0ZWQgPSBwZWRpZG9zXHJcbiAgICAuc2xpY2UoKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+XHJcbiAgICAgIChiLmNvbmZpcm1lZEF0IHx8IGIuZmluYWxpemVkQXQgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5jb25maXJtZWRBdCB8fCBhLmZpbmFsaXplZEF0IHx8ICcnKVxyXG4gICAgKTtcclxuICBjb25zdCBjYW5EZWwgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ2dlcmVudGUnO1xyXG4gIGxldCBodG1sID1cclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5GZWNoYTwvZGl2PjxkaXY+VmVuZGVkb3I8L2Rpdj48ZGl2PkNsaWVudGU8L2Rpdj48ZGl2PlVuaWRhZGVzPC9kaXY+PGRpdj5JbXBvcnRlICsgRXN0YWRvPC9kaXY+PC9kaXY+JztcclxuICBzb3J0ZWQuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkocC52ZW5kb3IsIHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKTtcclxuICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgcC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xyXG4gICAgY29uc3QgdW5pdHMgPSAocC5saW5lcyB8fCBbXSkucmVkdWNlKChzLCBsKSA9PiBzICsgKHBhcnNlRmxvYXQobC5xdHkpIHx8IDApLCAwKTtcclxuICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcclxuICAgIGNvbnN0IGJhZGdlQ2xzID0gcC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgPyAnZ3JlZW4nIDogJ3llbGxvdyc7XHJcbiAgICBjb25zdCBiYWRnZVR4dCA9IHAuc3RhZ2UgPT09ICdjb25maXJtZWQnID8gJ0NvbmZpcm1hZG8nIDogJ1BlbmRpZW50ZSc7XHJcbiAgICAvLyBCb3RvbiBFTElNSU5BUjogc29sbyBhZG1pbi9nZXJlbnRlLiBVdGlsIHBhcmEgbGltcGlhciBwZWRpZG9zIFRFU1QuXHJcbiAgICAvLyBzdG9wUHJvcGFnYXRpb24gZXZpdGEgcXVlIGVsIGNsaWNrIGRpc3BhcmUgZWwgdGltZWxpbmUgZGVsIGNsaWVudGUuXHJcbiAgICBjb25zdCBkZWxCdG4gPVxyXG4gICAgICBjYW5EZWwgJiYgcC5fZnNJZFxyXG4gICAgICAgID8gJyA8YnV0dG9uIG9uY2xpY2s9XCJldmVudC5zdG9wUHJvcGFnYXRpb24oKTtkZWxldGVTZWdQZWRpZG8oXFwnJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHAuX2ZzSWQpICtcclxuICAgICAgICAgIFwiJywnXCIgK1xyXG4gICAgICAgICAgZXNjYXBlQXR0cihwLmNsaWVudE5hbWUgfHwgJycpICtcclxuICAgICAgICAgICdcXCcpXCIgdGl0bGU9XCJFbGltaW5hciBlc3RlIHBlZGlkbyBkZWwgaGlzdG9yaWFsIChhZG1pbi9nZXJlbnRlKVwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6OHB4O3BhZGRpbmc6M3B4IDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweFwiPkJvcnJhcjwvYnV0dG9uPidcclxuICAgICAgICA6ICcnO1xyXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy1yb3dcIiBvbmNsaWNrPVwib3BlblNlZ1RpbWVsaW5lKFxcJycgKyBlc2NhcGVBdHRyKGspICsgJ1xcJylcIj4nO1xyXG4gICAgaHRtbCArPSAnPGRpdj4nICsgZXNjYXBlSHRtbChkdCB8fCAnLScpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2PjxiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKHAuY2xpZW50TmFtZSB8fCAnLScpICtcclxuICAgICAgJzwvYj48YnI+PHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKHAubG9jTmFtZSB8fCAnJykgK1xyXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PicgKyB1bml0cy50b0ZpeGVkKDApICsgJyB1PC9kaXY+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXY+JCcgK1xyXG4gICAgICBNYXRoLnJvdW5kKGFtdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xyXG4gICAgICAnIDxzcGFuIGNsYXNzPVwic2VnLWJhZGdlICcgK1xyXG4gICAgICBiYWRnZUNscyArXHJcbiAgICAgICdcIj4nICtcclxuICAgICAgYmFkZ2VUeHQgK1xyXG4gICAgICAnPC9zcGFuPicgK1xyXG4gICAgICBkZWxCdG4gK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGh0bWw7XHJcbn1cclxuXHJcbi8vIEVsaW1pbmEgdW4gcGVkaWRvIGRlbCBoaXN0b3JpYWwuIFNvbG8gYWRtaW4vZ2VyZW50ZS4gTGFzIHJ1bGVzIHlhIGxvXHJcbi8vIHBlcm1pdGVuIHZpYSAnYWxsb3cgdXBkYXRlLCBkZWxldGU6IGlmIGlzQWRtaW5PckdlcmVudGUoKSB8fCAuLi4nLlxyXG4vLyBQZW5zYWRvIHBhcmEgbGltcGlhciBwZWRpZG9zIGRlIFRFU1QgbyBkdXBsaWNhZG9zIHNpbiB0ZW5lciBxdWUgc2FsaXJcclxuLy8gZGUgU2VndWltaWVudG8uIEFjdGlvbiBpcnJldmVyc2libGU6IGJvcnJhIGVsIGRvYyBlbiAvcGVkaWRvcy97aWR9LlxyXG53aW5kb3cuZGVsZXRlU2VnUGVkaWRvID0gYXN5bmMgZnVuY3Rpb24gKGZzSWQsIGNsaWVudE5hbWUpIHtcclxuICBpZiAoIWZzSWQpIHJldHVybjtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlIGVsaW1pbmFyIHBlZGlkb3MuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGxibCA9IGNsaWVudE5hbWUgPyAnXCInICsgY2xpZW50TmFtZSArICdcIicgOiAnZXN0ZSBwZWRpZG8nO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnRWxpbWluYXIgZWwgcGVkaWRvIGRlICcgK1xyXG4gICAgICAgIGxibCArXHJcbiAgICAgICAgJyBkZWwgaGlzdG9yaWFsP1xcblxcbkVzdGEgYWNjaW9uIGVzIElSUkVWRVJTSUJMRTogZWwgcGVkaWRvIGRlc2FwYXJlY2UgZGUgU2VndWltaWVudG8sIERhc2hib2FyZCwgZXhwb3J0cyB5IGNhbXBhXHUwMEYxYXMuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZG9jKGZzSWQpLmRlbGV0ZSgpO1xyXG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykgc2hvd1N5bmNUYWcoJ1BlZGlkbyBlbGltaW5hZG8nKTtcclxuICAgIC8vIEVsIGxpc3RlbmVyIGdsb2JhbCBkZSBwZWRpZG9zIHJlZnJlc2NhIGdsb2JhbFBlZGlkb3Mgc29sby4gUGVyb1xyXG4gICAgLy8gcG9yIHRpbWluZywgZm9yemFtb3MgdW4gcmUtcmVuZGVyIHBvciBzaSB0b2RhdmlhIG5vIGxsZWdvIGVsXHJcbiAgICAvLyBzbmFwc2hvdCB1cGRhdGVkLlxyXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcmVuZGVyU2VndWltaWVudG9UYWIoKTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgICB9LCAyNTApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZVNlZ1BlZGlkbycsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gcmVuZGVyU2VnUGVuZGllbnRlcyhpdGVtcykge1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKSByZXR1cm4gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5TaW4gcGVuZGllbnRlcyBlbiBlbCByYW5nby48L2Rpdj4nO1xyXG4gIGl0ZW1zID0gaXRlbXMuc2xpY2UoKS5zb3J0KChhLCBfYikgPT4gKGEuc3RhdHVzID09PSAncmVkJyA/IC0xIDogMSkpO1xyXG4gIGNvbnN0IGNhbkRlbCA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XHJcbiAgY29uc3QgaXNTZWdVc2VyID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJyB8fCB1c2VyUm9sZSA9PT0gJ2ludGVybm8nO1xyXG4gIGxldCBodG1sID1cclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5Fc3RhZG88L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlPC9kaXY+PGRpdj5VbHQuIGFjY2lvbjwvZGl2PjxkaXY+UHJvYmxlbWEgKyBhY2Npb24gc3VnZXJpZGE8L2Rpdj48L2Rpdj4nO1xyXG4gIGl0ZW1zLmZvckVhY2goKGl0KSA9PiB7XHJcbiAgICBjb25zdCBsYmwgPSBpdC5zdGF0dXMgPT09ICdyZWQnID8gJ0NSSVRJQ08nIDogaXQuc3RhdHVzID09PSAneWVsbG93JyA/ICdSRVZJU0FSJyA6ICdPSyc7XHJcbiAgICAvLyBCb3RvbiBkZSBlbGltaW5hci9yZXNvbHZlciBzZWd1biBvcmlnZW4gZGVsIHBlbmRpZW50ZTpcclxuICAgIC8vIC0gcGVkaWRvLXBlbmRpbmc6IGJvcnJhciBlbCBkb2MgZGVsIHBlZGlkbyAoc29sbyBhZG1pbi9nZXJlbnRlKS5cclxuICAgIC8vIC0gdmlzaXQtbm8tb3JkZXI6IG1hcmNhciBlbCBjbGllbnRLZXkgY29tbyAncmVzdWVsdG8nIGVuXHJcbiAgICAvLyBzZWd1aW1pZW50b19zdGF0dXMgcGFyYSBxdWUgZGV0ZWN0U2VnUGVuZGllbnRlcyBsbyBvY3VsdGVcclxuICAgIC8vIChjdWFscXVpZXIgdXNlciBkZSBTZWd1aW1pZW50byBwdWVkZSByZXNvbHZlcmxvKS5cclxuICAgIGxldCBhY3Rpb25CdG4gPSAnJztcclxuICAgIGlmIChpdC5raW5kID09PSAncGVkaWRvLXBlbmRpbmcnICYmIGNhbkRlbCAmJiBpdC5wZWRpZG9Gc0lkKSB7XHJcbiAgICAgIGFjdGlvbkJ0biA9XHJcbiAgICAgICAgJyA8YnV0dG9uIG9uY2xpY2s9XCJldmVudC5zdG9wUHJvcGFnYXRpb24oKTtkZWxldGVTZWdQZWRpZG8oXFwnJyArXHJcbiAgICAgICAgZXNjYXBlQXR0cihpdC5wZWRpZG9Gc0lkKSArXHJcbiAgICAgICAgXCInLCdcIiArXHJcbiAgICAgICAgZXNjYXBlQXR0cihpdC5jbGllbnQgfHwgJycpICtcclxuICAgICAgICAnXFwnKVwiIHRpdGxlPVwiRWxpbWluYXIgZWwgcGVkaWRvIHBlbmRpZW50ZSBkZWwgaGlzdG9yaWFsIChhZG1pbi9nZXJlbnRlKVwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NnB4O3BhZGRpbmc6M3B4IDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweFwiPkJvcnJhciBwZWRpZG88L2J1dHRvbj4nO1xyXG4gICAgfSBlbHNlIGlmIChpdC5raW5kID09PSAndmlzaXQtbm8tb3JkZXInICYmIGlzU2VnVXNlcikge1xyXG4gICAgICBhY3Rpb25CdG4gPVxyXG4gICAgICAgICcgPGJ1dHRvbiBvbmNsaWNrPVwiZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7c2V0U2VnU3RhdHVzKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIoaXQuY2xpZW50S2V5KSArXHJcbiAgICAgICAgJ1xcJyxcXCdyZXN1ZWx0b1xcJylcIiB0aXRsZT1cIk1hcmNhciBlc3RlIGNsaWVudGUgY29tbyByZXN1ZWx0byAtIHNlIG9jdWx0YSBkZSBQZW5kaWVudGVzIChubyBib3JyYSB2aXNpdGFzKVwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NnB4O3BhZGRpbmc6M3B4IDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweFwiPiYjMTAwMDM7IFJlc29sdmVyPC9idXR0b24+JztcclxuICAgIH1cclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihpdC5jbGllbnRLZXkpICsgJ1xcJylcIj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdj48c3BhbiBjbGFzcz1cInNlZy1zdGF0dXMtZG90ICcgK1xyXG4gICAgICBpdC5zdGF0dXMgK1xyXG4gICAgICAnXCI+PC9zcGFuPjxzcGFuIGNsYXNzPVwic2VnLWJhZGdlICcgK1xyXG4gICAgICBpdC5zdGF0dXMgK1xyXG4gICAgICAnXCI+JyArXHJcbiAgICAgIGxibCArXHJcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcclxuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKGl0LnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2PjxiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKGl0LmNsaWVudCB8fCAnLScpICtcclxuICAgICAgJzwvYj48YnI+PHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKGl0LmxvYyB8fCAnJykgK1xyXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbChpdC51bHRpbWFBY2Npb24gfHwgJy0nKSArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdj48Yj4nICtcclxuICAgICAgZXNjYXBlSHRtbChpdC5wcm9ibGVtYSB8fCAnLScpICtcclxuICAgICAgJzwvYj48YnI+PHNwYW4gc3R5bGU9XCJjb2xvcjojMGQ5NDg4O2ZvbnQtd2VpZ2h0OjcwMFwiPiZyYXJyOyAnICtcclxuICAgICAgZXNjYXBlSHRtbChpdC5hY2Npb24gfHwgJycpICtcclxuICAgICAgJzwvc3Bhbj4nICtcclxuICAgICAgYWN0aW9uQnRuICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIH0pO1xyXG4gIHJldHVybiBodG1sO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJTZWdEZWFkKGl0ZW1zKSB7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpXHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPlRvZG9zIGxvcyBjbGllbnRlcyB0dXZpZXJvbiBhY3RpdmlkYWQgcmVjaWVudGUuICcgK1xyXG4gICAgICAnVW1icmFsZXMgYXBsaWNhZG9zOiBzaW4gdmlzaXRhIDMwZCBZIHNpbiBwZWRpZG8gNDVkLjwvZGl2PidcclxuICAgICk7XHJcbiAgbGV0IGh0bWwgPVxyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctcm93IGhlYWRcIj48ZGl2PkVzdGFkbzwvZGl2PjxkaXY+VmVuZGVkb3I8L2Rpdj48ZGl2PkNsaWVudGU8L2Rpdj48ZGl2PkRpYXMgc2luIGFjdC48L2Rpdj48ZGl2PlVsdC4gdmlzaXRhIC8gcGVkaWRvICsgZmFjdHVyYWNpb24gKyBhY2Npb248L2Rpdj48L2Rpdj4nO1xyXG4gIGl0ZW1zLmZvckVhY2goKGl0KSA9PiB7XHJcbiAgICBjb25zdCBsYmwgPSBpdC5zdGF0dXMgPT09ICdyZWQnID8gJ0NSSVRJQ08nIDogJ1JFVklTQVInO1xyXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy1yb3dcIiBvbmNsaWNrPVwib3BlblNlZ1RpbWVsaW5lKFxcJycgKyBlc2NhcGVBdHRyKGl0LmNsaWVudEtleSkgKyAnXFwnKVwiPic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2PjxzcGFuIGNsYXNzPVwic2VnLXN0YXR1cy1kb3QgJyArXHJcbiAgICAgIGl0LnN0YXR1cyArXHJcbiAgICAgICdcIj48L3NwYW4+PHNwYW4gY2xhc3M9XCJzZWctYmFkZ2UgJyArXHJcbiAgICAgIGl0LnN0YXR1cyArXHJcbiAgICAgICdcIj4nICtcclxuICAgICAgbGJsICtcclxuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPGRpdj4nICsgZXNjYXBlSHRtbCh0aXRsZUNhc2UoaXQudmVuZG9yIHx8ICcnKSkgKyAnPC9kaXY+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXY+PGI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWwoaXQuY2xpZW50IHx8ICctJykgK1xyXG4gICAgICAnPC9iPjxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWwoaXQubG9jIHx8ICcnKSArXHJcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcclxuICAgIGh0bWwgKz0gJzxkaXY+PGIgc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1kYW5nZXIpXCI+JyArIGl0LmRheXNBZ28gKyAnZDwvYj48L2Rpdj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdj5WaXNpdGE6ICcgK1xyXG4gICAgICBlc2NhcGVIdG1sKGl0Lmxhc3RWaXNpdCB8fCAnLScpICtcclxuICAgICAgJyAmbWlkZG90OyBQZWRpZG86ICcgK1xyXG4gICAgICBlc2NhcGVIdG1sKGl0Lmxhc3RPcmRlciB8fCAnLScpICtcclxuICAgICAgKGl0LmZhY3R1cmFjaW9uXHJcbiAgICAgICAgPyAnPGJyPkZhY3R1cmFjaW9uIGhpc3RvcmljYTogPGI+JCcgK1xyXG4gICAgICAgICAgTWF0aC5yb3VuZChpdC5mYWN0dXJhY2lvbikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xyXG4gICAgICAgICAgJzwvYj4nXHJcbiAgICAgICAgOiAnJykgK1xyXG4gICAgICAnPGJyPjxzcGFuIHN0eWxlPVwiY29sb3I6IzBkOTQ4ODtmb250LXdlaWdodDo3MDBcIj4mcmFycjsgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwoaXQuYWNjaW9uIHx8ICcnKSArXHJcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGh0bWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNlZ09wcHMoaXRlbXMpIHtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aClcclxuICAgIHJldHVybiAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGRldGVjdCZlYWN1dGU7IG9wb3J0dW5pZGFkZXMgZW4gZWwgcmFuZ28uPGJyPkxhcyBvcG9ydHVuaWRhZGVzIHNlIGRldGVjdGFuIHBvciBwYWxhYnJhcyBjbGF2ZSBlbiBsb3MgY29tZW50YXJpb3MgZGUgdmlzaXRhIChpbnRlcmVzYWRvLCBwb3RlbmNpYWwsIGNpZXJyZSwgcmVwb3NpY2lvbiwgY290aXphLi4uKS48L2Rpdj4nO1xyXG4gIHJldHVybiByZW5kZXJTZWdQZW5kaWVudGVzKGl0ZW1zKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyU2VnRHVwbGFzKGR1cGxhcykge1xyXG4gIGNvbnN0IGFyciA9IE9iamVjdC52YWx1ZXMoZHVwbGFzKTtcclxuICBpZiAoIWFyci5sZW5ndGgpIHJldHVybiAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPk5vIGhheSBkdXBsYXMgY29uIGFjdGl2aWRhZCBlbiBlbCByYW5nby48L2Rpdj4nO1xyXG4gIGxldCBodG1sID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbTo4cHg7Zm9udC13ZWlnaHQ6NzAwO3BhZGRpbmc6OHB4IDEycHg7YmFja2dyb3VuZDojZjBmZGZhO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NXB4XCI+VGFzYSBkZSBjb252ZXJzaW9uIHZpc2l0YSAmcmFycjsgcGVkaWRvID0gcGVkaWRvcyBjb25maXJtYWRvcyAvIHZpc2l0YXMuIEVzIGxhIG1ldHJpY2EgY2xhdmUgcGFyYSBldmFsdWFyIHNpIGxhcyB2aXNpdGFzIGdlbmVyYW4gbmVnb2NpbyByZWFsLjwvZGl2Pic7XHJcbiAgYXJyLnNvcnQoKGEsIGIpID0+IChiLmZhY3QgfHwgMCkgLSAoYS5mYWN0IHx8IDApKTtcclxuICBhcnIuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgY29uc3QgY29udiA9IGQudmlzaXRhcyA/IE1hdGgucm91bmQoKGQucGVkaWRvc0NvbmYgLyBkLnZpc2l0YXMpICogMTAwKSA6IDA7XHJcbiAgICBjb25zdCBjbHMgPSBjb252ID49IDUwID8gJycgOiBjb252ID49IDI1ID8gJ3llbGxvdycgOiAncmVkJztcclxuICAgIGNvbnN0IGNvbnZCZyA9IGNvbnYgPj0gNTAgPyAnI2RjZmNlNycgOiBjb252ID49IDI1ID8gJyNmZWYzYzcnIDogJyNmZWUyZTInO1xyXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy12ZW5kb3ItY2FyZCAnICsgY2xzICsgJ1wiPic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8aDQ+JyArXHJcbiAgICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKGQuaW50ZXJubykpICtcclxuICAgICAgJyAmbWlkZG90OyAnICtcclxuICAgICAgZXNjYXBlSHRtbCh0aXRsZUNhc2UoZC5leHRlcm5vKSkgK1xyXG4gICAgICAnPC9oND4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtZXRyaWNzXCI+JyArXHJcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgZC52aXNpdGFzICtcclxuICAgICAgJzwvYj5WaXNpdGFzPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgZC5wZWRpZG9zICtcclxuICAgICAgJzwvYj5QZWRpZG9zPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgZC5wZWRpZG9zQ29uZiArXHJcbiAgICAgICc8L2I+Q29uZmlybWFkb3M8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiIHN0eWxlPVwiYmFja2dyb3VuZDonICtcclxuICAgICAgY29udkJnICtcclxuICAgICAgJ1wiPjxiPicgK1xyXG4gICAgICBjb252ICtcclxuICAgICAgJyU8L2I+Q29udiB2JnJhcnI7cDwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JCcgK1xyXG4gICAgICBNYXRoLnJvdW5kKGQuZmFjdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xyXG4gICAgICAnPC9iPkZhY3R1cmFjaW9uPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgZC5jbGllbnRlcy5zaXplICtcclxuICAgICAgJzwvYj5DbGllbnRlczwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgIGQucGVuZGllbnRlcyArXHJcbiAgICAgICc8L2I+UGVuZC4gY29uZmlybWFyPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgKGQubGFzdEFjdCB8fCAnLScpICtcclxuICAgICAgJzwvYj5VbHQuIGFjdGl2aWRhZDwvZGl2PicgK1xyXG4gICAgICAnPC9kaXY+PC9kaXY+JztcclxuICB9KTtcclxuICByZXR1cm4gaHRtbDtcclxufVxyXG5cclxud2luZG93Lm9wZW5TZWdUaW1lbGluZSA9IGZ1bmN0aW9uIChjbGllbnRLZXkpIHtcclxuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSByZXR1cm47XHJcbiAgY29uc3QgcGFydHMgPSAoY2xpZW50S2V5IHx8ICcnKS5zcGxpdCgnfCcpO1xyXG4gIGNvbnN0IHZlbmRvciA9IHBhcnRzWzBdLFxyXG4gICAgcHJvdiA9IHBhcnRzWzFdLFxyXG4gICAgbG9jID0gcGFydHNbMl0sXHJcbiAgICBuYW1lID0gcGFydHNbM107XHJcbiAgaWYgKCF2ZW5kb3JJblNlZ3VpbWllbnRvU2NvcGUodmVuZG9yKSkge1xyXG4gICAgYWxlcnQoJ05vIHRlbmVzIHBlcm1pc29zIHBhcmEgdmVyIGVzdGUgY2xpZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY3VycmVudFNlZ1RpbWVsaW5lS2V5ID0gY2xpZW50S2V5O1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGwtdGl0bGUnKS50ZXh0Q29udGVudCA9IG5hbWUgfHwgJyhjbGllbnRlKSc7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10bC1zdWInKS5pbm5lckhUTUwgPVxyXG4gICAgZXNjYXBlSHRtbCh0aXRsZUNhc2UodmVuZG9yIHx8ICcnKSkgK1xyXG4gICAgJyAmbWlkZG90OyAnICtcclxuICAgIGVzY2FwZUh0bWwobG9jIHx8ICcnKSArXHJcbiAgICAnIC8gJyArXHJcbiAgICBlc2NhcGVIdG1sKHRpdGxlQ2FzZShwcm92IHx8ICcnKSk7XHJcbiAgY29uc3QgaXRlbXMgPSBbXTtcclxuICAoc2VnVmlzaXRzQ2FjaGUgfHwgW10pXHJcbiAgICAuZmlsdGVyKFxyXG4gICAgICAodikgPT4gdi52ZW5kb3IgPT09IHZlbmRvciAmJiB2LnByb3ZpbmNpYSA9PT0gcHJvdiAmJiB2LmxvY2FsaWRhZCA9PT0gbG9jICYmIHYudGllbmRhID09PSBuYW1lXHJcbiAgICApXHJcbiAgICAuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgICBpdGVtcy5wdXNoKHtcclxuICAgICAgICB0eXBlOiAndmlzaXQnLFxyXG4gICAgICAgIGRhdGU6ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCksXHJcbiAgICAgICAgdGl0bGU6ICdWaXNpdGEnLFxyXG4gICAgICAgIGJvZHk6XHJcbiAgICAgICAgICAodi5jb21lbnRhcmlvIHx8IHYub2JzZXJ2YWNpb25lcyB8fCAnKHNpbiBjb21lbnRhcmlvcyknKSArXHJcbiAgICAgICAgICAodi5wcm94aW1hQWNjaW9uID8gJ1xcblByb3hpbWEgYWNjaW9uOiAnICsgdi5wcm94aW1hQWNjaW9uIDogJycpLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIChnbG9iYWxQZWRpZG9zIHx8IFtdKVxyXG4gICAgLmZpbHRlcihcclxuICAgICAgKHApID0+XHJcbiAgICAgICAgc2VnUGVkaWRvVmVuZG9yKHApID09PSB2ZW5kb3IgJiZcclxuICAgICAgICBwLnByb3ZpbmNlID09PSBwcm92ICYmXHJcbiAgICAgICAgcC5sb2NOYW1lID09PSBsb2MgJiZcclxuICAgICAgICBwLmNsaWVudE5hbWUgPT09IG5hbWVcclxuICAgIClcclxuICAgIC5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgcC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xyXG4gICAgICBjb25zdCBhbXQgPSBwLm5ldEFtb3VudEFycyAhPSBudWxsID8gcC5uZXRBbW91bnRBcnMgOiBwLnN1YnRvdGFsQXJzIHx8IDA7XHJcbiAgICAgIGNvbnN0IHVuaXRzID0gKHAubGluZXMgfHwgW10pLnJlZHVjZSgocywgbCkgPT4gcyArIChwYXJzZUZsb2F0KGwucXR5KSB8fCAwKSwgMCk7XHJcbiAgICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICAgIHR5cGU6ICdvcmRlcicsXHJcbiAgICAgICAgZGF0ZTogZHQsXHJcbiAgICAgICAgdGl0bGU6XHJcbiAgICAgICAgICAnUGVkaWRvICcgK1xyXG4gICAgICAgICAgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnID8gJ2NvbmZpcm1hZG8nIDogcC5zdGFnZSA9PT0gJ3BlbmRpbmcnID8gJ3BlbmRpZW50ZScgOiBwLnN0YWdlKSxcclxuICAgICAgICBib2R5OlxyXG4gICAgICAgICAgJyQnICtcclxuICAgICAgICAgIE1hdGgucm91bmQoYW10KS50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXHJcbiAgICAgICAgICAnIC8gJyArXHJcbiAgICAgICAgICB1bml0cy50b0ZpeGVkKDApICtcclxuICAgICAgICAgICcgdSAvICcgK1xyXG4gICAgICAgICAgLy8gdjYwNSBFNTogU0tVcyB1bmljb3MgKGNvbiB2NjAwIHNwbGl0LCB1biBTS1UgcHVlZGUgYXBhcmVjZXIgZW4gMiBsaW5lYXMpXHJcbiAgICAgICAgICBuZXcgU2V0KChwLmxpbmVzIHx8IFtdKS5tYXAoKGwpID0+IGwgJiYgbC5jb2RlKS5maWx0ZXIoQm9vbGVhbikpLnNpemUgK1xyXG4gICAgICAgICAgJyBTS1UocyknLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIChzZWdOb3Rlc0NhY2hlIHx8IFtdKVxyXG4gICAgLmZpbHRlcigobikgPT4gbi5jbGllbnRLZXkgPT09IGNsaWVudEtleSlcclxuICAgIC5mb3JFYWNoKChuKSA9PiB7XHJcbiAgICAgIGNvbnN0IGR0ID1cclxuICAgICAgICBuLmNyZWF0ZWRBdCAmJiBuLmNyZWF0ZWRBdC50b0RhdGUgPyBuLmNyZWF0ZWRBdC50b0RhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSA6ICcnO1xyXG4gICAgICBpdGVtcy5wdXNoKHtcclxuICAgICAgICB0eXBlOiAnbm90ZScsXHJcbiAgICAgICAgZGF0ZTogZHQsXHJcbiAgICAgICAgdGl0bGU6ICdOb3RhIGludGVybmEgLSAnICsgKG4uYXV0aG9yTmFtZSB8fCBuLmF1dGhvckVtYWlsIHx8ICcnKSxcclxuICAgICAgICBib2R5OiBuLnRleHQgfHwgJycsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgaXRlbXMuc29ydCgoYSwgYikgPT4gKGIuZGF0ZSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmRhdGUgfHwgJycpKTtcclxuICBsZXQgaHRtbCA9ICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lXCI+JztcclxuICBpZiAoIWl0ZW1zLmxlbmd0aClcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5TaW4gYWN0aXZpZGFkIHJlZ2lzdHJhZGEgcGFyYSBlc3RlIGNsaWVudGUuPC9kaXY+JztcclxuICBpdGVtcy5mb3JFYWNoKChpdCkgPT4ge1xyXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy10aW1lbGluZS1pdGVtICcgKyBpdC50eXBlICsgJ1wiPic7XHJcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lLWRhdGVcIj4nICsgZXNjYXBlSHRtbChpdC5kYXRlIHx8ICcocy9mKScpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lLXRpdGxlXCI+JyArIGVzY2FwZUh0bWwoaXQudGl0bGUpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IGNsYXNzPVwic2VnLXRpbWVsaW5lLWJvZHlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbChpdC5ib2R5IHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJzxicj4nKSArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9KTtcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGN1clN0YXR1cyA9IHNlZ1N0YXR1c0NhY2hlW2NsaWVudEtleV0gfHwgJyc7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7cGFkZGluZzoxMHB4IDEycHg7bWFyZ2luLXRvcDoxNHB4O2JvcmRlci1yYWRpdXM6NnB4XCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4zcHg7bWFyZ2luLWJvdHRvbTo2cHhcIj5Fc3RhZG8gZGUgc2VndWltaWVudG8gaW50ZXJubyAobm8gYWZlY3RhIHZpc2l0YSBuaSBwZWRpZG8gb3JpZ2luYWwpPC9kaXY+JztcclxuICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXN0YXR1cy1yb3dcIj4nO1xyXG4gIFtcclxuICAgIFsncGVuZGllbnRlJywgJ01hcmNhciBwZW5kaWVudGUnXSxcclxuICAgIFsncmV2aXNhZG8nLCAnTWFyY2FyIHJldmlzYWRvJ10sXHJcbiAgICBbJ3Jlc3VlbHRvJywgJ01hcmNhciByZXN1ZWx0byddLFxyXG4gIF0uZm9yRWFjaCgocykgPT4ge1xyXG4gICAgY29uc3QgYWN0ID0gY3VyU3RhdHVzID09PSBzWzBdID8gJ2FjdGl2ZScgOiAnJztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxidXR0b24gY2xhc3M9XCJzZWctc3RhdHVzLWJ0biAnICtcclxuICAgICAgYWN0ICtcclxuICAgICAgJ1wiIG9uY2xpY2s9XCJzZXRTZWdTdGF0dXMoXFwnJyArXHJcbiAgICAgIGVzY2FwZUF0dHIoY2xpZW50S2V5KSArXHJcbiAgICAgIFwiJywnXCIgK1xyXG4gICAgICBzWzBdICtcclxuICAgICAgJ1xcJylcIj4nICtcclxuICAgICAgc1sxXSArXHJcbiAgICAgICc8L2J1dHRvbj4nO1xyXG4gIH0pO1xyXG4gIGh0bWwgKz0gJzwvZGl2PjwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy1ub3RlLWZvcm1cIj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLWNvbG9yLXdhcm5pbmcpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4O21hcmdpbi1ib3R0b206NXB4XCI+Tm90YSBpbnRlcm5hIGVudHJlIGludGVybm8geSBleHRlcm5vIChubyBtb2RpZmljYSBsYSB2aXNpdGEpPC9kaXY+JztcclxuICBodG1sICs9XHJcbiAgICAnPHRleHRhcmVhIGlkPVwic2VnLW5vdGUtaW5wdXRcIiBwbGFjZWhvbGRlcj1cIkVqOiByZXZpc2FkbywgbG8gbGxhbW8gbWFcdTAwRjFhbmEgcGFyYSBjZXJyYXIgcmVwb3NpY2lvblwiPjwvdGV4dGFyZWE+JztcclxuICBodG1sICs9ICc8YnV0dG9uIG9uY2xpY2s9XCJzYXZlU2VnTm90ZShcXCcnICsgZXNjYXBlQXR0cihjbGllbnRLZXkpICsgJ1xcJylcIj5HdWFyZGFyIG5vdGE8L2J1dHRvbj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10bC1jb250ZW50JykuaW5uZXJIVE1MID0gaHRtbDtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLXRpbWVsaW5lLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlU2VnVGltZWxpbmUgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10aW1lbGluZS1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxuICBjdXJyZW50U2VnVGltZWxpbmVLZXkgPSBudWxsO1xyXG59O1xyXG5cclxud2luZG93LnNhdmVTZWdOb3RlID0gYXN5bmMgZnVuY3Rpb24gKGNsaWVudEtleSkge1xyXG4gIGlmICghY2FuVmlld1NlZ3VpbWllbnRvKCkpIHJldHVybjtcclxuICBjb25zdCBwYXJ0cyA9IChjbGllbnRLZXkgfHwgJycpLnNwbGl0KCd8Jyk7XHJcbiAgY29uc3QgdmVuZG9yID0gcGFydHNbMF07XHJcbiAgaWYgKCF2ZW5kb3JJblNlZ3VpbWllbnRvU2NvcGUodmVuZG9yKSkge1xyXG4gICAgYWxlcnQoJ1NpbiBwZXJtaXNvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgdGEgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLW5vdGUtaW5wdXQnKTtcclxuICBjb25zdCB0ZXh0ID0gKCh0YSAmJiB0YS52YWx1ZSkgfHwgJycpLnRyaW0oKTtcclxuICBpZiAoIXRleHQpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19ub3RlcycpLmFkZCh7XHJcbiAgICAgIGNsaWVudEtleSxcclxuICAgICAgdmVuZG9yRXh0OiB2ZW5kb3IsXHJcbiAgICAgIHByb3Y6IHBhcnRzWzFdLFxyXG4gICAgICBsb2M6IHBhcnRzWzJdLFxyXG4gICAgICBjbGllbnROYW1lOiBwYXJ0c1szXSxcclxuICAgICAgYXV0aG9yVWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgIGF1dGhvckVtYWlsOiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgYXV0aG9yTmFtZTogY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIGF1dGhvclJvbGU6IHVzZXJSb2xlLFxyXG4gICAgICB0ZXh0LFxyXG4gICAgICBjcmVhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgfSk7XHJcbiAgICBpZiAodGEpIHRhLnZhbHVlID0gJyc7XHJcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnTm90YSBpbnRlcm5hIGd1YXJkYWRhJyk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFcnJvciBndWFyZGFuZG8gbm90YTogJyArXHJcbiAgICAgICAgKGUubWVzc2FnZSB8fCBlKSArXHJcbiAgICAgICAgJ1xcblxcblByb2JhYmxlOiBmYWx0YW4gcnVsZXMgZW4gRmlyZXN0b3JlIHBhcmEgXCJzZWd1aW1pZW50b19ub3Rlc1wiLidcclxuICAgICk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LnNldFNlZ1N0YXR1cyA9IGFzeW5jIGZ1bmN0aW9uIChjbGllbnRLZXksIHN0YXR1cykge1xyXG4gIGlmICghY2FuVmlld1NlZ3VpbWllbnRvKCkpIHJldHVybjtcclxuICBjb25zdCBwYXJ0cyA9IChjbGllbnRLZXkgfHwgJycpLnNwbGl0KCd8Jyk7XHJcbiAgY29uc3QgdmVuZG9yID0gcGFydHNbMF07XHJcbiAgaWYgKCF2ZW5kb3JJblNlZ3VpbWllbnRvU2NvcGUodmVuZG9yKSkge1xyXG4gICAgYWxlcnQoJ1NpbiBwZXJtaXNvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZG9jSWQgPSBjbGllbnRLZXkucmVwbGFjZSgvWy9cXFxcIz9dL2csICdfJykuc2xpY2UoMCwgNDAwKSArICdfXycgKyAoY3VycmVudFVzZXIudWlkIHx8ICcnKTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19zdGF0dXMnKS5kb2MoZG9jSWQpLnNldChcclxuICAgICAge1xyXG4gICAgICAgIGNsaWVudEtleSxcclxuICAgICAgICB2ZW5kb3JFeHQ6IHZlbmRvcixcclxuICAgICAgICBwcm92OiBwYXJ0c1sxXSxcclxuICAgICAgICBsb2M6IHBhcnRzWzJdLFxyXG4gICAgICAgIGNsaWVudE5hbWU6IHBhcnRzWzNdLFxyXG4gICAgICAgIGF1dGhvclVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgIHN0YXR1cyxcclxuICAgICAgICB1cGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICB9LFxyXG4gICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICk7XHJcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnRXN0YWRvOiAnICsgc3RhdHVzKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpICsgJ1xcblxcblByb2JhYmxlOiBmYWx0YW4gcnVsZXMgcGFyYSBcInNlZ3VpbWllbnRvX3N0YXR1c1wiLicpO1xyXG4gIH1cclxufTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBbUJBLE1B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
