/**
 * ASIG ref healing — v1565 Incidente pedidos 2026-11-24 (Frente A).
 *
 * Problema: `revertSobreAsignadas` (§40.11) + `recorte_vendedor_cpst` (§40.7) +
 * `cliente_rechazo_cpst` (§40.6) + `quitado_por_vendedor_cpst` mutan líneas ASIG
 * de pedidos origen a `BO`/`cancelled` DESPUÉS de que un waitlist CPST ya fue
 * creado con `asigRefs` apuntando a esas líneas. Al confirmar, los 7 CHECKs de
 * `accumulateCancelAsigMutations` (`functions/core/commit-pedido-core.js:1337+`)
 * abortan con `ASIG_REF_INVALID`.
 *
 * Fix: antes de los CHECKs, `healAsigRefs` inspecciona cada ref contra el
 * snapshot actual del pedido origen y aplica curación:
 *   - Caso A `revertida_a_bo`: línea revertida a BO automáticamente → DROP ref.
 *     La unidad vuelve a la cola BO del cliente en el pedido origen; el item
 *     nuevo queda sin respaldo de reserva y se persiste como BO en el pedido
 *     derivado si el CF lo convierte, o se cuenta como pedido normal con
 *     disponibilidad real. No se duplica stock.
 *   - Caso B `split_recorte` (`cancelled` + `splitFromLineIndex`): la línea
 *     original fue split por §40.7; buscar la línea gemela viva en el mismo
 *     pedido (match por `splitFromLineIndex === ref.lineIndex` + SKU + state
 *     ASIG + qtyOpen>0). Si existe → **REPOINT** el ref (nuevo lineIndex,
 *     mismo sku, qtyAsignada = min(qtyAsignada, newLine.qtyOpen)). Si no → DROP.
 *   - Caso C `rechazo_explicito` (`cancelled` con closedReason
 *     cliente_rechazo_cpst | quitado_por_vendedor_cpst | recorte_vendedor_cpst
 *     | asig_destildada_por_admin): VDE/admin canceló explícitamente → DROP ref.
 *   - Caso D `qty_consumed` (`cancelled` + closedReason='waitlist-confirm' o
 *     qtyOpen=0): la línea fue consumida por otro pedido → DROP ref.
 *   - Caso E `qty_insufficient` (state='ASIG' pero qtyAsignada > qtyOpen):
 *     hay menos unidades disponibles que las reservadas originalmente →
 *     **CLAMP** solo con prueba del reconcile §40.11 (gemela BO). Ver v1589.
 *
 * NO toca:
 *   - CHECK A/B (lineIndex fuera de rango / línea inexistente) → son
 *     inconsistencias del payload que indican un bug cliente-side; mantener
 *     el abort para no enmascarar.
 *   - CHECK C SKU_MISMATCH (SKU del ref != SKU de la línea) → inconsistencia
 *     que puede indicar data corruption o ataque; mantener abort.
 *   - CHECK C SKU_CONFLICT_IN_DUPES (dedup detectó SKU conflict) → ídem.
 *
 * Retorna metadata para auditoría en `operations_log` type='asig_ref_healed'.
 *
 * Pure: no toca Firestore, no toca I/O. Muta `payload.lines[*].asigRefs`
 * in-place y devuelve eventos.
 *
 * @typedef {{pedidoId: string, lineIndex: number, sku: string|null, qtyAsignada: number, _conflictingSkus?: string[]}} AsigRef
 * @typedef {{exists: boolean, data: any}} OrigenSnapshot
 *
 * @param {{lines: Array<{asigRefs?: AsigRef[], [k:string]:any}>}} payload
 * @param {Map<string, OrigenSnapshot>} origenSnapshots
 * @returns {{healedCount: number, droppedRefs: number, repointedRefs: number, clampedRefs: number, events: Array<any>}}
 */
