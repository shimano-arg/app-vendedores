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

const RECO_HORIZON_MONTHS = 7;
const RECO_VENTA_PROMEDIO_WINDOW = 3; // meses hacia atrás para promedio venta
const RECO_DEFAULT_MULTIPLIER = 1.0;

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
    '<div id="forecast-tabs-bar" style="display:flex;gap:0;background:var(--bg-secondary);padding:0 18px;border-bottom:1px solid var(--border-subtle)">' +
    '<button data-tab="sales-plans" onclick="switchForecastTab(\'sales-plans\')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-primary);border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button>' +
    '<button data-tab="stat" onclick="switchForecastTab(\'stat\')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Estadístico</button>' +
    '<button data-tab="legacy" onclick="switchForecastTab(\'legacy\')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Legacy (6m)</button>' +
    '</div>';
  const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto"></div>';
  const tabStat = '<div id="forecast-tab-stat" style="flex:1;overflow:auto;display:none"></div>';
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
  return modalOuter + header + tabsBar + tabSalesPlans + tabStat + tabLegacy + '</div>';
}

// v1098+ Fase 1 + v1103+ Fase 2B + v1105 fix: switch entre tabs Sales Plans / Stat / Legacy.
window.switchForecastTab = function (tabId) {
  _forecastActiveTab = tabId;
  const sp = document.getElementById('forecast-tab-sales-plans');
  const st = document.getElementById('forecast-tab-stat');
  const lg = document.getElementById('forecast-tab-legacy');
  if (sp) sp.style.display = tabId === 'sales-plans' ? 'block' : 'none';
  if (st) st.style.display = tabId === 'stat' ? 'block' : 'none';
  if (lg) lg.style.display = tabId === 'legacy' ? 'flex' : 'none';
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

// ---------------------------------------------------------------------------
// F3A — Tabla Recomendación de Compra (tab Sales Plans)
// ---------------------------------------------------------------------------

async function _loadRecoData() {
  if (!window.fbDb) throw new Error('Firestore no inicializado');
  const promises = [];
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
      const multiplier = RECO_DEFAULT_MULTIPLIER; // v1109: fijo 1.0; F3B lo hace editable por subfamilia
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
        '</tr>'
      );
    })
    .join('');

  const table =
    '<div style="overflow:auto;max-height:60vh;border:1px solid var(--border-subtle);border-radius:8px">' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead style="background:#0f172a;color:#fff;position:sticky;top:0;z-index:1"><tr>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Fam</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">SKU</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Descripción</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 11 disponible venta">Stock</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 12">Tránsito</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Backorder</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Promedio últimos 3 meses">Vta/mes</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Vta/mes × 7 meses">Demanda esp.</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Suma columnas Sales Plan desde mes actual">Plan futuro</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Balance</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">MOQ</th>' +
    '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;background:#134e4a">Recomendado</th>' +
    '</tr></thead><tbody>' +
    (rows.length
      ? rowsHtml
      : '<tr><td colspan="12" style="padding:40px;text-align:center;color:var(--text-muted)">Sin resultados con los filtros actuales</td></tr>') +
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
      r.demandaEsperada,
      r.salesPlanFut,
      r.balance,
      r.moq,
      r.recomendado,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 40 },
    { wch: 8 },
    { wch: 10 },
    { wch: 11 },
    { wch: 12 },
    { wch: 15 },
    { wch: 16 },
    { wch: 10 },
    { wch: 8 },
    { wch: 12 },
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
