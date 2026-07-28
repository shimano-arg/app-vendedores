// @ts-nocheck
// EXPORTS-ADVANCED: photo ZIPs, audit XLSX, executive summary, visits XLSX,
// PowerBI dataset, ML dataset. Extraído verbatim de index.html (4 fragmentos
// discontinuos separados por Backup + Audit + _exportLegacyFull que quedan
// en el inline) como parte de E2.n.2 (e2b-perf 2026-07-28).
//
// Deps del inline: JSZip (CDN lazy), ExcelJS (CDN lazy via loadExcelJS),
// XLSX (defer en head), visitsCache, campaignsCache, opsLogCache (audit
// inline), auditLogCache (audit inline), contacted (global Set), POINTS,
// PRODUCTS, VENDORS, MESES, vendorLookup, escapeHtml, escapeAttr, titleCase,
// showSyncTag, currentUser, userRole, orders, confirmed, pending.
//
// Cross-scope state: NONE (todos los helpers y consts locales al bloque).
// Sin listeners onSnapshot.
//
// NOTA: los helpers todayStr/dataUrlToBlob/sanitizeForPath viven en este
// módulo — el inline puede llamarlos via free reference al Global Environment
// Record pero preferimos exposición window.* explícita al final.

// =====================================================================
// ============================================================
// SECCIÓN: helpers + photos zip + visits embedded (inline L9256-9445)
// =====================================================================

function todayStr(){ return new Date().toISOString().slice(0,10); }

// Helper: convertir dataURL base64 a Blob para incluir en ZIP
function dataUrlToBlob(dataUrl){
  if (!dataUrl) return null;
  const parts = dataUrl.split(',');
  if (parts.length < 2) return null;
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bytes = atob(parts[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], {type: mime});
}

