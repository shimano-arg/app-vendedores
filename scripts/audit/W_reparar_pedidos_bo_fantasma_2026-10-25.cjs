#!/usr/bin/env node
// @ts-check
/**
 * INCIDENTE 2026-10-23 17:52 ART (reportado 2026-10-25) — reparación de
 * pedidos que quedaron en BO completo por bug de lectura del snapshot
 * en commitPedidoCF.
 *
 * ROOT CAUSE (ya fixeado en código v1448):
 *   functions/core/commit-pedido-core.js leía warehouseBreakdown esperando
 *   dict, pero Python escribe JSON string → fisico=0 → qtyBO=cantidad →
 *   TODO va a BO + transferidoSAP.via='app_only' + reason='all_lines_bo_server_detected'.
 *
 * VÍCTIMAS confirmadas (query directa 2026-10-25):
 *   - BROBRO SA (jwKRy9cgCRWnB4CajjlG, 23/10 17:52, 87 lines, origen cpst)
 *   - GUSTAVO EMILIO DESIATA (r9SnOcNpFiObB5FXYNhm, 23/10 19:07, 5 lines)
 *   - EDUARDO SATO DUPLICADO (qlB4FpI3R9Rhu5sLZvbf 19:08:43 + 6LhigQdzUmEcOHcRUEjl 19:08:41)
 *   - MARCELO DANIEL BOSCHETTO (23/10 15:43, 13 lines, Santiago)
 *   - LUCAS MAXIMILIANO BAIGORRIA (24/10 13:25, 40 lines, Federico)
 *   - LA LOMITA OUTDOORS SRL (25/10 05:02 cpst + 05:03 manual, 35 + 41 lines, Federico)
 *
 * Query de descubrimiento (filter server-side):
 *   type='commit_pedido_rejected' NO (no todos loguearon).
 *   Pedidos: transferidoSAP.via='app_only' + confirmedAt >= 2026-10-23T17:52
 *   + _commitVersion='commitPedidoCore_v1'.
 *
 * REPARACIÓN
 * Para cada pedido afectado:
 *   1. Lee las líneas (todas state='BO' con qtyOpen>0).
 *   2. Lee el snapshot ACTUAL (post-fix).
 *   3. Recomputa para cada SKU: fisicoDep11 - reservadasYaPreviasDe otros pedidos
 *      actuales (NO del propio pedido afectado — vamos a mutarlo).
 *   4. Decide: qtyConfirmed = min(qty, libre); qtyBO = qty - qtyConfirmed.
 *   5. En dry-run: imprime tabla pedido × SKU: antes BO=N → después qtyConfirmed=X qtyBO=Y.
 *   6. Con --apply: muta las líneas (split BO en confirmed + BO si corresponde),
 *      limpia transferidoSAP.via='app_only' + reason, guarda snapshot anterior
 *      en _backfill (§55).
 *
 * NO ENVÍA A SAP automáticamente. Después del apply, los pedidos quedan como si
 * se hubieran confirmado hoy con el fix: `syncSapOrdersToApp` / el flow manual
 * de admin desde "Enviar a SAP" los procesa normal.
 *
 * Uso:
 *   node scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs            # dry-run
 *   node scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs --apply   # SOLO con OK Mariano
 *   node scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs --pedido=jwKRy...   # un solo pedido
 */

