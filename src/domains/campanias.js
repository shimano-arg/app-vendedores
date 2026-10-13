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
  document.querySelectorAll('.tt-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tt === t);
  });
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
      '<div style="color:var(--text-muted);font-size:11px;padding:14px;text-align:center">Seleccione familia y subfamilia primero</div>';
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
    '<div style="color:var(--text-muted);font-size:11px;padding:14px;text-align:center">Seleccione una subfamilia</div>';
  updateSkuCounter();
};

window.onCampSubfamiliaChange = function () {
  const fam = document.getElementById('cf-familia').value;
  const sub = document.getElementById('cf-subfamilia').value;
  const container = document.getElementById('cf-skus');
  if (!fam || !sub) {
    container.innerHTML =
      '<div style="color:var(--text-muted);font-size:11px;padding:14px;text-align:center">Seleccione una subfamilia</div>';
    updateSkuCounter();
    return;
  }
  const matched = PRODUCTS.filter((p) => p.fam === fam && p.sub === sub);
  if (!matched.length) {
    container.innerHTML =
      '<div style="color:var(--text-muted);font-size:11px;padding:14px;text-align:center">No hay SKUs para esta combinacion.</div>';
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
  document.querySelectorAll('.cf-sku-check').forEach((cb) => {
    cb.checked = true;
  });
  updateSkuCounter();
};
window.clearAllSkus = function () {
  document.querySelectorAll('.cf-sku-check').forEach((cb) => {
    cb.checked = false;
  });
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
        '<div style="font-size:11px;color:var(--text-muted);padding:14px;background:var(--bg-secondary);border-radius:6px;text-align:center">' +
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
          '<div class="cli-meta" style="color:#7c2d12;font-weight:600;margin-top:3px;font-size:10px">' +
          escapeHtml(estado) +
          '</div>';
      }
      html +=
        '<div class="camp-list-item"' +
        (tab === 'history'
          ? ' style="opacity:.85;background:var(--bg-secondary);border-color:var(--border-subtle)"'
          : '') +
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
      // v438: SKUs desplegables con boton × por cada uno (solo en activas — en
      // historicas es read-only). Feedback Mariano: "puse SKUs de mas y quiero
      // sacar sin borrar toda la campaña".
      if (Array.isArray(c.skus) && c.skus.length > 0) {
        html +=
          '<details class="cli-skus" style="margin-top:6px"><summary style="cursor:pointer;font-size:10px;color:var(--text-secondary);user-select:none;font-weight:700">' +
          (tab === 'active' ? 'Editar SKUs' : 'Ver SKUs') +
          ' (' +
          c.skus.length +
          ')</summary>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;padding:6px 0;border-top:1px dashed var(--border-subtle)">';
        c.skus.forEach((sku) => {
          const skuSafe = escapeHtml(sku);
          const skuAttr = escapeAttr(sku);
          html +=
            '<span style="background:var(--bg-muted);padding:2px 6px;border-radius:4px;font-size:10px;font-family:monospace;display:inline-flex;align-items:center;gap:4px">' +
            skuSafe;
          if (tab === 'active') {
            html +=
              '<button onclick="removeSkuFromCampaign(\'' +
              c._id +
              "','" +
              skuAttr +
              '\')" title="Quitar este SKU de la campaña" style="background:var(--color-danger);color:#fff;border:none;border-radius:3px;padding:0 5px;font-size:11px;line-height:1.4;cursor:pointer;font-weight:700">×</button>';
          }
          html += '</span>';
        });
        html += '</div></details>';
      }
      html += estadoLine + '</div>';
      // Boton: en active = finalizar; en history = eliminar definitivo.
      if (tab === 'active') {
        html +=
          '<button class="cli-del" onclick="finalizarCampaign(\'' +
          c._id +
          '\')" title="Finalizar campa&ntilde;a manualmente (queda en Hist&oacute;ricas)" style="background:var(--color-warning)"></button>';
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
      '<div style="color:var(--color-danger);font-size:11px">Error: ' + (e.message || e) + '</div>';
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

// v438: quitar un SKU puntual de una campaña activa (para corregir cuando
// se cargó de más). Usa arrayRemove atómico de Firestore. Solo admin/gerente
// pueden ejecutar — el modal Campañas ya está gated por rol en openCampaignsPanel.
window.removeSkuFromCampaign = async function (campId, sku) {
  if (userRole !== 'admin' && userRole !== 'gerente') return;
  if (!campId || !sku) return;
  if (
    !confirm(
      'Quitar el SKU "' +
        sku +
        '" de esta campaña?\n\nSe puede volver a agregar creando una campaña nueva.'
    )
  )
    return;
  try {
    if (typeof logOp === 'function') logOp('remove_sku_campaign', 'campaign', campId, { sku });
    await fbDb
      .collection('campaigns')
      .doc(campId)
      .update({
        skus: firebase.firestore.FieldValue.arrayRemove(sku),
      });
    await refreshCampaignsList();
    showSyncTag('SKU eliminado de la campaña');
  } catch (e) {
    console.error('removeSkuFromCampaign', e);
    alert('Error al quitar el SKU: ' + (e.message || e));
  }
};

// === Alcance de campaña: all / province / vendor ===
let cfScope = 'all';
window.setCampScope = function (s) {
  cfScope = s;
  document.querySelectorAll('.scope-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.scope === s);
  });
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
          return v ? v.zone + ' ' + displayVendorName(k) : k;
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

// ============================================================
// v1247 (2026-10-13): importar campañas comerciales desde Excel.
// Columnas: NOMBRE | VENDEDOR | FECHA_INICIO | FECHA_FIN | SKU | UNIDADES | MONTO
// Regla: 1 fila = 1 campaña (vendedor obligatorio, UNIDADES o MONTO exclusivos).
// ============================================================

function _findSkuMeta(sku) {
  const code = String(sku || '')
    .toUpperCase()
    .trim();
  if (!code) return null;
  if (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS)) {
    for (const p of PRODUCTS) {
      if (
        p &&
        String(p.code || '')
          .toUpperCase()
          .trim() === code
      )
        return p;
    }
  }
  return null;
}

function _normalizeVendorForMatch(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function _findVendorKey(vendorInput) {
  const target = _normalizeVendorForMatch(vendorInput);
  if (!target) return null;
  // VENDORS array (const en index.html:6531) tiene objetos {key, zone, label, ...}.
  if (typeof VENDORS !== 'undefined' && Array.isArray(VENDORS)) {
    for (const v of VENDORS) {
      if (!v) continue;
      const vk = _normalizeVendorForMatch(v.key || v.vendorKey || '');
      if (vk === target) return v.key || v.vendorKey;
    }
  }
  return null;
}

function _parseExcelDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    // Excel serial date → epoch ms. 25569 = días desde 1899-12-30 a 1970-01-01.
    const ms = (val - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function _validateCampaignRow(raw, rowNum) {
  const errors = [];
  const name = String(raw.NOMBRE || raw.nombre || '').trim();
  const vendorInput = String(raw.VENDEDOR || raw.vendedor || '').trim();
  const startDate = _parseExcelDate(raw.FECHA_INICIO || raw['FECHA DE INICIO'] || raw.fecha_inicio);
  const endDate = _parseExcelDate(raw.FECHA_FIN || raw['FECHA DE FINALIZACION'] || raw.fecha_fin);
  const sku = String(raw.SKU || raw.sku || '')
    .toUpperCase()
    .trim();
  const unidades = raw.UNIDADES != null && raw.UNIDADES !== '' ? Number(raw.UNIDADES) : null;
  const monto = raw.MONTO != null && raw.MONTO !== '' ? Number(raw.MONTO) : null;

  if (!name) errors.push('NOMBRE vacío');
  if (!vendorInput) errors.push('VENDEDOR vacío');
  if (!startDate) errors.push('FECHA_INICIO inválida');
  if (!endDate) errors.push('FECHA_FIN inválida');
  if (startDate && endDate && endDate < startDate) errors.push('FECHA_FIN < FECHA_INICIO');
  if (!sku) errors.push('SKU vacío');
  const hasUnid = unidades != null && !Number.isNaN(unidades) && unidades > 0;
  const hasMonto = monto != null && !Number.isNaN(monto) && monto > 0;
  if (hasUnid && hasMonto) errors.push('UNIDADES y MONTO ambos presentes — sólo uno');
  if (!hasUnid && !hasMonto) errors.push('Falta UNIDADES o MONTO (uno obligatorio)');

  const skuMeta = sku ? _findSkuMeta(sku) : null;
  if (sku && !skuMeta) errors.push('SKU no existe en catálogo PESCA');

  const vendorKey = vendorInput ? _findVendorKey(vendorInput) : null;
  if (vendorInput && !vendorKey) errors.push('VENDEDOR no matchea sap_vendors');

  return {
    rowNum,
    raw,
    name,
    vendorInput,
    vendorKey,
    startDate,
    endDate,
    sku,
    skuMeta,
    unidades: hasUnid ? unidades : null,
    monto: hasMonto ? monto : null,
    targetType: hasUnid ? 'units' : 'money',
    targetAmount: hasUnid ? unidades : monto,
    errors,
    ok: errors.length === 0,
  };
}

window.handleCampaignImportFile = async function (ev) {
  const file = ev && ev.target && ev.target.files && ev.target.files[0];
  ev.target.value = ''; // reset para permitir re-cargar el mismo archivo
  if (!file) return;
  const preview = document.getElementById('camp-import-preview');
  if (!preview) return;
  preview.style.display = '';
  preview.textContent = 'Cargando ExcelJS...';
  try {
    if (typeof window.loadExcelJS === 'function') await window.loadExcelJS();
    if (!window.ExcelJS) throw new Error('ExcelJS no disponible');
    const buf = await file.arrayBuffer();
    const wb = new window.ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Excel sin hojas');
    // Header en row 1.
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
      headers.push(
        String(cell.value || '')
          .trim()
          .toUpperCase()
      );
    });
    const rows = [];
    ws.eachRow((row, rn) => {
      if (rn === 1) return;
      const obj = {};
      row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        const h = headers[colIdx - 1];
        if (!h) return;
        let v = cell.value;
        if (v && typeof v === 'object' && 'text' in v) v = v.text; // rich text
        if (v && typeof v === 'object' && 'result' in v) v = v.result; // formula
        obj[h] = v;
      });
      // Skip rows completamente vacías.
      if (Object.values(obj).every((x) => x == null || x === '')) return;
      rows.push({ raw: obj, rowNum: rn });
    });
    if (!rows.length) {
      preview.textContent = 'Excel vacío (sin filas después del header).';
      return;
    }
    const validated = rows.map((r) => _validateCampaignRow(r.raw, r.rowNum));
    _renderCampaignImportPreview(preview, validated);
  } catch (e) {
    console.error('[camp-import]', e);
    preview.textContent = 'Error leyendo Excel: ' + (e.message || e);
  }
};

