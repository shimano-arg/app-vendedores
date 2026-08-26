// @ts-nocheck
// ADMIN-USERS: Panel Admin completo con 6 subdominios (allowed emails, Gemini,
// Gmaps, bulk approver, admin panel principal, 2FA/TOTP, change password) +
// saveUserRole + deleteUserRole. Extraído verbatim de index.html (2 fragmentos
// discontinuos separados por SAP domain stubs) como parte de E2.o (e2b-perf 2026-07-28).
// ULTIMO dominio grande a extraer.
//
// v551 (2026-08-19) SECURITY: eliminado el KNOWN BUG del geminiApiKeyCache
// cross-module. La key ya no vive en Firestore ni cachea nada frontend —
// se movio a Secret Manager y se accede via callable geminiOcrProxy.
//
// Cross-scope state: usersCache, gmapsApiKeyCache, totpSetupState (let local al bundle,
// compartidos intra-bundle). PROTECTED_ADMIN_EMAILS (const dentro de openAdminPanel).

// =====================================================================
// SECCIÓN: F1: usersCache + allowed-emails + gemini + gmaps + bulk-approver + openAdminPanel + closeAdminPanel (inline L11619-12131)
// =====================================================================

// CROSS-SCOPE (E6 fix, code review C1): syncUsersDirectory (bundle notificaciones)
// lee usersCache como identifier libre. En bundle "use strict" un read a
// identifier no-declarado ni en window tira ReferenceError. Promocionar a
// window.usersCache preserva la referencia entre bundle admin-users (chunk lazy)
// y bundle notificaciones (shell).
if (typeof window.usersCache === 'undefined') window.usersCache = [];
const usersCache = window.usersCache;

function renderAllowedEmailsSection(allowedList) {
  const el = document.getElementById('allowed-emails-section');
  if (!el) return;
  allowedList = (allowedList || [])
    .slice()
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  let html = '<div style="text-align:center;margin-bottom:10px">';
  html += '<div style="font-size:12px;font-weight:800;color:#1e40af">Emails pre-autorizados</div>';
  html +=
    '<div style="font-size:10px;color:#64748b;margin-top:2px">Si un vendedor usa Gmail personal (no @shimano.com.ar), agregalo aca antes que intente loguear. Los emails @shimano.com.ar y los admins hardcoded ya estan autorizados automaticamente.</div>';
  html += '</div>';
  if (!allowedList.length) {
    html +=
      '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px 0 10px">No hay emails pre-autorizados todavia.</div>';
  } else {
    html +=
      '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:10px">';
    allowedList.forEach((ae) => {
      const label = escapeHtml(ae.email || ae._id);
      const note = ae.note ? ' &middot; ' + escapeHtml(ae.note) : '';
      html +=
        '<div style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #bfdbfe;border-radius:14px;padding:3px 4px 3px 10px;font-size:11px;color:#1e40af;font-weight:600">' +
        label +
        note +
        '<button onclick="removeAllowedEmail(\'' +
        escapeAttr(ae._id) +
        '\')" title="Quitar autorizacion" style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1">&times;</button>' +
        '</div>';
    });
    html += '</div>';
  }
  html +=
    '<div style="text-align:center"><button class="app-btn-pill app-btn-blue" onclick="addAllowedEmail()">&#43; Agregar email</button></div>';
  el.innerHTML = html;
}

