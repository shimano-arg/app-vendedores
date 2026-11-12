// @ts-check
/**
 * D8 — Backfill de credenciales /roles -> /auth_secrets (DIAGNÓSTICO / dry-run).
 *
 * Migra los hashes legacy (sha256-legacy) que hoy viven en /roles hacia
 * /auth_secrets, para que verifyPasswordGate (scrypt-v2, ya soporta
 * sha256-legacy) pueda validar a los usuarios actuales ANTES de flipear la
 * verificación server-side. Ver informe 56 + 55 §11.
 *
 *   PASO 1 del procedimiento de migración. NO flipea verifyPasswordGate.
 *
 * MODOS:
 *   (default)                 DRY-RUN: solo diagnóstico, 0 writes.
 *   --apply --confirm-project=app-vendedores-shimano   escribiría (guardado).
 *
 * GUARDS (anti-proyecto-equivocado):
 *   - projectId activo debe ser 'app-vendedores-shimano'.
 *   - --apply exige además --confirm-project=app-vendedores-shimano.
 *   - sin esas dos cosas => se niega el apply y cae a dry-run/abort.
 *
 * SECRETOS: jamás se imprime hash/salt/totpSecret/password. El diagnóstico
 * reporta solo {uid, category, action, versiones, note} + conteos.
 *
 * needs_reset: opcional. Si se exporta D8_DEFAULT_CANDIDATE, el script compara
 * SHA-256(salt+candidato) contra el hash legacy en memoria (sin loguearlo) para
 * marcar cuentas que siguen con la contraseña por defecto. Sin esa env, la
 * columna needsReset queda 'null' (no evaluado). El candidato NO se hardcodea.
 *
 * Flags: --apply · --confirm-project=<id> · --limit=N · --json
 */

'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('./lib/auth-secrets-backfill-core.cjs');

const EXPECTED_PROJECT = 'app-vendedores-shimano';
const SLUG = 'auth_secrets_backfill_2026-11-06';

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const limArg = argv.find((a) => a.startsWith('--limit='));
  const confArg = argv.find((a) => a.startsWith('--confirm-project='));
  return {
    apply,
    json,
    // P2-6: --limit inválido (NaN, 0, negativo) se ignora con aviso; no procesa "todo" en silencio.
    limit: limArg && Number(limArg.split('=')[1]) > 0 ? Number(limArg.split('=')[1]) : Infinity,
    limitInvalid: !!limArg && !(Number(limArg.split('=')[1]) > 0),
    confirmProject: confArg ? confArg.split('=')[1] : null,
  };
}

/**
 * Proyecto de las CREDENCIALES del operador (ADC/gcloud), para el guard.
 * NO usa admin.app().options (forzado a EXPECTED_PROJECT). Fail-closed: null si
 * el operador no exportó el proyecto → el guard bloquea --apply.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string|null}
 */
function resolveActiveProjectId(env) {
  const e = env || {};
  return e.GOOGLE_CLOUD_PROJECT || e.GCLOUD_PROJECT || e.CLOUDSDK_CORE_PROJECT || null;
}

// --- Fix guard ADC (2026-11-11) --------------------------------------------
// resolveActiveProjectId(env) queda como lectura SOLO-ENTORNO (fuente débil y
// manipulable; nunca suficiente para --apply). La identidad se resuelve con
// core.resolveProjectIdentity a partir de las fuentes de abajo.

/** Variables de entorno que declaran proyecto (solo pueden contradecir). */
const ENV_PROJECT_VARS = Object.freeze(['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']);

/** @param {NodeJS.ProcessEnv} env */
function envProjectSources(env) {
  const e = env || {};
  /** @type {Record<string, string|undefined>} */
  const out = {};
  for (const k of ENV_PROJECT_VARS) if (e[k] !== undefined && e[k] !== '') out[k] = e[k];
  return out;
}

/**
 * Entorno para invocar gcloud SIN overrides de proyecto/configuración, para que
 * `get-value project` refleje la configuración persistida del operador y no
 * una variable de entorno. Se conserva CLOUDSDK_CONFIG (ubicación de la config).
 * @param {NodeJS.ProcessEnv} env
 */
function sanitizedGcloudEnv(env) {
  const copy = Object.assign({}, env || {});
  delete copy.CLOUDSDK_CORE_PROJECT;
  delete copy.CLOUDSDK_ACTIVE_CONFIG_NAME;
  return copy;
}

