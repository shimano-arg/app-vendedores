// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline):
// fbDb, firebase, currentUser, userRole, escapeHtml, escapeAttr, titleCase,
// showSyncTag, compressImage, openRendicionDetail (bundle rendiciones),
// openClientApplicationDetail (inline), abrirVisitaParaTienda_real (bundle rutas),
// myNotifications + unsubMyNotifs (top-level lets del inline, visibles via
// free reference gracias al Global Environment Record compartido),
// ensureNotifsListener + updateNotifsBadge (top-level funcs del inline,
// mismo mecanismo).
// Módulo extraído verbatim: tipado real fuera de scope E2.g.
//
// PANEL ALERTAS Y TAREAS (Notificaciones) — panel UI + tabs (Recibidas /
// Realizadas / Crear tarea / Enviadas) + broadcast + task actions.
// Extraído verbatim de index.html (líneas 12512-13730 pre-E2.g) como parte
// de E2.g (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// NOTA: Fragmento parcial del dominio notificaciones. Las declaraciones
// myNotifications/unsubMyNotifs (líneas 12068-69 pre-E2.g) están dentro
// del bloque VDE-VDI compartido y se dejan en el inline. Las funciones
// ensureNotifsListener (12269) + ensureVisitsPartnerListener (12304) +
// updateNotifsBadge (12318) también se dejan en el inline porque están
// intercaladas con VDE-VDI y modal reagendamiento (12335-12511). Extraer
// esas requeriría un mini-plan de reorganización, fuera de scope E2.g.
//
// KNOWN BUG (verbatim preservado): window.markAllNotifsRead está declarada
// DOS veces en el bloque (líneas ~13409 y ~13699 pre-E2.g). La 2da sobrescribe
// la 1ra en runtime. TODO E6 code review: consolidar en una sola implementación.
//
// Cross-scope state (via window):
// - window.unsubMySentTasks: listener con cleanup en detachFirebaseListeners()
//   del inline (línea ~23869 pre-E2.g).
// Locals al módulo: window.notifsTab, mySentTasks, taskFormImages, pendingNotifIdToMarkRead.
// === Notificaciones panel ===
// ============================================================
// PANEL ALERTAS Y TAREAS (tabs: Recibidas / Crear tarea / Enviadas)
// ============================================================
// CROSS-SCOPE (E6 fix C3): updateNotifsBadge del inline (L8519) lee window.notifsTab.
// Bundle strict tira ReferenceError → lista notif no re-renderea en snapshot.
if (typeof window.notifsTab === 'undefined') window.notifsTab = 'recibidas';
let mySentTasks = [];        // notifs creadas por mi tipo task (con status del destinatario)
if (typeof window.unsubMySentTasks === "undefined") window.unsubMySentTasks = null;
// Estado del form "Crear tarea"
let taskFormImages = [];     // base64 strings

function ensureMySentTasksListener(){
  if (unsubMySentTasks || !currentUser || !fbDb) return;
  // Solo filtramos por fromUid (evita necesidad de indice compuesto).
  // El filtro por type === 'task' se aplica en cliente.
  window.unsubMySentTasks = fbDb.collection('notifications')
    .where('fromUid', '==', currentUser.uid)
    .onSnapshot(qs => {
      mySentTasks = [];
      qs.forEach(d => {
        const data = d.data() || {};
        if ((data.type || 'derivacion') !== 'task') return;
        mySentTasks.push(Object.assign({_fsId: d.id}, data));
      });
      mySentTasks.sort((a, b) => {
        const ta = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : 0) : 0;
        const tb = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : 0) : 0;
        return tb - ta;
      });
      const panePeek = document.getElementById('pane-notif');
      const paneVisible = panePeek && panePeek.style.display !== 'none';
      if (paneVisible && window.notifsTab === 'enviadas') renderMySentTasks();
      updateNotifsTabCounts();
    }, err => console.warn('sent tasks listener', err));
}

// openNotifsPanel/closeNotifsPanel quedaron como shims para retro-compat:
// el "modal" de notificaciones ahora es la pestana 'notif' del sidebar.
window.openNotifsPanel = function(){
  setTab('notif');
  ensureMySentTasksListener();
  setNotifsTab(window.notifsTab || 'recibidas');
  populateTaskTargetSelect();
  updateNotifsTabCounts();
};
window.closeNotifsPanel = function(){
  // Antes cerraba el modal. Ahora no hace falta hacer nada porque es una
  // pestana; el usuario puede simplemente cambiar a otra pestana. Lo
  // dejamos como no-op para no romper llamadas legacy.
};
window.populateTaskTargets = function(){
  // Alias defensivo: si en el futuro se llama desde setTab, garantiza que
  // el dropdown de destinatarios se llene.
  try { populateTaskTargetSelect(); } catch(e) {}
};

// ============================================================
// ALTA CLIENTES - solicitud de alta + aprobacion (Santiago + Diego)
// ============================================================
// Aprobadores: se identifican por email. Si necesitas cambiarlos, editar la lista.
const CLIENT_APPLICATION_APPROVER_EMAILS = ['srb90284@gmail.com', 'quilgym@gmail.com'];
const ALTA_CLI_MAX_FOTOS = 5;
let altaCliFiles = {arca: null, iibb: null, fotos: []};
let altaCliMine = [];          // mis solicitudes (vendedor logueado)
// Cross-scope: el inline detachFirebaseListeners hace
//   off('unsubAltaCliMine', unsubAltaCliMine, () => unsubAltaCliMine = null)
// donde `unsubAltaCliMine` es free reference. Sin `window.` explícito, el
// `let` del bundle IIFE NO es visible al inline → off skipeaba → listener leak.
if (typeof window.unsubAltaCliMine === 'undefined') window.unsubAltaCliMine = null;

function ensureAltaCliListener(){
  if (window.unsubAltaCliMine || !currentUser || !fbDb) return;
  // Solo necesito mis propias solicitudes para la sub-tab "Mis solicitudes"
  window.unsubAltaCliMine = fbDb.collection('client_applications')
    .where('ownerUid', '==', currentUser.uid)
    .onSnapshot(qs => {
      altaCliMine = [];
      qs.forEach(d => altaCliMine.push(Object.assign({_fsId: d.id}, d.data())));
      altaCliMine.sort((a, b) => {
        const ta = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : 0) : 0;
        const tb = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : 0) : 0;
        return tb - ta;
      });
      const pane = document.getElementById('ac-pane-mias');
      if (pane && pane.style.display !== 'none') renderAltaCliMisSolicitudes();
      const c = document.getElementById('ac-sub-count-mias');
      if (c) {
        const pendientes = altaCliMine.filter(a => a.status === 'pending_approval').length;
        c.textContent = pendientes > 0 ? pendientes : '';
      }
    }, err => console.warn('alta cli listener', err));
}

function populateAltaCliProvincias(){
  const provs = new Set();
  (POINTS || []).forEach(p => provs.add(p.province));
  const sorted = [...provs].sort();
  // Lleno el select de "Nueva solicitud" y tambien el de "Alta rapida".
  ['ac-provincia', 'ar-provincia'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length > 1) return;
    sorted.forEach(pr => {
      const o = document.createElement('option');
      o.value = pr; o.textContent = titleCase(pr);
      sel.appendChild(o);
    });
  });
}

function buildAltaCliShareUrl(){
  // Base = misma URL pero apuntando a alta-cliente.html
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'alta-cliente.html';
  const params = new URLSearchParams();
  if (currentUser && currentUser.uid) params.set('vendor', currentUser.uid);
  const vname = (currentUser && currentUser.displayName) || (currentUser && currentUser.email) || '';
  if (vname) params.set('vendorName', vname);
  if (currentUser && currentUser.email) params.set('vendorEmail', currentUser.email);
  return base + '?' + params.toString();
}

window.copyAltaCliShareLink = function(){
  const url = buildAltaCliShareUrl();
  // Intentar Clipboard API; fallback a prompt
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showSyncTag('Link copiado. Pegalo y mandalo al cliente.');
    }).catch(() => prompt('Copia el link:', url));
  } else {
    prompt('Copia el link:', url);
  }
};

window.shareAltaCliViaWhatsapp = function(){
  const url = buildAltaCliShareUrl();
  const vname = (currentUser && currentUser.displayName) || (currentUser && currentUser.email) || 'Shimano';
  const msg = 'Hola! Soy ' + vname + ' de Shimano Argentina. Para darte de alta como cliente, '
    + 'completa por favor este formulario con los datos de tu comercio. Una vez aprobado, '
    + 'podes empezar a comprar. Cualquier duda me avisas.\n\n' + url;
  const waUrl = 'https://wa.me/?text=' + encodeURIComponent(msg);
  window.open(waUrl, '_blank');
};

