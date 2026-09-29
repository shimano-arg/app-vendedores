/**
 * _reopen_soledad_pedido.cjs — 2026-09-29
 *
 * Fix puntual: pedido SOLEDAD SANCHEZ orden 237 (id pnRUiDujR9mvdwUXyIsf,
 * SAP:2000241) fue cerrado erroneamente por race del CF syncSapQuotationClosures
 * cuando en realidad ya se habia generado SO 20056 en SAP. Este script reabre
 * el pedido borrando closedAt + closedReason + metadatos closedManuallyInSap.
 *
 * El CF syncSapOrdersToApp del proximo tick va a detectar la SO y setear
 * transferidoSAP.orderDocEntry / orderDocNum correcto. La card volvera a la
 * columna "Pendiente de facturar" del Planner.
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const PEDIDO_ID = 'pnRUiDujR9mvdwUXyIsf'; // SOLEDAD SANCHEZ orden 237

(async () => {
  const ref = db.collection('pedidos').doc(PEDIDO_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error('Pedido no existe:', PEDIDO_ID);
    process.exit(1);
  }
  const p = snap.data();
  console.log(`Estado pre-fix:`);
  console.log(`  clientName: ${p.clientName}`);
  console.log(`  orderNumber: ${p.orderNumber}`);
  console.log(`  closedAt: ${p.closedAt}`);
  console.log(`  closedReason: ${p.closedReason}`);
  console.log(`  transferidoSAP.docNum: ${p.transferidoSAP?.docNum}`);
  console.log(`  transferidoSAP.closedManuallyInSap: ${p.transferidoSAP?.closedManuallyInSap}`);

  await ref.update({
    closedAt: FieldValue.delete(),
    closedReason: FieldValue.delete(),
    'transferidoSAP.closedManuallyInSap': FieldValue.delete(),
    'transferidoSAP.sapDocumentStatus': FieldValue.delete(),
    'transferidoSAP.closedManuallyDetectedAt': FieldValue.delete(),
    raceFixAt: new Date().toISOString(),
    raceFixNote: 'CF syncSapQuotationClosures cerro prematuramente antes de que syncSapOrdersToApp detectara SO 20056 en SAP. Reabierto manual para que la card vuelva al pipeline correcto.',
  });

  console.log(`\n✓ Pedido reabierto. El proximo tick de syncSapOrdersToApp (max 15 min) va a setear orderDocEntry.`);
  console.log(`✓ Cache stale? Los usuarios (Ioannis, Federico) van a verlo aparecer en su proximo refresh.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
