// @ts-check
/**
 * E10 §stock-servidor-atomico (v1433) — updatePedidoLinesCore.
 *
 * CF para edits legítimos de líneas pre-envío (precio, qty, notas) desde VDE.
 * Reemplaza el write directo a `pedidos.lines` que las rules van a bloquear
 * en el cutover (E10 Fase 2).
 *
 * Validaciones:
 * - Pedido debe existir, ownerUid == auth.uid (o admin/gerente).
 * - transferidoSAP.docEntry == null (pedido NO está en SAP).
 * - lines[] contiene SOLO cambios de precio/qty/notas (NO state).
 *
 * No consume stock — solo edita campos cosméticos. Para cambios de qty que
 * afectan reserva, el flow correcto es cancelar + crear nuevo via commitPedidoCF.
 */

/**
 * @typedef {Object} UpdatePedidoLinesDeps
 * @property {any} fbDb
 * @property {() => Date} [now]
 * @property {(msg: string, data?: any) => void} [log]
 */

const WHITELISTED_LINE_FIELDS = new Set(['precio', 'qty', 'qtyOpen', 'notas']);

// SEC-H5 (HARDENING5 BATCH 1, 2026-11-19): rangos de validación para evitar
// inyección de NaN / negativos / strings / overflow. Caps:
//  - qty/qtyOpen: 0..10000 (ningún pedido real supera 10k unidades por línea).
//  - precio: 0..10_000_000 ARS (10M por unidad es más que cualquier producto SAP).
const LINE_LIMITS = {
  QTY_MIN: 0,
  QTY_MAX: 10000,
  PRECIO_MIN: 0,
  PRECIO_MAX: 10_000_000,
};

/**
 * Valida rangos de los campos editables en el change. Null-safe: un campo
 * ausente (!= null) no dispara. Un campo presente debe ser Number.isFinite
 * y estar dentro del rango.
 * @param {any} change
 * @returns {string|null} Mensaje de error si inválido, null si OK.
 */
function _validateLineRanges(change) {
  if (change.qty != null) {
    const q = Number(change.qty);
    if (!Number.isFinite(q) || q < LINE_LIMITS.QTY_MIN || q > LINE_LIMITS.QTY_MAX) {
      return (
        'qty fuera de rango [' +
        LINE_LIMITS.QTY_MIN +
        ', ' +
        LINE_LIMITS.QTY_MAX +
        ']: ' +
        change.qty
      );
    }
  }
  if (change.qtyOpen != null) {
    const qo = Number(change.qtyOpen);
    if (!Number.isFinite(qo) || qo < LINE_LIMITS.QTY_MIN || qo > LINE_LIMITS.QTY_MAX) {
      return (
        'qtyOpen fuera de rango [' +
        LINE_LIMITS.QTY_MIN +
        ', ' +
        LINE_LIMITS.QTY_MAX +
        ']: ' +
        change.qtyOpen
      );
    }
  }
  if (change.precio != null) {
    const p = Number(change.precio);
    if (!Number.isFinite(p) || p < LINE_LIMITS.PRECIO_MIN || p > LINE_LIMITS.PRECIO_MAX) {
      return (
        'precio fuera de rango [' +
        LINE_LIMITS.PRECIO_MIN +
        ', ' +
        LINE_LIMITS.PRECIO_MAX +
        ']: ' +
        change.precio
      );
    }
  }
  return null;
}

/**
 * @param {UpdatePedidoLinesDeps} deps
 * @param {any} payload
 * @param {{uid: string, email: string, role?: string}} auth
 */
