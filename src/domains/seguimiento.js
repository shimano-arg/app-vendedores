// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline o bundle previo):
// fbDb, firebase, currentUser, userRole, VENDOR_INCLUDES_OTHERS, globalPedidos,
// escapeHtml, escapeAttr, titleCase, showSyncTag, canViewSeguimiento,
// getSeguimientoExternalSet, vendorInSeguimientoScope, getVendorForKey
// (dashboard bundle). Módulo extraído verbatim: tipado real fuera de scope E2.d.
//
// SEGUIMIENTO - Panel de gestión comercial para vendedores internos.
// Extraído verbatim de index.html (líneas 26713-27408 pre-E2.d) como parte
// de E2.d (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// Cross-scope state (via window):
// - window.unsubSegNotes / window.unsubSegStatus: listeners con cleanup en
//   detachFirebaseListeners() inline (líneas 26148-49 pre-E2.d).
// Locals al módulo: segVisitsCache, segNotesCache, segStatusCache,
// segCurrentTab, currentSegTimelineKey, _segDebounceTimer.

// Init cross-scope state (bundle IIFE corre pre-inline; garantiza que las
// vars unsub* existen en window antes de que detachFirebaseListeners las lea).
if (typeof window.unsubSegNotes === 'undefined') window.unsubSegNotes = null;
if (typeof window.unsubSegStatus === 'undefined') window.unsubSegStatus = null;

// =========================================================================
// SEGUIMIENTO - Panel de gestion comercial para vendedores internos.
// =========================================================================
// Modelo:
//   visitas      -> collection 'visits' (cargada 1x con where vendor in [...])
//   pedidos      -> globalPedidos (ya listenerado para sugerencias cruzadas)
//   notas        -> collection 'seguimiento_notes'
//   estados      -> collection 'seguimiento_status'  (revisado / pendiente / resuelto)
// Permisos: getSeguimientoExternalSet() es el guard. Cada accion (open,
// render, save, setStatus) re-valida vendorInSeguimientoScope(vendor) para
// que la manipulacion del frontend no pueda forzar acceso a un VDE ajeno.
let segVisitsCache = [];
let segNotesCache = [];
let segStatusCache = {};
let segCurrentTab = 'resumen';
let currentSegTimelineKey = null;
let _segDebounceTimer = null;

function segPedidoVendor(p) {
  if (!p) return '';
  if (p.vendor) return p.vendor;
  if (p.assignedVendor) return p.assignedVendor;
  if (typeof getVendorForKey === 'function' && p.key) return getVendorForKey(p.key);
  return '';
}

window.openSeguimientoModal = async function () {
  if (!canViewSeguimiento()) {
    alert('Tu rol no tiene acceso a Seguimiento.');
    return;
  }
  const set = getSeguimientoExternalSet();
  if (!set.size) {
    alert(
      'Todavia no tenes vendedores externos asignados.\n\nSi sos vendedor interno (Santiago / Ioannis), pedile al admin que en Panel Usuarios -> tu VDE -> "Pareja interno" te asocie como pareja.'
    );
    return;
  }
  document.getElementById('seguimiento-modal').classList.add('open');
  populateSegFilters();
  const desdeEl = document.getElementById('seg-fdesde');
  const hastaEl = document.getElementById('seg-fhasta');
  if (desdeEl && !desdeEl.value) {
    const now = new Date();
    const desde = new Date(now.getTime() - 90 * 86400 * 1000);
    desdeEl.value = desde.toISOString().slice(0, 10);
    hastaEl.value = now.toISOString().slice(0, 10);
  }
  document.getElementById('seg-content').innerHTML =
    '<div class="seg-empty">Cargando datos...</div>';
  await loadSegVisits();
  attachSegNotesListener();
  attachSegStatusListener();
  setSeguimientoTab(segCurrentTab);
};
window.closeSeguimientoModal = function () {
  document.getElementById('seguimiento-modal').classList.remove('open');
};

function populateSegFilters() {
  const set = getSeguimientoExternalSet();
  const sel = document.getElementById('seg-fvendor');
  if (!sel) return;
  const cur = sel.value || 'ALL';
  const opts = ['<option value="ALL">Todos</option>'].concat(
    [...set]
      .sort()
      .map((v) => '<option value="' + escapeAttr(v) + '">' + escapeHtml(displayVendorName(v)) + '</option>')
  );
  sel.innerHTML = opts.join('');
  sel.value = set.has(cur) || cur === 'ALL' ? cur : 'ALL';
  sel.onchange = () => renderSeguimientoTab();
  document.getElementById('seg-fdesde').onchange = () => {
    loadSegVisits().then(() => renderSeguimientoTab());
  };
  document.getElementById('seg-fhasta').onchange = () => {
    loadSegVisits().then(() => renderSeguimientoTab());
  };
  const cli = document.getElementById('seg-fcliente');
  cli.oninput = function () {
    if (_segDebounceTimer) clearTimeout(_segDebounceTimer);
    _segDebounceTimer = setTimeout(() => renderSeguimientoTab(), 300);
  };
  document.getElementById('seg-festado').onchange = () => renderSeguimientoTab();
}

async function loadSegVisits() {
  const set = getSeguimientoExternalSet();
  if (!set.size || !fbDb) {
    segVisitsCache = [];
    return;
  }
  try {
    const list = [...set];
    // Firestore IN max 10 - aca tenemos 2-4, OK.
    const qs = await fbDb.collection('visits').where('vendor', 'in', list).get();
    segVisitsCache = [];
    qs.forEach((d) => segVisitsCache.push(Object.assign({ id: d.id }, d.data())));
  } catch (e) {
    console.error('[Seguimiento] error cargando visitas:', e);
    segVisitsCache = [];
    if (e && e.code === 'permission-denied') {
      alert(
        'Tu rol no tiene permisos en Firestore para leer las visitas del scope.\n\nEl admin tiene que actualizar las rules para permitir a interno/gerente leer visits de sus VDEs asignados.'
      );
    }
  }
}