export function healAsigRefs(payload, origenSnapshots) {
  /** @type {Array<any>} */
  const events = [];
  let droppedRefs = 0;
  let repointedRefs = 0;
  let clampedRefs = 0;

  if (!payload || !Array.isArray(payload.lines)) {
    return { healedCount: 0, droppedRefs, repointedRefs, clampedRefs, events };
  }

  /** @type {Map<string, number>} */
  const budget = new Map();

  for (let liIdx = 0; liIdx < payload.lines.length; liIdx++) {
    const line = payload.lines[liIdx];
    if (!line || !Array.isArray(line.asigRefs) || line.asigRefs.length === 0) continue;

    /** @type {AsigRef[]} */
    const keptRefs = [];
    for (const ref of line.asigRefs) {
      const action = decideHealingAction(
        ref,
        origenSnapshots,
        liIdx,
        /** @type {any} */ (line),
        budget
      );
      if (action.action === 'KEEP') {
        keptRefs.push(ref);
      } else if (action.action === 'DROP') {
        droppedRefs++;
        events.push({
          action: 'dropped',
          reason: action.reason,
          pedidoOrigenId: ref.pedidoId,
          lineIndex: ref.lineIndex,
          sku: ref.sku,
          qtyAsignada: ref.qtyAsignada,
          payloadLineIdx: liIdx,
          payloadLineCode: /** @type {any} */ (line).code || null,
          details: action.details || null,
        });
      } else if (action.action === 'REPOINT') {
        repointedRefs++;
        /** @type {AsigRef} */
        const newRef = {
          ...ref,
          lineIndex: /** @type {number} */ (action.newLineIndex),
          qtyAsignada: action.clampedQty !== undefined ? action.clampedQty : ref.qtyAsignada,
        };
        keptRefs.push(newRef);
        events.push({
          action: 'repointed',
          reason: action.reason,
          pedidoOrigenId: ref.pedidoId,
          lineIndex: ref.lineIndex,
          newLineIndex: action.newLineIndex,
          sku: ref.sku,
          qtyAsignada: ref.qtyAsignada,
          clampedQty: action.clampedQty !== undefined ? action.clampedQty : ref.qtyAsignada,
          payloadLineIdx: liIdx,
          payloadLineCode: /** @type {any} */ (line).code || null,
        });
      } else if (action.action === 'CLAMP') {
        clampedRefs++;
        /** @type {AsigRef} */
        const newRef = { ...ref, qtyAsignada: /** @type {number} */ (action.clampedQty) };
        keptRefs.push(newRef);
        events.push({
          action: 'clamped',
          reason: action.reason,
          pedidoOrigenId: ref.pedidoId,
          lineIndex: ref.lineIndex,
          sku: ref.sku,
          originalQty: ref.qtyAsignada,
          clampedQty: action.clampedQty,
          payloadLineIdx: liIdx,
          payloadLineCode: /** @type {any} */ (line).code || null,
        });
      }
    }
    line.asigRefs = keptRefs;
  }

  const healedCount = droppedRefs + repointedRefs + clampedRefs;
  return { healedCount, droppedRefs, repointedRefs, clampedRefs, events };
}

/**
 * Decide el healing action para un ref individual contra el snapshot origen.
 *
 * @param {AsigRef} ref
 * @param {Map<string, OrigenSnapshot>} origenSnapshots
 * @param {number} _payloadLineIdx
 * @param {{code?: string}} _payloadLine
 * @param {Map<string, number>} [budget] saldo de qtyOpen por `pedidoId#lineIndex`
 * @returns {{action: 'KEEP'|'DROP'|'REPOINT'|'CLAMP', reason?: string, newLineIndex?: number, clampedQty?: number, details?: any}}
 */
