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
  var CHART_GRID = { color: "rgba(0,0,0,.06)" };
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
            grid: CHART_GRID,
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
            grid: CHART_GRID,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI5LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlIH0sXG4gIHZlck1hc1F1ZXJ5OiB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJyB9LFxuICBpbnRlclF1ZXJ5OiAnJyxcbiAgcmVxU2VxOiAwLFxufTtcblxuZnVuY3Rpb24gX3Jlc2V0U3RhdGUodWlkKSB7XG4gIHN0YXRlLnVpZCA9IHVpZDtcbiAgc3RhdGUubWVzID0gX21lc0FjdHVhbEFydCgpO1xuICBzdGF0ZS5zZWwgPSBfc2VsVmFjaWEoKTtcbiAgc3RhdGUuZGF0YSA9IG51bGw7XG4gIHN0YXRlLm9wY2lvbmVzID0gbnVsbDtcbiAgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9IG51bGw7XG4gIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgc3RhdGUudmVyTWFzID0geyB1bmlkYWRlczogZmFsc2UsIGRpbmVybzogZmFsc2UgfTtcbiAgc3RhdGUudmVyTWFzUXVlcnkgPSB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJyB9O1xuICBzdGF0ZS5pbnRlclF1ZXJ5ID0gJyc7XG4gIHN0YXRlLnJlcVNlcSsrO1xufVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG5jb25zdCBjaGFydHMgPSB7fTtcbmxldCBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEVzY2FwZSBsb2NhbCAobWlzbW8gcmVzdWx0YWRvIHF1ZSB3aW5kb3cuZXNjYXBlSHRtbCk6IGVsIGFuXHUwMEUxbGlzaXMgZGVcbi8vIHNlZ3VyaWRhZCBkZWwgcmVwbyAoQ29kZVFMKSBzb2xvIHJlY29ub2NlIHVuIHNhbml0aXphZG9yIHZpc2libGUgYWNcdTAwRTEuXG5mdW5jdGlvbiBfZXNjSHRtbChzKSB7XG4gIGNvbnN0IHYgPSBzID09IG51bGwgPyAnJyA6IHM7XG4gIHJldHVybiBTdHJpbmcodilcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKVxuICAgIC5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xufVxuXG5mdW5jdGlvbiBfZm10QXJzKG4pIHtcbiAgY29uc3QgdiA9IE51bWJlcihuKSB8fCAwO1xuICByZXR1cm4gJyQnICsgTWF0aC5yb3VuZCh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX2ZtdFVkcyhuKSB7XG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSB8fCAwKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX3JvbGUoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdXNlclJvbGUgIT09ICd1bmRlZmluZWQnID8gdXNlclJvbGUgOiB3aW5kb3cudXNlclJvbGUpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy51c2VyUm9sZSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9teVZlbmRvcigpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKHR5cGVvZiBhc3NpZ25lZFZlbmRvciAhPT0gJ3VuZGVmaW5lZCcgPyBhc3NpZ25lZFZlbmRvciA6IHdpbmRvdy5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgfVxufVxuXG5mdW5jdGlvbiBfY3VycmVudFVpZCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1ID0gdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRVc2VyIDogd2luZG93LmN1cnJlbnRVc2VyO1xuICAgIHJldHVybiAodSAmJiB1LnVpZCkgfHwgbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIudWlkKSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9pc09wZW4oKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgcmV0dXJuICEhKG1vZGFsICYmIG1vZGFsLmNsYXNzTGlzdCAmJiBtb2RhbC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSk7XG59XG5cbmZ1bmN0aW9uIF9pc1ZlbmRlZG9yKCkge1xuICByZXR1cm4gX3JvbGUoKSA9PT0gJ3ZlbmRlZG9yJztcbn1cblxuLyoqIE1lcyBlbiBjdXJzbyBlbiBob3JhIEFyZ2VudGluYSwgZm9ybWF0byBBQUFBLU1NLiAqL1xuZnVuY3Rpb24gX21lc0FjdHVhbEFydCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJ0cyA9IG5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KCdlbi1DQScsIHtcbiAgICAgIHRpbWVab25lOiAnQW1lcmljYS9BcmdlbnRpbmEvQnVlbm9zX0FpcmVzJyxcbiAgICAgIHllYXI6ICdudW1lcmljJyxcbiAgICAgIG1vbnRoOiAnMi1kaWdpdCcsXG4gICAgfSkuZm9ybWF0VG9QYXJ0cyhuZXcgRGF0ZSgpKTtcbiAgICBjb25zdCB5ID0gcGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAneWVhcicpLnZhbHVlO1xuICAgIGNvbnN0IG0gPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICdtb250aCcpLnZhbHVlO1xuICAgIHJldHVybiB5ICsgJy0nICsgbTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbn1cblxuY29uc3QgTUVTRVNfQ09SVE9TID0gW1xuICAnZW5lJyxcbiAgJ2ZlYicsXG4gICdtYXInLFxuICAnYWJyJyxcbiAgJ21heScsXG4gICdqdW4nLFxuICAnanVsJyxcbiAgJ2FnbycsXG4gICdzZXAnLFxuICAnb2N0JyxcbiAgJ25vdicsXG4gICdkaWMnLFxuXTtcbmZ1bmN0aW9uIF9sYWJlbE1lcyhhYWFhbW0pIHtcbiAgY29uc3QgcyA9IFN0cmluZyhhYWFhbW0gfHwgJycpO1xuICBjb25zdCBtID0gTnVtYmVyKHMuc2xpY2UoNSwgNykpO1xuICBpZiAoIW0pIHJldHVybiBzO1xuICByZXR1cm4gTUVTRVNfQ09SVE9TW20gLSAxXSArICcgJyArIHMuc2xpY2UoMiwgNCk7XG59XG5cbmZ1bmN0aW9uIF9lcnJvck1lc3NhZ2UoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgbXYgPSB3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUubWVuc2FqZXNWZW5kZWRvcjtcbiAgICBpZiAobXYgJiYgdHlwZW9mIG12LmZvcm1hdE1lbnNhamVDb25Db2RpZ28gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBtdi5mb3JtYXRNZW5zYWplQ29uQ29kaWdvKCdEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCcpO1xuICAgIH1cbiAgfSBjYXRjaCAoX2UpIHt9XG4gIC8vIEZhbGxiYWNrIFx1MDBBNzY4IHNpIGVsIGJ1bmRsZSBubyBjYXJnXHUwMEYzIChTVyBzdGFsZSkuXG4gIHJldHVybiAoXG4gICAgJ05vIHB1ZGltb3MgY2FyZ2FyIGVsIHRhYmxlcm8gZGUgdmVudGFzLiBWb2x2XHUwMEU5IGEgaW50ZW50YXIgZW4gdW4gbWludXRvOyBzaSBzaWd1ZSBwYXNhbmRvLCBhdmlzYWxlIGEgTWFyaWFuby4nICtcbiAgICAnXFxuXFxuQ1x1MDBGM2RpZ28gdFx1MDBFOWNuaWNvOiBEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCdcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xvYWRDaGFydEpzKCkge1xuICBpZiAod2luZG93LkNoYXJ0KSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHdpbmRvdy5DaGFydCk7XG4gIGlmIChjaGFydEpzUHJvbWlzZSkgcmV0dXJuIGNoYXJ0SnNQcm9taXNlO1xuICBjaGFydEpzUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgcy5zcmMgPSBDSEFSVF9KU19VUkw7XG4gICAgcy5hc3luYyA9IHRydWU7XG4gICAgcy5vbmxvYWQgPSAoKSA9PlxuICAgICAgd2luZG93LkNoYXJ0ID8gcmVzb2x2ZSh3aW5kb3cuQ2hhcnQpIDogcmVqZWN0KG5ldyBFcnJvcignQ2hhcnQuanMgc2luIGdsb2JhbCcpKTtcbiAgICBzLm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgICBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG4gICAgICByZWplY3QobmV3IEVycm9yKCdubyBzZSBwdWRvIGNhcmdhciBDaGFydC5qcycpKTtcbiAgICB9O1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xuICByZXR1cm4gY2hhcnRKc1Byb21pc2U7XG59XG5cbmZ1bmN0aW9uIF9kZXN0cm95Q2hhcnRzKCkge1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoY2hhcnRzKSkge1xuICAgIHRyeSB7XG4gICAgICBjaGFydHNba10uZGVzdHJveSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIGRlbGV0ZSBjaGFydHNba107XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcGNpb25lcyBkZSBmaWx0cm9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERldnVlbHZlIFt7dmFsdWUsbGFiZWx9XSBkZSBsYSBvcGNpXHUwMEYzbiBga2V5YCBkZSBsYSBcdTAwRkFsdGltYSByZXNwdWVzdGEuICovXG5mdW5jdGlvbiBfb3BjaW9uZXNEZShrZXkpIHtcbiAgY29uc3Qgb3AgPSBzdGF0ZS5vcGNpb25lcyB8fCB7fTtcbiAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShvcFtrZXldKSA/IG9wW2tleV0gOiBbXTtcbiAgaWYgKGtleSA9PT0gJ2NsaWVudGVzJykge1xuICAgIHJldHVybiBhcnIubWFwKChjKSA9PiAoe1xuICAgICAgdmFsdWU6IFN0cmluZyhjLmNvZGUpLFxuICAgICAgbGFiZWw6IFN0cmluZyhjLm5hbWUgfHwgYy5jb2RlKSArICcgKCcgKyBTdHJpbmcoYy5jb2RlKSArICcpJyxcbiAgICB9KSk7XG4gIH1cbiAgaWYgKGtleSA9PT0gJ3NrdXMnKSB7XG4gICAgcmV0dXJuIGFyci5tYXAoKHMpID0+ICh7XG4gICAgICB2YWx1ZTogU3RyaW5nKHMuY29kZSksXG4gICAgICBsYWJlbDogU3RyaW5nKHMuY29kZSkgKyAocy5kZXNjID8gJyAtICcgKyBTdHJpbmcocy5kZXNjKSA6ICcnKSxcbiAgICB9KSk7XG4gIH1cbiAgcmV0dXJuIGFyci5tYXAoKHYpID0+ICh7IHZhbHVlOiBTdHJpbmcodiksIGxhYmVsOiBTdHJpbmcodikgfSkpO1xufVxuXG5mdW5jdGlvbiBfcmVzdW1lblNlbChrZXksIG9wY2lvbmVzKSB7XG4gIGNvbnN0IG4gPSBzdGF0ZS5zZWxba2V5XS5sZW5ndGg7XG4gIGlmIChuID09PSAwKSByZXR1cm4gJ1RvZG9zJztcbiAgaWYgKG4gPT09IDEpIHtcbiAgICBjb25zdCBvID0gb3BjaW9uZXMuZmluZCgoeCkgPT4geC52YWx1ZSA9PT0gc3RhdGUuc2VsW2tleV1bMF0pO1xuICAgIHJldHVybiBvID8gby5sYWJlbCA6IHN0YXRlLnNlbFtrZXldWzBdO1xuICB9XG4gIHJldHVybiBuICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuZnVuY3Rpb24gX3JlbmRlckZpbHRybyhkZWYpIHtcbiAgaWYgKGRlZi5rZXkgPT09ICd2ZW5kZWRvcmVzJyAmJiBfaXNWZW5kZWRvcigpKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPicgK1xuICAgICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LW1zLWxvY2tlZFwiIHRpdGxlPVwiVmVzIHNvbG8gdHVzIGNsaWVudGVzXCI+JyArXG4gICAgICBfZXNjSHRtbChfbXlWZW5kb3IoKSB8fCAnVHVzIGNsaWVudGVzJykgK1xuICAgICAgJyBcdUQ4M0RcdUREMTI8L2Rpdj48L2Rpdj4nXG4gICAgKTtcbiAgfVxuICBjb25zdCBvcGNpb25lcyA9IF9vcGNpb25lc0RlKGRlZi5rZXkpO1xuICBjb25zdCBzZWxlY3RlZCA9IG5ldyBTZXQoc3RhdGUuc2VsW2RlZi5rZXldKTtcbiAgbGV0IGxpc3QgPSAnJztcbiAgZm9yIChjb25zdCBvIG9mIG9wY2lvbmVzKSB7XG4gICAgbGlzdCArPVxuICAgICAgJzxsYWJlbCBjbGFzcz1cImR2LW1zLW9wdFwiIGRhdGEtc2VhcmNoPVwiJyArXG4gICAgICBfZXNjSHRtbChvLmxhYmVsLnRvTG93ZXJDYXNlKCkpICtcbiAgICAgICdcIj48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgZGF0YS1maWx0cm89XCInICtcbiAgICAgIGRlZi5rZXkgK1xuICAgICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgICBfZXNjSHRtbChvLnZhbHVlKSArXG4gICAgICAnXCInICtcbiAgICAgIChzZWxlY3RlZC5oYXMoby52YWx1ZSkgPyAnIGNoZWNrZWQnIDogJycpICtcbiAgICAgICc+IDxzcGFuPicgK1xuICAgICAgX2VzY0h0bWwoby5sYWJlbCkgK1xuICAgICAgJzwvc3Bhbj48L2xhYmVsPic7XG4gIH1cbiAgaWYgKCFsaXN0KSBsaXN0ID0gJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiIHN0eWxlPVwicGFkZGluZzo2cHhcIj5TaW4gb3BjaW9uZXMgdG9kYXZcdTAwRURhLjwvZGl2Pic7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+JyArXG4gICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgJzwvZGl2PjxkZXRhaWxzIGNsYXNzPVwiZHYtbXNcIiBkYXRhLW1zPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPjxzdW1tYXJ5PicgK1xuICAgIF9lc2NIdG1sKF9yZXN1bWVuU2VsKGRlZi5rZXksIG9wY2lvbmVzKSkgK1xuICAgICc8L3N1bW1hcnk+PGRpdiBjbGFzcz1cImR2LW1zLXBvcFwiPicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXJcdTIwMjZcIiBkYXRhLW1zLXNlYXJjaD1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWFjdGlvbnNcIj48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLW1zLWNsZWFyPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPkxpbXBpYXI8L2J1dHRvbj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWxpc3RcIj4nICtcbiAgICBsaXN0ICtcbiAgICAnPC9kaXY+PC9kaXY+PC9kZXRhaWxzPjwvZGl2PidcbiAgKTtcbn1cblxuLyoqIExlZSBkZWwgRE9NIGxvIHF1ZSBlbCB1c3VhcmlvIG1hcmNcdTAwRjMuIFNvbG8gc2UgbGxhbWEgYWwgdG9jYXIgXCJBcGxpY2FyXCIuICovXG5mdW5jdGlvbiBfcmVhZFNlbEZyb21Eb20ocm9vdCkge1xuICBjb25zdCBuZXh0ID0gX3NlbFZhY2lhKCk7XG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdW2RhdGEtZmlsdHJvXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpO1xuICAgIGlmIChlbC5jaGVja2VkICYmIG5leHRba2V5XSkgbmV4dFtrZXldLnB1c2goZWwudmFsdWUpO1xuICB9KTtcbiAgaWYgKF9pc1ZlbmRlZG9yKCkpIG5leHQudmVuZGVkb3JlcyA9IFtdO1xuICBzdGF0ZS5zZWwgPSBuZXh0O1xuICBjb25zdCBtZXNFbCA9IHJvb3QucXVlcnlTZWxlY3RvcignI2R2LW1lcycpO1xuICBpZiAobWVzRWwgJiYgL15cXGR7NH0tXFxkezJ9JC8udGVzdChtZXNFbC52YWx1ZSkpIHN0YXRlLm1lcyA9IG1lc0VsLnZhbHVlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBcm1hIGVsIGVzcXVlbGV0byAoZmlsdHJvcyBhcnJpYmEsIHJlc3VsdGFkb3MgYWJham8pIHVuYSBzb2xhIHZlei4gKi9cbmZ1bmN0aW9uIF9lbnN1cmVTa2VsZXRvbigpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm4gbnVsbDtcbiAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcy1ob3N0JykgfHwgIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1yZXN1bHRzJykpIHtcbiAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IGlkPVwiZHYtZmlsdHJvcy1ob3N0XCI+PC9kaXY+PGRpdiBpZD1cImR2LXJlc3VsdHNcIj48L2Rpdj4nO1xuICAgIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBudWxsO1xuICB9XG4gIHJldHVybiBib2R5O1xufVxuXG4vKipcbiAqIFBhbmVsIGRlIGZpbHRyb3MuIFNlIHJlLWFybWEgc29sbyBjdWFuZG8gY2FtYmlhbiBsYXMgb3BjaW9uZXMgKHVuYSB2ZXogcG9yXG4gKiByZXNwdWVzdGEpLCBhbCByZXNldGVhciBwb3IgY2FtYmlvIGRlIHVzdWFyaW8gbyBjb24gXCJMaW1waWFyIGZpbHRyb3NcIi4gTmkgZWxcbiAqIFwiQ2FyZ2FuZG9cdTIwMjZcIiBuaSBcIlZlciBtXHUwMEUxc1wiIGxvIHRvY2FuLCBhc1x1MDBFRCBubyBzZSBwaWVyZGVuIGNhbWJpb3Mgc2luIGFwbGljYXIuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckZpbHRyb3MoZm9yY2UpIHtcbiAgY29uc3QgaG9zdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zLWhvc3QnKTtcbiAgaWYgKCFob3N0KSByZXR1cm47XG4gIGlmICghZm9yY2UgJiYgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9PT0gc3RhdGUub3BjaW9uZXMgJiYgaG9zdC5pbm5lckhUTUwpIHJldHVybjtcbiAgY29uc3QgcHJldiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zJyk7XG4gIGNvbnN0IGFiaWVydG8gPSBwcmV2ID8gISFwcmV2Lm9wZW4gOiB3aW5kb3cuaW5uZXJXaWR0aCA+IDcwMDtcbiAgbGV0IGh0bWwgPSAnPGRldGFpbHMgY2xhc3M9XCJkdi1maWx0cm9zXCIgaWQ9XCJkdi1maWx0cm9zXCInICsgKGFiaWVydG8gPyAnIG9wZW4nIDogJycpICsgJz4nO1xuICBodG1sICs9ICc8c3VtbWFyeT5GaWx0cm9zPC9zdW1tYXJ5PjxkaXYgY2xhc3M9XCJkdi1maWx0cm9zLWdyaWRcIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+TWVzPC9kaXY+PGlucHV0IHR5cGU9XCJtb250aFwiIGlkPVwiZHYtbWVzXCIgY2xhc3M9XCJkdi1pbnB1dFwiIHZhbHVlPVwiJyArXG4gICAgX2VzY0h0bWwoc3RhdGUubWVzKSArXG4gICAgJ1wiPjwvZGl2Pic7XG4gIGZvciAoY29uc3QgZGVmIG9mIEZJTFRST1NfREVGKSBodG1sICs9IF9yZW5kZXJGaWx0cm8oZGVmKTtcbiAgaHRtbCArPSAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LWZpbHRyb3MtYWN0aW9uc1wiPic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1idG4tc2Vjb25kYXJ5XCIgZGF0YS1kdi1hY3Rpb249XCJsaW1waWFyXCI+TGltcGlhciBmaWx0cm9zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtYnRuLXByaW1hcnlcIiBpZD1cImR2LWFwbGljYXJcIiBkYXRhLWR2LWFjdGlvbj1cImFwbGljYXJcIicgK1xuICAgIChzdGF0ZS5sb2FkaW5nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xuICAgICc+QXBsaWNhcjwvYnV0dG9uPic7XG4gIGh0bWwgKz0gJzwvZGl2PjwvZGV0YWlscz4nO1xuICBob3N0LmlubmVySFRNTCA9IGh0bWw7XG4gIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBzdGF0ZS5vcGNpb25lcztcbn1cblxuZnVuY3Rpb24gX3N5bmNBcGxpY2FyRGlzYWJsZWQoKSB7XG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1hcGxpY2FyJyk7XG4gIGlmIChidG4pIGJ0bi5kaXNhYmxlZCA9ICEhc3RhdGUubG9hZGluZztcbn1cblxuZnVuY3Rpb24gX2NhcmQodGl0dWxvLCB2YWxvcikge1xuICByZXR1cm4gKFxuICAgICc8ZGl2IGNsYXNzPVwiZHYtY2FyZFwiPjxkaXYgY2xhc3M9XCJkdi1jYXJkLXRpdGxlXCI+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1jYXJkLXZhbHVlXCI+JyArXG4gICAgX2VzY0h0bWwodmFsb3IpICtcbiAgICAnPC9kaXY+PC9kaXY+J1xuICApO1xufVxuXG4vLyBQb3JjZW50YWplIGNvbiBjb21hIGRlY2ltYWwgKGVzLUFSKTogODAsNSVcbmZ1bmN0aW9uIF9mbXRQY3Qobikge1xuICByZXR1cm4gKFxuICAgIChOdW1iZXIobikgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgbWluaW11bUZyYWN0aW9uRGlnaXRzOiAwLFxuICAgICAgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxLFxuICAgIH0pICsgJyUnXG4gICk7XG59XG5cbi8vIEFBQUEtTU0tREQgLT4gREQvTU0vQUFBQSAoc2kgbm8gdGllbmUgZXNlIGZvcm1hdG8sIHNlIGRldnVlbHZlIHRhbCBjdWFsKVxuZnVuY3Rpb24gX2ZtdEZlY2hhKGYpIHtcbiAgY29uc3QgbSA9IC9eKFxcZHs0fSktKFxcZHsyfSktKFxcZHsyfSkvLmV4ZWMoU3RyaW5nKGYgPT0gbnVsbCA/ICcnIDogZikpO1xuICByZXR1cm4gbSA/IG1bM10gKyAnLycgKyBtWzJdICsgJy8nICsgbVsxXSA6IFN0cmluZyhmID09IG51bGwgPyAnJyA6IGYpO1xufVxuXG5mdW5jdGlvbiBfdGlwb0xhYmVsKHQpIHtcbiAgcmV0dXJuIHQgPT09ICd2aXNpdGEnID8gJ1Zpc2l0YScgOiAnQ29udGFjdG8nO1xufVxuXG4vLyBUYWJsYSBkZSBpbnRlcmFjY2lvbmVzIChzb2xvIGVsIGNvbnRlbmVkb3IgY29uIHNjcm9sbDsgc2UgcmVlbXBsYXphIGFsIGJ1c2NhcikuXG5mdW5jdGlvbiBfaW50ZXJhY2Npb25lc1RhYmxhKHJvd3MsIHRvdGFsLCBxdWVyeSkge1xuICBjb25zdCBxID0gU3RyaW5nKHF1ZXJ5IHx8ICcnKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnRyaW0oKTtcbiAgY29uc3QgbGlzdGEgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IGxpc3RhLmZpbHRlcigocikgPT5cbiAgICAgICAgKFxuICAgICAgICAgIFN0cmluZyhyLmNsaWVudGUpICtcbiAgICAgICAgICAnICcgK1xuICAgICAgICAgIF9mbXRGZWNoYShyLmZlY2hhKSArXG4gICAgICAgICAgJyAnICtcbiAgICAgICAgICBTdHJpbmcoci52ZW5kZWRvcikgK1xuICAgICAgICAgICcgJyArXG4gICAgICAgICAgX3RpcG9MYWJlbChyLnRpcG8pXG4gICAgICAgIClcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhxKVxuICAgICAgKVxuICAgIDogbGlzdGE7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXAgZHYtaW50ZXItd3JhcFwiPjx0YWJsZSBjbGFzcz1cImR2LXRhYmxlXCI+PHRoZWFkPjx0cj48dGg+Q2xpZW50ZTwvdGg+PHRoPkZlY2hhPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5UaXBvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgciBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoci5jbGllbnRlKSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChfZm10RmVjaGEoci5mZWNoYSkpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKHIudmVuZGVkb3IpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKF90aXBvTGFiZWwoci50aXBvKSkgK1xuICAgICAgJzwvdGQ+PC90cj4nO1xuICB9XG4gIGlmIChmaWx0ZXJlZC5sZW5ndGggPT09IDApXG4gICAgaHRtbCArPSAnPHRyPjx0ZCBjb2xzcGFuPVwiNFwiIGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gcmVzdWx0YWRvcy48L3RkPjwvdHI+JztcbiAgaHRtbCArPSAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG4gIGNvbnN0IHRvdGFsTiA9IE51bWJlcih0b3RhbCkgfHwgMDtcbiAgaWYgKHRvdGFsTiA+IGxpc3RhLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5Nb3N0cmFuZG8gJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKGxpc3RhLmxlbmd0aCkpICtcbiAgICAgICcgZGUgJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKHRvdGFsTikpICtcbiAgICAgICc8L2Rpdj4nO1xuICB9XG4gIHJldHVybiBodG1sO1xufVxuXG4vKiogVGFibGEgZGUgaW50ZXJhY2Npb25lcyBjb24gYnVzY2Fkb3IuIEVsIHRleHRvIGJ1c2NhZG8gc2UgcG9uZSBwb3IgRE9NLiAqL1xuZnVuY3Rpb24gX2ludGVyYWNjaW9uZXNTZWN0aW9uKHQsIHF1ZXJ5KSB7XG4gIGNvbnN0IHJvd3MgPSAodCAmJiB0LnJvd3MpIHx8IFtdO1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIiBpZD1cImR2LWludGVyYWNjaW9uZXNcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkludGVyYWNjaW9uZXM8L2gzPjwvZGl2PicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgaWQ9XCJkdi1pbnRlcmFjY2lvbmVzLWJ1c2NhclwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIGNsaWVudGUsIHZlbmRlZG9yIG8gdGlwb1x1MjAyNlwiPicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtaW50ZXItYm9keVwiPicgK1xuICAgIF9pbnRlcmFjY2lvbmVzVGFibGEocm93cywgdCAmJiB0LnRvdGFsLCBxdWVyeSkgK1xuICAgICc8L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG4vKiogQmxvcXVlIGRlIGdlc3RpXHUwMEYzbjogdGFyamV0YXMgKyBub3RhICsgdGFibGEgZGUgaW50ZXJhY2Npb25lcy4gKi9cbmZ1bmN0aW9uIF9nZXN0aW9uU2VjdGlvbihnLCBzZWNjaW9uZXMsIHF1ZXJ5KSB7XG4gIGlmICghZyB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5nZXN0aW9uICYmIHNlY2Npb25lcy5nZXN0aW9uLmVycm9yKSkge1xuICAgIHJldHVybiAnPGRpdiBjbGFzcz1cImR2LWNhcmRzXCIgaWQ9XCJkdi1nZXN0aW9uXCI+JyArIF9jYXJkKCdHZXN0aVx1MDBGM24nLCAnTm8gZGlzcG9uaWJsZScpICsgJzwvZGl2Pic7XG4gIH1cbiAgbGV0IGh0bWwgPSAnPGRpdiBjbGFzcz1cImR2LWNhcmRzXCIgaWQ9XCJkdi1nZXN0aW9uXCI+JztcbiAgaHRtbCArPSBfY2FyZCgnVGFyZ2V0JywgZy50YXJnZXQgPT0gbnVsbCA/ICdTaW4gdGFyZ2V0JyA6IF9mbXRBcnMoZy50YXJnZXQpKTtcbiAgaHRtbCArPSBfY2FyZChcbiAgICAnJSBjdW1wbGltaWVudG8nLFxuICAgIGcuY3VtcGxpbWllbnRvUGN0ID09IG51bGwgPyAnU2luIHRhcmdldCcgOiBfZm10UGN0KGcuY3VtcGxpbWllbnRvUGN0KVxuICApO1xuICBodG1sICs9IF9jYXJkKCdSZW5kaWNpb25lcyBcdTIwMTMgbW9udG8nLCBfZm10QXJzKGcucmVuZGljaW9uZXNBcnMpKTtcbiAgaHRtbCArPSBfY2FyZCgnQmFzZSBhY3RpdmEnLCBfZm10VWRzKGcuYmFzZUFjdGl2YSkpO1xuICBodG1sICs9IF9jYXJkKCdUaWNrZXQgcHJvbWVkaW8nLCBfZm10QXJzKGcudGlja2V0UHJvbWVkaW8pKTtcbiAgaHRtbCArPSBfY2FyZCgnTlx1MDBCMCB2aXNpdGFzJywgX2ZtdFVkcyhnLnZpc2l0YXMpKTtcbiAgaHRtbCArPSBfY2FyZCgnTlx1MDBCMCBjb250YWN0YWRvcycsIF9mbXRVZHMoZy5jb250YWN0YWRvcykpO1xuICBodG1sICs9IF9jYXJkKCdOXHUwMEIwIGludGVyYWNjaW9uZXMnLCBfZm10VWRzKGcuaW50ZXJhY2Npb25lcykpO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBpZiAoZy5maWx0cm9zTm9BcGxpY2FuKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1sZXllbmRhIGR2LW11dGVkXCI+VGFyZ2V0IHkgcmVuZGljaW9uZXMgbm8gc2UgZmlsdHJhbiBwb3IgY2xpZW50ZSBuaSBwcm9kdWN0bzsgdmlzaXRhcyB5IGNvbnRhY3RvcyBubyBzZSBmaWx0cmFuIHBvciBwcm9kdWN0by48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gX2ludGVyYWNjaW9uZXNTZWN0aW9uKGcudGFibGFJbnRlcmFjY2lvbmVzLCBxdWVyeSk7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiBfdmVyTWFzVGFibGEodGlwb0luLCByb3dzKSB7XG4gIGNvbnN0IHRpcG8gPSB0aXBvSW4gPT09ICdkaW5lcm8nID8gJ2RpbmVybycgOiAndW5pZGFkZXMnO1xuICBjb25zdCBxID0gc3RhdGUudmVyTWFzUXVlcnlbdGlwb10udG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIC8vIFBvc2ljaVx1MDBGM24gZGVsIHJhbmtpbmcgY2FsY3VsYWRhIHVuYSBzb2xhIHZleiAoc2luIGluZGV4T2YgcG9yIGZpbGEpLlxuICBjb25zdCByYW5rZWQgPSByb3dzLm1hcCgociwgaSkgPT4gKHsgciwgcG9zOiBpICsgMSB9KSk7XG4gIGNvbnN0IGZpbHRlcmVkID0gcVxuICAgID8gcmFua2VkLmZpbHRlcigoeCkgPT5cbiAgICAgICAgKFN0cmluZyh4LnIuc2t1KSArICcgJyArIFN0cmluZyh4LnIuZGVzYyB8fCAnJykpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSlcbiAgICAgIClcbiAgICA6IHJhbmtlZDtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdmVybWFzXCI+PGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaVx1MDBGM25cdTIwMjZcIiBkYXRhLXZlcm1hcy1zZWFyY2g9XCInICtcbiAgICB0aXBvICtcbiAgICAnXCI+PGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJkdi10YWJsZVwiPjx0aGVhZD48dHI+PHRoPiM8L3RoPjx0aD5TS1U8L3RoPjx0aD5EZXNjcmlwY2lcdTAwRjNuPC90aD48dGggY2xhc3M9XCJudW1cIj5VbmlkYWRlczwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RGluZXJvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgeyByLCBwb3MgfSBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKVxuICAgIGh0bWwgKz0gJzx0cj48dGQgY29sc3Bhbj1cIjVcIiBjbGFzcz1cImR2LW11dGVkXCI+U2luIHJlc3VsdGFkb3MuPC90ZD48L3RyPic7XG4gIGh0bWwgKz0gJzwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2Rpdj4nO1xuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gX3RvcFNlY3Rpb24odGlwbywgdGl0dWxvLCByb3dzKSB7XG4gIGNvbnN0IGFiaWVydG8gPSBzdGF0ZS52ZXJNYXNbdGlwb107XG4gIGNvbnN0IHRvdGFsID0gcm93cy5sZW5ndGg7XG4gIGNvbnN0IGggPSBNYXRoLm1heCgxMjAsIE1hdGgubWluKFRPUF9OLCB0b3RhbCkgKiAyMiArIDQwKTtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLXZlcm1hcz1cIicgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICtcbiAgICAgICAgKGFiaWVydG8gPyAndHJ1ZScgOiAnZmFsc2UnKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgKGFiaWVydG8gPyAnVmVyIG1lbm9zJyA6ICdWZXIgbVx1MDBFMXMnKSArXG4gICAgICAgICcgKCcgK1xuICAgICAgICB0b3RhbCArXG4gICAgICAgICcpPC9idXR0b24+J1xuICAgICAgOiAnJykgK1xuICAgICc8L2Rpdj4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDonICtcbiAgICAgICAgaCArXG4gICAgICAgICdweFwiPjxjYW52YXMgaWQ9XCJkdi1jaGFydC10b3AtJyArXG4gICAgICAgIHRpcG8gK1xuICAgICAgICAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICtcbiAgICAgICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgICAgICdcIj48L2NhbnZhcz48L2Rpdj4nXG4gICAgICA6ICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gZGF0b3MuPC9kaXY+JykgK1xuICAgIChhYmllcnRvID8gX3Zlck1hc1RhYmxhKHRpcG8sIHJvd3MpIDogJycpICtcbiAgICAnPC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xpbmVTZWN0aW9uKGlkLCB0aXR1bG8pIHtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz48L2Rpdj48ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDoyNDBweFwiPjxjYW52YXMgaWQ9XCInICtcbiAgICBpZCArXG4gICAgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJ1wiPjwvY2FudmFzPjwvZGl2Pjwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9pc0VtcHR5KGQpIHtcbiAgaWYgKCFkKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgY29uc3QgaGF5S3BpID1cbiAgICBOdW1iZXIoay5mYWN0dXJhZG8pIHx8IE51bWJlcihrLnBlZGlkb3MpIHx8IE51bWJlcihrLnBlZGlkb3NVbmljb3MpIHx8IE51bWJlcihrLmJhY2tvcmRlckFycyk7XG4gIGNvbnN0IGhheVRvcCA9IEFycmF5LmlzQXJyYXkoZC50b3BVbmlkYWRlcykgJiYgZC50b3BVbmlkYWRlcy5sZW5ndGggPiAwO1xuICBjb25zdCBoYXlTZXJpZSA9IEFycmF5LmlzQXJyYXkoZC5zZXJpZVZlbnRhcykgJiYgZC5zZXJpZVZlbnRhcy5zb21lKChwKSA9PiBOdW1iZXIocC52YWxvcikpO1xuICByZXR1cm4gIWhheUtwaSAmJiAhaGF5VG9wICYmICFoYXlTZXJpZTtcbn1cblxuLyoqIFJlc3VsdGFkb3MgKGxleWVuZGEsIHRhcmpldGFzLCByYW5raW5ncywgZ3JcdTAwRTFmaWNvcykuIE5vIHRvY2EgbG9zIGZpbHRyb3MuICovXG5mdW5jdGlvbiByZW5kZXJSZXN1bHRzKCkge1xuICBjb25zdCByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKTtcbiAgaWYgKCFyb290KSByZXR1cm47XG4gIGNvbnN0IGQgPSBzdGF0ZS5kYXRhO1xuXG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGFcIj5Nb250b3Mgc2luIElWQSwgY29uIGRlc2N1ZW50byBhcGxpY2FkbyB5IG5vdGFzIGRlIGNyXHUwMEU5ZGl0byByZXN0YWRhcy4nO1xuICBpZiAoZCAmJiBkLmRhdGFVcGRhdGVkQXQgJiYgIXN0YXRlLmxvYWRpbmcpIHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZC5kYXRhVXBkYXRlZEF0KTtcbiAgICBpZiAoIU51bWJlci5pc05hTih0LmdldFRpbWUoKSkpIHtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJyA8c3BhbiBjbGFzcz1cImR2LW11dGVkXCI+XHUwMEI3IENhbGN1bGFkbyAnICtcbiAgICAgICAgX2VzY0h0bWwodC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pKSArXG4gICAgICAgICc8L3NwYW4+JztcbiAgICB9XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICBpZiAoc3RhdGUubG9hZGluZykge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5DYXJnYW5kb1x1MjAyNjwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZXJyb3IpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWVzdGFkbyBkdi1lcnJvclwiPicgKyBfZXNjSHRtbChzdGF0ZS5lcnJvcikucmVwbGFjZSgvXFxuL2csICc8YnI+JykgKyAnPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkICYmIF9pc0VtcHR5KGQpKSB7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImR2LWVzdGFkb1wiPk5vIGhheSB2ZW50YXMgY29uIGVzb3MgZmlsdHJvcy48L2Rpdj4nO1xuICB9IGVsc2UgaWYgKGQpIHtcbiAgICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1jYXJkc1wiPic7XG4gICAgaHRtbCArPSBfY2FyZCgnRmFjdHVyYWRvIG1lbnN1YWwnLCBfZm10QXJzKGsuZmFjdHVyYWRvKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnVmFsb3JpemFjaVx1MDBGM24gYmFja29yZGVyJywgX2ZtdEFycyhrLmJhY2tvcmRlckFycykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIGRlIHBlZGlkb3MgZGVsIG1lcycsIF9mbXRVZHMoay5wZWRpZG9zKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnQ2FudC4gcGVkaWRvcyBcdTAwRkFuaWNvcycsIF9mbXRVZHMoay5wZWRpZG9zVW5pY29zKSk7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICBodG1sICs9IF9nZXN0aW9uU2VjdGlvbihkLmdlc3Rpb24sIGQuc2VjY2lvbmVzLCBzdGF0ZS5pbnRlclF1ZXJ5KTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCd1bmlkYWRlcycsICdUb3AgMjAgU0tVIC0gVW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdKTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCdkaW5lcm8nLCAnVG9wIDIwIFNLVSAtIERpbmVybycsIGQudG9wRGluZXJvIHx8IFtdKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtdmVudGFzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlIHZlbnRhcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby11ZHMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIFVuaWRhZGVzJyk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LWJvLWFycycsICdFdm9sdWNpXHUwMEYzbiBkZWwgYmFja29yZGVyIC0gRGluZXJvJyk7XG4gIH1cblxuICBfZGVzdHJveUNoYXJ0cygpO1xuICByb290LmlubmVySFRNTCA9IGh0bWw7XG4gIC8vIEVsIHRleHRvIGRlbCBidXNjYWRvciBkZSBcIlZlciBtXHUwMEUxc1wiIHNlIHBvbmUgcG9yIERPTSwgbnVuY2EgZGVudHJvIGRlbCBIVE1MLlxuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W2RhdGEtdmVybWFzLXNlYXJjaF0nKS5mb3JFYWNoKChpbnApID0+IHtcbiAgICBjb25zdCBrID0gaW5wLmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMtc2VhcmNoJyk7XG4gICAgaWYgKGspIC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGlucCkudmFsdWUgPSBzdGF0ZS52ZXJNYXNRdWVyeVtrXSB8fCAnJztcbiAgfSk7XG5cbiAgY29uc3QgaW50ZXJJbnAgPSByb290LnF1ZXJ5U2VsZWN0b3IoJyNkdi1pbnRlcmFjY2lvbmVzLWJ1c2NhcicpO1xuICBpZiAoaW50ZXJJbnApIC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGludGVySW5wKS52YWx1ZSA9IHN0YXRlLmludGVyUXVlcnkgfHwgJyc7XG5cbiAgLy8gU2luIG1vZGFsIGFiaWVydG8gbm8gc2UgZGlidWphIChyZXNwdWVzdGEgcXVlIGxsZWdcdTAwRjMgZGVzcHVcdTAwRTlzIGRlIGNlcnJhcikuXG4gIGlmIChfaXNPcGVuKCkgJiYgIXN0YXRlLmxvYWRpbmcgJiYgIXN0YXRlLmVycm9yICYmIGQgJiYgIV9pc0VtcHR5KGQpKSB7XG4gICAgX2xvYWRDaGFydEpzKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKF9pc09wZW4oKSAmJiBzdGF0ZS5kYXRhID09PSBkKSBfZHJhd0NoYXJ0cyhkKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBpZiAoIV9lbnN1cmVTa2VsZXRvbigpKSByZXR1cm47XG4gIHJlbmRlckZpbHRyb3MoZmFsc2UpO1xuICBfc3luY0FwbGljYXJEaXNhYmxlZCgpO1xuICByZW5kZXJSZXN1bHRzKCk7XG59XG5cbmZ1bmN0aW9uIF9jc3NWYXIobmFtZSwgZmFsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB2ID0gZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmdldFByb3BlcnR5VmFsdWUobmFtZSkudHJpbSgpO1xuICAgIHJldHVybiB2IHx8IGZhbGxiYWNrO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5jb25zdCBDSEFSVF9GT05UID1cbiAgXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTRiBQcm8gVGV4dCcsICdTZWdvZSBVSScsIHN5c3RlbS11aSwgc2Fucy1zZXJpZlwiO1xuY29uc3QgQ0hBUlRfR1JJRCA9IHsgY29sb3I6ICdyZ2JhKDAsMCwwLC4wNiknIH07XG5cbmZ1bmN0aW9uIF9iYXJDaGFydChjYW52YXNJZCwgcm93cywgZmllbGQsIGZtdCwgY29sb3IpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChjYW52YXNJZCk7XG4gIGlmICghZWwgfHwgIXdpbmRvdy5DaGFydCkgcmV0dXJuO1xuICAvLyBTcGVjOiBTS1VzIGNvbiBuZXRvIDw9IDAgbm8gZW50cmFuIGFsIFRvcCAobGEgdGFibGEgXCJWZXIgbVx1MDBFMXNcIiBzXHUwMEVEIGxvcyBtdWVzdHJhKS5cbiAgY29uc3QgdG9wID0gcm93cy5maWx0ZXIoKHIpID0+IChOdW1iZXIocltmaWVsZF0pIHx8IDApID4gMCkuc2xpY2UoMCwgVE9QX04pO1xuICBjaGFydHNbY2FudmFzSWRdID0gbmV3IHdpbmRvdy5DaGFydChlbCwge1xuICAgIHR5cGU6ICdiYXInLFxuICAgIGRhdGE6IHtcbiAgICAgIGxhYmVsczogdG9wLm1hcCgocikgPT4gU3RyaW5nKHIuc2t1KSksXG4gICAgICBkYXRhc2V0czogW1xuICAgICAgICB7IGRhdGE6IHRvcC5tYXAoKHIpID0+IE51bWJlcihyW2ZpZWxkXSkgfHwgMCksIGJhY2tncm91bmRDb2xvcjogY29sb3IsIGJvcmRlclJhZGl1czogMyB9LFxuICAgICAgXSxcbiAgICB9LFxuICAgIG9wdGlvbnM6IHtcbiAgICAgIGluZGV4QXhpczogJ3knLFxuICAgICAgcmVzcG9uc2l2ZTogdHJ1ZSxcbiAgICAgIG1haW50YWluQXNwZWN0UmF0aW86IGZhbHNlLFxuICAgICAgYW5pbWF0aW9uOiBmYWxzZSxcbiAgICAgIHBsdWdpbnM6IHtcbiAgICAgICAgbGVnZW5kOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgIHRvb2x0aXA6IHtcbiAgICAgICAgICBjYWxsYmFja3M6IHtcbiAgICAgICAgICAgIHRpdGxlOiAoaXRlbXMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgciA9IHRvcFtpdGVtc1swXS5kYXRhSW5kZXhdO1xuICAgICAgICAgICAgICByZXR1cm4gciA/IFN0cmluZyhyLnNrdSkgKyAoci5kZXNjID8gJyAtICcgKyBTdHJpbmcoci5kZXNjKSA6ICcnKSA6ICcnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxhYmVsOiAoaXRlbSkgPT4gZm10KGl0ZW0ucmF3KSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNjYWxlczoge1xuICAgICAgICB4OiB7XG4gICAgICAgICAgZ3JpZDogQ0hBUlRfR1JJRCxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgZm9udDogeyBmYW1pbHk6IENIQVJUX0ZPTlQgfSxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHk6IHtcbiAgICAgICAgICBncmlkOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAsIGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1zZWNvbmRhcnknLCAnIzMzNDE1NScpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG4vKipcbiAqIFNlcmllIGRlIGJhY2sgb3JkZXIgZW4gMiBkYXRhc2V0czogcmVhbCAobFx1MDBFRG5lYSBsbGVuYSkgeSBlc3RpbWFkbyAocHVudGVhZGEpLlxuICogVW4gcHVudG8gZXN0aW1hZG8gc2UgY29uZWN0YSBjb24gc3UgdmVjaW5vIHJlYWwgcGFyYSBxdWUgbGEgY3VydmEgbm8gcXVlZGVcbiAqIGNvcnRhZGEgZW4gbGEgdHJhbnNpY2lcdTAwRjNuOyBgbnVsbGAgKHNpbiBkYXRvcykgY29ydGEgbGEgbFx1MDBFRG5lYSAoc3BhbkdhcHM6ZmFsc2UpLlxuICovXG5mdW5jdGlvbiBfc3BsaXRCYWNrb3JkZXIoc2VyaWUpIHtcbiAgY29uc3QgcmVhbCA9IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCB8fCBwLmVzdGltYWRvID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpO1xuICBjb25zdCBlc3QgPSBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgfHwgIXAuZXN0aW1hZG8gPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VyaWUubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZXN0W2ldID09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChpICsgMSA8IHNlcmllLmxlbmd0aCAmJiByZWFsW2kgKyAxXSAhPSBudWxsKSBlc3RbaSArIDFdID0gcmVhbFtpICsgMV07XG4gICAgaWYgKGkgLSAxID49IDAgJiYgcmVhbFtpIC0gMV0gIT0gbnVsbCAmJiBlc3RbaSAtIDFdID09IG51bGwpIGVzdFtpIC0gMV0gPSByZWFsW2kgLSAxXTtcbiAgfVxuICByZXR1cm4geyByZWFsLCBlc3QsIGhheUVzdGltYWRvOiBzZXJpZS5zb21lKChwKSA9PiBwLmVzdGltYWRvICYmIHAudmFsb3IgIT0gbnVsbCkgfTtcbn1cblxuZnVuY3Rpb24gX2xpbmVDaGFydChjYW52YXNJZCwgc2VyaWUsIGZtdCwgY29sb3IsIGNvbkVzdGltYWRvKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgY29uc3QgbGFiZWxzID0gc2VyaWUubWFwKChwKSA9PiBfbGFiZWxNZXMocC5tZXMpKTtcbiAgY29uc3QgZGF0YXNldHMgPSBbXTtcbiAgaWYgKGNvbkVzdGltYWRvKSB7XG4gICAgY29uc3QgcyA9IF9zcGxpdEJhY2tvcmRlcihzZXJpZSk7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ3JlYWwnLFxuICAgICAgZGF0YTogcy5yZWFsLFxuICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgIHRlbnNpb246IDAuMixcbiAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgIH0pO1xuICAgIGlmIChzLmhheUVzdGltYWRvKSB7XG4gICAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgICAgbGFiZWw6ICdlc3RpbWFkbycsXG4gICAgICAgIGRhdGE6IHMuZXN0LFxuICAgICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICAgIGJvcmRlckRhc2g6IFs2LCA0XSxcbiAgICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgICAgICBwb2ludFN0eWxlOiAncmVjdFJvdCcsXG4gICAgICB9KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ2ZhY3R1cmFkbycsXG4gICAgICBkYXRhOiBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSksXG4gICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgfSk7XG4gIH1cbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnbGluZScsXG4gICAgZGF0YTogeyBsYWJlbHMsIGRhdGFzZXRzIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgcmVzcG9uc2l2ZTogdHJ1ZSxcbiAgICAgIG1haW50YWluQXNwZWN0UmF0aW86IGZhbHNlLFxuICAgICAgYW5pbWF0aW9uOiBmYWxzZSxcbiAgICAgIHBsdWdpbnM6IHtcbiAgICAgICAgbGVnZW5kOiB7IGRpc3BsYXk6IGNvbkVzdGltYWRvICYmIGRhdGFzZXRzLmxlbmd0aCA+IDEgfSxcbiAgICAgICAgdG9vbHRpcDogeyBjYWxsYmFja3M6IHsgbGFiZWw6IChpdGVtKSA9PiBpdGVtLmRhdGFzZXQubGFiZWwgKyAnOiAnICsgZm10KGl0ZW0ucmF3KSB9IH0sXG4gICAgICB9LFxuICAgICAgc2NhbGVzOiB7XG4gICAgICAgIHk6IHtcbiAgICAgICAgICBiZWdpbkF0WmVybzogdHJ1ZSxcbiAgICAgICAgICBncmlkOiBDSEFSVF9HUklELFxuICAgICAgICAgIGJvcmRlcjogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBmb250OiB7IGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY2FsbGJhY2s6ICh2KSA9PiBmbXQodiksXG4gICAgICAgICAgICBtYXhUaWNrc0xpbWl0OiA2LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgeDoge1xuICAgICAgICAgIGdyaWQ6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczogeyBmb250OiB7IGZhbWlseTogQ0hBUlRfRk9OVCB9LCBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gX2RyYXdDaGFydHMoZCkge1xuICAvLyBQdWVkZSBxdWUgZWwgdXN1YXJpbyBoYXlhIHJlLXJlbmRlcml6YWRvIG1pZW50cmFzIGNhcmdhYmEgQ2hhcnQuanMuXG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLXVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSwgJ3VkcycsIF9mbXRVZHMsICcjMDI4NGEwJyk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLWRpbmVybycsIGQudG9wRGluZXJvIHx8IFtdLCAnYXJzJywgX2ZtdEFycywgJyMxNmEzNGEnKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtdmVudGFzJywgZC5zZXJpZVZlbnRhcyB8fCBbXSwgX2ZtdEFycywgJyMxZTQwYWYnLCBmYWxzZSk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LWJvLXVkcycsIGQuc2VyaWVCb1VkcyB8fCBbXSwgX2ZtdFVkcywgJyNjMjQxMGMnLCB0cnVlKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtYm8tYXJzJywgZC5zZXJpZUJvQXJzIHx8IFtdLCBfZm10QXJzLCAnIzlmMTIzOScsIHRydWUpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERhdG9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX2ZpbHRyb3NQYXlsb2FkKCkge1xuICByZXR1cm4ge1xuICAgIG1lczogc3RhdGUubWVzLFxuICAgIHZlbmRlZG9yZXM6IF9pc1ZlbmRlZG9yKCkgPyBbXSA6IHN0YXRlLnNlbC52ZW5kZWRvcmVzLnNsaWNlKCksXG4gICAgY2xpZW50ZXM6IHN0YXRlLnNlbC5jbGllbnRlcy5zbGljZSgpLFxuICAgIHByb3ZpbmNpYXM6IHN0YXRlLnNlbC5wcm92aW5jaWFzLnNsaWNlKCksXG4gICAgY2F0ZWdvcmlhczogc3RhdGUuc2VsLmNhdGVnb3JpYXMuc2xpY2UoKSxcbiAgICBza3VzOiBzdGF0ZS5zZWwuc2t1cy5zbGljZSgpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjYXJnYXIoKSB7XG4gIGNvbnN0IHNlcSA9ICsrc3RhdGUucmVxU2VxO1xuICBzdGF0ZS5sb2FkaW5nID0gdHJ1ZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgcmVuZGVyKCk7XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBmaXJlYmFzZSA9PT0gJ3VuZGVmaW5lZCcgfHwgIWZpcmViYXNlLmFwcCkgdGhyb3cgbmV3IEVycm9yKCdmaXJlYmFzZSBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3QgY2FsbGFibGUgPSBmaXJlYmFzZS5hcHAoKS5mdW5jdGlvbnMoUkVHSU9OKS5odHRwc0NhbGxhYmxlKCdkYXNoYm9hcmRWZW50YXNDRicpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKF9maWx0cm9zUGF5bG9hZCgpKTtcbiAgICBpZiAoc2VxICE9PSBzdGF0ZS5yZXFTZXEpIHJldHVybjtcbiAgICBzdGF0ZS5kYXRhID0gKHJlcyAmJiByZXMuZGF0YSkgfHwgbnVsbDtcbiAgICBpZiAoc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLm9wY2lvbmVzKSBzdGF0ZS5vcGNpb25lcyA9IHN0YXRlLmRhdGEub3BjaW9uZXM7XG4gICAgc3RhdGUudmVyTWFzID0geyB1bmlkYWRlczogZmFsc2UsIGRpbmVybzogZmFsc2UgfTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tkYXNoYm9hcmQtdmVudGFzXSBkYXNoYm9hcmRWZW50YXNDRiBmYWxsbzonLCBlKTtcbiAgICBzdGF0ZS5lcnJvciA9IF9lcnJvck1lc3NhZ2UoKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoc2VxID09PSBzdGF0ZS5yZXFTZXEpIHtcbiAgICAgIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV2ZW50b3MgKGRlbGVnYWRvcyBzb2JyZSBlbCBib2R5IGRlbCBtb2RhbClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5sZXQgX3dpcmVkID0gZmFsc2U7XG5mdW5jdGlvbiBfd2lyZSgpIHtcbiAgaWYgKF93aXJlZCkgcmV0dXJuO1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtYm9keScpO1xuICBpZiAoIWJvZHkpIHJldHVybjtcbiAgX3dpcmVkID0gdHJ1ZTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAoISh0IGluc3RhbmNlb2YgRWxlbWVudCkpIHJldHVybjtcbiAgICBjb25zdCBhY3QgPSB0LmNsb3Nlc3QoJ1tkYXRhLWR2LWFjdGlvbl0nKTtcbiAgICBpZiAoYWN0KSB7XG4gICAgICBjb25zdCBhID0gYWN0LmdldEF0dHJpYnV0ZSgnZGF0YS1kdi1hY3Rpb24nKTtcbiAgICAgIGlmIChhID09PSAnYXBsaWNhcicpIHtcbiAgICAgICAgX3JlYWRTZWxGcm9tRG9tKGJvZHkpO1xuICAgICAgICBjYXJnYXIoKTtcbiAgICAgIH0gZWxzZSBpZiAoYSA9PT0gJ2xpbXBpYXInKSB7XG4gICAgICAgIHN0YXRlLnNlbCA9IF9zZWxWYWNpYSgpO1xuICAgICAgICBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gICAgICAgIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gICAgICAgIGNhcmdhcigpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bSA9IHQuY2xvc2VzdCgnW2RhdGEtdmVybWFzXScpO1xuICAgIGlmICh2bSkge1xuICAgICAgY29uc3QgdGlwbyA9IHZtLmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMnKSA9PT0gJ2RpbmVybycgPyAnZGluZXJvJyA6ICd1bmlkYWRlcyc7XG4gICAgICBzdGF0ZS52ZXJNYXNbdGlwb10gPSAhc3RhdGUudmVyTWFzW3RpcG9dO1xuICAgICAgLy8gU29sbyByZXN1bHRhZG9zOiBubyBzZSBsZWVuIG5pIHNlIHBpc2FuIGZpbHRyb3Mgc2luIGFwbGljYXIuXG4gICAgICByZW5kZXJSZXN1bHRzKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGNsciA9IHQuY2xvc2VzdCgnW2RhdGEtbXMtY2xlYXJdJyk7XG4gICAgaWYgKGNscikge1xuICAgICAgY29uc3Qga2V5ID0gY2xyLmdldEF0dHJpYnV0ZSgnZGF0YS1tcy1jbGVhcicpO1xuICAgICAgYm9keS5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl1bZGF0YS1maWx0cm89XCInICsga2V5ICsgJ1wiXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgICAgIGVsLmNoZWNrZWQgPSBmYWxzZTtcbiAgICAgIH0pO1xuICAgICAgX3VwZGF0ZVN1bW1hcnkoYm9keSwga2V5KTtcbiAgICB9XG4gIH0pO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAodCBpbnN0YW5jZW9mIEhUTUxJbnB1dEVsZW1lbnQgJiYgdC50eXBlID09PSAnY2hlY2tib3gnICYmIHQuaGFzQXR0cmlidXRlKCdkYXRhLWZpbHRybycpKSB7XG4gICAgICBfdXBkYXRlU3VtbWFyeShib2R5LCB0LmdldEF0dHJpYnV0ZSgnZGF0YS1maWx0cm8nKSk7XG4gICAgfVxuICB9KTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAoISh0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCkpIHJldHVybjtcbiAgICBjb25zdCBtc0tleSA9IHQuZ2V0QXR0cmlidXRlKCdkYXRhLW1zLXNlYXJjaCcpO1xuICAgIGlmIChtc0tleSkge1xuICAgICAgY29uc3QgcSA9IHQudmFsdWUudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gICAgICBjb25zdCBkZXQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJ2RldGFpbHNbZGF0YS1tcz1cIicgKyBtc0tleSArICdcIl0nKTtcbiAgICAgIGlmICghZGV0KSByZXR1cm47XG4gICAgICBkZXQucXVlcnlTZWxlY3RvckFsbCgnLmR2LW1zLW9wdCcpLmZvckVhY2goKG9wdCkgPT4ge1xuICAgICAgICBjb25zdCBzID0gb3B0LmdldEF0dHJpYnV0ZSgnZGF0YS1zZWFyY2gnKSB8fCAnJztcbiAgICAgICAgb3B0LnN0eWxlLmRpc3BsYXkgPSAhcSB8fCBzLmluY2x1ZGVzKHEpID8gJycgOiAnbm9uZSc7XG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHQuaWQgPT09ICdkdi1pbnRlcmFjY2lvbmVzLWJ1c2NhcicpIHtcbiAgICAgIHN0YXRlLmludGVyUXVlcnkgPSB0LnZhbHVlO1xuICAgICAgY29uc3QgZyA9IHN0YXRlLmRhdGEgJiYgc3RhdGUuZGF0YS5nZXN0aW9uO1xuICAgICAgY29uc3QgdGkgPSAoZyAmJiBnLnRhYmxhSW50ZXJhY2Npb25lcykgfHwgeyByb3dzOiBbXSwgdG90YWw6IDAgfTtcbiAgICAgIGNvbnN0IGNvbnQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJyNkdi1pbnRlcmFjY2lvbmVzIC5kdi1pbnRlci1ib2R5Jyk7XG4gICAgICBpZiAoY29udCkgY29udC5pbm5lckhUTUwgPSBfaW50ZXJhY2Npb25lc1RhYmxhKHRpLnJvd3MsIHRpLnRvdGFsLCBzdGF0ZS5pbnRlclF1ZXJ5KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgdm1BdHRyID0gdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdmVybWFzLXNlYXJjaCcpO1xuICAgIGlmICh2bUF0dHIpIHtcbiAgICAgIC8vIFNvbG8gZG9zIHJhbmtpbmdzIHBvc2libGVzOiBudW5jYSByZXVzYXIgZWwgdGV4dG8gZGVsIGF0cmlidXRvIGVuIGVsIEhUTUwuXG4gICAgICBjb25zdCB2bUtleSA9IHZtQXR0ciA9PT0gJ2RpbmVybycgPyAnZGluZXJvJyA6ICd1bmlkYWRlcyc7XG4gICAgICBzdGF0ZS52ZXJNYXNRdWVyeVt2bUtleV0gPSB0LnZhbHVlO1xuICAgICAgY29uc3Qgc2VjID0gdC5jbG9zZXN0KCcuZHYtdmVybWFzJyk7XG4gICAgICBjb25zdCByb3dzID1cbiAgICAgICAgKHN0YXRlLmRhdGEgJiYgKHZtS2V5ID09PSAndW5pZGFkZXMnID8gc3RhdGUuZGF0YS50b3BVbmlkYWRlcyA6IHN0YXRlLmRhdGEudG9wRGluZXJvKSkgfHxcbiAgICAgICAgW107XG4gICAgICBpZiAoc2VjKSB7XG4gICAgICAgIGNvbnN0IHRtcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgICB0bXAuaW5uZXJIVE1MID0gX3Zlck1hc1RhYmxhKHZtS2V5LCByb3dzKTtcbiAgICAgICAgY29uc3QgbmV3V3JhcCA9IHRtcC5xdWVyeVNlbGVjdG9yKCcuZHYtdGFibGUtd3JhcCcpO1xuICAgICAgICBjb25zdCBvbGRXcmFwID0gc2VjLnF1ZXJ5U2VsZWN0b3IoJy5kdi10YWJsZS13cmFwJyk7XG4gICAgICAgIGlmIChuZXdXcmFwICYmIG9sZFdyYXApIG9sZFdyYXAucmVwbGFjZVdpdGgobmV3V3JhcCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuZnVuY3Rpb24gX3VwZGF0ZVN1bW1hcnkoYm9keSwga2V5KSB7XG4gIGNvbnN0IGRldCA9IGJvZHkucXVlcnlTZWxlY3RvcignZGV0YWlsc1tkYXRhLW1zPVwiJyArIGtleSArICdcIl0nKTtcbiAgaWYgKCFkZXQpIHJldHVybjtcbiAgY29uc3QgY2hlY2tlZCA9IEFycmF5LmZyb20oZGV0LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXTpjaGVja2VkJykpO1xuICBjb25zdCBzdW0gPSBkZXQucXVlcnlTZWxlY3Rvcignc3VtbWFyeScpO1xuICBpZiAoIXN1bSkgcmV0dXJuO1xuICBpZiAoY2hlY2tlZC5sZW5ndGggPT09IDApIHN1bS50ZXh0Q29udGVudCA9ICdUb2Rvcyc7XG4gIGVsc2UgaWYgKGNoZWNrZWQubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3Qgc3BhbiA9IGNoZWNrZWRbMF0ucGFyZW50RWxlbWVudCAmJiBjaGVja2VkWzBdLnBhcmVudEVsZW1lbnQucXVlcnlTZWxlY3Rvcignc3BhbicpO1xuICAgIHN1bS50ZXh0Q29udGVudCA9IHNwYW4gPyBzcGFuLnRleHRDb250ZW50IDogY2hlY2tlZFswXS52YWx1ZTtcbiAgfSBlbHNlIHN1bS50ZXh0Q29udGVudCA9IGNoZWNrZWQubGVuZ3RoICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBUEkgcFx1MDBGQWJsaWNhIChleHBvcnRzIGRlbCBjaHVuaylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG53aW5kb3cub3BlbkRhc2hib2FyZFZlbnRhcyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSByZXR1cm47XG4gIGNvbnN0IHJvbGUgPSBfcm9sZSgpO1xuICBpZiAocm9sZSAhPT0gJ2FkbWluJyAmJiByb2xlICE9PSAnZ2VyZW50ZScgJiYgcm9sZSAhPT0gJ3ZlbmRlZG9yJykge1xuICAgIGFsZXJ0KCdUdSB1c3VhcmlvIG5vIHRpZW5lIGFjY2VzbyBhbCBEYXNoYm9hcmQgZGUgVmVudGFzLiBTaSBsbyBuZWNlc2l0XHUwMEUxcywgYXZpc2FsZSBhIE1hcmlhbm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE90cm8gdXN1YXJpbyBlbiBsYSBtaXNtYSBwZXN0YVx1MDBGMWEgKGxvZ291dCArIGxvZ2luIHNpbiByZWNhcmdhcik6IHNlXG4gIC8vIGRlc2NhcnRhIHRvZG8gbG8gZGVsIGFudGVyaW9yLiBNaXNtbyB1c3VhcmlvOiBzZSBjb25zZXJ2YSBzdSBzZWxlY2NpXHUwMEYzbi5cbiAgY29uc3QgdWlkID0gX2N1cnJlbnRVaWQoKTtcbiAgaWYgKHVpZCAhPT0gc3RhdGUudWlkKSBfcmVzZXRTdGF0ZSh1aWQpO1xuICBpZiAoIXN0YXRlLm1lcykgc3RhdGUubWVzID0gX21lc0FjdHVhbEFydCgpO1xuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIF9lbnN1cmVTa2VsZXRvbigpO1xuICBfd2lyZSgpO1xuICByZW5kZXJGaWx0cm9zKHRydWUpO1xuICAvLyBQcmVjYXJnYSBDaGFydC5qcyBlbiBwYXJhbGVsbyBhIGxhIGNvbnN1bHRhLlxuICBfbG9hZENoYXJ0SnMoKS5jYXRjaCgoKSA9PiB7fSk7XG4gIC8vIFNpZW1wcmUgc2UgcGlkZSBkZSBudWV2byBhbCBhYnJpciAoZWwgc2Vydmlkb3IgY2FjaGVhIDEwIG1pbikuXG4gIGNhcmdhcigpO1xufTtcblxud2luZG93LmNsb3NlRGFzaGJvYXJkVmVudGFzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBfZGVzdHJveUNoYXJ0cygpO1xuICAvLyBMb3MgZGF0b3Mgbm8gc2UgZ3VhcmRhbiBlbnRyZSBhcGVydHVyYXM7IHNlIHZ1ZWx2ZW4gYSBwZWRpciBhbCBhYnJpci5cbiAgc3RhdGUuZGF0YSA9IG51bGw7XG4gIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgc3RhdGUucmVxU2VxKys7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBaUJBLE1BQU0sZUFBZTtBQUNyQixNQUFNLFFBQVE7QUFDZCxNQUFNLFNBQVM7QUFFZixNQUFNLGNBQWM7QUFBQSxJQUNsQixFQUFFLEtBQUssY0FBYyxPQUFPLFdBQVc7QUFBQSxJQUN2QyxFQUFFLEtBQUssWUFBWSxPQUFPLFVBQVU7QUFBQSxJQUNwQyxFQUFFLEtBQUssY0FBYyxPQUFPLFlBQVk7QUFBQSxJQUN4QyxFQUFFLEtBQUssY0FBYyxPQUFPLGVBQVk7QUFBQSxJQUN4QyxFQUFFLEtBQUssUUFBUSxPQUFPLE1BQU07QUFBQSxFQUM5QjtBQUVBLFdBQVMsWUFBWTtBQUNuQixXQUFPLEVBQUUsWUFBWSxDQUFDLEdBQUcsVUFBVSxDQUFDLEdBQUcsWUFBWSxDQUFDLEdBQUcsWUFBWSxDQUFDLEdBQUcsTUFBTSxDQUFDLEVBQUU7QUFBQSxFQUNsRjtBQUtBLE1BQU0sUUFBUTtBQUFBLElBQ1osS0FBSztBQUFBLElBQ0wsS0FBSztBQUFBLElBQ0wsS0FBSyxVQUFVO0FBQUEsSUFDZixNQUFNO0FBQUEsSUFDTixVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixTQUFTO0FBQUEsSUFDVCxPQUFPO0FBQUEsSUFDUCxRQUFRLEVBQUUsVUFBVSxPQUFPLFFBQVEsTUFBTTtBQUFBLElBQ3pDLGFBQWEsRUFBRSxVQUFV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