function attachSegNotesListener() {
  if (window.unsubSegNotes) {
    window.unsubSegNotes();
    window.unsubSegNotes = null;
  }
  const set = getSeguimientoExternalSet();
  if (!set.size || !fbDb) return;
  try {
    window.unsubSegNotes = fbDb
      .collection('seguimiento_notes')
      .where('vendorExt', 'in', [...set])
      .onSnapshot(
        (qs) => {
          segNotesCache = [];
          qs.forEach((d) => segNotesCache.push(Object.assign({ id: d.id }, d.data())));
          if (currentSegTimelineKey) openSegTimeline(currentSegTimelineKey);
        },
        (err) => console.warn('[Seguimiento] notes listener', err)
      );
  } catch (e) {
    console.warn('[Seguimiento] notes attach', e);
  }
}

function attachSegStatusListener() {
  if (window.unsubSegStatus) {
    window.unsubSegStatus();
    window.unsubSegStatus = null;
  }
  const set = getSeguimientoExternalSet();
  if (!set.size || !fbDb) return;
  try {
    window.unsubSegStatus = fbDb
      .collection('seguimiento_status')
      .where('vendorExt', 'in', [...set])
      .onSnapshot(
        (qs) => {
          segStatusCache = {};
          qs.forEach((d) => {
            const dd = d.data() || {};
            if (dd.clientKey) segStatusCache[dd.clientKey] = dd.status || '';
          });
          renderSeguimientoTab();
        },
        (err) => console.warn('[Seguimiento] status listener', err)
      );
  } catch (e) {
    console.warn('[Seguimiento] status attach', e);
  }
}

window.setSeguimientoTab = function (tab) {
  segCurrentTab = tab;
  document
    .querySelectorAll('.seg-tab')
    .forEach((b) => b.classList.toggle('active', b.dataset.segTab === tab));
  renderSeguimientoTab();
};

function getSegFilters() {
  return {
    vendor: document.getElementById('seg-fvendor').value || 'ALL',
    desde: document.getElementById('seg-fdesde').value || '',
    hasta: document.getElementById('seg-fhasta').value || '',
    cliente: (document.getElementById('seg-fcliente').value || '').toLowerCase().trim(),
    estado: document.getElementById('seg-festado').value || 'ALL',
    soloPend: !!document.getElementById('seg-fpend').checked,
  };
}

function getSegDataset() {
  const set = getSeguimientoExternalSet();
  const f = getSegFilters();
  const inScope = (v) => set.has(v);
  const inDate = (d) => {
    if (!d) return true; // tolerar registros sin fecha
    if (f.desde && d < f.desde) return false;
    if (f.hasta && d > f.hasta) return false;
    return true;
  };
  const matchVendor = (v) => (f.vendor === 'ALL' ? true : v === f.vendor);
  const matchCliente = (name) =>
    f.cliente ? (name || '').toLowerCase().includes(f.cliente) : true;
  const visits = (segVisitsCache || []).filter((v) => {
    if (!inScope(v.vendor)) return false;
    if (!matchVendor(v.vendor)) return false;
    if (!inDate((v.fecha || '').slice(0, 10))) return false;
    if (!matchCliente(v.tienda)) return false;
    return true;
  });
  const pedidos = (globalPedidos || [])
    .map((p) => Object.assign({}, p, { vendor: segPedidoVendor(p) }))
    .filter((p) => {
      if (!inScope(p.vendor)) return false;
      if (!matchVendor(p.vendor)) return false;
      const dt = (p.confirmedAt || '').slice(0, 10) || (p.finalizedAt || '').slice(0, 10) || '';
      if (!inDate(dt)) return false;
      if (!matchCliente(p.clientName)) return false;
      return true;
    });
  return { visits, pedidos };
}

function buildSegAggregates(visits, pedidos) {
  const set = getSeguimientoExternalSet();
  const byVendor = {};
  set.forEach((v) => {
    byVendor[v] = {
      visits: 0,
      pedidos: 0,
      facturacion: 0,
      pendientesPedidos: 0,
      lastActivity: '',
      clientsActive: new Set(),
      clientsVisited: new Set(),
    };
  });
  visits.forEach((v) => {
    const b = byVendor[v.vendor];
    if (!b) return;
    b.visits++;
    if (v.tienda) b.clientsVisited.add(v.tienda + '|' + (v.localidad || ''));
    const d = (v.fecha || '').slice(0, 10);
    if (d && d > b.lastActivity) b.lastActivity = d;
  });
  pedidos.forEach((p) => {
    const b = byVendor[p.vendor];
    if (!b) return;
    b.pedidos++;
    const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs != null ? p.subtotalArs : 0;
    if (p.stage === 'confirmed') b.facturacion += +amt || 0;
    if (p.stage === 'pending') b.pendientesPedidos++;
    if (p.clientName) b.clientsActive.add(p.clientName + '|' + (p.locName || ''));
    const d = (p.confirmedAt || '').slice(0, 10) || (p.finalizedAt || '').slice(0, 10);
    if (d && d > b.lastActivity) b.lastActivity = d;
  });
  return byVendor;
}

function segMakeKey(vendor, prov, loc, name) {
  return [vendor || '', prov || '', loc || '', name || ''].join('|');
}

