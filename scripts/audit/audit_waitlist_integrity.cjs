// audit-waitlist-integrity — read-only prod: 2 categorías
//
// Categoría A (zombies): revision_waitlist con stage='consumed' pero sin
// closedAt. §42 marca consumed al pasar a pedidos; si el update parcial
// quedó incompleto, el doc es invisible para readers pero sigue en la
// colección como ruido.
//
// Categoría B (abandonados): revision_waitlist abiertas (closedAt==null,
// stage!=consumed) con items=[] vacío. Son borradores sin demanda real.
//
// Qué estado corrige:
//   A: `revision_waitlist/<id>.closedAt=nowIso` + `closedReason='consumed_cleanup_v1425'`.
//   B: `revision_waitlist/<id>.closedAt=nowIso` + `closedReason='empty_items_cleanup_v1425'`.
// Cuántos docs toca: 1 doc revision_waitlist por caso.
// Qué campo cambia: `closedAt` + `closedReason` (ambos del root del doc).
// Reversible: SÍ (clear ambos campos).

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('audit-waitlist-integrity @ ' + nowIso + '  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('================================================================');

  const snap = await db.collection('revision_waitlist').get();
  const zombies = [];
  const abandoned = [];
  snap.forEach((d) => {
    const w = d.data() || {};
    const stage = w.stage || '';
    const closedAt = w.closedAt;
    const items = Array.isArray(w.items) ? w.items : [];
    // A: consumed sin closedAt
    if (stage === 'consumed' && !closedAt) {
      zombies.push({
        waitlistId: d.id,
        orderNumber: w.orderNumber || '',
        cliente: w.clientName || '',
        cardCode: w.clientCardCode || '',
        consumedAt: w.consumedAt || null,
        consumedByPedidoId: w.consumedByPedidoId || null,
        itemsCount: items.length,
      });
      return;
    }
    // B: abierto sin items
    if (!closedAt && stage !== 'consumed' && items.length === 0) {
      abandoned.push({
        waitlistId: d.id,
        orderNumber: w.orderNumber || '',
        cliente: w.clientName || '',
        cardCode: w.clientCardCode || '',
        createdAt: w.createdAt || null,
        stage,
      });
    }
  });

  console.log('\n=== Categoría A: consumed sin closedAt (zombies) ===');
  console.log('Afectados: ' + zombies.length);
  for (const row of zombies) {
    console.log(
      `revision_waitlist/${row.waitlistId} ORDEN=${row.orderNumber} cliente="${row.cliente}" ` +
      `cardCode=${row.cardCode} items=${row.itemsCount} consumedAt=${row.consumedAt} → consumedBy=${row.consumedByPedidoId}`
    );
  }

  console.log('\n=== Categoría B: abiertos sin items (abandoned) ===');
  console.log('Afectados: ' + abandoned.length);
  for (const row of abandoned) {
    console.log(
      `revision_waitlist/${row.waitlistId} ORDEN=${row.orderNumber} cliente="${row.cliente}" ` +
      `cardCode=${row.cardCode} stage=${row.stage} createdAt=${row.createdAt}`
    );
  }

  const total = zombies.length + abandoned.length;

  if (APPLY && total > 0) {
    console.log('\nAPLICANDO ' + total + ' cleanups...');
    for (const row of zombies) {
      await db.collection('revision_waitlist').doc(row.waitlistId).update({
        closedAt: nowIso,
        closedReason: 'consumed_cleanup_v1425',
      });
      console.log('  ✓ A zombie ' + row.waitlistId);
    }
    for (const row of abandoned) {
      await db.collection('revision_waitlist').doc(row.waitlistId).update({
        closedAt: nowIso,
        closedReason: 'empty_items_cleanup_v1425',
      });
      console.log('  ✓ B abandoned ' + row.waitlistId);
    }
  } else if (!APPLY && total > 0) {
    console.log('\nDRY-RUN completo. Correr con --apply para ' + total + ' cleanups.');
  } else {
    console.log('\nSin alertas.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
