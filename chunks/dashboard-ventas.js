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
        const objetivo = c.objetivoTipo === "money" ? _fmtArs(c.objetivo) : _fmtUds(c.objetivo) + " u";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZGFzaGJvYXJkLXZlbnRhcy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcbi8vIERBU0hCT0FSRCBERSBWRU5UQVMgKHYxNTI5LCAyMDI2LTEwLTI5KS5cbi8vXG4vLyBQYW50YWxsYSBudWV2YSBwYXJhIGFuYWxpemFyIHZlbnRhcyBwZXNjYSArIGV2b2x1Y2lcdTAwRjNuIGRlbCBiYWNrIG9yZGVyIGNvbiA2XG4vLyBmaWx0cm9zIGNvbWJpbmFibGVzLiBWaXNpYmxlIHBhcmEgYWRtaW4sIGdlcmVudGUgeSB2ZW5kZWRvci4gTG9zIGRhdG9zIGxvc1xuLy8gYXJtYSBsYSBjYWxsYWJsZSBgZGFzaGJvYXJkVmVudGFzQ0ZgIChzb3V0aGFtZXJpY2EtZWFzdDEpIHF1ZSBjb25zdWx0YVxuLy8gQmlnUXVlcnk7IHBhcmEgdW4gdmVuZGVkb3IgZWwgc2Vydmlkb3IgZnVlcnphIHN1IHByb3BpbyBmaWx0cm8gVmVuZGVkb3IsIGFjXHUwMEUxXG4vLyBzb2xvIGxvIG1vc3RyYW1vcyBibG9xdWVhZG8uXG4vL1xuLy8gU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTI5LWRhc2hib2FyZC12ZW50YXMtZGVzaWduLm1kXG4vL1xuLy8gQ2h1bmsgbGF6eSAoXHUwMEE3MTgpOiByZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTLCBzcmMvbWFpbi5qc1xuLy8gaW5zdGFsbENodW5rU3R1YnMgeSBzdy5qcyBTVEFUSUNfQVNTRVRTIGNvbiBsYSBtaXNtYSBsaXN0YSBkZSBleHBvcnRzLlxuLy9cbi8vIFNFR1VSSURBRDogdG9kbyBzdHJpbmcgcXVlIHZpZW5lIGRlIGRhdG9zIHBhc2EgcG9yIF9lc2NIdG1sKCkgYW50ZXMgZGVcbi8vIGlubmVySFRNTCAobm9tYnJlcyBkZSBjbGllbnRlcywgZGVzY3JpcGNpb25lcyBkZSBTS1UsIHByb3ZpbmNpYXMsIGV0Yy4pLlxuXG5jb25zdCBDSEFSVF9KU19VUkwgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvQ2hhcnQuanMvNC40LjEvY2hhcnQudW1kLm1pbi5qcyc7XG5jb25zdCBUT1BfTiA9IDIwO1xuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5cbmNvbnN0IEZJTFRST1NfREVGID0gW1xuICB7IGtleTogJ3ZlbmRlZG9yZXMnLCBsYWJlbDogJ1ZlbmRlZG9yJyB9LFxuICB7IGtleTogJ2NsaWVudGVzJywgbGFiZWw6ICdDbGllbnRlJyB9LFxuICB7IGtleTogJ3Byb3ZpbmNpYXMnLCBsYWJlbDogJ1Byb3ZpbmNpYScgfSxcbiAgeyBrZXk6ICdjYXRlZ29yaWFzJywgbGFiZWw6ICdDYXRlZ29yXHUwMEVEYScgfSxcbiAgeyBrZXk6ICdza3VzJywgbGFiZWw6ICdTS1UnIH0sXG5dO1xuXG5mdW5jdGlvbiBfc2VsVmFjaWEoKSB7XG4gIHJldHVybiB7IHZlbmRlZG9yZXM6IFtdLCBjbGllbnRlczogW10sIHByb3ZpbmNpYXM6IFtdLCBjYXRlZ29yaWFzOiBbXSwgc2t1czogW10gfTtcbn1cblxuLy8gRXN0YWRvIGRlbCBtXHUwMEYzZHVsby4gU29icmV2aXZlIGFsIGxvZ291dCAoZWwgY2h1bmsgbm8gc2UgcmVjYXJnYSksIHBvciBlc29cbi8vIGd1YXJkYSBlbCBgdWlkYCBkdWVcdTAwRjFvOiBzaSBhbCBhYnJpciBlbCB1c3VhcmlvIGVzIG90cm8sIHNlIHJlc2V0ZWEgdG9kbyB5XG4vLyBudW5jYSBzZSBtdWVzdHJhbiBkYXRvcyBkZWwgdXN1YXJpbyBhbnRlcmlvci5cbmNvbnN0IHN0YXRlID0ge1xuICB1aWQ6IG51bGwsXG4gIG1lczogJycsXG4gIHNlbDogX3NlbFZhY2lhKCksXG4gIGRhdGE6IG51bGwsXG4gIG9wY2lvbmVzOiBudWxsLFxuICBvcGNpb25lc1JlbmRlcmVkOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICB2ZXJNYXM6IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlLCBjbGllbnRlczogZmFsc2UgfSxcbiAgdmVyTWFzUXVlcnk6IHsgdW5pZGFkZXM6ICcnLCBkaW5lcm86ICcnLCBjbGllbnRlczogJycgfSxcbiAgaW50ZXJRdWVyeTogJycsXG4gIHByb2RRdWVyeTogJycsXG4gIHJlcVNlcTogMCxcbn07XG5cbmZ1bmN0aW9uIF9yZXNldFN0YXRlKHVpZCkge1xuICBzdGF0ZS51aWQgPSB1aWQ7XG4gIHN0YXRlLm1lcyA9IF9tZXNBY3R1YWxBcnQoKTtcbiAgc3RhdGUuc2VsID0gX3NlbFZhY2lhKCk7XG4gIHN0YXRlLmRhdGEgPSBudWxsO1xuICBzdGF0ZS5vcGNpb25lcyA9IG51bGw7XG4gIHN0YXRlLm9wY2lvbmVzUmVuZGVyZWQgPSBudWxsO1xuICBzdGF0ZS5sb2FkaW5nID0gZmFsc2U7XG4gIHN0YXRlLmVycm9yID0gJyc7XG4gIHN0YXRlLnZlck1hcyA9IHsgdW5pZGFkZXM6IGZhbHNlLCBkaW5lcm86IGZhbHNlLCBjbGllbnRlczogZmFsc2UgfTtcbiAgc3RhdGUudmVyTWFzUXVlcnkgPSB7IHVuaWRhZGVzOiAnJywgZGluZXJvOiAnJywgY2xpZW50ZXM6ICcnIH07XG4gIHN0YXRlLmludGVyUXVlcnkgPSAnJztcbiAgc3RhdGUucHJvZFF1ZXJ5ID0gJyc7XG4gIF9zdG9ja01lbW8uY2xlYXIoKTtcbiAgc3RhdGUucmVxU2VxKys7XG59XG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55Pn0gKi9cbmNvbnN0IGNoYXJ0cyA9IHt9O1xubGV0IGNoYXJ0SnNQcm9taXNlID0gbnVsbDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gRXNjYXBlIGxvY2FsIChtaXNtbyByZXN1bHRhZG8gcXVlIHdpbmRvdy5lc2NhcGVIdG1sKTogZWwgYW5cdTAwRTFsaXNpcyBkZVxuLy8gc2VndXJpZGFkIGRlbCByZXBvIChDb2RlUUwpIHNvbG8gcmVjb25vY2UgdW4gc2FuaXRpemFkb3IgdmlzaWJsZSBhY1x1MDBFMS5cbmZ1bmN0aW9uIF9lc2NIdG1sKHMpIHtcbiAgY29uc3QgdiA9IHMgPT0gbnVsbCA/ICcnIDogcztcbiAgcmV0dXJuIFN0cmluZyh2KVxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcbiAgICAucmVwbGFjZSgvXCIvZywgJyZxdW90OycpXG4gICAgLnJlcGxhY2UoLycvZywgJyYjMzk7Jyk7XG59XG5cbmZ1bmN0aW9uIF9mbXRBcnMobikge1xuICBjb25zdCB2ID0gTnVtYmVyKG4pIHx8IDA7XG4gIHJldHVybiAnJCcgKyBNYXRoLnJvdW5kKHYpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xufVxuXG5mdW5jdGlvbiBfZm10VWRzKG4pIHtcbiAgcmV0dXJuIE1hdGgucm91bmQoTnVtYmVyKG4pIHx8IDApLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xufVxuXG5mdW5jdGlvbiBfcm9sZSgpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKHR5cGVvZiB1c2VyUm9sZSAhPT0gJ3VuZGVmaW5lZCcgPyB1c2VyUm9sZSA6IHdpbmRvdy51c2VyUm9sZSkgfHwgbnVsbDtcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gd2luZG93LnVzZXJSb2xlIHx8IG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gX215VmVuZG9yKCkge1xuICB0cnkge1xuICAgIHJldHVybiAodHlwZW9mIGFzc2lnbmVkVmVuZG9yICE9PSAndW5kZWZpbmVkJyA/IGFzc2lnbmVkVmVuZG9yIDogd2luZG93LmFzc2lnbmVkVmVuZG9yKSB8fCAnJztcbiAgfSBjYXRjaCAoX2UpIHtcbiAgICByZXR1cm4gd2luZG93LmFzc2lnbmVkVmVuZG9yIHx8ICcnO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9jdXJyZW50VWlkKCkge1xuICB0cnkge1xuICAgIGNvbnN0IHUgPSB0eXBlb2YgY3VycmVudFVzZXIgIT09ICd1bmRlZmluZWQnID8gY3VycmVudFVzZXIgOiB3aW5kb3cuY3VycmVudFVzZXI7XG4gICAgcmV0dXJuICh1ICYmIHUudWlkKSB8fCBudWxsO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci51aWQpIHx8IG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gX2lzT3BlbigpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1tb2RhbCcpO1xuICByZXR1cm4gISEobW9kYWwgJiYgbW9kYWwuY2xhc3NMaXN0ICYmIG1vZGFsLmNsYXNzTGlzdC5jb250YWlucygnb3BlbicpKTtcbn1cblxuZnVuY3Rpb24gX2lzVmVuZGVkb3IoKSB7XG4gIHJldHVybiBfcm9sZSgpID09PSAndmVuZGVkb3InO1xufVxuXG4vKiogTWVzIGVuIGN1cnNvIGVuIGhvcmEgQXJnZW50aW5hLCBmb3JtYXRvIEFBQUEtTU0uICovXG5mdW5jdGlvbiBfbWVzQWN0dWFsQXJ0KCkge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnRzID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoJ2VuLUNBJywge1xuICAgICAgdGltZVpvbmU6ICdBbWVyaWNhL0FyZ2VudGluYS9CdWVub3NfQWlyZXMnLFxuICAgICAgeWVhcjogJ251bWVyaWMnLFxuICAgICAgbW9udGg6ICcyLWRpZ2l0JyxcbiAgICB9KS5mb3JtYXRUb1BhcnRzKG5ldyBEYXRlKCkpO1xuICAgIGNvbnN0IHkgPSBwYXJ0cy5maW5kKChwKSA9PiBwLnR5cGUgPT09ICd5ZWFyJykudmFsdWU7XG4gICAgY29uc3QgbSA9IHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gJ21vbnRoJykudmFsdWU7XG4gICAgcmV0dXJuIHkgKyAnLScgKyBtO1xuICB9IGNhdGNoIChfZSkge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xuICAgIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxufVxuXG5jb25zdCBNRVNFU19DT1JUT1MgPSBbXG4gICdlbmUnLFxuICAnZmViJyxcbiAgJ21hcicsXG4gICdhYnInLFxuICAnbWF5JyxcbiAgJ2p1bicsXG4gICdqdWwnLFxuICAnYWdvJyxcbiAgJ3NlcCcsXG4gICdvY3QnLFxuICAnbm92JyxcbiAgJ2RpYycsXG5dO1xuZnVuY3Rpb24gX2xhYmVsTWVzKGFhYWFtbSkge1xuICBjb25zdCBzID0gU3RyaW5nKGFhYWFtbSB8fCAnJyk7XG4gIGNvbnN0IG0gPSBOdW1iZXIocy5zbGljZSg1LCA3KSk7XG4gIGlmICghbSkgcmV0dXJuIHM7XG4gIHJldHVybiBNRVNFU19DT1JUT1NbbSAtIDFdICsgJyAnICsgcy5zbGljZSgyLCA0KTtcbn1cblxuZnVuY3Rpb24gX2Vycm9yTWVzc2FnZSgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBtdiA9IHdpbmRvdy5fX3BoYXNlMCAmJiB3aW5kb3cuX19waGFzZTAucHVyZSAmJiB3aW5kb3cuX19waGFzZTAucHVyZS5tZW5zYWplc1ZlbmRlZG9yO1xuICAgIGlmIChtdiAmJiB0eXBlb2YgbXYuZm9ybWF0TWVuc2FqZUNvbkNvZGlnbyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIG12LmZvcm1hdE1lbnNhamVDb25Db2RpZ28oJ0RBU0hCT0FSRF9WRU5UQVNfRkFJTEVEJyk7XG4gICAgfVxuICB9IGNhdGNoIChfZSkge31cbiAgLy8gRmFsbGJhY2sgXHUwMEE3Njggc2kgZWwgYnVuZGxlIG5vIGNhcmdcdTAwRjMgKFNXIHN0YWxlKS5cbiAgcmV0dXJuIChcbiAgICAnTm8gcHVkaW1vcyBjYXJnYXIgZWwgdGFibGVybyBkZSB2ZW50YXMuIFZvbHZcdTAwRTkgYSBpbnRlbnRhciBlbiB1biBtaW51dG87IHNpIHNpZ3VlIHBhc2FuZG8sIGF2aXNhbGUgYSBNYXJpYW5vLicgK1xuICAgICdcXG5cXG5DXHUwMEYzZGlnbyB0XHUwMEU5Y25pY286IERBU0hCT0FSRF9WRU5UQVNfRkFJTEVEJ1xuICApO1xufVxuXG4vLyBQbHVnaW4gcHJvcGlvIChzaW4gbGlicmVyXHUwMEVEYSBudWV2YSk6IGRpYnVqYSBlbCB2YWxvciBhbCBmaW5hbCBkZSBjYWRhIGJhcnJhLlxuLy8gRWwgZm9ybWF0ZWFkb3IgdmllbmUgZW4gb3B0aW9ucy5wbHVnaW5zLmR2RGF0YUxhYmVscy5mbXQ7IHNvbG8gYWN0XHUwMEZBYSBlbiAnYmFyJy5cbmxldCBkdlBsdWdpblJlZ2lzdHJhZG8gPSBmYWxzZTtcbmNvbnN0IGR2RGF0YUxhYmVscyA9IHtcbiAgaWQ6ICdkdkRhdGFMYWJlbHMnLFxuICBhZnRlckRhdGFzZXRzRHJhdyhjaGFydCkge1xuICAgIGlmIChjaGFydC5jb25maWcudHlwZSAhPT0gJ2JhcicpIHJldHVybjtcbiAgICBjb25zdCBvcHRzID0gKGNoYXJ0Lm9wdGlvbnMucGx1Z2lucyAmJiBjaGFydC5vcHRpb25zLnBsdWdpbnMuZHZEYXRhTGFiZWxzKSB8fCB7fTtcbiAgICBpZiAodHlwZW9mIG9wdHMuZm10ICE9PSAnZnVuY3Rpb24nKSByZXR1cm47XG4gICAgY29uc3QgZGFyayA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGhlbWUnKSA9PT0gJ2RhcmsnO1xuICAgIGNvbnN0IGN0eCA9IGNoYXJ0LmN0eDtcbiAgICBjdHguc2F2ZSgpO1xuICAgIGN0eC5mb250ID0gJzExcHggJyArIENIQVJUX0ZPTlQ7XG4gICAgY3R4LmZpbGxTdHlsZSA9IGRhcmsgPyAnI2U1ZTdlYicgOiAnIzFmMjkzNyc7XG4gICAgY3R4LnRleHRCYXNlbGluZSA9ICdtaWRkbGUnO1xuICAgIGNoYXJ0LmRhdGEuZGF0YXNldHMuZm9yRWFjaCgoZHMsIGRpKSA9PiB7XG4gICAgICBjb25zdCBtZXRhID0gY2hhcnQuZ2V0RGF0YXNldE1ldGEoZGkpO1xuICAgICAgbWV0YS5kYXRhLmZvckVhY2goKGJhciwgaSkgPT4ge1xuICAgICAgICBjb25zdCB2ID0gZHMuZGF0YVtpXTtcbiAgICAgICAgaWYgKHYgPT0gbnVsbCkgcmV0dXJuO1xuICAgICAgICBjb25zdCB0eHQgPSBTdHJpbmcob3B0cy5mbXQodiwgaSkpO1xuICAgICAgICBjb25zdCBob3Jpem9udGFsID0gY2hhcnQub3B0aW9ucy5pbmRleEF4aXMgPT09ICd5JztcbiAgICAgICAgaWYgKGhvcml6b250YWwpIHtcbiAgICAgICAgICBjdHgudGV4dEFsaWduID0gJ2xlZnQnO1xuICAgICAgICAgIGN0eC5maWxsVGV4dCh0eHQsIGJhci54ICsgNCwgYmFyLnkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN0eC50ZXh0QWxpZ24gPSAnY2VudGVyJztcbiAgICAgICAgICBjdHguZmlsbFRleHQodHh0LCBiYXIueCwgYmFyLnkgLSA4KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfSxcbn07XG5cbmZ1bmN0aW9uIF9yZWdpc3RyYXJQbHVnaW5zKENoYXJ0KSB7XG4gIGlmIChkdlBsdWdpblJlZ2lzdHJhZG8gfHwgIUNoYXJ0IHx8IHR5cGVvZiBDaGFydC5yZWdpc3RlciAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuO1xuICBDaGFydC5yZWdpc3RlcihkdkRhdGFMYWJlbHMpO1xuICBkdlBsdWdpblJlZ2lzdHJhZG8gPSB0cnVlO1xufVxuXG5mdW5jdGlvbiBfbG9hZENoYXJ0SnMoKSB7XG4gIGlmICh3aW5kb3cuQ2hhcnQpIHtcbiAgICBfcmVnaXN0cmFyUGx1Z2lucyh3aW5kb3cuQ2hhcnQpO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUod2luZG93LkNoYXJ0KTtcbiAgfVxuICBpZiAoY2hhcnRKc1Byb21pc2UpIHJldHVybiBjaGFydEpzUHJvbWlzZTtcbiAgY2hhcnRKc1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHMuc3JjID0gQ0hBUlRfSlNfVVJMO1xuICAgIHMuYXN5bmMgPSB0cnVlO1xuICAgIHMub25sb2FkID0gKCkgPT4ge1xuICAgICAgaWYgKCF3aW5kb3cuQ2hhcnQpIHJldHVybiByZWplY3QobmV3IEVycm9yKCdDaGFydC5qcyBzaW4gZ2xvYmFsJykpO1xuICAgICAgX3JlZ2lzdHJhclBsdWdpbnMod2luZG93LkNoYXJ0KTtcbiAgICAgIHJlc29sdmUod2luZG93LkNoYXJ0KTtcbiAgICB9O1xuICAgIHMub25lcnJvciA9ICgpID0+IHtcbiAgICAgIGNoYXJ0SnNQcm9taXNlID0gbnVsbDtcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoJ25vIHNlIHB1ZG8gY2FyZ2FyIENoYXJ0LmpzJykpO1xuICAgIH07XG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKTtcbiAgfSk7XG4gIHJldHVybiBjaGFydEpzUHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gX2Rlc3Ryb3lDaGFydHMoKSB7XG4gIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhjaGFydHMpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoYXJ0c1trXS5kZXN0cm95KCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgZGVsZXRlIGNoYXJ0c1trXTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9wY2lvbmVzIGRlIGZpbHRyb3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRGV2dWVsdmUgW3t2YWx1ZSxsYWJlbH1dIGRlIGxhIG9wY2lcdTAwRjNuIGBrZXlgIGRlIGxhIFx1MDBGQWx0aW1hIHJlc3B1ZXN0YS4gKi9cbmZ1bmN0aW9uIF9vcGNpb25lc0RlKGtleSkge1xuICBjb25zdCBvcCA9IHN0YXRlLm9wY2lvbmVzIHx8IHt9O1xuICBjb25zdCBhcnIgPSBBcnJheS5pc0FycmF5KG9wW2tleV0pID8gb3Bba2V5XSA6IFtdO1xuICBpZiAoa2V5ID09PSAnY2xpZW50ZXMnKSB7XG4gICAgcmV0dXJuIGFyci5tYXAoKGMpID0+ICh7XG4gICAgICB2YWx1ZTogU3RyaW5nKGMuY29kZSksXG4gICAgICBsYWJlbDogU3RyaW5nKGMubmFtZSB8fCBjLmNvZGUpICsgJyAoJyArIFN0cmluZyhjLmNvZGUpICsgJyknLFxuICAgIH0pKTtcbiAgfVxuICBpZiAoa2V5ID09PSAnc2t1cycpIHtcbiAgICByZXR1cm4gYXJyLm1hcCgocykgPT4gKHtcbiAgICAgIHZhbHVlOiBTdHJpbmcocy5jb2RlKSxcbiAgICAgIGxhYmVsOiBTdHJpbmcocy5jb2RlKSArIChzLmRlc2MgPyAnIC0gJyArIFN0cmluZyhzLmRlc2MpIDogJycpLFxuICAgIH0pKTtcbiAgfVxuICByZXR1cm4gYXJyLm1hcCgodikgPT4gKHsgdmFsdWU6IFN0cmluZyh2KSwgbGFiZWw6IFN0cmluZyh2KSB9KSk7XG59XG5cbmZ1bmN0aW9uIF9yZXN1bWVuU2VsKGtleSwgb3BjaW9uZXMpIHtcbiAgY29uc3QgbiA9IHN0YXRlLnNlbFtrZXldLmxlbmd0aDtcbiAgaWYgKG4gPT09IDApIHJldHVybiAnVG9kb3MnO1xuICBpZiAobiA9PT0gMSkge1xuICAgIGNvbnN0IG8gPSBvcGNpb25lcy5maW5kKCh4KSA9PiB4LnZhbHVlID09PSBzdGF0ZS5zZWxba2V5XVswXSk7XG4gICAgcmV0dXJuIG8gPyBvLmxhYmVsIDogc3RhdGUuc2VsW2tleV1bMF07XG4gIH1cbiAgcmV0dXJuIG4gKyAnIHNlbGVjY2lvbmFkb3MnO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyRmlsdHJvKGRlZikge1xuICBpZiAoZGVmLmtleSA9PT0gJ3ZlbmRlZG9yZXMnICYmIF9pc1ZlbmRlZG9yKCkpIHtcbiAgICByZXR1cm4gKFxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1maWx0cm9cIj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvLWxhYmVsXCI+JyArXG4gICAgICBfZXNjSHRtbChkZWYubGFiZWwpICtcbiAgICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwiZHYtbXMtbG9ja2VkXCIgdGl0bGU9XCJWZXMgc29sbyB0dXMgY2xpZW50ZXNcIj4nICtcbiAgICAgIF9lc2NIdG1sKF9teVZlbmRvcigpIHx8ICdUdXMgY2xpZW50ZXMnKSArXG4gICAgICAnIFx1RDgzRFx1REQxMjwvZGl2PjwvZGl2PidcbiAgICApO1xuICB9XG4gIGNvbnN0IG9wY2lvbmVzID0gX29wY2lvbmVzRGUoZGVmLmtleSk7XG4gIGNvbnN0IHNlbGVjdGVkID0gbmV3IFNldChzdGF0ZS5zZWxbZGVmLmtleV0pO1xuICBsZXQgbGlzdCA9ICcnO1xuICBmb3IgKGNvbnN0IG8gb2Ygb3BjaW9uZXMpIHtcbiAgICBsaXN0ICs9XG4gICAgICAnPGxhYmVsIGNsYXNzPVwiZHYtbXMtb3B0XCIgZGF0YS1zZWFyY2g9XCInICtcbiAgICAgIF9lc2NIdG1sKG8ubGFiZWwudG9Mb3dlckNhc2UoKSkgK1xuICAgICAgJ1wiPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBkYXRhLWZpbHRybz1cIicgK1xuICAgICAgZGVmLmtleSArXG4gICAgICAnXCIgdmFsdWU9XCInICtcbiAgICAgIF9lc2NIdG1sKG8udmFsdWUpICtcbiAgICAgICdcIicgK1xuICAgICAgKHNlbGVjdGVkLmhhcyhvLnZhbHVlKSA/ICcgY2hlY2tlZCcgOiAnJykgK1xuICAgICAgJz4gPHNwYW4+JyArXG4gICAgICBfZXNjSHRtbChvLmxhYmVsKSArXG4gICAgICAnPC9zcGFuPjwvbGFiZWw+JztcbiAgfVxuICBpZiAoIWxpc3QpIGxpc3QgPSAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCIgc3R5bGU9XCJwYWRkaW5nOjZweFwiPlNpbiBvcGNpb25lcyB0b2Rhdlx1MDBFRGEuPC9kaXY+JztcbiAgcmV0dXJuIChcbiAgICAnPGRpdiBjbGFzcz1cImR2LWZpbHRyb1wiPjxkaXYgY2xhc3M9XCJkdi1maWx0cm8tbGFiZWxcIj4nICtcbiAgICBfZXNjSHRtbChkZWYubGFiZWwpICtcbiAgICAnPC9kaXY+PGRldGFpbHMgY2xhc3M9XCJkdi1tc1wiIGRhdGEtbXM9XCInICtcbiAgICBkZWYua2V5ICtcbiAgICAnXCI+PHN1bW1hcnk+JyArXG4gICAgX2VzY0h0bWwoX3Jlc3VtZW5TZWwoZGVmLmtleSwgb3BjaW9uZXMpKSArXG4gICAgJzwvc3VtbWFyeT48ZGl2IGNsYXNzPVwiZHYtbXMtcG9wXCI+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2Nhclx1MjAyNlwiIGRhdGEtbXMtc2VhcmNoPVwiJyArXG4gICAgZGVmLmtleSArXG4gICAgJ1wiPicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtbXMtYWN0aW9uc1wiPjxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtbGlua1wiIGRhdGEtbXMtY2xlYXI9XCInICtcbiAgICBkZWYua2V5ICtcbiAgICAnXCI+TGltcGlhcjwvYnV0dG9uPjwvZGl2PicgK1xuICAgICc8ZGl2IGNsYXNzPVwiZHYtbXMtbGlzdFwiPicgK1xuICAgIGxpc3QgK1xuICAgICc8L2Rpdj48L2Rpdj48L2RldGFpbHM+PC9kaXY+J1xuICApO1xufVxuXG4vKiogTGVlIGRlbCBET00gbG8gcXVlIGVsIHVzdWFyaW8gbWFyY1x1MDBGMy4gU29sbyBzZSBsbGFtYSBhbCB0b2NhciBcIkFwbGljYXJcIi4gKi9cbmZ1bmN0aW9uIF9yZWFkU2VsRnJvbURvbShyb290KSB7XG4gIGNvbnN0IG5leHQgPSBfc2VsVmFjaWEoKTtcbiAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl1bZGF0YS1maWx0cm9dJykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICBjb25zdCBrZXkgPSBlbC5nZXRBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJyk7XG4gICAgaWYgKGVsLmNoZWNrZWQgJiYgbmV4dFtrZXldKSBuZXh0W2tleV0ucHVzaChlbC52YWx1ZSk7XG4gIH0pO1xuICBpZiAoX2lzVmVuZGVkb3IoKSkgbmV4dC52ZW5kZWRvcmVzID0gW107XG4gIHN0YXRlLnNlbCA9IG5leHQ7XG4gIGNvbnN0IG1lc0VsID0gcm9vdC5xdWVyeVNlbGVjdG9yKCcjZHYtbWVzJyk7XG4gIGlmIChtZXNFbCAmJiAvXlxcZHs0fS1cXGR7Mn0kLy50ZXN0KG1lc0VsLnZhbHVlKSkgc3RhdGUubWVzID0gbWVzRWwudmFsdWU7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEFybWEgZWwgZXNxdWVsZXRvIChmaWx0cm9zIGFycmliYSwgcmVzdWx0YWRvcyBhYmFqbykgdW5hIHNvbGEgdmV6LiAqL1xuZnVuY3Rpb24gX2Vuc3VyZVNrZWxldG9uKCkge1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtYm9keScpO1xuICBpZiAoIWJvZHkpIHJldHVybiBudWxsO1xuICBpZiAoIWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkdi1maWx0cm9zLWhvc3QnKSB8fCAhZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKSkge1xuICAgIGJvZHkuaW5uZXJIVE1MID0gJzxkaXYgaWQ9XCJkdi1maWx0cm9zLWhvc3RcIj48L2Rpdj48ZGl2IGlkPVwiZHYtcmVzdWx0c1wiPjwvZGl2Pic7XG4gICAgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9IG51bGw7XG4gIH1cbiAgcmV0dXJuIGJvZHk7XG59XG5cbi8qKlxuICogUGFuZWwgZGUgZmlsdHJvcy4gU2UgcmUtYXJtYSBzb2xvIGN1YW5kbyBjYW1iaWFuIGxhcyBvcGNpb25lcyAodW5hIHZleiBwb3JcbiAqIHJlc3B1ZXN0YSksIGFsIHJlc2V0ZWFyIHBvciBjYW1iaW8gZGUgdXN1YXJpbyBvIGNvbiBcIkxpbXBpYXIgZmlsdHJvc1wiLiBOaSBlbFxuICogXCJDYXJnYW5kb1x1MjAyNlwiIG5pIFwiVmVyIG1cdTAwRTFzXCIgbG8gdG9jYW4sIGFzXHUwMEVEIG5vIHNlIHBpZXJkZW4gY2FtYmlvcyBzaW4gYXBsaWNhci5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyRmlsdHJvcyhmb3JjZSkge1xuICBjb25zdCBob3N0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWZpbHRyb3MtaG9zdCcpO1xuICBpZiAoIWhvc3QpIHJldHVybjtcbiAgaWYgKCFmb3JjZSAmJiBzdGF0ZS5vcGNpb25lc1JlbmRlcmVkID09PSBzdGF0ZS5vcGNpb25lcyAmJiBob3N0LmlubmVySFRNTCkgcmV0dXJuO1xuICBjb25zdCBwcmV2ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWZpbHRyb3MnKTtcbiAgY29uc3QgYWJpZXJ0byA9IHByZXYgPyAhIXByZXYub3BlbiA6IHdpbmRvdy5pbm5lcldpZHRoID4gNzAwO1xuICBsZXQgaHRtbCA9ICc8ZGV0YWlscyBjbGFzcz1cImR2LWZpbHRyb3NcIiBpZD1cImR2LWZpbHRyb3NcIicgKyAoYWJpZXJ0byA/ICcgb3BlbicgOiAnJykgKyAnPic7XG4gIGh0bWwgKz0gJzxzdW1tYXJ5PkZpbHRyb3M8L3N1bW1hcnk+PGRpdiBjbGFzcz1cImR2LWZpbHRyb3MtZ3JpZFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWZpbHRyb1wiPjxkaXYgY2xhc3M9XCJkdi1maWx0cm8tbGFiZWxcIj5NZXM8L2Rpdj48aW5wdXQgdHlwZT1cIm1vbnRoXCIgaWQ9XCJkdi1tZXNcIiBjbGFzcz1cImR2LWlucHV0XCIgdmFsdWU9XCInICtcbiAgICBfZXNjSHRtbChzdGF0ZS5tZXMpICtcbiAgICAnXCI+PC9kaXY+JztcbiAgZm9yIChjb25zdCBkZWYgb2YgRklMVFJPU19ERUYpIGh0bWwgKz0gX3JlbmRlckZpbHRybyhkZWYpO1xuICBodG1sICs9ICc8L2Rpdj48ZGl2IGNsYXNzPVwiZHYtZmlsdHJvcy1hY3Rpb25zXCI+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cImR2LWJ0bi1zZWNvbmRhcnlcIiBkYXRhLWR2LWFjdGlvbj1cImxpbXBpYXJcIj5MaW1waWFyIGZpbHRyb3M8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1idG4tcHJpbWFyeVwiIGlkPVwiZHYtYXBsaWNhclwiIGRhdGEtZHYtYWN0aW9uPVwiYXBsaWNhclwiJyArXG4gICAgKHN0YXRlLmxvYWRpbmcgPyAnIGRpc2FibGVkJyA6ICcnKSArXG4gICAgJz5BcGxpY2FyPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+PC9kZXRhaWxzPic7XG4gIGhvc3QuaW5uZXJIVE1MID0gaHRtbDtcbiAgc3RhdGUub3BjaW9uZXNSZW5kZXJlZCA9IHN0YXRlLm9wY2lvbmVzO1xufVxuXG5mdW5jdGlvbiBfc3luY0FwbGljYXJEaXNhYmxlZCgpIHtcbiAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LWFwbGljYXInKTtcbiAgaWYgKGJ0bikgYnRuLmRpc2FibGVkID0gISFzdGF0ZS5sb2FkaW5nO1xufVxuXG5mdW5jdGlvbiBfY2FyZCh0aXR1bG8sIHZhbG9yKSB7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1jYXJkXCI+PGRpdiBjbGFzcz1cImR2LWNhcmQtdGl0bGVcIj4nICtcbiAgICBfZXNjSHRtbCh0aXR1bG8pICtcbiAgICAnPC9kaXY+PGRpdiBjbGFzcz1cImR2LWNhcmQtdmFsdWVcIj4nICtcbiAgICBfZXNjSHRtbCh2YWxvcikgK1xuICAgICc8L2Rpdj48L2Rpdj4nXG4gICk7XG59XG5cbi8vIFBvcmNlbnRhamUgY29uIGNvbWEgZGVjaW1hbCAoZXMtQVIpOiA4MCw1JVxuZnVuY3Rpb24gX2ZtdFBjdChuKSB7XG4gIHJldHVybiAoXG4gICAgKE51bWJlcihuKSB8fCAwKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7XG4gICAgICBtaW5pbXVtRnJhY3Rpb25EaWdpdHM6IDAsXG4gICAgICBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEsXG4gICAgfSkgKyAnJSdcbiAgKTtcbn1cblxuLy8gQUFBQS1NTS1ERCAtPiBERC9NTS9BQUFBIChzaSBubyB0aWVuZSBlc2UgZm9ybWF0bywgc2UgZGV2dWVsdmUgdGFsIGN1YWwpXG5mdW5jdGlvbiBfZm10RmVjaGEoZikge1xuICBjb25zdCBtID0gL14oXFxkezR9KS0oXFxkezJ9KS0oXFxkezJ9KS8uZXhlYyhTdHJpbmcoZiA9PSBudWxsID8gJycgOiBmKSk7XG4gIHJldHVybiBtID8gbVszXSArICcvJyArIG1bMl0gKyAnLycgKyBtWzFdIDogU3RyaW5nKGYgPT0gbnVsbCA/ICcnIDogZik7XG59XG5cbmZ1bmN0aW9uIF90aXBvTGFiZWwodCkge1xuICByZXR1cm4gdCA9PT0gJ3Zpc2l0YScgPyAnVmlzaXRhJyA6ICdDb250YWN0byc7XG59XG5cbi8vIFRhYmxhIGRlIGludGVyYWNjaW9uZXMgKHNvbG8gZWwgY29udGVuZWRvciBjb24gc2Nyb2xsOyBzZSByZWVtcGxhemEgYWwgYnVzY2FyKS5cbmZ1bmN0aW9uIF9pbnRlcmFjY2lvbmVzVGFibGEocm93cywgdG90YWwsIHF1ZXJ5KSB7XG4gIGNvbnN0IHEgPSBTdHJpbmcocXVlcnkgfHwgJycpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAudHJpbSgpO1xuICBjb25zdCBsaXN0YSA9IEFycmF5LmlzQXJyYXkocm93cykgPyByb3dzIDogW107XG4gIGNvbnN0IGZpbHRlcmVkID0gcVxuICAgID8gbGlzdGEuZmlsdGVyKChyKSA9PlxuICAgICAgICAoXG4gICAgICAgICAgU3RyaW5nKHIuY2xpZW50ZSkgK1xuICAgICAgICAgICcgJyArXG4gICAgICAgICAgX2ZtdEZlY2hhKHIuZmVjaGEpICtcbiAgICAgICAgICAnICcgK1xuICAgICAgICAgIFN0cmluZyhyLnZlbmRlZG9yKSArXG4gICAgICAgICAgJyAnICtcbiAgICAgICAgICBfdGlwb0xhYmVsKHIudGlwbylcbiAgICAgICAgKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgLmluY2x1ZGVzKHEpXG4gICAgICApXG4gICAgOiBsaXN0YTtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdGFibGUtd3JhcCBkdi1pbnRlci13cmFwXCI+PHRhYmxlIGNsYXNzPVwiZHYtdGFibGVcIj48dGhlYWQ+PHRyPjx0aD5DbGllbnRlPC90aD48dGg+RmVjaGE8L3RoPjx0aD5WZW5kZWRvcjwvdGg+PHRoPlRpcG88L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+JztcbiAgZm9yIChjb25zdCByIG9mIGZpbHRlcmVkKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzx0cj48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmNsaWVudGUpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRGZWNoYShyLmZlY2hhKSkgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoci52ZW5kZWRvcikgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgX2VzY0h0bWwoX3RpcG9MYWJlbChyLnRpcG8pKSArXG4gICAgICAnPC90ZD48L3RyPic7XG4gIH1cbiAgaWYgKGZpbHRlcmVkLmxlbmd0aCA9PT0gMClcbiAgICBodG1sICs9ICc8dHI+PHRkIGNvbHNwYW49XCI0XCIgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiByZXN1bHRhZG9zLjwvdGQ+PC90cj4nO1xuICBodG1sICs9ICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcbiAgY29uc3QgdG90YWxOID0gTnVtYmVyKHRvdGFsKSB8fCAwO1xuICBpZiAodG90YWxOID4gbGlzdGEubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPk1vc3RyYW5kbyAnICtcbiAgICAgIF9lc2NIdG1sKF9mbXRVZHMobGlzdGEubGVuZ3RoKSkgK1xuICAgICAgJyBkZSAnICtcbiAgICAgIF9lc2NIdG1sKF9mbXRVZHModG90YWxOKSkgK1xuICAgICAgJzwvZGl2Pic7XG4gIH1cbiAgcmV0dXJuIGh0bWw7XG59XG5cbi8qKiBUYWJsYSBkZSBpbnRlcmFjY2lvbmVzIGNvbiBidXNjYWRvci4gRWwgdGV4dG8gYnVzY2FkbyBzZSBwb25lIHBvciBET00uICovXG5mdW5jdGlvbiBfaW50ZXJhY2Npb25lc1NlY3Rpb24odCwgcXVlcnkpIHtcbiAgY29uc3Qgcm93cyA9ICh0ICYmIHQucm93cykgfHwgW107XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtaW50ZXJhY2Npb25lc1wiPjxkaXYgY2xhc3M9XCJkdi1zZWN0aW9uLWhlYWRcIj48aDM+SW50ZXJhY2Npb25lczwvaDM+PC9kaXY+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwic2VhcmNoXCIgY2xhc3M9XCJkdi1tcy1zZWFyY2hcIiBpZD1cImR2LWludGVyYWNjaW9uZXMtYnVzY2FyXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXIgY2xpZW50ZSwgdmVuZGVkb3IgbyB0aXBvXHUyMDI2XCI+JyArXG4gICAgJzxkaXYgY2xhc3M9XCJkdi1pbnRlci1ib2R5XCI+JyArXG4gICAgX2ludGVyYWNjaW9uZXNUYWJsYShyb3dzLCB0ICYmIHQudG90YWwsIHF1ZXJ5KSArXG4gICAgJzwvZGl2Pjwvc2VjdGlvbj4nXG4gICk7XG59XG5cbi8qKiBCbG9xdWUgZGUgZ2VzdGlcdTAwRjNuOiB0YXJqZXRhcyArIG5vdGEgKyB0YWJsYSBkZSBpbnRlcmFjY2lvbmVzLiAqL1xuZnVuY3Rpb24gX2dlc3Rpb25TZWN0aW9uKGcsIHNlY2Npb25lcywgcXVlcnkpIHtcbiAgaWYgKCFnIHx8IChzZWNjaW9uZXMgJiYgc2VjY2lvbmVzLmdlc3Rpb24gJiYgc2VjY2lvbmVzLmdlc3Rpb24uZXJyb3IpKSB7XG4gICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwiZHYtY2FyZHNcIiBpZD1cImR2LWdlc3Rpb25cIj4nICsgX2NhcmQoJ0dlc3RpXHUwMEYzbicsICdObyBkaXNwb25pYmxlJykgKyAnPC9kaXY+JztcbiAgfVxuICBsZXQgaHRtbCA9ICc8ZGl2IGNsYXNzPVwiZHYtY2FyZHNcIiBpZD1cImR2LWdlc3Rpb25cIj4nO1xuICBodG1sICs9IF9jYXJkKCdUYXJnZXQnLCBnLnRhcmdldCA9PSBudWxsID8gJ1NpbiB0YXJnZXQnIDogX2ZtdEFycyhnLnRhcmdldCkpO1xuICBodG1sICs9IF9jYXJkKFxuICAgICclIGN1bXBsaW1pZW50bycsXG4gICAgZy5jdW1wbGltaWVudG9QY3QgPT0gbnVsbCA/ICdTaW4gdGFyZ2V0JyA6IF9mbXRQY3QoZy5jdW1wbGltaWVudG9QY3QpXG4gICk7XG4gIGh0bWwgKz0gX2NhcmQoJ1JlbmRpY2lvbmVzIFx1MjAxMyBtb250bycsIF9mbXRBcnMoZy5yZW5kaWNpb25lc0FycykpO1xuICBodG1sICs9IF9jYXJkKCdCYXNlIGFjdGl2YScsIF9mbXRVZHMoZy5iYXNlQWN0aXZhKSk7XG4gIGh0bWwgKz0gX2NhcmQoJ1RpY2tldCBwcm9tZWRpbycsIF9mbXRBcnMoZy50aWNrZXRQcm9tZWRpbykpO1xuICBodG1sICs9IF9jYXJkKCdOXHUwMEIwIHZpc2l0YXMnLCBfZm10VWRzKGcudmlzaXRhcykpO1xuICBodG1sICs9IF9jYXJkKCdOXHUwMEIwIGNvbnRhY3RhZG9zJywgX2ZtdFVkcyhnLmNvbnRhY3RhZG9zKSk7XG4gIGh0bWwgKz0gX2NhcmQoJ05cdTAwQjAgaW50ZXJhY2Npb25lcycsIF9mbXRVZHMoZy5pbnRlcmFjY2lvbmVzKSk7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmIChnLmZpbHRyb3NOb0FwbGljYW4pIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGEgZHYtbXV0ZWRcIj5UYXJnZXQgeSByZW5kaWNpb25lcyBubyBzZSBmaWx0cmFuIHBvciBjbGllbnRlIG5pIHByb2R1Y3RvOyB2aXNpdGFzIHkgY29udGFjdG9zIG5vIHNlIGZpbHRyYW4gcG9yIHByb2R1Y3RvLjwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPSBfaW50ZXJhY2Npb25lc1NlY3Rpb24oZy50YWJsYUludGVyYWNjaW9uZXMsIHF1ZXJ5KTtcbiAgcmV0dXJuIGh0bWw7XG59XG5cbi8vIFRpcG9zIHBlcm1pdGlkb3MgZGVsIFwiVmVyIG1cdTAwRTFzXCI6IGxpc3RhIGJsYW5jYSAoZWwgYXRyaWJ1dG8gZGVsIERPTSBudW5jYSBzZSByZXVzYSBlbiBlbCBIVE1MKS5cbmZ1bmN0aW9uIF90aXBvVmVyTWFzKHRpcG9Jbikge1xuICByZXR1cm4gdGlwb0luID09PSAnZGluZXJvJyA/ICdkaW5lcm8nIDogdGlwb0luID09PSAnY2xpZW50ZXMnID8gJ2NsaWVudGVzJyA6ICd1bmlkYWRlcyc7XG59XG5cbmZ1bmN0aW9uIF92ZXJNYXNUYWJsYSh0aXBvSW4sIHJvd3MpIHtcbiAgY29uc3QgdGlwbyA9IF90aXBvVmVyTWFzKHRpcG9Jbik7XG4gIGNvbnN0IHEgPSBzdGF0ZS52ZXJNYXNRdWVyeVt0aXBvXS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgY29uc3QgZXNDbGkgPSB0aXBvID09PSAnY2xpZW50ZXMnO1xuICAvLyBQb3NpY2lcdTAwRjNuIGRlbCByYW5raW5nIGNhbGN1bGFkYSB1bmEgc29sYSB2ZXogKHNpbiBpbmRleE9mIHBvciBmaWxhKS5cbiAgY29uc3QgcmFua2VkID0gcm93cy5tYXAoKHIsIGkpID0+ICh7IHIsIHBvczogaSArIDEgfSkpO1xuICBjb25zdCBmaWx0ZXJlZCA9IHFcbiAgICA/IHJhbmtlZC5maWx0ZXIoKHgpID0+XG4gICAgICAgIChlc0NsaVxuICAgICAgICAgID8gU3RyaW5nKHguci5ub21icmUpICsgJyAnICsgU3RyaW5nKHguci5jb2RlKVxuICAgICAgICAgIDogU3RyaW5nKHguci5za3UpICsgJyAnICsgU3RyaW5nKHguci5kZXNjIHx8ICcnKVxuICAgICAgICApXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAuaW5jbHVkZXMocSlcbiAgICAgIClcbiAgICA6IHJhbmtlZDtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdmVybWFzXCI+PGlucHV0IHR5cGU9XCJzZWFyY2hcIiBjbGFzcz1cImR2LW1zLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiJyArXG4gICAgKGVzQ2xpID8gJ0J1c2NhciBjbGllbnRlXHUyMDI2JyA6ICdCdXNjYXIgU0tVIG8gZGVzY3JpcGNpXHUwMEYzblx1MjAyNicpICtcbiAgICAnXCIgZGF0YS12ZXJtYXMtc2VhcmNoPVwiJyArXG4gICAgdGlwbyArXG4gICAgJ1wiPjxkaXYgY2xhc3M9XCJkdi10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwiZHYtdGFibGVcIj48dGhlYWQ+PHRyPicgK1xuICAgIChlc0NsaVxuICAgICAgPyAnPHRoPiM8L3RoPjx0aD5DbGllbnRlPC90aD48dGggY2xhc3M9XCJudW1cIj5GYWN0dXJhZG88L3RoPidcbiAgICAgIDogJzx0aD4jPC90aD48dGg+U0tVPC90aD48dGg+RGVzY3JpcGNpXHUwMEYzbjwvdGg+PHRoIGNsYXNzPVwibnVtXCI+VW5pZGFkZXM8L3RoPjx0aCBjbGFzcz1cIm51bVwiPkRpbmVybzwvdGg+JykgK1xuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgeyByLCBwb3MgfSBvZiBmaWx0ZXJlZCkge1xuICAgIGlmIChlc0NsaSkge1xuICAgICAgaHRtbCArPVxuICAgICAgICAnPHRyPjx0ZD4nICtcbiAgICAgICAgcG9zICtcbiAgICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgICBfZXNjSHRtbChyLm5vbWJyZSkgK1xuICAgICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmZhY3R1cmFkbykpICtcbiAgICAgICAgJzwvdGQ+PC90cj4nO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGh0bWwgKz1cbiAgICAgICc8dHI+PHRkPicgK1xuICAgICAgcG9zICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmRlc2MpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKVxuICAgIGh0bWwgKz0gJzx0cj48dGQgY29sc3Bhbj1cIicgKyAoZXNDbGkgPyAzIDogNSkgKyAnXCIgY2xhc3M9XCJkdi1tdXRlZFwiPlNpbiByZXN1bHRhZG9zLjwvdGQ+PC90cj4nO1xuICBodG1sICs9ICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+PC9kaXY+JztcbiAgcmV0dXJuIGh0bWw7XG59XG5cbmZ1bmN0aW9uIF90b3BTZWN0aW9uKHRpcG8sIHRpdHVsbywgcm93cykge1xuICBjb25zdCBhYmllcnRvID0gc3RhdGUudmVyTWFzW3RpcG9dO1xuICBjb25zdCB0b3RhbCA9IHJvd3MubGVuZ3RoO1xuICBjb25zdCBoID0gTWF0aC5tYXgoMTIwLCBNYXRoLm1pbihUT1BfTiwgdG90YWwpICogMjIgKyA0MCk7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiPjxkaXYgY2xhc3M9XCJkdi1zZWN0aW9uLWhlYWRcIj48aDM+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvaDM+JyArXG4gICAgKHRvdGFsID4gMFxuICAgICAgPyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJkdi1saW5rXCIgZGF0YS12ZXJtYXM9XCInICtcbiAgICAgICAgdGlwbyArXG4gICAgICAgICdcIiBhcmlhLWV4cGFuZGVkPVwiJyArXG4gICAgICAgIChhYmllcnRvID8gJ3RydWUnIDogJ2ZhbHNlJykgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIChhYmllcnRvID8gJ1ZlciBtZW5vcycgOiAnVmVyIG1cdTAwRTFzJykgK1xuICAgICAgICAnICgnICtcbiAgICAgICAgdG90YWwgK1xuICAgICAgICAnKTwvYnV0dG9uPidcbiAgICAgIDogJycpICtcbiAgICAnPC9kaXY+JyArXG4gICAgKHRvdGFsID4gMFxuICAgICAgPyAnPGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6JyArXG4gICAgICAgIGggK1xuICAgICAgICAncHhcIj48Y2FudmFzIGlkPVwiZHYtY2hhcnQtdG9wLScgK1xuICAgICAgICB0aXBvICtcbiAgICAgICAgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArXG4gICAgICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICAgICAnXCI+PC9jYW52YXM+PC9kaXY+J1xuICAgICAgOiAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGRhdG9zLjwvZGl2PicpICtcbiAgICAoYWJpZXJ0byA/IF92ZXJNYXNUYWJsYSh0aXBvLCByb3dzKSA6ICcnKSArXG4gICAgJzwvc2VjdGlvbj4nXG4gICk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHJvZHVjdG9zLCBjb2JlcnR1cmEgeSBmYWN0dXJhY2lcdTAwRjNuIHBvciBjbGllbnRlIChlbnRyZWdhIEIpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgUFJPRFVDVE9TX01BWF9GSUxBUyA9IDIwMDtcbmNvbnN0IFBST0RVQ1RPU19ERUJPVU5DRV9NUyA9IDIwMDtcbi8vIE1lbW8gZGVsIHN0b2NrIHBvciBTS1U6IHNlIGxpbXBpYSBhbCByZW5kZXJpemFyIHJlc3VsdGFkb3MgeSBhbCBjYW1iaWFyIGRlIHVzdWFyaW8uXG5jb25zdCBfc3RvY2tNZW1vID0gbmV3IE1hcCgpO1xubGV0IF9wcm9kVGltZXIgPSBudWxsO1xuXG4vKiogU3RvY2sgZGUgbGEgYXBwIHBhcmEgdW4gU0tVIChjb24gbWVtbykuIFRvZG8gbnVsbCBzaSBlbCBzdG9jayB0b2Rhdlx1MDBFRGEgbm8gY2FyZ1x1MDBGMyAoXCJcdTIwMjZcIikuICovXG5mdW5jdGlvbiBfc3RvY2tDb2x1bW5hcyhza3UpIHtcbiAgY29uc3QgayA9IFN0cmluZyhza3UpO1xuICBpZiAoX3N0b2NrTWVtby5oYXMoaykpIHJldHVybiBfc3RvY2tNZW1vLmdldChrKTtcbiAgY29uc3QgciA9IF9zdG9ja0NvbHVtbmFzQ2FsYyhza3UpO1xuICBfc3RvY2tNZW1vLnNldChrLCByKTtcbiAgcmV0dXJuIHI7XG59XG5cbmZ1bmN0aW9uIF9zdG9ja0NvbHVtbmFzQ2FsYyhza3UpIHtcbiAgY29uc3QgdmFjaW8gPSB7IHJlc2VydmFkYXM6IG51bGwsIGxpYnJlOiBudWxsLCBzdG9jazogbnVsbCB9O1xuICB0cnkge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJyB8fCB0eXBlb2Ygd2luZG93LmdldFN0b2NrQnJlYWtkb3duICE9PSAnZnVuY3Rpb24nKVxuICAgICAgcmV0dXJuIHZhY2lvO1xuICAgIC8vIGdldFN0b2NrRGlzcG9uaWJsZVZlbnRhIGRldnVlbHZlIG51bGwgbWllbnRyYXMgZWwgc3RvY2sgbm8gZXN0XHUwMEUxIGNhcmdhZG8uXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmICh3aW5kb3cuZ2V0U3RvY2tEaXNwb25pYmxlVmVudGEoc2t1KSA9PT0gbnVsbCkgcmV0dXJuIHZhY2lvO1xuICAgIH1cbiAgICBjb25zdCBiID0gd2luZG93LmdldFN0b2NrQnJlYWtkb3duKHNrdSk7XG4gICAgaWYgKCFiKSByZXR1cm4gdmFjaW87XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlc2VydmFkYXM6IE51bWJlcihiLnJlc2VydmFkYXNUb3RhbCkgfHwgMCxcbiAgICAgIGxpYnJlOiBOdW1iZXIoYi5saWJyZSkgfHwgMCxcbiAgICAgIHN0b2NrOiBOdW1iZXIoYi5maXNpY29EZXAxMSkgfHwgMCxcbiAgICB9O1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiB2YWNpbztcbiAgfVxufVxuXG5mdW5jdGlvbiBfZm10U3RvY2tDb2wobikge1xuICByZXR1cm4gbiA9PSBudWxsID8gJ1x1MjAyNicgOiBfZm10VWRzKG4pO1xufVxuXG4vKiogRXRpcXVldGEgZGUgY29iZXJ0dXJhOiBcIjM2IGRlIDY2IFx1MDBCNyA1NCw1NSVcIiAoY29tYSBkZWNpbWFsKTsgc2luIHBvcmNlbnRhamU6IFwiMzYgZGUgMCBcdTAwQjcgXHUyMDE0XCIuICovXG5mdW5jdGlvbiBfY29iZXJ0dXJhRXRpcXVldGEocikge1xuICBjb25zdCBwY3QgPVxuICAgIHIucGN0ID09IG51bGxcbiAgICAgID8gJ1x1MjAxNCdcbiAgICAgIDogKE51bWJlcihyLnBjdCkgfHwgMCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgICAgIG1pbmltdW1GcmFjdGlvbkRpZ2l0czogMCxcbiAgICAgICAgICBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDIsXG4gICAgICAgIH0pICsgJyUnO1xuICByZXR1cm4gKE51bWJlcihyLmNvbXByYXJvbikgfHwgMCkgKyAnIGRlICcgKyAoTnVtYmVyKHIuZGFkb3NBbHRhKSB8fCAwKSArICcgXHUwMEI3ICcgKyBwY3Q7XG59XG5cbi8qKiBUYWJsYSBkZSBwcm9kdWN0b3MgKHNvbG8gZWwgY29udGVuZWRvciBjb24gc2Nyb2xsOyBzZSByZWVtcGxhemEgYWwgYnVzY2FyKS4gKi9cbmZ1bmN0aW9uIF9wcm9kdWN0b3NUYWJsYShyb3dzLCBxdWVyeSkge1xuICBjb25zdCBxID0gU3RyaW5nKHF1ZXJ5IHx8ICcnKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnRyaW0oKTtcbiAgY29uc3QgbGlzdGEgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdO1xuICBjb25zdCBtYXRjaGVzID0gcVxuICAgID8gbGlzdGEuZmlsdGVyKChyKSA9PlxuICAgICAgICAoU3RyaW5nKHIuY2F0ZWdvcmlhKSArICcgJyArIFN0cmluZyhyLmZhbWlsaWEpICsgJyAnICsgU3RyaW5nKHIuc2t1KSlcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhxKVxuICAgICAgKVxuICAgIDogbGlzdGE7XG4gIGNvbnN0IGZpbHRlcmVkID0gbWF0Y2hlcy5zbGljZSgwLCBQUk9EVUNUT1NfTUFYX0ZJTEFTKTtcbiAgbGV0IGh0bWwgPVxuICAgICc8ZGl2IGNsYXNzPVwiZHYtdGFibGUtd3JhcFwiPjx0YWJsZSBjbGFzcz1cImR2LXRhYmxlXCI+PHRoZWFkPjx0cj48dGg+Q0FURUdPUklBPC90aD48dGg+RkFNSUxJQTwvdGg+PHRoPlNLVTwvdGg+PHRoIGNsYXNzPVwibnVtXCI+VU5JREFERVMgVkVORElEQVM8L3RoPjx0aCBjbGFzcz1cIm51bVwiPkZBQ1RVUkFETzwvdGg+PHRoIGNsYXNzPVwibnVtXCI+VU5JREFERVMgQkFDS09SREVSPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBSRVNFUlZBREFTPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBMSUJSRSBQQVJBIExBIFZFTlRBPC90aD48dGggY2xhc3M9XCJudW1cIj5VTklEQURFUyBFTiBTVE9DSzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4nO1xuICBmb3IgKGNvbnN0IHIgb2YgZmlsdGVyZWQpIHtcbiAgICBjb25zdCBzdCA9IF9zdG9ja0NvbHVtbmFzKHIuc2t1KTtcbiAgICBodG1sICs9XG4gICAgICAnPHRyPjx0ZD4nICtcbiAgICAgIF9lc2NIdG1sKHIuY2F0ZWdvcmlhKSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBfZXNjSHRtbChyLmZhbWlsaWEpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIF9lc2NIdG1sKHIuc2t1KSArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRVZHMoci51ZHNWZW5kaWRhcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdEFycyhyLmZhY3R1cmFkbykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhyLnVkc0JhY2tvcmRlcikpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFN0b2NrQ29sKHN0LnJlc2VydmFkYXMpKSArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgIF9lc2NIdG1sKF9mbXRTdG9ja0NvbChzdC5saWJyZSkpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgX2VzY0h0bWwoX2ZtdFN0b2NrQ29sKHN0LnN0b2NrKSkgK1xuICAgICAgJzwvdGQ+PC90cj4nO1xuICB9XG4gIGlmIChmaWx0ZXJlZC5sZW5ndGggPT09IDApXG4gICAgaHRtbCArPSAnPHRyPjx0ZCBjb2xzcGFuPVwiOVwiIGNsYXNzPVwiZHYtbXV0ZWRcIj5TaW4gcmVzdWx0YWRvcy48L3RkPjwvdHI+JztcbiAgaHRtbCArPSAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG4gIGlmIChtYXRjaGVzLmxlbmd0aCA+IGZpbHRlcmVkLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IGNsYXNzPVwiZHYtbXV0ZWRcIj5Nb3N0cmFuZG8gJyArXG4gICAgICBQUk9EVUNUT1NfTUFYX0ZJTEFTICtcbiAgICAgICcgZGUgJyArXG4gICAgICBfZXNjSHRtbChfZm10VWRzKG1hdGNoZXMubGVuZ3RoKSkgK1xuICAgICAgJy4gVXNcdTAwRTEgZWwgYnVzY2Fkb3IgcGFyYSB2ZXIgZWwgcmVzdG8uPC9kaXY+JztcbiAgfVxuICByZXR1cm4gaHRtbDtcbn1cblxuZnVuY3Rpb24gX25vRGlzcG9uaWJsZShpZCwgdGl0dWxvKSB7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiJyArXG4gICAgaWQgK1xuICAgICdcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICc8L2gzPjwvZGl2PjxkaXYgY2xhc3M9XCJkdi1tdXRlZFwiPk5vIGRpc3BvbmlibGU8L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfcHJvZHVjdG9zU2VjdGlvbihyb3dzLCBzZWNjaW9uZXMsIHF1ZXJ5KSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyb3dzKSB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5wcm9kdWN0b3MgJiYgc2VjY2lvbmVzLnByb2R1Y3Rvcy5lcnJvcikpIHtcbiAgICByZXR1cm4gX25vRGlzcG9uaWJsZSgnZHYtcHJvZHVjdG9zJywgJ1Byb2R1Y3RvcycpO1xuICB9XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtcHJvZHVjdG9zXCI+PGRpdiBjbGFzcz1cImR2LXNlY3Rpb24taGVhZFwiPjxoMz5Qcm9kdWN0b3M8L2gzPjwvZGl2PicgK1xuICAgICc8aW5wdXQgdHlwZT1cInNlYXJjaFwiIGNsYXNzPVwiZHYtbXMtc2VhcmNoXCIgaWQ9XCJkdi1wcm9kdWN0b3MtYnVzY2FyXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXIgY2F0ZWdvclx1MDBFRGEsIGZhbWlsaWEgbyBTS1VcdTIwMjZcIj4nICtcbiAgICAnPGRpdiBjbGFzcz1cImR2LXByb2QtYm9keVwiPicgK1xuICAgIF9wcm9kdWN0b3NUYWJsYShyb3dzLCBxdWVyeSkgK1xuICAgICc8L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfY29iZXJ0dXJhU2VjdGlvbihyb3dzLCBzZWNjaW9uZXMpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHJvd3MpIHx8IChzZWNjaW9uZXMgJiYgc2VjY2lvbmVzLmNvYmVydHVyYSAmJiBzZWNjaW9uZXMuY29iZXJ0dXJhLmVycm9yKSkge1xuICAgIHJldHVybiBfbm9EaXNwb25pYmxlKCdkdi1jb2JlcnR1cmEtY2hhcnQnLCAnQ29iZXJ0dXJhIGRlIGNsaWVudGVzJyk7XG4gIH1cbiAgY29uc3QgaCA9IE1hdGgubWF4KDEyMCwgcm93cy5sZW5ndGggKiA0NCArIDQwKTtcbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCIgaWQ9XCJkdi1jb2JlcnR1cmEtY2hhcnRcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkNvYmVydHVyYSBkZSBjbGllbnRlczwvaDM+PC9kaXY+JyArXG4gICAgKHJvd3MubGVuZ3RoID4gMFxuICAgICAgPyAnPGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6JyArXG4gICAgICAgIGggK1xuICAgICAgICAncHhcIj48Y2FudmFzIGlkPVwiZHYtY2FudmFzLWNvYmVydHVyYVwiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiQ29iZXJ0dXJhIGRlIGNsaWVudGVzXCI+PC9jYW52YXM+PC9kaXY+J1xuICAgICAgOiAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGRhdG9zLjwvZGl2PicpICtcbiAgICAnPC9zZWN0aW9uPidcbiAgKTtcbn1cblxuLy8gQ2FtcGFcdTAwRjFhczogdW5hIHRhcmpldGEgcG9yIGNhbXBhXHUwMEYxYSBjb24gdmVudGFzLCBvYmpldGl2byB5IGF2YW5jZS5cbmZ1bmN0aW9uIF9jYW1wYW5pYXNTZWN0aW9uKHJvd3MsIHNlY2Npb25lcykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkocm93cykgfHwgKHNlY2Npb25lcyAmJiBzZWNjaW9uZXMuY2FtcGFuaWFzICYmIHNlY2Npb25lcy5jYW1wYW5pYXMuZXJyb3IpKSB7XG4gICAgcmV0dXJuIF9ub0Rpc3BvbmlibGUoJ2R2LWNhbXBhbmlhcycsICdDYW1wYVx1MDBGMWFzJyk7XG4gIH1cbiAgbGV0IGN1ZXJwbyA9ICcnO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICBjdWVycG8gPSAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGNhbXBhXHUwMEYxYXMgYWN0aXZhczwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgZm9yIChjb25zdCBjIG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IG9iamV0aXZvID1cbiAgICAgICAgYy5vYmpldGl2b1RpcG8gPT09ICdtb25leScgPyBfZm10QXJzKGMub2JqZXRpdm8pIDogX2ZtdFVkcyhjLm9iamV0aXZvKSArICcgdSc7XG4gICAgICBjb25zdCBwY3QgPSBjLnBjdCA9PSBudWxsID8gbnVsbCA6IE51bWJlcihjLnBjdCk7XG4gICAgICBjb25zdCBhbmNobyA9IHBjdCA9PSBudWxsID8gMCA6IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcGN0KSk7XG4gICAgICBjdWVycG8gKz1cbiAgICAgICAgJzxkaXYgY2xhc3M9XCJkdi1jYW1wXCI+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwiZHYtY2FtcC1ub21icmVcIj4nICtcbiAgICAgICAgX2VzY0h0bWwoYy5ub21icmUpICtcbiAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cImR2LWNhbXAtZmVjaGFzXCI+JyArXG4gICAgICAgIF9lc2NIdG1sKF9mbXRGZWNoYShjLmRlc2RlKSkgK1xuICAgICAgICAnIGFsICcgK1xuICAgICAgICBfZXNjSHRtbChfZm10RmVjaGEoYy5oYXN0YSkpICtcbiAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAnPGRpdiBjbGFzcz1cImR2LWNhbXAtZGF0b3NcIj5WZW5kaWRvOiAnICtcbiAgICAgICAgX2VzY0h0bWwoX2ZtdFVkcyhjLnVkcykpICtcbiAgICAgICAgJyB1IFx1MDBCNyAnICtcbiAgICAgICAgX2VzY0h0bWwoX2ZtdEFycyhjLmFycykpICtcbiAgICAgICAgJyBcdTIwMTQgT2JqZXRpdm86ICcgK1xuICAgICAgICBfZXNjSHRtbChvYmpldGl2bykgK1xuICAgICAgICAnIFx1MjAxNCAnICtcbiAgICAgICAgX2VzY0h0bWwocGN0ID09IG51bGwgPyAnXHUyMDE0JyA6IF9mbXRQY3QocGN0KSkgK1xuICAgICAgICAnPC9kaXY+JyArXG4gICAgICAgICc8ZGl2IGNsYXNzPVwiZHYtY2FtcC1iYXJcIj48ZGl2IGNsYXNzPVwiZHYtY2FtcC1iYXItZmlsbFwiIHN0eWxlPVwid2lkdGg6JyArXG4gICAgICAgIGFuY2hvLnRvRml4ZWQoMSkgK1xuICAgICAgICAnJVwiPjwvZGl2PjwvZGl2PicgK1xuICAgICAgICAnPC9kaXY+JztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIChcbiAgICAnPHNlY3Rpb24gY2xhc3M9XCJkdi1zZWN0aW9uXCIgaWQ9XCJkdi1jYW1wYW5pYXNcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkNhbXBhXHUwMEYxYXM8L2gzPjwvZGl2PicgK1xuICAgIGN1ZXJwbyArXG4gICAgJzwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9jbGllbnRlc1NlY3Rpb24ocm93cywgc2VjY2lvbmVzKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyb3dzKSB8fCAoc2VjY2lvbmVzICYmIHNlY2Npb25lcy5jbGllbnRlcyAmJiBzZWNjaW9uZXMuY2xpZW50ZXMuZXJyb3IpKSB7XG4gICAgcmV0dXJuIF9ub0Rpc3BvbmlibGUoJ2R2LWNsaWVudGVzLWNoYXJ0JywgJ0ZhY3R1cmFjaVx1MDBGM24gcG9yIGNsaWVudGUnKTtcbiAgfVxuICBjb25zdCBhYmllcnRvID0gc3RhdGUudmVyTWFzLmNsaWVudGVzO1xuICBjb25zdCB0b3RhbCA9IHJvd3MubGVuZ3RoO1xuICBjb25zdCBoID0gTWF0aC5tYXgoMTIwLCBNYXRoLm1pbihUT1BfTiwgdG90YWwpICogMjIgKyA0MCk7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiIGlkPVwiZHYtY2xpZW50ZXMtY2hhcnRcIj48ZGl2IGNsYXNzPVwiZHYtc2VjdGlvbi1oZWFkXCI+PGgzPkZhY3R1cmFjaVx1MDBGM24gcG9yIGNsaWVudGUgLSBUb3AgMjA8L2gzPicgK1xuICAgICh0b3RhbCA+IDBcbiAgICAgID8gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwiZHYtbGlua1wiIGRhdGEtdmVybWFzPVwiY2xpZW50ZXNcIiBhcmlhLWV4cGFuZGVkPVwiJyArXG4gICAgICAgIChhYmllcnRvID8gJ3RydWUnIDogJ2ZhbHNlJykgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIChhYmllcnRvID8gJ1ZlciBtZW5vcycgOiAnVmVyIG1cdTAwRTFzJykgK1xuICAgICAgICAnICgnICtcbiAgICAgICAgdG90YWwgK1xuICAgICAgICAnKTwvYnV0dG9uPidcbiAgICAgIDogJycpICtcbiAgICAnPC9kaXY+JyArXG4gICAgKHRvdGFsID4gMFxuICAgICAgPyAnPGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6JyArXG4gICAgICAgIGggK1xuICAgICAgICAncHhcIj48Y2FudmFzIGlkPVwiZHYtY2hhcnQtdG9wLWNsaWVudGVzXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCJGYWN0dXJhY2lcdTAwRjNuIHBvciBjbGllbnRlXCI+PC9jYW52YXM+PC9kaXY+J1xuICAgICAgOiAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+U2luIGRhdG9zLjwvZGl2PicpICtcbiAgICAoYWJpZXJ0byA/IF92ZXJNYXNUYWJsYSgnY2xpZW50ZXMnLCByb3dzKSA6ICcnKSArXG4gICAgJzwvc2VjdGlvbj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9saW5lU2VjdGlvbihpZCwgdGl0dWxvKSB7XG4gIHJldHVybiAoXG4gICAgJzxzZWN0aW9uIGNsYXNzPVwiZHYtc2VjdGlvblwiPjxkaXYgY2xhc3M9XCJkdi1zZWN0aW9uLWhlYWRcIj48aDM+JyArXG4gICAgX2VzY0h0bWwodGl0dWxvKSArXG4gICAgJzwvaDM+PC9kaXY+PGRpdiBjbGFzcz1cImR2LWNoYXJ0XCIgc3R5bGU9XCJoZWlnaHQ6MjQwcHhcIj48Y2FudmFzIGlkPVwiJyArXG4gICAgaWQgK1xuICAgICdcIiByb2xlPVwiaW1nXCIgYXJpYS1sYWJlbD1cIicgK1xuICAgIF9lc2NIdG1sKHRpdHVsbykgK1xuICAgICdcIj48L2NhbnZhcz48L2Rpdj48L3NlY3Rpb24+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfaXNFbXB0eShkKSB7XG4gIGlmICghZCkgcmV0dXJuIHRydWU7XG4gIGNvbnN0IGsgPSBkLmtwaXMgfHwge307XG4gIGNvbnN0IGhheUtwaSA9XG4gICAgTnVtYmVyKGsuZmFjdHVyYWRvKSB8fCBOdW1iZXIoay5wZWRpZG9zKSB8fCBOdW1iZXIoay5wZWRpZG9zVW5pY29zKSB8fCBOdW1iZXIoay5iYWNrb3JkZXJBcnMpO1xuICBjb25zdCBoYXlUb3AgPSBBcnJheS5pc0FycmF5KGQudG9wVW5pZGFkZXMpICYmIGQudG9wVW5pZGFkZXMubGVuZ3RoID4gMDtcbiAgY29uc3QgaGF5U2VyaWUgPSBBcnJheS5pc0FycmF5KGQuc2VyaWVWZW50YXMpICYmIGQuc2VyaWVWZW50YXMuc29tZSgocCkgPT4gTnVtYmVyKHAudmFsb3IpKTtcbiAgcmV0dXJuICFoYXlLcGkgJiYgIWhheVRvcCAmJiAhaGF5U2VyaWU7XG59XG5cbi8qKiBSZXN1bHRhZG9zIChsZXllbmRhLCB0YXJqZXRhcywgcmFua2luZ3MsIGdyXHUwMEUxZmljb3MpLiBObyB0b2NhIGxvcyBmaWx0cm9zLiAqL1xuZnVuY3Rpb24gcmVuZGVyUmVzdWx0cygpIHtcbiAgX3N0b2NrTWVtby5jbGVhcigpO1xuICBjb25zdCByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2R2LXJlc3VsdHMnKTtcbiAgaWYgKCFyb290KSByZXR1cm47XG4gIGNvbnN0IGQgPSBzdGF0ZS5kYXRhO1xuXG4gIGxldCBodG1sID1cbiAgICAnPGRpdiBjbGFzcz1cImR2LWxleWVuZGFcIj5Nb250b3Mgc2luIElWQSwgY29uIGRlc2N1ZW50byBhcGxpY2FkbyB5IG5vdGFzIGRlIGNyXHUwMEU5ZGl0byByZXN0YWRhcy4nO1xuICBpZiAoZCAmJiBkLmRhdGFVcGRhdGVkQXQgJiYgIXN0YXRlLmxvYWRpbmcpIHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZC5kYXRhVXBkYXRlZEF0KTtcbiAgICBpZiAoIU51bWJlci5pc05hTih0LmdldFRpbWUoKSkpIHtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJyA8c3BhbiBjbGFzcz1cImR2LW11dGVkXCI+XHUwMEI3IENhbGN1bGFkbyAnICtcbiAgICAgICAgX2VzY0h0bWwodC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pKSArXG4gICAgICAgICc8L3NwYW4+JztcbiAgICB9XG4gIH1cbiAgaHRtbCArPSAnPC9kaXY+JztcblxuICBpZiAoc3RhdGUubG9hZGluZykge1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1lc3RhZG9cIj5DYXJnYW5kb1x1MjAyNjwvZGl2Pic7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZXJyb3IpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImR2LWVzdGFkbyBkdi1lcnJvclwiPicgKyBfZXNjSHRtbChzdGF0ZS5lcnJvcikucmVwbGFjZSgvXFxuL2csICc8YnI+JykgKyAnPC9kaXY+JztcbiAgfSBlbHNlIGlmIChkICYmIF9pc0VtcHR5KGQpKSB7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImR2LWVzdGFkb1wiPk5vIGhheSB2ZW50YXMgY29uIGVzb3MgZmlsdHJvcy48L2Rpdj4nO1xuICB9IGVsc2UgaWYgKGQpIHtcbiAgICBjb25zdCBrID0gZC5rcGlzIHx8IHt9O1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJkdi1jYXJkc1wiPic7XG4gICAgaHRtbCArPSBfY2FyZCgnRmFjdHVyYWRvIG1lbnN1YWwnLCBfZm10QXJzKGsuZmFjdHVyYWRvKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnVmFsb3JpemFjaVx1MDBGM24gYmFja29yZGVyJywgX2ZtdEFycyhrLmJhY2tvcmRlckFycykpO1xuICAgIGh0bWwgKz0gX2NhcmQoJ0NhbnQuIGRlIHBlZGlkb3MgZGVsIG1lcycsIF9mbXRVZHMoay5wZWRpZG9zKSk7XG4gICAgaHRtbCArPSBfY2FyZCgnQ2FudC4gcGVkaWRvcyBcdTAwRkFuaWNvcycsIF9mbXRVZHMoay5wZWRpZG9zVW5pY29zKSk7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICBodG1sICs9IF9nZXN0aW9uU2VjdGlvbihkLmdlc3Rpb24sIGQuc2VjY2lvbmVzLCBzdGF0ZS5pbnRlclF1ZXJ5KTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCd1bmlkYWRlcycsICdUb3AgMjAgU0tVIC0gVW5pZGFkZXMnLCBkLnRvcFVuaWRhZGVzIHx8IFtdKTtcbiAgICBodG1sICs9IF90b3BTZWN0aW9uKCdkaW5lcm8nLCAnVG9wIDIwIFNLVSAtIERpbmVybycsIGQudG9wRGluZXJvIHx8IFtdKTtcbiAgICBodG1sICs9IF9saW5lU2VjdGlvbignZHYtY2hhcnQtdmVudGFzJywgJ0V2b2x1Y2lcdTAwRjNuIGRlIHZlbnRhcycpO1xuICAgIGh0bWwgKz0gX2xpbmVTZWN0aW9uKCdkdi1jaGFydC1iby11ZHMnLCAnRXZvbHVjaVx1MDBGM24gZGVsIGJhY2tvcmRlciAtIFVuaWRhZGVzJyk7XG4gICAgaHRtbCArPSBfbGluZVNlY3Rpb24oJ2R2LWNoYXJ0LWJvLWFycycsICdFdm9sdWNpXHUwMEYzbiBkZWwgYmFja29yZGVyIC0gRGluZXJvJyk7XG4gICAgaHRtbCArPSBfcHJvZHVjdG9zU2VjdGlvbihkLnByb2R1Y3RvcywgZC5zZWNjaW9uZXMsIHN0YXRlLnByb2RRdWVyeSk7XG4gICAgaHRtbCArPSBfY29iZXJ0dXJhU2VjdGlvbihkLmNvYmVydHVyYSwgZC5zZWNjaW9uZXMpO1xuICAgIGh0bWwgKz0gX2NsaWVudGVzU2VjdGlvbihkLmNsaWVudGVzLCBkLnNlY2Npb25lcyk7XG4gICAgaHRtbCArPSBfY2FtcGFuaWFzU2VjdGlvbihkLmNhbXBhbmlhcywgZC5zZWNjaW9uZXMpO1xuICB9XG5cbiAgX2Rlc3Ryb3lDaGFydHMoKTtcbiAgcm9vdC5pbm5lckhUTUwgPSBodG1sO1xuICAvLyBFbCB0ZXh0byBkZWwgYnVzY2Fkb3IgZGUgXCJWZXIgbVx1MDBFMXNcIiBzZSBwb25lIHBvciBET00sIG51bmNhIGRlbnRybyBkZWwgSFRNTC5cbiAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFtkYXRhLXZlcm1hcy1zZWFyY2hdJykuZm9yRWFjaCgoaW5wKSA9PiB7XG4gICAgY29uc3QgayA9IGlucC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdmVybWFzLXNlYXJjaCcpO1xuICAgIGlmIChrKSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR9ICovIChpbnApLnZhbHVlID0gc3RhdGUudmVyTWFzUXVlcnlba10gfHwgJyc7XG4gIH0pO1xuXG4gIGNvbnN0IGludGVySW5wID0gcm9vdC5xdWVyeVNlbGVjdG9yKCcjZHYtaW50ZXJhY2Npb25lcy1idXNjYXInKTtcbiAgaWYgKGludGVySW5wKSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR9ICovIChpbnRlcklucCkudmFsdWUgPSBzdGF0ZS5pbnRlclF1ZXJ5IHx8ICcnO1xuICBjb25zdCBwcm9kSW5wID0gcm9vdC5xdWVyeVNlbGVjdG9yKCcjZHYtcHJvZHVjdG9zLWJ1c2NhcicpO1xuICBpZiAocHJvZElucCkgLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAocHJvZElucCkudmFsdWUgPSBzdGF0ZS5wcm9kUXVlcnkgfHwgJyc7XG5cbiAgLy8gU2luIG1vZGFsIGFiaWVydG8gbm8gc2UgZGlidWphIChyZXNwdWVzdGEgcXVlIGxsZWdcdTAwRjMgZGVzcHVcdTAwRTlzIGRlIGNlcnJhcikuXG4gIGlmIChfaXNPcGVuKCkgJiYgIXN0YXRlLmxvYWRpbmcgJiYgIXN0YXRlLmVycm9yICYmIGQgJiYgIV9pc0VtcHR5KGQpKSB7XG4gICAgX2xvYWRDaGFydEpzKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKF9pc09wZW4oKSAmJiBzdGF0ZS5kYXRhID09PSBkKSBfZHJhd0NoYXJ0cyhkKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbZGFzaGJvYXJkLXZlbnRhc10gQ2hhcnQuanMgbm8gZGlzcG9uaWJsZTonLCBlKTtcbiAgICAgICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtY2hhcnQnKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cImR2LW11dGVkXCI+Tm8gc2UgcHVkbyBjYXJnYXIgZWwgZ3JcdTAwRTFmaWNvLiBSZXZpc1x1MDBFMSBsYSBjb25leGlcdTAwRjNuLjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBpZiAoIV9lbnN1cmVTa2VsZXRvbigpKSByZXR1cm47XG4gIHJlbmRlckZpbHRyb3MoZmFsc2UpO1xuICBfc3luY0FwbGljYXJEaXNhYmxlZCgpO1xuICByZW5kZXJSZXN1bHRzKCk7XG59XG5cbmZ1bmN0aW9uIF9jc3NWYXIobmFtZSwgZmFsbGJhY2spIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB2ID0gZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmdldFByb3BlcnR5VmFsdWUobmFtZSkudHJpbSgpO1xuICAgIHJldHVybiB2IHx8IGZhbGxiYWNrO1xuICB9IGNhdGNoIChfZSkge1xuICAgIHJldHVybiBmYWxsYmFjaztcbiAgfVxufVxuXG5jb25zdCBDSEFSVF9GT05UID1cbiAgXCItYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsICdTRiBQcm8gVGV4dCcsICdTZWdvZSBVSScsIHN5c3RlbS11aSwgc2Fucy1zZXJpZlwiO1xuY29uc3QgQ0hBUlRfR1JJRF9MSUdIVCA9ICdyZ2JhKDAsMCwwLC4wNiknO1xuY29uc3QgQ0hBUlRfR1JJRF9EQVJLID0gJ3JnYmEoMjU1LDI1NSwyNTUsLjA4KSc7XG5cbi8qKiBHcmlsbGEgc3VhdmU7IGVuIHRlbWEgb3NjdXJvIHVzYSBibGFuY28gdHJhbnNsXHUwMEZBY2lkbyBwYXJhIHF1ZSBzZSB2ZWEuICovXG5mdW5jdGlvbiBfY2hhcnRHcmlkKCkge1xuICBjb25zdCBkYXJrID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmdldEF0dHJpYnV0ZSgnZGF0YS10aGVtZScpID09PSAnZGFyayc7XG4gIHJldHVybiB7IGNvbG9yOiBkYXJrID8gQ0hBUlRfR1JJRF9EQVJLIDogQ0hBUlRfR1JJRF9MSUdIVCB9O1xufVxuXG5mdW5jdGlvbiBfYmFyQ2hhcnQoY2FudmFzSWQsIHJvd3MsIGZpZWxkLCBmbXQsIGNvbG9yKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoY2FudmFzSWQpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgLy8gU3BlYzogU0tVcyBjb24gbmV0byA8PSAwIG5vIGVudHJhbiBhbCBUb3AgKGxhIHRhYmxhIFwiVmVyIG1cdTAwRTFzXCIgc1x1MDBFRCBsb3MgbXVlc3RyYSkuXG4gIGNvbnN0IHRvcCA9IHJvd3MuZmlsdGVyKChyKSA9PiAoTnVtYmVyKHJbZmllbGRdKSB8fCAwKSA+IDApLnNsaWNlKDAsIFRPUF9OKTtcbiAgY2hhcnRzW2NhbnZhc0lkXSA9IG5ldyB3aW5kb3cuQ2hhcnQoZWwsIHtcbiAgICB0eXBlOiAnYmFyJyxcbiAgICBkYXRhOiB7XG4gICAgICBsYWJlbHM6IHRvcC5tYXAoKHIpID0+IFN0cmluZyhyLnNrdSkpLFxuICAgICAgZGF0YXNldHM6IFtcbiAgICAgICAgeyBkYXRhOiB0b3AubWFwKChyKSA9PiBOdW1iZXIocltmaWVsZF0pIHx8IDApLCBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLCBib3JkZXJSYWRpdXM6IDMgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBpbmRleEF4aXM6ICd5JyxcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICBkdkRhdGFMYWJlbHM6IHsgZm10IH0sXG4gICAgICAgIHRvb2x0aXA6IHtcbiAgICAgICAgICBjYWxsYmFja3M6IHtcbiAgICAgICAgICAgIHRpdGxlOiAoaXRlbXMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgciA9IHRvcFtpdGVtc1swXS5kYXRhSW5kZXhdO1xuICAgICAgICAgICAgICByZXR1cm4gciA/IFN0cmluZyhyLnNrdSkgKyAoci5kZXNjID8gJyAtICcgKyBTdHJpbmcoci5kZXNjKSA6ICcnKSA6ICcnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxhYmVsOiAoaXRlbSkgPT4gZm10KGl0ZW0ucmF3KSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNjYWxlczoge1xuICAgICAgICB4OiB7XG4gICAgICAgICAgZ3JpZDogX2NoYXJ0R3JpZCgpLFxuICAgICAgICAgIGJvcmRlcjogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBmb250OiB7IGZhbWlseTogQ0hBUlRfRk9OVCB9LFxuICAgICAgICAgICAgY2FsbGJhY2s6ICh2KSA9PiBmbXQodiksXG4gICAgICAgICAgICBtYXhUaWNrc0xpbWl0OiA1LFxuICAgICAgICAgICAgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgeToge1xuICAgICAgICAgIGdyaWQ6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgYXV0b1NraXA6IGZhbHNlLFxuICAgICAgICAgICAgZm9udDogeyBzaXplOiAxMCwgZmFtaWx5OiBDSEFSVF9GT05UIH0sXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LXNlY29uZGFyeScsICcjMzM0MTU1JyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG59XG5cbi8qKlxuICogU2VyaWUgZGUgYmFjayBvcmRlciBlbiAyIGRhdGFzZXRzOiByZWFsIChsXHUwMEVEbmVhIGxsZW5hKSB5IGVzdGltYWRvIChwdW50ZWFkYSkuXG4gKiBVbiBwdW50byBlc3RpbWFkbyBzZSBjb25lY3RhIGNvbiBzdSB2ZWNpbm8gcmVhbCBwYXJhIHF1ZSBsYSBjdXJ2YSBubyBxdWVkZVxuICogY29ydGFkYSBlbiBsYSB0cmFuc2ljaVx1MDBGM247IGBudWxsYCAoc2luIGRhdG9zKSBjb3J0YSBsYSBsXHUwMEVEbmVhIChzcGFuR2FwczpmYWxzZSkuXG4gKi9cbmZ1bmN0aW9uIF9zcGxpdEJhY2tvcmRlcihzZXJpZSkge1xuICBjb25zdCByZWFsID0gc2VyaWUubWFwKChwKSA9PiAocC52YWxvciA9PSBudWxsIHx8IHAuZXN0aW1hZG8gPyBudWxsIDogTnVtYmVyKHAudmFsb3IpKSk7XG4gIGNvbnN0IGVzdCA9IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCB8fCAhcC5lc3RpbWFkbyA/IG51bGwgOiBOdW1iZXIocC52YWxvcikpKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZXJpZS5sZW5ndGg7IGkrKykge1xuICAgIGlmIChlc3RbaV0gPT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKGkgKyAxIDwgc2VyaWUubGVuZ3RoICYmIHJlYWxbaSArIDFdICE9IG51bGwpIGVzdFtpICsgMV0gPSByZWFsW2kgKyAxXTtcbiAgICBpZiAoaSAtIDEgPj0gMCAmJiByZWFsW2kgLSAxXSAhPSBudWxsICYmIGVzdFtpIC0gMV0gPT0gbnVsbCkgZXN0W2kgLSAxXSA9IHJlYWxbaSAtIDFdO1xuICB9XG4gIHJldHVybiB7IHJlYWwsIGVzdCwgaGF5RXN0aW1hZG86IHNlcmllLnNvbWUoKHApID0+IHAuZXN0aW1hZG8gJiYgcC52YWxvciAhPSBudWxsKSB9O1xufVxuXG5mdW5jdGlvbiBfbGluZUNoYXJ0KGNhbnZhc0lkLCBzZXJpZSwgZm10LCBjb2xvciwgY29uRXN0aW1hZG8pIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChjYW52YXNJZCk7XG4gIGlmICghZWwgfHwgIXdpbmRvdy5DaGFydCkgcmV0dXJuO1xuICBjb25zdCBsYWJlbHMgPSBzZXJpZS5tYXAoKHApID0+IF9sYWJlbE1lcyhwLm1lcykpO1xuICBjb25zdCBkYXRhc2V0cyA9IFtdO1xuICBpZiAoY29uRXN0aW1hZG8pIHtcbiAgICBjb25zdCBzID0gX3NwbGl0QmFja29yZGVyKHNlcmllKTtcbiAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgIGxhYmVsOiAncmVhbCcsXG4gICAgICBkYXRhOiBzLnJlYWwsXG4gICAgICBib3JkZXJDb2xvcjogY29sb3IsXG4gICAgICBiYWNrZ3JvdW5kQ29sb3I6IGNvbG9yLFxuICAgICAgc3BhbkdhcHM6IGZhbHNlLFxuICAgICAgdGVuc2lvbjogMC4yLFxuICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgfSk7XG4gICAgaWYgKHMuaGF5RXN0aW1hZG8pIHtcbiAgICAgIGRhdGFzZXRzLnB1c2goe1xuICAgICAgICBsYWJlbDogJ2VzdGltYWRvJyxcbiAgICAgICAgZGF0YTogcy5lc3QsXG4gICAgICAgIGJvcmRlckNvbG9yOiBjb2xvcixcbiAgICAgICAgYmFja2dyb3VuZENvbG9yOiBjb2xvcixcbiAgICAgICAgYm9yZGVyRGFzaDogWzYsIDRdLFxuICAgICAgICBzcGFuR2FwczogZmFsc2UsXG4gICAgICAgIHRlbnNpb246IDAuMixcbiAgICAgICAgcG9pbnRSYWRpdXM6IDMsXG4gICAgICAgIHBvaW50U3R5bGU6ICdyZWN0Um90JyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBkYXRhc2V0cy5wdXNoKHtcbiAgICAgIGxhYmVsOiAnZmFjdHVyYWRvJyxcbiAgICAgIGRhdGE6IHNlcmllLm1hcCgocCkgPT4gKHAudmFsb3IgPT0gbnVsbCA/IG51bGwgOiBOdW1iZXIocC52YWxvcikpKSxcbiAgICAgIGJvcmRlckNvbG9yOiBjb2xvcixcbiAgICAgIGJhY2tncm91bmRDb2xvcjogY29sb3IsXG4gICAgICBzcGFuR2FwczogZmFsc2UsXG4gICAgICB0ZW5zaW9uOiAwLjIsXG4gICAgICBwb2ludFJhZGl1czogMyxcbiAgICB9KTtcbiAgfVxuICBjaGFydHNbY2FudmFzSWRdID0gbmV3IHdpbmRvdy5DaGFydChlbCwge1xuICAgIHR5cGU6ICdsaW5lJyxcbiAgICBkYXRhOiB7IGxhYmVscywgZGF0YXNldHMgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICByZXNwb25zaXZlOiB0cnVlLFxuICAgICAgbWFpbnRhaW5Bc3BlY3RSYXRpbzogZmFsc2UsXG4gICAgICBhbmltYXRpb246IGZhbHNlLFxuICAgICAgcGx1Z2luczoge1xuICAgICAgICBsZWdlbmQ6IHsgZGlzcGxheTogY29uRXN0aW1hZG8gJiYgZGF0YXNldHMubGVuZ3RoID4gMSB9LFxuICAgICAgICB0b29sdGlwOiB7IGNhbGxiYWNrczogeyBsYWJlbDogKGl0ZW0pID0+IGl0ZW0uZGF0YXNldC5sYWJlbCArICc6ICcgKyBmbXQoaXRlbS5yYXcpIH0gfSxcbiAgICAgIH0sXG4gICAgICBzY2FsZXM6IHtcbiAgICAgICAgeToge1xuICAgICAgICAgIGJlZ2luQXRaZXJvOiB0cnVlLFxuICAgICAgICAgIGdyaWQ6IF9jaGFydEdyaWQoKSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgZm9udDogeyBmYW1pbHk6IENIQVJUX0ZPTlQgfSxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gZm10KHYpLFxuICAgICAgICAgICAgbWF4VGlja3NMaW1pdDogNixcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtbXV0ZWQnLCAnIzY0NzQ4YicpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHg6IHtcbiAgICAgICAgICBncmlkOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgYm9yZGVyOiB7IGRpc3BsYXk6IGZhbHNlIH0sXG4gICAgICAgICAgdGlja3M6IHsgZm9udDogeyBmYW1pbHk6IENIQVJUX0ZPTlQgfSwgY29sb3I6IF9jc3NWYXIoJy0tdGV4dC1tdXRlZCcsICcjNjQ3NDhiJykgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG59XG5cbi8qKiBCYXJyYXMgaG9yaXpvbnRhbGVzIGRlIGNvYmVydHVyYTogdW5hIHBvciB2ZW5kZWRvciwgMC0xMDAlLiAqL1xuZnVuY3Rpb24gX2NvYmVydHVyYUNoYXJ0KHJvd3MpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHYtY2FudmFzLWNvYmVydHVyYScpO1xuICBpZiAoIWVsIHx8ICF3aW5kb3cuQ2hhcnQpIHJldHVybjtcbiAgY2hhcnRzWydkdi1jYW52YXMtY29iZXJ0dXJhJ10gPSBuZXcgd2luZG93LkNoYXJ0KGVsLCB7XG4gICAgdHlwZTogJ2JhcicsXG4gICAgZGF0YToge1xuICAgICAgbGFiZWxzOiByb3dzLm1hcCgocikgPT4gW1N0cmluZyhyLnZlbmRlZG9yKSwgX2NvYmVydHVyYUV0aXF1ZXRhKHIpXSksXG4gICAgICBkYXRhc2V0czogW1xuICAgICAgICB7XG4gICAgICAgICAgZGF0YTogcm93cy5tYXAoKHIpID0+IChyLnBjdCA9PSBudWxsID8gMCA6IE51bWJlcihyLnBjdCkgfHwgMCkpLFxuICAgICAgICAgIGJhY2tncm91bmRDb2xvcjogJyMwMjg0YTAnLFxuICAgICAgICAgIGJvcmRlclJhZGl1czogMyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBpbmRleEF4aXM6ICd5JyxcbiAgICAgIHJlc3BvbnNpdmU6IHRydWUsXG4gICAgICBtYWludGFpbkFzcGVjdFJhdGlvOiBmYWxzZSxcbiAgICAgIGFuaW1hdGlvbjogZmFsc2UsXG4gICAgICBwbHVnaW5zOiB7XG4gICAgICAgIGxlZ2VuZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICBkdkRhdGFMYWJlbHM6IHsgZm10OiAoX3YsIGkpID0+IChyb3dzW2ldID8gX2NvYmVydHVyYUV0aXF1ZXRhKHJvd3NbaV0pIDogJycpIH0sXG4gICAgICAgIHRvb2x0aXA6IHtcbiAgICAgICAgICBjYWxsYmFja3M6IHtcbiAgICAgICAgICAgIHRpdGxlOiAoaXRlbXMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgciA9IHJvd3NbaXRlbXNbMF0uZGF0YUluZGV4XTtcbiAgICAgICAgICAgICAgcmV0dXJuIHIgPyBTdHJpbmcoci52ZW5kZWRvcikgOiAnJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYWJlbDogKGl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgciA9IHJvd3NbaXRlbS5kYXRhSW5kZXhdO1xuICAgICAgICAgICAgICByZXR1cm4gciA/IF9jb2JlcnR1cmFFdGlxdWV0YShyKSA6ICcnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNjYWxlczoge1xuICAgICAgICB4OiB7XG4gICAgICAgICAgbWluOiAwLFxuICAgICAgICAgIG1heDogMTAwLFxuICAgICAgICAgIGdyaWQ6IF9jaGFydEdyaWQoKSxcbiAgICAgICAgICBib3JkZXI6IHsgZGlzcGxheTogZmFsc2UgfSxcbiAgICAgICAgICB0aWNrczoge1xuICAgICAgICAgICAgZm9udDogeyBmYW1pbHk6IENIQVJUX0ZPTlQgfSxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAodikgPT4gdiArICclJyxcbiAgICAgICAgICAgIG1heFRpY2tzTGltaXQ6IDUsXG4gICAgICAgICAgICBjb2xvcjogX2Nzc1ZhcignLS10ZXh0LW11dGVkJywgJyM2NDc0OGInKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB5OiB7XG4gICAgICAgICAgZ3JpZDogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIGJvcmRlcjogeyBkaXNwbGF5OiBmYWxzZSB9LFxuICAgICAgICAgIHRpY2tzOiB7XG4gICAgICAgICAgICBhdXRvU2tpcDogZmFsc2UsXG4gICAgICAgICAgICBmb250OiB7IHNpemU6IDEwLCBmYW1pbHk6IENIQVJUX0ZPTlQgfSxcbiAgICAgICAgICAgIGNvbG9yOiBfY3NzVmFyKCctLXRleHQtc2Vjb25kYXJ5JywgJyMzMzQxNTUnKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gX2RyYXdDaGFydHMoZCkge1xuICAvLyBQdWVkZSBxdWUgZWwgdXN1YXJpbyBoYXlhIHJlLXJlbmRlcml6YWRvIG1pZW50cmFzIGNhcmdhYmEgQ2hhcnQuanMuXG4gIF9kZXN0cm95Q2hhcnRzKCk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLXVuaWRhZGVzJywgZC50b3BVbmlkYWRlcyB8fCBbXSwgJ3VkcycsIF9mbXRVZHMsICcjMDI4NGEwJyk7XG4gIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLWRpbmVybycsIGQudG9wRGluZXJvIHx8IFtdLCAnYXJzJywgX2ZtdEFycywgJyMxNmEzNGEnKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtdmVudGFzJywgZC5zZXJpZVZlbnRhcyB8fCBbXSwgX2ZtdEFycywgJyMxZTQwYWYnLCBmYWxzZSk7XG4gIF9saW5lQ2hhcnQoJ2R2LWNoYXJ0LWJvLXVkcycsIGQuc2VyaWVCb1VkcyB8fCBbXSwgX2ZtdFVkcywgJyNjMjQxMGMnLCB0cnVlKTtcbiAgX2xpbmVDaGFydCgnZHYtY2hhcnQtYm8tYXJzJywgZC5zZXJpZUJvQXJzIHx8IFtdLCBfZm10QXJzLCAnIzlmMTIzOScsIHRydWUpO1xuICBpZiAoQXJyYXkuaXNBcnJheShkLmNvYmVydHVyYSkpIF9jb2JlcnR1cmFDaGFydChkLmNvYmVydHVyYSk7XG4gIGlmIChBcnJheS5pc0FycmF5KGQuY2xpZW50ZXMpKSB7XG4gICAgLy8gX2JhckNoYXJ0IHVzYSBza3UvZGVzYzogc2UgYWRhcHRhbiBub21icmUgeSBjXHUwMEYzZGlnbyBkZWwgY2xpZW50ZS5cbiAgICBjb25zdCBmaWxhcyA9IGQuY2xpZW50ZXMubWFwKChjKSA9PiAoeyBza3U6IGMubm9tYnJlLCBkZXNjOiBjLmNvZGUsIGZhY3R1cmFkbzogYy5mYWN0dXJhZG8gfSkpO1xuICAgIF9iYXJDaGFydCgnZHYtY2hhcnQtdG9wLWNsaWVudGVzJywgZmlsYXMsICdmYWN0dXJhZG8nLCBfZm10QXJzLCAnIzdjM2FlZCcpO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGF0b3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfZmlsdHJvc1BheWxvYWQoKSB7XG4gIHJldHVybiB7XG4gICAgbWVzOiBzdGF0ZS5tZXMsXG4gICAgdmVuZGVkb3JlczogX2lzVmVuZGVkb3IoKSA/IFtdIDogc3RhdGUuc2VsLnZlbmRlZG9yZXMuc2xpY2UoKSxcbiAgICBjbGllbnRlczogc3RhdGUuc2VsLmNsaWVudGVzLnNsaWNlKCksXG4gICAgcHJvdmluY2lhczogc3RhdGUuc2VsLnByb3ZpbmNpYXMuc2xpY2UoKSxcbiAgICBjYXRlZ29yaWFzOiBzdGF0ZS5zZWwuY2F0ZWdvcmlhcy5zbGljZSgpLFxuICAgIHNrdXM6IHN0YXRlLnNlbC5za3VzLnNsaWNlKCksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNhcmdhcigpIHtcbiAgY29uc3Qgc2VxID0gKytzdGF0ZS5yZXFTZXE7XG4gIHN0YXRlLmxvYWRpbmcgPSB0cnVlO1xuICBzdGF0ZS5lcnJvciA9ICcnO1xuICByZW5kZXIoKTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIGZpcmViYXNlID09PSAndW5kZWZpbmVkJyB8fCAhZmlyZWJhc2UuYXBwKSB0aHJvdyBuZXcgRXJyb3IoJ2ZpcmViYXNlIG5vIGRpc3BvbmlibGUnKTtcbiAgICBjb25zdCBjYWxsYWJsZSA9IGZpcmViYXNlLmFwcCgpLmZ1bmN0aW9ucyhSRUdJT04pLmh0dHBzQ2FsbGFibGUoJ2Rhc2hib2FyZFZlbnRhc0NGJyk7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgY2FsbGFibGUoX2ZpbHRyb3NQYXlsb2FkKCkpO1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIHN0YXRlLmRhdGEgPSAocmVzICYmIHJlcy5kYXRhKSB8fCBudWxsO1xuICAgIGlmIChzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEub3BjaW9uZXMpIHN0YXRlLm9wY2lvbmVzID0gc3RhdGUuZGF0YS5vcGNpb25lcztcbiAgICBzdGF0ZS52ZXJNYXMgPSB7IHVuaWRhZGVzOiBmYWxzZSwgZGluZXJvOiBmYWxzZSB9O1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKHNlcSAhPT0gc3RhdGUucmVxU2VxKSByZXR1cm47XG4gICAgY29uc29sZS5lcnJvcignW2Rhc2hib2FyZC12ZW50YXNdIGRhc2hib2FyZFZlbnRhc0NGIGZhbGxvOicsIGUpO1xuICAgIHN0YXRlLmVycm9yID0gX2Vycm9yTWVzc2FnZSgpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChzZXEgPT09IHN0YXRlLnJlcVNlcSkge1xuICAgICAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXZlbnRvcyAoZGVsZWdhZG9zIHNvYnJlIGVsIGJvZHkgZGVsIG1vZGFsKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmxldCBfd2lyZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIF93aXJlKCkge1xuICBpZiAoX3dpcmVkKSByZXR1cm47XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuO1xuICBfd2lyZWQgPSB0cnVlO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICghKHQgaW5zdGFuY2VvZiBFbGVtZW50KSkgcmV0dXJuO1xuICAgIGNvbnN0IGFjdCA9IHQuY2xvc2VzdCgnW2RhdGEtZHYtYWN0aW9uXScpO1xuICAgIGlmIChhY3QpIHtcbiAgICAgIGNvbnN0IGEgPSBhY3QuZ2V0QXR0cmlidXRlKCdkYXRhLWR2LWFjdGlvbicpO1xuICAgICAgaWYgKGEgPT09ICdhcGxpY2FyJykge1xuICAgICAgICBfcmVhZFNlbEZyb21Eb20oYm9keSk7XG4gICAgICAgIGNhcmdhcigpO1xuICAgICAgfSBlbHNlIGlmIChhID09PSAnbGltcGlhcicpIHtcbiAgICAgICAgc3RhdGUuc2VsID0gX3NlbFZhY2lhKCk7XG4gICAgICAgIHN0YXRlLm1lcyA9IF9tZXNBY3R1YWxBcnQoKTtcbiAgICAgICAgcmVuZGVyRmlsdHJvcyh0cnVlKTtcbiAgICAgICAgY2FyZ2FyKCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHZtID0gdC5jbG9zZXN0KCdbZGF0YS12ZXJtYXNdJyk7XG4gICAgaWYgKHZtKSB7XG4gICAgICBjb25zdCB0aXBvID0gX3RpcG9WZXJNYXModm0uZ2V0QXR0cmlidXRlKCdkYXRhLXZlcm1hcycpKTtcbiAgICAgIHN0YXRlLnZlck1hc1t0aXBvXSA9ICFzdGF0ZS52ZXJNYXNbdGlwb107XG4gICAgICAvLyBTb2xvIHJlc3VsdGFkb3M6IG5vIHNlIGxlZW4gbmkgc2UgcGlzYW4gZmlsdHJvcyBzaW4gYXBsaWNhci5cbiAgICAgIHJlbmRlclJlc3VsdHMoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xyID0gdC5jbG9zZXN0KCdbZGF0YS1tcy1jbGVhcl0nKTtcbiAgICBpZiAoY2xyKSB7XG4gICAgICBjb25zdCBrZXkgPSBjbHIuZ2V0QXR0cmlidXRlKCdkYXRhLW1zLWNsZWFyJyk7XG4gICAgICBib2R5LnF1ZXJ5U2VsZWN0b3JBbGwoJ2lucHV0W3R5cGU9XCJjaGVja2JveFwiXVtkYXRhLWZpbHRybz1cIicgKyBrZXkgKyAnXCJdJykuZm9yRWFjaCgoZWwpID0+IHtcbiAgICAgICAgZWwuY2hlY2tlZCA9IGZhbHNlO1xuICAgICAgfSk7XG4gICAgICBfdXBkYXRlU3VtbWFyeShib2R5LCBrZXkpO1xuICAgIH1cbiAgfSk7XG5cbiAgYm9keS5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICh0IGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCAmJiB0LnR5cGUgPT09ICdjaGVja2JveCcgJiYgdC5oYXNBdHRyaWJ1dGUoJ2RhdGEtZmlsdHJvJykpIHtcbiAgICAgIF91cGRhdGVTdW1tYXJ5KGJvZHksIHQuZ2V0QXR0cmlidXRlKCdkYXRhLWZpbHRybycpKTtcbiAgICB9XG4gIH0pO1xuXG4gIGJvZHkuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gZXYudGFyZ2V0O1xuICAgIGlmICghKHQgaW5zdGFuY2VvZiBIVE1MSW5wdXRFbGVtZW50KSkgcmV0dXJuO1xuICAgIGNvbnN0IG1zS2V5ID0gdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbXMtc2VhcmNoJyk7XG4gICAgaWYgKG1zS2V5KSB7XG4gICAgICBjb25zdCBxID0gdC52YWx1ZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICAgIGNvbnN0IGRldCA9IGJvZHkucXVlcnlTZWxlY3RvcignZGV0YWlsc1tkYXRhLW1zPVwiJyArIG1zS2V5ICsgJ1wiXScpO1xuICAgICAgaWYgKCFkZXQpIHJldHVybjtcbiAgICAgIGRldC5xdWVyeVNlbGVjdG9yQWxsKCcuZHYtbXMtb3B0JykuZm9yRWFjaCgob3B0KSA9PiB7XG4gICAgICAgIGNvbnN0IHMgPSBvcHQuZ2V0QXR0cmlidXRlKCdkYXRhLXNlYXJjaCcpIHx8ICcnO1xuICAgICAgICBvcHQuc3R5bGUuZGlzcGxheSA9ICFxIHx8IHMuaW5jbHVkZXMocSkgPyAnJyA6ICdub25lJztcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodC5pZCA9PT0gJ2R2LWludGVyYWNjaW9uZXMtYnVzY2FyJykge1xuICAgICAgc3RhdGUuaW50ZXJRdWVyeSA9IHQudmFsdWU7XG4gICAgICBjb25zdCBnID0gc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLmdlc3Rpb247XG4gICAgICBjb25zdCB0aSA9IChnICYmIGcudGFibGFJbnRlcmFjY2lvbmVzKSB8fCB7IHJvd3M6IFtdLCB0b3RhbDogMCB9O1xuICAgICAgY29uc3QgY29udCA9IGJvZHkucXVlcnlTZWxlY3RvcignI2R2LWludGVyYWNjaW9uZXMgLmR2LWludGVyLWJvZHknKTtcbiAgICAgIGlmIChjb250KSBjb250LmlubmVySFRNTCA9IF9pbnRlcmFjY2lvbmVzVGFibGEodGkucm93cywgdGkudG90YWwsIHN0YXRlLmludGVyUXVlcnkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodC5pZCA9PT0gJ2R2LXByb2R1Y3Rvcy1idXNjYXInKSB7XG4gICAgICBzdGF0ZS5wcm9kUXVlcnkgPSB0LnZhbHVlO1xuICAgICAgaWYgKF9wcm9kVGltZXIpIGNsZWFyVGltZW91dChfcHJvZFRpbWVyKTtcbiAgICAgIF9wcm9kVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgX3Byb2RUaW1lciA9IG51bGw7XG4gICAgICAgIGNvbnN0IGNvbnQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJyNkdi1wcm9kdWN0b3MgLmR2LXByb2QtYm9keScpO1xuICAgICAgICBpZiAoY29udClcbiAgICAgICAgICBjb250LmlubmVySFRNTCA9IF9wcm9kdWN0b3NUYWJsYShzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEucHJvZHVjdG9zLCBzdGF0ZS5wcm9kUXVlcnkpO1xuICAgICAgfSwgUFJPRFVDVE9TX0RFQk9VTkNFX01TKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgdm1BdHRyID0gdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtdmVybWFzLXNlYXJjaCcpO1xuICAgIGlmICh2bUF0dHIpIHtcbiAgICAgIC8vIFNvbG8gdHJlcyByYW5raW5ncyBwb3NpYmxlczogbnVuY2EgcmV1c2FyIGVsIHRleHRvIGRlbCBhdHJpYnV0byBlbiBlbCBIVE1MLlxuICAgICAgY29uc3Qgdm1LZXkgPSBfdGlwb1Zlck1hcyh2bUF0dHIpO1xuICAgICAgc3RhdGUudmVyTWFzUXVlcnlbdm1LZXldID0gdC52YWx1ZTtcbiAgICAgIGNvbnN0IHNlYyA9IHQuY2xvc2VzdCgnLmR2LXZlcm1hcycpO1xuICAgICAgY29uc3QgZGQgPSBzdGF0ZS5kYXRhO1xuICAgICAgY29uc3Qgcm93cyA9XG4gICAgICAgIChkZCAmJlxuICAgICAgICAgICh2bUtleSA9PT0gJ3VuaWRhZGVzJ1xuICAgICAgICAgICAgPyBkZC50b3BVbmlkYWRlc1xuICAgICAgICAgICAgOiB2bUtleSA9PT0gJ2RpbmVybydcbiAgICAgICAgICAgICAgPyBkZC50b3BEaW5lcm9cbiAgICAgICAgICAgICAgOiBkZC5jbGllbnRlcykpIHx8XG4gICAgICAgIFtdO1xuICAgICAgaWYgKHNlYykge1xuICAgICAgICBjb25zdCB0bXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgICAgdG1wLmlubmVySFRNTCA9IF92ZXJNYXNUYWJsYSh2bUtleSwgcm93cyk7XG4gICAgICAgIGNvbnN0IG5ld1dyYXAgPSB0bXAucXVlcnlTZWxlY3RvcignLmR2LXRhYmxlLXdyYXAnKTtcbiAgICAgICAgY29uc3Qgb2xkV3JhcCA9IHNlYy5xdWVyeVNlbGVjdG9yKCcuZHYtdGFibGUtd3JhcCcpO1xuICAgICAgICBpZiAobmV3V3JhcCAmJiBvbGRXcmFwKSBvbGRXcmFwLnJlcGxhY2VXaXRoKG5ld1dyYXApO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG59XG5cbmZ1bmN0aW9uIF91cGRhdGVTdW1tYXJ5KGJvZHksIGtleSkge1xuICBjb25zdCBkZXQgPSBib2R5LnF1ZXJ5U2VsZWN0b3IoJ2RldGFpbHNbZGF0YS1tcz1cIicgKyBrZXkgKyAnXCJdJyk7XG4gIGlmICghZGV0KSByZXR1cm47XG4gIGNvbnN0IGNoZWNrZWQgPSBBcnJheS5mcm9tKGRldC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl06Y2hlY2tlZCcpKTtcbiAgY29uc3Qgc3VtID0gZGV0LnF1ZXJ5U2VsZWN0b3IoJ3N1bW1hcnknKTtcbiAgaWYgKCFzdW0pIHJldHVybjtcbiAgaWYgKGNoZWNrZWQubGVuZ3RoID09PSAwKSBzdW0udGV4dENvbnRlbnQgPSAnVG9kb3MnO1xuICBlbHNlIGlmIChjaGVja2VkLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHNwYW4gPSBjaGVja2VkWzBdLnBhcmVudEVsZW1lbnQgJiYgY2hlY2tlZFswXS5wYXJlbnRFbGVtZW50LnF1ZXJ5U2VsZWN0b3IoJ3NwYW4nKTtcbiAgICBzdW0udGV4dENvbnRlbnQgPSBzcGFuID8gc3Bhbi50ZXh0Q29udGVudCA6IGNoZWNrZWRbMF0udmFsdWU7XG4gIH0gZWxzZSBzdW0udGV4dENvbnRlbnQgPSBjaGVja2VkLmxlbmd0aCArICcgc2VsZWNjaW9uYWRvcyc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQVBJIHBcdTAwRkFibGljYSAoZXhwb3J0cyBkZWwgY2h1bmspXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxud2luZG93Lm9wZW5EYXNoYm9hcmRWZW50YXMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rhc2hib2FyZC12ZW50YXMtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkgcmV0dXJuO1xuICBjb25zdCByb2xlID0gX3JvbGUoKTtcbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnICYmIHJvbGUgIT09ICd2ZW5kZWRvcicpIHtcbiAgICBhbGVydCgnVHUgdXN1YXJpbyBubyB0aWVuZSBhY2Nlc28gYWwgRGFzaGJvYXJkIGRlIFZlbnRhcy4gU2kgbG8gbmVjZXNpdFx1MDBFMXMsIGF2aXNhbGUgYSBNYXJpYW5vLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBPdHJvIHVzdWFyaW8gZW4gbGEgbWlzbWEgcGVzdGFcdTAwRjFhIChsb2dvdXQgKyBsb2dpbiBzaW4gcmVjYXJnYXIpOiBzZVxuICAvLyBkZXNjYXJ0YSB0b2RvIGxvIGRlbCBhbnRlcmlvci4gTWlzbW8gdXN1YXJpbzogc2UgY29uc2VydmEgc3Ugc2VsZWNjaVx1MDBGM24uXG4gIGNvbnN0IHVpZCA9IF9jdXJyZW50VWlkKCk7XG4gIGlmICh1aWQgIT09IHN0YXRlLnVpZCkgX3Jlc2V0U3RhdGUodWlkKTtcbiAgaWYgKCFzdGF0ZS5tZXMpIHN0YXRlLm1lcyA9IF9tZXNBY3R1YWxBcnQoKTtcbiAgbW9kYWwuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBfZW5zdXJlU2tlbGV0b24oKTtcbiAgX3dpcmUoKTtcbiAgcmVuZGVyRmlsdHJvcyh0cnVlKTtcbiAgLy8gUHJlY2FyZ2EgQ2hhcnQuanMgZW4gcGFyYWxlbG8gYSBsYSBjb25zdWx0YS5cbiAgX2xvYWRDaGFydEpzKCkuY2F0Y2goKCkgPT4ge30pO1xuICAvLyBTaWVtcHJlIHNlIHBpZGUgZGUgbnVldm8gYWwgYWJyaXIgKGVsIHNlcnZpZG9yIGNhY2hlYSAxMCBtaW4pLlxuICBjYXJnYXIoKTtcbn07XG5cbndpbmRvdy5jbG9zZURhc2hib2FyZFZlbnRhcyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGFzaGJvYXJkLXZlbnRhcy1tb2RhbCcpO1xuICBpZiAobW9kYWwpIG1vZGFsLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgX2Rlc3Ryb3lDaGFydHMoKTtcbiAgLy8gTG9zIGRhdG9zIG5vIHNlIGd1YXJkYW4gZW50cmUgYXBlcnR1cmFzOyBzZSB2dWVsdmVuIGEgcGVkaXIgYWwgYWJyaXIuXG4gIHN0YXRlLmRhdGEgPSBudWxsO1xuICBzdGF0ZS5sb2FkaW5nID0gZmFsc2U7XG4gIHN0YXRlLnJlcVNlcSsrO1xufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWlCQSxNQUFNLGVBQWU7QUFDckIsTUFBTSxRQUFRO0FBQ2QsTUFBTSxTQUFTO0FBRWYsTUFBTSxjQUFjO0FBQUEsSUFDbEIsRUFBRSxLQUFLLGNBQWMsT0FBTyxXQUFXO0FBQUEsSUFDdkMsRUFBRSxLQUFLLFlBQVksT0FBTyxVQUFVO0FBQUEsSUFDcEMsRUFBRSxLQUFLLGNBQWMsT0FBTyxZQUFZO0FBQUEsSUFDeEMsRUFBRSxLQUFLLGNBQWMsT0FBTyxlQUFZO0FBQUEsSUFDeEMsRUFBRSxLQUFLLFFBQVEsT0FBTyxNQUFNO0FBQUEsRUFDOUI7QUFFQSxXQUFTLFlBQVk7QUFDbkIsV0FBTyxFQUFFLFlBQVksQ0FBQyxHQUFHLFVBQVUsQ0FBQyxHQUFHLFlBQVksQ0FBQyxHQUFHLFlBQVksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxFQUFFO0FBQUEsRUFDbEY7QUFLQSxNQUFNLFFBQVE7QUFBQSxJQUNaLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUssVUFBVTtBQUFBLElBQ2YsTUFBTTtBQUFBLElBQ04sVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsU0FBUztB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
