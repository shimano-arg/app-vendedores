// Cerrar ingresos_reparto XqBxRRu78WLwmZx0K6Gd (CUDC201HG, migration-v1278
// in_progress con 2 assignments ya aplicadas) como status='done' sin tocar
// assignments. Autorizado por Mariano 2026-10-21.
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'app-vendedores-shimano' });

async function main() {
  const db = admin.firestore();
  const ref = db.collection('ingresos_reparto').doc('XqBxRRu78WLwmZx0K6Gd');
  const snap = await ref.get();
  if (!snap.exists) {
    console.log('NOT FOUND'); return;
  }
  const d = snap.data();
  console.log('Antes:');
  console.log('  status=' + d.status);
  console.log('  assignments=' + JSON.stringify(d.assignments || []));
  const nowIso = new Date().toISOString();
  await ref.update({
    status: 'done',
    closedReason: 'migration_doc_sin_clientes_cerrado_admin_2026-10-21',
    closedAt: nowIso,
  });
  const after = (await ref.get()).data();
  console.log('Despues:');
  console.log('  status=' + after.status);
  console.log('  closedReason=' + after.closedReason);
  console.log('  closedAt=' + after.closedAt);
  console.log('  assignments=' + JSON.stringify(after.assignments || []));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
