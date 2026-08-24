// @ts-nocheck
// SAP-ADMIN-PANEL: panel SAP admin con 6 tabs + listeners + acciones.
// CUARTO y último fragmento del dominio sap-integrations (regla #14 CLAUDE.md).
// Extraído verbatim de index.html (4 fragmentos discontinuos separados por
// product-catalog listener + stub sap-service-layer que quedan en inline)
// como parte de E2.m.2 (e2b-perf 2026-07-28).
//
// Cross-scope state (via window, todos los usos con prefix window. explicit):
// - window.sapClientsMap / window.sapProductsMap: LEIDOS por sapGetClienteCode
//   / sapGetMaterialCode (cross-scope caller de exports-sap.js).
// - window.sapConfigCache: LEIDO por sapSL.loadConfig (bundle sap-service-layer),
//   sap-auto-send-listener bundle, exports-sap.js buildQuotationPayload.
// - window.unsubSapClients / window.unsubSapProducts / window.unsubSapConfig:
//   cleanups en detachFirebaseListeners inline.

// =====================================================================
// SECCIÓN: F1: vars + listenSapMaps + open/close/switchSapTab (inline L12136-12208)
// =====================================================================

if (typeof window.sapClientsMap === 'undefined') window.sapClientsMap = {};
if (typeof window.sapProductsMap === 'undefined') window.sapProductsMap = {};
if (typeof window.unsubSapClients === 'undefined') window.unsubSapClients = null;
if (typeof window.unsubSapProducts === 'undefined') window.unsubSapProducts = null;
// CROSS-SCOPE (E6 fix C5): inline callback unsubPedidosAll L13810 lee.
if (typeof window.sapCurrentTab === 'undefined') window.sapCurrentTab = 'pendientes';
const sapPendSelection = new Set();
// CROSS-SCOPE (regla #17): sapClienteSearch/sapProductoSearch se leen y escriben
// desde el bundle exports-sap.js (mismo bundle esbuild pero DISTINTO IIFE de módulo).
// Var en el top-level de un módulo del bundle NO va a window global — queda
// encerrada en el scope del IIFE. Fix: patrón window.X con guard typeof undefined.
// El bug se disparó en prod (Sentry 2026-08-02 23:12 UTC, JAVASCRIPT-J):
// renderSapClientes/renderSapProductos leían la var como free reference,
// resolvía a window.sapClienteSearch = undefined → ReferenceError.
if (typeof window.sapClienteSearch === 'undefined') window.sapClienteSearch = '';
if (typeof window.sapProductoSearch === 'undefined') window.sapProductoSearch = '';
let sapPendienteSearch = '';
let sapTransferidoSearch = '';

function sapNorm(s) {
  return (s == null ? '' : s.toString()).trim().toUpperCase();
}

function listenSapMaps() {
  if (!fbDb || !currentUser) return;
  if (userRole !== 'admin' && userRole !== 'viewer') return;
  if (window.unsubSapClients) {
    window.unsubSapClients();
    window.unsubSapClients = null;
  }
  window.unsubSapClients = fbDb.collection('sap_clients').onSnapshot(
    (qs) => {
      const m = {};
      qs.forEach((doc) => {
        const d = doc.data();
        if (d && d.clientName) m[sapNorm(d.clientName)] = Object.assign({ _fsId: doc.id }, d);
      });
      window.sapClientsMap = m;
      if (document.getElementById('sap-modal').classList.contains('open')) {
        if (window.sapCurrentTab === 'clientes') renderSapClientes();
        else if (window.sapCurrentTab === 'pendientes' || window.sapCurrentTab === 'transferidos')
          renderSapPedidos();
      }
    },
    (err) => console.error('sap_clients listener', err)
  );
  if (window.unsubSapProducts) {
    window.unsubSapProducts();
    window.unsubSapProducts = null;
  }
  window.unsubSapProducts = fbDb.collection('sap_products').onSnapshot(
    (qs) => {
      const m = {};
      qs.forEach((doc) => {
        const d = doc.data();
        if (d && d.productCode) m[d.productCode] = Object.assign({ _fsId: doc.id }, d);
      });
      window.sapProductsMap = m;
      if (document.getElementById('sap-modal').classList.contains('open')) {
        if (window.sapCurrentTab === 'productos') renderSapProductos();
        else if (window.sapCurrentTab === 'pendientes' || window.sapCurrentTab === 'transferidos')
          renderSapPedidos();
      }
    },
    (err) => console.error('sap_products listener', err)
  );
}

window.openSapPanel = function () {
  if (
    userRole !== 'admin' &&
    userRole !== 'viewer' &&
    userRole !== 'vendedor' &&
    userRole !== 'gerente'
  )
    return;
  document.getElementById('sap-modal').classList.add('open');
  // si todavia no estaba escuchando, asegurar la suscripcion
  if (!window.unsubSapClients || !window.unsubSapProducts) listenSapMaps();
  ensureSapConfigListener();
  // Vendedor solo ve pedidos pendientes y transferidos (no mapeo de clientes/productos).
  const isVend = userRole === 'vendedor';
  document.querySelectorAll('.sap-tab').forEach((b) => {
    const t = b.dataset.sapTab;
    if (isVend && (t === 'clientes' || t === 'productos')) b.style.display = 'none';
    else b.style.display = '';
  });
  switchSapTab('pendientes');
};

window.closeSapPanel = function () {
  document.getElementById('sap-modal').classList.remove('open');
};

window.switchSapTab = function (tab) {
  window.sapCurrentTab = tab;
  document
    .querySelectorAll('.sap-tab')
    .forEach((b) => b.classList.toggle('active', b.dataset.sapTab === tab));
  if (tab === 'pendientes' || tab === 'transferidos') renderSapPedidos();
  else if (tab === 'clientes') renderSapClientes();
  else if (tab === 'productos') renderSapProductos();
  else if (tab === 'servicelayer') renderSapServiceLayer();
  else if (tab === 'config') renderSapConfig();
};

// =====================================================================
// SECCIÓN: F2: window.sapConfigCache + config funcs + syncSapCatalog (inline L12210-12458)
// =====================================================================

// ===== Configuracion SAP (Series APP, origen, etc.) =====
// La info vive en app_config/sap_integration. Solo admin edita; el resto la lee.
if (typeof window.sapConfigCache === 'undefined') window.sapConfigCache = {};
if (typeof window.unsubSapConfig === 'undefined') window.unsubSapConfig = null;
function ensureSapConfigListener() {
  if (window.unsubSapConfig || !currentUser || !fbDb) return;
  window.unsubSapConfig = fbDb
    .collection('app_config')
    .doc('sap_integration')
    .onSnapshot(
      (snap) => {
        window.sapConfigCache = snap && snap.exists ? snap.data() || {} : {};
        // Reaccionar al toggle de auto-envio: activa o apaga el listener segun
        // window.sapConfigCache.autoSendSL. Tambien se reactiva si el admin recarga
        // las credenciales de SL.
        try {
          if (typeof ensureSapAutoSendListener === 'function') ensureSapAutoSendListener();
        } catch (_e) {}
        // Si el panel SAP esta abierto en la tab Config, refrescar.
        if (
          window.sapCurrentTab === 'config' &&
          document.getElementById('sap-modal').classList.contains('open')
        ) {
          try {
            renderSapConfig();
          } catch (_e) {}
        }
      },
      (err) => console.warn('sapConfig listener', err)
    );
}

