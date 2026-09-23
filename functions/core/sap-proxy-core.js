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
const ENDPOINT_PREFIX = '/b1s/v1/';

// v935 (2026-09-14, SecAudit Sprint 2 MED-02 VULN-005): SAP host allowlist.
// Antes: deps.sapConfig.url venia de app_config/sap_integration (Firestore).
// Un admin con acceso a Firestore Console podia rewrite serviceLayer.url a
// un host controlado por el atacante -> CF POSTeaba CompanyDB+UserName+Password
// (del Secret Manager) al host malicioso en cada request. Firestore-console
// access se convertia en secret-exfiltration a un dominio arbitrario.
// Ahora: hardcoded en el codigo. Bumpearlo requiere PR + review.
const ALLOWED_SAP_HOSTS = /** @type {const} */ (['shimano-sap.seidor.com.ar']);

// v917 (2026-09-14, SecAudit Sprint 0 CRIT-02): whitelist explicita por
// (method, resource). Antes: solo `startsWith('/b1s/v1/')` + `includes('/Items')`
// — un admin comprometido podia POST /b1s/v1/Invoices (facturacion directa
// bypasseando SO/SQ approval) o DELETE cualquier cosa. Ahora los reads y writes
// listan explicitamente que resources SAP se permiten desde el cliente.
// Los CFs backend (auto-send-sap-core, invoice-sync-core) NO pasan por este
// core — hablan directo con SL via sap-sl-client, con su propia validacion.
//
// v935 (SecAudit Sprint 2 MED-06 VULN-209): read scoping per role. Antes:
// ALLOWED_ROLES_READ compartia el mismo whitelist entre admin/gerente/vendedor/
// interno - un VDE podia GET /BusinessPartners?$select=CreditLine para pull
// entero de credit limits + discount rates de toda la BP DB (exfil de datos
// comerciales confidenciales). Ahora vendedor/interno tienen un allowlist
// mas chico (solo lo que usan de verdad desde el cliente); BusinessPartners
// queda admin/gerente only. Los VDE consumen BP data desde sap_clients
// snapshot en Firestore, no directo via sapProxy.
/** @type {Readonly<Record<string, readonly string[]>>} */
const READ_ALLOWED_PER_ROLE = /** @type {const} */ ({
  admin: [
    'Items',
    'ItemWarehouseInfoCollection',
    'SQLQueries',
    'BusinessPartners',
    'Warehouses',
    'SalesPersons',
    'Inventory',
    'Quotations',
    'Orders',
    // v1044 (2026-09-23): agregado Invoices para diagnóstico de orphans del CF
    // syncSapInvoicesToApp (leer DocumentLines + BaseType/BaseEntry lineage).
    // READ-only, sin risk de write. Mismo pattern que Quotations/Orders.
    'Invoices',
  ],
  gerente: [
    'Items',
    'ItemWarehouseInfoCollection',
    'SQLQueries',
    'BusinessPartners',
    'Warehouses',
    'SalesPersons',
    'Inventory',
    'Quotations',
    'Orders',
    'Invoices',
  ],
  vendedor: [
    // VDE consume BP data desde sap_clients Firestore snapshot, no via sapProxy.
    'Items',
    'ItemWarehouseInfoCollection',
    'SQLQueries',
    'Warehouses',
  ],
  interno: [
    // VDI necesita ver Quotations/Orders para troubleshoot ASIG/BO flows.
    'Items',
    'ItemWarehouseInfoCollection',
    'SQLQueries',
    'Warehouses',
    'Quotations',
    'Orders',
  ],
});
/** @type {Readonly<Record<string, readonly string[]>>} */
const WRITE_ALLOWED = /** @type {const} */ ({
  POST: ['Quotations'], // incluye POST /Quotations({id})/Cancel (mismo resource extraido)
  PATCH: ['Quotations'],
  DELETE: [], // nunca directo — usar POST /Quotations({id})/Cancel para SQ
});

/**
 * Extrae el nombre del recurso raiz de un endpoint SL.
 * `/b1s/v1/Quotations` -> 'Quotations'
 * `/b1s/v1/Quotations(1)` -> 'Quotations'
 * `/b1s/v1/Quotations(1)/Cancel` -> 'Quotations'
 * `/b1s/v1/Items?$select=X` -> 'Items'
 * `/b1s/v1/foo` -> null (case-sensitive — SL usa PascalCase)
 * @param {string} endpoint
 * @returns {string | null}
 */
