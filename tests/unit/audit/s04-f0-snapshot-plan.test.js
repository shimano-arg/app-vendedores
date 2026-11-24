// @ts-check
/**
 * S04 Fase 0 — nuevos helpers del script BA_auth_secrets_backfill.cjs:
 *   - parseArgs(['--snapshot-dir=...']).snapshotDir
 *   - buildSnapshotPlan({...}) agregado SEGURO (sin uids/emails/hashes/salts/TOTP).
 *   - writeSnapshotPlanToDisk({...}) con fs inyectable.
 *
 * El script madre ya está hardened (tests legacy en d8-auth-secrets-backfill.test.js).
 * Acá solo cubrimos el agregado F0 (HARDENING6_30) + que no filtra secretos.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const wrapper = require('../../../scripts/audit/BA_auth_secrets_backfill.cjs');
const core = require('../../../scripts/audit/lib/auth-secrets-backfill-core.cjs');

const SENT_HASH = 'SENTINEL_HASH_zz99';
const SENT_SALT = 'SENTINEL_SALT_zz99';
const SENT_TOTP = 'SENTINEL_TOTP_zz99';
const SENT_UID = 'SENTINEL_UID_zz99';
const SENT_EMAIL = 'sentinel.email@example.com';

describe('S04 F0 — parseArgs --snapshot-dir', () => {
  it('sin flag: snapshotDir = null', () => {
    const a = wrapper.parseArgs([]);
    expect(a.snapshotDir).toBeNull();
  });

  it('--snapshot-dir=<path>: devuelve path', () => {
    const a = wrapper.parseArgs(['--snapshot-dir=/tmp/S04']);
    expect(a.snapshotDir).toBe('/tmp/S04');
  });

  it('--snapshot-dir soporta Windows paths con drive letter', () => {
    const a = wrapper.parseArgs(['--snapshot-dir=C:/Users/mariano/BACKFILL_S04']);
    expect(a.snapshotDir).toBe('C:/Users/mariano/BACKFILL_S04');
  });

  it('--snapshot-dir soporta paths con = embebido (joins el resto)', () => {
    const a = wrapper.parseArgs(['--snapshot-dir=/tmp/S04=audit']);
    expect(a.snapshotDir).toBe('/tmp/S04=audit');
  });

  it('coexiste con --apply + --confirm-project + --limit', () => {
    const a = wrapper.parseArgs([
      '--apply',
      '--confirm-project=app-vendedores-shimano',
      '--limit=3',
      '--snapshot-dir=./snapshots',
    ]);
    expect(a.apply).toBe(true);
    expect(a.confirmProject).toBe('app-vendedores-shimano');
    expect(a.limit).toBe(3);
    expect(a.snapshotDir).toBe('./snapshots');
  });
});

describe('S04 F0 — buildSnapshotPlan (agregado SEGURO)', () => {
  const buildPlan = () => {
    const rows = [
      core.classifyUser({
        uid: SENT_UID + '_A',
        rolesData: {
          passwordHash: SENT_HASH + '_A',
          passwordSalt: SENT_SALT + '_A',
          role: 'vendedor',
          email: SENT_EMAIL,
        },
        authSecretData: null,
      }),
      core.classifyUser({
        uid: SENT_UID + '_B',
        rolesData: {
          passwordHash: SENT_HASH + '_B',
          passwordSalt: SENT_SALT + '_B',
          totpSecret: SENT_TOTP + '_B',
          role: 'vendedor',
          email: SENT_EMAIL,
        },
        authSecretData: { pwVersion: 'scrypt-v2', pwHash: 'x', pwSalt: 'y' },
      }),
    ];
    const rolesDataFor = (uid) =>
      uid === SENT_UID + '_A'
        ? { passwordHash: SENT_HASH + '_A', passwordSalt: SENT_SALT + '_A', email: SENT_EMAIL }
        : null;
    const plan = core.planRun(rows, { apply: true, rolesDataFor, nowIso: '2026-11-24T10:00:00Z' });
    const aggregates = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor,
      auth: null,
      candidateProvided: false,
      nowMs: Date.parse('2026-11-24T10:00:00Z'),
    });
    return { plan, aggregates };
  };

  it('shape: tiene hallazgo=S04, fase=F0, slug, scriptVersion, notes[]', () => {
    const { plan, aggregates } = buildPlan();
    const snap = wrapper.buildSnapshotPlan({
      plan,
      aggregates,
      args: { apply: false, limit: Infinity },
      expectedProject: 'app-vendedores-shimano',
      mode: 'DRY-RUN',
    });
    expect(snap.hallazgo).toBe('S04');
    expect(snap.fase).toBe('F0');
    expect(typeof snap.generatedAt).toBe('string');
    expect(snap.mode).toBe('DRY-RUN');
    expect(snap.expectedProject).toBe('app-vendedores-shimano');
    expect(typeof snap.slug).toBe('string');
    expect(snap.scriptVersion).toBe('BA_auth_secrets_backfill.cjs');
    expect(Array.isArray(snap.notes)).toBe(true);
    expect(snap.notes.length).toBeGreaterThan(0);
  });

  it('summary + flaggedCount + writesPlanned + aggregates preservados', () => {
    const { plan, aggregates } = buildPlan();
    const snap = wrapper.buildSnapshotPlan({
      plan,
      aggregates,
      args: { apply: true, limit: 500 },
      expectedProject: 'app-vendedores-shimano',
      mode: 'APPLY',
    });
    expect(snap.summary.total).toBe(2);
    expect(snap.summary.legacy_only).toBeGreaterThanOrEqual(1);
    expect(snap.summary.already_migrated).toBeGreaterThanOrEqual(1);
    expect(snap.writesPlanned).toBe(plan.writes.length);
    expect(snap.flaggedCount).toBe(plan.flagged.length);
    expect(snap.aggregates).not.toBeNull();
    expect(snap.limitApplied).toBe(500);
  });

  it('limit Infinity → limitApplied = null (no se serializa Infinity)', () => {
    const { plan, aggregates } = buildPlan();
    const snap = wrapper.buildSnapshotPlan({
      plan,
      aggregates,
      args: { apply: false, limit: Infinity },
      expectedProject: 'app-vendedores-shimano',
      mode: 'DRY-RUN',
    });
    expect(snap.limitApplied).toBeNull();
    // Asegurar que JSON.stringify no rompe por Infinity ni NaN.
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain('Infinity');
    expect(serialized).not.toContain('NaN');
  });

  it('SIN uids, emails, hashes, salts ni TOTP en el JSON serializado', () => {
    const { plan, aggregates } = buildPlan();
    const snap = wrapper.buildSnapshotPlan({
      plan,
      aggregates,
      args: { apply: true, limit: 100 },
      expectedProject: 'app-vendedores-shimano',
      mode: 'DRY-RUN',
    });
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain(SENT_UID);
    expect(serialized).not.toContain(SENT_EMAIL);
    expect(serialized).not.toContain(SENT_HASH);
    expect(serialized).not.toContain(SENT_SALT);
    expect(serialized).not.toContain(SENT_TOTP);
  });

  it('notes incluye pre-condiciones F2 --apply (expectedProject + guard)', () => {
    const { plan, aggregates } = buildPlan();
    const snap = wrapper.buildSnapshotPlan({
      plan,
      aggregates,
      args: { apply: false, limit: Infinity },
      expectedProject: 'app-vendedores-shimano',
      mode: 'DRY-RUN',
    });
    const joined = snap.notes.join(' ');
    expect(joined).toContain('app-vendedores-shimano');
    expect(joined.toLowerCase()).toContain('--confirm-project');
    expect(joined.toLowerCase()).toMatch(/mariano|autoriza/i);
  });
});

describe('S04 F0 — writeSnapshotPlanToDisk (fs inyectable)', () => {
  it('escribe a <dir>/S04_backfill_plan_<YYYY-MM-DD>.json con JSON stringificado', () => {
    const captured = [];
    const logs = [];
    const mkdirCalls = [];
    const ok = wrapper.writeSnapshotPlanToDisk({
      dir: '/tmp/fake-S04',
      plan: { hallazgo: 'S04', writesPlanned: 7 },
      log: (m) => logs.push(m),
      mkdirSync: (d, opts) => mkdirCalls.push({ d, opts }),
      writeFileSync: (file, content, encoding) => captured.push({ file, content, encoding }),
      pathJoin: (...parts) => parts.join('/'),
    });
    expect(ok).toMatch(/^\/tmp\/fake-S04\/S04_backfill_plan_\d{4}-\d{2}-\d{2}\.json$/);
    expect(mkdirCalls).toHaveLength(1);
    expect(mkdirCalls[0].d).toBe('/tmp/fake-S04');
    expect(mkdirCalls[0].opts).toEqual({ recursive: true });
    expect(captured).toHaveLength(1);
    expect(captured[0].encoding).toBe('utf8');
    const parsed = JSON.parse(captured[0].content);
    expect(parsed.hallazgo).toBe('S04');
    expect(parsed.writesPlanned).toBe(7);
    expect(logs.some((l) => l.includes('/tmp/fake-S04/S04_backfill_plan_'))).toBe(true);
  });

  it('error en mkdirSync NO tira (fail-safe) — devuelve null + loguea', () => {
    const logs = [];
    const ok = wrapper.writeSnapshotPlanToDisk({
      dir: '/root/forbidden',
      plan: { hallazgo: 'S04' },
      log: (m) => logs.push(m),
      mkdirSync: () => {
        const e = new Error('EACCES: permission denied');
        /** @type {any} */ (e).code = 'EACCES';
        throw e;
      },
      writeFileSync: () => {
        throw new Error('no debe llegar');
      },
      pathJoin: (...p) => p.join('/'),
    });
    expect(ok).toBeNull();
    expect(logs.some((l) => l.toLowerCase().includes('falló'))).toBe(true);
    expect(logs.some((l) => l.includes('EACCES'))).toBe(true);
  });

  it('error en writeFileSync NO tira (fail-safe) — devuelve null', () => {
    const logs = [];
    const ok = wrapper.writeSnapshotPlanToDisk({
      dir: '/tmp/ok',
      plan: { hallazgo: 'S04' },
      log: (m) => logs.push(m),
      mkdirSync: () => {},
      writeFileSync: () => {
        const e = new Error('ENOSPC: no space');
        /** @type {any} */ (e).code = 'ENOSPC';
        throw e;
      },
      pathJoin: (...p) => p.join('/'),
    });
    expect(ok).toBeNull();
    expect(logs.some((l) => l.includes('ENOSPC'))).toBe(true);
  });
});
