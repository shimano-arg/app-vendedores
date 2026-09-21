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
  if (Number.isNaN(d.getTime())) return '—';
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
  return products.filter((p) => {
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

export function sortRanking(rankings) {
  if (!Array.isArray(rankings)) return [];
  return [...rankings].sort((a, b) => {
    // Orden principal: n_violations desc
    const nA = a.n_violations || 0;
    const nB = b.n_violations || 0;
    if (nB !== nA) return nB - nA;
    // Desempate: worst_diff_pct asc (más negativo primero)
    return (a.worst_diff_pct || 0) - (b.worst_diff_pct || 0);
  });
}

// ============================================================
// State interno (local al IIFE del chunk, NO cross-scope)
// ============================================================

let _meliCache = null; // { state, products, categories, alerts }
let _currentSubtab = 'map';

// ============================================================
// API publica (window.*)
// ============================================================

async function openMeliModal() {
  const overlay = document.getElementById('meli-modal');
  if (!overlay) {
    console.error('[meli] #meli-modal no existe');
    return;
  }
  overlay.style.display = 'flex';
  if (!_meliCache) await loadMeliData();
  renderMeliModal();
}

function closeMeliModal() {
  const overlay = document.getElementById('meli-modal');
  if (overlay) overlay.style.display = 'none';
}

function setMeliSubtab(name) {
  if (!['map', 'products', 'categories', 'ranking'].includes(name)) return;
  _currentSubtab = name;
  renderMeliModal();
}

async function loadMeliData(force = false) {
  if (_meliCache && !force) return _meliCache;
  const db = window.fbDb;
  const [stateSnap, prodSnap, catSnap, alertSnap, rankingSnap] = await Promise.all([
    db.collection('meli').doc('state').get(),
    db.collection('meli_products').get(),
    db.collection('meli_categories').get(),
    db.collection('meli_map_alerts').get(),
    db.collection('meli_map_ranking').get(),
  ]);
  _meliCache = {
    state: stateSnap.exists ? stateSnap.data() : null,
    products: prodSnap.docs.map((d) => d.data()),
    categories: catSnap.docs.map((d) => d.data()),
    alerts: alertSnap.docs.map((d) => d.data()),
    ranking: rankingSnap.docs.map((d) => d.data()),
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
  else if (_currentSubtab === 'products') {
    _paintProductsSection(body, _meliCache.products);
    setTimeout(_paintProductsTable, 0);
  } else if (_currentSubtab === 'categories') _paintCategoriesSection(body, _meliCache.categories);
  else if (_currentSubtab === 'ranking') _paintRankingSection(body, _meliCache.ranking || []);
}

// Renderers
// Convención del repo (rendiciones.js, panel-control.js): construir HTML como
// string y asignar por bracket access. Todo string user-supplied se pasa por
// window.escapeHtml() antes de interpolarse (ver funciones de abajo).

function _paintHeader(el, state) {
  const esc = window.escapeHtml || ((s) => String(s));
  if (!state) {
    el.innerHTML =
      '<div style="padding:12px 16px;background:#0f172a;color:#fff">🛒 MERCADOLIBRE · sin data</div>';
    return;
  }
  const syncAt = state.last_sync && state.last_sync.toDate ? state.last_sync.toDate() : null;
  const snapshotDate = esc(state.snapshot_date || '—');
  const ageStr = formatSnapshotAge(syncAt);
  el.innerHTML =
    '<div style="padding:12px 16px;background:linear-gradient(90deg,#0f172a,#1e293b);color:#fff;display:flex;justify-content:space-between;align-items:center">' +
    '<div>' +
    '<div style="font-weight:800;font-size:15px">🛒 MERCADOLIBRE</div>' +
    '<div style="font-size:10px;opacity:0.8;margin-top:2px">Snapshot ' +
    snapshotDate +
    ' · sincronizado ' +
    ageStr +
    '</div>' +
    '</div>' +
    '<div style="cursor:pointer;font-size:16px" onclick="closeMeliModal()">✕</div>' +
    '</div>';
}

function _paintSubtabs(el, cache, active) {
  const pill = (name, label, count) => {
    const isActive = name === active;
    const bg = isActive ? '#FFE600' : '#e5e7eb';
    const color = isActive ? '#0f172a' : '#374151';
    const weight = isActive ? 700 : 400;
    return (
      '<span onclick="setMeliSubtab(\'' +
      name +
      '\')" style="cursor:pointer;padding:6px 12px;background:' +
      bg +
      ';color:' +
      color +
      ';border-radius:6px;font-weight:' +
      weight +
      ';font-size:11px">' +
      label +
      ' <b>' +
      count +
      '</b></span>'
    );
  };
  el.innerHTML =
    '<div style="background:#f9f9f9;padding:8px 16px;display:flex;gap:6px;border-bottom:1px solid #e5e7eb">' +
    pill('map', '🎯 MAP', cache.alerts.length) +
    pill('products', '📦 Productos', cache.products.length) +
    pill('categories', '📊 Categorías', cache.categories.length) +
    pill('ranking', '🏆 Ranking', (cache.ranking || []).length) +
    '</div>';
}

function _paintMapSection(el, alerts) {
  const esc = window.escapeHtml || ((s) => String(s));
  const sorted = sortMapAlerts(alerts);
  const nSellers = new Set(sorted.map((a) => a.seller_nickname)).size;
  const avgPct = sorted.length
    ? (sorted.reduce((sum, a) => sum + a.diferencia_pct, 0) / sorted.length).toFixed(1)
    : '0.0';

  let html = '<div style="padding:14px 16px">';

  html +=
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">' +
    '<div style="background:var(--bg-elevated);border:1.5px solid ' +
    (sorted.length ? '#fecaca' : '#e5e7eb') +
    ';border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Violaciones</div>' +
    '<div style="font-size:26px;font-weight:800;color:' +
    (sorted.length ? '#dc2626' : '#16a34a') +
    '">' +
    sorted.length +
    '</div>' +
    '<div style="font-size:10px;color:var(--text-muted)">snapshot actual</div>' +
    '</div>' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Descuento promedio</div>' +
    '<div style="font-size:26px;font-weight:800">' +
    avgPct +
    '%</div>' +
    '</div>' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Sellers involucrados</div>' +
    '<div style="font-size:26px;font-weight:800">' +
    nSellers +
    '</div>' +
    '</div>' +
    '</div>';

  html +=
    '<input id="meli-map-filter" placeholder="Filtrar por seller..." oninput="window.__meliFilterMapAlerts(this.value)" style="width:100%;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:11px;margin-bottom:8px">';

  html +=
    '<div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">' +
    '<div style="display:grid;grid-template-columns:120px 100px 1.5fr 80px 80px 60px 40px;padding:8px 10px;background:#f3f4f6;font-weight:700;font-size:10px;text-transform:uppercase;color:#64748b">' +
    '<div>Seller</div><div>SKU</div><div>Producto</div><div>Pub</div><div>Sugerido</div><div style="text-align:right">Δ%</div><div></div>' +
    '</div>' +
    '<div id="meli-map-rows">';

  html += sorted
    .map((a) => {
      const sev = getSeverityColor(a.diferencia_pct);
      const bg = sev === 'red' ? '#fef2f2' : sev === 'amber' ? '#fffbeb' : 'transparent';
      const color = sev === 'red' ? '#dc2626' : sev === 'amber' ? '#f59e0b' : '#6b7280';
      return (
        '<div class="meli-alert-row" data-seller="' +
        esc((a.seller_nickname || '').toLowerCase()) +
        '" style="display:grid;grid-template-columns:120px 100px 1.5fr 80px 80px 60px 40px;padding:8px 10px;border-top:1px solid #f3f4f6;background:' +
        bg +
        ';font-size:11px">' +
        '<div>' +
        esc(a.seller_nickname || '—') +
        '</div>' +
        '<div style="font-family:monospace;font-size:10px">' +
        esc(a.sku || '—') +
        '</div>' +
        '<div style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(a.product_name || '') +
        '</div>' +
        '<div>$' +
        Math.round(a.precio_publicado).toLocaleString('es-AR') +
        '</div>' +
        '<div>$' +
        Math.round(a.precio_sugerido).toLocaleString('es-AR') +
        '</div>' +
        '<div style="text-align:right;color:' +
        color +
        ';font-weight:700">' +
        a.diferencia_pct.toFixed(1) +
        '%</div>' +
        '<div style="text-align:center"><a href="' +
        esc(a.ml_url) +
        '" target="_blank" rel="noopener" title="Ver publicación">🔗</a></div>' +
        '</div>'
      );
    })
    .join('');

  html += '</div></div></div>';
  el.innerHTML = html;
}

// Filtro client-side sin re-render — solo esconde rows.
if (typeof window !== 'undefined') {
  window.__meliFilterMapAlerts = function (query) {
    const q = (query || '').trim().toLowerCase();
    document.querySelectorAll('.meli-alert-row').forEach((row) => {
      const seller = row.dataset.seller || '';
      row.style.display = !q || seller.includes(q) ? '' : 'none';
    });
  };
}

function _paintProductsSection(el, products) {
  const esc = window.escapeHtml || ((s) => String(s));
  const totalShim = products.filter((p) => p.is_shimano).length;
  const avgPrice = products.length
    ? Math.round(products.reduce((sum, p) => sum + (p.price_avg || 0), 0) / products.length)
    : 0;
  const totalVisits = products.reduce((sum, p) => sum + (p.visits_7d_sum || 0), 0);
  const cats = [...new Set(products.map((p) => p.category_name).filter(Boolean))].sort();

  let html = '<div style="padding:14px 16px">';

  html +=
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Productos Shimano</div>' +
    '<div style="font-size:26px;font-weight:800">' +
    totalShim +
    '</div>' +
    '</div>' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Precio promedio</div>' +
    '<div style="font-size:26px;font-weight:800">$' +
    avgPrice.toLocaleString('es-AR') +
    '</div>' +
    '</div>' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Visitas 7d totales</div>' +
    '<div style="font-size:26px;font-weight:800">' +
    totalVisits.toLocaleString('es-AR') +
    '</div>' +
    '</div>' +
    '</div>';

  html +=
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
    '<input id="meli-prod-search" placeholder="Buscar producto..." oninput="window.__meliReRenderProducts()" style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:11px">' +
    '<select id="meli-prod-cat" onchange="window.__meliReRenderProducts()" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:11px">' +
    '<option value="">Todas las categorías</option>' +
    cats.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('') +
    '</select>' +
    '</div>';

  html += '<div id="meli-prod-table"></div>';
  html += '</div>';
  el.innerHTML = html;
}

function _paintProductsTable() {
  const cache = _meliCache;
  if (!cache) return;
  const container = document.getElementById('meli-prod-table');
  if (!container) return;
  const esc = window.escapeHtml || ((s) => String(s));
  const searchEl = document.getElementById('meli-prod-search');
  const catEl = document.getElementById('meli-prod-cat');
  const search = searchEl ? searchEl.value : '';
  const category = catEl ? catEl.value : '';
  const filtered = filterProducts(cache.products, { search, category }).sort(
    (a, b) => (b.visits_7d_sum || 0) - (a.visits_7d_sum || 0)
  );

  let html =
    '<div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">';
  html +=
    '<div style="display:grid;grid-template-columns:2fr 1fr 100px 100px 60px 60px 100px;padding:8px 10px;background:#f3f4f6;font-weight:700;font-size:10px;text-transform:uppercase;color:#64748b">' +
    '<div>Producto</div><div>Categoría</div><div>Min</div><div>Avg</div><div>Sellers</div><div>Visitas</div><div>Top seller</div>' +
    '</div>';

  if (filtered.length === 0) {
    html += '<div style="padding:20px;text-align:center;color:#94a3b8">Sin resultados</div>';
  } else {
    html += filtered
      .map((p) => {
        const topSeller = (p.top_sellers && p.top_sellers[0]) || {};
        return (
          '<div style="display:grid;grid-template-columns:2fr 1fr 100px 100px 60px 60px 100px;padding:8px 10px;border-top:1px solid #f3f4f6;font-size:11px">' +
          '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(p.name || '') +
          '</div>' +
          '<div>' +
          esc(p.category_name || '—') +
          '</div>' +
          '<div>$' +
          Math.round(p.price_min || 0).toLocaleString('es-AR') +
          '</div>' +
          '<div>$' +
          Math.round(p.price_avg || 0).toLocaleString('es-AR') +
          '</div>' +
          '<div>' +
          (p.n_sellers_competing || 0) +
          '</div>' +
          '<div>' +
          (p.visits_7d_sum || 0) +
          '</div>' +
          '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(topSeller.nickname || '—') +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }
  html += '</div>';
  container.innerHTML = html;
}

if (typeof window !== 'undefined') {
  window.__meliReRenderProducts = _paintProductsTable;
}

function _paintCategoriesSection(el, categories) {
  const esc = window.escapeHtml || ((s) => String(s));
  const sorted = [...categories].sort((a, b) => (b.n_listings || 0) - (a.n_listings || 0));

  let html =
    '<div style="padding:14px 16px"><div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">';
  html +=
    '<div style="display:grid;grid-template-columns:2fr 60px 60px 1.5fr 100px 100px 60px;padding:8px 10px;background:#f3f4f6;font-weight:700;font-size:10px;text-transform:uppercase;color:#64748b">' +
    '<div>Categoría</div><div>Listings</div><div>Prods</div><div>% Shimano</div><div>Precio min</div><div>Precio avg</div><div>Sellers</div>' +
    '</div>';

  html += sorted
    .map((c) => {
      const pct = c.pct_shimano || 0;
      const barColor = pct > 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#dc2626';
      return (
        '<div style="display:grid;grid-template-columns:2fr 60px 60px 1.5fr 100px 100px 60px;padding:8px 10px;border-top:1px solid #f3f4f6;font-size:11px;align-items:center">' +
        '<div><b>' +
        esc(c.category_name || '—') +
        '</b></div>' +
        '<div>' +
        (c.n_listings || 0) +
        '</div>' +
        '<div>' +
        (c.n_products || 0) +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<div style="flex:1;background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden">' +
        '<div style="width:' +
        pct +
        '%;background:' +
        barColor +
        ';height:100%"></div>' +
        '</div>' +
        '<span style="font-weight:700;color:' +
        barColor +
        ';min-width:40px;text-align:right">' +
        pct.toFixed(1) +
        '%</span>' +
        '</div>' +
        '<div>$' +
        Math.round(c.price_min || 0).toLocaleString('es-AR') +
        '</div>' +
        '<div>$' +
        Math.round(c.price_avg || 0).toLocaleString('es-AR') +
        '</div>' +
        '<div>' +
        (c.n_sellers || 0) +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  html += '</div></div>';
  el.innerHTML = html;
}

function _paintRankingSection(el, ranking) {
  const esc = window.escapeHtml || ((s) => String(s));
  const sorted = sortRanking(ranking);

  // KPI cards: total sellers rankeados, worst offender, activos
  const nSellers = sorted.length;
  const worstOffender = sorted[0] || null;
  const totalActive = sorted.reduce((sum, r) => sum + (r.n_active_violations || 0), 0);

  let html = '<div style="padding:14px 16px">';

  html +=
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Sellers rankeados</div>' +
    '<div style="font-size:26px;font-weight:800">' +
    nSellers +
    '</div>' +
    '<div style="font-size:10px;color:var(--text-muted)">históricamente</div>' +
    '</div>' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Peor infractor</div>' +
    '<div style="font-size:18px;font-weight:800">' +
    esc(worstOffender ? worstOffender.seller_nickname : '—') +
    '</div>' +
    '<div style="font-size:10px;color:var(--text-muted)">' +
    (worstOffender ? worstOffender.n_violations + ' violaciones' : '') +
    '</div>' +
    '</div>' +
    '<div style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:12px">' +
    '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;font-weight:700">Violaciones activas</div>' +
    '<div style="font-size:26px;font-weight:800;color:' +
    (totalActive > 0 ? '#dc2626' : '#16a34a') +
    '">' +
    totalActive +
    '</div>' +
    '<div style="font-size:10px;color:var(--text-muted)">still_violating</div>' +
    '</div>' +
    '</div>';

  if (sorted.length === 0) {
    html +=
      '<div style="padding:40px 20px;text-align:center;color:#94a3b8;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px">🏆 Sin ranking todavía — el primer sync poblará esto</div>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }

  html +=
    '<div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">' +
    '<div style="display:grid;grid-template-columns:150px 60px 60px 60px 1fr 1fr 60px;padding:8px 10px;background:#f3f4f6;font-weight:700;font-size:10px;text-transform:uppercase;color:#64748b;gap:8px">' +
    '<div>Seller</div>' +
    '<div>Prov</div>' +
    '<div style="text-align:center">Total</div>' +
    '<div style="text-align:center">Activas</div>' +
    '<div>Top SKUs</div>' +
    '<div>Top Categorías</div>' +
    '<div style="text-align:right">Peor %</div>' +
    '</div>';

  html += sorted
    .map((r) => {
      const topSkusStr =
        (r.top_skus || [])
          .slice(0, 3)
          .map((s) => esc(s.sku) + ' (' + s.count + ')')
          .join(', ') || '—';
      const topCatsStr =
        (r.top_categories || [])
          .slice(0, 3)
          .map((c) => esc(c.category_name) + ' (' + c.count + ')')
          .join(', ') || '—';
      const worst = (r.worst_diff_pct || 0).toFixed(1);
      const activeColor = (r.n_active_violations || 0) > 0 ? '#dc2626' : '#94a3b8';
      return (
        '<div style="display:grid;grid-template-columns:150px 60px 60px 60px 1fr 1fr 60px;padding:8px 10px;border-top:1px solid #f3f4f6;font-size:11px;gap:8px;align-items:center">' +
        '<div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(r.seller_nickname || '—') +
        '</div>' +
        '<div style="font-size:10px">' +
        esc(r.seller_state || '—') +
        '</div>' +
        '<div style="text-align:center;font-weight:700">' +
        (r.n_violations || 0) +
        '</div>' +
        '<div style="text-align:center;font-weight:700;color:' +
        activeColor +
        '">' +
        (r.n_active_violations || 0) +
        '</div>' +
        '<div style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        topSkusStr +
        '</div>' +
        '<div style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        topCatsStr +
        '</div>' +
        '<div style="text-align:right;font-weight:700;color:#dc2626">' +
        worst +
        '%</div>' +
        '</div>'
      );
    })
    .join('');

  html += '</div>';
  html += '</div>';
  el.innerHTML = html;
}

// Exports a window (build.js registra stubs proxy en el shell)
if (typeof window !== 'undefined') {
  window.openMeliModal = openMeliModal;
  window.closeMeliModal = closeMeliModal;
  window.setMeliSubtab = setMeliSubtab;
}
