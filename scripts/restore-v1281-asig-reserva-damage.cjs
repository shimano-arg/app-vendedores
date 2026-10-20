/**
 * restore-v1281-asig-reserva-damage.cjs — 2026-10-20 (v1285).
 *
 * BUG CRÍTICO: el fix v1281 (close-stale-lines-on-cobrado) cerró 78 líneas
 * con asigReserva=true en el backfill del 2026-10-20, liberando stock que
 * estaba reservado firme a clientes vía reparto manual.
 *
 * Reportado por Mariano 2026-10-20: SUSANA GRACIELA ANDRILI ORDEN 446
 * "Crear Pedido Desde Backorder" aparece sin stock porque sus 2 líneas ASIG
 * firmes (127082 + CU301HGK) en el pedido 389 fueron cerradas.
 *
 * Este script revierte las líneas afectadas:
 *   state='closed_stale' + asigReserva=true  →  state='ASIG' (restaurado)
 *   qtyOpen=0 + qtyCancelled sumó qtyClosed  →  qtyOpen=qtyClosed + qtyCancelled restado
 *
 * Lee el audit trail staleLinesLog para saber exactamente qtyClosed por línea.
 *
 * Uso:
 *   node scripts/restore-v1281-asig-reserva-damage.cjs           # dry-run
 *   node scripts/restore-v1281-asig-reserva-damage.cjs --commit  # aplica
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const COMMIT = process.argv.includes('--commit');
const SA_KEY = path.join(
  os.homedir(),
  'Downloads',
  'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
);

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  console.log('===== v1285 RESTORE: líneas asigReserva=true cerradas por v1281 =====');
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  const snap = await db.collection('pedidos').get();
  console.log(`Pedidos escaneados: ${snap.size}`);

  const toRestore = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    // Buscar lineas asigReserva=true + state=closed_stale (víctimas v1281).
    const victims = [];
    lines.forEach((line, idx) => {
      if (line && line.state === 'closed_stale' && line.asigReserva === true) {
        victims.push({ idx, line });
      }
    });
    if (victims.length === 0) return;

    // Para cada victim buscar su qtyClosed en staleLinesLog[*].closed[].
    const logs = Array.isArray(data.staleLinesLog) ? data.staleLinesLog : [];
    const restores = [];
    for (const { idx, line } of victims) {
      let qtyClosed = 0;
      let originalState = 'ASIG'; // default
      // Buscar en todos los log entries (puede estar en el último o en cualquier previo).
      for (const logEntry of logs) {
        const closedArr = Array.isArray(logEntry.closed) ? logEntry.closed : [];
        for (const c of closedArr) {
          if (c.idx === idx && c.code === line.code) {
            qtyClosed = c.qtyClosed || qtyClosed;
            originalState = c.state || originalState;
          }
        }
      }
      if (qtyClosed === 0) {
        console.warn(`  ⚠ pedido ${doc.id} idx=${idx} sku=${line.code}: NO encontré qtyClosed en staleLinesLog — SKIP`);
        continue;
      }
      restores.push({ idx, line, qtyClosed, originalState });
    }
    if (restores.length === 0) return;

    toRestore.push({ docId: doc.id, data, restores });
  });

  const totalLines = toRestore.reduce((s, r) => s + r.restores.length, 0);
  console.log(`Pedidos con víctimas: ${toRestore.length}`);
  console.log(`Líneas a restaurar: ${totalLines}`);
  console.log();

  // Detalle primeros 30
  console.log('--- Primeros 30 restores ---');
  let shown = 0;
  for (const { docId, data, restores } of toRestore) {
    for (const r of restores) {
      if (shown >= 30) break;
      console.log(`  ord#${data.orderNumber || '?'} ${String(data.clientName || '').substring(0, 32).padEnd(32)} idx=${r.idx} ${r.line.code}: state closed_stale→${r.originalState}, qtyOpen 0→${r.qtyClosed}, qtyCancelled ${r.line.qtyCancelled}→${(r.line.qtyCancelled || 0) - r.qtyClosed}`);
      shown++;
    }
    if (shown >= 30) break;
  }
  console.log();

  if (!COMMIT) {
    console.log(`🟢 Dry-run. ${toRestore.length} pedidos / ${totalLines} líneas serían restauradas. Para aplicar: --commit`);
    process.exit(0);
  }

  console.log('🔴 Aplicando restores...');
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;
  let applied = 0;
  const nowIso = new Date().toISOString();

  for (const { docId, data, restores } of toRestore) {
    const newLines = (data.lines || []).map((line, idx) => line);
    for (const r of restores) {
      const current = newLines[r.idx] || {};
      newLines[r.idx] = {
        ...current,
        state: r.originalState,
        qtyOpen: r.qtyClosed,
        qtyCancelled: Math.max(0, (Number(current.qtyCancelled) || 0) - r.qtyClosed),
        restoredFromV1281BugAt: nowIso,
        restoredFromV1281BugReason: 'asigReserva=true no debe cerrarse por paid=full',
      };
      // Preservar closedStaleAt/Reason en un campo de audit historial.
      if (current.closedStaleAt) {
        newLines[r.idx].v1281ClosedStaleAt = current.closedStaleAt;
      }
      // Limpiar los flags closed_stale.
      delete newLines[r.idx].closedStaleAt;
      delete newLines[r.idx].closedStaleReason;
    }
    const prevLog = Array.isArray(data.restoreV1281Log) ? data.restoreV1281Log : [];
    batch.update(db.collection('pedidos').doc(docId), {
      lines: newLines,
      restoreV1281At: nowIso,
      restoreV1281Log: [
        ...prevLog.slice(-4),
        { at: nowIso, restored: restores.map((r) => ({ idx: r.idx, code: r.line.code, qty: r.qtyClosed, originalState: r.originalState })) },
      ],
    });
    count++;
    if (count >= BATCH_SIZE) {
      await batch.commit();
      applied += count;
      console.log(`  ✓ commit ${applied}/${toRestore.length}`);
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
    applied += count;
  }
  console.log(`\n✅ Restored ${applied} pedidos / ${totalLines} líneas asigReserva=true.`);
  console.log('⚠ Nota: el stock físico puede haber sido tomado por otros clientes en el ínterin. Revisá modal Stock Asignado + conflictos.');
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
