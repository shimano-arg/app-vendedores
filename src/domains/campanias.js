// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline): fbDb, firebase,
// currentUser, userRole, PRODUCTS, VENDORS, POINTS, escapeHtml, escapeAttr,
// titleCase, logOp, showSyncTag. Módulo extraído verbatim: tipado real fuera
// de scope E2.c (verbatim first, refactor después).
//
// CAMPAÑAS - Admin CRUD (crear, listar, finalizar, eliminar) + scope + aplicabilidad.
// Extraído verbatim de index.html (líneas 26168-26481 pre-E2.c) como parte
// de E2.c (e2b-perf 2026-07-28). Preserva 100% del comportamiento.
//
// Los 3 `let` internos (cfTargetType, currentCampTab, cfScope) se mantienen
// como `let` local al módulo bundle porque no tienen callers cross-scope
// (verificado con grep). Las 16 funciones window.* + las 2 helpers necesarias
// externamente (isCampaignApplicableToVendor, describeCampaignScope) se
// exponen al final del módulo.

// === Campañas - Admin CRUD ===
let cfTargetType = 'units';
window.setTargetType = function (t) {
  cfTargetType = t;
  document
    .querySelectorAll('.tt-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.tt === t));
  document.getElementById('cf-target-amount').placeholder = t === 'money' ? '100000' : '100';
};

window.openCampaignsPanel = async function () {
  if (userRole !== 'admin' && userRole !== 'gerente') return;
  document.getElementById('campaigns-modal').classList.add('open');
  populateCampFamilias();
  document.getElementById('cf-familia').value = '';
  onCampFamiliaChange();
  const today = new Date();
  document.getElementById('cf-start').value = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 60 * 86400 * 1000);
  document.getElementById('cf-end').value = end.toISOString().slice(0, 10);
  document.getElementById('cf-name').value = '';
  document.getElementById('cf-target-amount').value = '';
  setTargetType('units');
  // Reset al tab Activas por default cada vez que se abre el panel.
  if (typeof setCampaignsTab === 'function') setCampaignsTab('active');
  else await refreshCampaignsList();
};
window.closeCampaignsPanel = function () {
  document.getElementById('campaigns-modal').classList.remove('open');
};

