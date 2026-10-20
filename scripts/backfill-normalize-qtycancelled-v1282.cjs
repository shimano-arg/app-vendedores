/**
 * backfill-normalize-qtycancelled-v1282.cjs — 2026-10-20
 *
 * Fix de higiene de datos sobre backfill v1281 (CUDC201XG bug audit).
 *
 * Agent #3 (silent-failure review post-deploy v1281) detecto 4 lineas donde
 * la invariante qty = qtyInvoiced + qtyOpen + qtyCancelled + qtyRecycled
 * NO cierra porque qtyOpen original era > qty (dato sucio pre-existente de
 * pedidos ASIG oficina). El backfill v1281 transfirio qtyOpen -> qtyCancelled
 * fielmente, pero esto preserva el exceso.
 *
 * Fix: clamp qtyCancelled = min(qtyCancelled, qty - qtyInvoiced - qtyRecycled).
 * Esto reduce el excess sin tocar qtyInvoiced (real) ni qtyRecycled (real).
 *
 * Scope: iterar pedidos con lineas state='closed_stale' y validar la
 * invariante. Solo tocar las que violan. Idempotente.
 *
 * Uso:
 *   node scripts/backfill-normalize-qtycancelled-v1282.cjs           # dry-run
 *   node scripts/backfill-normalize-qtycancelled-v1282.cjs --commit  # aplica
 *
 * Requiere: ~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const COMMIT = process.argv.includes('--commit');
const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  console.log('===== v1282 BACKFILL: normalizar qtyCancelled en lineas closed_stale =====');
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  // Query: pedidos con staleLinesClosedAt (backfill v1281 touched them)
  const snap = await db.collection('pedidos').where('staleLinesClosedAt', '!=', null).get();
  console.log(`Pedidos escaneados (con staleLinesClosedAt): ${snap.size}\n`);

  const nowIso = new Date().toISOString();
  const toApply = []; // { pedidoId, newLines, violations }

  snap.forEach((doc) => {
    const data = doc.data();
    const lines = Array.isArray(data.lines) ? data.lines : null;
    if (!lines) return;

    const violations = [];
    const newLines = lines.map((line, idx) => {
      if (!line || line.state !== 'closed_stale') return line;
      const qty = Number(line.qty) || 0;
      const qtyInvoiced = Number(line.qtyInvoiced) || 0;
      const qtyRecycled = Number(line.qtyRecycled) || 0;
      const qtyCancelledActual = Number(line.qtyCancelled) || 0;
      const qtyOpen = Number(line.qtyOpen) || 0;
      const sum = qtyInvoiced + qtyOpen + qtyCancelledActual + qtyRecycled;
      if (sum === qty) return line; // invariante OK

      // Violacion: clamp qtyCancelled al maximo logico
      const qtyCancelledClamped = Math.max(0, qty - qtyInvoiced - qtyRecycled - qtyOpen);
      violations.push({
        idx,
        code: line.code || null,
        qty,
        qtyInvoiced,
        qtyRecycled,
        qtyOpen,
        qtyCancelledBefore: qtyCancelledActual,
        qtyCancelledAfter: qtyCancelledClamped,
      });
      return {
        ...line,
        qtyCancelled: qtyCancelledClamped,
        normalizedQtyCancelledAt: nowIso,
        normalizedQtyCancelledReason: 'invariante_qty_sum_fix_v1282',
        qtyCancelledOriginal: qtyCancelledActual, // audit trail
      };
    });

    if (violations.length > 0) {
      toApply.push({ pedidoId: doc.id, data, newLines, violations });
    }
  });

  console.log(`Pedidos con violaciones: ${toApply.length}`);
  const totalLines = toApply.reduce((n, x) => n + x.violations.length, 0);
  console.log(`Lineas a normalizar: ${totalLines}\n`);

  if (toApply.length === 0) {
    console.log('✅ No hay violaciones. Nada que hacer.');
    process.exit(0);
  }

  // Detalle
  console.log('--- DETALLE DE VIOLACIONES ---');
  for (const { pedidoId, data, violations } of toApply) {
    console.log(`\nPedido ${pedidoId} (${data.clientName || '(sin cliente)'}, ownerVendor=${data.ownerVendor || '-'}):`);
    for (const v of violations) {
      console.log(`  idx=${v.idx} code=${v.code}  qty=${v.qty} invoiced=${v.qtyInvoiced} recycled=${v.qtyRecycled} open=${v.qtyOpen}  qtyCancelled: ${v.qtyCancelledBefore} → ${v.qtyCancelledAfter}`);
    }
  }

  if (!COMMIT) {
    console.log('\n🟢 Dry-run. Para aplicar: node scripts/backfill-normalize-qtycancelled-v1282.cjs --commit');
    process.exit(0);
  }

  // COMMIT
  console.log('\n🔴 Aplicando updates...');
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;
  let applied = 0;
  let failed = 0;

  async function flush() {
    if (batchCount === 0) return;
    try {
      await batch.commit();
      applied += batchCount;
      console.log(`  ✓ commit batch (${batchCount} pedidos, acumulado: ${applied}/${toApply.length})`);
    } catch (e) {
      failed += batchCount;
      console.error(`  ✗ commit batch FALLO: ${e.message}`);
    }
    batch = db.batch();
    batchCount = 0;
  }

  for (const { pedidoId, data, newLines, violations } of toApply) {
    const prevLog = Array.isArray(data.normalizeQtyCancelledLog) ? data.normalizeQtyCancelledLog : [];
    batch.update(db.collection('pedidos').doc(pedidoId), {
      lines: newLines,
      normalizeQtyCancelledAt: nowIso,
      normalizeQtyCancelledLog: [
        ...prevLog.slice(-9),
        {
          at: nowIso,
          violations,
          reason: 'invariante_qty_sum_fix_v1282',
          source: 'backfill_v1282',
        },
      ],
    });
    batchCount++;
    if (batchCount >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`\n✅ Resultado: ${applied} pedidos actualizados / ${totalLines} lineas normalizadas. Fallidos: ${failed}`);
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
