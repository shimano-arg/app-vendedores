/**
 * H — Cerrar ingresos_reparto fantasma source='migration-v1278' con clientesCount=0.
 *
 * Contexto: v1278 (2026-10-14) migró ASIG a BO + creó ingresos_reparto. En el
 * proceso, algunos SKUs quedaron con doc en 'pending'/'in_progress' con
 * clientesBO=[] (clientesCount=0). Esos docs bloquean a reconcileRepartosFaltantes
 * del v1387 porque los ve como "activos" y skipea por dedupe.
 *
 * Esta corrida marca status='cancelled' + closedReason='phantom_migration_v1278'.
 * NO borra el doc (preserva audit trail).
 *
 * Modo:
 *   node scripts/audit/H_cerrar_repartos_fantasma.cjs            (dry-run, default)
 *   node scripts/audit/H_cerrar_repartos_fantasma.cjs --apply    (ejecuta writes)
 *
 * Autorizado por Mariano 2026-10-21.
 */

const APPLY = process.argv.includes('--apply');
const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('H — Cerrar ingresos_reparto fantasma source=migration-v1278');
  console.log('================================================================');
  console.log('Modo:', APPLY ? '--apply (WRITES EN PROD)' : '--dry-run');
  console.log('');

  const nowIso = new Date().toISOString();
  const snap = await db
    .collection('ingresos_reparto')
    .where('source', '==', 'migration-v1278')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();

  const candidates = [];
  const withAssignments = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const clientesCount = Number(data.clientesCount || 0);
    const hasAssignments = !!(data.assignments && Array.isArray(data.assignments) && data.assignments.length > 0);
    const row = {
      id: d.id,
      sku: data.sku,
      status: data.status,
      clientesCount,
      hasAssignments,
      detectedAt: data.detectedAt || null,
      qtyIngresada: data.qtyIngresada || 0,
    };
    if (clientesCount === 0 && !hasAssignments) candidates.push(row);
    else withAssignments.push(row);
  });

  console.log('Total docs source=migration-v1278 + status pending|in_progress: ' + snap.size);
  console.log('Candidatos a cerrar (clientesCount=0 + sin assignments): ' + candidates.length);
  console.log('Con clientes o assignments (NO tocar): ' + withAssignments.length);
  console.log('');
  console.log('===== CANDIDATOS A CERRAR =====');
  candidates.forEach((r) => {
    console.log('  id=' + r.id + ' sku=' + r.sku + ' status=' + r.status + ' qtyIng=' + r.qtyIngresada + ' detectedAt=' + r.detectedAt);
  });

  if (withAssignments.length > 0) {
    console.log('');
    console.log('===== EXCLUIDOS (tienen clientes o asignaciones) =====');
    withAssignments.forEach((r) => {
      console.log('  id=' + r.id + ' sku=' + r.sku + ' clientesCount=' + r.clientesCount + ' hasAssignments=' + r.hasAssignments);
    });
  }

  if (!APPLY) {
    console.log('');
    console.log('(dry-run) Nada se escribió. Para ejecutar: --apply');
    return;
  }

  if (candidates.length === 0) {
    console.log('');
    console.log('No hay candidatos. Nada que hacer.');
    return;
  }

  console.log('');
  console.log('===== APLICANDO WRITES (' + candidates.length + ') =====');
  let ok = 0;
  let errored = [];
  for (const c of candidates) {
    try {
      await db.collection('ingresos_reparto').doc(c.id).update({
        status: 'cancelled',
        closedReason: 'phantom_migration_v1278',
        closedAt: nowIso,
      });
      ok += 1;
      console.log('  OK id=' + c.id + ' sku=' + c.sku);
    } catch (e) {
      errored.push({ id: c.id, sku: c.sku, err: e.message || String(e) });
      console.error('  FAIL id=' + c.id + ' sku=' + c.sku + ' err=' + (e.message || e));
    }
  }
  console.log('');
  console.log('===== RESUMEN =====');
  console.log('OK: ' + ok + ' / ' + candidates.length);
  if (errored.length > 0) console.log('ERRORS: ' + errored.length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