// Sanear nombres para que sirvan como ruta de archivo
function sanitizeForPath(s){
  return String(s || '').replace(/[\\/*?\[\]:|"<>]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Descargar todas las fotos de visitas en un ZIP organizado por vendedor / tienda / fecha
window.exportPhotosZip = async function(){
  if (typeof JSZip === 'undefined') { alert('Cargando libreria ZIP, intenta de nuevo en 5 segundos.'); return; }
  if (!visitsCache || !visitsCache.length) { alert('No hay visitas registradas.'); return; }
  let photoCount = 0;
  const zip = new JSZip();
  visitsCache.forEach(v => {
    const vendor = sanitizeForPath(titleCase(v.vendor || 'SIN_VENDEDOR'));
    const tienda = sanitizeForPath(v.tienda || 'sin_tienda');
    const fecha = (v.fecha || '').replace(/-/g, '');
    const folderName = vendor + '/' + tienda + '_' + fecha;
    const folder = zip.folder(folderName);
    if (v.frenteLocal) {
      const b = dataUrlToBlob(v.frenteLocal);
      if (b) { folder.file('frente.jpg', b); photoCount++; }
    }
    (v.espacio || []).forEach((b64, i) => {
      const b = dataUrlToBlob(b64);
      if (b) { folder.file('espacio_' + (i + 1) + '.jpg', b); photoCount++; }
    });
  });
  if (!photoCount) { alert('No hay fotos cargadas en las visitas.'); return; }
  showSyncTag('Generando ZIP de ' + photoCount + ' fotos...', 30000);
  try {
    const blob = await zip.generateAsync({type: 'blob', compression: 'DEFLATE'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Shimano_Fotos_Visitas_' + todayStr() + '.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showSyncTag(photoCount + ' fotos descargadas', 3000);
  } catch(e) { console.error('zip', e); alert('Error generando ZIP: ' + (e.message || e)); }
};

// ============================================================
// Excel con fotos del frente embebidas en cada celda (ExcelJS)
// ============================================================
// ExcelJS se carga lazy (solo cuando se toca el boton) para no inflar el bundle.
function loadExcelJS(){
  return new Promise((resolve, reject) => {
    if (typeof ExcelJS !== 'undefined') return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar la libreria ExcelJS. Revisa tu conexion a internet.'));
    document.head.appendChild(s);
  });
}

window.exportVisitsWithEmbeddedPhotos = async function(){
  if (!visitsCache || !visitsCache.length) { alert('No hay visitas registradas.'); return; }
  const n = visitsCache.length;
  if (n > 300) {
    if (!confirm('Hay ' + n + ' visitas. El Excel con todas las fotos embebidas puede pesar 50-150 MB y tardar varios minutos. ¿Continuar?')) return;
  } else if (n > 100) {
    if (!confirm('Vas a generar un Excel con ' + n + ' visitas y sus fotos embebidas. Puede tardar 30-60 segundos. ¿Continuar?')) return;
  }
  showSyncTag('Cargando ExcelJS...', 2000);
  try {
    await loadExcelJS();
  } catch(e) { alert(e.message || e); return; }

  showSyncTag('Generando Excel con ' + n + ' visitas...', 3000);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'App Vendedores Shimano';
  wb.created = new Date();
  const ws = wb.addWorksheet('Visitas', {views: [{state: 'frozen', ySplit: 1}]});

  // Definicion de columnas. La columna de foto va a tener ancho extra para que se vea.
  ws.columns = [
    {header: 'Fecha',         key: 'fecha',     width: 12},
    {header: 'Mes',           key: 'mes',       width: 10},
    {header: 'Vendedor',      key: 'vendedor',  width: 22},
    {header: 'Tipo contacto', key: 'tipoCt',    width: 12},
    {header: 'Comentario',    key: 'coment',    width: 32},
    {header: 'Provincia',     key: 'provincia', width: 16},
    {header: 'Localidad',     key: 'localidad', width: 18},
    {header: 'Tienda',        key: 'tienda',    width: 30},
    {header: 'Tipo',          key: 'tipo',      width: 12},
    {header: 'Local',         key: 'local',     width: 12},
    {header: 'Tamano',        key: 'tamano',    width: 10},
    {header: 'Fidelidad',     key: 'fidelidad', width: 10},
    {header: 'Relevancia',    key: 'relev',     width: 10},
    {header: 'POP',           key: 'pop',       width: 8},
    {header: 'Tipo venta',    key: 'tipoVenta', width: 12},
    {header: 'Competencia',   key: 'compe',     width: 16},
    {header: 'Oportunidad',   key: 'oportu',    width: 30},
    {header: 'Lo mas vendido', key: 'masVe',    width: 28},
    {header: 'GPS dist (m)',  key: 'gpsDist',   width: 12},
    {header: 'Foto frente',   key: 'foto',      width: 22}, // <- la imagen va aca
    {header: 'Email vendedor',key: 'email',     width: 28},
  ];

  // Estilo header
  ws.getRow(1).font = {bold: true, color: {argb: 'FFFFFFFF'}};
  ws.getRow(1).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF0C4A6E'}};
  ws.getRow(1).alignment = {vertical: 'middle', horizontal: 'center'};
  ws.getRow(1).height = 22;

  const FOTO_COL_IDX = ws.getColumn('foto').number - 1; // 0-indexed para addImage
  const ROW_H = 100;
  const IMG_W = 130;
  const IMG_H = 90;

  // Ordenar visitas por fecha desc (mas recientes primero)
  const sorted = visitsCache.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  for (const v of sorted) {
    const tipoContactoLbl = (v.tipoContacto === 'telefono') ? 'Telefono' : 'Presencial';
    const r = ws.addRow({
      fecha:     v.fecha || '',
      mes:       v.mes || '',
      vendedor:  titleCase(v.vendor || ''),
      tipoCt:    tipoContactoLbl,
      coment:    v.comentario || '',
      provincia: titleCase(v.provincia || ''),
      localidad: v.localidad || '',
      tienda:    v.tienda || '',
      tipo:      v.tipo || '',
      local:     v.local || '',
      tamano:    v.tamano || '',
      fidelidad: v.fidelidad || '',
      relev:     v.relevancia || '',
      pop:       v.pop || '',
      tipoVenta: (v.tipoVenta === 'MOSTRADO' ? 'MOSTRADOR' : (v.tipoVenta || '')),
      compe:     v.competencia || '',
      oportu:    v.oportunidad || '',
      masVe:     v.masVendido || '',
      gpsDist:   (typeof v.gpsDistanceM === 'number') ? v.gpsDistanceM : '',
      foto:      '', // la celda queda vacia; encima va la imagen
      email:     v.ownerEmail || '',
    });
    r.height = ROW_H;
    r.alignment = {vertical: 'middle', wrapText: true};
    if (v.frenteLocal && typeof v.frenteLocal === 'string') {
      try {
        // El campo es un dataURL: 'data:image/jpeg;base64,/9j/4AAQ...'
        let b64 = v.frenteLocal;
        let ext = 'jpeg';
        const m = /^data:image\/(\w+);base64,(.+)$/i.exec(b64);
        if (m) { ext = m[1].toLowerCase(); b64 = m[2]; }
        if (ext === 'jpg') ext = 'jpeg';
        const imageId = wb.addImage({base64: b64, extension: ext});
        ws.addImage(imageId, {
          tl: {col: FOTO_COL_IDX + 0.1, row: r.number - 1 + 0.1},
          ext: {width: IMG_W, height: IMG_H},
          editAs: 'oneCell',
        });
      } catch(e) { console.warn('embebiendo foto fila', r.number, e); }
    }
  }

  // Generar y descargar
  try {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Shimano_Visitas_con_fotos_' + todayStr() + '.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showSyncTag('Excel descargado: ' + sorted.length + ' visitas', 3000);
  } catch(e) {
    console.error('exportVisitsWithEmbeddedPhotos', e);
    alert('Error generando el Excel: ' + (e.message || e));
  }
};


// =====================================================================
// ============================================================
// SECCIÓN: exportAuditExcel (inline L10040-10067)
// =====================================================================

window.exportAuditExcel = function(){
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo.');
    return;
  }
  const items = getFilteredAuditEntries();
  if (!items.length) { alert('No hay eventos para exportar con los filtros aplicados.'); return; }
  const rows = items.map(e => {
    const ts = e.timestamp && e.timestamp.toDate ? e.timestamp.toDate() : null;
    return {
      Fecha_Hora: ts ? ts.toISOString().replace('T', ' ').slice(0, 19) : '',
      Usuario_Email: e.userEmail || '',
      Usuario_UID: e.userUid || '',
      Rol: e.userRole || '',
      Accion: AUDIT_ACTION_LABELS[e.action] || e.action || '',
      Accion_Raw: e.action || '',
      Tipo_Entidad: e.entityType || '',
      Entidad: e.entityName || '',
      Detalles_JSON: e.details ? JSON.stringify(e.details) : '',
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:20},{wch:30},{wch:30},{wch:10},{wch:24},{wch:20},{wch:14},{wch:40},{wch:60}];
  XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Shimano_Auditoria_' + stamp + '.xlsx');
};


// =====================================================================
// ============================================================
// SECCIÓN: buildContactadosRows/OpsLog/Visit (inline L10081-10155)
// =====================================================================

// Lista completa de contactados (clientes/prospectos marcados con check)
function buildContactadosRows(){
  const rows = [];
  contacted.forEach(key => {
    const parts = key.split('|');
    const tipo = parts[0], province = parts[1], locName = parts[2], clientName = parts[3];
    const pt = POINTS.find(p => p.province === province && p.name === locName);
    const vendor = pt ? pt.vendor : '';
    const vm = vendorLookup[vendor];
    rows.push({
      Tipo: tipo === 'C' ? 'Cliente actual' : 'Prospecto',
      Cliente: clientName,
      Provincia: titleCase(province),
      Localidad: locName,
      Departamento: pt ? (pt.dept || '') : '',
      Vendedor: titleCase(vendor || ''),
      Zona: vm ? vm.zone : '',
      Contactado: 'Si',
    });
  });
  rows.sort((a, b) => a.Vendedor.localeCompare(b.Vendedor) || a.Provincia.localeCompare(b.Provincia) || a.Cliente.localeCompare(b.Cliente));
  return rows;
}

// Log de operaciones (cancelaciones, eliminaciones, vuelve-a-borrador, etc.)
function buildOpsLogRows(){
  return (opsLogCache || []).map(o => ({
    Fecha: o.timestamp ? (o.timestamp.toDate ? o.timestamp.toDate().toLocaleString() : new Date(o.timestamp).toLocaleString()) : '',
    Usuario: o.userEmail || '',
    Rol: o.userRole || '',
    Accion: o.action || '',
    'Tipo entidad': o.entityType || '',
    Entidad: o.entityName || '',
    Detalles: typeof o.details === 'object' ? JSON.stringify(o.details) : (o.details || ''),
  }));
}

function buildVisitRows(){
  return visitsCache.map(v => ({
    Fecha: v.fecha || '',
    Mes: v.mes || '',
    Ano: v.anio || '',
    Vendedor: titleCase(v.vendor || ''),
    'Tipo contacto': (v.tipoContacto === 'telefono') ? 'Telefono' : 'Presencial',
    Comentario: v.comentario || '',
    Provincia: titleCase(v.provincia || ''),
    Localidad: v.localidad || '',
    Tienda: v.tienda || '',
    'Tipo tienda': v.tipo || '',
    Local: v.local || '',
    Tamano: v.tamano || '',
    Fidelidad: v.fidelidad || '',
    'Relevancia (1-5)': v.relevancia || '',
    POP: v.pop || '',
    'Necesidad puntual': (v.necesidadPuntual === 'MOSTRADO' ? 'MOSTRADOR' : (v.necesidadPuntual || '')),
    'Tipo venta': (v.tipoVenta === 'MOSTRADO' ? 'MOSTRADOR' : (v.tipoVenta || '')),
    '% Mostrador': v.ponderacionMostrado != null ? v.ponderacionMostrado : '',
    '% Ecommerce': v.ponderacionEcommerce != null ? v.ponderacionEcommerce : '',
    Competencia: v.competencia || '',
    'Categoria cliente': v.categoriaCliente || '',
    Oportunidad: v.oportunidad || '',
    'Lo mas vendido Shimano': v.masVendido || '',
    'Lo que mas preguntan': v.masPreguntan || '',
    'Ayuda a tienda': v.ayudaTienda || '',
    'Fotos espacio (cant)': (v.espacio || []).length,
    'Foto frente': v.frenteLocal ? 'Si' : 'No',
    'GPS estado': v.gpsStatus || '',
    'GPS distancia (m)': (typeof v.gpsDistanceM === 'number') ? v.gpsDistanceM : '',
    'GPS lat': v.gpsLat != null ? v.gpsLat : '',
    'GPS lon': v.gpsLon != null ? v.gpsLon : '',
    'GPS precision (m)': v.gpsAccuracy != null ? v.gpsAccuracy : '',
    'GPS capturado': v.gpsCapturedAt || '',
    Email: v.ownerEmail || '',
  }));
}


// =====================================================================
// ============================================================
// SECCIÓN: exportExecutive/Visits/PowerBI/ML (inline L10158-10426)
// =====================================================================

window.exportExecutive = function(){
  const wb = XLSX.utils.book_new();
  const rows = buildPedidoDetailRows();
  const confRows = rows.filter(r => r.estado === 'Confirmado');

  // Consolidado: una fila por vendedor con KPIs
  const perVendor = {};
  confRows.forEach(r => {
    const k = r.vendedor || 'Sin asignar';
    if (!perVendor[k]) perVendor[k] = {zona: r.zona, unid:0, ars:0, usd:0, clientes:new Set(), prods:new Set(), provs:new Set()};
    perVendor[k].unid += r.cantidad;
    perVendor[k].ars += r.subtotal_ars;
    perVendor[k].usd += r.subtotal_usd;
    perVendor[k].clientes.add(r.cliente);
    perVendor[k].prods.add(r.codigo);
    perVendor[k].provs.add(r.provincia);
  });
  const consol = [];
  VENDORS.forEach(v => {
    const titleV = titleCase(v.key);
    const d = perVendor[titleV] || {zona: v.zone, unid:0, ars:0, usd:0, clientes:new Set(), prods:new Set(), provs:new Set()};
    const t = TARGETS_BY_VENDOR[v.key] || {jul2026_usd:0, julDic2026_usd:0, anual2027_usd:0};
    consol.push({
      Zona: v.zone,
      Vendedor: titleV,
      Provincias: d.provs.size,
      'Clientes activos': d.clientes.size,
      'Productos distintos': d.prods.size,
      Unidades: d.unid,
      'Facturado ARS': Math.round(d.ars),
      'Facturado USD': Math.round(d.usd),
      'Target Jul 2026 USD': t.jul2026_usd,
      'Target Jul-Dic 2026 USD': t.julDic2026_usd,
      'Target 2027 USD': t.anual2027_usd,
    });
  });
  const wsC = XLSX.utils.json_to_sheet(consol);
  wsC['!cols'] = [{wch:6},{wch:24},{wch:11},{wch:14},{wch:16},{wch:11},{wch:16},{wch:16},{wch:18},{wch:20},{wch:18}];
  XLSX.utils.book_append_sheet(wb, wsC, 'Consolidado');

  // Una hoja por vendedor con su detalle de pedidos confirmados
  VENDORS.forEach(v => {
    const titleV = titleCase(v.key);
    const vrows = confRows.filter(r => r.vendedor === titleV).map(r => ({
      Fecha: r.fecha, Mes: r.mes_pedido, Provincia: r.provincia, Localidad: r.localidad,
      Cliente: r.cliente, Tipo: r.tipo_cliente,
      Codigo: r.codigo, Producto: r.producto, Categoria: r.categoria, Familia: r.familia, Subfamilia: r.subfamilia,
      Cantidad: r.cantidad, 'Precio ARS': r.precio_unit_ars, 'Subtotal ARS': r.subtotal_ars, 'Subtotal USD': r.subtotal_usd,
    }));
    vrows.sort((a,b) => (a.Fecha||'').localeCompare(b.Fecha||'') || a.Cliente.localeCompare(b.Cliente));
    if (!vrows.length) vrows.push({Fecha:'', Mes:'', Provincia:'', Localidad:'', Cliente:'(sin pedidos confirmados)', Tipo:'', Codigo:'', Producto:'', Categoria:'', Familia:'', Subfamilia:'', Cantidad:0, 'Precio ARS':0, 'Subtotal ARS':0, 'Subtotal USD':0});
    const ws = XLSX.utils.json_to_sheet(vrows);
    ws['!cols'] = [{wch:11},{wch:14},{wch:18},{wch:22},{wch:30},{wch:11},{wch:14},{wch:38},{wch:14},{wch:18},{wch:18},{wch:10},{wch:12},{wch:14},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, (v.zone + ' ' + titleV).substring(0, 31).replace(/[\\/\*\?\[\]:]/g,''));
  });

  // Visitas
  const visitRows = buildVisitRows();
  if (visitRows.length) {
    const wsV = XLSX.utils.json_to_sheet(visitRows);
    XLSX.utils.book_append_sheet(wb, wsV, 'Visitas');
  }
  // Contactados (todos los clientes/prospectos marcados con check)
  const contactRows = buildContactadosRows();
  if (contactRows.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows), 'Contactados');
  }
  // Log de operaciones (cancelaciones, eliminaciones, etc.)
  const opsRows = buildOpsLogRows();
  if (opsRows.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRows), 'Log Operaciones');
  }

  XLSX.writeFile(wb, 'Shimano_Ejecutivo_' + todayStr() + '.xlsx');
};

// ---------- Excel de Visitas (formato standalone) ----------
window.exportVisitsExcel = function(){
  if (typeof XLSX === 'undefined') {
    alert('La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.');
    return;
  }
  const visitRows = buildVisitRows();
  if (!visitRows.length) {
    alert('No hay visitas registradas todavia. Cuando se cargue al menos una, vas a poder exportarla.');
    return;
  }
  const wb = XLSX.utils.book_new();

  // Hoja principal: Visitas (todas las filas)
  const ws = XLSX.utils.json_to_sheet(visitRows);
  ws['!cols'] = [
    {wch:12},{wch:14},{wch:8},{wch:24},{wch:18},{wch:22},{wch:30},{wch:18},
    {wch:14},{wch:14},{wch:14},{wch:16},{wch:8},{wch:22},{wch:14},
    {wch:14},{wch:14},{wch:18},{wch:18},{wch:32},{wch:32},{wch:32},{wch:32},
    {wch:18},{wch:14},{wch:24},
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Visitas');

  // Hoja resumen por vendedor: cantidad de visitas y tiendas unicas
  const perVendor = {};
  visitsCache.forEach(v => {
    const k = titleCase(v.vendor || 'Sin asignar');
    if (!perVendor[k]) perVendor[k] = {visitas: 0, tiendas: new Set(), localidades: new Set(), provincias: new Set()};
    perVendor[k].visitas++;
    if (v.tienda) perVendor[k].tiendas.add(v.tienda);
    if (v.localidad) perVendor[k].localidades.add(v.localidad);
    if (v.provincia) perVendor[k].provincias.add(v.provincia);
  });
  const resumen = Object.entries(perVendor).map(([vendedor, d]) => ({
    Vendedor: vendedor,
    'Visitas totales': d.visitas,
    'Tiendas distintas': d.tiendas.size,
    'Localidades distintas': d.localidades.size,
    'Provincias distintas': d.provincias.size,
  })).sort((a, b) => b['Visitas totales'] - a['Visitas totales']);
  if (resumen.length) {
    const wsR = XLSX.utils.json_to_sheet(resumen);
    wsR['!cols'] = [{wch:24},{wch:16},{wch:18},{wch:22},{wch:22}];
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen por vendedor');
  }

  XLSX.writeFile(wb, 'Shimano_Visitas_' + todayStr() + '.xlsx');
};

// ---------- OPCION B: Power BI (Fact + Dim) ----------
window.exportPowerBI = function(){
  const wb = XLSX.utils.book_new();
  const rows = buildPedidoDetailRows();

  // Fact_Pedidos
  const factRows = rows.filter(r => r.estado !== 'Borrador');
  const wsF = XLSX.utils.json_to_sheet(factRows.map(r => ({
    line_id: r.line_id,
    fecha: r.fecha,
    estado: r.estado,
    vendedor_key: r.vendedor_key,
    zona: r.zona,
    provincia: r.provincia,
    localidad: r.localidad,
    cliente: r.cliente,
    tipo_cliente: r.tipo_cliente,
    sku: r.codigo,
    cantidad: r.cantidad,
    precio_unit_ars: r.precio_unit_ars,
    subtotal_ars: r.subtotal_ars,
    subtotal_usd: r.subtotal_usd,
  })));
  XLSX.utils.book_append_sheet(wb, wsF, 'Fact_Pedidos');

  // Dim_Vendedor
  const dimV = VENDORS.map(v => {
    const t = TARGETS_BY_VENDOR[v.key] || {};
    return {
      vendedor_key: v.key,
      vendedor_nombre: titleCase(v.key),
      zona: v.zone,
      zona_descripcion: v.label,
      color: v.color,
      target_jul2026_usd: t.jul2026_usd || 0,
      target_julDic2026_usd: t.julDic2026_usd || 0,
      target_2027_usd: t.anual2027_usd || 0,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimV), 'Dim_Vendedor');

  // Dim_Producto
  const dimP = PRODUCTS.map(p => ({sku: p.code, descripcion: p.desc, categoria: p.cat, familia: p.fam, subfamilia: p.sub}));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimP), 'Dim_Producto');

  // Dim_Cliente (universo)
  const dimC = [];
  POINTS.forEach(p => {
    const vm = vendorLookup[p.vendor];
    p.clients.forEach(n => dimC.push({cliente: n, tipo: 'Cliente actual', provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || '', vendedor_key: p.vendor || '', zona: vm ? vm.zone : ''}));
    p.prospects.forEach(n => dimC.push({cliente: n, tipo: 'Prospecto', provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || '', vendedor_key: p.vendor || '', zona: vm ? vm.zone : ''}));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimC), 'Dim_Cliente');

  // Dim_Calendario (fechas distintas en los pedidos + serie continua del año actual)
  const calSet = new Set();
  factRows.forEach(r => { if (r.fecha) calSet.add(r.fecha); });
  // Completar desde 2026-01-01 hasta hoy + 365
  const start = new Date('2026-01-01');
  const end = new Date(); end.setDate(end.getDate() + 365);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) calSet.add(d.toISOString().slice(0,10));
  const dimCal = [...calSet].sort().map(dt => {
    const [y,m,da] = dt.split('-').map(x => parseInt(x));
    const dateObj = new Date(y, m-1, da);
    return {fecha: dt, year: y, month: m, day: da, quarter: 'Q' + (Math.floor((m-1)/3)+1), month_name: MESES[m-1], year_month: y + '-' + String(m).padStart(2,'0'), day_of_week: ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'][dateObj.getDay()]};
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimCal), 'Dim_Calendario');

  // Dim_Campania
  const dimCmp = campaignsCache.map(c => ({campania_id: c.id, nombre: c.name, filter_type: c.filterType, filter_values: (c.filterValues||[]).join(', '), target_type: c.targetType, target_amount: c.targetAmount, desde: c.startDate, hasta: c.endDate}));
  if (dimCmp.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimCmp), 'Dim_Campania');

  // Params (tipo de cambio, fecha export, version)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {parametro: 'exchange_rate_ars_usd', valor: EXCHANGE_RATE},
    {parametro: 'fecha_export', valor: todayStr()},
    {parametro: 'total_filas_fact', valor: factRows.length},
  ]), 'Parametros');

  // Fact_Visitas
  const visitRowsB = buildVisitRows();
  if (visitRowsB.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visitRowsB), 'Fact_Visitas');
  // Contactados
  const contactRowsB = buildContactadosRows();
  if (contactRowsB.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRowsB), 'Contactados');
  // Log de operaciones
  const opsRowsB = buildOpsLogRows();
  if (opsRowsB.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRowsB), 'Log_Operaciones');

  XLSX.writeFile(wb, 'Shimano_PowerBI_' + todayStr() + '.xlsx');
};

// ---------- OPCION C: Python / IA / ML (single long-format table) ----------
window.exportML = function(){
  const wb = XLSX.utils.book_new();
  const rows = buildPedidoDetailRows();
  // master_ml: una fila por linea con TODAS las features
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0] || {fecha:''}).map(() => ({wch:14}));
  XLSX.utils.book_append_sheet(wb, ws, 'master_ml');

  // catalogo y universo de clientes como referencias para enriquecer en pandas
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(PRODUCTS.map(p => ({code: p.code, desc: p.desc, cat: p.cat, fam: p.fam, sub: p.sub}))), 'productos_catalogo');

  const universe = [];
  POINTS.forEach(p => {
    const vm = vendorLookup[p.vendor];
    p.clients.forEach(n => universe.push({cliente: n, tipo: 'cliente_actual', provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || '', vendedor: titleCase(p.vendor || ''), zona: vm ? vm.zone : '', lat: p.lat, lon: p.lon}));
    p.prospects.forEach(n => universe.push({cliente: n, tipo: 'prospecto', provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || '', vendedor: titleCase(p.vendor || ''), zona: vm ? vm.zone : '', lat: p.lat, lon: p.lon}));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(universe), 'universo_clientes');

  // targets como tabla long
  const targetsLong = [];
  Object.entries(TARGETS_BY_VENDOR).forEach(([vendor, t]) => {
    targetsLong.push({vendedor: titleCase(vendor), periodo: 'Jul 2026', start_date: '2026-07-01', end_date: '2026-07-31', target_usd: t.jul2026_usd || 0});
    targetsLong.push({vendedor: titleCase(vendor), periodo: 'Jul-Dic 2026', start_date: '2026-07-01', end_date: '2026-12-31', target_usd: t.julDic2026_usd || 0});
    targetsLong.push({vendedor: titleCase(vendor), periodo: '2027', start_date: '2027-01-01', end_date: '2027-12-31', target_usd: t.anual2027_usd || 0});
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targetsLong), 'targets_long');

  // campañas
  if (campaignsCache.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(campaignsCache.map(c => ({id: c.id, nombre: c.name, filter_type: c.filterType, filter_values: (c.filterValues||[]).join(','), target_type: c.targetType, target_amount: c.targetAmount, start_date: c.startDate, end_date: c.endDate}))), 'campanias');
  }

  // parametros
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {parametro: 'exchange_rate_ars_usd', valor: EXCHANGE_RATE},
    {parametro: 'fecha_export', valor: new Date().toISOString()},
  ]), 'parametros');

  // visitas
  const visitRowsC = buildVisitRows();
  if (visitRowsC.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visitRowsC), 'visitas');
  // contactados
  const contactRowsC = buildContactadosRows();
  if (contactRowsC.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRowsC), 'contactados');
  // log de operaciones
  const opsRowsC = buildOpsLogRows();
  if (opsRowsC.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRowsC), 'log_operaciones');

  XLSX.writeFile(wb, 'Shimano_ML_' + todayStr() + '.xlsx');
};


// === Exports a window ===
// Todas las funciones window.foo = function... ya están verbatim.
if (typeof window.todayStr === "undefined") window.todayStr = todayStr;
// E6 hotfix 2: dataUrlToBlob + sanitizeForPath usados por inline runFullBackup (L7278-7288).
if (typeof window.dataUrlToBlob === "undefined") window.dataUrlToBlob = dataUrlToBlob;
if (typeof window.sanitizeForPath === "undefined") window.sanitizeForPath = sanitizeForPath;
// E6 hotfix 3: cross-module bug (audit crossbundle) — exports-core llama loadExcelJS.
window.loadExcelJS = loadExcelJS;
