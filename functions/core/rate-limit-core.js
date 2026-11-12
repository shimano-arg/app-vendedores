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
  // v990 (2026-09-18, SecAudit run-1 CRITICAL #1): sin rate limit previo, un
  // @shimano hostil podia spamear recycle/reject en un loop contra pedidos
  // ajenos - DoS + corrupcion de qtyRecycled/qtyCancelled + auto-close
  // (closedAt) de pedidos victima. 500/hr = ~1 accion cada 7s sostenido:
  // suficiente para el uso legitimo de admin resolviendo waitlist post-stock
  // change pero corta abuse loop en <2 min.
  updateAsigLineState: { threshold: 500, windowMs: 60 * 60 * 1000 },
  // v1174 (audit 2026-10-07, Security H-02/H-03):
  // setupGetMovimientos: integra con SETUP WMS externo (API quota compartida
  // con BI). Un VDE comprometido podia extraer 365 dias de logistics
  // cross-cartera. 50/hr es ~1 req/min — margen para uso legitimo + corta
  // scraping sostenido.
  setupGetMovimientos: { threshold: 50, windowMs: 60 * 60 * 1000 },
  // triggerPlannerSync hace 4 SAP SL sync passes (login+logout c/u). Un
  // admin/gerente comprometido podia spamear → degradar SL concurrent
  // sessions para toda la org. 20/hr = refresco cada 3 min max.
  triggerPlannerSync: { threshold: 20, windowMs: 60 * 60 * 1000 },
  // triggerRendicionesEmailManual dispara GitHub Actions workflow dispatch
  // (consume minutos CI + envia email a equipo). 5/hr es generoso para el
  // uso real (max 1-2 veces por semana en operacion normal).
  triggerRendicionesEmailManual: { threshold: 5, windowMs: 60 * 60 * 1000 },
  // S04b PR-A (2026-11-04): gates de verificacion de credenciales. Umbral
  // chico por ventana corta + lockout con backoff (ver checkAuthGateRateLimit).
  // Fuerza bruta de password/TOTP se corta con el lockout, no solo la ventana.
  verifyPasswordGate: { threshold: 5, windowMs: 60 * 1000 }, // 5/min
  verifyTotpGate: { threshold: 5, windowMs: 60 * 1000 }, // 5/min
  // S04b M2 (2026-11-04): rate-limit de los SETTERS (ventana fija SIN lockout,
  // via checkAndIncrementRateLimit; no usar el backoff de los gates para no
  // bloquear operaciones admin criticas — la recuperacion es automatica al
  // vencer la ventana). Valores aprobados por el responsable.
  setPasswordGate: { threshold: 20, windowMs: 60 * 60 * 1000 }, // 20/hr (scrypt costoso)
  authSecretAdminOp: { threshold: 60, windowMs: 60 * 60 * 1000 }, // 60/hr (setTotp + disableTotp)
});

/**
 * S04b PR-A (2026-11-04): escalones de backoff para lockout de gates de auth.
 * failStreak (fallos consecutivos) -> ms de bloqueo. Valores DEFINITIVOS
 * SUJETOS A APROBACION del responsable. El lockout vive en el mismo doc
 * rate_limits/{uid} bajo `<opName>.lockedUntil` + `<opName>.failStreak`.
 */
export const AUTH_GATE_BACKOFF_STEPS = /** @type {const} */ ([
  { atStreak: 5, lockMs: 60 * 1000 }, // 5 fallos -> 1 min
  { atStreak: 10, lockMs: 5 * 60 * 1000 }, // 10 -> 5 min
  { atStreak: 15, lockMs: 30 * 60 * 1000 }, // 15 -> 30 min
  { atStreak: 20, lockMs: 24 * 60 * 60 * 1000 }, // 20 -> 24 h
]);

/**
 * Devuelve el lockMs correspondiente al failStreak (el escalon mas alto
 * alcanzado), o 0 si no llega al primer escalon.
 * @param {number} failStreak
 * @returns {number}
 */
