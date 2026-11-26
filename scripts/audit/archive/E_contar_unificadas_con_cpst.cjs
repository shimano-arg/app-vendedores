/**
 * E1 — Contar órdenes unificadas en prod (pre-v1382) que absorbieron un CPST.
 *
 * Read-only. Autorizado A1 heredado del plan feat-unificar-lineas-asig.
 *
 * Estrategia:
 *   1. Scan `revision_waitlist` donde `unifiedFrom` tiene elementos.
 *   2. Para cada `unifiedFrom[].pedidoId`, chequear si ese waitlist (hoy
 *      cerrado por 'unified_into') tenía `source='stock-asignado-batch'`
 *      y `pedidosOrigenes[]` populated.
 *   3. Si al menos uno es CPST, el pedido unificado es candidato a review
 *      manual (su confirmación re-dispara bug H1 pre-fix v1382).
 */

const PROD = process.argv.includes('--prod');
const PROJECT = 'app-vendedores-shimano';

function logInfo() {
  console.log('================================================================');
  console.log('QUERY E — Ordenes unificadas con CPST absorbido (pre-v1382)');
  console.log('================================================================');
  console.log('');
  console.log('Scan revision_waitlist donde unifiedFrom tiene elementos.');
  console.log('Para cada unifiedFrom[].pedidoId → chequear si tenia source=');
  console.log('"stock-asignado-batch" + pedidosOrigenes[] populated.');
  console.log('');
}

async function runProd() {
  const admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('[prod] Scanning revision_waitlist con unifiedFrom populated...');
  const snap = await db.collection('revision_waitlist').get();
  console.log('[prod] docs leidos: ' + snap.size);

  const unificadas = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const uf = data.unifiedFrom;
    if (!Array.isArray(uf) || uf.length === 0) return;
    unificadas.push({ _id: doc.id, data, uf });
  });
  console.log('[prod] con unifiedFrom populated: ' + unificadas.length);

  const hallazgos = [];
  for (const u of unificadas) {
    const cpstAbsorbidos = [];
    for (const entry of u.uf) {
      if (!entry || !entry.pedidoId) continue;
      try {
        const abs = await db.collection('revision_waitlist').doc(entry.pedidoId).get();
        if (!abs.exists) continue;
        const absData = abs.data() || {};
        if (
          absData.source === 'stock-asignado-batch' &&
          Array.isArray(absData.pedidosOrigenes) &&
          absData.pedidosOrigenes.length > 0
        ) {
          cpstAbsorbidos.push({
            orderNumber: entry.orderNumber,
            pedidoId: entry.pedidoId,
            pedidosOrigenesCount: absData.pedidosOrigenes.length,
            lineCount: entry.lineCount,
          });
        }
      } catch (e) {
        console.warn('[prod] fetch error ' + entry.pedidoId + ': ' + (e.message || e));
      }
    }
    if (cpstAbsorbidos.length > 0) {
      hallazgos.push({
        unificadaId: u._id,
        clientName: u.data.clientName,
        clientCardCode: u.data.clientCardCode,
        orderNumber: u.data.orderNumber,
        stage: u.data.stage || 'waitlist',
        closedAt: u.data.closedAt || null,
        cpstAbsorbidos,
      });
    }
  }

  console.log('');
  console.log('===== RESULTADO Query E =====');
  console.log('Total ordenes unificadas con CPST absorbida: ' + hallazgos.length);
  console.log('');
  if (hallazgos.length > 0) {
    for (const h of hallazgos) {
      console.log(
        `  ${h.unificadaId} / ORDEN ${h.orderNumber} / ${h.clientName} (${h.clientCardCode}) / stage=${h.stage}`
      );
      for (const c of h.cpstAbsorbidos) {
        console.log(
          `    └─ absorbio CPST ORDEN ${c.orderNumber} (${c.pedidoId}) con ${c.pedidosOrigenesCount} pedidosOrigenes, ${c.lineCount} lineas`
        );
      }
    }
  }
  return hallazgos;
}

if (!PROD) {
  logInfo();
  console.log('MODO: dry-run. Para ejecutar: --prod');
  process.exit(0);
}
logInfo();
console.log('MODO: --prod. Ejecutando...');
runProd()
  .then((h) => {
    console.log('');
    console.log('Total hallazgos: ' + h.length);
    process.exit(0);
  })
  .catch((e) => {
    console.error('ERR', e);
    process.exit(1);
  });
