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
window.exportMasterClientes = async function () {
  if (!POINTS || !POINTS.length) {
    alert('No hay datos cargados todavia.');
    return;
  }
  showSyncTag('Generando masterfile de clientes...');

  // v1482 §82: cargar client_buyer_stats en bloque (1 doc por cardCode SAP)
  // ANTES de armar las filas, así cada fila tiene su buyer stats + fecha
  // última compra sin romper el flujo. Fire-and-forget si falla: cada fila
  // cae a "-" en los campos Buyer. Admin/gerente ve toda la colección;
  // vendedor ve sólo los suyos (rules). Si la rule bloquea → catch → vacío.
  // Pedido Mariano: no inventar cálculo de "Fecha última compra"; si no
  // existe se omite. buyer_stats.stats_12m.ultimaCompra YA existe.
  const buyerStatsIdx = new Map();
  try {
    const bsSnap = await fbDb.collection('client_buyer_stats').get();
    bsSnap.forEach((d) => {
      buyerStatsIdx.set(d.id, d.data() || {});
    });
  } catch (_e) {
    console.warn(
      '[masterfile] client_buyer_stats no cargado (rule denied o red):',
      _e && _e.message
    );
  }
  // Helpers del pure fn (fallback inline si bundle no cargó).
  const _fcLabels =
    (window.__phase0 && window.__phase0.pure && window.__phase0.pure.fichaClienteLabels) || null;
  const _clasifRow = (cmd) =>
    _fcLabels && _fcLabels.fichaClienteClasifRow
      ? _fcLabels.fichaClienteClasifRow(cmd)
      : {
          'Tipo de cliente': '-',
          Fidelidad: '-',
          'Preferencia de contacto': '-',
          Tamaño: '-',
          Especialización: '-',
          'Tipo de local': '-',
          'Crédito cheque (ARS)': cmd && cmd.creditoCheque ? Number(cmd.creditoCheque) : '-',
        };
  const _buyerRow = (bs) =>
    _fcLabels && _fcLabels.fichaClienteBuyerRow
      ? _fcLabels.fichaClienteBuyerRow(bs, '12m')
      : {
          'Monto total (12m)': '-',
          'Facturas (12m)': '-',
          'Promedio por factura (12m)': '-',
          'Frecuencia (días entre compras)': '-',
          'Facturas por mes (12m)': '-',
          'Primera compra': '-',
          'Última compra': '-',
          'Días desde última compra': '-',
        };
  const _fillDash = (row) =>
    _fcLabels && _fcLabels.fillDashInEmpty ? _fcLabels.fillDashInEmpty(row) : row;
  // v1485 §84 (2026-10-27 BUG FIX): búsqueda por cardCode (fuente autoritativa).
  // v1482 usaba `clientMasterCache.get(clientLocId(prov, loc, name))` — slug
  // derivado de POINTS. Para MAXERA, POINTS dice "Palermo (C14)" pero la Ficha
  // persiste con "COLEGIALES" → docId mismatch → cmData undefined → 5 campos
  // Ficha salían "-" aunque cargados. findCmDataByCardCode escanea por
  // sapCardCode OR cardCodeSap (ambos aliases) y retorna el doc correcto.
  const _findByCard =
    _fcLabels && _fcLabels.findCmDataByCardCode
      ? _fcLabels.findCmDataByCardCode
      : (cardCode, cache) => {
          if (!cardCode || !cache || typeof cache.forEach !== 'function') return null;
          let found = null;
          cache.forEach((d) => {
            if (found || !d) return;
            const cc1 = String(d.sapCardCode || '').trim();
            const cc2 = String(d.cardCodeSap || '').trim();
            if (cc1 === cardCode || cc2 === cardCode) found = d;
          });
          return found;
        };
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
    PACHI: 'SANTIAGO ESTEBAN',
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
      // v1482 §82: Buyer stats indexado por cardCode SAP.
      const _buyerStats = cardCode ? buyerStatsIdx.get(cardCode) || null : null;
      // v1485 §84 BUG FIX: buscar cmData autoritativo por cardCode. El
      // clientMasterCache.get(docId) de arriba usa slug clientLocId que puede
      // apuntar al doc EQUIVOCADO (ver comment arriba). _findByCard scan por
      // sapCardCode garantiza encontrar el doc con los campos Ficha.
      const _cmDataForFicha = _findByCard(cardCode, clientMasterCache) || cmData;
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
          // v1482 §82: ORDEN importa. Legacy visitas PRIMERO (fallback),
          // luego Ficha Cliente PISA con labels de la fuente autoritativa
          // (ej. "Fidelidad" Ficha pisa la mergeada de visitas que puede
          // estar desactualizada). Buyer stats al final (ventana 12m).
          _classifRow(province, localityMap, name),
          _clasifRow(_cmDataForFicha),
          _buyerRow(_buyerStats)
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
  rows.forEach((r) => {
    seen.add(
      (r.Provincia || '').toString().toUpperCase() + '|' + (r['Nombre tienda'] || '').toLowerCase()
    );
  });
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
      // v1482 §82: para altas, buyer stats keyed por cardCodeSap (si existe).
      const _altaBuyerStats = a.cardCodeSap ? buyerStatsIdx.get(a.cardCodeSap) || null : null;
      // v1485 §84 BUG FIX: para altas con cardCode, el doc autoritativo con
      // campos Ficha vive en client_master (lo escribe saveClientCategoriaFromModal
      // via Ficha). _findByCard retorna ese doc. Fallback al propio alta `a`
      // si el cliente no está en client_master (ej. provisorio sin cardCode).
      const _altaCmData = a.cardCodeSap ? _findByCard(a.cardCodeSap, clientMasterCache) || a : a;
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
          // v1482 §82: mismo orden que POINTS — legacy visitas primero,
          // Ficha pisa, Buyer al final.
          _classifRow(prov, loc, nombre),
          _clasifRow(_altaCmData),
          _buyerRow(_altaBuyerStats)
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

  // v1090 (2026-09-29): refactor a downloadXlsx helper (estilo verde + centered
  // uniforme). Antes usaba XLSX.writeFile directo con SheetJS free que ignora
  // estilos. Ahora heredado del helper — misma UI que Ventas/Visitas/etc.
  // v1043 (2026-09-23): post-proceso — sacar columnas 100% vacías.
  // Reporte Mariano: masterfile exportaba 37 columnas donde muchas venían
  // vacías porque no había visitas/contactos cargados para esos clientes.
  // Fix: identificar keys donde TODAS las filas tienen valor "vacío" (empty
  // string, null, undefined) y removerlas antes del sheet. Los conteos
  // (Total visitas/contactos) se consideran vacíos si todos son 0.
  // Widths por column-name (en vez de posicional) para que el filter no
  // desalinee el sheet cuando removemos columnas.
  const COL_WIDTHS = {
    'CardCode SAP': 16,
    'Nombre tienda': 38,
    'Alias (modal)': 28,
    Tipo: 14,
    Estado: 14,
    Provincia: 22,
    'Localidad (mapa)': 22,
    Departamento: 22,
    'Vendedor externo (VDE)': 28,
    Zona: 8,
    'Etiqueta zona': 48,
    'Asesor interno (VDI)': 28,
    Direccion: 38,
    'Localidad declarada': 24,
    'Lat (geocode)': 14,
    'Lng (geocode)': 14,
    // v1482 §82: columnas de la Ficha Cliente (pestaña Clasificación) +
    // Buyer (pestaña Buyer, ventana 12m). Orden exacto que llega desde
    // _clasifRow (Object.assign preserva orden de keys).
    'Tipo de cliente': 36,
    Fidelidad: 10,
    'Preferencia de contacto': 20,
    Tamaño: 10,
    Especialización: 20,
    'Tipo de local': 14,
    'Crédito cheque (ARS)': 18,
    'Monto total (12m)': 16,
    'Facturas (12m)': 12,
    'Promedio por factura (12m)': 20,
    'Frecuencia (días entre compras)': 20,
    'Facturas por mes (12m)': 16,
    'Primera compra': 14,
    'Última compra': 14,
    'Días desde última compra': 18,
    'Ultima interaccion': 14,
    'Tipo ultima interaccion': 14,
    'Total visitas': 10,
    'Total contactos': 10,
    'Tipo comercio': 18,
    Local: 16,
    'Canal de compra': 20,
    Relevancia: 10,
    POP: 8,
    'Necesidad puntual': 26,
    'Tipo de venta': 16,
    'Ponderacion mostrador (%)': 18,
    'Ponderacion e-commerce (%)': 18,
    Competencia: 26,
    Oportunidad: 26,
    'Mas vendido': 22,
    'Mas preguntan': 22,
    'Ayuda tienda': 26,
  };
  // Detectar keys 100% vacías.
  const allKeys = Object.keys(COL_WIDTHS);
  const NUMERIC_ZERO_OK = new Set(['Total visitas', 'Total contactos']);
  // v1482 §82 + v1485 §84 mejora: columnas Ficha + estructurales (CardCode,
  // Zona, Vendedor, Dirección, etc.) NUNCA se omiten. Mariano pidió:
  // "no ocultar columnas por rol; PACHI recibe las mismas columnas que
  // admin, solo sus clientes". El export VDE/PACHI respeta este contrato
  // porque las structurales están protegidas aunque el scope reducido no
  // tenga datos para alguna de ellas.
  const STRUCTURAL_PROTECTED = new Set([
    'CardCode SAP',
    'Nombre tienda',
    'Alias (modal)',
    'Tipo',
    'Estado',
    'Provincia',
    'Localidad (mapa)',
    'Departamento',
    'Vendedor externo (VDE)',
    'Zona',
    'Etiqueta zona',
    'Asesor interno (VDI)',
    'Direccion',
    'Localidad declarada',
    'Lat (geocode)',
    'Lng (geocode)',
  ]);
  const FICHA_PROTECTED = new Set([
    'Tipo de cliente',
    'Fidelidad',
    'Preferencia de contacto',
    'Tamaño',
    'Especialización',
    'Tipo de local',
    'Crédito cheque (ARS)',
    'Monto total (12m)',
    'Facturas (12m)',
    'Promedio por factura (12m)',
    'Frecuencia (días entre compras)',
    'Facturas por mes (12m)',
    'Primera compra',
    'Última compra',
    'Días desde última compra',
  ]);
  const emptyKeys = new Set(
    allKeys.filter((k) => {
      if (STRUCTURAL_PROTECTED.has(k)) return false;
      if (FICHA_PROTECTED.has(k)) return false;
      return rows.every((r) => {
        const v = r[k];
        if (v === '' || v === null || v === undefined) return true;
        if (NUMERIC_ZERO_OK.has(k) && v === 0) return true;
        return false;
      });
    })
  );
  const keptKeys = allKeys.filter((k) => !emptyKeys.has(k));
  // v1482 §82: regla "ninguna celda vacía" — fillDashInEmpty sobre TODAS
  // las columnas finales (clasif + buyer + legacy visitas).
  const rowsFiltered = rows.map((r) => {
    const out = {};
    keptKeys.forEach((k) => {
      out[k] = r[k];
    });
    return _fillDash(out);
  });
  const removedCount = emptyKeys.size;
  if (removedCount > 0) {
    console.log(`[masterfile] removidas ${removedCount} cols vacías:`, [...emptyKeys].join(', '));
  }
  // Hoja resumen por zona
  // v1482 §82: agregar conteo por Tipo de cliente + Fidelidad (dos nuevas
  // columnas con detalle por zona). Formato breve "A: N, B: M, -: K" para
  // caber en una sola celda legible.
  const byZone = {};
  rows.forEach((r) => {
    const z = r['Etiqueta zona'] || 'Sin zona';
    if (!byZone[z]) {
      byZone[z] = {
        total: 0,
        habilitados: 0,
        cancelados: 0,
        tipos: {},
        fidelidades: {},
      };
    }
    byZone[z].total++;
    if (r.Estado === 'Habilitado') byZone[z].habilitados++;
    else if (r.Estado === 'Cancelado') byZone[z].cancelados++;
    // Tipo de cliente: tomar primer char del label ("A - ...", "B - ...",
    // "P (Premium)...", "C - ..."). Si label es "-" → "-".
    const tipoLbl = r['Tipo de cliente'] || '-';
    const tipoKey = tipoLbl === '-' ? '-' : String(tipoLbl).trim().charAt(0).toUpperCase();
    byZone[z].tipos[tipoKey] = (byZone[z].tipos[tipoKey] || 0) + 1;
    const fid = r.Fidelidad || '-';
    byZone[z].fidelidades[fid] = (byZone[z].fidelidades[fid] || 0) + 1;
  });
  function _fmtDist(dist) {
    const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return '-';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  const resumenRows = Object.entries(byZone)
    .map(([z, d]) => ({
      'Zona / Vendedor': z,
      'Total tiendas': d.total,
      Habilitadas: d.habilitados,
      Canceladas: d.cancelados,
      'Por Tipo de cliente': _fmtDist(d.tipos),
      'Por Fidelidad': _fmtDist(d.fidelidades),
    }))
    .sort((a, b) => b['Total tiendas'] - a['Total tiendas']);

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
  await downloadXlsx(fname, [
    { name: 'Clientes habilitados SAP', rows: rowsFiltered },
    { name: 'Resumen por zona', rows: resumenRows },
  ]);
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
window.exportPreciosStock = async function () {
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.');
    return;
  }
  if (!Array.isArray(PRODUCTS) || !PRODUCTS.length) {
    alert('No hay catalogo de productos cargado todavia.');
    return;
  }
  showSyncTag('Generando Excel precios + stock...');
  // v574 (2026-08-21): mostrar UNIDADES numericas exactas del deposito 11.
  // v1363 (2026-10-19): pedido Mariano — cambiar de "stock físico dep 11" a
  // "libre para la venta" (= dep 11 − reservas confirmed/BO/ASIG/waitlist).
  // Razón: enviar al cliente lo que efectivamente se le puede prometer HOY.
  // Si solo mostramos stock físico, puede pasar que haya 5u pero las 5 estén
  // reservadas → el cliente se entera recién al hacer el pedido que no hay.
  // Usa getStockRealmenteDisponible (pure function, filtra TTLs). Retorna '' si
  // no hay snapshot cargado; 0 si no hay libre.
  function fmtStock(sku) {
    const fnReal =
      typeof window !== 'undefined' && typeof window.getStockRealmenteDisponible === 'function'
        ? window.getStockRealmenteDisponible
        : null;
    if (fnReal) {
      try {
        const v = fnReal(sku);
        if (v == null) return '';
        return Number(v) || 0;
      } catch (_e) {
        // fallback a stock físico abajo
      }
    }
    // Fallback: stock físico dep 11 (si getStockRealmenteDisponible no está disponible,
    // ej. bootstrap muy temprano).
    const fnFisico =
      typeof window !== 'undefined' && typeof window.getStockDisponibleVenta === 'function'
        ? window.getStockDisponibleVenta
        : null;
    const vF = fnFisico ? fnFisico(sku) : null;
    if (vF == null) return '';
    return Number(vF) || 0;
  }
  function fmtPrecio(sku) {
    const p = typeof PRICE_LIST_MAP === 'object' && PRICE_LIST_MAP ? PRICE_LIST_MAP[sku] : null;
    if (p == null) return '';
    return Number(p) || 0;
  }
  // v1364 (2026-10-19): rework del export por pedido Mariano:
  // - Hoja principal renombrada "Precios y Stock" -> "Lista de precios".
  // - Nueva columna "Disponibilidad" (DISPONIBLE verde si Stock>0, NO DISPONIBLE
  //   rojo si Stock<=0 o vacio).
  // - Hoja "Info" eliminada.
  // - Nombre archivo: Precios_y_Stock_YYYY-MM-DD.xlsx -> Lista_de_Precios_YYYY-MM-DD.xlsx.
  // Hojas "Precios" y "Stock" se mantienen por si Mariano las usa.
  function dispLabel(stockVal) {
    if (stockVal === '' || stockVal == null) return 'NO DISPONIBLE';
    return Number(stockVal) > 0 ? 'DISPONIBLE' : 'NO DISPONIBLE';
  }
  const rows = PRODUCTS.map((p) => {
    const st = fmtStock(p.code);
    return {
      SKU: p.code || '',
      Descripcion: p.desc || '',
      Familia: p.fam || '',
      Subfamilia: p.sub || '',
      Categoria: p.cat || '',
      'Precio ARS': fmtPrecio(p.code),
      Stock: st,
      Disponibilidad: dispLabel(st),
    };
  }).sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));

  const preciosRows = PRODUCTS.map((p) => ({
    SKU: p.code || '',
    Descripcion: p.desc || '',
    'Precio ARS': fmtPrecio(p.code),
  }))
    .filter((r) => r['Precio ARS'] !== '')
    .sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));

  const stockRows = PRODUCTS.map((p) => {
    const st = fmtStock(p.code);
    return {
      SKU: p.code || '',
      Descripcion: p.desc || '',
      Stock: st,
      Disponibilidad: dispLabel(st),
    };
  }).sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));

  const ts = new Date().toISOString().slice(0, 10);
  await downloadXlsx(
    'Lista_de_Precios_' + ts + '.xlsx',
    [
      { name: 'Lista de precios', rows },
      { name: 'Precios', rows: preciosRows },
      { name: 'Stock', rows: stockRows },
    ],
    {
      // Painter aplicado post-render por downloadXlsx. Pinta la columna
      // "Disponibilidad" segun su valor: verde+blanco si DISPONIBLE,
      // rojo+blanco si NO DISPONIBLE. Centrado + bold para legibilidad.
      cellStyler: (cell, columnName, _value, _rowIndex) => {
        if (columnName !== 'Disponibilidad') return;
        const txt = String(cell.value || '').toUpperCase();
        if (txt === 'DISPONIBLE') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } }; // green-600
          cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        } else if (txt === 'NO DISPONIBLE') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } }; // red-600
          cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        }
      },
    }
  );
  showSyncTag(rows.length + ' SKUs exportados (lista de precios + disponibilidad)');
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
    // v711 (2026-08-28): VENTAS y RUTAS eliminados del UI por pedido de Mariano.
    vendedor: new Set(['VISITAS', 'MASTER', 'BACKORDER', 'STOCK_ASIG', 'PEDIDOS_MES']),
    interno: new Set(['VISITAS', 'MASTER', 'BACKORDER', 'STOCK_ASIG', 'PEDIDOS_MES']),
  };
  const allowed = allowedByRole[userRole] || null; // null = ver todo
  // v1413 §51 + v1414 §51.1 (2026-10-22): INFRACCIONES_MELI whitelist por
  // email. Mantener sincronizado con canReadInfraccionesMeli() de
  // firestore.rules. Readers: Mariano (2 emails) + Diego Valsi.
  const INFRACCIONES_MELI_READERS = [
    'erbinomariano@gmail.com',
    'mariano.erbino@shimano.com.ar',
    'diego.valsi@shimano.uy',
  ];
  const _canReadInfraccionesMeli =
    typeof currentUser !== 'undefined' &&
    currentUser &&
    INFRACCIONES_MELI_READERS.includes((currentUser.email || '').toLowerCase());
  document.querySelectorAll('#export-modal .exp-opt').forEach((el) => {
    const kind = el.dataset.expKind || '';
    let show = !allowed || allowed.has(kind);
    if (kind === 'INFRACCIONES_MELI' && !_canReadInfraccionesMeli) show = false;
    el.style.display = show ? '' : 'none';
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
  BACKORDER: 'Backorder',
  STOCK_ASIG: 'Stock Asignado',
  PEDIDOS_MES: 'Pedidos del mes',
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
    else if (tipo === 'BACKORDER') exportBackorderForMonth(anio, monthIdx);
    else if (tipo === 'STOCK_ASIG') exportStockAsigForMonth(anio, monthIdx);
    else if (tipo === 'PEDIDOS_MES') exportPedidosMesForMonth(anio, monthIdx);
    else if (tipo === 'VENTAS_ART_CLI') exportVentasArtCliForMonth(anio, monthIdx);
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

// v1090 (2026-09-29): reescrito con ExcelJS para dar UI uniforme a TODOS los
// exports (header verde + celdas centered + border sutil + auto-fit width).
// Antes usaba XLSX SheetJS free que ignora silently los estilos de celda. El
// pattern verde replica el TOTAL bar de exportBackordersToExcel (modal
// Backorder v720+). ExcelJS ya se carga on-demand via window.loadExcelJS.
async function downloadXlsx(filename, sheets, opts) {
  try {
    await window.loadExcelJS();
  } catch (e) {
    alert('No se pudo cargar ExcelJS: ' + (e.message || e));
    return;
  }
  const wb = new ExcelJS.Workbook();
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
  const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
  const CENTER = { vertical: 'middle', horizontal: 'center', wrapText: true };
  const BORDER_THIN = { style: 'thin', color: { argb: 'FFCCCCCC' } };
  const BORDER = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };
  // v1364: cellStyler opcional para colorear celdas por valor (ej. columna
  // Disponibilidad DISPONIBLE verde / NO DISPONIBLE rojo en el export
  // Lista de precios). Signature: (cell, columnName, value, rowIndex) => void.
  const cellStyler = opts && typeof opts.cellStyler === 'function' ? opts.cellStyler : null;

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    const rows = s.rows.length ? s.rows : [{ Aviso: 'Sin datos para el periodo seleccionado' }];
    const headers = Object.keys(rows[0]);

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = CENTER;
      cell.border = BORDER;
    });
    headerRow.height = 26;

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      const values = headers.map((h) => (row[h] !== undefined && row[h] !== null ? row[h] : ''));
      const dataRow = ws.addRow(values);
      dataRow.eachCell((cell, colNumber) => {
        cell.alignment = CENTER;
        cell.border = BORDER;
        if (cellStyler) {
          try {
            cellStyler(cell, headers[colNumber - 1], values[colNumber - 1], rIdx);
          } catch (_e) {
            // no-op: no romper el export por un error de styler
          }
        }
      });
    }

    headers.forEach((h, i) => {
      let maxLen = String(h).length;
      for (const row of rows) {
        const v = String(row[h] === undefined || row[h] === null ? '' : row[h]).split('\n')[0];
        if (v.length > maxLen) maxLen = v.length;
      }
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, maxLen + 4));
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    // v711 (2026-08-28): SIEMPRE embeber la foto (no dejar hyperlink).
    // Antes: si fotoTicketUrl (Storage), quedaba como hyperlink Abrir ticket.
    // Ahora: fetch del URL + convertir a arrayBuffer + embeber igual que dataURL.
    // Fallback a hyperlink solo si el fetch falla (CORS, red, etc).
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
      // v711 (2026-08-28): fetch la foto desde Storage y embeberla como imagen.
      try {
        const resp = await fetch(r.fotoTicketUrl);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const contentType = resp.headers.get('content-type') || 'image/jpeg';
        let ext = contentType.split('/')[1] || 'jpeg';
        ext = ext.split(';')[0].trim().toLowerCase();
        if (ext === 'jpg') ext = 'jpeg';
        const buf = await resp.arrayBuffer();
        const imageId = wb.addImage({ buffer: buf, extension: ext });
        ws.addImage(imageId, {
          tl: { col: FOTO_COL_IDX + 0.1, row: row.number - 1 + 0.1 },
          ext: { width: IMG_W, height: IMG_H },
          editAs: 'oneCell',
        });
      } catch (e) {
        // Fallback: si el fetch falla (CORS, red), dejar hyperlink como antes.
        console.warn('fetch foto rendicion fallo, dejo hyperlink', it.id, e);
        try {
          const cell = row.getCell(FOTO_COL_IDX + 1);
          cell.value = {
            text: 'Abrir ticket',
            hyperlink: r.fotoTicketUrl,
            tooltip: 'Abrir la foto del ticket en el browser (fetch fallo)',
          };
          cell.font = { color: { argb: 'FF0563C1' }, underline: true };
        } catch (_e2) {}
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

// =====================================================================
// v709 (2026-08-28): 3 exports nuevos pedidos por Mariano.
// - BACKORDER: lineas state=BO open por mes de createdAt del pedido.
// - STOCK_ASIG: lineas ASIG open (o BO+stock disp) por mes de createdAt.
// - PEDIDOS_MES: TODOS los pedidos creados en el mes/anio (cualquier stage).
// Fuente: globalPedidos (lo que la app ya tiene en memoria).
// Filter mes/año: sobre createdAt del pedido. monthIdx=null -> año entero.
// =====================================================================
function _pedidoMonthYear(p) {
  const ca = p.createdAt;
  if (!ca) return { y: null, m: null };
  let dt = null;
  if (typeof ca === 'string') dt = new Date(ca);
  else if (typeof ca.toDate === 'function') {
    try {
      dt = ca.toDate();
    } catch (_e) {}
  } else if (typeof ca === 'number') dt = new Date(ca);
  if (!dt || Number.isNaN(dt.getTime())) return { y: null, m: null };
  return { y: dt.getFullYear(), m: dt.getMonth() };
}

function _iteratePedidosMes(anio, monthIdx) {
  const arr =
    typeof globalPedidos !== 'undefined' && Array.isArray(globalPedidos) ? globalPedidos : [];
  return arr.filter((p) => {
    if (!p) return false;
    const { y, m } = _pedidoMonthYear(p);
    if (y == null) return false;
    if (y !== anio) return false;
    if (monthIdx !== null && m !== monthIdx) return false;
    return true;
  });
}

async function exportBackorderForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Backorder...');
  // v1100: delega al módulo puro. Filtra por mes vía filters.mesYYYYMM
  // (que el módulo aplica sobre confirmedAt). Coincide con el modal.
  const pedidos = _iteratePedidosMes(anio, monthIdx);
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
  const mesYYYYMM = anio + '-' + String(monthIdx + 1).padStart(2, '0');
  /** @type {(p: any) => string} */
  // v1101 (2026-09-30): buscar primero por sapCardCode (único, no depende de
  // normalización de strings) y sólo caer al clientLocId como último recurso.
  // Ver comentario extendido en index.html:exportBackordersToExcel.
  const _resolveVendorFallback = (p) => {
    try {
      const cache = w.clientMasterCache;
      if (!cache) return '';
      const cc = String(p.clientCardCode || '').trim();
      if (cc && typeof cache.forEach === 'function') {
        let found = '';
        cache.forEach((cmData) => {
          if (found) return;
          if (cmData && String(cmData.sapCardCode || '').trim() === cc && cmData.assignedVendor) {
            found = cmData.assignedVendor;
          }
        });
        if (found) return found;
      }
      if (typeof w.clientLocId === 'function' && typeof cache.get === 'function') {
        const cmDocId = w.clientLocId(p.province || '', p.locName || '', p.clientName || '');
        const cmData = cache.get(cmDocId);
        return (cmData && cmData.assignedVendor) || '';
      }
      return '';
    } catch (_e) {
      return '';
    }
  };
  const rawLines = computeFn
    ? computeFn(
        pedidos,
        'urgente',
        { mesYYYYMM },
        {
          getStockDisponibleVenta:
            typeof w.getStockDisponibleVenta === 'function' ? w.getStockDisponibleVenta : () => 0,
          canonVendor:
            typeof w._canonVendor === 'function'
              ? w._canonVendor
              : (x) =>
                  String(x || '')
                    .trim()
                    .toUpperCase(),
          products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
          resolveVendorFallback: _resolveVendorFallback,
        }
      )
    : [];
  const pedidoById = {};
  for (const p of pedidos) if (p && p._fsId) pedidoById[p._fsId] = p;
  const rows = [];
  rawLines.forEach((rl) => {
    const c = rl.cliente;
    const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
    const qo = c.qtyBackorder || 0;
    let fechaPedido = '';
    if (c.pedidoCreatedAt) {
      const dt = c.pedidoCreatedAt;
      fechaPedido =
        typeof dt === 'string'
          ? dt.slice(0, 10)
          : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
    }
    let cantidadPedida = qo;
    let lineaIdx = -1;
    if (p && Array.isArray(p.lines)) {
      const idx = p.lines.findIndex(
        (l) => l && String(l.code || '').toUpperCase() === rl.sku && l.state === c.state
      );
      if (idx >= 0) {
        cantidadPedida = Number(p.lines[idx].qty) || qo;
        lineaIdx = idx;
      }
    }
    rows.push({
      Fecha_Pedido: fechaPedido,
      Mes: (p && p.month) || '',
      Cliente: c.nombre || '',
      CardCode: c.code || (p && p.clientCardCode) || '',
      Provincia: c.provincia || (p && p.province) || '',
      Localidad: c.ciudad || (p && p.locName) || '',
      Vendedor: c.vendorKey || '',
      SKU: rl.sku || '',
      Producto: rl.producto || '',
      Cantidad_Pedida: cantidadPedida,
      Cantidad_Pendiente_BO: qo,
      Precio_Unit_ARS: c.precio || 0,
      Subtotal_BO_ARS: Math.round(qo * (c.precio || 0)),
      Pedido_ID: c.pedidoId || '',
      Linea_Idx: lineaIdx,
      SQ_DocNum: c.sqDocNum || '',
    });
  });
  rows.sort((a, b) => (a.Cliente || '').localeCompare(b.Cliente || ''));
  const fname = 'Shimano_Backorder_' + periodLabel(anio, monthIdx) + '.xlsx';
  downloadXlsx(fname, [{ name: 'Backorder', rows }]);
  showSyncTag('Export Backorder listo (' + rows.length + ' lineas)', 2400);
}

