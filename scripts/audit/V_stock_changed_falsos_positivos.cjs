#!/usr/bin/env node
// @ts-check
/**
 * §64 (2026-10-23 v1443) — Audit STOCK_CHANGED falsos positivos.
 *
 * Lee operations_log con type='commit_pedido_rejected' + errorCode='STOCK_CHANGED'
 * del día + N días previos. Para cada entry: tabula SKU, cliente, cardCode,
 * valores de cada lado (cliente y CF), mismatch flags.
 *
 * Objetivo: identificar cuándo cliente y CF calculan distinto para unificar
 * en src/pure §39 (si procede).
 *
 * Uso:
 *   node scripts/audit/V_stock_changed_falsos_positivos.cjs [--days=N] [--full]
 *
 * Opts:
 *   --days=N   Lee los últimos N días (default 1).
 *   --full     Imprime JSON completo de cada entry (default: resumen).
 *
 * Salida: tabla ASCII + resumen al final (total rejections, SKUs top-N,
 * clientes top-N, divergencias cliente↔CF).
 *
 * NOTA sobre índice: la query usa solo (type + timestamp), filtra errorCode
 * en memoria para no requerir composite index extra en firestore.indexes.json.
 */

const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) || 1 : 1;
  const full = args.includes('--full');

  const now = Date.now();
  const since = new Date(now - days * 24 * 60 * 60 * 1000);
  console.log('[audit V §64] Buscando commit_pedido_rejected STOCK_CHANGED desde', since.toISOString());

  // Query solo por timestamp (single-field index automático). Filtramos type + errorCode en memoria.
  const rawSnap = await db
    .collection('operations_log')
    .where('timestamp', '>=', since)
    .orderBy('timestamp', 'desc')
    .get();

  const docs = [];
  let totalCommitRejected = 0;
  rawSnap.forEach((doc) => {
    const d = doc.data();
    if (d.type === 'commit_pedido_rejected') {
      totalCommitRejected++;
      if (d.errorCode === 'STOCK_CHANGED') docs.push({ _id: doc.id, ...d });
    }
  });

  console.log(`[audit V §64] operations_log entries total: ${rawSnap.size}, commit_pedido_rejected: ${totalCommitRejected}, STOCK_CHANGED filtrados: ${docs.length}`);

  if (docs.length === 0) {
    console.log('No se encontraron rechazos STOCK_CHANGED en los últimos', days, 'día(s).');
    return;
  }

  console.log('\n=== RECHAZOS STOCK_CHANGED ===\n');
  console.log(
    'TIMESTAMP            | DRAFT                | CARDCODE     | SKUs | TOTAL BO | USUARIO                   | CLIENT_SNAP'
  );
  console.log('-'.repeat(145));

  /** @type {Record<string, number>} */
  const skuCounts = {};
  /** @type {Record<string, number>} */
  const cardCodeCounts = {};
  /** @type {Record<string, number>} */
  const userCounts = {};
  let divergencesCount = 0;
  const divergences = [];

  // Clasificación por root cause probable
  const cat = {
    race_legit: 0,       // cliente y CF leyeron snapshots distintos (updateAt diff > 10s). Es STOCK_CHANGED legítimo.
    misma_fuente: 0,     // ambos leyeron mismo snapshot pero computaron distinto. Posible bug §39.
    cliente_viejo: 0,    // el cliente no mandó clientStock (SW stale pre-v1443). Normal, descartar.
    sin_mismatch: 0,     // tiene clientStock, mismo snapshot, mismo cálculo — STOCK_CHANGED por otro motivo (ej. nuevo pedido mid-flight).
  };

  const classifyEntry = (d) => {
    if (!d.clientSnapshotProvided) return 'cliente_viejo';
    const skus = Array.isArray(d.skuDetails) ? d.skuDetails : [];
    const anyMismatch = skus.some((sd) => sd.mismatch && (sd.mismatch.libre || sd.mismatch.utilizablePara || sd.mismatch.fisicoDep11));
    if (!anyMismatch) return 'sin_mismatch';
    // Hay mismatch — ver si snapshots difieren por timing
    const serverAt = d.serverSnapshotUpdatedAt ? Date.parse(d.serverSnapshotUpdatedAt) : null;
    const clientAt = d.clientSnapshotUpdatedAt ? Date.parse(d.clientSnapshotUpdatedAt) : null;
    if (serverAt && clientAt) {
      const diffMs = Math.abs(serverAt - clientAt);
      if (diffMs > 10_000) return 'race_legit';
    }
    return 'misma_fuente';
  };

  const miesmaFuenteEntries = [];

  docs.forEach((d) => {
    const ts = d.timestamp && d.timestamp.toDate ? d.timestamp.toDate().toISOString() : '?';
    const draft = (d.draftId || '').substring(0, 20).padEnd(20);
    const cardCode = (d.cardCode || '').padEnd(12);
    const skus = Array.isArray(d.skuDetails) ? d.skuDetails.length : 0;
    const totalBo = d.totalUnitsToBO || 0;
    const email = (d.userEmail || '').substring(0, 25).padEnd(25);
    const hasClient = d.clientSnapshotProvided ? 'SÍ' : 'NO';
    console.log(
      `${ts}  | ${draft} | ${cardCode} | ${String(skus).padStart(4)} | ${String(totalBo).padStart(8)} | ${email} | ${hasClient}`
    );

    const category = classifyEntry(d);
    cat[category]++;
    if (category === 'misma_fuente') miesmaFuenteEntries.push(d);

    if (Array.isArray(d.skuDetails)) {
      for (const sd of d.skuDetails) {
        skuCounts[sd.sku] = (skuCounts[sd.sku] || 0) + 1;
        if (sd.mismatch && (sd.mismatch.libre || sd.mismatch.utilizablePara || sd.mismatch.fisicoDep11)) {
          divergencesCount++;
          divergences.push({
            ts,
            draftId: d.draftId,
            cardCode: d.cardCode,
            sku: sd.sku,
            pediste: sd.pediste,
            server: sd.server,
            client: sd.client,
            mismatch: sd.mismatch,
            category,
            serverSnapshotUpdatedAt: d.serverSnapshotUpdatedAt,
            clientSnapshotUpdatedAt: d.clientSnapshotUpdatedAt,
          });
        }
      }
    }
    cardCodeCounts[d.cardCode || 'unknown'] = (cardCodeCounts[d.cardCode || 'unknown'] || 0) + 1;
    userCounts[d.userEmail || 'unknown'] = (userCounts[d.userEmail || 'unknown'] || 0) + 1;

    if (full) {
      console.log(JSON.stringify(d, null, 2));
      console.log('---');
    }
  });

  console.log('\n=== RESUMEN ===\n');
  console.log('Total rejections STOCK_CHANGED:', docs.length);
  console.log(`Divergencias cliente↔CF (per-SKU): ${divergencesCount}`);

  console.log('\n=== CLASIFICACIÓN POR ROOT CAUSE ===\n');
  console.log(`  cliente_viejo (SW stale sin clientStock)      : ${cat.cliente_viejo}`);
  console.log(`  sin_mismatch  (clientStock ok, sin divergencia): ${cat.sin_mismatch}`);
  console.log(`  race_legit    (snapshots cliente/CF > 10s diff): ${cat.race_legit}`);
  console.log(`  misma_fuente  (CANDIDATOS BUG §39)             : ${cat.misma_fuente}`);

  const topSkus = Object.entries(skuCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('\nTOP 10 SKUs rechazados:');
  for (const [sku, count] of topSkus) {
    console.log(`  ${count}x ${sku}`);
  }

  const topCards = Object.entries(cardCodeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('\nTOP 10 clientes afectados:');
  for (const [cc, count] of topCards) {
    console.log(`  ${count}x ${cc}`);
  }

  const topUsers = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('\nTOP 10 usuarios afectados:');
  for (const [u, count] of topUsers) {
    console.log(`  ${count}x ${u}`);
  }

  if (divergences.length > 0) {
    console.log('\n=== DIVERGENCIAS cliente ≠ CF (candidatos a §39 unificación) ===\n');
    for (const dv of divergences.slice(0, 20)) {
      console.log(`[${dv.ts}] ${dv.cardCode} ${dv.sku} pediste=${dv.pediste} category=${dv.category}`);
      console.log(`  CLIENTE: ${JSON.stringify(dv.client)}`);
      console.log(`  SERVER:  ${JSON.stringify(dv.server)}`);
      console.log(`  MISMATCH: ${JSON.stringify(dv.mismatch)}`);
      console.log(`  serverSnapshot=${dv.serverSnapshotUpdatedAt}  clientSnapshot=${dv.clientSnapshotUpdatedAt}`);
      console.log('');
    }
    if (divergences.length > 20) {
      console.log(`... ${divergences.length - 20} divergencias más (usar --full para ver todas).`);
    }
  } else {
    console.log('\n✓ Cero divergencias cliente↔CF. CF rechaza por cambio real de stock, no por bug §39.');
  }

  console.log('\n=== VEREDICTO ===');
  if (cat.misma_fuente > 0) {
    console.log(`BUG §39 CANDIDATO: ${cat.misma_fuente} entries con misma fuente + mismatch. Revisar divergencias para confirmar.`);
  } else {
    console.log('NO HAY BUG §39: todos los rechazos son race_legit, cliente_viejo o sin_mismatch.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
