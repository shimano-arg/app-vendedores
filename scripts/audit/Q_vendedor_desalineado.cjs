// Q — read-only prod: lista pedidos/revision_waitlist abiertos con vendedor
// desalineado respecto al cliente master.
//
// v1412 §50 (2026-10-22) — EXTIENDE §46 agregando `client_applications` como
// 2da fuente del master. Las altas SAP huérfanas viven ahí con
// `assignedVendor` directo (NO en vendor_overrides). Antes el script y el
// helper client-side las descartaban → BURELLA y COLLI quedaban sin vendor.
//
// Cadena de resolución post-v1412:
//   1. OCRD + vendor_overrides (shop/loc/prov) → vendor base.
//   2. Si (1) no da nada: client_applications por cardCodeSap → assignedVendor.
//
// v1408 §46 (2026-10-22) — reescrito para usar la MISMA cadena que el app:
//   cliente (cardCode) → OCRD.SlpName (base) → vendor_overrides por shop/loc/prov → vendor efectivo.
//
// Lookup del UID del vendedor: colección `roles` con filtro por rol = vendedor
// OR interno OR gerente OR admin. Esto cubre:
//   - VDE: role='vendedor', campo `vendor` tiene el vendorKey canónico (ej MAURICIO GIL).
//   - VDI: role='interno', campo `vendor` o fallback a VDI_VENDOR_KEYS historico.
//   - Gerente/Admin: `vendor` como ADMIN_<uid>, matchean el value del dropdown.
//
// Reasons output:
//   - desalineado: hay vendor del master pero el pedido tiene distinto (o vacío).
//   - cliente_no_en_ocrd: cardCode no existe en OCRD.
//   - cliente_sin_zona: pedido sin clientCardCode populated.
//   - zona_sin_vendedor: OCRD existe pero SlpName vacío (y sin override).
//   - vendor_sin_uid: vendorKey resuelto pero sin user match en roles (backfill
//     deja ownerVendor/vendorAssigned populated pero assignedVendorUid='').
//
// Soporta --dry-run (default) + --apply (requiere OK Mariano explícito tras
// revisar el markdown).

const PROJECT = 'app-vendedores-shimano';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ONLY_ARG = argv.find((a) => a.startsWith('--only='));
const COLLECTION_FILTER = ONLY_ARG ? ONLY_ARG.split('=')[1] : 'both';

