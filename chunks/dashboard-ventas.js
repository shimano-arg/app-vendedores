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
    state.reqSeq++;
  }
  var charts = {};
  var chartJsPromise = null;
  function _escHtml(s) {
    const v = s == null ? "" : s;
    if (typeof window !== "undefined" && typeof window.escapeHtml === "function") {
      return window.escapeHtml(v);
    }
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
  function _verMasTabla(tipo, rows) {
    const q = state.verMasQuery[tipo].toLowerCase().trim();
    const ranked = rows.map((r, i) => ({ r, pos: i + 1 }));
    const filtered = q ? ranked.filter(
      (x) => (String(x.r.sku) + " " + String(x.r.desc || "")).toLowerCase().includes(q)
    ) : ranked;
    let html = '<div class="dv-vermas"><input type="search" class="dv-ms-search" placeholder="Buscar SKU o descripci\xF3n\u2026" data-vermas-search="' + tipo + '" value="' + _escHtml(state.verMasQuery[tipo]) + '"><div class="dv-table-wrap"><table class="dv-table"><thead><tr><th>#</th><th>SKU</th><th>Descripci\xF3n</th><th class="num">Unidades</th><th class="num">Dinero</th></tr></thead><tbody>';
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
      html += _topSection("unidades", "Top 20 SKU - Unidades", d.topUnidades || []);
      html += _topSection("dinero", "Top 20 SKU - Dinero", d.topDinero || []);
      html += _lineSection("dv-chart-ventas", "Evoluci\xF3n de ventas");
      html += _lineSection("dv-chart-bo-uds", "Evoluci\xF3n del backorder - Unidades");
      html += _lineSection("dv-chart-bo-ars", "Evoluci\xF3n del backorder - Dinero");
    }
    _destroyCharts();
    root.innerHTML = html;
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
            ticks: {
              callback: (v) => fmt(v),
              maxTicksLimit: 5,
              color: _cssVar("--text-muted", "#64748b")
            }
          },
          y: {
            ticks: {
              autoSkip: false,
              font: { size: 10 },
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
            ticks: {
              callback: (v) => fmt(v),
              maxTicksLimit: 6,
              color: _cssVar("--text-muted", "#64748b")
            }
          },
          x: { ticks: { color: _cssVar("--text-muted", "#64748b") } }
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
        const tipo = vm.getAttribute("data-vermas");
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
      const vmKey = t.getAttribute("data-vermas-search");
      if (vmKey) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI5LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlIH0sXG4gIHZlck1hc1F1ZXJ5OiB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJyB9LFxuICByZXFTZXE6IDAsXG59O1xuXG5mdW5jdGlvbiBfcmVzZXRTdGF0ZSh1aWQpIHtcbiAgc3RhdGUudWlkID0gdWlkO1xuICBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIHN0YXRlLnNlbCA9IF9zZWxWYWNpYSgpO1xuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUub3BjaW9uZXMgPSBudWxsO1xuICBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICBzdGF0ZS5lcnJvciA9ICcnO1xuICBzdGF0ZS52ZXJNYXMgPSB7IHVuaWRhZGVzOiBmYWxzZSwgZGluZXJvOiBmYWxzZSB9O1xuICBzdGF0ZS52ZXJNYXNRdWVyeSA9IHsgdW5pZGFkZXM6ICcnLCBkaW5lcm86ICcnIH07XG4gIHN0YXRlLnJlcVNlcSsrO1xufVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG5jb25zdCBjaGFydHMgPSB7fTtcbmxldCBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF9lc2NIdG1sKHMpIHtcbiAgY29uc3QgdiA9IHMgPT0gbnVsbCA/ICcnIDogcztcbiAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbCh2KTtcbiAgfVxuICByZXR1cm4gU3RyaW5nKHYpXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JylcbiAgICAucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcbn1cblxuZnVuY3Rpb24gX2ZtdEFycyhuKSB7XG4gIGNvbnN0IHYgPSBOdW1iZXIobikgfHwgMDtcbiAgcmV0dXJuICckJyArIE1hdGgucm91bmQodikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbmZ1bmN0aW9uIF9mbXRVZHMobikge1xuICByZXR1cm4gTWF0aC5yb3VuZChOdW1iZXIobikgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbmZ1bmN0aW9uIF9yb2xlKCkge1xuICB0cnkge1xuICAgIHJldHVybiAodHlwZW9mIHVzZXJSb2xlICE9PSAndW5kZWZpbmVkJyA/IHVzZXJSb2xlIDogd2luZG93LnVzZXJSb2xlKSB8fCBudWxsO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB3aW5kb3cudXNlclJvbGUgfHwgbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBfbXlWZW5kb3IoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gYXNzaWduZWRWZW5kb3IgOiB3aW5kb3cuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB3aW5kb3cuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gIH1cbn1cblxuZnVuY3Rpb24gX2N1cnJlbnRVaWQoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHR5cGVvZiBjdXJyZW50VXNlciAhPT0gJ3VuZGVmaW5lZCcgPyBjdXJyZW50VXNlciA6IHdpbmRvdy5jdXJyZW50VXNlcjtcbiAgICByZXR1cm4gKHUgJiYgdS51aWQpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLnVpZCkgfHwgbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBfaXNPcGVuKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIHJldHVybiAhIShtb2RhbCAmJiBtb2RhbC5jbGFzc0xpc3QgJiYgbW9kYWwuY2xhc3NMaXN0LmNvbnRhaW5zKCdvcGVuJykpO1xufVxuXG5mdW5jdGlvbiBfaXNWZW5kZWRvcigpIHtcbiAgcmV0dXJuIF9yb2xlKCkgPT09ICd2ZW5kZWRvcic7XG59XG5cbi8qKiBNZXMgZW4gY3Vyc28gZW4gaG9yYSBBcmdlbnRpbmEsIGZvcm1hdG8gQUFBQS1NTS4gKi9cbmZ1bmN0aW9uIF9tZXNBY3R1YWxBcnQoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFydHMgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdCgnZW4tQ0EnLCB7XG4gICAgICB0aW1lWm9uZTogJ0FtZXJpY2EvQXJnZW50aW5hL0J1ZW5vc19BaXJlcycsXG4gICAgICB5ZWFyOiAnbnVtZXJpYycsXG4gICAgICBtb250aDogJzItZGlnaXQnLFxuICAgIH0pLmZvcm1hdFRvUGFydHMobmV3IERhdGUoKSk7XG4gICAgY29uc3QgeSA9IHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gJ3llYXInKS52YWx1ZTtcbiAgICBjb25zdCBtID0gcGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAnbW9udGgnKS52YWx1ZTtcbiAgICByZXR1cm4geSArICctJyArIG07XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKCk7XG4gICAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG59XG5cbmNvbnN0IE1FU0VTX0NPUlRPUyA9IFtcbiAgJ2VuZScsXG4gICdmZWInLFxuICAnbWFyJyxcbiAgJ2FicicsXG4gICdtYXknLFxuICAnanVuJyxcbiAgJ2p1bCcsXG4gICdhZ28nLFxuICAnc2VwJyxcbiAgJ29jdCcsXG4gICdub3YnLFxuICAnZGljJyxcbl07XG5mdW5jdGlvbiBfbGFiZWxNZXMoYWFhYW1tKSB7XG4gIGNvbnN0IHMgPSBTdHJpbmcoYWFhYW1tIHx8ICcnKTtcbiAgY29uc3QgbSA9IE51bWJlcihzLnNsaWNlKDUsIDcpKTtcbiAgaWYgKCFtKSByZXR1cm4gcztcbiAgcmV0dXJuIE1FU0VTX0NPUlRPU1ttIC0gMV0gKyAnICcgKyBzLnNsaWNlKDIsIDQpO1xufVxuXG5mdW5jdGlvbiBfZXJyb3JNZXNzYWdlKCkge1xuICB0cnkge1xuICAgIGNvbnN0IG12ID0gd2luZG93Ll9fcGhhc2UwICYmIHdpbmRvdy5fX3BoYXNlMC5wdXJlICYmIHdpbmRvdy5fX3BoYXNlMC5wdXJlLm1lbnNhamVzVmVuZGVkb3I7XG4gICAgaWYgKG12ICYmIHR5cGVvZiBtdi5mb3JtYXRNZW5zYWplQ29uQ29kaWdvID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gbXYuZm9ybWF0TWVuc2FqZUNvbkNvZGlnbygnREFTSEJPQVJEX1ZFTlRBU19GQUlMRUQnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKF9lKSB7fVxuICAvLyBGYWxsYmFjayBcdTAwQTc2OCBzaSBlbCBidW5kbGUgbm8gY2FyZ1x1MDBGMyAoU1cgc3RhbGUpLlxuICByZXR1cm4gKFxuICAgICdObyBwdWRpbW9zIGNhcmdhciBlbCB0YWJsZXJvIGRlIHZlbnRhcy4gVm9sdlx1MDBFOSBhIGludGVudGFyIGVuIHVuIG1pbnV0bzsgc2kgc2lndWUgcGFzYW5kbywgYXZpc2FsZSBhIE1hcmlhbm8uJyArXG4gICAgJ1xcblxcbkNcdTAwRjNkaWdvIHRcdTAwRTljbmljbzogREFTSEJPQVJEX1ZFTlRBU19GQUlMRUQnXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9sb2FkQ2hhcnRKcygpIHtcbiAgaWYgKHdpbmRvdy5DaGFydCkgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh3aW5kb3cuQ2hhcnQpO1xuICBpZiAoY2hhcnRKc1Byb21pc2UpIHJldHVybiBjaGFydEpzUHJvbWlzZTtcbiAgY2hhcnRKc1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHMuc3JjID0gQ0hBUlRfSlNfVVJMO1xuICAgIHMuYXN5bmMgPSB0cnVlO1xuICAgIHMub25sb2FkID0gKCkgPT5cbiAgICAgIHdpbmRvdy5DaGFydCA/IHJlc29sdmUod2luZG93LkNoYXJ0KSA6IHJlamVjdChuZXcgRXJyb3IoJ0NoYXJ0LmpzIHNpbiBnbG9iYWwnKSk7XG4gICAgcy5vbmVycm9yID0gKCkgPT4ge1xuICAgICAgY2hhcnRKc1Byb21pc2UgPSBudWxsO1xuICAgICAgcmVqZWN0KG5ldyBFcnJvcignbm8gc2UgcHVkbyBjYXJnYXIgQ2hhcnQuanMnKSk7XG4gICAgfTtcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xuICB9KTtcbiAgcmV0dXJuIGNoYXJ0SnNQcm9taXNlO1xufVxuXG5mdW5jdGlvbiBfZGVzdHJveUNoYXJ0cygpIHtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGNoYXJ0cykpIHtcbiAgICB0cnkge1xuICAgICAgY2hhcnRzW2tdLmRlc3Ryb3koKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgICBkZWxldGUgY2hhcnRzW2tdO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3BjaW9uZXMgZGUgZmlsdHJvc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEZXZ1ZWx2ZSBbe3ZhbHVlLGxhYmVsfV0gZGUgbGEgb3BjaVx1MDBGM24gYGtleWAgZGUgbGEgXHUwMEZBbHRpbWEgcmVzcHVlc3RhLiAqL1xuZnVuY3Rpb24gX29wY2lvbmVzRGUoa2V5KSB7XG4gIGNvbnN0IG9wID0gc3RhdGUub3BjaW9uZXMgfHwge307XG4gIGNvbnN0IGFyciA9IEFycmF5LmlzQXJyYXkob3Bba2V5XSkgPyBvcFtrZXldIDogW107XG4gIGlmIChrZXkgPT09ICdjbGllbnRlcycpIHtcbiAgICByZXR1cm4gYXJyLm1hcCgoYykgPT4gKHtcbiAgICAgIHZhbHVlOiBTdHJpbmcoYy5jb2RlKSxcbiAgICAgIGxhYmVsOiBTdHJpbmcoYy5uYW1lIHx8IGMuY29kZSkgKyAnICgnICsgU3RyaW5nKGMuY29kZSkgKyAnKScsXG4gICAgfSkpO1xuICB9XG4gIGlmIChrZXkgPT09ICdza3VzJykge1xuICAgIHJldHVybiBhcnIubWFwKChzKSA9PiAoe1xuICAgICAgdmFsdWU6IFN0cmluZyhzLmNvZGUpLFxuICAgICAgbGFiZWw6IFN0cmluZyhzLmNvZGUpICsgKHMuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHMuZGVzYykgOiAnJyksXG4gICAgfSkpO1xuICB9XG4gIHJldHVybiBhcnIubWFwKCh2KSA9PiAoeyB2YWx1ZTogU3RyaW5nKHYpLCBsYWJlbDogU3RyaW5nKHYpIH0pKTtcbn1cblxuZnVuY3Rpb24gX3Jlc3VtZW5TZWwoa2V5LCBvcGNpb25lcykge1xuICBjb25zdCBuID0gc3RhdGUuc2VsW2tleV0ubGVuZ3RoO1xuICBpZiAobiA9PT0gMCkgcmV0dXJuICdUb2Rvcyc7XG4gIGlmIChuID09PSAxKSB7XG4gICAgY29uc3QgbyA9IG9wY2lvbmVzLmZpbmQoKHgpID0+IHgudmFsdWUgPT09IHN0YXRlLnNlbFtrZXldWzBdKTtcbiAgICByZXR1cm4gbyA/IG8ubGFiZWwgOiBzdGF0ZS5zZWxba2V5XVswXTtcbiAgfVxuICByZXR1cm4gbiArICcgc2VsZWNjaW9uYWRvcyc7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJGaWx0cm8oZGVmKSB7XG4gIGlmIChkZWYua2V5ID09PSAndmVuZGVkb3JlcycgJiYgX2lzVmVuZGVkb3IoKSkge1xuICAgIHJldHVybiAoXG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWZpbHRyb1wiPjxkaXYgY2xhc3M9XCJkdi1maWx0cm8tbGFiZWxcIj4nICtcbiAgICAgIF9lc2NIdG1sKGRlZi5sYWJlbCkgK1xuICAgICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1tcy1sb2NrZWRcIiB0aXRsZT1cIlZlcyBzb2xvIHR1cyBjbGllbnRlc1wiPicgK1xuICAgICAgX2VzY0h0bWwoX215VmVuZG9yKCkgfHwgJ1R1cyBjbGllbnRlcycpICtcbiAgICAgICcgXHVEODNEXHVERDEyPC9kaXY+PC9kaXY+J1xuICAgICk7XG4gIH1cbiAgY29uc3Qgb3BjaW9uZXMgPSBfb3BjaW9uZXNEZShkZWYua2V5KTtcbiAgY29uc3Qgc2VsZWN0ZWQgPSBuZXcgU2V0KHN0YXRlLnNlbFtkZWYua2V5XSk7XG4gIGxldCBsaXN0ID0gJyc7XG4gIGZvciAoY29uc3QgbyBvZiBvcGNpb25lcykge1xuICAgIGxpc3QgKz1cbiAgICAgICc8bGFiZWwgY2xhc3M9XCJkdi1tcy1vcHRcIiBkYXRhLXNlYXJjaD1cIicgK1xuICAgICAgX2VzY0h0bWwoby5sYWJlbC50b0xvd2VyQ2FzZSgpKSArXG4gICAgICAnXCI+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGRhdGEtZmlsdHJvPVwiJyArXG4gICAgICBkZWYua2V5ICtcbiAgICAgICdcIiB2YWx1ZT1cIicgK1xuICAgICAgX2VzY0h0bWwoby52YWx1ZSkgK1xuICAgICAgJ1wiJyArXG4gICAgICAoc2VsZWN0ZWQuaGFzKG8udmFsdWUpID8gJyBjaGVja2VkJyA6ICcnKSArXG4gICAgICAnPiA8c3Bhbj4nICtcbiAgICAgIF9lc2NIdG1sKG8ubGFiZWwpICtcbiAgICAgICc8L3NwYW4+PC9sYWJlbD4nO1xuICB9XG4gIGlmICghbGlzdCkgbGlzdCA9ICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIiBzdHlsZT1cInBhZGRpbmc6NnB4XCI+U2luIG9wY2lvbmVzIHRvZGF2XHUwMEVEYS48L2Rpdj4nO1xuICByZXR1cm4gKFxuICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPicgK1xuICAgIF9lc2NIdG1sKGRlZi5sYWJlbCkgK1xuICAgICc8L2Rpdj48ZGV0YWlscyBjbGFzcz1cImR2LW1zXCIgZGF0YS1tcz1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj48c3VtbWFyeT4nICtcbiAgICBfZXNjSHRtbChfcmVzdW1lblNlbChkZWYua2V5LCBvcGNpb25lcykpICtcbiAgICAnPC9zdW1tYXJ5PjxkaXYgY2xhc3M9XCJkdi1tcy1wb3BcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyXHUyMDI2XCIgZGF0YS1tcy1zZWFyY2g9XCInICtcbiAgICBkZWYua2V5ICtcbiAgICAnXCI+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1tcy1hY3Rpb25zXCI+PGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1saW5rXCIgZGF0YS1tcy1jbGVhcj1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj5MaW1waWFyPC9idXR0b24+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1tcy1saXN0XCI+JyArXG4gICAgbGlzdCArXG4gICAgJzwvZGl2PjwvZGl2PjwvZGV0YWlscz48L2Rpdj4nXG4gICk7XG59XG5cbi8qKiBMZWUgZGVsIERPTSBsbyBxdWUgZWwgdXN1YXJpbyBtYXJjXHUwMEYzLiBTb2xvIHNlIGxsYW1hIGFsIHRvY2FyIFwiQXBsaWNhclwiLiAqL1xuZnVuY3Rpb24gX3JlYWRTZWxGcm9tRG9tKHJvb3QpIHtcbiAgY29uc3QgbmV4dCA9IF9zZWxWYWNpYSgpO1xuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXVtkYXRhLWZpbHRyb10nKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgIGNvbnN0IGtleSA9IGVsLmdldEF0dHJpYnV0ZSgnZGF0YS1maWx0cm8nKTtcbiAgICBpZiAoZWwuY2hlY2tlZCAmJiBuZXh0W2tleV0pIG5leHRba2V5XS5wdXNoKGVsLnZhbHVlKTtcbiAgfSk7XG4gIGlmIChfaXNWZW5kZWRvcigpKSBuZXh0LnZlbmRlZG9yZXMgPSBbXTtcbiAgc3RhdGUuc2VsID0gbmV4dDtcbiAgY29uc3QgbWVzRWwgPSByb290LnF1ZXJ5U2VsZWN0b3IoJyNkdi1tZXMnKTtcbiAgaWYgKG1lc0VsICYmIC9eXFxkezR9LVxcZHsyfSQvLnRlc3QobWVzRWwudmFsdWUpKSBzdGF0ZS5tZXMgPSBtZXNFbC52YWx1ZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQXJtYSBlbCBlc3F1ZWxldG8gKGZpbHRyb3MgYXJyaWJhLCByZXN1bHRhZG9zIGFiYWpvKSB1bmEgc29sYSB2ZXouICovXG5mdW5jdGlvbiBfZW5zdXJlU2tlbGV0b24oKSB7XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuIG51bGw7XG4gIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWZpbHRyb3MtaG9zdCcpIHx8ICFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtcmVzdWx0cycpKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPSAnPGRpdiBpZD1cImR2LWZpbHRyb3MtaG9zdFwiPjwvZGl2PjxkaXYgaWQ9XCJkdi1yZXN1bHRzXCI+PC9kaXY+JztcbiAgICBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID0gbnVsbDtcbiAgfVxuICByZXR1cm4gYm9keTtcbn1cblxuLyoqXG4gKiBQYW5lbCBkZSBmaWx0cm9zLiBTZSByZS1hcm1hIHNvbG8gY3VhbmRvIGNhbWJpYW4gbGFzIG9wY2lvbmVzICh1bmEgdmV6IHBvclxuICogcmVzcHVlc3RhKSwgYWwgcmVzZXRlYXIgcG9yIGNhbWJpbyBkZSB1c3VhcmlvIG8gY29uIFwiTGltcGlhciBmaWx0cm9zXCIuIE5pIGVsXG4gKiBcIkNhcmdhbmRvXHUyMDI2XCIgbmkgXCJWZXIgbVx1MDBFMXNcIiBsbyB0b2NhbiwgYXNcdTAwRUQgbm8gc2UgcGllcmRlbiBjYW1iaW9zIHNpbiBhcGxpY2FyLlxuICovXG5mdW5jdGlvbiByZW5kZXJGaWx0cm9zKGZvcmNlKSB7XG4gIGNvbnN0IGhvc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcy1ob3N0Jyk7XG4gIGlmICghaG9zdCkgcmV0dXJuO1xuICBpZiAoIWZvcmNlICYmIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPT09IHN0YXRlLm9wY2lvbmVzICYmIGhvc3QuaW5uZXJIVE1MKSByZXR1cm47XG4gIGNvbnN0IHByZXYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcycpO1xuICBjb25zdCBhYmllcnRvID0gcHJldiA/ICEhcHJldi5vcGVuIDogd2luZG93LmlubmVyV2lkdGggPiA3MDA7XG4gIGxldCBodG1sID0gJzxkZXRhaWxzIGNsYXNzPVwiZHYtZmlsdHJvc1wiIGlkPVwiZHYtZmlsdHJvc1wiJyArIChhYmllcnRvID8gJyBvcGVuJyA6ICcnKSArICc+JztcbiAgaHRtbCArPSAnPHN1bW1hcnk+RmlsdHJvczwvc3VtbWFyeT48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvcy1ncmlkXCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPk1lczwvZGl2PjxpbnB1dCB0eXBlPVwibW9udGhcIiBpZD1cImR2LW1lc1wiIGNsYXNzPVwiZHYtaW5wdXRcIiB2YWx1ZT1cIicgK1xuICAgIF9lc2NIdG1sKHN0YXRlLm1lcykgK1xuICAgICdcIj48L2Rpdj4nO1xuICBmb3IgKGNvbnN0IGRlZiBvZiBGSUxUUk9TX0RFRikgaHRtbCArPSBfcmVuZGVyRmlsdHJvKGRlZik7XG4gIGh0bWwgKz0gJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1maWx0cm9zLWFjdGlvbnNcIj4nO1xuICBodG1sICs9XG4gICAgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtYnRuLXNlY29uZGFyeVwiIGRhdGEtZHYtYWN0aW9uPVwibGltcGlhclwiPkxpbXBpYXIgZmlsdHJvczwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWJ0bi1wcmltYXJ5XCIgaWQ9XCJkdi1hcGxpY2FyXCIgZGF0YS1kdi1hY3Rpb249XCJhcGxpY2FyXCInICtcbiAgICAoc3RhdGUubG9hZGluZyA/ICcgZGlzYWJsZWQnIDogJycpICtcbiAgICAnPkFwbGljYXI8L2J1dHRvbj4nO1xuICBodG1sICs9ICc8L2Rpdj48L2RldGFpbHM+JztcbiAgaG9zdC5pbm5lckhUTUwgPSBodG1sO1xuICBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID0gc3RhdGUub3BjaW9uZXM7XG59XG5cbmZ1bmN0aW9uIF9zeW5jQXBsaWNhckRpc2FibGVkKCkge1xuICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtYXBsaWNhcicpO1xuICBpZiAoYnRuKSBidG4uZGlzYWJsZWQgPSAhIXN0YXRlLmxvYWRpbmc7XG59XG5cbmZ1bmN0aW9uIF9jYXJkKHRpdHVsbywgdmFsb3IpIHtcbiAgcmV0dXJuIChcbiAgICAnPGRpdiBjbGFzcz1cImR2LWNhcmRcIj48ZGl2IGNsYXNzPVwiZHYtY2FyZC10aXRsZVwiPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwiZHYtY2FyZC12YWx1ZVwiPicgK1xuICAgIF9lc2NIdG1sKHZhbG9yKSArXG4gICAgJzwvZGl2PjwvZGl2PidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX3Zlck1hc1RhYmxhKHRpcG8sIHJvd3MpIHtcbiAgY29uc3QgcSA9IHN0YXRlLnZlck1hc1F1ZXJ5W3RpcG9dLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuICAvLyBQb3NpY2lcdTAwRjNuIGRlbCByYW5raW5nIGNhbGN1bGFkYSB1bmEgc29sYSB2ZXogKHNpbiBpbmRleE9mIHBvciBmaWxhKS5cbiAgY29uc3QgcmFua2VkID0gcm93cy5tYXAoKHIsIGkpID0+ICh7IHIsIHBvczogaSArIDEgfSkpO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IHJhbmtlZC5maWx0ZXIoKHgpID0+XG4gICAgICAgIChTdHJpbmcoeC5yLnNrdSkgKyAnICcgKyBTdHJpbmcoeC5yLmRlc2MgfHwgJycpKS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpXG4gICAgICApXG4gICAgOiByYW5rZWQ7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LXZlcm1hc1wiPjxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2NhciBTS1UgbyBkZXNjcmlwY2lcdTAwRjNuXHUyMDI2XCIgZGF0YS12ZXJtYXMtc2VhcmNoPVwiJyArXG4gICAgdGlwbyArXG4gICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgX2VzY0h0bWwoc3RhdGUudmVyTWFzUXVlcnlbdGlwb10pICtcbiAgICAnXCI+PGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJkdi10YWJsZVwiPjx0aGVhZD48dHI+PHRoPiM8L3RoPjx0aD5TS1U8L3RoPjx0aD5EZXNjcmlwY2lcdTAwRjNuPC90aD48dGggY2xhc3M9XCJudW1cIj5VbmlkYWRlczwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RGluZXJvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgeyByLCBwb3MgfSBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKVxuICAgIGh0bWwgKz0gJzx0cj48dGQgY29sc3Bhbj1cIjVcIiBjbGFzcz1cImR2LW11dGVkXCI+U2luIHJlc3VsdGFkb3MuPC90ZD48L3RyPic7XG4gIGh0bWwgKz0gJzwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2Rpdj4nO1xuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gX3RvcFNlY3Rpb24odGlwbywgdGl0dWxvLCByb3dzKSB7XG4gIGNvbnN0IGFiaWVydG8gPSBzdGF0ZS52ZXJNYXNbdGlwb107XG4gIGNvbnN0IHRvdGFsID0gcm93cy5sZW5ndGg7XG4gIGNvbnN0IGggPSBNYXRoLm1heCgxMjAsIE1hdGgubWluKFRPUF9OLCB0b3RhbCkgKiAyMiArIDQwKTtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLXZlcm1hcz1cIicgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICtcbiAgICAgICAgKGFiaWVydG8gPyAndHJ1ZScgOiAnZmFsc2UnKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgKGFiaWVydG8gPyAnVmVyIG1lbm9zJyA6ICdWZXIgbVx1MDBFMXMnKSArXG4gICAgICAgICcgKCcgK1xuICAgICAgICB0b3RhbCArXG4gICAgICAgICcpPC9idXR0b24+J1xuICAgICAgOiAnJykgK1xuICAgICc8L2Rpdj4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDonICtcbiAgICAgICAgaCArXG4gICAgICAgICdweFwiPjxjYW52YXMgaWQ9XCJkdi1jaGFydC10b3AtJyArXG4gICAgICAgIHRpcG8gK1xuICAgICAgICAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICtcbiAgICAgICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgICAgICdcIj48L2NhbnZhcz48L2Rpdj4nXG4gICAgICA6ICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gZGF0b3MuPC9kaXY+JykgK1xuICAgIChhYmllcnRvID8gX3Zlck1hc1RhYmxhKHRpcG8sIHJvd3MpIDogJycpICtcbiAgICAnPC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xpbmVTZWN0aW9uKGlkLCB0aXR1bG8pIHtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz48L2Rpdj48ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDoyNDBweFwiPjxjYW52YXMgaWQ9XCInICtcbiAgICBpZCArXG4gICAgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJ1wiPjwvY2FudmFzPjwvZGl2Pjwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9pc0VtcHR5KGQpIHtcbiAgaWYgKCFkKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgY29uc3QgaGF5S3BpID1cbiAgICBOdW1iZXIoay5mYWN0dXJhZG8pIHx8IE51bWJlcihrLnBlZGlkb3MpIHx8IE51bWJlcihrLnBlZGlkb3NVbmljb3MpIHx8IE51bWJlcihrLmJhY2tvcmRlckFycyk7XG4gIGNvbnN0IGhheVRvcCA9IEFycmF5LmlzQXJyYXkoZC50b3BVbmlkYWRlcykgJiYgZC50b3BVbmlkYWRlcy5sZW5ndGggPiAwO1xuICBjb25zdCBoYXlTZXJpZSA9IEFycmF5LmlzQXJyYXkoZC5zZXJpZVZlbnRhcykgJiYgZC5zZXJpZVZlbnRhcy5zb21lKChwKSA9PiBOdW1iZXIocC52YWxvcikpO1xuICByZXR1cm4gIWhheUtwaSAmJiAhaGF5VG9wICYmICFoYXlTZXJpZTtcbn1cblxuLyoqIFJlc3VsdGFkb3MgKGxleWVuZGEsIHRhcmpldGFzLCByYW5raW5ncywgZ3JcdTAwRTFmaWNvcykuIE5vIHRvY2EgbG9zIGZpbHRyb3MuICovXG5mdW5jdGlvbiByZW5kZXJSZXN1bHRzKCkge1xuICBjb25zdCByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKTtcbiAgaWYgKCFyb290KSByZXR1cm47XG4gIGNvbnN0IGQgPSBzdGF0ZS5kYXRhO1xuXG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGFcIj5Nb250b3Mgc2luIElWQSwgY29uIGRlc2N1ZW50byBhcGxpY2FkbyB5IG5vdGFzIGRlIGNyXHUwMEU5ZGl0byByZXN0YWRhcy4nO1xuICBpZiAoZCAmJiBkLmRhdGFVcGRhdGVkQXQgJiYgIXN0YXRlLmxvYWRpbmcpIHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZC5kYXRhVXBkYXRlZEF0KTtcbiAgICBpZiAoIU51bWJlci5pc05hTih0LmdldFRpbWUoKSkpIHtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJyA8c3BhbiBjbGFzcz1cImR2LW11dGVkXCI+XHUwMEI3IENhbGN1bGFkbyAnICtcbiAgICAgICAgX2VzY0h0bWwodC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pKSArXG4gICAgICAgICc8L3NwYW4+JztcbiAgICB9XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICBpZiAoc3RhdGUubG9hZGluZykge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5DYXJnYW5kb1x1MjAyNjwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZXJyb3IpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWVzdGFkbyBkdi1lcnJvclwiPicgKyBfZXNjSHRtbChzdGF0ZS5lcnJvcikucmVwbGFjZSgvXFxuL2csICc8YnI+JykgKyAnPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkICYmIF9pc0VtcHR5KGQpKSB7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImR2LWVzdGFkb1wiPk5vIGhheSB2ZW50YXMgY29uIGVzb3MgZmlsdHJvcy48L2Rpdj4nO1xuICB9IGVsc2UgaWYgKGQpIHtcbiAgICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1jYXJkc1wiPic7XG4gICAgaHRtbCArPSBfY2FyZCgnRmFjdHVyYWRvIG1lbnN1YWwnLCBfZm10QXJzKGsuZmFjdHVyYWRvKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnVmFsb3JpemFjaVx1MDBGM24gYmFja29yZGVyJywgX2ZtdEFycyhrLmJhY2tvcmRlckFycykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIGRlIHBlZGlkb3MgZGVsIG1lcycsIF9mbXRVZHMoay5wZWRpZG9zKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnQ2FudC4gcGVkaWRvcyBcdTAwRkFuaWNvcycsIF9mbXRVZHMoay5wZWRpZG9zVW5pY29zKSk7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCd1bmlkYWRlcycsICdUb3AgMjAgU0tVIC0gVW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdKTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCdkaW5lcm8nLCAnVG9wIDIwIFNLVSAtIERpbmVybycsIGQudG9wRGluZXJvIHx8IFtdKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtdmVudGFzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlIHZlbnRhcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby11ZHMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIFVuaWRhZGVzJyk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LWJvLWFycycsICdFdm9sdWNpXHUwMEYzbiBkZWwgYmFja29yZGVyIC0gRGluZXJvJyk7XG4gIH1cblxuICBfZGVzdHJveUNoYXJ0cygpO1xuICByb290LmlubmVySFRNTCA9IGh0bWw7XG5cbiAgLy8gU2luIG1vZGFsIGFiaWVydG8gbm8gc2UgZGlidWphIChyZXNwdWVzdGEgcXVlIGxsZWdcdTAwRjMgZGVzcHVcdTAwRTlzIGRlIGNlcnJhcikuXG4gIGlmIChfaXNPcGVuKCkgJiYgIXN0YXRlLmxvYWRpbmcgJiYgIXN0YXRlLmVycm9yICYmIGQgJiYgIV9pc0VtcHR5KGQpKSB7XG4gICAgX2xvYWRDaGFydEpzKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKF9pc09wZW4oKSAmJiBzdGF0ZS5kYXRhID09PSBkKSBfZHJhd0NoYXJ0cyhkKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBpZiAoIV9lbnN1cmVTa2VsZXRvbigpKSByZXR1cm47XG4gIHJlbmRlckZpbHRyb3MoZmFsc2UpO1xuICBfc3luY0FwbGljYXJEaXNhYmxlZCgpO1xuICByZW5kZXJSZXN1bHRzKCk7XG59XG5cbmZ1bmN0aW9uIF9jc3NWYXIobmFtZSwgZmFsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB2ID0gZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmdldFByb3BlcnR5VmFsdWUobmFtZSkudHJpbSgpO1xuICAgIHJldHVybiB2IHx8IGZhbGxiYWNrO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5mdW5jdGlvbiBfYmFyQ2hhcnQoY2FudmFzSWQsIHJvd3MsIGZpZWxkLCBmbXQsIGNvbG9yKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgLy8gU3BlYzogU0tVcyBjb24gbmV0byA8PSAwIG5vIGVudHJhbiBhbCBUb3AgKGxhIHRhYmxhIFwiVmVyIG1cdTAwRTFzXCIgc1x1MDBFRCBsb3MgbXVlc3RyYSkuXG4gIGNvbnN0IHRvcCA9IHJvd3MuZmlsdGVyKChyKSA9PiAoTnVtYmVyKHJbZmllbGRdKSB8fCAwKSA+IDApLnNsaWNlKDAsIFRPUF9OKTtcbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnYmFyJyxcbiAgICBkYXRhOiB7XG4gICAgICBsYWJlbHM6IHRvcC5tYXAoKHIpID0+IFN0cmluZyhyLnNrdSkpLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAgeyBkYXRhOiB0b3AubWFwKChyKSA9PiBOdW1iZXIocltmaWVsZF0pIHx8IDApLCBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLCBib3JkZXJSYWRpdXM6IDMgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBpbmRleEF4aXM6ICd5JyxcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICB0b29sdGlwOiB7XG4gICAgICAgICAgY2FsbGJhY2tzOiB7XG4gICAgICAgICAgICB0aXRsZTogKGl0ZW1zKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSB0b3BbaXRlbXNbMF0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBTdHJpbmcoci5za3UpICsgKHIuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHIuZGVzYykgOiAnJykgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogKGl0ZW0pID0+IGZtdChpdGVtLnJhdyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeDoge1xuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IGZtdCh2KSxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDUsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB5OiB7XG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAgfSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtc2Vjb25kYXJ5JywgJyMzMzQxNTUnKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuLyoqXG4gKiBTZXJpZSBkZSBiYWNrIG9yZGVyIGVuIDIgZGF0YXNldHM6IHJlYWwgKGxcdTAwRURuZWEgbGxlbmEpIHkgZXN0aW1hZG8gKHB1bnRlYWRhKS5cbiAqIFVuIHB1bnRvIGVzdGltYWRvIHNlIGNvbmVjdGEgY29uIHN1IHZlY2lubyByZWFsIHBhcmEgcXVlIGxhIGN1cnZhIG5vIHF1ZWRlXG4gKiBjb3J0YWRhIGVuIGxhIHRyYW5zaWNpXHUwMEYzbjsgYG51bGxgIChzaW4gZGF0b3MpIGNvcnRhIGxhIGxcdTAwRURuZWEgKHNwYW5HYXBzOmZhbHNlKS5cbiAqL1xuZnVuY3Rpb24gX3NwbGl0QmFja29yZGVyKHNlcmllKSB7XG4gIGNvbnN0IHJlYWwgPSBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgfHwgcC5lc3RpbWFkbyA/IG51bGwgOiBOdW1iZXIocC52YWxvcikpKTtcbiAgY29uc3QgZXN0ID0gc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsIHx8ICFwLmVzdGltYWRvID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlcmllLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGVzdFtpXSA9PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAoaSArIDEgPCBzZXJpZS5sZW5ndGggJiYgcmVhbFtpICsgMV0gIT0gbnVsbCkgZXN0W2kgKyAxXSA9IHJlYWxbaSArIDFdO1xuICAgIGlmIChpIC0gMSA+PSAwICYmIHJlYWxbaSAtIDFdICE9IG51bGwgJiYgZXN0W2kgLSAxXSA9PSBudWxsKSBlc3RbaSAtIDFdID0gcmVhbFtpIC0gMV07XG4gIH1cbiAgcmV0dXJuIHsgcmVhbCwgZXN0LCBoYXlFc3RpbWFkbzogc2VyaWUuc29tZSgocCkgPT4gcC5lc3RpbWFkbyAmJiBwLnZhbG9yICE9IG51bGwpIH07XG59XG5cbmZ1bmN0aW9uIF9saW5lQ2hhcnQoY2FudmFzSWQsIHNlcmllLCBmbXQsIGNvbG9yLCBjb25Fc3RpbWFkbykge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGNhbnZhc0lkKTtcbiAgaWYgKCFlbCB8fCAhd2luZG93LkNoYXJ0KSByZXR1cm47XG4gIGNvbnN0IGxhYmVscyA9IHNlcmllLm1hcCgocCkgPT4gX2xhYmVsTWVzKHAubWVzKSk7XG4gIGNvbnN0IGRhdGFzZXRzID0gW107XG4gIGlmIChjb25Fc3RpbWFkbykge1xuICAgIGNvbnN0IHMgPSBfc3BsaXRCYWNrb3JkZXIoc2VyaWUpO1xuICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgbGFiZWw6ICdyZWFsJyxcbiAgICAgIGRhdGE6IHMucmVhbCxcbiAgICAgIGJvcmRlckNvbG9yOiBjb2xvcixcbiAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICBzcGFuR2FwczogZmFsc2UsXG4gICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICBwb2ludFJhZGl1czogMyxcbiAgICB9KTtcbiAgICBpZiAocy5oYXlFc3RpbWFkbykge1xuICAgICAgZGF0YXNldHMucHVzaCh7XG4gICAgICAgIGxhYmVsOiAnZXN0aW1hZG8nLFxuICAgICAgICBkYXRhOiBzLmVzdCxcbiAgICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgICBib3JkZXJEYXNoOiBbNiwgNF0sXG4gICAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgICBwb2ludFJhZGl1czogMyxcbiAgICAgICAgcG9pbnRTdHlsZTogJ3JlY3RSb3QnLFxuICAgICAgfSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgbGFiZWw6ICdmYWN0dXJhZG8nLFxuICAgICAgZGF0YTogc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpLFxuICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgIHRlbnNpb246IDAuMixcbiAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgIH0pO1xuICB9XG4gIGNoYXJ0c1tjYW52YXNJZF0gPSBuZXcgd2luZG93LkNoYXJ0KGVsLCB7XG4gICAgdHlwZTogJ2xpbmUnLFxuICAgIGRhdGE6IHsgbGFiZWxzLCBkYXRhc2V0cyB9LFxuICAgIG9wdGlvbnM6IHtcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBjb25Fc3RpbWFkbyAmJiBkYXRhc2V0cy5sZW5ndGggPiAxIH0sXG4gICAgICAgIHRvb2x0aXA6IHsgY2FsbGJhY2tzOiB7IGxhYmVsOiAoaXRlbSkgPT4gaXRlbS5kYXRhc2V0LmxhYmVsICsgJzogJyArIGZtdChpdGVtLnJhdykgfSB9LFxuICAgICAgfSxcbiAgICAgIHNjYWxlczoge1xuICAgICAgICB5OiB7XG4gICAgICAgICAgYmVnaW5BdFplcm86IHRydWUsXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNixcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHg6IHsgdGlja3M6IHsgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJykgfSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gX2RyYXdDaGFydHMoZCkge1xuICAvLyBQdWVkZSBxdWUgZWwgdXN1YXJpbyBoYXlhIHJlLXJlbmRlcml6YWRvIG1pZW50cmFzIGNhcmdhYmEgQ2hhcnQuanMuXG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLXVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSwgJ3VkcycsIF9mbXRVZHMsICcjMDI4NGEwJyk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLWRpbmVybycsIGQudG9wRGluZXJvIHx8IFtdLCAnYXJzJywgX2ZtdEFycywgJyMxNmEzNGEnKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtdmVudGFzJywgZC5zZXJpZVZlbnRhcyB8fCBbXSwgX2ZtdEFycywgJyMxZTQwYWYnLCBmYWxzZSk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LWJvLXVkcycsIGQuc2VyaWVCb1VkcyB8fCBbXSwgX2ZtdFVkcywgJyNjMjQxMGMnLCB0cnVlKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtYm8tYXJzJywgZC5zZXJpZUJvQXJzIHx8IFtdLCBfZm10QXJzLCAnIzlmMTIzOScsIHRydWUpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERhdG9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX2ZpbHRyb3NQYXlsb2FkKCkge1xuICByZXR1cm4ge1xuICAgIG1lczogc3RhdGUubWVzLFxuICAgIHZlbmRlZG9yZXM6IF9pc1ZlbmRlZG9yKCkgPyBbXSA6IHN0YXRlLnNlbC52ZW5kZWRvcmVzLnNsaWNlKCksXG4gICAgY2xpZW50ZXM6IHN0YXRlLnNlbC5jbGllbnRlcy5zbGljZSgpLFxuICAgIHByb3ZpbmNpYXM6IHN0YXRlLnNlbC5wcm92aW5jaWFzLnNsaWNlKCksXG4gICAgY2F0ZWdvcmlhczogc3RhdGUuc2VsLmNhdGVnb3JpYXMuc2xpY2UoKSxcbiAgICBza3VzOiBzdGF0ZS5zZWwuc2t1cy5zbGljZSgpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjYXJnYXIoKSB7XG4gIGNvbnN0IHNlcSA9ICsrc3RhdGUucmVxU2VxO1xuICBzdGF0ZS5sb2FkaW5nID0gdHJ1ZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgcmVuZGVyKCk7XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBmaXJlYmFzZSA9PT0gJ3VuZGVmaW5lZCcgfHwgIWZpcmViYXNlLmFwcCkgdGhyb3cgbmV3IEVycm9yKCdmaXJlYmFzZSBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3QgY2FsbGFibGUgPSBmaXJlYmFzZS5hcHAoKS5mdW5jdGlvbnMoUkVHSU9OKS5odHRwc0NhbGxhYmxlKCdkYXNoYm9hcmRWZW50YXNDRicpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKF9maWx0cm9zUGF5bG9hZCgpKTtcbiAgICBpZiAoc2VxICE9PSBzdGF0ZS5yZXFTZXEpIHJldHVybjtcbiAgICBzdGF0ZS5kYXRhID0gKHJlcyAmJiByZXMuZGF0YSkgfHwgbnVsbDtcbiAgICBpZiAoc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLm9wY2lvbmVzKSBzdGF0ZS5vcGNpb25lcyA9IHN0YXRlLmRhdGEub3BjaW9uZXM7XG4gICAgc3RhdGUudmVyTWFzID0geyB1bmlkYWRlczogZmFsc2UsIGRpbmVybzogZmFsc2UgfTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tkYXNoYm9hcmQtdmVudGFzXSBkYXNoYm9hcmRWZW50YXNDRiBmYWxsbzonLCBlKTtcbiAgICBzdGF0ZS5lcnJvciA9IF9lcnJvck1lc3NhZ2UoKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoc2VxID09PSBzdGF0ZS5yZXFTZXEpIHtcbiAgICAgIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV2ZW50b3MgKGRlbGVnYWRvcyBzb2JyZSBlbCBib2R5IGRlbCBtb2RhbClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5sZXQgX3dpcmVkID0gZmFsc2U7XG5mdW5jdGlvbiBfd2lyZSgpIHtcbiAgaWYgKF93aXJlZCkgcmV0dXJuO1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtYm9keScpO1xuICBpZiAoIWJvZHkpIHJldHVybjtcbiAgX3dpcmVkID0gdHJ1ZTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAoISh0IGluc3RhbmNlb2YgRWxlbWVudCkpIHJldHVybjtcbiAgICBjb25zdCBhY3QgPSB0LmNsb3Nlc3QoJ1tkYXRhLWR2LWFjdGlvbl0nKTtcbiAgICBpZiAoYWN0KSB7XG4gICAgICBjb25zdCBhID0gYWN0LmdldEF0dHJpYnV0ZSgnZGF0YS1kdi1hY3Rpb24nKTtcbiAgICAgIGlmIChhID09PSAnYXBsaWNhcicpIHtcbiAgICAgICAgX3JlYWRTZWxGcm9tRG9tKGJvZHkpO1xuICAgICAgICBjYXJnYXIoKTtcbiAgICAgIH0gZWxzZSBpZiAoYSA9PT0gJ2xpbXBpYXInKSB7XG4gICAgICAgIHN0YXRlLnNlbCA9IF9zZWxWYWNpYSgpO1xuICAgICAgICBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gICAgICAgIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gICAgICAgIGNhcmdhcigpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bSA9IHQuY2xvc2VzdCgnW2RhdGEtdmVybWFzXScpO1xuICAgIGlmICh2bSkge1xuICAgICAgY29uc3QgdGlwbyA9IHZtLmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMnKTtcbiAgICAgIHN0YXRlLnZlck1hc1t0aXBvXSA9ICFzdGF0ZS52ZXJNYXNbdGlwb107XG4gICAgICAvLyBTb2xvIHJlc3VsdGFkb3M6IG5vIHNlIGxlZW4gbmkgc2UgcGlzYW4gZmlsdHJvcyBzaW4gYXBsaWNhci5cbiAgICAgIHJlbmRlclJlc3VsdHMoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xyID0gdC5jbG9zZXN0KCdbZGF0YS1tcy1jbGVhcl0nKTtcbiAgICBpZiAoY2xyKSB7XG4gICAgICBjb25zdCBrZXkgPSBjbHIuZ2V0QXR0cmlidXRlKCdkYXRhLW1zLWNsZWFyJyk7XG4gICAgICBib2R5LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXVtkYXRhLWZpbHRybz1cIicgKyBrZXkgKyAnXCJdJykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICAgICAgZWwuY2hlY2tlZCA9IGZhbHNlO1xuICAgICAgfSk7XG4gICAgICBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpO1xuICAgIH1cbiAgfSk7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICh0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCAmJiB0LnR5cGUgPT09ICdjaGVja2JveCcgJiYgdC5oYXNBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJykpIHtcbiAgICAgIF91cGRhdGVTdW1tYXJ5KGJvZHksIHQuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpKTtcbiAgICB9XG4gIH0pO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICghKHQgaW5zdGFuY2VvZiBIVE1MSW5wdXRFbGVtZW50KSkgcmV0dXJuO1xuICAgIGNvbnN0IG1zS2V5ID0gdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbXMtc2VhcmNoJyk7XG4gICAgaWYgKG1zS2V5KSB7XG4gICAgICBjb25zdCBxID0gdC52YWx1ZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICAgIGNvbnN0IGRldCA9IGJvZHkucXVlcnlTZWxlY3RvcignZGV0YWlsc1tkYXRhLW1zPVwiJyArIG1zS2V5ICsgJ1wiXScpO1xuICAgICAgaWYgKCFkZXQpIHJldHVybjtcbiAgICAgIGRldC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtbXMtb3B0JykuZm9yRWFjaCgob3B0KSA9PiB7XG4gICAgICAgIGNvbnN0IHMgPSBvcHQuZ2V0QXR0cmlidXRlKCdkYXRhLXNlYXJjaCcpIHx8ICcnO1xuICAgICAgICBvcHQuc3R5bGUuZGlzcGxheSA9ICFxIHx8IHMuaW5jbHVkZXMocSkgPyAnJyA6ICdub25lJztcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bUtleSA9IHQuZ2V0QXR0cmlidXRlKCdkYXRhLXZlcm1hcy1zZWFyY2gnKTtcbiAgICBpZiAodm1LZXkpIHtcbiAgICAgIHN0YXRlLnZlck1hc1F1ZXJ5W3ZtS2V5XSA9IHQudmFsdWU7XG4gICAgICBjb25zdCBzZWMgPSB0LmNsb3Nlc3QoJy5kdi12ZXJtYXMnKTtcbiAgICAgIGNvbnN0IHJvd3MgPVxuICAgICAgICAoc3RhdGUuZGF0YSAmJiAodm1LZXkgPT09ICd1bmlkYWRlcycgPyBzdGF0ZS5kYXRhLnRvcFVuaWRhZGVzIDogc3RhdGUuZGF0YS50b3BEaW5lcm8pKSB8fFxuICAgICAgICBbXTtcbiAgICAgIGlmIChzZWMpIHtcbiAgICAgICAgY29uc3QgdG1wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRtcC5pbm5lckhUTUwgPSBfdmVyTWFzVGFibGEodm1LZXksIHJvd3MpO1xuICAgICAgICBjb25zdCBuZXdXcmFwID0gdG1wLnF1ZXJ5U2VsZWN0b3IoJy5kdi10YWJsZS13cmFwJyk7XG4gICAgICAgIGNvbnN0IG9sZFdyYXAgPSBzZWMucXVlcnlTZWxlY3RvcignLmR2LXRhYmxlLXdyYXAnKTtcbiAgICAgICAgaWYgKG5ld1dyYXAgJiYgb2xkV3JhcCkgb2xkV3JhcC5yZXBsYWNlV2l0aChuZXdXcmFwKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpIHtcbiAgY29uc3QgZGV0ID0gYm9keS5xdWVyeVNlbGVjdG9yKCdkZXRhaWxzW2RhdGEtbXM9XCInICsga2V5ICsgJ1wiXScpO1xuICBpZiAoIWRldCkgcmV0dXJuO1xuICBjb25zdCBjaGVja2VkID0gQXJyYXkuZnJvbShkZXQucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdOmNoZWNrZWQnKSk7XG4gIGNvbnN0IHN1bSA9IGRldC5xdWVyeVNlbGVjdG9yKCdzdW1tYXJ5Jyk7XG4gIGlmICghc3VtKSByZXR1cm47XG4gIGlmIChjaGVja2VkLmxlbmd0aCA9PT0gMCkgc3VtLnRleHRDb250ZW50ID0gJ1RvZG9zJztcbiAgZWxzZSBpZiAoY2hlY2tlZC5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzcGFuID0gY2hlY2tlZFswXS5wYXJlbnRFbGVtZW50ICYmIGNoZWNrZWRbMF0ucGFyZW50RWxlbWVudC5xdWVyeVNlbGVjdG9yKCdzcGFuJyk7XG4gICAgc3VtLnRleHRDb250ZW50ID0gc3BhbiA/IHNwYW4udGV4dENvbnRlbnQgOiBjaGVja2VkWzBdLnZhbHVlO1xuICB9IGVsc2Ugc3VtLnRleHRDb250ZW50ID0gY2hlY2tlZC5sZW5ndGggKyAnIHNlbGVjY2lvbmFkb3MnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFQSSBwXHUwMEZBYmxpY2EgKGV4cG9ydHMgZGVsIGNodW5rKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbndpbmRvdy5vcGVuRGFzaGJvYXJkVmVudGFzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHJldHVybjtcbiAgY29uc3Qgcm9sZSA9IF9yb2xlKCk7XG4gIGlmIChyb2xlICE9PSAnYWRtaW4nICYmIHJvbGUgIT09ICdnZXJlbnRlJyAmJiByb2xlICE9PSAndmVuZGVkb3InKSB7XG4gICAgYWxlcnQoJ1R1IHVzdWFyaW8gbm8gdGllbmUgYWNjZXNvIGFsIERhc2hib2FyZCBkZSBWZW50YXMuIFNpIGxvIG5lY2VzaXRcdTAwRTFzLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3RybyB1c3VhcmlvIGVuIGxhIG1pc21hIHBlc3RhXHUwMEYxYSAobG9nb3V0ICsgbG9naW4gc2luIHJlY2FyZ2FyKTogc2VcbiAgLy8gZGVzY2FydGEgdG9kbyBsbyBkZWwgYW50ZXJpb3IuIE1pc21vIHVzdWFyaW86IHNlIGNvbnNlcnZhIHN1IHNlbGVjY2lcdTAwRjNuLlxuICBjb25zdCB1aWQgPSBfY3VycmVudFVpZCgpO1xuICBpZiAodWlkICE9PSBzdGF0ZS51aWQpIF9yZXNldFN0YXRlKHVpZCk7XG4gIGlmICghc3RhdGUubWVzKSBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIG1vZGFsLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgX2Vuc3VyZVNrZWxldG9uKCk7XG4gIF93aXJlKCk7XG4gIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gIC8vIFByZWNhcmdhIENoYXJ0LmpzIGVuIHBhcmFsZWxvIGEgbGEgY29uc3VsdGEuXG4gIF9sb2FkQ2hhcnRKcygpLmNhdGNoKCgpID0+IHt9KTtcbiAgLy8gU2llbXByZSBzZSBwaWRlIGRlIG51ZXZvIGFsIGFicmlyIChlbCBzZXJ2aWRvciBjYWNoZWEgMTAgbWluKS5cbiAgY2FyZ2FyKCk7XG59O1xuXG53aW5kb3cuY2xvc2VEYXNoYm9hcmRWZW50YXMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgaWYgKG1vZGFsKSBtb2RhbC5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIC8vIExvcyBkYXRvcyBubyBzZSBndWFyZGFuIGVudHJlIGFwZXJ0dXJhczsgc2UgdnVlbHZlbiBhIHBlZGlyIGFsIGFicmlyLlxuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNl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