async function exportStockAsigForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Stock Asignado...');
  // v1100: delega al módulo puro modo asignacion. Coincide con el modal.
  const pedidos = _iteratePedidosMes(anio, monthIdx);
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
  const mesYYYYMM = anio + '-' + String(monthIdx + 1).padStart(2, '0');
  /** @type {(p: any) => string} */
  // v1101 (2026-09-30): buscar primero por sapCardCode (único, no depende de
  // normalización de strings) y sólo caer al clientLocId como último recurso.
  // Ver comentario extendido en index.html:exportBackordersToExcel.
  const _resolveVendorFallback = (p) => {
    try {
      const cache = w.clientMasterCache;
      if (!cache) return '';
      const cc = String(p.clientCardCode || '').trim();
      if (cc && typeof cache.forEach === 'function') {
        let found = '';
        cache.forEach((cmData) => {
          if (found) return;
          if (cmData && String(cmData.sapCardCode || '').trim() === cc && cmData.assignedVendor) {
            found = cmData.assignedVendor;
          }
        });
        if (found) return found;
      }
      if (typeof w.clientLocId === 'function' && typeof cache.get === 'function') {
        const cmDocId = w.clientLocId(p.province || '', p.locName || '', p.clientName || '');
        const cmData = cache.get(cmDocId);
        return (cmData && cmData.assignedVendor) || '';
      }
      return '';
    } catch (_e) {
      return '';
    }
  };
  const rawLines = computeFn
    ? computeFn(
        pedidos,
        'asignacion',
        { mesYYYYMM },
        {
          getStockDisponibleVenta:
            typeof w.getStockDisponibleVenta === 'function' ? w.getStockDisponibleVenta : () => 0,
          canonVendor:
            typeof w._canonVendor === 'function'
              ? w._canonVendor
              : (x) =>
                  String(x || '')
                    .trim()
                    .toUpperCase(),
          products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
          resolveVendorFallback: _resolveVendorFallback,
        }
      )
    : [];
  const pedidoById = {};
  for (const p of pedidos) if (p && p._fsId) pedidoById[p._fsId] = p;
  const rows = [];
  rawLines.forEach((rl) => {
    const c = rl.cliente;
    const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
    const qty = c.qtyAsignada || 0;
    let fechaPedido = '';
    if (c.pedidoCreatedAt) {
      const dt = c.pedidoCreatedAt;
      fechaPedido =
        typeof dt === 'string'
          ? dt.slice(0, 10)
          : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
    }
    let lineaIdx = -1;
    if (p && Array.isArray(p.lines)) {
      const idx = p.lines.findIndex(
        (l) => l && String(l.code || '').toUpperCase() === rl.sku && l.state === c.state
      );
      if (idx >= 0) lineaIdx = idx;
    }
    let estadoReal = 'ASIG';
    if (c.state === 'BO') estadoReal = 'BO_con_stock_(virtual_ASIG)';
    else if (c.state === 'confirmed') estadoReal = 'confirmed (SQ en SAP)';
    rows.push({
      Fecha_Pedido: fechaPedido,
      Mes: (p && p.month) || '',
      Cliente: c.nombre || '',
      CardCode: c.code || (p && p.clientCardCode) || '',
      Provincia: c.provincia || (p && p.province) || '',
      Localidad: c.ciudad || (p && p.locName) || '',
      Vendedor: c.vendorKey || '',
      SKU: rl.sku || '',
      Producto: rl.producto || '',
      Cantidad_Reservada: qty,
      Estado_Real: estadoReal,
      Precio_Unit_ARS: c.precio || 0,
      Subtotal_Reservado_ARS: Math.round(qty * (c.precio || 0)),
      Pedido_ID: c.pedidoId || '',
      Linea_Idx: lineaIdx,
    });
  });
  rows.sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));
  const fname = 'Shimano_StockAsignado_' + periodLabel(anio, monthIdx) + '.xlsx';
  downloadXlsx(fname, [{ name: 'Stock Asignado', rows }]);
  showSyncTag('Export Stock Asignado listo (' + rows.length + ' lineas)', 2400);
}

