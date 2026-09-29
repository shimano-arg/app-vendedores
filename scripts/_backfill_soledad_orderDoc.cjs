/**
 * _backfill_soledad_orderDoc.cjs — 2026-09-29
 * Backfill manual: syncSapOrdersToApp no capturo la SO 20056 (SOLEDAD) porque
 * el rango de scan (LOOKAHEAD=2000) queda corto por picos de Bike SOs.
 * Fix: seteo orderDocNum=20056 directamente. orderDocEntry queda con
 * valor placeholder (20056 tambien) para satisfacer computeColumn Rule 4
 * `transferidoSAP?.orderDocEntry truthy → ordenes`. Cuando el sync eventualmente
 * capture el docEntry real, sobrescribe.
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

(async () => {
  const ref = db.collection('pedidos').doc('pnRUiDujR9mvdwUXyIsf');
  const snap = await ref.get();
  const p = snap.data();
  console.log('Pre-fix transferidoSAP.orderDocEntry:', p.transferidoSAP?.orderDocEntry, 'orderDocNum:', p.transferidoSAP?.orderDocNum);
  await ref.update({
    'transferidoSAP.orderDocNum': 20056,
    // Placeholder: el sync va a sobreescribir con el docEntry real cuando lo
    // encuentre. computeColumn solo evalua truthy — 20056 sirve como marker
    // "hay SO derivada" para mover la card a Pendiente de facturar.
    'transferidoSAP.orderDocEntry': 20056,
    'transferidoSAP.orderSyncedAt': new Date().toISOString(),
    'transferidoSAP.orderManualBackfill': true,
  });
  console.log('OK: orderDocNum=20056 seteado. Card debe pasar a "Pendiente de facturar".');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