function detectSegPendientes(visits, pedidos) {
  const items = [];
  const byClient = {};
  visits.forEach((v) => {
    const k = segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda);
    if (!byClient[k])
      byClient[k] = {
        vendor: v.vendor,
        prov: v.provincia,
        loc: v.localidad,
        name: v.tienda,
        visits: [],
        orders: [],
      };
    byClient[k].visits.push(v);
  });
  pedidos.forEach((p) => {
    const k = segMakeKey(p.vendor, p.province, p.locName, p.clientName);
    if (!byClient[k])
      byClient[k] = {
        vendor: p.vendor,
        prov: p.province,
        loc: p.locName,
        name: p.clientName,
        visits: [],
        orders: [],
      };
    byClient[k].orders.push(p);
  });
  Object.entries(byClient).forEach(([k, c]) => {
    if (!c.visits.length) return;
    const hasConfirmed = c.orders.some((o) => o.stage === 'confirmed');
    if (hasConfirmed) return;
    // El usuario marco el caso como 'resuelto' desde el timeline o el
    // boton X de pendientes -> no volvemos a listarlo.
    if (segStatusCache[k] === 'resuelto') return;
    const latestV = c.visits
      .map((v) => v.fecha || '')
      .sort()
      .pop();
    const daysAgo = latestV ? Math.floor((Date.now() - new Date(latestV).getTime()) / 86400000) : 0;
    if (daysAgo >= 7) {
      items.push({
        kind: 'visit-no-order',
        clientKey: k,
        client: c.name,
        vendor: c.vendor,
        prov: c.prov,
        loc: c.loc,
        problema: 'Visitado sin pedido hace ' + daysAgo + ' dias',
        accion: 'Contactar y ofrecer cierre',
        ultimaAccion: 'Visita: ' + latestV,
        status: daysAgo > 14 ? 'red' : 'yellow',
      });
    }
  });
  pedidos.forEach((p) => {
    if (p.stage !== 'pending') return;
    const dt = (p.finalizedAt || '').slice(0, 10) || (p.confirmedAt || '').slice(0, 10) || '';
    const daysAgo = dt ? Math.floor((Date.now() - new Date(dt).getTime()) / 86400000) : 0;
    items.push({
      kind: 'pedido-pending',
      pedidoFsId: p._fsId || '',
      clientKey: segMakeKey(p.vendor, p.province, p.locName, p.clientName),
      client: p.clientName,
      vendor: p.vendor,
      prov: p.province,
      loc: p.locName,
      problema: 'Pedido pendiente de confirmar' + (daysAgo ? ' hace ' + daysAgo + ' dias' : ''),
      accion: 'Revisar stock y llamar al cliente',
      ultimaAccion: 'Pedido: ' + (dt || '(s/f)'),
      status: daysAgo >= 5 ? 'red' : 'yellow',
    });
  });
  return items;
}

function detectSegSinMovimiento(visits, pedidos) {
  const map = {};
  visits.forEach((v) => {
    const k = segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda);
    if (!map[k])
      map[k] = {
        vendor: v.vendor,
        prov: v.provincia,
        loc: v.localidad,
        name: v.tienda,
        lastV: '',
        lastO: '',
        facturacion: 0,
      };
    if ((v.fecha || '') > map[k].lastV) map[k].lastV = v.fecha;
  });
  pedidos.forEach((p) => {
    const k = segMakeKey(p.vendor, p.province, p.locName, p.clientName);
    if (!map[k])
      map[k] = {
        vendor: p.vendor,
        prov: p.province,
        loc: p.locName,
        name: p.clientName,
        lastV: '',
        lastO: '',
        facturacion: 0,
      };
    const dt = (p.confirmedAt || '').slice(0, 10);
    if (p.stage === 'confirmed' && dt > map[k].lastO) map[k].lastO = dt;
    if (p.stage === 'confirmed') {
      const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
      map[k].facturacion += +amt || 0;
    }
  });
  const out = [];
  Object.entries(map).forEach(([k, c]) => {
    const lastVdays = c.lastV
      ? Math.floor((Date.now() - new Date(c.lastV).getTime()) / 86400000)
      : Infinity;
    const lastOdays = c.lastO
      ? Math.floor((Date.now() - new Date(c.lastO).getTime()) / 86400000)
      : Infinity;
    if (lastVdays > 30 && lastOdays > 45) {
      const lastDays = Math.min(lastVdays, lastOdays);
      out.push({
        clientKey: k,
        client: c.name,
        vendor: c.vendor,
        prov: c.prov,
        loc: c.loc,
        lastVisit: c.lastV || '-',
        lastOrder: c.lastO || '-',
        daysAgo: Number.isFinite(lastDays) ? lastDays : '999+',
        facturacion: c.facturacion,
        accion:
          c.facturacion > 0
            ? 'Recontactar - cliente con historial'
            : 'Recontactar - puede ser oportunidad',
        status: c.facturacion > 100000 && lastDays > 60 ? 'red' : 'yellow',
      });
    }
  });
  return out.sort((a, b) => (b.facturacion || 0) - (a.facturacion || 0));
}

function detectSegOportunidades(visits, _pedidos) {
  const items = [];
  const keys = [
    'interesad',
    'potencial',
    'cierre',
    'reposici',
    'oferta',
    'descuento',
    'volver',
    'cotiz',
  ];
  visits.forEach((v) => {
    const txt = ((v.comentario || '') + ' ' + (v.observaciones || '')).toLowerCase();
    if (keys.some((kw) => txt.includes(kw))) {
      items.push({
        clientKey: segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda),
        client: v.tienda,
        vendor: v.vendor,
        prov: v.provincia,
        loc: v.localidad,
        problema:
          'Comentario comercial: "' + (v.comentario || v.observaciones || '').slice(0, 80) + '"',
        accion: 'Coordinar cierre con el VDE',
        ultimaAccion: 'Visita: ' + (v.fecha || '-'),
        status: 'yellow',
      });
    }
  });
  return items;
}

