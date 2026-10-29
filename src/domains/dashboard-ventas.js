// @ts-nocheck
// DASHBOARD DE VENTAS (v1529, 2026-10-29).
//
// Pantalla nueva para analizar ventas pesca + evolución del back order con 6
// filtros combinables. Visible para admin, gerente y vendedor. Los datos los
// arma la callable `dashboardVentasCF` (southamerica-east1) que consulta
// BigQuery; para un vendedor el servidor fuerza su propio filtro Vendedor, acá
// solo lo mostramos bloqueado.
//
// Spec: docs/superpowers/specs/2026-10-29-dashboard-ventas-design.md
//
// Chunk lazy (§18): registrado en build.js LAZY_CHUNKS, src/main.js
// installChunkStubs y sw.js STATIC_ASSETS con la misma lista de exports.
//
// SEGURIDAD: todo string que viene de datos pasa por _escHtml() antes de
// innerHTML (nombres de clientes, descripciones de SKU, provincias, etc.).

const CHART_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const TOP_N = 20;
const REGION = 'southamerica-east1';

const FILTROS_DEF = [
  { key: 'vendedores', label: 'Vendedor' },
  { key: 'clientes', label: 'Cliente' },
  { key: 'provincias', label: 'Provincia' },
  { key: 'categorias', label: 'Categoría' },
  { key: 'skus', label: 'SKU' },
];

function _selVacia() {
  return { vendedores: [], clientes: [], provincias: [], categorias: [], skus: [] };
}

// Estado del módulo. Sobrevive al logout (el chunk no se recarga), por eso
// guarda el `uid` dueño: si al abrir el usuario es otro, se resetea todo y
// nunca se muestran datos del usuario anterior.
const state = {
  uid: null,
  mes: '',
  sel: _selVacia(),
  data: null,
  opciones: null,
  opcionesRendered: null,
  loading: false,
  error: '',
  verMas: { unidades: false, dinero: false, clientes: false },
  verMasQuery: { unidades: '', dinero: '', clientes: '' },
  interQuery: '',
  prodQuery: '',
  reqSeq: 0,
};

function _resetState(uid) {
  state.uid = uid;
  state.mes = _mesActualArt();
  state.sel = _selVacia();
  state.data = null;
  state.opciones = null;
  state.opcionesRendered = null;
  state.loading = false;
  state.error = '';
  state.verMas = { unidades: false, dinero: false, clientes: false };
  state.verMasQuery = { unidades: '', dinero: '', clientes: '' };
  state.interQuery = '';
  state.prodQuery = '';
  _stockMemo.clear();
  state.reqSeq++;
}

/** @type {Record<string, any>} */
const charts = {};
let chartJsPromise = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Escape local (mismo resultado que window.escapeHtml): el análisis de
// seguridad del repo (CodeQL) solo reconoce un sanitizador visible acá.
function _escHtml(s) {
  const v = s == null ? '' : s;
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _fmtArs(n) {
  const v = Number(n) || 0;
  return '$' + Math.round(v).toLocaleString('es-AR');
}

function _fmtUds(n) {
  return Math.round(Number(n) || 0).toLocaleString('es-AR');
}

function _role() {
  try {
    return (typeof userRole !== 'undefined' ? userRole : window.userRole) || null;
  } catch (_e) {
    return window.userRole || null;
  }
}

function _myVendor() {
  try {
    return (typeof assignedVendor !== 'undefined' ? assignedVendor : window.assignedVendor) || '';
  } catch (_e) {
    return window.assignedVendor || '';
  }
}

function _currentUid() {
  try {
    const u = typeof currentUser !== 'undefined' ? currentUser : window.currentUser;
    return (u && u.uid) || null;
  } catch (_e) {
    return (window.currentUser && window.currentUser.uid) || null;
  }
}

function _isOpen() {
  const modal = document.getElementById('dashboard-ventas-modal');
  return !!(modal && modal.classList && modal.classList.contains('open'));
}

function _isVendedor() {
  return _role() === 'vendedor';
}

/** Mes en curso en hora Argentina, formato AAAA-MM. */
function _mesActualArt() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    return y + '-' + m;
  } catch (_e) {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
}

const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];
function _labelMes(aaaamm) {
  const s = String(aaaamm || '');
  const m = Number(s.slice(5, 7));
  if (!m) return s;
  return MESES_CORTOS[m - 1] + ' ' + s.slice(2, 4);
}

function _errorMessage() {
  try {
    const mv = window.__phase0 && window.__phase0.pure && window.__phase0.pure.mensajesVendedor;
    if (mv && typeof mv.formatMensajeConCodigo === 'function') {
      return mv.formatMensajeConCodigo('DASHBOARD_VENTAS_FAILED');
    }
  } catch (_e) {}
  // Fallback §68 si el bundle no cargó (SW stale).
  return (
    'No pudimos cargar el tablero de ventas. Volvé a intentar en un minuto; si sigue pasando, avisale a Mariano.' +
    '\n\nCódigo técnico: DASHBOARD_VENTAS_FAILED'
  );
}

function _loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (chartJsPromise) return chartJsPromise;
  chartJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHART_JS_URL;
    s.async = true;
    s.onload = () =>
      window.Chart ? resolve(window.Chart) : reject(new Error('Chart.js sin global'));
    s.onerror = () => {
      chartJsPromise = null;
      reject(new Error('no se pudo cargar Chart.js'));
    };
    document.head.appendChild(s);
  });
  return chartJsPromise;
}

