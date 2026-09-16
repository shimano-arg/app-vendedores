/**
 * backfill-asigreserva-v957.cjs
 *
 * FASE 4 del feature tier-based FIFO (v956/v957/v958).
 * Walkea todos los pedidos abiertos (closedAt=null), busca lineas con
 * state='ASIG' + qtyOpen>0 que NO tengan el field `asigReserva`, y les
 * setea:
 *   - asigReserva: true si el cliente actual es P/A, false si es B/C
 *   - asigCliTipo: el tier resuelto
 *
 * cliTipo se lee de client_master/{clientLocId(prov, loc, name)}. Si no
 * existe, default 'C' (mismo comportamiento que la CF FIFO v956).
 *
 * Uso:
 *   node scripts/backfill-asigreserva-v957.cjs           # dry-run
 *   node scripts/backfill-asigreserva-v957.cjs --commit  # aplica
 *
 * Requiere ~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
const COMMIT = process.argv.includes('--commit');

admin.initializeApp({
  credential: admin.credential.cert(require(SA_KEY)),
});
const db = admin.firestore();

// Mismo algoritmo que fifo-assign-core.js:computeClientLocId (portado de
// app.bundle.js:7919). Sin esto no matcheamos con client_master.
function computeClientLocId(prov, locName, tienda) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  return norm(prov) + '__' + norm(locName) + '__' + norm(tienda);
}

function normalizeCliTipo(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'P' || s === 'A' || s === 'B' || s === 'C') return s;
  return 'C';
}

async function fetchCliTipoCached(docId, cache) {
  if (cache.has(docId)) return cache.get(docId);
  let tipo = 'C';
  try {
    const snap = await db.collection('client_master').doc(docId).get();
    if (snap.exists) {
      const d = snap.data() || {};
      tipo = normalizeCliTipo(d.cliTipo);
    }
  } catch (_e) {
    tipo = 'C';
  }
  cache.set(docId, tipo);
  return tipo;
}

async function main() {
  console.log('===== v957 FASE 4: backfill asigReserva en pedidos ASIG =====');
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  // Cargar TODOS los pedidos abiertos (no cerrados). Con volumen actual
  // (~500-1000 pedidos abiertos) es viable en 1 query.
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log(`Pedidos abiertos: ${pedidosSnap.size}\n`);

  const cliTipoCache = new Map();
  const updates = []; // { pedidoId, newLines, summary }
  let scannedLines = 0;
  let candidateLines = 0;
  let alreadyLabeledLines = 0;
  const tierCount = { P: 0, A: 0, B: 0, C: 0 };

  for (const doc of pedidosSnap.docs) {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    let hasChanges = false;
    const newLines = [];
    for (const l of lines) {
      scannedLines++;
      // Solo tocar ASIG con qtyOpen>0 sin field asigReserva.
      if (!l || l.state !== 'ASIG') {
        newLines.push(l);
        continue;
      }
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) {
        newLines.push(l);
        continue;
      }
      // Si ya tiene field, no tocar (respeta lo que la CF v956 seteo).
      if (Object.prototype.hasOwnProperty.call(l, 'asigReserva')) {
        alreadyLabeledLines++;
        newLines.push(l);
        continue;
      }
      candidateLines++;
      const prov = String(data.province || data.clientProvince || '').trim();
      const loc = String(data.locName || data.clientLocality || '').trim();
      const cli = String(data.clientName || '').trim();
      const docId = computeClientLocId(prov, loc, cli);
      const tipo = await fetchCliTipoCached(docId, cliTipoCache);
      const reserva = tipo === 'P' || tipo === 'A';
      tierCount[tipo]++;
      newLines.push({
        ...l,
        asigReserva: reserva,
        asigCliTipo: tipo,
        asigReservaBackfilledAt: new Date().toISOString(),
      });
      hasChanges = true;
    }
    if (hasChanges) {
      updates.push({
        pedidoId: doc.id,
        clientName: data.clientName || '(sin cliente)',
        newLines,
        summary: newLines
          .filter((l) => l && l.state === 'ASIG' && l.asigReservaBackfilledAt)
          .map((l) => `${l.code}[${l.asigCliTipo}=${l.asigReserva ? 'CON' : 'SIN'}]`)
          .join(', '),
      });
    }
  }

  console.log(`Lineas escaneadas:              ${scannedLines}`);
  console.log(`  ASIG ya labeled (skip):       ${alreadyLabeledLines}`);
  console.log(`  ASIG candidatas a backfill:   ${candidateLines}`);
  console.log(`\nDistribucion por tier:`);
  console.log(`  P (con reserva):              ${tierCount.P}`);
  console.log(`  A (con reserva):              ${tierCount.A}`);
  console.log(`  B (SIN reserva):              ${tierCount.B}`);
  console.log(`  C (SIN reserva):              ${tierCount.C}`);
  console.log(`\nPedidos a actualizar:          ${updates.length}`);

  // Mostrar sample
  console.log('\nSample (primeros 5):');
  for (const u of updates.slice(0, 5)) {
    console.log(`  ${u.pedidoId} ${u.clientName}: ${u.summary}`);
  }

  if (!updates.length) {
    console.log('\n✅ Nada que backfillear. Sistema limpio.');
    process.exit(0);
  }

  if (COMMIT) {
    console.log('\n=== Aplicando en batches ===');
    // Firestore batch max 500 writes. Con updates.length hasta ~1000
    // partimos en batches de 400 para dejar margen.
    const BATCH_SIZE = 400;
    let written = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const slice = updates.slice(i, i + BATCH_SIZE);
      for (const u of slice) {
        batch.update(db.collection('pedidos').doc(u.pedidoId), {
          lines: u.newLines,
          asigReservaBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      written += slice.length;
      console.log(`  Batch ${i / BATCH_SIZE + 1}: ${slice.length} pedidos actualizados. Total: ${written}/${updates.length}`);
    }
    console.log(`\n✅ ${written} pedidos backfilleados.`);
  } else {
    console.log('\nDRY-RUN. Corre con --commit para aplicar.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
