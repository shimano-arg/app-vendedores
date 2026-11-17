#!/usr/bin/env node
/**
 * V_dep12_state_prod.cjs — audit READ-ONLY del estado actual de dep 12 en prod.
 *
 * Reparto dep 12 feature (plan 2026-11-17 reparto-dep12 §E0).
 *
 * Qué muestra:
 *   1. SKUs con qty > 0 en dep 12 (tránsito actual).
 *   2. Pedidos con líneas ASIG actuales por SKU (contexto contra el que Pablo asignaría).
 *   3. Ingresos_reparto abiertos que apuntan a esos SKUs (riesgo de doble reparto post-feature).
 *
 * Sirve para snapshotear el estado baseline ANTES de arrancar E1.
 *
 * Uso:
 *   $env:FIREBASE_SA_PATH = "C:\Users\...\auditoria-sa.json"
 *   node scripts/audit/V_dep12_state_prod.cjs [--limit=50]
 *
 * No escribe nada. Sólo imprime tabla + resumen.
 *
 * Exit:
 *   0 OK
 *   2 Env vars / credenciales mal
 */
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ID = 'app-vendedores-shimano';

function resolveCreds() {
  const saPath = process.env.FIREBASE_SA_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!saPath) {
    console.error('[FATAL] FIREBASE_SA_PATH no está en env (o pasar GOOGLE_APPLICATION_CREDENTIALS).');
    process.exit(2);
  }
  if (!fs.existsSync(saPath)) {
    console.error(`[FATAL] ${saPath} no existe.`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(saPath, 'utf-8'));
}

async function main() {
  const limit = parseInt(
    (process.argv.find((a) => a.startsWith('--limit=')) || '--limit=50').split('=')[1],
    10,
  ) || 50;

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(resolveCreds()),
      projectId: PROJECT_ID,
    });
  }
  const db = admin.firestore();

  console.log(`[audit V] project=${PROJECT_ID} limit=${limit}`);
  console.log('[audit V] reading app_config/stock_snapshot...');
  const snapRef = await db.collection('app_config').doc('stock_snapshot').get();
  if (!snapRef.exists) {
    console.error('[FATAL] stock_snapshot no existe');
    process.exit(2);
  }
  const snap = snapRef.data();
  const updatedAt = snap._syncRun && snap._syncRun.endedAt;
  console.log(`[audit V] snapshot last sync: ${updatedAt}`);

  // Parse warehouseBreakdown (JSON string).
  let whsBd = {};
  try {
    whsBd = snap.warehouseBreakdown ? JSON.parse(snap.warehouseBreakdown) : {};
  } catch (e) {
    console.error(`[FATAL] parsing warehouseBreakdown: ${e.message}`);
    process.exit(2);
  }

  // Filtrar SKUs con dep 12 > 0.
  const skusConTransito = [];
  for (const [sku, whs] of Object.entries(whsBd)) {
    const q12 = Number(whs && whs['12']) || 0;
    if (q12 > 0) {
      skusConTransito.push({
        sku,
        q11: Number(whs['11']) || 0,
        q12,
      });
    }
  }
  skusConTransito.sort((a, b) => b.q12 - a.q12);

  console.log(`\n[audit V] SKUs con dep 12 > 0: ${skusConTransito.length}`);
  if (skusConTransito.length === 0) {
    console.log('  (Hoy no hay stock en tránsito — Uruguay no despachó recientemente.)');
    console.log('  Feature va a quedar quiescente hasta que haya tránsito activo.\n');
  } else {
    console.log('\n  Top SKUs con tránsito:');
    console.log('  ' + 'SKU'.padEnd(20) + 'dep11'.padStart(8) + 'dep12'.padStart(8));
    for (const s of skusConTransito.slice(0, limit)) {
      console.log(
        '  ' + s.sku.padEnd(20) + String(s.q11).padStart(8) + String(s.q12).padStart(8),
      );
    }
    const totalU12 = skusConTransito.reduce((acc, s) => acc + s.q12, 0);
    console.log(`\n  Total unidades en tránsito: ${totalU12}`);
  }

  // Ingresos_reparto abiertos hoy (baseline).
  console.log('\n[audit V] ingresos_reparto abiertos (status in [pending, in_progress])...');
  const ingSnap = await db
    .collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();
  console.log(`  Total abiertos: ${ingSnap.size}`);
  const porStatus = {};
  const porSku = new Map();
  ingSnap.forEach((d) => {
    const data = d.data();
    porStatus[data.status] = (porStatus[data.status] || 0) + 1;
    if (data.sku) {
      porSku.set(data.sku, (porSku.get(data.sku) || 0) + 1);
    }
  });
  console.log('  Por status:', porStatus);
  console.log(`  SKUs distintos: ${porSku.size}`);

  // Cross: SKUs que están en tránsito Y tienen reparto abierto (riesgo doble reparto post-feature).
  const skusTransitoSet = new Set(skusConTransito.map((s) => s.sku));
  const cruces = [];
  for (const [sku, n] of porSku.entries()) {
    if (skusTransitoSet.has(sku)) {
      const info = skusConTransito.find((s) => s.sku === sku);
      cruces.push({ sku, repartosAbiertos: n, q11: info.q11, q12: info.q12 });
    }
  }
  if (cruces.length > 0) {
    console.log(`\n[audit V] ⚠️  SKUs con reparto abierto Y tránsito activo: ${cruces.length}`);
    console.log('  (Post-feature estos SKUs van a disparar reparto NUEVO desde dep 12 además.)');
    console.log('  ' + 'SKU'.padEnd(20) + 'dep11'.padStart(8) + 'dep12'.padStart(8) + 'rep.abiertos'.padStart(14));
    for (const c of cruces.slice(0, limit)) {
      console.log(
        '  ' + c.sku.padEnd(20) + String(c.q11).padStart(8) + String(c.q12).padStart(8) + String(c.repartosAbiertos).padStart(14),
      );
    }
  } else {
    console.log('\n[audit V] Sin cruces SKU-tránsito ↔ repartos abiertos.');
  }

  // ASIG actuales (contexto — qué está reservado hoy).
  console.log('\n[audit V] pedidos con líneas state=ASIG abiertas (contexto)...');
  const pedSnap = await db
    .collection('pedidos')
    .where('closedAt', '==', null)
    .limit(1000)
    .get();
  let pedidosConAsig = 0;
  let totalLineasAsig = 0;
  pedSnap.forEach((d) => {
    const data = d.data();
    if (Array.isArray(data.lines)) {
      const n = data.lines.filter((l) => l && l.state === 'ASIG' && Number(l.qtyOpen) > 0).length;
      if (n > 0) {
        pedidosConAsig++;
        totalLineasAsig += n;
      }
    }
  });
  console.log(`  Pedidos con ASIG abiertas: ${pedidosConAsig}`);
  console.log(`  Líneas ASIG totales: ${totalLineasAsig}`);

  console.log('\n[audit V] OK');
  return 0;
}

main().catch((e) => {
  console.error('[FATAL]', e && e.stack ? e.stack : e);
  process.exit(2);
});
