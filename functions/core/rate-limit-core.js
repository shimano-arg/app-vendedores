// @ts-check
/**
 * rate-limit-core (Sprint 2 MED-15 VULN-L004+L015).
 *
 * Objetivo: bloquear abuso brute force / spam en callables user-invoked.
 * Antes: `sapProxy`, `geminiOcrProxy` no tenian rate limit -> un token
 * comprometido (o VDE hostil desde DevTools) podia hacer 10.000 requests
 * en un loop, burn Gemini credit ilimitado, o lockout de SL SAP (login
 * threshold breach). Ahora Firestore counter atomico con transaction +
 * ventana fija por operacion.
 *
 * Storage: `rate_limits/{uid}` doc con shape:
 *   { <opName>: { count: int, windowStartAt: iso } }
 * Multiples ops por user comparten doc para ahorrar reads.
 *
 * Ventana fija (no sliding): reset del contador cuando expira windowMs.
 * Simpler que sliding + evitamos leer/escribir arrays de timestamps.
 * Trade-off: bursts al final de una ventana + comienzo de la proxima
 * pueden duplicar el rate real por ~1 minuto. Aceptable para MED.
 *
 * Este core NO conoce Firestore Admin SDK direct - deps.fbDb inyectado.
 * El wrapper (functions/index.js) lo llama con getFirestore() y el uid
 * del request.auth.
 */

/**
 * @typedef {Object} RateLimitDeps
 * @property {any} fbDb Firestore Admin instance con .doc(), .runTransaction()
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {() => Date} [now] Inyectable para tests
 */

/**
 * @typedef {Object} RateLimitResult
 * @property {boolean} allowed  true si el request pasa el limite
 * @property {number} count      contador post-increment (o el actual si allowed=false)
 * @property {number} threshold  limite configurado
 * @property {string} resetAt    ISO timestamp del proximo reset de ventana
 */

/**
 * Chequea rate limit para uid + opName. Si allowed, incrementa el contador
 * atomicamente. Si !allowed, no incrementa (evita self-DoS).
 *
 * @param {RateLimitDeps} deps
 * @param {string} uid
 * @param {string} opName  Ej: 'sapProxy', 'geminiOcrProxy', 'pedidoCreate'
 * @param {number} threshold  Requests permitidos por ventana
 * @param {number} windowMs   Duracion de la ventana en ms
 * @returns {Promise<RateLimitResult>}
 */
export async function checkAndIncrementRateLimit(deps, uid, opName, threshold, windowMs) {
  if (!uid) throw new Error('rate-limit: uid requerido');
  if (!opName) throw new Error('rate-limit: opName requerido');
  const now = deps.now ? deps.now() : new Date();
  const nowMs = now.getTime();
  const ref = deps.fbDb.collection('rate_limits').doc(uid);
  return await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const op = data[opName] || {};
    const windowStartMs = op.windowStartAt ? new Date(op.windowStartAt).getTime() : 0;
    const inWindow = windowStartMs && nowMs - windowStartMs < windowMs;
    const currentCount = inWindow ? op.count || 0 : 0;
    const nextResetMs = inWindow ? windowStartMs + windowMs : nowMs + windowMs;
    if (currentCount >= threshold) {
      if (deps.log) {
        deps.log('rate-limit HIT', { uid, opName, count: currentCount, threshold });
      }
      return {
        allowed: false,
        count: currentCount,
        threshold,
        resetAt: new Date(nextResetMs).toISOString(),
      };
    }
    const nextCount = currentCount + 1;
    const nextWindowStartAt = inWindow ? op.windowStartAt : now.toISOString();
    tx.set(
      ref,
      {
        [opName]: {
          count: nextCount,
          windowStartAt: nextWindowStartAt,
        },
        updatedAt: now.toISOString(),
      },
      { merge: true }
    );
    return {
      allowed: true,
      count: nextCount,
      threshold,
      resetAt: new Date(nextResetMs).toISOString(),
    };
  });
}

/**
 * Config defaults por operacion.
 *
 * v940 (2026-09-15) HOTFIX: sapProxy 300 -> 5000/hr. El threshold original
 * asumia "~50 calls/dia por VDE" pero no consideraba el factor de
 * amplificacion del flow service_layer_auto: cada pedido enviado a SAP
 * dispara SL Login + N calls por linea + SL Logout via sapProxy. Un VDE
 * mandando 5-10 pedidos batch pega 300/hr en minutos. Reporte 2026-09-15
 * ~13:02 ART: mariano.erbino + pablo.gonzalez bloqueados con
 * "resource-exhausted" en el envio de pedidos. Bump a 5000/hr (17x) mantiene
 * defensa contra abuse real (>1.4 req/seg sostenido) sin molestar al uso
 * legitimo. Si vuelve a pegar, reveer si conviene excluir cuentas "auto/*"
 * del rate limit (backend flow, no superficie brute-force).
 */
export const RATE_LIMITS = /** @type {const} */ ({
  sapProxy: { threshold: 5000, windowMs: 60 * 60 * 1000 }, // 5000/hr (v940 hotfix)
  geminiOcrProxy: { threshold: 100, windowMs: 60 * 60 * 1000 }, // 100/hr
});
