/**
 * activate-fase-c.cjs
 *
 * Activa Fase C del feature tier-based SAP (v964). Setea el flag
 * `sqCancelMode='active'` en `app_config/sap_sync_state`.
 *
 * Antes/después muestra el estado del doc para verificar el cambio.
 *
 * Uso:
 *   node scripts/activate-fase-c.cjs            # activa
 *   node scripts/activate-fase-c.cjs deactivate # desactiva (vuelve a shadow)
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  const arg = (process.argv[2] || '').toLowerCase();
  const target = arg === 'deactivate' ? 'shadow' : 'active';

  console.log(`===== ${target === 'active' ? 'ACTIVAR' : 'DESACTIVAR'} Fase C =====\n`);

  const ref = db.doc('app_config/sap_sync_state');
  const before = await ref.get();
  const beforeData = before.exists ? before.data() : {};
  console.log('Estado ANTES:');
  console.log(`  sqCancelMode: ${beforeData.sqCancelMode || '(no seteado → shadow)'}`);
  console.log(`  mode (E5 sync SAP invoices): ${beforeData.mode || '?'}`);
  console.log();

  await ref.set(
    {
      sqCancelMode: target,
      sqCancelModeUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      sqCancelModeUpdatedBy: 'mariano/manual-flip',
    },
    { merge: true }
  );

  const after = await ref.get();
  const afterData = after.data();
  console.log('Estado DESPUÉS:');
  console.log(`  sqCancelMode: ${afterData.sqCancelMode}`);
  console.log(`  sqCancelModeUpdatedAt: ${afterData.sqCancelModeUpdatedAt}`);
  console.log(`  sqCancelModeUpdatedBy: ${afterData.sqCancelModeUpdatedBy}`);
  console.log();

  if (target === 'active') {
    console.log('✅ Fase C ACTIVA. Próximo cron 04:30 ART va a:');
    console.log('   1. Escanear pedidos con confirmed >15d');
    console.log('   2. Verificar cada SQ en SAP (5 salvaguardas)');
    console.log('   3. Cancelar via SL POST /Cancel las que pasan');
    console.log('   4. Marcar líneas Firestore state=cancelled');
    console.log('   5. Escribir logs a sq_cancel_log y sq_cancel_skipped_log');
    console.log();
    console.log('Para dispararlo manualmente antes de mañana 04:30, correr en Firebase Console:');
    console.log('   Cloud Functions → sqCancelExpiredCF → Run now');
    console.log();
    console.log('Para desactivar: node scripts/activate-fase-c.cjs deactivate');
  } else {
    console.log('🟢 Fase C DESACTIVADA. Volvimos a shadow mode.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
