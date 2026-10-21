// Verifica efecto §40.1 (waitlistCpst no reserva) en prod.
// Compara libre_pre vs libre_post removiendo waitlistCpst del total reservado.

const PROJECT = 'app-vendedores-shimano';
const DAY = 24 * 60 * 60 * 1000;
const RESERVA_TTL = 7;
const CF_HARD = 60;

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.toDate === 'function') try { return v.toDate().toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.toMillis === 'function') try { return new Date(v.toMillis()).toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  return String(v);
}
function toMsSafe(v) { const iso = toIso(v); if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? t : null; }

function asigVig(l, now) {
  if (!l || l.state !== 'ASIG') return false;
  if (l.asigReserva === false || l.asigReserva === 0) return false;
  if (l.asigAt) {
    const ms = toMsSafe(l.asigAt);
    if (ms !== null && (now - ms) / DAY > RESERVA_TTL) return false;
  }
  return true;
}
function confVig(l, p, now) {
  if (!l || l.state !== 'confirmed') return false;
  if (l.asigReserva === false || l.asigReserva === 0) return false;
  if (!p || !p.confirmedAt) return false;
  const ms = toMsSafe(p.confirmedAt);
  if (ms === null) return false;
  const d = (now - ms) / DAY;
  return d <= RESERVA_TTL && d <= CF_HARD;
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  console.log('================================================================');
  console.log('K — Efecto §40.1 (waitlistCpst no reserva) @ ' + nowIso);
  console.log('================================================================');

  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs = typeof sd.warehouseBreakdown === 'string' ? JSON.parse(sd.warehouseBreakdown) : (sd.warehouseBreakdown || {});

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => { pedidos.push(Object.assign({ _fsId: d.id }, d.data() || {})); });

  const wlSnap = await db.collection('revision_waitlist').where('source', '==', 'stock-asignado-batch').get();
  const waitlist = [];
  wlSnap.forEach((d) => { waitlist.push(Object.assign({ _id: d.id }, d.data() || {})); });

  // Agrupar por SKU.
  const skus = new Map();
  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      const sku = String(l.code).toUpperCase();
      if (!skus.has(sku)) skus.set(sku, { asigV: 0, confV: 0, wlCpst: 0 });
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      if (asigVig(l, now)) skus.get(sku).asigV += qo;
      else if (confVig(l, p, now)) skus.get(sku).confV += qo;
    }
  }
  for (const w of waitlist) {
    const items = Array.isArray(w.items) ? w.items : [];
    for (const it of items) {
      if (!it || !it.code) continue;
      const sku = String(it.code).toUpperCase();
      const qty = Number(it.qty) || 0;
      if (qty <= 0) continue;
      if (!skus.has(sku)) skus.set(sku, { asigV: 0, confV: 0, wlCpst: 0 });
      skus.get(sku).wlCpst += qty;
    }
  }

  const diffs = [];
  for (const [sku, agg] of skus.entries()) {
    const fisico = Number((whs[sku] || {})['11']) || 0;
    if (fisico <= 0) continue;
    // Pre v1393: libre = max(0, fisico - asig - conf - wlCpst)
    const librePre = Math.max(0, fisico - agg.asigV - agg.confV - agg.wlCpst);
    // Post v1393 §40.1: libre = max(0, fisico - asig - conf) (sin wlCpst)
    const librePost = Math.max(0, fisico - agg.asigV - agg.confV);
    const delta = librePost - librePre;
    if (delta > 0) diffs.push({ sku, fisico, ...agg, librePre, librePost, delta });
  }
  diffs.sort((a, b) => b.delta - a.delta);
  const total = diffs.reduce((s, d) => s + d.delta, 0);

  console.log('');
  console.log('===== RESUMEN =====');
  console.log('SKUs cuyo libre SUBE con §40.1: ' + diffs.length);
  console.log('Total unidades que pasan a libre: ' + total);
  console.log('');
  console.log('===== TOP 20 =====');
  console.log('| SKU | fisico | asig | conf | wlCpst | librePre | librePost | delta |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const d of diffs.slice(0, 20)) {
    console.log('| ' + d.sku + ' | ' + d.fisico + ' | ' + d.asigV + ' | ' + d.confV + ' | ' + d.wlCpst + ' | ' + d.librePre + ' | ' + d.librePost + ' | +' + d.delta + ' |');
  }
  console.log('');
  if (total >= 50) {
    console.log('⚠️  TOTAL=' + total + ' >= 50 → PAUSA requerida.');
  } else {
    console.log('✓ TOTAL=' + total + ' < 50 → continuar sin pausa.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
