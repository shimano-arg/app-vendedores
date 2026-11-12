// @ts-check
/**
 * D8 — tests del core del backfill /roles -> /auth_secrets (informe 56).
 * El core es PURO; estos tests no tocan Firebase ni el Admin SDK.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const core = require('../../../scripts/audit/lib/auth-secrets-backfill-core.cjs');
const wrapper = require('../../../scripts/audit/BA_auth_secrets_backfill.cjs');

// Valores centinela para el test de "no secretos en logs".
const SENT_HASH = 'SENTINEL_HASH_ab12';
const SENT_SALT = 'SENTINEL_SALT_cd34';
const SENT_TOTP = 'SENTINEL_TOTP_ef56';

const legacyRoles = () => ({
  passwordHash: SENT_HASH,
  passwordSalt: SENT_SALT,
  totpSecret: SENT_TOTP,
  role: 'vendedor',
});

describe('D8 backfill core — clasificación', () => {
  it('legacy_only: roles con hash+salt, sin auth_secrets → backfill_legacy', () => {
    const r = core.classifyUser({ uid: 'u1', rolesData: legacyRoles(), authSecretData: null });
    expect(r.category).toBe('legacy_only');
    expect(r.action).toBe('backfill_legacy');
  });

  it('already_migrated: auth_secrets scrypt-v2 completo → skip (idempotente)', () => {
    const r = core.classifyUser({
      uid: 'u2',
      rolesData: legacyRoles(),
      authSecretData: { pwVersion: 'scrypt-v2', pwHash: 'x', pwSalt: 'y' },
    });
    expect(r.category).toBe('already_migrated');
    expect(r.action).toBe('skip');
  });

  it('incomplete_roles: solo passwordHash (falta salt) → flag_incomplete', () => {
    const r = core.classifyUser({
      uid: 'u3',
      rolesData: { passwordHash: SENT_HASH },
      authSecretData: null,
    });
    expect(r.category).toBe('incomplete_roles');
    expect(r.action).toBe('flag_incomplete');
  });

  it('incomplete_auth_secrets: auth_secrets scrypt-v2 con pwHash pero sin pwSalt → flag', () => {
    const r = core.classifyUser({
      uid: 'u4',
      rolesData: legacyRoles(),
      authSecretData: { pwVersion: 'scrypt-v2', pwHash: 'x' },
    });
    expect(r.category).toBe('incomplete_auth_secrets');
    expect(r.action).toBe('flag_incomplete');
  });

  it('no_creds: roles sin password y sin auth_secrets → skip_no_creds', () => {
    const r = core.classifyUser({ uid: 'u5', rolesData: { role: 'viewer' }, authSecretData: null });
    expect(r.category).toBe('no_creds');
    expect(r.action).toBe('skip_no_creds');
  });

  it('inconsistent: auth_secrets legacy difiere del hash de roles → flag_inconsistent', () => {
    const r = core.classifyUser({
      uid: 'u6',
      rolesData: { passwordHash: 'AAA', passwordSalt: 's' },
      authSecretData: { pwVersion: 'sha256-legacy', passwordHash: 'BBB', passwordSalt: 's' },
    });
    expect(r.category).toBe('inconsistent');
    expect(r.action).toBe('flag_inconsistent');
  });

  it('needs_reset: matchesDefault=true → needs_reset + needsReset flag', () => {
    const r = core.classifyUser({
      uid: 'u7',
      rolesData: legacyRoles(),
      authSecretData: null,
      matchesDefault: () => true,
    });
    expect(r.category).toBe('needs_reset');
    expect(r.needsReset).toBe(true);
    expect(r.action).toBe('backfill_legacy');
  });

  it('readError → category error, no rompe', () => {
    const r = core.classifyUser({ uid: 'u8', readError: true });
    expect(r.category).toBe('error');
    expect(r.action).toBe('skip_error');
  });
});

describe('D8 backfill core — planRun (dry-run / apply / idempotencia / errores)', () => {
  const rowsFixture = () => [
    core.classifyUser({ uid: 'a', rolesData: legacyRoles(), authSecretData: null }), // backfill
    core.classifyUser({
      uid: 'b',
      rolesData: legacyRoles(),
      authSecretData: { pwVersion: 'scrypt-v2', pwHash: 'x', pwSalt: 'y' },
    }), // skip
    core.classifyUser({ uid: 'c', rolesData: { passwordHash: 'h' }, authSecretData: null }), // incomplete
    core.classifyUser({ uid: 'd', readError: true }), // error
  ];
  const rolesDataFor = (uid) => (uid === 'a' ? legacyRoles() : null);

  it('dry-run (default) NUNCA produce writes aunque haya backfill_legacy', () => {
    const plan = core.planRun(rowsFixture(), { apply: false, rolesDataFor });
    expect(plan.writes).toHaveLength(0);
    expect(plan.summary.writes_planned).toBe(0);
  });

  it('apply=true SÍ planifica writes para backfill_legacy (control: no es vacuo)', () => {
    const plan = core.planRun(rowsFixture(), {
      apply: true,
      rolesDataFor,
      nowIso: '2026-11-06T00:00:00Z',
    });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].uid).toBe('a');
    expect(plan.writes[0].record.pwVersion).toBe('sha256-legacy');
  });

  it('idempotencia: un uid ya migrado no genera write ni en apply', () => {
    const plan = core.planRun(rowsFixture(), { apply: true, rolesDataFor });
    expect(plan.writes.find((w) => w.uid === 'b')).toBeUndefined();
  });

  it('errores parciales: la fila error se cuenta y no aborta el resto', () => {
    const plan = core.planRun(rowsFixture(), { apply: true, rolesDataFor });
    expect(plan.summary.error).toBe(1);
    expect(plan.summary.total).toBe(4);
    // El backfill de 'a' igual se planificó pese al error de 'd'.
    expect(plan.writes).toHaveLength(1);
  });

  it('incompletos quedan en flagged', () => {
    const plan = core.planRun(rowsFixture(), { apply: false });
    expect(plan.flagged).toContain('c');
  });
});

describe('D8 backfill core — guard de proyecto', () => {
  const E = 'app-vendedores-shimano';
  it('dry-run siempre permitido', () => {
    expect(
      core.resolveProjectGuard({
        activeProjectId: 'cualquiera',
        expectedProjectId: E,
        apply: false,
      }).allowed
    ).toBe(true);
  });
  it('apply con proyecto equivocado → BLOQUEADO', () => {
    expect(
      core.resolveProjectGuard({
        activeProjectId: 'otro-proj',
        expectedProjectId: E,
        confirmProjectArg: E,
        apply: true,
      }).allowed
    ).toBe(false);
  });
  it('apply con proyecto correcto pero SIN --confirm-project → BLOQUEADO', () => {
    expect(
      core.resolveProjectGuard({
        activeProjectId: E,
        expectedProjectId: E,
        confirmProjectArg: null,
        apply: true,
      }).allowed
    ).toBe(false);
  });
  it('apply con proyecto correcto + confirm correcto + identidad verificada → permitido', () => {
    // Fix guard ADC (2026-11-11): el contrato ahora exige identityVerified===true.
    expect(
      core.resolveProjectGuard({
        activeProjectId: E,
        expectedProjectId: E,
        confirmProjectArg: E,
        apply: true,
        identityVerified: true,
      }).allowed
    ).toBe(true);
  });
  it('apply con proyecto correcto + confirm correcto SIN identidad verificada → BLOQUEADO (fail-closed)', () => {
    expect(
      core.resolveProjectGuard({
        activeProjectId: E,
        expectedProjectId: E,
        confirmProjectArg: E,
        apply: true,
      }).allowed
    ).toBe(false);
  });
  it('apply sin projectId resuelto → BLOQUEADO', () => {
    expect(
      core.resolveProjectGuard({
        activeProjectId: null,
        expectedProjectId: E,
        confirmProjectArg: E,
        apply: true,
      }).allowed
    ).toBe(false);
  });
});

describe('D8 backfill core — SIN secretos en logs', () => {
  it('toLogRow + summary + flagged no contienen hash/salt/totpSecret', () => {
    const rows = [
      core.classifyUser({ uid: 'a', rolesData: legacyRoles(), authSecretData: null }),
      core.classifyUser({ uid: 'b', rolesData: { passwordHash: SENT_HASH }, authSecretData: null }),
    ];
    const plan = core.planRun(rows, { apply: false });
    const logged = JSON.stringify({
      rows: rows.map(core.toLogRow),
      summary: plan.summary,
      flagged: plan.flagged,
    });
    expect(logged).not.toContain(SENT_HASH);
    expect(logged).not.toContain(SENT_SALT);
    expect(logged).not.toContain(SENT_TOTP);
  });

  it('computeBackfillRecord SÍ lleva hash+salt (payload de write, NO se loguea)', () => {
    const { record } = core.computeBackfillRecord(legacyRoles(), '2026-11-06T00:00:00Z');
    expect(record.passwordHash).toBe(SENT_HASH);
    expect(record.passwordSalt).toBe(SENT_SALT);
    // No arrastra el totpSecret (solo password).
    expect(JSON.stringify(record)).not.toContain(SENT_TOTP);
  });
});

describe('D8 backfill wrapper — helpers puros', () => {
  it('parseArgs: dry-run por defecto; --apply + --confirm-project parseados', () => {
    expect(wrapper.parseArgs([]).apply).toBe(false);
    const a = wrapper.parseArgs([
      '--apply',
      '--confirm-project=app-vendedores-shimano',
      '--limit=5',
    ]);
    expect(a.apply).toBe(true);
    expect(a.confirmProject).toBe('app-vendedores-shimano');
    expect(a.limit).toBe(5);
  });

  it('resolveActiveProjectId: desde credenciales del operador (env), no de app.options (fix P2)', () => {
    // Fuente = env del operador; fail-closed a null si no está.
    expect(wrapper.resolveActiveProjectId({})).toBeNull();
    expect(wrapper.resolveActiveProjectId({ GOOGLE_CLOUD_PROJECT: 'app-vendedores-shimano' })).toBe(
      'app-vendedores-shimano'
    );
    expect(wrapper.resolveActiveProjectId({ GCLOUD_PROJECT: 'otro-proj' })).toBe('otro-proj');
    // Con credenciales de OTRO proyecto, el guard de apply bloquea (ya no tautológico).
    const g = core.resolveProjectGuard({
      activeProjectId: wrapper.resolveActiveProjectId({ GOOGLE_CLOUD_PROJECT: 'otro-proj' }),
      expectedProjectId: wrapper.EXPECTED_PROJECT,
      confirmProjectArg: wrapper.EXPECTED_PROJECT,
      apply: true,
    });
    expect(g.allowed).toBe(false);
  });

  it('buildMatchesDefault: sin env → undefined (needsReset no evaluado)', () => {
    const prev = process.env.D8_DEFAULT_CANDIDATE;
    delete process.env.D8_DEFAULT_CANDIDATE;
    expect(wrapper.buildMatchesDefault()).toBeUndefined();
    if (prev !== undefined) process.env.D8_DEFAULT_CANDIDATE = prev;
  });

  it('buildMatchesDefault: con env, detecta el hash por defecto sin exponerlo', () => {
    const prev = process.env.D8_DEFAULT_CANDIDATE;
    process.env.D8_DEFAULT_CANDIDATE = 'CANDIDATO_X';
    const salt = 'deadbeef';
    const hash = wrapper.sha256Hex(salt + 'CANDIDATO_X');
    const fn = wrapper.buildMatchesDefault();
    expect(fn('u', { passwordSalt: salt, passwordHash: hash })).toBe(true);
    expect(fn('u', { passwordSalt: salt, passwordHash: 'otro' })).toBe(false);
    if (prev === undefined) delete process.env.D8_DEFAULT_CANDIDATE;
    else process.env.D8_DEFAULT_CANDIDATE = prev;
  });
});
