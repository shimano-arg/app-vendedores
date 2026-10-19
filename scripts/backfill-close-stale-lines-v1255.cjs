/**
 * backfill-close-stale-lines-v1255.cjs — 2026-10-19
 *
 * Fix one-off para el bug CUDC201XG reportado por Mariano 2026-10-19:
 * modal Backorder del CRM sumaba 71u contra 59u del PBI/SAP para CUDC201XG.
 * Diff = 12u en 6 lineas state='confirmed' qtyOpen>0 dentro de pedidos
 * con paidStatus='paid' / sapEstado='COBRADO_COMPLETO'. SAP cerro bien, app
 * dejo lineas colgadas.
 *
 * Este script walkea TODOS los pedidos con paidStatus='paid' y aplica el
 * mismo helper puro `computeStaleLineClosure` para limpiar las colgadas.
 * El helper tambien ya quedo integrado en el sync periodico (CF
 * `syncSapPaymentsScheduled`), entonces los pedidos nuevos que caigan
 * en esta situacion se autocuran en 15 minutos. Este backfill es solo
 * para los existentes.
 *
 * Uso:
 *   node scripts/backfill-close-stale-lines-v1255.cjs           # dry-run (default)
 *   node scripts/backfill-close-stale-lines-v1255.cjs --commit  # aplica
 *
 * Requiere: ~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json
 *
 * Precedente: ver header de functions/core/close-stale-lines-on-cobrado-core.js
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const COMMIT = process.argv.includes('--commit');
const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

// Replica del helper puro (mismo algoritmo que functions/core/close-stale-lines-on-cobrado-core.js).
// Copiado inline para no tener que lidiar con ESM/CJS mismatch en Node.
const CLOSEABLE_STATES = new Set(['confirmed', 'ASIG']);

function computeStaleLineClosure(pedido, nowIso) {
  if (!pedido) return { closedLines: [], newLines: null };
  if (pedido.paidStatus !== 'paid') return { closedLines: [], newLines: null };
  const lines = Array.isArray(pedido.lines) ? pedido.lines : null;
  if (!lines || lines.length === 0) return { closedLines: [], newLines: null };

  const closedLines = [];
  const newLines = lines.map((line, idx) => {
    if (!line || typeof line !== 'object') return line;
    const state = line.state;
    if (!CLOSEABLE_STATES.has(state)) return line;
    const qtyOpen = Number(line.qtyOpen) || 0;
    if (qtyOpen <= 0) return line;
    closedLines.push({
      idx,
      code: typeof line.code === 'string' ? line.code : null,
      state,
      qtyClosed: qtyOpen,
    });
    return {
      ...line,
      qtyOpen: 0,
      qtyCancelled: (Number(line.qtyCancelled) || 0) + qtyOpen,
      state: 'closed_stale',
      closedStaleAt: nowIso,
      closedStaleReason: 'pedido_paid_full_line_stale',
    };
  });
  if (closedLines.length === 0) return { closedLines: [], newLines: null };
  return { closedLines, newLines };
}

async function main() {
  console.log('===== v1255 BACKFILL: cerrar lineas colgadas en pedidos paid=full =====');
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN (sin --commit no toca nada)'}\n`);

  // Query: todos los pedidos con paidStatus='paid'. Incluye los closedAt tambien,
  // porque la basura puede estar en pedidos ya "cerrados" pero con lineas sueltas.
  const snap = await db.collection('pedidos').where('paidStatus', '==', 'paid').get();
  console.log(`Pedidos paid=full escaneados: ${snap.size}\n`);

  const nowIso = new Date().toISOString();
  const toApply = []; // { pedidoId, data, closure }
  let totalLines = 0;
  let totalU = 0;
  const bySku = new Map();
  const byClient = new Map();

  snap.forEach((doc) => {
    const data = doc.data();
    const closure = computeStaleLineClosure(data, nowIso);
    if (closure.newLines !== null) {
      toApply.push({ pedidoId: doc.id, data, closure });
      for (const c of closure.closedLines) {
        totalLines++;
        totalU += c.qtyClosed;
        const sku = c.code || '(sin code)';
        bySku.set(sku, (bySku.get(sku) || 0) + c.qtyClosed);
        const cli = data.clientName || '(sin cliente)';
        byClient.set(cli, (byClient.get(cli) || 0) + c.qtyClosed);
      }
    }
  });

  console.log(`Pedidos con lineas a cerrar: ${toApply.length}`);
  console.log(`Lineas a cerrar: ${totalLines}`);
  console.log(`Unidades a cerrar: ${totalU}\n`);

  // Top 20 SKUs
  const topSku = [...bySku.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('Top SKUs con mas unidades a cerrar:');
  for (const [sku, u] of topSku) {
    console.log(`  ${sku.padEnd(20)}  ${u}`);
  }
  console.log();
  // Top 20 clientes
  const topCli = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('Top clientes con mas unidades a cerrar:');
  for (const [cli, u] of topCli) {
    console.log(`  ${cli.substring(0, 50).padEnd(50)}  ${u}`);
  }
  console.log();

  // Detalle CUDC201XG (sanity check contra el reporte del user)
  console.log('--- SANITY CUDC201XG (reporte original: 12u en 6 lineas) ---');
  const cudc = toApply
    .flatMap((x) =>
      x.closure.closedLines
        .filter((c) => c.code === 'CUDC201XG')
        .map((c) => ({
          pedidoId: x.pedidoId,
          cliente: x.data.clientName,
          vendor: x.data.ownerVendor,
          qty: c.qtyClosed,
        })),
    );
  console.log(`CUDC201XG lineas detectadas: ${cudc.length}, total u: ${cudc.reduce((s, x) => s + x.qty, 0)}`);
  for (const c of cudc) {
    console.log(`  ${c.pedidoId}  ${c.cliente?.substring(0, 35)}  vendor=${c.vendor}  qty=${c.qty}`);
  }
  console.log();

  if (!COMMIT) {
    console.log('🟢 Dry-run. Para aplicar: node scripts/backfill-close-stale-lines-v1255.cjs --commit');
    process.exit(0);
  }

  // COMMIT path — batched updates con checkpoint para auditoria.
  // Fix silent-failure hunter #3: imprimir pedidoIds por batch ANTES del commit
  // y envolver cada commit en try/catch para no abortar todo el run por un
  // batch fallido. El helper es idempotente — re-correr saltea los ya aplicados
  // (porque `state='closed_stale'` ya no matchea CLOSEABLE_STATES).
  console.log('🔴 Aplicando updates...');
  const BATCH_SIZE = 400; // Firestore limit 500 ops/batch
  let batch = db.batch();
  let batchCount = 0;
  let batchIds = [];
  let applied = 0;
  let failedBatches = 0;
  let batchNum = 0;

  async function flush() {
    if (batchCount === 0) return;
    batchNum++;
    console.log(`  batch #${batchNum} (${batchCount} pedidos): ${batchIds.slice(0, 5).join(', ')}${batchIds.length > 5 ? ', +...' : ''}`);
    try {
      await batch.commit();
      applied += batchCount;
      console.log(`  ✓ commit batch #${batchNum} ok (acumulado: ${applied}/${toApply.length})`);
    } catch (e) {
      failedBatches++;
      console.error(`  ✗ commit batch #${batchNum} FALLO: ${e.message}`);
      console.error(`    pedidoIds del batch (re-correr script para reintentar):\n    ${batchIds.join('\n    ')}`);
    }
    batch = db.batch();
    batchCount = 0;
    batchIds = [];
  }

  for (const { pedidoId, data, closure } of toApply) {
    const prevLog = Array.isArray(data.staleLinesLog) ? data.staleLinesLog : [];
    batch.update(db.collection('pedidos').doc(pedidoId), {
      lines: closure.newLines,
      staleLinesClosedAt: nowIso,
      staleLinesLog: [
        ...prevLog.slice(-9),
        {
          at: nowIso,
          closed: closure.closedLines,
          reason: 'pedido_paid_full_line_stale',
          source: 'backfill_v1281',
        },
      ],
    });
    batchCount++;
    batchIds.push(pedidoId);
    if (batchCount >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  console.log(`\n✅ Resultado:`);
  console.log(`   Pedidos actualizados: ${applied}/${toApply.length}`);
  console.log(`   Lineas cerradas: ${totalLines}`);
  console.log(`   Unidades: ${totalU}`);
  console.log(`   Batches fallidos: ${failedBatches}`);
  if (failedBatches > 0) {
    console.log(`\n⚠️  ${failedBatches} batches fallaron. Re-correr este script con --commit es seguro (idempotente).`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