function buildSegDuplas(visits, pedidos) {
  const externalToInternal = {};
  Object.entries(VENDOR_INCLUDES_OTHERS).forEach(([interno, ext]) =>
    ext.forEach((e) => (externalToInternal[e] = interno))
  );
  const duplas = {};
  const ensure = (interno, externo) => {
    const k = interno + ' + ' + externo;
    if (!duplas[k])
      duplas[k] = {
        interno,
        externo,
        visitas: 0,
        pedidos: 0,
        pedidosConf: 0,
        fact: 0,
        clientes: new Set(),
        pendientes: 0,
        lastAct: '',
      };
    return duplas[k];
  };
  visits.forEach((v) => {
    const interno = externalToInternal[v.vendor];
    if (!interno) return;
    const d = ensure(interno, v.vendor);
    d.visitas++;
    if (v.tienda) d.clientes.add(v.tienda + '|' + (v.localidad || ''));
    const dt = (v.fecha || '').slice(0, 10);
    if (dt > d.lastAct) d.lastAct = dt;
  });
  pedidos.forEach((p) => {
    const interno = externalToInternal[p.vendor];
    if (!interno) return;
    const d = ensure(interno, p.vendor);
    d.pedidos++;
    if (p.stage === 'confirmed') {
      d.pedidosConf++;
      const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
      d.fact += +amt || 0;
    } else if (p.stage === 'pending') d.pendientes++;
    if (p.clientName) d.clientes.add(p.clientName + '|' + (p.locName || ''));
    const dt = (p.confirmedAt || '').slice(0, 10);
    if (dt > d.lastAct) d.lastAct = dt;
  });
  return duplas;
}

window.renderSeguimientoTab = function () {
  if (!canViewSeguimiento()) {
    document.getElementById('seg-content').innerHTML = '<div class="seg-empty">Sin permisos.</div>';
    return;
  }
  const { visits, pedidos } = getSegDataset();
  renderSegTopStats(visits, pedidos);
  const pendientes = detectSegPendientes(visits, pedidos);
  const dead = detectSegSinMovimiento(visits, pedidos);
  const opps = detectSegOportunidades(visits, pedidos);
  document.getElementById('seg-count-visitas').textContent = visits.length;
  document.getElementById('seg-count-pedidos').textContent = pedidos.length;
  document.getElementById('seg-count-pendientes').textContent = pendientes.length;
  document.getElementById('seg-count-dead').textContent = dead.length;
  document.getElementById('seg-count-opp').textContent = opps.length;
  const tab = segCurrentTab || 'resumen';
  const f = getSegFilters();
  const filterByEstado = (arr) =>
    f.estado === 'ALL' ? arr : arr.filter((x) => x.status === f.estado);
  let html = '';
  if (tab === 'resumen') html = renderSegResumen(visits, pedidos);
  else if (tab === 'visitas') {
    let rows = visits.slice();
    if (f.soloPend) {
      const pendSet = new Set(pendientes.map((p) => p.clientKey));
      rows = rows.filter((v) =>
        pendSet.has(segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda))
      );
    }
    html = renderSegVisitas(rows);
  } else if (tab === 'pedidos') {
    let rows = pedidos.slice();
    if (f.soloPend) rows = rows.filter((p) => p.stage === 'pending');
    html = renderSegPedidos(rows);
  } else if (tab === 'pendientes') html = renderSegPendientes(filterByEstado(pendientes));
  else if (tab === 'dead') html = renderSegDead(filterByEstado(dead));
  else if (tab === 'opp') html = renderSegOpps(filterByEstado(opps));
  else if (tab === 'duplas') html = renderSegDuplas(buildSegDuplas(visits, pedidos));
  document.getElementById('seg-content').innerHTML = html;
};

function renderSegTopStats(visits, pedidos) {
  let fact = 0,
    conf = 0,
    _pend = 0,
    lastAct = '';
  pedidos.forEach((p) => {
    if (p.stage === 'confirmed') {
      conf++;
      const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
      fact += +amt || 0;
    } else if (p.stage === 'pending') _pend++;
    const dt = (p.confirmedAt || '').slice(0, 10) || (p.finalizedAt || '').slice(0, 10);
    if (dt > lastAct) lastAct = dt;
  });
  visits.forEach((v) => {
    const d = (v.fecha || '').slice(0, 10);
    if (d > lastAct) lastAct = d;
  });
  const pendientes = detectSegPendientes(visits, pedidos);
  const dead = detectSegSinMovimiento(visits, pedidos);
  const opps = detectSegOportunidades(visits, pedidos);
  const conv = visits.length > 0 ? Math.round((conf / visits.length) * 100) : 0;
  const fmtMon = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  const html =
    '' +
    '<div class="seg-stat visitas"><div class="num">' +
    visits.length +
    '</div><div class="lbl">Visitas</div></div>' +
    '<div class="seg-stat pedidos"><div class="num">' +
    pedidos.length +
    '</div><div class="lbl">Pedidos</div></div>' +
    '<div class="seg-stat fact"><div class="num">' +
    fmtMon(fact) +
    '</div><div class="lbl">Facturado</div></div>' +
    '<div class="seg-stat pend"><div class="num">' +
    pendientes.length +
    '</div><div class="lbl">Pendientes</div></div>' +
    '<div class="seg-stat opp"><div class="num">' +
    opps.length +
    '</div><div class="lbl">Oportunidades</div></div>' +
    '<div class="seg-stat dead"><div class="num">' +
    dead.length +
    '</div><div class="lbl">Sin movimiento</div></div>' +
    '<div class="seg-stat conv"><div class="num">' +
    conv +
    '%</div><div class="lbl">Conv v&rarr;p</div></div>' +
    '<div class="seg-stat"><div class="num" style="font-size:13px">' +
    (lastAct || '-') +
    '</div><div class="lbl">Ultima actividad</div></div>';
  document.getElementById('seg-stats').innerHTML = html;
}

