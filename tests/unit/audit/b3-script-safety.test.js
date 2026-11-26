// @ts-check
/**
 * B3 script safety tests (S-9).
 *
 * Verifica las 3 capas de defensa del script
 * scripts/audit/B3_dry_run_delete_secrets_roles.cjs:
 *   1) --apply sin --confirm-project → exit 1 con mensaje.
 *   2) --apply con --confirm-project incorrecto → exit 1 con mensaje.
 *   3) --apply con --confirm-project=app-vendedores-shimano → exit 1
 *      (bloqueo humano sigue activo; CLAUDE.md §70 B3).
 *   4) Modo dry-run (sin flags) → parseArgs devuelve shape esperada y
 *      los helpers puros arman el backup payload correcto. La ejecución
 *      end-to-end del dry-run requiere firebase-admin + Firestore reales,
 *      así que el contrato dry-run se valida via helpers puros + grep del
 *      source (no hace network).
 *
 * Los tests de --apply usan subprocess porque los 3 paths exitean ANTES
 * de requerir firebase-admin (require es lazy dentro de main() post gate
 * humano). El dry-run NO corre end-to-end: el script importa
 * firebase-admin al inicio de la rama dry-run y pega contra Firestore
 * real, lo cual rompería el principio de tests aislados.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const SCRIPT_REL = '../../../scripts/audit/B3_dry_run_delete_secrets_roles.cjs';
const {
  parseArgs,
  validateConfirmProject,
  buildBackupPayload,
  buildBackupPath,
  redactUid,
  listSensitiveFieldsPresent,
  SENSITIVE_FIELDS,
  SLUG,
  EXPECTED_PROJECT,
} = require(SCRIPT_REL);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, SCRIPT_REL);

/**
 * Corre el script en un subprocess con los args pasados. Devuelve
 * { status, stdout, stderr } sin tirar — los tests chequean status.
 * @param {string[]} args
 */