// v737 (2026-08-30): SNAPSHOT ACTUAL de todos los backorders open (sin filtro
// de mes). Motivo: los 62 pedidos migrados desde SAP el 2026-08-28 tienen
// createdAt de fechas viejas del SAP SQ original, entonces el export por mes
// no los incluia. Version "current status" que itera globalPedidos completo.
window.exportBackorderAll = async function () {
  showSyncTag('Generando export de Backorder (snapshot actual)...');
  // v1488 §86 (2026-10-27 BUG FIX): usar la MISMA pure fn que el modal export
  // (`computeBackorderExportRows`). Antes v1488: panel usaba
  // `computeBackorderRawLines({})` sin `includeExpired` → ocultaba BOs > 90d.
  // Modal usaba `computeBackorderSkuMap(..., {includeExpired:true})` → los
  // incluía. Delta medido en prod: 222 unidades (modal 7696 vs panel 7474).
  // Fix: pure fn única con default `includeExpired=true` (alineado con §40.1
  // y getStockBreakdown.backorderApp.total — la cola completa).
  const arr =
    typeof globalPedidos !== 'undefined' && Array.isArray(globalPedidos) ? globalPedidos : [];
  const totalPedidosOpen = arr.filter((p) => p && !p.closedAt).length;
  /** @type {(p: any) => string} */
  const _resolveVendorFallback = (p) => {
    try {
      if (typeof window === 'undefined') return '';
      const w = /** @type {any} */ (window);
      if (typeof w.clientLocId !== 'function' || !w.clientMasterCache || !w.clientMasterCache.get)
        return '';
      const cmDocId = w.clientLocId(p.province || '', p.locName || '', p.clientName || '');
      const cmData = w.clientMasterCache.get(cmDocId);
      return (cmData && cmData.assignedVendor) || '';
    } catch (_e) {
      return '';
    }
  };
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  // v1488 §86: pure fn única `computeBackorderExportRows` (reemplaza el
  // path histórico `computeBackorderRawLines` que no consolidaba y perdía
  // BOs > 90d). Panel pasa `{}` → trae toda la cola sin filtros manuales.
  const _exportFn =
    w.__phase0 &&
    w.__phase0.pure &&
    w.__phase0.pure.backorderExport &&
    w.__phase0.pure.backorderExport.computeBackorderExportRows;
  const deps = {
    getStockDisponibleVenta:
      typeof w.getStockDisponibleVenta === 'function' ? w.getStockDisponibleVenta : () => 0,
    canonVendor:
      typeof w._canonVendor === 'function'
        ? w._canonVendor
        : (x) =>
            String(x || '')
              .trim()
              .toUpperCase(),
    products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
    resolveVendorFallback: _resolveVendorFallback,
  };
  const _exportResult = _exportFn
    ? _exportFn(arr, {}, deps)
    : { rows: [], totalUnidades: 0, totalFilas: 0, filtrosAplicados: {} };
  const rows = _exportResult.rows;
  if (rows.length === 0) {
    alert(
      'Export Backorder vacio. Diagnostico:\n' +
        '- Total pedidos en globalPedidos: ' +
        arr.length +
        '\n' +
        '- Pedidos abiertos (sin closedAt): ' +
        totalPedidosOpen +
        '\n' +
        '- Lineas post-FIFO+vencidas con qtyBackorder>0: 0\n\n' +
        'Posibles causas:\n' +
        '1. No hay backorder abierto ahora mismo (todo confirmed, cerrado o vencido)\n' +
        '2. Los pedidos tienen closedAt seteado por error\n' +
        '3. Todas las lineas BO tienen stock disponible (fueron promovidas a ASIG virtual)'
    );
    showSyncTag('Export Backorder: 0 lineas (ver alerta)', 3000);
    return;
  }
  rows.sort((a, b) => (a.Cliente || '').localeCompare(b.Cliente || ''));
  // v1366 (2026-10-19): hoja "Resumen" con los MISMOS totales que el modal
  // Backorder (computeBackorderSkuMap post-consolidacion por cliente). Antes
  // el export dumpeaba lineas crudas sin ningun total → Mariano sumaba la
  // columna Subtotal_BO_ARS y el valor podia diverger del modal cuando un
  // cliente tenia varias lineas BO del mismo SKU con precios distintos (el
  // modal consolida usando el precio de la 1ra linea procesada; el export
  // usa el precio de cada linea individual).
  const _computeSkuMapFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderSkuMap;
  const _modalDeps = {
    getStockDisponibleVenta:
      typeof w.getStockDisponibleVenta === 'function' ? w.getStockDisponibleVenta : () => 0,
    canonVendor:
      typeof w._canonVendor === 'function'
        ? w._canonVendor
        : (x) =>
            String(x || '')
              .trim()
              .toUpperCase(),
    products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
    backorderLines: Array.isArray(w.backorderLines) ? w.backorderLines : [],
    sapGetClienteCode: typeof w.sapGetClienteCode === 'function' ? w.sapGetClienteCode : undefined,
    resolveVendorFallback: _resolveVendorFallback,
  };
  const _modalFilters = {
    tiendaQuery: '',
    vendorKey: '',
    mesYYYYMM: '',
    urgencyFilter: '',
    includeExpired: true,
    aggregationMode: 'fifo',
  };
  const _modalResult = _computeSkuMapFn
    ? _computeSkuMapFn(arr, 'urgente', _modalFilters, _modalDeps)
    : { skus: [], totalUnidades: 0, totalClientes: 0 };
  let totalPesosModal = 0;
  const subtotalesPorUrgency = { urgente: 0, parcial: 0 };
  for (const g of _modalResult.skus || []) {
    const urg = g.urgency || 'urgente';
    for (const c of g.clientes || []) {
      const qty = Number(c.qtyBackorder) || 0;
      if (qty <= 0) continue;
      const precio = Number(c.precio) || 0;
      const sub = qty * precio;
      totalPesosModal += sub;
      if (urg === 'parcial') subtotalesPorUrgency.parcial += sub;
      else subtotalesPorUrgency.urgente += sub;
    }
  }
  const totalUnidadesModal = _exportResult.totalUnidades || _modalResult.totalUnidades || 0;
  const totalClientesModal = _modalResult.totalClientes || 0;
  const totalSkusModal = (_modalResult.skus || []).length;
  // v1488 §86: fila de encabezado "Filtros aplicados" para transparencia.
  const _fmtFiltros =
    w.__phase0 &&
    w.__phase0.pure &&
    w.__phase0.pure.backorderExport &&
    w.__phase0.pure.backorderExport.formatBackorderFiltrosHeader;
  const filtrosLbl = _fmtFiltros ? _fmtFiltros(_exportResult.filtrosAplicados) : 'Filtros: ninguno';
  const resumenRows = [
    { Metrica: filtrosLbl, Valor: '' },
    { Metrica: 'TOTAL Backorder ARS', Valor: Math.round(totalPesosModal) },
    { Metrica: 'SKUs con backorder', Valor: totalSkusModal },
    { Metrica: 'Unidades pendientes', Valor: Math.round(totalUnidadesModal) },
    { Metrica: 'Pares cliente+SKU (filas en hoja Backorder)', Valor: rows.length },
    { Metrica: 'Clientes afectados', Valor: totalClientesModal },
    { Metrica: '— Subtotal SIN REPOSICION', Valor: Math.round(subtotalesPorUrgency.urgente) },
    { Metrica: '— Subtotal PARCIAL', Valor: Math.round(subtotalesPorUrgency.parcial) },
    { Metrica: 'Snapshot generado', Valor: new Date().toLocaleString('es-AR') },
  ];
  // v1488 §86: fila TOTAL alineada con el nuevo shape (sin columnas legacy
  // Fecha_Pedido / Mes / Cantidad_Pedida / Pedido_ID / Linea_Idx / etc.).
  // Las nuevas columnas (de computeBackorderExportRows): SKU, Producto,
  // Cliente, CardCode, Provincia, Localidad, Vendedor, Cantidad_Pendiente_BO,
  // Precio_Unit_ARS, Subtotal_BO_ARS, Edad_BO_dias, Estado, Pedidos.
  const totalRow = {
    SKU: '',
    Producto: '',
    Cliente: 'TOTAL',
    CardCode: '',
    Provincia: '',
    Localidad: '',
    Vendedor: '',
    Cantidad_Pendiente_BO: Math.round(totalUnidadesModal),
    Precio_Unit_ARS: '',
    Subtotal_BO_ARS: Math.round(totalPesosModal),
    Edad_BO_dias: '',
    Estado: '',
    Pedidos: '',
  };
  rows.push(totalRow);
  const today = new Date().toISOString().slice(0, 10);
  const fname = 'Shimano_Backorder_Snapshot_' + today + '.xlsx';
  downloadXlsx(
    fname,
    [
      { name: 'Resumen', rows: resumenRows },
      { name: 'Backorder', rows },
    ],
    {
      // Pintar la fila TOTAL de la hoja Backorder + fila 1 (TOTAL) de Resumen.
      cellStyler: (cell, columnName, _value, rowIndex) => {
        // Hoja Resumen: fila TOTAL = rowIndex 0 (primera data row post header).
        // Hoja Backorder: fila TOTAL = ultima row (rowIndex === rows.length - 1).
        // No tenemos acceso al nombre de la hoja en el styler, pero pintamos
        // por celda: si columnName=='Metrica' y es 'TOTAL Backorder ARS...',
        // o si columnName=='Cliente' y el valor incluye 'TOTAL'.
        const txt = String(cell.value || '');
        if (
          (columnName === 'Metrica' && txt.includes('TOTAL Backorder')) ||
          (columnName === 'Cliente' && txt.includes('TOTAL'))
        ) {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF991B1B' } }; // red-800
        }
        // Celdas de la MISMA FILA TOTAL (los numeros)
        if (rowIndex === 0 && columnName === 'Valor') {
          cell.font = { bold: true };
        }
      },
    }
  );
  showSyncTag(
    'Export Backorder listo (' +
      (rows.length - 1) +
      ' lineas + Resumen con total $' +
      Math.round(totalPesosModal).toLocaleString('es-AR') +
      ')',
    3000
  );
};

