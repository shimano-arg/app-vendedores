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
 * @param {{ventas: Array<any>, items: Array<any>, clients: Array<any>, vendors: Array<any>, makeWorkbook: () => any}} params
 * @returns {Promise<any>}
 */
async function buildReportBuffer({ ventas, items, clients, vendors, makeWorkbook }) {
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
      r.vendor,
      r.card_code,
      r.card_name,
      r.item_code,
      r.item_name,
      r.familia,
      r.subfamilia,
      r.qty,
      r.importe,
      r.docs,
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
      ws2.addRow([
        vk,
        it.item_code || '',
        it.item_name || '',
        it.familia || '',
        it.subfamilia || '',
      ]);
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
    ws3.addRow([vn, cc, acc.card_name, acc.skus.size, acc.qty, acc.importe, acc.docs]);
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
      ws4.addRow([vk, c.cardCode || '', c.clientName || '', c.provincia || '', c.localidad || '']);
    }
  }
  styleHeader(ws4, 5);
  autosizeCols(ws4);

  return await wb.xlsx.writeBuffer();
}

export { buildReportBuffer, normVendor };
