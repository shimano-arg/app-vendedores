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
      // Ownership check: VDE solo su pedido, admin/gerente any.
      const isPrivileged =
        auth.role === 'admin' || auth.role === 'gerente' || auth.role === 'interno';
      if (!isPrivileged && data.ownerUid !== auth.uid) {
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
