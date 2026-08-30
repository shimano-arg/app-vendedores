// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline): fbDb, currentUser,
// userRole, assignedVendor, VENDORS, MESES, PRODUCTS, POINTS, EXCHANGE_RATE,
// confirmed, globalPedidos, visitsCache, titleCase, escapeHtml, escapeAttr,
// pedidoDiscountFactor, getMonthlyTargetArs (bundle: targets), getCumulativeTargetArs
// (bundle: targets), isCampaignApplicableToVendor (bundle: campanias), renderMisCamps
// (inline). Módulo extraído verbatim: tipado real fuera de scope E2.h.
//
// DASHBOARD + campaigns listener + helpers de vendor lookup.
// Extraído verbatim de index.html (fragmentos: líneas 22635-22673 + 25777-26166
// pre-E2.h) como parte de E2.h (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// Cross-scope state:
// - window.campaignsCache: shared con targets/pedidos/otros dominios que leen
//   listado global de campañas activas. Inicializado como [] al load del bundle.
// - window.unsubCampaigns: listener con cleanup en detachFirebaseListeners()
//   (línea 26535 del inline post-E2.c). Bundle asigna window.unsubCampaigns.
// Locals al módulo: dashboardVendorFilter, POINT_TO_VENDOR, fmt* helpers.

// Init cross-scope state (bundle IIFE corre pre-inline, así que garantiza
// que las vars existen en window antes de que el inline las lea).
if (typeof window.campaignsCache === 'undefined') window.campaignsCache = [];
if (typeof window.unsubCampaigns === 'undefined') window.unsubCampaigns = null;
// v367+: cache de sap_snapshot (BQ -> Firestore agregado por vendedor+mes)
// alimenta las cards SAP del dashboard con facturado real SAP (neto de
// credit notes). Actualizado cada 30 min por el cron GH Actions.
if (typeof window.sapSnapshotCache === 'undefined') window.sapSnapshotCache = {};
if (typeof window.unsubSapSnapshot === 'undefined') window.unsubSapSnapshot = null;

// ============================================================
// DASHBOARD + CAMPANAS
// ============================================================

function listenCampaigns() {
  if (window.unsubCampaigns) {
    window.unsubCampaigns();
    window.unsubCampaigns = null;
  }
  window.unsubCampaigns = fbDb.collection('campaigns').onSnapshot(
    (qs) => {
      window.campaignsCache = [];
      qs.forEach((d) => {
        campaignsCache.push(Object.assign({ id: d.id }, d.data()));
      });
      if (document.getElementById('dashboard-modal').classList.contains('open')) renderDashboard();
      const mc = document.getElementById('mis-camps-modal');
      if (mc && mc.classList.contains('open')) renderMisCamps();
    },
    (err) => console.error('campaigns listener', err)
  );
}

// v367+: listener del snapshot BQ -> Firestore. Populado por
// sync_sap_to_bigquery.py:sync_dashboard_snapshot_to_firestore() cada 30 min.
// Docs: sap_snapshot/{VENDOR_NORM}_{YYYY}_{MM} con campos facturadoArsNeto,
// unidadesNeto, ncsArs, facturasCount. Alimenta cards "SAP · Mes en curso"
// y "SAP · Acumulado YTD" del dashboard.
function listenSapSnapshot() {
  if (window.unsubSapSnapshot) {
    window.unsubSapSnapshot();
    window.unsubSapSnapshot = null;
  }
  window.unsubSapSnapshot = fbDb.collection('sap_snapshot').onSnapshot(
    (qs) => {
      window.sapSnapshotCache = {};
      qs.forEach((d) => {
        window.sapSnapshotCache[d.id] = Object.assign({ id: d.id }, d.data());
      });
      if (document.getElementById('dashboard-modal').classList.contains('open')) renderDashboard();
    },
    (err) => console.error('sap_snapshot listener', err)
  );
}
window.listenSapSnapshot = listenSapSnapshot;

// Helper: obtener el doc sap_snapshot de un vendedor para (year, month).
// month es 0-11 (convención JS Date.getMonth()); el doc ID usa 1-12.
function getSapSnapshotFor(vendorKey, year, month) {
  if (!vendorKey || !window.sapSnapshotCache) return null;
  const normKey = vendorKey.replace(/\s+/g, '_').toUpperCase();
  const monthStr = String(month + 1).padStart(2, '0');
  const docId = normKey + '_' + year + '_' + monthStr;
  return window.sapSnapshotCache[docId] || null;
}

// Helper: suma YTD del vendedor (todos los meses del año hasta el mes actual, 0-11 inclusive).
// v580 (2026-08-21): usar importeLineasArsNeto (sin IVA) en vez de
// facturadoArsNeto (con IVA). Bug reportado por Mariano: app mostraba $40.3M
// para Santiago (con IVA) mientras PowerBI mostraba $33.3M (sin IVA). El
// target esta definido sin IVA, entonces el % cumplimiento estaba
// sobreestimado. Coincide 21% de diferencia = IVA.
function _getSapSnapshotYtd(vendorKey, year, monthUpTo) {
  if (!vendorKey || !window.sapSnapshotCache) return null;
  let facturado = 0,
    unidades = 0,
    ncs = 0,
    mesesConDatos = 0;
  for (let m = 0; m <= monthUpTo; m++) {
    const snap = getSapSnapshotFor(vendorKey, year, m);
    if (snap) {
      facturado += Number(snap.importeLineasArsNeto || 0);
      unidades += Number(snap.unidadesNeto || 0);
      ncs += Number(snap.ncsArs || 0);
      mesesConDatos++;
    }
  }
  if (mesesConDatos === 0) return null;
  return { facturadoArsNeto: facturado, unidadesNeto: unidades, ncsArs: ncs, mesesConDatos };
}

function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('es-AR');
}
function _fmtUSD(n) {
  return 'USD ' + Math.round(n).toLocaleString('en-US');
}
function fmtNum(n) {
  return Math.round(n).toLocaleString('es-AR');
}
function _arsToUsd(ars) {
  return EXCHANGE_RATE > 0 ? ars / EXCHANGE_RATE : 0;
}

function _isMyConfirmedKey(_k) {
  if (userRole === 'vendedor') {
    // vendor solo ve sus propios (los pedidos ya estan filtrados por listener, pero por las dudas)
    return true;
  }
  return true;
}

let dashboardVendorFilter = 'ALL';
window.setDashboardVendor = function (v) {
  dashboardVendorFilter = v;
  renderDashboard();
};

