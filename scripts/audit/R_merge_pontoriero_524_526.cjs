// R — mergea ORDEN 526 (incoming) dentro de ORDEN 524 (target) para
// PONTORIERO (C20175569635). Causa: violación §42 porque la 526 no se
// unificó al crearla el 2026-10-22 13:38 (cache local del creator sin la
// 524 → el helper cayó al create path).
//
// Lógica reusa el patrón de v1382 Unificar orden + v1404 §42 unificación:
//   - target (524) mantiene su orderNumber, vendor, createdAt.
//   - items[] del 526 se agregan al items[] del 524 (sin dedup SKU).
//   - pedidosOrigenes del 526 se agregan al target con dedup
//     (pedidoId, lineIndex).
//   - unifiedFrom[] del target recibe audit:
//       {orderNumber:524, source:'creacion_cpst', timestamp:original, by:original}
//       {orderNumber:526, source:'unificacion_absorbida', timestamp:nowIso, by:'script-manual'}
//   - 526 queda consumed: stage='consumed', closedAt=nowIso,
//     closedReason='unified_into_v42', unifiedInto=target._id,
//     unifiedIntoOrderNumber=524.
//
// Autorizado por Mariano 2026-10-22 (v1415 §42.1).

const PROJECT = 'app-vendedores-shimano';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

const CARD_CODE = 'C20175569635';
const TARGET_ORDER = 524;
const ABSORB_ORDER = 526;

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log(`R — Merge ORDEN ${ABSORB_ORDER} → ${TARGET_ORDER} (PONTORIERO) @ ${nowIso}`);
  console.log('================================================================');
  console.log('Modo:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log();

  // Query ambas órdenes.
  const qs = await db
    .collection('revision_waitlist')
    .where('clientCardCode', '==', CARD_CODE)
    .get();

  /** @type {any} */ let target = null;
  /** @type {any} */ let absorb = null;
  qs.forEach((d) => {
    const data = d.data() || {};
    if (data.closedAt) return;
    if (data.stage === 'consumed') return;
    if (Number(data.orderNumber) === TARGET_ORDER) target = Object.assign({ _id: d.id }, data);
    if (Number(data.orderNumber) === ABSORB_ORDER) absorb = Object.assign({ _id: d.id }, data);
  });

  if (!target) {
    throw new Error(`No encontré ORDEN ${TARGET_ORDER} abierta para ${CARD_CODE}`);
  }
  if (!absorb) {
    throw new Error(`No encontré ORDEN ${ABSORB_ORDER} abierta para ${CARD_CODE}`);
  }

  console.log(`Target (524): _id=${target._id} items=${(target.items || []).length} createdAt=${target.createdAt}`);
  console.log(`Absorb (526): _id=${absorb._id} items=${(absorb.items || []).length} createdAt=${absorb.createdAt}`);
  console.log();

  // Build merged items (append incoming, no dedup — mismo pattern que v1382).
  const existing = Array.isArray(target.items) ? target.items.slice() : [];
  const incoming = Array.isArray(absorb.items) ? absorb.items.slice() : [];
  const mergedItems = existing.concat(incoming);

  // Union pedidosOrigenes con dedup por (pedidoId, lineIndex).
  const seenOrigenes = new Set();
  const mergedOrigenes = [];
  const pushOrigen = (r) => {
    if (!r || !r.pedidoId) return;
    const k = r.pedidoId + '|' + (r.lineIndex != null ? r.lineIndex : '');
    if (seenOrigenes.has(k)) return;
    seenOrigenes.add(k);
    mergedOrigenes.push(r);
  };
  (Array.isArray(target.pedidosOrigenes) ? target.pedidosOrigenes : []).forEach(pushOrigen);
  (Array.isArray(absorb.pedidosOrigenes) ? absorb.pedidosOrigenes : []).forEach(pushOrigen);

  // unifiedFrom audit.
  const existingUnifiedFrom = Array.isArray(target.unifiedFrom) ? target.unifiedFrom.slice() : [];
  // Si el target no tenía ninguna entrada previa, registrar su creación original.
  if (existingUnifiedFrom.length === 0) {
    existingUnifiedFrom.push({
      orderNumber: TARGET_ORDER,
      source: 'creacion_cpst',
      timestamp: typeof target.createdAt === 'string' ? target.createdAt : nowIso,
      by: target.ownerEmail || target.ownerDisplayName || '',
    });
  }
  existingUnifiedFrom.push({
    orderNumber: ABSORB_ORDER,
    source: 'unificacion_absorbida',
    timestamp: nowIso,
    by: 'scripts/audit/R_merge_pontoriero_524_526.cjs',
  });

  const updateTarget = {
    items: mergedItems,
    pedidosOrigenes: mergedOrigenes,
    unifiedFrom: existingUnifiedFrom,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    _v42_1_manual_merge: nowIso,
  };
  const updateAbsorb = {
    stage: 'consumed',
    closedAt: nowIso,
    closedReason: 'unified_into_v42',
    unifiedInto: target._id,
    unifiedIntoOrderNumber: TARGET_ORDER,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  console.log('===== TARGET update preview =====');
  console.log(`  items: ${existing.length} → ${mergedItems.length} (+${incoming.length})`);
  console.log(`  pedidosOrigenes: ${(target.pedidosOrigenes || []).length} → ${mergedOrigenes.length}`);
  console.log(`  unifiedFrom entries: ${(target.unifiedFrom || []).length} → ${existingUnifiedFrom.length}`);
  console.log();
  console.log('===== ABSORB update preview =====');
  console.log(`  stage: ${absorb.stage || '(none)'} → consumed`);
  console.log(`  closedReason: unified_into_v42`);
  console.log(`  unifiedInto: ${target._id}`);
  console.log();

  if (!APPLY) {
    console.log('DRY-RUN: nada se escribió. Volvé a correr con --apply para persistir.');
    return;
  }

  const batch = db.batch();
  batch.update(db.collection('revision_waitlist').doc(target._id), updateTarget);
  batch.update(db.collection('revision_waitlist').doc(absorb._id), updateAbsorb);
  await batch.commit();
  console.log(`OK — ORDEN ${ABSORB_ORDER} absorbida en ${TARGET_ORDER}.`);
  console.log(`PONTORIERO queda con 1 sola orden abierta en lista de espera (${TARGET_ORDER}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
