// AH — verif planner vacio (2026-10-27 v1478 debug).
//
// Hipotesis: backfill AD v1474 convirtio pedidos.createdAt de Timestamp a
// string ISO. El listener del Planner hace:
//   base.where('createdAt', '>=', new Date(Date.now() - 90*86400000))
// Firestore trata el Date como Timestamp y por tipo (string < timestamp)
// nunca matchea strings → 0 docs devueltos.
//
// Este script NO modifica nada. Solo lee + diagnostica.
//
// Evidencia a recolectar:
//   1. Cuantos pedidos abiertos tienen createdAt=string vs Timestamp.
//   2. Reproducir la query del Planner con JS Date → ver que trae 0.
//   3. Comparar: query con string ISO del cutoff → trae N > 0.
//   4. Un pedido ejemplo por columna (Oferta, Pending, Facturar, Cobrado)
//      con sus campos de fecha + tipo.

const PROJECT = 'app-vendedores-shimano';
const admin = require('../../functions/node_modules/firebase-admin');

function typeOf(v) {
  if (v == null) return 'null';
  if (v instanceof Date) return 'Date';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'object' && typeof v.toDate === 'function') return 'Timestamp';
  if (typeof v === 'object' && typeof v.seconds === 'number') return 'TimestampLike';
  return typeof v;
}

async function main() {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('AH — Verif planner vacio v1478 (2026-10-27)');
  console.log('================================================================');

  // 1. Scan tipos de createdAt en /pedidos.
  console.log('\n[1/4] Scan tipos de createdAt en /pedidos...');
  const snapAll = await db.collection('pedidos').get();
  const tipos = { string: 0, Timestamp: 0, null: 0, other: 0 };
  snapAll.forEach(d => {
    const data = d.data() || {};
    const t = typeOf(data.createdAt);
    if (t === 'string') tipos.string++;
    else if (t === 'Timestamp' || t === 'TimestampLike') tipos.Timestamp++;
    else if (t === 'null') tipos.null++;
    else tipos.other++;
  });
  console.log(`  total: ${snapAll.size}`);
  console.log(`  createdAt string ISO: ${tipos.string}`);
  console.log(`  createdAt Timestamp: ${tipos.Timestamp}`);
  console.log(`  createdAt null: ${tipos.null}`);
  console.log(`  createdAt otro: ${tipos.other}`);

  // 2. Reproducir query Planner exacta.
  const cutoffDate = new Date(Date.now() - 90 * 86400000);
  console.log(`\n[2/4] Query Planner — where('createdAt', '>=', ${cutoffDate.toISOString()}) [Date]`);
  const qDate = await db.collection('pedidos').where('createdAt', '>=', cutoffDate).get();
  console.log(`  docs devueltos: ${qDate.size}`);

  // 3. Mismo rango pero con string ISO.
  const cutoffIso = cutoffDate.toISOString();
  console.log(`\n[3/4] Mismo rango con string ISO — where('createdAt', '>=', '${cutoffIso}')`);
  const qIso = await db.collection('pedidos').where('createdAt', '>=', cutoffIso).get();
  console.log(`  docs devueltos: ${qIso.size}`);

  // 4. Ejemplos por columna: tomar algunos pedidos recientes (orderNumber alto)
  //    y mostrar sus campos de fecha + tipos.
  console.log('\n[4/4] Ejemplos: 10 pedidos mas recientes (por orderNumber)');
  const recientes = [];
  snapAll.forEach(d => {
    const data = d.data() || {};
    if (!data.closedAt && typeof data.orderNumber === 'number') {
      recientes.push({ id: d.id, data });
    }
  });
  recientes.sort((a, b) => b.data.orderNumber - a.data.orderNumber);
  for (const { id, data } of recientes.slice(0, 10)) {
    const d = data;
    console.log(`\n  ORDEN ${d.orderNumber} id=${id} cliente="${d.clientName}"`);
    console.log(`    stage=${d.stage || '-'} plannerStage=${d.plannerStage || '-'} paidStatus=${d.paidStatus || '-'}`);
    console.log(`    transferidoSAP.docNum=${d.transferidoSAP?.docNum || '-'} .orderDocEntry=${d.transferidoSAP?.orderDocEntry || '-'}`);
    const lineHasInvoice = Array.isArray(d.lines) && d.lines.some(l => (l?.qtyInvoiced || 0) > 0);
    console.log(`    lines.qtyInvoiced > 0: ${lineHasInvoice}`);
    for (const campo of ['createdAt', 'confirmedAt', 'transferredAt', 'invoicedAt', 'cobradoAt']) {
      const v = d[campo];
      let display = String(v || 'null');
      if (v && typeof v === 'object' && typeof v.toDate === 'function') {
        display = `Timestamp(${v.toDate().toISOString()})`;
      } else if (typeof v === 'string') {
        display = `"${v}"`;
      }
      console.log(`    ${campo}: ${typeOf(v)} = ${display.slice(0, 80)}`);
    }
    const bf = d._backfill || {};
    const bfKeys = Object.keys(bf).filter(k => k.startsWith('AD_fechas'));
    if (bfKeys.length > 0) console.log(`    _backfill: ${bfKeys.join(', ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
