// @ts-check
/**
 * v1535 (APP-02) — core del callable `syncClientesSapCF`: boton "Sincronizar
 * con SAP" del Master de Clientes.
 *
 * Corre a pedido el MISMO sync de clientes SAP → app que ya existe
 * (`syncBpPesca`, functions/core/sync-bp-pesca-core.js), para que un cliente
 * recien creado en SAP aparezca en el master sin esperar a la corrida
 * programada. No es una integracion SAP paralela.
 *
 * Decisiones del dueño:
 *   1. El boton SIEMPRE escribe (forceWrite=true), aunque el flag
 *      `app_config/sap_integration.bpSyncByCF` este en false. No se toca el flag
 *      ni la corrida programada.
 *   2. Solo admin y gerente. El rol se lee del servidor (`roles/{uid}` via
 *      deps.getUserRole); nunca se confia en lo que mande el cliente.
 *
 * Lock compartido con la corrida programada (`bp-sync-lock.js`): si hay otra
 * corrida en curso devuelve {ok:false, code:'EN_CURSO'} sin correr.
 *
 * CLAUDE.md §7: core puro con deps inyectables; el wrapper en functions/index.js
 * solo arma deps reales. Los errores de auth tiran {code, message} (compatibles
 * con HttpsError); los errores del sync se devuelven como {ok:false, code}.
 */

import { acquireBpSyncLock, releaseBpSyncLock } from './bp-sync-lock.js';
import { acquireSession, releaseSession } from './sap-sl-session.js';
import { syncBpPesca } from './sync-bp-pesca-core.js';

const ROLES_PERMITIDOS = new Set(['admin', 'gerente']);

/**
 * @param {string} code
 * @param {string} message
 */
function authError(code, message) {
  const e = /** @type {any} */ (new Error(message));
  e.code = code;
  return e;
}

/**
 * @typedef {Object} SyncClientesSapDeps
 * @property {any} fbDb Firestore admin.
 * @property {any} [FieldValue] admin.firestore.FieldValue (serverTimestamp).
 * @property {(uid: string) => Promise<{role?: string}|null>} getUserRole lee roles/{uid}.
 * @property {() => Promise<any|null>} loadSapConfig {url, companyDB, userName, password, fetch?} o null.
 * @property {typeof acquireSession} [acquireSession]
 * @property {typeof releaseSession} [releaseSession]
 * @property {typeof syncBpPesca} [syncBpPesca]
 * @property {() => number} [now]
 * @property {(msg: string, extra?: any) => void} [log]
 */

/**
 * @param {SyncClientesSapDeps} deps
 * @param {{auth?: {uid?: string, token?: {email?: string}}|null, data?: any}} req
 * @returns {Promise<{ok: boolean, code?: string, message?: string, nuevos?: number, actualizados?: number, total?: number, durationMs?: number}>}
 */
export async function syncClientesSapCore(deps, req) {
  const auth = req && req.auth;
  if (!auth || !auth.uid) throw authError('unauthenticated', 'login requerido');
  const uid = String(auth.uid);
  const email = String((auth.token && auth.token.email) || '').toLowerCase();
  const log = deps.log || (() => {});
  const nowFn = deps.now || Date.now;
  const _acquireSession = deps.acquireSession || acquireSession;
  const _releaseSession = deps.releaseSession || releaseSession;
  const _syncBpPesca = deps.syncBpPesca || syncBpPesca;

  // Rol leido del servidor (no del payload del cliente).
  /** @type {any} */
  let roleDoc = null;
  try {
    roleDoc = await deps.getUserRole(uid);
  } catch (e) {
    throw authError(
      'permission-denied',
      'no se pudo validar el rol: ' + ((e && /** @type {any} */ (e).message) || String(e))
    );
  }
  const role = String((roleDoc && roleDoc.role) || '').toLowerCase();
  if (!ROLES_PERMITIDOS.has(role)) {
    throw authError('permission-denied', 'solo admin o gerente puede sincronizar clientes');
  }

  const startedMs = nowFn();
  /** @type {any} */
  let result;
  const lock = await acquireBpSyncLock(deps.fbDb, { owner: 'manual:' + uid, nowMs: startedMs });
  if (!lock.acquired) {
    result = { ok: false, code: 'EN_CURSO', message: 'ya hay una sincronizacion en curso' };
    await writeLog(deps, { uid, email, role, result, startedMs, heldBy: lock.heldBy || null });
    return result;
  }

  try {
    result = await runSync({
      deps,
      log,
      acquire: _acquireSession,
      release: _releaseSession,
      sync: _syncBpPesca,
    });
  } catch (e) {
    const msg = (e && /** @type {any} */ (e).message) || String(e);
    log('[syncClientesSap] error: ' + msg);
    result = { ok: false, code: 'SYNC_FALLO', message: msg };
  } finally {
    try {
      await releaseBpSyncLock(deps.fbDb, /** @type {string} */ (lock.lockId));
    } catch (e) {
      // Si no se pudo liberar, el TTL (10 min) lo libera solo.
      log('[syncClientesSap] no se pudo liberar el lock: ' + String(e));
    }
  }
  result.durationMs = Math.max(0, nowFn() - startedMs);
  await writeLog(deps, { uid, email, role, result, startedMs, heldBy: null });
  return result;
}

