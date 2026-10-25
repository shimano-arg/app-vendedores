#!/usr/bin/env node
// @ts-check
/**
 * INCIDENTE 2026-10-25 — fix shape de los 7 pedidos reparados por W_...
 *
 * Pedidos creados por commitPedidoCF v1430+ no incluyen los campos legacy
 * que el panel UI usa para armar las tarjetas: `tipo`, `province`,
 * `locName`, `key`, `month`, `monthIdx`, `year`.
 * Antes del fix §64.2 todos esos pedidos iban a BO + via='app_only'. El
 * panel NO los mostraba (porque filtraba por `transferidoSAP.via !=
 * 'app_only'` o similar), así que el shape incompleto pasaba desapercibido.
 *
 * Post-W los 7 pedidos aparecieron en Pendientes con "undefined / Undefined",
 * "Invalid Date", "sin catálogo". Fix: completar los campos faltantes
 * desde `_draftId` (shape canónico: `tipo|province|locName|clientName|orderNumber`)
 * + computar `month`/`monthIdx`/`year` desde `confirmedAt`.
 *
 * Además: SATO duplicado qlB4FpI3R9Rhu5sLZvbf tiene closedAt + closedReason
 * pero sigue apareciendo en el panel (filter solo mira `stage`). Cambiar a
 * `stage='cancelled'` para que el panel lo excluya.
 *
 * Uso:
 *   node scripts/audit/Z_fix_shape_reparados_2026-10-25.cjs           # dry-run
 *   node scripts/audit/Z_fix_shape_reparados_2026-10-25.cjs --apply  # con OK Mariano
 */

