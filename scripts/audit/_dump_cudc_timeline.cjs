// E0 v1392 — Rastrear 5 clientes de CUDC201HG mencionados en el reporte
// Mariano 10:50 (ANDRILI, ANTONINI, IERONIMO, 4 NARICES, MASERA). Dumpear
// TODOS sus pedidos con CUDC201HG (abiertos y cerrados) para explicar las
// ~9u BO que desaparecieron entre 10:50 y 14:11 UTC.
//
// Autorizado por Mariano 2026-10-21. Read-only prod.

const SKU = 'CUDC201HG';
const PROJECT = 'app-vendedores-shimano';
const CLIENTES_TARGET = [
  'ANDRILI',
  'ANTONINI',
  'IERONIMO',
  '4 NARICES',
  'MASERA',
  'REBORN', // Mariano también mencionó REBORN 16u en el reporte original 10:50
];

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.toDate === 'function') try { return v.toDate().toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.toMillis === 'function') try { return new Date(v.toMillis()).toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  return String(v);
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('E0 — Timeline CUDC201HG @ ' + nowIso);
  console.log('================================================================');
  console.log('Clientes target: ' + CLIENTES_TARGET.join(', '));
  console.log('');

  // Query todos los pedidos (abiertos + cerrados) y filtrar por SKU + cliente target.
  const pedidosSnap = await db.collection('pedidos').get();
  const matches = [];
  pedidosSnap.forEach((doc) => {
    const data = doc.data() || {};
    const clientName = String(data.clientName || '').toUpperCase();
    const matchesCliente = CLIENTES_TARGET.some((c) => clientName.includes(c));
    if (!matchesCliente) return;
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== SKU) continue;
      matches.push({
        pedidoId: doc.id,
        clientName: data.clientName || '',
        clientCardCode: data.clientCardCode || '',
        createdAt: toIso(data.createdAt),
        confirmedAt: toIso(data.confirmedAt),
        closedAt: toIso(data.closedAt),
        closedReason: data.closedReason || null,
        stage: data.stage,
        orderNumber: data.orderNumber || null,
        transferidoSAP: data.transferidoSAP
          ? {
              docEntry: data.transferidoSAP.docEntry,
              docNum: data.transferidoSAP.docNum,
              docType: data.transferidoSAP.docType,
              via: data.transferidoSAP.via,
              transferredAt: toIso(data.transferidoSAP.transferredAt),
            }
          : null,
        lineIndex: i,
        state: l.state,
        qty: l.qty,
        qtyOpen: l.qtyOpen,
        asigAt: toIso(l.asigAt),
        asigReserva: l.asigReserva,
        recycledAt: toIso(l.recycledAt),
        invoicedAt: toIso(l.invoicedAt),
        cancelledAt: toIso(l.cancelledAt),
        origen: l.origen || null,
      });
    }
  });

  console.log('Total líneas CUDC201HG en pedidos de los 6 clientes: ' + matches.length);
  console.log('');

  // Agrupar por cliente.
  const byCliente = {};
  matches.forEach((m) => {
    const key = m.clientName || '(sin nombre)';
    if (!byCliente[key]) byCliente[key] = [];
    byCliente[key].push(m);
  });

  for (const [cliente, lineas] of Object.entries(byCliente)) {
    console.log('===== ' + cliente + ' =====');
    console.log('  líneas: ' + lineas.length);
    lineas.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    for (const l of lineas) {
      console.log('  pedidoId=' + l.pedidoId + ' order=' + (l.orderNumber || 'legacy'));
      console.log('    createdAt=' + l.createdAt + ' confirmedAt=' + l.confirmedAt + ' closedAt=' + l.closedAt + ' closedReason=' + l.closedReason);
      console.log('    stage=' + l.stage + ' lineIndex=' + l.lineIndex);
      console.log('    state=' + l.state + ' qtyOpen=' + l.qtyOpen + ' qty=' + l.qty);
      console.log('    asigAt=' + l.asigAt + ' asigReserva=' + l.asigReserva + ' origen=' + l.origen);
      console.log('    recycledAt=' + l.recycledAt + ' invoicedAt=' + l.invoicedAt + ' cancelledAt=' + l.cancelledAt);
      if (l.transferidoSAP) {
        console.log('    SAP docEntry=' + l.transferidoSAP.docEntry + ' docNum=' + l.transferidoSAP.docNum + ' docType=' + l.transferidoSAP.docType + ' via=' + l.transferidoSAP.via + ' transferredAt=' + l.transferidoSAP.transferredAt);
      }
      console.log('');
    }
    console.log('');
  }

  // Resumen: qué está en cada estado AHORA.
  console.log('===== RESUMEN estados actuales =====');
  const porEstado = { BO: 0, ASIG: 0, confirmed: 0, invoiced: 0, cancelled: 0, recycled: 0, legacy: 0, otro: 0 };
  for (const m of matches) {
    if (!m.state) porEstado.otro++;
    else if (porEstado[m.state] !== undefined) porEstado[m.state] += Number(m.qtyOpen || 0);
    else porEstado.otro += Number(m.qtyOpen || 0);
  }
  console.log(JSON.stringify(porEstado, null, 2));
  console.log('');

  // Resumen: pedidos cerrados vs abiertos.
  const abiertos = matches.filter((m) => !m.closedAt);
  const cerrados = matches.filter((m) => m.closedAt);
  console.log('Pedidos abiertos: ' + abiertos.length);
  console.log('Pedidos cerrados: ' + cerrados.length);
  console.log('  cerrados en últimas 6h (desde 2026-10-21T10:00Z):');
  const sixHrsAgo = Date.parse('2026-10-21T10:00:00Z');
  for (const m of cerrados) {
    const cmd = Date.parse(m.closedAt || '');
    if (cmd && cmd >= sixHrsAgo) {
      console.log('    pedidoId=' + m.pedidoId + ' cliente=' + m.clientName + ' qtyOpen=' + m.qtyOpen + ' state=' + m.state + ' closedAt=' + m.closedAt + ' closedReason=' + m.closedReason);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
