// @ts-nocheck
// MASTER-CLIENTES: Panel admin del master de clientes con direcciones exactas
// por tienda, GPS, categoría (regular/especial/distribuidor), provisorios,
// vinculación SAP (VSM), import bulk desde archivo SAP, autosave debounced.
// Extraído verbatim de index.html (líneas 6898-8856 pre-E2.l) como parte
// de E2.l (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// Cross-scope state (via window):
// - window.clientMasterCache (Map): LEÍDA por 15+ callers en varios dominios
//   (targets, isSapConfirmed, pedido-modal _addrFor, rutas _zonasAddrFor,
//   pedido discount calc, renderMasterClientesTable, etc.). El Map se preserva
//   mediante alias local: const clientMasterCache = window.clientMasterCache.
// - window.unsubClientMaster: cleanup en detachFirebaseListeners inline.
//
// Locals al módulo: mcPendingChanges, mcAutosaveTimers (const), mcPendingRowIds
// (const Set), mcAutosaveInFlight, mcRenderDeferred, mcProvisorioMode,
// mcShowBaseMaster, _mcSapParsedRows/Matched/Unmatched, vsmProvisorioId,
// vsmSelectedSapId.
//
// Deps del inline: fbDb, firebase, currentUser, userRole, POINTS, VENDORS,
// approvedAltasList, escapeHtml, titleCase, showSyncTag, matchesAllTokens
// (bundle __phase0.pure), findSapDuplicateForProvisorio (bundle), clientLocId,
// normClientName (bundle __phase0.pure).
// ============================================================
// MASTER CLIENTES - direcciones exactas por tienda (admin)
// ============================================================
// Doc id deterministico (mismo helper que client_locations): provincia__localidad__nombre.
// Schema: clientName, provincia, localidad, vendor, address, updatedBy, updatedAt.
if (typeof window.clientMasterCache === 'undefined') window.clientMasterCache = new Map();
const clientMasterCache = window.clientMasterCache;
if (typeof window.unsubClientMaster === 'undefined') window.unsubClientMaster = null;
let mcPendingChanges = {}; // docId -> nuevo address (en proceso)

// Autosave debounced por fila. Antes solo se guardaba al tocar GUARDAR y
// solo detectaba cambios en el input de direccion (mcPendingChanges), asi
// que si cambiabas localidad/provincia y cerrabas el modal se perdian sin
// aviso. Ahora cada cambio programa un save a los 900ms.
const mcAutosaveTimers = {}; // docId -> setTimeout id
const mcPendingRowIds = new Set(); // docIds con cambios locales aun no persistidos
let mcAutosaveInFlight = 0;
let mcRenderDeferred = false;

function updateMcDirtyStat() {
  const statsEl = document.getElementById('mc-stats');
  if (!statsEl) return;
  let dirtySpan = statsEl.querySelector('.mc-dirty');
  const n = mcPendingRowIds.size + mcAutosaveInFlight;
  if (n > 0) {
    if (!dirtySpan) {
      dirtySpan = document.createElement('span');
      dirtySpan.className = 'mc-dirty';
      dirtySpan.style.background = '#fef3c7';
      dirtySpan.style.color = '#92400e';
      dirtySpan.style.borderColor = '#fde68a';
      statsEl.appendChild(dirtySpan);
    }
    dirtySpan.textContent = (mcAutosaveInFlight > 0 ? 'Guardando ' : 'Pendientes: ') + n;
  } else if (dirtySpan) {
    dirtySpan.remove();
    // Si el listener quiso re-renderear mientras habia cambios en vuelo,
    // aplicarlo ahora que todo esta commiteado.
    if (mcRenderDeferred) {
      mcRenderDeferred = false;
      try {
        if (typeof renderMasterClientesTable === 'function') renderMasterClientesTable();
      } catch (_e) {}
    }
  }
}

function scheduleMcAutosave(docId, row, delay) {
  if (!docId || !row) return;
  mcPendingRowIds.add(docId);
  updateMcDirtyStat();
  if (mcAutosaveTimers[docId]) clearTimeout(mcAutosaveTimers[docId]);
  mcAutosaveTimers[docId] = setTimeout(async () => {
    delete mcAutosaveTimers[docId];
    const btn = row.querySelector('.mc-save-btn');
    if (!btn || btn.disabled) return;
    mcAutosaveInFlight++;
    updateMcDirtyStat();
    try {
      await window.saveMcAddr(docId, btn);
    } catch (e) {
      console.error('autosave mc', docId, e);
    } finally {
      mcAutosaveInFlight = Math.max(0, mcAutosaveInFlight - 1);
      mcPendingRowIds.delete(docId);
      updateMcDirtyStat();
    }
  }, delay || 900);
}
window.onMcSapFieldChange = function (el) {
  const row = el && el.closest ? el.closest('tr') : null;
  if (!row) return;
  const docId = row.getAttribute('data-doc');
  if (!docId) return;
  el.classList.toggle('has-value', !!(el.value || '').trim());
  scheduleMcAutosave(docId, row, 900);
};

// Clientes provisorios de Alta Rapida: viven en client_applications con
// status='approved' + manualSapPending=true + source='alta_rapida'. Ya estan
// cacheados globalmente en approvedAltasList (poblada por
// ensureApprovedAltasListener). Aca solo agregamos el toggle para filtrar
// esa lista dentro del panel Master Clientes.
let mcProvisorioMode = false;
// v349+ (2026-07-29): modo SAP - filtra solo altas con cardCodeSap (contraparte
// del modo Provisorios). Toggle exclusivo con mcProvisorioMode (encender uno
// apaga el otro).
let mcSapMode = false;

function getProvisoriosList() {
  const arr = typeof approvedAltasList !== 'undefined' ? approvedAltasList : [];
  return arr.filter((a) => a && a.manualSapPending && !a.cardCodeSap);
}
function getSapList() {
  const arr = typeof approvedAltasList !== 'undefined' ? approvedAltasList : [];
  return arr.filter((a) => a && a.cardCodeSap);
}
function updateMcProvisorioCount() {
  const cnt = document.getElementById('mc-prov-count');
  if (cnt) cnt.textContent = getProvisoriosList().length;
  const sapCnt = document.getElementById('mc-sap-only-count');
  if (sapCnt) sapCnt.textContent = getSapList().length;
}

window.toggleMcProvisorios = function () {
  mcProvisorioMode = !mcProvisorioMode;
  if (mcProvisorioMode) mcSapMode = false; // modos exclusivos
  const btn = document.getElementById('mc-prov-toggle-btn');
  if (btn) btn.classList.toggle('active', mcProvisorioMode);
  const sapBtn = document.getElementById('mc-sap-only-btn');
  if (sapBtn) sapBtn.classList.toggle('active', mcSapMode);
  renderMasterClientesTable();
};

window.toggleMcSapOnly = function () {
  mcSapMode = !mcSapMode;
  if (mcSapMode) mcProvisorioMode = false; // modos exclusivos
  const btn = document.getElementById('mc-sap-only-btn');
  if (btn) btn.classList.toggle('active', mcSapMode);
  const provBtn = document.getElementById('mc-prov-toggle-btn');
  if (provBtn) provBtn.classList.toggle('active', mcProvisorioMode);
  renderMasterClientesTable();
};

function ensureClientMasterListener() {
  if (unsubClientMaster || !currentUser || !fbDb) return;
  window.unsubClientMaster = fbDb.collection('client_master').onSnapshot(
    (qs) => {
      clientMasterCache.clear();
      qs.forEach((d) => clientMasterCache.set(d.id, Object.assign({ _id: d.id }, d.data())));
      const m = document.getElementById('master-cli-modal');
      if (m && m.classList.contains('open')) renderMasterClientesTable();
      // Como el mapa filtra por SAP-confirmado (lee de clientMasterCache), si
      // hay un import o un cambio de address/sapCardCode tenemos que repintar
      // los marcadores y los conteos.
      try {
        if (typeof drawMarkers === 'function') drawMarkers();
      } catch (_e) {}
      try {
        if (typeof restyleZoneLayers === 'function') restyleZoneLayers();
      } catch (_e) {}
      try {
        if (typeof renderClients === 'function' && typeof filteredPoints === 'function')
          renderClients(filteredPoints());
      } catch (_e) {}
    },
    (err) => console.warn('client_master listener', err)
  );
}

// Toggle: por default Master Clientes muestra SOLO los SAP-confirmados. Si
// admin toca el boton "Masterfile-Base", pasa a mostrar TAMBIEN el padron
// completo (POINTS clients + prospects) - la vista anterior.
// CROSS-SCOPE (E6 fix C2): window.toggleMcBaseMaster en index.html:4048 lee y
// asigna mcShowBaseMaster. Sin window.* prefix, bundle strict tira ReferenceError
// al primer click del botón "Masterfile-Base".
if (typeof window.mcShowBaseMaster === 'undefined') window.mcShowBaseMaster = false;
function getAllStoreEntries() {
  // Devuelve [{nombre, localidad, provincia, vendor, tipo, lat, lon}] segun el
  // toggle de vista. Default: solo SAP-confirmados (~46). Con base activado:
  // se suman tambien POINTS del padron historico (~1000+).
  const out = [];
  if (window.mcShowBaseMaster) {
    (POINTS || []).forEach((p) => {
      (p.clients || []).forEach((n) =>
        out.push({
          nombre: n,
          localidad: p.name,
          provincia: p.province,
          vendor: p.vendor || '',
          tipo: 'cliente',
          locLat: p.lat,
          locLon: p.lon,
        })
      );
      (p.prospects || []).forEach((n) =>
        out.push({
          nombre: n,
          localidad: p.name,
          provincia: p.province,
          vendor: p.vendor || '',
          tipo: 'prospecto',
          locLat: p.lat,
          locLon: p.lon,
        })
      );
    });
  } else {
    // Default: solo POINTS confirmados en SAP via isSapConfirmed.
    (POINTS || []).forEach((p) => {
      (p.clients || []).forEach((n) => {
        if (typeof isSapConfirmed === 'function' && !isSapConfirmed(p.province, p.name, n)) return;
        out.push({
          nombre: n,
          localidad: p.name,
          provincia: p.province,
          vendor: p.vendor || '',
          tipo: 'cliente',
          locLat: p.lat,
          locLon: p.lon,
        });
      });
      // En modo SAP, no incluimos prospectos (no estan en SAP por definicion).
    });
  }
  // Agregar SAP altas huerfanas: las que tienen cardCodeSap y no matchean
  // contra ningun POINT por nombre+provincia. Estas son las ~46 tiendas
  // SAP que vinieron del import bulk y nunca se ancla ron al padron de
  // POINTS porque el CardName (legal) difiere del nombre comercial.
  const ptNames = new Set();
  out.forEach((e) =>
    ptNames.add((e.provincia || '').toUpperCase() + '|' + (e.nombre || '').toLowerCase())
  );
  (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).forEach((a) => {
    if (!a) return;
    if (!a.cardCodeSap && !a.manualSapPending) return;
    // Provincia vacia: incluimos igual bajo "(sin provincia)" - sino el
    // admin no las ve para corregirles los datos. Esto pasa cuando el
    // Excel SAP no traia columna State, o tenia un nombre que el parser
    // no reconocio.
    const prov = (a.provincia || '').toUpperCase().trim() || '(sin provincia)';
    const nombre = a.comercio || a.fantasia || 'SAP ' + (a.cardCodeSap || '').slice(0, 8);
    if (ptNames.has(prov + '|' + nombre.toLowerCase())) return;
    const localidad = (a.localidadFinal || a.localidad || '').trim() || '(sin localidad)';
    out.push({
      nombre,
      localidad,
      provincia: prov,
      vendor: a.assignedVendor || '',
      tipo: 'sap_alta',
      sapFsId: a._fsId,
      sapCardCode: a.cardCodeSap || '',
      locLat: a.lat != null ? a.lat : null,
      locLon: a.lng != null ? a.lng : null,
    });
  });
  return out;
}

window.openMasterClientesPanel = function () {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede acceder a Master Clientes.');
    return;
  }
  ensureClientMasterListener();
  if (typeof ensureApprovedAltasListener === 'function') ensureApprovedAltasListener();
  updateMcProvisorioCount();
  mcPendingChanges = {};
  mcProvisorioMode = false;
  mcSapMode = false;
  const _pb = document.getElementById('mc-prov-toggle-btn');
  if (_pb) _pb.classList.remove('active');
  const _sb = document.getElementById('mc-sap-only-btn');
  if (_sb) _sb.classList.remove('active');
  // Cargar filtros si no estan poblados
  const vSel = document.getElementById('mc-filt-vendor');
  if (vSel.options.length <= 1) {
    VENDORS.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.key;
      o.textContent = v.zone + ' - ' + titleCase(v.key);
      vSel.appendChild(o);
    });
  }
  const pSel = document.getElementById('mc-filt-prov');
  if (pSel.options.length <= 1) {
    const provs = new Set();
    (POINTS || []).forEach((p) => provs.add(p.province));
    [...provs].sort().forEach((pr) => {
      const o = document.createElement('option');
      o.value = pr;
      o.textContent = titleCase(pr);
      pSel.appendChild(o);
    });
  }
  // Reset filtro localidad cuando se abre
  rebuildMcLocalidadOptions();
  document.getElementById('master-cli-modal').classList.add('open');
  renderMasterClientesTable();
};
window.closeMasterClientesPanel = function () {
  const dirty =
    Object.keys(mcPendingChanges).length > 0 ||
    mcPendingRowIds.size > 0 ||
    mcAutosaveInFlight > 0 ||
    Object.keys(mcAutosaveTimers).length > 0;
  if (
    dirty &&
    !confirm(
      'Hay cambios sin guardar (o guardando). Cerrar igual? Puede perderse la ultima edicion.'
    )
  )
    return;
  document.getElementById('master-cli-modal').classList.remove('open');
  mcPendingChanges = {};
  // No limpiamos mcPendingRowIds ni cancelamos timers: si el usuario dijo
  // "cerrar igual", queremos que los saves en vuelo terminen igual y solo
  // se pierdan los cambios que aun no dispararon el debounce.
  Object.keys(mcAutosaveTimers).forEach((id) => {
    clearTimeout(mcAutosaveTimers[id]);
    delete mcAutosaveTimers[id];
  });
};

