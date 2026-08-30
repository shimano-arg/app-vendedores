// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline o bundle previo):
// PRODUCTS, POINTS, orders, confirmed, pending, campaignsCache (bundle dashboard),
// currentOrderKey, currentOrderClient (let en inline, read-only desde el picker,
// resuelven via Global Environment Record compartido), MESES, escapeHtml,
// escapeAttr, titleCase, normTitle, hasStock, saveOrders, getDefaultPrice,
// getCurrentPendingEntry, persistPendingEntry, isCampaignApplicableToVendor
// (bundle campanias), renderSuggestionsForReadonly (inline pedidos).
// Módulo extraído verbatim: tipado real fuera de scope E2.i.
//
// PRODUCT-PICKER: selector de productos para armar pedidos (filtros por categoría/
// familia/subfamilia, buscador, chips de cantidad, stock, sugerencias por MELI).
// Extraído verbatim de index.html (líneas 14554-14976 pre-E2.i) como parte
// de E2.i (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// FIX regla #15: los IIFE const SKU_INDEX y const SKU_TOKENS (que iteran
// PRODUCTS al load) fueron convertidos a lazy getters (getSkuIndex/getSkuTokens)
// porque el bundle IIFE corre pre-inline y PRODUCTS aún es undefined.
// El único consumer externo (wrapper window.matchSkuFromTitle en inline línea
// ~3408) también se actualiza para usar los getters via window.getSkuIndex/Tokens.
//
// Cross-scope state: NONE.  es local al módulo (solo usado por
// flashSaved). No hay listeners onSnapshot.
function populateProductFilters() {
  const cats = [...new Set(PRODUCTS.map((p) => p.cat).filter(Boolean))].sort();
  document.getElementById('pm-cat').innerHTML =
    '<option value="ALL">Categoria: Todas</option>' +
    cats
      .map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>')
      .join('');
  populateFamilias();
}

function populateFamilias() {
  const cat = document.getElementById('pm-cat').value;
  const fams = [
    ...new Set(
      PRODUCTS.filter((p) => cat === 'ALL' || p.cat === cat)
        .map((p) => p.fam)
        .filter(Boolean)
    ),
  ].sort();
  document.getElementById('pm-fam').innerHTML =
    '<option value="ALL">Familia: Todas</option>' +
    fams
      .map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>')
      .join('');
  populateSubfamilias();
}

function populateSubfamilias() {
  const cat = document.getElementById('pm-cat').value;
  const fam = document.getElementById('pm-fam').value;
  const subs = [
    ...new Set(
      PRODUCTS.filter((p) => (cat === 'ALL' || p.cat === cat) && (fam === 'ALL' || p.fam === fam))
        .map((p) => p.sub)
        .filter(Boolean)
    ),
  ].sort();
  document.getElementById('pm-sub').innerHTML =
    '<option value="ALL">Subfamilia: Todas</option>' +
    subs
      .map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>')
      .join('');
}

window.onChangeCategoria = function () {
  populateFamilias();
  renderProductPicker();
};
window.onChangeFamilia = function () {
  populateSubfamilias();
  renderProductPicker();
};

function getActiveCampaignSkusForCurrentOrder() {
  // Devuelve un Map: code -> Array(nombres de campañas activas y aplicables que incluyen ese SKU)
  const out = new Map();
  if (typeof campaignsCache === 'undefined' || !campaignsCache.length) return out;
  if (!currentOrderKey) return out;
  // Determinar vendor del pedido (segun la tienda destino)
  const parts = currentOrderKey.split('|');
  const prov = parts[1] || '',
    locName = parts[2] || '';
  const pt = POINTS.find((p) => p.province === prov && p.name === locName);
  const vendor = pt ? pt.vendor || '' : '';
  const todayISO = new Date().toISOString().slice(0, 10);
  campaignsCache.forEach((c) => {
    if (c.archivedManually) return;
    if (!c.startDate || !c.endDate) return;
    if (c.startDate > todayISO || c.endDate < todayISO) return;
    if (
      typeof isCampaignApplicableToVendor === 'function' &&
      vendor &&
      !isCampaignApplicableToVendor(c, vendor)
    )
      return;
    const skuList = Array.isArray(c.skus)
      ? c.skus
      : Array.isArray(c.filterValues)
        ? c.filterValues
        : [];
    skuList.forEach((code) => {
      if (!out.has(code)) out.set(code, []);
      out.get(code).push(c.name || 'Campaña');
    });
  });
  return out;
}