// v1511 (2026-10-28): handler window.exportRepartoToExcel removido junto con el
// boton "Exportar reporte" del modal Reparto. Reemplazado por el flow editable
// "Exportar Excel" + "Importar Excel" del PR #1273 (v1505).
// Preservado: src/pure/reparto-export-rows.js (shape de rows aun usado por otros exports).

// v737: SNAPSHOT ACTUAL de todo el Stock Asignado (sin filtro de mes). Mismo
// motivo que exportBackorderAll.
window.exportStockAsigAll = async function () {
  showSyncTag('Generando export de Stock Asignado (snapshot actual)...');
  // v1100 (2026-09-30): mismo módulo puro que renderBackordersTab en modo
  // asignacion. Ahora el reporte coincide con el modal: FIFO cap por dispSap,
  // filtro vencidas (ASIG >15d fuera, ASIG sin reserva vigente adentro),
  // confirmed incluido, sin líneas "virtual_ASIG" fantasma.
  const arr =
    typeof globalPedidos !== 'undefined' && Array.isArray(globalPedidos) ? globalPedidos : [];
  const totalPedidosOpen = arr.filter((p) => p && !p.closedAt).length;
  /** @type {(p: any) => string} */
  const _resolveVendorFallback = (p) => {
    try {
      if (typeof window === 'undefined') return '';
      const w = /** @type {any} */ (window);
      if (typeof w.clientLocId !== 'function' || !w.clientMasterCache || !w.clientMasterCache.get)
        return '';
      const cmDocId = w.clientLocId(p.province || '', p.locName || '', p.clientName || '');
      const cmData = w.clientMasterCache.get(cmDocId);
      return (cmData && cmData.assignedVendor) || '';
    } catch (_e) {
      return '';
    }
  };
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  const computeFn = w.__phase0 && w.__phase0.pure && w.__phase0.pure.computeBackorderRawLines;
  const rawLines = computeFn
    ? computeFn(
        arr,
        'asignacion',
        {},
        {
          getStockDisponibleVenta:
            typeof w.getStockDisponibleVenta === 'function' ? w.getStockDisponibleVenta : () => 0,
          canonVendor:
            typeof w._canonVendor === 'function'
              ? w._canonVendor
              : (x) =>
                  String(x || '')
                    .trim()
                    .toUpperCase(),
          products: Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [],
          resolveVendorFallback: _resolveVendorFallback,
        }
      )
    : [];
  const pedidoById = {};
  for (const p of arr) if (p && p._fsId) pedidoById[p._fsId] = p;
  const rows = [];
  rawLines.forEach((rl) => {
    const c = rl.cliente;
    const p = c.pedidoId ? pedidoById[c.pedidoId] : null;
    const qty = c.qtyAsignada || 0;
    let fechaPedido = '';
    if (c.pedidoCreatedAt) {
      const dt = c.pedidoCreatedAt;
      fechaPedido =
        typeof dt === 'string'
          ? dt.slice(0, 10)
          : new Date(dt.toDate ? dt.toDate() : dt).toISOString().slice(0, 10);
    }
    let lineaIdx = -1;
    if (p && Array.isArray(p.lines)) {
      const idx = p.lines.findIndex(
        (l) => l && String(l.code || '').toUpperCase() === rl.sku && l.state === c.state
      );
      if (idx >= 0) lineaIdx = idx;
    }
    // Estado_Real: histórico "BO_con_stock_(virtual_ASIG)" vs "ASIG". v1100:
    // ahora `confirmed` también entra (v962). Preservamos etiqueta legacy
    // por compatibilidad con quien consume el Excel.
    let estadoReal = 'ASIG';
    if (c.state === 'BO') estadoReal = 'BO_con_stock_(virtual_ASIG)';
    else if (c.state === 'confirmed') estadoReal = 'confirmed (SQ en SAP)';
    rows.push({
      Fecha_Pedido: fechaPedido,
      Mes: (p && p.month) || '',
      Cliente: c.nombre || '',
      CardCode: c.code || (p && p.clientCardCode) || '',
      Provincia: c.provincia || (p && p.province) || '',
      Localidad: c.ciudad || (p && p.locName) || '',
      Vendedor: c.vendorKey || '',
      SKU: rl.sku || '',
      Producto: rl.producto || '',
      Cantidad_Reservada: qty,
      Estado_Real: estadoReal,
      Precio_Unit_ARS: c.precio || 0,
      Subtotal_Reservado_ARS: Math.round(qty * (c.precio || 0)),
      Pedido_ID: c.pedidoId || '',
      Linea_Idx: lineaIdx,
      SQ_DocNum: c.sqDocNum || '',
      Origen: (p && p.migrationSource) || 'app',
      // v1100: contexto útil para debugging paridad modal↔reporte.
      Stock_Disp_SKU: rl.dispSap || 0,
    });
  });
  if (rows.length === 0) {
    alert(
      'Export Stock Asignado vacio. Diagnostico:\n' +
        '- Total pedidos en globalPedidos: ' +
        arr.length +
        '\n' +
        '- Pedidos abiertos (sin closedAt): ' +
        totalPedidosOpen +
        '\n' +
        '- Lineas post-FIFO+vencidas con qtyAsignada>0: 0\n\n' +
        'Posibles causas:\n' +
        '1. No hay stock asignado ahora mismo\n' +
        '2. Todos los ASIG estan vencidos (>15d desde asigAt)\n' +
        '3. Los pedidos tienen closedAt seteado'
    );
    showSyncTag('Export Stock Asig: 0 lineas (ver alerta)', 3000);
    return;
  }
  rows.sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));
  const today = new Date().toISOString().slice(0, 10);
  const fname = 'Shimano_StockAsignado_Snapshot_' + today + '.xlsx';
  downloadXlsx(fname, [{ name: 'Stock Asignado', rows }]);
  showSyncTag('Export Stock Asignado listo (' + rows.length + ' lineas)', 2400);
};