// v374+ (2026-08-02): selector de mes. Formato del value: "YYYY-MM"
// (ej: "2026-07") o null/'' para "mes actual". Solo afecta el bloque
// "MES EN CURSO" + card SAP Mes; el bloque ACUMULADO ANUAL queda YTD del
// ano actual siempre. Range del selector: mes actual + 11 anteriores.
let dashboardSelectedMonth = null;
window.setDashboardMonth = function (v) {
  dashboardSelectedMonth = v && v !== 'current' ? v : null;
  renderDashboard();
};
window.openDashboardModal = function () {
  document.getElementById('dashboard-modal').classList.add('open');
  // v538 (2026-08-18): defensivo — activar listener de campania_snapshot al
  // abrir el modal por si la auto-invocacion inicial de ensureListeners()
  // corrio antes de que fbDb/currentUser estuvieran listos. Es idempotente:
  // si ya activo, sale por el guard `if (_unsubCampaniaSnapshot) return`.
  try {
    if (typeof window.ensureCampaniaSnapshotListener === 'function') {
      window.ensureCampaniaSnapshotListener();
    }
  } catch (_e) {}
  // v641: mismo defensivo para dashboard_visuales listener.
  try {
    if (typeof window.ensureDashboardVisualesListener === 'function') {
      window.ensureDashboardVisualesListener();
    }
  } catch (_e) {}
  renderDashboard();
};

window.closeDashboardModal = function () {
  document.getElementById('dashboard-modal').classList.remove('open');
};

function getVendorForKey(orderKeyStr) {
  // key = tipo|prov|locName|clientName
  // v449 (2026-08-11): aplicar vendor_overrides en el lookup. Antes usaba
  // una cache lazy con p.vendor BASE del POINT y JAMAS se invalidaba →
  // tiendas reasignadas via Panel Zonas (scope='loc') o Master Clientes
  // (scope='shop') quedaban devolviendo el vendor original del padron.
  //
  // Impacto del bug: cuando un VDI (Ioannis/Santi) carga un pedido de una
  // tienda que en el CRM tiene override a un VDE, sap-service-layer.js
  // buildQuotationPayload llamaba a getVendorForKey → veia el vendor viejo
  // (o vacio) → caia al fallback p.ownerVendor (el VDI que carga) → SlpCode
  // SAP quedaba con el VDI. Ejemplo real 2026-08-11: Ioannis carga pedido
  // de una tienda reasignada a Gonzalo, SAP recibio SalesPersonCode 52
  // (Ioannis) en vez de 50 (Gonzalo).
  //
  // Fix: usar getEffectiveVendorForClient(p, clientName) que respeta la
  // cascada override scope='shop' > scope='loc' > scope='prov' >
  // PROVINCE_VENDOR_OVERRIDE hardcode > p.vendor base. Es la MISMA cascada
  // que usa el color del mapa y sidebar clients → cero divergencia. Sin
  // cache: cada llamada mira vendorOverrides global (que ya vive en RAM,
  // hidratado por su listener). Cero costo de invalidacion.
  if (typeof POINTS === 'undefined' || !POINTS) return '';
  const parts = orderKeyStr.split('|');
  const prov = parts[1] || '';
  const locName = parts[2] || '';
  const clientName = parts[3] || '';
  const p = POINTS.find((pp) => pp.province === prov && pp.name === locName);
  if (!p) return '';
  if (typeof getEffectiveVendorForClient === 'function') {
    return getEffectiveVendorForClient(p, clientName) || '';
  }
  return p.vendor || '';
}

// v640 (2026-08-26): tabs dashboard. Default 'targets' (contenido historico).
if (typeof window.dashboardTab === 'undefined') window.dashboardTab = 'targets';
window.setDashboardTab = function (t) {
  const valid = new Set(['targets', 'visuales', 'visitas', 'finanzas']);
  window.dashboardTab = valid.has(t) ? t : 'targets';
  // v731: Apple-style segmented control — toggling via classList.active
  // (los estilos viven en .dash-tab-btn / .dash-tab-btn.active, no inline).
  ['targets', 'visuales', 'visitas', 'finanzas'].forEach((k) => {
    const btn = document.getElementById('dash-tab-' + k);
    if (!btn) return;
    btn.classList.toggle('active', k === window.dashboardTab);
  });
  const subt = document.getElementById('dashboard-subt');
  if (subt) {
    const labels = {
      targets: 'Resumen de pedidos confirmados, targets y campanas.',
      visuales: 'Top SKUs vendidos + evolucion de facturacion diaria.',
      visitas: 'Cantidad de visitas y contactados por vendedor.',
      finanzas: 'Panel financiero (en diseno).',
    };
    subt.textContent = labels[window.dashboardTab] || '';
  }
  renderDashboard();
};

