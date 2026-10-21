// L — read-only prod: lista pedidos con source='manual-backorder' O
// transferidoSAP.via='manual-backorder' que tengan clientName vacío,
// clientCardCode vacío, o key vacío/malformado (pre-v1401 §40.9).
//
// Esos pedidos muestran "undefined - BACKORDER / cliente undefined / prospecto
// undefined" en el modal Pedidos > Confirmados.
//
// Si el doc tiene clientCardCode presente, se puede recuperar clientName del
// clientMasterCache remoto (colección client_master) → propone dry-run backfill.
// Si no, se listan para identificación manual.
//
// Dry-run por default. Flag `--apply` escribe los backfills a Firestore.
//
// Autorizado por Mariano 2026-10-21.

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('L — Pedidos manual-backorder sin cliente @ ' + nowIso);
  console.log('================================================================');

  // 1. Snapshot client_master para resolver cardCode → clientName.
  const cmSnap = await db.collection('client_master').get();
  /** @type {Map<string, {clientName:string, province:string, locality:string}>} */
  const byCardCode = new Map();
  cmSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = String(data.cardCodeSap || data.cardCode || '').trim();
    if (!cc) return;
    byCardCode.set(cc, {
      clientName: String(data.nombre || data.comercio || data.fantasia || '').trim(),
      province: String(data.provincia || '').trim(),
      locality: String(data.localidad || '').trim(),
    });
  });
  console.log('client_master cargados: ' + byCardCode.size);

  // 2. Scan pedidos manual-backorder.
  const pedidosSnap = await db.collection('pedidos').get();
  const affected = [];
  pedidosSnap.forEach((d) => {
    const p = d.data() || {};
    const isMB = p.source === 'manual-backorder' || (p.transferidoSAP && p.transferidoSAP.via === 'manual-backorder');
    if (!isMB) return;
    const clientName = String(p.clientName || '').trim();
    const cardCode = String(p.clientCardCode || '').trim();
    const key = String(p.key || '').trim();
    const keyParts = key.split('|');
    const keyBroken = !key || keyParts.length < 4 || !keyParts[3];
    const broken = !clientName || keyBroken;
    if (!broken) return;
    const totalArs = Number(p.subtotalArs || p.netAmountArs || 0);
    const skuList = (p.lines || []).map((l) => l.code).filter(Boolean).slice(0, 10);
    const createdAt = p.createdAt && typeof p.createdAt.toDate === 'function' ? p.createdAt.toDate().toISOString() : (p.createdAt || '');
    const confirmedAt = typeof p.confirmedAt === 'string' ? p.confirmedAt : (p.confirmedAt && typeof p.confirmedAt.toDate === 'function' ? p.confirmedAt.toDate().toISOString() : '');
    // Backfill: la mayoría de los casos tiene clientName + province + locName
    // YA en el doc — solo falta recomputar `key` desde esos campos.
    // Fallback adicional: si falta algún campo, consultar client_master por cardCode.
    const province = String(p.province || p.clientProvince || '').trim();
    const locName = String(p.locName || p.clientLocality || '').trim();
    let backfillClientName = clientName || null;
    let backfillProvince = province || null;
    let backfillLocality = locName || null;
    if (!backfillClientName && cardCode && byCardCode.has(cardCode)) {
      const cm = byCardCode.get(cardCode);
      backfillClientName = cm.clientName || null;
      if (!backfillProvince) backfillProvince = cm.province || null;
      if (!backfillLocality) backfillLocality = cm.locality || null;
    }
    const tipoBackfill = cardCode ? 'C' : 'P';
    const backfillKey = backfillClientName
      ? (tipoBackfill + '|' + (backfillProvince || '') + '|' + (backfillLocality || '') + '|' + backfillClientName)
      : null;
    affected.push({
      pedidoId: d.id,
      orderNumber: p.orderNumber || '',
      createdAt: createdAt.slice(0, 19),
      confirmedAt: confirmedAt.slice(0, 19),
      clientName: clientName || '(vacío)',
      clientCardCode: cardCode || '(vacío)',
      key: key || '(vacío)',
      totalArs,
      skuCount: (p.lines || []).length,
      skuSample: skuList.join(', '),
      backfillClientName,
      backfillProvince,
      backfillLocality,
      backfillKey,
      backfillable: !!backfillKey,
    });
  });

  affected.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const total = affected.length;
  const backfillable = affected.filter((r) => r.backfillable).length;
  const manual = total - backfillable;

  console.log();
  console.log('===== HALLAZGO =====');
  console.log('Pedidos manual-backorder con cliente ausente/broken: ' + total);
  console.log('  Backfilleable (hay clientCardCode + client_master): ' + backfillable);
  console.log('  Requiere identificación manual: ' + manual);
  console.log();

  console.log('===== ' + (APPLY ? 'APPLY' : 'DRY-RUN') + ' BACKFILL =====');
  let applied = 0;
  for (const r of affected) {
    if (!r.backfillable) continue;
    console.log('[' + (APPLY ? 'APPLY' : 'DRY-RUN') + '] pedidos/' + r.pedidoId);
    console.log('  orderNumber=' + r.orderNumber + ' confirmedAt=' + r.confirmedAt);
    console.log('  cardCode=' + r.clientCardCode + ' → cliente=' + r.backfillClientName);
    const updatePayload = {
      clientName: r.backfillClientName,
      province: r.backfillProvince || '',
      locName: r.backfillLocality || '',
      clientProvince: r.backfillProvince || '',
      clientLocality: r.backfillLocality || '',
      tipo: r.clientCardCode && r.clientCardCode !== '(vacío)' ? 'C' : 'P',
      key: r.backfillKey,
      backfillAt: nowIso,
      backfillSource: 'L_manual_backorder_sin_cliente.cjs',
    };
    console.log('  WOULD UPDATE: ' + JSON.stringify(updatePayload));
    if (APPLY) {
      try {
        await db.collection('pedidos').doc(r.pedidoId).update(updatePayload);
        applied += 1;
        console.log('  ✓ APPLIED');
      } catch (e) {
        console.error('  ✗ FAILED: ' + (e && e.message ? e.message : String(e)));
      }
    }
  }
  if (APPLY) console.log('Backfilled: ' + applied + '/' + affected.filter((r) => r.backfillable).length);

  console.log();
  console.log('===== PEDIDOS SIN BACKFILL AUTOMÁTICO (identificación manual) =====');
  for (const r of affected) {
    if (r.backfillable) continue;
    console.log('pedidos/' + r.pedidoId);
    console.log('  orderNumber=' + r.orderNumber + ' confirmedAt=' + r.confirmedAt + ' totalArs=' + r.totalArs);
    console.log('  clientName=' + r.clientName + ' cardCode=' + r.clientCardCode);
    console.log('  SKUs (' + r.skuCount + '): ' + r.skuSample);
  }

  // Markdown.
  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  const outPath = path.join(outDir, '31_MANUAL_BACKORDER_SIN_CLIENTE.md');
  const md = [
    '# L — Pedidos manual-backorder sin cliente @ ' + nowIso,
    '',
    'Pedidos con `source=manual-backorder` o `transferidoSAP.via=manual-backorder` que tienen `clientName` vacío o `key` malformado. En la UI aparecen como "undefined - BACKORDER / cliente undefined".',
    '',
    '## Totales',
    '',
    '- Total afectados: **' + total + '**',
    '- Backfilleable (hay clientCardCode + match en client_master): **' + backfillable + '**',
    '- Identificación manual: **' + manual + '**',
    '',
    '## Dry-run propuesto (' + backfillable + ' pedidos)',
    '',
    '| Pedido ID | Orden | Confirmado | CardCode | → ClientName | → Key |',
    '|---|---|---|---|---|---|',
    ...affected
      .filter((r) => r.backfillable)
      .map((r) => '| `' + r.pedidoId + '` | ' + r.orderNumber + ' | ' + r.confirmedAt + ' | ' + r.clientCardCode + ' | ' + r.backfillClientName + ' | `' + r.backfillKey + '` |'),
    '',
    '## Identificación manual (' + manual + ' pedidos)',
    '',
    '| Pedido ID | Orden | Confirmado | $ARS | CardCode | SKUs | SKU muestra |',
    '|---|---|---|---:|---|---:|---|',
    ...affected
      .filter((r) => !r.backfillable)
      .map((r) => '| `' + r.pedidoId + '` | ' + r.orderNumber + ' | ' + r.confirmedAt + ' | ' + r.totalArs.toLocaleString('es-AR') + ' | ' + r.clientCardCode + ' | ' + r.skuCount + ' | ' + r.skuSample + ' |'),
    '',
    '## Siguiente paso',
    '',
    'Mariano decide: aplicar backfill de los ' + backfillable + ' pedidos backfilleables (correr este script con `--apply`) o resolver uno a uno.',
    '',
    'Script: `scripts/audit/L_manual_backorder_sin_cliente.cjs`. NO escribe en prod — dry-run only.',
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
