// W v1516 §TBD (2026-10-28) — Consolidar ingresos_reparto duplicados en prod.
//
// Dry-run por default. `--apply` requiere ejecución explícita.
//
// Flow:
//   - Load ingresos_reparto con status in ['pending','in_progress'].
//   - Group by sku. Para cada SKU con N > 1 docs:
//     - Target = el doc más viejo (menor detectedAt).
//     - Para cada "otro" doc:
//       - Suma qtyIngresada al target.
//       - Agrega al audit mergedFromScript[].
//       - El "otro" doc: status='merged_into', mergedInto: targetId, mergedAt, mergedBy.
//     - clientesBO del target: recomputado desde pedidos vigentes (extractClientesBOForSku).
//     - Guarda snapshot _backfill.W_consolidar_ingresos_duplicados_<fecha> con previousValues.
//   - Output: tabla ASCII + docs/auditoria/W_consolidar_ingresos_duplicados.md.
//
// Precedente: v1516 fix prevención del bug "FXS70MHC2 x2 cards" + "SLX151XGA x2" + "SUC60MH2APY x2".
// El fix pre-prod en reparto-core.js (createIngresosRepartoFromDelta) previene futuros duplicados.
// Este script limpia los duplicados HOY existentes.

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');
const SLUG_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const SLUG = `W_consolidar_ingresos_duplicados_${SLUG_DATE}_v1516`;
const SCRIPT_NAME = 'scripts/audit/W_consolidar_ingresos_duplicados.cjs';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const { extractClientesBOForSku } = await import(
    '../../functions/core/reparto-core.js'
  );

  console.log('================================================================');
  console.log('W — Consolidar ingresos_reparto duplicados por SKU');
  console.log('Modo:', APPLY ? '*** APPLY (persistira) ***' : 'DRY-RUN');
  console.log('Slug:', SLUG);
  console.log('================================================================\n');

  const snap = await db
    .collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();
  console.log('Total ingresos_reparto pending/in_progress:', snap.size);

  // Group by sku.
  /** @type {Map<string, Array<{id: string, data: any}>>} */
  const bySku = new Map();
  snap.forEach((d) => {
    const data = d.data() || {};
    const sku = String(data.sku || '').toUpperCase().trim();
    if (!sku) return;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push({ id: d.id, data });
  });

  // Filter to only SKUs with 2+ docs.
  /** @type {Array<{sku: string, docs: Array<{id: string, data: any}>}>} */
  const dupeGroups = [];
  for (const [sku, docs] of bySku) {
    if (docs.length >= 2) dupeGroups.push({ sku, docs });
  }
  console.log('SKUs con 2+ docs activos:', dupeGroups.length);

  if (dupeGroups.length === 0) {
    console.log('\nSin duplicados a consolidar. OK.');
    writeReport({ dupeGroups: [], applied: APPLY });
    return;
  }

  // Load open pedidos UNA sola vez para recomputar clientesBO.
  const openPedSnap = await db
    .collection('pedidos')
    .where('closedAt', '==', null)
    .get();
  /** @type {Array<{id: string, data: () => any}>} */
  const openPedidos = [];
  openPedSnap.forEach((d) => openPedidos.push({ id: d.id, data: () => d.data() }));
  console.log('Pedidos abiertos cargados:', openPedidos.length);

  /** @type {Array<any>} */
  const planRows = [];
  for (const { sku, docs } of dupeGroups) {
    // Target = el doc más viejo (menor detectedAt).
    const sorted = docs.slice().sort((a, b) => {
      const ta = String(a.data.detectedAt || '');
      const tb = String(b.data.detectedAt || '');
      return ta.localeCompare(tb);
    });
    const target = sorted[0];
    const others = sorted.slice(1);
    const sumOthersQty = others.reduce(
      (s, o) => s + (Number(o.data.qtyIngresada) || 0),
      0
    );
    const newQty = (Number(target.data.qtyIngresada) || 0) + sumOthersQty;
    // Recompute clientesBO.
    const freshClientesBO = extractClientesBOForSku(openPedidos, sku);
    const freshQtyBackorderTotal = freshClientesBO.reduce(
      (s, c) => s + (Number(c.qtyBackorder) || 0),
      0
    );

    planRows.push({
      sku,
      targetId: target.id,
      targetDetectedAt: target.data.detectedAt || '',
      targetPrevQty: Number(target.data.qtyIngresada) || 0,
      targetNewQty: newQty,
      othersIds: others.map((o) => o.id),
      othersCount: others.length,
      sumOthersQty,
      freshClientesCount: freshClientesBO.length,
      freshQtyBackorderTotal,
    });
  }

  // Imprimir tabla.
  console.log('\n============== PLAN ==============');
  console.log('SKU             | Target ID               | Prev qty | +others | New qty | Others | BO vig');
  console.log('----------------|-------------------------|----------|---------|---------|--------|-------');
  for (const r of planRows) {
    const line = [
      String(r.sku).padEnd(15),
      String(r.targetId).padEnd(23),
      String(r.targetPrevQty).padStart(8),
      String(r.sumOthersQty).padStart(7),
      String(r.targetNewQty).padStart(7),
      String(r.othersCount).padStart(6),
      String(r.freshClientesCount).padStart(5),
    ].join(' | ');
    console.log(line);
  }
  console.log('\nTotal grupos:', planRows.length);
  console.log(
    'Total docs a marcar merged_into:',
    planRows.reduce((s, r) => s + r.othersCount, 0)
  );

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se escribio nada. Para persistir correr con --apply.');
    writeReport({ dupeGroups: planRows, applied: false });
    return;
  }

  // === APPLY ===
  console.log('\n>>> APPLY: escribiendo cambios en Firestore...');
  const nowIso = new Date().toISOString();
  let successCount = 0;
  let errorCount = 0;
  /** @type {string[]} */
  const errors = [];
  for (const r of planRows) {
    try {
      // Target update (incluye snapshot _backfill).
      const targetDoc = dupeGroups.find((g) => g.sku === r.sku).docs.find((d) => d.id === r.targetId);
      const previousValues = {
        qtyIngresada: targetDoc.data.qtyIngresada,
        clientesBO: targetDoc.data.clientesBO,
        qtyBackorderTotal: targetDoc.data.qtyBackorderTotal,
        clientesCount: targetDoc.data.clientesCount,
      };
      const prevMergedScript = Array.isArray(targetDoc.data.mergedFromScript)
        ? targetDoc.data.mergedFromScript
        : [];
      const mergedFromScript = prevMergedScript.concat(
        r.othersIds.map((otherId) => ({
          at: nowIso,
          mergedFromId: otherId,
          by: SCRIPT_NAME,
        }))
      );
      const prevBackfill = targetDoc.data._backfill || {};
      await db.collection('ingresos_reparto').doc(r.targetId).update({
        qtyIngresada: r.targetNewQty,
        clientesBO: /** @type {any} */ ((await import('../../functions/core/reparto-core.js')).extractClientesBOForSku(openPedidos, r.sku)),
        qtyBackorderTotal: r.freshQtyBackorderTotal,
        clientesCount: r.freshClientesCount,
        mergedFromScript,
        _lastConsolidatedAt: nowIso,
        _backfill: Object.assign({}, prevBackfill, {
          [SLUG]: {
            previousValues,
            by: SCRIPT_NAME,
            at: nowIso,
          },
        }),
      });
      // Others: marcar merged_into.
      for (const otherId of r.othersIds) {
        const otherDoc = dupeGroups.find((g) => g.sku === r.sku).docs.find((d) => d.id === otherId);
        const otherPrev = {
          status: otherDoc.data.status,
          qtyIngresada: otherDoc.data.qtyIngresada,
          clientesBO: otherDoc.data.clientesBO,
        };
        const otherPrevBackfill = otherDoc.data._backfill || {};
        await db.collection('ingresos_reparto').doc(otherId).update({
          status: 'merged_into',
          mergedInto: r.targetId,
          mergedAt: nowIso,
          mergedBy: SCRIPT_NAME,
          _backfill: Object.assign({}, otherPrevBackfill, {
            [SLUG]: {
              previousValues: otherPrev,
              by: SCRIPT_NAME,
              at: nowIso,
            },
          }),
        });
      }
      successCount += 1;
      console.log(`  OK sku=${r.sku} target=${r.targetId} newQty=${r.targetNewQty}`);
    } catch (e) {
      errorCount += 1;
      const msg = `${r.sku}: ${e.message || String(e)}`;
      errors.push(msg);
      console.error(`  FAIL ${msg}`);
    }
  }
  console.log(`\nAPPLY completo. OK=${successCount} FAIL=${errorCount}`);
  if (errors.length > 0) {
    console.log('Errores:', errors);
  }
  writeReport({ dupeGroups: planRows, applied: true, successCount, errorCount, errors });
}

