// G5b — read-only prod: líneas state='ASIG' con qty=0 (legacy pre-v1402).
//
// Qué estado corrige: líneas residuales de "destildar ASIG reserva" que
// quedaron con qty=0 pero state='ASIG'. Post-v1402 §40.10 el toggle revierte
// a BO en vez de dejar qty=0. Estas líneas son zombis sin efecto (qty=0 no
// reserva), pero ocupan posición en lines[] y confunden al vendedor.
// Cuántos docs toca: 1 doc pedido por línea.
// Qué campo cambia: `lines[i].state = 'cancelled'`, `closedReason='qty_zero_cleanup_v1425'`,
//   `qtyOpen=0`, `qtyCancelled=qty`, `cancelledAt=nowIso`, `cancelledBy='system:audit_G5b'`.
// Reversible: SÍ con script inverso (restaurar state='ASIG', clear cancelled* fields).

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('G5b — qty=0 ASIG legacy @ ' + nowIso + '  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('================================================================');

  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const affected = [];
  snap.forEach((d) => {
    const p = d.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    lines.forEach((l, i) => {
      if (!l || l.state !== 'ASIG') return;
      const qty = Number(l.qty) || 0;
      if (qty === 0) {
        affected.push({
          pedidoId: d.id,
          orderNumber: p.orderNumber || '',
          cliente: p.clientName || '',
          lineIndex: i,
          sku: l.code || '',
          qtyOpen: Number(l.qtyOpen) || 0,
          asigAt: l.asigAt || null,
        });
      }
    });
  });

  console.log('Líneas afectadas: ' + affected.length);
  for (const row of affected) {
    console.log(
      `pedidos/${row.pedidoId} ORDEN=${row.orderNumber} cliente="${row.cliente}" ` +
      `line[${row.lineIndex}].sku=${row.sku} state=ASIG qty=0 qtyOpen=${row.qtyOpen} asigAt=${row.asigAt}`
    );
  }

  if (APPLY && affected.length > 0) {
    console.log('\nAPLICANDO ' + affected.length + ' cleanups...');
    const byPedido = new Map();
    for (const row of affected) {
      if (!byPedido.has(row.pedidoId)) byPedido.set(row.pedidoId, []);
      byPedido.get(row.pedidoId).push(row);
    }
    for (const [pedidoId, rows] of byPedido.entries()) {
      const docRef = db.collection('pedidos').doc(pedidoId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) continue;
      const data = docSnap.data() || {};
      const newLines = Array.isArray(data.lines) ? data.lines.map((l) => ({ ...l })) : [];
      for (const row of rows) {
        const l = newLines[row.lineIndex];
        if (!l) continue;
        l.state = 'cancelled';
        l.qtyOpen = 0;
        l.qtyCancelled = (Number(l.qtyCancelled) || 0) + (Number(l.qty) || 0);
        l.closedReason = 'qty_zero_cleanup_v1425';
        l.cancelledAt = nowIso;
        l.cancelledBy = 'system:audit_G5b';
      }
      await docRef.update({ lines: newLines, updatedAt: nowIso });
      console.log('  ✓ pedidos/' + pedidoId + ': ' + rows.length + ' línea(s) cleanup');
    }
  } else if (!APPLY && affected.length > 0) {
    console.log('\nDRY-RUN completo. Correr con --apply para persistir ' + affected.length + ' cleanups.');
  } else {
    console.log('\nSin líneas afectadas.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