function renderSegResumen(visits, pedidos) {
  const agg = buildSegAggregates(visits, pedidos);
  let html = '';
  Object.entries(agg)
    .sort()
    .forEach(([vendor, b]) => {
      const conv = b.visits ? Math.round((b.pedidos / b.visits) * 100) : 0;
      const lastDays = b.lastActivity
        ? Math.floor((Date.now() - new Date(b.lastActivity).getTime()) / 86400000)
        : Infinity;
      const cardCls = lastDays > 7 ? 'yellow' : lastDays > 15 ? 'red' : '';
      html += '<div class="seg-vendor-card ' + cardCls + '">';
      html += '<h4>' + escapeHtml(displayVendorName(vendor)) + '</h4>';
      html +=
        '<div class="vmetrics">' +
        '<div class="vm"><b>' +
        b.visits +
        '</b>Visitas</div>' +
        '<div class="vm"><b>' +
        b.pedidos +
        '</b>Pedidos</div>' +
        '<div class="vm"><b>$' +
        Math.round(b.facturacion).toLocaleString('es-AR') +
        '</b>Facturacion</div>' +
        '<div class="vm"><b>' +
        b.clientsActive.size +
        '</b>Clientes activos</div>' +
        '<div class="vm"><b>' +
        b.clientsVisited.size +
        '</b>Clientes visitados</div>' +
        '<div class="vm"><b>' +
        b.pendientesPedidos +
        '</b>Pend. confirmar</div>' +
        '<div class="vm"><b>' +
        conv +
        '%</b>Conv. v&rarr;p</div>' +
        '<div class="vm"><b>' +
        (b.lastActivity || '-') +
        '</b>Ult. actividad</div>' +
        '</div></div>';
    });
  if (!html) html = '<div class="seg-empty">No hay vendedores externos en el scope.</div>';
  return html;
}

function renderSegVisitas(visits) {
  if (!visits.length) return '<div class="seg-empty">No hay visitas en el rango.</div>';
  const sorted = visits.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const canDel = userRole === 'admin' || userRole === 'gerente';
  let html =
    '<div class="seg-row head"><div>Fecha</div><div>Vendedor</div><div>Cliente / Tienda</div><div>Localidad</div><div>Observaciones</div></div>';
  sorted.forEach((v) => {
    const k = segMakeKey(v.vendor, v.provincia, v.localidad, v.tienda);
    const delBtn =
      canDel && v.id
        ? ' <button onclick="event.stopPropagation();deleteSegVisita(\'' +
          escapeAttr(v.id) +
          "','" +
          escapeAttr(v.tienda || '') +
          '\')" title="Eliminar esta visita (admin/gerente)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:#dc2626;color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128465; Borrar</button>'
        : '';
    html += '<div class="seg-row" onclick="openSegTimeline(\'' + escapeAttr(k) + '\')">';
    html += '<div>' + escapeHtml((v.fecha || '').slice(0, 10) || '-') + '</div>';
    html += '<div>' + escapeHtml(titleCase(v.vendor || '')) + '</div>';
    html += '<div><b>' + escapeHtml(v.tienda || '-') + '</b></div>';
    html += '<div>' + escapeHtml(v.localidad || '-') + '</div>';
    html +=
      '<div style="color:#475569">' +
      escapeHtml((v.comentario || v.observaciones || '').slice(0, 140)) +
      (v.proximaAccion
        ? '<br><span style="color:#0d9488;font-weight:700">Proxima: ' +
          escapeHtml(v.proximaAccion) +
          '</span>'
        : '') +
      delBtn +
      '</div>';
    html += '</div>';
  });
  return html;
}

// Elimina una visita. Solo admin/gerente (las rules ademas autorizan al
// owner, pero desde Seguimiento la accion es de revision/limpieza).
window.deleteSegVisita = async function (visitId, tienda) {
  if (!visitId) return;
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede eliminar visitas.');
    return;
  }
  const lbl = tienda ? '"' + tienda + '"' : 'esta visita';
  if (
    !confirm(
      'Eliminar la visita a ' +
        lbl +
        ' del historial?\n\nEsta accion es IRREVERSIBLE: la visita desaparece de Seguimiento, rutas, dashboard y stats del vendedor externo.'
    )
  )
    return;
  try {
    await fbDb.collection('visits').doc(visitId).delete();
    if (typeof showSyncTag === 'function') showSyncTag('Visita eliminada');
    // Re-fetch local (no hay listener de visits global). Despues re-render.
    await loadSegVisits();
    renderSeguimientoTab();
  } catch (e) {
    console.error('deleteSegVisita', e);
    alert('Error: ' + (e.message || e));
  }
};

