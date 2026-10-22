// Q — read-only prod: lista pedidos/revision_waitlist abiertos con vendedor
// desalineado respecto al cliente master. Dos escenarios:
//   A) ownerVendor vacío o '—'
//   B) ownerVendor != vendorKey del cliente master (OCRD)
//
// Soporta --dry-run (default) + --apply (requiere OK Mariano) para backfill.
// Backfill setea `vendorAssigned`, `assignedVendorUid`, `assignedVendorEmail`,
// `ownerVendor` alineados al master; `cargadoPorUid`/`cargadoPorEmail`
// copiados desde `ownerUid`/`ownerEmail` existentes (preserva "quién cargó").
//
// Autorizado por Mariano 2026-10-22 (v1406 §44).

const PROJECT = 'app-vendedores-shimano';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const COLLECTION_FILTER = argv.find((a) => a.startsWith('--only='))
  ? argv.find((a) => a.startsWith('--only=')).split('=')[1]
  : 'both'; // pedidos | waitlist | both

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('Q — Vendedor desalineado @ ' + nowIso);
  console.log('================================================================');
  console.log('Modo:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log('Colecciones:', COLLECTION_FILTER);
  console.log();

  // 1. OCRD: cardCode → vendorKey (SlpName).
  const ocrdSnap = await db.collection('ocrd').get();
  /** @type {Map<string, {cardCode:string, cardName:string, slpName:string}>} */
  const ocrd = new Map();
  ocrdSnap.forEach((d) => {
    const data = d.data() || {};
    const cardCode = data.CardCode || d.id;
    const slpName = (data.SlpName || '').trim();
    const cardName = data.CardName || '';
    if (cardCode) ocrd.set(cardCode, { cardCode, cardName, slpName });
  });
  console.log('OCRD cargado:', ocrd.size, 'clientes.');

  // 2. Users: vendorKey → {uid, email}.
  const usersSnap = await db.collection('users').get();
  /** @type {Map<string, {uid:string, email:string, vendorKey:string}>} */
  const vendorKeyToUser = new Map();
  usersSnap.forEach((d) => {
    const data = d.data() || {};
    const vendorKey = (data.vendor || '').trim();
    const role = (data.role || '').trim();
    if (!vendorKey) return;
    // Preferir users con role=vendedor; fallback a cualquier user con ese vendorKey.
    const existing = vendorKeyToUser.get(vendorKey);
    if (!existing || role === 'vendedor') {
      vendorKeyToUser.set(vendorKey, {
        uid: d.id,
        email: data.email || '',
        vendorKey,
      });
    }
  });
  console.log('Users con vendorKey:', vendorKeyToUser.size);
  console.log();

  // 3. Query pedidos abiertos (closedAt=null) + revision_waitlist abiertos
  //    (stage!=consumed, closedAt=null).
  const collections =
    COLLECTION_FILTER === 'pedidos' ? ['pedidos'] :
    COLLECTION_FILTER === 'waitlist' ? ['revision_waitlist'] :
    ['pedidos', 'revision_waitlist'];

  const misalignedByCol = { pedidos: [], revision_waitlist: [] };

  for (const col of collections) {
    const snap = await db.collection(col).get();
    snap.forEach((d) => {
      const data = d.data() || {};
      // Filtros abierto.
      if (data.closedAt) return;
      if (col === 'revision_waitlist' && data.stage === 'consumed') return;
      const cardCode = String(data.clientCardCode || data.cardCode || '').trim();
      if (!cardCode) {
        // Sin cardCode: no podemos resolver. Reportar aparte.
        misalignedByCol[col].push({
          id: d.id,
          cardCode: '',
          clientName: data.clientName || '',
          orderNumber: data.orderNumber || null,
          currentOwnerVendor: data.ownerVendor || '',
          currentAssignedVendorUid: data.assignedVendorUid || '',
          masterVendorKey: '(sin cardCode)',
          masterVendorUid: '',
          cargadoPor: data.ownerEmail || data.ownerUid || '',
          reason: 'sin_cardcode',
        });
        return;
      }
      const master = ocrd.get(cardCode);
      if (!master) {
        misalignedByCol[col].push({
          id: d.id,
          cardCode,
          clientName: data.clientName || '',
          orderNumber: data.orderNumber || null,
          currentOwnerVendor: data.ownerVendor || '',
          currentAssignedVendorUid: data.assignedVendorUid || '',
          masterVendorKey: '(cliente no en OCRD)',
          masterVendorUid: '',
          cargadoPor: data.ownerEmail || data.ownerUid || '',
          reason: 'cliente_no_en_ocrd',
        });
        return;
      }
      const masterVendorKey = master.slpName || '';
      const user = vendorKeyToUser.get(masterVendorKey) || null;
      const masterVendorUid = user ? user.uid : '';
      const curOwnerVendor = (data.ownerVendor || '').trim();
      const curAssigned = (data.assignedVendorUid || '').trim();
      const needsFix =
        !curAssigned ||
        !curOwnerVendor ||
        curOwnerVendor !== masterVendorKey ||
        curAssigned !== masterVendorUid;
      if (!needsFix) return;
      misalignedByCol[col].push({
        id: d.id,
        cardCode,
        clientName: data.clientName || master.cardName || '',
        orderNumber: data.orderNumber || null,
        currentOwnerVendor: curOwnerVendor,
        currentAssignedVendorUid: curAssigned,
        masterVendorKey,
        masterVendorUid,
        masterVendorEmail: user ? user.email : '',
        cargadoPor: data.ownerEmail || data.ownerUid || '',
        reason: !masterVendorKey ? 'cliente_sin_vendedor_en_master' : 'desalineado',
      });
    });
  }

  // 4. Print report.
  for (const col of collections) {
    const rows = misalignedByCol[col];
    console.log('===== ' + col + ' (' + rows.length + ' desalineados) =====');
    if (rows.length === 0) {
      console.log('  (ninguno)');
      console.log();
      continue;
    }
    rows.sort((a, b) => (a.orderNumber || 0) - (b.orderNumber || 0));
    console.log(
      '| ORDEN | Cliente | CardCode | Actual ownerVendor | → Master vendor | Cargado por | Reason |'
    );
    console.log('|---|---|---|---|---|---|---|');
    for (const r of rows) {
      console.log(
        '| ' + (r.orderNumber || '-') +
        ' | ' + (r.clientName || '').slice(0, 35) +
        ' | ' + r.cardCode +
        ' | ' + (r.currentOwnerVendor || '(vacío)') +
        ' | ' + r.masterVendorKey +
        ' | ' + (r.cargadoPor || '').slice(0, 25) +
        ' | ' + r.reason +
        ' |'
      );
    }
    console.log();
  }

  // 5. Markdown.
  const fs = require('node:fs');
  const path = require('node:path');
  const outPath = path.join(__dirname, '..', '..', 'docs', 'auditoria', '35_VENDEDOR_DESALINEADO.md');
  const md = [
    '# Q — Vendedor desalineado @ ' + nowIso,
    '',
    'Modo: ' + (APPLY ? 'APPLY' : 'DRY-RUN') + '. Colecciones: ' + COLLECTION_FILTER + '.',
    '',
  ];
  for (const col of collections) {
    const rows = misalignedByCol[col];
    md.push('## ' + col + ' (' + rows.length + ' desalineados)');
    md.push('');
    if (rows.length === 0) {
      md.push('(ninguno)');
      md.push('');
      continue;
    }
    md.push('| ORDEN | Cliente | CardCode | Actual ownerVendor | → Master vendor | Cargado por | Reason |');
    md.push('|---|---|---|---|---|---|---|');
    for (const r of rows) {
      md.push(
        '| ' + (r.orderNumber || '-') +
        ' | ' + (r.clientName || '').replace(/\|/g, '/').slice(0, 50) +
        ' | ' + r.cardCode +
        ' | ' + (r.currentOwnerVendor || '(vacío)') +
        ' | ' + r.masterVendorKey +
        ' | ' + (r.cargadoPor || '').slice(0, 30) +
        ' | ' + r.reason +
        ' |'
      );
    }
    md.push('');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md.join('\n'), 'utf8');
  console.log('Markdown escrito en:', outPath);
  console.log();

  // 6. Apply backfill si corresponde.
  if (!APPLY) {
    console.log('DRY-RUN finalizado. Volvé a correr con --apply para persistir cambios.');
    return;
  }
  console.log('===== APLICANDO BACKFILL =====');
  for (const col of collections) {
    const rows = misalignedByCol[col].filter((r) => r.reason === 'desalineado');
    console.log('[' + col + '] backfill de ' + rows.length + ' docs...');
    let ok = 0;
    let fail = 0;
    for (const r of rows) {
      try {
        const updateData = {
          vendorAssigned: r.masterVendorKey || '',
          assignedVendorUid: r.masterVendorUid || '',
          assignedVendorEmail: r.masterVendorEmail || '',
          ownerVendor: r.masterVendorKey || '',
          _v44BackfillAt: nowIso,
          _v44BackfillBy: 'scripts/audit/Q_vendedor_desalineado.cjs',
        };
        // Preservar cargadoPor desde ownerUid/ownerEmail si falta.
        const docSnap = await db.collection(col).doc(r.id).get();
        const existing = docSnap.data() || {};
        if (!existing.cargadoPorUid && existing.ownerUid) {
          updateData.cargadoPorUid = existing.ownerUid;
        }
        if (!existing.cargadoPorEmail && existing.ownerEmail) {
          updateData.cargadoPorEmail = existing.ownerEmail;
        }
        await db.collection(col).doc(r.id).update(updateData);
        ok++;
      } catch (e) {
        fail++;
        console.error('[' + col + '/' + r.id + '] FAIL:', (e && e.message) || String(e));
      }
    }
    console.log('[' + col + '] OK ' + ok + ' · FAIL ' + fail);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
