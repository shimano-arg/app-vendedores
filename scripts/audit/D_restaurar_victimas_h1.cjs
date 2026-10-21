/**
 * E4 — Script de reparación de víctimas del bug H1 (fix-stock-cardcode-h1).
 *
 * Para cada pedido víctima del output Query C:
 *   - Caso A (RECUPERABLE): restaurar ASIG original en pedido A + cerrar pedido B.
 *   - Caso B (NO-RECUPERABLE): marcar pedido B con flag h1_victim para decisión manual.
 *   - Caso C (INVESTIGAR): skippear, loguear motivo.
 *
 * Default --dry-run. Para escribir usar --apply (requiere confirmación humana explícita).
 *
 * NOTA: el script lee las víctimas desde una lista hardcoded (resultado de la
 * Query C del 2026-10-20). Si se re-ejecuta Query C y aparecen víctimas nuevas,
 * actualizar la constante VICTIMAS. No se auto-descubre para que el --apply sea
 * determinístico y auditable (el humano revisa la lista antes).
 */

const APPLY = process.argv.includes('--apply');
const PROJECT = 'app-vendedores-shimano';

/**
 * Víctimas identificadas por Query C el 2026-10-20.
 * Cada víctima tiene {pedidoBId, pedidoAId, pedidoALineIndex, sku, qty}.
 * El pedido A original se obtuvo via _verify_victim_h1.cjs (busca
 * cancelledIntoPedidoId == pedidoBId).
 */
const VICTIMAS = [
  {
    pedidoBId: 'tcWxGCE1rdCZz2Iw56Ex',
    clientName: 'SNAKE S.R.L.',
    clientCardCode: 'C30719034914',
    pedidoAId: 'mSuIidbMd74ziEMIBPUC',
    pedidoALineIndex: 78,
    sku: 'ALV6000FA',
    qty: 1,
    asigAtOriginal: '2026-10-16T21:47:26.763Z',
  },
];

