// BY (incidente Federico 2026-11-20, v1568+) — auditoría READ-ONLY de pedidos
// app_only con reason='sap_item_not_found_all_lines' que están esperando
// reconciliación automática (reconcilePedidosAppOnlyCF).
//
// Clasifica cada pedido en un bucket:
//   APTO_PARA_RECONCILE     — todos los missingSkus ya están en catálogo
//                             → próxima corrida del scheduler los re-dispara.
//   STILL_MISSING           — al menos 1 SKU todavía no tiene alta SAP.
//   MAX_RETRIES             — reconcileAttempts >= 5 (admin tiene que revisar).
//   CERRADO                 — closedAt != null, no se toca.
//   YA_TIENE_DOCNUM         — transferidoSAP.docNum presente, no corresponde.
//   SKIPPED_NON_CATALOG_REASON — otros `app_only` (SKIP_ALL_BO, degraded, etc.).
//
// Uso:
//   node scripts/audit/BY_recover_app_only_pedidos.cjs                      (dry-run default)
//   node scripts/audit/BY_recover_app_only_pedidos.cjs --dry-run-recovery  (propone acciones)
//
// NO existe --apply. Para ejecutar reconciliación real, usar el scheduler:
//   gcloud scheduler jobs run firebase-schedule-reconcilePedidosAppOnlyCF \
//     --project=app-vendedores-shimano \
//     --location=southamerica-east1
//
// Output: CSV + MD en docs/auditoria/ con timestamp.

const fs = require('node:fs');
const path = require('node:path');

const PROJECT = 'app-vendedores-shimano';
const MAX_ATTEMPTS = 5;

function parseQuantities(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    const map = new Map();
    for (const [k, v] of Object.entries(parsed)) {
      if (!k) continue;
      map.set(String(k).toUpperCase(), Number(v) || 0);
    }
    return map;
  } catch (_e) {
    return null;
  }
}

