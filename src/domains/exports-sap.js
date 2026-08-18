// @ts-nocheck
// EXPORTS-SAP: CSVs para SAP Service Layer + DTW + mapeos + zonas Excel.
// Extraído verbatim de index.html (2 fragmentos discontinuos separados por
// Master de Productos / Stock SAP / Precios SAP domain que quedan en inline)
// como parte de E2.n.3 (e2b-perf 2026-07-28). TERCER y ultimo fragmento del
// dominio exports (regla #14: dividido en E2.n.1/n.2/n.3).
//
// Contenido:
// - Helpers: rowsToCsv, fmtDtwDate, addDaysIso, downloadBlob
// - window.exportSapReadyCsv: CSV DTW + Service Layer para pedidos pendientes
// - Panel Mapeo Clientes SAP: allClientNamesFromPoints + renderSapClientes +
//   onSapClientesSearch + saveClienteSAP + bulkImportSapClientes
// - window.exportMapeoClientesCsv
// - Panel Mapeo Productos SAP: renderSapProductos + onSapProductosSearch +
//   saveMaterialSAP + bulkImportSapProductos
// - window.exportMapeoProductosCsv
// - window.exportZonasMapeoExcel: Excel con matriz de zonas por vendedor
//
// Deps del inline (leídas via free reference / Global Environment Record):
// PRODUCTS, POINTS, VENDORS, MESES, currentUser, userRole, escapeHtml,
// escapeAttr, titleCase, sapConfigCache, sapVendorsCache, sapNorm,
// sapGetClienteCode, sapGetMaterialCode, sapGetSlpCodeForVendor (todas
// del SAP Integration domain), getVendorForKey (bundle dashboard),
// vendorLookup, clientMasterCache, approvedAltasList, buildEntregaSuffixForRemarks,
// sapCurrentTab (let inline read-only OK).
//
// Cross-scope state via window (regla #17):
// - window.sapClienteSearch / window.sapProductoSearch: declaradas en
//   sap-admin-panel.js con guard typeof, leidas + escritas aca via window.X.
//   v380 (2026-08-02): fix del ReferenceError de Sentry (var en IIFE del
//   bundle NO va a window; hay que prefixear window. explicit).
// Sin listeners onSnapshot en este dominio (los listeners SAP están en
// SAP Integration domain que queda en inline).

// =====================================================================
// SECCIÓN: CSV helpers + exportSapReadyCsv + panel mapeo clientes/productos + exports mapeo (inline L16515-17170)
// =====================================================================

function rowsToCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}
function fmtDtwDate(iso) {
  // ISO -> YYYYMMDD para DTW
  if (!iso) return '';
  const s = iso.toString().slice(0, 10).replace(/-/g, '');
  return s;
}
function addDaysIso(iso, days) {
  if (!iso) return '';
  try {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  } catch (_e) {
    return iso;
  }
}
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime || 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

