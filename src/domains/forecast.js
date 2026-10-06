// @ts-nocheck
// v1098+ Fase 1: import del parser puro. El módulo hace `window.SalesPlanParser`
// como side-effect y también exporta las fns nombradas; usamos side-effect
// porque forecast.js corre en el chunk lazy y window ya está disponible.
import '../pure/sales-plan-parser.js';

// Globals leidos del entorno (declarados en index.html inline o bundle previo):
// fbDb, currentUser, XLSX (cdn), escapeHtml. Mismo patron que otros dominios.
//
// FORECAST - modal admin-only (Mariano). Chunk lazy: se carga solo al primer
// click del boton FORECAST del header. Registrado en build.js LAZY_CHUNKS +
// src/main.js installChunkStubs + sw.js STATIC_ASSETS. Ver CLAUDE.md #18.
//
// v1111 clean: pipeline legacy (SKU + 6 columnas + politica 3m) removido.
// Reemplazado por:
//   - Fase 1 (v1098): Sales Plans mensuales Rods/Reels con formato SUR.
//   - Fase 2B (v1103): Forecast Estadistico (statsforecast pipeline offline).
//   - Fase 3A (v1109): Tabla Recomendacion de Compra.

// v1098+ (Fase 1 Forecast v2): Sales Plans mensuales por familia (Rods/Reels/FG).
// Se guardan en Firestore `sales_plan_cache/{familia}` + snapshot Excel original
// en Storage `forecasts_snapshots/{YYYY-MM}/{familia}.xlsx`.
// El parser puro vive en src/pure/sales-plan-parser.js (attach a window.SalesPlanParser).
// v1108: FG removido del UI (Mariano pidió). Solo Rods + Reels por ahora.
// La rule Firestore sigue aceptando 'fg' por si en el futuro se vuelve a
// activar — no borrarla en storage/firestore.rules hasta confirmar deprecate.
const SALES_PLAN_FAMILIAS = [
  { key: 'rods', label: 'Rods (Cañas)', color: '#0ea5e9' },
  { key: 'reels', label: 'Reels', color: '#8b5cf6' },
];
const _salesPlanCaches = { rods: null, reels: null }; // last loaded doc
let _forecastActiveTab = 'sales-plans'; // 'sales-plans' | 'stat' | 'legacy'

// v1103+ (Fase 2B): Forecast Estadístico — output publicado por
// scripts/forecast/publish_to_firestore.py a forecast_output/{sub_slug}
// + forecast_output_meta/current. 24 subs + 1 meta doc.
let _forecastStatDocs = null; // [{id, subfamilia, forecast[7], metrics, bestModel, versionId}]
let _forecastStatMeta = null; // {generatedAt, versionId, resumen: {...}}
let _forecastStatHistoryCache = null; // { [sub]: [{ds, y}] } cache lazy on-demand

// v1109+ (Fase 3A): Tabla Recomendación de Compra — combina sales plans +
// stock_snapshot + sku_ventas_snapshot para computar recomendado por SKU.
let _recoStockSnapshot = null; // {warehouseBreakdown: {sku:{'11':n,'12':n,...}}, backorderBySku: {sku:n}}
let _recoVentasSnapshot = null; // { [SKU upper]: {meses: {'YYYY-MM': {qty,ars}}} }
let _recoFilterMinRec = true; // "solo mostrar SKUs con recomendado > 0"
let _recoFilterFamilia = 'all'; // 'all' | 'rods' | 'reels'
let _recoSearchText = '';

// v1112+ (F3B): SKUs descontinuados que Mariano marca para excluir del forecast.
// Persisten en Firestore `forecast_config/discontinued_skus` como { skus: [SKU upper], updatedAt, updatedBy }.
let _discontinuedSkus = null; // Set<string upper> o null si no cargado
let _discontinuedMeta = null; // {updatedAt, updatedBy}

// v1114+ (F3B multiplicador dinámico): multiplicador auto por SKU = venta_2m
// dividido por venta_6m, con cap. Override manual persistido en Firestore
// `forecast_config/multipliers` con {skuOverrides: {SKU: {value, updatedBy, updatedAt}}}.
let _multiplierOverrides = null; // { [SKU upper]: {value, updatedBy, updatedAt} }
const RECO_MULT_RECENT_MONTHS = 2;
const RECO_MULT_BASELINE_MONTHS = 6;
const RECO_MULT_MIN = 0.5;
const RECO_MULT_MAX = 2.5;
const RECO_MULT_MIN_BASELINE = 0.1; // evita división por cero

const RECO_HORIZON_MONTHS = 7;
const RECO_VENTA_PROMEDIO_WINDOW = 3; // meses hacia atrás para promedio venta
// RECO_DEFAULT_MULTIPLIER removed 2026-10-06 (unused, flagged by biome).

// Whitelist de emails con acceso al modal FORECAST. Replica el patron de
// "Analisis" (index.html:12625). Solo Mariano; si otro admin lo necesita
// se agrega aca explicito.
const FORECAST_ALLOWED_EMAILS = ['mariano.erbino@shimano.com.ar', 'erbinomariano@gmail.com'];

function _canForecast() {
  try {
    const email = ((window.currentUser && window.currentUser.email) || '').toLowerCase();
    if (!email) return false;
    return FORECAST_ALLOWED_EMAILS.indexOf(email) >= 0;
  } catch {
    return false;
  }
}

function _renderModalShell() {
  const existing = document.getElementById('forecast-modal');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'forecast-modal';
  el.className = 'modal-overlay';
  el.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:2050;';
  el.onclick = function (ev) {
    if (ev.target === el) window.closeForecastModal();
  };
  // Shell + tabs bar + 2 contenedores de tabs (Sales Plans nueva, Legacy 6m).
  // El contenido de cada tab se pinta con _renderSalesPlansTab() y el legacy
  // usa el flujo _renderTable() de siempre.
  const shellHtml = _buildShellHtml();
  el.innerHTML = shellHtml;
  document.body.appendChild(el);
  return el;
}

function _buildShellHtml() {
  // Broken-out pure string builder para pasar el hook de innerHTML.
  const modalOuter =
    '<div style="position:absolute;inset:1vh 1vw;background:var(--bg-elevated);border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)">';
  const header =
    '<div style="padding:12px 18px;background:#0f172a;color:#fff;display:flex;align-items:center;gap:12px">' +
    '<div style="flex:1"><div style="font-size:16px;font-weight:800;letter-spacing:.5px">FORECAST</div>' +
    '<div id="forecast-subtitle" style="font-size:11px;opacity:.8;margin-top:2px">Sales Plans mensuales + politica de inventario</div></div>' +
    '<button onclick="closeForecastModal()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700">Cerrar</button>' +
    '</div>';
  // v1111: tab "Legacy (6m)" eliminada — el pipeline viejo (SKU + 6 columnas
  // vs sku_ventas_snapshot + política 3m) fue reemplazado por la tabla
  // Recomendación de Compra (v1109, F3A) que usa datos más completos.
  const tabsBar =
    '<div id="forecast-tabs-bar" style="display:flex;gap:0;background:var(--bg-secondary);padding:0 18px;border-bottom:1px solid var(--border-subtle)">' +
    '<button data-tab="sales-plans" onclick="switchForecastTab(\'sales-plans\')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-primary);border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button>' +
    '<button data-tab="stat" onclick="switchForecastTab(\'stat\')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Estadístico</button>' +
    '</div>';
  const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto"></div>';
  const tabStat = '<div id="forecast-tab-stat" style="flex:1;overflow:auto;display:none"></div>';
  return modalOuter + header + tabsBar + tabSalesPlans + tabStat + '</div>';
}