// Filtro de stock en el picker: 'ALL' | 'OK' (con stock) | 'NO' (sin stock).
// Se cambia desde los 3 botones que estan al lado de Subfamilia.
window.setPmStockFilter = function (val) {
  const wrap = document.querySelector('.pm-stock-filter');
  if (!wrap) return;
  wrap.setAttribute('data-stock', val);
  wrap.querySelectorAll('.pm-stock-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-val') === val);
  });
  renderProductPicker();
};

function renderProductPicker() {
  const cat = document.getElementById('pm-cat').value;
  const fam = document.getElementById('pm-fam').value;
  const sub = document.getElementById('pm-sub').value;
  const q = (document.getElementById('pm-search').value || '').toLowerCase().trim();
  // Filtro stock (Todos / Disponibles / No disp). Si hasStock(code) devuelve
  // null (snapshot stock no cargado todavia) lo tratamos como "no se sabe":
  //   - en modo Disponibles: lo ocultamos (mejor mostrar nada que falso positivo).
  //   - en modo No disp: tampoco lo mostramos (no podemos afirmar que no haya).
  const stockFilterEl = document.querySelector('.pm-stock-filter');
  const stockFilter = stockFilterEl ? stockFilterEl.getAttribute('data-stock') : 'ALL';
  let currentLines;
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    currentLines = entry ? entry.lines || [] : [];
  } else {
    currentLines = orders[currentOrderKey] || [];
  }
  const inOrder = new Set(currentLines.map((l) => l.code));
  const campMap = getActiveCampaignSkusForCurrentOrder();
  // v617 (2026-08-25): resolver cardCode del cliente actual para poder mostrar
  // badges ASIG (stock asignado) y BO (backorder) por SKU. Cuando el vendedor
  // esta armando un pedido, ver "este cliente ya tiene 3u ASIG de este SKU" o
  // "5u en BO" es info critica que evita duplicar demanda.
  const _clientCardCode =
    currentOrderClient && currentOrderClient.name && typeof window.sapGetClienteCode === 'function'
      ? window.sapGetClienteCode(currentOrderClient.name) || ''
      : '';
  const _asigByClient = (typeof window !== 'undefined' && window.STOCK_ASIG_BY_CLIENT_APP) || {};
  const _boByClient = (typeof window !== 'undefined' && window.STOCK_BO_BY_CLIENT_APP) || {};
  const filt = PRODUCTS.filter((p) => {
    if (cat !== 'ALL' && p.cat !== cat) return false;
    if (fam !== 'ALL' && p.fam !== fam) return false;
    if (sub !== 'ALL' && p.sub !== sub) return false;
    if (q && !(p.code.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q))) return false;
    if (stockFilter !== 'ALL') {
      const has = typeof hasStock === 'function' ? hasStock(p.code) : null;
      if (stockFilter === 'OK' && has !== true) return false;
      if (stockFilter === 'NO' && has !== false) return false;
    }
    return true;
  }).slice(0, 200);
  let html = '';
  filt.forEach((p) => {
    const inCamp = campMap.has(p.code);
    let cls = 'prod-row';
    if (inOrder.has(p.code)) cls += ' in-order';
    if (inCamp) cls += ' in-camp';
    // v605 E5: sumar qty de TODAS las lineas del mismo code. Con v600 split,
    // el pedido puede tener 2 lineas del mismo SKU ({confirmed:70, BO:30});
    // el stepper debe mostrar 100 (total pedido), no 70 (solo confirmed).
    const curQty = Math.round(
      currentLines
        .filter((l) => l && l.code === p.code)
        .reduce((s, l) => s + (parseFloat(l.qty) || 0), 0)
    );
    const campTitle = inCamp ? 'Producto en campaña activa: ' + campMap.get(p.code).join(', ') : '';
    const campBadge = inCamp
      ? '<span class="camp-badge" title="' + escapeAttr(campTitle) + '">★ CAMP</span>'
      : '';
    // v617: badges ASIG (violeta) y BO (naranja) del cliente actual para este SKU.
    // Ayuda a evitar duplicar demanda del mismo cliente.
    let asigBadge = '';
    let boBadge = '';
    if (_clientCardCode) {
      const _key = _clientCardCode + '::' + String(p.code).toUpperCase();
      const _asigQty = Number(_asigByClient[_key]) || 0;
      const _boQty = Number(_boByClient[_key]) || 0;
      if (_asigQty > 0) {
        asigBadge =
          ' <span style="background:var(--color-accent-violet);color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:800;vertical-align:middle" title="Cliente tiene ' +
          _asigQty +
          'u en STOCK ASIGNADO (fue backorder, entro stock). Confirmar puede duplicar demanda.">&#127919; ASIG ' +
          _asigQty +
          '</span>';
      }
      if (_boQty > 0) {
        boBadge =
          ' <span style="background:#f97316;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:800;vertical-align:middle" title="Cliente tiene ' +
          _boQty +
          'u en BACKORDER APP (pedido sin stock). Agregar puede duplicar.">&#128227; BO ' +
          _boQty +
          '</span>';
      }
    }
    // Si ya hay cantidad, mostrar stepper [-][n][+] para poder subir, bajar o tipear directo.
    let ctrlHtml;
    if (curQty > 0) {
      const safeCode = escapeAttr(p.code);
      ctrlHtml = '<div class="qty-stepper" onclick="event.stopPropagation()">';
      ctrlHtml +=
        '<button class="minus" onclick="event.stopPropagation();decrementOrder(\'' +
        safeCode +
        '\')" title="Restar 1">&minus;</button>';
      ctrlHtml +=
        '<input type="number" min="0" step="1" inputmode="numeric" value="' +
        curQty +
        '" onclick="event.stopPropagation();this.select()" onchange="event.stopPropagation();setOrderQty(\'' +
        safeCode +
        '\', this.value)" title="Tipear cantidad"/>';
      ctrlHtml +=
        '<button class="plus" onclick="event.stopPropagation();addToOrder(\'' +
        safeCode +
        '\')" title="Sumar 1">+</button>';
      ctrlHtml += '</div>';
    } else {
      ctrlHtml =
        '<button class="add-btn" onclick="event.stopPropagation();addToOrder(\'' +
        escapeAttr(p.code) +
        '\')" title="Agregar al pedido">+</button>';
    }
    // Indicador de stock SAP. Punto verde = hay disponible venta (whs 11);
    // ambar = SIN disponible pero hay en transito (whs 12, va a entrar);
    // rojo = sin stock en ningun warehouse; gris = sin datos.
    // v369+ (2026-07-31): distingue disponible vs transito para evitar que
    // el vendedor asuma "hay 180 unidades disponibles" cuando en realidad
    // esas 180 estan en transito y hay 0 vendibles hoy.
    const stockSt = hasStock(p.code);
    // v705 (2026-08-28): usar getStockRealmenteDisponible (fisico - compromisos-app
    // confirmed+BO+ASIG) para que el picker refleje el stock que el vendedor
    // realmente puede prometer, no el fisico crudo. Antes usaba
    // getStockDisponibleVenta (fisico dep 11 raw) → el vendedor podia ver 45u
    // cuando en realidad ya habia 40u comprometidas y solo quedaban 5u libres.
    const dispReal =
      typeof window.getStockRealmenteDisponible === 'function'
        ? window.getStockRealmenteDisponible(p.code)
        : null;
    const dispFisico =
      typeof window.getStockDisponibleVenta === 'function'
        ? window.getStockDisponibleVenta(p.code)
        : null;
    const disp = dispReal != null ? dispReal : dispFisico;
    const trans =
      typeof window.getStockTransito === 'function' ? window.getStockTransito(p.code) : null;
    // v705: badge visible con el nro de unidades disponibles REAL (max amarillo
    // pastel) al lado del stockDot. Ayuda al vendedor a decidir la qty sin abrir
    // tooltips.
    let dispBadge = '';
    if (disp != null && disp > 0) {
      const dispBadgeTitle =
        dispFisico != null && dispFisico !== disp
          ? 'Disponible REAL: ' +
            disp +
            ' u (fisico dep 11: ' +
            dispFisico +
            ' - reservado: ' +
            (dispFisico - disp) +
            ')'
          : 'Disponible: ' + disp + ' u';
      dispBadge =
        ' <span style="background:#fef9c3;color:#78350f;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:800;vertical-align:middle;border:1px solid #fde68a" title="' +
        escapeAttr(dispBadgeTitle) +
        '">' +
        disp +
        ' libres</span>';
    }
    let stockDot = '';
    if (stockSt === true && disp != null && disp === 0 && trans != null && trans > 0) {
      // Ambar: 0 disponible pero N en transito -> se puede prometer con fecha estimada.
      stockDot =
        '<span class="stock-dot" style="background:var(--color-warning)" title="0 disponible en deposito 11 pero ' +
        trans +
        ' unidades en transito (deposito 12) — se puede vender como backorder"></span>';
    } else if (stockSt === true) {
      // v705: tooltip enriquecido con desglose fisico vs real.
      const t =
        disp != null
          ? 'Disponible real (fisico - compromisos-app): ' +
            disp +
            ' uds' +
            (dispFisico != null && dispFisico !== disp
              ? ' (fisico dep 11: ' + dispFisico + ', reservado: ' + (dispFisico - disp) + ')'
              : '') +
            (trans > 0 ? ' + ' + trans + ' en transito' : '')
          : 'Disponible en depositos vendibles';
      stockDot = '<span class="stock-dot ok" title="' + escapeAttr(t) + '"></span>';
    } else if (stockSt === false) {
      stockDot = '<span class="stock-dot no" title="Sin stock en ningun deposito vendible"></span>';
    } else {
      stockDot = '<span class="stock-dot na" title="Sin datos de stock"></span>';
    }
    html +=
      '<div class="' +
      cls +
      '" onclick="addToOrder(\'' +
      escapeAttr(p.code) +
      '\')"' +
      (inCamp ? ' title="' + escapeAttr(campTitle) + '"' : '') +
      '>';
    html +=
      '<div class="code">' +
      stockDot +
      escapeHtml(p.code) +
      dispBadge +
      campBadge +
      asigBadge +
      boBadge +
      '</div>';
    html += '<div><div class="pdesc">' + escapeHtml(p.desc) + '</div>';
    html +=
      '<div class="pcat"><span>' +
      escapeHtml(p.cat) +
      '</span><span>' +
      escapeHtml(p.fam) +
      '</span><span>' +
      escapeHtml(p.sub) +
      '</span></div></div>';
    html += ctrlHtml + '</div>';
  });
  if (!filt.length) html = '<div class="no-data">Sin productos para estos filtros.</div>';
  document.getElementById('pm-products').innerHTML = html;
}
window.renderProductPicker = renderProductPicker;