function renderSapConfig() {
  const body = document.getElementById('sap-body');
  if (!body) return;
  if (userRole !== 'admin' && userRole !== 'viewer') {
    body.innerHTML =
      '<div style="padding:18px;color:#94a3b8;text-align:center">Solo admin/viewer pueden ver la configuracion de la integracion SAP.</div>';
    return;
  }
  const isAdmin = userRole === 'admin';
  const cfg = window.sapConfigCache || {};
  const seriesId = cfg.appSeriesId || '';
  const autoSendSL = !!cfg.autoSendSL;
  const updatedBy = cfg.updatedByEmail || '';
  const updatedAt =
    cfg.updatedAt && cfg.updatedAt.toDate ? cfg.updatedAt.toDate().toLocaleString('es-AR') : '';
  body.innerHTML =
    '<div style="padding:16px 20px;max-width:780px;margin:0 auto">' +
    '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;font-size:12px;color:#1e40af;margin-bottom:18px;line-height:1.6">' +
    '<b>Configuracion del flujo SAP B1 &raquo; Sales Order</b><br>' +
    'Estos valores se aplican al ZIP DTW que se genera desde &laquo;Pendientes&raquo;. Los UDFs <code>U_AppOrigen</code>, <code>U_AppOrderId</code> y <code>U_AppBatchId</code> ya se llenan automaticamente con cada export. Aca solo configuras la <b>serie numerica</b> que cargo Eliana.' +
    '</div>' +
    // --- Series APP ID ---
    '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:14px">' +
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#475569;margin-bottom:4px">Serie APP en SAP</div>' +
    '<div style="font-size:11px;color:#64748b;line-height:1.5;margin-bottom:10px">' +
    'Pedile a Eliana el <b>ID numerico</b> de la serie "APP" que creo para los pedidos importados desde la app (no el nombre &laquo;APP&raquo;, el numero/codigo asignado en la tabla NNM1). Si lo dejas vacio, DTW va a usar la serie default del usuario que importa.' +
    '</div>' +
    '<div class="sap-series-row" style="display:flex;gap:8px;align-items:center">' +
    '<input type="text" id="sap-app-series-input" placeholder="ej. 7" value="' +
    escapeAttr(seriesId) +
    '" ' +
    (isAdmin ? '' : 'disabled') +
    ' style="flex:1;padding:9px 12px;border:1.5px solid #cbd5e1;border-radius:6px;font-family:Consolas,monospace;font-size:14px;font-weight:700;color:#0c4a6e"/>' +
    (isAdmin
      ? '<button class="app-btn-pill app-btn-cyan sap-series-save-btn" onclick="saveSapAppSeries()">Guardar</button>'
      : '') +
    '</div>' +
    (updatedAt
      ? '<div style="margin-top:8px;font-size:10px;color:#94a3b8">Ultimo cambio: ' +
        escapeHtml(updatedAt) +
        ' por ' +
        escapeHtml(updatedBy) +
        '</div>'
      : '<div style="margin-top:8px;font-size:10px;color:#94a3b8;font-style:italic">Sin configurar todavia.</div>') +
    '</div>' +
    // --- Auto-envio via Service Layer ---
    '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:14px">' +
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#475569;margin-bottom:4px">Auto-envio a SAP via Service Layer</div>' +
    '<div style="font-size:11px;color:#64748b;line-height:1.5;margin-bottom:10px">' +
    'Si esta tildado, cada pedido que un vendedor <b>CONFIRMA</b> se manda automaticamente a SAP como Sales Quotation - sin tener que ir a Pendientes y tildar manualmente. <br><br>' +
    '<b>Requisitos para que funcione:</b><br>' +
    '&bull; Service Layer habilitado y conectado (tab anterior).<br>' +
    '&bull; Serie APP cargada arriba.<br>' +
    '&bull; CardCode SAP resuelto para el cliente (sino el pedido queda en Bloqueados).<br>' +
    '&bull; Al menos un admin con la app abierta - el listener corre desde su browser. Si nadie esta logueado como admin, los pedidos se acumulan en "Listos" hasta que alguien abra.' +
    '</div>' +
    '<label style="display:flex;align-items:center;gap:10px;cursor:' +
    (isAdmin ? 'pointer' : 'not-allowed') +
    ';font-size:12px;font-weight:700;color:#0f172a">' +
    '<input type="checkbox" id="sap-auto-send-input" ' +
    (autoSendSL ? 'checked' : '') +
    ' ' +
    (isAdmin ? 'onchange="saveSapAutoSend(this.checked)"' : 'disabled') +
    ' style="width:18px;height:18px;cursor:' +
    (isAdmin ? 'pointer' : 'not-allowed') +
    ';accent-color:#0d9488"/>' +
    (autoSendSL
      ? '&#9889; AUTO-ENVIO ACTIVO - los pedidos confirmados van directo a SAP'
      : 'Activar auto-envio') +
    '</label>' +
    '</div>' +
    // --- Constantes ---
    '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:14px">' +
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#475569;margin-bottom:8px">UDFs que se completan automaticamente</div>' +
    '<table style="width:100%;font-size:11px;border-collapse:collapse">' +
    '<tr style="background:#f8fafc"><td style="padding:7px 10px;font-family:Consolas,monospace;font-weight:700;color:#5b21b6;border-bottom:1px solid #e2e8f0">U_AppOrigen</td><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">Constante: <code>SHIMANO_APP_VENDEDORES</code></td></tr>' +
    '<tr><td style="padding:7px 10px;font-family:Consolas,monospace;font-weight:700;color:#5b21b6;border-bottom:1px solid #e2e8f0">U_AppOrderId</td><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">ID Firestore del pedido (~28 chars). Tambien se copia a <code>NumAtCard</code> como backup legible.</td></tr>' +
    '<tr style="background:#f8fafc"><td style="padding:7px 10px;font-family:Consolas,monospace;font-weight:700;color:#5b21b6">U_AppBatchId</td><td style="padding:7px 10px">ID unico del lote de export: <code>BATCH-YYYYMMDD-HHMMSS-XXXX</code>. Todos los pedidos de un mismo ZIP comparten este ID.</td></tr>' +
    '</table>' +
    '</div>' +
    // --- Sincronizar catalogo de productos desde SAP ---
    (function () {
      // Leer el estado actual del catalogo (async, pero para render inicial
      // usamos el listener). Aca leemos el ultimo apply de la sesion actual.
      let catalogInfo = '';
      if (typeof _lastAppliedCatalogBatch !== 'undefined' && _lastAppliedCatalogBatch) {
        catalogInfo =
          '<b style="color:#166534">&#10003; Catalogo sincronizado</b> - ' +
          (PRODUCTS ? PRODUCTS.length.toLocaleString('es-AR') : 0) +
          ' SKUs en memoria. Ultimo batch: <code>' +
          escapeHtml(String(_lastAppliedCatalogBatch)) +
          '</code>';
      } else {
        catalogInfo =
          'Sin sincronizar en esta sesion. El picker usa el catalogo hardcoded del HTML (' +
          (PRODUCTS ? PRODUCTS.length.toLocaleString('es-AR') : 0) +
          ' SKUs).';
      }
      return (
        '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:14px">' +
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#475569;margin-bottom:4px">Catalogo de productos</div>' +
        '<div style="font-size:11px;color:#64748b;line-height:1.5;margin-bottom:10px">' +
        'Descarga TODOS los items activos del maestro de articulos de SAP (Ventas &gt; Datos Maestros &gt; Articulos) y los guarda en Firestore. La app usa este catalogo en el picker de productos al crear pedidos. Corre cuando cargan articulos nuevos en SAP.' +
        '</div>' +
        '<div id="sap-catalog-status" style="font-size:11px;color:#64748b;margin-bottom:10px">' +
        catalogInfo +
        '</div>' +
        (isAdmin
          ? '<button class="app-btn-pill" style="background:#0d9488;color:#fff;padding:10px 18px;border:none;border-radius:6px;cursor:pointer;font-weight:800;text-transform:uppercase;letter-spacing:.3px;font-size:11px" onclick="syncSapCatalog()">&#128260; Sincronizar catalogo desde SAP</button>'
          : '<div style="font-size:11px;color:#94a3b8">Solo admin puede sincronizar</div>') +
        '</div>'
      );
    })() +
    // --- Estado integracion ---
    '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 14px;font-size:11px;color:#15803d;line-height:1.6">' +
    '<b>Checklist integracion SAP</b><br>' +
    '&#10003; UDFs creados en ORDR por Eliana (' +
    (Object.keys(cfg).length ? '11/06/2026' : '11/06/2026') +
    ')<br>' +
    '&#10003; Serie de numeracion <code>APP</code> creada por Eliana<br>' +
    '&#10003; 6 SlpCodes de vendedores cargados via Integracion SAP<br>' +
    (seriesId
      ? '&#10003; Series APP ID cargado: <b>' + escapeHtml(seriesId) + '</b><br>'
      : '&#9888;&#65039; <b>FALTA</b> cargar el Series APP ID (pedirselo a Eliana)<br>') +
    '&#9888;&#65040; Pendiente: prueba E2E con DTW en ambiente TEST.' +
    '</div>' +
    '</div>';
}

// Persistir el toggle de auto-envio Service Layer en app_config/sap_integration.
// Llamado por el onchange del checkbox. El listener (ensureSapAutoSendListener)
// se activa o desactiva via cambio en window.sapConfigCache.autoSendSL.
window.saveSapAutoSend = async function (checked) {
  if (userRole !== 'admin') return;
  try {
    await fbDb
      .collection('app_config')
      .doc('sap_integration')
      .set(
        {
          autoSendSL: !!checked,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByUid: currentUser.uid,
          updatedByEmail: currentUser.email || '',
        },
        { merge: true }
      );
    showSyncTag(checked ? 'Auto-envio SAP ACTIVADO' : 'Auto-envio SAP desactivado');
    try {
      logOp('sap_config_update', 'app_config/sap_integration', 'autoSendSL', {
        newValue: !!checked,
      });
    } catch (_e) {}
    // Re-render para refrescar la etiqueta del label.
    try {
      renderSapConfig();
    } catch (_e) {}
  } catch (e) {
    console.error('saveSapAutoSend', e);
    alert('No se pudo guardar el toggle. Verifica tu conexion.');
  }
};

window.saveSapAppSeries = async function () {
  if (userRole !== 'admin') return;
  const inp = document.getElementById('sap-app-series-input');
  const v = (inp.value || '').trim();
  if (v && !/^[0-9]+$/.test(v)) {
    alert(
      'El Series APP ID debe ser un numero entero (ej. 7). Si no estas seguro, pedile el valor exacto a Eliana.'
    );
    return;
  }
  try {
    await fbDb
      .collection('app_config')
      .doc('sap_integration')
      .set(
        {
          appSeriesId: v,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByUid: currentUser.uid,
          updatedByEmail: currentUser.email || '',
        },
        { merge: true }
      );
    showSyncTag('Configuracion SAP guardada');
    try {
      logOp('sap_config_update', 'app_config/sap_integration', 'appSeriesId', { newValue: v });
    } catch (_e) {}
  } catch (e) {
    console.error('saveSapAppSeries', e);
    alert('Error guardando: ' + (e.message || e));
  }
};

