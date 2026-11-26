// AX — HARDENING 5 BATCH 3 — Legacy `clientCardCode` audit (READ-ONLY by default)
//
// Fecha: 2026-11-19.
// Mandato: HARDENING 5 BATCH 3, Data Integrity Auditor.
// Scope: audit read-only + dry-run backfill simulation para `clientCardCode`
//        faltantes en `pedidos/*` + `revision_waitlist/*`.
//
// Contexto: v1058 persistió `clientCardCode` por primera vez; v1184 agregó la
// CF `resolvePedidoCardCodeCF` que resuelve faltantes cada 15min via
// `sap_clients` + `client_applications`. Pedidos pre-v1058 o con name no
// matcheable siguen con `clientCardCode=''`. Este audit los enumera + los
// clasifica + propone valores derivables (dry-run) sin escribir.
//
// Fuente de verdad del vendor/cardCode (§44/§46):
//   1. OCRD base (client_master) → vendor_overrides.
//   2. client_applications (approvedAltas) → cardCodeSap + assignedVendor.
//   3. sap_clients (map clientName -> cardCode manual admin).
//   4. Match normName() del script Python backfill_pedido_cardcode.py
//      (replicado en functions/core/resolve-pedido-cardcode-core.js).
//
// Uso:
//   node scripts/audit/AX_legacy_client_cardcode_audit.cjs
//     → dry-run puro. Escribe CSV + markdown. No simula backfill.
//
//   node scripts/audit/AX_legacy_client_cardcode_audit.cjs --dry-run-backfill
//     → además de clasificar, propone valores de backfill por doc (sin escribir).
//        El CSV incluye columnas resolve_cardCode + resolve_source + resolve_reason
//        y un snapshot previousValues §55 simulado.
//
//   node scripts/audit/AX_legacy_client_cardcode_audit.cjs --apply
//     → BLOQUEADO salvo doble gate:
//        - export CONFIRM_APPLY=yes-i-understand
//        - --apply explícito
//        - operador Mariano con autorización escrita (fuera de este script).
//        Aun con el gate activado, el script imprime 60s de countdown
//        antes de escribir para dar chance de Ctrl-C.
//
// Salidas (siempre, incluso en dry-run):
//   docs/auditoria/HARDENING5_LEGACY_CARDCODE_AUDIT.csv
//   docs/auditoria/HARDENING5_LEGACY_CARDCODE_AUDIT.md
//
// Reversibilidad (si Mariano autoriza --apply en el futuro):
//   Cada write guarda `_backfill.<slug>.previousValues` con el estado previo
//   (CLAUDE.md §55). Un script de reversión itera el slug y restaura.

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG = 'AX_clientCardCode_legacy_' + new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'auditoria');
const CSV_PATH = path.join(OUT_DIR, 'HARDENING5_LEGACY_CARDCODE_AUDIT.csv');
const MD_PATH = path.join(OUT_DIR, 'HARDENING5_LEGACY_CARDCODE_AUDIT.md');

// --- Triple-gate --apply ---
const WANT_APPLY = process.argv.includes('--apply');
const WANT_DRY_BACKFILL = process.argv.includes('--dry-run-backfill');
const CONFIRM_ENV = process.env.CONFIRM_APPLY === 'yes-i-understand';

if (WANT_APPLY && !CONFIRM_ENV) {
  console.error('');
  console.error('========================================================');
  console.error('  --apply BLOQUEADO: falta env CONFIRM_APPLY=yes-i-understand');
  console.error('========================================================');
  console.error('');
  console.error('  Este script NO escribe sin triple gate:');
  console.error('    1. --apply explícito en argv.');
  console.error('    2. CONFIRM_APPLY=yes-i-understand en env.');
  console.error('    3. Autorización escrita de Mariano (fuera del script).');
  console.error('');
  console.error('  Si querés dry-run simulado (sin escribir), pasá:');
  console.error('    --dry-run-backfill');
  console.error('');
  process.exit(2);
}

