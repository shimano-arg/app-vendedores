// @ts-check
/**
 * E2 §stock-servidor-atomico (2026-10-23) — commitPedidoCore.
 *
 * Decisión server-side atómica de "hay stock". Reemplaza las escrituras
 * directas desde el cliente (23 call-sites de categoría A, docs/auditoria/50_*)
 * que hoy toman la decisión con un breakdown stale local y escriben a `pedidos`
 * sin re-chequear.
 *
 * CONTRATO (ver design doc §Sección NUEVA — Contrato):
 *
 * Payload:
 *   {
 *     draftId: string              único; mismo draftId = idempotente.
 *     cardCode: string             cliente SAP CardCode.
 *     origen: 'manual' | 'excel' | 'cpst' | 'auto'
 *     lines: [{sku, cantidad, origenLinea?, asigRefs?, precio?, notas?}]
 *     clientVersion: string        'v1430' bundle version.
 *     expectedBreakdownHash?: string  hash SHA-1 del breakdown que mostraba cliente.
 *     autoAcceptStockChange?: boolean  si true, pre-acepta diff automáticamente.
 *     formaEntrega?, condicionPago?, observaciones?
 *   }
 *
 * Response OK:
 *   {
 *     ok: true,
 *     pedidoId: string,
 *     lines: [{sku, qtyConfirmed, qtyBO, reason}],
 *     diffVsClient: null | {skuChanged: [...], message: string},
 *     servidorNowMs: number,
 *     commitAtIso: string,
 *   }
 *
 * Response ERROR (ok:false):
 *   errorCode: 'VERSION_OLD' | 'CLIENT_HAS_OPEN_WAITLIST' | 'STOCK_CHANGED'
 *              | 'SNAPSHOT_TOO_OLD' | 'CONTENTION_RETRY_EXHAUSTED'
 *              | 'VALIDATION_ERROR' | 'PERMISSION_DENIED'
 *
 * GARANTÍAS:
 * - Idempotencia por draftId.
 * - Atomicidad: runTransaction. "Todo o nada". Rollback en error.
 * - Isolation: Firestore reintenta hasta 5× ante conflicto.
 * - Nunca deja pedido a medias.
 *
 * @typedef {Object} CommitPedidoDeps
 * @property {any} fbDb Firestore instance (admin SDK)
 * @property {() => Promise<string | null>} [getUserRole]
 * @property {() => Date} [now]
 * @property {(msg: string, data?: any) => void} [log]
 * @property {(err: Error, context?: any) => void} [reportError]
 * @property {any} [FieldValue] admin.firestore.FieldValue
 */

import { getStockBreakdown, lineReservesStock } from './pedido-snapshot-core.js';

const SNAPSHOT_MAX_AGE_MS = 45 * 60 * 1000; // 45 min
const MAX_RETRY_ATTEMPTS = 5;
const VALID_ORIGENS = new Set(['manual', 'excel', 'cpst', 'auto', 'reparto']);

/**
 * @param {CommitPedidoDeps} deps
 * @param {any} payload
 * @returns {Promise<any>}
 */