window.renderDashboard = function () {
  const el = document.getElementById('dashboard-content');
  if (!currentUser) {
    el.textContent = 'Esperando login...';
    el.className = 'users-wrap no-data';
    return;
  }
  el.className = 'users-wrap';
  // v640: delegar a renderer por tab.
  const tab = window.dashboardTab || 'targets';
  if (tab === 'visuales') {
    renderDashboardVisuales(el);
    return;
  }
  if (tab === 'visitas') {
    renderDashboardVisitas(el);
    return;
  }
  if (tab === 'finanzas') {
    renderDashboardFinanzas(el);
    return;
  }
  // 'targets' = default = contenido historico (todo lo que viene abajo).
  const now = new Date();
  // v374+: mes seleccionado (default = mes actual)
  let selYear = now.getFullYear();
  let selMonthIdx = now.getMonth(); // 0-11
  if (dashboardSelectedMonth && /^\d{4}-\d{2}$/.test(dashboardSelectedMonth)) {
    const parts = dashboardSelectedMonth.split('-');
    selYear = parseInt(parts[0], 10);
    selMonthIdx = parseInt(parts[1], 10) - 1;
  }
  const isCurrentMonth = selYear === now.getFullYear() && selMonthIdx === now.getMonth();
  // ymPrefix filtra el bloque MES (afectado por selector)
  const ymPrefix = selYear + '-' + String(selMonthIdx + 1).padStart(2, '0');
  // yPrefix filtra el bloque ACUMULADO ANUAL (siempre YTD del ano actual, no depende del selector)
  const yPrefix = String(now.getFullYear());
  // Vendor a filtrar (vendedor: forzado al suyo; admin/viewer: dropdown)
  const effectiveVendor = userRole === 'vendedor' ? assignedVendor : dashboardVendorFilter;

  // Stats agregados sobre confirmed (que ya estan filtrados al rol)
  let _monthUnits = 0,
    _monthMoneyArs = 0;
  let _yearUnits = 0,
    _yearMoneyArs = 0;
  // Para los targets del master (convertidos a ARS al renderizar)
  let _julioMoneyArs = 0; // Jul 2026 facturado
  let _semestreMoneyArs = 0; // Jul-Dic 2026
  let _anual2027MoneyArs = 0; // todo 2027
  const productAgg = {};
  const clientAgg = {};

  Object.entries(confirmed).forEach(([key, list]) => {
    const parts = key.split('|');
    const clientName = parts[3];
    const prov = parts[1];
    // Filtro por vendedor (cuando aplique)
    if (effectiveVendor && effectiveVendor !== 'ALL') {
      const kv = getVendorForKey(key);
      if (kv !== effectiveVendor) return;
    }
    (list || []).forEach((c) => {
      const dt = (c.confirmedAt || c.finalizedAt || '').slice(0, 10);
      const inYear = dt.startsWith(yPrefix);
      const inMonth = dt.startsWith(ymPrefix);
      const inJul2026 = dt.startsWith('2026-07');
      const inSemestre = dt >= '2026-07-01' && dt <= '2026-12-31';
      const inAnual2027 = dt >= '2027-01-01' && dt <= '2027-12-31';
      // Factor de descuento del pedido. Convertimos subtotal bruto a neto
      // distribuyendo el % proporcionalmente por linea. Asi la suma por
      // producto / cliente / vendedor refleja la facturacion real
      // (lo que cuenta para targets).
      const factor = pedidoDiscountFactor(c);
      (c.lines || []).forEach((l) => {
        const q = parseFloat(l.qty) || 0;
        const pr = parseFloat(l.precio) || 0;
        const m = q * pr * factor;
        if (inYear) {
          _yearUnits += q;
          _yearMoneyArs += m;
          if (!productAgg[l.code])
            productAgg[l.code] = { qty: 0, money: 0, desc: l.desc || l.code };
          productAgg[l.code].qty += q;
          productAgg[l.code].money += m;
          if (!clientAgg[clientName]) clientAgg[clientName] = { qty: 0, money: 0, prov };
          clientAgg[clientName].qty += q;
          clientAgg[clientName].money += m;
        }
        if (inMonth) {
          _monthUnits += q;
          _monthMoneyArs += m;
        }
        if (inJul2026) _julioMoneyArs += m;
        if (inSemestre) _semestreMoneyArs += m;
        if (inAnual2027) _anual2027MoneyArs += m;
      });
    });
  });

  // Top 5 productos por unidades
  const _topProducts = Object.entries(productAgg)
    .map(([c, d]) => ({ code: c, ...d }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);
  // Top 5 clientes por monto $
  const _topClients = Object.entries(clientAgg)
    .map(([n, d]) => ({ name: n, ...d }))
    .sort((a, b) => b.money - a.money)
    .slice(0, 5);

  // Campañas activas: filtra por aplicabilidad al vendedor activo del dashboard.
  // Si admin/viewer y "Todos" seleccionado, muestra todas. Si filtra por vendedor, aplica el filtro de alcance.
  const todayISO = now.toISOString().slice(0, 10);
  let activeCamps = campaignsCache.filter(
    (c) => !c.archivedManually && c.startDate <= todayISO && c.endDate >= todayISO
  );
  const dashVendor =
    userRole === 'vendedor'
      ? assignedVendor
      : dashboardVendorFilter && dashboardVendorFilter !== 'ALL'
        ? dashboardVendorFilter
        : null;
  if (dashVendor) {
    activeCamps = activeCamps.filter((c) => isCampaignApplicableToVendor(c, dashVendor));
  }

  let html = '';
  // Hello + selector de vendedor para admin/viewer
  const helloName =
    userRole === 'vendedor' && assignedVendor
      ? displayVendorName(assignedVendor)
      : currentUser.displayName || currentUser.email || 'Usuario';
  const scopeLabel =
    userRole === 'admin'
      ? 'Vista admin'
      : userRole === 'viewer'
        ? 'Vista viewer'
        : 'Tus pedidos confirmados';
  html +=
    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px"><b style="color:var(--text-primary)">' +
    escapeHtml(helloName) +
    '</b> &middot; ' +
    scopeLabel +
    '</div>';
  // v376+: interno (VDI) también ve el dropdown, con opciones filtradas a sus
  // VDEs pareja + su propia zona (via getMyAllowedVendorKeys). Sin este fix,
  // Santiago abría el dashboard y no tenía forma de ver la data de Mauricio
  // o Martin — todo aparecía en 0.
  if (userRole === 'admin' || userRole === 'viewer' || userRole === 'interno') {
    // Filtro visible por rol:
    // - admin/viewer: null (ven todos los vendedores).
    // - interno: Set(['MAURICIO GIL', 'MARTIN BOIERO', ...su assignedVendor si tiene]).
    const allowedSet =
      typeof window.getMyAllowedVendorKeys === 'function' ? window.getMyAllowedVendorKeys() : null;
    const visibleVendors = allowedSet ? VENDORS.filter((v) => allowedSet.has(v.key)) : VENDORS;
    const labelAll =
      userRole === 'interno' ? 'Todas mis parejas (sumado)' : 'Todos los vendedores (sumado)';
    html +=
      '<div class="dash-card" style="background:#f0f9ff;border-color:#7dd3fc;padding:10px 12px;margin-bottom:10px">';
    html +=
      '<label style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#075985;display:block;margin-bottom:4px">Filtrar por vendedor</label>';
    html +=
      '<select onchange="setDashboardVendor(this.value)" style="width:100%;padding:7px 10px;border:1.5px solid #7dd3fc;border-radius:5px;font-size:12px;font-weight:600;color:var(--text-primary);outline:none;background:var(--bg-elevated);font-family:inherit">';
    html +=
      '<option value="ALL"' +
      (dashboardVendorFilter === 'ALL' ? ' selected' : '') +
      '>' +
      labelAll +
      '</option>';
    visibleVendors.forEach((v) => {
      html +=
        '<option value="' +
        v.key +
        '"' +
        (dashboardVendorFilter === v.key ? ' selected' : '') +
        '>' +
        v.zone +
        ' - ' +
        titleCase(v.key) +
        '</option>';
    });
    html += '</select></div>';
  }

  // v374+: selector de mes (visible para todos los roles). Rango: mes actual + 11 anteriores.
  html +=
    '<div class="dash-card" style="background:var(--color-warning-bg);border-color:#fcd34d;padding:10px 12px;margin-bottom:10px">';
  html +=
    '<label style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#78350f;display:block;margin-bottom:4px">Mes a mostrar (solo afecta al bloque MES)</label>';
  html +=
    '<select onchange="setDashboardMonth(this.value)" style="width:100%;padding:7px 10px;border:1.5px solid #fcd34d;border-radius:5px;font-size:12px;font-weight:600;color:var(--text-primary);outline:none;background:var(--bg-elevated);font-family:inherit">';
  html +=
    '<option value="current"' +
    (dashboardSelectedMonth == null ? ' selected' : '') +
    '>' +
    MESES[now.getMonth()] +
    ' ' +
    now.getFullYear() +
    ' (mes actual)</option>';
  // Ultimos 11 meses anteriores
  for (let back = 1; back <= 11; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const value = y + '-' + String(m + 1).padStart(2, '0');
    html +=
      '<option value="' +
      value +
      '"' +
      (dashboardSelectedMonth === value ? ' selected' : '') +
      '>' +
      MESES[m] +
      ' ' +
      y +
      '</option>';
  }
  html += '</select></div>';

  // Para el card MES/ACUMULADO precisamos un vendor concreto para buscar su target.
  // Si admin/viewer sin filtrar => no podemos asumir un solo target; mostramos sin target.
  const dashboardVendorForTargets =
    userRole === 'vendedor'
      ? assignedVendor
      : dashboardVendorFilter && dashboardVendorFilter !== 'ALL'
        ? dashboardVendorFilter
        : null;

  // Helper para clase de color de barra
  function tgtBarCls(pct) {
    if (pct >= 100) return 'over';
    if (pct >= 70) return 'high';
    if (pct >= 50) return 'mid';
    return 'low';
  }

  // ============================================================
  // DASHBOARD CONSOLIDADO (solo admin/viewer + filtro ALL)
  // Muestra los 6 vendedores en cards comparables ranking por cumplimiento.
  // Cuando el admin filtra por un vendedor especifico, cae al dashboard tradicional.
  // ============================================================
  if (
    (userRole === 'admin' || userRole === 'viewer') &&
    (!dashboardVendorFilter || dashboardVendorFilter === 'ALL')
  ) {
    const byV = {};
    VENDORS.forEach((v) => {
      byV[v.key] = { money: 0, units: 0, orders: 0, visits: 0 };
    });

    // Pedidos confirmados del mes -> agrupar por vendedor
    Object.entries(confirmed).forEach(([key, list]) => {
      const v = getVendorForKey(key);
      if (!v || !byV[v]) return;
      (list || []).forEach((c) => {
        const dt = (c.confirmedAt || c.finalizedAt || '').slice(0, 10);
        if (!dt.startsWith(ymPrefix)) return;
        byV[v].orders++;
        (c.lines || []).forEach((l) => {
          const q = parseFloat(l.qty) || 0;
          const pr = parseFloat(l.precio) || 0;
          byV[v].units += q;
          byV[v].money += q * pr;
        });
      });
    });

    // Visitas del mes -> agrupar por vendedor (match case-insensitive)
    // v374+: usa mes seleccionado
    const monthLabelUp = MESES[selMonthIdx].toUpperCase();
    (visitsCache || []).forEach((vi) => {
      if (!vi.vendor || !byV[vi.vendor]) return;
      if ((vi.mes || '').toUpperCase() !== monthLabelUp) return;
      if (parseInt(vi.anio, 10) !== selYear) return;
      byV[vi.vendor].visits++;
    });

    // v367+: usar facturado REAL SAP (sap_snapshot) para el ranking cuando esté
    // disponible. `s.money` (pedidos app) sigue como fallback si no hay snapshot.
    // Los vendedores no cargan la mayoría de sus pedidos en la app durante la
    // transición → confiar en SAP como fuente de verdad para el cumplimiento.
    const items = VENDORS.map((v) => {
      const s = byV[v.key];
      // v374+: usa mes seleccionado
      const sapSnap = getSapSnapshotFor(v.key, selYear, selMonthIdx);
      // v580: importeLineasArsNeto (sin IVA) para matchear PowerBI y comparar
      // contra target (que tambien esta sin IVA).
      const facSap = sapSnap ? Number(sapSnap.importeLineasArsNeto || 0) : 0;
      const unidSap = sapSnap ? Number(sapSnap.unidadesNeto || 0) : 0;
      // moneyForRank = SAP si hay snapshot; sino cae a pedidos app.
      const moneyForRank = sapSnap ? facSap : s.money;
      const target = getMonthlyTargetArs(v.key, selYear, selMonthIdx);
      const pct = target != null && target > 0 ? Math.round((moneyForRank / target) * 100) : null;
      return Object.assign(
        {
          key: v.key,
          label: titleCase(v.key),
          zone: v.zone,
          target,
          pct,
          moneySap: facSap,
          unidSap,
          hasSap: !!sapSnap,
        },
        s,
        { moneyForRank }
      );
    });
    items.sort((a, b) => {
      const ap = a.pct == null ? -1 : a.pct;
      const bp = b.pct == null ? -1 : b.pct;
      return bp - ap;
    });

    // Totales del equipo (v367+: teamMoney usa SAP snapshot si esta disponible).
    const teamMoney = items.reduce((s, i) => s + i.moneyForRank, 0);
    const teamOrders = items.reduce((s, i) => s + i.orders, 0);
    const _teamUnits = items.reduce((s, i) => s + (i.hasSap ? i.unidSap : i.units), 0);
    const teamVisits = items.reduce((s, i) => s + i.visits, 0);
    const teamTarget = items.reduce((s, i) => s + (i.target || 0), 0);
    const teamPct = teamTarget > 0 ? Math.round((teamMoney / teamTarget) * 100) : null;
    const targetsAsignados = items.filter((i) => i.target != null && i.target > 0).length;
    const vendorsConSap = items.filter((i) => i.hasSap).length;

    // Resumen del equipo (card destacado)
    html +=
      '<div class="dash-card" style="background:linear-gradient(135deg,#0c4a6e,#0284c7);color:#fff;border:none">';
    html +=
      '<h4 style="color:#fff">Resumen equipo <span class="sub" style="color:#bae6fd">' +
      MESES[selMonthIdx] +
      ' ' +
      selYear +
      (isCurrentMonth ? '' : ' (mes seleccionado)') +
      '</span></h4>';
    html += '<div class="dash-grid">';
    html +=
      '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:#fff">' +
      fmtMoney(teamMoney) +
      '</div><div class="lbl" style="color:#bae6fd">Facturado ARS</div></div>';
    html +=
      '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:#fff">' +
      fmtNum(teamOrders) +
      '</div><div class="lbl" style="color:#bae6fd">Pedidos</div></div>';
    html +=
      '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:#fff">' +
      fmtNum(teamVisits) +
      '</div><div class="lbl" style="color:#bae6fd">Visitas</div></div>';
    if (teamPct != null) {
      const pctColor = teamPct >= 100 ? '#10b981' : teamPct >= 70 ? '#fde047' : '#fca5a5';
      html +=
        '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:' +
        pctColor +
        '">' +
        teamPct +
        '%</div><div class="lbl" style="color:#bae6fd">Cumplimiento</div></div>';
    }
    html += '</div>';
    if (teamTarget > 0) {
      html +=
        '<div style="font-size:11px;color:#bae6fd;margin-top:8px">Target equipo: ' +
        fmtMoney(teamTarget) +
        ' &middot; ' +
        targetsAsignados +
        ' de ' +
        items.length +
        ' vendedores con target asignado &middot; <b style="color:#fff">' +
        vendorsConSap +
        '/' +
        items.length +
        ' con facturado SAP este mes</b></div>';
    } else {
      html +=
        '<div style="font-size:11px;color:#fde047;margin-top:8px;font-weight:600">Ningun vendedor tiene target asignado este mes. Cargá los targets desde el panel <b>Targets</b>.</div>';
    }
    html += '</div>';

    // Ranking de vendedores
    html +=
      '<div class="dash-card"><h4>Ranking de vendedores <span class="sub">Ordenado por cumplimiento</span></h4>';
    items.forEach((it, idx) => {
      const ledColor =
        idx === 0 ? '#10b981' : idx === 1 ? '#0284c7' : idx === 2 ? '#f59e0b' : '#94a3b8';
      const rankLabel = '#' + (idx + 1);
      const isLeader = idx === 0 && it.pct != null && it.pct > 0;
      html +=
        '<div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;margin-bottom:8px;border-left:4px solid ' +
        ledColor +
        '">';
      html +=
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">';
      html +=
        '<div><div style="font-size:9px;font-weight:800;color:' +
        ledColor +
        ';letter-spacing:.5px">' +
        rankLabel +
        (isLeader ? ' &middot; &#127942; LIDER DEL MES' : '') +
        '</div>';
      html +=
        '<div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-top:2px">' +
        it.zone +
        ' &middot; ' +
        escapeHtml(it.label) +
        '</div></div>';
      if (it.pct != null) {
        const pctC = it.pct >= 100 ? '#10b981' : it.pct >= 70 ? '#f59e0b' : '#dc2626';
        html +=
          '<div style="text-align:right;font-size:20px;font-weight:800;color:' +
          pctC +
          '">' +
          it.pct +
          '%</div>';
      } else {
        html +=
          '<div style="font-size:9px;font-weight:700;color:var(--text-muted);background:var(--bg-muted);padding:4px 8px;border-radius:4px;align-self:flex-start">SIN TARGET</div>';
      }
      html += '</div>';
      if (it.target != null && it.target > 0) {
        const pctClamp = Math.min(100, Math.max(0, it.pct));
        html +=
          '<div class="tgt-bar"><div class="tgt-bar-fill ' +
          tgtBarCls(it.pct) +
          '" style="width:' +
          pctClamp +
          '%"></div></div>';
        html +=
          '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);margin-top:3px;font-weight:600"><span>' +
          fmtMoney(it.moneyForRank) +
          ' / ' +
          fmtMoney(it.target) +
          '</span>' +
          (it.hasSap
            ? '<span style="color:#0284c7;font-weight:800">SAP</span>'
            : '<span style="color:var(--text-muted)">pedidos app</span>') +
          '</div>';
      } else {
        html +=
          '<div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-top:2px">Facturado: <b style="color:var(--text-primary)">' +
          fmtMoney(it.moneyForRank) +
          '</b> ' +
          (it.hasSap
            ? '<span style="color:#0284c7;font-size:9px;font-weight:800">SAP</span>'
            : '') +
          '</div>';
      }
      html +=
        '<div style="display:flex;gap:14px;margin-top:6px;font-size:10px;color:var(--text-muted);flex-wrap:wrap">';
      html += '<span><b style="color:var(--text-primary)">' + it.orders + '</b> pedidos app</span>';
      html +=
        '<span><b style="color:var(--text-primary)">' +
        fmtNum(it.hasSap ? it.unidSap : it.units) +
        '</b> uds' +
        (it.hasSap ? ' SAP' : '') +
        '</span>';
      html += '<span><b style="color:var(--text-primary)">' + it.visits + '</b> visitas</span>';
      html += '</div></div>';
    });
    html +=
      '<div style="font-size:10px;color:var(--text-muted);text-align:center;margin-top:8px">Tip: elegí un vendedor en el filtro de arriba para ver su dashboard detallado (target acumulado anual, campañas, etc.)</div>';
    html += '</div>';

    el.innerHTML = html;
    return;
  }

  // === v367+: Card SAP MES EN CURSO — facturado REAL SAP (neto de credit notes) ===
  // Solo se muestra si hay vendedor especifico seleccionado (para no cargar
  // en la vista consolidada admin/viewer que ya tiene su propia UI).
  // La data viene de sap_snapshot que el cron BQ actualiza cada 30 min,
  // consistente con el TABLERO SAR de Power BI.
  if (dashboardVendorForTargets) {
    // v374+: usa mes seleccionado (default = mes actual)
    const sapSnapMes = getSapSnapshotFor(dashboardVendorForTargets, selYear, selMonthIdx);
    const monthTgtArsSap = getMonthlyTargetArs(dashboardVendorForTargets, selYear, selMonthIdx);
    html += '<div class="dash-card" style="border:2px solid #0284c7;background:#f0f9ff">';
    html +=
      '<h4 style="color:#0c4a6e">&#128202; SAP - ' +
      (isCurrentMonth ? 'Mes en curso' : 'Mes de ' + MESES[selMonthIdx]) +
      ' <span class="sub" style="color:#0369a1">' +
      MESES[selMonthIdx] +
      ' ' +
      selYear +
      ' &middot; importe l&iacute;neas SAP sin IVA (matches PowerBI)</span></h4>';
    if (sapSnapMes) {
      // v580: importeLineasArsNeto (sin IVA) para matchear PowerBI.
      const facSap = Number(sapSnapMes.importeLineasArsNeto || 0);
      const unidSap = Number(sapSnapMes.unidadesNeto || 0);
      const ncsSap = Number(sapSnapMes.ncsArs || 0);
      html += '<div class="tgt-grid">';
      html +=
        '<div class="tgt-stat"><div class="num">' +
        fmtNum(unidSap) +
        '</div><div class="lbl">Unidades SAP</div></div>';
      html +=
        '<div class="tgt-stat money"><div class="num">' +
        fmtMoney(facSap) +
        '</div><div class="lbl">Facturado SAP ARS</div></div>';
      if (monthTgtArsSap != null && monthTgtArsSap > 0) {
        html +=
          '<div class="tgt-stat target"><div class="num">' +
          fmtMoney(monthTgtArsSap) +
          '</div><div class="lbl">Target mensual</div></div>';
        const pctSap = Math.round((facSap / monthTgtArsSap) * 100);
        const pctSapClamp = Math.min(100, Math.max(0, pctSap));
        html +=
          '<div class="tgt-stat"><div class="num" style="color:' +
          (pctSap >= 100 ? '#10b981' : pctSap >= 70 ? '#f59e0b' : '#dc2626') +
          '">' +
          pctSap +
          '%</div><div class="lbl">Cumplimiento</div></div>';
        html += '</div>';
        html +=
          '<div class="tgt-bar"><div class="tgt-bar-fill ' +
          tgtBarCls(pctSap) +
          '" style="width:' +
          pctSapClamp +
          '%"></div></div>';
        html +=
          '<div class="tgt-meta"><span>' +
          fmtMoney(facSap) +
          ' / ' +
          fmtMoney(monthTgtArsSap) +
          '</span><span><b>' +
          pctSap +
          '%</b></span></div>';
      } else {
        html += '</div>';
      }
      if (ncsSap < 0) {
        html +=
          '<div style="font-size:11px;color:#78350f;background:var(--color-warning-bg);padding:6px 10px;border-radius:4px;margin-top:6px">Incluye ' +
          sapSnapMes.ncsCount +
          ' nota' +
          (sapSnapMes.ncsCount === 1 ? '' : 's') +
          ' de credito por ' +
          fmtMoney(ncsSap) +
          ' (descontado del facturado bruto).</div>';
      }
    } else {
      html +=
        '<div class="tgt-msg">Sin datos SAP para ' +
        escapeHtml(titleCase(dashboardVendorForTargets)) +
        ' en ' +
        MESES[selMonthIdx] +
        ' ' +
        selYear +
        '.' +
        (isCurrentMonth
          ? ' El cron actualiza sap_snapshot cada 30 min.'
          : ' Verificar que el mes seleccionado tenga facturas SAP.') +
        '</div>';
    }
    html += '</div>';
  }

  // v390.1 (2026-08-04): removida card "Mes en curso · pedidos de la app"
  // (Mariano) — en la transicion Baraldo->venta directa la mayoria de los
  // pedidos van directo a SAP y no via la app, entonces esa card muestra
  // $0 permanentemente y es ruido visual. Se mantienen las cards SAP
  // (que si tienen data real) y las cards de campañas.

  // v537 (2026-08-18): removida card SAP - Acumulado anual (Mariano). Solo
  // quedan SAP - Mes en curso + Campanias activas.
  // v390.1 (2026-08-04): removidas "Acumulado anual · pedidos app" y "Target
  // Jul-Dic segundo semestre" por dar $0 (pedidos van directo a SAP, no app).

  // Campañas activas
  html += '<div class="dash-card">';
  html += '<h4>Campa&ntilde;as activas</h4>';
  if (!activeCamps.length) {
    html +=
      '<div style="font-size:11px;color:var(--text-muted)">No hay campa&ntilde;as activas en este momento.</div>';
  } else {
    activeCamps.forEach((c) => {
      // v532 (2026-08-18): fuente prioritaria = window.CAMPANIA_SNAPSHOT (BQ
      // v_campanias_progreso -> Firestore, refresh cada 15min). Trae facturado
      // REAL SAP con match 1:1 vs Power BI. Fallback: globalPedidos (solo
      // pedidos via app) para campanias creadas post-ultimo sync.
      const snap = window.CAMPANIA_SNAPSHOT ? window.CAMPANIA_SNAPSHOT[c.id] : null;
      let prog = 0;
      let usaSap = false;
      if (snap && (snap.realizadoArs > 0 || snap.realizadoQty > 0)) {
        prog =
          c.targetType === 'money'
            ? Number(snap.realizadoArs || 0)
            : Number(snap.realizadoQty || 0);
        usaSap = true;
      } else {
        // Fallback: pedidos via app (comportamiento pre-v532).
        const passesCampScope = (function () {
          const scope = (c && c.scope) || 'all';
          if (scope === 'all') return null;
          const values = c.scopeValues || [];
          if (scope === 'vendor') {
            const vSet = new Set(values);
            return (p) => vSet.has(getVendorForKey(p.key || ''));
          }
          if (scope === 'province') {
            const pSet = new Set(values);
            return (p) => pSet.has(p.province || '');
          }
          return null;
        })();
        (globalPedidos || []).forEach((p) => {
          if (p.stage !== 'confirmed') return;
          if (passesCampScope && !passesCampScope(p)) return;
          const dt = (p.confirmedAt || '').slice(0, 10);
          if (dt < c.startDate || dt > c.endDate) return;
          (p.lines || []).forEach((l) => {
            let matches;
            if (Array.isArray(c.skus) && c.skus.length) {
              matches = c.skus.includes(l.code);
            } else {
              matches =
                c.filterType === 'familia'
                  ? (c.filterValues || []).includes(l.fam)
                  : c.filterType === 'subfamilia'
                    ? (c.filterValues || []).includes(l.sub)
                    : c.filterType === 'categoria'
                      ? (c.filterValues || []).includes(l.cat)
                      : false;
            }
            if (!matches) return;
            const q = parseFloat(l.qty) || 0;
            const pr = parseFloat(l.precio) || 0;
            if (c.targetType === 'money') prog += q * pr;
            else prog += q;
          });
        });
      }
      const pct = c.targetAmount > 0 ? Math.min(100, Math.round((prog / c.targetAmount) * 100)) : 0;
      const target =
        c.targetType === 'money' ? fmtMoney(c.targetAmount) : fmtNum(c.targetAmount) + ' unid.';
      const progFmt = c.targetType === 'money' ? fmtMoney(prog) : fmtNum(prog) + ' unid.';
      html += '<div class="camp-card">';
      html += '<h5>' + escapeHtml(c.name) + '</h5>';
      let cdesc;
      if (c.familia && c.subfamilia) {
        cdesc =
          escapeHtml(c.familia) +
          ' / <b>' +
          escapeHtml(c.subfamilia) +
          '</b> &middot; ' +
          (Array.isArray(c.skus) ? c.skus.length : 0) +
          ' SKU';
      } else {
        cdesc =
          escapeHtml(c.filterType || '') +
          ': <b>' +
          escapeHtml((c.filterValues || []).join(', ')) +
          '</b>';
      }
      html +=
        '<div class="cm-period">' +
        cdesc +
        ' &middot; del ' +
        c.startDate +
        ' al ' +
        c.endDate +
        '</div>';
      html +=
        '<div class="camp-bar"><div class="camp-bar-fill ' +
        (pct >= 100 ? 'done' : '') +
        '" style="width:' +
        pct +
        '%"></div></div>';
      const badgeSap = usaSap
        ? '<span style="color:#0284c7;font-size:9px;font-weight:800;margin-left:6px">SAP</span>'
        : '<span style="color:var(--text-muted);font-size:9px;font-weight:600;margin-left:6px">pedidos app</span>';
      html +=
        '<div class="camp-meta"><span>' +
        progFmt +
        ' / ' +
        target +
        badgeSap +
        '</span><span>' +
        pct +
        '%</span></div>';
      html += '</div>';
    });
  }
  html += '</div>';

  el.innerHTML = html;
};

// === Exports a window para callers cross-scope ===
// listenCampaigns: llamada desde attachFirebaseListeners() en el inline (línea 26682 pre-E2.h).
// getVendorForKey: llamada desde ~7 lugares del inline (líneas 10787, 21336, 22096, 22167, 22204, 22238, 27150 pre-E2.h).
window.listenCampaigns = listenCampaigns;
window.getVendorForKey = getVendorForKey;

// v640 (2026-08-26): renderers para tabs Visuales, Visitas, Finanzas.
function _dashChartBars(entries, colorHex) {
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px;text-align:center;color:var(--text-muted);font-size:12px';
    empty.textContent = 'Sin datos.';
    return empty;
  }
  const max = entries.reduce((m, e) => Math.max(m, e.value), 0) || 1;
  const clr = colorHex || '#0284a0';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 4px';
  entries.forEach((e) => {
    const pct = Math.round((e.value / max) * 100);
    const row = document.createElement('div');
    row.style.cssText =
      'display:grid;grid-template-columns:200px 1fr 90px;gap:8px;align-items:center;font-size:11.5px';
    const lbl = document.createElement('div');
    lbl.style.cssText =
      'font-weight:700;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    lbl.title = e.label;
    lbl.textContent = e.label;
    const barContainer = document.createElement('div');
    barContainer.style.cssText =
      'background:var(--bg-muted);border-radius:4px;height:20px;overflow:hidden';
    const bar = document.createElement('div');
    bar.style.cssText = 'width:' + pct + '%;height:100%;background:' + clr + ';border-radius:4px';
    barContainer.appendChild(bar);
    const val = document.createElement('div');
    val.style.cssText = 'text-align:right;font-weight:800;color:var(--text-primary)';
    val.textContent =
      e.valueLabel != null ? e.valueLabel : Math.round(e.value).toLocaleString('es-AR');
    row.appendChild(lbl);
    row.appendChild(barContainer);
    row.appendChild(val);
    wrap.appendChild(row);
  });
  return wrap;
}