// v542: chequea si el cliente actual ya tiene el SKU asignado (backorder SAP
// con stock disponible). Devuelve false si el user cancelo el confirm — en
// ese caso no se debe agregar la linea.
function _checkAsigDuplicadoCliente(code) {
  try {
    if (!currentOrderClient || !currentOrderClient.name) return true;
    if (typeof window.sapGetClienteCode !== 'function') return true;
    if (typeof window._sapAsigMatchParaCliente !== 'function') return true;
    const cardCode = window.sapGetClienteCode(currentOrderClient.name);
    if (!cardCode) return true;
    const match = window._sapAsigMatchParaCliente(cardCode, code);
    if (!match) return true;
    return window._confirmDuplicadoAsig(match); // true=agregar, false=cancelar
  } catch (e) {
    console.warn('_checkAsigDuplicadoCliente', e);
    return true; // fail-open: si falla la validacion, no bloquear
  }
}

function addToOrder(code) {
  if (!currentOrderKey || currentOrderKey === '__readonly__') return;
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    if (!entry) return;
    if (!entry.lines) entry.lines = [];
    const existing = entry.lines.find((l) => l.code === code);
    if (existing) {
      existing.qty = (parseFloat(existing.qty) || 0) + 1;
    } else {
      if (!_checkAsigDuplicadoCliente(code)) return; // v542
      const prod = PRODUCTS.find((p) => p.code === code);
      if (!prod) return;
      entry.lines.push({
        code: prod.code,
        desc: prod.desc,
        cat: prod.cat,
        fam: prod.fam,
        sub: prod.sub,
        qty: 1,
        precio: getDefaultPrice(prod.code),
      });
    }
    persistPendingEntry(entry);
    flashSaved();
    renderOrderLines();
    renderProductPicker();
    if (currentOrderClient)
      renderSuggestionsForReadonly(currentOrderClient.name, currentOrderClient.province);
    return;
  }
  if (!orders[currentOrderKey]) orders[currentOrderKey] = [];
  const ord = orders[currentOrderKey];
  const existing = ord.find((l) => l.code === code);
  if (existing) {
    existing.qty = (parseFloat(existing.qty) || 0) + 1;
  } else {
    if (!_checkAsigDuplicadoCliente(code)) return; // v542
    const prod = PRODUCTS.find((p) => p.code === code);
    if (!prod) return;
    ord.push({
      code: prod.code,
      desc: prod.desc,
      cat: prod.cat,
      fam: prod.fam,
      sub: prod.sub,
      qty: 1,
      precio: getDefaultPrice(prod.code),
    });
  }
  saveOrders();
  flashSaved();
  renderOrderLines();
  renderProductPicker();
}
window.addToOrder = addToOrder;

