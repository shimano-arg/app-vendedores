#!/usr/bin/env node
// @ts-check
/*
 * ================================================================
 * S — DRY-RUN de fusion por SKU con REGLA NUEVA (plan #1206)
 * ================================================================
 *
 * Reescrito 2026-10-25 (tarea K cierre total).
 *
 * REGLA NUEVA DE FUSION:
 *   Para pares (cliente, SKU) con BO repartido en 2+ ordenes:
 *     qty_fusion = max(qty_orden_mas_nueva, qty_asignada_del_cliente)
 *
 *   RATIONALE: "cantidad declarada reemplaza, no suma" (plan #1206).
 *   La demanda real es la del input mas reciente del VDE. Pero si el
 *   cliente ya tiene ASIG vigente (reparto hecho por Pablo), ese piso
 *   NO se puede bajar — representa stock fisico ya comprometido.
 *
 * REGLA VIEJA (v1435 §56, intra-orden):
 *     qty_fusion = sum(qtys) de todas las lineas del SKU en la orden
 *
 *   La vieja regla sigue vigente para dedupe INTRA-orden (§56). La
 *   nueva regla aplica a fusion INTER-orden (misma pareja cliente+SKU
 *   en ordenes distintas) — caso tipico Mariano "Excel re-cargado".
 *
 * NO tiene --apply. Dry-run only. Si Mariano autoriza aparte, agregar
 * --apply con snapshot `_backfill` (CLAUDE.md §55).
 *
 * Uso:
 *   node scripts/audit/S_dry_run_fusion_duplicados.cjs
 */

'use strict';

const PROJECT = 'app-vendedores-shimano';

const argv = process.argv.slice(2);
if (argv.includes('--apply')) {
  console.error('[S] ERROR: --apply NO esta implementado.');
  console.error('[S] Este script es dry-run only. Ver plan en');
  console.error('[S]   docs/plans/2026-10-25-backorder-inflado-analisis.md');
  console.error('[S] Si Mariano autoriza, agregar bloque --apply con snapshot _backfill §55.');
  process.exit(2);
}

/** @param {any} t */
function tsToMs(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') { try { return t.toMillis(); } catch (_e) { return 0; } }
  if (typeof t.toDate === 'function') { try { return t.toDate().getTime(); } catch (_e) { return 0; } }
  if (typeof t === 'string') { const n = Date.parse(t); return Number.isNaN(n) ? 0 : n; }
  return 0;
}

