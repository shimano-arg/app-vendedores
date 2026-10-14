// @ts-check
/**
 * v1280 (2026-10-14): TTL de 7 dias para waitlists creados desde el modal
 * "Crear Pedido Desde Stock Asignado" (source='stock-asignado-batch').
 * v1281 (2026-10-14): al expirar, TAMBIEN cancelar las lineas ASIG originales
 * referenciadas en pedidosOrigenes[]. Mariano: "a los 7 dias eliminar el
 * stock asignado del cliente y la card de la lista de espera, asi no
 * compromete stock".
 *
 * Que hace:
 *   1. Query revision_waitlist where source=='stock-asignado-batch'
 *      AND expiresAt < now AND stage != 'consumed'.
 *   2. Para cada expirado:
 *      a. Si tiene pedidosOrigenes[] (v1280+): cancelar las lineas ASIG
 *         originales. Patron split v1272: si qtyAsignada < qtyOpen -> split
 *         parcial (resto queda ASIG); si qtyAsignada === qtyOpen -> cancel
 *         entera. Marca cancelledFrom='waitlist-expired' + expiredWaitlistId.
 *      b. Delete del doc waitlist.
 *      c. Audit log con detalle de cancelaciones.
 *
 * NO afecta waitlists de otros flows (source='crear-manual', borradores,
 * excel revision, etc.) — esos tienen flows propios y no estan sujetos
 * a este TTL.
 *
 * NO afecta lineas ASIG que NO estan referenciadas en pedidosOrigenes
 * del waitlist expirado — otras ASIG del mismo pedido siguen vivas.
 */

const WAITLIST_COLLECTION = 'revision_waitlist';
const EXPIRE_LOG_COLLECTION = 'waitlist_expire_log';

/**
 * @typedef {Object} TtlDeps
 * @property {any} fbDb
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {() => Date} [now] Inyectable para tests.
 *
 * @typedef {Object} ExpiredWaitlist
 * @property {string} id
 * @property {string} clientName
 * @property {string} source
 * @property {string|null} expiresAt
 *
 * @typedef {Object} TtlResult
 * @property {number} scanned
 * @property {ExpiredWaitlist[]} expired
 * @property {string[]} errors
 */

/**
 * @param {any} v Firestore Timestamp o ISO string o Date o number ms.
 * @returns {number} ms (0 si no parseable).
 */
