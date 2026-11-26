// AX — HARDENING 5 BATCH 3 — DEUDA-M1 Waitlist integrity audit (READ-ONLY)
//
// Fecha: 2026-11-19.
// Mandato: HARDENING 5 BATCH 3, Data Integrity Auditor.
// Scope: verificación observe-only de las 4 reglas R1-R4 que SEC-M1 (PR #1376)
//        dejó como deuda server-side cuando mergeó el whitelist cliente-side.
//
// Contexto: SEC-M1 cerró con 20 campos whitelist sobre `revision_waitlist.update`.
// Un VDE hostil todavía puede, dentro del whitelist, violar invariantes que
// la rule no modela (contenido semántico de los campos). Las 4 reglas:
//
//   R1 — `asigRefs` cross-reference válido
//     Una línea `items[i].asigRefs[j]` debe apuntar a un pedido cuyo
//     `clientCardCode === waitlist.clientCardCode`. Si apunta a otro cliente,
//     es ATK-001 (sembrar refs falsos para cancelar ASIG ajenas via
//     releaseAsigCF). Chequea también `pedidosOrigenes[]` (doc-level §40.6).
//
//   R2 — Transición monotónica de `stage`
//     waitlist.stage debe pasar solo por: waitlist → consumed. Reversión o
//     salto fuera del set definido → violación R2. (CLAUDE.md §51 R2.)
//
//   R3 — `clientCardCode` immutable
//     Una vez populated, `clientCardCode` no debe cambiar a otro valor.
//     Un VDE que redirige un waitlist a otro cliente (robo de atribución
//     de pedido) viola R3. Verificable por audit log + por chequeos puntuales
//     (ej. assignedVendorUid coincide con el vendor master del cardCode
//     actual — si no, el cardCode fue cambiado post-§44).
//
//   R4 — Ownership (`ownerUid`, `assignedVendorUid`, `vendorAssigned`) immutable
//     Un VDE no puede reasignar ownership de un waitlist ajeno. Post-SEC-M1
//     esos 4 campos están bloqueados en la rule (cliente directo) PERO el
//     guard legacy §44 permite re-resolve si `assignedVendorUid === ''`.
//     Audit R4 = waitlist con `assignedVendorUid` que NO coincide con el
//     vendor resuelto hoy del cliente master.
//
// Fuente de verdad del vendor:
//   `src/pure/resolve-client-vendor.js:resolveClientVendorFromMaster` (CLAUDE.md §46).
//
// Prohibido:
//   - Escribir a Firestore (el script no tiene gate --apply; no puede).
//   - Tocar `firestore.rules` o CFs (scope BATCH 3 es solo audit + scripts).
//   - Tocar BITACORA/TRACKER (lo hace orquestador).
//
// Salidas:
//   docs/auditoria/HARDENING5_DEUDA_M1_INTEGRITY.csv
//   docs/auditoria/HARDENING5_DEUDA_M1_INTEGRITY.md
//
// Uso:
//   node scripts/audit/AX_deuda_m1_waitlist_integrity_audit.cjs

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT = 'app-vendedores-shimano';
const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'auditoria');
const CSV_PATH = path.join(OUT_DIR, 'HARDENING5_DEUDA_M1_INTEGRITY.csv');
const MD_PATH = path.join(OUT_DIR, 'HARDENING5_DEUDA_M1_INTEGRITY.md');

// Guard anti-apply (defense in depth incluso si alguien agrega --apply).
if (process.argv.includes('--apply')) {
  console.error('');
  console.error('ERROR: este script es READ-ONLY. No acepta --apply.');
  console.error('');
  console.error('  Si querés backfillear algo, usar AX_legacy_client_cardcode_audit.cjs');
  console.error('  (y sólo con triple-gate + autorización Mariano).');
  console.error('');
  process.exit(2);
}

