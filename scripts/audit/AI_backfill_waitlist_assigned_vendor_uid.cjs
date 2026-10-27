// AI — v1480 §80 (2026-10-27) backfill assignedVendorUid vacío en
// revision_waitlist abiertos. Precedente: AF v1476 backfilleó /pedidos pero
// no revision_waitlist; 4 docs quedaron sin UID → bloquea VENDOR_UID_MISSING.
//
// Casos reales prod 2026-10-27:
//   546 DANIEL ALEJANDRO BATTISTONI vendorAssigned=MAURICIO GIL
//   593 JUAN JOSE ETCHEGOYEN       vendorAssigned=MAURICIO GIL
//   534 DAMIAN DAVID TESI          vendorAssigned=''
//   594 EDGARDO ANDRES RODRIGUEZ   vendorAssigned=MAURICIO GIL
//
// Fuente de verdad: cliente master (OCRD/POINTS) + vendor_overrides +
// approvedAltas (§46 §50). Mismo pattern que AF.
//
// Uso:
//   node scripts/audit/AI_backfill_waitlist_assigned_vendor_uid.cjs           (dry-run)
//   node scripts/audit/AI_backfill_waitlist_assigned_vendor_uid.cjs --apply  (ejecuta)

const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG = 'AI_waitlist_vendor_uid_2026-10-27_v1480';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const { resolveClientVendorFromMaster } = await import('../../src/pure/resolve-client-vendor.js');

  const apply = process.argv.includes('--apply');
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('AI — Backfill assignedVendorUid vacío en revision_waitlist');
  console.log('================================================================');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log();

  // 1. POINTS desde client_master.
  console.log('[1/5] Cargando client_master → POINTS...');
  const cmSnap = await db.collection('client_master').get();
  const points = {};
  cmSnap.forEach((d) => {
    const data = d.data() || {};
    const card = String(data.sapCardCode || '').trim();
    if (!card) return;
    points[card] = {
      cardCode: card,
      clientName: String(data.clientName || '').toUpperCase().trim(),
      provincia: String(data.provincia || '').toUpperCase().trim(),
      localidad: String(data.localidad || '').toUpperCase().trim(),
      vendor: String(data.vendor || '').toUpperCase().trim(),
    };
  });
  console.log(`  points: ${Object.keys(points).length}`);

  // 2. approvedAltas.
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

  // 3. Users (roles).
  console.log('[3/5] Cargando roles...');
  const rolesSnap = await db.collection('roles').get();
  const users = [];
  rolesSnap.forEach((d) => {
    const data = d.data() || {};
    const role = String(data.role || '').trim();
    if (!['vendedor', 'interno', 'admin', 'gerente'].includes(role)) return;
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

  // 4. Scan waitlists abiertas sin assignedVendorUid.
  console.log('[4/5] Scan revision_waitlist abiertos sin assignedVendorUid...');
  const wls = await db.collection('revision_waitlist').get();
  const victims = [];
  wls.forEach((d) => {
    const data = d.data() || {};
    if (data.closedAt || data.stage === 'consumed') return;
    const uid = String(data.assignedVendorUid || '').trim();
    if (!uid) {
      victims.push({ id: d.id, ref: d.ref, data });
    }
  });
  console.log(`  waitlists sin UID: ${victims.length}`);

  // 5. Resolver + aplicar.
  console.log('[5/5] Resolviendo + aplicando...');
  const results = { ok: 0, no_resolvable: 0, no_cardcode: 0, by_reason: {} };
  const detalles = [];
  const batches = [[]];
  const BATCH_LIMIT = 400;

  for (const v of victims) {
    const cardCode = String(v.data.clientCardCode || '').trim();
    const clientName = String(v.data.clientName || '').trim();
    if (!cardCode) {
      results.no_cardcode++;
      detalles.push({ id: v.id, orderNumber: v.data.orderNumber, cliente: clientName, reason: 'sin_cardCode' });
      continue;
    }
    const resolution = resolveClientVendorFromMaster({
      cardCode,
      clientName,
      points,
      vdiPartnerUsers: users,
      users,
      approvedAltas,
      getEffectiveVendorForClient: null,
      sapGetClienteCode: null,
    });
    const reason = resolution.reason || 'unknown';
    results.by_reason[reason] = (results.by_reason[reason] || 0) + 1;
    detalles.push({
      id: v.id,
      orderNumber: v.data.orderNumber,
      cliente: clientName,
      cardCode,
      currentVendorAssigned: v.data.vendorAssigned || '',
      resolvedVendorKey: resolution.vendorKey || '',
      resolvedVendorUid: resolution.vendorUid || '',
      reason,
    });
    if (resolution.resolved && resolution.vendorUid) {
      results.ok++;
      if (!apply) continue;
      const update = {
        assignedVendorUid: resolution.vendorUid,
        assignedVendorEmail: resolution.vendorEmail || null,
        vendorAssigned: resolution.vendorKey || v.data.vendorAssigned,
        ownerVendor: resolution.vendorKey || v.data.ownerVendor,
        assignedVendorReason: reason,
        _backfill: {
          ...(v.data._backfill || {}),
          [BACKFILL_SLUG]: {
            previousValues: {
              assignedVendorUid: v.data.assignedVendorUid || null,
              assignedVendorEmail: v.data.assignedVendorEmail || null,
              vendorAssigned: v.data.vendorAssigned || null,
              ownerVendor: v.data.ownerVendor || null,
            },
            resolvedTo: {
              vendorKey: resolution.vendorKey,
              vendorUid: resolution.vendorUid,
              vendorEmail: resolution.vendorEmail,
              reason,
            },
            by: 'scripts/audit/AI_backfill_waitlist_assigned_vendor_uid.cjs',
            at: nowIso,
          },
        },
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'scripts/audit/AI_backfill_waitlist_assigned_vendor_uid.cjs',
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
  console.log();
  console.log('Detalle por doc:');
  for (const d of detalles) {
    const resolvedBit = d.resolvedVendorUid
      ? ` → ${d.resolvedVendorKey} (${d.resolvedVendorUid.slice(0, 10)}…)`
      : ` → NO RESOLVED (reason=${d.reason})`;
    console.log(`  ORDEN ${d.orderNumber} ${d.cliente} [${d.cardCode}] vendorAssigned="${d.currentVendorAssigned}"${resolvedBit}`);
  }

  if (!apply) {
    console.log();
    console.log('DRY-RUN: no se escribió nada. Correr con --apply para ejecutar.');
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
  console.log(`\n✓ Backfill completo: ${totalWrites} waitlists actualizadas.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