export async function commitPedidoCore(deps, payload) {
  const log = deps.log || (() => {});
  const now = (deps.now ? deps.now() : new Date()).getTime();
  const nowIso = new Date(now).toISOString();

  // 1. Validación básica payload.
  const validation = validatePayload(payload);
  if (!validation.ok) {
    return makeError('VALIDATION_ERROR', validation.message || '', validation.data);
  }

  // 2. Chequeo min_app_version.
  try {
    const vmSnap = await deps.fbDb.collection('app_config').doc('version_minima').get();
    if (vmSnap.exists) {
      const vmData = vmSnap.data() || {};
      const minVersion = vmData.minVersion;
      if (minVersion && isVersionLessThan(payload.clientVersion, minVersion)) {
        return makeError('VERSION_OLD', 'Actualizá la app para continuar', {
          minVersion,
          currentVersion: payload.clientVersion,
        });
      }
    }
  } catch (e) {
    // Si no existe el doc o Firestore falla, no bloqueamos (shadow 24h).
    log('commitPedidoCore version_minima check fail (non-blocking)', {
      err: (e && e.message) || String(e),
    });
  }

  // 3. Idempotencia por draftId.
  const existingPedido = await findExistingByDraftId(deps, payload.draftId);
  if (existingPedido) {
    log('commitPedidoCore idempotente hit', {
      draftId: payload.draftId,
      pedidoId: existingPedido.id,
    });
    return {
      ok: true,
      pedidoId: existingPedido.id,
      lines: deriveLinesFromExisting(existingPedido.data),
      diffVsClient: null,
      servidorNowMs: now,
      commitAtIso: nowIso,
      idempotentHit: true,
    };
  }

  // 4. CLIENT_HAS_OPEN_WAITLIST check (§42).
  // Para origen != 'cpst' validamos que el cliente no tenga waitlist abierto.
  if (payload.origen !== 'cpst') {
    const existingWaitlist = await findOpenWaitlistForClient(deps, payload.cardCode);
    if (existingWaitlist) {
      return makeError(
        'CLIENT_HAS_OPEN_WAITLIST',
        'El cliente ya tiene una orden abierta en lista de espera',
        {
          waitlistId: existingWaitlist.id,
          orderNumber: existingWaitlist.data.orderNumber || null,
          items: Array.isArray(existingWaitlist.data.items)
            ? existingWaitlist.data.items.length
            : 0,
        }
      );
    }
  }

  // 5. runTransaction atómica.
  let attempts = 0;
  let lastError = null;
  while (attempts < MAX_RETRY_ATTEMPTS) {
    attempts++;
    try {
      const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        return commitInTransaction(deps, tx, payload, now, nowIso);
      });
      log('commitPedidoCore OK', { draftId: payload.draftId, attempts, pedidoId: result.pedidoId });
      return { ...result, servidorNowMs: now, commitAtIso: nowIso };
    } catch (e) {
      const err = /** @type {any} */ (e);
      lastError = err;
      if (err && err._errorCode) {
        // Es un error de negocio (lanzado por commitInTransaction). NO reintentar.
        return makeError(err._errorCode, err.message, err._data);
      }
      // Otros errores: podría ser retry de Firestore (ya reintenta ~5×
      // automático). Si llegó acá es raro.
      log('commitPedidoCore retry', { draftId: payload.draftId, attempts, err: err.message });
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50 * attempts)); // backoff
    }
  }

  return makeError('CONTENTION_RETRY_EXHAUSTED', 'Reintenta en 10 segundos', {
    attempts,
    lastError: lastError && lastError.message,
  });
}

/**
 * Lógica dentro de runTransaction. Throws errores de negocio con _errorCode.
 * @param {any} deps
 * @param {any} tx
 * @param {any} payload
 * @param {number} now
 * @param {string} nowIso
 */
