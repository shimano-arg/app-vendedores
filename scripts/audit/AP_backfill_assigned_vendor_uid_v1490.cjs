// AP v1490 §88 (2026-10-27) — backfill /pedidos.assignedVendorUid faltante.
//
// F5 del plan de visibilidad: completa `assignedVendorUid` + `vendorAssigned`
// + `assignedVendorEmail` + `assignedVendorReason` en pedidos legacy que
// quedaron sin esos campos (pre-§44 v1406 ó CPST que no re-resolvió).
//
// Fuentes master por prioridad:
//   1. approvedAltas (client_applications.status='approved') por cardCodeSap.
//   2. Fallback: si ownerUid es un VDE, usar sus datos (compat legacy — el
//      pedido lo cargó el VDE mismo y se mantiene su atribución).
//
// Snapshot §55: `_backfill.assigned_vendor_uid_v1490_2026-10-27` con los
// valores previos — reversible.
//
// Flags:
//   --apply       Ejecuta writes (default dry-run).
//   --limit N     Limita cantidad procesada (debug).

const PROJECT = 'app-vendedores-shimano';
const SLUG = 'assigned_vendor_uid_v1490_2026-10-27';

function normCardCode(x) {
  return String(x || '').trim().toUpperCase();
}

function normalizeVendorLabel(label) {
  let v = String(label || '').trim();
  if (!v) return '';
  if (v.match(/^Z\d+\s*-\s*/i)) v = v.replace(/^Z\d+\s*-\s*/i, '').trim();
  return v.toUpperCase();
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log(`AP — Backfill assignedVendorUid (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  console.log('================================================================\n');

  // 1. roles vendedor → maps.
  const rolesSnap = await db.collection('roles').get();
  const vendorToUid = new Map();
  const uidToVendor = new Map();
  const uidToEmail = new Map();
  rolesSnap.forEach((d) => {
    const data = d.data();
    if (data.role === 'vendedor' && data.vendor) {
      const key = String(data.vendor).trim().toUpperCase();
      vendorToUid.set(key, d.id);
      uidToVendor.set(d.id, data.vendor);
      uidToEmail.set(d.id, data.email || '');
    }
  });
  console.log(`[1] roles vendedor: ${vendorToUid.size}`);

  // 2. approvedAltas.
  const altaSnap = await db
    .collection('client_applications')
    .where('status', '==', 'approved')
    .get();
  const altasByCardCode = new Map();
  altaSnap.forEach((d) => {
    const data = d.data();
    const cc = normCardCode(data.cardCodeSap);
    if (cc) altasByCardCode.set(cc, data);
  });
  console.log(`[2] approvedAltas: ${altasByCardCode.size}`);

  // 3. Pedidos sin assignedVendorUid.
  const pedSnap = await db.collection('pedidos').get();
  console.log(`[3] Total pedidos: ${pedSnap.size}`);

  const candidates = [];
  for (const d of pedSnap.docs) {
    const data = d.data();
    if (data.assignedVendorUid) continue;

    const cc = normCardCode(data.clientCardCode);
    const cliente = data.clientName || cc || '(sin cliente)';
    const owner = data.ownerUid || '';
    const ownerEmail = data.ownerEmail || '';

    // Resolver vendor desde master.
    let resolvedVendor = '';
    let resolvedSource = '';
    const alta = altasByCardCode.get(cc);
    if (alta && alta.assignedVendor) {
      resolvedVendor = normalizeVendorLabel(alta.assignedVendor);
      resolvedSource = 'approvedAlta';
    } else if (owner && uidToVendor.has(owner)) {
      // Fallback legacy: pedido cargado por un VDE sin §44 → preservar su atribución.
      resolvedVendor = normalizeVendorLabel(uidToVendor.get(owner));
      resolvedSource = 'owner_is_vendor_legacy';
    }
    const resolvedUid = resolvedVendor ? vendorToUid.get(resolvedVendor) || '' : '';
    const resolvedEmail = resolvedUid ? uidToEmail.get(resolvedUid) || '' : '';

    if (!resolvedUid) {
      candidates.push({
        id: d.id,
        orderNumber: data.orderNumber || null,
        cliente,
        cardCode: cc,
        skip: 'no_vendor_resolvible',
        currentVendorAssigned: data.vendorAssigned || null,
        ownerUid: owner,
        ownerEmail,
      });
      continue;
    }

    candidates.push({
      id: d.id,
      orderNumber: data.orderNumber || null,
      cliente,
      cardCode: cc,
      resolvedVendor,
      resolvedUid,
      resolvedEmail,
      resolvedSource,
      previousValues: {
        assignedVendorUid: data.assignedVendorUid || null,
        assignedVendorEmail: data.assignedVendorEmail || null,
        vendorAssigned: data.vendorAssigned || null,
        ownerVendor: data.ownerVendor || null,
        assignedVendorReason: data.assignedVendorReason || null,
      },
      previousOwner: { uid: owner, email: ownerEmail },
    });
  }

  const toUpdate = candidates.filter((c) => c.resolvedUid);
  const skipped = candidates.filter((c) => c.skip);
  console.log(`[4] Candidatos sin assignedVendorUid: ${candidates.length}`);
  console.log(`    Actualizables: ${toUpdate.length}`);
  console.log(`    Skipped (no_vendor_resolvible): ${skipped.length}`);

  if (skipped.length) {
    console.log(`\n[5a] Skipped (no_vendor_resolvible):`);
    for (const s of skipped.slice(0, 20)) {
      console.log(
        `    ORDEN ${s.orderNumber || '?'} ${s.cliente.slice(0, 30).padEnd(30)}  cardCode=${s.cardCode || '(vacío)'}  ownerEmail=${s.ownerEmail.slice(0, 30)}`
      );
    }
    if (skipped.length > 20) console.log(`    ... (+${skipped.length - 20} más)`);
  }

  console.log(`\n[5b] Updates planeados${APPLY ? '' : ' (DRY-RUN; usa --apply)'}:`);
  for (const c of toUpdate.slice(0, 30)) {
    console.log(
      `    ORDEN ${c.orderNumber || '?'} ${c.cliente.slice(0, 25).padEnd(25)}  → ${c.resolvedVendor} (${c.resolvedUid.slice(0, 10)})  [source=${c.resolvedSource}]`
    );
  }
  if (toUpdate.length > 30) console.log(`    ... (+${toUpdate.length - 30} más)`);

  if (!APPLY) {
    console.log('\n[6] DRY-RUN completo. Autorizar con --apply.');
    return;
  }

  // Aplicar.
  console.log(`\n[6] Aplicando ${toUpdate.length} updates con snapshot _backfill...`);
  const nowIso = new Date().toISOString();
  const batchSize = 400;
  let applied = 0;
  for (let i = 0; i < toUpdate.length; i += batchSize) {
    const batch = db.batch();
    const chunk = toUpdate.slice(i, i + batchSize);
    for (const c of chunk) {
      const ref = db.collection('pedidos').doc(c.id);
      const _backfillEntry = {
        previousValues: c.previousValues,
        previousOwner: c.previousOwner,
        resolvedSource: c.resolvedSource,
        resolvedVendor: c.resolvedVendor,
        resolvedUid: c.resolvedUid,
        by: 'scripts/audit/AP_backfill_assigned_vendor_uid_v1490.cjs',
        at: nowIso,
      };
      batch.update(ref, {
        assignedVendorUid: c.resolvedUid,
        assignedVendorEmail: c.resolvedEmail,
        vendorAssigned: c.previousValues.vendorAssigned || c.resolvedVendor,
        assignedVendorReason: c.previousValues.assignedVendorReason || 'ok',
        [`_backfill.${SLUG}`]: _backfillEntry,
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'AP_v1490',
      });
    }
    await batch.commit();
    applied += chunk.length;
    console.log(`    aplicado ${applied}/${toUpdate.length}`);
  }

  console.log(`\n[7] Done. Updates aplicados: ${applied}`);
  console.log(`[7] Dump para rollback: _backfill.${SLUG}.previousValues`);

  // Dump para audit.
  const fs = require('node:fs');
  const path = require('node:path');
  const out = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, `AP_backfill_${SLUG}.json`),
    JSON.stringify({ nowIso, applied, toUpdate, skipped }, null, 2)
  );
  console.log(`[7] Audit: docs/auditoria/AP_backfill_${SLUG}.json`);
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
