// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline o cargados
// desde CDN): XLSX, VENDORS, MESES, currentUser, fbDb, firebase, userRole,
// sapVendorsCache, sapGetSlpCodeForVendor, showSyncTag, logOp, renderDashboard,
// titleCase, escapeHtml (los últimos 2 vienen del bundle __phase0.pure vía
// shim en el inline). No hago JSDoc @global porque es un módulo extraído
// verbatim y el tipado real requeriría inventar interfaces — fuera de scope
// E2.a (verbatim first, refactor tipado después).
//
// TARGETS mensuales por vendedor + listener live.
// Extraído verbatim de index.html (líneas 11064-11430 pre-E2.a) como parte
// de E2.a (e2b-perf 2026-07-28). Preserva 100% del comportamiento.
//
// Cross-scope state (declarado como `var` en el inline, accedido acá):
//   - targetsCache (Map<docId, targetDoc>)  — leído por dashboard tb
//   - unsubTargets (function | null)         — leído por detachFirebaseListeners
//
// Pattern en strict mode del bundle:
//   - Reads sin prefix (JS resuelve a `window.X`).
//   - Reassignments con `window.X = ...` explícito (`X = ...` tira ReferenceError).
//   - Mutations (.set/.clear/.push) sin prefix (mutate el mismo object).
//
// Callers externos (fuera del bundle, en el inline restante) que dependen de
// funciones expuestas acá:
//   - dashboard: getMonthlyTargetArs, getCumulativeTargetArs
//   - auth flow: ensureTargetsListener, canManageTargets
//   - HTML onclick: openTargetsPanel, closeTargetsPanel, onTgtInputChange,
//     saveTargets, exportTargetsExcel
//
// Cross-domain vars leídas desde acá (deben seguir disponibles en window):
//   - currentUser, fbDb, firebase, userRole (globales stdndar Firebase Auth)
//   - VENDORS, MESES (constants del inline)
//   - titleCase, escapeHtml (del bundle window.__phase0.pure vía shim)
//   - sapVendorsCache, sapGetSlpCodeForVendor (en el inline, futura E2.m sap)
//   - showSyncTag, logOp, renderDashboard (funciones del inline, futuras extracciones)

// Init cross-scope state — bundle IIFE ejecuta antes del inline; declaramos
// acá para que window.targetsCache / window.unsubTargets existan antes de que
// cualquier función (del bundle o inline) las use. `typeof window.X === 'undefined'`
// guarda idempotencia por si el módulo se re-inicializa (dev hot-reload).
if (typeof window.targetsCache === 'undefined') window.targetsCache = new Map();
if (typeof window.unsubTargets === 'undefined') window.unsubTargets = null;

