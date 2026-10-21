/**
 * E0 — Dimensionar reservas que superan el TTL de 7d pero siguen reservando.
 *
 * Read-only, autorizado A1 heredado.
 *
 * Buckets por línea abierta (state ∈ {confirmed, BO, ASIG}):
 *   - confirmed_sin_fecha: sin confirmedAt + sin transferidoSAP.transferredAt + sin createdAt
 *   - confirmed_vencido:   confirmedAt >7d (o fallback transferredAt/createdAt >7d)
 *   - asig_vencido:        asigAt >7d
 *   - bo_vencido:          pedido.createdAt >7d
 *
 * Por SKU reporta: fisico dep 11, Σ vencidas, Σ vigentes, libre actual,
 * libre post-fix (si vencidas no reservaran), flag bloqueado_sin_reparto.
 *
 * Modo:
 *   node scripts/audit/G_reservas_vencidas.cjs --dry-run   (default)
 *   node scripts/audit/G_reservas_vencidas.cjs --prod
 */

const PROD = process.argv.includes('--prod');
const PROJECT = 'app-vendedores-shimano';
const TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(value) {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') try { return value.toMillis(); } catch (_e) { return null; }
    if (typeof value.seconds === 'number') return value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
    return null;
  }
  if (typeof value === 'string') { const t = Date.parse(value); return Number.isFinite(t) ? t : null; }
  return null;
}

function logInfo() {
  console.log('================================================================');
  console.log('QUERY G — Reservas vencidas que siguen reservando (TTL 7d)');
  console.log('================================================================');
  console.log('');
  console.log('Modo:', PROD ? '--prod (lectura real)' : '--dry-run (solo imprime)');
  console.log('TTL de referencia:', TTL_DAYS, 'dias');
  console.log('');
}