// ====================================================================
// Sincronizar catalogo de productos desde SAP via Service Layer
// ====================================================================
// Descarga TODOS los items activos de SAP y los guarda en Firestore
// para que la app los use en el picker de productos. Reemplaza items
// duplicados via merge inteligente: si un ItemCode ya esta en PRODUCTS
// local con familia/subfamilia/categoria, mantenemos esos campos.
// Si es nuevo, se agrega con esos campos vacios.
window.syncSapCatalog = async function () {
  if (userRole !== 'admin') return;
  if (typeof sapSL === 'undefined' || !sapSL.isEnabled || !sapSL.isEnabled()) {
    alert('Service Layer no esta habilitado. Configuralo en el tab Service Layer.');
    return;
  }
  if (
    !confirm(
      'Sincronizar catalogo de productos desde SAP?\n\nEsto puede tardar 10-30 segundos segun la cantidad de items. Los datos existentes se REEMPLAZAN por lo que este en SAP hoy.'
    )
  )
    return;
  const statusEl = document.getElementById('sap-catalog-status');
  const setStatus = (txt, color) => {
    if (!statusEl) return;
    statusEl.style.color = color || '#0284c7';
    statusEl.style.fontStyle = 'normal';
    statusEl.innerHTML = txt;
  };
  setStatus('&#9203; Conectando a Service Layer...');
  const sess = await sapSL.ensureSession();
  if (!sess.ok) {
    setStatus('&#10006; Error de sesion: ' + escapeHtml(sess.error || ''), '#dc2626');
    return;
  }
  setStatus('&#8681; Descargando items desde SAP...');
  const r = await sapSL.getAllItems((fetched) => {
    setStatus('&#8681; Descargando... ' + fetched.toLocaleString('es-AR') + ' items');
  });
  if (!r.ok) {
    setStatus('&#10006; Error descargando: ' + escapeHtml(r.error || ''), '#dc2626');
    return;
  }
  const slItems = r.items || [];
  setStatus(
    '&#128190; Guardando ' + slItems.length.toLocaleString('es-AR') + ' items en Firestore...'
  );
  // Merge inteligente con PRODUCTS local.
  const localMap = new Map();
  if (Array.isArray(PRODUCTS)) {
    PRODUCTS.forEach((p) => localMap.set(p.code, p));
  }
  const merged = slItems.map((it) => {
    const existing = localMap.get(it.ItemCode);
    return {
      code: it.ItemCode || '',
      desc: it.ItemName || '',
      fam: (existing && existing.fam) || '',
      sub: (existing && existing.sub) || '',
      cat: (existing && existing.cat) || '',
    };
  });
  // Chunkear en 3 docs (por si supera 1 MB). ~4000 items/chunk.
  const CHUNK = 4000;
  const chunks = [];
  for (let i = 0; i < merged.length; i += CHUNK) chunks.push(merged.slice(i, i + CHUNK));
  const syncBatchId = 'SYNC-' + Date.now();
  try {
    const batch = fbDb.batch();
    // Escribir cada chunk
    chunks.forEach((chunk, idx) => {
      const ref = fbDb.collection('product_catalog').doc('chunk_' + idx);
      batch.set(ref, {
        items: chunk,
        chunkIdx: idx,
        totalChunks: chunks.length,
        syncBatchId: syncBatchId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    // Limpiar chunks viejos que ya no aplican (si antes teniamos 5 chunks y
    // ahora tenemos 3, borrar 3 y 4). Chequeo con .get() previo.
    await batch.commit();
    // Metadata doc que dispara el listener en la app.
    await fbDb
      .collection('app_config')
      .doc('product_catalog_meta')
      .set({
        totalItems: merged.length,
        totalChunks: chunks.length,
        syncBatchId: syncBatchId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser.email || '',
      });
    // Cleanup asincrono de chunks huerfanos (chunks_N donde N >= totalChunks).
    (async () => {
      try {
        const snap = await fbDb.collection('product_catalog').get();
        const stale = snap.docs.filter((d) => {
          const idx = d.data() && d.data().chunkIdx;
          return idx == null || idx >= chunks.length;
        });
        for (const d of stale) {
          try {
            await d.ref.delete();
          } catch (_e) {}
        }
      } catch (e) {
        console.warn('[catalog] cleanup stale chunks', e);
      }
    })();
    setStatus(
      '&#10003; Sincronizado: ' +
        merged.length.toLocaleString('es-AR') +
        ' items en ' +
        chunks.length +
        ' chunks - ' +
        new Date().toLocaleString('es-AR'),
      '#166534'
    );
    try {
      logOp('sap_catalog_sync', 'product_catalog', syncBatchId, {
        totalItems: merged.length,
        totalChunks: chunks.length,
      });
    } catch (_e) {}
    showSyncTag('Catalogo sincronizado: ' + merged.length + ' SKUs');
  } catch (e) {
    console.error('syncSapCatalog', e);
    setStatus(
      '&#10006; Error guardando en Firestore: ' + escapeHtml(e.message || String(e)),
      '#dc2626'
    );
  }
};

// =====================================================================
// SECCIÓN: F3: buildEntregaSuffix + sapGetClienteCode + sapGetMaterialCode (inline L12494-12568)
// =====================================================================

// Devuelve un sufijo listo para pegar al final del string 'Comments' /
// 'Remarks' del Sales Quotation, con la info de forma de entrega elegida
// por el vendedor. Formato:
//   ' | Entrega TRANSPORTISTA: <nombre> - <direccion>'
//   ' | Entrega SUCURSAL: <direccion>'
//   ''  (si el pedido no tiene formaEntrega cargada, pedidos previos a v269)
//
// Se usa en dos lugares:
//  1) buildQuotationPayload (Service Layer) -> campo Comments
//  2) exportSapReadyCsv (DTW CSV OQUT) -> campo Comments
//
// Nota: cuando Ezequiel Mendoza (SEIDOR) cree los UDFs dedicados
// (U_FormaEntrega, U_TransportistaNombre, etc), reemplazar este sufijo
// por campos separados en el payload y sacar los datos del Remarks.
function buildEntregaSuffixForRemarks(pedido) {
  const fe = pedido && pedido.formaEntrega;
  if (!fe || !fe.tipo) return '';
  if (fe.tipo === 'TRANSPORTISTA') {
    const nombre = (fe.transpNombre || '').trim();
    const direccion = (fe.transpDireccion || '').trim();
    // v273+: si el pedido tiene direccion de entrega final al cliente,
    // la agregamos al Remarks para que el operador SAP la vea.
    const clienteDireccion = (fe.clienteDireccion || '').trim();
    if (!nombre && !direccion && !clienteDireccion) return ' | Entrega TRANSPORTISTA';
    let out = ' | Entrega TRANSPORTISTA: ' + nombre + (direccion ? ' - ' + direccion : '');
    if (clienteDireccion) out += ' | Entrega al cliente: ' + clienteDireccion;
    return out;
  }
  if (fe.tipo === 'SUCURSAL') {
    const direccion = (fe.sucursalDireccion || '').trim();
    return ' | Entrega SUCURSAL' + (direccion ? ': ' + direccion : '');
  }
  // v397 (2026-08-04): retiro en el deposito con datos del responsable +
  // patente del vehiculo -> van al Remarks del Sales Quotation para que
  // Deposito los tenga cuando el responsable retire.
  if (fe.tipo === 'RETIRO_DEPOSITO') {
    const nombre = (fe.retiroNombre || '').trim();
    const apellido = (fe.retiroApellido || '').trim();
    const dni = (fe.retiroDni || '').trim();
    const patente = (fe.retiroPatente || '').trim();
    const partes = [];
    if (nombre || apellido)
      partes.push('Responsable: ' + [nombre, apellido].filter(Boolean).join(' '));
    if (dni) partes.push('DNI: ' + dni);
    if (patente) partes.push('Patente: ' + patente);
    if (!partes.length) return ' | Entrega RETIRO_DEPOSITO';
    return ' | Entrega RETIRO EN DEPOSITO | ' + partes.join(' | ');
  }
  return ' | Entrega ' + String(fe.tipo);
}

function sapGetClienteCode(clientName) {
  // Fuente 1 (prioridad): sap_clients - mapeo manual cargado por admin
  // desde tab SAP > Mapeo Clientes o importado via Excel oficial de SAP.
  const v = window.sapClientsMap[sapNorm(clientName)];
  if (v && v.sapCode) return v.sapCode;
  // Fuente 2 (fallback): client_applications - altas aprobadas via "Alta
  // Clientes" o SAP import que recibieron CardCode. Sin este fallback,
  // un cliente recien dado de alta aparecia como "Bloqueado por alta" en
  // SAP > Pendientes aunque ya tuviera cardCodeSap asignado, porque el
  // mapeo manual no se hizo. Matcheamos por comercio | titular | fantasia
  // contra el clientName del pedido (uppercased + trim, ignora .SA/.SRL).
  if (typeof approvedAltasList !== 'undefined' && Array.isArray(approvedAltasList)) {
    const norm = sapNorm(clientName);
    for (const a of approvedAltasList) {
      if (!a || !a.cardCodeSap) continue;
      if (sapNorm(a.comercio || '') === norm) return a.cardCodeSap;
      if (sapNorm(a.titular || '') === norm) return a.cardCodeSap;
      if (sapNorm(a.fantasia || '') === norm) return a.cardCodeSap;
    }
  }
  return '';
}
function sapGetMaterialCode(productCode) {
  // 1) Si hay mapeo manual en sap_products (admin cargo correspondencia
  //    explicita), usarlo. Tiene precedencia absoluta.
  const v = window.sapProductsMap[productCode];
  if (v && v.sapMaterial) return v.sapMaterial;
  // 2) Verificacion automatica vs SAP de David: el 99% de los codigos son
  //    iguales en ambos sistemas. La unica diferencia detectada es que en el
  //    master de la app algunos codigos numericos tienen ceros a la izquierda
  //    (ej '032737') mientras que SAP los guarda sin padding ('32737').
  //    Si el codigo es puramente numerico, devolvemos el codigo sin ceros a
  //    la izquierda; sino devolvemos el codigo tal cual (matchea directo).
  if (!productCode) return '';
  const pc = String(productCode).trim();
  if (/^0+\d+$/.test(pc)) {
    return String(parseInt(pc, 10));
  }
  return pc;
}

// =====================================================================
// SECCIÓN: F4: renderSapServiceLayer + saveSl* + testSl* + enviar* + renderSapPedidos + renderPedidoCard + renderBloqueadoGroup + acciones + DTW consts + csvEscape (inline L12580-13189)
// =====================================================================

// ----- TAB: Service Layer (config + test) -----
function renderSapServiceLayer() {
  const body = document.getElementById('sap-body');
  if (!body) return;
  const cfg = sapSL.loadConfig();
  const enabled = !!cfg.enabled;
  let h = '<div style="padding:18px 22px;font-size:13px;color:#0f172a">';
  h +=
    '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;padding:14px;margin-bottom:18px;font-size:12px;color:#1e3a8a;line-height:1.6">';
  h += '<b>&#128279; Que es el Service Layer?</b><br>';
  h +=
    'Es la API REST oficial de SAP B1. Cuando esta habilitado, la app envia los pedidos confirmados directamente a SAP como Sales Quotations (sin ZIP DTW), y consulta stock en tiempo real para el indicador verde/rojo del picker.<br><br>';
  h +=
    '<b>&#9888; Importante:</b> el ZIP DTW manual sigue funcionando como respaldo. Si Service Layer falla o esta desactivado, los vendedores y vos pueden seguir operando con el flujo manual.';
  h += '</div>';
  // Toggle de habilitacion + estado
  h +=
    '<div style="display:flex;align-items:center;gap:14px;padding:14px;background:' +
    (enabled ? '#dcfce7' : '#fef3c7') +
    ';border:1.5px solid ' +
    (enabled ? '#86efac' : '#fcd34d') +
    ';border-radius:8px;margin-bottom:18px">';
  h +=
    '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;font-weight:700;color:' +
    (enabled ? '#166534' : '#92400e') +
    '">';
  h +=
    '<input type="checkbox" id="sl-enabled" ' +
    (enabled ? 'checked' : '') +
    ' style="width:18px;height:18px;cursor:pointer"/>';
  h +=
    '<span>' +
    (enabled
      ? '&#10003; Service Layer HABILITADO - los pedidos van directo a SAP'
      : '&#9888; Service Layer DESHABILITADO - los pedidos siguen yendo por ZIP DTW manual') +
    '</span>';
  h += '</label>';
  h += '</div>';
  // Form de configuracion
  h +=
    '<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin:18px 0 10px">Datos de conexion</h4>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  h +=
    '<div><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">URL del Service Layer</label>';
  h +=
    '<input id="sl-url" type="text" placeholder="https://shimano-sap.seidor.com.ar:50000" value="' +
    escapeAttr(cfg.url || 'https://shimano-sap.seidor.com.ar:50000') +
    '" style="width:100%;padding:8px 10px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:12px;font-family:Consolas,monospace"/></div>';
  h +=
    '<div><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Company DB</label>';
  h +=
    '<input id="sl-company" type="text" placeholder="SHIMANO_SAU" value="' +
    escapeAttr(cfg.companyDB || 'SHIMANO_SAU') +
    '" style="width:100%;padding:8px 10px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:12px;font-family:Consolas,monospace"/></div>';
  h +=
    '<div><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Usuario (UserName)</label>';
  h +=
    '<input id="sl-user" type="text" placeholder="APP_VENDEDORES" value="' +
    escapeAttr(cfg.username) +
    '" style="width:100%;padding:8px 10px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:12px;font-family:Consolas,monospace"/></div>';
  h +=
    '<div><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:4px">Password</label>';
  h +=
    '<input id="sl-pass" type="password" placeholder="..." value="' +
    escapeAttr(cfg.password) +
    '" style="width:100%;padding:8px 10px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:12px;font-family:Consolas,monospace"/></div>';
  h += '</div>';
  h +=
    '<div style="font-size:10px;color:#94a3b8;margin-top:8px"><b>Seguridad:</b> la password se guarda en Firestore con merge - solo admin puede leerla. Cuando este la integracion al 100%, vamos a mover esto a una variable de entorno encriptada.</div>';
  // Botones - clase sl-actions para poder aplicar media query mobile
  // (all 100% width + apilados) sin tocar el desktop.
  h += '<div class="sl-actions" style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">';
  h +=
    '<button class="sap-btn primary" style="background:#0284c7" onclick="saveSlConfig()">&#128190; Guardar configuracion</button>';
  h +=
    '<button class="sap-btn" style="background:#fff;border:1.5px solid #cbd5e1;color:#475569" onclick="testSlConnection()">&#128268; Probar conexion (Login)</button>';
  h +=
    '<button class="sap-btn" style="background:#fff;border:1.5px solid #cbd5e1;color:#475569" onclick="testSlStock()">&#128230; Probar stock SKU prueba</button>';
  h += '</div>';
  h += '<div id="sl-test-result" style="margin-top:14px"></div>';
  body.innerHTML = h;
}

window.saveSlConfig = async function () {
  if (userRole !== 'admin') {
    alert('Solo admin puede guardar.');
    return;
  }
  const sl = {
    enabled: document.getElementById('sl-enabled').checked,
    url: document.getElementById('sl-url').value.trim(),
    companyDB: document.getElementById('sl-company').value.trim(),
    username: document.getElementById('sl-user').value.trim(),
    password: document.getElementById('sl-pass').value,
  };
  if (sl.enabled && (!sl.url || !sl.companyDB || !sl.username)) {
    alert('Si vas a habilitar Service Layer, completá URL + CompanyDB + Usuario al menos.');
    return;
  }
  try {
    await fbDb
      .collection('app_config')
      .doc('sap_integration')
      .set(
        {
          serviceLayer: sl,
          serviceLayerUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          serviceLayerUpdatedBy: currentUser.email || '',
        },
        { merge: true }
      );
    showSyncTag('Config Service Layer guardada');
    // Forzar reload de la config en el cliente
    sapSL.sessionAt = 0;
    sapSL.loadConfig();
  } catch (e) {
    console.error('saveSlConfig', e);
    alert('Error guardando: ' + (e.message || e));
  }
};

window.testSlConnection = async function () {
  const out = document.getElementById('sl-test-result');
  out.innerHTML =
    '<div style="background:#dbeafe;border:1px solid #93c5fd;color:#1e3a8a;border-radius:5px;padding:10px;font-size:12px">Conectando al Service Layer...</div>';
  // Asegurarnos de guardar antes de probar
  await saveSlConfig();
  sapSL.sessionAt = 0;
  const r = await sapSL.login();
  if (r.ok) {
    out.innerHTML =
      '<div style="background:#dcfce7;border:1.5px solid #86efac;color:#166534;border-radius:5px;padding:12px;font-size:12px"><b>&#10003; Login OK</b><br>La cookie de sesion quedo seteada en el browser. Las proximas requests van a usarla automaticamente.</div>';
  } else {
    out.innerHTML =
      '<div style="background:#fee2e2;border:1.5px solid #fca5a5;color:#991b1b;border-radius:5px;padding:12px;font-size:12px"><b>&#10006; Error de login</b><br>' +
      escapeHtml(r.error || 'desconocido') +
      '<br><br><b>Causas frecuentes:</b><br>&middot; CORS no habilitado en el server (pedir a Alejandro Caracchi).<br>&middot; Credenciales mal cargadas.<br>&middot; CompanyDB incorrecta (debe ser exactamente SHIMANO_SAU).<br>&middot; Usuario sin licencia para acceder via Service Layer.</div>';
  }
};

window.testSlStock = async function () {
  const out = document.getElementById('sl-test-result');
  const sku = prompt('SKU a consultar (ej. CAC58MH2UR):', 'CAC58MH2UR');
  if (!sku) return;
  out.innerHTML =
    '<div style="background:#dbeafe;border:1px solid #93c5fd;color:#1e3a8a;border-radius:5px;padding:10px;font-size:12px">Consultando stock de ' +
    escapeHtml(sku) +
    ' en TODOS los depositos vendibles...</div>';
  const r = await sapSL.getStock(sku.trim(), 'ALL');
  if (r.ok) {
    // Armar detalle por whs para mostrar de donde sale el total.
    let breakdown = '';
    if (r.byWhs && typeof r.byWhs === 'object') {
      const rows = Object.entries(r.byWhs)
        .filter(([_w, q]) => q > 0)
        .map(([w, q]) => 'W' + w + ': ' + q)
        .join(' &middot; ');
      if (rows)
        breakdown =
          '<br><small style="color:#166534">Desglose (whs con stock): ' + rows + '</small>';
      const excl = Object.entries(r.byWhs).filter(([w, q]) => q > 0 && !sapSL._isSalesWarehouse(w));
      if (excl.length)
        breakdown +=
          '<br><small style="color:#92400e">Excluidos (Marketing/Devoluciones): ' +
          excl.map(([w, q]) => 'W' + w + ': ' + q).join(' &middot; ') +
          '</small>';
    }
    out.innerHTML =
      '<div style="background:#dcfce7;border:1.5px solid #86efac;color:#166534;border-radius:5px;padding:12px;font-size:13px"><b>&#10003; Stock obtenido</b><br>SKU: <code>' +
      escapeHtml(sku) +
      '</code><br>Total vendible: <b>' +
      r.qty +
      '</b> unidades' +
      breakdown +
      '</div>';
  } else {
    out.innerHTML =
      '<div style="background:#fee2e2;border:1.5px solid #fca5a5;color:#991b1b;border-radius:5px;padding:12px;font-size:12px"><b>&#10006; Error consultando stock</b><br>' +
      escapeHtml(r.error || 'desconocido') +
      '</div>';
  }
};

// Handler del boton "Enviar a SAP via Service Layer" del tab Pendientes.
// Toma los pedidos tildados (sapPendSelection) que sean LISTOS (con CardCode
// asignado), valida que SL este habilitado, los manda uno por uno y muestra
// el resultado. Solo admin/gerente. Despues del envio el listener de
// pedidos actualiza globalPedidos y el render se refresca automaticamente.
window.enviarSeleccionadosViaSL = async function () {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede enviar pedidos a SAP.');
    return;
  }
  if (typeof sapSL === 'undefined' || typeof sapSL.isEnabled !== 'function') {
    alert('Modulo Service Layer no cargado. Recarga la app.');
    return;
  }
  if (!sapSL.isEnabled()) {
    alert(
      'Service Layer no esta habilitado. Activalo en panel SAP > Service Layer y volve a intentar.'
    );
    return;
  }
  if (!sapPendSelection.size) {
    alert('No hay pedidos seleccionados.');
    return;
  }
  // Filtrar los seleccionados que esten en LISTOS (con CardCode resuelto).
  // Bloqueados no se mandan - no tienen CardCode todavia.
  const allConfirmed = (globalPedidos || []).filter((p) => p.stage === 'confirmed');
  const selected = allConfirmed.filter((p) => sapPendSelection.has(p._fsId));
  const conCard = selected.filter((p) => sapGetClienteCode(p.clientName));
  const sinCard = selected.length - conCard.length;
  if (!conCard.length) {
    alert(
      'Ninguno de los pedidos seleccionados tiene CardCode SAP. Asigna codigos primero o desmarca los bloqueados.'
    );
    return;
  }
  const msg =
    'Enviar ' +
    conCard.length +
    ' pedido(s) a SAP via Service Layer?' +
    (sinCard > 0
      ? '\n\nNota: ' + sinCard + ' seleccionado(s) sin CardCode quedaran sin enviar.'
      : '');
  if (!confirm(msg)) return;
  if (typeof showSyncTag === 'function') showSyncTag('Enviando ' + conCard.length + ' a SAP...');
  const r = await enviarPedidosASAPViaServiceLayer(conCard);
  let detail = 'Enviados OK: ' + r.sent + '\nFallaron: ' + r.failed;
  if (r.failed > 0 && r.errors && r.errors.length) {
    detail +=
      '\n\nErrores:\n' +
      r.errors
        .slice(0, 5)
        .map((e) => '- ' + (e.cliente || e.pedido) + ': ' + e.error)
        .join('\n');
    if (r.errors.length > 5) detail += '\n... ' + (r.errors.length - 5) + ' mas.';
  }
  alert(detail);
  // Limpiar seleccion y re-render. El listener de pedidos refrescara solo
  // pero forzamos un re-render por timing.
  sapPendSelection.clear();
  setTimeout(() => {
    try {
      renderSapPedidos();
    } catch (_e) {}
  }, 250);
};

// ----- Wrapper de envio: elige Service Layer o ZIP DTW segun config -----
// Recibe la lista de pedidos "Listos para SAP" y los envia uno por uno por
// la via configurada. Si SL falla, NO cae automaticamente al DTW (admin
// decide). Devuelve {sent, failed, errors}.
window.enviarPedidosASAPViaServiceLayer = async function (pedidos) {
  if (!Array.isArray(pedidos) || !pedidos.length) return { sent: 0, failed: 0, errors: [] };
  if (!sapSL.isEnabled()) {
    alert(
      'Service Layer no esta habilitado. Activalo en panel SAP > Service Layer, o exporta el ZIP DTW como siempre.'
    );
    return { sent: 0, failed: 0, errors: ['Service Layer deshabilitado'] };
  }
  const errors = [];
  let sent = 0;
  const skipped = [];
  // v385: crypto.randomUUID() en vez de Math.random() para no gatillar
  // CodeQL "insecure randomness" (mismo fix de v384 en sap-auto-send-listener.js).
  // Uso NO criptográfico: session ID para lock cross-session en runTransaction
  // de Firestore; la entropía de 128 bits de UUID es superflua pero elimina
  // el alert legítimamente (mejor práctica, no supresión).
  const mySessionId =
    ((currentUser && currentUser.uid) || 'anon') +
    '-manual-' +
    Date.now() +
    '-' +
    crypto.randomUUID().slice(0, 8);
  for (const p of pedidos) {
    const docRef = fbDb.collection('pedidos').doc(p._fsId);
    // v344+ (2026-07-28): FIX DUPLICADOS. Igual que el auto-send listener,
    // aca tambien reservamos con transaction para prevenir carrera contra el
    // auto-send corriendo en OTRA sesion (o el mismo tab despues del F5).
    let lockAcquired = false;
    try {
      await fbDb.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) throw new Error('DOC_GONE');
        const data = snap.data() || {};
        if (data.transferidoSAP) throw new Error('ALREADY_SENT');
        if (data.sendingSapLock && data.sendingSapLock.at) {
          const lockAgeMs = Date.now() - data.sendingSapLock.at;
          if (lockAgeMs < 60000)
            throw new Error('OTHER_SESSION_LOCK:' + (data.sendingSapLock.sessionId || 'unknown'));
        }
        tx.update(docRef, { sendingSapLock: { sessionId: mySessionId, at: Date.now() } });
      });
      lockAcquired = true;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (msg === 'ALREADY_SENT') {
        skipped.push({ pedido: p._fsId, cliente: p.clientName, motivo: 'ya enviado' });
        continue;
      }
      if (msg.startsWith('OTHER_SESSION_LOCK')) {
        skipped.push({
          pedido: p._fsId,
          cliente: p.clientName,
          motivo: 'lockeado por otra sesion',
        });
        continue;
      }
      errors.push({ pedido: p._fsId, cliente: p.clientName, error: 'reserva fallo: ' + msg });
      continue;
    }
    const payload = sapSL.buildQuotationPayload(p);
    const r = await sapSL.createQuotation(payload);
    if (r.ok) {
      sent++;
      // Marcar el pedido como transferido a SAP en Firestore
      try {
        await docRef.update({
          // Mantener stage='confirmed' para que el pedido siga apareciendo
          // en Pedidos > Confirmados. El campo transferidoSAP.transferredAt
          // es el que SAP > Ya Transferidos usa como filtro.
          transferidoSAP: {
            via: 'service_layer',
            docEntry: r.body.DocEntry || null,
            docNum: r.body.DocNum || null,
            transferredAt: new Date().toISOString(),
            transferredBy: currentUser.email || '',
            sapDocRange: String(r.body.DocNum || ''),
            batchId: 'SL-' + Date.now(),
          },
          sendingSapLock: firebase.firestore.FieldValue.delete(),
        });
      } catch (e) {
        console.warn('No pude marcar pedido como transferido', p._fsId, e);
      }
    } else {
      // Liberar lock para permitir reintento.
      if (lockAcquired) {
        try {
          await docRef.update({ sendingSapLock: firebase.firestore.FieldValue.delete() });
        } catch (_) {}
      }
      errors.push({ pedido: p._fsId, cliente: p.clientName, error: r.error });
    }
  }
  return { sent, failed: errors.length, errors, skipped };
};