// =====================================================================
// Import masivo desde SAP B1 (CardCode + direcciones) al Master Clientes
// =====================================================================
// El admin descarga el master de Business Partners de SAP B1 (CSV o XLSX),
// lo sube aca y los datos se aplican a las tiendas del mapa. El matching
// se hace por nombre normalizado del cliente (cardName del SAP vs
// clientName del POINTS).
// Schema extendido en client_master: { ..., sapCardCode, sapAddress }
let _mcSapParsedRows = []; // [{cardCode, cardName, address, city, state}]
let _mcSapMatched = []; // [{docId, point, sapRow, willOverwrite}]
let _mcSapUnmatched = []; // [{sapRow}] - rows que no encontraron tienda

window.openMcSapImport = function () {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede usar esta funcion.');
    return;
  }
  _mcSapParsedRows = [];
  _mcSapMatched = [];
  _mcSapUnmatched = [];
  document.getElementById('mc-sap-preview').style.display = 'none';
  document.getElementById('mc-sap-error').style.display = 'none';
  document.getElementById('mc-sap-unmatched').style.display = 'none';
  document.getElementById('mc-sap-file-input').value = '';
  document.getElementById('mc-sap-apply-btn').disabled = true;
  // Drag & drop init solo la primera vez
  const drop = document.getElementById('mc-sap-drop');
  if (drop && !drop.dataset.dragInit) {
    drop.dataset.dragInit = '1';
    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove('dragover');
      })
    );
    drop.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) parseMcSapFile(file);
    });
  }
  document.getElementById('mc-sap-modal').classList.add('open');
};
window.closeMcSapImport = function () {
  document.getElementById('mc-sap-modal').classList.remove('open');
  _mcSapParsedRows = [];
  _mcSapMatched = [];
  _mcSapUnmatched = [];
};

window.onMcSapFileSelected = function (ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  parseMcSapFile(file);
};

