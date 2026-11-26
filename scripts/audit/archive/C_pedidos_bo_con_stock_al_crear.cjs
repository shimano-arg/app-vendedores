/**
 * E5 — Query diagnóstico C — Pedidos ex-ASIG que fueron 100% BO con stock disponible
 *
 * Audita cuántos pedidos tienen:
 *   - source heredado de un waitlist 'stock-asignado-batch' (CPST)
 *   - 100% líneas en state=BO (todas con qtyOpen > 0)
 *   - transferidoSAP.via = 'app_only' con reason='all_lines_bo'
 *
 * Si > 0 ⇒ víctimas del bug H1 (CONFIRMADO en E3). Dimensión del impacto.
 *
 * Modo:
 *   node scripts/audit/C_pedidos_bo_con_stock_al_crear.cjs           # dry-run
 *   node scripts/audit/C_pedidos_bo_con_stock_al_crear.cjs --prod    # ejecuta contra prod
 */

const PROD = process.argv.includes('--prod');
const PROJECT = 'app-vendedores-shimano';

function logQueryLogic() {
  console.log('================================================================');
  console.log('QUERY C — Pedidos ex-ASIG 100% BO (victimas del bug H1)');
  console.log('================================================================');
  console.log('');
  console.log('Proyecto Firestore: ' + PROJECT);
  console.log('Colección: pedidos');
  console.log('');
  console.log('Estrategia:');
  console.log('  1. Scan pedidos con transferidoSAP.via = app_only y reason = all_lines_bo.');
  console.log('  2. Filtrar los que tienen source="stock-asignado-batch"');
  console.log('     (campo heredado desde el waitlist CPST, v1209 2026-10-08).');
  console.log('  3. Para cada uno, verificar:');
  console.log('     - 100% de las lineas en state=BO con qtyOpen > 0.');
  console.log('     - Al menos 1 linea con qty > 0.');
  console.log('  4. Agregar por (sku, cardCode): sum(qty), count(pedidos).');
  console.log('');
  console.log('Expected baseline: dependera de cuanto tiempo lleve el bug (v1208 fue 2026-10-08).');
  console.log('> 0 ⇒ dimensión del impacto del bug H1 en prod.');
  console.log('');
  console.log('Interpretacion: estos pedidos deberian haber viajado a SAP como SQ');
  console.log('con qty = Utilizable(cliente). En su lugar quedaron 100% BO en app y');
  console.log('las ASIG originales fueron canceladas → doble perdida.');
  console.log('');
}

async function runProd() {
  let admin;
  try {
    admin = require('../../functions/node_modules/firebase-admin');
  } catch (_e) {
    console.error('ERROR: firebase-admin no encontrado.');
    process.exit(2);
  }
  const useAdc = !process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (useAdc) {
    admin.initializeApp({ projectId: PROJECT });
    console.log('[prod] Usando Application Default Credentials.');
  } else {
    const saKey = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    admin.initializeApp({ credential: admin.credential.cert(require(saKey)), projectId: PROJECT });
  }
  const db = admin.firestore();

  console.log('[prod] Scanning pedidos con transferidoSAP.via = app_only...');
  const snap = await db.collection('pedidos')
    .where('transferidoSAP.via', '==', 'app_only')
    .get();
  console.log('[prod] pedidos leidos: ' + snap.size);

  const hallazgos = [];
  const porCardCode = new Map();
  const porSku = new Map();

  snap.forEach((doc) => {
    const p = doc.data() || {};
    if (!p.transferidoSAP || p.transferidoSAP.reason !== 'all_lines_bo') return;
    if (p.source !== 'stock-asignado-batch') return;
    if (!Array.isArray(p.lines) || p.lines.length === 0) return;
    const allBo = p.lines.every((l) => l && l.state === 'BO' && (Number(l.qtyOpen) || 0) > 0);
    if (!allBo) return;
    const totalQty = p.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    hallazgos.push({
      pedidoId: doc.id,
      clientCardCode: p.clientCardCode,
      clientName: p.clientName,
      createdAt: p.createdAt,
      totalQty,
      lineas: p.lines.length,
      skus: p.lines.map((l) => l.code).join(','),
    });
    const cc = String(p.clientCardCode || '').trim();
    porCardCode.set(cc, (porCardCode.get(cc) || 0) + totalQty);
    for (const l of p.lines) {
      const sku = String(l.code || '').toUpperCase();
      porSku.set(sku, (porSku.get(sku) || 0) + (Number(l.qty) || 0));
    }
  });

  console.log('');
  console.log('===== RESULTADO Query C =====');
  console.log('Pedidos ex-ASIG (source=stock-asignado-batch) con 100% BO + app_only: ' + hallazgos.length);
  console.log('Clientes afectados: ' + porCardCode.size);
  console.log('SKUs afectados: ' + porSku.size);
  console.log('');
  if (hallazgos.length > 0) {
    const sortedCC = Array.from(porCardCode.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('Top 10 clientes:');
    for (const [cc, qty] of sortedCC) console.log('  ' + cc + ': ' + qty + ' unidades');
    const sortedSKU = Array.from(porSku.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('Top 10 SKUs:');
    for (const [sku, qty] of sortedSKU) console.log('  ' + sku + ': ' + qty + ' unidades');
    console.log('');
    console.log('Primeros 5 pedidos (muestra):');
    for (const h of hallazgos.slice(0, 5)) {
      console.log('  ' + h.pedidoId + ' / ' + h.clientName + ' / ' + h.totalQty + 'u / ' + h.lineas + ' lineas');
    }
    console.log('');
    console.log('⚠️ CRITICAL: cada uno de estos pedidos es evidencia prod del bug H1.');
    console.log('   Fix propuesto en docs/auditoria/06_PROPUESTAS_FIX.md');
  }
  process.exit(0);
}

if (!PROD) {
  logQueryLogic();
  console.log('MODO: dry-run (default). Para ejecutar contra prod: --prod');
  console.log('⚠️ ANTES de --prod: GATE HUMANO. Pedir OK a Mariano.');
  process.exit(0);
}

logQueryLogic();
console.log('MODO: --prod. Ejecutando...');
runProd().catch((e) => {
  console.error('ERROR en runProd:', e);
  process.exit(1);
});
