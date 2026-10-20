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
    // @ts-ignore
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
      // @ts-ignore
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
  if (info) info.textContent = `Snapshot: ${doc.snapshotDate}`;
  renderKpis(doc.counts);
  renderChips(doc.counts);
  renderTable(doc.clientes);
  showTable();
}

function renderKpis(counts) {
  const el = document.getElementById('cartera-kpis');
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const spec of KPI_CARDS) {
    const card = document.createElement('div');
    const isActive = activeChip === spec.chip;
    card.style.cssText = `padding:10px 14px;border:2px solid ${isActive ? spec.color : 'var(--border-light)'};border-radius:8px;cursor:pointer;background:${isActive ? `${spec.color}15` : 'var(--bg-card)'};min-width:120px;flex:1;max-width:200px`;
    card.addEventListener('click', () => /** @type {any} */ (window).onCarteraChipClick(spec.chip));
    const n = document.createElement('div');
    n.style.cssText = `font-size:22px;font-weight:800;color:${spec.color}`;
    n.textContent = String(counts[spec.chip === 'todos' ? 'total' : spec.chip]);
    const l = document.createElement('div');
    l.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px';
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
  for (const chip of CHIPS) {
    const b = document.createElement('button');
    const isActive = activeChip === chip.id;
    b.style.cssText = `padding:4px 10px;border-radius:999px;border:1px solid ${isActive ? '#1e3a8a' : 'var(--border)'};background:${isActive ? '#1e3a8a' : 'var(--bg-card)'};color:${isActive ? 'white' : 'var(--text-primary)'};font-size:12px;cursor:pointer;font-weight:${isActive ? '700' : '500'}`;
    b.textContent = `${chip.label} (${countByChip[chip.id]})`;
    b.addEventListener('click', () => /** @type {any} */ (window).onCarteraChipClick(chip.id));
    el.appendChild(b);
  }
}

/** @param {Array<any>} clientes */
function renderTable(clientes) {
  const table = document.getElementById('cartera-table');
  if (!table) return;
  const filtered = applyChipFilter(clientes, activeChip);
  const searched = searchQuery
    ? filtered.filter((c) => String(c.clientName || '').toLowerCase().includes(searchQuery))
    : filtered;
  const sorted = sortClientes(searched, sortBy, sortDir);
  while (table.firstChild) table.removeChild(table.firstChild);
  table.appendChild(buildThead());
  table.appendChild(buildTbody(sorted));
}

function buildThead() {
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  tr.style.cssText =
    'position:sticky;top:0;background:var(--bg-card);border-bottom:2px solid var(--border);font-weight:700;font-size:12px;text-align:left';
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
    th.style.padding = '8px';
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
    // @ts-ignore
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
  const ids = ['cartera-loading', 'cartera-table', 'cartera-kpis', 'cartera-chips', 'cartera-empty'];
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
  const kpis = document.getElementById('cartera-kpis');
  if (kpis) kpis.style.display = 'flex';
  const chips = document.getElementById('cartera-chips');
  if (chips) chips.style.display = 'flex';
}

// === Export Excel (stub — Task 12 completa) ===
// @ts-ignore
window.exportCarteraToExcel = function exportCarteraToExcel() {
  alert('Exportar: pendiente de implementación en Task 12.');
};
