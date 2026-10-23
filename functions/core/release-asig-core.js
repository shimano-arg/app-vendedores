// @ts-check
/**
 * §63 (2026-10-23) — releaseAsigCore
 *
 * Endpoint único server-side para los 2 flows cross-vendor que §61 (v1440)
 * destrabó con rule abierta:
 *   action='remove_item'   → §40.7 "Quitar producto" (X en modal waitlist-card).
 *   action='rechazo_cpst'  → §40.6 "cliente_rechazo_cpst" (modal delete-choice).
 *
 * Ambos mutan `pedidos` ajenos (cancelan ASIG en pedidos origen de la reserva).
 * Pre-§61 el cliente VDE no podía hacerlos (ownerUid != auth.uid). §61 abrió
 * la rule a cualquier campo whitelisted en update → riesgo de VDE malicioso.
 * §63 cierra el parche: la mutación cross-vendor va server-side con validación
 * explícita (admin/gerente/interno OR ownerUid del waitlist OR
 * assignedVendorUid del waitlist == auth.uid, patrón §44/§46/§59).
 *
 * runTransaction respeta §58 (ALL reads before ALL writes).
 *
 * Idempotente: si una línea ya está cancelled con el mismo closedReason, skip.
 * Si cambió a otro estado (BO revertida §40.5, invoiced, confirmed), skip.
 *
 * @param {{ fbDb: any, log?: Function, now?: Function }} deps
 * @param {{ auth: any, action: 'remove_item'|'rechazo_cpst'|string, waitlistId: string, itemIndex?: number }} params
 */

import { collectAsigRefsForCancel, collectAsigRefsForItemCancel } from './cpst-cancel-refs.js';

/** Error with code — compatible con HttpsError pero sin importar firebase-functions. */
function mkErr(/** @type {string} */ code, /** @type {string} */ message) {
  const e = /** @type {any} */ (new Error(message));
  e._errorCode = code;
  return e;
}

