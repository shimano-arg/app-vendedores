// @ts-nocheck
/**
 * BA — audit read-only de clientes afectados por el Incidente Frente A
 * (ASIG_REF_INVALID stale refs post revertSobreAsignadas / recorte §40.7).
 *
 * Uso:
 *   node scripts/audit/BA_incidente_frente_a_clientes_afectados.cjs \
 *     --project app-vendedores-shimano \
 *     [--card C30719034914 --card C30718510291 ...] \
 *     [--limit 500]
 *
 * Para cada cardCode:
 *   1. Lista waitlists abiertas del cliente (closedAt==null, stage!='consumed').
 *   2. Para cada waitlist, iterate `items[].asigRefs[]`.
 *   3. Para cada ref, fetch pedido origen + línea apuntada.
 *   4. Clasifica ref según los 7 CHECKs + nuevos 5 healing cases (A-E).
 *
 * Output: tabla ASCII por cliente + resumen.
 *
 * Zero writes.
 */

const admin = require('firebase-admin');

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { cards: [], limit: 500, project: 'app-vendedores-shimano' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--card') args.cards.push(argv[++i]);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
  }
  if (args.cards.length === 0) {
    args.cards = [
      'C30719034914', // SNAKE SRL
      'C30718510291',
      'C20306384415',
      'C30717530507',
      'C20139853637',
    ];
  }
  return args;
}

function normalize(s) {
  return String(s || '').toUpperCase().trim();
}

function classifyRef(ref, origenPed) {
  if (!origenPed) {
    return { action: 'DROP', reason: 'PEDIDO_ORIGEN_NOT_FOUND' };
  }
  const lines = Array.isArray(origenPed.lines) ? origenPed.lines : [];
  const li = Number(ref.lineIndex);
  if (!Number.isInteger(li) || li < 0 || li >= lines.length) {
    return { action: 'ABORT_CHECK_A', reason: 'LINE_INDEX_INVALID' };
  }
  const originalLine = lines[li];
  if (!originalLine) {
    return { action: 'ABORT_CHECK_B', reason: 'LINE_MISSING' };
  }
  const refSku = ref.sku ? normalize(ref.sku) : null;
  const actualSku = normalize(originalLine.code);
  if (refSku && refSku !== actualSku) {
    return { action: 'ABORT_CHECK_C', reason: 'SKU_MISMATCH', refSku, actualSku };
  }
  const state = String(originalLine.state || '');
  const qtyOpen = Number(originalLine.qtyOpen) || 0;
  const asigRevertidaReason = originalLine.asigRevertidaReason || '';
  const closedReason = originalLine.closedReason || '';

  if (
    state === 'BO' &&
    (asigRevertidaReason === 'asig_sin_stock_revertida_a_bo' ||
      asigRevertidaReason === 'asig_destildada_por_admin')
  ) {
    return { action: 'DROP_HEAL_A', reason: 'revertida_a_bo', state, asigRevertidaReason };
  }
  if (
    state === 'cancelled' &&
    ['cliente_rechazo_cpst', 'quitado_por_vendedor_cpst', 'recorte_vendedor_cpst'].includes(
      closedReason
    )
  ) {
    return { action: 'DROP_HEAL_C', reason: 'rechazo_explicito', state, closedReason };
  }
  if (state === 'cancelled' && closedReason === 'waitlist-confirm') {
    return { action: 'DROP_HEAL_D', reason: 'consumida_otro_pedido', state, closedReason };
  }
  if (state === 'cancelled' && typeof originalLine.splitFromLineIndex === 'number') {
    const twin = lines.findIndex(
      (l) =>
        l &&
        l.state === 'ASIG' &&
        Number(l.qtyOpen) > 0 &&
        l.splitFromLineIndex === li &&
        normalize(l.code) === actualSku
    );
    if (twin !== -1) {
      return { action: 'REPOINT', reason: 'split_twin', newLineIndex: twin };
    }
    return { action: 'DROP_HEAL_B', reason: 'split_sin_gemela_viva', state };
  }
  if (state === 'ASIG' && qtyOpen <= 0) {
    return { action: 'DROP_HEAL_E', reason: 'zombie_qtyopen_cero' };
  }
  if (state === 'ASIG' && qtyOpen > 0) {
    const refQty = Number(ref.qtyAsignada) || 0;
    if (refQty > qtyOpen) {
      return {
        action: 'CLAMP',
        reason: 'qty_insuficiente',
        refQty,
        qtyOpen,
      };
    }
    return { action: 'KEEP', reason: 'asig_viva_ok', qtyOpen };
  }
  if (state === 'cancelled') {
    return { action: 'ABORT_CHECK_D2', reason: 'STATE_MISMATCH', state, closedReason };
  }
  return { action: 'ABORT_CHECK_D2', reason: 'STATE_MISMATCH', state };
}