// v1396 (2026-10-21): nuevo export "Pendiente de Asignación - Pablo". Lista
// los repartos abiertos (ingresos_reparto pending/in_progress) por SKU +
// clientes en cola. Reemplaza semánticamente al viejo "Stock Asignado" en el
// modal (el viejo pasa a "Stock Asignado - líneas" como auxiliar).
// Dos hojas:
//   Resumen reparto — una fila por doc ingresos_reparto.
//   Clientes en cola — una fila por cliente BO de cada reparto.
window.exportPendienteDeAsignacionPablo = async function () {
  showSyncTag('Generando export Pendiente de Asignación - Pablo...');
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  const fbDb = w.fbDb;
  if (!fbDb) {
    alert('Firestore no inicializado. Reintentá en unos segundos.');
    return;
  }
  // 1. Repartos abiertos.
  let repartosDocs;
  try {
    const snap = await fbDb
      .collection('ingresos_reparto')
      .where('status', 'in', ['pending', 'in_progress'])
      .get();
    repartosDocs = snap.docs;
  } catch (e) {
    alert('Error cargando ingresos_reparto: ' + (e && e.message ? e.message : String(e)));
    return;
  }
  if (!repartosDocs || repartosDocs.length === 0) {
    alert('No hay repartos pending/in_progress ahora mismo.');
    showSyncTag('Export Pablo: 0 repartos', 2400);
    return;
  }
  // 2. Snapshot stock + getStockBreakdown por SKU.
  const stockSnap =
    typeof w.getStockSnapshot === 'function'
      ? w.getStockSnapshot()
      : w._stockSnapshotCache || { warehouseBreakdown: {} };
  const whs =
    typeof stockSnap.warehouseBreakdown === 'string'
      ? JSON.parse(stockSnap.warehouseBreakdown)
      : stockSnap.warehouseBreakdown || {};
  const pedidos = Array.isArray(w.globalPedidos) ? w.globalPedidos : [];
  const waitlistEntries =
    typeof w._getWaitlistCpstEntries === 'function' ? w._getWaitlistCpstEntries() : [];
  const ingresosRepartoActivos = repartosDocs.map((d) =>
    Object.assign({ _fsId: d.id }, d.data() || {})
  );
  const getBreakdown = w.__phase0 && w.__phase0.pure && w.__phase0.pure.getStockBreakdown;
  // 3. Resolver producto por SKU.
  const prodBySku = new Map();
  const PRODUCTS = Array.isArray(w.PRODUCTS) ? w.PRODUCTS : [];
  for (const p of PRODUCTS) {
    if (p && p.sku) prodBySku.set(String(p.sku).toUpperCase(), p);
  }
  const nowMs = Date.now();
  const resumenRows = [];
  const colaRows = [];
  for (const doc of repartosDocs) {
    const data = doc.data() || {};
    const sku = String(data.sku || '').toUpperCase();
    const prod = prodBySku.get(sku) || null;
    const fisicoDep11 = Number((whs[sku] && whs[sku]['11']) || 0);
    const qtyIngresada = Number(data.qtyIngresada || 0);
    const assignments = Array.isArray(data.assignments) ? data.assignments : [];
    let qtyYaAsignada = 0;
    for (const a of assignments) qtyYaAsignada += Number((a && a.qtyAsignada) || 0);
    let qtyARepartir = Math.max(0, qtyIngresada - qtyYaAsignada);
    if (getBreakdown) {
      try {
        const bk = getBreakdown(
          sku,
          {
            getStockFisico: () => fisicoDep11,
            pedidos,
            waitlistEntries,
            ingresosRepartoActivos,
          },
          { now: nowMs }
        );
        if (bk && bk.repartoAbierto && typeof bk.repartoAbierto.qty === 'number') {
          qtyARepartir = bk.repartoAbierto.qty;
        }
      } catch (_e) {
        /* fallback a cálculo local */
      }
    }
    const clientesBO = Array.isArray(data.clientesBO) ? data.clientesBO : [];
    let detectedAt = data.detectedAt || '';
    if (detectedAt && typeof detectedAt.toDate === 'function') {
      try {
        detectedAt = detectedAt.toDate().toISOString();
      } catch (_e) {
        detectedAt = '';
      }
    }
    const boTotalQty = clientesBO.reduce((s, c) => s + Number(c.qtyBackorder || 0), 0);
    resumenRows.push({
      Reparto_ID: doc.id,
      SKU: sku,
      Producto: (prod && (prod.name || prod.description)) || '',
      Fisico_Dep11: fisicoDep11,
      Qty_Ingresada: qtyIngresada,
      Qty_Ya_Asignada: qtyYaAsignada,
      Qty_A_Repartir: qtyARepartir,
      Clientes_En_Cola: clientesBO.length,
      BO_Total_Qty: boTotalQty,
      DetectedAt: typeof detectedAt === 'string' ? detectedAt.slice(0, 19).replace('T', ' ') : '',
      Status: data.status || '',
    });
    for (const c of clientesBO) {
      let fechaPed = c.pedidoCreatedAt || '';
      if (fechaPed && typeof fechaPed.toDate === 'function') {
        try {
          fechaPed = fechaPed.toDate().toISOString();
        } catch (_e) {
          fechaPed = '';
        }
      }
      // Vendedor: buscar en globalPedidos por pedidoId.
      let vendedor = c.vendorKey || '';
      if (!vendedor && c.pedidoId) {
        const p = pedidos.find((x) => x && x._fsId === c.pedidoId);
        if (p) vendedor = p.ownerVendor || p.vendorAssigned || '';
      }
      colaRows.push({
        Reparto_ID: doc.id,
        SKU: sku,
        Cliente: c.clientName || '',
        CardCode: c.clientCardCode || '',
        Provincia: c.clientProvince || '',
        Localidad: c.clientLocality || '',
        Vendedor: vendedor,
        Qty_BO: Number(c.qtyBackorder || 0),
        Fecha_Pedido_Original: typeof fechaPed === 'string' ? fechaPed.slice(0, 10) : '',
        Pedido_ID: c.pedidoId || '',
      });
    }
  }
  resumenRows.sort((a, b) => b.Qty_A_Repartir - a.Qty_A_Repartir);
  colaRows.sort(
    (a, b) =>
      (a.SKU || '').localeCompare(b.SKU || '') ||
      (a.Fecha_Pedido_Original || '').localeCompare(b.Fecha_Pedido_Original || '')
  );
  const today = new Date().toISOString().slice(0, 10);
  const fname = 'Shimano_PendienteDeAsignacion_Pablo_' + today + '.xlsx';
  downloadXlsx(fname, [
    { name: 'Resumen reparto', rows: resumenRows },
    { name: 'Clientes en cola', rows: colaRows },
  ]);
  showSyncTag(
    'Export Pablo: ' + resumenRows.length + ' repartos / ' + colaRows.length + ' clientes en cola',
    2800
  );
};

