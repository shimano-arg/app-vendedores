const admin = require('../../functions/node_modules/firebase-admin');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'app-vendedores-shimano' });
const db = admin.firestore();
(async () => {
  console.log('--- All e2e-test-client docs ---');
  const direct = await db.collection('client_applications').doc('e2e-test-client').get();
  if (direct.exists) {
    console.log('  direct GET: exists');
    console.log('  data:', JSON.stringify(direct.data(), null, 2));
  } else {
    console.log('  direct GET: NOT FOUND');
  }
  console.log('\n--- Query status=approved + assignedVendor=PRUEBAS E2E ---');
  const snap = await db.collection('client_applications')
    .where('status', '==', 'approved')
    .where('assignedVendor', '==', 'PRUEBAS E2E').get();
  console.log('  matches=', snap.size);
  snap.forEach(d => {
    const data = d.data();
    console.log('    ', d.id, '→', data.comercio, 'cardCodeSap=', data.cardCodeSap);
  });
})().catch(e => { console.error(e); process.exit(1); });