async function commitInTransaction(deps, tx, payload, now, nowIso) {
  // 5.1 Lee stock_snapshot/{SKU} para cada SKU del payload.
  const skuSet = new Set();
  for (const l of payload.lines) {
    if (l && l.sku) skuSet.add(String(l.sku).toUpperCase());
  }
  /** @type {Map<string, any>} */
  const perSkuData = new Map();
  for (const sku of skuSet) {
    const docRef = deps.fbDb.collection('stock_snapshot').doc(sku);
    const snap = await tx.get(docRef);
    perSkuData.set(sku, snap.exists ? snap.data() : null);
  }

  // 5.2 Lee app_config/stock_snapshot (fisicoDep11 + updatedAt global).
  const stockConfigRef = deps.fbDb.collection('app_config').doc('stock_snapshot');
  const stockConfigSnap = await tx.get(stockConfigRef);
  const stockConfig = stockConfigSnap.exists ? stockConfigSnap.data() || {} : {};
  const warehouseBreakdown =
    stockConfig.warehouseBreakdown && typeof stockConfig.warehouseBreakdown === 'object'
      ? stockConfig.warehouseBreakdown
      : {};

  // 5.3 Snapshot age check.
  const updatedAt = stockConfig.updatedAt || null;
  if (updatedAt) {
    const updatedAtMs = typeof updatedAt.toMillis === 'function' ? updatedAt.toMillis() : null;
    if (updatedAtMs !== null) {
      const age = now - updatedAtMs;
      if (age > SNAPSHOT_MAX_AGE_MS) {
        throwError('SNAPSHOT_TOO_OLD', 'El snapshot de stock tiene más de 45 minutos', {
          snapshotAgeMs: age,
          canRefresh: true,
        });
      }
    }
  }

  // 5.4 Lee pedidos abiertos para computar breakdown live (para los SKUs del payload).
  // En E2 Fase 1 leemos TODOS los pedidos abiertos (como hace el trigger existente).
  // En Fase 2 se puede optimizar con query por SKU + index.
  const pedidosSnap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {any[]} */
  const pedidos = [];
  pedidosSnap.forEach((/** @type {any} */ d) => {
    pedidos.push({ _fsId: d.id, ...d.data() });
  });

  // 5.5 Lee ingresos_reparto activos (per SKU, para pendienteReparto).
  const repartoActiveSnap = await deps.fbDb
    .collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();
  /** @type {any[]} */
  const repartosActivos = [];
  repartoActiveSnap.forEach((/** @type {any} */ d) =>
    repartosActivos.push({ _fsId: d.id, ...d.data() })
  );

  // 5.6 Compute breakdown por SKU + decide por línea.
  /** @type {Array<any>} */
  const lineasResultado = [];
  /** @type {Array<any>} */
  const docLines = [];
  for (const payloadLine of payload.lines) {
    const sku = String(payloadLine.sku || '').toUpperCase();
    const cantidad = Number(payloadLine.cantidad) || 0;
    if (!sku || cantidad <= 0) continue;

    const fisicoDep11 = Number(warehouseBreakdown[sku]?.['11'] || 0);
    const transitoDep12 = Number(warehouseBreakdown[sku]?.['12'] || 0);

    const breakdown = getStockBreakdown(
      sku,
      {
        getStockFisico: () => fisicoDep11,
        getStockTransito: () => transitoDep12,
        pedidos,
        ingresosRepartoActivos: repartosActivos,
      },
      { now }
    );

    // CLAUDE.md §33 + §35: fórmula POR LÍNEA.
    // - origenLinea='stock-asignado' con asigRefs populated → utilizablePara
    //   (incluye reservas propias que serán canceladas por el bloque CPST).
    // - cualquier otra línea → libre global (no suma reservas propias; una
    //   nueva línea manual no cancela ASIG propia existente).
    const esStockAsignado =
      payloadLine.origenLinea === 'stock-asignado' &&
      Array.isArray(payloadLine.asigRefs) &&
      payloadLine.asigRefs.length > 0;
    const utilizable = esStockAsignado
      ? breakdown.utilizablePara(payload.cardCode)
      : breakdown.libre;
    const qtyConfirmed = Math.min(cantidad, utilizable);
    const qtyBO = cantidad - qtyConfirmed;

    let reason = 'ok';
    if (qtyBO > 0 && qtyConfirmed === 0) reason = 'stock_no_disponible';
    else if (qtyBO > 0) reason = 'stock_parcial';

    lineasResultado.push({
      sku,
      qtyConfirmed,
      qtyBO,
      reason,
      libre: breakdown.libre,
      utilizablePara: utilizable,
    });

    if (qtyConfirmed > 0) {
      docLines.push({
        code: sku,
        qty: qtyConfirmed,
        qtyOpen: qtyConfirmed,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'confirmed',
        precio: Number(payloadLine.precio) || 0,
        notas: payloadLine.notas || '',
        origen: payloadLine.origenLinea || undefined,
        asigRefs: Array.isArray(payloadLine.asigRefs) ? payloadLine.asigRefs : undefined,
      });
    }
    if (qtyBO > 0) {
      docLines.push({
        code: sku,
        qty: qtyBO,
        qtyOpen: qtyBO,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'BO',
        precio: Number(payloadLine.precio) || 0,
        notas: payloadLine.notas || '',
      });
    }
  }

  // 5.7 Compute diffVsClient.
  const diffVsClient = computeDiffVsClient(lineasResultado, payload);
  if (diffVsClient && !payload.autoAcceptStockChange) {
    throwError('STOCK_CHANGED', 'El stock cambió entre que viste la pantalla y confirmaste', {
      diff: diffVsClient.skuChanged,
      message: diffVsClient.message,
    });
  }

  // 5.8 Escribir pedido nuevo.
  const pedidoRef = deps.fbDb.collection('pedidos').doc();
  const pedidoData = buildPedidoDocData(payload, docLines, nowIso, deps);
  tx.set(pedidoRef, pedidoData);

  // 5.9 Cancelar ASIG originales si origen='cpst'.
  if (payload.origen === 'cpst') {
    await cancelAsigRefsInTransaction(deps, tx, payload, pedidoRef.id, nowIso);
  }

  return {
    ok: true,
    pedidoId: pedidoRef.id,
    lines: lineasResultado,
    diffVsClient,
    attempts: 1,
  };
}