function renderSegPedidos(pedidos) {
  if (!pedidos.length) return '<div class="seg-empty">No hay pedidos en el rango.</div>';
  const sorted = pedidos
    .slice()
    .sort((a, b) =>
      (b.confirmedAt || b.finalizedAt || '').localeCompare(a.confirmedAt || a.finalizedAt || '')
    );
  const canDel = userRole === 'admin' || userRole === 'gerente';
  let html =
    '<div class="seg-row head"><div>Fecha</div><div>Vendedor</div><div>Cliente</div><div>Unidades</div><div>Importe + Estado</div></div>';
  sorted.forEach((p) => {
    const k = segMakeKey(p.vendor, p.province, p.locName, p.clientName);
    const dt = (p.confirmedAt || p.finalizedAt || '').slice(0, 10);
    const units = (p.lines || []).reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
    const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
    const badgeCls = p.stage === 'confirmed' ? 'green' : 'yellow';
    const badgeTxt = p.stage === 'confirmed' ? 'Confirmado' : 'Pendiente';
    // Boton ELIMINAR: solo admin/gerente. Util para limpiar pedidos TEST.
    // stopPropagation evita que el click dispare el timeline del cliente.
    const delBtn =
      canDel && p._fsId
        ? ' <button onclick="event.stopPropagation();deleteSegPedido(\'' +
          escapeAttr(p._fsId) +
          "','" +
          escapeAttr(p.clientName || '') +
          '\')" title="Eliminar este pedido del historial (admin/gerente)" style="margin-left:8px;padding:3px 8px;border:none;border-radius:4px;background:#dc2626;color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128465; Borrar</button>'
        : '';
    html += '<div class="seg-row" onclick="openSegTimeline(\'' + escapeAttr(k) + '\')">';
    html += '<div>' + escapeHtml(dt || '-') + '</div>';
    html += '<div>' + escapeHtml(titleCase(p.vendor || '')) + '</div>';
    html +=
      '<div><b>' +
      escapeHtml(p.clientName || '-') +
      '</b><br><span style="font-size:10px;color:#94a3b8">' +
      escapeHtml(p.locName || '') +
      '</span></div>';
    html += '<div>' + units.toFixed(0) + ' u</div>';
    html +=
      '<div>$' +
      Math.round(amt).toLocaleString('es-AR') +
      ' <span class="seg-badge ' +
      badgeCls +
      '">' +
      badgeTxt +
      '</span>' +
      delBtn +
      '</div>';
    html += '</div>';
  });
  return html;
}

// Elimina un pedido del historial. Solo admin/gerente. Las rules ya lo
// permiten via 'allow update, delete: if isAdminOrGerente() || ...'.
// Pensado para limpiar pedidos de TEST o duplicados sin tener que salir
// de Seguimiento. Action irreversible: borra el doc en /pedidos/{id}.
window.deleteSegPedido = async function (fsId, clientName) {
  if (!fsId) return;
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede eliminar pedidos.');
    return;
  }
  const lbl = clientName ? '"' + clientName + '"' : 'este pedido';
  if (
    !confirm(
      'Eliminar el pedido de ' +
        lbl +
        ' del historial?\n\nEsta accion es IRREVERSIBLE: el pedido desaparece de Seguimiento, Dashboard, exports y campañas.'
    )
  )
    return;
  try {
    await fbDb.collection('pedidos').doc(fsId).delete();
    if (typeof showSyncTag === 'function') showSyncTag('Pedido eliminado');
    // El listener global de pedidos refresca globalPedidos solo. Pero
    // por timing, forzamos un re-render por si todavia no llego el
    // snapshot updated.
    setTimeout(() => {
      try {
        renderSeguimientoTab();
      } catch (_e) {}
    }, 250);
  } catch (e) {
    console.error('deleteSegPedido', e);
    alert('Error: ' + (e.message || e));
  }
};

function renderSegPendientes(items) {
  if (!items.length) return '<div class="seg-empty">Sin pendientes en el rango.</div>';
  items = items.slice().sort((a, _b) => (a.status === 'red' ? -1 : 1));
  const canDel = userRole === 'admin' || userRole === 'gerente';
  const isSegUser = userRole === 'admin' || userRole === 'gerente' || userRole === 'interno';
  let html =
    '<div class="seg-row head"><div>Estado</div><div>Vendedor</div><div>Cliente</div><div>Ult. accion</div><div>Problema + accion sugerida</div></div>';
  items.forEach((it) => {
    const lbl = it.status === 'red' ? 'CRITICO' : it.status === 'yellow' ? 'REVISAR' : 'OK';
    // Boton de eliminar/resolver segun origen del pendiente:
    //  - pedido-pending: borrar el doc del pedido (solo admin/gerente).
    //  - visit-no-order: marcar el clientKey como 'resuelto' en
    //    seguimiento_status para que detectSegPendientes lo oculte
    //    (cualquier user de Seguimiento puede resolverlo).
    let actionBtn = '';
    if (it.kind === 'pedido-pending' && canDel && it.pedidoFsId) {
      actionBtn =
        ' <button onclick="event.stopPropagation();deleteSegPedido(\'' +
        escapeAttr(it.pedidoFsId) +
        "','" +
        escapeAttr(it.client || '') +
        '\')" title="Eliminar el pedido pendiente del historial (admin/gerente)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:#dc2626;color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128465; Borrar pedido</button>';
    } else if (it.kind === 'visit-no-order' && isSegUser) {
      actionBtn =
        ' <button onclick="event.stopPropagation();setSegStatus(\'' +
        escapeAttr(it.clientKey) +
        '\',\'resuelto\')" title="Marcar este cliente como resuelto - se oculta de Pendientes (no borra visitas)" style="margin-left:6px;padding:3px 8px;border:none;border-radius:4px;background:#0d9488;color:#fff;font-size:9px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#10003; Resolver</button>';
    }
    html += '<div class="seg-row" onclick="openSegTimeline(\'' + escapeAttr(it.clientKey) + '\')">';
    html +=
      '<div><span class="seg-status-dot ' +
      it.status +
      '"></span><span class="seg-badge ' +
      it.status +
      '">' +
      lbl +
      '</span></div>';
    html += '<div>' + escapeHtml(titleCase(it.vendor || '')) + '</div>';
    html +=
      '<div><b>' +
      escapeHtml(it.client || '-') +
      '</b><br><span style="font-size:10px;color:#94a3b8">' +
      escapeHtml(it.loc || '') +
      '</span></div>';
    html +=
      '<div style="font-size:10px;color:#64748b">' + escapeHtml(it.ultimaAccion || '-') + '</div>';
    html +=
      '<div><b>' +
      escapeHtml(it.problema || '-') +
      '</b><br><span style="color:#0d9488;font-weight:700">&rarr; ' +
      escapeHtml(it.accion || '') +
      '</span>' +
      actionBtn +
      '</div>';
    html += '</div>';
  });
  return html;
}

