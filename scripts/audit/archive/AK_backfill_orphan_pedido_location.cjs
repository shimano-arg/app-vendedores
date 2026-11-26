// AK — v1484 §83 (2026-10-27) backfill prov/loc en pedidos huérfanos.
//
// Pedido Mariano: cuando un pedido tiene province/locName vacíos (o no
// matcheados contra POINTS + altas), resolver desde client_master por
// cardCode. Caso real: BENGOCHEA ORDEN 356 Oct 2026 "/" en la tarjeta.
//
// Dry-run por default. Lista cada pedido huérfano con la resolución
// propuesta. Esperar OK Mariano antes de `--apply`.
//
// Uso:
//   node scripts/audit/AK_backfill_orphan_pedido_location.cjs           (dry-run)
//   node scripts/audit/AK_backfill_orphan_pedido_location.cjs --apply  (ejecuta)

const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG = 'AK_orphan_loc_2026-10-27_v1484';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const { resolveOrphanPedidoLocation } = await import('../../src/pure/resolve-orphan-pedido-location.js');

  const apply = process.argv.includes('--apply');
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('AK — Backfill prov/loc pedidos huérfanos (v1484 §83)');
  console.log('================================================================');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log();

  // 1. Cargar client_master en Map + POINTS del index.html.
  console.log('[1/3] Cargando client_master + POINTS...');
  const cmSnap = await db.collection('client_master').get();
  const clientMasterCache = new Map();
  cmSnap.forEach((d) => {
    clientMasterCache.set(d.id, d.data() || {});
  });
  console.log(`  client_master: ${clientMasterCache.size} docs`);
  // POINTS inline en index.html (padrón de tiendas del mapa).
  const fs = require('node:fs');
  const path = require('node:path');
  let POINTS = [];
  try {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    // Buscar inicio del array POINTS y cerrar con conteo manual de brackets
    // (regex no-greedy no funciona porque el padrón tiene arrays anidados).
    const start = html.indexOf('const POINTS = [');
    if (start >= 0) {
      let depth = 0;
      let i = start + 'const POINTS = '.length; // apunta al '['
      const arrStart = i;
      for (; i < html.length; i++) {
        const c = html[i];
        if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) {
            POINTS = JSON.parse(html.slice(arrStart, i + 1));
            break;
          }
        }
      }
    }
  } catch (e) {
    console.warn('  POINTS extract failed:', e.message);
  }
  console.log(`  POINTS: ${POINTS.length} tiendas`);

  // 2. Scan pedidos huérfanos.
  console.log('[2/3] Scan pedidos con province o locName vacíos...');
  const pedSnap = await db.collection('pedidos').get();
  const victims = [];
  let totalPedidos = 0;
  let totalConProvLocVacio = 0;
  pedSnap.forEach((d) => {
    totalPedidos++;
    const data = d.data() || {};
    const prov = String(data.province || '').trim();
    const loc = String(data.locName || '').trim();
    const cardCode = String(data.clientCardCode || '').trim();
    // Víctima: prov o loc vacíos (los dos tienen que estar presentes para la UI).
    if (prov && loc) return;
    totalConProvLocVacio++;
    const resolved = resolveOrphanPedidoLocation(
      { province: prov, locName: loc, clientCardCode: cardCode, clientName: data.clientName },
      clientMasterCache,
      POINTS
    );
    victims.push({ id: d.id, ref: d.ref, data, resolved });
  });
  console.log(`  total pedidos: ${totalPedidos}`);
  console.log(`  huérfanos (prov o loc vacíos): ${totalConProvLocVacio}`);

  // 3. Analizar resoluciones.
  const resolvible = victims.filter((v) => v.resolved.resolvedFromMaster);
  const noResolvible = victims.filter((v) => !v.resolved.resolvedFromMaster);
  console.log(`  resolvible desde client_master: ${resolvible.length}`);
  console.log(`  NO resolvible (sin match o master incompleto): ${noResolvible.length}`);
  console.log();

  // 4. Imprimir detalle.
  if (resolvible.length > 0) {
    console.log('--- RESOLVIBLES (se van a completar) ---');
    for (const v of resolvible) {
      const d = v.data;
      console.log(
        `  ORDEN ${d.orderNumber || '-'} id=${v.id} cliente="${d.clientName}" ` +
          `cardCode=${d.clientCardCode || '-'}`
      );
      console.log(
        `    actual:    province="${d.province || ''}" locName="${d.locName || ''}"`
      );
      console.log(
        `    propuesto: province="${v.resolved.province}" locName="${v.resolved.locName}" ` +
          `(source=${v.resolved.source})`
      );
    }
    console.log();
  }

  if (noResolvible.length > 0) {
    console.log('--- NO RESOLVIBLES (quedarán con badge "sin catálogo") ---');
    for (const v of noResolvible) {
      const d = v.data;
      console.log(
        `  ORDEN ${d.orderNumber || '-'} id=${v.id} cliente="${d.clientName}" ` +
          `cardCode=${d.clientCardCode || '-'} ` +
          `(prov actual="${d.province || ''}" loc actual="${d.locName || ''}")`
      );
    }
    console.log();
  }

  // 5. Resumen final.
  console.log('================================================================');
  console.log('RESUMEN');
  console.log('================================================================');
  console.log(`Pedidos huérfanos HOY:                   ${victims.length}`);
  console.log(`A resolver con client_master:            ${resolvible.length}`);
  console.log(`Quedan sin resolver post-backfill:       ${noResolvible.length}`);
  console.log();

  if (!apply) {
    console.log('DRY-RUN: no se escribió nada.');
    console.log('Para aplicar: node scripts/audit/AK_backfill_orphan_pedido_location.cjs --apply');
    return;
  }

  // 6. Apply.
  console.log('[3/3] Aplicando backfill con snapshot _backfill §55...');
  const batches = [[]];
  const BATCH_LIMIT = 400;
  for (const v of resolvible) {
    const update = {
      province: v.resolved.province,
      locName: v.resolved.locName,
      _backfill: {
        ...(v.data._backfill || {}),
        [BACKFILL_SLUG]: {
          previousValues: {
            province: v.data.province || null,
            locName: v.data.locName || null,
          },
          resolvedFrom: 'client_master',
          cardCode: v.data.clientCardCode || null,
          by: 'scripts/audit/AK_backfill_orphan_pedido_location.cjs',
          at: nowIso,
        },
      },
      _lastBackfillAt: nowIso,
      _lastBackfillBy: 'scripts/audit/AK_backfill_orphan_pedido_location.cjs',
    };
    let cur = batches[batches.length - 1];
    if (cur.length >= BATCH_LIMIT) {
      cur = [];
      batches.push(cur);
    }
    cur.push({ ref: v.ref, update });
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
  console.log(`\n✓ Backfill completo: ${totalWrites} pedidos actualizados.`);
}

main().catch((e) => { console.error('ERR:', e); process.exit(1); });
