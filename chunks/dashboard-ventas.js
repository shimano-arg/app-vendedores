"use strict";
(() => {
  // src/domains/dashboard-ventas.js
  var CHART_JS_URL = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
  var TOP_N = 20;
  var REGION = "southamerica-east1";
  var FILTROS_DEF = [
    { key: "vendedores", label: "Vendedor" },
    { key: "clientes", label: "Cliente" },
    { key: "provincias", label: "Provincia" },
    { key: "categorias", label: "Categor\xEDa" },
    { key: "skus", label: "SKU" }
  ];
  function _selVacia() {
    return { vendedores: [], clientes: [], provincias: [], categorias: [], skus: [] };
  }
  var state = {
    uid: null,
    mes: "",
    sel: _selVacia(),
    data: null,
    opciones: null,
    opcionesRendered: null,
    loading: false,
    error: "",
    verMas: { unidades: false, dinero: false, clientes: false },
    verMasQuery: { unidades: "", dinero: "", clientes: "" },
    interQuery: "",
    prodQuery: "",
    reqSeq: 0
  };
  function _resetState(uid) {
    state.uid = uid;
    state.mes = _mesActualArt();
    state.sel = _selVacia();
    state.data = null;
    state.opciones = null;
    state.opcionesRendered = null;
    state.loading = false;
    state.error = "";
    state.verMas = { unidades: false, dinero: false, clientes: false };
    state.verMasQuery = { unidades: "", dinero: "", clientes: "" };
    state.interQuery = "";
    state.prodQuery = "";
    state.reqSeq++;
  }
  var charts = {};
  var chartJsPromise = null;
  function _escHtml(s) {
    const v = s == null ? "" : s;
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function _fmtArs(n) {
    const v = Number(n) || 0;
    return "$" + Math.round(v).toLocaleString("es-AR");
  }
  function _fmtUds(n) {
    return Math.round(Number(n) || 0).toLocaleString("es-AR");
  }
  function _role() {
    try {
      return (typeof userRole !== "undefined" ? userRole : window.userRole) || null;
    } catch (_e) {
      return window.userRole || null;
    }
  }
  function _myVendor() {
    try {
      return (typeof assignedVendor !== "undefined" ? assignedVendor : window.assignedVendor) || "";
    } catch (_e) {
      return window.assignedVendor || "";
    }
  }
  function _currentUid() {
    try {
      const u = typeof currentUser !== "undefined" ? currentUser : window.currentUser;
      return u && u.uid || null;
    } catch (_e) {
      return window.currentUser && window.currentUser.uid || null;
    }
  }
  function _isOpen() {
    const modal = document.getElementById("dashboard-ventas-modal");
    return !!(modal && modal.classList && modal.classList.contains("open"));
  }
  function _isVendedor() {
    return _role() === "vendedor";
  }
  function _mesActualArt() {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
        year: "numeric",
        month: "2-digit"
      }).formatToParts(/* @__PURE__ */ new Date());
      const y = parts.find((p) => p.type === "year").value;
      const m = parts.find((p) => p.type === "month").value;
      return y + "-" + m;
    } catch (_e) {
      const d = /* @__PURE__ */ new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }
  }
  var MESES_CORTOS = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic"
  ];
  function _labelMes(aaaamm) {
    const s = String(aaaamm || "");
    const m = Number(s.slice(5, 7));
    if (!m) return s;
    return MESES_CORTOS[m - 1] + " " + s.slice(2, 4);
  }
  function _errorMessage() {
    try {
      const mv = window.__phase0 && window.__phase0.pure && window.__phase0.pure.mensajesVendedor;
      if (mv && typeof mv.formatMensajeConCodigo === "function") {
        return mv.formatMensajeConCodigo("DASHBOARD_VENTAS_FAILED");
      }
    } catch (_e) {
    }
    return "No pudimos cargar el tablero de ventas. Volv\xE9 a intentar en un minuto; si sigue pasando, avisale a Mariano.\n\nC\xF3digo t\xE9cnico: DASHBOARD_VENTAS_FAILED";
  }
  function _loadChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (chartJsPromise) return chartJsPromise;
    chartJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = CHART_JS_URL;
      s.async = true;
      s.onload = () => window.Chart ? resolve(window.Chart) : reject(new Error("Chart.js sin global"));
      s.onerror = () => {
        chartJsPromise = null;
        reject(new Error("no se pudo cargar Chart.js"));
      };
      document.head.appendChild(s);
    });
    return chartJsPromise;
  }
  function _destroyCharts() {
    for (const k of Object.keys(charts)) {
      try {
        charts[k].destroy();
      } catch (_e) {
      }
      delete charts[k];
    }
  }
  function _opcionesDe(key) {
    const op = state.opciones || {};
    const arr = Array.isArray(op[key]) ? op[key] : [];
    if (key === "clientes") {
      return arr.map((c) => ({
        value: String(c.code),
        label: String(c.name || c.code) + " (" + String(c.code) + ")"
      }));
    }
    if (key === "skus") {
      return arr.map((s) => ({
        value: String(s.code),
        label: String(s.code) + (s.desc ? " - " + String(s.desc) : "")
      }));
    }
    return arr.map((v) => ({ value: String(v), label: String(v) }));
  }
  function _resumenSel(key, opciones) {
    const n = state.sel[key].length;
    if (n === 0) return "Todos";
    if (n === 1) {
      const o = opciones.find((x) => x.value === state.sel[key][0]);
      return o ? o.label : state.sel[key][0];
    }
    return n + " seleccionados";
  }
  function _renderFiltro(def) {
    if (def.key === "vendedores" && _isVendedor()) {
      return '<div class="dv-filtro"><div class="dv-filtro-label">' + _escHtml(def.label) + '</div><div class="dv-ms-locked" title="Ves solo tus clientes">' + _escHtml(_myVendor() || "Tus clientes") + " \u{1F512}</div></div>";
    }
    const opciones = _opcionesDe(def.key);
    const selected = new Set(state.sel[def.key]);
    let list = "";
    for (const o of opciones) {
      list += '<label class="dv-ms-opt" data-search="' + _escHtml(o.label.toLowerCase()) + '"><input type="checkbox" data-filtro="' + def.key + '" value="' + _escHtml(o.value) + '"' + (selected.has(o.value) ? " checked" : "") + "> <span>" + _escHtml(o.label) + "</span></label>";
    }
    if (!list) list = '<div class="dv-muted" style="padding:6px">Sin opciones todav\xEDa.</div>';
    return '<div class="dv-filtro"><div class="dv-filtro-label">' + _escHtml(def.label) + '</div><details class="dv-ms" data-ms="' + def.key + '"><summary>' + _escHtml(_resumenSel(def.key, opciones)) + '</summary><div class="dv-ms-pop"><input type="search" class="dv-ms-search" placeholder="Buscar\u2026" data-ms-search="' + def.key + '"><div class="dv-ms-actions"><button type="button" class="dv-link" data-ms-clear="' + def.key + '">Limpiar</button></div><div class="dv-ms-list">' + list + "</div></div></details></div>";
  }
  function _readSelFromDom(root) {
    const next = _selVacia();
    root.querySelectorAll('input[type="checkbox"][data-filtro]').forEach((el) => {
      const key = el.getAttribute("data-filtro");
      if (el.checked && next[key]) next[key].push(el.value);
    });
    if (_isVendedor()) next.vendedores = [];
    state.sel = next;
    const mesEl = root.querySelector("#dv-mes");
    if (mesEl && /^\d{4}-\d{2}$/.test(mesEl.value)) state.mes = mesEl.value;
  }
  function _ensureSkeleton() {
    const body = document.getElementById("dashboard-ventas-body");
    if (!body) return null;
    if (!document.getElementById("dv-filtros-host") || !document.getElementById("dv-results")) {
      body.innerHTML = '<div id="dv-filtros-host"></div><div id="dv-results"></div>';
      state.opcionesRendered = null;
    }
    return body;
  }
  function renderFiltros(force) {
    const host = document.getElementById("dv-filtros-host");
    if (!host) return;
    if (!force && state.opcionesRendered === state.opciones && host.innerHTML) return;
    const prev = document.getElementById("dv-filtros");
    const abierto = prev ? !!prev.open : window.innerWidth > 700;
    let html = '<details class="dv-filtros" id="dv-filtros"' + (abierto ? " open" : "") + ">";
    html += '<summary>Filtros</summary><div class="dv-filtros-grid">';
    html += '<div class="dv-filtro"><div class="dv-filtro-label">Mes</div><input type="month" id="dv-mes" class="dv-input" value="' + _escHtml(state.mes) + '"></div>';
    for (const def of FILTROS_DEF) html += _renderFiltro(def);
    html += '</div><div class="dv-filtros-actions">';
    html += '<button type="button" class="dv-btn-secondary" data-dv-action="limpiar">Limpiar filtros</button><button type="button" class="dv-btn-primary" id="dv-aplicar" data-dv-action="aplicar"' + (state.loading ? " disabled" : "") + ">Aplicar</button>";
    html += "</div></details>";
    host.innerHTML = html;
    state.opcionesRendered = state.opciones;
  }
  function _syncAplicarDisabled() {
    const btn = document.getElementById("dv-aplicar");
    if (btn) btn.disabled = !!state.loading;
  }
  function _card(titulo, valor) {
    return '<div class="dv-card"><div class="dv-card-title">' + _escHtml(titulo) + '</div><div class="dv-card-value">' + _escHtml(valor) + "</div></div>";
  }
  function _fmtPct(n) {
    return (Number(n) || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }) + "%";
  }
  function _fmtFecha(f) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f == null ? "" : f));
    return m ? m[3] + "/" + m[2] + "/" + m[1] : String(f == null ? "" : f);
  }
  function _tipoLabel(t) {
    return t === "visita" ? "Visita" : "Contacto";
  }
  function _interaccionesTabla(rows, total, query) {
    const q = String(query || "").toLowerCase().trim();
    const lista = Array.isArray(rows) ? rows : [];
    const filtered = q ? lista.filter(
      (r) => (String(r.cliente) + " " + _fmtFecha(r.fecha) + " " + String(r.vendedor) + " " + _tipoLabel(r.tipo)).toLowerCase().includes(q)
    ) : lista;
    let html = '<div class="dv-table-wrap dv-inter-wrap"><table class="dv-table"><thead><tr><th>Cliente</th><th>Fecha</th><th>Vendedor</th><th>Tipo</th></tr></thead><tbody>';
    for (const r of filtered) {
      html += "<tr><td>" + _escHtml(r.cliente) + "</td><td>" + _escHtml(_fmtFecha(r.fecha)) + "</td><td>" + _escHtml(r.vendedor) + "</td><td>" + _escHtml(_tipoLabel(r.tipo)) + "</td></tr>";
    }
    if (filtered.length === 0)
      html += '<tr><td colspan="4" class="dv-muted">Sin resultados.</td></tr>';
    html += "</tbody></table></div>";
    const totalN = Number(total) || 0;
    if (totalN > lista.length) {
      html += '<div class="dv-muted">Mostrando ' + _escHtml(_fmtUds(lista.length)) + " de " + _escHtml(_fmtUds(totalN)) + "</div>";
    }
    return html;
  }
  function _interaccionesSection(t, query) {
    const rows = t && t.rows || [];
    return '<section class="dv-section" id="dv-interacciones"><div class="dv-section-head"><h3>Interacciones</h3></div><input type="search" class="dv-ms-search" id="dv-interacciones-buscar" placeholder="Buscar cliente, vendedor o tipo\u2026"><div class="dv-inter-body">' + _interaccionesTabla(rows, t && t.total, query) + "</div></section>";
  }
  function _gestionSection(g, secciones, query) {
    if (!g || secciones && secciones.gestion && secciones.gestion.error) {
      return '<div class="dv-cards" id="dv-gestion">' + _card("Gesti\xF3n", "No disponible") + "</div>";
    }
    let html = '<div class="dv-cards" id="dv-gestion">';
    html += _card("Target", g.target == null ? "Sin target" : _fmtArs(g.target));
    html += _card(
      "% cumplimiento",
      g.cumplimientoPct == null ? "Sin target" : _fmtPct(g.cumplimientoPct)
    );
    html += _card("Rendiciones \u2013 monto", _fmtArs(g.rendicionesArs));
    html += _card("Base activa", _fmtUds(g.baseActiva));
    html += _card("Ticket promedio", _fmtArs(g.ticketPromedio));
    html += _card("N\xB0 visitas", _fmtUds(g.visitas));
    html += _card("N\xB0 contactados", _fmtUds(g.contactados));
    html += _card("N\xB0 interacciones", _fmtUds(g.interacciones));
    html += "</div>";
    if (g.filtrosNoAplican) {
      html += '<div class="dv-leyenda dv-muted">Target y rendiciones no se filtran por cliente ni producto; visitas y contactos no se filtran por producto.</div>';
    }
    html += _interaccionesSection(g.tablaInteracciones, query);
    return html;
  }
  function _tipoVerMas(tipoIn) {
    return tipoIn === "dinero" ? "dinero" : tipoIn === "clientes" ? "clientes" : "unidades";
  }
  function _verMasTabla(tipoIn, rows) {
    const tipo = _tipoVerMas(tipoIn);
    const q = state.verMasQuery[tipo].toLowerCase().trim();
    const esCli = tipo === "clientes";
    const ranked = rows.map((r, i) => ({ r, pos: i + 1 }));
    const filtered = q ? ranked.filter(
      (x) => (esCli ? String(x.r.nombre) + " " + String(x.r.code) : String(x.r.sku) + " " + String(x.r.desc || "")).toLowerCase().includes(q)
    ) : ranked;
    let html = '<div class="dv-vermas"><input type="search" class="dv-ms-search" placeholder="' + (esCli ? "Buscar cliente\u2026" : "Buscar SKU o descripci\xF3n\u2026") + '" data-vermas-search="' + tipo + '"><div class="dv-table-wrap"><table class="dv-table"><thead><tr>' + (esCli ? '<th>#</th><th>Cliente</th><th class="num">Facturado</th>' : '<th>#</th><th>SKU</th><th>Descripci\xF3n</th><th class="num">Unidades</th><th class="num">Dinero</th>') + "</tr></thead><tbody>";
    for (const { r, pos } of filtered) {
      if (esCli) {
        html += "<tr><td>" + pos + "</td><td>" + _escHtml(r.nombre) + '</td><td class="num">' + _escHtml(_fmtArs(r.facturado)) + "</td></tr>";
        continue;
      }
      html += "<tr><td>" + pos + '</td><td class="mono">' + _escHtml(r.sku) + "</td><td>" + _escHtml(r.desc) + '</td><td class="num">' + _escHtml(_fmtUds(r.uds)) + '</td><td class="num">' + _escHtml(_fmtArs(r.ars)) + "</td></tr>";
    }
    if (filtered.length === 0)
      html += '<tr><td colspan="' + (esCli ? 3 : 5) + '" class="dv-muted">Sin resultados.</td></tr>';
    html += "</tbody></table></div></div>";
    return html;
  }
  function _topSection(tipo, titulo, rows) {
    const abierto = state.verMas[tipo];
    const total = rows.length;
    const h = Math.max(120, Math.min(TOP_N, total) * 22 + 40);
    return '<section class="dv-section"><div class="dv-section-head"><h3>' + _escHtml(titulo) + "</h3>" + (total > 0 ? '<button type="button" class="dv-link" data-vermas="' + tipo + '" aria-expanded="' + (abierto ? "true" : "false") + '">' + (abierto ? "Ver menos" : "Ver m\xE1s") + " (" + total + ")</button>" : "") + "</div>" + (total > 0 ? '<div class="dv-chart" style="height:' + h + 'px"><canvas id="dv-chart-top-' + tipo + '" role="img" aria-label="' + _escHtml(titulo) + '"></canvas></div>' : '<div class="dv-muted">Sin datos.</div>') + (abierto ? _verMasTabla(tipo, rows) : "") + "</section>";
  }
  function _stockColumnas(sku) {
    const vacio = { reservadas: null, libre: null, stock: null };
    try {
      if (typeof window === "undefined" || typeof window.getStockBreakdown !== "function")
        return vacio;
      if (typeof window.getStockDisponibleVenta === "function") {
        if (window.getStockDisponibleVenta(sku) === null) return vacio;
      }
      const b = window.getStockBreakdown(sku);
      if (!b) return vacio;
      return {
        reservadas: Number(b.reservadasTotal) || 0,
        libre: Number(b.libre) || 0,
        stock: Number(b.fisicoDep11) || 0
      };
    } catch (_e) {
      return vacio;
    }
  }
  function _fmtStockCol(n) {
    return n == null ? "\u2026" : _fmtUds(n);
  }
  function _coberturaEtiqueta(r) {
    const pct = r.pct == null ? "\u2014" : (Number(r.pct) || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }) + "%";
    return (Number(r.compraron) || 0) + " de " + (Number(r.dadosAlta) || 0) + " \xB7 " + pct;
  }
  function _productosTabla(rows, query) {
    const q = String(query || "").toLowerCase().trim();
    const lista = Array.isArray(rows) ? rows : [];
    const filtered = q ? lista.filter(
      (r) => (String(r.categoria) + " " + String(r.familia) + " " + String(r.sku)).toLowerCase().includes(q)
    ) : lista;
    let html = '<div class="dv-table-wrap"><table class="dv-table"><thead><tr><th>CATEGORIA</th><th>FAMILIA</th><th>SKU</th><th class="num">UNIDADES VENDIDAS</th><th class="num">FACTURADO</th><th class="num">UNIDADES BACKORDER</th><th class="num">UNIDADES RESERVADAS</th><th class="num">UNIDADES LIBRE PARA LA VENTA</th><th class="num">UNIDADES EN STOCK</th></tr></thead><tbody>';
    for (const r of filtered) {
      const st = _stockColumnas(r.sku);
      html += "<tr><td>" + _escHtml(r.categoria) + "</td><td>" + _escHtml(r.familia) + '</td><td class="mono">' + _escHtml(r.sku) + '</td><td class="num">' + _escHtml(_fmtUds(r.udsVendidas)) + '</td><td class="num">' + _escHtml(_fmtArs(r.facturado)) + '</td><td class="num">' + _escHtml(_fmtUds(r.udsBackorder)) + '</td><td class="num">' + _escHtml(_fmtStockCol(st.reservadas)) + '</td><td class="num">' + _escHtml(_fmtStockCol(st.libre)) + '</td><td class="num">' + _escHtml(_fmtStockCol(st.stock)) + "</td></tr>";
    }
    if (filtered.length === 0)
      html += '<tr><td colspan="9" class="dv-muted">Sin resultados.</td></tr>';
    html += "</tbody></table></div>";
    return html;
  }
  function _noDisponible(id, titulo) {
    return '<section class="dv-section" id="' + id + '"><div class="dv-section-head"><h3>' + _escHtml(titulo) + '</h3></div><div class="dv-muted">No disponible</div></section>';
  }
  function _productosSection(rows, secciones, query) {
    if (!Array.isArray(rows) || secciones && secciones.productos && secciones.productos.error) {
      return _noDisponible("dv-productos", "Productos");
    }
    return '<section class="dv-section" id="dv-productos"><div class="dv-section-head"><h3>Productos</h3></div><input type="search" class="dv-ms-search" id="dv-productos-buscar" placeholder="Buscar categor\xEDa, familia o SKU\u2026"><div class="dv-prod-body">' + _productosTabla(rows, query) + "</div></section>";
  }
  function _coberturaSection(rows, secciones) {
    if (!Array.isArray(rows) || secciones && secciones.cobertura && secciones.cobertura.error) {
      return _noDisponible("dv-cobertura-chart", "Cobertura de clientes");
    }
    const h = Math.max(120, rows.length * 44 + 40);
    return '<section class="dv-section" id="dv-cobertura-chart"><div class="dv-section-head"><h3>Cobertura de clientes</h3></div>' + (rows.length > 0 ? '<div class="dv-chart" style="height:' + h + 'px"><canvas id="dv-canvas-cobertura" role="img" aria-label="Cobertura de clientes"></canvas></div>' : '<div class="dv-muted">Sin datos.</div>') + "</section>";
  }
  function _clientesSection(rows, secciones) {
    if (!Array.isArray(rows) || secciones && secciones.clientes && secciones.clientes.error) {
      return _noDisponible("dv-clientes-chart", "Facturaci\xF3n por cliente");
    }
    const abierto = state.verMas.clientes;
    const total = rows.length;
    const h = Math.max(120, Math.min(TOP_N, total) * 22 + 40);
    return '<section class="dv-section" id="dv-clientes-chart"><div class="dv-section-head"><h3>Facturaci\xF3n por cliente - Top 20</h3>' + (total > 0 ? '<button type="button" class="dv-link" data-vermas="clientes" aria-expanded="' + (abierto ? "true" : "false") + '">' + (abierto ? "Ver menos" : "Ver m\xE1s") + " (" + total + ")</button>" : "") + "</div>" + (total > 0 ? '<div class="dv-chart" style="height:' + h + 'px"><canvas id="dv-chart-top-clientes" role="img" aria-label="Facturaci\xF3n por cliente"></canvas></div>' : '<div class="dv-muted">Sin datos.</div>') + (abierto ? _verMasTabla("clientes", rows) : "") + "</section>";
  }
  function _lineSection(id, titulo) {
    return '<section class="dv-section"><div class="dv-section-head"><h3>' + _escHtml(titulo) + '</h3></div><div class="dv-chart" style="height:240px"><canvas id="' + id + '" role="img" aria-label="' + _escHtml(titulo) + '"></canvas></div></section>';
  }
  function _isEmpty(d) {
    if (!d) return true;
    const k = d.kpis || {};
    const hayKpi = Number(k.facturado) || Number(k.pedidos) || Number(k.pedidosUnicos) || Number(k.backorderArs);
    const hayTop = Array.isArray(d.topUnidades) && d.topUnidades.length > 0;
    const haySerie = Array.isArray(d.serieVentas) && d.serieVentas.some((p) => Number(p.valor));
    return !hayKpi && !hayTop && !haySerie;
  }
  function renderResults() {
    const root = document.getElementById("dv-results");
    if (!root) return;
    const d = state.data;
    let html = '<div class="dv-leyenda">Montos sin IVA, con descuento aplicado y notas de cr\xE9dito restadas.';
    if (d && d.dataUpdatedAt && !state.loading) {
      const t = new Date(d.dataUpdatedAt);
      if (!Number.isNaN(t.getTime())) {
        html += ' <span class="dv-muted">\xB7 Calculado ' + _escHtml(t.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })) + "</span>";
      }
    }
    html += "</div>";
    if (state.loading) {
      html += '<div class="dv-estado">Cargando\u2026</div>';
    } else if (state.error) {
      html += '<div class="dv-estado dv-error">' + _escHtml(state.error).replace(/\n/g, "<br>") + "</div>";
    } else if (d && _isEmpty(d)) {
      html += '<div class="dv-estado">No hay ventas con esos filtros.</div>';
    } else if (d) {
      const k = d.kpis || {};
      html += '<div class="dv-cards">';
      html += _card("Facturado mensual", _fmtArs(k.facturado));
      html += _card("Valorizaci\xF3n backorder", _fmtArs(k.backorderArs));
      html += _card("Cant. de pedidos del mes", _fmtUds(k.pedidos));
      html += _card("Cant. pedidos \xFAnicos", _fmtUds(k.pedidosUnicos));
      html += "</div>";
      html += _gestionSection(d.gestion, d.secciones, state.interQuery);
      html += _topSection("unidades", "Top 20 SKU - Unidades", d.topUnidades || []);
      html += _topSection("dinero", "Top 20 SKU - Dinero", d.topDinero || []);
      html += _lineSection("dv-chart-ventas", "Evoluci\xF3n de ventas");
      html += _lineSection("dv-chart-bo-uds", "Evoluci\xF3n del backorder - Unidades");
      html += _lineSection("dv-chart-bo-ars", "Evoluci\xF3n del backorder - Dinero");
      html += _productosSection(d.productos, d.secciones, state.prodQuery);
      html += _coberturaSection(d.cobertura, d.secciones);
      html += _clientesSection(d.clientes, d.secciones);
    }
    _destroyCharts();
    root.innerHTML = html;
    root.querySelectorAll("input[data-vermas-search]").forEach((inp) => {
      const k = inp.getAttribute("data-vermas-search");
      if (k) inp.value = state.verMasQuery[k] || "";
    });
    const interInp = root.querySelector("#dv-interacciones-buscar");
    if (interInp) interInp.value = state.interQuery || "";
    const prodInp = root.querySelector("#dv-productos-buscar");
    if (prodInp) prodInp.value = state.prodQuery || "";
    if (_isOpen() && !state.loading && !state.error && d && !_isEmpty(d)) {
      _loadChartJs().then(() => {
        if (_isOpen() && state.data === d) _drawCharts(d);
      }).catch((e) => {
        console.warn("[dashboard-ventas] Chart.js no disponible:", e);
        root.querySelectorAll(".dv-chart").forEach((el) => {
          el.innerHTML = '<div class="dv-muted">No se pudo cargar el gr\xE1fico. Revis\xE1 la conexi\xF3n.</div>';
        });
      });
    }
  }
  function render() {
    if (!_ensureSkeleton()) return;
    renderFiltros(false);
    _syncAplicarDisabled();
    renderResults();
  }
  function _cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_e) {
      return fallback;
    }
  }
  var CHART_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
  var CHART_GRID_LIGHT = "rgba(0,0,0,.06)";
  var CHART_GRID_DARK = "rgba(255,255,255,.08)";
  function _chartGrid() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return { color: dark ? CHART_GRID_DARK : CHART_GRID_LIGHT };
  }
  function _barChart(canvasId, rows, field, fmt, color) {
    const el = document.getElementById(canvasId);
    if (!el || !window.Chart) return;
    const top = rows.filter((r) => (Number(r[field]) || 0) > 0).slice(0, TOP_N);
    charts[canvasId] = new window.Chart(el, {
      type: "bar",
      data: {
        labels: top.map((r) => String(r.sku)),
        datasets: [
          { data: top.map((r) => Number(r[field]) || 0), backgroundColor: color, borderRadius: 3 }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const r = top[items[0].dataIndex];
                return r ? String(r.sku) + (r.desc ? " - " + String(r.desc) : "") : "";
              },
              label: (item) => fmt(item.raw)
            }
          }
        },
        scales: {
          x: {
            grid: _chartGrid(),
            border: { display: false },
            ticks: {
              font: { family: CHART_FONT },
              callback: (v) => fmt(v),
              maxTicksLimit: 5,
              color: _cssVar("--text-muted", "#64748b")
            }
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              autoSkip: false,
              font: { size: 10, family: CHART_FONT },
              color: _cssVar("--text-secondary", "#334155")
            }
          }
        }
      }
    });
  }
  function _splitBackorder(serie) {
    const real = serie.map((p) => p.valor == null || p.estimado ? null : Number(p.valor));
    const est = serie.map((p) => p.valor == null || !p.estimado ? null : Number(p.valor));
    for (let i = 0; i < serie.length; i++) {
      if (est[i] == null) continue;
      if (i + 1 < serie.length && real[i + 1] != null) est[i + 1] = real[i + 1];
      if (i - 1 >= 0 && real[i - 1] != null && est[i - 1] == null) est[i - 1] = real[i - 1];
    }
    return { real, est, hayEstimado: serie.some((p) => p.estimado && p.valor != null) };
  }
  function _lineChart(canvasId, serie, fmt, color, conEstimado) {
    const el = document.getElementById(canvasId);
    if (!el || !window.Chart) return;
    const labels = serie.map((p) => _labelMes(p.mes));
    const datasets = [];
    if (conEstimado) {
      const s = _splitBackorder(serie);
      datasets.push({
        label: "real",
        data: s.real,
        borderColor: color,
        backgroundColor: color,
        spanGaps: false,
        tension: 0.2,
        pointRadius: 3
      });
      if (s.hayEstimado) {
        datasets.push({
          label: "estimado",
          data: s.est,
          borderColor: color,
          backgroundColor: color,
          borderDash: [6, 4],
          spanGaps: false,
          tension: 0.2,
          pointRadius: 3,
          pointStyle: "rectRot"
        });
      }
    } else {
      datasets.push({
        label: "facturado",
        data: serie.map((p) => p.valor == null ? null : Number(p.valor)),
        borderColor: color,
        backgroundColor: color,
        spanGaps: false,
        tension: 0.2,
        pointRadius: 3
      });
    }
    charts[canvasId] = new window.Chart(el, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: conEstimado && datasets.length > 1 },
          tooltip: { callbacks: { label: (item) => item.dataset.label + ": " + fmt(item.raw) } }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: _chartGrid(),
            border: { display: false },
            ticks: {
              font: { family: CHART_FONT },
              callback: (v) => fmt(v),
              maxTicksLimit: 6,
              color: _cssVar("--text-muted", "#64748b")
            }
          },
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { family: CHART_FONT }, color: _cssVar("--text-muted", "#64748b") }
          }
        }
      }
    });
  }
  function _coberturaChart(rows) {
    const el = document.getElementById("dv-canvas-cobertura");
    if (!el || !window.Chart) return;
    charts["dv-canvas-cobertura"] = new window.Chart(el, {
      type: "bar",
      data: {
        labels: rows.map((r) => [String(r.vendedor), _coberturaEtiqueta(r)]),
        datasets: [
          {
            data: rows.map((r) => r.pct == null ? 0 : Number(r.pct) || 0),
            backgroundColor: "#0284a0",
            borderRadius: 3
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const r = rows[items[0].dataIndex];
                return r ? String(r.vendedor) : "";
              },
              label: (item) => {
                const r = rows[item.dataIndex];
                return r ? _coberturaEtiqueta(r) : "";
              }
            }
          }
        },
        scales: {
          x: {
            min: 0,
            max: 100,
            grid: _chartGrid(),
            border: { display: false },
            ticks: {
              font: { family: CHART_FONT },
              callback: (v) => v + "%",
              maxTicksLimit: 5,
              color: _cssVar("--text-muted", "#64748b")
            }
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              autoSkip: false,
              font: { size: 10, family: CHART_FONT },
              color: _cssVar("--text-secondary", "#334155")
            }
          }
        }
      }
    });
  }
  function _drawCharts(d) {
    _destroyCharts();
    _barChart("dv-chart-top-unidades", d.topUnidades || [], "uds", _fmtUds, "#0284a0");
    _barChart("dv-chart-top-dinero", d.topDinero || [], "ars", _fmtArs, "#16a34a");
    _lineChart("dv-chart-ventas", d.serieVentas || [], _fmtArs, "#1e40af", false);
    _lineChart("dv-chart-bo-uds", d.serieBoUds || [], _fmtUds, "#c2410c", true);
    _lineChart("dv-chart-bo-ars", d.serieBoArs || [], _fmtArs, "#9f1239", true);
    if (Array.isArray(d.cobertura)) _coberturaChart(d.cobertura);
    if (Array.isArray(d.clientes)) {
      const filas = d.clientes.map((c) => ({ sku: c.nombre, desc: c.code, facturado: c.facturado }));
      _barChart("dv-chart-top-clientes", filas, "facturado", _fmtArs, "#7c3aed");
    }
  }
  function _filtrosPayload() {
    return {
      mes: state.mes,
      vendedores: _isVendedor() ? [] : state.sel.vendedores.slice(),
      clientes: state.sel.clientes.slice(),
      provincias: state.sel.provincias.slice(),
      categorias: state.sel.categorias.slice(),
      skus: state.sel.skus.slice()
    };
  }
  async function cargar() {
    const seq = ++state.reqSeq;
    state.loading = true;
    state.error = "";
    render();
    try {
      if (typeof firebase === "undefined" || !firebase.app) throw new Error("firebase no disponible");
      const callable = firebase.app().functions(REGION).httpsCallable("dashboardVentasCF");
      const res = await callable(_filtrosPayload());
      if (seq !== state.reqSeq) return;
      state.data = res && res.data || null;
      if (state.data && state.data.opciones) state.opciones = state.data.opciones;
      state.verMas = { unidades: false, dinero: false };
    } catch (e) {
      if (seq !== state.reqSeq) return;
      console.error("[dashboard-ventas] dashboardVentasCF fallo:", e);
      state.error = _errorMessage();
    } finally {
      if (seq === state.reqSeq) {
        state.loading = false;
        render();
      }
    }
  }
  var _wired = false;
  function _wire() {
    if (_wired) return;
    const body = document.getElementById("dashboard-ventas-body");
    if (!body) return;
    _wired = true;
    body.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const act = t.closest("[data-dv-action]");
      if (act) {
        const a = act.getAttribute("data-dv-action");
        if (a === "aplicar") {
          _readSelFromDom(body);
          cargar();
        } else if (a === "limpiar") {
          state.sel = _selVacia();
          state.mes = _mesActualArt();
          renderFiltros(true);
          cargar();
        }
        return;
      }
      const vm = t.closest("[data-vermas]");
      if (vm) {
        const tipo = _tipoVerMas(vm.getAttribute("data-vermas"));
        state.verMas[tipo] = !state.verMas[tipo];
        renderResults();
        return;
      }
      const clr = t.closest("[data-ms-clear]");
      if (clr) {
        const key = clr.getAttribute("data-ms-clear");
        body.querySelectorAll('input[type="checkbox"][data-filtro="' + key + '"]').forEach((el) => {
          el.checked = false;
        });
        _updateSummary(body, key);
      }
    });
    body.addEventListener("change", (ev) => {
      const t = ev.target;
      if (t instanceof HTMLInputElement && t.type === "checkbox" && t.hasAttribute("data-filtro")) {
        _updateSummary(body, t.getAttribute("data-filtro"));
      }
    });
    body.addEventListener("input", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement)) return;
      const msKey = t.getAttribute("data-ms-search");
      if (msKey) {
        const q = t.value.toLowerCase().trim();
        const det = body.querySelector('details[data-ms="' + msKey + '"]');
        if (!det) return;
        det.querySelectorAll(".dv-ms-opt").forEach((opt) => {
          const s = opt.getAttribute("data-search") || "";
          opt.style.display = !q || s.includes(q) ? "" : "none";
        });
        return;
      }
      if (t.id === "dv-interacciones-buscar") {
        state.interQuery = t.value;
        const g = state.data && state.data.gestion;
        const ti = g && g.tablaInteracciones || { rows: [], total: 0 };
        const cont = body.querySelector("#dv-interacciones .dv-inter-body");
        if (cont) cont.innerHTML = _interaccionesTabla(ti.rows, ti.total, state.interQuery);
        return;
      }
      if (t.id === "dv-productos-buscar") {
        state.prodQuery = t.value;
        const cont = body.querySelector("#dv-productos .dv-prod-body");
        if (cont)
          cont.innerHTML = _productosTabla(state.data && state.data.productos, state.prodQuery);
        return;
      }
      const vmAttr = t.getAttribute("data-vermas-search");
      if (vmAttr) {
        const vmKey = _tipoVerMas(vmAttr);
        state.verMasQuery[vmKey] = t.value;
        const sec = t.closest(".dv-vermas");
        const dd = state.data;
        const rows = dd && (vmKey === "unidades" ? dd.topUnidades : vmKey === "dinero" ? dd.topDinero : dd.clientes) || [];
        if (sec) {
          const tmp = document.createElement("div");
          tmp.innerHTML = _verMasTabla(vmKey, rows);
          const newWrap = tmp.querySelector(".dv-table-wrap");
          const oldWrap = sec.querySelector(".dv-table-wrap");
          if (newWrap && oldWrap) oldWrap.replaceWith(newWrap);
        }
      }
    });
  }
  function _updateSummary(body, key) {
    const det = body.querySelector('details[data-ms="' + key + '"]');
    if (!det) return;
    const checked = Array.from(det.querySelectorAll('input[type="checkbox"]:checked'));
    const sum = det.querySelector("summary");
    if (!sum) return;
    if (checked.length === 0) sum.textContent = "Todos";
    else if (checked.length === 1) {
      const span = checked[0].parentElement && checked[0].parentElement.querySelector("span");
      sum.textContent = span ? span.textContent : checked[0].value;
    } else sum.textContent = checked.length + " seleccionados";
  }
  window.openDashboardVentas = function() {
    const modal = document.getElementById("dashboard-ventas-modal");
    if (!modal) return;
    const role = _role();
    if (role !== "admin" && role !== "gerente" && role !== "vendedor") {
      alert("Tu usuario no tiene acceso al Dashboard de Ventas. Si lo necesit\xE1s, avisale a Mariano.");
      return;
    }
    const uid = _currentUid();
    if (uid !== state.uid) _resetState(uid);
    if (!state.mes) state.mes = _mesActualArt();
    modal.classList.add("open");
    _ensureSkeleton();
    _wire();
    renderFiltros(true);
    _loadChartJs().catch(() => {
    });
    cargar();
  };
  window.closeDashboardVentas = function() {
    const modal = document.getElementById("dashboard-ventas-modal");
    if (modal) modal.classList.remove("open");
    _destroyCharts();
    state.data = null;
    state.loading = false;
    state.reqSeq++;
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI5LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlLCBjbGllbnRlczogZmFsc2UgfSxcbiAgdmVyTWFzUXVlcnk6IHsgdW5pZGFkZXM6ICcnLCBkaW5lcm86ICcnLCBjbGllbnRlczogJycgfSxcbiAgaW50ZXJRdWVyeTogJycsXG4gIHByb2RRdWVyeTogJycsXG4gIHJlcVNlcTogMCxcbn07XG5cbmZ1bmN0aW9uIF9yZXNldFN0YXRlKHVpZCkge1xuICBzdGF0ZS51aWQgPSB1aWQ7XG4gIHN0YXRlLm1lcyA9IF9tZXNBY3R1YWxBcnQoKTtcbiAgc3RhdGUuc2VsID0gX3NlbFZhY2lhKCk7XG4gIHN0YXRlLmRhdGEgPSBudWxsO1xuICBzdGF0ZS5vcGNpb25lcyA9IG51bGw7XG4gIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBudWxsO1xuICBzdGF0ZS5sb2FkaW5nID0gZmFsc2U7XG4gIHN0YXRlLmVycm9yID0gJyc7XG4gIHN0YXRlLnZlck1hcyA9IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlLCBjbGllbnRlczogZmFsc2UgfTtcbiAgc3RhdGUudmVyTWFzUXVlcnkgPSB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJywgY2xpZW50ZXM6ICcnIH07XG4gIHN0YXRlLmludGVyUXVlcnkgPSAnJztcbiAgc3RhdGUucHJvZFF1ZXJ5ID0gJyc7XG4gIHN0YXRlLnJlcVNlcSsrO1xufVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG5jb25zdCBjaGFydHMgPSB7fTtcbmxldCBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEVzY2FwZSBsb2NhbCAobWlzbW8gcmVzdWx0YWRvIHF1ZSB3aW5kb3cuZXNjYXBlSHRtbCk6IGVsIGFuXHUwMEUxbGlzaXMgZGVcbi8vIHNlZ3VyaWRhZCBkZWwgcmVwbyAoQ29kZVFMKSBzb2xvIHJlY29ub2NlIHVuIHNhbml0aXphZG9yIHZpc2libGUgYWNcdTAwRTEuXG5mdW5jdGlvbiBfZXNjSHRtbChzKSB7XG4gIGNvbnN0IHYgPSBzID09IG51bGwgPyAnJyA6IHM7XG4gIHJldHVybiBTdHJpbmcodilcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKVxuICAgIC5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xufVxuXG5mdW5jdGlvbiBfZm10QXJzKG4pIHtcbiAgY29uc3QgdiA9IE51bWJlcihuKSB8fCAwO1xuICByZXR1cm4gJyQnICsgTWF0aC5yb3VuZCh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX2ZtdFVkcyhuKSB7XG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSB8fCAwKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX3JvbGUoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdXNlclJvbGUgIT09ICd1bmRlZmluZWQnID8gdXNlclJvbGUgOiB3aW5kb3cudXNlclJvbGUpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy51c2VyUm9sZSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9teVZlbmRvcigpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKHR5cGVvZiBhc3NpZ25lZFZlbmRvciAhPT0gJ3VuZGVmaW5lZCcgPyBhc3NpZ25lZFZlbmRvciA6IHdpbmRvdy5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgfVxufVxuXG5mdW5jdGlvbiBfY3VycmVudFVpZCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1ID0gdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRVc2VyIDogd2luZG93LmN1cnJlbnRVc2VyO1xuICAgIHJldHVybiAodSAmJiB1LnVpZCkgfHwgbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIudWlkKSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9pc09wZW4oKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgcmV0dXJuICEhKG1vZGFsICYmIG1vZGFsLmNsYXNzTGlzdCAmJiBtb2RhbC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSk7XG59XG5cbmZ1bmN0aW9uIF9pc1ZlbmRlZG9yKCkge1xuICByZXR1cm4gX3JvbGUoKSA9PT0gJ3ZlbmRlZG9yJztcbn1cblxuLyoqIE1lcyBlbiBjdXJzbyBlbiBob3JhIEFyZ2VudGluYSwgZm9ybWF0byBBQUFBLU1NLiAqL1xuZnVuY3Rpb24gX21lc0FjdHVhbEFydCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJ0cyA9IG5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KCdlbi1DQScsIHtcbiAgICAgIHRpbWVab25lOiAnQW1lcmljYS9BcmdlbnRpbmEvQnVlbm9zX0FpcmVzJyxcbiAgICAgIHllYXI6ICdudW1lcmljJyxcbiAgICAgIG1vbnRoOiAnMi1kaWdpdCcsXG4gICAgfSkuZm9ybWF0VG9QYXJ0cyhuZXcgRGF0ZSgpKTtcbiAgICBjb25zdCB5ID0gcGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAneWVhcicpLnZhbHVlO1xuICAgIGNvbnN0IG0gPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICdtb250aCcpLnZhbHVlO1xuICAgIHJldHVybiB5ICsgJy0nICsgbTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbn1cblxuY29uc3QgTUVTRVNfQ09SVE9TID0gW1xuICAnZW5lJyxcbiAgJ2ZlYicsXG4gICdtYXInLFxuICAnYWJyJyxcbiAgJ21heScsXG4gICdqdW4nLFxuICAnanVsJyxcbiAgJ2FnbycsXG4gICdzZXAnLFxuICAnb2N0JyxcbiAgJ25vdicsXG4gICdkaWMnLFxuXTtcbmZ1bmN0aW9uIF9sYWJlbE1lcyhhYWFhbW0pIHtcbiAgY29uc3QgcyA9IFN0cmluZyhhYWFhbW0gfHwgJycpO1xuICBjb25zdCBtID0gTnVtYmVyKHMuc2xpY2UoNSwgNykpO1xuICBpZiAoIW0pIHJldHVybiBzO1xuICByZXR1cm4gTUVTRVNfQ09SVE9TW20gLSAxXSArICcgJyArIHMuc2xpY2UoMiwgNCk7XG59XG5cbmZ1bmN0aW9uIF9lcnJvck1lc3NhZ2UoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgbXYgPSB3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUubWVuc2FqZXNWZW5kZWRvcjtcbiAgICBpZiAobXYgJiYgdHlwZW9mIG12LmZvcm1hdE1lbnNhamVDb25Db2RpZ28gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBtdi5mb3JtYXRNZW5zYWplQ29uQ29kaWdvKCdEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCcpO1xuICAgIH1cbiAgfSBjYXRjaCAoX2UpIHt9XG4gIC8vIEZhbGxiYWNrIFx1MDBBNzY4IHNpIGVsIGJ1bmRsZSBubyBjYXJnXHUwMEYzIChTVyBzdGFsZSkuXG4gIHJldHVybiAoXG4gICAgJ05vIHB1ZGltb3MgY2FyZ2FyIGVsIHRhYmxlcm8gZGUgdmVudGFzLiBWb2x2XHUwMEU5IGEgaW50ZW50YXIgZW4gdW4gbWludXRvOyBzaSBzaWd1ZSBwYXNhbmRvLCBhdmlzYWxlIGEgTWFyaWFuby4nICtcbiAgICAnXFxuXFxuQ1x1MDBGM2RpZ28gdFx1MDBFOWNuaWNvOiBEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCdcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xvYWRDaGFydEpzKCkge1xuICBpZiAod2luZG93LkNoYXJ0KSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHdpbmRvdy5DaGFydCk7XG4gIGlmIChjaGFydEpzUHJvbWlzZSkgcmV0dXJuIGNoYXJ0SnNQcm9taXNlO1xuICBjaGFydEpzUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgcy5zcmMgPSBDSEFSVF9KU19VUkw7XG4gICAgcy5hc3luYyA9IHRydWU7XG4gICAgcy5vbmxvYWQgPSAoKSA9PlxuICAgICAgd2luZG93LkNoYXJ0ID8gcmVzb2x2ZSh3aW5kb3cuQ2hhcnQpIDogcmVqZWN0KG5ldyBFcnJvcignQ2hhcnQuanMgc2luIGdsb2JhbCcpKTtcbiAgICBzLm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgICBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG4gICAgICByZWplY3QobmV3IEVycm9yKCdubyBzZSBwdWRvIGNhcmdhciBDaGFydC5qcycpKTtcbiAgICB9O1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xuICByZXR1cm4gY2hhcnRKc1Byb21pc2U7XG59XG5cbmZ1bmN0aW9uIF9kZXN0cm95Q2hhcnRzKCkge1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoY2hhcnRzKSkge1xuICAgIHRyeSB7XG4gICAgICBjaGFydHNba10uZGVzdHJveSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIGRlbGV0ZSBjaGFydHNba107XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcGNpb25lcyBkZSBmaWx0cm9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERldnVlbHZlIFt7dmFsdWUsbGFiZWx9XSBkZSBsYSBvcGNpXHUwMEYzbiBga2V5YCBkZSBsYSBcdTAwRkFsdGltYSByZXNwdWVzdGEuICovXG5mdW5jdGlvbiBfb3BjaW9uZXNEZShrZXkpIHtcbiAgY29uc3Qgb3AgPSBzdGF0ZS5vcGNpb25lcyB8fCB7fTtcbiAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShvcFtrZXldKSA/IG9wW2tleV0gOiBbXTtcbiAgaWYgKGtleSA9PT0gJ2NsaWVudGVzJykge1xuICAgIHJldHVybiBhcnIubWFwKChjKSA9PiAoe1xuICAgICAgdmFsdWU6IFN0cmluZyhjLmNvZGUpLFxuICAgICAgbGFiZWw6IFN0cmluZyhjLm5hbWUgfHwgYy5jb2RlKSArICcgKCcgKyBTdHJpbmcoYy5jb2RlKSArICcpJyxcbiAgICB9KSk7XG4gIH1cbiAgaWYgKGtleSA9PT0gJ3NrdXMnKSB7XG4gICAgcmV0dXJuIGFyci5tYXAoKHMpID0+ICh7XG4gICAgICB2YWx1ZTogU3RyaW5nKHMuY29kZSksXG4gICAgICBsYWJlbDogU3RyaW5nKHMuY29kZSkgKyAocy5kZXNjID8gJyAtICcgKyBTdHJpbmcocy5kZXNjKSA6ICcnKSxcbiAgICB9KSk7XG4gIH1cbiAgcmV0dXJuIGFyci5tYXAoKHYpID0+ICh7IHZhbHVlOiBTdHJpbmcodiksIGxhYmVsOiBTdHJpbmcodikgfSkpO1xufVxuXG5mdW5jdGlvbiBfcmVzdW1lblNlbChrZXksIG9wY2lvbmVzKSB7XG4gIGNvbnN0IG4gPSBzdGF0ZS5zZWxba2V5XS5sZW5ndGg7XG4gIGlmIChuID09PSAwKSByZXR1cm4gJ1RvZG9zJztcbiAgaWYgKG4gPT09IDEpIHtcbiAgICBjb25zdCBvID0gb3BjaW9uZXMuZmluZCgoeCkgPT4geC52YWx1ZSA9PT0gc3RhdGUuc2VsW2tleV1bMF0pO1xuICAgIHJldHVybiBvID8gby5sYWJlbCA6IHN0YXRlLnNlbFtrZXldWzBdO1xuICB9XG4gIHJldHVybiBuICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuZnVuY3Rpb24gX3JlbmRlckZpbHRybyhkZWYpIHtcbiAgaWYgKGRlZi5rZXkgPT09ICd2ZW5kZWRvcmVzJyAmJiBfaXNWZW5kZWRvcigpKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPicgK1xuICAgICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LW1zLWxvY2tlZFwiIHRpdGxlPVwiVmVzIHNvbG8gdHVzIGNsaWVudGVzXCI+JyArXG4gICAgICBfZXNjSHRtbChfbXlWZW5kb3IoKSB8fCAnVHVzIGNsaWVudGVzJykgK1xuICAgICAgJyBcdUQ4M0RcdUREMTI8L2Rpdj48L2Rpdj4nXG4gICAgKTtcbiAgfVxuICBjb25zdCBvcGNpb25lcyA9IF9vcGNpb25lc0RlKGRlZi5rZXkpO1xuICBjb25zdCBzZWxlY3RlZCA9IG5ldyBTZXQoc3RhdGUuc2VsW2RlZi5rZXldKTtcbiAgbGV0IGxpc3QgPSAnJztcbiAgZm9yIChjb25zdCBvIG9mIG9wY2lvbmVzKSB7XG4gICAgbGlzdCArPVxuICAgICAgJzxsYWJlbCBjbGFzcz1cImR2LW1zLW9wdFwiIGRhdGEtc2VhcmNoPVwiJyArXG4gICAgICBfZXNjSHRtbChvLmxhYmVsLnRvTG93ZXJDYXNlKCkpICtcbiAgICAgICdcIj48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgZGF0YS1maWx0cm89XCInICtcbiAgICAgIGRlZi5rZXkgK1xuICAgICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgICBfZXNjSHRtbChvLnZhbHVlKSArXG4gICAgICAnXCInICtcbiAgICAgIChzZWxlY3RlZC5oYXMoby52YWx1ZSkgPyAnIGNoZWNrZWQnIDogJycpICtcbiAgICAgICc+IDxzcGFuPicgK1xuICAgICAgX2VzY0h0bWwoby5sYWJlbCkgK1xuICAgICAgJzwvc3Bhbj48L2xhYmVsPic7XG4gIH1cbiAgaWYgKCFsaXN0KSBsaXN0ID0gJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiIHN0eWxlPVwicGFkZGluZzo2cHhcIj5TaW4gb3BjaW9uZXMgdG9kYXZcdTAwRURhLjwvZGl2Pic7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+JyArXG4gICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgJzwvZGl2PjxkZXRhaWxzIGNsYXNzPVwiZHYtbXNcIiBkYXRhLW1zPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPjxzdW1tYXJ5PicgK1xuICAgIF9lc2NIdG1sKF9yZXN1bWVuU2VsKGRlZi5rZXksIG9wY2lvbmVzKSkgK1xuICAgICc8L3N1bW1hcnk+PGRpdiBjbGFzcz1cImR2LW1zLXBvcFwiPicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXJcdTIwMjZcIiBkYXRhLW1zLXNlYXJjaD1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWFjdGlvbnNcIj48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLW1zLWNsZWFyPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPkxpbXBpYXI8L2J1dHRvbj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWxpc3RcIj4nICtcbiAgICBsaXN0ICtcbiAgICAnPC9kaXY+PC9kaXY+PC9kZXRhaWxzPjwvZGl2PidcbiAgKTtcbn1cblxuLyoqIExlZSBkZWwgRE9NIGxvIHF1ZSBlbCB1c3VhcmlvIG1hcmNcdTAwRjMuIFNvbG8gc2UgbGxhbWEgYWwgdG9jYXIgXCJBcGxpY2FyXCIuICovXG5mdW5jdGlvbiBfcmVhZFNlbEZyb21Eb20ocm9vdCkge1xuICBjb25zdCBuZXh0ID0gX3NlbFZhY2lhKCk7XG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdW2RhdGEtZmlsdHJvXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpO1xuICAgIGlmIChlbC5jaGVja2VkICYmIG5leHRba2V5XSkgbmV4dFtrZXldLnB1c2goZWwudmFsdWUpO1xuICB9KTtcbiAgaWYgKF9pc1ZlbmRlZG9yKCkpIG5leHQudmVuZGVkb3JlcyA9IFtdO1xuICBzdGF0ZS5zZWwgPSBuZXh0O1xuICBjb25zdCBtZXNFbCA9IHJvb3QucXVlcnlTZWxlY3RvcignI2R2LW1lcycpO1xuICBpZiAobWVzRWwgJiYgL15cXGR7NH0tXFxkezJ9JC8udGVzdChtZXNFbC52YWx1ZSkpIHN0YXRlLm1lcyA9IG1lc0VsLnZhbHVlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBcm1hIGVsIGVzcXVlbGV0byAoZmlsdHJvcyBhcnJpYmEsIHJlc3VsdGFkb3MgYWJham8pIHVuYSBzb2xhIHZlei4gKi9cbmZ1bmN0aW9uIF9lbnN1cmVTa2VsZXRvbigpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm4gbnVsbDtcbiAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcy1ob3N0JykgfHwgIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1yZXN1bHRzJykpIHtcbiAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IGlkPVwiZHYtZmlsdHJvcy1ob3N0XCI+PC9kaXY+PGRpdiBpZD1cImR2LXJlc3VsdHNcIj48L2Rpdj4nO1xuICAgIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBudWxsO1xuICB9XG4gIHJldHVybiBib2R5O1xufVxuXG4vKipcbiAqIFBhbmVsIGRlIGZpbHRyb3MuIFNlIHJlLWFybWEgc29sbyBjdWFuZG8gY2FtYmlhbiBsYXMgb3BjaW9uZXMgKHVuYSB2ZXogcG9yXG4gKiByZXNwdWVzdGEpLCBhbCByZXNldGVhciBwb3IgY2FtYmlvIGRlIHVzdWFyaW8gbyBjb24gXCJMaW1waWFyIGZpbHRyb3NcIi4gTmkgZWxcbiAqIFwiQ2FyZ2FuZG9cdTIwMjZcIiBuaSBcIlZlciBtXHUwMEUxc1wiIGxvIHRvY2FuLCBhc1x1MDBFRCBubyBzZSBwaWVyZGVuIGNhbWJpb3Mgc2luIGFwbGljYXIuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckZpbHRyb3MoZm9yY2UpIHtcbiAgY29uc3QgaG9zdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zLWhvc3QnKTtcbiAgaWYgKCFob3N0KSByZXR1cm47XG4gIGlmICghZm9yY2UgJiYgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9PT0gc3RhdGUub3BjaW9uZXMgJiYgaG9zdC5pbm5lckhUTUwpIHJldHVybjtcbiAgY29uc3QgcHJldiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zJyk7XG4gIGNvbnN0IGFiaWVydG8gPSBwcmV2ID8gISFwcmV2Lm9wZW4gOiB3aW5kb3cuaW5uZXJXaWR0aCA+IDcwMDtcbiAgbGV0IGh0bWwgPSAnPGRldGFpbHMgY2xhc3M9XCJkdi1maWx0cm9zXCIgaWQ9XCJkdi1maWx0cm9zXCInICsgKGFiaWVydG8gPyAnIG9wZW4nIDogJycpICsgJz4nO1xuICBodG1sICs9ICc8c3VtbWFyeT5GaWx0cm9zPC9zdW1tYXJ5PjxkaXYgY2xhc3M9XCJkdi1maWx0cm9zLWdyaWRcIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+TWVzPC9kaXY+PGlucHV0IHR5cGU9XCJtb250aFwiIGlkPVwiZHYtbWVzXCIgY2xhc3M9XCJkdi1pbnB1dFwiIHZhbHVlPVwiJyArXG4gICAgX2VzY0h0bWwoc3RhdGUubWVzKSArXG4gICAgJ1wiPjwvZGl2Pic7XG4gIGZvciAoY29uc3QgZGVmIG9mIEZJTFRST1NfREVGKSBodG1sICs9IF9yZW5kZXJGaWx0cm8oZGVmKTtcbiAgaHRtbCArPSAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LWZpbHRyb3MtYWN0aW9uc1wiPic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1idG4tc2Vjb25kYXJ5XCIgZGF0YS1kdi1hY3Rpb249XCJsaW1waWFyXCI+TGltcGlhciBmaWx0cm9zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtYnRuLXByaW1hcnlcIiBpZD1cImR2LWFwbGljYXJcIiBkYXRhLWR2LWFjdGlvbj1cImFwbGljYXJcIicgK1xuICAgIChzdGF0ZS5sb2FkaW5nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xuICAgICc+QXBsaWNhcjwvYnV0dG9uPic7XG4gIGh0bWwgKz0gJzwvZGl2PjwvZGV0YWlscz4nO1xuICBob3N0LmlubmVySFRNTCA9IGh0bWw7XG4gIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBzdGF0ZS5vcGNpb25lcztcbn1cblxuZnVuY3Rpb24gX3N5bmNBcGxpY2FyRGlzYWJsZWQoKSB7XG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1hcGxpY2FyJyk7XG4gIGlmIChidG4pIGJ0bi5kaXNhYmxlZCA9ICEhc3RhdGUubG9hZGluZztcbn1cblxuZnVuY3Rpb24gX2NhcmQodGl0dWxvLCB2YWxvcikge1xuICByZXR1cm4gKFxuICAgICc8ZGl2IGNsYXNzPVwiZHYtY2FyZFwiPjxkaXYgY2xhc3M9XCJkdi1jYXJkLXRpdGxlXCI+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1jYXJkLXZhbHVlXCI+JyArXG4gICAgX2VzY0h0bWwodmFsb3IpICtcbiAgICAnPC9kaXY+PC9kaXY+J1xuICApO1xufVxuXG4vLyBQb3JjZW50YWplIGNvbiBjb21hIGRlY2ltYWwgKGVzLUFSKTogODAsNSVcbmZ1bmN0aW9uIF9mbXRQY3Qobikge1xuICByZXR1cm4gKFxuICAgIChOdW1iZXIobikgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgbWluaW11bUZyYWN0aW9uRGlnaXRzOiAwLFxuICAgICAgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxLFxuICAgIH0pICsgJyUnXG4gICk7XG59XG5cbi8vIEFBQUEtTU0tREQgLT4gREQvTU0vQUFBQSAoc2kgbm8gdGllbmUgZXNlIGZvcm1hdG8sIHNlIGRldnVlbHZlIHRhbCBjdWFsKVxuZnVuY3Rpb24gX2ZtdEZlY2hhKGYpIHtcbiAgY29uc3QgbSA9IC9eKFxcZHs0fSktKFxcZHsyfSktKFxcZHsyfSkvLmV4ZWMoU3RyaW5nKGYgPT0gbnVsbCA/ICcnIDogZikpO1xuICByZXR1cm4gbSA/IG1bM10gKyAnLycgKyBtWzJdICsgJy8nICsgbVsxXSA6IFN0cmluZyhmID09IG51bGwgPyAnJyA6IGYpO1xufVxuXG5mdW5jdGlvbiBfdGlwb0xhYmVsKHQpIHtcbiAgcmV0dXJuIHQgPT09ICd2aXNpdGEnID8gJ1Zpc2l0YScgOiAnQ29udGFjdG8nO1xufVxuXG4vLyBUYWJsYSBkZSBpbnRlcmFjY2lvbmVzIChzb2xvIGVsIGNvbnRlbmVkb3IgY29uIHNjcm9sbDsgc2UgcmVlbXBsYXphIGFsIGJ1c2NhcikuXG5mdW5jdGlvbiBfaW50ZXJhY2Npb25lc1RhYmxhKHJvd3MsIHRvdGFsLCBxdWVyeSkge1xuICBjb25zdCBxID0gU3RyaW5nKHF1ZXJ5IHx8ICcnKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnRyaW0oKTtcbiAgY29uc3QgbGlzdGEgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IGxpc3RhLmZpbHRlcigocikgPT5cbiAgICAgICAgKFxuICAgICAgICAgIFN0cmluZyhyLmNsaWVudGUpICtcbiAgICAgICAgICAnICcgK1xuICAgICAgICAgIF9mbXRGZWNoYShyLmZlY2hhKSArXG4gICAgICAgICAgJyAnICtcbiAgICAgICAgICBTdHJpbmcoci52ZW5kZWRvcikgK1xuICAgICAgICAgICcgJyArXG4gICAgICAgICAgX3RpcG9MYWJlbChyLnRpcG8pXG4gICAgICAgIClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhxKVxuICAgICAgKVxuICAgIDogbGlzdGE7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXAgZHYtaW50ZXItd3JhcFwiPjx0YWJsZSBjbGFzcz1cImR2LXRhYmxlXCI+PHRoZWFkPjx0cj48dGg+Q2xpZW50ZTwvdGg+PHRoPkZlY2hhPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5UaXBvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgciBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoci5jbGllbnRlKSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChfZm10RmVjaGEoci5mZWNoYSkpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKHIudmVuZGVkb3IpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKF90aXBvTGFiZWwoci50aXBvKSkgK1xuICAgICAgJzwvdGQ+PC90cj4nO1xuICB9XG4gIGlmIChmaWx0ZXJlZC5sZW5ndGggPT09IDApXG4gICAgaHRtbCArPSAnPHRyPjx0ZCBjb2xzcGFuPVwiNFwiIGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gcmVzdWx0YWRvcy48L3RkPjwvdHI+JztcbiAgaHRtbCArPSAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG4gIGNvbnN0IHRvdGFsTiA9IE51bWJlcih0b3RhbCkgfHwgMDtcbiAgaWYgKHRvdGFsTiA+IGxpc3RhLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5Nb3N0cmFuZG8gJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKGxpc3RhLmxlbmd0aCkpICtcbiAgICAgICcgZGUgJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKHRvdGFsTikpICtcbiAgICAgICc8L2Rpdj4nO1xuICB9XG4gIHJldHVybiBodG1sO1xufVxuXG4vKiogVGFibGEgZGUgaW50ZXJhY2Npb25lcyBjb24gYnVzY2Fkb3IuIEVsIHRleHRvIGJ1c2NhZG8gc2UgcG9uZSBwb3IgRE9NLiAqL1xuZnVuY3Rpb24gX2ludGVyYWNjaW9uZXNTZWN0aW9uKHQsIHF1ZXJ5KSB7XG4gIGNvbnN0IHJvd3MgPSAodCAmJiB0LnJvd3MpIHx8IFtdO1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIiBpZD1cImR2LWludGVyYWNjaW9uZXNcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkludGVyYWNjaW9uZXM8L2gzPjwvZGl2PicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgaWQ9XCJkdi1pbnRlcmFjY2lvbmVzLWJ1c2NhclwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIGNsaWVudGUsIHZlbmRlZG9yIG8gdGlwb1x1MjAyNlwiPicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtaW50ZXItYm9keVwiPicgK1xuICAgIF9pbnRlcmFjY2lvbmVzVGFibGEocm93cywgdCAmJiB0LnRvdGFsLCBxdWVyeSkgK1xuICAgICc8L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG4vKiogQmxvcXVlIGRlIGdlc3RpXHUwMEYzbjogdGFyamV0YXMgKyBub3RhICsgdGFibGEgZGUgaW50ZXJhY2Npb25lcy4gKi9cbmZ1bmN0aW9uIF9nZXN0aW9uU2VjdGlvbihnLCBzZWNjaW9uZXMsIHF1ZXJ5KSB7XG4gIGlmICghZyB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5nZXN0aW9uICYmIHNlY2Npb25lcy5nZXN0aW9uLmVycm9yKSkge1xuICAgIHJldHVybiAnPGRpdiBjbGFzcz1cImR2LWNhcmRzXCIgaWQ9XCJkdi1nZXN0aW9uXCI+JyArIF9jYXJkKCdHZXN0aVx1MDBGM24nLCAnTm8gZGlzcG9uaWJsZScpICsgJzwvZGl2Pic7XG4gIH1cbiAgbGV0IGh0bWwgPSAnPGRpdiBjbGFzcz1cImR2LWNhcmRzXCIgaWQ9XCJkdi1nZXN0aW9uXCI+JztcbiAgaHRtbCArPSBfY2FyZCgnVGFyZ2V0JywgZy50YXJnZXQgPT0gbnVsbCA/ICdTaW4gdGFyZ2V0JyA6IF9mbXRBcnMoZy50YXJnZXQpKTtcbiAgaHRtbCArPSBfY2FyZChcbiAgICAnJSBjdW1wbGltaWVudG8nLFxuICAgIGcuY3VtcGxpbWllbnRvUGN0ID09IG51bGwgPyAnU2luIHRhcmdldCcgOiBfZm10UGN0KGcuY3VtcGxpbWllbnRvUGN0KVxuICApO1xuICBodG1sICs9IF9jYXJkKCdSZW5kaWNpb25lcyBcdTIwMTMgbW9udG8nLCBfZm10QXJzKGcucmVuZGljaW9uZXNBcnMpKTtcbiAgaHRtbCArPSBfY2FyZCgnQmFzZSBhY3RpdmEnLCBfZm10VWRzKGcuYmFzZUFjdGl2YSkpO1xuICBodG1sICs9IF9jYXJkKCdUaWNrZXQgcHJvbWVkaW8nLCBfZm10QXJzKGcudGlja2V0UHJvbWVkaW8pKTtcbiAgaHRtbCArPSBfY2FyZCgnTlx1MDBCMCB2aXNpdGFzJywgX2ZtdFVkcyhnLnZpc2l0YXMpKTtcbiAgaHRtbCArPSBfY2FyZCgnTlx1MDBCMCBjb250YWN0YWRvcycsIF9mbXRVZHMoZy5jb250YWN0YWRvcykpO1xuICBodG1sICs9IF9jYXJkKCdOXHUwMEIwIGludGVyYWNjaW9uZXMnLCBfZm10VWRzKGcuaW50ZXJhY2Npb25lcykpO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBpZiAoZy5maWx0cm9zTm9BcGxpY2FuKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1sZXllbmRhIGR2LW11dGVkXCI+VGFyZ2V0IHkgcmVuZGljaW9uZXMgbm8gc2UgZmlsdHJhbiBwb3IgY2xpZW50ZSBuaSBwcm9kdWN0bzsgdmlzaXRhcyB5IGNvbnRhY3RvcyBubyBzZSBmaWx0cmFuIHBvciBwcm9kdWN0by48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gX2ludGVyYWNjaW9uZXNTZWN0aW9uKGcudGFibGFJbnRlcmFjY2lvbmVzLCBxdWVyeSk7XG4gIHJldHVybiBodG1sO1xufVxuXG4vLyBUaXBvcyBwZXJtaXRpZG9zIGRlbCBcIlZlciBtXHUwMEUxc1wiOiBsaXN0YSBibGFuY2EgKGVsIGF0cmlidXRvIGRlbCBET00gbnVuY2Egc2UgcmV1c2EgZW4gZWwgSFRNTCkuXG5mdW5jdGlvbiBfdGlwb1Zlck1hcyh0aXBvSW4pIHtcbiAgcmV0dXJuIHRpcG9JbiA9PT0gJ2RpbmVybycgPyAnZGluZXJvJyA6IHRpcG9JbiA9PT0gJ2NsaWVudGVzJyA/ICdjbGllbnRlcycgOiAndW5pZGFkZXMnO1xufVxuXG5mdW5jdGlvbiBfdmVyTWFzVGFibGEodGlwb0luLCByb3dzKSB7XG4gIGNvbnN0IHRpcG8gPSBfdGlwb1Zlck1hcyh0aXBvSW4pO1xuICBjb25zdCBxID0gc3RhdGUudmVyTWFzUXVlcnlbdGlwb10udG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIGNvbnN0IGVzQ2xpID0gdGlwbyA9PT0gJ2NsaWVudGVzJztcbiAgLy8gUG9zaWNpXHUwMEYzbiBkZWwgcmFua2luZyBjYWxjdWxhZGEgdW5hIHNvbGEgdmV6IChzaW4gaW5kZXhPZiBwb3IgZmlsYSkuXG4gIGNvbnN0IHJhbmtlZCA9IHJvd3MubWFwKChyLCBpKSA9PiAoeyByLCBwb3M6IGkgKyAxIH0pKTtcbiAgY29uc3QgZmlsdGVyZWQgPSBxXG4gICAgPyByYW5rZWQuZmlsdGVyKCh4KSA9PlxuICAgICAgICAoZXNDbGlcbiAgICAgICAgICA/IFN0cmluZyh4LnIubm9tYnJlKSArICcgJyArIFN0cmluZyh4LnIuY29kZSlcbiAgICAgICAgICA6IFN0cmluZyh4LnIuc2t1KSArICcgJyArIFN0cmluZyh4LnIuZGVzYyB8fCAnJylcbiAgICAgICAgKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgLmluY2x1ZGVzKHEpXG4gICAgICApXG4gICAgOiByYW5rZWQ7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LXZlcm1hc1wiPjxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIicgK1xuICAgIChlc0NsaSA/ICdCdXNjYXIgY2xpZW50ZVx1MjAyNicgOiAnQnVzY2FyIFNLVSBvIGRlc2NyaXBjaVx1MDBGM25cdTIwMjYnKSArXG4gICAgJ1wiIGRhdGEtdmVybWFzLXNlYXJjaD1cIicgK1xuICAgIHRpcG8gK1xuICAgICdcIj48ZGl2IGNsYXNzPVwiZHYtdGFibGUtd3JhcFwiPjx0YWJsZSBjbGFzcz1cImR2LXRhYmxlXCI+PHRoZWFkPjx0cj4nICtcbiAgICAoZXNDbGlcbiAgICAgID8gJzx0aD4jPC90aD48dGg+Q2xpZW50ZTwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RmFjdHVyYWRvPC90aD4nXG4gICAgICA6ICc8dGg+IzwvdGg+PHRoPlNLVTwvdGg+PHRoPkRlc2NyaXBjaVx1MDBGM248L3RoPjx0aCBjbGFzcz1cIm51bVwiPlVuaWRhZGVzPC90aD48dGggY2xhc3M9XCJudW1cIj5EaW5lcm88L3RoPicpICtcbiAgICAnPC90cj48L3RoZWFkPjx0Ym9keT4nO1xuICBmb3IgKGNvbnN0IHsgciwgcG9zIH0gb2YgZmlsdGVyZWQpIHtcbiAgICBpZiAoZXNDbGkpIHtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJzx0cj48dGQ+JyArXG4gICAgICAgIHBvcyArXG4gICAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgICAgX2VzY0h0bWwoci5ub21icmUpICtcbiAgICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICAgIF9lc2NIdG1sKF9mbXRBcnMoci5mYWN0dXJhZG8pKSArXG4gICAgICAgICc8L3RkPjwvdHI+JztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBodG1sICs9XG4gICAgICAnPHRyPjx0ZD4nICtcbiAgICAgIHBvcyArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJtb25vXCI+JyArXG4gICAgICBfZXNjSHRtbChyLnNrdSkgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoci5kZXNjKSArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRVZHMoci51ZHMpKSArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRBcnMoci5hcnMpKSArXG4gICAgICAnPC90ZD48L3RyPic7XG4gIH1cbiAgaWYgKGZpbHRlcmVkLmxlbmd0aCA9PT0gMClcbiAgICBodG1sICs9ICc8dHI+PHRkIGNvbHNwYW49XCInICsgKGVzQ2xpID8gMyA6IDUpICsgJ1wiIGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gcmVzdWx0YWRvcy48L3RkPjwvdHI+JztcbiAgaHRtbCArPSAnPC90Ym9keT48L3RhYmxlPjwvZGl2PjwvZGl2Pic7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiBfdG9wU2VjdGlvbih0aXBvLCB0aXR1bG8sIHJvd3MpIHtcbiAgY29uc3QgYWJpZXJ0byA9IHN0YXRlLnZlck1hc1t0aXBvXTtcbiAgY29uc3QgdG90YWwgPSByb3dzLmxlbmd0aDtcbiAgY29uc3QgaCA9IE1hdGgubWF4KDEyMCwgTWF0aC5taW4oVE9QX04sIHRvdGFsKSAqIDIyICsgNDApO1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2gzPicgK1xuICAgICh0b3RhbCA+IDBcbiAgICAgID8gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtbGlua1wiIGRhdGEtdmVybWFzPVwiJyArXG4gICAgICAgIHRpcG8gK1xuICAgICAgICAnXCIgYXJpYS1leHBhbmRlZD1cIicgK1xuICAgICAgICAoYWJpZXJ0byA/ICd0cnVlJyA6ICdmYWxzZScpICtcbiAgICAgICAgJ1wiPicgK1xuICAgICAgICAoYWJpZXJ0byA/ICdWZXIgbWVub3MnIDogJ1ZlciBtXHUwMEUxcycpICtcbiAgICAgICAgJyAoJyArXG4gICAgICAgIHRvdGFsICtcbiAgICAgICAgJyk8L2J1dHRvbj4nXG4gICAgICA6ICcnKSArXG4gICAgJzwvZGl2PicgK1xuICAgICh0b3RhbCA+IDBcbiAgICAgID8gJzxkaXYgY2xhc3M9XCJkdi1jaGFydFwiIHN0eWxlPVwiaGVpZ2h0OicgK1xuICAgICAgICBoICtcbiAgICAgICAgJ3B4XCI+PGNhbnZhcyBpZD1cImR2LWNoYXJ0LXRvcC0nICtcbiAgICAgICAgdGlwbyArXG4gICAgICAgICdcIiByb2xlPVwiaW1nXCIgYXJpYS1sYWJlbD1cIicgK1xuICAgICAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAgICAgJ1wiPjwvY2FudmFzPjwvZGl2PidcbiAgICAgIDogJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiBkYXRvcy48L2Rpdj4nKSArXG4gICAgKGFiaWVydG8gPyBfdmVyTWFzVGFibGEodGlwbywgcm93cykgOiAnJykgK1xuICAgICc8L3NlY3Rpb24+J1xuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFByb2R1Y3RvcywgY29iZXJ0dXJhIHkgZmFjdHVyYWNpXHUwMEYzbiBwb3IgY2xpZW50ZSAoZW50cmVnYSBCKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdG9jayBkZSBsYSBhcHAgcGFyYSB1biBTS1UuIFRvZG8gbnVsbCBzaSBlbCBzdG9jayB0b2Rhdlx1MDBFRGEgbm8gY2FyZ1x1MDBGMyAoXCJcdTIwMjZcIikuICovXG5mdW5jdGlvbiBfc3RvY2tDb2x1bW5hcyhza3UpIHtcbiAgY29uc3QgdmFjaW8gPSB7IHJlc2VydmFkYXM6IG51bGwsIGxpYnJlOiBudWxsLCBzdG9jazogbnVsbCB9O1xuICB0cnkge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJyB8fCB0eXBlb2Ygd2luZG93LmdldFN0b2NrQnJlYWtkb3duICE9PSAnZnVuY3Rpb24nKVxuICAgICAgcmV0dXJuIHZhY2lvO1xuICAgIC8vIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIGRldnVlbHZlIG51bGwgbWllbnRyYXMgZWwgc3RvY2sgbm8gZXN0XHUwMEUxIGNhcmdhZG8uXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmICh3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEoc2t1KSA9PT0gbnVsbCkgcmV0dXJuIHZhY2lvO1xuICAgIH1cbiAgICBjb25zdCBiID0gd2luZG93LmdldFN0b2NrQnJlYWtkb3duKHNrdSk7XG4gICAgaWYgKCFiKSByZXR1cm4gdmFjaW87XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlc2VydmFkYXM6IE51bWJlcihiLnJlc2VydmFkYXNUb3RhbCkgfHwgMCxcbiAgICAgIGxpYnJlOiBOdW1iZXIoYi5saWJyZSkgfHwgMCxcbiAgICAgIHN0b2NrOiBOdW1iZXIoYi5maXNpY29EZXAxMSkgfHwgMCxcbiAgICB9O1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB2YWNpbztcbiAgfVxufVxuXG5mdW5jdGlvbiBfZm10U3RvY2tDb2wobikge1xuICByZXR1cm4gbiA9PSBudWxsID8gJ1x1MjAyNicgOiBfZm10VWRzKG4pO1xufVxuXG4vKiogRXRpcXVldGEgZGUgY29iZXJ0dXJhOiBcIjM2IGRlIDY2IFx1MDBCNyA1NCw1NSVcIiAoY29tYSBkZWNpbWFsKTsgc2luIHBvcmNlbnRhamU6IFwiMzYgZGUgMCBcdTAwQjcgXHUyMDE0XCIuICovXG5mdW5jdGlvbiBfY29iZXJ0dXJhRXRpcXVldGEocikge1xuICBjb25zdCBwY3QgPVxuICAgIHIucGN0ID09IG51bGxcbiAgICAgID8gJ1x1MjAxNCdcbiAgICAgIDogKE51bWJlcihyLnBjdCkgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgICAgIG1pbmltdW1GcmFjdGlvbkRpZ2l0czogMCxcbiAgICAgICAgICBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDIsXG4gICAgICAgIH0pICsgJyUnO1xuICByZXR1cm4gKE51bWJlcihyLmNvbXByYXJvbikgfHwgMCkgKyAnIGRlICcgKyAoTnVtYmVyKHIuZGFkb3NBbHRhKSB8fCAwKSArICcgXHUwMEI3ICcgKyBwY3Q7XG59XG5cbi8qKiBUYWJsYSBkZSBwcm9kdWN0b3MgKHNvbG8gZWwgY29udGVuZWRvciBjb24gc2Nyb2xsOyBzZSByZWVtcGxhemEgYWwgYnVzY2FyKS4gKi9cbmZ1bmN0aW9uIF9wcm9kdWN0b3NUYWJsYShyb3dzLCBxdWVyeSkge1xuICBjb25zdCBxID0gU3RyaW5nKHF1ZXJ5IHx8ICcnKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnRyaW0oKTtcbiAgY29uc3QgbGlzdGEgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IGxpc3RhLmZpbHRlcigocikgPT5cbiAgICAgICAgKFN0cmluZyhyLmNhdGVnb3JpYSkgKyAnICcgKyBTdHJpbmcoci5mYW1pbGlhKSArICcgJyArIFN0cmluZyhyLnNrdSkpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAuaW5jbHVkZXMocSlcbiAgICAgIClcbiAgICA6IGxpc3RhO1xuICBsZXQgaHRtbCA9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwiZHYtdGFibGVcIj48dGhlYWQ+PHRyPjx0aD5DQVRFR09SSUE8L3RoPjx0aD5GQU1JTElBPC90aD48dGg+U0tVPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBWRU5ESURBUzwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RkFDVFVSQURPPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBCQUNLT1JERVI8L3RoPjx0aCBjbGFzcz1cIm51bVwiPlVOSURBREVTIFJFU0VSVkFEQVM8L3RoPjx0aCBjbGFzcz1cIm51bVwiPlVOSURBREVTIExJQlJFIFBBUkEgTEEgVkVOVEE8L3RoPjx0aCBjbGFzcz1cIm51bVwiPlVOSURBREVTIEVOIFNUT0NLPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgciBvZiBmaWx0ZXJlZCkge1xuICAgIGNvbnN0IHN0ID0gX3N0b2NrQ29sdW1uYXMoci5za3UpO1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoci5jYXRlZ29yaWEpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKHIuZmFtaWxpYSkgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibW9ub1wiPicgK1xuICAgICAgX2VzY0h0bWwoci5za3UpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkc1ZlbmRpZGFzKSkgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICBfZXNjSHRtbChfZm10QXJzKHIuZmFjdHVyYWRvKSkgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKHIudWRzQmFja29yZGVyKSkgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICBfZXNjSHRtbChfZm10U3RvY2tDb2woc3QucmVzZXJ2YWRhcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFN0b2NrQ29sKHN0LmxpYnJlKSkgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICBfZXNjSHRtbChfZm10U3RvY2tDb2woc3Quc3RvY2spKSArXG4gICAgICAnPC90ZD48L3RyPic7XG4gIH1cbiAgaWYgKGZpbHRlcmVkLmxlbmd0aCA9PT0gMClcbiAgICBodG1sICs9ICc8dHI+PHRkIGNvbHNwYW49XCI5XCIgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiByZXN1bHRhZG9zLjwvdGQ+PC90cj4nO1xuICBodG1sICs9ICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcbiAgcmV0dXJuIGh0bWw7XG59XG5cbmZ1bmN0aW9uIF9ub0Rpc3BvbmlibGUoaWQsIHRpdHVsbykge1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIiBpZD1cIicgK1xuICAgIGlkICtcbiAgICAnXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz48L2Rpdj48ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5ObyBkaXNwb25pYmxlPC9kaXY+PC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX3Byb2R1Y3Rvc1NlY3Rpb24ocm93cywgc2VjY2lvbmVzLCBxdWVyeSkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkocm93cykgfHwgKHNlY2Npb25lcyAmJiBzZWNjaW9uZXMucHJvZHVjdG9zICYmIHNlY2Npb25lcy5wcm9kdWN0b3MuZXJyb3IpKSB7XG4gICAgcmV0dXJuIF9ub0Rpc3BvbmlibGUoJ2R2LXByb2R1Y3RvcycsICdQcm9kdWN0b3MnKTtcbiAgfVxuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIiBpZD1cImR2LXByb2R1Y3Rvc1wiPjxkaXYgY2xhc3M9XCJkdi1zZWN0aW9uLWhlYWRcIj48aDM+UHJvZHVjdG9zPC9oMz48L2Rpdj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIGlkPVwiZHYtcHJvZHVjdG9zLWJ1c2NhclwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIGNhdGVnb3JcdTAwRURhLCBmYW1pbGlhIG8gU0tVXHUyMDI2XCI+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1wcm9kLWJvZHlcIj4nICtcbiAgICBfcHJvZHVjdG9zVGFibGEocm93cywgcXVlcnkpICtcbiAgICAnPC9kaXY+PC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2NvYmVydHVyYVNlY3Rpb24ocm93cywgc2VjY2lvbmVzKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyb3dzKSB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5jb2JlcnR1cmEgJiYgc2VjY2lvbmVzLmNvYmVydHVyYS5lcnJvcikpIHtcbiAgICByZXR1cm4gX25vRGlzcG9uaWJsZSgnZHYtY29iZXJ0dXJhLWNoYXJ0JywgJ0NvYmVydHVyYSBkZSBjbGllbnRlcycpO1xuICB9XG4gIGNvbnN0IGggPSBNYXRoLm1heCgxMjAsIHJvd3MubGVuZ3RoICogNDQgKyA0MCk7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtY29iZXJ0dXJhLWNoYXJ0XCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz5Db2JlcnR1cmEgZGUgY2xpZW50ZXM8L2gzPjwvZGl2PicgK1xuICAgIChyb3dzLmxlbmd0aCA+IDBcbiAgICAgID8gJzxkaXYgY2xhc3M9XCJkdi1jaGFydFwiIHN0eWxlPVwiaGVpZ2h0OicgK1xuICAgICAgICBoICtcbiAgICAgICAgJ3B4XCI+PGNhbnZhcyBpZD1cImR2LWNhbnZhcy1jb2JlcnR1cmFcIiByb2xlPVwiaW1nXCIgYXJpYS1sYWJlbD1cIkNvYmVydHVyYSBkZSBjbGllbnRlc1wiPjwvY2FudmFzPjwvZGl2PidcbiAgICAgIDogJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiBkYXRvcy48L2Rpdj4nKSArXG4gICAgJzwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9jbGllbnRlc1NlY3Rpb24ocm93cywgc2VjY2lvbmVzKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyb3dzKSB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5jbGllbnRlcyAmJiBzZWNjaW9uZXMuY2xpZW50ZXMuZXJyb3IpKSB7XG4gICAgcmV0dXJuIF9ub0Rpc3BvbmlibGUoJ2R2LWNsaWVudGVzLWNoYXJ0JywgJ0ZhY3R1cmFjaVx1MDBGM24gcG9yIGNsaWVudGUnKTtcbiAgfVxuICBjb25zdCBhYmllcnRvID0gc3RhdGUudmVyTWFzLmNsaWVudGVzO1xuICBjb25zdCB0b3RhbCA9IHJvd3MubGVuZ3RoO1xuICBjb25zdCBoID0gTWF0aC5tYXgoMTIwLCBNYXRoLm1pbihUT1BfTiwgdG90YWwpICogMjIgKyA0MCk7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtY2xpZW50ZXMtY2hhcnRcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkZhY3R1cmFjaVx1MDBGM24gcG9yIGNsaWVudGUgLSBUb3AgMjA8L2gzPicgK1xuICAgICh0b3RhbCA+IDBcbiAgICAgID8gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtbGlua1wiIGRhdGEtdmVybWFzPVwiY2xpZW50ZXNcIiBhcmlhLWV4cGFuZGVkPVwiJyArXG4gICAgICAgIChhYmllcnRvID8gJ3RydWUnIDogJ2ZhbHNlJykgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIChhYmllcnRvID8gJ1ZlciBtZW5vcycgOiAnVmVyIG1cdTAwRTFzJykgK1xuICAgICAgICAnICgnICtcbiAgICAgICAgdG90YWwgK1xuICAgICAgICAnKTwvYnV0dG9uPidcbiAgICAgIDogJycpICtcbiAgICAnPC9kaXY+JyArXG4gICAgKHRvdGFsID4gMFxuICAgICAgPyAnPGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6JyArXG4gICAgICAgIGggK1xuICAgICAgICAncHhcIj48Y2FudmFzIGlkPVwiZHYtY2hhcnQtdG9wLWNsaWVudGVzXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCJGYWN0dXJhY2lcdTAwRjNuIHBvciBjbGllbnRlXCI+PC9jYW52YXM+PC9kaXY+J1xuICAgICAgOiAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGRhdG9zLjwvZGl2PicpICtcbiAgICAoYWJpZXJ0byA/IF92ZXJNYXNUYWJsYSgnY2xpZW50ZXMnLCByb3dzKSA6ICcnKSArXG4gICAgJzwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9saW5lU2VjdGlvbihpZCwgdGl0dWxvKSB7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiPjxkaXYgY2xhc3M9XCJkdi1zZWN0aW9uLWhlYWRcIj48aDM+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvaDM+PC9kaXY+PGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6MjQwcHhcIj48Y2FudmFzIGlkPVwiJyArXG4gICAgaWQgK1xuICAgICdcIiByb2xlPVwiaW1nXCIgYXJpYS1sYWJlbD1cIicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICdcIj48L2NhbnZhcz48L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfaXNFbXB0eShkKSB7XG4gIGlmICghZCkgcmV0dXJuIHRydWU7XG4gIGNvbnN0IGsgPSBkLmtwaXMgfHwge307XG4gIGNvbnN0IGhheUtwaSA9XG4gICAgTnVtYmVyKGsuZmFjdHVyYWRvKSB8fCBOdW1iZXIoay5wZWRpZG9zKSB8fCBOdW1iZXIoay5wZWRpZG9zVW5pY29zKSB8fCBOdW1iZXIoay5iYWNrb3JkZXJBcnMpO1xuICBjb25zdCBoYXlUb3AgPSBBcnJheS5pc0FycmF5KGQudG9wVW5pZGFkZXMpICYmIGQudG9wVW5pZGFkZXMubGVuZ3RoID4gMDtcbiAgY29uc3QgaGF5U2VyaWUgPSBBcnJheS5pc0FycmF5KGQuc2VyaWVWZW50YXMpICYmIGQuc2VyaWVWZW50YXMuc29tZSgocCkgPT4gTnVtYmVyKHAudmFsb3IpKTtcbiAgcmV0dXJuICFoYXlLcGkgJiYgIWhheVRvcCAmJiAhaGF5U2VyaWU7XG59XG5cbi8qKiBSZXN1bHRhZG9zIChsZXllbmRhLCB0YXJqZXRhcywgcmFua2luZ3MsIGdyXHUwMEUxZmljb3MpLiBObyB0b2NhIGxvcyBmaWx0cm9zLiAqL1xuZnVuY3Rpb24gcmVuZGVyUmVzdWx0cygpIHtcbiAgY29uc3Qgcm9vdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1yZXN1bHRzJyk7XG4gIGlmICghcm9vdCkgcmV0dXJuO1xuICBjb25zdCBkID0gc3RhdGUuZGF0YTtcblxuICBsZXQgaHRtbCA9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi1sZXllbmRhXCI+TW9udG9zIHNpbiBJVkEsIGNvbiBkZXNjdWVudG8gYXBsaWNhZG8geSBub3RhcyBkZSBjclx1MDBFOWRpdG8gcmVzdGFkYXMuJztcbiAgaWYgKGQgJiYgZC5kYXRhVXBkYXRlZEF0ICYmICFzdGF0ZS5sb2FkaW5nKSB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKGQuZGF0YVVwZGF0ZWRBdCk7XG4gICAgaWYgKCFOdW1iZXIuaXNOYU4odC5nZXRUaW1lKCkpKSB7XG4gICAgICBodG1sICs9XG4gICAgICAgICcgPHNwYW4gY2xhc3M9XCJkdi1tdXRlZFwiPlx1MDBCNyBDYWxjdWxhZG8gJyArXG4gICAgICAgIF9lc2NIdG1sKHQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KSkgK1xuICAgICAgICAnPC9zcGFuPic7XG4gICAgfVxuICB9XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgaWYgKHN0YXRlLmxvYWRpbmcpIHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZHYtZXN0YWRvXCI+Q2FyZ2FuZG9cdTIwMjY8L2Rpdj4nO1xuICB9IGVsc2UgaWYgKHN0YXRlLmVycm9yKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG8gZHYtZXJyb3JcIj4nICsgX2VzY0h0bWwoc3RhdGUuZXJyb3IpLnJlcGxhY2UoL1xcbi9nLCAnPGJyPicpICsgJzwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoZCAmJiBfaXNFbXB0eShkKSkge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5ObyBoYXkgdmVudGFzIGNvbiBlc29zIGZpbHRyb3MuPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkKSB7XG4gICAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZHYtY2FyZHNcIj4nO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0ZhY3R1cmFkbyBtZW5zdWFsJywgX2ZtdEFycyhrLmZhY3R1cmFkbykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ1ZhbG9yaXphY2lcdTAwRjNuIGJhY2tvcmRlcicsIF9mbXRBcnMoay5iYWNrb3JkZXJBcnMpKTtcbiAgICBodG1sICs9IF9jYXJkKCdDYW50LiBkZSBwZWRpZG9zIGRlbCBtZXMnLCBfZm10VWRzKGsucGVkaWRvcykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIHBlZGlkb3MgXHUwMEZBbmljb3MnLCBfZm10VWRzKGsucGVkaWRvc1VuaWNvcykpO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gICAgaHRtbCArPSBfZ2VzdGlvblNlY3Rpb24oZC5nZXN0aW9uLCBkLnNlY2Npb25lcywgc3RhdGUuaW50ZXJRdWVyeSk7XG4gICAgaHRtbCArPSBfdG9wU2VjdGlvbigndW5pZGFkZXMnLCAnVG9wIDIwIFNLVSAtIFVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSk7XG4gICAgaHRtbCArPSBfdG9wU2VjdGlvbignZGluZXJvJywgJ1RvcCAyMCBTS1UgLSBEaW5lcm8nLCBkLnRvcERpbmVybyB8fCBbXSk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LXZlbnRhcycsICdFdm9sdWNpXHUwMEYzbiBkZSB2ZW50YXMnKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtYm8tdWRzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrb3JkZXIgLSBVbmlkYWRlcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby1hcnMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIERpbmVybycpO1xuICAgIGh0bWwgKz0gX3Byb2R1Y3Rvc1NlY3Rpb24oZC5wcm9kdWN0b3MsIGQuc2VjY2lvbmVzLCBzdGF0ZS5wcm9kUXVlcnkpO1xuICAgIGh0bWwgKz0gX2NvYmVydHVyYVNlY3Rpb24oZC5jb2JlcnR1cmEsIGQuc2VjY2lvbmVzKTtcbiAgICBodG1sICs9IF9jbGllbnRlc1NlY3Rpb24oZC5jbGllbnRlcywgZC5zZWNjaW9uZXMpO1xuICB9XG5cbiAgX2Rlc3Ryb3lDaGFydHMoKTtcbiAgcm9vdC5pbm5lckhUTUwgPSBodG1sO1xuICAvLyBFbCB0ZXh0byBkZWwgYnVzY2Fkb3IgZGUgXCJWZXIgbVx1MDBFMXNcIiBzZSBwb25lIHBvciBET00sIG51bmNhIGRlbnRybyBkZWwgSFRNTC5cbiAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFtkYXRhLXZlcm1hcy1zZWFyY2hdJykuZm9yRWFjaCgoaW5wKSA9PiB7XG4gICAgY29uc3QgayA9IGlucC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdmVybWFzLXNlYXJjaCcpO1xuICAgIGlmIChrKSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR9ICovIChpbnApLnZhbHVlID0gc3RhdGUudmVyTWFzUXVlcnlba10gfHwgJyc7XG4gIH0pO1xuXG4gIGNvbnN0IGludGVySW5wID0gcm9vdC5xdWVyeVNlbGVjdG9yKCcjZHYtaW50ZXJhY2Npb25lcy1idXNjYXInKTtcbiAgaWYgKGludGVySW5wKSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR9ICovIChpbnRlcklucCkudmFsdWUgPSBzdGF0ZS5pbnRlclF1ZXJ5IHx8ICcnO1xuICBjb25zdCBwcm9kSW5wID0gcm9vdC5xdWVyeVNlbGVjdG9yKCcjZHYtcHJvZHVjdG9zLWJ1c2NhcicpO1xuICBpZiAocHJvZElucCkgLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAocHJvZElucCkudmFsdWUgPSBzdGF0ZS5wcm9kUXVlcnkgfHwgJyc7XG5cbiAgLy8gU2luIG1vZGFsIGFiaWVydG8gbm8gc2UgZGlidWphIChyZXNwdWVzdGEgcXVlIGxsZWdcdTAwRjMgZGVzcHVcdTAwRTlzIGRlIGNlcnJhcikuXG4gIGlmIChfaXNPcGVuKCkgJiYgIXN0YXRlLmxvYWRpbmcgJiYgIXN0YXRlLmVycm9yICYmIGQgJiYgIV9pc0VtcHR5KGQpKSB7XG4gICAgX2xvYWRDaGFydEpzKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKF9pc09wZW4oKSAmJiBzdGF0ZS5kYXRhID09PSBkKSBfZHJhd0NoYXJ0cyhkKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBpZiAoIV9lbnN1cmVTa2VsZXRvbigpKSByZXR1cm47XG4gIHJlbmRlckZpbHRyb3MoZmFsc2UpO1xuICBfc3luY0FwbGljYXJEaXNhYmxlZCgpO1xuICByZW5kZXJSZXN1bHRzKCk7XG59XG5cbmZ1bmN0aW9uIF9jc3NWYXIobmFtZSwgZmFsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB2ID0gZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmdldFByb3BlcnR5VmFsdWUobmFtZSkudHJpbSgpO1xuICAgIHJldHVybiB2IHx8IGZhbGxiYWNrO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5jb25zdCBDSEFSVF9GT05UID1cbiAgXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTRiBQcm8gVGV4dCcsICdTZWdvZSBVSScsIHN5c3RlbS11aSwgc2Fucy1zZXJpZlwiO1xuY29uc3QgQ0hBUlRfR1JJRF9MSUdIVCA9ICdyZ2JhKDAsMCwwLC4wNiknO1xuY29uc3QgQ0hBUlRfR1JJRF9EQVJLID0gJ3JnYmEoMjU1LDI1NSwyNTUsLjA4KSc7XG5cbi8qKiBHcmlsbGEgc3VhdmU7IGVuIHRlbWEgb3NjdXJvIHVzYSBibGFuY28gdHJhbnNsXHUwMEZBY2lkbyBwYXJhIHF1ZSBzZSB2ZWEuICovXG5mdW5jdGlvbiBfY2hhcnRHcmlkKCkge1xuICBjb25zdCBkYXJrID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmdldEF0dHJpYnV0ZSgnZGF0YS10aGVtZScpID09PSAnZGFyayc7XG4gIHJldHVybiB7IGNvbG9yOiBkYXJrID8gQ0hBUlRfR1JJRF9EQVJLIDogQ0hBUlRfR1JJRF9MSUdIVCB9O1xufVxuXG5mdW5jdGlvbiBfYmFyQ2hhcnQoY2FudmFzSWQsIHJvd3MsIGZpZWxkLCBmbXQsIGNvbG9yKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgLy8gU3BlYzogU0tVcyBjb24gbmV0byA8PSAwIG5vIGVudHJhbiBhbCBUb3AgKGxhIHRhYmxhIFwiVmVyIG1cdTAwRTFzXCIgc1x1MDBFRCBsb3MgbXVlc3RyYSkuXG4gIGNvbnN0IHRvcCA9IHJvd3MuZmlsdGVyKChyKSA9PiAoTnVtYmVyKHJbZmllbGRdKSB8fCAwKSA+IDApLnNsaWNlKDAsIFRPUF9OKTtcbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnYmFyJyxcbiAgICBkYXRhOiB7XG4gICAgICBsYWJlbHM6IHRvcC5tYXAoKHIpID0+IFN0cmluZyhyLnNrdSkpLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAgeyBkYXRhOiB0b3AubWFwKChyKSA9PiBOdW1iZXIocltmaWVsZF0pIHx8IDApLCBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLCBib3JkZXJSYWRpdXM6IDMgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBpbmRleEF4aXM6ICd5JyxcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICB0b29sdGlwOiB7XG4gICAgICAgICAgY2FsbGJhY2tzOiB7XG4gICAgICAgICAgICB0aXRsZTogKGl0ZW1zKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSB0b3BbaXRlbXNbMF0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBTdHJpbmcoci5za3UpICsgKHIuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHIuZGVzYykgOiAnJykgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogKGl0ZW0pID0+IGZtdChpdGVtLnJhdyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeDoge1xuICAgICAgICAgIGdyaWQ6IF9jaGFydEdyaWQoKSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgZm9udDogeyBmYW1pbHk6IENIQVJUX0ZPTlQgfSxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHk6IHtcbiAgICAgICAgICBncmlkOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAsIGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1zZWNvbmRhcnknLCAnIzMzNDE1NScpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG4vKipcbiAqIFNlcmllIGRlIGJhY2sgb3JkZXIgZW4gMiBkYXRhc2V0czogcmVhbCAobFx1MDBFRG5lYSBsbGVuYSkgeSBlc3RpbWFkbyAocHVudGVhZGEpLlxuICogVW4gcHVudG8gZXN0aW1hZG8gc2UgY29uZWN0YSBjb24gc3UgdmVjaW5vIHJlYWwgcGFyYSBxdWUgbGEgY3VydmEgbm8gcXVlZGVcbiAqIGNvcnRhZGEgZW4gbGEgdHJhbnNpY2lcdTAwRjNuOyBgbnVsbGAgKHNpbiBkYXRvcykgY29ydGEgbGEgbFx1MDBFRG5lYSAoc3BhbkdhcHM6ZmFsc2UpLlxuICovXG5mdW5jdGlvbiBfc3BsaXRCYWNrb3JkZXIoc2VyaWUpIHtcbiAgY29uc3QgcmVhbCA9IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCB8fCBwLmVzdGltYWRvID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpO1xuICBjb25zdCBlc3QgPSBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgfHwgIXAuZXN0aW1hZG8gPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VyaWUubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZXN0W2ldID09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChpICsgMSA8IHNlcmllLmxlbmd0aCAmJiByZWFsW2kgKyAxXSAhPSBudWxsKSBlc3RbaSArIDFdID0gcmVhbFtpICsgMV07XG4gICAgaWYgKGkgLSAxID49IDAgJiYgcmVhbFtpIC0gMV0gIT0gbnVsbCAmJiBlc3RbaSAtIDFdID09IG51bGwpIGVzdFtpIC0gMV0gPSByZWFsW2kgLSAxXTtcbiAgfVxuICByZXR1cm4geyByZWFsLCBlc3QsIGhheUVzdGltYWRvOiBzZXJpZS5zb21lKChwKSA9PiBwLmVzdGltYWRvICYmIHAudmFsb3IgIT0gbnVsbCkgfTtcbn1cblxuZnVuY3Rpb24gX2xpbmVDaGFydChjYW52YXNJZCwgc2VyaWUsIGZtdCwgY29sb3IsIGNvbkVzdGltYWRvKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgY29uc3QgbGFiZWxzID0gc2VyaWUubWFwKChwKSA9PiBfbGFiZWxNZXMocC5tZXMpKTtcbiAgY29uc3QgZGF0YXNldHMgPSBbXTtcbiAgaWYgKGNvbkVzdGltYWRvKSB7XG4gICAgY29uc3QgcyA9IF9zcGxpdEJhY2tvcmRlcihzZXJpZSk7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ3JlYWwnLFxuICAgICAgZGF0YTogcy5yZWFsLFxuICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgIHRlbnNpb246IDAuMixcbiAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgIH0pO1xuICAgIGlmIChzLmhheUVzdGltYWRvKSB7XG4gICAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgICAgbGFiZWw6ICdlc3RpbWFkbycsXG4gICAgICAgIGRhdGE6IHMuZXN0LFxuICAgICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICAgIGJvcmRlckRhc2g6IFs2LCA0XSxcbiAgICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgICAgICBwb2ludFN0eWxlOiAncmVjdFJvdCcsXG4gICAgICB9KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ2ZhY3R1cmFkbycsXG4gICAgICBkYXRhOiBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSksXG4gICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgfSk7XG4gIH1cbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnbGluZScsXG4gICAgZGF0YTogeyBsYWJlbHMsIGRhdGFzZXRzIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgcmVzcG9uc2l2ZTogdHJ1ZSxcbiAgICAgIG1haW50YWluQXNwZWN0UmF0aW86IGZhbHNlLFxuICAgICAgYW5pbWF0aW9uOiBmYWxzZSxcbiAgICAgIHBsdWdpbnM6IHtcbiAgICAgICAgbGVnZW5kOiB7IGRpc3BsYXk6IGNvbkVzdGltYWRvICYmIGRhdGFzZXRzLmxlbmd0aCA+IDEgfSxcbiAgICAgICAgdG9vbHRpcDogeyBjYWxsYmFja3M6IHsgbGFiZWw6IChpdGVtKSA9PiBpdGVtLmRhdGFzZXQubGFiZWwgKyAnOiAnICsgZm10KGl0ZW0ucmF3KSB9IH0sXG4gICAgICB9LFxuICAgICAgc2NhbGVzOiB7XG4gICAgICAgIHk6IHtcbiAgICAgICAgICBiZWdpbkF0WmVybzogdHJ1ZSxcbiAgICAgICAgICBncmlkOiBfY2hhcnRHcmlkKCksXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGZvbnQ6IHsgZmFtaWx5OiBDSEFSVF9GT05UIH0sXG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IGZtdCh2KSxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDYsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB4OiB7XG4gICAgICAgICAgZ3JpZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIGJvcmRlcjogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIHRpY2tzOiB7IGZvbnQ6IHsgZmFtaWx5OiBDSEFSVF9GT05UIH0sIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG4vKiogQmFycmFzIGhvcml6b250YWxlcyBkZSBjb2JlcnR1cmE6IHVuYSBwb3IgdmVuZGVkb3IsIDAtMTAwJS4gKi9cbmZ1bmN0aW9uIF9jb2JlcnR1cmFDaGFydChyb3dzKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWNhbnZhcy1jb2JlcnR1cmEnKTtcbiAgaWYgKCFlbCB8fCAhd2luZG93LkNoYXJ0KSByZXR1cm47XG4gIGNoYXJ0c1snZHYtY2FudmFzLWNvYmVydHVyYSddID0gbmV3IHdpbmRvdy5DaGFydChlbCwge1xuICAgIHR5cGU6ICdiYXInLFxuICAgIGRhdGE6IHtcbiAgICAgIGxhYmVsczogcm93cy5tYXAoKHIpID0+IFtTdHJpbmcoci52ZW5kZWRvciksIF9jb2JlcnR1cmFFdGlxdWV0YShyKV0pLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGRhdGE6IHJvd3MubWFwKChyKSA9PiAoci5wY3QgPT0gbnVsbCA/IDAgOiBOdW1iZXIoci5wY3QpIHx8IDApKSxcbiAgICAgICAgICBiYWNrZ3JvdW5kQ29sb3I6ICcjMDI4NGEwJyxcbiAgICAgICAgICBib3JkZXJSYWRpdXM6IDMsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgaW5kZXhBeGlzOiAneScsXG4gICAgICByZXNwb25zaXZlOiB0cnVlLFxuICAgICAgbWFpbnRhaW5Bc3BlY3RSYXRpbzogZmFsc2UsXG4gICAgICBhbmltYXRpb246IGZhbHNlLFxuICAgICAgcGx1Z2luczoge1xuICAgICAgICBsZWdlbmQ6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgdG9vbHRpcDoge1xuICAgICAgICAgIGNhbGxiYWNrczoge1xuICAgICAgICAgICAgdGl0bGU6IChpdGVtcykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCByID0gcm93c1tpdGVtc1swXS5kYXRhSW5kZXhdO1xuICAgICAgICAgICAgICByZXR1cm4gciA/IFN0cmluZyhyLnZlbmRlZG9yKSA6ICcnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxhYmVsOiAoaXRlbSkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCByID0gcm93c1tpdGVtLmRhdGFJbmRleF07XG4gICAgICAgICAgICAgIHJldHVybiByID8gX2NvYmVydHVyYUV0aXF1ZXRhKHIpIDogJyc7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc2NhbGVzOiB7XG4gICAgICAgIHg6IHtcbiAgICAgICAgICBtaW46IDAsXG4gICAgICAgICAgbWF4OiAxMDAsXG4gICAgICAgICAgZ3JpZDogX2NoYXJ0R3JpZCgpLFxuICAgICAgICAgIGJvcmRlcjogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBmb250OiB7IGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY2FsbGJhY2s6ICh2KSA9PiB2ICsgJyUnLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHk6IHtcbiAgICAgICAgICBncmlkOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAsIGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1zZWNvbmRhcnknLCAnIzMzNDE1NScpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBfZHJhd0NoYXJ0cyhkKSB7XG4gIC8vIFB1ZWRlIHF1ZSBlbCB1c3VhcmlvIGhheWEgcmUtcmVuZGVyaXphZG8gbWllbnRyYXMgY2FyZ2FiYSBDaGFydC5qcy5cbiAgX2Rlc3Ryb3lDaGFydHMoKTtcbiAgX2JhckNoYXJ0KCdkdi1jaGFydC10b3AtdW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdLCAndWRzJywgX2ZtdFVkcywgJyMwMjg0YTAnKTtcbiAgX2JhckNoYXJ0KCdkdi1jaGFydC10b3AtZGluZXJvJywgZC50b3BEaW5lcm8gfHwgW10sICdhcnMnLCBfZm10QXJzLCAnIzE2YTM0YScpO1xuICBfbGluZUNoYXJ0KCdkdi1jaGFydC12ZW50YXMnLCBkLnNlcmllVmVudGFzIHx8IFtdLCBfZm10QXJzLCAnIzFlNDBhZicsIGZhbHNlKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtYm8tdWRzJywgZC5zZXJpZUJvVWRzIHx8IFtdLCBfZm10VWRzLCAnI2MyNDEwYycsIHRydWUpO1xuICBfbGluZUNoYXJ0KCdkdi1jaGFydC1iby1hcnMnLCBkLnNlcmllQm9BcnMgfHwgW10sIF9mbXRBcnMsICcjOWYxMjM5JywgdHJ1ZSk7XG4gIGlmIChBcnJheS5pc0FycmF5KGQuY29iZXJ0dXJhKSkgX2NvYmVydHVyYUNoYXJ0KGQuY29iZXJ0dXJhKTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoZC5jbGllbnRlcykpIHtcbiAgICAvLyBfYmFyQ2hhcnQgdXNhIHNrdS9kZXNjOiBzZSBhZGFwdGFuIG5vbWJyZSB5IGNcdTAwRjNkaWdvIGRlbCBjbGllbnRlLlxuICAgIGNvbnN0IGZpbGFzID0gZC5jbGllbnRlcy5tYXAoKGMpID0+ICh7IHNrdTogYy5ub21icmUsIGRlc2M6IGMuY29kZSwgZmFjdHVyYWRvOiBjLmZhY3R1cmFkbyB9KSk7XG4gICAgX2JhckNoYXJ0KCdkdi1jaGFydC10b3AtY2xpZW50ZXMnLCBmaWxhcywgJ2ZhY3R1cmFkbycsIF9mbXRBcnMsICcjN2MzYWVkJyk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEYXRvc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF9maWx0cm9zUGF5bG9hZCgpIHtcbiAgcmV0dXJuIHtcbiAgICBtZXM6IHN0YXRlLm1lcyxcbiAgICB2ZW5kZWRvcmVzOiBfaXNWZW5kZWRvcigpID8gW10gOiBzdGF0ZS5zZWwudmVuZGVkb3Jlcy5zbGljZSgpLFxuICAgIGNsaWVudGVzOiBzdGF0ZS5zZWwuY2xpZW50ZXMuc2xpY2UoKSxcbiAgICBwcm92aW5jaWFzOiBzdGF0ZS5zZWwucHJvdmluY2lhcy5zbGljZSgpLFxuICAgIGNhdGVnb3JpYXM6IHN0YXRlLnNlbC5jYXRlZ29yaWFzLnNsaWNlKCksXG4gICAgc2t1czogc3RhdGUuc2VsLnNrdXMuc2xpY2UoKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2FyZ2FyKCkge1xuICBjb25zdCBzZXEgPSArK3N0YXRlLnJlcVNlcTtcbiAgc3RhdGUubG9hZGluZyA9IHRydWU7XG4gIHN0YXRlLmVycm9yID0gJyc7XG4gIHJlbmRlcigpO1xuICB0cnkge1xuICAgIGlmICh0eXBlb2YgZmlyZWJhc2UgPT09ICd1bmRlZmluZWQnIHx8ICFmaXJlYmFzZS5hcHApIHRocm93IG5ldyBFcnJvcignZmlyZWJhc2Ugbm8gZGlzcG9uaWJsZScpO1xuICAgIGNvbnN0IGNhbGxhYmxlID0gZmlyZWJhc2UuYXBwKCkuZnVuY3Rpb25zKFJFR0lPTikuaHR0cHNDYWxsYWJsZSgnZGFzaGJvYXJkVmVudGFzQ0YnKTtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBjYWxsYWJsZShfZmlsdHJvc1BheWxvYWQoKSk7XG4gICAgaWYgKHNlcSAhPT0gc3RhdGUucmVxU2VxKSByZXR1cm47XG4gICAgc3RhdGUuZGF0YSA9IChyZXMgJiYgcmVzLmRhdGEpIHx8IG51bGw7XG4gICAgaWYgKHN0YXRlLmRhdGEgJiYgc3RhdGUuZGF0YS5vcGNpb25lcykgc3RhdGUub3BjaW9uZXMgPSBzdGF0ZS5kYXRhLm9wY2lvbmVzO1xuICAgIHN0YXRlLnZlck1hcyA9IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlIH07XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoc2VxICE9PSBzdGF0ZS5yZXFTZXEpIHJldHVybjtcbiAgICBjb25zb2xlLmVycm9yKCdbZGFzaGJvYXJkLXZlbnRhc10gZGFzaGJvYXJkVmVudGFzQ0YgZmFsbG86JywgZSk7XG4gICAgc3RhdGUuZXJyb3IgPSBfZXJyb3JNZXNzYWdlKCk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKHNlcSA9PT0gc3RhdGUucmVxU2VxKSB7XG4gICAgICBzdGF0ZS5sb2FkaW5nID0gZmFsc2U7XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFdmVudG9zIChkZWxlZ2Fkb3Mgc29icmUgZWwgYm9keSBkZWwgbW9kYWwpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxubGV0IF93aXJlZCA9IGZhbHNlO1xuZnVuY3Rpb24gX3dpcmUoKSB7XG4gIGlmIChfd2lyZWQpIHJldHVybjtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm47XG4gIF93aXJlZCA9IHRydWU7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChldikgPT4ge1xuICAgIGNvbnN0IHQgPSBldi50YXJnZXQ7XG4gICAgaWYgKCEodCBpbnN0YW5jZW9mIEVsZW1lbnQpKSByZXR1cm47XG4gICAgY29uc3QgYWN0ID0gdC5jbG9zZXN0KCdbZGF0YS1kdi1hY3Rpb25dJyk7XG4gICAgaWYgKGFjdCkge1xuICAgICAgY29uc3QgYSA9IGFjdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtZHYtYWN0aW9uJyk7XG4gICAgICBpZiAoYSA9PT0gJ2FwbGljYXInKSB7XG4gICAgICAgIF9yZWFkU2VsRnJvbURvbShib2R5KTtcbiAgICAgICAgY2FyZ2FyKCk7XG4gICAgICB9IGVsc2UgaWYgKGEgPT09ICdsaW1waWFyJykge1xuICAgICAgICBzdGF0ZS5zZWwgPSBfc2VsVmFjaWEoKTtcbiAgICAgICAgc3RhdGUubWVzID0gX21lc0FjdHVhbEFydCgpO1xuICAgICAgICByZW5kZXJGaWx0cm9zKHRydWUpO1xuICAgICAgICBjYXJnYXIoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgdm0gPSB0LmNsb3Nlc3QoJ1tkYXRhLXZlcm1hc10nKTtcbiAgICBpZiAodm0pIHtcbiAgICAgIGNvbnN0IHRpcG8gPSBfdGlwb1Zlck1hcyh2bS5nZXRBdHRyaWJ1dGUoJ2RhdGEtdmVybWFzJykpO1xuICAgICAgc3RhdGUudmVyTWFzW3RpcG9dID0gIXN0YXRlLnZlck1hc1t0aXBvXTtcbiAgICAgIC8vIFNvbG8gcmVzdWx0YWRvczogbm8gc2UgbGVlbiBuaSBzZSBwaXNhbiBmaWx0cm9zIHNpbiBhcGxpY2FyLlxuICAgICAgcmVuZGVyUmVzdWx0cygpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjbHIgPSB0LmNsb3Nlc3QoJ1tkYXRhLW1zLWNsZWFyXScpO1xuICAgIGlmIChjbHIpIHtcbiAgICAgIGNvbnN0IGtleSA9IGNsci5nZXRBdHRyaWJ1dGUoJ2RhdGEtbXMtY2xlYXInKTtcbiAgICAgIGJvZHkucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdW2RhdGEtZmlsdHJvPVwiJyArIGtleSArICdcIl0nKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICBlbC5jaGVja2VkID0gZmFsc2U7XG4gICAgICB9KTtcbiAgICAgIF91cGRhdGVTdW1tYXJ5KGJvZHksIGtleSk7XG4gICAgfVxuICB9KTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIChldikgPT4ge1xuICAgIGNvbnN0IHQgPSBldi50YXJnZXQ7XG4gICAgaWYgKHQgaW5zdGFuY2VvZiBIVE1MSW5wdXRFbGVtZW50ICYmIHQudHlwZSA9PT0gJ2NoZWNrYm94JyAmJiB0Lmhhc0F0dHJpYnV0ZSgnZGF0YS1maWx0cm8nKSkge1xuICAgICAgX3VwZGF0ZVN1bW1hcnkoYm9keSwgdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJykpO1xuICAgIH1cbiAgfSk7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdpbnB1dCcsIChldikgPT4ge1xuICAgIGNvbnN0IHQgPSBldi50YXJnZXQ7XG4gICAgaWYgKCEodCBpbnN0YW5jZW9mIEhUTUxJbnB1dEVsZW1lbnQpKSByZXR1cm47XG4gICAgY29uc3QgbXNLZXkgPSB0LmdldEF0dHJpYnV0ZSgnZGF0YS1tcy1zZWFyY2gnKTtcbiAgICBpZiAobXNLZXkpIHtcbiAgICAgIGNvbnN0IHEgPSB0LnZhbHVlLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuICAgICAgY29uc3QgZGV0ID0gYm9keS5xdWVyeVNlbGVjdG9yKCdkZXRhaWxzW2RhdGEtbXM9XCInICsgbXNLZXkgKyAnXCJdJyk7XG4gICAgICBpZiAoIWRldCkgcmV0dXJuO1xuICAgICAgZGV0LnF1ZXJ5U2VsZWN0b3JBbGwoJy5kdi1tcy1vcHQnKS5mb3JFYWNoKChvcHQpID0+IHtcbiAgICAgICAgY29uc3QgcyA9IG9wdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtc2VhcmNoJykgfHwgJyc7XG4gICAgICAgIG9wdC5zdHlsZS5kaXNwbGF5ID0gIXEgfHwgcy5pbmNsdWRlcyhxKSA/ICcnIDogJ25vbmUnO1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0LmlkID09PSAnZHYtaW50ZXJhY2Npb25lcy1idXNjYXInKSB7XG4gICAgICBzdGF0ZS5pbnRlclF1ZXJ5ID0gdC52YWx1ZTtcbiAgICAgIGNvbnN0IGcgPSBzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEuZ2VzdGlvbjtcbiAgICAgIGNvbnN0IHRpID0gKGcgJiYgZy50YWJsYUludGVyYWNjaW9uZXMpIHx8IHsgcm93czogW10sIHRvdGFsOiAwIH07XG4gICAgICBjb25zdCBjb250ID0gYm9keS5xdWVyeVNlbGVjdG9yKCcjZHYtaW50ZXJhY2Npb25lcyAuZHYtaW50ZXItYm9keScpO1xuICAgICAgaWYgKGNvbnQpIGNvbnQuaW5uZXJIVE1MID0gX2ludGVyYWNjaW9uZXNUYWJsYSh0aS5yb3dzLCB0aS50b3RhbCwgc3RhdGUuaW50ZXJRdWVyeSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0LmlkID09PSAnZHYtcHJvZHVjdG9zLWJ1c2NhcicpIHtcbiAgICAgIHN0YXRlLnByb2RRdWVyeSA9IHQudmFsdWU7XG4gICAgICBjb25zdCBjb250ID0gYm9keS5xdWVyeVNlbGVjdG9yKCcjZHYtcHJvZHVjdG9zIC5kdi1wcm9kLWJvZHknKTtcbiAgICAgIGlmIChjb250KVxuICAgICAgICBjb250LmlubmVySFRNTCA9IF9wcm9kdWN0b3NUYWJsYShzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEucHJvZHVjdG9zLCBzdGF0ZS5wcm9kUXVlcnkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bUF0dHIgPSB0LmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMtc2VhcmNoJyk7XG4gICAgaWYgKHZtQXR0cikge1xuICAgICAgLy8gU29sbyB0cmVzIHJhbmtpbmdzIHBvc2libGVzOiBudW5jYSByZXVzYXIgZWwgdGV4dG8gZGVsIGF0cmlidXRvIGVuIGVsIEhUTUwuXG4gICAgICBjb25zdCB2bUtleSA9IF90aXBvVmVyTWFzKHZtQXR0cik7XG4gICAgICBzdGF0ZS52ZXJNYXNRdWVyeVt2bUtleV0gPSB0LnZhbHVlO1xuICAgICAgY29uc3Qgc2VjID0gdC5jbG9zZXN0KCcuZHYtdmVybWFzJyk7XG4gICAgICBjb25zdCBkZCA9IHN0YXRlLmRhdGE7XG4gICAgICBjb25zdCByb3dzID1cbiAgICAgICAgKGRkICYmXG4gICAgICAgICAgKHZtS2V5ID09PSAndW5pZGFkZXMnXG4gICAgICAgICAgICA/IGRkLnRvcFVuaWRhZGVzXG4gICAgICAgICAgICA6IHZtS2V5ID09PSAnZGluZXJvJ1xuICAgICAgICAgICAgICA/IGRkLnRvcERpbmVyb1xuICAgICAgICAgICAgICA6IGRkLmNsaWVudGVzKSkgfHxcbiAgICAgICAgW107XG4gICAgICBpZiAoc2VjKSB7XG4gICAgICAgIGNvbnN0IHRtcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgICB0bXAuaW5uZXJIVE1MID0gX3Zlck1hc1RhYmxhKHZtS2V5LCByb3dzKTtcbiAgICAgICAgY29uc3QgbmV3V3JhcCA9IHRtcC5xdWVyeVNlbGVjdG9yKCcuZHYtdGFibGUtd3JhcCcpO1xuICAgICAgICBjb25zdCBvbGRXcmFwID0gc2VjLnF1ZXJ5U2VsZWN0b3IoJy5kdi10YWJsZS13cmFwJyk7XG4gICAgICAgIGlmIChuZXdXcmFwICYmIG9sZFdyYXApIG9sZFdyYXAucmVwbGFjZVdpdGgobmV3V3JhcCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuZnVuY3Rpb24gX3VwZGF0ZVN1bW1hcnkoYm9keSwga2V5KSB7XG4gIGNvbnN0IGRldCA9IGJvZHkucXVlcnlTZWxlY3RvcignZGV0YWlsc1tkYXRhLW1zPVwiJyArIGtleSArICdcIl0nKTtcbiAgaWYgKCFkZXQpIHJldHVybjtcbiAgY29uc3QgY2hlY2tlZCA9IEFycmF5LmZyb20oZGV0LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXTpjaGVja2VkJykpO1xuICBjb25zdCBzdW0gPSBkZXQucXVlcnlTZWxlY3Rvcignc3VtbWFyeScpO1xuICBpZiAoIXN1bSkgcmV0dXJuO1xuICBpZiAoY2hlY2tlZC5sZW5ndGggPT09IDApIHN1bS50ZXh0Q29udGVudCA9ICdUb2Rvcyc7XG4gIGVsc2UgaWYgKGNoZWNrZWQubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3Qgc3BhbiA9IGNoZWNrZWRbMF0ucGFyZW50RWxlbWVudCAmJiBjaGVja2VkWzBdLnBhcmVudEVsZW1lbnQucXVlcnlTZWxlY3Rvcignc3BhbicpO1xuICAgIHN1bS50ZXh0Q29udGVudCA9IHNwYW4gPyBzcGFuLnRleHRDb250ZW50IDogY2hlY2tlZFswXS52YWx1ZTtcbiAgfSBlbHNlIHN1bS50ZXh0Q29udGVudCA9IGNoZWNrZWQubGVuZ3RoICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBUEkgcFx1MDBGQWJsaWNhIChleHBvcnRzIGRlbCBjaHVuaylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG53aW5kb3cub3BlbkRhc2hib2FyZFZlbnRhcyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSByZXR1cm47XG4gIGNvbnN0IHJvbGUgPSBfcm9sZSgpO1xuICBpZiAocm9sZSAhPT0gJ2FkbWluJyAmJiByb2xlICE9PSAnZ2VyZW50ZScgJiYgcm9sZSAhPT0gJ3ZlbmRlZG9yJykge1xuICAgIGFsZXJ0KCdUdSB1c3VhcmlvIG5vIHRpZW5lIGFjY2VzbyBhbCBEYXNoYm9hcmQgZGUgVmVudGFzLiBTaSBsbyBuZWNlc2l0XHUwMEUxcywgYXZpc2FsZSBhIE1hcmlhbm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE90cm8gdXN1YXJpbyBlbiBsYSBtaXNtYSBwZXN0YVx1MDBGMWEgKGxvZ291dCArIGxvZ2luIHNpbiByZWNhcmdhcik6IHNlXG4gIC8vIGRlc2NhcnRhIHRvZG8gbG8gZGVsIGFudGVyaW9yLiBNaXNtbyB1c3VhcmlvOiBzZSBjb25zZXJ2YSBzdSBzZWxlY2NpXHUwMEYzbi5cbiAgY29uc3QgdWlkID0gX2N1cnJlbnRVaWQoKTtcbiAgaWYgKHVpZCAhPT0gc3RhdGUudWlkKSBfcmVzZXRTdGF0ZSh1aWQpO1xuICBpZiAoIXN0YXRlLm1lcykgc3RhdGUubWVzID0gX21lc0FjdHVhbEFydCgpO1xuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIF9lbnN1cmVTa2VsZXRvbigpO1xuICBfd2lyZSgpO1xuICByZW5kZXJGaWx0cm9zKHRydWUpO1xuICAvLyBQcmVjYXJnYSBDaGFydC5qcyBlbiBwYXJhbGVsbyBhIGxhIGNvbnN1bHRhLlxuICBfbG9hZENoYXJ0SnMoKS5jYXRjaCgoKSA9PiB7fSk7XG4gIC8vIFNpZW1wcmUgc2UgcGlkZSBkZSBudWV2byBhbCBhYnJpciAoZWwgc2Vydmlkb3IgY2FjaGVhIDEwIG1pbikuXG4gIGNhcmdhcigpO1xufTtcblxud2luZG93LmNsb3NlRGFzaGJvYXJkVmVudGFzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBfZGVzdHJveUNoYXJ0cygpO1xuICAvLyBMb3MgZGF0b3Mgbm8gc2UgZ3VhcmRhbiBlbnRyZSBhcGVydHVyYXM7IHNlIHZ1ZWx2ZW4gYSBwZWRpciBhbCBhYnJpci5cbiAgc3RhdGUuZGF0YSA9IG51bGw7XG4gIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgc3RhdGUucmVxU2VxKys7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBaUJBLE1BQU0sZUFBZTtBQUNyQixNQUFNLFFBQVE7QUFDZCxNQUFNLFNBQVM7QUFFZixNQUFNLGNBQWM7QUFBQSxJQUNsQixFQUFFLEtBQUssY0FBYyxPQUFPLFdBQVc7QUFBQSxJQUN2QyxFQUFFLEtBQUssWUFBWSxPQUFPLFVBQVU7QUFBQSxJQUNwQyxFQUFFLEtBQUssY0FBYyxPQUFPLFlBQVk7QUFBQSxJQUN4QyxFQUFFLEtBQUssY0FBYyxPQUFPLGVBQVk7QUFBQSxJQUN4QyxFQUFFLEtBQUssUUFBUSxPQUFPLE1BQU07QUFBQSxFQUM5QjtBQUVBLFdBQVMsWUFBWTtBQUNuQixXQUFPLEVBQUUsWUFBWSxDQUFDLEdBQUcsVUFBVSxDQUFDLEdBQUcsWUFBWSxDQUFDLEdBQUcsWUFBWSxDQUFDLEdBQUcsTUFBTSxDQUFDLEVBQUU7QUFBQSxFQUNsRjtBQUtB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
