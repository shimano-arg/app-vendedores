// @ts-check
'use strict';
/**
 * scripts/_lib/safe-target.cjs — PROPUESTA (no está en el repo todavía).
 *
 * Guard común para scripts operativos que tocan Firestore / BigQuery / SAP /
 * Storage. Objetivo (control C9): que ningún script pueda escribir en
 * producción por accidente.
 *
 * Reglas:
 *  1. Proyecto explícito obligatorio: `--project <id>` o `--project=<id>`.
 *     No hay valor por defecto ni se toma de variables de entorno.
 *  2. El proyecto tiene que estar en la lista permitida.
 *  3. Dry-run por defecto. Para escribir hace falta `--apply`.
 *     `--apply` junto con `--dry-run` es un error.
 *  4. Producción + `--apply` exige confirmación tipeando el project id
 *     (TTY) o `--confirm-project=<id>` idéntico (CI / sin TTY).
 *  5. Producción + `--apply` exige cuenta de servicio (no ADC de usuario).
 *  6. Si la credencial (SA) es de otro proyecto, o GOOGLE_CLOUD_PROJECT /
 *     GCLOUD_PROJECT apuntan a otro proyecto, se bloquea.
 *  7. Siempre imprime el destino (proyecto, modo, credencial) por stderr.
 *
 * El módulo es puro respecto de la red: no abre conexiones. Lectura de
 * archivos y prompt son inyectables para tests.
 */

const DEFAULT_ALLOWED_PROJECTS = Object.freeze(['app-vendedores-shimano', 'app-vendedores-shimano-stg']);
const DEFAULT_PRODUCTION_PROJECTS = Object.freeze(['app-vendedores-shimano']);

class SafeTargetError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'SafeTargetError';
    this.code = code;
  }
}

/**
 * @param {string[]} argv
 * @returns {{project: string|null, apply: boolean, dryRun: boolean, confirmProject: string|null, rest: string[]}}
 */
function parseArgs(argv) {
  let project = null;
  let confirmProject = null;
  let apply = false;
  let dryRun = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new SafeTargetError('E_NO_PROJECT', '--project requiere un valor');
      project = v;
      i++;
    } else if (a.startsWith('--project=')) {
      project = a.slice('--project='.length);
    } else if (a.startsWith('--confirm-project=')) {
      confirmProject = a.slice('--confirm-project='.length);
    } else if (a === '--apply') {
      apply = true;
    } else if (a === '--dry-run' || a === '--dry') {
      dryRun = true;
    } else {
      rest.push(a);
    }
  }
  return { project: project ? project.trim() : null, apply, dryRun, confirmProject, rest };
}

/**
 * Detecta qué credencial usarían las librerías de Google.
 * @param {Record<string,string|undefined>} env
 * @param {(p: string) => string|null} readFile devuelve contenido o null si no existe
 * @returns {{kind: 'service_account'|'user_adc'|'external_account'|'none'|'unknown', email: string|null, projectId: string|null, source: string|null}}
 */
