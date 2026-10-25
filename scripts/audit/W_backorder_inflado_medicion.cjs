#!/usr/bin/env node
// @ts-check
/*
 * ================================================================
 * SOLO MEDICION - fix frenado hasta OK Mariano
 * ================================================================
 *
 * Script esqueleto para dimensionar el "backorder inflado" en prod.
 * Describe las queries + metricas sin ejecutarlas contra Firestore
 * cuando corre en modo --describe (default). Permite --preview para
 * ejecutar en modo read-only STRICT (no muta nada).
 *
 * NO tiene --apply implementado. NO modifica Firestore.
 *
 * Plan asociado:
 *   docs/plans/2026-10-25-backorder-inflado-analisis.md
 *
 * Prompt origen: Mariano 2026-10-25.
 *   "Mapear puntos de inflacion + script read-only para dimensionar."
 *
 * Reglas aplicadas:
 *   - CLAUDE.md §31: auditoria != correccion. No tocar src/, functions/,
 *     index.html, rules. Solo doc + script esqueleto.
 *   - CLAUDE.md §39: toda disponibilidad de stock pasa por
 *     getStockBreakdown. El script lo reusa, no reimplementa.
 *   - CLAUDE.md §55: si en el futuro se agrega --apply, DEBE guardar
 *     snapshot `_backfill` por doc modificado.
 *
 * Uso (futuro, con OK Mariano):
 *   node scripts/audit/W_backorder_inflado_medicion.cjs                  # describe queries (default)
 *   node scripts/audit/W_backorder_inflado_medicion.cjs --preview        # read-only prod
 *   node scripts/audit/W_backorder_inflado_medicion.cjs --preview --top=20
 *
 * NO soporta --apply. Si se intenta, el script sale con exit=2.
 */

'use strict';

const PROJECT_ID = 'app-vendedores-shimano';

// ================================================================
// 1. Argumentos
// ================================================================

const argv = process.argv.slice(2);

if (argv.includes('--apply')) {
  console.error('[W] ERROR: --apply NO esta implementado.');
  console.error('[W] Este script es solo MEDICION. El fix esta frenado');
  console.error('[W] hasta OK Mariano sobre el plan en');
  console.error('[W]   docs/plans/2026-10-25-backorder-inflado-analisis.md');
  process.exit(2);
}

