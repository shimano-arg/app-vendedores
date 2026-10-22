// Agente E2 — queries inline G5a/G5b/G5c/G5g/G5h/G5k/G5z + G4.G16
// Read-only. No escribe nada en prod.
// Para informe docs/auditoria/42_GRISES_PROD.md

const PROJECT = 'app-vendedores-shimano';
const SAMPLE_MAX = 5;
const PAUSE_THRESHOLD = 50;

(async () => {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('Agente E2 — queries inline @ ' + nowIso);
  console.log('================================================================');

  // === Preload: pedidos abiertos + ingresos_reparto abiertos + stock snapshot
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = [];
  pedidosSnap.forEach((d) => pedidos.push(Object.assign({ _fsId: d.id }, d.data())));
  console.log('Pedidos abiertos: ' + pedidos.length);

  // === G5a: qtyOpen > qty + state in {BO, ASIG, confirmed}
  // === G5b: qty <= 0 + state in {BO, ASIG, confirmed}
  // === G5c: precio=0 + priceAtCreation=0 + state != cancelled
  // === G5g: origen='stock-asignado' + asigRefs vacío (regresión H1)
  // === G5h: pedidos closedAt==null con todas lines cancelled|invoiced
  const activeStates = new Set(['BO', 'ASIG', 'confirmed']);
  const g5a = [], g5b = [], g5c = [], g5g = [], g5h = [];

  for (const p of pedidos) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    let anyLive = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      const qty = Number(l.qty);
      const qo = Number(l.qtyOpen);
      const state = l.state;
      // G5a
      if (Number.isFinite(qty) && Number.isFinite(qo) && qo > qty && activeStates.has(state)) {
        g5a.push({ pedidoId: p._fsId, orderNumber: p.orderNumber, lineIdx: i, sku: l.code, qty, qtyOpen: qo, state });
      }
      // G5b
      if (Number.isFinite(qty) && qty <= 0 && activeStates.has(state)) {
        g5b.push({ pedidoId: p._fsId, orderNumber: p.orderNumber, lineIdx: i, sku: l.code, qty, qtyOpen: qo, state });
      }
      // G5c
      const precio = Number(l.precio);
      const pac = Number(l.priceAtCreation);
      if (precio === 0 && pac === 0 && state && state !== 'cancelled') {
        g5c.push({ pedidoId: p._fsId, orderNumber: p.orderNumber, lineIdx: i, sku: l.code, state });
      }
      // G5g: origen stock-asignado sin asigRefs
      if (l.origen === 'stock-asignado') {
        const refs = Array.isArray(l.asigRefs) ? l.asigRefs : null;
        if (!refs || refs.length === 0) {
          g5g.push({ pedidoId: p._fsId, orderNumber: p.orderNumber, lineIdx: i, sku: l.code, state, qtyOpen: qo });
        }
      }
      // Mark live
      if (state && state !== 'cancelled' && state !== 'invoiced') anyLive = true;
    }
    // G5h
    if (!anyLive && lines.length > 0) {
      g5h.push({ pedidoId: p._fsId, orderNumber: p.orderNumber, totalLines: lines.length, clientName: p.clientName });
    }
  }

  // === G5k: ingresos_reparto assignments.lineIndex apuntando a línea inexistente
  const repartosSnap = await db.collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress']).get();
  const repartos = [];
  repartosSnap.forEach((d) => repartos.push(Object.assign({ _fsId: d.id }, d.data())));
  console.log('Repartos abiertos (pending|in_progress): ' + repartos.length);

  const g5k = [];
  // Index pedidos by id
  const pedidoById = new Map();
  pedidos.forEach((p) => pedidoById.set(p._fsId, p));

  for (const r of repartos) {
    const assignments = Array.isArray(r.assignments) ? r.assignments : [];
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      if (!a || !a.pedidoId) continue;
      const p = pedidoById.get(a.pedidoId);
      if (!p) {
        // Pedido no está entre abiertos — podría estar closed, no es gris por sí mismo
        continue;
      }
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const li = Number(a.lineIndex);
      if (!Number.isFinite(li) || li < 0 || li >= lines.length) {
        g5k.push({
          repartoId: r._fsId, assignmentIdx: i, pedidoId: a.pedidoId,
          lineIndex: a.lineIndex, linesLen: lines.length, sku: r.sku,
        });
      }
    }
  }

  // === G5z: SAP mismatch Committed vs app confirmed
  const stockDoc = await db.doc('app_config/stock_snapshot').get();
  const sd = stockDoc.data() || {};
  const whs = typeof sd.whsBreakdown === 'string'
    ? JSON.parse(sd.whsBreakdown)
    : (sd.whsBreakdown || sd.warehouseBreakdown || {});

  const appConfirmedBySku = new Map(); // sku -> qty confirmed sin orderDocEntry
  for (const p of pedidos) {
    const noOrder = !(p.transferidoSAP && p.transferidoSAP.orderDocEntry != null);
    if (!noOrder) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const l of lines) {
      if (!l || !l.code) continue;
      if (l.state !== 'confirmed') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const sku = String(l.code).toUpperCase();
      appConfirmedBySku.set(sku, (appConfirmedBySku.get(sku) || 0) + qo);
    }
  }

  const g5z = [];
  for (const [sku, appQty] of appConfirmedBySku.entries()) {
    const whsBySku = whs[sku] || whs[sku.toLowerCase()] || {};
    const committed = Number(whsBySku.Committed || whsBySku.committed || 0);
    const diff = Math.abs(appQty - committed);
    if (diff > 0) {
      g5z.push({ sku, appConfirmed: appQty, sapCommitted: committed, diff });
    }
  }
  g5z.sort((a, b) => b.diff - a.diff);
  const g5zTop20 = g5z.slice(0, 20);

  // === G4.G16: pedidos stage='confirmed' + transferidoSAP==null + confirmedAt < now - 1h
  const g4g16 = [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const p of pedidos) {
    if (p.stage !== 'confirmed') continue;
    const noTransfer = !p.transferidoSAP || !p.transferidoSAP.docNum;
    if (!noTransfer) continue;
    // confirmedAt — Firestore Timestamp o ISO string
    const cat = p.confirmedAt;
    let catMs = null;
    if (cat && typeof cat === 'object' && typeof cat.toMillis === 'function') {
      catMs = cat.toMillis();
    } else if (typeof cat === 'string') {
      catMs = Date.parse(cat);
    } else if (typeof cat === 'number') {
      catMs = cat;
    }
    if (catMs !== null && catMs < oneHourAgo) {
      g4g16.push({
        pedidoId: p._fsId, orderNumber: p.orderNumber,
        clientName: p.clientName, ageMin: Math.round((Date.now() - catMs) / 60000),
        transferidoSAP: p.transferidoSAP || null,
      });
    }
  }

  // === OUTPUT
  function fmtTable(id, label, arr, sampleFn, countFn) {
    const unitCount = countFn ? countFn(arr) : arr.length;
    const flag = unitCount > PAUSE_THRESHOLD ? ' ⚠️ PAUSA 50U' : '';
    console.log('\n--- ' + id + ': ' + label + flag + ' ---');
    console.log('count=' + arr.length + (countFn ? ' unidades=' + unitCount : ''));
    const sample = arr.slice(0, SAMPLE_MAX).map(sampleFn).join(' | ');
    if (sample) console.log('sample: ' + sample);
    return { id, label, count: arr.length, unitCount, pauseFlag: unitCount > PAUSE_THRESHOLD, sample: arr.slice(0, SAMPLE_MAX) };
  }

  const results = [];
  results.push(fmtTable('G5a', 'qtyOpen > qty activa', g5a,
    (x) => `${x.pedidoId}:${x.lineIdx} sku=${x.sku} qty=${x.qty} qo=${x.qtyOpen} state=${x.state}`,
    (arr) => arr.reduce((s, x) => s + (x.qtyOpen - x.qty), 0)));
  results.push(fmtTable('G5b', 'qty <= 0 activa', g5b,
    (x) => `${x.pedidoId}:${x.lineIdx} sku=${x.sku} qty=${x.qty} state=${x.state}`,
    (arr) => arr.length));
  results.push(fmtTable('G5c', 'precio=0 + priceAtCreation=0 state!=cancelled', g5c,
    (x) => `${x.pedidoId}:${x.lineIdx} sku=${x.sku} state=${x.state}`,
    (arr) => arr.length));
  results.push(fmtTable('G5g', "origen='stock-asignado' + asigRefs vacío (REGRESIÓN H1 silenciosa)", g5g,
    (x) => `${x.pedidoId}:${x.lineIdx} sku=${x.sku} state=${x.state} qo=${x.qtyOpen}`,
    (arr) => arr.reduce((s, x) => s + (x.qtyOpen || 0), 0)));
  results.push(fmtTable('G5h', 'pedidos sin líneas vivas (closedAt=null)', g5h,
    (x) => `${x.pedidoId} ORDEN=${x.orderNumber} ${x.clientName}`,
    (arr) => arr.length));
  results.push(fmtTable('G5k', 'ingresos_reparto.assignments.lineIndex inválido', g5k,
    (x) => `reparto=${x.repartoId} sku=${x.sku} pedido=${x.pedidoId} lineIndex=${x.lineIndex} (lines.len=${x.linesLen})`,
    (arr) => arr.length));
  results.push(fmtTable('G5z', 'SAP Committed vs app confirmed sin orderDocEntry (top 20)', g5zTop20,
    (x) => `sku=${x.sku} app=${x.appConfirmed} sap=${x.sapCommitted} diff=${x.diff}`,
    (arr) => arr.reduce((s, x) => s + x.diff, 0)));
  results.push(fmtTable('G4.G16', 'pedidos stage=confirmed sin transferidoSAP > 1h', g4g16,
    (x) => `${x.pedidoId} ORDEN=${x.orderNumber} ${x.clientName} age=${x.ageMin}min`,
    (arr) => arr.length));

  // JSON para parsear después si hace falta
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '_E2_inline_output.json');
  fs.writeFileSync(outPath, JSON.stringify({
    nowIso,
    pedidosAbiertos: pedidos.length,
    repartosAbiertos: repartos.length,
    results,
  }, null, 2));
  console.log('\nJSON escrito en: ' + outPath);
})().catch((e) => { console.error(e); process.exit(1); });
