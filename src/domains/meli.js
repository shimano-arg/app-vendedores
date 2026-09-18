// @ts-nocheck
// MERCADOLIBRE (v>=997, 2026-09-18). Seccion Mariano-only.
// Ver docs/specs/2026-09-18-mercadolibre-crm-section-design.md.
// Globals leidos: fbDb, firebase, currentUser, escapeHtml (declarados en inline).

// ============================================================
// Funciones puras (testables sin DOM)
// ============================================================

export function formatSnapshotAge(date, nowRef = new Date()) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';
  const diffMs = nowRef.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `hoy ${hh}:${mm}`;
  }
  if (diffDays === 1) return 'hace 1 día';
  if (diffDays <= 7) return `hace ${diffDays} días`;
  return 'hace más de 7 días';
}

export function sortMapAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];
  return [...alerts].sort((a, b) => a.diferencia_pct - b.diferencia_pct);
}

export function filterProducts(products, { category, search } = {}) {
  if (!Array.isArray(products)) return [];
  const s = (search || '').trim().toLowerCase();
  return products.filter(p => {
    if (category && p.category_name !== category) return false;
    if (s && !(p.name || '').toLowerCase().includes(s)) return false;
    return true;
  });
}

export function getSeverityColor(pct) {
  if (pct <= -10) return 'red';
  if (pct <= -2) return 'amber';
  return 'gray';
}

// ============================================================
// State interno (local al IIFE del chunk, NO cross-scope)
// ============================================================

let _meliCache = null;   // { state, products, categories, alerts }
let _currentSubtab = 'map';

// ============================================================
// API publica (window.*)
// ============================================================

async function openMeliModal() {
  const overlay = document.getElementById('meli-modal');
  if (!overlay) { console.error('[meli] #meli-modal no existe'); return; }
  overlay.style.display = 'flex';
  if (!_meliCache) await loadMeliData();
  renderMeliModal();
}

function closeMeliModal() {
  const overlay = document.getElementById('meli-modal');
  if (overlay) overlay.style.display = 'none';
}

function setMeliSubtab(name) {
  if (!['map', 'products', 'categories'].includes(name)) return;
  _currentSubtab = name;
  renderMeliModal();
}

async function loadMeliData(force = false) {
  if (_meliCache && !force) return _meliCache;
  const db = window.fbDb;
  const [stateSnap, prodSnap, catSnap, alertSnap] = await Promise.all([
    db.collection('meli').doc('state').get(),
    db.collection('meli_products').get(),
    db.collection('meli_categories').get(),
    db.collection('meli_map_alerts').get(),
  ]);
  _meliCache = {
    state: stateSnap.exists ? stateSnap.data() : null,
    products: prodSnap.docs.map(d => d.data()),
    categories: catSnap.docs.map(d => d.data()),
    alerts: alertSnap.docs.map(d => d.data()),
  };
  return _meliCache;
}

function renderMeliModal() {
  const body = document.getElementById('meli-modal-body');
  const header = document.getElementById('meli-modal-header');
  const tabs = document.getElementById('meli-subtabs');
  if (!body || !header || !tabs) return;
  if (!_meliCache) {
    body.textContent = 'Cargando...';
    return;
  }
  _paintHeader(header, _meliCache.state);
  _paintSubtabs(tabs, _meliCache, _currentSubtab);
  if (_currentSubtab === 'map') _paintMapSection(body, _meliCache.alerts);
  else if (_currentSubtab === 'products') _paintProductsSection(body, _meliCache.products);
  else if (_currentSubtab === 'categories') _paintCategoriesSection(body, _meliCache.categories);
}

// Renderers (stubs -- implementación completa en Task E4.3)
function _paintHeader(el, state) {
  el.textContent = state ? `🛒 MERCADOLIBRE · snapshot ${state.snapshot_date}` : '🛒 MERCADOLIBRE · sin data';
}
function _paintSubtabs(el, cache, active) {
  el.textContent = `[${active}] MAP:${cache.alerts.length} · Prods:${cache.products.length} · Cats:${cache.categories.length}`;
}
function _paintMapSection(el, alerts) {
  el.textContent = `MAP alerts: ${alerts.length} (impl completa en Task E4.3)`;
}
function _paintProductsSection(el, products) {
  el.textContent = `Products: ${products.length} (impl completa en Task E4.3)`;
}
function _paintCategoriesSection(el, categories) {
  el.textContent = `Categories: ${categories.length} (impl completa en Task E4.3)`;
}

// Exports a window (build.js registra stubs proxy en el shell)
if (typeof window !== 'undefined') {
  window.openMeliModal = openMeliModal;
  window.closeMeliModal = closeMeliModal;
  window.setMeliSubtab = setMeliSubtab;
}
