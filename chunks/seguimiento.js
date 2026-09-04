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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvc2VndWltaWVudG8uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEdsb2JhbHMgbGVcdTAwRURkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcclxuLy8gZmJEYiwgZmlyZWJhc2UsIGN1cnJlbnRVc2VyLCB1c2VyUm9sZSwgVkVORE9SX0lOQ0xVREVTX09USEVSUywgZ2xvYmFsUGVkaWRvcyxcclxuLy8gZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLCBzaG93U3luY1RhZywgY2FuVmlld1NlZ3VpbWllbnRvLFxyXG4vLyBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0LCB2ZW5kb3JJblNlZ3VpbWllbnRvU2NvcGUsIGdldFZlbmRvckZvcktleVxyXG4vLyAoZGFzaGJvYXJkIGJ1bmRsZSkuIE1cdTAwRjNkdWxvIGV4dHJhXHUwMEVEZG8gdmVyYmF0aW06IHRpcGFkbyByZWFsIGZ1ZXJhIGRlIHNjb3BlIEUyLmQuXHJcbi8vXHJcbi8vIFNFR1VJTUlFTlRPIC0gUGFuZWwgZGUgZ2VzdGlcdTAwRjNuIGNvbWVyY2lhbCBwYXJhIHZlbmRlZG9yZXMgaW50ZXJub3MuXHJcbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgMjY3MTMtMjc0MDggcHJlLUUyLmQpIGNvbW8gcGFydGVcclxuLy8gZGUgRTIuZCAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuIFByZXNlcnZhIDEwMCUgY29tcG9ydGFtaWVudG8uXHJcbi8vXHJcbi8vIENyb3NzLXNjb3BlIHN0YXRlICh2aWEgd2luZG93KTpcclxuLy8gLSB3aW5kb3cudW5zdWJTZWdOb3RlcyAvIHdpbmRvdy51bnN1YlNlZ1N0YXR1czogbGlzdGVuZXJzIGNvbiBjbGVhbnVwIGVuXHJcbi8vICAgZGV0YWNoRmlyZWJhc2VMaXN0ZW5lcnMoKSBpbmxpbmUgKGxcdTAwRURuZWFzIDI2MTQ4LTQ5IHByZS1FMi5kKS5cclxuLy8gTG9jYWxzIGFsIG1cdTAwRjNkdWxvOiBzZWdWaXNpdHNDYWNoZSwgc2VnTm90ZXNDYWNoZSwgc2VnU3RhdHVzQ2FjaGUsXHJcbi8vIHNlZ0N1cnJlbnRUYWIsIGN1cnJlbnRTZWdUaW1lbGluZUtleSwgX3NlZ0RlYm91bmNlVGltZXIuXHJcblxyXG4vLyBJbml0IGNyb3NzLXNjb3BlIHN0YXRlIChidW5kbGUgSUlGRSBjb3JyZSBwcmUtaW5saW5lOyBnYXJhbnRpemEgcXVlIGxhc1xyXG4vLyB2YXJzIHVuc3ViKiBleGlzdGVuIGVuIHdpbmRvdyBhbnRlcyBkZSBxdWUgZGV0YWNoRmlyZWJhc2VMaXN0ZW5lcnMgbGFzIGxlYSkuXHJcbmlmICh0eXBlb2Ygd2luZG93LnVuc3ViU2VnTm90ZXMgPT09ICd1bmRlZmluZWQnKSB3aW5kb3cudW5zdWJTZWdOb3RlcyA9IG51bGw7XHJcbmlmICh0eXBlb2Ygd2luZG93LnVuc3ViU2VnU3RhdHVzID09PSAndW5kZWZpbmVkJykgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gbnVsbDtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VHVUlNSUVOVE8gLSBQYW5lbCBkZSBnZXN0aW9uIGNvbWVyY2lhbCBwYXJhIHZlbmRlZG9yZXMgaW50ZXJub3MuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gTW9kZWxvOlxyXG4vLyAgIHZpc2l0YXMgICAgICAtPiBjb2xsZWN0aW9uICd2aXNpdHMnIChjYXJnYWRhIDF4IGNvbiB3aGVyZSB2ZW5kb3IgaW4gWy4uLl0pXHJcbi8vICAgcGVkaWRvcyAgICAgIC0+IGdsb2JhbFBlZGlkb3MgKHlhIGxpc3RlbmVyYWRvIHBhcmEgc3VnZXJlbmNpYXMgY3J1emFkYXMpXHJcbi8vICAgbm90YXMgICAgICAgIC0+IGNvbGxlY3Rpb24gJ3NlZ3VpbWllbnRvX25vdGVzJ1xyXG4vLyAgIGVzdGFkb3MgICAgICAtPiBjb2xsZWN0aW9uICdzZWd1aW1pZW50b19zdGF0dXMnICAocmV2aXNhZG8gLyBwZW5kaWVudGUgLyByZXN1ZWx0bylcclxuLy8gUGVybWlzb3M6IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKSBlcyBlbCBndWFyZC4gQ2FkYSBhY2Npb24gKG9wZW4sXHJcbi8vIHJlbmRlciwgc2F2ZSwgc2V0U3RhdHVzKSByZS12YWxpZGEgdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikgcGFyYVxyXG4vLyBxdWUgbGEgbWFuaXB1bGFjaW9uIGRlbCBmcm9udGVuZCBubyBwdWVkYSBmb3J6YXIgYWNjZXNvIGEgdW4gVkRFIGFqZW5vLlxyXG5sZXQgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcclxubGV0IHNlZ05vdGVzQ2FjaGUgPSBbXTtcclxubGV0IHNlZ1N0YXR1c0NhY2hlID0ge307XHJcbmxldCBzZWdDdXJyZW50VGFiID0gJ3Jlc3VtZW4nO1xyXG5sZXQgY3VycmVudFNlZ1RpbWVsaW5lS2V5ID0gbnVsbDtcclxubGV0IF9zZWdEZWJvdW5jZVRpbWVyID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIHNlZ1BlZGlkb1ZlbmRvcihwKSB7XHJcbiAgaWYgKCFwKSByZXR1cm4gJyc7XHJcbiAgaWYgKHAudmVuZG9yKSByZXR1cm4gcC52ZW5kb3I7XHJcbiAgaWYgKHAuYXNzaWduZWRWZW5kb3IpIHJldHVybiBwLmFzc2lnbmVkVmVuZG9yO1xyXG4gIGlmICh0eXBlb2YgZ2V0VmVuZG9yRm9yS2V5ID09PSAnZnVuY3Rpb24nICYmIHAua2V5KSByZXR1cm4gZ2V0VmVuZG9yRm9yS2V5KHAua2V5KTtcclxuICByZXR1cm4gJyc7XHJcbn1cclxuXHJcbi8vIHY0NDMgKDIwMjYtMDgtMTEpOiBkaXN0aW5ndWlyIHZpc2l0YSBwcmVzZW5jaWFsIHZzIGNvbnRhY3RvIG5vIHByZXNlbmNpYWxcclxuLy8gKFdoYXRzQXBwL3RlbC9lbWFpbCkuIEVsIGNhbXBvIGBpbnRlcmFjdGlvblR5cGVgIHNlIHNldGVhIGVuIHZpc2l0YXMuanMgYWxcclxuLy8gYWJyaXIgZWwgbW9kYWwgKG1vZG8gJ3Zpc2l0YScgdnMgJ2NvbnRhY3RvJykgeSBxdWVkYSBlbiBlbCBkb2MgZGUgRmlyZXN0b3JlLlxyXG4vLyBEb2NzIHZpZWpvcyBzaW4gZXNlIGNhbXBvIHNlIGFzdW1lbiAndmlzaXRhJyBwb3IgZGVmZWN0byAocmV0cm9jb21wYXQpLlxyXG5mdW5jdGlvbiBpc0NvbnRhY3RvKHYpIHtcclxuICByZXR1cm4gISEodiAmJiB2LmludGVyYWN0aW9uVHlwZSA9PT0gJ2NvbnRhY3RvJyk7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuU2VndWltaWVudG9Nb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSB7XHJcbiAgICBhbGVydCgnVHUgcm9sIG5vIHRpZW5lIGFjY2VzbyBhIFNlZ3VpbWllbnRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XHJcbiAgaWYgKCFzZXQuc2l6ZSkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdUb2RhdmlhIG5vIHRlbmVzIHZlbmRlZG9yZXMgZXh0ZXJub3MgYXNpZ25hZG9zLlxcblxcblNpIHNvcyB2ZW5kZWRvciBpbnRlcm5vIChTYW50aWFnbyAvIElvYW5uaXMpLCBwZWRpbGUgYWwgYWRtaW4gcXVlIGVuIFBhbmVsIFVzdWFyaW9zIC0+IHR1IFZERSAtPiBcIlBhcmVqYSBpbnRlcm5vXCIgdGUgYXNvY2llIGNvbW8gcGFyZWphLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWd1aW1pZW50by1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxuICBwb3B1bGF0ZVNlZ0ZpbHRlcnMoKTtcclxuICBjb25zdCBkZXNkZUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZGVzZGUnKTtcclxuICBjb25zdCBoYXN0YUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1maGFzdGEnKTtcclxuICBpZiAoZGVzZGVFbCAmJiAhZGVzZGVFbC52YWx1ZSkge1xyXG4gICAgLy8gdjQ0MSAoMjAyNi0wOC0xMSk6IGRlZmF1bHQgPSBwcmltZXIgZFx1MDBFRGEgZGVsIG1lcyBlbiBjdXJzbyBcdTIxOTIgaG95LlxyXG4gICAgLy8gRmVlZGJhY2sgTWFyaWFubzogZXJhIGhveS05MGQsIG11eSBhbXBsaW87IGVsIGVxdWlwbyBjb21lcmNpYWwgbWlyYVxyXG4gICAgLy8gc2VndWltaWVudG8gZGVsIG1lcyB2aWdlbnRlIGNhc2kgc2llbXByZS5cclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICBjb25zdCBkZXNkZSA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMSk7XHJcbiAgICBkZXNkZUVsLnZhbHVlID0gZGVzZGUudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgICBoYXN0YUVsLnZhbHVlID0gbm93LnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIH1cclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPVxyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5DYXJnYW5kbyBkYXRvcy4uLjwvZGl2Pic7XHJcbiAgYXdhaXQgbG9hZFNlZ1Zpc2l0cygpO1xyXG4gIGF0dGFjaFNlZ05vdGVzTGlzdGVuZXIoKTtcclxuICBhdHRhY2hTZWdTdGF0dXNMaXN0ZW5lcigpO1xyXG4gIHNldFNlZ3VpbWllbnRvVGFiKHNlZ0N1cnJlbnRUYWIpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VTZWd1aW1pZW50b01vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWd1aW1pZW50by1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbmZ1bmN0aW9uIHBvcHVsYXRlU2VnRmlsdGVycygpIHtcclxuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XHJcbiAgY29uc3Qgc2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mdmVuZG9yJyk7XHJcbiAgaWYgKCFzZWwpIHJldHVybjtcclxuICBjb25zdCBjdXIgPSBzZWwudmFsdWUgfHwgJ0FMTCc7XHJcbiAgY29uc3Qgb3B0cyA9IFsnPG9wdGlvbiB2YWx1ZT1cIkFMTFwiPlRvZG9zPC9vcHRpb24+J10uY29uY2F0KFxyXG4gICAgWy4uLnNldF1cclxuICAgICAgLnNvcnQoKVxyXG4gICAgICAubWFwKFxyXG4gICAgICAgICh2KSA9PlxyXG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih2KSArICdcIj4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2KSkgKyAnPC9vcHRpb24+J1xyXG4gICAgICApXHJcbiAgKTtcclxuICBzZWwuaW5uZXJIVE1MID0gb3B0cy5qb2luKCcnKTtcclxuICBzZWwudmFsdWUgPSBzZXQuaGFzKGN1cikgfHwgY3VyID09PSAnQUxMJyA/IGN1ciA6ICdBTEwnO1xyXG4gIHNlbC5vbmNoYW5nZSA9ICgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZGVzZGUnKS5vbmNoYW5nZSA9ICgpID0+IHtcclxuICAgIGxvYWRTZWdWaXNpdHMoKS50aGVuKCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCkpO1xyXG4gIH07XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1maGFzdGEnKS5vbmNoYW5nZSA9ICgpID0+IHtcclxuICAgIGxvYWRTZWdWaXNpdHMoKS50aGVuKCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCkpO1xyXG4gIH07XHJcbiAgY29uc3QgY2xpID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mY2xpZW50ZScpO1xyXG4gIGNsaS5vbmlucHV0ID0gZnVuY3Rpb24gKCkge1xyXG4gICAgaWYgKF9zZWdEZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQoX3NlZ0RlYm91bmNlVGltZXIpO1xyXG4gICAgX3NlZ0RlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCksIDMwMCk7XHJcbiAgfTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZlc3RhZG8nKS5vbmNoYW5nZSA9ICgpID0+IHJlbmRlclNlZ3VpbWllbnRvVGFiKCk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGxvYWRTZWdWaXNpdHMoKSB7XHJcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xyXG4gIGlmICghc2V0LnNpemUgfHwgIWZiRGIpIHtcclxuICAgIHNlZ1Zpc2l0c0NhY2hlID0gW107XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBsaXN0ID0gWy4uLnNldF07XHJcbiAgICAvLyBGaXJlc3RvcmUgSU4gbWF4IDEwIC0gYWNhIHRlbmVtb3MgMi00LCBPSy5cclxuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS53aGVyZSgndmVuZG9yJywgJ2luJywgbGlzdCkuZ2V0KCk7XHJcbiAgICBzZWdWaXNpdHNDYWNoZSA9IFtdO1xyXG4gICAgcXMuZm9yRWFjaCgoZCkgPT4gc2VnVmlzaXRzQ2FjaGUucHVzaChPYmplY3QuYXNzaWduKHsgaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW1NlZ3VpbWllbnRvXSBlcnJvciBjYXJnYW5kbyB2aXNpdGFzOicsIGUpO1xyXG4gICAgc2VnVmlzaXRzQ2FjaGUgPSBbXTtcclxuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ3Blcm1pc3Npb24tZGVuaWVkJykge1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnVHUgcm9sIG5vIHRpZW5lIHBlcm1pc29zIGVuIEZpcmVzdG9yZSBwYXJhIGxlZXIgbGFzIHZpc2l0YXMgZGVsIHNjb3BlLlxcblxcbkVsIGFkbWluIHRpZW5lIHF1ZSBhY3R1YWxpemFyIGxhcyBydWxlcyBwYXJhIHBlcm1pdGlyIGEgaW50ZXJuby9nZXJlbnRlIGxlZXIgdmlzaXRzIGRlIHN1cyBWREVzIGFzaWduYWRvcy4nXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhdHRhY2hTZWdOb3Rlc0xpc3RlbmVyKCkge1xyXG4gIGlmICh3aW5kb3cudW5zdWJTZWdOb3Rlcykge1xyXG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMoKTtcclxuICAgIHdpbmRvdy51bnN1YlNlZ05vdGVzID0gbnVsbDtcclxuICB9XHJcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xyXG4gIGlmICghc2V0LnNpemUgfHwgIWZiRGIpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgd2luZG93LnVuc3ViU2VnTm90ZXMgPSBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19ub3RlcycpXHJcbiAgICAgIC53aGVyZSgndmVuZG9yRXh0JywgJ2luJywgWy4uLnNldF0pXHJcbiAgICAgIC5vblNuYXBzaG90KFxyXG4gICAgICAgIChxcykgPT4ge1xyXG4gICAgICAgICAgc2VnTm90ZXNDYWNoZSA9IFtdO1xyXG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4gc2VnTm90ZXNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcclxuICAgICAgICAgIGlmIChjdXJyZW50U2VnVGltZWxpbmVLZXkpIG9wZW5TZWdUaW1lbGluZShjdXJyZW50U2VnVGltZWxpbmVLZXkpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIG5vdGVzIGxpc3RlbmVyJywgZXJyKVxyXG4gICAgICApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW1NlZ3VpbWllbnRvXSBub3RlcyBhdHRhY2gnLCBlKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGF0dGFjaFNlZ1N0YXR1c0xpc3RlbmVyKCkge1xyXG4gIGlmICh3aW5kb3cudW5zdWJTZWdTdGF0dXMpIHtcclxuICAgIHdpbmRvdy51bnN1YlNlZ1N0YXR1cygpO1xyXG4gICAgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gbnVsbDtcclxuICB9XHJcbiAgY29uc3Qgc2V0ID0gZ2V0U2VndWltaWVudG9FeHRlcm5hbFNldCgpO1xyXG4gIGlmICghc2V0LnNpemUgfHwgIWZiRGIpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgd2luZG93LnVuc3ViU2VnU3RhdHVzID0gZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignc2VndWltaWVudG9fc3RhdHVzJylcclxuICAgICAgLndoZXJlKCd2ZW5kb3JFeHQnLCAnaW4nLCBbLi4uc2V0XSlcclxuICAgICAgLm9uU25hcHNob3QoXHJcbiAgICAgICAgKHFzKSA9PiB7XHJcbiAgICAgICAgICBzZWdTdGF0dXNDYWNoZSA9IHt9O1xyXG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBkZCA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICAgICAgICBpZiAoZGQuY2xpZW50S2V5KSBzZWdTdGF0dXNDYWNoZVtkZC5jbGllbnRLZXldID0gZGQuc3RhdHVzIHx8ICcnO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdbU2VndWltaWVudG9dIHN0YXR1cyBsaXN0ZW5lcicsIGVycilcclxuICAgICAgKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tTZWd1aW1pZW50b10gc3RhdHVzIGF0dGFjaCcsIGUpO1xyXG4gIH1cclxufVxyXG5cclxud2luZG93LnNldFNlZ3VpbWllbnRvVGFiID0gZnVuY3Rpb24gKHRhYikge1xyXG4gIHNlZ0N1cnJlbnRUYWIgPSB0YWI7XHJcbiAgZG9jdW1lbnRcclxuICAgIC5xdWVyeVNlbGVjdG9yQWxsKCcuc2VnLXRhYicpXHJcbiAgICAuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCBiLmRhdGFzZXQuc2VnVGFiID09PSB0YWIpKTtcclxuICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gZ2V0U2VnRmlsdGVycygpIHtcclxuICByZXR1cm4ge1xyXG4gICAgdmVuZG9yOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZ2ZW5kb3InKS52YWx1ZSB8fCAnQUxMJyxcclxuICAgIGRlc2RlOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZkZXNkZScpLnZhbHVlIHx8ICcnLFxyXG4gICAgaGFzdGE6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctZmhhc3RhJykudmFsdWUgfHwgJycsXHJcbiAgICBjbGllbnRlOiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mY2xpZW50ZScpLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSxcclxuICAgIGVzdGFkbzogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1mZXN0YWRvJykudmFsdWUgfHwgJ0FMTCcsXHJcbiAgICBzb2xvUGVuZDogISFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWZwZW5kJykuY2hlY2tlZCxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTZWdEYXRhc2V0KCkge1xyXG4gIGNvbnN0IHNldCA9IGdldFNlZ3VpbWllbnRvRXh0ZXJuYWxTZXQoKTtcclxuICBjb25zdCBmID0gZ2V0U2VnRmlsdGVycygpO1xyXG4gIGNvbnN0IGluU2NvcGUgPSAodikgPT4gc2V0Lmhhcyh2KTtcclxuICBjb25zdCBpbkRhdGUgPSAoZCkgPT4ge1xyXG4gICAgaWYgKCFkKSByZXR1cm4gdHJ1ZTsgLy8gdG9sZXJhciByZWdpc3Ryb3Mgc2luIGZlY2hhXHJcbiAgICBpZiAoZi5kZXNkZSAmJiBkIDwgZi5kZXNkZSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKGYuaGFzdGEgJiYgZCA+IGYuaGFzdGEpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH07XHJcbiAgY29uc3QgbWF0Y2hWZW5kb3IgPSAodikgPT4gKGYudmVuZG9yID09PSAnQUxMJyA/IHRydWUgOiB2ID09PSBmLnZlbmRvcik7XHJcbiAgY29uc3QgbWF0Y2hDbGllbnRlID0gKG5hbWUpID0+XHJcbiAgICBmLmNsaWVudGUgPyAobmFtZSB8fCAnJykudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhmLmNsaWVudGUpIDogdHJ1ZTtcclxuICBjb25zdCB2aXNpdHMgPSAoc2VnVmlzaXRzQ2FjaGUgfHwgW10pLmZpbHRlcigodikgPT4ge1xyXG4gICAgaWYgKCFpblNjb3BlKHYudmVuZG9yKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKCFtYXRjaFZlbmRvcih2LnZlbmRvcikpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICghaW5EYXRlKCh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCkpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIW1hdGNoQ2xpZW50ZSh2LnRpZW5kYSkpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHBlZGlkb3MgPSAoZ2xvYmFsUGVkaWRvcyB8fCBbXSlcclxuICAgIC5tYXAoKHApID0+IE9iamVjdC5hc3NpZ24oe30sIHAsIHsgdmVuZG9yOiBzZWdQZWRpZG9WZW5kb3IocCkgfSkpXHJcbiAgICAuZmlsdGVyKChwKSA9PiB7XHJcbiAgICAgIGlmICghaW5TY29wZShwLnZlbmRvcikpIHJldHVybiBmYWxzZTtcclxuICAgICAgaWYgKCFtYXRjaFZlbmRvcihwLnZlbmRvcikpIHJldHVybiBmYWxzZTtcclxuICAgICAgY29uc3QgZHQgPSAocC5jb25maXJtZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmZpbmFsaXplZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XHJcbiAgICAgIGlmICghaW5EYXRlKGR0KSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICBpZiAoIW1hdGNoQ2xpZW50ZShwLmNsaWVudE5hbWUpKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSk7XHJcbiAgcmV0dXJuIHsgdmlzaXRzLCBwZWRpZG9zIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkU2VnQWdncmVnYXRlcyh2aXNpdHMsIHBlZGlkb3MpIHtcclxuICBjb25zdCBzZXQgPSBnZXRTZWd1aW1pZW50b0V4dGVybmFsU2V0KCk7XHJcbiAgY29uc3QgYnlWZW5kb3IgPSB7fTtcclxuICBzZXQuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgYnlWZW5kb3Jbdl0gPSB7XHJcbiAgICAgIHZpc2l0czogMCwgLy8gc29sbyBwcmVzZW5jaWFsZXMgKGludGVyYWN0aW9uVHlwZSAhPSAnY29udGFjdG8nKVxyXG4gICAgICBjb250YWN0b3M6IDAsIC8vIHY0NDM6IG5vIHByZXNlbmNpYWxlcyAoV2hhdHNBcHAvdGVsL2VtYWlsKVxyXG4gICAgICBwZWRpZG9zOiAwLFxyXG4gICAgICBmYWN0dXJhY2lvbjogMCxcclxuICAgICAgcGVuZGllbnRlc1BlZGlkb3M6IDAsXHJcbiAgICAgIGxhc3RBY3Rpdml0eTogJycsXHJcbiAgICAgIGNsaWVudHNBY3RpdmU6IG5ldyBTZXQoKSxcclxuICAgICAgY2xpZW50c1Zpc2l0ZWQ6IG5ldyBTZXQoKSxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IGIgPSBieVZlbmRvclt2LnZlbmRvcl07XHJcbiAgICBpZiAoIWIpIHJldHVybjtcclxuICAgIGlmIChpc0NvbnRhY3RvKHYpKSBiLmNvbnRhY3RvcysrO1xyXG4gICAgZWxzZSBiLnZpc2l0cysrO1xyXG4gICAgaWYgKHYudGllbmRhKSBiLmNsaWVudHNWaXNpdGVkLmFkZCh2LnRpZW5kYSArICd8JyArICh2LmxvY2FsaWRhZCB8fCAnJykpO1xyXG4gICAgY29uc3QgZCA9ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZCAmJiBkID4gYi5sYXN0QWN0aXZpdHkpIGIubGFzdEFjdGl2aXR5ID0gZDtcclxuICB9KTtcclxuICBwZWRpZG9zLmZvckVhY2goKHApID0+IHtcclxuICAgIGNvbnN0IGIgPSBieVZlbmRvcltwLnZlbmRvcl07XHJcbiAgICBpZiAoIWIpIHJldHVybjtcclxuICAgIGIucGVkaWRvcysrO1xyXG4gICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyAhPSBudWxsID8gcC5zdWJ0b3RhbEFycyA6IDA7XHJcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIGIuZmFjdHVyYWNpb24gKz0gK2FtdCB8fCAwO1xyXG4gICAgaWYgKHAuc3RhZ2UgPT09ICdwZW5kaW5nJykgYi5wZW5kaWVudGVzUGVkaWRvcysrO1xyXG4gICAgaWYgKHAuY2xpZW50TmFtZSkgYi5jbGllbnRzQWN0aXZlLmFkZChwLmNsaWVudE5hbWUgKyAnfCcgKyAocC5sb2NOYW1lIHx8ICcnKSk7XHJcbiAgICBjb25zdCBkID0gKHAuY29uZmlybWVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKSB8fCAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xyXG4gICAgaWYgKGQgJiYgZCA+IGIubGFzdEFjdGl2aXR5KSBiLmxhc3RBY3Rpdml0eSA9IGQ7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGJ5VmVuZG9yO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzZWdNYWtlS2V5KHZlbmRvciwgcHJvdiwgbG9jLCBuYW1lKSB7XHJcbiAgcmV0dXJuIFt2ZW5kb3IgfHwgJycsIHByb3YgfHwgJycsIGxvYyB8fCAnJywgbmFtZSB8fCAnJ10uam9pbignfCcpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZXRlY3RTZWdQZW5kaWVudGVzKHZpc2l0cywgcGVkaWRvcykge1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgY29uc3QgYnlDbGllbnQgPSB7fTtcclxuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgaWYgKCFieUNsaWVudFtrXSlcclxuICAgICAgYnlDbGllbnRba10gPSB7XHJcbiAgICAgICAgdmVuZG9yOiB2LnZlbmRvcixcclxuICAgICAgICBwcm92OiB2LnByb3ZpbmNpYSxcclxuICAgICAgICBsb2M6IHYubG9jYWxpZGFkLFxyXG4gICAgICAgIG5hbWU6IHYudGllbmRhLFxyXG4gICAgICAgIHZpc2l0czogW10sXHJcbiAgICAgICAgb3JkZXJzOiBbXSxcclxuICAgICAgfTtcclxuICAgIGJ5Q2xpZW50W2tdLnZpc2l0cy5wdXNoKHYpO1xyXG4gIH0pO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkocC52ZW5kb3IsIHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKTtcclxuICAgIGlmICghYnlDbGllbnRba10pXHJcbiAgICAgIGJ5Q2xpZW50W2tdID0ge1xyXG4gICAgICAgIHZlbmRvcjogcC52ZW5kb3IsXHJcbiAgICAgICAgcHJvdjogcC5wcm92aW5jZSxcclxuICAgICAgICBsb2M6IHAubG9jTmFtZSxcclxuICAgICAgICBuYW1lOiBwLmNsaWVudE5hbWUsXHJcbiAgICAgICAgdmlzaXRzOiBbXSxcclxuICAgICAgICBvcmRlcnM6IFtdLFxyXG4gICAgICB9O1xyXG4gICAgYnlDbGllbnRba10ub3JkZXJzLnB1c2gocCk7XHJcbiAgfSk7XHJcbiAgT2JqZWN0LmVudHJpZXMoYnlDbGllbnQpLmZvckVhY2goKFtrLCBjXSkgPT4ge1xyXG4gICAgaWYgKCFjLnZpc2l0cy5sZW5ndGgpIHJldHVybjtcclxuICAgIGNvbnN0IGhhc0NvbmZpcm1lZCA9IGMub3JkZXJzLnNvbWUoKG8pID0+IG8uc3RhZ2UgPT09ICdjb25maXJtZWQnKTtcclxuICAgIGlmIChoYXNDb25maXJtZWQpIHJldHVybjtcclxuICAgIC8vIEVsIHVzdWFyaW8gbWFyY28gZWwgY2FzbyBjb21vICdyZXN1ZWx0bycgZGVzZGUgZWwgdGltZWxpbmUgbyBlbFxyXG4gICAgLy8gYm90b24gWCBkZSBwZW5kaWVudGVzIC0+IG5vIHZvbHZlbW9zIGEgbGlzdGFybG8uXHJcbiAgICBpZiAoc2VnU3RhdHVzQ2FjaGVba10gPT09ICdyZXN1ZWx0bycpIHJldHVybjtcclxuICAgIGNvbnN0IGxhdGVzdFYgPSBjLnZpc2l0c1xyXG4gICAgICAubWFwKCh2KSA9PiB2LmZlY2hhIHx8ICcnKVxyXG4gICAgICAuc29ydCgpXHJcbiAgICAgIC5wb3AoKTtcclxuICAgIGNvbnN0IGRheXNBZ28gPSBsYXRlc3RWID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGxhdGVzdFYpLmdldFRpbWUoKSkgLyA4NjQwMDAwMCkgOiAwO1xyXG4gICAgaWYgKGRheXNBZ28gPj0gNykge1xyXG4gICAgICBpdGVtcy5wdXNoKHtcclxuICAgICAgICBraW5kOiAndmlzaXQtbm8tb3JkZXInLFxyXG4gICAgICAgIGNsaWVudEtleTogayxcclxuICAgICAgICBjbGllbnQ6IGMubmFtZSxcclxuICAgICAgICB2ZW5kb3I6IGMudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IGMucHJvdixcclxuICAgICAgICBsb2M6IGMubG9jLFxyXG4gICAgICAgIHByb2JsZW1hOiAnVmlzaXRhZG8gc2luIHBlZGlkbyBoYWNlICcgKyBkYXlzQWdvICsgJyBkaWFzJyxcclxuICAgICAgICBhY2Npb246ICdDb250YWN0YXIgeSBvZnJlY2VyIGNpZXJyZScsXHJcbiAgICAgICAgdWx0aW1hQWNjaW9uOiAnVmlzaXRhOiAnICsgbGF0ZXN0VixcclxuICAgICAgICBzdGF0dXM6IGRheXNBZ28gPiAxNCA/ICdyZWQnIDogJ3llbGxvdycsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH0pO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgaWYgKHAuc3RhZ2UgIT09ICdwZW5kaW5nJykgcmV0dXJuO1xyXG4gICAgY29uc3QgZHQgPSAocC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCkgfHwgJyc7XHJcbiAgICBjb25zdCBkYXlzQWdvID0gZHQgPyBNYXRoLmZsb29yKChEYXRlLm5vdygpIC0gbmV3IERhdGUoZHQpLmdldFRpbWUoKSkgLyA4NjQwMDAwMCkgOiAwO1xyXG4gICAgaXRlbXMucHVzaCh7XHJcbiAgICAgIGtpbmQ6ICdwZWRpZG8tcGVuZGluZycsXHJcbiAgICAgIHBlZGlkb0ZzSWQ6IHAuX2ZzSWQgfHwgJycsXHJcbiAgICAgIGNsaWVudEtleTogc2VnTWFrZUtleShwLnZlbmRvciwgcC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpLFxyXG4gICAgICBjbGllbnQ6IHAuY2xpZW50TmFtZSxcclxuICAgICAgdmVuZG9yOiBwLnZlbmRvcixcclxuICAgICAgcHJvdjogcC5wcm92aW5jZSxcclxuICAgICAgbG9jOiBwLmxvY05hbWUsXHJcbiAgICAgIHByb2JsZW1hOiAnUGVkaWRvIHBlbmRpZW50ZSBkZSBjb25maXJtYXInICsgKGRheXNBZ28gPyAnIGhhY2UgJyArIGRheXNBZ28gKyAnIGRpYXMnIDogJycpLFxyXG4gICAgICBhY2Npb246ICdSZXZpc2FyIHN0b2NrIHkgbGxhbWFyIGFsIGNsaWVudGUnLFxyXG4gICAgICB1bHRpbWFBY2Npb246ICdQZWRpZG86ICcgKyAoZHQgfHwgJyhzL2YpJyksXHJcbiAgICAgIHN0YXR1czogZGF5c0FnbyA+PSA1ID8gJ3JlZCcgOiAneWVsbG93JyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIHJldHVybiBpdGVtcztcclxufVxyXG5cclxuZnVuY3Rpb24gZGV0ZWN0U2VnU2luTW92aW1pZW50byh2aXNpdHMsIHBlZGlkb3MpIHtcclxuICBjb25zdCBtYXAgPSB7fTtcclxuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpO1xyXG4gICAgaWYgKCFtYXBba10pXHJcbiAgICAgIG1hcFtrXSA9IHtcclxuICAgICAgICB2ZW5kb3I6IHYudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IHYucHJvdmluY2lhLFxyXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXHJcbiAgICAgICAgbmFtZTogdi50aWVuZGEsXHJcbiAgICAgICAgbGFzdFY6ICcnLFxyXG4gICAgICAgIGxhc3RPOiAnJyxcclxuICAgICAgICBmYWN0dXJhY2lvbjogMCxcclxuICAgICAgfTtcclxuICAgIGlmICgodi5mZWNoYSB8fCAnJykgPiBtYXBba10ubGFzdFYpIG1hcFtrXS5sYXN0ViA9IHYuZmVjaGE7XHJcbiAgfSk7XHJcbiAgcGVkaWRvcy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCBrID0gc2VnTWFrZUtleShwLnZlbmRvciwgcC5wcm92aW5jZSwgcC5sb2NOYW1lLCBwLmNsaWVudE5hbWUpO1xyXG4gICAgaWYgKCFtYXBba10pXHJcbiAgICAgIG1hcFtrXSA9IHtcclxuICAgICAgICB2ZW5kb3I6IHAudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IHAucHJvdmluY2UsXHJcbiAgICAgICAgbG9jOiBwLmxvY05hbWUsXHJcbiAgICAgICAgbmFtZTogcC5jbGllbnROYW1lLFxyXG4gICAgICAgIGxhc3RWOiAnJyxcclxuICAgICAgICBsYXN0TzogJycsXHJcbiAgICAgICAgZmFjdHVyYWNpb246IDAsXHJcbiAgICAgIH07XHJcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgJiYgZHQgPiBtYXBba10ubGFzdE8pIG1hcFtrXS5sYXN0TyA9IGR0O1xyXG4gICAgaWYgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnKSB7XHJcbiAgICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcclxuICAgICAgbWFwW2tdLmZhY3R1cmFjaW9uICs9ICthbXQgfHwgMDtcclxuICAgIH1cclxuICB9KTtcclxuICBjb25zdCBvdXQgPSBbXTtcclxuICBPYmplY3QuZW50cmllcyhtYXApLmZvckVhY2goKFtrLCBjXSkgPT4ge1xyXG4gICAgY29uc3QgbGFzdFZkYXlzID0gYy5sYXN0VlxyXG4gICAgICA/IE1hdGguZmxvb3IoKERhdGUubm93KCkgLSBuZXcgRGF0ZShjLmxhc3RWKS5nZXRUaW1lKCkpIC8gODY0MDAwMDApXHJcbiAgICAgIDogSW5maW5pdHk7XHJcbiAgICBjb25zdCBsYXN0T2RheXMgPSBjLmxhc3RPXHJcbiAgICAgID8gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGMubGFzdE8pLmdldFRpbWUoKSkgLyA4NjQwMDAwMClcclxuICAgICAgOiBJbmZpbml0eTtcclxuICAgIGlmIChsYXN0VmRheXMgPiAzMCAmJiBsYXN0T2RheXMgPiA0NSkge1xyXG4gICAgICBjb25zdCBsYXN0RGF5cyA9IE1hdGgubWluKGxhc3RWZGF5cywgbGFzdE9kYXlzKTtcclxuICAgICAgb3V0LnB1c2goe1xyXG4gICAgICAgIGNsaWVudEtleTogayxcclxuICAgICAgICBjbGllbnQ6IGMubmFtZSxcclxuICAgICAgICB2ZW5kb3I6IGMudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IGMucHJvdixcclxuICAgICAgICBsb2M6IGMubG9jLFxyXG4gICAgICAgIGxhc3RWaXNpdDogYy5sYXN0ViB8fCAnLScsXHJcbiAgICAgICAgbGFzdE9yZGVyOiBjLmxhc3RPIHx8ICctJyxcclxuICAgICAgICBkYXlzQWdvOiBOdW1iZXIuaXNGaW5pdGUobGFzdERheXMpID8gbGFzdERheXMgOiAnOTk5KycsXHJcbiAgICAgICAgZmFjdHVyYWNpb246IGMuZmFjdHVyYWNpb24sXHJcbiAgICAgICAgYWNjaW9uOlxyXG4gICAgICAgICAgYy5mYWN0dXJhY2lvbiA+IDBcclxuICAgICAgICAgICAgPyAnUmVjb250YWN0YXIgLSBjbGllbnRlIGNvbiBoaXN0b3JpYWwnXHJcbiAgICAgICAgICAgIDogJ1JlY29udGFjdGFyIC0gcHVlZGUgc2VyIG9wb3J0dW5pZGFkJyxcclxuICAgICAgICBzdGF0dXM6IGMuZmFjdHVyYWNpb24gPiAxMDAwMDAgJiYgbGFzdERheXMgPiA2MCA/ICdyZWQnIDogJ3llbGxvdycsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH0pO1xyXG4gIHJldHVybiBvdXQuc29ydCgoYSwgYikgPT4gKGIuZmFjdHVyYWNpb24gfHwgMCkgLSAoYS5mYWN0dXJhY2lvbiB8fCAwKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRldGVjdFNlZ09wb3J0dW5pZGFkZXModmlzaXRzLCBfcGVkaWRvcykge1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgY29uc3Qga2V5cyA9IFtcclxuICAgICdpbnRlcmVzYWQnLFxyXG4gICAgJ3BvdGVuY2lhbCcsXHJcbiAgICAnY2llcnJlJyxcclxuICAgICdyZXBvc2ljaScsXHJcbiAgICAnb2ZlcnRhJyxcclxuICAgICdkZXNjdWVudG8nLFxyXG4gICAgJ3ZvbHZlcicsXHJcbiAgICAnY290aXonLFxyXG4gIF07XHJcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHR4dCA9ICgodi5jb21lbnRhcmlvIHx8ICcnKSArICcgJyArICh2Lm9ic2VydmFjaW9uZXMgfHwgJycpKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgaWYgKGtleXMuc29tZSgoa3cpID0+IHR4dC5pbmNsdWRlcyhrdykpKSB7XHJcbiAgICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICAgIGNsaWVudEtleTogc2VnTWFrZUtleSh2LnZlbmRvciwgdi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSksXHJcbiAgICAgICAgY2xpZW50OiB2LnRpZW5kYSxcclxuICAgICAgICB2ZW5kb3I6IHYudmVuZG9yLFxyXG4gICAgICAgIHByb3Y6IHYucHJvdmluY2lhLFxyXG4gICAgICAgIGxvYzogdi5sb2NhbGlkYWQsXHJcbiAgICAgICAgcHJvYmxlbWE6XHJcbiAgICAgICAgICAnQ29tZW50YXJpbyBjb21lcmNpYWw6IFwiJyArICh2LmNvbWVudGFyaW8gfHwgdi5vYnNlcnZhY2lvbmVzIHx8ICcnKS5zbGljZSgwLCA4MCkgKyAnXCInLFxyXG4gICAgICAgIGFjY2lvbjogJ0Nvb3JkaW5hciBjaWVycmUgY29uIGVsIFZERScsXHJcbiAgICAgICAgdWx0aW1hQWNjaW9uOiAnVmlzaXRhOiAnICsgKHYuZmVjaGEgfHwgJy0nKSxcclxuICAgICAgICBzdGF0dXM6ICd5ZWxsb3cnLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9KTtcclxuICByZXR1cm4gaXRlbXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkU2VnRHVwbGFzKHZpc2l0cywgcGVkaWRvcykge1xyXG4gIGNvbnN0IGV4dGVybmFsVG9JbnRlcm5hbCA9IHt9O1xyXG4gIE9iamVjdC5lbnRyaWVzKFZFTkRPUl9JTkNMVURFU19PVEhFUlMpLmZvckVhY2goKFtpbnRlcm5vLCBleHRdKSA9PlxyXG4gICAgZXh0LmZvckVhY2goKGUpID0+IChleHRlcm5hbFRvSW50ZXJuYWxbZV0gPSBpbnRlcm5vKSlcclxuICApO1xyXG4gIGNvbnN0IGR1cGxhcyA9IHt9O1xyXG4gIGNvbnN0IGVuc3VyZSA9IChpbnRlcm5vLCBleHRlcm5vKSA9PiB7XHJcbiAgICBjb25zdCBrID0gaW50ZXJubyArICcgKyAnICsgZXh0ZXJubztcclxuICAgIGlmICghZHVwbGFzW2tdKVxyXG4gICAgICBkdXBsYXNba10gPSB7XHJcbiAgICAgICAgaW50ZXJubyxcclxuICAgICAgICBleHRlcm5vLFxyXG4gICAgICAgIHZpc2l0YXM6IDAsXHJcbiAgICAgICAgcGVkaWRvczogMCxcclxuICAgICAgICBwZWRpZG9zQ29uZjogMCxcclxuICAgICAgICBmYWN0OiAwLFxyXG4gICAgICAgIGNsaWVudGVzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgcGVuZGllbnRlczogMCxcclxuICAgICAgICBsYXN0QWN0OiAnJyxcclxuICAgICAgfTtcclxuICAgIHJldHVybiBkdXBsYXNba107XHJcbiAgfTtcclxuICB2aXNpdHMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgaW50ZXJubyA9IGV4dGVybmFsVG9JbnRlcm5hbFt2LnZlbmRvcl07XHJcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcclxuICAgIGNvbnN0IGQgPSBlbnN1cmUoaW50ZXJubywgdi52ZW5kb3IpO1xyXG4gICAgZC52aXNpdGFzKys7XHJcbiAgICBpZiAodi50aWVuZGEpIGQuY2xpZW50ZXMuYWRkKHYudGllbmRhICsgJ3wnICsgKHYubG9jYWxpZGFkIHx8ICcnKSk7XHJcbiAgICBjb25zdCBkdCA9ICh2LmZlY2hhIHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZHQgPiBkLmxhc3RBY3QpIGQubGFzdEFjdCA9IGR0O1xyXG4gIH0pO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgaW50ZXJubyA9IGV4dGVybmFsVG9JbnRlcm5hbFtwLnZlbmRvcl07XHJcbiAgICBpZiAoIWludGVybm8pIHJldHVybjtcclxuICAgIGNvbnN0IGQgPSBlbnN1cmUoaW50ZXJubywgcC52ZW5kb3IpO1xyXG4gICAgZC5wZWRpZG9zKys7XHJcbiAgICBpZiAocC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcpIHtcclxuICAgICAgZC5wZWRpZG9zQ29uZisrO1xyXG4gICAgICBjb25zdCBhbXQgPSBwLm5ldEFtb3VudEFycyAhPSBudWxsID8gcC5uZXRBbW91bnRBcnMgOiBwLnN1YnRvdGFsQXJzIHx8IDA7XHJcbiAgICAgIGQuZmFjdCArPSArYW10IHx8IDA7XHJcbiAgICB9IGVsc2UgaWYgKHAuc3RhZ2UgPT09ICdwZW5kaW5nJykgZC5wZW5kaWVudGVzKys7XHJcbiAgICBpZiAocC5jbGllbnROYW1lKSBkLmNsaWVudGVzLmFkZChwLmNsaWVudE5hbWUgKyAnfCcgKyAocC5sb2NOYW1lIHx8ICcnKSk7XHJcbiAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZHQgPiBkLmxhc3RBY3QpIGQubGFzdEFjdCA9IGR0O1xyXG4gIH0pO1xyXG4gIHJldHVybiBkdXBsYXM7XHJcbn1cclxuXHJcbndpbmRvdy5yZW5kZXJTZWd1aW1pZW50b1RhYiA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSB7XHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvbnRlbnQnKS5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cInNlZy1lbXB0eVwiPlNpbiBwZXJtaXNvcy48L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCB7IHZpc2l0cywgcGVkaWRvcyB9ID0gZ2V0U2VnRGF0YXNldCgpO1xyXG4gIHJlbmRlclNlZ1RvcFN0YXRzKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgY29uc3QgcGVuZGllbnRlcyA9IGRldGVjdFNlZ1BlbmRpZW50ZXModmlzaXRzLCBwZWRpZG9zKTtcclxuICBjb25zdCBkZWFkID0gZGV0ZWN0U2VnU2luTW92aW1pZW50byh2aXNpdHMsIHBlZGlkb3MpO1xyXG4gIGNvbnN0IG9wcHMgPSBkZXRlY3RTZWdPcG9ydHVuaWRhZGVzKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC12aXNpdGFzJykudGV4dENvbnRlbnQgPSB2aXNpdHMubGVuZ3RoO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY291bnQtcGVkaWRvcycpLnRleHRDb250ZW50ID0gcGVkaWRvcy5sZW5ndGg7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb3VudC1wZW5kaWVudGVzJykudGV4dENvbnRlbnQgPSBwZW5kaWVudGVzLmxlbmd0aDtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLWNvdW50LWRlYWQnKS50ZXh0Q29udGVudCA9IGRlYWQubGVuZ3RoO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctY291bnQtb3BwJykudGV4dENvbnRlbnQgPSBvcHBzLmxlbmd0aDtcclxuICBjb25zdCB0YWIgPSBzZWdDdXJyZW50VGFiIHx8ICdyZXN1bWVuJztcclxuICBjb25zdCBmID0gZ2V0U2VnRmlsdGVycygpO1xyXG4gIGNvbnN0IGZpbHRlckJ5RXN0YWRvID0gKGFycikgPT5cclxuICAgIGYuZXN0YWRvID09PSAnQUxMJyA/IGFyciA6IGFyci5maWx0ZXIoKHgpID0+IHguc3RhdHVzID09PSBmLmVzdGFkbyk7XHJcbiAgbGV0IGh0bWwgPSAnJztcclxuICBpZiAodGFiID09PSAncmVzdW1lbicpIGh0bWwgPSByZW5kZXJTZWdSZXN1bWVuKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgZWxzZSBpZiAodGFiID09PSAndmlzaXRhcycpIHtcclxuICAgIGxldCByb3dzID0gdmlzaXRzLnNsaWNlKCk7XHJcbiAgICBpZiAoZi5zb2xvUGVuZCkge1xyXG4gICAgICBjb25zdCBwZW5kU2V0ID0gbmV3IFNldChwZW5kaWVudGVzLm1hcCgocCkgPT4gcC5jbGllbnRLZXkpKTtcclxuICAgICAgcm93cyA9IHJvd3MuZmlsdGVyKCh2KSA9PlxyXG4gICAgICAgIHBlbmRTZXQuaGFzKHNlZ01ha2VLZXkodi52ZW5kb3IsIHYucHJvdmluY2lhLCB2LmxvY2FsaWRhZCwgdi50aWVuZGEpKVxyXG4gICAgICApO1xyXG4gICAgfVxyXG4gICAgaHRtbCA9IHJlbmRlclNlZ1Zpc2l0YXMocm93cyk7XHJcbiAgfSBlbHNlIGlmICh0YWIgPT09ICdwZWRpZG9zJykge1xyXG4gICAgbGV0IHJvd3MgPSBwZWRpZG9zLnNsaWNlKCk7XHJcbiAgICBpZiAoZi5zb2xvUGVuZCkgcm93cyA9IHJvd3MuZmlsdGVyKChwKSA9PiBwLnN0YWdlID09PSAncGVuZGluZycpO1xyXG4gICAgaHRtbCA9IHJlbmRlclNlZ1BlZGlkb3Mocm93cyk7XHJcbiAgfSBlbHNlIGlmICh0YWIgPT09ICdwZW5kaWVudGVzJykgaHRtbCA9IHJlbmRlclNlZ1BlbmRpZW50ZXMoZmlsdGVyQnlFc3RhZG8ocGVuZGllbnRlcykpO1xyXG4gIGVsc2UgaWYgKHRhYiA9PT0gJ2RlYWQnKSBodG1sID0gcmVuZGVyU2VnRGVhZChmaWx0ZXJCeUVzdGFkbyhkZWFkKSk7XHJcbiAgZWxzZSBpZiAodGFiID09PSAnb3BwJykgaHRtbCA9IHJlbmRlclNlZ09wcHMoZmlsdGVyQnlFc3RhZG8ob3BwcykpO1xyXG4gIGVsc2UgaWYgKHRhYiA9PT0gJ2R1cGxhcycpIGh0bWwgPSByZW5kZXJTZWdEdXBsYXMoYnVpbGRTZWdEdXBsYXModmlzaXRzLCBwZWRpZG9zKSk7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1jb250ZW50JykuaW5uZXJIVE1MID0gaHRtbDtcclxufTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNlZ1RvcFN0YXRzKHZpc2l0cywgcGVkaWRvcykge1xyXG4gIGxldCBmYWN0ID0gMCxcclxuICAgIGNvbmYgPSAwLFxyXG4gICAgX3BlbmQgPSAwLFxyXG4gICAgbGFzdEFjdCA9ICcnO1xyXG4gIHBlZGlkb3MuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgaWYgKHAuc3RhZ2UgPT09ICdjb25maXJtZWQnKSB7XHJcbiAgICAgIGNvbmYrKztcclxuICAgICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyB8fCAwO1xyXG4gICAgICBmYWN0ICs9ICthbXQgfHwgMDtcclxuICAgIH0gZWxzZSBpZiAocC5zdGFnZSA9PT0gJ3BlbmRpbmcnKSBfcGVuZCsrO1xyXG4gICAgY29uc3QgZHQgPSAocC5jb25maXJtZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApIHx8IChwLmZpbmFsaXplZEF0IHx8ICcnKS5zbGljZSgwLCAxMCk7XHJcbiAgICBpZiAoZHQgPiBsYXN0QWN0KSBsYXN0QWN0ID0gZHQ7XHJcbiAgfSk7XHJcbiAgdmlzaXRzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IGQgPSAodi5mZWNoYSB8fCAnJykuc2xpY2UoMCwgMTApO1xyXG4gICAgaWYgKGQgPiBsYXN0QWN0KSBsYXN0QWN0ID0gZDtcclxuICB9KTtcclxuICBjb25zdCBwZW5kaWVudGVzID0gZGV0ZWN0U2VnUGVuZGllbnRlcyh2aXNpdHMsIHBlZGlkb3MpO1xyXG4gIGNvbnN0IGRlYWQgPSBkZXRlY3RTZWdTaW5Nb3ZpbWllbnRvKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgY29uc3Qgb3BwcyA9IGRldGVjdFNlZ09wb3J0dW5pZGFkZXModmlzaXRzLCBwZWRpZG9zKTtcclxuICAvLyB2NDQzOiBzZXBhcmFyIHZpc2l0YXMgcHJlc2VuY2lhbGVzIGRlIGNvbnRhY3RvcyBubyBwcmVzZW5jaWFsZXMuXHJcbiAgY29uc3QgdmlzaXRhc1ByZXMgPSB2aXNpdHMuZmlsdGVyKCh2KSA9PiAhaXNDb250YWN0byh2KSkubGVuZ3RoO1xyXG4gIGNvbnN0IGNvbnRhY3RvcyA9IHZpc2l0cy5maWx0ZXIoaXNDb250YWN0bykubGVuZ3RoO1xyXG4gIGNvbnN0IGNvbnYgPSB2aXNpdHMubGVuZ3RoID4gMCA/IE1hdGgucm91bmQoKGNvbmYgLyB2aXNpdHMubGVuZ3RoKSAqIDEwMCkgOiAwO1xyXG4gIGNvbnN0IGZtdE1vbiA9IChuKSA9PiAnJCcgKyBNYXRoLnJvdW5kKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xyXG4gIGNvbnN0IGh0bWwgPVxyXG4gICAgJycgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCB2aXNpdGFzXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xyXG4gICAgdmlzaXRhc1ByZXMgK1xyXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5WaXNpdGFzPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGNvbnRhY3Rvc1wiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIGNvbnRhY3RvcyArXHJcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPkNvbnRhY3RvczwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBwZWRpZG9zXCI+PGRpdiBjbGFzcz1cIm51bVwiPicgK1xyXG4gICAgcGVkaWRvcy5sZW5ndGggK1xyXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5QZWRpZG9zPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1zdGF0IGZhY3RcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXHJcbiAgICBmbXRNb24oZmFjdCkgK1xyXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJsYmxcIj5GYWN0dXJhZG88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgcGVuZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIHBlbmRpZW50ZXMubGVuZ3RoICtcclxuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+UGVuZGllbnRlczwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdCBvcHBcIj48ZGl2IGNsYXNzPVwibnVtXCI+JyArXHJcbiAgICBvcHBzLmxlbmd0aCArXHJcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImxibFwiPk9wb3J0dW5pZGFkZXM8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgZGVhZFwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIGRlYWQubGVuZ3RoICtcclxuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+U2luIG1vdmltaWVudG88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXN0YXQgY29udlwiPjxkaXYgY2xhc3M9XCJudW1cIj4nICtcclxuICAgIGNvbnYgK1xyXG4gICAgJyU8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+Q29udiB2JnJhcnI7cDwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgY2xhc3M9XCJzZWctc3RhdFwiPjxkaXYgY2xhc3M9XCJudW1cIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4XCI+JyArXHJcbiAgICAobGFzdEFjdCB8fCAnLScpICtcclxuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwibGJsXCI+VWx0aW1hIGFjdGl2aWRhZDwvZGl2PjwvZGl2Pic7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1zdGF0cycpLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNlZ1Jlc3VtZW4odmlzaXRzLCBwZWRpZG9zKSB7XHJcbiAgY29uc3QgYWdnID0gYnVpbGRTZWdBZ2dyZWdhdGVzKHZpc2l0cywgcGVkaWRvcyk7XHJcbiAgbGV0IGh0bWwgPSAnJztcclxuICBPYmplY3QuZW50cmllcyhhZ2cpXHJcbiAgICAuc29ydCgpXHJcbiAgICAuZm9yRWFjaCgoW3ZlbmRvciwgYl0pID0+IHtcclxuICAgICAgY29uc3QgY29udiA9IGIudmlzaXRzID8gTWF0aC5yb3VuZCgoYi5wZWRpZG9zIC8gYi52aXNpdHMpICogMTAwKSA6IDA7XHJcbiAgICAgIGNvbnN0IGxhc3REYXlzID0gYi5sYXN0QWN0aXZpdHlcclxuICAgICAgICA/IE1hdGguZmxvb3IoKERhdGUubm93KCkgLSBuZXcgRGF0ZShiLmxhc3RBY3Rpdml0eSkuZ2V0VGltZSgpKSAvIDg2NDAwMDAwKVxyXG4gICAgICAgIDogSW5maW5pdHk7XHJcbiAgICAgIGNvbnN0IGNhcmRDbHMgPSBsYXN0RGF5cyA+IDcgPyAneWVsbG93JyA6IGxhc3REYXlzID4gMTUgPyAncmVkJyA6ICcnO1xyXG4gICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXZlbmRvci1jYXJkICcgKyBjYXJkQ2xzICsgJ1wiPic7XHJcbiAgICAgIGh0bWwgKz0gJzxoND4nICsgZXNjYXBlSHRtbChkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpKSArICc8L2g0Pic7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnPGRpdiBjbGFzcz1cInZtZXRyaWNzXCI+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xyXG4gICAgICAgIGIudmlzaXRzICtcclxuICAgICAgICAnPC9iPlZpc2l0YXM8L2Rpdj4nICtcclxuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgICAgYi5jb250YWN0b3MgK1xyXG4gICAgICAgICc8L2I+Q29udGFjdG9zPC9kaXY+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xyXG4gICAgICAgIGIucGVkaWRvcyArXHJcbiAgICAgICAgJzwvYj5QZWRpZG9zPC9kaXY+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPiQnICtcclxuICAgICAgICBNYXRoLnJvdW5kKGIuZmFjdHVyYWNpb24pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgICAnPC9iPkZhY3R1cmFjaW9uPC9kaXY+JyArXHJcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xyXG4gICAgICAgIGIuY2xpZW50c0FjdGl2ZS5zaXplICtcclxuICAgICAgICAnPC9iPkNsaWVudGVzIGFjdGl2b3M8L2Rpdj4nICtcclxuICAgICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgICAgYi5jbGllbnRzVmlzaXRlZC5zaXplICtcclxuICAgICAgICAnPC9iPkNsaWVudGVzIHZpc2l0YWRvczwvZGl2PicgK1xyXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgICBiLnBlbmRpZW50ZXNQZWRpZG9zICtcclxuICAgICAgICAnPC9iPlBlbmQuIGNvbmZpcm1hcjwvZGl2PicgK1xyXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgICBjb252ICtcclxuICAgICAgICAnJTwvYj5Db252LiB2JnJhcnI7cDwvZGl2PicgK1xyXG4gICAgICAgICc8ZGl2IGNsYXNzPVwidm1cIj48Yj4nICtcclxuICAgICAgICAoYi5sYXN0QWN0aXZpdHkgfHwgJy0nKSArXHJcbiAgICAgICAgJzwvYj5VbHQuIGFjdGl2aWRhZDwvZGl2PicgK1xyXG4gICAgICAgICc8L2Rpdj48L2Rpdj4nO1xyXG4gICAgfSk7XHJcbiAgaWYgKCFodG1sKSBodG1sID0gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5ObyBoYXkgdmVuZGVkb3JlcyBleHRlcm5vcyBlbiBlbCBzY29wZS48L2Rpdj4nO1xyXG4gIHJldHVybiBodG1sO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJTZWdWaXNpdGFzKHZpc2l0cykge1xyXG4gIGlmICghdmlzaXRzLmxlbmd0aCkgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Tm8gaGF5IHZpc2l0YXMgZW4gZWwgcmFuZ28uPC9kaXY+JztcclxuICBjb25zdCBzb3J0ZWQgPSB2aXNpdHMuc2xpY2UoKS5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcbiAgY29uc3QgY2FuRGVsID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJztcclxuICBsZXQgaHRtbCA9XHJcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1yb3cgaGVhZFwiPjxkaXY+RmVjaGE8L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlIC8gVGllbmRhPC9kaXY+PGRpdj5Mb2NhbGlkYWQ8L2Rpdj48ZGl2Pk9ic2VydmFjaW9uZXM8L2Rpdj48L2Rpdj4nO1xyXG4gIHNvcnRlZC5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCBrID0gc2VnTWFrZUtleSh2LnZlbmRvciwgdi5wcm92aW5jaWEsIHYubG9jYWxpZGFkLCB2LnRpZW5kYSk7XHJcbiAgICBjb25zdCBkZWxCdG4gPVxyXG4gICAgICBjYW5EZWwgJiYgdi5pZFxyXG4gICAgICAgID8gJyA8YnV0dG9uIG9uY2xpY2s9XCJldmVudC5zdG9wUHJvcGFnYXRpb24oKTtkZWxldGVTZWdWaXNpdGEoXFwnJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHYuaWQpICtcclxuICAgICAgICAgIFwiJywnXCIgK1xyXG4gICAgICAgICAgZXNjYXBlQXR0cih2LnRpZW5kYSB8fCAnJykgK1xyXG4gICAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkVsaW1pbmFyIGVzdGEgdmlzaXRhIChhZG1pbi9nZXJlbnRlKVwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NnB4O3BhZGRpbmc6M3B4IDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweFwiPiYjMTI4NDY1OyBCb3JyYXI8L2J1dHRvbj4nXHJcbiAgICAgICAgOiAnJztcclxuICAgIC8vIHY0NDM6IGJhZGdlIHRpcG8gKFZJU0lUQSBwcmVzZW5jaWFsIHZzIENPTlRBQ1RPIG5vIHByZXNlbmNpYWwpLlxyXG4gICAgY29uc3QgY29udGFjdG8gPSBpc0NvbnRhY3RvKHYpO1xyXG4gICAgY29uc3QgdGlwb0JhZGdlID0gY29udGFjdG9cclxuICAgICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOiNjY2ZiZjE7Y29sb3I6IzBkNWM1Njtmb250LXNpemU6OHB4O2ZvbnQtd2VpZ2h0OjgwMDtwYWRkaW5nOjJweCA1cHg7Ym9yZGVyLXJhZGl1czozcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWxlZnQ6NnB4XCI+JiMxMjgxNzI7IENvbnRhY3RvPC9zcGFuPidcclxuICAgICAgOiAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOiNlZGU5ZmU7Y29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7Zm9udC1zaXplOjhweDtmb250LXdlaWdodDo4MDA7cGFkZGluZzoycHggNXB4O2JvcmRlci1yYWRpdXM6M3B4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1sZWZ0OjZweFwiPiYjMTI4NjYzOyBWaXNpdGE8L3NwYW4+JztcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihrKSArICdcXCcpXCI+JztcclxuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwoKHYuZmVjaGEgfHwgJycpLnNsaWNlKDAsIDEwKSB8fCAnLScpICsgdGlwb0JhZGdlICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PjxiPicgKyBlc2NhcGVIdG1sKHYudGllbmRhIHx8ICctJykgKyAnPC9iPjwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHYubG9jYWxpZGFkIHx8ICctJykgKyAnPC9kaXY+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbCgodi5jb21lbnRhcmlvIHx8IHYub2JzZXJ2YWNpb25lcyB8fCAnJykuc2xpY2UoMCwgMTQwKSkgK1xyXG4gICAgICAodi5wcm94aW1hQWNjaW9uXHJcbiAgICAgICAgPyAnPGJyPjxzcGFuIHN0eWxlPVwiY29sb3I6IzBkOTQ4ODtmb250LXdlaWdodDo3MDBcIj5Qcm94aW1hOiAnICtcclxuICAgICAgICAgIGVzY2FwZUh0bWwodi5wcm94aW1hQWNjaW9uKSArXHJcbiAgICAgICAgICAnPC9zcGFuPidcclxuICAgICAgICA6ICcnKSArXHJcbiAgICAgIGRlbEJ0biArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9KTtcclxuICByZXR1cm4gaHRtbDtcclxufVxyXG5cclxuLy8gRWxpbWluYSB1bmEgdmlzaXRhLiBTb2xvIGFkbWluL2dlcmVudGUgKGxhcyBydWxlcyBhZGVtYXMgYXV0b3JpemFuIGFsXHJcbi8vIG93bmVyLCBwZXJvIGRlc2RlIFNlZ3VpbWllbnRvIGxhIGFjY2lvbiBlcyBkZSByZXZpc2lvbi9saW1waWV6YSkuXHJcbndpbmRvdy5kZWxldGVTZWdWaXNpdGEgPSBhc3luYyBmdW5jdGlvbiAodmlzaXRJZCwgdGllbmRhKSB7XHJcbiAgaWYgKCF2aXNpdElkKSByZXR1cm47XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBlbGltaW5hciB2aXNpdGFzLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBsYmwgPSB0aWVuZGEgPyAnXCInICsgdGllbmRhICsgJ1wiJyA6ICdlc3RhIHZpc2l0YSc7XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdFbGltaW5hciBsYSB2aXNpdGEgYSAnICtcclxuICAgICAgICBsYmwgK1xyXG4gICAgICAgICcgZGVsIGhpc3RvcmlhbD9cXG5cXG5Fc3RhIGFjY2lvbiBlcyBJUlJFVkVSU0lCTEU6IGxhIHZpc2l0YSBkZXNhcGFyZWNlIGRlIFNlZ3VpbWllbnRvLCBydXRhcywgZGFzaGJvYXJkIHkgc3RhdHMgZGVsIHZlbmRlZG9yIGV4dGVybm8uJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5kb2ModmlzaXRJZCkuZGVsZXRlKCk7XHJcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnVmlzaXRhIGVsaW1pbmFkYScpO1xyXG4gICAgLy8gUmUtZmV0Y2ggbG9jYWwgKG5vIGhheSBsaXN0ZW5lciBkZSB2aXNpdHMgZ2xvYmFsKS4gRGVzcHVlcyByZS1yZW5kZXIuXHJcbiAgICBhd2FpdCBsb2FkU2VnVmlzaXRzKCk7XHJcbiAgICByZW5kZXJTZWd1aW1pZW50b1RhYigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZVNlZ1Zpc2l0YScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gcmVuZGVyU2VnUGVkaWRvcyhwZWRpZG9zKSB7XHJcbiAgaWYgKCFwZWRpZG9zLmxlbmd0aCkgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+Tm8gaGF5IHBlZGlkb3MgZW4gZWwgcmFuZ28uPC9kaXY+JztcclxuICBjb25zdCBzb3J0ZWQgPSBwZWRpZG9zXHJcbiAgICAuc2xpY2UoKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+XHJcbiAgICAgIChiLmNvbmZpcm1lZEF0IHx8IGIuZmluYWxpemVkQXQgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5jb25maXJtZWRBdCB8fCBhLmZpbmFsaXplZEF0IHx8ICcnKVxyXG4gICAgKTtcclxuICBjb25zdCBjYW5EZWwgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ2dlcmVudGUnO1xyXG4gIGxldCBodG1sID1cclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5GZWNoYTwvZGl2PjxkaXY+VmVuZGVkb3I8L2Rpdj48ZGl2PkNsaWVudGU8L2Rpdj48ZGl2PlVuaWRhZGVzPC9kaXY+PGRpdj5JbXBvcnRlICsgRXN0YWRvPC9kaXY+PC9kaXY+JztcclxuICBzb3J0ZWQuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgY29uc3QgayA9IHNlZ01ha2VLZXkocC52ZW5kb3IsIHAucHJvdmluY2UsIHAubG9jTmFtZSwgcC5jbGllbnROYW1lKTtcclxuICAgIGNvbnN0IGR0ID0gKHAuY29uZmlybWVkQXQgfHwgcC5maW5hbGl6ZWRBdCB8fCAnJykuc2xpY2UoMCwgMTApO1xyXG4gICAgY29uc3QgdW5pdHMgPSAocC5saW5lcyB8fCBbXSkucmVkdWNlKChzLCBsKSA9PiBzICsgKHBhcnNlRmxvYXQobC5xdHkpIHx8IDApLCAwKTtcclxuICAgIGNvbnN0IGFtdCA9IHAubmV0QW1vdW50QXJzICE9IG51bGwgPyBwLm5ldEFtb3VudEFycyA6IHAuc3VidG90YWxBcnMgfHwgMDtcclxuICAgIGNvbnN0IGJhZGdlQ2xzID0gcC5zdGFnZSA9PT0gJ2NvbmZpcm1lZCcgPyAnZ3JlZW4nIDogJ3llbGxvdyc7XHJcbiAgICBjb25zdCBiYWRnZVR4dCA9IHAuc3RhZ2UgPT09ICdjb25maXJtZWQnID8gJ0NvbmZpcm1hZG8nIDogJ1BlbmRpZW50ZSc7XHJcbiAgICAvLyBCb3RvbiBFTElNSU5BUjogc29sbyBhZG1pbi9nZXJlbnRlLiBVdGlsIHBhcmEgbGltcGlhciBwZWRpZG9zIFRFU1QuXHJcbiAgICAvLyBzdG9wUHJvcGFnYXRpb24gZXZpdGEgcXVlIGVsIGNsaWNrIGRpc3BhcmUgZWwgdGltZWxpbmUgZGVsIGNsaWVudGUuXHJcbiAgICBjb25zdCBkZWxCdG4gPVxyXG4gICAgICBjYW5EZWwgJiYgcC5fZnNJZFxyXG4gICAgICAgID8gJyA8YnV0dG9uIG9uY2xpY2s9XCJldmVudC5zdG9wUHJvcGFnYXRpb24oKTtkZWxldGVTZWdQZWRpZG8oXFwnJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHAuX2ZzSWQpICtcclxuICAgICAgICAgIFwiJywnXCIgK1xyXG4gICAgICAgICAgZXNjYXBlQXR0cihwLmNsaWVudE5hbWUgfHwgJycpICtcclxuICAgICAgICAgICdcXCcpXCIgdGl0bGU9XCJFbGltaW5hciBlc3RlIHBlZGlkbyBkZWwgaGlzdG9yaWFsIChhZG1pbi9nZXJlbnRlKVwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6OHB4O3BhZGRpbmc6M3B4IDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweFwiPiYjMTI4NDY1OyBCb3JyYXI8L2J1dHRvbj4nXHJcbiAgICAgICAgOiAnJztcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihrKSArICdcXCcpXCI+JztcclxuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwoZHQgfHwgJy0nKSArICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPGRpdj4nICsgZXNjYXBlSHRtbCh0aXRsZUNhc2UocC52ZW5kb3IgfHwgJycpKSArICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdj48Yj4nICtcclxuICAgICAgZXNjYXBlSHRtbChwLmNsaWVudE5hbWUgfHwgJy0nKSArXHJcbiAgICAgICc8L2I+PGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbChwLmxvY05hbWUgfHwgJycpICtcclxuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPGRpdj4nICsgdW5pdHMudG9GaXhlZCgwKSArICcgdTwvZGl2Pic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2PiQnICtcclxuICAgICAgTWF0aC5yb3VuZChhbXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgJyA8c3BhbiBjbGFzcz1cInNlZy1iYWRnZSAnICtcclxuICAgICAgYmFkZ2VDbHMgK1xyXG4gICAgICAnXCI+JyArXHJcbiAgICAgIGJhZGdlVHh0ICtcclxuICAgICAgJzwvc3Bhbj4nICtcclxuICAgICAgZGVsQnRuICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIH0pO1xyXG4gIHJldHVybiBodG1sO1xyXG59XHJcblxyXG4vLyBFbGltaW5hIHVuIHBlZGlkbyBkZWwgaGlzdG9yaWFsLiBTb2xvIGFkbWluL2dlcmVudGUuIExhcyBydWxlcyB5YSBsb1xyXG4vLyBwZXJtaXRlbiB2aWEgJ2FsbG93IHVwZGF0ZSwgZGVsZXRlOiBpZiBpc0FkbWluT3JHZXJlbnRlKCkgfHwgLi4uJy5cclxuLy8gUGVuc2FkbyBwYXJhIGxpbXBpYXIgcGVkaWRvcyBkZSBURVNUIG8gZHVwbGljYWRvcyBzaW4gdGVuZXIgcXVlIHNhbGlyXHJcbi8vIGRlIFNlZ3VpbWllbnRvLiBBY3Rpb24gaXJyZXZlcnNpYmxlOiBib3JyYSBlbCBkb2MgZW4gL3BlZGlkb3Mve2lkfS5cclxud2luZG93LmRlbGV0ZVNlZ1BlZGlkbyA9IGFzeW5jIGZ1bmN0aW9uIChmc0lkLCBjbGllbnROYW1lKSB7XHJcbiAgaWYgKCFmc0lkKSByZXR1cm47XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZSBlbGltaW5hciBwZWRpZG9zLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBsYmwgPSBjbGllbnROYW1lID8gJ1wiJyArIGNsaWVudE5hbWUgKyAnXCInIDogJ2VzdGUgcGVkaWRvJztcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ0VsaW1pbmFyIGVsIHBlZGlkbyBkZSAnICtcclxuICAgICAgICBsYmwgK1xyXG4gICAgICAgICcgZGVsIGhpc3RvcmlhbD9cXG5cXG5Fc3RhIGFjY2lvbiBlcyBJUlJFVkVSU0lCTEU6IGVsIHBlZGlkbyBkZXNhcGFyZWNlIGRlIFNlZ3VpbWllbnRvLCBEYXNoYm9hcmQsIGV4cG9ydHMgeSBjYW1wYVx1MDBGMWFzLidcclxuICAgIClcclxuICApXHJcbiAgICByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmRvYyhmc0lkKS5kZWxldGUoKTtcclxuICAgIGlmICh0eXBlb2Ygc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHNob3dTeW5jVGFnKCdQZWRpZG8gZWxpbWluYWRvJyk7XHJcbiAgICAvLyBFbCBsaXN0ZW5lciBnbG9iYWwgZGUgcGVkaWRvcyByZWZyZXNjYSBnbG9iYWxQZWRpZG9zIHNvbG8uIFBlcm9cclxuICAgIC8vIHBvciB0aW1pbmcsIGZvcnphbW9zIHVuIHJlLXJlbmRlciBwb3Igc2kgdG9kYXZpYSBubyBsbGVnbyBlbFxyXG4gICAgLy8gc25hcHNob3QgdXBkYXRlZC5cclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHJlbmRlclNlZ3VpbWllbnRvVGFiKCk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfSwgMjUwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVTZWdQZWRpZG8nLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNlZ1BlbmRpZW50ZXMoaXRlbXMpIHtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkgcmV0dXJuICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+U2luIHBlbmRpZW50ZXMgZW4gZWwgcmFuZ28uPC9kaXY+JztcclxuICBpdGVtcyA9IGl0ZW1zLnNsaWNlKCkuc29ydCgoYSwgX2IpID0+IChhLnN0YXR1cyA9PT0gJ3JlZCcgPyAtMSA6IDEpKTtcclxuICBjb25zdCBjYW5EZWwgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ2dlcmVudGUnO1xyXG4gIGNvbnN0IGlzU2VnVXNlciA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZScgfHwgdXNlclJvbGUgPT09ICdpbnRlcm5vJztcclxuICBsZXQgaHRtbCA9XHJcbiAgICAnPGRpdiBjbGFzcz1cInNlZy1yb3cgaGVhZFwiPjxkaXY+RXN0YWRvPC9kaXY+PGRpdj5WZW5kZWRvcjwvZGl2PjxkaXY+Q2xpZW50ZTwvZGl2PjxkaXY+VWx0LiBhY2Npb248L2Rpdj48ZGl2PlByb2JsZW1hICsgYWNjaW9uIHN1Z2VyaWRhPC9kaXY+PC9kaXY+JztcclxuICBpdGVtcy5mb3JFYWNoKChpdCkgPT4ge1xyXG4gICAgY29uc3QgbGJsID0gaXQuc3RhdHVzID09PSAncmVkJyA/ICdDUklUSUNPJyA6IGl0LnN0YXR1cyA9PT0gJ3llbGxvdycgPyAnUkVWSVNBUicgOiAnT0snO1xyXG4gICAgLy8gQm90b24gZGUgZWxpbWluYXIvcmVzb2x2ZXIgc2VndW4gb3JpZ2VuIGRlbCBwZW5kaWVudGU6XHJcbiAgICAvLyAgLSBwZWRpZG8tcGVuZGluZzogYm9ycmFyIGVsIGRvYyBkZWwgcGVkaWRvIChzb2xvIGFkbWluL2dlcmVudGUpLlxyXG4gICAgLy8gIC0gdmlzaXQtbm8tb3JkZXI6IG1hcmNhciBlbCBjbGllbnRLZXkgY29tbyAncmVzdWVsdG8nIGVuXHJcbiAgICAvLyAgICBzZWd1aW1pZW50b19zdGF0dXMgcGFyYSBxdWUgZGV0ZWN0U2VnUGVuZGllbnRlcyBsbyBvY3VsdGVcclxuICAgIC8vICAgIChjdWFscXVpZXIgdXNlciBkZSBTZWd1aW1pZW50byBwdWVkZSByZXNvbHZlcmxvKS5cclxuICAgIGxldCBhY3Rpb25CdG4gPSAnJztcclxuICAgIGlmIChpdC5raW5kID09PSAncGVkaWRvLXBlbmRpbmcnICYmIGNhbkRlbCAmJiBpdC5wZWRpZG9Gc0lkKSB7XHJcbiAgICAgIGFjdGlvbkJ0biA9XHJcbiAgICAgICAgJyA8YnV0dG9uIG9uY2xpY2s9XCJldmVudC5zdG9wUHJvcGFnYXRpb24oKTtkZWxldGVTZWdQZWRpZG8oXFwnJyArXHJcbiAgICAgICAgZXNjYXBlQXR0cihpdC5wZWRpZG9Gc0lkKSArXHJcbiAgICAgICAgXCInLCdcIiArXHJcbiAgICAgICAgZXNjYXBlQXR0cihpdC5jbGllbnQgfHwgJycpICtcclxuICAgICAgICAnXFwnKVwiIHRpdGxlPVwiRWxpbWluYXIgZWwgcGVkaWRvIHBlbmRpZW50ZSBkZWwgaGlzdG9yaWFsIChhZG1pbi9nZXJlbnRlKVwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NnB4O3BhZGRpbmc6M3B4IDhweDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweFwiPiYjMTI4NDY1OyBCb3JyYXIgcGVkaWRvPC9idXR0b24+JztcclxuICAgIH0gZWxzZSBpZiAoaXQua2luZCA9PT0gJ3Zpc2l0LW5vLW9yZGVyJyAmJiBpc1NlZ1VzZXIpIHtcclxuICAgICAgYWN0aW9uQnRuID1cclxuICAgICAgICAnIDxidXR0b24gb25jbGljaz1cImV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO3NldFNlZ1N0YXR1cyhcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKGl0LmNsaWVudEtleSkgK1xyXG4gICAgICAgICdcXCcsXFwncmVzdWVsdG9cXCcpXCIgdGl0bGU9XCJNYXJjYXIgZXN0ZSBjbGllbnRlIGNvbW8gcmVzdWVsdG8gLSBzZSBvY3VsdGEgZGUgUGVuZGllbnRlcyAobm8gYm9ycmEgdmlzaXRhcylcIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OjZweDtwYWRkaW5nOjNweCA4cHg7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDA7Y3Vyc29yOnBvaW50ZXI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4zcHhcIj4mIzEwMDAzOyBSZXNvbHZlcjwvYnV0dG9uPic7XHJcbiAgICB9XHJcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLXJvd1wiIG9uY2xpY2s9XCJvcGVuU2VnVGltZWxpbmUoXFwnJyArIGVzY2FwZUF0dHIoaXQuY2xpZW50S2V5KSArICdcXCcpXCI+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXY+PHNwYW4gY2xhc3M9XCJzZWctc3RhdHVzLWRvdCAnICtcclxuICAgICAgaXQuc3RhdHVzICtcclxuICAgICAgJ1wiPjwvc3Bhbj48c3BhbiBjbGFzcz1cInNlZy1iYWRnZSAnICtcclxuICAgICAgaXQuc3RhdHVzICtcclxuICAgICAgJ1wiPicgK1xyXG4gICAgICBsYmwgK1xyXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PicgKyBlc2NhcGVIdG1sKHRpdGxlQ2FzZShpdC52ZW5kb3IgfHwgJycpKSArICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdj48Yj4nICtcclxuICAgICAgZXNjYXBlSHRtbChpdC5jbGllbnQgfHwgJy0nKSArXHJcbiAgICAgICc8L2I+PGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbChpdC5sb2MgfHwgJycpICtcclxuICAgICAgJzwvc3Bhbj48L2Rpdj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWwoaXQudWx0aW1hQWNjaW9uIHx8ICctJykgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXY+PGI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWwoaXQucHJvYmxlbWEgfHwgJy0nKSArXHJcbiAgICAgICc8L2I+PGJyPjxzcGFuIHN0eWxlPVwiY29sb3I6IzBkOTQ4ODtmb250LXdlaWdodDo3MDBcIj4mcmFycjsgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwoaXQuYWNjaW9uIHx8ICcnKSArXHJcbiAgICAgICc8L3NwYW4+JyArXHJcbiAgICAgIGFjdGlvbkJ0biArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9KTtcclxuICByZXR1cm4gaHRtbDtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyU2VnRGVhZChpdGVtcykge1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKVxyXG4gICAgcmV0dXJuIChcclxuICAgICAgJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5Ub2RvcyBsb3MgY2xpZW50ZXMgdHV2aWVyb24gYWN0aXZpZGFkIHJlY2llbnRlLiAnICtcclxuICAgICAgJ1VtYnJhbGVzIGFwbGljYWRvczogc2luIHZpc2l0YSAzMGQgWSBzaW4gcGVkaWRvIDQ1ZC48L2Rpdj4nXHJcbiAgICApO1xyXG4gIGxldCBodG1sID1cclxuICAgICc8ZGl2IGNsYXNzPVwic2VnLXJvdyBoZWFkXCI+PGRpdj5Fc3RhZG88L2Rpdj48ZGl2PlZlbmRlZG9yPC9kaXY+PGRpdj5DbGllbnRlPC9kaXY+PGRpdj5EaWFzIHNpbiBhY3QuPC9kaXY+PGRpdj5VbHQuIHZpc2l0YSAvIHBlZGlkbyArIGZhY3R1cmFjaW9uICsgYWNjaW9uPC9kaXY+PC9kaXY+JztcclxuICBpdGVtcy5mb3JFYWNoKChpdCkgPT4ge1xyXG4gICAgY29uc3QgbGJsID0gaXQuc3RhdHVzID09PSAncmVkJyA/ICdDUklUSUNPJyA6ICdSRVZJU0FSJztcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctcm93XCIgb25jbGljaz1cIm9wZW5TZWdUaW1lbGluZShcXCcnICsgZXNjYXBlQXR0cihpdC5jbGllbnRLZXkpICsgJ1xcJylcIj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdj48c3BhbiBjbGFzcz1cInNlZy1zdGF0dXMtZG90ICcgK1xyXG4gICAgICBpdC5zdGF0dXMgK1xyXG4gICAgICAnXCI+PC9zcGFuPjxzcGFuIGNsYXNzPVwic2VnLWJhZGdlICcgK1xyXG4gICAgICBpdC5zdGF0dXMgK1xyXG4gICAgICAnXCI+JyArXHJcbiAgICAgIGxibCArXHJcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcclxuICAgIGh0bWwgKz0gJzxkaXY+JyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKGl0LnZlbmRvciB8fCAnJykpICsgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2PjxiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKGl0LmNsaWVudCB8fCAnLScpICtcclxuICAgICAgJzwvYj48YnI+PHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKGl0LmxvYyB8fCAnJykgK1xyXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PjxiIHN0eWxlPVwiY29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyKVwiPicgKyBpdC5kYXlzQWdvICsgJ2Q8L2I+PC9kaXY+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXY+VmlzaXRhOiAnICtcclxuICAgICAgZXNjYXBlSHRtbChpdC5sYXN0VmlzaXQgfHwgJy0nKSArXHJcbiAgICAgICcgJm1pZGRvdDsgUGVkaWRvOiAnICtcclxuICAgICAgZXNjYXBlSHRtbChpdC5sYXN0T3JkZXIgfHwgJy0nKSArXHJcbiAgICAgIChpdC5mYWN0dXJhY2lvblxyXG4gICAgICAgID8gJzxicj5GYWN0dXJhY2lvbiBoaXN0b3JpY2E6IDxiPiQnICtcclxuICAgICAgICAgIE1hdGgucm91bmQoaXQuZmFjdHVyYWNpb24pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgICAgICc8L2I+J1xyXG4gICAgICAgIDogJycpICtcclxuICAgICAgJzxicj48c3BhbiBzdHlsZT1cImNvbG9yOiMwZDk0ODg7Zm9udC13ZWlnaHQ6NzAwXCI+JnJhcnI7ICcgK1xyXG4gICAgICBlc2NhcGVIdG1sKGl0LmFjY2lvbiB8fCAnJykgK1xyXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIH0pO1xyXG4gIHJldHVybiBodG1sO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJTZWdPcHBzKGl0ZW1zKSB7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpXHJcbiAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5ObyBkZXRlY3QmZWFjdXRlOyBvcG9ydHVuaWRhZGVzIGVuIGVsIHJhbmdvLjxicj5MYXMgb3BvcnR1bmlkYWRlcyBzZSBkZXRlY3RhbiBwb3IgcGFsYWJyYXMgY2xhdmUgZW4gbG9zIGNvbWVudGFyaW9zIGRlIHZpc2l0YSAoaW50ZXJlc2FkbywgcG90ZW5jaWFsLCBjaWVycmUsIHJlcG9zaWNpb24sIGNvdGl6YS4uLikuPC9kaXY+JztcclxuICByZXR1cm4gcmVuZGVyU2VnUGVuZGllbnRlcyhpdGVtcyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNlZ0R1cGxhcyhkdXBsYXMpIHtcclxuICBjb25zdCBhcnIgPSBPYmplY3QudmFsdWVzKGR1cGxhcyk7XHJcbiAgaWYgKCFhcnIubGVuZ3RoKSByZXR1cm4gJzxkaXYgY2xhc3M9XCJzZWctZW1wdHlcIj5ObyBoYXkgZHVwbGFzIGNvbiBhY3RpdmlkYWQgZW4gZWwgcmFuZ28uPC9kaXY+JztcclxuICBsZXQgaHRtbCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1ib3R0b206OHB4O2ZvbnQtd2VpZ2h0OjcwMDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6I2YwZmRmYTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjVweFwiPlRhc2EgZGUgY29udmVyc2lvbiB2aXNpdGEgJnJhcnI7IHBlZGlkbyA9IHBlZGlkb3MgY29uZmlybWFkb3MgLyB2aXNpdGFzLiBFcyBsYSBtZXRyaWNhIGNsYXZlIHBhcmEgZXZhbHVhciBzaSBsYXMgdmlzaXRhcyBnZW5lcmFuIG5lZ29jaW8gcmVhbC48L2Rpdj4nO1xyXG4gIGFyci5zb3J0KChhLCBiKSA9PiAoYi5mYWN0IHx8IDApIC0gKGEuZmFjdCB8fCAwKSk7XHJcbiAgYXJyLmZvckVhY2goKGQpID0+IHtcclxuICAgIGNvbnN0IGNvbnYgPSBkLnZpc2l0YXMgPyBNYXRoLnJvdW5kKChkLnBlZGlkb3NDb25mIC8gZC52aXNpdGFzKSAqIDEwMCkgOiAwO1xyXG4gICAgY29uc3QgY2xzID0gY29udiA+PSA1MCA/ICcnIDogY29udiA+PSAyNSA/ICd5ZWxsb3cnIDogJ3JlZCc7XHJcbiAgICBjb25zdCBjb252QmcgPSBjb252ID49IDUwID8gJyNkY2ZjZTcnIDogY29udiA+PSAyNSA/ICcjZmVmM2M3JyA6ICcjZmVlMmUyJztcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctdmVuZG9yLWNhcmQgJyArIGNscyArICdcIj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGg0PicgK1xyXG4gICAgICBlc2NhcGVIdG1sKHRpdGxlQ2FzZShkLmludGVybm8pKSArXHJcbiAgICAgICcgJm1pZGRvdDsgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKGQuZXh0ZXJubykpICtcclxuICAgICAgJzwvaDQ+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgY2xhc3M9XCJ2bWV0cmljc1wiPicgK1xyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgIGQudmlzaXRhcyArXHJcbiAgICAgICc8L2I+VmlzaXRhczwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgIGQucGVkaWRvcyArXHJcbiAgICAgICc8L2I+UGVkaWRvczwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgIGQucGVkaWRvc0NvbmYgK1xyXG4gICAgICAnPC9iPkNvbmZpcm1hZG9zPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IGNsYXNzPVwidm1cIiBzdHlsZT1cImJhY2tncm91bmQ6JyArXHJcbiAgICAgIGNvbnZCZyArXHJcbiAgICAgICdcIj48Yj4nICtcclxuICAgICAgY29udiArXHJcbiAgICAgICclPC9iPkNvbnYgdiZyYXJyO3A8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPiQnICtcclxuICAgICAgTWF0aC5yb3VuZChkLmZhY3QpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgJzwvYj5GYWN0dXJhY2lvbjwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgIGQuY2xpZW50ZXMuc2l6ZSArXHJcbiAgICAgICc8L2I+Q2xpZW50ZXM8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgY2xhc3M9XCJ2bVwiPjxiPicgK1xyXG4gICAgICBkLnBlbmRpZW50ZXMgK1xyXG4gICAgICAnPC9iPlBlbmQuIGNvbmZpcm1hcjwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBjbGFzcz1cInZtXCI+PGI+JyArXHJcbiAgICAgIChkLmxhc3RBY3QgfHwgJy0nKSArXHJcbiAgICAgICc8L2I+VWx0LiBhY3RpdmlkYWQ8L2Rpdj4nICtcclxuICAgICAgJzwvZGl2PjwvZGl2Pic7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGh0bWw7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuU2VnVGltZWxpbmUgPSBmdW5jdGlvbiAoY2xpZW50S2V5KSB7XHJcbiAgaWYgKCFjYW5WaWV3U2VndWltaWVudG8oKSkgcmV0dXJuO1xyXG4gIGNvbnN0IHBhcnRzID0gKGNsaWVudEtleSB8fCAnJykuc3BsaXQoJ3wnKTtcclxuICBjb25zdCB2ZW5kb3IgPSBwYXJ0c1swXSxcclxuICAgIHByb3YgPSBwYXJ0c1sxXSxcclxuICAgIGxvYyA9IHBhcnRzWzJdLFxyXG4gICAgbmFtZSA9IHBhcnRzWzNdO1xyXG4gIGlmICghdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikpIHtcclxuICAgIGFsZXJ0KCdObyB0ZW5lcyBwZXJtaXNvcyBwYXJhIHZlciBlc3RlIGNsaWVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGN1cnJlbnRTZWdUaW1lbGluZUtleSA9IGNsaWVudEtleTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VnLXRsLXRpdGxlJykudGV4dENvbnRlbnQgPSBuYW1lIHx8ICcoY2xpZW50ZSknO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGwtc3ViJykuaW5uZXJIVE1MID1cclxuICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKHZlbmRvciB8fCAnJykpICtcclxuICAgICcgJm1pZGRvdDsgJyArXHJcbiAgICBlc2NhcGVIdG1sKGxvYyB8fCAnJykgK1xyXG4gICAgJyAvICcgK1xyXG4gICAgZXNjYXBlSHRtbCh0aXRsZUNhc2UocHJvdiB8fCAnJykpO1xyXG4gIGNvbnN0IGl0ZW1zID0gW107XHJcbiAgKHNlZ1Zpc2l0c0NhY2hlIHx8IFtdKVxyXG4gICAgLmZpbHRlcihcclxuICAgICAgKHYpID0+IHYudmVuZG9yID09PSB2ZW5kb3IgJiYgdi5wcm92aW5jaWEgPT09IHByb3YgJiYgdi5sb2NhbGlkYWQgPT09IGxvYyAmJiB2LnRpZW5kYSA9PT0gbmFtZVxyXG4gICAgKVxyXG4gICAgLmZvckVhY2goKHYpID0+IHtcclxuICAgICAgaXRlbXMucHVzaCh7XHJcbiAgICAgICAgdHlwZTogJ3Zpc2l0JyxcclxuICAgICAgICBkYXRlOiAodi5mZWNoYSB8fCAnJykuc2xpY2UoMCwgMTApLFxyXG4gICAgICAgIHRpdGxlOiAnVmlzaXRhJyxcclxuICAgICAgICBib2R5OlxyXG4gICAgICAgICAgKHYuY29tZW50YXJpbyB8fCB2Lm9ic2VydmFjaW9uZXMgfHwgJyhzaW4gY29tZW50YXJpb3MpJykgK1xyXG4gICAgICAgICAgKHYucHJveGltYUFjY2lvbiA/ICdcXG5Qcm94aW1hIGFjY2lvbjogJyArIHYucHJveGltYUFjY2lvbiA6ICcnKSxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICAoZ2xvYmFsUGVkaWRvcyB8fCBbXSlcclxuICAgIC5maWx0ZXIoXHJcbiAgICAgIChwKSA9PlxyXG4gICAgICAgIHNlZ1BlZGlkb1ZlbmRvcihwKSA9PT0gdmVuZG9yICYmXHJcbiAgICAgICAgcC5wcm92aW5jZSA9PT0gcHJvdiAmJlxyXG4gICAgICAgIHAubG9jTmFtZSA9PT0gbG9jICYmXHJcbiAgICAgICAgcC5jbGllbnROYW1lID09PSBuYW1lXHJcbiAgICApXHJcbiAgICAuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgICBjb25zdCBkdCA9IChwLmNvbmZpcm1lZEF0IHx8IHAuZmluYWxpemVkQXQgfHwgJycpLnNsaWNlKDAsIDEwKTtcclxuICAgICAgY29uc3QgYW10ID0gcC5uZXRBbW91bnRBcnMgIT0gbnVsbCA/IHAubmV0QW1vdW50QXJzIDogcC5zdWJ0b3RhbEFycyB8fCAwO1xyXG4gICAgICBjb25zdCB1bml0cyA9IChwLmxpbmVzIHx8IFtdKS5yZWR1Y2UoKHMsIGwpID0+IHMgKyAocGFyc2VGbG9hdChsLnF0eSkgfHwgMCksIDApO1xyXG4gICAgICBpdGVtcy5wdXNoKHtcclxuICAgICAgICB0eXBlOiAnb3JkZXInLFxyXG4gICAgICAgIGRhdGU6IGR0LFxyXG4gICAgICAgIHRpdGxlOlxyXG4gICAgICAgICAgJ1BlZGlkbyAnICtcclxuICAgICAgICAgIChwLnN0YWdlID09PSAnY29uZmlybWVkJyA/ICdjb25maXJtYWRvJyA6IHAuc3RhZ2UgPT09ICdwZW5kaW5nJyA/ICdwZW5kaWVudGUnIDogcC5zdGFnZSksXHJcbiAgICAgICAgYm9keTpcclxuICAgICAgICAgICckJyArXHJcbiAgICAgICAgICBNYXRoLnJvdW5kKGFtdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xyXG4gICAgICAgICAgJyAvICcgK1xyXG4gICAgICAgICAgdW5pdHMudG9GaXhlZCgwKSArXHJcbiAgICAgICAgICAnIHUgLyAnICtcclxuICAgICAgICAgIC8vIHY2MDUgRTU6IFNLVXMgdW5pY29zIChjb24gdjYwMCBzcGxpdCwgdW4gU0tVIHB1ZWRlIGFwYXJlY2VyIGVuIDIgbGluZWFzKVxyXG4gICAgICAgICAgbmV3IFNldCgocC5saW5lcyB8fCBbXSkubWFwKChsKSA9PiBsICYmIGwuY29kZSkuZmlsdGVyKEJvb2xlYW4pKS5zaXplICtcclxuICAgICAgICAgICcgU0tVKHMpJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICAoc2VnTm90ZXNDYWNoZSB8fCBbXSlcclxuICAgIC5maWx0ZXIoKG4pID0+IG4uY2xpZW50S2V5ID09PSBjbGllbnRLZXkpXHJcbiAgICAuZm9yRWFjaCgobikgPT4ge1xyXG4gICAgICBjb25zdCBkdCA9XHJcbiAgICAgICAgbi5jcmVhdGVkQXQgJiYgbi5jcmVhdGVkQXQudG9EYXRlID8gbi5jcmVhdGVkQXQudG9EYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgOiAnJztcclxuICAgICAgaXRlbXMucHVzaCh7XHJcbiAgICAgICAgdHlwZTogJ25vdGUnLFxyXG4gICAgICAgIGRhdGU6IGR0LFxyXG4gICAgICAgIHRpdGxlOiAnTm90YSBpbnRlcm5hIC0gJyArIChuLmF1dGhvck5hbWUgfHwgbi5hdXRob3JFbWFpbCB8fCAnJyksXHJcbiAgICAgICAgYm9keTogbi50ZXh0IHx8ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIGl0ZW1zLnNvcnQoKGEsIGIpID0+IChiLmRhdGUgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5kYXRlIHx8ICcnKSk7XHJcbiAgbGV0IGh0bWwgPSAnPGRpdiBjbGFzcz1cInNlZy10aW1lbGluZVwiPic7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpXHJcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwic2VnLWVtcHR5XCI+U2luIGFjdGl2aWRhZCByZWdpc3RyYWRhIHBhcmEgZXN0ZSBjbGllbnRlLjwvZGl2Pic7XHJcbiAgaXRlbXMuZm9yRWFjaCgoaXQpID0+IHtcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctdGltZWxpbmUtaXRlbSAnICsgaXQudHlwZSArICdcIj4nO1xyXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy10aW1lbGluZS1kYXRlXCI+JyArIGVzY2FwZUh0bWwoaXQuZGF0ZSB8fCAnKHMvZiknKSArICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy10aW1lbGluZS10aXRsZVwiPicgKyBlc2NhcGVIdG1sKGl0LnRpdGxlKSArICc8L2Rpdj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBjbGFzcz1cInNlZy10aW1lbGluZS1ib2R5XCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWwoaXQuYm9keSB8fCAnJykucmVwbGFjZSgvXFxuL2csICc8YnI+JykgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfSk7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBjb25zdCBjdXJTdGF0dXMgPSBzZWdTdGF0dXNDYWNoZVtjbGllbnRLZXldIHx8ICcnO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO3BhZGRpbmc6MTBweCAxMnB4O21hcmdpbi10b3A6MTRweDtib3JkZXItcmFkaXVzOjZweFwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouM3B4O21hcmdpbi1ib3R0b206NnB4XCI+RXN0YWRvIGRlIHNlZ3VpbWllbnRvIGludGVybm8gKG5vIGFmZWN0YSB2aXNpdGEgbmkgcGVkaWRvIG9yaWdpbmFsKTwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInNlZy1zdGF0dXMtcm93XCI+JztcclxuICBbXHJcbiAgICBbJ3BlbmRpZW50ZScsICdNYXJjYXIgcGVuZGllbnRlJ10sXHJcbiAgICBbJ3JldmlzYWRvJywgJ01hcmNhciByZXZpc2FkbyddLFxyXG4gICAgWydyZXN1ZWx0bycsICdNYXJjYXIgcmVzdWVsdG8nXSxcclxuICBdLmZvckVhY2goKHMpID0+IHtcclxuICAgIGNvbnN0IGFjdCA9IGN1clN0YXR1cyA9PT0gc1swXSA/ICdhY3RpdmUnIDogJyc7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwic2VnLXN0YXR1cy1idG4gJyArXHJcbiAgICAgIGFjdCArXHJcbiAgICAgICdcIiBvbmNsaWNrPVwic2V0U2VnU3RhdHVzKFxcJycgK1xyXG4gICAgICBlc2NhcGVBdHRyKGNsaWVudEtleSkgK1xyXG4gICAgICBcIicsJ1wiICtcclxuICAgICAgc1swXSArXHJcbiAgICAgICdcXCcpXCI+JyArXHJcbiAgICAgIHNbMV0gK1xyXG4gICAgICAnPC9idXR0b24+JztcclxuICB9KTtcclxuICBodG1sICs9ICc8L2Rpdj48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJzZWctbm90ZS1mb3JtXCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS1jb2xvci13YXJuaW5nKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweDttYXJnaW4tYm90dG9tOjVweFwiPk5vdGEgaW50ZXJuYSBlbnRyZSBpbnRlcm5vIHkgZXh0ZXJubyAobm8gbW9kaWZpY2EgbGEgdmlzaXRhKTwvZGl2Pic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzx0ZXh0YXJlYSBpZD1cInNlZy1ub3RlLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJFajogcmV2aXNhZG8sIGxvIGxsYW1vIG1hXHUwMEYxYW5hIHBhcmEgY2VycmFyIHJlcG9zaWNpb25cIj48L3RleHRhcmVhPic7XHJcbiAgaHRtbCArPSAnPGJ1dHRvbiBvbmNsaWNrPVwic2F2ZVNlZ05vdGUoXFwnJyArIGVzY2FwZUF0dHIoY2xpZW50S2V5KSArICdcXCcpXCI+R3VhcmRhciBub3RhPC9idXR0b24+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGwtY29udGVudCcpLmlubmVySFRNTCA9IGh0bWw7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy10aW1lbGluZS1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZVNlZ1RpbWVsaW5lID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWctdGltZWxpbmUtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbiAgY3VycmVudFNlZ1RpbWVsaW5lS2V5ID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5zYXZlU2VnTm90ZSA9IGFzeW5jIGZ1bmN0aW9uIChjbGllbnRLZXkpIHtcclxuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSByZXR1cm47XHJcbiAgY29uc3QgcGFydHMgPSAoY2xpZW50S2V5IHx8ICcnKS5zcGxpdCgnfCcpO1xyXG4gIGNvbnN0IHZlbmRvciA9IHBhcnRzWzBdO1xyXG4gIGlmICghdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikpIHtcclxuICAgIGFsZXJ0KCdTaW4gcGVybWlzb3MuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHRhID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlZy1ub3RlLWlucHV0Jyk7XHJcbiAgY29uc3QgdGV4dCA9ICgodGEgJiYgdGEudmFsdWUpIHx8ICcnKS50cmltKCk7XHJcbiAgaWYgKCF0ZXh0KSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignc2VndWltaWVudG9fbm90ZXMnKS5hZGQoe1xyXG4gICAgICBjbGllbnRLZXksXHJcbiAgICAgIHZlbmRvckV4dDogdmVuZG9yLFxyXG4gICAgICBwcm92OiBwYXJ0c1sxXSxcclxuICAgICAgbG9jOiBwYXJ0c1syXSxcclxuICAgICAgY2xpZW50TmFtZTogcGFydHNbM10sXHJcbiAgICAgIGF1dGhvclVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICBhdXRob3JFbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIGF1dGhvck5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICBhdXRob3JSb2xlOiB1c2VyUm9sZSxcclxuICAgICAgdGV4dCxcclxuICAgICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgIH0pO1xyXG4gICAgaWYgKHRhKSB0YS52YWx1ZSA9ICcnO1xyXG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykgc2hvd1N5bmNUYWcoJ05vdGEgaW50ZXJuYSBndWFyZGFkYScpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnRXJyb3IgZ3VhcmRhbmRvIG5vdGE6ICcgK1xyXG4gICAgICAgIChlLm1lc3NhZ2UgfHwgZSkgK1xyXG4gICAgICAgICdcXG5cXG5Qcm9iYWJsZTogZmFsdGFuIHJ1bGVzIGVuIEZpcmVzdG9yZSBwYXJhIFwic2VndWltaWVudG9fbm90ZXNcIi4nXHJcbiAgICApO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5zZXRTZWdTdGF0dXMgPSBhc3luYyBmdW5jdGlvbiAoY2xpZW50S2V5LCBzdGF0dXMpIHtcclxuICBpZiAoIWNhblZpZXdTZWd1aW1pZW50bygpKSByZXR1cm47XHJcbiAgY29uc3QgcGFydHMgPSAoY2xpZW50S2V5IHx8ICcnKS5zcGxpdCgnfCcpO1xyXG4gIGNvbnN0IHZlbmRvciA9IHBhcnRzWzBdO1xyXG4gIGlmICghdmVuZG9ySW5TZWd1aW1pZW50b1Njb3BlKHZlbmRvcikpIHtcclxuICAgIGFsZXJ0KCdTaW4gcGVybWlzb3MuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGRvY0lkID0gY2xpZW50S2V5LnJlcGxhY2UoL1svXFxcXCM/XS9nLCAnXycpLnNsaWNlKDAsIDQwMCkgKyAnX18nICsgKGN1cnJlbnRVc2VyLnVpZCB8fCAnJyk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignc2VndWltaWVudG9fc3RhdHVzJykuZG9jKGRvY0lkKS5zZXQoXHJcbiAgICAgIHtcclxuICAgICAgICBjbGllbnRLZXksXHJcbiAgICAgICAgdmVuZG9yRXh0OiB2ZW5kb3IsXHJcbiAgICAgICAgcHJvdjogcGFydHNbMV0sXHJcbiAgICAgICAgbG9jOiBwYXJ0c1syXSxcclxuICAgICAgICBjbGllbnROYW1lOiBwYXJ0c1szXSxcclxuICAgICAgICBhdXRob3JVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcclxuICAgICAgICBzdGF0dXMsXHJcbiAgICAgICAgdXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgfSxcclxuICAgICAgeyBtZXJnZTogdHJ1ZSB9XHJcbiAgICApO1xyXG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykgc2hvd1N5bmNUYWcoJ0VzdGFkbzogJyArIHN0YXR1cyk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSArICdcXG5cXG5Qcm9iYWJsZTogZmFsdGFuIHJ1bGVzIHBhcmEgXCJzZWd1aW1pZW50b19zdGF0dXNcIi4nKTtcclxuICB9XHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQW1CQSxNQUFJLE9BQU8sT0FBTyxrQkFBa0IsWUFBYSxRQUFPLGdCQUFnQjtBQUN4RSxNQUFJLE9BQU8sT0FBTyxtQkFBbUIsWUFBYSxRQUFPLGlCQUFpQjtBQWExRSxNQUFJLGlCQUFpQixDQUFDO0FBQ3RCLE1BQUksZ0JBQWdCLENBQUM7QUFDckIsTUFBSSxpQkFBaUIsQ0FBQztBQUN0QixNQUFJLGdCQUFnQjtBQUNwQixNQUFJLHdCQUF3QjtBQUM1QixNQUFJLG9CQUFvQjtBQUV4QixXQUFTLGdCQUFnQixHQUFHO0FBQzFCLFFBQUksQ0FBQyxFQUFHLFFBQU87QUFDZixRQUFJLEVBQUUsT0FBUSxRQUFPLEVBQUU7QUFDdkIsUUFBSSxFQUFFLGVBQWdCLFFBQU8sRUFBRTtBQUMvQixRQUFJLE9BQU8sb0JBQW9CLGNBQWMsRUFBRSxJQUFLLFFBQU8sZ0JBQWdCLEVBQUUsR0FBRztBQUNoRixXQUFPO0FBQUEsRUFDVDtBQU1BLFdBQVMsV0FBVyxHQUFHO0FBQ3JCLFdBQU8sQ0FBQyxFQUFFLEtBQUssRUFBRSxvQkFBb0I7QUFBQSxFQUN2QztBQUVBLFNBQU8sdUJBQXVCLGlCQUFrQjtBQUM5QyxRQUFJLENBQUMsbUJBQW1CLEdBQUc7QUFDekIsWUFBTSx1Q0FBdUM7QUFDN0M7QUFBQSxJQUNGO0FBQ0EsVUFBTSxNQUFNLDBCQUEwQjtBQUN0QyxRQUFJLENBQUMsSUFBSSxNQUFNO0FBQ2I7QUFBQSxRQUNFO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLGFBQVMsZUFBZSxtQkFBbUIsRUFBRSxVQUFVLElBQUksTUFBTTtBQUNqRSx1QkFBbUI7QUFDbkIsVUFBTSxVQUFVLFNBQVMsZUFBZSxZQUFZO0FBQ3BELFVBQU0sVUFBVSxTQUFTLGVBQWUsWUFBWTtBQUNwRCxRQUFJLFdBQVcsQ0FBQyxRQUFRLE9BQU87QUFJN0IsWUFBTSxNQUFNLG9CQUFJ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
