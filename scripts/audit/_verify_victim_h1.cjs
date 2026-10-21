/**
 * Verificador read-only para víctimas H1 (E1 del plan fix-stock-cardcode-h1).
 * Input: pedidoId (de output Query C). Lee datos extra y clasifica:
 *   - ¿ASIG original (pedido A cancelado al confirmar B) sigue cancelled o la revivieron?
 *   - ¿Hay ASIG nuevas (sku, cardCode) con asigAt > pedidoB.createdAt?
 *   - ¿Stock físico actual en dep 11?
 */
const PROJECT = 'app-vendedores-shimano';
const PEDIDO_ID = process.argv[2];
if (!PEDIDO_ID) {
  console.error('Uso: node _verify_victim_h1.cjs <pedidoId>');
  process.exit(1);
}

(async () => {
  const admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // 1. Leer pedido víctima
  const pedidoB = await db.collection('pedidos').doc(PEDIDO_ID).get();
  if (!pedidoB.exists) {
    console.log(`[ERR] pedido ${PEDIDO_ID} no existe`);
    process.exit(2);
  }
  const B = pedidoB.data();
  console.log('=== PEDIDO VICTIMA ===');
  console.log('id:', PEDIDO_ID);
  console.log('cliente:', B.clientName, '(' + B.clientCardCode + ')');
  console.log('createdAt:', B.createdAt && B.createdAt.toDate ? B.createdAt.toDate().toISOString() : B.createdAt);
  console.log('source:', B.source);
  console.log('transferidoSAP:', JSON.stringify(B.transferidoSAP));
  console.log('closedAt:', B.closedAt);
  console.log('lines:');
  for (const l of B.lines || []) {
    console.log(`  sku=${l.code} qty=${l.qty} qtyOpen=${l.qtyOpen} state=${l.state}`);
  }
  const createdAtMs = B.createdAt && B.createdAt.toDate ? B.createdAt.toDate().getTime() : null;

  // 2. Buscar pedido A (ASIG original cancelada "cancelledIntoPedidoId == PEDIDO_ID")
  console.log('\n=== BUSCANDO PEDIDO A ORIGINAL (ASIG cancelada al confirmar B) ===');
  const skus = (B.lines || []).map(l => String(l.code).toUpperCase());
  const cc = B.clientCardCode;
  // No tenemos un query directo por lines[].cancelledIntoPedidoId. Scan pedidos del cliente.
  const clientPedidos = await db.collection('pedidos').where('clientCardCode', '==', cc).get();
  console.log(`[info] pedidos del cliente ${cc}: ${clientPedidos.size}`);
  const asigsOriginales = [];
  const asigsPosteriores = [];
  clientPedidos.forEach((docSnap) => {
    const p = docSnap.data();
    const pId = docSnap.id;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      const skuU = String(l.code).toUpperCase();
      if (!skus.includes(skuU)) continue;
      // Original: cancelada apuntando al pedido víctima
      if (l.cancelledIntoPedidoId === PEDIDO_ID) {
        asigsOriginales.push({ pedidoId: pId, lineIndex: i, state: l.state, qty: l.qty, qtyCancelled: l.qtyCancelled, asigAt: l.asigAt, cancelledAt: l.cancelledAt });
      }
      // Posterior: ASIG nueva del mismo sku+cliente creada después del pedido víctima
      if (l.state === 'ASIG' && l.asigAt) {
        const asigAtMs = Date.parse(String(l.asigAt));
        if (Number.isFinite(asigAtMs) && createdAtMs && asigAtMs > createdAtMs && pId !== PEDIDO_ID) {
          asigsPosteriores.push({ pedidoId: pId, lineIndex: i, qtyOpen: l.qtyOpen, asigAt: l.asigAt });
        }
      }
    }
  });
  console.log(`ASIG originales canceladas apuntando a ${PEDIDO_ID}: ${asigsOriginales.length}`);
  for (const a of asigsOriginales) console.log('  ', JSON.stringify(a));
  console.log(`ASIG nuevas del mismo (sku,cliente) posteriores al pedido víctima: ${asigsPosteriores.length}`);
  for (const a of asigsPosteriores) console.log('  ', JSON.stringify(a));

  // 3. Stock físico actual dep 11
  console.log('\n=== STOCK FISICO ACTUAL DEP 11 ===');
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const stockData = stockSnap.data() || {};
  let whsBreakdown = {};
  try {
    whsBreakdown = typeof stockData.warehouseBreakdown === 'string'
      ? JSON.parse(stockData.warehouseBreakdown)
      : stockData.warehouseBreakdown || {};
  } catch (_e) { whsBreakdown = {}; }
  for (const sku of skus) {
    const whs = whsBreakdown[sku] || {};
    console.log(`  ${sku}: dep11=${Number(whs['11']) || 0}`);
  }

  // 4. Clasificar
  console.log('\n=== VEREDICTO ===');
  const stockDisponible = skus.every(s => (Number((whsBreakdown[s] || {})['11']) || 0) > 0);
  const asigOrigenCancelada = asigsOriginales.length > 0 && asigsOriginales.every(a => a.state === 'cancelled');
  const yaRecibioPorOtroReparto = asigsPosteriores.length > 0;
  if (yaRecibioPorOtroReparto) {
    console.log('CLASIFICACION: NO-RECUPERABLE (cliente ya recibió por reparto posterior)');
  } else if (asigOrigenCancelada && stockDisponible) {
    console.log('CLASIFICACION: RECUPERABLE (restaurar ASIG original + cerrar pedido B + que Pablo cree pedido ST nuevo)');
  } else {
    console.log('CLASIFICACION: INVESTIGAR (asig original state != cancelled o stock insuficiente)');
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
