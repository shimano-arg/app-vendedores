// AD — PR1 (v1474 2026-10-26 §71) backfill de fechas Firestore Timestamp → ISO string.
//
// Problema: pedidos entre v1457 y v1473 escribieron confirmedAt/createdAt como
// FieldValue.serverTimestamp() → Firestore Timestamp. UI muestra "Invalid Date"
// porque new Date(timestamp) donde timestamp={seconds,nanoseconds} falla.
//
// Fix v1473: pedidos nuevos escriben ISO string.
// Fix v1474 (este script): backfill de los viejos.
// Fix v1474 extra: UI usa parseFirestoreDate tolerante a los 2 formatos (ya shippeado).
//
// Campos a convertir en /pedidos:
//   - confirmedAt
//   - createdAt
//   - transferredAt (top-level — algunos viejos pueden tener Timestamp)
//   - cobradoAt
//   - invoicedAt
//   - transferidoSAP.transferredAt (nested, string ISO; chequear por si acaso)
//
// Uso:
//   node scripts/audit/AD_backfill_fechas_timestamp_a_iso.cjs           (dry-run)
//   node scripts/audit/AD_backfill_fechas_timestamp_a_iso.cjs --apply  (ejecuta)

const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG = 'AD_fechas_ts_a_iso_2026-10-26_v1474';
const CAMPOS = ['confirmedAt', 'createdAt', 'transferredAt', 'cobradoAt', 'invoicedAt'];

function isFirestoreTimestamp(v) {
  if (!v || typeof v !== 'object') return false;
  if (v instanceof Date) return false;
  if (typeof v.toDate === 'function') return true;
  if (typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') return true;
  if (typeof v._seconds === 'number' && typeof v._nanoseconds === 'number') return true;
  return false;
}

function tsToIso(v) {
  if (!isFirestoreTimestamp(v)) return null;
  try {
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    const s = typeof v.seconds === 'number' ? v.seconds : v._seconds;
    const ns = typeof v.nanoseconds === 'number' ? v.nanoseconds : (v._nanoseconds || 0);
    return new Date(s * 1000 + Math.floor(ns / 1e6)).toISOString();
  } catch (e) {
    return null;
  }
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const apply = process.argv.includes('--apply');
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('AD — Backfill fechas Timestamp → ISO string');
  console.log('================================================================');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Campos: ${CAMPOS.join(', ')}`);
  console.log(`Slug: ${BACKFILL_SLUG}`);
  console.log();

  const snap = await db.collection('pedidos').get();
  console.log(`Total pedidos en la colección: ${snap.size}`);

  let affected = 0;
  const _detalles = [];
  const batches = [[]];
  const BATCH_LIMIT = 400;

  snap.forEach((d) => {
    const data = d.to_dict ? d.to_dict() : d.data();
    const toFix = {};
    const previousValues = {};
    for (const campo of CAMPOS) {
      const v = data[campo];
      if (isFirestoreTimestamp(v)) {
        const iso = tsToIso(v);
        if (iso) {
          toFix[campo] = iso;
          previousValues[campo] = { type: 'Timestamp', seconds: v.seconds || v._seconds };
        }
      }
    }
    if (Object.keys(toFix).length === 0) return;
    affected++;
    _detalles.push({
      id: d.id,
      order: data.orderNumber,
      cliente: data.clientName,
      campos: Object.keys(toFix),
    });
    if (!apply) return;
    const update = {
      ...toFix,
      _backfill: {
        ...(data._backfill || {}),
        [BACKFILL_SLUG]: {
          previousValues,
          by: 'scripts/audit/AD_backfill_fechas_timestamp_a_iso.cjs',
          at: nowIso,
        },
      },
      _lastBackfillAt: nowIso,
      _lastBackfillBy: 'scripts/audit/AD_backfill_fechas_timestamp_a_iso.cjs',
    };
    let currentBatch = batches[batches.length - 1];
    if (currentBatch.length >= BATCH_LIMIT) {
      currentBatch = [];
      batches.push(currentBatch);
    }
    currentBatch.push({ ref: d.ref, update });
  });

  console.log(`\nPedidos afectados: ${affected}`);
  console.log('Primeros 20:');
  for (const d of _detalles.slice(0, 20)) {
    console.log(`  ${d.id} orden=${d.order} cliente=${d.cliente} campos=${d.campos.join(',')}`);
  }
  if (_detalles.length > 20) console.log(`  ... ${_detalles.length - 20} más`);
  console.log();

  if (!apply) {
    console.log('DRY-RUN: no se escribió nada. Correr con --apply para ejecutar.');
    return;
  }

  let totalWrites = 0;
  for (const batchData of batches) {
    if (batchData.length === 0) continue;
    const b = db.batch();
    for (const { ref, update } of batchData) b.update(ref, update);
    await b.commit();
    totalWrites += batchData.length;
    console.log(`  batch commit: ${batchData.length} writes (acum: ${totalWrites})`);
  }
  console.log(`\n✓ Backfill completo: ${totalWrites} pedidos actualizados.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
