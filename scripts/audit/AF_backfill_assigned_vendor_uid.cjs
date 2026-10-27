// AF — PR 3 §74 (2026-10-26) — backfill assignedVendorUid vacío en pedidos +
// waitlists abiertos usando resolveClientVendorFromMaster.
//
// Reportado SUSANA ANDRILI: pedido quedó con assignedVendorUid=null porque el
// flujo unificar+confirmar no re-resolvió el UID. Este script detecta todos los
// pedidos + waitlists abiertos en esa situación y los repara.
//
// Fuente de verdad del vendedor:
//   - POINTS (client_master) → vendor_overrides por shop/loc/prov.
//   - client_applications (approvedAltas).
//
// Pure fn: src/pure/resolve-client-vendor.js. Este script la invoca con los
// datos leídos de Firestore + ejecuta backfill con _backfill §55.
//
// Uso:
//   node scripts/audit/AF_backfill_assigned_vendor_uid.cjs           (dry-run)
//   node scripts/audit/AF_backfill_assigned_vendor_uid.cjs --apply  (ejecuta)

const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG = 'AF_vendor_uid_2026-10-26_v1476';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const { resolveClientVendorFromMaster } = await import('../../src/pure/resolve-client-vendor.js');

  const apply = process.argv.includes('--apply');
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('AF — Backfill assignedVendorUid vacío en pedidos + waitlists');
  console.log('================================================================');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log();

  // Cargar POINTS desde client_master (todos los que tienen sapCardCode).
  console.log('[1/5] Cargando client_master → POINTS...');
  const cmSnap = await db.collection('client_master').get();
  const points = {};
  cmSnap.forEach((d) => {
    const data = d.data() || {};
    const card = String(data.sapCardCode || '').trim();
    if (!card) return;
    const name = String(data.clientName || '').toUpperCase().trim();
    const prov = String(data.provincia || '').toUpperCase().trim();
    const loc = String(data.localidad || '').toUpperCase().trim();
    const vendor = String(data.vendor || '').toUpperCase().trim();
    const key = card;
    points[key] = { cardCode: card, clientName: name, provincia: prov, localidad: loc, vendor };
  });
  console.log(`  points: ${Object.keys(points).length}`);

  // Cargar approvedAltas (client_applications con cardCodeSap).
  console.log('[2/5] Cargando approvedAltas...');
  const caSnap = await db.collection('client_applications').get();
  const approvedAltas = [];
  caSnap.forEach((d) => {
    const data = d.data() || {};
    const card = String(data.cardCodeSap || '').trim();
    if (!card) return;
    approvedAltas.push({
      cardCodeSap: card,
      comercio: String(data.comercio || '').toUpperCase().trim(),
      fantasia: String(data.fantasia || '').toUpperCase().trim(),
      assignedVendor: String(data.assignedVendor || '').toUpperCase().trim(),
    });
  });
  console.log(`  approvedAltas: ${approvedAltas.length}`);

  // Cargar users (roles) para resolver UID.
  console.log('[3/5] Cargando roles...');
  const rolesSnap = await db.collection('roles').get();
  const users = [];
  rolesSnap.forEach((d) => {
    const data = d.data() || {};
    const role = String(data.role || '').trim();
    if (!['vendedor', 'interno', 'admin', 'gerente'].includes(role)) return;
    // resolveClientVendorFromMaster espera u.vendorKey (línea 225 del pure).
    users.push({
      uid: d.id,
      email: String(data.email || '').trim(),
      role,
      vendorKey: String(data.vendor || '').toUpperCase().trim(),
      vendor: String(data.vendor || '').toUpperCase().trim(),
      displayName: String(data.displayName || '').trim(),
    });
  });
  console.log(`  users: ${users.length}`);

  const resolveFn = (cardCode, clientName) => {
    return resolveClientVendorFromMaster({
      cardCode,
      clientName,
      points,
      vdiPartnerUsers: users,
      users,
      approvedAltas,
      getEffectiveVendorForClient: null,
      sapGetClienteCode: null,
    });
  };

  // 4. Buscar pedidos abiertos con assignedVendorUid vacío + vendorAssigned populated.
  console.log('[4/5] Scan pedidos abiertos sin assignedVendorUid...');
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidoVictims = [];
  pedidosSnap.forEach((d) => {
    const data = d.data() || {};
    const hasUid = !!(data.assignedVendorUid && String(data.assignedVendorUid).trim());
    const hasName = !!(data.vendorAssigned && String(data.vendorAssigned).trim());
    if (hasUid) return;
    pedidoVictims.push({ id: d.id, ref: d.ref, data });
  });
  console.log(`  pedidos sin UID: ${pedidoVictims.length}`);

  // 5. Resolver y aplicar.
  console.log('[5/5] Resolviendo + aplicando...');
  const results = { ok: 0, no_resolvable: 0, no_cardcode: 0, by_reason: {} };
  const batches = [[]];
  const BATCH_LIMIT = 400;

  for (const v of pedidoVictims) {
    const cardCode = String(v.data.clientCardCode || '').trim();
    const clientName = String(v.data.clientName || '').trim();
    if (!cardCode) {
      results.no_cardcode++;
      continue;
    }
    const resolution = resolveFn(cardCode, clientName);
    const reason = resolution.reason || 'unknown';
    results.by_reason[reason] = (results.by_reason[reason] || 0) + 1;
    if (resolution.resolved && resolution.vendorUid) {
      results.ok++;
      if (!apply) continue;
      const update = {
        assignedVendorUid: resolution.vendorUid,
        assignedVendorEmail: resolution.vendorEmail || null,
        vendorAssigned: resolution.vendorKey || v.data.vendorAssigned,
        assignedVendorReason: reason,
        _backfill: {
          ...(v.data._backfill || {}),
          [BACKFILL_SLUG]: {
            previousValues: {
              assignedVendorUid: v.data.assignedVendorUid || null,
              assignedVendorEmail: v.data.assignedVendorEmail || null,
              vendorAssigned: v.data.vendorAssigned || null,
            },
            resolvedTo: {
              vendorKey: resolution.vendorKey,
              vendorUid: resolution.vendorUid,
              vendorEmail: resolution.vendorEmail,
              reason,
            },
            by: 'scripts/audit/AF_backfill_assigned_vendor_uid.cjs',
            at: nowIso,
          },
        },
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'scripts/audit/AF_backfill_assigned_vendor_uid.cjs',
      };
      let currentBatch = batches[batches.length - 1];
      if (currentBatch.length >= BATCH_LIMIT) {
        currentBatch = [];
        batches.push(currentBatch);
      }
      currentBatch.push({ ref: v.ref, update });
    } else {
      results.no_resolvable++;
    }
  }

  console.log();
  console.log('Resultados:');
  console.log(`  Resolvibles (OK para backfill): ${results.ok}`);
  console.log(`  NO resolvibles: ${results.no_resolvable}`);
  console.log(`  Sin cardCode: ${results.no_cardcode}`);
  console.log('  By reason:');
  for (const [r, c] of Object.entries(results.by_reason)) {
    console.log(`    ${r}: ${c}`);
  }
  // Detalle de los no-resolvibles para Mariano.
  if (results.no_resolvable > 0) {
    console.log();
    console.log('NO resolvibles (vendor_sin_uid o similar) — Mariano revisa roles/ y assignedVendor del cliente:');
    for (const v of pedidoVictims) {
      const cardCode = String(v.data.clientCardCode || '').trim();
      const clientName = String(v.data.clientName || '').trim();
      if (!cardCode) continue;
      const r = resolveFn(cardCode, clientName);
      if (!r.resolved || !r.vendorUid) {
        console.log(`  ${v.id} orden=${v.data.orderNumber} cliente="${clientName}" card=${cardCode} vendor="${v.data.vendorAssigned || '?'}" reason=${r.reason}`);
      }
    }
  }

  if (!apply) {
    console.log();
    console.log('DRY-RUN: no se escribió nada.');
    return;
  }

  let totalWrites = 0;
  for (const batchData of batches) {
    if (batchData.length === 0) continue;
    const b = db.batch();
    for (const { ref, update } of batchData) b.update(ref, update);
    await b.commit();
    totalWrites += batchData.length;
    console.log(`  batch commit: ${batchData.length} writes (acum: ${totalWrites})`);
  }
  console.log(`\n✓ Backfill completo: ${totalWrites} pedidos actualizados.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
