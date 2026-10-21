// K — read-only prod: cuenta líneas state='confirmed' + asigReserva!=false +
// pedido.transferidoSAP.orderDocEntry presente (= SQ ya convertida a SO en SAP).
// Esas líneas HOY reservan stock en la app (lineReservesStock=true) pero SAP
// también las descuenta de Available → doble conteo.
//
// Después del fix v1400 §40.8, esas líneas dejan de reservar en app.
// El output de este script sirve de pre-conteo + verificación post-fix.
//
// Autorizado por Mariano 2026-10-21 (D3 doble conteo con SAP).

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // lineReservesStock desde el pure (reusa TTL §38 soft 7d + hard 60d).
  const { lineReservesStock } = await import('../../src/pure/stock-realmente-disponible.js');

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  console.log('================================================================');
  console.log('K — Confirmed con orderDocEntry @ ' + nowIso);
  console.log('================================================================');

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => pedidos.push(Object.assign({ _fsId: d.id }, d.data())));
  console.log('Pedidos abiertos: ' + pedidos.length);

  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs = typeof sd.warehouseBreakdown === 'string'
    ? JSON.parse(sd.warehouseBreakdown)
    : sd.warehouseBreakdown || {};

  const rows = [];
  for (const p of pedidos) {
    const orderDE = p.transferidoSAP && p.transferidoSAP.orderDocEntry;
    if (orderDE == null) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (l.state !== 'confirmed') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      // ¿Reserva HOY (pre-fix)?
      if (!lineReservesStock(l, nowMs, p)) continue;
      rows.push({
        pedidoId: p._fsId,
        orderNumber: p.orderNumber || '',
        cardCode: p.clientCardCode || '',
        clientName: p.clientName || '',
        sku: String(l.code).toUpperCase(),
        qtyOpen: qo,
        orderDocEntry: orderDE,
        orderDocNum: (p.transferidoSAP && p.transferidoSAP.orderDocNum) || '',
        confirmedAt: p.confirmedAt || '',
      });
    }
  }

  rows.sort((a, b) => a.sku.localeCompare(b.sku));
  const totalUnits = rows.reduce((s, r) => s + r.qtyOpen, 0);
  const uniqueSkus = new Set(rows.map((r) => r.sku)).size;

  console.log();
  console.log('===== HALLAZGO =====');
  console.log('Líneas confirmed con orderDocEntry que reservan HOY: ' + rows.length);
  console.log('Unidades afectadas: ' + totalUnits);
  console.log('SKUs únicos: ' + uniqueSkus);
  console.log();

  // Agrupar por SKU para ver impacto.
  /** @type {Map<string, {sku:string, units:number, lineas:number, fisicoDep11:number}>} */
  const bySku = new Map();
  for (const r of rows) {
    const existing = bySku.get(r.sku) || {
      sku: r.sku,
      units: 0,
      lineas: 0,
      fisicoDep11: Number((whs[r.sku] && whs[r.sku]['11']) || 0),
    };
    existing.units += r.qtyOpen;
    existing.lineas += 1;
    bySku.set(r.sku, existing);
  }
  const skuRows = Array.from(bySku.values()).sort((a, b) => b.units - a.units);

  console.log('===== TOP 50 SKUs POR UNIDADES AFECTADAS =====');
  console.log('| SKU | Fisico_Dep11 | Lineas | Unidades |');
  console.log('|---|---:|---:|---:|');
  for (const s of skuRows.slice(0, 50)) {
    console.log('| ' + s.sku + ' | ' + s.fisicoDep11 + ' | ' + s.lineas + ' | ' + s.units + ' |');
  }

  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  const outPath = path.join(outDir, '30_D3_DOBLE_CONTEO_SAP.md');
  const md = [
    '# K — D3 Doble conteo SAP @ ' + nowIso,
    '',
    'Líneas `state=confirmed` + `asigReserva!=false` + `lineReservesStock=true` + ',
    '`pedido.transferidoSAP.orderDocEntry != null`.',
    '',
    'Esas líneas HOY reservan stock en la app, pero SAP también las descuenta ',
    'de Available porque la cotización ya se convirtió en orden de venta. Doble conteo.',
    '',
    '## Hallazgo pre-fix v1400 §40.8',
    '',
    '- Líneas afectadas: **' + rows.length + '**',
    '- Unidades: **' + totalUnits + '**',
    '- SKUs únicos: **' + uniqueSkus + '**',
    '',
    '## Top 50 SKUs por unidades afectadas',
    '',
    '| SKU | Fisico Dep 11 | Lineas | Unidades |',
    '|---|---:|---:|---:|',
    ...skuRows.slice(0, 50).map((s) => '| ' + s.sku + ' | ' + s.fisicoDep11 + ' | ' + s.lineas + ' | ' + s.units + ' |'),
    '',
    '## Interpretación',
    '',
    'Al mergear v1400 §40.8, `lineReservesStock(\'confirmed\')` devolverá `false` ',
    'para estas líneas. El bucket `asignadas`/`confirmed` del breakdown baja N u ',
    'por SKU → `libre` sube el mismo delta (hasta el cap físico).',
    '',
    'Script: `scripts/audit/K_confirmed_con_order_docentry.cjs`.',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(outDir, { recursive: true });
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
