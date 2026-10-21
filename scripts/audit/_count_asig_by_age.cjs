/**
 * E5 D2 — Cuenta ASIG vivas en prod por bucket de edad.
 * Read-only. Compat A1.
 */
const PROJECT = 'app-vendedores-shimano';
(async () => {
  const admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let total = 0;
  let menor7d = 0;
  let entre7y15d = 0;
  let mayor15d = 0;
  snap.forEach((doc) => {
    const p = doc.data();
    for (const l of p.lines || []) {
      if (l.state !== 'ASIG') continue;
      if (Number(l.qtyOpen) <= 0) continue;
      if (l.asigReserva === false || l.asigReserva === 0) continue;
      if (!l.asigAt) continue;
      const asigMs = Date.parse(String(l.asigAt));
      if (!Number.isFinite(asigMs)) continue;
      const edadDias = (now - asigMs) / DAY;
      total++;
      if (edadDias <= 7) menor7d++;
      else if (edadDias <= 15) entre7y15d++;
      else mayor15d++;
    }
  });
  console.log('ASIG vivas totales:', total);
  console.log('  <= 7 dias:', menor7d);
  console.log('  7 < edad <= 15 dias:', entre7y15d);
  console.log('  > 15 dias:', mayor15d);
})().catch((e) => { console.error(e); process.exit(1); });
