/**
 * Mirror server-side de src/pure/dual-write/transform-pedido-to-pg.js (§57).
 *
 * Mantener byte-equivalent con el pure (post header). El test de sincronia
 * `tests/unit/audit/dual-write-sync.test.js` falla si divergen.
 *
 * @module functions/core/dual-write/transform-pedido-to-pg
 *
 * Ver ADR-001 `docs/adr/0001-modelo-datos-pedidos-pg.md` + schema
 * `backend-new/db/schema/0001_initial.sql`.
 *
 * Diseno S-10 doble escritura: este helper vive una sola vez aqui con espejo
 * en `functions/core/dual-write/transform-pedido-to-pg.js` (§57). El wrapper
 * CF `functions/dual-write/on-pedido-write-to-pg.js` aplica el I/O.
 *
 * ESTE HELPER ES PURO — no lee ni escribe Firestore, PG, red, tiempo (todos
 * los timestamps vienen del input o se derivan del snapshot).
 *
 * @module src/pure/dual-write/transform-pedido-to-pg
 */

/**
 * Timestamps Firestore pueden venir como:
 *   - Firestore Timestamp con `.toDate()` o `.toMillis()`.
 *   - string ISO ("2026-11-26T12:00:00.000Z").
 *   - object { seconds, nanoseconds } (REST API shape).
 *   - number (millis since epoch).
 *   - null / undefined.
 *
 * Devuelve string ISO 8601 o `null`. Pattern §85.
 *
 * @param {unknown} v
 * @returns {string | null}
 */
export function toIsoOrNull(v) {
  if (v === null || v === undefined) return null;
  // Firestore Timestamp (v8 + v9 modular).
  if (v && typeof v === 'object') {
    const anyV = /** @type {any} */ (v);
    if (typeof anyV.toDate === 'function') {
      try {
        const d = anyV.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
      } catch (_e) {
        /* fallthrough */
      }
    }
    if (typeof anyV.toMillis === 'function') {
      try {
        return new Date(anyV.toMillis()).toISOString();
      } catch (_e) {
        /* fallthrough */
      }
    }
    if (typeof anyV.seconds === 'number') {
      try {
        return new Date(
          anyV.seconds * 1000 + Math.floor((anyV.nanoseconds || 0) / 1e6)
        ).toISOString();
      } catch (_e) {
        /* fallthrough */
      }
    }
  }
  if (typeof v === 'string') {
    if (!v) return null;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return null;
  }
  return null;
}

/**
 * Mapea los state values legacy de Firestore al ENUM PG `line_state_enum`.
 * Rechaza shapes desconocidos devolviendo `null` para que el caller decida.
 *
 * @param {unknown} state
 * @returns {'BO' | 'ASIG' | 'confirmed' | 'invoiced' | 'cancelled' | null}
 */
export function mapLineState(state) {
  if (typeof state !== 'string') return null;
  const normalized = state.trim();
  if (normalized === 'BO') return 'BO';
  if (normalized === 'ASIG') return 'ASIG';
  if (normalized === 'confirmed') return 'confirmed';
  if (normalized === 'invoiced') return 'invoiced';
  if (normalized === 'cancelled') return 'cancelled';
  return null;
}

/**
 * Mapea los origin values al ENUM PG `pedido_origen_enum`.
 * Fallback a 'manual' para shapes legacy / vacios (shape ADR-001 permite).
 *
 * @param {unknown} origen
 * @returns {'manual' | 'cpst' | 'excel' | 'reparto' | 'backorder' | 'sap_sync'}
 */
export function mapPedidoOrigen(origen) {
  if (typeof origen !== 'string') return 'manual';
  const o = origen.trim().toLowerCase();
  // Normalizaciones Firestore -> PG enum.
  if (o === 'stock-asignado-batch' || o === 'cpst') return 'cpst';
  if (o === 'excel') return 'excel';
  if (o === 'reparto') return 'reparto';
  if (o === 'backorder' || o === 'generar_backorder' || o === 'generar-backorder')
    return 'backorder';
  if (o === 'sap_sync' || o === 'sap-sync') return 'sap_sync';
  if (o === 'manual') return 'manual';
  return 'manual';
}

/**
 * Decide el warehouse de la reserva segun el flag `enTransito` de la linea.
 * §107: enTransito=true -> dep_12, false/undefined -> dep_11.
 *
 * @param {boolean | undefined} enTransito
 * @returns {'dep_11' | 'dep_12'}
 */
export function warehouseForLine(enTransito) {
  return enTransito === true ? 'dep_12' : 'dep_11';
}

