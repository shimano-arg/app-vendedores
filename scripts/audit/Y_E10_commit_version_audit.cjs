/**
 * E10 — Audita escrituras legacy a `pedidos` (sin `_commitVersion` del CF).
 *
 * Criterios para activar rules deny-legacy:
 *   (a) 0 pedidos activos (closedAt == null) sin `_commitVersion`.
 *   (b) < 5 pedidos createdAt >= --since sin `_commitVersion` (fallbacks legacy).
 *
 * Si AMBOS → GREEN (seguro cerrar rule).
 * Si NO    → RED (reportar quiénes/qué path código escribe sin pasar por CF).
 *
 * Uso:
 *   node scripts/audit/_E10_vde_versions.cjs --since=2026-10-22T03:00:00Z
 *   node scripts/audit/_E10_vde_versions.cjs --since=2026-10-22T03:00:00Z --full
 *
 * Read-only. Requiere GOOGLE_APPLICATION_CREDENTIALS (ADC) o service account.
 *
 * CLAUDE.md §31 (auditoria != correccion) — este script no modifica nada.
 */

const PROJECT = 'app-vendedores-shimano';

function parseArgs() {
  const args = { since: null, full: false, help: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--full') args.full = true;
    else if (a.startsWith('--since=')) args.since = a.slice('--since='.length);
  }
  return args;
}

function usage() {
  console.log(`
E10 — Audita escrituras legacy a 'pedidos' (sin _commitVersion).

Uso:
  node scripts/audit/_E10_vde_versions.cjs --since=<ISO>
  node scripts/audit/_E10_vde_versions.cjs --since=<ISO> --full

Flags:
  --since=<ISO>   Timestamp ISO desde cuando contar fallbacks legacy (ej. 2026-10-22T03:00:00Z = jueves 00:00 ART).
  --full          Imprime detalle por pedido (top-20 por categoría).
  --help          Esta ayuda.

Criterios GREEN:
  (a) 0 pedidos activos sin _commitVersion.
  (b) < 5 fallbacks legacy desde --since.
`);
}

