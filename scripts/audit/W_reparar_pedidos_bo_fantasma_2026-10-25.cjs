#!/usr/bin/env node
// @ts-check
/**
 * INCIDENTE 2026-10-23 (reportado 2026-10-25) — reparación de pedidos que
 * quedaron en BO completo por bug lectura snapshot en commitPedidoCF.
 *
 * ROOT CAUSE (ya fixeado en v1448 PR #1202, deployed hoy):
 *   commit-pedido-core.js leía warehouseBreakdown esperando dict, pero
 *   Python escribe JSON string → fisico=0 → qtyBO=cantidad → TODO va a BO
 *   + transferidoSAP.via='app_only' + reason='all_lines_bo_server_detected'.
 *
 * REPARACIÓN (condiciones Mariano 2026-10-25):
 *   a. Pedidos quedan "listos para enviar a SAP" (transferidoSAP=null +
 *      closedReason=null + lines split confirmed/BO). NO envía a SAP solo.
 *   b. Recálculo en ORDEN CRONOLÓGICO (confirmedAt ASC) usando
 *      `getStockBreakdown` del pure (functions/core/pedido-snapshot-core.js).
 *      Cada pedido descuenta del libre lo que los anteriores de ESTA lista
 *      YA se llevaron (sumando sus líneas reparadas al array de pedidos
 *      abiertos para la siguiente iteración). Respeta ASIG + confirmed de
 *      otros clientes (§39).
 *   c. Resuelve `assignedVendorUid` faltante usando master del cliente
 *      (§46 resolveClientVendorFromMaster).
 *
 * EXCLUYE: duplicado SATO qlB4FpI3R9Rhu5sLZvbf. Correr D_eliminar... ANTES
 * de este script.
 *
 * NO ENVÍA A SAP. Mariano o cada VDE lo manda mañana desde la UI/panel.
 *
 * Uso:
 *   node scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs            # dry-run
 *   node scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs --apply   # SOLO con OK Mariano
 *   node scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs --pedido=jwKRy...   # un solo pedido
 */

