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

// ============================================================
// DASHBOARD + CAMPANAS
// ============================================================

function listenCampaigns(){
  if (window.unsubCampaigns) { window.unsubCampaigns(); window.unsubCampaigns = null; }
  window.unsubCampaigns = fbDb.collection('campaigns').onSnapshot(qs => {
    window.campaignsCache = [];
    qs.forEach(d => campaignsCache.push(Object.assign({id: d.id}, d.data())));
    if (document.getElementById('dashboard-modal').classList.contains('open')) renderDashboard();
    const mc = document.getElementById('mis-camps-modal');
    if (mc && mc.classList.contains('open')) renderMisCamps();
  }, err => console.error('campaigns listener', err));
}

function fmtMoney(n){ return '$' + Math.round(n).toLocaleString('es-AR'); }
function fmtUSD(n){ return 'USD ' + Math.round(n).toLocaleString('en-US'); }
function fmtNum(n){ return Math.round(n).toLocaleString('es-AR'); }
function arsToUsd(ars){ return EXCHANGE_RATE > 0 ? ars / EXCHANGE_RATE : 0; }

function isMyConfirmedKey(k){
  if (userRole === 'vendedor') {
    // vendor solo ve sus propios (los pedidos ya estan filtrados por listener, pero por las dudas)
    return true;
  }
  return true;
}

let dashboardVendorFilter = 'ALL';
window.setDashboardVendor = function(v){
  dashboardVendorFilter = v;
  renderDashboard();
};
window.openDashboardModal = function(){
  document.getElementById('dashboard-modal').classList.add('open');
  renderDashboard();
};

window.closeDashboardModal = function(){
  document.getElementById('dashboard-modal').classList.remove('open');
};

// Indice rapido (province, locName) -> vendor key
// E2.h fix: pre-extracción el IIFE corría dentro del inline (línea 25782)
// cuando POINTS ya existía (declarado en línea 3417 inline). Post-extracción
// el bundle IIFE corre ANTES del inline → POINTS aún es undefined. Cambio a
// lazy init: se construye la primera vez que getVendorForKey() se llama.
let _pointToVendor = null;
function getPointToVendorMap(){
  if (!_pointToVendor) {
    _pointToVendor = {};
    POINTS.forEach(p => { _pointToVendor[p.province + '|' + p.name] = p.vendor || ''; });
  }
  return _pointToVendor;
}

function getVendorForKey(orderKeyStr){
  // key = tipo|prov|locName|clientName
  const parts = orderKeyStr.split('|');
  return getPointToVendorMap()[parts[1] + '|' + parts[2]] || '';
}

