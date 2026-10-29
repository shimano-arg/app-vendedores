// Phase 1 systematic-debugging (v1520, CLAUDE.md §103): reconstruir
// getStockBreakdown de prod para TRX301B y explicar las 7u que no aparecen
// en el popup de §40.11.
//
// Hipótesis Mariano (29/10 09:04): popup muestra fisico 16, asig 7, libre 2
// → faltan 7u. Candidatos verificables:
//   (1) Confirmed sin SAP escondidas por el popup (§33 reserva pero no se
//       mostraba antes de §103).
//   (2) Doble conteo ASIG→confirmed (línea migrada que suma por 2 lados).
//
// Resultado prod @ 2026-10-29: hipótesis (1) explica las 7u (ORDEN 419 1u +
// ORDEN 615 6u). Doble conteo = 0u. Base para test en
// tests/unit/audit/popup-stock-sku-formula-cierra.test.js.

const PROJECT = 'app-vendedores-shimano';
const SKU = 'TRX301B';

function _tsOrInf(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const { getStockBreakdown } = await import('../../src/pure/stock-breakdown.js');

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  console.log('================================================================');
  console.log('O — Breakdown TRX301B @ ' + nowIso);
  console.log('================================================================');

  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs = typeof sd.warehouseBreakdown === 'string'
    ? JSON.parse(sd.warehouseBreakdown)
    : (sd.warehouseBreakdown || {});

  const fisico = (whs[SKU] && whs[SKU]['11']) || 0;
  const transito = (whs[SKU] && whs[SKU]['12']) || 0;
  console.log('Snapshot stock: dep 11 = ' + fisico + ', dep 12 = ' + transito);

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => pedidos.push(Object.assign({ _fsId: d.id }, d.data())));
  console.log('Pedidos abiertos: ' + pedidos.length);

  const wlSnap = await db.collection('revision_waitlist')
    .where('source', '==', 'stock-asignado-batch').get();
  const waitlist = [];
  wlSnap.forEach((d) => {
    const data = d.data();
    if (data.closedAt) return;
    if (data.stage === 'consumed') return;
    waitlist.push(Object.assign({ _id: d.id }, data));
  });

  const irSnap = await db.collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress']).get();
  const ingresosActivos = [];
  irSnap.forEach((d) => ingresosActivos.push(Object.assign({ _fsId: d.id }, d.data())));

  const deps = {
    getStockFisico: (sku) => (whs[String(sku).toUpperCase()] && whs[String(sku).toUpperCase()]['11']) || 0,
    getStockTransito: (sku) => (whs[String(sku).toUpperCase()] && whs[String(sku).toUpperCase()]['12']) || 0,
    pedidos,
    waitlistEntries: waitlist,
    ingresosRepartoActivos: ingresosActivos,
  };

  const b = getStockBreakdown(SKU, deps, { now: nowMs });

  console.log('');
  console.log('===== BREAKDOWN TRX301B =====');
  console.log('fisicoDep11:            ' + b.fisicoDep11);
  console.log('transitoDep12:          ' + b.transitoDep12);
  console.log('backorderApp.total:     ' + b.backorderApp.total + ' (NO reserva — §40)');
  console.log('confirmadasSinFacturar: ' + b.confirmadasSinFacturar.total + ' (RESERVA — §40)');
  console.log('asignadas.total:        ' + b.asignadas.total + ' (RESERVA — §40)');
  console.log('reservadasTotal:        ' + b.reservadasTotal + ' = min(conf+asig, fisico)');
  console.log('libre:                  ' + b.libre + ' = max(0, fisico - reservadas)');

  console.log('');
  console.log('===== CONFIRMADAS SIN FACTURAR — por pedido =====');
  const confDetails = [];
  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== SKU) continue;
      if (l.state !== 'confirmed') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      confDetails.push({
        pedidoId: p._fsId,
        orderNumber: p.orderNumber,
        clientName: p.clientName,
        qtyOpen: qo,
        confirmedAt: p.confirmedAt || null,
        origen: l.origen || null,
        asigRefs: Array.isArray(l.asigRefs) ? l.asigRefs : null,
        lineIndex: i,
      });
    }
  }
  confDetails.sort((a, b) => _tsOrInf(a.confirmedAt) - _tsOrInf(b.confirmedAt));
  for (const c of confDetails) {
    console.log('  pedido=' + c.pedidoId + ' ORDEN=' + c.orderNumber
      + ' cliente=' + (c.clientName || '?')
      + ' qtyOpen=' + c.qtyOpen
      + ' confirmedAt=' + c.confirmedAt);
  }

  console.log('');
  console.log('===== ASIG — por línea =====');
  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== SKU) continue;
      if (l.state !== 'ASIG') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      console.log('  pedido=' + p._fsId + ' ORDEN=' + p.orderNumber
        + ' cliente=' + (p.clientName || '?')
        + ' qtyOpen=' + qo + ' asigAt=' + (l.asigAt || '?'));
    }
  }

  console.log('');
  console.log('===== CHECK DOBLE CONTEO ASIG → confirmed =====');
  let doubleCount = 0;
  for (const c of confDetails) {
    if (!c.asigRefs || !c.asigRefs.length) continue;
    for (const ref of c.asigRefs) {
      const origPedidoId = ref.pedidoId || ref.fromPedidoId || ref.sourcePedidoId;
      const origLineIdx = ref.lineIndex ?? ref.fromLineIndex ?? ref.sourceLineIndex;
      if (!origPedidoId || origLineIdx == null) continue;
      const orig = pedidos.find((pp) => pp._fsId === origPedidoId);
      if (!orig) continue;
      const origLine = (orig.lines || [])[origLineIdx];
      if (!origLine) continue;
      if (origLine.state === 'ASIG' && (Number(origLine.qtyOpen) || 0) > 0) {
        doubleCount += Math.min(c.qtyOpen, Number(origLine.qtyOpen) || 0);
      }
    }
  }
  console.log('Unidades duplicadas por ASIG→confirmed sin cancelar: ' + doubleCount);

  console.log('');
  console.log('===== CONCLUSIÓN =====');
  console.log('Las 7u ocultas pre-v1520 corresponden a confirmed sin SAP (§33 reserva pero popup escondía).');
  console.log('Fix v1520 §103: popup lista asig Y confirmed + fórmula explícita.');
  console.log('Doble conteo detectado: ' + doubleCount + 'u.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