function _dashSectionTitle(text, color) {
  const h = document.createElement('h4');
  h.style.cssText =
    'margin:0 0 10px 0;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:' +
    (color || '#0284a0');
  h.textContent = text;
  return h;
}

function _dashInfo(text, color) {
  const d = document.createElement('div');
  d.style.cssText = 'font-size:11px;color:' + (color || '#64748b') + ';margin-bottom:14px';
  d.textContent = text;
  return d;
}

function renderDashboardVisuales(el) {
  el.textContent = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:16px 22px';
  const dv = typeof window.DASHBOARD_VISUALES === 'object' ? window.DASHBOARD_VISUALES : null;
  if (!dv) {
    // v684 FIX (2026-08-27): en vez de mostrar solo el mensaje "Aun no hay
    // data...", intentamos primero un fetch directo del doc (el listener puede
    // no haber corrido aun o ser reciente). Si el fetch trae data, seteamos
    // window.DASHBOARD_VISUALES y re-renderamos.
    const info = document.createElement('div');
    info.style.cssText =
      'text-align:center;padding:30px;color:var(--text-muted);font-size:12px;background:var(--bg-secondary);border:1px dashed var(--border-default);border-radius:6px';
    info.textContent = 'Cargando visuales...';
    wrap.appendChild(info);
    el.appendChild(wrap);
    // Fetch defensivo: leer el doc directo (bypass del listener que puede no
    // haber corrido). Si trae data, seteamos y re-renderamos.
    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb
        .collection('dashboard_visuales')
        .doc('global')
        .get()
        .then((snap) => {
          if (snap && snap.exists) {
            window.DASHBOARD_VISUALES = snap.data();
            renderDashboardVisuales(el); // re-render
          } else {
            info.textContent =
              'Aun no hay data de visuales. El sync SAP -> BigQuery corre cada 30 min y popula la coleccion dashboard_visuales.';
          }
        })
        .catch((err) => {
          console.warn('[dashboard-visuales] fetch fail', err);
          info.textContent =
            'Error cargando visuales: ' + (err.message || err) + '. Revisa la consola.';
        });
    }
    // Tambien re-activar el listener por si acaso
    try {
      if (typeof window.ensureDashboardVisualesListener === 'function') {
        window.ensureDashboardVisualesListener();
      }
    } catch (_e) {}
    return;
  }
  const topSkus = Array.isArray(dv.topSkus) ? dv.topSkus : [];
  const skuEntries = topSkus.slice(0, 20).map((s) => ({
    label: (s.nombre || s.sku || '').slice(0, 60),
    value: Number(s.cantidad) || 0,
  }));
  wrap.appendChild(
    _dashSectionTitle('Top SKUs mas vendidos (unidades, ' + (dv.mesLabel || 'mes actual') + ')')
  );
  wrap.appendChild(_dashChartBars(skuEntries, '#0284a0'));
  const daily = Array.isArray(dv.facturacionDiaria) ? dv.facturacionDiaria : [];
  const spacer = document.createElement('div');
  spacer.style.cssText = 'height:24px';
  wrap.appendChild(spacer);
  wrap.appendChild(
    _dashSectionTitle('Facturacion Acumulada (' + (dv.mesLabel || 'mes actual') + ')', '#0284a0')
  );
  if (!daily.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px;text-align:center;color:var(--text-muted);font-size:12px';
    empty.textContent = 'Sin datos diarios.';
    wrap.appendChild(empty);
  } else {
    const w = 800,
      h = 260,
      padL = 60,
      padR = 20,
      padT = 20,
      padB = 40;
    const innerW = w - padL - padR,
      innerH = h - padT - padB;
    const maxY = daily.reduce((m, d) => Math.max(m, Number(d.importeAcumulado) || 0), 0) || 1;
    const pts = daily.map((d, i) => {
      const x = padL + (i / Math.max(daily.length - 1, 1)) * innerW;
      const y = padT + innerH - ((Number(d.importeAcumulado) || 0) / maxY) * innerH;
      return { x, y, fecha: d.fecha, val: Number(d.importeAcumulado) || 0 };
    });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', '100%');
    svg.style.background = '#f8fafc';
    svg.style.border = '1px solid #e2e8f0';
    svg.style.borderRadius = '6px';
    for (let g = 0; g <= 5; g++) {
      const yg = padT + (g / 5) * innerH;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', padL);
      line.setAttribute('x2', w - padR);
      line.setAttribute('y1', yg);
      line.setAttribute('y2', yg);
      line.setAttribute('stroke', '#e2e8f0');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
      const val = maxY * (1 - g / 5);
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', padL - 6);
      txt.setAttribute('y', yg + 4);
      txt.setAttribute('text-anchor', 'end');
      txt.setAttribute('font-size', '9');
      txt.setAttribute('fill', '#64748b');
      txt.textContent = '$' + Math.round(val / 1000).toLocaleString('es-AR') + 'k';
      svg.appendChild(txt);
    }
    const pathD = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('stroke', '#0284a0');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
    pts.forEach((p) => {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', p.x);
      c.setAttribute('cy', p.y);
      c.setAttribute('r', '3');
      c.setAttribute('fill', '#0284a0');
      const tit = document.createElementNS(svgNS, 'title');
      tit.textContent = p.fecha + ': $' + Math.round(p.val).toLocaleString('es-AR');
      c.appendChild(tit);
      svg.appendChild(c);
    });
    pts.forEach((p, i) => {
      if (i % Math.max(Math.floor(pts.length / 6), 1) !== 0 && i !== pts.length - 1) return;
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', p.x);
      txt.setAttribute('y', h - padB + 14);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '9');
      txt.setAttribute('fill', '#64748b');
      txt.textContent = (p.fecha || '').slice(5);
      svg.appendChild(txt);
    });
    wrap.appendChild(svg);
    const totalDiv = document.createElement('div');
    totalDiv.style.cssText =
      'font-size:11px;color:var(--text-muted);margin-top:8px;text-align:right';
    const last = pts[pts.length - 1];
    totalDiv.textContent = 'Total acumulado: $' + Math.round(last.val).toLocaleString('es-AR');
    wrap.appendChild(totalDiv);
  }
  el.appendChild(wrap);
}

