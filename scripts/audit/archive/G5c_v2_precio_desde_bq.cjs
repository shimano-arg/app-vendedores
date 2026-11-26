// G5c v2 — dry-run precio actual SAP desde BigQuery v_sap_items_enriched.
//
// Para cada línea con precio=0, consulta BQ por el SKU y propone el precio
// actual. Líneas con SKU no encontrado en SAP se listan aparte sin tocar.
//
// Dry-run por default. --apply persiste.

const PROJECT = 'app-vendedores-shimano';
const DATASET = 'shimano_app';
const VIEW = 'v_sap_items_enriched';
const APPLY = process.argv.includes('--apply');
const ACTIVE_STATES = new Set(['BO', 'ASIG', 'confirmed']);

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const { BigQuery } = require('../../functions/node_modules/@google-cloud/bigquery');
  const bq = new BigQuery({ projectId: PROJECT });

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('G5c v2 — precio=0 desde BQ v_sap_items_enriched @ ' + nowIso + '  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('================================================================');

  // 1. Encontrar las 728 líneas candidatas.
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const affected = [];
  const skuSet = new Set();
  snap.forEach((d) => {
    const p = d.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    lines.forEach((l, i) => {
      if (!l || !ACTIVE_STATES.has(l.state)) return;
      const qty = Number(l.qty) || 0;
      const precio = Number(l.precio) || 0;
      if (qty > 0 && precio === 0) {
        const sku = String(l.code || '').trim().toUpperCase();
        if (!sku) return;
        const priceSnap = Number(l.priceAtCreation) || Number(l.price) || 0;
        affected.push({
          pedidoId: d.id,
          orderNumber: p.orderNumber || '',
          cliente: p.clientName || '',
          lineIndex: i,
          sku,
          state: l.state,
          qty,
          priceAtCreation: priceSnap,
        });
        skuSet.add(sku);
      }
    });
  });
  console.log('Líneas candidatas: ' + affected.length);
  console.log('SKUs únicos: ' + skuSet.size);

  // 2. Consultar BQ por los SKUs. Un solo query con WHERE IN.
  const skus = Array.from(skuSet);
  const CHUNK = 500;
  const priceBySku = {};
  const notFound = new Set();
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK);
    const sql = `
      SELECT UPPER(item_code) AS code,
             ANY_VALUE(price_pesca_ars) AS price_ars,
             ANY_VALUE(_sync_timestamp) AS updated_at
      FROM \`${PROJECT}.${DATASET}.${VIEW}\`
      WHERE UPPER(item_code) IN UNNEST(@skus)
      GROUP BY code
    `;
    const [rows] = await bq.query({ query: sql, params: { skus: chunk } });
    for (const r of rows) {
      priceBySku[r.code] = {
        price: Number(r.price_ars) || 0,
        updatedAt: r.updated_at ? (r.updated_at.value || r.updated_at) : null,
      };
    }
    console.log('BQ chunk ' + (i / CHUNK + 1) + ': ' + rows.length + ' rows');
  }
  for (const sku of skus) {
    if (!priceBySku[sku]) notFound.add(sku);
  }
  console.log('SKUs con precio BQ: ' + Object.keys(priceBySku).length);
  console.log('SKUs NO en BQ: ' + notFound.size);

  // 3. Clasificar líneas.
  const resolved = []; // tiene precio BQ
  const orphans = []; // SKU no en BQ
  const zeroPriceInBq = []; // SKU en BQ pero price=0

  for (const row of affected) {
    const bqEntry = priceBySku[row.sku];
    if (!bqEntry) {
      orphans.push(row);
      continue;
    }
    if (bqEntry.price === 0) {
      zeroPriceInBq.push({ ...row, bqPrice: 0, bqUpdatedAt: bqEntry.updatedAt });
      continue;
    }
    resolved.push({ ...row, bqPrice: bqEntry.price, bqUpdatedAt: bqEntry.updatedAt });
  }

  // 4. Resumen
  console.log();
  console.log('===== RESUMEN =====');
  console.log('Líneas RECOVERABLE (BQ price > 0): ' + resolved.length);
  console.log('Líneas con BQ price = 0: ' + zeroPriceInBq.length);
  console.log('Líneas SIN SKU en BQ (orphans): ' + orphans.length);

  // Deltas
  const deltas = resolved.map((r) => {
    if (r.priceAtCreation > 0) {
      return ((r.bqPrice - r.priceAtCreation) / r.priceAtCreation) * 100;
    }
    return null;
  }).filter((d) => d !== null);
  if (deltas.length > 0) {
    deltas.sort((a, b) => a - b);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const med = deltas[Math.floor(deltas.length / 2)];
    console.log();
    console.log('===== Delta BQ vs priceAtCreation =====');
    console.log('  min: ' + deltas[0].toFixed(1) + '%');
    console.log('  p25: ' + deltas[Math.floor(deltas.length * 0.25)].toFixed(1) + '%');
    console.log('  mediana: ' + med.toFixed(1) + '%');
    console.log('  p75: ' + deltas[Math.floor(deltas.length * 0.75)].toFixed(1) + '%');
    console.log('  max: ' + deltas[deltas.length - 1].toFixed(1) + '%');
    console.log('  promedio: ' + avg.toFixed(1) + '%');
  }

  // 5. Markdown
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '..', '..', 'docs', 'auditoria', '37_G5C_V2_DRYRUN_BQ.md');
  const md = [
    '# G5c v2 — Dry-run precio desde BQ @ ' + nowIso,
    '',
    '## Resumen',
    '',
    '| Clasificación | Count | Acción propuesta |',
    '|---|---:|---|',
    '| RECOVERABLE (BQ price > 0) | ' + resolved.length + ' | ' + (APPLY ? 'APLICAR' : 'listado abajo (dry-run)') + ' |',
    '| BQ price = 0 (en SAP sin precio) | ' + zeroPriceInBq.length + ' | NO tocar (dejar precio=0) |',
    '| Orphans (SKU no en v_sap_items_enriched) | ' + orphans.length + ' | NO tocar (puede ser SKU legacy o custom) |',
    '',
    deltas.length > 0 ? '## Delta BQ vs priceAtCreation (ago 2026)' : '',
    '',
    deltas.length > 0 ? '- mediana: ' + (deltas[Math.floor(deltas.length / 2)]).toFixed(1) + '%' : '',
    deltas.length > 0 ? '- promedio: ' + (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1) + '%' : '',
    deltas.length > 0 ? '- rango: ' + deltas[0].toFixed(1) + '% a ' + deltas[deltas.length - 1].toFixed(1) + '%' : '',
    '',
    '## Lista RECOVERABLE (' + resolved.length + ' líneas)',
    '',
    '| Pedido | ORDEN | Cliente | Line | SKU | State | Qty | priceAtCreation | BQ actual | Delta % |',
    '|---|---|---|---:|---|---|---:|---:|---:|---:|',
    ...resolved.slice(0, 1000).map((r) => {
      const delta = r.priceAtCreation > 0 ? ((r.bqPrice - r.priceAtCreation) / r.priceAtCreation * 100).toFixed(1) + '%' : 'n/a';
      return '| `' + r.pedidoId + '` | ' + r.orderNumber + ' | ' + r.cliente + ' | ' + r.lineIndex + ' | ' + r.sku + ' | ' + r.state + ' | ' + r.qty + ' | ' + r.priceAtCreation.toLocaleString('es-AR') + ' | ' + r.bqPrice.toLocaleString('es-AR') + ' | ' + delta + ' |';
    }),
    resolved.length > 1000 ? '\n(... ' + (resolved.length - 1000) + ' más, truncadas)' : '',
    '',
    '## Lista ORPHANS (' + orphans.length + ' líneas — SKU no en BQ)',
    '',
    orphans.length === 0 ? '_(ninguna)_' : [
      '| Pedido | ORDEN | Cliente | Line | SKU | State | Qty | priceAtCreation |',
      '|---|---|---|---:|---|---|---:|---:|',
      ...orphans.slice(0, 500).map((r) => '| `' + r.pedidoId + '` | ' + r.orderNumber + ' | ' + r.cliente + ' | ' + r.lineIndex + ' | ' + r.sku + ' | ' + r.state + ' | ' + r.qty + ' | ' + r.priceAtCreation.toLocaleString('es-AR') + ' |'),
      orphans.length > 500 ? '\n(... ' + (orphans.length - 500) + ' más, truncadas)' : '',
    ].join('\n'),
    '',
    '## Lista BQ price = 0 (' + zeroPriceInBq.length + ' líneas)',
    '',
    zeroPriceInBq.length === 0 ? '_(ninguna)_' : [
      '| Pedido | ORDEN | Cliente | Line | SKU | State | Qty | priceAtCreation | BQ |',
      '|---|---|---|---:|---|---|---:|---:|---:|',
      ...zeroPriceInBq.slice(0, 500).map((r) => '| `' + r.pedidoId + '` | ' + r.orderNumber + ' | ' + r.cliente + ' | ' + r.lineIndex + ' | ' + r.sku + ' | ' + r.state + ' | ' + r.qty + ' | ' + r.priceAtCreation.toLocaleString('es-AR') + ' | 0 |'),
    ].join('\n'),
    '',
    '## Próximo paso',
    '',
    APPLY ? 'Script completó --apply. Revisar deltas.' : 'Correr con `--apply` para persistir ' + resolved.length + ' precios actualizados.',
    '',
  ].join('\n');
  fs.writeFileSync(outPath, md, 'utf8');
  console.log();
  console.log('Markdown escrito:', outPath);

  if (APPLY) {
    console.log();
    console.log('===== APPLY (' + resolved.length + ' líneas) =====');
    const byPedido = new Map();
    for (const r of resolved) {
      if (!byPedido.has(r.pedidoId)) byPedido.set(r.pedidoId, []);
      byPedido.get(r.pedidoId).push(r);
    }
    let okCount = 0;
    let failCount = 0;
    for (const [pedidoId, rows] of byPedido.entries()) {
      try {
        const docRef = db.collection('pedidos').doc(pedidoId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) continue;
        const data = docSnap.data() || {};
        const newLines = Array.isArray(data.lines) ? data.lines.map((l) => ({ ...l })) : [];
        for (const r of rows) {
          const l = newLines[r.lineIndex];
          if (!l) continue;
          l.precio = r.bqPrice;
          l.precioZeroFixedAt = nowIso;
          l.precioZeroFixedReason = 'G5c_v2_from_bq_sap_actual_v1425';
          l.precioZeroFixedFrom = r.priceAtCreation;
        }
        await docRef.update({ lines: newLines, updatedAt: nowIso });
        okCount += rows.length;
        console.log('  ✓ pedidos/' + pedidoId + ': ' + rows.length);
      } catch (e) {
        failCount += rows.length;
        console.error('  ✗ pedidos/' + pedidoId + ':', e.message || e);
      }
    }
    console.log();
    console.log('OK: ' + okCount + ' | FAIL: ' + failCount);
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