function writeReport({ dupeGroups, applied, successCount = 0, errorCount = 0, errors = [] }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'W_consolidar_ingresos_duplicados.md');
  const lines = [];
  lines.push('# W — Consolidar ingresos_reparto duplicados por SKU');
  lines.push('');
  lines.push('Script: `scripts/audit/W_consolidar_ingresos_duplicados.cjs`');
  lines.push('Modo: ' + (applied ? 'APPLY' : 'DRY-RUN'));
  lines.push('Slug: `' + SLUG + '`');
  lines.push('Fecha: ' + new Date().toISOString());
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('- SKUs con 2+ docs activos: **' + dupeGroups.length + '**');
  lines.push('- Total docs "others" a marcar merged_into: **' + dupeGroups.reduce((s, r) => s + r.othersCount, 0) + '**');
  if (applied) {
    lines.push('- Grupos aplicados OK: **' + successCount + '**');
    lines.push('- Grupos con error: **' + errorCount + '**');
  }
  lines.push('');
  if (dupeGroups.length === 0) {
    lines.push('_Sin duplicados activos. OK._');
  } else {
    lines.push('## Plan por SKU');
    lines.push('');
    lines.push('| SKU | Target ID | Prev qty | +others | New qty | Others | BO vig |');
    lines.push('|---|---|---:|---:|---:|---:|---:|');
    for (const r of dupeGroups) {
      lines.push(
        '| ' +
          r.sku +
          ' | `' +
          r.targetId +
          '` | ' +
          r.targetPrevQty +
          ' | ' +
          r.sumOthersQty +
          ' | ' +
          r.targetNewQty +
          ' | ' +
          r.othersCount +
          ' | ' +
          r.freshClientesCount +
          ' |'
      );
    }
  }
  if (errors.length > 0) {
    lines.push('');
    lines.push('## Errores');
    lines.push('');
    for (const e of errors) lines.push('- ' + e);
  }
  lines.push('');
  lines.push('## Como ejecutar');
  lines.push('');
  lines.push('```bash');
  lines.push('# Dry-run (default):');
  lines.push('node scripts/audit/W_consolidar_ingresos_duplicados.cjs');
  lines.push('');
  lines.push('# Apply (persiste cambios):');
  lines.push('node scripts/audit/W_consolidar_ingresos_duplicados.cjs --apply');
  lines.push('```');
  lines.push('');
  lines.push('## Rollback');
  lines.push('');
  lines.push('Cada doc modificado guarda `_backfill.' + SLUG + '.previousValues` (ver §55).');
  lines.push('Para revertir: iterar los docs con ese slug, restaurar `previousValues`,');
  lines.push('borrar la entrada del slug.');
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  console.log('\nReporte: docs/auditoria/W_consolidar_ingresos_duplicados.md');
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