function _destroyCharts() {
  for (const k of Object.keys(charts)) {
    try {
      charts[k].destroy();
    } catch (_e) {}
    delete charts[k];
  }
}

// ---------------------------------------------------------------------------
// Opciones de filtros
// ---------------------------------------------------------------------------

/** Devuelve [{value,label}] de la opción `key` de la última respuesta. */
function _opcionesDe(key) {
  const op = state.opciones || {};
  const arr = Array.isArray(op[key]) ? op[key] : [];
  if (key === 'clientes') {
    return arr.map((c) => ({
      value: String(c.code),
      label: String(c.name || c.code) + ' (' + String(c.code) + ')',
    }));
  }
  if (key === 'skus') {
    return arr.map((s) => ({
      value: String(s.code),
      label: String(s.code) + (s.desc ? ' - ' + String(s.desc) : ''),
    }));
  }
  return arr.map((v) => ({ value: String(v), label: String(v) }));
}

function _resumenSel(key, opciones) {
  const n = state.sel[key].length;
  if (n === 0) return 'Todos';
  if (n === 1) {
    const o = opciones.find((x) => x.value === state.sel[key][0]);
    return o ? o.label : state.sel[key][0];
  }
  return n + ' seleccionados';
}

function _renderFiltro(def) {
  if (def.key === 'vendedores' && _isVendedor()) {
    return (
      '<div class="dv-filtro"><div class="dv-filtro-label">' +
      _escHtml(def.label) +
      '</div><div class="dv-ms-locked" title="Ves solo tus clientes">' +
      _escHtml(_myVendor() || 'Tus clientes') +
      ' 🔒</div></div>'
    );
  }
  const opciones = _opcionesDe(def.key);
  const selected = new Set(state.sel[def.key]);
  let list = '';
  for (const o of opciones) {
    list +=
      '<label class="dv-ms-opt" data-search="' +
      _escHtml(o.label.toLowerCase()) +
      '"><input type="checkbox" data-filtro="' +
      def.key +
      '" value="' +
      _escHtml(o.value) +
      '"' +
      (selected.has(o.value) ? ' checked' : '') +
      '> <span>' +
      _escHtml(o.label) +
      '</span></label>';
  }
  if (!list) list = '<div class="dv-muted" style="padding:6px">Sin opciones todavía.</div>';
  return (
    '<div class="dv-filtro"><div class="dv-filtro-label">' +
    _escHtml(def.label) +
    '</div><details class="dv-ms" data-ms="' +
    def.key +
    '"><summary>' +
    _escHtml(_resumenSel(def.key, opciones)) +
    '</summary><div class="dv-ms-pop">' +
    '<input type="search" class="dv-ms-search" placeholder="Buscar…" data-ms-search="' +
    def.key +
    '">' +
    '<div class="dv-ms-actions"><button type="button" class="dv-link" data-ms-clear="' +
    def.key +
    '">Limpiar</button></div>' +
    '<div class="dv-ms-list">' +
    list +
    '</div></div></details></div>'
  );
}

/** Lee del DOM lo que el usuario marcó. Solo se llama al tocar "Aplicar". */
function _readSelFromDom(root) {
  const next = _selVacia();
  root.querySelectorAll('input[type="checkbox"][data-filtro]').forEach((el) => {
    const key = el.getAttribute('data-filtro');
    if (el.checked && next[key]) next[key].push(el.value);
  });
  if (_isVendedor()) next.vendedores = [];
  state.sel = next;
  const mesEl = root.querySelector('#dv-mes');
  if (mesEl && /^\d{4}-\d{2}$/.test(mesEl.value)) state.mes = mesEl.value;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Arma el esqueleto (filtros arriba, resultados abajo) una sola vez. */
function _ensureSkeleton() {
  const body = document.getElementById('dashboard-ventas-body');
  if (!body) return null;
  if (!document.getElementById('dv-filtros-host') || !document.getElementById('dv-results')) {
    body.innerHTML = '<div id="dv-filtros-host"></div><div id="dv-results"></div>';
    state.opcionesRendered = null;
  }
  return body;
}

/**
 * Panel de filtros. Se re-arma solo cuando cambian las opciones (una vez por
 * respuesta), al resetear por cambio de usuario o con "Limpiar filtros". Ni el
 * "Cargando…" ni "Ver más" lo tocan, así no se pierden cambios sin aplicar.
 */
function renderFiltros(force) {
  const host = document.getElementById('dv-filtros-host');
  if (!host) return;
  if (!force && state.opcionesRendered === state.opciones && host.innerHTML) return;
  const prev = document.getElementById('dv-filtros');
  const abierto = prev ? !!prev.open : window.innerWidth > 700;
  let html = '<details class="dv-filtros" id="dv-filtros"' + (abierto ? ' open' : '') + '>';
  html += '<summary>Filtros</summary><div class="dv-filtros-grid">';
  html +=
    '<div class="dv-filtro"><div class="dv-filtro-label">Mes</div><input type="month" id="dv-mes" class="dv-input" value="' +
    _escHtml(state.mes) +
    '"></div>';
  for (const def of FILTROS_DEF) html += _renderFiltro(def);
  html += '</div><div class="dv-filtros-actions">';
  html +=
    '<button type="button" class="dv-btn-secondary" data-dv-action="limpiar">Limpiar filtros</button>' +
    '<button type="button" class="dv-btn-primary" id="dv-aplicar" data-dv-action="aplicar"' +
    (state.loading ? ' disabled' : '') +
    '>Aplicar</button>';
  html += '</div></details>';
  host.innerHTML = html;
  state.opcionesRendered = state.opciones;
}

function _syncAplicarDisabled() {
  const btn = document.getElementById('dv-aplicar');
  if (btn) btn.disabled = !!state.loading;
}

function _card(titulo, valor) {
  return (
    '<div class="dv-card"><div class="dv-card-title">' +
    _escHtml(titulo) +
    '</div><div class="dv-card-value">' +
    _escHtml(valor) +
    '</div></div>'
  );
}

// Porcentaje con coma decimal (es-AR): 80,5%
function _fmtPct(n) {
  return (
    (Number(n) || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }) + '%'
  );
}

