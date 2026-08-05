// @ts-nocheck
// PEDIDOS-MODAL: modal editor de pedido (crear/editar borrador + review dialog
// + confirm dialog + doConfirmPedido en primer variant + cancelPedido +
// picker de acting-as VDE). Extraído verbatim de index.html (líneas 12195-12969
// pre-E2.j.1) como parte de E2.j.1 (e2b-perf 2026-07-28).
//
// FRAGMENTO PARCIAL del dominio pedidos. Los otros 2 fragmentos siguen en
// inline por complejidad + centralidad del dominio:
// - Fragmento A (L4410-4453): const ORDERS_KEY + let orders/pending/confirmed +
//   saveOrders/savePending/saveConfirmed/orderKey helpers.
// - Fragmento C (L13279+, ~18820-19246): unsubPedidosOwn/All + globalPedidos +
//   listeners onSnapshot + doConfirmPedido (2da versión que sobrescribe) +
//   confirmarDefinitivo (2da) + eliminarPendiente (2da) + volverABorrador (2da) +
//   volverAPendientes.
//
// KNOWN BUG preservado verbatim: doConfirmPedido, confirmarDefinitivo,
// eliminarPendiente, volverABorrador están declaradas 2 veces (fragmento B
// y fragmento C). La 2da definición del fragmento C sobrescribe la 1ra en
// runtime. TODO E6 code review: consolidar en una sola versión.
//
// Cross-scope state (via window):
// - window.currentOrderKey / window.currentOrderClient: LEÍDAS por product-picker.js
//   bundle (renderProductPicker, addToOrder, setOrderQty, etc.). ESCRITAS solo
//   dentro de este fragmento B (openPedidoModal, cancelPedido).
//
// Deps del inline: orders (fragmento A), pending (A), confirmed (A), fbDb,
// firebase, currentUser, userRole, VENDORS, MESES, escapeHtml, titleCase,
// showSyncTag, saveOrders (A), savePending (A), saveConfirmed (A), orderKey (A),
// setPedidoView, renderPendientesList (inline auxiliar), renderConfirmadosList,
// getPriceInfo (inline pricing), calcClientDiscount (bundle __phase0.pure),
// getSkuIndex/Tokens (bundle product-picker), renderProductPicker (bundle),
// renderOrderLines (bundle), addToOrder (bundle), setOrderQty (bundle),
// removeFromOrder (bundle), setOrderPrice (bundle), matchSkuFromTitle (bundle).
// === Modal de pedido: filtros + picker + lineas ===
if (typeof window.currentOrderKey === 'undefined') window.currentOrderKey = null;
if (typeof window.currentOrderClient === 'undefined') window.currentOrderClient = null;

function openPedidoModal(clientName, tipo, province, locName) {
  window.currentOrderKey = orderKey(clientName, province, locName, tipo);
  window.currentOrderClient = {
    name: clientName,
    tipo: tipo,
    province: province,
    locName: locName,
  };
  document.getElementById('pm-name').textContent = clientName;
  const tipoLbl = tipo === 'C' ? 'Cliente actual' : 'Prospecto';
  document.getElementById('pm-meta').innerHTML =
    '<span class="badge tipo">' +
    tipoLbl +
    '</span>' +
    '<span class="badge prov">' +
    escapeHtml(titleCase(province)) +
    '</span>' +
    '<span>' +
    escapeHtml(locName) +
    '</span>';
  document.getElementById('pm-search').value = '';
  populateProductFilters();
  renderProductPicker();
  renderOrderLines();
  // Sugeridos no se muestran al crear/editar; solo en CONFIRMADOS
  document.getElementById('pm-suggest-box').classList.add('hidden');
  document.getElementById('pm-saved-tag').textContent = 'Sin cambios';
  document.getElementById('pm-actions-edit').style.display = 'flex';
  document.getElementById('pm-actions-pending').style.display = 'none';
  document.getElementById('pm-confirm').style.display = '';
  document.getElementById('pm-cancel').style.display = '';
  // Modo Crear: ocultar la columna derecha (Pedido Actual) y dar todo el ancho al picker.
  // Limpiar clases de modos anteriores (pending-suggest-only/confirmed-only) por si quedaron.
  const bodyEl = document.querySelector('#pedido-modal .pedido-body');
  bodyEl.classList.remove('pending-suggest-only', 'confirmed-only');
  bodyEl.classList.add('crear-mode');
  document.getElementById('pedido-modal').classList.add('open');
}

// Boton "Confirmar pedido": en modo Crear abre la revision; en modo Pending va directo al mes/anio.
window.onClickConfirmPedido = function () {
  if (currentOrderKey === '__pending__' || currentOrderKey === '__readonly__') {
    openConfirmDialog();
    return;
  }
  openReviewDialog();
};

