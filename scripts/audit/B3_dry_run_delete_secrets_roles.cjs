// B3 — Stack CRM S-8 — DRY-RUN del borrado de campos sensibles en /roles.
//
// Contexto (PENDIENTE_HUMANO.md #1 + #15 + §70 B3): tras el fix S04 (#1445),
// los campos sensibles que todavía viven en /roles/* se quieren borrar para
// cerrar la deuda (ya no se leen por cliente; la fuente única es
// /auth_secrets/*). Este script ES SOLO DIAGNÓSTICO Y PLAN.
//
// MODO: dry-run por default. Imprime por doc:
//   { uid-redacted, hasFields: [...], auth_secrets_sync: yes/no }
// y totales por campo. CERO Firestore writes.
//
// --apply existe en el CLI pero está BLOQUEADO loud (console.error +
// process.exit(1)). Ejecutar borrado real requiere OK explícito Mariano +
// backfill previo (B2-a migrar login client + B2-c desactivar dual-write)
// ya mergeados y deployed. Ver PENDIENTE_HUMANO #15.
//
// Capas de defensa (S-9, 2026-11-26):
//   1) --confirm-project=app-vendedores-shimano REQUERIDO si se corre con --apply
//      (defensa contra apuntar al proyecto equivocado). Sin el flag o con
//      project incorrecto → exit 1 ANTES de llegar al gate humano.
//   2) --apply sigue BLOQUEADO con console.error + exit 1 (autorización humana).
//      Mariano ajusta ese bloqueo cuando autorice la ejecución real.
//   3) Backup JSON a disco pre-write: si en el futuro autorizado --apply +
//      --confirm-project ambos pasan, el script graba
//      scripts/audit/output/B3_backup_<timestamp>.json ANTES de cualquier write.
//      Permite reversibilidad (CLAUDE.md §55). En dry-run el shape del backup
//      se imprime pero no se persiste.
//
// Flags:
//   (default)              dry-run: cuenta + plan por doc. NO escribe nunca.
//   --apply                bloqueado: console.error + exit(1). Ver §70 CLAUDE.md.
//   --confirm-project=X    required con --apply para que la ejecución real
//                          pueda arrancar. X debe ser 'app-vendedores-shimano'.
//   --json                 output JSON machine-readable (sin uids, solo aggregates).
//   --limit=N              procesa solo N docs (debug local).
//
// Secretos: jamás se imprime el valor de passwordHash/passwordSalt/totpSecret.
// Solo booleanos "field present / absent" + timestamp de última escritura.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_PROJECT = 'app-vendedores-shimano';
const SLUG = 'B3_delete_secrets_roles_2026-11-25';
const SENSITIVE_FIELDS = Object.freeze([
  'passwordHash',
  'passwordSalt',
  'totpSecret',
  'totpEnabled',
]);

/**
 * Redacta un uid conservando primeros 4 y últimos 4 chars.
 * Ej: 'LaBFi1xkSLObzLEdRoP8fonZ06r2' -> 'LaBF...06r2'.
 * @param {string} uid
 */
function redactUid(uid) {
  const s = String(uid || '');
  if (s.length <= 10) return s.slice(0, 2) + '***';
  return s.slice(0, 4) + '...' + s.slice(-4);
}

/**
 * Parse CLI args sin librerías externas.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const limArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limArg && Number(limArg.split('=')[1]) > 0 ? Number(limArg.split('=')[1]) : Infinity;
  const confirmArg = argv.find((a) => a.startsWith('--confirm-project='));
  // Undefined = no se pasó. String vacío = se pasó vacío. String no vacío = valor.
  const confirmProject = confirmArg ? confirmArg.slice('--confirm-project='.length) : undefined;
  return { apply, json, limit, confirmProject };
}

/**
 * Lista campos sensibles presentes en el doc (no imprime valor).
 * @param {object} data
 */
function listSensitiveFieldsPresent(data) {
  const out = [];
  for (const f of SENSITIVE_FIELDS) {
    if (data && Object.prototype.hasOwnProperty.call(data, f) && data[f] !== null && data[f] !== undefined) {
      out.push(f);
    }
  }
  return out;
}

/**
 * Valida --confirm-project cuando --apply se pasó. Devuelve
 * { ok: boolean, reason?: 'missing' | 'mismatch' }. Siempre que ok=false,
 * el caller DEBE salir con exit 1 antes del gate humano. Si --apply no vino,
 * confirm-project es irrelevante y devuelve ok=true.
 * @param {{apply:boolean, confirmProject:(string|undefined)}} args
 */
function validateConfirmProject(args) {
  if (!args.apply) return { ok: true };
  if (args.confirmProject === undefined || args.confirmProject === '') {
    return { ok: false, reason: 'missing' };
  }
  if (args.confirmProject !== EXPECTED_PROJECT) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}

