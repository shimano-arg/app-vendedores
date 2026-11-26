// AG — PR4 §75 (2026-10-26) — backfill `desc` + `month` en pedidos + waitlists
// abiertos. Fix "undefined" en Pedidos > Confirmados (ORDEN 502 et al).
//
// Scanea:
//   - pedidos: cualquier pedido con al menos 1 línea sin `desc` (populated).
//   - revision_waitlist: cualquier doc con al menos 1 item sin `desc`.
//
// Resuelve desc desde sap_products/{code} para cada línea afectada.
// También setea `month` si el pedido lo tiene vacío (deriva de confirmedAt).
//
// Snapshot `_backfill` §55 preservado.
//
// Uso:
//   node scripts/audit/AG_backfill_desc_lineas.cjs           (dry-run)
//   node scripts/audit/AG_backfill_desc_lineas.cjs --apply  (ejecuta)

const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG = 'AG_desc_lineas_2026-10-26_v1477';
const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function hasDesc(line) {
  return !!(line && typeof line.desc === 'string' && line.desc.trim());
}

async function loadCatalog(db) {
  console.log('[1/4] Cargando catálogo (PRODUCTS inline en index.html + sap_products Firestore)...');
  const map = {};
  // 1. PRODUCTS inline en index.html (JSON array literal con double quotes).
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    const m = html.match(/const PRODUCTS = (\[[\s\S]+?\]);/);
    if (m && m[1]) {
      const products = JSON.parse(m[1]);
      for (const p of products) {
        const code = String(p.code || '').toUpperCase().trim();
        const desc = String(p.desc || '').trim();
        if (code && desc && !map[code]) map[code] = desc;
      }
      console.log(`  PRODUCTS inline: ${products.length} items, ${Object.keys(map).length} con desc`);
    }
  } catch (e) {
    console.warn('  WARN extracting PRODUCTS:', e.message);
  }
  // 2. sap_products Firestore (merge, no sobrescribe).
  const snap = await db.collection('sap_products').get();
  let added = 0;
  snap.forEach((d) => {
    const data = d.data() || {};
    const code = d.id.toUpperCase();
    const desc = String(data.descripcion || data.desc || data.name || '').trim();
    if (code && desc && !map[code]) {
      map[code] = desc;
      added++;
    }
  });
  console.log(`  sap_products: ${snap.size} SKUs (+${added} nuevos). Total: ${Object.keys(map).length}`);
  return map;
}

