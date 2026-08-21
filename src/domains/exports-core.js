// @ts-nocheck
// EXPORTS-CORE: masterfile clientes + precios/stock + modal de exportar +
// month picker + exports por mes + exportTargetsZonas + openExportAnalisis.
// Extraído verbatim de index.html (líneas 6886-7921 pre-E2.n.1).
// Fragmentos restantes del dominio exports: advanced (~10302-11451) y SAP
// (~18123-19812) requerirán E2.n.2 y E2.n.3 (regla #14 CLAUDE.md).
// Cross-scope state: NONE. Sin listeners.
// ======================================================
// EXPORT MASTERFILE DE CLIENTES
// ======================================================
// Genera un Excel con TODAS las tiendas del mapa con sus datos clave:
// nombre, tipo (cliente/prospecto), zona del vendedor, asesor externo, asesor
// interno (deducido por pareja VDI), provincia, localidad, departamento,
// direccion + localidad declaradas en el modal Alta de cliente (si existen),
// coordenadas geocodificadas, estado (Habilitado/Pendiente/Cancelado),
// categoria (Regular/Ventas Especiales/Distribuidor).
window.exportMasterClientes = function () {
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.');
    return;
  }
  if (!POINTS || !POINTS.length) {
    alert('No hay datos cargados todavia.');
    return;
  }
  showSyncTag('Generando masterfile de clientes...');
  // Scope por vendor (v331): el export respeta el filtro de zona activo en el
  // dropdown. Admin/gerente/viewer con 'Todas' obtienen null -> sin filtro
  // (exporta todo el pais). Vendedor obtiene {assignedVendor}. VDI obtiene
  // sus parejas + propio si eligio 'Todas mis zonas', o solo el subset que
  // eligio (propio / una pareja especifica). Fuera de este set, las tiendas
  // no se incluyen en el Excel - el archivo refleja exactamente lo que ve
  // en el mapa quien exporta.
  const scopeSet =
    typeof getEffectiveVendorSet === 'function'
      ? getEffectiveVendorSet(typeof currentVendor !== 'undefined' ? currentVendor : 'ALL')
      : null;
  const inScope = (vendorKey) => {
    if (scopeSet === null) return true;
    if (!vendorKey) return false;
    return scopeSet.has(vendorKey);
  };
  // Mapeo VDE -> VDI (a partir de las parejas estandar). Cuando una tienda
  // pertenece a Federico o Gonzalo, el VDI es Ioannis. Cuando es de Mauricio
  // o Martin, el VDI es Santiago. Si en el futuro se reasignan parejas via
  // panel admin, esto se podria leer del Firestore - pero para el masterfile
  // estatico, usamos el estandar.
  const VDE_TO_VDI = {
    'FEDERICO CASTELANELLI': 'IOANNIS PALKOUDAKIS',
    'GONZALO DE LA ROSA': 'IOANNIS PALKOUDAKIS',
    'MAURICIO GIL': 'SANTIAGO ESTEBAN',
    'MARTIN BOIERO': 'SANTIAGO ESTEBAN',
  };
  function lookupZone(vendorKey) {
    const v = typeof VENDORS !== 'undefined' ? VENDORS.find((vv) => vv.key === vendorKey) : null;
    return v ? v.zone : '';
  }
  function lookupVendorLabel(vendorKey) {
    const v = typeof VENDORS !== 'undefined' ? VENDORS.find((vv) => vv.key === vendorKey) : null;
    return v ? v.label : vendorKey || '';
  }

  // v450 (2026-08-11): indice de clasificacion desde visits. Para cada
  // cliente, mergea los campos de clasificacion (tipo/tamano/fidelidad/
  // especializacion/canalCompra/pop/tipoVenta/etc.) del formulario de
  // visita/contactado. Politica: campo por campo, tomar el primer valor
  // NO VACIO al recorrer docs de mas reciente a mas antiguo. Asi el usuario
  // ve la clasificacion mas actualizada, pero si el ultimo contacto no llena
  // un campo (contactos tienen menos campos que visitas), cae al anterior
  // en vez de dejar vacio. Pedido de Mariano: "priorizar la ultima
  // interaccion pero no perder info util de las anteriores".
  const CLASSIF_FIELDS = [
    'tipo',
    'local',
    'tamano',
    'fidelidad',
    'especializacion',
    'canalCompra',
    'relevancia',
    'pop',
    'necesidadPuntual',
    'tipoVenta',
    'ponderacionMostrado',
    'ponderacionEcommerce',
    'competencia',
    'oportunidad',
    'masVendido',
    'masPreguntan',
    'ayudaTienda',
  ];
  function _classifKey(prov, loc, tienda) {
    return (
      (prov || '').toString().toUpperCase().trim() +
      '|' +
      (loc || '').toString().trim() +
      '|' +
      (tienda || '').toString().trim()
    );
  }
  function _classifTs(v) {
    if (v && v.createdAt && v.createdAt.toMillis) return v.createdAt.toMillis();
    if (v && v.fecha) return new Date(v.fecha).getTime() || 0;
    return 0;
  }
  const classifIndex = new Map(); // key -> { last: {campos}, lastFecha, lastType, visitas, contactos }
  if (typeof visitsCache !== 'undefined' && Array.isArray(visitsCache)) {
    const byKey = new Map();
    visitsCache.forEach((v) => {
      if (!v) return;
      const k = _classifKey(v.provincia, v.localidad, v.tienda);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(v);
    });
    byKey.forEach((arr, k) => {
      arr.sort((a, b) => _classifTs(b) - _classifTs(a)); // desc por fecha
      const merged = {};
      arr.forEach((v) => {
        CLASSIF_FIELDS.forEach((f) => {
          if (merged[f] != null && merged[f] !== '' && merged[f] !== 0) return;
          const val = v[f];
          if (val != null && val !== '') merged[f] = val;
        });
      });
      const latest = arr[0] || {};
      classifIndex.set(k, {
        merged,
        lastFecha: latest.fecha || '',
        lastType: latest.interactionType || (latest.espacio ? 'visita' : ''),
        visitas: arr.filter((v) => v.interactionType !== 'contacto').length,
        contactos: arr.filter((v) => v.interactionType === 'contacto').length,
      });
    });
  }
  function _classifRow(prov, loc, tienda) {
    const entry = classifIndex.get(_classifKey(prov, loc, tienda));
    if (!entry) {
      return {
        'Ultima interaccion': '',
        'Tipo ultima interaccion': '',
        'Total visitas': 0,
        'Total contactos': 0,
        'Tipo comercio': '',
        Local: '',
        Tamano: '',
        Fidelidad: '',
        Especializacion: '',
        'Canal de compra': '',
        Relevancia: '',
        POP: '',
        'Necesidad puntual': '',
        'Tipo de venta': '',
        'Ponderacion mostrador (%)': '',
        'Ponderacion e-commerce (%)': '',
        Competencia: '',
        Oportunidad: '',
        'Mas vendido': '',
        'Mas preguntan': '',
        'Ayuda tienda': '',
      };
    }
    const m = entry.merged || {};
    return {
      'Ultima interaccion': entry.lastFecha,
      'Tipo ultima interaccion': entry.lastType,
      'Total visitas': entry.visitas,
      'Total contactos': entry.contactos,
      'Tipo comercio': m.tipo || '',
      Local: m.local || '',
      Tamano: m.tamano || '',
      Fidelidad: m.fidelidad || '',
      Especializacion: m.especializacion || '',
      'Canal de compra': m.canalCompra || '',
      Relevancia: m.relevancia != null ? m.relevancia : '',
      POP: m.pop || '',
      'Necesidad puntual': m.necesidadPuntual || '',
      'Tipo de venta': m.tipoVenta || '',
      'Ponderacion mostrador (%)': m.ponderacionMostrado != null ? m.ponderacionMostrado : '',
      'Ponderacion e-commerce (%)': m.ponderacionEcommerce != null ? m.ponderacionEcommerce : '',
      Competencia: m.competencia || '',
      Oportunidad: m.oportunidad || '',
      'Mas vendido': m.masVendido || '',
      'Mas preguntan': m.masPreguntan || '',
      'Ayuda tienda': m.ayudaTienda || '',
    };
  }

  // FILTRO SAP: solo se exportan los clientes HABILITADOS en SAP - los que
  // tienen cardCode + direccion. Esos son los que aparecen como verdes en
  // el mapa y se cuentan en el stat HABILITADOS. Antes el masterfile bajaba
  // los ~1000 POINTS del padron historico, que no representaba el universo
  // real operable hoy.
  const rows = [];
  POINTS.forEach((p) => {
    const province = p.province || '';
    const localityMap = p.name || '';
    const dept = p.dept || '';
    const vendor = p.vendor || '';
    // v331: filtrar por scope de vendor del usuario que exporta.
    if (!inScope(vendor)) return;
    const zone = lookupZone(vendor);
    const vdi = VDE_TO_VDI[vendor] || '';
    const lat = p.lat != null ? p.lat : '';
    const lon = p.lon != null ? p.lon : '';
    // Solo clientes regulares (no prospects, no distribuidores) que pasen
    // el filtro isSapConfirmed: tienen cardCodeSap + direccion.
    (p.clients || []).forEach((name) => {
      if (!name) return;
      if (typeof isSapConfirmed !== 'function' || !isSapConfirmed(province, localityMap, name))
        return;
      const k = 'C|' + province + '|' + localityMap + '|' + name;
      // Estado: habilitado/cancelado/pendiente (legacy contacted set).
      let estado = 'Habilitado'; // por definicion ya esta SAP-confirmado
      if (typeof canceled !== 'undefined' && canceled && canceled.has && canceled.has(k))
        estado = 'Cancelado';
      // Metadata custom (direccion, localidad declarada, geocode).
      const meta = typeof clientMeta !== 'undefined' && clientMeta ? clientMeta[k] || {} : {};
      const customName = meta.customName || '';
      // Buscar address: 1) client_master.address (admin), 2) clientMeta.address (vendor).
      const docId =
        typeof clientLocId === 'function' ? clientLocId(province, localityMap, name) : '';
      const cmData =
        typeof clientMasterCache !== 'undefined' && docId ? clientMasterCache.get(docId) || {} : {};
      const address = cmData.address || meta.address || '';
      const localityCust = cmData.localidad || meta.locality || '';
      const customLat = meta.lat != null ? meta.lat : '';
      const customLng = meta.lng != null ? meta.lng : '';
      // CardCode SAP (de client_master o de la alta vinculada).
      let cardCode = cmData.sapCardCode || '';
      if (!cardCode && typeof approvedAltasByLoc !== 'undefined') {
        const key = province.toUpperCase() + '|' + localityMap;
        const altas = approvedAltasByLoc[key] || [];
        const altaMatch = altas.find((a) => (a.comercio || a.fantasia || '') === name);
        if (altaMatch) cardCode = altaMatch.cardCodeSap || '';
      }
      rows.push(
        Object.assign(
          {
            'CardCode SAP': cardCode,
            'Nombre tienda': name,
            'Alias (modal)': customName,
            Tipo: 'Cliente actual',
            Estado: estado,
            Provincia: typeof titleCase === 'function' ? titleCase(province) : province,
            'Localidad (mapa)': localityMap,
            Departamento: dept,
            'Vendedor externo (VDE)': vendor,
            Zona: zone,
            'Etiqueta zona': lookupVendorLabel(vendor),
            'Asesor interno (VDI)': vdi,
            Direccion: address,
            'Localidad declarada': localityCust,
            'Lat (geocode)': customLat || lat,
            'Lng (geocode)': customLng || lon,
          },
          _classifRow(province, localityMap, name)
        )
      );
    });
  });
  // Inyectar altas de client_applications (approvedAltasList):
  //   * HABILITADOS: tienen cardCodeSap + direccion. Van con Estado='Habilitado'.
  //   * PROVISORIOS (v311+): manualSapPending && !cardCodeSap (Alta Rapida
  //     pendiente de carga a SAP). Van con Estado='Provisorio'. Se
  //     incluyen para que el export refleje el universo comercial completo
  //     que el gerente esta gestionando, no solo los cerrados en SAP.
  //     Los provisorios pueden no tener direccion todavia -> se aceptan igual.
  const seen = new Set();
  rows.forEach((r) =>
    seen.add(
      (r.Provincia || '').toString().toUpperCase() + '|' + (r['Nombre tienda'] || '').toLowerCase()
    )
  );
  if (typeof approvedAltasList !== 'undefined' && approvedAltasList.length) {
    approvedAltasList.forEach((a) => {
      if (!a) return;
      const isProvisorio = !!a.manualSapPending && !a.cardCodeSap;
      // Habilitados: siguen exigiendo cardCode + direccion (comportamiento pre-v311).
      // Provisorios: sin cardCode ni direccion, van igual con Estado='Provisorio'.
      if (!isProvisorio) {
        if (!a.cardCodeSap) return;
        if (!(a.calle || a.address)) return;
      }
      const prov = (a.provincia || '').toString();
      const nombre =
        a.comercio ||
        a.fantasia ||
        (a.cardCodeSap ? 'SAP ' + a.cardCodeSap.slice(0, 8) : a.titular || 'Provisorio');
      const dupKey = prov.toUpperCase() + '|' + nombre.toLowerCase();
      if (seen.has(dupKey)) return;
      seen.add(dupKey);
      const vendor = a.assignedVendor || '';
      // v331: mismo filtro de scope aplica a altas SAP/provisorias.
      if (!inScope(vendor)) return;
      const zone = lookupZone(vendor);
      const vdi = VDE_TO_VDI[vendor] || '';
      const loc = a.localidadFinal || a.localidad || '(sin localidad)';
      rows.push(
        Object.assign(
          {
            'CardCode SAP': a.cardCodeSap || '',
            'Nombre tienda': nombre,
            'Alias (modal)': '',
            Tipo: isProvisorio ? 'Provisorio (Alta rapida)' : 'Cliente actual',
            Estado: isProvisorio ? 'Provisorio' : 'Habilitado',
            Provincia: typeof titleCase === 'function' ? titleCase(prov) : prov,
            'Localidad (mapa)': loc,
            Departamento: '',
            'Vendedor externo (VDE)': vendor,
            Zona: zone,
            'Etiqueta zona': lookupVendorLabel(vendor),
            'Asesor interno (VDI)': vdi,
            Direccion: a.calle || a.address || '',
            'Localidad declarada': loc,
            'Lat (geocode)': a.lat != null ? a.lat : '',
            'Lng (geocode)': a.lng != null ? a.lng : '',
          },
          _classifRow(prov, loc, nombre)
        )
      );
    });
  }

  // Ordenar por provincia, localidad, nombre.
  rows.sort((a, b) => {
    const p = (a.Provincia || '').localeCompare(b.Provincia || '');
    if (p !== 0) return p;
    const l = (a['Localidad (mapa)'] || '').localeCompare(b['Localidad (mapa)'] || '');
    if (l !== 0) return l;
    return (a['Nombre tienda'] || '').localeCompare(b['Nombre tienda'] || '');
  });

  if (!rows.length) {
    alert(
      'No hay clientes para exportar.\n\n' +
        'El masterfile incluye:\n' +
        '  * Habilitados en SAP (cardCode + direccion cargados).\n' +
        '  * Provisorios (Alta rapida pendiente de carga a SAP).\n\n' +
        'Si no ves ninguno, revisa el modal SAP o Alta Clientes.'
    );
    return;
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 16 }, // CardCode SAP
    { wch: 38 }, // Nombre tienda
    { wch: 28 }, // Alias
    { wch: 14 }, // Tipo
    { wch: 14 }, // Estado
    { wch: 22 }, // Provincia
    { wch: 22 }, // Localidad mapa
    { wch: 22 }, // Departamento
    { wch: 28 }, // Vendedor externo
    { wch: 8 }, // Zona
    { wch: 48 }, // Etiqueta zona
    { wch: 28 }, // Asesor interno
    { wch: 38 }, // Direccion
    { wch: 24 }, // Localidad declarada
    { wch: 14 }, // Lat
    { wch: 14 }, // Lng
    // v450: clasificacion desde visits/contactos.
    { wch: 14 }, // Ultima interaccion
    { wch: 14 }, // Tipo ultima interaccion
    { wch: 10 }, // Total visitas
    { wch: 10 }, // Total contactos
    { wch: 18 }, // Tipo comercio
    { wch: 16 }, // Local
    { wch: 12 }, // Tamano
    { wch: 14 }, // Fidelidad
    { wch: 20 }, // Especializacion
    { wch: 20 }, // Canal de compra
    { wch: 10 }, // Relevancia
    { wch: 8 }, // POP
    { wch: 26 }, // Necesidad puntual
    { wch: 16 }, // Tipo de venta
    { wch: 18 }, // Ponderacion mostrador
    { wch: 18 }, // Ponderacion e-commerce
    { wch: 26 }, // Competencia
    { wch: 26 }, // Oportunidad
    { wch: 22 }, // Mas vendido
    { wch: 22 }, // Mas preguntan
    { wch: 26 }, // Ayuda tienda
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes habilitados SAP');

  // Hoja resumen por zona
  const byZone = {};
  rows.forEach((r) => {
    const z = r['Etiqueta zona'] || 'Sin zona';
    if (!byZone[z]) byZone[z] = { total: 0, habilitados: 0, cancelados: 0 };
    byZone[z].total++;
    if (r.Estado === 'Habilitado') byZone[z].habilitados++;
    else if (r.Estado === 'Cancelado') byZone[z].cancelados++;
  });
  const resumenRows = Object.entries(byZone)
    .map(([z, d]) => ({
      'Zona / Vendedor': z,
      'Total tiendas': d.total,
      Habilitadas: d.habilitados,
      Canceladas: d.cancelados,
    }))
    .sort((a, b) => b['Total tiendas'] - a['Total tiendas']);
  const wsRes = XLSX.utils.json_to_sheet(resumenRows);
  wsRes['!cols'] = [{ wch: 48 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen por zona');

  const ts = new Date().toISOString().slice(0, 10);
  // v331: sufijo con el scope aplicado para diferenciar el archivo del VDE/VDI
  // del export global del admin.
  const scopeLbl =
    scopeSet === null
      ? 'TODOS'
      : scopeSet.size === 1
        ? [...scopeSet][0].split(' ')[0]
        : 'mis-zonas-' + scopeSet.size;
  const fname = 'Masterfile_Clientes_SAP_' + scopeLbl + '_' + ts + '.xlsx';
  XLSX.writeFile(wb, fname);
  showSyncTag(
    rows.length +
      ' clientes exportados' +
      (scopeSet === null ? '' : ' (scope: ' + [...scopeSet].join(', ') + ')')
  );
};

// =====================================================================
// Export: Precios + Stock por SKU
// =====================================================================
// Genera un Excel con TODO el catalogo cruzando los 3 mapas vigentes
// en memoria: PRODUCTS (master de SKUs), PRICE_LIST_MAP (precio ARS de
// Firestore) y STOCK_MAP (booleano por SKU del stock.json del repo).
// Hojas:
//  - "Precios y Stock": una fila por SKU con todas las columnas juntas
//    (lo mas comun para revisar disponibilidad + precio).
//  - "Precios": solo SKU + descripcion + precio (sin stock).
//  - "Stock": solo SKU + descripcion + estado de stock.
//  - "Info": fecha de los snapshots y fuentes.
window.exportPreciosStock = function () {
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.');
    return;
  }
  if (!Array.isArray(PRODUCTS) || !PRODUCTS.length) {
    alert('No hay catalogo de productos cargado todavia.');
    return;
  }
  showSyncTag('Generando Excel precios + stock...');
  // v574 (2026-08-21): pedido de Mariano — mostrar UNIDADES numericas
  // exactas del deposito 11 (venta) en vez de "Disponible"/"Sin stock".
  // Usa getStockDisponibleVenta que lee STOCK_WAREHOUSE_BREAKDOWN[sku]['11'].
  // Retorna '' (celda vacia) cuando no hay dato de stock (snapshot no cargado
  // aun); 0 si el SKU no tiene stock. Los numeros permiten sort/filter/sum en
  // Excel — no perdemos el estado "no dato" vs "0 unidades" gracias al ''.
  function fmtStock(sku) {
    const fn =
      typeof window !== 'undefined' && typeof window.getStockDisponibleVenta === 'function'
        ? window.getStockDisponibleVenta
        : null;
    const v = fn ? fn(sku) : null;
    if (v == null) return '';
    return Number(v) || 0;
  }
  function fmtPrecio(sku) {
    const p = typeof PRICE_LIST_MAP === 'object' && PRICE_LIST_MAP ? PRICE_LIST_MAP[sku] : null;
    if (p == null) return '';
    return Number(p) || 0;
  }
  // Hoja 1: combo completo (es la mas pedida).
  const rows = PRODUCTS.map((p) => ({
    SKU: p.code || '',
    Descripcion: p.desc || '',
    Familia: p.fam || '',
    Subfamilia: p.sub || '',
    Categoria: p.cat || '',
    'Precio ARS': fmtPrecio(p.code),
    'Stock W11': fmtStock(p.code),
  })).sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 60 },
    { wch: 18 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
  ];
  // Aplicar formato moneda a la columna Precio ARS (columna F = 6).
  for (let i = 2; i <= rows.length + 1; i++) {
    const cell = ws['F' + i];
    if (cell && typeof cell.v === 'number') cell.z = '"$"#,##0';
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Precios y Stock');

  // Hoja 2: solo Precios
  const preciosRows = PRODUCTS.map((p) => ({
    SKU: p.code || '',
    Descripcion: p.desc || '',
    'Precio ARS': fmtPrecio(p.code),
  }))
    .filter((r) => r['Precio ARS'] !== '')
    .sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));
  const wsP = XLSX.utils.json_to_sheet(preciosRows);
  wsP['!cols'] = [{ wch: 14 }, { wch: 60 }, { wch: 14 }];
  for (let i = 2; i <= preciosRows.length + 1; i++) {
    const cell = wsP['C' + i];
    if (cell && typeof cell.v === 'number') cell.z = '"$"#,##0';
  }
  XLSX.utils.book_append_sheet(wb, wsP, 'Precios');

  // Hoja 3: solo Stock
  const stockRows = PRODUCTS.map((p) => ({
    SKU: p.code || '',
    Descripcion: p.desc || '',
    'Stock W11': fmtStock(p.code),
  })).sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));
  const wsS = XLSX.utils.json_to_sheet(stockRows);
  wsS['!cols'] = [{ wch: 14 }, { wch: 60 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsS, 'Stock');

  // Hoja 4: metadata - cuando fue cada snapshot para que el lector sepa
  // si la lista esta fresca.
  const infoRows = [
    { Item: 'Total SKUs en catalogo', Valor: PRODUCTS.length },
    { Item: 'Total SKUs con precio cargado', Valor: preciosRows.length },
    {
      Item: 'Total SKUs con stock disponible',
      Valor: PRODUCTS.filter((p) => hasStock(p.code) === true).length,
    },
    {
      Item: 'Total SKUs sin stock',
      Valor: PRODUCTS.filter((p) => hasStock(p.code) === false).length,
    },
    {
      Item: 'Total SKUs sin dato de stock',
      Valor: PRODUCTS.filter((p) => hasStock(p.code) == null).length,
    },
    {
      Item: 'Lista de precios moneda',
      Valor: typeof PRICE_LIST_CURRENCY !== 'undefined' ? PRICE_LIST_CURRENCY : 'ARS',
    },
    {
      Item: 'Lista de precios actualizada',
      Valor:
        typeof PRICE_LIST_UPDATED_AT !== 'undefined' && PRICE_LIST_UPDATED_AT
          ? new Date(PRICE_LIST_UPDATED_AT).toLocaleString('es-AR')
          : '(no cargada)',
    },
    {
      Item: 'Stock snapshot actualizado',
      Valor: STOCK_UPDATED_AT ? new Date(STOCK_UPDATED_AT).toLocaleString('es-AR') : '(no cargado)',
    },
    { Item: 'Exportado', Valor: new Date().toLocaleString('es-AR') },
    {
      Item: 'Exportado por',
      Valor: (currentUser && (currentUser.email || currentUser.displayName)) || '(desconocido)',
    },
  ];
  const wsI = XLSX.utils.json_to_sheet(infoRows);
  wsI['!cols'] = [{ wch: 36 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wsI, 'Info');

  const ts = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Precios_y_Stock_' + ts + '.xlsx');
  showSyncTag(rows.length + ' SKUs exportados (precios + stock)');
};

// ======================================================
// EXPORT - dialogo de seleccion + 3 formatos
// ======================================================
window.exportToExcel = function () {
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.');
    return;
  }
  // Filtrar opciones segun rol.
  //   vendedor: operativo diario (Ventas / Visitas / Rutas) + Clientes de su zona
  //     (exportMasterClientes ya filtra por getEffectiveVendorSet -> solo su vendor).
  //   interno (VDI): mismo scope operativo + Clientes de sus parejas (o solo el
  //     propio si eligio su nombre en el dropdown de zonas).
  //   admin / gerente / viewer: ven todo el listado (null = sin filtro).
  const allowedByRole = {
    vendedor: new Set(['VENTAS', 'VISITAS', 'RUTAS', 'MASTER']),
    interno: new Set(['VENTAS', 'VISITAS', 'RUTAS', 'MASTER']),
  };
  const allowed = allowedByRole[userRole] || null; // null = ver todo
  document.querySelectorAll('#export-modal .exp-opt').forEach((el) => {
    const kind = el.dataset.expKind || '';
    el.style.display = !allowed || allowed.has(kind) ? '' : 'none';
  });
  document.getElementById('export-modal').classList.add('open');
};
window.closeExportDialog = function () {
  document.getElementById('export-modal').classList.remove('open');
};

