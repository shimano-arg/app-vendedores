// @ts-check
/**
 * v1535 (APP-02) — lock Firestore del sync de clientes SAP → app.
 *
 * El sync de clientes (syncBpPesca) corre desde 2 lugares:
 *   - la corrida programada `syncSapCatalogStockCF` (cada 5 min), y
 *   - el boton manual "Sincronizar con SAP" del Master de Clientes
 *     (`syncClientesSapCF`).
 * Si corren a la vez, las dos leen `client_applications` antes de escribir y
 * las dos pueden crear el MISMO cliente nuevo (duplicado). Este lock garantiza
 * una sola corrida por vez.
 *
 * Doc: `app_config/bp_sync_lock` = {holder, owner, acquiredAt, expiresAt}.
 * TTL 10 min: si una corrida se cae sin liberar (timeout de la CF, crash), el
 * lock vence solo y no bloquea para siempre (la CF tiene timeout 300 s).
 *
 * Transacciones con TODAS las lecturas antes de las escrituras (CLAUDE.md §58).
 */

export const BP_SYNC_LOCK_PATH = 'app_config/bp_sync_lock';
export const BP_SYNC_LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Intenta tomar el lock.
 * @param {any} fbDb Firestore admin (necesita doc + runTransaction).
 * @param {{owner: string, nowMs?: number, ttlMs?: number, lockId?: string}} opts
 * @returns {Promise<{acquired: boolean, lockId?: string, heldBy?: string, expiresAt?: number}>}
 */
export async function acquireBpSyncLock(fbDb, opts) {
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : BP_SYNC_LOCK_TTL_MS;
  const owner = String(opts.owner || 'desconocido');
  const lockId = opts.lockId || owner + '_' + nowMs + '_' + Math.random().toString(36).slice(2, 10);
  const ref = fbDb.doc(BP_SYNC_LOCK_PATH);
  return fbDb.runTransaction(async (/** @type {any} */ tx) => {
    // FASE READ.
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (d && d.holder && Number(d.expiresAt) > nowMs) {
      return { acquired: false, heldBy: String(d.owner || ''), expiresAt: Number(d.expiresAt) };
    }
    // FASE WRITE.
    tx.set(ref, { holder: lockId, owner, acquiredAt: nowMs, expiresAt: nowMs + ttlMs });
    return { acquired: true, lockId };
  });
}

/**
 * Libera el lock SOLO si lo tiene `lockId` (no pisa un lock ajeno que se tomo
 * despues de que el nuestro vencio).
 * @param {any} fbDb
 * @param {string} lockId
 * @returns {Promise<boolean>} true si se libero.
 */
export async function releaseBpSyncLock(fbDb, lockId) {
  if (!lockId) return false;
  const ref = fbDb.doc(BP_SYNC_LOCK_PATH);
  return fbDb.runTransaction(async (/** @type {any} */ tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (!d || d.holder !== lockId) return false;
    tx.delete(ref);
    return true;
  });
}