window.cancelPedido = function () {
  console.log(
    '[cancelPedido] currentOrderKey=',
    currentOrderKey,
    'client=',
    currentOrderClient && currentOrderClient.name
  );
  if (!currentOrderKey || currentOrderKey === '__readonly__') {
    console.warn('[cancelPedido] key invalido o readonly, cerrando modal');
    closePedidoModal();
    return;
  }
  const ord = orders[currentOrderKey] || [];
  const nItems = ord.length;
  console.log('[cancelPedido] items en el pedido:', nItems);
  const clientName = (currentOrderClient && currentOrderClient.name) || 'este cliente';
  // Siempre confirmar (incluso con 0 items - para dar feedback al vendedor
  // que la accion se ejecuto). Antes con 0 items cerraba silencioso y el
  // vendedor no entendia si habia pasado algo.
  const msg =
    nItems > 0
      ? 'Eliminar los ' +
        nItems +
        ' producto(s) del pedido de "' +
        clientName +
        '"?\n\nEsta accion no se puede deshacer.'
      : 'Cerrar el pedido de "' + clientName + '" sin cargar nada?';
  if (!confirm(msg)) return;
  try {
    logOp('cancelar_borrador_pedido', 'pedido', clientName, {
      key: currentOrderKey,
      items: nItems,
      province: currentOrderClient && currentOrderClient.province,
      locName: currentOrderClient && currentOrderClient.locName,
    });
  } catch (_e) {}
  const keyToDelete = currentOrderKey;
  // 1) Local: borrar la key del objeto en memoria + localStorage.
  delete orders[keyToDelete];
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  } catch (_e) {}
  console.log(
    '[cancelPedido] orders[key] borrado localmente. orders restantes:',
    Object.keys(orders).length
  );
  // 2) Firestore: BUG CRITICO que estabamos arrastrando - saveOrders hace
  //    .set({orders: orders}, {merge: true}) que hace DEEP MERGE de objetos
  //    anidados. Las keys borradas localmente NO se borran en Firestore.
  //    Cuando el listener trae de vuelta el snapshot, hace orders = data.orders
  //    con las keys viejas -> el pedido cancelado 'revive' y queda EN CURSO.
  //    Fix: usar FieldPath + FieldValue.delete() para borrar la key
  //    especifica en el server. FieldPath maneja los caracteres especiales
  //    como '|' (que rompen dot notation).
  if (currentUser && fbDb) {
    try {
      const suppress = suppressCloudSave; // guardar flag actual
      suppressCloudSave = true; // que saveOrders no dispare cloud
      const fieldPath = new firebase.firestore.FieldPath('orders', keyToDelete);
      fbDb
        .collection('userData')
        .doc(currentUser.uid)
        .update(fieldPath, firebase.firestore.FieldValue.delete())
        .catch(function (e) {
          // Puede fallar si el doc no existe todavia (usuario nuevo). En ese
          // caso no hay nada que borrar - el estado local ya esta OK.
          console.warn(
            '[cancelPedido] no pude borrar la key del cloud (puede ser normal):',
            e && e.message
          );
        })
        .finally(function () {
          suppressCloudSave = suppress;
        });
    } catch (e) {
      console.error('[cancelPedido] error escribiendo delete a Firestore:', e);
    }
  }
  // Rerender inmediato del picker y de lineas por si el modal queda visible
  // (algunos flows del modal reciclan el key sin cerrar).
  try {
    if (typeof renderProductPicker === 'function') renderProductPicker();
  } catch (_e) {}
  try {
    if (typeof renderOrderLines === 'function') renderOrderLines();
  } catch (_e) {}
  closePedidoModal();
  if (typeof showSyncTag === 'function')
    showSyncTag('Pedido cancelado (' + nItems + ' items eliminados)');
};

let reviewMode = 'crear'; // 'crear' | 'pending-confirm'

