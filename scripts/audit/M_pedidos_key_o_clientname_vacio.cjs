// M — read-only prod: barrido global de pedidos de CUALQUIER origen con
// `key` vacía/malformada o `clientName` vacío. No se limita a manual-backorder.
//
// Dry-run only. Mariano decide por caso qué hacer.
//
// Autorizado por Mariano 2026-10-21.

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('M — Barrido global pedidos con key/clientName vacíos @ ' + nowIso);
  console.log('================================================================');

  const pedidosSnap = await db.collection('pedidos').get();
  console.log('Total pedidos: ' + pedidosSnap.size);

  const affected = [];
  pedidosSnap.forEach((d) => {
    const p = d.data() || {};
    const clientName = String(p.clientName || '').trim();
    const key = String(p.key || '').trim();
    const keyParts = key.split('|');
    const keyBroken = !key || keyParts.length < 4 || !keyParts[3];
    const nameBroken = !clientName;
    if (!keyBroken && !nameBroken) return;
    const createdAt = p.createdAt && typeof p.createdAt.toDate === 'function' ? p.createdAt.toDate().toISOString() : (p.createdAt || '');
    const confirmedAt = typeof p.confirmedAt === 'string' ? p.confirmedAt : (p.confirmedAt && typeof p.confirmedAt.toDate === 'function' ? p.confirmedAt.toDate().toISOString() : '');
    const origen = p.source || (p.transferidoSAP && p.transferidoSAP.via) || p.migrationSource || '(sin origen)';
    const skuList = (p.lines || []).map((l) => l.code).filter(Boolean).slice(0, 10);
    const totalArs = Number(p.subtotalArs || p.netAmountArs || 0);
    // Backfill proposal igual que script L.
    const province = String(p.province || p.clientProvince || '').trim();
    const locName = String(p.locName || p.clientLocality || '').trim();
    const cardCode = String(p.clientCardCode || '').trim();
    const backfillClientName = clientName || null;
    const tipoBackfill = cardCode ? 'C' : 'P';
    const backfillKey = backfillClientName
      ? (tipoBackfill + '|' + province + '|' + locName + '|' + backfillClientName)
      : null;
    affected.push({
      pedidoId: d.id,
      orderNumber: p.orderNumber || '',
      origen,
      stage: p.stage || '',
      createdAt: createdAt.slice(0, 19),
      confirmedAt: confirmedAt.slice(0, 19),
      clientName: clientName || '(vacío)',
      clientCardCode: cardCode || '(vacío)',
      province: province || '(vacío)',
      locName: locName || '(vacío)',
      key: key || '(vacío)',
      totalArs,
      skuCount: (p.lines || []).length,
      skuSample: skuList.join(', '),
      issue: nameBroken && keyBroken ? 'clientName+key vacíos' : (nameBroken ? 'clientName vacío' : 'key vacía/malformada'),
      backfillKey,
      backfillable: !!backfillKey && !nameBroken,
    });
  });

  affected.sort((a, b) => (b.confirmedAt || '').localeCompare(a.confirmedAt || ''));

  const totals = affected.length;
  const porOrigen = affected.reduce((acc, r) => { acc[r.origen] = (acc[r.origen] || 0) + 1; return acc; }, {});

  console.log();
  console.log('===== HALLAZGO =====');
  console.log('Total pedidos broken: ' + totals);
  console.log('Por origen:');
  for (const [k, v] of Object.entries(porOrigen)) console.log('  ' + k + ': ' + v);
  console.log();

  console.log('===== DRY-RUN (NO escribe) =====');
  for (const r of affected) {
    console.log('pedidos/' + r.pedidoId + ' ORDEN=' + r.orderNumber + ' origen=' + r.origen);
    console.log('  issue=' + r.issue + ' stage=' + r.stage + ' confirmedAt=' + r.confirmedAt);
    console.log('  clientName=' + r.clientName + ' cardCode=' + r.clientCardCode);
    console.log('  province=' + r.province + ' locName=' + r.locName);
    console.log('  key=' + r.key);
    console.log('  totalArs=' + r.totalArs + ' SKUs=' + r.skuCount + ' muestra=' + r.skuSample);
    if (r.backfillable) {
      console.log('  → BACKFILLEABLE: key=' + r.backfillKey);
    } else {
      console.log('  → NO backfilleable (requiere identificación manual)');
    }
    console.log('');
  }

  // Markdown.
  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  const outPath = path.join(outDir, '32_PEDIDOS_KEY_CLIENTNAME_VACIO.md');
  const md = [
    '# M — Barrido global pedidos con key/clientName vacíos @ ' + nowIso,
    '',
    'Pedidos de **cualquier origen** con `key` vacía/malformada o `clientName` vacío.',
    '',
    '## Hallazgo',
    '',
    '- Total pedidos escaneados: **' + pedidosSnap.size + '**',
    '- Pedidos broken: **' + totals + '**',
    '',
    '### Por origen',
    '',
    ...Object.entries(porOrigen).map(([k, v]) => '- ' + k + ': ' + v),
    '',
    '## Dry-run detalle',
    '',
    totals === 0 ? '_(ninguno — todos los pedidos tienen key canónica y clientName)_' : '',
    '',
    totals > 0 ? '| Pedido ID | Orden | Origen | Stage | Issue | ClientName | CardCode | Confirmado | Backfill |' : '',
    totals > 0 ? '|---|---|---|---|---|---|---|---|---|' : '',
    ...affected.map((r) => '| `' + r.pedidoId + '` | ' + r.orderNumber + ' | ' + r.origen + ' | ' + r.stage + ' | ' + r.issue + ' | ' + r.clientName + ' | ' + r.clientCardCode + ' | ' + r.confirmedAt + ' | ' + (r.backfillable ? '`' + r.backfillKey + '`' : 'manual') + ' |'),
    '',
    '## Siguiente paso',
    '',
    totals === 0
      ? '**Nada que hacer.** Todos los pedidos pasan la validación key canónica + clientName.'
      : 'Mariano decide por caso qué hacer. **NO se aplica backfill automático** — este script es read-only.',
    '',
    'Script: `scripts/audit/M_pedidos_key_o_clientname_vacio.cjs` (dry-run only).',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    console.log();
    console.log('Markdown escrito en ' + outPath);
  } catch (e) {
    console.error('No se pudo escribir markdown: ' + (e && e.message ? e.message : String(e)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
