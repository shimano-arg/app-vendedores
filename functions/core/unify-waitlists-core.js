// @ts-check
/**
 * R01 Fase 1 — unifyWaitlistsCF core.
 *
 * Unifica múltiples waitlists del mismo cardCode en una (target). Las
 * absorbidas pasan a `stage='consumed'`. El servidor construye el
 * `unifiedPayload` server-side (D12.2 Q4 — NO confía en el cliente).
 *
 * INVARIANTES (R01 Fase 1):
 *   - §42: a lo sumo UNA waitlist abierta por cardCode. El tx actualiza
 *     `revision_waitlist_locks/{cardCode}.waitlistId = targetId`.
 *     Si el lock apuntaba a un absorbido, se re-apunta al target. Si no
 *     existía, se crea.
 *   - §40.5: `asigRefs` / `origen` / `importedFromOrder` preservados.
 *     Delegado al espejo pure (§57) `mergeLinesFromOrders`.
 *   - §56: un SKU una sola vez por orden (delegado al mismo helper). El
 *     helper SUMA qty por diseño del pure; la regla "MÁS NUEVA + piso
 *     ASIG" §56 UPDATE v1457 vive en `bo_entry_logic.js` y dispara en el
 *     modal review del cliente downstream (fase 3+).
 *   - H11: shape `unifiedFrom` como array de objetos
 *     `{source, waitlistId, orderNumber, mergedAt, mergedBy, lineCount}`.
 *   - H12: filtrar por `closedAt != null` además de `stage === 'consumed'`.
 *
 * PERMISOS (D12.2 Q4):
 *   - admin/gerente/interno: siempre OK.
 *   - vendedor: solo si target Y todos los absorbidos cumplen
 *     (assignedVendorUid === auth.uid OR ownerUid === auth.uid).
 *
 * CAMPOS INMUTABLES: ownerUid, assignedVendorUid, assignedVendorEmail,
 *   ownerVendor, clientCardCode, createdAt del target.
 *
 * TRANSACCIÓN §58 (ALL reads before ALL writes):
 *   FASE READ: target, N absorbed, lock.
 *   FASE WRITE: update target (merge), mark absorbed consumed, update lock.
 *
 * @param {{ fbDb: any, now?: Function }} deps
 * @param {{ auth: any, targetWaitlistId: string, absorbedWaitlistIds: string[] }} params
 */

import { mergeLinesFromOrders } from './unificar-ordenes.js';

/**
 * @param {string} code
 * @param {string} message
 */
function mkErr(code, message) {
  const e = /** @type {any} */ (new Error(message));
  e._errorCode = code;
  return e;
}

/**
 * Dedupe pedidosOrigenes por (pedidoId, lineIndex). Patrón §40.5 / §42 v1382.
 * @param {Array<any>} origenes
 * @returns {Array<any>}
 */
function dedupePedidosOrigenes(origenes) {
  if (!Array.isArray(origenes) || origenes.length === 0) return [];
  /** @type {Map<string, any>} */
  const byKey = new Map();
  for (const o of origenes) {
    if (!o || !o.pedidoId) continue;
    const li = typeof o.lineIndex === 'number' ? o.lineIndex : -1;
    const k = o.pedidoId + '|' + li;
    if (!byKey.has(k)) byKey.set(k, o);
  }
  return Array.from(byKey.values());
}

/**
 * Finaliza items para persistir: reconstruye `qtyOpen = qty` (invariante en
 * waitlist) y strippa undefined (§70).
 * @param {Array<any>} items
 * @returns {Array<any>}
 */
function finalizeItemsForPersist(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const out = /** @type {any} */ ({});
    for (const k of Object.keys(it || {})) {
      if (it[k] !== undefined) out[k] = it[k];
    }
    out.qty = Number(it.qty) || 0;
    out.qtyOpen = out.qty;
    if (out.precio == null) out.precio = 0;
    return out;
  });
}

/**
 * @param {{ fbDb: any, now?: Function }} deps
 * @param {{ auth: any, targetWaitlistId: string, absorbedWaitlistIds: string[] }} params
 */
