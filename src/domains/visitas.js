// @ts-nocheck
// VISITAS: form modal de registro de visita comercial + persistencia.
// Extraído verbatim de index.html (líneas 18355-19476 pre-E2.k) como parte
// de E2.k (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// Cross-scope state (via window):
// - window.visitsCache: LEÍDA por dashboard, rutas (renderRutaDetalle/renderRutasTab),
//   backup (deleteVisitPhotosForMonth); ESCRITA por ensureVisitsListener (rutas.js).
// - window.unsubVisits: cleanup en detachFirebaseListeners inline; asignado por
//   ensureVisitsListener (rutas.js).
// - window.unsubClientLocs: cleanup en detachFirebaseListeners inline; asignado
//   por ensureClientLocsListener (dentro de este módulo).
//
// COORDINACIÓN CON rutas.js: rutas.js/ensureVisitsListener también actualizado
// con prefix window. para reasignaciones de visitsCache y unsubVisits (mismo commit).
// ============================================================
// VISITA - formulario y persistencia
// ============================================================
let visitState = { relevancia: 0, pop: '', espacioPhotos: [], frentePhoto: null };
if (typeof window.visitsCache === 'undefined') window.visitsCache = [];

// ============================================================
// GEOLOCALIZACION para verificar visitas (doble check)
// ============================================================
// Cache local de ubicaciones de referencia de cada tienda. Doc id determinístico
// y cargado via listener. La primera visita con GPS valido auto-confirma la
// ubicacion (auto-aprendizaje); las siguientes se comparan contra esa.
const clientLocsCache = new Map();
if (typeof window.unsubClientLocs === 'undefined') window.unsubClientLocs = null;
function clientLocId(prov, locName, tienda) {
  function norm(s) {
    return (s || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }
  return norm(prov) + '__' + norm(locName) + '__' + norm(tienda);
}

// Buscador que matchea el query contra varias fuentes de nombre del cliente:
//  1) Nombre titular (comercio o razon social) - lo que aparece en POINTS
//     y en approvedAltasList.comercio.
//  2) Nombre del local (fantasia) - customFantasia en clientMeta y fantasia
//     en approvedAltasList. Los vendedores muchas veces saben el nombre del
//     local pero no del titular ("Pescaplay" en vez de "Juan Perez").
//  3) Localidad - por si buscan "Rio Tercero" o similar.
//  4) Titular alternativo de la alta SAP (a.titular).
// Devuelve true si el query esta vacio o si alguno de los campos matchea.
// v312+: helper reutilizable. Divide el query en tokens por espacios y
// exige que TODOS aparezcan en el haystack (busqueda tipo Google - AND).
// Permite ejemplos como "el pez gordo quilmes" que matchea "el pez gordo"
// (nombre) + "quilmes oeste" (localidad) sin importar el orden.
// Tambien normaliza acentos (á -> a) para busquedas mas laxas.
// _normalizeSearch + matchesAllTokens: movidos al bundle (window vía __phase0.pure).

// v315+: detector de posible duplicado SAP vs Provisorio. Cuando finanzas
// carga a SAP un cliente que ya existia como Alta Rapida (provisorio), la
// app termina con 2 docs para la misma tienda. Este helper flagea el
// provisorio para que admin lo elimine manualmente.
//
// Criterio de match:
//   1. El candidato debe ser un SAP habilitado (cardCodeSap + status='approved').
//   2. Misma PROVINCIA normalizada.
//   3. Misma LOCALIDAD normalizada.
//   4. Nombre "similar": comparten al menos 2 tokens significativos (>=3
//      chars, sin stopwords tipo 'de', 'la', 'el', 'pesca'), o uno esta
//      contenido en el otro (ambos normalizados).
//
// Devuelve el doc SAP duplicado (el objeto de approvedAltasList) o null.
// Los stopwords son intencionalmente pocos - preferimos falsos positivos
// (mas cards rojas) que falsos negativos (duplicados sin detectar).
// findSapDuplicateForProvisorio + helpers _DUP_STOPWORDS/_nameTokens: movidos
// al bundle (src/pure/duplicate.js). Wrapper en window.findSapDuplicateForProvisorio
// pasa approvedAltasList como param (E4 refactor).

function clientMatchesQuery(name, localityName, k, query) {
  if (!query) return true;
  // v312+: armar haystack con todos los campos relevantes y hacer match
  // por tokens. Antes cada campo se checkeaba con includes(query completo),
  // por lo que "EL PEZ GORDO QUILMES" no matcheaba porque ninguna columna
  // sola tenia esa cadena.
  const parts = [];
  parts.push(name || '');
  parts.push(localityName || '');
  // customFantasia guardado por el vendedor desde el modal cliente.
  if (typeof clientMeta !== 'undefined' && k && clientMeta[k] && clientMeta[k].customFantasia) {
    parts.push(clientMeta[k].customFantasia);
  }
  // Match contra approvedAltasList: si alguna variante de nombre matchea
  // al cliente actual, agregar sus 3 campos al haystack.
  const nameL = (name || '').toLowerCase();
  if (typeof approvedAltasList !== 'undefined' && Array.isArray(approvedAltasList)) {
    for (const a of approvedAltasList) {
      if (!a) continue;
      const c = (a.comercio || '').toLowerCase();
      const t = (a.titular || '').toLowerCase();
      const f = (a.fantasia || '').toLowerCase();
      if (c === nameL || t === nameL || f === nameL) {
        parts.push(a.comercio || '', a.titular || '', a.fantasia || '');
      }
    }
  }
  return matchesAllTokens(parts.join(' | '), query);
}

// Devuelve el HTML de un badge con la categoria del cliente (P/A/B/C).
// Los clientes SAP guardan cliTipo en client_applications (approvedAltasList),
// los POINTS regulares en client_master. Chequeamos ambas fuentes.
// Usado en cards de CLIENTES y PEDIDOS para que el vendedor vea de un
// vistazo la categoria comercial que le asigno admin/gerente en Master
// Clientes. Sin categoria -> string vacio.
function getClientCategoryBadgeHtml(province, locName, name, opts) {
  try {
    let tipo = '';
    // Fuente 1: client_master (POINTS regulares).
    if (typeof clientMasterCache !== 'undefined' && clientMasterCache) {
      const docId = clientLocId(province || '', locName || '', name || '');
      const cm = clientMasterCache.get(docId);
      if (cm && cm.cliTipo) tipo = cm.cliTipo.toString().toUpperCase().trim();
    }
    // Fuente 2: client_applications (SAP altas). Match por nombre (comercio,
    // titular o fantasia) + provincia + localidad. Multiples matches son
    // posibles (multi-alta), tomamos el primero con cliTipo cargado.
    if (!tipo && typeof approvedAltasList !== 'undefined' && Array.isArray(approvedAltasList)) {
      const norm = (s) =>
        (s || '')
          .toString()
          .toUpperCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      const nameU = norm(name);
      const provU = norm(province);
      const _locU = norm(locName);
      for (const a of approvedAltasList) {
        if (!a || !a.cliTipo) continue;
        // Match por nombre en cualquiera de los 3 campos.
        const matches = [a.comercio, a.titular, a.fantasia].some((n) => norm(n) === nameU);
        if (!matches) continue;
        // Match adicional por provincia (si esta cargada). Localidad es
        // mas laxa porque a veces varia entre POINTS y client_applications.
        const aProv = norm(a.provincia);
        if (provU && aProv && provU !== aProv) continue;
        tipo = a.cliTipo.toString().toUpperCase().trim();
        break;
      }
    }
    if (!tipo) return '';
    const styles = {
      P: { bg: '#7c3aed', title: 'Premium - 6% fijo + 5% CONTADO' },
      A: { bg: '#059669', title: 'A - 3% fijo + 3% CONTADO' },
      B: { bg: '#0284c7', title: 'B - sin descuento' },
      C: { bg: '#64748b', title: 'C - sin descuento' },
    };
    const s = styles[tipo];
    if (!s) return '';
    // v294+ modo "corner": renderea el badge como esquina fija de la card
    // (position:absolute top-right). Requiere que el contenedor .client-card
    // o .pedido-client-card tenga position:relative (ya seteado en CSS).
    // Sin opts.corner sigue emitiendo el badge inline como antes (usado por
    // otras superficies como el modal de cliente).
    const corner = !!(opts && opts.corner);
    if (corner) {
      return (
        '<span class="cli-cat-corner" title="' +
        escapeAttr(s.title) +
        '" style="background:' +
        s.bg +
        '">Cat ' +
        tipo +
        '</span>'
      );
    }
    return (
      ' <span title="' +
      escapeAttr(s.title) +
      '" style="font-size:9px;color:#fff;font-weight:800;margin-left:6px;background:' +
      s.bg +
      ';padding:2px 7px;border-radius:3px;text-transform:uppercase;letter-spacing:.4px">Cat ' +
      tipo +
      '</span>'
    );
  } catch (_e) {
    return '';
  }
}
function ensureClientLocsListener() {
  if (unsubClientLocs || !currentUser || !fbDb) return;
  window.unsubClientLocs = fbDb.collection('client_locations').onSnapshot(
    (qs) => {
      clientLocsCache.clear();
      qs.forEach((d) => clientLocsCache.set(d.id, Object.assign({ _id: d.id }, d.data())));
    },
    (err) => console.error('client_locations listener', err)
  );
}
function captureGpsPosition() {
  // Pide la geolocalizacion al navegador. Promise.
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: 'unavailable', error: 'El navegador no soporta geolocalizacion' });
      return;
    }
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      resolve(val);
    };
    // timeout de seguridad por si el navegador se queda colgado
    const safety = setTimeout(
      () => finish({ status: 'timeout', error: 'Tardó mas de 12s en responder' }),
      12000
    );
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(safety);
        finish({
          status: 'ok',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 0,
          at: new Date().toISOString(),
        });
      },
      (err) => {
        clearTimeout(safety);
        const code = err && err.code;
        let st = 'error';
        if (code === 1)
          st = 'denied'; // PERMISSION_DENIED
        else if (code === 2)
          st = 'unavailable'; // POSITION_UNAVAILABLE
        else if (code === 3) st = 'timeout'; // TIMEOUT
        finish({ status: st, error: (err && err.message) || 'GPS no disponible' });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
async function captureGpsForVisit(prov, locName, tienda) {
  // Devuelve un objeto con todos los campos a guardar en la visita.
  const pos = await captureGpsPosition();
  const base = {
    gpsStatus: pos.status,
    gpsLat: null,
    gpsLon: null,
    gpsAccuracy: null,
    gpsCapturedAt: null,
    gpsDistanceM: null,
    gpsRefLat: null,
    gpsRefLon: null,
    gpsRefSource: null,
    gpsError: pos.error || null,
  };
  if (pos.status !== 'ok') return base;
  base.gpsLat = pos.lat;
  base.gpsLon = pos.lon;
  base.gpsAccuracy = Math.round(pos.accuracy || 0);
  base.gpsCapturedAt = pos.at;
  const id = clientLocId(prov, locName, tienda);
  const ref = clientLocsCache.get(id);
  if (ref && typeof ref.lat === 'number' && typeof ref.lon === 'number') {
    const km = haversineKm(pos.lat, pos.lon, ref.lat, ref.lon);
    base.gpsDistanceM = Math.round(km * 1000);
    base.gpsRefLat = ref.lat;
    base.gpsRefLon = ref.lon;
    base.gpsRefSource = ref.source || 'auto';
    base.gpsStatus =
      base.gpsDistanceM <= 300 ? 'confirmed' : base.gpsDistanceM <= 1000 ? 'near' : 'far';
  } else {
    // No hay ref previa: esta visita la define (auto-aprendizaje).
    try {
      await fbDb
        .collection('client_locations')
        .doc(id)
        .set({
          provincia: prov,
          localidad: locName,
          tienda: tienda,
          lat: pos.lat,
          lon: pos.lon,
          accuracy: Math.round(pos.accuracy || 0),
          source: 'auto',
          setBy: currentUser.email || '',
          setByUid: currentUser.uid,
          setAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      base.gpsRefLat = pos.lat;
      base.gpsRefLon = pos.lon;
      base.gpsRefSource = 'auto';
      base.gpsDistanceM = 0;
      base.gpsStatus = 'first';
    } catch (e) {
      console.warn('No pude crear client_location:', e);
      base.gpsStatus = 'no_reference';
    }
  }
  return base;
}
function gpsBadgeHtml(v) {
  // Devuelve un span pequeño con semaforo segun gpsStatus
  if (!v) return '';
  const st = v.gpsStatus || '';
  let bg, fg, lbl;
  if (st === 'confirmed' || st === 'first') {
    bg = '#dcfce7';
    fg = '#166534';
    lbl = st === 'first' ? '● GPS 1ra' : '● GPS OK';
  } else if (st === 'near') {
    bg = '#fef9c3';
    fg = '#854d0e';
    lbl = '● GPS Cerca';
  } else if (st === 'far') {
    bg = '#fee2e2';
    fg = '#991b1b';
    lbl = '● GPS LEJOS';
  } else if (st === 'denied') {
    bg = '#e5e7eb';
    fg = '#475569';
    lbl = '● Sin permiso GPS';
  } else if (st === 'no_reference') {
    bg = '#e0f2fe';
    fg = '#075985';
    lbl = '● Sin referencia';
  } else if (st === 'timeout' || st === 'unavailable' || st === 'error') {
    bg = '#e5e7eb';
    fg = '#475569';
    lbl = '● Sin GPS';
  } else return '';
  let txt = lbl;
  if (typeof v.gpsDistanceM === 'number' && (st === 'confirmed' || st === 'near' || st === 'far')) {
    txt +=
      ' &middot; ' +
      (v.gpsDistanceM >= 1000 ? (v.gpsDistanceM / 1000).toFixed(1) + ' km' : v.gpsDistanceM + ' m');
  }
  return (
    '<span style="display:inline-block;font-size:10px;font-weight:800;padding:2px 7px;border-radius:4px;background:' +
    bg +
    ';color:' +
    fg +
    ';letter-spacing:.3px">' +
    txt +
    '</span>'
  );
}
if (typeof window.unsubVisits === 'undefined') window.unsubVisits = null;

// v304+: mode puede ser 'visita' (default) o 'contacto'.
// 'contacto' registra una interaccion no presencial (WhatsApp/Tel/Email).
// Guarda en la misma coleccion `visits` con campo tipo='contacto'. UI
// oculta las 2 filas de fotos y usa header verde/teal.
window.visitMode = 'visita';
window.openVisitaModal = function (mode) {
  mode = mode === 'contacto' ? 'contacto' : 'visita';
  window.visitMode = mode;
  applyVisitModeUI(mode);
  document.getElementById('visita-modal').classList.add('open');
  visitViewMode = 'new';
  setVisitaView('form');
  resetVisitaForm();
  setVisitFormReadonly(false);
  // Renderiza el selector "Crear en nombre de" si soy VDI con parejas.
  renderActingAsVendorSelect();
  populateVisitaLocalidades();
  // Frente del local: ahora OPCIONAL para todos los roles (antes era
  // obligatorio para vendedor externo). Sin el asterisco rojo en el
  // label. El elemento vf-frente-req ya no existe en el DOM.
  // Subscribe listener para mis visitas
  if (!unsubVisits && currentUser) {
    let q;
    // v298: gerente ve TODAS las visitas (ya lo permite Firestore Rules).
    if (userRole === 'admin' || userRole === 'viewer' || userRole === 'gerente') {
      q = fbDb.collection('visits');
    } else {
      q = fbDb.collection('visits').where('ownerUid', '==', currentUser.uid);
    }
    window.unsubVisits = q.onSnapshot(
      (qs) => {
        window.visitsCache = [];
        qs.forEach((d) => visitsCache.push(Object.assign({ id: d.id }, d.data())));
        if (document.getElementById('visita-pane-list').style.display !== 'none')
          renderVisitasList();
      },
      (err) => console.error('visits listener', err)
    );
  }
};

window.closeVisitaModal = function () {
  document.getElementById('visita-modal').classList.remove('open');
};

// v304+: aplica cambios visuales al modal segun el modo (visita/contacto).
// Contacto: header teal, oculta filas de fotos (espacio + frente),
// renombra tab, cambia label del boton submit.
function applyVisitModeUI(mode) {
  const isContacto = mode === 'contacto';
  const head = document.getElementById('visita-modal-head');
  const title = document.getElementById('visita-modal-title');
  const subt = document.getElementById('visita-modal-subt');
  const tabNueva = document.getElementById('visita-tab-nueva');
  const tabMis = document.getElementById('visita-tab-mis');
  const rowEsp = document.getElementById('vf-espacio-row');
  const rowFre = document.getElementById('vf-frente-row');
  const btn = document.getElementById('visita-submit-btn');
  if (head)
    head.style.background = isContacto
      ? 'linear-gradient(135deg,#0f766e,#14b8a6)'
      : 'linear-gradient(135deg,#5b21b6,#7c3aed)';
  if (title)
    title.textContent = isContacto
      ? 'Registro de Contacto (no presencial)'
      : 'Formulario de Visita';
  if (subt)
    subt.innerHTML = isContacto
      ? 'Cliente contactado por WhatsApp / tel&eacute;fono / email (sin visita f&iacute;sica). Los campos con <b style="color:#fca5a5">*</b> son obligatorios.'
      : 'Los campos con <b style="color:#fca5a5">*</b> son obligatorios.';
  if (tabNueva) tabNueva.textContent = isContacto ? 'Nuevo contacto' : 'Nueva visita';
  if (tabMis) tabMis.textContent = isContacto ? 'Mis contactos' : 'Mis visitas';
  if (rowEsp) rowEsp.style.display = isContacto ? 'none' : '';
  if (rowFre) rowFre.style.display = isContacto ? 'none' : '';
  // v339+: en modo contacto no presencial ocultamos Fidelidad + POP + Tipo de venta
  // (+ ponderacion asociada). No aplican para un contacto por WhatsApp/tel/SMS.
  // v357: se suma "Especializacion por tipo de pesca" a los campos ocultos en
  // modo contacto (misma logica — no relevante en interaccion no presencial).
  const rowFid = document.getElementById('vf-fidelidad-row');
  const rowPop = document.getElementById('vf-pop-row');
  const rowTV = document.getElementById('vf-tipoventa-row');
  const rowPond = document.getElementById('vf-pond-wrap');
  const rowEsp2 = document.getElementById('vf-especializacion-row');
  if (rowFid) rowFid.style.display = isContacto ? 'none' : '';
  if (rowPop) rowPop.style.display = isContacto ? 'none' : '';
  if (rowTV) rowTV.style.display = isContacto ? 'none' : '';
  if (rowPond && isContacto) rowPond.style.display = 'none';
  if (rowEsp2) rowEsp2.style.display = isContacto ? 'none' : '';
  // Quitar 'required' en modo contacto para que submit no falle por validacion.
  const selFid = document.getElementById('vf-fidelidad');
  const selTV = document.getElementById('vf-tipoventa');
  const selEsp = document.getElementById('vf-especializacion');
  if (selFid) selFid.required = !isContacto;
  if (selTV) selTV.required = !isContacto;
  if (selEsp) selEsp.required = !isContacto;
  // v313+: Forma de contacto (llamada / whatsapp / SMS) solo en modo contacto.
  const rowFC = document.getElementById('vf-forma-contacto-row');
  if (rowFC) rowFC.style.display = isContacto ? '' : 'none';
  const inputFC = document.getElementById('vf-formaContacto');
  if (inputFC) inputFC.required = isContacto;
  if (btn) {
    btn.textContent = isContacto ? 'Registrar contacto' : 'Enviar formulario';
    btn.style.background = isContacto ? '#0d9488' : '#7c3aed';
  }
}

window.setVisitaView = function (v) {
  document
    .querySelectorAll('.vt-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.vt === v));
  document.getElementById('visita-pane-form').style.display = v === 'form' ? '' : 'none';
  document.getElementById('visita-pane-list').style.display = v === 'list' ? '' : 'none';
  document.getElementById('visita-footer').style.display = v === 'form' ? '' : 'none';
  if (v === 'list') renderVisitasList();
};

window.onClickNuevaVisitaTab = function () {
  if (visitViewMode === 'view') {
    visitViewMode = 'new';
    resetVisitaForm();
    setVisitFormReadonly(false);
  }
  setVisitaView('form');
};

function resetVisitaForm() {
  document.getElementById('visita-form').reset();
  visitState = { relevancia: 0, pop: '', espacioPhotos: [], frentePhoto: null };
  document.querySelectorAll('.vf-likert button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('#vf-pop button').forEach((b) => b.classList.remove('active'));
  document.getElementById('vf-necesidad-wrap').style.display = 'none';
  document.getElementById('vf-pond-wrap').style.display = 'none';
  const gi = document.getElementById('vf-gps-info');
  if (gi) gi.innerHTML = '';
  refreshEspacioGrid();
  refreshFrenteGrid();
}

function populateVisitaLocalidades() {
  // v298+ (2026-07-14, pedido vendedores): el vendedor busca DIRECTO por
  // nombre de tienda; localidad + provincia se autocompletan al elegir.
  // Antes había que elegir localidad primero -> lento y muchos no la sabían.
  // Ahora populamos vf-tienda con TODAS las tiendas visibles al vendor,
  // cada opcion muestra "Fantasia (Titular) — Localidad, Provincia" para
  // que el buscador matchee tanto por fantasia como por titular. El value
  // del filter-select tiene formato "PROV||Loc||Titular" (titular es lo
  // que el save espera como v.tienda); luego onTiendaChange parsea y
  // setea el hidden vf-localidad + pisa vf-tienda con solo el titular.
  const myVendor = getEffectiveVendorKey();
  const items = [];
  const seen = new Set();
  const _norm = (s) => (s || '').toString().toLowerCase().trim();

  // Pre-build index de fantasias por nombre normalizado, para lookup O(1)
  // desde POINTS. Cubrimos las 3 rutas de match: comercio, titular, fantasia.
  const fantasiaByName = new Map();
  if (typeof approvedAltasList !== 'undefined') {
    approvedAltasList.forEach((a) => {
      if (!a || !a.fantasia) return;
      const fant = String(a.fantasia).trim();
      if (!fant) return;
      ['comercio', 'titular', 'fantasia'].forEach((k) => {
        const v = _norm(a[k]);
        if (v) fantasiaByName.set(v, fant);
      });
    });
  }

  // Helper: arma el label mostrando fantasia (titular) si son distintas.
  // Si son iguales o no hay fantasia, solo el titular. El buscador matchea
  // el label completo -> permite encontrar la tienda por cualquiera.
  function buildLabel(titular, fantasia, loc, prov, badge) {
    const t = (titular || '').trim();
    const f = (fantasia || '').trim();
    const showFant = f && f.toLowerCase() !== t.toLowerCase();
    const bigName = showFant ? f : t;
    const secondary = showFant ? ' (' + t + ')' : '';
    return bigName + secondary + (badge || '') + ' — ' + loc + ', ' + titleCase(prov);
  }

  // Path 1: POINTS clients confirmados en SAP.
  POINTS.forEach((p) => {
    if (myVendor && p.vendor !== myVendor) return;
    (p.clients || []).forEach((c) => {
      if (typeof isSapConfirmed === 'function' && !isSapConfirmed(p.province, p.name, c)) return;
      const dedupKey = _norm(p.province) + '|' + _norm(p.name) + '|' + _norm(c);
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      const fantasia = fantasiaByName.get(_norm(c)) || '';
      const showFant = fantasia && fantasia.toLowerCase() !== c.toLowerCase();
      items.push({
        value: p.province + '||' + p.name + '||' + c,
        label: buildLabel(c, fantasia, p.name, p.province, ''),
        sortKey: _norm(showFant ? fantasia : c),
      });
    });
  });

  // Path 2: SAP altas + provisorios de Alta Rápida.
  if (typeof approvedAltasList !== 'undefined') {
    approvedAltasList.forEach((a) => {
      if (!a) return;
      const enabled = !!(a.cardCodeSap || a.manualSapPending);
      if (!enabled) return;
      const aProv = (a.provincia || '').toUpperCase().trim();
      const aLoc = (a.localidadFinal || a.localidad || '').trim();
      if (!aProv || !aLoc) return;
      if (myVendor && a.assignedVendor && a.assignedVendor !== myVendor) return;
      const titular = a.comercio || a.titular || '';
      const fantasia = (a.fantasia || '').trim();
      if (!titular && !fantasia) return;
      // Value usa el titular (o fantasia como fallback si no hay titular)
      // porque el save guarda v.tienda con ese valor - matchea con lo que
      // el resto del codigo espera.
      const nombre = titular || fantasia;
      const dedupKey = _norm(aProv) + '|' + _norm(aLoc) + '|' + _norm(nombre);
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      // v314+: badge "⚡ PROVISORIO" mas visible (antes solo emoji ⚡). Ayuda
      // al vendedor a identificar rapido en el dropdown que la tienda es un
      // alta rapida reciente, para evitar picar un POINT del padron por error.
      const badge = a.manualSapPending && !a.cardCodeSap ? ' ⚡ PROVISORIO' : '';
      const showFant = fantasia && fantasia.toLowerCase() !== nombre.toLowerCase();
      items.push({
        value: aProv + '||' + aLoc + '||' + nombre,
        label: buildLabel(nombre, fantasia, aLoc, aProv, badge),
        sortKey: _norm(showFant ? fantasia : nombre),
      });
    });
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // Popular el filter-select de Tienda con el onChange que auto-completa
  // la localidad. vf-localidad queda oculto (ver HTML) pero sigue siendo el
  // hidden que consume el resto del flujo (readField, save, validate).
  //
  // v360: preservar la seleccion previa si aun existe en las nuevas opciones.
  // Bug pre-v359: el listener onSnapshot de approvedAltasList
  // (index.html:3707) re-llama populateVisitaLocalidades cuando dispara
  // mientras el modal esta abierto. El fsReset('vf-tienda') incondicional
  // borraba la seleccion del user si Firestore actualizaba justo despues
  // de hacer click en una opcion (input ya no tenia foco -> el "guardian"
  // de linea 3785 no protegia). Se veia como "elegi tienda pero el input
  // quedo vacio".
  // v359 (roto) comparaba vf-tienda.value directo con items[].value, pero
  // onTiendaChange (v298+) pisa vf-tienda con SOLO el nombre plano de la
  // tienda, mientras que items[].value tiene formato "PROV||Loc||Tienda".
  // El find nunca matcheaba -> siempre caia al fsReset -> borraba igual.
  // v360: reconstruimos el value compuesto usando vf-localidad
  // ("PROV||Loc") + vf-tienda (nombre plano), que onTiendaChange dejo en
  // paralelo. Con eso el match funciona y restauramos la seleccion.
  const _prevTiendaVal = (function () {
    const h = document.getElementById('vf-tienda');
    return h ? h.value : '';
  })();
  const _prevLocVal = (function () {
    const h = document.getElementById('vf-localidad');
    return h ? h.value : '';
  })();
  const _prevCompositeVal =
    _prevTiendaVal && _prevLocVal ? _prevLocVal + '||' + _prevTiendaVal : '';
  fsPopulate('vf-tienda', items, function (val) {
    onTiendaChange(val);
  });
  if (_prevCompositeVal) {
    const _opt = items.find(function (i) {
      return i.value === _prevCompositeVal;
    });
    if (_opt) {
      // fsSetValue pone el compuesto en el hidden; onTiendaChange lo pisa
      // con el nombre plano + re-setea vf-localidad. Mismo camino que
      // _fsSelect original.
      fsSetValue('vf-tienda', _prevCompositeVal, _opt.label);
      onTiendaChange(_prevCompositeVal);
    } else {
      fsReset('vf-tienda');
      const _hL = document.getElementById('vf-localidad');
      if (_hL) _hL.value = '';
    }
  } else {
    fsReset('vf-tienda');
  }
  fsPopulate('vf-localidad', [], null);
  // vf-localidad se autocompleta desde onTiendaChange - no lo reseteamos
  // si ya tenia value (mismo razonamiento que vf-tienda arriba).
  const _hLoc = document.getElementById('vf-localidad');
  if (!_hLoc || !_hLoc.value) {
    fsReset('vf-localidad');
  }
  const tiendaInput = document.getElementById('vf-tienda-search');
  if (tiendaInput) {
    tiendaInput.disabled = false;
    tiendaInput.placeholder = items.length
      ? 'Escribí el nombre de la tienda...'
      : 'Sin tiendas habilitadas en SAP para tu zona';
  }
  // Reset del display de localidad detectada.
  const locDetected = document.getElementById('vf-loc-detected');
  if (locDetected) {
    locDetected.style.display = 'none';
    locDetected.textContent = '';
  }
}

// =====================================================================
// Componente Filter-Select (busqueda + dropdown filtrable). Reemplaza a
// los <select> nativos en VISITAS para permitir buscar escribiendo, en
// vez de scrollear listas largas. Estructura HTML esperada:
//   <div class="fs-wrap" data-fs-id="foo">
//     <input class="fs-input" id="foo-search" .../>
//     <button class="fs-clear" onclick="fsClear('foo')">×</button>
//     <div class="fs-dropdown" id="foo-dropdown"></div>
//     <input type="hidden" id="foo"/>  <!-- value real -->
//   </div>
// Uso desde codigo: fsPopulate('foo', [{value, label}, ...], onChange).
// =====================================================================
const _fsRegistry = {};
function _fsNormalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
function fsPopulate(fsId, optionsArray, onChangeCb) {
  _fsRegistry[fsId] = { options: optionsArray || [], onChange: onChangeCb || null };
  _fsRenderDropdown(fsId, '');
}
function _fsRenderDropdown(fsId, query) {
  const dropdown = document.getElementById(fsId + '-dropdown');
  if (!dropdown) return;
  const cfg = _fsRegistry[fsId];
  const opts = cfg ? cfg.options : [];
  const q = _fsNormalize(query);
  const matches = q
    ? opts.filter((o) => _fsNormalize(o.label).includes(q) || _fsNormalize(o.value).includes(q))
    : opts;
  if (!matches.length) {
    dropdown.innerHTML =
      '<div class="fs-item no-match">' +
      (opts.length ? 'Sin resultados' : 'Sin opciones') +
      '</div>';
    return;
  }
  const shown = matches.slice(0, 200);
  dropdown.innerHTML =
    shown
      .map(
        (o) =>
          '<div class="fs-item" data-fs="' +
          escapeAttr(fsId) +
          '" data-value="' +
          escapeAttr(o.value) +
          '" onmousedown="_fsSelect(event)">' +
          escapeHtml(o.label) +
          '</div>'
      )
      .join('') +
    (matches.length > 200
      ? '<div class="fs-item no-match">... y ' +
        (matches.length - 200) +
        ' mas (afina la busqueda)</div>'
      : '');
}
// v361: expuesta en window. Post-E2 (extraccion de visitas al bundle IIFE)
// esbuild tree-shakea funciones no referenciadas desde JS. _fsSelect solo
// se llama desde el HTML inline handler onmousedown="_fsSelect(event)" del
// dropdown -> el tree-shaker no lo ve como uso -> eliminada del bundle ->
// el browser hacia lookup en window al hacer click -> ReferenceError ->
// "no pasa nada" al tocar tienda. Todos los otros handlers fsOn* si estaban
// expuestos porque estan referenciados como oninput/onfocus/onblur/onkeydown
// en <input>. Este era el unico que faltaba.
window._fsSelect = function (evt) {
  evt.preventDefault(); // que no dispare blur del input
  const el = evt.currentTarget;
  const fsId = el.dataset.fs;
  const val = el.dataset.value;
  const label = el.textContent;
  fsSetValue(fsId, val, label);
  const dropdown = document.getElementById(fsId + '-dropdown');
  if (dropdown) dropdown.classList.remove('open');
  const inp = document.getElementById(fsId + '-search');
  if (inp) inp.blur();
  const cfg = _fsRegistry[fsId];
  if (cfg && cfg.onChange) {
    try {
      cfg.onChange(val);
    } catch (e) {
      console.warn('fs onChange', e);
    }
  }
};
window.fsOnInput = function (inputEl) {
  const wrap = inputEl.closest('.fs-wrap');
  if (!wrap) return;
  const fsId = wrap.dataset.fsId;
  _fsRenderDropdown(fsId, inputEl.value);
  const dropdown = document.getElementById(fsId + '-dropdown');
  if (dropdown) dropdown.classList.add('open');
  wrap.classList.toggle('has-value', inputEl.value.trim().length > 0);
};
window.fsOnFocus = function (inputEl) {
  if (inputEl.disabled) return;
  const wrap = inputEl.closest('.fs-wrap');
  if (!wrap) return;
  const fsId = wrap.dataset.fsId;
  _fsRenderDropdown(fsId, inputEl.value);
  const dropdown = document.getElementById(fsId + '-dropdown');
  if (dropdown) dropdown.classList.add('open');
};
window.fsOnBlur = function (inputEl) {
  // Timeout para dejar que el mousedown del item se procese antes de cerrar.
  setTimeout(function () {
    const wrap = inputEl.closest('.fs-wrap');
    if (!wrap) return;
    const fsId = wrap.dataset.fsId;
    const dropdown = document.getElementById(fsId + '-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    // Si el user escribio texto pero no eligio nada (input.value distinto al
    // label del hidden actual), NO borramos el hidden - dejamos que la
    // validacion del form pida elegir una opcion.
  }, 150);
};
window.fsOnKeydown = function (inputEl, evt) {
  if (evt.key === 'Escape') {
    inputEl.blur();
    return;
  }
  if (evt.key === 'Enter') {
    evt.preventDefault();
    // Elegir el primer match visible.
    const wrap = inputEl.closest('.fs-wrap');
    const fsId = wrap.dataset.fsId;
    const dropdown = document.getElementById(fsId + '-dropdown');
    if (!dropdown) return;
    const first = dropdown.querySelector('.fs-item:not(.no-match)');
    if (first) {
      const val = first.dataset.value;
      const label = first.textContent;
      fsSetValue(fsId, val, label);
      dropdown.classList.remove('open');
      inputEl.blur();
      const cfg = _fsRegistry[fsId];
      if (cfg && cfg.onChange) {
        try {
          cfg.onChange(val);
        } catch (_e) {}
      }
    }
  }
};
// Setear el value del hidden + input search. Sirve para restaurar el estado
// al hacer viewVisit u otras acciones que hoy hacen sel.value = "algo".
function fsSetValue(fsId, value, label) {
  const hidden = document.getElementById(fsId);
  const search = document.getElementById(fsId + '-search');
  if (hidden) hidden.value = value || '';
  if (search) {
    // Buscar el label si no fue provisto.
    let lbl = label;
    if (!lbl && value) {
      const cfg = _fsRegistry[fsId];
      if (cfg) {
        const opt = (cfg.options || []).find((o) => o.value === value);
        if (opt) lbl = opt.label;
      }
    }
    search.value = lbl || value || '';
  }
  const wrap = search ? search.closest('.fs-wrap') : null;
  if (wrap) wrap.classList.toggle('has-value', !!value);
}
window.fsSetValue = fsSetValue;
function fsReset(fsId) {
  fsSetValue(fsId, '', '');
}
window.fsReset = fsReset;
window.fsClear = function (fsId) {
  fsReset(fsId);
  const search = document.getElementById(fsId + '-search');
  if (search) search.focus();
  const cfg = _fsRegistry[fsId];
  if (cfg && cfg.onChange) {
    try {
      cfg.onChange('');
    } catch (_e) {}
  }
};

// Renderiza el selector "Crear en nombre de" segun mis parejas VDE. Se llama
// al abrir el modal de Visita y cuando cambia la lista de parejas.
function renderActingAsVendorSelect() {
  const wrap = document.getElementById('vf-actingas-wrap');
  const sel = document.getElementById('vf-actingas');
  if (!wrap || !sel) return;
  // Solo aparece si soy VDI con al menos 1 pareja VDE.
  if (userRole !== 'interno' || !myExternalPartners.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const opts = ['<option value="">Mí mismo (mis pedidos/visitas)</option>'].concat(
    myExternalPartners.map((p) => {
      const label = (p.displayName || p.email || '') + ' [VDE]';
      return (
        '<option value="' +
        escapeAttr(p.uid) +
        '"' +
        (actingOnBehalfOfUid === p.uid ? ' selected' : '') +
        '>' +
        escapeHtml(label) +
        '</option>'
      );
    })
  );
  sel.innerHTML = opts.join('');
  refreshActingAsInfoLine();
}

function refreshActingAsInfoLine() {
  const info = document.getElementById('vf-actingas-info');
  if (!info) return;
  const p = getActingVendorPartner();
  if (p) {
    info.style.display = '';
    info.innerHTML =
      '&#9888;&#65039; La visita queda registrada como del VDE <b>' +
      escapeHtml(p.displayName) +
      '</b>. Le va a llegar una notificacion automatica.';
  } else {
    info.style.display = 'none';
    info.innerHTML = '';
  }
}

window.onActingAsChange = function () {
  const sel = document.getElementById('vf-actingas');
  actingOnBehalfOfUid = sel && sel.value ? sel.value : null;
  // Re-populate localidades segun el VDE elegido (cambia el vendor key efectivo).
  populateVisitaLocalidades();
  refreshActingAsInfoLine();
};

// v298+ deprecado: onLocalidadChange se mantiene como no-op para no romper
// referencias externas. La logica de tiendas ahora se popula toda de una
// (populateVisitaLocalidades) y se filtra por localidad automaticamente
// cuando el vendedor elige tienda (onTiendaChange).
window.onLocalidadChange = function () {
  /* no-op post v298 */
};

// v298+ onTiendaChange: se dispara al seleccionar una tienda del filter-select.
// Parsea el value compuesto "PROV||Loc||Tienda", setea el hidden vf-localidad
// con el formato "PROV||Loc" que espera el resto del flujo (save/validate),
// y pisa el hidden vf-tienda con SOLO el nombre para que readField devuelva
// el nombre plano. Muestra un display de confirmacion con la localidad.
window.onTiendaChange = function (val) {
  const locDetected = document.getElementById('vf-loc-detected');
  const hiddenLoc = document.getElementById('vf-localidad');
  const hiddenTienda = document.getElementById('vf-tienda');
  if (!val) {
    if (hiddenLoc) hiddenLoc.value = '';
    if (hiddenTienda) hiddenTienda.value = '';
    if (locDetected) {
      locDetected.style.display = 'none';
      locDetected.textContent = '';
    }
    return;
  }
  const parts = String(val).split('||');
  const prov = (parts[0] || '').trim();
  const loc = (parts[1] || '').trim();
  const tienda = (parts[2] || '').trim();
  if (hiddenLoc) hiddenLoc.value = prov + '||' + loc;
  if (hiddenTienda) hiddenTienda.value = tienda;
  if (locDetected) {
    locDetected.innerHTML =
      '📍 Localidad detectada: <b>' +
      escapeHtml(loc) +
      '</b> &mdash; ' +
      escapeHtml(titleCase(prov));
    locDetected.style.display = 'block';
  }
};

window.setLikert = function (v) {
  visitState.relevancia = v;
  document
    .querySelectorAll('.vf-likert button')
    .forEach((b) => b.classList.toggle('active', parseInt(b.dataset.v, 10) === v));
};

window.setPop = function (v) {
  visitState.pop = v;
  document
    .querySelectorAll('#vf-pop button')
    .forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  document.getElementById('vf-necesidad-wrap').style.display = v === 'SI' ? '' : 'none';
  if (v !== 'SI') document.getElementById('vf-necesidad').value = '';
};

window.onTipoVentaChange = function () {
  const v = document.getElementById('vf-tipoventa').value;
  document.getElementById('vf-pond-wrap').style.display = v === 'AMBOS' ? '' : 'none';
};

// Compresion de imagenes a base64 jpeg ~700px max + 70% quality
function compressImage(file, maxWidth, quality) {
  maxWidth = maxWidth || 800;
  quality = quality || 0.7;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxWidth / img.width, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.onEspacioPhotos = async function (inp) {
  const files = [...(inp.files || [])];
  for (const f of files) {
    if (visitState.espacioPhotos.length >= 8) {
      alert('Maximo 8 fotos en Espacio');
      break;
    }
    try {
      const b64 = await compressImage(f, 800, 0.7);
      visitState.espacioPhotos.push(b64);
    } catch (e) {
      console.error(e);
    }
  }
  inp.value = '';
  refreshEspacioGrid();
};

window.removeEspacioPhoto = function (idx) {
  visitState.espacioPhotos.splice(idx, 1);
  refreshEspacioGrid();
};

function refreshEspacioGrid() {
  const grid = document.getElementById('vf-espacio-grid');
  const cells = visitState.espacioPhotos
    .map(
      (b64, i) =>
        '<div class="photo-cell"><img src="' +
        b64 +
        '"/><button type="button" class="rm" onclick="removeEspacioPhoto(' +
        i +
        ')">&times;</button></div>'
    )
    .join('');
  const addCell =
    visitState.espacioPhotos.length < 8
      ? '<label class="photo-cell add"><input type="file" accept="image/*,image/heic,image/heif" multiple onchange="onEspacioPhotos(this)"/>+</label>'
      : '';
  grid.innerHTML = cells + addCell;
}

window.onFrentePhoto = async function (inp) {
  const f = inp.files && inp.files[0];
  if (!f) return;
  try {
    visitState.frentePhoto = await compressImage(f, 1000, 0.75);
  } catch (e) {
    console.error(e);
  }
  inp.value = '';
  refreshFrenteGrid();
};

window.removeFrentePhoto = function () {
  visitState.frentePhoto = null;
  refreshFrenteGrid();
};

function refreshFrenteGrid() {
  const wrap = document.getElementById('vf-frente-grid');
  if (!wrap) return;
  if (visitState.frentePhoto) {
    wrap.innerHTML =
      '<div class="photo-cell"><img src="' +
      visitState.frentePhoto +
      '"/><button type="button" class="rm" onclick="removeFrentePhoto()">&times;</button></div>';
  } else {
    wrap.innerHTML =
      '<label class="photo-cell add"><input type="file" accept="image/*,image/heic,image/heif" onchange="onFrentePhoto(this)"/>+</label>';
  }
}

function readField(id) {
  return (document.getElementById(id).value || '').trim();
}

window.submitVisita = async function () {
  // Validar
  const errors = [];
  if (!readField('vf-localidad')) errors.push('Localidad');
  if (!readField('vf-tienda')) errors.push('Tienda de pesca');
  if (!readField('vf-tipo')) errors.push('Tipo');
  // v313+: en modo contacto, forma de contacto es obligatoria.
  if (window.visitMode === 'contacto' && !readField('vf-formaContacto'))
    errors.push('Forma de contacto');
  if (!readField('vf-local')) errors.push('Local');
  if (!readField('vf-tamano')) errors.push('Tamano');
  // v339+: Fidelidad + POP + Tipo de venta ocultos en modo contacto (no aplican).
  const _isContacto = window.visitMode === 'contacto';
  if (!_isContacto && !readField('vf-fidelidad')) errors.push('Fidelidad');
  // v358: fix — Especializacion solo obligatorio en visita presencial.
  // v357 oculto el campo en modo contacto pero olvide sacarlo de la
  // validacion JS de submit → alert "Faltan completar: Especializacion..."
  // aunque el campo estuviera invisible.
  if (!_isContacto && !readField('vf-especializacion'))
    errors.push('Especializacion por tipo de pesca');
  if (!readField('vf-canalcompra')) errors.push('Canal de compra');
  if (!visitState.relevancia) errors.push('Relevancia');
  if (!_isContacto && !visitState.pop) errors.push('POP');
  if (!_isContacto && visitState.pop === 'SI' && !readField('vf-necesidad'))
    errors.push('Necesidad puntual');
  // Frente del local: OPCIONAL (antes era obligatorio para vendedor externo;
  // ahora se puede saltar siempre - el vendedor decide si toma la foto).
  const tv = readField('vf-tipoventa');
  if (!_isContacto && !tv) errors.push('Tipo de venta');
  if (!_isContacto && tv === 'AMBOS') {
    const m = parseFloat(readField('vf-pond-mostrado')) || 0;
    const e = parseFloat(readField('vf-pond-ecommerce')) || 0;
    if (m + e !== 100) errors.push('Ponderacion (debe sumar 100%)');
  }
  if (errors.length) {
    alert('Faltan completar:\n\n- ' + errors.join('\n- '));
    return;
  }

  const tienda = readField('vf-tienda');
  const now = new Date();
  const mes = MESES[now.getMonth()].toUpperCase();
  const anio = now.getFullYear();
  // v304+: mensaje de confirmacion cambia segun modo
  const isContacto = window.visitMode === 'contacto';
  const labelAccion = isContacto ? 'REGISTRAR EL CONTACTO' : 'ENVIAR EL FORMULARIO';
  if (
    !confirm(
      '¿SEGURO QUIERE ' +
        labelAccion +
        ' DE "' +
        tienda +
        '" DEL MES "' +
        mes +
        '" DE "' +
        anio +
        '"?'
    )
  )
    return;

  const [prov, locName] = readField('vf-localidad').split('||');

  // Capturar GPS para validar visita. Mostramos un overlay simple mientras espera.
  showSyncTag('Obteniendo ubicación GPS...');
  const gps = await captureGpsForVisit(prov, locName, tienda);
  // Si esta lejos, pedir confirmacion extra (no bloquea, solo informa)
  if (gps.gpsStatus === 'far') {
    const km = (gps.gpsDistanceM / 1000).toFixed(1);
    if (
      !confirm(
        'AVISO: Tu ubicacion GPS esta a ' +
          km +
          ' km de la tienda registrada. ¿Continuar guardando la visita igual?'
      )
    ) {
      showSyncTag('Cancelado');
      return;
    }
  } else if (gps.gpsStatus === 'denied') {
    if (
      !confirm(
        'No diste permiso de ubicacion. La visita se va a guardar SIN verificacion GPS. ¿Continuar?'
      )
    ) {
      showSyncTag('Cancelado');
      return;
    }
  }

  // Determinar el "dueno" de la visita. Si soy VDI actuando en nombre de un VDE,
  // ownerUid es el del VDE; queda auditoria de quien la cargo (createdBy...).
  const actingPartner = getActingVendorPartner();
  const ownerUid = actingPartner ? actingPartner.uid : currentUser.uid;
  const ownerEmail = actingPartner ? actingPartner.email || '' : currentUser.email || '';
  const vendorKey = actingPartner ? actingPartner.vendor || '' : assignedVendor || '';

  const data = {
    ownerUid: ownerUid,
    ownerEmail: ownerEmail,
    vendor: vendorKey,
    // v304+: interactionType distingue entre visita presencial y contacto
    // no presencial (WhatsApp/Tel/Email). Default 'visita' para retro-compat
    // con docs previos que no tienen el campo. Naming: interactionType (no
    // "tipo") porque 'tipo' ya se usa para tipo de tienda (OUTDOOR/PESCA/etc).
    interactionType: isContacto ? 'contacto' : 'visita',
    // v313+: formaContacto solo tiene sentido en modo contacto. Valores:
    // LLAMADA TELEFONICA / MENSAJE DE WHATSAPP / MENSAJE SMS. En modo
    // visita queda '' (no aplica).
    formaContacto: isContacto ? readField('vf-formaContacto') : '',
    // Auditoria: si fue cargada por un VDI en nombre de un VDE pareja.
    createdByUid: currentUser.uid,
    createdByEmail: currentUser.email || '',
    createdByDisplayName: currentUser.displayName || currentUser.email || '',
    onBehalfOf: !!actingPartner,
    provincia: prov,
    localidad: locName,
    tienda: tienda,
    tipo: readField('vf-tipo'),
    local: readField('vf-local'),
    tamano: readField('vf-tamano'),
    fidelidad: readField('vf-fidelidad'),
    especializacion: readField('vf-especializacion'),
    canalCompra: readField('vf-canalcompra'),
    relevancia: visitState.relevancia,
    pop: visitState.pop,
    necesidadPuntual: visitState.pop === 'SI' ? readField('vf-necesidad') : '',
    espacio: visitState.espacioPhotos,
    oportunidad: readField('vf-oportunidad'),
    masVendido: readField('vf-masvendido'),
    masPreguntan: readField('vf-maspreguntan'),
    ayudaTienda: readField('vf-ayuda'),
    frenteLocal: visitState.frentePhoto,
    tipoVenta: tv,
    ponderacionMostrado: tv === 'AMBOS' ? parseFloat(readField('vf-pond-mostrado')) || 0 : null,
    ponderacionEcommerce: tv === 'AMBOS' ? parseFloat(readField('vf-pond-ecommerce')) || 0 : null,
    competencia: readField('vf-competencia'),
    fecha: now.toISOString().slice(0, 10),
    mes: mes,
    anio: anio,
    gpsStatus: gps.gpsStatus,
    gpsLat: gps.gpsLat,
    gpsLon: gps.gpsLon,
    gpsAccuracy: gps.gpsAccuracy,
    gpsCapturedAt: gps.gpsCapturedAt,
    gpsDistanceM: gps.gpsDistanceM,
    gpsRefLat: gps.gpsRefLat,
    gpsRefLon: gps.gpsRefLon,
    gpsRefSource: gps.gpsRefSource,
    gpsError: gps.gpsError,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  // v304+: si es contacto, forzar arrays vacios para fotos (ni siquiera se
  // muestran los inputs, pero por si el visitState quedaba con photos de una
  // visita anterior sin cerrar el modal, limpiamos para no persistir basura).
  if (isContacto) {
    data.espacio = [];
    data.frenteLocal = '';
  }
  try {
    await fbDb.collection('visits').add(data);
    showSyncTag(isContacto ? 'Contacto registrado' : 'Visita registrada');
    // Si fue creada en nombre de un VDE, notificar al VDE para que este al tanto.
    if (actingPartner) {
      try {
        const me = currentUser.displayName || currentUser.email || 'Tu pareja VDI';
        await fbDb.collection('notifications').add({
          type: 'partner_action',
          subtype: 'visit_created',
          targetUid: actingPartner.uid,
          fromUid: currentUser.uid,
          fromEmail: currentUser.email || '',
          fromDisplayName: me,
          title: me + ' cargo una visita en tu nombre',
          body: 'Tienda: ' + tienda + ' (' + locName + ', ' + titleCase(prov) + ').',
          tienda: tienda,
          provincia: prov,
          localidad: locName,
          status: 'unread',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('notif al VDE pareja', e);
      }
    }
    // Si llegamos aca via 'Contactar' desde una notif, marcamos la notif como leida.
    // v362: window.* porque la var se declara en notificaciones.js (otro modulo
    // del bundle) — cross-module scope requiere window (ver notificaciones.js:1211).
    if (window.pendingNotifIdToMarkRead) {
      try {
        await fbDb.collection('notifications').doc(window.pendingNotifIdToMarkRead).update({
          status: 'read',
          readAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('mark notif read after visit', e);
      }
      window.pendingNotifIdToMarkRead = null;
    }
    alert('Formulario enviado correctamente.');
    resetVisitaForm();
    setVisitaView('list');
  } catch (e) {
    console.error('submitVisita', e);
    alert('Error guardando: ' + (e.message || e));
  }
};

function populateVisitFilters() {
  const mesSel = document.getElementById('vfilt-mes');
  const mesCur = mesSel.value;
  mesSel.innerHTML =
    '<option value="">Todos los meses</option>' +
    MESES.map(
      (m) =>
        '<option value="' +
        m.toUpperCase() +
        '"' +
        (m.toUpperCase() === mesCur ? ' selected' : '') +
        '>' +
        m +
        '</option>'
    ).join('');
  const tiendaSet = new Set(),
    yearSet = new Set(),
    vendorSet = new Set();
  visitsCache.forEach((v) => {
    if (v.tienda) tiendaSet.add(v.tienda);
    if (v.anio) yearSet.add(v.anio);
    if (v.vendor) vendorSet.add(v.vendor);
  });
  const tiendaSel = document.getElementById('vfilt-tienda');
  const tiendaCur = tiendaSel.value;
  tiendaSel.innerHTML =
    '<option value="">Todas las tiendas</option>' +
    [...tiendaSet]
      .sort()
      .map(
        (t) =>
          '<option value="' +
          escapeAttr(t) +
          '"' +
          (t === tiendaCur ? ' selected' : '') +
          '>' +
          escapeHtml(t) +
          '</option>'
      )
      .join('');
  const yearSel = document.getElementById('vfilt-anio');
  const yearCur = yearSel.value;
  yearSel.innerHTML =
    '<option value="">Todos los años</option>' +
    [...yearSet]
      .sort((a, b) => b - a)
      .map(
        (y) =>
          '<option value="' +
          y +
          '"' +
          (String(y) === yearCur ? ' selected' : '') +
          '>' +
          y +
          '</option>'
      )
      .join('');
  // Vendor filter solo se popula para admin/viewer (esta oculto via CSS para vendedor)
  const vendorSel = document.getElementById('vfilt-vendedor');
  const vendorCur = vendorSel.value;
  vendorSel.innerHTML =
    '<option value="">Todos los vendedores</option>' +
    [...vendorSet]
      .sort()
      .map(
        (v) =>
          '<option value="' +
          escapeAttr(v) +
          '"' +
          (v === vendorCur ? ' selected' : '') +
          '>' +
          escapeHtml(titleCase(v)) +
          '</option>'
      )
      .join('');
}

function renderVisitasList() {
  populateVisitFilters();
  const el = document.getElementById('visitas-list');
  if (!visitsCache.length) {
    el.innerHTML = '<div class="no-data">No hay interacciones registradas todavia.</div>';
    return;
  }
  const fMes = document.getElementById('vfilt-mes').value;
  const fTienda = document.getElementById('vfilt-tienda').value;
  const fAnio = document.getElementById('vfilt-anio').value;
  const fVendedor = document.getElementById('vfilt-vendedor').value;
  // v306+: filtro por tipo de interaccion (visita | contacto | ambos).
  const fTipoEl = document.getElementById('vfilt-tipo');
  const fTipo = fTipoEl ? fTipoEl.value : '';
  let list = visitsCache.slice();
  if (fMes) list = list.filter((v) => (v.mes || '').toUpperCase() === fMes);
  if (fTienda) list = list.filter((v) => v.tienda === fTienda);
  if (fAnio) list = list.filter((v) => String(v.anio) === fAnio);
  if (fVendedor && (userRole === 'admin' || userRole === 'viewer'))
    list = list.filter((v) => v.vendor === fVendedor);
  if (fTipo === 'contacto') list = list.filter((v) => v.interactionType === 'contacto');
  else if (fTipo === 'visita') list = list.filter((v) => v.interactionType !== 'contacto');
  list.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  if (!list.length) {
    el.innerHTML = '<div class="no-data">No hay interacciones que coincidan con los filtros.</div>';
    return;
  }
  let html = '';
  list.forEach((v) => {
    // Permisos para eliminar: admin y gerente ven el boton en todas las
    // visitas, vendedores solo en las propias (matcheando ownerUid).
    const canDeleteThis =
      userRole === 'admin' ||
      userRole === 'gerente' ||
      (currentUser && v.ownerUid === currentUser.uid);
    // v306+: badge visual del tipo de interaccion.
    const isContacto = v.interactionType === 'contacto';
    const iBadge = isContacto
      ? '<span style="display:inline-block;background:#ccfbf1;color:#0f766e;border:1px solid #5eead4;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;margin-left:6px">&#128241; Contacto</span>'
      : '<span style="display:inline-block;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;margin-left:6px">&#128100; Visita</span>';
    // v365+: badge de resultado del contacto no presencial (respondio / no respondio / sin marcar).
    // Solo aplica a interactionType === 'contacto'; para visitas presenciales no tiene sentido.
    let resBadge = '';
    if (isContacto) {
      if (v.contactoResultado === 'respondio') {
        resBadge =
          '<span style="display:inline-block;background:#dcfce7;color:#166534;border:1px solid #86efac;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;margin-left:6px">&#9989; Respondio</span>';
      } else if (v.contactoResultado === 'no_respondio') {
        resBadge =
          '<span style="display:inline-block;background:#e2e8f0;color:#475569;border:1px solid #cbd5e1;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;margin-left:6px">&#10060; No respondio</span>';
      } else {
        resBadge =
          '<span style="display:inline-block;background:#fef3c7;color:#78350f;border:1px solid #fcd34d;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;margin-left:6px">&#8987; Sin marcar</span>';
      }
    }
    html +=
      '<div class="visit-card" onclick="viewVisit(\'' +
      escapeAttr(v.id) +
      '\')"><div class="vc-head">';
    html +=
      '<div><div class="vc-name">' + escapeHtml(v.tienda || '?') + iBadge + resBadge + '</div>';
    html +=
      '<div class="vc-meta">' +
      escapeHtml(v.localidad || '') +
      ' / ' +
      escapeHtml(titleCase(v.provincia || '')) +
      (v.vendor ? ' &middot; ' + escapeHtml(titleCase(v.vendor)) : '') +
      '</div>';
    html +=
      '<div class="vc-meta">' +
      escapeHtml(v.tipo || '') +
      (v.local ? ' - ' + escapeHtml(v.local) : '') +
      ' &middot; ' +
      escapeHtml(v.tamano || '') +
      ' &middot; Fidelidad ' +
      escapeHtml(v.fidelidad || '') +
      ' &middot; Relev ' +
      (v.relevancia || 0) +
      '/5</div>';
    if (v.pop === 'SI')
      html +=
        '<div class="vc-meta" style="color:#7c3aed">POP: ' +
        escapeHtml(v.necesidadPuntual || '') +
        '</div>';
    if ((v.espacio || []).length || v.frenteLocal)
      html +=
        '<div class="vc-meta">Fotos: ' +
        (v.frenteLocal ? '1 frente' : '') +
        ((v.espacio || []).length
          ? (v.frenteLocal ? ' + ' : '') + (v.espacio || []).length + ' espacio'
          : '') +
        '</div>';
    const gpsB = gpsBadgeHtml(v);
    if (gpsB) html += '<div class="vc-meta" style="margin-top:4px">' + gpsB + '</div>';
    html +=
      '</div><div class="vc-date" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">' +
      escapeHtml(v.mes || '') +
      ' ' +
      (v.anio || '');
    // v365+: boton ESTADO solo para contactos (no presencial). Abre modal con RESPONDIO / NO RESPONDIO / ELIMINAR.
    if (isContacto && canDeleteThis) {
      html +=
        '<button onclick="event.stopPropagation();openContactoEstadoModal(\'' +
        escapeAttr(v.id) +
        '\')" title="Marcar resultado del contacto (respondio / no respondio) o eliminar" style="background:#0f766e;color:#fff;border:none;padding:5px 10px;border-radius:5px;font-size:10px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128203; Estado</button>';
    }
    if (canDeleteThis && !isContacto) {
      // Para visitas presenciales el ELIMINAR sigue directo (sin pasar por el modal Estado).
      html +=
        '<button onclick="event.stopPropagation();deleteVisit(\'' +
        escapeAttr(v.id) +
        "','" +
        escapeAttr(v.tienda || '') +
        '\')" title="Eliminar esta visita" style="background:#dc2626;color:#fff;border:none;padding:5px 10px;border-radius:5px;font-size:10px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px">&#128465; Eliminar</button>';
    }
    html += '</div>';
    html += '</div></div>';
  });
  el.innerHTML = html;
}

window.deleteVisit = async function (visitId, tiendaName) {
  if (!visitId) return;
  if (!currentUser || !fbDb) {
    alert('Sesion no inicializada.');
    return;
  }
  const v = visitsCache.find((x) => x.id === visitId);
  if (!v) {
    alert('Visita no encontrada.');
    return;
  }
  // Chequeo de permisos redundante (el boton no aparece si no corresponde,
  // pero por si alguien lo dispara via consola).
  const canDelete =
    userRole === 'admin' ||
    userRole === 'gerente' ||
    (currentUser && v.ownerUid === currentUser.uid);
  if (!canDelete) {
    alert('No tenes permisos para eliminar esta visita.');
    return;
  }
  const label = tiendaName || v.tienda || 'esta visita';
  if (
    !confirm(
      'Eliminar la visita de "' +
        label +
        '" del ' +
        (v.mes || '') +
        ' ' +
        (v.anio || '') +
        '?\n\nEsta accion no se puede deshacer.'
    )
  )
    return;
  try {
    await fbDb.collection('visits').doc(visitId).delete();
    try {
      logOp('eliminar_visita', 'visits', visitId, {
        tienda: label,
        mes: v.mes,
        anio: v.anio,
        ownerEmail: v.ownerEmail || '',
      });
    } catch (_e) {}
    if (typeof showSyncTag === 'function') showSyncTag('Visita eliminada');
    // El listener de visits refresca visitsCache automaticamente; forzamos
    // re-render por si el modal se queda visible.
    try {
      renderVisitasList();
    } catch (_e) {}
  } catch (e) {
    console.error('deleteVisit', e);
    alert('Error eliminando la visita: ' + (e.message || e));
  }
};

// v365+: modal "Estado del contacto" — marca si el cliente respondio al contacto no presencial.
// Estado guardado en visits/{visitId}.contactoResultado como 'respondio' | 'no_respondio'.
// Uso: openContactoEstadoModal(visitId) abre el modal precargando info del contacto.
// Los botones del modal (setContactoResultado / deleteContactoFromEstadoModal) actuan sobre
// window._contactoEstadoTargetId que preserva a que doc apuntar.
if (typeof window._contactoEstadoTargetId === 'undefined') window._contactoEstadoTargetId = null;

window.openContactoEstadoModal = function (visitId) {
  if (!visitId) return;
  const v = (visitsCache || []).find((x) => x.id === visitId);
  if (!v) {
    alert('Contacto no encontrado en cache.');
    return;
  }
  if (v.interactionType !== 'contacto') {
    alert('Este registro no es un contacto no presencial.');
    return;
  }
  window._contactoEstadoTargetId = visitId;
  const info = document.getElementById('ce-modal-info');
  if (info) {
    const forma = v.formaContacto ? ' &middot; via ' + escapeHtml(v.formaContacto) : '';
    const cur =
      v.contactoResultado === 'respondio'
        ? '<b style="color:#166534">Respondio</b>'
        : v.contactoResultado === 'no_respondio'
          ? '<b style="color:#475569">No respondio</b>'
          : '<b style="color:#78350f">Sin marcar</b>';
    info.innerHTML =
      '<b>' +
      escapeHtml(v.tienda || '?') +
      '</b>' +
      forma +
      '<br>' +
      escapeHtml(v.localidad || '') +
      ' &middot; ' +
      escapeHtml(titleCase(v.provincia || '')) +
      '<br>' +
      escapeHtml(v.mes || '') +
      ' ' +
      (v.anio || '') +
      ' &middot; Estado actual: ' +
      cur;
  }
  const modal = document.getElementById('contacto-estado-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeContactoEstadoModal = function () {
  const modal = document.getElementById('contacto-estado-modal');
  if (modal) modal.style.display = 'none';
  window._contactoEstadoTargetId = null;
};

window.setContactoResultado = async function (resultado) {
  const visitId = window._contactoEstadoTargetId;
  if (!visitId) return;
  if (!currentUser || !fbDb) {
    alert('Sesion no inicializada.');
    return;
  }
  if (resultado !== 'respondio' && resultado !== 'no_respondio') {
    alert('Resultado invalido: ' + resultado);
    return;
  }
  const v = visitsCache.find((x) => x.id === visitId);
  if (!v) {
    alert('Contacto no encontrado.');
    return;
  }
  const canEdit =
    userRole === 'admin' ||
    userRole === 'gerente' ||
    (currentUser && v.ownerUid === currentUser.uid);
  if (!canEdit) {
    alert('No tenes permisos para modificar este contacto.');
    return;
  }
  try {
    await fbDb
      .collection('visits')
      .doc(visitId)
      .update({
        contactoResultado: resultado,
        contactoResultadoAt: firebase.firestore.FieldValue.serverTimestamp(),
        contactoResultadoBy: currentUser.uid,
        contactoResultadoByEmail: currentUser.email || '',
      });
    try {
      logOp('contacto_resultado', 'visits', visitId, {
        tienda: v.tienda,
        resultado: resultado,
        mes: v.mes,
        anio: v.anio,
      });
    } catch (_e) {}
    if (typeof showSyncTag === 'function')
      showSyncTag(resultado === 'respondio' ? 'Marcado: respondio' : 'Marcado: no respondio');
    window.closeContactoEstadoModal();
    // El listener refresca visitsCache; forzamos re-render por si.
    try {
      renderVisitasList();
    } catch (_e) {}
  } catch (e) {
    console.error('setContactoResultado', e);
    alert('Error guardando el resultado: ' + (e.message || e));
  }
};

window.deleteContactoFromEstadoModal = function () {
  const visitId = window._contactoEstadoTargetId;
  if (!visitId) return;
  const v = visitsCache.find((x) => x.id === visitId);
  if (!v) {
    alert('Contacto no encontrado.');
    return;
  }
  // Cerramos el modal antes de disparar el confirm del deleteVisit para que el
  // usuario vea el confirm sin overlay encima.
  window.closeContactoEstadoModal();
  window.deleteVisit(visitId, v.tienda || '');
};

let visitViewMode = 'new';
function setVisitFormReadonly(readonly) {
  const form = document.getElementById('visita-form');
  form.querySelectorAll('select,input,textarea').forEach((el) => {
    if (readonly) el.setAttribute('disabled', 'disabled');
    else el.removeAttribute('disabled');
  });
  form.querySelectorAll('.vf-likert button, .vf-toggle button').forEach((b) => {
    if (readonly) b.setAttribute('disabled', 'disabled');
    else b.removeAttribute('disabled');
  });
  document.querySelectorAll('#visita-form .photo-cell.add').forEach((c) => {
    c.style.display = readonly ? 'none' : '';
  });
  document.querySelectorAll('#visita-form .photo-cell .rm').forEach((b) => {
    b.style.display = readonly ? 'none' : '';
  });
  // Footer: en view ocultar Enviar/Cancelar, mostrar Cerrar + Nueva visita
  const footer = document.getElementById('visita-footer');
  if (readonly) {
    footer.innerHTML =
      '<span style="color:#475569">Solo lectura</span><div style="display:flex;gap:8px"><button class="btn-cancel" onclick="resetVisitaForm();setVisitFormReadonly(false);setVisitaView(\'form\');">Nueva visita</button><button class="btn-confirm" style="background:#7c3aed" onclick="closeVisitaModal()">Cerrar</button></div>';
  } else {
    footer.innerHTML =
      '<span style="color:#475569">Se guarda en la nube al enviar</span><div style="display:flex;gap:8px"><button class="btn-cancel" onclick="closeVisitaModal()">Cancelar</button><button class="btn-confirm" style="background:#7c3aed" onclick="submitVisita()">Enviar formulario</button></div>';
  }
}

window.viewVisit = function (visitId) {
  const v = visitsCache.find((x) => x.id === visitId);
  if (!v) return;
  visitViewMode = 'view';
  // Switch to form view + populate
  setVisitaView('form');
  resetVisitaForm();
  // Populate fields — v298+: la tienda es la fuente, la localidad se
  // autocompleta. fsSetValue en vf-tienda pone el value compuesto
  // "PROV||Loc||Tienda" para que matchee alguna opcion del dropdown;
  // luego onTiendaChange pisa los hiddens con los valores atomicos.
  const provU = (v.provincia || '').toUpperCase();
  const compositeVal = provU + '||' + (v.localidad || '') + '||' + (v.tienda || '');
  const compositeLabel =
    (v.tienda || '') + ' — ' + (v.localidad || '') + ', ' + titleCase(v.provincia || '');
  fsSetValue('vf-tienda', compositeVal, compositeLabel);
  onTiendaChange(compositeVal);
  document.getElementById('vf-tipo').value = v.tipo || '';
  // v313+: al abrir una interaccion, aplicar el modo correcto (visita/contacto)
  // segun interactionType y precargar la forma de contacto si aplica.
  const _iType = v.interactionType === 'contacto' ? 'contacto' : 'visita';
  window.visitMode = _iType;
  if (typeof applyVisitModeUI === 'function') applyVisitModeUI(_iType);
  const _fcEl = document.getElementById('vf-formaContacto');
  if (_fcEl) _fcEl.value = v.formaContacto || '';
  document.getElementById('vf-local').value = v.local || '';
  document.getElementById('vf-tamano').value = v.tamano || '';
  document.getElementById('vf-fidelidad').value = v.fidelidad || '';
  if (v.relevancia) setLikert(v.relevancia);
  if (v.pop) setPop(v.pop);
  if (v.necesidadPuntual) document.getElementById('vf-necesidad').value = v.necesidadPuntual;
  visitState.espacioPhotos = [...(v.espacio || [])];
  refreshEspacioGrid();
  document.getElementById('vf-oportunidad').value = v.oportunidad || '';
  document.getElementById('vf-masvendido').value = v.masVendido || '';
  document.getElementById('vf-maspreguntan').value = v.masPreguntan || '';
  document.getElementById('vf-ayuda').value = v.ayudaTienda || '';
  visitState.frentePhoto = v.frenteLocal || null;
  refreshFrenteGrid();
  document.getElementById('vf-tipoventa').value = v.tipoVenta || '';
  onTipoVentaChange();
  if (v.ponderacionMostrado != null)
    document.getElementById('vf-pond-mostrado').value = v.ponderacionMostrado;
  if (v.ponderacionEcommerce != null)
    document.getElementById('vf-pond-ecommerce').value = v.ponderacionEcommerce;
  document.getElementById('vf-competencia').value = v.competencia || '';
  // Info GPS (solo si tiene)
  const gi = document.getElementById('vf-gps-info');
  if (gi) {
    if (v.gpsStatus) {
      const badge = gpsBadgeHtml(v);
      const lat = v.gpsLat,
        lon = v.gpsLon;
      const refLat = v.gpsRefLat,
        refLon = v.gpsRefLon;
      const acc = v.gpsAccuracy != null ? v.gpsAccuracy + ' m' : '';
      const at = v.gpsCapturedAt ? new Date(v.gpsCapturedAt).toLocaleString() : '';
      let body =
        '<label>Verificaci&oacute;n GPS</label><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-size:11px;color:#334155;line-height:1.5">';
      body += badge ? badge + '<br>' : '';
      if (lat && lon)
        body +=
          'GPS del envio: <b>' +
          lat.toFixed(6) +
          ', ' +
          lon.toFixed(6) +
          '</b>' +
          (acc ? ' &middot; precision ' + acc : '') +
          '<br>';
      if (refLat && refLon)
        body +=
          'Tienda registrada: <b>' +
          refLat.toFixed(6) +
          ', ' +
          refLon.toFixed(6) +
          '</b>' +
          (v.gpsRefSource ? ' &middot; fuente ' + v.gpsRefSource : '') +
          '<br>';
      if (at) body += 'Capturado: ' + at + '<br>';
      if (lat && lon)
        body +=
          '<a href="https://www.google.com/maps?q=' +
          lat +
          ',' +
          lon +
          '" target="_blank" style="color:#0284a0;font-weight:700">Ver punto en Google Maps &rarr;</a>';
      if (v.gpsError)
        body += '<br><span style="color:#991b1b">Error: ' + escapeHtml(v.gpsError) + '</span>';
      body += '</div>';
      gi.innerHTML = body;
    } else {
      gi.innerHTML = '';
    }
  }
  setVisitFormReadonly(true);
};

// === Exports a window ===
if (typeof window.compressImage === 'undefined') window.compressImage = compressImage;
window.setVisitFormReadonly = setVisitFormReadonly;
// E6 hotfix: applyRolePermissions del inline (L11540) llama estas 3 funciones
// sin prefix. Sin window.* explicit, tira ReferenceError al login y la app
// queda en 'Cargando sesion...' indefinidamente. Bug de las extracciones E2.
window.ensureClientLocsListener = ensureClientLocsListener;
// E6 hotfix 2: MÁS helpers de visitas usadas por el inline sin prefix window.
// - clientLocId: chequeado con typeof en isSapConfirmed L4281, sin window
//   `typeof clientLocId === 'function'` devuelve 'undefined' → skipea Path 1
//   del isSapConfirmed → retorna false para todos → filteredPoints() = 0 →
//   stats muestran 0 en LOCALIDADES/HABILITADOS/PENDIENTES/TIENDAS.
// - clientMatchesQuery: usada por renderClients + renderPedidosTab search.
// - getClientCategoryBadgeHtml: usada por renderClients + renderPedidosTab badges.
window.clientLocId = clientLocId;
window.clientMatchesQuery = clientMatchesQuery;
window.getClientCategoryBadgeHtml = getClientCategoryBadgeHtml;
// E6 hotfix 2: helpers de UI visitas usados por inline.
window.populateVisitaLocalidades = populateVisitaLocalidades;
window.renderActingAsVendorSelect = renderActingAsVendorSelect;
window.renderVisitasList = renderVisitasList;
