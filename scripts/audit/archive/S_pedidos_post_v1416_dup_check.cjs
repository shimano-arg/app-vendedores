// S — Lista pedidos confirmados desde el deploy de v1416 (2026-10-22T17:35Z)
// con su waitlist origen y detecta líneas duplicadas o qty duplicadas.
//
// Causa raíz v1416 §42.2 bug: guard mergeaba waitlist propia → líneas
// duplicadas en SAP. Fix shippeado en v1418 §42.2.1 2026-10-22 ~15:30-16:00.
//
// Para cada pedido confirmado en la ventana [deploy_v1416, deploy_v1418]:
//   1. Fetch pedido.lines[]
//   2. Fetch waitlist (via pedido.waitlistOrigenId)
//   3. Comparar sumQty(pedido.lines por SKU) vs sumQty(waitlist.items por SKU)
//   4. Si pedido_sum == 2× waitlist_sum (o más) → DUPLICADO.
//   5. Si pedido.lines[].length == 2× waitlist.items[].length → DUPLICADO.
//
// Output: docs/auditoria/30_PEDIDOS_DUP_V1416.md con tabla cliente + ORDEN +
// SAP DocNum + líneas waitlist vs líneas pedido + factor dup.
//
// Read-only. Nunca escribe.

const PROJECT = 'app-vendedores-shimano';

