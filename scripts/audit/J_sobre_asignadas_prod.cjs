// J — read-only prod: lista todas las ASIG con sobreAsignada > 0 usando
// getStockBreakdown v1395 §40.3. Output tabla cliente/SKU/nominal/entregable/asigAt
// + markdown en docs/auditoria/29_SOBRE_ASIGNADAS_PROD.md.
//
// Autorizado por Mariano 2026-10-21 (tarea v1395 §40.3 — sobre-asignadas).

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const { getStockBreakdown } = await import('../../src/pure/stock-breakdown.js');

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  console.log('================================================================');
  console.log('J — Sobre-asignadas en prod @ ' + nowIso);
  console.log('================================================================');

  // Snapshot stock.
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs =
    typeof sd.warehouseBreakdown === 'string'
      ? JSON.parse(sd.warehouseBreakdown)
      : sd.warehouseBreakdown || {};

  // Open pedidos.
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => pedidos.push(Object.assign({ _fsId: d.id }, d.data())));

  // SKUs a scanear: unión fisico > 0 + ASIG en pedidos.
  const skuSet = new Set();
  for (const [sku, w] of Object.entries(whs)) {
    if (Number(w['11']) > 0) skuSet.add(String(sku).toUpperCase());
  }
  for (const p of pedidos) {
    for (const l of Array.isArray(p.lines) ? p.lines : []) {
      if (l && l.state === 'ASIG' && l.code) skuSet.add(String(l.code).toUpperCase());
    }
  }

  const rows = [];
  for (const sku of skuSet) {
    const fisico = Number((whs[sku] && whs[sku]['11']) || 0);
    const breakdown = getStockBreakdown(
      sku,
      { getStockFisico: () => fisico, pedidos },
      { now: nowMs }
    );
    const totalSobre = breakdown.asignadas.totalSobreAsignada || 0;
    if (totalSobre <= 0) continue;
    for (const d of breakdown.asignadas.detalle || []) {
      if (d.sobreAsignada <= 0) continue;
      rows.push({
        sku,
        cardCode: d.cardCode,
        clientName: d.clientName,
        qtyNominal: d.qtyNominal,
        qtyEntregable: d.qtyEntregable,
        sobreAsignada: d.sobreAsignada,
        asigAt: d.asigAt,
        pedidoId: d.pedidoId,
      });
    }
  }

  rows.sort((a, b) => b.sobreAsignada - a.sobreAsignada);

  console.log('SKUs con sobre-asignadas: ' + new Set(rows.map((r) => r.sku)).size);
  console.log('Líneas sobre-asignadas: ' + rows.length);
  console.log(
    'Total unidades sobre-asignadas: ' + rows.reduce((s, r) => s + r.sobreAsignada, 0)
  );
  console.log();
  console.log('===== TABLA =====');
  console.log(
    '| SKU | Cliente | CardCode | Prometidas | Entregables | Sobre | asigAt | pedidoId |'
  );
  console.log('|---|---|---|---|---|---|---|---|');
  rows.slice(0, 100).forEach((r) => {
    console.log(
      '| ' +
        r.sku +
        ' | ' +
        (r.clientName || '').slice(0, 30) +
        ' | ' +
        r.cardCode +
        ' | ' +
        r.qtyNominal +
        ' | ' +
        r.qtyEntregable +
        ' | ' +
        r.sobreAsignada +
        ' | ' +
        (r.asigAt || '-').slice(0, 10) +
        ' | ' +
        r.pedidoId.slice(0, 8) +
        ' |'
    );
  });

  // Markdown out.
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '..', '..', 'docs', 'auditoria', '29_SOBRE_ASIGNADAS_PROD.md');
  const md = [
    '# J — Sobre-asignadas en prod @ ' + nowIso,
    '',
    'Lista read-only de líneas `state=ASIG` con `sobreAsignada > 0` según `getStockBreakdown` v1395 §40.3.',
    '',
    'Scope: SKUs con físico dep 11 > 0 ∪ SKUs con alguna línea ASIG en pedidos abiertos.',
    '',
    '## Totales',
    '',
    '- SKUs con sobre-asignadas: **' + new Set(rows.map((r) => r.sku)).size + '**',
    '- Líneas sobre-asignadas: **' + rows.length + '**',
    '- Unidades sobre-asignadas: **' + rows.reduce((s, r) => s + r.sobreAsignada, 0) + '**',
    '',
    '## Tabla (top 100 por sobre-asignada)',
    '',
    '| SKU | Cliente | CardCode | Prometidas | Entregables | Sobre | asigAt | pedidoId |',
    '|---|---|---|---:|---:|---:|---|---|',
    ...rows
      .slice(0, 100)
      .map(
        (r) =>
          '| ' +
          r.sku +
          ' | ' +
          (r.clientName || '').replace(/\|/g, '/').slice(0, 50) +
          ' | ' +
          r.cardCode +
          ' | ' +
          r.qtyNominal +
          ' | ' +
          r.qtyEntregable +
          ' | ' +
          r.sobreAsignada +
          ' | ' +
          (r.asigAt || '-').slice(0, 10) +
          ' | ' +
          r.pedidoId.slice(0, 8) +
          ' |'
      ),
    '',
    '## Nota',
    '',
    'El flag `sobreAsignada` es **computed** (CLAUDE.md §39/§40.3): no persiste en Firestore.',
    'Si entra stock que cubre el nominal, desaparece solo al próximo read del breakdown.',
    '',
    'Script generador: `scripts/audit/J_sobre_asignadas_prod.cjs`.',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    console.log();
    console.log('Markdown escrito en ' + outPath);
  } catch (e) {
    console.error('No se pudo escribir markdown: ' + (e && e.message ? e.message : String(e)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