function detectCredential(env, readFile) {
  const gac = env.GOOGLE_APPLICATION_CREDENTIALS;
  let source = null;
  let raw = null;
  if (gac) {
    source = gac;
    raw = readFile(gac);
    if (raw == null) return { kind: 'unknown', email: null, projectId: null, source };
  } else {
    const home = env.HOME || env.USERPROFILE || '';
    const cands = [];
    if (env.CLOUDSDK_CONFIG) cands.push(env.CLOUDSDK_CONFIG + '/application_default_credentials.json');
    if (env.APPDATA) cands.push(env.APPDATA + '/gcloud/application_default_credentials.json');
    if (home) cands.push(home + '/.config/gcloud/application_default_credentials.json');
    for (const c of cands) {
      const r = readFile(c);
      if (r != null) {
        source = c;
        raw = r;
        break;
      }
    }
    if (raw == null) return { kind: 'none', email: null, projectId: null, source: null };
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (_e) {
    return { kind: 'unknown', email: null, projectId: null, source };
  }
  if (j && j.type === 'service_account') {
    return { kind: 'service_account', email: j.client_email || null, projectId: j.project_id || null, source };
  }
  if (j && j.type === 'authorized_user') {
    return { kind: 'user_adc', email: null, projectId: j.quota_project_id || null, source };
  }
  if (j && j.type === 'external_account') {
    // Workload Identity Federation (OIDC en GitHub Actions): aceptable como SA.
    const m = /serviceAccounts\/([^:]+):generateAccessToken/.exec(j.service_account_impersonation_url || '');
    return { kind: 'external_account', email: m ? m[1] : null, projectId: null, source };
  }
  return { kind: 'unknown', email: null, projectId: null, source };
}

/**
 * @typedef {Object} ResolveOpts
 * @property {string[]} argv
 * @property {Record<string,string|undefined>} [env]
 * @property {readonly string[]} [allowedProjects]
 * @property {readonly string[]} [productionProjects]
 * @property {boolean} [requiresWrite] el script escribe algo (default true)
 * @property {(p: string) => string|null} [readFile]
 * @property {boolean} [isTTY]
 */

/**
 * Valida todo y devuelve el destino. No pide confirmación (ver confirmIfNeeded).
 * @param {ResolveOpts} opts
 */
function resolveTarget(opts) {
  const env = opts.env || {};
  const allowed = opts.allowedProjects || DEFAULT_ALLOWED_PROJECTS;
  const prodList = opts.productionProjects || DEFAULT_PRODUCTION_PROJECTS;
  const requiresWrite = opts.requiresWrite !== false;
  const readFile = opts.readFile || (() => null);
  const a = parseArgs(opts.argv || []);

  if (!a.project) {
    throw new SafeTargetError('E_NO_PROJECT', 'Falta --project <id>. No hay proyecto por defecto.');
  }
  if (!allowed.includes(a.project)) {
    throw new SafeTargetError('E_PROJECT_NOT_ALLOWED', `Proyecto no permitido: ${a.project}. Permitidos: ${allowed.join(', ')}`);
  }
  if (a.apply && a.dryRun) {
    throw new SafeTargetError('E_CONFLICTING_FLAGS', '--apply y --dry-run no pueden ir juntos.');
  }
  if (a.apply && !requiresWrite) {
    throw new SafeTargetError('E_APPLY_ON_READONLY', 'Este script es de solo lectura: --apply no aplica.');
  }
  for (const k of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) {
    if (env[k] && env[k] !== a.project) {
      throw new SafeTargetError('E_ENV_PROJECT_MISMATCH', `${k}=${env[k]} no coincide con --project ${a.project}. Las librerías podrían usar ${env[k]}.`);
    }
  }
  const cred = detectCredential(env, readFile);
  const isProduction = prodList.includes(a.project);
  const mode = a.apply ? 'APPLY' : 'DRY-RUN';

  if (cred.kind === 'service_account' && cred.projectId && cred.projectId !== a.project) {
    throw new SafeTargetError('E_CREDENTIAL_PROJECT_MISMATCH', `La cuenta de servicio es del proyecto ${cred.projectId}, no de ${a.project}.`);
  }
  if (a.apply && cred.kind === 'none') {
    throw new SafeTargetError('E_NO_CREDENTIAL', 'No se encontró credencial para escribir.');
  }
  if (a.apply && cred.kind === 'unknown') {
    throw new SafeTargetError('E_UNKNOWN_CREDENTIAL', `Credencial ilegible o de tipo desconocido (${cred.source}).`);
  }
  if (a.apply && isProduction && cred.kind === 'user_adc') {
    throw new SafeTargetError('E_USER_ADC_ON_PROD', 'Escribir en producción con ADC de usuario está bloqueado: usar una cuenta de servicio dedicada.');
  }

  return {
    project: a.project,
    mode,
    apply: a.apply,
    isProduction,
    credential: cred,
    confirmProject: a.confirmProject,
    rest: a.rest,
    isTTY: !!opts.isTTY,
  };
}

/** @param {ReturnType<typeof resolveTarget>} t */
function banner(t) {
  const cred =
    t.credential.kind === 'service_account' || t.credential.kind === 'external_account'
      ? `cuenta de servicio ${t.credential.email || '(sin email)'}`
      : t.credential.kind === 'user_adc'
        ? 'ADC de usuario'
        : t.credential.kind;
  const line = '='.repeat(64);
  return [
    line,
    `DESTINO   : ${t.project}${t.isProduction ? '   <<< PRODUCCION >>>' : ''}`,
    `MODO      : ${t.mode}${t.apply ? '' : ' (no se escribe nada)'}`,
    `CREDENCIAL: ${cred}`,
    line,
  ].join('\n');
}

/**
 * Pide confirmación tipeada para producción + apply.
 * @param {ReturnType<typeof resolveTarget>} t
 * @param {(question: string) => Promise<string>} [prompt]
 */
async function confirmIfNeeded(t, prompt) {
  if (!(t.apply && t.isProduction)) return true;
  if (t.confirmProject != null) {
    if (t.confirmProject !== t.project) {
      throw new SafeTargetError('E_CONFIRMATION_MISMATCH', '--confirm-project no coincide con --project.');
    }
    return true;
  }
  if (!t.isTTY || !prompt) {
    throw new SafeTargetError('E_CONFIRMATION_REQUIRED', `Sin TTY: pasar --confirm-project=${t.project} para escribir en producción.`);
  }
  const typed = (await prompt(`Vas a ESCRIBIR en ${t.project}. Tipeá el project id para confirmar: `)).trim();
  if (typed !== t.project) {
    throw new SafeTargetError('E_CONFIRMATION_MISMATCH', 'Confirmación incorrecta. No se escribió nada.');
  }
  return true;
}

/**
 * Ejecuta `fn` solo en modo APPLY; en DRY-RUN registra lo que haría.
 * @template T
 * @param {ReturnType<typeof resolveTarget>} t
 * @param {string} description
 * @param {() => T | Promise<T>} fn
 * @param {(msg: string) => void} [log]
 * @returns {Promise<T|null>}
 */
async function write(t, description, fn, log) {
  const l = log || ((m) => process.stderr.write(m + '\n'));
  if (!t.apply) {
    l(`[DRY-RUN] haría: ${description}`);
    return null;
  }
  l(`[APPLY] ${description}`);
  return await fn();
}

/**
 * Atajo para scripts: valida, imprime banner, confirma. Sale con código 2 si falla.
 * @param {Omit<ResolveOpts,'readFile'|'isTTY'|'env'|'argv'> & {argv?: string[]}} [opts]
 */
async function guardOrExit(opts) {
  const fs = require('node:fs');
  const readFile = (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (_e) {
      return null;
    }
  };
  try {
    const t = resolveTarget({
      argv: process.argv.slice(2),
      env: process.env,
      readFile,
      isTTY: !!process.stdin.isTTY,
      ...(opts || {}),
    });
    process.stderr.write(banner(t) + '\n');
    await confirmIfNeeded(t, (q) => {
      const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stderr });
      return new Promise((res) => rl.question(q, (ans) => { rl.close(); res(ans); }));
    });
    return t;
  } catch (e) {
    if (e instanceof SafeTargetError) {
      process.stderr.write(`[safe-target] BLOQUEADO (${e.code}): ${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }
}

module.exports = {
  DEFAULT_ALLOWED_PROJECTS,
  DEFAULT_PRODUCTION_PROJECTS,
  SafeTargetError,
  parseArgs,
  detectCredential,
  resolveTarget,
  banner,
  confirmIfNeeded,
  write,
  guardOrExit,
};
