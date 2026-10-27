// AM — v1488 (2026-10-27) Compara los 2 exports de backorder contra prod.
//
// Reproduce localmente lo que hacen `exportBackorderAll` (panel) y
// `exportBackordersToExcel` (modal). Dumps los totales + diferencias
// fila por fila para determinar cuál es correcto según §56 + §65.
//
// Read-only: no toca Firestore ni genera xlsx.

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // Importar las 2 fns pure.
  const { computeBackorderSkuMap, computeBackorderRawLines } = await import(
    '../../src/pure/backorder-sku-map.js'
  );

  console.log('================================================================');
  console.log('AM — Compara exports Backorder (panel vs modal)');
  console.log('================================================================');

  // 1. Cargar pedidos abiertos.
  console.log('\n[1/3] Cargando globalPedidos (closedAt == null)...');
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  snap.forEach((d) => pedidos.push({ _fsId: d.id, ...d.data() }));
  console.log('  pedidos abiertos:', pedidos.length);

  // 2. Cargar stock snapshot para getStockDisponibleVenta.
  console.log('[2/3] Cargando stock_snapshot...');
  const stockDoc = await db.doc('app_config/stock_snapshot').get();
  const stockData = stockDoc.data() || {};
  const quantities = typeof stockData.quantities === 'string'
    ? JSON.parse(stockData.quantities)
    : (stockData.quantities || {});
  console.log('  quantities:', Object.keys(quantities).length, 'SKUs');

  const getStockDisponibleVenta = (sku) => Number(quantities[String(sku).toUpperCase()]) || 0;
  const canonVendor = (v) => String(v || '').trim().toUpperCase();
  const resolveVendorFallback = () => '';

  const deps = {
    getStockDisponibleVenta,
    canonVendor,
    products: [],
    resolveVendorFallback,
  };

  // 3. Compute panel export (sin filtros, sin includeExpired).
  console.log('\n[3/3] Compute ambos exports...');
  const panelRaw = computeBackorderRawLines(pedidos, 'urgente', {}, deps);
  const panelTotal = panelRaw.reduce((s, rl) => s + (rl.cliente.qtyBackorder || 0), 0);
  const panelFilas = panelRaw.length;
  const panelPares = new Set(
    panelRaw.map((rl) => `${rl.cliente.code || rl.cliente.nombre}|${rl.sku}`)
  ).size;
  console.log(`  PANEL (exportBackorderAll):`);
  console.log(`    filas: ${panelFilas}`);
  console.log(`    pares cliente+SKU únicos: ${panelPares}`);
  console.log(`    total unidades: ${panelTotal}`);

  // Compute modal export (con includeExpired=true, sin otros filtros).
  const modalMap = computeBackorderSkuMap(
    pedidos,
    'urgente',
    { aggregationMode: 'fifo', urgencyFilter: '', includeExpired: true },
    deps
  );
  const modalFilas = modalMap.skus.reduce((s, g) => s + g.clientes.length, 0);
  const modalPares = new Set();
  modalMap.skus.forEach((g) =>
    g.clientes.forEach((c) => modalPares.add(`${c.code || c.nombre}|${g.sku}`))
  );
  const modalTotal = modalMap.totalUnidades;
  console.log(`\n  MODAL (exportBackordersToExcel, includeExpired=true):`);
  console.log(`    filas: ${modalFilas}`);
  console.log(`    pares cliente+SKU únicos: ${modalPares.size}`);
  console.log(`    total unidades: ${modalTotal}`);
  console.log(`\n  DIFERENCIA panel vs modal (unidades): ${modalTotal - panelTotal}`);

  // Compute modal export SIN includeExpired para aislar efecto.
  const modalNoExp = computeBackorderSkuMap(
    pedidos,
    'urgente',
    { aggregationMode: 'fifo', urgencyFilter: '', includeExpired: false },
    deps
  );
  const modalNoExpTotal = modalNoExp.totalUnidades;
  console.log(`\n  MODAL sin includeExpired: filas=${modalNoExp.skus.reduce((s, g) => s + g.clientes.length, 0)}, unidades=${modalNoExpTotal}`);
  console.log(`  Efecto includeExpired en modal: +${modalTotal - modalNoExpTotal} unidades`);

  // Diff detallada: pares que están en uno y no en otro.
  const panelPairsMap = new Map(); // key -> qty
  panelRaw.forEach((rl) => {
    const k = `${rl.cliente.code || rl.cliente.nombre}|${rl.sku}`;
    panelPairsMap.set(k, (panelPairsMap.get(k) || 0) + (rl.cliente.qtyBackorder || 0));
  });
  const modalPairsMap = new Map();
  modalMap.skus.forEach((g) =>
    g.clientes.forEach((c) => {
      const k = `${c.code || c.nombre}|${g.sku}`;
      modalPairsMap.set(k, (modalPairsMap.get(k) || 0) + (c.qtyBackorder || 0));
    })
  );

  // Diffs.
  const onlyModal = [];
  const onlyPanel = [];
  const differentQty = [];
  for (const [k, modalQty] of modalPairsMap) {
    const panelQty = panelPairsMap.get(k);
    if (panelQty === undefined) onlyModal.push({ k, modalQty });
    else if (panelQty !== modalQty) differentQty.push({ k, panelQty, modalQty });
  }
  for (const [k, panelQty] of panelPairsMap) {
    if (!modalPairsMap.has(k)) onlyPanel.push({ k, panelQty });
  }

  console.log(`\n  Pares SOLO en modal: ${onlyModal.length}`);
  for (const x of onlyModal.slice(0, 15)) console.log(`    ${x.k} qty=${x.modalQty}`);
  console.log(`\n  Pares SOLO en panel: ${onlyPanel.length}`);
  for (const x of onlyPanel.slice(0, 15)) console.log(`    ${x.k} qty=${x.panelQty}`);
  console.log(`\n  Pares con distinta qty: ${differentQty.length}`);
  for (const x of differentQty.slice(0, 15))
    console.log(`    ${x.k} panel=${x.panelQty} modal=${x.modalQty} diff=${x.modalQty - x.panelQty}`);

  console.log('\n================================================================');
  console.log('ANTES v1488 (código legacy)');
  console.log('================================================================');
  console.log(`Panel (computeBackorderRawLines{}): ${panelTotal} unidades (${panelPares} pares)`);
  console.log(`Modal (computeBackorderSkuMap{includeExpired:true}): ${modalTotal} unidades (${modalPares.size} pares)`);
  console.log(`Diferencia: ${modalTotal - panelTotal} unidades = ${modalMap.skus.reduce((s, g) => s + g.clientes.length, 0) - panelFilas} filas`);

  // === POST-v1488: ambos usan la MISMA pure fn `computeBackorderExportRows`. ===
  console.log('\n================================================================');
  console.log('POST v1488 (fuente única: computeBackorderExportRows)');
  console.log('================================================================');
  const { computeBackorderExportRows } = await import('../../src/pure/backorder-export-rows.js');
  // Panel: panelExport simula exactamente `exportBackorderAll` post-v1488 (filtros {}).
  const panelExport = computeBackorderExportRows(pedidos, {}, deps);
  // Modal: modalExport simula `exportBackordersToExcel` post-v1488 (filtros desde UI; aquí {} para alinear con panel).
  const modalExport = computeBackorderExportRows(pedidos, {}, deps);
  console.log(`Panel: ${panelExport.totalUnidades} unidades (${panelExport.totalFilas} filas)`);
  console.log(`Modal: ${modalExport.totalUnidades} unidades (${modalExport.totalFilas} filas)`);
  const diff = modalExport.totalUnidades - panelExport.totalUnidades;
  console.log(`Diferencia: ${diff} unidades`);
  if (diff !== 0 || panelExport.totalFilas !== modalExport.totalFilas) {
    console.error('\nFAIL: panel != modal post-v1488. Investigar.');
    process.exit(2);
  }
  console.log('\nOK: panel == modal con la pure fn unificada.');
}

main().catch((e) => { console.error('ERR:', e); process.exit(1); });
