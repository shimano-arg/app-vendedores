// @ts-nocheck
// SAP-SERVICE-LAYER: objeto sapSL puro (client Service Layer SAP B1).
// Métodos: loadConfig, isEnabled, login, ensureSession, fetchWithSession (rutea
// via Cloud Function sapProxy o fallback legacy directo), createQuotation,
// _isSalesWarehouse, getStock, getAllItems, getAllStock, buildQuotationPayload.
// Extraído verbatim de index.html (líneas 12570-12891 pre-E2.m.3) como parte
// de E2.m.3 (e2b-perf 2026-07-28). SEGUNDO fragmento del dominio sap-integrations.
//
// Cross-scope state: NONE. El objeto sapSL es autocontenido. window.sapSL
// se expone al final para debug en consola + para consumo desde otros módulos
// (sap-admin-panel + sap-auto-send-listener + inline enviarSeleccionadosViaSL).
//
// Deps del inline: fbDb, firebase, currentUser, escapeHtml, sapConfigCache
// (leído por buildQuotationPayload para appSeriesId), sapGetSlpCodeForVendor
// (bundle sap-integration-modal), sapGetClienteCode + sapGetMaterialCode
// (inline sap-admin-panel).
// =====================================================================
// CLIENTE SERVICE LAYER (SAP B1)
// =====================================================================
// Conexion directa a SAP B1 Service Layer (sin middleware). Reemplaza el
// flujo ZIP DTW manual cuando esta habilitado en config.
//
// Documentacion oficial: https://help.sap.com/docs/SAP_BUSINESS_ONE/...
//
// Endpoints que usamos:
//   POST /b1s/v1/Login                  -> obtener session cookie
//   POST /b1s/v1/Quotations             -> crear Sales Quotation
//   GET  /b1s/v1/Items('CODE')          -> info de item (incluye QuantityOnStock)
//   GET  /b1s/v1/ItemWarehouseInfoCollection('itemCode','whsCode')  -> stock W07
//
// Config en Firestore app_config/sap_integration:
//   serviceLayer: {
//     enabled: true/false,
//     url: 'https://shimano-sap.seidor.com.ar:50000',
//     companyDB: 'SHIMANO_SAU',
//     username: 'APP_VENDEDORES',
//     password: '...',          // guardado encriptado por las reglas Firestore
//   }
//
// Las credenciales se guardan en Firestore (admin lee/escribe).
// El cookie B1SESSION se guarda en memoria (no en Firestore).
const sapSL = {
  config: null, // {url, companyDB, username, password, enabled}
  sessionAt: 0, // timestamp del ultimo login OK
  sessionTtlMs: 25 * 60 * 1000, // SAP B1 SL default: 30 min. usamos 25 para refresh anticipado.

  // Carga la config desde sapConfigCache (que ya tiene listener en Firestore)
  loadConfig() {
    const sl = sapConfigCache && sapConfigCache.serviceLayer ? sapConfigCache.serviceLayer : {};
    this.config = {
      enabled: !!sl.enabled,
      url: sl.url || '',
      companyDB: sl.companyDB || '',
      username: sl.username || '',
      password: sl.password || '',
    };
    return this.config;
  },

  isEnabled() {
    this.loadConfig();
    return this.config.enabled && this.config.url && this.config.companyDB && this.config.username;
  },

  // POST /Login. Devuelve {ok, error}.
  // No retornamos el cookie a JS porque va en headers HttpOnly. El browser lo
  // maneja automaticamente si la request usa credentials:'include'.
  async login() {
    this.loadConfig();
    const cfg = this.config;
    if (!cfg.url) return { ok: false, error: 'URL del Service Layer no configurada' };
    const endpoint = cfg.url.replace(/\/$/, '') + '/b1s/v1/Login';
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          CompanyDB: cfg.companyDB,
          UserName: cfg.username,
          Password: cfg.password,
        }),
      });
      if (!resp.ok) {
        let detail = '';
        try {
          const j = await resp.json();
          detail = (j.error && j.error.message && j.error.message.value) || '';
        } catch (_e) {}
        return { ok: false, error: 'HTTP ' + resp.status + (detail ? ' - ' + detail : '') };
      }
      this.sessionAt = Date.now();
      return { ok: true };
    } catch (e) {
      // Error de red, CORS bloqueado, certificado, etc.
      return { ok: false, error: 'Error de red o CORS: ' + (e.message || String(e)) };
    }
  },

  async ensureSession() {
    if (Date.now() - this.sessionAt < this.sessionTtlMs) return { ok: true };
    return this.login();
  },

  // Wrapper de fetch que: 1) asegura sesion, 2) hace request, 3) si tira 401
  // re-loguea y reintenta una vez.
  //
  // Fase 0 E2.b step 3 (v330): si useCloudProxy=true rutea via
  // sapProxy Cloud Function (creds en Secret Manager server-side).
  // Si false, cae al fetch directo legacy (creds en Firestore, lo que
  // E5 vino a cerrar). Flag por si hay que rollback rápido sin
  // redeploy — flip a false y la app vuelve al modo legacy inmediato.
  useCloudProxy: true,
  _cloudClient: null, // lazy singleton
  _getCloudClient() {
    if (!this._cloudClient) {
      if (!window.__phase0 || !window.__phase0.sap || !window.__phase0.sap.createSapClient) {
        return null;
      }
      this._cloudClient = window.__phase0.sap.createSapClient(firebase, {
        region: 'southamerica-east1',
      });
    }
    return this._cloudClient;
  },
  async fetchWithSession(path, options) {
    // Nueva ruta: sapProxy Cloud Function.
    if (this.useCloudProxy) {
      const client = this._getCloudClient();
      if (client) return client.fetchWithSession(path, options);
      // Bundle no cargó — fallback al legacy con warning.
      console.warn('[sapSL] cloud client no disponible, fallback a fetch directo');
    }
    // Legacy: fetch directo al SL con creds de Firestore.
    const cfg = this.config;
    const url = path.startsWith('http') ? path : cfg.url.replace(/\/$/, '') + path;
    let s = await this.ensureSession();
    if (!s.ok) return { ok: false, error: s.error, status: 0 };
    const opts = Object.assign({ credentials: 'include' }, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    let resp;
    try {
      resp = await fetch(url, opts);
    } catch (e) {
      return { ok: false, error: 'Network/CORS: ' + (e.message || e), status: 0 };
    }
    if (resp.status === 401) {
      // sesion expirada -> re-login y reintentar 1 vez
      s = await this.login();
      if (!s.ok) return { ok: false, error: 'Re-login fallido: ' + s.error, status: 401 };
      try {
        resp = await fetch(url, opts);
      } catch (e) {
        return { ok: false, error: 'Network/CORS retry: ' + (e.message || e), status: 0 };
      }
    }
    let body = null;
    try {
      body = await resp.json();
    } catch (_e) {
      body = null;
    }
    if (!resp.ok) {
      const detail = (body && body.error && body.error.message && body.error.message.value) || '';
      return {
        ok: false,
        error: 'HTTP ' + resp.status + (detail ? ' - ' + detail : ''),
        status: resp.status,
        body,
      };
    }
    return { ok: true, body, status: resp.status };
  },

  // Crea una Sales Quotation. Recibe el payload ya armado en JSON.
  async createQuotation(payload) {
    return this.fetchWithSession('/b1s/v1/Quotations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Whs a EXCLUIR cuando sumamos stock total (no son vendibles):
  //   '05' MARKETING, '06' DEVOLUCIONES.
  // Todos los demas (01 ANDREANI, 02/10/11/12 MERCADERIA, 03 ZONA FRANCA,
  // 04 EEUU, 07 PESCA EEUU) se suman como stock disponible.
  _isSalesWarehouse(whsCode) {
    if (!whsCode) return false;
    const code = String(whsCode);
    if (code === '05' || code === '06') return false;
    return true;
  },

  // Consulta stock disponible de un SKU. Si whsCode='ALL' (default nuevo) suma
  // todos los warehouses vendibles. Si se pasa un codigo especifico, solo ese.
  // Devuelve {ok, qty, byWhs?} donde byWhs es un objeto {WhsCode: qty} util
  // para el modal Master de Productos.
  async getStock(itemCode, whsCode) {
    whsCode = whsCode || 'ALL';
    // Si piden un whs especifico, intentar el SQLQuery mas rapido primero.
    if (whsCode !== 'ALL') {
      const path =
        "/b1s/v1/SQLQueries('ItemStockByWhs')/List?ItemCode='" +
        encodeURIComponent(itemCode) +
        "'&WhsCode='" +
        encodeURIComponent(whsCode) +
        "'";
      const rq = await this.fetchWithSession(path);
      if (rq.ok && rq.body && Array.isArray(rq.body.value) && rq.body.value.length) {
        return { ok: true, qty: parseFloat(rq.body.value[0].OnHand || 0) };
      }
    }
    // Fallback / caso ALL: leer todos los warehouses del Item.
    const safeCode = String(itemCode || '').replace(/'/g, "''");
    const r = await this.fetchWithSession(
      "/b1s/v1/Items('" +
        encodeURIComponent(safeCode) +
        "')?$select=ItemCode,ItemWarehouseInfoCollection"
    );
    if (!r.ok) return { ok: false, error: r.error };
    const whs = (r.body && r.body.ItemWarehouseInfoCollection) || [];
    if (whsCode !== 'ALL') {
      const target = whs.find((w) => w.WarehouseCode === whsCode);
      return { ok: true, qty: target ? parseFloat(target.InStock || 0) : 0 };
    }
    // ALL: sumar solo warehouses vendibles.
    let total = 0;
    const byWhs = {};
    whs.forEach((w) => {
      const q = parseFloat(w.InStock || 0);
      if (this._isSalesWarehouse(w.WarehouseCode)) total += q;
      byWhs[w.WarehouseCode] = q;
    });
    return { ok: true, qty: total, byWhs };
  },

  // Trae TODOS los items del catalogo SAP paginando via OData.
  // El server SL de Seidor bloquea el header 'Prefer' por CORS asi que
  // no podemos subir el pageSize. SL respeta ~20 items por request.
  // Estrategia: seguir el @odata.nextLink que SL devuelve al final de
  // cada pagina. Para ~10k items = ~500 requests = ~1-2 min. Aceptable
  // para un sync que corre 1 vez cuando cargan articulos nuevos.
  // Devuelve {ok, items: [{ItemCode, ItemName}], error?}.
  async getAllItems(onProgress) {
    const items = [];
    let path = '/b1s/v1/Items?$select=ItemCode,ItemName';
    let pageCount = 0;
    while (path) {
      const r = await this.fetchWithSession(path);
      if (!r.ok) return { ok: false, error: r.error, itemsFetched: items.length };
      const arr = (r.body && r.body.value) || [];
      if (pageCount === 0) {
        console.log(
          '[catalog SL] primera pagina:',
          arr.length,
          'items. Body keys:',
          Object.keys(r.body || {})
        );
        if (arr[0]) console.log('[catalog SL] primer item:', arr[0]);
      }
      arr.forEach((it) => {
        items.push({ ItemCode: it.ItemCode || '', ItemName: it.ItemName || '' });
      });
      pageCount++;
      if (typeof onProgress === 'function')
        onProgress(items.length, r.body['@odata.count'] || null);
      // Chequear si hay mas paginas via @odata.nextLink.
      const nextLink = (r.body && (r.body['@odata.nextLink'] || r.body['odata.nextLink'])) || null;
      if (!nextLink) break;
      // Normalizar el nextLink a un path que fetchWithSession pueda usar.
      if (nextLink.startsWith('http')) {
        const idx = nextLink.indexOf('/b1s/v1/');
        path = idx >= 0 ? nextLink.slice(idx) : nextLink;
      } else if (nextLink.startsWith('/')) {
        path = nextLink;
      } else {
        // Es un path relativo tipo "Items?$skip=20&$top=20"
        path = '/b1s/v1/' + nextLink;
      }
      if (items.length > 50000) {
        console.warn('[catalog SL] safety cap 50k alcanzado');
        break;
      }
    }
    console.log('[catalog SL] termino con', items.length, 'items en', pageCount, 'paginas');
    return { ok: true, items };
  },

  // Trae stock de TODOS los items via SL. Si whsCode='ALL' (default) suma
  // los warehouses vendibles (excluye 05 Marketing / 06 Devoluciones). Si se
  // pasa un codigo de whs especifico, filtra solo ese.
  async getAllStock(whsCode, onProgress) {
    whsCode = whsCode || 'ALL';
    const stockMap = {};
    let path = '/b1s/v1/Items?$select=ItemCode,ItemWarehouseInfoCollection';
    let pageCount = 0;
    let scanned = 0;
    let withStock = 0;
    while (path) {
      const r = await this.fetchWithSession(path);
      if (!r.ok) return { ok: false, error: r.error, itemsFetched: scanned };
      const arr = (r.body && r.body.value) || [];
      arr.forEach((it) => {
        const code = it.ItemCode || '';
        if (!code) return;
        scanned++;
        const whs = it.ItemWarehouseInfoCollection || [];
        let qty = 0;
        if (whsCode === 'ALL') {
          whs.forEach((w) => {
            if (this._isSalesWarehouse(w.WarehouseCode)) qty += parseFloat(w.InStock || 0);
          });
        } else {
          const target = whs.find((w) => w.WarehouseCode === whsCode);
          qty = target ? parseFloat(target.InStock || 0) : 0;
        }
        const hasStk = qty > 0;
        stockMap[code] = hasStk;
        if (hasStk) withStock++;
      });
      pageCount++;
      if (typeof onProgress === 'function') onProgress(scanned, withStock);
      const nextLink = (r.body && (r.body['@odata.nextLink'] || r.body['odata.nextLink'])) || null;
      if (!nextLink) break;
      if (nextLink.startsWith('http')) {
        const idx = nextLink.indexOf('/b1s/v1/');
        path = idx >= 0 ? nextLink.slice(idx) : nextLink;
      } else if (nextLink.startsWith('/')) {
        path = nextLink;
      } else {
        path = '/b1s/v1/' + nextLink;
      }
      if (scanned > 50000) {
        console.warn('[stock SL] safety cap 50k');
        break;
      }
    }
    console.log(
      '[stock SL] termino:',
      scanned,
      'items scanned,',
      withStock,
      'con stock. Paginas:',
      pageCount
    );
    return { ok: true, stockMap, scanned, withStock };
  },

  // Arma el payload JSON de OQUT a partir de un pedido de la app, equivalente
  // semantico al ZIP DTW pero en formato Service Layer (camelCase + numerico).
  buildQuotationPayload(pedido) {
    const p = pedido;
    const cliSap = typeof sapGetClienteCode === 'function' ? sapGetClienteCode(p.clientName) : '';
    // v405 (2026-08-05): fix SalesPersonCode vacio en la Oferta SAP.
    // Preferir p.ownerVendor (guardado explicito en el pedido desde v405) sobre
    // getVendorForKey (que busca POINTS[prov|loc] y falla para clientes SAP
    // huerfanos sin POINT en la app). Reporte: Ioannis metio un pedido y en
    // la Oferta 'Empleados de ventas' quedo vacio -> Santi no sabia de quien
    // era. Antes: getVendorForKey('...') = '' -> slpCode = '' -> SAP muestra
    // sin asignar. Ahora: usa el vendor del ownerUid guardado en Firestore.
    // Pedidos pre-v405 sin ownerVendor caen al comportamiento viejo.
    let _resolvedVendor = p.ownerVendor || '';
    if (!_resolvedVendor && typeof getVendorForKey === 'function') {
      _resolvedVendor = getVendorForKey(
        p._fsKey ||
          p.tipo + '|' + (p.province || '') + '|' + (p.locName || '') + '|' + (p.clientName || '')
      );
    }
    const slpCode =
      typeof sapGetSlpCodeForVendor === 'function' ? sapGetSlpCodeForVendor(_resolvedVendor) : '';
    const docDateIso = p.finalizedAt || p.confirmedAt || new Date().toISOString();
    const docDate = docDateIso.slice(0, 10); // YYYY-MM-DD
    const dueDate = new Date(new Date(docDateIso).getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const seriesId =
      sapConfigCache && sapConfigCache.appSeriesId
        ? parseInt(sapConfigCache.appSeriesId, 10)
        : null;
    // v390 (2026-08-04): dedupe automatico por ItemCode. SAP rechaza con
    // error 23105 "Uno o mas articulos se repiten" si hay 2+ lineas con el
    // mismo ItemCode. Bug reportado: SANDOVAL cargo SLXC70HASA 2 veces sin
    // darse cuenta. Fix: agrupar por ItemCode sumando quantities antes de
    // enviar, en vez de fallar el pedido entero.
    const rawLines = (p.lines || []).map((l) => ({
      ItemCode:
        typeof sapGetProductCode === 'function' ? sapGetProductCode(l.code) || l.code : l.code,
      Quantity: parseFloat(l.qty) || 0,
      WarehouseCode: '11',
    }));
    const dedupedByItem = {};
    rawLines.forEach((ln) => {
      const key = ln.ItemCode;
      if (!dedupedByItem[key]) {
        dedupedByItem[key] = { ...ln };
      } else {
        dedupedByItem[key].Quantity += ln.Quantity;
      }
    });
    const docLines = Object.values(dedupedByItem).map((ln, idx) => ({
      ...ln,
      LineNum: idx,
    }));
    // v343+ (2026-07-28): DiscountPercent del header. El vendedor lo carga en
    // el modal Review (input #rv-manual-discount) que persiste en p.discountPct.
    // v389 (2026-08-04): NO se envia mas como DiscountPercent porque el user
    // SAP APP_VENDEDORES tiene MaxDiscountSales = 0 y SAP rechaza cualquier
    // valor > 0 con error 10000724. Fix: mandamos siempre DiscountPercent=0
    // y el descuento solicitado por el vendedor va en Comments para que Admin
    // (Santi) lo vea al aprobar la Oferta y lo aplique manualmente con sus
    // permisos superuser. Alternativa arquitectural (que no elegimos ahora):
    // pedir a Santi que suba MaxDiscount del user APP_VENDEDORES a 100%.
    const discPct = Math.max(0, Math.min(100, parseFloat(p.discountPct) || 0));
    const discPctSuffix = discPct > 0 ? ' | DESCUENTO SOLICITADO: ' + discPct + '%' : '';
    const payload = {
      CardCode: cliSap || '',
      DocDate: docDate,
      DocDueDate: dueDate,
      TaxDate: docDate,
      SalesPersonCode: slpCode ? parseInt(slpCode, 10) : -1,
      Comments:
        'AppShimano | ' +
        (p.clientName || '') +
        ' | ' +
        (p.month || '') +
        ' | ' +
        (p.ownerEmail || '') +
        discPctSuffix +
        buildEntregaSuffixForRemarks(p),
      NumAtCard: p._fsId || '',
      DiscountPercent: 0,
      U_AppOrigen: 'SHIMANO_APP_VENDEDORES',
      U_AppOrderId: p._fsId || '',
      U_AppBatchId: 'BATCH-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, ''),
      U_TipoGasto: p.condicionPago || 'CONDICION',
      DocumentLines: docLines,
    };
    if (seriesId) payload.Series = seriesId;
    return payload;
  },
};
window.sapSL = sapSL; // expuesto para debug en consola

// window.sapSL ya se expone verbatim al final del bloque.