function _toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.toMillis === 'function') {
    try {
      return v.toMillis();
    } catch {
      return 0;
    }
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/**
 * Ejecuta un tick del TTL. Idempotente — docs ya borrados no se re-encuentran.
 *
 * @param {TtlDeps} deps
 * @returns {Promise<TtlResult>}
 */
export async function expireStockAsignadoWaitlists(deps) {
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  /** @type {ExpiredWaitlist[]} */
  const expired = [];
  /** @type {string[]} */
  const errors = [];
  let scanned = 0;

  // Query: solo waitlists con source stock-asignado-batch. Filtramos
  // expiresAt en memoria porque Firestore no indexa string ISO como
  // Timestamp — si lo guardamos como Timestamp podríamos usar where directo.
  // Como el volumen total de waitlists es chico (~100), full scan OK.
  let snap;
  try {
    snap = await deps.fbDb
      .collection(WAITLIST_COLLECTION)
      .where('source', '==', 'stock-asignado-batch')
      .get();
  } catch (e) {
    const msg = 'waitlist query fallo: ' + (e && e.message ? e.message : String(e));
    log(msg, {});
    return { scanned: 0, expired: [], errors: [msg] };
  }

  /** @type {Array<{id: string, data: any}>} */
  const toDelete = [];
  snap.forEach((/** @type {any} */ d) => {
    scanned++;
    const data = d.data() || {};
    // No tocar los ya consumed (ya se crearon pedidos reales).
    if (data.stage === 'consumed') return;
    const expMs = _toMs(data.expiresAt);
    if (expMs <= 0) return; // Sin expiresAt (legacy pre-v1280) → no expirar.
    if (expMs > nowMs) return; // Aun vigente.
    toDelete.push({ id: d.id, data });
  });

  // v1281: para cada expirado, PRIMERO cancelar las lineas ASIG originales
  // (via pedidosOrigenes[]) y DESPUES borrar el waitlist. Si la cancelacion
  // falla, se loguea pero igual se borra el waitlist (el admin corrige manual).
  let totalLinesCancelled = 0;
  for (const w of toDelete) {
    const origenes = Array.isArray(w.data.pedidosOrigenes) ? w.data.pedidosOrigenes : [];
    const lineErrors = [];
    if (origenes.length > 0) {
      // Agrupar por pedido para hacer 1 update por doc.
      /** @type {Map<string, {newLines: any[]}>} */
      const updatesByPedido = new Map();
      for (const org of origenes) {
        const pid = org && org.pedidoId;
        if (!pid) continue;
        if (!updatesByPedido.has(pid)) {
          try {
            const pSnap = await deps.fbDb.collection('pedidos').doc(pid).get();
            if (!pSnap.exists) {
              lineErrors.push('pedido ' + pid + ': no existe');
              continue;
            }
            const data = pSnap.data() || {};
            updatesByPedido.set(pid, {
              newLines: Array.isArray(data.lines) ? data.lines.slice() : [],
            });
          } catch (e) {
            lineErrors.push(
              'pedido ' + pid + ' fetch: ' + (e && e.message ? e.message : String(e))
            );
            continue;
          }
        }
        const u = updatesByPedido.get(pid);
        if (!u) continue;
        const li = Number(org.lineIndex);
        const linea = u.newLines[li];
        if (!linea) {
          lineErrors.push('pedido ' + pid + ' line ' + li + ': no existe');
          continue;
        }
        if (linea.state !== 'ASIG') {
          // Alguien ya la movio. No pisar.
          lineErrors.push('pedido ' + pid + ' line ' + li + ': state=' + linea.state + ' (skip)');
          continue;
        }
        const qo = Number(linea.qtyOpen) || 0;
        const qty = Number(org.qtyAsignada) || 0;
        if (qty <= 0 || qty > qo) {
          lineErrors.push(
            'pedido ' +
              pid +
              ' line ' +
              li +
              ': qtyAsignada=' +
              qty +
              ' invalido (qtyOpen=' +
              qo +
              ')'
          );
          continue;
        }
        if (qty === qo) {
          u.newLines[li] = Object.assign({}, linea, {
            qtyOpen: 0,
            qtyCancelled: (Number(linea.qtyCancelled) || 0) + qty,
            state: 'cancelled',
            cancelledAt: nowIso,
            cancelledFrom: 'waitlist-expired',
            expiredWaitlistId: w.id,
          });
        } else {
          u.newLines[li] = Object.assign({}, linea, {
            qtyOpen: qo - qty,
            qtyCancelled: (Number(linea.qtyCancelled) || 0) + qty,
            partialCancelAt: nowIso,
            partialCancelFrom: 'waitlist-expired',
            partialCancelQty: (Number(linea.partialCancelQty) || 0) + qty,
            expiredWaitlistId: w.id,
          });
        }
        totalLinesCancelled++;
      }
      // Aplicar los updates por pedido.
      for (const [pid, u] of updatesByPedido) {
        try {
          await deps.fbDb.collection('pedidos').doc(pid).update({
            lines: u.newLines,
            updatedAt: nowIso,
          });
        } catch (e) {
          lineErrors.push('pedido ' + pid + ' update: ' + (e && e.message ? e.message : String(e)));
        }
      }
    }
    // Delete del waitlist (siempre, aun si cancelaciones fallaron parcialmente).
    try {
      await deps.fbDb.collection(WAITLIST_COLLECTION).doc(w.id).delete();
      expired.push({
        id: w.id,
        clientName: String(w.data.clientName || ''),
        source: String(w.data.source || ''),
        expiresAt: w.data.expiresAt || null,
      });
      log('waitlist expired + deleted', {
        id: w.id,
        clientName: w.data.clientName,
        linesCancelled: origenes.length - lineErrors.length,
        lineErrors: lineErrors.length,
      });
    } catch (e) {
      const msg = w.id + ': delete fallo ' + (e && e.message ? e.message : String(e));
      errors.push(msg);
    }
    for (const le of lineErrors) {
      errors.push(w.id + ' ' + le);
    }
  }

  // Audit log por corrida.
  if (expired.length > 0 || errors.length > 0) {
    try {
      await deps.fbDb.collection(EXPIRE_LOG_COLLECTION).add({
        executedAt: nowIso,
        scanned,
        expiredCount: expired.length,
        expired: expired.slice(0, 100),
        linesCancelledCount: totalLinesCancelled,
        errorsCount: errors.length,
        errors: errors.slice(0, 50),
      });
    } catch (_logErr) {
      // Audit log best-effort.
    }
  }

  return { scanned, expired, errors };
}
