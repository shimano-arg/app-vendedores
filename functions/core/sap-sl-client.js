// @ts-check
/**
 * Cliente compartido SAP Service Layer para uso desde Cloud Functions.
 *
 * Extraido del pattern usado en sap-proxy-core (que sigue intacto para
 * no romper sus 25 tests). Este cliente NO valida roles ni auth — asume
 * que el caller es una Cloud Function autorizada (scheduled o admin).
 *
 * Uso tipico:
 *   const session = await sapLogin(deps);
 *   try {
 *     const invoices = await sapGet(session, '/b1s/v1/Invoices?...', deps);
 *   } finally {
 *     await sapLogout(session, deps);
 *   }
 *
 * @typedef {Object} SapSlDeps
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 *
 * @typedef {Object} SapSession
 * @property {string} cookie
 */

/** @type {(setCookieHeader: string | null | undefined) => string} */
export function extractSessionCookies(setCookieHeader) {
  if (!setCookieHeader) return '';
  const parts = setCookieHeader.split(/,\s*(?=[A-Z])/);
  const wanted = [];
  for (const p of parts) {
    const m = p.match(/(B1SESSION|ROUTEID)=([^;]+)/);
    if (m) wanted.push(`${m[1]}=${m[2]}`);
  }
  return wanted.join('; ');
}

// v1172 (audit 2026-10-07, Backend C2): timeout por request para evitar
// que un POST a SL quede colgado hasta que el runtime mate la CF (120s).
// Precedente FATECHI: POST timeout "fetch failed" en CF, SAP si creo la SQ
// pero el runtime murio sin saberlo → segundo intento creo SQ duplicada.
// 90s < 120s (CF timeout) para que el AbortController dispare antes y la
// CF pueda limpiar estado + marcar needsManualVerification.
const SAP_REQUEST_TIMEOUT_MS = 90_000;

/** @returns {AbortSignal | undefined} */
function makeTimeoutSignal() {
  // AbortSignal.timeout es ES2022, disponible en Node 22. Fallback por si
  // el runtime no lo tiene (tests con mocks viejos).
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(SAP_REQUEST_TIMEOUT_MS);
  }
  return undefined;
}

/**
 * @param {SapSlDeps} deps
 * @returns {Promise<SapSession>}
 */
export async function sapLogin(deps) {
  const { url, companyDB, userName, password } = deps.sapConfig;
  if (!url || !companyDB || !userName || !password) {
    throw new Error('sapConfig incompleto');
  }
  const res = await deps.fetch(`${url}/b1s/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
    signal: makeTimeoutSignal(),
  });
  if (!res.ok) {
    throw new Error(`SL login failed status=${res.status}`);
  }
  const cookie = extractSessionCookies(res.headers.get('set-cookie'));
  if (!cookie) throw new Error('SL no devolvio cookies de sesion');
  return { cookie };
}

/**
 * @param {SapSession} session
 * @param {string} endpoint absoluto empezando con /b1s/v1/
 * @param {SapSlDeps} deps
 * @returns {Promise<{status: number, body: any}>}
 */
export async function sapGet(session, endpoint, deps) {
  const res = await deps.fetch(`${deps.sapConfig.url}${endpoint}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    signal: makeTimeoutSignal(),
  });
  const text = await res.text();
  /** @type {any} */
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* body no-json */
  }
  return { status: res.status, body };
}

/**
 * POST a un endpoint SL con body JSON. Usado por auto-send-sap-core para
 * enviar Sales Quotations (POST /b1s/v1/Quotations).
 *
 * @param {SapSession} session
 * @param {string} endpoint absoluto empezando con /b1s/v1/
 * @param {any} bodyObj payload a serializar como JSON
 * @param {SapSlDeps} deps
 * @returns {Promise<{status: number, body: any, headers: Headers}>}
 */
export async function sapPost(session, endpoint, bodyObj, deps) {
  const res = await deps.fetch(`${deps.sapConfig.url}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify(bodyObj),
    signal: makeTimeoutSignal(),
  });
  const text = await res.text();
  /** @type {any} */
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* body no-json */
  }
  return { status: res.status, body, headers: res.headers };
}

/**
 * Logout best-effort. Errores se loguean pero no se propagan.
 * @param {SapSession} session
 * @param {SapSlDeps} deps
 */
export async function sapLogout(session, deps) {
  try {
    await deps.fetch(`${deps.sapConfig.url}/b1s/v1/Logout`, {
      method: 'POST',
      headers: { Cookie: session.cookie },
    });
  } catch (e) {
    if (deps.log) deps.log('sapLogout swallowed', { err: String(e) });
  }
}
