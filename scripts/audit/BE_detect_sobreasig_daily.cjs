#!/usr/bin/env node
// BE_detect_sobreasig_daily — watchdog diario SOLO LECTURA.
//
// Precedente CLAUDE.md §56/§40.8: sobre-asignacion aparece cuando la suma
// de unidades "comprometidas" en la app (ASIG + confirmed-sin-SO) excede
// el stock fisico del dep 11.
//
// Confirmed con `transferidoSAP.orderDocEntry != null` NO reserva en la
// app (§40.8): SAP ya la descuenta de Available. Entonces el riesgo
// REAL son las Cotizaciones sin SO: estan en la Quotation de SAP pero
// SAP no las descuenta todavia — si otro cliente factura primero, el
// cliente con solo-Cotizacion se queda sin stock.
//
// Precedente concreto 2026-11-25 reportado por Mariano:
// SKU CLC66H2PY (Shimano Clarus 6'6" Casting): fisico=4, 12u confirmed
// (ARIZAGA, LA LOMITA x2, PONTORIERO, ANGLER, ROMERO). ANGLER + ROMERO
// solo tenian Cotizacion (orderDocEntry=undefined) → 4u en riesgo si
// SAP factura las otras 8u primero.
//
// Objetivo: detectar diariamente SKUs con riesgo + mandar email a
// Mariano con tabla clara: qty_riesgo + clientes afectados + SO count.
//
// Uso:
//   node scripts/audit/BE_detect_sobreasig_daily.cjs
//   node scripts/audit/BE_detect_sobreasig_daily.cjs --json=/tmp/out.json
//   node scripts/audit/BE_detect_sobreasig_daily.cjs --min=1 --max-rows=100
'use strict';

