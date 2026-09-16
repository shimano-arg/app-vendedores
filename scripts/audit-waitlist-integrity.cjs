/**
 * audit-waitlist-integrity.cjs
 *
 * Chequea invariantes del sistema waitlist/pedidos post-v953:
 *   1. NO deberia haber 2+ pedidos con el mismo orderNumber (dedupe).
 *   2. NO deberia haber revision_waitlist docs con orderNumber que YA
 *      exista como pedido confirmed (waitlist zombie).
 *   3. NO deberia haber revision_waitlist docs con stage='consumed' vivos
 *      >1h (delete deberia haberse ejecutado).
 *
 * Uso:
 *   node scripts/audit-waitlist-integrity.cjs
 *
 * Requiere ~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  console.log('===== AUDIT waitlist/pedidos integrity =====\n');
  const alerts = [];

  // 1) Duplicados de orderNumber en pedidos.
  console.log('1) Buscando pedidos con orderNumber duplicado...');
  const allPedidos = await db.collection('pedidos').get();
  const byOrderNumber = {};
  allPedidos.forEach(d => {
    const data = d.data() || {};
    const on = data.orderNumber;
    if (on === null || on === undefined || on === '') return;
    const key = String(on);
    if (!byOrderNumber[key]) byOrderNumber[key] = [];
    byOrderNumber[key].push({ id: d.id, ...data });
  });
  const dupes = Object.entries(byOrderNumber).filter(([_, arr]) => arr.length > 1);
  console.log(`   Total pedidos con orderNumber: ${Object.keys(byOrderNumber).length}`);
  console.log(`   Duplicados: ${dupes.length}`);
  if (dupes.length > 0) {
    dupes.forEach(([on, arr]) => {
      console.log(`   ⚠️  ORDEN ${on}: ${arr.length} pedidos`);
      arr.forEach(p => {
        const sap = p.transferidoSAP && p.transferidoSAP.docNum || '(no SAP)';
        console.log(`      - id=${p.id} client=${p.clientName} stage=${p.stage} SAP=${sap} confirmedAt=${p.confirmedAt}`);
      });
      alerts.push(`ORDEN ${on}: ${arr.length} pedidos duplicados`);
    });
  } else {
    console.log('   ✅ OK — no hay duplicados');
  }

  // 2) Waitlist zombie: waitlist docs con orderNumber que YA esta como pedido confirmed.
  console.log('\n2) Buscando waitlist zombie (orderNumber ya en pedidos)...');
  const wlSnap = await db.collection('revision_waitlist').get();
  const zombies = [];
  wlSnap.forEach(d => {
    const data = d.data() || {};
    const on = data.orderNumber;
    if (on && byOrderNumber[String(on)]) {
      zombies.push({ id: d.id, orderNumber: on, clientName: data.clientName, stage: data.stage });
    }
  });
  console.log(`   Total waitlist docs: ${wlSnap.size}`);
  console.log(`   Zombie: ${zombies.length}`);
  if (zombies.length > 0) {
    zombies.forEach(z => {
      console.log(`   ⚠️  ${z.id} — ORDEN ${z.orderNumber} ${z.clientName} stage='${z.stage || 'sin-stage'}'`);
      alerts.push(`Waitlist zombie ORDEN ${z.orderNumber} (${z.clientName})`);
    });
  } else {
    console.log('   ✅ OK — no hay zombies');
  }

  // 3) Waitlist docs marcados como 'consumed' vivos hace >1h.
  console.log('\n3) Buscando waitlist docs stage=consumed vivos >1h...');
  const consumed = [];
  const oneHrAgoMs = Date.now() - 60 * 60 * 1000;
  wlSnap.forEach(d => {
    const data = d.data() || {};
    if (data.stage === 'consumed') {
      const consumedAtMs = data.consumedAt && typeof data.consumedAt.toDate === 'function'
        ? data.consumedAt.toDate().getTime()
        : 0;
      const ageMin = consumedAtMs ? Math.round((Date.now() - consumedAtMs) / 60000) : null;
      if (!consumedAtMs || consumedAtMs < oneHrAgoMs) {
        consumed.push({ id: d.id, ageMin, ...data });
      }
    }
  });
  console.log(`   Consumed viejos: ${consumed.length}`);
  if (consumed.length > 0) {
    consumed.forEach(c => {
      console.log(`   ⚠️  ${c.id} — ORDEN ${c.orderNumber} age=${c.ageMin}min`);
      alerts.push(`Waitlist consumed no borrado (${c.id})`);
    });
  } else {
    console.log('   ✅ OK — ningun consumed vivo');
  }

  console.log('\n===== RESUMEN =====');
  if (alerts.length === 0) {
    console.log('✅ Sistema OK — todos los invariantes se cumplen');
    process.exit(0);
  } else {
    console.log(`⚠️  ${alerts.length} alertas:`);
    alerts.forEach(a => console.log(`   - ${a}`));
    process.exit(2);
  }
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