function normCardCode(cc) {
  return String(cc || '').trim().toUpperCase();
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('Q v1408 — Vendedor desalineado @ ' + nowIso);
  console.log('================================================================');
  console.log('Modo:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log('Colecciones:', COLLECTION_FILTER);
  console.log();

  // 1. OCRD: cardCode normalizado → {cardName, slpName, provincia, localidad}.
  const ocrdSnap = await db.collection('ocrd').get();
  /** @type {Map<string, {cardCode:string, cardName:string, slpName:string, provincia:string, localidad:string}>} */
  const ocrd = new Map();
  ocrdSnap.forEach((d) => {
    const data = d.data() || {};
    const cardCode = normCardCode(data.CardCode || d.id);
    const slpName = String(data.SlpName || '').trim();
    const cardName = String(data.CardName || '').trim();
    const provincia = String(data.Provincia || data.State || data.State1 || '').trim();
    const localidad = String(data.Localidad || data.City || '').trim();
    if (cardCode) ocrd.set(cardCode, { cardCode, cardName, slpName, provincia, localidad });
  });
  console.log('OCRD cargado:', ocrd.size, 'clientes.');

  // 2. vendor_overrides: zonasKey → newVendor.
  //    - SHOP|<prov>|<loc>|<clientName>
  //    - LOC|<prov>|<loc>
  //    - PROV|<prov>
  const voSnap = await db.collection('vendor_overrides').get();
  /** @type {Map<string, string>} */
  const vendorOverrides = new Map();
  voSnap.forEach((d) => {
    const data = d.data() || {};
    const newVendor = String(data.newVendor || data.vendor || '').trim();
    if (newVendor) vendorOverrides.set(d.id, newVendor);
  });
  console.log('vendor_overrides cargados:', vendorOverrides.size);

  // 2.5. v1412 §50: client_applications (altas SAP) → map cardCodeSap → {assignedVendor}.
  const altasSnap = await db.collection('client_applications').get();
  /** @type {Map<string, {cardCodeSap:string, comercio:string, assignedVendor:string}>} */
  const altasByCardCode = new Map();
  /** @type {Array<any>} */
  const altasByName = [];
  altasSnap.forEach((d) => {
    const data = d.data() || {};
    const cardCodeSap = normCardCode(data.cardCodeSap);
    const assignedVendor = String(data.assignedVendor || '').trim();
    const comercio = String(data.comercio || '').trim();
    const fantasia = String(data.fantasia || '').trim();
    if (cardCodeSap) {
      altasByCardCode.set(cardCodeSap, { cardCodeSap, comercio, assignedVendor });
    }
    if (comercio || fantasia) {
      altasByName.push({ comercio, fantasia, assignedVendor, cardCodeSap });
    }
  });
  console.log('client_applications (altas SAP) cargadas:', altasByCardCode.size);

  // 3. roles: vendorKey → {uid, email, role}.
  const rolesSnap = await db.collection('roles').get();
  /** @type {Map<string, {uid:string, email:string, role:string, vendorKey:string}>} */
  const vendorKeyToUser = new Map();
  rolesSnap.forEach((d) => {
    const data = d.data() || {};
    const role = String(data.role || '').trim();
    const vendorKey = String(data.vendor || '').trim();
    if (!vendorKey) return;
    const existing = vendorKeyToUser.get(vendorKey);
    // Precedencia: vendedor > interno > gerente > admin > otros.
    const rank = { vendedor: 4, interno: 3, gerente: 2, admin: 1 };
    const currRank = rank[role] || 0;
    const prevRank = existing ? rank[existing.role] || 0 : -1;
    if (!existing || currRank > prevRank) {
      vendorKeyToUser.set(vendorKey, {
        uid: d.id,
        email: data.email || '',
        role,
        vendorKey,
      });
    }
  });
  console.log('Users con vendorKey (roles):', vendorKeyToUser.size);
  console.log();

  // Helper: resolve vendor del cliente. Prioridad: OCRD + overrides > alta.
  function resolveVendor(cardCode, clientName) {
    const cc = normCardCode(cardCode);
    const name = String(clientName || '').trim();
    if (!cc && !name) return { vendorKey: '', uid: '', email: '', reason: 'input_vacio', source: '' };
    const master = cc ? ocrd.get(cc) : null;
    let vendorKey = '';
    let source = '';
    if (master) {
      // Cadena de overrides: SHOP > LOC > PROV > SlpName.
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
      source = vendorKey ? 'ocrd' : '';
    }
    // v1412 §50: fallback a client_applications (altas SAP huérfanas).
    if (!vendorKey && cc) {
      const alta = altasByCardCode.get(cc);
      if (alta && alta.assignedVendor) {
        vendorKey = alta.assignedVendor;
        source = 'approvedAlta';
      }
    }
    if (!vendorKey && name) {
      const target = name.toLowerCase();
      const alta = altasByName.find(
        (a) =>
          a &&
          (String(a.comercio || '').toLowerCase() === target ||
            String(a.fantasia || '').toLowerCase() === target)
      );
      if (alta && alta.assignedVendor) {
        vendorKey = alta.assignedVendor;
        source = 'approvedAlta';
      }
    }
    // Normalizar label histórico "Z<N> - Nombre".
    if (vendorKey) {
      const m = vendorKey.match(/^Z\d+\s*[-–—]\s*(.+)$/i);
      if (m) vendorKey = m[1].trim().toUpperCase();
    }
    if (vendorKey === '__DISTRIBUTOR__') vendorKey = '';
    if (!master && !source) {
      return { vendorKey: '', uid: '', email: '', reason: 'cliente_no_en_ocrd', source: '' };
    }
    if (!vendorKey) {
      return { vendorKey: '', uid: '', email: '', reason: 'zona_sin_vendedor', source };
    }
    // Lookup user con fallback case-insensitive.
    let user = vendorKeyToUser.get(vendorKey);
    if (!user) {
      for (const [k, u] of vendorKeyToUser) {
        if (k.toLowerCase() === vendorKey.toLowerCase()) {
          user = u;
          break;
        }
      }
    }
    if (!user) {
      // Fallback primer nombre.
      const first = vendorKey.split(/\s+/)[0].toUpperCase();
      if (first && first.length >= 3) {
        for (const [k, u] of vendorKeyToUser) {
          const ku = k.toUpperCase();
          if (ku === first || ku.startsWith(first + ' ')) {
            user = u;
            break;
          }
        }
      }
    }
    if (!user) {
      return { vendorKey, uid: '', email: '', reason: 'vendor_sin_uid', source };
    }
    return { vendorKey, uid: user.uid, email: user.email, reason: 'ok', source };
  }

  // 4. Scan colecciones.
  const collections =
    COLLECTION_FILTER === 'pedidos' ? ['pedidos'] :
    COLLECTION_FILTER === 'waitlist' ? ['revision_waitlist'] :
    ['pedidos', 'revision_waitlist'];

  const misalignedByCol = { pedidos: [], revision_waitlist: [] };
  const statsBefore = { pedidos: { total: 0, sinVendor: 0 }, revision_waitlist: { total: 0, sinVendor: 0 } };

  for (const col of collections) {
    const snap = await db.collection(col).get();
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.closedAt) return;
      if (col === 'revision_waitlist' && data.stage === 'consumed') return;
      statsBefore[col].total++;
      const curOwnerVendor = String(data.ownerVendor || '').trim();
      const curVendorAssigned = String(data.vendorAssigned || '').trim();
      const curAssignedVendorUid = String(data.assignedVendorUid || '').trim();
      const effective = curVendorAssigned || curOwnerVendor;
      if (!effective) statsBefore[col].sinVendor++;

      const cardCode = normCardCode(data.clientCardCode || data.cardCode || '');
      const clientName = data.clientName || '';
      const resolution = resolveVendor(cardCode, clientName);

      // ¿Está desalineado?
      const needsFix =
        !curAssignedVendorUid ||
        !curOwnerVendor ||
        curOwnerVendor !== resolution.vendorKey ||
        curAssignedVendorUid !== resolution.uid;
      if (!needsFix) return;

      misalignedByCol[col].push({
        id: d.id,
        cardCode,
        clientName: clientName || '',
        orderNumber: data.orderNumber || null,
        currentOwnerVendor: curOwnerVendor,
        currentVendorAssigned: curVendorAssigned,
        currentAssignedVendorUid: curAssignedVendorUid,
        resolvedVendorKey: resolution.vendorKey,
        resolvedUid: resolution.uid,
        resolvedEmail: resolution.email,
        cargadoPor: data.ownerEmail || data.cargadoPorEmail || data.ownerUid || '',
        reason: resolution.reason,
      });
    });
  }

  // 5. Print report.
  const statsAfter = { pedidos: { fixables: 0, sinVendor: 0 }, revision_waitlist: { fixables: 0, sinVendor: 0 } };
  for (const col of collections) {
    const rows = misalignedByCol[col];
    console.log('===== ' + col + ' (' + rows.length + ' desalineados / ' + statsBefore[col].total + ' totales abiertos) =====');
    console.log('  Antes: sin vendedor = ' + statsBefore[col].sinVendor);
    const fixables = rows.filter((r) => r.reason === 'ok' || r.reason === 'vendor_sin_uid');
    const noFix = rows.filter((r) => r.reason !== 'ok' && r.reason !== 'vendor_sin_uid');
    statsAfter[col].fixables = fixables.length;
    statsAfter[col].sinVendor = Math.max(0, statsBefore[col].sinVendor - fixables.length);
    console.log('  Después (post backfill si aplicara): sin vendedor = ' + statsAfter[col].sinVendor);
    console.log('  Fixables (reason=ok|vendor_sin_uid): ' + fixables.length);
    console.log('  Sin fix automático: ' + noFix.length);
    console.log();
    if (rows.length === 0) {
      console.log('  (ninguno desalineado)');
      console.log();
      continue;
    }
    rows.sort((a, b) => (a.orderNumber || 0) - (b.orderNumber || 0));
    console.log(
      '| ORDEN | Cliente | CardCode | Actual ownerVendor | → Resuelto | UID resuelto | Cargado por | Reason |'
    );
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      console.log(
        '| ' + (r.orderNumber || '-') +
        ' | ' + (r.clientName || '').slice(0, 32) +
        ' | ' + r.cardCode +
        ' | ' + (r.currentOwnerVendor || '(vacío)') +
        ' | ' + (r.resolvedVendorKey || '(vacío)') +
        ' | ' + (r.resolvedUid ? r.resolvedUid.slice(0, 10) + '…' : '(sin uid)') +
        ' | ' + (r.cargadoPor || '').slice(0, 22) +
        ' | ' + r.reason +
        ' |'
      );
    }
    console.log();
  }

  // 6. Markdown.
  const fs = require('node:fs');
  const path = require('node:path');
  const outPath = path.join(__dirname, '..', '..', 'docs', 'auditoria', '35_VENDEDOR_DESALINEADO.md');
  const md = [
    '# Q v1408 — Vendedor desalineado @ ' + nowIso,
    '',
    'Modo: ' + (APPLY ? 'APPLY' : 'DRY-RUN') + '. Colecciones: ' + COLLECTION_FILTER + '.',
    '',
    'Cadena de resolución: cliente (cardCode) → OCRD base → vendor_overrides (SHOP > LOC > PROV) → vendor efectivo.',
    'Lookup UID: colección `roles` con precedencia vendedor > interno > gerente > admin.',
    '',
    '## Stats globales',
    '',
    '| Colección | Total abiertos | Sin vendedor (antes) | Fixables | Sin vendedor (después) |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const col of collections) {
    md.push(
      '| ' + col +
      ' | ' + statsBefore[col].total +
      ' | ' + statsBefore[col].sinVendor +
      ' | ' + statsAfter[col].fixables +
      ' | ' + statsAfter[col].sinVendor +
      ' |'
    );
  }
  md.push('');

  for (const col of collections) {
    const rows = misalignedByCol[col];
    md.push('## ' + col + ' (' + rows.length + ' desalineados)');
    md.push('');
    if (rows.length === 0) {
      md.push('(ninguno)');
      md.push('');
      continue;
    }
    md.push('| ORDEN | Cliente | CardCode | Actual ownerVendor | → Resuelto | UID resuelto | Cargado por | Reason |');
    md.push('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      md.push(
        '| ' + (r.orderNumber || '-') +
        ' | ' + (r.clientName || '').replace(/\|/g, '/').slice(0, 60) +
        ' | ' + r.cardCode +
        ' | ' + (r.currentOwnerVendor || '(vacío)') +
        ' | ' + (r.resolvedVendorKey || '(vacío)') +
        ' | ' + (r.resolvedUid || '(sin uid)') +
        ' | ' + (r.cargadoPor || '').slice(0, 40) +
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

  // 7. Apply backfill.
  if (!APPLY) {
    console.log('DRY-RUN finalizado. Volvé a correr con --apply para persistir cambios.');
    return;
  }
  console.log('===== APLICANDO BACKFILL =====');
  for (const col of collections) {
    const rows = misalignedByCol[col].filter(
      (r) => r.reason === 'ok' || r.reason === 'vendor_sin_uid'
    );
    console.log('[' + col + '] backfill de ' + rows.length + ' docs...');
    let ok = 0;
    let fail = 0;
    for (const r of rows) {
      try {
        const updateData = {
          vendorAssigned: r.resolvedVendorKey || '',
          assignedVendorUid: r.resolvedUid || '',
          assignedVendorEmail: r.resolvedEmail || '',
          ownerVendor: r.resolvedVendorKey || '',
          assignedVendorReason: r.reason,
          _v46BackfillAt: nowIso,
          _v46BackfillBy: 'scripts/audit/Q_vendedor_desalineado.cjs',
        };
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
