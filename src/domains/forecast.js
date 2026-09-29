// @ts-nocheck
// v1098+ Fase 1: import del parser puro. El módulo hace `window.SalesPlanParser`
// como side-effect y también exporta las fns nombradas; usamos side-effect
// porque forecast.js corre en el chunk lazy y window ya está disponible.
import '../pure/sales-plan-parser.js';

// Globals leidos del entorno (declarados en index.html inline o bundle previo):
// fbDb, currentUser, XLSX (cdn), escapeHtml. Mismo patron que otros dominios.
//
// FORECAST - modal admin-only (Mariano) que compara ventas historicas
// (Firestore sku_ventas_snapshot, alimentado por sync BQ v_ventas_lineas
// ventana 13m) vs Sales Plan cargado por el user via Excel + politica de
// inventario (promedio YTD x 3 meses).
//
// Chunk lazy: se carga solo al primer click del boton FORECAST del header.
// Registrado en build.js LAZY_CHUNKS + src/main.js installChunkStubs + sw.js
// STATIC_ASSETS. Ver CLAUDE.md #18 (3 lugares sincronizados).
//
// Contrato del Excel Sales Plan que sube el user:
//   Columnas: SKU | Mes1 | Mes2 | Mes3 | Mes4 | Mes5 | Mes6
//   (nombres exactos de headers case-insensitive; Mes1..6 son los proximos
//   6 meses desde el mes actual). Una fila por SKU.
//
// Fuente de datos historicas:
//   Firestore /sku_ventas_snapshot/{SKU_<sku_saneado>}
//   {
//     sku, itemName, familia, subfamilia,
//     meses: { '2025-08': {qty, ars}, ..., '2026-08': {qty, ars} }
//   }
//   Rules: read admin-only (competitively sensitive). Escrito por cron
//   sync_sap_to_bigquery.py cada 30 min.

// Estado del modal (intra-chunk, no cross-scope).
let _forecastSnapshot = null; // { SKU: {familia, subfamilia, itemName, meses} }
let _forecastSalesPlan = null; // [{ sku, pedidoTotal, mesesArr: [n1..n6] }]
let _forecastRows = null; // filas finales calculadas para preview + export
let _forecastLoading = false;

// v1098+ (Fase 1 Forecast v2): Sales Plans mensuales por familia (Rods/Reels/FG).
// Se guardan en Firestore `sales_plan_cache/{familia}` + snapshot Excel original
// en Storage `forecasts_snapshots/{YYYY-MM}/{familia}.xlsx`.
// El parser puro vive en src/pure/sales-plan-parser.js (attach a window.SalesPlanParser).
const SALES_PLAN_FAMILIAS = [
  { key: 'rods', label: 'Rods (Cañas)', color: '#0ea5e9' },
  { key: 'reels', label: 'Reels', color: '#8b5cf6' },
  { key: 'fg', label: 'FG (resto)', color: '#f59e0b' },
];
const _salesPlanCaches = { rods: null, reels: null, fg: null }; // last loaded doc
let _forecastActiveTab = 'sales-plans'; // 'sales-plans' | 'legacy'

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

// Helpers de mes calendar.
function _monthKey(year, monthOneBased) {
  return String(year).padStart(4, '0') + '-' + String(monthOneBased).padStart(2, '0');
}
function _monthLabel(key) {
  // '2026-08' -> 'ago-26'
  const [y, m] = key.split('-').map(Number);
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
  return names[m - 1] + '-' + String(y).slice(-2);
}
function _addMonths(year, monthOneBased, delta) {
  const totalMonths = year * 12 + (monthOneBased - 1) + delta;
  const y = Math.floor(totalMonths / 12);
  const m = (totalMonths % 12) + 1;
  return { y, m };
}

