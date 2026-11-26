// Z — v1504 PR2 (2026-10-28) — diagnóstico read-only de líneas con desc
// divergente del catálogo en pedidos ABIERTOS.
//
// Objetivo: contar cuántas líneas tienen `line.desc` !== `catalog[line.code].desc`.
// NO escribe. Output tabla top 50 + totales por SKU a Desktop\RAW_PEDIDOS_DESC_DIVERGE.md.
//
// Scope:
//   - `pedidos` con closedAt == null (abiertos).
//   - Líneas con `code` populated (lo demás se ignora).
//   - Comparación: trim + case-sensitive. Divergencia = ambas populated + distintas.
//     "l.desc vacío + catalog populated" también cuenta como divergente (el reader
//     va a mostrar la del catalog en vez de "").
//
// Uso:
//   node scripts/audit/Z_pedidos_desc_diverge.cjs
//   node scripts/audit/Z_pedidos_desc_diverge.cjs --limit=100
//
// NUNCA tiene flag --apply (es read-only).

const PROJECT = 'app-vendedores-shimano';

async function loadCatalog(db) {
  const map = {};
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    const m = html.match(/const PRODUCTS = (\[[\s\S]+?\]);/);
    if (m && m[1]) {
      const products = JSON.parse(m[1]);
      for (const p of products) {
        const code = String(p.code || '').toUpperCase().trim();
        const desc = String(p.desc || '').trim();
        if (code && desc) map[code] = desc;
      }
    }
  } catch (e) {
    console.warn('WARN extracting PRODUCTS:', e.message);
  }
  // Merge sap_products (secundario).
  try {
    const snap = await db.collection('sap_products').get();
    snap.forEach((d) => {
      const code = d.id.toUpperCase().trim();
      const data = d.data() || {};
      const desc = String(data.descripcion || data.desc || data.name || '').trim();
      if (code && desc && !map[code]) map[code] = desc;
    });
  } catch (_e) {
    // ok si no existe
  }
  return map;
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 50;

  console.log('================================================================');
  console.log('Z — diagnóstico desc divergente del catálogo (v1504 PR2)');
  console.log('================================================================');

  console.log('[1/3] Cargando catálogo...');
  const catalog = await loadCatalog(db);
  console.log('  Items en catalog: ' + Object.keys(catalog).length);

  console.log('[2/3] Scanning pedidos abiertos...');
  const snap = await db
    .collection('pedidos')
    .where('closedAt', '==', null)
    .get();
  console.log('  Pedidos abiertos: ' + snap.size);

  /** @type {Array<{pedidoId: string, orderNumber: any, lineIndex: number, code: string, lineDesc: string, catalogDesc: string, delta: 'EMPTY_LINE' | 'DIFFERENT' | 'MISSING_CATALOG'}>} */
  const diverge = [];
  const perSku = new Map();
  let totalLines = 0;

  snap.forEach((d) => {
    const data = d.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    lines.forEach((l, idx) => {
      if (!l || !l.code) return;
      totalLines++;
      const code = String(l.code).toUpperCase().trim();
      const lineDesc = String(l.desc || '').trim();
      const catalogDesc = catalog[code] || '';
      if (!catalogDesc) {
        if (!lineDesc) return; // nada que reportar
        diverge.push({
          pedidoId: d.id,
          orderNumber: data.orderNumber || null,
          lineIndex: idx,
          code,
          lineDesc,
          catalogDesc: '',
          delta: 'MISSING_CATALOG',
        });
        perSku.set(code, (perSku.get(code) || 0) + 1);
        return;
      }
      if (!lineDesc) {
        diverge.push({
          pedidoId: d.id,
          orderNumber: data.orderNumber || null,
          lineIndex: idx,
          code,
          lineDesc: '',
          catalogDesc,
          delta: 'EMPTY_LINE',
        });
        perSku.set(code, (perSku.get(code) || 0) + 1);
        return;
      }
      if (lineDesc !== catalogDesc) {
        diverge.push({
          pedidoId: d.id,
          orderNumber: data.orderNumber || null,
          lineIndex: idx,
          code,
          lineDesc,
          catalogDesc,
          delta: 'DIFFERENT',
        });
        perSku.set(code, (perSku.get(code) || 0) + 1);
      }
    });
  });

  console.log('[3/3] Resumen');
  console.log('  Total líneas escaneadas: ' + totalLines);
  console.log('  Divergentes: ' + diverge.length);
  const byDelta = diverge.reduce((acc, r) => {
    acc[r.delta] = (acc[r.delta] || 0) + 1;
    return acc;
  }, {});
  console.log('  Por tipo:', JSON.stringify(byDelta));

  // Output markdown.
  const topLines = diverge.slice(0, limit);
  const sortedSkus = [...perSku.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);

  const md = [];
  md.push('# RAW_PEDIDOS_DESC_DIVERGE v1504 PR2');
  md.push('');
  md.push('Generado: ' + new Date().toISOString());
  md.push('');
  md.push('## Totales');
  md.push('- Pedidos abiertos escaneados: ' + snap.size);
  md.push('- Líneas totales: ' + totalLines);
  md.push('- Líneas divergentes: ' + diverge.length);
  md.push('- EMPTY_LINE (línea sin desc, catalog tiene): ' + (byDelta.EMPTY_LINE || 0));
  md.push('- DIFFERENT (ambas populated, distintas): ' + (byDelta.DIFFERENT || 0));
  md.push('- MISSING_CATALOG (línea tiene desc, catalog no): ' + (byDelta.MISSING_CATALOG || 0));
  md.push('');
  md.push('## Top 50 SKUs con más líneas divergentes');
  md.push('');
  md.push('| SKU | Líneas divergentes |');
  md.push('| --- | ---: |');
  for (const [sku, n] of sortedSkus) {
    md.push('| ' + sku + ' | ' + n + ' |');
  }
  md.push('');
  md.push('## Top ' + limit + ' líneas divergentes (muestra)');
  md.push('');
  md.push('| OrderNumber | PedidoId | LineIdx | Code | Line.desc | Catalog.desc | Delta |');
  md.push('| --- | --- | ---: | --- | --- | --- | --- |');
  for (const r of topLines) {
    const l = r.lineDesc.length > 60 ? r.lineDesc.slice(0, 57) + '...' : r.lineDesc;
    const c = r.catalogDesc.length > 60 ? r.catalogDesc.slice(0, 57) + '...' : r.catalogDesc;
    md.push(
      '| ' + (r.orderNumber || '') +
      ' | ' + r.pedidoId +
      ' | ' + r.lineIndex +
      ' | ' + r.code +
      ' | ' + l.replace(/\|/g, '\\|') +
      ' | ' + c.replace(/\|/g, '\\|') +
      ' | ' + r.delta + ' |'
    );
  }

  const fs = require('node:fs');
  const path = require('node:path');
  // Resolver Desktop multi-SO: C:\Users\shimano.sandbox\Desktop en Windows.
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const outPath = home
    ? path.join(home, 'Desktop', 'RAW_PEDIDOS_DESC_DIVERGE.md')
    : path.join(__dirname, 'RAW_PEDIDOS_DESC_DIVERGE.md');
  fs.writeFileSync(outPath, md.join('\n'), 'utf8');
  console.log('[OK] Output: ' + outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