window.renderDashboard = function(){
  const el = document.getElementById('dashboard-content');
  if (!currentUser) { el.innerHTML = '<div class="no-data">Esperando login...</div>'; return; }
  const now = new Date();
  const ymPrefix = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const yPrefix = String(now.getFullYear());
  // Vendor a filtrar (vendedor: forzado al suyo; admin/viewer: dropdown)
  const effectiveVendor = (userRole === 'vendedor') ? assignedVendor : dashboardVendorFilter;

  // Stats agregados sobre confirmed (que ya estan filtrados al rol)
  let monthUnits = 0, monthMoneyArs = 0;
  let yearUnits = 0, yearMoneyArs = 0;
  // Para los targets del master (convertidos a ARS al renderizar)
  let julioMoneyArs = 0;   // Jul 2026 facturado
  let semestreMoneyArs = 0; // Jul-Dic 2026
  let anual2027MoneyArs = 0; // todo 2027
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
    (list || []).forEach(c => {
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
      (c.lines || []).forEach(l => {
        const q = parseFloat(l.qty) || 0;
        const pr = parseFloat(l.precio) || 0;
        const m = q * pr * factor;
        if (inYear) {
          yearUnits += q; yearMoneyArs += m;
          if (!productAgg[l.code]) productAgg[l.code] = {qty:0, money:0, desc:l.desc||l.code};
          productAgg[l.code].qty += q; productAgg[l.code].money += m;
          if (!clientAgg[clientName]) clientAgg[clientName] = {qty:0, money:0, prov};
          clientAgg[clientName].qty += q; clientAgg[clientName].money += m;
        }
        if (inMonth) { monthUnits += q; monthMoneyArs += m; }
        if (inJul2026) julioMoneyArs += m;
        if (inSemestre) semestreMoneyArs += m;
        if (inAnual2027) anual2027MoneyArs += m;
      });
    });
  });

  // Top 5 productos por unidades
  const topProducts = Object.entries(productAgg).map(([c,d])=>({code:c, ...d})).sort((a,b)=>b.qty-a.qty).slice(0,5);
  // Top 5 clientes por monto $
  const topClients = Object.entries(clientAgg).map(([n,d])=>({name:n, ...d})).sort((a,b)=>b.money-a.money).slice(0,5);

  // Campañas activas: filtra por aplicabilidad al vendedor activo del dashboard.
  // Si admin/viewer y "Todos" seleccionado, muestra todas. Si filtra por vendedor, aplica el filtro de alcance.
  const todayISO = now.toISOString().slice(0,10);
  let activeCamps = campaignsCache.filter(c => !c.archivedManually && c.startDate <= todayISO && c.endDate >= todayISO);
  const dashVendor = (userRole === 'vendedor') ? assignedVendor : (dashboardVendorFilter && dashboardVendorFilter !== 'ALL' ? dashboardVendorFilter : null);
  if (dashVendor) {
    activeCamps = activeCamps.filter(c => isCampaignApplicableToVendor(c, dashVendor));
  }

  let html = '';
  // Hello + selector de vendedor para admin/viewer
  const helloName = userRole === 'vendedor' && assignedVendor ? titleCase(assignedVendor) : (currentUser.displayName || currentUser.email || 'Usuario');
  const scopeLabel = userRole === 'admin' ? 'Vista admin' : (userRole === 'viewer' ? 'Vista viewer' : 'Tus pedidos confirmados');
  html += '<div style="font-size:11px;color:#64748b;margin-bottom:10px"><b style="color:#0f172a">' + escapeHtml(helloName) + '</b> &middot; ' + scopeLabel + '</div>';
  if (userRole === 'admin' || userRole === 'viewer') {
    html += '<div class="dash-card" style="background:#f0f9ff;border-color:#7dd3fc;padding:10px 12px;margin-bottom:10px">';
    html += '<label style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#075985;display:block;margin-bottom:4px">Filtrar por vendedor</label>';
    html += '<select onchange="setDashboardVendor(this.value)" style="width:100%;padding:7px 10px;border:1.5px solid #7dd3fc;border-radius:5px;font-size:12px;font-weight:600;color:#0f172a;outline:none;background:#fff;font-family:inherit">';
    html += '<option value="ALL"' + (dashboardVendorFilter === 'ALL' ? ' selected' : '') + '>Todos los vendedores (sumado)</option>';
    VENDORS.forEach(v => {
      html += '<option value="' + v.key + '"' + (dashboardVendorFilter === v.key ? ' selected' : '') + '>' + v.zone + ' - ' + titleCase(v.key) + '</option>';
    });
    html += '</select></div>';
  }

  // Para el card MES/ACUMULADO precisamos un vendor concreto para buscar su target.
  // Si admin/viewer sin filtrar => no podemos asumir un solo target; mostramos sin target.
  const dashboardVendorForTargets = (userRole === 'vendedor') ? assignedVendor
    : (dashboardVendorFilter && dashboardVendorFilter !== 'ALL' ? dashboardVendorFilter : null);

  // Helper para clase de color de barra
  function tgtBarCls(pct){
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
  if ((userRole === 'admin' || userRole === 'viewer') && (!dashboardVendorFilter || dashboardVendorFilter === 'ALL')) {
    const byV = {};
    VENDORS.forEach(v => { byV[v.key] = {money: 0, units: 0, orders: 0, visits: 0}; });

    // Pedidos confirmados del mes -> agrupar por vendedor
    Object.entries(confirmed).forEach(([key, list]) => {
      const v = getVendorForKey(key);
      if (!v || !byV[v]) return;
      (list || []).forEach(c => {
        const dt = (c.confirmedAt || c.finalizedAt || '').slice(0, 10);
        if (!dt.startsWith(ymPrefix)) return;
        byV[v].orders++;
        (c.lines || []).forEach(l => {
          const q = parseFloat(l.qty) || 0;
          const pr = parseFloat(l.precio) || 0;
          byV[v].units += q;
          byV[v].money += q * pr;
        });
      });
    });

    // Visitas del mes -> agrupar por vendedor (match case-insensitive)
    const monthLabelUp = MESES[now.getMonth()].toUpperCase();
    (visitsCache || []).forEach(vi => {
      if (!vi.vendor || !byV[vi.vendor]) return;
      if ((vi.mes || '').toUpperCase() !== monthLabelUp) return;
      if (parseInt(vi.anio) !== now.getFullYear()) return;
      byV[vi.vendor].visits++;
    });

    // Armar items con target y %, ordenar por cumplimiento
    const items = VENDORS.map(v => {
      const s = byV[v.key];
      const target = getMonthlyTargetArs(v.key, now.getFullYear(), now.getMonth());
      const pct = (target != null && target > 0) ? Math.round(s.money / target * 100) : null;
      return Object.assign({key: v.key, label: titleCase(v.key), zone: v.zone, target, pct}, s);
    });
    items.sort((a, b) => {
      const ap = (a.pct == null) ? -1 : a.pct;
      const bp = (b.pct == null) ? -1 : b.pct;
      return bp - ap;
    });

    // Totales del equipo
    const teamMoney = items.reduce((s, i) => s + i.money, 0);
    const teamOrders = items.reduce((s, i) => s + i.orders, 0);
    const teamUnits = items.reduce((s, i) => s + i.units, 0);
    const teamVisits = items.reduce((s, i) => s + i.visits, 0);
    const teamTarget = items.reduce((s, i) => s + (i.target || 0), 0);
    const teamPct = teamTarget > 0 ? Math.round(teamMoney / teamTarget * 100) : null;
    const targetsAsignados = items.filter(i => i.target != null && i.target > 0).length;

    // Resumen del equipo (card destacado)
    html += '<div class="dash-card" style="background:linear-gradient(135deg,#0c4a6e,#0284c7);color:#fff;border:none">';
    html += '<h4 style="color:#fff">Resumen equipo <span class="sub" style="color:#bae6fd">' + MESES[now.getMonth()] + ' ' + now.getFullYear() + '</span></h4>';
    html += '<div class="dash-grid">';
    html += '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:#fff">' + fmtMoney(teamMoney) + '</div><div class="lbl" style="color:#bae6fd">Facturado ARS</div></div>';
    html += '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:#fff">' + fmtNum(teamOrders) + '</div><div class="lbl" style="color:#bae6fd">Pedidos</div></div>';
    html += '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:#fff">' + fmtNum(teamVisits) + '</div><div class="lbl" style="color:#bae6fd">Visitas</div></div>';
    if (teamPct != null) {
      const pctColor = teamPct >= 100 ? '#10b981' : (teamPct >= 70 ? '#fde047' : '#fca5a5');
      html += '<div class="dash-stat" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2)"><div class="num" style="color:' + pctColor + '">' + teamPct + '%</div><div class="lbl" style="color:#bae6fd">Cumplimiento</div></div>';
    }
    html += '</div>';
    if (teamTarget > 0) {
      html += '<div style="font-size:11px;color:#bae6fd;margin-top:8px">Target equipo: ' + fmtMoney(teamTarget) + ' &middot; ' + targetsAsignados + ' de ' + items.length + ' vendedores con target asignado</div>';
    } else {
      html += '<div style="font-size:11px;color:#fde047;margin-top:8px;font-weight:600">Ningun vendedor tiene target asignado este mes. Cargá los targets desde el panel <b>Targets</b>.</div>';
    }
    html += '</div>';

    // Ranking de vendedores
    html += '<div class="dash-card"><h4>Ranking de vendedores <span class="sub">Ordenado por cumplimiento</span></h4>';
    items.forEach((it, idx) => {
      const ledColor = idx === 0 ? '#10b981' : (idx === 1 ? '#0284c7' : (idx === 2 ? '#f59e0b' : '#94a3b8'));
      const rankLabel = '#' + (idx + 1);
      const isLeader = idx === 0 && it.pct != null && it.pct > 0;
      html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:8px;border-left:4px solid ' + ledColor + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">';
      html += '<div><div style="font-size:9px;font-weight:800;color:' + ledColor + ';letter-spacing:.5px">' + rankLabel + (isLeader ? ' &middot; &#127942; LIDER DEL MES' : '') + '</div>';
      html += '<div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:2px">' + it.zone + ' &middot; ' + escapeHtml(it.label) + '</div></div>';
      if (it.pct != null) {
        const pctC = it.pct >= 100 ? '#10b981' : (it.pct >= 70 ? '#f59e0b' : '#dc2626');
        html += '<div style="text-align:right;font-size:20px;font-weight:800;color:' + pctC + '">' + it.pct + '%</div>';
      } else {
        html += '<div style="font-size:9px;font-weight:700;color:#94a3b8;background:#f1f5f9;padding:4px 8px;border-radius:4px;align-self:flex-start">SIN TARGET</div>';
      }
      html += '</div>';
      if (it.target != null && it.target > 0) {
        const pctClamp = Math.min(100, Math.max(0, it.pct));
        html += '<div class="tgt-bar"><div class="tgt-bar-fill ' + tgtBarCls(it.pct) + '" style="width:' + pctClamp + '%"></div></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:10px;color:#475569;margin-top:3px;font-weight:600"><span>' + fmtMoney(it.money) + ' / ' + fmtMoney(it.target) + '</span></div>';
      } else {
        html += '<div style="font-size:11px;color:#475569;font-weight:600;margin-top:2px">Facturado: <b style="color:#0f172a">' + fmtMoney(it.money) + '</b></div>';
      }
      html += '<div style="display:flex;gap:14px;margin-top:6px;font-size:10px;color:#64748b;flex-wrap:wrap">';
      html += '<span><b style="color:#0f172a">' + it.orders + '</b> pedidos</span>';
      html += '<span><b style="color:#0f172a">' + fmtNum(it.units) + '</b> uds</span>';
      html += '<span><b style="color:#0f172a">' + it.visits + '</b> visitas</span>';
      html += '</div></div>';
    });
    html += '<div style="font-size:10px;color:#94a3b8;text-align:center;margin-top:8px">Tip: elegí un vendedor en el filtro de arriba para ver su dashboard detallado (target acumulado anual, campañas, etc.)</div>';
    html += '</div>';

    el.innerHTML = html;
    return;
  }

  // === Mes en curso ===
  html += '<div class="dash-card">';
  html += '<h4>Mes en curso <span class="sub">' + MESES[now.getMonth()] + ' ' + now.getFullYear() + '</span></h4>';
  const monthTargetArs = dashboardVendorForTargets ? getMonthlyTargetArs(dashboardVendorForTargets, now.getFullYear(), now.getMonth()) : null;
  html += '<div class="tgt-grid">';
  html += '<div class="tgt-stat"><div class="num">' + fmtNum(monthUnits) + '</div><div class="lbl">Unidades vendidas</div></div>';
  html += '<div class="tgt-stat money"><div class="num">' + fmtMoney(monthMoneyArs) + '</div><div class="lbl">Facturado ARS</div></div>';
  if (monthTargetArs != null) {
    html += '<div class="tgt-stat target"><div class="num">' + fmtMoney(monthTargetArs) + '</div><div class="lbl">Target mensual</div></div>';
    const pct = monthTargetArs > 0 ? Math.round(monthMoneyArs / monthTargetArs * 100) : 0;
    const pctClamp = Math.min(100, Math.max(0, pct));
    html += '<div class="tgt-stat"><div class="num" style="color:' + (pct >= 100 ? '#10b981' : (pct >= 70 ? '#f59e0b' : '#dc2626')) + '">' + pct + '%</div><div class="lbl">Cumplimiento</div></div>';
    html += '</div>';
    html += '<div class="tgt-bar"><div class="tgt-bar-fill ' + tgtBarCls(pct) + '" style="width:' + pctClamp + '%"></div></div>';
    html += '<div class="tgt-meta"><span>' + fmtMoney(monthMoneyArs) + ' / ' + fmtMoney(monthTargetArs) + '</span><span><b>' + pct + '%</b></span></div>';
    if (pct >= 100) html += '<div class="tgt-msg done">&#127881; Target alcanzado</div>';
  } else {
    html += '</div>';
    if (dashboardVendorForTargets) {
      html += '<div class="tgt-msg warn">Target mensual a&uacute;n no asignado. Carg&aacute; el objetivo desde el panel <b>Targets</b>.</div>';
    } else {
      html += '<div class="tgt-msg">Seleccion&aacute; un vendedor para ver su target mensual.</div>';
    }
  }
  html += '</div>';

  // === Acumulado anual ===
  html += '<div class="dash-card">';
  html += '<h4>Acumulado anual <span class="sub">' + yPrefix + ' YTD</span></h4>';
  const ytdInfo = dashboardVendorForTargets ? getCumulativeTargetArs(dashboardVendorForTargets, now.getFullYear(), now.getMonth()) : null;
  html += '<div class="tgt-grid">';
  html += '<div class="tgt-stat"><div class="num">' + fmtNum(yearUnits) + '</div><div class="lbl">Unidades</div></div>';
  html += '<div class="tgt-stat money"><div class="num">' + fmtMoney(yearMoneyArs) + '</div><div class="lbl">Facturado ARS</div></div>';
  if (ytdInfo && ytdInfo.monthsAssigned > 0) {
    html += '<div class="tgt-stat target"><div class="num">' + fmtMoney(ytdInfo.sum) + '</div><div class="lbl">Target acumulado</div></div>';
    const pctY = ytdInfo.sum > 0 ? Math.round(yearMoneyArs / ytdInfo.sum * 100) : 0;
    const pctYClamp = Math.min(100, Math.max(0, pctY));
    html += '<div class="tgt-stat"><div class="num" style="color:' + (pctY >= 100 ? '#10b981' : (pctY >= 70 ? '#f59e0b' : '#dc2626')) + '">' + pctY + '%</div><div class="lbl">Cumplimiento</div></div>';
    html += '</div>';
    html += '<div class="tgt-bar"><div class="tgt-bar-fill ' + tgtBarCls(pctY) + '" style="width:' + pctYClamp + '%"></div></div>';
    html += '<div class="tgt-meta"><span>' + fmtMoney(yearMoneyArs) + ' / ' + fmtMoney(ytdInfo.sum) + '</span><span><b>' + pctY + '%</b></span></div>';
    if (pctY >= 100) html += '<div class="tgt-msg done">&#127881; Target acumulado alcanzado</div>';
    if (ytdInfo.monthsMissing > 0) {
      html += '<div class="tgt-msg warn">El acumulado no incluye ' + ytdInfo.monthsMissing + ' mes' + (ytdInfo.monthsMissing === 1 ? '' : 'es') + ' sin target asignado.</div>';
    }
  } else {
    html += '</div>';
    if (dashboardVendorForTargets) {
      html += '<div class="tgt-msg warn">A&uacute;n no hay targets asignados para este vendedor en ' + yPrefix + '.</div>';
    } else {
      html += '<div class="tgt-msg">Seleccion&aacute; un vendedor para ver su target acumulado.</div>';
    }
  }
  html += '</div>';

  // === TARGETS DE FIRESTORE (los que carga el admin en el panel Targets, en ARS) ===
  // Solo se muestran cuando hay un vendor especifico seleccionado (no en modo "todos sumados").
  if (dashboardVendorForTargets) {
    const targetCard = (label, sub, progArs, targetArs, monthsMissing) => {
      const hasTarget = targetArs != null && targetArs > 0;
      const pct = hasTarget ? Math.min(100, Math.round(progArs / targetArs * 100)) : 0;
      let s = '<div class="dash-card">';
      s += '<h4>' + label + ' <span class="sub">' + sub + '</span></h4>';
      s += '<div class="dash-grid"><div class="dash-stat money"><div class="num">' + fmtMoney(progArs) + '</div><div class="lbl">Realizado</div></div>';
      s += '<div class="dash-stat"><div class="num">' + (hasTarget ? fmtMoney(targetArs) : 'Sin asignar') + '</div><div class="lbl">Target</div></div></div>';
      if (hasTarget) {
        s += '<div class="camp-bar"><div class="camp-bar-fill ' + (pct >= 100 ? 'done' : '') + '" style="width:' + pct + '%;background:' + (pct >= 100 ? '#10b981' : '#00A9E0') + '"></div></div>';
        s += '<div class="camp-meta"><span>' + fmtMoney(progArs) + ' / ' + fmtMoney(targetArs) + '</span><span>' + pct + '%</span></div>';
        if (monthsMissing && monthsMissing > 0) {
          s += '<div class="tgt-msg warn">El target no incluye ' + monthsMissing + ' mes' + (monthsMissing === 1 ? '' : 'es') + ' sin asignar.</div>';
        }
      } else {
        s += '<div class="tgt-msg warn">Target no asignado. Carg&aacute; los objetivos desde el panel <b>Targets</b>.</div>';
      }
      s += '</div>';
      return s;
    };
    // Jul-Dic 2026 (meses 6..11) - acumulado del semestre
    let semTgt = 0, semAssigned = 0, semMissing = 0;
    for (let m = 6; m <= 11; m++) {
      const v = getMonthlyTargetArs(dashboardVendorForTargets, 2026, m);
      if (v != null) { semTgt += v; semAssigned++; } else semMissing++;
    }
    html += targetCard('Target Jul-Dic 2026', 'Segundo semestre', semestreMoneyArs, semAssigned > 0 ? semTgt : null, semMissing);
  }

  // Campañas activas
  html += '<div class="dash-card">';
  html += '<h4>Campa&ntilde;as activas</h4>';
  if (!activeCamps.length) {
    html += '<div style="font-size:11px;color:#94a3b8">No hay campa&ntilde;as activas en este momento.</div>';
  } else {
    activeCamps.forEach(c => {
      // Progreso GLOBAL de la campaña: suma los confirmados de TODOS los
      // vendedores asignados al scope (no solo del que esta mirando).
      // Si la campaña FX 1000u va para gonzalo+federico y Fede lleva 200 y
      // Gonzalo 500, ambos ven 700/1000 = 70% en su dashboard.
      // Usa globalPedidos (todos los pedidos de todos los users), no
      // 'confirmed' (que para un vendedor solo trae los propios).
      const passesCampScope = (function(){
        const scope = (c && c.scope) || 'all';
        if (scope === 'all') return null; // sin filtro
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
      let prog = 0;
      (globalPedidos || []).forEach(p => {
        if (p.stage !== 'confirmed') return;
        if (passesCampScope && !passesCampScope(p)) return;
        const dt = (p.confirmedAt || '').slice(0,10);
        if (dt < c.startDate || dt > c.endDate) return;
        (p.lines || []).forEach(l => {
          // Nuevo formato: matchea por SKU code (skus array).
          // Fallback al viejo formato (filterType=familia/subfamilia/categoria).
          let matches;
          if (Array.isArray(c.skus) && c.skus.length) {
            matches = c.skus.includes(l.code);
          } else {
            matches = c.filterType === 'familia' ? (c.filterValues||[]).includes(l.fam)
              : c.filterType === 'subfamilia' ? (c.filterValues||[]).includes(l.sub)
              : c.filterType === 'categoria' ? (c.filterValues||[]).includes(l.cat) : false;
          }
          if (!matches) return;
          const q = parseFloat(l.qty) || 0;
          const pr = parseFloat(l.precio) || 0;
          if (c.targetType === 'money') prog += q * pr;
          else prog += q;
        });
      });
      const pct = c.targetAmount > 0 ? Math.min(100, Math.round(prog/c.targetAmount*100)) : 0;
      const target = c.targetType === 'money' ? fmtMoney(c.targetAmount) : fmtNum(c.targetAmount) + ' unid.';
      const progFmt = c.targetType === 'money' ? fmtMoney(prog) : fmtNum(prog) + ' unid.';
      html += '<div class="camp-card">';
      html += '<h5>' + escapeHtml(c.name) + '</h5>';
      let cdesc;
      if (c.familia && c.subfamilia) {
        cdesc = escapeHtml(c.familia) + ' / <b>' + escapeHtml(c.subfamilia) + '</b> &middot; ' + (Array.isArray(c.skus) ? c.skus.length : 0) + ' SKU';
      } else {
        cdesc = escapeHtml(c.filterType || '') + ': <b>' + escapeHtml((c.filterValues||[]).join(', ')) + '</b>';
      }
      html += '<div class="cm-period">' + cdesc + ' &middot; del ' + c.startDate + ' al ' + c.endDate + '</div>';
      html += '<div class="camp-bar"><div class="camp-bar-fill ' + (pct >= 100 ? 'done' : '') + '" style="width:' + pct + '%"></div></div>';
      html += '<div class="camp-meta"><span>' + progFmt + ' / ' + target + '</span><span>' + pct + '%</span></div>';
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