function populateCampFamilias() {
  const fams = [...new Set(PRODUCTS.map((p) => p.fam).filter(Boolean))].sort();
  document.getElementById('cf-familia').innerHTML =
    '<option value="">Seleccionar...</option>' +
    fams
      .map((f) => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>')
      .join('');
}

window.onCampFamiliaChange = function () {
  const fam = document.getElementById('cf-familia').value;
  const subSel = document.getElementById('cf-subfamilia');
  if (!fam) {
    subSel.innerHTML = '<option value="">Seleccionar familia primero...</option>';
    document.getElementById('cf-skus').innerHTML =
      '<div style="color:#94a3b8;font-size:11px;padding:14px;text-align:center">Seleccione familia y subfamilia primero</div>';
    updateSkuCounter();
    return;
  }
  const subs = [
    ...new Set(
      PRODUCTS.filter((p) => p.fam === fam)
        .map((p) => p.sub)
        .filter(Boolean)
    ),
  ].sort();
  subSel.innerHTML =
    '<option value="">Seleccionar...</option>' +
    subs
      .map((s) => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>')
      .join('');
  document.getElementById('cf-skus').innerHTML =
    '<div style="color:#94a3b8;font-size:11px;padding:14px;text-align:center">Seleccione una subfamilia</div>';
  updateSkuCounter();
};

window.onCampSubfamiliaChange = function () {
  const fam = document.getElementById('cf-familia').value;
  const sub = document.getElementById('cf-subfamilia').value;
  const container = document.getElementById('cf-skus');
  if (!fam || !sub) {
    container.innerHTML =
      '<div style="color:#94a3b8;font-size:11px;padding:14px;text-align:center">Seleccione una subfamilia</div>';
    updateSkuCounter();
    return;
  }
  const matched = PRODUCTS.filter((p) => p.fam === fam && p.sub === sub);
  if (!matched.length) {
    container.innerHTML =
      '<div style="color:#94a3b8;font-size:11px;padding:14px;text-align:center">No hay SKUs para esta combinacion.</div>';
    updateSkuCounter();
    return;
  }
  let html =
    '<div class="sku-actions-row"><button type="button" class="sku-action-btn" onclick="selectAllSkus()">Marcar todos</button><button type="button" class="sku-action-btn" onclick="clearAllSkus()">Desmarcar todos</button></div>';
  matched.forEach((p) => {
    html +=
      '<label class="sku-row"><input type="checkbox" class="cf-sku-check" value="' +
      escapeAttr(p.code) +
      '" onchange="updateSkuCounter()"/><span class="code">' +
      escapeHtml(p.code) +
      '</span><span class="desc">' +
      escapeHtml(p.desc) +
      '</span></label>';
  });
  container.innerHTML = html;
  updateSkuCounter();
};

window.selectAllSkus = function () {
  document.querySelectorAll('.cf-sku-check').forEach((cb) => (cb.checked = true));
  updateSkuCounter();
};
window.clearAllSkus = function () {
  document.querySelectorAll('.cf-sku-check').forEach((cb) => (cb.checked = false));
  updateSkuCounter();
};
window.updateSkuCounter = function () {
  const count = document.querySelectorAll('.cf-sku-check:checked').length;
  const counter = document.getElementById('cf-skus-counter');
  if (counter) counter.textContent = count + ' SKU seleccionado(s)';
};

// Tab actual del listado: 'active' (default) muestra campañas vigentes -
// startDate <= hoy <= endDate y NO archivadas manualmente. 'history' muestra
// las terminadas (por fecha o por X manual).
let currentCampTab = 'active';
window.setCampaignsTab = function (tab) {
  currentCampTab = tab;
  document.getElementById('camp-tab-active').classList.toggle('active', tab === 'active');
  document.getElementById('camp-tab-active').style.background =
    tab === 'active' ? '#fff' : 'transparent';
  document.getElementById('camp-tab-active').style.color = tab === 'active' ? '#0f172a' : '#475569';
  document.getElementById('camp-tab-active').style.boxShadow =
    tab === 'active' ? '0 1px 2px rgba(0,0,0,.06)' : 'none';
  document.getElementById('camp-tab-history').classList.toggle('active', tab === 'history');
  document.getElementById('camp-tab-history').style.background =
    tab === 'history' ? '#fff' : 'transparent';
  document.getElementById('camp-tab-history').style.color =
    tab === 'history' ? '#0f172a' : '#475569';
  document.getElementById('camp-tab-history').style.boxShadow =
    tab === 'history' ? '0 1px 2px rgba(0,0,0,.06)' : 'none';
  refreshCampaignsList();
};

async function refreshCampaignsList() {
  const listEl = document.getElementById('campaigns-list');
  const tab = currentCampTab || 'active';
  try {
    const qs = await fbDb.collection('campaigns').orderBy('startDate', 'desc').get();
    const todayISO = new Date().toISOString().slice(0, 10);
    // Clasificar: una campaña es "historica" si endDate < hoy, si fue
    // archivada manualmente, o si todavia no arranco pero fue cancelada.
    const all = [];
    qs.forEach((d) => {
      all.push(Object.assign({ _id: d.id }, d.data()));
    });
    const active = all.filter(
      (c) => !c.archivedManually && c.endDate >= todayISO && c.startDate <= todayISO
    );
    const history = all.filter((c) => c.archivedManually || c.endDate < todayISO);
    // Pendiente arranque (startDate > hoy) tambien va a active para que el admin las vea.
    all.forEach((c) => {
      if (
        !c.archivedManually &&
        c.startDate > todayISO &&
        c.endDate >= todayISO &&
        !active.includes(c)
      )
        active.push(c);
    });
    // Actualizar contadores de las tabs.
    const aCountEl = document.getElementById('camp-tab-active-count');
    const hCountEl = document.getElementById('camp-tab-history-count');
    if (aCountEl) aCountEl.textContent = active.length;
    if (hCountEl) hCountEl.textContent = history.length;
    const list = tab === 'history' ? history : active;
    if (!list.length) {
      const msg =
        tab === 'history'
          ? 'Todavia no hay campa&ntilde;as terminadas. Cuando una campa&ntilde;a llegue a su fecha final o la finalices manualmente, aparece aca.'
          : 'No hay campa&ntilde;as activas. Crea una arriba o revisa "Hist&oacute;ricas".';
      listEl.innerHTML =
        '<div style="font-size:11px;color:#94a3b8;padding:14px;background:#f8fafc;border-radius:6px;text-align:center">' +
        msg +
        '</div>';
      return;
    }
    let html = '';
    list.forEach((c) => {
      const target =
        c.targetType === 'money'
          ? '$' + (c.targetAmount || 0).toLocaleString('es-AR')
          : (c.targetAmount || 0) + ' unid.';
      let desc;
      if (c.familia && c.subfamilia) {
        const nSkus = Array.isArray(c.skus) ? c.skus.length : 0;
        desc = c.familia + ' / ' + c.subfamilia + ' &middot; ' + nSkus + ' SKU';
      } else {
        desc = (c.filterType || '') + ': ' + (c.filterValues || []).join(', ');
      }
      const scopeDesc = describeCampaignScope(c);
      const scopeColor =
        c.scope === 'province' ? '#0284c7' : c.scope === 'vendor' ? '#7c3aed' : '#475569';
      // Estado (solo en historicas): manual vs auto + fecha de finalizacion.
      let estadoLine = '';
      if (tab === 'history') {
        let estado = c.archivedManually
          ? 'Finalizada manualmente'
          : 'Finalizada por fecha (' + c.endDate + ')';
        const archivedAt =
          c.archivedAt && c.archivedAt.toDate
            ? c.archivedAt.toDate().toLocaleDateString('es-AR')
            : '';
        if (c.archivedManually && archivedAt) estado += ' el ' + archivedAt;
        if (c.archivedBy) estado += ' por ' + c.archivedBy;
        estadoLine =
          '<div class="cli-meta" style="color:#7c2d12;font-weight:600;margin-top:3px;font-size:10px">&#9202; ' +
          escapeHtml(estado) +
          '</div>';
      }
      html +=
        '<div class="camp-list-item"' +
        (tab === 'history' ? ' style="opacity:.85;background:#f8fafc;border-color:#e2e8f0"' : '') +
        '>';
      html += '<div style="flex:1"><div class="cli-name">' + escapeHtml(c.name) + '</div>';
      html +=
        '<div class="cli-meta">' +
        desc +
        ' &middot; ' +
        c.startDate +
        ' a ' +
        c.endDate +
        ' &middot; ' +
        target +
        '</div>';
      html +=
        '<div class="cli-meta" style="color:' +
        scopeColor +
        ';font-weight:700;margin-top:3px">' +
        escapeHtml(scopeDesc) +
        '</div>';
      html += estadoLine + '</div>';
      // Boton: en active = finalizar; en history = eliminar definitivo.
      if (tab === 'active') {
        html +=
          '<button class="cli-del" onclick="finalizarCampaign(\'' +
          c._id +
          '\')" title="Finalizar campa&ntilde;a manualmente (queda en Hist&oacute;ricas)" style="background:#f59e0b">&#9201;</button>';
      } else {
        html +=
          '<button class="cli-del" onclick="deleteCampaign(\'' +
          c._id +
          '\')" title="Eliminar definitivamente (no se puede recuperar)">&times;</button>';
      }
      html += '</div>';
    });
    listEl.innerHTML = html;
  } catch (e) {
    console.error('refreshCampaignsList', e);
    listEl.innerHTML =
      '<div style="color:#dc2626;font-size:11px">Error: ' + (e.message || e) + '</div>';
  }
}

// Finalizar manualmente: NO borra el doc, lo marca como archivado y mueve
// la campania a la pestania Historicas. Asi conservamos historial completo
// (nombre, fechas, scope, SKUs, target, etc) para futuras consultas.
window.finalizarCampaign = async function (id) {
  if (
    !confirm(
      'Finalizar manualmente esta campaña?\n\nVa a quedar en la pestaña Históricas. NO se borra - podes consultarla siempre que quieras.'
    )
  )
    return;
  try {
    const snap = await fbDb.collection('campaigns').doc(id).get();
    const data = snap.exists ? snap.data() : {};
    if (typeof logOp === 'function')
      logOp('finalizar_campaña', 'campaign', data.name || id, { id });
    await fbDb
      .collection('campaigns')
      .doc(id)
      .set(
        {
          archivedManually: true,
          archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
          archivedBy: (currentUser && currentUser.email) || '',
        },
        { merge: true }
      );
    await refreshCampaignsList();
    showSyncTag('Campaña finalizada (movida a Históricas)');
  } catch (e) {
    console.error('finalizarCampaign', e);
    alert('Error: ' + (e.message || e));
  }
};

// === Alcance de campaña: all / province / vendor ===
let cfScope = 'all';
window.setCampScope = function (s) {
  cfScope = s;
  document
    .querySelectorAll('.scope-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.scope === s));
  document.getElementById('cf-scope-provinces').style.display = s === 'province' ? '' : 'none';
  document.getElementById('cf-scope-vendors').style.display = s === 'vendor' ? '' : 'none';
  if (s === 'province') populateScopeProvinces();
  if (s === 'vendor') populateScopeVendors();
};
function populateScopeProvinces() {
  const set = new Set();
  POINTS.forEach((p) => {
    if (p.province) set.add(p.province);
  });
  const provs = [...set].sort();
  let html = '';
  provs.forEach((p) => {
    html +=
      '<label class="cf-sku-item"><input type="checkbox" class="cf-scope-province-check" value="' +
      escapeAttr(p) +
      '" onchange="updateScopeCounters()"/><span>' +
      escapeHtml(titleCase(p)) +
      '</span></label>';
  });
  document.getElementById('cf-province-list').innerHTML = html;
  updateScopeCounters();
}
function populateScopeVendors() {
  let html = '';
  VENDORS.forEach((v) => {
    html +=
      '<label class="cf-sku-item"><input type="checkbox" class="cf-scope-vendor-check" value="' +
      escapeAttr(v.key) +
      '" onchange="updateScopeCounters()"/><span>' +
      escapeHtml(v.zone + ' &middot; ' + titleCase(v.key)) +
      '</span></label>';
  });
  document.getElementById('cf-vendor-list').innerHTML = html;
  updateScopeCounters();
}
window.updateScopeCounters = function () {
  const nP = document.querySelectorAll('.cf-scope-province-check:checked').length;
  const nV = document.querySelectorAll('.cf-scope-vendor-check:checked').length;
  const elP = document.getElementById('cf-province-counter');
  const elV = document.getElementById('cf-vendor-counter');
  if (elP) elP.textContent = nP + ' provincia(s) seleccionada(s)';
  if (elV) elV.textContent = nV + ' vendedor(es) seleccionado(s)';
};

window.saveCampaign = async function () {
  const name = document.getElementById('cf-name').value.trim();
  const familia = document.getElementById('cf-familia').value;
  const subfamilia = document.getElementById('cf-subfamilia').value;
  const skus = [...document.querySelectorAll('.cf-sku-check:checked')].map((cb) => cb.value);
  const targetType = cfTargetType;
  const targetAmount = parseFloat(document.getElementById('cf-target-amount').value) || 0;
  const startDate = document.getElementById('cf-start').value;
  const endDate = document.getElementById('cf-end').value;
  let scopeValues = [];
  if (cfScope === 'province') {
    scopeValues = [...document.querySelectorAll('.cf-scope-province-check:checked')].map(
      (cb) => cb.value
    );
    if (!scopeValues.length) {
      alert('Elegi al menos una provincia para el alcance.');
      return;
    }
  } else if (cfScope === 'vendor') {
    scopeValues = [...document.querySelectorAll('.cf-scope-vendor-check:checked')].map(
      (cb) => cb.value
    );
    if (!scopeValues.length) {
      alert('Elegi al menos un vendedor para el alcance.');
      return;
    }
  }
  if (!name) {
    alert('Falta el nombre de la campaña.');
    return;
  }
  if (!familia) {
    alert('Elegi una familia.');
    return;
  }
  if (!subfamilia) {
    alert('Elegi una subfamilia.');
    return;
  }
  if (!skus.length) {
    alert('Tenes que marcar al menos 1 SKU.');
    return;
  }
  if (!startDate || !endDate) {
    alert('Faltan las fechas.');
    return;
  }
  if (endDate < startDate) {
    alert('Fecha hasta debe ser posterior a desde.');
    return;
  }
  if (!targetAmount) {
    alert('Falta el monto del objetivo.');
    return;
  }
  try {
    await fbDb.collection('campaigns').add({
      name,
      familia,
      subfamilia,
      skus,
      filterType: 'sku',
      filterValues: skus,
      targetType,
      targetAmount,
      startDate,
      endDate,
      scope: cfScope,
      scopeValues,
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showSyncTag('Campaña creada');
    await refreshCampaignsList();
    document.getElementById('cf-name').value = '';
    document.getElementById('cf-target-amount').value = '';
    document.getElementById('cf-familia').value = '';
    onCampFamiliaChange();
    setCampScope('all'); // reset al default
  } catch (e) {
    console.error(e);
    alert('Error: ' + (e.message || e));
  }
};

// === Aplicabilidad de campañas por vendedor ===
function getProvincesForVendor(vendorKey) {
  const set = new Set();
  POINTS.forEach((p) => {
    if (p.vendor === vendorKey && p.province) set.add(p.province);
  });
  return set;
}
function isCampaignApplicableToVendor(camp, vendorKey) {
  if (!camp || !vendorKey) return false;
  const scope = camp.scope || 'all';
  if (scope === 'all') return true;
  const values = camp.scopeValues || [];
  if (scope === 'vendor') return values.indexOf(vendorKey) >= 0;
  if (scope === 'province') {
    const provs = getProvincesForVendor(vendorKey);
    return values.some((p) => provs.has(p));
  }
  return true;
}
function describeCampaignScope(camp) {
  const scope = camp.scope || 'all';
  if (scope === 'all') return 'Todas las zonas';
  const values = camp.scopeValues || [];
  if (scope === 'province') return 'Provincias: ' + values.map(titleCase).join(', ');
  if (scope === 'vendor') {
    return (
      'Vendedor: ' +
      values
        .map((k) => {
          const v = VENDORS.find((x) => x.key === k);
          return v ? v.zone + ' ' + titleCase(k) : k;
        })
        .join(', ')
    );
  }
  return 'Todas las zonas';
}

window.deleteCampaign = async function (id) {
  if (!confirm('Eliminar esta campaña?')) return;
  try {
    const snap = await fbDb.collection('campaigns').doc(id).get();
    const data = snap.exists ? snap.data() : {};
    logOp('eliminar_campaña', 'campaign', data.name || id, { id });
    await fbDb.collection('campaigns').doc(id).delete();
    await refreshCampaignsList();
    showSyncTag('Campaña eliminada');
  } catch (e) {
    console.error(e);
    alert('Error: ' + (e.message || e));
  }
};

// === Exports a window para callers cross-scope ===
// Las 2 helpers (isCampaignApplicableToVendor + describeCampaignScope) tienen
// callers fuera del dominio (líneas 16257, 18068, 24549-50, 25864, 24588 pre-E2.c).
// El resto de las funciones ya se declaran como `window.foo = function(){}`.
window.isCampaignApplicableToVendor = isCampaignApplicableToVendor;
window.describeCampaignScope = describeCampaignScope;
