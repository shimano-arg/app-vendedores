// @ts-check
/**
 * §63 Fase 3 Capa 1 (2026-10-23 v1444) — Session pool SAP Service Layer.
 *
 * Objetivo: compartir sesiones SL vivas entre CFs del mismo container para
 * evitar login/logout por cada operación. SL impone cupo de sesiones
 * concurrentes (observado: 5); con pool default N=2 el riesgo es bajo.
 *
 * Semántica:
 *   - acquire(): devuelve una cookie B1SESSION reciclable. Si no hay sesiones
 *     libres y hay cupo → crea nueva. Si llegó al cupo → await la primera que
 *     libere (mutex).
 *   - release(cookie, ok): devuelve la sesión al pool. Si ok=false (401/400),
 *     la descarta y la próxima acquire creará nueva.
 *   - El pool vive en globalThis.__sapSlPool para compartirse entre CFs del
 *     mismo container. Firebase Functions Gen 2 recicla containers; el pool
 *     se re-crea en cold start. Best-effort.
 *
 * TTL: cookies B1SESSION tienen IdleTimeout en SL (default 30min). Expiramos
 * en memoria a 25min para dejar margen. Si llegan 401 Unauthorized se descartan.
 */

const DEFAULT_POOL_SIZE = Number(process.env.SL_SESSION_POOL_SIZE || 2);
const COOKIE_TTL_MS = 25 * 60 * 1000;

function getPool() {
  if (!(/** @type {any} */ (globalThis).__sapSlPool)) {
    /** @type {any} */ (globalThis).__sapSlPool = {
      sessions: [],
      waiting: [],
      poolSize: DEFAULT_POOL_SIZE,
    };
  }
  return /** @type {any} */ (globalThis).__sapSlPool;
}

/** @typedef {{cookie: string, createdAt: number, inUse: boolean}} SlSession */

/**
 * Login puro al SL. No usa el pool; devuelve cookie B1SESSION cruda.
 * @param {{url: string, companyDB: string, userName: string, password: string, fetch?: typeof fetch}} cfg
 * @returns {Promise<string>}
 */
export async function slLoginRaw(cfg) {
  const fetchFn = cfg.fetch || globalThis.fetch;
  const resp = await fetchFn(`${cfg.url}/b1s/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName: cfg.userName,
      Password: cfg.password,
      CompanyDB: cfg.companyDB,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`SL login failed HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const setCookie = resp.headers.get('set-cookie') || '';
  const m = setCookie.match(/B1SESSION=([^;]+)/i);
  if (!m) {
    throw new Error('SL login OK but no B1SESSION cookie in response');
  }
  return m[1];
}

/**
 * Logout puro. Best-effort.
 * @param {{url: string, fetch?: typeof fetch}} cfg
 * @param {string} cookie
 */
export async function slLogoutRaw(cfg, cookie) {
  const fetchFn = cfg.fetch || globalThis.fetch;
  try {
    await fetchFn(`${cfg.url}/b1s/v1/Logout`, {
      method: 'POST',
      headers: { Cookie: `B1SESSION=${cookie}` },
    });
  } catch (_e) {
    // best-effort
  }
}

/**
 * Toma una sesión del pool o crea nueva.
 * @param {{url: string, companyDB: string, userName: string, password: string, fetch?: typeof fetch}} cfg
 * @returns {Promise<SlSession>}
 */
export async function acquireSession(cfg) {
  const pool = getPool();
  const now = Date.now();
  // Buscar sesión libre y no expirada.
  for (const s of pool.sessions) {
    if (!s.inUse && now - s.createdAt < COOKIE_TTL_MS) {
      s.inUse = true;
      return s;
    }
  }
  // Expirar las vencidas.
  pool.sessions = pool.sessions.filter(
    (/** @type {SlSession} */ s) => s.inUse || now - s.createdAt < COOKIE_TTL_MS
  );
  // Si cupo disponible, crear nueva.
  if (pool.sessions.length < pool.poolSize) {
    const cookie = await slLoginRaw(cfg);
    const sess = { cookie, createdAt: Date.now(), inUse: true };
    pool.sessions.push(sess);
    return sess;
  }
  // Cupo full → esperar que alguien libere (mutex via Promise).
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = pool.waiting.indexOf(waitEntry);
      if (idx >= 0) pool.waiting.splice(idx, 1);
      reject(new Error('acquireSession timeout: pool full y no se liberó en 10s'));
    }, 10000);
    const waitEntry = { resolve, reject, timer, cfg };
    pool.waiting.push(waitEntry);
  });
}

/**
 * Devuelve una sesión al pool. Si ok=false, se descarta.
 * @param {SlSession} session
 * @param {boolean} ok
 */
export function releaseSession(session, ok = true) {
  const pool = getPool();
  session.inUse = false;
  if (!ok) {
    // Descartar: 401 significa que SL invalidó la cookie.
    pool.sessions = pool.sessions.filter((/** @type {SlSession} */ s) => s !== session);
  }
  // Hay waiters? resolver al próximo con una nueva o reusando esta.
  const waiter = pool.waiting.shift();
  if (waiter) {
    clearTimeout(waiter.timer);
    if (ok && session.inUse === false) {
      // Reasignar esta sesión al waiter.
      session.inUse = true;
      waiter.resolve(session);
    } else {
      // La sesión se descartó: el waiter tendrá que crear una nueva.
      acquireSession(waiter.cfg).then(waiter.resolve, waiter.reject);
    }
  }
}

/**
 * Helper: ejecuta `fn(cookie)` con una sesión del pool, maneja 401
 * (re-login) + release automático. Para operaciones de 1 shot.
 * @param {{url: string, companyDB: string, userName: string, password: string, fetch?: typeof fetch}} cfg
 * @param {(cookie: string) => Promise<any>} fn
 */
export async function withSession(cfg, fn) {
  const sess = await acquireSession(cfg);
  try {
    const r = await fn(sess.cookie);
    releaseSession(sess, true);
    return r;
  } catch (e) {
    const is401 = (e && (e.message || '').includes('401')) || (e && e.status === 401);
    releaseSession(sess, !is401);
    throw e;
  }
}

/** Para tests: reset del pool entre runs. */
export function _resetPool() {
  /** @type {any} */ (globalThis).__sapSlPool = undefined;
}
