/**
 * _diagnose_planner_vs_sap_totals.cjs
 *
 * Diagnóstico de la discrepancia Planner vs SAP en columnas Oferta / Pendiente
 * de facturar / Confirmado.
 *
 * Casos conocidos (screenshots 2026-09-29):
 *   - GERARDO VIGNOLA orden 245 SAP:2000245 (Oferta)
 *     Planner: $3.239.640 · SAP neto: $3.168.000 · SAP c/IVA: $3.833.280
 *   - ARMERIA YIYO orden 238 SAP:2000238 SO:20041 (Pendiente de facturar)
 *     Planner: $6.420.000 · SAP neto: $2.328.000
 *
 * Fase 1: leer los 2 pedidos-app de Firestore y descomponer el netAmountArs
 * en (lines[].qty × precio × state) para entender por qué el Planner difiere.
 * Fase 2: escalar a TODOS los pedidos visibles en Oferta+Pendiente+Confirmado
 * de Septiembre 2026 para medir si el patrón es sistemático.
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(
  os.homedir(),
  'Downloads',
  'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
);
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

function ars(n) {
  if (typeof n !== 'number') return String(n);
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

// PRE-v1083 (comportamiento actual del planner productivo)
function _plannerComputeTotalLegacy(p) {
  if (typeof p.totalAmountArs === 'number') return { total: p.totalAmountArs, field: 'totalAmountArs' };
  if (typeof p.netAmountArs === 'number') return { total: p.netAmountArs, field: 'netAmountArs' };
  if (typeof p.subtotalArs === 'number') return { total: p.subtotalArs, field: 'subtotalArs' };
  if (typeof p.total === 'number') return { total: p.total, field: 'total' };
  if (typeof p.totalARS === 'number') return { total: p.totalARS, field: 'totalARS' };
  const lines = Array.isArray(p.lines) ? p.lines : (Array.isArray(p.items) ? p.items : []);
  let sum = 0, any = false;
  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
    if (qty > 0 && price > 0) { sum += qty * price; any = true; }
  }
  return any ? { total: sum, field: 'fallback(lines)' } : { total: null, field: null };
}

// v1083 (fix): pedidos con transferidoSAP.docNum computan desde lines.state=='confirmed'
function _plannerComputeTotal(p) {
  const hasSapDoc = p.transferidoSAP && p.transferidoSAP.docNum;
  if (hasSapDoc && Array.isArray(p.lines)) {
    let sum = 0, any = false;
    for (const l of p.lines) {
      if (!l || l.state !== 'confirmed') continue;
      const qty = Number(l.qty) || 0;
      const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
      if (qty > 0 && price > 0) { sum += qty * price; any = true; }
    }
    if (any) return { total: sum, field: 'confirmed_lines(v1083)' };
  }
  return _plannerComputeTotalLegacy(p);
}

async function findPedidoByOrderNumber(orderNumber) {
  const snap = await db.collection('pedidos').where('orderNumber', '==', orderNumber).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function findPedidoByDocNum(docNum) {
  // transferidoSAP.docNum
  const snap = await db.collection('pedidos').where('transferidoSAP.docNum', '==', String(docNum)).get();
  const asStr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const snapNum = await db.collection('pedidos').where('transferidoSAP.docNum', '==', Number(docNum)).get();
  const asNum = snapNum.docs.map(d => ({ id: d.id, ...d.data() }));
  return [...asStr, ...asNum];
}

function decomposeLines(pedido) {
  const lines = Array.isArray(pedido.lines) ? pedido.lines : [];
  const byState = {};
  let totalBruto = 0;
  let totalQty = 0;
  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
    const state = l.state || 'unknown';
    byState[state] = byState[state] || { qty: 0, subtotal: 0, count: 0 };
    byState[state].qty += qty;
    byState[state].subtotal += qty * price;
    byState[state].count += 1;
    totalBruto += qty * price;
    totalQty += qty;
  }
  return { byState, totalBruto, totalQty, lineCount: lines.length };
}

async function inspectCase(label, opts) {
  console.log('\n' + '='.repeat(80));
  console.log(`CASO: ${label}`);
  console.log('='.repeat(80));

  let docs = [];
  if (opts.orderNumber != null) {
    docs = await findPedidoByOrderNumber(opts.orderNumber);
    console.log(`Búsqueda: orderNumber=${opts.orderNumber} → ${docs.length} match(es)`);
  }
  if (docs.length === 0 && opts.docNum) {
    docs = await findPedidoByDocNum(opts.docNum);
    console.log(`Búsqueda fallback: transferidoSAP.docNum=${opts.docNum} → ${docs.length} match(es)`);
  }
  if (docs.length === 0) {
    console.log(`❌ No encontrado en pedidos/. Intentar en revision_waitlist...`);
    if (opts.orderNumber != null) {
      const wl = await db.collection('revision_waitlist').where('orderNumber', '==', opts.orderNumber).get();
      console.log(`revision_waitlist orderNumber=${opts.orderNumber} → ${wl.size} match(es)`);
      if (wl.size > 0) {
        docs = wl.docs.map(d => ({ id: d.id, ...d.data(), _isWaitlist: true }));
      }
    }
  }
  if (docs.length === 0) {
    console.log('❌ Sin datos. Skip.');
    return;
  }

  for (const p of docs) {
    console.log(`\n--- pedido id=${p.id}${p._isWaitlist ? ' (WAITLIST)' : ''} ---`);
    console.log(`clientName:       ${p.clientName || p.cardName || '?'}`);
    console.log(`ownerVendor:      ${p.ownerVendor || p.vendorKey || '?'}`);
    console.log(`stage:            ${p.stage || '?'}`);
    console.log(`orderNumber:      ${p.orderNumber ?? '(null)'}`);
    console.log(`transferidoSAP:   ${JSON.stringify(p.transferidoSAP || null)}`);
    console.log(`sapLinkage:       ${JSON.stringify(p.sapLinkage || null)}`);
    console.log(`condicionPago:    ${p.condicionPago || '?'}`);
    console.log(`discountPct:      ${p.discountPct ?? '?'}%`);

    console.log(`\nTOTALES persistidos en el pedido:`);
    console.log(`  totalAmountArs: ${p.totalAmountArs != null ? ars(p.totalAmountArs) : '(no set)'}`);
    console.log(`  netAmountArs:   ${p.netAmountArs != null ? ars(p.netAmountArs) : '(no set)'}`);
    console.log(`  subtotalArs:    ${p.subtotalArs != null ? ars(p.subtotalArs) : '(no set)'}`);
    console.log(`  invoicedAmount: ${p.invoicedAmount != null ? ars(p.invoicedAmount) : '(no set)'}`);
    console.log(`  paidAmount:     ${p.paidAmount != null ? ars(p.paidAmount) : '(no set)'}`);

    const legacy = _plannerComputeTotalLegacy(p);
    const nueva = _plannerComputeTotal(p);
    console.log(`\n>>> Planner PRE-v1083:  ${ars(legacy.total)}  (source: ${legacy.field})`);
    console.log(`>>> Planner POST-v1083: ${ars(nueva.total)}  (source: ${nueva.field})`);
    const total = nueva.total;
    const field = nueva.field;

    const dec = decomposeLines(p);
    console.log(`\nLINES (${dec.lineCount} total, qty total ${dec.totalQty}, subtotal bruto ${ars(dec.totalBruto)}):`);
    for (const [state, agg] of Object.entries(dec.byState)) {
      console.log(`  state=${state.padEnd(10)}  count=${String(agg.count).padStart(3)}  qty=${String(agg.qty).padStart(5)}  subtotal=${ars(agg.subtotal)}`);
    }

    if (opts.expectSap != null) {
      const planner = total || 0;
      const sap = opts.expectSap;
      const diff = planner - sap;
      const pct = sap > 0 ? (diff / sap) * 100 : 0;
      console.log(`\nCOMPARACIÓN vs SAP (screenshot):`);
      console.log(`  Planner:  ${ars(planner)}`);
      console.log(`  SAP neto: ${ars(sap)}`);
      console.log(`  Diff:     ${ars(diff)}  (${pct.toFixed(1)}%)`);
    }
  }
}

async function scanSeptember() {
  console.log('\n' + '='.repeat(80));
  console.log('FASE 2: escaneo Septiembre 2026 — pedidos con transferidoSAP.docNum + sin invoicedAmount');
  console.log('(estos son los que caen en Oferta / Pendiente de facturar / Confirmado)');
  console.log('='.repeat(80));

  const start = new Date('2026-09-01T00:00:00Z');
  const end = new Date('2026-10-01T00:00:00Z');
  const snap = await db.collection('pedidos')
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .get();

  console.log(`Total pedidos septiembre: ${snap.size}`);

  const withSap = [];
  for (const doc of snap.docs) {
    const p = { id: doc.id, ...doc.data() };
    const docNum = p.transferidoSAP && p.transferidoSAP.docNum;
    if (!docNum) continue;
    withSap.push(p);
  }
  console.log(`Con transferidoSAP.docNum: ${withSap.length}`);

  // Buckets aproximados por invoicedAmount (proxy de Facturado)
  const oferta = withSap.filter(p => !p.invoicedAmount && (p.transferidoSAP?.tipo === 'QUOTATION' || p.transferidoSAP?.docType === 23));
  const pending = withSap.filter(p => !p.invoicedAmount && !oferta.includes(p));
  const invoiced = withSap.filter(p => p.invoicedAmount);

  console.log(`  Oferta (SQ, sin invoice): ${oferta.length}`);
  console.log(`  Pending (SO, sin invoice): ${pending.length}`);
  console.log(`  Facturado (con invoice): ${invoiced.length}`);

  console.log('\nImpacto agregado del fix v1083 sobre Pending sin invoice:');
  let sumLegacy = 0, sumNueva = 0, sumDiff = 0;
  let cntAfectados = 0;
  const cambios = [];
  for (const p of pending) {
    const legacy = _plannerComputeTotalLegacy(p).total || 0;
    const nueva = _plannerComputeTotal(p).total || 0;
    sumLegacy += legacy;
    sumNueva += nueva;
    if (Math.abs(legacy - nueva) > 1) {
      cntAfectados += 1;
      cambios.push({
        ord: p.orderNumber,
        docNum: p.transferidoSAP?.docNum,
        cli: p.clientName,
        legacy, nueva, diff: legacy - nueva,
      });
    }
  }
  cambios.sort((a, b) => b.diff - a.diff);
  console.log(`  Total pedidos Pending analizados: ${pending.length}`);
  console.log(`  Pedidos con cambio de total:      ${cntAfectados} (${(100*cntAfectados/pending.length).toFixed(0)}%)`);
  console.log(`  Suma total PRE-v1083 (Pending):   ${ars(sumLegacy)}`);
  console.log(`  Suma total POST-v1083 (Pending):  ${ars(sumNueva)}`);
  console.log(`  Reducción del subtotal columna:   ${ars(sumLegacy - sumNueva)} (${(100*(sumLegacy-sumNueva)/sumLegacy).toFixed(1)}%)`);
  console.log('\n  Top 10 pedidos con mayor cambio:');
  for (const c of cambios.slice(0, 10)) {
    console.log(`    ord=${String(c.ord || '-').padEnd(4)} docNum=${String(c.docNum || '-').padEnd(8)} cli="${(c.cli || '?').slice(0,28).padEnd(28)}" pre=${ars(c.legacy).padStart(14)} post=${ars(c.nueva).padStart(14)} baja=${ars(c.diff).padStart(14)}`);
  }
}

(async () => {
  try {
    await inspectCase('GERARDO ADRIAN VIGNOLA — Orden 245 · SAP:2000245 (Oferta)', {
      orderNumber: 245,
      docNum: 2000245,
      expectSap: 3168000, // Total Before Discount SAP screenshot
    });

    await inspectCase('ARMERIA YIYO S.R.L. — Orden 238 · SAP:2000238 · SO:20041 (Pendiente)', {
      orderNumber: 238,
      docNum: 2000238,
      expectSap: 2328000, // Total Before Discount SAP screenshot
    });

    await scanSeptember();
  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
  process.exit(0);
})();