/**
 * Proyecto configurado en gcloud (Windows: gcloud.cmd vía shell; Linux/macOS:
 * gcloud). No asume `gcloud auth application-default describe`. Nunca lanza.
 * @param {{spawnSync: Function, platform: string, env: NodeJS.ProcessEnv, timeoutMs?: number}} d
 * @returns {{status: 'ok'|'unset'|'invalid'|'error', value: string|null, reason: string}}
 */
function readGcloudConfigProject({ spawnSync, platform, env, timeoutMs }) {
  const isWin = platform === 'win32';
  const cmd = isWin ? 'gcloud.cmd' : 'gcloud';
  let r;
  try {
    // Argumentos constantes: shell:true en Windows es seguro (sin input externo).
    r = spawnSync(cmd, ['config', 'get-value', 'project'], {
      encoding: 'utf8',
      timeout: timeoutMs || 20000,
      env: sanitizedGcloudEnv(env),
      shell: isWin,
      windowsHide: true,
    });
  } catch (e) {
    r = { error: e };
  }
  return core.parseGcloudGetValueResult(r);
}

/**
 * Ruta del ADC que usaría firebase-admin: GOOGLE_APPLICATION_CREDENTIALS si
 * existe; si no, el well-known file (Windows %APPDATA%\gcloud; Linux/macOS
 * ~/.config/gcloud; ambos sobreescribibles con CLOUDSDK_CONFIG).
 * @param {{env: NodeJS.ProcessEnv, platform: string, homedir: string}} d
 * @returns {{path: string|null, source: string}}
 */
function resolveAdcPath({ env, platform, homedir }) {
  const e = env || {};
  if (e.GOOGLE_APPLICATION_CREDENTIALS) return { path: e.GOOGLE_APPLICATION_CREDENTIALS, source: 'GOOGLE_APPLICATION_CREDENTIALS' };
  // Fix multiplataforma (2026-11-11): las rutas se construyen con el módulo de
  // la plataforma PEDIDA (path.win32 / path.posix), no con el `path` del host.
  // Antes, en un host Windows, platform:'linux' producía '\c\...' y en un host
  // Linux, platform:'win32' producía separadores mezclados ('C:\...\Roaming/gcloud').
  const p = platform === 'win32' ? path.win32 : path.posix;
  let dir = e.CLOUDSDK_CONFIG || null;
  if (!dir) {
    if (platform === 'win32') dir = e.APPDATA ? p.join(e.APPDATA, 'gcloud') : null;
    else dir = homedir ? p.join(homedir, '.config', 'gcloud') : null;
  }
  return dir ? { path: p.join(dir, 'application_default_credentials.json'), source: 'well-known file' } : { path: null, source: 'no resoluble' };
}

/**
 * Metadatos NO sensibles del ADC. Nunca devuelve ni loguea tokens/secretos.
 * @param {{fs: any, env: NodeJS.ProcessEnv, platform: string, homedir: string}} d
 * @returns {{status: string, type: string|null, projectId: string|null, quotaProjectId: string|null, source: string}}
 */
function readAdcMetadata({ fs, env, platform, homedir }) {
  const p = resolveAdcPath({ env, platform, homedir });
  const base = { type: null, projectId: null, quotaProjectId: null, source: p.source };
  if (!p.path) return Object.assign({ status: 'absent' }, base);
  try {
    if (!fs.existsSync(p.path)) return Object.assign({ status: 'absent' }, base);
    const meta = core.parseAdcMetadata(fs.readFileSync(p.path, 'utf8'));
    return Object.assign({}, meta, { source: p.source });
  } catch (_e) {
    return Object.assign({ status: 'error' }, base);
  }
}

/** Línea legible (sin secretos) del estado del ADC. */
function describeAdc(adc) {
  if (!adc || adc.status === 'absent') return `ausente (${(adc && adc.source) || '-'})`;
  if (adc.status !== 'ok') return `${adc.status} (${adc.source})`;
  const parts = [`tipo ${adc.type}`];
  if (adc.projectId) parts.push(`project_id ${adc.projectId}`);
  parts.push(`quota_project_id ${adc.quotaProjectId || 'ausente'}`);
  return parts.join(', ') + ` (${adc.source})`;
}

/** SHA-256(salt+password) hex — mismo esquema legacy del gate client-side. */
function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

/**
 * Construye matchesDefault SOLO si hay candidato en env. Compara en memoria,
 * nunca loguea el candidato ni el hash.
 */