function renderSegDead(items) {
  if (!items.length)
    return (
      '<div class="seg-empty">Todos los clientes tuvieron actividad reciente. ' +
      'Umbrales aplicados: sin visita 30d Y sin pedido 45d.</div>'
    );
  let html =
    '<div class="seg-row head"><div>Estado</div><div>Vendedor</div><div>Cliente</div><div>Dias sin act.</div><div>Ult. visita / pedido + facturacion + accion</div></div>';
  items.forEach((it) => {
    const lbl = it.status === 'red' ? 'CRITICO' : 'REVISAR';
    html += '<div class="seg-row" onclick="openSegTimeline(\'' + escapeAttr(it.clientKey) + '\')">';
    html +=
      '<div><span class="seg-status-dot ' +
      it.status +
      '"></span><span class="seg-badge ' +
      it.status +
      '">' +
      lbl +
      '</span></div>';
    html += '<div>' + escapeHtml(titleCase(it.vendor || '')) + '</div>';
    html +=
      '<div><b>' +
      escapeHtml(it.client || '-') +
      '</b><br><span style="font-size:10px;color:#94a3b8">' +
      escapeHtml(it.loc || '') +
      '</span></div>';
    html += '<div><b style="color:#dc2626">' + it.daysAgo + 'd</b></div>';
    html +=
      '<div>Visita: ' +
      escapeHtml(it.lastVisit || '-') +
      ' &middot; Pedido: ' +
      escapeHtml(it.lastOrder || '-') +
      (it.facturacion
        ? '<br>Facturacion historica: <b>$' +
          Math.round(it.facturacion).toLocaleString('es-AR') +
          '</b>'
        : '') +
      '<br><span style="color:#0d9488;font-weight:700">&rarr; ' +
      escapeHtml(it.accion || '') +
      '</span></div>';
    html += '</div>';
  });
  return html;
}

function renderSegOpps(items) {
  if (!items.length)
    return '<div class="seg-empty">No detect&eacute; oportunidades en el rango.<br>Las oportunidades se detectan por palabras clave en los comentarios de visita (interesado, potencial, cierre, reposicion, cotiza...).</div>';
  return renderSegPendientes(items);
}

function renderSegDuplas(duplas) {
  const arr = Object.values(duplas);
  if (!arr.length) return '<div class="seg-empty">No hay duplas con actividad en el rango.</div>';
  let html =
    '<div style="font-size:11px;color:#64748b;margin-bottom:8px;font-weight:700;padding:8px 12px;background:#f0fdfa;border-left:3px solid #0d9488;border-radius:5px">Tasa de conversion visita &rarr; pedido = pedidos confirmados / visitas. Es la metrica clave para evaluar si las visitas generan negocio real.</div>';
  arr.sort((a, b) => (b.fact || 0) - (a.fact || 0));
  arr.forEach((d) => {
    const conv = d.visitas ? Math.round((d.pedidosConf / d.visitas) * 100) : 0;
    const cls = conv >= 50 ? '' : conv >= 25 ? 'yellow' : 'red';
    const convBg = conv >= 50 ? '#dcfce7' : conv >= 25 ? '#fef3c7' : '#fee2e2';
    html += '<div class="seg-vendor-card ' + cls + '">';
    html +=
      '<h4>' +
      escapeHtml(titleCase(d.interno)) +
      ' &middot; ' +
      escapeHtml(titleCase(d.externo)) +
      '</h4>';
    html +=
      '<div class="vmetrics">' +
      '<div class="vm"><b>' +
      d.visitas +
      '</b>Visitas</div>' +
      '<div class="vm"><b>' +
      d.pedidos +
      '</b>Pedidos</div>' +
      '<div class="vm"><b>' +
      d.pedidosConf +
      '</b>Confirmados</div>' +
      '<div class="vm" style="background:' +
      convBg +
      '"><b>' +
      conv +
      '%</b>Conv v&rarr;p</div>' +
      '<div class="vm"><b>$' +
      Math.round(d.fact).toLocaleString('es-AR') +
      '</b>Facturacion</div>' +
      '<div class="vm"><b>' +
      d.clientes.size +
      '</b>Clientes</div>' +
      '<div class="vm"><b>' +
      d.pendientes +
      '</b>Pend. confirmar</div>' +
      '<div class="vm"><b>' +
      (d.lastAct || '-') +
      '</b>Ult. actividad</div>' +
      '</div></div>';
  });
  return html;
}