function renderDashboardVisitas(el) {
  el.textContent = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:16px 22px';
  // v729 FIX: lazy-init del listener de visits. El listener "canonico" vive
  // en visitas.js:openVisitaModal pero solo se dispara si el user abrio el
  // modal antes; sin eso, visitsCache queda vacio y este tab se ve
  // permanentemente sin data. Aca lo attacheamos idempotente + re-render
  // del tab cuando llega la primera snapshot.
  let _justAttachedVisits = false;
  if (
    (typeof window.unsubVisits === 'undefined' || window.unsubVisits === null) &&
    typeof currentUser !== 'undefined' &&
    currentUser &&
    typeof fbDb !== 'undefined' &&
    fbDb
  ) {
    _justAttachedVisits = true;
    let q;
    if (userRole === 'admin' || userRole === 'viewer' || userRole === 'gerente') {
      q = fbDb.collection('visits');
    } else {
      q = fbDb.collection('visits').where('ownerUid', '==', currentUser.uid);
    }
    window.unsubVisits = q.onSnapshot(
      (qs) => {
        window.visitsCache = [];
        qs.forEach((d) => window.visitsCache.push(Object.assign({ id: d.id }, d.data())));
        if (window.dashboardTab === 'visitas') {
          const cont = document.getElementById('dashboard-content');
          if (cont) renderDashboardVisitas(cont);
        }
        const listPane = document.getElementById('visita-pane-list');
        if (
          listPane &&
          listPane.style.display !== 'none' &&
          typeof window.renderVisitasList === 'function'
        ) {
          window.renderVisitasList();
        }
      },
      (err) => console.error('[dashboard-visitas] visits listener', err)
    );
  }
  const visits =
    typeof visitsCache !== 'undefined' && Array.isArray(visitsCache) ? visitsCache : [];
  if (_justAttachedVisits && visits.length === 0) {
    const loading = document.createElement('div');
    loading.style.cssText =
      'text-align:center;padding:20px;color:var(--text-muted);font-size:12px;background:var(--bg-secondary);border:1px dashed var(--border-default);border-radius:6px;margin-bottom:12px';
    loading.textContent = 'Cargando visitas...';
    wrap.appendChild(loading);
    el.appendChild(wrap);
    return;
  }
  const now = new Date();
  const ym =
    typeof dashboardSelectedMonth === 'string' && /^\d{4}-\d{2}$/.test(dashboardSelectedMonth)
      ? dashboardSelectedMonth
      : now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const byVendor = {};
  const byVendorContactados = {};
  for (const v of visits) {
    if (!v) continue;
    // v684 FIX (2026-08-27): las visits reales tienen campo `fecha` (YYYY-MM-DD)
    // y `createdAt` (timestamp), NO `ts` ni `at` como asumia el codigo anterior.
    // El campo `interactionType === 'contacto'` marca contactos no presenciales
    // (vs 'visita' o undefined = visita presencial default).
    let fecha = '';
    if (typeof v.fecha === 'string' && v.fecha.length >= 10) {
      fecha = v.fecha.slice(0, 10);
    } else if (v.createdAt && typeof v.createdAt.toDate === 'function') {
      const d = v.createdAt.toDate();
      fecha = d.toISOString().slice(0, 10);
    } else if (typeof v.createdAt === 'string') {
      fecha = v.createdAt.slice(0, 10);
    } else if (v.ts && typeof v.ts.toDate === 'function') {
      fecha = v.ts.toDate().toISOString().slice(0, 10);
    } else if (typeof v.ts === 'string') {
      fecha = v.ts.slice(0, 10);
    } else if (typeof v.at === 'string') {
      fecha = v.at.slice(0, 10);
    }
    if (!fecha.startsWith(ym)) continue;
    const vendor = (v.vendor || v.assignedVendor || v.ownerVendor || '(sin vendedor)').toString();
    byVendor[vendor] = (byVendor[vendor] || 0) + 1;
    // Contactado no presencial: interactionType === 'contacto'
    if (v.interactionType === 'contacto' || v.contacted || v.contactado) {
      byVendorContactados[vendor] = (byVendorContactados[vendor] || 0) + 1;
    }
  }
  const vendors = Object.keys(byVendor).sort((a, b) => (byVendor[b] || 0) - (byVendor[a] || 0));
  const totalVisitas = Object.values(byVendor).reduce((s, v) => s + v, 0);
  const totalContactados = Object.values(byVendorContactados).reduce((s, v) => s + v, 0);
  wrap.appendChild(
    _dashInfo(
      'Mes: ' +
        ym +
        '  ·  ' +
        vendors.length +
        ' vendedores  ·  ' +
        totalVisitas +
        ' visitas  ·  ' +
        totalContactados +
        ' contactados'
    )
  );
  wrap.appendChild(_dashSectionTitle('Visitas por vendedor'));
  wrap.appendChild(
    _dashChartBars(
      vendors.map((v) => ({ label: v, value: byVendor[v] })),
      '#0284a0'
    )
  );
  const spacer = document.createElement('div');
  spacer.style.cssText = 'height:24px';
  wrap.appendChild(spacer);
  wrap.appendChild(_dashSectionTitle('Contactados por vendedor', '#166534'));
  wrap.appendChild(
    _dashChartBars(
      vendors.map((v) => ({ label: v, value: byVendorContactados[v] || 0 })),
      '#22c55e'
    )
  );
  el.appendChild(wrap);
}

function renderDashboardFinanzas(el) {
  el.textContent = '';
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'padding:30px;text-align:center;color:var(--text-muted);background:var(--bg-secondary);border:1px dashed var(--border-default);border-radius:6px;margin:16px 22px';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:800;color:#0c4a6e;margin-bottom:8px';
  title.textContent = 'Panel Finanzas';
  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:11px';
  msg.textContent = 'Diseno pendiente. Contarme que metricas queres ver y las armo.';
  wrap.appendChild(title);
  wrap.appendChild(msg);
  el.appendChild(wrap);
}
