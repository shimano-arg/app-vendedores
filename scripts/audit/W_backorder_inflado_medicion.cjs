#!/usr/bin/env node
// @ts-check
/*
 * ================================================================
 * W — MEDICION BACKORDER INFLADO (plan #1206 Fase A)
 * ================================================================
 *
 * Script READ-ONLY. Dimensiona el "backorder inflado" en prod con 7 metricas
 * (M1-M7) consistentes con las hipotesis S1/E6/E1 del plan.
 *
 * Plan asociado:
 *   docs/plans/2026-10-25-backorder-inflado-analisis.md
 *
 * Reglas aplicadas:
 *   - CLAUDE.md §31: auditoria != correccion. Dry-run only.
 *   - CLAUDE.md §39: toda disponibilidad pasa por getStockBreakdown. El script
 *     lo reusa (via dynamic import del pure).
 *   - CLAUDE.md §55: NO hay --apply. Si se agrega en el futuro, debe guardar
 *     snapshot _backfill por doc.
 *
 * Uso:
 *   node scripts/audit/W_backorder_inflado_medicion.cjs                # ejecuta read-only
 *   node scripts/audit/W_backorder_inflado_medicion.cjs --describe     # solo imprime plan
 *   node scripts/audit/W_backorder_inflado_medicion.cjs --days=7       # ventana M2 (default 30)
 *   node scripts/audit/W_backorder_inflado_medicion.cjs --top=25       # top SKUs M3
 *
 * NO soporta --apply. Si se intenta, exit=2.
 */

'use strict';

const PROJECT_ID = 'app-vendedores-shimano';
const DAY_MS = 24 * 60 * 60 * 1000;

const argv = process.argv.slice(2);

if (argv.includes('--apply')) {
  console.error('[W] ERROR: --apply NO esta implementado.');
  console.error('[W] Este script es solo MEDICION. Ver plan en');
  console.error('[W]   docs/plans/2026-10-25-backorder-inflado-analisis.md');
  process.exit(2);
}