// Normaliza un nombre para comparacion: uppercase, sin acentos, sin
// caracteres especiales, sin espacios multiples. Tambien elimina sufijos
// societarios comunes (S.A., S.R.L., etc) para mejorar el fuzzy matching.
function _mcNormName(s) {
  if (!s) return '';
  let n = String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Quitar sufijos societarios comunes para que "JUAN PESCA" y "JUAN PESCA S.R.L."
  // matcheen mejor.
  n = n
    .replace(/\b(SA|SRL|SAS|SH|SCA|EIRL|LTDA|LTD)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n;
}

// Similitud entre dos strings (0..1). Implementacion simple basada en
// distancia de Levenshtein normalizada por longitud. Para nuestro caso
// (nombres de tiendas) es suficiente y rapida.
function _mcStringSim(a, b) {
  a = a || '';
  b = b || '';
  if (a === b) return 1;
  if (!a || !b) return 0;
  const la = a.length,
    lb = b.length;
  // Optimizacion: si las longitudes son muy diferentes, no puede ser match.
  if (Math.abs(la - lb) / Math.max(la, lb) > 0.5) return 0;
  // Construir matriz de Levenshtein
  const dp = Array(la + 1)
    .fill(null)
    .map(() => Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const dist = dp[la][lb];
  return 1 - dist / Math.max(la, lb);
}

// Busca un match para una tienda del SAP entre los puntos del mapa.
// Devuelve {entry, similarity, matchType} o null. matchType:
//   'exact'  -> nombre normalizado identico (en cualquier provincia)
//   'fuzzy'  -> similitud >= 0.82 + misma provincia
//   null     -> no encontro
function _mcFindMatch(sapName, sapState, storeIndex, allStores) {
  const k = _mcNormName(sapName);
  if (storeIndex[k] && storeIndex[k].length) {
    return { entries: storeIndex[k], similarity: 1, matchType: 'exact' };
  }
  // Fuzzy: probar contra todos los stores de la misma provincia.
  const sapStateUp = (sapState || '').toUpperCase().trim();
  if (!sapStateUp) return null;
  let best = null;
  allStores.forEach((e) => {
    if ((e.provincia || '').toUpperCase().trim() !== sapStateUp) return;
    const sim = _mcStringSim(k, _mcNormName(e.nombre));
    if (sim >= 0.82 && (!best || sim > best.similarity)) {
      best = { entries: [e], similarity: sim, matchType: 'fuzzy' };
    }
  });
  return best;
}

async function parseMcSapFile(file) {
  const errEl = document.getElementById('mc-sap-error');
  const prevEl = document.getElementById('mc-sap-preview');
  const unmEl = document.getElementById('mc-sap-unmatched');
  errEl.style.display = 'none';
  prevEl.style.display = 'none';
  unmEl.style.display = 'none';
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let rows = [];
    if (ext === 'xlsx' || ext === 'xls') {
      if (typeof XLSX === 'undefined')
        throw new Error('La libreria XLSX no se cargo. Recarga la pagina y reintenta.');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else if (ext === 'csv') {
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      // Detectar delimiter
      const firstLine = text.split(/\r?\n/)[0] || '';
      let delim = ',';
      let maxC = 0;
      [';', '|', '\t', ','].forEach((d) => {
        const c = (
          firstLine.match(new RegExp(d === '|' ? '\\|' : d === '\t' ? '\\t' : d, 'g')) || []
        ).length;
        if (c > maxC) {
          maxC = c;
          delim = d;
        }
      });
      if (typeof XLSX !== 'undefined') {
        // Usar XLSX para parsear CSV - es mas robusto
        const wb = XLSX.read(text, { type: 'string', FS: delim });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      } else {
        // Fallback manual
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        const header = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
        rows = lines.slice(1).map((line) => {
          const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
          const o = {};
          header.forEach((h, i) => {
            o[h] = cells[i] || '';
          });
          return o;
        });
      }
    } else {
      throw new Error('Formato no soportado: ' + ext + '. Subi un archivo .csv, .xlsx o .xls');
    }
    if (!rows.length) throw new Error('El archivo no tiene filas de datos.');

    // Mapear columnas. Acepta varios nombres como sinonimos. El orden importa:
    // findKey itera candidates en orden y devuelve el primer header del archivo
    // que matchea. Para state ponemos 'provincia_1' antes que 'provincia' porque
    // los exports de SAP B1 traen "Provincia" dos veces (la primera columna
    // suele venir vacia / con fecha y la real queda en "Provincia_1").
    const SKU_NAMES = {
      cardCode: [
        'cardcode',
        'codigo',
        'code',
        'codigo cliente',
        'id',
        'codigo sn',
        'código sn',
        'code sn',
        'codigosn',
      ],
      cardName: [
        'cardname',
        'name',
        'nombre',
        'razon social',
        'razonsocial',
        'cliente',
        'clientname',
        'nombre cliente',
        'nombre sn',
        'namesn',
        'nombresn',
      ],
      address: [
        'address',
        'direccion',
        'street',
        'calle',
        'address1',
        'domicilio',
        'ship-to street',
        'ship to street',
        'direccion envio',
      ],
      city: ['city', 'ciudad', 'localidad', 'locality', 'ship-to city', 'ship to city'],
      state: ['provincia_1', 'ship-to state', 'ship to state', 'state', 'province', 'provincia'],
    };
    function findKey(row, candidates) {
      const keys = Object.keys(row);
      // Iterar candidates en orden de prioridad: el primero que aparece en el
      // archivo gana. Asi 'provincia_1' tiene prioridad sobre 'provincia'.
      for (const cand of candidates) {
        for (const k of keys) {
          if (k.toLowerCase().trim() === cand) return k;
        }
      }
      return null;
    }
    if (!rows[0]) throw new Error('Sin datos.');
    const kCard = findKey(rows[0], SKU_NAMES.cardCode);
    const kName = findKey(rows[0], SKU_NAMES.cardName);
    const kAddr = findKey(rows[0], SKU_NAMES.address);
    const kCity = findKey(rows[0], SKU_NAMES.city);
    const kState = findKey(rows[0], SKU_NAMES.state);
    if (!kName)
      throw new Error(
        'No se encontro columna CardName / Nombre. Headers leidos: ' +
          Object.keys(rows[0]).join(' | ')
      );
    if (!kCard)
      throw new Error(
        'No se encontro columna CardCode / Codigo. Headers leidos: ' +
          Object.keys(rows[0]).join(' | ')
      );

    _mcSapParsedRows = rows
      .map((r) => ({
        cardCode: String(r[kCard] || '').trim(),
        cardName: String(r[kName] || '').trim(),
        address: kAddr ? String(r[kAddr] || '').trim() : '',
        city: kCity ? String(r[kCity] || '').trim() : '',
        state: kState ? String(r[kState] || '').trim() : '',
      }))
      .filter((r) => r.cardCode && r.cardName);

    // Buscar matches contra POINTS (todas las tiendas del mapa) con 3
    // niveles: exact (mismo nombre normalizado), fuzzy (similitud >= 0.82 +
    // misma provincia), y NUEVO (sin match -> se crea como nueva alta).
    const allStores = getAllStoreEntries();
    const storeIndex = {};
    allStores.forEach((e) => {
      const k = _mcNormName(e.nombre);
      if (!storeIndex[k]) storeIndex[k] = [];
      storeIndex[k].push(e);
    });
    _mcSapMatched = []; // matches (exact + fuzzy), van a sobrescribir datos
    _mcSapUnmatched = []; // sin match, se crean como nuevas altas en el mapa
    _mcSapParsedRows.forEach((sap) => {
      const match = _mcFindMatch(sap.cardName, sap.state, storeIndex, allStores);
      if (!match) {
        _mcSapUnmatched.push(sap);
        return;
      }
      // Por cada entry matcheada, generar un docId para el client_master
      // y guardar la decision. matchType indica si fue exact o fuzzy.
      match.entries.forEach((p) => {
        const docId = (p.provincia + '__' + p.localidad + '__' + p.nombre).replace(/[/\\#?]/g, '_');
        const existing = clientMasterCache.get(docId);
        const hadAddress = !!(existing && existing.address);
        _mcSapMatched.push({
          docId,
          point: p,
          sapRow: sap,
          matchType: match.matchType,
          similarity: match.similarity,
          hadAddress,
        });
      });
    });

    // Render preview con desglose por tipo de match
    const exactN = _mcSapMatched.filter((m) => m.matchType === 'exact').length;
    const fuzzyN = _mcSapMatched.filter((m) => m.matchType === 'fuzzy').length;
    const _willOver = _mcSapMatched.filter((m) => m.hadAddress).length;
    const newN = _mcSapUnmatched.length;
    document.getElementById('mc-sap-stats').innerHTML =
      '<b>&#128203; Filas en el archivo SAP:</b> ' +
      _mcSapParsedRows.length +
      '<br>' +
      '<b style="color:#166534">&#10003; Matches exactos:</b> ' +
      exactN +
      ' tiendas (datos SAP van a sobreescribir)<br>' +
      '<b style="color:#9a3412">~ Matches por similitud (fuzzy):</b> ' +
      fuzzyN +
      ' tiendas (revisar abajo)<br>' +
      '<b style="color:#1e40af">&#10133; NUEVAS - se van a crear en el mapa:</b> ' +
      newN +
      ' tiendas<br>' +
      '<b style="color:#475569">&#128203; Tiendas matcheadas se marcan como <i>habilitadas</i> para crear pedidos directamente.</b>';
    prevEl.style.display = '';
    // Mostrar las fuzzy + nuevas para que el usuario revise antes de aplicar
    const fuzzyList = _mcSapMatched.filter((m) => m.matchType === 'fuzzy');
    let unmInner = '';
    if (fuzzyList.length) {
      unmInner +=
        '<b style="color:#9a3412">&#9888; Matches por similitud (revisar - puede ser duplicado o tienda nueva):</b><br>';
      fuzzyList.slice(0, 15).forEach((m) => {
        unmInner +=
          '&middot; SAP: <b>' +
          escapeHtml(m.sapRow.cardName) +
          '</b> [' +
          escapeHtml(m.sapRow.cardCode) +
          '] &harr; APP: <b>' +
          escapeHtml(m.point.nombre) +
          '</b> (' +
          escapeHtml(m.point.localidad || '') +
          ') &middot; sim ' +
          (m.similarity * 100).toFixed(0) +
          '%<br>';
      });
      if (fuzzyList.length > 15) unmInner += '<i>... y ' + (fuzzyList.length - 15) + ' mas</i><br>';
      unmInner += '<br>';
    }
    if (newN) {
      unmInner += '<b style="color:#1e40af">&#10133; Tiendas nuevas que se van a crear:</b><br>';
      _mcSapUnmatched.slice(0, 15).forEach((s) => {
        unmInner +=
          '&middot; <b>' +
          escapeHtml(s.cardName) +
          '</b> [' +
          escapeHtml(s.cardCode) +
          '] &middot; ' +
          escapeHtml(s.city || '-') +
          ' / ' +
          escapeHtml(s.state || '-') +
          '<br>';
      });
      if (_mcSapUnmatched.length > 15)
        unmInner += '<i>... y ' + (_mcSapUnmatched.length - 15) + ' mas</i>';
    }
    if (unmInner) {
      unmEl.innerHTML = unmInner;
      unmEl.style.display = '';
    }
    document.getElementById('mc-sap-apply-btn').disabled = _mcSapMatched.length + newN === 0;
  } catch (e) {
    console.error('parseMcSapFile', e);
    errEl.innerHTML =
      '<b>Error procesando el archivo:</b><br>' + escapeHtml(e.message || String(e));
    errEl.style.display = '';
    document.getElementById('mc-sap-apply-btn').disabled = true;
  }
}

window.applyMcSapImport = async function () {
  const totalApply = _mcSapMatched.length + _mcSapUnmatched.length;
  if (!totalApply) return;
  if (
    !confirm(
      'Aplicar ' +
        _mcSapMatched.length +
        ' actualizaciones + ' +
        _mcSapUnmatched.length +
        ' tiendas nuevas?\n\n' +
        '* MATCHEADAS: se sobreescribe nombre/direccion/localidad con datos del SAP (prioridad) y se marcan como HABILITADAS.\n' +
        '* NUEVAS: se crean directamente en el mapa con su vendedor segun la provincia.\n\n' +
        'Despues verifica las nuevas y las fuzzy desde el panel de Master Clientes.'
    )
  )
    return;
  const btn = document.getElementById('mc-sap-apply-btn');
  btn.disabled = true;
  btn.textContent = 'Aplicando...';
  try {
    // ========== PARTE 1: matches a client_master (sobreescribir + habilitar) ==========
    let done = 0;
    const newContactedKeys = []; // keys para agregar al set 'contacted' (habilitado)
    while (done < _mcSapMatched.length) {
      const chunk = _mcSapMatched.slice(done, done + 400);
      const batch = fbDb.batch();
      chunk.forEach((m) => {
        const ref = fbDb.collection('client_master').doc(m.docId);
        // PRIORIDAD SAP: sobreescribimos siempre con los datos del archivo,
        // porque SAP es la fuente de verdad oficial. Los datos de POINTS
        // (master del Excel) pueden estar desactualizados.
        batch.set(
          ref,
          {
            clientName: m.sapRow.cardName || m.point.nombre || '', // nombre SAP gana
            clientNameOriginal: m.point.nombre || '', // backup del nombre que tenia el mapa
            provincia: m.point.provincia || '',
            localidad: m.sapRow.city || m.point.localidad || '', // ciudad SAP gana
            localidadOriginal: m.point.localidad || '',
            vendor: m.point.vendor || '',
            address: m.sapRow.address || '', // direccion SAP siempre
            sapCardCode: m.sapRow.cardCode,
            sapAddress: m.sapRow.address,
            sapCity: m.sapRow.city,
            sapState: m.sapRow.state,
            matchType: m.matchType,
            matchSimilarity: m.similarity,
            sapImportedAt: firebase.firestore.FieldValue.serverTimestamp(),
            sapImportedBy: currentUser.email || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: currentUser.email || '',
          },
          { merge: true }
        );
        // Marcar como habilitado para crear pedidos: agregar al set 'contacted'.
        // contactKey usa el helper existente: tipo + '|' + prov + '|' + loc + '|' + name.
        // El tipo 'C' = Cliente actual (los matcheados ya son existentes en el mapa).
        const fakeP = { province: m.point.provincia, name: m.point.localidad };
        const ck = contactKey(fakeP, m.point.nombre, 'C');
        newContactedKeys.push(ck);
      });
      await batch.commit();
      done += chunk.length;
      btn.textContent = 'Actualizando matches... (' + done + '/' + _mcSapMatched.length + ')';
    }
    // Agregar al set local + sync a Firestore
    if (newContactedKeys.length) {
      newContactedKeys.forEach((k) => contacted.add(k));
      try {
        saveContacted();
      } catch (_e) {}
    }

    // ========== PARTE 2: nuevas tiendas como altas aprobadas ==========
    // Se crean en client_applications con status='approved' y el sistema
    // existente (ensureApprovedAltasListener) las agrega al mapa
    // automaticamente en su provincia/localidad.
    let doneNew = 0;
    const failedDocIds = []; // para diagnostico si algo falla
    const createdIds = [];
    while (doneNew < _mcSapUnmatched.length) {
      const chunk = _mcSapUnmatched.slice(doneNew, doneNew + 400);
      const batch = fbDb.batch();
      const chunkDocIds = [];
      chunk.forEach((sap) => {
        const provNorm = (sap.state || '').toUpperCase().trim();
        // Vendedor: lo deducimos por la provincia siguiendo las reglas
        // hardcoded (IOANNIS_PROVINCES / SANTIAGO_PROVINCES). Si no aplica,
        // queda vacio y el admin lo asigna despues desde el modal Zonas.
        const assignedVendor =
          typeof inferVendorFromProvince === 'function' ? inferVendorFromProvince(provNorm) : '';
        // docId deterministico por cardCodeSap para que re-imports hagan
        // UPSERT en lugar de duplicar (antes era doc() random => cada
        // re-import creaba duplicados). El prefijo evita colisiones con
        // docs de alta-cliente manuales que usan IDs random.
        const safeCard = String(sap.cardCode || '')
          .replace(/[^A-Za-z0-9]/g, '_')
          .slice(0, 80);
        const newDocId = 'sap_' + safeCard;
        const newDoc = fbDb.collection('client_applications').doc(newDocId);
        // Payload base: campos que SIEMPRE se actualizan en cada re-import
        // (SAP es source of truth para nombre comercial / cardCode / provincia).
        // ownerUid = admin que corre la import. Necesario porque la rule
        // de create en client_applications exige ownerUid == request.auth.uid.
        const payload = {
          comercio: sap.cardName,
          cardCodeSap: sap.cardCode,
          provincia: provNorm,
          status: 'approved',
          source: 'sap_bulk_import',
          ownerUid: currentUser.uid,
          ownerEmail: currentUser.email || '',
          approvals: {
            [currentUser.uid]: {
              approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
              email: currentUser.email || '',
              name: currentUser.displayName || '',
            },
          },
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          sapImportedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        // Campos opcionales: solo se setean si SAP tiene un valor. Si SAP
        // no tiene (lo mas comun para Ship-to City en la mayoria de los BPs),
        // NO los tocamos, asi se respetan los datos que el admin haya cargado
        // manualmente en la app. La unica forma de PISAR una direccion ya
        // cargada es que SAP tenga una nueva direccion distinta (SAP gana,
        // como pidio el usuario).
        if (sap.address) payload.calle = sap.address;
        if (sap.city) {
          payload.localidad = sap.city;
          payload.localidadFinal = sap.city;
        }
        if (assignedVendor) payload.assignedVendor = assignedVendor;
        // owner / cuit / condicionFiscal: NO se incluyen para no destruir
        // datos manuales cargados en altas previas. Si la fila no existe
        // todavia, esos campos quedan ausentes (lo que es OK - las altas SAP
        // no requieren cuit para funcionar).
        batch.set(newDoc, payload, { merge: true });
        chunkDocIds.push(newDocId);
      });
      try {
        await batch.commit();
        createdIds.push.apply(createdIds, chunkDocIds);
      } catch (batchErr) {
        console.error(
          '[sap-import] batch fallo, intentando individual:',
          batchErr && batchErr.message
        );
        // Fallback: si el batch fallo, escribir uno por uno asi vemos cual rompe.
        for (let i = 0; i < chunk.length; i++) {
          const sap = chunk[i];
          const safeCard = String(sap.cardCode || '')
            .replace(/[^A-Za-z0-9]/g, '_')
            .slice(0, 80);
          const newDocId = 'sap_' + safeCard;
          const provNorm = (sap.state || '').toUpperCase().trim();
          const assignedVendor =
            typeof inferVendorFromProvince === 'function' ? inferVendorFromProvince(provNorm) : '';
          const payload = {
            comercio: sap.cardName,
            cardCodeSap: sap.cardCode,
            provincia: provNorm,
            status: 'approved',
            source: 'sap_bulk_import',
            ownerUid: currentUser.uid,
            ownerEmail: currentUser.email || '',
            approvals: {
              [currentUser.uid]: {
                approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                email: currentUser.email || '',
                name: currentUser.displayName || '',
              },
            },
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            sapImportedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          };
          if (sap.address) payload.calle = sap.address;
          if (sap.city) {
            payload.localidad = sap.city;
            payload.localidadFinal = sap.city;
          }
          if (assignedVendor) payload.assignedVendor = assignedVendor;
          try {
            await fbDb
              .collection('client_applications')
              .doc(newDocId)
              .set(payload, { merge: true });
            createdIds.push(newDocId);
          } catch (individualErr) {
            console.error(
              '[sap-import] falla individual',
              newDocId,
              individualErr && individualErr.message
            );
            failedDocIds.push({
              docId: newDocId,
              name: sap.cardName,
              error: individualErr && individualErr.message,
            });
          }
        }
      }
      doneNew += chunk.length;
      btn.textContent = 'Creando nuevas... (' + doneNew + '/' + _mcSapUnmatched.length + ')';
    }
    console.log('[sap-import] createdIds:', createdIds.length, createdIds);
    if (failedDocIds.length) {
      console.error('[sap-import] failedDocIds:', failedDocIds);
    }

    const actualCreated = createdIds.length;
    const failedCount = failedDocIds.length;
    // Contar cuantas de las nuevas quedaron sin provincia (el Excel SAP no
    // siempre trae columna State). Esas se crearon pero no aparecen en el
    // mapa hasta que admin les cargue la provincia manualmente.
    const sinProv = _mcSapUnmatched.filter((s) => !(s.state || '').trim()).length;
    if (failedCount > 0) {
      alert(
        'Import termino con errores:\n\n' +
          _mcSapMatched.length +
          ' matches actualizados.\n' +
          actualCreated +
          ' nuevas creadas.\n' +
          failedCount +
          ' fallaron (ver F12 > Console para detalle).\n\n' +
          'Las que fallaron son tipicamente por permisos. Verifica:\n' +
          '1) Sos admin o gerente.\n' +
          '2) La rule de client_applications permite create para admin.'
      );
    } else if (sinProv > 0) {
      alert(
        'Import OK: ' +
          _mcSapMatched.length +
          ' actualizadas + ' +
          actualCreated +
          ' nuevas creadas.\n\n' +
          '⚠️ ATENCION: ' +
          sinProv +
          ' de las nuevas no tienen PROVINCIA en el Excel SAP.\n\n' +
          'Esas tiendas aparecen en Master Clientes bajo "(sin provincia)" - cargales la provincia a mano y se ubican en el mapa.\n\n' +
          'Si tu Excel si tenia provincia, fijate que la columna se llame: State, Province, Provincia, Ship-to State o Provincia_1.'
      );
    } else {
      showSyncTag(_mcSapMatched.length + ' actualizadas + ' + actualCreated + ' nuevas');
    }
    closeMcSapImport();
    renderMasterClientesTable();
    // Forzar re-render del mapa para mostrar tiendas nuevas y nuevos contactados
    try {
      if (typeof drawMarkers === 'function') drawMarkers();
    } catch (_e) {}
    try {
      if (typeof restyleZoneLayers === 'function') restyleZoneLayers();
    } catch (_e) {}
    // Si se crearon altas nuevas, avisar al usuario que tiene que geocodificar
    // para verlas como pines en el mapa.
    if (_mcSapUnmatched.length > 0) {
      setTimeout(() => {
        const wantGeo = confirm(
          'Import terminado: ' +
            _mcSapMatched.length +
            ' actualizadas + ' +
            _mcSapUnmatched.length +
            ' nuevas.\n\n' +
            'Las tiendas NUEVAS no tienen ubicacion geografica todavia. Para que aparezcan como pines en el mapa hay que geocodificarlas con Google Maps.\n\n' +
            '¿Querés geocodificarlas AHORA? (~' +
            Math.ceil(_mcSapUnmatched.length / 60) +
            ' min)\n\n' +
            'Si decis No, podes hacerlo despues desde Master Clientes > "Geocodificar tiendas SAP".'
        );
        if (wantGeo) {
          try {
            runBulkGeocodeSapAltas();
          } catch (e) {
            console.error('auto geocode after import', e);
          }
        }
      }, 500);
    }
  } catch (e) {
    console.error('applyMcSapImport', e);
    alert('Error aplicando: ' + (e.message || e));
    btn.disabled = false;
    btn.innerHTML = '&#128190; Aplicar a la app';
  }
};

// Heuristica simple: deduce el vendor por provincia segun los sets
// hardcoded (IOANNIS_PROVINCES + SANTIAGO_PROVINCES) y unas reglas
// adicionales para Buenos Aires / Cuyo. Si no aplica nada, devuelve ''
// (el admin lo asigna despues desde el modal Zonas).
function inferVendorFromProvince(provUp) {
  if (!provUp) return '';
  const p = provUp.toUpperCase().trim();
  // VDI provinces
  const IOANNIS_PROVS = [
    'TIERRA DEL FUEGO',
    'SANTA CRUZ',
    'CHUBUT',
    'RIO NEGRO',
    'NEUQUEN',
    'LA PAMPA',
    'MENDOZA',
  ];
  const SANTIAGO_PROVS = [
    'SAN JUAN',
    'SAN LUIS',
    'JUJUY',
    'SALTA',
    'CATAMARCA',
    'SANTIAGO DEL ESTERO',
    'FORMOSA',
    'CHACO',
    'MISIONES',
    'LA RIOJA',
    'TUCUMAN',
  ];
  if (IOANNIS_PROVS.includes(p)) return 'IOANNIS PALKOUDAKIS';
  if (SANTIAGO_PROVS.includes(p)) return 'SANTIAGO ESTEBAN';
  if (p === 'CORRIENTES' || p === 'ENTRE RIOS') return 'MAURICIO GIL';
  if (p === 'CORDOBA') return 'MARTIN BOIERO';
  if (p === 'SANTA FE') return 'MARTIN BOIERO';
  if (
    p === 'BUENOS AIRES' ||
    p === 'CAPITAL FEDERAL' ||
    p === 'CABA' ||
    p === 'CIUDAD AUTONOMA DE BUENOS AIRES'
  )
    return 'FEDERICO CASTELANELLI';
  return '';
}
window.onMcFiltProvChange = function () {
  rebuildMcLocalidadOptions();
  renderMasterClientesTable();
};
function rebuildMcLocalidadOptions() {
  const lSel = document.getElementById('mc-filt-loc');
  const cur = lSel.value;
  const prov = document.getElementById('mc-filt-prov').value;
  const locs = new Set();
  (POINTS || []).forEach((p) => {
    if (prov !== 'ALL' && p.province !== prov) return;
    locs.add(p.name);
  });
  lSel.innerHTML =
    '<option value="ALL">Todas las localidades</option>' +
    [...locs]
      .sort()
      .map((l) => '<option value="' + escapeAttr(l) + '">' + escapeHtml(l) + '</option>')
      .join('');
  if ([...locs].includes(cur)) lSel.value = cur;
}

function renderMcProvisoriosTable() {
  const cont = document.getElementById('mc-body');
  if (!cont) return;
  const fv = document.getElementById('mc-filt-vendor').value;
  const fp = document.getElementById('mc-filt-prov').value;
  const fl = document.getElementById('mc-filt-loc').value;
  const fq = (document.getElementById('mc-search').value || '').trim().toLowerCase();

  // Alta Rapida guarda vendedor en assignedVendor (no vendor), provincia en
  // upper y localidad en localidadFinal (post-geocoding) o localidad.
  let items = getProvisoriosList();
  if (fv !== 'ALL') items = items.filter((a) => (a.assignedVendor || a.vendor || '') === fv);
  if (fp !== 'ALL')
    items = items.filter((a) => (a.provincia || '').toString().toUpperCase() === fp.toUpperCase());
  if (fl !== 'ALL')
    items = items.filter(
      (a) =>
        ((a.localidadFinal || a.localidad || '') + '').toUpperCase() === (fl || '').toUpperCase()
    );
  if (fq)
    items = items.filter((a) =>
      matchesAllTokens(
        [
          a.comercio,
          a.fantasia,
          a.duenoNombre,
          a.provincia,
          a.localidadFinal || a.localidad,
          a.cuit,
          a.calle,
        ]
          .filter(Boolean)
          .join(' | '),
        fq
      )
    );

  items.sort((a, b) => {
    const ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
    const tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
    return tb - ta;
  });

  const total = getProvisoriosList().length;
  const statsHtml =
    '<span style="background:#ede9fe;color:#5b21b6;border-color:#c4b5fd">&#9889; Provisorios (Alta Rapida): ' +
    total +
    '</span>' +
    '<span>Filtrados: ' +
    items.length +
    '</span>' +
    '<span style="background:#fef3c7;color:#92400e;border-color:#fde68a">Falta cargar a SAP manualmente</span>';
  document.getElementById('mc-stats').innerHTML = statsHtml;

  if (!items.length) {
    cont.innerHTML = '<div class="mc-empty">No hay clientes provisorios con esos filtros.</div>';
    return;
  }

  let html = '<table class="mc-table"><thead><tr>';
  html += '<th style="width:22%">Comercio</th>';
  html += '<th style="width:12%">Localidad</th>';
  html += '<th style="width:11%">Provincia</th>';
  html += '<th style="width:14%">Vendedor / dado de alta por</th>';
  html += '<th style="width:19%">Direccion (Alta Rapida)</th>';
  html += '<th style="width:9%">Fecha alta</th>';
  html += '<th style="width:13%" title="Vincular manual con BP de SAP">Acci&oacute;n</th>';
  html += '</tr></thead><tbody>';

  const MAX = 500;
  items.slice(0, MAX).forEach((a) => {
    const vendKey = a.assignedVendor || a.vendor || '';
    const vendInfo = VENDORS.find((v) => v.key === vendKey);
    const vendLabel = vendInfo
      ? vendInfo.zone + ' ' + titleCase(vendKey)
      : vendKey
        ? titleCase(vendKey)
        : '(sin vendedor)';
    const owner = a.ownerName || a.ownerEmail || '';
    const dir = (a.calle || '').trim();
    const fecha =
      a.createdAt && a.createdAt.seconds
        ? new Date(a.createdAt.seconds * 1000).toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          })
        : '-';
    const nombre = a.comercio || a.fantasia || '(sin nombre)';
    const dueno = (a.duenoNombre || '').trim();
    const tel = (a.telefonoContacto || '').trim();
    const loc = a.localidadFinal || a.localidad || '-';
    const cuit = (a.cuit || '').trim();
    const safeId = escapeAttr(a._fsId || '');

    // v302+: nombre y vendedor EDITABLES inline para provisorios.
    // Nombre: input que escribe a `comercio` (o `fantasia` si no habia comercio).
    // Vendedor: select con opciones VDE + VDI, escribe a `assignedVendor`.
    // Ambos con autosave (sin boton) - se guardan al perder foco o al cambiar.
    const canEditProv = userRole === 'admin' || userRole === 'gerente';
    const nameField = (a.comercio || '').trim() ? 'comercio' : 'fantasia';
    // v315+: detector de duplicado SAP. Si el provisorio matchea con un
    // cliente SAP habilitado (misma prov+loc, nombre similar), pintar
    // la fila roja + agregar tooltip con el cardCode SAP duplicado.
    const dupSap =
      typeof findSapDuplicateForProvisorio === 'function' ? findSapDuplicateForProvisorio(a) : null;
    const rowBg = dupSap ? '#fee2e2' : '#fffbeb';
    const rowBorder = dupSap ? 'border-left:4px solid #dc2626;' : '';
    const dupTitle = dupSap
      ? 'POSIBLE DUPLICADO SAP: ' +
        (dupSap.comercio || dupSap.fantasia || '?') +
        ' (' +
        (dupSap.cardCodeSap || '') +
        '). Revisa y elimina el provisorio si corresponde.'
      : '';
    html +=
      '<tr style="background:' +
      rowBg +
      ';' +
      rowBorder +
      '"' +
      (dupTitle ? ' title="' + escapeAttr(dupTitle) + '"' : '') +
      '>';
    // v315+: badge de duplicado (si aplica). Se agrega en la meta al lado
    // del badge PROVISORIO amarillo, en rojo llamativo.
    const dupBadge = dupSap
      ? '<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;margin-left:6px" title="' +
        escapeAttr(dupTitle) +
        '">&#9888; DUPLICADO SAP ' +
        escapeHtml(dupSap.cardCodeSap || '') +
        '</span>'
      : '';
    if (canEditProv) {
      html +=
        '<td>' +
        '<input type="text" class="mc-addr-input has-value" style="font-weight:800;font-size:12.5px;color:#0f172a" ' +
        'value="' +
        escapeAttr(nombre) +
        '" ' +
        'onchange="saveMcProvisorioComercio(\'' +
        safeId +
        "', '" +
        nameField +
        '\', this)" ' +
        'onkeydown="if(event.key===\'Enter\')this.blur()" ' +
        'title="Editar nombre del comercio (autosave al salir del campo o Enter)" />' +
        '<div class="mc-meta" style="margin-top:4px"><span class="mc-tag prov">&#9889; PROVISORIO</span>' +
        dupBadge +
        (dueno
          ? '<span style="font-size:10px;color:#64748b">Dueno: ' + escapeHtml(dueno) + '</span>'
          : '') +
        (tel
          ? '<span style="font-size:10px;color:#64748b"> &middot; ' + escapeHtml(tel) + '</span>'
          : '') +
        (cuit
          ? '<span style="font-size:10px;color:#0369a1;font-weight:600"> &middot; CUIT ' +
            escapeHtml(cuit) +
            '</span>'
          : '') +
        '</div>' +
        '</td>';
    } else {
      html +=
        '<td>' +
        '<div class="mc-name">' +
        escapeHtml(nombre) +
        '</div>' +
        '<div class="mc-meta"><span class="mc-tag prov">&#9889; PROVISORIO</span>' +
        dupBadge +
        (dueno
          ? '<span style="font-size:10px;color:#64748b">Dueno: ' + escapeHtml(dueno) + '</span>'
          : '') +
        (tel
          ? '<span style="font-size:10px;color:#64748b"> &middot; ' + escapeHtml(tel) + '</span>'
          : '') +
        (cuit
          ? '<span style="font-size:10px;color:#0369a1;font-weight:600"> &middot; CUIT ' +
            escapeHtml(cuit) +
            '</span>'
          : '') +
        '</div>' +
        '</td>';
    }
    // v305+: Localidad y Provincia editables inline (autosave) para
    // admin/gerente. Mismo patron que el modo SAP normal en Master Clientes.
    if (canEditProv) {
      const locVal = loc === '-' || loc === '(sin localidad)' ? '' : loc;
      html +=
        '<td><input type="text" class="mc-addr-input' +
        (locVal ? ' has-value' : '') +
        '" ' +
        'style="font-size:11px" ' +
        'value="' +
        escapeAttr(locVal) +
        '" ' +
        'placeholder="(sin localidad)" ' +
        'onchange="saveMcProvisorioLocalidad(\'' +
        safeId +
        '\', this)" ' +
        'onkeydown="if(event.key===\'Enter\')this.blur()" /></td>';
      // Provincia: dropdown con las provincias del padron.
      const provVal = (a.provincia || '').toUpperCase().trim();
      let provSel =
        '<td><select class="mc-cli-sel' +
        (provVal ? ' has-value' : '') +
        '" ' +
        'style="font-size:11px;width:100%" ' +
        'onchange="saveMcProvisorioProvincia(\'' +
        safeId +
        '\', this)">';
      provSel += '<option value="">(sin provincia)</option>';
      const provSet = new Set();
      (POINTS || []).forEach((p) => provSet.add(p.province));
      [...provSet].sort().forEach((pr) => {
        provSel +=
          '<option value="' +
          escapeAttr(pr) +
          '"' +
          (pr === provVal ? ' selected' : '') +
          '>' +
          escapeHtml(titleCase(pr)) +
          '</option>';
      });
      provSel += '</select></td>';
      html += provSel;
    } else {
      html += '<td>' + escapeHtml(loc) + '</td>';
      html += '<td>' + escapeHtml(titleCase(a.provincia || '-')) + '</td>';
    }
    if (canEditProv) {
      // Opciones: VDE + VDI (los 6 vendedores app). No incluye admin/gerente/distribuidor
      // (los provisorios se asignan a un vendedor real, no otro rol).
      let vendSel =
        '<td><select class="mc-cli-sel' +
        (vendKey ? ' has-value' : '') +
        '" ' +
        'style="width:100%;font-size:11px" ' +
        'onchange="saveMcProvisorioVendor(\'' +
        safeId +
        '\', this)">';
      vendSel += '<option value="">(sin vendedor)</option>';
      vendSel += '<optgroup label="VDE (Vendedores externos)">';
      VENDORS.filter((v) => VDE_VENDOR_KEYS.has(v.key)).forEach((v) => {
        vendSel +=
          '<option value="' +
          escapeAttr(v.key) +
          '"' +
          (v.key === vendKey ? ' selected' : '') +
          '>' +
          escapeHtml(v.zone + ' - ' + titleCase(v.key)) +
          '</option>';
      });
      vendSel += '</optgroup><optgroup label="VDI (Vendedores internos)">';
      VENDORS.filter((v) => VDI_VENDOR_KEYS.has(v.key)).forEach((v) => {
        vendSel +=
          '<option value="' +
          escapeAttr(v.key) +
          '"' +
          (v.key === vendKey ? ' selected' : '') +
          '>' +
          escapeHtml(titleCase(v.key)) +
          '</option>';
      });
      vendSel +=
        '</optgroup></select>' +
        (owner
          ? '<div style="font-size:10px;color:#64748b;margin-top:4px">Alta: ' +
            escapeHtml(owner) +
            '</div>'
          : '') +
        '</td>';
      html += vendSel;
    } else {
      html +=
        '<td><div style="font-weight:700;color:#334155">' +
        escapeHtml(vendLabel) +
        '</div>' +
        (owner ? '<div style="font-size:10px;color:#64748b">' + escapeHtml(owner) + '</div>' : '') +
        '</td>';
    }
    html +=
      '<td style="font-size:11px;color:#334155">' + escapeHtml(dir || '(sin direccion)') + '</td>';
    html += '<td style="font-size:11px;color:#64748b">' + fecha + '</td>';
    if (userRole === 'admin') {
      html +=
        '<td>' +
        '<button type="button" class="mc-save-btn" ' +
        'style="background:#0e7490;color:#fff;padding:6px 8px;font-size:10px;font-weight:700;border:none;border-radius:4px;cursor:pointer;white-space:nowrap" ' +
        'title="Buscar el BP de SAP correspondiente y vincularlo (setea cardCodeSap y saca el provisorio de No confirmados)" ' +
        'onclick="openVincularSapModal(\'' +
        safeId +
        '\')">&#128279; Vincular con SAP</button>' +
        '</td>';
    } else {
      html += '<td style="font-size:10px;color:#94a3b8;text-align:center">(admin)</td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  if (items.length > MAX)
    html +=
      '<div style="text-align:center;color:#94a3b8;font-size:11px;padding:12px">Mostrando ' +
      MAX +
      ' de ' +
      items.length +
      '. Refina con filtros.</div>';
  cont.innerHTML = html;
}

// v302+: Autosave del nombre del comercio (comercio o fantasia) desde el
// modal Master Clientes tab Provisorios. Escribe a client_applications.
// El listener de approvedAltasList repinta la tabla al terminar.
window.saveMcProvisorioComercio = async function (fsId, fieldName, inputEl) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede editar el nombre del comercio.');
    return;
  }
  if (!fsId || !inputEl) return;
  const newVal = (inputEl.value || '').trim();
  const alta = (approvedAltasList || []).find((x) => x._fsId === fsId);
  if (!alta) return;
  const oldVal = (alta[fieldName] || '').trim();
  if (newVal === oldVal) return;
  inputEl.classList.add('saving');
  try {
    const payload = {
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
    };
    payload[fieldName] = newVal;
    await fbDb.collection('client_applications').doc(fsId).set(payload, { merge: true });
    showSyncTag(newVal ? 'Nombre actualizado' : 'Nombre limpiado');
  } catch (e) {
    console.error('saveMcProvisorioComercio', e);
    alert('Error guardando nombre: ' + (e.message || e));
    inputEl.value = oldVal;
  } finally {
    inputEl.classList.remove('saving');
  }
};

// v305+: Autosave de localidad de un provisorio desde Master Clientes.
// Escribe localidad + localidadFinal (para consistencia con saveMcSapLocalidad).
// Si cambia la localidad, limpia lat/lng para forzar re-geocoding en el
// proximo refresh.
window.saveMcProvisorioLocalidad = async function (fsId, inputEl) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede editar la localidad.');
    return;
  }
  if (!fsId || !inputEl) return;
  const newVal = (inputEl.value || '').trim();
  const alta = (approvedAltasList || []).find((x) => x._fsId === fsId);
  if (!alta) return;
  const oldVal = (alta.localidadFinal || alta.localidad || '').trim();
  if (newVal === oldVal) return;
  inputEl.classList.add('saving');
  try {
    const payload = {
      localidad: newVal,
      localidadFinal: newVal,
      // v291+: marcar la fuente para que el sync SAP no pise el edit manual.
      provinciaLocSource: 'manual',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
    };
    // Si cambio la localidad, limpiar lat/lng.
    payload.lat = firebase.firestore.FieldValue.delete();
    payload.lng = firebase.firestore.FieldValue.delete();
    await fbDb.collection('client_applications').doc(fsId).set(payload, { merge: true });
    inputEl.classList.toggle('has-value', !!newVal);
    showSyncTag(newVal ? 'Localidad actualizada' : 'Localidad limpiada');
  } catch (e) {
    console.error('saveMcProvisorioLocalidad', e);
    alert('Error guardando localidad: ' + (e.message || e));
    inputEl.value = oldVal;
  } finally {
    inputEl.classList.remove('saving');
  }
};

// v305+: Autosave de provincia de un provisorio desde Master Clientes.
// Escribe provincia (uppercase, formato del padron POINTS).
window.saveMcProvisorioProvincia = async function (fsId, selEl) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede editar la provincia.');
    return;
  }
  if (!fsId || !selEl) return;
  const newVal = (selEl.value || '').toUpperCase().trim();
  const alta = (approvedAltasList || []).find((x) => x._fsId === fsId);
  if (!alta) return;
  const oldVal = (alta.provincia || '').toUpperCase().trim();
  if (newVal === oldVal) return;
  selEl.classList.add('saving');
  try {
    const payload = {
      provincia: newVal,
      provinciaLocSource: 'manual',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
    };
    // Si cambio provincia, limpiar lat/lng.
    payload.lat = firebase.firestore.FieldValue.delete();
    payload.lng = firebase.firestore.FieldValue.delete();
    await fbDb.collection('client_applications').doc(fsId).set(payload, { merge: true });
    selEl.classList.toggle('has-value', !!newVal);
    showSyncTag(newVal ? 'Provincia actualizada' : 'Provincia limpiada');
  } catch (e) {
    console.error('saveMcProvisorioProvincia', e);
    alert('Error guardando provincia: ' + (e.message || e));
    selEl.value = oldVal;
  } finally {
    selEl.classList.remove('saving');
  }
};