function setOrderQty(code, qty) {
  if (!currentOrderKey) return;
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    if (!entry || !entry.lines) return;
    const line = entry.lines.find((l) => l.code === code);
    if (!line) return;
    const q = parseFloat(qty);
    if (Number.isNaN(q) || q <= 0) {
      entry.lines = entry.lines.filter((l) => l.code !== code);
    } else {
      line.qty = q;
    }
    persistPendingEntry(entry);
    flashSaved();
    renderOrderLines();
    renderProductPicker();
    if (currentOrderClient)
      renderSuggestionsForReadonly(currentOrderClient.name, currentOrderClient.province);
    return;
  }
  const ord = orders[currentOrderKey] || [];
  const line = ord.find((l) => l.code === code);
  if (!line) return;
  const q = parseFloat(qty);
  if (Number.isNaN(q) || q <= 0) {
    orders[currentOrderKey] = ord.filter((l) => l.code !== code);
  } else {
    line.qty = q;
  }
  saveOrders();
  flashSaved();
  renderOrderLines();
  renderProductPicker();
}
window.setOrderQty = setOrderQty;

function decrementOrder(code) {
  if (!currentOrderKey || currentOrderKey === '__readonly__') return;
  let curLines;
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    curLines = entry ? entry.lines || [] : [];
  } else {
    curLines = orders[currentOrderKey] || [];
  }
  const line = curLines.find((l) => l.code === code);
  if (!line) return;
  const newQty = (parseFloat(line.qty) || 0) - 1;
  if (newQty <= 0) {
    removeFromOrder(code);
  } else {
    setOrderQty(code, newQty);
  }
}
window.decrementOrder = decrementOrder;

