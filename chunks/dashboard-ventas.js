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
    verMas: { unidades: false, dinero: false },
    verMasQuery: { unidades: "", dinero: "" },
    interQuery: "",
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
    state.verMas = { unidades: false, dinero: false };
    state.verMasQuery = { unidades: "", dinero: "" };
    state.interQuery = "";
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
  function _verMasTabla(tipoIn, rows) {
    const tipo = tipoIn === "dinero" ? "dinero" : "unidades";
    const q = state.verMasQuery[tipo].toLowerCase().trim();
    const ranked = rows.map((r, i) => ({ r, pos: i + 1 }));
    const filtered = q ? ranked.filter(
      (x) => (String(x.r.sku) + " " + String(x.r.desc || "")).toLowerCase().includes(q)
    ) : ranked;
    let html = '<div class="dv-vermas"><input type="search" class="dv-ms-search" placeholder="Buscar SKU o descripci\xF3n\u2026" data-vermas-search="' + tipo + '"><div class="dv-table-wrap"><table class="dv-table"><thead><tr><th>#</th><th>SKU</th><th>Descripci\xF3n</th><th class="num">Unidades</th><th class="num">Dinero</th></tr></thead><tbody>';
    for (const { r, pos } of filtered) {
      html += "<tr><td>" + pos + '</td><td class="mono">' + _escHtml(r.sku) + "</td><td>" + _escHtml(r.desc) + '</td><td class="num">' + _escHtml(_fmtUds(r.uds)) + '</td><td class="num">' + _escHtml(_fmtArs(r.ars)) + "</td></tr>";
    }
    if (filtered.length === 0)
      html += '<tr><td colspan="5" class="dv-muted">Sin resultados.</td></tr>';
    html += "</tbody></table></div></div>";
    return html;
  }
  function _topSection(tipo, titulo, rows) {
    const abierto = state.verMas[tipo];
    const total = rows.length;
    const h = Math.max(120, Math.min(TOP_N, total) * 22 + 40);
    return '<section class="dv-section"><div class="dv-section-head"><h3>' + _escHtml(titulo) + "</h3>" + (total > 0 ? '<button type="button" class="dv-link" data-vermas="' + tipo + '" aria-expanded="' + (abierto ? "true" : "false") + '">' + (abierto ? "Ver menos" : "Ver m\xE1s") + " (" + total + ")</button>" : "") + "</div>" + (total > 0 ? '<div class="dv-chart" style="height:' + h + 'px"><canvas id="dv-chart-top-' + tipo + '" role="img" aria-label="' + _escHtml(titulo) + '"></canvas></div>' : '<div class="dv-muted">Sin datos.</div>') + (abierto ? _verMasTabla(tipo, rows) : "") + "</section>";
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
    }
    _destroyCharts();
    root.innerHTML = html;
    root.querySelectorAll("input[data-vermas-search]").forEach((inp) => {
      const k = inp.getAttribute("data-vermas-search");
      if (k) inp.value = state.verMasQuery[k] || "";
    });
    const interInp = root.querySelector("#dv-interacciones-buscar");
    if (interInp) interInp.value = state.interQuery || "";
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
  function _drawCharts(d) {
    _destroyCharts();
    _barChart("dv-chart-top-unidades", d.topUnidades || [], "uds", _fmtUds, "#0284a0");
    _barChart("dv-chart-top-dinero", d.topDinero || [], "ars", _fmtArs, "#16a34a");
    _lineChart("dv-chart-ventas", d.serieVentas || [], _fmtArs, "#1e40af", false);
    _lineChart("dv-chart-bo-uds", d.serieBoUds || [], _fmtUds, "#c2410c", true);
    _lineChart("dv-chart-bo-ars", d.serieBoArs || [], _fmtArs, "#9f1239", true);
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
        const tipo = vm.getAttribute("data-vermas") === "dinero" ? "dinero" : "unidades";
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
      const vmAttr = t.getAttribute("data-vermas-search");
      if (vmAttr) {
        const vmKey = vmAttr === "dinero" ? "dinero" : "unidades";
        state.verMasQuery[vmKey] = t.value;
        const sec = t.closest(".dv-vermas");
        const rows = state.data && (vmKey === "unidades" ? state.data.topUnidades : state.data.topDinero) || [];
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI5LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlIH0sXG4gIHZlck1hc1F1ZXJ5OiB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJyB9LFxuICBpbnRlclF1ZXJ5OiAnJyxcbiAgcmVxU2VxOiAwLFxufTtcblxuZnVuY3Rpb24gX3Jlc2V0U3RhdGUodWlkKSB7XG4gIHN0YXRlLnVpZCA9IHVpZDtcbiAgc3RhdGUubWVzID0gX21lc0FjdHVhbEFydCgpO1xuICBzdGF0ZS5zZWwgPSBfc2VsVmFjaWEoKTtcbiAgc3RhdGUuZGF0YSA9IG51bGw7XG4gIHN0YXRlLm9wY2lvbmVzID0gbnVsbDtcbiAgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9IG51bGw7XG4gIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgc3RhdGUudmVyTWFzID0geyB1bmlkYWRlczogZmFsc2UsIGRpbmVybzogZmFsc2UgfTtcbiAgc3RhdGUudmVyTWFzUXVlcnkgPSB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJyB9O1xuICBzdGF0ZS5pbnRlclF1ZXJ5ID0gJyc7XG4gIHN0YXRlLnJlcVNlcSsrO1xufVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG5jb25zdCBjaGFydHMgPSB7fTtcbmxldCBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEVzY2FwZSBsb2NhbCAobWlzbW8gcmVzdWx0YWRvIHF1ZSB3aW5kb3cuZXNjYXBlSHRtbCk6IGVsIGFuXHUwMEUxbGlzaXMgZGVcbi8vIHNlZ3VyaWRhZCBkZWwgcmVwbyAoQ29kZVFMKSBzb2xvIHJlY29ub2NlIHVuIHNhbml0aXphZG9yIHZpc2libGUgYWNcdTAwRTEuXG5mdW5jdGlvbiBfZXNjSHRtbChzKSB7XG4gIGNvbnN0IHYgPSBzID09IG51bGwgPyAnJyA6IHM7XG4gIHJldHVybiBTdHJpbmcodilcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKVxuICAgIC5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xufVxuXG5mdW5jdGlvbiBfZm10QXJzKG4pIHtcbiAgY29uc3QgdiA9IE51bWJlcihuKSB8fCAwO1xuICByZXR1cm4gJyQnICsgTWF0aC5yb3VuZCh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX2ZtdFVkcyhuKSB7XG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSB8fCAwKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX3JvbGUoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdXNlclJvbGUgIT09ICd1bmRlZmluZWQnID8gdXNlclJvbGUgOiB3aW5kb3cudXNlclJvbGUpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy51c2VyUm9sZSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9teVZlbmRvcigpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKHR5cGVvZiBhc3NpZ25lZFZlbmRvciAhPT0gJ3VuZGVmaW5lZCcgPyBhc3NpZ25lZFZlbmRvciA6IHdpbmRvdy5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgfVxufVxuXG5mdW5jdGlvbiBfY3VycmVudFVpZCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1ID0gdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRVc2VyIDogd2luZG93LmN1cnJlbnRVc2VyO1xuICAgIHJldHVybiAodSAmJiB1LnVpZCkgfHwgbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIudWlkKSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9pc09wZW4oKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgcmV0dXJuICEhKG1vZGFsICYmIG1vZGFsLmNsYXNzTGlzdCAmJiBtb2RhbC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSk7XG59XG5cbmZ1bmN0aW9uIF9pc1ZlbmRlZG9yKCkge1xuICByZXR1cm4gX3JvbGUoKSA9PT0gJ3ZlbmRlZG9yJztcbn1cblxuLyoqIE1lcyBlbiBjdXJzbyBlbiBob3JhIEFyZ2VudGluYSwgZm9ybWF0byBBQUFBLU1NLiAqL1xuZnVuY3Rpb24gX21lc0FjdHVhbEFydCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJ0cyA9IG5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KCdlbi1DQScsIHtcbiAgICAgIHRpbWVab25lOiAnQW1lcmljYS9BcmdlbnRpbmEvQnVlbm9zX0FpcmVzJyxcbiAgICAgIHllYXI6ICdudW1lcmljJyxcbiAgICAgIG1vbnRoOiAnMi1kaWdpdCcsXG4gICAgfSkuZm9ybWF0VG9QYXJ0cyhuZXcgRGF0ZSgpKTtcbiAgICBjb25zdCB5ID0gcGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAneWVhcicpLnZhbHVlO1xuICAgIGNvbnN0IG0gPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICdtb250aCcpLnZhbHVlO1xuICAgIHJldHVybiB5ICsgJy0nICsgbTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbn1cblxuY29uc3QgTUVTRVNfQ09SVE9TID0gW1xuICAnZW5lJyxcbiAgJ2ZlYicsXG4gICdtYXInLFxuICAnYWJyJyxcbiAgJ21heScsXG4gICdqdW4nLFxuICAnanVsJyxcbiAgJ2FnbycsXG4gICdzZXAnLFxuICAnb2N0JyxcbiAgJ25vdicsXG4gICdkaWMnLFxuXTtcbmZ1bmN0aW9uIF9sYWJlbE1lcyhhYWFhbW0pIHtcbiAgY29uc3QgcyA9IFN0cmluZyhhYWFhbW0gfHwgJycpO1xuICBjb25zdCBtID0gTnVtYmVyKHMuc2xpY2UoNSwgNykpO1xuICBpZiAoIW0pIHJldHVybiBzO1xuICByZXR1cm4gTUVTRVNfQ09SVE9TW20gLSAxXSArICcgJyArIHMuc2xpY2UoMiwgNCk7XG59XG5cbmZ1bmN0aW9uIF9lcnJvck1lc3NhZ2UoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgbXYgPSB3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUubWVuc2FqZXNWZW5kZWRvcjtcbiAgICBpZiAobXYgJiYgdHlwZW9mIG12LmZvcm1hdE1lbnNhamVDb25Db2RpZ28gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBtdi5mb3JtYXRNZW5zYWplQ29uQ29kaWdvKCdEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCcpO1xuICAgIH1cbiAgfSBjYXRjaCAoX2UpIHt9XG4gIC8vIEZhbGxiYWNrIFx1MDBBNzY4IHNpIGVsIGJ1bmRsZSBubyBjYXJnXHUwMEYzIChTVyBzdGFsZSkuXG4gIHJldHVybiAoXG4gICAgJ05vIHB1ZGltb3MgY2FyZ2FyIGVsIHRhYmxlcm8gZGUgdmVudGFzLiBWb2x2XHUwMEU5IGEgaW50ZW50YXIgZW4gdW4gbWludXRvOyBzaSBzaWd1ZSBwYXNhbmRvLCBhdmlzYWxlIGEgTWFyaWFuby4nICtcbiAgICAnXFxuXFxuQ1x1MDBGM2RpZ28gdFx1MDBFOWNuaWNvOiBEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCdcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xvYWRDaGFydEpzKCkge1xuICBpZiAod2luZG93LkNoYXJ0KSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHdpbmRvdy5DaGFydCk7XG4gIGlmIChjaGFydEpzUHJvbWlzZSkgcmV0dXJuIGNoYXJ0SnNQcm9taXNlO1xuICBjaGFydEpzUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgcy5zcmMgPSBDSEFSVF9KU19VUkw7XG4gICAgcy5hc3luYyA9IHRydWU7XG4gICAgcy5vbmxvYWQgPSAoKSA9PlxuICAgICAgd2luZG93LkNoYXJ0ID8gcmVzb2x2ZSh3aW5kb3cuQ2hhcnQpIDogcmVqZWN0KG5ldyBFcnJvcignQ2hhcnQuanMgc2luIGdsb2JhbCcpKTtcbiAgICBzLm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgICBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG4gICAgICByZWplY3QobmV3IEVycm9yKCdubyBzZSBwdWRvIGNhcmdhciBDaGFydC5qcycpKTtcbiAgICB9O1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xuICByZXR1cm4gY2hhcnRKc1Byb21pc2U7XG59XG5cbmZ1bmN0aW9uIF9kZXN0cm95Q2hhcnRzKCkge1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoY2hhcnRzKSkge1xuICAgIHRyeSB7XG4gICAgICBjaGFydHNba10uZGVzdHJveSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIGRlbGV0ZSBjaGFydHNba107XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcGNpb25lcyBkZSBmaWx0cm9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERldnVlbHZlIFt7dmFsdWUsbGFiZWx9XSBkZSBsYSBvcGNpXHUwMEYzbiBga2V5YCBkZSBsYSBcdTAwRkFsdGltYSByZXNwdWVzdGEuICovXG5mdW5jdGlvbiBfb3BjaW9uZXNEZShrZXkpIHtcbiAgY29uc3Qgb3AgPSBzdGF0ZS5vcGNpb25lcyB8fCB7fTtcbiAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShvcFtrZXldKSA/IG9wW2tleV0gOiBbXTtcbiAgaWYgKGtleSA9PT0gJ2NsaWVudGVzJykge1xuICAgIHJldHVybiBhcnIubWFwKChjKSA9PiAoe1xuICAgICAgdmFsdWU6IFN0cmluZyhjLmNvZGUpLFxuICAgICAgbGFiZWw6IFN0cmluZyhjLm5hbWUgfHwgYy5jb2RlKSArICcgKCcgKyBTdHJpbmcoYy5jb2RlKSArICcpJyxcbiAgICB9KSk7XG4gIH1cbiAgaWYgKGtleSA9PT0gJ3NrdXMnKSB7XG4gICAgcmV0dXJuIGFyci5tYXAoKHMpID0+ICh7XG4gICAgICB2YWx1ZTogU3RyaW5nKHMuY29kZSksXG4gICAgICBsYWJlbDogU3RyaW5nKHMuY29kZSkgKyAocy5kZXNjID8gJyAtICcgKyBTdHJpbmcocy5kZXNjKSA6ICcnKSxcbiAgICB9KSk7XG4gIH1cbiAgcmV0dXJuIGFyci5tYXAoKHYpID0+ICh7IHZhbHVlOiBTdHJpbmcodiksIGxhYmVsOiBTdHJpbmcodikgfSkpO1xufVxuXG5mdW5jdGlvbiBfcmVzdW1lblNlbChrZXksIG9wY2lvbmVzKSB7XG4gIGNvbnN0IG4gPSBzdGF0ZS5zZWxba2V5XS5sZW5ndGg7XG4gIGlmIChuID09PSAwKSByZXR1cm4gJ1RvZG9zJztcbiAgaWYgKG4gPT09IDEpIHtcbiAgICBjb25zdCBvID0gb3BjaW9uZXMuZmluZCgoeCkgPT4geC52YWx1ZSA9PT0gc3RhdGUuc2VsW2tleV1bMF0pO1xuICAgIHJldHVybiBvID8gby5sYWJlbCA6IHN0YXRlLnNlbFtrZXldWzBdO1xuICB9XG4gIHJldHVybiBuICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuZnVuY3Rpb24gX3JlbmRlckZpbHRybyhkZWYpIHtcbiAgaWYgKGRlZi5rZXkgPT09ICd2ZW5kZWRvcmVzJyAmJiBfaXNWZW5kZWRvcigpKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPicgK1xuICAgICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LW1zLWxvY2tlZFwiIHRpdGxlPVwiVmVzIHNvbG8gdHVzIGNsaWVudGVzXCI+JyArXG4gICAgICBfZXNjSHRtbChfbXlWZW5kb3IoKSB8fCAnVHVzIGNsaWVudGVzJykgK1xuICAgICAgJyBcdUQ4M0RcdUREMTI8L2Rpdj48L2Rpdj4nXG4gICAgKTtcbiAgfVxuICBjb25zdCBvcGNpb25lcyA9IF9vcGNpb25lc0RlKGRlZi5rZXkpO1xuICBjb25zdCBzZWxlY3RlZCA9IG5ldyBTZXQoc3RhdGUuc2VsW2RlZi5rZXldKTtcbiAgbGV0IGxpc3QgPSAnJztcbiAgZm9yIChjb25zdCBvIG9mIG9wY2lvbmVzKSB7XG4gICAgbGlzdCArPVxuICAgICAgJzxsYWJlbCBjbGFzcz1cImR2LW1zLW9wdFwiIGRhdGEtc2VhcmNoPVwiJyArXG4gICAgICBfZXNjSHRtbChvLmxhYmVsLnRvTG93ZXJDYXNlKCkpICtcbiAgICAgICdcIj48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgZGF0YS1maWx0cm89XCInICtcbiAgICAgIGRlZi5rZXkgK1xuICAgICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgICBfZXNjSHRtbChvLnZhbHVlKSArXG4gICAgICAnXCInICtcbiAgICAgIChzZWxlY3RlZC5oYXMoby52YWx1ZSkgPyAnIGNoZWNrZWQnIDogJycpICtcbiAgICAgICc+IDxzcGFuPicgK1xuICAgICAgX2VzY0h0bWwoby5sYWJlbCkgK1xuICAgICAgJzwvc3Bhbj48L2xhYmVsPic7XG4gIH1cbiAgaWYgKCFsaXN0KSBsaXN0ID0gJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiIHN0eWxlPVwicGFkZGluZzo2cHhcIj5TaW4gb3BjaW9uZXMgdG9kYXZcdTAwRURhLjwvZGl2Pic7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+JyArXG4gICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgJzwvZGl2PjxkZXRhaWxzIGNsYXNzPVwiZHYtbXNcIiBkYXRhLW1zPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPjxzdW1tYXJ5PicgK1xuICAgIF9lc2NIdG1sKF9yZXN1bWVuU2VsKGRlZi5rZXksIG9wY2lvbmVzKSkgK1xuICAgICc8L3N1bW1hcnk+PGRpdiBjbGFzcz1cImR2LW1zLXBvcFwiPicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXJcdTIwMjZcIiBkYXRhLW1zLXNlYXJjaD1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWFjdGlvbnNcIj48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLW1zLWNsZWFyPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPkxpbXBpYXI8L2J1dHRvbj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWxpc3RcIj4nICtcbiAgICBsaXN0ICtcbiAgICAnPC9kaXY+PC9kaXY+PC9kZXRhaWxzPjwvZGl2PidcbiAgKTtcbn1cblxuLyoqIExlZSBkZWwgRE9NIGxvIHF1ZSBlbCB1c3VhcmlvIG1hcmNcdTAwRjMuIFNvbG8gc2UgbGxhbWEgYWwgdG9jYXIgXCJBcGxpY2FyXCIuICovXG5mdW5jdGlvbiBfcmVhZFNlbEZyb21Eb20ocm9vdCkge1xuICBjb25zdCBuZXh0ID0gX3NlbFZhY2lhKCk7XG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdW2RhdGEtZmlsdHJvXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpO1xuICAgIGlmIChlbC5jaGVja2VkICYmIG5leHRba2V5XSkgbmV4dFtrZXldLnB1c2goZWwudmFsdWUpO1xuICB9KTtcbiAgaWYgKF9pc1ZlbmRlZG9yKCkpIG5leHQudmVuZGVkb3JlcyA9IFtdO1xuICBzdGF0ZS5zZWwgPSBuZXh0O1xuICBjb25zdCBtZXNFbCA9IHJvb3QucXVlcnlTZWxlY3RvcignI2R2LW1lcycpO1xuICBpZiAobWVzRWwgJiYgL15cXGR7NH0tXFxkezJ9JC8udGVzdChtZXNFbC52YWx1ZSkpIHN0YXRlLm1lcyA9IG1lc0VsLnZhbHVlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBcm1hIGVsIGVzcXVlbGV0byAoZmlsdHJvcyBhcnJpYmEsIHJlc3VsdGFkb3MgYWJham8pIHVuYSBzb2xhIHZlei4gKi9cbmZ1bmN0aW9uIF9lbnN1cmVTa2VsZXRvbigpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm4gbnVsbDtcbiAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcy1ob3N0JykgfHwgIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1yZXN1bHRzJykpIHtcbiAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IGlkPVwiZHYtZmlsdHJvcy1ob3N0XCI+PC9kaXY+PGRpdiBpZD1cImR2LXJlc3VsdHNcIj48L2Rpdj4nO1xuICAgIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBudWxsO1xuICB9XG4gIHJldHVybiBib2R5O1xufVxuXG4vKipcbiAqIFBhbmVsIGRlIGZpbHRyb3MuIFNlIHJlLWFybWEgc29sbyBjdWFuZG8gY2FtYmlhbiBsYXMgb3BjaW9uZXMgKHVuYSB2ZXogcG9yXG4gKiByZXNwdWVzdGEpLCBhbCByZXNldGVhciBwb3IgY2FtYmlvIGRlIHVzdWFyaW8gbyBjb24gXCJMaW1waWFyIGZpbHRyb3NcIi4gTmkgZWxcbiAqIFwiQ2FyZ2FuZG9cdTIwMjZcIiBuaSBcIlZlciBtXHUwMEUxc1wiIGxvIHRvY2FuLCBhc1x1MDBFRCBubyBzZSBwaWVyZGVuIGNhbWJpb3Mgc2luIGFwbGljYXIuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckZpbHRyb3MoZm9yY2UpIHtcbiAgY29uc3QgaG9zdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zLWhvc3QnKTtcbiAgaWYgKCFob3N0KSByZXR1cm47XG4gIGlmICghZm9yY2UgJiYgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9PT0gc3RhdGUub3BjaW9uZXMgJiYgaG9zdC5pbm5lckhUTUwpIHJldHVybjtcbiAgY29uc3QgcHJldiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zJyk7XG4gIGNvbnN0IGFiaWVydG8gPSBwcmV2ID8gISFwcmV2Lm9wZW4gOiB3aW5kb3cuaW5uZXJXaWR0aCA+IDcwMDtcbiAgbGV0IGh0bWwgPSAnPGRldGFpbHMgY2xhc3M9XCJkdi1maWx0cm9zXCIgaWQ9XCJkdi1maWx0cm9zXCInICsgKGFiaWVydG8gPyAnIG9wZW4nIDogJycpICsgJz4nO1xuICBodG1sICs9ICc8c3VtbWFyeT5GaWx0cm9zPC9zdW1tYXJ5PjxkaXYgY2xhc3M9XCJkdi1maWx0cm9zLWdyaWRcIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+TWVzPC9kaXY+PGlucHV0IHR5cGU9XCJtb250aFwiIGlkPVwiZHYtbWVzXCIgY2xhc3M9XCJkdi1pbnB1dFwiIHZhbHVlPVwiJyArXG4gICAgX2VzY0h0bWwoc3RhdGUubWVzKSArXG4gICAgJ1wiPjwvZGl2Pic7XG4gIGZvciAoY29uc3QgZGVmIG9mIEZJTFRST1NfREVGKSBodG1sICs9IF9yZW5kZXJGaWx0cm8oZGVmKTtcbiAgaHRtbCArPSAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LWZpbHRyb3MtYWN0aW9uc1wiPic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1idG4tc2Vjb25kYXJ5XCIgZGF0YS1kdi1hY3Rpb249XCJsaW1waWFyXCI+TGltcGlhciBmaWx0cm9zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtYnRuLXByaW1hcnlcIiBpZD1cImR2LWFwbGljYXJcIiBkYXRhLWR2LWFjdGlvbj1cImFwbGljYXJcIicgK1xuICAgIChzdGF0ZS5sb2FkaW5nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xuICAgICc+QXBsaWNhcjwvYnV0dG9uPic7XG4gIGh0bWwgKz0gJzwvZGl2PjwvZGV0YWlscz4nO1xuICBob3N0LmlubmVySFRNTCA9IGh0bWw7XG4gIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBzdGF0ZS5vcGNpb25lcztcbn1cblxuZnVuY3Rpb24gX3N5bmNBcGxpY2FyRGlzYWJsZWQoKSB7XG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1hcGxpY2FyJyk7XG4gIGlmIChidG4pIGJ0bi5kaXNhYmxlZCA9ICEhc3RhdGUubG9hZGluZztcbn1cblxuZnVuY3Rpb24gX2NhcmQodGl0dWxvLCB2YWxvcikge1xuICByZXR1cm4gKFxuICAgICc8ZGl2IGNsYXNzPVwiZHYtY2FyZFwiPjxkaXYgY2xhc3M9XCJkdi1jYXJkLXRpdGxlXCI+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1jYXJkLXZhbHVlXCI+JyArXG4gICAgX2VzY0h0bWwodmFsb3IpICtcbiAgICAnPC9kaXY+PC9kaXY+J1xuICApO1xufVxuXG4vLyBQb3JjZW50YWplIGNvbiBjb21hIGRlY2ltYWwgKGVzLUFSKTogODAsNSVcbmZ1bmN0aW9uIF9mbXRQY3Qobikge1xuICByZXR1cm4gKFxuICAgIChOdW1iZXIobikgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgbWluaW11bUZyYWN0aW9uRGlnaXRzOiAwLFxuICAgICAgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxLFxuICAgIH0pICsgJyUnXG4gICk7XG59XG5cbi8vIEFBQUEtTU0tREQgLT4gREQvTU0vQUFBQSAoc2kgbm8gdGllbmUgZXNlIGZvcm1hdG8sIHNlIGRldnVlbHZlIHRhbCBjdWFsKVxuZnVuY3Rpb24gX2ZtdEZlY2hhKGYpIHtcbiAgY29uc3QgbSA9IC9eKFxcZHs0fSktKFxcZHsyfSktKFxcZHsyfSkvLmV4ZWMoU3RyaW5nKGYgPT0gbnVsbCA/ICcnIDogZikpO1xuICByZXR1cm4gbSA/IG1bM10gKyAnLycgKyBtWzJdICsgJy8nICsgbVsxXSA6IFN0cmluZyhmID09IG51bGwgPyAnJyA6IGYpO1xufVxuXG5mdW5jdGlvbiBfdGlwb0xhYmVsKHQpIHtcbiAgcmV0dXJuIHQgPT09ICd2aXNpdGEnID8gJ1Zpc2l0YScgOiAnQ29udGFjdG8nO1xufVxuXG4vLyBUYWJsYSBkZSBpbnRlcmFjY2lvbmVzIChzb2xvIGVsIGNvbnRlbmVkb3IgY29uIHNjcm9sbDsgc2UgcmVlbXBsYXphIGFsIGJ1c2NhcikuXG5mdW5jdGlvbiBfaW50ZXJhY2Npb25lc1RhYmxhKHJvd3MsIHRvdGFsLCBxdWVyeSkge1xuICBjb25zdCBxID0gU3RyaW5nKHF1ZXJ5IHx8ICcnKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnRyaW0oKTtcbiAgY29uc3QgbGlzdGEgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IGxpc3RhLmZpbHRlcigocikgPT5cbiAgICAgICAgKFxuICAgICAgICAgIFN0cmluZyhyLmNsaWVudGUpICtcbiAgICAgICAgICAnICcgK1xuICAgICAgICAgIF9mbXRGZWNoYShyLmZlY2hhKSArXG4gICAgICAgICAgJyAnICtcbiAgICAgICAgICBTdHJpbmcoci52ZW5kZWRvcikgK1xuICAgICAgICAgICcgJyArXG4gICAgICAgICAgX3RpcG9MYWJlbChyLnRpcG8pXG4gICAgICAgIClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhxKVxuICAgICAgKVxuICAgIDogbGlzdGE7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXAgZHYtaW50ZXItd3JhcFwiPjx0YWJsZSBjbGFzcz1cImR2LXRhYmxlXCI+PHRoZWFkPjx0cj48dGg+Q2xpZW50ZTwvdGg+PHRoPkZlY2hhPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5UaXBvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgciBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoci5jbGllbnRlKSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChfZm10RmVjaGEoci5mZWNoYSkpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKHIudmVuZGVkb3IpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKF90aXBvTGFiZWwoci50aXBvKSkgK1xuICAgICAgJzwvdGQ+PC90cj4nO1xuICB9XG4gIGlmIChmaWx0ZXJlZC5sZW5ndGggPT09IDApXG4gICAgaHRtbCArPSAnPHRyPjx0ZCBjb2xzcGFuPVwiNFwiIGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gcmVzdWx0YWRvcy48L3RkPjwvdHI+JztcbiAgaHRtbCArPSAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG4gIGNvbnN0IHRvdGFsTiA9IE51bWJlcih0b3RhbCkgfHwgMDtcbiAgaWYgKHRvdGFsTiA+IGxpc3RhLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5Nb3N0cmFuZG8gJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKGxpc3RhLmxlbmd0aCkpICtcbiAgICAgICcgZGUgJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKHRvdGFsTikpICtcbiAgICAgICc8L2Rpdj4nO1xuICB9XG4gIHJldHVybiBodG1sO1xufVxuXG4vKiogVGFibGEgZGUgaW50ZXJhY2Npb25lcyBjb24gYnVzY2Fkb3IuIEVsIHRleHRvIGJ1c2NhZG8gc2UgcG9uZSBwb3IgRE9NLiAqL1xuZnVuY3Rpb24gX2ludGVyYWNjaW9uZXNTZWN0aW9uKHQsIHF1ZXJ5KSB7XG4gIGNvbnN0IHJvd3MgPSAodCAmJiB0LnJvd3MpIHx8IFtdO1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIiBpZD1cImR2LWludGVyYWNjaW9uZXNcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkludGVyYWNjaW9uZXM8L2gzPjwvZGl2PicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgaWQ9XCJkdi1pbnRlcmFjY2lvbmVzLWJ1c2NhclwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIGNsaWVudGUsIHZlbmRlZG9yIG8gdGlwb1x1MjAyNlwiPicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtaW50ZXItYm9keVwiPicgK1xuICAgIF9pbnRlcmFjY2lvbmVzVGFibGEocm93cywgdCAmJiB0LnRvdGFsLCBxdWVyeSkgK1xuICAgICc8L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG4vKiogQmxvcXVlIGRlIGdlc3RpXHUwMEYzbjogdGFyamV0YXMgKyBub3RhICsgdGFibGEgZGUgaW50ZXJhY2Npb25lcy4gKi9cbmZ1bmN0aW9uIF9nZXN0aW9uU2VjdGlvbihnLCBzZWNjaW9uZXMsIHF1ZXJ5KSB7XG4gIGlmICghZyB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5nZXN0aW9uICYmIHNlY2Npb25lcy5nZXN0aW9uLmVycm9yKSkge1xuICAgIHJldHVybiAnPGRpdiBjbGFzcz1cImR2LWNhcmRzXCIgaWQ9XCJkdi1nZXN0aW9uXCI+JyArIF9jYXJkKCdHZXN0aVx1MDBGM24nLCAnTm8gZGlzcG9uaWJsZScpICsgJzwvZGl2Pic7XG4gIH1cbiAgbGV0IGh0bWwgPSAnPGRpdiBjbGFzcz1cImR2LWNhcmRzXCIgaWQ9XCJkdi1nZXN0aW9uXCI+JztcbiAgaHRtbCArPSBfY2FyZCgnVGFyZ2V0JywgZy50YXJnZXQgPT0gbnVsbCA/ICdTaW4gdGFyZ2V0JyA6IF9mbXRBcnMoZy50YXJnZXQpKTtcbiAgaHRtbCArPSBfY2FyZChcbiAgICAnJSBjdW1wbGltaWVudG8nLFxuICAgIGcuY3VtcGxpbWllbnRvUGN0ID09IG51bGwgPyAnU2luIHRhcmdldCcgOiBfZm10UGN0KGcuY3VtcGxpbWllbnRvUGN0KVxuICApO1xuICBodG1sICs9IF9jYXJkKCdSZW5kaWNpb25lcyBcdTIwMTMgbW9udG8nLCBfZm10QXJzKGcucmVuZGljaW9uZXNBcnMpKTtcbiAgaHRtbCArPSBfY2FyZCgnQmFzZSBhY3RpdmEnLCBfZm10VWRzKGcuYmFzZUFjdGl2YSkpO1xuICBodG1sICs9IF9jYXJkKCdUaWNrZXQgcHJvbWVkaW8nLCBfZm10QXJzKGcudGlja2V0UHJvbWVkaW8pKTtcbiAgaHRtbCArPSBfY2FyZCgnTlx1MDBCMCB2aXNpdGFzJywgX2ZtdFVkcyhnLnZpc2l0YXMpKTtcbiAgaHRtbCArPSBfY2FyZCgnTlx1MDBCMCBjb250YWN0YWRvcycsIF9mbXRVZHMoZy5jb250YWN0YWRvcykpO1xuICBodG1sICs9IF9jYXJkKCdOXHUwMEIwIGludGVyYWNjaW9uZXMnLCBfZm10VWRzKGcuaW50ZXJhY2Npb25lcykpO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBpZiAoZy5maWx0cm9zTm9BcGxpY2FuKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1sZXllbmRhIGR2LW11dGVkXCI+VGFyZ2V0IHkgcmVuZGljaW9uZXMgbm8gc2UgZmlsdHJhbiBwb3IgY2xpZW50ZSBuaSBwcm9kdWN0bzsgdmlzaXRhcyB5IGNvbnRhY3RvcyBubyBzZSBmaWx0cmFuIHBvciBwcm9kdWN0by48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gX2ludGVyYWNjaW9uZXNTZWN0aW9uKGcudGFibGFJbnRlcmFjY2lvbmVzLCBxdWVyeSk7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiBfdmVyTWFzVGFibGEodGlwb0luLCByb3dzKSB7XG4gIGNvbnN0IHRpcG8gPSB0aXBvSW4gPT09ICdkaW5lcm8nID8gJ2RpbmVybycgOiAndW5pZGFkZXMnO1xuICBjb25zdCBxID0gc3RhdGUudmVyTWFzUXVlcnlbdGlwb10udG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIC8vIFBvc2ljaVx1MDBGM24gZGVsIHJhbmtpbmcgY2FsY3VsYWRhIHVuYSBzb2xhIHZleiAoc2luIGluZGV4T2YgcG9yIGZpbGEpLlxuICBjb25zdCByYW5rZWQgPSByb3dzLm1hcCgociwgaSkgPT4gKHsgciwgcG9zOiBpICsgMSB9KSk7XG4gIGNvbnN0IGZpbHRlcmVkID0gcVxuICAgID8gcmFua2VkLmZpbHRlcigoeCkgPT5cbiAgICAgICAgKFN0cmluZyh4LnIuc2t1KSArICcgJyArIFN0cmluZyh4LnIuZGVzYyB8fCAnJykpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSlcbiAgICAgIClcbiAgICA6IHJhbmtlZDtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdmVybWFzXCI+PGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaVx1MDBGM25cdTIwMjZcIiBkYXRhLXZlcm1hcy1zZWFyY2g9XCInICtcbiAgICB0aXBvICtcbiAgICAnXCI+PGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJkdi10YWJsZVwiPjx0aGVhZD48dHI+PHRoPiM8L3RoPjx0aD5TS1U8L3RoPjx0aD5EZXNjcmlwY2lcdTAwRjNuPC90aD48dGggY2xhc3M9XCJudW1cIj5VbmlkYWRlczwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RGluZXJvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgeyByLCBwb3MgfSBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKVxuICAgIGh0bWwgKz0gJzx0cj48dGQgY29sc3Bhbj1cIjVcIiBjbGFzcz1cImR2LW11dGVkXCI+U2luIHJlc3VsdGFkb3MuPC90ZD48L3RyPic7XG4gIGh0bWwgKz0gJzwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2Rpdj4nO1xuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gX3RvcFNlY3Rpb24odGlwbywgdGl0dWxvLCByb3dzKSB7XG4gIGNvbnN0IGFiaWVydG8gPSBzdGF0ZS52ZXJNYXNbdGlwb107XG4gIGNvbnN0IHRvdGFsID0gcm93cy5sZW5ndGg7XG4gIGNvbnN0IGggPSBNYXRoLm1heCgxMjAsIE1hdGgubWluKFRPUF9OLCB0b3RhbCkgKiAyMiArIDQwKTtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLXZlcm1hcz1cIicgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICtcbiAgICAgICAgKGFiaWVydG8gPyAndHJ1ZScgOiAnZmFsc2UnKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgKGFiaWVydG8gPyAnVmVyIG1lbm9zJyA6ICdWZXIgbVx1MDBFMXMnKSArXG4gICAgICAgICcgKCcgK1xuICAgICAgICB0b3RhbCArXG4gICAgICAgICcpPC9idXR0b24+J1xuICAgICAgOiAnJykgK1xuICAgICc8L2Rpdj4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDonICtcbiAgICAgICAgaCArXG4gICAgICAgICdweFwiPjxjYW52YXMgaWQ9XCJkdi1jaGFydC10b3AtJyArXG4gICAgICAgIHRpcG8gK1xuICAgICAgICAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICtcbiAgICAgICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgICAgICdcIj48L2NhbnZhcz48L2Rpdj4nXG4gICAgICA6ICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gZGF0b3MuPC9kaXY+JykgK1xuICAgIChhYmllcnRvID8gX3Zlck1hc1RhYmxhKHRpcG8sIHJvd3MpIDogJycpICtcbiAgICAnPC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xpbmVTZWN0aW9uKGlkLCB0aXR1bG8pIHtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz48L2Rpdj48ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDoyNDBweFwiPjxjYW52YXMgaWQ9XCInICtcbiAgICBpZCArXG4gICAgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJ1wiPjwvY2FudmFzPjwvZGl2Pjwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9pc0VtcHR5KGQpIHtcbiAgaWYgKCFkKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgY29uc3QgaGF5S3BpID1cbiAgICBOdW1iZXIoay5mYWN0dXJhZG8pIHx8IE51bWJlcihrLnBlZGlkb3MpIHx8IE51bWJlcihrLnBlZGlkb3NVbmljb3MpIHx8IE51bWJlcihrLmJhY2tvcmRlckFycyk7XG4gIGNvbnN0IGhheVRvcCA9IEFycmF5LmlzQXJyYXkoZC50b3BVbmlkYWRlcykgJiYgZC50b3BVbmlkYWRlcy5sZW5ndGggPiAwO1xuICBjb25zdCBoYXlTZXJpZSA9IEFycmF5LmlzQXJyYXkoZC5zZXJpZVZlbnRhcykgJiYgZC5zZXJpZVZlbnRhcy5zb21lKChwKSA9PiBOdW1iZXIocC52YWxvcikpO1xuICByZXR1cm4gIWhheUtwaSAmJiAhaGF5VG9wICYmICFoYXlTZXJpZTtcbn1cblxuLyoqIFJlc3VsdGFkb3MgKGxleWVuZGEsIHRhcmpldGFzLCByYW5raW5ncywgZ3JcdTAwRTFmaWNvcykuIE5vIHRvY2EgbG9zIGZpbHRyb3MuICovXG5mdW5jdGlvbiByZW5kZXJSZXN1bHRzKCkge1xuICBjb25zdCByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKTtcbiAgaWYgKCFyb290KSByZXR1cm47XG4gIGNvbnN0IGQgPSBzdGF0ZS5kYXRhO1xuXG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGFcIj5Nb250b3Mgc2luIElWQSwgY29uIGRlc2N1ZW50byBhcGxpY2FkbyB5IG5vdGFzIGRlIGNyXHUwMEU5ZGl0byByZXN0YWRhcy4nO1xuICBpZiAoZCAmJiBkLmRhdGFVcGRhdGVkQXQgJiYgIXN0YXRlLmxvYWRpbmcpIHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZC5kYXRhVXBkYXRlZEF0KTtcbiAgICBpZiAoIU51bWJlci5pc05hTih0LmdldFRpbWUoKSkpIHtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJyA8c3BhbiBjbGFzcz1cImR2LW11dGVkXCI+XHUwMEI3IENhbGN1bGFkbyAnICtcbiAgICAgICAgX2VzY0h0bWwodC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pKSArXG4gICAgICAgICc8L3NwYW4+JztcbiAgICB9XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICBpZiAoc3RhdGUubG9hZGluZykge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5DYXJnYW5kb1x1MjAyNjwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZXJyb3IpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWVzdGFkbyBkdi1lcnJvclwiPicgKyBfZXNjSHRtbChzdGF0ZS5lcnJvcikucmVwbGFjZSgvXFxuL2csICc8YnI+JykgKyAnPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkICYmIF9pc0VtcHR5KGQpKSB7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImR2LWVzdGFkb1wiPk5vIGhheSB2ZW50YXMgY29uIGVzb3MgZmlsdHJvcy48L2Rpdj4nO1xuICB9IGVsc2UgaWYgKGQpIHtcbiAgICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1jYXJkc1wiPic7XG4gICAgaHRtbCArPSBfY2FyZCgnRmFjdHVyYWRvIG1lbnN1YWwnLCBfZm10QXJzKGsuZmFjdHVyYWRvKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnVmFsb3JpemFjaVx1MDBGM24gYmFja29yZGVyJywgX2ZtdEFycyhrLmJhY2tvcmRlckFycykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIGRlIHBlZGlkb3MgZGVsIG1lcycsIF9mbXRVZHMoay5wZWRpZG9zKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnQ2FudC4gcGVkaWRvcyBcdTAwRkFuaWNvcycsIF9mbXRVZHMoay5wZWRpZG9zVW5pY29zKSk7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICBodG1sICs9IF9nZXN0aW9uU2VjdGlvbihkLmdlc3Rpb24sIGQuc2VjY2lvbmVzLCBzdGF0ZS5pbnRlclF1ZXJ5KTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCd1bmlkYWRlcycsICdUb3AgMjAgU0tVIC0gVW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdKTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCdkaW5lcm8nLCAnVG9wIDIwIFNLVSAtIERpbmVybycsIGQudG9wRGluZXJvIHx8IFtdKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtdmVudGFzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlIHZlbnRhcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby11ZHMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIFVuaWRhZGVzJyk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LWJvLWFycycsICdFdm9sdWNpXHUwMEYzbiBkZWwgYmFja29yZGVyIC0gRGluZXJvJyk7XG4gIH1cblxuICBfZGVzdHJveUNoYXJ0cygpO1xuICByb290LmlubmVySFRNTCA9IGh0bWw7XG4gIC8vIEVsIHRleHRvIGRlbCBidXNjYWRvciBkZSBcIlZlciBtXHUwMEUxc1wiIHNlIHBvbmUgcG9yIERPTSwgbnVuY2EgZGVudHJvIGRlbCBIVE1MLlxuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W2RhdGEtdmVybWFzLXNlYXJjaF0nKS5mb3JFYWNoKChpbnApID0+IHtcbiAgICBjb25zdCBrID0gaW5wLmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMtc2VhcmNoJyk7XG4gICAgaWYgKGspIC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGlucCkudmFsdWUgPSBzdGF0ZS52ZXJNYXNRdWVyeVtrXSB8fCAnJztcbiAgfSk7XG5cbiAgY29uc3QgaW50ZXJJbnAgPSByb290LnF1ZXJ5U2VsZWN0b3IoJyNkdi1pbnRlcmFjY2lvbmVzLWJ1c2NhcicpO1xuICBpZiAoaW50ZXJJbnApIC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGludGVySW5wKS52YWx1ZSA9IHN0YXRlLmludGVyUXVlcnkgfHwgJyc7XG5cbiAgLy8gU2luIG1vZGFsIGFiaWVydG8gbm8gc2UgZGlidWphIChyZXNwdWVzdGEgcXVlIGxsZWdcdTAwRjMgZGVzcHVcdTAwRTlzIGRlIGNlcnJhcikuXG4gIGlmIChfaXNPcGVuKCkgJiYgIXN0YXRlLmxvYWRpbmcgJiYgIXN0YXRlLmVycm9yICYmIGQgJiYgIV9pc0VtcHR5KGQpKSB7XG4gICAgX2xvYWRDaGFydEpzKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKF9pc09wZW4oKSAmJiBzdGF0ZS5kYXRhID09PSBkKSBfZHJhd0NoYXJ0cyhkKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBpZiAoIV9lbnN1cmVTa2VsZXRvbigpKSByZXR1cm47XG4gIHJlbmRlckZpbHRyb3MoZmFsc2UpO1xuICBfc3luY0FwbGljYXJEaXNhYmxlZCgpO1xuICByZW5kZXJSZXN1bHRzKCk7XG59XG5cbmZ1bmN0aW9uIF9jc3NWYXIobmFtZSwgZmFsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB2ID0gZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmdldFByb3BlcnR5VmFsdWUobmFtZSkudHJpbSgpO1xuICAgIHJldHVybiB2IHx8IGZhbGxiYWNrO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5jb25zdCBDSEFSVF9GT05UID1cbiAgXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTRiBQcm8gVGV4dCcsICdTZWdvZSBVSScsIHN5c3RlbS11aSwgc2Fucy1zZXJpZlwiO1xuY29uc3QgQ0hBUlRfR1JJRF9MSUdIVCA9ICdyZ2JhKDAsMCwwLC4wNiknO1xuY29uc3QgQ0hBUlRfR1JJRF9EQVJLID0gJ3JnYmEoMjU1LDI1NSwyNTUsLjA4KSc7XG5cbi8qKiBHcmlsbGEgc3VhdmU7IGVuIHRlbWEgb3NjdXJvIHVzYSBibGFuY28gdHJhbnNsXHUwMEZBY2lkbyBwYXJhIHF1ZSBzZSB2ZWEuICovXG5mdW5jdGlvbiBfY2hhcnRHcmlkKCkge1xuICBjb25zdCBkYXJrID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmdldEF0dHJpYnV0ZSgnZGF0YS10aGVtZScpID09PSAnZGFyayc7XG4gIHJldHVybiB7IGNvbG9yOiBkYXJrID8gQ0hBUlRfR1JJRF9EQVJLIDogQ0hBUlRfR1JJRF9MSUdIVCB9O1xufVxuXG5mdW5jdGlvbiBfYmFyQ2hhcnQoY2FudmFzSWQsIHJvd3MsIGZpZWxkLCBmbXQsIGNvbG9yKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgLy8gU3BlYzogU0tVcyBjb24gbmV0byA8PSAwIG5vIGVudHJhbiBhbCBUb3AgKGxhIHRhYmxhIFwiVmVyIG1cdTAwRTFzXCIgc1x1MDBFRCBsb3MgbXVlc3RyYSkuXG4gIGNvbnN0IHRvcCA9IHJvd3MuZmlsdGVyKChyKSA9PiAoTnVtYmVyKHJbZmllbGRdKSB8fCAwKSA+IDApLnNsaWNlKDAsIFRPUF9OKTtcbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnYmFyJyxcbiAgICBkYXRhOiB7XG4gICAgICBsYWJlbHM6IHRvcC5tYXAoKHIpID0+IFN0cmluZyhyLnNrdSkpLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAgeyBkYXRhOiB0b3AubWFwKChyKSA9PiBOdW1iZXIocltmaWVsZF0pIHx8IDApLCBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLCBib3JkZXJSYWRpdXM6IDMgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBpbmRleEF4aXM6ICd5JyxcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICB0b29sdGlwOiB7XG4gICAgICAgICAgY2FsbGJhY2tzOiB7XG4gICAgICAgICAgICB0aXRsZTogKGl0ZW1zKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSB0b3BbaXRlbXNbMF0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBTdHJpbmcoci5za3UpICsgKHIuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHIuZGVzYykgOiAnJykgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogKGl0ZW0pID0+IGZtdChpdGVtLnJhdyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeDoge1xuICAgICAgICAgIGdyaWQ6IF9jaGFydEdyaWQoKSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgZm9udDogeyBmYW1pbHk6IENIQVJUX0ZPTlQgfSxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHk6IHtcbiAgICAgICAgICBncmlkOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAsIGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1zZWNvbmRhcnknLCAnIzMzNDE1NScpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG4vKipcbiAqIFNlcmllIGRlIGJhY2sgb3JkZXIgZW4gMiBkYXRhc2V0czogcmVhbCAobFx1MDBFRG5lYSBsbGVuYSkgeSBlc3RpbWFkbyAocHVudGVhZGEpLlxuICogVW4gcHVudG8gZXN0aW1hZG8gc2UgY29uZWN0YSBjb24gc3UgdmVjaW5vIHJlYWwgcGFyYSBxdWUgbGEgY3VydmEgbm8gcXVlZGVcbiAqIGNvcnRhZGEgZW4gbGEgdHJhbnNpY2lcdTAwRjNuOyBgbnVsbGAgKHNpbiBkYXRvcykgY29ydGEgbGEgbFx1MDBFRG5lYSAoc3BhbkdhcHM6ZmFsc2UpLlxuICovXG5mdW5jdGlvbiBfc3BsaXRCYWNrb3JkZXIoc2VyaWUpIHtcbiAgY29uc3QgcmVhbCA9IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCB8fCBwLmVzdGltYWRvID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpO1xuICBjb25zdCBlc3QgPSBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgfHwgIXAuZXN0aW1hZG8gPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VyaWUubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZXN0W2ldID09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChpICsgMSA8IHNlcmllLmxlbmd0aCAmJiByZWFsW2kgKyAxXSAhPSBudWxsKSBlc3RbaSArIDFdID0gcmVhbFtpICsgMV07XG4gICAgaWYgKGkgLSAxID49IDAgJiYgcmVhbFtpIC0gMV0gIT0gbnVsbCAmJiBlc3RbaSAtIDFdID09IG51bGwpIGVzdFtpIC0gMV0gPSByZWFsW2kgLSAxXTtcbiAgfVxuICByZXR1cm4geyByZWFsLCBlc3QsIGhheUVzdGltYWRvOiBzZXJpZS5zb21lKChwKSA9PiBwLmVzdGltYWRvICYmIHAudmFsb3IgIT0gbnVsbCkgfTtcbn1cblxuZnVuY3Rpb24gX2xpbmVDaGFydChjYW52YXNJZCwgc2VyaWUsIGZtdCwgY29sb3IsIGNvbkVzdGltYWRvKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgY29uc3QgbGFiZWxzID0gc2VyaWUubWFwKChwKSA9PiBfbGFiZWxNZXMocC5tZXMpKTtcbiAgY29uc3QgZGF0YXNldHMgPSBbXTtcbiAgaWYgKGNvbkVzdGltYWRvKSB7XG4gICAgY29uc3QgcyA9IF9zcGxpdEJhY2tvcmRlcihzZXJpZSk7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ3JlYWwnLFxuICAgICAgZGF0YTogcy5yZWFsLFxuICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgIHRlbnNpb246IDAuMixcbiAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgIH0pO1xuICAgIGlmIChzLmhheUVzdGltYWRvKSB7XG4gICAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgICAgbGFiZWw6ICdlc3RpbWFkbycsXG4gICAgICAgIGRhdGE6IHMuZXN0LFxuICAgICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICAgIGJvcmRlckRhc2g6IFs2LCA0XSxcbiAgICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgICAgICBwb2ludFN0eWxlOiAncmVjdFJvdCcsXG4gICAgICB9KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ2ZhY3R1cmFkbycsXG4gICAgICBkYXRhOiBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSksXG4gICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgfSk7XG4gIH1cbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnbGluZScsXG4gICAgZGF0YTogeyBsYWJlbHMsIGRhdGFzZXRzIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgcmVzcG9uc2l2ZTogdHJ1ZSxcbiAgICAgIG1haW50YWluQXNwZWN0UmF0aW86IGZhbHNlLFxuICAgICAgYW5pbWF0aW9uOiBmYWxzZSxcbiAgICAgIHBsdWdpbnM6IHtcbiAgICAgICAgbGVnZW5kOiB7IGRpc3BsYXk6IGNvbkVzdGltYWRvICYmIGRhdGFzZXRzLmxlbmd0aCA+IDEgfSxcbiAgICAgICAgdG9vbHRpcDogeyBjYWxsYmFja3M6IHsgbGFiZWw6IChpdGVtKSA9PiBpdGVtLmRhdGFzZXQubGFiZWwgKyAnOiAnICsgZm10KGl0ZW0ucmF3KSB9IH0sXG4gICAgICB9LFxuICAgICAgc2NhbGVzOiB7XG4gICAgICAgIHk6IHtcbiAgICAgICAgICBiZWdpbkF0WmVybzogdHJ1ZSxcbiAgICAgICAgICBncmlkOiBfY2hhcnRHcmlkKCksXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGZvbnQ6IHsgZmFtaWx5OiBDSEFSVF9GT05UIH0sXG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IGZtdCh2KSxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDYsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB4OiB7XG4gICAgICAgICAgZ3JpZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIGJvcmRlcjogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIHRpY2tzOiB7IGZvbnQ6IHsgZmFtaWx5OiBDSEFSVF9GT05UIH0sIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBfZHJhd0NoYXJ0cyhkKSB7XG4gIC8vIFB1ZWRlIHF1ZSBlbCB1c3VhcmlvIGhheWEgcmUtcmVuZGVyaXphZG8gbWllbnRyYXMgY2FyZ2FiYSBDaGFydC5qcy5cbiAgX2Rlc3Ryb3lDaGFydHMoKTtcbiAgX2JhckNoYXJ0KCdkdi1jaGFydC10b3AtdW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdLCAndWRzJywgX2ZtdFVkcywgJyMwMjg0YTAnKTtcbiAgX2JhckNoYXJ0KCdkdi1jaGFydC10b3AtZGluZXJvJywgZC50b3BEaW5lcm8gfHwgW10sICdhcnMnLCBfZm10QXJzLCAnIzE2YTM0YScpO1xuICBfbGluZUNoYXJ0KCdkdi1jaGFydC12ZW50YXMnLCBkLnNlcmllVmVudGFzIHx8IFtdLCBfZm10QXJzLCAnIzFlNDBhZicsIGZhbHNlKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtYm8tdWRzJywgZC5zZXJpZUJvVWRzIHx8IFtdLCBfZm10VWRzLCAnI2MyNDEwYycsIHRydWUpO1xuICBfbGluZUNoYXJ0KCdkdi1jaGFydC1iby1hcnMnLCBkLnNlcmllQm9BcnMgfHwgW10sIF9mbXRBcnMsICcjOWYxMjM5JywgdHJ1ZSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGF0b3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfZmlsdHJvc1BheWxvYWQoKSB7XG4gIHJldHVybiB7XG4gICAgbWVzOiBzdGF0ZS5tZXMsXG4gICAgdmVuZGVkb3JlczogX2lzVmVuZGVkb3IoKSA/IFtdIDogc3RhdGUuc2VsLnZlbmRlZG9yZXMuc2xpY2UoKSxcbiAgICBjbGllbnRlczogc3RhdGUuc2VsLmNsaWVudGVzLnNsaWNlKCksXG4gICAgcHJvdmluY2lhczogc3RhdGUuc2VsLnByb3ZpbmNpYXMuc2xpY2UoKSxcbiAgICBjYXRlZ29yaWFzOiBzdGF0ZS5zZWwuY2F0ZWdvcmlhcy5zbGljZSgpLFxuICAgIHNrdXM6IHN0YXRlLnNlbC5za3VzLnNsaWNlKCksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNhcmdhcigpIHtcbiAgY29uc3Qgc2VxID0gKytzdGF0ZS5yZXFTZXE7XG4gIHN0YXRlLmxvYWRpbmcgPSB0cnVlO1xuICBzdGF0ZS5lcnJvciA9ICcnO1xuICByZW5kZXIoKTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIGZpcmViYXNlID09PSAndW5kZWZpbmVkJyB8fCAhZmlyZWJhc2UuYXBwKSB0aHJvdyBuZXcgRXJyb3IoJ2ZpcmViYXNlIG5vIGRpc3BvbmlibGUnKTtcbiAgICBjb25zdCBjYWxsYWJsZSA9IGZpcmViYXNlLmFwcCgpLmZ1bmN0aW9ucyhSRUdJT04pLmh0dHBzQ2FsbGFibGUoJ2Rhc2hib2FyZFZlbnRhc0NGJyk7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgY2FsbGFibGUoX2ZpbHRyb3NQYXlsb2FkKCkpO1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIHN0YXRlLmRhdGEgPSAocmVzICYmIHJlcy5kYXRhKSB8fCBudWxsO1xuICAgIGlmIChzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEub3BjaW9uZXMpIHN0YXRlLm9wY2lvbmVzID0gc3RhdGUuZGF0YS5vcGNpb25lcztcbiAgICBzdGF0ZS52ZXJNYXMgPSB7IHVuaWRhZGVzOiBmYWxzZSwgZGluZXJvOiBmYWxzZSB9O1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKHNlcSAhPT0gc3RhdGUucmVxU2VxKSByZXR1cm47XG4gICAgY29uc29sZS5lcnJvcignW2Rhc2hib2FyZC12ZW50YXNdIGRhc2hib2FyZFZlbnRhc0NGIGZhbGxvOicsIGUpO1xuICAgIHN0YXRlLmVycm9yID0gX2Vycm9yTWVzc2FnZSgpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChzZXEgPT09IHN0YXRlLnJlcVNlcSkge1xuICAgICAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXZlbnRvcyAoZGVsZWdhZG9zIHNvYnJlIGVsIGJvZHkgZGVsIG1vZGFsKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmxldCBfd2lyZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIF93aXJlKCkge1xuICBpZiAoX3dpcmVkKSByZXR1cm47XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuO1xuICBfd2lyZWQgPSB0cnVlO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICghKHQgaW5zdGFuY2VvZiBFbGVtZW50KSkgcmV0dXJuO1xuICAgIGNvbnN0IGFjdCA9IHQuY2xvc2VzdCgnW2RhdGEtZHYtYWN0aW9uXScpO1xuICAgIGlmIChhY3QpIHtcbiAgICAgIGNvbnN0IGEgPSBhY3QuZ2V0QXR0cmlidXRlKCdkYXRhLWR2LWFjdGlvbicpO1xuICAgICAgaWYgKGEgPT09ICdhcGxpY2FyJykge1xuICAgICAgICBfcmVhZFNlbEZyb21Eb20oYm9keSk7XG4gICAgICAgIGNhcmdhcigpO1xuICAgICAgfSBlbHNlIGlmIChhID09PSAnbGltcGlhcicpIHtcbiAgICAgICAgc3RhdGUuc2VsID0gX3NlbFZhY2lhKCk7XG4gICAgICAgIHN0YXRlLm1lcyA9IF9tZXNBY3R1YWxBcnQoKTtcbiAgICAgICAgcmVuZGVyRmlsdHJvcyh0cnVlKTtcbiAgICAgICAgY2FyZ2FyKCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHZtID0gdC5jbG9zZXN0KCdbZGF0YS12ZXJtYXNdJyk7XG4gICAgaWYgKHZtKSB7XG4gICAgICBjb25zdCB0aXBvID0gdm0uZ2V0QXR0cmlidXRlKCdkYXRhLXZlcm1hcycpID09PSAnZGluZXJvJyA/ICdkaW5lcm8nIDogJ3VuaWRhZGVzJztcbiAgICAgIHN0YXRlLnZlck1hc1t0aXBvXSA9ICFzdGF0ZS52ZXJNYXNbdGlwb107XG4gICAgICAvLyBTb2xvIHJlc3VsdGFkb3M6IG5vIHNlIGxlZW4gbmkgc2UgcGlzYW4gZmlsdHJvcyBzaW4gYXBsaWNhci5cbiAgICAgIHJlbmRlclJlc3VsdHMoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xyID0gdC5jbG9zZXN0KCdbZGF0YS1tcy1jbGVhcl0nKTtcbiAgICBpZiAoY2xyKSB7XG4gICAgICBjb25zdCBrZXkgPSBjbHIuZ2V0QXR0cmlidXRlKCdkYXRhLW1zLWNsZWFyJyk7XG4gICAgICBib2R5LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXVtkYXRhLWZpbHRybz1cIicgKyBrZXkgKyAnXCJdJykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICAgICAgZWwuY2hlY2tlZCA9IGZhbHNlO1xuICAgICAgfSk7XG4gICAgICBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpO1xuICAgIH1cbiAgfSk7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICh0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCAmJiB0LnR5cGUgPT09ICdjaGVja2JveCcgJiYgdC5oYXNBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJykpIHtcbiAgICAgIF91cGRhdGVTdW1tYXJ5KGJvZHksIHQuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpKTtcbiAgICB9XG4gIH0pO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICghKHQgaW5zdGFuY2VvZiBIVE1MSW5wdXRFbGVtZW50KSkgcmV0dXJuO1xuICAgIGNvbnN0IG1zS2V5ID0gdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbXMtc2VhcmNoJyk7XG4gICAgaWYgKG1zS2V5KSB7XG4gICAgICBjb25zdCBxID0gdC52YWx1ZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICAgIGNvbnN0IGRldCA9IGJvZHkucXVlcnlTZWxlY3RvcignZGV0YWlsc1tkYXRhLW1zPVwiJyArIG1zS2V5ICsgJ1wiXScpO1xuICAgICAgaWYgKCFkZXQpIHJldHVybjtcbiAgICAgIGRldC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtbXMtb3B0JykuZm9yRWFjaCgob3B0KSA9PiB7XG4gICAgICAgIGNvbnN0IHMgPSBvcHQuZ2V0QXR0cmlidXRlKCdkYXRhLXNlYXJjaCcpIHx8ICcnO1xuICAgICAgICBvcHQuc3R5bGUuZGlzcGxheSA9ICFxIHx8IHMuaW5jbHVkZXMocSkgPyAnJyA6ICdub25lJztcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodC5pZCA9PT0gJ2R2LWludGVyYWNjaW9uZXMtYnVzY2FyJykge1xuICAgICAgc3RhdGUuaW50ZXJRdWVyeSA9IHQudmFsdWU7XG4gICAgICBjb25zdCBnID0gc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLmdlc3Rpb247XG4gICAgICBjb25zdCB0aSA9IChnICYmIGcudGFibGFJbnRlcmFjY2lvbmVzKSB8fCB7IHJvd3M6IFtdLCB0b3RhbDogMCB9O1xuICAgICAgY29uc3QgY29udCA9IGJvZHkucXVlcnlTZWxlY3RvcignI2R2LWludGVyYWNjaW9uZXMgLmR2LWludGVyLWJvZHknKTtcbiAgICAgIGlmIChjb250KSBjb250LmlubmVySFRNTCA9IF9pbnRlcmFjY2lvbmVzVGFibGEodGkucm93cywgdGkudG90YWwsIHN0YXRlLmludGVyUXVlcnkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bUF0dHIgPSB0LmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMtc2VhcmNoJyk7XG4gICAgaWYgKHZtQXR0cikge1xuICAgICAgLy8gU29sbyBkb3MgcmFua2luZ3MgcG9zaWJsZXM6IG51bmNhIHJldXNhciBlbCB0ZXh0byBkZWwgYXRyaWJ1dG8gZW4gZWwgSFRNTC5cbiAgICAgIGNvbnN0IHZtS2V5ID0gdm1BdHRyID09PSAnZGluZXJvJyA/ICdkaW5lcm8nIDogJ3VuaWRhZGVzJztcbiAgICAgIHN0YXRlLnZlck1hc1F1ZXJ5W3ZtS2V5XSA9IHQudmFsdWU7XG4gICAgICBjb25zdCBzZWMgPSB0LmNsb3Nlc3QoJy5kdi12ZXJtYXMnKTtcbiAgICAgIGNvbnN0IHJvd3MgPVxuICAgICAgICAoc3RhdGUuZGF0YSAmJiAodm1LZXkgPT09ICd1bmlkYWRlcycgPyBzdGF0ZS5kYXRhLnRvcFVuaWRhZGVzIDogc3RhdGUuZGF0YS50b3BEaW5lcm8pKSB8fFxuICAgICAgICBbXTtcbiAgICAgIGlmIChzZWMpIHtcbiAgICAgICAgY29uc3QgdG1wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRtcC5pbm5lckhUTUwgPSBfdmVyTWFzVGFibGEodm1LZXksIHJvd3MpO1xuICAgICAgICBjb25zdCBuZXdXcmFwID0gdG1wLnF1ZXJ5U2VsZWN0b3IoJy5kdi10YWJsZS13cmFwJyk7XG4gICAgICAgIGNvbnN0IG9sZFdyYXAgPSBzZWMucXVlcnlTZWxlY3RvcignLmR2LXRhYmxlLXdyYXAnKTtcbiAgICAgICAgaWYgKG5ld1dyYXAgJiYgb2xkV3JhcCkgb2xkV3JhcC5yZXBsYWNlV2l0aChuZXdXcmFwKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpIHtcbiAgY29uc3QgZGV0ID0gYm9keS5xdWVyeVNlbGVjdG9yKCdkZXRhaWxzW2RhdGEtbXM9XCInICsga2V5ICsgJ1wiXScpO1xuICBpZiAoIWRldCkgcmV0dXJuO1xuICBjb25zdCBjaGVja2VkID0gQXJyYXkuZnJvbShkZXQucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdOmNoZWNrZWQnKSk7XG4gIGNvbnN0IHN1bSA9IGRldC5xdWVyeVNlbGVjdG9yKCdzdW1tYXJ5Jyk7XG4gIGlmICghc3VtKSByZXR1cm47XG4gIGlmIChjaGVja2VkLmxlbmd0aCA9PT0gMCkgc3VtLnRleHRDb250ZW50ID0gJ1RvZG9zJztcbiAgZWxzZSBpZiAoY2hlY2tlZC5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzcGFuID0gY2hlY2tlZFswXS5wYXJlbnRFbGVtZW50ICYmIGNoZWNrZWRbMF0ucGFyZW50RWxlbWVudC5xdWVyeVNlbGVjdG9yKCdzcGFuJyk7XG4gICAgc3VtLnRleHRDb250ZW50ID0gc3BhbiA/IHNwYW4udGV4dENvbnRlbnQgOiBjaGVja2VkWzBdLnZhbHVlO1xuICB9IGVsc2Ugc3VtLnRleHRDb250ZW50ID0gY2hlY2tlZC5sZW5ndGggKyAnIHNlbGVjY2lvbmFkb3MnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFQSSBwXHUwMEZBYmxpY2EgKGV4cG9ydHMgZGVsIGNodW5rKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbndpbmRvdy5vcGVuRGFzaGJvYXJkVmVudGFzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHJldHVybjtcbiAgY29uc3Qgcm9sZSA9IF9yb2xlKCk7XG4gIGlmIChyb2xlICE9PSAnYWRtaW4nICYmIHJvbGUgIT09ICdnZXJlbnRlJyAmJiByb2xlICE9PSAndmVuZGVkb3InKSB7XG4gICAgYWxlcnQoJ1R1IHVzdWFyaW8gbm8gdGllbmUgYWNjZXNvIGFsIERhc2hib2FyZCBkZSBWZW50YXMuIFNpIGxvIG5lY2VzaXRcdTAwRTFzLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3RybyB1c3VhcmlvIGVuIGxhIG1pc21hIHBlc3RhXHUwMEYxYSAobG9nb3V0ICsgbG9naW4gc2luIHJlY2FyZ2FyKTogc2VcbiAgLy8gZGVzY2FydGEgdG9kbyBsbyBkZWwgYW50ZXJpb3IuIE1pc21vIHVzdWFyaW86IHNlIGNvbnNlcnZhIHN1IHNlbGVjY2lcdTAwRjNuLlxuICBjb25zdCB1aWQgPSBfY3VycmVudFVpZCgpO1xuICBpZiAodWlkICE9PSBzdGF0ZS51aWQpIF9yZXNldFN0YXRlKHVpZCk7XG4gIGlmICghc3RhdGUubWVzKSBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIG1vZGFsLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgX2Vuc3VyZVNrZWxldG9uKCk7XG4gIF93aXJlKCk7XG4gIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gIC8vIFByZWNhcmdhIENoYXJ0LmpzIGVuIHBhcmFsZWxvIGEgbGEgY29uc3VsdGEuXG4gIF9sb2FkQ2hhcnRKcygpLmNhdGNoKCgpID0+IHt9KTtcbiAgLy8gU2llbXByZSBzZSBwaWRlIGRlIG51ZXZvIGFsIGFicmlyIChlbCBzZXJ2aWRvciBjYWNoZWEgMTAgbWluKS5cbiAgY2FyZ2FyKCk7XG59O1xuXG53aW5kb3cuY2xvc2VEYXNoYm9hcmRWZW50YXMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgaWYgKG1vZGFsKSBtb2RhbC5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIC8vIExvcyBkYXRvcyBubyBzZSBndWFyZGFuIGVudHJlIGFwZXJ0dXJhczsgc2UgdnVlbHZlbiBhIHBlZGlyIGFsIGFicmlyLlxuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICBzdGF0ZS5yZXFTZXErKztcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFpQkEsTUFBTSxlQUFlO0FBQ3JCLE1BQU0sUUFBUTtBQUNkLE1BQU0sU0FBUztBQUVmLE1BQU0sY0FBYztBQUFBLElBQ2xCLEVBQUUsS0FBSyxjQUFjLE9BQU8sV0FBVztBQUFBLElBQ3ZDLEVBQUUsS0FBSyxZQUFZLE9BQU8sVUFBVTtBQUFBLElBQ3BDLEVBQUUsS0FBSyxjQUFjLE9BQU8sWUFBWTtBQUFBLElBQ3hDLEVBQUUsS0FBSyxjQUFjLE9BQU8sZUFBWTtBQUFBLElBQ3hDLEVBQUUsS0FBSyxRQUFRLE9BQU8sTUFBTTtBQUFBLEVBQzlCO0FBRUEsV0FBUyxZQUFZO0FBQ25C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
