/**
 * ASIG ref healing — v1565 Incidente pedidos 2026-11-24 (Frente A).
 * MIRROR verbatim de `src/pure/asig-ref-healing.js` (§57).
 *
 * El test `tests/unit/audit/asig-ref-healing-sync.test.js` falla si estos dos
 * archivos divergen (hash + diff byte-for-byte del cuerpo de las funciones).
 */

/**
 * @typedef {{pedidoId: string, lineIndex: number, sku: string|null, qtyAsignada: number, _conflictingSkus?: string[]}} AsigRef
 * @typedef {{exists: boolean, data: any}} OrigenSnapshot
 */

/**
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

  for (let liIdx = 0; liIdx < payload.lines.length; liIdx++) {
    const line = payload.lines[liIdx];
    if (!line || !Array.isArray(line.asigRefs) || line.asigRefs.length === 0) continue;

    /** @type {AsigRef[]} */
    const keptRefs = [];
    for (const ref of line.asigRefs) {
      const action = decideHealingAction(ref, origenSnapshots, liIdx, /** @type {any} */ (line));
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
 * @param {AsigRef} ref
 * @param {Map<string, OrigenSnapshot>} origenSnapshots
 * @param {number} _payloadLineIdx
 * @param {{code?: string}} _payloadLine
 * @returns {{action: 'KEEP'|'DROP'|'REPOINT'|'CLAMP', reason?: string, newLineIndex?: number, clampedQty?: number, details?: any}}
 */
function decideHealingAction(ref, origenSnapshots, _payloadLineIdx, _payloadLine) {
  if (!ref || !ref.pedidoId) {
    return { action: 'KEEP' };
  }
  const snap = origenSnapshots.get(ref.pedidoId);
  if (!snap || !snap.exists || !snap.data) {
    return { action: 'KEEP' };
  }
  const data = snap.data;
  const lines = Array.isArray(data.lines) ? data.lines : null;
  if (!lines) {
    return { action: 'KEEP' };
  }
  const li = Number(ref.lineIndex);
  if (!Number.isInteger(li) || li < 0 || li >= lines.length) {
    return { action: 'KEEP' };
  }
  const originalLine = lines[li];
  if (!originalLine) {
    return { action: 'KEEP' };
  }

  const refSku =
    ref.sku === null || ref.sku === undefined ? null : String(ref.sku).toUpperCase().trim();
  const actualSku = String(originalLine.code || '')
    .toUpperCase()
    .trim();
  if (refSku && refSku !== actualSku) {
    return { action: 'KEEP' };
  }

  const state = String(originalLine.state || '');
  const qtyOpen = Number(originalLine.qtyOpen) || 0;
  const asigRevertidaReason = originalLine.asigRevertidaReason
    ? String(originalLine.asigRevertidaReason)
    : '';
  const closedReason = originalLine.closedReason ? String(originalLine.closedReason) : '';

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

  if (state === 'cancelled' && typeof originalLine.splitFromLineIndex === 'number') {
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
    return {
      action: 'DROP',
      reason: 'split_sin_gemela_viva',
      details: {
        originalLineIndex: li,
        splitFromLineIndex: originalLine.splitFromLineIndex,
      },
    };
  }

  if (state === 'ASIG' && qtyOpen <= 0) {
    return {
      action: 'DROP',
      reason: 'zombie_qtyopen_cero',
      details: { qtyOpen: originalLine.qtyOpen || 0 },
    };
  }

  if (state === 'ASIG' && qtyOpen > 0) {
    return { action: 'KEEP' };
  }

  if (state === 'cancelled') {
    return { action: 'KEEP' };
  }

  return { action: 'KEEP' };
}

/**
 * @param {any[]} lines
 * @param {number} originalLineIndex
 * @param {string} skuNormalized
 * @returns {number}
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