// ----- TAB: Pendientes / Transferidos -----
function renderSapPedidos() {
  const isPend = window.sapCurrentTab === 'pendientes';
  const search = isPend ? sapPendienteSearch : sapTransferidoSearch;
  // Vendedor solo ve sus propios pedidos en el panel SAP.
  // Admin / viewer ven todos.
  let allConfirmed = (globalPedidos || []).filter((p) => p.stage === 'confirmed');
  if (userRole === 'vendedor' && currentUser) {
    allConfirmed = allConfirmed.filter((p) => p.ownerUid === currentUser.uid);
  }
  const matching = allConfirmed.filter((p) => {
    const hasSAP = !!(p.transferidoSAP && p.transferidoSAP.transferredAt);
    if (isPend && hasSAP) return false;
    if (!isPend && !hasSAP) return false;
    if (search) {
      const q = sapNorm(search);
      if (
        !(
          sapNorm(p.clientName).includes(q) ||
          sapNorm(p.locName).includes(q) ||
          sapNorm(p.province).includes(q) ||
          sapNorm(p.ownerEmail).includes(q)
        )
      )
        return false;
    }
    return true;
  });
  matching.sort((a, b) => {
    if (isPend)
      return (a.finalizedAt || a.confirmedAt || '').localeCompare(
        b.finalizedAt || b.confirmedAt || ''
      );
    return (b.transferidoSAP.transferredAt || '').localeCompare(
      a.transferidoSAP.transferredAt || ''
    );
  });

  // Separa Listos (con CardCode SAP) vs Bloqueados (sin alta) - solo en pendientes
  const listos = [];
  const bloqueados = [];
  if (isPend) {
    matching.forEach((p) => {
      if (sapGetClienteCode(p.clientName)) listos.push(p);
      else bloqueados.push(p);
    });
  }
  // Agrupa bloqueados por tienda
  const bloqueadosByTienda = {};
  bloqueados.forEach((p) => {
    const k = p.clientName || '-';
    if (!bloqueadosByTienda[k])
      bloqueadosByTienda[k] = {
        tienda: k,
        loc: p.locName || '',
        prov: p.province || '',
        pedidos: [],
      };
    bloqueadosByTienda[k].pedidos.push(p);
  });

  // Limpia selecciones que ya no apliquen al render actual. Antes solo
  // chequeaba listos -> al tildar un BLOQUEADO el id se borraba del Set
  // en el siguiente render y el checkbox volvia a quedar sin tildar.
  // Ahora aceptamos cualquier pedido visible (listos + bloqueados).
  if (isPend) {
    const visibleIds = new Set();
    listos.forEach((p) => visibleIds.add(p._fsId));
    bloqueados.forEach((p) => visibleIds.add(p._fsId));
    [...sapPendSelection].forEach((id) => {
      if (!visibleIds.has(id)) sapPendSelection.delete(id);
    });
  }

  // Stats
  const totalUnits = matching.reduce(
    (s, p) => s + (p.lines || []).reduce((ss, l) => ss + (parseFloat(l.qty) || 0), 0),
    0
  );
  const totalArs = matching.reduce(
    (s, p) =>
      s +
      (p.lines || []).reduce(
        (ss, l) => ss + (parseFloat(l.qty) || 0) * (parseFloat(l.precio) || 0),
        0
      ),
    0
  );

  let html = '';
  html += '<div class="sap-info">';
  if (isPend) {
    if (userRole === 'vendedor') {
      html +=
        '<b>Tus pedidos confirmados listos para SAP.</b> Marca los que vas a subir, toca <b>Exportar ZIP DTW</b> y subi los 2 CSV via SAP B1 Data Transfer Workbench. Despues volve aca y marcalos como transferidos. Los <b>Bloqueados</b> esperan que Mariano (admin) le de alta al cliente en SAP B1.';
    } else {
      html +=
        '<b>Flujo de carga a SAP B1.</b> Los pedidos <b>Listos</b> tienen el CardCode SAP asignado y pueden exportarse via DTW. Los <b>Bloqueados</b> esperan que Admin/Finanzas de alta el cliente en SAP B1; cuando lo activen, asignales el CardCode inline (1 input por tienda, 5 segundos) y los pedidos pasan automaticamente a Listos.';
    }
  } else {
    html +=
      '<b>Pedidos ya transferidos a SAP.</b> Solo lectura. Si por error marcaste un pedido como transferido y queres revertir, usa el boton "Revertir" del card.';
  }
  html += '</div>';

  html += '<div class="sap-stats">';
  if (isPend) {
    html +=
      '<div class="sap-stat ok"><div class="n">' +
      listos.length +
      '</div><div class="l">Listos p/ SAP</div></div>';
    html +=
      '<div class="sap-stat warn"><div class="n">' +
      bloqueados.length +
      '</div><div class="l">Bloqueados</div></div>';
    html +=
      '<div class="sap-stat"><div class="n">' +
      Object.keys(bloqueadosByTienda).length +
      '</div><div class="l">Tiendas sin alta</div></div>';
    html +=
      '<div class="sap-stat"><div class="n">' +
      Math.round(totalUnits).toLocaleString('es-AR') +
      '</div><div class="l">Unidades</div></div>';
    html +=
      '<div class="sap-stat ok"><div class="n">$' +
      Math.round(totalArs).toLocaleString('es-AR') +
      '</div><div class="l">Total ARS</div></div>';
  } else {
    html +=
      '<div class="sap-stat"><div class="n">' +
      matching.length +
      '</div><div class="l">Pedidos</div></div>';
    html +=
      '<div class="sap-stat"><div class="n">' +
      Math.round(totalUnits).toLocaleString('es-AR') +
      '</div><div class="l">Unidades</div></div>';
    html +=
      '<div class="sap-stat ok"><div class="n">$' +
      Math.round(totalArs).toLocaleString('es-AR') +
      '</div><div class="l">Total ARS</div></div>';
  }
  html += '</div>';

  html += '<div class="sap-row-actions">';
  html +=
    '<input class="sap-search" type="search" id="sap-pedidos-search" placeholder="Buscar por cliente, localidad, vendedor..." value="' +
    escapeHtml(search) +
    '" oninput="onSapPedidosSearch(this.value)"/>';
  if (isPend) {
    // Vendedor tambien marca sus pedidos como transferidos (es el responsable de subirlos via DTW).
    const canTransfer =
      (userRole === 'admin' || userRole === 'vendedor') && sapPendSelection.size > 0;
    // Boton para enviar via Service Layer (auto, sin DTW). Solo aparece si
    // el admin habilito SL en panel SAP > Service Layer y hay seleccion.
    const slEnabled =
      typeof sapSL !== 'undefined' && typeof sapSL.isEnabled === 'function' && sapSL.isEnabled();
    if (slEnabled && (userRole === 'admin' || userRole === 'gerente')) {
      const canSL = sapPendSelection.size > 0;
      html +=
        '<button class="sap-btn success" onclick="enviarSeleccionadosViaSL()"' +
        (canSL ? '' : ' disabled') +
        ' style="background:#0d9488" title="Envia los pedidos seleccionados directo a SAP via Service Layer como Sales Quotation. Sin DTW manual.">&#9889; Enviar a SAP via Service Layer (' +
        sapPendSelection.size +
        ')</button>';
    }
    html +=
      '<button class="sap-btn secondary" onclick="exportSapReadyCsv()" title="Genera ZIP con 2 CSV en formato oficial DTW: OQUT - Documents.csv (cabecera Sales Quotation) + QUT1 - Document_Lines.csv (lineas). Listo para importar en DTW.">Exportar ZIP DTW (Listos)</button>';
    html +=
      '<button class="sap-btn success" onclick="marcarLoteTransferido()"' +
      (canTransfer ? '' : ' disabled') +
      '>Marcar lote como transferido (' +
      sapPendSelection.size +
      ')</button>';
    // Boton de borrado (solo admin / gerente). Util para limpiar pedidos
    // de prueba sin tener que ir uno por uno.
    if (userRole === 'admin' || userRole === 'gerente') {
      const canDelete = sapPendSelection.size > 0;
      html +=
        '<button class="sap-btn" style="background:' +
        (canDelete ? '#dc2626' : '#94a3b8') +
        ';color:#fff;border:none" onclick="deleteSelectedPedidos()"' +
        (canDelete ? '' : ' disabled') +
        ' title="Borra los pedidos seleccionados de Firestore. Accion irreversible. Util para limpiar pedidos de prueba.">&#128465; Eliminar seleccionados (' +
        sapPendSelection.size +
        ')</button>';
    }
  } else {
    html +=
      '<button class="sap-btn secondary" onclick="exportSapReadyCsv()">Exportar CSV historico</button>';
    // Boton de borrado masivo tambien en Ya transferidos (admin / gerente).
    // Misma logica: usa sapPendSelection y deleteSelectedPedidos.
    if (userRole === 'admin' || userRole === 'gerente') {
      const canDelete = sapPendSelection.size > 0;
      html +=
        '<button class="sap-btn" style="background:' +
        (canDelete ? '#dc2626' : '#94a3b8') +
        ';color:#fff;border:none" onclick="deleteSelectedPedidos()"' +
        (canDelete ? '' : ' disabled') +
        ' title="Borra los pedidos seleccionados. Irreversible. Util para limpiar pedidos de prueba ya transferidos.">&#128465; Eliminar seleccionados (' +
        sapPendSelection.size +
        ')</button>';
    }
  }
  html += '</div>';

  if (isPend) {
    // === SECCION LISTOS ===
    html +=
      '<div class="sap-section-head"><span class="sec-title ok">&#10003; Listos para SAP</span><span class="sec-meta">' +
      listos.length +
      ' pedido' +
      (listos.length === 1 ? '' : 's') +
      ' con CardCode asignado</span></div>';
    if (!listos.length) {
      html +=
        '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:18px">Ningun pedido listo todavia. Asigna codigos SAP a las tiendas en la seccion de abajo y van a aparecer aca automaticamente.</div>';
    } else {
      listos.forEach((p) => {
        html += renderPedidoCard(p, 'listo');
      });
    }
    // === SECCION BLOQUEADOS ===
    html +=
      '<div class="sap-section-head" style="margin-top:24px"><span class="sec-title warn">&#9888; Bloqueados por alta de cliente</span><span class="sec-meta">' +
      bloqueados.length +
      ' pedido' +
      (bloqueados.length === 1 ? '' : 's') +
      ' en ' +
      Object.keys(bloqueadosByTienda).length +
      ' tienda' +
      (Object.keys(bloqueadosByTienda).length === 1 ? '' : 's') +
      ' sin CardCode</span></div>';
    if (!bloqueados.length) {
      html +=
        '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:18px">No hay tiendas pendientes de alta. Todo cliente con pedido confirmado ya tiene CardCode asignado.</div>';
    } else {
      Object.values(bloqueadosByTienda)
        .sort((a, b) => b.pedidos.length - a.pedidos.length)
        .forEach((g) => {
          html += renderBloqueadoGroup(g);
        });
    }
  } else {
    if (!matching.length) {
      html +=
        '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:30px">Aun no hay pedidos transferidos a SAP.</div>';
    } else {
      matching.forEach((p) => {
        html += renderPedidoCard(p, 'transferido');
      });
    }
  }

  document.getElementById('sap-body').innerHTML = html;
}