window.addAllowedEmail = async function () {
  if (userRole !== 'admin') return;
  const raw = prompt('Email a autorizar (ej. automatrix.oficial@gmail.com):');
  if (!raw) return;
  const email = raw.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('El email no parece valido.');
    return;
  }
  const note =
    prompt('Nota corta opcional (ej. "Vendedor Z1 Gonzalo" o "Reemplazo de Mauricio"):', '') || '';
  const docId = emailToDocId(email);
  try {
    await fbDb
      .collection('allowed_emails')
      .doc(docId)
      .set(
        {
          email,
          note: note.trim(),
          addedBy: currentUser.email || '',
          addedByUid: currentUser.uid,
          addedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    showSyncTag('Email autorizado: ' + email);
    // Recargar panel
    try {
      openAdminPanel();
    } catch (_e) {}
  } catch (e) {
    console.error('addAllowedEmail', e);
    alert('Error: ' + (e.message || e));
  }
};

window.removeAllowedEmail = async function (docId) {
  if (userRole !== 'admin') return;
  if (
    !confirm(
      'Quitar la autorizacion de este email? Si el usuario ya tiene rol asignado en el panel, va a seguir entrando (la regla pre-aprobada por rol tambien aplica).'
    )
  )
    return;
  try {
    await fbDb.collection('allowed_emails').doc(docId).delete();
    showSyncTag('Autorizacion quitada');
    try {
      openAdminPanel();
    } catch (_e) {}
  } catch (e) {
    console.error('removeAllowedEmail', e);
    alert('Error: ' + (e.message || e));
  }
};

// === Seccion Gemini API Key (admin) ===
function renderGeminiConfigSection(_data) {
  const el = document.getElementById('gemini-config-section');
  if (!el) return;
  // v551 (2026-08-19) SECURITY: la key vive en Secret Manager, no en Firestore.
  // v639 (2026-08-26): UX simplificado por pedido Mariano — sin instrucciones
  // CLI en el panel, solo un banner explicando donde vive la key.
  // Se administra por CLI (firebase functions:secrets:set GEMINI_API_KEY).
  el.textContent = '';
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'text-align:center;padding:14px 12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:6px';
  title.textContent = 'Gemini API Key (OCR de tickets)';
  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:11px;color:#64748b';
  // Icono candado + texto. textContent es safe (no HTML parsing).
  msg.textContent = '🔒 Guardado por seguridad en Google Secret Manager';
  wrap.appendChild(title);
  wrap.appendChild(msg);
  el.appendChild(wrap);
}

// v551: saveGeminiApiKey + deleteGeminiApiKey eliminados. La key vive
// en Secret Manager, no en Firestore. Se administra por CLI. Ver
// renderGeminiConfigSection para las instrucciones.

// ============================================================
// GOOGLE MAPS Geocoding API - mejor cobertura en AR rural que OSM
// ============================================================
// La key se guarda en app_config/google_maps. Si esta seteada, la usamos
// como geocoder PRIMARIO en geocodeClientAddress; si falla o no esta
// seteada, caemos a la cascada OSM Nominatim como fallback.
let gmapsApiKeyCache = null;
async function getGmapsApiKey() {
  if (gmapsApiKeyCache) return gmapsApiKeyCache;
  try {
    const snap = await fbDb.collection('app_config').doc('google_maps').get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.apiKey) {
        gmapsApiKeyCache = d.apiKey;
        return d.apiKey;
      }
    }
  } catch (e) {
    console.warn('[gmaps] no se pudo leer api key', e);
  }
  return null;
}
function renderGmapsConfigSection(data) {
  const el = document.getElementById('gmaps-config-section');
  if (!el) return;
  const hasKey = data && data.apiKey;
  const masked = hasKey ? data.apiKey.slice(0, 4) + '••••••••••' + data.apiKey.slice(-4) : '';
  const updatedBy = (data && data.updatedBy) || '';
  const updatedAt =
    data && data.updatedAt && data.updatedAt.toDate
      ? data.updatedAt.toDate().toLocaleString('es-AR')
      : '';
  let html = '<div style="text-align:center;margin-bottom:10px">';
  html +=
    '<div style="font-size:12px;font-weight:800;color:#065f46">Google Maps API Key (geocoding)</div>';
  html +=
    '<div style="font-size:10px;color:#64748b;margin-top:2px">Convierte direcciones a coordenadas con mucha mejor precisión que OSM (sobre todo en localidades chicas). Costo gratis hasta 40.000 requests/mes.</div>';
  html += '</div>';
  if (hasKey) {
    html +=
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;justify-content:center">';
    html +=
      '<span style="font-family:Consolas,monospace;font-size:11px;background:#fff;border:1px solid #6ee7b7;border-radius:4px;padding:4px 8px;color:#065f46">' +
      escapeHtml(masked) +
      '</span>';
    html +=
      '<span style="font-size:10px;color:#64748b">Cargada por ' +
      escapeHtml(updatedBy || 'admin') +
      (updatedAt ? ' (' + escapeHtml(updatedAt) + ')' : '') +
      '</span>';
    html += '</div>';
  } else {
    html +=
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;text-align:center">Sin API key. Geocoding usa OpenStreetMap (gratis pero peor cobertura en AR rural).</div>';
  }
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">';
  html +=
    '<button class="app-btn-pill app-btn-cyan" onclick="saveGmapsApiKey()" style="background:#10b981">' +
    (hasKey ? 'Cambiar key' : 'Cargar key') +
    '</button>';
  if (hasKey)
    html +=
      '<button class="app-btn-pill app-btn-red" onclick="deleteGmapsApiKey()">Borrar</button>';
  html += '</div>';
  el.innerHTML = html;
}
window.saveGmapsApiKey = async function () {
  if (userRole !== 'admin') return;
  const raw = prompt(
    'Pega aca la API key de Google Maps (formato AIzaSy...).\n\nIMPORTANTE: en Google Cloud Console restringi la key por HTTP referrer a https://shimano-arg.github.io/* para que nadie te la robe.',
    ''
  );
  if (raw === null) return;
  const key = raw.trim();
  if (!key) {
    alert('Vacia.');
    return;
  }
  if (key.length < 20) {
    alert('La key parece muy corta. Revisa que la pegaste completa.');
    return;
  }
  try {
    await fbDb
      .collection('app_config')
      .doc('google_maps')
      .set(
        {
          apiKey: key,
          updatedBy: currentUser.email || '',
          updatedByUid: currentUser.uid,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    gmapsApiKeyCache = key;
    showSyncTag('Google Maps API key guardada');
    try {
      openAdminPanel();
    } catch (_e) {}
  } catch (e) {
    console.error('saveGmapsApiKey', e);
    alert('Error: ' + (e.message || e));
  }
};
window.deleteGmapsApiKey = async function () {
  if (userRole !== 'admin') return;
  if (
    !confirm(
      'Borrar la API key de Google Maps? El geocoding vuelve a OSM (peor cobertura en AR rural).'
    )
  )
    return;
  try {
    await fbDb.collection('app_config').doc('google_maps').delete();
    gmapsApiKeyCache = null;
    showSyncTag('Google Maps API key borrada');
    try {
      openAdminPanel();
    } catch (_e) {}
  } catch (e) {
    console.error('deleteGmapsApiKey', e);
    alert('Error: ' + (e.message || e));
  }
};

// ============================================================
// BULK APPROVER - asignar el mismo "Responsable de rendiciones"
// a todos los vendedores de un solo click.
// ============================================================
// Util cuando un solo aprobador (ej. Pablo gerente) revisa las
// rendiciones de TODOS los vendedores. Sin esto el admin tiene que
// abrir cada fila del panel Usuarios y setear el dropdown una a una.
function renderBulkApproverSection() {
  const el = document.getElementById('bulk-approver-section');
  if (!el) return;
  const candidates = (usersCache || []).filter(
    (u) => u.role === 'admin' || u.role === 'gerente' || u.role === 'interno'
  );
  const vendedores = (usersCache || []).filter((u) => u.role === 'vendedor');
  let html = '<div style="text-align:center;margin-bottom:10px">';
  html +=
    '<div style="font-size:12px;font-weight:800;color:#a21caf">Aprobador de Rendiciones - asignacion masiva</div>';
  html +=
    '<div style="font-size:10px;color:#64748b;margin-top:2px">Aplica el mismo responsable a TODOS los vendedores de un solo click. Util cuando un gerente comercial centraliza la aprobacion.</div>';
  html += '</div>';
  if (!candidates.length) {
    html +=
      '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px 0">No hay usuarios con rol admin / gerente / interno. Primero asigna un rol a alguien.</div>';
    el.innerHTML = html;
    return;
  }
  if (!vendedores.length) {
    html +=
      '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px 0">No hay usuarios con rol vendedor todavia.</div>';
    el.innerHTML = html;
    return;
  }
  html +=
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center">';
  html +=
    '<select id="bulk-approver-select" style="padding:8px 10px;border:1.5px solid #f0abfc;border-radius:6px;font-size:12px;background:#fff;font-family:inherit;flex:1;max-width:340px">';
  html += '<option value="">- Elegir aprobador -</option>';
  candidates.forEach((u) => {
    const lbl = (u.displayName || u.email || u._uid) + ' (' + u.role + ')';
    html += '<option value="' + escapeAttr(u._uid) + '">' + escapeHtml(lbl) + '</option>';
  });
  html += '</select>';
  html +=
    '<button class="app-btn-pill app-btn-violet" onclick="bulkAssignApprover()">Asignar a TODOS los vendedores (' +
    vendedores.length +
    ')</button>';
  html += '</div>';
  el.innerHTML = html;
}
window.bulkAssignApprover = async function () {
  if (userRole !== 'admin') {
    alert('Solo admin.');
    return;
  }
  const sel = document.getElementById('bulk-approver-select');
  const uid = sel && sel.value;
  if (!uid) {
    alert('Eleg&iacute; un aprobador del dropdown.');
    return;
  }
  const approver = (usersCache || []).find((u) => u._uid === uid);
  if (!approver) {
    alert('Aprobador no encontrado.');
    return;
  }
  const vendedores = (usersCache || []).filter((u) => u.role === 'vendedor');
  if (!vendedores.length) {
    alert('No hay vendedores para asignar.');
    return;
  }
  const approverLabel = approver.displayName || approver.email || approver._uid;
  if (
    !confirm(
      'Asignar a ' +
        approverLabel +
        ' como aprobador de los ' +
        vendedores.length +
        ' vendedores?\n\nVa a sobrescribir cualquier aprobador previo asignado a cada vendedor.'
    )
  )
    return;
  let okCount = 0,
    _errCount = 0;
  // Update en lote. Usamos un batch de Firestore.
  const batch = fbDb.batch();
  vendedores.forEach((v) => {
    const ref = fbDb.collection('roles').doc(v._uid);
    batch.update(ref, {
      rendicionesApproverUid: uid,
      rendicionesApproverEmail: approver.email || '',
      rendicionesApproverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rendicionesApproverUpdatedBy: currentUser.email || '',
    });
  });
  try {
    await batch.commit();
    okCount = vendedores.length;
    if (typeof logOp === 'function') {
      logOp('bulk_assign_approver', 'roles', approverLabel, {
        approverUid: uid,
        approverEmail: approver.email || '',
        vendedorCount: vendedores.length,
        vendedorUids: vendedores.map((v) => v._uid),
      });
    }
  } catch (e) {
    console.error('bulkAssignApprover', e);
    _errCount = vendedores.length;
    alert('Error: ' + (e.message || e));
  }
  if (okCount) {
    showSyncTag(okCount + ' vendedor(es) asignado(s) a ' + approverLabel);
    try {
      openAdminPanel();
    } catch (_e) {} // refrescar
  }
};

// Geocoding con Google Maps API. Devuelve {lat, lng, display, precision}
// o null si no encontro / sin key.
async function _geocodeWithGoogleMaps(address, locality, provinceCode) {
  const key = await getGmapsApiKey();
  if (!key) return null;
  const prov = typeof titleCase === 'function' ? titleCase(provinceCode || '') : provinceCode || '';
  const fullAddr = [address, locality, prov, 'Argentina'].filter(Boolean).join(', ');
  // region=ar + components=country:AR sesga los resultados a AR.
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    '?address=' +
    encodeURIComponent(fullAddr) +
    '&region=ar' +
    '&components=country:AR' +
    '&language=es' +
    '&key=' +
    encodeURIComponent(key);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data.status === 'OK' && data.results && data.results.length) {
      const res = data.results[0];
      const loc = res.geometry && res.geometry.location;
      if (!loc) return null;
      // location_type indica precision: ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER > APPROXIMATE.
      const lt = (res.geometry && res.geometry.location_type) || '';
      let precision = 'address';
      if (lt === 'APPROXIMATE') precision = 'locality';
      else if (lt === 'GEOMETRIC_CENTER') precision = 'street';
      // Extraer locality + admin_area del response para autocompletar campos
      // que SAP no exporto (Ship-to City vacio es muy comun en BPs viejos).
      const components = res.address_components || [];
      const byType = (t) => {
        const c = components.find((cc) => Array.isArray(cc.types) && cc.types.includes(t));
        return c ? c.long_name || '' : '';
      };
      // Prioridad para localidad: locality > sublocality > administrative_area_level_2.
      const detectedLocality =
        byType('locality') || byType('sublocality') || byType('administrative_area_level_2') || '';
      const detectedProvince = byType('administrative_area_level_1') || '';
      return {
        lat: parseFloat(loc.lat),
        lng: parseFloat(loc.lng),
        display: res.formatted_address || fullAddr,
        precision: precision,
        provider: 'google',
        locationType: lt,
        locality: detectedLocality,
        province: detectedProvince,
      };
    }
    if (data.status === 'ZERO_RESULTS') {
      console.log('[gmaps] ZERO_RESULTS for:', fullAddr);
      return null;
    }
    if (data.status === 'REQUEST_DENIED') {
      console.error(
        '[gmaps] REQUEST_DENIED:',
        data.error_message ||
          '(sin detalle). Revisar que la API key tenga habilitada Geocoding API y el referrer permita este dominio.'
      );
      return null;
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      console.error('[gmaps] OVER_QUERY_LIMIT - excedio el limite. Caemos a OSM.');
      return null;
    }
    console.warn('[gmaps] status inesperado:', data.status, data.error_message);
    return null;
  } catch (e) {
    console.warn('[gmaps] geocode error:', e);
    return null;
  }
}