window.exportSapReadyCsv = function () {
  const isPend = sapCurrentTab === 'pendientes';
  let allConfirmed = (globalPedidos || []).filter((p) => p.stage === 'confirmed');
  // Vendedor solo exporta sus propios pedidos.
  if (userRole === 'vendedor' && currentUser) {
    allConfirmed = allConfirmed.filter((p) => p.ownerUid === currentUser.uid);
  }
  const target = allConfirmed.filter((p) => {
    const hasSAP = !!(p.transferidoSAP && p.transferidoSAP.transferredAt);
    if (isPend) return !hasSAP && !!sapGetClienteCode(p.clientName);
    return hasSAP;
  });
  if (!target.length) {
    alert(
      isPend
        ? 'No hay pedidos listos para exportar. Asigna el CardCode SAP a las tiendas en "Bloqueados" primero.'
        : 'No hay pedidos transferidos para exportar.'
    );
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);

  if (!isPend) {
    // Tab "Ya transferidos": mantiene el CSV plano "human readable" para analisis (no para reimport)
    const rows = [];
    rows.push([
      'Pedido_ID',
      'Lote_SAP',
      'SAP_DocRange',
      'Cliente_App',
      'Cliente_SAP',
      'Localidad',
      'Provincia',
      'Vendedor_Email',
      'Mes',
      'Year',
      'Condicion_Pago',
      'Fecha_Confirmado',
      'Fecha_Transferido',
      'Linea',
      'SKU_App',
      'SKU_SAP',
      'Descripcion',
      'Categoria',
      'Familia',
      'Subfamilia',
      'Cantidad',
      'Precio_Unit_ARS',
      'Subtotal_ARS',
    ]);
    target.forEach((p) => {
      const cliSap = sapGetClienteCode(p.clientName);
      const ts = p.transferidoSAP || {};
      (p.lines || []).forEach((l, idx) => {
        const matSap = sapGetMaterialCode(l.code);
        const subtotal = (parseFloat(l.qty) || 0) * (parseFloat(l.precio) || 0);
        rows.push([
          p._fsId,
          ts.batchId || '',
          ts.sapDocRange || '',
          p.clientName || '',
          cliSap || '',
          p.locName || '',
          p.province || '',
          p.ownerEmail || '',
          p.month || '',
          p.year || '',
          p.condicionPago || '',
          (p.finalizedAt || p.confirmedAt || '').slice(0, 19).replace('T', ' '),
          (ts.transferredAt || '').slice(0, 19).replace('T', ' '),
          idx + 1,
          l.code || '',
          matSap || '',
          l.desc || '',
          l.cat || '',
          l.fam || '',
          l.sub || '',
          parseFloat(l.qty) || 0,
          parseFloat(l.precio) || 0,
          subtotal,
        ]);
      });
    });
    const csv = rowsToCsv(rows);
    downloadBlob('﻿' + csv, 'SAP_transferidos_' + stamp + '.csv', 'text/csv;charset=utf-8');
    showSyncTag('CSV historico descargado');
    return;
  }

  // === MODO DTW OFICIAL (Pendientes / Listos) ===
  // Genera 2 archivos en formato exacto que espera DTW (2 filas header + datos):
  //   OQUT - Documents.csv         (cabecera Sales Quotation)
  //   QUT1 - Document_Lines.csv    (lineas)
  //
  // NOTA: el equipo comercial decidió que los pedidos de la app entren como
  // Sales Quotation (OQUT) y NO como Sales Order (ORDR). La Quotation NO
  // compromete stock. Cuando Santiago aprueba la Quotation desde SAP, se
  // copia manualmente a Sales Order (recien ahi se reserva stock).
  // Los headers de OQUT/QUT1 son IGUALES a ORDR/RDR1 (SAP los reutiliza)
  // excepto el campo DocObjectCode que cambia de 17 (Order) a 23 (Quotation).

  // BatchId: identificador unico del lote de export. Se asigna a todos los
  // pedidos de este ZIP en su UDF U_AppBatchId, asi en SAP es facil filtrar
  // 'pedidos importados en este lote'. Tambien se guarda en cada pedido al
  // marcarse como transferido (campo transferidoSAP.batchId).
  const now0 = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // v385: crypto.randomUUID() en vez de Math.random() para no gatillar CodeQL
  // "insecure randomness". Uso NO criptográfico: sufijo de disambiguación en
  // el batch id de DTW (BATCH-YYYYMMDD-HHMM-XXXX), evita colisión cuando 2
  // exports arrancan en el mismo minuto.
  const randomSuffix = crypto.randomUUID().slice(0, 4).toUpperCase();
  const dtwBatchId =
    'BATCH-' +
    now0.getFullYear() +
    pad(now0.getMonth() + 1) +
    pad(now0.getDate()) +
    '-' +
    pad(now0.getHours()) +
    pad(now0.getMinutes()) +
    pad(now0.getSeconds()) +
    '-' +
    randomSuffix;
  // Constante: identifica que el pedido vino de la app de vendedores Shimano.
  // Se persiste en U_AppOrigen para reporting / filtros en SAP.
  const APP_ORIGEN_VALUE = 'SHIMANO_APP_VENDEDORES';
  // Series APP: numero de la serie que creo Eliana. Si admin la cargo en
  // app_config (panel SAP) se usa, sino queda vacio = serie default del usuario
  // que importa en DTW. Cuando se carga, todos los pedidos se enumeran con la
  // serie APP y no con la default.
  const sapAppSeriesId =
    sapConfigCache && sapConfigCache.appSeriesId ? String(sapConfigCache.appSeriesId).trim() : '';

  // 1) Construye filas para Documents
  const docRows = [DTW_DOC_API.slice(), DTW_DOC_INT.slice()];
  const linRows = [DTW_LIN_API.slice(), DTW_LIN_INT.slice()];

  target.forEach((p, pIdx) => {
    const docNum = (pIdx + 1).toString(); // sirve como ParentKey
    const cliSap = sapGetClienteCode(p.clientName);
    const docDateIso = p.finalizedAt || p.confirmedAt || new Date().toISOString();
    const docDate = fmtDtwDate(docDateIso);
    const dueDate = fmtDtwDate(addDaysIso(docDateIso, 30));
    const taxDate = docDate;
    const commentTxt =
      'AppShimano | ' +
      (p.clientName || '') +
      ' | ' +
      (p.month || '') +
      ' | ' +
      (p.ownerEmail || '') +
      buildEntregaSuffixForRemarks(p);

    // Resolver SlpCode del vendedor que armo el pedido (si esta cargado en sap_vendors)
    const pedidoVendor = getVendorForKey(
      p._fsKey ||
        p.ordertype +
          '|' +
          (p.province || '') +
          '|' +
          (p.locName || '') +
          '|' +
          (p.clientName || '')
    );
    const slpCode = sapGetSlpCodeForVendor(pedidoVendor) || '';
    // Mapeo header -> valor (deja vacios los que no llenamos)
    const docMap = {
      DocNum: docNum,
      DocType: 'dDocument_Items',
      HandWritten: 'tNO',
      Printed: 'psNo',
      DocDate: docDate,
      DocDueDate: dueDate,
      TaxDate: taxDate,
      CardCode: cliSap || '',
      DocCurrency: '', // default ARS
      Comments: commentTxt,
      NumAtCard: p._fsId || '', // backup de trazabilidad (legible en lista de pedidos SAP sin abrir UDFs)
      // v343+ (2026-07-28): Descuento del header. El vendedor lo carga en el
      // modal Review (input rv-manual-discount) y se persiste en p.discountPct.
      // Igual que el payload SL, aplica a nivel documento (aparece en OQUT campo
      // Descuento %). Rango 0-100. Antes era hardcoded '0'.
      DiscountPercent: String(Math.max(0, Math.min(100, parseFloat(p.discountPct) || 0))),
      SalesPersonCode: slpCode, // SlpCode del vendedor (cargado via Integracion SAP)
      Series: sapAppSeriesId || '', // serie 'APP' (si admin la cargo en app_config); vacio = serie default del usuario
      // Sales Quotation: DocObjectCode 23 (en lugar de 17 que seria Sales Order).
      // DTW espera el valor numerico ('23'), NO el nombre del enum
      // ('oQuotations'). El enum solo aplica a Service Layer / SDK.
      DocObjectCode: '23',
      // UDFs creados por Eliana sobre la cabecera ORDR (y replicados sobre OQUT
      // a pedido para que apliquen tambien a Sales Quotations) para identificar
      // pedidos de la app:
      U_AppOrigen: APP_ORIGEN_VALUE, // constante: identifica origen 'SHIMANO_APP_VENDEDORES'
      U_AppOrderId: p._fsId || '', // ID unico del pedido en Firestore (28 chars)
      U_AppBatchId: dtwBatchId, // ID del lote de export (todos los pedidos del mismo ZIP comparten esto)
      // Condicion de pago: UDF U_TipoGasto en la cabecera. Valid Values
      // del UDF: CONTADO / CHEQUE / CTA CTE / VTA ESP / CON CHEQ / CONDICION.
      // Si el pedido no tiene condicion seteada (pedidos viejos), default
      // 'CONDICION' = DEFINIR (Santiago la revisa al aprobar).
      U_TipoGasto: p.condicionPago || 'CONDICION',
    };
    const docRow = DTW_DOC_API.map((k) => (docMap[k] != null ? docMap[k] : ''));
    docRows.push(docRow);

    // 2) Lineas del pedido
    (p.lines || []).forEach((l, lIdx) => {
      const matSap = sapGetMaterialCode(l.code) || l.code || '';
      const linMap = {
        ParentKey: docNum,
        LineNum: lIdx.toString(),
        ItemCode: matSap,
        Quantity: (parseFloat(l.qty) || 0).toString(),
        Price: (parseFloat(l.precio) || 0).toString(),
        WarehouseCode: '11', // MERCADERIA (v332)
        DiscountPercent: '0',
        TaxCode: '', // default del BP
      };
      const linRow = DTW_LIN_API.map((k) => (linMap[k] != null ? linMap[k] : ''));
      linRows.push(linRow);
    });
  });

  const docCsv = rowsToCsv(docRows);
  const linCsv = rowsToCsv(linRows);

  // Descarga: si JSZip disponible -> 1 ZIP. Si no -> 2 archivos separados.
  // Nombres OQUT/QUT1 corresponden a Sales Quotation (no Sales Order).
  const nameDoc = 'OQUT - Documents.csv';
  const nameLin = 'QUT1 - Document_Lines.csv';
  // Helper: arma un Excel de control con 3 hojas (Pedidos / Lineas /
  // Por vendedor) para que Mariano pueda validar manualmente que pidio
  // cada vendedor, cada tienda y cuanto cierra el lote. NO va a SAP.
  function buildControlXlsxArray() {
    if (typeof XLSX === 'undefined') return null;
    const wb = XLSX.utils.book_new();
    // --- Hoja 1: Pedidos (1 fila por pedido) ---
    const pedRows = target.map((p, i) => {
      const pedKey =
        p._fsKey ||
        p.tipo + '|' + (p.province || '') + '|' + (p.locName || '') + '|' + (p.clientName || '');
      const pedidoVendor = typeof getVendorForKey === 'function' ? getVendorForKey(pedKey) : '';
      const lines = p.lines || [];
      const subtotalBruto = lines.reduce(
        (s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.precio) || 0),
        0
      );
      const netAmount = p.netAmountArs != null ? p.netAmountArs : subtotalBruto;
      const unidades = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
      return {
        'DocNum lote': i + 1,
        'ID Firestore': p._fsId || '',
        'Fecha confirmado': p.confirmedAt ? String(p.confirmedAt).slice(0, 10) : '',
        'Mes pedido': p.month || '',
        Vendedor:
          typeof titleCase === 'function' ? titleCase(pedidoVendor || '') : pedidoVendor || '',
        Provincia: typeof titleCase === 'function' ? titleCase(p.province || '') : p.province || '',
        Localidad: p.locName || '',
        Cliente: p.clientName || '',
        'CardCode SAP':
          typeof sapGetClienteCode === 'function' ? sapGetClienteCode(p.clientName) || '' : '',
        'Tipo cliente': (p.discountSnapshot && p.discountSnapshot.cliTipo) || '',
        'Forma de pago': p.condicionPago || '',
        '# Lineas': lines.length,
        Unidades: unidades,
        'Subtotal Bruto ARS': Math.round(subtotalBruto),
        'Descuento %': p.discountPct != null ? p.discountPct : 0,
        'Total Neto ARS': Math.round(netAmount),
        'Cargado por': p.createdByEmail || p.ownerEmail || '',
        'En nombre de VDE': p.onBehalfOf ? 'SI' : 'NO',
        'BatchId lote': dtwBatchId,
      };
    });
    if (pedRows.length) {
      const ws1 = XLSX.utils.json_to_sheet(pedRows);
      // Anchos amigables (no exactos, solo aproximacion)
      ws1['!cols'] = [
        { wch: 10 },
        { wch: 24 },
        { wch: 14 },
        { wch: 14 },
        { wch: 22 },
        { wch: 18 },
        { wch: 22 },
        { wch: 30 },
        { wch: 18 },
        { wch: 8 },
        { wch: 14 },
        { wch: 8 },
        { wch: 10 },
        { wch: 18 },
        { wch: 11 },
        { wch: 18 },
        { wch: 30 },
        { wch: 8 },
        { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(wb, ws1, 'Pedidos');
    }
    // --- Hoja 2: Lineas (1 fila por SKU) ---
    const lineasRows = [];
    target.forEach((p, i) => {
      const pedKey =
        p._fsKey ||
        p.tipo + '|' + (p.province || '') + '|' + (p.locName || '') + '|' + (p.clientName || '');
      const pedidoVendor = typeof getVendorForKey === 'function' ? getVendorForKey(pedKey) : '';
      (p.lines || []).forEach((l, li) => {
        const qty = parseFloat(l.qty) || 0;
        const precio = parseFloat(l.precio) || 0;
        lineasRows.push({
          'DocNum lote': i + 1,
          Vendedor:
            typeof titleCase === 'function' ? titleCase(pedidoVendor || '') : pedidoVendor || '',
          Cliente: p.clientName || '',
          Localidad: p.locName || '',
          Provincia:
            typeof titleCase === 'function' ? titleCase(p.province || '') : p.province || '',
          Linea: li + 1,
          'SKU App': l.code || '',
          'SKU SAP':
            typeof sapGetMaterialCode === 'function'
              ? sapGetMaterialCode(l.code) || l.code || ''
              : l.code || '',
          Producto: l.desc || '',
          Categoria: l.cat || '',
          Familia: l.fam || '',
          Subfamilia: l.sub || '',
          Cantidad: qty,
          'Precio Unit ARS': precio,
          'Subtotal ARS': Math.round(qty * precio),
          'Mes pedido': p.month || '',
          'Fecha confirmado': p.confirmedAt ? String(p.confirmedAt).slice(0, 10) : '',
        });
      });
    });
    if (lineasRows.length) {
      const ws2 = XLSX.utils.json_to_sheet(lineasRows);
      ws2['!cols'] = [
        { wch: 10 },
        { wch: 22 },
        { wch: 30 },
        { wch: 22 },
        { wch: 18 },
        { wch: 7 },
        { wch: 14 },
        { wch: 14 },
        { wch: 40 },
        { wch: 18 },
        { wch: 18 },
        { wch: 18 },
        { wch: 10 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, ws2, 'Lineas');
    }
    // --- Hoja 3: Por vendedor (agregado) ---
    const perVendor = {};
    target.forEach((p) => {
      const pedKey =
        p._fsKey ||
        p.tipo + '|' + (p.province || '') + '|' + (p.locName || '') + '|' + (p.clientName || '');
      const v = typeof getVendorForKey === 'function' ? getVendorForKey(pedKey) : '';
      const k =
        typeof titleCase === 'function' ? titleCase(v || 'Sin asignar') : v || 'Sin asignar';
      if (!perVendor[k])
        perVendor[k] = {
          pedidos: 0,
          clientes: new Set(),
          lineas: 0,
          unidades: 0,
          brutoArs: 0,
          netoArs: 0,
        };
      const lines = p.lines || [];
      const subtotal = lines.reduce(
        (s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.precio) || 0),
        0
      );
      const neto = p.netAmountArs != null ? p.netAmountArs : subtotal;
      perVendor[k].pedidos += 1;
      perVendor[k].lineas += lines.length;
      perVendor[k].unidades += lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
      perVendor[k].brutoArs += subtotal;
      perVendor[k].netoArs += neto;
      perVendor[k].clientes.add(p.clientName);
    });
    const vendRows = Object.entries(perVendor)
      .map(([v, d]) => ({
        Vendedor: v,
        '# Pedidos': d.pedidos,
        '# Clientes': d.clientes.size,
        '# Lineas': d.lineas,
        'Unidades totales': d.unidades,
        'Subtotal Bruto ARS': Math.round(d.brutoArs),
        'Total Neto ARS': Math.round(d.netoArs),
      }))
      .sort((a, b) => b['Total Neto ARS'] - a['Total Neto ARS']);
    if (vendRows.length) {
      const ws3 = XLSX.utils.json_to_sheet(vendRows);
      ws3['!cols'] = [
        { wch: 24 },
        { wch: 11 },
        { wch: 11 },
        { wch: 11 },
        { wch: 14 },
        { wch: 18 },
        { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(wb, ws3, 'Por vendedor');
    }
    if (!wb.SheetNames.length) return null;
    try {
      return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    } catch (e) {
      console.warn('buildControlXlsxArray write error', e);
      return null;
    }
  }
  const controlXlsxArr = buildControlXlsxArray();
  const nameXlsx = 'CONTROL_pedidos.xlsx';

  if (typeof JSZip !== 'undefined') {
    const zip = new JSZip();
    zip.file(nameDoc, docCsv);
    zip.file(nameLin, linCsv);
    if (controlXlsxArr) zip.file(nameXlsx, controlXlsxArr);
    // README chico
    const readme = [
      'SAP DTW Import Files - Generado por App Vendedores Shimano',
      'Fecha de export: ' + new Date().toLocaleString('es-AR'),
      'Pedidos: ' + target.length,
      'Tipo de documento: SALES QUOTATION (OQUT) - NO compromete stock.',
      '',
      'CONTENIDO DEL ZIP:',
      '  - OQUT - Documents.csv      -> cabecera de cada Quotation (para DTW).',
      '  - QUT1 - Document_Lines.csv -> lineas de cada Quotation (para DTW).',
      '  - CONTROL_pedidos.xlsx       -> Excel de control (NO se importa a SAP).',
      '       3 hojas: Pedidos, Lineas, Por vendedor.',
      '       Usalo para validar a mano antes/despues del import: que pidio',
      '       cada vendedor, que compro cada tienda y cuanto suma el lote.',
      '  - LEEME.txt                  -> este archivo.',
      '',
      'COMO USAR:',
      '1. Conectate por VPN.',
      '2. Abri SAP Business One Data Transfer Workbench (DTW).',
      '3. Logueate (ambiente TEST primero!).',
      '4. Import -> Transactional Data -> Add New Data -> Sales > Sales Quotation.',
      '5. En Step 4 (Select Data Source):',
      '   - File Type: csv (Comma delimited)',
      '   - Documents: apunta a "OQUT - Documents.csv"',
      '   - Document_Lines: apunta a "QUT1 - Document_Lines.csv"',
      '6. Mapping autosalta (los headers ya coinciden con SAP).',
      '7. Step 6 (Error Handling): click "Run Simulation" primero.',
      '8. Si OK: Next y Finish para import real.',
      '9. Las Quotations entran en estado "Pending Approval" para revision',
      '   por parte del aprobador designado (Santiago Esteban).',
      '10. Volve a la app y marca el lote como transferido.',
      '',
      'TIPS:',
      '- DocCurrency vacio = moneda local (ARS) del cliente.',
      '- Series: ' +
        (sapAppSeriesId
          ? 'APP (' + sapAppSeriesId + ')'
          : 'vacio = serie default del usuario que importa'),
      '- SalesPersonCode: SlpCode del vendedor de cada pedido (cargado en sap_vendors).',
      '- NumAtCard: ID Firestore del pedido (backup legible sin abrir UDFs).',
      '- U_TipoGasto: condicion de pago elegida por el vendedor (Valid Values del UDF).',
      '',
      'UDFs (creados por Eliana sobre Marketing Documents Title, aplican a OQUT):',
      '- U_AppOrigen = "SHIMANO_APP_VENDEDORES" (constante para filtrar pedidos de la app).',
      '- U_AppOrderId = ID Firestore del pedido (mismo valor que NumAtCard).',
      '- U_AppBatchId = ' + dtwBatchId + ' (todos los pedidos de este ZIP comparten este lote).',
      '- U_TipoGasto = condicion de pago seleccionada por el vendedor.',
    ].join('\r\n');
    zip.file('LEEME.txt', readme);
    zip
      .generateAsync({ type: 'blob' })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'SAP_DTW_pedidos_' + stamp + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showSyncTag('ZIP DTW descargado: ' + target.length + ' pedido(s)');
        // Auditoria: registrar exportacion del ZIP DTW para trazabilidad ante incidentes.
        try {
          logOp('dtw_export', 'pedidos', 'SAP_DTW_pedidos_' + stamp + '.zip', {
            format: 'ZIP',
            stamp: stamp,
            batchId: dtwBatchId,
            appOrigen: APP_ORIGEN_VALUE,
            appSeriesId: sapAppSeriesId || '(no configurada)',
            pedidosCount: target.length,
            pedidoIds: target.slice(0, 100).map((p) => p._fsId),
            totalLineas: target.reduce((acc, p) => acc + (p.lines || []).length, 0),
            tab: sapCurrentTab,
          });
        } catch (e) {
          console.warn('logOp dtw_export', e);
        }
        // Persistir batchId en cada pedido exportado (modo soft: actualizamos el doc
        // con un campo lastExportBatchId. Cuando se marquen como transferidos, ese
        // batchId queda como pista de cual lote SAP recibio el pedido).
        try {
          target.forEach((p) => {
            if (!p._fsId) return;
            fbDb
              .collection('pedidos')
              .doc(p._fsId)
              .set(
                {
                  lastExportBatchId: dtwBatchId,
                  lastExportAt: firebase.firestore.FieldValue.serverTimestamp(),
                  lastExportBy: currentUser.email || '',
                },
                { merge: true }
              )
              .catch((e) => console.warn('persist batchId', p._fsId, e));
          });
        } catch (e) {
          console.warn('persist batchId outer', e);
        }
      })
      .catch((e) => {
        console.error('zip sap', e);
        // fallback: descarga 2 archivos
        downloadBlob('﻿' + docCsv, nameDoc, 'text/csv;charset=utf-8');
        setTimeout(() => downloadBlob('﻿' + linCsv, nameLin, 'text/csv;charset=utf-8'), 300);
        try {
          logOp('dtw_export', 'pedidos', 'SAP_DTW_pedidos_' + stamp + ' (fallback CSV)', {
            format: 'CSV-fallback',
            stamp: stamp,
            pedidosCount: target.length,
            pedidoIds: target.slice(0, 100).map((p) => p._fsId),
            totalLineas: target.reduce((acc, p) => acc + (p.lines || []).length, 0),
            tab: sapCurrentTab,
            zipError: (e && e.message) || String(e),
          });
        } catch (e2) {
          console.warn('logOp dtw_export fallback', e2);
        }
      });
  } else {
    downloadBlob('﻿' + docCsv, nameDoc, 'text/csv;charset=utf-8');
    setTimeout(() => downloadBlob('﻿' + linCsv, nameLin, 'text/csv;charset=utf-8'), 300);
    showSyncTag('CSVs DTW descargados (Documents + Document_Lines)');
    // Auditoria: idem para el caso sin ZIP (JSZip no disponible).
    try {
      logOp('dtw_export', 'pedidos', nameDoc + ' + ' + nameLin, {
        format: 'CSV-2archivos',
        stamp: stamp,
        pedidosCount: target.length,
        pedidoIds: target.slice(0, 100).map((p) => p._fsId),
        totalLineas: target.reduce((acc, p) => acc + (p.lines || []).length, 0),
        tab: sapCurrentTab,
      });
    } catch (e) {
      console.warn('logOp dtw_export csv-2', e);
    }
  }
};

// ----- TAB: Mapeo Clientes -----
function allClientNamesFromPoints() {
  const set = new Set();
  if (typeof POINTS !== 'undefined' && Array.isArray(POINTS)) {
    POINTS.forEach((p) => {
      (p.clients || []).forEach((n) => {
        set.add(n);
      });
      (p.prospects || []).forEach((n) => {
        set.add(n);
      });
    });
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

function renderSapClientes() {
  const names = allClientNamesFromPoints();
  const q = sapNorm(window.sapClienteSearch);
  const filtered = q ? names.filter((n) => sapNorm(n).includes(q)) : names;
  const mapped = names.filter((n) => sapGetClienteCode(n)).length;

  let html = '';
  html +=
    '<div class="sap-info"><b>Mapeo Cliente App &rarr; Codigo SAP.</b> Completa el codigo de cliente que usa SAP (ej. 0010025478) para cada tienda. Si alguna no tiene codigo todavia, dejala vacia. Tip: pega varios desde Excel con "Importar lote" y nosotros parseamos por columnas.</div>';
  html += '<div class="sap-stats">';
  html +=
    '<div class="sap-stat"><div class="n">' +
    names.length +
    '</div><div class="l">Tiendas totales</div></div>';
  html +=
    '<div class="sap-stat ok"><div class="n">' +
    mapped +
    '</div><div class="l">Con codigo SAP</div></div>';
  html +=
    '<div class="sap-stat warn"><div class="n">' +
    (names.length - mapped) +
    '</div><div class="l">Sin codigo</div></div>';
  html += '</div>';
  html += '<div class="sap-row-actions">';
  html +=
    '<input class="sap-search" type="search" id="sap-clientes-search" placeholder="Buscar tienda..." value="' +
    escapeHtml(window.sapClienteSearch) +
    '" oninput="onSapClientesSearch(this.value)"/>';
  html +=
    '<button class="sap-btn secondary" onclick="bulkImportSapClientes()">Importar lote (Excel/CSV)</button>';
  html +=
    '<button class="sap-btn secondary" onclick="exportMapeoClientesCsv()">Exportar mapeo</button>';
  html += '</div>';

  if (!filtered.length) {
    html +=
      '<div style="text-align:center;color:#94a3b8;padding:30px;font-size:12px">Sin resultados.</div>';
  } else {
    html +=
      '<table class="sap-table"><thead><tr><th style="width:55%">Tienda (App)</th><th style="width:35%">Codigo SAP</th><th style="width:10%"></th></tr></thead><tbody>';
    filtered.slice(0, 500).forEach((n) => {
      const cur = sapGetClienteCode(n);
      const cls = cur ? ' has-value' : '';
      const safe = escapeHtml(n);
      html += '<tr><td>' + safe + '</td>';
      html +=
        '<td><input class="sap-input' +
        cls +
        '" id="sap-cli-' +
        sapNorm(n).replace(/[^A-Z0-9]/g, '_') +
        '" value="' +
        escapeHtml(cur) +
        '" placeholder="0010025478" onkeydown="if(event.key===\'Enter\')this.blur()" onblur="saveClienteSAP(' +
        JSON.stringify(n).replace(/"/g, '&quot;') +
        ', this.value, this)"/></td>';
      html +=
        '<td>' +
        (cur ? '<span style="color:#10b981;font-size:14px">&#10003;</span>' : '') +
        '</td></tr>';
    });
    html += '</tbody></table>';
    if (filtered.length > 500)
      html +=
        '<div style="text-align:center;color:#94a3b8;font-size:11px;padding:14px">Mostrando primeros 500 de ' +
        filtered.length +
        '. Usa el buscador para refinar.</div>';
  }

  document.getElementById('sap-body').innerHTML = html;
}

window.onSapClientesSearch = function (v) {
  window.sapClienteSearch = v;
  const oldSel = document.activeElement && document.activeElement.selectionStart;
  renderSapClientes();
  const nf = document.getElementById('sap-clientes-search');
  if (nf) {
    nf.focus();
    if (typeof oldSel === 'number') {
      try {
        nf.setSelectionRange(oldSel, oldSel);
      } catch (_e) {}
    }
  }
};

window.saveClienteSAP = async function (clientName, value, inputEl) {
  if (userRole !== 'admin') {
    alert('Solo admin puede editar el mapeo.');
    return;
  }
  const trimmed = (value || '').trim();
  const cur = sapGetClienteCode(clientName);
  if (trimmed === cur) return; // sin cambios
  const norm = sapNorm(clientName);
  const docId = norm.replace(/[^A-Z0-9]/g, '_').slice(0, 1400) || 'cli_' + Date.now();
  try {
    if (!trimmed) {
      await fbDb.collection('sap_clients').doc(docId).delete();
    } else {
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
    }
    if (inputEl) inputEl.classList.toggle('has-value', !!trimmed);
    showSyncTag(trimmed ? 'Cliente SAP guardado' : 'Cliente SAP borrado');
  } catch (e) {
    console.error('saveClienteSAP', e);
    alert('Error guardando: ' + (e.message || e));
  }
};

window.bulkImportSapClientes = function () {
  if (userRole !== 'admin') return;
  const txt = prompt(
    'Pega aqui dos columnas (Tienda<TAB>Codigo_SAP o Tienda,Codigo_SAP) - una linea por tienda.\nIgnora encabezado si lo incluis.',
    ''
  );
  if (!txt) return;
  const lines = txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let ok = 0,
    skip = 0;
  (async () => {
    for (const line of lines) {
      const parts = line.split(/[\t,;]/).map((s) => s.trim());
      if (parts.length < 2) {
        skip++;
        continue;
      }
      const name = parts[0],
        code = parts[1];
      if (!name || !code) {
        skip++;
        continue;
      }
      const docId = sapNorm(name)
        .replace(/[^A-Z0-9]/g, '_')
        .slice(0, 1400);
      if (!docId) {
        skip++;
        continue;
      }
      try {
        await fbDb
          .collection('sap_clients')
          .doc(docId)
          .set(
            {
              clientName: name,
              sapCode: code,
              updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        ok++;
      } catch (e) {
        console.error('bulk cli', e);
        skip++;
      }
    }
    alert('Importacion completada.\nGuardados: ' + ok + '\nIgnorados: ' + skip);
  })();
};

window.exportMapeoClientesCsv = function () {
  const names = allClientNamesFromPoints();
  const rows = [['Tienda_App', 'Codigo_SAP']];
  names.forEach((n) => rows.push([n, sapGetClienteCode(n) || '']));
  const csv = rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? '' : v.toString();
          if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
            return '"' + s.replace(/"/g, '""') + '"';
          return s;
        })
        .join(',')
    )
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mapeo_clientes_sap_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showSyncTag('Mapeo de clientes exportado');
};

// ----- TAB: Mapeo Productos -----
function renderSapProductos() {
  const list = typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS) ? PRODUCTS : [];
  const q = sapNorm(window.sapProductoSearch);
  const filtered = q
    ? list.filter(
        (p) =>
          sapNorm(p.code).includes(q) ||
          sapNorm(p.desc).includes(q) ||
          sapNorm(p.fam).includes(q) ||
          sapNorm(p.sub).includes(q)
      )
    : list;
  const mapped = list.filter((p) => sapGetMaterialCode(p.code)).length;

  let html = '';
  html +=
    '<div class="sap-info" style="background:#ecfdf5;border-color:#86efac;color:#15803d"><b>&#10003; Verificado contra SAP de David (junio 2026).</b> 660/666 SKUs tienen codigo identico en ambos sistemas. Los codigos numericos con ceros a la izquierda (ej. <code>032737</code>) se envian a SAP como <code>32737</code> automaticamente. Solo cargar mapeo aca si SAP usa un codigo realmente distinto al del master.</div>';
  html += '<div class="sap-stats">';
  html +=
    '<div class="sap-stat"><div class="n">' +
    list.length +
    '</div><div class="l">SKUs totales</div></div>';
  html +=
    '<div class="sap-stat ok"><div class="n">' +
    mapped +
    '</div><div class="l">Con material SAP</div></div>';
  html +=
    '<div class="sap-stat warn"><div class="n">' +
    (list.length - mapped) +
    '</div><div class="l">Sin material</div></div>';
  html += '</div>';
  html += '<div class="sap-row-actions">';
  html +=
    '<input class="sap-search" type="search" id="sap-prods-search" placeholder="Buscar SKU por codigo, descripcion, familia..." value="' +
    escapeHtml(window.sapProductoSearch) +
    '" oninput="onSapProductosSearch(this.value)"/>';
  html +=
    '<button class="sap-btn secondary" onclick="bulkImportSapProductos()">Importar lote (Excel/CSV)</button>';
  html +=
    '<button class="sap-btn secondary" onclick="exportMapeoProductosCsv()">Exportar mapeo</button>';
  html += '</div>';

  if (!filtered.length) {
    html +=
      '<div style="text-align:center;color:#94a3b8;padding:30px;font-size:12px">Sin resultados.</div>';
  } else {
    html +=
      '<table class="sap-table"><thead><tr><th style="width:18%">Codigo App</th><th style="width:42%">Descripcion</th><th style="width:30%">Material SAP</th><th style="width:10%"></th></tr></thead><tbody>';
    filtered.slice(0, 500).forEach((p) => {
      const cur = sapGetMaterialCode(p.code);
      const cls = cur ? ' has-value' : '';
      const codeSafe = escapeHtml(p.code);
      html +=
        '<tr><td><b>' +
        codeSafe +
        '</b><div style="font-size:9px;color:#94a3b8">' +
        escapeHtml(p.fam || '') +
        (p.sub ? ' / ' + escapeHtml(p.sub) : '') +
        '</div></td>';
      html += '<td>' + escapeHtml(p.desc || '') + '</td>';
      html +=
        '<td><input class="sap-input' +
        cls +
        '" value="' +
        escapeHtml(cur) +
        '" placeholder="(igual a codigo App)" onkeydown="if(event.key===\'Enter\')this.blur()" onblur="saveMaterialSAP(' +
        JSON.stringify(p.code).replace(/"/g, '&quot;') +
        ', this.value, this)"/></td>';
      html +=
        '<td>' +
        (cur ? '<span style="color:#10b981;font-size:14px">&#10003;</span>' : '') +
        '</td></tr>';
    });
    html += '</tbody></table>';
    if (filtered.length > 500)
      html +=
        '<div style="text-align:center;color:#94a3b8;font-size:11px;padding:14px">Mostrando primeros 500 de ' +
        filtered.length +
        '. Usa el buscador para refinar.</div>';
  }
  document.getElementById('sap-body').innerHTML = html;
}

window.onSapProductosSearch = function (v) {
  window.sapProductoSearch = v;
  const oldSel = document.activeElement && document.activeElement.selectionStart;
  renderSapProductos();
  const nf = document.getElementById('sap-prods-search');
  if (nf) {
    nf.focus();
    if (typeof oldSel === 'number') {
      try {
        nf.setSelectionRange(oldSel, oldSel);
      } catch (_e) {}
    }
  }
};

window.saveMaterialSAP = async function (productCode, value, inputEl) {
  if (userRole !== 'admin') {
    alert('Solo admin puede editar el mapeo.');
    return;
  }
  const trimmed = (value || '').trim();
  const cur = sapGetMaterialCode(productCode);
  if (trimmed === cur) return;
  const docId = (productCode || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 1400);
  if (!docId) return;
  try {
    if (!trimmed) {
      await fbDb.collection('sap_products').doc(docId).delete();
    } else {
      await fbDb
        .collection('sap_products')
        .doc(docId)
        .set(
          {
            productCode: productCode,
            sapMaterial: trimmed,
            updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }
    if (inputEl) inputEl.classList.toggle('has-value', !!trimmed);
    showSyncTag(trimmed ? 'Material SAP guardado' : 'Material SAP borrado');
  } catch (e) {
    console.error('saveMaterialSAP', e);
    alert('Error guardando: ' + (e.message || e));
  }
};

window.bulkImportSapProductos = function () {
  if (userRole !== 'admin') return;
  const txt = prompt(
    'Pega aqui dos columnas (Codigo_App<TAB>Material_SAP o Codigo_App,Material_SAP) - una linea por SKU.',
    ''
  );
  if (!txt) return;
  const lines = txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let ok = 0,
    skip = 0;
  (async () => {
    for (const line of lines) {
      const parts = line.split(/[\t,;]/).map((s) => s.trim());
      if (parts.length < 2) {
        skip++;
        continue;
      }
      const code = parts[0],
        mat = parts[1];
      if (!code || !mat) {
        skip++;
        continue;
      }
      const docId = code.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 1400);
      try {
        await fbDb
          .collection('sap_products')
          .doc(docId)
          .set(
            {
              productCode: code,
              sapMaterial: mat,
              updatedBy: currentUser ? currentUser.email || currentUser.uid : '',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        ok++;
      } catch (e) {
        console.error('bulk prod', e);
        skip++;
      }
    }
    alert('Importacion completada.\nGuardados: ' + ok + '\nIgnorados: ' + skip);
  })();
};

window.exportMapeoProductosCsv = function () {
  const list = typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS) ? PRODUCTS : [];
  const rows = [
    ['Codigo_App', 'Descripcion', 'Categoria', 'Familia', 'Subfamilia', 'Material_SAP'],
  ];
  list.forEach((p) =>
    rows.push([
      p.code,
      p.desc || '',
      p.cat || '',
      p.fam || '',
      p.sub || '',
      sapGetMaterialCode(p.code) || '',
    ])
  );
  const csv = rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? '' : v.toString();
          if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
            return '"' + s.replace(/"/g, '""') + '"';
          return s;
        })
        .join(',')
    )
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mapeo_productos_sap_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showSyncTag('Mapeo de productos exportado');
};

// =====================================================================
// SECCIÓN: exportZonasMapeoExcel (inline L18074-18229)
// =====================================================================

window.exportZonasMapeoExcel = function () {
  if (typeof XLSX === 'undefined') {
    alert('Falta la libreria XLSX. Recargá la página.');
    return;
  }
  // Estructura intermedia: vendor -> provincia -> localidad -> {tiendas, clients[], prospects[]}.
  const map = new Map();
  function getEntry(vendor, provincia, localidad) {
    if (!map.has(vendor)) map.set(vendor, new Map());
    const provMap = map.get(vendor);
    if (!provMap.has(provincia)) provMap.set(provincia, new Map());
    const locMap = provMap.get(provincia);
    if (!locMap.has(localidad)) locMap.set(localidad, { tiendas: 0, clients: [], prospects: [] });
    return locMap.get(localidad);
  }
  POINTS.forEach((p) => {
    const allClients = p.clients || [];
    const allProspects = p.prospects || [];
    // Para cada tienda: determinar su vendor EFECTIVO (incluyendo overrides
    // si hay alguno aplicado desde el modal Zonas). Si no hay override,
    // usa el vendor del POINT.
    function vendorOf(clientName) {
      if (typeof getEffectiveVendorForClient === 'function') {
        try {
          return getEffectiveVendorForClient(p, clientName) || p.vendor || '(sin vendor)';
        } catch (_e) {
          return p.vendor || '(sin vendor)';
        }
      }
      return p.vendor || '(sin vendor)';
    }
    allClients.forEach((name) => {
      const v = vendorOf(name);
      const e = getEntry(v, p.province || '(sin provincia)', p.name || '(sin localidad)');
      e.tiendas++;
      e.clients.push(name);
    });
    allProspects.forEach((name) => {
      const v = vendorOf(name);
      const e = getEntry(v, p.province || '(sin provincia)', p.name || '(sin localidad)');
      e.tiendas++;
      e.prospects.push(name);
    });
  });
  // Tambien sumamos las SAP altas con cardCodeSap + direccion (las que el
  // mapa muestra como pin azul/verde) - usan assignedVendor del alta.
  if (typeof approvedAltasList !== 'undefined' && approvedAltasList.length) {
    approvedAltasList.forEach((a) => {
      if (!a || !a.cardCodeSap) return;
      const v = a.assignedVendor || '(sin vendor)';
      const prov = (a.provincia || '(sin provincia)').toString();
      const loc = (a.localidadFinal || a.localidad || '(sin localidad)').toString();
      const e = getEntry(v, prov, loc);
      e.tiendas++;
      e.clients.push((a.comercio || a.fantasia || 'SAP ' + a.cardCodeSap) + ' [SAP]');
    });
  }
  // Armar 3 hojas: Por vendor + provincia, Por vendor + localidad, Detalle por tienda.
  const wb = XLSX.utils.book_new();
  // Hoja 1: agregado por vendor + provincia
  const resumenProvRows = [];
  map.forEach((provMap, vendor) => {
    provMap.forEach((locMap, prov) => {
      let totalTiendas = 0;
      const locs = [];
      locMap.forEach((e, loc) => {
        totalTiendas += e.tiendas;
        locs.push(loc);
      });
      const vm = typeof vendorLookup !== 'undefined' && vendorLookup ? vendorLookup[vendor] : null;
      resumenProvRows.push({
        Vendedor: vendor,
        Zona: vm ? vm.zone : '',
        Provincia: titleCase(prov),
        'Localidades (cant)': locs.length,
        'Tiendas (cant)': totalTiendas,
        Localidades: locs.sort().join(', '),
      });
    });
  });
  resumenProvRows.sort(
    (a, b) =>
      (a.Vendedor || '').localeCompare(b.Vendedor) || (a.Provincia || '').localeCompare(b.Provincia)
  );
  const ws1 = XLSX.utils.json_to_sheet(resumenProvRows);
  ws1['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Por vendor + provincia');
  // Hoja 2: por vendor + localidad
  const resumenLocRows = [];
  map.forEach((provMap, vendor) => {
    provMap.forEach((locMap, prov) => {
      locMap.forEach((e, loc) => {
        const vm =
          typeof vendorLookup !== 'undefined' && vendorLookup ? vendorLookup[vendor] : null;
        resumenLocRows.push({
          Vendedor: vendor,
          Zona: vm ? vm.zone : '',
          Provincia: titleCase(prov),
          Localidad: loc,
          'Tiendas (cant)': e.tiendas,
        });
      });
    });
  });
  resumenLocRows.sort(
    (a, b) =>
      (a.Vendedor || '').localeCompare(b.Vendedor) ||
      (a.Provincia || '').localeCompare(b.Provincia) ||
      (a.Localidad || '').localeCompare(b.Localidad)
  );
  const ws2 = XLSX.utils.json_to_sheet(resumenLocRows);
  ws2['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 22 }, { wch: 24 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Por vendor + localidad');
  // Hoja 3: detalle por tienda
  const detalleRows = [];
  map.forEach((provMap, vendor) => {
    provMap.forEach((locMap, prov) => {
      locMap.forEach((e, loc) => {
        const vm =
          typeof vendorLookup !== 'undefined' && vendorLookup ? vendorLookup[vendor] : null;
        e.clients.forEach((name) => {
          detalleRows.push({
            Vendedor: vendor,
            Zona: vm ? vm.zone : '',
            Provincia: titleCase(prov),
            Localidad: loc,
            Tienda: name,
            Tipo: name.endsWith('[SAP]') ? 'SAP alta' : 'Cliente',
          });
        });
        e.prospects.forEach((name) => {
          detalleRows.push({
            Vendedor: vendor,
            Zona: vm ? vm.zone : '',
            Provincia: titleCase(prov),
            Localidad: loc,
            Tienda: name,
            Tipo: 'Prospecto',
          });
        });
      });
    });
  });
  detalleRows.sort(
    (a, b) =>
      (a.Vendedor || '').localeCompare(b.Vendedor) ||
      (a.Provincia || '').localeCompare(b.Provincia) ||
      (a.Localidad || '').localeCompare(b.Localidad) ||
      (a.Tienda || '').localeCompare(b.Tienda)
  );
  const ws3 = XLSX.utils.json_to_sheet(detalleRows);
  ws3['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 22 }, { wch: 24 }, { wch: 35 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Detalle por tienda');
  // Hoja 4: resumen totales por vendor
  const totalesRows = [];
  map.forEach((provMap, vendor) => {
    let totalTiendas = 0;
    const provincias = new Set();
    const localidades = new Set();
    provMap.forEach((locMap, prov) => {
      provincias.add(prov);
      locMap.forEach((e, loc) => {
        totalTiendas += e.tiendas;
        localidades.add(prov + '|' + loc);
      });
    });
    const vm = typeof vendorLookup !== 'undefined' && vendorLookup ? vendorLookup[vendor] : null;
    totalesRows.push({
      Vendedor: vendor,
      Zona: vm ? vm.zone : '',
      'Provincias (cant)': provincias.size,
      'Localidades (cant)': localidades.size,
      'Tiendas (cant)': totalTiendas,
      Provincias: [...provincias]
        .map((p) => titleCase(p))
        .sort()
        .join(', '),
    });
  });
  totalesRows.sort((a, b) => (a.Vendedor || '').localeCompare(b.Vendedor));
  const ws4 = XLSX.utils.json_to_sheet(totalesRows);
  ws4['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'Resumen por vendor');
  // Mover Resumen al primer lugar - readable.
  wb.SheetNames = [
    'Resumen por vendor',
    'Por vendor + provincia',
    'Por vendor + localidad',
    'Detalle por tienda',
  ];
  const fname = 'Shimano_Mapeo_Zonas_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, fname);
  showSyncTag('Mapeo exportado a ' + fname);
};

// === Exports a window para callers cross-scope ===
// - rowsToCsv + downloadBlob: usados desde SAP Integration domain (línea 9100-9101).
// - renderSapClientes + renderSapProductos: usados desde sap tab handler
//   (líneas 15173, 15186, 15216-17 pre-E2.n.3).
window.rowsToCsv = rowsToCsv;
window.downloadBlob = downloadBlob;
window.renderSapClientes = renderSapClientes;
window.renderSapProductos = renderSapProductos;
