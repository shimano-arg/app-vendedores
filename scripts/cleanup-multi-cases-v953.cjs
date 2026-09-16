/**
 * cleanup-multi-cases-v953.cjs
 *
 * v953 backfill multi-caso. Limpia:
 *   1. ORDEN 143 FERNANDO LUIS — 3 duplicados (2000161/2000176/2000177) → 1
 *   2. ORDEN 143 LOS MARINEROS — colision con FERNANDO LUIS → reasignar
 *   3. ORDEN 146 GRAN PARANA vs BERNAL GUSTAVO — colision → reasignar
 *   4. Waitlist zombies ORDEN 159/143/168/169 → borrar
 *
 * Uso:
 *   node scripts/cleanup-multi-cases-v953.cjs           # dry-run
 *   node scripts/cleanup-multi-cases-v953.cjs --commit  # aplica
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
const COMMIT = process.argv.includes('--commit');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

// Plan editable — Mariano confirma antes de correr con --commit.
const PLAN = {
  // Pedidos a borrar (Type 1: v953 duplicates)
  pedidosToDelete: [
    // ORDEN 143 FERNANDO LUIS — mantener SOLO 2000161 (el mas viejo, del 14/09)
    // Borrar 2000176 y 2000177 (los 2 ultimos del 16/09, duplicados por bug v953)
    { id: 'OqjQ7dYXf30oUXCV8WMG', why: 'ORDEN 143 dup — SAP 2000177 (16/09 12:38)' },
    { id: 'PCfkTVc2c0DAjHGNZOWU', why: 'ORDEN 143 dup — SAP 2000176 (16/09 12:37)' },
  ],
  // Pedidos a reasignar orderNumber (Type 2: colisiones pre-v913)
  // Los 2 son pedidos legitimos, solo colisionaron por bug del counter.
  // Reasignamos el MAS RECIENTE porque el mas viejo probablemente ya fue
  // comunicado/comentado como "ORDEN N" a Santi o el cliente.
  pedidosToReassign: [
    // ORDEN 143 LOS MARINEROS (10/09) vs FERNANDO LUIS (14/09) — reasignar FERNANDO LUIS 2000161 (mas nuevo)
    // No, esperá: FERNANDO LUIS 2000161 es del 14/09, LOS MARINEROS 2000147 es del 10/09
    // → LOS MARINEROS es el mas viejo (10/09), mantiene 143. FERNANDO LUIS reasigna.
    { id: 'fMbjJtmfe3A1ipBgCnTA', currentON: '143', why: 'ORDEN 143 colision LOS MARINEROS vs FERNANDO LUIS 2000161' },
    // ORDEN 146 GRAN PARANA (11/09 sin SAP) vs BERNAL GUSTAVO (15/09, 2000168)
    // → GRAN PARANA es el mas viejo (11/09) mantiene 146. BERNAL GUSTAVO reasigna.
    { id: 'r6cjHTvgLhOpwp5JPIax', currentON: '146', why: 'ORDEN 146 colision GRAN PARANA vs BERNAL GUSTAVO 2000168' },
  ],
  // Waitlist zombies (Type 3: docs alive sin corresponder a nada)
  waitlistToDelete: [
    { id: '0Ku6rvTDbdD4udPn2NAd', orderNumber: '159', client: 'LA LOMITA OUTDOORS SRL' },
    { id: 'PUivvfFYZHgQtyqoLeF9', orderNumber: '143', client: 'FERNANDO LUIS HORACIO DEL INTENTO' },
    { id: 'nWTcWaSUoWAr9iNYfubM', orderNumber: '168', client: 'IGNACIO ANGEL BUZZO' },
    { id: 'uO25D20L0x1pLp4s9ZDN', orderNumber: '169', client: 'LUCAS EZEQUIEL FRANCA' },
  ],
};

async function reserveNextOrderNumber() {
  // Mismo pattern que index.html:14912 pero desde admin SDK.
  const ref = db.collection('counters').doc('orderNumber');
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const fromCounter = snap.exists && Number.isFinite(snap.data().value)
      ? snap.data().value : 0;
    const next = fromCounter + 1;
    t.set(ref, {
      value: next,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return String(next);
  });
}

async function main() {
  console.log(`===== v953 CLEANUP MULTI-CASE =====`);
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  // 1) Pedidos a borrar
  console.log('=== 1) Pedidos a BORRAR ===');
  for (const p of PLAN.pedidosToDelete) {
    const doc = await db.collection('pedidos').doc(p.id).get();
    if (!doc.exists) {
      console.log(`   ⚠️  ${p.id} — NO EXISTE`);
      continue;
    }
    const d = doc.data();
    console.log(`   ${p.id}`);
    console.log(`      client:      ${d.clientName}`);
    console.log(`      orderNumber: ${d.orderNumber}`);
    console.log(`      SAP DocNum:  ${d.transferidoSAP && d.transferidoSAP.docNum}`);
    console.log(`      confirmedAt: ${d.confirmedAt}`);
    console.log(`      motivo:      ${p.why}`);
    if (COMMIT) {
      await db.collection('pedidos').doc(p.id).delete();
      console.log(`      ✓ BORRADO`);
    }
  }

  // 2) Pedidos a reasignar orderNumber
  console.log('\n=== 2) Pedidos a REASIGNAR orderNumber (por colision) ===');
  for (const p of PLAN.pedidosToReassign) {
    const doc = await db.collection('pedidos').doc(p.id).get();
    if (!doc.exists) {
      console.log(`   ⚠️  ${p.id} — NO EXISTE`);
      continue;
    }
    const d = doc.data();
    console.log(`   ${p.id}`);
    console.log(`      client:      ${d.clientName}`);
    console.log(`      orderNumber actual: ${d.orderNumber}`);
    console.log(`      SAP DocNum:  ${d.transferidoSAP && d.transferidoSAP.docNum}`);
    console.log(`      confirmedAt: ${d.confirmedAt}`);
    console.log(`      motivo:      ${p.why}`);
    if (COMMIT) {
      const newON = await reserveNextOrderNumber();
      await db.collection('pedidos').doc(p.id).update({
        orderNumber: newON,
        orderNumberPrev: d.orderNumber,
        orderNumberReassignedAt: admin.firestore.FieldValue.serverTimestamp(),
        orderNumberReassignedReason: p.why,
      });
      console.log(`      ✓ REASIGNADO — nuevo ORDEN ${newON} (previo ${d.orderNumber})`);
    } else {
      console.log(`      (dry) reasignaria a nuevo orderNumber via counters/orderNumber`);
    }
  }

  // 3) Waitlist zombies
  console.log('\n=== 3) Waitlist zombies a BORRAR ===');
  for (const w of PLAN.waitlistToDelete) {
    const doc = await db.collection('revision_waitlist').doc(w.id).get();
    if (!doc.exists) {
      console.log(`   ⚠️  ${w.id} — NO EXISTE`);
      continue;
    }
    const d = doc.data();
    console.log(`   ${w.id}`);
    console.log(`      client:      ${d.clientName}`);
    console.log(`      orderNumber: ${d.orderNumber}`);
    console.log(`      stage:       ${d.stage || '(sin stage)'}`);
    if (COMMIT) {
      await db.collection('revision_waitlist').doc(w.id).delete();
      console.log(`      ✓ BORRADO`);
    }
  }

  console.log('\n===== FIN =====');
  if (COMMIT) {
    console.log('✅ Aplicado. Coordinar con Santi para cerrar SQs en SAP:');
    console.log('   - Cerrar SAP DocNum 2000176 (ORDEN 143 duplicado)');
    console.log('   - Cerrar SAP DocNum 2000177 (ORDEN 143 duplicado)');
    console.log('   - Mantener SAP DocNums 2000147, 2000161, 2000168 (los legitimos)');
  } else {
    console.log('DRY-RUN. Corre con --commit para aplicar.');
  }
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
