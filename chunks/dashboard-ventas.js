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
    _stockMemo.clear();
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
  var dvPluginRegistrado = false;
  var dvDataLabels = {
    id: "dvDataLabels",
    afterDatasetsDraw(chart) {
      if (chart.config.type !== "bar") return;
      const opts = chart.options.plugins && chart.options.plugins.dvDataLabels || {};
      if (typeof opts.fmt !== "function") return;
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "11px " + CHART_FONT;
      ctx.fillStyle = dark ? "#e5e7eb" : "#1f2937";
      ctx.textBaseline = "middle";
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((bar, i) => {
          const v = ds.data[i];
          if (v == null) return;
          const txt = String(opts.fmt(v, i));
          const horizontal = chart.options.indexAxis === "y";
          if (horizontal) {
            ctx.textAlign = "left";
            ctx.fillText(txt, bar.x + 4, bar.y);
          } else {
            ctx.textAlign = "center";
            ctx.fillText(txt, bar.x, bar.y - 8);
          }
        });
      });
      ctx.restore();
    }
  };
  function _registrarPlugins(Chart) {
    if (dvPluginRegistrado || !Chart || typeof Chart.register !== "function") return;
    Chart.register(dvDataLabels);
    dvPluginRegistrado = true;
  }
  function _loadChartJs() {
    if (window.Chart) {
      _registrarPlugins(window.Chart);
      return Promise.resolve(window.Chart);
    }
    if (chartJsPromise) return chartJsPromise;
    chartJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = CHART_JS_URL;
      s.async = true;
      s.onload = () => {
        if (!window.Chart) return reject(new Error("Chart.js sin global"));
        _registrarPlugins(window.Chart);
        resolve(window.Chart);
      };
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
  var PRODUCTOS_MAX_FILAS = 200;
  var PRODUCTOS_DEBOUNCE_MS = 200;
  var _stockMemo = /* @__PURE__ */ new Map();
  var _prodTimer = null;
  function _stockColumnas(sku) {
    const k = String(sku);
    if (_stockMemo.has(k)) return _stockMemo.get(k);
    const r = _stockColumnasCalc(sku);
    _stockMemo.set(k, r);
    return r;
  }
  function _stockColumnasCalc(sku) {
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
    const matches = q ? lista.filter(
      (r) => (String(r.categoria) + " " + String(r.familia) + " " + String(r.sku)).toLowerCase().includes(q)
    ) : lista;
    const filtered = matches.slice(0, PRODUCTOS_MAX_FILAS);
    let html = '<div class="dv-table-wrap"><table class="dv-table"><thead><tr><th>CATEGORIA</th><th>FAMILIA</th><th>SKU</th><th class="num">UNIDADES VENDIDAS</th><th class="num">FACTURADO</th><th class="num">UNIDADES BACKORDER</th><th class="num">UNIDADES RESERVADAS</th><th class="num">UNIDADES LIBRE PARA LA VENTA</th><th class="num">UNIDADES EN STOCK</th></tr></thead><tbody>';
    for (const r of filtered) {
      const st = _stockColumnas(r.sku);
      html += "<tr><td>" + _escHtml(r.categoria) + "</td><td>" + _escHtml(r.familia) + '</td><td class="mono">' + _escHtml(r.sku) + '</td><td class="num">' + _escHtml(_fmtUds(r.udsVendidas)) + '</td><td class="num">' + _escHtml(_fmtArs(r.facturado)) + '</td><td class="num">' + _escHtml(_fmtUds(r.udsBackorder)) + '</td><td class="num">' + _escHtml(_fmtStockCol(st.reservadas)) + '</td><td class="num">' + _escHtml(_fmtStockCol(st.libre)) + '</td><td class="num">' + _escHtml(_fmtStockCol(st.stock)) + "</td></tr>";
    }
    if (filtered.length === 0)
      html += '<tr><td colspan="9" class="dv-muted">Sin resultados.</td></tr>';
    html += "</tbody></table></div>";
    if (matches.length > filtered.length) {
      html += '<div class="dv-muted">Mostrando ' + PRODUCTOS_MAX_FILAS + " de " + _escHtml(_fmtUds(matches.length)) + ". Us\xE1 el buscador para ver el resto.</div>";
    }
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
  function _campaniasSection(rows, secciones) {
    if (!Array.isArray(rows) || secciones && secciones.campanias && secciones.campanias.error) {
      return _noDisponible("dv-campanias", "Campa\xF1as");
    }
    let cuerpo = "";
    if (rows.length === 0) {
      cuerpo = '<div class="dv-muted">Sin campa\xF1as activas</div>';
    } else {
      for (const c of rows) {
        const sinObjetivo = c.objetivo == null || Number(c.objetivo) === 0;
        const objetivo = sinObjetivo ? "Sin objetivo" : c.objetivoTipo === "money" ? _fmtArs(c.objetivo) : _fmtUds(c.objetivo) + " u";
        const pct = c.pct == null ? null : Number(c.pct);
        const ancho = pct == null ? 0 : Math.max(0, Math.min(100, pct));
        cuerpo += '<div class="dv-camp"><div class="dv-camp-nombre">' + _escHtml(c.nombre) + '</div><div class="dv-camp-fechas">' + _escHtml(_fmtFecha(c.desde)) + " al " + _escHtml(_fmtFecha(c.hasta)) + '</div><div class="dv-camp-datos">Vendido: ' + _escHtml(_fmtUds(c.uds)) + " u \xB7 " + _escHtml(_fmtArs(c.ars)) + " \u2014 Objetivo: " + _escHtml(objetivo) + " \u2014 " + _escHtml(pct == null ? "\u2014" : _fmtPct(pct)) + '</div><div class="dv-camp-bar"><div class="dv-camp-bar-fill" style="width:' + ancho.toFixed(1) + '%"></div></div></div>';
      }
    }
    return '<section class="dv-section" id="dv-campanias"><div class="dv-section-head"><h3>Campa\xF1as</h3></div>' + cuerpo + "</section>";
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
    _stockMemo.clear();
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
      html += _campaniasSection(d.campanias, d.secciones);
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
          dvDataLabels: { fmt },
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
          dvDataLabels: { fmt: (_v, i) => rows[i] ? _coberturaEtiqueta(rows[i]) : "" },
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
        if (_prodTimer) clearTimeout(_prodTimer);
        _prodTimer = setTimeout(() => {
          _prodTimer = null;
          const cont = body.querySelector("#dv-productos .dv-prod-body");
          if (cont)
            cont.innerHTML = _productosTabla(state.data && state.data.productos, state.prodQuery);
        }, PRODUCTOS_DEBOUNCE_MS);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI5LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlLCBjbGllbnRlczogZmFsc2UgfSxcbiAgdmVyTWFzUXVlcnk6IHsgdW5pZGFkZXM6ICcnLCBkaW5lcm86ICcnLCBjbGllbnRlczogJycgfSxcbiAgaW50ZXJRdWVyeTogJycsXG4gIHByb2RRdWVyeTogJycsXG4gIHJlcVNlcTogMCxcbn07XG5cbmZ1bmN0aW9uIF9yZXNldFN0YXRlKHVpZCkge1xuICBzdGF0ZS51aWQgPSB1aWQ7XG4gIHN0YXRlLm1lcyA9IF9tZXNBY3R1YWxBcnQoKTtcbiAgc3RhdGUuc2VsID0gX3NlbFZhY2lhKCk7XG4gIHN0YXRlLmRhdGEgPSBudWxsO1xuICBzdGF0ZS5vcGNpb25lcyA9IG51bGw7XG4gIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBudWxsO1xuICBzdGF0ZS5sb2FkaW5nID0gZmFsc2U7XG4gIHN0YXRlLmVycm9yID0gJyc7XG4gIHN0YXRlLnZlck1hcyA9IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlLCBjbGllbnRlczogZmFsc2UgfTtcbiAgc3RhdGUudmVyTWFzUXVlcnkgPSB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJywgY2xpZW50ZXM6ICcnIH07XG4gIHN0YXRlLmludGVyUXVlcnkgPSAnJztcbiAgc3RhdGUucHJvZFF1ZXJ5ID0gJyc7XG4gIF9zdG9ja01lbW8uY2xlYXIoKTtcbiAgc3RhdGUucmVxU2VxKys7XG59XG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55Pn0gKi9cbmNvbnN0IGNoYXJ0cyA9IHt9O1xubGV0IGNoYXJ0SnNQcm9taXNlID0gbnVsbDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gRXNjYXBlIGxvY2FsIChtaXNtbyByZXN1bHRhZG8gcXVlIHdpbmRvdy5lc2NhcGVIdG1sKTogZWwgYW5cdTAwRTFsaXNpcyBkZVxuLy8gc2VndXJpZGFkIGRlbCByZXBvIChDb2RlUUwpIHNvbG8gcmVjb25vY2UgdW4gc2FuaXRpemFkb3IgdmlzaWJsZSBhY1x1MDBFMS5cbmZ1bmN0aW9uIF9lc2NIdG1sKHMpIHtcbiAgY29uc3QgdiA9IHMgPT0gbnVsbCA/ICcnIDogcztcbiAgcmV0dXJuIFN0cmluZyh2KVxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcbiAgICAucmVwbGFjZSgvXCIvZywgJyZxdW90OycpXG4gICAgLnJlcGxhY2UoLycvZywgJyYjMzk7Jyk7XG59XG5cbmZ1bmN0aW9uIF9mbXRBcnMobikge1xuICBjb25zdCB2ID0gTnVtYmVyKG4pIHx8IDA7XG4gIHJldHVybiAnJCcgKyBNYXRoLnJvdW5kKHYpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xufVxuXG5mdW5jdGlvbiBfZm10VWRzKG4pIHtcbiAgcmV0dXJuIE1hdGgucm91bmQoTnVtYmVyKG4pIHx8IDApLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xufVxuXG5mdW5jdGlvbiBfcm9sZSgpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKHR5cGVvZiB1c2VyUm9sZSAhPT0gJ3VuZGVmaW5lZCcgPyB1c2VyUm9sZSA6IHdpbmRvdy51c2VyUm9sZSkgfHwgbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gd2luZG93LnVzZXJSb2xlIHx8IG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gX215VmVuZG9yKCkge1xuICB0cnkge1xuICAgIHJldHVybiAodHlwZW9mIGFzc2lnbmVkVmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGFzc2lnbmVkVmVuZG9yIDogd2luZG93LmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gd2luZG93LmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9jdXJyZW50VWlkKCkge1xuICB0cnkge1xuICAgIGNvbnN0IHUgPSB0eXBlb2YgY3VycmVudFVzZXIgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFVzZXIgOiB3aW5kb3cuY3VycmVudFVzZXI7XG4gICAgcmV0dXJuICh1ICYmIHUudWlkKSB8fCBudWxsO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci51aWQpIHx8IG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gX2lzT3BlbigpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1tb2RhbCcpO1xuICByZXR1cm4gISEobW9kYWwgJiYgbW9kYWwuY2xhc3NMaXN0ICYmIG1vZGFsLmNsYXNzTGlzdC5jb250YWlucygnb3BlbicpKTtcbn1cblxuZnVuY3Rpb24gX2lzVmVuZGVkb3IoKSB7XG4gIHJldHVybiBfcm9sZSgpID09PSAndmVuZGVkb3InO1xufVxuXG4vKiogTWVzIGVuIGN1cnNvIGVuIGhvcmEgQXJnZW50aW5hLCBmb3JtYXRvIEFBQUEtTU0uICovXG5mdW5jdGlvbiBfbWVzQWN0dWFsQXJ0KCkge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnRzID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoJ2VuLUNBJywge1xuICAgICAgdGltZVpvbmU6ICdBbWVyaWNhL0FyZ2VudGluYS9CdWVub3NfQWlyZXMnLFxuICAgICAgeWVhcjogJ251bWVyaWMnLFxuICAgICAgbW9udGg6ICcyLWRpZ2l0JyxcbiAgICB9KS5mb3JtYXRUb1BhcnRzKG5ldyBEYXRlKCkpO1xuICAgIGNvbnN0IHkgPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICd5ZWFyJykudmFsdWU7XG4gICAgY29uc3QgbSA9IHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gJ21vbnRoJykudmFsdWU7XG4gICAgcmV0dXJuIHkgKyAnLScgKyBtO1xuICB9IGNhdGNoIChfZSkge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xuICAgIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxufVxuXG5jb25zdCBNRVNFU19DT1JUT1MgPSBbXG4gICdlbmUnLFxuICAnZmViJyxcbiAgJ21hcicsXG4gICdhYnInLFxuICAnbWF5JyxcbiAgJ2p1bicsXG4gICdqdWwnLFxuICAnYWdvJyxcbiAgJ3NlcCcsXG4gICdvY3QnLFxuICAnbm92JyxcbiAgJ2RpYycsXG5dO1xuZnVuY3Rpb24gX2xhYmVsTWVzKGFhYWFtbSkge1xuICBjb25zdCBzID0gU3RyaW5nKGFhYWFtbSB8fCAnJyk7XG4gIGNvbnN0IG0gPSBOdW1iZXIocy5zbGljZSg1LCA3KSk7XG4gIGlmICghbSkgcmV0dXJuIHM7XG4gIHJldHVybiBNRVNFU19DT1JUT1NbbSAtIDFdICsgJyAnICsgcy5zbGljZSgyLCA0KTtcbn1cblxuZnVuY3Rpb24gX2Vycm9yTWVzc2FnZSgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBtdiA9IHdpbmRvdy5fX3BoYXNlMCAmJiB3aW5kb3cuX19waGFzZTAucHVyZSAmJiB3aW5kb3cuX19waGFzZTAucHVyZS5tZW5zYWplc1ZlbmRlZG9yO1xuICAgIGlmIChtdiAmJiB0eXBlb2YgbXYuZm9ybWF0TWVuc2FqZUNvbkNvZGlnbyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIG12LmZvcm1hdE1lbnNhamVDb25Db2RpZ28oJ0RBU0hCT0FSRF9WRU5UQVNfRkFJTEVEJyk7XG4gICAgfVxuICB9IGNhdGNoIChfZSkge31cbiAgLy8gRmFsbGJhY2sgXHUwMEE3Njggc2kgZWwgYnVuZGxlIG5vIGNhcmdcdTAwRjMgKFNXIHN0YWxlKS5cbiAgcmV0dXJuIChcbiAgICAnTm8gcHVkaW1vcyBjYXJnYXIgZWwgdGFibGVybyBkZSB2ZW50YXMuIFZvbHZcdTAwRTkgYSBpbnRlbnRhciBlbiB1biBtaW51dG87IHNpIHNpZ3VlIHBhc2FuZG8sIGF2aXNhbGUgYSBNYXJpYW5vLicgK1xuICAgICdcXG5cXG5DXHUwMEYzZGlnbyB0XHUwMEU5Y25pY286IERBU0hCT0FSRF9WRU5UQVNfRkFJTEVEJ1xuICApO1xufVxuXG4vLyBQbHVnaW4gcHJvcGlvIChzaW4gbGlicmVyXHUwMEVEYSBudWV2YSk6IGRpYnVqYSBlbCB2YWxvciBhbCBmaW5hbCBkZSBjYWRhIGJhcnJhLlxuLy8gRWwgZm9ybWF0ZWFkb3IgdmllbmUgZW4gb3B0aW9ucy5wbHVnaW5zLmR2RGF0YUxhYmVscy5mbXQ7IHNvbG8gYWN0XHUwMEZBYSBlbiAnYmFyJy5cbmxldCBkdlBsdWdpblJlZ2lzdHJhZG8gPSBmYWxzZTtcbmNvbnN0IGR2RGF0YUxhYmVscyA9IHtcbiAgaWQ6ICdkdkRhdGFMYWJlbHMnLFxuICBhZnRlckRhdGFzZXRzRHJhdyhjaGFydCkge1xuICAgIGlmIChjaGFydC5jb25maWcudHlwZSAhPT0gJ2JhcicpIHJldHVybjtcbiAgICBjb25zdCBvcHRzID0gKGNoYXJ0Lm9wdGlvbnMucGx1Z2lucyAmJiBjaGFydC5vcHRpb25zLnBsdWdpbnMuZHZEYXRhTGFiZWxzKSB8fCB7fTtcbiAgICBpZiAodHlwZW9mIG9wdHMuZm10ICE9PSAnZnVuY3Rpb24nKSByZXR1cm47XG4gICAgY29uc3QgZGFyayA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGhlbWUnKSA9PT0gJ2RhcmsnO1xuICAgIGNvbnN0IGN0eCA9IGNoYXJ0LmN0eDtcbiAgICBjdHguc2F2ZSgpO1xuICAgIGN0eC5mb250ID0gJzExcHggJyArIENIQVJUX0ZPTlQ7XG4gICAgY3R4LmZpbGxTdHlsZSA9IGRhcmsgPyAnI2U1ZTdlYicgOiAnIzFmMjkzNyc7XG4gICAgY3R4LnRleHRCYXNlbGluZSA9ICdtaWRkbGUnO1xuICAgIGNoYXJ0LmRhdGEuZGF0YXNldHMuZm9yRWFjaCgoZHMsIGRpKSA9PiB7XG4gICAgICBjb25zdCBtZXRhID0gY2hhcnQuZ2V0RGF0YXNldE1ldGEoZGkpO1xuICAgICAgbWV0YS5kYXRhLmZvckVhY2goKGJhciwgaSkgPT4ge1xuICAgICAgICBjb25zdCB2ID0gZHMuZGF0YVtpXTtcbiAgICAgICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuO1xuICAgICAgICBjb25zdCB0eHQgPSBTdHJpbmcob3B0cy5mbXQodiwgaSkpO1xuICAgICAgICBjb25zdCBob3Jpem9udGFsID0gY2hhcnQub3B0aW9ucy5pbmRleEF4aXMgPT09ICd5JztcbiAgICAgICAgaWYgKGhvcml6b250YWwpIHtcbiAgICAgICAgICBjdHgudGV4dEFsaWduID0gJ2xlZnQnO1xuICAgICAgICAgIGN0eC5maWxsVGV4dCh0eHQsIGJhci54ICsgNCwgYmFyLnkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN0eC50ZXh0QWxpZ24gPSAnY2VudGVyJztcbiAgICAgICAgICBjdHguZmlsbFRleHQodHh0LCBiYXIueCwgYmFyLnkgLSA4KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfSxcbn07XG5cbmZ1bmN0aW9uIF9yZWdpc3RyYXJQbHVnaW5zKENoYXJ0KSB7XG4gIGlmIChkdlBsdWdpblJlZ2lzdHJhZG8gfHwgIUNoYXJ0IHx8IHR5cGVvZiBDaGFydC5yZWdpc3RlciAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuO1xuICBDaGFydC5yZWdpc3RlcihkdkRhdGFMYWJlbHMpO1xuICBkdlBsdWdpblJlZ2lzdHJhZG8gPSB0cnVlO1xufVxuXG5mdW5jdGlvbiBfbG9hZENoYXJ0SnMoKSB7XG4gIGlmICh3aW5kb3cuQ2hhcnQpIHtcbiAgICBfcmVnaXN0cmFyUGx1Z2lucyh3aW5kb3cuQ2hhcnQpO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUod2luZG93LkNoYXJ0KTtcbiAgfVxuICBpZiAoY2hhcnRKc1Byb21pc2UpIHJldHVybiBjaGFydEpzUHJvbWlzZTtcbiAgY2hhcnRKc1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHMuc3JjID0gQ0hBUlRfSlNfVVJMO1xuICAgIHMuYXN5bmMgPSB0cnVlO1xuICAgIHMub25sb2FkID0gKCkgPT4ge1xuICAgICAgaWYgKCF3aW5kb3cuQ2hhcnQpIHJldHVybiByZWplY3QobmV3IEVycm9yKCdDaGFydC5qcyBzaW4gZ2xvYmFsJykpO1xuICAgICAgX3JlZ2lzdHJhclBsdWdpbnMod2luZG93LkNoYXJ0KTtcbiAgICAgIHJlc29sdmUod2luZG93LkNoYXJ0KTtcbiAgICB9O1xuICAgIHMub25lcnJvciA9ICgpID0+IHtcbiAgICAgIGNoYXJ0SnNQcm9taXNlID0gbnVsbDtcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoJ25vIHNlIHB1ZG8gY2FyZ2FyIENoYXJ0LmpzJykpO1xuICAgIH07XG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKTtcbiAgfSk7XG4gIHJldHVybiBjaGFydEpzUHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gX2Rlc3Ryb3lDaGFydHMoKSB7XG4gIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhjaGFydHMpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoYXJ0c1trXS5kZXN0cm95KCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgZGVsZXRlIGNoYXJ0c1trXTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9wY2lvbmVzIGRlIGZpbHRyb3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRGV2dWVsdmUgW3t2YWx1ZSxsYWJlbH1dIGRlIGxhIG9wY2lcdTAwRjNuIGBrZXlgIGRlIGxhIFx1MDBGQWx0aW1hIHJlc3B1ZXN0YS4gKi9cbmZ1bmN0aW9uIF9vcGNpb25lc0RlKGtleSkge1xuICBjb25zdCBvcCA9IHN0YXRlLm9wY2lvbmVzIHx8IHt9O1xuICBjb25zdCBhcnIgPSBBcnJheS5pc0FycmF5KG9wW2tleV0pID8gb3Bba2V5XSA6IFtdO1xuICBpZiAoa2V5ID09PSAnY2xpZW50ZXMnKSB7XG4gICAgcmV0dXJuIGFyci5tYXAoKGMpID0+ICh7XG4gICAgICB2YWx1ZTogU3RyaW5nKGMuY29kZSksXG4gICAgICBsYWJlbDogU3RyaW5nKGMubmFtZSB8fCBjLmNvZGUpICsgJyAoJyArIFN0cmluZyhjLmNvZGUpICsgJyknLFxuICAgIH0pKTtcbiAgfVxuICBpZiAoa2V5ID09PSAnc2t1cycpIHtcbiAgICByZXR1cm4gYXJyLm1hcCgocykgPT4gKHtcbiAgICAgIHZhbHVlOiBTdHJpbmcocy5jb2RlKSxcbiAgICAgIGxhYmVsOiBTdHJpbmcocy5jb2RlKSArIChzLmRlc2MgPyAnIC0gJyArIFN0cmluZyhzLmRlc2MpIDogJycpLFxuICAgIH0pKTtcbiAgfVxuICByZXR1cm4gYXJyLm1hcCgodikgPT4gKHsgdmFsdWU6IFN0cmluZyh2KSwgbGFiZWw6IFN0cmluZyh2KSB9KSk7XG59XG5cbmZ1bmN0aW9uIF9yZXN1bWVuU2VsKGtleSwgb3BjaW9uZXMpIHtcbiAgY29uc3QgbiA9IHN0YXRlLnNlbFtrZXldLmxlbmd0aDtcbiAgaWYgKG4gPT09IDApIHJldHVybiAnVG9kb3MnO1xuICBpZiAobiA9PT0gMSkge1xuICAgIGNvbnN0IG8gPSBvcGNpb25lcy5maW5kKCh4KSA9PiB4LnZhbHVlID09PSBzdGF0ZS5zZWxba2V5XVswXSk7XG4gICAgcmV0dXJuIG8gPyBvLmxhYmVsIDogc3RhdGUuc2VsW2tleV1bMF07XG4gIH1cbiAgcmV0dXJuIG4gKyAnIHNlbGVjY2lvbmFkb3MnO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyRmlsdHJvKGRlZikge1xuICBpZiAoZGVmLmtleSA9PT0gJ3ZlbmRlZG9yZXMnICYmIF9pc1ZlbmRlZG9yKCkpIHtcbiAgICByZXR1cm4gKFxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+JyArXG4gICAgICBfZXNjSHRtbChkZWYubGFiZWwpICtcbiAgICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwiZHYtbXMtbG9ja2VkXCIgdGl0bGU9XCJWZXMgc29sbyB0dXMgY2xpZW50ZXNcIj4nICtcbiAgICAgIF9lc2NIdG1sKF9teVZlbmRvcigpIHx8ICdUdXMgY2xpZW50ZXMnKSArXG4gICAgICAnIFx1RDgzRFx1REQxMjwvZGl2PjwvZGl2PidcbiAgICApO1xuICB9XG4gIGNvbnN0IG9wY2lvbmVzID0gX29wY2lvbmVzRGUoZGVmLmtleSk7XG4gIGNvbnN0IHNlbGVjdGVkID0gbmV3IFNldChzdGF0ZS5zZWxbZGVmLmtleV0pO1xuICBsZXQgbGlzdCA9ICcnO1xuICBmb3IgKGNvbnN0IG8gb2Ygb3BjaW9uZXMpIHtcbiAgICBsaXN0ICs9XG4gICAgICAnPGxhYmVsIGNsYXNzPVwiZHYtbXMtb3B0XCIgZGF0YS1zZWFyY2g9XCInICtcbiAgICAgIF9lc2NIdG1sKG8ubGFiZWwudG9Mb3dlckNhc2UoKSkgK1xuICAgICAgJ1wiPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBkYXRhLWZpbHRybz1cIicgK1xuICAgICAgZGVmLmtleSArXG4gICAgICAnXCIgdmFsdWU9XCInICtcbiAgICAgIF9lc2NIdG1sKG8udmFsdWUpICtcbiAgICAgICdcIicgK1xuICAgICAgKHNlbGVjdGVkLmhhcyhvLnZhbHVlKSA/ICcgY2hlY2tlZCcgOiAnJykgK1xuICAgICAgJz4gPHNwYW4+JyArXG4gICAgICBfZXNjSHRtbChvLmxhYmVsKSArXG4gICAgICAnPC9zcGFuPjwvbGFiZWw+JztcbiAgfVxuICBpZiAoIWxpc3QpIGxpc3QgPSAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCIgc3R5bGU9XCJwYWRkaW5nOjZweFwiPlNpbiBvcGNpb25lcyB0b2Rhdlx1MDBFRGEuPC9kaXY+JztcbiAgcmV0dXJuIChcbiAgICAnPGRpdiBjbGFzcz1cImR2LWZpbHRyb1wiPjxkaXYgY2xhc3M9XCJkdi1maWx0cm8tbGFiZWxcIj4nICtcbiAgICBfZXNjSHRtbChkZWYubGFiZWwpICtcbiAgICAnPC9kaXY+PGRldGFpbHMgY2xhc3M9XCJkdi1tc1wiIGRhdGEtbXM9XCInICtcbiAgICBkZWYua2V5ICtcbiAgICAnXCI+PHN1bW1hcnk+JyArXG4gICAgX2VzY0h0bWwoX3Jlc3VtZW5TZWwoZGVmLmtleSwgb3BjaW9uZXMpKSArXG4gICAgJzwvc3VtbWFyeT48ZGl2IGNsYXNzPVwiZHYtbXMtcG9wXCI+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2Nhclx1MjAyNlwiIGRhdGEtbXMtc2VhcmNoPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtbXMtYWN0aW9uc1wiPjxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtbGlua1wiIGRhdGEtbXMtY2xlYXI9XCInICtcbiAgICBkZWYua2V5ICtcbiAgICAnXCI+TGltcGlhcjwvYnV0dG9uPjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtbXMtbGlzdFwiPicgK1xuICAgIGxpc3QgK1xuICAgICc8L2Rpdj48L2Rpdj48L2RldGFpbHM+PC9kaXY+J1xuICApO1xufVxuXG4vKiogTGVlIGRlbCBET00gbG8gcXVlIGVsIHVzdWFyaW8gbWFyY1x1MDBGMy4gU29sbyBzZSBsbGFtYSBhbCB0b2NhciBcIkFwbGljYXJcIi4gKi9cbmZ1bmN0aW9uIF9yZWFkU2VsRnJvbURvbShyb290KSB7XG4gIGNvbnN0IG5leHQgPSBfc2VsVmFjaWEoKTtcbiAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl1bZGF0YS1maWx0cm9dJykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICBjb25zdCBrZXkgPSBlbC5nZXRBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJyk7XG4gICAgaWYgKGVsLmNoZWNrZWQgJiYgbmV4dFtrZXldKSBuZXh0W2tleV0ucHVzaChlbC52YWx1ZSk7XG4gIH0pO1xuICBpZiAoX2lzVmVuZGVkb3IoKSkgbmV4dC52ZW5kZWRvcmVzID0gW107XG4gIHN0YXRlLnNlbCA9IG5leHQ7XG4gIGNvbnN0IG1lc0VsID0gcm9vdC5xdWVyeVNlbGVjdG9yKCcjZHYtbWVzJyk7XG4gIGlmIChtZXNFbCAmJiAvXlxcZHs0fS1cXGR7Mn0kLy50ZXN0KG1lc0VsLnZhbHVlKSkgc3RhdGUubWVzID0gbWVzRWwudmFsdWU7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEFybWEgZWwgZXNxdWVsZXRvIChmaWx0cm9zIGFycmliYSwgcmVzdWx0YWRvcyBhYmFqbykgdW5hIHNvbGEgdmV6LiAqL1xuZnVuY3Rpb24gX2Vuc3VyZVNrZWxldG9uKCkge1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtYm9keScpO1xuICBpZiAoIWJvZHkpIHJldHVybiBudWxsO1xuICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zLWhvc3QnKSB8fCAhZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKSkge1xuICAgIGJvZHkuaW5uZXJIVE1MID0gJzxkaXYgaWQ9XCJkdi1maWx0cm9zLWhvc3RcIj48L2Rpdj48ZGl2IGlkPVwiZHYtcmVzdWx0c1wiPjwvZGl2Pic7XG4gICAgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9IG51bGw7XG4gIH1cbiAgcmV0dXJuIGJvZHk7XG59XG5cbi8qKlxuICogUGFuZWwgZGUgZmlsdHJvcy4gU2UgcmUtYXJtYSBzb2xvIGN1YW5kbyBjYW1iaWFuIGxhcyBvcGNpb25lcyAodW5hIHZleiBwb3JcbiAqIHJlc3B1ZXN0YSksIGFsIHJlc2V0ZWFyIHBvciBjYW1iaW8gZGUgdXN1YXJpbyBvIGNvbiBcIkxpbXBpYXIgZmlsdHJvc1wiLiBOaSBlbFxuICogXCJDYXJnYW5kb1x1MjAyNlwiIG5pIFwiVmVyIG1cdTAwRTFzXCIgbG8gdG9jYW4sIGFzXHUwMEVEIG5vIHNlIHBpZXJkZW4gY2FtYmlvcyBzaW4gYXBsaWNhci5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyRmlsdHJvcyhmb3JjZSkge1xuICBjb25zdCBob3N0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWZpbHRyb3MtaG9zdCcpO1xuICBpZiAoIWhvc3QpIHJldHVybjtcbiAgaWYgKCFmb3JjZSAmJiBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID09PSBzdGF0ZS5vcGNpb25lcyAmJiBob3N0LmlubmVySFRNTCkgcmV0dXJuO1xuICBjb25zdCBwcmV2ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWZpbHRyb3MnKTtcbiAgY29uc3QgYWJpZXJ0byA9IHByZXYgPyAhIXByZXYub3BlbiA6IHdpbmRvdy5pbm5lcldpZHRoID4gNzAwO1xuICBsZXQgaHRtbCA9ICc8ZGV0YWlscyBjbGFzcz1cImR2LWZpbHRyb3NcIiBpZD1cImR2LWZpbHRyb3NcIicgKyAoYWJpZXJ0byA/ICcgb3BlbicgOiAnJykgKyAnPic7XG4gIGh0bWwgKz0gJzxzdW1tYXJ5PkZpbHRyb3M8L3N1bW1hcnk+PGRpdiBjbGFzcz1cImR2LWZpbHRyb3MtZ3JpZFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWZpbHRyb1wiPjxkaXYgY2xhc3M9XCJkdi1maWx0cm8tbGFiZWxcIj5NZXM8L2Rpdj48aW5wdXQgdHlwZT1cIm1vbnRoXCIgaWQ9XCJkdi1tZXNcIiBjbGFzcz1cImR2LWlucHV0XCIgdmFsdWU9XCInICtcbiAgICBfZXNjSHRtbChzdGF0ZS5tZXMpICtcbiAgICAnXCI+PC9kaXY+JztcbiAgZm9yIChjb25zdCBkZWYgb2YgRklMVFJPU19ERUYpIGh0bWwgKz0gX3JlbmRlckZpbHRybyhkZWYpO1xuICBodG1sICs9ICc8L2Rpdj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvcy1hY3Rpb25zXCI+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWJ0bi1zZWNvbmRhcnlcIiBkYXRhLWR2LWFjdGlvbj1cImxpbXBpYXJcIj5MaW1waWFyIGZpbHRyb3M8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1idG4tcHJpbWFyeVwiIGlkPVwiZHYtYXBsaWNhclwiIGRhdGEtZHYtYWN0aW9uPVwiYXBsaWNhclwiJyArXG4gICAgKHN0YXRlLmxvYWRpbmcgPyAnIGRpc2FibGVkJyA6ICcnKSArXG4gICAgJz5BcGxpY2FyPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+PC9kZXRhaWxzPic7XG4gIGhvc3QuaW5uZXJIVE1MID0gaHRtbDtcbiAgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9IHN0YXRlLm9wY2lvbmVzO1xufVxuXG5mdW5jdGlvbiBfc3luY0FwbGljYXJEaXNhYmxlZCgpIHtcbiAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWFwbGljYXInKTtcbiAgaWYgKGJ0bikgYnRuLmRpc2FibGVkID0gISFzdGF0ZS5sb2FkaW5nO1xufVxuXG5mdW5jdGlvbiBfY2FyZCh0aXR1bG8sIHZhbG9yKSB7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1jYXJkXCI+PGRpdiBjbGFzcz1cImR2LWNhcmQtdGl0bGVcIj4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LWNhcmQtdmFsdWVcIj4nICtcbiAgICBfZXNjSHRtbCh2YWxvcikgK1xuICAgICc8L2Rpdj48L2Rpdj4nXG4gICk7XG59XG5cbi8vIFBvcmNlbnRhamUgY29uIGNvbWEgZGVjaW1hbCAoZXMtQVIpOiA4MCw1JVxuZnVuY3Rpb24gX2ZtdFBjdChuKSB7XG4gIHJldHVybiAoXG4gICAgKE51bWJlcihuKSB8fCAwKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7XG4gICAgICBtaW5pbXVtRnJhY3Rpb25EaWdpdHM6IDAsXG4gICAgICBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEsXG4gICAgfSkgKyAnJSdcbiAgKTtcbn1cblxuLy8gQUFBQS1NTS1ERCAtPiBERC9NTS9BQUFBIChzaSBubyB0aWVuZSBlc2UgZm9ybWF0bywgc2UgZGV2dWVsdmUgdGFsIGN1YWwpXG5mdW5jdGlvbiBfZm10RmVjaGEoZikge1xuICBjb25zdCBtID0gL14oXFxkezR9KS0oXFxkezJ9KS0oXFxkezJ9KS8uZXhlYyhTdHJpbmcoZiA9PSBudWxsID8gJycgOiBmKSk7XG4gIHJldHVybiBtID8gbVszXSArICcvJyArIG1bMl0gKyAnLycgKyBtWzFdIDogU3RyaW5nKGYgPT0gbnVsbCA/ICcnIDogZik7XG59XG5cbmZ1bmN0aW9uIF90aXBvTGFiZWwodCkge1xuICByZXR1cm4gdCA9PT0gJ3Zpc2l0YScgPyAnVmlzaXRhJyA6ICdDb250YWN0byc7XG59XG5cbi8vIFRhYmxhIGRlIGludGVyYWNjaW9uZXMgKHNvbG8gZWwgY29udGVuZWRvciBjb24gc2Nyb2xsOyBzZSByZWVtcGxhemEgYWwgYnVzY2FyKS5cbmZ1bmN0aW9uIF9pbnRlcmFjY2lvbmVzVGFibGEocm93cywgdG90YWwsIHF1ZXJ5KSB7XG4gIGNvbnN0IHEgPSBTdHJpbmcocXVlcnkgfHwgJycpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAudHJpbSgpO1xuICBjb25zdCBsaXN0YSA9IEFycmF5LmlzQXJyYXkocm93cykgPyByb3dzIDogW107XG4gIGNvbnN0IGZpbHRlcmVkID0gcVxuICAgID8gbGlzdGEuZmlsdGVyKChyKSA9PlxuICAgICAgICAoXG4gICAgICAgICAgU3RyaW5nKHIuY2xpZW50ZSkgK1xuICAgICAgICAgICcgJyArXG4gICAgICAgICAgX2ZtdEZlY2hhKHIuZmVjaGEpICtcbiAgICAgICAgICAnICcgK1xuICAgICAgICAgIFN0cmluZyhyLnZlbmRlZG9yKSArXG4gICAgICAgICAgJyAnICtcbiAgICAgICAgICBfdGlwb0xhYmVsKHIudGlwbylcbiAgICAgICAgKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgLmluY2x1ZGVzKHEpXG4gICAgICApXG4gICAgOiBsaXN0YTtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdGFibGUtd3JhcCBkdi1pbnRlci13cmFwXCI+PHRhYmxlIGNsYXNzPVwiZHYtdGFibGVcIj48dGhlYWQ+PHRyPjx0aD5DbGllbnRlPC90aD48dGg+RmVjaGE8L3RoPjx0aD5WZW5kZWRvcjwvdGg+PHRoPlRpcG88L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+JztcbiAgZm9yIChjb25zdCByIG9mIGZpbHRlcmVkKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzx0cj48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmNsaWVudGUpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRGZWNoYShyLmZlY2hhKSkgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoci52ZW5kZWRvcikgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoX3RpcG9MYWJlbChyLnRpcG8pKSArXG4gICAgICAnPC90ZD48L3RyPic7XG4gIH1cbiAgaWYgKGZpbHRlcmVkLmxlbmd0aCA9PT0gMClcbiAgICBodG1sICs9ICc8dHI+PHRkIGNvbHNwYW49XCI0XCIgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiByZXN1bHRhZG9zLjwvdGQ+PC90cj4nO1xuICBodG1sICs9ICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcbiAgY29uc3QgdG90YWxOID0gTnVtYmVyKHRvdGFsKSB8fCAwO1xuICBpZiAodG90YWxOID4gbGlzdGEubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPk1vc3RyYW5kbyAnICtcbiAgICAgIF9lc2NIdG1sKF9mbXRVZHMobGlzdGEubGVuZ3RoKSkgK1xuICAgICAgJyBkZSAnICtcbiAgICAgIF9lc2NIdG1sKF9mbXRVZHModG90YWxOKSkgK1xuICAgICAgJzwvZGl2Pic7XG4gIH1cbiAgcmV0dXJuIGh0bWw7XG59XG5cbi8qKiBUYWJsYSBkZSBpbnRlcmFjY2lvbmVzIGNvbiBidXNjYWRvci4gRWwgdGV4dG8gYnVzY2FkbyBzZSBwb25lIHBvciBET00uICovXG5mdW5jdGlvbiBfaW50ZXJhY2Npb25lc1NlY3Rpb24odCwgcXVlcnkpIHtcbiAgY29uc3Qgcm93cyA9ICh0ICYmIHQucm93cykgfHwgW107XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtaW50ZXJhY2Npb25lc1wiPjxkaXYgY2xhc3M9XCJkdi1zZWN0aW9uLWhlYWRcIj48aDM+SW50ZXJhY2Npb25lczwvaDM+PC9kaXY+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBpZD1cImR2LWludGVyYWNjaW9uZXMtYnVzY2FyXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXIgY2xpZW50ZSwgdmVuZGVkb3IgbyB0aXBvXHUyMDI2XCI+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1pbnRlci1ib2R5XCI+JyArXG4gICAgX2ludGVyYWNjaW9uZXNUYWJsYShyb3dzLCB0ICYmIHQudG90YWwsIHF1ZXJ5KSArXG4gICAgJzwvZGl2Pjwvc2VjdGlvbj4nXG4gICk7XG59XG5cbi8qKiBCbG9xdWUgZGUgZ2VzdGlcdTAwRjNuOiB0YXJqZXRhcyArIG5vdGEgKyB0YWJsYSBkZSBpbnRlcmFjY2lvbmVzLiAqL1xuZnVuY3Rpb24gX2dlc3Rpb25TZWN0aW9uKGcsIHNlY2Npb25lcywgcXVlcnkpIHtcbiAgaWYgKCFnIHx8IChzZWNjaW9uZXMgJiYgc2VjY2lvbmVzLmdlc3Rpb24gJiYgc2VjY2lvbmVzLmdlc3Rpb24uZXJyb3IpKSB7XG4gICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwiZHYtY2FyZHNcIiBpZD1cImR2LWdlc3Rpb25cIj4nICsgX2NhcmQoJ0dlc3RpXHUwMEYzbicsICdObyBkaXNwb25pYmxlJykgKyAnPC9kaXY+JztcbiAgfVxuICBsZXQgaHRtbCA9ICc8ZGl2IGNsYXNzPVwiZHYtY2FyZHNcIiBpZD1cImR2LWdlc3Rpb25cIj4nO1xuICBodG1sICs9IF9jYXJkKCdUYXJnZXQnLCBnLnRhcmdldCA9PSBudWxsID8gJ1NpbiB0YXJnZXQnIDogX2ZtdEFycyhnLnRhcmdldCkpO1xuICBodG1sICs9IF9jYXJkKFxuICAgICclIGN1bXBsaW1pZW50bycsXG4gICAgZy5jdW1wbGltaWVudG9QY3QgPT0gbnVsbCA/ICdTaW4gdGFyZ2V0JyA6IF9mbXRQY3QoZy5jdW1wbGltaWVudG9QY3QpXG4gICk7XG4gIGh0bWwgKz0gX2NhcmQoJ1JlbmRpY2lvbmVzIFx1MjAxMyBtb250bycsIF9mbXRBcnMoZy5yZW5kaWNpb25lc0FycykpO1xuICBodG1sICs9IF9jYXJkKCdCYXNlIGFjdGl2YScsIF9mbXRVZHMoZy5iYXNlQWN0aXZhKSk7XG4gIGh0bWwgKz0gX2NhcmQoJ1RpY2tldCBwcm9tZWRpbycsIF9mbXRBcnMoZy50aWNrZXRQcm9tZWRpbykpO1xuICBodG1sICs9IF9jYXJkKCdOXHUwMEIwIHZpc2l0YXMnLCBfZm10VWRzKGcudmlzaXRhcykpO1xuICBodG1sICs9IF9jYXJkKCdOXHUwMEIwIGNvbnRhY3RhZG9zJywgX2ZtdFVkcyhnLmNvbnRhY3RhZG9zKSk7XG4gIGh0bWwgKz0gX2NhcmQoJ05cdTAwQjAgaW50ZXJhY2Npb25lcycsIF9mbXRVZHMoZy5pbnRlcmFjY2lvbmVzKSk7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmIChnLmZpbHRyb3NOb0FwbGljYW4pIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGEgZHYtbXV0ZWRcIj5UYXJnZXQgeSByZW5kaWNpb25lcyBubyBzZSBmaWx0cmFuIHBvciBjbGllbnRlIG5pIHByb2R1Y3RvOyB2aXNpdGFzIHkgY29udGFjdG9zIG5vIHNlIGZpbHRyYW4gcG9yIHByb2R1Y3RvLjwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPSBfaW50ZXJhY2Npb25lc1NlY3Rpb24oZy50YWJsYUludGVyYWNjaW9uZXMsIHF1ZXJ5KTtcbiAgcmV0dXJuIGh0bWw7XG59XG5cbi8vIFRpcG9zIHBlcm1pdGlkb3MgZGVsIFwiVmVyIG1cdTAwRTFzXCI6IGxpc3RhIGJsYW5jYSAoZWwgYXRyaWJ1dG8gZGVsIERPTSBudW5jYSBzZSByZXVzYSBlbiBlbCBIVE1MKS5cbmZ1bmN0aW9uIF90aXBvVmVyTWFzKHRpcG9Jbikge1xuICByZXR1cm4gdGlwb0luID09PSAnZGluZXJvJyA/ICdkaW5lcm8nIDogdGlwb0luID09PSAnY2xpZW50ZXMnID8gJ2NsaWVudGVzJyA6ICd1bmlkYWRlcyc7XG59XG5cbmZ1bmN0aW9uIF92ZXJNYXNUYWJsYSh0aXBvSW4sIHJvd3MpIHtcbiAgY29uc3QgdGlwbyA9IF90aXBvVmVyTWFzKHRpcG9Jbik7XG4gIGNvbnN0IHEgPSBzdGF0ZS52ZXJNYXNRdWVyeVt0aXBvXS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgY29uc3QgZXNDbGkgPSB0aXBvID09PSAnY2xpZW50ZXMnO1xuICAvLyBQb3NpY2lcdTAwRjNuIGRlbCByYW5raW5nIGNhbGN1bGFkYSB1bmEgc29sYSB2ZXogKHNpbiBpbmRleE9mIHBvciBmaWxhKS5cbiAgY29uc3QgcmFua2VkID0gcm93cy5tYXAoKHIsIGkpID0+ICh7IHIsIHBvczogaSArIDEgfSkpO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IHJhbmtlZC5maWx0ZXIoKHgpID0+XG4gICAgICAgIChlc0NsaVxuICAgICAgICAgID8gU3RyaW5nKHguci5ub21icmUpICsgJyAnICsgU3RyaW5nKHguci5jb2RlKVxuICAgICAgICAgIDogU3RyaW5nKHguci5za3UpICsgJyAnICsgU3RyaW5nKHguci5kZXNjIHx8ICcnKVxuICAgICAgICApXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAuaW5jbHVkZXMocSlcbiAgICAgIClcbiAgICA6IHJhbmtlZDtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdmVybWFzXCI+PGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiJyArXG4gICAgKGVzQ2xpID8gJ0J1c2NhciBjbGllbnRlXHUyMDI2JyA6ICdCdXNjYXIgU0tVIG8gZGVzY3JpcGNpXHUwMEYzblx1MjAyNicpICtcbiAgICAnXCIgZGF0YS12ZXJtYXMtc2VhcmNoPVwiJyArXG4gICAgdGlwbyArXG4gICAgJ1wiPjxkaXYgY2xhc3M9XCJkdi10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwiZHYtdGFibGVcIj48dGhlYWQ+PHRyPicgK1xuICAgIChlc0NsaVxuICAgICAgPyAnPHRoPiM8L3RoPjx0aD5DbGllbnRlPC90aD48dGggY2xhc3M9XCJudW1cIj5GYWN0dXJhZG88L3RoPidcbiAgICAgIDogJzx0aD4jPC90aD48dGg+U0tVPC90aD48dGg+RGVzY3JpcGNpXHUwMEYzbjwvdGg+PHRoIGNsYXNzPVwibnVtXCI+VW5pZGFkZXM8L3RoPjx0aCBjbGFzcz1cIm51bVwiPkRpbmVybzwvdGg+JykgK1xuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgeyByLCBwb3MgfSBvZiBmaWx0ZXJlZCkge1xuICAgIGlmIChlc0NsaSkge1xuICAgICAgaHRtbCArPVxuICAgICAgICAnPHRyPjx0ZD4nICtcbiAgICAgICAgcG9zICtcbiAgICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgICBfZXNjSHRtbChyLm5vbWJyZSkgK1xuICAgICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmZhY3R1cmFkbykpICtcbiAgICAgICAgJzwvdGQ+PC90cj4nO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKVxuICAgIGh0bWwgKz0gJzx0cj48dGQgY29sc3Bhbj1cIicgKyAoZXNDbGkgPyAzIDogNSkgKyAnXCIgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiByZXN1bHRhZG9zLjwvdGQ+PC90cj4nO1xuICBodG1sICs9ICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+PC9kaXY+JztcbiAgcmV0dXJuIGh0bWw7XG59XG5cbmZ1bmN0aW9uIF90b3BTZWN0aW9uKHRpcG8sIHRpdHVsbywgcm93cykge1xuICBjb25zdCBhYmllcnRvID0gc3RhdGUudmVyTWFzW3RpcG9dO1xuICBjb25zdCB0b3RhbCA9IHJvd3MubGVuZ3RoO1xuICBjb25zdCBoID0gTWF0aC5tYXgoMTIwLCBNYXRoLm1pbihUT1BfTiwgdG90YWwpICogMjIgKyA0MCk7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiPjxkaXYgY2xhc3M9XCJkdi1zZWN0aW9uLWhlYWRcIj48aDM+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvaDM+JyArXG4gICAgKHRvdGFsID4gMFxuICAgICAgPyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1saW5rXCIgZGF0YS12ZXJtYXM9XCInICtcbiAgICAgICAgdGlwbyArXG4gICAgICAgICdcIiBhcmlhLWV4cGFuZGVkPVwiJyArXG4gICAgICAgIChhYmllcnRvID8gJ3RydWUnIDogJ2ZhbHNlJykgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIChhYmllcnRvID8gJ1ZlciBtZW5vcycgOiAnVmVyIG1cdTAwRTFzJykgK1xuICAgICAgICAnICgnICtcbiAgICAgICAgdG90YWwgK1xuICAgICAgICAnKTwvYnV0dG9uPidcbiAgICAgIDogJycpICtcbiAgICAnPC9kaXY+JyArXG4gICAgKHRvdGFsID4gMFxuICAgICAgPyAnPGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6JyArXG4gICAgICAgIGggK1xuICAgICAgICAncHhcIj48Y2FudmFzIGlkPVwiZHYtY2hhcnQtdG9wLScgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArXG4gICAgICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICAgICAnXCI+PC9jYW52YXM+PC9kaXY+J1xuICAgICAgOiAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGRhdG9zLjwvZGl2PicpICtcbiAgICAoYWJpZXJ0byA/IF92ZXJNYXNUYWJsYSh0aXBvLCByb3dzKSA6ICcnKSArXG4gICAgJzwvc2VjdGlvbj4nXG4gICk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHJvZHVjdG9zLCBjb2JlcnR1cmEgeSBmYWN0dXJhY2lcdTAwRjNuIHBvciBjbGllbnRlIChlbnRyZWdhIEIpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgUFJPRFVDVE9TX01BWF9GSUxBUyA9IDIwMDtcbmNvbnN0IFBST0RVQ1RPU19ERUJPVU5DRV9NUyA9IDIwMDtcbi8vIE1lbW8gZGVsIHN0b2NrIHBvciBTS1U6IHNlIGxpbXBpYSBhbCByZW5kZXJpemFyIHJlc3VsdGFkb3MgeSBhbCBjYW1iaWFyIGRlIHVzdWFyaW8uXG5jb25zdCBfc3RvY2tNZW1vID0gbmV3IE1hcCgpO1xubGV0IF9wcm9kVGltZXIgPSBudWxsO1xuXG4vKiogU3RvY2sgZGUgbGEgYXBwIHBhcmEgdW4gU0tVIChjb24gbWVtbykuIFRvZG8gbnVsbCBzaSBlbCBzdG9jayB0b2Rhdlx1MDBFRGEgbm8gY2FyZ1x1MDBGMyAoXCJcdTIwMjZcIikuICovXG5mdW5jdGlvbiBfc3RvY2tDb2x1bW5hcyhza3UpIHtcbiAgY29uc3QgayA9IFN0cmluZyhza3UpO1xuICBpZiAoX3N0b2NrTWVtby5oYXMoaykpIHJldHVybiBfc3RvY2tNZW1vLmdldChrKTtcbiAgY29uc3QgciA9IF9zdG9ja0NvbHVtbmFzQ2FsYyhza3UpO1xuICBfc3RvY2tNZW1vLnNldChrLCByKTtcbiAgcmV0dXJuIHI7XG59XG5cbmZ1bmN0aW9uIF9zdG9ja0NvbHVtbmFzQ2FsYyhza3UpIHtcbiAgY29uc3QgdmFjaW8gPSB7IHJlc2VydmFkYXM6IG51bGwsIGxpYnJlOiBudWxsLCBzdG9jazogbnVsbCB9O1xuICB0cnkge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJyB8fCB0eXBlb2Ygd2luZG93LmdldFN0b2NrQnJlYWtkb3duICE9PSAnZnVuY3Rpb24nKVxuICAgICAgcmV0dXJuIHZhY2lvO1xuICAgIC8vIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIGRldnVlbHZlIG51bGwgbWllbnRyYXMgZWwgc3RvY2sgbm8gZXN0XHUwMEUxIGNhcmdhZG8uXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmICh3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEoc2t1KSA9PT0gbnVsbCkgcmV0dXJuIHZhY2lvO1xuICAgIH1cbiAgICBjb25zdCBiID0gd2luZG93LmdldFN0b2NrQnJlYWtkb3duKHNrdSk7XG4gICAgaWYgKCFiKSByZXR1cm4gdmFjaW87XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlc2VydmFkYXM6IE51bWJlcihiLnJlc2VydmFkYXNUb3RhbCkgfHwgMCxcbiAgICAgIGxpYnJlOiBOdW1iZXIoYi5saWJyZSkgfHwgMCxcbiAgICAgIHN0b2NrOiBOdW1iZXIoYi5maXNpY29EZXAxMSkgfHwgMCxcbiAgICB9O1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB2YWNpbztcbiAgfVxufVxuXG5mdW5jdGlvbiBfZm10U3RvY2tDb2wobikge1xuICByZXR1cm4gbiA9PSBudWxsID8gJ1x1MjAyNicgOiBfZm10VWRzKG4pO1xufVxuXG4vKiogRXRpcXVldGEgZGUgY29iZXJ0dXJhOiBcIjM2IGRlIDY2IFx1MDBCNyA1NCw1NSVcIiAoY29tYSBkZWNpbWFsKTsgc2luIHBvcmNlbnRhamU6IFwiMzYgZGUgMCBcdTAwQjcgXHUyMDE0XCIuICovXG5mdW5jdGlvbiBfY29iZXJ0dXJhRXRpcXVldGEocikge1xuICBjb25zdCBwY3QgPVxuICAgIHIucGN0ID09IG51bGxcbiAgICAgID8gJ1x1MjAxNCdcbiAgICAgIDogKE51bWJlcihyLnBjdCkgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgICAgIG1pbmltdW1GcmFjdGlvbkRpZ2l0czogMCxcbiAgICAgICAgICBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDIsXG4gICAgICAgIH0pICsgJyUnO1xuICByZXR1cm4gKE51bWJlcihyLmNvbXByYXJvbikgfHwgMCkgKyAnIGRlICcgKyAoTnVtYmVyKHIuZGFkb3NBbHRhKSB8fCAwKSArICcgXHUwMEI3ICcgKyBwY3Q7XG59XG5cbi8qKiBUYWJsYSBkZSBwcm9kdWN0b3MgKHNvbG8gZWwgY29udGVuZWRvciBjb24gc2Nyb2xsOyBzZSByZWVtcGxhemEgYWwgYnVzY2FyKS4gKi9cbmZ1bmN0aW9uIF9wcm9kdWN0b3NUYWJsYShyb3dzLCBxdWVyeSkge1xuICBjb25zdCBxID0gU3RyaW5nKHF1ZXJ5IHx8ICcnKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnRyaW0oKTtcbiAgY29uc3QgbGlzdGEgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdO1xuICBjb25zdCBtYXRjaGVzID0gcVxuICAgID8gbGlzdGEuZmlsdGVyKChyKSA9PlxuICAgICAgICAoU3RyaW5nKHIuY2F0ZWdvcmlhKSArICcgJyArIFN0cmluZyhyLmZhbWlsaWEpICsgJyAnICsgU3RyaW5nKHIuc2t1KSlcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhxKVxuICAgICAgKVxuICAgIDogbGlzdGE7XG4gIGNvbnN0IGZpbHRlcmVkID0gbWF0Y2hlcy5zbGljZSgwLCBQUk9EVUNUT1NfTUFYX0ZJTEFTKTtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdGFibGUtd3JhcFwiPjx0YWJsZSBjbGFzcz1cImR2LXRhYmxlXCI+PHRoZWFkPjx0cj48dGg+Q0FURUdPUklBPC90aD48dGg+RkFNSUxJQTwvdGg+PHRoPlNLVTwvdGg+PHRoIGNsYXNzPVwibnVtXCI+VU5JREFERVMgVkVORElEQVM8L3RoPjx0aCBjbGFzcz1cIm51bVwiPkZBQ1RVUkFETzwvdGg+PHRoIGNsYXNzPVwibnVtXCI+VU5JREFERVMgQkFDS09SREVSPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBSRVNFUlZBREFTPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBMSUJSRSBQQVJBIExBIFZFTlRBPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBFTiBTVE9DSzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4nO1xuICBmb3IgKGNvbnN0IHIgb2YgZmlsdGVyZWQpIHtcbiAgICBjb25zdCBzdCA9IF9zdG9ja0NvbHVtbmFzKHIuc2t1KTtcbiAgICBodG1sICs9XG4gICAgICAnPHRyPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKHIuY2F0ZWdvcmlhKSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmZhbWlsaWEpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRVZHMoci51ZHNWZW5kaWRhcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmZhY3R1cmFkbykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkc0JhY2tvcmRlcikpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFN0b2NrQ29sKHN0LnJlc2VydmFkYXMpKSArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRTdG9ja0NvbChzdC5saWJyZSkpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFN0b2NrQ29sKHN0LnN0b2NrKSkgK1xuICAgICAgJzwvdGQ+PC90cj4nO1xuICB9XG4gIGlmIChmaWx0ZXJlZC5sZW5ndGggPT09IDApXG4gICAgaHRtbCArPSAnPHRyPjx0ZCBjb2xzcGFuPVwiOVwiIGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gcmVzdWx0YWRvcy48L3RkPjwvdHI+JztcbiAgaHRtbCArPSAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG4gIGlmIChtYXRjaGVzLmxlbmd0aCA+IGZpbHRlcmVkLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5Nb3N0cmFuZG8gJyArXG4gICAgICBQUk9EVUNUT1NfTUFYX0ZJTEFTICtcbiAgICAgICcgZGUgJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKG1hdGNoZXMubGVuZ3RoKSkgK1xuICAgICAgJy4gVXNcdTAwRTEgZWwgYnVzY2Fkb3IgcGFyYSB2ZXIgZWwgcmVzdG8uPC9kaXY+JztcbiAgfVxuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gX25vRGlzcG9uaWJsZShpZCwgdGl0dWxvKSB7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiJyArXG4gICAgaWQgK1xuICAgICdcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2gzPjwvZGl2PjxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPk5vIGRpc3BvbmlibGU8L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfcHJvZHVjdG9zU2VjdGlvbihyb3dzLCBzZWNjaW9uZXMsIHF1ZXJ5KSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyb3dzKSB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5wcm9kdWN0b3MgJiYgc2VjY2lvbmVzLnByb2R1Y3Rvcy5lcnJvcikpIHtcbiAgICByZXR1cm4gX25vRGlzcG9uaWJsZSgnZHYtcHJvZHVjdG9zJywgJ1Byb2R1Y3RvcycpO1xuICB9XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtcHJvZHVjdG9zXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz5Qcm9kdWN0b3M8L2gzPjwvZGl2PicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgaWQ9XCJkdi1wcm9kdWN0b3MtYnVzY2FyXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXIgY2F0ZWdvclx1MDBFRGEsIGZhbWlsaWEgbyBTS1VcdTIwMjZcIj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LXByb2QtYm9keVwiPicgK1xuICAgIF9wcm9kdWN0b3NUYWJsYShyb3dzLCBxdWVyeSkgK1xuICAgICc8L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfY29iZXJ0dXJhU2VjdGlvbihyb3dzLCBzZWNjaW9uZXMpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHJvd3MpIHx8IChzZWNjaW9uZXMgJiYgc2VjY2lvbmVzLmNvYmVydHVyYSAmJiBzZWNjaW9uZXMuY29iZXJ0dXJhLmVycm9yKSkge1xuICAgIHJldHVybiBfbm9EaXNwb25pYmxlKCdkdi1jb2JlcnR1cmEtY2hhcnQnLCAnQ29iZXJ0dXJhIGRlIGNsaWVudGVzJyk7XG4gIH1cbiAgY29uc3QgaCA9IE1hdGgubWF4KDEyMCwgcm93cy5sZW5ndGggKiA0NCArIDQwKTtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCIgaWQ9XCJkdi1jb2JlcnR1cmEtY2hhcnRcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkNvYmVydHVyYSBkZSBjbGllbnRlczwvaDM+PC9kaXY+JyArXG4gICAgKHJvd3MubGVuZ3RoID4gMFxuICAgICAgPyAnPGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6JyArXG4gICAgICAgIGggK1xuICAgICAgICAncHhcIj48Y2FudmFzIGlkPVwiZHYtY2FudmFzLWNvYmVydHVyYVwiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiQ29iZXJ0dXJhIGRlIGNsaWVudGVzXCI+PC9jYW52YXM+PC9kaXY+J1xuICAgICAgOiAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGRhdG9zLjwvZGl2PicpICtcbiAgICAnPC9zZWN0aW9uPidcbiAgKTtcbn1cblxuLy8gQ2FtcGFcdTAwRjFhczogdW5hIHRhcmpldGEgcG9yIGNhbXBhXHUwMEYxYSBjb24gdmVudGFzLCBvYmpldGl2byB5IGF2YW5jZS5cbmZ1bmN0aW9uIF9jYW1wYW5pYXNTZWN0aW9uKHJvd3MsIHNlY2Npb25lcykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkocm93cykgfHwgKHNlY2Npb25lcyAmJiBzZWNjaW9uZXMuY2FtcGFuaWFzICYmIHNlY2Npb25lcy5jYW1wYW5pYXMuZXJyb3IpKSB7XG4gICAgcmV0dXJuIF9ub0Rpc3BvbmlibGUoJ2R2LWNhbXBhbmlhcycsICdDYW1wYVx1MDBGMWFzJyk7XG4gIH1cbiAgbGV0IGN1ZXJwbyA9ICcnO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBjdWVycG8gPSAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGNhbXBhXHUwMEYxYXMgYWN0aXZhczwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgZm9yIChjb25zdCBjIG9mIHJvd3MpIHtcbiAgICAgIC8vIFNpbiBvYmpldGl2byBjYXJnYWRvIChudWxsIG8gMCkgbm8gc2UgbXVlc3RyYSBcIjAgdVwiIC8gXCIkMFwiLlxuICAgICAgY29uc3Qgc2luT2JqZXRpdm8gPSBjLm9iamV0aXZvID09IG51bGwgfHwgTnVtYmVyKGMub2JqZXRpdm8pID09PSAwO1xuICAgICAgY29uc3Qgb2JqZXRpdm8gPSBzaW5PYmpldGl2b1xuICAgICAgICA/ICdTaW4gb2JqZXRpdm8nXG4gICAgICAgIDogYy5vYmpldGl2b1RpcG8gPT09ICdtb25leSdcbiAgICAgICAgICA/IF9mbXRBcnMoYy5vYmpldGl2bylcbiAgICAgICAgICA6IF9mbXRVZHMoYy5vYmpldGl2bykgKyAnIHUnO1xuICAgICAgY29uc3QgcGN0ID0gYy5wY3QgPT0gbnVsbCA/IG51bGwgOiBOdW1iZXIoYy5wY3QpO1xuICAgICAgY29uc3QgYW5jaG8gPSBwY3QgPT0gbnVsbCA/IDAgOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHBjdCkpO1xuICAgICAgY3VlcnBvICs9XG4gICAgICAgICc8ZGl2IGNsYXNzPVwiZHYtY2FtcFwiPicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cImR2LWNhbXAtbm9tYnJlXCI+JyArXG4gICAgICAgIF9lc2NIdG1sKGMubm9tYnJlKSArXG4gICAgICAgICc8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJkdi1jYW1wLWZlY2hhc1wiPicgK1xuICAgICAgICBfZXNjSHRtbChfZm10RmVjaGEoYy5kZXNkZSkpICtcbiAgICAgICAgJyBhbCAnICtcbiAgICAgICAgX2VzY0h0bWwoX2ZtdEZlY2hhKGMuaGFzdGEpKSArXG4gICAgICAgICc8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgY2xhc3M9XCJkdi1jYW1wLWRhdG9zXCI+VmVuZGlkbzogJyArXG4gICAgICAgIF9lc2NIdG1sKF9mbXRVZHMoYy51ZHMpKSArXG4gICAgICAgICcgdSBcdTAwQjcgJyArXG4gICAgICAgIF9lc2NIdG1sKF9mbXRBcnMoYy5hcnMpKSArXG4gICAgICAgICcgXHUyMDE0IE9iamV0aXZvOiAnICtcbiAgICAgICAgX2VzY0h0bWwob2JqZXRpdm8pICtcbiAgICAgICAgJyBcdTIwMTQgJyArXG4gICAgICAgIF9lc2NIdG1sKHBjdCA9PSBudWxsID8gJ1x1MjAxNCcgOiBfZm10UGN0KHBjdCkpICtcbiAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cImR2LWNhbXAtYmFyXCI+PGRpdiBjbGFzcz1cImR2LWNhbXAtYmFyLWZpbGxcIiBzdHlsZT1cIndpZHRoOicgK1xuICAgICAgICBhbmNoby50b0ZpeGVkKDEpICtcbiAgICAgICAgJyVcIj48L2Rpdj48L2Rpdj4nICtcbiAgICAgICAgJzwvZGl2Pic7XG4gICAgfVxuICB9XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtY2FtcGFuaWFzXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz5DYW1wYVx1MDBGMWFzPC9oMz48L2Rpdj4nICtcbiAgICBjdWVycG8gK1xuICAgICc8L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfY2xpZW50ZXNTZWN0aW9uKHJvd3MsIHNlY2Npb25lcykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkocm93cykgfHwgKHNlY2Npb25lcyAmJiBzZWNjaW9uZXMuY2xpZW50ZXMgJiYgc2VjY2lvbmVzLmNsaWVudGVzLmVycm9yKSkge1xuICAgIHJldHVybiBfbm9EaXNwb25pYmxlKCdkdi1jbGllbnRlcy1jaGFydCcsICdGYWN0dXJhY2lcdTAwRjNuIHBvciBjbGllbnRlJyk7XG4gIH1cbiAgY29uc3QgYWJpZXJ0byA9IHN0YXRlLnZlck1hcy5jbGllbnRlcztcbiAgY29uc3QgdG90YWwgPSByb3dzLmxlbmd0aDtcbiAgY29uc3QgaCA9IE1hdGgubWF4KDEyMCwgTWF0aC5taW4oVE9QX04sIHRvdGFsKSAqIDIyICsgNDApO1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIiBpZD1cImR2LWNsaWVudGVzLWNoYXJ0XCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz5GYWN0dXJhY2lcdTAwRjNuIHBvciBjbGllbnRlIC0gVG9wIDIwPC9oMz4nICtcbiAgICAodG90YWwgPiAwXG4gICAgICA/ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWxpbmtcIiBkYXRhLXZlcm1hcz1cImNsaWVudGVzXCIgYXJpYS1leHBhbmRlZD1cIicgK1xuICAgICAgICAoYWJpZXJ0byA/ICd0cnVlJyA6ICdmYWxzZScpICtcbiAgICAgICAgJ1wiPicgK1xuICAgICAgICAoYWJpZXJ0byA/ICdWZXIgbWVub3MnIDogJ1ZlciBtXHUwMEUxcycpICtcbiAgICAgICAgJyAoJyArXG4gICAgICAgIHRvdGFsICtcbiAgICAgICAgJyk8L2J1dHRvbj4nXG4gICAgICA6ICcnKSArXG4gICAgJzwvZGl2PicgK1xuICAgICh0b3RhbCA+IDBcbiAgICAgID8gJzxkaXYgY2xhc3M9XCJkdi1jaGFydFwiIHN0eWxlPVwiaGVpZ2h0OicgK1xuICAgICAgICBoICtcbiAgICAgICAgJ3B4XCI+PGNhbnZhcyBpZD1cImR2LWNoYXJ0LXRvcC1jbGllbnRlc1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiRmFjdHVyYWNpXHUwMEYzbiBwb3IgY2xpZW50ZVwiPjwvY2FudmFzPjwvZGl2PidcbiAgICAgIDogJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiBkYXRvcy48L2Rpdj4nKSArXG4gICAgKGFiaWVydG8gPyBfdmVyTWFzVGFibGEoJ2NsaWVudGVzJywgcm93cykgOiAnJykgK1xuICAgICc8L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfbGluZVNlY3Rpb24oaWQsIHRpdHVsbykge1xuICByZXR1cm4gKFxuICAgICc8c2VjdGlvbiBjbGFzcz1cImR2LXNlY3Rpb25cIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2gzPjwvZGl2PjxkaXYgY2xhc3M9XCJkdi1jaGFydFwiIHN0eWxlPVwiaGVpZ2h0OjI0MHB4XCI+PGNhbnZhcyBpZD1cIicgK1xuICAgIGlkICtcbiAgICAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnXCI+PC9jYW52YXM+PC9kaXY+PC9zZWN0aW9uPidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX2lzRW1wdHkoZCkge1xuICBpZiAoIWQpIHJldHVybiB0cnVlO1xuICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICBjb25zdCBoYXlLcGkgPVxuICAgIE51bWJlcihrLmZhY3R1cmFkbykgfHwgTnVtYmVyKGsucGVkaWRvcykgfHwgTnVtYmVyKGsucGVkaWRvc1VuaWNvcykgfHwgTnVtYmVyKGsuYmFja29yZGVyQXJzKTtcbiAgY29uc3QgaGF5VG9wID0gQXJyYXkuaXNBcnJheShkLnRvcFVuaWRhZGVzKSAmJiBkLnRvcFVuaWRhZGVzLmxlbmd0aCA+IDA7XG4gIGNvbnN0IGhheVNlcmllID0gQXJyYXkuaXNBcnJheShkLnNlcmllVmVudGFzKSAmJiBkLnNlcmllVmVudGFzLnNvbWUoKHApID0+IE51bWJlcihwLnZhbG9yKSk7XG4gIHJldHVybiAhaGF5S3BpICYmICFoYXlUb3AgJiYgIWhheVNlcmllO1xufVxuXG4vKiogUmVzdWx0YWRvcyAobGV5ZW5kYSwgdGFyamV0YXMsIHJhbmtpbmdzLCBnclx1MDBFMWZpY29zKS4gTm8gdG9jYSBsb3MgZmlsdHJvcy4gKi9cbmZ1bmN0aW9uIHJlbmRlclJlc3VsdHMoKSB7XG4gIF9zdG9ja01lbW8uY2xlYXIoKTtcbiAgY29uc3Qgcm9vdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1yZXN1bHRzJyk7XG4gIGlmICghcm9vdCkgcmV0dXJuO1xuICBjb25zdCBkID0gc3RhdGUuZGF0YTtcblxuICBsZXQgaHRtbCA9XG4gICAgJzxkaXYgY2xhc3M9XCJkdi1sZXllbmRhXCI+TW9udG9zIHNpbiBJVkEsIGNvbiBkZXNjdWVudG8gYXBsaWNhZG8geSBub3RhcyBkZSBjclx1MDBFOWRpdG8gcmVzdGFkYXMuJztcbiAgaWYgKGQgJiYgZC5kYXRhVXBkYXRlZEF0ICYmICFzdGF0ZS5sb2FkaW5nKSB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKGQuZGF0YVVwZGF0ZWRBdCk7XG4gICAgaWYgKCFOdW1iZXIuaXNOYU4odC5nZXRUaW1lKCkpKSB7XG4gICAgICBodG1sICs9XG4gICAgICAgICcgPHNwYW4gY2xhc3M9XCJkdi1tdXRlZFwiPlx1MDBCNyBDYWxjdWxhZG8gJyArXG4gICAgICAgIF9lc2NIdG1sKHQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KSkgK1xuICAgICAgICAnPC9zcGFuPic7XG4gICAgfVxuICB9XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG5cbiAgaWYgKHN0YXRlLmxvYWRpbmcpIHtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZHYtZXN0YWRvXCI+Q2FyZ2FuZG9cdTIwMjY8L2Rpdj4nO1xuICB9IGVsc2UgaWYgKHN0YXRlLmVycm9yKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG8gZHYtZXJyb3JcIj4nICsgX2VzY0h0bWwoc3RhdGUuZXJyb3IpLnJlcGxhY2UoL1xcbi9nLCAnPGJyPicpICsgJzwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoZCAmJiBfaXNFbXB0eShkKSkge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5ObyBoYXkgdmVudGFzIGNvbiBlc29zIGZpbHRyb3MuPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkKSB7XG4gICAgY29uc3QgayA9IGQua3BpcyB8fCB7fTtcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZHYtY2FyZHNcIj4nO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0ZhY3R1cmFkbyBtZW5zdWFsJywgX2ZtdEFycyhrLmZhY3R1cmFkbykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ1ZhbG9yaXphY2lcdTAwRjNuIGJhY2tvcmRlcicsIF9mbXRBcnMoay5iYWNrb3JkZXJBcnMpKTtcbiAgICBodG1sICs9IF9jYXJkKCdDYW50LiBkZSBwZWRpZG9zIGRlbCBtZXMnLCBfZm10VWRzKGsucGVkaWRvcykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIHBlZGlkb3MgXHUwMEZBbmljb3MnLCBfZm10VWRzKGsucGVkaWRvc1VuaWNvcykpO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gICAgaHRtbCArPSBfZ2VzdGlvblNlY3Rpb24oZC5nZXN0aW9uLCBkLnNlY2Npb25lcywgc3RhdGUuaW50ZXJRdWVyeSk7XG4gICAgaHRtbCArPSBfdG9wU2VjdGlvbigndW5pZGFkZXMnLCAnVG9wIDIwIFNLVSAtIFVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSk7XG4gICAgaHRtbCArPSBfdG9wU2VjdGlvbignZGluZXJvJywgJ1RvcCAyMCBTS1UgLSBEaW5lcm8nLCBkLnRvcERpbmVybyB8fCBbXSk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LXZlbnRhcycsICdFdm9sdWNpXHUwMEYzbiBkZSB2ZW50YXMnKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtYm8tdWRzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrb3JkZXIgLSBVbmlkYWRlcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby1hcnMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIERpbmVybycpO1xuICAgIGh0bWwgKz0gX3Byb2R1Y3Rvc1NlY3Rpb24oZC5wcm9kdWN0b3MsIGQuc2VjY2lvbmVzLCBzdGF0ZS5wcm9kUXVlcnkpO1xuICAgIGh0bWwgKz0gX2NvYmVydHVyYVNlY3Rpb24oZC5jb2JlcnR1cmEsIGQuc2VjY2lvbmVzKTtcbiAgICBodG1sICs9IF9jbGllbnRlc1NlY3Rpb24oZC5jbGllbnRlcywgZC5zZWNjaW9uZXMpO1xuICAgIGh0bWwgKz0gX2NhbXBhbmlhc1NlY3Rpb24oZC5jYW1wYW5pYXMsIGQuc2VjY2lvbmVzKTtcbiAgfVxuXG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIHJvb3QuaW5uZXJIVE1MID0gaHRtbDtcbiAgLy8gRWwgdGV4dG8gZGVsIGJ1c2NhZG9yIGRlIFwiVmVyIG1cdTAwRTFzXCIgc2UgcG9uZSBwb3IgRE9NLCBudW5jYSBkZW50cm8gZGVsIEhUTUwuXG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbZGF0YS12ZXJtYXMtc2VhcmNoXScpLmZvckVhY2goKGlucCkgPT4ge1xuICAgIGNvbnN0IGsgPSBpbnAuZ2V0QXR0cmlidXRlKCdkYXRhLXZlcm1hcy1zZWFyY2gnKTtcbiAgICBpZiAoaykgLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAoaW5wKS52YWx1ZSA9IHN0YXRlLnZlck1hc1F1ZXJ5W2tdIHx8ICcnO1xuICB9KTtcblxuICBjb25zdCBpbnRlcklucCA9IHJvb3QucXVlcnlTZWxlY3RvcignI2R2LWludGVyYWNjaW9uZXMtYnVzY2FyJyk7XG4gIGlmIChpbnRlcklucCkgLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAoaW50ZXJJbnApLnZhbHVlID0gc3RhdGUuaW50ZXJRdWVyeSB8fCAnJztcbiAgY29uc3QgcHJvZElucCA9IHJvb3QucXVlcnlTZWxlY3RvcignI2R2LXByb2R1Y3Rvcy1idXNjYXInKTtcbiAgaWYgKHByb2RJbnApIC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKHByb2RJbnApLnZhbHVlID0gc3RhdGUucHJvZFF1ZXJ5IHx8ICcnO1xuXG4gIC8vIFNpbiBtb2RhbCBhYmllcnRvIG5vIHNlIGRpYnVqYSAocmVzcHVlc3RhIHF1ZSBsbGVnXHUwMEYzIGRlc3B1XHUwMEU5cyBkZSBjZXJyYXIpLlxuICBpZiAoX2lzT3BlbigpICYmICFzdGF0ZS5sb2FkaW5nICYmICFzdGF0ZS5lcnJvciAmJiBkICYmICFfaXNFbXB0eShkKSkge1xuICAgIF9sb2FkQ2hhcnRKcygpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIGlmIChfaXNPcGVuKCkgJiYgc3RhdGUuZGF0YSA9PT0gZCkgX2RyYXdDaGFydHMoZCk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgIGNvbnNvbGUud2FybignW2Rhc2hib2FyZC12ZW50YXNdIENoYXJ0LmpzIG5vIGRpc3BvbmlibGU6JywgZSk7XG4gICAgICAgIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnLmR2LWNoYXJ0JykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICAgICAgICBlbC5pbm5lckhUTUwgPVxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPk5vIHNlIHB1ZG8gY2FyZ2FyIGVsIGdyXHUwMEUxZmljby4gUmV2aXNcdTAwRTEgbGEgY29uZXhpXHUwMEYzbi48L2Rpdj4nO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlcigpIHtcbiAgaWYgKCFfZW5zdXJlU2tlbGV0b24oKSkgcmV0dXJuO1xuICByZW5kZXJGaWx0cm9zKGZhbHNlKTtcbiAgX3N5bmNBcGxpY2FyRGlzYWJsZWQoKTtcbiAgcmVuZGVyUmVzdWx0cygpO1xufVxuXG5mdW5jdGlvbiBfY3NzVmFyKG5hbWUsIGZhbGxiYWNrKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdiA9IGdldENvbXB1dGVkU3R5bGUoZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50KS5nZXRQcm9wZXJ0eVZhbHVlKG5hbWUpLnRyaW0oKTtcbiAgICByZXR1cm4gdiB8fCBmYWxsYmFjaztcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gZmFsbGJhY2s7XG4gIH1cbn1cblxuY29uc3QgQ0hBUlRfRk9OVCA9XG4gIFwiLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU0YgUHJvIFRleHQnLCAnU2Vnb2UgVUknLCBzeXN0ZW0tdWksIHNhbnMtc2VyaWZcIjtcbmNvbnN0IENIQVJUX0dSSURfTElHSFQgPSAncmdiYSgwLDAsMCwuMDYpJztcbmNvbnN0IENIQVJUX0dSSURfREFSSyA9ICdyZ2JhKDI1NSwyNTUsMjU1LC4wOCknO1xuXG4vKiogR3JpbGxhIHN1YXZlOyBlbiB0ZW1hIG9zY3VybyB1c2EgYmxhbmNvIHRyYW5zbFx1MDBGQWNpZG8gcGFyYSBxdWUgc2UgdmVhLiAqL1xuZnVuY3Rpb24gX2NoYXJ0R3JpZCgpIHtcbiAgY29uc3QgZGFyayA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGhlbWUnKSA9PT0gJ2RhcmsnO1xuICByZXR1cm4geyBjb2xvcjogZGFyayA/IENIQVJUX0dSSURfREFSSyA6IENIQVJUX0dSSURfTElHSFQgfTtcbn1cblxuZnVuY3Rpb24gX2JhckNoYXJ0KGNhbnZhc0lkLCByb3dzLCBmaWVsZCwgZm10LCBjb2xvcikge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGNhbnZhc0lkKTtcbiAgaWYgKCFlbCB8fCAhd2luZG93LkNoYXJ0KSByZXR1cm47XG4gIC8vIFNwZWM6IFNLVXMgY29uIG5ldG8gPD0gMCBubyBlbnRyYW4gYWwgVG9wIChsYSB0YWJsYSBcIlZlciBtXHUwMEUxc1wiIHNcdTAwRUQgbG9zIG11ZXN0cmEpLlxuICBjb25zdCB0b3AgPSByb3dzLmZpbHRlcigocikgPT4gKE51bWJlcihyW2ZpZWxkXSkgfHwgMCkgPiAwKS5zbGljZSgwLCBUT1BfTik7XG4gIGNoYXJ0c1tjYW52YXNJZF0gPSBuZXcgd2luZG93LkNoYXJ0KGVsLCB7XG4gICAgdHlwZTogJ2JhcicsXG4gICAgZGF0YToge1xuICAgICAgbGFiZWxzOiB0b3AubWFwKChyKSA9PiBTdHJpbmcoci5za3UpKSxcbiAgICAgIGRhdGFzZXRzOiBbXG4gICAgICAgIHsgZGF0YTogdG9wLm1hcCgocikgPT4gTnVtYmVyKHJbZmllbGRdKSB8fCAwKSwgYmFja2dyb3VuZENvbG9yOiBjb2xvciwgYm9yZGVyUmFkaXVzOiAzIH0sXG4gICAgICBdLFxuICAgIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgaW5kZXhBeGlzOiAneScsXG4gICAgICByZXNwb25zaXZlOiB0cnVlLFxuICAgICAgbWFpbnRhaW5Bc3BlY3RSYXRpbzogZmFsc2UsXG4gICAgICBhbmltYXRpb246IGZhbHNlLFxuICAgICAgcGx1Z2luczoge1xuICAgICAgICBsZWdlbmQ6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgZHZEYXRhTGFiZWxzOiB7IGZtdCB9LFxuICAgICAgICB0b29sdGlwOiB7XG4gICAgICAgICAgY2FsbGJhY2tzOiB7XG4gICAgICAgICAgICB0aXRsZTogKGl0ZW1zKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSB0b3BbaXRlbXNbMF0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBTdHJpbmcoci5za3UpICsgKHIuZGVzYyA/ICcgLSAnICsgU3RyaW5nKHIuZGVzYykgOiAnJykgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogKGl0ZW0pID0+IGZtdChpdGVtLnJhdyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeDoge1xuICAgICAgICAgIGdyaWQ6IF9jaGFydEdyaWQoKSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgZm9udDogeyBmYW1pbHk6IENIQVJUX0ZPTlQgfSxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHk6IHtcbiAgICAgICAgICBncmlkOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGF1dG9Ta2lwOiBmYWxzZSxcbiAgICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTAsIGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1zZWNvbmRhcnknLCAnIzMzNDE1NScpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG4vKipcbiAqIFNlcmllIGRlIGJhY2sgb3JkZXIgZW4gMiBkYXRhc2V0czogcmVhbCAobFx1MDBFRG5lYSBsbGVuYSkgeSBlc3RpbWFkbyAocHVudGVhZGEpLlxuICogVW4gcHVudG8gZXN0aW1hZG8gc2UgY29uZWN0YSBjb24gc3UgdmVjaW5vIHJlYWwgcGFyYSBxdWUgbGEgY3VydmEgbm8gcXVlZGVcbiAqIGNvcnRhZGEgZW4gbGEgdHJhbnNpY2lcdTAwRjNuOyBgbnVsbGAgKHNpbiBkYXRvcykgY29ydGEgbGEgbFx1MDBFRG5lYSAoc3BhbkdhcHM6ZmFsc2UpLlxuICovXG5mdW5jdGlvbiBfc3BsaXRCYWNrb3JkZXIoc2VyaWUpIHtcbiAgY29uc3QgcmVhbCA9IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCB8fCBwLmVzdGltYWRvID8gbnVsbCA6IE51bWJlcihwLnZhbG9yKSkpO1xuICBjb25zdCBlc3QgPSBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgfHwgIXAuZXN0aW1hZG8gPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VyaWUubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZXN0W2ldID09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChpICsgMSA8IHNlcmllLmxlbmd0aCAmJiByZWFsW2kgKyAxXSAhPSBudWxsKSBlc3RbaSArIDFdID0gcmVhbFtpICsgMV07XG4gICAgaWYgKGkgLSAxID49IDAgJiYgcmVhbFtpIC0gMV0gIT0gbnVsbCAmJiBlc3RbaSAtIDFdID09IG51bGwpIGVzdFtpIC0gMV0gPSByZWFsW2kgLSAxXTtcbiAgfVxuICByZXR1cm4geyByZWFsLCBlc3QsIGhheUVzdGltYWRvOiBzZXJpZS5zb21lKChwKSA9PiBwLmVzdGltYWRvICYmIHAudmFsb3IgIT0gbnVsbCkgfTtcbn1cblxuZnVuY3Rpb24gX2xpbmVDaGFydChjYW52YXNJZCwgc2VyaWUsIGZtdCwgY29sb3IsIGNvbkVzdGltYWRvKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgY29uc3QgbGFiZWxzID0gc2VyaWUubWFwKChwKSA9PiBfbGFiZWxNZXMocC5tZXMpKTtcbiAgY29uc3QgZGF0YXNldHMgPSBbXTtcbiAgaWYgKGNvbkVzdGltYWRvKSB7XG4gICAgY29uc3QgcyA9IF9zcGxpdEJhY2tvcmRlcihzZXJpZSk7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ3JlYWwnLFxuICAgICAgZGF0YTogcy5yZWFsLFxuICAgICAgYm9yZGVyQ29sb3I6IGNvbG9yLFxuICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgIHNwYW5HYXBzOiBmYWxzZSxcbiAgICAgIHRlbnNpb246IDAuMixcbiAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgIH0pO1xuICAgIGlmIChzLmhheUVzdGltYWRvKSB7XG4gICAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgICAgbGFiZWw6ICdlc3RpbWFkbycsXG4gICAgICAgIGRhdGE6IHMuZXN0LFxuICAgICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICAgIGJvcmRlckRhc2g6IFs2LCA0XSxcbiAgICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICAgIHBvaW50UmFkaXVzOiAzLFxuICAgICAgICBwb2ludFN0eWxlOiAncmVjdFJvdCcsXG4gICAgICB9KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZGF0YXNldHMucHVzaCh7XG4gICAgICBsYWJlbDogJ2ZhY3R1cmFkbycsXG4gICAgICBkYXRhOiBzZXJpZS5tYXAoKHApID0+IChwLnZhbG9yID09IG51bGwgPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSksXG4gICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgfSk7XG4gIH1cbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnbGluZScsXG4gICAgZGF0YTogeyBsYWJlbHMsIGRhdGFzZXRzIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgcmVzcG9uc2l2ZTogdHJ1ZSxcbiAgICAgIG1haW50YWluQXNwZWN0UmF0aW86IGZhbHNlLFxuICAgICAgYW5pbWF0aW9uOiBmYWxzZSxcbiAgICAgIHBsdWdpbnM6IHtcbiAgICAgICAgbGVnZW5kOiB7IGRpc3BsYXk6IGNvbkVzdGltYWRvICYmIGRhdGFzZXRzLmxlbmd0aCA+IDEgfSxcbiAgICAgICAgdG9vbHRpcDogeyBjYWxsYmFja3M6IHsgbGFiZWw6IChpdGVtKSA9PiBpdGVtLmRhdGFzZXQubGFiZWwgKyAnOiAnICsgZm10KGl0ZW0ucmF3KSB9IH0sXG4gICAgICB9LFxuICAgICAgc2NhbGVzOiB7XG4gICAgICAgIHk6IHtcbiAgICAgICAgICBiZWdpbkF0WmVybzogdHJ1ZSxcbiAgICAgICAgICBncmlkOiBfY2hhcnRHcmlkKCksXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGZvbnQ6IHsgZmFtaWx5OiBDSEFSVF9GT05UIH0sXG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IGZtdCh2KSxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDYsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB4OiB7XG4gICAgICAgICAgZ3JpZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIGJvcmRlcjogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIHRpY2tzOiB7IGZvbnQ6IHsgZmFtaWx5OiBDSEFSVF9GT05UIH0sIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufVxuXG4vKiogQmFycmFzIGhvcml6b250YWxlcyBkZSBjb2JlcnR1cmE6IHVuYSBwb3IgdmVuZGVkb3IsIDAtMTAwJS4gKi9cbmZ1bmN0aW9uIF9jb2JlcnR1cmFDaGFydChyb3dzKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWNhbnZhcy1jb2JlcnR1cmEnKTtcbiAgaWYgKCFlbCB8fCAhd2luZG93LkNoYXJ0KSByZXR1cm47XG4gIGNoYXJ0c1snZHYtY2FudmFzLWNvYmVydHVyYSddID0gbmV3IHdpbmRvdy5DaGFydChlbCwge1xuICAgIHR5cGU6ICdiYXInLFxuICAgIGRhdGE6IHtcbiAgICAgIGxhYmVsczogcm93cy5tYXAoKHIpID0+IFtTdHJpbmcoci52ZW5kZWRvciksIF9jb2JlcnR1cmFFdGlxdWV0YShyKV0pLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGRhdGE6IHJvd3MubWFwKChyKSA9PiAoci5wY3QgPT0gbnVsbCA/IDAgOiBOdW1iZXIoci5wY3QpIHx8IDApKSxcbiAgICAgICAgICBiYWNrZ3JvdW5kQ29sb3I6ICcjMDI4NGEwJyxcbiAgICAgICAgICBib3JkZXJSYWRpdXM6IDMsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0sXG4gICAgb3B0aW9uczoge1xuICAgICAgaW5kZXhBeGlzOiAneScsXG4gICAgICByZXNwb25zaXZlOiB0cnVlLFxuICAgICAgbWFpbnRhaW5Bc3BlY3RSYXRpbzogZmFsc2UsXG4gICAgICBhbmltYXRpb246IGZhbHNlLFxuICAgICAgcGx1Z2luczoge1xuICAgICAgICBsZWdlbmQ6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgZHZEYXRhTGFiZWxzOiB7IGZtdDogKF92LCBpKSA9PiAocm93c1tpXSA/IF9jb2JlcnR1cmFFdGlxdWV0YShyb3dzW2ldKSA6ICcnKSB9LFxuICAgICAgICB0b29sdGlwOiB7XG4gICAgICAgICAgY2FsbGJhY2tzOiB7XG4gICAgICAgICAgICB0aXRsZTogKGl0ZW1zKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSByb3dzW2l0ZW1zWzBdLmRhdGFJbmRleF07XG4gICAgICAgICAgICAgIHJldHVybiByID8gU3RyaW5nKHIudmVuZGVkb3IpIDogJyc7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbGFiZWw6IChpdGVtKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHIgPSByb3dzW2l0ZW0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBfY29iZXJ0dXJhRXRpcXVldGEocikgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeDoge1xuICAgICAgICAgIG1pbjogMCxcbiAgICAgICAgICBtYXg6IDEwMCxcbiAgICAgICAgICBncmlkOiBfY2hhcnRHcmlkKCksXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHtcbiAgICAgICAgICAgIGZvbnQ6IHsgZmFtaWx5OiBDSEFSVF9GT05UIH0sXG4gICAgICAgICAgICBjYWxsYmFjazogKHYpID0+IHYgKyAnJScsXG4gICAgICAgICAgICBtYXhUaWNrc0xpbWl0OiA1LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgeToge1xuICAgICAgICAgIGdyaWQ6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgYXV0b1NraXA6IGZhbHNlLFxuICAgICAgICAgICAgZm9udDogeyBzaXplOiAxMCwgZmFtaWx5OiBDSEFSVF9GT05UIH0sXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LXNlY29uZGFyeScsICcjMzM0MTU1JyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIF9kcmF3Q2hhcnRzKGQpIHtcbiAgLy8gUHVlZGUgcXVlIGVsIHVzdWFyaW8gaGF5YSByZS1yZW5kZXJpemFkbyBtaWVudHJhcyBjYXJnYWJhIENoYXJ0LmpzLlxuICBfZGVzdHJveUNoYXJ0cygpO1xuICBfYmFyQ2hhcnQoJ2R2LWNoYXJ0LXRvcC11bmlkYWRlcycsIGQudG9wVW5pZGFkZXMgfHwgW10sICd1ZHMnLCBfZm10VWRzLCAnIzAyODRhMCcpO1xuICBfYmFyQ2hhcnQoJ2R2LWNoYXJ0LXRvcC1kaW5lcm8nLCBkLnRvcERpbmVybyB8fCBbXSwgJ2FycycsIF9mbXRBcnMsICcjMTZhMzRhJyk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LXZlbnRhcycsIGQuc2VyaWVWZW50YXMgfHwgW10sIF9mbXRBcnMsICcjMWU0MGFmJywgZmFsc2UpO1xuICBfbGluZUNoYXJ0KCdkdi1jaGFydC1iby11ZHMnLCBkLnNlcmllQm9VZHMgfHwgW10sIF9mbXRVZHMsICcjYzI0MTBjJywgdHJ1ZSk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LWJvLWFycycsIGQuc2VyaWVCb0FycyB8fCBbXSwgX2ZtdEFycywgJyM5ZjEyMzknLCB0cnVlKTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoZC5jb2JlcnR1cmEpKSBfY29iZXJ0dXJhQ2hhcnQoZC5jb2JlcnR1cmEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShkLmNsaWVudGVzKSkge1xuICAgIC8vIF9iYXJDaGFydCB1c2Egc2t1L2Rlc2M6IHNlIGFkYXB0YW4gbm9tYnJlIHkgY1x1MDBGM2RpZ28gZGVsIGNsaWVudGUuXG4gICAgY29uc3QgZmlsYXMgPSBkLmNsaWVudGVzLm1hcCgoYykgPT4gKHsgc2t1OiBjLm5vbWJyZSwgZGVzYzogYy5jb2RlLCBmYWN0dXJhZG86IGMuZmFjdHVyYWRvIH0pKTtcbiAgICBfYmFyQ2hhcnQoJ2R2LWNoYXJ0LXRvcC1jbGllbnRlcycsIGZpbGFzLCAnZmFjdHVyYWRvJywgX2ZtdEFycywgJyM3YzNhZWQnKTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERhdG9zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX2ZpbHRyb3NQYXlsb2FkKCkge1xuICByZXR1cm4ge1xuICAgIG1lczogc3RhdGUubWVzLFxuICAgIHZlbmRlZG9yZXM6IF9pc1ZlbmRlZG9yKCkgPyBbXSA6IHN0YXRlLnNlbC52ZW5kZWRvcmVzLnNsaWNlKCksXG4gICAgY2xpZW50ZXM6IHN0YXRlLnNlbC5jbGllbnRlcy5zbGljZSgpLFxuICAgIHByb3ZpbmNpYXM6IHN0YXRlLnNlbC5wcm92aW5jaWFzLnNsaWNlKCksXG4gICAgY2F0ZWdvcmlhczogc3RhdGUuc2VsLmNhdGVnb3JpYXMuc2xpY2UoKSxcbiAgICBza3VzOiBzdGF0ZS5zZWwuc2t1cy5zbGljZSgpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjYXJnYXIoKSB7XG4gIGNvbnN0IHNlcSA9ICsrc3RhdGUucmVxU2VxO1xuICBzdGF0ZS5sb2FkaW5nID0gdHJ1ZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgcmVuZGVyKCk7XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBmaXJlYmFzZSA9PT0gJ3VuZGVmaW5lZCcgfHwgIWZpcmViYXNlLmFwcCkgdGhyb3cgbmV3IEVycm9yKCdmaXJlYmFzZSBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3QgY2FsbGFibGUgPSBmaXJlYmFzZS5hcHAoKS5mdW5jdGlvbnMoUkVHSU9OKS5odHRwc0NhbGxhYmxlKCdkYXNoYm9hcmRWZW50YXNDRicpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKF9maWx0cm9zUGF5bG9hZCgpKTtcbiAgICBpZiAoc2VxICE9PSBzdGF0ZS5yZXFTZXEpIHJldHVybjtcbiAgICBzdGF0ZS5kYXRhID0gKHJlcyAmJiByZXMuZGF0YSkgfHwgbnVsbDtcbiAgICBpZiAoc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLm9wY2lvbmVzKSBzdGF0ZS5vcGNpb25lcyA9IHN0YXRlLmRhdGEub3BjaW9uZXM7XG4gICAgc3RhdGUudmVyTWFzID0geyB1bmlkYWRlczogZmFsc2UsIGRpbmVybzogZmFsc2UgfTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tkYXNoYm9hcmQtdmVudGFzXSBkYXNoYm9hcmRWZW50YXNDRiBmYWxsbzonLCBlKTtcbiAgICBzdGF0ZS5lcnJvciA9IF9lcnJvck1lc3NhZ2UoKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoc2VxID09PSBzdGF0ZS5yZXFTZXEpIHtcbiAgICAgIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV2ZW50b3MgKGRlbGVnYWRvcyBzb2JyZSBlbCBib2R5IGRlbCBtb2RhbClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5sZXQgX3dpcmVkID0gZmFsc2U7XG5mdW5jdGlvbiBfd2lyZSgpIHtcbiAgaWYgKF93aXJlZCkgcmV0dXJuO1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtYm9keScpO1xuICBpZiAoIWJvZHkpIHJldHVybjtcbiAgX3dpcmVkID0gdHJ1ZTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAoISh0IGluc3RhbmNlb2YgRWxlbWVudCkpIHJldHVybjtcbiAgICBjb25zdCBhY3QgPSB0LmNsb3Nlc3QoJ1tkYXRhLWR2LWFjdGlvbl0nKTtcbiAgICBpZiAoYWN0KSB7XG4gICAgICBjb25zdCBhID0gYWN0LmdldEF0dHJpYnV0ZSgnZGF0YS1kdi1hY3Rpb24nKTtcbiAgICAgIGlmIChhID09PSAnYXBsaWNhcicpIHtcbiAgICAgICAgX3JlYWRTZWxGcm9tRG9tKGJvZHkpO1xuICAgICAgICBjYXJnYXIoKTtcbiAgICAgIH0gZWxzZSBpZiAoYSA9PT0gJ2xpbXBpYXInKSB7XG4gICAgICAgIHN0YXRlLnNlbCA9IF9zZWxWYWNpYSgpO1xuICAgICAgICBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gICAgICAgIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gICAgICAgIGNhcmdhcigpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB2bSA9IHQuY2xvc2VzdCgnW2RhdGEtdmVybWFzXScpO1xuICAgIGlmICh2bSkge1xuICAgICAgY29uc3QgdGlwbyA9IF90aXBvVmVyTWFzKHZtLmdldEF0dHJpYnV0ZSgnZGF0YS12ZXJtYXMnKSk7XG4gICAgICBzdGF0ZS52ZXJNYXNbdGlwb10gPSAhc3RhdGUudmVyTWFzW3RpcG9dO1xuICAgICAgLy8gU29sbyByZXN1bHRhZG9zOiBubyBzZSBsZWVuIG5pIHNlIHBpc2FuIGZpbHRyb3Mgc2luIGFwbGljYXIuXG4gICAgICByZW5kZXJSZXN1bHRzKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGNsciA9IHQuY2xvc2VzdCgnW2RhdGEtbXMtY2xlYXJdJyk7XG4gICAgaWYgKGNscikge1xuICAgICAgY29uc3Qga2V5ID0gY2xyLmdldEF0dHJpYnV0ZSgnZGF0YS1tcy1jbGVhcicpO1xuICAgICAgYm9keS5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl1bZGF0YS1maWx0cm89XCInICsga2V5ICsgJ1wiXScpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgICAgIGVsLmNoZWNrZWQgPSBmYWxzZTtcbiAgICAgIH0pO1xuICAgICAgX3VwZGF0ZVN1bW1hcnkoYm9keSwga2V5KTtcbiAgICB9XG4gIH0pO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAodCBpbnN0YW5jZW9mIEhUTUxJbnB1dEVsZW1lbnQgJiYgdC50eXBlID09PSAnY2hlY2tib3gnICYmIHQuaGFzQXR0cmlidXRlKCdkYXRhLWZpbHRybycpKSB7XG4gICAgICBfdXBkYXRlU3VtbWFyeShib2R5LCB0LmdldEF0dHJpYnV0ZSgnZGF0YS1maWx0cm8nKSk7XG4gICAgfVxuICB9KTtcblxuICBib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IGV2LnRhcmdldDtcbiAgICBpZiAoISh0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCkpIHJldHVybjtcbiAgICBjb25zdCBtc0tleSA9IHQuZ2V0QXR0cmlidXRlKCdkYXRhLW1zLXNlYXJjaCcpO1xuICAgIGlmIChtc0tleSkge1xuICAgICAgY29uc3QgcSA9IHQudmFsdWUudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gICAgICBjb25zdCBkZXQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJ2RldGFpbHNbZGF0YS1tcz1cIicgKyBtc0tleSArICdcIl0nKTtcbiAgICAgIGlmICghZGV0KSByZXR1cm47XG4gICAgICBkZXQucXVlcnlTZWxlY3RvckFsbCgnLmR2LW1zLW9wdCcpLmZvckVhY2goKG9wdCkgPT4ge1xuICAgICAgICBjb25zdCBzID0gb3B0LmdldEF0dHJpYnV0ZSgnZGF0YS1zZWFyY2gnKSB8fCAnJztcbiAgICAgICAgb3B0LnN0eWxlLmRpc3BsYXkgPSAhcSB8fCBzLmluY2x1ZGVzKHEpID8gJycgOiAnbm9uZSc7XG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHQuaWQgPT09ICdkdi1pbnRlcmFjY2lvbmVzLWJ1c2NhcicpIHtcbiAgICAgIHN0YXRlLmludGVyUXVlcnkgPSB0LnZhbHVlO1xuICAgICAgY29uc3QgZyA9IHN0YXRlLmRhdGEgJiYgc3RhdGUuZGF0YS5nZXN0aW9uO1xuICAgICAgY29uc3QgdGkgPSAoZyAmJiBnLnRhYmxhSW50ZXJhY2Npb25lcykgfHwgeyByb3dzOiBbXSwgdG90YWw6IDAgfTtcbiAgICAgIGNvbnN0IGNvbnQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJyNkdi1pbnRlcmFjY2lvbmVzIC5kdi1pbnRlci1ib2R5Jyk7XG4gICAgICBpZiAoY29udCkgY29udC5pbm5lckhUTUwgPSBfaW50ZXJhY2Npb25lc1RhYmxhKHRpLnJvd3MsIHRpLnRvdGFsLCBzdGF0ZS5pbnRlclF1ZXJ5KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHQuaWQgPT09ICdkdi1wcm9kdWN0b3MtYnVzY2FyJykge1xuICAgICAgc3RhdGUucHJvZFF1ZXJ5ID0gdC52YWx1ZTtcbiAgICAgIGlmIChfcHJvZFRpbWVyKSBjbGVhclRpbWVvdXQoX3Byb2RUaW1lcik7XG4gICAgICBfcHJvZFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIF9wcm9kVGltZXIgPSBudWxsO1xuICAgICAgICBjb25zdCBjb250ID0gYm9keS5xdWVyeVNlbGVjdG9yKCcjZHYtcHJvZHVjdG9zIC5kdi1wcm9kLWJvZHknKTtcbiAgICAgICAgaWYgKGNvbnQpXG4gICAgICAgICAgY29udC5pbm5lckhUTUwgPSBfcHJvZHVjdG9zVGFibGEoc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLnByb2R1Y3Rvcywgc3RhdGUucHJvZFF1ZXJ5KTtcbiAgICAgIH0sIFBST0RVQ1RPU19ERUJPVU5DRV9NUyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHZtQXR0ciA9IHQuZ2V0QXR0cmlidXRlKCdkYXRhLXZlcm1hcy1zZWFyY2gnKTtcbiAgICBpZiAodm1BdHRyKSB7XG4gICAgICAvLyBTb2xvIHRyZXMgcmFua2luZ3MgcG9zaWJsZXM6IG51bmNhIHJldXNhciBlbCB0ZXh0byBkZWwgYXRyaWJ1dG8gZW4gZWwgSFRNTC5cbiAgICAgIGNvbnN0IHZtS2V5ID0gX3RpcG9WZXJNYXModm1BdHRyKTtcbiAgICAgIHN0YXRlLnZlck1hc1F1ZXJ5W3ZtS2V5XSA9IHQudmFsdWU7XG4gICAgICBjb25zdCBzZWMgPSB0LmNsb3Nlc3QoJy5kdi12ZXJtYXMnKTtcbiAgICAgIGNvbnN0IGRkID0gc3RhdGUuZGF0YTtcbiAgICAgIGNvbnN0IHJvd3MgPVxuICAgICAgICAoZGQgJiZcbiAgICAgICAgICAodm1LZXkgPT09ICd1bmlkYWRlcydcbiAgICAgICAgICAgID8gZGQudG9wVW5pZGFkZXNcbiAgICAgICAgICAgIDogdm1LZXkgPT09ICdkaW5lcm8nXG4gICAgICAgICAgICAgID8gZGQudG9wRGluZXJvXG4gICAgICAgICAgICAgIDogZGQuY2xpZW50ZXMpKSB8fFxuICAgICAgICBbXTtcbiAgICAgIGlmIChzZWMpIHtcbiAgICAgICAgY29uc3QgdG1wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRtcC5pbm5lckhUTUwgPSBfdmVyTWFzVGFibGEodm1LZXksIHJvd3MpO1xuICAgICAgICBjb25zdCBuZXdXcmFwID0gdG1wLnF1ZXJ5U2VsZWN0b3IoJy5kdi10YWJsZS13cmFwJyk7XG4gICAgICAgIGNvbnN0IG9sZFdyYXAgPSBzZWMucXVlcnlTZWxlY3RvcignLmR2LXRhYmxlLXdyYXAnKTtcbiAgICAgICAgaWYgKG5ld1dyYXAgJiYgb2xkV3JhcCkgb2xkV3JhcC5yZXBsYWNlV2l0aChuZXdXcmFwKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpIHtcbiAgY29uc3QgZGV0ID0gYm9keS5xdWVyeVNlbGVjdG9yKCdkZXRhaWxzW2RhdGEtbXM9XCInICsga2V5ICsgJ1wiXScpO1xuICBpZiAoIWRldCkgcmV0dXJuO1xuICBjb25zdCBjaGVja2VkID0gQXJyYXkuZnJvbShkZXQucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdOmNoZWNrZWQnKSk7XG4gIGNvbnN0IHN1bSA9IGRldC5xdWVyeVNlbGVjdG9yKCdzdW1tYXJ5Jyk7XG4gIGlmICghc3VtKSByZXR1cm47XG4gIGlmIChjaGVja2VkLmxlbmd0aCA9PT0gMCkgc3VtLnRleHRDb250ZW50ID0gJ1RvZG9zJztcbiAgZWxzZSBpZiAoY2hlY2tlZC5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzcGFuID0gY2hlY2tlZFswXS5wYXJlbnRFbGVtZW50ICYmIGNoZWNrZWRbMF0ucGFyZW50RWxlbWVudC5xdWVyeVNlbGVjdG9yKCdzcGFuJyk7XG4gICAgc3VtLnRleHRDb250ZW50ID0gc3BhbiA/IHNwYW4udGV4dENvbnRlbnQgOiBjaGVja2VkWzBdLnZhbHVlO1xuICB9IGVsc2Ugc3VtLnRleHRDb250ZW50ID0gY2hlY2tlZC5sZW5ndGggKyAnIHNlbGVjY2lvbmFkb3MnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFQSSBwXHUwMEZBYmxpY2EgKGV4cG9ydHMgZGVsIGNodW5rKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbndpbmRvdy5vcGVuRGFzaGJvYXJkVmVudGFzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkYXNoYm9hcmQtdmVudGFzLW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHJldHVybjtcbiAgY29uc3Qgcm9sZSA9IF9yb2xlKCk7XG4gIGlmIChyb2xlICE9PSAnYWRtaW4nICYmIHJvbGUgIT09ICdnZXJlbnRlJyAmJiByb2xlICE9PSAndmVuZGVkb3InKSB7XG4gICAgYWxlcnQoJ1R1IHVzdWFyaW8gbm8gdGllbmUgYWNjZXNvIGFsIERhc2hib2FyZCBkZSBWZW50YXMuIFNpIGxvIG5lY2VzaXRcdTAwRTFzLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gT3RybyB1c3VhcmlvIGVuIGxhIG1pc21hIHBlc3RhXHUwMEYxYSAobG9nb3V0ICsgbG9naW4gc2luIHJlY2FyZ2FyKTogc2VcbiAgLy8gZGVzY2FydGEgdG9kbyBsbyBkZWwgYW50ZXJpb3IuIE1pc21vIHVzdWFyaW86IHNlIGNvbnNlcnZhIHN1IHNlbGVjY2lcdTAwRjNuLlxuICBjb25zdCB1aWQgPSBfY3VycmVudFVpZCgpO1xuICBpZiAodWlkICE9PSBzdGF0ZS51aWQpIF9yZXNldFN0YXRlKHVpZCk7XG4gIGlmICghc3RhdGUubWVzKSBzdGF0ZS5tZXMgPSBfbWVzQWN0dWFsQXJ0KCk7XG4gIG1vZGFsLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgX2Vuc3VyZVNrZWxldG9uKCk7XG4gIF93aXJlKCk7XG4gIHJlbmRlckZpbHRyb3ModHJ1ZSk7XG4gIC8vIFByZWNhcmdhIENoYXJ0LmpzIGVuIHBhcmFsZWxvIGEgbGEgY29uc3VsdGEuXG4gIF9sb2FkQ2hhcnRKcygpLmNhdGNoKCgpID0+IHt9KTtcbiAgLy8gU2llbXByZSBzZSBwaWRlIGRlIG51ZXZvIGFsIGFicmlyIChlbCBzZXJ2aWRvciBjYWNoZWEgMTAgbWluKS5cbiAgY2FyZ2FyKCk7XG59O1xuXG53aW5kb3cuY2xvc2VEYXNoYm9hcmRWZW50YXMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgaWYgKG1vZGFsKSBtb2RhbC5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIC8vIExvcyBkYXRvcyBubyBzZSBndWFyZGFuIGVudHJlIGFwZXJ0dXJhczsgc2UgdnVlbHZlbiBhIHBlZGlyIGFsIGFicmlyLlxuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICBzdGF0ZS5yZXFTZXErKztcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFpQkEsTUFBTSxlQUFlO0FBQ3JCLE1BQU0sUUFBUTtBQUNkLE1BQU0sU0FBUztBQUVmLE1BQU0sY0FBYztBQUFBLElBQ2xCLEVBQUUsS0FBSyxjQUFjLE9BQU8sV0FBVztBQUFBLElBQ3ZDLEVBQUUsS0FBSyxZQUFZLE9BQU8sVUFBVTtBQUFBLElBQ3BDLEVBQUUsS0FBSyxjQUFjLE9BQU8sWUFBWTtBQUFBLElBQ3hDLEVBQUUsS0FBSyxjQUFjLE9BQU8sZUFBWTtBQUFBLElBQ3hDLEVBQUUsS0FBSyxRQUFRLE9BQU8sTUFBTTtBQUFBLEVBQzlCO0FBRUEsV0FBUyxZQUFZO0FBQ25CLFdBQU8sRUFBRSxZQUFZ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
