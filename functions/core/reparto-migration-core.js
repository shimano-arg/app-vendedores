// @ts-check
/**
 * v1278 (2026-10-14): migracion ASIG → BO + crear ingresos_reparto para los
 * SKUs con stock libre + clientes BO. Switchover del motor FIFO automatico
 * al reparto manual (Pablo decide via modal).
 *
 * Que hace exactamente la callable:
 *
 *  1. Query todos los pedidos abiertos (closedAt == null).
 *
 *  2. Para cada linea con state='ASIG' + qtyOpen > 0:
 *     - Revertir a state='BO'.
 *     - Resetear asigAt, asigReserva, asigCliTipo, asigFromReparto (null).
 *     - Marcar: revertedFromAsigAt=now, revertedFromAsigReason='migration-v1278'.
 *     - NO tocar lineas state='confirmed' (ya en SAP, siguen flow normal).
 *     - NO tocar lineas state='cancelled|invoiced|expired|recycled|legacy'.
 *
 *  3. Para cada SKU afectado (que tuvo al menos 1 linea revertida):
 *     - Leer stock_snapshot.warehouseBreakdown[sku].11 (stock fisico disp venta).
 *     - Si > 0 AND hay clientes BO del SKU post-revert:
 *       - Crear doc en ingresos_reparto/{autoId} con:
 *         * sku, qtyIngresada = min(dep11, qtyBackorderTotal) — Pablo reparte
 *           lo que efectivamente tenemos VS lo que la demanda total.
 *         * clientesBO: lista fresca (igual que el flow normal).
 *         * status='pending'.
 *         * source='migration-v1278' (distinto a 'auto-detect' del flow normal).
 *         * dedupeKey = sku + '|migration-v1278' (para no colisionar con el flow normal).
 *
 *  4. Escribir audit log a asig_migration_log_v1278/{iso} con detalle.
 *
 * Idempotencia: si corre dos veces, el 2do pass tendria 0 ASIG para revertir
 * (todas ya son BO) → 0 docs nuevos. Dedupe keys evitan duplicados.
 *
 * Blast radius: Mariano/admin ejecuta UNA vez durante el switchover. Despues
 * el flow normal del CF `onDep11IncreaseCreateReparto` toma el relevo.
 */

const INGRESOS_REPARTO_COLLECTION = 'ingresos_reparto';
const MIGRATION_LOG_COLLECTION = 'asig_migration_log_v1278';

/**
 * @typedef {Object} MigrationDeps
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {() => Date} [now] Inyectable para tests.
 *
 * @typedef {Object} RevertedLine
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {string} sku
 * @property {number} qty
 * @property {string} clientCardCode
 *
 * @typedef {Object} MigrationResult
 * @property {number} pedidosScanned
 * @property {RevertedLine[]} revertedLines
 * @property {string[]} skusAffected
 * @property {string[]} ingresosCreated IDs de docs ingresos_reparto creados.
 * @property {Array<{sku: string, reason: string}>} ingresosSkipped
 * @property {string[]} errors
 */

/** @param {any} snap @returns {Record<string, Record<string, number>>} */
function _parseWarehouseBreakdown(snap) {
  const raw = snap && snap.warehouseBreakdown;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

/**
 * Carga el stock_snapshot actual para leer warehouseBreakdown.
 * @param {MigrationDeps} deps
 */
async function loadStockSnapshot(deps) {
  const snap = await deps.fbDb.doc('app_config/stock_snapshot').get();
  return snap.exists ? snap.data() || {} : {};
}

/**
 * Carga pedidos abiertos una sola vez.
 * @param {MigrationDeps} deps
 */
async function loadOpenPedidos(deps) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id: string, data: () => any}>} */
  const docs = [];
  snap.forEach((/** @type {any} */ d) => docs.push(d));
  return docs;
}

/**
 * Extrae clientes BO del SKU usando los pedidos post-revert (que ya tienen
 * en memoria las ASIG transformadas a BO).
 * @param {Array<any>} pedidosMutated Array {id, data: {clientName, lines, ...}}
 * @param {string} sku
 */
