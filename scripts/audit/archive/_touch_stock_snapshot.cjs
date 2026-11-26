// Touch app_config/stock_snapshot con un campo lateral para forzar el trigger
// de la CF onDep11IncreaseCreateReparto. No afecta warehouseBreakdown.
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'app-vendedores-shimano' });

async function main() {
  const db = admin.firestore();
  const ref = db.doc('app_config/stock_snapshot');
  const nowIso = new Date().toISOString();
  await ref.update({ _touchedForReconcile: nowIso });
  console.log('touched app_config/stock_snapshot._touchedForReconcile=' + nowIso);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
