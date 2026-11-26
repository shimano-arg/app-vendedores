// AQ v1495 §94 (2026-10-27) — audit SKUs sin clasificación completa.
//
// PR2 iter 5 pedido Mariano: listar cuántos SKUs del catálogo no tienen
// `cat`/`fam`/`sub` para completar en SAP. Lee PRODUCTS inline en index.html
// (JSON array embebido via `const PRODUCTS = [...]`) + reusa la pure fn
// `hasFullClassification` de `src/pure/product-labels.js`.
//
// Read-only. Output: tabla ASCII + total + lista completa en docs/auditoria/.

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  // Extract: const PRODUCTS = [...];
  const m = html.match(/const PRODUCTS = (\[[\s\S]*?\]);/);
  if (!m) {
    console.error('ERR: no se encontró `const PRODUCTS = [...]` en index.html');
    process.exit(1);
  }
  let products;
  try {
    products = JSON.parse(m[1]);
  } catch (e) {
    console.error('ERR: PRODUCTS no es JSON válido:', e.message);
    process.exit(1);
  }
  console.log('================================================================');
  console.log('AQ — Audit SKUs sin clasificación completa (cat/fam/sub)');
  console.log('================================================================\n');
  console.log('[1] Total SKUs en PRODUCTS:', products.length);

  // Reusa pure fn.
  const { hasFullClassification, formatProductCatLineParts, formatProductDesc } = await import(
    '../../src/pure/product-labels.js'
  );

  const sinClas = [];
  const sinDesc = [];
  const breakdown = { sinCat: 0, sinFam: 0, sinSub: 0, sinNinguno: 0 };

  for (const p of products) {
    if (!hasFullClassification(p)) {
      sinClas.push({
        code: p.code,
        desc: p.desc || '(sin desc)',
        cat: p.cat || '',
        fam: p.fam || '',
        sub: p.sub || '',
      });
      const nulls = {
        cat: !p.cat || String(p.cat).trim() === '',
        fam: !p.fam || String(p.fam).trim() === '',
        sub: !p.sub || String(p.sub).trim() === '',
      };
      if (nulls.cat) breakdown.sinCat++;
      if (nulls.fam) breakdown.sinFam++;
      if (nulls.sub) breakdown.sinSub++;
      if (nulls.cat && nulls.fam && nulls.sub) breakdown.sinNinguno++;
    }
    const d = p.desc == null ? '' : String(p.desc).trim();
    if (!d) sinDesc.push(p.code || '(sin code)');
  }

  console.log('[2] SKUs sin clasificación completa:', sinClas.length);
  console.log('    Sin categoría:', breakdown.sinCat);
  console.log('    Sin familia:', breakdown.sinFam);
  console.log('    Sin subfamilia:', breakdown.sinSub);
  console.log('    Sin ninguno de los 3:', breakdown.sinNinguno);
  console.log('\n[3] SKUs sin descripción:', sinDesc.length);
  if (sinDesc.length) console.log('    SKUs:', sinDesc.join(', '));

  // Reporte: muestra reportada por Mariano.
  const SAMPLE = ['26ZODIAS160MH', '271006', '471512', 'LUGC22', 'DISPSUNGLASSES6', 'DISPSUNGLASSES9', 'KITBAITSPOINT', 'LINEDISP40X38', 'LR160FA'];
  console.log('\n[4] Muestra reportada por Mariano:');
  for (const code of SAMPLE) {
    const p = products.find((x) => x.code === code);
    if (!p) {
      console.log('  ' + code.padEnd(20) + ' | NO EXISTE EN PRODUCTS');
      continue;
    }
    const parts = formatProductCatLineParts(p);
    const desc = formatProductDesc(p);
    console.log(
      '  ' + code.padEnd(20) +
      ' | desc="' + desc.slice(0, 40) + '"' +
      ' | cat/fam/sub partes=[' + parts.map(x => '"' + x + '"').join(',') + ']'
    );
  }

  console.log('\n[5] Primeros 30 SKUs sin clasificación:');
  for (const p of sinClas.slice(0, 30)) {
    console.log(
      '  ' + (p.code || '').padEnd(20) +
      ' | desc=' + p.desc.slice(0, 40).padEnd(40) +
      ' | cat="' + p.cat + '" fam="' + p.fam + '" sub="' + p.sub + '"'
    );
  }
  if (sinClas.length > 30) console.log('  ... (+' + (sinClas.length - 30) + ' más)');

  // Dump JSON completo.
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'AQ_products_sin_clasificacion.json');
  fs.writeFileSync(outFile, JSON.stringify({
    totalProducts: products.length,
    sinClasificacionCount: sinClas.length,
    sinDescripcionCount: sinDesc.length,
    breakdown,
    sinClasificacion: sinClas,
    sinDescripcion: sinDesc,
  }, null, 2));
  console.log('\n[6] Dump completo: docs/auditoria/AQ_products_sin_clasificacion.json');

  // [7] Cross-check contra stock.json: SKUs que aparecen en stock pero NO
  // están en PRODUCTS (huérfanos — los que muestran "UNDEFINED" en el picker).
  const stockPath = path.join(__dirname, '..', '..', 'stock.json');
  let stockMap = {};
  try {
    const stock = JSON.parse(fs.readFileSync(stockPath, 'utf8'));
    // stock.json shape: { updatedAt, source, totalSkus, stock: {sku: qty} }.
    // Fallback a `quantities` o al root por compat con otras estructuras.
    stockMap = typeof stock.stock === 'object' && stock.stock !== null
      ? stock.stock
      : (typeof stock.quantities === 'string'
          ? JSON.parse(stock.quantities)
          : (stock.quantities || {}));
  } catch (_e) {
    console.log('[7] stock.json no leíble, salto cross-check.');
  }
  const productCodes = new Set(products.map((p) => (p.code || '').toUpperCase()));
  const stockOnly = [];
  for (const sku of Object.keys(stockMap)) {
    if (!productCodes.has(sku.toUpperCase())) {
      stockOnly.push({ code: sku, stock: stockMap[sku] });
    }
  }
  console.log(`\n[7] SKUs en stock.json pero NO en PRODUCTS (huérfanos, aparecen "UNDEFINED" pre-v1495):`, stockOnly.length);
  for (const s of stockOnly.slice(0, 50)) {
    console.log('  ' + (s.code || '').padEnd(20) + ' | stock=' + s.stock);
  }
  if (stockOnly.length > 50) console.log('  ... (+' + (stockOnly.length - 50) + ' más)');

  // Dump completo cross-check.
  fs.writeFileSync(
    path.join(outDir, 'AQ_products_sin_clasificacion.json'),
    JSON.stringify({
      totalProducts: products.length,
      sinClasificacionCount: sinClas.length,
      sinDescripcionCount: sinDesc.length,
      breakdown,
      sinClasificacion: sinClas,
      sinDescripcion: sinDesc,
      stockOrphans: stockOnly,
      stockOrphansCount: stockOnly.length,
    }, null, 2)
  );

  console.log('\n================================================================');
  console.log('Resumen para Mariano:');
  console.log(`  • ${sinClas.length} / ${products.length} SKUs sin cat/fam/sub completa (${(sinClas.length*100/products.length).toFixed(1)}%).`);
  console.log(`  • ${sinDesc.length} / ${products.length} SKUs sin descripción.`);
  console.log(`  • ${stockOnly.length} SKUs huérfanos (en stock pero NO en PRODUCTS catalog).`);
  console.log('    → Estos son los que mostraban "UNDEFINED UNDEFINED UNDEFINED" en el picker.');
  console.log('    → v1495 ahora los renderiza con SKU + sin línea cat/fam/sub.');
  console.log('    → Mariano: completar su clasificación en SAP + sincronizar PRODUCTS.');
  console.log('================================================================');
}

main().catch((e) => { console.error('ERR:', e); process.exit(1); });