const admin = require('../../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

// `reason=all_lines_bo_server_detected` es único del bug: filtro suficiente.
// INCIDENT_START queda como corte defensivo para pedidos muy viejos.
const INCIDENT_START = new Date('2026-10-23T18:00:00Z'); // 15:00 ART
const EXCLUDE_IDS = new Set(['qlB4FpI3R9Rhu5sLZvbf']); // SATO duplicado (D_...)

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const pedidoFilterArg = args.find((a) => a.startsWith('--pedido='));
  const pedidoFilter = pedidoFilterArg ? pedidoFilterArg.split('=')[1] : null;

  // Import dinámico del pure helper (getStockBreakdown).
  const { getStockBreakdown } = await import(
    '../../functions/core/pedido-snapshot-core.js'
  );
  // Import resolveClientVendorFromMaster del pure cliente.
  const { resolveClientVendorFromMaster } = await import(
    '../../src/pure/resolve-client-vendor.js'
  );

  console.log(`\n[W] Reparación pedidos BO fantasma — ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[W] Rango: desde ${INCIDENT_START.toISOString()}`);
  console.log(`[W] Excluye: ${Array.from(EXCLUDE_IDS).join(', ')}`);
  if (pedidoFilter) console.log(`[W] Filtro pedidoId: ${pedidoFilter}`);
  console.log('');

  // 1. Buscar pedidos afectados.
  console.log('[W] Buscando pedidos afectados...');
  const snap = await db
    .collection('pedidos')
    .where('_commitVersion', '==', 'commitPedidoCore_v1')
    .get();
  const afectados = [];
  snap.forEach((d) => {
    if (EXCLUDE_IDS.has(d.id)) return;
    if (pedidoFilter && d.id !== pedidoFilter) return;
    const data = d.data() || {};
    const transferido = data.transferidoSAP || {};
    if (transferido.via !== 'app_only') return;
    const reason = transferido.reason || data.closedReason || '';
    if (reason !== 'all_lines_bo_server_detected') return;
    const confirmedAt =
      data.confirmedAt && typeof data.confirmedAt.toMillis === 'function'
        ? new Date(data.confirmedAt.toMillis())
        : data.confirmedAt instanceof Date
          ? data.confirmedAt
          : null;
    if (!confirmedAt || confirmedAt < INCIDENT_START) return;
    afectados.push({ id: d.id, data, confirmedAt });
  });
  // Orden cronológico ASC: el primero que confirmó se lleva el libre primero.
  afectados.sort((a, b) => a.confirmedAt - b.confirmedAt);
  console.log(`[W] Encontrados: ${afectados.length} pedidos afectados.`);
  if (afectados.length === 0) {
    console.log('[W] Nada que reparar.');
    return;
  }

  // 2. Leer snapshot ACTUAL (post-fix PR #1202).
  const stockSnap = await db.doc('app_config/stock_snapshot').get();
  const stockData = stockSnap.exists ? stockSnap.data() || {} : {};
  let warehouseBreakdown = {};
  const rawWhsBd = stockData.warehouseBreakdown;
  if (typeof rawWhsBd === 'string') {
    try {
      warehouseBreakdown = JSON.parse(rawWhsBd);
    } catch (e) {
      console.error('[W] CRITICAL: warehouseBreakdown no parsea:', e.message);
      process.exit(1);
    }
  } else if (typeof rawWhsBd === 'object' && rawWhsBd !== null) {
    warehouseBreakdown = rawWhsBd;
  }
  console.log(
    `[W] Snapshot leído. source=${stockData.source}, SKUs=${Object.keys(warehouseBreakdown).length}`
  );
  // Helper getStockFisico para el pure.
  const getStockFisico = (sku) => {
    const u = String(sku || '').toUpperCase();
    return Number((warehouseBreakdown[u] || {})[11] || 0);
  };

  // 3. Leer TODOS los pedidos abiertos + waitlist CPST (para getStockBreakdown).
  //    Clave: incluir los AFECTADOS originales (para que su "reserva fantasma"
  //    no doble-cuente). getStockBreakdown recorre pedidos; ASIG y confirmed
  //    de otros clientes se contabilizan.
  console.log('[W] Leyendo pedidos abiertos + waitlist CPST...');
  const abiertosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidosAbiertos = [];
  abiertosSnap.forEach((d) => {
    const data = d.data() || {};
    pedidosAbiertos.push({ _fsId: d.id, ...data });
  });
  const waitlistSnap = await db.collection('revision_waitlist').get();
  const waitlistEntries = [];
  waitlistSnap.forEach((d) => {
    waitlistEntries.push({ _fsId: d.id, ...d.data() });
  });

  // Al "reparar" un pedido afectado, lo removemos de pedidosAbiertos y lo
  // volvemos a agregar con sus líneas REPARADAS. Así la siguiente iteración
  // ve las reservas correctas.
  // IMPORTANTE: los pedidos afectados actualmente tienen líneas state='BO'
  // que NO reservan (§40). Entonces al removerlos no "libero" nada. Al
  // reagregarlos con líneas confirmed, SÍ reservan para los siguientes.

  // 4. (opcional) Cargar POINTS + vendor_overrides + approvedAltas + users
  //    para resolver vendor por cliente master (§46).
  console.log('[W] Cargando POINTS + overrides + altas + users (para resolver vendor)...');
  const [pointsSnap, overridesSnap, altasSnap, usersSnap] = await Promise.all([
    db.collection('points').get(),
    db.collection('vendor_overrides').get(),
    db.collection('client_applications').get(),
    db.collection('roles').get(),
  ]);
  const points = [];
  pointsSnap.forEach((d) => points.push({ _fsId: d.id, ...d.data() }));
  const vendorOverrides = [];
  overridesSnap.forEach((d) => vendorOverrides.push(d.data()));
  const approvedAltas = [];
  altasSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.status === 'approved' || data.cardCodeSap) approvedAltas.push(data);
  });
  const users = [];
  usersSnap.forEach((d) => users.push({ uid: d.id, ...d.data() }));
  // Helpers minimales: getEffectiveVendorForClient y sapGetClienteCode.
  function getEffectiveVendorForClient(point, _name) {
    if (!point) return null;
    // Simplificado: toma point.vendor directamente. vendor_overrides se podría
    // layer-ear por SHOP/LOC/PROV pero para la reparación el point.vendor
    // base es suficiente para los casos observados.
    return point.vendor || null;
  }
  function sapGetClienteCode(_name) {
    return null; // los pedidos afectados ya tienen clientCardCode set.
  }

  // 5. Para cada pedido afectado, recomputar en orden cronológico.
  console.log('\n[W] Plan de reparación (orden cronológico, getStockBreakdown):\n');
  const reparaciones = [];
  for (const pedido of afectados) {
    const { id, data, confirmedAt } = pedido;
    const cliente = data.clientName || '?';
    const cardCode = data.clientCardCode || '?';
    const vendorAssignedBefore = data.vendorAssigned || data.ownerVendor || '';
    const assignedVendorUidBefore = data.assignedVendorUid || null;

    // Resolver vendor del master si falta.
    let newVendorAssigned = vendorAssignedBefore;
    let newAssignedVendorUid = assignedVendorUidBefore;
    if (!vendorAssignedBefore || !assignedVendorUidBefore) {
      try {
        const resolution = resolveClientVendorFromMaster({
          cardCode,
          clientName: cliente,
          points,
          vendorOverrides,
          approvedAltas,
          users,
          getEffectiveVendorForClient,
          sapGetClienteCode,
        });
        if (resolution && resolution.vendorKey) {
          newVendorAssigned = resolution.vendorKey;
          if (resolution.vendorUid) newAssignedVendorUid = resolution.vendorUid;
        }
      } catch (_e) {
        // Non-fatal.
      }
    }

    console.log(
      `\n--- Pedido ${id.substring(0, 10)}... | ${confirmedAt.toISOString()} | ${cliente} (${cardCode}) | vendor=${newVendorAssigned || '(sin vendedor)'} ${!vendorAssignedBefore && newVendorAssigned ? '[resuelto]' : ''} ---`
    );
    // Filtrar: SOLO reparamos líneas state='BO' qtyOpen>0 (las que el bug mandó a BO).
    const linesOut = [];
    const planLineas = [];
    let totalConfirmedUnidades = 0;
    let totalBoUnidades = 0;
    for (let i = 0; i < (data.lines || []).length; i++) {
      const line = data.lines[i];
      if (!line || !line.code) {
        linesOut.push(line);
        continue;
      }
      const sku = String(line.code).toUpperCase();
      const qty = Number(line.qty) || 0;
      const esBoFantasma = line.state === 'BO' && Number(line.qtyOpen) > 0;
      if (!esBoFantasma) {
        linesOut.push(line);
        continue;
      }
      // Recomputar con getStockBreakdown (§39).
      const bd = getStockBreakdown(sku, {
        getStockFisico,
        pedidos: pedidosAbiertos,
        waitlistEntries,
        ingresosRepartoActivos: [], // sin uso en este contexto
      });
      // §39: utilizablePara(cardCode) = libre + reservas propias del cliente (menos BO).
      // Para la reparación usamos `libre` (lo que efectivamente puede llevarse sin
      // sobre-asignar) + utilizablePara(cardCode) si el cliente tiene reservas propias.
      // Como el pedido afectado NO reserva (está en BO), libre ya es el disponible real.
      const libre = typeof bd.libre === 'number' ? bd.libre : 0;
      const qtyConfirmed = Math.min(qty, libre);
      const qtyBO = qty - qtyConfirmed;
      planLineas.push({
        sku,
        qtyPedida: qty,
        fisico: bd.fisicoDep11,
        reservadasTotal: bd.reservadasTotal,
        libre,
        qtyConfirmed,
        qtyBO,
      });
      totalConfirmedUnidades += qtyConfirmed;
      totalBoUnidades += qtyBO;
      if (qtyConfirmed > 0) {
        linesOut.push({
          ...line,
          qty: qtyConfirmed,
          qtyOpen: qtyConfirmed,
          state: 'confirmed',
          _repairedFrom: 'W_reparar_pedidos_bo_fantasma_2026-10-25',
        });
      }
      if (qtyBO > 0) {
        linesOut.push({
          ...line,
          qty: qtyBO,
          qtyOpen: qtyBO,
          state: 'BO',
          _repairedFrom: 'W_reparar_pedidos_bo_fantasma_2026-10-25',
        });
      }
    }
    console.log(
      `  Líneas: ${planLineas.length} a reparar. Confirmed=${totalConfirmedUnidades}u, BO=${totalBoUnidades}u.`
    );
    const topLineas = planLineas.slice(0, 10);
    for (const p of topLineas) {
      console.log(
        `    ${p.sku.padEnd(18)}  qty=${String(p.qtyPedida).padStart(3)}  fisico=${String(p.fisico).padStart(3)}  resAjenas=${String(p.reservadasTotal).padStart(3)}  libre=${String(p.libre).padStart(3)}  →  confirmed=${String(p.qtyConfirmed).padStart(3)}  BO=${String(p.qtyBO).padStart(3)}`
      );
    }
    if (planLineas.length > 10) console.log(`    ... ${planLineas.length - 10} líneas más`);
    reparaciones.push({
      id,
      cliente,
      cardCode,
      confirmedAt,
      linesOut,
      planLineas,
      totalConfirmedUnidades,
      totalBoUnidades,
      vendorAssignedBefore,
      newVendorAssigned,
      assignedVendorUidBefore,
      newAssignedVendorUid,
      originalData: data,
    });

    // Actualizar el pedido en pedidosAbiertos para la siguiente iteración:
    // reemplazar las líneas BO fantasma por las reparadas (ya con confirmed).
    const idx = pedidosAbiertos.findIndex((p) => p._fsId === id);
    if (idx >= 0) {
      pedidosAbiertos[idx] = { ...pedidosAbiertos[idx], lines: linesOut };
    }
  }

  // 6. Resumen agregado.
  console.log('\n' + '='.repeat(90));
  console.log('[W] RESUMEN DE REPARACIÓN');
  console.log('='.repeat(90));
  console.log(
    `${'Pedido'.padEnd(18)} ${'Cliente'.padEnd(25)} ${'Vendedor'.padEnd(22)} ${'Confirmed'.padStart(10)} ${'BO'.padStart(6)}`
  );
  console.log('-'.repeat(90));
  let totalConfirmed = 0;
  let totalBo = 0;
  for (const r of reparaciones) {
    const vendor = (r.newVendorAssigned || '(sin)').substring(0, 20);
    const vendorFlag =
      !r.vendorAssignedBefore && r.newVendorAssigned
        ? ' *'
        : r.vendorAssignedBefore !== r.newVendorAssigned && r.newVendorAssigned
          ? ' !'
          : '';
    console.log(
      `${r.id.substring(0, 16).padEnd(18)} ${r.cliente.substring(0, 24).padEnd(25)} ${vendor.padEnd(20)}${vendorFlag.padEnd(2)} ${String(r.totalConfirmedUnidades).padStart(10)} ${String(r.totalBoUnidades).padStart(6)}`
    );
    totalConfirmed += r.totalConfirmedUnidades;
    totalBo += r.totalBoUnidades;
  }
  console.log('-'.repeat(90));
  console.log(
    `${'TOTAL'.padEnd(68)} ${String(totalConfirmed).padStart(10)} ${String(totalBo).padStart(6)}`
  );
  console.log('\n* = vendedor resuelto desde master. ! = cambió vs valor previo.');

  // 7. Apply.
  if (!apply) {
    console.log('\n[W] DRY-RUN. Para aplicar, correr con --apply (requiere OK Mariano).');
    return;
  }

  console.log('\n[W] APPLY. Mutando pedidos...');
  for (const r of reparaciones) {
    const ref = db.collection('pedidos').doc(r.id);
    const snapshotPrevio = {
      lines: r.originalData.lines,
      transferidoSAP: r.originalData.transferidoSAP || null,
      closedReason: r.originalData.closedReason || null,
      vendorAssigned: r.originalData.vendorAssigned || null,
      assignedVendorUid: r.originalData.assignedVendorUid || null,
    };
    /** @type {Record<string, any>} */
    const updateData = {
      lines: r.linesOut,
      transferidoSAP: null,
      closedReason: null,
      _backfill: {
        [`W_bo_fantasma_${new Date().toISOString().slice(0, 10)}`]: {
          previousValues: snapshotPrevio,
          by: 'scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs',
          at: new Date().toISOString(),
          reason: 'Reparación incidente lectura snapshot JSON string (v1448 fix)',
          totalConfirmedUnidades: r.totalConfirmedUnidades,
          totalBoUnidades: r.totalBoUnidades,
        },
      },
      _lastBackfillAt: new Date().toISOString(),
      _lastBackfillBy: 'scripts/audit/W_reparar_pedidos_bo_fantasma_2026-10-25.cjs',
    };
    if (r.newVendorAssigned && r.newVendorAssigned !== r.vendorAssignedBefore) {
      updateData.vendorAssigned = r.newVendorAssigned;
    }
    if (r.newAssignedVendorUid && r.newAssignedVendorUid !== r.assignedVendorUidBefore) {
      updateData.assignedVendorUid = r.newAssignedVendorUid;
    }
    await ref.update(updateData);
    console.log(`  ✓ Reparado ${r.id.substring(0, 10)}... (${r.cliente})`);
  }
  console.log(`\n[W] APPLY OK: ${reparaciones.length} pedidos reparados.`);
  console.log('[W] Los pedidos quedaron en estado activo (transferidoSAP=null + closedReason=null).');
  console.log('[W] NO fueron enviados a SAP. Enviar manualmente desde la UI/panel admin.');
}

main().catch((e) => {
  console.error('[W] ERROR:', e);
  process.exit(1);
});
