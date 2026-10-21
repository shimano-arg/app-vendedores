// Verify E4: busca si CUDC201HG tiene un ingreso_reparto activo post-v1387
// (debería existir vía reconcileRepartosFaltantes la próxima vez que el CF
// corra con stock_snapshot).
const admin = require('../../functions/node_modules/firebase-admin');

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'app-vendedores-shimano' });
  }
  const db = admin.firestore();
  const SKU = 'CUDC201HG';
  const snap = await db
    .collection('ingresos_reparto')
    .where('sku', '==', SKU)
    .where('status', 'in', ['pending', 'in_progress'])
    .get();
  console.log('ingresos_reparto activos SKU=' + SKU + ': ' + snap.size);
  snap.forEach((d) => {
    const data = d.data();
    console.log('  id=' + d.id + ' qtyIng=' + data.qtyIngresada + ' source=' + (data.source || 'delta') + ' detectedAt=' + data.detectedAt + ' clientesCount=' + (data.clientesCount || 0));
  });

  const allRec = await db.collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress']).get();
  const reconcile = [];
  allRec.forEach((d) => {
    const data = d.data();
    if (data.source === 'reconciliation') reconcile.push({ id: d.id, sku: data.sku, qty: data.qtyIngresada, detectedAt: data.detectedAt });
  });
  console.log('Total source=reconciliation activos: ' + reconcile.length);
  reconcile.slice(0, 20).forEach((r) => console.log('  ' + JSON.stringify(r)));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
