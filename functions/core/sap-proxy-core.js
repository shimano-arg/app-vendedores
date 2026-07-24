// @ts-check
/**
 * sapProxy core logic (Fase 0 E5).
 *
 * Diseño: separado del wrapper Cloud Functions para poder testear con
 * mocks (fetch + roles lookup) sin arrancar emulator. functions/index.js
 * lo envuelve y le plumbea auth + secret desde el request real.
 *
 * Flow por request:
 *   1. Auth check: request.auth.uid debe existir.
 *   2. Role check: {admin, gerente} para escrituras; {admin, gerente,
 *      vendedor, interno} para lecturas GET /Items /BusinessPartners.
 *   3. Sanitize endpoint: whitelist `/b1s/v1/...` para evitar SSRF.
 *   4. Login SL server-side con creds del secret.
 *   5. Forward call con cookies.
 *   6. Logout (best-effort, no bloquea).
 *   7. Devuelve { status, body } al cliente sin exponer credenciales.
 *
 * NUNCA loguea la password ni el body de Login. Loguea endpoint, status
 * y user uid para auditoría en Cloud Logging.
 */

const ALLOWED_ROLES_WRITE = /** @type {const} */ (['admin', 'gerente']);
const ALLOWED_ROLES_READ = /** @type {const} */ (['admin', 'gerente', 'vendedor', 'interno']);
const ENDPOINT_PREFIX = '/b1s/v1/';

/**
 * @typedef {Object} SapProxyRequest
 * @property {string} endpoint Ej: '/b1s/v1/Items?$select=ItemCode' o '/b1s/v1/Quotations'.
 * @property {'GET'|'POST'|'PATCH'|'DELETE'} [method] Default GET.
 * @property {unknown} [body] Body para POST/PATCH. Se JSON.stringify.
 *
 * @typedef {Object} SapProxyAuth
 * @property {string} uid
 *
 * @typedef {Object} SapProxyDeps
 * @property {(uid: string) => Promise<string | null>} getUserRole Lookup del rol del user.
 * @property {(url: string, init?: RequestInit) => Promise<Response>} fetch Fetch impl (mockeable).
 * @property {{ url: string, companyDB: string, userName: string, password: string }} sapConfig
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log] Logger inyectable.
 *
 * @typedef {Object} SapProxyResponse
 * @property {number} status HTTP status del SL relay.
 * @property {unknown} body Body parseado (JSON o string).
 *
 * @typedef {Object} HttpsErrorLike
 * @property {'unauthenticated'|'permission-denied'|'invalid-argument'|'internal'|'unavailable'} code
 * @property {string} message
 */

/** @param {'unauthenticated'|'permission-denied'|'invalid-argument'|'internal'|'unavailable'} code
 *  @param {string} message
 *  @returns {HttpsErrorLike} */
export function makeHttpsError(code, message) { return { code, message }; }

/**
 * Determina si un endpoint es de lectura (GET a colecciones seguras).
 * @param {string} method
 * @param {string} endpoint
 */
function isReadOnly(method, endpoint) {
  if (method !== 'GET') return false;
  const readableCollections = ['Items', 'BusinessPartners', 'Warehouses', 'SalesPersons', 'Inventory'];
  return readableCollections.some(c => endpoint.includes(`/b1s/v1/${c}`));
}

/**
 * Extrae Cookie header de un Set-Cookie multi-valor. SL responde con
 * B1SESSION y ROUTEID; ambos se necesitan para calls subsiguientes.
 * @param {string | null | undefined} setCookieHeader
 * @returns {string}
 */
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

/**
 * @param {SapProxyRequest} data
 * @param {SapProxyAuth | null | undefined} auth
 * @param {SapProxyDeps} deps
 * @returns {Promise<SapProxyResponse>}
 * @throws {HttpsErrorLike}
 */
export async function handleSapProxy(data, auth, deps) {
  const log = deps.log || (() => {});

  if (!auth || !auth.uid) {
    throw makeHttpsError('unauthenticated', 'Debe iniciar sesión.');
  }

  const role = await deps.getUserRole(auth.uid);
  if (!role) {
    throw makeHttpsError('permission-denied', 'Usuario sin rol asignado.');
  }

  if (!data || typeof data.endpoint !== 'string') {
    throw makeHttpsError('invalid-argument', 'Falta `endpoint`.');
  }
  if (!data.endpoint.startsWith(ENDPOINT_PREFIX)) {
    throw makeHttpsError('invalid-argument', `endpoint debe empezar con ${ENDPOINT_PREFIX}`);
  }
  const method = data.method || 'GET';
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    throw makeHttpsError('invalid-argument', 'method inválido.');
  }

  const roleWhitelist = isReadOnly(method, data.endpoint) ? ALLOWED_ROLES_READ : ALLOWED_ROLES_WRITE;
  if (!(/** @type {readonly string[]} */ (roleWhitelist)).includes(role)) {
    log('sapProxy denied by role', { uid: auth.uid, role, method, endpoint: data.endpoint });
    throw makeHttpsError('permission-denied', `Rol ${role} no autorizado para ${method} ${data.endpoint}`);
  }

  const { url, companyDB, userName, password } = deps.sapConfig;
  if (!url || !companyDB || !userName || !password) {
    throw makeHttpsError('internal', 'sapConfig incompleto.');
  }

  const loginRes = await deps.fetch(`${url}/b1s/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
  });
  if (!loginRes.ok) {
    log('sapProxy SL login failed', { uid: auth.uid, status: loginRes.status });
    throw makeHttpsError('unavailable', `SL login falló status=${loginRes.status}`);
  }
  const cookie = extractSessionCookies(loginRes.headers.get('set-cookie'));
  if (!cookie) {
    throw makeHttpsError('unavailable', 'SL no devolvió cookies de sesión.');
  }

  /** @type {RequestInit} */
  const proxyInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
  };
  if (data.body !== undefined && method !== 'GET' && method !== 'DELETE') {
    proxyInit.body = JSON.stringify(data.body);
  }

  const proxyRes = await deps.fetch(`${url}${data.endpoint}`, proxyInit);
  const proxyText = await proxyRes.text();
  /** @type {unknown} */
  let proxyBody = proxyText;
  try { proxyBody = JSON.parse(proxyText); } catch { /* body no-json, dejamos texto */ }

  // Logout best-effort. Errores acá no rompen la response al cliente.
  try {
    await deps.fetch(`${url}/b1s/v1/Logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
  } catch (e) {
    log('sapProxy SL logout swallowed', { err: String(e) });
  }

  log('sapProxy OK', { uid: auth.uid, role, method, endpoint: data.endpoint, status: proxyRes.status });
  return { status: proxyRes.status, body: proxyBody };
}
