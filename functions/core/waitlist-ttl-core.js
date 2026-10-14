// @ts-check
/**
 * v1280 (2026-10-14): TTL de 7 dias para waitlists creados desde el modal
 * "Crear Pedido Desde Stock Asignado" (source='stock-asignado-batch').
 *
 * Rationale Mariano: "cada pedido creado desde el stock asignado tiene un
 * temporizador maximo de 7 dias. Pasado esos 7 dias se elimina el pedido
 * de la lista de espera. Es para que no reserven stock de forma indefinida".
 *
 * Que hace:
 *   1. Query revision_waitlist where source=='stock-asignado-batch'
 *      AND expiresAt < now AND stage != 'consumed'.
 *   2. Para cada expirado: delete del doc + audit log.
 *   3. NO toca los pedidos originales (sus lineas ASIG siguen reservando
 *      stock como antes — el admin puede destildarlas desde el modal
 *      Stock Asignado si no las quiere).
 *
 * NO afecta waitlists de otros flows (source='crear-manual', borradores,
 * excel revision, etc.) — esos tienen flows propios y no estan sujetos
 * a este TTL.
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

  for (const w of toDelete) {
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
        expiresAt: w.data.expiresAt,
      });
    } catch (e) {
      const msg = w.id + ': delete fallo ' + (e && e.message ? e.message : String(e));
      errors.push(msg);
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
        errorsCount: errors.length,
        errors: errors.slice(0, 20),
      });
    } catch (_logErr) {
      // Audit log best-effort.
    }
  }

  return { scanned, expired, errors };
}
