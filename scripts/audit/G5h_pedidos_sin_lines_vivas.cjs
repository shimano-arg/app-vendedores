// G5h — read-only prod: pedidos abiertos (closedAt=null) donde TODAS las
// líneas están cancelled/invoiced. El doc quedó en "zombie" porque algún
// flow olvidó cerrar el pedido tras cancelar la última línea.
//
// Qué estado corrige: pedido con `closedAt=null` + 0 líneas con `state` en
// {BO, ASIG, confirmed, pending}. El doc aparece en Pedidos > Pendientes/En
// Espera aunque no tenga demanda viva.
// Cuántos docs toca: 1 doc pedido por caso.
// Qué campo cambia: `closedAt=nowIso`, `closedReason='all_cancelled_or_invoiced_cleanup_v1425'`.
// Reversible: SÍ (clear `closedAt` + `closedReason`).

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');

const LIVE_STATES = new Set(['BO', 'ASIG', 'confirmed', 'pending']);

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('G5h — pedidos sin líneas vivas @ ' + nowIso + '  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('================================================================');

  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const affected = [];
  snap.forEach((d) => {
    const p = d.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    if (lines.length === 0) {
      affected.push({
        pedidoId: d.id,
        orderNumber: p.orderNumber || '',
        cliente: p.clientName || '',
        stage: p.stage || '',
        linesTotal: 0,
        linesLive: 0,
        states: '(vacío)',
      });
      return;
    }
    const live = lines.filter((l) => l && LIVE_STATES.has(l.state));
    if (live.length === 0) {
      const states = {};
      lines.forEach((l) => {
        const s = (l && l.state) || '?';
        states[s] = (states[s] || 0) + 1;
      });
      affected.push({
        pedidoId: d.id,
        orderNumber: p.orderNumber || '',
        cliente: p.clientName || '',
        stage: p.stage || '',
        linesTotal: lines.length,
        linesLive: 0,
        states: Object.entries(states).map(([k, v]) => `${k}:${v}`).join(','),
      });
    }
  });

  console.log('Pedidos afectados: ' + affected.length);
  for (const row of affected) {
    console.log(
      `pedidos/${row.pedidoId} ORDEN=${row.orderNumber} cliente="${row.cliente}" ` +
      `stage=${row.stage} lines=${row.linesTotal} live=${row.linesLive} states=${row.states}`
    );
  }

  if (APPLY && affected.length > 0) {
    console.log('\nAPLICANDO ' + affected.length + ' closes...');
    for (const row of affected) {
      const docRef = db.collection('pedidos').doc(row.pedidoId);
      await docRef.update({
        closedAt: nowIso,
        closedReason: 'all_cancelled_or_invoiced_cleanup_v1425',
        updatedAt: nowIso,
      });
      console.log('  ✓ pedidos/' + row.pedidoId + ' cerrado');
    }
  } else if (!APPLY && affected.length > 0) {
    console.log('\nDRY-RUN completo. Correr con --apply para cerrar ' + affected.length + ' pedidos.');
  } else {
    console.log('\nSin pedidos afectados.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