/**
 * Cancela las ASIG originales referenciadas en el payload (origen='cpst').
 * @param {any} deps
 * @param {any} tx
 * @param {any} payload
 * @param {string} newPedidoId
 * @param {string} nowIso
 */
async function cancelAsigRefsInTransaction(deps, tx, payload, newPedidoId, nowIso) {
  /** @type {Map<string, Array<any>>} */
  const refsByPedido = new Map();
  for (const l of payload.lines) {
    if (!Array.isArray(l.asigRefs)) continue;
    for (const r of l.asigRefs) {
      if (!r || !r.pedidoId) continue;
      if (!refsByPedido.has(r.pedidoId)) refsByPedido.set(r.pedidoId, []);
      const arr = /** @type {any[]} */ (refsByPedido.get(r.pedidoId));
      if (arr) arr.push(r);
    }
  }
  for (const [pedidoOrigenId, refs] of refsByPedido) {
    const refDoc = deps.fbDb.collection('pedidos').doc(pedidoOrigenId);
    const snap = await tx.get(refDoc);
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const newLines = Array.isArray(data.lines)
      ? data.lines.map((/** @type {any} */ l) => ({ ...l }))
      : [];
    for (const r of refs) {
      const li = Number(r.lineIndex);
      if (!newLines[li]) continue;
      newLines[li] = {
        ...newLines[li],
        state: 'cancelled',
        qtyOpen: 0,
        qtyCancelled: (Number(newLines[li].qtyCancelled) || 0) + (Number(newLines[li].qty) || 0),
        closedReason: 'waitlist-confirm',
        cancelledAt: nowIso,
        cancelledIntoPedidoId: newPedidoId,
        asigReserva: false,
      };
    }
    tx.update(refDoc, { lines: newLines, updatedAt: nowIso });
  }
}

/**
 * Build pedido doc data.
 */
/** @param {any} payload @param {any[]} docLines @param {string} nowIso @param {any} deps */
function buildPedidoDocData(payload, docLines, nowIso, deps) {
  const FieldValue = deps.FieldValue || null;
  const base = {
    _draftId: payload.draftId,
    _commitVersion: 'commitPedidoCore_v1',
    clientCardCode: payload.cardCode,
    clientName: payload.clientName || '',
    origen: payload.origen,
    source: payload.origen === 'cpst' ? 'stock-asignado-batch' : payload.source || '',
    lines: docLines,
    stage: 'confirmed',
    confirmedAt: FieldValue ? FieldValue.serverTimestamp() : nowIso,
    createdAt: FieldValue ? FieldValue.serverTimestamp() : nowIso,
    closedAt: null,
    closedReason: null,
    schemaVersion: 2,
    sapLinkage: { soDocEntry: null, lastInvoiceDocEntry: null, lastSyncAt: null },
    transferidoSAP: null,
    sendingSapLock: null,
    formaEntrega: payload.formaEntrega || null,
    condicionPago: payload.condicionPago || '',
    observaciones: payload.observaciones || '',
    netAmountArs: computeNetAmount(docLines),
    subtotalArs: computeNetAmount(docLines),
    discountPct: 0,
    ownerUid: payload.ownerUid || null,
    ownerEmail: payload.ownerEmail || null,
    ownerVendor: payload.ownerVendor || null,
    cargadoPorUid: payload.ownerUid || null,
    cargadoPorEmail: payload.ownerEmail || null,
  };
  return base;
}

/** @param {any[]} lines */
function computeNetAmount(lines) {
  let s = 0;
  for (const l of lines) {
    if (!l || l.state !== 'confirmed') continue;
    s += (Number(l.qty) || 0) * (Number(l.precio) || 0);
  }
  return s;
}

