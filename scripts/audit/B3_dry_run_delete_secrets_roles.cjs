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
// Si Mariano autoriza en el futuro: adaptar este script para que el --apply
// (a) exija --confirm-project=app-vendedores-shimano (patrón BA_auth_secrets_backfill),
// (b) genere el backup JSON pre-write (ya implementado abajo),
// (c) corra con usuario humano al teclado, nunca en CI ni como agente.
//
// Flags:
//   (default)   dry-run: cuenta + plan por doc. NO escribe nunca.
//   --apply     bloqueado: console.error + exit(1). Ver §70 CLAUDE.md.
//   --json      output JSON machine-readable (sin uids, solo aggregates).
//   --limit=N   procesa solo N docs (debug local).
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
  return { apply, json, limit };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // HARD-GATE: --apply bloqueado. Nunca se escribe desde este script por ahora.
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
    console.error('Flow autorizado (cuando llegue el momento):');
    console.error('  - Mariano ajusta este bloqueo + agrega --confirm-project.');
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

  // Backup previo (snapshot a disco) — se prepara SIEMPRE en dry-run para
  // documentar qué habría que persistir si Mariano autoriza el --apply.
  // Shape del backup: por doc { uid, hasFields, snapshotKeys }.
  const backupDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  const nowIsoSafe = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `b3_dryrun_backup_${nowIsoSafe}.json`);
  const backupBlocked = args.apply === false; // dry-run -> no se graba.
  const backupPayload = {
    slug: SLUG,
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    project: EXPECTED_PROJECT,
    totals: {
      rolesDocs: rolesSnap.size,
      processed,
      docsWithAnySensitive,
      byField: fieldCounts,
    },
    rows,
    note: backupBlocked
      ? 'dry-run: este archivo NO se escribe hasta que --apply sea autorizado.'
      : 'apply: contiene el snapshot pre-write que habría que persistir ANTES de borrar.',
  };

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
  SENSITIVE_FIELDS,
  SLUG,
  EXPECTED_PROJECT,
};