function extractClientesBOForSkuFromMutated(pedidosMutated, sku) {
  const skuUp = String(sku).toUpperCase();
  /** @type {Array<any>} */
  const preOut = [];
  for (const p of pedidosMutated) {
    const data = p.data;
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      if (l.state !== 'BO') continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      let createdMs = 0;
      let createdIso = null;
      if (data.createdAt) {
        if (typeof data.createdAt.toMillis === 'function') {
          createdMs = data.createdAt.toMillis();
          try {
            createdIso = data.createdAt.toDate().toISOString();
          } catch {
            createdIso = null;
          }
        } else if (typeof data.createdAt === 'string') {
          createdMs = new Date(data.createdAt).getTime() || 0;
          createdIso = data.createdAt;
        }
      }
      preOut.push({
        pedidoId: p.id,
        lineIndex: i,
        clientCardCode: String(data.clientCardCode || '').trim(),
        clientName: String(data.clientName || '').trim(),
        clientProvince: String(data.province || data.clientProvince || '').trim(),
        clientLocality: String(data.locName || data.clientLocality || '').trim(),
        pedidoCreatedAt: createdIso,
        qtyBackorder: qtyOpen,
        _createdMs: createdMs,
      });
    }
  }
  preOut.sort((a, b) => a._createdMs - b._createdMs || a.pedidoId.localeCompare(b.pedidoId));
  return preOut.map((c) => ({
    pedidoId: c.pedidoId,
    lineIndex: c.lineIndex,
    clientCardCode: c.clientCardCode,
    clientName: c.clientName,
    clientProvince: c.clientProvince,
    clientLocality: c.clientLocality,
    pedidoCreatedAt: c.pedidoCreatedAt,
    qtyBackorder: c.qtyBackorder,
  }));
}

/**
 * Core de la migracion. Transaccional por pedido. Idempotente.
 *
 * @param {MigrationDeps} deps
 * @returns {Promise<MigrationResult>}
 */
