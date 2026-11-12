// @ts-check
/**
 * D8 — Core PURO del backfill de credenciales /roles -> /auth_secrets.
 *
 * Diseño (informe 56): toda la lógica de clasificación + plan de migración vive
 * acá, con deps inyectables y SIN acceso a Firebase, para poder testearla sin
 * tocar producción. El wrapper (BA_auth_secrets_backfill.cjs) inyecta el Admin
 * SDK y es el único que lee/escribiría Firestore (y solo con --apply, que esta
 * tarea NO ejecuta).
 *
 * PROPIEDADES GARANTIZADAS:
 *  - Dry-run por defecto: planRun(..., {apply:false}) NUNCA produce writes.
 *  - Idempotente: un uid ya migrado (auth_secrets con password) => skip, 0 write.
 *  - Sin secretos en logs: las filas de diagnóstico (classifyUser / toLogRow /
 *    summary) NO contienen hash/salt/totpSecret/password. El único objeto que
 *    los lleva es el `record` de un write (payload de migración), que el wrapper
 *    escribe vía Admin SDK y NUNCA imprime.
 *  - Errores parciales: un uid que falló al leerse entra como category 'error'
 *    y no aborta el resto.
 */

'use strict';

/** Campos de /roles que son credenciales (jamás se loguean). */
const SECRET_FIELDS = Object.freeze([
  'passwordHash',
  'passwordSalt',
  'totpSecret',
  'pwHash',
  'pwSalt',
]);

/** Versiones de password que cuentan como "ya migrado" en /auth_secrets. */
const PW_VERSION_CURRENT = 'scrypt-v2';
const PW_VERSION_LEGACY = 'sha256-legacy';

