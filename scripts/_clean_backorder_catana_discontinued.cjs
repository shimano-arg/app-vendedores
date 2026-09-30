/**
 * _clean_backorder_catana_discontinued.cjs — 2026-09-30
 *
 * Limpia el backorder APP de los SKUs CATANA FE (2022) que Mariano marcó
 * como descontinuados. NO hay reposición futura, no tiene sentido tenerlos
 * como backorder pendiente.
 *
 * Efectos:
 *   1. Recorre `pedidos` con líneas en state='BO' de los SKUs listados.
 *   2. Cambia state='BO' → 'cancelled_discontinued' + agrega metadata.
 *   3. Actualiza `forecast_config/discontinued_skus` con los SKUs.
 *
 * Uso: node scripts/_clean_backorder_catana_discontinued.cjs
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

// SKUs CATANA FE (2022) descontinuados — no vuelven a importarse.
const DISCONTINUED_SKUS = [
  'CAT4000HGFE',
  'CATC3000FE',
  'CAT4000FE',
  'CATC3000HGFE',
  'CAT1000FE',
  'CAT2500FE',
  'CATC300HGFE', // no encontrado en master pero igual
  'CAT2500HGFE',
];

const DISCONTINUED_SET = new Set(DISCONTINUED_SKUS.map((s) => s.toUpperCase()));
const NOW_ISO = new Date().toISOString();
const REASON = 'SKU descontinuado (CATANA FE 2022) — no habrá reposición';

async function updateDiscontinuedList() {
  const ref = db.collection('forecast_config').doc('discontinued_skus');
  const doc = await ref.get();
  const existing = doc.exists && Array.isArray(doc.data().skus) ? doc.data().skus : [];
  const merged = Array.from(new Set([...existing, ...DISCONTINUED_SKUS.map((s) => s.toUpperCase())])).sort();
  await ref.set({
    skus: merged,
    updatedAt: NOW_ISO,
    updatedBy: 'scripts/_clean_backorder_catana_discontinued.cjs',
  });
  console.log(`✓ forecast_config/discontinued_skus updated: ${existing.length} → ${merged.length} SKUs`);
}

async function cleanPedidosBackorder() {
  console.log(`\nEscaneando pedidos con líneas BO de ${DISCONTINUED_SKUS.length} SKUs descontinuados...`);
  const snap = await db.collection('pedidos').get();
  console.log(`  Total pedidos en Firestore: ${snap.size}`);

  let pedidosAfectados = 0;
  let lineasCanceladas = 0;
  let unidadesCanceladas = 0;
  const batch = [];
  const summary = [];

  snap.forEach((doc) => {
    const d = doc.data();
    if (!d || !Array.isArray(d.lines)) return;
    let hasChanges = false;
    const newLines = d.lines.map((l) => {
      if (!l || !l.state || l.state !== 'BO') return l;
      const sku = String(l.itemCode || l.sku || '').trim().toUpperCase();
      if (!DISCONTINUED_SET.has(sku)) return l;
      hasChanges = true;
      lineasCanceladas++;
      const qty = Number(l.qtyOpen) || Number(l.qty) || 0;
      unidadesCanceladas += qty;
      return Object.assign({}, l, {
        state: 'cancelled_discontinued',
        qtyOpen: 0,
        cancelledAt: NOW_ISO,
        cancelledReason: REASON,
        cancelledBy: 'scripts/_clean_backorder_catana_discontinued.cjs',
      });
    });
    if (hasChanges) {
      pedidosAfectados++;
      summary.push({
        pedidoId: doc.id,
        cliente: d.clientName || d.cardName || '(sin nombre)',
        vendor: d.ownerVendor || d.vendor || '',
        ownerEmail: d.ownerEmail || '',
      });
      batch.push({ id: doc.id, lines: newLines });
    }
  });

  console.log(`\n  Pedidos afectados: ${pedidosAfectados}`);
  console.log(`  Líneas BO canceladas: ${lineasCanceladas}`);
  console.log(`  Unidades canceladas: ${unidadesCanceladas}`);

  if (summary.length && summary.length <= 20) {
    console.log('\n  Detalle:');
    summary.forEach((s) => {
      console.log(`    - ${s.pedidoId} · ${s.cliente} · ${s.vendor || '(sin vendor)'}`);
    });
  } else if (summary.length > 20) {
    console.log('\n  Muestra (primeros 20):');
    summary.slice(0, 20).forEach((s) => {
      console.log(`    - ${s.pedidoId} · ${s.cliente} · ${s.vendor || '(sin vendor)'}`);
    });
    console.log(`    ... y ${summary.length - 20} más`);
  }

  if (!batch.length) {
    console.log('\n  Nada que actualizar.');
    return;
  }

  console.log(`\nActualizando ${batch.length} pedidos en Firestore (batches de 400)...`);
  let done = 0;
  for (let i = 0; i < batch.length; i += 400) {
    const chunk = batch.slice(i, i + 400);
    const b = db.batch();
    for (const item of chunk) {
      const ref = db.collection('pedidos').doc(item.id);
      b.update(ref, {
        lines: item.lines,
        // Marca de auditoría a nivel doc.
        cleanedDiscontinuedAt: NOW_ISO,
        cleanedDiscontinuedBy: 'scripts/_clean_backorder_catana_discontinued.cjs',
      });
    }
    await b.commit();
    done += chunk.length;
    console.log(`  ${done}/${batch.length}`);
  }
  console.log('\n✓ Backorder APP cancelado.');
}

(async () => {
  console.log('=== Clean Backorder CATANA FE Discontinued ===');
  console.log(`SKUs: ${DISCONTINUED_SKUS.join(', ')}`);
  await updateDiscontinuedList();
  await cleanPedidosBackorder();
  console.log('\n=== DONE ===');
  console.log('\nNota: El backorder que viene de SAP (stock_snapshot.backorderBySku) no se');
  console.log('modifica desde acá — proviene del sync SAP y refleja el estado real de SAP.');
  console.log('Si querés que tampoco aparezcan en el modal Backorder, hay que:');
  console.log('  a) Cerrar las Sales Quotations en SAP (fuente de verdad), o');
  console.log('  b) Extender el modal Backorder para excluir SKUs en forecast_config/discontinued_skus.');
  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