// --- Normalización (replicada de functions/core/resolve-pedido-cardcode-core.js) ---
function normName(name) {
  if (!name) return '';
  let s = String(name).toUpperCase().trim();
  s = s.replace(/[.,'"]/g, '');
  const SUFFIX_RE =
    /\s*(S\.?\s*A\.?|S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?\s*I\.?\s*C\.?|S\.?\s*C\.?\s*A\.?)\s*$/i;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIX_RE, '').trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s;
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

function ageDays(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.round((Date.now() - ms) / (24 * 60 * 60 * 1000));
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.indexOf(',') === -1 && s.indexOf('"') === -1 && s.indexOf('\n') === -1) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// --- Classification ---
// has_cardcode                 → clientCardCode populated (no action needed).
// missing_resolvible           → vacío + match en sap_clients O client_applications → candidato backfill.
// missing_ambiguous            → vacío + sin match + ownerUid resolvible + createdAt < 24h → esperar a CF.
// missing_pre_v1058_legacy     → vacío + createdAt < 2026-10-01 (pre-v1058) + sin match en fuentes.
// missing_no_name              → vacío + clientName vacío/'(sin cliente)' → irrecuperable sin human review.
// has_alt_field                → vacío pero algún alias (cardCode, cliCardCode, ...) → mirror field a copiar.
// via_pedidos_origenes         → waitlist CPST que hereda pedidosOrigenes de un pedido CON clientCardCode.

function classifyPedidoDoc(data, maps) {
  const cardCode = String(data.clientCardCode || '').trim();
  if (cardCode) return { bucket: 'has_cardcode', resolved: null };

  // 1. ¿tiene alias populated?
  const altFields = ['cardCode', 'cliCardCode', 'cardcode', 'CardCode', 'sapCardCode'];
  for (const f of altFields) {
    const v = String(data[f] || '').trim();
    if (v) {
      return { bucket: 'has_alt_field', resolved: { cardCode: v, source: 'alias:' + f, note: 'copy alias to clientCardCode' } };
    }
  }

  // 2. ¿tiene clientName? Si no, es irrecuperable.
  const name = String(data.clientName || '').trim();
  if (!name || /^\(/.test(name)) {
    return { bucket: 'missing_no_name', resolved: null };
  }

  // 3. ¿match en sap_clients o client_applications?
  const norm = normName(name);
  if (norm) {
    for (const [src, m] of Object.entries(maps)) {
      const hit = m.get(norm);
      if (hit) {
        return { bucket: 'missing_resolvible', resolved: { cardCode: hit.cardCode, source: src, matchedNormName: norm, nameRaw: hit.nameRaw } };
      }
    }
  }

  // 4. ¿Es pedido muy viejo (pre-v1058 era 2026-10-01)?
  const createdIso = toIsoSafe(data.createdAt);
  const age = ageDays(createdIso);
  const PRE_V1058_CUTOFF = new Date('2026-10-01T00:00:00Z').getTime();
  const createdMs = Date.parse(createdIso);
  if (Number.isFinite(createdMs) && createdMs < PRE_V1058_CUTOFF) {
    return { bucket: 'missing_pre_v1058_legacy', resolved: null };
  }

  return { bucket: 'missing_ambiguous', resolved: null, ageDays: age };
}

function classifyWaitlistDoc(data, maps, pedidosWithCardCode) {
  const cardCode = String(data.clientCardCode || '').trim();
  if (cardCode) return { bucket: 'has_cardcode', resolved: null };

  // Waitlist CPST: hereda de pedidosOrigenes.
  const origenes = Array.isArray(data.pedidosOrigenes) ? data.pedidosOrigenes : [];
  if (origenes.length > 0) {
    for (const org of origenes) {
      if (!org || !org.pedidoId) continue;
      const origenCard = pedidosWithCardCode.get(String(org.pedidoId));
      if (origenCard) {
        return { bucket: 'via_pedidos_origenes', resolved: { cardCode: origenCard, source: 'pedidosOrigenes', pedidoOrigen: org.pedidoId } };
      }
    }
  }

  // Si no hay pedidosOrigenes resolvibles, replicar la lógica de pedidos.
  return classifyPedidoDoc(data, maps);
}

// --- Firestore loaders ---
async function loadSapClientsMap(db) {
  const map = new Map();
  const snap = await db.collection('sap_clients').get();
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const cardCode = String(data.sapCode || data.cardCode || '').trim();
    if (!cardCode) return;
    const nameRaw = String(data.name || data.nombre || doc.id || '').trim();
    const norm = normName(nameRaw);
    if (!norm) return;
    if (!map.has(norm)) map.set(norm, { cardCode, source: 'sap_clients', nameRaw });
  });
  return map;
}

async function loadClientApplicationsMap(db) {
  const map = new Map();
  const snap = await db.collection('client_applications').get();
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const cardCode = String(data.cardCodeSap || '').trim();
    if (!cardCode) return;
    for (const field of ['comercio', 'titular', 'fantasia']) {
      const nameRaw = String(data[field] || '').trim();
      if (!nameRaw) continue;
      const norm = normName(nameRaw);
      if (!norm) continue;
      if (!map.has(norm)) map.set(norm, { cardCode, source: 'client_applications', nameRaw });
    }
  });
  return map;
}