function setOrderPrice(code, price) {
  const p = parseFloat(price);
  const newPrice = Number.isNaN(p) || p < 0 ? 0 : p;
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    if (!entry || !entry.lines) return;
    const line = entry.lines.find((l) => l.code === code);
    if (!line) return;
    line.precio = newPrice;
    persistPendingEntry(entry);
    flashSaved();
    return;
  }
  if (!currentOrderKey || currentOrderKey === '__readonly__') return;
  const ord = orders[currentOrderKey] || [];
  const line = ord.find((l) => l.code === code);
  if (!line) return;
  line.precio = newPrice;
  saveOrders();
  flashSaved();
}
window.setOrderPrice = setOrderPrice;

function removeFromOrder(code) {
  if (!currentOrderKey || currentOrderKey === '__readonly__') return;
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    if (!entry) return;
    entry.lines = (entry.lines || []).filter((l) => l.code !== code);
    persistPendingEntry(entry);
    flashSaved();
    renderOrderLines();
    renderProductPicker();
    if (currentOrderClient)
      renderSuggestionsForReadonly(currentOrderClient.name, currentOrderClient.province);
    return;
  }
  orders[currentOrderKey] = (orders[currentOrderKey] || []).filter((l) => l.code !== code);
  saveOrders();
  flashSaved();
  renderOrderLines();
  renderProductPicker();
}
window.removeFromOrder = removeFromOrder;

