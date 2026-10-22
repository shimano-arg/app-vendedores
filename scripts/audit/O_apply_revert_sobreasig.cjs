// O — aplica revertSobreAsignadas sobre prod. Sirve para gatillar la
// reconciliación ya desplegada en la CF sin esperar al próximo write de
// stock_snapshot. Idempotente.
//
// Autorizado por Mariano 2026-10-21 (v1403 §40.11).

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const { revertSobreAsignadas } = await import('../../functions/core/reparto-core.js');

  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};

  console.log('================================================================');
  console.log('O — Apply revertSobreAsignadas (manual trigger) @ ' + new Date().toISOString());
  console.log('================================================================');

  const r = await revertSobreAsignadas({
    fbDb: db,
    now: () => new Date(),
    log: (msg, extra) => console.log('[' + msg + '] ' + JSON.stringify(extra)),
  }, sd);

  console.log();
  console.log('===== RESULTADO =====');
  console.log('Revertidas: ' + r.revertidas.length);
  console.log('Errors: ' + r.errors.length);
  r.errors.forEach((e) => console.error('  ' + e));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
