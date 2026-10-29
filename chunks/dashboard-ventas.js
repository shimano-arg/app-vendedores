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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI5LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlIH0sXG4gIHZlck1hc1F1ZXJ5OiB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJyB9LFxuICByZXFTZXE6IDAsXG59O1xuXG5mdW5jdGlvbiBfcmVzZXRTdGF0ZSh1aWQpIHtcbiAgc3RhdGUudWlkID0gdWlkO1xuICBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIHN0YXRlLnNlbCA9IF9zZWxWYWNpYSgpO1xuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUub3BjaW9uZXMgPSBudWxsO1xuICBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICBzdGF0ZS5lcnJvciA9ICcnO1xuICBzdGF0ZS52ZXJNYXMgPSB7IHVuaWRhZGVzOiBmYWxzZSwgZGluZXJvOiBmYWxzZSB9O1xuICBzdGF0ZS52ZXJNYXNRdWVyeSA9IHsgdW5pZGFkZXM6ICcnLCBkaW5lcm86ICcnIH07XG4gIHN0YXRlLnJlcVNlcSsrO1xufVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG5jb25zdCBjaGFydHMgPSB7fTtcbmxldCBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEVzY2FwZSBsb2NhbCAobWlzbW8gcmVzdWx0YWRvIHF1ZSB3aW5kb3cuZXNjYXBlSHRtbCk6IGVsIGFuXHUwMEUxbGlzaXMgZGVcbi8vIHNlZ3VyaWRhZCBkZWwgcmVwbyAoQ29kZVFMKSBzb2xvIHJlY29ub2NlIHVuIHNhbml0aXphZG9yIHZpc2libGUgYWNcdTAwRTEuXG5mdW5jdGlvbiBfZXNjSHRtbChzKSB7XG4gIGNvbnN0IHYgPSBzID09IG51bGwgPyAnJyA6IHM7XG4gIHJldHVybiBTdHJpbmcodilcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKVxuICAgIC5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xufVxuXG5mdW5jdGlvbiBfZm10QXJzKG4pIHtcbiAgY29uc3QgdiA9IE51bWJlcihuKSB8fCAwO1xuICByZXR1cm4gJyQnICsgTWF0aC5yb3VuZCh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX2ZtdFVkcyhuKSB7XG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSB8fCAwKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX3JvbGUoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdXNlclJvbGUgIT09ICd1bmRlZmluZWQnID8gdXNlclJvbGUgOiB3aW5kb3cudXNlclJvbGUpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy51c2VyUm9sZSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9teVZlbmRvcigpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKHR5cGVvZiBhc3NpZ25lZFZlbmRvciAhPT0gJ3VuZGVmaW5lZCcgPyBhc3NpZ25lZFZlbmRvciA6IHdpbmRvdy5hc3NpZ25lZFZlbmRvcikgfHwgJyc7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIHdpbmRvdy5hc3NpZ25lZFZlbmRvciB8fCAnJztcbiAgfVxufVxuXG5mdW5jdGlvbiBfY3VycmVudFVpZCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1ID0gdHlwZW9mIGN1cnJlbnRVc2VyICE9PSAndW5kZWZpbmVkJyA/IGN1cnJlbnRVc2VyIDogd2luZG93LmN1cnJlbnRVc2VyO1xuICAgIHJldHVybiAodSAmJiB1LnVpZCkgfHwgbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIudWlkKSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9pc09wZW4oKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgcmV0dXJuICEhKG1vZGFsICYmIG1vZGFsLmNsYXNzTGlzdCAmJiBtb2RhbC5jbGFzc0xpc3QuY29udGFpbnMoJ29wZW4nKSk7XG59XG5cbmZ1bmN0aW9uIF9pc1ZlbmRlZG9yKCkge1xuICByZXR1cm4gX3JvbGUoKSA9PT0gJ3ZlbmRlZG9yJztcbn1cblxuLyoqIE1lcyBlbiBjdXJzbyBlbiBob3JhIEFyZ2VudGluYSwgZm9ybWF0byBBQUFBLU1NLiAqL1xuZnVuY3Rpb24gX21lc0FjdHVhbEFydCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJ0cyA9IG5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KCdlbi1DQScsIHtcbiAgICAgIHRpbWVab25lOiAnQW1lcmljYS9BcmdlbnRpbmEvQnVlbm9zX0FpcmVzJyxcbiAgICAgIHllYXI6ICdudW1lcmljJyxcbiAgICAgIG1vbnRoOiAnMi1kaWdpdCcsXG4gICAgfSkuZm9ybWF0VG9QYXJ0cyhuZXcgRGF0ZSgpKTtcbiAgICBjb25zdCB5ID0gcGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAneWVhcicpLnZhbHVlO1xuICAgIGNvbnN0IG0gPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICdtb250aCcpLnZhbHVlO1xuICAgIHJldHVybiB5ICsgJy0nICsgbTtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbn1cblxuY29uc3QgTUVTRVNfQ09SVE9TID0gW1xuICAnZW5lJyxcbiAgJ2ZlYicsXG4gICdtYXInLFxuICAnYWJyJyxcbiAgJ21heScsXG4gICdqdW4nLFxuICAnanVsJyxcbiAgJ2FnbycsXG4gICdzZXAnLFxuICAnb2N0JyxcbiAgJ25vdicsXG4gICdkaWMnLFxuXTtcbmZ1bmN0aW9uIF9sYWJlbE1lcyhhYWFhbW0pIHtcbiAgY29uc3QgcyA9IFN0cmluZyhhYWFhbW0gfHwgJycpO1xuICBjb25zdCBtID0gTnVtYmVyKHMuc2xpY2UoNSwgNykpO1xuICBpZiAoIW0pIHJldHVybiBzO1xuICByZXR1cm4gTUVTRVNfQ09SVE9TW20gLSAxXSArICcgJyArIHMuc2xpY2UoMiwgNCk7XG59XG5cbmZ1bmN0aW9uIF9lcnJvck1lc3NhZ2UoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgbXYgPSB3aW5kb3cuX19waGFzZTAgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUgJiYgd2luZG93Ll9fcGhhc2UwLnB1cmUubWVuc2FqZXNWZW5kZWRvcjtcbiAgICBpZiAobXYgJiYgdHlwZW9mIG12LmZvcm1hdE1lbnNhamVDb25Db2RpZ28gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBtdi5mb3JtYXRNZW5zYWplQ29uQ29kaWdvKCdEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCcpO1xuICAgIH1cbiAgfSBjYXRjaCAoX2UpIHt9XG4gIC8vIEZhbGxiYWNrIFx1MDBBNzY4IHNpIGVsIGJ1bmRsZSBubyBjYXJnXHUwMEYzIChTVyBzdGFsZSkuXG4gIHJldHVybiAoXG4gICAgJ05vIHB1ZGltb3MgY2FyZ2FyIGVsIHRhYmxlcm8gZGUgdmVudGFzLiBWb2x2XHUwMEU5IGEgaW50ZW50YXIgZW4gdW4gbWludXRvOyBzaSBzaWd1ZSBwYXNhbmRvLCBhdmlzYWxlIGEgTWFyaWFuby4nICtcbiAgICAnXFxuXFxuQ1x1MDBGM2RpZ28gdFx1MDBFOWNuaWNvOiBEQVNIQk9BUkRfVkVOVEFTX0ZBSUxFRCdcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xvYWRDaGFydEpzKCkge1xuICBpZiAod2luZG93LkNoYXJ0KSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHdpbmRvdy5DaGFydCk7XG4gIGlmIChjaGFydEpzUHJvbWlzZSkgcmV0dXJuIGNoYXJ0SnNQcm9taXNlO1xuICBjaGFydEpzUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgcy5zcmMgPSBDSEFSVF9KU19VUkw7XG4gICAgcy5hc3luYyA9IHRydWU7XG4gICAgcy5vbmxvYWQgPSAoKSA9PlxuICAgICAgd2luZG93LkNoYXJ0ID8gcmVzb2x2ZSh3aW5kb3cuQ2hhcnQpIDogcmVqZWN0KG5ldyBFcnJvcignQ2hhcnQuanMgc2luIGdsb2JhbCcpKTtcbiAgICBzLm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgICBjaGFydEpzUHJvbWlzZSA9IG51bGw7XG4gICAgICByZWplY3QobmV3IEVycm9yKCdubyBzZSBwdWRvIGNhcmdhciBDaGFydC5qcycpKTtcbiAgICB9O1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xuICByZXR1cm4gY2hhcnRKc1Byb21pc2U7XG59XG5cbmZ1bmN0aW9uIF9kZXN0cm95Q2hhcnRzKCkge1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoY2hhcnRzKSkge1xuICAgIHRyeSB7XG4gICAgICBjaGFydHNba10uZGVzdHJveSgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIGRlbGV0ZSBjaGFydHNba107XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcGNpb25lcyBkZSBmaWx0cm9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERldnVlbHZlIFt7dmFsdWUsbGFiZWx9XSBkZSBsYSBvcGNpXHUwMEYzbiBga2V5YCBkZSBsYSBcdTAwRkFsdGltYSByZXNwdWVzdGEuICovXG5mdW5jdGlvbiBfb3BjaW9uZXNEZShrZXkpIHtcbiAgY29uc3Qgb3AgPSBzdGF0ZS5vcGNpb25lcyB8fCB7fTtcbiAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShvcFtrZXldKSA/IG9wW2tleV0gOiBbXTtcbiAgaWYgKGtleSA9PT0gJ2NsaWVudGVzJykge1xuICAgIHJldHVybiBhcnIubWFwKChjKSA9PiAoe1xuICAgICAgdmFsdWU6IFN0cmluZyhjLmNvZGUpLFxuICAgICAgbGFiZWw6IFN0cmluZyhjLm5hbWUgfHwgYy5jb2RlKSArICcgKCcgKyBTdHJpbmcoYy5jb2RlKSArICcpJyxcbiAgICB9KSk7XG4gIH1cbiAgaWYgKGtleSA9PT0gJ3NrdXMnKSB7XG4gICAgcmV0dXJuIGFyci5tYXAoKHMpID0+ICh7XG4gICAgICB2YWx1ZTogU3RyaW5nKHMuY29kZSksXG4gICAgICBsYWJlbDogU3RyaW5nKHMuY29kZSkgKyAocy5kZXNjID8gJyAtICcgKyBTdHJpbmcocy5kZXNjKSA6ICcnKSxcbiAgICB9KSk7XG4gIH1cbiAgcmV0dXJuIGFyci5tYXAoKHYpID0+ICh7IHZhbHVlOiBTdHJpbmcodiksIGxhYmVsOiBTdHJpbmcodikgfSkpO1xufVxuXG5mdW5jdGlvbiBfcmVzdW1lblNlbChrZXksIG9wY2lvbmVzKSB7XG4gIGNvbnN0IG4gPSBzdGF0ZS5zZWxba2V5XS5sZW5ndGg7XG4gIGlmIChuID09PSAwKSByZXR1cm4gJ1RvZG9zJztcbiAgaWYgKG4gPT09IDEpIHtcbiAgICBjb25zdCBvID0gb3BjaW9uZXMuZmluZCgoeCkgPT4geC52YWx1ZSA9PT0gc3RhdGUuc2VsW2tleV1bMF0pO1xuICAgIHJldHVybiBvID8gby5sYWJlbCA6IHN0YXRlLnNlbFtrZXldWzBdO1xuICB9XG4gIHJldHVybiBuICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuZnVuY3Rpb24gX3JlbmRlckZpbHRybyhkZWYpIHtcbiAgaWYgKGRlZi5rZXkgPT09ICd2ZW5kZWRvcmVzJyAmJiBfaXNWZW5kZWRvcigpKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPicgK1xuICAgICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LW1zLWxvY2tlZFwiIHRpdGxlPVwiVmVzIHNvbG8gdHVzIGNsaWVudGVzXCI+JyArXG4gICAgICBfZXNjSHRtbChfbXlWZW5kb3IoKSB8fCAnVHVzIGNsaWVudGVzJykgK1xuICAgICAgJyBcdUQ4M0RcdUREMTI8L2Rpdj48L2Rpdj4nXG4gICAgKTtcbiAgfVxuICBjb25zdCBvcGNpb25lcyA9IF9vcGNpb25lc0RlKGRlZi5rZXkpO1xuICBjb25zdCBzZWxlY3RlZCA9IG5ldyBTZXQoc3RhdGUuc2VsW2RlZi5rZXldKTtcbiAgbGV0IGxpc3QgPSAnJztcbiAgZm9yIChjb25zdCBvIG9mIG9wY2lvbmVzKSB7XG4gICAgbGlzdCArPVxuICAgICAgJzxsYWJlbCBjbGFzcz1cImR2LW1zLW9wdFwiIGRhdGEtc2VhcmNoPVwiJyArXG4gICAgICBfZXNjSHRtbChvLmxhYmVsLnRvTG93ZXJDYXNlKCkpICtcbiAgICAgICdcIj48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgZGF0YS1maWx0cm89XCInICtcbiAgICAgIGRlZi5rZXkgK1xuICAgICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgICBfZXNjSHRtbChvLnZhbHVlKSArXG4gICAgICAnXCInICtcbiAgICAgIChzZWxlY3RlZC5oYXMoby52YWx1ZSkgPyAnIGNoZWNrZWQnIDogJycpICtcbiAgICAgICc+IDxzcGFuPicgK1xuICAgICAgX2VzY0h0bWwoby5sYWJlbCkgK1xuICAgICAgJzwvc3Bhbj48L2xhYmVsPic7XG4gIH1cbiAgaWYgKCFsaXN0KSBsaXN0ID0gJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiIHN0eWxlPVwicGFkZGluZzo2cHhcIj5TaW4gb3BjaW9uZXMgdG9kYXZcdTAwRURhLjwvZGl2Pic7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+JyArXG4gICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgJzwvZGl2PjxkZXRhaWxzIGNsYXNzPVwiZHYtbXNcIiBkYXRhLW1zPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPjxzdW1tYXJ5PicgK1xuICAgIF9lc2NIdG1sKF9yZXN1bWVuU2VsKGRlZi5rZXksIG9wY2lvbmVzKSkgK1xuICAgICc8L3N1bW1hcnk+PGRpdiBjbGFzcz1cImR2LW1zLXBvcFwiPicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXJcdTIwMjZcIiBkYXRhLW1zLXNlYXJjaD1cIicgK1xuICAgIGRlZi5rZXkgK1xuICAgICdcIj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWFjdGlvbnNcIj48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLW1zLWNsZWFyPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPkxpbXBpYXI8L2J1dHRvbj48L2Rpdj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LW1zLWxpc3RcIj4nICtcbiAgICBsaXN0ICtcbiAgICAnPC9kaXY+PC9kaXY+PC9kZXRhaWxzPjwvZGl2PidcbiAgKTtcbn1cblxuLyoqIExlZSBkZWwgRE9NIGxvIHF1ZSBlbCB1c3VhcmlvIG1hcmNcdTAwRjMuIFNvbG8gc2UgbGxhbWEgYWwgdG9jYXIgXCJBcGxpY2FyXCIuICovXG5mdW5jdGlvbiBfcmVhZFNlbEZyb21Eb20ocm9vdCkge1xuICBjb25zdCBuZXh0ID0gX3NlbFZhY2lhKCk7XG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdW2RhdGEtZmlsdHJvXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpO1xuICAgIGlmIChlbC5jaGVja2VkICYmIG5leHRba2V5XSkgbmV4dFtrZXldLnB1c2goZWwudmFsdWUpO1xuICB9KTtcbiAgaWYgKF9pc1ZlbmRlZG9yKCkpIG5leHQudmVuZGVkb3JlcyA9IFtdO1xuICBzdGF0ZS5zZWwgPSBuZXh0O1xuICBjb25zdCBtZXNFbCA9IHJvb3QucXVlcnlTZWxlY3RvcignI2R2LW1lcycpO1xuICBpZiAobWVzRWwgJiYgL15cXGR7NH0tXFxkezJ9JC8udGVzdChtZXNFbC52YWx1ZSkpIHN0YXRlLm1lcyA9IG1lc0VsLnZhbHVlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBcm1hIGVsIGVzcXVlbGV0byAoZmlsdHJvcyBhcnJpYmEsIHJlc3VsdGFkb3MgYWJham8pIHVuYSBzb2xhIHZlei4gKi9cbmZ1bmN0aW9uIF9lbnN1cmVTa2VsZXRvbigpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm4gbnVsbDtcbiAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtZmlsdHJvcy1ob3N0JykgfHwgIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1yZXN1bHRzJykpIHtcbiAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IGlkPVwiZHYtZmlsdHJvcy1ob3N0XCI+PC9kaXY+PGRpdiBpZD1cImR2LXJlc3VsdHNcIj48L2Rpdj4nO1xuICAgIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBudWxsO1xuICB9XG4gIHJldHVybiBib2R5O1xufVxuXG4vKipcbiAqIFBhbmVsIGRlIGZpbHRyb3MuIFNlIHJlLWFybWEgc29sbyBjdWFuZG8gY2FtYmlhbiBsYXMgb3BjaW9uZXMgKHVuYSB2ZXogcG9yXG4gKiByZXNwdWVzdGEpLCBhbCByZXNldGVhciBwb3IgY2FtYmlvIGRlIHVzdWFyaW8gbyBjb24gXCJMaW1waWFyIGZpbHRyb3NcIi4gTmkgZWxcbiAqIFwiQ2FyZ2FuZG9cdTIwMjZcIiBuaSBcIlZlciBtXHUwMEUxc1wiIGxvIHRvY2FuLCBhc1x1MDBFRCBubyBzZSBwaWVyZGVuIGNhbWJpb3Mgc2luIGFwbGljYXIuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckZpbHRyb3MoZm9yY2UpIHtcbiAgY29uc3QgaG9zdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zLWhvc3QnKTtcbiAgaWYgKCFob3N0KSByZXR1cm47XG4gIGlmICghZm9yY2UgJiYgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9PT0gc3RhdGUub3BjaW9uZXMgJiYgaG9zdC5pbm5lckhUTUwpIHJldHVybjtcbiAgY29uc3QgcHJldiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zJyk7XG4gIGNvbnN0IGFiaWVydG8gPSBwcmV2ID8gISFwcmV2Lm9wZW4gOiB3aW5kb3cuaW5uZXJXaWR0aCA+IDcwMDtcbiAgbGV0IGh0bWwgPSAnPGRldGFpbHMgY2xhc3M9XCJkdi1maWx0cm9zXCIgaWQ9XCJkdi1maWx0cm9zXCInICsgKGFiaWVydG8gPyAnIG9wZW4nIDogJycpICsgJz4nO1xuICBodG1sICs9ICc8c3VtbWFyeT5GaWx0cm9zPC9zdW1tYXJ5PjxkaXYgY2xhc3M9XCJkdi1maWx0cm9zLWdyaWRcIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+TWVzPC9kaXY+PGlucHV0IHR5cGU9XCJtb250aFwiIGlkPVwiZHYtbWVzXCIgY2xhc3M9XCJkdi1pbnB1dFwiIHZhbHVlPVwiJyArXG4gICAgX2VzY0h0bWwoc3RhdGUubWVzKSArXG4gICAgJ1wiPjwvZGl2Pic7XG4gIGZvciAoY29uc3QgZGVmIG9mIEZJTFRST1NfREVGKSBodG1sICs9IF9yZW5kZXJGaWx0cm8oZGVmKTtcbiAgaHRtbCArPSAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LWZpbHRyb3MtYWN0aW9uc1wiPic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1idG4tc2Vjb25kYXJ5XCIgZGF0YS1kdi1hY3Rpb249XCJsaW1waWFyXCI+TGltcGlhciBmaWx0cm9zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtYnRuLXByaW1hcnlcIiBpZD1cImR2LWFwbGljYXJcIiBkYXRhLWR2LWFjdGlvbj1cImFwbGljYXJcIicgK1xuICAgIChzdGF0ZS5sb2FkaW5nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xuICAgICc+QXBsaWNhcjwvYnV0dG9uPic7XG4gIGh0bWwgKz0gJzwvZGl2PjwvZGV0YWlscz4nO1xuICBob3N0LmlubmVySFRNTCA9IGh0bWw7XG4gIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBzdGF0ZS5vcGNpb25lcztcbn1cblxuZnVuY3Rpb24gX3N5bmNBcGxpY2FyRGlzYWJsZWQoKSB7XG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1hcGxpY2FyJyk7XG4gIGlmIChidG4pIGJ0bi5kaXNhYmxlZCA9ICEhc3RhdGUubG9hZGluZztcbn1cblxuZnVuY3Rpb24gX2NhcmQodGl0dWxvLCB2YWxvcikge1xuICByZXR1cm4gKFxuICAgICc8ZGl2IGNsYXNzPVwiZHYtY2FyZFwiPjxkaXYgY2xhc3M9XCJkdi1jYXJkLXRpdGxlXCI+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1jYXJkLXZhbHVlXCI+JyArXG4gICAgX2VzY0h0bWwodmFsb3IpICtcbiAgICAnPC9kaXY+PC9kaXY+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfdmVyTWFzVGFibGEodGlwbywgcm93cykge1xuICBjb25zdCBxID0gc3RhdGUudmVyTWFzUXVlcnlbdGlwb10udG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIC8vIFBvc2ljaVx1MDBGM24gZGVsIHJhbmtpbmcgY2FsY3VsYWRhIHVuYSBzb2xhIHZleiAoc2luIGluZGV4T2YgcG9yIGZpbGEpLlxuICBjb25zdCByYW5rZWQgPSByb3dzLm1hcCgociwgaSkgPT4gKHsgciwgcG9zOiBpICsgMSB9KSk7XG4gIGNvbnN0IGZpbHRlcmVkID0gcVxuICAgID8gcmFua2VkLmZpbHRlcigoeCkgPT5cbiAgICAgICAgKFN0cmluZyh4LnIuc2t1KSArICcgJyArIFN0cmluZyh4LnIuZGVzYyB8fCAnJykpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSlcbiAgICAgIClcbiAgICA6IHJhbmtlZDtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdmVybWFzXCI+PGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaVx1MDBGM25cdTIwMjZcIiBkYXRhLXZlcm1hcy1zZWFyY2g9XCInICtcbiAgICB0aXBvICtcbiAgICAnXCI+PGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJkdi10YWJsZVwiPjx0aGVhZD48dHI+PHRoPiM8L3RoPjx0aD5TS1U8L3RoPjx0aD5EZXNjcmlwY2lcdTAwRjNuPC90aD48dGggY2xhc3M9XCJudW1cIj5VbmlkYWRlczwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RGluZXJvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgeyByLCBwb3MgfSBvZiBmaWx0ZXJlZCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKVxuICAgIGh0bWwgKz0gJzx0cj48dGQgY29sc3Bhbj1cIjVcIiBjbGFzcz1cImR2LW11dGVkXCI+U2luIHJlc3VsdGFkb3MuPC90ZD48L3RyPic7XG4gIGh0bWwgKz0gJzwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2Rpdj4nO1xuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gX3RvcFNlY3Rpb24odGlwbywgdGl0dWxvLCByb3dzKSB7XG4gIGNvbnN0IGFiaWVydG8gPSBzdGF0ZS52ZXJNYXNbdGlwb107XG4gIGNvbnN0IHRvdGFsID0gcm93cy5sZW5ndGg7XG4gIGNvbnN0IGggPSBNYXRoLm1heCgxMjAsIE1hdGgubWluKFRPUF9OLCB0b3RhbCkgKiAyMiArIDQwKTtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLXZlcm1hcz1cIicgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICtcbiAgICAgICAgKGFiaWVydG8gPyAndHJ1ZScgOiAnZmFsc2UnKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgKGFiaWVydG8gPyAnVmVyIG1lbm9zJyA6ICdWZXIgbVx1MDBFMXMnKSArXG4gICAgICAgICcgKCcgK1xuICAgICAgICB0b3RhbCArXG4gICAgICAgICcpPC9idXR0b24+J1xuICAgICAgOiAnJykgK1xuICAgICc8L2Rpdj4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDonICtcbiAgICAgICAgaCArXG4gICAgICAgICdweFwiPjxjYW52YXMgaWQ9XCJkdi1jaGFydC10b3AtJyArXG4gICAgICAgIHRpcG8gK1xuICAgICAgICAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICtcbiAgICAgICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgICAgICdcIj48L2NhbnZhcz48L2Rpdj4nXG4gICAgICA6ICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gZGF0b3MuPC9kaXY+JykgK1xuICAgIChhYmllcnRvID8gX3Zlck1hc1RhYmxhKHRpcG8sIHJvd3MpIDogJycpICtcbiAgICAnPC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2xpbmVTZWN0aW9uKGlkLCB0aXR1bG8pIHtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9oMz48L2Rpdj48ZGl2IGNsYXNzPVwiZHYtY2hhcnRcIiBzdHlsZT1cImhlaWdodDoyNDBweFwiPjxjYW52YXMgaWQ9XCInICtcbiAgICBpZCArXG4gICAgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJ1wiPjwvY2FudmFzPjwvZGl2Pjwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9pc0VtcHR5KGQpIHtcbiAgaWYgKCFkKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgY29uc3QgaGF5S3BpID1cbiAgICBOdW1iZXIoay5mYWN0dXJhZG8pIHx8IE51bWJlcihrLnBlZGlkb3MpIHx8IE51bWJlcihrLnBlZGlkb3NVbmljb3MpIHx8IE51bWJlcihrLmJhY2tvcmRlckFycyk7XG4gIGNvbnN0IGhheVRvcCA9IEFycmF5LmlzQXJyYXkoZC50b3BVbmlkYWRlcykgJiYgZC50b3BVbmlkYWRlcy5sZW5ndGggPiAwO1xuICBjb25zdCBoYXlTZXJpZSA9IEFycmF5LmlzQXJyYXkoZC5zZXJpZVZlbnRhcykgJiYgZC5zZXJpZVZlbnRhcy5zb21lKChwKSA9PiBOdW1iZXIocC52YWxvcikpO1xuICByZXR1cm4gIWhheUtwaSAmJiAhaGF5VG9wICYmICFoYXlTZXJpZTtcbn1cblxuLyoqIFJlc3VsdGFkb3MgKGxleWVuZGEsIHRhcmpldGFzLCByYW5raW5ncywgZ3JcdTAwRTFmaWNvcykuIE5vIHRvY2EgbG9zIGZpbHRyb3MuICovXG5mdW5jdGlvbiByZW5kZXJSZXN1bHRzKCkge1xuICBjb25zdCByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKTtcbiAgaWYgKCFyb290KSByZXR1cm47XG4gIGNvbnN0IGQgPSBzdGF0ZS5kYXRhO1xuXG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGFcIj5Nb250b3Mgc2luIElWQSwgY29uIGRlc2N1ZW50byBhcGxpY2FkbyB5IG5vdGFzIGRlIGNyXHUwMEU5ZGl0byByZXN0YWRhcy4nO1xuICBpZiAoZCAmJiBkLmRhdGFVcGRhdGVkQXQgJiYgIXN0YXRlLmxvYWRpbmcpIHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZC5kYXRhVXBkYXRlZEF0KTtcbiAgICBpZiAoIU51bWJlci5pc05hTih0LmdldFRpbWUoKSkpIHtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJyA8c3BhbiBjbGFzcz1cImR2LW11dGVkXCI+XHUwMEI3IENhbGN1bGFkbyAnICtcbiAgICAgICAgX2VzY0h0bWwodC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pKSArXG4gICAgICAgICc8L3NwYW4+JztcbiAgICB9XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICBpZiAoc3RhdGUubG9hZGluZykge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5DYXJnYW5kb1x1MjAyNjwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZXJyb3IpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWVzdGFkbyBkdi1lcnJvclwiPicgKyBfZXNjSHRtbChzdGF0ZS5lcnJvcikucmVwbGFjZSgvXFxuL2csICc8YnI+JykgKyAnPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkICYmIF9pc0VtcHR5KGQpKSB7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImR2LWVzdGFkb1wiPk5vIGhheSB2ZW50YXMgY29uIGVzb3MgZmlsdHJvcy48L2Rpdj4nO1xuICB9IGVsc2UgaWYgKGQpIHtcbiAgICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1jYXJkc1wiPic7XG4gICAgaHRtbCArPSBfY2FyZCgnRmFjdHVyYWRvIG1lbnN1YWwnLCBfZm10QXJzKGsuZmFjdHVyYWRvKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnVmFsb3JpemFjaVx1MDBGM24gYmFja29yZGVyJywgX2ZtdEFycyhrLmJhY2tvcmRlckFycykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIGRlIHBlZGlkb3MgZGVsIG1lcycsIF9mbXRVZHMoay5wZWRpZG9zKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnQ2FudC4gcGVkaWRvcyBcdTAwRkFuaWNvcycsIF9mbXRVZHMoay5wZWRpZG9zVW5pY29zKSk7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCd1bmlkYWRlcycsICdUb3AgMjAgU0tVIC0gVW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdKTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCdkaW5lcm8nLCAnVG9wIDIwIFNLVSAtIERpbmVybycsIGQudG9wRGluZXJvIHx8IFtdKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtdmVudGFzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlIHZlbnRhcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby11ZHMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIFVuaWRhZGVzJyk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LWJvLWFycycsICdFdm9sdWNpXHUwMEYzbiBkZWwgYmFja29yZGVyIC0gRGluZXJvJyk7XG4gIH1cblxuICBfZGVzdHJveUNoYXJ0cygpO1xuICByb290LmlubmVySFRNTCA9IGh0bWw7XG4gIC8vIEVsIHRleHRvIGRlbCBidXNjYWRvciBkZSBcIlZlciBtXHUwMEUxc1wiIHNlIHBvbmUgcG9yIERPTSwgbnVuY2EgZGVudHJvIGRlbCBIVE1MLlxuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W2RhdGEtdmVybWFzLXNlYXJjaF0nKS5mb3JFYWNoKChpbnApID0+IHtcbiAgICBjb25zdCBrID0gaW5wLmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMtc2VhcmNoJyk7XG4gICAgaWYgKGspIC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGlucCkudmFsdWUgPSBzdGF0ZS52ZXJNYXNRdWVyeVtrXSB8fCAnJztcbiAgfSk7XG5cbiAgLy8gU2luIG1vZGFsIGFiaWVydG8gbm8gc2UgZGlidWphIChyZXNwdWVzdGEgcXVlIGxsZWdcdTAwRjMgZGVzcHVcdTAwRTlzIGRlIGNlcnJhcikuXG4gIGlmIChfaXNPcGVuKCkgJiYgIXN0YXRlLmxvYWRpbmcgJiYgIXN0YXRlLmVycm9yICYmIGQgJiYgIV9pc0VtcHR5KGQpKSB7XG4gICAgX2xvYWRDaGFydEpzKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKF9pc09wZW4oKSAmJiBzdGF0ZS5kYXRhID09PSBkKSBfZHJhd0NoYXJ0cyhkKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBpZiAoIV9lbnN1cmVTa2VsZXRvbigpKSByZXR1cm47XG4gIHJlbmRlckZpbHRyb3MoZmFsc2UpO1xuICBfc3luY0FwbGljYXJEaXNhYmxlZCgpO1xuICByZW5kZXJSZXN1bHRzKCk7XG59XG5cbmZ1bmN0aW9uIF9jc3NWYXIobmFtZSwgZmFsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB2ID0gZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmdldFByb3BlcnR5VmFsdWUobmFtZSkudHJpbSgpO1xuICAgIHJldHVybiB2IHx8IGZhbGxiYWNrO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5mdW5jdGlvbiBfYmFyQ2hhcnQoY2FudmFzSWQsIHJvd3MsIGZpZWxkLCBmbXQsIGNvbG9yKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgLy8gU3BlYzogU0tVcyBjb24gbmV0byA8PSAwIG5vIGVudHJhbiBhbCBUb3AgKGxhIHRhYmxhIFwiVmVyIG1cdTAwRTFzXCIgc1x1MDBFRCBsb3MgbXVlc3RyYSkuXG4gIGNvbnN0IHRvcCA9IHJvd3MuZmlsdGVyKChyKSA9PiAoTnVtYmVyKHJbZmllbGRdKSB8fCAwKSA+IDApLnNsaWNlKDAsIFRPUF9OKTtcbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnYmFyJyxcbiAgICBkYXRhOiB7XG4gICAgICBsYWJlbHM6IHRvcC5tYXAoKHIpID0+IFN0cmluZyhyLnNrdSkpLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAgeyBkYXRhOiB0b3AubWFwKChyKSA9PiBOdW1iZXIocltmaWVsZF0pIHx8IDApLCBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLCBib3JkZXJSYWRpdXM6IDMgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBpbmRleEF4aXM6ICd5JyxcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICB0b29sdGlwOiB7XG4gICAgICAgICAgY2FsbGJhY2tzOiB7XG4gICAgICAgICAgICB0aXRsZTogKGl0ZW1zKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSB0b3BbaXRlbXNbMF0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBTdHJpbmcoci5za3UpICsgKHIuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHIuZGVzYykgOiAnJykgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogKGl0ZW0pID0+IGZtdChpdGVtLnJhdyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeDoge1xuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IGZtdCh2KSxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDUsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB5OiB7XG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAgfSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtc2Vjb25kYXJ5JywgJyMzMzQxNTUnKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuLyoqXG4gKiBTZXJpZSBkZSBiYWNrIG9yZGVyIGVuIDIgZGF0YXNldHM6IHJlYWwgKGxcdTAwRURuZWEgbGxlbmEpIHkgZXN0aW1hZG8gKHB1bnRlYWRhKS5cbiAqIFVuIHB1bnRvIGVzdGltYWRvIHNlIGNvbmVjdGEgY29uIHN1IHZlY2lubyByZWFsIHBhcmEgcXVlIGxhIGN1cnZhIG5vIHF1ZWRlXG4gKiBjb3J0YWRhIGVuIGxhIHRyYW5zaWNpXHUwMEYzbjsgYG51bGxgIChzaW4gZGF0b3MpIGNvcnRhIGxhIGxcdTAwRURuZWEgKHNwYW5HYXBzOmZhbHNlKS5cbiAqL1xuZnVuY3Rpb24gX3NwbGl0QmFja29yZGVyKHNlcmllKSB7XG4gIGNvbnN0IHJlYWwgPSBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgfHwgcC5lc3RpbWFkbyA/IG51bGwgOiBOdW1iZXIocC52YWxvcikpKTtcbiAgY29uc3QgZXN0ID0gc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsIHx8ICFwLmVzdGltYWRvID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlcmllLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGVzdFtpXSA9PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAoaSArIDEgPCBzZXJpZS5sZW5ndGggJiYgcmVhbFtpICsgMV0gIT0gbnVsbCkgZXN0W2kgKyAxXSA9IHJlYWxbaSArIDFdO1xuICAgIGlmIChpIC0gMSA+PSAwICYmIHJlYWxbaSAtIDFdICE9IG51bGwgJiYgZXN0W2kgLSAxXSA9PSBudWxsKSBlc3RbaSAtIDFdID0gcmVhbFtpIC0gMV07XG4gIH1cbiAgcmV0dXJuIHsgcmVhbCwgZXN0LCBoYXlFc3RpbWFkbzogc2VyaWUuc29tZSgocCkgPT4gcC5lc3RpbWFkbyAmJiBwLnZhbG9yICE9IG51bGwpIH07XG59XG5cbmZ1bmN0aW9uIF9saW5lQ2hhcnQoY2FudmFzSWQsIHNlcmllLCBmbXQsIGNvbG9yLCBjb25Fc3RpbWFkbykge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGNhbnZhc0lkKTtcbiAgaWYgKCFlbCB8fCAhd2luZG93LkNoYXJ0KSByZXR1cm47XG4gIGNvbnN0IGxhYmVscyA9IHNlcmllLm1hcCgocCkgPT4gX2xhYmVsTWVzKHAubWVzKSk7XG4gIGNvbnN0IGRhdGFzZXRzID0gW107XG4gIGlmIChjb25Fc3RpbWFkbykge1xuICAgIGNvbnN0IHMgPSBfc3BsaXRCYWNrb3JkZXIoc2VyaWUpO1xuICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgbGFiZWw6ICdyZWFsJyxcbiAgICAgIGRhdGE6IHMucmVhbCxcbiAgICAgIGJvcmRlckNvbG9yOiBjb2xvcixcbiAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICBzcGFuR2FwczogZmFsc2UsXG4gICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICBwb2ludFJhZGl1czogMyxcbiAgICB9KTtcbiAgICBpZiAocy5oYXlFc3RpbWFkbykge1xuICAgICAgZGF0YXNldHMucHVzaCh7XG4gICAgICAgIGxhYmVsOiAnZXN0aW1hZG8nLFxuICAgICAgICBkYXRhOiBzLmVzdCxcbiAgICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgICBib3JkZXJEYXNoOiBbNiwgNF0sXG4gICAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgICBwb2ludFJhZGl1czogMyxcbiAgICAgICAgcG9pbnRTdHlsZTogJ3JlY3RSb3QnLFxuICAgICAgfSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgbGFiZWw6ICdmYWN0dXJhZG8nLFxuICAgICAgZGF0YTogc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpLFxuICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgIHRlbnNpb246IDAuMixcbiAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgIH0pO1xuICB9XG4gIGNoYXJ0c1tjYW52YXNJZF0gPSBuZXcgd2luZG93LkNoYXJ0KGVsLCB7XG4gICAgdHlwZTogJ2xpbmUnLFxuICAgIGRhdGE6IHsgbGFiZWxzLCBkYXRhc2V0cyB9LFxuICAgIG9wdGlvbnM6IHtcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBjb25Fc3RpbWFkbyAmJiBkYXRhc2V0cy5sZW5ndGggPiAxIH0sXG4gICAgICAgIHRvb2x0aXA6IHsgY2FsbGJhY2tzOiB7IGxhYmVsOiAoaXRlbSkgPT4gaXRlbS5kYXRhc2V0LmxhYmVsICsgJzogJyArIGZtdChpdGVtLnJhdykgfSB9LFxuICAgICAgfSxcbiAgICAgIHNjYWxlczoge1xuICAgICAgICB5OiB7XG4gICAgICAgICAgYmVnaW5BdFplcm86IHRydWUsXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNixcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHg6IHsgdGlja3M6IHsgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJykgfSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gX2RyYXdDaGFydHMoZCkge1xuICAvLyBQdWVkZSBxdWUgZWwgdXN1YXJpbyBoYXlhIHJlLXJlbmRlcml6YWRvIG1pZW50cmFzIGNhcmdhYmEgQ2hhcnQuanMuXG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLXVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSwgJ3VkcycsIF9mbXRVZHMsICcjMDI4NGEwJyk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLWRpbmVybycsIGQudG9wRGluZXJvIHx8IFtdLCAnYXJzJywgX2ZtdEFycywgJyMxNmEzNGEnKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtdmVudGFzJywgZC5zZXJpZVZlbnRhcyB8fCBbXSwgX2ZtdEFycywgJyMxZTQwYWYnLCBmYWxzZSk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LWJvLXVkcycsIGQuc2VyaWVCb1VkcyB8fCBbXSwgX2ZtdFVkcywgJyNjMjQxMGMnLCB0cnVlKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtYm8tYXJzJywgZC5zZXJpZUJvQXJzIHx8IFtdLCBfZm10QXJzLCAnIzlmMTIzOScsIHRydWUpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERhdG9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX2ZpbHRyb3NQYXlsb2FkKCkge1xuICByZXR1cm4ge1xuICAgIG1lczogc3RhdGUubWVzLFxuICAgIHZlbmRlZG9yZXM6IF9pc1ZlbmRlZG9yKCkgPyBbXSA6IHN0YXRlLnNlbC52ZW5kZWRvcmVzLnNsaWNlKCksXG4gICAgY2xpZW50ZXM6IHN0YXRlLnNlbC5jbGllbnRlcy5zbGljZSgpLFxuICAgIHByb3ZpbmNpYXM6IHN0YXRlLnNlbC5wcm92aW5jaWFzLnNsaWNlKCksXG4gICAgY2F0ZWdvcmlhczogc3RhdGUuc2VsLmNhdGVnb3JpYXMuc2xpY2UoKSxcbiAgICBza3VzOiBzdGF0ZS5zZWwuc2t1cy5zbGljZSgpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjYXJnYXIoKSB7XG4gIGNvbnN0IHNlcSA9ICsrc3RhdGUucmVxU2VxO1xuICBzdGF0ZS5sb2FkaW5nID0gdHJ1ZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgcmVuZGVyKCk7XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBmaXJlYmFzZSA9PT0gJ3VuZGVmaW5lZCcgfHwgIWZpcmViYXNlLmFwcCkgdGhyb3cgbmV3IEVycm9yKCdmaXJlYmFzZSBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3QgY2FsbGFibGUgPSBmaXJlYmFzZS5hcHAoKS5mdW5jdGlvbnMoUkVHSU9OKS5odHRwc0NhbGxhYmxlKCdkYXNoYm9hcmRWZW50YXNDRicpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKF9maWx0cm9zUGF5bG9hZCgpKTtcbiAgICBpZiAoc2VxICE9PSBzdGF0ZS5yZXFTZXEpIHJldHVybjtcbiAgICBzdGF0ZS5kYXRhID0gKHJlcyAmJiByZXMuZGF0YSkgfHwgbnVsbDtcbiAgICBpZiAoc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLm9wY2lvbmVzKSBzdGF0ZS5vcGNpb25lcyA9IHN0YXRlLmRhdGEub3BjaW9uZXM7XG4gICAgc3RhdGUudmVyTWFzID0geyB1bmlkYWRlczogZmFsc2UsIGRpbmVybzogZmFsc2UgfTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tkYXNoYm9hcmQtdmVudGFzXSBkYXNoYm9hcmRWZW50YXNDRiBmYWxsbzonLCBlKTtcbiAgICBzdGF0ZS5lcnJvciA9IF9lcnJvck1lc3NhZ2UoKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoc2VxID09PSBzdGF0ZS5yZXFTZXEpIHtcbiAgICAgIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV2ZW50b3MgKGRlbGVnYWRvcyBzb2JyZSBlbCBib2R5IGRlbCBtb2RhbClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5sZXQgX3dpcmVkID0gZmFsc2U7XG5mdW5jdGlvbiBfd2lyZSgpIHtcbiAgaWYgKF93aXJlZCkgcmV0dXJuO1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtYm9keScpO1xuICBpZiAoIWJvZHkpIHJldHVybjtcbiAgX3dpcmVkID0gdHJ1ZTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAoISh0IGluc3RhbmNlb2YgRWxlbWVudCkpIHJldHVybjtcbiAgICBjb25zdCBhY3QgPSB0LmNsb3Nlc3QoJ1tkYXRhLWR2LWFjdGlvbl0nKTtcbiAgICBpZiAoYWN0KSB7XG4gICAgICBjb25zdCBhID0gYWN0LmdldEF0dHJpYnV0ZSgnZGF0YS1kdi1hY3Rpb24nKTtcbiAgICAgIGlmIChhID09PSAnYXBsaWNhcicpIHtcbiAgICAgICAgX3JlYWRTZWxGcm9tRG9tKGJvZHkpO1xuICAgICAgICBjYXJnYXIoKTtcbiAgICAgIH0gZWxzZSBpZiAoYSA9PT0gJ2xpbXBpYXInKSB7XG4gICAgICAgIHN0YXRlLnNlbCA9IF9zZWxWYWNpYSgpO1xuICAgICAgICBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gICAgICAgIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gICAgICAgIGNhcmdhcigpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bSA9IHQuY2xvc2VzdCgnW2RhdGEtdmVybWFzXScpO1xuICAgIGlmICh2bSkge1xuICAgICAgY29uc3QgdGlwbyA9IHZtLmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMnKTtcbiAgICAgIHN0YXRlLnZlck1hc1t0aXBvXSA9ICFzdGF0ZS52ZXJNYXNbdGlwb107XG4gICAgICAvLyBTb2xvIHJlc3VsdGFkb3M6IG5vIHNlIGxlZW4gbmkgc2UgcGlzYW4gZmlsdHJvcyBzaW4gYXBsaWNhci5cbiAgICAgIHJlbmRlclJlc3VsdHMoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xyID0gdC5jbG9zZXN0KCdbZGF0YS1tcy1jbGVhcl0nKTtcbiAgICBpZiAoY2xyKSB7XG4gICAgICBjb25zdCBrZXkgPSBjbHIuZ2V0QXR0cmlidXRlKCdkYXRhLW1zLWNsZWFyJyk7XG4gICAgICBib2R5LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXVtkYXRhLWZpbHRybz1cIicgKyBrZXkgKyAnXCJdJykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICAgICAgZWwuY2hlY2tlZCA9IGZhbHNlO1xuICAgICAgfSk7XG4gICAgICBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpO1xuICAgIH1cbiAgfSk7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICh0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCAmJiB0LnR5cGUgPT09ICdjaGVja2JveCcgJiYgdC5oYXNBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJykpIHtcbiAgICAgIF91cGRhdGVTdW1tYXJ5KGJvZHksIHQuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpKTtcbiAgICB9XG4gIH0pO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICghKHQgaW5zdGFuY2VvZiBIVE1MSW5wdXRFbGVtZW50KSkgcmV0dXJuO1xuICAgIGNvbnN0IG1zS2V5ID0gdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbXMtc2VhcmNoJyk7XG4gICAgaWYgKG1zS2V5KSB7XG4gICAgICBjb25zdCBxID0gdC52YWx1ZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICAgIGNvbnN0IGRldCA9IGJvZHkucXVlcnlTZWxlY3RvcignZGV0YWlsc1tkYXRhLW1zPVwiJyArIG1zS2V5ICsgJ1wiXScpO1xuICAgICAgaWYgKCFkZXQpIHJldHVybjtcbiAgICAgIGRldC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtbXMtb3B0JykuZm9yRWFjaCgob3B0KSA9PiB7XG4gICAgICAgIGNvbnN0IHMgPSBvcHQuZ2V0QXR0cmlidXRlKCdkYXRhLXNlYXJjaCcpIHx8ICcnO1xuICAgICAgICBvcHQuc3R5bGUuZGlzcGxheSA9ICFxIHx8IHMuaW5jbHVkZXMocSkgPyAnJyA6ICdub25lJztcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bUtleSA9IHQuZ2V0QXR0cmlidXRlKCdkYXRhLXZlcm1hcy1zZWFyY2gnKTtcbiAgICBpZiAodm1LZXkpIHtcbiAgICAgIHN0YXRlLnZlck1hc1F1ZXJ5W3ZtS2V5XSA9IHQudmFsdWU7XG4gICAgICBjb25zdCBzZWMgPSB0LmNsb3Nlc3QoJy5kdi12ZXJtYXMnKTtcbiAgICAgIGNvbnN0IHJvd3MgPVxuICAgICAgICAoc3RhdGUuZGF0YSAmJiAodm1LZXkgPT09ICd1bmlkYWRlcycgPyBzdGF0ZS5kYXRhLnRvcFVuaWRhZGVzIDogc3RhdGUuZGF0YS50b3BEaW5lcm8pKSB8fFxuICAgICAgICBbXTtcbiAgICAgIGlmIChzZWMpIHtcbiAgICAgICAgY29uc3QgdG1wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRtcC5pbm5lckhUTUwgPSBfdmVyTWFzVGFibGEodm1LZXksIHJvd3MpO1xuICAgICAgICBjb25zdCBuZXdXcmFwID0gdG1wLnF1ZXJ5U2VsZWN0b3IoJy5kdi10YWJsZS13cmFwJyk7XG4gICAgICAgIGNvbnN0IG9sZFdyYXAgPSBzZWMucXVlcnlTZWxlY3RvcignLmR2LXRhYmxlLXdyYXAnKTtcbiAgICAgICAgaWYgKG5ld1dyYXAgJiYgb2xkV3JhcCkgb2xkV3JhcC5yZXBsYWNlV2l0aChuZXdXcmFwKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpIHtcbiAgY29uc3QgZGV0ID0gYm9keS5xdWVyeVNlbGVjdG9yKCdkZXRhaWxzW2RhdGEtbXM9XCInICsga2V5ICsgJ1wiXScpO1xuICBpZiAoIWRldCkgcmV0dXJuO1xuICBjb25zdCBjaGVja2VkID0gQXJyYXkuZnJvbShkZXQucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdOmNoZWNrZWQnKSk7XG4gIGNvbnN0IHN1bSA9IGRldC5xdWVyeVNlbGVjdG9yKCdzdW1tYXJ5Jyk7XG4gIGlmICghc3VtKSByZXR1cm47XG4gIGlmIChjaGVja2VkLmxlbmd0aCA9PT0gMCkgc3VtLnRleHRDb250ZW50ID0gJ1RvZG9zJztcbiAgZWxzZSBpZiAoY2hlY2tlZC5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzcGFuID0gY2hlY2tlZFswXS5wYXJlbnRFbGVtZW50ICYmIGNoZWNrZWRbMF0ucGFyZW50RWxlbWVudC5xdWVyeVNlbGVjdG9yKCdzcGFuJyk7XG4gICAgc3VtLnRleHRDb250ZW50ID0gc3BhbiA/IHNwYW4udGV4dENvbnRlbnQgOiBjaGVja2VkWzBdLnZhbHVlO1xuICB9IGVsc2Ugc3VtLnRleHRDb250ZW50ID0gY2hlY2tlZC5sZW5ndGggKyAnIHNlbGVjY2lvbmFkb3MnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFQSSBwXHUwMEZBYmxpY2EgKGV4cG9ydHMgZGVsIGNodW5rKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbndpbmRvdy5vcGVuRGFzaGJvYXJkVmVudGFzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHJldHVybjtcbiAgY29uc3Qgcm9sZSA9IF9yb2xlKCk7XG4gIGlmIChyb2xlICE9PSAnYWRtaW4nICYmIHJvbGUgIT09ICdnZXJlbnRlJyAmJiByb2xlICE9PSAndmVuZGVkb3InKSB7XG4gICAgYWxlcnQoJ1R1IHVzdWFyaW8gbm8gdGllbmUgYWNjZXNvIGFsIERhc2hib2FyZCBkZSBWZW50YXMuIFNpIGxvIG5lY2VzaXRcdTAwRTFzLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3RybyB1c3VhcmlvIGVuIGxhIG1pc21hIHBlc3RhXHUwMEYxYSAobG9nb3V0ICsgbG9naW4gc2luIHJlY2FyZ2FyKTogc2VcbiAgLy8gZGVzY2FydGEgdG9kbyBsbyBkZWwgYW50ZXJpb3IuIE1pc21vIHVzdWFyaW86IHNlIGNvbnNlcnZhIHN1IHNlbGVjY2lcdTAwRjNuLlxuICBjb25zdCB1aWQgPSBfY3VycmVudFVpZCgpO1xuICBpZiAodWlkICE9PSBzdGF0ZS51aWQpIF9yZXNldFN0YXRlKHVpZCk7XG4gIGlmICghc3RhdGUubWVzKSBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIG1vZGFsLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgX2Vuc3VyZVNrZWxldG9uKCk7XG4gIF93aXJlKCk7XG4gIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gIC8vIFByZWNhcmdhIENoYXJ0LmpzIGVuIHBhcmFsZWxvIGEgbGEgY29uc3VsdGEuXG4gIF9sb2FkQ2hhcnRKcygpLmNhdGNoKCgpID0+IHt9KTtcbiAgLy8gU2llbXByZSBzZSBwaWRlIGRlIG51ZXZvIGFsIGFicmlyIChlbCBzZXJ2aWRvciBjYWNoZWEgMTAgbWluKS5cbiAgY2FyZ2FyKCk7XG59O1xuXG53aW5kb3cuY2xvc2VEYXNoYm9hcmRWZW50YXMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgaWYgKG1vZGFsKSBtb2RhbC5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIC8vIExvcyBkYXRvcyBubyBzZSBndWFyZGFuIGVudHJlIGFwZXJ0dXJhczsgc2UgdnVlbHZlbiBhIHBlZGlyIGFsIGFicmlyLlxuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICBzdGF0ZS5yZXFTZXErKztcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFpQkEsTUFBTSxlQUFlO0FBQ3JCLE1BQU0sUUFBUTtBQUNkLE1BQU0sU0FBUztBQUVmLE1BQU0sY0FBYztBQUFBLElBQ2xCLEVBQUUsS0FBSyxjQUFjLE9BQU8sV0FBVztBQUFBLElBQ3ZDLEVBQUUsS0FBSyxZQUFZLE9BQU8sVUFBVTtBQUFBLElBQ3BDLEVBQUUsS0FBSyxjQUFjLE9BQU8sWUFBWTtBQUFBLElBQ3hDLEVBQUUsS0FBSyxjQUFjLE9BQU8sZUFBWTtBQUFBLElBQ3hDLEVBQUUsS0FBSyxRQUFRLE9BQU8sTUFBTTtBQUFBLEVBQzlCO0FBRUEsV0FBUyxZQUFZO0FBQ25CLFdBQU8sRUFBRSxZQUFZLENBQUMsR0FBRyxVQUFVLENBQUMsR0FBRyxZQUFZLENBQUMsR0FBRyxZQUFZLENBQUMsR0FBRyxNQUFNLENBQUMsRUFBRTtBQUFBLEVBQ2xGO0FBS0EsTUFBTSxRQUFRO0FBQUEsSUFDWixLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLLFVBQVU7QUFBQSxJQUNmLE1BQU07QUFBQSxJQUNOLFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLFNBQVM7QUFBQSxJQUNULE9BQU87QUFBQSxJQUNQLFFBQVEsRUFBRSxVQUFVLE9BQU8sUUFBUSxNQUFNO0FBQUEsSUFDekMsYUFBYSxF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