// v975 (2026-09-17): resuelve nombre de fantasia para un pedido usando el
// mismo pattern que las cards del mapa (index.html:9915-9935):
//   1) clientMeta[cardCode].customFantasia (editado desde el modal cliente)
//   2) approvedAltasList[].fantasia matcheado por comercio == clientName
function _resolveFantasiaForPedido(p) {
  const cardCode = String(p.clientCardCode || '').trim();
  if (cardCode) {
    const meta = /** @type {any} */ (globalThis).clientMeta;
    const custom = meta && meta[cardCode] && meta[cardCode].customFantasia;
    if (custom && String(custom).trim()) return String(custom).trim();
  }
  const altas = /** @type {any} */ (globalThis).approvedAltasList;
  if (Array.isArray(altas)) {
    const nameLower = String(p.clientName || '')
      .trim()
      .toLowerCase();
    if (nameLower) {
      const match = altas.find((a) => {
        if (!a) return false;
        const c = String(a.comercio || '')
          .trim()
          .toLowerCase();
        const f = String(a.fantasia || '')
          .trim()
          .toLowerCase();
        return c === nameLower || f === nameLower;
      });
      if (match && match.fantasia && String(match.fantasia).trim()) {
        return String(match.fantasia).trim();
      }
    }
  }
  return '';
}