const MODE_DESCRIBE = !argv.includes('--preview'); // default: describe
const TOP_N = (() => {
  const flag = argv.find((a) => a.startsWith('--top='));
  if (!flag) return 25;
  const n = Number.parseInt(flag.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 25;
})();

const nowIso = new Date().toISOString();

// ================================================================
// 2. Documentacion de las queries (SIEMPRE se imprime)
// ================================================================

function printQueryPlan() {
  console.log('================================================================');
  console.log('W - Backorder inflado: plan de medicion @ ' + nowIso);
  console.log('================================================================');
  console.log('');
  console.log('Modo: ' + (MODE_DESCRIBE ? 'DESCRIBE (sin red)' : 'PREVIEW (read-only prod)'));
  console.log('Top-N: ' + TOP_N);
  console.log('');
  console.log('Fuentes:');
  console.log('  - collection("pedidos").where("closedAt","==",null)');
  console.log('    + filter inline: NOT transferidoSAP.docNum');
  console.log('  - collection("revision_waitlist").where("closedAt","==",null)');
  console.log('    + filter inline: stage != "consumed"');
  console.log('  - functions/core/pedido-snapshot-core.js::getStockBreakdown');
  console.log('    (reutilizar, §39)');
  console.log('');
  console.log('Metricas:');
  console.log('  M1 - pares cliente+SKU con BO en >1 linea u >1 orden');
  console.log('       shape output: cardCode, clientName, sku, n_orders, n_lines,');
  console.log('                     qty_total_bo, qty_max, antiguedad_oldest, antiguedad_newest');
  console.log('  M2 - pares con BO vigente + envio SAP posterior del mismo par');
  console.log('       (candidatos a "BO fantasma post-envio" - cuantifica S1/S2)');
  console.log('  M3 - top SKUs con backorderApp.total >> fisicoDep11');
  console.log('       (via getStockBreakdown)');
  console.log('  M4 - BO con createdAt > 90d (candidatos cleanup §37)');
  console.log('  M5 - clientes con >1 waitlist abierta + >0 pedido-BO abierto');
  console.log('       (extiende P_clientes_multiple_waitlists.cjs)');
  console.log('  M6 - orden con ASIG + BO vivos para mismo SKU (sobre-asig persistente §40.11)');
  console.log('  M7 - resumen agregado:');
  console.log('       total pares con BO + unidades + % inflacion estimada');
  console.log('');
  console.log('Query logica (pseudo-SQL, Firestore no lo ejecuta tal cual):');
  console.log('');
  console.log('  -- M1: pares con BO en >1 linea u >1 orden');
  console.log('  SELECT cardCode, sku,');
  console.log('         COUNT(DISTINCT pedidoId)    as n_orders,');
  console.log('         COUNT(*)                    as n_lines,');
  console.log('         SUM(qtyOpen)                as qty_total,');
  console.log('         MAX(qtyOpen)                as qty_max,');
  console.log('         MIN(pedido.createdAt)       as oldest,');
  console.log('         MAX(pedido.createdAt)       as newest');
  console.log('  FROM pedidos p JOIN p.lines l');
  console.log('  WHERE p.closedAt IS NULL');
  console.log('    AND l.state = "BO"');
  console.log('    AND l.qtyOpen > 0');
  console.log('  GROUP BY cardCode, sku');
  console.log('  HAVING COUNT(DISTINCT pedidoId) > 1 OR COUNT(*) > 1');
  console.log('  ORDER BY qty_total DESC');
  console.log('  LIMIT ' + TOP_N + ';');
  console.log('');
  console.log('  -- M2: BO vigente + envio SAP posterior');
  console.log('  Para cada par (cardCode, sku) de M1:');
  console.log('    buscar pedidos del mismo par con');
  console.log('      state in ("invoiced", "confirmed")');
  console.log('      AND transferidoSAP.docNum != null');
  console.log('      AND confirmedAt > bo_order.createdAt');
  console.log('');
  console.log('  -- M3: top SKUs backorderApp.total');
  console.log('  Para cada SKU del catalogo (o filtrar top-50 con BO):');
  console.log('    const b = getStockBreakdown(sku, deps);');
  console.log('    emit if b.backorderApp.total > b.fisicoDep11 * 1.2 (threshold conservador);');
  console.log('');
  console.log('Output:');
  console.log('  stdout: resumen por consola.');
  console.log('  markdown: docs/auditoria/35_BO_INFLADO_MEDICION.md');
  console.log('');
  console.log('Edge cases (ver §4 del plan):');
  console.log('  - cardCode vacio (prospecto): agrupar por clientName.');
  console.log('  - qtyOpen==0 pero state="BO": filtrar (no es demanda viva).');
  console.log('  - items[] en revision_waitlist (shape distinto a pedido.lines).');
  console.log('  - pedidos "generar backorder" (tipo=backorder): incluir pero marcar.');
  console.log('  - pedidos pre-§56 (<2026-10-24): pueden tener BO duplicado en 1 orden.');
  console.log('  - pedidos sync-SAP: ignorar.');
  console.log('');
}

// ================================================================
// 3. Modo DESCRIBE: imprimir y salir
// ================================================================

if (MODE_DESCRIBE) {
  printQueryPlan();
  console.log('[W] Modo DESCRIBE: no se conecta a Firestore.');
  console.log('[W] Para ejecutar read-only contra prod, pasar --preview.');
  console.log('[W] IMPORTANTE: ejecucion contra prod requiere OK Mariano explicito.');
  process.exit(0);
}

// ================================================================
// 4. Modo PREVIEW (read-only prod) - solo esqueleto, no implementado
// ================================================================

(async function main() {
  printQueryPlan();
  console.log('');
  console.log('[W] ================================================================');
  console.log('[W] MODO --preview: implementacion pendiente.');
  console.log('[W] ================================================================');
  console.log('');
  console.log('[W] Este bloque esta vacio a proposito. Correr en --preview requiere:');
  console.log('[W]   1. OK Mariano para el acceso de lectura a prod.');
  console.log('[W]   2. Carga de firebase-admin + ADC/service-account.');
  console.log('[W]   3. Implementacion de las 7 metricas descritas arriba.');
  console.log('[W]');
  console.log('[W] Snippet template (NO HABILITAR SIN AUTORIZACION):');
  console.log('[W]');
  console.log('[W]   const admin = require("../../functions/node_modules/firebase-admin");');
  console.log('[W]   if (!admin.apps.length) admin.initializeApp({ projectId: "' + PROJECT_ID + '" });');
  console.log('[W]   const db = admin.firestore();');
  console.log('[W]   const pedidosSnap = await db.collection("pedidos")');
  console.log('[W]     .where("closedAt", "==", null).get();');
  console.log('[W]   // ... iterar lineas, agrupar por cardCode|sku, construir M1-M7.');
  console.log('[W]   // ... emitir stdout + escribir docs/auditoria/35_BO_INFLADO_MEDICION.md.');
  console.log('[W]');
  console.log('[W] Para habilitar: desbloquear el bloque PREVIEW completando el TODO.');
  console.log('[W] SIN AUTORIZACION: no implementar.');
  console.log('[W]');
  console.log('[W] Salida sin ejecutar nada contra prod.');
  process.exit(0);
})().catch((e) => {
  console.error('[W] Error en modo preview:', e && e.message ? e.message : String(e));
  process.exit(1);
});
