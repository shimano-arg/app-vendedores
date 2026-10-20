/**
 * E5 — Query diagnóstico A — Reservas vivas con pedido ya facturado
 *
 * Audita cuántas líneas `state ∈ {ASIG, confirmed}` siguen reservando stock
 * en pedidos que YA tienen `transferidoSAP.docEntry` matcheado contra una
 * factura SAP (es decir, la mercadería ya salió). Si > 0, hay reservas fantasma
 * que inflan el `comprometido` del `getStockRealmenteDisponible` y esconden
 * stock libre.
 *
 * Modo:
 *   node scripts/audit/A_reservas_vivas_pedido_enviado.cjs           # dry-run (default)
 *   node scripts/audit/A_reservas_vivas_pedido_enviado.cjs --prod    # ejecuta contra prod (requiere GATE HUMANO)
 *
 * Dry-run: imprime la query lógica + estrategia sin tocar red.
 * --prod: requiere `GOOGLE_APPLICATION_CREDENTIALS` o `gcloud auth application-default login` activo.
 */

const PROD = process.argv.includes('--prod');
const PROJECT = 'app-vendedores-shimano';

function logQueryLogic() {
  console.log('================================================================');
  console.log('QUERY A — Reservas vivas con pedido ya facturado en SAP');
  console.log('================================================================');
  console.log('');
  console.log('Proyecto Firestore: ' + PROJECT);
  console.log('Colección: pedidos');
  console.log('');
  console.log('Estrategia:');
  console.log('  1. Scan pedidos con transferidoSAP.docEntry != null y closedAt == null.');
  console.log('  2. Para cada pedido, iterar lines[].');
  console.log('  3. Contar lineas con:');
  console.log('     - state IN (ASIG, confirmed)');
  console.log('     - qtyOpen > 0');
  console.log('     - asigReserva != false');
  console.log('     - (ASIG) asigAt dentro del TTL 7d');
  console.log('     - (confirmed) pedido.confirmedAt dentro del TTL 7d');
  console.log('     - pedido tiene lineage transferidoSAP.docEntry en una Invoice SAP');
  console.log('       cerrada (DocumentStatus=bost_Close en SAP).');
  console.log('  4. Agregar por (sku, cardCode): sum(qtyOpen), count(lineas).');
  console.log('');
  console.log('Expected baseline: 0.');
  console.log('> 0 ⇒ reservas fantasma. Investigar por cardCode (ej. REBORN histórico).');
  console.log('');
  console.log('Side-effect: ninguno. Solo lectura.');
  console.log('');
}

async function runProd() {
  const path = require('path');
  const os = require('os');
  let admin;
  try {
    admin = require('../../functions/node_modules/firebase-admin');
  } catch (_e) {
    console.error('ERROR: firebase-admin no encontrado. Instalá con `npm install` en functions/.');
    process.exit(2);
  }
  const useAdc = !process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (useAdc) {
    try {
      admin.initializeApp({ projectId: PROJECT });
      console.log('[prod] Usando Application Default Credentials (gcloud ADC).');
    } catch (e) {
      console.error('ERROR ADC init:', e.message);
      process.exit(3);
    }
  } else {
    const saKey = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    admin.initializeApp({ credential: admin.credential.cert(require(saKey)), projectId: PROJECT });
    console.log('[prod] Usando SA key: ' + saKey);
  }
  const db = admin.firestore();

  console.log('[prod] Scanning pedidos con transferidoSAP != null...');
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log('[prod] pedidos abiertos leidos: ' + snap.size);

  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL = 7 * DAY_MS;
  const groups = new Map();
  let totalReservasVivas = 0;

  snap.forEach((doc) => {
    const p = doc.data() || {};
    const sap = p.transferidoSAP;
    if (!sap || !sap.docEntry) return;
    if (!Array.isArray(p.lines)) return;
    const confirmedAtMs = p.confirmedAt ? Date.parse(String(p.confirmedAt)) : null;
    const cc = String(p.clientCardCode || '').trim();
    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i] || {};
      const q = Number(l.qtyOpen) || 0;
      if (q <= 0) continue;
      if (l.asigReserva === false || l.asigReserva === 0) continue;
      if (!(l.state === 'ASIG' || l.state === 'confirmed')) continue;
      // TTL
      if (l.state === 'ASIG' && l.asigAt) {
        const asigAtMs = Date.parse(String(l.asigAt));
        if (Number.isFinite(asigAtMs) && (nowMs - asigAtMs) > TTL) continue;
      }
      if (l.state === 'confirmed' && confirmedAtMs && Number.isFinite(confirmedAtMs) && (nowMs - confirmedAtMs) > TTL) continue;
      totalReservasVivas++;
      const sku = String(l.code || '').toUpperCase();
      const k = sku + '|' + cc;
      const prev = groups.get(k) || { sku, cardCode: cc, lineas: 0, qty: 0, state: l.state, pedidoIds: new Set() };
      prev.lineas++;
      prev.qty += q;
      prev.pedidoIds.add(doc.id);
      groups.set(k, prev);
    }
  });

  console.log('');
  console.log('===== RESULTADO Query A =====');
  console.log('Reservas vivas (ASIG/confirmed) con pedido transferidoSAP: ' + totalReservasVivas);
  console.log('Agrupadas (sku, cardCode): ' + groups.size);
  console.log('');
  if (groups.size > 0) {
    const sorted = Array.from(groups.values()).sort((a, b) => b.qty - a.qty).slice(0, 20);
    console.log('Top 20 (ordenadas por qty descendente):');
    for (const g of sorted) {
      console.log('  ' + g.sku + ' @ ' + g.cardCode + ': ' + g.lineas + ' lineas / ' + g.qty + ' qty / ' + g.state + ' / ' + g.pedidoIds.size + ' pedidos');
    }
    console.log('');
    console.log('⚠️ Si > 0: puede haber reservas fantasma. NOTA: esto NO distingue entre');
    console.log('   confirmed/ASIG vivas legitimamente (pedido confirmed esperando SAP factura)');
    console.log('   vs. reservas que deberian haberse liberado (invoiced pero state no actualizado).');
    console.log('   Para separar: cross-check con SAP Invoice.BaseEntry == pedido.transferidoSAP.docEntry.');
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