function buildMatchesDefault() {
  const candidate = process.env.D8_DEFAULT_CANDIDATE;
  if (!candidate) return undefined;
  return (_uid, rolesData) => {
    try {
      const salt = rolesData && rolesData.passwordSalt;
      const hash = rolesData && rolesData.passwordHash;
      if (!salt || !hash) return null;
      return sha256Hex(String(salt) + candidate) === String(hash);
    } catch (_e) {
      return null;
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Admin SDK lazy (solo acá; los tests importan el core, no esto).
  const admin = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: EXPECTED_PROJECT });
  const db = admin.firestore();
  // Fix guard ADC (2026-11-11): la identidad del proyecto del operador se
  // VERIFICA con fuentes independientes (gcloud config sin overrides de
  // entorno, metadatos del ADC y una sonda de lectura del destino). El entorno
  // solo puede contradecir. EXPECTED_PROJECT nunca es fallback de identidad.
  // El DESTINO de escritura sigue forzado a EXPECTED_PROJECT por initializeApp.
  const gcloudSrc = readGcloudConfigProject({ spawnSync: childProcess.spawnSync, platform: process.platform, env: process.env });
  const adcSrc = readAdcMetadata({ fs, env: process.env, platform: process.platform, homedir: os.homedir() });
  const envSrc = envProjectSources(process.env);
  let probeOk = false;
  let probeErr = '';
  try {
    // Sonda de SOLO LECTURA: prueba que las credenciales ADC alcanzan el destino.
    await db.collection('roles').limit(1).get();
    probeOk = true;
  } catch (eProbe) {
    probeErr = String((eProbe && (eProbe.code || eProbe.name)) || 'error');
  }
  const identity = core.resolveProjectIdentity({
    expectedProjectId: EXPECTED_PROJECT,
    envProjects: envSrc,
    gcloud: gcloudSrc,
    adc: adcSrc,
    probeOk,
  });

  // GUARD ANTES de cualquier escritura (y antes de la lectura masiva).
  const guard = core.resolveProjectGuard({
    activeProjectId: identity.verified ? identity.project : null,
    identityVerified: identity.verified,
    identityReason: identity.reason,
    expectedProjectId: EXPECTED_PROJECT,
    confirmProjectArg: args.confirmProject,
    apply: args.apply,
  });

  const envNames = Object.keys(envSrc);
  console.log('================================================================');
  console.log(`D8 backfill /roles -> /auth_secrets  [${args.apply ? 'APPLY' : 'DRY-RUN'}]`);
  console.log(`destino de escritura (forzado): ${EXPECTED_PROJECT}`);
  console.log(
    `identidad de proyecto: ${identity.verified ? 'VERIFICADA (' + identity.project + ')' : 'NO VERIFICADA'} — ${identity.reason}`
  );
  console.log(`  · gcloud config (sin overrides de entorno): ${gcloudSrc.value || '(' + gcloudSrc.reason + ')'}`);
  console.log(`  · ADC: ${describeAdc(adcSrc)}`);
  console.log(`  · entorno: ${envNames.length ? envNames.map((k) => k + '=' + envSrc[k]).join(', ') : 'sin variables de proyecto'}`);
  console.log(`  · lectura del destino: ${probeOk ? 'OK' : 'FALLÓ (' + probeErr + ')'}`);
  console.log(`guard: ${guard.allowed ? 'OK' : 'BLOQUEADO'} — ${guard.reason}`);
  console.log('================================================================\n');

  if (!probeOk) {
    console.error('No se pudo leer el destino con las credenciales ADC. Abortando sin escribir.');
    process.exit(3);
    return;
  }

  if (args.apply && !guard.allowed) {
    console.error('APPLY BLOQUEADO por guard de proyecto. Abortando sin escribir.');
    process.exit(2);
    return;
  }

  if (args.limitInvalid) console.warn('[aviso] --limit inválido: se ignora y se procesan todas las cuentas (solo lectura).\n');
  const matchesDefault = buildMatchesDefault();
  if (args.apply && matchesDefault === undefined) {
    // No es fatal, pero avisamos: el apply no distingue cuentas con default.
    console.warn('[aviso] D8_DEFAULT_CANDIDATE no seteado: needsReset no evaluado.\n');
  }

  // Lectura de /roles (universo de usuarios).
  const rolesSnap = await db.collection('roles').get();
  const rows = [];
  let processed = 0;
  for (const doc of rolesSnap.docs) {
    if (processed >= args.limit) break;
    processed++;
    const uid = doc.id;
    try {
      const rolesData = doc.data() || {};
      let authSecretData = null;
      try {
        const asSnap = await db.collection('auth_secrets').doc(uid).get();
        authSecretData = asSnap.exists ? asSnap.data() : null;
      } catch (eRead) {
        // Error parcial leyendo auth_secrets de ESTE uid: lo marcamos y seguimos.
        rows.push(core.classifyUser({ uid, readError: true }));
        continue;
      }
      rows.push(core.classifyUser({ uid, rolesData, authSecretData, matchesDefault }));
    } catch (eUser) {
      rows.push(core.classifyUser({ uid, readError: true }));
    }
  }

  /** @type {Map<string, any>} */
  const rolesByUid = new Map(rolesSnap.docs.map((d) => [d.id, d.data() || {}]));
  const rolesDataFor = (/** @type {string} */ uid) => rolesByUid.get(uid) || null;
  const plan = core.planRun(rows, {
    apply: args.apply && guard.allowed,
    nowIso: new Date().toISOString(),
    rolesDataFor,
  });

  // Tarea 61: diagnóstico ampliado. Firebase Auth en SOLO LECTURA (getUsers).
  // Si la API no está disponible (permisos, red), queda como 'no_disponible'.
  let authInfo = null;
  try {
    const authApi = admin.auth();
    authInfo = await core.collectAuthUsers({
      getUsers: (ids) => authApi.getUsers(ids),
      uids: rows.map((r) => r.uid), // P2-1: también las filas 'error' (falla de auth_secrets, no de Auth)
    });
  } catch (_eAuth) {
    authInfo = null;
  }
  const aggregates = core.buildDiagnosticAggregates({
    rows,
    rolesDataFor,
    auth: authInfo,
    candidateProvided: matchesDefault !== undefined,
    nowMs: Date.now(),
  });

  // Reporte SEGURO: solo conteos agregados. Sin uids, emails, hashes, salts,
  // TOTP ni el valor de D8_DEFAULT_CANDIDATE (Tarea 61: --json ya no incluye
  // `rows` ni la lista `flagged`, que traían uids).
  if (args.json) {
    console.log(
      JSON.stringify({ summary: plan.summary, flaggedCount: plan.flagged.length, aggregates }, null, 2)
    );
  } else {
    console.log('Resumen por categoría:');
    for (const [k, v] of Object.entries(plan.summary)) console.log(`  ${k}: ${v}`);
    if (plan.flagged.length) console.log(`\nMarcados para revisión manual: ${plan.flagged.length}`);
    console.log('');
    for (const line of core.renderDiagnosticReport(aggregates, plan.summary)) console.log(line);
  }

  // --apply: escritura guardada (esta tarea NO la ejecuta).
  if (args.apply && guard.allowed) {
    console.log(`\n[APPLY] escribiría ${plan.writes.length} docs en /auth_secrets (idempotente)...`);
    let done = 0;
    for (const w of plan.writes) {
      const asRef = db.collection('auth_secrets').doc(w.uid);
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(asRef);
        const curState = core.authSecretPwState(cur.exists ? cur.data() : null);
        // Idempotencia defensiva dentro de la transacción: si ya tiene password
        // completa, no pisar (evita carrera con una corrida previa).
        if (curState.complete) return;
        tx.set(
          asRef,
          Object.assign({}, w.record, { [`_backfill_${SLUG}`]: { at: w.record.migratedAt } }),
          { merge: true }
        );
      });
      done++;
    }
    console.log(`[APPLY] completados: ${done}`);
  } else {
    console.log('\nDRY-RUN: no se escribió nada. Para ejecutar el real ver informe 56 §Ejecución.');
  }
}

// Solo corre si se invoca directo (los tests importan el core, no este archivo).
if (require.main === module) {
  main().catch((e) => {
    // Solo el código: los mensajes de Firestore/Auth pueden traer rutas con uids.
    console.error('fatal:', String((e && (e.code || e.name)) || 'error'));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  sha256Hex,
  buildMatchesDefault,
  resolveActiveProjectId,
  envProjectSources,
  sanitizedGcloudEnv,
  readGcloudConfigProject,
  resolveAdcPath,
  readAdcMetadata,
  describeAdc,
  EXPECTED_PROJECT,
  SLUG,
};
