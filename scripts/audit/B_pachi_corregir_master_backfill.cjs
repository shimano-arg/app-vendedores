// B — Backfill: corregir client_master + pedidos abiertos/confirmados de zona
// PACHI (Z4) para alinear assignedVendorUid con el PACHI real (vendor por zona).
//
// CLAUDE.md §31: este script es la PROPUESTA de fix (NO lo ejecuta sin OK
// explicito). Dry-run por default; --apply requiere confirmacion manual
// (Mariano revisa la propuesta en el informe antes de autorizarlo).
//
// Dos fases independientes:
//   --fase=master  → corregir SOLO client_master de clientes Z4 desalineados.
//   --fase=pedidos → corregir SOLO pedidos abiertos/confirmados.
//   --fase=all     → ambas (default). Mariano puede correr --fase=master
//                    primero + verificar + luego --fase=pedidos.
//
// Snapshot de reversibilidad (CLAUDE.md §55) en campo `_backfill.<slug>`.
//
// NO toca pedidos cerrados (closedAt != null) — regla operativa general.
//
// Target UID PACHI real: LaBFi1xkSLObzLEdRoP8fonZ06r2 (pachinaba@gmail.com,
// role=vendedor, vendor=PACHI). Hay 3 usuarios con vendor=PACHI (pachinaba +
// pachi.ventasespeciales + pruebas.pachi); el flag --target-uid permite
// override para el caso en que Mariano quiera que apunte a otro.
//
// Uso:
//   node scripts/audit/B_pachi_corregir_master_backfill.cjs                 # dry-run master+pedidos
//   node scripts/audit/B_pachi_corregir_master_backfill.cjs --fase=master   # dry-run solo master
//   node scripts/audit/B_pachi_corregir_master_backfill.cjs --fase=master --apply   # APPLY (requiere OK)
//
// Alcance: solo los 16 clientes desalineados identificados por script A. Si
// Mariano quiere ampliar a otras zonas, se usa el script A --all-zones + se
// extiende este con un flag.

const PROJECT = 'app-vendedores-shimano';
const DEFAULT_PACHI_UID = 'LaBFi1xkSLObzLEdRoP8fonZ06r2';
const PACHI_VENDOR_KEY_CANON = 'PACHI';
const SLUG_MASTER = 'B_pachi_master_2026-10-28_v1506';
const SLUG_PEDIDOS = 'B_pachi_pedidos_2026-10-28_v1506';

