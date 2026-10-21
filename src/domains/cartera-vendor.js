// @ts-nocheck
// NOTA: @ts-nocheck intencional. El chunk es heavy DOM + window.* handlers +
// Firestore SDK compat v8. Anotar strictamente cada handler sería ruido sin
// valor — los helpers puros que importamos (../pure/cartera-vendor-filter.js)
// y el core (functions/core/cartera-vendor-core.js) sí tienen @ts-check.
/**
 * cartera-vendor.js (v1283, 2026-10-20) — bundle chunk lazy.
 *
 * Dashboard "Analisis de Cartera por Vendedor". Reemplaza seguimiento.js.
 * Lee cartera_vendor/{vendorKey} Firestore (snapshot nightly 04:00 ART).
 *
 * TODO el DOM render usa createElement + textContent (policy anti-XSS, no innerHTML).
 *
 * Spec: docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md
 * Plan: docs/superpowers/plans/2026-10-20-cartera-vendor-analisis.md
 */

import { applyChipFilter, sortClientes } from '../pure/cartera-vendor-filter.js';

/** @type {Map<string, any>} */
const carteraDocCache = new Map();
/** @type {string|null} */
let selectedVendor = null;
let activeChip = 'todos';
let searchQuery = '';
let sortBy = 'diasSinCompra';
/** @type {'asc'|'desc'} */
let sortDir = 'desc';

const CHIPS = [
  { id: 'todos', label: 'Todos' },
  { id: 'baseActiva90d', label: 'Base activa 90d' },
  { id: 'dormidosVisita30d', label: 'Dormidos visita 30d' },
  { id: 'dormidosCompra90d', label: 'Dormidos compra 90d' },
  { id: 'nuncaVisitados', label: 'Nunca visitados' },
  { id: 'nuncaCompraron', label: 'Nunca compraron' },
];

const KPI_CARDS = [
  { chip: 'todos', label: 'Total cartera', color: '#64748b' },
  { chip: 'baseActiva90d', label: 'Base activa 90d', color: '#16a34a' },
  { chip: 'dormidosVisita30d', label: 'Dormidos vis 30d', color: '#ea580c' },
  { chip: 'dormidosCompra90d', label: 'Dormidos com 90d', color: '#dc2626' },
  { chip: 'nuncaVisitados', label: 'Nunca visitados', color: '#7c3aed' },
  { chip: 'nuncaCompraron', label: 'Nunca compraron', color: '#be185d' },
];

// === Open / close ===
window.openCarteraModal = async function openCarteraModal() {
  const modal = document.getElementById('cartera-modal');
  if (!modal) return;
  modal.classList.add('open');
  await populateVendorDropdown();
};

window.closeCarteraModal = function closeCarteraModal() {
  const modal = document.getElementById('cartera-modal');
  if (modal) modal.classList.remove('open');
};

// === Dropdown de vendors ===
async function populateVendorDropdown() {
  const sel = /** @type {HTMLSelectElement|null} */ (
    document.getElementById('cartera-vendor-select')
  );
  if (!sel) return;
  if (sel.options.length > 1) return;
  try {
    // @ts-expect-error
    const snap = await firebase.firestore().collection('cartera_vendor').get();
    /** @type {string[]} */
    const vendors = [];
    snap.forEach((doc) => vendors.push(doc.id));
    vendors.sort();
    for (const v of vendors) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
  } catch (e) {
    console.error('populateVendorDropdown failed', e);
  }
}

// === On vendor change ===
window.onCarteraVendorChange = async function onCarteraVendorChange() {
  const sel = /** @type {HTMLSelectElement|null} */ (
    document.getElementById('cartera-vendor-select')
  );
  if (!sel) return;
  selectedVendor = sel.value || null;
  activeChip = 'todos';
  searchQuery = '';
  const searchInput = /** @type {HTMLInputElement|null} */ (
    document.getElementById('cartera-search')
  );
  if (searchInput) searchInput.value = '';
  if (!selectedVendor) {
    showEmpty();
    return;
  }
  showLoading();
  try {
    let doc = carteraDocCache.get(selectedVendor);
    if (!doc) {
      // @ts-expect-error
      const snap = await firebase
        .firestore()
        .collection('cartera_vendor')
        .doc(selectedVendor)
        .get();
      if (!snap.exists) {
        showNoData();
        return;
      }
      doc = snap.data();
      carteraDocCache.set(selectedVendor, doc);
    }
    renderDashboard(doc);
  } catch (e) {
    console.error('onCarteraVendorChange failed', e);
    showError(String(e));
  }
};