export async function releaseAsigCore(/** @type {any} */ deps, /** @type {any} */ params) {
  const now = deps && typeof deps.now === 'function' ? deps.now() : Date.now();
  const nowIso = new Date(now).toISOString();
  const { auth, action, waitlistId, itemIndex } = params || {};

  // === INPUT VALIDATION ===
  if (!auth || !auth.uid) throw mkErr('unauthenticated', 'login requerido');
  if (action !== 'remove_item' && action !== 'rechazo_cpst') {
    throw mkErr('invalid-argument', "action debe ser 'remove_item' o 'rechazo_cpst'");
  }
  if (!waitlistId || typeof waitlistId !== 'string') {
    throw mkErr('invalid-argument', 'waitlistId requerido');
  }
  if (action === 'remove_item') {
    if (typeof itemIndex !== 'number' || itemIndex < 0 || !Number.isFinite(itemIndex)) {
      throw mkErr('invalid-argument', 'itemIndex requerido para remove_item');
    }
  }

  // === FETCH ROLE ===
  let role = '';
  try {
    const roleSnap = await deps.fbDb.collection('roles').doc(auth.uid).get();
    role = String((roleSnap.data() || {}).role || '').toLowerCase();
  } catch (e) {
    // Si no se puede leer rol → unauthenticated (nunca permission-denied).
    throw mkErr('internal', 'no se pudo resolver rol: ' + ((e && e.message) || String(e)));
  }

  // === FETCH WAITLIST (snapshot inicial fuera de la tx para pre-validar) ===
  const wRef = deps.fbDb.collection('revision_waitlist').doc(waitlistId);
  const wSnapInitial = await wRef.get();
  if (!wSnapInitial.exists) throw mkErr('not-found', 'waitlist no existe');
  const w = Object.assign({ _id: waitlistId }, wSnapInitial.data() || {});

  // === PERMISSION CHECK ===
  // admin/gerente/interno → OK siempre.
  // vendedor → ownerUid del waitlist O assignedVendorUid del waitlist (§44/§46).
  const isPrivileged = role === 'admin' || role === 'gerente' || role === 'interno';
  const isOwner = w.ownerUid === auth.uid;
  const isAssignedVendor = role === 'vendedor' && w.assignedVendorUid === auth.uid;
  if (!isPrivileged && !isOwner && !isAssignedVendor) {
    throw mkErr(
      'permission-denied',
      'solo admin, gerente, Pablo o el vendedor del cliente (ownerUid/assignedVendorUid) puede operar'
    );
  }

  // === EXTRACT REFS ===
  const items = Array.isArray(w.items) ? w.items.slice() : [];
  /** @type {Array<any>} */
  let refs;
  /** @type {Array<any> | null} */
  let itemsAfter = null;
  if (action === 'rechazo_cpst') {
    refs = collectAsigRefsForCancel(w);
  } else {
    if (/** @type {number} */ (itemIndex) >= items.length) {
      throw mkErr('invalid-argument', 'itemIndex fuera de rango');
    }
    refs = collectAsigRefsForItemCancel(w, /** @type {number} */ (itemIndex));
    itemsAfter = items.filter((/** @type {any} */ _, /** @type {number} */ i) => i !== itemIndex);
  }

  const closedReason =
    action === 'rechazo_cpst' ? 'cliente_rechazo_cpst' : 'quitado_por_vendedor_cpst';
  const userEmail = String((auth.token && auth.token.email) || '').toLowerCase();

  // === TRANSACTION (§58: ALL reads before ALL writes) ===
  const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    // --- READS ---
    const wReSnap = await tx.get(wRef);
    if (!wReSnap.exists) {
      // Caso borde: waitlist desapareció entre el pre-fetch y la tx (otro user borró).
      // Si venimos de rechazo_cpst/remove_item (último item), es equivalente al goal → OK.
      // Si venimos de remove_item parcial, es error (ya no podemos mutar items).
      if (action === 'remove_item' && itemsAfter && itemsAfter.length > 0) {
        throw mkErr('aborted', 'waitlist desaparecio mid-transaccion');
      }
      // En otros casos: idempotente, devolvemos 0.
      return { unitsCancelled: 0, linesCancelled: 0, pedidosMutated: 0, waitlistDeleted: true };
    }
    /** @type {Map<string, {ref: any, exists: boolean, data: any}>} */
    const snapshots = new Map();
    for (const r of refs) {
      if (!r || !r.pedidoId) continue;
      if (snapshots.has(r.pedidoId)) continue; // dedup pedidos
      const pRef = deps.fbDb.collection('pedidos').doc(r.pedidoId);
      const pSnap = await tx.get(pRef);
      snapshots.set(r.pedidoId, {
        ref: pRef,
        exists: pSnap.exists,
        data: pSnap.data() || null,
      });
    }

    // --- COMPUTE (no tx writes yet) ---
    let unitsCancelled = 0;
    let linesCancelled = 0;
    /** @type {Map<string, Array<any>>} */
    const refsByPedido = new Map();
    for (const r of refs) {
      if (!r || !r.pedidoId) continue;
      if (!refsByPedido.has(r.pedidoId)) refsByPedido.set(r.pedidoId, []);
      /** @type {Array<any>} */ (refsByPedido.get(r.pedidoId)).push(r);
    }
    /** @type {Array<{ref: any, newLines: Array<any>}>} */
    const pedidoWrites = [];
    for (const [pedidoId, refsForPed] of refsByPedido) {
      const snap = snapshots.get(pedidoId);
      if (!snap || !snap.exists) continue;
      const data = snap.data || {};
      /** @type {Array<any>} */
      const newLines = Array.isArray(data.lines)
        ? data.lines.map((/** @type {any} */ l) => Object.assign({}, l))
        : [];
      let changed = false;
      for (const r of refsForPed) {
        const li = Number(r.lineIndex);
        const line = newLines[li];
        if (!line) continue;
        // Idempotencia: ya cancelled con closedReason del set §40.6/§40.7 → skip.
        if (
          line.state === 'cancelled' &&
          (line.closedReason === 'cliente_rechazo_cpst' ||
            line.closedReason === 'quitado_por_vendedor_cpst')
        ) {
          continue;
        }
        // Solo cancel si ASIG vigente. Otros estados (BO revertida §40.5,
        // invoiced, confirmed) NO los tocamos.
        if (line.state !== 'ASIG') continue;
        const prevQo = Number(line.qtyOpen) || 0;
        unitsCancelled += prevQo;
        linesCancelled += 1;
        newLines[li] = Object.assign({}, line, {
          state: 'cancelled',
          qtyOpen: 0,
          qtyCancelled: (Number(line.qtyCancelled) || 0) + prevQo,
          closedReason,
          cancelledAt: nowIso,
          cancelledBy: userEmail,
          asigReserva: false,
        });
        changed = true;
      }
      if (changed) {
        pedidoWrites.push({ ref: snap.ref, newLines });
      }
    }

    // --- WRITES ---
    for (const pw of pedidoWrites) {
      tx.update(pw.ref, { lines: pw.newLines, updatedAt: nowIso });
    }
    // Waitlist mutation.
    let waitlistDeleted = false;
    if (action === 'rechazo_cpst') {
      tx.delete(wRef);
      waitlistDeleted = true;
    } else {
      if (!itemsAfter || itemsAfter.length === 0) {
        tx.delete(wRef);
        waitlistDeleted = true;
      } else {
        tx.update(wRef, { items: itemsAfter, updatedAt: nowIso });
      }
    }
    return {
      unitsCancelled,
      linesCancelled,
      pedidosMutated: pedidoWrites.length,
      waitlistDeleted,
    };
  });

  // === OPERATIONS LOG (fire-and-forget, no bloquea el return) ===
  try {
    const logEntry = {
      type:
        action === 'rechazo_cpst'
          ? 'cpst_cancel_asig_cliente_rechazo'
          : 'cpst_item_removed_release',
      cliente: w.clientName || null,
      cardCode: w.clientCardCode || null,
      orderNumber: w.orderNumber || null,
      waitlistId,
      itemIndex: action === 'remove_item' ? itemIndex : null,
      unidadesCanceladas: result.unitsCancelled,
      lineasCanceladas: result.linesCancelled,
      pedidosMutados: result.pedidosMutated,
      waitlistDeleted: result.waitlistDeleted || false,
      userId: auth.uid,
      userEmail,
      role,
      via: 'releaseAsigCF',
      timestamp: new Date(now),
    };
    const addResult = deps.fbDb.collection('operations_log').add(logEntry);
    if (addResult && typeof addResult.catch === 'function') {
      addResult.catch(() => {});
    }
  } catch (_logErr) {
    // No bloquea.
  }

  return Object.assign({ ok: true }, result);
}
