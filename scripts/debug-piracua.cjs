/**
 * debug-piracua.cjs
 * Encuentra el pedido de PIRACUA (10 lineas confirmed a 29d sin orderNumber)
 * y muestra su estado completo: schema, transferidoSAP, lineas, campos raros.
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const piracua = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const name = String(data.clientName || '').toUpperCase();
    if (name.includes('PIRACUA')) piracua.push({ id: doc.id, data });
  });
  console.log(`Encontrados ${piracua.length} pedidos abiertos con PIRACUA en clientName\n`);

  for (const p of piracua) {
    const d = p.data;
    console.log('='.repeat(80));
    console.log(`Pedido ID: ${p.id}`);
    console.log(`Cliente:      ${d.clientName}`);
    console.log(`orderNumber:  ${d.orderNumber || '(none)'}`);
    console.log(`stage:        ${d.stage}`);
    console.log(`closedAt:     ${d.closedAt}`);
    const createdAt = d.createdAt && (typeof d.createdAt.toDate === 'function' ? d.createdAt.toDate().toISOString() : String(d.createdAt));
    console.log(`createdAt:    ${createdAt}`);
    console.log(`confirmedAt:  ${d.confirmedAt}`);
    console.log(`month:        ${d.month} / year ${d.year}`);
    console.log(`province:     ${d.province || d.clientProvince}`);
    console.log(`locality:     ${d.locName || d.clientLocality}`);
    console.log(`ownerUid:     ${d.ownerUid}`);
    console.log(`ownerEmail:   ${d.ownerEmail}`);
    console.log(`ownerVendor:  ${d.ownerVendor}`);
    console.log(`clientCardCode: ${d.clientCardCode}`);
    console.log(`transferidoSAP: ${JSON.stringify(d.transferidoSAP || null)}`);
    console.log(`transferError:  ${d.transferError ? JSON.stringify(d.transferError) : '(none)'}`);
    console.log(`schemaVersion:  ${d.schemaVersion}`);
    console.log(`source:        ${d.source}`);
    console.log(`Otros campos:  ${Object.keys(d).filter(k => !['clientName','orderNumber','stage','closedAt','createdAt','confirmedAt','month','year','province','clientProvince','locName','clientLocality','ownerUid','ownerEmail','ownerVendor','clientCardCode','transferidoSAP','transferError','schemaVersion','source','lines','discountSnapshot','sapLinkage','netAmountArs','subtotalArs','discountPct','condicionPago','formaEntrega','key'].includes(k)).join(', ')}`);
    console.log(`\nLINEAS (${(d.lines || []).length}):`);
    for (const l of d.lines || []) {
      const qty = Number(l.qty) || 0;
      const qtyOpen = Number(l.qtyOpen) || 0;
      const precio = Number(l.priceAtCreation || l.precio || 0);
      console.log(`  [${l.state}] ${l.code} ${qty}u qty · ${qtyOpen}u qtyOpen · $${precio}${l.asigAt ? ' asigAt=' + l.asigAt : ''}${l.asigReserva !== undefined ? ' asigReserva=' + l.asigReserva : ''}`);
    }
    console.log();
  }
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