function renderPedidoCard(p, status) {
  // status: 'listo' | 'transferido'
  const cliSap = sapGetClienteCode(p.clientName);
  let cardClass = 'sap-card';
  if (status === 'listo') cardClass += ' listo';
  else if (status === 'transferido') cardClass += ' transferido';

  let html = '<div class="' + cardClass + '">';
  html += '<div class="sap-card-head"><div>';
  // Checkbox: en listos para admin/vendedor (marcar como transferido) y en
  // cualquier estado para admin/gerente (borrado masivo).
  const showCheck =
    (status === 'listo' && (userRole === 'admin' || userRole === 'vendedor')) ||
    (status === 'transferido' && (userRole === 'admin' || userRole === 'gerente'));
  if (showCheck) {
    const checked = sapPendSelection.has(p._fsId) ? ' checked' : '';
    html +=
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" class="sap-pend-check" onchange="togglePedidoSelection(\'' +
      p._fsId +
      '\')"' +
      checked +
      '/><span class="sap-card-title">' +
      escapeHtml(p.clientName || '-') +
      '</span></label>';
  } else {
    html += '<div class="sap-card-title">' + escapeHtml(p.clientName || '-') + '</div>';
  }
  const sapCliTag = cliSap
    ? '<span class="sap-code-tag mapped">SAP: ' + escapeHtml(cliSap) + '</span>'
    : '<span class="sap-code-tag missing">SAP: SIN ALTA</span>';
  html +=
    '<div class="sap-card-meta">' +
    escapeHtml(p.locName || '') +
    ' &middot; ' +
    escapeHtml(p.province || '') +
    ' &middot; ' +
    escapeHtml(p.ownerEmail || '') +
    ' &middot; ' +
    sapCliTag +
    '</div>';
  html += '</div>';
  let stTag;
  if (status === 'listo') stTag = '<span class="sap-tag listo">Listo</span>';
  else if (status === 'transferido') {
    const isManual = p.transferidoSAP && p.transferidoSAP.manual;
    stTag = isManual
      ? '<span class="sap-tag manual">Manual</span>'
      : '<span class="sap-tag transferido">Transferido</span>';
  }
  html += '<div>' + stTag + '</div></div>';

  const lines = p.lines || [];
  const totUnits = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
  const totMon = lines.reduce(
    (s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.precio) || 0),
    0
  );
  // v605 E5: contar SKUs UNICOS (no lineas). Ver comment en L1401 para contexto.
  const _uniqueSkusCount = new Set(lines.map((l) => l && l.code).filter(Boolean)).size;
  html +=
    '<div class="sap-card-meta">' +
    (p.month || '-') +
    ' &middot; ' +
    _uniqueSkusCount +
    ' SKU' +
    (_uniqueSkusCount === 1 ? '' : 's') +
    ' &middot; ' +
    Math.round(totUnits) +
    ' uds &middot; $' +
    Math.round(totMon).toLocaleString('es-AR') +
    '</div>';

  // Condicion de pago (UDF U_TipoGasto en SAP). Mostrar siempre que exista
  // en el pedido, para que Santiago la vea antes de aprobar/exportar.
  if (p.condicionPago) {
    const condColor =
      p.condicionPago === 'CONTADO' || p.condicionPago === 'CHEQUE'
        ? '#16A34A'
        : p.condicionPago === 'CTA CTE'
          ? '#0284C7'
          : p.condicionPago === 'VTA ESP'
            ? '#7C3AED'
            : '#475569';
    html +=
      '<div class="sap-card-meta" style="margin-top:4px"><span style="background:' +
      condColor +
      ';color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.3px">PAGO: ' +
      escapeHtml(p.condicionPago) +
      '</span></div>';
  }

  if (status === 'transferido' && p.transferidoSAP) {
    const ts = p.transferidoSAP;
    html += '<div class="sap-card-meta" style="margin-top:4px;color:#065f46;font-weight:600">';
    html +=
      'Transferido: ' +
      (ts.transferredAt ? new Date(ts.transferredAt).toLocaleString('es-AR') : '');
    if (ts.transferredBy) html += ' por ' + escapeHtml(ts.transferredBy);
    if (ts.batchId) html += ' &middot; Lote: ' + escapeHtml(ts.batchId);
    if (ts.sapDocRange) html += ' &middot; SAP doc: ' + escapeHtml(ts.sapDocRange);
    html += '</div>';
  }

  html += '<div class="sap-card-lines">';
  lines.forEach((l) => {
    const matSap = sapGetMaterialCode(l.code);
    const matTag = matSap
      ? '<span class="sap-code-tag mapped">' + escapeHtml(matSap) + '</span>'
      : '<span class="sap-code-tag missing">SIN MAPEAR</span>';
    html +=
      '<div class="sap-card-line"><span><b>' +
      escapeHtml(l.code || '') +
      '</b> &middot; ' +
      escapeHtml(l.desc || '') +
      ' &middot; ' +
      (parseFloat(l.qty) || 0) +
      ' x $' +
      (parseFloat(l.precio) || 0).toLocaleString('es-AR') +
      '</span>' +
      matTag +
      '</div>';
  });
  html += '</div>';

  if (status === 'transferido' && userRole === 'admin') {
    html +=
      '<div style="text-align:right;margin-top:8px"><button class="sap-btn secondary" style="padding:6px 12px;font-size:10px" onclick="revertirTransferenciaSap(\'' +
      p._fsId +
      '\')">Revertir</button></div>';
  }
  html += '</div>';
  return html;
}