/**
 * Login SL + syncBpPesca(forceWrite) + release de sesion.
 * @param {{deps: SyncClientesSapDeps, log: (m: string, x?: any) => void, acquire: any, release: any, sync: any}} p
 */
async function runSync(p) {
  const sapConfig = await p.deps.loadSapConfig();
  if (!sapConfig || !sapConfig.url || !sapConfig.companyDB) {
    return { ok: false, code: 'SAP_NO_CONFIGURADO', message: 'serviceLayer sin configurar' };
  }
  const sess = await p.acquire(sapConfig);
  let sessionOk = true;
  try {
    const r = await p.sync({
      fbDb: p.deps.fbDb,
      FieldValue: p.deps.FieldValue,
      sapConfig,
      // sync-bp-pesca-core manda el header Cookie tal cual: necesita el prefijo.
      cookie: 'B1SESSION=' + sess.cookie,
      forceWrite: true,
      log: p.log,
    });
    return mapResult(r);
  } catch (e) {
    const msg = (e && /** @type {any} */ (e).message) || String(e);
    if (msg.includes('401') || msg.includes('login failed')) sessionOk = false;
    throw e;
  } finally {
    try {
      p.release(sess, sessionOk);
    } catch (_e) {
      // best-effort
    }
  }
}

/**
 * Traduce el resultado de syncBpPesca a la respuesta del callable.
 * nuevos = clientes creados; actualizados = existentes refrescados (incluye
 * provisorios confirmados con su codigo SAP); total = nuevos + actualizados.
 * @param {any} r
 */
function mapResult(r) {
  const st = (r && r.stats) || {};
  const nuevos = Number(st.created) || 0;
  const actualizados = (Number(st.updated_prov_to_conf) || 0) + (Number(st.updated_existing) || 0);
  const total = nuevos + actualizados;
  if (!r || r.ok !== true) {
    return { ok: false, code: 'SYNC_FALLO', message: String((r && r.error) || 'sync fallo') };
  }
  if (r.dryRun === true) {
    // No deberia pasar con forceWrite; si pasa, no se escribio nada: no es exito.
    return { ok: false, code: 'SYNC_FALLO', message: 'el sync corrio sin escribir (dry-run)' };
  }
  if (r.fetchError) {
    // SAP corto la lista de clientes a mitad: puede faltar gente. No es exito.
    return {
      ok: false,
      code: 'SAP_INCOMPLETO',
      message: String(r.fetchError),
      nuevos,
      actualizados,
      total,
    };
  }
  return { ok: true, nuevos, actualizados, total };
}

/**
 * operations_log best-effort (nunca rompe la respuesta).
 * @param {SyncClientesSapDeps} deps
 * @param {{uid: string, email: string, role: string, result: any, startedMs: number, heldBy: string|null}} x
 */
async function writeLog(deps, x) {
  try {
    await deps.fbDb.collection('operations_log').add({
      type: 'sync_clientes_sap_manual',
      userId: x.uid,
      userEmail: x.email || null,
      role: x.role,
      ok: x.result.ok === true,
      code: x.result.code || null,
      message: x.result.message || null,
      nuevos: typeof x.result.nuevos === 'number' ? x.result.nuevos : null,
      actualizados: typeof x.result.actualizados === 'number' ? x.result.actualizados : null,
      total: typeof x.result.total === 'number' ? x.result.total : null,
      durationMs: typeof x.result.durationMs === 'number' ? x.result.durationMs : null,
      lockHeldBy: x.heldBy,
      startedAt: new Date(x.startedMs),
      timestamp: new Date(),
    });
  } catch (_e) {
    // best-effort
  }
}