function _renderCampaignImportPreview(container, rows) {
  const okRows = rows.filter((r) => r.ok);
  const badRows = rows.filter((r) => !r.ok);
  while (container.firstChild) container.removeChild(container.firstChild);
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;margin-bottom:8px';
  const info = document.createElement('div');
  info.style.cssText = 'font-size:12px';
  const okB = document.createElement('b');
  okB.style.color = '#16a34a';
  okB.textContent = okRows.length + ' OK';
  const badB = document.createElement('b');
  badB.style.color = '#dc2626';
  badB.textContent = badRows.length + ' con error';
  info.appendChild(okB);
  info.appendChild(document.createTextNode(' · '));
  info.appendChild(badB);
  info.appendChild(document.createTextNode(' · total ' + rows.length));
  header.appendChild(info);
  const btnBar = document.createElement('div');
  btnBar.style.cssText = 'display:flex;gap:6px';
  const btnCreate = document.createElement('button');
  btnCreate.type = 'button';
  btnCreate.textContent = 'Crear ' + okRows.length + ' campaña(s)';
  btnCreate.disabled = okRows.length === 0;
  btnCreate.style.cssText =
    'background:#16a34a;color:#fff;border:none;border-radius:6px;padding:7px 12px;font-size:11.5px;font-weight:700;cursor:pointer' +
    (okRows.length === 0 ? ';opacity:.5;cursor:not-allowed' : '');
  btnCreate.onclick = () => window._executeCampaignImport(okRows);
  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.textContent = 'Cancelar';
  btnCancel.style.cssText =
    'background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:6px;padding:7px 12px;font-size:11.5px;font-weight:700;cursor:pointer';
  btnCancel.onclick = () => {
    container.style.display = 'none';
    while (container.firstChild) container.removeChild(container.firstChild);
  };
  btnBar.appendChild(btnCreate);
  btnBar.appendChild(btnCancel);
  header.appendChild(btnBar);
  container.appendChild(header);

  // Tabla preview
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.style.cssText = 'background:var(--bg-muted);text-align:left';
  ['#', 'Nombre', 'Vendedor', 'SKU', 'Desde', 'Hasta', 'Meta', 'Estado'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    th.style.cssText =
      'padding:6px 8px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:var(--text-muted)';
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.style.cssText =
      'border-bottom:1px solid #f1f5f9;background:' + (r.ok ? '#f0fdf4' : '#fef2f2');
    const metaStr =
      r.targetType === 'units'
        ? r.unidades + ' u'
        : '$' + Math.round(r.targetAmount).toLocaleString('es-AR');
    const statusText = r.ok ? 'OK' : r.errors.join(', ');
    [
      String(r.rowNum),
      r.name || '—',
      r.vendorKey || r.vendorInput || '—',
      r.sku || '—',
      r.startDate || '—',
      r.endDate || '—',
      r.ok ? metaStr : '—',
      statusText,
    ].forEach((val, i) => {
      const td = document.createElement('td');
      td.textContent = val;
      td.style.cssText = 'padding:5px 8px;color:' + (r.ok ? '#166534' : '#991b1b');
      if (i === 7 && !r.ok) td.style.fontWeight = '700';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'max-height:300px;overflow:auto;border:1px solid var(--border-subtle);border-radius:6px';
  wrap.appendChild(table);
  container.appendChild(wrap);
}

window._executeCampaignImport = async function (okRows) {
  if (!okRows || okRows.length === 0) return;
  const btn = event && event.currentTarget;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creando...';
  }
  let created = 0;
  const failed = [];
  for (const r of okRows) {
    try {
      const familia = (r.skuMeta && (r.skuMeta.fam || r.skuMeta.familia)) || '';
      const subfamilia = (r.skuMeta && (r.skuMeta.sub || r.skuMeta.subfamilia)) || '';
      await fbDb.collection('campaigns').add({
        name: r.name,
        familia,
        subfamilia,
        skus: [r.sku],
        filterType: 'sku',
        filterValues: [r.sku],
        targetType: r.targetType,
        targetAmount: r.targetAmount,
        startDate: r.startDate,
        endDate: r.endDate,
        scope: 'vendor',
        scopeValues: [r.vendorKey],
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        importedFromExcel: true,
      });
      created++;
    } catch (e) {
      console.error('[camp-import] row ' + r.rowNum, e);
      failed.push({ row: r.rowNum, error: e.message || String(e) });
    }
  }
  if (typeof showSyncTag === 'function') showSyncTag('Campañas importadas: ' + created);
  await refreshCampaignsList();
  const preview = document.getElementById('camp-import-preview');
  if (preview) {
    preview.style.display = 'none';
    while (preview.firstChild) preview.removeChild(preview.firstChild);
  }
  if (failed.length > 0) {
    alert(
      'Creadas: ' +
        created +
        '\nFallaron: ' +
        failed.length +
        '\n\nDetalle:\n' +
        failed
          .slice(0, 5)
          .map((f) => 'Fila ' + f.row + ': ' + f.error)
          .join('\n')
    );
  } else {
    alert('Creadas ' + created + ' campaña(s) correctamente.');
  }
};

window.downloadCampaignTemplate = async function () {
  try {
    if (typeof window.loadExcelJS === 'function') await window.loadExcelJS();
    if (!window.ExcelJS) throw new Error('ExcelJS no disponible');
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet('Campañas');
    ws.columns = [
      { header: 'NOMBRE', key: 'nombre', width: 25 },
      { header: 'VENDEDOR', key: 'vendedor', width: 24 },
      { header: 'FECHA_INICIO', key: 'inicio', width: 14 },
      { header: 'FECHA_FIN', key: 'fin', width: 14 },
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'UNIDADES', key: 'unid', width: 10 },
      { header: 'MONTO', key: 'monto', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    // 2 filas de ejemplo (una unidades, una monto)
    const today = new Date().toISOString().slice(0, 10);
    const nextMonth = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
    ws.addRow([
      'Ejemplo campaña unidades',
      'GONZALO DE LA ROSA',
      today,
      nextMonth,
      'fx2000fc',
      100,
      null,
    ]);
    ws.addRow([
      'Ejemplo campaña monto',
      'GONZALO DE LA ROSA',
      today,
      nextMonth,
      'fx2000fc',
      null,
      400000,
    ]);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'template-campanas.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    console.error('[camp-template]', e);
    alert('Error generando template: ' + (e.message || e));
  }
};