export async function updatePedidoLinesCore(deps, payload, auth) {
  const log = deps.log || (() => {});
  const now = (deps.now ? deps.now() : new Date()).toISOString();

  if (!payload || !payload.pedidoId || !Array.isArray(payload.lines)) {
    return { ok: false, errorCode: 'VALIDATION_ERROR', message: 'pedidoId y lines[] requeridos' };
  }
  if (!auth || !auth.uid) {
    return { ok: false, errorCode: 'PERMISSION_DENIED', message: 'login requerido' };
  }

  const pedidoRef = deps.fbDb.collection('pedidos').doc(payload.pedidoId);
  try {
    const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      const snap = await tx.get(pedidoRef);
      if (!snap.exists) {
        return { ok: false, errorCode: 'NOT_FOUND', message: 'pedido no existe' };
      }
      const data = snap.data() || {};
      // SEC-H5 (HARDENING5 BATCH 1, 2026-11-19) §44/§46/§59/§63:
      // El VDE que edita puede ser ownerUid O assignedVendorUid del cliente
      // master. Caso canónico: Gonzalo-BROBRO — orden cargada por Pablo pero
      // Gonzalo es el VDE del master del cliente. Antes solo chequeaba
      // ownerUid → VDEs cross-vendor quedaban bloqueados.
      const isPrivileged =
        auth.role === 'admin' || auth.role === 'gerente' || auth.role === 'interno';
      if (!isPrivileged && data.ownerUid !== auth.uid && data.assignedVendorUid !== auth.uid) {
        return {
          ok: false,
          errorCode: 'PERMISSION_DENIED',
          message: 'solo el dueño del pedido o admin puede editarlo',
        };
      }
      // Guard E8: pedido en SAP → bloqueo.
      const trans = data.transferidoSAP;
      if (trans && trans.docEntry != null && trans.via !== 'app_only') {
        return {
          ok: false,
          errorCode: 'PERMISSION_DENIED',
          message:
            'Pedido ya en SAP (SQ #' +
            (trans.docNum || trans.docEntry) +
            '); para modificar, contactar a admin que lo edita en SAP',
        };
      }
      // SEC-H5 (HARDENING5 BATCH 1, 2026-11-19) — vector V-N3 Data Integrity:
      // pedido stage='confirmed' NO es editable. Race con onPedidoConfirmedSendToSap:
      // entre que el trigger arma el payload SAP y hace el POST, un edit al precio/qty
      // dejaría Firestore con un valor distinto del enviado a SAP → divergencia BI +
      // fraude ocultable. Para modificar un confirmed hay que revertirlo a pending.
      if (data.stage === 'confirmed') {
        return {
          ok: false,
          errorCode: 'PERMISSION_DENIED',
          message: 'Pedido en estado confirmed no es editable; revertir a pending primero',
        };
      }
      // Construir newLines a partir del original con los cambios whitelist.
      const originalLines = Array.isArray(data.lines) ? data.lines : [];
      /** @type {any[]} */
      const newLines = originalLines.map((/** @type {any} */ l) => ({ ...l }));
      const applied = [];
      for (const change of payload.lines) {
        const li = Number(change.lineIndex);
        if (!Number.isFinite(li) || !newLines[li]) {
          return {
            ok: false,
            errorCode: 'VALIDATION_ERROR',
            message: 'lineIndex inválido: ' + change.lineIndex,
          };
        }
        // Validar que todos los campos del change estén en whitelist.
        for (const field of Object.keys(change)) {
          if (field === 'lineIndex') continue;
          if (!WHITELISTED_LINE_FIELDS.has(field)) {
            return {
              ok: false,
              errorCode: 'VALIDATION_ERROR',
              message:
                'campo no editable: ' +
                field +
                ' (whitelist: ' +
                Array.from(WHITELISTED_LINE_FIELDS).join(',') +
                ')',
            };
          }
        }
        // SEC-H5 (HARDENING5 BATCH 1, 2026-11-19): validar rangos ANTES de
        // aplicar. Rechaza NaN, negativos, strings no-numéricos, overflow.
        const rangeErr = _validateLineRanges(change);
        if (rangeErr) {
          return {
            ok: false,
            errorCode: 'VALIDATION_ERROR',
            message: rangeErr,
          };
        }
        // Aplicar cambios whitelist.
        const line = newLines[li];
        for (const field of WHITELISTED_LINE_FIELDS) {
          if (change[field] != null) {
            line[field] = change[field];
          }
        }
        line._editedAt = now;
        line._editedBy = auth.email;
        applied.push({
          lineIndex: li,
          changes: Object.keys(change).filter((k) => k !== 'lineIndex'),
        });
      }
      // SEC-H5 (HARDENING5 BATCH 1, 2026-11-19) §54 R9: invariante qtyOpen ≤ qty
      // por línea. Un edit que setee qtyOpen > qty queda prohibido server-side.
      // Se chequea DESPUÉS de aplicar todos los cambios para permitir edits
      // compuestos consistentes (ej. qty:20 + qtyOpen:15 pasa; qty:10 + qtyOpen:15
      // falla).
      for (let i = 0; i < newLines.length; i++) {
        const ln = newLines[i];
        const q = Number(ln.qty || 0);
        const qo = Number(ln.qtyOpen || 0);
        if (qo > q) {
          return {
            ok: false,
            errorCode: 'VALIDATION_ERROR',
            message:
              'invariante R9 violado: qtyOpen (' + qo + ') > qty (' + q + ') en lineIndex ' + i,
          };
        }
      }
      tx.update(pedidoRef, {
        lines: newLines,
        updatedAt: now,
        _lastEditedBy: auth.email,
      });
      log('updatePedidoLinesCore OK', { pedidoId: payload.pedidoId, applied });
      return { ok: true, pedidoId: payload.pedidoId, applied };
    });
    return result;
  } catch (e) {
    const err = /** @type {any} */ (e);
    log('updatePedidoLinesCore error', { err: err && err.message });
    return {
      ok: false,
      errorCode: 'INTERNAL',
      message: err && err.message ? err.message : String(err),
    };
  }
}
