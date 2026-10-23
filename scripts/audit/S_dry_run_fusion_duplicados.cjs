// S — v1435 §56 (2026-10-24): DRY-RUN de fusión por SKU en órdenes abiertas.
//
// Simula `mergeLinesFromOrders` sobre los datos legacy identificados por
// `S_sku_duplicados_prod.cjs`. Imprime tabla ANTES → DESPUÉS por orden en
// `docs/auditoria/22_DRY_RUN_FUSION_DUPLICADOS.md`.
//
// `--apply` NO se corre acá. Para persistir, Mariano autoriza aparte y se
// agrega el bloque con `_backfill` snapshot (patrón CLAUDE.md §55).
//
// Uso:
//   node scripts/audit/S_dry_run_fusion_duplicados.cjs

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  const fs = require('node:fs');
  const path = require('node:path');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // Importa la pure fn vía ESM dynamic import. En Node 20 CommonJS, usamos
  // require del módulo esm wrapper — pero `src/pure/unificar-ordenes.js` es
  // puro ESM. Alternativa simple: replicamos la fusión inline (idéntico al
  // helper, mismo contrato) para no mezclar runtimes.
  const norm = (s) => String(s || '').toUpperCase().trim();

  /**
   * @param {Array<any>} refsA
   * @param {Array<any>} refsB
   */
  const unionRefs = (refsA, refsB) => {
    const seen = new Map();
    for (const r of [...(refsA || []), ...(refsB || [])]) {
      if (!r || !r.pedidoId || !Number.isFinite(Number(r.lineIndex))) continue;
      const k = r.pedidoId + '|' + r.lineIndex;
      if (!seen.has(k)) {
        seen.set(k, Object.assign({}, r, { qtyAsignada: Number(r.qtyAsignada) || 0 }));
      } else {
        const prev = seen.get(k);
        const q = Number(r.qtyAsignada) || 0;
        if (q > (prev.qtyAsignada || 0)) prev.qtyAsignada = q;
      }
    }
    return Array.from(seen.values());
  };

  /**
   * @param {Array<any>} lines
   */
  const fuseLines = (lines) => {
    /** @type {Map<string, any>} */
    const bySku = new Map();
    const order = [];
    for (const l of lines || []) {
      if (!l || !l.code) continue;
      const key = norm(l.code);
      const existing = bySku.get(key);
      if (!existing) {
        bySku.set(key, Object.assign({}, l));
        order.push(key);
      } else {
        existing.qty = (Number(existing.qty) || 0) + (Number(l.qty) || 0);
        if (l.origen === 'stock-asignado' || existing.origen === 'stock-asignado') {
          existing.origen = 'stock-asignado';
        }
        const union = unionRefs(existing.asigRefs, l.asigRefs);
        if (union.length > 0) existing.asigRefs = union;
      }
    }
    return order.map((k) => bySku.get(k));
  };

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('S DRY-RUN — Fusión por SKU @ ' + nowIso);
  console.log('================================================================');

  const [waitlistSnap, pedidosSnap] = await Promise.all([
    db.collection('revision_waitlist').get(),
    db.collection('pedidos').get(),
  ]);

  /** @type {Array<{coleccion:string,docId:string,orderNumber:string,cliente:string,antes:number,despues:number,delta:number,sku:string[]}>} */
  const changes = [];

  const procesar = (coleccion, docId, cliente, orderNumber, items) => {
    if (!Array.isArray(items) || items.length === 0) return;
    const fused = fuseLines(items);
    if (fused.length < items.length) {
      // Hay fusión.
      const codes = Array.from(new Set(items.map((i) => norm(i.code)))).sort();
      changes.push({
        coleccion,
        docId,
        orderNumber,
        cliente,
        antes: items.length,
        despues: fused.length,
        delta: items.length - fused.length,
        sku: codes.filter((c) => items.filter((i) => norm(i.code) === c).length >= 2),
      });
    }
  };

  waitlistSnap.forEach((d) => {
    const w = d.data() || {};
    if (w.closedAt || w.stage === 'consumed') return;
    procesar('revision_waitlist', d.id, w.clientName || '(sin cliente)', String(w.orderNumber || ''), w.items);
  });
  pedidosSnap.forEach((d) => {
    const p = d.data() || {};
    if (p.closedAt) return;
    if (p.stage !== 'pending' && p.stage !== 'confirmed') return;
    procesar('pedidos', d.id, p.clientName || '(sin cliente)', String(p.orderNumber || ''), p.lines);
  });

  console.log('Órdenes con fusión posible: ' + changes.length);
  const totalDelta = changes.reduce((s, c) => s + c.delta, 0);
  console.log('Total filas a fusionar: ' + totalDelta);

  const lines = [];
  lines.push('# Audit 22 — DRY-RUN fusión SKU duplicados (§56 v1435)');
  lines.push('');
  lines.push('Generado: ' + nowIso);
  lines.push('');
  lines.push('**Script:** `scripts/audit/S_dry_run_fusion_duplicados.cjs` (DRY-RUN, read-only).');
  lines.push('');
  lines.push('**Qué simula:** la fusión que `mergeLinesFromOrders` + `dedupeLinesByCode` (v1435 §56) aplican a datos nuevos. Las filas con el mismo SKU se agrupan en una sola con qty sumada + preserva origen=stock-asignado + union de asigRefs.');
  lines.push('');
  lines.push('**`--apply` NO está implementado acá.** Mariano autoriza aparte si quiere persistir la fusión; en ese caso agregar bloque con snapshot `_backfill` (CLAUDE.md §55).');
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('- Órdenes afectadas: ' + changes.length);
  lines.push('- Filas totales a fusionar (unidades no se pierden): ' + totalDelta);
  lines.push('');
  lines.push('## ANTES → DESPUÉS por orden');
  lines.push('');
  if (changes.length === 0) {
    lines.push('_No hay órdenes con SKU duplicado. Nada que fusionar._');
  } else {
    lines.push('| Colección | Orden | Cliente | SKUs duplicados | Antes (#filas) | Después (#filas) | Delta |');
    lines.push('|---|---:|---|---|---:|---:|---:|');
    for (const c of changes) {
      lines.push(
        '| ' + c.coleccion +
        ' | ' + (c.orderNumber || '-') +
        ' | ' + c.cliente +
        ' | ' + c.sku.join(', ') +
        ' | ' + c.antes +
        ' | ' + c.despues +
        ' | -' + c.delta +
        ' |'
      );
    }
  }

  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, '22_DRY_RUN_FUSION_DUPLICADOS.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log('');
  console.log('Output: ' + outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