function toIsoSafe(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v && typeof v.toDate === 'function') {
    try { return v.toDate().toISOString(); } catch (_e) { return ''; }
  }
  if (v && typeof v.toMillis === 'function') {
    try { return new Date(v.toMillis()).toISOString(); } catch (_e) { return ''; }
  }
  return '';
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.indexOf(',') === -1 && s.indexOf('"') === -1 && s.indexOf('\n') === -1) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// --- Vendor resolver (mini-replica de src/pure/resolve-client-vendor.js) ---
// Nota: la fuente de verdad real vive en el pure. Esta función es equivalente
// para audit (no autoritativa para commit). Si divergen, replicar.
function normKey(s) {
  return String(s || '').toUpperCase().trim();
}

function normCardCode(cc) {
  return String(cc || '').toUpperCase().trim();
}

function resolveVendorFromMaster(cardCode, clientName, points, approvedAltas, users) {
  const cc = normCardCode(cardCode);
  if (!cc) return { vendorKey: '', vendorUid: '', reason: 'no_cardcode' };
  // 1. POINTS directo.
  const point = points[cc];
  let vendorKey = '';
  if (point) {
    vendorKey = normKey(point.vendor);
  }
  // 2. Fallback approvedAltas (match por cardCodeSap).
  if (!vendorKey) {
    const alta = approvedAltas.find((a) => a.cardCodeSap === cc);
    if (alta) {
      vendorKey = normKey(alta.assignedVendor).replace(/^Z\d+\s*-\s*/i, '');
    }
  }
  if (!vendorKey) return { vendorKey: '', vendorUid: '', reason: 'cliente_no_en_master' };
  if (vendorKey === '__DISTRIBUTOR__') return { vendorKey, vendorUid: '', reason: 'zona_sin_vendedor' };
  // 3. User lookup por vendorKey canónico.
  const user = users.find((u) => normKey(u.vendorKey) === vendorKey);
  if (!user) return { vendorKey, vendorUid: '', reason: 'vendor_sin_uid' };
  return { vendorKey, vendorUid: user.uid, vendorEmail: user.email, reason: 'ok' };
}

// --- Loaders ---
async function loadPoints(db) {
  const snap = await db.collection('client_master').get();
  const points = {};
  snap.forEach((d) => {
    const data = d.data() || {};
    const card = normCardCode(data.sapCardCode);
    if (!card) return;
    points[card] = {
      cardCode: card,
      clientName: normKey(data.clientName),
      vendor: normKey(data.vendor),
    };
  });
  return points;
}

async function loadApprovedAltas(db) {
  const snap = await db.collection('client_applications').get();
  const out = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const card = normCardCode(data.cardCodeSap);
    if (!card) return;
    out.push({
      cardCodeSap: card,
      comercio: normKey(data.comercio),
      fantasia: normKey(data.fantasia),
      assignedVendor: normKey(data.assignedVendor),
    });
  });
  return out;
}

async function loadUsers(db) {
  const snap = await db.collection('roles').get();
  const users = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const role = String(data.role || '').trim();
    if (!['vendedor', 'interno', 'admin', 'gerente'].includes(role)) return;
    users.push({
      uid: d.id,
      email: String(data.email || '').trim(),
      role,
      vendorKey: normKey(data.vendor),
    });
  });
  return users;
}

async function loadPedidos(db) {
  // Para R1 cross-reference: mapa pedidoId -> {cardCode, ownerUid, assignedVendorUid, state_lines[]}.
  const snap = await db.collection('pedidos').get();
  const map = new Map();
  snap.forEach((d) => {
    const data = d.data() || {};
    map.set(d.id, {
      pedidoId: d.id,
      clientCardCode: String(data.clientCardCode || '').trim(),
      clientName: String(data.clientName || '').trim(),
      ownerUid: String(data.ownerUid || '').trim(),
      assignedVendorUid: String(data.assignedVendorUid || '').trim(),
      vendorAssigned: String(data.vendorAssigned || '').trim(),
      lines: Array.isArray(data.lines) ? data.lines : [],
      stage: String(data.stage || '').trim(),
      closedAt: data.closedAt ? toIsoSafe(data.closedAt) : '',
    });
  });
  return map;
}