function renderBloqueadoGroup(g) {
  const totUnits = g.pedidos.reduce(
    (s, p) => s + (p.lines || []).reduce((ss, l) => ss + (parseFloat(l.qty) || 0), 0),
    0
  );
  const totMon = g.pedidos.reduce(
    (s, p) =>
      s +
      (p.lines || []).reduce(
        (ss, l) => ss + (parseFloat(l.qty) || 0) * (parseFloat(l.precio) || 0),
        0
      ),
    0
  );
  const tiendaJson = JSON.stringify(g.tienda).replace(/"/g, '&quot;');
  const inputId = 'sap-assign-' + sapNorm(g.tienda).replace(/[^A-Z0-9]/g, '_');

  let html = '<div class="sap-bloqueado-group">';
  html += '<div class="sap-bloqueado-head"><div>';
  html += '<div class="sap-bloqueado-title">' + escapeHtml(g.tienda) + '</div>';
  html +=
    '<div class="sap-card-meta">' +
    escapeHtml(g.loc) +
    ' &middot; ' +
    escapeHtml(g.prov) +
    ' &middot; ' +
    g.pedidos.length +
    ' pedido' +
    (g.pedidos.length === 1 ? '' : 's') +
    ' &middot; ' +
    Math.round(totUnits) +
    ' uds &middot; $' +
    Math.round(totMon).toLocaleString('es-AR') +
    '</div>';
  html += '</div>';
  html += '<span class="sap-tag pendiente">Sin alta SAP</span></div>';

  if (userRole === 'admin') {
    html += '<div class="sap-assign-row">';
    html += '<label>CardCode SAP:</label>';
    html +=
      '<input id="' +
      inputId +
      '" placeholder="ej. C20053996761" onkeydown="if(event.key===\'Enter\') this.blur()" onblur="assignClienteSAPInline(' +
      tiendaJson +
      ', this.value, this)"/>';
    html +=
      '<span style="font-size:10px;color:#78350f">Al asignarlo, los ' +
      g.pedidos.length +
      ' pedido' +
      (g.pedidos.length === 1 ? '' : 's') +
      ' pasa' +
      (g.pedidos.length === 1 ? '' : 'n') +
      ' a "Listos".</span>';
    html += '</div>';
  }

  html += '<div class="sap-bloqueado-pedidos">';
  g.pedidos.forEach((p) => {
    const u = (p.lines || []).reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
    const m = (p.lines || []).reduce(
      (s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.precio) || 0),
      0
    );
    html += '<div class="sap-bloqueado-ped">';
    // Checkbox para admin/gerente - habilita borrado masivo en la barra superior.
    // Usamos onchange (no onclick) y label wrapper, mismo patron que listos.
    // El span tiene flex:1 por el CSS de .sap-bloqueado-ped span, asi que el
    // label tambien para que el click area cubra todo.
    // v605 E5: contar SKUs UNICOS (no lineas). Con v600 split, un pedido puede
    // tener 2 lineas del mismo SKU {confirmed + BO} — la anterior contaba 2.
    const _uniqueSkus = new Set((p.lines || []).map((l) => l && l.code).filter(Boolean)).size;
    const metaText =
      '<b>' +
      escapeHtml(p.month || '-') +
      '</b> &middot; ' +
      _uniqueSkus +
      ' SKUs &middot; ' +
      Math.round(u) +
      ' uds &middot; $' +
      Math.round(m).toLocaleString('es-AR') +
      ' &middot; ' +
      escapeHtml(p.ownerEmail || '');
    if (userRole === 'admin' || userRole === 'gerente') {
      const checkedAttr = sapPendSelection.has(p._fsId) ? ' checked' : '';
      html +=
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;min-width:160px;margin:0"><input type="checkbox" class="sap-pend-check" onchange="togglePedidoSelection(\'' +
        p._fsId +
        '\')"' +
        checkedAttr +
        ' style="width:18px;height:18px;cursor:pointer;flex-shrink:0;accent-color:#dc2626" /><span style="flex:1">' +
        metaText +
        '</span></label>';
    } else {
      html += '<span>' + metaText + '</span>';
    }
    if (userRole === 'admin') {
      html +=
        '<button class="sap-btn secondary" style="padding:5px 10px;font-size:10px" onclick="marcarManualSap(\'' +
        p._fsId +
        '\')">Cargado manual</button>';
    }
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}

window.assignClienteSAPInline = async function (clientName, value, inputEl) {
  if (userRole !== 'admin') return;
  const trimmed = (value || '').trim();
  if (!trimmed) return;
  const cur = sapGetClienteCode(clientName);
  if (trimmed === cur) return;
  const docId =
    sapNorm(clientName)
      .replace(/[^A-Z0-9]/g, '_')
      .slice(0, 1400) || 'cli_' + Date.now();
  try {
    await fbDb
      .collection('sap_clients')
      .doc(docId)
      .set(
        {
          clientName: clientName,
          sapCode: trimmed,
          updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    showSyncTag('CardCode asignado a "' + clientName + '". Pedidos pasaron a Listos.');
    // El listener de sap_clients dispara re-render auto
  } catch (e) {
    console.error('assignClienteSAPInline', e);
    alert('Error asignando: ' + (e.message || e));
    if (inputEl) inputEl.focus();
  }
};

window.marcarManualSap = async function (fsId) {
  if (userRole !== 'admin') return;
  if (
    !confirm(
      'Marcar este pedido como CARGADO MANUALMENTE en SAP?\n\nLo saca de "Pendientes" sin generar CSV. Util cuando lo cargaste a mano directamente en SAP B1.'
    )
  )
    return;
  const sapDocNum = prompt('Numero de documento SAP (opcional, ej. 5000123):', '');
  if (sapDocNum === null) return;
  try {
    await fbDb
      .collection('pedidos')
      .doc(fsId)
      .update({
        transferidoSAP: {
          batchId: 'MANUAL',
          transferredAt: new Date().toISOString(),
          transferredBy: currentUser ? currentUser.email || currentUser.uid : '',
          sapDocRange: (sapDocNum || '').trim(),
          manual: true,
        },
      });
    logOp('marcar_cargado_manual_sap', 'pedido', fsId, { sapDocNum: (sapDocNum || '').trim() });
    showSyncTag('Pedido marcado como cargado manualmente');
  } catch (e) {
    console.error('marcarManualSap', e);
    alert('Error: ' + (e.message || e));
  }
};

window.onSapPedidosSearch = function (v) {
  if (window.sapCurrentTab === 'pendientes') sapPendienteSearch = v;
  else sapTransferidoSearch = v;
  // mantener foco
  const oldFocus = document.activeElement;
  const _oldVal = oldFocus && oldFocus.value;
  const oldSel = oldFocus && oldFocus.selectionStart;
  renderSapPedidos();
  const nf = document.getElementById('sap-pedidos-search');
  if (nf) {
    nf.focus();
    if (typeof oldSel === 'number') {
      try {
        nf.setSelectionRange(oldSel, oldSel);
      } catch (_e) {}
    }
  }
};

window.togglePedidoSelection = function (fsId) {
  if (sapPendSelection.has(fsId)) sapPendSelection.delete(fsId);
  else sapPendSelection.add(fsId);
  renderSapPedidos();
};

// Borra de Firestore los pedidos seleccionados. Solo admin/gerente.
// Util para limpiar pedidos de prueba sin tener que ir uno por uno.
window.deleteSelectedPedidos = async function () {
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede borrar pedidos.');
    return;
  }
  if (!sapPendSelection.size) return;
  const ids = [...sapPendSelection];
  if (
    !confirm(
      'BORRAR DEFINITIVAMENTE ' +
        ids.length +
        ' pedido(s) de Firestore?\n\n' +
        'Esto es irreversible y afecta todos los usuarios.\n\n' +
        'Solo confirma si son pedidos de PRUEBA. ¿Continuar?'
    )
  )
    return;
  let ok = 0,
    fail = 0;
  for (const fsId of ids) {
    try {
      await fbDb.collection('pedidos').doc(fsId).delete();
      ok++;
    } catch (e) {
      console.error('delete pedido', fsId, e);
      fail++;
    }
  }
  sapPendSelection.clear();
  alert(ok + ' pedido(s) borrado(s). ' + (fail ? fail + ' fallaron - revisar consola.' : ''));
  // El listener de pedidos va a refrescar la UI automaticamente.
};

window.marcarLoteTransferido = async function () {
  if (userRole !== 'admin' && userRole !== 'vendedor') return;
  if (!sapPendSelection.size) return;
  const sapDocRange = prompt(
    'Opcional: numero o rango de documentos SAP creados (ej. 5000123-5000147). Dejalo vacio si no aplica.',
    ''
  );
  if (sapDocRange === null) return;
  const batchId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  if (
    !confirm(
      'Marcar ' +
        sapPendSelection.size +
        ' pedido(s) como transferidos a SAP?\n\nLote: ' +
        batchId +
        (sapDocRange ? '\nSAP doc: ' + sapDocRange : '')
    )
  )
    return;
  const ids = [...sapPendSelection];
  const transferredAt = new Date().toISOString();
  const transferredBy = currentUser ? currentUser.email || currentUser.uid : '';
  let ok = 0,
    fail = 0;
  for (const id of ids) {
    try {
      await fbDb
        .collection('pedidos')
        .doc(id)
        .update({
          transferidoSAP: { batchId, transferredAt, transferredBy, sapDocRange: sapDocRange || '' },
        });
      ok++;
    } catch (e) {
      console.error('marcar transferido', id, e);
      fail++;
    }
  }
  logOp('lote_transferido_sap', 'pedidos_lote', batchId, {
    batchId,
    count: ok,
    sapDocRange: sapDocRange || '',
    ids,
  });
  sapPendSelection.clear();
  showSyncTag(
    ok + ' pedido(s) marcados como transferidos' + (fail ? ' (' + fail + ' fallaron)' : '')
  );
  // forzar re-render
  renderSapPedidos();
};

window.revertirTransferenciaSap = async function (fsId) {
  if (userRole !== 'admin') return;
  if (
    !confirm(
      'Revertir la transferencia a SAP de este pedido?\n\nVa a volver a "Pendientes de SAP".'
    )
  )
    return;
  try {
    await fbDb
      .collection('pedidos')
      .doc(fsId)
      .update({ transferidoSAP: firebase.firestore.FieldValue.delete() });
    logOp('revertir_transferencia_sap', 'pedido', fsId, {});
    showSyncTag('Transferencia revertida');
  } catch (e) {
    console.error('revertir sap', e);
    alert('Error: ' + (e.message || e));
  }
};

// Headers oficiales DTW (extraidos de plantillas Customize Template generadas por SAP B1 productivo)
const _DTW_DOC_API = [
  'DocNum',
  'DocEntry',
  'DocType',
  'HandWritten',
  'Printed',
  'DocDate',
  'DocDueDate',
  'CardCode',
  'CardName',
  'Address',
  'NumAtCard',
  'DocTotal',
  'AttachmentEntry',
  'DocCurrency',
  'DocRate',
  'Reference1',
  'Reference2',
  'Comments',
  'JournalMemo',
  'PaymentGroupCode',
  'DocTime',
  'SalesPersonCode',
  'TransportationCode',
  'Confirmed',
  'ImportFileNum',
  'SummeryType',
  'ContactPersonCode',
  'ShowSCN',
  'Series',
  'TaxDate',
  'PartialSupply',
  'DocObjectCode',
  'ShipToCode',
  'Indicator',
  'FederalTaxID',
  'DiscountPercent',
  'PaymentReference',
  'DocTotalFc',
  'Form1099',
  'Box1099',
  'RevisionPo',
  'RequriedDate',
  'CancelDate',
  'BlockDunning',
  'Pick',
  'PaymentMethod',
  'PaymentBlock',
  'PaymentBlockEntry',
  'CentralBankIndicator',
  'MaximumCashDiscount',
  'Project',
  'ExemptionValidityDateFrom',
  'ExemptionValidityDateTo',
  'WareHouseUpdateType',
  'Rounding',
  'ExternalCorrectedDocNum',
  'InternalCorrectedDocNum',
  'DeferredTax',
  'TaxExemptionLetterNum',
  'AgentCode',
  'NumberOfInstallments',
  'ApplyTaxOnFirstInstallment',
  'VatDate',
  'DocumentsOwner',
  'FolioPrefixString',
  'FolioNumber',
  'DocumentSubType',
  'BPChannelCode',
  'BPChannelContact',
  'Address2',
  'PayToCode',
  'ManualNumber',
  'UseShpdGoodsAct',
  'IsPayToBank',
  'PayToBankCountry',
  'PayToBankCode',
  'PayToBankAccountNo',
  'PayToBankBranch',
  'BPL_IDAssignedToInvoice',
  'DownPayment',
  'ReserveInvoice',
  'LanguageCode',
  'TrackingNumber',
  'PickRemark',
  'ClosingDate',
  'SequenceCode',
  'SequenceSerial',
  'SeriesString',
  'SubSeriesString',
  'SequenceModel',
  'UseCorrectionVATGroup',
  'DownPaymentAmount',
  'DownPaymentPercentage',
  'DownPaymentType',
  'DownPaymentAmountSC',
  'DownPaymentAmountFC',
  'VatPercent',
  'ServiceGrossProfitPercent',
  'OpeningRemarks',
  'ClosingRemarks',
  'RoundingDiffAmount',
  'ControlAccount',
  'InsuranceOperation347',
  'ArchiveNonremovableSalesQuotation',
  'GTSChecker',
  'GTSPayee',
  'ExtraMonth',
  'ExtraDays',
  'CashDiscountDateOffset',
  'StartFrom',
  'NTSApproved',
  'ETaxWebSite',
  'ETaxNumber',
  'NTSApprovedNumber',
  'EDocGenerationType',
  'EDocSeries',
  'EDocNum',
  'EDocExportFormat',
  'EDocStatus',
  'EDocErrorCode',
  'EDocErrorMessage',
  'DownPaymentStatus',
  'GroupSeries',
  'GroupNumber',
  'GroupHandWritten',
  'ReopenOriginalDocument',
  'ReopenManuallyClosedOrCanceledDocument',
  'CreateOnlineQuotation',
  'POSEquipmentNumber',
  'POSManufacturerSerialNumber',
  'POSCashierNumber',
  'ApplyCurrentVATRatesForDownPaymentsToDraw',
  'ClosingOption',
  'SpecifiedClosingDate',
  'OpenForLandedCosts',
  'RelevantToGTS',
  'AnnualInvoiceDeclarationReference',
  'Supplier',
  'Releaser',
  'Receiver',
  'BlanketAgreementNumber',
  'IsAlteration',
  'AssetValueDate',
  'DocumentDelivery',
  'AuthorizationCode',
  'StartDeliveryDate',
  'StartDeliveryTime',
  'EndDeliveryDate',
  'EndDeliveryTime',
  'VehiclePlate',
  'ATDocumentType',
  'ElecCommStatus',
  'ReuseDocumentNum',
  'ReuseNotaFiscalNum',
  'PrintSEPADirect',
  'FiscalDocNum',
  'POSDailySummaryNo',
  'POSReceiptNo',
  'PointOfIssueCode',
  'Letter',
  'FolioNumberFrom',
  'FolioNumberTo',
  'InterimType',
  'RelatedType',
  'RelatedEntry',
  'SAPPassport',
  'DocumentTaxID',
  'DateOfReportingControlStatementVAT',
  'ReportingSectionControlStatementVAT',
  'ExcludeFromTaxReportControlStatementVAT',
  'POS_CashRegister',
  'CreateQRCodeFrom',
  'PriceMode',
  'CommissionTrade',
  'CommissionTradeReturn',
  'UseBillToAddrToDetermineTax',
  'Cig',
  'Cup',
  'FatherCard',
  'FatherType',
  'ShipState',
  'ShipPlace',
  'CustOffice',
  'FCI',
  'AddLegIn',
  'LegTextF',
  'IndFinal',
  'U_B1SYS_CAI',
  'U_B1SYS_CAI_DATE',
  'U_B1SYS_ECM2_LINK',
  'U_NroCompEsp',
  'U_FechaFCE',
  'U_MotivoNCE',
  'U_RefComFCE',
  'U_NIF',
  'U_TipoFCE',
  'U_Carpeta',
  'U_ProvEvent',
  'U_Enviado',
  'U_ShiOrden',
  'U_ActStock',
  'U_ONESL_EnvioMail',
  'U_ONESL_DocEntry',
  'U_SSC',
  'U_COST_ART_TOT',
  'U_SaldoProv',
  'U_TipoGasto',
  'U_SH_USER',
  'U_CONTRATO',
  'U_RP',
  'U_GARANTIA',
  'U_Procesado',
  'U_TPAGO',
  'U_TotalFactAprox',
  'U_AppOrigen',
  'U_AppOrderId',
  'U_AppBatchId',
];
const _DTW_DOC_INT = [
  'DocNum',
  'DocEntry',
  'DocType',
  'Handwrtten',
  'Printed',
  'DocDate',
  'DocDueDate',
  'CardCode',
  'CardName',
  'Address',
  'NumAtCard',
  'DocTotal',
  'AtcEntry',
  'DocCur',
  'DocRate',
  'Ref1',
  'Ref2',
  'Comments',
  'JrnlMemo',
  'GroupNum',
  'DocTime',
  'SlpCode',
  'TrnspCode',
  'Confirmed',
  'ImportEnt',
  'SummryType',
  'CntctCode',
  'ShowSCN',
  'Series',
  'TaxDate',
  'PartSupply',
  'ObjType',
  'ShipToCode',
  'Indicator',
  'LicTradNum',
  'DiscPrcnt',
  'PaymentRef',
  'UserSign',
  'DocTotalFC',
  'Form1099',
  'Box1099',
  'RevisionPo',
  'ReqDate',
  'CancelDate',
  'BlockDunn',
  'Pick',
  'PeyMethod',
  'PayBlock',
  'PayBlckRef',
  'CntrlBnk',
  'MaxDscn',
  'Project',
  'FromDate',
  'ToDate',
  'UpdInvnt',
  'Rounding',
  'CorrExt',
  'CorrInv',
  'DeferrTax',
  'LetterNum',
  'AgentCode',
  'Installmnt',
  'VATFirst',
  'VatDate',
  'OwnerCode',
  'FolioPref',
  'FolioNum',
  'DocSubType',
  'BPChCode',
  'BPChCntc',
  'Address2',
  'PayToCode',
  'ManualNum',
  'UseShpdGd',
  'IsPaytoBnk',
  'BnkCntry',
  'BankCode',
  'BnkAccount',
  'BnkBranch',
  'BPLId',
  'DpmPrcnt',
  'isIns',
  'LangCode',
  'TrackNo',
  'PickRmrk',
  'ClsDate',
  'SeqCode',
  'Serial',
  'SeriesStr',
  'SubStr',
  'Model',
  'UseCorrVat',
  'DpmAmnt',
  'DpmPrcnt',
  'Posted',
  'DpmAmntSC',
  'DpmAmntFC',
  'VatPercent',
  'SrvGpPrcnt',
  'Header',
  'Footer',
  'RoundDif',
  'CtlAccount',
  'InsurOp347',
  'IgnRelDoc',
  'Checker',
  'Payee',
  'ExtraMonth',
  'ExtraDays',
  'CdcOffset',
  'PayDuMonth',
  'NTSApprov',
  'NTSWebSite',
  'NTSeTaxNo',
  'NTSApprNo',
  'EDocGenTyp',
  'ESeries',
  'EDocNum',
  'EDocExpFrm',
  'EDocStatus',
  'EDocErrCod',
  'EDocErrMsg',
  'DpmStatus',
  'PQTGrpSer',
  'PQTGrpNum',
  'PQTGrpHW',
  'ReopOriDoc',
  'ReopManCls',
  'OnlineQuo',
  'POSEqNum',
  'POSManufSN',
  'POSCashN',
  'DpmAsDscnt',
  'ClosingOpt',
  'SpecDate',
  'OpenForLaC',
  'GTSRlvnt',
  'AnnInvDecR',
  'Supplier',
  'Releaser',
  'Receiver',
  'AgrNo',
  'IsAlt',
  'AssetDate',
  'DocDlvry',
  'AuthCode',
  'StDlvDate',
  'StDlvTime',
  'EndDlvDate',
  'EndDlvTime',
  'VclPlate',
  'AtDocType',
  'ElCoStatus',
  'IsReuseNum',
  'IsReuseNFN',
  'PrintSEPA',
  'FiscDocNum',
  'ZrdAbs',
  'POSRcptNo',
  'PTICode',
  'Letter',
  'FolNumFrom',
  'FolNumTo',
  'InterimTyp',
  'RelatedTyp',
  'RelatedEnt',
  'SAPPassprt',
  'DocTaxID',
  'DateReport',
  'RepSection',
  'ExclTaxRep',
  'PosCashReg',
  'QRCodeSrc',
  'PriceMode',
  'ShipToCode',
  'ComTrade',
  'ComTradeRt',
  'UseBilAddr',
  'CIG',
  'CUP',
  'FatherCard',
  'FatherType',
  'ShipState',
  'ShipPlace',
  'CustOffice',
  'FCI',
  'AddLegIn',
  'LegTextF',
  'DANFELgTxt',
  'IndFinal',
  'DataVers',
  'LPgFolioN',
  'U_B1SYS_CAI',
  'U_B1SYS_CAI_DATE',
  'U_B1SYS_ECM2_LINK',
  'U_NroCompEsp',
  'U_FechaFCE',
  'U_MotivoNCE',
  'U_RefComFCE',
  'U_NIF',
  'U_TipoFCE',
  'U_Carpeta',
  'U_ProvEvent',
  'U_Enviado',
  'U_ShiOrden',
  'U_ActStock',
  'U_ONESL_EnvioMail',
  'U_ONESL_DocEntry',
  'U_SSC',
  'U_COST_ART_TOT',
  'U_SaldoProv',
  'U_TipoGasto',
  'U_SH_USER',
  'U_CONTRATO',
];
const _DTW_LIN_API = [
  'ParentKey',
  'LineNum',
  'ItemCode',
  'ItemDescription',
  'Quantity',
  'ShipDate',
  'Price',
  'PriceAfterVAT',
  'Currency',
  'Rate',
  'DiscountPercent',
  'VendorNum',
  'SerialNum',
  'WarehouseCode',
  'SalesPersonCode',
  'CommisionPercent',
  'TreeType',
  'AccountCode',
  'UseBaseUnits',
  'SupplierCatNum',
  'CostingCode',
  'ProjectCode',
  'BarCode',
  'VatGroup',
  'Height1',
  'Hight1Unit',
  'Height2',
  'Height2Unit',
  'Lengh1',
  'Lengh1Unit',
  'Lengh2',
  'Lengh2Unit',
  'Weight1',
  'Weight1Unit',
  'Weight2',
  'Weight2Unit',
  'Factor1',
  'Factor2',
  'Factor3',
  'Factor4',
  'BaseType',
  'BaseEntry',
  'BaseLine',
  'Volume',
  'VolumeUnit',
  'Width1',
  'Width1Unit',
  'Width2',
  'Width2Unit',
  'Address',
  'TaxCode',
  'TaxType',
  'TaxLiable',
  'BackOrder',
  'FreeText',
  'ShippingMethod',
  'CorrectionInvoiceItem',
  'CorrInvAmountToStock',
  'CorrInvAmountToDiffAcct',
  'WTLiable',
  'DeferredTax',
  'MeasureUnit',
  'UnitsOfMeasurment',
  'LineTotal',
  'TaxPercentagePerRow',
  'TaxTotal',
  'ConsumerSalesForecast',
  'ExciseAmount',
  'CountryOrg',
  'SWW',
  'TransactionType',
  'DistributeExpense',
  'RowTotalFC',
  'CFOPCode',
  'CSTCode',
  'Usage',
  'TaxOnly',
  'UnitPrice',
  'LineStatus',
  'PackageQuantity',
  'LineType',
  'COGSCostingCode',
  'COGSAccountCode',
  'ChangeAssemlyBoMWarehouse',
  'GrossBuyPrice',
  'GrossBase',
  'GrossProfitTotalBasePrice',
  'CostingCode2',
  'CostingCode3',
  'CostingCode4',
  'CostingCode5',
  'ItemDetails',
  'LocationCode',
  'ActualDeliveryDate',
  'ExLineNo',
  'RequiredDate',
  'RequiredQuantity',
  'COGSCostingCode2',
  'COGSCostingCode3',
  'COGSCostingCode4',
  'COGSCostingCode5',
  'CSTforIPI',
  'CSTforPIS',
  'CSTforCOFINS',
  'CreditOriginCode',
  'WithoutInventoryMovement',
  'AgreementNo',
  'AgreementRowNumber',
  'ActualBaseEntry',
  'ActualBaseLine',
  'DocEntry',
  'Surpluses',
  'DefectAndBreakup',
  'Shortages',
  'ConsiderQuantity',
  'PartialRetirement',
  'RetirementQuantity',
  'RetirementAPC',
  'ThirdParty',
  'PoNum',
  'PoItmNum',
  'ExpenseType',
  'ReceiptNumber',
  'ExpenseOperationType',
  'FederalTaxID',
  'GrossProfit',
  'GrossProfitFC',
  'GrossProfitSC',
  'UoMEntry',
  'InventoryQuantity',
  'ParentLineNum',
  'Incoterms',
  'TransportMode',
  'NatureOfTransaction',
  'DestinationCountryForImport',
  'DestinationRegionForImport',
  'OriginCountryForExport',
  'OriginRegionForExport',
  'ChangeInventoryQuantityIndependently',
  'FreeOfChargeBP',
  'SACEntry',
  'HSNEntry',
  'GrossPrice',
  'GrossTotal',
  'GrossTotalFC',
  'NCMCode',
  'NVECode',
  'IndEscala',
  'CtrSealQty',
  'CNJPMan',
  'CESTCode',
  'UFFiscalBenefitCode',
  'ReverseCharge',
  'ShipToCode',
  'ShipToDescription',
  'OwnerCode',
  'ExternalCalcTaxRate',
  'ExternalCalcTaxAmount',
  'StandardItemIdentification',
  'CommodityClassification',
  'UnencumberedReason',
  'CUSplit',
  'U_STK_LIBRE',
  'U_reqDate',
  'U_posDate',
  'U_proDate',
  'U_ShiKey',
  'U_ActStockLin',
];
const _DTW_LIN_INT = [
  'DocNum',
  'LineNum',
  'ItemCode',
  'Dscription',
  'Quantity',
  'ShipDate',
  'Price',
  'PriceAfVAT',
  'Currency',
  'Rate',
  'DiscPrcnt',
  'VendorNum',
  'SerialNum',
  'WhsCode',
  'SlpCode',
  'Commission',
  'TreeType',
  'AcctCode',
  'UseBaseUn',
  'SubCatNum',
  'OcrCode',
  'Project',
  'CodeBars',
  'VatGroup',
  'Height1',
  'Hght1Unit',
  'Height2',
  'Hght2Unit',
  'Length1',
  'Len1Unit',
  'length2',
  'Len2Unit',
  'Weight1',
  'Wght1Unit',
  'Weight2',
  'Wght2Unit',
  'Factor1',
  'Factor2',
  'Factor3',
  'Factor4',
  'BaseType',
  'BaseEntry',
  'BaseLine',
  'Volume',
  'VolUnit',
  'Width1',
  'Wdth1Unit',
  'Width2',
  'Wdth2Unit',
  'Address',
  'TaxCode',
  'TaxType',
  'TaxStatus',
  'BackOrdr',
  'FreeTxt',
  'TrnsCode',
  'CEECFlag',
  'ToStock',
  'ToDiff',
  'WtLiable',
  'DeferrTax',
  'unitMsr',
  'NumPerMsr',
  'LineTotal',
  'VatPrcnt',
  'VatSum',
  'ConsumeFCT',
  'ExciseAmt',
  'CountryOrg',
  'SWW',
  'TranType',
  'DistribExp',
  'TotalFrgn',
  'CFOPCode',
  'CSTCode',
  'Usage',
  'TaxOnly',
  'PriceBefDi',
  'LineStatus',
  'PackQty',
  'LineType',
  'CogsOcrCod',
  'CogsAcct',
  'ChgAsmBoMW',
  'GrossBuyPr',
  'GrossBase',
  'GPTtlBasPr',
  'OcrCode2',
  'OcrCode3',
  'OcrCode4',
  'OcrCode5',
  'Text',
  'LocCode',
  'ActDelDate',
  'ExLineNo',
  'PQTReqDate',
  'PQTReqQty',
  'CogsOcrCo2',
  'CogsOcrCo3',
  'CogsOcrCo4',
  'CogsOcrCo5',
  'CSTfIPI',
  'CSTfPIS',
  'CSTfCOFINS',
  'CredOrigin',
  'NoInvtryMv',
  'AgrNo',
  'AgrLnNum',
  'ActBaseEnt',
  'ActBaseLn',
  'DocEntry',
  'Surpluses',
  'DefBreak',
  'Shortages',
  'NeedQty',
  'PartRetire',
  'RetireQty',
  'RetireAPC',
  'ThirdParty',
  'PoNum',
  'PoItmNum',
  'ExpType',
  'ExpUUID',
  'ExpOpType',
  'LicTradNum',
  'GrssProfit',
  'GrssProfFC',
  'GrssProfSC',
  'SpecPrice',
  'UomEntry',
  'InvQty',
  'PrntLnNum',
  'Incoterms',
  'TransMod',
  'NatOfTrans',
  'ISDtCryImp',
  'ISDtRgnImp',
  'ISOrCryExp',
  'ISOrRgnExp',
  'InvQtyOnly',
  'FreeChrgBP',
  'SacEntry',
  'HsnEntry',
  'GPBefDisc',
  'GTotal',
  'GTotalFC',
  'NCMCode',
  'NVECode',
  'IndEscala',
  'CtrSealQty',
  'CNJPMan',
  'CESTCode',
  'UFFiscBene',
  'RevCharge',
  'ShipToCode',
  'ShipToDesc',
  'OwnerCode',
  'ExtTaxRate',
  'ExtTaxSum',
  'ExtTaxSumF',
  'ExtTaxSumS',
  'StdItemId',
  'CommClass',
  'UnencReasn',
  'CUSplit',
  'U_STK_LIBRE',
  'U_reqDate',
  'U_posDate',
];

function _csvEscape(v) {
  if (v == null) return '';
  const s = v.toString();
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// === Exports a window para callers cross-scope ===
window.listenSapMaps = listenSapMaps;
window.ensureSapConfigListener = ensureSapConfigListener;
window.renderSapConfig = renderSapConfig;
window.renderSapPedidos = renderSapPedidos;
window.renderSapServiceLayer = renderSapServiceLayer;
window.sapGetClienteCode = sapGetClienteCode;
window.sapGetMaterialCode = sapGetMaterialCode;
window.buildEntregaSuffixForRemarks = buildEntregaSuffixForRemarks;
// E6 hotfix 3: cross-module bug — sap-integration-modal + exports-sap llaman sapNorm.
window.sapNorm = sapNorm;