const PROJECT = 'app-vendedores-shimano';
const admin = require('../../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

function parseArgs(argv) {
  const out = { jsonPath: null, minRiesgoUnits: 1, maxRows: 200 };
  for (const a of argv) {
    if (a.startsWith('--json=')) out.jsonPath = a.slice(7);
    else if (a.startsWith('--min=')) out.minRiesgoUnits = Math.max(1, Number(a.slice(6)) || 1);
    else if (a.startsWith('--max-rows=')) out.maxRows = Math.max(1, Number(a.slice(11)) || 200);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('================================================================');
  console.log(' BE — Watchdog diario SOBRE-ASIGNACION');
  console.log(' Modo: SOLO LECTURA (sin writes)');
  console.log(` Filtro: SKUs con riesgo >= ${args.minRiesgoUnits} u`);
  console.log('================================================================');

  // 1. Stock snapshot: physical quantities por SKU.
  console.log('[1/4] Cargando app_config/stock_snapshot...');
  const stockSnap = await db.collection('app_config').doc('stock_snapshot').get();
  if (!stockSnap.exists) {
    console.error('FATAL: no existe app_config/stock_snapshot');
    process.exit(2);
  }
  const sd = stockSnap.data() || {};
  let quantitiesMap = {};
  try {
    quantitiesMap = JSON.parse(sd.quantities || '{}');
  } catch (_e) {
    console.error('FATAL: no pude parsear stock_snapshot.quantities');
    process.exit(2);
  }
  const snapshotUpdatedAt = sd.updatedAt && sd.updatedAt.toDate
    ? sd.updatedAt.toDate().toISOString()
    : String(sd.updatedAt || '');
  console.log(`  SKUs en snapshot: ${Object.keys(quantitiesMap).length}`);
  console.log(`  snapshot updatedAt: ${snapshotUpdatedAt}`);

  // 2. Pedidos abiertos con confirmed o ASIG activos.
  console.log('[2/4] Cargando pedidos abiertos (closedAt == null)...');
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log(`  pedidos abiertos: ${pedidosSnap.size}`);

  // 3. Acumular por SKU.
  //   perSku[sku] = {
  //     asigUnits: n, confirmedSinSOUnits: n, confirmedConSOUnits: n,
  //     clientesConfirmedSinSO: [{cliente, orderNumber, qty, cotizacionDocNum}],
  //     clientesConfirmedConSO: [{cliente, orderNumber, qty, sapOrderDocNum}],
  //     clientesAsig: [{cliente, orderNumber, qty}],
  //   }
  const perSku = {};
  function getBucket(sku) {
    if (!perSku[sku]) {
      perSku[sku] = {
        asigUnits: 0,
        confirmedSinSOUnits: 0,
        confirmedConSOUnits: 0,
        clientesConfirmedSinSO: [],
        clientesConfirmedConSO: [],
        clientesAsig: [],
      };
    }
    return perSku[sku];
  }

  pedidosSnap.forEach((doc) => {
    const d = doc.data() || {};
    const lines = Array.isArray(d.lines) ? d.lines : [];
    const cliente = d.clientName || '(sin nombre)';
    const orderNumber = d.orderNumber || '-';
    const tSap = d.transferidoSAP || {};
    const sapDocNum = tSap.docNum || null;
    const sapOrderDocNum = tSap.orderDocNum || null;
    const sapOrderDocEntry = tSap.orderDocEntry != null ? tSap.orderDocEntry : null;

    for (const ln of lines) {
      if (!ln) continue;
      const sku = String(ln.code || '').trim();
      if (!sku) continue;
      const qtyOpen = Number(ln.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      const bucket = getBucket(sku);

      if (ln.state === 'ASIG') {
        bucket.asigUnits += qtyOpen;
        bucket.clientesAsig.push({ cliente, orderNumber, qty: qtyOpen });
      } else if (ln.state === 'confirmed') {
        if (sapOrderDocEntry != null) {
          bucket.confirmedConSOUnits += qtyOpen;
          bucket.clientesConfirmedConSO.push({
            cliente,
            orderNumber,
            qty: qtyOpen,
            sapOrderDocNum: sapOrderDocNum || '-',
          });
        } else {
          bucket.confirmedSinSOUnits += qtyOpen;
          bucket.clientesConfirmedSinSO.push({
            cliente,
            orderNumber,
            qty: qtyOpen,
            cotizacionDocNum: sapDocNum || '-',
          });
        }
      }
    }
  });

  // 4. Computar riesgo por SKU.
  //    riesgo = max(0, (asig + confirmed_sin_SO + confirmed_con_SO) − fisico).
  //    Las confirmed CON SO SAP ya las descuenta (§40.8), pero las contamos
  //    en el total porque si fisico < sum(todo) hay tensión real.
  //    Sin embargo el RIESGO específico es la parte sin SO — si fisico cubre
  //    las SO + algo de sin-SO queda OK; si no, las sin-SO están expuestas.
  console.log('[3/4] Computando sobre-asignacion por SKU...');
  const rows = [];
  for (const sku of Object.keys(perSku)) {
    const b = perSku[sku];
    const fisico = Number(quantitiesMap[sku]) || 0;
    const comprometidoTotal = b.asigUnits + b.confirmedSinSOUnits + b.confirmedConSOUnits;
    // Riesgo: unidades sin SO que no tienen respaldo fisico (despues de que
    // las SO ya se llevaron lo suyo). Formula:
    //   fisicoLibre = max(0, fisico - asig - confirmedConSO)
    //   riesgo = max(0, confirmedSinSO - fisicoLibre)
    const fisicoLibreParaSinSO = Math.max(0, fisico - b.asigUnits - b.confirmedConSOUnits);
    const riesgoSinSO = Math.max(0, b.confirmedSinSOUnits - fisicoLibreParaSinSO);
    // Riesgo ASIG puro: si fisico < asig (sobre-asignacion que §40.11 revierte).
    const riesgoAsig = Math.max(0, b.asigUnits - fisico);

    if (riesgoSinSO + riesgoAsig < args.minRiesgoUnits) continue;

    rows.push({
      sku,
      fisico,
      asigUnits: b.asigUnits,
      confirmedSinSOUnits: b.confirmedSinSOUnits,
      confirmedConSOUnits: b.confirmedConSOUnits,
      comprometidoTotal,
      riesgoSinSO,
      riesgoAsig,
      riesgoTotal: riesgoSinSO + riesgoAsig,
      clientesConfirmedSinSO: b.clientesConfirmedSinSO,
      clientesConfirmedConSO: b.clientesConfirmedConSO,
      clientesAsig: b.clientesAsig,
    });
  }

  rows.sort((a, b) => b.riesgoTotal - a.riesgoTotal);
  const topRows = rows.slice(0, args.maxRows);
  const totalSkusConRiesgo = rows.length;
  const totalUnidadesEnRiesgo = rows.reduce((s, r) => s + r.riesgoTotal, 0);

  console.log(`  SKUs con riesgo: ${totalSkusConRiesgo}`);
  console.log(`  Unidades totales en riesgo: ${totalUnidadesEnRiesgo}`);
  console.log('');

  // Tabla ASCII (top N).
  console.log('[4/4] Resultados (top ' + topRows.length + ')');
  console.log('');
  console.log('SKU                          | Fisico | ASIG | ConfSinSO | ConfConSO | Riesgo | Clientes en riesgo');
  console.log('-----------------------------|--------|------|-----------|-----------|--------|-------------------');
  for (const r of topRows) {
    const skuLabel = r.sku.padEnd(28).slice(0, 28);
    const fis = String(r.fisico).padStart(6);
    const asg = String(r.asigUnits).padStart(4);
    const sinSO = String(r.confirmedSinSOUnits).padStart(9);
    const conSO = String(r.confirmedConSOUnits).padStart(9);
    const rie = String(r.riesgoTotal).padStart(6);
    const clientes = r.clientesConfirmedSinSO
      .map((c) => `${c.cliente} ${c.qty}u (orden ${c.orderNumber})`)
      .join('; ');
    console.log(`${skuLabel} | ${fis} | ${asg} | ${sinSO} | ${conSO} | ${rie} | ${clientes.slice(0, 80)}`);
  }

  // Output JSON opcional.
  const output = {
    generatedAt: new Date().toISOString(),
    snapshotUpdatedAt,
    totalSkusConRiesgo,
    totalUnidadesEnRiesgo,
    minRiesgoUnits: args.minRiesgoUnits,
    rows: topRows,
  };
  if (args.jsonPath) {
    require('fs').writeFileSync(args.jsonPath, JSON.stringify(output, null, 2));
    console.log('');
    console.log(`JSON escrito en: ${args.jsonPath}`);
  }

  // Markdown siempre en workflow directory (CI puede subir como artifact).
  const mdLines = [
    '# Watchdog sobre-asignacion — reporte diario',
    '',
    `**Generado**: ${output.generatedAt}`,
    `**Snapshot stock usado**: ${snapshotUpdatedAt}`,
    `**SKUs con riesgo**: ${totalSkusConRiesgo}`,
    `**Unidades totales en riesgo**: ${totalUnidadesEnRiesgo}`,
    '',
    '## Metodologia',
    '',
    '- `confirmedSinSO`: lineas state=confirmed sin `transferidoSAP.orderDocEntry` → SAP aun no descuenta (Cotizacion abierta pero sin SO). Si otro cliente factura primero, se queda sin stock.',
    '- `confirmedConSO`: lineas con SO SAP creada. §40.8 dice que no reserva en la app porque SAP ya descuenta de Available.',
    '- `ASIG`: lineas state=ASIG con `qtyOpen > 0`.',
    '- `fisicoLibreParaSinSO = max(0, fisico - asig - confirmedConSO)`.',
    '- `riesgoSinSO = max(0, confirmedSinSO - fisicoLibreParaSinSO)`.',
    '- `riesgoAsig = max(0, asig - fisico)` — deberia revertirse automaticamente (§40.11), si aparece es sintoma.',
    '',
    '## Top SKUs en riesgo',
    '',
    '| SKU | Fisico | ASIG | ConfSinSO | ConfConSO | Riesgo | Clientes en riesgo |',
    '|---|---:|---:|---:|---:|---:|---|',
  ];
  for (const r of topRows) {
    const clientes = r.clientesConfirmedSinSO
      .map((c) => `${c.cliente} (${c.qty}u, orden ${c.orderNumber}, cot ${c.cotizacionDocNum})`)
      .join('<br>');
    mdLines.push(
      `| ${r.sku} | ${r.fisico} | ${r.asigUnits} | ${r.confirmedSinSOUnits} | ${r.confirmedConSOUnits} | ${r.riesgoTotal} | ${clientes || '(solo ASIG)'} |`
    );
  }
  if (topRows.length === 0) {
    mdLines.push('| (sin SKUs en riesgo) | - | - | - | - | - | - |');
  }
  mdLines.push('');
  mdLines.push('## Que hacer');
  mdLines.push('');
  mdLines.push('Para cada SKU con `riesgoSinSO > 0`:');
  mdLines.push('1. Revisar si llega mas stock proximo (compra en curso, ingreso en transito).');
  mdLines.push('2. Priorizar transferir Cotizacion → SO para los clientes criticos (asi SAP se las descuenta primero).');
  mdLines.push('3. Si NO llega stock: avisar al cliente antes que el otro facture.');
  mdLines.push('');

  const mdPath = require('path').join(process.cwd(), 'RAW_SOBREASIG_WATCHDOG.md');
  require('fs').writeFileSync(mdPath, mdLines.join('\n'), 'utf8');
  console.log('');
  console.log(`Markdown escrito en: ${mdPath}`);

  // Exit code: 0 si no hay riesgo, 1 si hay (para CI alertar).
  if (totalUnidadesEnRiesgo >= args.minRiesgoUnits) {
    console.log('');
    console.log(`ALERT: ${totalUnidadesEnRiesgo} unidades en riesgo >= min ${args.minRiesgoUnits}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