function runScript(args) {
  const r = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

describe('B3 script safety — helpers puros', () => {
  it('parseArgs captura --apply, --json, --limit, --confirm-project', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      json: false,
      limit: Infinity,
      confirmProject: undefined,
    });

    expect(parseArgs(['--apply'])).toEqual({
      apply: true,
      json: false,
      limit: Infinity,
      confirmProject: undefined,
    });

    expect(parseArgs(['--apply', '--confirm-project=app-vendedores-shimano'])).toEqual({
      apply: true,
      json: false,
      limit: Infinity,
      confirmProject: 'app-vendedores-shimano',
    });

    expect(parseArgs(['--apply', '--confirm-project=WRONG'])).toEqual({
      apply: true,
      json: false,
      limit: Infinity,
      confirmProject: 'WRONG',
    });

    // confirmProject vacío string (--confirm-project= sin valor): distinto a undefined.
    expect(parseArgs(['--apply', '--confirm-project=']).confirmProject).toBe('');

    expect(parseArgs(['--json', '--limit=5']).limit).toBe(5);
  });

  it('validateConfirmProject: --apply sin flag → missing', () => {
    const r = validateConfirmProject({ apply: true, confirmProject: undefined });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing');
  });

  it('validateConfirmProject: --apply con string vacío → missing', () => {
    const r = validateConfirmProject({ apply: true, confirmProject: '' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing');
  });

  it('validateConfirmProject: --apply con project equivocado → mismatch', () => {
    const r = validateConfirmProject({ apply: true, confirmProject: 'otro-proyecto' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch');
  });

  it('validateConfirmProject: --apply + project correcto → ok', () => {
    const r = validateConfirmProject({
      apply: true,
      confirmProject: EXPECTED_PROJECT,
    });
    expect(r.ok).toBe(true);
  });

  it('validateConfirmProject: sin --apply ignora confirmProject', () => {
    expect(validateConfirmProject({ apply: false, confirmProject: undefined }).ok).toBe(true);
    expect(validateConfirmProject({ apply: false, confirmProject: 'cualquier-cosa' }).ok).toBe(
      true
    );
  });

  it('buildBackupPath vive en scripts/audit/output/ con prefijo B3_backup_', () => {
    const p = buildBackupPath(new Date('2026-11-26T12:00:00.000Z'));
    expect(p).toMatch(/[\\/]scripts[\\/]audit[\\/]output[\\/]B3_backup_/);
    expect(p).toMatch(/\.json$/);
  });

  it('buildBackupPayload en dry-run: shape + nota correcta + totals coherentes', () => {
    const payload = buildBackupPayload({
      slug: SLUG,
      mode: 'dry-run',
      rolesDocsSize: 42,
      processed: 42,
      docsWithAnySensitive: 7,
      fieldCounts: { passwordHash: 5, passwordSalt: 5, totpSecret: 3, totpEnabled: 3 },
      rows: [
        {
          uid: 'LaBF...06r2',
          hasFields: ['passwordHash', 'passwordSalt'],
          auth_secrets_sync: 'yes',
        },
      ],
    });
    expect(payload.slug).toBe(SLUG);
    expect(payload.mode).toBe('dry-run');
    expect(payload.project).toBe(EXPECTED_PROJECT);
    expect(payload.totals.rolesDocs).toBe(42);
    expect(payload.totals.docsWithAnySensitive).toBe(7);
    expect(payload.totals.byField.passwordHash).toBe(5);
    expect(payload.rows.length).toBe(1);
    expect(payload.note).toContain('dry-run');
    expect(payload.note).toContain('NO se escribe');
    // No persiste valores de secretos: el payload debería contener los
    // NOMBRES de los fields (passwordHash, totpSecret, etc.) pero jamás un
    // VALOR plausible (hex largo, bcrypt-like prefix, base32 TOTP secret, etc.).
    const dump = JSON.stringify(payload);
    expect(dump).not.toMatch(/\b\$2[aby]\$/); // bcrypt prefix
    expect(dump).not.toMatch(/[A-Fa-f0-9]{32,}/); // hex > 31 chars (hash-like)
    expect(dump).not.toMatch(/\b[A-Z2-7]{16,}\b/); // base32 ≥16 (TOTP secret shape)
  });

  it('buildBackupPayload en apply: nota de persistencia distinta', () => {
    const payload = buildBackupPayload({
      slug: SLUG,
      mode: 'apply',
      rolesDocsSize: 1,
      processed: 1,
      docsWithAnySensitive: 0,
      fieldCounts: { passwordHash: 0, passwordSalt: 0, totpSecret: 0, totpEnabled: 0 },
      rows: [],
    });
    expect(payload.mode).toBe('apply');
    expect(payload.note).toContain('apply');
    expect(payload.note).toContain('snapshot pre-write');
  });

  it('redactUid preserva 4 chars de cada extremo', () => {
    expect(redactUid('LaBFi1xkSLObzLEdRoP8fonZ06r2')).toBe('LaBF...06r2');
    expect(redactUid('abc')).toBe('ab***');
  });

  it('listSensitiveFieldsPresent detecta los 4 campos y no filtra valor', () => {
    expect(listSensitiveFieldsPresent({})).toEqual([]);
    expect(listSensitiveFieldsPresent({ passwordHash: 'x' })).toEqual(['passwordHash']);
    expect(listSensitiveFieldsPresent({ passwordHash: null, totpSecret: 's' })).toEqual([
      'totpSecret',
    ]);
    const all = listSensitiveFieldsPresent({
      passwordHash: 'a',
      passwordSalt: 'b',
      totpSecret: 'c',
      totpEnabled: true,
    });
    expect(all).toEqual(['passwordHash', 'passwordSalt', 'totpSecret', 'totpEnabled']);
  });

  it('SENSITIVE_FIELDS inmutable + cubre los 4 campos esperados', () => {
    expect(SENSITIVE_FIELDS).toEqual(['passwordHash', 'passwordSalt', 'totpSecret', 'totpEnabled']);
    expect(Object.isFrozen(SENSITIVE_FIELDS)).toBe(true);
  });
});

describe('B3 script safety — subprocess gates', () => {
  it('--apply sin --confirm-project → exit 1 + mensaje "--apply requiere --confirm-project"', () => {
    const r = runScript(['--apply']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--apply requiere --confirm-project');
    expect(r.stderr).toContain(`Falta --confirm-project=${EXPECTED_PROJECT}`);
    // No llega al gate humano todavía — el missing-flag gate se adelanta.
    expect(r.stderr).not.toContain('autorización humana requerida');
  });

  it('--apply con --confirm-project= (vacío) → exit 1 con mensaje missing', () => {
    const r = runScript(['--apply', '--confirm-project=']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--apply requiere --confirm-project');
    expect(r.stderr).toContain('Falta --confirm-project');
  });

  it('--apply con --confirm-project equivocado → exit 1 + mensaje mismatch', () => {
    const r = runScript(['--apply', '--confirm-project=proyecto-incorrecto']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--apply requiere --confirm-project');
    expect(r.stderr).toContain('no coincide con el proyecto esperado');
    expect(r.stderr).toContain('proyecto-incorrecto');
    expect(r.stderr).toContain(EXPECTED_PROJECT);
    // Tampoco llega al gate humano.
    expect(r.stderr).not.toContain('autorización humana requerida');
  });

  it(`--apply con --confirm-project=${EXPECTED_PROJECT} → exit 1 (bloqueo humano sigue activo)`, () => {
    const r = runScript(['--apply', `--confirm-project=${EXPECTED_PROJECT}`]);
    expect(r.status).toBe(1);
    // Ahora SÍ llega al gate humano.
    expect(r.stderr).toContain('--apply BLOQUEADO');
    expect(r.stderr).toContain('autorización humana requerida');
    // Mensaje de mismatch/missing NO aparece (porque el flag es correcto).
    expect(r.stderr).not.toContain('--apply requiere --confirm-project');
    expect(r.stderr).not.toContain('Falta --confirm-project');
  });
});

describe('B3 script safety — contrato del source (grep)', () => {
  // El dry-run end-to-end requiere firebase-admin + Firestore real, así que
  // el contrato se valida grepando el source: (a) --apply jamás inicializa
  // batch de writes, (b) el backup pre-write existe en el flow apply.
  const SRC = readFileSync(SCRIPT_PATH, 'utf8');

  it('NUNCA usa db.batch(), batch.commit() ni collection(...).doc(...).update/set/delete', () => {
    expect(SRC).not.toMatch(/\.batch\s*\(\s*\)/);
    expect(SRC).not.toMatch(/batch\.commit\s*\(/);
    expect(SRC).not.toMatch(/\.update\s*\(/);
    expect(SRC).not.toMatch(/\.set\s*\(/);
    expect(SRC).not.toMatch(/\.delete\s*\(/);
    // Sí usa .get() (reads) — eso está permitido.
    expect(SRC).toMatch(/\.get\s*\(/);
  });

  it('--apply está gateado por console.error + exit 1 antes de cualquier admin init', () => {
    // Orden de los bloques: confirmProjectCheck → applyHumanGate → admin init.
    const idxAdminInit = SRC.indexOf(
      "require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'))"
    );
    const idxApplyGate = SRC.indexOf('[B3] --apply BLOQUEADO');
    const idxConfirmGate = SRC.indexOf('[B3] --apply requiere --confirm-project');
    expect(idxConfirmGate).toBeGreaterThan(0);
    expect(idxApplyGate).toBeGreaterThan(idxConfirmGate);
    expect(idxAdminInit).toBeGreaterThan(idxApplyGate);
  });

  it('el backup pre-write vive en scripts/audit/output/B3_backup_<timestamp>.json', () => {
    expect(SRC).toContain("'output'");
    expect(SRC).toContain('B3_backup_');
    // El write se dispara SOLO con args.apply === true.
    expect(SRC).toMatch(/if\s*\(\s*args\.apply\s*\)\s*\{[\s\S]*?writeFileSync[\s\S]*?backupPath/);
  });

  it('no filtra valores de secretos a console/log/stdout', () => {
    // Patrones que indicarían leak: console con .passwordHash, .totpSecret, etc.
    // El código solo loguea presencia (listSensitiveFieldsPresent devuelve nombres).
    const patterns = [
      /console\.(log|error|warn)\([^)]*\.passwordHash\b/,
      /console\.(log|error|warn)\([^)]*\.passwordSalt\b/,
      /console\.(log|error|warn)\([^)]*\.totpSecret\b/,
    ];
    for (const p of patterns) expect(SRC).not.toMatch(p);
  });
});
