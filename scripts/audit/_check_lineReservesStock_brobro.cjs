/**
 * Debug: lineReservesStock del código real con el pedido BROBRO CUDC201HG.
 * Verifica si el pedido en Firestore trae confirmedAt y qué devuelve la fn real.
 */
const PROJECT = 'app-vendedores-shimano';
(async () => {
  const admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // Importar el código real (ES module import vía dynamic import).
  const { lineReservesStock } = await import('../../src/pure/stock-realmente-disponible.js');

  const pedidoIds = [
    { id: 'NAZbF5LKmej4Ebk9MPF0', name: 'BROBRO SA' },
    { id: 'EpijsHlw7465D5Nbc6Cp', name: 'LAMORA SRL' },
    { id: 'XYFWKuEkx5mQZ3b1lWUQ', name: 'OROZA' },
    { id: 'av6m64EKoSgwoHIZbHfN', name: 'BAUTISTA JOAQUIN BELTRAN' },
    { id: 'P1lcGYlt0HUt0sytfTqn', name: 'REBORN SRL' },
    { id: '5sXWncUSCZAQWPNhpWhw', name: 'LUIS JOSE ZYSMAN' },
  ];
  const now = Date.now();

  for (const ref of pedidoIds) {
    const snap = await db.collection('pedidos').doc(ref.id).get();
    if (!snap.exists) { console.log('[NOT FOUND]', ref.id); continue; }
    const p = snap.data() || {};
    const line = (p.lines || []).find((l) => l && String(l.code).toUpperCase() === 'CUDC201HG');
    if (!line) { console.log('[NO LINE]', ref.id); continue; }
    const confirmedAtMs = p.confirmedAt ? (typeof p.confirmedAt === 'string' ? Date.parse(p.confirmedAt) : (p.confirmedAt.toDate ? p.confirmedAt.toDate().getTime() : null)) : null;
    const ageDays = confirmedAtMs ? Math.round((now - confirmedAtMs) / 86400000) : null;
    const reserves = lineReservesStock(line, now, p);
    console.log(`${ref.name} (${ref.id}):`);
    console.log(`  line.state=${line.state} qtyOpen=${line.qtyOpen} asigReserva=${JSON.stringify(line.asigReserva)}`);
    console.log(`  pedido.confirmedAt=${JSON.stringify(p.confirmedAt)} ageDays=${ageDays}`);
    console.log(`  pedido.createdAt=${JSON.stringify(p.createdAt)}`);
    console.log(`  pedido.transferidoSAP=${JSON.stringify(p.transferidoSAP)}`);
    console.log(`  lineReservesStock → ${reserves}`);
    console.log('');
  }
})().catch((e) => { console.error(e); process.exit(1); });