// ============================================================
// Month picker reutilizable para los 5 tipos de export
// ============================================================
let pendingExportType = null;
const EXPORT_TYPE_LABELS = {
  VENTAS: 'Ventas',
  VISITAS: 'Visitas',
  RENDICIONES: 'Rendiciones',
  RUTAS: 'Rutas',
  ALTAS: 'Altas de clientes',
};

window.showMonthPicker = function (tipo) {
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.');
    return;
  }
  pendingExportType = tipo;
  const title = document.getElementById('em-title');
  const subt = document.getElementById('em-subt');
  title.textContent = 'Exportar ' + (EXPORT_TYPE_LABELS[tipo] || tipo);
  subt.textContent = 'Elegi el mes y año que queres descargar.';
  // Populate selects
  const now = new Date();
  const mesSel = document.getElementById('em-mes');
  mesSel.innerHTML =
    '<option value="ALL">Todos los meses (año entero)</option>' +
    MESES.map((m, i) => '<option value="' + i + '">' + m + '</option>').join('');
  mesSel.value = now.getMonth();
  const anioSel = document.getElementById('em-anio');
  const year = now.getFullYear();
  let yopts = '';
  for (let y = year - 3; y <= year + 1; y++)
    yopts += '<option value="' + y + '">' + y + '</option>';
  anioSel.innerHTML = yopts;
  anioSel.value = year;
  document.getElementById('export-month-modal').classList.add('open');
};