window.openReviewDialog = function (mode) {
  reviewMode = mode || 'crear';
  let lines;
  if (reviewMode === 'pending-confirm') {
    if (!currentOrderClient || currentOrderClient.stage !== 'pending') return;
    const entry = getCurrentPendingEntry();
    if (!entry) return;
    lines = entry.lines || [];
  } else {
    if (!currentOrderKey || currentOrderKey === '__readonly__') return;
    lines = orders[currentOrderKey] || [];
  }
  if (!lines.length) {
    alert('El pedido esta vacio. Agregue productos antes de confirmar.');
    return;
  }
  // Limpiar banner de error de sesion anterior.
  try {
    if (typeof showReviewError === 'function') showReviewError('');
  } catch (_e) {}
  // v281+: reset del buscador para que no arrastre el filtro de una sesion previa.
  window._reviewSearchQuery = '';
  const _rvSearch = document.getElementById('rv-search');
  if (_rvSearch) _rvSearch.value = '';
  // Reset del dropdown de forma de pago - no arrastrar seleccion previa.
  const fpSel = document.getElementById('rv-forma-pago');
  if (fpSel) fpSel.value = '';
  // Reset del bloque forma de entrega + sus campos condicionales.
  const feSel = document.getElementById('rv-forma-entrega');
  if (feSel) feSel.value = '';
  [
    'rv-transp-nombre',
    'rv-transp-direccion',
    'rv-cliente-direccion',
    'rv-sucursal-direccion',
    'rv-retiro-nombre',
    'rv-retiro-apellido',
    'rv-retiro-dni',
    'rv-retiro-patente',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const bTransp = document.getElementById('rv-entrega-transp-block');
  const bSucursal = document.getElementById('rv-entrega-sucursal-block');
  const bRetiro = document.getElementById('rv-entrega-retiro-block');
  if (bTransp) bTransp.style.display = 'none';
  if (bSucursal) bSucursal.style.display = 'none';
  if (bRetiro) bRetiro.style.display = 'none';
  renderReviewLines();
  renderReviewSuggestions();
  updateReviewFooter();
  document.getElementById('review-modal').classList.add('open');
};

window.closeReviewDialog = function () {
  document.getElementById('review-modal').classList.remove('open');
};

// Validaciones + abrir el confirm-dialog. Reemplaza al viejo
// 'closeReviewDialog();openConfirmDialog()' que fallaba silenciosamente:
// si algo faltaba, se cerraba el review y salia un alert nativo en un
// contexto donde el vendedor no lo entendia. Ahora validamos ANTES,
// mostramos error VISIBLE dentro del modal review y solo cerramos si
// todo esta OK.
//
// IMPORTANTE: no bloqueamos por falta de stock. SKUs sin stock salen
// en rojo pero pueden estar en el pedido - solo advertencia visual.
window.validateReviewAndPasarAPendientes = function () {
  try {
    console.log('[pedido] validateReviewAndPasarAPendientes: start', {
      currentOrderKey: currentOrderKey,
      currentOrderClient: currentOrderClient,
      ordersLen: (orders[currentOrderKey] || []).length,
    });
    // Limpiar cualquier error anterior visible.
    showReviewError('');
    // 1) Sanity: hay pedido con lineas?
    let ord = [];
    if (currentOrderClient && currentOrderClient.stage === 'pending') {
      const entry = typeof getCurrentPendingEntry === 'function' ? getCurrentPendingEntry() : null;
      ord = entry ? entry.lines || [] : [];
    } else if (currentOrderKey && currentOrderKey !== '__readonly__') {
      ord = orders[currentOrderKey] || [];
    }
    if (!ord.length) {
      showReviewError('El pedido esta vacio. Agregua productos antes de pasar a Pendientes.');
      return;
    }
    // 2) Forma de pago obligatoria.
    const fpSel = document.getElementById('rv-forma-pago');
    const fpVal = fpSel && fpSel.value ? fpSel.value : '';
    if (!fpVal) {
      showReviewError('Falta elegir la FORMA DE PAGO (arriba en este mismo modal).');
      if (fpSel) {
        try {
          fpSel.focus();
          fpSel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_e) {}
      }
      return;
    }
    // 3) Forma de entrega obligatoria + sub-campos condicionales.
    const feSel = document.getElementById('rv-forma-entrega');
    const feVal = feSel && feSel.value ? feSel.value : '';
    if (!feVal) {
      showReviewError('Falta elegir la FORMA DE ENTREGA (arriba en este mismo modal).');
      if (feSel) {
        try {
          feSel.focus();
          feSel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_e) {}
      }
      return;
    }
    const transpNombre = ((document.getElementById('rv-transp-nombre') || {}).value || '').trim();
    const transpDireccion = (
      (document.getElementById('rv-transp-direccion') || {}).value || ''
    ).trim();
    const clienteDireccion = (
      (document.getElementById('rv-cliente-direccion') || {}).value || ''
    ).trim();
    const sucursalDireccion = (
      (document.getElementById('rv-sucursal-direccion') || {}).value || ''
    ).trim();
    // v397 (2026-08-04): 4 campos para RETIRO_DEPOSITO.
    const retiroNombre = ((document.getElementById('rv-retiro-nombre') || {}).value || '').trim();
    const retiroApellido = (
      (document.getElementById('rv-retiro-apellido') || {}).value || ''
    ).trim();
    const retiroDni = ((document.getElementById('rv-retiro-dni') || {}).value || '').trim();
    const retiroPatente = ((document.getElementById('rv-retiro-patente') || {}).value || '').trim();
    if (feVal === 'TRANSPORTISTA') {
      // 3 campos obligatorios: nombre + direccion del transportista + direccion
      // de entrega FINAL al cliente (donde el transportista entrega).
      if (!transpNombre || !transpDireccion || !clienteDireccion) {
        const faltantes = [];
        if (!transpNombre) faltantes.push('NOMBRE del transportista');
        if (!transpDireccion) faltantes.push('DIRECCION del transportista');
        if (!clienteDireccion) faltantes.push('DIRECCION DE ENTREGA AL CLIENTE');
        showReviewError(
          'Elegiste "Entregar a transportista": falta completar ' + faltantes.join(' + ') + '.'
        );
        const targetId = !transpNombre
          ? 'rv-transp-nombre'
          : !transpDireccion
            ? 'rv-transp-direccion'
            : 'rv-cliente-direccion';
        const el = document.getElementById(targetId);
        if (el) {
          try {
            el.focus();
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (_e) {}
        }
        return;
      }
    } else if (feVal === 'SUCURSAL') {
      if (!sucursalDireccion) {
        showReviewError('Elegiste "Envio a sucursal": falta completar la DIRECCION DE ENTREGA.');
        const el = document.getElementById('rv-sucursal-direccion');
        if (el) {
          try {
            el.focus();
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (_e) {}
        }
        return;
      }
    } else if (feVal === 'RETIRO_DEPOSITO') {
      // v397 (2026-08-04): NOMBRE + APELLIDO + DNI + PATENTE del responsable.
      if (!retiroNombre || !retiroApellido || !retiroDni || !retiroPatente) {
        const faltantes = [];
        if (!retiroNombre) faltantes.push('NOMBRE del responsable');
        if (!retiroApellido) faltantes.push('APELLIDO del responsable');
        if (!retiroDni) faltantes.push('DNI del responsable');
        if (!retiroPatente) faltantes.push('PATENTE del vehiculo');
        showReviewError(
          'Elegiste "Retiro en el deposito": falta completar ' + faltantes.join(' + ') + '.'
        );
        const targetId = !retiroNombre
          ? 'rv-retiro-nombre'
          : !retiroApellido
            ? 'rv-retiro-apellido'
            : !retiroDni
              ? 'rv-retiro-dni'
              : 'rv-retiro-patente';
        const el = document.getElementById(targetId);
        if (el) {
          try {
            el.focus();
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (_e) {}
        }
        return;
      }
    }
    console.log('[pedido] validacion OK, pasando directo a Pendientes (mes/anio=actual)');
    // Todo OK: cerrar review y pasar DIRECTO a Pendientes.
    // El paso intermedio de "elegir mes/anio" (confirm-dialog) se elimina
    // porque el vendedor esperaba que "Pasar a Pendientes" pase efectivamente
    // a Pendientes. Si el confirm-dialog no se veia (porque estaba anidado
    // dentro del pedido-modal que no siempre esta abierto), el pedido quedaba
    // como "En curso" y el vendedor no entendia por que.
    // Ahora usamos mes/anio del sistema por default; el vendedor puede editar
    // despues desde el pedido en Pendientes si necesita cambiarlo.
    closeReviewDialog();
    // Popular los selects (los lee doConfirmPedido) con mes/anio actual.
    const now = new Date();
    const mesSel = document.getElementById('cd-mes');
    if (mesSel) {
      mesSel.innerHTML = MESES.map((m, i) => '<option value="' + i + '">' + m + '</option>').join(
        ''
      );
      mesSel.value = now.getMonth();
    }
    const anioSel = document.getElementById('cd-anio');
    if (anioSel) {
      const year = now.getFullYear();
      let yopts = '';
      for (let y = year - 1; y <= year + 2; y++)
        yopts += '<option value="' + y + '">' + y + '</option>';
      anioSel.innerHTML = yopts;
      anioSel.value = year;
    }
    // Ejecutar directo: doConfirmPedido tiene su propio confirm() nativo
    // pidiendo "Confirmar pedido de X para <mes actual>?" - ahi el vendedor
    // puede cancelar si quiere.
    try {
      doConfirmPedido();
    } catch (err) {
      console.error('[pedido] doConfirmPedido fallo', err);
      alert(
        'No pudimos pasar el pedido a Pendientes:\n\n' +
          (err && err.message ? err.message : String(err))
      );
      try {
        openReviewDialog('crear');
      } catch (_e) {}
    }
  } catch (err) {
    console.error('[pedido] validateReviewAndPasarAPendientes FATAL', err);
    alert(
      'Error inesperado al pasar el pedido a Pendientes:\n\n' +
        (err && err.message ? err.message : String(err)) +
        '\n\nAvisa al admin y adjunta el mensaje.'
    );
  }
};

// Muestra u oculta el banner de error dentro del modal review. Si el
// contenedor no existe, lo crea al vuelo. Vacio -> oculta.
function showReviewError(msg) {
  const modalBody =
    document.querySelector('#review-modal .modal-body') ||
    document.querySelector('#review-modal .review-content') ||
    document.getElementById('review-modal');
  if (!modalBody) return;
  let el = document.getElementById('rv-error-banner');
  if (!msg) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'rv-error-banner';
    el.style.cssText =
      'background:#fee2e2;border:1.5px solid #fca5a5;color:#991b1b;border-radius:6px;padding:10px 12px;margin:10px 0;font-size:12px;font-weight:600;line-height:1.5';
    // Poner el banner cerca del footer (arriba del boton).
    const footer = document.querySelector('#review-modal .modal-footer');
    if (footer && footer.parentNode) footer.parentNode.insertBefore(el, footer);
    else modalBody.appendChild(el);
  }
  el.innerHTML = '&#9888;&#65039; ' + msg;
  // Scroll al banner por si esta fuera de vista.
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (_e) {}
}
window.showReviewError = showReviewError;

function updateReviewFooter() {
  const footer = document.querySelector('#review-modal .modal-footer');
  if (reviewMode === 'pending-confirm') {
    footer.innerHTML =
      '<button class="btn-cancel" style="background:#fff;color:#475569;border:1.5px solid #cbd5e1" onclick="closeReviewDialog()">Volver a editar</button>' +
      '<button class="btn-confirm" onclick="doConfirmDefinitivoFromReview()">Confirmar y enviar a Confirmados</button>';
  } else {
    footer.innerHTML =
      '<button class="btn-cancel" style="background:#fff;color:#475569;border:1.5px solid #cbd5e1" onclick="closeReviewDialog()">Volver a editar</button>' +
      '<button class="btn-confirm" onclick="validateReviewAndPasarAPendientes()">Pasar a Pendientes</button>';
  }
}

function renderReviewSuggestions() {
  const box = document.getElementById('rv-suggest-box');
  const listEl = document.getElementById('rv-suggest-list');
  const infoEl = document.getElementById('rv-suggest-info');
  if (reviewMode !== 'pending-confirm' || !currentOrderClient) {
    box.style.display = 'none';
    return;
  }
  const province = currentOrderClient.province;
  const clientName = currentOrderClient.name;
  const agg = {};
  const peerShops = new Set();
  (typeof globalPedidos !== 'undefined' ? globalPedidos : []).forEach((p) => {
    if (p.province !== province) return;
    if (p.clientName === clientName) return;
    peerShops.add(p.clientName);
    (p.lines || []).forEach((l) => {
      if (!l.code) return;
      if (!agg[l.code]) agg[l.code] = { qty: 0, shops: new Set(), line: l };
      agg[l.code].qty += parseFloat(l.qty) || 0;
      agg[l.code].shops.add(p.clientName);
    });
  });
  const entry = getCurrentPendingEntry();
  const inOrder = new Set(((entry && entry.lines) || []).map((l) => l.code));
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
  if (!suggestions.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  infoEl.textContent = peerShops.size + ' casa(s) en ' + titleCase(province);
  let html = '';
  suggestions.forEach((s) => {
    const masterProd = PRODUCTS.find((p) => p.code === s.code);
    const desc = (masterProd && masterProd.desc) || s.line.desc || s.code;
    const shopsText =
      s.shopList.length <= 3
        ? s.shopList.join(', ')
        : s.shopList.slice(0, 2).join(', ') + ' y ' + (s.shopList.length - 2) + ' mas';
    html +=
      '<div class="suggest-row" onclick="addToOrderAndRefreshReview(\'' +
      escapeAttr(s.code) +
      '\')">';
    html += '<div class="code">' + escapeHtml(s.code) + '</div>';
    html += '<div><div class="sname">' + escapeHtml(desc) + '</div>';
    html +=
      '<div class="sinfo">Pidieron: ' +
      escapeHtml(shopsText) +
      ' &middot; ' +
      s.qty +
      ' unid.</div></div>';
    html +=
      '<button class="add-sg" onclick="event.stopPropagation();addToOrderAndRefreshReview(\'' +
      escapeAttr(s.code) +
      '\')" title="Agregar">+</button>';
    html += '</div>';
  });
  listEl.innerHTML = html;
}

window.addToOrderAndRefreshReview = function (code) {
  addToOrder(code);
  renderReviewLines();
  renderReviewSuggestions();
};

// Al tocar un sugerido en PENDIENTES (o en el review), preguntar cuantas unidades agregar
window.addSuggestionPrompt = function (code) {
  const prod = PRODUCTS.find((p) => p.code === code);
  if (!prod) return;
  const label = prod.code + ' - ' + prod.desc;
  const qtyStr = prompt('¿Cuantas unidades de:\n' + label + '\n\nagregar al pedido?', '1');
  if (qtyStr === null) return; // cancelado
  const qty = parseInt(qtyStr, 10);
  if (Number.isNaN(qty) || qty < 1) {
    alert('Cantidad invalida. Usa un numero entero >= 1.');
    return;
  }
  // Agregar de una vez la cantidad indicada
  if (currentOrderKey === '__pending__') {
    const entry = getCurrentPendingEntry();
    if (!entry) return;
    if (!entry.lines) entry.lines = [];
    const existing = entry.lines.find((l) => l.code === code);
    if (existing) {
      existing.qty = (parseFloat(existing.qty) || 0) + qty;
    } else {
      entry.lines.push({
        code: prod.code,
        desc: prod.desc,
        cat: prod.cat || '',
        fam: prod.fam || '',
        sub: prod.sub || '',
        qty: qty,
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
  // Modo Crear / review: usar addToOrder iterando (mantiene logica existente)
  for (let i = 0; i < qty; i++) addToOrder(code);
  // Si esta abierto el review, refrescar
  if (document.getElementById('review-modal').classList.contains('open')) {
    renderReviewLines();
    renderReviewSuggestions();
  }
};

window.doConfirmDefinitivoFromReview = function () {
  closeReviewDialog();
  if (!currentOrderClient || currentOrderClient.stage !== 'pending') return;
  const key = currentOrderClient.viewKey,
    idx = currentOrderClient.viewIdx;
  const list = pending[key] || [];
  const entry = list[idx];
  if (!entry) return;
  if (entry._fsId && currentUser) {
    fbDb
      .collection('pedidos')
      .doc(entry._fsId)
      .update({ stage: 'confirmed', finalizedAt: new Date().toISOString() })
      .then(() => showSyncTag('Pedido confirmado definitivamente'))
      .catch((e) => {
        console.error('confirm def', e);
        alert('Error: ' + (e.message || e));
      });
  }
  if (!confirmed[key]) confirmed[key] = [];
  confirmed[key].push(Object.assign({}, entry, { finalizedAt: new Date().toISOString() }));
  saveConfirmed();
  pending[key] = list.filter((_, i) => i !== idx);
  if (!pending[key].length) delete pending[key];
  savePending();
  closePedidoModal();
  setPedidoView('confirmados');
};

function renderReviewLines() {
  let ord;
  if (reviewMode === 'pending-confirm') {
    const entry = getCurrentPendingEntry();
    ord = entry ? entry.lines || [] : [];
  } else {
    ord = orders[currentOrderKey] || [];
  }
  // Summary
  const sumEl = document.getElementById('rv-summary');
  if (currentOrderClient) {
    sumEl.innerHTML =
      '<div class="rs-name">' +
      escapeHtml(currentOrderClient.name) +
      '</div>' +
      '<div class="rs-meta">' +
      escapeHtml(titleCase(currentOrderClient.province)) +
      ' &middot; ' +
      escapeHtml(currentOrderClient.locName) +
      ' &middot; ' +
      (currentOrderClient.tipo === 'C' ? 'Cliente actual' : 'Prospecto') +
      '</div>';
  }
  // v281+: filtro de busqueda del review. NO altera los totales (los subtotales
  // siguen calculandose sobre TODO el pedido) - solo filtra que lineas se
  // renderizan visualmente. Asi el vendedor puede buscar sin perder de vista
  // el total real del pedido.
  const searchQuery = (window._reviewSearchQuery || '').toLowerCase().trim();
  const searchActive = searchQuery.length > 0;
  const matchesSearch = (l) => {
    if (!searchActive) return true;
    const code = (l.code || '').toLowerCase();
    const desc = (l.desc || '').toLowerCase();
    return code.indexOf(searchQuery) >= 0 || desc.indexOf(searchQuery) >= 0;
  };
  // Lines
  let html = '';
  let totalU = 0,
    totalM = 0;
  let visibleN = 0; // v281+: cuenta lineas que pasan el filtro (para el counter).
  // Subtotales por disponibilidad de stock. hasStock(code):
  //   true  -> disponible
  //   false -> NO disponible (rojo)
  //   null  -> sin datos cargados aun (tratamos como disponible para no asustar)
  let okU = 0,
    okM = 0,
    okN = 0;
  let noU = 0,
    noM = 0,
    noN = 0;
  ord.forEach((l) => {
    const q = parseFloat(l.qty) || 0;
    const p = parseFloat(l.precio) || 0;
    const subtotal = q * p;
    totalU += q;
    totalM += subtotal;
    const stockAvail = typeof hasStock === 'function' ? hasStock(l.code) : null;
    const noDisp = stockAvail === false;
    // v408 (2026-08-05): si la linea tiene faltantesQty (v407+ Excel import),
    // el "Sin stock" cuenta SOLO las unidades sin cobertura, no la linea
    // entera. Ejemplo: qty=5, stock=2, faltantesQty=3 -> Disponibles=2u,
    // Sin stock=3u. Pedido de Mariano. Sino (linea pre-v407 o sin
    // faltantesQty), se mantiene el comportamiento viejo: si noDisp, todo
    // a "Sin stock"; sino todo a "Disponibles".
    const _faltantes = parseFloat(l.faltantesQty) || 0;
    if (_faltantes > 0 && _faltantes < q) {
      const qOk = q - _faltantes;
      okU += qOk;
      okM += qOk * p;
      okN++;
      noU += _faltantes;
      noM += _faltantes * p;
      noN++;
    } else if (noDisp || _faltantes >= q) {
      noU += q;
      noM += subtotal;
      noN++;
    } else {
      okU += q;
      okM += subtotal;
      okN++;
    }
    // v280+: linea con needsReview (SKU cargado por Excel que no matcheo con
    // el catalogo) - pinta en amarillo con badge REVISAR EN SAP asi el
    // vendedor / admin lo ve claro antes de confirmar el pedido.
    const needsReview = !!l.needsReview;
    const dot = needsReview
      ? '<span title="Revisar en SAP" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-right:6px;vertical-align:middle"></span>'
      : noDisp
        ? '<span title="Sin stock" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;margin-right:6px;vertical-align:middle"></span>'
        : stockAvail === true
          ? '<span title="Disponible" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;margin-right:6px;vertical-align:middle"></span>'
          : '';
    // v281+: si el buscador esta activo, la linea se cuenta para totales pero
    // solo se renderiza si matchea la busqueda. Asi el vendedor puede filtrar
    // sin perder el total real del pedido.
    if (!matchesSearch(l)) return;
    visibleN++;
    const lineStyle = needsReview
      ? ' style="background:#fef3c7;border-color:#fcd34d"'
      : noDisp
        ? ' style="background:#fef2f2;border-color:#fecaca"'
        : '';
    html += '<div class="review-line"' + lineStyle + '>';
    html += '<div class="rl-code">' + dot + escapeHtml(l.code) + '</div>';
    const badgeReview = needsReview
      ? ' <span style="color:#b45309;font-weight:800;font-size:9px;text-transform:uppercase;letter-spacing:.4px;background:#fde68a;padding:1px 5px;border-radius:3px">&#128269; revisar en sap</span>'
      : '';
    const badgeNoStock =
      !needsReview && noDisp
        ? ' <span style="color:#dc2626;font-weight:800;font-size:9px;text-transform:uppercase;letter-spacing:.4px">&middot; sin stock</span>'
        : '';
    html += '<div class="rl-name">' + escapeHtml(l.desc) + badgeReview + badgeNoStock + '</div>';
    html +=
      '<input type="number" min="0" step="any" value="' +
      p +
      '" placeholder="$" onchange="setOrderPrice(\'' +
      escapeAttr(l.code) +
      '\', this.value);renderReviewLines()" title="Precio unitario"/>';
    html +=
      '<input type="number" min="0" step="1" value="' +
      q +
      '" title="Cantidad" onchange="setOrderQty(\'' +
      escapeAttr(l.code) +
      '\', this.value);renderReviewLines()"/>';
    html +=
      '<button class="rl-rm" onclick="removeFromOrder(\'' +
      escapeAttr(l.code) +
      '\');renderReviewLines();renderReviewSuggestions()" title="Quitar">&times;</button>';
    html += '</div>';
  });
  // v281+: si el filtro esta activo y no matchea nada, mostrar mensaje claro.
  if (!ord.length)
    html = '<div class="no-data">Sin productos. Volve a editar y agrega items.</div>';
  else if (searchActive && visibleN === 0)
    html =
      '<div class="no-data">Ningun producto matchea &laquo;' +
      escapeHtml(searchQuery) +
      '&raquo;.</div>';
  document.getElementById('rv-lines').innerHTML = html;
  // v281+: contador del buscador (ej: "3 de 159").
  const searchCountEl = document.getElementById('rv-search-count');
  if (searchCountEl) {
    if (searchActive) searchCountEl.textContent = visibleN + ' de ' + ord.length + ' productos';
    else searchCountEl.textContent = '';
  }
  // v281+: mostrar/ocultar el boton (x) de limpiar segun si hay texto en el input.
  const clearBtn = document.getElementById('rv-search-clear');
  if (clearBtn) clearBtn.style.display = searchActive ? '' : 'none';
  // Totals: si hay items sin stock, discriminamos los 2 subtotales asi el
  // vendedor puede mostrarle al cliente "del total $X, hay $Y sin stock,
  // pagarias $Z efectivamente".
  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  let totalsHtml = '';
  if (noN > 0 && okN > 0) {
    totalsHtml =
      '<div style="display:flex;flex-direction:column;gap:8px;width:100%">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid #334155">' +
      '<span style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#86efac"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a"></span>Disponibles &middot; ' +
      okN +
      ' prod &middot; ' +
      okU +
      ' u</span>' +
      '<span style="color:#86efac;font-size:14px;font-weight:800">' +
      fmt(okM) +
      '</span>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid #334155">' +
      '<span style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#fca5a5"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626"></span>Sin stock &middot; ' +
      noN +
      ' prod &middot; ' +
      noU +
      ' u</span>' +
      '<span style="color:#fca5a5;font-size:14px;font-weight:800">' +
      fmt(noM) +
      '</span>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<span style="font-size:12px;font-weight:800">Total pedido &middot; ' +
      ord.length +
      ' prod &middot; ' +
      totalU +
      ' u</span>' +
      '<span class="rt-money">' +
      fmt(totalM) +
      '</span>' +
      '</div>' +
      '</div>';
  } else {
    totalsHtml =
      '<span>' +
      ord.length +
      ' productos &middot; ' +
      totalU +
      ' unidades</span><span class="rt-money">' +
      fmt(totalM) +
      '</span>';
  }
  document.getElementById('rv-totals').innerHTML = totalsHtml;
  // 2 cuadrantes con subtotal por disponibilidad. Solo se muestra si hay
  // al menos 1 item sin stock - sino fold up. Pensado para el speech con
  // el cliente: "del total $X, esto se va ahora ($okM) y esto queda
  // pendiente del faltante ($noM)".
  const splitEl = document.getElementById('rv-stock-split');
  if (splitEl) {
    if (noN > 0) {
      splitEl.style.display = 'grid';
      splitEl.style.gridTemplateColumns = '1fr 1fr';
      splitEl.style.gap = '8px';
      splitEl.innerHTML =
        '<div style="background:#ecfdf5;border:1.5px solid #6ee7b7;border-radius:8px;padding:10px 12px">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;color:#065f46;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a"></span>Subtotal disponibles' +
        '</div>' +
        '<div style="font-size:16px;font-weight:800;color:#047857">' +
        fmt(okM) +
        '</div>' +
        '<div style="font-size:10px;color:#065f46;margin-top:2px">' +
        okN +
        ' producto' +
        (okN === 1 ? '' : 's') +
        ' &middot; ' +
        okU +
        ' u</div>' +
        '</div>' +
        '<div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;padding:10px 12px">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;color:#991b1b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626"></span>Subtotal no disp.' +
        '</div>' +
        '<div style="font-size:16px;font-weight:800;color:#dc2626">' +
        fmt(noM) +
        '</div>' +
        '<div style="font-size:10px;color:#991b1b;margin-top:2px">' +
        noN +
        ' producto' +
        (noN === 1 ? '' : 's') +
        ' &middot; ' +
        noU +
        ' u</div>' +
        '</div>';
    } else {
      splitEl.style.display = 'none';
      splitEl.innerHTML = '';
    }
  }
  // v343+ (2026-07-28): Descuento total EDITABLE por el vendedor. Antes era
  // solo informativo y el pedido iba a SAP sin descuento (SAP recalculaba).
  // Ahora el input 'rv-manual-discount' se envia como DiscountPercent al
  // payload SAP Service Layer -> aparece en el campo Descuento % de OQUT.
  //
  // Volumen es DINAMICO (depende del subtotal del pedido) y el bonus de
  // pago anticipado solo aplica si el vendedor elige CONTADO. Se muestra
  // como SUGERENCIA (auto-calculo) pero el vendedor puede editarla.
  const discEl = document.getElementById('rv-discount');
  if (discEl) {
    if (!ord.length || totalM <= 0) {
      discEl.innerHTML = '';
      return;
    }
    const cd = getCurrentOrderClientData();
    const formaPagoSel = document.getElementById('rv-forma-pago');
    const formaPago = formaPagoSel ? formaPagoSel.value : '';
    const d = calcClientDiscount(cd, totalM, formaPago);
    // Valor actual del input (preservar entre re-renders si el user tipeo).
    // Si no hay valor tipeado, sugerir el auto-calculado.
    const currentInput = document.getElementById('rv-manual-discount');
    const currentValue = currentInput ? currentInput.value : '';
    const suggested = d.hasAny ? d.pctTotal : 0;
    const inputValue =
      currentValue !== '' && currentValue != null ? currentValue : String(suggested);
    let body = '';
    body +=
      '<div class="rd-line"><span>Subtotal pedido</span><span class="rd-money">$' +
      Math.round(totalM).toLocaleString('es-AR') +
      '</span></div>';
    if (d.hasAny) {
      const tipoLbl = d.tipo ? 'Tipo ' + d.tipo : 'Sin tipo';
      const volLbl = d.vol;
      const anticLbl =
        d.formaPago === 'CONTADO'
          ? 'CONTADO'
          : d.formaPago
            ? d.formaPago + ' - no aplica'
            : 'Sin forma de pago';
      body +=
        '<div class="rd-line" style="opacity:.75"><span>&middot; Descuento fijo (' +
        escapeHtml(tipoLbl) +
        ')</span><span class="rd-pct">-' +
        d.pctFijo +
        '%</span></div>';
      body +=
        '<div class="rd-line" style="opacity:.75"><span>&middot; Descuento por volumen (' +
        escapeHtml(volLbl) +
        ')</span><span class="rd-pct">-' +
        d.pctVol +
        '%</span></div>';
      body +=
        '<div class="rd-line" style="opacity:.75"><span>&middot; Descuento pago anticipado (' +
        escapeHtml(anticLbl) +
        ')</span><span class="rd-pct">-' +
        d.pctAntic +
        '%</span></div>';
      body +=
        '<div class="rd-line rd-sep" style="opacity:.75"><span>Sugerido por reglas</span><span class="rd-pct">-' +
        d.pctTotal +
        '%</span></div>';
    } else {
      body +=
        '<div class="rd-line rd-sep" style="opacity:.75"><span>Sugerido por reglas</span><span class="rd-pct">-0% (sin tipo/forma pago cargados)</span></div>';
    }
    // INPUT editable del descuento total. Envia a SAP como DiscountPercent.
    body +=
      '<div class="rd-line" style="margin-top:8px;padding:10px;background:#ecfdf5;border:1.5px solid #86efac;border-radius:6px">' +
      '<span style="font-weight:800;color:#166534">&#128176; Descuento total (%) <span style="color:#dc2626">*</span></span>' +
      '<input type="number" id="rv-manual-discount" min="0" max="100" step="0.01" value="' +
      escapeAttr(inputValue) +
      '" style="width:80px;padding:6px 8px;border:1.5px solid #86efac;border-radius:5px;font-size:13px;font-weight:800;text-align:right;color:#166534" onchange="renderReviewLines()"/>' +
      '</div>';
    // Calculo del total con el descuento MANUAL (lo que va a SAP).
    const manualPct = parseFloat(inputValue) || 0;
    const manualMonto = totalM * (manualPct / 100);
    const totalConDesc = totalM - manualMonto;
    body +=
      '<div class="rd-line"><span class="rd-total">Total con descuento manual</span><span class="rd-total">$' +
      Math.round(totalConDesc).toLocaleString('es-AR') +
      ' &middot; <span style="color:#0d9488">-$' +
      Math.round(manualMonto).toLocaleString('es-AR') +
      '</span></span></div>';
    body +=
      '<div class="rd-warn" style="background:#dcfce7;border-color:#86efac;color:#166534">&#128712; El descuento manual se envia a SAP como DiscountPercent (campo Descuento % en OQUT). El vendedor confirma este numero.</div>';
    discEl.innerHTML =
      '<div class="review-discount"><div class="rd-head"><span>&#128176; Descuento del pedido</span></div>' +
      body +
      '</div>';
  }
}

// v281+: buscador dentro del modal "Revisa tu pedido" que filtra las lineas
// en tiempo real por codigo o descripcion. Los totales NO se ven afectados
// (siguen sumando sobre todo el pedido) - solo cambia que lineas se muestran.
window.onReviewSearch = function () {
  const inp = document.getElementById('rv-search');
  window._reviewSearchQuery = inp ? inp.value : '';
  renderReviewLines();
};
window.clearReviewSearch = function () {
  window._reviewSearchQuery = '';
  const inp = document.getElementById('rv-search');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  renderReviewLines();
};

// Callback del dropdown "Forma de pago" en el modal Revisa tu pedido:
// recalcula el descuento estimado al cambiar (volumen sigue dinamico).
window.onFormaPagoChange = function () {
  renderReviewLines();
  try {
    revalidateReviewSilently();
  } catch (_e) {}
};

// Callback del dropdown "Forma de entrega" en el modal Revisa tu pedido:
// muestra u oculta los bloques de campos condicionales.
window.onFormaEntregaChange = function () {
  const sel = document.getElementById('rv-forma-entrega');
  const val = sel ? sel.value : '';
  const bTransp = document.getElementById('rv-entrega-transp-block');
  const bSucursal = document.getElementById('rv-entrega-sucursal-block');
  const bRetiro = document.getElementById('rv-entrega-retiro-block');
  if (bTransp) bTransp.style.display = val === 'TRANSPORTISTA' ? '' : 'none';
  if (bSucursal) bSucursal.style.display = val === 'SUCURSAL' ? '' : 'none';
  if (bRetiro) bRetiro.style.display = val === 'RETIRO_DEPOSITO' ? '' : 'none';
  // Al ocultarse un bloque, tambien limpiamos el value asi no queda
  // guardado si el vendedor cambia de opcion despues.
  if (val !== 'TRANSPORTISTA') {
    const n = document.getElementById('rv-transp-nombre');
    if (n) n.value = '';
    const d = document.getElementById('rv-transp-direccion');
    if (d) d.value = '';
    const cd = document.getElementById('rv-cliente-direccion');
    if (cd) cd.value = '';
  }
  if (val !== 'SUCURSAL') {
    const s = document.getElementById('rv-sucursal-direccion');
    if (s) s.value = '';
  }
  if (val !== 'RETIRO_DEPOSITO') {
    ['rv-retiro-nombre', 'rv-retiro-apellido', 'rv-retiro-dni', 'rv-retiro-patente'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
    );
  }
  try {
    revalidateReviewSilently();
  } catch (_e) {}
};

// Chequea el estado actual de los campos del review y limpia el banner
// de error si ya no aplica. Se llama tras cada onchange/oninput de los
// campos del modal para evitar que un banner "stuck" siga visible cuando
// el vendedor ya corrigio lo que faltaba.
// NO muestra errores nuevos: eso lo hace validateReviewAndPasarAPendientes
// al tocar el boton. Aca solo LIMPIAMOS silenciosamente.
window.revalidateReviewSilently = function () {
  const fpVal = ((document.getElementById('rv-forma-pago') || {}).value || '').trim();
  if (!fpVal) return; // sigue faltando forma de pago -> no limpiar
  const feVal = ((document.getElementById('rv-forma-entrega') || {}).value || '').trim();
  if (!feVal) return; // sigue faltando forma de entrega -> no limpiar
  if (feVal === 'TRANSPORTISTA') {
    const n = ((document.getElementById('rv-transp-nombre') || {}).value || '').trim();
    const d = ((document.getElementById('rv-transp-direccion') || {}).value || '').trim();
    const cd = ((document.getElementById('rv-cliente-direccion') || {}).value || '').trim();
    if (!n || !d || !cd) return;
  } else if (feVal === 'SUCURSAL') {
    const s = ((document.getElementById('rv-sucursal-direccion') || {}).value || '').trim();
    if (!s) return;
  } else if (feVal === 'RETIRO_DEPOSITO') {
    const n = ((document.getElementById('rv-retiro-nombre') || {}).value || '').trim();
    const a = ((document.getElementById('rv-retiro-apellido') || {}).value || '').trim();
    const d = ((document.getElementById('rv-retiro-dni') || {}).value || '').trim();
    const p = ((document.getElementById('rv-retiro-patente') || {}).value || '').trim();
    if (!n || !a || !d || !p) return;
  }
  // Todo OK: limpiar banner si estaba visible.
  try {
    showReviewError('');
  } catch (_e) {}
};

window.openConfirmDialog = function () {
  console.log('[pedido] openConfirmDialog:', {
    currentOrderKey: currentOrderKey,
    hasClient: !!currentOrderClient,
    clientName: currentOrderClient && currentOrderClient.name,
    ordersLen: (orders[currentOrderKey] || []).length,
  });
  if (!currentOrderKey || currentOrderKey === '__readonly__') {
    alert('No hay un pedido activo para confirmar. Cerra y volve a abrir el cliente.');
    return;
  }
  const ord = orders[currentOrderKey] || [];
  if (!ord.length) {
    alert('El pedido esta vacio. Agregue productos antes de confirmar.');
    return;
  }
  // populate month/year selects
  const now = new Date();
  const mesSel = document.getElementById('cd-mes');
  mesSel.innerHTML = MESES.map((m, i) => '<option value="' + i + '">' + m + '</option>').join('');
  mesSel.value = now.getMonth();
  const anioSel = document.getElementById('cd-anio');
  const year = now.getFullYear();
  let yopts = '';
  for (let y = year - 1; y <= year + 2; y++)
    yopts += '<option value="' + y + '">' + y + '</option>';
  anioSel.innerHTML = yopts;
  anioSel.value = year;
  document.getElementById('cd-title').textContent = 'Confirmar pedido';
  // Forma de pago ya se eligio en el modal "Revisa tu pedido" - aca solo
  // confirmamos mes/anio.
  const formaPagoYaElegida =
    (document.getElementById('rv-forma-pago') && document.getElementById('rv-forma-pago').value) ||
    '';
  const fpLine = formaPagoYaElegida
    ? '<br><span style="font-size:11px;color:#475569">Forma de pago: <b>' +
      escapeHtml(formaPagoYaElegida) +
      '</b></span>'
    : '';
  // Si currentOrderClient no esta seteado (edge case post-Excel), reconstruir
  // el nombre desde currentOrderKey ('tipo|prov|loc|name').
  let clientName = (currentOrderClient && currentOrderClient.name) || '';
  if (!clientName && typeof currentOrderKey === 'string') {
    const parts = currentOrderKey.split('|');
    if (parts.length >= 4) clientName = parts[3];
    // Ademas reponer currentOrderClient con datos minimos asi doConfirmPedido
    // no crashea despues por currentOrderClient.name null.
    if (!currentOrderClient) {
      window.currentOrderClient = {
        name: parts[3] || '',
        tipo: parts[0] || '',
        province: parts[1] || '',
        locName: parts[2] || '',
        stage: 'crear',
      };
      console.warn('[pedido] currentOrderClient recuperado desde key:', currentOrderClient);
    }
  }
  document.getElementById('cd-text').innerHTML =
    'Desea confirmar el pedido de <b>' +
    escapeHtml(clientName || '(sin nombre)') +
    '</b>?<br><span style="font-size:11px;color:#64748b">Seleccione el mes/a&ntilde;o:</span>' +
    fpLine;
  // Selector "Crear en nombre de" para VDI con parejas VDE.
  try {
    renderPedidoActingAsSelect();
  } catch (e) {
    console.warn('renderPedidoActingAsSelect fallo', e);
  }
  document.getElementById('confirm-dialog').classList.add('open');
};

function renderPedidoActingAsSelect() {
  const wrap = document.getElementById('cd-actingas-wrap');
  const sel = document.getElementById('cd-actingas');
  if (!wrap || !sel) return;
  if (userRole !== 'interno' || !myExternalPartners.length) {
    wrap.style.display = 'none';
    actingOnBehalfOfUid = null;
    refreshPedidoActingAsInfo();
    return;
  }
  wrap.style.display = '';
  const opts = ['<option value="">Mí mismo</option>'].concat(
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
  refreshPedidoActingAsInfo();
}

function refreshPedidoActingAsInfo() {
  const info = document.getElementById('cd-actingas-info');
  if (!info) return;
  const p = getActingVendorPartner();
  if (p) {
    info.style.display = '';
    info.innerHTML =
      '&#9888;&#65039; El pedido queda registrado como del VDE <b>' +
      escapeHtml(p.displayName) +
      '</b>. Le va a llegar una notificacion automatica.';
  } else {
    info.style.display = 'none';
    info.innerHTML = '';
  }
}

window.onPedidoActingAsChange = function () {
  const sel = document.getElementById('cd-actingas');
  actingOnBehalfOfUid = sel && sel.value ? sel.value : null;
  refreshPedidoActingAsInfo();
};

window.closeConfirmDialog = function () {
  document.getElementById('confirm-dialog').classList.remove('open');
};

window.doConfirmPedido = function () {
  if (!currentOrderKey || currentOrderKey === '__readonly__') return;
  const ord = orders[currentOrderKey] || [];
  if (!ord.length) return;
  const mesIdx = parseInt(document.getElementById('cd-mes').value, 10);
  const anio = document.getElementById('cd-anio').value;
  const monthLabel = MESES[mesIdx] + ' ' + anio;
  if (!confirm('Confirmar pedido de "' + currentOrderClient.name + '" para ' + monthLabel + '?'))
    return;
  if (!pending[currentOrderKey]) pending[currentOrderKey] = [];
  pending[currentOrderKey].push({
    month: monthLabel,
    monthIdx: mesIdx,
    year: parseInt(anio, 10),
    confirmedAt: new Date().toISOString(),
    lines: ord.map((l) => ({
      code: l.code,
      desc: l.desc,
      cat: l.cat,
      fam: l.fam,
      sub: l.sub,
      qty: parseFloat(l.qty) || 0,
    })),
  });
  savePending();
  delete orders[currentOrderKey];
  saveOrders();
  closeConfirmDialog();
  closePedidoModal();
  setPedidoView('pendientes');
};
window.openPedidoModal = openPedidoModal;

function closePedidoModal() {
  document.getElementById('pedido-modal').classList.remove('open');
  // Limpiar clases de modo en el body para no contaminar la siguiente apertura
  const bodyEl = document.querySelector('#pedido-modal .pedido-body');
  if (bodyEl) bodyEl.classList.remove('crear-mode', 'pending-suggest-only', 'confirmed-only');
  window.currentOrderKey = null;
  window.currentOrderClient = null;
  renderPedidosTab();
}
window.closePedidoModal = closePedidoModal;

// Los window.foo = foo; ya están al final del bloque verbatim.