/**
 * Decide si una linea reserva stock. Mirror de la funcion PG
 * `line_reserves_stock` del schema 0001 (§40).
 *
 * Reglas:
 *   - BO: NO reserva (§40 — cambio desde §34 historico).
 *   - invoiced / cancelled: NO reserva.
 *   - qty_open <= 0: NO reserva.
 *   - ASIG: reserva (§40.10 — sin excepciones post v1402).
 *   - confirmed con transferidoSAP.orderDocEntry presente: NO reserva (§40.8).
 *   - confirmed sin orderDocEntry: reserva.
 *
 * @param {Record<string, any>} line
 * @param {Record<string, any> | null} transferidoSap - pedido.transferidoSAP
 * @returns {boolean}
 */
export function lineReservesStockForPg(line, transferidoSap) {
  if (!line) return false;
  const state = mapLineState(line.state);
  if (!state) return false;
  const qtyOpen = Number(line.qtyOpen);
  if (!Number.isFinite(qtyOpen) || qtyOpen <= 0) return false;
  if (state === 'BO' || state === 'invoiced' || state === 'cancelled') return false;
  if (state === 'ASIG') return true;
  if (state === 'confirmed') {
    if (
      transferidoSap &&
      typeof transferidoSap === 'object' &&
      transferidoSap !== null &&
      'orderDocEntry' in transferidoSap &&
      transferidoSap.orderDocEntry !== null &&
      transferidoSap.orderDocEntry !== '' &&
      transferidoSap.orderDocEntry !== undefined
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Valida campos obligatorios del cabecera del pedido. Devuelve array de
 * razones; vacio = valido.
 *
 * @param {Record<string, any>} doc
 * @returns {string[]}
 */
export function validatePedidoHeader(doc) {
  /** @type {string[]} */
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    errors.push('doc_not_object');
    return errors;
  }
  if (!doc._fsId && !doc.id) errors.push('missing_id');
  if (typeof doc.orderNumber !== 'number' || doc.orderNumber <= 0)
    errors.push('missing_order_number');
  if (!doc.clientCardCode || typeof doc.clientCardCode !== 'string')
    errors.push('missing_client_card_code');
  if (!doc.clientName || typeof doc.clientName !== 'string') errors.push('missing_client_name');
  if (!doc.assignedVendorUid || typeof doc.assignedVendorUid !== 'string')
    errors.push('missing_assigned_vendor_uid');
  if (!Array.isArray(doc.lines)) errors.push('missing_lines_array');
  return errors;
}

/**
 * Transforma un documento Firestore `pedidos/{id}` al shape PG.
 *
 * Shape output:
 *   {
 *     pedido: { id, order_number, client_card_code, client_name,
 *               assigned_vendor_uid, assigned_vendor_key, owner_uid,
 *               cargado_por_uid, origen, draft_id, transferido_sap,
 *               created_at, updated_at, first_invoiced_at, cobrado_at,
 *               closed_at, closed_reason, closed_by },
 *     lines: Array<{ pedido_id, line_index, sku, state, qty, qty_open,
 *                    qty_cancelled, price_ars, discount_percent,
 *                    en_transito, asig_at_transito, en_dep11_at, asig_at,
 *                    confirmed_at, cancelled_at, asig_revertida_at,
 *                    asig_revertida_by, asig_revertida_reason,
 *                    split_from_line_index, closed_reason, closed_by,
 *                    cancelled_by }>,
 *     reservations: Array<{ pedido_id, line_index, sku, warehouse, qty,
 *                           state, asig_at }>,
 *     warnings: Array<string>   // issues no bloqueantes, ej. linea con state desconocido.
 *   }
 *
 * Si la cabecera es invalida (validatePedidoHeader devuelve errores),
 * tira `Error` con mensaje 'invalid_pedido_doc: <razones joined>'.
 *
 * @param {Record<string, any>} doc - documento Firestore `pedidos/{id}` con `.lines` array.
 * @returns {{
 *   pedido: Record<string, any>,
 *   lines: Array<Record<string, any>>,
 *   reservations: Array<Record<string, any>>,
 *   warnings: string[],
 * }}
 */
export function transformPedidoToPg(doc) {
  const headerErrors = validatePedidoHeader(doc);
  if (headerErrors.length > 0) {
    throw new Error('invalid_pedido_doc: ' + headerErrors.join(','));
  }

  const pedidoId = String(doc._fsId || doc.id);
  /** @type {string[]} */
  const warnings = [];

  // Cabecera PG.
  const pedido = {
    id: pedidoId,
    order_number: Number(doc.orderNumber),
    client_card_code: String(doc.clientCardCode).trim(),
    client_name: String(doc.clientName).trim(),
    assigned_vendor_uid: String(doc.assignedVendorUid).trim(),
    assigned_vendor_key: String(
      doc.vendorAssigned || doc.assignedVendorKey || doc.ownerVendor || ''
    ).trim(),
    owner_uid: String(doc.ownerUid || '').trim(),
    cargado_por_uid: String(doc.cargadoPorUid || doc.ownerUid || '').trim(),
    origen: mapPedidoOrigen(doc.origen),
    draft_id: doc.draftId ? String(doc.draftId) : null,
    transferido_sap: doc.transferidoSAP || null,
    created_at: toIsoOrNull(doc.createdAt),
    updated_at: toIsoOrNull(doc.updatedAt) || toIsoOrNull(doc.createdAt),
    first_invoiced_at: toIsoOrNull(doc.firstInvoicedAt),
    cobrado_at: toIsoOrNull(doc.cobradoAt),
    closed_at: toIsoOrNull(doc.closedAt),
    closed_reason: doc.closedReason || null,
    closed_by: doc.closedBy || null,
  };

  // Lineas PG + reservations espejadas.
  /** @type {Array<Record<string, any>>} */
  const lines = [];
  /** @type {Array<Record<string, any>>} */
  const reservations = [];
  const docLines = Array.isArray(doc.lines) ? doc.lines : [];

  for (let i = 0; i < docLines.length; i++) {
    const rawLine = docLines[i];
    if (!rawLine || typeof rawLine !== 'object') {
      warnings.push('line_' + i + '_not_object');
      continue;
    }
    const state = mapLineState(rawLine.state);
    if (!state) {
      warnings.push('line_' + i + '_unknown_state:' + String(rawLine.state));
      continue;
    }
    const qty = Number(rawLine.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      warnings.push('line_' + i + '_invalid_qty:' + String(rawLine.qty));
      continue;
    }
    const sku = String(rawLine.code || rawLine.sku || '').trim();
    if (!sku) {
      warnings.push('line_' + i + '_missing_sku');
      continue;
    }
    const qtyOpen = Number(rawLine.qtyOpen);
    const qtyCancelled = Number(rawLine.qtyCancelled || 0);
    const priceArs = Number(rawLine.price || rawLine.priceArs || 0);
    const discountPct = Number(rawLine.discountPct || rawLine.discountPercent || 0);
    const enTransito = rawLine.enTransito === true;

    const line = {
      pedido_id: pedidoId,
      line_index: i,
      sku: sku,
      state: state,
      qty: qty,
      qty_open: Number.isFinite(qtyOpen) && qtyOpen >= 0 ? qtyOpen : 0,
      qty_cancelled: Number.isFinite(qtyCancelled) && qtyCancelled >= 0 ? qtyCancelled : 0,
      price_ars: Number.isFinite(priceArs) && priceArs >= 0 ? priceArs : 0,
      discount_percent:
        Number.isFinite(discountPct) && discountPct >= 0 && discountPct <= 100 ? discountPct : 0,
      en_transito: enTransito,
      asig_at_transito: toIsoOrNull(rawLine.asigAtTransito),
      en_dep11_at: toIsoOrNull(rawLine.enDep11At),
      asig_at: toIsoOrNull(rawLine.asigAt),
      confirmed_at: toIsoOrNull(rawLine.confirmedAt),
      cancelled_at: toIsoOrNull(rawLine.cancelledAt),
      asig_revertida_at: toIsoOrNull(rawLine.asigRevertidaAt),
      asig_revertida_by: rawLine.asigRevertidaBy || null,
      asig_revertida_reason: rawLine.asigRevertidaReason || null,
      split_from_line_index:
        typeof rawLine.splitFromLineIndex === 'number' ? rawLine.splitFromLineIndex : null,
      closed_reason: rawLine.closedReason || null,
      closed_by: rawLine.closedBy || null,
      cancelled_by: rawLine.cancelledBy || null,
    };
    lines.push(line);

    // Reservation espejada si la linea reserva stock (§40).
    if (lineReservesStockForPg(rawLine, doc.transferidoSAP)) {
      reservations.push({
        pedido_id: pedidoId,
        line_index: i,
        sku: sku,
        warehouse: warehouseForLine(enTransito),
        qty: line.qty_open, // La reserva es sobre qty_open, no qty total (§40).
        state: state,
        asig_at: line.asig_at,
      });
    }
  }

  return { pedido, lines, reservations, warnings };
}

export const DUAL_WRITE_VERSION = 1;