window.closeMonthPicker = function () {
  document.getElementById('export-month-modal').classList.remove('open');
  pendingExportType = null;
};

window.confirmMonthPicker = function () {
  const tipo = pendingExportType;
  const mesRaw = document.getElementById('em-mes').value;
  const anio = parseInt(document.getElementById('em-anio').value, 10);
  const monthIdx = mesRaw === 'ALL' ? null : parseInt(mesRaw, 10);
  document.getElementById('export-month-modal').classList.remove('open');
  pendingExportType = null;
  if (!tipo) return;
  try {
    if (tipo === 'VENTAS') exportVentasForMonth(anio, monthIdx);
    else if (tipo === 'VISITAS') exportVisitasForMonth(anio, monthIdx);
    else if (tipo === 'RENDICIONES') exportRendicionesForMonth(anio, monthIdx);
    else if (tipo === 'RUTAS') exportRutasForMonth(anio, monthIdx);
    else if (tipo === 'ALTAS') exportAltasForMonth(anio, monthIdx);
    else alert('Tipo desconocido: ' + tipo);
  } catch (e) {
    console.error('export ' + tipo, e);
    alert('Error generando export: ' + (e.message || e));
  }
};

function periodLabel(anio, monthIdx) {
  if (monthIdx === null || monthIdx === undefined) return String(anio);
  return MESES[monthIdx] + '_' + anio;
}