// v302+: Autosave del vendedor asignado a un provisorio desde Master Clientes.
// Escribe assignedVendor. Refuerzo: si el provisorio no tenia ownerUid,
// tratamos de resolverlo desde VENDORS[key] o desde roles matching displayName.
window.saveMcProvisorioVendor = async function (fsId, selEl) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede reasignar vendedor.');
    return;
  }
  if (!fsId || !selEl) return;
  const newVendor = (selEl.value || '').trim();
  const alta = (approvedAltasList || []).find((x) => x._fsId === fsId);
  if (!alta) return;
  const oldVendor = (alta.assignedVendor || alta.vendor || '').trim();
  if (newVendor === oldVendor) return;
  selEl.classList.add('saving');
  try {
    const payload = {
      assignedVendor: newVendor,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
      reassignedAt: firebase.firestore.FieldValue.serverTimestamp(),
      reassignedBy: currentUser ? currentUser.email || currentUser.uid : '',
    };
    // Buscar el uid del vendedor para tambien setear ownerUid (permite que el
    // vendedor asignado vea el provisorio en su lista personal, no solo el admin).
    let newOwnerUid = null;
    try {
      const rolesSnap = await fbDb.collection('roles').get();
      rolesSnap.forEach((d) => {
        const v = d.data() || {};
        const dn = String(v.displayName || v.email || '').toUpperCase();
        if (dn && newVendor && dn === newVendor) newOwnerUid = d.id;
      });
    } catch (_e) {
      /* best-effort */
    }
    if (newOwnerUid) payload.ownerUid = newOwnerUid;
    await fbDb.collection('client_applications').doc(fsId).set(payload, { merge: true });
    selEl.classList.toggle('has-value', !!newVendor);
    showSyncTag(newVendor ? 'Vendedor asignado: ' + titleCase(newVendor) : 'Vendedor limpiado');
  } catch (e) {
    console.error('saveMcProvisorioVendor', e);
    alert('Error asignando vendedor: ' + (e.message || e));
    selEl.value = oldVendor;
  } finally {
    selEl.classList.remove('saving');
  }
};