// Suma qty del SKU en los ultimos 12 MESES COMPLETOS (excluye el mes actual
// parcial - la ventana movil "12 meses cerrados" que el user piensa como
// "el año que ya paso"). Ejemplo en agosto 2026: sumar ago-25 a jul-26.
function _sumVentas12mCompletos(mesesMap, hoy) {
  if (!mesesMap) return 0;
  let sum = 0;
  const startMonth = _addMonths(hoy.getFullYear(), hoy.getMonth() + 1, -12);
  const endMonth = _addMonths(hoy.getFullYear(), hoy.getMonth() + 1, -1);
  const startKey = _monthKey(startMonth.y, startMonth.m);
  const endKey = _monthKey(endMonth.y, endMonth.m);
  for (const k of Object.keys(mesesMap)) {
    if (k >= startKey && k <= endKey) {
      sum += Number((mesesMap[k] && mesesMap[k].qty) || 0);
    }
  }
  return sum;
}

// Suma qty del SKU YTD (enero del año actual hasta mes actual INCLUSIVO,
// aunque el mes actual sea parcial). Retorna { totalYtd, mesesTranscurridos }.
// Ejemplo agosto 2026 con ventas jul=10 + ago=20 -> {30, 8}, promedio=30/8=3.75.
// (Si el usuario esperaba dividir por 2 en vez de 8, revisar spec. El pedido
// dice "cantidad de meses que transcurrimos" = meses del año pasados hasta hoy.)
function _sumVentasYTD(mesesMap, hoy) {
  const year = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  let total = 0;
  if (mesesMap) {
    for (let m = 1; m <= mesActual; m++) {
      const k = _monthKey(year, m);
      total += Number((mesesMap[k] && mesesMap[k].qty) || 0);
    }
  }
  return { totalYtd: total, mesesTranscurridos: mesActual };
}

// Carga sku_ventas_snapshot completo (una vez por sesion del modal).
async function _loadSnapshot() {
  if (_forecastSnapshot) return _forecastSnapshot;
  if (!window.fbDb) throw new Error('Firestore no inicializado');
  const snap = await window.fbDb.collection('sku_ventas_snapshot').get();
  const byOriginalSku = {};
  const byUpperSku = {};
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d || !d.sku) return;
    const skuUpper = String(d.sku).trim().toUpperCase();
    const record = {
      sku: d.sku,
      itemName: d.itemName || '',
      familia: d.familia || '',
      subfamilia: d.subfamilia || '',
      meses: d.meses || {},
    };
    byOriginalSku[d.sku] = record;
    byUpperSku[skuUpper] = record;
  });
  _forecastSnapshot = { byOriginalSku, byUpperSku, count: snap.size };
  return _forecastSnapshot;
}

// Parsea el Excel Sales Plan. Espera columnas SKU + 6 columnas numericas
// (nombres flexibles: Mes1..Mes6, mes_1..mes_6, o cualquier header custom
// mientras la primera sea SKU y haya al menos 6 columnas numericas mas).
function _parseSalesPlanRows(rowsRaw) {
  if (!rowsRaw || !rowsRaw.length) return [];
  const headerRow = rowsRaw[0];
  // Detectar indice de columna SKU
  let skuColIdx = -1;
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '')
      .trim()
      .toUpperCase();
    if (h === 'SKU' || h === 'ITEMCODE' || h === 'ITEM' || h === 'ITEM CODE' || h === 'CODIGO') {
      skuColIdx = i;
      break;
    }
  }
  if (skuColIdx < 0)
    throw new Error('El Excel debe tener una columna llamada "SKU" (o Codigo / ItemCode / Item)');
  // Las 6 columnas de meses: las primeras 6 columnas que sean != skuColIdx.
  const monthCols = [];
  for (let i = 0; i < headerRow.length && monthCols.length < 6; i++) {
    if (i !== skuColIdx) monthCols.push(i);
  }
  if (monthCols.length < 6)
    throw new Error(
      'El Excel debe tener al menos 6 columnas de meses ademas de SKU (encontradas: ' +
        monthCols.length +
        ')'
    );
  const out = [];
  for (let r = 1; r < rowsRaw.length; r++) {
    const row = rowsRaw[r];
    if (!row || !row.length) continue;
    const skuRaw = row[skuColIdx];
    if (skuRaw === undefined || skuRaw === null || String(skuRaw).trim() === '') continue;
    const sku = String(skuRaw).trim();
    const mesesArr = monthCols.map((i) => {
      const v = row[i];
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    });
    const pedidoTotal = mesesArr.reduce((a, b) => a + b, 0);
    out.push({ sku, mesesArr, pedidoTotal });
  }
  return out;
}

