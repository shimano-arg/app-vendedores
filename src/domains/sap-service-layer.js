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
  // v688 HARDENING (2026-08-27): campo `password` removido del config cache.
  // La password vive solo en Secret Manager (CF sapProxy). El cliente ya no
  // lee ni cachea la credencial. loadConfig() ignora sl.password aunque el
  // doc todavía lo tenga hasta que se borre en Turno 6.
  config: null, // {url, companyDB, username, enabled}
  sessionAt: 0, // timestamp del ultimo login OK
  sessionTtlMs: 25 * 60 * 1000, // SAP B1 SL default: 30 min. usamos 25 para refresh anticipado.

  // Carga la config desde sapConfigCache (que ya tiene listener en Firestore).
  // v688: NO cachea password — el campo Firestore va a ser borrado y la lectura
  // no debe funcionar aunque exista. Cloud proxy es el único path.
  loadConfig() {
    const sl = sapConfigCache && sapConfigCache.serviceLayer ? sapConfigCache.serviceLayer : {};
    this.config = {
      enabled: !!sl.enabled,
      url: sl.url || '',
      companyDB: sl.companyDB || '',
      username: sl.username || '',
    };
    return this.config;
  },

  isEnabled() {
    this.loadConfig();
    return this.config.enabled && this.config.url && this.config.companyDB && this.config.username;
  },

  // v688 HARDENING (2026-08-27): login() legacy eliminado. Antes hacía
  // POST /Login directo al SL desde el browser con `cfg.password` leído
  // de Firestore. Ese path exponía la credencial al cliente y ya no se
  // usaba en producción (todos con useCloudProxy=true). Cloud proxy hace
  // el login server-side con la password en Secret Manager.
  //
  // Se mantiene el stub que devuelve error para que si algún caller viejo
  // lo llama por accidente, falle explícito en vez de silenciosamente.
  async login() {
    return {
      ok: false,
      error: 'login legacy deshabilitado (v688). Todas las llamadas SL van via sapProxy CF.',
    };
  },

  async ensureSession() {
    // v688: siempre delega al cloud client. El session tracking vive en la CF.
    return { ok: true };
  },

  // v688 HARDENING (2026-08-27): fallback legacy eliminado. Antes, si el
  // bundle no cargaba `__phase0.sap.createSapClient`, caía a fetch directo
  // con `cfg.password` (leído de Firestore). Ahora devuelve error explícito.
  // El bundle es blocking en el <head> — si no cargó, la app entera está
  // rota, no solo SL. Este cambio elimina el único caller cliente de la
  // credencial de Firestore.
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
    const client = this._getCloudClient();
    if (!client) {
      console.error('[sapSL] cloud client no disponible. Bundle no cargó?');
      return {
        ok: false,
        error: 'sapProxy no disponible. Recargá la app o contactá a Mariano.',
        status: 0,
      };
    }
    return client.fetchWithSession(path, options);
  },

  // Crea una Sales Quotation. Recibe el payload ya armado en JSON.
  async createQuotation(payload) {
    return this.fetchWithSession('/b1s/v1/Quotations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // v603 (2026-08-24): cancela una Sales Quotation en SAP.
  // Endpoint SL: POST /b1s/v1/Quotations({docEntry})/Cancel (sin body).
  // La SQ queda marcada Cancelled='tYES' + DocumentStatus='bost_Close'.
  //
  // Uso: cuando el vendedor elimina/revierte un pedido confirmed en la app,
  // llamar cancelQuotation ANTES de tocar Firestore. Si SAP falla, abortar
  // el delete/revert para evitar split brain (app clean + SAP dirty).
  //
  // Roles: solo admin/gerente. El sap-proxy-core.js:23 whitelist WRITE lo
  // permite. Vendedor comun no puede llamar (ni deberia — volverAPendientes
  // ya restringe a admin/gerente, index.html:20747).
  async cancelQuotation(docEntry) {
    const de = parseInt(docEntry, 10);
    if (!de || Number.isNaN(de)) {
      return { ok: false, error: 'docEntry invalido: ' + docEntry, status: 0 };
    }
    return this.fetchWithSession('/b1s/v1/Quotations(' + de + ')/Cancel', {
      method: 'POST',
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
    // v445 (2026-08-11): resolver SalesPersonCode por el vendor del CLIENTE
    // primero, con p.ownerVendor SOLO como fallback.
    //
    // Feedback Mariano: cuando un VDI (Santi/Ioannis) carga un pedido de un
    // cliente que en el CRM es de un VDE (ej. MARIANO PESCA es de Mauricio),
    // la Oferta SAP salia con SalesPersonCode del VDI → admin pensaba que la
    // venta era del VDI cuando en realidad correspondia al VDE del cliente.
    //
    // Root cause: v405 (2026-08-05) invirtio la prioridad para arreglar el
    // caso opuesto (Ioannis metia pedido y quedaba SlpCode vacio), poniendo
    // p.ownerVendor primero. Pero ownerVendor es el vendor del USER QUE
    // CARGA, no del cliente. Cuando el owner es VDI y el cliente tiene VDE
    // asignado, se debe usar el VDE (fuente autoritativa por cliente).
    //
    // Nueva prioridad:
    //   1. getVendorForKey(clientKey)  vendor asignado al CLIENTE (POINTS +
    //      approvedAltasList). Autoritativo.
    //   2. p.ownerVendor               fallback para clientes SAP huerfanos
    //      donde POINTS y approvedAltasList no matchean (fix v405 preservado
    //      para ese caso).
    //   3. ''                          SAP muestra "sin asignar" y admin lo
    //      resuelve al aprobar la Oferta.
    let _resolvedVendor = '';
    if (typeof getVendorForKey === 'function') {
      _resolvedVendor = getVendorForKey(
        p._fsKey ||
          p.tipo + '|' + (p.province || '') + '|' + (p.locName || '') + '|' + (p.clientName || '')
      );
    }
    if (!_resolvedVendor) _resolvedVendor = p.ownerVendor || '';
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
    //
    // v544 E4C (2026-08-19): filtrar por line.state antes de mapear. Solo
    // lineas con state='confirmed' (con stock DISP al confirmar el pedido)
    // van a SAP como SQ. Lineas 'BO' (sin stock) NO se envian - quedan solo
    // en la app hasta que entre stock y pasen a 'ASIG' (via FIFO E4.5).
    // Fallback: pedidos legacy (state undefined o 'legacy') se envian TODAS
    // las lineas para preservar comportamiento pre-E4A (los 56 pedidos
    // migrados en E1 no tienen state real).
    const _isLegacyState = (s) => !s || s === 'legacy';
    const filteredLines = (p.lines || []).filter((l) => {
      if (_isLegacyState(l.state)) return true; // pedido pre-v543, mandar todo
      return l.state === 'confirmed';
    });
    const rawLines = filteredLines.map((l) => ({
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