// normTitle: movido al bundle (window.normTitle vía __phase0.pure).

// Indice: SKU code (normalizado) -> producto. Lazy init (regla #15 CLAUDE.md):
// PRODUCTS no existe cuando el bundle IIFE corre, se construye al primer uso.
let _skuIndex = null;
function getSkuIndex() {
  if (!_skuIndex) {
    _skuIndex = {};
    PRODUCTS.forEach((p) => {
      const k = normTitle(p.code);
      if (k.length >= 3) _skuIndex[k] = p;
    });
  }
  return _skuIndex;
}

// Indice por familia/subfamilia: { token: [products] } para matcheo por descripcion. Lazy init.
let _skuTokens = null;
function getSkuTokens() {
  if (!_skuTokens) {
    _skuTokens = {};
    PRODUCTS.forEach((p) => {
      const tokens = new Set();
      [p.sub, p.fam].forEach((s) => {
        if (!s) return;
        const norm = normTitle(s);
        if (norm.length >= 3) tokens.add(norm);
      });
      tokens.forEach((t) => {
        if (!_skuTokens[t]) _skuTokens[t] = [];
        _skuTokens[t].push(p);
      });
    });
  }
  return _skuTokens;
}

// matchSkuFromTitle: movido al bundle (window.matchSkuFromTitle vía __phase0.pure con wrapper).

function _renderSuggestions() {
  if (!currentOrderClient || currentOrderKey === '__readonly__') return;
  const box = document.getElementById('pm-suggest-box');
  const listEl = document.getElementById('pm-suggest');
  const infoEl = document.getElementById('pm-suggest-info');
  const province = currentOrderClient.province;

  // Agregar productos de pedidos CONFIRMADOS de otras casas de pesca de la misma provincia
  const agg = {}; // code -> {qty, shops:Set, sampleLine}
  const peerShops = new Set();
  Object.entries(confirmed).forEach(([k, list]) => {
    if (!list || !list.length) return;
    const parts = k.split('|');
    const prov = parts[1];
    const clientName = parts[3];
    if (prov !== province) return;
    if (clientName === currentOrderClient.name) return; // excluir cliente actual
    peerShops.add(clientName);
    list.forEach((c) => {
      (c.lines || []).forEach((l) => {
        if (!l.code) return;
        if (!agg[l.code]) agg[l.code] = { qty: 0, shops: new Set(), line: l };
        agg[l.code].qty += parseFloat(l.qty) || 0;
        agg[l.code].shops.add(clientName);
      });
    });
  });

  // SKUs ya en el pedido actual
  const inOrder = new Set((orders[currentOrderKey] || []).map((l) => l.code));

  // Ordenar por # casas (popularidad) y luego por unidades
  const suggestions = Object.entries(agg)
    .filter(([code]) => !inOrder.has(code))
    .map(([code, d]) => ({
      code,
      qty: d.qty,
      shops: d.shops.size,
      shopList: [...d.shops].sort(),
      line: d.line,
    }))
    .sort((a, b) => b.shops - a.shops || b.qty - a.qty)
    .slice(0, 8);

  box.classList.remove('hidden');
  infoEl.textContent = peerShops.size + ' casa(s) confirmadas en ' + titleCase(province);

  if (!suggestions.length) {
    let msg;
    if (peerShops.size === 0) {
      msg =
        'Aun no hay pedidos confirmados de otras casas de pesca en <b>' +
        escapeHtml(titleCase(province)) +
        '</b>.<br><span style="font-size:9px">Las sugerencias se construyen a partir de los pedidos confirmados en el sistema.</span>';
    } else {
      msg =
        'Las casas de pesca de <b>' +
        escapeHtml(titleCase(province)) +
        '</b> ya tienen sus productos cubiertos por el pedido actual.';
    }
    listEl.innerHTML = '<div class="suggest-empty-msg">' + msg + '</div>';
    return;
  }

  let html = '';
  suggestions.forEach((s) => {
    const masterProd = PRODUCTS.find((p) => p.code === s.code);
    const desc = (masterProd && masterProd.desc) || s.line.desc || s.code;
    // Mostrar nombres de las casas: hasta 3, sino "X, Y y N mas"
    let shopsText;
    if (s.shopList.length <= 3) {
      shopsText = s.shopList.join(', ');
    } else {
      shopsText = s.shopList.slice(0, 2).join(', ') + ' y ' + (s.shopList.length - 2) + ' mas';
    }
    const shopsTitle = s.shopList.join(' | ');
    html += '<div class="suggest-row" onclick="addToOrder(\'' + escapeAttr(s.code) + '\')">';
    html += '<div class="code">' + escapeHtml(s.code) + '</div>';
    html += '<div><div class="sname">' + escapeHtml(desc) + '</div>';
    html +=
      '<div class="sinfo" title="' +
      escapeHtml(shopsTitle) +
      '">Pidieron: ' +
      escapeHtml(shopsText) +
      ' &middot; ' +
      s.qty +
      ' unid.</div></div>';
    html +=
      '<button class="add-sg" onclick="event.stopPropagation();addToOrder(\'' +
      escapeAttr(s.code) +
      '\')" title="Agregar al pedido">+</button>';
    html += '</div>';
  });
  listEl.innerHTML = html;
}