function downloadXlsx(filename, sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(
      s.rows.length ? s.rows : [{ Aviso: 'Sin datos para el periodo seleccionado' }]
    );
    if (s.rows.length) {
      const cols = Object.keys(s.rows[0]).map((k) => ({
        wch: Math.min(40, Math.max(10, k.length + 4)),
      }));
      ws['!cols'] = cols;
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

// ============================================================
// VENTAS: pedidos confirmados del periodo
// ============================================================
async function exportVentasForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Ventas...');
  let snap;
  try {
    snap = await fbDb.collection('pedidos').get();
  } catch (e) {
    alert('Error leyendo pedidos: ' + (e.message || e));
    return;
  }
  const rows = [];
  snap.forEach((d) => {
    const p = d.data() || {};
    if (parseInt(p.year, 10) !== anio) return;
    if (monthIdx !== null && parseInt(p.monthIdx, 10) !== monthIdx) return;
    const lines = p.lines || [];
    if (!lines.length) return;
    const vendorKey = p.vendor || lookupVendorForClient(p.province, p.locName, p.clientName) || '';
    const vendorInfo = vendorLookup[vendorKey] || {};
    const factor = typeof pedidoDiscountFactor === 'function' ? pedidoDiscountFactor(p) : 1;
    const discPct = (p.discountSnapshot && p.discountSnapshot.pctTotal) || 0;
    lines.forEach((l) => {
      const qty = parseFloat(l.qty) || 0;
      const precio = parseFloat(l.precio) || 0;
      const gross = qty * precio;
      const net = gross * factor;
      rows.push({
        Mes: p.month || '',
        Fecha_Confirmado: p.confirmedAt ? String(p.confirmedAt).slice(0, 10) : '',
        Estado: p.stage || '',
        Vendedor: titleCase(vendorKey || ''),
        Zona: vendorInfo.zone || '',
        Provincia: titleCase(p.province || ''),
        Localidad: p.locName || '',
        Cliente: p.clientName || '',
        Codigo_SKU: l.code || '',
        Producto: l.desc || '',
        Categoria: l.cat || '',
        Familia: l.fam || '',
        Subfamilia: l.sub || '',
        Cantidad: qty,
        Precio_Unit_ARS: precio,
        // Subtotal_ARS = NETO (con descuento aplicado) - es lo que cuenta
        // para el target del vendedor. Subtotal_Bruto_ARS muestra el valor
        // de lista sin descuento para trazabilidad.
        Subtotal_ARS: Math.round(net),
        Subtotal_Bruto_ARS: Math.round(gross),
        Descuento_Pct: discPct,
        En_Nombre_De_VDE: p.onBehalfOf ? 'SI' : 'NO',
        Cargado_Por: p.createdByDisplayName || p.createdByEmail || '',
      });
    });
  });
  const fname = 'Shimano_Ventas_' + periodLabel(anio, monthIdx) + '.xlsx';
  downloadXlsx(fname, [{ name: 'Ventas', rows }]);
  showSyncTag('Export Ventas listo (' + rows.length + ' lineas)', 2400);
}

function lookupVendorForClient(prov, locName, _clientName) {
  if (!prov || !locName) return '';
  const pt = POINTS.find((p) => p.province === prov && p.name === locName);
  return pt ? pt.vendor || '' : '';
}

// ============================================================
// VISITAS: detalle de visitas del periodo
// ============================================================
async function exportVisitasForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Visitas + Contactos...');
  let snap;
  try {
    snap = await fbDb.collection('visits').get();
  } catch (e) {
    alert('Error leyendo visitas: ' + (e.message || e));
    return;
  }
  const targetMes = monthIdx !== null ? MESES[monthIdx].toUpperCase() : null;
  const items = [];
  snap.forEach((d) => {
    const v = d.data() || {};
    if (parseInt(v.anio, 10) !== anio) return;
    if (targetMes && (v.mes || '').toUpperCase() !== targetMes) return;
    items.push(v);
  });
  if (!items.length) {
    alert('No hay visitas ni contactos en el periodo seleccionado.');
    return;
  }
  const nVisitas = items.filter((v) => v.interactionType !== 'contacto').length;
  const nContactos = items.length - nVisitas;
  // ExcelJS con foto del frente embebida en cada fila. Lazy load.
  try {
    await loadExcelJS();
  } catch (e) {
    alert(e.message || e);
    return;
  }
  showSyncTag('Generando Excel: ' + nVisitas + ' visitas + ' + nContactos + ' contactos...', 3000);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'App Vendedores Shimano';
  wb.created = new Date();
  const ws = wb.addWorksheet('Visitas y Contactos', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Mes', key: 'mes', width: 10 },
    { header: 'Anio', key: 'anio', width: 8 },
    { header: 'Vendedor', key: 'vendedor', width: 22 },
    { header: 'Owner Email', key: 'email', width: 28 },
    { header: 'Interaccion', key: 'interaccion', width: 12 },
    { header: 'Forma Contacto', key: 'formaContacto', width: 22 },
    { header: 'Resultado Contacto', key: 'resultadoCt', width: 16 },
    { header: 'Comentario', key: 'coment', width: 30 },
    { header: 'Provincia', key: 'provincia', width: 16 },
    { header: 'Localidad', key: 'localidad', width: 18 },
    { header: 'Tienda', key: 'tienda', width: 28 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Local', key: 'local', width: 12 },
    { header: 'Tamano', key: 'tamano', width: 10 },
    { header: 'Fidelidad', key: 'fidelidad', width: 10 },
    { header: 'Relevancia', key: 'relev', width: 10 },
    { header: 'POP', key: 'pop', width: 8 },
    { header: 'Necesidad Puntual', key: 'nec', width: 22 },
    { header: 'Oportunidad', key: 'oportu', width: 24 },
    { header: 'Mas Vendido', key: 'masVe', width: 24 },
    { header: 'Mas Preguntan', key: 'masPr', width: 24 },
    { header: 'Ayuda Tienda', key: 'ayuda', width: 22 },
    { header: 'Tipo Venta', key: 'tipoVenta', width: 12 },
    { header: 'Pond Mostrador', key: 'pMost', width: 10 },
    { header: 'Pond Ecommerce', key: 'pEcom', width: 10 },
    { header: 'Competencia', key: 'compe', width: 16 },
    { header: 'GPS Status', key: 'gpsSt', width: 12 },
    { header: 'GPS Dist (m)', key: 'gpsDist', width: 10 },
    { header: 'Foto frente', key: 'foto', width: 22 },
    { header: 'En nombre de VDE', key: 'onBehalf', width: 12 },
    { header: 'Cargado Por', key: 'createdBy', width: 24 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C4A6E' } };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 22;

  const FOTO_COL_IDX = ws.getColumn('foto').number - 1;
  const ROW_H = 100;
  const IMG_W = 130;
  const IMG_H = 90;

  // Orden cronologico desc
  items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  for (const v of items) {
    const isContacto = v.interactionType === 'contacto';
    const interaccionLbl = isContacto ? 'Contacto' : 'Visita';
    const formaContactoLbl = isContacto ? v.formaContacto || 'Sin especificar' : 'Presencial';
    let resultadoCtLbl = '';
    if (isContacto) {
      if (v.contactoResultado === 'respondio') resultadoCtLbl = 'Respondio';
      else if (v.contactoResultado === 'no_respondio') resultadoCtLbl = 'No respondio';
      else resultadoCtLbl = 'Sin marcar';
    }
    const row = ws.addRow({
      fecha: v.fecha || '',
      mes: v.mes || '',
      anio: v.anio || '',
      vendedor: titleCase(v.vendor || ''),
      email: v.ownerEmail || '',
      interaccion: interaccionLbl,
      formaContacto: formaContactoLbl,
      resultadoCt: resultadoCtLbl,
      coment: v.comentario || '',
      provincia: titleCase(v.provincia || ''),
      localidad: v.localidad || '',
      tienda: v.tienda || '',
      tipo: v.tipo || '',
      local: v.local || '',
      tamano: v.tamano || '',
      fidelidad: v.fidelidad || '',
      relev: v.relevancia || '',
      pop: v.pop || '',
      nec: v.necesidadPuntual || '',
      oportu: v.oportunidad || '',
      masVe: v.masVendido || '',
      masPr: v.masPreguntan || '',
      ayuda: v.ayudaTienda || '',
      tipoVenta: v.tipoVenta === 'MOSTRADO' ? 'MOSTRADOR' : v.tipoVenta || '',
      pMost: v.ponderacionMostrado || '',
      pEcom: v.ponderacionEcommerce || '',
      compe: v.competencia || '',
      gpsSt: v.gpsStatus || '',
      gpsDist: v.gpsDistanceM != null ? v.gpsDistanceM : '',
      foto: '', // celda vacia - imagen encima
      onBehalf: v.onBehalfOf ? 'SI' : 'NO',
      createdBy: v.createdByDisplayName || v.createdByEmail || '',
    });
    row.height = ROW_H;
    row.alignment = { vertical: 'middle', wrapText: true };
    if (v.frenteLocal && typeof v.frenteLocal === 'string') {
      try {
        let b64 = v.frenteLocal;
        let ext = 'jpeg';
        const m = /^data:image\/(\w+);base64,(.+)$/i.exec(b64);
        if (m) {
          ext = m[1].toLowerCase();
          b64 = m[2];
        }
        if (ext === 'jpg') ext = 'jpeg';
        const imageId = wb.addImage({ base64: b64, extension: ext });
        ws.addImage(imageId, {
          tl: { col: FOTO_COL_IDX + 0.1, row: row.number - 1 + 0.1 },
          ext: { width: IMG_W, height: IMG_H },
          editAs: 'oneCell',
        });
      } catch (e) {
        console.warn('embebiendo foto visita', e);
      }
    }
  }

  try {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Shimano_Visitas_' + periodLabel(anio, monthIdx) + '.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showSyncTag('Export listo: ' + nVisitas + ' visitas + ' + nContactos + ' contactos', 2400);
  } catch (e) {
    console.error('exportVisitasForMonth', e);
    alert('Error generando el Excel: ' + (e.message || e));
  }
}

// ============================================================
// RENDICIONES: gastos y anticipos del periodo
// ============================================================
async function exportRendicionesForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Rendiciones...');
  let snap;
  try {
    snap = await fbDb.collection('rendiciones').get();
  } catch (e) {
    alert('Error leyendo rendiciones: ' + (e.message || e));
    return;
  }
  // Filtrar por mes/anio
  const items = [];
  snap.forEach((d) => {
    const r = d.data() || {};
    let dt = r.fecha || r.fechaGasto || '';
    if (!dt && r.createdAt && r.createdAt.toDate) {
      try {
        dt = r.createdAt.toDate().toISOString().slice(0, 10);
      } catch (_e) {}
    }
    if (!dt) return;
    const dObj = new Date(dt);
    if (Number.isNaN(dObj.getTime())) return;
    if (dObj.getFullYear() !== anio) return;
    if (monthIdx !== null && dObj.getMonth() !== monthIdx) return;
    items.push({ id: d.id, fecha: dt, r: r });
  });
  if (!items.length) {
    alert('No hay rendiciones en el periodo seleccionado.');
    return;
  }
  // ExcelJS con foto embebida en cada fila. Carga lazy.
  try {
    await loadExcelJS();
  } catch (e) {
    alert(e.message || e);
    return;
  }
  showSyncTag('Generando Excel con ' + items.length + ' rendiciones...', 3000);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'App Vendedores Shimano';
  wb.created = new Date();
  const ws = wb.addWorksheet('Rendiciones', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Vendedor', key: 'vendedor', width: 26 },
    { header: 'Owner Email', key: 'email', width: 28 },
    { header: 'Concepto', key: 'concepto', width: 18 },
    { header: 'N Ticket', key: 'numTicket', width: 14 },
    { header: 'Modo pago', key: 'modoPago', width: 14 },
    { header: 'Tipo gasto', key: 'tipoGasto', width: 24 },
    { header: 'Division', key: 'division', width: 14 },
    { header: 'Importe', key: 'importe', width: 12 },
    { header: 'Moneda', key: 'moneda', width: 10 },
    { header: 'Importe USD', key: 'importeUsd', width: 12 },
    { header: 'Observaciones', key: 'obs', width: 30 },
    { header: 'Foto ticket', key: 'foto', width: 22 },
    { header: 'Estado', key: 'estado', width: 18 },
    { header: 'Aprobador', key: 'aprobador', width: 28 },
    { header: 'Aprobado en', key: 'aprobadoEn', width: 14 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7E22CE' } };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 22;

  const FOTO_COL_IDX = ws.getColumn('foto').number - 1; // 0-indexed para addImage
  const ROW_H = 110;
  const IMG_W = 140;
  const IMG_H = 100;

  // Orden cronologico desc
  items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  for (const it of items) {
    const r = it.r;
    const isGasto = r.tipo === 'gasto';
    const conceptStr = isGasto ? r.descripcion || '' : r.tipoOperacion || r.motivo || '';
    const obsStr =
      (r.observaciones || r.notas || '') +
      (isGasto ? '' : r.solicitadoPor ? ' | Solicitado por: ' + r.solicitadoPor : '');
    const row = ws.addRow({
      fecha: it.fecha,
      tipo: r.tipo || '',
      vendedor: r.ownerName || r.vendorName || r.ownerEmail || '',
      email: r.ownerEmail || '',
      concepto: conceptStr,
      numTicket: r.numeroTicket || '',
      modoPago: r.modoPago || '',
      tipoGasto: r.tipoGasto || '',
      division: r.divisionGasto || '',
      importe: r.importe != null ? r.importe : '',
      moneda: r.moneda || 'PESOS',
      importeUsd: r.importeUsd != null && r.importeUsd !== 0 ? r.importeUsd : '',
      obs: obsStr,
      foto: '', // celda vacia - encima va la imagen
      estado: r.status || r.estado || '',
      aprobador: r.approverEmail || r.aprobador || '',
      aprobadoEn:
        r.approvedAt && r.approvedAt.toDate ? r.approvedAt.toDate().toISOString().slice(0, 10) : '',
    });
    row.height = ROW_H;
    row.alignment = { vertical: 'middle', wrapText: true };
    // Embeber foto del ticket si existe. v308+: preferir base64 embebido
    // (fotoTicket / adjunto) por compat, sino usar fotoTicketUrl como HYPERLINK.
    // A nivel Excel un dataURL base64 se puede insertar como imagen inline,
    // mientras que una URL de Storage se agrega como link clickeable (el
    // usuario abre en el browser sin necesidad de que Excel descargue).
    const fotoSrc = r.fotoTicket || r.adjunto || '';
    if (fotoSrc && typeof fotoSrc === 'string' && fotoSrc.startsWith('data:image/')) {
      try {
        let b64 = fotoSrc;
        let ext = 'jpeg';
        const m = /^data:image\/(\w+);base64,(.+)$/i.exec(b64);
        if (m) {
          ext = m[1].toLowerCase();
          b64 = m[2];
        }
        if (ext === 'jpg') ext = 'jpeg';
        const imageId = wb.addImage({ base64: b64, extension: ext });
        ws.addImage(imageId, {
          tl: { col: FOTO_COL_IDX + 0.1, row: row.number - 1 + 0.1 },
          ext: { width: IMG_W, height: IMG_H },
          editAs: 'oneCell',
        });
      } catch (e) {
        console.warn('embebiendo foto rendicion', it.id, e);
      }
    } else if (r.fotoTicketUrl && typeof r.fotoTicketUrl === 'string') {
      // Docs nuevos (v308+): foto en Storage, insertamos como hyperlink.
      try {
        const cell = row.getCell(FOTO_COL_IDX + 1);
        cell.value = {
          text: 'Abrir ticket',
          hyperlink: r.fotoTicketUrl,
          tooltip: 'Abrir la foto del ticket en el browser',
        };
        cell.font = { color: { argb: 'FF0563C1' }, underline: true };
      } catch (e) {
        console.warn('hyperlink foto rendicion', it.id, e);
      }
    }
  }

  try {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Shimano_Rendiciones_' + periodLabel(anio, monthIdx) + '.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showSyncTag('Export Rendiciones listo (' + items.length + ' filas)', 2400);
  } catch (e) {
    console.error('exportRendicionesForMonth', e);
    alert('Error generando el Excel: ' + (e.message || e));
  }
}

// ============================================================
// RUTAS: rutas asignadas del periodo + overrides
// ============================================================
async function exportRutasForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Rutas...');
  // Las rutas se generan en runtime para cada vendedor; en cambio los overrides
  // (derivaciones / reagendas) viven en route_overrides. Exportamos:
  //  - una hoja con las rutas planificadas del periodo (para los vendedores
  //    del rol actual o todos si admin)
  //  - una hoja con los overrides del periodo
  const targetVendors =
    userRole === 'admin' || userRole === 'viewer'
      ? VENDORS.map((v) => v.key)
      : assignedVendor
        ? [assignedVendor]
        : [];
  const monthsToExport = monthIdx !== null ? [monthIdx] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const rutasRows = [];
  for (const vend of targetVendors) {
    for (const m of monthsToExport) {
      let rutas;
      try {
        rutas = generarRutasVendor(vend, m, anio);
      } catch (_e) {
        rutas = [];
      }
      (rutas || []).forEach((ruta) => {
        (ruta.tiendas || []).forEach((t, i) => {
          rutasRows.push({
            Vendedor: titleCase(vend),
            Anio: anio,
            Mes: MESES[m],
            Ruta_ID: ruta.id || '',
            Ruta_Nombre: ruta.nombre || '',
            Fecha_Asignada: ruta.fechaAsignada || '',
            Orden: i + 1,
            Provincia: titleCase(t.province || ''),
            Localidad: t.locName || '',
            Tienda: t.clientName || '',
            Tipo: t.tipo || '',
            Estado: t.estado || '',
          });
        });
      });
    }
  }
  // Overrides
  let ovrSnap;
  try {
    ovrSnap = await fbDb.collection('route_overrides').get();
  } catch (_e) {
    ovrSnap = null;
  }
  const overridesRows = [];
  if (ovrSnap) {
    ovrSnap.forEach((d) => {
      const o = d.data() || {};
      if (parseInt(o.anio, 10) !== anio) return;
      if (monthIdx !== null && parseInt(o.monthIdx, 10) !== monthIdx) return;
      overridesRows.push({
        Anio: o.anio || '',
        Mes: MESES[parseInt(o.monthIdx, 10)] || '',
        Vendedor: titleCase(o.vendor || ''),
        Provincia: titleCase(o.province || ''),
        Localidad: o.locName || '',
        Tienda: o.clientName || '',
        Accion: o.action || o.tipo || '',
        Derivada_A: o.derivadaA || '',
        Reagendada_Para: o.reagendadaPara || '',
        Motivo: o.motivo || '',
        Creado_Por: o.createdByEmail || '',
        Creado_En:
          o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().toISOString().slice(0, 10) : '',
      });
    });
  }
  const fname = 'Shimano_Rutas_' + periodLabel(anio, monthIdx) + '.xlsx';
  downloadXlsx(fname, [
    { name: 'Rutas planificadas', rows: rutasRows },
    { name: 'Derivaciones-Reagendas', rows: overridesRows },
  ]);
  showSyncTag(
    'Export Rutas listo (' + rutasRows.length + ' tiendas, ' + overridesRows.length + ' overrides)',
    2400
  );
}

// ============================================================
// ALTAS: solicitudes de alta de cliente del periodo
// ============================================================
async function exportAltasForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Altas...');
  let snap;
  try {
    snap = await fbDb.collection('client_applications').get();
  } catch (e) {
    alert('Error leyendo altas: ' + (e.message || e));
    return;
  }
  const rows = [];
  snap.forEach((d) => {
    const a = d.data() || {};
    let dt = '';
    if (a.createdAt && a.createdAt.toDate) {
      try {
        dt = a.createdAt.toDate();
      } catch (_e) {}
    }
    if (!dt) return;
    if (dt.getFullYear() !== anio) return;
    if (monthIdx !== null && dt.getMonth() !== monthIdx) return;
    rows.push({
      Fecha_Solicitud: dt.toISOString().slice(0, 10),
      Estado: a.status || '',
      Comercio: a.comercio || '',
      Fantasia: a.fantasia || '',
      CUIT: a.cuit || '',
      Condicion_Fiscal: a.condFiscal || '',
      Calle: a.calle || '',
      Numero: a.numero || '',
      Localidad: a.localidad || '',
      Provincia: a.provincia || '',
      CP: a.cp || '',
      Telefono: a.telefono || '',
      Email: a.email || '',
      Vendedor_Solicitante: a.vendorName || a.ownerEmail || '',
      Owner_Email: a.ownerEmail || '',
      Submitted_By_Public_Form: a.submittedByPublicForm ? 'SI' : 'NO',
      Aprobado_Por: a.approvedByEmail || '',
      Aprobado_En:
        a.approvedAt && a.approvedAt.toDate ? a.approvedAt.toDate().toISOString().slice(0, 10) : '',
      Rechazado_Motivo: a.rejectedReason || '',
    });
  });
  const fname = 'Shimano_Altas_' + periodLabel(anio, monthIdx) + '.xlsx';
  downloadXlsx(fname, [{ name: 'Altas de clientes', rows }]);
  showSyncTag('Export Altas listo (' + rows.length + ' solicitudes)', 2400);
}

// Exportar para Analisis: protegido con PIN
const ANALISIS_PIN = '1235';
// =====================================================================
// Export Excel TARGETS-ZONAS - solo clientes habilitados en SAP
// =====================================================================
// Genera la hoja CLIENTES_ZONAS con UNA fila por BP que esta vivo en SAP:
// cualquier alta de client_applications con status='approved' Y cardCodeSap
// asignado. Excluye POINTS / distribuidores / prospectos / altas sin
// CardCode (mocks o pendientes de SAP). Es lo que efectivamente se factura.
// Columnas: TIPO, NRO CTE, REGION, PROVINCIA, ASESOR EXTERNO, ASESOR INTERNO,
// CALLE, NUMERO, LOCALIDAD, CP, NOMBRE COMERCIAL, NOMBRE DE FANTASIA, CUIT,
// CONDICION FISCAL, TELEFONO, CARDCODE SAP.
window.exportTargetsZonas = async function () {
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verificá tu conexión y reintentá.');
    return;
  }
  if (userRole !== 'admin' && userRole !== 'gerente') {
    alert('Solo admin o gerente puede exportar el master.');
    return;
  }
  showSyncTag('Generando Excel TARGETS-ZONAS...');
  const VDE_TO_VDI = {
    'FEDERICO CASTELANELLI': 'IOANNIS PALKOUDAKIS',
    'GONZALO DE LA ROSA': 'IOANNIS PALKOUDAKIS',
    'MAURICIO GIL': 'SANTIAGO ESTEBAN',
    'MARTIN BOIERO': 'SANTIAGO ESTEBAN',
  };
  function regionOf(prov) {
    const p = (prov || '').toUpperCase();
    if (['BUENOS AIRES', 'CAPITAL FEDERAL', 'LA PAMPA'].includes(p)) return 'BUENOS AIRES';
    if (['CORDOBA', 'SAN LUIS', 'MENDOZA', 'SAN JUAN', 'LA RIOJA'].includes(p)) return 'CUYO';
    if (['SANTA FE', 'ENTRE RIOS', 'CHACO', 'CORRIENTES', 'MISIONES', 'FORMOSA'].includes(p))
      return 'NEA';
    if (['JUJUY', 'SALTA', 'TUCUMAN', 'CATAMARCA', 'SANTIAGO DEL ESTERO'].includes(p)) return 'NOA';
    if (['NEUQUEN', 'RIO NEGRO', 'CHUBUT', 'SANTA CRUZ', 'TIERRA DEL FUEGO'].includes(p))
      return 'PATAGONIA';
    return '';
  }
  function vendorLabelForExcel(key) {
    if (!key) return '';
    if (key === '__DISTRIBUTOR__') return 'DISTRIBUIDORES';
    return key;
  }
  const rows = [];
  let altasSnap;
  try {
    altasSnap = await fbDb
      .collection('client_applications')
      .where('status', '==', 'approved')
      .get();
  } catch (e) {
    alert('Error leyendo altas aprobadas: ' + (e.message || e));
    return;
  }
  let skippedNoSap = 0;
  altasSnap.forEach((d) => {
    const a = d.data() || {};
    const cardCode = (a.cardCodeSap || '').trim();
    // Filtro clave: solo BPs con CardCode SAP asignado (= habilitado en SAP).
    if (!cardCode) {
      skippedNoSap++;
      return;
    }
    const province = (a.provincia || '').toUpperCase().trim();
    const localityFinal = a.localidadFinal || a.localidad || '';
    const vendor = a.assignedVendor || '';
    rows.push({
      TIPO: 'DADO DE ALTA',
      'NRO CTE': 0, // se renumera despues del sort
      REGION: regionOf(province),
      PROVINCIA: province,
      'ASESOR EXTERNO': vendorLabelForExcel(vendor),
      'ASESOR INTERNO': VDE_TO_VDI[vendor] || '',
      CALLE: a.calle || '',
      NUMERO: a.numero || '',
      LOCALIDAD: localityFinal,
      CP: a.cp || '',
      'NOMBRE COMERCIAL': a.comercio || a.titular || '',
      'NOMBRE DE FANTASIA': a.fantasia || '',
      CUIT: a.cuit || '',
      'CONDICION FISCAL': a.condicionFiscal || '',
      TELEFONO: a.telefono || '',
      'CARDCODE SAP': cardCode,
    });
  });
  if (!rows.length) {
    alert(
      'No hay clientes habilitados en SAP todavia.\n\nUna alta entra al export solo cuando tiene CardCode SAP asignado.'
    );
    return;
  }
  rows.sort((r1, r2) => {
    const p = (r1.PROVINCIA || '').localeCompare(r2.PROVINCIA || '');
    if (p !== 0) return p;
    const l = (r1.LOCALIDAD || '').localeCompare(r2.LOCALIDAD || '');
    if (l !== 0) return l;
    return (r1['NOMBRE COMERCIAL'] || '').localeCompare(r2['NOMBRE COMERCIAL'] || '');
  });
  rows.forEach((r, i) => (r['NRO CTE'] = i + 1));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 10 },
    { wch: 16 },
    { wch: 22 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
    { wch: 10 },
    { wch: 22 },
    { wch: 10 },
    { wch: 38 },
    { wch: 32 },
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'CLIENTES_ZONAS');
  const ts = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'TARGETS_VENDEDORES_ZONAS_' + ts + '.xlsx');
  showSyncTag(
    'Excel exportado: ' +
      rows.length +
      ' clientes SAP habilitados' +
      (skippedNoSap > 0 ? ' (' + skippedNoSap + ' sin CardCode descartados)' : '')
  );
};

