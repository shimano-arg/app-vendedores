// AN v1490 (2026-10-27) read-only — investigación visibilidad ORDEN 516 BROBRO.
//
// Para F1 del plan: lee órdenes 516 y 430 BROBRO SA + master cliente + user
// Gonzalo. Compara campos de vendedor para ver por qué Gonzalo no ve la 516.

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('AN — Investigación visibilidad ORDEN 516 BROBRO SA (F1)');
  console.log('================================================================\n');

  // 1. Pedidos 516 y 430 (buscar por orderNumber).
  console.log('[1] Pedidos con orderNumber 516 y 430 (clientCardCode BROBRO SA)...');
  // BROBRO SA cardCode conocido histórico v1409: C30718510291.
  const BROBRO_CARD_CODES = ['C30718510291'];

  for (const order of [516, 430, 526, 534, 537, 538]) {
    const snap = await db.collection('pedidos').where('orderNumber', '==', order).get();
    snap.forEach((d) => {
      const data = d.data();
      const client = data.clientName || data.clientCardCode;
      const isBrobro = /BROBRO/i.test(client);
      if (order === 516 || order === 430 || isBrobro) {
        console.log(`\n  ORDEN ${order}: pedidoId=${d.id}`);
        console.log(`    clientName:     ${data.clientName}`);
        console.log(`    clientCardCode: ${data.clientCardCode}`);
        console.log(`    province+loc:   ${data.province || ''} / ${data.locName || ''}`);
        console.log(`    createdAt:      ${JSON.stringify(data.createdAt)}`);
        console.log(`    closedAt:       ${JSON.stringify(data.closedAt)}`);
        console.log(`    stage:          ${data.stage}`);
        console.log(`    source:         ${data.source || '(ninguno)'}`);
        console.log(`    origen:         ${data.origen || '(ninguno)'}`);
        console.log(`    ownerUid:       ${data.ownerUid}`);
        console.log(`    ownerEmail:     ${data.ownerEmail}`);
        console.log(`    ownerVendor:    ${data.ownerVendor}`);
        console.log(`    vendorAssigned: ${data.vendorAssigned}`);
        console.log(`    assignedVendorUid:    ${data.assignedVendorUid || '(vacío)'}`);
        console.log(`    assignedVendorEmail:  ${data.assignedVendorEmail || '(vacío)'}`);
        console.log(`    assignedVendorReason: ${data.assignedVendorReason || '(vacío)'}`);
        console.log(`    cargadoPorUid:    ${data.cargadoPorUid || '(vacío)'}`);
        console.log(`    cargadoPorEmail:  ${data.cargadoPorEmail || '(vacío)'}`);
        console.log(`    transferidoSAP:   ${data.transferidoSAP ? 'SI (docNum=' + (data.transferidoSAP.docNum || '?') + ')' : 'NO'}`);
        const lines = Array.isArray(data.lines) ? data.lines : [];
        const states = lines.map((l) => l.state).join(',');
        console.log(`    lines.length=${lines.length}, states=${states.slice(0, 100)}`);
      }
    });
  }

  // 2. Master de BROBRO SA.
  console.log('\n\n[2] Master cliente BROBRO SA...');
  for (const cc of BROBRO_CARD_CODES) {
    // POINTS está en app_config/points (collection) o inline. Buscar en client_master.
    const cmSnap = await db
      .collection('client_master')
      .where('cardCodeSap', '==', cc)
      .get();
    cmSnap.forEach((d) => {
      const data = d.data();
      console.log(`\n  client_master/${d.id}:`);
      console.log(`    cardCodeSap:       ${data.cardCodeSap}`);
      console.log(`    comercio:          ${data.comercio}`);
      console.log(`    fantasia:          ${data.fantasia}`);
      console.log(`    assignedVendor:    ${data.assignedVendor || '(vacío)'}`);
      console.log(`    assignedVendorUid: ${data.assignedVendorUid || '(no persistido)'}`);
    });
    if (cmSnap.empty) console.log(`  (no hay doc client_master con cardCodeSap=${cc})`);

    // POINTS collection (si existe) o doc config.
    const pointsSnap = await db.collection('points').where('clients', 'array-contains-any', [cc]).get().catch(() => ({ empty: true }));
    if (!pointsSnap.empty) {
      pointsSnap.forEach((d) => {
        console.log(`\n  points/${d.id}:`, JSON.stringify(d.data(), null, 2).slice(0, 400));
      });
    }

    // vendor_overrides.
    const voSnap = await db.collection('vendor_overrides').get();
    voSnap.forEach((d) => {
      const data = d.data();
      if (data.cardCode === cc || data.CARD_CODE === cc) {
        console.log(`\n  vendor_overrides/${d.id}:`, JSON.stringify(data));
      }
    });

    // approvedAltas / client_applications.
    const altaSnap = await db
      .collection('client_applications')
      .where('cardCodeSap', '==', cc)
      .get();
    altaSnap.forEach((d) => {
      const data = d.data();
      console.log(`\n  client_applications/${d.id}:`);
      console.log(`    status:            ${data.status}`);
      console.log(`    cardCodeSap:       ${data.cardCodeSap}`);
      console.log(`    comercio:          ${data.comercio}`);
      console.log(`    fantasia:          ${data.fantasia}`);
      console.log(`    assignedVendor:    ${data.assignedVendor || '(vacío)'}`);
    });
  }

  // 3. User Gonzalo.
  console.log('\n\n[3] Users rol vendedor (buscando Gonzalo)...');
  const rolesSnap = await db.collection('roles').where('role', '==', 'vendedor').get();
  rolesSnap.forEach((d) => {
    const data = d.data();
    const name = (data.vendor || data.name || '').toUpperCase();
    if (name.includes('GONZALO')) {
      console.log(`\n  roles/${d.id}:`);
      console.log(`    uid:    ${d.id}`);
      console.log(`    email:  ${data.email}`);
      console.log(`    role:   ${data.role}`);
      console.log(`    vendor: ${data.vendor}`);
      console.log(`    name:   ${data.name}`);
    }
  });
  console.log(`\n  (total users rol=vendedor: ${rolesSnap.size})`);

  console.log('\n================================================================');
  console.log('F1 completo. Correr F2 para ver filtros Confirmados+Planner.');
  console.log('================================================================');
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
