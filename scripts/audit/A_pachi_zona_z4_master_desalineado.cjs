// A — PACHI (Z4) vs master vendorAssigned desalineado — read-only por default.
//
// v1506 §44/§46/§50 (2026-10-28) — audit del caso BUEN PIQUE S.R.L.
// (C30704537375) que aparece en "Clientes - Z4 Pachi" (via POINTS/overrides)
// pero NO en "Pedidos > Confirmados" buscando "buen pique" (porque los pedidos
// tienen assignedVendorUid de OTRO vendedor, p. ej. Santiago).
//
// Hipotesis: el master (OCRD + vendor_overrides + client_applications) dice
// SANTIAGO (u otro) pero la zona Z4 ("Pachi") lo tiene como suyo. §44 define
// que el vendedor del pedido debe venir SIEMPRE del master del cliente, por lo
// tanto el filtro Planner por assignedVendorUid lo esconde para PACHI.
//
// Que hace este script:
//   1. Dump de client_master/C30704537375 (BUEN PIQUE) con todos los campos
//      relevantes.
//   2. Dump de pedidos con clientCardCode=C30704537375 (todos los campos de
//      vendor + stage + fechas).
//   3. Enumera TODA la zona Z4 Pachi:
//        - POINTS cuyo vendor efectivo (base + overrides) === 'PACHI'.
//        - client_applications con assignedVendor === 'PACHI'.
//      Para cada cliente de Z4:
//        - Lee client_master por sapCardCode (o nombre+prov como fallback).
//        - Resuelve el vendor del master via resolveClientVendorFromMaster
//          (fuente §46: POINTS + overrides + approvedAltas).
//        - Si master.vendor !== 'PACHI', es desalineado y se lista.
//        - Cuenta pedidos abiertos (closedAt==null) y confirmados por cliente.
//   4. Genera el informe MD en Desktop\RAW_PACHI_Z4_INCONSISTENCIAS.md.
//
// Uso:
//   node scripts/audit/A_pachi_zona_z4_master_desalineado.cjs           # dry-run (unico modo soportado — read-only)
//   node scripts/audit/A_pachi_zona_z4_master_desalineado.cjs --all-zones  # idem para TODAS las zonas (watchdog §XX)
//
// CLAUDE.md §31 — tarea de auditoria: NO modifica Firestore ni src/.
// CLAUDE.md §55 — snapshot va en el backfill script (archivo B), no aqui.

const PROJECT = 'app-vendedores-shimano';
const PACHI_UID_HINT = 'LaBFi1xkSLObzLEdRoP8fonZ06r2'; // CLAUDE.md hint — se verifica contra roles.
const PACHI_VENDOR_KEY_CANON = 'PACHI';
const TARGET_CARDCODE_FOCAL = 'C30704537375'; // BUEN PIQUE S.R.L.

const path = require('path');
const fs = require('fs');
const os = require('os');

function normCardCode(cc) {
  return String(cc || '')
    .trim()
    .toUpperCase();
}

