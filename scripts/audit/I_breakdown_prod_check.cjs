// E3 — Verificación prod read-only: corre getStockBreakdown sobre 4
// SKUs (CUDC201HG + 3 al azar con BO) y produce tabla comparativa.
// Autorizado por Mariano 2026-10-21.

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // Import ESM breakdown via dynamic import.
  const { getStockBreakdown } = await import('../../src/pure/stock-breakdown.js');

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  console.log('================================================================');
  console.log('E3 — Verificación getStockBreakdown en prod @ ' + nowIso);
  console.log('================================================================');

  // Snapshot stock.
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs = typeof sd.warehouseBreakdown === 'string'
    ? JSON.parse(sd.warehouseBreakdown)
    : (sd.warehouseBreakdown || {});

  // Load open pedidos.
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => {
    const data = d.data();
    pedidos.push(Object.assign({ _fsId: d.id }, data));
  });

  // Load ingresos_reparto activos.
  const irSnap = await db.collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress']).get();
  const ingresosActivos = [];
  irSnap.forEach((d) => {
    const data = d.data();
    ingresosActivos.push(Object.assign({ _fsId: d.id }, data));
  });

  // SKUs a verificar: CUDC201HG + 3 con BO vigente + físico > 0 (deterministico).
  const candidatos = new Set(['CUDC201HG']);
  const DAY = 24 * 60 * 60 * 1000;
  const boAcc = new Map();
  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (l.state !== 'BO') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const sku = String(l.code).toUpperCase();
      const fisico = (whs[sku] && whs[sku]['11']) || 0;
      if (fisico <= 0) continue;
      boAcc.set(sku, (boAcc.get(sku) || 0) + qo);
    }
  }
  const unique = [...boAcc.entries()]
    .filter(([s]) => s !== 'CUDC201HG')
    .sort((a, b) => b[1] - a[1]) // top BO vigente
    .map(([s]) => s);
  const picks = unique.slice(0, 3);
  for (const s of picks) candidatos.add(s);

  console.log('SKUs a verificar: ' + [...candidatos].join(', '));
  console.log('');

  const deps = {
    getStockFisico: (sku) => (whs[String(sku).toUpperCase()] && whs[String(sku).toUpperCase()]['11']) || 0,
    getStockTransito: (sku) => (whs[String(sku).toUpperCase()] && whs[String(sku).toUpperCase()]['12']) || 0,
    pedidos,
    waitlistEntries: [],
    ingresosRepartoActivos: ingresosActivos,
  };

  const rows = [];
  for (const sku of candidatos) {
    const b = getStockBreakdown(sku, deps, { now: nowMs });
    rows.push({
      sku,
      fisicoDep11: b.fisicoDep11,
      transitoDep12: b.transitoDep12,
      backorderApp: b.backorderApp.total,
      confirmadas: b.confirmadasSinFacturar.total,
      asignadas: b.asignadas.total,
      waitlistCpst: b.waitlistCpst.total,
      reservadasTotal: b.reservadasTotal,
      libre: b.libre,
      pendienteReparto: b.pendienteReparto.qty,
      repartoId: b.pendienteReparto.repartoId,
    });
  }

  console.log('===== TABLA getStockBreakdown PROD =====');
  console.log('| SKU | fisico | transito | BO | conf | asig | wlCpst | reserv | libre | pendRep | repartoId |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log('| ' + r.sku + ' | ' + r.fisicoDep11 + ' | ' + r.transitoDep12 + ' | ' + r.backorderApp + ' | ' + r.confirmadas + ' | ' + r.asignadas + ' | ' + r.waitlistCpst + ' | ' + r.reservadasTotal + ' | ' + r.libre + ' | ' + r.pendienteReparto + ' | ' + (r.repartoId || '-') + ' |');
  }

  console.log('');
  console.log('===== INVARIANTES =====');
  let allOk = true;
  for (const r of rows) {
    const sum = r.backorderApp + r.confirmadas + r.asignadas + r.waitlistCpst;
    const sumOk = sum === r.reservadasTotal;
    const libreOk = r.libre === Math.max(0, r.fisicoDep11 - r.reservadasTotal);
    const pendOk = r.pendienteReparto === (r.backorderApp > 0 ? Math.max(0, r.fisicoDep11 - r.asignadas - r.confirmadas) : 0);
    const ok = sumOk && libreOk && pendOk;
    if (!ok) allOk = false;
    console.log('  ' + r.sku + ': sumBuckets=' + sumOk + ' libreFormula=' + libreOk + ' pendRepFormula=' + pendOk + (ok ? ' ✓' : ' ✗'));
  }
  console.log('');
  console.log(allOk ? 'TODOS OK ✓' : 'HAY DIVERGENCIAS ✗');
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
