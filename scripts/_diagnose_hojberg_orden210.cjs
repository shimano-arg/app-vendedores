/**
 * Diagnostica por que HECTOR GERMAN HOJBERG orden 210 no aparece en el Planner.
 * Hipotesis: closedAt seteado -> filtered out del listener planner.
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

function ars(n) { return typeof n === 'number' ? n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }) : String(n); }

(async () => {
  console.log('\n=== BUSQUEDA orden 210 ===');
  const snap = await db.collection('pedidos').where('orderNumber', '==', 210).get();
  console.log(`Match por orderNumber=210: ${snap.size}`);
  for (const doc of snap.docs) {
    const p = { id: doc.id, ...doc.data() };
    console.log(`\n--- pedido ${p.id} ---`);
    console.log(`clientName:      ${p.clientName}`);
    console.log(`stage:           ${p.stage}`);
    console.log(`orderNumber:     ${p.orderNumber}`);
    console.log(`createdAt:       ${p.createdAt?.toDate?.() || p.createdAt}`);
    console.log(`closedAt:        ${p.closedAt || '(null)'}`);
    console.log(`closedReason:    ${p.closedReason || '(null)'}`);
    console.log(`transferidoSAP:  docNum=${p.transferidoSAP?.docNum} orderDocNum=${p.transferidoSAP?.orderDocNum}`);
    console.log(`invoicedAmount:  ${p.invoicedAmount != null ? ars(p.invoicedAmount) : '(null)'}`);
    console.log(`paidAmount:      ${p.paidAmount != null ? ars(p.paidAmount) : '(null)'}`);
    console.log(`paidStatus:      ${p.paidStatus || '(null)'}`);
    console.log(`netAmountArs:    ${p.netAmountArs != null ? ars(p.netAmountArs) : '(null)'}`);
    console.log(`>>> Aparece en Planner (closedAt===null): ${p.closedAt == null ? 'SI' : 'NO — filtrado'}`);
  }

  // Tambien buscar por clientName HOJBERG
  console.log('\n=== BUSQUEDA por clientName ~= HOJBERG ===');
  const all = await db.collection('pedidos').where('clientName', '>=', 'HECTOR').where('clientName', '<=', 'HECTOR').get();
  const hojberg = all.docs.filter(d => (d.data().clientName || '').includes('HOJBERG'));
  console.log(`Match HECTOR* con HOJBERG: ${hojberg.length}`);
  for (const doc of hojberg) {
    const p = { id: doc.id, ...doc.data() };
    console.log(`  ord=${p.orderNumber} (typeof ${typeof p.orderNumber}) closedAt=${p.closedAt ? 'SI(' + p.closedReason + ')' : 'null'} stage=${p.stage} clientName="${p.clientName}"`);
    console.log(`    id=${p.id}`);
    console.log(`    transferidoSAP=${JSON.stringify(p.transferidoSAP)}`);
    console.log(`    invoicedAmount=${p.invoicedAmount} paidAmount=${p.paidAmount} paidStatus=${p.paidStatus}`);
  }

  console.log('\n=== Agregado Septiembre: cuantos pedidos con closedAt !== null ===');
  const start = new Date('2026-09-01T00:00:00Z');
  const end = new Date('2026-10-01T00:00:00Z');
  const septSnap = await db.collection('pedidos').where('createdAt', '>=', start).where('createdAt', '<', end).get();
  let openCount = 0, closedCount = 0;
  const closedByReason = {};
  for (const doc of septSnap.docs) {
    const p = doc.data();
    if (p.closedAt) {
      closedCount += 1;
      const reason = p.closedReason || '(sin reason)';
      closedByReason[reason] = (closedByReason[reason] || 0) + 1;
    } else {
      openCount += 1;
    }
  }
  console.log(`Total Sept: ${septSnap.size}`);
  console.log(`  closedAt=null (visible en Planner): ${openCount}`);
  console.log(`  closedAt seteado (INVISIBLE Planner): ${closedCount}`);
  for (const [r, n] of Object.entries(closedByReason).sort((a, b) => b[1] - a[1])) {
    console.log(`    reason='${r}': ${n}`);
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
