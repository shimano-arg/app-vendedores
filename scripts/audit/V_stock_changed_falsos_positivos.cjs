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

  const snap = await db
    .collection('operations_log')
    .where('type', '==', 'commit_pedido_rejected')
    .where('errorCode', '==', 'STOCK_CHANGED')
    .where('timestamp', '>=', since)
    .orderBy('timestamp', 'desc')
    .get();

  if (snap.empty) {
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
  let divergencesCount = 0;
  const divergences = [];

  snap.forEach((doc) => {
    const d = doc.data();
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
          });
        }
      }
    }
    cardCodeCounts[d.cardCode || 'unknown'] = (cardCodeCounts[d.cardCode || 'unknown'] || 0) + 1;

    if (full) {
      console.log(JSON.stringify(d, null, 2));
      console.log('---');
    }
  });

  console.log('\n=== RESUMEN ===\n');
  console.log('Total rejections:', snap.size);
  console.log(`Divergencias cliente↔CF: ${divergencesCount} (de ${snap.size} rejections)`);

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

  if (divergences.length > 0) {
    console.log('\n=== DIVERGENCIAS cliente ≠ CF (candidatos a §39 unificación) ===\n');
    for (const dv of divergences.slice(0, 20)) {
      console.log(`[${dv.ts}] ${dv.cardCode} ${dv.sku} pediste=${dv.pediste}`);
      console.log(`  CLIENTE: ${JSON.stringify(dv.client)}`);
      console.log(`  SERVER:  ${JSON.stringify(dv.server)}`);
      console.log(`  MISMATCH: ${JSON.stringify(dv.mismatch)}`);
      console.log('');
    }
    if (divergences.length > 20) {
      console.log(`... ${divergences.length - 20} divergencias más (usar --full para ver todas).`);
    }
  } else {
    console.log('\n✓ Cero divergencias cliente↔CF. CF rechaza por cambio real de stock, no por bug §39.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
