// @ts-check
/**
 * D8 — Tarea 62: core PURO de la auditoría de estado de despliegue.
 *
 * Analiza respuestas YA obtenidas (reglas desplegadas, lista de Cloud
 * Functions, frontend publicado). No hace red, no lee credenciales, no
 * escribe nada. El wrapper (BB_deploy_state_check.cjs) obtiene los datos en
 * SOLO LECTURA y nunca pasa el token a este módulo.
 *
 * Privacidad: de las Functions se extrae una ALLOWLIST de campos. Nunca
 * variables de entorno, secretos, service account ni URLs firmadas.
 */

'use strict';

const crypto = require('node:crypto');

/** CFs de auth que interesan a D8. */
const AUTH_FUNCTIONS = Object.freeze([
  'verifyPasswordGate',
  'setPasswordGate',
  'verifyTotpGate',
  'setTotpGate',
  'disableTotpGate',
]);

/** Freeze S04b PR-B en /roles (update no puede tocar credenciales legacy). */
const FREEZE_RE =
  /affectedKeys\(\)\s*\.hasAny\(\s*\[\s*'passwordHash'\s*,\s*'passwordSalt'\s*,\s*'totpSecret'\s*,\s*'totpEnabled'\s*\]\s*\)/;
/** /auth_secrets cerrada a clientes. */
const AUTH_SECRETS_CLOSED_RE = /match\s+\/auth_secrets\/\{uid\}\s*\{\s*allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/;

/** @param {string} s */
function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/** Quita todo CR: ninguna diferencia de fin de línea (CRLF/LF/mixto) cuenta como cambio. @param {string} s */
function normalizeNewlines(s) {
  return String(s).replace(/\r/g, '');
}

/**
 * Extrae el source de un Ruleset de la Rules API (source.files[].content).
 * @param {any} ruleset
 * @returns {string|null}
 */
function rulesetSource(ruleset) {
  const files = ruleset && ruleset.source && Array.isArray(ruleset.source.files) ? ruleset.source.files : [];
  if (!files.length) return null;
  return files.map((f) => String((f && f.content) || '')).join('\n');
}

/**
 * Quita comentarios // y /* *\/ de un texto de reglas o JS, respetando strings
 * entre comillas simples/dobles/backticks (con escapes). Aproximación suficiente
 * para detectar marcadores sin que un comentario cuente como código.
 * @param {string} src
 */
function stripComments(src) {
  const s = String(src);
  let out = '';
  let i = 0;
  /** @type {string|null} */
  let q = null;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (q) {
      out += c;
      if (c === '\\') {
        out += n || '';
        i += 2;
        continue;
      }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      q = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Devuelve el cuerpo (entre llaves) del primer bloque cuyo encabezado matchea.
 * @param {string} src  sin comentarios
 * @param {RegExp} headerRe  debe terminar justo antes de la llave de apertura
 * @returns {string|null}
 */
function extractBlock(src, headerRe) {
  const m = headerRe.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index + m[0].length - 1);
  if (i < 0) return null;
  const start = i + 1;
  let depth = 1;
  for (i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i);
  }
  return null;
}

/** Reglas `allow` de un bloque (sin bloques anidados). @param {string} block */
function allowStatements(block) {
  return (block.match(/allow\s+[^:;{}]+:[^;]*;/g) || []).map((x) => x.replace(/\s+/g, ' ').trim());
}

/**
 * P2-2 (review): análisis ESTRUCTURAL, sin comentarios. El freeze cuenta solo
 * si está en el bloque /roles y es la ÚNICA regla update/write (en Firestore
 * las reglas se combinan con OR: otra regla update/write lo anularía), y no hay
 * comodines {x=**}. La evidencia fuerte sigue siendo identicalToLocal (sha256).
 * @param {string|null} deployedSource
 * @param {string|null} localSource
 */
function analyzeRules(deployedSource, localSource) {
  const sha256Local = localSource == null ? null : sha256(normalizeNewlines(localSource));
  if (deployedSource == null) {
    return { available: false, freezePresent: null, authSecretsClosed: null, identicalToLocal: null, sha256Deployed: null, sha256Local, rolesUpdateRules: null, wildcardMatch: null };
  }
  const dep = normalizeNewlines(deployedSource);
  const code = stripComments(dep);
  const roles = extractBlock(code, /match\s+\/roles\/\{\s*[A-Za-z_]\w*\s*\}\s*\{/);
  const secrets = extractBlock(code, /match\s+\/auth_secrets\/\{\s*[A-Za-z_]\w*\s*\}\s*\{/);
  const wildcardMatch = /match\s+\/\{\s*[A-Za-z_]\w*\s*=\s*\*\*\s*\}/.test(code);
  const rolesAllows = roles == null ? [] : allowStatements(roles);
  const rolesUpdateRules = rolesAllows.filter((a) => /^allow [^:]*\b(update|write)\b/.test(a)).length;
  const freezeInRoles = roles != null && FREEZE_RE.test(roles);
  const secretsAllows = secrets == null ? [] : allowStatements(secrets);
  const secretsClosed =
    secrets != null && secretsAllows.length === 1 && /^allow read, ?write: ?if false;$/.test(secretsAllows[0].replace(/\s*([,:])\s*/g, '$1 ').replace(/ ;$/, ';').replace(/\s+/g, ' '));
  return {
    available: true,
    freezePresent: freezeInRoles && rolesUpdateRules === 1 && !wildcardMatch,
    authSecretsClosed: secretsClosed && !wildcardMatch,
    identicalToLocal: localSource == null ? null : dep === normalizeNewlines(localSource),
    sha256Deployed: sha256(dep),
    sha256Local,
    rolesUpdateRules,
    wildcardMatch,
  };
}

/** Labels que se pueden mostrar (no sensibles). */
const LABEL_ALLOWLIST = Object.freeze(['deployment-tool', 'firebase-functions-hash', 'firebase-functions-codebase', 'goog-managed-by']);

/**
 * Resume la lista de la Cloud Functions API v2 para las CFs pedidas.
 * SOLO campos de la allowlist; ignora environmentVariables, secret*, serviceAccountEmail, etc.
 * @param {any[]} functions  items de `functions` (v2)
 * @param {readonly string[]} [targets]
 * @param {{partial?: boolean}} [opts]
 */
function summarizeFunctions(functions, targets = AUTH_FUNCTIONS, opts = {}) {
  const list = Array.isArray(functions) ? functions : [];
  // P2-3 (review): si el listado fue parcial (regiones inalcanzables o tope de
  // páginas), "no encontrada" NO prueba "no desplegada" → deployed: null.
  const partial = opts && opts.partial === true;
  return targets.map((target) => {
    const matches = list.filter((f) => {
      const name = String((f && f.name) || '');
      const id = name.split('/').pop() || '';
      return id.toLowerCase() === target.toLowerCase();
    });
    if (!matches.length) return { name: target, deployed: partial ? null : false, instances: [] };
    return {
      name: target,
      deployed: true,
      instances: matches.map((f) => {
        const parts = String(f.name).split('/');
        const sc = f.serviceConfig || {};
        const bc = f.buildConfig || {};
        /** @type {Record<string, string>} */
        const labels = {};
        for (const k of LABEL_ALLOWLIST) if (f.labels && typeof f.labels[k] === 'string') labels[k] = f.labels[k];
        return {
          region: parts[3] || null,
          state: f.state || null,
          environment: f.environment || null,
          runtime: bc.runtime || null,
          entryPoint: bc.entryPoint || null,
          updateTime: f.updateTime || null,
          availableMemory: sc.availableMemory || null,
          timeoutSeconds: sc.timeoutSeconds == null ? null : sc.timeoutSeconds,
          maxInstanceCount: sc.maxInstanceCount == null ? null : sc.maxInstanceCount,
          minInstanceCount: sc.minInstanceCount == null ? null : sc.minInstanceCount,
          ingressSettings: sc.ingressSettings || null,
          revision: sc.revision || null,
          labels,
        };
      }),
    };
  });
}

/**
 * Marcadores del fix D8 (Tarea 55) en el frontend publicado. Solo booleanos;
 * nunca se extrae ni se imprime el valor de la contraseña por defecto.
 * @param {{indexHtml: string|null, adminChunk: string|null, defaultCandidate?: string|null}} a
 */
function analyzeFrontend({ indexHtml, adminChunk, defaultCandidate }) {
  if (indexHtml == null) {
    return { available: false, appVersion: null, defaultPasswordConst: null, defaultPasswordInit: null, defaultLiteralPresent: null, adminChunkAvailable: adminChunk != null, adminUsesSetPasswordGate: null, adminLegacyClientWrite: null, d8FixPublished: null, sha256Index: null };
  }
  // P2-4 (review): marcadores sobre el código SIN comentarios; cualquier
  // declaración (const/let/var) o uso de DEFAULT_USER_PASSWORD cuenta.
  const idx = stripComments(indexHtml);
  const m = /\bAPP_VERSION\s*=\s*'([^']{1,40})'/.exec(idx);
  const defaultPasswordConst = /\bDEFAULT_USER_PASSWORD\b/.test(idx);
  const defaultPasswordInit = /buildPasswordCredentials\(\s*DEFAULT_USER_PASSWORD\s*\)/.test(idx);
  // Opcional: si se pasa el candidato (en memoria, nunca se imprime), detecta el
  // literal aunque tenga otro nombre. Solo devuelve un booleano.
  const defaultLiteralPresent =
    typeof defaultCandidate === 'string' && defaultCandidate.length > 0
      ? idx.includes("'" + defaultCandidate + "'") || idx.includes('"' + defaultCandidate + '"')
      : null;
  const chunk = adminChunk == null ? null : stripComments(adminChunk);
  const adminUses = chunk == null ? null : /httpsCallable\(\s*['"]setPasswordGate['"]\s*\)/.test(chunk);
  const adminLegacy =
    chunk == null ? null : /buildPasswordCredentials\(|\bpasswordHash\s*:|\bpasswordSalt\s*:/.test(chunk);
  const d8 =
    chunk == null
      ? null
      : !defaultPasswordConst && !defaultPasswordInit && defaultLiteralPresent !== true && adminUses === true && adminLegacy === false;
  return {
    available: true,
    appVersion: m ? m[1] : null,
    defaultPasswordConst,
    defaultPasswordInit,
    defaultLiteralPresent,
    adminChunkAvailable: adminChunk != null,
    adminUsesSetPasswordGate: adminUses,
    adminLegacyClientWrite: adminLegacy,
    d8FixPublished: d8,
    sha256Index: sha256(indexHtml),
  };
}

/**
 * Resumen SEGURO del cuerpo de error de una API de Google (google.rpc.Status).
 * Allowlist estricta: solo `error.status`, `details[].reason`,
 * `details[].metadata.permission` y `details[].metadata.service`, cada uno
 * validado por formato. Descarta `message`, `consumer`, recursos, links y
 * cualquier otro campo (pueden contener emails, números de proyecto o URLs).
 * @param {any} body
 * @returns {{status: string|null, reasons: string[], permissions: string[], services: string[]}|null}
 */
function extractGoogleErrorInfo(body) {
  const err = body && typeof body === 'object' ? body.error : null;
  if (!err || typeof err !== 'object') return null;
  const ENUM = /^[A-Z][A-Z_]{1,59}$/;
  const PERM = /^[a-z][a-zA-Z]*(\.[a-zA-Z]+){1,4}$/;
  const SVC = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.googleapis\.com$/;
  const uniq = (a) => [...new Set(a)];
  const status = typeof err.status === 'string' && ENUM.test(err.status) ? err.status : null;
  const reasons = [];
  const permissions = [];
  const services = [];
  for (const d of Array.isArray(err.details) ? err.details.slice(0, 10) : []) {
    if (!d || typeof d !== 'object') continue;
    if (typeof d.reason === 'string' && ENUM.test(d.reason)) reasons.push(d.reason);
    const m = d.metadata && typeof d.metadata === 'object' ? d.metadata : {};
    if (typeof m.permission === 'string' && PERM.test(m.permission)) permissions.push(m.permission);
    if (typeof m.service === 'string' && SVC.test(m.service)) services.push(m.service);
  }
  if (!status && !reasons.length && !permissions.length && !services.length) return null;
  return { status, reasons: uniq(reasons), permissions: uniq(permissions), services: uniq(services) };
}

/** Pista accionable para el operador según el motivo informado por Google. @param {string[]} reasons */
function hintFor403(reasons) {
  const r = new Set(reasons || []);
  if (r.has('SERVICE_DISABLED')) return 'API deshabilitada en el proyecto que se usa para cuota/facturación';
  if (r.has('USER_PROJECT_DENIED') || r.has('CONSUMER_INVALID'))
    return 'proyecto de cuota no autorizado: reintentar con --quota-project o fijar gcloud config set billing/quota_project';
  if (r.has('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) return 'token sin scope suficiente: gcloud auth login (scope cloud-platform)';
  if (r.has('IAM_PERMISSION_DENIED'))
    return 'falta permiso IAM: firebaserules.releases.get + firebaserules.rulesets.get (rol mínimo roles/firebaserules.viewer)';
  return 'sin permiso o API deshabilitada';
}

/** Texto para un error HTTP/red (sin cuerpos ni cabeceras crudos). @param {{status?: number, code?: string, google?: any}} e */
function describeFetchError(e) {
  if (!e) return 'error';
  if (e.status === 401) return 'HTTP 401 (credencial inválida o vencida)';
  if (e.status === 403 && e.google) {
    const g = e.google;
    const parts = [];
    if (g.status) parts.push('status=' + g.status);
    if (g.reasons && g.reasons.length) parts.push('motivo=' + g.reasons.join(','));
    if (g.permissions && g.permissions.length) parts.push('permiso=' + g.permissions.join(','));
    if (g.services && g.services.length) parts.push('servicio=' + g.services.join(','));
    return 'HTTP 403 [' + parts.join('; ') + '] → ' + hintFor403(g.reasons);
  }
  if (e.status === 403) return 'HTTP 403 (sin permiso o API deshabilitada)';
  if (e.status === 404) return 'HTTP 404 (no encontrado)';
  if (e.status) return 'HTTP ' + e.status;
  return 'red: ' + (e.code || 'error');
}

/**
 * Render del reporte (solo estado; nunca el token).
 * @param {any} r
 * @returns {string[]}
 */
function renderDeployReport(r) {
  const L = [];
  const yn = (v) => (v === true ? 'SÍ' : v === false ? 'NO' : 'no disponible');
  L.push('================================================================');
  L.push(`D8 — estado de DESPLIEGUE (solo lectura) · proyecto ${r.project}`);
  L.push('================================================================');
  L.push('[Reglas Firestore desplegadas]');
  if (!r.rules || !r.rules.available) L.push(`  no disponible: ${r.rulesError || 'sin datos'}`);
  else {
    L.push(`  release actualizado: ${r.rulesReleaseUpdateTime || 'no disponible'}`);
    L.push(`  freeze S04b PR-B efectivo en /roles: ${yn(r.rules.freezePresent)} (reglas update/write en /roles: ${r.rules.rolesUpdateRules}; comodín {x=**}: ${yn(r.rules.wildcardMatch)})`);
    L.push(`  /auth_secrets cerrada a clientes: ${yn(r.rules.authSecretsClosed)}`);
    L.push(`  idénticas al firestore.rules local (EVIDENCIA FUERTE): ${yn(r.rules.identicalToLocal)}`);
    L.push(`  sha256 desplegadas: ${r.rules.sha256Deployed}`);
    L.push(`  sha256 local:       ${r.rules.sha256Local || 'no disponible'}`);
  }
  L.push('[Cloud Functions de auth]');
  if (!r.functions) L.push(`  no disponible: ${r.functionsError || 'sin datos'}`);
  else
    for (const f of r.functions) {
      if (f.deployed === null) {
        L.push(`  ${f.name}: no disponible (listado parcial: ${r.functionsPartialReason || 'parcial'})`);
        continue;
      }
      if (!f.deployed) {
        L.push(`  ${f.name}: NO desplegada`);
        continue;
      }
      for (const i of f.instances)
        L.push(
          `  ${f.name}: desplegada · región ${i.region} · ${i.environment} · ${i.state} · runtime ${i.runtime} · actualizada ${i.updateTime} · mem ${i.availableMemory} · timeout ${i.timeoutSeconds}s · revisión ${i.revision || '-'}${Object.keys(i.labels).length ? ' · labels ' + JSON.stringify(i.labels) : ''}`
        );
    }
  L.push('[Frontend publicado (GitHub Pages)]');
  if (!r.frontend || !r.frontend.available) L.push(`  no disponible: ${r.frontendError || 'sin datos'}`);
  else {
    L.push(`  APP_VERSION: ${r.frontend.appVersion || 'no encontrada'}`);
    L.push(`  constante de contraseña por defecto presente: ${yn(r.frontend.defaultPasswordConst)}`);
    L.push(`  init con contraseña por defecto presente: ${yn(r.frontend.defaultPasswordInit)}`);
    L.push(`  literal de la contraseña por defecto presente: ${r.frontend.defaultLiteralPresent === null ? 'no evaluado (sin D8_DEFAULT_CANDIDATE)' : yn(r.frontend.defaultLiteralPresent)}`);
    L.push(`  chunk admin-users usa setPasswordGate: ${yn(r.frontend.adminUsesSetPasswordGate)}`);
    L.push(`  chunk admin-users escribe credenciales client-side: ${yn(r.frontend.adminLegacyClientWrite)}`);
    L.push(`  FIX D8 (Tarea 55) PUBLICADO: ${yn(r.frontend.d8FixPublished)}`);
    L.push(`  sha256 index.html publicado: ${r.frontend.sha256Index}`);
  }
  L.push('================================================================');
  L.push('Solo lectura: no se escribió, desplegó ni modificó nada.');
  return L;
}

module.exports = {
  AUTH_FUNCTIONS,
  FREEZE_RE,
  AUTH_SECRETS_CLOSED_RE,
  LABEL_ALLOWLIST,
  sha256,
  stripComments,
  extractBlock,
  rulesetSource,
  extractGoogleErrorInfo,
  analyzeRules,
  summarizeFunctions,
  analyzeFrontend,
  describeFetchError,
  renderDeployReport,
};
