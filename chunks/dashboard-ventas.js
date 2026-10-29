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
  var state = {
    mes: "",
    sel: { vendedores: [], clientes: [], provincias: [], categorias: [], skus: [] },
    data: null,
    loading: false,
    error: "",
    verMas: { unidades: false, dinero: false },
    verMasQuery: { unidades: "", dinero: "" },
    reqSeq: 0
  };
  var charts = {};
  var chartJsPromise = null;
  function _escHtml(s) {
    if (typeof window !== "undefined" && typeof window.escapeHtml === "function") {
      return window.escapeHtml(s);
    }
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    const op = state.data && state.data.opciones || {};
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
  function _resumenSel(key) {
    const n = state.sel[key].length;
    if (n === 0) return "Todos";
    if (n === 1) {
      const o = _opcionesDe(key).find((x) => x.value === state.sel[key][0]);
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
    return '<div class="dv-filtro"><div class="dv-filtro-label">' + _escHtml(def.label) + '</div><details class="dv-ms" data-ms="' + def.key + '"><summary>' + _escHtml(_resumenSel(def.key)) + '</summary><div class="dv-ms-pop"><input type="search" class="dv-ms-search" placeholder="Buscar\u2026" data-ms-search="' + def.key + '"><div class="dv-ms-actions"><button type="button" class="dv-link" data-ms-clear="' + def.key + '">Limpiar</button></div><div class="dv-ms-list">' + list + "</div></div></details></div>";
  }
  function _readSelFromDom(root) {
    const next = { vendedores: [], clientes: [], provincias: [], categorias: [], skus: [] };
    root.querySelectorAll('input[type="checkbox"][data-filtro]').forEach((el) => {
      if (el.checked) next[el.getAttribute("data-filtro")].push(el.value);
    });
    if (_isVendedor()) next.vendedores = [];
    state.sel = next;
    const mesEl = root.querySelector("#dv-mes");
    if (mesEl && /^\d{4}-\d{2}$/.test(mesEl.value)) state.mes = mesEl.value;
  }
  function _card(titulo, valor) {
    return '<div class="dv-card"><div class="dv-card-title">' + _escHtml(titulo) + '</div><div class="dv-card-value">' + _escHtml(valor) + "</div></div>";
  }
  function _verMasTabla(tipo, rows) {
    const q = state.verMasQuery[tipo].toLowerCase().trim();
    const filtered = q ? rows.filter((r) => (String(r.sku) + " " + String(r.desc || "")).toLowerCase().includes(q)) : rows;
    let html = '<div class="dv-vermas"><input type="search" class="dv-ms-search" placeholder="Buscar SKU o descripci\xF3n\u2026" data-vermas-search="' + tipo + '" value="' + _escHtml(state.verMasQuery[tipo]) + '"><div class="dv-table-wrap"><table class="dv-table"><thead><tr><th>#</th><th>SKU</th><th>Descripci\xF3n</th><th class="num">Unidades</th><th class="num">Dinero</th></tr></thead><tbody>';
    filtered.forEach((r) => {
      const pos = rows.indexOf(r) + 1;
      html += "<tr><td>" + pos + '</td><td class="mono">' + _escHtml(r.sku) + "</td><td>" + _escHtml(r.desc || "") + '</td><td class="num">' + _escHtml(_fmtUds(r.uds)) + '</td><td class="num">' + _escHtml(_fmtArs(r.ars)) + "</td></tr>";
    });
    if (filtered.length === 0)
      html += '<tr><td colspan="5" class="dv-muted">Sin resultados.</td></tr>';
    html += "</tbody></table></div></div>";
    return html;
  }
  function _topSection(tipo, titulo, rows) {
    const abierto = state.verMas[tipo];
    const total = rows.length;
    const h = Math.max(120, Math.min(TOP_N, total) * 22 + 40);
    return '<section class="dv-section"><div class="dv-section-head"><h3>' + _escHtml(titulo) + "</h3>" + (total > 0 ? '<button type="button" class="dv-link" data-vermas="' + tipo + '">' + (abierto ? "Ver menos" : "Ver m\xE1s") + " (" + total + ")</button>" : "") + "</div>" + (total > 0 ? '<div class="dv-chart" style="height:' + h + 'px"><canvas id="dv-chart-top-' + tipo + '"></canvas></div>' : '<div class="dv-muted">Sin datos.</div>') + (abierto ? _verMasTabla(tipo, rows) : "") + "</section>";
  }
  function _lineSection(id, titulo) {
    return '<section class="dv-section"><div class="dv-section-head"><h3>' + _escHtml(titulo) + '</h3></div><div class="dv-chart" style="height:240px"><canvas id="' + id + '"></canvas></div></section>';
  }
  function _isEmpty(d) {
    if (!d) return true;
    const k = d.kpis || {};
    const hayKpi = Number(k.facturado) || Number(k.pedidos) || Number(k.pedidosUnicos) || Number(k.backorderArs);
    const hayTop = Array.isArray(d.topUnidades) && d.topUnidades.length > 0;
    const haySerie = Array.isArray(d.serieVentas) && d.serieVentas.some((p) => Number(p.valor));
    return !hayKpi && !hayTop && !haySerie;
  }
  function render() {
    const body = document.getElementById("dashboard-ventas-body");
    if (!body) return;
    const root = body;
    const d = state.data;
    let html = "";
    html += '<details class="dv-filtros" id="dv-filtros"' + (window.innerWidth > 700 ? " open" : "") + ">";
    html += '<summary>Filtros</summary><div class="dv-filtros-grid">';
    html += '<div class="dv-filtro"><div class="dv-filtro-label">Mes</div><input type="month" id="dv-mes" class="dv-input" value="' + _escHtml(state.mes) + '"></div>';
    for (const def of FILTROS_DEF) html += _renderFiltro(def);
    html += '</div><div class="dv-filtros-actions">';
    html += '<button type="button" class="dv-btn-secondary" data-dv-action="limpiar">Limpiar filtros</button><button type="button" class="dv-btn-primary" data-dv-action="aplicar"' + (state.loading ? " disabled" : "") + ">Aplicar</button>";
    html += "</div></details>";
    html += '<div class="dv-leyenda">Montos sin IVA, con descuento aplicado y notas de cr\xE9dito restadas.';
    if (d && d.dataUpdatedAt) {
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
    if (!state.loading && !state.error && d && !_isEmpty(d)) {
      _loadChartJs().then(() => _drawCharts(d)).catch((e) => {
        console.warn("[dashboard-ventas] Chart.js no disponible:", e);
        root.querySelectorAll(".dv-chart").forEach((el) => {
          el.innerHTML = '<div class="dv-muted">No se pudo cargar el gr\xE1fico. Revis\xE1 la conexi\xF3n.</div>';
        });
      });
    }
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
          state.sel = { vendedores: [], clientes: [], provincias: [], categorias: [], skus: [] };
          state.mes = _mesActualArt();
          cargar();
        }
        return;
      }
      const vm = t.closest("[data-vermas]");
      if (vm) {
        const tipo = vm.getAttribute("data-vermas");
        state.verMas[tipo] = !state.verMas[tipo];
        _readSelFromDom(body);
        render();
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
    modal.classList.add("open");
    _wire();
    if (!state.mes) state.mes = _mesActualArt();
    _loadChartJs().catch(() => {
    });
    if (!state.data && !state.loading) cargar();
    else render();
  };
  window.closeDashboardVentas = function() {
    const modal = document.getElementById("dashboard-ventas-modal");
    if (modal) modal.classList.remove("open");
    _destroyCharts();
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI4LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5jb25zdCBzdGF0ZSA9IHtcbiAgbWVzOiAnJyxcbiAgc2VsOiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfSxcbiAgZGF0YTogbnVsbCxcbiAgbG9hZGluZzogZmFsc2UsXG4gIGVycm9yOiAnJyxcbiAgdmVyTWFzOiB7IHVuaWRhZGVzOiBmYWxzZSwgZGluZXJvOiBmYWxzZSB9LFxuICB2ZXJNYXNRdWVyeTogeyB1bmlkYWRlczogJycsIGRpbmVybzogJycgfSxcbiAgcmVxU2VxOiAwLFxufTtcblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnk+fSAqL1xuY29uc3QgY2hhcnRzID0ge307XG5sZXQgY2hhcnRKc1Byb21pc2UgPSBudWxsO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfZXNjSHRtbChzKSB7XG4gIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gd2luZG93LmVzY2FwZUh0bWwocyk7XG4gIH1cbiAgaWYgKHMgPT0gbnVsbCkgcmV0dXJuICcnO1xuICByZXR1cm4gU3RyaW5nKHMpXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JylcbiAgICAucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcbn1cblxuZnVuY3Rpb24gX2ZtdEFycyhuKSB7XG4gIGNvbnN0IHYgPSBOdW1iZXIobikgfHwgMDtcbiAgcmV0dXJuICckJyArIE1hdGgucm91bmQodikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbmZ1bmN0aW9uIF9mbXRVZHMobikge1xuICByZXR1cm4gTWF0aC5yb3VuZChOdW1iZXIobikgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbmZ1bmN0aW9uIF9yb2xlKCkge1xuICB0cnkge1xuICAgIHJldHVybiAodHlwZW9mIHVzZXJSb2xlICE9PSAndW5kZWZpbmVkJyA/IHVzZXJSb2xlIDogd2luZG93LnVzZXJSb2xlKSB8fCBudWxsO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB3aW5kb3cudXNlclJvbGUgfHwgbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBfbXlWZW5kb3IoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnID8gYXNzaWduZWRWZW5kb3IgOiB3aW5kb3cuYXNzaWduZWRWZW5kb3IpIHx8ICcnO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB3aW5kb3cuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gIH1cbn1cblxuZnVuY3Rpb24gX2lzVmVuZGVkb3IoKSB7XG4gIHJldHVybiBfcm9sZSgpID09PSAndmVuZGVkb3InO1xufVxuXG4vKiogTWVzIGVuIGN1cnNvIGVuIGhvcmEgQXJnZW50aW5hLCBmb3JtYXRvIEFBQUEtTU0uICovXG5mdW5jdGlvbiBfbWVzQWN0dWFsQXJ0KCkge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnRzID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoJ2VuLUNBJywge1xuICAgICAgdGltZVpvbmU6ICdBbWVyaWNhL0FyZ2VudGluYS9CdWVub3NfQWlyZXMnLFxuICAgICAgeWVhcjogJ251bWVyaWMnLFxuICAgICAgbW9udGg6ICcyLWRpZ2l0JyxcbiAgICB9KS5mb3JtYXRUb1BhcnRzKG5ldyBEYXRlKCkpO1xuICAgIGNvbnN0IHkgPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICd5ZWFyJykudmFsdWU7XG4gICAgY29uc3QgbSA9IHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gJ21vbnRoJykudmFsdWU7XG4gICAgcmV0dXJuIHkgKyAnLScgKyBtO1xuICB9IGNhdGNoIChfZSkge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xuICAgIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxufVxuXG5jb25zdCBNRVNFU19DT1JUT1MgPSBbXG4gICdlbmUnLFxuICAnZmViJyxcbiAgJ21hcicsXG4gICdhYnInLFxuICAnbWF5JyxcbiAgJ2p1bicsXG4gICdqdWwnLFxuICAnYWdvJyxcbiAgJ3NlcCcsXG4gICdvY3QnLFxuICAnbm92JyxcbiAgJ2RpYycsXG5dO1xuZnVuY3Rpb24gX2xhYmVsTWVzKGFhYWFtbSkge1xuICBjb25zdCBzID0gU3RyaW5nKGFhYWFtbSB8fCAnJyk7XG4gIGNvbnN0IG0gPSBOdW1iZXIocy5zbGljZSg1LCA3KSk7XG4gIGlmICghbSkgcmV0dXJuIHM7XG4gIHJldHVybiBNRVNFU19DT1JUT1NbbSAtIDFdICsgJyAnICsgcy5zbGljZSgyLCA0KTtcbn1cblxuZnVuY3Rpb24gX2Vycm9yTWVzc2FnZSgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBtdiA9IHdpbmRvdy5fX3BoYXNlMCAmJiB3aW5kb3cuX19waGFzZTAucHVyZSAmJiB3aW5kb3cuX19waGFzZTAucHVyZS5tZW5zYWplc1ZlbmRlZG9yO1xuICAgIGlmIChtdiAmJiB0eXBlb2YgbXYuZm9ybWF0TWVuc2FqZUNvbkNvZGlnbyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIG12LmZvcm1hdE1lbnNhamVDb25Db2RpZ28oJ0RBU0hCT0FSRF9WRU5UQVNfRkFJTEVEJyk7XG4gICAgfVxuICB9IGNhdGNoIChfZSkge31cbiAgLy8gRmFsbGJhY2sgXHUwMEE3Njggc2kgZWwgYnVuZGxlIG5vIGNhcmdcdTAwRjMgKFNXIHN0YWxlKS5cbiAgcmV0dXJuIChcbiAgICAnTm8gcHVkaW1vcyBjYXJnYXIgZWwgdGFibGVybyBkZSB2ZW50YXMuIFZvbHZcdTAwRTkgYSBpbnRlbnRhciBlbiB1biBtaW51dG87IHNpIHNpZ3VlIHBhc2FuZG8sIGF2aXNhbGUgYSBNYXJpYW5vLicgK1xuICAgICdcXG5cXG5DXHUwMEYzZGlnbyB0XHUwMEU5Y25pY286IERBU0hCT0FSRF9WRU5UQVNfRkFJTEVEJ1xuICApO1xufVxuXG5mdW5jdGlvbiBfbG9hZENoYXJ0SnMoKSB7XG4gIGlmICh3aW5kb3cuQ2hhcnQpIHJldHVybiBQcm9taXNlLnJlc29sdmUod2luZG93LkNoYXJ0KTtcbiAgaWYgKGNoYXJ0SnNQcm9taXNlKSByZXR1cm4gY2hhcnRKc1Byb21pc2U7XG4gIGNoYXJ0SnNQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICBzLnNyYyA9IENIQVJUX0pTX1VSTDtcbiAgICBzLmFzeW5jID0gdHJ1ZTtcbiAgICBzLm9ubG9hZCA9ICgpID0+XG4gICAgICB3aW5kb3cuQ2hhcnQgPyByZXNvbHZlKHdpbmRvdy5DaGFydCkgOiByZWplY3QobmV3IEVycm9yKCdDaGFydC5qcyBzaW4gZ2xvYmFsJykpO1xuICAgIHMub25lcnJvciA9ICgpID0+IHtcbiAgICAgIGNoYXJ0SnNQcm9taXNlID0gbnVsbDtcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoJ25vIHNlIHB1ZG8gY2FyZ2FyIENoYXJ0LmpzJykpO1xuICAgIH07XG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKTtcbiAgfSk7XG4gIHJldHVybiBjaGFydEpzUHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gX2Rlc3Ryb3lDaGFydHMoKSB7XG4gIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhjaGFydHMpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoYXJ0c1trXS5kZXN0cm95KCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgZGVsZXRlIGNoYXJ0c1trXTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9wY2lvbmVzIGRlIGZpbHRyb3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRGV2dWVsdmUgW3t2YWx1ZSxsYWJlbH1dIGRlIGxhIG9wY2lcdTAwRjNuIGBrZXlgIGRlIGxhIHJlc3B1ZXN0YS4gKi9cbmZ1bmN0aW9uIF9vcGNpb25lc0RlKGtleSkge1xuICBjb25zdCBvcCA9IChzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEub3BjaW9uZXMpIHx8IHt9O1xuICBjb25zdCBhcnIgPSBBcnJheS5pc0FycmF5KG9wW2tleV0pID8gb3Bba2V5XSA6IFtdO1xuICBpZiAoa2V5ID09PSAnY2xpZW50ZXMnKSB7XG4gICAgcmV0dXJuIGFyci5tYXAoKGMpID0+ICh7XG4gICAgICB2YWx1ZTogU3RyaW5nKGMuY29kZSksXG4gICAgICBsYWJlbDogU3RyaW5nKGMubmFtZSB8fCBjLmNvZGUpICsgJyAoJyArIFN0cmluZyhjLmNvZGUpICsgJyknLFxuICAgIH0pKTtcbiAgfVxuICBpZiAoa2V5ID09PSAnc2t1cycpIHtcbiAgICByZXR1cm4gYXJyLm1hcCgocykgPT4gKHtcbiAgICAgIHZhbHVlOiBTdHJpbmcocy5jb2RlKSxcbiAgICAgIGxhYmVsOiBTdHJpbmcocy5jb2RlKSArIChzLmRlc2MgPyAnIC0gJyArIFN0cmluZyhzLmRlc2MpIDogJycpLFxuICAgIH0pKTtcbiAgfVxuICByZXR1cm4gYXJyLm1hcCgodikgPT4gKHsgdmFsdWU6IFN0cmluZyh2KSwgbGFiZWw6IFN0cmluZyh2KSB9KSk7XG59XG5cbmZ1bmN0aW9uIF9yZXN1bWVuU2VsKGtleSkge1xuICBjb25zdCBuID0gc3RhdGUuc2VsW2tleV0ubGVuZ3RoO1xuICBpZiAobiA9PT0gMCkgcmV0dXJuICdUb2Rvcyc7XG4gIGlmIChuID09PSAxKSB7XG4gICAgY29uc3QgbyA9IF9vcGNpb25lc0RlKGtleSkuZmluZCgoeCkgPT4geC52YWx1ZSA9PT0gc3RhdGUuc2VsW2tleV1bMF0pO1xuICAgIHJldHVybiBvID8gby5sYWJlbCA6IHN0YXRlLnNlbFtrZXldWzBdO1xuICB9XG4gIHJldHVybiBuICsgJyBzZWxlY2Npb25hZG9zJztcbn1cblxuZnVuY3Rpb24gX3JlbmRlckZpbHRybyhkZWYpIHtcbiAgaWYgKGRlZi5rZXkgPT09ICd2ZW5kZWRvcmVzJyAmJiBfaXNWZW5kZWRvcigpKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPicgK1xuICAgICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LW1zLWxvY2tlZFwiIHRpdGxlPVwiVmVzIHNvbG8gdHVzIGNsaWVudGVzXCI+JyArXG4gICAgICBfZXNjSHRtbChfbXlWZW5kb3IoKSB8fCAnVHVzIGNsaWVudGVzJykgK1xuICAgICAgJyBcdUQ4M0RcdUREMTI8L2Rpdj48L2Rpdj4nXG4gICAgKTtcbiAgfVxuICBjb25zdCBvcGNpb25lcyA9IF9vcGNpb25lc0RlKGRlZi5rZXkpO1xuICBjb25zdCBzZWxlY3RlZCA9IG5ldyBTZXQoc3RhdGUuc2VsW2RlZi5rZXldKTtcbiAgbGV0IGxpc3QgPSAnJztcbiAgZm9yIChjb25zdCBvIG9mIG9wY2lvbmVzKSB7XG4gICAgbGlzdCArPVxuICAgICAgJzxsYWJlbCBjbGFzcz1cImR2LW1zLW9wdFwiIGRhdGEtc2VhcmNoPVwiJyArXG4gICAgICBfZXNjSHRtbChvLmxhYmVsLnRvTG93ZXJDYXNlKCkpICtcbiAgICAgICdcIj48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgZGF0YS1maWx0cm89XCInICtcbiAgICAgIGRlZi5rZXkgK1xuICAgICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgICBfZXNjSHRtbChvLnZhbHVlKSArXG4gICAgICAnXCInICtcbiAgICAgIChzZWxlY3RlZC5oYXMoby52YWx1ZSkgPyAnIGNoZWNrZWQnIDogJycpICtcbiAgICAgICc+IDxzcGFuPicgK1xuICAgICAgX2VzY0h0bWwoby5sYWJlbCkgK1xuICAgICAgJzwvc3Bhbj48L2xhYmVsPic7XG4gIH1cbiAgaWYgKCFsaXN0KSBsaXN0ID0gJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiIHN0eWxlPVwicGFkZGluZzo2cHhcIj5TaW4gb3BjaW9uZXMgdG9kYXZcdTAwRURhLjwvZGl2Pic7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+JyArXG4gICAgX2VzY0h0bWwoZGVmLmxhYmVsKSArXG4gICAgJzwvZGl2PjxkZXRhaWxzIGNsYXNzPVwiZHYtbXNcIiBkYXRhLW1zPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPjxzdW1tYXJ5PicgK1xuICAgIF9lc2NIdG1sKF9yZXN1bWVuU2VsKGRlZi5rZXkpKSArXG4gICAgJzwvc3VtbWFyeT48ZGl2IGNsYXNzPVwiZHYtbXMtcG9wXCI+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2Nhclx1MjAyNlwiIGRhdGEtbXMtc2VhcmNoPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtbXMtYWN0aW9uc1wiPjxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtbGlua1wiIGRhdGEtbXMtY2xlYXI9XCInICtcbiAgICBkZWYua2V5ICtcbiAgICAnXCI+TGltcGlhcjwvYnV0dG9uPjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtbXMtbGlzdFwiPicgK1xuICAgIGxpc3QgK1xuICAgICc8L2Rpdj48L2Rpdj48L2RldGFpbHM+PC9kaXY+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfcmVhZFNlbEZyb21Eb20ocm9vdCkge1xuICBjb25zdCBuZXh0ID0geyB2ZW5kZWRvcmVzOiBbXSwgY2xpZW50ZXM6IFtdLCBwcm92aW5jaWFzOiBbXSwgY2F0ZWdvcmlhczogW10sIHNrdXM6IFtdIH07XG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdW2RhdGEtZmlsdHJvXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgaWYgKGVsLmNoZWNrZWQpIG5leHRbZWwuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpXS5wdXNoKGVsLnZhbHVlKTtcbiAgfSk7XG4gIGlmIChfaXNWZW5kZWRvcigpKSBuZXh0LnZlbmRlZG9yZXMgPSBbXTtcbiAgc3RhdGUuc2VsID0gbmV4dDtcbiAgY29uc3QgbWVzRWwgPSByb290LnF1ZXJ5U2VsZWN0b3IoJyNkdi1tZXMnKTtcbiAgaWYgKG1lc0VsICYmIC9eXFxkezR9LVxcZHsyfSQvLnRlc3QobWVzRWwudmFsdWUpKSBzdGF0ZS5tZXMgPSBtZXNFbC52YWx1ZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfY2FyZCh0aXR1bG8sIHZhbG9yKSB7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1jYXJkXCI+PGRpdiBjbGFzcz1cImR2LWNhcmQtdGl0bGVcIj4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LWNhcmQtdmFsdWVcIj4nICtcbiAgICBfZXNjSHRtbCh2YWxvcikgK1xuICAgICc8L2Rpdj48L2Rpdj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF92ZXJNYXNUYWJsYSh0aXBvLCByb3dzKSB7XG4gIGNvbnN0IHEgPSBzdGF0ZS52ZXJNYXNRdWVyeVt0aXBvXS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgY29uc3QgZmlsdGVyZWQgPSBxXG4gICAgPyByb3dzLmZpbHRlcigocikgPT4gKFN0cmluZyhyLnNrdSkgKyAnICcgKyBTdHJpbmcoci5kZXNjIHx8ICcnKSkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxKSlcbiAgICA6IHJvd3M7XG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LXZlcm1hc1wiPjxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2NhciBTS1UgbyBkZXNjcmlwY2lcdTAwRjNuXHUyMDI2XCIgZGF0YS12ZXJtYXMtc2VhcmNoPVwiJyArXG4gICAgdGlwbyArXG4gICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgX2VzY0h0bWwoc3RhdGUudmVyTWFzUXVlcnlbdGlwb10pICtcbiAgICAnXCI+PGRpdiBjbGFzcz1cImR2LXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJkdi10YWJsZVwiPjx0aGVhZD48dHI+PHRoPiM8L3RoPjx0aD5TS1U8L3RoPjx0aD5EZXNjcmlwY2lcdTAwRjNuPC90aD48dGggY2xhc3M9XCJudW1cIj5VbmlkYWRlczwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RGluZXJvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZpbHRlcmVkLmZvckVhY2goKHIpID0+IHtcbiAgICBjb25zdCBwb3MgPSByb3dzLmluZGV4T2YocikgKyAxO1xuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MgfHwgJycpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfSk7XG4gIGlmIChmaWx0ZXJlZC5sZW5ndGggPT09IDApXG4gICAgaHRtbCArPSAnPHRyPjx0ZCBjb2xzcGFuPVwiNVwiIGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gcmVzdWx0YWRvcy48L3RkPjwvdHI+JztcbiAgaHRtbCArPSAnPC90Ym9keT48L3RhYmxlPjwvZGl2PjwvZGl2Pic7XG4gIHJldHVybiBodG1sO1xufVxuXG5mdW5jdGlvbiBfdG9wU2VjdGlvbih0aXBvLCB0aXR1bG8sIHJvd3MpIHtcbiAgY29uc3QgYWJpZXJ0byA9IHN0YXRlLnZlck1hc1t0aXBvXTtcbiAgY29uc3QgdG90YWwgPSByb3dzLmxlbmd0aDtcbiAgY29uc3QgaCA9IE1hdGgubWF4KDEyMCwgTWF0aC5taW4oVE9QX04sIHRvdGFsKSAqIDIyICsgNDApO1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2gzPicgK1xuICAgICh0b3RhbCA+IDBcbiAgICAgID8gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtbGlua1wiIGRhdGEtdmVybWFzPVwiJyArXG4gICAgICAgIHRpcG8gK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIChhYmllcnRvID8gJ1ZlciBtZW5vcycgOiAnVmVyIG1cdTAwRTFzJykgK1xuICAgICAgICAnICgnICtcbiAgICAgICAgdG90YWwgK1xuICAgICAgICAnKTwvYnV0dG9uPidcbiAgICAgIDogJycpICtcbiAgICAnPC9kaXY+JyArXG4gICAgKHRvdGFsID4gMFxuICAgICAgPyAnPGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6JyArXG4gICAgICAgIGggK1xuICAgICAgICAncHhcIj48Y2FudmFzIGlkPVwiZHYtY2hhcnQtdG9wLScgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiPjwvY2FudmFzPjwvZGl2PidcbiAgICAgIDogJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiBkYXRvcy48L2Rpdj4nKSArXG4gICAgKGFiaWVydG8gPyBfdmVyTWFzVGFibGEodGlwbywgcm93cykgOiAnJykgK1xuICAgICc8L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfbGluZVNlY3Rpb24oaWQsIHRpdHVsbykge1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2gzPjwvZGl2PjxkaXYgY2xhc3M9XCJkdi1jaGFydFwiIHN0eWxlPVwiaGVpZ2h0OjI0MHB4XCI+PGNhbnZhcyBpZD1cIicgK1xuICAgIGlkICtcbiAgICAnXCI+PC9jYW52YXM+PC9kaXY+PC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2lzRW1wdHkoZCkge1xuICBpZiAoIWQpIHJldHVybiB0cnVlO1xuICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICBjb25zdCBoYXlLcGkgPVxuICAgIE51bWJlcihrLmZhY3R1cmFkbykgfHwgTnVtYmVyKGsucGVkaWRvcykgfHwgTnVtYmVyKGsucGVkaWRvc1VuaWNvcykgfHwgTnVtYmVyKGsuYmFja29yZGVyQXJzKTtcbiAgY29uc3QgaGF5VG9wID0gQXJyYXkuaXNBcnJheShkLnRvcFVuaWRhZGVzKSAmJiBkLnRvcFVuaWRhZGVzLmxlbmd0aCA+IDA7XG4gIGNvbnN0IGhheVNlcmllID0gQXJyYXkuaXNBcnJheShkLnNlcmllVmVudGFzKSAmJiBkLnNlcmllVmVudGFzLnNvbWUoKHApID0+IE51bWJlcihwLnZhbG9yKSk7XG4gIHJldHVybiAhaGF5S3BpICYmICFoYXlUb3AgJiYgIWhheVNlcmllO1xufVxuXG5mdW5jdGlvbiByZW5kZXIoKSB7XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuO1xuICBjb25zdCByb290ID0gYm9keTtcbiAgY29uc3QgZCA9IHN0YXRlLmRhdGE7XG5cbiAgbGV0IGh0bWwgPSAnJztcbiAgLy8gRmlsdHJvcyAocGFuZWwgZGVzcGxlZ2FibGUsIG1vYmlsZS1maXJzdCkuXG4gIGh0bWwgKz1cbiAgICAnPGRldGFpbHMgY2xhc3M9XCJkdi1maWx0cm9zXCIgaWQ9XCJkdi1maWx0cm9zXCInICsgKHdpbmRvdy5pbm5lcldpZHRoID4gNzAwID8gJyBvcGVuJyA6ICcnKSArICc+JztcbiAgaHRtbCArPSAnPHN1bW1hcnk+RmlsdHJvczwvc3VtbWFyeT48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvcy1ncmlkXCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtZmlsdHJvXCI+PGRpdiBjbGFzcz1cImR2LWZpbHRyby1sYWJlbFwiPk1lczwvZGl2PjxpbnB1dCB0eXBlPVwibW9udGhcIiBpZD1cImR2LW1lc1wiIGNsYXNzPVwiZHYtaW5wdXRcIiB2YWx1ZT1cIicgK1xuICAgIF9lc2NIdG1sKHN0YXRlLm1lcykgK1xuICAgICdcIj48L2Rpdj4nO1xuICBmb3IgKGNvbnN0IGRlZiBvZiBGSUxUUk9TX0RFRikgaHRtbCArPSBfcmVuZGVyRmlsdHJvKGRlZik7XG4gIGh0bWwgKz0gJzwvZGl2PjxkaXYgY2xhc3M9XCJkdi1maWx0cm9zLWFjdGlvbnNcIj4nO1xuICBodG1sICs9XG4gICAgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtYnRuLXNlY29uZGFyeVwiIGRhdGEtZHYtYWN0aW9uPVwibGltcGlhclwiPkxpbXBpYXIgZmlsdHJvczwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWJ0bi1wcmltYXJ5XCIgZGF0YS1kdi1hY3Rpb249XCJhcGxpY2FyXCInICtcbiAgICAoc3RhdGUubG9hZGluZyA/ICcgZGlzYWJsZWQnIDogJycpICtcbiAgICAnPkFwbGljYXI8L2J1dHRvbj4nO1xuICBodG1sICs9ICc8L2Rpdj48L2RldGFpbHM+JztcblxuICBodG1sICs9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi1sZXllbmRhXCI+TW9udG9zIHNpbiBJVkEsIGNvbiBkZXNjdWVudG8gYXBsaWNhZG8geSBub3RhcyBkZSBjclx1MDBFOWRpdG8gcmVzdGFkYXMuJztcbiAgaWYgKGQgJiYgZC5kYXRhVXBkYXRlZEF0KSB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKGQuZGF0YVVwZGF0ZWRBdCk7XG4gICAgaWYgKCFOdW1iZXIuaXNOYU4odC5nZXRUaW1lKCkpKSB7XG4gICAgICBodG1sICs9XG4gICAgICAgICcgPHNwYW4gY2xhc3M9XCJkdi1tdXRlZFwiPlx1MDBCNyBDYWxjdWxhZG8gJyArXG4gICAgICAgIF9lc2NIdG1sKHQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KSkgK1xuICAgICAgICAnPC9zcGFuPic7XG4gICAgfVxuICB9XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgaWYgKHN0YXRlLmxvYWRpbmcpIHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZHYtZXN0YWRvXCI+Q2FyZ2FuZG9cdTIwMjY8L2Rpdj4nO1xuICB9IGVsc2UgaWYgKHN0YXRlLmVycm9yKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG8gZHYtZXJyb3JcIj4nICsgX2VzY0h0bWwoc3RhdGUuZXJyb3IpLnJlcGxhY2UoL1xcbi9nLCAnPGJyPicpICsgJzwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoZCAmJiBfaXNFbXB0eShkKSkge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5ObyBoYXkgdmVudGFzIGNvbiBlc29zIGZpbHRyb3MuPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkKSB7XG4gICAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZHYtY2FyZHNcIj4nO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0ZhY3R1cmFkbyBtZW5zdWFsJywgX2ZtdEFycyhrLmZhY3R1cmFkbykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ1ZhbG9yaXphY2lcdTAwRjNuIGJhY2tvcmRlcicsIF9mbXRBcnMoay5iYWNrb3JkZXJBcnMpKTtcbiAgICBodG1sICs9IF9jYXJkKCdDYW50LiBkZSBwZWRpZG9zIGRlbCBtZXMnLCBfZm10VWRzKGsucGVkaWRvcykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIHBlZGlkb3MgXHUwMEZBbmljb3MnLCBfZm10VWRzKGsucGVkaWRvc1VuaWNvcykpO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gICAgaHRtbCArPSBfdG9wU2VjdGlvbigndW5pZGFkZXMnLCAnVG9wIDIwIFNLVSAtIFVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSk7XG4gICAgaHRtbCArPSBfdG9wU2VjdGlvbignZGluZXJvJywgJ1RvcCAyMCBTS1UgLSBEaW5lcm8nLCBkLnRvcERpbmVybyB8fCBbXSk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LXZlbnRhcycsICdFdm9sdWNpXHUwMEYzbiBkZSB2ZW50YXMnKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtYm8tdWRzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrb3JkZXIgLSBVbmlkYWRlcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby1hcnMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIERpbmVybycpO1xuICB9XG5cbiAgX2Rlc3Ryb3lDaGFydHMoKTtcbiAgcm9vdC5pbm5lckhUTUwgPSBodG1sO1xuXG4gIGlmICghc3RhdGUubG9hZGluZyAmJiAhc3RhdGUuZXJyb3IgJiYgZCAmJiAhX2lzRW1wdHkoZCkpIHtcbiAgICBfbG9hZENoYXJ0SnMoKVxuICAgICAgLnRoZW4oKCkgPT4gX2RyYXdDaGFydHMoZCkpXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gX2Nzc1ZhcihuYW1lLCBmYWxsYmFjaykge1xuICB0cnkge1xuICAgIGNvbnN0IHYgPSBnZXRDb21wdXRlZFN0eWxlKGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCkuZ2V0UHJvcGVydHlWYWx1ZShuYW1lKS50cmltKCk7XG4gICAgcmV0dXJuIHYgfHwgZmFsbGJhY2s7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIGZhbGxiYWNrO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9iYXJDaGFydChjYW52YXNJZCwgcm93cywgZmllbGQsIGZtdCwgY29sb3IpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChjYW52YXNJZCk7XG4gIGlmICghZWwgfHwgIXdpbmRvdy5DaGFydCkgcmV0dXJuO1xuICBjb25zdCB0b3AgPSByb3dzLnNsaWNlKDAsIFRPUF9OKTtcbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnYmFyJyxcbiAgICBkYXRhOiB7XG4gICAgICBsYWJlbHM6IHRvcC5tYXAoKHIpID0+IFN0cmluZyhyLnNrdSkpLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAgeyBkYXRhOiB0b3AubWFwKChyKSA9PiBOdW1iZXIocltmaWVsZF0pIHx8IDApLCBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLCBib3JkZXJSYWRpdXM6IDMgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBpbmRleEF4aXM6ICd5JyxcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICB0b29sdGlwOiB7XG4gICAgICAgICAgY2FsbGJhY2tzOiB7XG4gICAgICAgICAgICB0aXRsZTogKGl0ZW1zKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSB0b3BbaXRlbXNbMF0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBTdHJpbmcoci5za3UpICsgKHIuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHIuZGVzYykgOiAnJykgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogKGl0ZW0pID0+IGZtdChpdGVtLnJhdyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeDoge1xuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IGZtdCh2KSxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDUsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB5OiB7XG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAgfSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtc2Vjb25kYXJ5JywgJyMzMzQxNTUnKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuLyoqXG4gKiBTZXJpZSBkZSBiYWNrIG9yZGVyIGVuIDIgZGF0YXNldHM6IHJlYWwgKGxcdTAwRURuZWEgbGxlbmEpIHkgZXN0aW1hZG8gKHB1bnRlYWRhKS5cbiAqIFVuIHB1bnRvIGVzdGltYWRvIHNlIGNvbmVjdGEgY29uIHN1IHZlY2lubyByZWFsIHBhcmEgcXVlIGxhIGN1cnZhIG5vIHF1ZWRlXG4gKiBjb3J0YWRhIGVuIGxhIHRyYW5zaWNpXHUwMEYzbjsgYG51bGxgIChzaW4gZGF0b3MpIGNvcnRhIGxhIGxcdTAwRURuZWEgKHNwYW5HYXBzOmZhbHNlKS5cbiAqL1xuZnVuY3Rpb24gX3NwbGl0QmFja29yZGVyKHNlcmllKSB7XG4gIGNvbnN0IHJlYWwgPSBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgfHwgcC5lc3RpbWFkbyA/IG51bGwgOiBOdW1iZXIocC52YWxvcikpKTtcbiAgY29uc3QgZXN0ID0gc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsIHx8ICFwLmVzdGltYWRvID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlcmllLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGVzdFtpXSA9PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAoaSArIDEgPCBzZXJpZS5sZW5ndGggJiYgcmVhbFtpICsgMV0gIT0gbnVsbCkgZXN0W2kgKyAxXSA9IHJlYWxbaSArIDFdO1xuICAgIGlmIChpIC0gMSA+PSAwICYmIHJlYWxbaSAtIDFdICE9IG51bGwgJiYgZXN0W2kgLSAxXSA9PSBudWxsKSBlc3RbaSAtIDFdID0gcmVhbFtpIC0gMV07XG4gIH1cbiAgcmV0dXJuIHsgcmVhbCwgZXN0LCBoYXlFc3RpbWFkbzogc2VyaWUuc29tZSgocCkgPT4gcC5lc3RpbWFkbyAmJiBwLnZhbG9yICE9IG51bGwpIH07XG59XG5cbmZ1bmN0aW9uIF9saW5lQ2hhcnQoY2FudmFzSWQsIHNlcmllLCBmbXQsIGNvbG9yLCBjb25Fc3RpbWFkbykge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGNhbnZhc0lkKTtcbiAgaWYgKCFlbCB8fCAhd2luZG93LkNoYXJ0KSByZXR1cm47XG4gIGNvbnN0IGxhYmVscyA9IHNlcmllLm1hcCgocCkgPT4gX2xhYmVsTWVzKHAubWVzKSk7XG4gIGNvbnN0IGRhdGFzZXRzID0gW107XG4gIGlmIChjb25Fc3RpbWFkbykge1xuICAgIGNvbnN0IHMgPSBfc3BsaXRCYWNrb3JkZXIoc2VyaWUpO1xuICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgbGFiZWw6ICdyZWFsJyxcbiAgICAgIGRhdGE6IHMucmVhbCxcbiAgICAgIGJvcmRlckNvbG9yOiBjb2xvcixcbiAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICBzcGFuR2FwczogZmFsc2UsXG4gICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICBwb2ludFJhZGl1czogMyxcbiAgICB9KTtcbiAgICBpZiAocy5oYXlFc3RpbWFkbykge1xuICAgICAgZGF0YXNldHMucHVzaCh7XG4gICAgICAgIGxhYmVsOiAnZXN0aW1hZG8nLFxuICAgICAgICBkYXRhOiBzLmVzdCxcbiAgICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgICBib3JkZXJEYXNoOiBbNiwgNF0sXG4gICAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgICBwb2ludFJhZGl1czogMyxcbiAgICAgICAgcG9pbnRTdHlsZTogJ3JlY3RSb3QnLFxuICAgICAgfSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgbGFiZWw6ICdmYWN0dXJhZG8nLFxuICAgICAgZGF0YTogc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpLFxuICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgIHRlbnNpb246IDAuMixcbiAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgIH0pO1xuICB9XG4gIGNoYXJ0c1tjYW52YXNJZF0gPSBuZXcgd2luZG93LkNoYXJ0KGVsLCB7XG4gICAgdHlwZTogJ2xpbmUnLFxuICAgIGRhdGE6IHsgbGFiZWxzLCBkYXRhc2V0cyB9LFxuICAgIG9wdGlvbnM6IHtcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBjb25Fc3RpbWFkbyAmJiBkYXRhc2V0cy5sZW5ndGggPiAxIH0sXG4gICAgICAgIHRvb2x0aXA6IHsgY2FsbGJhY2tzOiB7IGxhYmVsOiAoaXRlbSkgPT4gaXRlbS5kYXRhc2V0LmxhYmVsICsgJzogJyArIGZtdChpdGVtLnJhdykgfSB9LFxuICAgICAgfSxcbiAgICAgIHNjYWxlczoge1xuICAgICAgICB5OiB7XG4gICAgICAgICAgYmVnaW5BdFplcm86IHRydWUsXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNixcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHg6IHsgdGlja3M6IHsgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJykgfSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gX2RyYXdDaGFydHMoZCkge1xuICAvLyBQdWVkZSBxdWUgZWwgdXN1YXJpbyBoYXlhIHJlLXJlbmRlcml6YWRvIG1pZW50cmFzIGNhcmdhYmEgQ2hhcnQuanMuXG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLXVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSwgJ3VkcycsIF9mbXRVZHMsICcjMDI4NGEwJyk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLWRpbmVybycsIGQudG9wRGluZXJvIHx8IFtdLCAnYXJzJywgX2ZtdEFycywgJyMxNmEzNGEnKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtdmVudGFzJywgZC5zZXJpZVZlbnRhcyB8fCBbXSwgX2ZtdEFycywgJyMxZTQwYWYnLCBmYWxzZSk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LWJvLXVkcycsIGQuc2VyaWVCb1VkcyB8fCBbXSwgX2ZtdFVkcywgJyNjMjQxMGMnLCB0cnVlKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtYm8tYXJzJywgZC5zZXJpZUJvQXJzIHx8IFtdLCBfZm10QXJzLCAnIzlmMTIzOScsIHRydWUpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERhdG9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX2ZpbHRyb3NQYXlsb2FkKCkge1xuICByZXR1cm4ge1xuICAgIG1lczogc3RhdGUubWVzLFxuICAgIHZlbmRlZG9yZXM6IF9pc1ZlbmRlZG9yKCkgPyBbXSA6IHN0YXRlLnNlbC52ZW5kZWRvcmVzLnNsaWNlKCksXG4gICAgY2xpZW50ZXM6IHN0YXRlLnNlbC5jbGllbnRlcy5zbGljZSgpLFxuICAgIHByb3ZpbmNpYXM6IHN0YXRlLnNlbC5wcm92aW5jaWFzLnNsaWNlKCksXG4gICAgY2F0ZWdvcmlhczogc3RhdGUuc2VsLmNhdGVnb3JpYXMuc2xpY2UoKSxcbiAgICBza3VzOiBzdGF0ZS5zZWwuc2t1cy5zbGljZSgpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjYXJnYXIoKSB7XG4gIGNvbnN0IHNlcSA9ICsrc3RhdGUucmVxU2VxO1xuICBzdGF0ZS5sb2FkaW5nID0gdHJ1ZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgcmVuZGVyKCk7XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBmaXJlYmFzZSA9PT0gJ3VuZGVmaW5lZCcgfHwgIWZpcmViYXNlLmFwcCkgdGhyb3cgbmV3IEVycm9yKCdmaXJlYmFzZSBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3QgY2FsbGFibGUgPSBmaXJlYmFzZS5hcHAoKS5mdW5jdGlvbnMoUkVHSU9OKS5odHRwc0NhbGxhYmxlKCdkYXNoYm9hcmRWZW50YXNDRicpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKF9maWx0cm9zUGF5bG9hZCgpKTtcbiAgICBpZiAoc2VxICE9PSBzdGF0ZS5yZXFTZXEpIHJldHVybjtcbiAgICBzdGF0ZS5kYXRhID0gKHJlcyAmJiByZXMuZGF0YSkgfHwgbnVsbDtcbiAgICBzdGF0ZS52ZXJNYXMgPSB7IHVuaWRhZGVzOiBmYWxzZSwgZGluZXJvOiBmYWxzZSB9O1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKHNlcSAhPT0gc3RhdGUucmVxU2VxKSByZXR1cm47XG4gICAgY29uc29sZS5lcnJvcignW2Rhc2hib2FyZC12ZW50YXNdIGRhc2hib2FyZFZlbnRhc0NGIGZhbGxvOicsIGUpO1xuICAgIHN0YXRlLmVycm9yID0gX2Vycm9yTWVzc2FnZSgpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChzZXEgPT09IHN0YXRlLnJlcVNlcSkge1xuICAgICAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXZlbnRvcyAoZGVsZWdhZG9zIHNvYnJlIGVsIGJvZHkgZGVsIG1vZGFsKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmxldCBfd2lyZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIF93aXJlKCkge1xuICBpZiAoX3dpcmVkKSByZXR1cm47XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuO1xuICBfd2lyZWQgPSB0cnVlO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICghKHQgaW5zdGFuY2VvZiBFbGVtZW50KSkgcmV0dXJuO1xuICAgIGNvbnN0IGFjdCA9IHQuY2xvc2VzdCgnW2RhdGEtZHYtYWN0aW9uXScpO1xuICAgIGlmIChhY3QpIHtcbiAgICAgIGNvbnN0IGEgPSBhY3QuZ2V0QXR0cmlidXRlKCdkYXRhLWR2LWFjdGlvbicpO1xuICAgICAgaWYgKGEgPT09ICdhcGxpY2FyJykge1xuICAgICAgICBfcmVhZFNlbEZyb21Eb20oYm9keSk7XG4gICAgICAgIGNhcmdhcigpO1xuICAgICAgfSBlbHNlIGlmIChhID09PSAnbGltcGlhcicpIHtcbiAgICAgICAgc3RhdGUuc2VsID0geyB2ZW5kZWRvcmVzOiBbXSwgY2xpZW50ZXM6IFtdLCBwcm92aW5jaWFzOiBbXSwgY2F0ZWdvcmlhczogW10sIHNrdXM6IFtdIH07XG4gICAgICAgIHN0YXRlLm1lcyA9IF9tZXNBY3R1YWxBcnQoKTtcbiAgICAgICAgY2FyZ2FyKCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHZtID0gdC5jbG9zZXN0KCdbZGF0YS12ZXJtYXNdJyk7XG4gICAgaWYgKHZtKSB7XG4gICAgICBjb25zdCB0aXBvID0gdm0uZ2V0QXR0cmlidXRlKCdkYXRhLXZlcm1hcycpO1xuICAgICAgc3RhdGUudmVyTWFzW3RpcG9dID0gIXN0YXRlLnZlck1hc1t0aXBvXTtcbiAgICAgIF9yZWFkU2VsRnJvbURvbShib2R5KTtcbiAgICAgIHJlbmRlcigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjbHIgPSB0LmNsb3Nlc3QoJ1tkYXRhLW1zLWNsZWFyXScpO1xuICAgIGlmIChjbHIpIHtcbiAgICAgIGNvbnN0IGtleSA9IGNsci5nZXRBdHRyaWJ1dGUoJ2RhdGEtbXMtY2xlYXInKTtcbiAgICAgIGJvZHkucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdW2RhdGEtZmlsdHJvPVwiJyArIGtleSArICdcIl0nKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICBlbC5jaGVja2VkID0gZmFsc2U7XG4gICAgICB9KTtcbiAgICAgIF91cGRhdGVTdW1tYXJ5KGJvZHksIGtleSk7XG4gICAgfVxuICB9KTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIChldikgPT4ge1xuICAgIGNvbnN0IHQgPSBldi50YXJnZXQ7XG4gICAgaWYgKHQgaW5zdGFuY2VvZiBIVE1MSW5wdXRFbGVtZW50ICYmIHQudHlwZSA9PT0gJ2NoZWNrYm94JyAmJiB0Lmhhc0F0dHJpYnV0ZSgnZGF0YS1maWx0cm8nKSkge1xuICAgICAgX3VwZGF0ZVN1bW1hcnkoYm9keSwgdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJykpO1xuICAgIH1cbiAgfSk7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdpbnB1dCcsIChldikgPT4ge1xuICAgIGNvbnN0IHQgPSBldi50YXJnZXQ7XG4gICAgaWYgKCEodCBpbnN0YW5jZW9mIEhUTUxJbnB1dEVsZW1lbnQpKSByZXR1cm47XG4gICAgY29uc3QgbXNLZXkgPSB0LmdldEF0dHJpYnV0ZSgnZGF0YS1tcy1zZWFyY2gnKTtcbiAgICBpZiAobXNLZXkpIHtcbiAgICAgIGNvbnN0IHEgPSB0LnZhbHVlLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuICAgICAgY29uc3QgZGV0ID0gYm9keS5xdWVyeVNlbGVjdG9yKCdkZXRhaWxzW2RhdGEtbXM9XCInICsgbXNLZXkgKyAnXCJdJyk7XG4gICAgICBpZiAoIWRldCkgcmV0dXJuO1xuICAgICAgZGV0LnF1ZXJ5U2VsZWN0b3JBbGwoJy5kdi1tcy1vcHQnKS5mb3JFYWNoKChvcHQpID0+IHtcbiAgICAgICAgY29uc3QgcyA9IG9wdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtc2VhcmNoJykgfHwgJyc7XG4gICAgICAgIG9wdC5zdHlsZS5kaXNwbGF5ID0gIXEgfHwgcy5pbmNsdWRlcyhxKSA/ICcnIDogJ25vbmUnO1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHZtS2V5ID0gdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdmVybWFzLXNlYXJjaCcpO1xuICAgIGlmICh2bUtleSkge1xuICAgICAgc3RhdGUudmVyTWFzUXVlcnlbdm1LZXldID0gdC52YWx1ZTtcbiAgICAgIGNvbnN0IHNlYyA9IHQuY2xvc2VzdCgnLmR2LXZlcm1hcycpO1xuICAgICAgY29uc3Qgcm93cyA9XG4gICAgICAgIChzdGF0ZS5kYXRhICYmICh2bUtleSA9PT0gJ3VuaWRhZGVzJyA/IHN0YXRlLmRhdGEudG9wVW5pZGFkZXMgOiBzdGF0ZS5kYXRhLnRvcERpbmVybykpIHx8XG4gICAgICAgIFtdO1xuICAgICAgaWYgKHNlYykge1xuICAgICAgICBjb25zdCB0bXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgICAgdG1wLmlubmVySFRNTCA9IF92ZXJNYXNUYWJsYSh2bUtleSwgcm93cyk7XG4gICAgICAgIGNvbnN0IG5ld1dyYXAgPSB0bXAucXVlcnlTZWxlY3RvcignLmR2LXRhYmxlLXdyYXAnKTtcbiAgICAgICAgY29uc3Qgb2xkV3JhcCA9IHNlYy5xdWVyeVNlbGVjdG9yKCcuZHYtdGFibGUtd3JhcCcpO1xuICAgICAgICBpZiAobmV3V3JhcCAmJiBvbGRXcmFwKSBvbGRXcmFwLnJlcGxhY2VXaXRoKG5ld1dyYXApO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG59XG5cbmZ1bmN0aW9uIF91cGRhdGVTdW1tYXJ5KGJvZHksIGtleSkge1xuICBjb25zdCBkZXQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJ2RldGFpbHNbZGF0YS1tcz1cIicgKyBrZXkgKyAnXCJdJyk7XG4gIGlmICghZGV0KSByZXR1cm47XG4gIGNvbnN0IGNoZWNrZWQgPSBBcnJheS5mcm9tKGRldC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl06Y2hlY2tlZCcpKTtcbiAgY29uc3Qgc3VtID0gZGV0LnF1ZXJ5U2VsZWN0b3IoJ3N1bW1hcnknKTtcbiAgaWYgKCFzdW0pIHJldHVybjtcbiAgaWYgKGNoZWNrZWQubGVuZ3RoID09PSAwKSBzdW0udGV4dENvbnRlbnQgPSAnVG9kb3MnO1xuICBlbHNlIGlmIChjaGVja2VkLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHNwYW4gPSBjaGVja2VkWzBdLnBhcmVudEVsZW1lbnQgJiYgY2hlY2tlZFswXS5wYXJlbnRFbGVtZW50LnF1ZXJ5U2VsZWN0b3IoJ3NwYW4nKTtcbiAgICBzdW0udGV4dENvbnRlbnQgPSBzcGFuID8gc3Bhbi50ZXh0Q29udGVudCA6IGNoZWNrZWRbMF0udmFsdWU7XG4gIH0gZWxzZSBzdW0udGV4dENvbnRlbnQgPSBjaGVja2VkLmxlbmd0aCArICcgc2VsZWNjaW9uYWRvcyc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQVBJIHBcdTAwRkFibGljYSAoZXhwb3J0cyBkZWwgY2h1bmspXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxud2luZG93Lm9wZW5EYXNoYm9hcmRWZW50YXMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkgcmV0dXJuO1xuICBjb25zdCByb2xlID0gX3JvbGUoKTtcbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnICYmIHJvbGUgIT09ICd2ZW5kZWRvcicpIHtcbiAgICBhbGVydCgnVHUgdXN1YXJpbyBubyB0aWVuZSBhY2Nlc28gYWwgRGFzaGJvYXJkIGRlIFZlbnRhcy4gU2kgbG8gbmVjZXNpdFx1MDBFMXMsIGF2aXNhbGUgYSBNYXJpYW5vLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIF93aXJlKCk7XG4gIGlmICghc3RhdGUubWVzKSBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIC8vIFByZWNhcmdhIENoYXJ0LmpzIGVuIHBhcmFsZWxvIGEgbGEgY29uc3VsdGEuXG4gIF9sb2FkQ2hhcnRKcygpLmNhdGNoKCgpID0+IHt9KTtcbiAgaWYgKCFzdGF0ZS5kYXRhICYmICFzdGF0ZS5sb2FkaW5nKSBjYXJnYXIoKTtcbiAgZWxzZSByZW5kZXIoKTtcbn07XG5cbndpbmRvdy5jbG9zZURhc2hib2FyZFZlbnRhcyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1tb2RhbCcpO1xuICBpZiAobW9kYWwpIG1vZGFsLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgX2Rlc3Ryb3lDaGFydHMoKTtcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFpQkEsTUFBTSxlQUFlO0FBQ3JCLE1BQU0sUUFBUTtBQUNkLE1BQU0sU0FBUztBQUVmLE1BQU0sY0FBYztBQUFBLElBQ2xCLEVBQUUsS0FBSyxjQUFjLE9BQU8sV0FB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QUFZLGFBQWEsT0FBTyxJQUFJO0FBQ3hDLGdCQUFNLFVBQVUsSUFBSSxjQUFjLGdCQUFnQjtBQUNsRCxnQkFBTSxVQUFVLElBQUksY0FBYyxnQkFBZ0I7QUFDbEQsY0FBSSxXQUFXLFFBQVMsU0FBUSxZQUFZLE9BQU87QUFBQSxRQUNyRDtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBRUEsV0FBUyxlQUFlLE1BQU0sS0FBSztBQUNqQyxVQUFNLE1BQU0sS0FBSyxjQUFjLHNCQUFzQixNQUFNLElBQUk7QUFDL0QsUUFBSSxDQUFDLElBQUs7QUFDVixVQUFNLFVBQVUsTUFBTSxLQUFLLElBQUksaUJBQWlCLGdDQUFnQyxDQUFDO0FBQ2pGLFVBQU0sTUFBTSxJQUFJLGNBQWMsU0FBUztBQUN2QyxRQUFJLENBQUMsSUFBSztBQUNWLFFBQUksUUFBUSxXQUFXLEVBQUcsS0FBSSxjQUFjO0FBQUEsYUFDbkMsUUFBUSxXQUFXLEdBQUc7QUFDN0IsWUFBTSxPQUFPLFFBQVEsQ0FBQyxFQUFFLGlCQUFpQixRQUFRLENBQUMsRUFBRSxjQUFjLGNBQWMsTUFBTTtBQUN0RixVQUFJLGNBQWMsT0FBTyxLQUFLLGNBQWMsUUFBUSxDQUFDLEVBQUU7QUFBQSxJQUN6RCxNQUFPLEtBQUksY0FBYyxRQUFRLFNBQVM7QUFBQSxFQUM1QztBQU1BLFNBQU8sc0JBQXNCLFdBQVk7QUFDdkMsVUFBTSxRQUFRLFNBQVMsZUFBZSx3QkFBd0I7QUFDOUQsUUFBSSxDQUFDLE1BQU87QUFDWixVQUFNLE9BQU8sTUFBTTtBQUNuQixRQUFJLFNBQVMsV0FBVyxTQUFTLGFBQWEsU0FBUyxZQUFZO0FBQ2pFLFlBQU0sMkZBQXdGO0FBQzlGO0FBQUEsSUFDRjtBQUNBLFVBQU0sVUFBVSxJQUFJLE1BQU07QUFDMUIsVUFBTTtBQUNOLFFBQUksQ0FBQyxNQUFNLElBQUssT0FBTSxNQUFNLGNBQWM7QUFFMUMsaUJBQWEsRUFBRSxNQUFNLE1BQU07QUFBQSxJQUFDLENBQUM7QUFDN0IsUUFBSSxDQUFDLE1BQU0sUUFBUSxDQUFDLE1BQU0sUUFBUyxRQUFPO0FBQUEsUUFDckMsUUFBTztBQUFBLEVBQ2Q7QUFFQSxTQUFPLHVCQUF1QixXQUFZO0FBQ3hDLFVBQU0sUUFBUSxTQUFTLGVBQWUsd0JBQXdCO0FBQzlELFFBQUksTUFBTyxPQUFNLFVBQVUsT0FBTyxNQUFNO0FBQ3hDLG1CQUFlO0FBQUEsRUFDakI7IiwKICAibmFtZXMiOiBbXQp9Cg==
