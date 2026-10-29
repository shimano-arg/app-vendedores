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
    const top = rows.slice(0, TOP_N);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI4LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlIH0sXG4gIHZlck1hc1F1ZXJ5OiB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJyB9LFxuICByZXFTZXE6IDAsXG59O1xuXG5mdW5jdGlvbiBfcmVzZXRTdGF0ZSh1aWQpIHtcbiAgc3RhdGUudWlkID0gdWlkO1xuICBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIHN0YXRlLnNlbCA9IF9zZWxWYWNpYSgpO1xuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUub3BjaW9uZXMgPSBudWxsO1xuICBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICBzdGF0ZS5lcnJvciA9ICcnO1xuICBzdGF0ZS52ZXJNYXMgPSB7IHVuaWRhZGVzOiBmYWxzZSwgZGluZXJvOiBmYWxzZSB9O1xuICBzdGF0ZS52ZXJNYXNRdWVyeSA9IHsgdW5pZGFkZXM6ICcnLCBkaW5lcm86ICcnIH07XG4gIHN0YXRlLnJlcVNlcSsrO1xufVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG5jb25zdCBjaGFydHMgPSB7fTtcbmxldCBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF9lc2NIdG1sKHMpIHtcbiAgY29uc3QgdiA9IHMgPT0gbnVsbCA/ICcnIDogcztcbiAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbCh2KTtcbiAgfVxuICByZXR1cm4gU3RyaW5nKHYpXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JylcbiAgICAucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcbn1cblxuZnVuY3Rpb24gX2ZtdEFycyhuKSB7XG4gIGNvbnN0IHYgPSBOdW1iZXIobikgfHwgMDtcbiAgcmV0dXJuICckJyArIE1hdGgucm91bmQodikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbmZ1bmN0aW9uIF9mbXRVZHMobikge1xuICByZXR1cm4gTWF0aC5yb3VuZChOdW1iZXIobikgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbmZ1bmN0aW9uIF9yb2xlKCkge1xuICB0cnkge1xuICAgIHJldHVybiAodHlwZW9mIHVzZXJSb2xlICE9PSAndW5kZWZpbmVkJyA/IHVzZXJSb2xlIDogd2luZG93LnVzZXJSb2xlKSB8fCBudWxsO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB3aW5kb3cudXNlclJvbGUgfHwgbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBfbXlWZW5kb3IoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gYXNzaWduZWRWZW5kb3IgOiB3aW5kb3cuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB3aW5kb3cuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gIH1cbn1cblxuZnVuY3Rpb24gX2N1cnJlbnRVaWQoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHR5cGVvZiBjdXJyZW50VXNlciAhPT0gJ3VuZGVmaW5lZCcgPyBjdXJyZW50VXNlciA6IHdpbmRvdy5jdXJyZW50VXNlcjtcbiAgICByZXR1cm4gKHUgJiYgdS51aWQpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLnVpZCkgfHwgbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBfaXNPcGVuKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIHJldHVybiAhIShtb2RhbCAmJiBtb2RhbC5jbGFzc0xpc3QgJiYgbW9kYWwuY2xhc3NMaXN0LmNvbnRhaW5zKCdvcGVuJykpO1xufVxuXG5mdW5jdGlvbiBfaXNWZW5kZWRvcigpIHtcbiAgcmV0dXJuIF9yb2xlKCkgPT09ICd2ZW5kZWRvcic7XG59XG5cbi8qKiBNZXMgZW4gY3Vyc28gZW4gaG9yYSBBcmdlbnRpbmEsIGZvcm1hdG8gQUFBQS1NTS4gKi9cbmZ1bmN0aW9uIF9tZXNBY3R1YWxBcnQoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFydHMgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdCgnZW4tQ0EnLCB7XG4gICAgICB0aW1lWm9uZTogJ0FtZXJpY2EvQXJnZW50aW5hL0J1ZW5vc19BaXJlcycsXG4gICAgICB5ZWFyOiAnbnVtZXJpYycsXG4gICAgICBtb250aDogJzItZGlnaXQnLFxuICAgIH0pLmZvcm1hdFRvUGFydHMobmV3IERhdGUoKSk7XG4gICAgY29uc3QgeSA9IHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gJ3llYXInKS52YWx1ZTtcbiAgICBjb25zdCBtID0gcGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAnbW9udGgnKS52YWx1ZTtcbiAgICByZXR1cm4geSArICctJyArIG07XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKCk7XG4gICAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG59XG5cbmNvbnN0IE1FU0VTX0NPUlRPUyA9IFtcbiAgJ2VuZScsXG4gICdmZWInLFxuICAnbWFyJyxcbiAgJ2FicicsXG4gICdtYXknLFxuICAnanVuJyxcbiAgJ2p1bCcsXG4gICdhZ28nLFxuICAnc2VwJyxcbiAgJ29jdCcsXG4gICdub3YnLFxuICAnZGljJyxcbl07XG5mdW5jdGlvbiBfbGFiZWxNZXMoYWFhYW1tKSB7XG4gIGNvbnN0IHMgPSBTdHJpbmcoYWFhYW1tIHx8ICcnKTtcbiAgY29uc3QgbSA9IE51bWJlcihzLnNsaWNlKDUsIDcpKTtcbiAgaWYgKCFtKSByZXR1cm4gcztcbiAgcmV0dXJuIE1FU0VTX0NPUlRPU1ttIC0gMV0gKyAnICcgKyBzLnNsaWNlKDIsIDQpO1xufVxuXG5mdW5jdGlvbiBfZXJyb3JNZXNzYWdlKCkge1xuICB0cnkge1xuICAgIGNvbnN0IG12ID0gd2luZG93Ll9fcGhhc2UwICYmIHdpbmRvdy5fX3BoYXNlMC5wdXJlICYmIHdpbmRvdy5fX3BoYXNlMC5wdXJlLm1lbnNhamVzVmVuZGVkb3I7XG4gICAgaWYgKG12ICYmIHR5cGVvZiBtdi5mb3JtYXRNZW5zYWplQ29uQ29kaWdvID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gbXYuZm9ybWF0TWVuc2FqZUNvbkNvZGlnbygnREFTSEJPQVJEX1ZFTlRBU19GQUlMRUQnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKF9lKSB7fVxuICAvLyBGYWxsYmFjayBcdTAwQTc2OCBzaSBlbCBidW5kbGUgbm8gY2FyZ1x1MDBGMyAoU1cgc3RhbGUpLlxuICByZXR1cm4gKFxuICAgICdObyBwdWRpbW9zIGNhcmdhciBlbCB0YWJsZXJvIGRlIHZlbnRhcy4gVm9sdlx1MDBFOSBhIGludGVudGFyIGVuIHVuIG1pbnV0bzsgc2kgc2lndWUgcGFzYW5kbywgYXZpc2FsZSBhIE1hcmlhbm8uJyArXG4gICAgJ1xcblxcbkNcdTAwRjNkaWdvIHRcdTAwRTljbmljbzogREFTSEJPQVJEX1ZFTlRBU19GQUlMRUQnXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9sb2FkQ2hhcnRKcygpIHtcbiAgaWYgKHdpbmRvdy5DaGFydCkgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh3aW5kb3cuQ2hhcnQpO1xuICBpZiAoY2hhcnRKc1Byb21pc2UpIHJldHVybiBjaGFydEpzUHJvbWlzZTtcbiAgY2hhcnRKc1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHMuc3JjID0gQ0hBUlRfSlNfVVJMO1xuICAgIHMuYXN5bmMgPSB0cnVlO1xuICAgIHMub25sb2FkID0gKCkgPT5cbiAgICAgIHdpbmRvdy5DaGFydCA/IHJlc29sdmUod2luZG93LkNoYXJ0KSA6IHJlamVjdChuZXcgRXJyb3IoJ0NoYXJ0LmpzIHNpbiBnbG9iYWwnKSk7XG4gICAgcy5vbmVycm9yID0gKCkgPT4ge1xuICAgICAgY2hhcnRKc1Byb21pc2UgPSBudWxsO1xuICAgICAgcmVqZWN0KG5ldyBFcnJvcignbm8gc2UgcHVkbyBjYXJnYXIgQ2hhcnQuanMnKSk7XG4gICAgfTtcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xuICB9KTtcbiAgcmV0dXJuIGNoYXJ0SnNQcm9taXNlO1xufVxuXG5mdW5jdGlvbiBfZGVzdHJveUNoYXJ0cygpIHtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGNoYXJ0cykpIHtcbiAgICB0cnkge1xuICAgICAgY2hhcnRzW2tdLmRlc3Ryb3koKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgICBkZWxldGUgY2hhcnRzW2tdO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3BjaW9uZXMgZGUgZmlsdHJvc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEZXZ1ZWx2ZSBbe3ZhbHVlLGxhYmVsfV0gZGUgbGEgb3BjaVx1MDBGM24gYGtleWAgZGUgbGEgXHUwMEZBbHRpbWEgcmVzcHVlc3RhLiAqL1xuZnVuY3Rpb24gX29wY2lvbmVzRGUoa2V5KSB7XG4gIGNvbnN0IG9wID0gc3RhdGUub3BjaW9uZXMgfHwge307XG4gIGNvbnN0IGFyciA9IEFycmF5LmlzQXJyYXkob3Bba2V5XSkgPyBvcFtrZXldIDogW107XG4gIGlmIChrZXkgPT09ICdjbGllbnRlcycpIHtcbiAgICByZXR1cm4gYXJyLm1hcCgoYykgPT4gKHtcbiAgICAgIHZhbHVlOiBTdHJpbmcoYy5jb2RlKSxcbiAgICAgIGxhYmVsOiBTdHJpbmcoYy5uYW1lIHx8IGMuY29kZSkgKyAnICgnICsgU3RyaW5nKGMuY29kZSkgKyAnKScsXG4gICAgfSkpO1xuICB9XG4gIGlmIChrZXkgPT09ICdza3VzJykge1xuICAgIHJldHVybiBhcnIubWFwKChzKSA9PiAoe1xuICAgICAgdmFsdWU6IFN0cmluZyhzLmNvZGUpLFxuICAgICAgbGFiZWw6IFN0cmluZyhzLmNvZGUpICsgKHMuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHMuZGVzYykgOiAnJyksXG4gICAgfSkpO1xuICB9XG4gIHJldHVybiBhcnIubWFwKCh2KSA9PiAoeyB2YWx1ZTogU3RyaW5nKHYpLCBsYWJlbDogU3RyaW5nKHYpIH0pKTtcbn1cblxuZnVuY3Rpb24gX3Jlc3VtZW5TZWwoa2V5LCBvcGNpb25lcykge1xuICBjb25zdCBuID0gc3RhdGUuc2VsW2tleV0ubGVuZ3RoO1xuICBpZiAobiA9PT0gMCkgcmV0dXJuICdUb2Rvcyc7XG4gIGlmIChuID09PSAxKSB7XG4gICAgY29uc3QgbyA9IG9wY2lvbmVzLmZpbmQoKHgpID0+IHgudmFsdWUgPT09IHN0YXRlLnNlbFtrZXldWzBdKTtcbiAgICByZXR1cm4gbyA/IG8ubGFiZWwgOiBzdGF0ZS5zZWxba2V5XVswXTtcbiAgfVxuICByZXR1cm4gbiArICcgc2VsZWNjaW9uYWRvcyc7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJGaWx0cm8oZGVmKSB7XG4gIGlmIChkZWYua2V5ID09PSAndmVuZGVkb3JlcycgJiYgX2lzVmVuZGVkb3IoKSkge1xuICAgIHJldHVybiAoXG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWZpbHRyb1wiPjxkaXYgY2xhc3M9XCJkdi1maWx0cm8tbGFiZWxcIj4nICtcbiAgICAgIF9lc2NIdG1sKGRlZi5sYWJlbCkgK1xuICAgICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1tcy1sb2NrZWRcIiB0aXRsZT1cIlZlcyBzb2xvIHR1cyBjbGllbnRlc1wiPicgK1xuICAgICAgX2VzY0h0bWwoX215VmVuZG9yKCkgfHwgJ1R1cyBjbGllbnRlcycpICtcbiAgICAgICcgXHVEODNEXHVERDEyPC9kaXY+PC9kaXY+J1xuICAgICk7XG4gIH1cbiAgY29uc3Qgb3BjaW9uZXMgPSBfb3BjaW9uZXNEZShkZWYua2V5KTtcbiAgY29uc3Qgc2VsZWN0ZWQgPSBuZXcgU2V0KHN0YXRlLnNlbFtkZWYua2V5XSk7XG4gIGxldCBsaXN0ID0gJyc7XG4gIGZvciAoY29uc3QgbyBvZiBvcGNpb25lcykge1xuICAgIGxpc3QgKz1cbiAgICAgICc8bGFiZWwgY2xhc3M9XCJkdi1tcy1vcHRcIiBkYXRhLXNlYXJjaD1cIicgK1xuICAgICAgX2VzY0h0bWwoby5sYWJlbC50b0xvd2VyQ2FzZSgpKSArXG4gICAgICAnXCI+PGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGRhdGEtZmlsdHJvPVwiJyArXG4gICAgICBkZWYua2V5ICtcbiAgICAgICdcIiB2YWx1ZT1cIicgK1xuICAgICAgX2VzY0h0bWwoby52YWx1ZSkgK1xuICAgICAgJ1wiJyArXG4gICAgICAoc2VsZWN0ZWQuaGFzKG8udmFsdWUpID8gJyBjaGVja2VkJyA6ICcnKSArXG4gICAgICAnPiA8c3Bhbj4nICtcbiAgICAgIF9lc2NIdG1sKG8ubGFiZWwpICtcbiAgICAgICc8L3NwYW4+PC9sYWJlbD4nO1xuICB9XG4gIGlmICghbGlzdCkgbGlzdCA9ICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIiBzdHlsZT1cInBhZGRpbmc6NnB4XCI+U2luIG9wY2lvbmVzIHRvZGF2XHUwMEVEYS48L2Rpdj4nO1xuICByZXR1cm4gKFxuICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPicgK1xuICAgIF9lc2NIdG1sKGRlZi5sYWJlbCkgK1xuICAgICc8L2Rpdj48ZGV0YWlscyBjbGFzcz1cImR2LW1zXCIgZGF0YS1tcz1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj48c3VtbWFyeT4nICtcbiAgICBfZXNjSHRtbChfcmVzdW1lblNlbChkZWYua2V5LCBvcGNpb25lcykpICtcbiAgICAnPC9zdW1tYXJ5PjxkaXYgY2xhc3M9XCJkdi1tcy1wb3BcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyXHUyMDI2XCIgZGF0YS1tcy1zZWFyY2g9XCInICtcbiAgICBkZWYua2V5ICtcbiAgICAnXCI+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1tcy1hY3Rpb25zXCI+PGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1saW5rXCIgZGF0YS1tcy1jbGVhcj1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj5MaW1waWFyPC9idXR0b24+PC9kaXY+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1tcy1saXN0XCI+JyArXG4gICAgbGlzdCArXG4gICAgJzwvZGl2PjwvZGl2PjwvZGV0YWlscz48L2Rpdj4nXG4gICk7XG59XG5cbi8qKiBMZWUgZGVsIERPTSBsbyBxdWUgZWwgdXN1YXJpbyBtYXJjXHUwMEYzLiBTb2xvIHNlIGxsYW1hIGFsIHRvY2FyIFwiQXBsaWNhclwiLiAqL1xuZnVuY3Rpb24gX3JlYWRTZWxGcm9tRG9tKHJvb3QpIHtcbiAgY29uc3QgbmV4dCA9IF9zZWxWYWNpYSgpO1xuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXVtkYXRhLWZpbHRyb10nKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgIGNvbnN0IGtleSA9IGVsLmdldEF0dHJpYnV0ZSgnZGF0YS1maWx0cm8nKTtcbiAgICBpZiAoZWwuY2hlY2tlZCAmJiBuZXh0W2tleV0pIG5leHRba2V5XS5wdXNoKGVsLnZhbHVlKTtcbiAgfSk7XG4gIGlmIChfaXNWZW5kZWRvcigpKSBuZXh0LnZlbmRlZG9yZXMgPSBbXTtcbiAgc3RhdGUuc2VsID0gbmV4dDtcbiAgY29uc3QgbWVzRWwgPSByb290LnF1ZXJ5U2VsZWN0b3IoJyNkdi1tZXMnKTtcbiAgaWYgKG1lc0VsICYmIC9eXFxkezR9LVxcZHsyfSQvLnRlc3QobWVzRWwudmFsdWUpKSBzdGF0ZS5tZXMgPSBtZXNFbC52YWx1ZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQXJtYSBlbCBlc3F1ZWxldG8gKGZpbHRyb3MgYXJyaWJhLCByZXN1bHRhZG9zIGFiYWpvKSB1bmEgc29sYSB2ZXouICovXG5mdW5jdGlvbiBfZW5zdXJlU2tlbGV0b24oKSB7XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuIG51bGw7XG4gIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWZpbHRyb3MtaG9zdCcpIHx8ICFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtcmVzdWx0cycpKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPSAnPGRpdiBpZD1cImR2LWZpbHRyb3MtaG9zdFwiPjwvZGl2PjxkaXYgaWQ9XCJkdi1yZXN1bHRzXCI+PC9kaXY+JztcbiAgICBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID0gbnVsbDtcbiAgfVxuICByZXR1cm4gYm9keTtcbn1cblxuLyoqXG4gKiBQYW5lbCBkZSBmaWx0cm9zLiBTZSByZS1hcm1hIHNvbG8gY3VhbmRvIGNhbWJpYW4gbGFzIG9wY2lvbmVzICh1bmEgdmV6IHBvclxuICogcmVzcHVlc3RhKSwgYWwgcmVzZXRlYXIgcG9yIGNhbWJpbyBkZSB1c3VhcmlvIG8gY29uIFwiTGltcGlhciBmaWx0cm9zXCIuIE5pIGVsXG4gKiBcIkNhcmdhbmRvXHUyMDI2XCIgbmkgXCJWZXIgbVx1MDBFMXNcIiBsbyB0b2NhbiwgYXNcdTAwRUQgbm8gc2UgcGllcmRlbiBjYW1iaW9zIHNpbiBhcGxpY2FyLlxuICovXG5mdW5jdGlvbiByZW5kZXJGaWx0cm9zKGZvcmNlKSB7XG4gIGNvbnN0IGhvc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcy1ob3N0Jyk7XG4gIGlmICghaG9zdCkgcmV0dXJuO1xuICBpZiAoIWZvcmNlICYmIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPT09IHN0YXRlLm9wY2lvbmVzICYmIGhvc3QuaW5uZXJIVE1MKSByZXR1cm47XG4gIGNvbnN0IHByZXYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcycpO1xuICBjb25zdCBhYmllcnRvID0gcHJldiA/ICEhcHJldi5vcGVuIDogd2luZG93LmlubmVyV2lkdGggPiA3MDA7XG4gIGxldCBodG1sID0gJzxkZXRhaWxzIGNsYXNzPVwiZHYtZmlsdHJvc1wiIGlkPVwiZHYtZmlsdHJvc1wiJyArIChhYmllcnRvID8gJyBvcGVuJyA6ICcnKSArICc+JztcbiAgaHRtbCArPSAnPHN1bW1hcnk+RmlsdHJvczwvc3VtbWFyeT48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvcy1ncmlkXCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPk1lczwvZGl2PjxpbnB1dCB0eXBlPVwibW9udGhcIiBpZD1cImR2LW1lc1wiIGNsYXNzPVwiZHYtaW5wdXRcIiB2YWx1ZT1cIicgK1xuICAgIF9lc2NIdG1sKHN0YXRlLm1lcykgK1xuICAgICdcIj48L2Rpdj4nO1xuICBmb3IgKGNvbnN0IGRlZiBvZiBGSUxUUk9TX0RFRikgaHRtbCArPSBfcmVuZGVyRmlsdHJvKGRlZik7XG4gIGh0bWwgKz0gJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1maWx0cm9zLWFjdGlvbnNcIj4nO1xuICBodG1sICs9XG4gICAgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtYnRuLXNlY29uZGFyeVwiIGRhdGEtZHYtYWN0aW9uPVwibGltcGlhclwiPkxpbXBpYXIgZmlsdHJvczwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWJ0bi1wcmltYXJ5XCIgaWQ9XCJkdi1hcGxpY2FyXCIgZGF0YS1kdi1hY3Rpb249XCJhcGxpY2FyXCInICtcbiAgICAoc3RhdGUubG9hZGluZyA/ICcgZGlzYWJsZWQnIDogJycpICtcbiAgICAnPkFwbGljYXI8L2J1dHRvbj4nO1xuICBodG1sICs9ICc8L2Rpdj48L2RldGFpbHM+JztcbiAgaG9zdC5pbm5lckhUTUwgPSBodG1sO1xuICBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID0gc3RhdGUub3BjaW9uZXM7XG59XG5cbmZ1bmN0aW9uIF9zeW5jQXBsaWNhckRpc2FibGVkKCkge1xuICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtYXBsaWNhcicpO1xuICBpZiAoYnRuKSBidG4uZGlzYWJsZWQgPSAhIXN0YXRlLmxvYWRpbmc7XG59XG5cbmZ1bmN0aW9uIF9jYXJkKHRpdHVsbywgdmFsb3IpIHtcbiAgcmV0dXJuIChcbiAgICAnPGRpdiBjbGFzcz1cImR2LWNhcmRcIj48ZGl2IGNsYXNzPVwiZHYtY2FyZC10aXRsZVwiPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwiZHYtY2FyZC12YWx1ZVwiPicgK1xuICAgIF9lc2NIdG1sKHZhbG9yKSArXG4gICAgJzwvZGl2PjwvZGl2PidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX3Zlck1hc1RhYmxhKHRpcG8sIHJvd3MpIHtcbiAgY29uc3QgcSA9IHN0YXRlLnZlck1hc1F1ZXJ5W3RpcG9dLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuICAvLyBQb3NpY2lcdTAwRjNuIGRlbCByYW5raW5nIGNhbGN1bGFkYSB1bmEgc29sYSB2ZXogKHNpbiBpbmRleE9mIHBvciBmaWxhKS5cbiAgY29uc3QgcmFua2VkID0gcm93cy5tYXAoKHIsIGkpID0+ICh7IHIsIHBvczogaSArIDEgfSkpO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IHJhbmtlZC5maWx0ZXIoKHgpID0+XG4gICAgICAgIChTdHJpbmcoeC5yLnNrdSkgKyAnICcgKyBTdHJpbmcoeC5yLmRlc2MgfHwgJycpKS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpXG4gICAgICApXG4gICAgOiByYW5rZWQ7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LXZlcm1hc1wiPjxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2NhciBTS1UgbyBkZXNjcmlwY2lcdTAwRjNuXHUyMDI2XCIgZGF0YS12ZXJtYXMtc2VhcmNoPVwiJyArXG4gICAgdGlwbyArXG4gICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgX2VzY0h0bWwoc3RhdGUudmVyTWFzUXVlcnlbdGlwb10pICtcbiAgICAnXCI+PGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJkdi10YWJsZVwiPjx0aGVhZD48dHI+PHRoPiM8L3RoPjx0aD5TS1U8L3RoPjx0aD5EZXNjcmlwY2lcdTAwRjNuPC90aD48dGggY2xhc3M9XCJudW1cIj5VbmlkYWRlczwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RGluZXJvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgeyByLCBwb3MgfSBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKVxuICAgIGh0bWwgKz0gJzx0cj48dGQgY29sc3Bhbj1cIjVcIiBjbGFzcz1cImR2LW11dGVkXCI+U2luIHJlc3VsdGFkb3MuPC90ZD48L3RyPic7XG4gIGh0bWwgKz0gJzwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2Rpdj4nO1xuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gX3RvcFNlY3Rpb24odGlwbywgdGl0dWxvLCByb3dzKSB7XG4gIGNvbnN0IGFiaWVydG8gPSBzdGF0ZS52ZXJNYXNbdGlwb107XG4gIGNvbnN0IHRvdGFsID0gcm93cy5sZW5ndGg7XG4gIGNvbnN0IGggPSBNYXRoLm1heCgxMjAsIE1hdGgubWluKFRPUF9OLCB0b3RhbCkgKiAyMiArIDQwKTtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLXZlcm1hcz1cIicgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICtcbiAgICAgICAgKGFiaWVydG8gPyAndHJ1ZScgOiAnZmFsc2UnKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgKGFiaWVydG8gPyAnVmVyIG1lbm9zJyA6ICdWZXIgbVx1MDBFMXMnKSArXG4gICAgICAgICcgKCcgK1xuICAgICAgICB0b3RhbCArXG4gICAgICAgICcpPC9idXR0b24+J1xuICAgICAgOiAnJykgK1xuICAgICc8L2Rpdj4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDonICtcbiAgICAgICAgaCArXG4gICAgICAgICdweFwiPjxjYW52YXMgaWQ9XCJkdi1jaGFydC10b3AtJyArXG4gICAgICAgIHRpcG8gK1xuICAgICAgICAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICtcbiAgICAgICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgICAgICdcIj48L2NhbnZhcz48L2Rpdj4nXG4gICAgICA6ICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gZGF0b3MuPC9kaXY+JykgK1xuICAgIChhYmllcnRvID8gX3Zlck1hc1RhYmxhKHRpcG8sIHJvd3MpIDogJycpICtcbiAgICAnPC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xpbmVTZWN0aW9uKGlkLCB0aXR1bG8pIHtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz48L2Rpdj48ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDoyNDBweFwiPjxjYW52YXMgaWQ9XCInICtcbiAgICBpZCArXG4gICAgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJ1wiPjwvY2FudmFzPjwvZGl2Pjwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9pc0VtcHR5KGQpIHtcbiAgaWYgKCFkKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgY29uc3QgaGF5S3BpID1cbiAgICBOdW1iZXIoay5mYWN0dXJhZG8pIHx8IE51bWJlcihrLnBlZGlkb3MpIHx8IE51bWJlcihrLnBlZGlkb3NVbmljb3MpIHx8IE51bWJlcihrLmJhY2tvcmRlckFycyk7XG4gIGNvbnN0IGhheVRvcCA9IEFycmF5LmlzQXJyYXkoZC50b3BVbmlkYWRlcykgJiYgZC50b3BVbmlkYWRlcy5sZW5ndGggPiAwO1xuICBjb25zdCBoYXlTZXJpZSA9IEFycmF5LmlzQXJyYXkoZC5zZXJpZVZlbnRhcykgJiYgZC5zZXJpZVZlbnRhcy5zb21lKChwKSA9PiBOdW1iZXIocC52YWxvcikpO1xuICByZXR1cm4gIWhheUtwaSAmJiAhaGF5VG9wICYmICFoYXlTZXJpZTtcbn1cblxuLyoqIFJlc3VsdGFkb3MgKGxleWVuZGEsIHRhcmpldGFzLCByYW5raW5ncywgZ3JcdTAwRTFmaWNvcykuIE5vIHRvY2EgbG9zIGZpbHRyb3MuICovXG5mdW5jdGlvbiByZW5kZXJSZXN1bHRzKCkge1xuICBjb25zdCByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKTtcbiAgaWYgKCFyb290KSByZXR1cm47XG4gIGNvbnN0IGQgPSBzdGF0ZS5kYXRhO1xuXG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGFcIj5Nb250b3Mgc2luIElWQSwgY29uIGRlc2N1ZW50byBhcGxpY2FkbyB5IG5vdGFzIGRlIGNyXHUwMEU5ZGl0byByZXN0YWRhcy4nO1xuICBpZiAoZCAmJiBkLmRhdGFVcGRhdGVkQXQgJiYgIXN0YXRlLmxvYWRpbmcpIHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZC5kYXRhVXBkYXRlZEF0KTtcbiAgICBpZiAoIU51bWJlci5pc05hTih0LmdldFRpbWUoKSkpIHtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJyA8c3BhbiBjbGFzcz1cImR2LW11dGVkXCI+XHUwMEI3IENhbGN1bGFkbyAnICtcbiAgICAgICAgX2VzY0h0bWwodC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pKSArXG4gICAgICAgICc8L3NwYW4+JztcbiAgICB9XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICBpZiAoc3RhdGUubG9hZGluZykge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5DYXJnYW5kb1x1MjAyNjwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZXJyb3IpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWVzdGFkbyBkdi1lcnJvclwiPicgKyBfZXNjSHRtbChzdGF0ZS5lcnJvcikucmVwbGFjZSgvXFxuL2csICc8YnI+JykgKyAnPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkICYmIF9pc0VtcHR5KGQpKSB7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImR2LWVzdGFkb1wiPk5vIGhheSB2ZW50YXMgY29uIGVzb3MgZmlsdHJvcy48L2Rpdj4nO1xuICB9IGVsc2UgaWYgKGQpIHtcbiAgICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1jYXJkc1wiPic7XG4gICAgaHRtbCArPSBfY2FyZCgnRmFjdHVyYWRvIG1lbnN1YWwnLCBfZm10QXJzKGsuZmFjdHVyYWRvKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnVmFsb3JpemFjaVx1MDBGM24gYmFja29yZGVyJywgX2ZtdEFycyhrLmJhY2tvcmRlckFycykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIGRlIHBlZGlkb3MgZGVsIG1lcycsIF9mbXRVZHMoay5wZWRpZG9zKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnQ2FudC4gcGVkaWRvcyBcdTAwRkFuaWNvcycsIF9mbXRVZHMoay5wZWRpZG9zVW5pY29zKSk7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCd1bmlkYWRlcycsICdUb3AgMjAgU0tVIC0gVW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdKTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCdkaW5lcm8nLCAnVG9wIDIwIFNLVSAtIERpbmVybycsIGQudG9wRGluZXJvIHx8IFtdKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtdmVudGFzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlIHZlbnRhcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby11ZHMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIFVuaWRhZGVzJyk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LWJvLWFycycsICdFdm9sdWNpXHUwMEYzbiBkZWwgYmFja29yZGVyIC0gRGluZXJvJyk7XG4gIH1cblxuICBfZGVzdHJveUNoYXJ0cygpO1xuICByb290LmlubmVySFRNTCA9IGh0bWw7XG5cbiAgLy8gU2luIG1vZGFsIGFiaWVydG8gbm8gc2UgZGlidWphIChyZXNwdWVzdGEgcXVlIGxsZWdcdTAwRjMgZGVzcHVcdTAwRTlzIGRlIGNlcnJhcikuXG4gIGlmIChfaXNPcGVuKCkgJiYgIXN0YXRlLmxvYWRpbmcgJiYgIXN0YXRlLmVycm9yICYmIGQgJiYgIV9pc0VtcHR5KGQpKSB7XG4gICAgX2xvYWRDaGFydEpzKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKF9pc09wZW4oKSAmJiBzdGF0ZS5kYXRhID09PSBkKSBfZHJhd0NoYXJ0cyhkKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBpZiAoIV9lbnN1cmVTa2VsZXRvbigpKSByZXR1cm47XG4gIHJlbmRlckZpbHRyb3MoZmFsc2UpO1xuICBfc3luY0FwbGljYXJEaXNhYmxlZCgpO1xuICByZW5kZXJSZXN1bHRzKCk7XG59XG5cbmZ1bmN0aW9uIF9jc3NWYXIobmFtZSwgZmFsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB2ID0gZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmdldFByb3BlcnR5VmFsdWUobmFtZSkudHJpbSgpO1xuICAgIHJldHVybiB2IHx8IGZhbGxiYWNrO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5mdW5jdGlvbiBfYmFyQ2hhcnQoY2FudmFzSWQsIHJvd3MsIGZpZWxkLCBmbXQsIGNvbG9yKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgY29uc3QgdG9wID0gcm93cy5zbGljZSgwLCBUT1BfTik7XG4gIGNoYXJ0c1tjYW52YXNJZF0gPSBuZXcgd2luZG93LkNoYXJ0KGVsLCB7XG4gICAgdHlwZTogJ2JhcicsXG4gICAgZGF0YToge1xuICAgICAgbGFiZWxzOiB0b3AubWFwKChyKSA9PiBTdHJpbmcoci5za3UpKSxcbiAgICAgIGRhdGFzZXRzOiBbXG4gICAgICAgIHsgZGF0YTogdG9wLm1hcCgocikgPT4gTnVtYmVyKHJbZmllbGRdKSB8fCAwKSwgYmFja2dyb3VuZENvbG9yOiBjb2xvciwgYm9yZGVyUmFkaXVzOiAzIH0sXG4gICAgICBdLFxuICAgIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgaW5kZXhBeGlzOiAneScsXG4gICAgICByZXNwb25zaXZlOiB0cnVlLFxuICAgICAgbWFpbnRhaW5Bc3BlY3RSYXRpbzogZmFsc2UsXG4gICAgICBhbmltYXRpb246IGZhbHNlLFxuICAgICAgcGx1Z2luczoge1xuICAgICAgICBsZWdlbmQ6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgdG9vbHRpcDoge1xuICAgICAgICAgIGNhbGxiYWNrczoge1xuICAgICAgICAgICAgdGl0bGU6IChpdGVtcykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCByID0gdG9wW2l0ZW1zWzBdLmRhdGFJbmRleF07XG4gICAgICAgICAgICAgIHJldHVybiByID8gU3RyaW5nKHIuc2t1KSArIChyLmRlc2MgPyAnIC0gJyArIFN0cmluZyhyLmRlc2MpIDogJycpIDogJyc7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbGFiZWw6IChpdGVtKSA9PiBmbXQoaXRlbS5yYXcpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc2NhbGVzOiB7XG4gICAgICAgIHg6IHtcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgY2FsbGJhY2s6ICh2KSA9PiBmbXQodiksXG4gICAgICAgICAgICBtYXhUaWNrc0xpbWl0OiA1LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgeToge1xuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBhdXRvU2tpcDogZmFsc2UsXG4gICAgICAgICAgICBmb250OiB7IHNpemU6IDEwIH0sXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LXNlY29uZGFyeScsICcjMzM0MTU1JyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG59XG5cbi8qKlxuICogU2VyaWUgZGUgYmFjayBvcmRlciBlbiAyIGRhdGFzZXRzOiByZWFsIChsXHUwMEVEbmVhIGxsZW5hKSB5IGVzdGltYWRvIChwdW50ZWFkYSkuXG4gKiBVbiBwdW50byBlc3RpbWFkbyBzZSBjb25lY3RhIGNvbiBzdSB2ZWNpbm8gcmVhbCBwYXJhIHF1ZSBsYSBjdXJ2YSBubyBxdWVkZVxuICogY29ydGFkYSBlbiBsYSB0cmFuc2ljaVx1MDBGM247IGBudWxsYCAoc2luIGRhdG9zKSBjb3J0YSBsYSBsXHUwMEVEbmVhIChzcGFuR2FwczpmYWxzZSkuXG4gKi9cbmZ1bmN0aW9uIF9zcGxpdEJhY2tvcmRlcihzZXJpZSkge1xuICBjb25zdCByZWFsID0gc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsIHx8IHAuZXN0aW1hZG8gPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSk7XG4gIGNvbnN0IGVzdCA9IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCB8fCAhcC5lc3RpbWFkbyA/IG51bGwgOiBOdW1iZXIocC52YWxvcikpKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZXJpZS5sZW5ndGg7IGkrKykge1xuICAgIGlmIChlc3RbaV0gPT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKGkgKyAxIDwgc2VyaWUubGVuZ3RoICYmIHJlYWxbaSArIDFdICE9IG51bGwpIGVzdFtpICsgMV0gPSByZWFsW2kgKyAxXTtcbiAgICBpZiAoaSAtIDEgPj0gMCAmJiByZWFsW2kgLSAxXSAhPSBudWxsICYmIGVzdFtpIC0gMV0gPT0gbnVsbCkgZXN0W2kgLSAxXSA9IHJlYWxbaSAtIDFdO1xuICB9XG4gIHJldHVybiB7IHJlYWwsIGVzdCwgaGF5RXN0aW1hZG86IHNlcmllLnNvbWUoKHApID0+IHAuZXN0aW1hZG8gJiYgcC52YWxvciAhPSBudWxsKSB9O1xufVxuXG5mdW5jdGlvbiBfbGluZUNoYXJ0KGNhbnZhc0lkLCBzZXJpZSwgZm10LCBjb2xvciwgY29uRXN0aW1hZG8pIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChjYW52YXNJZCk7XG4gIGlmICghZWwgfHwgIXdpbmRvdy5DaGFydCkgcmV0dXJuO1xuICBjb25zdCBsYWJlbHMgPSBzZXJpZS5tYXAoKHApID0+IF9sYWJlbE1lcyhwLm1lcykpO1xuICBjb25zdCBkYXRhc2V0cyA9IFtdO1xuICBpZiAoY29uRXN0aW1hZG8pIHtcbiAgICBjb25zdCBzID0gX3NwbGl0QmFja29yZGVyKHNlcmllKTtcbiAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgIGxhYmVsOiAncmVhbCcsXG4gICAgICBkYXRhOiBzLnJlYWwsXG4gICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgfSk7XG4gICAgaWYgKHMuaGF5RXN0aW1hZG8pIHtcbiAgICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgICBsYWJlbDogJ2VzdGltYWRvJyxcbiAgICAgICAgZGF0YTogcy5lc3QsXG4gICAgICAgIGJvcmRlckNvbG9yOiBjb2xvcixcbiAgICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgICAgYm9yZGVyRGFzaDogWzYsIDRdLFxuICAgICAgICBzcGFuR2FwczogZmFsc2UsXG4gICAgICAgIHRlbnNpb246IDAuMixcbiAgICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgICAgIHBvaW50U3R5bGU6ICdyZWN0Um90JyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgIGxhYmVsOiAnZmFjdHVyYWRvJyxcbiAgICAgIGRhdGE6IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCA/IG51bGwgOiBOdW1iZXIocC52YWxvcikpKSxcbiAgICAgIGJvcmRlckNvbG9yOiBjb2xvcixcbiAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICBzcGFuR2FwczogZmFsc2UsXG4gICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICBwb2ludFJhZGl1czogMyxcbiAgICB9KTtcbiAgfVxuICBjaGFydHNbY2FudmFzSWRdID0gbmV3IHdpbmRvdy5DaGFydChlbCwge1xuICAgIHR5cGU6ICdsaW5lJyxcbiAgICBkYXRhOiB7IGxhYmVscywgZGF0YXNldHMgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICByZXNwb25zaXZlOiB0cnVlLFxuICAgICAgbWFpbnRhaW5Bc3BlY3RSYXRpbzogZmFsc2UsXG4gICAgICBhbmltYXRpb246IGZhbHNlLFxuICAgICAgcGx1Z2luczoge1xuICAgICAgICBsZWdlbmQ6IHsgZGlzcGxheTogY29uRXN0aW1hZG8gJiYgZGF0YXNldHMubGVuZ3RoID4gMSB9LFxuICAgICAgICB0b29sdGlwOiB7IGNhbGxiYWNrczogeyBsYWJlbDogKGl0ZW0pID0+IGl0ZW0uZGF0YXNldC5sYWJlbCArICc6ICcgKyBmbXQoaXRlbS5yYXcpIH0gfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeToge1xuICAgICAgICAgIGJlZ2luQXRaZXJvOiB0cnVlLFxuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IGZtdCh2KSxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDYsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB4OiB7IHRpY2tzOiB7IGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpIH0gfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIF9kcmF3Q2hhcnRzKGQpIHtcbiAgLy8gUHVlZGUgcXVlIGVsIHVzdWFyaW8gaGF5YSByZS1yZW5kZXJpemFkbyBtaWVudHJhcyBjYXJnYWJhIENoYXJ0LmpzLlxuICBfZGVzdHJveUNoYXJ0cygpO1xuICBfYmFyQ2hhcnQoJ2R2LWNoYXJ0LXRvcC11bmlkYWRlcycsIGQudG9wVW5pZGFkZXMgfHwgW10sICd1ZHMnLCBfZm10VWRzLCAnIzAyODRhMCcpO1xuICBfYmFyQ2hhcnQoJ2R2LWNoYXJ0LXRvcC1kaW5lcm8nLCBkLnRvcERpbmVybyB8fCBbXSwgJ2FycycsIF9mbXRBcnMsICcjMTZhMzRhJyk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LXZlbnRhcycsIGQuc2VyaWVWZW50YXMgfHwgW10sIF9mbXRBcnMsICcjMWU0MGFmJywgZmFsc2UpO1xuICBfbGluZUNoYXJ0KCdkdi1jaGFydC1iby11ZHMnLCBkLnNlcmllQm9VZHMgfHwgW10sIF9mbXRVZHMsICcjYzI0MTBjJywgdHJ1ZSk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LWJvLWFycycsIGQuc2VyaWVCb0FycyB8fCBbXSwgX2ZtdEFycywgJyM5ZjEyMzknLCB0cnVlKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEYXRvc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF9maWx0cm9zUGF5bG9hZCgpIHtcbiAgcmV0dXJuIHtcbiAgICBtZXM6IHN0YXRlLm1lcyxcbiAgICB2ZW5kZWRvcmVzOiBfaXNWZW5kZWRvcigpID8gW10gOiBzdGF0ZS5zZWwudmVuZGVkb3Jlcy5zbGljZSgpLFxuICAgIGNsaWVudGVzOiBzdGF0ZS5zZWwuY2xpZW50ZXMuc2xpY2UoKSxcbiAgICBwcm92aW5jaWFzOiBzdGF0ZS5zZWwucHJvdmluY2lhcy5zbGljZSgpLFxuICAgIGNhdGVnb3JpYXM6IHN0YXRlLnNlbC5jYXRlZ29yaWFzLnNsaWNlKCksXG4gICAgc2t1czogc3RhdGUuc2VsLnNrdXMuc2xpY2UoKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2FyZ2FyKCkge1xuICBjb25zdCBzZXEgPSArK3N0YXRlLnJlcVNlcTtcbiAgc3RhdGUubG9hZGluZyA9IHRydWU7XG4gIHN0YXRlLmVycm9yID0gJyc7XG4gIHJlbmRlcigpO1xuICB0cnkge1xuICAgIGlmICh0eXBlb2YgZmlyZWJhc2UgPT09ICd1bmRlZmluZWQnIHx8ICFmaXJlYmFzZS5hcHApIHRocm93IG5ldyBFcnJvcignZmlyZWJhc2Ugbm8gZGlzcG9uaWJsZScpO1xuICAgIGNvbnN0IGNhbGxhYmxlID0gZmlyZWJhc2UuYXBwKCkuZnVuY3Rpb25zKFJFR0lPTikuaHR0cHNDYWxsYWJsZSgnZGFzaGJvYXJkVmVudGFzQ0YnKTtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBjYWxsYWJsZShfZmlsdHJvc1BheWxvYWQoKSk7XG4gICAgaWYgKHNlcSAhPT0gc3RhdGUucmVxU2VxKSByZXR1cm47XG4gICAgc3RhdGUuZGF0YSA9IChyZXMgJiYgcmVzLmRhdGEpIHx8IG51bGw7XG4gICAgaWYgKHN0YXRlLmRhdGEgJiYgc3RhdGUuZGF0YS5vcGNpb25lcykgc3RhdGUub3BjaW9uZXMgPSBzdGF0ZS5kYXRhLm9wY2lvbmVzO1xuICAgIHN0YXRlLnZlck1hcyA9IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlIH07XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoc2VxICE9PSBzdGF0ZS5yZXFTZXEpIHJldHVybjtcbiAgICBjb25zb2xlLmVycm9yKCdbZGFzaGJvYXJkLXZlbnRhc10gZGFzaGJvYXJkVmVudGFzQ0YgZmFsbG86JywgZSk7XG4gICAgc3RhdGUuZXJyb3IgPSBfZXJyb3JNZXNzYWdlKCk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKHNlcSA9PT0gc3RhdGUucmVxU2VxKSB7XG4gICAgICBzdGF0ZS5sb2FkaW5nID0gZmFsc2U7XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFdmVudG9zIChkZWxlZ2Fkb3Mgc29icmUgZWwgYm9keSBkZWwgbW9kYWwpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxubGV0IF93aXJlZCA9IGZhbHNlO1xuZnVuY3Rpb24gX3dpcmUoKSB7XG4gIGlmIChfd2lyZWQpIHJldHVybjtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm47XG4gIF93aXJlZCA9IHRydWU7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChldikgPT4ge1xuICAgIGNvbnN0IHQgPSBldi50YXJnZXQ7XG4gICAgaWYgKCEodCBpbnN0YW5jZW9mIEVsZW1lbnQpKSByZXR1cm47XG4gICAgY29uc3QgYWN0ID0gdC5jbG9zZXN0KCdbZGF0YS1kdi1hY3Rpb25dJyk7XG4gICAgaWYgKGFjdCkge1xuICAgICAgY29uc3QgYSA9IGFjdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtZHYtYWN0aW9uJyk7XG4gICAgICBpZiAoYSA9PT0gJ2FwbGljYXInKSB7XG4gICAgICAgIF9yZWFkU2VsRnJvbURvbShib2R5KTtcbiAgICAgICAgY2FyZ2FyKCk7XG4gICAgICB9IGVsc2UgaWYgKGEgPT09ICdsaW1waWFyJykge1xuICAgICAgICBzdGF0ZS5zZWwgPSBfc2VsVmFjaWEoKTtcbiAgICAgICAgc3RhdGUubWVzID0gX21lc0FjdHVhbEFydCgpO1xuICAgICAgICByZW5kZXJGaWx0cm9zKHRydWUpO1xuICAgICAgICBjYXJnYXIoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgdm0gPSB0LmNsb3Nlc3QoJ1tkYXRhLXZlcm1hc10nKTtcbiAgICBpZiAodm0pIHtcbiAgICAgIGNvbnN0IHRpcG8gPSB2bS5nZXRBdHRyaWJ1dGUoJ2RhdGEtdmVybWFzJyk7XG4gICAgICBzdGF0ZS52ZXJNYXNbdGlwb10gPSAhc3RhdGUudmVyTWFzW3RpcG9dO1xuICAgICAgLy8gU29sbyByZXN1bHRhZG9zOiBubyBzZSBsZWVuIG5pIHNlIHBpc2FuIGZpbHRyb3Mgc2luIGFwbGljYXIuXG4gICAgICByZW5kZXJSZXN1bHRzKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGNsciA9IHQuY2xvc2VzdCgnW2RhdGEtbXMtY2xlYXJdJyk7XG4gICAgaWYgKGNscikge1xuICAgICAgY29uc3Qga2V5ID0gY2xyLmdldEF0dHJpYnV0ZSgnZGF0YS1tcy1jbGVhcicpO1xuICAgICAgYm9keS5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl1bZGF0YS1maWx0cm89XCInICsga2V5ICsgJ1wiXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgICAgIGVsLmNoZWNrZWQgPSBmYWxzZTtcbiAgICAgIH0pO1xuICAgICAgX3VwZGF0ZVN1bW1hcnkoYm9keSwga2V5KTtcbiAgICB9XG4gIH0pO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAodCBpbnN0YW5jZW9mIEhUTUxJbnB1dEVsZW1lbnQgJiYgdC50eXBlID09PSAnY2hlY2tib3gnICYmIHQuaGFzQXR0cmlidXRlKCdkYXRhLWZpbHRybycpKSB7XG4gICAgICBfdXBkYXRlU3VtbWFyeShib2R5LCB0LmdldEF0dHJpYnV0ZSgnZGF0YS1maWx0cm8nKSk7XG4gICAgfVxuICB9KTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAoISh0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCkpIHJldHVybjtcbiAgICBjb25zdCBtc0tleSA9IHQuZ2V0QXR0cmlidXRlKCdkYXRhLW1zLXNlYXJjaCcpO1xuICAgIGlmIChtc0tleSkge1xuICAgICAgY29uc3QgcSA9IHQudmFsdWUudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gICAgICBjb25zdCBkZXQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJ2RldGFpbHNbZGF0YS1tcz1cIicgKyBtc0tleSArICdcIl0nKTtcbiAgICAgIGlmICghZGV0KSByZXR1cm47XG4gICAgICBkZXQucXVlcnlTZWxlY3RvckFsbCgnLmR2LW1zLW9wdCcpLmZvckVhY2goKG9wdCkgPT4ge1xuICAgICAgICBjb25zdCBzID0gb3B0LmdldEF0dHJpYnV0ZSgnZGF0YS1zZWFyY2gnKSB8fCAnJztcbiAgICAgICAgb3B0LnN0eWxlLmRpc3BsYXkgPSAhcSB8fCBzLmluY2x1ZGVzKHEpID8gJycgOiAnbm9uZSc7XG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgdm1LZXkgPSB0LmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMtc2VhcmNoJyk7XG4gICAgaWYgKHZtS2V5KSB7XG4gICAgICBzdGF0ZS52ZXJNYXNRdWVyeVt2bUtleV0gPSB0LnZhbHVlO1xuICAgICAgY29uc3Qgc2VjID0gdC5jbG9zZXN0KCcuZHYtdmVybWFzJyk7XG4gICAgICBjb25zdCByb3dzID1cbiAgICAgICAgKHN0YXRlLmRhdGEgJiYgKHZtS2V5ID09PSAndW5pZGFkZXMnID8gc3RhdGUuZGF0YS50b3BVbmlkYWRlcyA6IHN0YXRlLmRhdGEudG9wRGluZXJvKSkgfHxcbiAgICAgICAgW107XG4gICAgICBpZiAoc2VjKSB7XG4gICAgICAgIGNvbnN0IHRtcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgICB0bXAuaW5uZXJIVE1MID0gX3Zlck1hc1RhYmxhKHZtS2V5LCByb3dzKTtcbiAgICAgICAgY29uc3QgbmV3V3JhcCA9IHRtcC5xdWVyeVNlbGVjdG9yKCcuZHYtdGFibGUtd3JhcCcpO1xuICAgICAgICBjb25zdCBvbGRXcmFwID0gc2VjLnF1ZXJ5U2VsZWN0b3IoJy5kdi10YWJsZS13cmFwJyk7XG4gICAgICAgIGlmIChuZXdXcmFwICYmIG9sZFdyYXApIG9sZFdyYXAucmVwbGFjZVdpdGgobmV3V3JhcCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuZnVuY3Rpb24gX3VwZGF0ZVN1bW1hcnkoYm9keSwga2V5KSB7XG4gIGNvbnN0IGRldCA9IGJvZHkucXVlcnlTZWxlY3RvcignZGV0YWlsc1tkYXRhLW1zPVwiJyArIGtleSArICdcIl0nKTtcbiAgaWYgKCFkZXQpIHJldHVybjtcbiAgY29uc3QgY2hlY2tlZCA9IEFycmF5LmZyb20oZGV0LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXTpjaGVja2VkJykpO1xuICBjb25zdCBzdW0gPSBkZXQucXVlcnlTZWxlY3Rvcignc3VtbWFyeScpO1xuICBpZiAoIXN1bSkgcmV0dXJuO1xuICBpZiAoY2hlY2tlZC5sZW5ndGggPT09IDApIHN1bS50ZXh0Q29udGVudCA9ICdUb2Rvcyc7XG4gIGVsc2UgaWYgKGNoZWNrZWQubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3Qgc3BhbiA9IGNoZWNrZWRbMF0ucGFyZW50RWxlbWVudCAmJiBjaGVja2VkWzBdLnBhcmVudEVsZW1lbnQucXVlcnlTZWxlY3Rvcignc3BhbicpO1xuICAgIHN1bS50ZXh0Q29udGVudCA9IHNwYW4gPyBzcGFuLnRleHRDb250ZW50IDogY2hlY2tlZFswXS52YWx1ZTtcbiAgfSBlbHNlIHN1bS50ZXh0Q29udGVudCA9IGNoZWNrZWQubGVuZ3RoICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBUEkgcFx1MDBGQWJsaWNhIChleHBvcnRzIGRlbCBjaHVuaylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG53aW5kb3cub3BlbkRhc2hib2FyZFZlbnRhcyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSByZXR1cm47XG4gIGNvbnN0IHJvbGUgPSBfcm9sZSgpO1xuICBpZiAocm9sZSAhPT0gJ2FkbWluJyAmJiByb2xlICE9PSAnZ2VyZW50ZScgJiYgcm9sZSAhPT0gJ3ZlbmRlZG9yJykge1xuICAgIGFsZXJ0KCdUdSB1c3VhcmlvIG5vIHRpZW5lIGFjY2VzbyBhbCBEYXNoYm9hcmQgZGUgVmVudGFzLiBTaSBsbyBuZWNlc2l0XHUwMEUxcywgYXZpc2FsZSBhIE1hcmlhbm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE90cm8gdXN1YXJpbyBlbiBsYSBtaXNtYSBwZXN0YVx1MDBGMWEgKGxvZ291dCArIGxvZ2luIHNpbiByZWNhcmdhcik6IHNlXG4gIC8vIGRlc2NhcnRhIHRvZG8gbG8gZGVsIGFudGVyaW9yLiBNaXNtbyB1c3VhcmlvOiBzZSBjb25zZXJ2YSBzdSBzZWxlY2NpXHUwMEYzbi5cbiAgY29uc3QgdWlkID0gX2N1cnJlbnRVaWQoKTtcbiAgaWYgKHVpZCAhPT0gc3RhdGUudWlkKSBfcmVzZXRTdGF0ZSh1aWQpO1xuICBpZiAoIXN0YXRlLm1lcykgc3RhdGUubWVzID0gX21lc0FjdHVhbEFydCgpO1xuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIF9lbnN1cmVTa2VsZXRvbigpO1xuICBfd2lyZSgpO1xuICByZW5kZXJGaWx0cm9zKHRydWUpO1xuICAvLyBQcmVjYXJnYSBDaGFydC5qcyBlbiBwYXJhbGVsbyBhIGxhIGNvbnN1bHRhLlxuICBfbG9hZENoYXJ0SnMoKS5jYXRjaCgoKSA9PiB7fSk7XG4gIC8vIFNpZW1wcmUgc2UgcGlkZSBkZSBudWV2byBhbCBhYnJpciAoZWwgc2Vydmlkb3IgY2FjaGVhIDEwIG1pbikuXG4gIGNhcmdhcigpO1xufTtcblxud2luZG93LmNsb3NlRGFzaGJvYXJkVmVudGFzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBfZGVzdHJveUNoYXJ0cygpO1xuICAvLyBMb3MgZGF0b3Mgbm8gc2UgZ3VhcmRhbiBlbnRyZSBhcGVydHVyYXM7IHNlIHZ1ZWx2ZW4gYSBwZWRpciBhbCBhYnJpci5cbiAgc3RhdGUuZGF0YSA9IG51bGw7XG4gIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgc3RhdGUucmVxU2VxKys7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBaUJBLE1BQU0sZUFBZTtBQUNyQixNQUFNLFFBQVE7QUFDZCxNQUFNLFNBQVM7QUFFZixNQUFNLGNBQWM7QUFBQSxJQUNsQixFQUFFLEtBQUssY0FBYyxPQUFP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
