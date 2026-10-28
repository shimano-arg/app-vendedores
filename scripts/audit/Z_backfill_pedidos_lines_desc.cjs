// Z — v1504 PR2 (2026-10-28) — backfill `line.desc` en pedidos ABIERTOS cuando
// la snapshot al confirmar diverge del catálogo vigente.
//
// Dry-run por default. `--apply` ejecuta.
//
// Scope:
//   - `pedidos` con `closedAt == null` (abiertos). PEDIDOS CERRADOS NO SE TOCAN.
//   - Líneas con `line.desc` !== `catalog[line.code].desc` (ambas populated).
//   - Caso "EMPTY_LINE" (desc vacía + catalog populated) también se backfillea.
//   - Caso "MISSING_CATALOG" (catalog no tiene desc del SKU) NO se toca.
//
// Snapshot `_backfill` §55 por doc (`_backfill.Z_desc_catalog_sync_<fecha>_v1504.previousValues.lines[lineIndex].desc`).
//
// Uso:
//   node scripts/audit/Z_backfill_pedidos_lines_desc.cjs            (dry-run)
//   node scripts/audit/Z_backfill_pedidos_lines_desc.cjs --apply   (ejecuta)
//
// AUTORIZACIÓN: `--apply` requiere OK explícito de Mariano. El PR2 solo deja
// shippeado el dry-run; el apply se corre aparte post-review.

const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG_PREFIX = 'Z_desc_catalog_sync';

function nowSlug() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_v1504`;
}

async function loadCatalog(db) {
  const map = {};
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
        if (code && desc) map[code] = desc;
      }
    }
  } catch (e) {
    console.warn('WARN extracting PRODUCTS:', e.message);
  }
  try {
    const snap = await db.collection('sap_products').get();
    snap.forEach((d) => {
      const code = d.id.toUpperCase().trim();
      const data = d.data() || {};
      const desc = String(data.descripcion || data.desc || data.name || '').trim();
      if (code && desc && !map[code]) map[code] = desc;
    });
  } catch (_e) {
    // ok si no existe
  }
  return map;
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const apply = process.argv.includes('--apply');
  const nowIso = new Date().toISOString();
  const slug = `${BACKFILL_SLUG_PREFIX}_${nowSlug()}`;

  console.log('================================================================');
  console.log(`Z — backfill desc divergente ${apply ? '(APPLY)' : '(dry-run)'}`);
  console.log(`Slug: ${slug}`);
  console.log('================================================================');

  console.log('[1/3] Cargando catálogo...');
  const catalog = await loadCatalog(db);
  console.log('  Items en catalog: ' + Object.keys(catalog).length);

  console.log('[2/3] Scanning pedidos abiertos...');
  const snap = await db
    .collection('pedidos')
    .where('closedAt', '==', null)
    .get();
  console.log('  Pedidos abiertos: ' + snap.size);

  let affectedPedidos = 0;
  let affectedLines = 0;
  const samples = [];

  for (const d of snap.docs) {
    const data = d.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (!lines.length) continue;
    /** @type {Record<number, string>} */
    const previousDescByIndex = {};
    const newLines = lines.map((l, idx) => {
      if (!l || !l.code) return l;
      const code = String(l.code).toUpperCase().trim();
      const lineDesc = String(l.desc || '').trim();
      const catalogDesc = catalog[code] || '';
      if (!catalogDesc) return l;
      if (lineDesc === catalogDesc) return l;
      // Diverge: backfillear.
      previousDescByIndex[idx] = lineDesc; // snapshot
      return { ...l, desc: catalogDesc };
    });
    const diverged = Object.keys(previousDescByIndex);
    if (diverged.length === 0) continue;
    affectedPedidos++;
    affectedLines += diverged.length;
    if (samples.length < 10) {
      samples.push({
        pedidoId: d.id,
        orderNumber: data.orderNumber || null,
        divergedCount: diverged.length,
        sampleLine: {
          idx: Number(diverged[0]),
          code: lines[Number(diverged[0])].code,
          before: previousDescByIndex[Number(diverged[0])],
          after: newLines[Number(diverged[0])].desc,
        },
      });
    }
    if (apply) {
      // Backfill con snapshot §55.
      const existingBackfill = (data._backfill && typeof data._backfill === 'object') ? data._backfill : {};
      const backfillEntry = {
        previousValues: {
          lines: previousDescByIndex, // {idx: oldDesc}
        },
        by: 'scripts/audit/Z_backfill_pedidos_lines_desc.cjs',
        at: nowIso,
      };
      await d.ref.update({
        lines: newLines,
        _backfill: { ...existingBackfill, [slug]: backfillEntry },
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'scripts/audit/Z_backfill_pedidos_lines_desc.cjs',
      });
    }
  }

  console.log('[3/3] Resumen');
  console.log('  Pedidos afectados: ' + affectedPedidos);
  console.log('  Líneas afectadas: ' + affectedLines);
  console.log('  Modo: ' + (apply ? 'APPLY (persistido)' : 'DRY-RUN (nada escrito)'));
  console.log('');
  console.log('Primeros 10 pedidos afectados (sample):');
  for (const s of samples) {
    console.log(`  - ORDEN ${s.orderNumber || '?'} (${s.pedidoId}) — ${s.divergedCount} línea(s) divergen`);
    console.log(`      [${s.sampleLine.idx}] ${s.sampleLine.code}: "${s.sampleLine.before.slice(0, 60)}" → "${s.sampleLine.after.slice(0, 60)}"`);
  }
  if (!apply && affectedPedidos > 0) {
    console.log('');
    console.log('Para persistir: node scripts/audit/Z_backfill_pedidos_lines_desc.cjs --apply');
    console.log('(requiere autorización explícita de Mariano por CLAUDE.md §55)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