function renderOrderLines() {
  let ord;
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    ord = entry ? entry.lines || [] : [];
  } else {
    ord = orders[currentOrderKey] || [];
  }
  let totalU = 0;
  let html = '';
  ord.forEach((l) => {
    const q = parseFloat(l.qty) || 0;
    const pr = parseFloat(l.precio) || 0;
    totalU += q;
    html += '<div class="ped-line">';
    html += '<div class="pcode">' + escapeHtml(l.code) + '</div>';
    html += '<div class="pname">' + escapeHtml(l.desc) + '</div>';
    html +=
      '<input type="number" class="qty" min="0" step="any" value="' +
      pr +
      '" placeholder="$" title="Precio unitario" onchange="setOrderPrice(\'' +
      escapeAttr(l.code) +
      '\', this.value)"/>';
    html +=
      '<input type="number" class="qty" min="0" step="1" value="' +
      q +
      '" title="Cantidad" onchange="setOrderQty(\'' +
      escapeAttr(l.code) +
      '\', this.value)"/>';
    html +=
      '<button class="rm-btn" onclick="removeFromOrder(\'' +
      escapeAttr(l.code) +
      '\')" title="Quitar">&times;</button>';
    html += '</div>';
  });
  if (!ord.length)
    html = '<div class="no-data">Sin productos cargados. Agregue desde la izquierda.</div>';
  document.getElementById('pm-lines').innerHTML = html;
  document.getElementById('pm-line-count').textContent = ord.length + ' producto(s) en pedido';
  document.getElementById('pm-units').textContent = totalU + ' unidades';
}

let savedTimer = null;
function flashSaved() {
  const el = document.getElementById('pm-saved-tag');
  if (!el) return;
  el.textContent = 'Guardado ' + new Date().toLocaleTimeString();
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el.textContent = 'Sin cambios';
  }, 2500);
}

// === Exports a window para callers cross-scope ===
// - populateProductFilters, renderProductPicker, renderOrderLines: llamadas
//   desde inline pedidos modal (líneas ~13484-86, ~13791-93, ~13870-71) y desde
//   listeners de STOCK/PRODUCTS (líneas ~3554, ~17493, ~19690 pre-E2.i).
// - getSkuIndex, getSkuTokens: usadas por el wrapper window.matchSkuFromTitle
//   en el inline (línea ~3408 pre-E2.i, actualizado en este commit).
// - Resto de handlers ya son window.foo = function... verbatim.
window.populateProductFilters = populateProductFilters;
window.renderProductPicker = renderProductPicker;
window.renderOrderLines = renderOrderLines;
window.getSkuIndex = getSkuIndex;
window.getSkuTokens = getSkuTokens;
// E6 hotfix 3: cross-module bug — pedidos-modal.js llama flashSaved.
window.flashSaved = flashSaved;