export function backoffForStreak(failStreak) {
  let lockMs = 0;
  for (const step of AUTH_GATE_BACKOFF_STEPS) {
    if (failStreak >= step.atStreak) lockMs = step.lockMs;
  }
  return lockMs;
}

/**
 * S04b PR-A: rate-limit + lockout con backoff para gates de credenciales.
 * NO reemplaza a checkAndIncrementRateLimit (los consumidores existentes no se
 * tocan). Este es un mecanismo aparte que ademas de la ventana mantiene
 * `lockedUntil` + `failStreak` por op en rate_limits/{uid}.
 *
 * Flujo:
 *  - Si ahora < lockedUntil -> { allowed:false, locked:true, resetAt }.
 *  - Si no, chequea la ventana fija (igual que checkAndIncrementRateLimit).
 *  - Incrementa el contador de la ventana solo si allowed.
 * El resultado de la VERIFICACION (ok/fallo) se registra aparte con
 * registerAuthGateOutcome (abajo), que ajusta failStreak/lockedUntil.
 *
 * @param {import('./rate-limit-core.js').RateLimitDeps | any} deps
 * @param {string} uid
 * @param {string} opName  'verifyPasswordGate' | 'verifyTotpGate'
 * @param {number} threshold
 * @param {number} windowMs
 * @returns {Promise<{allowed: boolean, locked: boolean, count: number, threshold: number, resetAt: string}>}
 */
export async function checkAuthGateRateLimit(deps, uid, opName, threshold, windowMs) {
  if (!uid) throw new Error('auth-gate rate-limit: uid requerido');
  if (!opName) throw new Error('auth-gate rate-limit: opName requerido');
  const now = deps.now ? deps.now() : new Date();
  const nowMs = now.getTime();
  const ref = deps.fbDb.collection('rate_limits').doc(uid);
  return await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const op = data[opName] || {};
    const lockedUntilMs = op.lockedUntil ? new Date(op.lockedUntil).getTime() : 0;
    if (lockedUntilMs && nowMs < lockedUntilMs) {
      return {
        allowed: false,
        locked: true,
        count: op.count || 0,
        threshold,
        resetAt: new Date(lockedUntilMs).toISOString(),
      };
    }
    const windowStartMs = op.windowStartAt ? new Date(op.windowStartAt).getTime() : 0;
    const inWindow = windowStartMs && nowMs - windowStartMs < windowMs;
    const currentCount = inWindow ? op.count || 0 : 0;
    const nextResetMs = inWindow ? windowStartMs + windowMs : nowMs + windowMs;
    if (currentCount >= threshold) {
      return {
        allowed: false,
        locked: false,
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
        [opName]: Object.assign({}, op, {
          count: nextCount,
          windowStartAt: nextWindowStartAt,
        }),
        updatedAt: now.toISOString(),
      },
      { merge: true }
    );
    return {
      allowed: true,
      locked: false,
      count: nextCount,
      threshold,
      resetAt: new Date(nextResetMs).toISOString(),
    };
  });
}

/**
 * S04b PR-A: registra el resultado de una verificacion de credencial para
 * ajustar failStreak + lockedUntil (backoff). Exito resetea el streak; fallo
 * lo incrementa y setea lockedUntil si cruza un escalon. Transaccional.
 *
 * @param {any} deps
 * @param {string} uid
 * @param {string} opName
 * @param {boolean} success
 * @returns {Promise<{failStreak: number, lockedUntil: string|null}>}
 */
