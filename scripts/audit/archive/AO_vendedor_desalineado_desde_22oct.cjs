// AO v1490 (2026-10-27) — audit pedidos desde 22/10 con vendor desalineado
// o sin assignedVendorUid.
//
// F3 del plan de visibilidad: compara vendedor grabado en el pedido contra
// vendedor resuelto del master (OCRD + vendor_overrides + approvedAltas).
// Read-only por defecto; backfill en AP_backfill_vendor_desde_22oct.cjs.

const PROJECT = 'app-vendedores-shimano';

function normCardCode(x) {
  return String(x || '').trim().toUpperCase();
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('AO — Audit pedidos vendedor desalineado desde 22/10/2026 (F3)');
  console.log('================================================================\n');

  // 1. Cargar roles.
  const rolesSnap = await db.collection('roles').get();
  const vendorToUid = new Map();
  const uidToVendor = new Map();
  rolesSnap.forEach((d) => {
    const data = d.data();
    if (data.role === 'vendedor' && data.vendor) {
      vendorToUid.set(String(data.vendor).trim().toUpperCase(), d.id);
      uidToVendor.set(d.id, data.vendor);
    }
  });
  console.log(`[1] roles vendedor: ${vendorToUid.size} uniques`);

  // 2. approved altas (fuente master cuando OCRD no cubre).
  const altaSnap = await db.collection('client_applications').where('status', '==', 'approved').get();
  const altasByCardCode = new Map();
  altaSnap.forEach((d) => {
    const data = d.data();
    const cc = normCardCode(data.cardCodeSap);
    if (cc) altasByCardCode.set(cc, data);
  });
  console.log(`[2] approvedAltas: ${altasByCardCode.size}`);

  // 3. Pedidos desde 22/10 00:00 UTC.
  const cutoffMs = Date.UTC(2026, 9, 22, 0, 0, 0); // 2026-10-22 UTC
  const cutoffIso = new Date(cutoffMs).toISOString();
  console.log(`[3] Scanning pedidos createdAt >= ${cutoffIso}...`);

  const pedSnap = await db.collection('pedidos').where('createdAt', '>=', cutoffIso).get();
  console.log(`   pedidos: ${pedSnap.size}`);

  const problems = [];
  const totales = { total: 0, sinUid: 0, desalineado: 0, ok: 0, cliente_no_resolvible: 0 };

  for (const d of pedSnap.docs) {
    const data = d.data();
    totales.total++;
    const cc = normCardCode(data.clientCardCode);
    const cliente = data.clientName || cc || '(sin cliente)';
    const currentUid = data.assignedVendorUid || '';
    const currentVendor = data.vendorAssigned || data.ownerVendor || '';
    const owner = data.ownerUid || '';
    const ownerEmail = data.ownerEmail || '';
    const origen = data.origen || data.source || '(ninguno)';

    // Resolver master.
    let masterVendor = '';
    let masterSource = '';
    const alta = altasByCardCode.get(cc);
    if (alta && alta.assignedVendor) {
      masterVendor = String(alta.assignedVendor).trim();
      // Normalizar label "Z5 - Mauricio Gil" → "MAURICIO GIL".
      if (masterVendor.match(/^Z\d+\s*-\s*/i)) {
        masterVendor = masterVendor.replace(/^Z\d+\s*-\s*/i, '').trim().toUpperCase();
      } else {
        masterVendor = masterVendor.toUpperCase();
      }
      masterSource = 'approvedAlta';
    }
    const masterUid = masterVendor ? vendorToUid.get(masterVendor) || '' : '';

    const isCpst = (data.source === 'stock-asignado-batch') || (data.origen === 'cpst');
    const isAligned = currentUid && masterUid && currentUid === masterUid;
    const isMissingUid = !currentUid;
    const isMisaligned = currentUid && masterUid && currentUid !== masterUid;
    const cantResolver = !masterVendor;

    if (isAligned) totales.ok++;
    else if (isMissingUid && cantResolver) totales.cliente_no_resolvible++;
    else if (isMissingUid) totales.sinUid++;
    else if (isMisaligned) totales.desalineado++;

    if (!isAligned) {
      problems.push({
        orden: data.orderNumber || '(sin orden)',
        pedidoId: d.id,
        cliente,
        cardCode: cc,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : (data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : '?'),
        currentVendor: currentVendor || '(vacío)',
        currentUid: currentUid || '(vacío)',
        masterVendor: masterVendor || '(no resolvible)',
        masterUid: masterUid || '(no resolvible)',
        masterSource,
        ownerUid: owner,
        ownerEmail,
        origen,
        isMissingUid,
        isMisaligned,
        cantResolver,
      });
    }
  }

  console.log(`\n[4] Resultado:`);
  console.log(`    Total pedidos post-22/10:   ${totales.total}`);
  console.log(`    OK (aligned):               ${totales.ok}`);
  console.log(`    Sin assignedVendorUid:      ${totales.sinUid}`);
  console.log(`    Desalineados:               ${totales.desalineado}`);
  console.log(`    Cliente no resolvible master: ${totales.cliente_no_resolvible}`);
  console.log(`    Problemas a backfillear:    ${problems.length}`);

  problems.sort((a, b) => (a.orden || 0) - (b.orden || 0));

  console.log('\n[5] Listado (orden | cliente | cardCode | currentVendor | masterVendor | origen):');
  for (const p of problems) {
    console.log(
      `    ${p.orden}  ${p.cliente.slice(0, 30).padEnd(30)}  ${p.cardCode.padEnd(14)}  "${p.currentVendor}" → "${p.masterVendor}"  (${p.origen})  owner=${p.ownerEmail.slice(0, 30)}`
    );
  }

  console.log('\n[6] Dump JSON para F5 backfill:');
  const fs = require('node:fs');
  const path = require('node:path');
  const out = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, 'AO_vendedor_desalineado_desde_22oct.json'),
    JSON.stringify({ cutoffIso, totales, problems }, null, 2)
  );
  console.log(`    guardado: docs/auditoria/AO_vendedor_desalineado_desde_22oct.json`);

  console.log('\n================================================================');
  console.log('AO completo. Correr F4 (fix listeners) + F5 (backfill).');
  console.log('================================================================');
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