// Calcula las filas finales cruzando snapshot + sales plan.
function _computeForecastRows(snapshot, salesPlan, hoy) {
  const rows = [];
  for (const sp of salesPlan) {
    const skuUpper = sp.sku.toUpperCase();
    const hist = snapshot.byUpperSku[skuUpper] || null;
    const ventas12m = hist ? _sumVentas12mCompletos(hist.meses, hoy) : 0;
    const ytd = hist
      ? _sumVentasYTD(hist.meses, hoy)
      : { totalYtd: 0, mesesTranscurridos: hoy.getMonth() + 1 };
    const promedio = ytd.mesesTranscurridos > 0 ? ytd.totalYtd / ytd.mesesTranscurridos : 0;
    const politica = promedio * 3;
    const total = sp.pedidoTotal - politica;
    rows.push({
      sku: sp.sku,
      itemName: hist ? hist.itemName : '',
      familia: hist ? hist.familia : '(sin match)',
      subfamilia: hist ? hist.subfamilia : '(sin match)',
      ventas12m: ventas12m,
      pedido6m: sp.pedidoTotal,
      promedio: promedio,
      politica: politica,
      total: total,
      hasHistoria: !!hist,
    });
  }
  return rows;
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
  const tabsBar =
    '<div id="forecast-tabs-bar" style="display:flex;gap:0;background:#1e293b;padding:0 18px;border-bottom:1px solid var(--border-subtle)">' +
    '<button data-tab="sales-plans" onclick="switchForecastTab(\'sales-plans\')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:#fff;border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button>' +
    '<button data-tab="legacy" onclick="switchForecastTab(\'legacy\')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:#94a3b8;border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Legacy (6m)</button>' +
    '</div>';
  const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto"></div>';
  const legacyBar =
    '<div style="padding:12px 18px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);display:flex;flex-wrap:wrap;gap:14px;align-items:center">' +
    '<label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#0d9488;color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer">' +
    '<span>Cargar Sales Plan (.xlsx)</span>' +
    '<input type="file" accept=".xlsx,.xls" style="display:none" onchange="onForecastSalesPlanFile(event)"/></label>' +
    '<div id="forecast-hint" style="font-size:11px;color:var(--text-muted);max-width:520px">Formato legacy: primera columna <b>SKU</b>, luego 6 columnas con las unidades pedidas mes a mes.</div>' +
    '<button id="forecast-export-btn" onclick="exportForecastExcel()" disabled style="padding:8px 14px;background:var(--color-success);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;opacity:.5">Exportar Excel</button>' +
    '<div id="forecast-stats" style="margin-left:auto;font-size:11px;color:var(--text-secondary);font-weight:600"></div>' +
    '</div>';
  const legacyBody =
    '<div id="forecast-body" style="flex:1;overflow:auto;padding:0"><div style="padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px">Esperando archivo Sales Plan...</div></div>';
  const tabLegacy =
    '<div id="forecast-tab-legacy" style="flex:1;overflow:hidden;flex-direction:column;display:none">' +
    legacyBar +
    legacyBody +
    '</div>';
  return modalOuter + header + tabsBar + tabSalesPlans + tabLegacy + '</div>';
}