// AAAA-MM-DD -> DD/MM/AAAA (si no tiene ese formato, se devuelve tal cual)
function _fmtFecha(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f == null ? '' : f));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(f == null ? '' : f);
}

function _tipoLabel(t) {
  return t === 'visita' ? 'Visita' : 'Contacto';
}

// Tabla de interacciones (solo el contenedor con scroll; se reemplaza al buscar).
function _interaccionesTabla(rows, total, query) {
  const q = String(query || '')
    .toLowerCase()
    .trim();
  const lista = Array.isArray(rows) ? rows : [];
  const filtered = q
    ? lista.filter((r) =>
        (
          String(r.cliente) +
          ' ' +
          _fmtFecha(r.fecha) +
          ' ' +
          String(r.vendedor) +
          ' ' +
          _tipoLabel(r.tipo)
        )
          .toLowerCase()
          .includes(q)
      )
    : lista;
  let html =
    '<div class="dv-table-wrap dv-inter-wrap"><table class="dv-table"><thead><tr><th>Cliente</th><th>Fecha</th><th>Vendedor</th><th>Tipo</th></tr></thead><tbody>';
  for (const r of filtered) {
    html +=
      '<tr><td>' +
      _escHtml(r.cliente) +
      '</td><td>' +
      _escHtml(_fmtFecha(r.fecha)) +
      '</td><td>' +
      _escHtml(r.vendedor) +
      '</td><td>' +
      _escHtml(_tipoLabel(r.tipo)) +
      '</td></tr>';
  }
  if (filtered.length === 0)
    html += '<tr><td colspan="4" class="dv-muted">Sin resultados.</td></tr>';
  html += '</tbody></table></div>';
  const totalN = Number(total) || 0;
  if (totalN > lista.length) {
    html +=
      '<div class="dv-muted">Mostrando ' +
      _escHtml(_fmtUds(lista.length)) +
      ' de ' +
      _escHtml(_fmtUds(totalN)) +
      '</div>';
  }
  return html;
}

/** Tabla de interacciones con buscador. El texto buscado se pone por DOM. */
function _interaccionesSection(t, query) {
  const rows = (t && t.rows) || [];
  return (
    '<section class="dv-section" id="dv-interacciones"><div class="dv-section-head"><h3>Interacciones</h3></div>' +
    '<input type="search" class="dv-ms-search" id="dv-interacciones-buscar" placeholder="Buscar cliente, vendedor o tipo…">' +
    '<div class="dv-inter-body">' +
    _interaccionesTabla(rows, t && t.total, query) +
    '</div></section>'
  );
}

/** Bloque de gestión: tarjetas + nota + tabla de interacciones. */
function _gestionSection(g, secciones, query) {
  if (!g || (secciones && secciones.gestion && secciones.gestion.error)) {
    return '<div class="dv-cards" id="dv-gestion">' + _card('Gestión', 'No disponible') + '</div>';
  }
  let html = '<div class="dv-cards" id="dv-gestion">';
  html += _card('Target', g.target == null ? 'Sin target' : _fmtArs(g.target));
  html += _card(
    '% cumplimiento',
    g.cumplimientoPct == null ? 'Sin target' : _fmtPct(g.cumplimientoPct)
  );
  html += _card('Rendiciones – monto', _fmtArs(g.rendicionesArs));
  html += _card('Base activa', _fmtUds(g.baseActiva));
  html += _card('Ticket promedio', _fmtArs(g.ticketPromedio));
  html += _card('N° visitas', _fmtUds(g.visitas));
  html += _card('N° contactados', _fmtUds(g.contactados));
  html += _card('N° interacciones', _fmtUds(g.interacciones));
  html += '</div>';
  if (g.filtrosNoAplican) {
    html +=
      '<div class="dv-leyenda dv-muted">Target y rendiciones no se filtran por cliente ni producto; visitas y contactos no se filtran por producto.</div>';
  }
  html += _interaccionesSection(g.tablaInteracciones, query);
  return html;
}

// Tipos permitidos del "Ver más": lista blanca (el atributo del DOM nunca se reusa en el HTML).
function _tipoVerMas(tipoIn) {
  return tipoIn === 'dinero' ? 'dinero' : tipoIn === 'clientes' ? 'clientes' : 'unidades';
}