// v293+: Vincular provisorio con BP de SAP.
// Cuando el auto-match del cron (sync_sap_to_firestore.py > find_match)
// falla (nombre normalizado difiere, provisorio sin CUIT, etc.), admin
// vincula el provisorio a mano contra un BP de SAP ya sincronizado.
// La operacion:
//   1. Copia los campos SAP (cardCodeSap, sapCardType, sapDivision, etc.)
//      del BP elegido al doc del provisorio.
//   2. Setea manualSapPending=false + source='sap_sync_manual_link'.
//   3. Elimina el doc BP duplicado (el que creo el cron con status=approved)
//      asi no quedan 2 clientes representando el mismo comercio.
//   4. Guarda auditoria (linkedFromSapDocId, linkedBy, linkedAt).
let vsmProvisorioId = null;
let vsmSelectedSapId = null;

window.openVincularSapModal = function (fsId) {
  if (!fsId) return;
  // Firestore Rules: delete de client_applications con cardCodeSap requiere
  // role=admin (el gerente no es owner del doc BP SAP, entonces el batch.delete
  // fallaria con permission-denied). Restringimos aca para no exponer un
  // boton que rompe.
  if (userRole !== 'admin') {
    alert('Solo admin puede vincular provisorios con SAP.');
    return;
  }
  vsmProvisorioId = fsId;
  vsmSelectedSapId = null;
  const p = (approvedAltasList || []).find((x) => x._fsId === fsId);
  const infoEl = document.getElementById('vsm-provisorio-info');
  if (p && infoEl) {
    const nombre = p.comercio || p.fantasia || '(sin nombre)';
    const loc = p.localidadFinal || p.localidad || '-';
    const prov = titleCase(p.provincia || '-');
    const cuit = (p.cuit || '').trim();
    const dir = (p.calle || '').trim();
    infoEl.innerHTML =
      '<b>Provisorio a vincular:</b><br>' +
      '<span style="font-size:13px;font-weight:800;color:#78350f">' +
      escapeHtml(nombre) +
      '</span>' +
      ' &middot; ' +
      escapeHtml(loc) +
      ' / ' +
      escapeHtml(prov) +
      (cuit ? ' &middot; CUIT ' + escapeHtml(cuit) : '') +
      (dir ? '<br><span style="font-size:11px;color:#92400e">' + escapeHtml(dir) + '</span>' : '');
  }
  const search = document.getElementById('vsm-search');
  if (search) {
    const nombreDefault = p ? p.cuit || p.comercio || p.fantasia || '' : '';
    search.value = String(nombreDefault).slice(0, 40);
  }
  const err = document.getElementById('vsm-error');
  if (err) err.style.display = 'none';
  const modal = document.getElementById('vincular-sap-modal');
  if (modal) modal.classList.add('open');
  renderVincularSapList();
};

window.closeVincularSapModal = function () {
  const modal = document.getElementById('vincular-sap-modal');
  if (modal) modal.classList.remove('open');
  vsmProvisorioId = null;
  vsmSelectedSapId = null;
};

window.renderVincularSapList = function () {
  const listEl = document.getElementById('vsm-list');
  const cntEl = document.getElementById('vsm-count');
  if (!listEl) return;
  const q = ((document.getElementById('vsm-search') || { value: '' }).value || '')
    .trim()
    .toLowerCase();
  // Candidatos: BPs SAP en approvedAltasList con cardCodeSap seteado y que
  // NO sean el propio provisorio (no puede vincularse a si mismo).
  const bps = (approvedAltasList || []).filter((a) => {
    if (!a || !a._fsId) return false;
    if (a._fsId === vsmProvisorioId) return false;
    if (!a.cardCodeSap) return false; // solo BPs SAP reales
    if (a.manualSapPending) return false; // no vincular con otro provisorio
    return true;
  });
  // Filtrar por query
  let filtered = bps;
  if (q) {
    filtered = bps.filter((a) => {
      const c = (a.comercio || '').toLowerCase();
      const f = (a.fantasia || '').toLowerCase();
      const t = (a.titular || '').toLowerCase();
      const cc = (a.cardCodeSap || '').toLowerCase();
      const cu = (a.cuit || '').toLowerCase();
      return c.includes(q) || f.includes(q) || t.includes(q) || cc.includes(q) || cu.includes(q);
    });
  }
  // Ordenar por match del CUIT primero (mas confiable), despues alfabetico
  const provisorio = (approvedAltasList || []).find((x) => x._fsId === vsmProvisorioId);
  const provCuit = provisorio ? (provisorio.cuit || '').trim() : '';
  filtered.sort((a, b) => {
    const aCuitMatch = provCuit && a.cuit && a.cuit === provCuit ? 0 : 1;
    const bCuitMatch = provCuit && b.cuit && b.cuit === provCuit ? 0 : 1;
    if (aCuitMatch !== bCuitMatch) return aCuitMatch - bCuitMatch;
    return (a.comercio || '').localeCompare(b.comercio || '');
  });
  if (cntEl) cntEl.textContent = filtered.length + ' de ' + bps.length + ' BPs SAP';
  if (!filtered.length) {
    listEl.innerHTML =
      '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">' +
      (bps.length === 0
        ? 'No hay BPs SAP sincronizados todavia. Cargalo primero en SAP y espera al proximo sync (cada 30 min).'
        : 'Ningun BP SAP coincide con la busqueda.') +
      '</div>';
    return;
  }
  const MAX = 200;
  let html = '';
  filtered.slice(0, MAX).forEach((a) => {
    const nombre = a.comercio || a.fantasia || '(sin nombre)';
    const cc = (a.cardCodeSap || '').trim();
    const cu = (a.cuit || '').trim();
    const loc = (a.localidadFinal || a.localidad || '').trim();
    const prov = (a.provincia || '').trim();
    const isSelected = a._fsId === vsmSelectedSapId;
    const cuitMatchBadge =
      provCuit && cu && cu === provCuit
        ? '<span style="background:#10b981;color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:3px;margin-left:6px">&#10003; CUIT MATCH</span>'
        : '';
    const bg = isSelected ? '#dbeafe' : '#fff';
    const border = isSelected ? '#1d4ed8' : '#e5e7eb';
    html +=
      '<div onclick="selectVincularSapItem(\'' +
      escapeAttr(a._fsId) +
      '\')" ' +
      'style="padding:10px 12px;border-bottom:1px solid ' +
      border +
      ';background:' +
      bg +
      ';cursor:pointer">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:700;color:#0f172a;font-size:12.5px">' +
      escapeHtml(nombre) +
      cuitMatchBadge +
      '</div>' +
      '<div style="font-size:10.5px;color:#64748b;margin-top:2px">' +
      '<span style="background:#dbeafe;color:#1e3a8a;padding:1px 5px;border-radius:3px;font-weight:600">SAP ' +
      escapeHtml(cc) +
      '</span> ' +
      (cu ? '&middot; CUIT ' + escapeHtml(cu) + ' ' : '') +
      '&middot; ' +
      escapeHtml(loc || '-') +
      ' / ' +
      escapeHtml(titleCase(prov || '-')) +
      '</div></div>' +
      '<button type="button" onclick="event.stopPropagation();confirmVincularSap(\'' +
      escapeAttr(a._fsId) +
      '\')" ' +
      'style="background:#0e7490;color:#fff;padding:6px 10px;font-size:10px;font-weight:700;border:none;border-radius:4px;cursor:pointer;white-space:nowrap">Vincular</button>' +
      '</div></div>';
  });
  if (filtered.length > MAX) {
    html +=
      '<div style="padding:10px;text-align:center;color:#94a3b8;font-size:10px">Mostrando ' +
      MAX +
      ' de ' +
      filtered.length +
      '. Refina la busqueda.</div>';
  }
  listEl.innerHTML = html;
};

window.selectVincularSapItem = function (fsId) {
  vsmSelectedSapId = fsId;
  renderVincularSapList();
};