export async function migrateAsigToBOAndCreateReparto(deps) {
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();
  /** @type {RevertedLine[]} */
  const revertedLines = [];
  /** @type {Set<string>} */
  const skusAffectedSet = new Set();
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const ingresosCreated = [];
  /** @type {Array<{sku: string, reason: string}>} */
  const ingresosSkipped = [];

  const openPedidos = await loadOpenPedidos(deps);

  // Para cada pedido: una runTransaction. Mutamos state ASIG→BO y guardamos
  // snapshot del pedido mutated para despues extraer BO consolidados.
  /** @type {Array<{id: string, data: any}>} */
  const pedidosMutated = [];

  for (const doc of openPedidos) {
    const ref = deps.fbDb.collection('pedidos').doc(doc.id);
    try {
      await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        const freshSnap = await tx.get(ref);
        if (!freshSnap.exists) return;
        const freshData = freshSnap.data() || {};
        if (freshData.closedAt) return;
        const freshLines = Array.isArray(freshData.lines) ? [...freshData.lines] : [];
        let mutated = false;
        for (let i = 0; i < freshLines.length; i++) {
          const l = freshLines[i];
          if (!l) continue;
          if (l.state !== 'ASIG') continue;
          const qtyOpen = Number(l.qtyOpen) || 0;
          if (qtyOpen <= 0) continue;
          freshLines[i] = Object.assign({}, l, {
            state: 'BO',
            asigAt: null,
            asigReserva: null,
            asigCliTipo: null,
            asigFromReparto: null,
            revertedFromAsigAt: nowIso,
            revertedFromAsigReason: 'migration-v1278',
          });
          mutated = true;
          revertedLines.push({
            pedidoId: doc.id,
            lineIndex: i,
            sku: String(l.code || ''),
            qty: qtyOpen,
            clientCardCode: String(freshData.clientCardCode || ''),
          });
          if (l.code) skusAffectedSet.add(String(l.code).toUpperCase());
        }
        if (mutated) {
          tx.update(ref, { lines: freshLines, updatedAt: nowIso });
          // Guardar snapshot post-mutacion para la Fase 2 (ingresos_reparto).
          pedidosMutated.push({ id: doc.id, data: Object.assign({}, freshData, { lines: freshLines }) });
        } else {
          // Preservar pedido no mutado para que extractClientesBOForSkuFromMutated
          // pueda incluir BO pre-existentes del mismo SKU en el ingreso.
          pedidosMutated.push({ id: doc.id, data: freshData });
        }
      });
    } catch (e) {
      errors.push('revert pedido ' + doc.id + ': ' + (e && e.message ? e.message : String(e)));
    }
  }

  log('migracion revert done', {
    revertedLines: revertedLines.length,
    skusAffected: skusAffectedSet.size,
    errors: errors.length,
  });

  // Fase 2: para cada SKU afectado, crear ingresos_reparto si hay stock
  // disponible dep 11 + clientes BO.
  const stockSnap = await loadStockSnapshot(deps);
  const whs = _parseWarehouseBreakdown(stockSnap);

  for (const sku of skusAffectedSet) {
    try {
      const dep11 = Number((whs[sku] || {})['11']) || 0;
      if (dep11 <= 0) {
        ingresosSkipped.push({ sku, reason: 'dep11=0 (sin stock fisico)' });
        continue;
      }
      const clientesBO = extractClientesBOForSkuFromMutated(pedidosMutated, sku);
      if (clientesBO.length === 0) {
        ingresosSkipped.push({ sku, reason: 'sin clientes BO post-revert' });
        continue;
      }
      const qtyBackorderTotal = clientesBO.reduce((s, c) => s + (Number(c.qtyBackorder) || 0), 0);
      const qtyIngresada = Math.min(dep11, qtyBackorderTotal);
      const dedupeKey = sku + '|migration-v1278';
      // Dedupe: si ya corri la migracion y hay un pending con esta key, skip.
      try {
        const existing = await deps.fbDb
          .collection(INGRESOS_REPARTO_COLLECTION)
          .where('dedupeKey', '==', dedupeKey)
          .where('status', '==', 'pending')
          .limit(1)
          .get();
        if (!existing.empty) {
          ingresosSkipped.push({ sku, reason: 'dedupe (migracion ya ejecutada antes)' });
          continue;
        }
      } catch (_dedupeErr) {
        log('migration dedupe query failed (best effort)', { sku, err: String(_dedupeErr) });
      }
      const ref = await deps.fbDb.collection(INGRESOS_REPARTO_COLLECTION).add({
        sku,
        qtyIngresada,
        detectedAt: nowIso,
        status: 'pending',
        clientesBO,
        qtyBackorderTotal,
        clientesCount: clientesBO.length,
        appliedAt: null,
        appliedBy: null,
        assignments: null,
        dedupeKey,
        source: 'migration-v1278',
      });
      ingresosCreated.push(ref.id);
    } catch (e) {
      errors.push('crear ingreso ' + sku + ': ' + (e && e.message ? e.message : String(e)));
    }
  }

  // Audit log one-shot con detalle.
  try {
    await deps.fbDb.collection(MIGRATION_LOG_COLLECTION).add({
      executedAt: nowIso,
      pedidosScanned: openPedidos.length,
      revertedLinesCount: revertedLines.length,
      revertedLinesSample: revertedLines.slice(0, 50),
      skusAffected: Array.from(skusAffectedSet),
      ingresosCreatedCount: ingresosCreated.length,
      ingresosCreatedSample: ingresosCreated.slice(0, 50),
      ingresosSkippedCount: ingresosSkipped.length,
      ingresosSkippedSample: ingresosSkipped.slice(0, 50),
      errorsCount: errors.length,
      errors: errors.slice(0, 50),
    });
  } catch (logErr) {
    errors.push('audit migration log failed: ' + (logErr && logErr.message ? logErr.message : String(logErr)));
  }

  return {
    pedidosScanned: openPedidos.length,
    revertedLines,
    skusAffected: Array.from(skusAffectedSet),
    ingresosCreated,
    ingresosSkipped,
    errors,
  };
}