function _verMasTabla(tipoIn, rows) {
  const tipo = _tipoVerMas(tipoIn);
  const q = state.verMasQuery[tipo].toLowerCase().trim();
  const esCli = tipo === 'clientes';
  // Posición del ranking calculada una sola vez (sin indexOf por fila).
  const ranked = rows.map((r, i) => ({ r, pos: i + 1 }));
  const filtered = q
    ? ranked.filter((x) =>
        (esCli
          ? String(x.r.nombre) + ' ' + String(x.r.code)
          : String(x.r.sku) + ' ' + String(x.r.desc || '')
        )
          .toLowerCase()
          .includes(q)
      )
    : ranked;
  let html =
    '<div class="dv-vermas"><input type="search" class="dv-ms-search" placeholder="' +
    (esCli ? 'Buscar cliente…' : 'Buscar SKU o descripción…') +
    '" data-vermas-search="' +
    tipo +
    '"><div class="dv-table-wrap"><table class="dv-table"><thead><tr>' +
    (esCli
      ? '<th>#</th><th>Cliente</th><th class="num">Facturado</th>'
      : '<th>#</th><th>SKU</th><th>Descripción</th><th class="num">Unidades</th><th class="num">Dinero</th>') +
    '</tr></thead><tbody>';
  for (const { r, pos } of filtered) {
    if (esCli) {
      html +=
        '<tr><td>' +
        pos +
        '</td><td>' +
        _escHtml(r.nombre) +
        '</td><td class="num">' +
        _escHtml(_fmtArs(r.facturado)) +
        '</td></tr>';
      continue;
    }
    html +=
      '<tr><td>' +
      pos +
      '</td><td class="mono">' +
      _escHtml(r.sku) +
      '</td><td>' +
      _escHtml(r.desc) +
      '</td><td class="num">' +
      _escHtml(_fmtUds(r.uds)) +
      '</td><td class="num">' +
      _escHtml(_fmtArs(r.ars)) +
      '</td></tr>';
  }
  if (filtered.length === 0)
    html += '<tr><td colspan="' + (esCli ? 3 : 5) + '" class="dv-muted">Sin resultados.</td></tr>';
  html += '</tbody></table></div></div>';
  return html;
}

function _topSection(tipo, titulo, rows) {
  const abierto = state.verMas[tipo];
  const total = rows.length;
  const h = Math.max(120, Math.min(TOP_N, total) * 22 + 40);
  return (
    '<section class="dv-section"><div class="dv-section-head"><h3>' +
    _escHtml(titulo) +
    '</h3>' +
    (total > 0
      ? '<button type="button" class="dv-link" data-vermas="' +
        tipo +
        '" aria-expanded="' +
        (abierto ? 'true' : 'false') +
        '">' +
        (abierto ? 'Ver menos' : 'Ver más') +
        ' (' +
        total +
        ')</button>'
      : '') +
    '</div>' +
    (total > 0
      ? '<div class="dv-chart" style="height:' +
        h +
        'px"><canvas id="dv-chart-top-' +
        tipo +
        '" role="img" aria-label="' +
        _escHtml(titulo) +
        '"></canvas></div>'
      : '<div class="dv-muted">Sin datos.</div>') +
    (abierto ? _verMasTabla(tipo, rows) : '') +
    '</section>'
  );
}

// ---------------------------------------------------------------------------
// Productos, cobertura y facturación por cliente (entrega B)
// ---------------------------------------------------------------------------

const PRODUCTOS_MAX_FILAS = 200;
const PRODUCTOS_DEBOUNCE_MS = 200;
// Memo del stock por SKU: se limpia al renderizar resultados y al cambiar de usuario.
const _stockMemo = new Map();
let _prodTimer = null;

/** Stock de la app para un SKU (con memo). Todo null si el stock todavía no cargó ("…"). */
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
    if (typeof window === 'undefined' || typeof window.getStockBreakdown !== 'function')
      return vacio;
    // getStockDisponibleVenta devuelve null mientras el stock no está cargado.
    if (typeof window.getStockDisponibleVenta === 'function') {
      if (window.getStockDisponibleVenta(sku) === null) return vacio;
    }
    const b = window.getStockBreakdown(sku);
    if (!b) return vacio;
    return {
      reservadas: Number(b.reservadasTotal) || 0,
      libre: Number(b.libre) || 0,
      stock: Number(b.fisicoDep11) || 0,
    };
  } catch (_e) {
    return vacio;
  }
}

function _fmtStockCol(n) {
  return n == null ? '…' : _fmtUds(n);
}