const admin = require('../../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

// Nota: originalmente filtrábamos confirmedAt >= 17:52 ART del 23/10, pero
// BOSCHETTO (23/10 15:43 ART = 18:43 UTC) también está afectado. El
// `reason='all_lines_bo_server_detected'` ES único del bug: solo se setea
// cuando CF decide qtyBO=cantidad_pedida para TODAS las líneas. Es filtro
// suficiente. INCIDENT_START queda documentado abajo pero no se aplica.
const INCIDENT_START = new Date('2026-10-23T18:00:00Z'); // 15:00 ART — early margin

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const pedidoFilterArg = args.find((a) => a.startsWith('--pedido='));
  const pedidoFilter = pedidoFilterArg ? pedidoFilterArg.split('=')[1] : null;

  console.log(`\n[W] Reparación pedidos BO fantasma — ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[W] Rango: desde ${INCIDENT_START.toISOString()}`);
  if (pedidoFilter) console.log(`[W] Filtro pedidoId: ${pedidoFilter}`);
  console.log('');

  // 1. Buscar pedidos con transferidoSAP.via='app_only' confirmados post-incidente.
  console.log('[W] Buscando pedidos afectados...');
  const snap = await db
    .collection('pedidos')
    .where('_commitVersion', '==', 'commitPedidoCore_v1')
    .get();
  const afectados = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    if (pedidoFilter && d.id !== pedidoFilter) return;
    const transferido = data.transferidoSAP || {};
    if (transferido.via !== 'app_only') return;
    const reason = transferido.reason || data.closedReason || '';
    if (reason !== 'all_lines_bo_server_detected') return;
    // Confirmado DESPUÉS del incidente.
    const confirmedAt =
      data.confirmedAt && typeof data.confirmedAt.toMillis === 'function'
        ? new Date(data.confirmedAt.toMillis())
        : data.confirmedAt instanceof Date
          ? data.confirmedAt
          : null;
    if (!confirmedAt || confirmedAt < INCIDENT_START) return;
    afectados.push({ id: d.id, data, confirmedAt });
  });
  afectados.sort((a, b) => a.confirmedAt - b.confirmedAt);
  console.log(`[W] Encontrados: ${afectados.length} pedidos afectados.`);
  if (afectados.length === 0) {
    console.log('[W] Nada que reparar.');
    return;
  }

  // 2. Leer snapshot actual (post-fix) para computar reparación.
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const stockData = stockSnap.exists ? stockSnap.data() || {} : {};
  let warehouseBreakdown = {};
  const rawWhsBd = stockData.warehouseBreakdown;
  if (typeof rawWhsBd === 'string') {
    try {
      warehouseBreakdown = JSON.parse(rawWhsBd);
    } catch (e) {
      console.error('[W] CRITICAL: warehouseBreakdown no parsea:', e.message);
      process.exit(1);
    }
  } else if (typeof rawWhsBd === 'object') {
    warehouseBreakdown = rawWhsBd;
  }
  console.log(
    `[W] Snapshot leído. source=${stockData.source}, SKUs=${Object.keys(warehouseBreakdown).length}`
  );

  // 3. Leer TODOS los pedidos abiertos (excluyendo los afectados) para
  //    recalcular reservadas por SKU (igual que commitPedidoCore).
  console.log('[W] Leyendo pedidos abiertos (para reservadas)...');
  const abiertosSnap = await db
    .collection('pedidos')
    .where('closedAt', '==', null)
    .get();
  const reservadasPorSku = {}; // {sku: {total, byAfectado}}
  const afectadosIds = new Set(afectados.map((a) => a.id));
  abiertosSnap.forEach((d) => {
    const data = d.data() || {};
    for (const line of data.lines || []) {
      if (!line || !line.code) continue;
      const sku = String(line.code).toUpperCase();
      const qtyOpen = Number(line.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      // Estados que reservan físico (patrón §39/§40):
      //   state=confirmed sin TTL vencido (asumimos todos vigentes para simplificar)
      //   state=ASIG vigente
      // NO: state=BO (§40 BO no reserva).
      if (line.state !== 'confirmed' && line.state !== 'ASIG') continue;
      // IMPORTANTE: NO contar las reservas del pedido afectado — las vamos
      // a reemplazar. Si el pedido afectado tiene líneas BO (todas), ninguna
      // reserva (BO no reserva, §40). OK: no hay que excluir nada.
      if (afectadosIds.has(d.id)) continue;
      if (!reservadasPorSku[sku]) reservadasPorSku[sku] = 0;
      reservadasPorSku[sku] += qtyOpen;
    }
  });

  // 4. Para cada pedido afectado, computar reparación.
  console.log('\n[W] Plan de reparación:\n');
  const reparaciones = [];
  for (const pedido of afectados) {
    const { id, data, confirmedAt } = pedido;
    const cliente = data.clientName || '?';
    const cardCode = data.clientCardCode || '?';
    const vendor = data.vendorAssigned || data.ownerVendor || data.cargadoPorEmail || '?';
    console.log(
      `\n--- Pedido ${id.substring(0, 10)}... | ${confirmedAt.toISOString()} | ${cliente} (${cardCode}) | vendor=${vendor} ---`
    );
    const linesOut = [];
    const planLineas = [];
    let totalConfirmedUnidades = 0;
    let totalBoUnidades = 0;
    for (let i = 0; i < (data.lines || []).length; i++) {
      const line = data.lines[i];
      if (!line || !line.code) {
        linesOut.push(line);
        continue;
      }
      const sku = String(line.code).toUpperCase();
      const qty = Number(line.qty) || 0;
      const esBoFantasma = line.state === 'BO' && Number(line.qtyOpen) > 0;
      if (!esBoFantasma) {
        linesOut.push(line);
        continue;
      }
      // Recomputar: libre_hoy = fisicoDep11 - reservadasPorSku[sku].
      const fisico = Number((warehouseBreakdown[sku] || {})[11] || 0);
      const yaReservado = reservadasPorSku[sku] || 0;
      const libreHoy = Math.max(fisico - yaReservado, 0);
      const qtyConfirmed = Math.min(qty, libreHoy);
      const qtyBO = qty - qtyConfirmed;
      // "Consumir" el libre: incrementar reservadasPorSku para los siguientes SKUs.
      reservadasPorSku[sku] = yaReservado + qtyConfirmed;
      const precio = Number(line.precio) || 0;
      planLineas.push({
        sku,
        qtyPedida: qty,
        fisicoHoy: fisico,
        yaReservado,
        libreHoy,
        qtyConfirmed,
        qtyBO,
      });
      totalConfirmedUnidades += qtyConfirmed;
      totalBoUnidades += qtyBO;
      // Construir las nuevas líneas (split confirmed + BO si corresponde).
      if (qtyConfirmed > 0) {
        linesOut.push({
          ...line,
          qty: qtyConfirmed,
          qtyOpen: qtyConfirmed,
          state: 'confirmed',
          // Marcar que viene de reparación W (§55).
          _repairedFrom: 'W_reparar_pedidos_bo_fantasma_2026-10-25',
        });
      }
      if (qtyBO > 0) {
        linesOut.push({
          ...line,
          qty: qtyBO,
          qtyOpen: qtyBO,
          state: 'BO',
          _repairedFrom: 'W_reparar_pedidos_bo_fantasma_2026-10-25',
        });
      }
    }
    console.log(
      `  Líneas: ${planLineas.length} a reparar. Confirmed=${totalConfirmedUnidades}u, BO=${totalBoUnidades}u.`
    );
    // Imprimir solo las primeras 10 líneas por legibilidad.
    const topLineas = planLineas.slice(0, 10);
    for (const p of topLineas) {
      console.log(
        `    ${p.sku.padEnd(18)}  qty=${String(p.qtyPedida).padStart(3)}  fisico=${String(p.fisicoHoy).padStart(3)}  resAjenas=${String(p.yaReservado).padStart(3)}  libre=${String(p.libreHoy).padStart(3)}  →  confirmed=${String(p.qtyConfirmed).padStart(3)}  BO=${String(p.qtyBO).padStart(3)}`
      );
    }
    if (planLineas.length > 10) console.log(`    ... ${planLineas.length - 10} líneas más`);
    reparaciones.push({ id, cliente, cardCode, confirmedAt, linesOut, planLineas, totalConfirmedUnidades, totalBoUnidades });
  }

  // 5. Resumen agregado.
  console.log('\n' + '='.repeat(80));
  console.log('[W] RESUMEN DE REPARACIÓN');
  console.log('='.repeat(80));
  console.log(
    `${'Pedido'.padEnd(18)} ${'Cliente'.padEnd(25)} ${'Confirmed'.padStart(10)} ${'BO'.padStart(8)}`
  );
  console.log('-'.repeat(80));
  let totalConfirmed = 0;
  let totalBo = 0;
  for (const r of reparaciones) {
    console.log(
      `${r.id.substring(0, 16).padEnd(18)} ${r.cliente.substring(0, 24).padEnd(25)} ${String(r.totalConfirmedUnidades).padStart(10)} ${String(r.totalBoUnidades).padStart(8)}`
    );
    totalConfirmed += r.totalConfirmedUnidades;
    totalBo += r.totalBoUnidades;
  }
  console.log('-'.repeat(80));
  console.log(
    `${'TOTAL'.padEnd(44)} ${String(totalConfirmed).padStart(10)} ${String(totalBo).padStart(8)}`
  );

  // 6. Apply (solo con flag).
  if (!apply) {
    console.log('\n[W] DRY-RUN. Para aplicar, correr con --apply (requiere OK Mariano).');
    return;
  }

  console.log('\n[W] APPLY. Mutando pedidos...');
  for (const r of reparaciones) {
    const ref = db.collection('pedidos').doc(r.id);
    const snapshotPrevio = {};
    const originalData = (afectados.find((a) => a.id === r.id) || {}).data || {};
    // Snapshot §55: valor anterior.
    snapshotPrevio.lines = originalData.lines;
    snapshotPrevio.transferidoSAP = originalData.transferidoSAP || null;
    snapshotPrevio.closedReason = originalData.closedReason || null;
    await ref.update({
      lines: r.linesOut,
      // Limpiar transferidoSAP para que el flow normal re-detecte.
      transferidoSAP: null,
      // closedReason tampoco debe estar; el pedido vuelve a estado activo
      // esperando "Enviar a SAP" manual.
      closedReason: null,
      _backfill: {
        [`W_bo_fantasma_${new Date().toISOString().slice(0, 10)}`]: {
          previousValues: snapshotPrevio,
          by: 'scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs',
          at: new Date().toISOString(),
          reason: 'Reparación incidente lectura snapshot JSON string',
          totalConfirmedUnidades: r.totalConfirmedUnidades,
          totalBoUnidades: r.totalBoUnidades,
        },
      },
      _lastBackfillAt: new Date().toISOString(),
      _lastBackfillBy: 'scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs',
    });
    console.log(`  ✓ Reparado ${r.id.substring(0, 10)}... (${r.cliente})`);
  }
  console.log(`\n[W] APPLY OK: ${reparaciones.length} pedidos reparados.`);
}

main().catch((e) => {
  console.error('[W] ERROR:', e);
  process.exit(1);
});