/**
 * Arma el shape del backup JSON pre-write. Idempotente, no toca disco.
 * Separa shape del write para que dry-run pueda imprimirlo sin persistir.
 * @param {{slug:string, mode:'dry-run'|'apply', rolesDocsSize:number,
 *          processed:number, docsWithAnySensitive:number,
 *          fieldCounts:object, rows:object[]}} input
 */
function buildBackupPayload(input) {
  const note = input.mode === 'dry-run'
    ? 'dry-run: este archivo NO se escribe hasta que --apply + --confirm-project sean autorizados.'
    : 'apply: snapshot pre-write persistido ANTES de borrar campos en /roles.';
  return {
    slug: input.slug,
    mode: input.mode,
    generatedAt: new Date().toISOString(),
    project: EXPECTED_PROJECT,
    totals: {
      rolesDocs: input.rolesDocsSize,
      processed: input.processed,
      docsWithAnySensitive: input.docsWithAnySensitive,
      byField: input.fieldCounts,
    },
    rows: input.rows,
    note,
  };
}

/**
 * Deriva el path del backup JSON a disco. Único por timestamp.
 * @param {Date} [now]
 */
function buildBackupPath(now) {
  const t = now || new Date();
  const nowIsoSafe = t.toISOString().replace(/[:.]/g, '-');
  return path.join(__dirname, 'output', `B3_backup_${nowIsoSafe}.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // CAPA 1: --confirm-project obligatorio si --apply fue pasado.
  // Esto corre ANTES del gate humano para dar un mensaje distinto cuando
  // el operador se olvidó el flag o apuntó al proyecto equivocado.
  const projCheck = validateConfirmProject(args);
  if (!projCheck.ok) {
    console.error('================================================================');
    console.error('[B3] --apply requiere --confirm-project');
    console.error('================================================================');
    if (projCheck.reason === 'missing') {
      console.error(`Falta --confirm-project=${EXPECTED_PROJECT}.`);
      console.error('Sin este flag el script no puede verificar que apuntás al');
      console.error('proyecto correcto. Rechazado antes de cualquier read/write.');
    } else {
      console.error(`--confirm-project recibido no coincide con el proyecto esperado.`);
      console.error(`  recibido: ${JSON.stringify(args.confirmProject)}`);
      console.error(`  esperado: ${JSON.stringify(EXPECTED_PROJECT)}`);
      console.error('Rechazado antes de cualquier read/write.');
    }
    console.error('');
    console.error('Uso autorizado (cuando Mariano levante el gate humano):');
    console.error(`  node ${path.basename(__filename)} --apply --confirm-project=${EXPECTED_PROJECT}`);
    console.error('');
    process.exit(1);
    return;
  }

  // CAPA 2: --apply BLOQUEADO (autorización humana). Incluso con
  // --confirm-project correcto, el gate humano sigue activo. Mariano ajusta
  // este bloqueo cuando autorice la ejecución real.
  if (args.apply) {
    console.error('================================================================');
    console.error('[B3] --apply BLOQUEADO');
    console.error('================================================================');
    console.error('autorización humana requerida');
    console.error('');
    console.error('Para ejecutar el borrado real se necesita:');
    console.error('  1) OK explícito Mariano (ver PENDIENTE_HUMANO #15 C1 nota B3).');
    console.error('  2) B2-c (stop dual-write) mergeado + deployed — sino cada delete');
    console.error('     se re-escribe en el próximo setPassword/setTotp.');
    console.error('  3) B2-a (migrar login client) mergeado + deployed — sino el login');
    console.error('     + TOTP sin secretos en /roles rompe.');
    console.error('  4) Backup previo (JSON snapshot en disco) — este script ya lo');
    console.error('     prepara abajo; sin --apply NO se graba.');
    console.error('');
    console.error('Capas de defensa activas (S-9):');
    console.error(`  - --confirm-project=${EXPECTED_PROJECT} (OK en este run).`);
    console.error('  - backup pre-write a scripts/audit/output/B3_backup_<timestamp>.json');
    console.error('    (reversibilidad, CLAUDE.md §55).');
    console.error('');
    console.error('Flow autorizado (cuando llegue el momento):');
    console.error('  - Mariano ajusta este bloqueo + preserva --confirm-project check.');
    console.error('  - Correr dry-run (sin --apply) + revisar JSON output.');
    console.error('  - Ejecutar manualmente con humano al teclado, nunca en CI.');
    console.error('');
    process.exit(1);
    return;
  }

  // Admin SDK lazy (solo en main; tests no lo necesitan).
  const admin = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: EXPECTED_PROJECT });
  const db = admin.firestore();

  if (!args.json) {
    console.log('================================================================');
    console.log('[B3] DRY-RUN — borrado de campos sensibles en /roles');
    console.log('================================================================');
    console.log(`destino (forzado): ${EXPECTED_PROJECT}`);
    console.log(`slug: ${SLUG}`);
    console.log(`campos monitoreados: ${SENSITIVE_FIELDS.join(', ')}`);
    console.log('');
  }

  // Lectura read-only de /roles.
  const rolesSnap = await db.collection('roles').get();
  const rows = [];
  const fieldCounts = Object.fromEntries(SENSITIVE_FIELDS.map((f) => [f, 0]));
  let processed = 0;
  let docsWithAnySensitive = 0;

  for (const doc of rolesSnap.docs) {
    if (processed >= args.limit) break;
    processed++;
    const uid = doc.id;
    const data = doc.data() || {};
    const hasFields = listSensitiveFieldsPresent(data);
    for (const f of hasFields) fieldCounts[f]++;
    if (hasFields.length === 0) continue;
    docsWithAnySensitive++;

    // Lectura read-only de /auth_secrets/<uid> para saber si el secret ya está migrado.
    let authSecretsSync = 'unknown';
    try {
      const asSnap = await db.collection('auth_secrets').doc(uid).get();
      if (asSnap.exists) {
        const asData = asSnap.data() || {};
        const hasPwInAs = !!(asData.passwordHash || (asData.password && asData.password.hash));
        const hasTotpInAs = !!(asData.totpSecret || (asData.totp && asData.totp.secret));
        // Marca "sync=yes" si todos los campos sensibles de /roles tienen correlato en /auth_secrets.
        const needsPwSync = hasFields.includes('passwordHash') || hasFields.includes('passwordSalt');
        const needsTotpSync = hasFields.includes('totpSecret') || hasFields.includes('totpEnabled');
        const pwOk = !needsPwSync || hasPwInAs;
        const totpOk = !needsTotpSync || hasTotpInAs;
        authSecretsSync = pwOk && totpOk ? 'yes' : 'no';
      } else {
        authSecretsSync = 'no';
      }
    } catch (_e) {
      authSecretsSync = 'error';
    }

    const row = { uid: redactUid(uid), hasFields, auth_secrets_sync: authSecretsSync };
    rows.push(row);

    if (!args.json) {
      console.log(
        `  ${row.uid}  hasFields=[${row.hasFields.join(',')}]  auth_secrets_sync=${row.auth_secrets_sync}`
      );
    }
  }

  // CAPA 3: Backup pre-write a disco.
  // Shape del backup es el mismo en dry-run y apply para que lo que se
  // imprime en dry-run sea exactamente lo que se persistiría. Solo cambia
  // 'mode' + 'note'.
  const mode = args.apply ? 'apply' : 'dry-run';
  const backupPath = buildBackupPath();
  const backupPayload = buildBackupPayload({
    slug: SLUG,
    mode,
    rolesDocsSize: rolesSnap.size,
    processed,
    docsWithAnySensitive,
    fieldCounts,
    rows,
  });

  // Dry-run: NO escribir a disco, solo imprimir el shape (si no es --json).
  // Apply autorizado futuro: escribir a disco ANTES de los writes Firestore
  // (permite reversibilidad, CLAUDE.md §55). Hoy el gate humano hace exit
  // antes de llegar acá, así que la rama apply no se ejecuta en runtime —
  // queda lista para cuando Mariano levante el bloqueo.
  if (args.apply) {
    const backupDir = path.dirname(backupPath);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2), 'utf8');
    if (!args.json) console.log(`Backup JSON persistido en: ${backupPath}`);
  }

  // Resumen.
  if (args.json) {
    console.log(JSON.stringify(backupPayload, null, 2));
  } else {
    console.log('');
    console.log('----------------------------------------------------------------');
    console.log('Totales:');
    console.log(`  /roles docs total: ${rolesSnap.size}`);
    console.log(`  procesados: ${processed}`);
    console.log(`  docs con al menos 1 campo sensible: ${docsWithAnySensitive}`);
    for (const f of SENSITIVE_FIELDS) console.log(`    ${f}: ${fieldCounts[f]}`);
    console.log('');
    console.log(`Backup JSON preview (NO escrito en dry-run): ${backupPath}`);
    console.log('----------------------------------------------------------------');
    console.log('');
    console.log('Para ejecutar el borrado real: autorización explícita Mariano + B2-a + B2-c completados.');
    console.log('Ver PENDIENTE_HUMANO #15 (C1 nota adicional) y §70 CLAUDE.md.');
  }
}

// Solo corre si se invoca directo.
if (require.main === module) {
  main().catch((e) => {
    console.error('fatal:', String((e && (e.code || e.name)) || 'error'));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  redactUid,
  listSensitiveFieldsPresent,
  validateConfirmProject,
  buildBackupPayload,
  buildBackupPath,
  SENSITIVE_FIELDS,
  SLUG,
  EXPECTED_PROJECT,
};
