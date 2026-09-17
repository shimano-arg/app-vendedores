/**
 * debug-sku-stock-libre.cjs
 *
 * Investiga por qué un SKU con stock físico muestra "Libre para la venta = 0"
 * en el modal Pedido en Espera. Lista todos los pedidos-app open con líneas
 * de ese SKU, muestra el state + qtyOpen + confirmedAt + asigAt + asigReserva.
 *
 * Uso:
 *   node scripts/debug-sku-stock-libre.cjs CAPGL2401 CAPGL2402
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  const skus = process.argv.slice(2).map((s) => s.toUpperCase());
  if (!skus.length) {
    console.error('Uso: node scripts/debug-sku-stock-libre.cjs SKU1 SKU2 ...');
    process.exit(1);
  }

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log(`Total pedidos abiertos: ${pedidosSnap.size}\n`);

  for (const sku of skus) {
    console.log('='.repeat(80));
    console.log(`SKU: ${sku}`);
    console.log('='.repeat(80));
    const byState = { confirmed: 0, BO: 0, ASIG: 0, other: 0 };
    const rows = [];
    pedidosSnap.forEach((doc) => {
      const data = doc.data() || {};
      const lines = Array.isArray(data.lines) ? data.lines : [];
      for (const l of lines) {
        if (!l || !l.code) continue;
        if (String(l.code).toUpperCase() !== sku) continue;
        const qtyOpen = Number(l.qtyOpen) || 0;
        if (qtyOpen <= 0) continue;
        const state = l.state || '(sin state)';
        if (state === 'confirmed' || state === 'BO' || state === 'ASIG') {
          byState[state] += qtyOpen;
        } else {
          byState.other += qtyOpen;
        }
        rows.push({
          pedidoId: doc.id,
          clientName: data.clientName || '(sin cliente)',
          orderNumber: data.orderNumber || null,
          state,
          qtyOpen,
          asigReserva: l.asigReserva,
          asigCliTipo: l.asigCliTipo,
          asigAt: l.asigAt,
          createdAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString().slice(0, 10) : String(data.createdAt).slice(0, 10)) : '?',
          confirmedAt: data.confirmedAt ? String(data.confirmedAt).slice(0, 10) : null,
        });
      }
    });

    console.log(`\nBreakdown por state:`);
    console.log(`  confirmed: ${byState.confirmed} u`);
    console.log(`  BO:        ${byState.BO} u`);
    console.log(`  ASIG:      ${byState.ASIG} u`);
    if (byState.other > 0) console.log(`  otro:      ${byState.other} u`);
    console.log(`  TOTAL comprometido: ${byState.confirmed + byState.BO + byState.ASIG + byState.other} u`);

    console.log(`\nDetalle por línea (${rows.length}):`);
    rows.forEach((r) => {
      const reservaLbl = r.state === 'ASIG'
        ? ` reserva=${r.asigReserva} tipo=${r.asigCliTipo || '?'} asigAt=${r.asigAt || 'null'}`
        : '';
      const ordenLbl = r.orderNumber ? ` ORDEN ${r.orderNumber}` : '';
      console.log(`  [${r.state}] ${r.qtyOpen}u · ${r.clientName}${ordenLbl} · creado ${r.createdAt}${reservaLbl}`);
    });
    console.log();
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