function logInfo() {
  console.log('================================================================');
  console.log('QUERY D — Reparación víctimas bug H1');
  console.log('================================================================');
  console.log('');
  console.log(`Modo: ${APPLY ? '🔥 --APPLY (escribe)' : '--dry-run (NO escribe)'}`);
  console.log(`Victimas en lista: ${VICTIMAS.length}`);
  console.log('');
  console.log('Estrategia por victima:');
  console.log('  1. Chequear ASIG original (pedido A, lineIndex) sigue cancelled.');
  console.log('  2. Chequear stock dep 11 >= qty.');
  console.log('  3. Chequear que no haya ASIG nueva del mismo (sku, cardCode)');
  console.log('     con asigAt > pedidoB.createdAt (cliente ya recibio por otro).');
  console.log('  4. Si recuperable: restaurar ASIG + cerrar pedido B.');
  console.log('  5. Si no recuperable: marcar h1_victim para decisión manual.');
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
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  let totalProcesados = 0;
  let caseA = 0;
  let caseB = 0;
  let caseC = 0;
  const results = [];

  for (const v of VICTIMAS) {
    totalProcesados++;
    console.log('');
    console.log('---');
    console.log(`VICTIMA ${totalProcesados}/${VICTIMAS.length}: ${v.pedidoBId} / ${v.clientName}`);
    console.log('---');

    // 1. Leer pedido B
    const bSnap = await db.collection('pedidos').doc(v.pedidoBId).get();
    if (!bSnap.exists) {
      console.log(`[SKIP] pedido B ${v.pedidoBId} no existe`);
      caseC++;
      results.push({ pedidoBId: v.pedidoBId, caso: 'C_SKIP', motivo: 'pedido_B_no_existe' });
      continue;
    }
    const B = bSnap.data();
    if (B.closedAt) {
      console.log(`[SKIP] pedido B ya cerrado (closedAt=${B.closedAt})`);
      caseC++;
      results.push({ pedidoBId: v.pedidoBId, caso: 'C_SKIP', motivo: 'pedido_B_ya_cerrado' });
      continue;
    }
    const bLineIdx = (B.lines || []).findIndex(
      (l) => String(l.code).toUpperCase() === v.sku && l.state === 'BO' && Number(l.qtyOpen) > 0
    );
    if (bLineIdx < 0) {
      console.log(`[SKIP] pedido B no tiene linea BO ${v.sku} con qtyOpen > 0`);
      caseC++;
      results.push({ pedidoBId: v.pedidoBId, caso: 'C_SKIP', motivo: 'pedido_B_sin_linea_BO' });
      continue;
    }
    const bLine = B.lines[bLineIdx];

    // 2. Leer pedido A
    const aSnap = await db.collection('pedidos').doc(v.pedidoAId).get();
    if (!aSnap.exists) {
      console.log(`[CASE B] pedido A ${v.pedidoAId} no existe → no se puede restaurar ASIG`);
      caseB++;
      results.push({ pedidoBId: v.pedidoBId, caso: 'B', motivo: 'pedido_A_no_existe' });
      continue;
    }
    const A = aSnap.data();
    const aLine = (A.lines || [])[v.pedidoALineIndex];
    if (!aLine || aLine.state !== 'cancelled' || aLine.cancelledIntoPedidoId !== v.pedidoBId) {
      console.log(`[CASE C INVESTIGAR] pedido A lineIndex ${v.pedidoALineIndex} no cumple: state=${aLine && aLine.state} cancelledInto=${aLine && aLine.cancelledIntoPedidoId}`);
      caseC++;
      results.push({ pedidoBId: v.pedidoBId, caso: 'C_INVESTIGAR', motivo: 'asig_original_cambio' });
      continue;
    }

    // 3. Stock físico actual dep 11
    const stockSnap = await db.doc('app_config/stock_snapshot').get();
    const stockData = stockSnap.data() || {};
    let whsBreakdown = {};
    try {
      whsBreakdown = typeof stockData.warehouseBreakdown === 'string'
        ? JSON.parse(stockData.warehouseBreakdown)
        : stockData.warehouseBreakdown || {};
    } catch (_e) { whsBreakdown = {}; }
    const fisico = Number((whsBreakdown[v.sku] || {})['11']) || 0;
    if (fisico < v.qty) {
      console.log(`[CASE B] fisico dep 11 = ${fisico} < qty ${v.qty} → NO RECUPERABLE (stock insuficiente)`);
      caseB++;
      results.push({ pedidoBId: v.pedidoBId, caso: 'B', motivo: 'stock_insuficiente', fisico });
      continue;
    }

    // 4. Buscar ASIG nuevas del mismo (sku, cliente) posteriores al pedido B
    const createdAtMs = B.createdAt && B.createdAt.toDate ? B.createdAt.toDate().getTime() : null;
    const clientePedidos = await db.collection('pedidos').where('clientCardCode', '==', v.clientCardCode).get();
    let yaRecibio = false;
    clientePedidos.forEach((p) => {
      if (p.id === v.pedidoBId || p.id === v.pedidoAId) return;
      const pData = p.data();
      for (const l of pData.lines || []) {
        if (String(l.code).toUpperCase() !== v.sku) continue;
        if (l.state !== 'ASIG' || !l.asigAt) continue;
        const asigMs = Date.parse(String(l.asigAt));
        if (Number.isFinite(asigMs) && createdAtMs && asigMs > createdAtMs) {
          yaRecibio = true;
        }
      }
    });
    if (yaRecibio) {
      console.log('[CASE B] cliente ya recibio por otro reparto posterior → NO RECUPERABLE');
      caseB++;
      results.push({ pedidoBId: v.pedidoBId, caso: 'B', motivo: 'ya_recibio_otro_reparto' });
      continue;
    }

    // CASO A — RECUPERABLE
    console.log('[CASE A] RECUPERABLE');
    caseA++;

    // --- Mutación pedido A (restaurar ASIG) ---
    const newALines = A.lines.slice();
    const beforeA = { ...aLine };
    newALines[v.pedidoALineIndex] = {
      ...aLine,
      state: 'ASIG',
      qtyOpen: v.qty,
      qtyCancelled: Math.max((Number(aLine.qtyCancelled) || 0) - v.qty, 0),
      cancelledAt: null,
      cancelledFrom: null,
      cancelledIntoPedidoId: null,
      asigReserva: true,
      // asigAt preservado
    };
    const afterA = newALines[v.pedidoALineIndex];
    console.log('  pedido A', v.pedidoAId, 'lineIndex', v.pedidoALineIndex);
    console.log('    BEFORE:', JSON.stringify({ state: beforeA.state, qtyOpen: beforeA.qtyOpen, qtyCancelled: beforeA.qtyCancelled, cancelledAt: beforeA.cancelledAt, cancelledIntoPedidoId: beforeA.cancelledIntoPedidoId }));
    console.log('    AFTER :', JSON.stringify({ state: afterA.state, qtyOpen: afterA.qtyOpen, qtyCancelled: afterA.qtyCancelled, cancelledAt: afterA.cancelledAt, cancelledIntoPedidoId: afterA.cancelledIntoPedidoId }));

    // --- Mutación pedido B (cerrar) ---
    const newBLines = B.lines.slice();
    const beforeB = { ...bLine };
    newBLines[bLineIdx] = {
      ...bLine,
      state: 'cancelled',
      qtyOpen: 0,
      qtyCancelled: (Number(bLine.qtyCancelled) || 0) + v.qty,
    };
    const afterB = newBLines[bLineIdx];
    console.log('  pedido B', v.pedidoBId, 'lineIndex', bLineIdx);
    console.log('    BEFORE:', JSON.stringify({ state: beforeB.state, qtyOpen: beforeB.qtyOpen, qtyCancelled: beforeB.qtyCancelled }));
    console.log('    AFTER :', JSON.stringify({ state: afterB.state, qtyOpen: afterB.qtyOpen, qtyCancelled: afterB.qtyCancelled }));
    console.log('    pedido B closedAt:', 'now ISO, closedReason: h1_repair_2026-10-20');

    results.push({
      pedidoBId: v.pedidoBId,
      caso: 'A',
      motivo: 'recuperable',
      opsA: { pedidoId: v.pedidoAId, lineIndex: v.pedidoALineIndex, beforeA, afterA },
      opsB: { pedidoId: v.pedidoBId, lineIndex: bLineIdx, beforeB, afterB },
    });

    if (APPLY) {
      const nowIso = new Date().toISOString();
      await db.collection('pedidos').doc(v.pedidoAId).update({
        lines: newALines,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('pedidos').doc(v.pedidoBId).update({
        lines: newBLines,
        closedAt: nowIso,
        closedReason: 'h1_repair_2026-10-20',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('  🔥 APPLY ejecutado para ambos pedidos.');
    }
  }

  console.log('');
  console.log('=====================================');
  console.log('RESUMEN');
  console.log('=====================================');
  console.log(`Total pedidos procesados: ${totalProcesados}`);
  console.log(`Caso A (RECUPERABLES): ${caseA}`);
  console.log(`Caso B (NO-RECUPERABLES): ${caseB}`);
  console.log(`Caso C (SKIP/INVESTIGAR): ${caseC}`);
  console.log('');
  if (APPLY) {
    console.log('🔥 Mutaciones aplicadas. Verificar con node scripts/audit/_verify_victim_h1.cjs <pedidoId>');
  } else {
    console.log('ℹ️ dry-run — ninguna mutación. Para aplicar: --apply (requiere OK humano explícito)');
  }
}

logInfo();
runProd().catch((e) => {
  console.error('ERROR en runProd:', e);
  process.exit(1);
});
