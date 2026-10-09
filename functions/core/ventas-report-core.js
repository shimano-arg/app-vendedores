/**
 * ventas-report-core.js — core puro para generar el reporte Excel
 * "VENTAS x ARTICULO x CLIENTE/VENDEDOR" mensual.
 *
 * Replica la logica de scripts/reporte_ventas_x_articulo_cliente.py pero
 * en Node.js para correr dentro de la CF generateVentasReportCF.
 *
 * Deps inyectables para testeo:
 *   - fetchVentas(year, month) → BQ v_ventas_lineas
 *   - fetchItemsMaster() → BQ v_sap_items_enriched
 *   - fetchClientMaster() → Firestore client_master
 *   - fetchVendors() → Firestore sap_vendors
 *   - makeWorkbook() → factory de ExcelJS Workbook
 *
 * Output: Buffer con el xlsx listo para descargar.
 */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const HEADER_FONT = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
const HEADER_ALIGN = { horizontal: 'center', vertical: 'middle', wrapText: true };

function normVendor(/** @type {any} */ name) {
  return String(name || '')
    .trim()
    .toUpperCase();
}

/**
 * Normaliza string de cliente para match: upper + trim + colapsa whitespace.
 * @param {any} s
 */
function normClient(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/** Reemplaza null/undefined/'' por "—" para que ninguna celda quede vacia. */
function nn(/** @type {any} */ v) {
  if (v === null || v === undefined) return '—';
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

/** Para numeros: 0 queda 0 (no null). */
function nnum(/** @type {any} */ v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function styleHeader(/** @type {any} */ ws, /** @type {number} */ ncols) {
  for (let c = 1; c <= ncols; c++) {
    const cell = ws.getRow(1).getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = HEADER_ALIGN;
  }
  ws.getRow(1).height = 28;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: ncols } };
}

function autosizeCols(/** @type {any} */ ws, maxWidth = 50) {
  ws.columns.forEach((/** @type {any} */ col) => {
    let maxLen = 10;
    col.eachCell({ includeEmpty: false }, (/** @type {any} */ cell) => {
      const v = cell.value;
      const s = v == null ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    });
    col.width = Math.min(Math.max(10, maxLen + 2), maxWidth);
  });
}

/**
 * Genera el buffer xlsx a partir de los datasets.
 * @param {{ventas: Array<any>, items: Array<any>, clients: Array<any>, vendors: Array<any>, visits: Array<any>, makeWorkbook: () => any}} params
 * @returns {Promise<any>}
 */
async function buildReportBuffer({ ventas, items, clients, vendors, visits, makeWorkbook }) {
  const vendorKeys = new Set(
    vendors.filter((v) => v.vendorKey).map((v) => normVendor(v.vendorKey))
  );
  const slpToVendor = new Map();
  for (const v of vendors) {
    if (v.slpCode != null) {
      const n = Number(v.slpCode);
      if (Number.isFinite(n)) slpToVendor.set(n, normVendor(v.vendorKey));
    }
  }

  // Indices.
  const ventasByVendorItem = new Set(); // "vendor||itemCode"
  const ventasByVendorClient = new Map(); // "vendor||cardCode" → acc
  const resolvedVentas = []; // ventas enriquecidas con vendor name resuelto

  for (const v of ventas) {
    let vn = null;
    if (v.slp_code != null) {
      const n = Number(v.slp_code);
      if (Number.isFinite(n)) vn = slpToVendor.get(n) || null;
    }
    if (!vn) vn = '(sin vendedor)';
    const itemCode = v.item_code || '';
    const cardCode = v.card_code || '';
    ventasByVendorItem.add(vn + '||' + itemCode);
    const key = vn + '||' + cardCode;
    let acc = ventasByVendorClient.get(key);
    if (!acc) {
      acc = { card_name: v.card_name || '', qty: 0, importe: 0, skus: new Set(), docs: 0 };
      ventasByVendorClient.set(key, acc);
    }
    acc.qty += Number(v.qty || 0);
    acc.importe += Number(v.importe_ars || 0);
    acc.skus.add(itemCode);
    acc.docs += Number(v.docs || 0);
    resolvedVentas.push({
      vendor: vn,
      card_code: cardCode,
      card_name: v.card_name || '',
      item_code: itemCode,
      item_name: v.item_name || '',
      familia: v.familia || '',
      subfamilia: v.subfamilia || '',
      qty: Number(v.qty || 0),
      importe: Number(v.importe_ars || 0),
      docs: Number(v.docs || 0),
    });
  }

  // Clientes por vendor.
  const clientsByVendor = new Map();
  for (const c of clients) {
    const vn = normVendor(c.vendor);
    if (!vn) continue;
    let arr = clientsByVendor.get(vn);
    if (!arr) {
      arr = [];
      clientsByVendor.set(vn, arr);
    }
    arr.push(c);
  }

  const wb = makeWorkbook();

  // === Hoja 1: Vendidos ===
  const ws1 = wb.addWorksheet('1. Vendidos');
  ws1.addRow([
    'VENDEDOR',
    'CARD_CODE',
    'CLIENTE',
    'ITEM_CODE',
    'ITEM',
    'FAMILIA',
    'SUBFAMILIA',
    'UNIDADES',
    'IMPORTE_ARS',
    'DOCUMENTOS',
  ]);
  for (const r of resolvedVentas) {
    ws1.addRow([
      nn(r.vendor),
      nn(r.card_code),
      nn(r.card_name),
      nn(r.item_code),
      nn(r.item_name),
      nn(r.familia),
      nn(r.subfamilia),
      nnum(r.qty),
      nnum(r.importe),
      nnum(r.docs),
    ]);
  }
  styleHeader(ws1, 10);
  autosizeCols(ws1);

  // === Hoja 2: No vendidos ===
  const ws2 = wb.addWorksheet('2. No vendidos');
  ws2.addRow(['VENDEDOR', 'ITEM_CODE', 'ITEM', 'FAMILIA', 'SUBFAMILIA']);
  const sortedVendors = Array.from(vendorKeys).sort();
  for (const vk of sortedVendors) {
    for (const it of items) {
      if (ventasByVendorItem.has(vk + '||' + (it.item_code || ''))) continue;
      ws2.addRow([nn(vk), nn(it.item_code), nn(it.item_name), nn(it.familia), nn(it.subfamilia)]);
    }
  }
  styleHeader(ws2, 5);
  autosizeCols(ws2);

  // === Hoja 3: Clientes con compra ===
  const ws3 = wb.addWorksheet('3. Clientes con compra');
  ws3.addRow([
    'VENDEDOR',
    'CARD_CODE',
    'CLIENTE',
    'SKUs_DISTINTOS',
    'UNIDADES',
    'IMPORTE_ARS',
    'DOCUMENTOS',
  ]);
  const sortedEntries = Array.from(ventasByVendorClient.entries()).sort((a, b) => {
    const [ka] = a;
    const [kb] = b;
    const [va] = ka.split('||');
    const [vb] = kb.split('||');
    if (va !== vb) return va < vb ? -1 : 1;
    return b[1].importe - a[1].importe;
  });
  for (const [key, acc] of sortedEntries) {
    const [vn, cc] = key.split('||');
    ws3.addRow([
      nn(vn),
      nn(cc),
      nn(acc.card_name),
      nnum(acc.skus.size),
      nnum(acc.qty),
      nnum(acc.importe),
      nnum(acc.docs),
    ]);
  }
  styleHeader(ws3, 7);
  autosizeCols(ws3);

  // === Hoja 4: Clientes sin compra ===
  const ws4 = wb.addWorksheet('4. Clientes sin compra');
  ws4.addRow(['VENDEDOR', 'CARD_CODE', 'CLIENTE', 'PROVINCIA', 'LOCALIDAD']);
  for (const vk of sortedVendors) {
    const arr = (clientsByVendor.get(vk) || [])
      .slice()
      .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.clientName < b.clientName ? -1 : 1));
    for (const c of arr) {
      if (ventasByVendorClient.has(vk + '||' + (c.cardCode || ''))) continue;
      ws4.addRow([nn(vk), nn(c.cardCode), nn(c.clientName), nn(c.provincia), nn(c.localidad)]);
    }
  }
  styleHeader(ws4, 5);
  autosizeCols(ws4);

  // === Visitas: procesar y agrupar por (vendor, clienteNormalized) ===
  // visitas = Array<{tienda, vendor, fecha, provincia, localidad, formaContacto, interactionType, tipo}>
  // Agrupo por (vendorNorm, clienteNorm) → ultima fecha + count + metadata.
  /** @type {Map<string, {vendor: string, clienteOriginal: string, provincia: string, localidad: string, visitas: number, ultimaFecha: string, formasContacto: Set<string>, tipos: Set<string>}>} */
  const visitasByKey = new Map();
  for (const v of visits || []) {
    const vn = normVendor(v.vendor);
    const cliOrig = String(v.tienda || '').trim();
    if (!vn || !cliOrig) continue;
    const key = vn + '||' + normClient(cliOrig);
    let acc = visitasByKey.get(key);
    if (!acc) {
      acc = {
        vendor: vn,
        clienteOriginal: cliOrig,
        provincia: '',
        localidad: '',
        visitas: 0,
        ultimaFecha: '',
        formasContacto: new Set(),
        tipos: new Set(),
      };
      visitasByKey.set(key, acc);
    }
    acc.visitas += 1;
    const f = String(v.fecha || '').trim();
    if (f && f > acc.ultimaFecha) acc.ultimaFecha = f;
    if (v.provincia && !acc.provincia) acc.provincia = String(v.provincia).trim();
    if (v.localidad && !acc.localidad) acc.localidad = String(v.localidad).trim();
    if (v.formaContacto) acc.formasContacto.add(String(v.formaContacto).trim());
    if (v.interactionType) acc.tipos.add(String(v.interactionType).trim());
  }

  // Index para match con client_master.
  const clientMasterByVendorNorm = new Map(); // "vendor||clienteNorm" → clientObj
  for (const c of clients) {
    const vn = normVendor(c.vendor);
    const cn = normClient(c.clientName);
    if (!vn || !cn) continue;
    clientMasterByVendorNorm.set(vn + '||' + cn, c);
  }

  // === Hoja 5: Clientes visitados ===
  const ws5 = wb.addWorksheet('5. Clientes visitados');
  ws5.addRow([
    'VENDEDOR',
    'CLIENTE',
    'EN_PADRON_ASIGNADOS',
    'VISITAS_EN_EL_MES',
    'ULTIMA_FECHA',
    'PROVINCIA',
    'LOCALIDAD',
    'FORMAS_CONTACTO',
    'TIPO_INTERACCION',
  ]);
  const sortedVisKeys = Array.from(visitasByKey.values()).sort((a, b) => {
    if (a.vendor !== b.vendor) return a.vendor < b.vendor ? -1 : 1;
    return b.visitas - a.visitas;
  });
  for (const acc of sortedVisKeys) {
    const cliNorm = normClient(acc.clienteOriginal);
    const inPadron = clientMasterByVendorNorm.has(acc.vendor + '||' + cliNorm);
    ws5.addRow([
      nn(acc.vendor),
      nn(acc.clienteOriginal),
      inPadron ? 'SI' : 'NO (visita libre)',
      nnum(acc.visitas),
      nn(acc.ultimaFecha),
      nn(acc.provincia),
      nn(acc.localidad),
      nn(Array.from(acc.formasContacto).join(', ')),
      nn(Array.from(acc.tipos).join(', ')),
    ]);
  }
  styleHeader(ws5, 9);
  autosizeCols(ws5);

  // === Hoja 6: Clientes sin visitar ===
  // Para cada vendor del padron, lista los clientes asignados que NO fueron
  // visitados en el mes (ni como visita libre).
  const ws6 = wb.addWorksheet('6. Clientes sin visitar');
  ws6.addRow(['VENDEDOR', 'CARD_CODE', 'CLIENTE', 'PROVINCIA', 'LOCALIDAD', 'COMPRO_EN_EL_MES']);
  for (const vk of sortedVendors) {
    const arr = (clientsByVendor.get(vk) || [])
      .slice()
      .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.clientName < b.clientName ? -1 : 1));
    for (const c of arr) {
      const cn = normClient(c.clientName);
      if (visitasByKey.has(vk + '||' + cn)) continue; // fue visitado
      const compro = ventasByVendorClient.has(vk + '||' + (c.cardCode || ''));
      ws6.addRow([
        nn(vk),
        nn(c.cardCode),
        nn(c.clientName),
        nn(c.provincia),
        nn(c.localidad),
        compro ? 'SI' : 'NO',
      ]);
    }
  }
  styleHeader(ws6, 6);
  autosizeCols(ws6);

  // === Hoja 7: Resumen cobertura (metrica por vendedor) ===
  const ws7 = wb.addWorksheet('7. Resumen cobertura');
  ws7.addRow([
    'VENDEDOR',
    'CLIENTES_ASIGNADOS',
    'VISITADOS_DEL_PADRON',
    'COBERTURA_%',
    'VISITAS_LIBRES_FUERA_PADRON',
    'CON_COMPRA_EN_MES',
    'SIN_COMPRA_EN_MES',
  ]);
  for (const vk of sortedVendors) {
    const asignados = clientsByVendor.get(vk) || [];
    const totalAsig = asignados.length;
    const asigNormSet = new Set(asignados.map((/** @type {any} */ c) => normClient(c.clientName)));
    let visitadosDelPadron = 0;
    let visitasLibres = 0;
    for (const acc of visitasByKey.values()) {
      if (acc.vendor !== vk) continue;
      const cn = normClient(acc.clienteOriginal);
      if (asigNormSet.has(cn)) visitadosDelPadron += 1;
      else visitasLibres += 1;
    }
    const conCompra = asignados.filter((/** @type {any} */ c) =>
      ventasByVendorClient.has(vk + '||' + (c.cardCode || ''))
    ).length;
    const sinCompra = totalAsig - conCompra;
    const cobertura = totalAsig > 0 ? Math.round((visitadosDelPadron / totalAsig) * 1000) / 10 : 0;
    ws7.addRow([
      nn(vk),
      nnum(totalAsig),
      nnum(visitadosDelPadron),
      nnum(cobertura),
      nnum(visitasLibres),
      nnum(conCompra),
      nnum(sinCompra),
    ]);
  }
  styleHeader(ws7, 7);
  autosizeCols(ws7);

  return await wb.xlsx.writeBuffer();
}

export { buildReportBuffer, normVendor };
