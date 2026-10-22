// P — read-only prod: lista clientes con MÁS DE UNA orden abierta en lista
// de espera (revision_waitlist con closedAt==null y stage != 'consumed').
//
// Dry-run only. Mariano revisa y decide (el VDE puede unificar manualmente
// desde el modal con el banner "Este cliente tiene otras N órdenes abiertas").
//
// Autorizado por Mariano 2026-10-22 (§42).

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('P — Clientes con multiples waitlists abiertas @ ' + nowIso);
  console.log('================================================================');

  const snap = await db.collection('revision_waitlist').get();
  const abiertas = [];
  snap.forEach((d) => {
    const w = d.data() || {};
    if (w.closedAt) return;
    if (w.stage === 'consumed') return;
    abiertas.push({ _id: d.id, ...w });
  });
  console.log('Total waitlists abiertas: ' + abiertas.length);

  // Group por cardCode (fallback por clientName si sin cardCode).
  /** @type {Map<string, any[]>} */
  const byClient = new Map();
  for (const w of abiertas) {
    const key = String(w.clientCardCode || '').trim() || ('name:' + String(w.clientName || '').trim());
    if (!key || key === 'name:') continue;
    const list = byClient.get(key) || [];
    list.push(w);
    byClient.set(key, list);
  }

  /** @type {Array<{key:string, clientName:string, waitlists:any[]}>} */
  const multi = [];
  for (const [key, list] of byClient.entries()) {
    if (list.length < 2) continue;
    // Sort DESC por createdAt (más nueva primero).
    list.sort((a, b) => {
      const _ms = (w) => {
        const t = w.createdAt;
        if (!t) return 0;
        if (typeof t === 'string') return Date.parse(t) || 0;
        if (typeof t.toMillis === 'function') return t.toMillis();
        return 0;
      };
      return _ms(b) - _ms(a);
    });
    multi.push({ key, clientName: list[0].clientName, waitlists: list });
  }
  multi.sort((a, b) => b.waitlists.length - a.waitlists.length);

  console.log('Clientes con >= 2 órdenes abiertas: ' + multi.length);
  console.log();

  for (const m of multi) {
    console.log('CLIENTE: ' + m.clientName + ' [' + m.key + ']  (' + m.waitlists.length + ' órdenes abiertas)');
    for (const w of m.waitlists) {
      const items = Array.isArray(w.items) ? w.items : [];
      const unidades = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
      let fecha = '';
      const t = w.createdAt;
      if (t && typeof t.toDate === 'function') {
        try { fecha = t.toDate().toISOString().slice(0, 10); } catch (_e) {}
      } else if (typeof t === 'string') {
        fecha = t.slice(0, 10);
      }
      console.log('  - ORDEN ' + (w.orderNumber || '?') +
        ' | ' + items.length + ' SKU | ' + unidades + ' u | ' + fecha +
        ' | vendor=' + (w.ownerVendor || w.vendorAssigned || '?') +
        ' | source=' + (w.source || '-') +
        ' | id=' + w._id);
    }
    console.log();
  }

  // Markdown.
  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  const outPath = path.join(outDir, '34_WAITLIST_MULTIPLE_POR_CLIENTE.md');
  const md = [
    '# P — Clientes con multiples waitlists abiertas @ ' + nowIso,
    '',
    'Clientes con ≥ 2 docs en `revision_waitlist` abiertos (closedAt==null, stage!=consumed).',
    'Datos pre-§42. No se unifican automáticamente — el VDE decide desde el modal.',
    '',
    '- Total waitlists abiertas: **' + abiertas.length + '**',
    '- Clientes afectados: **' + multi.length + '**',
    '',
    multi.length === 0 ? '_(ninguno — todos los clientes tienen 0 o 1 orden abierta)_' : '',
    '',
    ...multi.flatMap((m) => [
      '## ' + m.clientName + ' — `' + m.key + '`  (' + m.waitlists.length + ' órdenes abiertas)',
      '',
      '| Orden | SKUs | Unidades | Fecha | Vendor | Source | ID |',
      '|---:|---:|---:|---|---|---|---|',
      ...m.waitlists.map((w) => {
        const items = Array.isArray(w.items) ? w.items : [];
        const unidades = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
        let fecha = '';
        const t = w.createdAt;
        if (t && typeof t.toDate === 'function') {
          try { fecha = t.toDate().toISOString().slice(0, 10); } catch (_e) {}
        } else if (typeof t === 'string') fecha = t.slice(0, 10);
        return '| ' + (w.orderNumber || '?') + ' | ' + items.length + ' | ' + unidades +
          ' | ' + fecha + ' | ' + (w.ownerVendor || w.vendorAssigned || '?') +
          ' | ' + (w.source || '-') + ' | `' + w._id + '` |';
      }),
      '',
    ]),
    '',
    'Script: `scripts/audit/P_clientes_multiple_waitlists.cjs` (read-only).',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    console.log('Markdown escrito en ' + outPath);
  } catch (e) {
    console.error('No se pudo escribir markdown: ' + (e && e.message ? e.message : String(e)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