// --- R1: asigRefs cross-reference ---
function checkR1_AsigRefsCrossReference(waitlist, pedidosMap) {
  // Return [] si OK; array de violaciones si hay refs apuntando a pedidos
  // de OTRO cliente o a pedidos inexistentes.
  const violations = [];
  const wlCard = String(waitlist.clientCardCode || '').trim();
  const allRefs = [];
  if (Array.isArray(waitlist.pedidosOrigenes)) {
    for (const r of waitlist.pedidosOrigenes) {
      if (r && r.pedidoId) allRefs.push({ ...r, source: 'pedidosOrigenes' });
    }
  }
  if (Array.isArray(waitlist.items)) {
    for (let i = 0; i < waitlist.items.length; i++) {
      const it = waitlist.items[i];
      if (!it || !Array.isArray(it.asigRefs)) continue;
      for (let j = 0; j < it.asigRefs.length; j++) {
        const r = it.asigRefs[j];
        if (r && r.pedidoId) allRefs.push({ ...r, source: `items[${i}].asigRefs[${j}]`, lineSku: it.code });
      }
    }
  }
  for (const ref of allRefs) {
    const pedido = pedidosMap.get(ref.pedidoId);
    if (!pedido) {
      violations.push({ ruleId: 'R1-dangling', ref, note: 'pedido no existe en /pedidos' });
      continue;
    }
    if (!pedido.clientCardCode) {
      violations.push({ ruleId: 'R1-pedido-sin-card', ref, note: 'pedido origen sin clientCardCode (audit §33)' });
      continue;
    }
    if (wlCard && pedido.clientCardCode !== wlCard) {
      violations.push({
        ruleId: 'R1-cross-client',
        ref,
        note: 'ref apunta a cliente ' + pedido.clientCardCode + ' pero waitlist es ' + wlCard,
      });
    }
  }
  return violations;
}

// --- R2: Transición de stage ---
const VALID_STAGE_TRANSITIONS = new Set(['', 'waitlist', 'consumed', 'draft', null, undefined]);

function checkR2_StageTransition(waitlist) {
  // Snapshot audit (sin history): detectar stage inválido.
  // El track completo de transiciones requiere trigger onWrite → fuera de scope.
  const stage = waitlist.stage || '';
  if (!VALID_STAGE_TRANSITIONS.has(stage)) {
    return [{ ruleId: 'R2-stage-unknown', note: 'stage="' + stage + '" fuera de set conocido' }];
  }
  // `consumed` sin `closedAt` es inconsistencia adicional.
  if (stage === 'consumed' && !waitlist.closedAt) {
    return [{ ruleId: 'R2-consumed-sin-closedAt', note: 'stage=consumed pero closedAt=null' }];
  }
  return [];
}

// --- R3: clientCardCode coherente (vendor del master == vendor del doc) ---
function checkR3_CardCodeImmutable(waitlist, resolveFn) {
  // Snapshot audit: si el waitlist tiene assignedVendorUid persistido pero el
  // vendor que resuelve el master del cardCode actual es OTRO, hubo drift.
  // No prueba que clientCardCode haya CAMBIADO, pero sí que hoy hay inconsistencia.
  const cc = String(waitlist.clientCardCode || '').trim();
  const persistedUid = String(waitlist.assignedVendorUid || '').trim();
  if (!cc || !persistedUid) return [];
  const resolution = resolveFn(cc, waitlist.clientName);
  if (!resolution.vendorUid) return [];
  if (resolution.vendorUid !== persistedUid) {
    return [{
      ruleId: 'R3-vendor-drift',
      note: 'assignedVendorUid=' + persistedUid + ' no coincide con vendor master actual (resuelve a ' + resolution.vendorUid + ', key=' + resolution.vendorKey + ')',
    }];
  }
  return [];
}

// --- R4: Ownership coherente ---
function checkR4_OwnershipCoherente(waitlist) {
  // vendorAssigned debe ser normKey(assignedVendorEmail?.split@[0]) o el
  // vendorKey del user en roles. Snapshot audit mínimo: si vendorAssigned
  // está populated pero assignedVendorUid vacío, es inconsistencia (§44).
  const vendor = String(waitlist.vendorAssigned || '').trim();
  const uid = String(waitlist.assignedVendorUid || '').trim();
  const violations = [];
  if (vendor && !uid) {
    violations.push({ ruleId: 'R4-vendor-sin-uid', note: 'vendorAssigned=' + vendor + ' pero assignedVendorUid vacío' });
  }
  if (uid && !vendor) {
    violations.push({ ruleId: 'R4-uid-sin-vendor', note: 'assignedVendorUid=' + uid + ' pero vendorAssigned vacío' });
  }
  return violations;
}