async function main() {
  const args = parseArgs();
  try {
    admin.initializeApp({ projectId: args.project });
  } catch (_e) {
    try {
      admin.initializeApp();
    } catch (_e2) {
      /* already initialized */
    }
  }
  const db = admin.firestore();
  console.log('\n=== BA Audit Frente A — clientes afectados ===');
  console.log('Project:', args.project);
  console.log('CardCodes:', args.cards.join(', '));
  console.log('');

  const summary = { total: 0, byReason: {}, byClient: {} };

  for (const cardCode of args.cards) {
    console.log(`\n--- Cliente ${cardCode} ---`);
    const wlSnap = await db
      .collection('revision_waitlist')
      .where('clientCardCode', '==', cardCode)
      .limit(args.limit)
      .get();
    const wlDocs = [];
    wlSnap.forEach((d) => wlDocs.push({ _id: d.id, ...d.data() }));
    const open = wlDocs.filter((w) => !w.closedAt && w.stage !== 'consumed');
    console.log(`  Waitlists abiertas: ${open.length} / total ${wlDocs.length}`);

    if (open.length === 0) {
      console.log('  Sin waitlists abiertas.');
      continue;
    }

    for (const w of open) {
      const items = Array.isArray(w.items) ? w.items : [];
      console.log(
        `  WL ${w._id} ORD ${w.orderNumber || '?'} source=${w.source || '?'} items=${items.length}`
      );
      // Pedido origen snapshots por pedidoId
      const origenIds = new Set();
      for (const it of items) {
        if (Array.isArray(it.asigRefs)) {
          for (const r of it.asigRefs) {
            if (r && r.pedidoId) origenIds.add(r.pedidoId);
          }
        }
      }
      const origenCache = new Map();
      for (const pid of origenIds) {
        const pd = await db.collection('pedidos').doc(pid).get();
        origenCache.set(pid, pd.exists ? pd.data() : null);
      }

      let refsEnEstaWl = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!Array.isArray(it.asigRefs) || it.asigRefs.length === 0) continue;
        for (const ref of it.asigRefs) {
          refsEnEstaWl++;
          summary.total++;
          const ped = origenCache.get(ref.pedidoId);
          const verdict = classifyRef(ref, ped);
          summary.byReason[verdict.reason] =
            (summary.byReason[verdict.reason] || 0) + 1;
          summary.byClient[cardCode] =
            (summary.byClient[cardCode] || 0) + 1;
          if (verdict.action !== 'KEEP') {
            console.log(
              `    item[${i}] sku=${it.code} ref(${ref.pedidoId.slice(0, 8)}…, li=${ref.lineIndex}, qty=${ref.qtyAsignada}) → ${verdict.action} ${verdict.reason}`
            );
          }
        }
      }
      console.log(`    total refs en esta WL: ${refsEnEstaWl}`);
    }
  }

  console.log('\n\n=== RESUMEN ===');
  console.log(`Total refs analizadas: ${summary.total}`);
  console.log('Por razón:');
  for (const [reason, n] of Object.entries(summary.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(30)} ${n}`);
  }
  console.log('Por cliente:');
  for (const [card, n] of Object.entries(summary.byClient).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${card.padEnd(20)} ${n}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
