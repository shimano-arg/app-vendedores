// Dump 597151 + Bengochea + ORDEN 472 para explicar el "reservadas 6".
const admin = require('../../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'app-vendedores-shimano' });

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.toDate === 'function') try { return v.toDate().toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.toMillis === 'function') try { return new Date(v.toMillis()).toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  return String(v);
}

async function main() {
  const db = admin.firestore();
  const SKU = '597151';
  const CLIENT_MATCH = 'BENGOCHEA';
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('DUMP ' + SKU + ' Bengochea ORDEN 472 @ ' + nowIso);
  console.log('================================================================');

  // Stock snapshot.
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs = typeof sd.warehouseBreakdown === 'string' ? JSON.parse(sd.warehouseBreakdown) : (sd.warehouseBreakdown || {});
  console.log('stock_snapshot.updatedAt=' + toIso(sd.updatedAt));
  console.log('whs[' + SKU + ']=' + JSON.stringify(whs[SKU] || {}));
  console.log('');

  // Pedidos abiertos con SKU 597151.
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const matches = [];
  pedidosSnap.forEach((doc) => {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== SKU.toUpperCase()) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      matches.push({
        pedidoId: doc.id,
        clientName: data.clientName || '',
        clientCardCode: data.clientCardCode || '',
        orderNumber: data.orderNumber || null,
        createdAt: toIso(data.createdAt),
        confirmedAt: toIso(data.confirmedAt),
        stage: data.stage,
        source: data.source || null,
        pedidosOrigenes: data.pedidosOrigenes || null,
        lineIndex: i,
        state: l.state,
        qty: l.qty,
        qtyOpen: qo,
        asigAt: toIso(l.asigAt),
        asigReserva: l.asigReserva,
        origen: l.origen || null,
        asigRefs: l.asigRefs || null,
      });
    }
  });
  console.log('===== pedidos abiertos con SKU 597151 =====');
  console.log('total líneas: ' + matches.length);
  for (const m of matches) {
    console.log('');
    console.log('  pedidoId=' + m.pedidoId + ' order=' + (m.orderNumber || 'legacy'));
    console.log('    client=' + m.clientName + ' (' + m.clientCardCode + ') stage=' + m.stage);
    console.log('    state=' + m.state + ' qty=' + m.qty + ' qtyOpen=' + m.qtyOpen);
    console.log('    source=' + m.source + ' origen=' + m.origen);
    console.log('    asigAt=' + m.asigAt + ' asigReserva=' + m.asigReserva);
    console.log('    createdAt=' + m.createdAt + ' confirmedAt=' + m.confirmedAt);
    if (m.pedidosOrigenes) console.log('    pedidosOrigenes=' + JSON.stringify(m.pedidosOrigenes).slice(0, 300));
    if (m.asigRefs) console.log('    asigRefs=' + JSON.stringify(m.asigRefs).slice(0, 300));
  }
  console.log('');

  // revision_waitlist CPST con 597151.
  console.log('===== revision_waitlist con items 597151 =====');
  try {
    const wlSnap = await db.collection('revision_waitlist').where('source', '==', 'stock-asignado-batch').get();
    let totalWl = 0;
    wlSnap.forEach((doc) => {
      const data = doc.data() || {};
      const items = Array.isArray(data.items) ? data.items : [];
      const matchItems = items.filter((it) => it && String(it.code || '').toUpperCase() === SKU.toUpperCase());
      if (matchItems.length === 0) return;
      const totalItems = matchItems.reduce((s, it) => s + (Number(it.qty) || 0), 0);
      totalWl += totalItems;
      console.log('  waitlistId=' + doc.id + ' client=' + (data.clientName || '') + ' (' + (data.clientCardCode || '') + ') total=' + totalItems);
      for (const it of matchItems) {
        console.log('    code=' + it.code + ' qty=' + it.qty + ' extras=' + JSON.stringify({ _id: it._id || it.pedidoOrigenId }));
      }
    });
    console.log('TOTAL waitlistCpst para ' + SKU + ' = ' + totalWl);
  } catch (e) {
    console.log('error revision_waitlist: ' + e.message);
  }
  console.log('');

  // ingresos_reparto activos para 597151.
  console.log('===== ingresos_reparto activos para 597151 =====');
  const irSnap = await db.collection('ingresos_reparto').where('sku', '==', SKU.toUpperCase()).where('status', 'in', ['pending', 'in_progress']).get();
  irSnap.forEach((d) => {
    const data = d.data();
    console.log('  id=' + d.id + ' status=' + data.status + ' qtyIng=' + data.qtyIngresada + ' assignments=' + (Array.isArray(data.assignments) ? data.assignments.length : 0));
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