/** @type {any} */ (window).onCarteraChipClick = function onCarteraChipClick(chipId) {
  activeChip = chipId;
  if (!selectedVendor) return;
  const doc = carteraDocCache.get(selectedVendor);
  if (doc) renderDashboard(doc);
};

/** @type {ReturnType<typeof setTimeout>|null} */
let searchDebounceTimer = null;
window.onCarteraSearchChange = function onCarteraSearchChange() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('cartera-search'));
  if (!input) return;
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = (input.value || '').trim().toLowerCase();
    if (!selectedVendor) return;
    const doc = carteraDocCache.get(selectedVendor);
    if (doc) renderDashboard(doc);
  }, 300);
};

/** @type {any} */ (window).onCarteraSortClick = function onCarteraSortClick(colKey) {
  if (sortBy === colKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else {
    sortBy = colKey;
    sortDir = 'desc';
  }
  if (!selectedVendor) return;
  const doc = carteraDocCache.get(selectedVendor);
  if (doc) renderDashboard(doc);
};

// === Render ===
function renderDashboard(doc) {
  const subtitle = document.getElementById('cartera-subtitle');
  if (subtitle) subtitle.textContent = `${doc.counts.total} clientes en cartera.`;
  const info = document.getElementById('cartera-snapshot-info');
  if (info) {
    info.textContent = `Snapshot ${doc.snapshotDate}`;
    info.style.display = 'inline-flex';
  }
  renderKpis(doc.counts);
  renderChips(doc.counts);
  renderTable(doc.clientes);
  showTable();
}

function renderKpis(counts) {
  const el = document.getElementById('cartera-kpis');
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  // v1383: Apple-style KPI cards. Clases .cartera-kpi definidas en index.html.
  // Color se aplica solo al número + underline (sutil identidad por categoría).
  for (const spec of KPI_CARDS) {
    const card = document.createElement('div');
    card.className = 'cartera-kpi';
    if (activeChip === spec.chip) card.classList.add('active');
    card.style.color = spec.color; // currentColor para el number + ::after underline
    card.addEventListener('click', () => /** @type {any} */ (window).onCarteraChipClick(spec.chip));
    const n = document.createElement('div');
    n.className = 'cartera-kpi-num';
    n.textContent = String(counts[spec.chip === 'todos' ? 'total' : spec.chip]);
    const l = document.createElement('div');
    l.className = 'cartera-kpi-label';
    l.style.color = ''; // reset currentColor para que use el muted del CSS
    l.textContent = spec.label;
    card.appendChild(n);
    card.appendChild(l);
    el.appendChild(card);
  }
}

function renderChips(counts) {
  const el = document.getElementById('cartera-chips');
  if (!el) return;
  const countByChip = {
    todos: counts.total,
    baseActiva90d: counts.baseActiva90d,
    dormidosVisita30d: counts.dormidosVisita30d,
    dormidosCompra90d: counts.dormidosCompra90d,
    nuncaVisitados: counts.nuncaVisitados,
    nuncaCompraron: counts.nuncaCompraron,
  };
  while (el.firstChild) el.removeChild(el.firstChild);
  // v1383: segmented control iOS. Wrapper .cartera-chip-wrap agrupa pills con bg gris.
  const wrap = document.createElement('div');
  wrap.className = 'cartera-chip-wrap';
  for (const chip of CHIPS) {
    const b = document.createElement('button');
    b.className = 'cartera-chip';
    if (activeChip === chip.id) b.classList.add('active');
    b.type = 'button';
    b.textContent = `${chip.label} (${countByChip[chip.id]})`;
    b.addEventListener('click', () => /** @type {any} */ (window).onCarteraChipClick(chip.id));
    wrap.appendChild(b);
  }
  el.appendChild(wrap);
}

/** @param {Array<any>} clientes */
function renderTable(clientes) {
  const table = document.getElementById('cartera-table');
  if (!table) return;
  const filtered = applyChipFilter(clientes, activeChip);
  const searched = searchQuery
    ? filtered.filter((c) =>
        String(c.clientName || '')
          .toLowerCase()
          .includes(searchQuery)
      )
    : filtered;
  const sorted = sortClientes(searched, sortBy, sortDir);
  while (table.firstChild) table.removeChild(table.firstChild);
  table.appendChild(buildThead());
  table.appendChild(buildTbody(sorted));
}

function buildThead() {
  // v1383: Apple-style thead. Clases .cartera-* en index.html controlan bg/colors.
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const headers = [
    { label: 'Cliente', sortKey: 'clientName', align: 'left' },
    { label: 'Prov/Loc', sortKey: null, align: 'left' },
    { label: 'Tipo', sortKey: null, align: 'center' },
    { label: 'Últ. visita', sortKey: 'diasSinVisitaPresencial', align: 'left' },
    { label: 'Últ. contacto', sortKey: 'diasSinContacto', align: 'left' },
    { label: 'Últ. compra', sortKey: 'diasSinCompra', align: 'left' },
    { label: 'Fact 12M', sortKey: 'facturado12M', align: 'right' },
    { label: 'Deuda', sortKey: 'deudaAbierta', align: 'right' },
  ];
  for (const h of headers) {
    const th = document.createElement('th');
    th.style.textAlign = h.align;
    th.textContent = h.label;
    if (h.sortKey) {
      th.style.cursor = 'pointer';
      const key = h.sortKey;
      th.addEventListener('click', () => /** @type {any} */ (window).onCarteraSortClick(key));
    }
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  return thead;
}

/** @param {Array<any>} sortedClientes */
function buildTbody(sortedClientes) {
  const tbody = document.createElement('tbody');
  for (const c of sortedClientes) {
    tbody.appendChild(buildClienteRow(c));
  }
  return tbody;
}

/** @param {any} c */
function buildClienteRow(c) {
  const tr = document.createElement('tr');
  tr.style.cssText = 'cursor:pointer;border-bottom:1px solid var(--border-light)';
  tr.addEventListener('mouseenter', () => {
    tr.style.background = 'var(--bg-hover)';
  });
  tr.addEventListener('mouseleave', () => {
    tr.style.background = '';
  });
  tr.addEventListener('click', () => {
    // @ts-expect-error
    if (typeof window.openFichaCliente === 'function') window.openFichaCliente(c.clientId);
  });

  const tdName = document.createElement('td');
  tdName.style.cssText = 'padding:6px 8px;font-weight:600';
  tdName.textContent = c.clientName || '';
  tr.appendChild(tdName);

  const tdLoc = document.createElement('td');
  tdLoc.style.cssText = 'padding:6px 8px;font-size:12px;color:var(--text-muted)';
  tdLoc.textContent = `${c.provincia || ''}/${c.localidad || ''}`;
  tr.appendChild(tdLoc);

  const tdTipo = document.createElement('td');
  tdTipo.style.cssText = 'padding:6px 8px;text-align:center';
  const tipoBadge = document.createElement('span');
  tipoBadge.style.cssText =
    'padding:2px 6px;border-radius:4px;background:var(--bg-input);font-size:11px;font-weight:700';
  tipoBadge.textContent = c.cliTipo || '-';
  tdTipo.appendChild(tipoBadge);
  tr.appendChild(tdTipo);

  tr.appendChild(buildDateCell(c.ultimaVisitaPresencial, c.diasSinVisitaPresencial, 30));
  tr.appendChild(buildDateCell(c.ultimoContacto, c.diasSinContacto, null));
  tr.appendChild(buildDateCell(c.ultimaCompra, c.diasSinCompra, 90));

  const tdFact = document.createElement('td');
  tdFact.style.cssText = 'padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums';
  tdFact.textContent = fmtMoney(c.facturado12M);
  tr.appendChild(tdFact);

  const tdDeuda = document.createElement('td');
  tdDeuda.style.cssText = `padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;color:${c.deudaAbierta > 0 ? '#dc2626' : 'var(--text-muted)'}`;
  tdDeuda.textContent = fmtMoney(c.deudaAbierta);
  tr.appendChild(tdDeuda);

  return tr;
}

/**
 * @param {string|null} fechaIso
 * @param {number|null} dias
 * @param {number|null} dangerThreshold
 */
function buildDateCell(fechaIso, dias, dangerThreshold) {
  const td = document.createElement('td');
  const isDanger =
    dangerThreshold !== null && dias !== null && dias !== undefined && dias > dangerThreshold;
  td.style.cssText = `padding:6px 8px;color:${isDanger ? '#dc2626' : 'var(--text-primary)'}`;
  if (!fechaIso) {
    td.textContent = '—';
    return td;
  }
  const parts = String(fechaIso).split('-');
  const d = parts[2] || '';
  const m = parts[1] || '';
  td.textContent = `${d}/${m}`;
  const diasEl = document.createElement('small');
  diasEl.style.cssText = 'color:var(--text-muted);margin-left:4px';
  diasEl.textContent = `${dias}d`;
  td.appendChild(diasEl);
  return td;
}

/** @param {number} n */
function fmtMoney(n) {
  if (!n || n === 0) return '-';
  if (n >= 1_000_000) return `$ ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$ ${(n / 1_000).toFixed(0)}k`;
  return `$ ${n}`;
}

// === UI state helpers ===
function hideAll() {
  const ids = [
    'cartera-loading',
    'cartera-table',
    'cartera-kpis',
    'cartera-chips',
    'cartera-empty',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
}
function showEmpty() {
  hideAll();
  const empty = document.getElementById('cartera-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.textContent = 'Elegí un vendedor para ver su cartera.';
  }
}
function showLoading() {
  hideAll();
  const loading = document.getElementById('cartera-loading');
  if (loading) loading.style.display = 'block';
}
function showNoData() {
  hideAll();
  const empty = document.getElementById('cartera-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.textContent =
      'Sin cartera para este vendedor. Verificá assignedVendor en client_master o esperá al próximo snapshot (04:00 ART).';
  }
}
/** @param {string} msg */
function showError(msg) {
  hideAll();
  const empty = document.getElementById('cartera-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.style.color = '#dc2626';
    empty.textContent = `Error cargando cartera: ${msg}`;
  }
}
function showTable() {
  const empty = document.getElementById('cartera-empty');
  if (empty) empty.style.display = 'none';
  const loading = document.getElementById('cartera-loading');
  if (loading) loading.style.display = 'none';
  const table = document.getElementById('cartera-table');
  if (table) table.style.display = 'table';
  // v1383: display vacio = reset al valor del CSS (grid para kpis, flex para chips).
  const kpis = document.getElementById('cartera-kpis');
  if (kpis) kpis.style.display = '';
  const chips = document.getElementById('cartera-chips');
  if (chips) chips.style.display = '';
}

// === Export Excel ===
window.exportCarteraToExcel = async function exportCarteraToExcel() {
  if (!selectedVendor) {
    alert('Elegí un vendedor primero.');
    return;
  }
  const doc = carteraDocCache.get(selectedVendor);
  if (!doc) {
    alert('Sin data cargada.');
    return;
  }
  const filtered = applyChipFilter(doc.clientes, activeChip);
  const searched = searchQuery
    ? filtered.filter((c) =>
        String(c.clientName || '')
          .toLowerCase()
          .includes(searchQuery)
      )
    : filtered;
  const sorted = sortClientes(searched, sortBy, sortDir);

  const chipLabel = (CHIPS.find((c) => c.id === activeChip) || { label: 'Todos' }).label;
  const title = `Cartera de ${selectedVendor} — ${chipLabel} — Snapshot ${doc.snapshotDate}`;

  try {
    if (typeof window.loadExcelJS === 'function') {
      await window.loadExcelJS();
    }
    const ExcelJS = window.ExcelJS;
    if (!ExcelJS) throw new Error('ExcelJS no disponible');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cartera');

    // Fila 1: titulo banda verde Shimano
    ws.mergeCells('A1:L1');
    const titleCell = ws.getCell('A1');
    titleCell.value = title;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22C55E' } };
    titleCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // Fila 2: headers
    const headers = [
      'Cliente',
      'Provincia',
      'Localidad',
      'Tipo',
      'Última visita presencial',
      'Último contacto',
      'Última compra',
      'Fact 12M (ARS)',
      'Deuda abierta (ARS)',
      'Días sin visita',
      'Días sin compra',
      'CardCode SAP',
    ];
    const headerRow = ws.getRow(2);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF074F69' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Filas 3+: data
    sorted.forEach((c, i) => {
      const row = ws.getRow(3 + i);
      row.getCell(1).value = c.clientName || '';
      row.getCell(2).value = c.provincia || '';
      row.getCell(3).value = c.localidad || '';
      row.getCell(4).value = c.cliTipo || '';
      row.getCell(5).value = c.ultimaVisitaPresencial || '';
      row.getCell(6).value = c.ultimoContacto || '';
      row.getCell(7).value = c.ultimaCompra || '';
      row.getCell(8).value = c.facturado12M || 0;
      row.getCell(8).numFmt = '"$"#,##0';
      row.getCell(9).value = c.deudaAbierta || 0;
      row.getCell(9).numFmt = '"$"#,##0';
      row.getCell(10).value = c.diasSinVisitaPresencial;
      row.getCell(11).value = c.diasSinCompra;
      row.getCell(12).value = c.cardCode || '';
    });

    ws.columns.forEach((col, i) => {
      col.width = i === 0 ? 30 : i === 4 || i === 5 || i === 6 ? 18 : 14;
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cartera_${String(selectedVendor).replace(/\s+/g, '_')}_${activeChip}_${doc.snapshotDate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('exportCarteraToExcel failed', e);
    alert('Error exportando: ' + String(e));
  }
};
