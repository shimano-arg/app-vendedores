/**
 * cleanup-orden-178-duplicates.js
 *
 * v953 backfill: caso reportado por Mariano 2026-09-16 — CRISTIAN JOSE SANTORO
 * ORDEN 178 quedo con 1 doc en revision_waitlist + 3 docs duplicados en pedidos
 * (DocNums SAP 2000183, 2000184, 2000185). Este script inspecciona el estado
 * y, si se le pasa --commit, borra los duplicados dejando el mejor pedido.
 *
 * Uso:
 *   node scripts/cleanup-orden-178-duplicates.js           # dry-run (default)
 *   node scripts/cleanup-orden-178-duplicates.js --commit  # aplica cambios
 *
 * Requiere:
 *   ~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json
 *
 * NO toca SAP — las 2 SQs sobrantes las cierra Santi manualmente.
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
const TARGET_ORDER = '178';
const COMMIT = process.argv.includes('--commit');

admin.initializeApp({
  credential: admin.credential.cert(require(SA_KEY)),
});
const db = admin.firestore();

function fmtTimestamp(ts) {
  if (!ts) return '(sin fecha)';
  try {
    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    return d.toISOString();
  } catch (_e) {
    return String(ts);
  }
}

function scoreCompleteness(pedido) {
  // Puntaje simple: lineas + unidades totales + presencia de transferidoSAP.
  const lines = Array.isArray(pedido.lines) ? pedido.lines : [];
  const totalUnits = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const hasSap = pedido.transferidoSAP && pedido.transferidoSAP.docNum ? 1 : 0;
  return {
    lineCount: lines.length,
    totalUnits,
    hasSap,
    // Puntaje compuesto: prioriza tener SAP > mas unidades > mas lineas.
    score: hasSap * 100000 + totalUnits * 10 + lines.length,
  };
}

async function main() {
  console.log(`\n===== v953 backfill: ORDEN ${TARGET_ORDER} duplicados =====`);
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT (borra docs)' : '🟢 DRY RUN (solo muestra)'}`);
  console.log(`Proyecto: ${admin.app().options.credential.projectId || 'app-vendedores-shimano'}\n`);

  // 1) revision_waitlist con orderNumber == '178'
  console.log('=== 1) revision_waitlist ===');
  const wlSnap = await db.collection('revision_waitlist')
    .where('orderNumber', '==', TARGET_ORDER)
    .get();
  console.log(`Encontrados: ${wlSnap.size} doc(s)`);
  const waitlistDocs = [];
  wlSnap.forEach(d => {
    const data = d.data() || {};
    waitlistDocs.push({ id: d.id, data });
    console.log(`  - ${d.id}`);
    console.log(`      clientName: ${data.clientName}`);
    console.log(`      stage:      ${data.stage || '(sin stage)'}`);
    console.log(`      createdAt:  ${fmtTimestamp(data.createdAt)}`);
    console.log(`      ownerUid:   ${data.ownerUid}`);
    console.log(`      items:      ${Array.isArray(data.items) ? data.items.length : 0}`);
  });

  // 2) pedidos con orderNumber == '178'
  console.log('\n=== 2) pedidos ===');
  const pdSnap = await db.collection('pedidos')
    .where('orderNumber', '==', TARGET_ORDER)
    .get();
  console.log(`Encontrados: ${pdSnap.size} doc(s)`);
  const pedidosDocs = [];
  pdSnap.forEach(d => {
    const data = d.data() || {};
    const s = scoreCompleteness(data);
    pedidosDocs.push({ id: d.id, data, score: s });
    console.log(`  - ${d.id}`);
    console.log(`      clientName:        ${data.clientName}`);
    console.log(`      stage:             ${data.stage}`);
    console.log(`      confirmedAt:       ${fmtTimestamp(data.confirmedAt)}`);
    console.log(`      lines:             ${s.lineCount}`);
    console.log(`      totalUnits:        ${s.totalUnits}`);
    console.log(`      transferidoSAP:    ${data.transferidoSAP && data.transferidoSAP.docNum || '(no SAP)'}`);
    console.log(`      netAmountArs:      ${data.netAmountArs || 0}`);
    console.log(`      score:             ${s.score}`);
  });

  // Decidir cual pedido dejar (el de mayor score) y cuales borrar.
  if (pedidosDocs.length > 1) {
    // Decision de Mariano 2026-09-16: mantener DocNum SAP 2000183 (el primero
    // por cronologia — doc id ob4L6huc0uaytekgcMFs). Los otros 2 SAP DocNums
    // (2000184, 2000185) los cierra Santi manual del lado SAP.
    const KEEP_DOC_ID = 'ob4L6huc0uaytekgcMFs';
    const keep = pedidosDocs.find(p => p.id === KEEP_DOC_ID);
    if (!keep) {
      console.error(`ERROR: no encontre el pedido a mantener con id=${KEEP_DOC_ID}. Abortando por seguridad.`);
      process.exit(1);
    }
    const toDelete = pedidosDocs.filter(p => p.id !== KEEP_DOC_ID);
    console.log(`\n=== 3) Plan de borrado ===`);
    console.log(`🟢 SE MANTIENE: ${keep.id} (score=${keep.score.score}, DocNum SAP=${keep.data.transferidoSAP && keep.data.transferidoSAP.docNum || 'n/a'})`);
    for (const p of toDelete) {
      console.log(`🔴 SE BORRA:   ${p.id} (score=${p.score.score}, DocNum SAP=${p.data.transferidoSAP && p.data.transferidoSAP.docNum || 'n/a'})`);
    }

    if (COMMIT) {
      console.log('\n=== 4) Ejecutando borrado ===');
      for (const p of toDelete) {
        await db.collection('pedidos').doc(p.id).delete();
        console.log(`  ✓ pedidos/${p.id} borrado`);
      }
    } else {
      console.log('\nDRY-RUN: no se borro nada. Corre con --commit para aplicar.');
    }
  } else {
    console.log('\n=== 3) Plan de borrado ===');
    console.log('Menos de 2 pedidos con ese orderNumber — no hay duplicados que borrar.');
  }

  // Borrar TODOS los waitlist docs con orderNumber 178 (deberian estar ya
  // marcados consumed pero el bug de rules previa los dejo vivos).
  if (waitlistDocs.length > 0) {
    console.log(`\n=== 5) Borrar waitlist docs zombie ===`);
    for (const w of waitlistDocs) {
      console.log(`🔴 SE BORRA: revision_waitlist/${w.id} (stage='${w.data.stage || 'sin-stage'}')`);
    }
    if (COMMIT) {
      for (const w of waitlistDocs) {
        await db.collection('revision_waitlist').doc(w.id).delete();
        console.log(`  ✓ revision_waitlist/${w.id} borrado`);
      }
    }
  }

  console.log('\n===== FIN =====');
  console.log('Recordatorio: cerrar 2 SQs en SAP con Santi (DocNums 2000184 y 2000185, dejar 2000183).');
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('ERROR:', e);
    process.exit(1);
  });