/** Etiqueta de cobertura: "36 de 66 · 54,55%" (coma decimal); sin porcentaje: "36 de 0 · —". */
function _coberturaEtiqueta(r) {
  const pct =
    r.pct == null
      ? '—'
      : (Number(r.pct) || 0).toLocaleString('es-AR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }) + '%';
  return (Number(r.compraron) || 0) + ' de ' + (Number(r.dadosAlta) || 0) + ' · ' + pct;
}

/** Tabla de productos (solo el contenedor con scroll; se reemplaza al buscar). */
function _productosTabla(rows, query) {
  const q = String(query || '')
    .toLowerCase()
    .trim();
  const lista = Array.isArray(rows) ? rows : [];
  const matches = q
    ? lista.filter((r) =>
        (String(r.categoria) + ' ' + String(r.familia) + ' ' + String(r.sku))
          .toLowerCase()
          .includes(q)
      )
    : lista;
  const filtered = matches.slice(0, PRODUCTOS_MAX_FILAS);
  let html =
    '<div class="dv-table-wrap"><table class="dv-table"><thead><tr><th>CATEGORIA</th><th>FAMILIA</th><th>SKU</th><th class="num">UNIDADES VENDIDAS</th><th class="num">FACTURADO</th><th class="num">UNIDADES BACKORDER</th><th class="num">UNIDADES RESERVADAS</th><th class="num">UNIDADES LIBRE PARA LA VENTA</th><th class="num">UNIDADES EN STOCK</th></tr></thead><tbody>';
  for (const r of filtered) {
    const st = _stockColumnas(r.sku);
    html +=
      '<tr><td>' +
      _escHtml(r.categoria) +
      '</td><td>' +
      _escHtml(r.familia) +
      '</td><td class="mono">' +
      _escHtml(r.sku) +
      '</td><td class="num">' +
      _escHtml(_fmtUds(r.udsVendidas)) +
      '</td><td class="num">' +
      _escHtml(_fmtArs(r.facturado)) +
      '</td><td class="num">' +
      _escHtml(_fmtUds(r.udsBackorder)) +
      '</td><td class="num">' +
      _escHtml(_fmtStockCol(st.reservadas)) +
      '</td><td class="num">' +
      _escHtml(_fmtStockCol(st.libre)) +
      '</td><td class="num">' +
      _escHtml(_fmtStockCol(st.stock)) +
      '</td></tr>';
  }
  if (filtered.length === 0)
    html += '<tr><td colspan="9" class="dv-muted">Sin resultados.</td></tr>';
  html += '</tbody></table></div>';
  if (matches.length > filtered.length) {
    html +=
      '<div class="dv-muted">Mostrando ' +
      PRODUCTOS_MAX_FILAS +
      ' de ' +
      _escHtml(_fmtUds(matches.length)) +
      '. Usá el buscador para ver el resto.</div>';
  }
  return html;
}

function _noDisponible(id, titulo) {
  return (
    '<section class="dv-section" id="' +
    id +
    '"><div class="dv-section-head"><h3>' +
    _escHtml(titulo) +
    '</h3></div><div class="dv-muted">No disponible</div></section>'
  );
}

function _productosSection(rows, secciones, query) {
  if (!Array.isArray(rows) || (secciones && secciones.productos && secciones.productos.error)) {
    return _noDisponible('dv-productos', 'Productos');
  }
  return (
    '<section class="dv-section" id="dv-productos"><div class="dv-section-head"><h3>Productos</h3></div>' +
    '<input type="search" class="dv-ms-search" id="dv-productos-buscar" placeholder="Buscar categoría, familia o SKU…">' +
    '<div class="dv-prod-body">' +
    _productosTabla(rows, query) +
    '</div></section>'
  );
}

function _coberturaSection(rows, secciones) {
  if (!Array.isArray(rows) || (secciones && secciones.cobertura && secciones.cobertura.error)) {
    return _noDisponible('dv-cobertura-chart', 'Cobertura de clientes');
  }
  const h = Math.max(120, rows.length * 44 + 40);
  return (
    '<section class="dv-section" id="dv-cobertura-chart"><div class="dv-section-head"><h3>Cobertura de clientes</h3></div>' +
    (rows.length > 0
      ? '<div class="dv-chart" style="height:' +
        h +
        'px"><canvas id="dv-canvas-cobertura" role="img" aria-label="Cobertura de clientes"></canvas></div>'
      : '<div class="dv-muted">Sin datos.</div>') +
    '</section>'
  );
}

function _clientesSection(rows, secciones) {
  if (!Array.isArray(rows) || (secciones && secciones.clientes && secciones.clientes.error)) {
    return _noDisponible('dv-clientes-chart', 'Facturación por cliente');
  }
  const abierto = state.verMas.clientes;
  const total = rows.length;
  const h = Math.max(120, Math.min(TOP_N, total) * 22 + 40);
  return (
    '<section class="dv-section" id="dv-clientes-chart"><div class="dv-section-head"><h3>Facturación por cliente - Top 20</h3>' +
    (total > 0
      ? '<button type="button" class="dv-link" data-vermas="clientes" aria-expanded="' +
        (abierto ? 'true' : 'false') +
        '">' +
        (abierto ? 'Ver menos' : 'Ver más') +
        ' (' +
        total +
        ')</button>'
      : '') +
    '</div>' +
    (total > 0
      ? '<div class="dv-chart" style="height:' +
        h +
        'px"><canvas id="dv-chart-top-clientes" role="img" aria-label="Facturación por cliente"></canvas></div>'
      : '<div class="dv-muted">Sin datos.</div>') +
    (abierto ? _verMasTabla('clientes', rows) : '') +
    '</section>'
  );
}

function _lineSection(id, titulo) {
  return (
    '<section class="dv-section"><div class="dv-section-head"><h3>' +
    _escHtml(titulo) +
    '</h3></div><div class="dv-chart" style="height:240px"><canvas id="' +
    id +
    '" role="img" aria-label="' +
    _escHtml(titulo) +
    '"></canvas></div></section>'
  );
}

function _isEmpty(d) {
  if (!d) return true;
  const k = d.kpis || {};
  const hayKpi =
    Number(k.facturado) || Number(k.pedidos) || Number(k.pedidosUnicos) || Number(k.backorderArs);
  const hayTop = Array.isArray(d.topUnidades) && d.topUnidades.length > 0;
  const haySerie = Array.isArray(d.serieVentas) && d.serieVentas.some((p) => Number(p.valor));
  return !hayKpi && !hayTop && !haySerie;
}

/** Resultados (leyenda, tarjetas, rankings, gráficos). No toca los filtros. */
function renderResults() {
  _stockMemo.clear();
  const root = document.getElementById('dv-results');
  if (!root) return;
  const d = state.data;

  let html =
    '<div class="dv-leyenda">Montos sin IVA, con descuento aplicado y notas de crédito restadas.';
  if (d && d.dataUpdatedAt && !state.loading) {
    const t = new Date(d.dataUpdatedAt);
    if (!Number.isNaN(t.getTime())) {
      html +=
        ' <span class="dv-muted">· Calculado ' +
        _escHtml(t.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })) +
        '</span>';
    }
  }
  html += '</div>';

  if (state.loading) {
    html += '<div class="dv-estado">Cargando…</div>';
  } else if (state.error) {
    html +=
      '<div class="dv-estado dv-error">' + _escHtml(state.error).replace(/\n/g, '<br>') + '</div>';
  } else if (d && _isEmpty(d)) {
    html += '<div class="dv-estado">No hay ventas con esos filtros.</div>';
  } else if (d) {
    const k = d.kpis || {};
    html += '<div class="dv-cards">';
    html += _card('Facturado mensual', _fmtArs(k.facturado));
    html += _card('Valorización backorder', _fmtArs(k.backorderArs));
    html += _card('Cant. de pedidos del mes', _fmtUds(k.pedidos));
    html += _card('Cant. pedidos únicos', _fmtUds(k.pedidosUnicos));
    html += '</div>';
    html += _gestionSection(d.gestion, d.secciones, state.interQuery);
    html += _topSection('unidades', 'Top 20 SKU - Unidades', d.topUnidades || []);
    html += _topSection('dinero', 'Top 20 SKU - Dinero', d.topDinero || []);
    html += _lineSection('dv-chart-ventas', 'Evolución de ventas');
    html += _lineSection('dv-chart-bo-uds', 'Evolución del backorder - Unidades');
    html += _lineSection('dv-chart-bo-ars', 'Evolución del backorder - Dinero');
    html += _productosSection(d.productos, d.secciones, state.prodQuery);
    html += _coberturaSection(d.cobertura, d.secciones);
    html += _clientesSection(d.clientes, d.secciones);
  }

  _destroyCharts();
  root.innerHTML = html;
  // El texto del buscador de "Ver más" se pone por DOM, nunca dentro del HTML.
  root.querySelectorAll('input[data-vermas-search]').forEach((inp) => {
    const k = inp.getAttribute('data-vermas-search');
    if (k) /** @type {HTMLInputElement} */ (inp).value = state.verMasQuery[k] || '';
  });

  const interInp = root.querySelector('#dv-interacciones-buscar');
  if (interInp) /** @type {HTMLInputElement} */ (interInp).value = state.interQuery || '';
  const prodInp = root.querySelector('#dv-productos-buscar');
  if (prodInp) /** @type {HTMLInputElement} */ (prodInp).value = state.prodQuery || '';

  // Sin modal abierto no se dibuja (respuesta que llegó después de cerrar).
  if (_isOpen() && !state.loading && !state.error && d && !_isEmpty(d)) {
    _loadChartJs()
      .then(() => {
        if (_isOpen() && state.data === d) _drawCharts(d);
      })
      .catch((e) => {
        console.warn('[dashboard-ventas] Chart.js no disponible:', e);
        root.querySelectorAll('.dv-chart').forEach((el) => {
          el.innerHTML =
            '<div class="dv-muted">No se pudo cargar el gráfico. Revisá la conexión.</div>';
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

const CHART_FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
const CHART_GRID_LIGHT = 'rgba(0,0,0,.06)';
const CHART_GRID_DARK = 'rgba(255,255,255,.08)';

/** Grilla suave; en tema oscuro usa blanco translúcido para que se vea. */
function _chartGrid() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return { color: dark ? CHART_GRID_DARK : CHART_GRID_LIGHT };
}

function _barChart(canvasId, rows, field, fmt, color) {
  const el = document.getElementById(canvasId);
  if (!el || !window.Chart) return;
  // Spec: SKUs con neto <= 0 no entran al Top (la tabla "Ver más" sí los muestra).
  const top = rows.filter((r) => (Number(r[field]) || 0) > 0).slice(0, TOP_N);
  charts[canvasId] = new window.Chart(el, {
    type: 'bar',
    data: {
      labels: top.map((r) => String(r.sku)),
      datasets: [
        { data: top.map((r) => Number(r[field]) || 0), backgroundColor: color, borderRadius: 3 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const r = top[items[0].dataIndex];
              return r ? String(r.sku) + (r.desc ? ' - ' + String(r.desc) : '') : '';
            },
            label: (item) => fmt(item.raw),
          },
        },
      },
      scales: {
        x: {
          grid: _chartGrid(),
          border: { display: false },
          ticks: {
            font: { family: CHART_FONT },
            callback: (v) => fmt(v),
            maxTicksLimit: 5,
            color: _cssVar('--text-muted', '#64748b'),
          },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: false,
            font: { size: 10, family: CHART_FONT },
            color: _cssVar('--text-secondary', '#334155'),
          },
        },
      },
    },
  });
}

/**
 * Serie de back order en 2 datasets: real (línea llena) y estimado (punteada).
 * Un punto estimado se conecta con su vecino real para que la curva no quede
 * cortada en la transición; `null` (sin datos) corta la línea (spanGaps:false).
 */
function _splitBackorder(serie) {
  const real = serie.map((p) => (p.valor == null || p.estimado ? null : Number(p.valor)));
  const est = serie.map((p) => (p.valor == null || !p.estimado ? null : Number(p.valor)));
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
      label: 'real',
      data: s.real,
      borderColor: color,
      backgroundColor: color,
      spanGaps: false,
      tension: 0.2,
      pointRadius: 3,
    });
    if (s.hayEstimado) {
      datasets.push({
        label: 'estimado',
        data: s.est,
        borderColor: color,
        backgroundColor: color,
        borderDash: [6, 4],
        spanGaps: false,
        tension: 0.2,
        pointRadius: 3,
        pointStyle: 'rectRot',
      });
    }
  } else {
    datasets.push({
      label: 'facturado',
      data: serie.map((p) => (p.valor == null ? null : Number(p.valor))),
      borderColor: color,
      backgroundColor: color,
      spanGaps: false,
      tension: 0.2,
      pointRadius: 3,
    });
  }
  charts[canvasId] = new window.Chart(el, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: conEstimado && datasets.length > 1 },
        tooltip: { callbacks: { label: (item) => item.dataset.label + ': ' + fmt(item.raw) } },
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
            color: _cssVar('--text-muted', '#64748b'),
          },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { family: CHART_FONT }, color: _cssVar('--text-muted', '#64748b') },
        },
      },
    },
  });
}