window.confirmVincularSap = async function (sapAltaFsId) {
  if (!vsmProvisorioId || !sapAltaFsId) return;
  if (userRole !== 'admin') return;
  const prov = (approvedAltasList || []).find((x) => x._fsId === vsmProvisorioId);
  const sap = (approvedAltasList || []).find((x) => x._fsId === sapAltaFsId);
  if (!prov || !sap) {
    alert('No encuentro los documentos. Cerrá y volvé a abrir el modal.');
    return;
  }
  const provName = prov.comercio || prov.fantasia || '(sin nombre)';
  const sapName = sap.comercio || sap.fantasia || '(sin nombre)';
  const cc = (sap.cardCodeSap || '').trim();
  if (!cc) {
    alert('El BP elegido no tiene cardCodeSap. No se puede vincular.');
    return;
  }
  const msg =
    'Vincular el provisorio "' +
    provName +
    '" con el BP SAP:\n\n' +
    '   ' +
    sapName +
    '\n' +
    '   CardCode: ' +
    cc +
    '\n' +
    (sap.cuit ? '   CUIT: ' + sap.cuit + '\n' : '') +
    '\nEl provisorio va a quedar HABILITADO con este CardCode.\n' +
    'El BP duplicado del SAP se elimina.\n\nConfirmar?';
  if (!confirm(msg)) return;
  const errEl = document.getElementById('vsm-error');
  if (errEl) errEl.style.display = 'none';
  try {
    const batch = fbDb.batch();
    const provRef = fbDb.collection('client_applications').doc(vsmProvisorioId);
    const sapRef = fbDb.collection('client_applications').doc(sapAltaFsId);
    // Payload: campos SAP + limpiar el flag provisorio. Preservamos assignedVendor,
    // ownerUid, approvals, notas, categorizacion del provisorio original.
    const upd = {
      cardCodeSap: cc,
      manualSapPending: false,
      source: 'sap_sync_manual_link',
      // Copiar campos SAP relevantes si el provisorio no los tenia
      sapCardType: sap.sapCardType || '',
      sapDivision: sap.sapDivision || '',
      sapValid: sap.sapValid || '',
      sapFrozen: sap.sapFrozen || '',
      sapSalesPersonCode: sap.sapSalesPersonCode != null ? sap.sapSalesPersonCode : null,
      sapReadyForSL: !!sap.sapReadyForSL,
      linkedFromSapDocId: sapAltaFsId,
      linkedBy: currentUser ? currentUser.email || currentUser.uid : '',
      linkedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    // Completar datos vacios del provisorio con los del BP SAP (sin pisar los cargados)
    if (!(prov.cuit || '').trim() && sap.cuit) upd.cuit = sap.cuit;
    if (!(prov.calle || '').trim() && sap.calle) upd.calle = sap.calle;
    if (!(prov.localidad || '').trim() && sap.localidad) {
      upd.localidad = sap.localidad;
      upd.localidadFinal = sap.localidadFinal || sap.localidad;
    }
    if (!(prov.provincia || '').trim() && sap.provincia)
      upd.provincia = String(sap.provincia).toUpperCase();
    if (!(prov.email || '').trim() && sap.email) upd.email = sap.email;
    if (!(prov.telefonoContacto || '').trim() && sap.telefonoContacto)
      upd.telefonoContacto = sap.telefonoContacto;
    if (!(prov.codigoPostal || '').trim() && sap.codigoPostal) upd.codigoPostal = sap.codigoPostal;
    batch.set(provRef, upd, { merge: true });
    batch.delete(sapRef);
    await batch.commit();
    // El listener de approvedAltasList repinta todo automatico. Cerrar modal.
    closeVincularSapModal();
    // Actualizar la tabla de Master Clientes (por si esta abierta)
    if (typeof renderMasterClientesTable === 'function') renderMasterClientesTable();
    alert('✓ Vinculado. "' + provName + '" ahora tiene CardCode ' + cc + ' y quedo confirmado.');
  } catch (e) {
    console.error('confirmVincularSap', e);
    if (errEl) {
      errEl.style.display = 'block';
      errEl.textContent = 'Error vinculando: ' + (e.message || e);
    } else {
      alert('Error vinculando: ' + (e.message || e));
    }
  }
};

window.renderMasterClientesTable = function () {
  const cont = document.getElementById('mc-body');
  if (!cont) return;
  if (mcProvisorioMode) {
    renderMcProvisoriosTable();
    return;
  }
  // v349+: modo SAP - filtra dentro de la vista normal para que se vean
  // SOLO las altas con cardCodeSap (excluye POINTS del padron viejo y
  // provisorios). El resto de la logica de render/edit es igual.
  const fv = document.getElementById('mc-filt-vendor').value;
  const fp = document.getElementById('mc-filt-prov').value;
  const fl = document.getElementById('mc-filt-loc').value;
  const fe = document.getElementById('mc-filt-estado').value;
  const fq = (document.getElementById('mc-search').value || '').trim().toLowerCase();

  let entries = getAllStoreEntries();
  // v349+: modo SAP-only aplica primero. Excluye POINTS del padron viejo y
  // provisorios (altas sin cardCodeSap). Solo deja las que tienen CardCode.
  if (mcSapMode) entries = entries.filter((e) => e.tipo === 'sap_alta' && e.sapCardCode);
  if (fv !== 'ALL') entries = entries.filter((e) => e.vendor === fv);
  if (fp !== 'ALL') entries = entries.filter((e) => e.provincia === fp);
  if (fl !== 'ALL') entries = entries.filter((e) => e.localidad === fl);
  if (fq)
    entries = entries.filter((e) =>
      matchesAllTokens(
        [e.nombre, e.localidad, e.provincia, e.vendor].filter(Boolean).join(' | '),
        fq
      )
    );

  // Aplicar filtro de estado segun cache (combinado con pending)
  // Devuelve la direccion del cliente: 1) pending changes en memoria,
  // 2) client_master (Firestore global, escrito por admin), 3) clientMeta
  // (per-user, mergeado por admin/viewer via attachFirebaseListeners para
  // ver lo que cargo cada vendedor desde el modal "Dar de alta").
  function getCurrent(docId, provincia, localidad, nombre, tipo) {
    if (mcPendingChanges[docId] != null) return mcPendingChanges[docId];
    // Para SAP altas (docId con prefijo sap:) leemos de approvedAltasList.
    if (typeof docId === 'string' && docId.indexOf('sap:') === 0) {
      const fsId = docId.slice(4);
      const a = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
        (x) => x._fsId === fsId
      );
      return a ? a.calle || a.address || '' : '';
    }
    const d = clientMasterCache.get(docId);
    // Si admin guardo explicitamente (incluido vacio), gana sobre clientMeta.
    // Esto permite que admin borre una direccion que el vendedor cargo y
    // realmente quede vacia al re-renderizar (antes el clear se "deshacia"
    // porque clientMeta seguia teniendo el valor del vendedor).
    if (d && d.addressExplicit) return d.address || '';
    if (d && d.address) return d.address;
    if (typeof clientMeta === 'object' && clientMeta && provincia && localidad && nombre) {
      // El key de clientMeta es 'tipo|prov|loc|nombre' donde tipo es 'C' o 'P'.
      const cTipo = tipo === 'cliente' ? 'C' : tipo === 'prospecto' ? 'P' : null;
      const candidates = cTipo
        ? [cTipo + '|' + provincia + '|' + localidad + '|' + nombre]
        : [
            'C|' + provincia + '|' + localidad + '|' + nombre,
            'P|' + provincia + '|' + localidad + '|' + nombre,
          ];
      for (const k of candidates) {
        const m = clientMeta[k];
        if (m && m.address) return m.address;
      }
    }
    return '';
  }
  // Helper: id de entrada considerando SAP altas (que usan prefijo sap:<fsId>).
  function entryDocId(e) {
    return e.tipo === 'sap_alta'
      ? 'sap:' + e.sapFsId
      : clientLocId(e.provincia, e.localidad, e.nombre);
  }
  if (fe === 'con')
    entries = entries.filter(
      (e) => !!getCurrent(entryDocId(e), e.provincia, e.localidad, e.nombre, e.tipo)
    );
  else if (fe === 'sin')
    entries = entries.filter(
      (e) => !getCurrent(entryDocId(e), e.provincia, e.localidad, e.nombre, e.tipo)
    );

  entries.sort(
    (a, b) =>
      a.provincia.localeCompare(b.provincia) ||
      a.localidad.localeCompare(b.localidad) ||
      a.nombre.localeCompare(b.nombre)
  );

  // Stats globales (sobre el total filtrado, no solo lo paginado)
  const totalConDir = entries.filter(
    (e) => !!getCurrent(entryDocId(e), e.provincia, e.localidad, e.nombre, e.tipo)
  ).length;
  const statsHtml =
    '<span class="ok">Con direcci&oacute;n: ' +
    totalConDir +
    '</span>' +
    '<span>Sin direcci&oacute;n: ' +
    (entries.length - totalConDir) +
    '</span>' +
    '<span>Total filtrado: ' +
    entries.length +
    '</span>' +
    (Object.keys(mcPendingChanges).length
      ? '<span style="background:#fef3c7;color:#92400e;border-color:#fde68a">Cambios sin guardar: ' +
        Object.keys(mcPendingChanges).length +
        '</span>'
      : '');
  document.getElementById('mc-stats').innerHTML = statsHtml;

  if (!entries.length) {
    cont.innerHTML = '<div class="mc-empty">No hay tiendas con esos filtros.</div>';
    return;
  }

  // Dropdown unico de Tipo de cliente (P/A/B/C). Volumen ahora es dinamico
  // (sale del subtotal del pedido) y el bonus de pago anticipado depende
  // de la forma de pago elegida al armar cada pedido.
  // v349+ (2026-07-29): default 'C' cuando el cliente no tiene cliTipo
  // guardado. Antes arrancaba en (sin clasificar). Cambiar manualmente para
  // upgrade a B/A/P. Se aplica en render: si curTipo es '' se muestra 'C'
  // seleccionado (pero NO auto-persiste - el user debe apretar Guardar para
  // que quede en Firestore).
  const TIPO_OPTS = [
    { v: 'C', l: 'C' },
    { v: 'B', l: 'B' },
    { v: 'A', l: 'A' },
    { v: 'P', l: 'P (Premium)' },
    { v: '', l: '(sin clasificar)' },
  ];
  function _selHtml(name, current, opts, docId) {
    const has = current ? ' has-value' : '';
    let s =
      '<select class="mc-cli-sel' +
      has +
      '" onchange="saveMcClientField(\'' +
      escapeAttr(docId) +
      "', '" +
      name +
      '\', this)">';
    opts.forEach((o) => {
      s +=
        '<option value="' +
        escapeAttr(o.v) +
        '"' +
        (o.v === current ? ' selected' : '') +
        '>' +
        escapeHtml(o.l) +
        '</option>';
    });
    s += '</select>';
    return s;
  }
  let html = '<table class="mc-table"><thead><tr>';
  html += '<th style="width:22%">Tienda</th>';
  html += '<th style="width:12%">Localidad</th>';
  html += '<th style="width:11%">Provincia</th>';
  html += '<th style="width:13%">Vendedor</th>';
  html += '<th style="width:23%">Direcci&oacute;n exacta</th>';
  html += '<th style="width:11%" title="Categoria comercial del cliente">Tipo</th>';
  html += '<th style="width:8%"></th>';
  html += '</tr></thead><tbody>';
  const MAX = 500;
  entries.slice(0, MAX).forEach((e) => {
    const isSap = e.tipo === 'sap_alta';
    const id = entryDocId(e);
    const cur = getCurrent(id, e.provincia, e.localidad, e.nombre, e.tipo);
    // Para POINTS usamos clientMasterCache; para SAP altas usamos el doc en
    // approvedAltasList (savedAddr es la calle/address actual guardada).
    let savedAddr = '';
    let curTipo = '';
    if (isSap) {
      const alta = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
        (x) => x._fsId === e.sapFsId
      );
      savedAddr = alta ? alta.calle || alta.address || '' : '';
      curTipo = (alta && alta.cliTipo) || '';
    } else {
      const saved = clientMasterCache.get(id);
      savedAddr = saved && saved.address ? saved.address : '';
      curTipo = (saved && saved.cliTipo) || '';
    }
    const isDirty = mcPendingChanges[id] != null;
    const inputCls = 'mc-addr-input' + (cur ? ' has-value' : '');
    const btnCls = 'mc-save-btn' + (isDirty ? ' changed' : '');
    const vendInfo = VENDORS.find((v) => v.key === e.vendor);
    const vendLabel = vendInfo
      ? vendInfo.zone + ' ' + titleCase(e.vendor)
      : e.vendor
        ? titleCase(e.vendor)
        : '-';
    // Aplicar customName de clientMeta si un vendedor renombro la tienda
    // desde el modal "Dar de alta". Como admin/viewer reciben los
    // clientMeta de todos los users mergeados, vemos los renombres aca.
    const _cTipo = e.tipo === 'cliente' ? 'C' : 'P';
    const _metaKey = _cTipo + '|' + e.provincia + '|' + e.localidad + '|' + e.nombre;
    const _customName =
      !isSap && clientMeta && clientMeta[_metaKey] && clientMeta[_metaKey].customName
        ? String(clientMeta[_metaKey].customName).trim()
        : '';
    const displayName = _customName || e.nombre;
    const renamedHint =
      _customName && _customName !== e.nombre
        ? '<div style="font-size:9px;color:#94a3b8;font-weight:500" title="Nombre original">orig: ' +
          escapeHtml(e.nombre) +
          '</div>'
        : '';
    // Badge: CLIENTE / PROSPECTO / SAP / PROVISORIO segun tipo.
    // v302+: isProvisorio = SAP alta sin cardCodeSap (Alta Rapida pendiente
    // de carga a SAP). Habilita edit inline del nombre y vendedor tambien
    // desde el Master Clientes normal (no solo del modo Provisorios).
    const isProvisorio = isSap && !e.sapCardCode;
    const canEditProv302 = isProvisorio && (userRole === 'admin' || userRole === 'gerente');
    // v315+: detector de duplicado SAP para las filas provisorias que aparecen
    // mezcladas en la vista normal. Rojo + badge.
    let dupSapV = null;
    if (isProvisorio) {
      const altaProv2 = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
        (x) => x._fsId === e.sapFsId
      );
      if (altaProv2 && typeof findSapDuplicateForProvisorio === 'function') {
        dupSapV = findSapDuplicateForProvisorio(altaProv2);
      }
    }
    const dupBadgeV = dupSapV
      ? ' <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;margin-left:6px" title="POSIBLE DUPLICADO SAP: ' +
        escapeAttr(dupSapV.comercio || dupSapV.fantasia || '?') +
        ' (' +
        escapeAttr(dupSapV.cardCodeSap || '') +
        '). Revisa y elimina el provisorio si corresponde.">&#9888; DUPLICADO SAP ' +
        escapeHtml(dupSapV.cardCodeSap || '') +
        '</span>'
      : '';
    const rowStyleV = dupSapV ? ' style="background:#fee2e2;border-left:4px solid #dc2626"' : '';
    let tagHtml;
    if (isSap) {
      if (e.sapCardCode) {
        tagHtml =
          '<span class="mc-tag" style="background:#dbeafe;color:#1e3a8a;border:1px solid #93c5fd">SAP ' +
          escapeHtml(e.sapCardCode) +
          '</span>';
      } else {
        tagHtml =
          '<span class="mc-tag" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d">&#9889; PROVISORIO</span>' +
          dupBadgeV;
      }
    } else {
      tagHtml =
        '<span class="mc-tag ' +
        (e.tipo === 'cliente' ? 'cli' : 'pro') +
        '">' +
        (e.tipo === 'cliente' ? 'CLIENTE' : 'PROSPECTO') +
        '</span>';
    }
    html += '<tr data-doc="' + escapeAttr(id) + '"' + rowStyleV + '>';
    if (canEditProv302) {
      // Nombre editable: si el alta tenia comercio lo edita, sino edita fantasia.
      const altaProv = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
        (x) => x._fsId === e.sapFsId
      );
      const nameField = altaProv && (altaProv.comercio || '').trim() ? 'comercio' : 'fantasia';
      const safeFsId = escapeAttr(e.sapFsId || '');
      html +=
        '<td>' +
        '<input type="text" class="mc-addr-input has-value" style="font-weight:800;font-size:12.5px;color:#0f172a" ' +
        'value="' +
        escapeAttr(displayName) +
        '" ' +
        'onchange="saveMcProvisorioComercio(\'' +
        safeFsId +
        "', '" +
        nameField +
        '\', this)" ' +
        'onkeydown="if(event.key===\'Enter\')this.blur()" ' +
        'title="Editar nombre del comercio (autosave al salir del campo o Enter)" />' +
        '<div class="mc-meta" style="margin-top:4px">' +
        tagHtml +
        '</div>' +
        '</td>';
    } else {
      html +=
        '<td><div class="mc-name">' +
        escapeHtml(displayName) +
        '</div>' +
        renamedHint +
        '<div class="mc-meta">' +
        tagHtml +
        '</div></td>';
    }
    // Localidad: editable INPUT para SAP altas (asi el admin puede completar
    // las que vienen como "(sin localidad)" sin recargar). Para POINTS la
    // localidad esta atada al docId del padron - se queda como texto.
    if (isSap) {
      const locVal = e.localidad === '(sin localidad)' ? '' : e.localidad;
      // Sin onblur (lo manejaba saveMcSapLocalidad por separado y confundia
      // si el admin tipeaba localidad y direccion al mismo tiempo). Ahora
      // el boton GUARDAR commitea AMBOS campos en una sola operacion.
      html +=
        '<td><input type="text" class="mc-addr-input js-mc-localidad-input' +
        (locVal ? ' has-value' : '') +
        '" style="font-size:11px" value="' +
        escapeAttr(locVal) +
        '" placeholder="(sin localidad)" oninput="onMcSapFieldChange(this)" onkeydown="if(event.key===\'Enter\')this.parentElement.parentElement.querySelector(\'.mc-save-btn\').click()" /></td>';
    } else {
      html += '<td>' + escapeHtml(e.localidad) + '</td>';
    }
    // Provincia: dropdown editable para SAP altas (asi el admin asigna
    // las "(sin provincia)" sin reimportar el Excel). Para POINTS es texto
    // fijo porque la provincia esta atada al docId del padron.
    if (isSap) {
      const provVal = e.provincia === '(sin provincia)' ? '' : e.provincia;
      const provHas = provVal ? ' has-value' : '';
      let provSel =
        '<td><select class="mc-cli-sel js-mc-provincia-input' +
        provHas +
        '" style="font-size:11px;width:100%" onchange="onMcSapFieldChange(this)">';
      provSel += '<option value="">(sin provincia)</option>';
      const provSet = new Set();
      (POINTS || []).forEach((p) => provSet.add(p.province));
      [...provSet].sort().forEach((pr) => {
        provSel +=
          '<option value="' +
          escapeAttr(pr) +
          '"' +
          (pr === provVal ? ' selected' : '') +
          '>' +
          escapeHtml(titleCase(pr)) +
          '</option>';
      });
      provSel += '</select></td>';
      html += provSel;
    } else {
      html += '<td>' + escapeHtml(titleCase(e.provincia)) + '</td>';
    }
    if (canEditProv302) {
      // Vendedor editable via dropdown VDE+VDI. Autosave onchange.
      const safeFsId2 = escapeAttr(e.sapFsId || '');
      let vSel =
        '<td><select class="mc-cli-sel' +
        (e.vendor ? ' has-value' : '') +
        '" ' +
        'style="width:100%;font-size:11px" ' +
        'onchange="saveMcProvisorioVendor(\'' +
        safeFsId2 +
        '\', this)">';
      vSel += '<option value="">(sin vendedor)</option>';
      vSel += '<optgroup label="VDE (Vendedores externos)">';
      VENDORS.filter((v) => VDE_VENDOR_KEYS.has(v.key)).forEach((v) => {
        vSel +=
          '<option value="' +
          escapeAttr(v.key) +
          '"' +
          (v.key === e.vendor ? ' selected' : '') +
          '>' +
          escapeHtml(v.zone + ' - ' + titleCase(v.key)) +
          '</option>';
      });
      vSel += '</optgroup><optgroup label="VDI (Vendedores internos)">';
      VENDORS.filter((v) => VDI_VENDOR_KEYS.has(v.key)).forEach((v) => {
        vSel +=
          '<option value="' +
          escapeAttr(v.key) +
          '"' +
          (v.key === e.vendor ? ' selected' : '') +
          '>' +
          escapeHtml(titleCase(v.key)) +
          '</option>';
      });
      vSel += '</optgroup></select></td>';
      html += vSel;
    } else {
      html += '<td>' + escapeHtml(vendLabel) + '</td>';
    }
    html +=
      '<td><input type="text" class="' +
      inputCls +
      ' js-mc-direccion-input" value="' +
      escapeAttr(cur) +
      '" placeholder="Av. Belgrano 123, Barrio Norte" oninput="onMcAddrInput(this, \'' +
      escapeAttr(id) +
      "', '" +
      escapeAttr(savedAddr) +
      "')\" onkeydown=\"if(event.key==='Enter')this.parentElement.parentElement.querySelector('.mc-save-btn').click()\" /></td>";
    // v349+: default visual 'C' cuando no hay cliTipo guardado. El campo
    // NO se auto-persiste - el user tiene que apretar Guardar para que quede
    // en Firestore. Asi las tiendas existentes sin cliTipo se ven en 'C' pero
    // sabemos cuales fueron confirmadas explicitamente.
    const curTipoRender = curTipo || 'C';
    html +=
      '<td data-vendor="' +
      escapeAttr(e.vendor) +
      '" data-prov="' +
      escapeAttr(e.provincia) +
      '" data-loc="' +
      escapeAttr(e.localidad) +
      '" data-name="' +
      escapeAttr(e.nombre) +
      '">' +
      _selHtml('cliTipo', curTipoRender, TIPO_OPTS, id) +
      '</td>';
    html +=
      '<td><div style="display:flex;gap:4px;flex-wrap:wrap"><button class="' +
      btnCls +
      '" onclick="saveMcAddr(\'' +
      escapeAttr(id) +
      '\', this)" data-vendor="' +
      escapeAttr(e.vendor) +
      '" data-prov="' +
      escapeAttr(e.provincia) +
      '" data-loc="' +
      escapeAttr(e.localidad) +
      '" data-name="' +
      escapeAttr(e.nombre) +
      '" data-sap-fsid="' +
      escapeAttr(isSap ? e.sapFsId : '') +
      '">Guardar</button>' +
      '<button onclick="deleteMcEntry(\'' +
      escapeAttr(id) +
      "'," +
      JSON.stringify(e.nombre).replace(/"/g, '&quot;') +
      ",'" +
      escapeAttr(isSap ? e.sapFsId : '') +
      '\')" style="background:#dc2626;color:#fff;border:none;border-radius:5px;padding:6px 10px;font-size:10px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.3px" title="Eliminar tienda">&#128465;</button></div></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  if (entries.length > MAX)
    html +=
      '<div style="text-align:center;color:#94a3b8;font-size:11px;padding:12px">Mostrando ' +
      MAX +
      ' de ' +
      entries.length +
      '. Usa filtros / buscador para refinar.</div>';
  cont.innerHTML = html;
};