function classifyPedido(pedido, quantitiesMap) {
  const tSAP = pedido.transferidoSAP || {};
  if (pedido.closedAt) return { bucket: 'CERRADO', reason: 'closedAt set' };
  if (tSAP.docNum != null) return { bucket: 'YA_TIENE_DOCNUM', reason: `docNum=${tSAP.docNum}` };
  if (tSAP.reason !== 'sap_item_not_found_all_lines') {
    return {
      bucket: 'SKIPPED_NON_CATALOG_REASON',
      reason: `reason=${tSAP.reason || '(empty)'}`,
    };
  }
  const attempts = Number(tSAP.reconcileAttempts || 0);
  if (attempts >= MAX_ATTEMPTS) {
    return {
      bucket: 'MAX_RETRIES',
      reason: `attempts=${attempts}/${MAX_ATTEMPTS}`,
    };
  }
  const missingSkus = Array.isArray(tSAP.missingSkus) ? tSAP.missingSkus : [];
  if (missingSkus.length === 0) {
    return { bucket: 'STILL_MISSING', reason: 'missingSkus vacío (defensivo)' };
  }
  if (!quantitiesMap) {
    return { bucket: 'STILL_MISSING', reason: 'snapshot no disponible' };
  }
  const stillMissing = missingSkus.filter((s) => !quantitiesMap.has(String(s || '').toUpperCase()));
  if (stillMissing.length > 0) {
    return {
      bucket: 'STILL_MISSING',
      reason: `faltan: ${stillMissing.join(', ')}`,
      stillMissing,
    };
  }
  return {
    bucket: 'APTO_PARA_RECONCILE',
    reason: `todos los SKUs (${missingSkus.length}) ya en catálogo`,
  };
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const argv = process.argv.slice(2);
  const dryRunRecovery = argv.includes('--dry-run-recovery');
  if (argv.includes('--apply')) {
    console.error('ERROR: --apply NO soportado por este script.');
    console.error('');
    console.error('Para reconciliar, correr el scheduler:');
    console.error('  gcloud scheduler jobs run firebase-schedule-reconcilePedidosAppOnlyCF \\');
    console.error('    --project=app-vendedores-shimano \\');
    console.error('    --location=southamerica-east1');
    process.exit(2);
  }

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('BY — Auditoría pedidos app_only recuperables');
  console.log('================================================================');
  console.log(`Project: ${PROJECT}`);
  console.log(`Timestamp: ${nowIso}`);
  console.log(`Mode: ${dryRunRecovery ? 'DRY-RUN-RECOVERY (propone)' : 'DRY-RUN (listar)'}`);
  console.log();

  // 1. Snapshot.
  console.log('[1/3] Leyendo app_config/stock_snapshot...');
  const ssSnap = await db.doc('app_config/stock_snapshot').get();
  if (!ssSnap.exists) {
    console.error('   ERROR: stock_snapshot no existe.');
    process.exit(2);
  }
  const snapshotData = ssSnap.data() || {};
  const quantitiesMap = parseQuantities(snapshotData.quantities);
  const skuCount = quantitiesMap ? quantitiesMap.size : 0;
  let snapshotAgeMinutes = null;
  if (snapshotData.updatedAt) {
    const ua = snapshotData.updatedAt;
    let ms = null;
    if (typeof ua.toMillis === 'function') ms = ua.toMillis();
    else if (ua instanceof Date) ms = ua.getTime();
    else if (typeof ua.seconds === 'number') ms = ua.seconds * 1000;
    if (ms !== null) snapshotAgeMinutes = Math.floor((Date.now() - ms) / 60_000);
  }
  console.log(
    `   OK — ${skuCount} SKUs en catálogo. Snapshot ${snapshotAgeMinutes !== null ? snapshotAgeMinutes + ' min atrás' : 'sin updatedAt'}.`
  );
  if (snapshotAgeMinutes !== null && snapshotAgeMinutes > 30) {
    console.warn(`   WARN: snapshot stale (>30 min). El reconcile CF hará fail-open.`);
  }
  console.log();

  // 2. Query pedidos con requiresManualResend=true.
  console.log('[2/3] Leyendo pedidos con transferidoSAP.requiresManualResend=true...');
  const qs = await db
    .collection('pedidos')
    .where('transferidoSAP.requiresManualResend', '==', true)
    .get();
  console.log(`   Encontrados: ${qs.size} pedidos.`);
  console.log();

  // 3. Clasificar.
  const buckets = {
    APTO_PARA_RECONCILE: [],
    STILL_MISSING: [],
    MAX_RETRIES: [],
    CERRADO: [],
    YA_TIENE_DOCNUM: [],
    SKIPPED_NON_CATALOG_REASON: [],
  };
  qs.forEach((d) => {
    const pedido = d.data() || {};
    const c = classifyPedido(pedido, quantitiesMap);
    buckets[c.bucket].push({
      pedidoId: d.id,
      cardCode: pedido.clientCardCode || '',
      clientName: pedido.clientName || '',
      orderNumber: pedido.orderNumber || '',
      stage: pedido.stage || '',
      missingSkus: (pedido.transferidoSAP && pedido.transferidoSAP.missingSkus) || [],
      reconcileAttempts: (pedido.transferidoSAP && pedido.transferidoSAP.reconcileAttempts) || 0,
      reason: c.reason,
      stillMissing: c.stillMissing || [],
    });
  });

  console.log('[3/3] Clasificación:');
  for (const [bucket, items] of Object.entries(buckets)) {
    console.log(`   ${bucket.padEnd(28)}: ${items.length}`);
  }
  console.log();

  // 4. Output archivos.
  const docsDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const ts = nowIso.replace(/[:.]/g, '-').slice(0, 19);

  // CSV
  const csvPath = path.join(docsDir, `BY_app_only_audit_${ts}.csv`);
  const csvRows = [['bucket', 'pedidoId', 'cardCode', 'clientName', 'orderNumber', 'stage', 'missingSkus', 'reconcileAttempts', 'reason', 'stillMissing']];
  for (const [bucket, items] of Object.entries(buckets)) {
    for (const r of items) {
      csvRows.push([
        bucket,
        r.pedidoId,
        r.cardCode,
        r.clientName,
        String(r.orderNumber || ''),
        r.stage,
        r.missingSkus.join(';'),
        String(r.reconcileAttempts),
        r.reason,
        r.stillMissing.join(';'),
      ]);
    }
  }
  fs.writeFileSync(
    csvPath,
    csvRows
      .map((row) =>
        row.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')
      )
      .join('\n'),
    'utf8'
  );
  console.log(`CSV: ${csvPath}`);

  // MD
  const mdPath = path.join(docsDir, `BY_app_only_audit_${ts}.md`);
  const md = [];
  md.push(`# BY — Auditoría pedidos app_only recuperables`);
  md.push('');
  md.push(`- **Timestamp**: ${nowIso}`);
  md.push(`- **Mode**: ${dryRunRecovery ? 'DRY-RUN-RECOVERY' : 'DRY-RUN'}`);
  md.push(`- **Snapshot SKUs**: ${skuCount}`);
  md.push(`- **Snapshot age**: ${snapshotAgeMinutes !== null ? snapshotAgeMinutes + ' min' : 'desconocido'}`);
  md.push(`- **Total pedidos con requiresManualResend=true**: ${qs.size}`);
  md.push('');
  md.push('## Resumen por bucket');
  md.push('');
  md.push('| Bucket | Count | Siguiente acción |');
  md.push('|---|---|---|');
  const actions = {
    APTO_PARA_RECONCILE: 'Próxima corrida del scheduler reconcilePedidosAppOnlyCF los reenviará.',
    STILL_MISSING: 'Faltan altas SAP de los SKUs listados.',
    MAX_RETRIES: 'Admin debe investigar (5 attempts sin éxito).',
    CERRADO: 'No se toca.',
    YA_TIENE_DOCNUM: 'Ya en SAP — eliminar `requiresManualResend` manualmente.',
    SKIPPED_NON_CATALOG_REASON: 'Otro flow (BO completo / live-SL degraded). El reconcile actual NO los toca.',
  };
  for (const [bucket, items] of Object.entries(buckets)) {
    md.push(`| ${bucket} | ${items.length} | ${actions[bucket] || ''} |`);
  }
  md.push('');

  for (const [bucket, items] of Object.entries(buckets)) {
    if (items.length === 0) continue;
    md.push(`## ${bucket} (${items.length})`);
    md.push('');
    md.push('| pedidoId | cardCode | clientName | missingSkus | attempts | motivo |');
    md.push('|---|---|---|---|---|---|');
    for (const r of items) {
      md.push(
        `| ${r.pedidoId} | ${r.cardCode} | ${r.clientName} | ${r.missingSkus.join(', ')} | ${r.reconcileAttempts} | ${r.reason} |`
      );
    }
    md.push('');
  }

  if (dryRunRecovery && buckets.APTO_PARA_RECONCILE.length > 0) {
    md.push('## Recovery propuesto');
    md.push('');
    md.push(`${buckets.APTO_PARA_RECONCILE.length} pedidos están aptos para reconciliar.`);
    md.push('');
    md.push('Para ejecutar ahora (sin esperar al scheduler cada 15 min):');
    md.push('');
    md.push('```bash');
    md.push('gcloud scheduler jobs run firebase-schedule-reconcilePedidosAppOnlyCF \\');
    md.push('  --project=app-vendedores-shimano \\');
    md.push('  --location=southamerica-east1');
    md.push('```');
    md.push('');
    md.push(
      'El CF tomará lock + borrará `transferidoSAP` → el trigger `onPedidoConfirmedSendToSap` los re-enviará.'
    );
  }

  fs.writeFileSync(mdPath, md.join('\n'), 'utf8');
  console.log(`MD : ${mdPath}`);
  console.log();

  if (dryRunRecovery && buckets.APTO_PARA_RECONCILE.length > 0) {
    console.log('Para ejecutar reconciliación real:');
    console.log('  gcloud scheduler jobs run firebase-schedule-reconcilePedidosAppOnlyCF \\');
    console.log('    --project=app-vendedores-shimano \\');
    console.log('    --location=southamerica-east1');
    console.log();
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