function deriveMonth(confirmedAtStr) {
  if (!confirmedAtStr) return '';
  try {
    const d = new Date(confirmedAtStr);
    if (Number.isNaN(d.getTime())) return '';
    return MESES_ES[d.getMonth()] + ' ' + d.getFullYear();
  } catch (_e) {
    return '';
  }
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const apply = process.argv.includes('--apply');
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('AG — Backfill desc + month en pedidos + waitlists abiertos');
  console.log('================================================================');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log();

  const catalog = await loadCatalog(db);

  // 2. Scan pedidos abiertos (closedAt=null).
  console.log('[2/4] Scan pedidos abiertos sin desc o sin month...');
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidoVictims = [];
  pedidosSnap.forEach((d) => {
    const data = d.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const linesSinDesc = lines.filter((l) => l && l.code && !hasDesc(l));
    const needMonth = !data.month;
    if (linesSinDesc.length > 0 || needMonth) {
      pedidoVictims.push({ id: d.id, ref: d.ref, data, linesSinDesc, needMonth });
    }
  });
  console.log(`  pedidos afectados: ${pedidoVictims.length}`);

  // 3. Scan waitlists abiertos.
  console.log('[3/4] Scan revision_waitlist abiertos sin desc...');
  const wlSnap = await db.collection('revision_waitlist').get();
  const wlVictims = [];
  wlSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.closedAt) return;
    if (data.stage === 'consumed') return;
    const items = Array.isArray(data.items) ? data.items : [];
    const itemsSinDesc = items.filter((it) => it && it.code && !hasDesc(it));
    if (itemsSinDesc.length > 0) {
      wlVictims.push({ id: d.id, ref: d.ref, data, itemsSinDesc });
    }
  });
  console.log(`  waitlists afectados: ${wlVictims.length}`);

  // 4. Aplicar backfill.
  console.log('[4/4] Resolviendo + aplicando...');
  let pedidosFixed = 0;
  let wlFixed = 0;
  const _detallePedidos = [];
  const batches = [[]];
  const BATCH_LIMIT = 400;

  for (const v of pedidoVictims) {
    const newLines = v.data.lines.map((l) => {
      if (hasDesc(l)) return l;
      const code = String((l && l.code) || '').toUpperCase().trim();
      if (!code || !catalog[code]) return l;
      return { ...l, desc: catalog[code] };
    });
    const linesChanged = newLines.filter((l, i) => l !== v.data.lines[i]).length;
    const newMonth = v.needMonth ? deriveMonth(v.data.confirmedAt || v.data.createdAt) : null;
    if (linesChanged === 0 && !newMonth) continue;
    pedidosFixed++;
    _detallePedidos.push({
      id: v.id,
      order: v.data.orderNumber,
      cliente: v.data.clientName,
      linesChanged,
      monthSet: !!newMonth,
    });
    if (!apply) continue;
    const update = {
      _backfill: {
        ...(v.data._backfill || {}),
        [BACKFILL_SLUG]: {
          previousLinesSinDescCount: v.linesSinDesc.length,
          previousMonth: v.data.month || null,
          by: 'scripts/audit/AG_backfill_desc_lineas.cjs',
          at: nowIso,
        },
      },
      _lastBackfillAt: nowIso,
      _lastBackfillBy: 'scripts/audit/AG_backfill_desc_lineas.cjs',
    };
    if (linesChanged > 0) update.lines = newLines;
    if (newMonth) update.month = newMonth;
    let currentBatch = batches[batches.length - 1];
    if (currentBatch.length >= BATCH_LIMIT) {
      currentBatch = [];
      batches.push(currentBatch);
    }
    currentBatch.push({ ref: v.ref, update });
  }

  for (const v of wlVictims) {
    const newItems = v.data.items.map((it) => {
      if (hasDesc(it)) return it;
      const code = String((it && it.code) || '').toUpperCase().trim();
      if (!code || !catalog[code]) return it;
      return { ...it, desc: catalog[code] };
    });
    const itemsChanged = newItems.filter((it, i) => it !== v.data.items[i]).length;
    if (itemsChanged === 0) continue;
    wlFixed++;
    if (!apply) continue;
    const update = {
      items: newItems,
      _backfill: {
        ...(v.data._backfill || {}),
        [BACKFILL_SLUG]: {
          previousItemsSinDescCount: v.itemsSinDesc.length,
          by: 'scripts/audit/AG_backfill_desc_lineas.cjs',
          at: nowIso,
        },
      },
      _lastBackfillAt: nowIso,
      _lastBackfillBy: 'scripts/audit/AG_backfill_desc_lineas.cjs',
    };
    let currentBatch = batches[batches.length - 1];
    if (currentBatch.length >= BATCH_LIMIT) {
      currentBatch = [];
      batches.push(currentBatch);
    }
    currentBatch.push({ ref: v.ref, update });
  }

  console.log();
  console.log(`Pedidos a reparar: ${pedidosFixed}`);
  console.log(`Waitlists a reparar: ${wlFixed}`);
  console.log('Primeros 15 pedidos:');
  for (const p of _detallePedidos.slice(0, 15)) {
    console.log(`  ${p.id} orden=${p.order} cliente=${p.cliente} linesFix=${p.linesChanged} monthSet=${p.monthSet}`);
  }

  if (!apply) {
    console.log();
    console.log('DRY-RUN: no se escribió nada.');
    return;
  }

  let totalWrites = 0;
  for (const batchData of batches) {
    if (batchData.length === 0) continue;
    const b = db.batch();
    for (const { ref, update } of batchData) b.update(ref, update);
    await b.commit();
    totalWrites += batchData.length;
    console.log(`  batch commit: ${batchData.length} writes (acum: ${totalWrites})`);
  }
  console.log(`\n✓ Backfill completo: ${totalWrites} docs actualizados.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
