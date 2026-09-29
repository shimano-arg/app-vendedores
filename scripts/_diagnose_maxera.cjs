/**
 * _diagnose_maxera.cjs — 2026-09-29
 * Discrepancia reportada: ALBERTO MAXERA orden 204 SAP:2000212 SO:19982
 *   Planner: $1.124.000
 *   SAP: $822.800 (SQ 2000212 Closed → SO 19982)
 * Diff: $301.200 (~37%)
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

function ars(n) { return typeof n === 'number' ? n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }) : String(n); }

// Fix v1083 logic (extraído de index.html)
function plannerTotalV1083(p) {
  const hasSapDoc = p.transferidoSAP && p.transferidoSAP.docNum;
  if (hasSapDoc && Array.isArray(p.lines)) {
    let sum = 0, any = false;
    for (const l of p.lines) {
      if (!l || l.state !== 'confirmed') continue;
      const qty = Number(l.qty) || 0;
      const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
      if (qty > 0 && price > 0) { sum += qty * price; any = true; }
    }
    if (any) return sum;
  }
  if (typeof p.totalAmountArs === 'number') return p.totalAmountArs;
  if (typeof p.netAmountArs === 'number') return p.netAmountArs;
  if (typeof p.subtotalArs === 'number') return p.subtotalArs;
  return null;
}

(async () => {
  const snap = await db.collection('pedidos').where('transferidoSAP.docNum', '==', 2000212).get();
  console.log(`match docNum=2000212 → ${snap.size}`);
  for (const doc of snap.docs) {
    const p = { id: doc.id, ...doc.data() };
    console.log(`\n--- pedido ${p.id} ---`);
    console.log(`cliente:         ${p.clientName}`);
    console.log(`orderNumber:     ${p.orderNumber}`);
    console.log(`stage:           ${p.stage}`);
    console.log(`closedAt:        ${p.closedAt || '(null)'}`);
    console.log(`closedReason:    ${p.closedReason || '(null)'}`);
    console.log(`transferidoSAP:  ${JSON.stringify(p.transferidoSAP)}`);
    console.log(`condicionPago:   ${p.condicionPago}`);
    console.log(`discountPct:     ${p.discountPct ?? '?'}%`);
    console.log(`\nTOTALES persistidos:`);
    console.log(`  totalAmountArs: ${p.totalAmountArs != null ? ars(p.totalAmountArs) : '(no set)'}`);
    console.log(`  netAmountArs:   ${p.netAmountArs != null ? ars(p.netAmountArs) : '(no set)'}`);
    console.log(`  subtotalArs:    ${p.subtotalArs != null ? ars(p.subtotalArs) : '(no set)'}`);
    console.log(`  invoicedAmount: ${p.invoicedAmount != null ? ars(p.invoicedAmount) : '(no set)'}`);
    console.log(`  paidAmount:     ${p.paidAmount != null ? ars(p.paidAmount) : '(no set)'}`);

    console.log(`\n>>> Planner v1083 muestra: ${ars(plannerTotalV1083(p))}`);
    console.log(`>>> SAP screenshot dice:   $ 822.800`);

    const lines = Array.isArray(p.lines) ? p.lines : [];
    console.log(`\nLINES (${lines.length}):`);
    let sumConfirmed = 0, sumBO = 0, sumOther = 0;
    for (const l of lines) {
      const qty = Number(l.qty) || 0;
      const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
      const sub = qty * price;
      const state = l.state || '?';
      console.log(`  code=${(l.code || '?').padEnd(15)} qty=${String(qty).padStart(4)} precio=${ars(price).padStart(12)} state=${state.padEnd(10)} subtotal=${ars(sub)}${l.qtyInvoiced ? ' inv=' + l.qtyInvoiced : ''}${l.qtyOpen != null ? ' open=' + l.qtyOpen : ''}${l.qtyCancelled ? ' cancel=' + l.qtyCancelled : ''}${l.qtyRecycled ? ' recy=' + l.qtyRecycled : ''}`);
      if (state === 'confirmed') sumConfirmed += sub;
      else if (state === 'BO') sumBO += sub;
      else sumOther += sub;
    }
    console.log(`\nSubtotales por state:`);
    console.log(`  confirmed: ${ars(sumConfirmed)}`);
    console.log(`  BO:        ${ars(sumBO)}`);
    console.log(`  other:     ${ars(sumOther)}`);
    console.log(`  total:     ${ars(sumConfirmed + sumBO + sumOther)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