window.onMcAddrInput = function (input, docId, originalSaved) {
  const val = (input.value || '').trim();
  if (val === (originalSaved || '').trim()) {
    delete mcPendingChanges[docId];
  } else {
    mcPendingChanges[docId] = val;
  }
  input.classList.toggle('has-value', !!val);
  const btn = input.parentElement.parentElement.querySelector('.mc-save-btn');
  if (btn) btn.classList.toggle('changed', mcPendingChanges[docId] != null);
  // Autosave debounced: programar guardado a los 900ms sin cambios.
  const row = input.closest ? input.closest('tr') : null;
  if (row) scheduleMcAutosave(docId, row, 900);
  // Actualizar contador stats (sin re-render entero)
  const statsEl = document.getElementById('mc-stats');
  if (statsEl) {
    const _existing = statsEl.querySelector('span[data-dirty]');
    const n = Object.keys(mcPendingChanges).length;
    let dirtySpan = statsEl.querySelector('.mc-dirty');
    if (n > 0) {
      if (!dirtySpan) {
        dirtySpan = document.createElement('span');
        dirtySpan.className = 'mc-dirty';
        dirtySpan.style.background = '#fef3c7';
        dirtySpan.style.color = '#92400e';
        dirtySpan.style.borderColor = '#fde68a';
        statsEl.appendChild(dirtySpan);
      }
      dirtySpan.textContent = 'Cambios sin guardar: ' + n;
    } else if (dirtySpan) {
      dirtySpan.remove();
    }
  }
};

