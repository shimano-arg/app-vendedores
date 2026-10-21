// E0 — Dump completo de CUDC201HG para explicar los 5 números del
// Modal Backorder, Modal Reparto, Popup Master, Modal Pedido en espera
// y Modal Stock Asignado. Read-only prod.
//
// Autorizado por Mariano 2026-10-21.
//
// Uso: node scripts/audit/_dump_cudc_full.cjs [SKU]
//   SKU default: CUDC201HG

const SKU = (process.argv[2] || 'CUDC201HG').toUpperCase();
const PROJECT = 'app-vendedores-shimano';

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.toDate === 'function') try { return v.toDate().toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.toMillis === 'function') try { return new Date(v.toMillis()).toISOString(); } catch (_e) {}
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  return String(v);
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('DUMP COMPLETO ' + SKU + ' @ ' + nowIso);
  console.log('================================================================');
  console.log('');

  // 1. stock_snapshot (físico + tránsito)
  console.log('===== 1. app_config/stock_snapshot =====');
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const sd = stockSnap.data() || {};
  let whs = {};
  try {
    whs = typeof sd.warehouseBreakdown === 'string' ? JSON.parse(sd.warehouseBreakdown) : (sd.warehouseBreakdown || {});
  } catch (_e) {}
  const whsSku = whs[SKU] || {};
  console.log('updatedAt=' + toIso(sd.updatedAt));
  console.log('warehouseBreakdown[' + SKU + ']=' + JSON.stringify(whsSku));
  console.log('qty total map=' + ((sd.qtyBySku || {})[SKU] ?? 'undef'));
  console.log('has_stk map=' + ((sd.stockBySku || {})[SKU] ?? 'undef'));
  console.log('');

  // 2. backorderBySkuApp (candidato fuente del "26")
  console.log('===== 2. app_config/backorderBySkuApp =====');
  try {
    const boSnap = await db.doc('app_config/backorderBySkuApp').get();
    const bd = boSnap.data() || {};
    const skuEntry = bd[SKU] || bd[SKU.toLowerCase()] || null;
    console.log('exists=' + boSnap.exists + ' updatedAt=' + toIso(bd.updatedAt));
    console.log(SKU + ' entry=' + JSON.stringify(skuEntry));
    const keys = Object.keys(bd).filter((k) => k !== 'updatedAt').slice(0, 3);
    console.log('(primeras 3 keys para muestra: ' + keys.join(', ') + ')');
  } catch (e) {
    console.log('error leyendo backorderBySkuApp: ' + e.message);
  }
  console.log('');

  // 3. backorder_snapshot (alternativo)
  console.log('===== 3. app_config/backorder_snapshot =====');
  try {
    const bs = await db.doc('app_config/backorder_snapshot').get();
    if (!bs.exists) {
      console.log('(no existe)');
    } else {
      const data = bs.data() || {};
      console.log('exists=true updatedAt=' + toIso(data.updatedAt));
      const bySku = data.bySku || data.lineas || data.pedidos || null;
      if (bySku && bySku[SKU]) {
        console.log(SKU + ' entry=' + JSON.stringify(bySku[SKU]).slice(0, 1000));
      } else {
        console.log('no hay entry para ' + SKU + ' en bySku/lineas/pedidos');
        console.log('top-level keys=' + Object.keys(data).slice(0, 10).join(', '));
      }
    }
  } catch (e) {
    console.log('error: ' + e.message);
  }
  console.log('');

  // 4. ingresos_reparto (todos los status) para SKU
  console.log('===== 4. ingresos_reparto (todos los status) para ' + SKU + ' =====');
  const irSnap = await db.collection('ingresos_reparto').where('sku', '==', SKU).get();
  console.log('total docs=' + irSnap.size);
  irSnap.forEach((d) => {
    const data = d.data();
    const clientes = Array.isArray(data.clientesBO) ? data.clientesBO.length : 0;
    const assignments = Array.isArray(data.assignments) ? data.assignments.length : 0;
    console.log('  id=' + d.id + ' status=' + data.status + ' source=' + (data.source || 'delta') + ' qtyIng=' + data.qtyIngresada + ' clientesCount=' + clientes + ' assignments=' + assignments + ' detectedAt=' + toIso(data.detectedAt) + ' closedAt=' + toIso(data.closedAt) + ' closedReason=' + (data.closedReason || ''));
  });
  console.log('');

  // 5. pedidos abiertos con línea del SKU
  console.log('===== 5. pedidos abiertos con linea ' + SKU + ' =====');
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const matches = [];
  pedidosSnap.forEach((doc) => {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== SKU) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      matches.push({
        pedidoId: doc.id,
        lineIndex: i,
        clientCardCode: data.clientCardCode || '',
        clientName: data.clientName || '',
        createdAt: toIso(data.createdAt),
        confirmedAt: toIso(data.confirmedAt),
        stage: data.stage,
        transferidoSAP: data.transferidoSAP ? { docEntry: data.transferidoSAP.docEntry, docNum: data.transferidoSAP.docNum, docType: data.transferidoSAP.docType, via: data.transferidoSAP.via, transferredAt: toIso(data.transferidoSAP.transferredAt) } : null,
        state: l.state,
        qtyOpen: qo,
        qty: l.qty,
        asigAt: toIso(l.asigAt),
        asigReserva: l.asigReserva,
        origen: l.origen || null,
        asigRefs: l.asigRefs || null,
        source: data.source || null,
      });
    }
  });
  console.log('total lineas abiertas de ' + SKU + ' = ' + matches.length);
  matches.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const byState = {};
  const byClient = {};
  matches.forEach((m) => {
    byState[m.state] = (byState[m.state] || 0) + m.qtyOpen;
    byClient[m.clientName] = (byClient[m.clientName] || 0) + m.qtyOpen;
    console.log('  ' + m.state + ' qtyOpen=' + m.qtyOpen + ' client=' + m.clientName + ' (' + m.clientCardCode + ') createdAt=' + m.createdAt + ' confirmedAt=' + m.confirmedAt + ' pedido=' + m.pedidoId + ' line=' + m.lineIndex + (m.transferidoSAP ? ' SAP=' + m.transferidoSAP.docNum + '/' + m.transferidoSAP.docType : '') + ' source=' + m.source);
  });
  console.log('');
  console.log('subtotales por state=' + JSON.stringify(byState));
  console.log('subtotales por cliente=' + JSON.stringify(byClient));
  console.log('');

  // 6. computar lineReservesStock + getStockDesglose desde src/pure
  console.log('===== 6. computar con lineReservesStock (reglas CLAUDE.md §36/§37/§38) =====');
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const BO_TTL = 90;
  const RSV_TTL = 7;
  const CF_HARD = 60;
  function reserva(l, pedido) {
    if (!l) return false;
    if (l.state === 'BO') {
      if (pedido && pedido.createdAt) {
        const ms = typeof pedido.createdAt === 'string' ? Date.parse(pedido.createdAt) : null;
        if (ms && (now - ms) / DAY > BO_TTL) return false;
      }
      return true;
    }
    if (l.state === 'confirmed') {
      if (l.asigReserva === false || l.asigReserva === 0) return false;
      if (!pedido || !pedido.confirmedAt) return false;
      const ms = typeof pedido.confirmedAt === 'string' ? Date.parse(pedido.confirmedAt) : null;
      if (ms === null) return false;
      const d = (now - ms) / DAY;
      if (d > RSV_TTL) return false;
      if (d > CF_HARD) return false;
      return true;
    }
    if (l.state === 'ASIG') {
      if (l.asigReserva === false || l.asigReserva === 0) return false;
      if (l.asigAt) {
        const ms = typeof l.asigAt === 'string' ? Date.parse(l.asigAt) : null;
        if (ms && (now - ms) / DAY > RSV_TTL) return false;
      }
      return true;
    }
    return false;
  }
  const vig = { BO: 0, confirmed: 0, ASIG: 0 };
  const vigPorCliente = { BO: {}, confirmed: {}, ASIG: {} };
  matches.forEach((m) => {
    const pedido = { createdAt: m.createdAt, confirmedAt: m.confirmedAt };
    if (reserva({ state: m.state, qtyOpen: m.qtyOpen, asigAt: m.asigAt, asigReserva: m.asigReserva }, pedido)) {
      vig[m.state] = (vig[m.state] || 0) + m.qtyOpen;
      vigPorCliente[m.state][m.clientName] = (vigPorCliente[m.state][m.clientName] || 0) + m.qtyOpen;
    }
  });
  console.log('VIGENTES (post TTL §36/§37/§38):');
  console.log('  BO total=' + vig.BO + ' por cliente=' + JSON.stringify(vigPorCliente.BO));
  console.log('  confirmed total=' + vig.confirmed + ' por cliente=' + JSON.stringify(vigPorCliente.confirmed));
  console.log('  ASIG total=' + vig.ASIG + ' por cliente=' + JSON.stringify(vigPorCliente.ASIG));
  const comp = vig.BO + vig.confirmed + vig.ASIG;
  const fisico = Number(whsSku['11']) || 0;
  const transito = Number(whsSku['12']) || 0;
  console.log('');
  console.log('COMPUTED (lo que debería mostrar getStockBreakdown):');
  console.log('  fisicoDep11=' + fisico);
  console.log('  transitoDep12=' + transito);
  console.log('  reservadasTotal=' + comp);
  console.log('  libre=max(0, ' + fisico + '-' + comp + ')=' + Math.max(0, fisico - comp));
  const asigVig = vig.ASIG;
  const cfVig = vig.confirmed;
  const boVig = vig.BO;
  const pendRep = boVig > 0 ? Math.max(0, fisico - asigVig - cfVig) : 0;
  console.log('  pendienteReparto=' + pendRep + ' (si BO vig > 0, max(0, fisico-ASIG-confirmed))');
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR: ' + (e && e.stack || e)); process.exit(1); });