function decideHealingAction(ref, origenSnapshots, _payloadLineIdx, _payloadLine, budget) {
  if (!ref || !ref.pedidoId) {
    return { action: 'KEEP' };
  }
  const snap = origenSnapshots.get(ref.pedidoId);
  // Sin snapshot (pedido origen no fetcheado) o snapshot sin exists → KEEP;
  // el CHECK PEDIDO_ORIGEN_NOT_FOUND se dispara downstream legítimamente.
  if (!snap || !snap.exists || !snap.data) {
    return { action: 'KEEP' };
  }
  const data = snap.data;
  const lines = Array.isArray(data.lines) ? data.lines : null;
  if (!lines) {
    return { action: 'KEEP' };
  }
  const li = Number(ref.lineIndex);
  // CHECK A: lineIndex fuera de rango → mantener (abort downstream).
  if (!Number.isInteger(li) || li < 0 || li >= lines.length) {
    return { action: 'KEEP' };
  }
  const originalLine = lines[li];
  // CHECK B: línea inexistente → mantener (abort downstream).
  if (!originalLine) {
    return { action: 'KEEP' };
  }

  // Normalizar SKU para comparar con la línea origen (protege contra healing
  // incorrecto cuando ref.sku difiere del line.code — eso debe seguir
  // disparando CHECK C SKU_MISMATCH para no enmascarar un bug real).
  const refSku =
    ref.sku === null || ref.sku === undefined ? null : String(ref.sku).toUpperCase().trim();
  const actualSku = String(originalLine.code || '')
    .toUpperCase()
    .trim();
  if (refSku && refSku !== actualSku) {
    // SKU no matchea → KEEP para que CHECK C dispare (abort).
    // No es un escenario de "stale ref sanable"; es inconsistencia del payload.
    return { action: 'KEEP' };
  }

  const state = String(originalLine.state || '');
  const qtyOpen = Number(originalLine.qtyOpen) || 0;
  const asigRevertidaReason = originalLine.asigRevertidaReason
    ? String(originalLine.asigRevertidaReason)
    : '';
  const closedReason = originalLine.closedReason ? String(originalLine.closedReason) : '';

  // --- CASO A: línea revertida por reconcile automático a BO ---
  // (§40.11 revertSobreAsignadas + §40.10 asig_destildada_por_admin)
  if (
    state === 'BO' &&
    (asigRevertidaReason === 'asig_sin_stock_revertida_a_bo' ||
      asigRevertidaReason === 'asig_destildada_por_admin')
  ) {
    return {
      action: 'DROP',
      reason: 'revertida_a_bo',
      details: { asigRevertidaReason, asigRevertidaAt: originalLine.asigRevertidaAt || null },
    };
  }

  // --- CASO C: línea cancelled por rechazo explícito VDE/admin ---
  if (
    state === 'cancelled' &&
    (closedReason === 'cliente_rechazo_cpst' ||
      closedReason === 'quitado_por_vendedor_cpst' ||
      closedReason === 'recorte_vendedor_cpst')
  ) {
    return {
      action: 'DROP',
      reason: 'rechazo_explicito',
      details: { closedReason, cancelledAt: originalLine.cancelledAt || null },
    };
  }

  // --- CASO D: línea cancelled por consumo en otro pedido ---
  if (state === 'cancelled' && closedReason === 'waitlist-confirm') {
    return {
      action: 'DROP',
      reason: 'consumida_otro_pedido',
      details: {
        closedReason,
        cancelledIntoPedidoId: originalLine.cancelledIntoPedidoId || null,
      },
    };
  }

  // --- CASO B: línea cancelled con splitFromLineIndex, buscar gemela ---
  if (state === 'cancelled' && typeof originalLine.splitFromLineIndex === 'number') {
    // Buscar línea viva (ASIG + qtyOpen > 0) con splitFromLineIndex === li
    // en el mismo pedido + mismo SKU.
    const replacementIdx = findSplitTwin(lines, li, actualSku);
    if (replacementIdx !== -1) {
      const replacement = lines[replacementIdx];
      const replacementQtyOpen = Number(replacement.qtyOpen) || 0;
      const originalQty = Number(ref.qtyAsignada) || 0;
      const clamped = Math.min(originalQty, replacementQtyOpen);
      if (clamped > 0) {
        return {
          action: 'REPOINT',
          reason: 'split_twin',
          newLineIndex: replacementIdx,
          clampedQty: clamped !== originalQty ? clamped : undefined,
        };
      }
    }
    // Sin gemela viva → DROP.
    return {
      action: 'DROP',
      reason: 'split_sin_gemela_viva',
      details: {
        originalLineIndex: li,
        splitFromLineIndex: originalLine.splitFromLineIndex,
      },
    };
  }

  // --- CASO E: qtyOpen agotado sin motivo claro (zombie §104) ---
  if (state === 'ASIG' && qtyOpen <= 0) {
    return {
      action: 'DROP',
      reason: 'zombie_qtyopen_cero',
      details: { qtyOpen: originalLine.qtyOpen || 0 },
    };
  }

  // --- CASO E': qtyAsignada > qtyOpen (CHECK F QTY_INSUFFICIENT) ---
  // v1589 (2026-11-26, incidente PESCAR.INFO ORDEN 890): se recorta SOLO si
  // hay prueba de que la reducción la hizo el reconcile automático (§40.11):
  // una línea del mismo pedido con splitFromLineIndex === li, mismo SKU y
  // asigRevertidaReason='asig_sin_stock_revertida_a_bo'. En ese caso las
  // unidades faltantes ya volvieron a la cola BO del pedido origen, así que
  // recortar la ref no pierde nada. Sin esa prueba se mantiene el abort
  // (sobre-asignación inexplicada = posible bug real, no se enmascara).
  // `budget` reparte qtyOpen entre varias refs a la misma línea (el dedup de
  // accumulateCancelAsigMutations SUMA refs duplicadas antes del CHECK F).
  // Cada recorte queda en operations_log type='asig_ref_healed'.
  if (state === 'ASIG' && qtyOpen > 0) {
    const qtyRef = Number(ref.qtyAsignada) || 0;
    const budgetKey = String(ref.pedidoId) + '#' + li;
    const disponible = budget && budget.has(budgetKey) ? budget.get(budgetKey) : qtyOpen;
    if (qtyRef <= disponible) {
      if (budget) budget.set(budgetKey, disponible - qtyRef);
      return { action: 'KEEP' };
    }
    if (!hasReconcileReduction(lines, li, actualSku)) {
      return { action: 'KEEP' };
    }
    if (budget) budget.set(budgetKey, 0);
    if (disponible <= 0) {
      return {
        action: 'DROP',
        reason: 'reducida_por_reconcile_sin_saldo',
        details: { qtyOpen, qtyAsignada: qtyRef },
      };
    }
    return {
      action: 'CLAMP',
      reason: 'reducida_por_reconcile',
      clampedQty: disponible,
    };
  }

  // --- Línea cancelled por razón NO conocida ---
  // Mantener KEEP para que CHECK D2 dispare y Mariano pueda investigar.
  if (state === 'cancelled') {
    return { action: 'KEEP' };
  }

  // --- Línea en otro estado (ej. invoiced, confirmed) ---
  // Mantener KEEP para que CHECK D2 dispare.
  return { action: 'KEEP' };
}