export function extractResource(endpoint) {
  const m = endpoint.match(/^\/b1s\/v1\/([A-Z][A-Za-z0-9_]*)(\(|\?|\/|$)/);
  return m ? m[1] : null;
}

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
 * @property {'unauthenticated'|'permission-denied'|'invalid-argument'|'internal'|'unavailable'|'failed-precondition'} code
 * @property {string} message
 */

/** @param {'unauthenticated'|'permission-denied'|'invalid-argument'|'internal'|'unavailable'|'failed-precondition'} code
 *  @param {string} message
 *  @returns {HttpsErrorLike} */
export function makeHttpsError(code, message) {
  return { code, message };
}

/**
 * v917 (Sprint 0 CRIT-02) + v935 (Sprint 2 MED-06): whitelist read/write
 * per (method, resource, role). El write whitelist es rol-agnostico porque
 * el rol se checkea aparte (admin/gerente only). El read whitelist varia
 * por rol - vendor/interno no pueden GET BusinessPartners.
 * @param {string} method
 * @param {string} resource
 * @param {string} role
 * @returns {'read' | 'write' | 'denied'}
 */
export function classifyRequest(method, resource, role) {
  if (method === 'GET') {
    const allowedForRole = READ_ALLOWED_PER_ROLE[role] || [];
    return allowedForRole.includes(resource) ? 'read' : 'denied';
  }
  const allowedForMethod = WRITE_ALLOWED[method] || [];
  return allowedForMethod.includes(resource) ? 'write' : 'denied';
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
  // v917 (Sprint 0 CRIT-02 + MED-01): bloquear path traversal + URL smuggling.
  // Un endpoint como '/b1s/v1/Items/../../b1s/v1/Invoices' antes pasaba el
  // check startsWith + includes('/Items'), permitiendo POST a Invoices via
  // resolucion server-side. Fix: rechazar `..` y `//` en cualquier parte.
  if (data.endpoint.includes('..') || data.endpoint.includes('//')) {
    log('sapProxy denied by traversal', { uid: auth.uid, endpoint: data.endpoint });
    throw makeHttpsError('invalid-argument', 'endpoint inválido (path traversal).');
  }
  const method = data.method || 'GET';
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    throw makeHttpsError('invalid-argument', 'method inválido.');
  }
  // v917 (Sprint 0 CRIT-02): whitelist (method, resource). Antes CUALQUIER
  // /b1s/v1/* con method != GET era aceptado si el rol era admin/gerente —
  // admin comprometido podia POST /Invoices, DELETE /Items, PATCH /BP.
  // Ahora los resources permitidos son explicitos por metodo.
  const resource = extractResource(data.endpoint);
  if (!resource) {
    log('sapProxy denied by resource shape', { uid: auth.uid, endpoint: data.endpoint });
    throw makeHttpsError(
      'invalid-argument',
      'endpoint no matchea /b1s/v1/<Resource> (case-sensitive, PascalCase).'
    );
  }
  // v935 (Sprint 2 MED-06): classify pasa el rol para que el whitelist
  // de lecturas sea distinto por rol (VDE no puede GET BusinessPartners).
  const kind = classifyRequest(method, resource, role);
  if (kind === 'denied') {
    log('sapProxy denied by whitelist', {
      uid: auth.uid,
      role,
      method,
      resource,
      endpoint: data.endpoint,
    });
    throw makeHttpsError(
      'permission-denied',
      `${method} /b1s/v1/${resource} no está en la whitelist sapProxy para rol ${role}.`
    );
  }

  // El write whitelist es rol-agnostico porque el classify no considera
  // rol para writes. Aca chequeamos que el rol tenga permiso de escritura.
  if (kind === 'write') {
    if (!(/** @type {readonly string[]} */ (ALLOWED_ROLES_WRITE).includes(role))) {
      log('sapProxy denied by write role', {
        uid: auth.uid,
        role,
        method,
        endpoint: data.endpoint,
      });
      throw makeHttpsError('permission-denied', `Rol ${role} no autorizado para escrituras SL`);
    }
  }

  const { url, companyDB, userName, password } = deps.sapConfig;
  if (!url || !companyDB || !userName || !password) {
    throw makeHttpsError('internal', 'sapConfig incompleto.');
  }

  // v935 (Sprint 2 MED-02 VULN-005): host allowlist. Antes admin con Firestore
  // Console write podia redirigir la url a un host malicioso -> creds SAP
  // exfiltradas. Ahora rechazamos cualquier host no listado en el codigo.
  /** @type {URL} */
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw makeHttpsError('internal', 'sapConfig.url no es URL valida.');
  }
  if (!(/** @type {readonly string[]} */ (ALLOWED_SAP_HOSTS).includes(parsedUrl.hostname))) {
    log('sapProxy denied by host allowlist', {
      uid: auth.uid,
      hostname: parsedUrl.hostname,
    });
    throw makeHttpsError(
      'failed-precondition',
      `SAP host ${parsedUrl.hostname} no autorizado. Verificar app_config/sap_integration.`
    );
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
  try {
    proxyBody = JSON.parse(proxyText);
  } catch {
    /* body no-json, dejamos texto */
  }

  // Logout best-effort. Errores acá no rompen la response al cliente.
  try {
    await deps.fetch(`${url}/b1s/v1/Logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
  } catch (e) {
    log('sapProxy SL logout swallowed', { err: String(e) });
  }

  log('sapProxy OK', {
    uid: auth.uid,
    role,
    method,
    endpoint: data.endpoint,
    status: proxyRes.status,
  });
  return { status: proxyRes.status, body: proxyBody };
}
