/**
 * Query C2 — Histórico de víctimas H1 sin filtro TTL (post-cierre fix-stock-cardcode-h1).
 *
 * Query C original filtraba por TTL 7d. Esta variante levanta cualquier pedido
 * ex-ASIG 100% BO + app_only desde v1208 (2026-10-08), incluyendo víctimas
 * viejas cuya ASIG original ya expiró.
 *
 * Read-only. Autorizado A1.
 */
const PROD = process.argv.includes('--prod');
const PROJECT = 'app-vendedores-shimano';
const CUTOFF_ISO = '2026-10-08T00:00:00.000Z';

(async () => {
  if (!PROD) {
    console.log('Dry-run: muestra la query logica.');
    console.log('Query: pedidos con transferidoSAP.via=app_only + reason=all_lines_bo');
    console.log('  + source=stock-asignado-batch + 100% lineas BO con qtyOpen>0.');
    console.log(`Filtro fecha: createdAt >= ${CUTOFF_ISO} (v1208 release del bug).`);
    console.log('No filtra por TTL — incluye victimas viejas con ASIG vencida.');
    process.exit(0);
  }
  const admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  console.log(`[prod] Scanning desde ${CUTOFF_ISO}...`);
  const snap = await db
    .collection('pedidos')
    .where('transferidoSAP.via', '==', 'app_only')
    .get();
  const cutoffMs = Date.parse(CUTOFF_ISO);
  const hallazgos = [];
  snap.forEach((doc) => {
    const p = doc.data();
    if (!p.transferidoSAP || p.transferidoSAP.reason !== 'all_lines_bo') return;
    if (p.source !== 'stock-asignado-batch') return;
    const createdAtMs = p.createdAt && p.createdAt.toDate ? p.createdAt.toDate().getTime() : null;
    if (!createdAtMs || createdAtMs < cutoffMs) return;
    if (!Array.isArray(p.lines) || p.lines.length === 0) return;
    const allBo = p.lines.every((l) => l && l.state === 'BO' && Number(l.qtyOpen) > 0);
    if (!allBo) return;
    const totalQty = p.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    hallazgos.push({
      pedidoId: doc.id,
      clientCardCode: p.clientCardCode,
      clientName: p.clientName,
      createdAt: new Date(createdAtMs).toISOString(),
      totalQty,
      skus: p.lines.map((l) => `${l.code}:${l.qty}`).join(','),
    });
  });
  console.log('');
  console.log('===== HISTORICO H1 sin TTL =====');
  console.log(`Pedidos ex-ASIG 100% BO + app_only desde v1208: ${hallazgos.length}`);
  hallazgos.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const h of hallazgos) {
    console.log(`  ${h.createdAt} / ${h.pedidoId} / ${h.clientName} (${h.clientCardCode}) / ${h.totalQty}u / ${h.skus}`);
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