// v1233 (2026-10-09): reporte "Ventas x articulo x cliente/vendedor" via CF.
// Admin/gerente only. Tarda ~30-60s (BQ query + exceljs build server-side).
async function exportVentasArtCliForMonth(anio, monthIdx) {
  if (monthIdx === null || monthIdx === undefined) {
    alert('Elegí un MES específico (no "Todo el año") — este reporte es mensual.');
    return;
  }
  // monthIdx viene 0-based desde el picker (ene=0). CF espera 1-based.
  const month = monthIdx + 1;
  const year = anio;
  const periodo = (window.MESES ? window.MESES[monthIdx] : month) + ' ' + year;
  const confirmMsg =
    'Generar reporte "VENTAS x ARTICULO x CLIENTE/VENDEDOR" de ' +
    periodo +
    '?\n\n' +
    'Fuente: SAP via BigQuery (datos exactos).\n' +
    'Puede tardar 30-60 segundos.\n' +
    'Al terminar se descarga automaticamente el xlsx.';
  if (!confirm(confirmMsg)) return;
  showSyncTag('Generando reporte server-side (BQ)... puede tardar ~60s');
  try {
    // v1000 pattern: refresh IDToken antes de callable critico.
    try {
      const u = window.firebase.auth && window.firebase.auth().currentUser;
      if (u && u.getIdToken) await u.getIdToken(true);
    } catch (_e) {}
    const callable = window.firebase
      .app()
      .functions('southamerica-east1')
      .httpsCallable('generateVentasReportCF');
    const resp = await callable({ year, month });
    const r = (resp && resp.data) || {};
    if (!r.ok || !r.bytesBase64) {
      alert('CF devolvio error: ' + (r.error || JSON.stringify(r)));
      return;
    }
    // Decode base64 → Blob → download trigger.
    const bin = atob(r.bytesBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: r.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      r.filename ||
      'ventas_x_articulo_cliente_' + year + '-' + String(month).padStart(2, '0') + '.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    const stats = r.stats || {};
    showSyncTag(
      'OK: ' +
        (stats.ventas || 0) +
        ' ventas / ' +
        (stats.items || 0) +
        ' SKUs / ' +
        (stats.clients || 0) +
        ' clientes'
    );
  } catch (e) {
    console.error('[exportVentasArtCli] error', e);
    alert('Error generando el reporte: ' + (e && e.message ? e.message : String(e)));
  }
}

async function exportPedidosMesForMonth(anio, monthIdx) {
  showSyncTag('Generando export de Pedidos del mes...');
  const rows = [];
  const pedidos = _iteratePedidosMes(anio, monthIdx);
  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    if (!lines.length) continue;
    const fecha = p.createdAt
      ? typeof p.createdAt === 'string'
        ? p.createdAt.slice(0, 10)
        : new Date(p.createdAt.toDate ? p.createdAt.toDate() : p.createdAt)
            .toISOString()
            .slice(0, 10)
      : '';
    // v975 (2026-09-17): resolver fantasia una vez por pedido (no por linea) —
    // el lookup en clientMeta + approvedAltasList es constante para todo el pedido.
    const nombreLocalFantasia = _resolveFantasiaForPedido(p);
    lines.forEach((l, idx) => {
      if (!l) return;
      const qty = Number(l.qty) || 0;
      const precio = Number(l.priceAtCreation || l.precio || 0);
      rows.push({
        Fecha_Pedido: fecha,
        Mes: p.month || '',
        Stage: p.stage || '',
        Cliente: p.clientName || '',
        Nombre_Local_Fantasia: nombreLocalFantasia,
        CardCode: p.clientCardCode || '',
        Provincia: p.province || '',
        Localidad: p.locName || '',
        Vendedor: p.ownerVendor || '',
        SKU: l.code || '',
        Producto: l.desc || l.name || '',
        Cantidad: qty,
        Cantidad_Open: Number(l.qtyOpen) || 0,
        Cantidad_Invoiced: Number(l.qtyInvoiced) || 0,
        Cantidad_Cancelled: Number(l.qtyCancelled) || 0,
        Estado_Linea: l.state || '',
        Precio_Unit_ARS: precio,
        Subtotal_ARS: Math.round(qty * precio),
        Cerrado: p.closedAt ? 'SI' : 'NO',
        Pedido_ID: p._fsId || '',
        Linea_Idx: idx,
        SQ_DocNum: p.transferidoSAP ? p.transferidoSAP.docNum || '' : '',
      });
    });
  }
  rows.sort((a, b) => (a.Fecha_Pedido || '').localeCompare(b.Fecha_Pedido || ''));
  const fname = 'Shimano_PedidosDelMes_' + periodLabel(anio, monthIdx) + '.xlsx';
  downloadXlsx(fname, [{ name: 'Pedidos', rows }]);
  showSyncTag('Export Pedidos del mes listo (' + rows.length + ' lineas)', 2400);
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
    PACHI: 'SANTIAGO ESTEBAN',
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
  rows.forEach((r, i) => {
    r['NRO CTE'] = i + 1;
  });
  // v1090 (2026-09-29): refactor a downloadXlsx (estilo verde uniforme).
  const ts = new Date().toISOString().slice(0, 10);
  await downloadXlsx('TARGETS_VENDEDORES_ZONAS_' + ts + '.xlsx', [
    { name: 'CLIENTES_ZONAS', rows },
  ]);
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

// v1396 (2026-10-21): aviso al click para "Ventas × artículo × cliente".
// Admin/gerente only. Tarda 30-60s. Antes la nota estaba en la descripción del
// listado del modal; ahora el listado solo muestra icono + titulo.
window._ventasArtCliClick = function () {
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  const role = w.userRole || '';
  if (role !== 'admin' && role !== 'gerente') {
    alert('Este reporte es solo para admin / gerente.');
    return;
  }
  const ok = confirm(
    'Reporte server-side (BigQuery). Tarda 30-60 segundos y descarga un .xlsx con 4 hojas:\n' +
      '  • Productos vendidos por VDE\n' +
      '  • Productos NO vendidos por VDE\n' +
      '  • Clientes CON compra por VDE\n' +
      '  • Clientes SIN compra por VDE\n\n' +
      'Continuar?'
  );
  if (!ok) return;
  if (typeof w.closeExportDialog === 'function') w.closeExportDialog();
  if (typeof w.showMonthPicker === 'function') w.showMonthPicker('VENTAS_ART_CLI');
};