const admin = require('../../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// SATO duplicado (ya cerrado por D_...).
const SATO_DUP_ID = 'qlB4FpI3R9Rhu5sLZvbf';

function parseDraftId(draftId) {
  if (!draftId || typeof draftId !== 'string') return null;
  const parts = draftId.split('|');
  if (parts.length < 4) return null;
  return {
    tipo: parts[0] || 'C',
    province: parts[1] || '',
    locName: parts[2] || '',
    clientName: parts[3] || '',
    orderNumber: parts[4] ? Number(parts[4]) || null : null,
  };
}

function computeMonthFields(ts) {
  if (!ts) return {};
  let d = null;
  if (typeof ts.toDate === 'function') d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else if (typeof ts === 'string') {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return {};
  // Timezone-aware: usar hora Argentina (UTC-3) para month/year.
  // confirmedAt es un Timestamp UTC; en ART el mes puede diferir en bordes.
  const art = new Date(d.getTime() - 3 * 3600 * 1000);
  const monthIdx = art.getUTCMonth();
  const year = art.getUTCFullYear();
  const month = `${MESES_ES[monthIdx]} ${year}`;
  return { month, monthIdx, year };
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`\n[Z] Fix shape pedidos reparados — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  // Buscar los 7 reparados por W (via _backfill).
  const snap = await db.collection('pedidos').where('_commitVersion', '==', 'commitPedidoCore_v1').get();
  const reparados = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const bf = data.get ? data.get('_backfill') : data['_backfill'];
    const _bf = data['_backfill'] || {};
    if (!Object.keys(_bf).some((k) => k.includes('W_bo_fantasma'))) return;
    reparados.push({ id: d.id, data });
  });
  console.log(`[Z] Reparados encontrados: ${reparados.length}\n`);

  // Plan por pedido.
  const planReparados = [];
  for (const { id, data } of reparados) {
    const draftId = data._draftId || '';
    const parsed = parseDraftId(draftId);
    const monthFields = computeMonthFields(data.confirmedAt);
    const updates = {};
    const missing = [];
    const alreadyOk = [];
    for (const field of ['tipo', 'province', 'locName', 'orderNumber']) {
      const current = data[field];
      if (current == null || current === '') {
        if (parsed && parsed[field] != null && parsed[field] !== '') {
          updates[field] = parsed[field];
          missing.push(`${field}=${parsed[field]}`);
        }
      } else {
        alreadyOk.push(field);
      }
    }
    // key: siempre recomputar canónica desde los campos resueltos.
    const effTipo = updates.tipo || data.tipo || 'C';
    const effProv = updates.province || data.province || '';
    const effLoc = updates.locName || data.locName || '';
    const effName = data.clientName || (parsed && parsed.clientName) || '';
    const keyNew = `${effTipo}|${effProv}|${effLoc}|${effName}`;
    if (!data.key) {
      updates.key = keyNew;
      missing.push(`key=${keyNew}`);
    }
    for (const [field, val] of Object.entries(monthFields)) {
      if (data[field] == null) {
        updates[field] = val;
        missing.push(`${field}=${val}`);
      }
    }
    console.log(`--- ${id} (${data.clientName || '?'}) ---`);
    console.log(`  draftId: ${draftId}`);
    console.log(`  missing campos panel: ${missing.length > 0 ? missing.join(', ') : '(ninguno)'}`);
    if (alreadyOk.length > 0) console.log(`  ya ok: ${alreadyOk.join(', ')}`);
    planReparados.push({ id, updates, data });
  }

  // SATO duplicado: cambiar stage='cancelled' para que el panel lo excluya.
  const satoDup = await db.collection('pedidos').doc(SATO_DUP_ID).get();
  let satoDupPlan = null;
  if (satoDup.exists) {
    const satoDupData = satoDup.data() || {};
    console.log(`\n--- ${SATO_DUP_ID} (SATO duplicado) ---`);
    console.log(`  stage actual: ${satoDupData.stage}, closedAt=${satoDupData.closedAt ? 'YES' : 'no'}`);
    const monthFields = computeMonthFields(satoDupData.confirmedAt);
    const parsed = parseDraftId(satoDupData._draftId);
    satoDupPlan = {
      stage: 'cancelled',  // el panel filtra !== 'pending' en Pendientes; con 'cancelled' queda fuera
      tipo: satoDupData.tipo || (parsed && parsed.tipo) || 'C',
      province: satoDupData.province || (parsed && parsed.province) || '',
      locName: satoDupData.locName || (parsed && parsed.locName) || '',
      orderNumber: satoDupData.orderNumber || (parsed && parsed.orderNumber) || null,
      key: satoDupData.key || `C|${(parsed && parsed.province) || ''}|${(parsed && parsed.locName) || ''}|${satoDupData.clientName || ''}`,
      ...monthFields,
    };
    console.log(`  → stage='cancelled' + completar: ${Object.keys(satoDupPlan).join(', ')}`);
  }

  if (!apply) {
    console.log('\n[Z] DRY-RUN. Para aplicar, correr con --apply.');
    return;
  }

  console.log('\n[Z] APPLY...');
  for (const { id, updates, data } of planReparados) {
    if (Object.keys(updates).length === 0) {
      console.log(`  ⊘ ${id}: nada que actualizar`);
      continue;
    }
    const snapshotPrevio = {};
    for (const field of Object.keys(updates)) snapshotPrevio[field] = data[field] ?? null;
    const payload = {
      ...updates,
      [`_backfill.Z_shape_fix_${new Date().toISOString().slice(0, 10)}`]: {
        previousValues: snapshotPrevio,
        by: 'scripts/audit/Z_fix_shape_reparados_2026-10-25.cjs',
        at: new Date().toISOString(),
        reason: 'Fix shape panel UI (tipo/province/locName/key/month/monthIdx/year) post-W',
      },
    };
    await db.collection('pedidos').doc(id).update(payload);
    console.log(`  ✓ ${id} (${data.clientName}): +${Object.keys(updates).length} campos`);
  }

  if (satoDupPlan) {
    const satoDupData = (await db.collection('pedidos').doc(SATO_DUP_ID).get()).data() || {};
    const snapshotPrevio = {};
    for (const field of Object.keys(satoDupPlan)) snapshotPrevio[field] = satoDupData[field] ?? null;
    const payload = {
      ...satoDupPlan,
      [`_backfill.Z_shape_fix_${new Date().toISOString().slice(0, 10)}`]: {
        previousValues: snapshotPrevio,
        by: 'scripts/audit/Z_fix_shape_reparados_2026-10-25.cjs',
        at: new Date().toISOString(),
        reason: "SATO duplicado: stage='cancelled' + completar shape para panel",
      },
    };
    await db.collection('pedidos').doc(SATO_DUP_ID).update(payload);
    console.log(`  ✓ ${SATO_DUP_ID} (SATO dup): stage='cancelled' + shape completo`);
  }

  console.log('\n[Z] APPLY OK.');
}

main().catch((e) => {
  console.error('[Z] ERROR:', e);
  process.exit(1);
});
