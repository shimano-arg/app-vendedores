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
let _forecastSnapshot = null;    // { SKU: {familia, subfamilia, itemName, meses} }
let _forecastSalesPlan = null;   // [{ sku, pedidoTotal, mesesArr: [n1..n6] }]
let _forecastRows = null;        // filas finales calculadas para preview + export
let _forecastLoading = false;

// Whitelist de emails con acceso al modal FORECAST. Replica el patron de
// "Analisis" (index.html:12625). Solo Mariano; si otro admin lo necesita
// se agrega aca explicito.
const FORECAST_ALLOWED_EMAILS = [
  'mariano.erbino@shimano.com.ar',
  'erbinomariano@gmail.com',
];

function _canForecast() {
  try {
    const email = (window.currentUser && window.currentUser.email || '').toLowerCase();
    if (!email) return false;
    return FORECAST_ALLOWED_EMAILS.indexOf(email) >= 0;
  } catch { return false; }
}

// Helpers de mes calendar.
function _monthKey(year, monthOneBased) {
  return String(year).padStart(4, '0') + '-' + String(monthOneBased).padStart(2, '0');
}
function _monthLabel(key) {
  // '2026-08' -> 'ago-26'
  const [y, m] = key.split('-').map(Number);
  const names = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return names[m - 1] + '-' + String(y).slice(-2);
}
function _addMonths(year, monthOneBased, delta) {
  const totalMonths = (year * 12 + (monthOneBased - 1)) + delta;
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
  const endMonth   = _addMonths(hoy.getFullYear(), hoy.getMonth() + 1, -1);
  const startKey = _monthKey(startMonth.y, startMonth.m);
  const endKey   = _monthKey(endMonth.y,   endMonth.m);
  for (const k of Object.keys(mesesMap)) {
    if (k >= startKey && k <= endKey) {
      sum += Number(mesesMap[k] && mesesMap[k].qty || 0);
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
      total += Number(mesesMap[k] && mesesMap[k].qty || 0);
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
  snap.forEach(doc => {
    const d = doc.data();
    if (!d || !d.sku) return;
    const skuUpper = String(d.sku).trim().toUpperCase();
    const record = {
      sku:        d.sku,
      itemName:   d.itemName || '',
      familia:    d.familia || '',
      subfamilia: d.subfamilia || '',
      meses:      d.meses || {},
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
    const h = String(headerRow[i] || '').trim().toUpperCase();
    if (h === 'SKU' || h === 'ITEMCODE' || h === 'ITEM' || h === 'ITEM CODE' || h === 'CODIGO') {
      skuColIdx = i;
      break;
    }
  }
  if (skuColIdx < 0) throw new Error('El Excel debe tener una columna llamada "SKU" (o Codigo / ItemCode / Item)');
  // Las 6 columnas de meses: las primeras 6 columnas que sean != skuColIdx.
  const monthCols = [];
  for (let i = 0; i < headerRow.length && monthCols.length < 6; i++) {
    if (i !== skuColIdx) monthCols.push(i);
  }
  if (monthCols.length < 6) throw new Error('El Excel debe tener al menos 6 columnas de meses ademas de SKU (encontradas: ' + monthCols.length + ')');
  const out = [];
  for (let r = 1; r < rowsRaw.length; r++) {
    const row = rowsRaw[r];
    if (!row || !row.length) continue;
    const skuRaw = row[skuColIdx];
    if (skuRaw === undefined || skuRaw === null || String(skuRaw).trim() === '') continue;
    const sku = String(skuRaw).trim();
    const mesesArr = monthCols.map(i => {
      const v = row[i];
      const n = Number(v);
      return isFinite(n) ? n : 0;
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
    const ytd = hist ? _sumVentasYTD(hist.meses, hoy) : { totalYtd: 0, mesesTranscurridos: hoy.getMonth() + 1 };
    const promedio = ytd.mesesTranscurridos > 0 ? ytd.totalYtd / ytd.mesesTranscurridos : 0;
    const politica = promedio * 3;
    const total = sp.pedidoTotal - politica;
    rows.push({
      sku:         sp.sku,
      itemName:    hist ? hist.itemName : '',
      familia:     hist ? hist.familia : '(sin match)',
      subfamilia:  hist ? hist.subfamilia : '(sin match)',
      ventas12m:   ventas12m,
      pedido6m:    sp.pedidoTotal,
      promedio:    promedio,
      politica:    politica,
      total:       total,
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
  el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:2050;';
  el.onclick = function (ev) { if (ev.target === el) window.closeForecastModal(); };
  el.innerHTML = ''
    + '<div style="position:absolute;inset:1vh 1vw;background:#fff;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)">'
    +   '<div style="padding:12px 18px;background:#0f172a;color:#fff;display:flex;align-items:center;gap:12px">'
    +     '<div style="flex:1">'
    +       '<div style="font-size:16px;font-weight:800;letter-spacing:.5px">FORECAST</div>'
    +       '<div id="forecast-subtitle" style="font-size:11px;opacity:.8;margin-top:2px">Cargar Sales Plan para ver la proyeccion vs politica de inventario (3 meses)</div>'
    +     '</div>'
    +     '<button id="forecast-export-btn" onclick="exportForecastExcel()" disabled style="padding:8px 14px;background:#166534;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;opacity:.5">Exportar Excel</button>'
    +     '<button onclick="closeForecastModal()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700">Cerrar</button>'
    +   '</div>'
    +   '<div style="padding:12px 18px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:14px;align-items:center">'
    +     '<label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#0d9488;color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer">'
    +       '<span>Cargar Sales Plan (.xlsx)</span>'
    +       '<input type="file" accept=".xlsx,.xls" style="display:none" onchange="onForecastSalesPlanFile(event)"/>'
    +     '</label>'
    +     '<div id="forecast-hint" style="font-size:11px;color:#64748b;max-width:520px">Excel esperado: primera columna <b>SKU</b>, luego 6 columnas con las unidades pedidas mes a mes para los proximos 6 meses. Los headers de los meses pueden ser cualquier nombre (Mes1..Mes6, ago-26..ene-27, etc).</div>'
    +     '<div id="forecast-stats" style="margin-left:auto;font-size:11px;color:#475569;font-weight:600"></div>'
    +   '</div>'
    +   '<div id="forecast-body" style="flex:1;overflow:auto;padding:0">'
    +     '<div style="padding:60px 20px;text-align:center;color:#94a3b8;font-size:14px">Esperando archivo Sales Plan...</div>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);
  return el;
}

function _renderTable(rows) {
  const body = document.getElementById('forecast-body');
  if (!body) return;
  if (!rows || !rows.length) {
    body.innerHTML = '<div style="padding:60px 20px;text-align:center;color:#94a3b8">Sales Plan vacio o sin filas validas.</div>';
    return;
  }
  const fmt = (n) => (n === 0 || !isFinite(n)) ? '0' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const colorForTotal = (t) => {
    if (t > 0) return '#166534';   // sobra (pediste mas que la politica) - verde
    if (t < 0) return '#c2410c';   // falta (pediste menos que la politica) - naranja urgente
    return '#475569';
  };
  const rowsHtml = rows.map(r => ''
    + '<tr' + (r.hasHistoria ? '' : ' style="background:#fef3c7"') + '>'
    +   '<td style="padding:6px 10px;font-family:monospace;font-size:11px;white-space:nowrap">' + escapeHtmlSafe(r.sku) + '</td>'
    +   '<td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.familia) + '</td>'
    +   '<td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.subfamilia) + '</td>'
    +   '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.ventas12m) + '</td>'
    +   '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">' + fmt(r.pedido6m) + '</td>'
    +   '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;color:#64748b">' + fmt(r.promedio) + '</td>'
    +   '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.politica) + '</td>'
    +   '<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:' + colorForTotal(r.total) + '">' + fmt(r.total) + '</td>'
    + '</tr>'
  ).join('');
  const header = ''
    + '<thead style="position:sticky;top:0;background:#0f172a;color:#fff;z-index:1">'
    +   '<tr>'
    +     '<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">SKU</th>'
    +     '<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Familia</th>'
    +     '<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Subfamilia</th>'
    +     '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de qty facturada en los ultimos 12 meses completos">Ventas 12m</th>'
    +     '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de las 6 columnas del Excel Sales Plan">Pedido 6m</th>'
    +     '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Ventas YTD / meses transcurridos del año">Prom / Mes</th>'
    +     '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Promedio x 3 meses (politica de inventario)">Politica</th>'
    +     '<th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Pedido 6m - Politica. Negativo = te falta pedir; Positivo = sobrepedido">Total</th>'
    +   '</tr>'
    + '</thead>';
  body.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px">' + header + '<tbody>' + rowsHtml + '</tbody></table>';
}

function escapeHtmlSafe(s) {
  if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

window.openForecastModal = async function () {
  if (!_canForecast()) {
    alert('FORECAST es solo para Mariano (admin).');
    return;
  }
  const el = _renderModalShell();
  el.style.display = 'block';
  if (_forecastLoading) return;
  if (!_forecastSnapshot) {
    _forecastLoading = true;
    const stats = document.getElementById('forecast-stats');
    if (stats) stats.textContent = 'Cargando snapshot de ventas...';
    try {
      await _loadSnapshot();
      if (stats) stats.textContent = _forecastSnapshot.count + ' SKUs en snapshot historico';
    } catch (e) {
      if (stats) stats.textContent = 'Error cargando snapshot: ' + (e && e.message || e);
      alert('No se pudo cargar sku_ventas_snapshot. Chequea que el bootstrap Python ya haya corrido (scripts/apply_sku_ventas_snapshot.py) y que tengas rol admin.');
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
    if (typeof XLSX === 'undefined') { alert('XLSX no cargado'); return; }
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const parsed = _parseSalesPlanRows(rows);
    if (!parsed.length) { alert('El Excel esta vacio o no tiene filas validas.'); return; }
    _forecastSalesPlan = parsed;
    const hoy = new Date();
    _forecastRows = _computeForecastRows(_forecastSnapshot, parsed, hoy);
    _renderTable(_forecastRows);
    const sinMatch = _forecastRows.filter(r => !r.hasHistoria).length;
    const stats = document.getElementById('forecast-stats');
    if (stats) {
      stats.textContent = parsed.length + ' SKUs en Sales Plan · '
        + (parsed.length - sinMatch) + ' con historia · '
        + sinMatch + ' sin match (fondo amarillo)';
    }
    const btn = document.getElementById('forecast-export-btn');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  } catch (e) {
    console.error('[FORECAST] parse error:', e);
    alert('Error procesando el Excel:\n' + (e && e.message || e));
  } finally {
    // Reset input para que el mismo archivo se pueda re-subir
    if (event && event.target) event.target.value = '';
  }
};

window.exportForecastExcel = function () {
  if (!_forecastRows || !_forecastRows.length) { alert('No hay datos para exportar. Carga primero el Sales Plan.'); return; }
  if (typeof XLSX === 'undefined') { alert('XLSX no cargado'); return; }
  const round1 = n => Math.round(Number(n || 0) * 10) / 10;
  const aoa = [[
    'SKU', 'FAMILIA', 'SUBFAMILIA',
    'VENTAS (12m)', 'PEDIDO-SALES PLANS (6m)',
    'PROMEDIO DE INVENTARIO', 'POLITICA DE INVENTARIO (3m)', 'TOTAL',
  ]];
  for (const r of _forecastRows) {
    aoa.push([
      r.sku, r.familia, r.subfamilia,
      round1(r.ventas12m), round1(r.pedido6m),
      round1(r.promedio), round1(r.politica), round1(r.total),
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Anchos de columna
  ws['!cols'] = [
    { wch: 18 }, { wch: 24 }, { wch: 24 },
    { wch: 14 }, { wch: 20 },
    { wch: 20 }, { wch: 22 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FORECAST');
  const hoy = new Date();
  const stamp = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');
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
