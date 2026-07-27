// @ts-check
/**
 * Cliente SAP Service Layer que enruta por la Cloud Function `sapProxy`
 * (Fase 0 E5). Reemplaza al `sapSL` inline de index.html que fetcheaba
 * directo contra shimano-sap.seidor.com.ar con creds leídas de Firestore.
 *
 * Contrato de shape idéntico al `fetchWithSession` legacy (index.html:21481)
 * para que la migración de E2.b sea un swap 1:1 sin tocar callers:
 *   Input:  (path, options?) donde path empieza con '/b1s/v1/' y
 *           options = { method?, body?, headers? }.
 *   Output: { ok, body, status, error? }.
 *
 * NO cablear hasta que Mariano deploye `sapProxy` en prod (checklist 43.8).
 * Hasta entonces, index.html sigue usando el sapSL legacy sin cambios.
 */

/**
 * @typedef {Object} SapClientResponse
 * @property {boolean} ok
 * @property {number} status
 * @property {unknown} [body]
 * @property {string} [error]
 *
 * @typedef {Object} SapFetchOptions
 * @property {'GET'|'POST'|'PATCH'|'DELETE'} [method]
 * @property {string} [body] JSON string (compat con sapSL legacy).
 * @property {Record<string, string>} [headers]
 *
 * @typedef {Object} HttpsCallableResult
 * @property {{ status: number, body: unknown }} data
 *
 * @typedef {Object} FirebaseFunctionsLike
 * @property {(name: string) => (data: unknown) => Promise<HttpsCallableResult>} httpsCallable
 *
 * @typedef {Object} FirebaseNamespaceLike
 * @property {(region?: string) => FirebaseFunctionsLike} functions
 */

/**
 * Crea un cliente SAP que rutea por la Cloud Function `sapProxy`.
 * @param {FirebaseNamespaceLike} firebase Namespace compat de Firebase (window.firebase en el HTML).
 * @param {{ callableName?: string, region?: string }} [opts]
 */
export function createSapClient(firebase, opts) {
  const callableName = (opts && opts.callableName) || 'sapProxy';
  // Region default matchea el deploy real de sapProxy (E5, southamerica-east1).
  // Sin especificarla, firebase.functions() apunta a us-central1 y da 404.
  const region = (opts && opts.region) || 'southamerica-east1';

  /**
   * @param {string} path Ej: '/b1s/v1/Items(\'ABC\')?$select=ItemCode'
   * @param {SapFetchOptions} [options]
   * @returns {Promise<SapClientResponse>}
   */
  async function fetchWithSession(path, options) {
    if (!path || typeof path !== 'string' || !path.startsWith('/b1s/v1/')) {
      return { ok: false, status: 0, error: 'path debe empezar con /b1s/v1/' };
    }
    const method = (options && options.method) || 'GET';
    /** @type {unknown} */
    let parsedBody = undefined;
    if (options && typeof options.body === 'string') {
      try { parsedBody = JSON.parse(options.body); }
      catch { return { ok: false, status: 0, error: 'body no es JSON válido' }; }
    }
    const callable = firebase.functions(region).httpsCallable(callableName);
    try {
      const res = await callable({ endpoint: path, method, body: parsedBody });
      const status = (res && res.data && typeof res.data.status === 'number') ? res.data.status : 0;
      const body = res && res.data ? res.data.body : undefined;
      const ok = status >= 200 && status < 300;
      if (!ok) {
        const detail = (body && typeof body === 'object' && /** @type {any} */ (body).error &&
                        /** @type {any} */ (body).error.message &&
                        /** @type {any} */ (body).error.message.value) || '';
        return { ok: false, status, body, error: 'HTTP ' + status + (detail ? ' - ' + detail : '') };
      }
      return { ok: true, status, body };
    } catch (e) {
      const err = /** @type {any} */ (e);
      const code = err && err.code ? String(err.code) : 'unknown';
      const msg = err && err.message ? String(err.message) : String(e);
      return { ok: false, status: 0, error: 'callable(' + code + '): ' + msg };
    }
  }

  /**
   * Crea una Sales Quotation. Compat con sapSL.createQuotation legacy.
   * @param {unknown} payload
   */
  async function createQuotation(payload) {
    return fetchWithSession('/b1s/v1/Quotations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  return { fetchWithSession, createQuotation };
}
