#!/usr/bin/env node
// T — Diagnóstico y backfill: revision_waitlist con assignedVendorUid
// desalineado respecto al vendedor del cliente master.
//
// CLAUDE.md §46 (v1408 §46 + v1412 §50): el vendedor del cliente master se
// resuelve con la cadena OCRD + vendor_overrides (shop/loc/prov) → fallback
// a client_applications por cardCodeSap. El VDE que carga el pedido queda
// en `ownerUid` / `cargadoPorUid`; el VDE del cliente (filtro del Planner y
// de la lista de espera) queda en `assignedVendorUid`.
//
// Bug reportado 2026-10-23 (fix-visibilidad-waitlist-vendedor-master):
//   - ORDEN 516 BROBRO SA (cardCode C30718510291) la cargó Pablo
//     (ownerUid=UID_PABLO) pero el cliente es de Gonzalo De La Rosa.
//   - Sidebar waitlist del VDE filtraba `w.ownerUid === myUid || ...vendor` →
//     ocultaba la 516 a Gonzalo mientras el guard §42.2 le pedía unificar.
//   - El fix cambia el filtro a `assignedVendorUid` (patrón Planner v1092).
//   - Este script detecta waitlists donde `assignedVendorUid` falta o difiere
//     del vendedor del cliente master. `--apply` lo backfillea con snapshot
//     `_backfill` (CLAUDE.md §55).
//
// Uso:
//   node scripts/audit/T_waitlist_vendor_desalineado.cjs           # dry-run
//   node scripts/audit/T_waitlist_vendor_desalineado.cjs --apply   # persist
//
// ADC: `gcloud auth application-default login` o SA key via GOOGLE_APPLICATION_CREDENTIALS.
// firebase-admin: reusa el del repo (functions/node_modules/firebase-admin).

const PROJECT = 'app-vendedores-shimano';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const SLUG = 'T_waitlist_vendor_realignment_2026-10-23_v1437';

function normCardCode(cc) {
  return String(cc || '').trim().toUpperCase();
}

function normVendorKey(v) {
  const s = String(v || '').trim();
  const m = s.match(/^Z\d+\s*[-–—]\s*(.+)$/i);
  return (m ? m[1].trim() : s).toUpperCase();
}