window.openSegTimeline = function (clientKey) {
  if (!canViewSeguimiento()) return;
  const parts = (clientKey || '').split('|');
  const vendor = parts[0],
    prov = parts[1],
    loc = parts[2],
    name = parts[3];
  if (!vendorInSeguimientoScope(vendor)) {
    alert('No tenes permisos para ver este cliente.');
    return;
  }
  currentSegTimelineKey = clientKey;
  document.getElementById('seg-tl-title').textContent = name || '(cliente)';
  document.getElementById('seg-tl-sub').innerHTML =
    escapeHtml(titleCase(vendor || '')) +
    ' &middot; ' +
    escapeHtml(loc || '') +
    ' / ' +
    escapeHtml(titleCase(prov || ''));
  const items = [];
  (segVisitsCache || [])
    .filter(
      (v) => v.vendor === vendor && v.provincia === prov && v.localidad === loc && v.tienda === name
    )
    .forEach((v) => {
      items.push({
        type: 'visit',
        date: (v.fecha || '').slice(0, 10),
        title: 'Visita',
        body:
          (v.comentario || v.observaciones || '(sin comentarios)') +
          (v.proximaAccion ? '\nProxima accion: ' + v.proximaAccion : ''),
      });
    });
  (globalPedidos || [])
    .filter(
      (p) =>
        segPedidoVendor(p) === vendor &&
        p.province === prov &&
        p.locName === loc &&
        p.clientName === name
    )
    .forEach((p) => {
      const dt = (p.confirmedAt || p.finalizedAt || '').slice(0, 10);
      const amt = p.netAmountArs != null ? p.netAmountArs : p.subtotalArs || 0;
      const units = (p.lines || []).reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
      items.push({
        type: 'order',
        date: dt,
        title:
          'Pedido ' +
          (p.stage === 'confirmed' ? 'confirmado' : p.stage === 'pending' ? 'pendiente' : p.stage),
        body:
          '$' +
          Math.round(amt).toLocaleString('es-AR') +
          ' / ' +
          units.toFixed(0) +
          ' u / ' +
          (p.lines || []).length +
          ' SKU(s)',
      });
    });
  (segNotesCache || [])
    .filter((n) => n.clientKey === clientKey)
    .forEach((n) => {
      const dt =
        n.createdAt && n.createdAt.toDate ? n.createdAt.toDate().toISOString().slice(0, 10) : '';
      items.push({
        type: 'note',
        date: dt,
        title: 'Nota interna - ' + (n.authorName || n.authorEmail || ''),
        body: n.text || '',
      });
    });
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  let html = '<div class="seg-timeline">';
  if (!items.length)
    html += '<div class="seg-empty">Sin actividad registrada para este cliente.</div>';
  items.forEach((it) => {
    html += '<div class="seg-timeline-item ' + it.type + '">';
    html += '<div class="seg-timeline-date">' + escapeHtml(it.date || '(s/f)') + '</div>';
    html += '<div class="seg-timeline-title">' + escapeHtml(it.title) + '</div>';
    html +=
      '<div class="seg-timeline-body">' +
      escapeHtml(it.body || '').replace(/\n/g, '<br>') +
      '</div>';
    html += '</div>';
  });
  html += '</div>';
  const curStatus = segStatusCache[clientKey] || '';
  html +=
    '<div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 12px;margin-top:14px;border-radius:6px">';
  html +=
    '<div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Estado de seguimiento interno (no afecta visita ni pedido original)</div>';
  html += '<div class="seg-status-row">';
  [
    ['pendiente', 'Marcar pendiente'],
    ['revisado', 'Marcar revisado'],
    ['resuelto', 'Marcar resuelto'],
  ].forEach((s) => {
    const act = curStatus === s[0] ? 'active' : '';
    html +=
      '<button class="seg-status-btn ' +
      act +
      '" onclick="setSegStatus(\'' +
      escapeAttr(clientKey) +
      "','" +
      s[0] +
      '\')">' +
      s[1] +
      '</button>';
  });
  html += '</div></div>';
  html += '<div class="seg-note-form">';
  html +=
    '<div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px">Nota interna entre interno y externo (no modifica la visita)</div>';
  html +=
    '<textarea id="seg-note-input" placeholder="Ej: revisado, lo llamo mañana para cerrar reposicion"></textarea>';
  html += '<button onclick="saveSegNote(\'' + escapeAttr(clientKey) + '\')">Guardar nota</button>';
  html += '</div>';
  document.getElementById('seg-tl-content').innerHTML = html;
  document.getElementById('seg-timeline-modal').classList.add('open');
};

window.closeSegTimeline = function () {
  document.getElementById('seg-timeline-modal').classList.remove('open');
  currentSegTimelineKey = null;
};

window.saveSegNote = async function (clientKey) {
  if (!canViewSeguimiento()) return;
  const parts = (clientKey || '').split('|');
  const vendor = parts[0];
  if (!vendorInSeguimientoScope(vendor)) {
    alert('Sin permisos.');
    return;
  }
  const ta = document.getElementById('seg-note-input');
  const text = ((ta && ta.value) || '').trim();
  if (!text) return;
  try {
    await fbDb.collection('seguimiento_notes').add({
      clientKey,
      vendorExt: vendor,
      prov: parts[1],
      loc: parts[2],
      clientName: parts[3],
      authorUid: currentUser.uid,
      authorEmail: currentUser.email || '',
      authorName: currentUser.displayName || currentUser.email || '',
      authorRole: userRole,
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (ta) ta.value = '';
    if (typeof showSyncTag === 'function') showSyncTag('Nota interna guardada');
  } catch (e) {
    alert(
      'Error guardando nota: ' +
        (e.message || e) +
        '\n\nProbable: faltan rules en Firestore para "seguimiento_notes".'
    );
  }
};

window.setSegStatus = async function (clientKey, status) {
  if (!canViewSeguimiento()) return;
  const parts = (clientKey || '').split('|');
  const vendor = parts[0];
  if (!vendorInSeguimientoScope(vendor)) {
    alert('Sin permisos.');
    return;
  }
  const docId = clientKey.replace(/[/\\#?]/g, '_').slice(0, 400) + '__' + (currentUser.uid || '');
  try {
    await fbDb.collection('seguimiento_status').doc(docId).set(
      {
        clientKey,
        vendorExt: vendor,
        prov: parts[1],
        loc: parts[2],
        clientName: parts[3],
        authorUid: currentUser.uid,
        status,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    if (typeof showSyncTag === 'function') showSyncTag('Estado: ' + status);
  } catch (e) {
    alert('Error: ' + (e.message || e) + '\n\nProbable: faltan rules para "seguimiento_status".');
  }
};