/** Barras horizontales de cobertura: una por vendedor, 0-100%. */
function _coberturaChart(rows) {
  const el = document.getElementById('dv-canvas-cobertura');
  if (!el || !window.Chart) return;
  charts['dv-canvas-cobertura'] = new window.Chart(el, {
    type: 'bar',
    data: {
      labels: rows.map((r) => [String(r.vendedor), _coberturaEtiqueta(r)]),
      datasets: [
        {
          data: rows.map((r) => (r.pct == null ? 0 : Number(r.pct) || 0)),
          backgroundColor: '#0284a0',
          borderRadius: 3,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const r = rows[items[0].dataIndex];
              return r ? String(r.vendedor) : '';
            },
            label: (item) => {
              const r = rows[item.dataIndex];
              return r ? _coberturaEtiqueta(r) : '';
            },
          },
        },
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          grid: _chartGrid(),
          border: { display: false },
          ticks: {
            font: { family: CHART_FONT },
            callback: (v) => v + '%',
            maxTicksLimit: 5,
            color: _cssVar('--text-muted', '#64748b'),
          },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: false,
            font: { size: 10, family: CHART_FONT },
            color: _cssVar('--text-secondary', '#334155'),
          },
        },
      },
    },
  });
}

function _drawCharts(d) {
  // Puede que el usuario haya re-renderizado mientras cargaba Chart.js.
  _destroyCharts();
  _barChart('dv-chart-top-unidades', d.topUnidades || [], 'uds', _fmtUds, '#0284a0');
  _barChart('dv-chart-top-dinero', d.topDinero || [], 'ars', _fmtArs, '#16a34a');
  _lineChart('dv-chart-ventas', d.serieVentas || [], _fmtArs, '#1e40af', false);
  _lineChart('dv-chart-bo-uds', d.serieBoUds || [], _fmtUds, '#c2410c', true);
  _lineChart('dv-chart-bo-ars', d.serieBoArs || [], _fmtArs, '#9f1239', true);
  if (Array.isArray(d.cobertura)) _coberturaChart(d.cobertura);
  if (Array.isArray(d.clientes)) {
    // _barChart usa sku/desc: se adaptan nombre y código del cliente.
    const filas = d.clientes.map((c) => ({ sku: c.nombre, desc: c.code, facturado: c.facturado }));
    _barChart('dv-chart-top-clientes', filas, 'facturado', _fmtArs, '#7c3aed');
  }
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

function _filtrosPayload() {
  return {
    mes: state.mes,
    vendedores: _isVendedor() ? [] : state.sel.vendedores.slice(),
    clientes: state.sel.clientes.slice(),
    provincias: state.sel.provincias.slice(),
    categorias: state.sel.categorias.slice(),
    skus: state.sel.skus.slice(),
  };
}

async function cargar() {
  const seq = ++state.reqSeq;
  state.loading = true;
  state.error = '';
  render();
  try {
    if (typeof firebase === 'undefined' || !firebase.app) throw new Error('firebase no disponible');
    const callable = firebase.app().functions(REGION).httpsCallable('dashboardVentasCF');
    const res = await callable(_filtrosPayload());
    if (seq !== state.reqSeq) return;
    state.data = (res && res.data) || null;
    if (state.data && state.data.opciones) state.opciones = state.data.opciones;
    state.verMas = { unidades: false, dinero: false };
  } catch (e) {
    if (seq !== state.reqSeq) return;
    console.error('[dashboard-ventas] dashboardVentasCF fallo:', e);
    state.error = _errorMessage();
  } finally {
    if (seq === state.reqSeq) {
      state.loading = false;
      render();
    }
  }
}

// ---------------------------------------------------------------------------
// Eventos (delegados sobre el body del modal)
// ---------------------------------------------------------------------------

let _wired = false;
function _wire() {
  if (_wired) return;
  const body = document.getElementById('dashboard-ventas-body');
  if (!body) return;
  _wired = true;

  body.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const act = t.closest('[data-dv-action]');
    if (act) {
      const a = act.getAttribute('data-dv-action');
      if (a === 'aplicar') {
        _readSelFromDom(body);
        cargar();
      } else if (a === 'limpiar') {
        state.sel = _selVacia();
        state.mes = _mesActualArt();
        renderFiltros(true);
        cargar();
      }
      return;
    }
    const vm = t.closest('[data-vermas]');
    if (vm) {
      const tipo = _tipoVerMas(vm.getAttribute('data-vermas'));
      state.verMas[tipo] = !state.verMas[tipo];
      // Solo resultados: no se leen ni se pisan filtros sin aplicar.
      renderResults();
      return;
    }
    const clr = t.closest('[data-ms-clear]');
    if (clr) {
      const key = clr.getAttribute('data-ms-clear');
      body.querySelectorAll('input[type="checkbox"][data-filtro="' + key + '"]').forEach((el) => {
        el.checked = false;
      });
      _updateSummary(body, key);
    }
  });

  body.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t instanceof HTMLInputElement && t.type === 'checkbox' && t.hasAttribute('data-filtro')) {
      _updateSummary(body, t.getAttribute('data-filtro'));
    }
  });

  body.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    const msKey = t.getAttribute('data-ms-search');
    if (msKey) {
      const q = t.value.toLowerCase().trim();
      const det = body.querySelector('details[data-ms="' + msKey + '"]');
      if (!det) return;
      det.querySelectorAll('.dv-ms-opt').forEach((opt) => {
        const s = opt.getAttribute('data-search') || '';
        opt.style.display = !q || s.includes(q) ? '' : 'none';
      });
      return;
    }
    if (t.id === 'dv-interacciones-buscar') {
      state.interQuery = t.value;
      const g = state.data && state.data.gestion;
      const ti = (g && g.tablaInteracciones) || { rows: [], total: 0 };
      const cont = body.querySelector('#dv-interacciones .dv-inter-body');
      if (cont) cont.innerHTML = _interaccionesTabla(ti.rows, ti.total, state.interQuery);
      return;
    }
    if (t.id === 'dv-productos-buscar') {
      state.prodQuery = t.value;
      if (_prodTimer) clearTimeout(_prodTimer);
      _prodTimer = setTimeout(() => {
        _prodTimer = null;
        const cont = body.querySelector('#dv-productos .dv-prod-body');
        if (cont)
          cont.innerHTML = _productosTabla(state.data && state.data.productos, state.prodQuery);
      }, PRODUCTOS_DEBOUNCE_MS);
      return;
    }
    const vmAttr = t.getAttribute('data-vermas-search');
    if (vmAttr) {
      // Solo tres rankings posibles: nunca reusar el texto del atributo en el HTML.
      const vmKey = _tipoVerMas(vmAttr);
      state.verMasQuery[vmKey] = t.value;
      const sec = t.closest('.dv-vermas');
      const dd = state.data;
      const rows =
        (dd &&
          (vmKey === 'unidades'
            ? dd.topUnidades
            : vmKey === 'dinero'
              ? dd.topDinero
              : dd.clientes)) ||
        [];
      if (sec) {
        const tmp = document.createElement('div');
        tmp.innerHTML = _verMasTabla(vmKey, rows);
        const newWrap = tmp.querySelector('.dv-table-wrap');
        const oldWrap = sec.querySelector('.dv-table-wrap');
        if (newWrap && oldWrap) oldWrap.replaceWith(newWrap);
      }
    }
  });
}