// v1098+ Fase 1: switch entre tabs Sales Plans <-> Legacy.
window.switchForecastTab = function (tabId) {
  _forecastActiveTab = tabId;
  const sp = document.getElementById('forecast-tab-sales-plans');
  const lg = document.getElementById('forecast-tab-legacy');
  if (sp) sp.style.display = tabId === 'sales-plans' ? 'block' : 'none';
  if (lg) lg.style.display = tabId === 'legacy' ? 'flex' : 'none';
  const btns = document.querySelectorAll('#forecast-tabs-bar .forecast-tab');
  btns.forEach((b) => {
    const active = b.getAttribute('data-tab') === tabId;
    b.style.color = active ? '#fff' : '#94a3b8';
    b.style.borderBottomColor = active ? '#0d9488' : 'transparent';
    b.style.fontWeight = active ? '700' : '600';
  });
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

function _renderTable(rows) {
  const body = document.getElementById('forecast-body');
  if (!body) return;
  if (!rows || !rows.length) {
    body.innerHTML =
      '<div style="padding:60px 20px;text-align:center;color:var(--text-muted)">Sales Plan vacio o sin filas validas.</div>';
    return;
  }
  const fmt = (n) =>
    n === 0 || !Number.isFinite(n)
      ? '0'
      : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const colorForTotal = (t) => {
    if (t > 0) return '#166534'; // sobra (pediste mas que la politica) - verde
    if (t < 0) return '#c2410c'; // falta (pediste menos que la politica) - naranja urgente
    return '#475569';
  };
  const rowsHtml = rows
    .map(
      (r) =>
        '' +
        '<tr' +
        (r.hasHistoria ? '' : ' style="background:var(--color-warning-bg)"') +
        '>' +
        '<td style="padding:6px 10px;font-family:monospace;font-size:11px;white-space:nowrap">' +
        escapeHtmlSafe(r.sku) +
        '</td>' +
        '<td style="padding:6px 10px;font-size:11px">' +
        escapeHtmlSafe(r.familia) +
        '</td>' +
        '<td style="padding:6px 10px;font-size:11px">' +
        escapeHtmlSafe(r.subfamilia) +
        '</td>' +
        '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' +
        fmt(r.ventas12m) +
        '</td>' +
        '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">' +
        fmt(r.pedido6m) +
        '</td>' +
        '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted)">' +
        fmt(r.promedio) +
        '</td>' +
        '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' +
        fmt(r.politica) +
        '</td>' +
        '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:' +
        colorForTotal(r.total) +
        '">' +
        fmt(r.total) +
        '</td>' +
        '</tr>'
    )
    .join('');
  const header =
    '' +
    '<thead style="position:sticky;top:0;background:#0f172a;color:#fff;z-index:1">' +
    '<tr>' +
    '<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">SKU</th>' +
    '<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Familia</th>' +
    '<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Subfamilia</th>' +
    '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de qty facturada en los ultimos 12 meses completos">Ventas 12m</th>' +
    '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de las 6 columnas del Excel Sales Plan">Pedido 6m</th>' +
    '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Ventas YTD / meses transcurridos del año">Prom / Mes</th>' +
    '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Promedio x 3 meses (politica de inventario)">Politica</th>' +
    '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Pedido 6m - Politica. Negativo = te falta pedir; Positivo = sobrepedido">Total</th>' +
    '</tr>' +
    '</thead>';
  body.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    header +
    '<tbody>' +
    rowsHtml +
    '</tbody></table>';
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
    '<b style="color:var(--text-primary)">Fase 1</b> — Cargá los 3 Sales Plans mensuales (Rods / Reels / FG). Se parsea la hoja <b>SAR</b>: SKU, MOQ 12 months, y una columna por mes. ' +
    'El Excel original queda snapshotado en Storage y el parseo queda en Firestore para el cálculo (próxima fase).' +
    '</div>';
  const grid =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">' +
    slots +
    '</div>';
  cont.innerHTML = '<div style="padding:18px">' + intro + grid + '</div>';
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
    _salesPlanCaches[familia] = payload;
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

window.openForecastModal = async function () {
  if (!_canForecast()) {
    alert('FORECAST es solo para Mariano (admin).');
    return;
  }
  const el = _renderModalShell();
  el.style.display = 'block';
  // v1098+ Fase 1: cargar Sales Plans caches + renderizar tab default.
  _renderSalesPlansTab();
  _loadSalesPlanCaches()
    .then(_renderSalesPlansTab)
    .catch(() => {});
  // Legacy: snapshot solo se carga lazy si el user cambia a tab Legacy.
  if (_forecastLoading) return;
  if (!_forecastSnapshot) {
    _forecastLoading = true;
    const stats = document.getElementById('forecast-stats');
    if (stats) stats.textContent = 'Cargando snapshot de ventas...';
    try {
      await _loadSnapshot();
      if (stats) stats.textContent = _forecastSnapshot.count + ' SKUs en snapshot historico';
    } catch (e) {
      if (stats) stats.textContent = 'Error cargando snapshot: ' + ((e && e.message) || e);
      // No alert — legacy es opt-in, no bloquea al usuario si solo va a subir Sales Plans.
      console.warn('[FORECAST] snapshot load fail (legacy tab)', e);
    } finally {
      _forecastLoading = false;
    }
  } else {
    const stats = document.getElementById('forecast-stats');
    if (stats) stats.textContent = _forecastSnapshot.count + ' SKUs en snapshot historico';
  }
};

window.closeForecastModal = function () {
  const el = document.getElementById('forecast-modal');
  if (el) el.style.display = 'none';
};

window.onForecastSalesPlanFile = async function (event) {
  const file = event && event.target && event.target.files && event.target.files[0];
  if (!file) return;
  try {
    if (!_forecastSnapshot) await _loadSnapshot();
    const buf = await file.arrayBuffer();
    if (typeof XLSX === 'undefined') {
      alert('XLSX no cargado');
      return;
    }
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const parsed = _parseSalesPlanRows(rows);
    if (!parsed.length) {
      alert('El Excel esta vacio o no tiene filas validas.');
      return;
    }
    _forecastSalesPlan = parsed;
    const hoy = new Date();
    _forecastRows = _computeForecastRows(_forecastSnapshot, parsed, hoy);
    _renderTable(_forecastRows);
    const sinMatch = _forecastRows.filter((r) => !r.hasHistoria).length;
    const stats = document.getElementById('forecast-stats');
    if (stats) {
      stats.textContent =
        parsed.length +
        ' SKUs en Sales Plan · ' +
        (parsed.length - sinMatch) +
        ' con historia · ' +
        sinMatch +
        ' sin match (fondo amarillo)';
    }
    const btn = document.getElementById('forecast-export-btn');
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  } catch (e) {
    console.error('[FORECAST] parse error:', e);
    alert('Error procesando el Excel:\n' + ((e && e.message) || e));
  } finally {
    // Reset input para que el mismo archivo se pueda re-subir
    if (event && event.target) event.target.value = '';
  }
};

window.exportForecastExcel = function () {
  if (!_forecastRows || !_forecastRows.length) {
    alert('No hay datos para exportar. Carga primero el Sales Plan.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('XLSX no cargado');
    return;
  }
  const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
  const aoa = [
    [
      'SKU',
      'FAMILIA',
      'SUBFAMILIA',
      'VENTAS (12m)',
      'PEDIDO-SALES PLANS (6m)',
      'PROMEDIO DE INVENTARIO',
      'POLITICA DE INVENTARIO (3m)',
      'TOTAL',
    ],
  ];
  for (const r of _forecastRows) {
    aoa.push([
      r.sku,
      r.familia,
      r.subfamilia,
      round1(r.ventas12m),
      round1(r.pedido6m),
      round1(r.promedio),
      round1(r.politica),
      round1(r.total),
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Anchos de columna
  ws['!cols'] = [
    { wch: 18 },
    { wch: 24 },
    { wch: 24 },
    { wch: 14 },
    { wch: 20 },
    { wch: 20 },
    { wch: 22 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FORECAST');
  const hoy = new Date();
  const stamp =
    hoy.getFullYear() +
    '-' +
    String(hoy.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(hoy.getDate()).padStart(2, '0');
  XLSX.writeFile(wb, 'Forecast_Shimano_' + stamp + '.xlsx');
};

// Refresh publico (por si el user necesita re-fetchear el snapshot sin cerrar
// el modal, ej: pasaron 30 min y el cron BQ actualizo la coleccion).
window.reloadForecastSnapshot = async function () {
  _forecastSnapshot = null;
  await _loadSnapshot();
  if (_forecastSalesPlan) {
    const hoy = new Date();
    _forecastRows = _computeForecastRows(_forecastSnapshot, _forecastSalesPlan, hoy);
    _renderTable(_forecastRows);
  }
};
