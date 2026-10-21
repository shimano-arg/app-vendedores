/**
 * E8 — Para los 14 SKUs Query B, listar clientes con BO del SKU.
 * Para pasar a Pablo.
 */
const PROJECT = 'app-vendedores-shimano';
const SKUS = [
  'EXGTVS90M4CH', 'ALV6000FA', 'SGS80MH2A', 'CLS70MH2PY', '21100150150W',
  'SUNBASS', 'SHMTECHLGREYXL', 'CLS70XH2CH', 'NEXS70H2SACH', 'EXGC70XHBAR',
  'ECLIPSE', 'STS66MH2C', 'CU301HGK', 'FXXTR27XH',
];

(async () => {
  const admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // Fisicos actuales dep 11
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const stockData = stockSnap.data() || {};
  let whsBreakdown = {};
  try {
    whsBreakdown = typeof stockData.warehouseBreakdown === 'string'
      ? JSON.parse(stockData.warehouseBreakdown)
      : stockData.warehouseBreakdown || {};
  } catch (_e) { whsBreakdown = {}; }

  // Pedidos abiertos con BO en estos SKUs
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const now = Date.now();
  const DAY = 86400000;
  const TTL = 7 * DAY;
  /** @type {Map<string, Array<{clientName:string, cardCode:string, qty:number, createdAt:string, pedidoId:string}>>} */
  const porSku = new Map();
  for (const sku of SKUS) porSku.set(sku, []);

  snap.forEach((doc) => {
    const p = doc.data();
    const cc = String(p.clientCardCode || '').trim();
    const name = String(p.clientName || '').trim();
    const createdAt = p.createdAt && p.createdAt.toDate ? p.createdAt.toDate().toISOString() : null;
    const createdMs = createdAt ? Date.parse(createdAt) : null;
    if (createdMs && now - createdMs > TTL) return; // skip BO expirados
    for (const l of p.lines || []) {
      if (l.state !== 'BO') continue;
      const q = Number(l.qtyOpen) || 0;
      if (q <= 0) continue;
      const sku = String(l.code || '').toUpperCase();
      if (!porSku.has(sku)) continue;
      porSku.get(sku).push({
        clientName: name,
        cardCode: cc,
        qty: q,
        createdAt: createdAt || '',
        pedidoId: doc.id,
      });
    }
  });

  console.log('# SKU | fisico | BO total | clientes');
  for (const sku of SKUS) {
    const whs = whsBreakdown[sku] || {};
    const fisico = Number(whs['11']) || 0;
    const clientes = porSku.get(sku) || [];
    clientes.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const total = clientes.reduce((s, c) => s + c.qty, 0);
    console.log(`\n${sku} | fisico=${fisico} | BO total=${total}u | ${clientes.length} clientes`);
    for (const c of clientes) {
      const edadDias = c.createdAt ? Math.round((now - Date.parse(c.createdAt)) / DAY) : '?';
      console.log(`  ${c.clientName} (${c.cardCode}) | ${c.qty}u | ${c.createdAt} (${edadDias}d) | ${c.pedidoId}`);
    }
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