// --- Main ---
async function main() {
  const t0 = Date.now();
  console.log('========================================================');
  console.log(' AX — DEUDA-M1 Waitlist integrity audit (HARDENING 5 B3)');
  console.log('========================================================');
  console.log(' Project: ' + PROJECT);
  console.log(' Mode: READ-ONLY (--apply NO soportado)');
  console.log('');

  let admin;
  try {
    admin = require('../../functions/node_modules/firebase-admin');
  } catch (e) {
    console.error('ERROR: no se pudo cargar firebase-admin desde functions/node_modules.');
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('[1/4] Cargando maps auxiliares...');
  const [points, approvedAltas, users, pedidosMap] = await Promise.all([
    loadPoints(db),
    loadApprovedAltas(db),
    loadUsers(db),
    loadPedidos(db),
  ]);
  console.log('      points: ' + Object.keys(points).length);
  console.log('      approvedAltas: ' + approvedAltas.length);
  console.log('      users: ' + users.length);
  console.log('      pedidos (para R1 cross-ref): ' + pedidosMap.size);

  const resolveFn = (cc, name) => resolveVendorFromMaster(cc, name, points, approvedAltas, users);

  console.log('');
  console.log('[2/4] Scan revision_waitlist/*...');
  const wlSnap = await db.collection('revision_waitlist').get();
  console.log('      total: ' + wlSnap.size);

  console.log('');
  console.log('[3/4] Verificando R1-R4...');
  const stats = { R1: 0, R2: 0, R3: 0, R4: 0, clean: 0 };
  const rows = [];

  wlSnap.forEach((d) => {
    const w = Object.assign({ _id: d.id }, d.data() || {});
    const r1 = checkR1_AsigRefsCrossReference(w, pedidosMap);
    const r2 = checkR2_StageTransition(w);
    const r3 = checkR3_CardCodeImmutable(w, resolveFn);
    const r4 = checkR4_OwnershipCoherente(w);
    const total = r1.length + r2.length + r3.length + r4.length;
    if (total === 0) {
      stats.clean += 1;
      return;
    }
    if (r1.length) stats.R1 += r1.length;
    if (r2.length) stats.R2 += r2.length;
    if (r3.length) stats.R3 += r3.length;
    if (r4.length) stats.R4 += r4.length;
    const all = r1.concat(r2, r3, r4);
    for (const v of all) {
      rows.push({
        waitlistId: w._id,
        orderNumber: w.orderNumber || '',
        clientName: String(w.clientName || ''),
        clientCardCode: String(w.clientCardCode || ''),
        stage: w.stage || '',
        closedAt: toIsoSafe(w.closedAt),
        assignedVendorUid: w.assignedVendorUid || '',
        vendorAssigned: w.vendorAssigned || '',
        ownerUid: w.ownerUid || '',
        ruleId: v.ruleId,
        refSource: v.ref ? v.ref.source || '' : '',
        refPedidoId: v.ref ? v.ref.pedidoId || '' : '',
        refLineSku: v.ref ? v.ref.lineSku || '' : '',
        note: v.note || '',
      });
    }
  });

  // --- CSV ---
  console.log('');
  console.log('[4/4] Escribiendo CSV: ' + CSV_PATH);
  const header = [
    'waitlistId', 'orderNumber', 'clientName', 'clientCardCode', 'stage',
    'closedAt', 'assignedVendorUid', 'vendorAssigned', 'ownerUid',
    'ruleId', 'refSource', 'refPedidoId', 'refLineSku', 'note',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(','));
  }
  fs.writeFileSync(CSV_PATH, lines.join('\n') + '\n', 'utf8');
  console.log('      ' + rows.length + ' violaciones totales.');

  // --- Markdown summary ---
  console.log('      Escribiendo markdown: ' + MD_PATH);
  const md = [];
  md.push('# HARDENING 5 — BATCH 3 — DEUDA-M1 Waitlist integrity audit');
  md.push('');
  md.push('**Fecha**: ' + new Date().toISOString());
  md.push('**Script**: `scripts/audit/AX_deuda_m1_waitlist_integrity_audit.cjs`');
  md.push('**Mode**: READ-ONLY');
  md.push('**Runtime**: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  md.push('');
  md.push('## Alcance');
  md.push('');
  md.push('SEC-M1 (PR #1376) dejó como deuda server-side las 4 reglas R1-R4.');
  md.push('Este script las chequea **observe-only** sobre snapshot actual.');
  md.push('Un hallazgo no implica fraude confirmado — algunos son drift natural');
  md.push('(ej. R3: cambio de zona del cliente post-creación del waitlist).');
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push('| regla | violaciones |');
  md.push('|---|---:|');
  md.push('| R1 — asigRefs cross-reference inválido | ' + stats.R1 + ' |');
  md.push('| R2 — stage inválido/inconsistente | ' + stats.R2 + ' |');
  md.push('| R3 — vendor drift (assignedVendorUid ≠ vendor master actual) | ' + stats.R3 + ' |');
  md.push('| R4 — ownership incoherente (vendorAssigned vs assignedVendorUid) | ' + stats.R4 + ' |');
  md.push('| waitlists sin violaciones | ' + stats.clean + ' |');
  md.push('| **total scanned** | **' + wlSnap.size + '** |');
  md.push('');
  md.push('## Detalle');
  md.push('');
  md.push('Ver CSV `' + path.basename(CSV_PATH) + '` para detalle completo.');
  md.push('');
  md.push('### R1 critical sub-cases');
  md.push('');
  md.push('- `R1-cross-client`: ATK-001. Un waitlist apunta a un pedido de OTRO cliente.');
  md.push('- `R1-dangling`: asigRef apunta a pedidoId inexistente (soft bug, no fraude).');
  md.push('- `R1-pedido-sin-card`: pedido origen sin `clientCardCode` → requiere resolver primero (ver audit AX legacy clientCardCode).');
  md.push('');
  md.push('### Interpretación');
  md.push('');
  md.push('- **R1 > 0 con sub-case `R1-cross-client`**: incidente crítico, escalar a Mariano inmediato.');
  md.push('- **R3 drift**: común tras `Reasignar Zonas` (admin reasigna vendor en master; waitlists viejos conservan assignedVendorUid). No es fraude.');
  md.push('- **R4 vendor-sin-uid**: altas pre-§44 o pre-§46. `scripts/audit/AP_backfill_assigned_vendor_uid_v1490.cjs` repara.');
  md.push('');
  md.push('## Comando');
  md.push('');
  md.push('```bash');
  md.push('node scripts/audit/AX_deuda_m1_waitlist_integrity_audit.cjs');
  md.push('```');
  md.push('');
  md.push('## Siguiente paso (fuera de scope BATCH 3)');
  md.push('');
  md.push('- Fase 3 CF `onWaitlistWriteValidate` (observe-only) que corre R1-R4 en cada write.');
  md.push('- Si encuentra violación, escribe `operations_log` con type=`waitlist_integrity_violation`.');
  md.push('- Después de 2 semanas de baseline, flip a enforce (rechazar write).');
  md.push('');
  fs.writeFileSync(MD_PATH, md.join('\n'), 'utf8');

  console.log('');
  console.log('========================================================');
  console.log(' DONE in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('========================================================');
  console.log(' Violaciones:');
  console.log('   R1: ' + stats.R1);
  console.log('   R2: ' + stats.R2);
  console.log('   R3: ' + stats.R3);
  console.log('   R4: ' + stats.R4);
  console.log(' Clean: ' + stats.clean + ' / ' + wlSnap.size);
  console.log('');
  console.log(' CSV: ' + CSV_PATH);
  console.log(' MD : ' + MD_PATH);
}

main().catch((e) => {
  console.error('FATAL: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