/** @param {any} v */
function hasStr(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * ¿El doc /auth_secrets tiene una credencial de password COMPLETA?
 * scrypt-v2 => pwHash+pwSalt; sha256-legacy => passwordHash+passwordSalt.
 * @param {any} as
 * @returns {{complete: boolean, version: string|null, partial: boolean}}
 */
function authSecretPwState(as) {
  if (!as || typeof as !== 'object') return { complete: false, version: null, partial: false };
  const version = as.pwVersion || (as.passwordHash ? PW_VERSION_LEGACY : null);
  if (version === PW_VERSION_CURRENT) {
    const complete = hasStr(as.pwHash) && hasStr(as.pwSalt);
    return { complete, version, partial: !complete && (hasStr(as.pwHash) || hasStr(as.pwSalt)) };
  }
  if (version === PW_VERSION_LEGACY) {
    const complete = hasStr(as.passwordHash) && hasStr(as.passwordSalt);
    return { complete, version, partial: !complete && (hasStr(as.passwordHash) || hasStr(as.passwordSalt)) };
  }
  return { complete: false, version: version || null, partial: false };
}

/** Estado de credencial legacy en /roles. */
function rolesPwState(roles) {
  const r = roles || {};
  const h = hasStr(r.passwordHash);
  const s = hasStr(r.passwordSalt);
  return {
    hasHash: h,
    hasSalt: s,
    complete: h && s,
    partial: (h || s) && !(h && s),
    none: !h && !s,
  };
}

/**
 * Clasifica UN usuario. Entrada SIN exponer secretos en la salida.
 * @param {Object} args
 * @param {string} args.uid
 * @param {any} args.rolesData        doc /roles/{uid} (o null si no existe)
 * @param {any} args.authSecretData   doc /auth_secrets/{uid} (o null)
 * @param {boolean} [args.readError]  true si la lectura de este uid falló
 * @param {(uid:string, rolesData:any)=>(boolean|null)} [args.matchesDefault]
 *        predicado opcional: ¿el hash legacy corresponde a la contraseña por
 *        defecto candidata? null = no evaluado. NUNCA recibe/expone el valor.
 * @returns {{uid:string, category:string, action:string, needsReset:(boolean|null),
 *            rolesVersion:string|null, authVersion:string|null, note:string}}
 */
function classifyUser({ uid, rolesData, authSecretData, readError, matchesDefault }) {
  if (readError) {
    return mk(uid, 'error', 'skip_error', null, null, null, 'lectura falló');
  }
  const rp = rolesPwState(rolesData);
  const ap = authSecretPwState(authSecretData);
  const authExists = !!authSecretData;

  // 1. Ya migrado (auth_secrets con password completa) -> idempotente skip.
  if (ap.complete) {
    // Inconsistencia: auth_secrets legacy difiere de roles legacy (mismo shape).
    if (
      ap.version === PW_VERSION_LEGACY &&
      rp.complete &&
      hasStr(authSecretData.passwordHash) &&
      hasStr(rolesData.passwordHash) &&
      authSecretData.passwordHash !== rolesData.passwordHash
    ) {
      return mk(uid, 'inconsistent', 'flag_inconsistent', null, ap.version, rp.complete ? PW_VERSION_LEGACY : null,
        'auth_secrets legacy difiere de roles');
    }
    return mk(uid, 'already_migrated', 'skip', null, ap.version, rp.none ? null : PW_VERSION_LEGACY, 'ya en auth_secrets');
  }

  // 2. auth_secrets existe pero INCOMPLETO (parcial) -> flag, no pisar.
  if (authExists && ap.partial) {
    return mk(uid, 'incomplete_auth_secrets', 'flag_incomplete', null, ap.version, null, 'auth_secrets parcial');
  }

  // 3. roles INCOMPLETO (solo hash o solo salt) -> flag, no migrable.
  if (rp.partial) {
    return mk(uid, 'incomplete_roles', 'flag_incomplete', null, null, PW_VERSION_LEGACY, 'roles parcial (falta hash o salt)');
  }

  // 4. roles COMPLETO legacy + sin auth_secrets usable -> candidato a backfill.
  if (rp.complete) {
    let needsReset = null;
    if (typeof matchesDefault === 'function') {
      try {
        const m = matchesDefault(uid, rolesData);
        needsReset = m === true ? true : m === false ? false : null;
      } catch (_e) {
        needsReset = null;
      }
    }
    const cat = needsReset === true ? 'needs_reset' : 'legacy_only';
    return mk(uid, cat, 'backfill_legacy', needsReset, null, PW_VERSION_LEGACY, 'migrable (sha256-legacy)');
  }

  // 5. auth_secrets huérfano con password pero roles sin nada -> inconsistencia.
  if (authExists && !ap.complete && !ap.partial && rp.none) {
    return mk(uid, 'no_creds', 'skip_no_creds', null, ap.version, null, 'sin credencial');
  }

  // 6. Sin credenciales en ningún lado -> sin gate, nada que migrar.
  return mk(uid, 'no_creds', 'skip_no_creds', null, null, null, 'sin credencial');
}

function mk(uid, category, action, needsReset, authVersion, rolesVersion, note) {
  return { uid, category, action, needsReset, authVersion, rolesVersion, note };
}

/**
 * Construye el payload de migración para /auth_secrets (sha256-legacy).
 * NO se loguea: contiene hash+salt. Solo lo usa el wrapper en --apply.
 * @param {any} rolesData
 * @param {string} nowIso
 * @returns {{record: any}}
 */
function computeBackfillRecord(rolesData, nowIso) {
  const r = rolesData || {};
  return {
    record: {
      pwVersion: PW_VERSION_LEGACY,
      passwordHash: String(r.passwordHash),
      passwordSalt: String(r.passwordSalt),
      migratedFrom: 'roles',
      migratedAt: nowIso,
      migratedBy: 'scripts/audit/BA_auth_secrets_backfill.cjs',
    },
  };
}

/**
 * Plan de corrida. Dry-run (default) => writes SIEMPRE vacío.
 * @param {Array<ReturnType<typeof classifyUser>>} rows
 * @param {Object} opts
 * @param {boolean} [opts.apply]
 * @param {(uid:string)=>any} [opts.rolesDataFor]  para construir el record (apply)
 * @param {string} [opts.nowIso]
 * @returns {{writes: Array<{uid:string, record:any}>, summary: Record<string, number>, flagged: string[]}}
 */
function planRun(rows, opts = {}) {
  const apply = opts.apply === true;
  const nowIso = opts.nowIso || new Date().toISOString();
  /** @type {Array<{uid:string, record:any}>} */
  const writes = [];
  /** @type {Record<string, number>} */
  const summary = {};
  const flagged = [];
  for (const row of rows) {
    summary[row.category] = (summary[row.category] || 0) + 1;
    summary['action:' + row.action] = (summary['action:' + row.action] || 0) + 1;
    if (row.needsReset === true) summary.needs_reset_flag = (summary.needs_reset_flag || 0) + 1;
    if (row.action.startsWith('flag_')) flagged.push(row.uid);
    if (row.action === 'backfill_legacy' && apply) {
      const rd = typeof opts.rolesDataFor === 'function' ? opts.rolesDataFor(row.uid) : null;
      if (rd && hasStr(rd.passwordHash) && hasStr(rd.passwordSalt)) {
        writes.push({ uid: row.uid, record: computeBackfillRecord(rd, nowIso).record });
      }
    }
  }
  summary.total = rows.length;
  summary.writes_planned = writes.length;
  return { writes, summary, flagged };
}

/**
 * Guard de proyecto: impide --apply sobre el proyecto equivocado.
 * @param {Object} a
 * @param {string|null|undefined} a.activeProjectId   proyecto VERIFICADO (resolveProjectIdentity.project) o null
 * @param {string} a.expectedProjectId
 * @param {string|null|undefined} a.confirmProjectArg  valor de --confirm-project=
 * @param {boolean} a.apply
 * @param {boolean} [a.identityVerified]  debe ser true para permitir --apply
 * @param {string} [a.identityReason]
 * @returns {{allowed: boolean, reason: string}}
 */
function resolveProjectGuard({ activeProjectId, expectedProjectId, confirmProjectArg, apply, identityVerified, identityReason }) {
  if (!apply) return { allowed: true, reason: 'dry-run (sin writes)' };
  // Fail-closed (fix guard ADC): --apply exige identidad VERIFICADA explícita.
  // Cualquier valor distinto de true (false, undefined, ausente) bloquea.
  if (identityVerified !== true) {
    return {
      allowed: false,
      reason: 'identidad de proyecto no verificada' + (identityReason ? ': ' + identityReason : ''),
    };
  }
  if (!hasStr(activeProjectId)) {
    return { allowed: false, reason: 'projectId activo no resuelto; abortar apply' };
  }
  if (activeProjectId !== expectedProjectId) {
    return { allowed: false, reason: `projectId activo (${activeProjectId}) != esperado (${expectedProjectId})` };
  }
  if (confirmProjectArg !== expectedProjectId) {
    return { allowed: false, reason: 'falta --confirm-project=' + expectedProjectId };
  }
  return { allowed: true, reason: 'apply autorizado sobre ' + expectedProjectId };
}

/**
 * Fila segura para loguear: NUNCA incluye secretos.
 * @param {ReturnType<typeof classifyUser>} row
 */
function toLogRow(row) {
  const safe = {
    uid: row.uid,
    category: row.category,
    action: row.action,
    needsReset: row.needsReset,
    authVersion: row.authVersion,
    rolesVersion: row.rolesVersion,
    note: row.note,
  };
  for (const f of SECRET_FIELDS) {
    if (f in safe) delete (/** @type {any} */ (safe))[f];
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Identidad del proyecto del operador (fix guard ADC, 2026-11-11).
//
// Fuentes (independientes entre sí):
//  - gcloud config: `gcloud config get-value project` invocado con el entorno
//    SANEADO (sin CLOUDSDK_CORE_PROJECT / CLOUDSDK_ACTIVE_CONFIG_NAME), para que
//    refleje la configuración persistida y no un override de entorno. Fuente
//    FUERTE.
//  - ADC (el archivo que usa firebase-admin): si es service_account, su
//    project_id es FUERTE. Si es authorized_user, solo trae quota_project_id
//    (proyecto de cuota/facturación, NO la identidad): DÉBIL. Si no coincide,
//    bloquea; si coincide, no alcanza para confirmar.
//  - Variables de entorno (GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT /
//    CLOUDSDK_CORE_PROJECT): manipulables, NUNCA suficientes. Solo pueden
//    bloquear si contradicen.
//  - Sonda de lectura del destino con las credenciales ADC: obligatoria.
// EXPECTED_PROJECT nunca se usa como fallback para declarar la identidad.
// ---------------------------------------------------------------------------

/** Formato de projectId de GCP: 6–30, minúsculas/dígitos/guiones, empieza con letra. */
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * Clasifica un valor de proyecto.
 * @param {any} v
 * @returns {{status: 'ok'|'unset'|'invalid', value: string|null}}
 */
function classifyProjectValue(v) {
  if (v === undefined || v === null) return { status: 'unset', value: null };
  const s = String(v).trim();
  if (s === '' || s === '(unset)') return { status: 'unset', value: null };
  if (!PROJECT_ID_RE.test(s)) return { status: 'invalid', value: null };
  return { status: 'ok', value: s };
}

/**
 * Interpreta el resultado de spawnSync de `gcloud config get-value project`.
 * Observado (Cloud SDK 570): si no está seteado, stdout vacío, `(unset)` en
 * stderr y exit 0. Solo se mira la primera línea de stdout.
 * @param {{error?: any, status?: number|null, stdout?: string|null}} r
 * @returns {{status: 'ok'|'unset'|'invalid'|'error', value: string|null, reason: string}}
 */
function parseGcloudGetValueResult(r) {
  if (!r) return { status: 'error', value: null, reason: 'sin resultado' };
  if (r.error) {
    const code = (r.error && (r.error.code || r.error.name)) || 'error';
    return { status: 'error', value: null, reason: `no se pudo invocar gcloud (${code})` };
  }
  if (typeof r.status === 'number' && r.status !== 0) {
    return { status: 'error', value: null, reason: `gcloud salió con código ${r.status}` };
  }
  if (r.status === null || r.status === undefined) {
    return { status: 'error', value: null, reason: 'gcloud terminado sin código (timeout/señal)' };
  }
  const first = String(r.stdout || '').split(/\r?\n/)[0];
  const c = classifyProjectValue(first);
  const reason =
    c.status === 'ok' ? 'gcloud config' : c.status === 'unset' ? 'gcloud sin proyecto configurado' : 'salida de gcloud con formato inválido';
  return { status: c.status, value: c.value, reason };
}

/**
 * Extrae del JSON de ADC SOLO metadatos no sensibles. Nunca devuelve
 * refresh_token, client_secret, private_key, client_email ni account.
 * @param {string} text
 * @returns {{status: 'ok'|'invalid', type: string|null, projectId: string|null, quotaProjectId: string|null}}
 */
function parseAdcMetadata(text) {
  let j;
  try {
    j = JSON.parse(String(text));
  } catch (_e) {
    return { status: 'invalid', type: null, projectId: null, quotaProjectId: null };
  }
  if (!j || typeof j !== 'object' || typeof j.type !== 'string') {
    return { status: 'invalid', type: null, projectId: null, quotaProjectId: null };
  }
  const pid = classifyProjectValue(j.project_id);
  const qid = classifyProjectValue(j.quota_project_id);
  return {
    status: 'ok',
    type: j.type,
    projectId: pid.status === 'ok' ? pid.value : pid.status === 'invalid' ? '__invalid__' : null,
    quotaProjectId: qid.status === 'ok' ? qid.value : qid.status === 'invalid' ? '__invalid__' : null,
  };
}

/**
 * Resuelve si la identidad del proyecto del operador está VERIFICADA.
 * Verificada <=> sonda OK && >=1 confirmación fuerte == esperado && 0 contradicciones.
 * @param {Object} a
 * @param {string} a.expectedProjectId
 * @param {Record<string, string|undefined>} [a.envProjects]
 * @param {{status: string, value: string|null, reason?: string}} [a.gcloud]
 * @param {{status: string, type?: string|null, projectId?: string|null, quotaProjectId?: string|null}} [a.adc]
 * @param {boolean} a.probeOk
 * @returns {{verified: boolean, project: string|null, confirmations: string[], contradictions: string[], reason: string}}
 */
function resolveProjectIdentity({ expectedProjectId, envProjects, gcloud, adc, probeOk }) {
  const confirmations = [];
  const contradictions = [];
  const exp = expectedProjectId;

  // Entorno: solo puede contradecir.
  for (const [name, raw] of Object.entries(envProjects || {})) {
    const c = classifyProjectValue(raw);
    if (c.status === 'invalid') contradictions.push(`env ${name} inválida`);
    else if (c.status === 'ok' && c.value !== exp) contradictions.push(`env ${name}=${c.value}`);
  }

  // gcloud config (fuerte).
  if (gcloud) {
    if (gcloud.status === 'ok') {
      if (gcloud.value === exp) confirmations.push('gcloud config');
      else contradictions.push(`gcloud config=${gcloud.value}`);
    } else if (gcloud.status === 'invalid') {
      contradictions.push('gcloud config con formato inválido');
    }
    // 'unset' / 'error' => no confirma ni contradice (ausencia de fuente).
  }

  // ADC.
  if (adc && adc.status === 'ok') {
    if (adc.projectId === '__invalid__') contradictions.push('ADC project_id inválido');
    else if (adc.projectId) {
      if (adc.type === 'service_account' && adc.projectId === exp) confirmations.push('ADC service_account');
      else if (adc.projectId !== exp) contradictions.push(`ADC project_id=${adc.projectId}`);
    }
    if (adc.quotaProjectId === '__invalid__') contradictions.push('ADC quota_project_id inválido');
    else if (adc.quotaProjectId && adc.quotaProjectId !== exp) {
      contradictions.push(`ADC quota_project_id=${adc.quotaProjectId}`);
    }
  }

  let reason;
  let verified = false;
  if (contradictions.length) reason = 'contradicción: ' + contradictions.join('; ');
  else if (!probeOk) reason = 'no se pudo leer el destino con las credenciales ADC';
  else if (!confirmations.length) reason = 'sin fuente independiente que confirme el proyecto (gcloud config o ADC service_account)';
  else {
    verified = true;
    reason = 'confirmado por ' + confirmations.join(' + ') + ' y lectura del destino';
  }
  return { verified, project: verified ? exp : null, confirmations, contradictions, reason };
}

// ---------------------------------------------------------------------------
// Diagnóstico ampliado (Tarea 61, 2026-11-11). SOLO conteos agregados.
// Nada de lo que sale de acá contiene uids, emails, hashes, salts ni TOTP.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const KNOWN_ROLES = Object.freeze(['admin', 'gerente', 'vendedor', 'interno', 'viewer', 'unassigned']);

/** Rol normalizado; desconocido → 'otro'; ausente → 'sin_rol'. @param {any} rolesData */
function normalizeRole(rolesData) {
  const r = rolesData && typeof rolesData.role === 'string' ? rolesData.role.trim().toLowerCase() : '';
  if (!r) return 'sin_rol';
  return KNOWN_ROLES.includes(r) ? r : 'otro';
}

/**
 * Estado TOTP en /roles como BOOLEANOS (nunca el secreto).
 * @param {any} rolesData
 * @returns {{enabled: boolean, secret: boolean}}
 */
function totpFlags(rolesData) {
  const d = rolesData || {};
  return { enabled: d.totpEnabled === true, secret: hasStr(d.totpSecret) };
}

/**
 * Proveedores de login de Firebase Auth a partir de providerData (sin emails).
 * @param {any} authUser
 * @returns {{google: boolean, password: boolean, other: boolean}}
 */
function authProviderFlags(authUser) {
  const ids = ((authUser && authUser.providerData) || []).map((p) => p && p.providerId);
  return {
    google: ids.some((id) => id === 'google.com'),
    password: ids.includes('password'),
    other: ids.some((x) => x && x !== 'google.com' && x !== 'password'),
  };
}

/**
 * Antigüedad del último inicio de sesión.
 * @param {string|null|undefined} lastSignInTime  metadata.lastSignInTime (UTC string) o vacío
 * @param {number} nowMs
 * @returns {'lt30'|'d30to90'|'gt90'|'never'|'invalid'}
 */
function bucketLastSignIn(lastSignInTime, nowMs) {
  if (!lastSignInTime) return 'never';
  const t = Date.parse(String(lastSignInTime));
  if (!Number.isFinite(t)) return 'invalid';
  const days = (nowMs - t) / DAY_MS;
  if (days < 30) return 'lt30';
  if (days <= 90) return 'd30to90';
  return 'gt90';
}

/** La más reciente de dos fechas (strings UTC); null si ninguna parsea. */
function latestTime(a, b) {
  const ta = a ? Date.parse(String(a)) : NaN;
  const tb = b ? Date.parse(String(b)) : NaN;
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return a || b || null;
  return new Date(Math.max(Number.isFinite(ta) ? ta : -Infinity, Number.isFinite(tb) ? tb : -Infinity)).toUTCString();
}

/**
 * Lee Firebase Auth en lotes (getUsers acepta hasta 100 identificadores).
 * Nunca lanza: los lotes que fallan quedan como `failed` (dato no disponible).
 * Devuelve datos por uid SOLO para uso interno; jamás se imprimen.
 * @param {{getUsers: (ids: Array<{uid: string}>) => Promise<{users: any[], notFound?: any[]}>, uids: string[], chunkSize?: number}} a
 * @returns {Promise<{byUid: Map<string, {providerData: any[], lastSignInTime: string|null, lastRefreshTime: string|null}>, notFound: Set<string>, failed: Set<string>, errorCodes: string[]}>}
 */
async function collectAuthUsers({ getUsers, uids, chunkSize }) {
  const size = Math.min(Math.max(1, chunkSize || 100), 100);
  /** @type {Map<string, {providerData: any[], lastSignInTime: string|null, lastRefreshTime: string|null}>} */
  const byUid = new Map();
  const notFound = new Set();
  const failed = new Set();
  const errorCodes = [];
  for (let i = 0; i < uids.length; i += size) {
    const chunk = uids.slice(i, i + size);
    try {
      const res = await getUsers(chunk.map((uid) => ({ uid })));
      const seen = new Set();
      for (const u of (res && res.users) || []) {
        if (!u || !u.uid) continue;
        seen.add(u.uid);
        byUid.set(u.uid, {
          providerData: (u.providerData || []).map((p) => ({ providerId: p && p.providerId })),
          lastSignInTime: (u.metadata && u.metadata.lastSignInTime) || null,
          lastRefreshTime: (u.metadata && u.metadata.lastRefreshTime) || null,
        });
      }
      for (const uid of chunk) if (!seen.has(uid)) notFound.add(uid);
    } catch (e) {
      // Solo el código de error (los mensajes pueden traer identificadores).
      errorCodes.push(String((e && (e.code || e.name)) || 'error'));
      for (const uid of chunk) failed.add(uid);
    }
  }
  return { byUid, notFound, failed, errorCodes };
}

/** @param {Record<string, number>} obj @param {string} k */
function inc(obj, k) {
  obj[k] = (obj[k] || 0) + 1;
}

/**
 * Agregados del diagnóstico. Entrada interna por uid; SALIDA solo conteos.
 * @param {Object} a
 * @param {Array<{uid: string, category: string, needsReset: (boolean|null)}>} a.rows
 * @param {(uid: string) => any} a.rolesDataFor
 * @param {{byUid: Map<string, any>, notFound: Set<string>, failed: Set<string>, errorCodes?: string[]}|null} a.auth  null = Auth no consultado/no disponible
 * @param {boolean} a.candidateProvided  si se pasó D8_DEFAULT_CANDIDATE (sin su valor)
 * @param {number} a.nowMs
 */
function buildDiagnosticAggregates({ rows, rolesDataFor, auth, candidateProvided, nowMs }) {
  /** @type {Record<string, Record<string, number>>} */
  const byCategoryRole = {};
  /** @type {Record<string, number>} */
  const byRole = {};
  const totp = { enabled: 0, secret: 0, both: 0, enabledWithoutSecret: 0, secretWithoutEnabled: 0, none: 0 };
  const providers = { google: 0, password: 0, both: 0, other: 0, noProvider: 0, noAuthUser: 0, unavailable: 0 };
  const lastSignIn = { lt30: 0, d30to90: 0, gt90: 0, never: 0, invalid: 0, noAuthUser: 0, unavailable: 0 };
  /** @type {Record<string, number>} categorías con gate (legacy_only/needs_reset) × antigüedad */
  const gateAccountsLastSignIn = { lt30: 0, d30to90: 0, gt90: 0, never: 0, invalid: 0, noAuthUser: 0, unavailable: 0 };
  /** Última actividad = la más reciente entre lastSignInTime y lastRefreshTime (sesión persistente). */
  const lastActivity = { lt30: 0, d30to90: 0, gt90: 0, never: 0, invalid: 0, noAuthUser: 0, unavailable: 0 };
  const gateAccountsLastActivity = { lt30: 0, d30to90: 0, gt90: 0, never: 0, invalid: 0, noAuthUser: 0, unavailable: 0 };
  let needsReset = 0;

  for (const row of rows) {
    // P2-1 (review): una fila 'error' es una falla al leer /auth_secrets; los
    // datos de /roles pueden estar. Si no hay, el rol queda 'no_disponible'.
    const rd = rolesDataFor(row.uid);
    const role = rd ? normalizeRole(rd) : 'no_disponible';
    byCategoryRole[row.category] = byCategoryRole[row.category] || {};
    inc(byCategoryRole[row.category], role);
    inc(byRole, role);
    if (row.needsReset === true) needsReset++;

    if (rd) {
      const t = totpFlags(rd);
      if (t.enabled) totp.enabled++;
      if (t.secret) totp.secret++;
      if (t.enabled && t.secret) totp.both++;
      else if (t.enabled) totp.enabledWithoutSecret++;
      else if (t.secret) totp.secretWithoutEnabled++;
      else totp.none++;
    }

    const isGate = row.category === 'legacy_only' || row.category === 'needs_reset';
    let bucket;
    let activityBucket;
    if (!auth || auth.failed.has(row.uid) || (row.category === 'error' && !auth.byUid.has(row.uid))) {
      // Auth no consultado para esta cuenta: NO es "sin usuario Auth".
      providers.unavailable++;
      bucket = 'unavailable';
      activityBucket = 'unavailable';
    } else if (auth.notFound.has(row.uid) || !auth.byUid.has(row.uid)) {
      providers.noAuthUser++;
      bucket = 'noAuthUser';
      activityBucket = 'noAuthUser';
    } else {
      const u = auth.byUid.get(row.uid);
      const p = authProviderFlags(u);
      if (p.google) providers.google++;
      if (p.password) providers.password++;
      if (p.google && p.password) providers.both++;
      if (p.other) providers.other++;
      if (!p.google && !p.password && !p.other) providers.noProvider++;
      bucket = bucketLastSignIn(u.lastSignInTime, nowMs);
      activityBucket = bucketLastSignIn(latestTime(u.lastSignInTime, u.lastRefreshTime), nowMs);
    }
    lastSignIn[bucket]++;
    lastActivity[activityBucket]++;
    if (isGate) {
      gateAccountsLastSignIn[bucket]++;
      gateAccountsLastActivity[activityBucket]++;
    }
  }

  return {
    total: rows.length,
    byRole,
    byCategoryRole,
    totp,
    providers,
    lastSignIn,
    gateAccountsLastSignIn,
    lastActivity,
    gateAccountsLastActivity,
    needsReset: candidateProvided ? needsReset : null, // null = no evaluado
    authStatus: !auth ? 'no_disponible' : auth.failed.size ? 'parcial' : 'ok',
    authErrorCodes: auth && auth.errorCodes ? Array.from(new Set(auth.errorCodes)) : [],
  };
}

/**
 * Render del reporte ampliado: SOLO conteos. Nunca recibe uids sueltos ni secretos.
 * @param {ReturnType<typeof buildDiagnosticAggregates>} ag
 * @param {Record<string, number>} summary
 * @returns {string[]}
 */
function renderDiagnosticReport(ag, summary) {
  const L = [];
  const s = summary || {};
  const fmt = (o) =>
    Object.entries(o)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(vacío)';
  L.push('Diagnóstico ampliado (solo conteos agregados)');
  L.push(`  total de cuentas (/roles): ${ag.total}`);
  L.push(
    `  por categoría: legacy_only=${s.legacy_only || 0}, needs_reset=${s.needs_reset || 0}, already_migrated=${s.already_migrated || 0}, no_creds=${s.no_creds || 0}, incomplete_roles=${s.incomplete_roles || 0}, incomplete_auth_secrets=${s.incomplete_auth_secrets || 0}, inconsistent=${s.inconsistent || 0}, error=${s.error || 0}`
  );
  L.push(`  por rol: ${fmt(ag.byRole)}`);
  for (const cat of Object.keys(ag.byCategoryRole).sort()) L.push(`  ${cat} × rol: ${fmt(ag.byCategoryRole[cat])}`);
  L.push(
    `  TOTP en /roles: totpEnabled=${ag.totp.enabled}, totpSecret=${ag.totp.secret}, ambos=${ag.totp.both}, enabled_sin_secret=${ag.totp.enabledWithoutSecret}, secret_sin_enabled=${ag.totp.secretWithoutEnabled}, ninguno=${ag.totp.none}`
  );
  L.push(`  Firebase Auth: ${ag.authStatus}${ag.authErrorCodes.length ? ' (códigos: ' + ag.authErrorCodes.join(', ') + ')' : ''}`);
  L.push(
    `  proveedor de login (una cuenta con Google y contraseña cuenta en google, en email_password y en ambos; la suma puede superar el total): google=${ag.providers.google}, email_password=${ag.providers.password}, ambos=${ag.providers.both}, otro=${ag.providers.other}, sin_proveedor=${ag.providers.noProvider}, sin_usuario_auth=${ag.providers.noAuthUser}, no_disponible=${ag.providers.unavailable}`
  );
  const ls = (o) =>
    `<30d=${o.lt30}, 30-90d=${o.d30to90}, >90d=${o.gt90}, nunca=${o.never}, fecha_inválida=${o.invalid}, sin_usuario_auth=${o.noAuthUser}, no_disponible=${o.unavailable}`;
  L.push(`  último inicio de sesión (todas): ${ls(ag.lastSignIn)}`);
  L.push(`  último inicio de sesión (cuentas con gate legacy): ${ls(ag.gateAccountsLastSignIn)}`);
  L.push(`  última actividad = login o refresh de sesión (todas): ${ls(ag.lastActivity)}`);
  L.push(`  última actividad (cuentas con gate legacy): ${ls(ag.gateAccountsLastActivity)}`);
  L.push(`  needs_reset: ${ag.needsReset === null ? 'no evaluado (sin D8_DEFAULT_CANDIDATE)' : ag.needsReset}`);
  return L;
}

module.exports = {
  KNOWN_ROLES,
  normalizeRole,
  totpFlags,
  authProviderFlags,
  bucketLastSignIn,
  latestTime,
  collectAuthUsers,
  buildDiagnosticAggregates,
  renderDiagnosticReport,
  PROJECT_ID_RE,
  classifyProjectValue,
  parseGcloudGetValueResult,
  parseAdcMetadata,
  resolveProjectIdentity,
  SECRET_FIELDS,
  PW_VERSION_CURRENT,
  PW_VERSION_LEGACY,
  authSecretPwState,
  rolesPwState,
  classifyUser,
  computeBackfillRecord,
  planRun,
  resolveProjectGuard,
  toLogRow,
};