window.openExportAnalisis = function () {
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.');
    return;
  }
  const pin = prompt(
    'Esta seccion contiene formatos avanzados (Power BI, Python/ML, ZIP de fotos) destinados a analisis tecnico.\n\nIngresa el PIN para continuar:'
  );
  if (pin === null) return;
  if (pin !== ANALISIS_PIN) {
    alert('PIN incorrecto.');
    return;
  }
  // Opcion Integracion SAP: solo para Mariano (erbinomariano@gmail.com)
  const sapOpt = document.getElementById('exp-opt-sap-integration');
  if (sapOpt) {
    const isMariano =
      currentUser && (currentUser.email || '').toLowerCase() === 'erbinomariano@gmail.com';
    sapOpt.style.display = isMariano ? '' : 'none';
  }
  // Opcion Backup mensual: solo admin
  const bkOpt = document.getElementById('exp-opt-backup-mensual');
  if (bkOpt) bkOpt.style.display = userRole === 'admin' ? '' : 'none';
  document.getElementById('export-analisis-modal').classList.add('open');
};
window.closeExportAnalisis = function () {
  document.getElementById('export-analisis-modal').classList.remove('open');
};

// Todas las funciones window.foo = function... ya están verbatim.
// Helpers internos (downloadXlsx, exportVentasForMonth, etc.) son consumidos
// solo dentro de este bloque (verificado pre-extracción).