// v1098+ Fase 1 + v1103+ Fase 2B + v1105 fix + v1111 clean legacy: switch
// entre tabs Sales Plans / Forecast Estadístico.
window.switchForecastTab = function (tabId) {
  _forecastActiveTab = tabId;
  const sp = document.getElementById('forecast-tab-sales-plans');
  const st = document.getElementById('forecast-tab-stat');
  if (sp) sp.style.display = tabId === 'sales-plans' ? 'block' : 'none';
  if (st) st.style.display = tabId === 'stat' ? 'block' : 'none';
  const btns = document.querySelectorAll('#forecast-tabs-bar .forecast-tab');
  btns.forEach((b) => {
    const active = b.getAttribute('data-tab') === tabId;
    b.style.color = active ? 'var(--text-primary)' : 'var(--text-muted)';
    b.style.borderBottomColor = active ? '#0d9488' : 'transparent';
    b.style.fontWeight = active ? '700' : '600';
  });
  // v1105 fix: al activar la tab stat, mostrar placeholder inmediato para
  // que se vea algo mientras carga (o si el load ya termino, re-render).
  if (tabId === 'stat') {
    const cont = document.getElementById('forecast-tab-stat');
    if (cont) {
      if (_forecastStatDocs) {
        // Ya cargado: re-render (por si el user viene de otra tab).
        _renderForecastStatTab();
      } else {
        // Aún no cargado: placeholder + load.
        cont.innerHTML =
          '<div style="padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px">' +
          '<div style="display:inline-block;width:24px;height:24px;border:3px solid #0d9488;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:12px"></div>' +
          '<div>Cargando forecast_output desde Firestore...</div>' +
          '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>' +
          '</div>';
        _loadForecastOutput()
          .then(_renderForecastStatTab)
          .catch((e) => {
            console.error('[FORECAST stat] load fail', e);
            const c = document.getElementById('forecast-tab-stat');
            if (c) {
              c.innerHTML =
                '<div style="padding:60px 20px;text-align:center;color:#dc2626;line-height:1.6">' +
                '<div style="font-size:16px;font-weight:700;margin-bottom:12px">Error cargando forecast_output</div>' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">' +
                escapeHtmlSafe(e.message || String(e)) +
                '</div>' +
                '<button onclick="switchForecastTab(\'stat\')" style="padding:8px 14px;background:#0d9488;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer">Reintentar</button>' +
                '</div>';
            }
          });
      }
    }
  }
};

// ---------------------------------------------------------------------------
// FASE 1 — Sales Plans upload (Rods / Reels / FG)
// ---------------------------------------------------------------------------