/** @param {any[]} lineasResultado @param {any} payload */
function computeDiffVsClient(lineasResultado, payload) {
  // Simple: si alguna línea tiene qtyBO > 0 vs lo que cliente mostraba.
  // Para E2 Fase 1 solo marcamos si hubo back order inesperado.
  const changed = [];
  for (const l of lineasResultado) {
    const original = payload.lines.find(
      (/** @type {any} */ p) => String(p.sku).toUpperCase() === l.sku
    );
    if (!original) continue;
    if (l.qtyBO > 0) {
      changed.push({
        sku: l.sku,
        pediste: Number(original.cantidad) || 0,
        podesLlevar: l.qtyConfirmed,
        aBackOrder: l.qtyBO,
      });
    }
  }
  if (changed.length === 0) return null;
  const totalBO = changed.reduce((a, b) => a + b.aBackOrder, 0);
  return {
    skuChanged: changed,
    message: `${totalBO} unidad(es) pasaron a back order porque otro pedido las tomó antes`,
  };
}

/** @param {any} payload */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'payload vacío', data: null };
  }
  if (!payload.draftId || typeof payload.draftId !== 'string') {
    return { ok: false, message: 'draftId requerido', data: { field: 'draftId' } };
  }
  if (!payload.cardCode || typeof payload.cardCode !== 'string') {
    return { ok: false, message: 'cardCode requerido', data: { field: 'cardCode' } };
  }
  if (!VALID_ORIGENS.has(payload.origen)) {
    return {
      ok: false,
      message: 'origen inválido',
      data: { field: 'origen', value: payload.origen },
    };
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    return { ok: false, message: 'lines requerido no-vacío', data: { field: 'lines' } };
  }
  for (const l of payload.lines) {
    if (!l || !l.sku) return { ok: false, message: 'line.sku requerido', data: { line: l } };
    if (!Number.isFinite(Number(l.cantidad)) || Number(l.cantidad) <= 0) {
      return { ok: false, message: 'line.cantidad > 0 requerido', data: { line: l } };
    }
  }
  if (!payload.clientVersion || typeof payload.clientVersion !== 'string') {
    return { ok: false, message: 'clientVersion requerido', data: { field: 'clientVersion' } };
  }
  return { ok: true };
}

/** @param {string} a @param {string} b */
function isVersionLessThan(a, b) {
  // Simplicfied: 'v1430' < 'v1500'. Spliteá por 'v' + number compare.
  const na = Number(String(a).replace(/^v/, '')) || 0;
  const nb = Number(String(b).replace(/^v/, '')) || 0;
  return na < nb;
}

/** @param {any} deps @param {string} draftId */
async function findExistingByDraftId(deps, draftId) {
  if (!draftId) return null;
  const q = await deps.fbDb.collection('pedidos').where('_draftId', '==', draftId).limit(1).get();
  if (q.empty) return null;
  const doc = q.docs[0];
  return { id: doc.id, data: doc.data() };
}

/** @param {any} pedidoData */
function deriveLinesFromExisting(pedidoData) {
  const result = [];
  const linesByCode = new Map();
  for (const l of pedidoData.lines || []) {
    if (!l || !l.code) continue;
    const code = String(l.code).toUpperCase();
    if (!linesByCode.has(code)) linesByCode.set(code, { qtyConfirmed: 0, qtyBO: 0 });
    const entry = linesByCode.get(code);
    const qty = Number(l.qty) || 0;
    if (l.state === 'confirmed' || l.state === 'ASIG') entry.qtyConfirmed += qty;
    else if (l.state === 'BO') entry.qtyBO += qty;
  }
  for (const [sku, entry] of linesByCode) {
    result.push({
      sku,
      qtyConfirmed: entry.qtyConfirmed,
      qtyBO: entry.qtyBO,
      reason: 'idempotent',
    });
  }
  return result;
}

/** @param {any} deps @param {string} cardCode */
async function findOpenWaitlistForClient(deps, cardCode) {
  if (!cardCode) return null;
  const q = await deps.fbDb
    .collection('revision_waitlist')
    .where('clientCardCode', '==', cardCode)
    .get();
  if (q.empty) return null;
  for (const doc of q.docs) {
    const data = doc.data();
    if (data.closedAt) continue;
    if (data.stage === 'consumed') continue;
    return { id: doc.id, data };
  }
  return null;
}

/** @param {string} code @param {string} message @param {any} [data] */
function throwError(code, message, data) {
  const e = new Error(message);
  /** @type {any} */ (e)._errorCode = code;
  /** @type {any} */ (e)._data = data || {};
  throw e;
}

/** @param {string} code @param {string} message @param {any} [data] */
function makeError(code, message, data) {
  return { ok: false, errorCode: code, message, data: data || {} };
}
