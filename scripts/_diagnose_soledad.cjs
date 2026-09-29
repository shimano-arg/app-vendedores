/**
 * _diagnose_soledad.cjs — 2026-09-29
 * Ioannis reporta:
 *   1. No ve la card de SOLEDAD SANCHEZ que Mariano sí ve.
 *   2. La orden ya fue creada en SAP (SO 20056) pero Planner sigue en Oferta.
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

(async () => {
  console.log('=== SOLEDAD SANCHEZ orden 237 / SAP:2000241 ===');
  const snap = await db.collection('pedidos').where('transferidoSAP.docNum', '==', 2000241).get();
  console.log(`match docNum=2000241 → ${snap.size}`);
  for (const doc of snap.docs) {
    const p = { id: doc.id, ...doc.data() };
    console.log(`\n--- pedido ${p.id} ---`);
    console.log(`clientName:      ${p.clientName}`);
    console.log(`orderNumber:     ${p.orderNumber}`);
    console.log(`stage:           ${p.stage}`);
    console.log(`closedAt:        ${p.closedAt || '(null)'}`);
    console.log(`closedReason:    ${p.closedReason || '(null)'}`);
    console.log(`ownerUid:        ${p.ownerUid}`);
    console.log(`ownerEmail:      ${p.ownerEmail}`);
    console.log(`ownerVendor:     ${p.ownerVendor}`);
    console.log(`createdByEmail:  ${p.createdByEmail}`);
    console.log(`createdByUid:    ${p.createdByUid}`);
    console.log(`onBehalfOf:      ${p.onBehalfOf}`);
    console.log(`transferidoSAP:  ${JSON.stringify(p.transferidoSAP, null, 2)}`);
    console.log(`sapLinkage:      ${JSON.stringify(p.sapLinkage)}`);
    console.log(`sapDocTotal:     ${p.sapDocTotal || '(no set)'}`);
    console.log(`sapDocTotalSource: ${p.sapDocTotalSource || '(no set)'}`);
    console.log(`sapDocTotalSyncedAt: ${p.sapDocTotalSyncedAt || '(no set)'}`);
  }

  console.log('\n=== Verificar rol de Ioannis y whitelist Planner ===');
  const rolesSnap = await db.collection('roles').where('email', '==', 'ioannis.plakoudakis@shimano.com.ar').get();
  for (const doc of rolesSnap.docs) {
    const r = doc.data();
    console.log(`  role=${r.role} vendor=${r.vendor} internalPartnerUid=${r.internalPartnerUid || '(null)'}`);
    console.log(`  uid=${doc.id}`);
  }

  console.log('\n=== Verificar app_config planner (whitelist emails / roles) ===');
  const cfgSnap = await db.doc('app_config/planner_responsables').get();
  console.log('planner_responsables exists:', cfgSnap.exists);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