/** @param {any} v */
function tdMd(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  const fs = require('node:fs');
  const path = require('node:path');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('S DRY-RUN — Fusion por SKU REGLA NUEVA @ ' + nowIso);
  console.log('================================================================');
  console.log('');
  console.log('Regla:   qty_fusion = max(qty_orden_mas_nueva, qty_asignada)');
  console.log('(NO sumar; "cantidad declarada reemplaza" + piso ASIG).');
  console.log('');

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<any>} */
  const pedidos = [];
  pedidosSnap.forEach((d) => pedidos.push(Object.assign({ _fsId: d.id }, d.data())));
  console.log('[S] Pedidos abiertos: ' + pedidos.length);

  // 1. Agrupar lineas BO vivas por (cardCode|sku) + ASIG como piso.
  /** @type {Map<string, {cardCode:string, clientName:string, sku:string, boLines:Array<{pedidoId:string, orderNumber:string, lineIndex:number, qtyOpen:number, qty:number, createdAtMs:number}>}>} */
  const paresBo = new Map();
  /** @type {Map<string, number>} */
  const asigPorPar = new Map();

  for (const p of pedidos) {
    if (!p || !Array.isArray(p.lines)) continue;
    if (p.source === 'sync-sap') continue;
    const cardCode = String(p.clientCardCode || '').trim();
    const clientName = String(p.clientName || '').trim();
    const client = cardCode || ('name:' + clientName);
    const createdMs = tsToMs(p.createdAt);
    const lines = p.lines;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const sku = String(l.code).toUpperCase().trim();
      const key = client + '|' + sku;
      if (l.state === 'BO') {
        const row = paresBo.get(key) || { cardCode, clientName, sku, boLines: [] };
        row.boLines.push({
          pedidoId: p._fsId,
          orderNumber: String(p.orderNumber || ''),
          lineIndex: i,
          qtyOpen: qo,
          qty: Number(l.qty) || qo,
          createdAtMs: createdMs,
        });
        paresBo.set(key, row);
      } else if (l.state === 'ASIG') {
        asigPorPar.set(key, (asigPorPar.get(key) || 0) + qo);
      }
    }
  }

  // 2. Filtrar candidatos: pares con BO en 2+ ordenes.
  /** @type {Array<{cardCode:string, clientName:string, sku:string, boLines:Array<any>, qtyAsignada:number, qtyOrdenMasNueva:number, qtyActualTotal:number, qtyFusionNueva:number, qtyFusionVieja:number, deltaNueva:number, deltaVieja:number, ordenTargetId:string, ordenTargetNumber:string}>} */
  const candidatos = [];
  for (const [key, row] of paresBo) {
    const uniqOrders = new Set(row.boLines.map((l) => l.pedidoId));
    if (uniqOrders.size < 2) continue;
    row.boLines.sort((a, b) => b.createdAtMs - a.createdAtMs);
    const masNueva = row.boLines[0];
    const qtyOrdenMasNueva = row.boLines
      .filter((l) => l.pedidoId === masNueva.pedidoId)
      .reduce((s, l) => s + l.qtyOpen, 0);
    const qtyAsignada = asigPorPar.get(key) || 0;
    const qtyActualTotal = row.boLines.reduce((s, l) => s + l.qtyOpen, 0);
    const qtyFusionVieja = qtyActualTotal;
    const qtyFusionNueva = Math.max(qtyOrdenMasNueva, qtyAsignada);
    candidatos.push({
      cardCode: row.cardCode,
      clientName: row.clientName,
      sku: row.sku,
      boLines: row.boLines,
      qtyAsignada,
      qtyOrdenMasNueva,
      qtyActualTotal,
      qtyFusionNueva,
      qtyFusionVieja,
      deltaNueva: qtyActualTotal - qtyFusionNueva,
      deltaVieja: qtyActualTotal - qtyFusionVieja,
      ordenTargetId: masNueva.pedidoId,
      ordenTargetNumber: masNueva.orderNumber,
    });
  }
  candidatos.sort((a, b) => b.deltaNueva - a.deltaNueva);

  // 3. Totales.
  const totalCandidatos = candidatos.length;
  const totalLineasAfectadas = candidatos.reduce((s, c) => s + c.boLines.length, 0);
  const totalOrdenesAfectadas = new Set(candidatos.flatMap((c) => c.boLines.map((l) => l.pedidoId))).size;
  const totalUnidadesActuales = candidatos.reduce((s, c) => s + c.qtyActualTotal, 0);
  const totalUnidadesPostFusion = candidatos.reduce((s, c) => s + c.qtyFusionNueva, 0);
  const totalUnidadesReducidas = totalUnidadesActuales - totalUnidadesPostFusion;
  const casosConAsigPiso = candidatos.filter((c) => c.qtyAsignada > 0 && c.qtyAsignada > c.qtyOrdenMasNueva).length;
  const casosDondeNuevaIgualVieja = candidatos.filter((c) => c.qtyFusionNueva === c.qtyFusionVieja).length;

  console.log('================================================================');
  console.log('RESUMEN');
  console.log('================================================================');
  console.log('Pares candidatos a fusion inter-orden:   ' + totalCandidatos);
  console.log('Lineas BO totales a fusionar:             ' + totalLineasAfectadas);
  console.log('Ordenes afectadas (distintas):            ' + totalOrdenesAfectadas);
  console.log('');
  console.log('Unidades BO actuales (suma de lineas):    ' + totalUnidadesActuales);
  console.log('Unidades POST FUSION regla nueva:         ' + totalUnidadesPostFusion);
  console.log('Unidades reducidas (regla nueva):         ' + totalUnidadesReducidas);
  console.log('');
  console.log('Casos donde ASIG es el piso (max):        ' + casosConAsigPiso);
  console.log('Casos donde regla nueva == regla vieja:   ' + casosDondeNuevaIgualVieja);
  console.log('  (= la orden mas nueva ya contenia todo o ya habia 1 sola linea)');
  console.log('');

  // 5. Markdown.
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, '46_S_DRY_RUN_FUSION_NUEVA_REGLA_2026-10-25.md');

  const lines = [];
  lines.push('# S — Dry-run fusion duplicados REGLA NUEVA @ ' + nowIso);
  lines.push('');
  lines.push('**Script:** `scripts/audit/S_dry_run_fusion_duplicados.cjs` (dry-run only, no --apply).');
  lines.push('');
  lines.push('**Plan asociado:** `docs/plans/2026-10-25-backorder-inflado-analisis.md` (#1206).');
  lines.push('');
  lines.push('## Regla nueva vs vieja');
  lines.push('');
  lines.push('| Regla | Formula | Semantica |');
  lines.push('|---|---|---|');
  lines.push('| **VIEJA (v1435 §56)** | `qty_fusion = sum(qtys)` | Suma todas las lineas del SKU |');
  lines.push('| **NUEVA (este script)** | `qty_fusion = max(qty_orden_mas_nueva, qty_asignada)` | La orden mas reciente declara la demanda; ASIG propia es piso irreducible |');
  lines.push('');
  lines.push('La regla vieja sigue vigente para **intra-orden** (`mergeLinesFromOrders` dentro de una sola orden). La regla nueva aplica a **inter-orden** (misma pareja cliente+SKU repartida en 2+ ordenes).');
  lines.push('');
  lines.push('**Por que ASIG es piso**: una linea ASIG viva significa que Pablo repartio stock fisico para ese cliente+SKU. Bajar la fusion por debajo de la ASIG dejaria unidades asignadas sin cobertura en el BO declarado. Si qty_orden_mas_nueva < qty_asignada, la fusion mantiene el nivel de la ASIG.');
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('| Metrica | Valor |');
  lines.push('|---|---:|');
  lines.push('| Pares candidatos a fusion inter-orden | ' + totalCandidatos + ' |');
  lines.push('| Lineas BO totales a fusionar | ' + totalLineasAfectadas + ' |');
  lines.push('| Ordenes afectadas (distintas) | ' + totalOrdenesAfectadas + ' |');
  lines.push('| Unidades BO actuales (suma de lineas) | ' + totalUnidadesActuales + ' |');
  lines.push('| Unidades post-fusion regla nueva | ' + totalUnidadesPostFusion + ' |');
  lines.push('| Unidades reducidas (regla nueva) | ' + totalUnidadesReducidas + ' |');
  lines.push('| Casos donde ASIG es el piso | ' + casosConAsigPiso + ' |');
  lines.push('| Casos regla nueva == regla vieja | ' + casosDondeNuevaIgualVieja + ' |');
  lines.push('');
  lines.push('## Comparacion de reglas por caso');
  lines.push('');
  lines.push('Mostrando los top 50 candidatos ordenados por `delta_regla_nueva` desc.');
  lines.push('');
  if (candidatos.length === 0) {
    lines.push('_No hay pares con BO repartido en 2+ ordenes. Nada que fusionar._');
  } else {
    lines.push('| cardCode | clientName | sku | n_lines | qty_actual | qty_orden_nueva | qty_asig | qty_regla_nueva | qty_regla_vieja | reduccion_nueva |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const c of candidatos.slice(0, 50)) {
      lines.push('| ' + tdMd(c.cardCode || '-') +
        ' | ' + tdMd(c.clientName || '-') +
        ' | ' + tdMd(c.sku) +
        ' | ' + c.boLines.length +
        ' | ' + c.qtyActualTotal +
        ' | ' + c.qtyOrdenMasNueva +
        ' | ' + c.qtyAsignada +
        ' | ' + c.qtyFusionNueva +
        ' | ' + c.qtyFusionVieja +
        ' | ' + c.deltaNueva +
        ' |');
    }
  }
  lines.push('');
  lines.push('## Interpretacion');
  lines.push('');
  lines.push('- **qty_regla_nueva < qty_regla_vieja** en TODOS los casos donde la orden nueva declaro menos que la suma. Intencional: la demanda real es la del ultimo input.');
  lines.push('- **qty_regla_nueva > qty_regla_vieja** NUNCA ocurre: `max(a, b) <= a + b` por construccion cuando `a, b >= 0`.');
  lines.push('- **qty_regla_nueva == qty_regla_vieja** en los ' + casosDondeNuevaIgualVieja + ' casos donde la orden mas nueva ya contenia toda la demanda (o solo hay 1 linea por orden). Sin beneficio ni perjuicio ahi.');
  lines.push('- **Casos con ASIG piso** (' + casosConAsigPiso + '): la regla nueva usa la ASIG como minimo. Protege stock ya asignado por Pablo.');
  lines.push('');
  lines.push('## Si se autoriza --apply (futuro)');
  lines.push('');
  lines.push('1. Para cada candidato, mover todas las lineas BO al pedido `ordenTarget` (= la orden mas nueva).');
  lines.push('2. Actualizar `line.qty = qty_regla_nueva` + `line.qtyOpen = qty_regla_nueva` en la linea target.');
  lines.push('3. Cerrar las demas lineas BO con `line.state = cancelled`, `qtyOpen = 0`, `closedReason = "fusion_bo_inter_orden"`, `cancelledAt = nowIso`, `cancelledBy = system`.');
  lines.push('4. Guardar snapshot `_backfill.<slug>_<timestamp>` por doc modificado con los valores anteriores (CLAUDE.md §55 obligatorio).');
  lines.push('5. Escribir `operations_log` entry con tipo `fusion_bo_inter_orden_apply`, counts y per-doc delta.');
  lines.push('6. Correr script W post-apply para validar que `qtyBoReducibles` bajo.');
  lines.push('');
  lines.push('**Autorizacion requerida de Mariano antes de implementar `--apply`.**');
  lines.push('');
  lines.push('Script: `scripts/audit/S_dry_run_fusion_duplicados.cjs` (dry-run only).');
  lines.push('');

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log('[S] Markdown escrito en: ' + outPath);
  console.log('');
  console.log('[S] Para persistir la fusion (--apply): Mariano autoriza aparte.');
}

main().catch((e) => {
  console.error('[S] Error:', e && e.message ? e.message : String(e));
  console.error(e && e.stack ? e.stack : '');
  process.exit(1);
});