export async function registerAuthGateOutcome(deps, uid, opName, success) {
  if (!uid || !opName) throw new Error('registerAuthGateOutcome: uid/opName requerido');
  const now = deps.now ? deps.now() : new Date();
  const nowMs = now.getTime();
  const ref = deps.fbDb.collection('rate_limits').doc(uid);
  return await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const op = data[opName] || {};
    let failStreak = typeof op.failStreak === 'number' ? op.failStreak : 0;
    let lockedUntil = null;
    if (success) {
      failStreak = 0;
    } else {
      failStreak += 1;
      const lockMs = backoffForStreak(failStreak);
      if (lockMs > 0) lockedUntil = new Date(nowMs + lockMs).toISOString();
    }
    tx.set(
      ref,
      {
        [opName]: Object.assign({}, op, {
          failStreak,
          lockedUntil: lockedUntil || op.lockedUntil || null,
        }),
        updatedAt: now.toISOString(),
      },
      { merge: true }
    );
    return { failStreak, lockedUntil };
  });
}

/**
 * D8 Tarea 65: motivos de verificacion que SI cuentan como intento de
 * credencial fallido (suman failStreak y pueden bloquear). Solo 'invalid':
 * la credencial se comparo contra un secreto existente y no coincidio.
 *
 * NO cuentan (no se registra nada, ni suma ni resetea):
 *  - no_secret / no_password / no_totp: la cuenta todavia no tiene el
 *    secreto migrado. Contarlos bloqueaba a usuarios con la credencial
 *    CORRECTA y el bloqueo sobrevivia al backfill (bug D8 no_secret).
 *  - incomplete / unknown_version: dato de migracion roto o desconocido; es
 *    un problema nuestro, no un intento de adivinar.
 *  - empty / format: entrada vacia o que no tiene forma de credencial. Nunca
 *    puede autenticar, asi que no aporta a un ataque de fuerza bruta; sigue
 *    consumiendo la ventana 5/min de checkAuthGateRateLimit.
 *  - cualquier reason futuro o desconocido: conservador para el usuario,
 *    SIN ser permisivo (nunca se trata como exito).
 * Los errores tecnicos (TransientAuthError) no llegan aca: el wrapper los
 * convierte en 'unavailable' antes de registrar nada.
 */
export const AUTH_GATE_COUNTED_FAILURE_REASONS = Object.freeze(['invalid']);

/**
 * Clasifica el resultado de verifyPasswordCore / verifyTotpCore.
 *  - 'success': ok === true (estricto) y sin reason 'invalid'.
 *  - 'failure': reason contable (AUTH_GATE_COUNTED_FAILURE_REASONS).
 *  - 'not_counted': cualquier otro caso, incluidos resultados malformados.
 * Un resultado malformado jamas es 'success'.
 * @param {{ok?: unknown, reason?: unknown} | null | undefined} r
 * @returns {'success' | 'failure' | 'not_counted'}
 */
export function classifyAuthGateResult(r) {
  if (!r || typeof r !== 'object') return 'not_counted';
  if (typeof r.reason === 'string' && AUTH_GATE_COUNTED_FAILURE_REASONS.includes(r.reason)) {
    return 'failure';
  }
  if (r.ok === true) return 'success';
  return 'not_counted';
}

/**
 * Unica via para registrar el resultado de un gate de credenciales.
 * success -> registerAuthGateOutcome(true) (resetea failStreak, igual que antes).
 * failure -> registerAuthGateOutcome(false) (suma failStreak + backoff, igual que antes).
 * not_counted -> NO escribe rate_limits.
 * @param {any} deps
 * @param {string} uid
 * @param {string} opName
 * @param {{ok?: unknown, reason?: unknown} | null | undefined} r
 * @returns {Promise<{outcome: 'success'|'failure'|'not_counted', recorded: boolean, failStreak?: number, lockedUntil?: string|null}>}
 */
export async function recordAuthGateResult(deps, uid, opName, r) {
  const outcome = classifyAuthGateResult(r);
  if (outcome === 'not_counted') return { outcome, recorded: false };
  const res = await registerAuthGateOutcome(deps, uid, opName, outcome === 'success');
  return { outcome, recorded: true, failStreak: res.failStreak, lockedUntil: res.lockedUntil };
}