async function main() {
  // Reusa firebase-admin del repo principal (worktree sin node_modules).
  const path = require('node:path');
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const admin = require(path.join(repoRoot, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('T — Waitlist vendor desalineado @ ' + nowIso);
  console.log('================================================================');
  console.log('Modo:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log();

  // 1. OCRD: cardCode normalizado → {cardName, slpName (vendorKey base), prov, loc}.
  const ocrdSnap = await db.collection('ocrd').get();
  /** @type {Map<string, {cardCode:string, cardName:string, slpName:string, provincia:string, localidad:string}>} */
  const ocrd = new Map();
  ocrdSnap.forEach((d) => {
    const data = d.data() || {};
    const cardCode = normCardCode(data.CardCode || d.id);
    const slpName = normVendorKey(data.SlpName || '');
    const cardName = String(data.CardName || '').trim();
    const provincia = String(data.Provincia || data.State || data.State1 || '').trim();
    const localidad = String(data.Localidad || data.City || '').trim();
    if (cardCode) ocrd.set(cardCode, { cardCode, cardName, slpName, provincia, localidad });
  });
  console.log('OCRD cargado:', ocrd.size, 'clientes.');

  // 2. vendor_overrides por shop/loc/prov.
  const voSnap = await db.collection('vendor_overrides').get();
  /** @type {Map<string, string>} */
  const vendorOverrides = new Map();
  voSnap.forEach((d) => {
    const data = d.data() || {};
    const newVendor = normVendorKey(data.newVendor || data.vendor || '');
    const key = String(data.key || d.id || '').trim();
    if (key && newVendor) vendorOverrides.set(key, newVendor);
  });
  console.log('vendor_overrides cargado:', vendorOverrides.size);

  // 3. client_applications (altas SAP huérfanas): cardCodeSap → assignedVendor.
  const caSnap = await db.collection('client_applications').get();
  /** @type {Map<string, string>} */
  const altasByCC = new Map();
  caSnap.forEach((d) => {
    const data = d.data() || {};
    const cardCode = normCardCode(data.cardCodeSap || '');
    const av = normVendorKey(data.assignedVendor || '');
    if (cardCode && av) altasByCC.set(cardCode, av);
  });
  console.log('client_applications con cardCodeSap+assignedVendor:', altasByCC.size);

  // 4. roles: vendorKey → {uid, email} (precedencia vendedor > interno > gerente > admin).
  const rolesSnap = await db.collection('roles').get();
  /** @type {Map<string, {uid:string, email:string}>} */
  const rolesByVendorKey = new Map();
  const precedence = { vendedor: 4, interno: 3, gerente: 2, admin: 1 };
  rolesSnap.forEach((d) => {
    const data = d.data() || {};
    const role = String(data.role || '').trim();
    const vendorKey = normVendorKey(data.vendor || '');
    const uid = d.id;
    const email = String(data.email || '').trim();
    if (!vendorKey) return;
    const cur = rolesByVendorKey.get(vendorKey);
    const prio = precedence[role] || 0;
    if (!cur || prio > (cur._prio || 0)) {
      rolesByVendorKey.set(vendorKey, { uid, email, _prio: prio });
    }
  });
  console.log('roles indexado por vendorKey:', rolesByVendorKey.size);

  function resolveVendorForCliente(cardCode, clientName) {
    const cc = normCardCode(cardCode);
    const name = String(clientName || '').trim();
    const o = cc && ocrd.get(cc);
    if (o) {
      // Overrides: SHOP > LOC > PROV > slpName.
      const shopKey = `SHOP|${o.provincia}|${o.localidad}|${o.cardName}`;
      const locKey = `LOC|${o.provincia}|${o.localidad}`;
      const provKey = `PROV|${o.provincia}`;
      const vendor =
        vendorOverrides.get(shopKey) ||
        vendorOverrides.get(locKey) ||
        vendorOverrides.get(provKey) ||
        o.slpName ||
        '';
      if (vendor) {
        return { vendorKey: vendor, source: 'ocrd' };
      }
      return { vendorKey: '', source: 'ocrd_sin_slpname' };
    }
    // Fallback altas.
    if (cc && altasByCC.has(cc)) {
      return { vendorKey: altasByCC.get(cc), source: 'approvedAlta' };
    }
    return { vendorKey: '', source: 'no_master' };
  }

  // 5. Recorrer revision_waitlist abiertos.
  const wlSnap = await db.collection('revision_waitlist').get();
  console.log('revision_waitlist docs:', wlSnap.size);

  const rows = [];
  wlSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.closedAt) return;
    if (data.stage === 'consumed') return;
    const cc = normCardCode(data.clientCardCode || '');
    const name = String(data.clientName || '').trim();
    const r = resolveVendorForCliente(cc, name);
    const expectedVendorKey = r.vendorKey;
    const role = rolesByVendorKey.get(expectedVendorKey);
    const expectedUid = (role && role.uid) || '';
    const expectedEmail = (role && role.email) || '';
    const currentAssignedUid = String(data.assignedVendorUid || '').trim();
    const currentOwnerUid = String(data.ownerUid || '').trim();
    const currentOwnerVendor = normVendorKey(data.ownerVendor || '');
    const currentVendorAssigned = normVendorKey(data.vendorAssigned || '');

    const aligned =
      expectedUid && currentAssignedUid === expectedUid &&
      expectedVendorKey && currentVendorAssigned === expectedVendorKey;

    const reason = !expectedVendorKey
      ? r.source
      : !expectedUid
      ? 'vendor_sin_uid'
      : currentAssignedUid === expectedUid
      ? 'ok'
      : 'desalineado';

    rows.push({
      wlId: d.id,
      orderNumber: data.orderNumber || '',
      clientCardCode: cc,
      clientName: name,
      createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : '',
      ownerEmail: data.ownerEmail || '',
      currentOwnerUid,
      currentOwnerVendor,
      currentVendorAssigned,
      currentAssignedUid,
      expectedVendorKey,
      expectedUid,
      expectedEmail,
      resolveSource: r.source,
      reason,
      aligned: !!aligned,
    });
  });

  const unaligned = rows.filter((r) => r.reason === 'desalineado');
  const vendorSinUid = rows.filter((r) => r.reason === 'vendor_sin_uid');
  const sinMaster = rows.filter((r) => r.reason === 'no_master' || r.reason === 'ocrd_sin_slpname');
  const okRows = rows.filter((r) => r.reason === 'ok');

  console.log();
  console.log('Resumen:');
  console.log('  OK (aligned):', okRows.length);
  console.log('  Desalineado (fix candidate):', unaligned.length);
  console.log('  Vendor sin UID (requiere alta user):', vendorSinUid.length);
  console.log('  Sin master (cliente no en OCRD/altas):', sinMaster.length);
  console.log('  TOTAL waitlists abiertos revisados:', rows.length);
  console.log();

  if (unaligned.length) {
    console.log('--- Desalineados (muestra top 50) ---');
    for (const r of unaligned.slice(0, 50)) {
      console.log(
        `  ORDEN ${r.orderNumber || '?'} | ${r.clientCardCode || '?'} ${r.clientName}`,
      );
      console.log(
        `    actual: assignedVendorUid=${r.currentAssignedUid || '""'} vendorAssigned=${r.currentVendorAssigned || '""'} ownerUid=${r.currentOwnerUid || '""'} (${r.ownerEmail})`,
      );
      console.log(
        `    master: vendorKey=${r.expectedVendorKey} uid=${r.expectedUid} email=${r.expectedEmail} source=${r.resolveSource}`,
      );
    }
    console.log();
  }

  // Caso focal pedido Mariano: ORDEN 516 BROBRO (C30718510291).
  const brobro = rows.find(
    (r) => r.clientCardCode === 'C30718510291' || String(r.orderNumber) === '516',
  );
  if (brobro) {
    console.log('--- Caso focal ORDEN 516 / BROBRO (C30718510291) ---');
    console.log(JSON.stringify(brobro, null, 2));
    console.log();
  }

  if (!APPLY) {
    console.log('[DRY-RUN] No se escribe nada. Correr con --apply tras OK de Mariano.');
    return;
  }

  // 6. --apply: backfill con snapshot (_backfill §55).
  console.log('--- APPLY ---');
  let patched = 0;
  for (const r of unaligned) {
    const ref = db.collection('revision_waitlist').doc(r.wlId);
    const snap = await ref.get();
    const data = snap.data() || {};
    const previousValues = {
      assignedVendorUid: data.assignedVendorUid || '',
      assignedVendorEmail: data.assignedVendorEmail || '',
      vendorAssigned: data.vendorAssigned || '',
      ownerVendor: data.ownerVendor || '',
    };
    const updatePayload = {
      assignedVendorUid: r.expectedUid,
      assignedVendorEmail: r.expectedEmail,
      vendorAssigned: r.expectedVendorKey,
      ownerVendor: r.expectedVendorKey,
      _backfill: Object.assign({}, data._backfill, {
        [SLUG]: {
          previousValues,
          by: 'scripts/audit/T_waitlist_vendor_desalineado.cjs',
          at: nowIso,
          reason: r.reason,
          expectedVendorKey: r.expectedVendorKey,
          resolveSource: r.resolveSource,
        },
      }),
      _lastBackfillAt: nowIso,
      _lastBackfillBy: 'scripts/audit/T_waitlist_vendor_desalineado.cjs',
    };
    await ref.update(updatePayload);
    patched += 1;
  }
  console.log('Waitlists backfilleados:', patched);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
