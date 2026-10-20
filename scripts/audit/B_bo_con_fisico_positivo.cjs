/**
 * E5 — Query diagnóstico B — SKUs con BO pendiente y Físico > 0 en dep 11
 *
 * Audita cuántos SKUs tienen state=BO en `backorderBySkuApp` pero el `stock_snapshot.warehouseBreakdown[sku]['11']` es > 0.
 * Si > 0 y NO están en `ingresos_reparto` activo, hay stock libre que debería
 * aparecer en el modal Reparto pero no lo hace (gap operativo documentado como
 * FINDING-05 en 01_MAPA_FLUJO.md).
 *
 * Modo:
 *   node scripts/audit/B_bo_con_fisico_positivo.cjs           # dry-run
 *   node scripts/audit/B_bo_con_fisico_positivo.cjs --prod    # ejecuta contra prod
 */

const PROD = process.argv.includes('--prod');
const PROJECT = 'app-vendedores-shimano';

function logQueryLogic() {
  console.log('================================================================');
  console.log('QUERY B — SKUs con BO pendiente y Fisico > 0 en dep 11');
  console.log('================================================================');
  console.log('');
  console.log('Proyecto Firestore: ' + PROJECT);
  console.log('Documentos:');
  console.log('  - app_config/stock_snapshot (warehouseBreakdown)');
  console.log('  - app_config/stock_snapshot_app (backorderBySkuApp)');
  console.log('  - ingresos_reparto (status in [pending, in_progress])');
  console.log('');
  console.log('Estrategia:');
  console.log('  1. Leer stock_snapshot.warehouseBreakdown -> parse JSON -> extraer dep 11.');
  console.log('  2. Leer stock_snapshot_app.backorderBySkuApp -> {sku: qty}.');
  console.log('  3. Leer ingresos_reparto activos -> set(sku).');
  console.log('  4. Para cada SKU en backorderBySkuApp:');
  console.log('     - si dep11_fisico > 0 AND NO esta en ingresos_reparto activos:');
  console.log('       -> HALLAZGO (stock libre con BO colgado).');
  console.log('');
  console.log('Expected baseline: 0 (si el flow de reparto corre al dia).');
  console.log('> 0 ⇒ gap operativo. Puede ser:');
  console.log('  - CF onDep11IncreaseCreateReparto no corrio o fallo.');
  console.log('  - Admin marco ingresos_reparto status=done con stock sobrante (bug reportado FINDING-05).');
  console.log('  - BO viejo que nunca disparo delta positivo en dep 11 (stock llego antes del BO).');
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

  console.log('[prod] Leyendo stock_snapshot...');
  const snap1 = await db.doc('app_config/stock_snapshot').get();
  const snap2 = await db.doc('app_config/stock_snapshot_app').get();
  const d1 = snap1.data() || {};
  const d2 = snap2.data() || {};
  let whsBreakdown = {};
  try {
    whsBreakdown = typeof d1.warehouseBreakdown === 'string'
      ? JSON.parse(d1.warehouseBreakdown)
      : d1.warehouseBreakdown || {};
  } catch (_e) { whsBreakdown = {}; }
  const boApp = d2.backorderBySkuApp || {};

  console.log('[prod] Leyendo ingresos_reparto activos...');
  const irSnap = await db.collection('ingresos_reparto').where('status', 'in', ['pending', 'in_progress']).get();
  const activeSkus = new Set();
  irSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.sku) activeSkus.add(String(data.sku).toUpperCase());
  });

  const hallazgos = [];
  for (const sku of Object.keys(boApp)) {
    const skuUp = String(sku).toUpperCase();
    const boQty = Number(boApp[sku]) || 0;
    if (boQty <= 0) continue;
    const whs = whsBreakdown[skuUp] || {};
    const dep11 = Number(whs['11']) || 0;
    if (dep11 <= 0) continue;
    if (activeSkus.has(skuUp)) continue;
    hallazgos.push({ sku: skuUp, boQty, dep11 });
  }

  console.log('');
  console.log('===== RESULTADO Query B =====');
  console.log('SKUs en backorderBySkuApp con qty > 0: ' + Object.keys(boApp).filter(k => Number(boApp[k])>0).length);
  console.log('SKUs con ingresos_reparto activos: ' + activeSkus.size);
  console.log('HALLAZGOS (BO > 0 + Fisico dep 11 > 0 + NO en ingresos_reparto activo): ' + hallazgos.length);
  console.log('');
  if (hallazgos.length > 0) {
    hallazgos.sort((a, b) => b.dep11 - a.dep11);
    console.log('Top 20:');
    for (const h of hallazgos.slice(0, 20)) {
      console.log('  ' + h.sku + ': BO=' + h.boQty + ' / Fisico dep 11=' + h.dep11);
    }
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
