// S — v1435 §56 (2026-10-24)
//
// READ-ONLY audit: identifica órdenes abiertas (revision_waitlist + pedidos
// stage=pending/confirmed sin cerrar) con SKUs REPETIDOS en la misma orden.
// Pre-§56 (fusión por SKU), los flujos de alta manual + Excel + unificación
// podían dejar 2+ filas del mismo SKU en una orden. §56 garantiza que post-
// deploy ningún SKU se duplica, pero los datos legacy quedan.
//
// Uso:
//   node scripts/audit/S_sku_duplicados_prod.cjs
//
// Output:
//   docs/auditoria/22_SKU_DUPLICADOS_PROD.md
//
// NUNCA muta datos. Para fusionar, usar S_dry_run_fusion_duplicados.cjs
// (dry-run) + autorización explícita de Mariano para `--apply`.

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  const fs = require('node:fs');
  const path = require('node:path');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('S — SKU duplicados en órdenes abiertas @ ' + nowIso);
  console.log('================================================================');

  const [waitlistSnap, pedidosSnap] = await Promise.all([
    db.collection('revision_waitlist').get(),
    db.collection('pedidos').get(),
  ]);
  console.log('revision_waitlist docs: ' + waitlistSnap.size);
  console.log('pedidos docs: ' + pedidosSnap.size);

  /**
   * Normaliza un code a UPPER + trim.
   */
  const norm = (s) => String(s || '').toUpperCase().trim();

  /**
   * @typedef {{coleccion:string, docId:string, cliente:string, cardCode:string, orderNumber:string, sku:string, filas:Array<{qty:number, state:string, origen:string|null, precio:number|null, reserva:boolean}>, totalQty:number, reservadaCount:number}} DupRow
   */
  /** @type {Array<DupRow>} */
  const dupRows = [];

  const procesarItems = (coleccion, docId, cliente, cardCode, orderNumber, items) => {
    if (!Array.isArray(items)) return;
    /** @type {Map<string, Array<any>>} */
    const bySku = new Map();
    for (const it of items) {
      if (!it) continue;
      const sku = norm(it.code || it.sku);
      if (!sku) continue;
      if (!bySku.has(sku)) bySku.set(sku, []);
      bySku.get(sku).push(it);
    }
    for (const [sku, filas] of bySku.entries()) {
      if (filas.length < 2) continue;
      dupRows.push({
        coleccion,
        docId,
        cliente,
        cardCode,
        orderNumber,
        sku,
        filas: filas.map((f) => ({
          qty: Number(f.qty || f.qtyOpen || 0),
          state: f.state || '-',
          origen: f.origen || null,
          precio: Number(f.precio || 0) || null,
          reserva: Array.isArray(f.asigRefs) && f.asigRefs.length > 0,
        })),
        totalQty: filas.reduce((s, f) => s + (Number(f.qty || f.qtyOpen || 0)), 0),
        reservadaCount: filas.filter((f) => Array.isArray(f.asigRefs) && f.asigRefs.length > 0)
          .length,
      });
    }
  };

  waitlistSnap.forEach((d) => {
    const w = d.data() || {};
    if (w.closedAt) return;
    if (w.stage === 'consumed') return;
    procesarItems(
      'revision_waitlist',
      d.id,
      w.clientName || '(sin cliente)',
      w.clientCardCode || '',
      String(w.orderNumber || ''),
      w.items
    );
  });

  pedidosSnap.forEach((d) => {
    const p = d.data() || {};
    if (p.closedAt) return;
    if (p.stage !== 'pending' && p.stage !== 'confirmed') return;
    procesarItems(
      'pedidos',
      d.id,
      p.clientName || '(sin cliente)',
      p.clientCardCode || '',
      String(p.orderNumber || ''),
      p.lines
    );
  });

  console.log('');
  console.log('Filas con SKU duplicado encontradas: ' + dupRows.length);

  const outLines = [];
  outLines.push('# Audit 22 — SKU DUPLICADOS en órdenes abiertas');
  outLines.push('');
  outLines.push('Generado: ' + nowIso);
  outLines.push('');
  outLines.push('**Script:** `scripts/audit/S_sku_duplicados_prod.cjs` (read-only).');
  outLines.push('');
  outLines.push('**Contexto §56 (v1435):** post-deploy ninguna orden puede tener un SKU duplicado (fusión por SKU en `mergeLinesFromOrders` + `dedupeLinesByCode`). Los casos listados abajo son datos legacy pre-§56.');
  outLines.push('');
  outLines.push('## Resumen');
  outLines.push('');
  outLines.push('- Órdenes afectadas: ' + dupRows.length);
  const totalFilasExtra = dupRows.reduce((s, r) => s + (r.filas.length - 1), 0);
  outLines.push('- Filas extra a fusionar (unidades no se pierden, solo se agrupan): ' + totalFilasExtra);
  outLines.push('');
  outLines.push('## Investigación caso 502 — OSVALDO RUBEN MASERA SKU EXGTVS90M4CH');
  outLines.push('');
  outLines.push('Mariano reportó que la orden 502 mostraba badge "DUPLICADO" con **una sola fila visible**.');
  outLines.push('');
  outLines.push('**Causa raíz** (pre-§56): el badge "DUPLICADO" en `index.html:_renderWaitlistCard` se disparaba por DOS condiciones distintas:');
  outLines.push('1. `_isDupCode = _wcardDupSet.has(code)` — SKU que aparece 2+ veces en `w.items`.');
  outLines.push('2. `r.warnDuplicado` — SKU que YA está en SAP Asignado con stock (`boCliente > 0 && stockTotal > 0`, línea 24725 pre-fix).');
  outLines.push('');
  outLines.push('Si solo había 1 fila visible pero el badge aparecía, era el camino #2: el cliente ya tenía el mismo SKU en SAP con stock. La fila "duplicada" no estaba en la lista de espera; estaba en SAP.');
  outLines.push('');
  outLines.push('**Post-§56** (v1435): badge "DUPLICADO" eliminado completamente. `warnDuplicado` sigue en la clase JS para debug/filtros, pero no se renderiza. Si Mariano quiere alertar al VDE sobre "SKU ya pedido en SAP", agregar un badge nuevo con texto específico (ej. "YA EN SAP") en lugar de reusar "DUPLICADO".');
  outLines.push('');
  outLines.push('## Órdenes con SKU duplicado real (fusionable)');
  outLines.push('');
  if (dupRows.length === 0) {
    outLines.push('_No hay órdenes abiertas con SKU duplicado en prod @ ' + nowIso.slice(0, 10) + '._');
  } else {
    outLines.push('| Colección | Orden | Cliente | CardCode | SKU | #Filas | Qty total | Reservadas | Precios | Estados |');
    outLines.push('|---|---:|---|---|---|---:|---:|---:|---|---|');
    for (const r of dupRows) {
      const precios = Array.from(new Set(r.filas.map((f) => f.precio).filter((p) => p != null))).join(', ');
      const estados = Array.from(new Set(r.filas.map((f) => f.state))).join('/');
      outLines.push(
        '| ' + r.coleccion +
        ' | ' + (r.orderNumber || '-') +
        ' | ' + r.cliente +
        ' | `' + (r.cardCode || '-') + '`' +
        ' | `' + r.sku + '`' +
        ' | ' + r.filas.length +
        ' | ' + r.totalQty +
        ' | ' + r.reservadaCount +
        ' | ' + (precios || '-') +
        ' | ' + estados +
        ' |'
      );
    }
  }
  outLines.push('');
  outLines.push('## Acciones sugeridas');
  outLines.push('');
  outLines.push('1. Correr `scripts/audit/S_dry_run_fusion_duplicados.cjs` (dry-run) para ver el ANTES → DESPUÉS por orden.');
  outLines.push('2. Mariano aprueba el dry-run.');
  outLines.push('3. Si se autoriza, ejecutar `--apply` para persistir la fusión. Snapshot via `_backfill` (patrón §55).');

  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, '22_SKU_DUPLICADOS_PROD.md');
  fs.writeFileSync(outPath, outLines.join('\n'), 'utf-8');
  console.log('');
  console.log('Output: ' + outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