(async () => {
  const args = parseArgs();
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.since) {
    console.error('ERROR: --since=<ISO> es requerido.');
    usage();
    process.exit(2);
  }
  const sinceMs = Date.parse(args.since);
  if (!Number.isFinite(sinceMs)) {
    console.error('ERROR: --since no es ISO parseable:', args.since);
    process.exit(2);
  }
  const sinceDate = new Date(sinceMs);

  let admin;
  try {
    admin = require('../../functions/node_modules/firebase-admin');
  } catch (e) {
    console.error('ERROR: no se pudo requerir firebase-admin.', e && e.message);
    process.exit(1);
  }

  try {
    admin.initializeApp({ projectId: PROJECT });
  } catch (_e) {
    // ya inicializada
  }
  const db = admin.firestore();

  console.log('='.repeat(76));
  console.log('E10 _commitVersion audit  —  proyecto:', PROJECT);
  console.log('since (ISO):', args.since, ' | ', sinceDate.toISOString());
  console.log('='.repeat(76));

  // === QUERY 1: pedidos activos (closedAt == null) ===
  let activeSnap;
  try {
    activeSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  } catch (e) {
    console.error('ERROR query activos:', e && e.message);
    process.exit(1);
  }
  console.log('Activos totales (closedAt=null):', activeSnap.size);

  const activeWithoutVersion = [];
  activeSnap.forEach((doc) => {
    const d = doc.data();
    if (!d._commitVersion) {
      activeWithoutVersion.push({
        id: doc.id,
        orderNumber: d.orderNumber || '(sin orderNumber)',
        clientName: d.clientName || d.key || '(sin nombre)',
        cardCode: d.clientCardCode || '',
        source: d.source || '(sin source)',
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : String(d.createdAt)) : '(sin createdAt)',
        ownerEmail: d.ownerEmail || d.cargadoPorEmail || '(sin owner)',
        stage: d.stage || '(sin stage)',
        transferidoSAP: d.transferidoSAP ? JSON.stringify(d.transferidoSAP).slice(0, 100) : null,
      });
    }
  });

  console.log('');
  console.log('--- Criterio (a): activos sin _commitVersion ---');
  console.log('Count:', activeWithoutVersion.length);

  // === QUERY 2: pedidos creados desde --since ===
  let sinceSnap;
  try {
    sinceSnap = await db.collection('pedidos').where('createdAt', '>=', admin.firestore.Timestamp.fromDate(sinceDate)).get();
  } catch (e) {
    console.error('ERROR query since:', e && e.message);
    process.exit(1);
  }
  console.log('');
  console.log('Totales desde since:', sinceSnap.size);

  const sinceWithoutVersion = [];
  sinceSnap.forEach((doc) => {
    const d = doc.data();
    if (!d._commitVersion) {
      sinceWithoutVersion.push({
        id: doc.id,
        orderNumber: d.orderNumber || '(sin orderNumber)',
        clientName: d.clientName || d.key || '(sin nombre)',
        cardCode: d.clientCardCode || '',
        source: d.source || '(sin source)',
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : String(d.createdAt)) : '(sin createdAt)',
        ownerEmail: d.ownerEmail || d.cargadoPorEmail || '(sin owner)',
        stage: d.stage || '(sin stage)',
      });
    }
  });

  console.log('');
  console.log('--- Criterio (b): fallbacks legacy desde', sinceDate.toISOString(), '---');
  console.log('Count:', sinceWithoutVersion.length);

  // === OUTPUT TABULAR ===
  if (args.full || activeWithoutVersion.length > 0) {
    console.log('');
    console.log('='.repeat(76));
    console.log('TOP 20 ACTIVOS SIN _commitVersion:');
    console.log('='.repeat(76));
    const topA = activeWithoutVersion.slice(0, 20);
    for (const p of topA) {
      console.log(`  pedidoId=${p.id}`);
      console.log(`    orderNumber: ${p.orderNumber}  stage: ${p.stage}`);
      console.log(`    cliente: ${p.clientName} (${p.cardCode})`);
      console.log(`    source: ${p.source}  owner: ${p.ownerEmail}`);
      console.log(`    createdAt: ${p.createdAt}`);
      if (p.transferidoSAP) console.log(`    transferidoSAP: ${p.transferidoSAP}`);
      console.log('');
    }
    if (activeWithoutVersion.length > 20) {
      console.log(`  ... ${activeWithoutVersion.length - 20} más`);
    }
  }

  if (args.full || sinceWithoutVersion.length > 0) {
    console.log('');
    console.log('='.repeat(76));
    console.log('TOP 20 FALLBACKS LEGACY DESDE', sinceDate.toISOString() + ':');
    console.log('='.repeat(76));
    // Agrupar por owner + source para patrón
    const bySource = {};
    const byOwner = {};
    for (const p of sinceWithoutVersion) {
      bySource[p.source] = (bySource[p.source] || 0) + 1;
      byOwner[p.ownerEmail] = (byOwner[p.ownerEmail] || 0) + 1;
    }
    console.log('Por source:');
    for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('');
    console.log('Por owner:');
    for (const [k, v] of Object.entries(byOwner).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('');
    const topB = sinceWithoutVersion.slice(0, 20);
    for (const p of topB) {
      console.log(`  pedidoId=${p.id}`);
      console.log(`    orderNumber: ${p.orderNumber}  stage: ${p.stage}`);
      console.log(`    cliente: ${p.clientName} (${p.cardCode})`);
      console.log(`    source: ${p.source}  owner: ${p.ownerEmail}`);
      console.log(`    createdAt: ${p.createdAt}`);
      console.log('');
    }
    if (sinceWithoutVersion.length > 20) {
      console.log(`  ... ${sinceWithoutVersion.length - 20} más`);
    }
  }

  // === VEREDICTO ===
  console.log('='.repeat(76));
  console.log('VEREDICTO');
  console.log('='.repeat(76));
  console.log(`(a) Activos sin _commitVersion:         ${activeWithoutVersion.length}   (criterio: == 0)`);
  console.log(`(b) Fallbacks legacy desde ${sinceDate.toISOString().slice(0, 10)}:  ${sinceWithoutVersion.length}   (criterio: < 5)`);
  console.log('');

  const greenA = activeWithoutVersion.length === 0;
  const greenB = sinceWithoutVersion.length < 5;
  const green = greenA && greenB;

  if (green) {
    console.log('>>> GREEN: migración E10 completa. Seguro cerrar rules a `_commitVersion==\'commitPedidoCore_v1\'`.');
    process.exit(0);
  } else {
    console.log('>>> RED: migración E10 incompleta. NO cerrar rules todavía.');
    console.log('    Items pendientes:');
    if (!greenA) console.log('    - ' + activeWithoutVersion.length + ' pedidos activos sin _commitVersion.');
    if (!greenB) console.log('    - ' + sinceWithoutVersion.length + ' fallbacks legacy desde el jueves.');
    process.exit(10);
  }
})().catch((e) => {
  console.error('FATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