const MODE_DESCRIBE = argv.includes('--describe');
const DAYS_WINDOW = (() => {
  const flag = argv.find((a) => a.startsWith('--days='));
  if (!flag) return 30;
  const n = Number.parseInt(flag.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();
const TOP_N = (() => {
  const flag = argv.find((a) => a.startsWith('--top='));
  if (!flag) return 25;
  const n = Number.parseInt(flag.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 25;
})();

const nowIso = new Date().toISOString();
const nowMs = Date.now();

function printPlan() {
  console.log('================================================================');
  console.log('W - Backorder inflado: medicion prod @ ' + nowIso);
  console.log('================================================================');
  console.log('');
  console.log('Modo: ' + (MODE_DESCRIBE ? 'DESCRIBE (sin red)' : 'PREVIEW (read-only prod)'));
  console.log('Ventana M2 (envios SAP posteriores): ' + DAYS_WINDOW + ' dias');
  console.log('Top-N M3 (SKUs backorder inflado): ' + TOP_N);
  console.log('');
}

if (MODE_DESCRIBE) {
  printPlan();
  console.log('[W] DESCRIBE: no se conecta a Firestore.');
  console.log('[W] Para ejecutar read-only prod: node W_backorder_inflado_medicion.cjs');
  process.exit(0);
}

/** @param {any} t */
function tsToMs(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') { try { return t.toMillis(); } catch (_e) { return 0; } }
  if (typeof t.toDate === 'function') { try { return t.toDate().getTime(); } catch (_e) { return 0; } }
  if (typeof t === 'string') { const n = Date.parse(t); return Number.isNaN(n) ? 0 : n; }
  return 0;
}

/** @param {string} cardCode @param {string} clientName @param {string} sku */
function pairKey(cardCode, clientName, sku) {
  const cc = String(cardCode || '').trim();
  const cn = String(clientName || '').trim();
  const skuUp = String(sku || '').toUpperCase().trim();
  const client = cc || ('name:' + cn);
  return client + '|' + skuUp;
}

/** @param {string} sku */
function normSku(sku) { return String(sku || '').toUpperCase().trim(); }

/** @param {any} v */
function tdMd(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

(async function main() {
  printPlan();

  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  const breakdownMod = await import('../../src/pure/stock-breakdown.js');
  const getStockBreakdown = breakdownMod.getStockBreakdown;

  console.log('[W] Cargando pedidos abiertos + revision_waitlist + stock_snapshot...');
  const [pedidosSnap, waitlistSnap, stockSnap] = await Promise.all([
    db.collection('pedidos').where('closedAt', '==', null).get(),
    db.collection('revision_waitlist').get(),
    db.doc('app_config/stock_snapshot').get(),
  ]);

  /** @type {Array<any>} */
  const pedidos = [];
  pedidosSnap.forEach((d) => pedidos.push(Object.assign({ _fsId: d.id }, d.data())));
  console.log('[W] Pedidos abiertos: ' + pedidos.length);

  /** @type {Array<any>} */
  const waitlistAll = [];
  waitlistSnap.forEach((d) => waitlistAll.push(Object.assign({ _id: d.id }, d.data())));
  const waitlist = waitlistAll.filter((w) => !w.closedAt && w.stage !== 'consumed');
  console.log('[W] Waitlists abiertas: ' + waitlist.length);

  const stockData = stockSnap.data() || {};
  let qtyMap = {};
  let whsMap = {};
  try {
    qtyMap = typeof stockData.quantities === 'string'
      ? JSON.parse(stockData.quantities) : stockData.quantities || {};
  } catch (_e) { qtyMap = {}; }
  try {
    whsMap = typeof stockData.warehouseBreakdown === 'string'
      ? JSON.parse(stockData.warehouseBreakdown) : stockData.warehouseBreakdown || {};
  } catch (_e) { whsMap = {}; }
  console.log('[W] Stock snapshot cargado: ' + Object.keys(qtyMap).length + ' SKUs');

  /** @param {any} p */
  function isSyncSap(p) {
    return p && (p.source === 'sync-sap' || (p.transferidoSAP && p.transferidoSAP.via === 'sync-sap'));
  }

  // M1: pares cliente+SKU con BO en >1 linea u >1 orden
  console.log('[W] Computando M1...');
  /** @type {Map<string, {cardCode:string, clientName:string, sku:string, lines:Array<any>}>} */
  const paresBo = new Map();
  for (const p of pedidos) {
    if (isSyncSap(p)) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (l.state !== 'BO') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const sku = normSku(l.code);
      const cardCode = String(p.clientCardCode || '').trim();
      const clientName = String(p.clientName || '').trim();
      const key = pairKey(cardCode, clientName, sku);
      const row = paresBo.get(key) || { cardCode, clientName, sku, lines: [] };
      row.lines.push({
        pedidoId: p._fsId,
        orderNumber: p.orderNumber || '',
        lineIndex: i,
        qtyOpen: qo,
        createdAtMs: tsToMs(p.createdAt),
        asigRevertidaAtMs: tsToMs(l.asigRevertidaAt),
        closedReason: l.closedReason || '',
        tipo: p.tipo || '',
      });
      paresBo.set(key, row);
    }
  }

  /** @type {Array<any>} */
  const m1Rows = [];
  for (const [, row] of paresBo) {
    const uniqOrders = new Set(row.lines.map((l) => l.pedidoId));
    if (uniqOrders.size <= 1 && row.lines.length <= 1) continue;
    const qtyTotal = row.lines.reduce((s, l) => s + l.qtyOpen, 0);
    const qtyMax = row.lines.reduce((m, l) => Math.max(m, l.qtyOpen), 0);
    const createdMsList = row.lines.map((l) => l.asigRevertidaAtMs || l.createdAtMs).filter((v) => v > 0);
    const oldestMs = createdMsList.length ? Math.min(...createdMsList) : 0;
    const newestMs = createdMsList.length ? Math.max(...createdMsList) : 0;
    m1Rows.push({
      cardCode: row.cardCode, clientName: row.clientName, sku: row.sku,
      nOrders: uniqOrders.size, nLines: row.lines.length,
      qtyTotal, qtyMax,
      oldestDays: oldestMs > 0 ? Math.round((nowMs - oldestMs) / DAY_MS) : null,
      newestDays: newestMs > 0 ? Math.round((nowMs - newestMs) / DAY_MS) : null,
    });
  }
  m1Rows.sort((a, b) => b.qtyTotal - a.qtyTotal);

  const totalPares = paresBo.size;
  const paresMulti = m1Rows.length;
  const unitsBoTotal = Array.from(paresBo.values())
    .reduce((s, r) => s + r.lines.reduce((ss, l) => ss + l.qtyOpen, 0), 0);
  const unitsBoMulti = m1Rows.reduce((s, r) => s + r.qtyTotal, 0);
  const unitsBoReducibles = m1Rows.reduce((s, r) => s + (r.qtyTotal - r.qtyMax), 0);

  // M2: BO + envio SAP posterior
  console.log('[W] Computando M2 (ventana ' + DAYS_WINDOW + 'd)...');
  /** @type {Map<string, Array<{pedidoId:string, orderNumber:string, qty:number, sentMs:number, state:string}>>} */
  const envioSapByPair = new Map();
  for (const p of pedidos) {
    if (isSyncSap(p)) continue;
    const t = p.transferidoSAP || {};
    const hasSap = t.docNum != null || t.docEntry != null;
    if (!hasSap) continue;
    const sentMs = tsToMs(t.sentAt) || tsToMs(p.confirmedAt) || tsToMs(p.updatedAt);
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (l.state !== 'confirmed' && l.state !== 'invoiced') continue;
      const qty = Number(l.qty) || 0;
      if (qty <= 0) continue;
      const sku = normSku(l.code);
      const key = pairKey(p.clientCardCode, p.clientName, sku);
      const list = envioSapByPair.get(key) || [];
      list.push({ pedidoId: p._fsId, orderNumber: String(p.orderNumber || ''), qty, sentMs, state: l.state });
      envioSapByPair.set(key, list);
    }
  }

  /** @type {Array<any>} */
  const m2Rows = [];
  const windowCutoffMs = nowMs - DAYS_WINDOW * DAY_MS;
  for (const [key, row] of paresBo) {
    const envios = envioSapByPair.get(key);
    if (!envios || envios.length === 0) continue;
    for (const boLine of row.lines) {
      const boAgeMs = boLine.asigRevertidaAtMs || boLine.createdAtMs;
      for (const env of envios) {
        if (env.sentMs <= 0) continue;
        if (env.sentMs < windowCutoffMs) continue;
        if (boAgeMs > 0 && env.sentMs <= boAgeMs) continue;
        const deltaDias = boAgeMs > 0 ? Math.round((env.sentMs - boAgeMs) / DAY_MS) : null;
        m2Rows.push({
          cardCode: row.cardCode, clientName: row.clientName, sku: row.sku,
          boOrder: String(boLine.orderNumber || ''),
          boQty: boLine.qtyOpen,
          boCreatedDays: boAgeMs > 0 ? Math.round((nowMs - boAgeMs) / DAY_MS) : null,
          sapOrder: env.orderNumber, sapQty: env.qty, sapState: env.state,
          sapSentDays: env.sentMs > 0 ? Math.round((nowMs - env.sentMs) / DAY_MS) : null,
          deltaDias,
        });
      }
    }
  }
  m2Rows.sort((a, b) => b.boQty - a.boQty);

  // M3: top SKUs backorderApp.total >> fisico
  console.log('[W] Computando M3 (via getStockBreakdown §39)...');
  const skusEnPedidos = new Set();
  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (l && l.code) skusEnPedidos.add(normSku(l.code));
    }
  }
  const deps = {
    /** @param {string} sku */
    getStockFisico: (sku) => {
      const w = whsMap[sku];
      return w && typeof w === 'object' ? (Number(w['11']) || 0) : 0;
    },
    /** @param {string} sku */
    getStockTransito: (sku) => {
      const w = whsMap[sku];
      return w && typeof w === 'object' ? (Number(w['12']) || 0) : 0;
    },
    pedidos, waitlistEntries: waitlist,
  };

  /** @type {Array<any>} */
  const m3Rows = [];
  for (const sku of skusEnPedidos) {
    let b;
    try { b = getStockBreakdown(sku, deps, { now: nowMs }); } catch (_e) { continue; }
    if (!b) continue;
    const boTotal = (b.backorderApp && b.backorderApp.total) || 0;
    const fisico = Number(b.fisicoDep11) || 0;
    const asigTotal = (b.asignadas && b.asignadas.total) || 0;
    if (boTotal <= 0) continue;
    const gap = boTotal - fisico;
    const inflado = fisico === 0 ? boTotal > 0 : boTotal > fisico * 1.2;
    if (!inflado) continue;
    m3Rows.push({
      sku, fisicoDep11: fisico, backorderAppTotal: boTotal,
      backorderAppClientes: (b.backorderApp && b.backorderApp.porCliente && b.backorderApp.porCliente.length) || 0,
      asignadasTotal: asigTotal, libre: Number(b.libre) || 0, gap,
    });
  }
  m3Rows.sort((a, b) => b.gap - a.gap);
  const m3Top = m3Rows.slice(0, TOP_N);

  // M4: BO >90d
  console.log('[W] Computando M4...');
  /** @type {Array<any>} */
  const m4Rows = [];
  for (const p of pedidos) {
    if (isSyncSap(p)) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (l.state !== 'BO') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const createdMs = tsToMs(l.asigRevertidaAt) || tsToMs(p.createdAt);
      if (createdMs <= 0) continue;
      const edadDias = Math.round((nowMs - createdMs) / DAY_MS);
      if (edadDias <= 90) continue;
      m4Rows.push({
        cardCode: String(p.clientCardCode || '').trim(),
        clientName: String(p.clientName || '').trim(),
        sku: normSku(l.code), qty: qo, pedidoId: p._fsId,
        orderNumber: String(p.orderNumber || ''), edadDias,
      });
    }
  }
  m4Rows.sort((a, b) => b.edadDias - a.edadDias);

  // M5: multi waitlist/BO por cliente
  console.log('[W] Computando M5...');
  /** @type {Map<string, Array<any>>} */
  const waitlistsByClient = new Map();
  for (const w of waitlist) {
    const key = String(w.clientCardCode || '').trim() || ('name:' + String(w.clientName || '').trim());
    if (!key || key === 'name:') continue;
    const list = waitlistsByClient.get(key) || [];
    list.push(w);
    waitlistsByClient.set(key, list);
  }
  /** @type {Map<string, Array<any>>} */
  const pedidosBoByClient = new Map();
  for (const p of pedidos) {
    if (isSyncSap(p)) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const tieneBo = lines.some((l) => l && l.state === 'BO' && (Number(l.qtyOpen) || 0) > 0);
    if (!tieneBo) continue;
    const key = String(p.clientCardCode || '').trim() || ('name:' + String(p.clientName || '').trim());
    if (!key || key === 'name:') continue;
    const list = pedidosBoByClient.get(key) || [];
    list.push(p);
    pedidosBoByClient.set(key, list);
  }
  const clientesM5 = new Set([...waitlistsByClient.keys(), ...pedidosBoByClient.keys()]);
  /** @type {Array<any>} */
  const m5Rows = [];
  for (const key of clientesM5) {
    const wls = waitlistsByClient.get(key) || [];
    const peds = pedidosBoByClient.get(key) || [];
    if (wls.length < 2 && peds.length < 2) continue;
    const sampleClient = (wls[0] && wls[0].clientName) || (peds[0] && peds[0].clientName) || '';
    const fechas = [];
    for (const w of wls) fechas.push(tsToMs(w.createdAt));
    for (const p of peds) fechas.push(tsToMs(p.createdAt));
    const fFechas = fechas.filter((f) => f > 0);
    const oldestMs = fFechas.length ? Math.min(...fFechas) : 0;
    const newestMs = fFechas.length ? Math.max(...fFechas) : 0;
    m5Rows.push({
      cardCode: key.startsWith('name:') ? '' : key,
      clientName: sampleClient,
      nWaitlists: wls.length, nPedidosBo: peds.length,
      oldestDays: oldestMs ? Math.round((nowMs - oldestMs) / DAY_MS) : null,
      newestDays: newestMs ? Math.round((nowMs - newestMs) / DAY_MS) : null,
    });
  }
  m5Rows.sort((a, b) => (b.nWaitlists + b.nPedidosBo) - (a.nWaitlists + a.nPedidosBo));

  // M6: orden con ASIG + BO vivos mismo SKU
  console.log('[W] Computando M6 (§40.11)...');
  /** @type {Array<any>} */
  const m6Rows = [];
  for (const p of pedidos) {
    if (isSyncSap(p)) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    /** @type {Map<string, {qtyAsig:number, qtyBo:number, nAsig:number, nBo:number}>} */
    const perSku = new Map();
    for (const l of lines) {
      if (!l || !l.code) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const sku = normSku(l.code);
      const bkt = perSku.get(sku) || { qtyAsig: 0, qtyBo: 0, nAsig: 0, nBo: 0 };
      if (l.state === 'ASIG') { bkt.qtyAsig += qo; bkt.nAsig += 1; }
      else if (l.state === 'BO') { bkt.qtyBo += qo; bkt.nBo += 1; }
      perSku.set(sku, bkt);
    }
    for (const [sku, bkt] of perSku) {
      if (bkt.qtyAsig > 0 && bkt.qtyBo > 0) {
        m6Rows.push({
          pedidoId: p._fsId, orderNumber: String(p.orderNumber || ''),
          cardCode: String(p.clientCardCode || '').trim(),
          clientName: String(p.clientName || '').trim(),
          sku, nAsig: bkt.nAsig, qtyAsig: bkt.qtyAsig, nBo: bkt.nBo, qtyBo: bkt.qtyBo,
        });
      }
    }
  }
  m6Rows.sort((a, b) => (b.qtyAsig + b.qtyBo) - (a.qtyAsig + a.qtyBo));

  // M7: resumen
  const m7 = {
    totalPares,
    paresEn1Orden: totalPares - paresMulti,
    paresMulti,
    unitsBoTotal, unitsBoMulti, unitsBoReducibles,
    pctInflacion: unitsBoTotal > 0 ? Math.round((unitsBoReducibles / unitsBoTotal) * 1000) / 10 : 0,
    paresSapPosterior: new Set(m2Rows.map((r) => pairKey(r.cardCode, r.clientName, r.sku))).size,
    unidadesM2: m2Rows.reduce((s, r) => s + r.boQty, 0),
    skusM3: m3Rows.length,
    skusM3Top: m3Top.length,
    lineasM4: m4Rows.length,
    unidadesM4: m4Rows.reduce((s, r) => s + r.qty, 0),
    clientesM5: m5Rows.length,
    lineasM6: m6Rows.length,
    unidadesM6: m6Rows.reduce((s, r) => s + r.qtyAsig + r.qtyBo, 0),
  };

  console.log('');
  console.log('================================================================');
  console.log('RESUMEN (M7)');
  console.log('================================================================');
  console.log('Pares cliente+SKU con BO vigente:        ' + m7.totalPares);
  console.log('  - En 1 orden (OK):                     ' + m7.paresEn1Orden);
  console.log('  - En 2+ ordenes (CANDIDATO FUSION):    ' + m7.paresMulti);
  console.log('Unidades BO vigentes totales:            ' + m7.unitsBoTotal);
  console.log('Unidades BO en pares multi:              ' + m7.unitsBoMulti);
  console.log('Unidades reducibles (fusion):            ' + m7.unitsBoReducibles);
  console.log('% inflacion estimada:                    ' + m7.pctInflacion + '%');
  console.log('');
  console.log('M2: pares BO + envio SAP posterior (' + DAYS_WINDOW + 'd):');
  console.log('  - Pares afectados:                     ' + m7.paresSapPosterior);
  console.log('  - Unidades BO fantasma post-envio:     ' + m7.unidadesM2);
  console.log('');
  console.log('M3: SKUs backorderApp.total inflado:     ' + m7.skusM3);
  console.log('  - Top-' + TOP_N + ':                              ' + m7.skusM3Top);
  console.log('');
  console.log('M4: BOs con createdAt > 90d:             ' + m7.lineasM4 + ' lineas / ' + m7.unidadesM4 + ' u');
  console.log('M5: clientes multi waitlist/BO:          ' + m7.clientesM5);
  console.log('M6: lineas ASIG+BO vivos mismo SKU:      ' + m7.lineasM6 + ' / ' + m7.unidadesM6 + ' u');
  console.log('');

  // Markdown
  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, '45_W_MEDICION_BACKORDER_INFLADO_2026-10-25.md');

  const lines = [];
  lines.push('# W — Medicion backorder inflado prod @ ' + nowIso);
  lines.push('');
  lines.push('**Script:** `scripts/audit/W_backorder_inflado_medicion.cjs` (read-only, 7 metricas).');
  lines.push('');
  lines.push('**Plan asociado:** `docs/plans/2026-10-25-backorder-inflado-analisis.md` (#1206).');
  lines.push('');
  lines.push('**Modo:** READ-ONLY prod. No muta Firestore. Ventana M2 = ' + DAYS_WINDOW + ' dias. Top-N M3 = ' + TOP_N + '.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## M7 — Resumen agregado');
  lines.push('');
  lines.push('| Metrica | Valor |');
  lines.push('|---|---:|');
  lines.push('| Pares cliente+SKU con BO vigente | ' + m7.totalPares + ' |');
  lines.push('| &nbsp;&nbsp;En 1 orden (OK, 1 BO = 1 orden) | ' + m7.paresEn1Orden + ' |');
  lines.push('| &nbsp;&nbsp;En 2+ ordenes (candidato fusion) | ' + m7.paresMulti + ' |');
  lines.push('| Unidades BO vigentes totales | ' + m7.unitsBoTotal + ' |');
  lines.push('| Unidades BO en pares multi | ' + m7.unitsBoMulti + ' |');
  lines.push('| Unidades reducibles por fusion | ' + m7.unitsBoReducibles + ' |');
  lines.push('| % inflacion estimada | ' + m7.pctInflacion + '% |');
  lines.push('| Pares BO + envio SAP posterior (' + DAYS_WINDOW + 'd) | ' + m7.paresSapPosterior + ' |');
  lines.push('| Unidades BO fantasma post-envio | ' + m7.unidadesM2 + ' |');
  lines.push('| SKUs con backorderApp.total inflado | ' + m7.skusM3 + ' |');
  lines.push('| BOs con createdAt > 90d | ' + m7.lineasM4 + ' lineas / ' + m7.unidadesM4 + ' u |');
  lines.push('| Clientes con multi waitlist/BO | ' + m7.clientesM5 + ' |');
  lines.push('| Lineas ASIG + BO vivos mismo SKU | ' + m7.lineasM6 + ' / ' + m7.unidadesM6 + ' u |');
  lines.push('');
  const umbral = m7.unitsBoReducibles > 100 || m7.paresMulti > 20 || m7.unidadesM2 > 50;
  lines.push('**Veredicto preliminar:**');
  lines.push('');
  lines.push(umbral
    ? '> **HAY backorder inflado significativo.** Avanzar con Fase B (diseno fix S1 + control E1-E6).'
    : '> **No hay backorder inflado significativo** en este snapshot. Mantener medicion periodica.');
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## M1 — Pares cliente+SKU con BO repartido en >1 linea u >1 orden');
  lines.push('');
  lines.push('Total: ' + m1Rows.length + '. Mostrando top ' + Math.min(50, m1Rows.length) + ' por qty_total desc.');
  lines.push('');
  if (m1Rows.length === 0) {
    lines.push('_No hay pares con BO repartido._');
  } else {
    lines.push('| cardCode | clientName | sku | n_orders | n_lines | qty_total | qty_max | oldest_d | newest_d |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|');
    for (const r of m1Rows.slice(0, 50)) {
      lines.push('| ' + tdMd(r.cardCode || '-') + ' | ' + tdMd(r.clientName || '-') +
        ' | ' + tdMd(r.sku) + ' | ' + r.nOrders + ' | ' + r.nLines +
        ' | ' + r.qtyTotal + ' | ' + r.qtyMax +
        ' | ' + (r.oldestDays == null ? '-' : r.oldestDays) +
        ' | ' + (r.newestDays == null ? '-' : r.newestDays) + ' |');
    }
  }
  lines.push('');

  lines.push('## M2 — Pares con BO vigente + envio SAP posterior (ventana ' + DAYS_WINDOW + 'd)');
  lines.push('');
  lines.push('Candidatos a "BO fantasma post-envio" (S1/S2). Total eventos: ' + m2Rows.length + '. Mostrando top 50.');
  lines.push('');
  if (m2Rows.length === 0) {
    lines.push('_Sin matches en la ventana._');
  } else {
    lines.push('| cardCode | sku | bo_order | bo_qty | bo_days | sap_order | sap_qty | sap_state | sap_days | delta_d |');
    lines.push('|---|---|---:|---:|---:|---:|---:|---|---:|---:|');
    for (const r of m2Rows.slice(0, 50)) {
      lines.push('| ' + tdMd(r.cardCode || '-') + ' | ' + tdMd(r.sku) +
        ' | ' + tdMd(r.boOrder || '-') + ' | ' + r.boQty +
        ' | ' + (r.boCreatedDays == null ? '-' : r.boCreatedDays) +
        ' | ' + tdMd(r.sapOrder || '-') + ' | ' + r.sapQty +
        ' | ' + tdMd(r.sapState) +
        ' | ' + (r.sapSentDays == null ? '-' : r.sapSentDays) +
        ' | ' + (r.deltaDias == null ? '-' : r.deltaDias) + ' |');
    }
  }
  lines.push('');

  lines.push('## M3 — Top SKUs con backorderApp.total >> fisicoDep11 (via getStockBreakdown §39)');
  lines.push('');
  lines.push('Umbral: `fisico==0 && backorder>0` OR `backorder > 1.2 * fisico`. Total: ' + m3Rows.length + '. Top-' + TOP_N + ' por gap.');
  lines.push('');
  if (m3Top.length === 0) {
    lines.push('_No hay SKUs inflados._');
  } else {
    lines.push('| sku | fisicoDep11 | backorderApp.total | n_clientes | asignadas.total | libre | gap |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const r of m3Top) {
      lines.push('| ' + tdMd(r.sku) + ' | ' + r.fisicoDep11 + ' | ' + r.backorderAppTotal +
        ' | ' + r.backorderAppClientes + ' | ' + r.asignadasTotal +
        ' | ' + r.libre + ' | ' + r.gap + ' |');
    }
  }
  lines.push('');

  lines.push('## M4 — BO con createdAt > 90d (candidatos cleanup §37)');
  lines.push('');
  lines.push('Total: ' + m4Rows.length + ' lineas / ' + m7.unidadesM4 + ' unidades. Top 50 por edad desc.');
  lines.push('');
  if (m4Rows.length === 0) {
    lines.push('_No hay BOs antiguos._');
  } else {
    lines.push('| cardCode | clientName | sku | qty | pedido/orden | edad_dias |');
    lines.push('|---|---|---|---:|---|---:|');
    for (const r of m4Rows.slice(0, 50)) {
      lines.push('| ' + tdMd(r.cardCode || '-') + ' | ' + tdMd(r.clientName || '-') +
        ' | ' + tdMd(r.sku) + ' | ' + r.qty +
        ' | ' + tdMd(r.orderNumber || r.pedidoId) + ' | ' + r.edadDias + ' |');
    }
  }
  lines.push('');

  lines.push('## M5 — Clientes con multi waitlists/BO abiertos');
  lines.push('');
  lines.push('Compliance §42 + fragmentacion BO. Total: ' + m5Rows.length + '.');
  lines.push('');
  if (m5Rows.length === 0) {
    lines.push('_Ninguno._');
  } else {
    lines.push('| cardCode | clientName | n_waitlists | n_pedidos_bo | oldest_d | newest_d |');
    lines.push('|---|---|---:|---:|---:|---:|');
    for (const r of m5Rows.slice(0, 50)) {
      lines.push('| ' + tdMd(r.cardCode || '-') + ' | ' + tdMd(r.clientName || '-') +
        ' | ' + r.nWaitlists + ' | ' + r.nPedidosBo +
        ' | ' + (r.oldestDays == null ? '-' : r.oldestDays) +
        ' | ' + (r.newestDays == null ? '-' : r.newestDays) + ' |');
    }
  }
  lines.push('');

  lines.push('## M6 — Ordenes con ASIG + BO vivos para mismo SKU (sobre-asignacion §40.11)');
  lines.push('');
  lines.push('§40.11 revertSobreAsignadas deberia cerrarlo. Total: ' + m6Rows.length + ' / ' + m7.unidadesM6 + ' u.');
  lines.push('');
  if (m6Rows.length === 0) {
    lines.push('_Ningun caso. §40.11 cubre._');
  } else {
    lines.push('| cardCode | clientName | sku | orden | n_asig | qty_asig | n_bo | qty_bo |');
    lines.push('|---|---|---|---|---:|---:|---:|---:|');
    for (const r of m6Rows.slice(0, 50)) {
      lines.push('| ' + tdMd(r.cardCode || '-') + ' | ' + tdMd(r.clientName || '-') +
        ' | ' + tdMd(r.sku) + ' | ' + tdMd(r.orderNumber || r.pedidoId) +
        ' | ' + r.nAsig + ' | ' + r.qtyAsig + ' | ' + r.nBo + ' | ' + r.qtyBo + ' |');
    }
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Interpretacion');
  lines.push('');
  lines.push('- **M1 + M7**: metrica canonica del plan. Si "unidades reducibles" >100u o >10% → fusion rinde volumen real.');
  lines.push('- **M2**: cuantifica S1/S2 (envio SAP sin descontar BO vigente). Leak critico — "BO fantasma post-envio".');
  lines.push('- **M3**: SKUs con demanda BO desproporcionada al fisico. Priorizar reposicion.');
  lines.push('- **M4**: BOs olvidados (>90d). §37 ya no reservan; inflan `backorderApp.porCliente`.');
  lines.push('- **M5**: cross-check §42. Clientes fragmentados → probable BO fragmentado.');
  lines.push('- **M6**: §40.11 revertSobreAsignadas no cerro gap. Esperamos 0 — si hay rows, investigar CF.');
  lines.push('');
  lines.push('Script: `scripts/audit/W_backorder_inflado_medicion.cjs` (read-only).');
  lines.push('');

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log('[W] Markdown escrito en: ' + outPath);

  console.log('');
  if (umbral) {
    console.log('[W] VEREDICTO: HAY backorder inflado significativo.');
  } else {
    console.log('[W] VEREDICTO: No hay backorder inflado significativo en este snapshot.');
  }

  process.exit(0);
})().catch((e) => {
  console.error('[W] Error:', e && e.message ? e.message : String(e));
  console.error(e && e.stack ? e.stack : '');
  process.exit(1);
});
