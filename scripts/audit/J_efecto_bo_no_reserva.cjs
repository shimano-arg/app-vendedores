// E4 v1392 — Read-only prod: comparar libre_v1 (BO reserva) vs libre_v2
// (§40: solo ASIG+conf+CPST). Lista SKUs cuyo libre sube, con/sin reparto.
// Autorizado por Mariano 2026-10-21.

const PROJECT = 'app-vendedores-shimano';
const DAY = 24 * 60 * 60 * 1000;
const BO_TTL_DAYS = 90;
const RESERVA_TTL_DAYS = 7;
const CONFIRMED_HARD_CAP_DAYS = 60;

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.toDate === 'function') try { return v.toDate().toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.toMillis === 'function') try { return new Date(v.toMillis()).toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  return String(v);
}

function toMsSafe(v) {
  const iso = toIso(v);
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// Replica inline de lineReservesStock SIN la regla §40 (= v1391: BO reserva hasta 90d).
function reservaV1(line, nowMs, pedido) {
  if (!line) return false;
  const state = line.state;
  if (state === 'BO') {
    if (pedido && pedido.createdAt) {
      const ms = toMsSafe(pedido.createdAt);
      if (ms !== null && (nowMs - ms) / DAY > BO_TTL_DAYS) return false;
    }
    return true;
  }
  if (state === 'confirmed') {
    if (line.asigReserva === false || line.asigReserva === 0) return false;
    if (!pedido || !pedido.confirmedAt) return false;
    const ms = toMsSafe(pedido.confirmedAt);
    if (ms === null) return false;
    const d = (nowMs - ms) / DAY;
    if (d > RESERVA_TTL_DAYS) return false;
    if (d > CONFIRMED_HARD_CAP_DAYS) return false;
    return true;
  }
  if (state === 'ASIG') {
    if (line.asigReserva === false || line.asigReserva === 0) return false;
    if (line.asigAt) {
      const ms = toMsSafe(line.asigAt);
      if (ms !== null && (nowMs - ms) / DAY > RESERVA_TTL_DAYS) return false;
    }
    return true;
  }
  return false;
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  console.log('================================================================');
  console.log('E4 — Efecto §40 (BO no reserva) en prod @ ' + nowIso);
  console.log('================================================================');

  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs = typeof sd.warehouseBreakdown === 'string'
    ? JSON.parse(sd.warehouseBreakdown)
    : (sd.warehouseBreakdown || {});

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => { pedidos.push(Object.assign({ _fsId: d.id }, d.data() || {})); });

  const irSnap = await db.collection('ingresos_reparto').where('status', 'in', ['pending', 'in_progress']).get();
  const ingresosActivos = [];
  irSnap.forEach((d) => { ingresosActivos.push(Object.assign({ _fsId: d.id }, d.data() || {})); });
  const skusConReparto = new Set(ingresosActivos.map((i) => String(i.sku || '').toUpperCase()));

  // Agrupar por SKU.
  const porSku = new Map();
  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      const sku = String(l.code).toUpperCase();
      if (!porSku.has(sku)) porSku.set(sku, []);
      porSku.get(sku).push({ p, l });
    }
  }

  const diffs = [];
  for (const sku of Object.keys(whs)) {
    const skuU = String(sku).toUpperCase();
    const fisico = Number((whs[sku] || {})['11']) || 0;
    if (fisico <= 0) continue;
    const lineas = porSku.get(skuU) || [];
    if (lineas.length === 0) continue;
    let compV1 = 0, compV2 = 0;
    let boVig = 0;
    for (const { p, l } of lineas) {
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      // V1: BO + conf + ASIG reservan.
      if (reservaV1(l, nowMs, p)) compV1 += qo;
      // V2 §40: solo conf + ASIG (BO no reserva).
      if (l.state === 'confirmed' || l.state === 'ASIG') {
        if (reservaV1(l, nowMs, p)) compV2 += qo;
      }
      if (l.state === 'BO') {
        // Contar BO vigente para informe (TTL 90d).
        if (p && p.createdAt) {
          const ms = toMsSafe(p.createdAt);
          if (ms !== null && (nowMs - ms) / DAY <= BO_TTL_DAYS) boVig += qo;
        } else { boVig += qo; }
      }
    }
    const libreV1 = Math.max(0, fisico - compV1);
    const libreV2 = Math.max(0, fisico - compV2);
    if (libreV2 > libreV1) {
      diffs.push({ sku: skuU, fisico, compV1, compV2, libreV1, libreV2, delta: libreV2 - libreV1, boVig, tieneReparto: skusConReparto.has(skuU) });
    }
  }

  diffs.sort((a, b) => b.delta - a.delta);

  const totalDelta = diffs.reduce((s, d) => s + d.delta, 0);
  const conReparto = diffs.filter((d) => d.tieneReparto);
  const sinReparto = diffs.filter((d) => !d.tieneReparto);

  console.log('');
  console.log('===== RESUMEN =====');
  console.log('SKUs cuyo libre SUBE con §40: ' + diffs.length);
  console.log('Total unidades que pasan a libre: ' + totalDelta);
  console.log('Con reparto abierto activo: ' + conReparto.length + ' SKUs, ' + conReparto.reduce((s, d) => s + d.delta, 0) + ' u');
  console.log('Sin reparto abierto activo: ' + sinReparto.length + ' SKUs, ' + sinReparto.reduce((s, d) => s + d.delta, 0) + ' u');
  console.log('');
  console.log('===== TOP 20 SKUs con mayor delta =====');
  console.log('| SKU | fisico | libre_v1 | libre_v2 | delta | boVig | reparto |');
  console.log('|---|---|---|---|---|---|---|');
  for (const d of diffs.slice(0, 20)) {
    console.log('| ' + d.sku + ' | ' + d.fisico + ' | ' + d.libreV1 + ' | ' + d.libreV2 + ' | +' + d.delta + ' | ' + d.boVig + ' | ' + (d.tieneReparto ? 'SI' : 'NO') + ' |');
  }

  console.log('');
  console.log('===== VEREDICTO PAUSA =====');
  if (totalDelta >= 50) {
    console.log('⚠️  TOTAL=' + totalDelta + ' >= 50 → PAUSA requerida, esperando OK Mariano antes de merge.');
  } else {
    console.log('✓ TOTAL=' + totalDelta + ' < 50 → continuar sin pausa.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
