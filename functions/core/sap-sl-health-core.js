// @ts-check
/**
 * v616 (2026-08-25): health check pasivo de SAP Service Layer.
 *
 * CF scheduled cada 5 min pinguea `/Login`, mide latencia, y escribe estado
 * a `app_config/sap_sl_health` para que el Panel de Control lo muestre.
 *
 * Es una version simplificada de "monitor": no alerta, solo persiste el
 * ultimo check. El panel muestra semaforo verde/amarillo/rojo basado en
 * status + consecutive failures.
 *
 * Doc shape (`app_config/sap_sl_health`):
 * {
 *   status: 'ok' | 'error',
 *   lastCheckAt: ISO,
 *   latencyMs: N,
 *   errorMessage: null | string,
 *   consecutiveFailures: N (increments on error, resets to 0 on ok),
 *   firstFailureAt: ISO | null (set on primer error, null cuando ok)
 * }
 */

import { sapLogin, sapLogout } from './sap-sl-client.js';

const HEALTH_DOC = 'app_config/sap_sl_health';

/**
 * @typedef {Object} SapHealthDeps
 * @property {any} fbDb Firestore admin instance.
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {() => Date} [now] Inyectable para tests.
 */

/**
 * Lee doc previo para actualizar consecutiveFailures + firstFailureAt.
 * @param {SapHealthDeps} deps
 * @returns {Promise<{consecutiveFailures: number, firstFailureAt: string | null}>}
 */
async function readPreviousState(deps) {
  try {
    const snap = await deps.fbDb.doc(HEALTH_DOC).get();
    if (!snap.exists) return { consecutiveFailures: 0, firstFailureAt: null };
    const d = snap.data() || {};
    return {
      consecutiveFailures: Number(d.consecutiveFailures) || 0,
      firstFailureAt: d.firstFailureAt || null,
    };
  } catch (_e) {
    return { consecutiveFailures: 0, firstFailureAt: null };
  }
}

/**
 * Ejecuta el health check: login + logout + mide latencia.
 * @param {SapHealthDeps} deps
 * @returns {Promise<{status: string, latencyMs: number, errorMessage: string | null}>}
 */
async function doPing(deps) {
  const now = deps.now || (() => new Date());
  const start = now().getTime();
  try {
    const session = await sapLogin(deps);
    const t = now().getTime() - start;
    try {
      await sapLogout(session, deps);
    } catch (_e) {
      // logout fallo no es critico; login OK cuenta como health check pass.
    }
    return { status: 'ok', latencyMs: t, errorMessage: null };
  } catch (e) {
    return {
      status: 'error',
      latencyMs: now().getTime() - start,
      errorMessage: (e && e.message) || String(e),
    };
  }
}

/**
 * Escribe el resultado + actualiza consecutive failures.
 * @param {SapHealthDeps} deps
 * @param {{status: string, latencyMs: number, errorMessage: string | null}} result
 * @returns {Promise<any>}
 */
async function writeResult(deps, result) {
  const now = deps.now || (() => new Date());
  const nowIso = now().toISOString();
  const prev = await readPreviousState(deps);
  const payload = {
    status: result.status,
    lastCheckAt: nowIso,
    latencyMs: result.latencyMs,
    errorMessage: result.errorMessage,
    consecutiveFailures: result.status === 'ok' ? 0 : prev.consecutiveFailures + 1,
    firstFailureAt: result.status === 'ok' ? null : prev.firstFailureAt || nowIso,
  };
  await deps.fbDb.doc(HEALTH_DOC).set(payload);
  return payload;
}

/**
 * Full health check: ping + write. Retorna el payload escrito.
 * @param {SapHealthDeps} deps
 * @returns {Promise<any>}
 */
export async function runSapSlHealthCheck(deps) {
  const result = await doPing(deps);
  const payload = await writeResult(deps, result);
  if (deps.log) {
    deps.log('sapSlHealthCheck', {
      status: payload.status,
      latencyMs: payload.latencyMs,
      consecutiveFailures: payload.consecutiveFailures,
    });
  }
  return payload;
}

// Exports internos para testing.
export const _internal = { doPing, readPreviousState, writeResult };
