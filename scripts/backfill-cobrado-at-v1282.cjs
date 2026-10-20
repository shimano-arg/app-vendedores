/**
 * backfill-cobrado-at-v1282.cjs — 2026-10-20
 *
 * Agent #3 post-deploy v1281 detecto 84/124 pedidos backfilleados paid=full
 * SIN cobradoAt ni paidAt. Son pedidos cobrados antes de v1035 (2026-09-22)
 * cuando se introdujo el timestamp. applyPaymentUpdate solo setea cobradoAt
 * si amountsChanged — para pedidos que ya estaban paid cuando el campo
 * aparecio, nunca lo escribio.
 *
 * Impacto UX: columna "Cobrado" del Planner Kanban ordena por cobradoAt (el
 * "hace cuanto esta en Cobrado"). Sin ese timestamp las cards no se ordenan
 * cronologicamente (fallback indefinido).
 *
 * Fix: setear cobradoAt = fallback cronologico:
 *   1. firstInvoicedAt (si existe) — es cuando SAP facturo por primera vez
 *   2. paidSyncedAt (si existe) — es cuando el sync detecto el pago
 *   3. updatedAt (fallback) — ultima vez que algo paso en el pedido
 *   4. createdAt (ultimo recurso) — fecha de alta
 *
 * Scope: pedidos con paidStatus in {'paid','partial'} AND !cobradoAt.
 * Idempotente: segunda corrida es no-op.
 *
 * Uso:
 *   node scripts/backfill-cobrado-at-v1282.cjs           # dry-run
 *   node scripts/backfill-cobrado-at-v1282.cjs --commit  # aplica
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const COMMIT = process.argv.includes('--commit');
const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  // Firestore Timestamp
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return null;
}

function pickFallback(data) {
  const sources = [
    { field: 'firstInvoicedAt', value: toIsoString(data.firstInvoicedAt) },
    { field: 'paidSyncedAt', value: toIsoString(data.paidSyncedAt) },
    { field: 'updatedAt', value: toIsoString(data.updatedAt) },
    { field: 'createdAt', value: toIsoString(data.createdAt) },
  ];
  for (const s of sources) {
    if (s.value) return s;
  }
  return { field: null, value: null };
}

async function main() {
  console.log('===== v1282 BACKFILL: cobradoAt faltante en pedidos paid =====');
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  // Pedidos con paidStatus NOT null (paid o partial)
  const [paidSnap, partialSnap] = await Promise.all([
    db.collection('pedidos').where('paidStatus', '==', 'paid').get(),
    db.collection('pedidos').where('paidStatus', '==', 'partial').get(),
  ]);
  console.log(`Pedidos escaneados: ${paidSnap.size} paid + ${partialSnap.size} partial = ${paidSnap.size + partialSnap.size}\n`);

  const toApply = [];
  const byFallback = { firstInvoicedAt: 0, paidSyncedAt: 0, updatedAt: 0, createdAt: 0, none: 0 };

  const processDoc = (doc) => {
    const data = doc.data();
    if (data.cobradoAt) return; // ya tiene, idempotente
    const { field, value } = pickFallback(data);
    byFallback[field || 'none']++;
    if (!value) return; // ningun fallback disponible — no tocamos
    toApply.push({ pedidoId: doc.id, data, cobradoAt: value, fallbackField: field });
  };

  paidSnap.forEach(processDoc);
  partialSnap.forEach(processDoc);

  console.log(`Pedidos con cobradoAt faltante: ${toApply.length + byFallback.none}`);
  console.log(`  con fallback valido: ${toApply.length}`);
  console.log(`  sin ningun fallback (skip): ${byFallback.none}`);
  console.log();
  console.log('Fallback usado:');
  for (const [k, v] of Object.entries(byFallback)) {
    if (v > 0) console.log(`  ${k}: ${v}`);
  }
  console.log();

  if (toApply.length === 0) {
    console.log('✅ Nada que backfillear.');
    process.exit(0);
  }

  // Sample 10
  console.log('--- SAMPLE (primeros 10) ---');
  for (const r of toApply.slice(0, 10)) {
    console.log(`  ${r.pedidoId}  cliente=${(r.data.clientName || '').substring(0, 30)}  paidStatus=${r.data.paidStatus}  cobradoAt=${r.cobradoAt}  (de ${r.fallbackField})`);
  }
  console.log();

  if (!COMMIT) {
    console.log('🟢 Dry-run. Para aplicar: node scripts/backfill-cobrado-at-v1282.cjs --commit');
    process.exit(0);
  }

  // COMMIT
  console.log('🔴 Aplicando updates...');
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;
  let applied = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  async function flush() {
    if (batchCount === 0) return;
    try {
      await batch.commit();
      applied += batchCount;
      console.log(`  ✓ commit batch (${batchCount}, acumulado: ${applied}/${toApply.length})`);
    } catch (e) {
      failed += batchCount;
      console.error(`  ✗ commit batch FALLO: ${e.message}`);
    }
    batch = db.batch();
    batchCount = 0;
  }

  for (const { pedidoId, cobradoAt, fallbackField } of toApply) {
    batch.update(db.collection('pedidos').doc(pedidoId), {
      cobradoAt,
      cobradoAtBackfilledFrom: fallbackField,
      cobradoAtBackfilledAt: nowIso,
    });
    batchCount++;
    if (batchCount >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`\n✅ Resultado: ${applied} pedidos actualizados. Fallidos: ${failed}`);
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