window.openAdminPanel = async function () {
  if (userRole !== 'admin') return;
  document.getElementById('admin-modal').classList.add('open');
  // Cargar allowed_emails para mostrar arriba la seccion de pre-autorizaciones
  try {
    const aeQs = await fbDb.collection('allowed_emails').get();
    const allowedList = [];
    aeQs.forEach((d) => {
      allowedList.push(Object.assign({ _id: d.id }, d.data()));
    });
    renderAllowedEmailsSection(allowedList);
  } catch (e) {
    console.warn('load allowed_emails', e);
  }
  // Cargar config Gemini para mostrar la seccion de API key
  try {
    const gSnap = await fbDb.collection('app_config').doc('gemini').get();
    renderGeminiConfigSection(gSnap.exists ? gSnap.data() : null);
  } catch (e) {
    console.warn('load gemini config', e);
    renderGeminiConfigSection(null);
  }
  // Cargar config Google Maps para mostrar la seccion de API key.
  try {
    const gmSnap = await fbDb.collection('app_config').doc('google_maps').get();
    renderGmapsConfigSection(gmSnap.exists ? gmSnap.data() : null);
  } catch (e) {
    console.warn('load gmaps config', e);
    renderGmapsConfigSection(null);
  }
  try {
    const qs = await fbDb.collection('roles').orderBy('email').get();
    // E6 fix C1: vaciar el Array in-place (preserva window.usersCache ref).
    usersCache.length = 0;
    qs.forEach((doc) => {
      usersCache.push(Object.assign({ _uid: doc.id }, doc.data()));
    });
    // Render del bloque "Asignar aprobador a todos los vendedores" arriba de la tabla.
    try {
      renderBulkApproverSection();
    } catch (e) {
      console.warn('bulk approver section', e);
    }
    // Sincronizar el directorio publico de usuarios para que los vendedores
    // puedan ver destinatarios al crear tareas en Notificaciones. Sin esto
    // los vendedores ven el dropdown vacio (security rules bloquean /roles).
    try {
      syncUsersDirectory();
    } catch (e) {
      console.warn('syncUsersDirectory', e);
    }
    // Lista de internos disponibles (para asignar pareja a los vendedores)
    const internos = usersCache.filter((u) => u.role === 'interno');
    const _internoOpts =
      '<option value="">- Sin pareja -</option>' +
      internos
        .map(
          (u) =>
            '<option value="' +
            u._uid +
            '">' +
            escapeHtml(u.email || u.displayName || u._uid) +
            '</option>'
        )
        .join('');

    const tbody = document.getElementById('users-table-body');
    const cardsEl = document.getElementById('users-cards');
    let tableHtml = '';
    let cardsHtml = '';
    if (!usersCache.length) {
      tableHtml =
        '<tr><td colspan="6" style="color:#94a3b8;text-align:center;padding:18px">No hay usuarios todavia. Esperan que ingresen con Google.</td></tr>';
      cardsHtml =
        '<div style="color:#94a3b8;font-size:12px;text-align:center;padding:18px">No hay usuarios todavia. Esperan que ingresen con Google.</div>';
    } else {
      // Admins primarios protegidos: no se pueden eliminar (Mariano + bot corporativo)
      const PROTECTED_ADMIN_EMAILS = ['bot.shimano.pesca@gmail.com', 'erbinomariano@gmail.com'];
      // Para los internos calculamos la relacion inversa: quienes los tienen como pareja
      function vendorsParaInterno(internoUid) {
        return usersCache.filter(
          (u) => u.role === 'vendedor' && u.internalPartnerUid === internoUid
        );
      }
      // Candidatos a responsable de rendiciones: admin, gerente o interno (no vendedores ni viewers ni unassigned)
      const rendApproversCandidates = usersCache.filter(
        (u) => u.role === 'admin' || u.role === 'gerente' || u.role === 'interno'
      );
      usersCache.forEach((d) => {
        const docId = d._uid;
        const isSelf = docId === currentUser.uid;
        const isProtected = PROTECTED_ADMIN_EMAILS.indexOf((d.email || '').toLowerCase()) >= 0;
        const isInterno = d.role === 'interno';
        const roleOptions = ['unassigned', 'admin', 'gerente', 'vendedor', 'interno', 'viewer']
          .map(
            (r) =>
              '<option value="' +
              r +
              '"' +
              (d.role === r ? ' selected' : '') +
              (isSelf && r !== 'admin' ? ' disabled' : '') +
              '>' +
              r +
              '</option>'
          )
          .join('');
        const vendorOptions =
          '<option value="">-</option>' +
          VENDORS.map(
            (v) =>
              '<option value="' +
              v.key +
              '"' +
              (d.vendor === v.key ? ' selected' : '') +
              '>' +
              v.zone +
              ' ' +
              v.key +
              '</option>'
          ).join('');
        // Si es interno, mostrar relacion inversa (vendedores que lo tienen como pareja) en vez del dropdown editable
        let parejaCell;
        if (isInterno) {
          const vinc = vendorsParaInterno(docId);
          if (vinc.length) {
            const list = vinc
              .map((u) => {
                const label = u.displayName ? u.displayName.split(/\s+/)[0] : u.email || '';
                return (
                  escapeHtml(label) +
                  ' <span style="color:#94a3b8">(' +
                  escapeHtml(u.email || '') +
                  ')</span>'
                );
              })
              .join('<br>');
            parejaCell =
              '<div style="font-size:10px;color:#0f172a;line-height:1.5"><div style="font-size:9px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Vendedores externos vinculados (auto)</div>' +
              list +
              '</div>';
          } else {
            parejaCell =
              '<div style="font-size:10px;color:#94a3b8;font-style:italic">Aun ningun vendedor lo tiene como pareja</div>';
          }
          // input oculto para que saveUserRole no pise el valor del rol = interno (no aplica internalPartnerUid)
          parejaCell += '<input type="hidden" class="internal-sel" value=""/>';
        } else {
          const internoOptsForRow =
            '<option value="">- Sin pareja -</option>' +
            internos
              .map(
                (u) =>
                  '<option value="' +
                  u._uid +
                  '"' +
                  (d.internalPartnerUid === u._uid ? ' selected' : '') +
                  '>' +
                  escapeHtml(u.email || u.displayName || u._uid) +
                  '</option>'
              )
              .join('');
          parejaCell =
            '<select class="internal-sel" title="Pareja interno (solo aplica si el rol es vendedor)">' +
            internoOptsForRow +
            '</select>';
        }
        const youTag = isSelf
          ? ' <span style="color:#7c3aed;font-size:9px;font-weight:800">(VOS)</span>'
          : '';
        const protectedTag =
          isProtected && !isSelf
            ? ' <span style="color:#7c3aed;font-size:9px;font-weight:800" title="Admin protegido - no se puede eliminar">&#128274; PROTEGIDO</span>'
            : '';
        const waVal = d.whatsapp || '';
        const waInputHtml =
          '<input type="tel" class="wa-input" placeholder="ej. 5491126762031" value="' +
          escapeAttr(waVal) +
          '" style="width:100%;padding:5px 7px;border:1.5px solid #cbd5e1;border-radius:4px;font-size:11px;font-family:inherit;outline:none;background:#fff" title="Numero WhatsApp completo con codigo de pais (sin + ni espacios). Se usa al enviar la ruta."/>';
        // Dropdown 'Responsable de rendiciones'
        const curApproverUid = d.rendicionesApproverUid || '';
        let rendApproverOptions = '<option value="">- Sin asignar -</option>';
        rendApproversCandidates.forEach((u) => {
          if (u._uid === docId) return; // un usuario no puede ser su propio aprobador
          const lbl = (u.displayName || u.email || u._uid) + ' (' + (u.role || '') + ')';
          rendApproverOptions +=
            '<option value="' +
            escapeAttr(u._uid) +
            '"' +
            (curApproverUid === u._uid ? ' selected' : '') +
            '>' +
            escapeHtml(lbl) +
            '</option>';
        });
        const rendApproverHtml =
          '<select class="rend-approver-sel" title="Quien aprueba las rendiciones de este usuario">' +
          rendApproverOptions +
          '</select>';
        // Botón Cambiar contraseña
        const pwdBtnHtml =
          '<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px" onclick="changeUserPassword(\'' +
          docId +
          "', " +
          JSON.stringify(d.email || '').replace(/"/g, '&quot;') +
          ')">&#128274; Contraseña</button>';
        // Botón Configurar 2FA
        const totpStatusTag = d.totpEnabled
          ? ' <span style="color:#10b981;font-weight:800">&#10003;</span>'
          : '';
        const totpBtnHtml =
          '<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px;background:' +
          (d.totpEnabled ? '#10b981' : '#5b21b6') +
          '" onclick="openTotpSetup(\'' +
          docId +
          "', " +
          JSON.stringify(d.email || '').replace(/"/g, '&quot;') +
          ')">&#128272; 2FA' +
          totpStatusTag +
          '</button>';
        // Desktop row
        tableHtml += '<tr data-uid="' + docId + '">';
        tableHtml += '<td>' + escapeHtml(d.email || '') + youTag + protectedTag + '</td>';
        tableHtml += '<td>' + escapeHtml(d.displayName || '') + '</td>';
        tableHtml += '<td><select class="role-sel">' + roleOptions + '</select></td>';
        tableHtml += '<td><select class="vendor-sel">' + vendorOptions + '</select></td>';
        tableHtml += '<td>' + parejaCell + '</td>';
        tableHtml += '<td>' + waInputHtml + '</td>';
        tableHtml += '<td>' + rendApproverHtml + '</td>';
        tableHtml += '<td>' + pwdBtnHtml + '</td>';
        tableHtml += '<td>' + totpBtnHtml + '</td>';
        const showDelete = !isSelf && !isProtected;
        const delBtn = showDelete
          ? '<button class="rm-user-btn" onclick="deleteUserRole(\'' +
            docId +
            '\')">Eliminar</button>'
          : '';
        tableHtml +=
          '<td>' +
          delBtn +
          '<button class="save-btn" onclick="saveUserRole(\'' +
          docId +
          '\', this)">Guardar</button></td>';
        tableHtml += '</tr>';
        // Mobile card
        cardsHtml += '<div class="users-card" data-uid="' + docId + '">';
        cardsHtml +=
          '<div><div class="uc-email">' +
          escapeHtml(d.email || '') +
          youTag +
          protectedTag +
          '</div>';
        if (d.displayName)
          cardsHtml += '<div class="uc-name">' + escapeHtml(d.displayName) + '</div>';
        cardsHtml += '</div>';
        cardsHtml +=
          '<div class="uc-row"><label>Rol</label><select class="role-sel">' +
          roleOptions +
          '</select></div>';
        cardsHtml +=
          '<div class="uc-row"><label>Vendedor (solo si rol = vendedor)</label><select class="vendor-sel">' +
          vendorOptions +
          '</select></div>';
        if (isInterno) {
          cardsHtml +=
            '<div class="uc-row"><label>Vendedores vinculados (auto)</label>' +
            parejaCell +
            '</div>';
        } else {
          cardsHtml +=
            '<div class="uc-row"><label>Pareja interno (solo si rol = vendedor)</label>' +
            parejaCell +
            '</div>';
        }
        cardsHtml +=
          '<div class="uc-row"><label>WhatsApp (con codigo de pais, sin + ni espacios)</label>' +
          waInputHtml +
          '</div>';
        cardsHtml +=
          '<div class="uc-row"><label>Responsable de rendiciones</label>' +
          rendApproverHtml +
          '</div>';
        cardsHtml +=
          '<div class="uc-row" style="text-align:center;display:flex;gap:6px;justify-content:center;flex-wrap:wrap">' +
          pwdBtnHtml +
          totpBtnHtml +
          '</div>';
        const delBtnC = showDelete
          ? '<button class="rm-user-btn" onclick="deleteUserRole(\'' +
            docId +
            '\')">Eliminar</button>'
          : '';
        cardsHtml +=
          '<div class="uc-actions">' +
          delBtnC +
          '<button class="save-btn" onclick="saveUserRole(\'' +
          docId +
          '\', this)">Guardar</button></div>';
        cardsHtml += '</div>';
      });
    }
    tbody.innerHTML = tableHtml;
    cardsEl.innerHTML = cardsHtml;
    // Actualiza header de tabla con la columna nueva
    const thead = document.querySelector('#users-table thead tr');
    if (thead)
      thead.innerHTML =
        '<th>Email</th><th>Nombre</th><th>Rol</th><th>Vendedor</th><th>Pareja interno</th><th>WhatsApp</th><th>Resp. rendiciones</th><th>Pass</th><th>2FA</th><th></th>';
  } catch (e) {
    console.error('openAdminPanel', e);
    alert('Error cargando usuarios: ' + (e.message || e));
  }
};

window.closeAdminPanel = function () {
  document.getElementById('admin-modal').classList.remove('open');
};

// =====================================================================
// SECCIÓN: F2: deleteUserRole + TOTP + changeUserPassword + saveUserRole (inline L14105-14390)
// =====================================================================

window.deleteUserRole = async function (uid) {
  if (userRole !== 'admin') return;
  if (uid === currentUser.uid) {
    alert('No podes eliminar tu propio acceso.');
    return;
  }
  // Defensa adicional: admins protegidos no se pueden eliminar ni desde consola
  try {
    const snapPre = await fbDb.collection('roles').doc(uid).get();
    const emailPre = (snapPre.exists ? snapPre.data().email || '' : '').toLowerCase();
    const PROTECTED = ['bot.shimano.pesca@gmail.com', 'erbinomariano@gmail.com'];
    if (PROTECTED.indexOf(emailPre) >= 0) {
      alert('Este es un admin protegido (' + emailPre + ') y no se puede eliminar.');
      return;
    }
  } catch (_e) {
    /* si falla la lectura previa, sigue con confirm */
  }
  if (
    !confirm(
      'Eliminar acceso de este usuario?\n\nPierde acceso de inmediato. Si vuelve a entrar con Google va a quedar como "sin rol asignado" hasta que vos lo habilites de nuevo.\n\nSu cuenta Google sigue existiendo, no se borra.'
    )
  )
    return;
  try {
    const snap = await fbDb.collection('roles').doc(uid).get();
    const data = snap.exists ? snap.data() : {};
    logOp('eliminar_usuario', 'user', data.email || uid, {
      uid,
      previousRole: data.role,
      previousVendor: data.vendor,
    });
    await fbDb.collection('roles').doc(uid).delete();
    showSyncTag('Usuario eliminado');
    await openAdminPanel();
  } catch (e) {
    console.error('deleteUserRole', e);
    alert('Error: ' + (e.message || e));
  }
};

// ============================================================
// Panel admin: setup / reset de 2FA por usuario
// ============================================================
let totpSetupState = null; // {uid, email, secret, otpauth}

window.openTotpSetup = async function (uid, email) {
  console.log('[2FA] openTotpSetup called', { uid, email, userRole });
  if (userRole !== 'admin') {
    alert('Solo el administrador puede configurar 2FA para otros usuarios.');
    return;
  }
  if (!uid) {
    alert('Error: UID del usuario no disponible. Recarga la pagina y reintenta.');
    return;
  }
  totpSetupState = null;
  // Modal existe?
  const modal = document.getElementById('totp-setup-modal');
  if (!modal) {
    alert('Error: modal de 2FA no encontrado en el DOM. Recarga la pagina (Ctrl+Shift+R).');
    return;
  }
  const subtEl = document.getElementById('totp-setup-subt');
  if (subtEl) subtEl.textContent = 'Para: ' + (email || uid);
  // Leer estado actual
  let curEnabled = false;
  let curSecret = null;
  try {
    const snap = await fbDb.collection('roles').doc(uid).get();
    if (snap.exists) {
      const d = snap.data() || {};
      curEnabled = !!d.totpEnabled;
      curSecret = d.totpSecret || null;
    } else {
      console.warn('[2FA] doc roles/' + uid + ' no existe');
    }
  } catch (e) {
    console.error('[2FA] error leyendo roles/' + uid, e);
    alert('Error leyendo el estado de 2FA del usuario: ' + (e.message || e));
    return;
  }
  const c = document.getElementById('totp-setup-content');
  if (!c) {
    alert('Error: contenedor del modal de 2FA no encontrado. Recarga la pagina.');
    return;
  }
  if (curEnabled && curSecret) {
    c.innerHTML =
      '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:12px;font-size:12px;color:#166534;text-align:center">' +
      '<b>&#10003; 2FA ya está activo</b> para este usuario.' +
      '<br><span style="font-size:11px">Si lo perdió o cambió de celular, podés generarle uno nuevo (el anterior queda invalidado).</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;justify-content:center;flex-wrap:wrap">' +
      '<button class="app-btn-pill app-btn-violet" onclick="generateNewTotp(\'' +
      escapeAttr(uid) +
      "','" +
      escapeAttr(email || '') +
      '\')">Generar nuevo (resetear)</button>' +
      '<button class="app-btn-pill app-btn-red" onclick="disableTotp(\'' +
      escapeAttr(uid) +
      '\')">Deshabilitar 2FA</button>' +
      '</div>';
  } else {
    c.innerHTML =
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px;font-size:12px;color:#1e40af;text-align:center">' +
      'Este usuario todavía no tiene 2FA configurado. Generá un nuevo código para que lo escanee con Google Authenticator.' +
      '</div>' +
      '<div style="text-align:center;margin-top:14px">' +
      '<button class="app-btn-pill app-btn-violet" onclick="generateNewTotp(\'' +
      escapeAttr(uid) +
      "','" +
      escapeAttr(email || '') +
      '\')">Generar 2FA</button>' +
      '</div>';
  }
  document.getElementById('totp-setup-modal').classList.add('open');
};
window.closeTotpSetupModal = function () {
  document.getElementById('totp-setup-modal').classList.remove('open');
  totpSetupState = null;
};

window.generateNewTotp = async function (uid, email) {
  if (userRole !== 'admin') return;
  const secret = totpGenerateSecret();
  const otpauth = totpBuildOtpauthUrl(secret, email || uid);
  totpSetupState = { uid: uid, email: email, secret: secret, otpauth: otpauth };
  const c = document.getElementById('totp-setup-content');
  c.innerHTML =
    '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:12px;font-size:11px;color:#78350f;margin-bottom:14px">' +
    '<b>Pasos para activar:</b><br>' +
    '1. El usuario instala <b>Google Authenticator</b> en su celular.<br>' +
    '2. Toca "Agregar" / "+" en la app.<br>' +
    '3. Elige "Escanear código QR" y escanea el código abajo (o pega el secret manualmente).<br>' +
    '4. Aparece un código de 6 dígitos en Google Authenticator.<br>' +
    '5. Lo escribe en el input de abajo para confirmar y activar.' +
    '</div>';
  c.innerHTML +=
    '<div style="text-align:center;margin-bottom:14px"><div id="totp-qr-container" style="display:inline-block;background:#fff;padding:10px;border:1px solid #e5e7eb;border-radius:6px">Generando QR...</div></div>';
  c.innerHTML +=
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center;margin-bottom:14px">' +
    '<div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Secret (carga manual si el QR falla)</div>' +
    '<div style="font-family:Consolas,monospace;font-size:13px;font-weight:800;color:#5b21b6;word-break:break-all;letter-spacing:.1em">' +
    escapeHtml(secret) +
    '</div>' +
    '</div>';
  c.innerHTML +=
    '<div style="margin-bottom:10px"><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:5px">Código de verificación de Google Authenticator</label>' +
    '<input type="text" id="totp-confirm-input" inputmode="numeric" maxlength="7" placeholder="000000" style="width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:18px;text-align:center;letter-spacing:.3em;font-weight:800"/></div>';
  c.innerHTML +=
    '<div style="display:flex;gap:8px;justify-content:center"><button class="app-btn-pill app-btn-violet" onclick="confirmTotpSetup()">Verificar y activar</button>' +
    '<button class="app-btn-pill app-btn-red" onclick="closeTotpSetupModal()">Cancelar</button></div>';
  // Lazy-load qrcodejs y generar. Esta libreria pinta el QR directo en el
  // contenedor DOM via canvas/img - no necesita callback toDataURL.
  try {
    await loadQRCodeLib();
    const box = document.getElementById('totp-qr-container');
    if (!box) return;
    box.innerHTML = ''; // limpiar el "Generando QR..."
    new QRCode(box, {
      text: otpauth,
      width: 220,
      height: 220,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    console.warn('[2FA] Error cargando QR lib:', e);
    const box = document.getElementById('totp-qr-container');
    if (box)
      box.innerHTML =
        '<div style="font-size:11px;color:#991b1b;padding:14px">No se pudo cargar la librería QR. Usa el secret manual para configurar.</div>';
  }
};

window.confirmTotpSetup = async function () {
  if (!totpSetupState) return;
  const code = (document.getElementById('totp-confirm-input').value || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) {
    alert('Ingresá los 6 dígitos.');
    return;
  }
  const ok = await totpVerifyCode(totpSetupState.secret, code, 1);
  if (!ok) {
    alert(
      'Código incorrecto. Asegurate de que el secret se cargó bien en Google Authenticator y reintentá.'
    );
    return;
  }
  try {
    await fbDb
      .collection('roles')
      .doc(totpSetupState.uid)
      .update({
        totpSecret: totpSetupState.secret,
        totpEnabled: true,
        totpEnabledAt: firebase.firestore.FieldValue.serverTimestamp(),
        totpEnabledBy: currentUser.email || '',
      });
    showSyncTag('2FA activado para ' + (totpSetupState.email || 'usuario'));
    closeTotpSetupModal();
    try {
      openAdminPanel();
    } catch (_e) {}
  } catch (e) {
    console.error('save totp', e);
    alert('Error guardando: ' + (e.message || e));
  }
};

window.disableTotp = async function (uid) {
  if (userRole !== 'admin') return;
  if (!confirm('Deshabilitar 2FA para este usuario? Va a entrar solo con password.')) return;
  try {
    await fbDb
      .collection('roles')
      .doc(uid)
      .update({
        totpEnabled: false,
        totpSecret: firebase.firestore.FieldValue.delete(),
        totpDisabledBy: currentUser.email || '',
        totpDisabledAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    showSyncTag('2FA deshabilitado');
    closeTotpSetupModal();
    try {
      openAdminPanel();
    } catch (_e) {}
  } catch (e) {
    alert('Error: ' + (e.message || e));
  }
};

window.changeUserPassword = async function (uid, email) {
  if (userRole !== 'admin') return;
  if (!email) {
    alert('Este usuario no tiene email registrado - no se puede resetear.');
    return;
  }
  const choice = prompt(
    'Resetear contraseña de ' +
      email +
      '\n\n' +
      'Elegi una opcion (1 / 2):\n\n' +
      '1) ENVIAR MAIL DE RESETEO (recomendado)\n' +
      '   Le llega a ' +
      email +
      ' un mail de Firebase con un link.\n' +
      '   El usuario clickea, setea su nueva password y vuelve a la app.\n' +
      '   Es lo estandar y funciona seguro.\n\n' +
      '2) Resetear SOLO el password-gate (segunda capa).\n' +
      '   No cambia la password real de Firebase. Sirve si el usuario\n' +
      '   entra por Google y olvido la password-gate de la app, NO si\n' +
      '   olvido la password del login con email.\n\n' +
      'Escribi 1 o 2:',
    '1'
  );
  if (choice === null) return;
  if (choice.trim() === '1') {
    try {
      await fbAuth.sendPasswordResetEmail(email);
      alert(
        'OK - le envie un mail de reseteo a ' +
          email +
          '. Decile que revise inbox y spam. El link expira en 1 hora.'
      );
      try {
        await fbDb
          .collection('roles')
          .doc(uid)
          .update({
            passwordChangedBy: currentUser.email || '',
            passwordChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
            passwordResetMethod: 'firebase_email',
          });
      } catch (_e) {}
    } catch (e) {
      console.error('sendPasswordResetEmail', e);
      alert('Error enviando el mail: ' + (e.message || e));
    }
    return;
  }
  if (choice.trim() === '2') {
    const newPwd = prompt(
      'Nueva password-gate para ' +
        email +
        ':\n\n(Solo afecta la segunda capa de la app, NO el login con email)',
      ''
    );
    if (newPwd === null) return;
    const pwd = (newPwd || '').trim();
    if (pwd.length < 4) {
      alert('La contraseña tiene que tener al menos 4 caracteres.');
      return;
    }
    try {
      const creds = await buildPasswordCredentials(pwd);
      await fbDb
        .collection('roles')
        .doc(uid)
        .update({
          passwordHash: creds.passwordHash,
          passwordSalt: creds.passwordSalt,
          passwordChangedBy: currentUser.email || '',
          passwordChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
          passwordResetMethod: 'gate_only',
        });
      showSyncTag('Password-gate actualizada para ' + email);
    } catch (e) {
      console.error('changeUserPassword gate', e);
      alert('Error guardando: ' + (e.message || e));
    }
    return;
  }
  alert('Opcion no valida. Cancelado.');
};

window.saveUserRole = async function (uid, btn) {
  const container = btn.closest('tr') || btn.closest('.users-card');
  if (!container) return;
  const role = container.querySelector('.role-sel').value;
  const vendor = container.querySelector('.vendor-sel').value || null;
  const internalSel = container.querySelector('.internal-sel');
  const internalPartnerUid = internalSel ? internalSel.value || null : null;
  // WhatsApp: limpiar todo lo que no sea digito (acepta +, espacios, paréntesis, etc.)
  const waInput = container.querySelector('.wa-input');
  const whatsapp = waInput ? (waInput.value || '').replace(/\D/g, '') : '';
  if (whatsapp && whatsapp.length < 8) {
    alert(
      'El numero de WhatsApp es muy corto. Tiene que ser el numero completo con codigo de pais (ej. 5491126762031 para Argentina).'
    );
    return;
  }
  // Responsable de rendiciones (uid del usuario que aprueba)
  const rendApproverSel = container.querySelector('.rend-approver-sel');
  const rendicionesApproverUid = rendApproverSel ? rendApproverSel.value || null : null;
  // Cachear tambien el email del aprobador en el doc del vendedor: los
  // vendedores no pueden leer /roles/{otroUid} por security rules, asi que
  // necesitan el email aca para poder mandar la rendicion (resolveMyRendicionesApprover
  // lo usa como primer fast-path). Sin esto el flujo dependia del directorio
  // publico (users_directory) que solo se sincroniza cuando admin abre el panel.
  let rendicionesApproverEmail = null;
  if (rendicionesApproverUid) {
    const approverUser = (usersCache || []).find((u) => u._uid === rendicionesApproverUid);
    rendicionesApproverEmail = approverUser ? approverUser.email || null : null;
  }
  btn.disabled = true;
  btn.textContent = '...';
  try {
    await fbDb
      .collection('roles')
      .doc(uid)
      .set(
        {
          role,
          vendor,
          internalPartnerUid,
          whatsapp: whatsapp || null,
          rendicionesApproverUid: rendicionesApproverUid,
          rendicionesApproverEmail: rendicionesApproverEmail,
          assignedBy: currentUser.uid,
          assignedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    // Si el usuario edito su propio numero, actualizar el cache local
    if (uid === currentUser.uid) {
      myWhatsappNumber = whatsapp || null;
      myRendicionesApproverUid = rendicionesApproverUid || null;
      myRendicionesApproverEmail = rendicionesApproverEmail || null;
    }
    btn.textContent = 'OK';
    // Re-render del panel asi los dropdowns "Pareja interno" muestran los internos actualizados
    setTimeout(() => {
      try {
        openAdminPanel();
      } catch (e) {
        console.error('refresh admin panel', e);
      }
    }, 400);
  } catch (e) {
    console.error('saveUserRole', e);
    alert('Error guardando: ' + (e.message || e));
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
};

// Todos los handlers window.foo = function... ya son verbatim.