function _yearMonthNow() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function _fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function _fmtDateShort(iso) {
  if (!iso) return '—';
  try {
    const d = iso.toDate ? iso.toDate() : new Date(iso);
    return (
      d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return String(iso);
  }
}

async function _loadSalesPlanCaches() {
  if (!window.fbDb) return;
  await Promise.all(
    SALES_PLAN_FAMILIAS.map(async (f) => {
      try {
        const doc = await window.fbDb.collection('sales_plan_cache').doc(f.key).get();
        _salesPlanCaches[f.key] = doc.exists ? doc.data() : null;
      } catch (e) {
        console.warn('[FORECAST] load sales_plan_cache/' + f.key + ' fail:', e && e.message);
        _salesPlanCaches[f.key] = null;
      }
    })
  );
}

function escapeHtmlSafe(s) {
  if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}

function _buildSalesPlanSlotHtml(f) {
  const cache = _salesPlanCaches[f.key];
  const rowsCount = cache && Number.isFinite(cache.rowsCount) ? cache.rowsCount : 0;
  const monthsCount =
    cache && Array.isArray(cache.detectedMonths) ? cache.detectedMonths.length : 0;
  const parsedAt = cache && cache.parsedAt ? _fmtDateShort(cache.parsedAt) : '';
  const uploadedBy = cache && cache.uploadedBy ? cache.uploadedBy : '';
  const sourceFilename = cache && cache.sourceFilename ? cache.sourceFilename : '';
  const yearMonth = cache && cache.yearMonth ? cache.yearMonth : '';
  const monthsRange =
    cache && cache.detectedMonths && cache.detectedMonths.length
      ? cache.detectedMonths[0] + ' → ' + cache.detectedMonths[cache.detectedMonths.length - 1]
      : '—';
  const hasCache = !!cache;
  const badge = hasCache
    ? '<div style="padding:4px 8px;background:#16a34a;color:#fff;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.4px">CARGADO</div>'
    : '<div style="padding:4px 8px;background:#dc2626;color:#fff;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.4px">FALTA</div>';
  const metaBlock = hasCache
    ? '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:11px;padding:10px 12px;background:var(--bg-secondary);border-radius:6px">' +
      '<div style="color:var(--text-muted);font-weight:600">Archivo</div><div style="color:var(--text-primary);font-family:monospace;word-break:break-all">' +
      escapeHtmlSafe(sourceFilename) +
      '</div>' +
      '<div style="color:var(--text-muted);font-weight:600">Subido</div><div style="color:var(--text-primary)">' +
      escapeHtmlSafe(parsedAt) +
      '</div>' +
      '<div style="color:var(--text-muted);font-weight:600">Por</div><div style="color:var(--text-primary)">' +
      escapeHtmlSafe(uploadedBy) +
      '</div>' +
      '<div style="color:var(--text-muted);font-weight:600">Snapshot</div><div style="color:var(--text-primary);font-family:monospace">' +
      escapeHtmlSafe(yearMonth) +
      '</div>' +
      '<div style="color:var(--text-muted);font-weight:600">SKUs</div><div style="color:var(--text-primary);font-weight:700">' +
      rowsCount.toLocaleString('es-AR') +
      '</div>' +
      '<div style="color:var(--text-muted);font-weight:600">Meses</div><div style="color:var(--text-primary);font-weight:700">' +
      monthsCount +
      ' <span style="color:var(--text-muted);font-weight:400">(' +
      escapeHtmlSafe(monthsRange) +
      ')</span></div>' +
      '</div>'
    : '<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border-radius:6px;border:1px dashed var(--border-subtle)">Aun no subiste el Sales Plan de esta familia.</div>';
  const uploadBtn =
    '<label style="display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;background:' +
    f.color +
    ';color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;letter-spacing:.4px">' +
    '<span>' +
    (hasCache ? '↻ Reemplazar Excel' : '⬆ Cargar Excel') +
    '</span>' +
    '<input type="file" accept=".xlsx,.xls" data-familia="' +
    f.key +
    '" style="display:none" onchange="onSalesPlanFileForFamilia(event, \'' +
    f.key +
    '\')"/>' +
    '</label>';
  const cardHead =
    '<div style="display:flex;align-items:center;gap:10px">' +
    '<div style="width:12px;height:32px;background:' +
    f.color +
    ';border-radius:3px"></div>' +
    '<div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--text-primary)">' +
    escapeHtmlSafe(f.label) +
    '</div>' +
    '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Sales Plan mensual · Hoja SAR</div></div>' +
    badge +
    '</div>';
  return (
    '<div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px">' +
    cardHead +
    metaBlock +
    uploadBtn +
    '<div id="sales-plan-status-' +
    f.key +
    '" style="font-size:11px;color:var(--text-muted);min-height:14px"></div>' +
    '</div>'
  );
}

function _renderSalesPlansTab() {
  const cont = document.getElementById('forecast-tab-sales-plans');
  if (!cont) return;
  const slots = SALES_PLAN_FAMILIAS.map(_buildSalesPlanSlotHtml).join('');
  const intro =
    '<div style="margin-bottom:16px;padding:12px 14px;background:var(--bg-secondary);border-left:3px solid #0d9488;border-radius:6px;font-size:12px;color:var(--text-secondary);line-height:1.5">' +
    '<b style="color:var(--text-primary)">Fase 1</b> — Cargá los Sales Plans mensuales (Rods / Reels). Se parsea la hoja <b>SAR</b>: SKU, MOQ 12 months, y una columna por mes. ' +
    'El Excel original queda snapshotado en Storage y el parseo queda en Firestore para el cálculo debajo.' +
    '</div>';
  const grid =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:24px">' +
    slots +
    '</div>';
  // v1109: contenedor para tabla Recomendación de Compra. Se rellena on-demand
  // via _renderRecoSection() (lazy load de stock_snapshot + sku_ventas_snapshot).
  const recoSection = '<div id="reco-section-container"></div>';
  cont.innerHTML = '<div style="padding:18px">' + intro + grid + recoSection + '</div>';
  _renderRecoSection();
}

window.onSalesPlanFileForFamilia = async function (event, familia) {
  const file = event && event.target && event.target.files && event.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('sales-plan-status-' + familia);
  const setStatus = (msg, color) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = color || 'var(--text-muted)';
  };
  try {
    if (typeof XLSX === 'undefined') {
      alert('SheetJS (XLSX) no cargado — recargá la app.');
      return;
    }
    if (!window.SalesPlanParser || !window.SalesPlanParser.parseSalesPlanSheet) {
      alert('Parser Sales Plan no cargado. Rebuild bundle.');
      return;
    }
    if (!window.firebase || !window.firebase.storage) {
      alert('Firebase Storage no disponible.');
      return;
    }
    setStatus('Leyendo Excel…');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sarName = wb.SheetNames.find(
      (n) =>
        String(n || '')
          .trim()
          .toUpperCase() === 'SAR'
    );
    if (!sarName) {
      setStatus(
        '⚠ El Excel no tiene hoja "SAR". Hojas encontradas: ' + wb.SheetNames.join(', '),
        '#dc2626'
      );
      return;
    }
    const sheet = wb.Sheets[sarName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    setStatus('Parseando ' + rows.length + ' filas de hoja "' + sarName + '"…');
    const parsed = window.SalesPlanParser.parseSalesPlanSheet(rows);
    if (!parsed.rows.length) {
      setStatus('⚠ Excel parseado pero sin SKUs válidos.', '#dc2626');
      return;
    }
    const yearMonth = _yearMonthNow();
    const storagePath = 'forecasts_snapshots/' + yearMonth + '/' + familia + '.xlsx';
    setStatus('Subiendo Excel a Storage (' + _fmtSize(file.size) + ')…');
    const storageRef = window.firebase.storage().ref(storagePath);
    await storageRef.put(file, {
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      customMetadata: {
        familia,
        uploadedBy: (window.currentUser && window.currentUser.email) || '',
        sourceFilename: file.name || '',
      },
    });
    setStatus('Guardando parseo en Firestore (' + parsed.rows.length + ' SKUs)…');
    const uploadedBy = (window.currentUser && window.currentUser.email) || 'unknown';
    const payload = {
      familia,
      parsedAt:
        window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : new Date().toISOString(),
      uploadedBy,
      sourceFilename: file.name || '',
      sourceSheet: sarName,
      yearMonth,
      storagePath,
      rowsCount: parsed.rows.length,
      headerRowIndex: parsed.headerRowIndex,
      detectedMonths: parsed.detectedMonths,
      rows: parsed.rows,
    };
    await window.fbDb.collection('sales_plan_cache').doc(familia).set(payload);
    // v1107 fix: guardar cache local con Date real (no el SentinelValue) para
    // que _fmtDateShort no muestre "Invalid Date". El server tiene el ts exacto,
    // el local muestra el momento del upload (aproximado ~1s de diferencia).
    _salesPlanCaches[familia] = Object.assign({}, payload, { parsedAt: new Date() });
    setStatus(
      '✓ OK. ' + parsed.rows.length + ' SKUs × ' + parsed.detectedMonths.length + ' meses.',
      '#16a34a'
    );
    _renderSalesPlansTab();
  } catch (e) {
    console.error('[FORECAST] upload sales plan ' + familia + ' fail:', e);
    setStatus('✗ Error: ' + ((e && e.message) || e), '#dc2626');
    if (e && e.code === 'MONTHS_NOT_FOUND') {
      alert(
        'El Excel no tiene columnas de meses reconocibles.\n\nHeaders esperados: "Jan 2027", "May 2027", "Ene 2027", "2027-01", etc.\n\nDetalle: ' +
          e.message
      );
    }
  } finally {
    if (event && event.target) event.target.value = '';
  }
};

// ---------------------------------------------------------------------------
// F2B — Forecast Estadístico: tabla + detalle
// ---------------------------------------------------------------------------

async function _loadForecastOutput() {
  if (!window.fbDb) throw new Error('Firestore no inicializado');
  console.log('[FORECAST stat] loading forecast_output...');
  const [snap, metaDoc] = await Promise.all([
    window.fbDb.collection('forecast_output').get(),
    window.fbDb.collection('forecast_output_meta').doc('current').get(),
  ]);
  const docs = [];
  snap.forEach((d) => docs.push(Object.assign({ id: d.id }, d.data())));
  docs.sort((a, b) => {
    const wa = (a.metrics && a.metrics.wape) || 999;
    const wb = (b.metrics && b.metrics.wape) || 999;
    return wa - wb;
  });
  _forecastStatDocs = docs;
  _forecastStatMeta = metaDoc.exists ? metaDoc.data() : null;
  console.log('[FORECAST stat] loaded', docs.length, 'docs · meta:', !!_forecastStatMeta);
  return docs;
}

function _wapeBadgeColor(w) {
  if (w == null) return '#64748b';
  if (w < 0.3) return '#16a34a'; // verde - excelente
  if (w < 0.5) return '#84cc16'; // lima - bueno
  if (w < 0.7) return '#eab308'; // amarillo - aceptable
  if (w < 1.0) return '#f97316'; // naranja - pobre
  return '#dc2626'; // rojo - muy pobre
}

function _fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function _fmtWape(w) {
  if (w == null || !Number.isFinite(Number(w))) return '—';
  return (Number(w) * 100).toFixed(0) + '%';
}

function _fmtDsShort(iso) {
  // '2026-10-01' -> 'oct 26'
  try {
    const [y, m] = iso.split('-').map(Number);
    const names = [
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
    return names[m - 1] + ' ' + String(y).slice(-2);
  } catch {
    return iso;
  }
}

function _renderForecastStatTab() {
  const cont = document.getElementById('forecast-tab-stat');
  if (!cont) return;
  try {
    _renderForecastStatTabImpl(cont);
  } catch (e) {
    console.error('[FORECAST stat] render fail', e);
    cont.innerHTML =
      '<div style="padding:40px 20px;color:#dc2626;line-height:1.6">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:10px">Error renderizando tab Forecast Estadístico</div>' +
      '<pre style="font-size:11px;background:#fef2f2;padding:12px;border-radius:6px;overflow:auto;white-space:pre-wrap">' +
      escapeHtmlSafe(e.stack || e.message || String(e)) +
      '</pre></div>';
  }
}

function _renderForecastStatTabImpl(cont) {
  const docs = _forecastStatDocs || [];
  const meta = _forecastStatMeta || {};
  const resumen = meta.resumen || {};
  console.log('[FORECAST stat] render — docs:', docs.length, 'meta:', !!meta.generatedAt);
  if (!docs.length) {
    cont.innerHTML =
      '<div style="padding:60px 20px;text-align:center;color:var(--text-muted)">' +
      'No hay forecast_output publicado.<br><br>' +
      'Correr <code>python scripts/forecast/train_prod.py && python scripts/forecast/publish_to_firestore.py</code>.' +
      '</div>';
    return;
  }
  // Meses del forecast (ds del primer doc, se asume igual en todos).
  const monthsIso = (docs[0].forecast || []).map((f) => f.ds);
  const monthHeaders = monthsIso.map(_fmtDsShort);

  // Metrics chip global
  const generated = meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleString('es-AR', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  const wapeMed =
    resumen.wape_mediano_best_per_series != null
      ? _fmtWape(resumen.wape_mediano_best_per_series)
      : '—';
  const nSubs = resumen.n_subfamilias || docs.length;
  const nLt05 =
    resumen.n_series_wape_lt_0_5 != null ? resumen.n_series_wape_lt_0_5 + '/' + nSubs : '—';
  const nLt03 =
    resumen.n_series_wape_lt_0_3 != null ? resumen.n_series_wape_lt_0_3 + '/' + nSubs : '—';

  const banner =
    '<div style="margin-bottom:14px;padding:12px 14px;background:var(--bg-secondary);border-left:3px solid #0d9488;border-radius:6px;font-size:12px;color:var(--text-secondary);line-height:1.5;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">' +
    '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">WAPE mediano</div><div style="font-size:20px;font-weight:800;color:var(--text-primary)">' +
    wapeMed +
    '</div></div>' +
    '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Subfamilias</div><div style="font-size:20px;font-weight:800;color:var(--text-primary)">' +
    nSubs +
    '</div></div>' +
    '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">WAPE &lt; 30% (excelente)</div><div style="font-size:20px;font-weight:800;color:#16a34a">' +
    nLt03 +
    '</div></div>' +
    '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">WAPE &lt; 50% (bueno)</div><div style="font-size:20px;font-weight:800;color:#84cc16">' +
    nLt05 +
    '</div></div>' +
    '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Última corrida</div><div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-top:4px">' +
    escapeHtmlSafe(generated) +
    '</div></div>' +
    '</div>';

  // Tabla rows
  const rowsHtml = docs
    .map((d) => {
      const wape = d.metrics && d.metrics.wape != null ? d.metrics.wape : null;
      const bestModel = d.bestModel || '—';
      const forecastMap = {};
      (d.forecast || []).forEach((f) => {
        forecastMap[f.ds] = f.y_hat;
      });
      const monthCells = monthsIso
        .map(
          (ds) =>
            '<td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-primary)">' +
            _fmtNum(forecastMap[ds]) +
            '</td>'
        )
        .join('');
      const total7 = (d.forecast || []).reduce((s, f) => s + (Number(f.y_hat) || 0), 0);
      return (
        '<tr onclick="openForecastStatDetail(\'' +
        escapeHtmlSafe(d.id) +
        '\')" style="cursor:pointer;border-bottom:1px solid var(--border-subtle)" onmouseover="this.style.background=\'var(--bg-secondary)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<td style="padding:8px 10px;font-weight:700;color:var(--text-primary)">' +
        escapeHtmlSafe(d.subfamilia || d.id) +
        '</td>' +
        '<td style="padding:8px 10px;font-size:11px;color:var(--text-secondary)">' +
        escapeHtmlSafe(bestModel) +
        '</td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="display:inline-block;padding:3px 8px;border-radius:12px;background:' +
        _wapeBadgeColor(wape) +
        ';color:#fff;font-size:11px;font-weight:700">' +
        _fmtWape(wape) +
        '</span></td>' +
        monthCells +
        '<td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#0d9488;background:var(--bg-secondary)">' +
        _fmtNum(total7) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  const monthHeadersHtml = monthHeaders
    .map(
      (m) =>
        '<th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#94a3b8">' +
        escapeHtmlSafe(m) +
        '</th>'
    )
    .join('');

  const table =
    '<div style="overflow:auto;border:1px solid var(--border-subtle);border-radius:8px">' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead style="background:#0f172a;color:#fff"><tr>' +
    '<th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px">Subfamilia</th>' +
    '<th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px">Modelo</th>' +
    '<th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.4px">WAPE</th>' +
    monthHeadersHtml +
    '<th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.4px;background:#134e4a">Total 7m</th>' +
    '</tr></thead>' +
    '<tbody>' +
    rowsHtml +
    '</tbody></table></div>';

  const footer =
    '<div style="margin-top:12px;font-size:11px;color:var(--text-muted);line-height:1.5">' +
    '<b>Cómo leer</b>: WAPE (Weighted Absolute Percentage Error) mide el error del modelo relativo al total real: &lt;30% excelente, 30-50% bueno, 50-70% aceptable, &gt;70% pobre. Click en fila para detalle + gráfico. ' +
    'Se elige el modelo con menor WAPE por serie tras backtest rolling-origin (h=2, ventanas=3).' +
    '</div>';

  cont.innerHTML = '<div style="padding:18px">' + banner + table + footer + '</div>';
}

// Cache historia agregada por subfamilia (para gráfico detalle).
async function _loadForecastStatHistory() {
  if (_forecastStatHistoryCache) return _forecastStatHistoryCache;
  // La historia solo está en BQ (~10 años Baraldo + 12 meses Shimano). Como
  // el pipeline la escribe a CSV local, acá no la podemos leer. Alternativa:
  // usar sku_ventas_snapshot que tiene ventas mensuales pero solo grupo PESCA.
  // En F2B.2 solo mostramos forecast+IC (sin overlay historia por ahora).
  _forecastStatHistoryCache = {};
  return _forecastStatHistoryCache;
}

function _buildForecastChartSvg(doc) {
  const fc = doc.forecast || [];
  if (!fc.length)
    return '<div style="padding:30px;text-align:center;color:var(--text-muted)">Sin datos de forecast</div>';
  // Dimensiones
  const W = 640,
    H = 260;
  const padL = 50,
    padR = 20,
    padT = 20,
    padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // Y range: max(hi80) * 1.1
  const maxY = Math.max(1, ...fc.map((f) => Number(f.hi80) || Number(f.y_hat) || 0));
  const minY = 0;
  const scaleX = (i) => padL + (innerW * i) / Math.max(1, fc.length - 1);
  const scaleY = (v) => padT + innerH - (innerH * (v - minY)) / (maxY - minY);

  // Grid + eje Y
  const yTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((r) => {
      const val = minY + r * (maxY - minY);
      const yy = scaleY(val);
      return (
        '<line x1="' +
        padL +
        '" y1="' +
        yy +
        '" x2="' +
        (W - padR) +
        '" y2="' +
        yy +
        '" stroke="#e2e8f0" stroke-width="1"/>' +
        '<text x="' +
        (padL - 6) +
        '" y="' +
        (yy + 4) +
        '" text-anchor="end" font-size="10" fill="#64748b">' +
        _fmtNum(val) +
        '</text>'
      );
    })
    .join('');

  // Eje X (meses)
  const xLabels = fc
    .map((f, i) => {
      const xx = scaleX(i);
      return (
        '<text x="' +
        xx +
        '" y="' +
        (H - padB + 15) +
        '" text-anchor="middle" font-size="10" fill="#64748b">' +
        _fmtDsShort(f.ds) +
        '</text>'
      );
    })
    .join('');

  // Intervalo confianza (band)
  const bandPoints =
    fc.map((f, i) => scaleX(i) + ',' + scaleY(Number(f.hi80) || 0)).join(' ') +
    ' ' +
    fc
      .slice()
      .reverse()
      .map((f, i) => scaleX(fc.length - 1 - i) + ',' + scaleY(Number(f.lo80) || 0))
      .join(' ');
  const band = '<polygon points="' + bandPoints + '" fill="#0d948833" stroke="none"/>';

  // Line forecast + puntos
  const linePoints = fc.map((f, i) => scaleX(i) + ',' + scaleY(Number(f.y_hat) || 0)).join(' ');
  const line =
    '<polyline points="' +
    linePoints +
    '" fill="none" stroke="#0d9488" stroke-width="2.5" stroke-linejoin="round"/>';
  const points = fc
    .map(
      (f, i) =>
        '<circle cx="' +
        scaleX(i) +
        '" cy="' +
        scaleY(Number(f.y_hat) || 0) +
        '" r="4" fill="#0d9488" stroke="#fff" stroke-width="2"/>'
    )
    .join('');
  // Labels de valor
  const valueLabels = fc
    .map((f, i) => {
      const xx = scaleX(i);
      const yy = scaleY(Number(f.y_hat) || 0);
      return (
        '<text x="' +
        xx +
        '" y="' +
        (yy - 8) +
        '" text-anchor="middle" font-size="10" font-weight="700" fill="#0f766e">' +
        _fmtNum(f.y_hat) +
        '</text>'
      );
    })
    .join('');

  const svg =
    '<svg viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" style="width:100%;max-width:800px;height:auto">' +
    '<rect x="0" y="0" width="' +
    W +
    '" height="' +
    H +
    '" fill="#fff"/>' +
    yTicks +
    xLabels +
    band +
    line +
    points +
    valueLabels +
    '</svg>';
  return svg;
}

window.openForecastStatDetail = function (subId) {
  if (!_forecastStatDocs) return;
  const doc = _forecastStatDocs.find((d) => d.id === subId);
  if (!doc) {
    alert('No se encontró detalle de ' + subId);
    return;
  }
  const existing = document.getElementById('forecast-stat-detail');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'forecast-stat-detail';
  el.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:2100;display:flex;align-items:center;justify-content:center;padding:2vh';
  el.onclick = (ev) => {
    if (ev.target === el) el.remove();
  };

  const wape = doc.metrics && doc.metrics.wape;
  const bias = doc.metrics && doc.metrics.bias;
  const mae = doc.metrics && doc.metrics.mae;
  const rmse = doc.metrics && doc.metrics.rmse;
  const bestModel = doc.bestModel || '—';
  const versionId = doc.versionId || '—';
  const svgHtml = _buildForecastChartSvg(doc);

  const metricsHtml =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:14px 0">' +
    '<div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Modelo</div><div style="font-weight:700">' +
    escapeHtmlSafe(bestModel) +
    '</div></div>' +
    '<div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">WAPE</div><div style="font-weight:700;color:' +
    _wapeBadgeColor(wape) +
    '">' +
    _fmtWape(wape) +
    '</div></div>' +
    '<div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Bias</div><div style="font-weight:700">' +
    (bias != null ? (bias * 100).toFixed(0) + '%' : '—') +
    '</div></div>' +
    '<div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">MAE</div><div style="font-weight:700">' +
    _fmtNum(mae) +
    '</div></div>' +
    '<div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">RMSE</div><div style="font-weight:700">' +
    _fmtNum(rmse) +
    '</div></div>' +
    '</div>';

  const tableHtml =
    '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:10px">' +
    '<thead style="background:#0f172a;color:#fff"><tr>' +
    '<th style="padding:6px 10px;text-align:left">Mes</th>' +
    '<th style="padding:6px 10px;text-align:right">Forecast</th>' +
    '<th style="padding:6px 10px;text-align:right">IC 80% bajo</th>' +
    '<th style="padding:6px 10px;text-align:right">IC 80% alto</th>' +
    '</tr></thead><tbody>' +
    (doc.forecast || [])
      .map(
        (f) =>
          '<tr style="border-bottom:1px solid var(--border-subtle)"><td style="padding:6px 10px">' +
          escapeHtmlSafe(_fmtDsShort(f.ds)) +
          '</td>' +
          '<td style="padding:6px 10px;text-align:right;font-weight:700">' +
          _fmtNum(f.y_hat) +
          '</td>' +
          '<td style="padding:6px 10px;text-align:right;color:var(--text-muted)">' +
          _fmtNum(f.lo80) +
          '</td>' +
          '<td style="padding:6px 10px;text-align:right;color:var(--text-muted)">' +
          _fmtNum(f.hi80) +
          '</td></tr>'
      )
      .join('') +
    '</tbody></table>';

  const content =
    '<div style="background:var(--bg-elevated);border-radius:12px;padding:24px;max-width:820px;width:100%;max-height:96vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
    '<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Subfamilia</div><div style="font-size:22px;font-weight:800">' +
    escapeHtmlSafe(doc.subfamilia || doc.id) +
    '</div></div>' +
    '<button onclick="document.getElementById(\'forecast-stat-detail\').remove()" style="background:transparent;border:1px solid var(--border-subtle);border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700">Cerrar</button>' +
    '</div>' +
    metricsHtml +
    '<div style="background:#fff;padding:8px;border-radius:8px;margin-top:10px;border:1px solid var(--border-subtle)">' +
    svgHtml +
    '</div>' +
    tableHtml +
    '<div style="margin-top:14px;font-size:11px;color:var(--text-muted)">Version: <code>' +
    escapeHtmlSafe(versionId) +
    '</code> · Approach: ' +
    escapeHtmlSafe((doc.config || {}).approach || '—') +
    '</div>' +
    '</div>';
  el.innerHTML = content;
  document.body.appendChild(el);
};

window.openForecastModal = async function () {
  if (!_canForecast()) {
    alert('FORECAST es solo para Mariano (admin).');
    return;
  }
  const el = _renderModalShell();
  el.style.display = 'block';
  // Fase 1: cargar Sales Plans caches + renderizar tab default.
  _renderSalesPlansTab();
  _loadSalesPlanCaches()
    .then(_renderSalesPlansTab)
    .catch(() => {});
};

window.closeForecastModal = function () {
  const el = document.getElementById('forecast-modal');
  if (el) el.style.display = 'none';
};

// ---------------------------------------------------------------------------
// F3A — Tabla Recomendación de Compra (tab Sales Plans)
// ---------------------------------------------------------------------------

async function _loadMultiplierOverrides() {
  if (!window.fbDb) return;
  try {
    const doc = await window.fbDb.collection('forecast_config').doc('multipliers').get();
    if (doc.exists) {
      const d = doc.data() || {};
      _multiplierOverrides = d.skuOverrides || {};
    } else {
      _multiplierOverrides = {};
    }
  } catch (e) {
    console.warn('[FORECAST reco] load multipliers fail:', e && e.message);
    _multiplierOverrides = {};
  }
}

async function _saveMultiplierOverride(skuUpper, value) {
  if (!window.fbDb) return;
  if (!_multiplierOverrides) _multiplierOverrides = {};
  const uid = (window.currentUser && window.currentUser.email) || 'unknown';
  _multiplierOverrides[skuUpper] = {
    value: Number(value),
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  };
  await window.fbDb.collection('forecast_config').doc('multipliers').set({
    skuOverrides: _multiplierOverrides,
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  });
}

async function _removeMultiplierOverride(skuUpper) {
  if (!window.fbDb || !_multiplierOverrides) return;
  delete _multiplierOverrides[skuUpper];
  const uid = (window.currentUser && window.currentUser.email) || 'unknown';
  await window.fbDb.collection('forecast_config').doc('multipliers').set({
    skuOverrides: _multiplierOverrides,
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  });
}

// Auto multiplier: recent/baseline con cap. Retorna {value, source: 'auto'|'fallback'|'default', recent, baseline}.
function _computeMultiplierAuto(skuUpper) {
  const rec = _recoVentasSnapshot && _recoVentasSnapshot[skuUpper];
  if (!rec || !rec.meses) return { value: 1.0, source: 'default', recent: 0, baseline: 0 };
  const hoy = new Date();
  const monthsBackKey = (n) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - n, 1);
    return String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };
  const collectAvg = (n) => {
    let sum = 0;
    let count = 0;
    for (let i = 1; i <= n; i++) {
      const k = monthsBackKey(i);
      const m = rec.meses[k];
      if (m && Number.isFinite(Number(m.qty))) {
        sum += Number(m.qty);
        count++;
      }
    }
    return count > 0 ? { avg: sum / count, n: count } : { avg: 0, n: 0 };
  };
  const rec2 = collectAvg(RECO_MULT_RECENT_MONTHS);
  const bas6 = collectAvg(RECO_MULT_BASELINE_MONTHS);
  // Necesitamos al menos 1 mes reciente + 3 meses baseline para calcular auto.
  if (rec2.n === 0 || bas6.n < 3 || bas6.avg < RECO_MULT_MIN_BASELINE) {
    return { value: 1.0, source: 'default', recent: rec2.avg, baseline: bas6.avg };
  }
  let ratio = rec2.avg / bas6.avg;
  if (ratio < RECO_MULT_MIN) ratio = RECO_MULT_MIN;
  if (ratio > RECO_MULT_MAX) ratio = RECO_MULT_MAX;
  return {
    value: Math.round(ratio * 100) / 100,
    source: 'auto',
    recent: Math.round(rec2.avg * 10) / 10,
    baseline: Math.round(bas6.avg * 10) / 10,
  };
}

function _getEffectiveMultiplier(skuUpper) {
  // Override manual gana
  if (_multiplierOverrides && _multiplierOverrides[skuUpper]) {
    return {
      value: Number(_multiplierOverrides[skuUpper].value) || 1.0,
      source: 'manual',
      auto: _computeMultiplierAuto(skuUpper),
    };
  }
  const auto = _computeMultiplierAuto(skuUpper);
  return { value: auto.value, source: auto.source, auto };
}

async function _loadDiscontinuedSkus() {
  if (!window.fbDb) return;
  try {
    const doc = await window.fbDb.collection('forecast_config').doc('discontinued_skus').get();
    if (doc.exists) {
      const d = doc.data() || {};
      const arr = Array.isArray(d.skus) ? d.skus : [];
      _discontinuedSkus = new Set(arr.map((s) => String(s).trim().toUpperCase()));
      _discontinuedMeta = { updatedAt: d.updatedAt, updatedBy: d.updatedBy };
    } else {
      _discontinuedSkus = new Set();
      _discontinuedMeta = null;
    }
  } catch (e) {
    console.warn('[FORECAST reco] load discontinued fail:', e && e.message);
    _discontinuedSkus = new Set();
  }
}

async function _saveDiscontinuedSkus() {
  if (!window.fbDb || !_discontinuedSkus) return;
  const uid = (window.currentUser && window.currentUser.email) || 'unknown';
  const payload = {
    skus: Array.from(_discontinuedSkus).sort(),
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  };
  await window.fbDb.collection('forecast_config').doc('discontinued_skus').set(payload);
  _discontinuedMeta = { updatedAt: payload.updatedAt, updatedBy: payload.updatedBy };
}

async function _loadRecoData() {
  if (!window.fbDb) throw new Error('Firestore no inicializado');
  const promises = [];
  if (!_discontinuedSkus) promises.push(_loadDiscontinuedSkus());
  if (!_multiplierOverrides) promises.push(_loadMultiplierOverrides());
  if (!_recoStockSnapshot) {
    promises.push(
      window.fbDb
        .collection('app_config')
        .doc('stock_snapshot')
        .get()
        .then((d) => {
          const data = d.exists ? d.data() : {};
          let wh = {};
          let bo = {};
          try {
            wh = data.warehouseBreakdown ? JSON.parse(data.warehouseBreakdown) : {};
          } catch {
            wh = {};
          }
          try {
            bo = data.backorderBySku ? JSON.parse(data.backorderBySku) : {};
          } catch {
            bo = {};
          }
          _recoStockSnapshot = { warehouseBreakdown: wh, backorderBySku: bo };
        })
    );
  }
  if (!_recoVentasSnapshot) {
    promises.push(
      window.fbDb
        .collection('sku_ventas_snapshot')
        .get()
        .then((snap) => {
          const map = {};
          snap.forEach((doc) => {
            const d = doc.data();
            if (!d || !d.sku) return;
            map[String(d.sku).trim().toUpperCase()] = { meses: d.meses || {} };
          });
          _recoVentasSnapshot = map;
        })
    );
  }
  await Promise.all(promises);
}

function _computeVentaMensualPromedio(skuUpper) {
  // Promedio de los últimos RECO_VENTA_PROMEDIO_WINDOW meses cerrados
  // (excluye el mes actual parcial).
  const rec = _recoVentasSnapshot && _recoVentasSnapshot[skuUpper];
  if (!rec || !rec.meses) return 0;
  const hoy = new Date();
  const monthsBack = [];
  for (let i = 1; i <= RECO_VENTA_PROMEDIO_WINDOW; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    monthsBack.push(String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  let sum = 0;
  let n = 0;
  monthsBack.forEach((k) => {
    const m = rec.meses[k];
    if (m && Number.isFinite(Number(m.qty))) {
      sum += Number(m.qty);
      n++;
    }
  });
  return n > 0 ? sum / n : 0;
}

function _computeSalesPlanFuturo(row) {
  // Suma los meses de row.months desde el mes actual (inclusive) hasta el
  // último mes del sales plan. Los meses son 'YYYY-MM'.
  if (!row || !row.months) return 0;
  const hoy = new Date();
  const currentKey = String(hoy.getFullYear()) + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
  let sum = 0;
  Object.keys(row.months).forEach((k) => {
    if (k >= currentKey) sum += Number(row.months[k] || 0);
  });
  return sum;
}

function _computeRecommendations() {
  // Combina Rods + Reels sales plans + stock + backorder + ventas promedio.
  // Retorna array de rows con todos los campos + recomendado.
  const rows = [];
  const familias = ['rods', 'reels'];
  for (const fam of familias) {
    const cache = _salesPlanCaches[fam];
    if (!cache || !cache.rows) continue;
    for (const spRow of cache.rows) {
      const sku = String(spRow.sku || '').trim();
      const skuUpper = sku.toUpperCase();
      // v1112: skipeamos SKUs descontinuados (Mariano los marca desde la UI).
      if (_discontinuedSkus && _discontinuedSkus.has(skuUpper)) continue;
      const stockWh =
        (_recoStockSnapshot &&
          _recoStockSnapshot.warehouseBreakdown &&
          _recoStockSnapshot.warehouseBreakdown[sku]) ||
        {};
      const stockLibre = Number(stockWh['11'] || 0);
      const enTransito = Number(stockWh['12'] || 0);
      const backorder = Number(
        (_recoStockSnapshot &&
          _recoStockSnapshot.backorderBySku &&
          _recoStockSnapshot.backorderBySku[sku]) ||
          0
      );
      const ventaMensual = _computeVentaMensualPromedio(skuUpper);
      const salesPlanFut = _computeSalesPlanFuturo(spRow);
      const moq = Number(spRow.moq || 0);
      // v1114 F3B: multiplicador auto (recent/baseline) o override manual.
      const multInfo = _getEffectiveMultiplier(skuUpper);
      const multiplier = multInfo.value;
      const demandaEsperada = ventaMensual * multiplier * RECO_HORIZON_MONTHS;
      const balance = stockLibre + enTransito + salesPlanFut - backorder - demandaEsperada;
      let recomendado = 0;
      if (balance < 0) {
        const deficit = -balance;
        recomendado = moq > 0 ? Math.max(moq, Math.ceil(deficit / moq) * moq) : Math.ceil(deficit);
      }
      rows.push({
        familia: fam,
        sku,
        description: spRow.description || '',
        moq,
        stockLibre,
        enTransito,
        backorder,
        ventaMensual: Math.round(ventaMensual * 10) / 10,
        salesPlanFut,
        multiplier,
        multSource: multInfo.source, // 'auto' | 'manual' | 'default' | 'fallback'
        multAuto: multInfo.auto ? multInfo.auto.value : null, // el valor auto si hay override manual
        demandaEsperada: Math.round(demandaEsperada * 10) / 10,
        balance: Math.round(balance * 10) / 10,
        recomendado,
      });
    }
  }
  // Ordenar por recomendado descendente
  rows.sort((a, b) => b.recomendado - a.recomendado);
  return rows;
}

function _fmtNumSigned(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  return (v < 0 ? '−' : '') + abs;
}

function _fmtInt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Math.round(Number(n)).toLocaleString('es-AR');
}

// v1114 F3B: celda multiplicador con chip auto/manual + input editable.
function _buildMultCellHtml(r) {
  const skuUpper = String(r.sku).trim().toUpperCase();
  const isManual = r.multSource === 'manual';
  const isDefault = r.multSource === 'default';
  const val = Number(r.multiplier || 1.0).toFixed(2);
  // Color por dirección: >1.05 verde (creciendo), <0.95 rojo (cayendo), medio gris.
  let dirColor = 'var(--text-muted)';
  if (r.multiplier > 1.05) dirColor = '#16a34a';
  else if (r.multiplier < 0.95) dirColor = '#dc2626';

  const chip = isManual
    ? '<span style="display:inline-block;padding:1px 5px;background:#f59e0b;color:#fff;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px" title="Override manual: pisa el auto">M</span>'
    : isDefault
      ? '<span style="display:inline-block;padding:1px 5px;background:#94a3b8;color:#fff;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px" title="Sin datos suficientes: usa 1.0">·</span>'
      : '<span style="display:inline-block;padding:1px 5px;background:#0d9488;color:#fff;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px" title="Auto = venta 2m / venta 6m">A</span>';

  const resetBtn = isManual
    ? '<button onclick="resetMultiplier(\'' +
      escapeHtmlSafe(skuUpper) +
      '\')" title="Volver al auto" style="margin-left:4px;background:transparent;border:none;cursor:pointer;font-size:12px;color:var(--text-muted);padding:0">↻</button>'
    : '';

  const autoHint =
    isManual && r.multAuto != null
      ? ' <span style="font-size:10px;color:var(--text-muted)" title="Valor auto calculado">(auto ' +
        Number(r.multAuto).toFixed(2) +
        ')</span>'
      : '';

  return (
    '<span style="display:inline-flex;align-items:center;gap:2px">' +
    '<span onclick="editMultiplier(this, \'' +
    escapeHtmlSafe(skuUpper) +
    '\')" style="cursor:pointer;padding:2px 6px;border-radius:4px;background:var(--bg-secondary);font-variant-numeric:tabular-nums;font-weight:700;color:' +
    dirColor +
    '" title="Click para editar">' +
    val +
    '</span>' +
    chip +
    resetBtn +
    autoHint +
    '</span>'
  );
}

window.editMultiplier = function (el, skuUpper) {
  const currentVal = parseFloat(el.textContent) || 1.0;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.05';
  input.min = '0.1';
  input.max = '5';
  input.value = String(currentVal);
  input.style.cssText =
    'width:60px;padding:2px 4px;font-size:12px;font-weight:700;text-align:center;border:2px solid #0d9488;border-radius:4px;background:var(--bg-elevated);color:var(--text-primary);font-variant-numeric:tabular-nums';
  const parent = el.parentNode;
  parent.replaceChild(input, el);
  input.focus();
  input.select();

  const commit = async () => {
    const v = parseFloat(input.value);
    if (Number.isNaN(v) || v < 0.1 || v > 5) {
      _renderRecoSection();
      return;
    }
    if (Math.abs(v - currentVal) < 0.001) {
      _renderRecoSection();
      return;
    }
    try {
      await _saveMultiplierOverride(skuUpper, v);
      _renderRecoSection();
    } catch (e) {
      alert('Error guardando: ' + (e.message || e));
      _renderRecoSection();
    }
  };

  const cancel = () => _renderRecoSection();

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.blur();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    }
  });
};

window.resetMultiplier = async function (skuUpper) {
  if (!confirm('Volver el multiplicador de ' + skuUpper + ' al cálculo automático?')) return;
  try {
    await _removeMultiplierOverride(skuUpper);
    _renderRecoSection();
  } catch (e) {
    alert('Error: ' + (e.message || e));
  }
};

function _renderRecoSection() {
  const cont = document.getElementById('reco-section-container');
  if (!cont) return;
  try {
    _renderRecoSectionImpl(cont);
  } catch (e) {
    console.error('[FORECAST reco] render fail', e);
    cont.innerHTML =
      '<div style="padding:20px;color:#dc2626">' +
      '<div style="font-weight:700;margin-bottom:8px">Error renderizando tabla recomendación</div>' +
      '<pre style="font-size:11px;background:#fef2f2;padding:10px;border-radius:6px;overflow:auto;white-space:pre-wrap">' +
      escapeHtmlSafe(e.stack || e.message || String(e)) +
      '</pre></div>';
  }
}

function _renderRecoSectionImpl(cont) {
  const anyLoaded = !!(_salesPlanCaches.rods || _salesPlanCaches.reels);
  if (!anyLoaded) {
    cont.innerHTML = '';
    return;
  }
  if (!_recoStockSnapshot || !_recoVentasSnapshot) {
    cont.innerHTML =
      '<div style="padding:40px 18px;text-align:center;color:var(--text-muted)">' +
      '<div style="display:inline-block;width:24px;height:24px;border:3px solid #0d9488;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:10px"></div>' +
      '<div>Cargando stock + ventas históricas...</div>' +
      '<style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>';
    _loadRecoData()
      .then(_renderRecoSection)
      .catch((e) => {
        console.error('[FORECAST reco] load fail', e);
        cont.innerHTML =
          '<div style="padding:20px;color:#dc2626">Error cargando datos: ' +
          escapeHtmlSafe(e.message || String(e)) +
          '</div>';
      });
    return;
  }
  const allRows = _computeRecommendations();
  const searchLc = _recoSearchText.trim().toLowerCase();
  const rows = allRows.filter((r) => {
    if (_recoFilterFamilia !== 'all' && r.familia !== _recoFilterFamilia) return false;
    if (_recoFilterMinRec && r.recomendado <= 0) return false;
    if (searchLc) {
      const hay =
        r.sku.toLowerCase().includes(searchLc) || r.description.toLowerCase().includes(searchLc);
      if (!hay) return false;
    }
    return true;
  });
  const totalReco = allRows.reduce((s, r) => s + r.recomendado, 0);
  const totalConReco = allRows.filter((r) => r.recomendado > 0).length;

  const nDisc = _discontinuedSkus ? _discontinuedSkus.size : 0;
  const discChip =
    nDisc > 0
      ? '<button onclick="openDiscontinuedModal()" style="padding:6px 12px;background:#9333ea;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer" title="Gestionar SKUs descontinuados">🚫 ' +
        _fmtInt(nDisc) +
        ' descontinuados</button>'
      : '';

  const header =
    '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px">' +
    '<div style="flex:1;min-width:280px"><div style="font-size:18px;font-weight:800;color:var(--text-primary)">Recomendación de Compra</div>' +
    '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Balance = Stock + Tránsito + Plan − Backorder − (Venta mens. × ' +
    RECO_HORIZON_MONTHS +
    'm)</div></div>' +
    '<div style="padding:6px 12px;background:#0d9488;color:#fff;border-radius:6px;font-size:12px;font-weight:700">' +
    _fmtInt(totalConReco) +
    ' SKUs con reco</div>' +
    '<div style="padding:6px 12px;background:#134e4a;color:#fff;border-radius:6px;font-size:12px;font-weight:700">Σ ' +
    _fmtInt(totalReco) +
    ' unidades</div>' +
    discChip +
    '</div>';

  const filters =
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:10px;background:var(--bg-secondary);border-radius:6px">' +
    '<input type="text" id="reco-search" placeholder="Buscar SKU o descripcion..." value="' +
    escapeHtmlSafe(_recoSearchText) +
    '" oninput="onRecoSearchChange(event)" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)"/>' +
    '<select onchange="onRecoFamiliaChange(event)" style="padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)">' +
    '<option value="all"' +
    (_recoFilterFamilia === 'all' ? ' selected' : '') +
    '>Todas las familias</option>' +
    '<option value="rods"' +
    (_recoFilterFamilia === 'rods' ? ' selected' : '') +
    '>Solo Rods (Cañas)</option>' +
    '<option value="reels"' +
    (_recoFilterFamilia === 'reels' ? ' selected' : '') +
    '>Solo Reels</option>' +
    '</select>' +
    '<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:var(--text-primary);cursor:pointer">' +
    '<input type="checkbox"' +
    (_recoFilterMinRec ? ' checked' : '') +
    ' onchange="onRecoFilterMinChange(event)"/>' +
    'Solo con recomendado &gt; 0</label>' +
    '<button onclick="exportRecoExcel()" style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer">⬇ Excel</button>' +
    '</div>';

  const rowsHtml = rows
    .map((r) => {
      const balColor = r.balance < 0 ? '#dc2626' : r.balance < 50 ? '#f59e0b' : '#16a34a';
      const recColor = r.recomendado > 0 ? '#dc2626' : '#94a3b8';
      return (
        '<tr style="border-bottom:1px solid var(--border-subtle)">' +
        '<td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:2px 6px;border-radius:10px;background:' +
        (r.familia === 'rods' ? '#0ea5e9' : '#8b5cf6') +
        ';color:#fff;font-size:10px;font-weight:700">' +
        (r.familia === 'rods' ? 'ROD' : 'REEL') +
        '</span></td>' +
        '<td style="padding:6px 8px;text-align:center;font-family:monospace;font-size:11px;color:var(--text-primary);font-weight:700">' +
        escapeHtmlSafe(r.sku) +
        '</td>' +
        '<td style="padding:6px 8px;font-size:11px;color:var(--text-secondary);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
        escapeHtmlSafe(r.description) +
        '">' +
        escapeHtmlSafe(r.description) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary)">' +
        _fmtInt(r.stockLibre) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted)">' +
        _fmtInt(r.enTransito) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:#dc2626">' +
        _fmtInt(r.backorder) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' +
        _fmtInt(r.ventaMensual) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center">' +
        _buildMultCellHtml(r) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' +
        _fmtInt(r.demandaEsperada) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary);font-weight:600">' +
        _fmtInt(r.salesPlanFut) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;color:' +
        balColor +
        '">' +
        _fmtNumSigned(r.balance) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted);font-size:11px">' +
        _fmtInt(r.moq) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:4px 10px;border-radius:12px;background:' +
        recColor +
        ';color:#fff;font-size:12px;font-weight:800;min-width:50px">' +
        _fmtInt(r.recomendado) +
        '</span></td>' +
        '<td style="padding:6px 8px;text-align:center">' +
        '<button onclick="discontinueSku(\'' +
        escapeHtmlSafe(r.sku) +
        "', '" +
        escapeHtmlSafe(r.description.replace(/'/g, '')) +
        '\')" title="Descontinuar este SKU" style="background:transparent;border:1px solid var(--border-subtle);border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;color:var(--text-muted)">🗑</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  // v1112: min-width para forzar scroll horizontal si no cabe la columna
  // Acción. Sin esto, table width:100% comprime todo y la última columna
  // queda fuera del viewport sin scroll visible.
  const table =
    '<div style="overflow:auto;max-height:60vh;border:1px solid var(--border-subtle);border-radius:8px">' +
    '<table style="width:100%;min-width:1400px;border-collapse:collapse;font-size:12px">' +
    '<thead style="background:#0f172a;color:#fff;position:sticky;top:0;z-index:1"><tr>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Fam</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">SKU</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Descripción</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 11 disponible venta">Stock</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 12">Tránsito</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Backorder</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Promedio últimos 3 meses">Vta/mes</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Multiplicador de tendencia = venta 2m / venta 6m. Editable (click para override).">Multip.</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Vta/mes × 7 meses">Demanda esp.</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Suma columnas Sales Plan desde mes actual">Plan futuro</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Balance</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">MOQ</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;background:#134e4a">Recomendado</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Descontinuar SKU">Acción</th>' +
    '</tr></thead><tbody>' +
    (rows.length
      ? rowsHtml
      : '<tr><td colspan="14" style="padding:40px;text-align:center;color:var(--text-muted)">Sin resultados con los filtros actuales</td></tr>') +
    '</tbody></table></div>';

  const footer =
    '<div style="margin-top:8px;font-size:10px;color:var(--text-muted)">' +
    'Mostrando ' +
    _fmtInt(rows.length) +
    ' de ' +
    _fmtInt(allRows.length) +
    ' SKUs · ' +
    'Balance = Stock + Tránsito + Plan − Backorder − Demanda. Rojo = quiebre esperado. Recomendado se redondea al múltiplo de MOQ superior.' +
    '</div>';

  cont.innerHTML =
    '<div style="padding:18px 18px 30px">' + header + filters + table + footer + '</div>';
}

window.onRecoSearchChange = function (ev) {
  _recoSearchText = ev.target.value || '';
  _renderRecoSection();
  // Restaurar focus + caret al input
  setTimeout(() => {
    const inp = document.getElementById('reco-search');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }, 0);
};

window.onRecoFamiliaChange = function (ev) {
  _recoFilterFamilia = ev.target.value || 'all';
  _renderRecoSection();
};

window.onRecoFilterMinChange = function (ev) {
  _recoFilterMinRec = !!ev.target.checked;
  _renderRecoSection();
};

window.exportRecoExcel = function () {
  if (typeof XLSX === 'undefined') {
    alert('SheetJS (XLSX) no cargado');
    return;
  }
  const rows = _computeRecommendations();
  const aoa = [
    [
      'Familia',
      'SKU',
      'Descripción',
      'Stock',
      'Tránsito',
      'Backorder',
      'Vta prom/mes',
      'Multiplicador',
      'Origen mult',
      'Demanda esp. 7m',
      'Sales Plan futuro',
      'Balance',
      'MOQ',
      'Recomendado',
    ],
  ];
  for (const r of rows) {
    aoa.push([
      r.familia === 'rods' ? 'Rods (Cañas)' : 'Reels',
      r.sku,
      r.description,
      r.stockLibre,
      r.enTransito,
      r.backorder,
      r.ventaMensual,
      r.multiplier,
      r.multSource || 'auto',
      r.demandaEsperada,
      r.salesPlanFut,
      r.balance,
      r.moq,
      r.recomendado,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 14 }, // Familia
    { wch: 18 }, // SKU
    { wch: 40 }, // Descripción
    { wch: 8 }, // Stock
    { wch: 10 }, // Tránsito
    { wch: 11 }, // Backorder
    { wch: 12 }, // Vta prom/mes
    { wch: 12 }, // Multiplicador
    { wch: 11 }, // Origen mult
    { wch: 15 }, // Demanda esp 7m
    { wch: 16 }, // Sales Plan futuro
    { wch: 10 }, // Balance
    { wch: 8 }, // MOQ
    { wch: 12 }, // Recomendado
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Recomendación');
  const hoy = new Date();
  const stamp =
    hoy.getFullYear() +
    '-' +
    String(hoy.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(hoy.getDate()).padStart(2, '0');
  XLSX.writeFile(wb, 'Recomendacion_Compra_' + stamp + '.xlsx');
};

// v1112 F3B: descontinuar / reactivar SKUs.
window.discontinueSku = async function (sku, description) {
  if (!_discontinuedSkus) _discontinuedSkus = new Set();
  const upper = String(sku).trim().toUpperCase();
  const label = description ? sku + ' — ' + description.slice(0, 60) : sku;
  if (
    !confirm(
      'Descontinuar ' +
        label +
        '?\n\nQuedará excluido del cálculo de recomendación de compra hasta que lo reactives desde el chip "Descontinuados".'
    )
  ) {
    return;
  }
  _discontinuedSkus.add(upper);
  try {
    await _saveDiscontinuedSkus();
    _renderRecoSection();
  } catch (e) {
    _discontinuedSkus.delete(upper);
    alert('Error guardando: ' + (e.message || e));
  }
};

window.reactivateSku = async function (sku) {
  if (!_discontinuedSkus) return;
  const upper = String(sku).trim().toUpperCase();
  _discontinuedSkus.delete(upper);
  try {
    await _saveDiscontinuedSkus();
    _renderDiscontinuedModal();
    _renderRecoSection();
  } catch (e) {
    _discontinuedSkus.add(upper);
    alert('Error guardando: ' + (e.message || e));
  }
};

window.openDiscontinuedModal = function () {
  const existing = document.getElementById('discontinued-skus-modal');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'discontinued-skus-modal';
  el.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:2100;display:flex;align-items:center;justify-content:center;padding:3vh';
  el.onclick = (ev) => {
    if (ev.target === el) el.remove();
  };
  el.innerHTML =
    '<div id="discontinued-modal-content" style="background:var(--bg-elevated);border-radius:12px;padding:24px;max-width:640px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)"></div>';
  document.body.appendChild(el);
  _renderDiscontinuedModal();
};

function _renderDiscontinuedModal() {
  const cont = document.getElementById('discontinued-modal-content');
  if (!cont) return;
  const list = _discontinuedSkus ? Array.from(_discontinuedSkus).sort() : [];
  // Buscar descripción en los sales plans caches por si esta cargado
  const skuToDesc = {};
  for (const fam of ['rods', 'reels']) {
    const cache = _salesPlanCaches[fam];
    if (cache && cache.rows) {
      for (const r of cache.rows) {
        skuToDesc[String(r.sku).trim().toUpperCase()] = r.description || '';
      }
    }
  }
  const head =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
    '<div><div style="font-size:18px;font-weight:800;color:var(--text-primary)">SKUs descontinuados</div>' +
    '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' +
    list.length +
    ' SKUs excluidos del cálculo de Recomendación de Compra' +
    '</div></div>' +
    '<button onclick="document.getElementById(\'discontinued-skus-modal\').remove()" style="background:transparent;border:1px solid var(--border-subtle);border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700">Cerrar</button>' +
    '</div>';
  const body =
    list.length === 0
      ? '<div style="padding:40px;text-align:center;color:var(--text-muted)">No hay SKUs descontinuados.<br><br>Podés descontinuar SKUs desde el botón 🗑 en cada fila de la tabla Recomendación de Compra.</div>'
      : '<div style="display:flex;flex-direction:column;gap:6px">' +
        list
          .map((sku) => {
            const desc = skuToDesc[sku] || '';
            return (
              '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-secondary);border-radius:6px">' +
              '<div style="flex:1"><div style="font-family:monospace;font-weight:700;color:var(--text-primary)">' +
              escapeHtmlSafe(sku) +
              '</div>' +
              (desc
                ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' +
                  escapeHtmlSafe(desc) +
                  '</div>'
                : '') +
              '</div>' +
              '<button onclick="reactivateSku(\'' +
              escapeHtmlSafe(sku) +
              '\')" style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer">↻ Reactivar</button>' +
              '</div>'
            );
          })
          .join('') +
        '</div>';
  cont.innerHTML = head + body;
}