async function loadPedidosWithCardCode(db) {
  // Mapa pedidoId -> cardCode para enriquecer waitlists CPST via pedidosOrigenes.
  const map = new Map();
  const snap = await db.collection('pedidos').get();
  snap.forEach((d) => {
    const cc = String((d.data() || {}).clientCardCode || '').trim();
    if (cc) map.set(d.id, cc);
  });
  return map;
}

// --- Main ---
async function main() {
  const t0 = Date.now();
  console.log('========================================================');
  console.log(' AX — Legacy clientCardCode audit (HARDENING 5 BATCH 3)');
  console.log('========================================================');
  console.log(' Mode: ' + (WANT_APPLY ? 'APPLY (triple-gate ACTIVADO)' : WANT_DRY_BACKFILL ? 'DRY-RUN-BACKFILL' : 'DRY-RUN'));
  console.log(' Project: ' + PROJECT);
  console.log('');

  if (WANT_APPLY) {
    console.log('--- COUNTDOWN 60s antes de escribir (Ctrl-C para abortar) ---');
    for (let i = 60; i > 0; i -= 10) {
      process.stdout.write(i + 's ... ');
      await new Promise((r) => setTimeout(r, 10000));
    }
    console.log('go.');
  }

  let admin;
  try {
    admin = require('../../functions/node_modules/firebase-admin');
  } catch (e) {
    console.error('ERROR: no se pudo cargar firebase-admin desde functions/node_modules.');
    console.error('Correr: cd functions && npm install');
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('[1/5] Cargando maps auxiliares...');
  const [sapClientsMap, altasMap, pedidosWithCardCode] = await Promise.all([
    loadSapClientsMap(db),
    loadClientApplicationsMap(db),
    loadPedidosWithCardCode(db),
  ]);
  console.log('      sap_clients normMap: ' + sapClientsMap.size);
  console.log('      client_applications normMap: ' + altasMap.size);
  console.log('      pedidos con cardCode: ' + pedidosWithCardCode.size);
  const maps = { sap_clients: sapClientsMap, client_applications: altasMap };

  console.log('');
  console.log('[2/5] Scan pedidos/*...');
  const pedidosSnap = await db.collection('pedidos').get();
  console.log('      total pedidos: ' + pedidosSnap.size);

  console.log('[3/5] Scan revision_waitlist/*...');
  const wlSnap = await db.collection('revision_waitlist').get();
  console.log('      total waitlists: ' + wlSnap.size);

  // --- Clasificar ---
  const stats = {
    pedidos: {},
    waitlists: {},
  };
  const rowsPedidos = [];
  const rowsWaitlists = [];

  pedidosSnap.forEach((d) => {
    const data = d.data() || {};
    const c = classifyPedidoDoc(data, maps);
    stats.pedidos[c.bucket] = (stats.pedidos[c.bucket] || 0) + 1;
    if (c.bucket === 'has_cardcode') return;
    const createdIso = toIsoSafe(data.createdAt);
    const row = {
      collection: 'pedidos',
      docId: d.id,
      orderNumber: data.orderNumber || '',
      clientName: String(data.clientName || ''),
      clientCardCode: '',
      clientNameNorm: normName(String(data.clientName || '')),
      bucket: c.bucket,
      ageDays: c.ageDays != null ? c.ageDays : ageDays(createdIso),
      createdAt: createdIso,
      stage: data.stage || '',
      closedAt: toIsoSafe(data.closedAt),
      ownerUid: data.ownerUid || '',
      vendorAssigned: data.vendorAssigned || '',
      resolve_cardCode: c.resolved ? c.resolved.cardCode : '',
      resolve_source: c.resolved ? c.resolved.source : '',
      resolve_note: c.resolved ? (c.resolved.note || c.resolved.matchedNormName || '') : '',
    };
    rowsPedidos.push(row);
  });

  wlSnap.forEach((d) => {
    const data = d.data() || {};
    const c = classifyWaitlistDoc(data, maps, pedidosWithCardCode);
    stats.waitlists[c.bucket] = (stats.waitlists[c.bucket] || 0) + 1;
    if (c.bucket === 'has_cardcode') return;
    const createdIso = toIsoSafe(data.createdAt);
    const row = {
      collection: 'revision_waitlist',
      docId: d.id,
      orderNumber: data.orderNumber || '',
      clientName: String(data.clientName || ''),
      clientCardCode: '',
      clientNameNorm: normName(String(data.clientName || '')),
      bucket: c.bucket,
      ageDays: c.ageDays != null ? c.ageDays : ageDays(createdIso),
      createdAt: createdIso,
      stage: data.stage || '',
      closedAt: toIsoSafe(data.closedAt),
      ownerUid: data.ownerUid || '',
      vendorAssigned: data.vendorAssigned || '',
      resolve_cardCode: c.resolved ? c.resolved.cardCode : '',
      resolve_source: c.resolved ? c.resolved.source : '',
      resolve_note: c.resolved ? (c.resolved.note || c.resolved.matchedNormName || c.resolved.pedidoOrigen || '') : '',
    };
    rowsWaitlists.push(row);
  });

  // --- Escribir CSV ---
  console.log('');
  console.log('[4/5] Escribiendo CSV: ' + CSV_PATH);
  const header = [
    'collection', 'docId', 'orderNumber', 'clientName', 'clientCardCode',
    'clientNameNorm', 'bucket', 'ageDays', 'createdAt', 'stage', 'closedAt',
    'ownerUid', 'vendorAssigned',
    'resolve_cardCode', 'resolve_source', 'resolve_note',
  ];
  const lines = [header.join(',')];
  const allRows = rowsPedidos.concat(rowsWaitlists);
  for (const r of allRows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(','));
  }
  fs.writeFileSync(CSV_PATH, lines.join('\n') + '\n', 'utf8');
  console.log('      ' + allRows.length + ' rows (pedidos: ' + rowsPedidos.length + ', waitlists: ' + rowsWaitlists.length + ')');

  // --- Escribir markdown summary ---
  console.log('[5/5] Escribiendo markdown: ' + MD_PATH);
  const resolvibles = allRows.filter((r) => r.resolve_cardCode).length;
  const md = [];
  md.push('# HARDENING 5 — BATCH 3 — Legacy `clientCardCode` audit');
  md.push('');
  md.push('**Fecha**: ' + new Date().toISOString());
  md.push('**Script**: `scripts/audit/AX_legacy_client_cardcode_audit.cjs`');
  md.push('**Mode**: ' + (WANT_APPLY ? 'APPLY' : WANT_DRY_BACKFILL ? 'DRY-RUN-BACKFILL' : 'DRY-RUN'));
  md.push('**Runtime**: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push('### pedidos/*');
  md.push('');
  md.push('| bucket | count |');
  md.push('|---|---:|');
  for (const [b, c] of Object.entries(stats.pedidos).sort()) md.push('| ' + b + ' | ' + c + ' |');
  md.push('| **total escaneados** | **' + pedidosSnap.size + '** |');
  md.push('');
  md.push('### revision_waitlist/*');
  md.push('');
  md.push('| bucket | count |');
  md.push('|---|---:|');
  for (const [b, c] of Object.entries(stats.waitlists).sort()) md.push('| ' + b + ' | ' + c + ' |');
  md.push('| **total escaneados** | **' + wlSnap.size + '** |');
  md.push('');
  md.push('## Backfill proposal');
  md.push('');
  md.push('- **Resolvibles (dry-run)**: ' + resolvibles + ' docs. Ver CSV `resolve_cardCode` populated.');
  md.push('- **Ambiguos**: requieren revisión manual (ver docs/auditoria del `HARDENING5_03_LEGACY_AUDIT.md`).');
  md.push('- **Irrecuperables**: `missing_no_name` + `missing_pre_v1058_legacy` sin match.');
  md.push('');
  md.push('## Reversibilidad (si Mariano autoriza --apply)');
  md.push('');
  md.push('Slug propuesto: `_backfill.' + BACKFILL_SLUG + '.previousValues` (§55).');
  md.push('');
  md.push('Un script de reversión itera docs con ese slug + restaura `previousValues`.');
  md.push('');
  md.push('## Comando para correr');
  md.push('');
  md.push('```bash');
  md.push('# Dry-run puro (default):');
  md.push('node scripts/audit/AX_legacy_client_cardcode_audit.cjs');
  md.push('');
  md.push('# Dry-run con simulación de backfill:');
  md.push('node scripts/audit/AX_legacy_client_cardcode_audit.cjs --dry-run-backfill');
  md.push('');
  md.push('# Apply (triple-gate requerido; NO correr sin OK Mariano):');
  md.push('# CONFIRM_APPLY=yes-i-understand node scripts/audit/AX_legacy_client_cardcode_audit.cjs --apply');
  md.push('```');
  md.push('');
  fs.writeFileSync(MD_PATH, md.join('\n'), 'utf8');

  // --- Consola final ---
  console.log('');
  console.log('========================================================');
  console.log(' DONE in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('========================================================');
  console.log(' Stats pedidos:');
  for (const [b, c] of Object.entries(stats.pedidos)) console.log('   ' + b + ': ' + c);
  console.log(' Stats waitlists:');
  for (const [b, c] of Object.entries(stats.waitlists)) console.log('   ' + b + ': ' + c);
  console.log('');
  console.log(' Resolvibles (dry-run proposal): ' + resolvibles);
  console.log('');
  console.log(' CSV: ' + CSV_PATH);
  console.log(' MD : ' + MD_PATH);
  console.log('');

  // --- APPLY path (bloqueado por default). Deja esqueleto para el futuro.
  if (WANT_APPLY) {
    console.log('ERROR: --apply handler no implementado en este script.');
    console.log('       Esta función queda explícitamente stub para forzar un PR dedicado');
    console.log('       con revisión humana adicional antes de autorizar escritura masiva.');
    console.log('       Mariano: si autorizás backfill, un script sibling BX_apply_... lo hará');
    console.log('       leyendo este CSV + aplicando el shape _backfill.<slug>.previousValues.');
    process.exit(3);
  }
}

main().catch((e) => {
  console.error('FATAL: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