function tgtNormKey(vendorKey) {
  return (vendorKey || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
function targetDocId(vendorKey, year, monthIdx) {
  return tgtNormKey(vendorKey) + '_' + year + '_' + String(monthIdx).padStart(2, '0');
}
function getMonthlyTargetArs(vendorKey, year, monthIdx) {
  if (!vendorKey) return null;
  const id = targetDocId(vendorKey, year, monthIdx);
  const t = targetsCache.get(id);
  if (!t) return null;
  const v = parseFloat(t.targetArs);
  return Number.isNaN(v) || v < 0 ? null : v;
}
function getCumulativeTargetArs(vendorKey, year, throughMonthIdx) {
  // Suma los targets asignados de enero a throughMonthIdx (inclusive). Si faltan algunos, suma solo los que tiene.
  // Devuelve {sum, monthsAssigned, monthsMissing}
  let sum = 0,
    assigned = 0,
    missing = 0;
  for (let m = 0; m <= throughMonthIdx; m++) {
    const v = getMonthlyTargetArs(vendorKey, year, m);
    if (v != null) {
      sum += v;
      assigned++;
    } else missing++;
  }
  return { sum, monthsAssigned: assigned, monthsMissing: missing };
}

function ensureTargetsListener() {
  if (unsubTargets || !currentUser || !fbDb) return;
  // Cualquier rol autenticado puede leer (el vendedor lee el suyo desde el dashboard).
  // window.unsubTargets = ... (strict mode: reassignment de var cross-scope requiere prefix).
  window.unsubTargets = fbDb.collection('targets').onSnapshot(
    (qs) => {
      targetsCache.clear();
      qs.forEach((d) => {
        const data = d.data() || {};
        targetsCache.set(d.id, Object.assign({ _fsId: d.id }, data));
      });
      // Refrescar dashboard si esta abierto
      const dash = document.getElementById('dashboard-modal');
      if (dash && dash.classList.contains('open') && typeof renderDashboard === 'function')
        renderDashboard();
      // Si el modal de targets esta abierto, re-render
      const tgtModal = document.getElementById('targets-modal');
      if (tgtModal && tgtModal.classList.contains('open')) renderTargetsTable();
    },
    (err) => console.warn('targets listener', err)
  );
}

// === Permisos: quien puede gestionar targets ===
function canManageTargets() {
  if (userRole === 'admin') return true;
  if (userRole === 'gerente') return true;
  // Emails permitidos explicitos (Mariano + Diego + Santiago/bot)
  const allowed = ['bot.shimano.pesca@gmail.com', 'erbinomariano@gmail.com', 'srb90284@gmail.com'];
  if (currentUser && allowed.indexOf((currentUser.email || '').toLowerCase()) >= 0) return true;
  return false;
}

// === Modal Targets ===
// tgtSelectedVendor, tgtSelectedYear, tgtPendingChanges son locales al domain
// (nadie los lee cross-scope) → viven en el bundle scope como let. OK.
let tgtSelectedVendor = null;
let tgtSelectedYear = null;
let tgtPendingChanges = {}; // docId -> nuevo monto (en proceso, no guardado)

function openTargetsPanel() {
  if (!canManageTargets()) {
    alert('No tenes permisos para acceder a esta seccion.');
    return;
  }
  ensureTargetsListener();
  // Poblar selectores (1 vez)
  const vSel = document.getElementById('tgt-vendor');
  vSel.innerHTML = VENDORS.map(
    (v) =>
      '<option value="' + v.key + '">' + escapeHtml(v.zone + ' - ' + titleCase(v.key)) + '</option>'
  ).join('');
  const ySel = document.getElementById('tgt-year');
  const nowY = new Date().getFullYear();
  let yopts = '';
  for (let y = nowY - 1; y <= nowY + 2; y++)
    yopts += '<option value="' + y + '"' + (y === nowY ? ' selected' : '') + '>' + y + '</option>';
  ySel.innerHTML = yopts;
  if (!tgtSelectedVendor) tgtSelectedVendor = VENDORS[0] ? VENDORS[0].key : null;
  if (!tgtSelectedYear) tgtSelectedYear = nowY;
  vSel.value = tgtSelectedVendor;
  ySel.value = tgtSelectedYear;
  tgtPendingChanges = {};
  document.getElementById('targets-modal').classList.add('open');
  renderTargetsTable();
}
async function closeTargetsPanel() {
  // v309+: con autosave el modal casi nunca cierra con pendientes, pero
  // si el debounce todavia no disparo (usuario aprieta X inmediatamente
  // tras escribir), flusheamos todo sync antes de cerrar. No perdida de
  // datos aunque cierre rapido.
  const pendingIds = Object.keys(tgtPendingChanges);
  if (pendingIds.length) {
    // Cancelar cualquier debounce en curso para no dispararlo despues.
    pendingIds.forEach((id) => {
      if (_tgtAutosaveTimers[id]) {
        clearTimeout(_tgtAutosaveTimers[id]);
        delete _tgtAutosaveTimers[id];
      }
    });
    // Flush sync: esperar todos los saves antes de cerrar.
    for (const id of pendingIds) {
      const ch = tgtPendingChanges[id];
      const monthIdx = ch ? ch.monthIdx : null;
      if (monthIdx != null) await _saveTargetFor(id, monthIdx);
    }
  }
  document.getElementById('targets-modal').classList.remove('open');
  tgtPendingChanges = {};
}

// v310+: familias en las que se descompone el target mensual.
// El total del mes se calcula como suma de las 3. Docs viejos sin
// targetByFamily se muestran con REEL/CANAS/LINEAS vacios y el total
// pre-existente en la columna Total (readonly, migrar cargando manual).
const TARGET_FAMILIES = ['REEL', 'CANAS', 'LINEAS']; // NO usar Ñ (BQ + JSON keys mas simples)
const _TARGET_FAMILY_LABELS = { REEL: 'Reel', CANAS: 'Cañas', LINEAS: 'Líneas' };

function renderTargetsTable() {
  const vendor = document.getElementById('tgt-vendor').value;
  const year = parseInt(document.getElementById('tgt-year').value, 10);
  tgtSelectedVendor = vendor;
  tgtSelectedYear = year;
  tgtPendingChanges = {};
  const nowM = new Date().getMonth();
  const nowY = new Date().getFullYear();
  let html =
    '<table class="targets-table"><thead><tr>' +
    '<th style="width:20%">Mes</th>' +
    '<th style="width:18%">Reel</th>' +
    '<th style="width:18%">Cañas</th>' +
    '<th style="width:18%">Líneas</th>' +
    '<th style="width:14%;background:#f0f9ff">Total mes</th>' +
    '<th style="width:12%">Estado</th>' +
    '</tr></thead><tbody>';
  for (let m = 0; m < 12; m++) {
    const id = targetDocId(vendor, year, m);
    const t = targetsCache.get(id);
    const byFam = (t && t.targetByFamily) || {};
    const isCurrent = year === nowY && m === nowM;
    const rowCls = isCurrent ? 'month-current' : '';
    // Total sale de la suma de familias si estan cargadas, sino del legacy targetArs.
    let totalMes = 0;
    let algunaCargada = false;
    TARGET_FAMILIES.forEach((f) => {
      const v = byFam[f] != null ? parseFloat(byFam[f]) : NaN;
      if (!Number.isNaN(v) && v > 0) {
        totalMes += v;
        algunaCargada = true;
      }
    });
    // Fallback: si no hay desglose por familia pero hay targetArs legacy, mostrarlo.
    if (!algunaCargada && t && t.targetArs != null) totalMes = Math.round(parseFloat(t.targetArs));
    const cargado = algunaCargada || (t && t.targetArs != null && t.targetArs > 0);
    const stateBadge = cargado
      ? '<span class="tgt-state-badge asignado">&#10003; Asignado</span>'
      : '<span class="tgt-state-badge sin">Sin cargar</span>';
    html += '<tr class="' + rowCls + '">';
    html +=
      '<td><b>' +
      MESES[m] +
      '</b>' +
      (isCurrent
        ? ' <span style="font-size:9px;color:#92400e;font-weight:700">(mes actual)</span>'
        : '') +
      '</td>';
    TARGET_FAMILIES.forEach((f) => {
      const val = byFam[f] != null ? Math.round(parseFloat(byFam[f])) : '';
      html +=
        '<td><input type="number" min="0" step="1000" class="tgt-input" data-month="' +
        m +
        '" data-familia="' +
        f +
        '" placeholder="0" value="' +
        val +
        '" oninput="onTgtInputChange(this)"/></td>';
    });
    html +=
      '<td style="text-align:right;font-weight:800;color:#0369a1;font-family:ui-monospace,Menlo,monospace;background:#f0f9ff" id="tgt-total-' +
      m +
      '">' +
      (totalMes > 0 ? '$' + totalMes.toLocaleString('es-AR') : '-') +
      '</td>';
    html += '<td>' + stateBadge + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  html +=
    '<div style="font-size:11px;color:#64748b;margin-top:10px;line-height:1.5"><b>Tip:</b> carg&aacute; el target de cada familia (Reel / Ca&ntilde;as / L&iacute;neas) y el <b>Total mes</b> se calcula solo. Los valores se <b>guardan solos</b> al terminar de escribir (~1 segundo).</div>';
  document.getElementById('tgt-table-wrap').innerHTML = html;
  document.getElementById('tgt-save-btn').textContent = 'Guardar Targets';
  document.getElementById('tgt-save-btn').disabled = false;
}

// v310+: autosave con debounce 900ms. Se guarda solo al terminar de
// escribir sin tocar mas por un momento. Modelo: el pending change se
// almacena por (mes) con `byFamily` map dentro. Al guardar, se lee el
// estado completo de los 3 inputs de la fila (para no perder los
// otros valores que no se tocaron en este pending).
const _tgtAutosaveTimers = {};
function onTgtInputChange(input) {
  const m = parseInt(input.dataset.month, 10);
  const familia = input.dataset.familia;
  const id = targetDocId(tgtSelectedVendor, tgtSelectedYear, m);
  const val = input.value.trim();
  // Merge: preservar cambios de otras familias del mismo mes.
  if (!tgtPendingChanges[id]) tgtPendingChanges[id] = { monthIdx: m, byFamily: {} };
  tgtPendingChanges[id].byFamily[familia] = val;
  input.classList.toggle('changed', true);
  // Actualizar total en vivo (leyendo TODOS los inputs del mes, no solo
  // el que se toco). Feedback inmediato mientras el debounce corre.
  _tgtUpdateRowTotal(m);
  // Cancelar timer previo si el usuario sigue escribiendo.
  if (_tgtAutosaveTimers[id]) clearTimeout(_tgtAutosaveTimers[id]);
  _tgtAutosaveTimers[id] = setTimeout(() => {
    delete _tgtAutosaveTimers[id];
    _saveTargetFor(id, m);
  }, 900);
}

// v310+: recalcula la celda "Total mes" leyendo los 3 inputs de la fila.
function _tgtUpdateRowTotal(monthIdx) {
  const cell = document.getElementById('tgt-total-' + monthIdx);
  if (!cell) return;
  let total = 0;
  TARGET_FAMILIES.forEach((f) => {
    const el = document.querySelector(
      '.tgt-input[data-month="' + monthIdx + '"][data-familia="' + f + '"]'
    );
    if (!el) return;
    const v = parseFloat((el.value || '').trim());
    if (!Number.isNaN(v) && v > 0) total += v;
  });
  cell.textContent = total > 0 ? '$' + total.toLocaleString('es-AR') : '-';
}

// v310+: guarda un solo target (mes+vendedor). Lee el estado COMPLETO
// de los 3 inputs de la fila (Reel/Canas/Lineas), arma targetByFamily,
// calcula targetArs = suma. Doc queda con ambos campos para retro-compat.
async function _saveTargetFor(id, monthIdx) {
  const ch = tgtPendingChanges[id];
  if (!ch) return;
  const rowInputs = TARGET_FAMILIES.map((f) => ({
    familia: f,
    el: document.querySelector(
      '.tgt-input[data-month="' + monthIdx + '"][data-familia="' + f + '"]'
    ),
  }));
  const byFamily = {};
  let total = 0;
  let alguna = false;
  let invalido = null;
  rowInputs.forEach(({ familia, el }) => {
    if (!el) return;
    const raw = (el.value || '').trim();
    if (raw === '') return; // familia sin cargar
    const num = parseFloat(raw);
    if (Number.isNaN(num) || num < 0) {
      invalido = familia;
      return;
    }
    byFamily[familia] = Math.round(num);
    total += Math.round(num);
    alguna = true;
  });
  if (invalido) {
    alert('Valor invalido en ' + invalido + '. Cargar un numero >= 0.');
    return;
  }
  // Marcar los 3 inputs de la fila como saving.
  rowInputs.forEach(({ el }) => {
    if (el) el.classList.add('saving');
  });
  try {
    if (!alguna) {
      // Todas las familias vacias = borrar el doc.
      await fbDb
        .collection('targets')
        .doc(id)
        .delete()
        .catch(() => {});
    } else {
      await fbDb
        .collection('targets')
        .doc(id)
        .set(
          {
            sellerId: tgtSelectedVendor,
            year: tgtSelectedYear,
            month: monthIdx,
            targetArs: total, // suma calculada, para retro-compat con v_targets y PBI
            targetByFamily: byFamily, // v310+: desglose por familia
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: currentUser.uid,
            updatedByEmail: currentUser.email || '',
          },
          { merge: true }
        );
    }
    delete tgtPendingChanges[id];
    rowInputs.forEach(({ el }) => {
      if (!el) return;
      el.classList.remove('changed', 'saving');
      el.classList.add('saved');
      setTimeout(() => {
        el.classList.remove('saved');
      }, 1200);
    });
    showSyncTag('Target guardado ($' + total.toLocaleString('es-AR') + ')');
  } catch (e) {
    console.error('_saveTargetFor', id, e);
    rowInputs.forEach(({ el }) => {
      if (el) el.classList.remove('saving');
    });
    alert('Error guardando target: ' + (e.message || e));
  }
}

async function saveTargets() {
  if (!canManageTargets()) {
    alert('No tenes permisos.');
    return;
  }
  // v310+: reescrito para usar _saveTargetFor (que maneja targetByFamily).
  // Flush inmediato de todos los pendientes.
  const pendingIds = Object.keys(tgtPendingChanges);
  if (!pendingIds.length) {
    alert('No hay cambios para guardar.');
    return;
  }
  const btn = document.getElementById('tgt-save-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  // Cancelar debounces en curso para no dispararlos despues.
  pendingIds.forEach((id) => {
    if (_tgtAutosaveTimers[id]) {
      clearTimeout(_tgtAutosaveTimers[id]);
      delete _tgtAutosaveTimers[id];
    }
  });
  let ok = 0;
  for (const id of pendingIds) {
    const ch = tgtPendingChanges[id];
    const monthIdx = ch ? ch.monthIdx : null;
    if (monthIdx == null) continue;
    try {
      await _saveTargetFor(id, monthIdx);
      ok++;
    } catch (e) {
      console.error('saveTargets legacy loop', id, e);
    }
  }
  logOp('actualizar_targets', 'targets', tgtSelectedVendor + ' ' + tgtSelectedYear, {
    changes: pendingIds.length,
    ok,
  });
  btn.textContent = ok + ' guardados';
  setTimeout(() => {
    btn.textContent = 'Guardar Targets';
    btn.disabled = false;
  }, 1200);
}

// v296+ Export Excel de targets en formato largo para SAP / Power BI.
// Estructura: una fila por (vendedor, ano, mes) con target asignado.
// Columnas: SlpCode | Vendedor | Ano | Mes | Meta.
// - SlpCode: se resuelve via sapGetSlpCodeForVendor(vendorKey) desde sap_vendors.
//   Si no esta cargado en sap_vendors, queda vacio y admin lo completa en Excel.
// - Vendedor: prefiere slpName de sap_vendors (formato SAP "Gonzalo de la Rosa").
//   Fallback a titleCase(vendorKey) si no esta en el cache.
// - Mes: numero 1-12 (NO 0-11) para que sea legible en el Excel.
// - Meta: number (parseFloat de targetArs). Excel formatea como entero.
function exportTargetsExcel() {
  if (!canManageTargets()) {
    alert('No tenes permisos.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('SheetJS no cargado. Recarga la pagina.');
    return;
  }
  // Helper: nombre del vendedor con formato SAP si esta en sap_vendors,
  // sino titleCase(vendorKey) como fallback.
  function getVendorDisplayName(vendorKey) {
    if (!vendorKey) return '';
    if (typeof sapVendorsCache !== 'undefined') {
      for (const v of sapVendorsCache.values()) {
        if ((v.vendorKey || '').toLowerCase() === vendorKey.toLowerCase()) {
          if (v.slpName) return v.slpName;
        }
      }
    }
    return titleCase(vendorKey);
  }
  // Recolectar todas las filas: (vendorKey, year, month) -> targetArs
  const rows = [];
  targetsCache.forEach((t) => {
    if (!t) return;
    const raw = t.targetArs;
    const num = parseFloat(raw);
    if (Number.isNaN(num) || num <= 0) return; // skip meses sin cargar o valor 0
    const vendorKey = t.sellerId || '';
    if (!vendorKey) return;
    const year = parseInt(t.year, 10);
    const monthIdx = parseInt(t.month, 10); // 0-11 en Firestore
    if (Number.isNaN(year) || Number.isNaN(monthIdx)) return;
    rows.push({
      SlpCode:
        typeof sapGetSlpCodeForVendor === 'function' ? sapGetSlpCodeForVendor(vendorKey) || '' : '',
      Vendedor: getVendorDisplayName(vendorKey),
      Año: year,
      Mes: monthIdx + 1, // 1-12 para el Excel (mas legible)
      Meta: Math.round(num),
    });
  });
  if (!rows.length) {
    alert('No hay targets cargados para exportar.');
    return;
  }
  // Orden: SlpCode asc -> Vendedor -> Ano -> Mes.
  rows.sort((a, b) => {
    const sa = (a.SlpCode || '').toString().padStart(6, '0');
    const sb = (b.SlpCode || '').toString().padStart(6, '0');
    if (sa !== sb) return sa.localeCompare(sb);
    if (a.Vendedor !== b.Vendedor) return a.Vendedor.localeCompare(b.Vendedor);
    if (a.Año !== b.Año) return a.Año - b.Año;
    return a.Mes - b.Mes;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['SlpCode', 'Vendedor', 'Año', 'Mes', 'Meta'],
  });
  // Anchos de columna razonables.
  ws['!cols'] = [
    { wch: 10 }, // SlpCode
    { wch: 26 }, // Vendedor
    { wch: 8 }, // Año
    { wch: 6 }, // Mes
    { wch: 16 }, // Meta
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Targets');
  const ts = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Targets_Shimano_' + ts + '.xlsx');
  showSyncTag('Excel exportado (' + rows.length + ' filas)');
}

// === Exponer al window ===
// El bundle IIFE ejecuta antes que el inline. Las funciones se registran en
// window y el inline las llama sin prefix (JS resuelve implícitamente).
// HTML onclick=""" también resuelve a window.foo.
window.getMonthlyTargetArs = getMonthlyTargetArs;
window.getCumulativeTargetArs = getCumulativeTargetArs;
window.ensureTargetsListener = ensureTargetsListener;
window.canManageTargets = canManageTargets;
window.openTargetsPanel = openTargetsPanel;
window.closeTargetsPanel = closeTargetsPanel;
window.onTgtInputChange = onTgtInputChange;
window.saveTargets = saveTargets;
window.exportTargetsExcel = exportTargetsExcel;
// Helpers privados también expuestos por si algún día tests unitarios los cubren:
window.tgtNormKey = tgtNormKey;
window.targetDocId = targetDocId;
// renderTargetsTable es usada internamente (ensureTargetsListener re-renderea si el modal está abierto).
window.renderTargetsTable = renderTargetsTable;