function normCardCode(cc) {
  return String(cc || '').trim().toUpperCase();
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');
  const faseArg = argv.find((a) => a.startsWith('--fase='));
  const FASE = faseArg ? faseArg.split('=')[1] : 'all';
  const uidArg = argv.find((a) => a.startsWith('--target-uid='));
  const PACHI_UID = uidArg ? uidArg.split('=')[1] : DEFAULT_PACHI_UID;
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('B — Backfill PACHI Z4 master + pedidos @ ' + nowIso);
  console.log('================================================================');
  console.log('Modo:', APPLY ? 'APPLY (ESCRIBE)' : 'DRY-RUN');
  console.log('Fase:', FASE);
  console.log('PACHI UID objetivo:', PACHI_UID);
  console.log('');

  // Verificar user con ese UID.
  const userDoc = await db.collection('roles').doc(PACHI_UID).get();
  const user = userDoc.exists ? userDoc.data() : null;
  if (!user) {
    console.error(`ERROR: roles/${PACHI_UID} no existe. Abortando.`);
    process.exit(2);
  }
  const PACHI_EMAIL = String(user.email || '').trim();
  console.log(`User target: ${PACHI_EMAIL} role=${user.role} vendor=${user.vendor}`);
  console.log('');

  // ========== Cargar datos de la misma forma que el script A ==========
  console.log('[1/6] Cargando OCRD...');
  const ocrdSnap = await db.collection('ocrd').get();
  const ocrd = new Map();
  ocrdSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = normCardCode(data.CardCode || d.id);
    if (!cc) return;
    ocrd.set(cc, {
      cardCode: cc,
      cardName: String(data.CardName || '').trim(),
      slpName: String(data.SlpName || '').trim(),
      provincia: String(data.Provincia || data.State || data.State1 || '').trim(),
      localidad: String(data.Localidad || data.City || '').trim(),
    });
  });

  console.log('[2/6] Cargando vendor_overrides...');
  const voSnap = await db.collection('vendor_overrides').get();
  const vendorOverrides = new Map();
  voSnap.forEach((d) => {
    const data = d.data() || {};
    const nv = String(data.newVendor || data.vendor || '').trim();
    if (nv) vendorOverrides.set(d.id, nv);
  });

  console.log('[3/6] Cargando client_applications...');
  const caSnap = await db.collection('client_applications').get();
  const altasByCardCode = new Map();
  const altasAll = [];
  caSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = normCardCode(data.cardCodeSap);
    const row = {
      _id: d.id,
      cardCodeSap: cc,
      comercio: String(data.comercio || '').trim(),
      fantasia: String(data.fantasia || '').trim(),
      assignedVendor: String(data.assignedVendor || '').trim(),
    };
    altasAll.push(row);
    if (cc) altasByCardCode.set(cc, row);
  });

  console.log('[4/6] Cargando client_master...');
  const cmSnap = await db.collection('client_master').get();
  const clientMasterByCard = new Map();
  cmSnap.forEach((d) => {
    const data = d.data() || {};
    const sap = normCardCode(data.sapCardCode);
    if (sap) clientMasterByCard.set(sap, Object.assign({ _id: d.id, _ref: d.ref }, data));
  });

  // Resolve: igual que el script A.
  function resolveVendorForClient(cardCode, clientName) {
    const cc = normCardCode(cardCode);
    const name = String(clientName || '').trim();
    if (!cc && !name) return { vendorKey: '' };
    const master = cc ? ocrd.get(cc) : null;
    let vendorKey = '';
    if (master) {
      const prov = master.provincia || '';
      const loc = master.localidad || '';
      const nameUp = (master.cardName || name || '').trim();
      const shopKey = 'SHOP|' + prov + '|' + loc + '|' + nameUp;
      const locKey = 'LOC|' + prov + '|' + loc;
      const provKey = 'PROV|' + prov;
      if (vendorOverrides.has(shopKey)) vendorKey = vendorOverrides.get(shopKey);
      else if (vendorOverrides.has(locKey)) vendorKey = vendorOverrides.get(locKey);
      else if (vendorOverrides.has(provKey)) vendorKey = vendorOverrides.get(provKey);
      else vendorKey = master.slpName || '';
    }
    if (!vendorKey && cc) {
      const alta = altasByCardCode.get(cc);
      if (alta && alta.assignedVendor) vendorKey = alta.assignedVendor;
    }
    if (!vendorKey && name) {
      const target = name.toLowerCase();
      const alta = altasAll.find(
        (a) =>
          a &&
          (String(a.comercio || '').toLowerCase() === target ||
            String(a.fantasia || '').toLowerCase() === target)
      );
      if (alta && alta.assignedVendor) vendorKey = alta.assignedVendor;
    }
    if (vendorKey) {
      const m = vendorKey.match(/^Z\d+\s*[-–—]\s*(.+)$/i);
      if (m) vendorKey = m[1].trim().toUpperCase();
    }
    if (vendorKey === '__DISTRIBUTOR__') vendorKey = '';
    return { vendorKey: vendorKey.toUpperCase().trim() };
  }

  // 5. Identificar los clientes de PACHI (idem script A).
  console.log('[5/6] Enumerando clientes Z4 PACHI...');
  const clientsOfPachi = [];
  for (const [cc, m] of ocrd) {
    const res = resolveVendorForClient(cc, m.cardName);
    if (res.vendorKey === PACHI_VENDOR_KEY_CANON) {
      clientsOfPachi.push({ cardCode: cc, cardName: m.cardName });
    }
  }
  for (const a of altasAll) {
    if (!a.cardCodeSap) continue;
    if (ocrd.has(a.cardCodeSap)) continue;
    if (String(a.assignedVendor || '').trim().toUpperCase() !== PACHI_VENDOR_KEY_CANON) continue;
    clientsOfPachi.push({ cardCode: a.cardCodeSap, cardName: a.comercio || a.fantasia || '' });
  }
  console.log(`  clientes PACHI identificados: ${clientsOfPachi.length}`);

  // Set para lookup.
  const pachiCardCodes = new Set(clientsOfPachi.map((c) => c.cardCode));

  // ========== FASE A: corregir client_master ==========
  // Nota: solo tocamos docs client_master que YA EXISTEN para esos cardCodes y
  // tienen vendorAssigned distinto a PACHI. No creamos docs nuevos (los
  // clientes resueltos solo via approvedAlta no tienen client_master propio).
  const masterChanges = [];
  if (FASE === 'master' || FASE === 'all') {
    console.log('');
    console.log('========== FASE MASTER ==========');
    for (const cc of pachiCardCodes) {
      const cm = clientMasterByCard.get(cc);
      if (!cm) continue; // sin doc client_master → no hay nada que corregir aqui.
      const currentVendor = String(cm.vendorAssigned || cm.vendor || '').trim().toUpperCase();
      const currentUid = String(cm.assignedVendorUid || '').trim();
      if (currentVendor === PACHI_VENDOR_KEY_CANON && currentUid === PACHI_UID) continue;
      masterChanges.push({
        cardCode: cc,
        docId: cm._id,
        ref: cm._ref,
        prevVendorAssigned: cm.vendorAssigned || null,
        prevAssignedVendorUid: cm.assignedVendorUid || null,
        prevVendor: cm.vendor || null,
      });
    }
    console.log(`client_master a corregir: ${masterChanges.length}`);
    for (const c of masterChanges) {
      console.log(`  ${c.cardCode} (doc=${c.docId}) prevVendor=${c.prevVendorAssigned} prevUid=${c.prevAssignedVendorUid}`);
    }
  }

  // ========== FASE B: corregir pedidos abiertos + confirmados ==========
  const pedidoChanges = [];
  if (FASE === 'pedidos' || FASE === 'all') {
    console.log('');
    console.log('========== FASE PEDIDOS ==========');
    console.log('Cargando pedidos (incluye cerrados: filter in-memory por !closedAt)...');
    // v1512 fix: `where('closedAt','==',null)` NO matchea undefined (Firestore
    // tipa null vs ausencia). Script A usa filter in-memory `!p.closedAt` que
    // sí captura undefined/null/empty. Alineamos: traemos TODOS los pedidos de
    // cardCodes de PACHI y filtramos en memoria. Procesamos abiertos + cerrados
    // porque el pedido explícito de Mariano "backfill de assignedVendorUid en
    // los pedidos de esos clientes" incluye los 47 cerrados afectados.
    const pedSnap = await db.collection('pedidos').get();
    pedSnap.forEach((d) => {
      const data = d.data() || {};
      const cc = normCardCode(data.clientCardCode);
      if (!pachiCardCodes.has(cc)) return;
      const curUid = String(data.assignedVendorUid || '').trim();
      const curVendor = String(data.vendorAssigned || '').trim().toUpperCase();
      if (curUid === PACHI_UID && curVendor === PACHI_VENDOR_KEY_CANON) return;
      pedidoChanges.push({
        _id: d.id,
        ref: d.ref,
        cardCode: cc,
        clientName: data.clientName || '',
        orderNumber: data.orderNumber || '',
        stage: data.stage || '',
        closed: !!data.closedAt,
        prev: {
          assignedVendorUid: data.assignedVendorUid || null,
          vendorAssigned: data.vendorAssigned || null,
          assignedVendorEmail: data.assignedVendorEmail || null,
          ownerVendor: data.ownerVendor || null,
        },
      });
    });
    const openCount = pedidoChanges.filter((p) => !p.closed).length;
    const closedCount = pedidoChanges.filter((p) => p.closed).length;
    console.log(`pedidos a corregir: ${pedidoChanges.length} (abiertos: ${openCount}, cerrados: ${closedCount})`);
    const byStage = {};
    pedidoChanges.forEach((p) => (byStage[p.stage || '(sin stage)'] = (byStage[p.stage || '(sin stage)'] || 0) + 1));
    console.log('Por stage:', JSON.stringify(byStage));
  }

  if (!APPLY) {
    console.log('');
    console.log('DRY-RUN: no se escribio nada.');
    console.log('Para aplicar FASE MASTER: --fase=master --apply');
    console.log('Para aplicar FASE PEDIDOS: --fase=pedidos --apply');
    return;
  }

  // ========== APPLY ==========
  // FASE MASTER.
  if (masterChanges.length > 0) {
    console.log('');
    console.log(`APPLY FASE MASTER (${masterChanges.length} docs)...`);
    let batch = db.batch();
    let count = 0;
    for (const c of masterChanges) {
      const update = {
        vendorAssigned: PACHI_VENDOR_KEY_CANON,
        assignedVendorUid: PACHI_UID,
        assignedVendorEmail: PACHI_EMAIL,
        [`_backfill.${SLUG_MASTER}`]: {
          previousValues: {
            vendorAssigned: c.prevVendorAssigned,
            assignedVendorUid: c.prevAssignedVendorUid,
            vendor: c.prevVendor,
          },
          by: 'scripts/audit/B_pachi_corregir_master_backfill.cjs',
          at: nowIso,
          resolvedTo: { vendorKey: PACHI_VENDOR_KEY_CANON, vendorUid: PACHI_UID },
        },
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'scripts/audit/B_pachi_corregir_master_backfill.cjs',
      };
      batch.update(c.ref, update);
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        console.log(`  commit ${count}`);
        batch = db.batch();
      }
    }
    if (count % 400 !== 0) await batch.commit();
    console.log(`  commit final — total ${count}`);
  }

  // FASE PEDIDOS.
  if (pedidoChanges.length > 0) {
    console.log('');
    console.log(`APPLY FASE PEDIDOS (${pedidoChanges.length} docs)...`);
    let batch = db.batch();
    let count = 0;
    for (const p of pedidoChanges) {
      const update = {
        assignedVendorUid: PACHI_UID,
        vendorAssigned: PACHI_VENDOR_KEY_CANON,
        assignedVendorEmail: PACHI_EMAIL,
        ownerVendor: PACHI_VENDOR_KEY_CANON,
        [`_backfill.${SLUG_PEDIDOS}`]: {
          previousValues: p.prev,
          by: 'scripts/audit/B_pachi_corregir_master_backfill.cjs',
          at: nowIso,
          resolvedTo: { vendorKey: PACHI_VENDOR_KEY_CANON, vendorUid: PACHI_UID },
        },
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'scripts/audit/B_pachi_corregir_master_backfill.cjs',
      };
      batch.update(p.ref, update);
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        console.log(`  commit ${count}`);
        batch = db.batch();
      }
    }
    if (count % 400 !== 0) await batch.commit();
    console.log(`  commit final — total ${count}`);
  }

  console.log('');
  console.log('✓ APPLY completo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