export async function unifyWaitlistsCore(deps, params) {
  const now = deps && typeof deps.now === 'function' ? deps.now() : Date.now();
  const nowIso = new Date(now).toISOString();
  const { auth, targetWaitlistId, absorbedWaitlistIds } = params || {};

  if (!auth || !auth.uid) throw mkErr('unauthenticated', 'login requerido');
  if (!targetWaitlistId || typeof targetWaitlistId !== 'string') {
    throw mkErr('invalid-argument', 'targetWaitlistId requerido');
  }
  if (!Array.isArray(absorbedWaitlistIds) || absorbedWaitlistIds.length === 0) {
    throw mkErr('invalid-argument', 'absorbedWaitlistIds debe ser array no-vacío');
  }
  if (absorbedWaitlistIds.includes(targetWaitlistId)) {
    throw mkErr('invalid-argument', 'target no puede estar en absorbed');
  }
  const absorbedUnique = Array.from(
    new Set(absorbedWaitlistIds.filter((/** @type {any} */ s) => typeof s === 'string' && s))
  );
  if (absorbedUnique.length === 0) {
    throw mkErr('invalid-argument', 'absorbedWaitlistIds vacío tras dedupe');
  }

  // Role lookup.
  let role = '';
  try {
    const roleSnap = await deps.fbDb.collection('roles').doc(auth.uid).get();
    role = String((roleSnap.data() || {}).role || '').toLowerCase();
  } catch (e) {
    throw mkErr(
      'internal',
      'no se pudo resolver rol: ' + ((e && /** @type {any} */ (e).message) || String(e))
    );
  }

  const userEmail = String((auth.token && auth.token.email) || '').toLowerCase();
  const isPrivileged = role === 'admin' || role === 'gerente' || role === 'interno';
  const targetRef = deps.fbDb.collection('revision_waitlist').doc(targetWaitlistId);

  // === TRANSACTION §58 ===
  const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    // ============ FASE READS ============

    // 1. Target.
    const targetSnap = await tx.get(targetRef);
    if (!targetSnap.exists) throw mkErr('not-found', 'target waitlist no existe');
    const targetData = targetSnap.data() || {};
    // H12: filtrar por closedAt + stage.
    if (targetData.stage === 'consumed' || targetData.closedAt) {
      throw mkErr(
        'failed-precondition',
        targetData.closedAt ? 'target ya está cerrado (closedAt)' : 'target ya está consumed'
      );
    }

    // 2. Absorbed.
    /** @type {Array<{ref: any, data: any, id: string}>} */
    const absorbedSnaps = [];
    for (const absId of absorbedUnique) {
      const absRef = deps.fbDb.collection('revision_waitlist').doc(absId);
      const absSnap = await tx.get(absRef);
      if (!absSnap.exists) throw mkErr('not-found', `absorbed waitlist ${absId} no existe`);
      const absData = absSnap.data() || {};
      if (absData.stage === 'consumed' || absData.closedAt) {
        throw mkErr(
          'failed-precondition',
          absData.closedAt
            ? `absorbed ${absId} ya está cerrado (closedAt)`
            : `absorbed ${absId} ya consumed`
        );
      }
      absorbedSnaps.push({ ref: absRef, data: absData, id: absId });
    }

    // 3. Validaciones.
    const targetCC = String(targetData.clientCardCode || '').trim();
    if (!targetCC) {
      throw mkErr('failed-precondition', 'target sin clientCardCode');
    }
    for (const abs of absorbedSnaps) {
      const absCC = String(abs.data.clientCardCode || '').trim();
      if (absCC !== targetCC) {
        throw mkErr(
          'failed-precondition',
          `absorbed ${abs.id} cardCode ${absCC} != target ${targetCC}`
        );
      }
    }

    // Permisos (D12.2 Q4).
    if (!isPrivileged) {
      if (role !== 'vendedor') {
        throw mkErr('permission-denied', 'rol no autorizado');
      }
      const targetAllowed =
        targetData.ownerUid === auth.uid || targetData.assignedVendorUid === auth.uid;
      if (!targetAllowed) {
        throw mkErr('permission-denied', 'VDE sin ownership en target');
      }
      for (const abs of absorbedSnaps) {
        const absAllowed =
          abs.data.ownerUid === auth.uid || abs.data.assignedVendorUid === auth.uid;
        if (!absAllowed) {
          throw mkErr('permission-denied', `VDE sin ownership en absorbed ${abs.id}`);
        }
      }
    }

    // 4. Lock.
    const lockRef = deps.fbDb.collection('revision_waitlist_locks').doc(targetCC);
    const lockSnap = await tx.get(lockRef);
    const lockData = lockSnap.exists ? lockSnap.data() || {} : null;

    // ============ FASE COMPUTE ============

    // Merge usando el helper pure (§57). base=target.items,
    // other=absorbed.items como "órdenes".
    const otherOrders = absorbedSnaps.map((abs) => ({
      orderNumber: Number(abs.data.orderNumber) || 0,
      pedidoId: undefined,
      source: abs.data.source || undefined,
      pedidosOrigenes: Array.isArray(abs.data.pedidosOrigenes)
        ? abs.data.pedidosOrigenes
        : undefined,
      lines: Array.isArray(abs.data.items) ? abs.data.items : [],
    }));
    const mergeResult = mergeLinesFromOrders(
      Array.isArray(targetData.items) ? targetData.items : [],
      otherOrders
    );
    const mergedItems = finalizeItemsForPersist(mergeResult.mergedLines);

    // pedidosOrigenes union + dedupe.
    const allOrigenes = Array.isArray(targetData.pedidosOrigenes)
      ? targetData.pedidosOrigenes.slice()
      : [];
    for (const abs of absorbedSnaps) {
      if (Array.isArray(abs.data.pedidosOrigenes)) {
        for (const o of abs.data.pedidosOrigenes) allOrigenes.push(o);
      }
    }
    const dedupedOrigenes = dedupePedidosOrigenes(allOrigenes);

    // unifiedFrom (H11 shape canónico objeto).
    /** @type {Array<any>} */
    const unifiedFromAcc = Array.isArray(targetData.unifiedFrom)
      ? targetData.unifiedFrom.slice()
      : [];
    for (const abs of absorbedSnaps) {
      unifiedFromAcc.push({
        source: 'unify_waitlists_cf',
        waitlistId: abs.id,
        orderNumber: Number(abs.data.orderNumber) || null,
        mergedAt: nowIso,
        mergedBy: userEmail || auth.uid,
        lineCount: Array.isArray(abs.data.items) ? abs.data.items.length : 0,
      });
    }

    /** @type {any} */
    const updatePayload = {
      items: mergedItems,
      pedidosOrigenes: dedupedOrigenes,
      unifiedFrom: unifiedFromAcc,
      updatedAt: nowIso,
    };
    // Hereda source='stock-asignado-batch' §42 v1404.
    if (!targetData.source) {
      for (const abs of absorbedSnaps) {
        if (abs.data.source === 'stock-asignado-batch') {
          updatePayload.source = 'stock-asignado-batch';
          break;
        }
      }
    }

    // ============ FASE WRITES ============

    tx.update(targetRef, updatePayload);
    for (const abs of absorbedSnaps) {
      tx.update(abs.ref, {
        stage: 'consumed',
        closedAt: nowIso,
        closedReason: 'unified_into_v42',
        unifiedInto: targetWaitlistId,
        unifiedIntoOrderNumber: targetData.orderNumber || null,
      });
    }

    // Lock: apuntar al target.
    /** @type {any} */
    const lockPayload = {
      cardCode: targetCC,
      waitlistId: targetWaitlistId,
      updatedAt: nowIso,
      updatedBy: auth.uid,
      lastOperation: 'unify',
      _version: 1,
    };
    if (lockData) {
      tx.update(lockRef, lockPayload);
    } else {
      tx.set(lockRef, lockPayload);
    }

    return {
      targetOrderNumber: targetData.orderNumber || null,
      absorbedCount: absorbedSnaps.length,
      absorbedIds: absorbedSnaps.map((a) => a.id),
      unifiedItemsCount: mergedItems.length,
      cardCode: targetCC,
    };
  });

  // Audit fire-and-forget.
  try {
    const logEntry = {
      type: 'waitlists_unified',
      targetWaitlistId,
      targetOrderNumber: result.targetOrderNumber,
      absorbedWaitlistIds: result.absorbedIds,
      absorbedCount: result.absorbedCount,
      unifiedItemsCount: result.unifiedItemsCount,
      cardCode: result.cardCode,
      userId: auth.uid,
      userEmail,
      role,
      via: 'unifyWaitlistsCF',
      timestamp: new Date(now),
    };
    const p = deps.fbDb.collection('operations_log').add(logEntry);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {
    /* no bloquea */
  }

  return {
    ok: true,
    targetOrderNumber: result.targetOrderNumber,
    absorbedCount: result.absorbedCount,
    absorbedIds: result.absorbedIds,
    unifiedItemsCount: result.unifiedItemsCount,
  };
}
