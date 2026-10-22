// G5a — read-only prod: pedidos con líneas qtyOpen > qty (invariante R9).
//
// Qué estado corrige: data corrupta donde `qtyOpen` superó `qty` tras alguna
// mutación mal normalizada (split, invoice, cancellation parcial). Viola la
// invariante output de `splitPedidoLine`.
// Cuántos docs toca: 1 doc pedido por línea afectada (update de `lines[i]`).
// Qué campo cambia: `lines[i].qtyOpen = min(qty - qtyInvoiced - qtyCancelled, qtyOpen)`.
// Reversible: SÍ. El valor viejo se loguea; se puede restaurar con script inverso.
//
// Dry-run por default. Flag `--apply` persiste.

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('G5a — qtyOpen > qty @ ' + nowIso + '  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('================================================================');

  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const affected = [];
  snap.forEach((d) => {
    const p = d.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    lines.forEach((l, i) => {
      if (!l) return;
      const qty = Number(l.qty) || 0;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen > qty) {
        const qtyInv = Number(l.qtyInvoiced) || 0;
        const qtyCan = Number(l.qtyCancelled) || 0;
        const qtyOpenFixed = Math.max(0, Math.min(qty - qtyInv - qtyCan, qtyOpen));
        affected.push({
          pedidoId: d.id,
          orderNumber: p.orderNumber || '',
          cliente: p.clientName || '',
          lineIndex: i,
          sku: l.code || '',
          state: l.state || '',
          qty,
          qtyOpenActual: qtyOpen,
          qtyInvoiced: qtyInv,
          qtyCancelled: qtyCan,
          qtyOpenPropuesto: qtyOpenFixed,
        });
      }
    });
  });

  console.log('Líneas afectadas: ' + affected.length);
  for (const row of affected) {
    console.log(
      `pedidos/${row.pedidoId} ORDEN=${row.orderNumber} cliente="${row.cliente}" ` +
      `line[${row.lineIndex}].sku=${row.sku} state=${row.state} ` +
      `qty=${row.qty} qtyOpen=${row.qtyOpenActual} (inv=${row.qtyInvoiced} can=${row.qtyCancelled}) ` +
      `→ qtyOpen=${row.qtyOpenPropuesto}`
    );
  }

  if (APPLY && affected.length > 0) {
    console.log('\nAPLICANDO ' + affected.length + ' fixes...');
    // Agrupar por pedido para 1 update por doc.
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
        if (newLines[row.lineIndex]) {
          newLines[row.lineIndex].qtyOpen = row.qtyOpenPropuesto;
          newLines[row.lineIndex].qtyOpenFixedAt = nowIso;
          newLines[row.lineIndex].qtyOpenFixedReason = 'G5a_qtyopen_gt_qty_v1425';
        }
      }
      await docRef.update({ lines: newLines, updatedAt: nowIso });
      console.log('  ✓ pedidos/' + pedidoId + ': ' + rows.length + ' línea(s) fix');
    }
  } else if (!APPLY && affected.length > 0) {
    console.log('\nDRY-RUN completo. Correr con --apply para persistir ' + affected.length + ' fixes.');
  } else {
    console.log('\nSin líneas afectadas.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