// Auto-save de los 3 dropdowns de categorizacion en el modal "Dar de alta"
// del vendedor (client-modal). Se guarda directo a client_master Firestore
// (no a localStorage clientMeta) porque es business logic global - todos
// los vendedores y admin tienen que ver los mismos valores.
window.saveClientCategoriaFromModal = async function (fieldName, sel) {
  if (typeof canWrite === 'function' && !canWrite()) {
    alert('Tu rol no permite cambiar la categorizacion del cliente.');
    const modalEl = document.getElementById('client-modal');
    const cmData = clientMasterCache.get(modalEl.dataset.docId) || {};
    sel.value = cmData[fieldName] || '';
    return;
  }
  const modalEl = document.getElementById('client-modal');
  const docId = modalEl && modalEl.dataset.docId;
  if (!docId) return;
  const newVal = sel.value || '';
  const meta = {
    vendor: modalEl.dataset.vendor || '',
    provincia: modalEl.dataset.provincia || '',
    localidad: modalEl.dataset.localidad || '',
    clientName: modalEl.dataset.clientName || '',
  };
  const status = document.getElementById('cm-cli-status');
  if (status) status.innerHTML = '<span style="color:#1d4ed8">Guardando...</span>';
  sel.disabled = true;
  try {
    const update = Object.assign({}, meta, {
      updatedBy: currentUser.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    update[fieldName] = newVal;
    await fbDb.collection('client_master').doc(docId).set(update, { merge: true });
    if (status) {
      status.innerHTML = '<span style="color:#166534">&#10003; Categorizacion guardada</span>';
      setTimeout(() => {
        if (status.innerHTML.indexOf('Categorizacion') >= 0) status.innerHTML = '';
      }, 2200);
    }
  } catch (e) {
    console.error('saveClientCategoriaFromModal', e);
    if (status)
      status.innerHTML =
        '<span style="color:#991b1b">Error guardando: ' +
        escapeHtml(e.message || String(e)) +
        '</span>';
    const cmData = clientMasterCache.get(docId) || {};
    sel.value = cmData[fieldName] || '';
  } finally {
    sel.disabled = false;
  }
};

// Auto-save de los 3 dropdowns de categorizacion comercial (Tipo / Volumen /
// Anticipado). Se guardan directo a client_master sin requerir el boton
// Guardar (que sigue siendo solo para la direccion). El select cambia de
// color cuando se completa para feedback visual.
// Auto-save de la localidad de una SAP alta cuando el admin la edita inline
// en el Master Clientes. Se dispara onblur (al perder foco) o Enter. Si la
// localidad cambia, ademas borra lat/lng asi se re-geocodifica con la nueva
// localidad la proxima vez que se actualice la direccion.
window.saveMcSapLocalidad = async function (fsId, inputEl) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente.');
    const alta = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
      (x) => x._fsId === fsId
    );
    if (alta && inputEl) inputEl.value = alta.localidadFinal || alta.localidad || '';
    return;
  }
  if (!fsId) return;
  const newVal = (inputEl.value || '').trim();
  const alta = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
    (x) => x._fsId === fsId
  );
  const oldVal = alta ? (alta.localidadFinal || alta.localidad || '').trim() : '';
  if (newVal === oldVal) return; // sin cambios
  inputEl.classList.add('saving');
  try {
    const payload = {
      localidad: newVal,
      localidadFinal: newVal,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
    };
    // Si cambio la localidad, limpiar lat/lng asi el proximo geocoding
    // arranca con la nueva localidad (mejor match en OSM/Google).
    if (newVal !== oldVal) {
      payload.lat = firebase.firestore.FieldValue.delete();
      payload.lng = firebase.firestore.FieldValue.delete();
    }
    await fbDb.collection('client_applications').doc(fsId).set(payload, { merge: true });
    inputEl.classList.toggle('has-value', !!newVal);
    showSyncTag(newVal ? 'Localidad actualizada' : 'Localidad limpiada');
    // Si tiene direccion y ahora tiene localidad, intentar geocoding directo
    // asi se actualiza el pin.
    if (
      newVal &&
      alta &&
      (alta.calle || alta.address) &&
      typeof geocodeClientAddress === 'function'
    ) {
      try {
        const geo = await geocodeClientAddress(
          alta.calle || alta.address,
          newVal,
          alta.provincia || ''
        );
        if (geo && geo.lat != null && geo.lng != null) {
          await fbDb
            .collection('client_applications')
            .doc(fsId)
            .set(
              {
                lat: geo.lat,
                lng: geo.lng,
                geoDisplay: geo.display || '',
                geoProvider: geo.provider || 'osm',
                geoAt: firebase.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
        }
      } catch (e) {
        console.warn('geocode tras cambiar localidad', e);
      }
    }
  } catch (e) {
    console.error('saveMcSapLocalidad', e);
    alert('Error guardando localidad: ' + (e.message || e));
    if (alta) inputEl.value = alta.localidadFinal || alta.localidad || '';
  } finally {
    inputEl.classList.remove('saving');
  }
};

window.saveMcClientField = async function (docId, fieldName, sel) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede editar categorizacion comercial.');
    // Revertir UI
    const saved = clientMasterCache.get(docId);
    sel.value = (saved && saved[fieldName]) || '';
    return;
  }
  const newVal = sel.value || '';
  // SAP altas (prefijo sap:) -> escribir a client_applications.
  const isSap = typeof docId === 'string' && docId.indexOf('sap:') === 0;
  sel.classList.add('saving');
  try {
    if (isSap) {
      const fsId = docId.slice(4);
      const update = {
        updatedBy: currentUser.email || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      update[fieldName] = newVal;
      await fbDb.collection('client_applications').doc(fsId).set(update, { merge: true });
    } else {
      // Para POINTS sacamos metadatos del <td> con data-attrs del row.
      const td =
        sel.closest('td[data-vendor]') || sel.closest('tr').querySelector('td[data-vendor]');
      const meta = {
        vendor: td ? td.dataset.vendor : '',
        provincia: td ? td.dataset.prov : '',
        localidad: td ? td.dataset.loc : '',
        clientName: td ? td.dataset.name : '',
      };
      const update = Object.assign({}, meta, {
        updatedBy: currentUser.email || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      update[fieldName] = newVal;
      await fbDb.collection('client_master').doc(docId).set(update, { merge: true });
    }
    sel.classList.toggle('has-value', !!newVal);
    showSyncTag('Categorizacion guardada');
  } catch (e) {
    console.error('saveMcClientField', e);
    alert('Error guardando: ' + (e.message || e));
    // Revertir UI al valor previo
    if (isSap) {
      const fsId = docId.slice(4);
      const alta = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
        (x) => x._fsId === fsId
      );
      sel.value = (alta && alta[fieldName]) || '';
    } else {
      const saved = clientMasterCache.get(docId);
      sel.value = (saved && saved[fieldName]) || '';
    }
  } finally {
    sel.classList.remove('saving');
  }
};

// Calcula el descuento estimado para un pedido en base a Tipo de cliente,
// el subtotal real del pedido (volumen dinamico) y la forma de pago elegida
// para ESTE pedido. Es PURAMENTE INFORMATIVO para que el vendedor pueda
// mostrarle al duenio de la tienda como queda el pedido aplicando los
// descuentos. El payload a SAP va con el subtotal SIN descuento - SAP
// recalcula al ingresar el pedido para evitar duplicar descuentos.
//
// Tabla de descuentos (acumulativos):
//   Fijo (por tipo de cliente):   P=6% / A=3% / B,C=0%
//   Volumen (DINAMICO segun subtotal del pedido actual):
//     hasta $3M: 0% / $3M-$4.5M: 2% / $4.5M-$10M: 3% /
//     $10M-$20M: 4% / mas de $20M: 6%
//   Pago Anticipado (solo si forma de pago = CONTADO):
//     P=5% / A=3% / B,C=0%
// calcClientDiscount: movido al bundle (window.calcClientDiscount vía __phase0.pure).

// Devuelve los datos comerciales del cliente actual del pedido (currentOrderClient).
// Se usa en renderReviewLines para calcular el descuento estimado.
function getCurrentOrderClientData() {
  if (!currentOrderClient) return null;
  const id = clientLocId(
    currentOrderClient.province,
    currentOrderClient.locName,
    currentOrderClient.name
  );
  return clientMasterCache.get(id) || null;
}

// Devuelve el factor multiplicativo para convertir subtotal bruto a NETO
// (post-descuento) segun el snapshot guardado al confirmar el pedido.
// Pedidos viejos sin snapshot devuelven 1 (sin descuento aplicado -
// retrocompatibilidad: el dashboard sigue mostrando lo que mostraba antes).
function pedidoDiscountFactor(pedido) {
  const pct = (pedido && pedido.discountSnapshot && pedido.discountSnapshot.pctTotal) || 0;
  if (pct <= 0) return 1;
  if (pct >= 100) return 0;
  return 1 - pct / 100;
}
window.pedidoDiscountFactor = pedidoDiscountFactor;

// Eliminar una entrada de Master Clientes. Comportamiento segun tipo:
//  - SAP altas (sapFsId presente): borra el doc en client_applications.
//    Solo si no tiene cardCodeSap todavia O si el admin/gerente confirma
//    que entiende que esta borrando un cliente cargado en SAP B1.
//  - POINTS legacy: borra el doc en client_master (limpia direccion) y
//    avisa que el nombre queda en el padron historico hasta el proximo
//    rebuild del Excel.
window.deleteMcEntry = async function (docId, nombre, sapFsId) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede eliminar tiendas.');
    return;
  }
  const safeName = nombre || 'esta tienda';
  if (sapFsId) {
    // Es un alta SAP - tiene su propio doc en client_applications.
    const alta = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
      (x) => x._fsId === sapFsId
    );
    const hasSapCode = !!(alta && alta.cardCodeSap);
    const warn = hasSapCode
      ? '\n\nATENCION: esta tienda esta cargada en SAP (cardCode ' +
        alta.cardCodeSap +
        '). Borrarla solo la saca de la app, NO la borra de SAP B1. Si tiene pedidos asociados, esos pedidos pueden quedar huerfanos.\n'
      : '';
    if (
      !confirm('Eliminar "' + safeName + '" de Master Clientes?' + warn + '\nNo se puede deshacer.')
    )
      return;
    try {
      await fbDb.collection('client_applications').doc(sapFsId).delete();
      if (typeof showSyncTag === 'function') showSyncTag('Tienda eliminada: ' + safeName);
    } catch (e) {
      console.error('deleteMcEntry SAP', e);
      alert('Error eliminando: ' + (e.message || e));
    }
    return;
  }
  // POINTS legacy: solo borramos el doc client_master (la direccion). El
  // nombre del cliente vive en POINTS hardcoded - no se puede borrar desde
  // aca, hay que rebuildear el HTML para sacarlo del padron.
  if (
    !confirm(
      'Limpiar la direccion guardada de "' +
        safeName +
        '"?\n\nEl nombre del cliente queda en el padron historico (no se puede borrar del POINTS desde la app).\n\nNo se puede deshacer.'
    )
  )
    return;
  try {
    await fbDb.collection('client_master').doc(docId).delete();
    if (typeof showSyncTag === 'function') showSyncTag('Direccion eliminada: ' + safeName);
  } catch (e) {
    console.error('deleteMcEntry client_master', e);
    alert('Error eliminando: ' + (e.message || e));
  }
};

window.saveMcAddr = async function (docId, btn) {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede editar.');
    return;
  }
  // Leer los inputs de la fila directamente del DOM. Antes dependiamos de
  // mcPendingChanges, pero si el listener de Firestore re-renderizaba la
  // tabla mientras tipeabas se perdia la referencia.
  const row = btn.closest('tr');
  const inputEl = row ? row.querySelector('input.js-mc-direccion-input') : null;
  if (!inputEl) {
    alert('No pude leer la direccion. Recargá la pagina.');
    return;
  }
  const newVal = (inputEl.value || '').trim();
  const isSap = typeof docId === 'string' && docId.indexOf('sap:') === 0;
  // Para SAP altas tambien leemos la LOCALIDAD y PROVINCIA del input de
  // la misma fila, asi el boton GUARDAR commitea los 3 campos juntos.
  let newLoc = null;
  let newProv = null;
  if (isSap) {
    const locInput = row ? row.querySelector('input.js-mc-localidad-input') : null;
    if (locInput) newLoc = (locInput.value || '').trim();
    const provSel = row ? row.querySelector('.js-mc-provincia-input') : null;
    if (provSel) newProv = (provSel.value || '').trim().toUpperCase();
  }
  // Calcular el valor "guardado" para direccion. Usamos la misma cascada
  // que getCurrent (client_master -> clientMeta) para POINTs. Para SAP
  // altas leemos del alta directo.
  let prevAddr = '';
  let prevLoc = '';
  let prevProv = '';
  if (isSap) {
    const fsId = docId.slice(4);
    const alta = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
      (x) => x._fsId === fsId
    );
    prevAddr = alta ? alta.calle || alta.address || '' : '';
    prevLoc = alta ? (alta.localidadFinal || alta.localidad || '').trim() : '';
    prevProv = alta ? (alta.provincia || '').toUpperCase().trim() : '';
  } else {
    const saved = clientMasterCache.get(docId);
    if (saved && saved.address) {
      prevAddr = saved.address;
    } else {
      // No esta en client_master - tal vez la cargo el vendedor en clientMeta.
      const prov = btn.dataset.prov || '';
      const loc = btn.dataset.loc || '';
      const nombre = btn.dataset.name || '';
      if (typeof clientMeta === 'object' && clientMeta && prov && loc && nombre) {
        const candidates = [
          'C|' + prov + '|' + loc + '|' + nombre,
          'P|' + prov + '|' + loc + '|' + nombre,
        ];
        for (const k of candidates) {
          const m = clientMeta[k];
          if (m && m.address) {
            prevAddr = m.address;
            break;
          }
        }
      }
    }
  }
  const addrChanged = newVal.trim() !== (prevAddr || '').trim();
  const locChanged = isSap && newLoc != null && newLoc !== prevLoc;
  const provChanged = isSap && newProv != null && newProv !== prevProv;
  if (!addrChanged && !locChanged && !provChanged) {
    alert(
      'No hay cambios pendientes para esta tienda.\n\n(Direccion, localidad y provincia son identicas a lo guardado.)'
    );
    return;
  }
  btn.disabled = true;
  const oldTxt = btn.textContent;
  btn.textContent = 'Guardando...';
  try {
    if (isSap) {
      // Escribir a client_applications.doc(fsId) con la nueva calle. Limpiar
      // lat/lng asi se re-geocodifica con la nueva direccion.
      const fsId = docId.slice(4);
      const alta = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).find(
        (x) => x._fsId === fsId
      );
      const updatePayload = {
        calle: newVal,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser.email || '',
      };
      // Si el admin cambio la localidad en el input de la fila, la
      // commiteamos junto con la direccion.
      if (locChanged) {
        updatePayload.localidad = newLoc;
        updatePayload.localidadFinal = newLoc;
      }
      // Si el admin asigno provincia desde el dropdown, commiteamos. Si
      // tambien hay vendor logico para esa provincia (via inferVendorFromProvince),
      // lo seteamos solo si el alta no tenia vendor antes (no pisar trabajo
      // del admin que ya reasigno).
      if (provChanged) {
        updatePayload.provincia = newProv;
        if (newProv && typeof inferVendorFromProvince === 'function') {
          const altaCurrent = (
            typeof approvedAltasList !== 'undefined' ? approvedAltasList : []
          ).find((x) => x._fsId === docId.slice(4));
          if (altaCurrent && !altaCurrent.assignedVendor) {
            const inferred = inferVendorFromProvince(newProv);
            if (inferred) updatePayload.assignedVendor = inferred;
          }
        }
      }
      // Si la direccion / localidad / provincia cambiaron, limpiar lat/lng
      // para re-geocodificar con los datos nuevos.
      if (addrChanged || locChanged || provChanged) {
        updatePayload.lat = firebase.firestore.FieldValue.delete();
        updatePayload.lng = firebase.firestore.FieldValue.delete();
      }
      await fbDb.collection('client_applications').doc(fsId).set(updatePayload, { merge: true });
      // Disparar geocoding (Google -> OSM) si hay direccion. Usamos la
      // localidad NUEVA si la cambiamos en esta misma operacion.
      if (newVal && alta && typeof geocodeClientAddress === 'function') {
        const locForGeo = locChanged ? newLoc : alta.localidadFinal || alta.localidad || '';
        const provForGeo = provChanged ? newProv : alta.provincia || '';
        try {
          const geo = await geocodeClientAddress(newVal, locForGeo, provForGeo);
          if (geo && geo.lat != null && geo.lng != null) {
            const followUp = {
              lat: geo.lat,
              lng: geo.lng,
              geoDisplay: geo.display || '',
              geoPrecision: geo.precision || '',
              geoProvider: geo.provider || 'osm',
              geoAt: firebase.firestore.FieldValue.serverTimestamp(),
            };
            // Autocompletar localidad si geocoding la detecto y la app no tenia.
            const detectedLoc = (geo.locality || '').trim();
            if (detectedLoc && !locForGeo) {
              followUp.localidad = detectedLoc;
              followUp.localidadFinal = detectedLoc;
            }
            await fbDb.collection('client_applications').doc(fsId).set(followUp, { merge: true });
          }
        } catch (eg) {
          console.warn('geocode tras MC save', eg);
        }
      }
    } else {
      const meta = {
        vendor: btn.dataset.vendor || '',
        provincia: btn.dataset.prov || '',
        localidad: btn.dataset.loc || '',
        clientName: btn.dataset.name || '',
      };
      // addressExplicit = true marca que admin escribio el campo a proposito.
      // Esto hace que getCurrent respete el valor (incluido vacio) sobre la
      // direccion que un vendedor haya guardado en clientMeta. Sin este flag,
      // al borrar la direccion el render reverteria al valor del vendedor.
      await fbDb
        .collection('client_master')
        .doc(docId)
        .set(
          Object.assign({}, meta, {
            address: newVal || '',
            addressExplicit: true,
            updatedBy: currentUser.email || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          }),
          { merge: true }
        );
    }
    delete mcPendingChanges[docId];
    btn.classList.remove('changed');
    btn.textContent = 'OK';
    showSyncTag('Direccion guardada');
    setTimeout(() => {
      btn.textContent = oldTxt;
      btn.disabled = false;
    }, 900);
  } catch (e) {
    console.error('saveMcAddr', e);
    btn.textContent = oldTxt;
    btn.disabled = false;
    alert('Error guardando: ' + (e && e.code ? '[' + e.code + '] ' : '') + (e.message || e));
  }
};

// === Exports a window para callers cross-scope ===
// Todas las funciones window.foo = function... ya son verbatim.
// pedidoDiscountFactor es interna al bloque pero usada por múltiples callers
// del inline (dashboard, pedidos, campanias) — se re-expone por safety.
if (
  typeof window.pedidoDiscountFactor === 'undefined' &&
  typeof pedidoDiscountFactor === 'function'
) {
  window.pedidoDiscountFactor = pedidoDiscountFactor;
}
// E6 hotfix: applyRolePermissions del inline (L11540) llama sin prefix.
window.ensureClientMasterListener = ensureClientMasterListener;
// E6 hotfix 2: helpers usados por inline (KPIs sidebar + toggle provisorios).
window.getProvisoriosList = getProvisoriosList;
window.updateMcProvisorioCount = updateMcProvisorioCount;
// E6 hotfix 3: cross-module bug — pedidos-modal llama getCurrentOrderClientData en renderReviewLines.
window.getCurrentOrderClientData = getCurrentOrderClientData;
