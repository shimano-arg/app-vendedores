// @ts-check
/**
 * D8 — Tarea 62: auditoría de estado de DESPLIEGUE en SOLO LECTURA.
 *
 * Responde, con evidencia de PRODUCCIÓN (no de archivos ni ramas):
 *  1. Si las reglas Firestore desplegadas contienen el freeze S04b PR-B
 *     (Firebase Rules API: release cloud.firestore → ruleset → source).
 *  2. Si están desplegadas verifyPasswordGate / setPasswordGate /
 *     verifyTotpGate / setTotpGate / disableTotpGate, con región y
 *     configuración (Cloud Functions API v2, todas las regiones).
 *  3. Qué versión del frontend publica GitHub Pages y si contiene el fix D8
 *     (GET público de index.html y chunks/admin-users.js, SIN token).
 *
 * Solo hace GET. No escribe, no despliega, no modifica nada.
 * El token sale de `gcloud auth print-access-token` (sesión del operador),
 * vive solo en memoria, nunca se imprime ni se envía a GitHub Pages.
 *
 * Uso: node scripts/audit/BB_deploy_state_check.cjs [--json] [--quota-project]
 *   --quota-project: envía x-goog-user-project con el proyecto del sistema
 *   (diagnóstico del 403 cuando gcloud usa otro proyecto de cuota).
 */

'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const dcore = require('./lib/deploy-state-core.cjs');

const PROJECT = 'app-vendedores-shimano';
const PAGES_BASE = 'https://shimano-arg.github.io/app-vendedores/';
const RULES_API = 'https://firebaserules.googleapis.com/v1';
const FUNCTIONS_API = 'https://cloudfunctions.googleapis.com/v2';

/**
 * Token de acceso del operador vía gcloud (Windows: gcloud.cmd). Nunca lanza.
 * @param {{spawnSync: Function, platform: string, env: NodeJS.ProcessEnv}} d
 * @returns {{token: string|null, error: string|null}}
 */
function getAccessToken({ spawnSync, platform, env }) {
  const isWin = platform === 'win32';
  try {
    const r = spawnSync(isWin ? 'gcloud.cmd' : 'gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      timeout: 30000,
      env,
      shell: isWin,
      windowsHide: true,
    });
    if (r.error) return { token: null, error: 'no se pudo invocar gcloud (' + (r.error.code || 'error') + ')' };
    if (r.status !== 0) return { token: null, error: 'gcloud salió con código ' + r.status };
    const t = String(r.stdout || '').trim().split(/\r?\n/)[0];
    return t ? { token: t, error: null } : { token: null, error: 'gcloud no devolvió token' };
  } catch (e) {
    return { token: null, error: 'no se pudo invocar gcloud (' + ((e && e.code) || 'error') + ')' };
  }
}

/**
 * GET JSON/texto. Solo GET. El token solo se adjunta a googleapis.com.
 * @param {Function} fetchFn
 * @param {string} url
 * @param {string|null} token
 * @param {'json'|'text'} kind
 * @param {{quotaProject?: string|null}} [opts] quotaProject: solo se acepta PROJECT y solo hacia googleapis.
 */
async function httpGet(fetchFn, url, token, kind, opts) {
  /** @type {Record<string, string>} */
  const headers = {};
  const isGoogleApi = /^https:\/\/[a-z0-9.-]+\.googleapis\.com\//.test(url);
  if (token && isGoogleApi) headers.Authorization = 'Bearer ' + token;
  if (isGoogleApi && opts && opts.quotaProject === PROJECT) headers['x-goog-user-project'] = PROJECT;
  let res;
  try {
    // P2-5 (review): hacia googleapis no se siguen redirects (el token no puede
    // terminar en otro host); Pages es público y puede redirigir.
    res = await fetchFn(url, { method: 'GET', headers, redirect: isGoogleApi ? 'error' : 'follow' });
  } catch (e) {
    throw { code: (e && (e.code || (e.cause && e.cause.code) || e.name)) || 'error' };
  }
  if (!res || !res.ok) {
    /** @type {any} */
    const err = { status: res ? res.status : 0 };
    // T63: de googleapis se extrae SOLO un resumen allowlist del cuerpo
    // (status/reason/permission/service). Nunca el cuerpo crudo. Pages: no se lee.
    if (isGoogleApi && res && typeof res.json === 'function') {
      try {
        const info = dcore.extractGoogleErrorInfo(await res.json());
        if (info) err.google = info;
      } catch (_e) {
        /* cuerpo no-JSON: queda solo el status */
      }
    }
    throw err;
  }
  return kind === 'json' ? res.json() : res.text();
}

/**
 * Corre las tres verificaciones. Inyectable para tests.
 * @param {{fetch: Function, getToken: () => {token: string|null, error: string|null}, readLocalRules: () => string|null, defaultCandidate?: string|null, quotaProject?: string|null}} deps
 */