async function runProd() {
  const admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const now = Date.now();

  console.log('[prod] Leyendo stock_snapshot...');
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  let whsBreakdown = {};
  try {
    const sd = stockSnap.data() || {};
    whsBreakdown = typeof sd.warehouseBreakdown === 'string'
      ? JSON.parse(sd.warehouseBreakdown)
      : sd.warehouseBreakdown || {};
  } catch (_e) {}

  console.log('[prod] Leyendo ingresos_reparto activos...');
  const irSnap = await db.collection('ingresos_reparto').where('status', 'in', ['pending', 'in_progress']).get();
  const skusConReparto = new Set();
  irSnap.forEach((d) => { const s = d.data().sku; if (s) skusConReparto.add(String(s).toUpperCase()); });

  console.log('[prod] Scanning pedidos abiertos...');
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log('[prod] pedidos abiertos:', snap.size);

  /** @type {Map<string, {fisico:number, vigentes:number, confirmed_sin_fecha:number, confirmed_vencido:number, asig_vencido:number, bo_vencido:number, lineas_fantasma: any[]}>} */
  const bySku = new Map();

  const getBucket = (sku) => {
    if (!bySku.has(sku)) {
      const fisico = Number((whsBreakdown[sku] || {})['11']) || 0;
      bySku.set(sku, {
        fisico,
        vigentes: 0,
        confirmed_sin_fecha: 0,
        confirmed_vencido: 0,
        asig_vencido: 0,
        bo_vencido: 0,
        lineas_fantasma: [],
      });
    }
    return bySku.get(sku);
  };

  snap.forEach((doc) => {
    const p = doc.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const createdAtMs = toMs(p.createdAt);
    const confirmedAtMs = toMs(p.confirmedAt);
    const transferredAtMs = toMs(p.transferidoSAP && p.transferidoSAP.transferredAt);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const sku = String(l.code).toUpperCase();
      const b = getBucket(sku);
      const state = l.state;

      // asigReserva === false | 0: liberada manualmente
      if (l.asigReserva === false || l.asigReserva === 0) continue;

      if (state === 'confirmed') {
        // Edad usando fallback cascada (como el fix propuesto E1).
        const refMs = confirmedAtMs || transferredAtMs || createdAtMs;
        if (!refMs) {
          b.confirmed_sin_fecha += qo;
          b.lineas_fantasma.push({
            kind: 'confirmed_sin_fecha', sku, qo,
            pedidoId: doc.id, cardCode: p.clientCardCode, clientName: p.clientName,
            orderNumber: p.orderNumber,
            raw: { confirmedAt: p.confirmedAt, transferredAt: p.transferidoSAP && p.transferidoSAP.transferredAt, createdAt: p.createdAt },
          });
        } else {
          const ageDays = (now - refMs) / DAY_MS;
          if (ageDays > TTL_DAYS) {
            b.confirmed_vencido += qo;
            b.lineas_fantasma.push({
              kind: 'confirmed_vencido', sku, qo,
              pedidoId: doc.id, cardCode: p.clientCardCode, clientName: p.clientName,
              orderNumber: p.orderNumber,
              ageDays: Math.round(ageDays),
              refSource: confirmedAtMs ? 'confirmedAt' : transferredAtMs ? 'transferredAt' : 'createdAt',
              rawConfirmedAt: p.confirmedAt,
            });
          } else {
            b.vigentes += qo;
          }
        }
      } else if (state === 'ASIG') {
        const asigAtMs = toMs(l.asigAt);
        if (!asigAtMs) {
          // ASIG sin fecha: considerar fantasma (data corrupta)
          b.asig_vencido += qo;
          b.lineas_fantasma.push({
            kind: 'asig_sin_fecha', sku, qo,
            pedidoId: doc.id, cardCode: p.clientCardCode, clientName: p.clientName,
            orderNumber: p.orderNumber,
          });
        } else {
          const ageDays = (now - asigAtMs) / DAY_MS;
          if (ageDays > TTL_DAYS) {
            b.asig_vencido += qo;
            b.lineas_fantasma.push({
              kind: 'asig_vencido', sku, qo,
              pedidoId: doc.id, cardCode: p.clientCardCode, clientName: p.clientName,
              orderNumber: p.orderNumber,
              ageDays: Math.round(ageDays),
              rawAsigAt: l.asigAt,
            });
          } else {
            b.vigentes += qo;
          }
        }
      } else if (state === 'BO') {
        if (!createdAtMs) {
          b.vigentes += qo; // BO sin createdAt: tratar como vigente (el código actual lo deja pasar)
        } else {
          const ageDays = (now - createdAtMs) / DAY_MS;
          if (ageDays > TTL_DAYS) {
            b.bo_vencido += qo;
            b.lineas_fantasma.push({
              kind: 'bo_vencido', sku, qo,
              pedidoId: doc.id, cardCode: p.clientCardCode, clientName: p.clientName,
              orderNumber: p.orderNumber,
              ageDays: Math.round(ageDays),
            });
          } else {
            b.vigentes += qo;
          }
        }
      }
    }
  });

  // Reporte
  let totalTapadas = 0;
  let skusTrabadosSinReparto = 0;
  const reportRows = [];
  for (const [sku, b] of bySku) {
    const totalVencidas = b.confirmed_sin_fecha + b.confirmed_vencido + b.asig_vencido + b.bo_vencido;
    totalTapadas += totalVencidas;
    const libreActual = Math.max(0, b.fisico - (b.vigentes + totalVencidas));
    const librePostFix = Math.max(0, b.fisico - b.vigentes);
    const sinReparto = !skusConReparto.has(sku);
    const bloqueadoSinReparto = libreActual === 0 && librePostFix > 0 && sinReparto;
    if (bloqueadoSinReparto) skusTrabadosSinReparto++;
    reportRows.push({ sku, ...b, totalVencidas, libreActual, librePostFix, bloqueadoSinReparto });
  }
  reportRows.sort((a, b) => b.totalVencidas - a.totalVencidas);

  console.log('');
  console.log('===== RESUMEN =====');
  console.log('SKUs scaneados:', bySku.size);
  console.log('Total unidades tapadas en catalogo:', totalTapadas);
  console.log('SKUs trabados sin reparto (libre=0 pero post-fix > 0 y sin reparto):', skusTrabadosSinReparto);
  console.log('');
  console.log('Top 20 SKUs por unidades tapadas:');
  for (const r of reportRows.slice(0, 20)) {
    console.log(`  ${r.sku}: fisico=${r.fisico} vigentes=${r.vigentes} vencidas=${r.totalVencidas} (confSinFecha=${r.confirmed_sin_fecha} confVenc=${r.confirmed_vencido} asigVenc=${r.asig_vencido} boVenc=${r.bo_vencido}) libreHoy=${r.libreActual} librePostFix=${r.librePostFix} ${r.bloqueadoSinReparto ? 'BLOQUEADO_SIN_REPARTO' : ''}`);
  }

  // Breakdown explícito de CUDC201HG
  const cudc = reportRows.find((r) => r.sku === 'CUDC201HG');
  if (cudc) {
    console.log('');
    console.log('===== CUDC201HG BREAKDOWN =====');
    console.log(JSON.stringify({ fisico: cudc.fisico, vigentes: cudc.vigentes, confirmed_sin_fecha: cudc.confirmed_sin_fecha, confirmed_vencido: cudc.confirmed_vencido, asig_vencido: cudc.asig_vencido, bo_vencido: cudc.bo_vencido, libreActual: cudc.libreActual, librePostFix: cudc.librePostFix }, null, 2));
    console.log('Lineas fantasma CUDC201HG:');
    for (const l of cudc.lineas_fantasma) console.log('  ', JSON.stringify(l));
  }

  return { bySku, totalTapadas, skusTrabadosSinReparto, cudc };
}

logInfo();
if (!PROD) {
  console.log('[dry-run] para ejecutar: --prod');
  process.exit(0);
}
runProd().then(() => process.exit(0)).catch((e) => { console.error('ERR', e); process.exit(1); });