/**
 * Busca una línea "gemela" producto del split de `originalLineIndex`.
 * Match: state='ASIG' + qtyOpen>0 + splitFromLineIndex===originalLineIndex +
 * mismo SKU normalizado.
 *
 * @param {any[]} lines
 * @param {number} originalLineIndex
 * @param {string} skuNormalized
 * @returns {number} índice de la gemela o -1 si no hay.
 */
function findSplitTwin(lines, originalLineIndex, skuNormalized) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (l.state !== 'ASIG') continue;
    if ((Number(l.qtyOpen) || 0) <= 0) continue;
    if (l.splitFromLineIndex !== originalLineIndex) continue;
    const code = String(l.code || '')
      .toUpperCase()
      .trim();
    if (code !== skuNormalized) continue;
    return i;
  }
  return -1;
}

/**
 * v1589: ¿la línea `lineIndex` fue reducida por el reconcile automático §40.11?
 * Prueba: existe otra línea del mismo pedido con splitFromLineIndex === lineIndex,
 * mismo SKU, asigRevertidaReason='asig_sin_stock_revertida_a_bo' y state='BO'
 * (si Pablo ya la repartió como ASIG, recortar duplicaría la reserva: no se toca).
 *
 * @param {any[]} lines
 * @param {number} lineIndex
 * @param {string} skuNormalized
 * @returns {boolean}
 */
function hasReconcileReduction(lines, lineIndex, skuNormalized) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || i === lineIndex) continue;
    if (l.splitFromLineIndex !== lineIndex) continue;
    if (l.state !== 'BO') continue;
    if (l.asigRevertidaReason !== 'asig_sin_stock_revertida_a_bo') continue;
    const code = String(l.code || '')
      .toUpperCase()
      .trim();
    if (code !== skuNormalized) continue;
    return true;
  }
  return false;
}
