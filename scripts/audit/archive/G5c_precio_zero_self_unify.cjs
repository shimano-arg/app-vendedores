// G5c — read-only prod: líneas con precio=0 residuales del self-unify
// pre-v1418 §42.2.1. Son líneas donde el merge de órdenes olvidó propagar
// el precio del snapshot anterior.
//
// Qué estado corrige: línea activa (state in {BO, ASIG, confirmed}) con
// qty>0 pero precio=0 → monto SAP incorrecto. No afecta stock (qty válida),
// solo monto financiero.
// Cuántos docs toca: 1 doc pedido por línea afectada.
// Qué campo cambia:
//   - Opción A (default): `lines[i].state='cancelled'` + audit (si qty>0 pero no se puede recuperar precio).
//   - Opción B: si existe `priceAtCreation`, usar ese como `precio`.
// Reversible: SÍ. Audit en `precioZeroFixedAt` + `precioZeroFixedReason`.

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');

const ACTIVE_STATES = new Set(['BO', 'ASIG', 'confirmed']);

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('G5c — precio=0 residual self-unify @ ' + nowIso + '  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('================================================================');

  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const affected = [];
  snap.forEach((d) => {
    const p = d.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    lines.forEach((l, i) => {
      if (!l || !ACTIVE_STATES.has(l.state)) return;
      const qty = Number(l.qty) || 0;
      const precio = Number(l.precio) || 0;
      if (qty > 0 && precio === 0) {
        const priceFromSnap = Number(l.priceAtCreation) || Number(l.price) || 0;
        affected.push({
          pedidoId: d.id,
          orderNumber: p.orderNumber || '',
          cliente: p.clientName || '',
          lineIndex: i,
          sku: l.code || '',
          state: l.state,
          qty,
          priceSnap: priceFromSnap,
          recoverable: priceFromSnap > 0,
          importedFromOrder: l.importedFromOrder || null,
        });
      }
    });
  });

  console.log('Líneas afectadas: ' + affected.length);
  const recoverable = affected.filter((a) => a.recoverable).length;
  console.log('  Con precio recuperable (priceAtCreation): ' + recoverable);
  console.log('  Sin precio recuperable (requiere cancel): ' + (affected.length - recoverable));

  for (const row of affected) {
    const action = row.recoverable ? `RECOVER precio=${row.priceSnap}` : 'CANCEL (sin precio recuperable)';
    console.log(
      `pedidos/${row.pedidoId} ORDEN=${row.orderNumber} cliente="${row.cliente}" ` +
      `line[${row.lineIndex}].sku=${row.sku} state=${row.state} qty=${row.qty} ` +
      `importedFrom=${row.importedFromOrder} → ${action}`
    );
  }

  if (APPLY && affected.length > 0) {
    console.log('\nAPLICANDO ' + affected.length + ' fixes...');
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
        if (row.recoverable) {
          l.precio = row.priceSnap;
          l.precioZeroFixedAt = nowIso;
          l.precioZeroFixedReason = 'G5c_recover_from_priceAtCreation_v1425';
        } else {
          l.state = 'cancelled';
          l.qtyOpen = 0;
          l.qtyCancelled = (Number(l.qtyCancelled) || 0) + (Number(l.qty) || 0);
          l.closedReason = 'precio_zero_cancel_v1425';
          l.cancelledAt = nowIso;
          l.cancelledBy = 'system:audit_G5c';
        }
      }
      await docRef.update({ lines: newLines, updatedAt: nowIso });
      console.log('  ✓ pedidos/' + pedidoId + ': ' + rows.length + ' línea(s)');
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