function _updateSummary(body, key) {
  const det = body.querySelector('details[data-ms="' + key + '"]');
  if (!det) return;
  const checked = Array.from(det.querySelectorAll('input[type="checkbox"]:checked'));
  const sum = det.querySelector('summary');
  if (!sum) return;
  if (checked.length === 0) sum.textContent = 'Todos';
  else if (checked.length === 1) {
    const span = checked[0].parentElement && checked[0].parentElement.querySelector('span');
    sum.textContent = span ? span.textContent : checked[0].value;
  } else sum.textContent = checked.length + ' seleccionados';
}

// ---------------------------------------------------------------------------
// API pública (exports del chunk)
// ---------------------------------------------------------------------------

window.openDashboardVentas = function () {
  const modal = document.getElementById('dashboard-ventas-modal');
  if (!modal) return;
  const role = _role();
  if (role !== 'admin' && role !== 'gerente' && role !== 'vendedor') {
    alert('Tu usuario no tiene acceso al Dashboard de Ventas. Si lo necesitás, avisale a Mariano.');
    return;
  }
  // Otro usuario en la misma pestaña (logout + login sin recargar): se
  // descarta todo lo del anterior. Mismo usuario: se conserva su selección.
  const uid = _currentUid();
  if (uid !== state.uid) _resetState(uid);
  if (!state.mes) state.mes = _mesActualArt();
  modal.classList.add('open');
  _ensureSkeleton();
  _wire();
  renderFiltros(true);
  // Precarga Chart.js en paralelo a la consulta.
  _loadChartJs().catch(() => {});
  // Siempre se pide de nuevo al abrir (el servidor cachea 10 min).
  cargar();
};

window.closeDashboardVentas = function () {
  const modal = document.getElementById('dashboard-ventas-modal');
  if (modal) modal.classList.remove('open');
  _destroyCharts();
  // Los datos no se guardan entre aperturas; se vuelven a pedir al abrir.
  state.data = null;
  state.loading = false;
  state.reqSeq++;
};
