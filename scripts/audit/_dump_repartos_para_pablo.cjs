// Dump para doc 24: 37 SKUs cuyo libre sube con §40, ordenados por delta,
// con físico/ASIG/BO vigente/clientes en cola. Read-only prod.

const PROJECT = 'app-vendedores-shimano';
const DAY = 24 * 60 * 60 * 1000;
const RESERVA_TTL = 7;
const BO_TTL = 90;
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

function asigVigente(l, now) {
  if (!l) return false;
  if (l.state !== 'ASIG') return false;
  if (l.asigReserva === false || l.asigReserva === 0) return false;
  if (l.asigAt) {
    const ms = toMsSafe(l.asigAt);
    if (ms !== null && (now - ms) / DAY > RESERVA_TTL) return false;
  }
  return true;
}

function confVigente(l, p, now) {
  if (!l || l.state !== 'confirmed') return false;
  if (l.asigReserva === false || l.asigReserva === 0) return false;
  if (!p || !p.confirmedAt) return false;
  const ms = toMsSafe(p.confirmedAt);
  if (ms === null) return false;
  const d = (now - ms) / DAY;
  return d <= RESERVA_TTL && d <= CF_HARD;
}

function boVigente(p, now) {
  if (!p || !p.createdAt) return true;
  const ms = toMsSafe(p.createdAt);
  if (ms === null) return true;
  return (now - ms) / DAY <= BO_TTL;
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const now = Date.now();

  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  const whs = typeof sd.warehouseBreakdown === 'string'
    ? JSON.parse(sd.warehouseBreakdown)
    : (sd.warehouseBreakdown || {});

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => { pedidos.push(Object.assign({ _fsId: d.id }, d.data() || {})); });

  const irSnap = await db.collection('ingresos_reparto').where('status', 'in', ['pending', 'in_progress']).get();
  const irs = new Map();
  irSnap.forEach((d) => {
    const data = d.data() || {};
    const sku = String(data.sku || '').toUpperCase();
    irs.set(sku, Object.assign({ _fsId: d.id }, data));
  });

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

  const out = [];
  for (const sku of Object.keys(whs)) {
    const skuU = String(sku).toUpperCase();
    const fisico = Number((whs[sku] || {})['11']) || 0;
    if (fisico <= 0) continue;
    const lineas = porSku.get(skuU) || [];
    if (lineas.length === 0) continue;
    let asigV = 0, confV = 0, boV = 0;
    const clientesCola = []; // de BO vigente
    for (const { p, l } of lineas) {
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      if (asigVigente(l, now)) asigV += qo;
      else if (confVigente(l, p, now)) confV += qo;
      else if (l.state === 'BO' && boVigente(p, now)) {
        boV += qo;
        clientesCola.push({
          clientName: p.clientName || '',
          qty: qo,
          createdAt: toIso(p.createdAt),
          pedidoId: p._fsId,
        });
      }
    }
    const libreV1 = Math.max(0, fisico - asigV - confV - boV);
    const libreV2 = Math.max(0, fisico - asigV - confV);
    const delta = libreV2 - libreV1;
    if (delta <= 0) continue;
    clientesCola.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const ir = irs.get(skuU);
    out.push({
      sku: skuU, fisico, asigV, confV, boV, libreV1, libreV2, delta, clientesCola,
      ir: ir ? { id: ir._fsId, qtyIng: ir.qtyIngresada || 0, status: ir.status, detectedAt: toIso(ir.detectedAt) } : null,
    });
  }
  out.sort((a, b) => b.delta - a.delta);
  console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