async function runDeployCheck(deps) {
  const out = /** @type {any} */ ({ project: PROJECT });
  const { token, error: tokenError } = deps.getToken();
  const gopts = { quotaProject: deps.quotaProject || null };

  // 1. Reglas desplegadas.
  if (!token) out.rulesError = 'sin token de acceso: ' + tokenError;
  else {
    try {
      let release = null;
      for (const rel of ['cloud.firestore', 'cloud.firestore/(default)']) {
        try {
          release = await httpGet(deps.fetch, `${RULES_API}/projects/${PROJECT}/releases/${encodeURIComponent(rel).replaceAll('%2F', '/')}`, token, 'json', gopts);
          break;
        } catch (e) {
          if (!e || e.status !== 404) throw e;
        }
      }
      if (!release || !release.rulesetName) throw { status: 404 };
      const ruleset = await httpGet(deps.fetch, `${RULES_API}/${release.rulesetName}`, token, 'json', gopts);
      out.rules = dcore.analyzeRules(dcore.rulesetSource(ruleset), deps.readLocalRules());
      out.rulesReleaseUpdateTime = release.updateTime || null;
    } catch (e) {
      out.rulesError = dcore.describeFetchError(e);
    }
  }
  if (!out.rules) out.rules = dcore.analyzeRules(null, deps.readLocalRules());

  // 2. Cloud Functions (todas las regiones, paginado).
  if (!token) out.functionsError = 'sin token de acceso: ' + tokenError;
  else {
    try {
      const all = [];
      let pageToken = '';
      let unreachable = 0;
      let capped = false;
      const MAX_PAGES = 20;
      for (let n = 0; ; n++) {
        if (n >= MAX_PAGES) {
          capped = true;
          break;
        }
        const url = `${FUNCTIONS_API}/projects/${PROJECT}/locations/-/functions?pageSize=200${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
        const page = await httpGet(deps.fetch, url, token, 'json', gopts);
        for (const f of (page && page.functions) || []) all.push(f);
        if (page && Array.isArray(page.unreachable)) unreachable += page.unreachable.length;
        pageToken = (page && page.nextPageToken) || '';
        if (!pageToken) break;
      }
      const partial = unreachable > 0 || capped;
      if (partial) {
        out.functionsPartialReason = [unreachable ? unreachable + ' región(es) inalcanzable(s)' : '', capped ? 'tope de ' + MAX_PAGES + ' páginas' : '']
          .filter(Boolean)
          .join(', ');
      }
      out.functions = dcore.summarizeFunctions(all, dcore.AUTH_FUNCTIONS, { partial });
    } catch (e) {
      out.functionsError = dcore.describeFetchError(e);
    }
  }

  // 3. Frontend publicado (público, SIN token).
  try {
    const indexHtml = await httpGet(deps.fetch, PAGES_BASE + 'index.html', null, 'text');
    let adminChunk = null;
    try {
      adminChunk = await httpGet(deps.fetch, PAGES_BASE + 'chunks/admin-users.js', null, 'text');
    } catch (_e) {
      adminChunk = null;
    }
    out.frontend = dcore.analyzeFrontend({ indexHtml, adminChunk, defaultCandidate: deps.defaultCandidate || null });
  } catch (e) {
    out.frontendError = dcore.describeFetchError(e);
  }
  return out;
}

async function main() {
  const json = process.argv.includes('--json');
  // T63: --quota-project agrega x-goog-user-project: <proyecto del sistema> (fijo, no configurable).
  const quotaProject = process.argv.includes('--quota-project') ? PROJECT : null;
  const localRulesPath = path.join(__dirname, '..', '..', 'firestore.rules');
  const result = await runDeployCheck({
    fetch: globalThis.fetch,
    quotaProject,
    getToken: () => getAccessToken({ spawnSync: childProcess.spawnSync, platform: process.platform, env: process.env }),
    defaultCandidate: process.env.D8_DEFAULT_CANDIDATE || null, // en memoria; nunca se imprime
    readLocalRules: () => {
      try {
        return fs.readFileSync(localRulesPath, 'utf8');
      } catch (_e) {
        return null;
      }
    },
  });
  if (json) console.log(JSON.stringify(result, null, 2));
  else for (const line of dcore.renderDeployReport(result)) console.log(line);
}

if (require.main === module) {
  if (typeof globalThis.fetch !== 'function') {
    console.error('fatal: este script necesita Node 18+ (fetch global).');
    process.exit(1);
  }
  main().catch((e) => {
    console.error('fatal:', String((e && (e.code || e.name)) || 'error'));
    process.exit(1);
  });
}

module.exports = { PROJECT, PAGES_BASE, getAccessToken, httpGet, runDeployCheck };
