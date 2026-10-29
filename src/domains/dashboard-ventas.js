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
  verMas: { unidades: false, dinero: false },
  verMasQuery: { unidades: '', dinero: '' },
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
  state.verMas = { unidades: false, dinero: false };
  state.verMasQuery = { unidades: '', dinero: '' };
  state.reqSeq++;
}

/** @type {Record<string, any>} */
const charts = {};
let chartJsPromise = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _escHtml(s) {
  const v = s == null ? '' : s;
  if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') {
    return window.escapeHtml(v);
  }
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

function _verMasTabla(tipo, rows) {
  const q = state.verMasQuery[tipo].toLowerCase().trim();
  // Posición del ranking calculada una sola vez (sin indexOf por fila).
  const ranked = rows.map((r, i) => ({ r, pos: i + 1 }));
  const filtered = q
    ? ranked.filter((x) =>
        (String(x.r.sku) + ' ' + String(x.r.desc || '')).toLowerCase().includes(q)
      )
    : ranked;
  let html =
    '<div class="dv-vermas"><input type="search" class="dv-ms-search" placeholder="Buscar SKU o descripción…" data-vermas-search="' +
    tipo +
    '" value="' +
    _escHtml(state.verMasQuery[tipo]) +
    '"><div class="dv-table-wrap"><table class="dv-table"><thead><tr><th>#</th><th>SKU</th><th>Descripción</th><th class="num">Unidades</th><th class="num">Dinero</th></tr></thead><tbody>';
  for (const { r, pos } of filtered) {
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
    html += '<tr><td colspan="5" class="dv-muted">Sin resultados.</td></tr>';
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
    html += _topSection('unidades', 'Top 20 SKU - Unidades', d.topUnidades || []);
    html += _topSection('dinero', 'Top 20 SKU - Dinero', d.topDinero || []);
    html += _lineSection('dv-chart-ventas', 'Evolución de ventas');
    html += _lineSection('dv-chart-bo-uds', 'Evolución del backorder - Unidades');
    html += _lineSection('dv-chart-bo-ars', 'Evolución del backorder - Dinero');
  }

  _destroyCharts();
  root.innerHTML = html;

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
          ticks: {
            callback: (v) => fmt(v),
            maxTicksLimit: 5,
            color: _cssVar('--text-muted', '#64748b'),
          },
        },
        y: {
          ticks: {
            autoSkip: false,
            font: { size: 10 },
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
          ticks: {
            callback: (v) => fmt(v),
            maxTicksLimit: 6,
            color: _cssVar('--text-muted', '#64748b'),
          },
        },
        x: { ticks: { color: _cssVar('--text-muted', '#64748b') } },
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
      const tipo = vm.getAttribute('data-vermas');
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
    const vmKey = t.getAttribute('data-vermas-search');
    if (vmKey) {
      state.verMasQuery[vmKey] = t.value;
      const sec = t.closest('.dv-vermas');
      const rows =
        (state.data && (vmKey === 'unidades' ? state.data.topUnidades : state.data.topDinero)) ||
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