function fmtTs(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v.toDate === 'function') {
    try {
      return v.toDate().toISOString();
    } catch (_e) {
      /* ignore */
    }
  }
  if (typeof v.seconds === 'number') {
    try {
      return new Date(v.seconds * 1000).toISOString();
    } catch (_e) {
      /* ignore */
    }
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function pedidoDateCreated(p) {
  const d = p.createdAt || p.updatedAt;
  if (!d) return 0;
  if (typeof d === 'string') return new Date(d).getTime() || 0;
  if (typeof d.toDate === 'function') {
    try {
      return d.toDate().getTime();
    } catch (_e) {
      return 0;
    }
  }
  if (typeof d.seconds === 'number') return d.seconds * 1000;
  return 0;
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const argv = process.argv.slice(2);
  const ALL_ZONES = argv.includes('--all-zones');
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('A — PACHI Z4 vs master desalineado @ ' + nowIso);
  console.log('================================================================');
  console.log('Modo:', ALL_ZONES ? 'TODAS LAS ZONAS (watchdog)' : 'SOLO Z4 PACHI');
  console.log('');

  // Pre-check: desktop output path.
  const OUTPUT_DIR = path.join(os.homedir(), 'Desktop');
  const OUTPUT_MD = ALL_ZONES
    ? path.join(OUTPUT_DIR, 'RAW_TODAS_ZONAS_INCONSISTENCIAS.md')
    : path.join(OUTPUT_DIR, 'RAW_PACHI_Z4_INCONSISTENCIAS.md');

  // 1. OCRD (base cliente SAP: cardCode -> SlpName base).
  console.log('[1/7] Cargando OCRD...');
  const ocrdSnap = await db.collection('ocrd').get();
  /** @type {Map<string, {cardCode:string, cardName:string, slpName:string, provincia:string, localidad:string}>} */
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
  console.log(`  OCRD: ${ocrd.size} clientes`);

  // 2. client_master (fuente para "Clientes" en Master Clientes modal).
  console.log('[2/7] Cargando client_master...');
  const cmSnap = await db.collection('client_master').get();
  /** @type {Map<string, any>} */
  const clientMasterByCard = new Map();
  /** @type {Array<any>} */
  const clientMasterAll = [];
  cmSnap.forEach((d) => {
    const data = d.data() || {};
    const row = Object.assign({ _id: d.id }, data);
    clientMasterAll.push(row);
    const sap = normCardCode(data.sapCardCode);
    if (sap) clientMasterByCard.set(sap, row);
  });
  console.log(`  client_master: ${clientMasterAll.length} docs (${clientMasterByCard.size} con sapCardCode)`);

  // 3. vendor_overrides (SHOP|LOC|PROV).
  console.log('[3/7] Cargando vendor_overrides...');
  const voSnap = await db.collection('vendor_overrides').get();
  /** @type {Map<string, string>} */
  const vendorOverrides = new Map();
  voSnap.forEach((d) => {
    const data = d.data() || {};
    const newVendor = String(data.newVendor || data.vendor || '').trim();
    if (newVendor) vendorOverrides.set(d.id, newVendor);
  });
  console.log(`  vendor_overrides: ${vendorOverrides.size}`);

  // 4. client_applications (approvedAltas: altas SAP huerfanas).
  console.log('[4/7] Cargando client_applications...');
  const caSnap = await db.collection('client_applications').get();
  /** @type {Map<string, any>} */
  const altasByCardCode = new Map();
  /** @type {Array<any>} */
  const altasAll = [];
  caSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = normCardCode(data.cardCodeSap);
    const assignedVendor = String(data.assignedVendor || '').trim();
    const comercio = String(data.comercio || '').trim();
    const fantasia = String(data.fantasia || '').trim();
    const row = { _id: d.id, cardCodeSap: cc, comercio, fantasia, assignedVendor, provincia: data.provincia, localidad: data.localidad };
    altasAll.push(row);
    if (cc) altasByCardCode.set(cc, row);
  });
  console.log(`  client_applications: ${altasAll.length} (${altasByCardCode.size} con cardCodeSap)`);

  // 5. roles (resolver vendorKey -> UID).
  console.log('[5/7] Cargando roles...');
  const rolesSnap = await db.collection('roles').get();
  /** @type {Map<string, {uid:string, email:string, role:string, vendorKey:string}>} */
  const vendorKeyToUser = new Map();
  const roleRank = { vendedor: 4, interno: 3, gerente: 2, admin: 1 };
  const allRoles = [];
  rolesSnap.forEach((d) => {
    const data = d.data() || {};
    const role = String(data.role || '').trim();
    const vendorKey = String(data.vendor || '').trim();
    allRoles.push({ uid: d.id, email: data.email || '', role, vendorKey });
    if (!vendorKey) return;
    const existing = vendorKeyToUser.get(vendorKey);
    const curr = roleRank[role] || 0;
    const prev = existing ? roleRank[existing.role] || 0 : -1;
    if (!existing || curr > prev) {
      vendorKeyToUser.set(vendorKey, { uid: d.id, email: data.email || '', role, vendorKey });
    }
  });
  console.log(`  roles: ${allRoles.length} docs (${vendorKeyToUser.size} con vendorKey)`);

  // PACHI UID verif
  const pachiFromRoles = vendorKeyToUser.get(PACHI_VENDOR_KEY_CANON);
  let PACHI_UID = pachiFromRoles ? pachiFromRoles.uid : '';
  let PACHI_EMAIL = pachiFromRoles ? pachiFromRoles.email : '';
  if (!PACHI_UID) {
    // Fallback: hint del prompt.
    const hint = allRoles.find((r) => r.uid === PACHI_UID_HINT);
    if (hint) {
      PACHI_UID = hint.uid;
      PACHI_EMAIL = hint.email;
      console.log(`  WARN: PACHI vendorKey no encontrado en roles.vendor; usando hint ${PACHI_UID_HINT} (role=${hint.role}, email=${hint.email})`);
    } else {
      console.log(`  WARN: PACHI UID no resuelto por vendorKey ni hint. Marcar como "sin UID"`);
    }
  }
  console.log(`  PACHI UID: ${PACHI_UID || '(no encontrado)'} email: ${PACHI_EMAIL}`);

  // Helper resolve vendor del master.
  function resolveVendorForClient(cardCode, clientName) {
    const cc = normCardCode(cardCode);
    const name = String(clientName || '').trim();
    if (!cc && !name) return { vendorKey: '', source: '', reason: 'input_vacio' };
    const master = cc ? ocrd.get(cc) : null;
    let vendorKey = '';
    let source = '';
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
      source = vendorKey ? 'ocrd' : 'ocrd_sin_vendor';
    }
    if (!vendorKey && cc) {
      const alta = altasByCardCode.get(cc);
      if (alta && alta.assignedVendor) {
        vendorKey = alta.assignedVendor;
        source = 'approvedAlta';
      }
    }
    if (!vendorKey && name) {
      const target = name.toLowerCase();
      const alta = altasAll.find(
        (a) =>
          a &&
          (String(a.comercio || '').toLowerCase() === target ||
            String(a.fantasia || '').toLowerCase() === target)
      );
      if (alta && alta.assignedVendor) {
        vendorKey = alta.assignedVendor;
        source = 'approvedAlta_byName';
      }
    }
    if (vendorKey) {
      const m = vendorKey.match(/^Z\d+\s*[-–—]\s*(.+)$/i);
      if (m) vendorKey = m[1].trim().toUpperCase();
    }
    if (vendorKey === '__DISTRIBUTOR__') vendorKey = '';
    if (!master && !source) return { vendorKey: '', source: '', reason: 'cliente_no_en_ocrd' };
    if (!vendorKey) return { vendorKey: '', source, reason: 'zona_sin_vendedor' };
    return { vendorKey: vendorKey.toUpperCase().trim(), source, reason: 'ok' };
  }

  // 6. Enumerar clientes "de la zona PACHI" via OCRD + overrides + altas.
  console.log('[6/7] Enumerando clientes con vendor master = PACHI...');
  /** @type {Array<{cardCode:string, cardName:string, provincia:string, localidad:string, source:string}>} */
  const clientsOfPachi = [];
  // Via OCRD: cada cardCode donde el vendor resuelto === PACHI.
  for (const [cc, m] of ocrd) {
    const res = resolveVendorForClient(cc, m.cardName);
    if (res.vendorKey === PACHI_VENDOR_KEY_CANON) {
      clientsOfPachi.push({
        cardCode: cc,
        cardName: m.cardName,
        provincia: m.provincia,
        localidad: m.localidad,
        source: res.source,
      });
    }
  }
  // Via altas: por si alguna NO esta en OCRD pero si en client_applications.
  for (const a of altasAll) {
    if (!a.cardCodeSap) continue;
    if (ocrd.has(a.cardCodeSap)) continue;
    if (String(a.assignedVendor || '').trim().toUpperCase() !== PACHI_VENDOR_KEY_CANON) continue;
    clientsOfPachi.push({
      cardCode: a.cardCodeSap,
      cardName: a.comercio || a.fantasia || '',
      provincia: a.provincia || '',
      localidad: a.localidad || '',
      source: 'approvedAlta_only',
    });
  }
  console.log(`  Clientes resueltos a PACHI por master: ${clientsOfPachi.length}`);

  // 7. Pedidos: colectar los que son de CLIENTES DE ZONA PACHI pero con
  //    assignedVendorUid distinto a PACHI_UID o vendorAssigned != PACHI.
  console.log('[7/7] Scan pedidos (open + confirmados) por cardCode...');
  // Para ser eficiente: traigo pedidos todos (es N<5k) y los indexo por clientCardCode.
  const pedidosSnap = await db.collection('pedidos').get();
  /** @type {Map<string, Array<any>>} */
  const pedidosByCard = new Map();
  pedidosSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = normCardCode(data.clientCardCode);
    if (!cc) return;
    const entry = Object.assign({ _id: d.id }, data);
    if (!pedidosByCard.has(cc)) pedidosByCard.set(cc, []);
    pedidosByCard.get(cc).push(entry);
  });
  console.log(`  pedidos totales con clientCardCode: ${pedidosSnap.size}`);

  // Caso focal: BUEN PIQUE
  const focalCard = TARGET_CARDCODE_FOCAL;
  const focalMaster = ocrd.get(focalCard) || null;
  const focalAlta = altasByCardCode.get(focalCard) || null;
  const focalCM = clientMasterByCard.get(focalCard) || null;
  const focalResolved = resolveVendorForClient(focalCard, focalMaster ? focalMaster.cardName : '');
  const focalPedidos = (pedidosByCard.get(focalCard) || []).slice().sort((a, b) => pedidoDateCreated(b) - pedidoDateCreated(a));

  // Analisis desalineados por cliente de PACHI.
  /** @type {Array<any>} */
  const desalineados = [];
  /** @type {Array<any>} */
  const alineados = [];
  for (const c of clientsOfPachi) {
    const pedList = pedidosByCard.get(c.cardCode) || [];
    const pedAbiertos = pedList.filter((p) => !p.closedAt);
    const pedConfirmados = pedList.filter((p) => p.stage === 'confirmed');
    const assignedUidPorPed = pedList.map((p) => String(p.assignedVendorUid || '').trim());
    const uniqueUids = Array.from(new Set(assignedUidPorPed.filter(Boolean)));
    const anyMismatch = uniqueUids.some((u) => u !== PACHI_UID);
    const anyEmpty = assignedUidPorPed.includes('');
    const cm = clientMasterByCard.get(c.cardCode) || null;
    const cmVendor = cm ? String(cm.vendorAssigned || cm.vendor || '').trim().toUpperCase() : '';
    const cmUid = cm ? String(cm.assignedVendorUid || '').trim() : '';
    const row = {
      cardCode: c.cardCode,
      comercio: c.cardName,
      provincia: c.provincia,
      localidad: c.localidad,
      source: c.source,
      masterVendor: PACHI_VENDOR_KEY_CANON,
      masterSource: c.source,
      pedTotal: pedList.length,
      pedAbiertos: pedAbiertos.length,
      pedConfirmados: pedConfirmados.length,
      sampleAbierto: pedAbiertos.length ? pedAbiertos[0]._id : '',
      sampleConfirmado: pedConfirmados.length ? pedConfirmados[0]._id : '',
      uniqueAssignedUids: uniqueUids,
      anyMismatchUid: anyMismatch,
      anyEmptyAssignedUid: anyEmpty,
      cmVendorAssigned: cmVendor,
      cmAssignedVendorUid: cmUid,
    };
    if (anyMismatch || anyEmpty) desalineados.push(row);
    else alineados.push(row);
  }

  // Escritura del informe MD.
  const lines = [];
  lines.push('# Clientes PACHI (Z4) con master o pedidos desalineados');
  lines.push('');
  lines.push(`Generado: ${nowIso}`);
  lines.push(`Modo: ${ALL_ZONES ? 'TODAS LAS ZONAS' : 'SOLO Z4 PACHI'}`);
  lines.push('');
  lines.push(`PACHI vendorKey canónico: ${PACHI_VENDOR_KEY_CANON}`);
  lines.push(`PACHI UID resuelto: ${PACHI_UID || '(sin UID)'} | email: ${PACHI_EMAIL || '(sin email)'}`);
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push(`- Total clientes resueltos a PACHI por master: **${clientsOfPachi.length}**`);
  lines.push(`- Clientes CON pedidos desalineados (uid distinto a PACHI o uid vacío): **${desalineados.length}**`);
  lines.push(`- Clientes alineados o sin pedidos: **${alineados.length}**`);
  const pedAbiertosTot = desalineados.reduce((s, r) => s + r.pedAbiertos, 0);
  const pedConfirmadosTot = desalineados.reduce((s, r) => s + r.pedConfirmados, 0);
  lines.push(`- Pedidos abiertos afectados: **${pedAbiertosTot}**`);
  lines.push(`- Pedidos confirmados afectados: **${pedConfirmadosTot}**`);
  lines.push('');
  lines.push('## Caso focal: BUEN PIQUE S.R.L. — ' + focalCard);
  lines.push('');
  if (focalMaster) {
    lines.push('### OCRD (SAP master)');
    lines.push('```json');
    lines.push(JSON.stringify(focalMaster, null, 2));
    lines.push('```');
  } else {
    lines.push('OCRD: NO encontrado.');
  }
  if (focalCM) {
    lines.push('### client_master doc (si existe)');
    const slim = {
      _id: focalCM._id,
      sapCardCode: focalCM.sapCardCode,
      clientName: focalCM.clientName,
      provincia: focalCM.provincia,
      localidad: focalCM.localidad,
      vendor: focalCM.vendor,
      vendorAssigned: focalCM.vendorAssigned,
      assignedVendorUid: focalCM.assignedVendorUid,
      updatedAt: fmtTs(focalCM.updatedAt),
    };
    lines.push('```json');
    lines.push(JSON.stringify(slim, null, 2));
    lines.push('```');
  } else {
    lines.push('client_master doc: NO encontrado (BUEN PIQUE existe solo en OCRD, no en client_master).');
  }
  if (focalAlta) {
    lines.push('### approvedAlta');
    lines.push('```json');
    lines.push(JSON.stringify(focalAlta, null, 2));
    lines.push('```');
  }
  lines.push('');
  lines.push('### Resolucion de vendedor del master (via POINTS/overrides/altas):');
  lines.push('```json');
  lines.push(JSON.stringify(focalResolved, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`Pedidos de BUEN PIQUE (orden desc por createdAt): **${focalPedidos.length}**`);
  lines.push('');
  for (const p of focalPedidos.slice(0, 20)) {
    const slim = {
      _id: p._id,
      orderNumber: p.orderNumber,
      stage: p.stage,
      closedAt: fmtTs(p.closedAt),
      createdAt: fmtTs(p.createdAt),
      confirmedAt: fmtTs(p.confirmedAt),
      ownerUid: p.ownerUid,
      ownerEmail: p.ownerEmail,
      cargadoPorUid: p.cargadoPorUid,
      cargadoPorEmail: p.cargadoPorEmail,
      vendorAssigned: p.vendorAssigned,
      ownerVendor: p.ownerVendor,
      assignedVendorUid: p.assignedVendorUid,
      assignedVendorEmail: p.assignedVendorEmail,
      transferidoSAP: p.transferidoSAP && typeof p.transferidoSAP === 'object' ? { docNum: p.transferidoSAP.docNum, docEntry: p.transferidoSAP.docEntry, orderDocEntry: p.transferidoSAP.orderDocEntry } : p.transferidoSAP,
    };
    lines.push('- ' + JSON.stringify(slim));
  }
  lines.push('');
  lines.push('## Lista detallada de clientes desalineados');
  lines.push('');
  lines.push('| cardCode | comercio | prov | loc | source | ped_abiertos | ped_confirmados | uids_distintos | cm_vendor | cm_uid | sample_pedido |');
  lines.push('|---|---|---|---|---|---:|---:|---|---|---|---|');
  for (const r of desalineados) {
    const uids = r.uniqueAssignedUids.length ? r.uniqueAssignedUids.join(',').slice(0, 60) : '(todos vacios)';
    const sample = r.sampleConfirmado || r.sampleAbierto || '';
    const line = ['', r.cardCode, (r.comercio || '').slice(0, 40), r.provincia, r.localidad, r.source, r.pedAbiertos, r.pedConfirmados, uids, r.cmVendorAssigned || '(sin cm)', r.cmAssignedVendorUid || '(sin uid)', sample, ''].join(' | ');
    lines.push(line);
  }
  lines.push('');
  lines.push('## Resolucion detallada: cada cliente alineado o desalineado');
  lines.push('');
  lines.push('(Omitido para informe short — ver `clientsOfPachi` en el objeto JSON crudo si se necesita.)');
  lines.push('');
  lines.push('## Hipotesis evaluada');
  lines.push('');
  lines.push('- Master dice vendorKey=PACHI (via POINTS + overrides o approvedAlta).');
  lines.push('- Pedidos tienen assignedVendorUid != PACHI_UID o vacio.');
  lines.push('- Filtro Planner VDE (§59) usa assignedVendorUid === myUid.');
  lines.push('- Resultado: PACHI no ve los pedidos aunque la zona lo tenga como suyo.');
  lines.push('');
  lines.push('## Propuesta de fix (script B)');
  lines.push('');
  lines.push('1. Backfill client_master: setear vendorAssigned=PACHI + assignedVendorUid=' + (PACHI_UID || '<PACHI_UID>') + ' donde zona=Z4 pero master dice otro.');
  lines.push('2. Backfill pedidos abiertos y confirmados (closedAt==null): setear assignedVendorUid=PACHI_UID + vendorAssigned=PACHI.');
  lines.push('3. Pedidos cerrados (closedAt != null): NO tocar (regla operativa general).');

  // write
  try {
    fs.writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf-8');
    console.log('');
    console.log(`✓ Informe generado: ${OUTPUT_MD}`);
  } catch (e) {
    console.error('ERROR escribiendo informe:', e.message);
  }

  // Breve resumen en stdout.
  console.log('');
  console.log('=============== Resumen ===============');
  console.log(`Clientes resueltos a PACHI por master: ${clientsOfPachi.length}`);
  console.log(`Clientes desalineados: ${desalineados.length}`);
  console.log(`Pedidos abiertos afectados: ${pedAbiertosTot}`);
  console.log(`Pedidos confirmados afectados: ${pedConfirmadosTot}`);
  console.log(`Caso focal BUEN PIQUE: ${focalPedidos.length} pedidos; vendor master resuelto: "${focalResolved.vendorKey}" (${focalResolved.reason}, ${focalResolved.source || '-'})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