window.setAltaCliSubtab = function(sub){
  document.querySelectorAll('.ac-subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.acsub === sub));
  // v341+ (2026-07-28): sub-tab 'nuevo' + pane #ac-pane-nuevo removidos. Los
  // getElementById se hacen con guard para tolerar el pane eliminado sin tirar.
  const nuevoPane = document.getElementById('ac-pane-nuevo');
  if (nuevoPane) nuevoPane.style.display = sub === 'nuevo' ? '' : 'none';
  document.getElementById('ac-pane-mias').style.display = sub === 'mias' ? '' : 'none';
  const rapidaPane = document.getElementById('ac-pane-rapida');
  if (rapidaPane) rapidaPane.style.display = sub === 'rapida' ? '' : 'none';
  if (sub === 'mias') renderAltaCliMisSolicitudes();
};

// Alta rapida (provisoria): solo 3 campos, sin SAP, sin aprobacion. Se
// crea un doc en client_applications con status='approved' (asi entra
// directo a las listas de tiendas habilitadas) y un flag manualSapPending
// = true para que admin sepa que hay que cargarlo a mano en SAP.
window.submitAltaRapida = async function(){
  if (!currentUser) { alert('No hay sesión activa.'); return; }
  const comercio = (document.getElementById('ar-comercio').value || '').trim();
  const provincia = ((document.getElementById('ar-provincia') || {}).value || '').trim().toUpperCase();
  const localidad = ((document.getElementById('ar-localidad') || {}).value || '').trim();
  const direccion = (document.getElementById('ar-direccion').value || '').trim();
  const dueno = (document.getElementById('ar-dueno').value || '').trim();
  const telefono = (document.getElementById('ar-telefono').value || '').trim();
  // CUIT opcional. Solo digitos para poder matchear con SAP (que a veces
  // trae 20-12345678-9, otras 20123456789). Si el vendedor escribe algo
  // que no es un CUIT valido (menos de 11 digitos), guardamos igual pero
  // avisamos - el match automatico usa strict equality sobre digitos.
  const cuitRaw = (document.getElementById('ar-cuit') || {value:''}).value || '';
  const cuit = cuitRaw.replace(/\D/g, '');
  if (comercio.length < 2) { alert('Completá el nombre del local.'); return; }
  if (!provincia) { alert('Elegí la provincia.'); return; }
  if (localidad.length < 2) { alert('Completá la localidad.'); return; }
  if (direccion.length < 5) { alert('Completá la dirección.'); return; }
  if (dueno.length < 2) { alert('Completá el nombre del dueño / contacto.'); return; }
  if (cuit && cuit.length !== 11) {
    if (!confirm('El CUIT ingresado tiene ' + cuit.length + ' digitos (esperaba 11). Guardar igual?')) return;
  }
  if (!confirm('Confirmar alta rápida de "' + comercio + '"?\n\n'
    + 'Provincia: ' + titleCase(provincia) + '\n'
    + 'Localidad: ' + localidad + '\n'
    + 'Direccion: ' + direccion + '\n'
    + 'Dueño: ' + dueno + (telefono ? '\nTel: ' + telefono : '') + (cuit ? '\nCUIT: ' + cuit : '') + '\n\n'
    + 'El cliente queda habilitado PROVISORIAMENTE (amarillo).\n'
    + 'Vas a poder cargarle pedidos y visitas, pero los pedidos NO se envian\n'
    + 'a SAP hasta que administracion cree el cliente alli.')) return;
  const btn = document.querySelector('#alta-rapida-form .btn-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  // Vendor efectivo: el del vendedor logueado (assignedVendor) o admin.
  const myVendor = (typeof assignedVendor !== 'undefined' && assignedVendor) ? assignedVendor : '';
  // Geocoding fire-and-forget: intentamos pero no bloqueamos el alta.
  let geoPromise = Promise.resolve(null);
  if (typeof geocodeClientAddress === 'function') {
    geoPromise = geocodeClientAddress(direccion, '', '').catch(() => null);
  }
  try {
    const docRef = await fbDb.collection('client_applications').add({
      comercio: comercio,
      fantasia: comercio,
      calle: direccion,
      provincia: provincia,
      localidad: localidad,
      localidadFinal: localidad,
      duenoNombre: dueno,
      telefonoContacto: telefono || '',
      cuit: cuit || '',  // v293+: CUIT opcional para match automatico con SAP
      status: 'approved',
      source: 'alta_rapida',
      manualSapPending: true,  // FLAG: admin tiene que cargar a SAP manual
      assignedVendor: myVendor,
      ownerUid: currentUser.uid,
      ownerEmail: currentUser.email || '',
      ownerName: currentUser.displayName || currentUser.email || '',
      approvals: {[currentUser.uid]: {
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        email: currentUser.email || '',
        name: currentUser.displayName || '',
        note: 'Alta rapida auto-aprobada por el vendedor',
      }},
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Geocoding en background (no bloquea).
    geoPromise.then(geo => {
      if (geo && geo.lat != null && geo.lng != null) {
        const update = {
          lat: geo.lat, lng: geo.lng,
          geoDisplay: geo.display || '',
          geoProvider: geo.provider || 'osm',
          geoAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        const detectedLoc = (geo.locality || '').trim();
        if (detectedLoc) {
          update.localidad = detectedLoc;
          update.localidadFinal = detectedLoc;
        }
        const detectedProv = (geo.province || '').trim();
        if (detectedProv) update.provincia = detectedProv.toUpperCase();
        docRef.set(update, {merge: true}).catch(e => console.warn('geocode update alta rapida', e));
      }
    });
    // Notificar al admin para que sepa que hay un alta provisoria que cargar.
    try {
      const adminsSnap = await fbDb.collection('roles').where('role', '==', 'admin').get();
      const me = currentUser.displayName || currentUser.email || 'Vendedor';
      adminsSnap.forEach(d => {
        fbDb.collection('notifications').add({
          type: 'alta_rapida_creada',
          targetUid: d.id,
          fromUid: currentUser.uid,
          fromEmail: currentUser.email || '',
          title: 'Alta rapida pendiente de carga manual en SAP',
          body: me + ' dio de alta rapida a "' + comercio + '" (' + direccion + ', dueño ' + dueno + '). Hay que cargarlo manualmente en SAP.',
          comercio: comercio,
          status: 'unread',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(()=>{});
      });
    } catch(e) { console.warn('notify admin alta rapida', e); }
    document.getElementById('alta-rapida-form').reset();
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Confirmar cliente y habilitar'; }
    alert('✓ Cliente habilitado provisoriamente.\n\nYa podes cargarle pedidos desde la solapa PEDIDOS.');
  } catch(e) {
    console.error('submitAltaRapida', e);
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Confirmar cliente y habilitar'; }
    alert('Error guardando: ' + (e.message || e));
  }
};

window.onAltaCliFile = async function(input, kind){
  const files = [...(input.files || [])];
  for (const f of files) {
    try {
      const b64 = await compressImage(f, 1400, 0.78);
      if (kind === 'fotos') {
        if (altaCliFiles.fotos.length >= ALTA_CLI_MAX_FOTOS) { alert('Maximo ' + ALTA_CLI_MAX_FOTOS + ' fotos del local.'); break; }
        altaCliFiles.fotos.push(b64);
      } else {
        altaCliFiles[kind] = b64; // reemplaza el anterior
        break;
      }
    } catch(e) { console.warn('compress alta cli', e); }
  }
  input.value = '';
  refreshAltaCliGrid(kind);
};

window.removeAltaCliFile = function(kind, idx){
  if (kind === 'fotos') altaCliFiles.fotos.splice(idx, 1);
  else altaCliFiles[kind] = null;
  refreshAltaCliGrid(kind);
};

function refreshAltaCliGrid(kind){
  const gridId = kind === 'arca' ? 'ac-arca-grid' : kind === 'iibb' ? 'ac-iibb-grid' : 'ac-fotos-grid';
  const grid = document.getElementById(gridId);
  if (!grid) return;
  let cells = '';
  if (kind === 'fotos') {
    cells = altaCliFiles.fotos.map((b64, i) =>
      '<div class="photo-cell"><img src="' + b64 + '"/><button type="button" class="rm" onclick="removeAltaCliFile(\'fotos\',' + i + ')">&times;</button></div>'
    ).join('');
    if (altaCliFiles.fotos.length < ALTA_CLI_MAX_FOTOS) {
      cells += '<label class="photo-cell add"><input type="file" accept="image/*" multiple onchange="onAltaCliFile(this,\'fotos\')"/>+</label>';
    }
  } else {
    const v = altaCliFiles[kind];
    if (v) {
      cells = '<div class="photo-cell"><img src="' + v + '"/><button type="button" class="rm" onclick="removeAltaCliFile(\'' + kind + '\')">&times;</button></div>';
    } else {
      cells = '<label class="photo-cell add"><input type="file" accept="image/*,.pdf" onchange="onAltaCliFile(this,\'' + kind + '\')"/>+</label>';
    }
  }
  grid.innerHTML = cells;
}

function resetAltaCliForm(){
  const f = document.getElementById('alta-cli-form');
  if (f) f.reset();
  altaCliFiles = {arca: null, iibb: null, fotos: []};
  refreshAltaCliGrid('arca'); refreshAltaCliGrid('iibb'); refreshAltaCliGrid('fotos');
}

window.submitClientApplication = async function(){
  // Validar
  const errors = [];
  function read(id){ const el = document.getElementById(id); return el ? (el.value || '').trim() : ''; }
  const fields = [
    ['ac-email', 'E-mail comercio'], ['ac-comercio', 'Nombre del comercio'], ['ac-fantasia', 'Nombre fantasia'],
    ['ac-cuit', 'CUIT'], ['ac-condfiscal', 'Condicion fiscal'],
    ['ac-calle', 'Calle'], ['ac-numero', 'Numero'], ['ac-localidad', 'Localidad'], ['ac-provincia', 'Provincia'], ['ac-cp', 'Codigo Postal'],
    ['ac-telefono', 'Telefono'], ['ac-web', 'Pagina web'], ['ac-redes', 'Redes'],
    ['ac-contacto-nombre', 'Nombre contacto'], ['ac-contacto-telpart', 'Telefono particular contacto'],
    ['ac-contacto-wsp', 'WhatsApp contacto'], ['ac-contacto-email', 'Email contacto'],
    ['ac-tipocomercio', 'Tipo de comercio'], ['ac-tiendaonline', 'Tienda online'],
  ];
  fields.forEach(([id, label]) => { if (!read(id)) errors.push(label); });
  if (!altaCliFiles.arca) errors.push('Constancia ARCA');
  // Constancia IIBB es OPCIONAL: muchas tiendas (monotributistas) no tienen.
  if (!altaCliFiles.fotos.length) errors.push('Fotos del local (al menos 1)');
  if (errors.length) { alert('Faltan completar:\n\n- ' + errors.join('\n- ')); return; }

  if (!confirm('Enviar la solicitud de alta de "' + read('ac-comercio') + '"?\n\nLes va a llegar como tarea a los aprobadores (Santiago y Diego). Cuando ambos aprueben, el cliente queda dado de alta y vas a poder cargarle pedidos.')) return;

  const data = {
    // Datos comercio
    email: read('ac-email'),
    comercio: read('ac-comercio'),
    fantasia: read('ac-fantasia'),
    cuit: read('ac-cuit'),
    condicionFiscal: read('ac-condfiscal'),
    calle: read('ac-calle'),
    numero: read('ac-numero'),
    localidad: read('ac-localidad'),
    provincia: read('ac-provincia'),
    cp: read('ac-cp'),
    telefono: read('ac-telefono'),
    web: read('ac-web'),
    redes: read('ac-redes'),
    // Contacto
    contactoNombre: read('ac-contacto-nombre'),
    contactoTelParticular: read('ac-contacto-telpart'),
    contactoWhatsapp: read('ac-contacto-wsp'),
    contactoEmail: read('ac-contacto-email'),
    tipoComercio: read('ac-tipocomercio'),
    tiendaOnline: read('ac-tiendaonline'),
    // Documentos
    constanciaArca: altaCliFiles.arca,
    constanciaIIBB: altaCliFiles.iibb,
    fotosLocal: altaCliFiles.fotos.slice(),
    // Metadata
    ownerUid: currentUser.uid,
    ownerEmail: currentUser.email || '',
    ownerName: currentUser.displayName || currentUser.email || '',
    vendor: assignedVendor || null,
    status: 'pending_approval',
    approvals: {},
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  const btn = document.querySelector('#alta-cli-form .btn-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const docRef = await fbDb.collection('client_applications').add(data);
    // Notificar a cada aprobador
    const approvers = await findApproverUids();
    for (const u of approvers) {
      try {
        await fbDb.collection('notifications').add({
          type: 'client_approval',
          fromUid: currentUser.uid,
          fromEmail: currentUser.email || '',
          fromName: currentUser.displayName || currentUser.email || '',
          targetUid: u.uid,
          targetEmail: u.email,
          title: 'Nueva solicitud de alta: ' + data.comercio,
          description: 'Vendedor: ' + (data.ownerName || data.ownerEmail) + '\nCUIT: ' + data.cuit + '\nLocalidad: ' + data.localidad + ', ' + titleCase(data.provincia) + '\nCondición fiscal: ' + data.condicionFiscal,
          applicationId: docRef.id,
          status: 'unread',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch(e) { console.warn('notif approver', u.email, e); }
    }
    showSyncTag('Solicitud enviada. Aprobadores notificados.');
    resetAltaCliForm();
    setAltaCliSubtab('mias');
  } catch(e) {
    console.error('submit client app', e);
    alert('Error enviando: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud de alta'; }
  }
};

async function findApproverUids(){
  // Busca en /roles los uids de los aprobadores por email
  const out = [];
  try {
    const qs = await fbDb.collection('roles').get();
    qs.forEach(d => {
      const data = d.data() || {};
      const em = (data.email || '').toLowerCase();
      if (CLIENT_APPLICATION_APPROVER_EMAILS.indexOf(em) >= 0) {
        out.push({uid: d.id, email: em});
      }
    });
  } catch(e) { console.warn('findApproverUids', e); }
  return out;
}

function renderAltaCliMisSolicitudes(){
  const cont = document.getElementById('ac-mias-list');
  if (!cont) return;
  if (!altaCliMine.length) {
    cont.innerHTML = '<div class="notif-empty">No enviaste solicitudes todavia. Usa la pestaña <b>Nueva solicitud</b>.</div>';
    return;
  }
  let html = '';
  altaCliMine.forEach(a => {
    const stCls = a.status === 'approved' ? 'approved' : (a.status === 'rejected' ? 'rejected' : 'pending');
    const stLbl = a.status === 'approved' ? '✓ Aprobada' : (a.status === 'rejected' ? '✕ Rechazada' : 'Pendiente');
    const dt = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : null) : null;
    const dtStr = dt ? dt.toLocaleString('es-AR') : '';
    const apCount = a.approvals ? Object.keys(a.approvals).length : 0;
    const isRapida = (a.source === 'alta_rapida');
    const hasSap = !!a.cardCodeSap;
    html += '<div class="ac-app-card ' + stCls + '">';
    html += '<h5>' + escapeHtml(a.comercio || '-') + '</h5>';
    html += '<div class="ac-app-meta">' + escapeHtml(a.fantasia || '') + ' &middot; CUIT ' + escapeHtml(a.cuit || '') + '</div>';
    html += '<div class="ac-app-meta">' + escapeHtml(a.localidad || '') + ' &middot; ' + escapeHtml(titleCase(a.provincia || '')) + ' &middot; Enviada ' + escapeHtml(dtStr) + '</div>';
    html += '<div><span class="ac-app-status">' + stLbl + '</span>';
    if (a.status === 'pending_approval') {
      html += ' <span style="font-size:10px;color:#64748b;margin-left:6px">' + apCount + '/2 aprobaciones</span>';
    }
    if (a.status === 'rejected' && a.rejectedReason) {
      html += '<div style="font-size:10px;color:#991b1b;margin-top:4px"><b>Motivo:</b> ' + escapeHtml(a.rejectedReason) + '</div>';
    }
    html += '</div>';
    // Boton eliminar. Para altas rapidas se permite siempre (mientras
    // no esten cargadas en SAP). Para altas formales se permite cuando
    // estan pendientes o rechazadas - aprobadas con cardCode no se pueden
    // borrar desde aca (se manejan desde SAP).
    const canDelete = isRapida ? !hasSap : (a.status !== 'approved' || !hasSap);
    if (canDelete) {
      const safeId = escapeAttr(a._fsId || '');
      const safeName = JSON.stringify(a.comercio || '').replace(/"/g, '&quot;');
      html += '<div style="margin-top:8px;text-align:right">';
      html += '<button onclick="deleteMyAltaCli(\'' + safeId + '\', ' + safeName + ')" style="background:#fee2e2;color:#991b1b;border:1.5px solid #fca5a5;border-radius:5px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">&#128465; Eliminar</button>';
      html += '</div>';
    }
    html += '</div>';
  });
  cont.innerHTML = html;
}

window.deleteMyAltaCli = async function(fsId, comercio){
  if (!fsId) return;
  const nombre = comercio || 'esta solicitud';
  if (!confirm('Eliminar "' + nombre + '"?\n\nLa alta se borra de tus solicitudes y deja de aparecer en PEDIDOS / VISITAS / mapa. No se puede deshacer.')) return;
  try {
    await fbDb.collection('client_applications').doc(fsId).delete();
    if (typeof showSyncTag === 'function') showSyncTag('Alta eliminada');
  } catch(e) {
    console.error('deleteMyAltaCli', e);
    alert('Error eliminando la solicitud: ' + (e.message || e));
  }
};

// ============================================================
// RENDICIONES - solicitud anticipo + gastos con foto + aprobacion
// ============================================================
// E2.e (e2b-perf 2026-07-28): movido a src/domains/rendiciones.js (901 LOC).
// Bundle registra window.ensureRendicionesListener, window.openRendicionDetail,
// window.setRendSubtab, window.submitRendSolicitud, window.submitRendGasto,
// window.approveRendicion, window.rejectRendicion, window.exportMisRendicionesExcel,
// window.setTodasRendFilter + ~5 handlers de UI (adjuntos + fotos + OCR retry).
// Callers del inline las usan sin prefix.
// Cross-scope state: window.unsubMisRendiciones + window.unsubTodasRendiciones
// (listeners con cleanup en detachFirebaseListeners) inicializados por el bundle.
// Nota: myRendicionesApproverUid/Email siguen declaradas como let en el inline;
// el bundle las lee via free reference (Global Environment Record compartido).
// ============================================================

// Detalle de solicitud de alta -> aprobar / rechazar
window.openClientApplicationDetail = async function(appId, notifId){
  if (!appId) { alert('Solicitud no encontrada.'); return; }
  try {
    const snap = await fbDb.collection('client_applications').doc(appId).get();
    if (!snap.exists) { alert('La solicitud ya no existe.'); return; }
    const a = Object.assign({_id: appId}, snap.data());
    const c = document.getElementById('ca-detail-content');
    let h = '<div style="padding:18px 20px;font-size:12px;color:#0f172a;line-height:1.6">';
    h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Comercio</h4>';
    h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px">';
    h += '<div><b>Nombre:</b> ' + escapeHtml(a.comercio || '') + '</div>';
    h += '<div><b>Fantasia:</b> ' + escapeHtml(a.fantasia || '') + '</div>';
    h += '<div><b>CUIT:</b> ' + escapeHtml(a.cuit || '') + '</div>';
    h += '<div><b>Cond. fiscal:</b> ' + escapeHtml(a.condicionFiscal || '') + '</div>';
    h += '<div><b>Direccion:</b> ' + escapeHtml(a.calle || '') + ' ' + escapeHtml(a.numero || '') + '</div>';
    h += '<div><b>CP:</b> ' + escapeHtml(a.cp || '') + '</div>';
    h += '<div><b>Localidad:</b> ' + escapeHtml(a.localidad || '') + '</div>';
    h += '<div><b>Provincia:</b> ' + escapeHtml(titleCase(a.provincia || '')) + '</div>';
    h += '<div><b>Telefono:</b> ' + escapeHtml(a.telefono || '') + '</div>';
    h += '<div><b>Email:</b> ' + escapeHtml(a.email || '') + '</div>';
    h += '<div style="grid-column:1/-1"><b>Web:</b> ' + escapeHtml(a.web || '') + '</div>';
    h += '<div style="grid-column:1/-1"><b>Redes:</b> ' + escapeHtml(a.redes || '') + '</div>';
    h += '</div>';
    h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Contacto</h4>';
    h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px">';
    h += '<div><b>Nombre:</b> ' + escapeHtml(a.contactoNombre || '') + '</div>';
    h += '<div><b>Tel particular:</b> ' + escapeHtml(a.contactoTelParticular || '') + '</div>';
    h += '<div><b>WhatsApp:</b> ' + escapeHtml(a.contactoWhatsapp || '') + '</div>';
    h += '<div><b>E-mail:</b> ' + escapeHtml(a.contactoEmail || '') + '</div>';
    h += '<div><b>Tipo comercio:</b> ' + escapeHtml(a.tipoComercio || '') + '</div>';
    h += '<div><b>Tienda online:</b> ' + escapeHtml(a.tiendaOnline || '') + '</div>';
    h += '</div>';
    h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Documentaci&oacute;n</h4>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    if (a.constanciaArca) h += '<div style="text-align:center"><div style="font-size:9px;color:#475569;margin-bottom:3px;font-weight:700;text-transform:uppercase">ARCA</div><img src="' + a.constanciaArca + '" id="ca-arca-img" class="task-img-thumb" style="width:90px;height:90px" onclick="openImgViewer(\'ca-arca-img\')"/></div>';
    if (a.constanciaIIBB) h += '<div style="text-align:center"><div style="font-size:9px;color:#475569;margin-bottom:3px;font-weight:700;text-transform:uppercase">IIBB</div><img src="' + a.constanciaIIBB + '" id="ca-iibb-img" class="task-img-thumb" style="width:90px;height:90px" onclick="openImgViewer(\'ca-iibb-img\')"/></div>';
    (a.fotosLocal || []).forEach((f, i) => {
      h += '<div style="text-align:center"><div style="font-size:9px;color:#475569;margin-bottom:3px;font-weight:700;text-transform:uppercase">Local ' + (i + 1) + '</div><img src="' + f + '" id="ca-foto-' + i + '" class="task-img-thumb" style="width:90px;height:90px" onclick="openImgViewer(\'ca-foto-' + i + '\')"/></div>';
    });
    h += '</div>';
    h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Origen</h4>';
    h += '<div>Vendedor: <b>' + escapeHtml(a.ownerName || a.ownerEmail || '-') + '</b></div>';
    const apN = a.approvals ? Object.keys(a.approvals).length : 0;
    h += '<div>Aprobaciones recibidas: <b>' + apN + ' / 2</b></div>';
    if (a.approvals) {
      Object.keys(a.approvals).forEach(uid => {
        const ap = a.approvals[uid];
        h += '<div style="font-size:10px;color:#15803d;margin-left:8px">&#10003; ' + escapeHtml(ap.email || uid) + '</div>';
      });
    }
    if (a.status === 'rejected') {
      h += '<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:4px;padding:8px;margin-top:8px;color:#991b1b"><b>RECHAZADA</b> por ' + escapeHtml(a.rejectedByEmail || '') + '. Motivo: ' + escapeHtml(a.rejectedReason || '-') + '</div>';
    }
    // Bloque de "datos del aprobador" - solo visible si soy aprobador y no
    // di mi aprobacion todavia. Aca el aprobador completa info que la
    // solicitud no trae del lado del vendedor:
    //   - cardCode SAP: BP a usar en pedidos (sin esto no entra el ZIP DTW)
    //   - assignedVendor: vendor que va a atender la tienda (aparece en su mapa)
    //   - localidadFinal: por si la localidad declarada no matchea con el mapa
    const meEmail = (currentUser.email || '').toLowerCase();
    const iAmApprover = CLIENT_APPLICATION_APPROVER_EMAILS.indexOf(meEmail) >= 0;
    const iAlreadyApproved = a.approvals && a.approvals[currentUser.uid];
    if (a.status === 'pending_approval' && iAmApprover && !iAlreadyApproved) {
      const preCardCode = a.cardCodeSap || '';
      const preVendor = a.assignedVendor || '';
      const preLoc = a.localidadFinal || a.localidad || '';
      h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Datos del aprobador</h4>';
      h += '<div style="display:grid;grid-template-columns:1fr;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px">';
      h += '<div><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">CardCode SAP B1 <span style="color:#dc2626">*</span></label>';
      h += '<input id="ca-cardcode" type="text" placeholder="C-12345 / dejar vacio si todavia no se creo el BP" value="' + escapeAttr(preCardCode) + '" style="width:100%;padding:7px 10px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:12px;font-family:Consolas,monospace;font-weight:700"/>';
      h += '<div style="font-size:10px;color:#94a3b8;margin-top:3px">Sin CardCode la tienda aparece en el mapa pero no se puede crear pedido (DTW lo necesita).</div></div>';
      h += '<div><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Asignar a vendedor <span style="color:#dc2626">*</span></label>';
      h += '<select id="ca-vendor" style="width:100%;padding:7px 10px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:12px;background:#fff">';
      h += '<option value="">- Elegir vendedor -</option>';
      h += '<optgroup label="Vendedores externos (VDE)">';
      VENDORS.filter(v => VDE_VENDOR_KEYS.has(v.key)).forEach(v => {
        const sel = (v.key === preVendor) ? ' selected' : '';
        h += '<option value="' + escapeAttr(v.key) + '"' + sel + '>' + escapeHtml(v.zone + ' - ' + titleCase(v.key)) + '</option>';
      });
      h += '</optgroup>';
      h += '<optgroup label="Vendedores internos (VDI)">';
      VENDORS.filter(v => VDI_VENDOR_KEYS.has(v.key)).forEach(v => {
        const sel = (v.key === preVendor) ? ' selected' : '';
        h += '<option value="' + escapeAttr(v.key) + '"' + sel + '>' + escapeHtml(titleCase(v.key)) + '</option>';
      });
      h += '</optgroup>';
      h += '<optgroup label="Otras asignaciones">';
      h += '<option value="__DISTRIBUTOR__"' + (preVendor === '__DISTRIBUTOR__' ? ' selected' : '') + '>&#127981; DISTRIBUIDOR</option>';
      h += '</optgroup>';
      h += '</select>';
      h += '<div style="font-size:10px;color:#94a3b8;margin-top:3px">El vendedor elegido va a ver la tienda en su mapa para crear pedidos.</div></div>';
      h += '<div><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Localidad final (como aparece en el mapa)</label>';
      h += '<input id="ca-loc-final" type="text" placeholder="' + escapeAttr(a.localidad || '') + '" value="' + escapeAttr(preLoc) + '" style="width:100%;padding:7px 10px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:12px"/>';
      h += '<div style="font-size:10px;color:#94a3b8;margin-top:3px">Si la localidad declarada por el vendedor (' + escapeHtml(a.localidad || '-') + ') no matchea con el mapa, ajustala aca.</div></div>';
      h += '</div>';
      h += '<div style="display:flex;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb">';
      h += '<button class="qmodal-btn primary" style="flex:1" onclick="approveClientApplication(\'' + escapeAttr(appId) + '\',\'' + escapeAttr(notifId || '') + '\')">Aprobar</button>';
      h += '<button class="qmodal-btn danger" style="flex:1" onclick="rejectClientApplication(\'' + escapeAttr(appId) + '\',\'' + escapeAttr(notifId || '') + '\')">Rechazar</button>';
      h += '</div>';
    } else if (iAlreadyApproved) {
      h += '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:4px;padding:8px;margin-top:14px;color:#166534;text-align:center;font-weight:700">&#10003; Ya aprobaste esta solicitud</div>';
    }
    h += '</div>';
    c.innerHTML = h;
    document.getElementById('ca-detail-modal').classList.add('open');
  } catch(e) {
    console.error('open client app detail', e);
    alert('Error: ' + (e.message || e));
  }
};
window.closeClientApplicationDetail = function(){
  document.getElementById('ca-detail-modal').classList.remove('open');
};

window.approveClientApplication = async function(appId, notifId){
  // Leer los 3 inputs del bloque "Datos del aprobador" antes de confirmar.
  // CardCode y vendor son obligatorios; localidadFinal puede quedar vacia
  // (fallback a la declarada por el vendedor).
  const cardCodeEl = document.getElementById('ca-cardcode');
  const vendorEl = document.getElementById('ca-vendor');
  const locFinalEl = document.getElementById('ca-loc-final');
  const cardCode = (cardCodeEl ? cardCodeEl.value.trim() : '');
  const assignedVendor = (vendorEl ? vendorEl.value : '');
  const localidadFinal = (locFinalEl ? locFinalEl.value.trim() : '');
  if (!cardCode) {
    if (!confirm('No cargaste CardCode SAP. La tienda va a aparecer en el mapa pero NO se va a poder crear pedido hasta que se cargue. ¿Aprobar igual?')) return;
  }
  if (!assignedVendor) {
    alert('Tenes que elegir un vendedor para asignar la tienda. Sin vendedor no se sabe en qué zona del mapa aparece.');
    return;
  }
  if (!confirm('Confirmar aprobacion de esta solicitud?')) return;
  try {
    const upd = {};
    upd['approvals.' + currentUser.uid] = {
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      email: currentUser.email || '',
      name: currentUser.displayName || '',
    };
    // Guardamos los datos del aprobador en la solicitud. Si ya estaban
    // cargados (otro aprobador los lleno antes), no los sobrescribimos
    // a menos que ahora se pasen valores no vacios.
    if (cardCode) upd['cardCodeSap'] = cardCode;
    if (assignedVendor) upd['assignedVendor'] = assignedVendor;
    if (localidadFinal) upd['localidadFinal'] = localidadFinal;
    await fbDb.collection('client_applications').doc(appId).update(upd);
    // Releer para chequear si ambos aprobaron
    const snap = await fbDb.collection('client_applications').doc(appId).get();
    const a = snap.data() || {};
    const apN = a.approvals ? Object.keys(a.approvals).length : 0;
    if (apN >= 2 && a.status === 'pending_approval') {
      // Marcar como aprobada definitivamente
      await fbDb.collection('client_applications').doc(appId).update({
        status: 'approved',
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Notificar al vendedor
      if (a.ownerUid) {
        await fbDb.collection('notifications').add({
          type: 'client_approval_ack',
          fromUid: currentUser.uid,
          fromEmail: currentUser.email || '',
          fromName: currentUser.displayName || currentUser.email || '',
          targetUid: a.ownerUid,
          title: 'Solicitud de alta APROBADA',
          message: 'Tu solicitud para dar de alta a "' + (a.comercio || '') + '" fue aprobada por los 2 revisores. Ya podes cargarle pedidos.',
          applicationId: appId,
          status: 'unread',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
    // Marcar la notif del aprobador como done
    if (notifId) {
      try {
        await fbDb.collection('notifications').doc(notifId).update({status: 'done', doneAt: firebase.firestore.FieldValue.serverTimestamp()});
      } catch(e) {}
    }
    showSyncTag(apN >= 2 ? 'Solicitud aprobada (definitiva)' : 'Aprobaste. Falta 1 aprobacion mas.');
    closeClientApplicationDetail();
  } catch(e) {
    console.error('approve', e);
    alert('Error aprobando: ' + (e.message || e));
  }
};

window.rejectClientApplication = async function(appId, notifId){
  const reason = prompt('Motivo del rechazo (se notifica al vendedor):', '');
  if (reason === null) return;
  if (!reason.trim()) { alert('Tenes que indicar un motivo.'); return; }
  try {
    await fbDb.collection('client_applications').doc(appId).update({
      status: 'rejected',
      rejectedBy: currentUser.uid,
      rejectedByEmail: currentUser.email || '',
      rejectedReason: reason.trim(),
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Notificar al vendedor
    const snap = await fbDb.collection('client_applications').doc(appId).get();
    const a = snap.data() || {};
    if (a.ownerUid) {
      await fbDb.collection('notifications').add({
        type: 'client_approval_ack',
        fromUid: currentUser.uid,
        fromEmail: currentUser.email || '',
        fromName: currentUser.displayName || currentUser.email || '',
        targetUid: a.ownerUid,
        title: 'Solicitud de alta RECHAZADA',
        message: 'Tu solicitud para "' + (a.comercio || '') + '" fue rechazada.\nMotivo: ' + reason.trim(),
        applicationId: appId,
        status: 'unread',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (notifId) {
      try {
        await fbDb.collection('notifications').doc(notifId).update({status: 'done', doneAt: firebase.firestore.FieldValue.serverTimestamp()});
      } catch(e) {}
    }
    showSyncTag('Solicitud rechazada');
    closeClientApplicationDetail();
  } catch(e) {
    console.error('reject', e);
    alert('Error: ' + (e.message || e));
  }
};

window.setNotifsTab = function(tab){
  window.notifsTab = tab;
  document.querySelectorAll('.ntab-btn').forEach(b => b.classList.toggle('active', b.dataset.ntab === tab));
  document.getElementById('notifs-pane-recibidas').style.display = tab === 'recibidas' ? '' : 'none';
  document.getElementById('notifs-pane-realizadas').style.display = tab === 'realizadas' ? '' : 'none';
  document.getElementById('notifs-pane-crear').style.display = tab === 'crear' ? '' : 'none';
  document.getElementById('notifs-pane-enviadas').style.display = tab === 'enviadas' ? '' : 'none';
  document.getElementById('notifs-footer').style.display = tab === 'recibidas' ? '' : 'none';
  if (tab === 'recibidas') renderNotifsList();
  else if (tab === 'realizadas') renderNotifsRealizadas();
  else if (tab === 'enviadas') renderMySentTasks();
};

function isNotifPending(n){
  // Pendiente = no leida y no completada (segun tipo).
  return n.status !== 'read' && n.status !== 'done';
}

function updateNotifsTabCounts(){
  const pending = (myNotifications || []).filter(isNotifPending).length;
  const realizadas = (myNotifications || []).filter(n => !isNotifPending(n)).length;
  const recEl = document.getElementById('ntab-recibidas-count');
  if (recEl) { recEl.textContent = pending > 0 ? pending : ''; recEl.classList.toggle('zero', pending === 0); }
  const realEl = document.getElementById('ntab-realizadas-count');
  if (realEl) { realEl.textContent = realizadas > 0 ? realizadas : ''; realEl.classList.toggle('zero', realizadas === 0); }
  // Enviadas: tareas que mande y que estan pendientes (no done)
  const pendSent = (mySentTasks || []).filter(t => t.status !== 'done').length;
  const sentEl = document.getElementById('ntab-enviadas-count');
  if (sentEl) { sentEl.textContent = pendSent > 0 ? pendSent : ''; sentEl.classList.toggle('zero', pendSent === 0); }
}

function fmtNotifDate(n){
  const dt = n.createdAt ? (n.createdAt.toDate ? n.createdAt.toDate() : new Date(n.createdAt)) : null;
  return dt ? dt.toLocaleString('es-AR') : '';
}

function notifItemHtml(n, opts){
  opts = opts || {};
  const type = n.type || 'derivacion';
  const isClosed = n.status === 'read' || n.status === 'done';
  let cls = 'notif-item type-' + type + (isClosed ? ' read' : '');
  const dtStr = fmtNotifDate(n);
  let h = '<div class="' + cls + '">';
  if (type === 'task') {
    const fromLabel = n.fromName || n.fromEmail || 'Alguien';
    h += '<div class="task-sender">&#9650; De ' + escapeHtml(fromLabel) + '</div>';
    const statusTag = n.status === 'done'
      ? '<span class="task-status-tag done">&#10003; Completada</span>'
      : '<span class="task-status-tag pending">Pendiente</span>';
    h += '<div class="task-title">' + escapeHtml(n.title || 'Sin titulo') + statusTag + '</div>';
    if (n.description) h += '<div class="task-desc">' + escapeHtml(n.description) + '</div>';
    if ((n.images || []).length) {
      h += '<div class="task-imgs">';
      n.images.forEach((img, i) => {
        const safe = img.replace(/'/g, '&#39;');
        h += '<img src="' + safe + '" class="task-img-thumb" onclick="openImgViewer(\'' + escapeAttr('task-' + n._fsId + '-' + i) + '\')" id="task-' + n._fsId + '-' + i + '"/>';
      });
      h += '</div>';
    }
    h += '<div class="nf"><span>&#128197; ' + escapeHtml(dtStr) + '</span></div>';
    if (n.status !== 'done' && !opts.readonly) {
      h += '<div class="notif-item-actions">';
      h += '<button class="btn-read" onclick="completarTask(\'' + escapeAttr(n._fsId) + '\')">Marcar como completada</button>';
      h += '</div>';
    } else if (n.status === 'done' && n.doneAt) {
      const da = n.doneAt.toDate ? n.doneAt.toDate() : new Date(n.doneAt);
      h += '<div style="font-size:10px;color:#15803d;margin-top:6px;font-weight:600">&#10003; Completada el ' + da.toLocaleString('es-AR') + '</div>';
    }
  } else if (type === 'task_ack') {
    h += '<h4>' + escapeHtml(n.title || 'Confirmacion de tarea') + '</h4>';
    h += '<div class="nm">' + escapeHtml(n.message || '') + '</div>';
    h += '<div class="nf"><span>' + escapeHtml(dtStr) + '</span></div>';
    if (n.status !== 'read' && !opts.readonly) {
      h += '<div class="notif-item-actions">';
      h += '<button class="btn-read" onclick="markNotifRead(\'' + escapeAttr(n._fsId) + '\')">Marcar leida</button>';
      h += '</div>';
    }
  } else if (type === 'client_approval') {
    h += '<div class="task-sender">&#9650; De ' + escapeHtml(n.fromName || n.fromEmail || 'Vendedor') + '</div>';
    h += '<div class="task-title">' + escapeHtml(n.title || 'Solicitud de alta') + '</div>';
    if (n.description) h += '<div class="task-desc">' + escapeHtml(n.description) + '</div>';
    h += '<div class="nf" style="margin-top:6px"><span>&#128197; ' + escapeHtml(dtStr) + '</span></div>';
    if (n.status !== 'read' && n.status !== 'done' && !opts.readonly) {
      h += '<div class="notif-item-actions">';
      h += '<button class="btn-read" onclick="openClientApplicationDetail(\'' + escapeAttr(n.applicationId || '') + '\',\'' + escapeAttr(n._fsId) + '\')" style="background:#0891b2">Ver detalle y decidir</button>';
      h += '</div>';
    }
  } else if (type === 'client_approval_ack') {
    h += '<h4>' + escapeHtml(n.title || 'Solicitud de alta') + '</h4>';
    h += '<div class="nm">' + escapeHtml(n.message || '') + '</div>';
    h += '<div class="nf"><span>' + escapeHtml(dtStr) + '</span></div>';
    if (n.status !== 'read' && !opts.readonly) {
      h += '<div class="notif-item-actions">';
      h += '<button class="btn-read" onclick="markNotifRead(\'' + escapeAttr(n._fsId) + '\')">Marcar leida</button>';
      h += '</div>';
    }
  } else if (type === 'rendicion_approval') {
    h += '<div class="task-sender">&#9650; De ' + escapeHtml(n.fromName || n.fromEmail || 'Vendedor') + '</div>';
    h += '<div class="task-title">' + escapeHtml(n.title || 'Rendicion pendiente') + '</div>';
    if (n.description) h += '<div class="task-desc">' + escapeHtml(n.description) + '</div>';
    h += '<div class="nf" style="margin-top:6px"><span>&#128197; ' + escapeHtml(dtStr) + '</span></div>';
    if (n.status !== 'read' && n.status !== 'done' && !opts.readonly) {
      h += '<div class="notif-item-actions">';
      h += '<button class="btn-read" onclick="openRendicionDetail(\'' + escapeAttr(n.rendicionId || '') + '\',\'' + escapeAttr(n._fsId) + '\')" style="background:#be185d">Ver detalle y decidir</button>';
      h += '</div>';
    }
  } else if (type === 'rendicion_approval_ack') {
    h += '<h4>' + escapeHtml(n.title || 'Rendicion') + '</h4>';
    h += '<div class="nm">' + escapeHtml(n.message || '') + '</div>';
    h += '<div class="nf"><span>' + escapeHtml(dtStr) + '</span></div>';
    if (n.status !== 'read' && !opts.readonly) {
      h += '<div class="notif-item-actions">';
      h += '<button class="btn-read" onclick="markNotifRead(\'' + escapeAttr(n._fsId) + '\')">Marcar leida</button>';
      h += '</div>';
    }
  } else {
    // derivacion
    h += '<h4>' + escapeHtml(n.tienda || 'Sin tienda') + '</h4>';
    h += '<div class="nm">' + escapeHtml(n.message || '') + '</div>';
    h += '<div class="nf"><span>' + escapeHtml((n.localidad || '') + ' &middot; ' + (n.provincia || '')) + '</span><span>' + escapeHtml(dtStr) + '</span></div>';
    if (n.status !== 'read' && !opts.readonly) {
      h += '<div class="notif-item-actions">';
      h += '<button class="btn-read" onclick="contactarDesdeNotif(\'' + escapeAttr(n._fsId) + '\')">Contactar</button>';
      h += '<button class="btn-read" style="background:#fff;color:#475569;border:1.5px solid #cbd5e1;margin-left:6px" onclick="markNotifRead(\'' + escapeAttr(n._fsId) + '\')" title="Solo marcar como leida (sin cargar visita)">Solo marcar leida</button>';
      h += '</div>';
    }
  }
  // Boton "Eliminar" generico para todas las notificaciones recibidas
  // (excepto modo readonly). No depende del tipo - cualquier notif
  // puede borrarse de la lista propia.
  if (!opts.readonly) {
    h += '<div class="notif-item-actions" style="margin-top:6px;justify-content:flex-end">';
    h += '<button class="btn-read" style="background:#fee2e2;color:#991b1b;border:1.5px solid #fca5a5;font-weight:700" onclick="deleteNotif(\'' + escapeAttr(n._fsId) + '\')" title="Eliminar esta notificacion">&#128465; Eliminar</button>';
    h += '</div>';
  }
  h += '</div>';
  return h;
}

window.deleteNotif = async function(fsId){
  if (!fsId) return;
  if (!confirm('Eliminar esta notificacion? No se puede deshacer.')) return;
  try {
    await fbDb.collection('notifications').doc(fsId).delete();
    if (typeof showSyncTag === 'function') showSyncTag('Notificacion eliminada');
  } catch(e) {
    console.error('deleteNotif', e);
    alert('Error eliminando la notificacion: ' + (e.message || e));
  }
};

function renderNotifsList(){
  // Recibidas = solo pendientes (no read, no done)
  const cont = document.getElementById('notifs-list');
  const pendientes = (myNotifications || []).filter(isNotifPending);
  if (!pendientes.length) { cont.innerHTML = '<div class="notif-empty">No tenes alertas ni tareas pendientes. &#127881;</div>'; return; }
  // v321+: header con contador + boton "Marcar todas como leidas" para
  // limpiar la bandeja de una. Util cuando se acumulan 100+ notifs.
  const nPend = pendientes.length;
  let html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px">';
  html += '<div style="font-size:11px;color:#334155;font-weight:600">' + nPend + ' pendiente' + (nPend === 1 ? '' : 's') + '</div>';
  html += '<button onclick="markAllNotifsRead()" style="background:#0d9488;color:#fff;border:none;padding:7px 12px;font-size:11px;font-weight:800;border-radius:5px;cursor:pointer;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap">&#10003; Marcar todas como leidas</button>';
  html += '</div>';
  html += pendientes.map(n => notifItemHtml(n)).join('');
  cont.innerHTML = html;
}

// v321+: bulk mark-as-read. Usa writeBatch de Firestore (max 500 ops).
// Loop de batches de 400 para tener margen. Confirma antes por si el
// user aprieta por accidente (280 notifs es mucho para deshacer).
window.markAllNotifsRead = async function(){
  const pendientes = (myNotifications || []).filter(isNotifPending);
  if (!pendientes.length) { alert('No hay notificaciones pendientes.'); return; }
  const n = pendientes.length;
  if (!confirm('Marcar ' + n + ' notificacion' + (n === 1 ? '' : 'es') + ' como leida' + (n === 1 ? '' : 's') + '?\n\nEsta accion no se puede deshacer masivamente (podrias re-abrir cada una manual desde Realizadas).')) return;
  const btn = document.querySelector('#notifs-list button[onclick*="markAllNotifsRead"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Marcando...'; }
  try {
    const CHUNK = 400;  // margen sobre el limite de 500
    let ok = 0;
    for (let i = 0; i < pendientes.length; i += CHUNK) {
      const slice = pendientes.slice(i, i + CHUNK);
      const batch = fbDb.batch();
      slice.forEach(n => {
        const ref = fbDb.collection('notifications').doc(n._fsId);
        batch.update(ref, {status: 'read', readAt: firebase.firestore.FieldValue.serverTimestamp()});
      });
      await batch.commit();
      ok += slice.length;
    }
    showSyncTag(ok + ' notificaciones marcadas como leidas');
    // El listener onSnapshot repinta al toque cuando llegan los updates.
  } catch(e) {
    console.error('markAllNotifsRead', e);
    alert('Error marcando notificaciones: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '✓ Marcar todas como leidas'; }
  }
};

function renderNotifsRealizadas(){
  // Realizadas = ya cerradas (read o done). Solo lectura.
  const cont = document.getElementById('notifs-realizadas-list');
  const cerradas = (myNotifications || []).filter(n => !isNotifPending(n));
  if (!cerradas.length) { cont.innerHTML = '<div class="notif-empty">Aca van a aparecer las alertas y tareas que ya cerraste.</div>'; return; }
  cont.innerHTML = cerradas.map(n => notifItemHtml(n, {readonly: true})).join('');
}

function renderMySentTasks(){
  const cont = document.getElementById('notifs-sent-list');
  if (!mySentTasks.length) { cont.innerHTML = '<div class="notif-empty">No enviaste tareas todavia. Usá la pestaña <b>Crear tarea</b>.</div>'; return; }
  let html = '';
  mySentTasks.forEach(n => {
    const isDone = n.status === 'done';
    const cls = 'notif-item type-task' + (isDone ? ' read' : '');
    const dtStr = fmtNotifDate(n);
    const targetLabel = n.targetName || n.targetEmail || n.targetUid || 'Alguien';
    html += '<div class="' + cls + '">';
    html += '<div class="task-sender">&#9660; Para ' + escapeHtml(targetLabel) + '</div>';
    const statusTag = isDone
      ? '<span class="task-status-tag done">&#10003; Completada</span>'
      : '<span class="task-status-tag pending">Pendiente</span>';
    html += '<div class="task-title">' + escapeHtml(n.title || 'Sin titulo') + statusTag + '</div>';
    if (n.description) html += '<div class="task-desc">' + escapeHtml(n.description) + '</div>';
    if ((n.images || []).length) {
      html += '<div class="task-imgs">';
      n.images.forEach((img, i) => {
        const safe = img.replace(/'/g, '&#39;');
        html += '<img src="' + safe + '" class="task-img-thumb" onclick="openImgViewer(\'' + escapeAttr('sent-' + n._fsId + '-' + i) + '\')" id="sent-' + n._fsId + '-' + i + '"/>';
      });
      html += '</div>';
    }
    html += '<div class="nf"><span>&#128197; ' + escapeHtml(dtStr) + '</span>';
    if (isDone && n.doneAt) {
      const da = n.doneAt.toDate ? n.doneAt.toDate() : new Date(n.doneAt);
      html += '<span style="color:#15803d;font-weight:700">&#10003; Marcada ' + da.toLocaleString('es-AR') + '</span>';
    }
    html += '</div></div>';
  });
  cont.innerHTML = html;
}

// === Image viewer (modal fullscreen) ===
window.openImgViewer = function(thumbId){
  const thumb = document.getElementById(thumbId);
  if (!thumb) return;
  document.getElementById('img-viewer-img').src = thumb.src;
  document.getElementById('img-viewer-overlay').classList.add('open');
};
window.closeImgViewer = function(){
  document.getElementById('img-viewer-overlay').classList.remove('open');
};

// === Tarea: poblar destinatario, manejar imagenes, enviar ===
// IMPORTANTE: Firestore Rules bloquean a vendedores de listar /roles
// (solo pueden leer su propio doc). Para que el dropdown de destinatarios
// funcione para todos los roles, leemos de app_config/users_directory
// (un mapa publico que el admin mantiene sincronizado). Si esa fuente
// no existe todavia, fallback a /roles (admin / viewer si funcionan).
function populateTaskTargetSelect(){
  const sel = document.getElementById('task-target');
  if (!sel) return;
  function renderFromMap(usersMap){
    const opts = ['<option value="">Seleccionar...</option>'];
    Object.entries(usersMap || {}).forEach(([uid, u]) => {
      if (uid === currentUser.uid) return;
      if (!u || !u.role || u.role === 'unassigned') return;
      const label = (u.displayName || u.email || uid) + ' · ' + (u.role || '');
      opts.push('<option value="' + escapeAttr(uid) + '" data-email="' + escapeAttr(u.email || '') + '" data-name="' + escapeAttr(u.displayName || u.email || '') + '">' + escapeHtml(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
  }
  // Intento principal: directorio publico mantenido por admin.
  fbDb.collection('app_config').doc('users_directory').get().then(snap => {
    if (snap.exists && snap.data() && snap.data().users) {
      renderFromMap(snap.data().users);
      return;
    }
    // Fallback: leer /roles directamente (funciona para admin/viewer
    // pero NO para vendedor por security rules).
    fbDb.collection('roles').get().then(qs => {
      const usersMap = {};
      qs.forEach(d => { usersMap[d.id] = d.data() || {}; });
      renderFromMap(usersMap);
    }).catch(e => {
      console.warn('populate task target - sin /roles ni users_directory:', e);
      sel.innerHTML = '<option value="">Seleccionar... (sin usuarios disponibles, pedile al admin que entre 1 vez al Panel Usuarios)</option>';
    });
  }).catch(e => {
    console.warn('populate task target - fallback a /roles:', e);
    fbDb.collection('roles').get().then(qs => {
      const usersMap = {};
      qs.forEach(d => { usersMap[d.id] = d.data() || {}; });
      renderFromMap(usersMap);
    }).catch(()=>{
      sel.innerHTML = '<option value="">Seleccionar... (sin usuarios disponibles)</option>';
    });
  });
}

// Admin solo: sincronizar el directorio publico a partir del usersCache
// que se carga en openAdminPanel. Los demas roles lo leen para poblar
// el dropdown de destinatarios de tareas.
function syncUsersDirectory(){
  if (userRole !== 'admin') return;
  if (!Array.isArray(usersCache) || !usersCache.length) return;
  const dir = {};
  usersCache.forEach(u => {
    if (!u || !u._uid) return;
    if (!u.role || u.role === 'unassigned') return;
    dir[u._uid] = {
      email: u.email || '',
      displayName: u.displayName || '',
      role: u.role,
    };
  });
  fbDb.collection('app_config').doc('users_directory').set({
    users: dir,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: (currentUser && currentUser.email) || '',
    userCount: Object.keys(dir).length,
  }, {merge: true}).then(() => {
    console.log('[users_directory] sincronizado:', Object.keys(dir).length, 'usuarios');
  }).catch(e => console.warn('syncUsersDirectory error:', e));
}
window.syncUsersDirectory = syncUsersDirectory;

window.onTaskImageInput = async function(input){
  const files = [...(input.files || [])];
  for (const f of files) {
    if (taskFormImages.length >= 5) { alert('Maximo 5 imagenes por tarea.'); break; }
    try {
      const b64 = await compressImage(f, 1200, 0.75);
      taskFormImages.push(b64);
    } catch(e) { console.warn('compress task img', e); }
  }
  input.value = '';
  refreshTaskImageGrid();
};

window.removeTaskFormImage = function(idx){
  taskFormImages.splice(idx, 1);
  refreshTaskImageGrid();
};

function refreshTaskImageGrid(){
  const grid = document.getElementById('task-img-grid');
  if (!grid) return;
  const cells = taskFormImages.map((b64, i) =>
    '<div class="photo-cell"><img src="' + b64 + '"/><button type="button" class="rm" onclick="removeTaskFormImage(' + i + ')">&times;</button></div>'
  ).join('');
  const addCell = taskFormImages.length < 5
    ? '<label class="photo-cell add"><input type="file" accept="image/*" multiple onchange="onTaskImageInput(this)"/>+</label>'
    : '';
  grid.innerHTML = cells + addCell;
}

window.sendTaskNotification = async function(){
  const sel = document.getElementById('task-target');
  const targetUid = sel.value;
  if (!targetUid) { alert('Elegi un destinatario.'); return; }
  const opt = sel.options[sel.selectedIndex];
  const targetEmail = opt.dataset.email || '';
  const targetName = opt.dataset.name || targetEmail;
  const title = (document.getElementById('task-title').value || '').trim();
  const description = (document.getElementById('task-description').value || '').trim();
  if (!title) { alert('Falta el titulo.'); return; }
  if (!description) { alert('Falta la descripcion.'); return; }
  const btn = document.querySelector('#notifs-pane-crear .qmodal-btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    await fbDb.collection('notifications').add({
      type: 'task',
      fromUid: currentUser.uid,
      fromEmail: currentUser.email || '',
      fromName: currentUser.displayName || currentUser.email || '',
      targetUid: targetUid,
      targetEmail: targetEmail,
      targetName: targetName,
      title: title,
      description: description,
      images: taskFormImages.slice(),
      status: 'unread',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Limpiar form
    document.getElementById('task-title').value = '';
    document.getElementById('task-description').value = '';
    taskFormImages = [];
    refreshTaskImageGrid();
    sel.value = '';
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar tarea'; }
    showSyncTag('Tarea enviada a ' + (targetName || 'destinatario'));
    setNotifsTab('enviadas');
  } catch(e) {
    console.error('sendTaskNotification', e);
    alert('Error enviando: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar tarea'; }
  }
};

window.completarTask = async function(notifId){
  if (!confirm('Marcar la tarea como completada? Le va a llegar un aviso al que la envio.')) return;
  const n = (myNotifications || []).find(x => x._fsId === notifId);
  if (!n) { alert('Tarea no encontrada.'); return; }
  try {
    // 1) Update de la tarea: status done
    await fbDb.collection('notifications').doc(notifId).update({
      status: 'done',
      doneAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // 2) Notificacion de ACK al que la envio (si no soy el mismo, que no deberia)
    if (n.fromUid && n.fromUid !== currentUser.uid) {
      const myName = currentUser.displayName || currentUser.email || 'el destinatario';
      await fbDb.collection('notifications').add({
        type: 'task_ack',
        fromUid: currentUser.uid,
        fromEmail: currentUser.email || '',
        fromName: myName,
        targetUid: n.fromUid,
        title: 'Tarea leida y completada',
        message: myName + ' marco como completada tu tarea: "' + (n.title || '') + '"',
        relatedTaskId: notifId,
        status: 'unread',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    showSyncTag('Tarea completada. Aviso enviado al emisor.');
  } catch(e) {
    console.error('completarTask', e);
    alert('Error: ' + (e.message || e));
  }
};

window.markNotifRead = async function(fsId){
  try {
    await fbDb.collection('notifications').doc(fsId).update({status: 'read', readAt: firebase.firestore.FieldValue.serverTimestamp()});
  } catch(e) { console.error('mark read', e); alert('Error: ' + (e.message || e)); }
};

// Cuando el VDI toca "Contactar" en una notif: cerramos el panel de notifs,
// abrimos el form de visita ya pre-poblado con la tienda derivada, y guardamos
// el notifId para marcar la notif como leida cuando el form se envie con exito.
let pendingNotifIdToMarkRead = null;
window.contactarDesdeNotif = function(notifId){
  const n = (myNotifications || []).find(x => x._fsId === notifId);
  if (!n) { alert('Notificacion no encontrada.'); return; }
  if (!n.tienda || !n.provincia || !n.localidad) {
    alert('Esta notificacion no tiene datos completos de tienda. Marcala como leida desde el otro boton.');
    return;
  }
  pendingNotifIdToMarkRead = notifId;
  closeNotifsPanel();
  // Abrir form de visita y pre-cargar la tienda derivada.
  if (typeof abrirVisitaParaTienda === 'function') {
    abrirVisitaParaTienda(n.localidad, n.provincia, n.tienda);
  } else {
    abrirVisitaParaTienda_real(n.localidad, n.provincia, n.tienda);
  }
};

window.markAllNotifsRead = async function(){
  const pending = (myNotifications || []).filter(isNotifPending);
  if (!pending.length) return;
  if (!confirm('Marcar las ' + pending.length + ' alertas/tareas como leidas? Pasan a la pestana Realizadas.')) return;
  try {
    for (const n of pending) {
      const isTask = (n.type === 'task');
      const upd = isTask
        ? {status: 'done', doneAt: firebase.firestore.FieldValue.serverTimestamp()}
        : {status: 'read', readAt: firebase.firestore.FieldValue.serverTimestamp()};
      await fbDb.collection('notifications').doc(n._fsId).update(upd);
      // Si es una tarea, mando ACK al emisor (mismo flujo que completarTask, pero sin confirmacion).
      if (isTask && n.fromUid && n.fromUid !== currentUser.uid) {
        const myName = currentUser.displayName || currentUser.email || 'el destinatario';
        try {
          await fbDb.collection('notifications').add({
            type: 'task_ack',
            fromUid: currentUser.uid,
            fromEmail: currentUser.email || '',
            fromName: myName,
            targetUid: n.fromUid,
            title: 'Tarea leida y completada',
            message: myName + ' marco como completada tu tarea: "' + (n.title || '') + '"',
            relatedTaskId: n._fsId,
            status: 'unread',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        } catch(e) { console.warn('ack desde markAll', e); }
      }
    }
  } catch(e) { console.error('mark all', e); }
};

// === Exports a window para callers cross-scope ===
// - renderNotifsList: llamada desde línea 12046 (tab handler), 12284 y 12331
//   (dentro de ensureNotifsListener + updateNotifsBadge del inline).
// - updateNotifsTabCounts: llamada desde línea 12329-30 del inline.
// - populateTaskTargets: ya está window.populateTaskTargets = function.
// - syncUsersDirectory: ya está window.syncUsersDirectory = syncUsersDirectory (dentro del bloque).
// - ensureAltaCliListener: llamada desde applyRolePermissions inline L11540.
window.renderNotifsList = renderNotifsList;
window.ensureAltaCliListener = ensureAltaCliListener;
window.updateNotifsTabCounts = updateNotifsTabCounts;
// E6 hotfix 2: populateAltaCliProvincias llamada desde setTab('altacli') inline L8221.
window.populateAltaCliProvincias = populateAltaCliProvincias;
// E6 hotfix 3: cross-module bug — rendiciones.js llama notifItemHtml.
window.notifItemHtml = notifItemHtml;
