const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'app-vendedores-shimano' });
const db = admin.firestore();

async function main() {
  const d = await db.collection('ingresos_reparto').doc('XqBxRRu78WLwmZx0K6Gd').get();
  const data = d.data();
  console.log('=== CUDC201HG ingreso_reparto fantasma ===');
  console.log('id=' + d.id);
  console.log('sku=' + data.sku);
  console.log('status=' + data.status);
  console.log('clientesCount=' + data.clientesCount);
  console.log('qtyIngresada=' + data.qtyIngresada);
  console.log('source=' + data.source);
  console.log('detectedAt=' + data.detectedAt);
  console.log('appliedAt=' + data.appliedAt);
  console.log('appliedBy=' + data.appliedBy);
  console.log('clientesBO (len=' + (data.clientesBO || []).length + '):');
  console.log(JSON.stringify(data.clientesBO || [], null, 2).slice(0, 400));
  console.log('assignments (len=' + (data.assignments || []).length + '):');
  console.log(JSON.stringify(data.assignments || [], null, 2).slice(0, 800));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