// Ventana del bug:
//   Inicio: deploy v1416 2026-10-22 ~17:35 UTC (merge PR #1152 commit ee08ba0).
//   Fin:    deploy v1418 2026-10-22 ~19:30 UTC (merge PR #1154 commit 7ba3208).
// Permiso ancho para capturar también pedidos directamente afectados.
const WINDOW_START_ISO = '2026-10-22T17:30:00.000Z';
const WINDOW_END_ISO = '2026-10-22T22:00:00.000Z';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('S — Pedidos post-v1416 con qty duplicadas por self-unify §42.2');
  console.log('================================================================');
  console.log('Ventana: ' + WINDOW_START_ISO + ' → ' + WINDOW_END_ISO);
  console.log();

  // Firestore filtra por confirmedAt string ISO (campo texto en pedidos).
  const qs = await db
    .collection('pedidos')
    .where('confirmedAt', '>=', WINDOW_START_ISO)
    .where('confirmedAt', '<=', WINDOW_END_ISO)
    .get();

  console.log('Pedidos confirmados en ventana:', qs.size);

  /** @type {Array<any>} */
  const rows = [];
  for (const d of qs.docs) {
    const p = d.data() || {};
    const pedidoId = d.id;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const wlId = p.waitlistOrigenId || null;

    // Agrupar pedido.lines por SKU (sumar qty).
    const pedQtyBySku = new Map();
    for (const l of lines) {
      if (!l || !l.code) continue;
      const code = String(l.code).toUpperCase();
      pedQtyBySku.set(code, (pedQtyBySku.get(code) || 0) + (Number(l.qty) || 0));
    }

    // Fetch waitlist origen si existe.
    let wlItems = [];
    let wlOrderNumber = null;
    let wlFound = false;
    if (wlId) {
      try {
        const wlDoc = await db.collection('revision_waitlist').doc(wlId).get();
        if (wlDoc.exists) {
          const w = wlDoc.data() || {};
          wlItems = Array.isArray(w.items) ? w.items : [];
          wlOrderNumber = w.orderNumber || null;
          wlFound = true;
        }
      } catch (_e) {
        // Ignore — waitlist pudo haber sido borrado post-consumed.
      }
    }

    const wlQtyBySku = new Map();
    for (const it of wlItems) {
      if (!it || !it.code) continue;
      const code = String(it.code).toUpperCase();
      wlQtyBySku.set(code, (wlQtyBySku.get(code) || 0) + (Number(it.qty) || 0));
    }

    // Comparar: para cada SKU de la waitlist, ver si pedido.qty > 1.5× waitlist.qty.
    /** @type {Array<{sku:string, wlQty:number, pedQty:number, factor:number}>} */
    const skuDiffs = [];
    for (const [sku, wlQ] of wlQtyBySku) {
      const pedQ = pedQtyBySku.get(sku) || 0;
      if (wlQ > 0 && pedQ > 0) {
        const factor = pedQ / wlQ;
        if (factor >= 1.5) skuDiffs.push({ sku, wlQty: wlQ, pedQty: pedQ, factor });
      }
    }

    // También SKUs que están en pedido pero no en waitlist (pueden ser merge spurious).
    /** @type {Array<string>} */
    const pedExtra = [];
    for (const [sku, _pQ] of pedQtyBySku) {
      if (!wlQtyBySku.has(sku) && wlId) pedExtra.push(sku);
    }

    const linesCountDiff = lines.length - wlItems.length;

    // Detector adicional: SKUs que aparecen 2+ veces en pedido.lines[].
    // Capta duplicación aunque no haya waitlist origen (ej. waitlist borrada
    // o pedido re-abierto sin waitlistOrigenId reset).
    /** @type {Map<string, number>} */
    const skuOccur = new Map();
    for (const l of lines) {
      if (!l || !l.code) continue;
      const code = String(l.code).toUpperCase();
      skuOccur.set(code, (skuOccur.get(code) || 0) + 1);
    }
    /** @type {Array<{sku:string, occurrences:number, totalQty:number}>} */
    const dupSkus = [];
    for (const [sku, n] of skuOccur) {
      if (n >= 2) dupSkus.push({ sku, occurrences: n, totalQty: pedQtyBySku.get(sku) || 0 });
    }
    dupSkus.sort((a, b) => b.occurrences - a.occurrences);

    const dup =
      skuDiffs.length > 0 ||
      (wlFound && lines.length >= 2 * wlItems.length && wlItems.length > 0) ||
      dupSkus.length > 0;

    rows.push({
      pedidoId,
      orderNumber: p.orderNumber || null,
      clientName: p.clientName || '',
      clientCardCode: p.clientCardCode || '',
      ownerEmail: p.ownerEmail || '',
      confirmedAt: p.confirmedAt || '',
      source: p.source || '',
      sapDocNum: p.transferidoSAP ? p.transferidoSAP.docNum || null : null,
      sapDocEntry: p.transferidoSAP ? p.transferidoSAP.docEntry || null : null,
      sapTransferredAt: p.transferidoSAP ? p.transferidoSAP.transferredAt || null : null,
      wlId,
      wlFound,
      wlOrderNumber,
      wlItemsCount: wlItems.length,
      pedLinesCount: lines.length,
      linesCountDiff,
      skuDiffs,
      pedExtra,
      dupSkus,
      dup,
    });
  }

  // Orden: dup primero + luego por confirmedAt.
  rows.sort((a, b) => {
    if (a.dup !== b.dup) return a.dup ? -1 : 1;
    return String(a.confirmedAt).localeCompare(String(b.confirmedAt));
  });

  const dupCount = rows.filter((r) => r.dup).length;
  console.log();
  console.log('Pedidos con qty duplicadas o líneas duplicadas: ' + dupCount);
  console.log('Pedidos sin diferencia: ' + (rows.length - dupCount));
  console.log();

  // Generar markdown.
  const nowIso = new Date().toISOString();
  const md = [];
  md.push('# Pedidos post-v1416 con líneas o qty duplicadas (bug §42.2 self-unify)');
  md.push('');
  md.push('**Generado**: ' + nowIso);
  md.push('**Ventana de bug**: ' + WINDOW_START_ISO + ' → ' + WINDOW_END_ISO);
  md.push('**Deploy v1416** (bug introducido): 2026-10-22 ~17:35 UTC (PR #1152 commit ee08ba0).');
  md.push('**Deploy v1418** (hotfix): 2026-10-22 (PR #1154 commit 7ba3208).');
  md.push('');
  md.push('**Pedidos confirmados en ventana**: ' + rows.length);
  md.push('**Con duplicación detectada**: ' + dupCount);
  md.push('');
  md.push('---');
  md.push('');
  md.push('## Pedidos con DUPLICACIÓN');
  md.push('');
  if (dupCount === 0) {
    md.push('_(ninguno — ver tabla completa abajo)_');
  } else {
    md.push('| Cliente | ORDEN | SAP DocNum | Confirmed | Owner | WL items | Ped lines | Factor max | SKUs duplicados |');
    md.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows.filter((x) => x.dup)) {
      const maxFactor = r.skuDiffs.length > 0 ? Math.max(...r.skuDiffs.map((d) => d.factor)) : 0;
      const skus = r.skuDiffs
        .slice(0, 5)
        .map((d) => d.sku + ' ' + d.wlQty + '→' + d.pedQty)
        .join(', ');
      md.push(
        '| ' +
          (r.clientName || '(?)').slice(0, 30) +
          ' | ' +
          (r.orderNumber || '-') +
          ' | ' +
          (r.sapDocNum || '-') +
          ' | ' +
          String(r.confirmedAt).slice(0, 19) +
          ' | ' +
          (r.ownerEmail || '-') +
          ' | ' +
          r.wlItemsCount +
          ' | ' +
          r.pedLinesCount +
          ' | ' +
          maxFactor.toFixed(2) +
          'x | ' +
          skus +
          (r.skuDiffs.length > 5 ? ' ...' : '') +
          ' |'
      );
    }
  }
  md.push('');
  md.push('---');
  md.push('');
  md.push('## Tabla completa (todos los pedidos de la ventana)');
  md.push('');
  md.push('| Dup | Cliente | ORDEN | SAP DocNum | WL items | Ped lines | Diff |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    md.push(
      '| ' +
        (r.dup ? '🔴 SÍ' : '✓ no') +
        ' | ' +
        (r.clientName || '(?)').slice(0, 30) +
        ' | ' +
        (r.orderNumber || '-') +
        ' | ' +
        (r.sapDocNum || '-') +
        ' | ' +
        r.wlItemsCount +
        ' | ' +
        r.pedLinesCount +
        ' | ' +
        r.linesCountDiff +
        ' |'
    );
  }
  md.push('');
  md.push('---');
  md.push('');
  md.push('## Detalle por pedido con duplicación');
  md.push('');
  for (const r of rows.filter((x) => x.dup)) {
    md.push('### ' + (r.clientName || '(?)') + ' — ORDEN ' + (r.orderNumber || '?'));
    md.push('');
    md.push('- **PedidoId**: `' + r.pedidoId + '`');
    md.push('- **CardCode**: `' + r.clientCardCode + '`');
    md.push('- **Owner**: ' + r.ownerEmail);
    md.push('- **ConfirmedAt**: ' + r.confirmedAt);
    md.push('- **SAP DocNum**: ' + (r.sapDocNum || '(no transferido)'));
    md.push('- **SAP DocEntry**: ' + (r.sapDocEntry || '(no transferido)'));
    md.push('- **SAP TransferredAt**: ' + (r.sapTransferredAt || '-'));
    md.push('- **Source**: ' + (r.source || '-'));
    md.push('- **Waitlist origen**: `' + (r.wlId || '(ninguna)') + '` ' + (r.wlFound ? '(encontrada)' : '(NO encontrada en Firestore)'));
    md.push('- **Waitlist items / Pedido lines**: ' + r.wlItemsCount + ' / ' + r.pedLinesCount + ' (diff ' + r.linesCountDiff + ')');
    if (r.skuDiffs.length > 0) {
      md.push('');
      md.push('**SKUs con qty duplicada**:');
      md.push('');
      md.push('| SKU | WL qty | Ped qty | Factor |');
      md.push('|---|---|---|---|');
      for (const d of r.skuDiffs) {
        md.push('| ' + d.sku + ' | ' + d.wlQty + ' | ' + d.pedQty + ' | ' + d.factor.toFixed(2) + 'x |');
      }
    }
    if (r.pedExtra.length > 0) {
      md.push('');
      md.push('**SKUs en pedido NO presentes en waitlist**: ' + r.pedExtra.slice(0, 10).join(', ') + (r.pedExtra.length > 10 ? ' ...' : ''));
    }
    if (r.dupSkus.length > 0) {
      md.push('');
      md.push('**SKUs con 2+ líneas en el mismo pedido** (sugerente de self-unify §42.2):');
      md.push('');
      md.push('| SKU | Ocurrencias | Qty total |');
      md.push('|---|---|---|');
      for (const d of r.dupSkus.slice(0, 20)) {
        md.push('| ' + d.sku + ' | ' + d.occurrences + ' | ' + d.totalQty + ' |');
      }
      if (r.dupSkus.length > 20) md.push('| ... | ... | ... |');
    }
    md.push('');
  }

  const fs = require('node:fs');
  const path = require('node:path');
  const outDir = path.resolve(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, '30_PEDIDOS_DUP_V1416.md');
  fs.writeFileSync(outPath, md.join('\n'), 'utf8');
  console.log('Reporte escrito en:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
