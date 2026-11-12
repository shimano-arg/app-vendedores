// @ts-check
/**
 * D8 — Tarea 61: diagnóstico ampliado (solo conteos agregados).
 * Sin Firebase real: core puro + e2e con firebase-admin STUB en un directorio temporal.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const core = require('../../../scripts/audit/lib/auth-secrets-backfill-core.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-11T12:00:00Z');

// Centinelas: si alguno aparece en una salida, hay fuga.
const S = {
  uid: 'UIDSENTINEL0000000000000001',
  email: 'persona.sentinela@ejemplo.test',
  hash: 'HASHSENTINELabcdef',
  salt: 'SALTSENTINEL1234',
  totp: 'TOTPSENTINELBASE32',
  candidate: 'CANDIDATOSENTINELA',
};

describe('helpers puros', () => {
  it('normalizeRole', () => {
    expect(core.normalizeRole({ role: 'Admin ' })).toBe('admin');
    expect(core.normalizeRole({ role: 'vendedor' })).toBe('vendedor');
    expect(core.normalizeRole({ role: 'superuser' })).toBe('otro');
    expect(core.normalizeRole({})).toBe('sin_rol');
    expect(core.normalizeRole(null)).toBe('sin_rol');
  });
  it('totpFlags devuelve solo booleanos', () => {
    expect(core.totpFlags({ totpEnabled: true, totpSecret: S.totp })).toEqual({
      enabled: true,
      secret: true,
    });
    expect(core.totpFlags({ totpEnabled: 'true' })).toEqual({ enabled: false, secret: false });
    expect(JSON.stringify(core.totpFlags({ totpEnabled: true, totpSecret: S.totp }))).not.toContain(
      S.totp
    );
  });
  it('authProviderFlags', () => {
    expect(core.authProviderFlags({ providerData: [{ providerId: 'google.com' }] })).toEqual({
      google: true,
      password: false,
      other: false,
    });
    expect(
      core.authProviderFlags({
        providerData: [{ providerId: 'password' }, { providerId: 'google.com' }],
      })
    ).toEqual({ google: true, password: true, other: false });
    expect(core.authProviderFlags({ providerData: [{ providerId: 'microsoft.com' }] }).other).toBe(
      true
    );
    expect(core.authProviderFlags({})).toEqual({ google: false, password: false, other: false });
  });
  it('bucketLastSignIn: bordes 30 y 90 días', () => {
    const at = (d) => new Date(NOW - d * DAY).toUTCString();
    expect(core.bucketLastSignIn(at(0), NOW)).toBe('lt30');
    expect(core.bucketLastSignIn(at(29.9), NOW)).toBe('lt30');
    expect(core.bucketLastSignIn(at(30), NOW)).toBe('d30to90');
    expect(core.bucketLastSignIn(at(90), NOW)).toBe('d30to90');
    expect(core.bucketLastSignIn(at(90.1), NOW)).toBe('gt90');
    expect(core.bucketLastSignIn(null, NOW)).toBe('never');
    expect(core.bucketLastSignIn('', NOW)).toBe('never');
    expect(core.bucketLastSignIn('no es fecha', NOW)).toBe('invalid');
  });
});

describe('collectAuthUsers — lotes, faltantes y errores parciales', () => {
  it('parte en lotes de <=100 y marca notFound', async () => {
    const uids = Array.from({ length: 250 }, (_, i) => 'u' + i);
    const calls = [];
    const r = await core.collectAuthUsers({
      uids,
      getUsers: async (ids) => {
        calls.push(ids.length);
        return {
          users: ids
            .filter((x) => x.uid !== 'u7')
            .map((x) => ({
              uid: x.uid,
              providerData: [{ providerId: 'google.com', email: S.email }],
              metadata: { lastSignInTime: new Date(NOW).toUTCString() },
            })),
        };
      },
    });
    expect(calls).toEqual([100, 100, 50]);
    expect(r.notFound.has('u7')).toBe(true);
    expect(r.byUid.size).toBe(249);
    // No conserva el email del providerData.
    expect(JSON.stringify([...r.byUid.values()])).not.toContain(S.email);
  });
  it('un lote que falla queda como failed (no lanza) y solo guarda el código', async () => {
    const uids = Array.from({ length: 150 }, (_, i) => 'u' + i);
    let n = 0;
    const r = await core.collectAuthUsers({
      uids,
      getUsers: async (ids) => {
        n++;
        if (n === 2)
          throw Object.assign(new Error(`fallo con ${S.uid}`), {
            code: 'auth/insufficient-permission',
          });
        return { users: ids.map((x) => ({ uid: x.uid, providerData: [], metadata: {} })) };
      },
    });
    expect(r.failed.size).toBe(50);
    expect(r.errorCodes).toEqual(['auth/insufficient-permission']);
    expect(JSON.stringify(r.errorCodes)).not.toContain(S.uid);
  });
});

/** 18 cuentas con la distribución del dry-run real (14 no_creds + 4 legacy_only). */
function fixture18() {
  const roles = new Map();
  const rows = [];
  const authUsers = new Map();
  for (let i = 0; i < 18; i++) {
    const uid = i === 0 ? S.uid : 'uid' + i;
    const legacy = i < 4;
    const role =
      ['admin', 'vendedor', 'vendedor', 'gerente'][i] ||
      (i < 10 ? 'vendedor' : i < 14 ? 'unassigned' : 'viewer');
    const rd = {
      role,
      email: S.email,
      ...(legacy ? { passwordHash: S.hash, passwordSalt: S.salt } : {}),
      ...(i === 1 ? { totpEnabled: true, totpSecret: S.totp } : {}),
      ...(i === 5 ? { totpEnabled: true } : {}),
    };
    roles.set(uid, rd);
    rows.push(core.classifyUser({ uid, rolesData: rd, authSecretData: null }));
    if (i !== 17) {
      authUsers.set(uid, {
        providerData: [{ providerId: i === 2 ? 'password' : 'google.com' }],
        lastSignInTime: i === 16 ? null : new Date(NOW - [5, 45, 120][i % 3] * DAY).toUTCString(),
      });
    }
  }
  return { roles, rows, authUsers };
}

describe('buildDiagnosticAggregates — conteos', () => {
  it('distribución real: 14 no_creds + 4 legacy_only, con rol, TOTP, proveedor y antigüedad', () => {
    const { roles, rows, authUsers } = fixture18();
    const auth = {
      byUid: authUsers,
      notFound: new Set(['uid17']),
      failed: new Set(),
      errorCodes: [],
    };
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: (u) => roles.get(u),
      auth,
      candidateProvided: false,
      nowMs: NOW,
    });
    const summary = core.planRun(rows, { apply: false }).summary;
    expect(summary.legacy_only).toBe(4);
    expect(summary.no_creds).toBe(14);
    expect(ag.total).toBe(18);
    expect(ag.byCategoryRole.legacy_only).toEqual({ admin: 1, vendedor: 2, gerente: 1 });
    expect(ag.byRole.unassigned).toBe(4);
    expect(ag.totp).toMatchObject({
      enabled: 2,
      secret: 1,
      both: 1,
      enabledWithoutSecret: 1,
      secretWithoutEnabled: 0,
      none: 16,
    });
    expect(ag.providers).toMatchObject({
      google: 16,
      password: 1,
      both: 0,
      noAuthUser: 1,
      unavailable: 0,
    });
    expect(ag.lastSignIn.never).toBe(1);
    expect(ag.lastSignIn.noAuthUser).toBe(1);
    expect(
      ag.lastSignIn.lt30 +
        ag.lastSignIn.d30to90 +
        ag.lastSignIn.gt90 +
        ag.lastSignIn.never +
        ag.lastSignIn.noAuthUser
    ).toBe(18);
    expect(Object.values(ag.gateAccountsLastSignIn).reduce((a, b) => a + b, 0)).toBe(4);
    expect(ag.needsReset).toBeNull(); // sin candidato = no evaluado
    expect(ag.authStatus).toBe('ok');
  });

  it('needs_reset se cuenta solo si se proveyó candidato', () => {
    const { roles, rows } = fixture18();
    const rows2 = rows.map((r, i) =>
      i < 2 ? { ...r, category: 'needs_reset', needsReset: true } : r
    );
    const ag = core.buildDiagnosticAggregates({
      rows: rows2,
      rolesDataFor: (u) => roles.get(u),
      auth: null,
      candidateProvided: true,
      nowMs: NOW,
    });
    expect(ag.needsReset).toBe(2);
  });

  it('Auth no disponible → proveedor y antigüedad "no_disponible", sin inventar', () => {
    const { roles, rows } = fixture18();
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: (u) => roles.get(u),
      auth: null,
      candidateProvided: false,
      nowMs: NOW,
    });
    expect(ag.authStatus).toBe('no_disponible');
    expect(ag.providers.unavailable).toBe(18);
    expect(ag.providers.google).toBe(0);
    expect(ag.lastSignIn.unavailable).toBe(18);
  });

  it('error parcial de Auth → estado parcial y esas cuentas como no_disponible', () => {
    const { roles, rows, authUsers } = fixture18();
    const failed = new Set(['uid10', 'uid11']);
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: (u) => roles.get(u),
      auth: { byUid: authUsers, notFound: new Set(), failed, errorCodes: ['unavailable'] },
      candidateProvided: false,
      nowMs: NOW,
    });
    expect(ag.authStatus).toBe('parcial');
    expect(ag.providers.unavailable).toBe(2);
    expect(ag.authErrorCodes).toEqual(['unavailable']);
  });

  it('fila con error de lectura → rol no_disponible, no rompe', () => {
    const rows = [core.classifyUser({ uid: 'x', readError: true })];
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: () => null,
      auth: null,
      candidateProvided: false,
      nowMs: NOW,
    });
    expect(ag.byRole).toEqual({ no_disponible: 1 });
  });
});

describe('Privacidad del reporte', () => {
  it('render y JSON de agregados sin uid, email, hash, salt, TOTP ni candidato', () => {
    const { roles, rows, authUsers } = fixture18();
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: (u) => roles.get(u),
      auth: { byUid: authUsers, notFound: new Set(), failed: new Set(), errorCodes: [] },
      candidateProvided: true,
      nowMs: NOW,
    });
    const out =
      core.renderDiagnosticReport(ag, core.planRun(rows, { apply: false }).summary).join('\n') +
      JSON.stringify(ag);
    for (const v of Object.values(S)) expect(out).not.toContain(v);
  });
});

describe('Dry-run e2e (firebase-admin STUB): sin escrituras y sin datos individuales', () => {
  it('corre el script real, 0 escrituras, salida solo agregada, candidato no impreso', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd8-e2e-'));
    try {
      const proj = path.join(tmp, 'proj');
      fs.mkdirSync(path.join(proj, 'scripts', 'audit', 'lib'), { recursive: true });
      fs.mkdirSync(path.join(proj, 'functions', 'node_modules', 'firebase-admin'), {
        recursive: true,
      });
      for (const f of [
        'scripts/audit/BA_auth_secrets_backfill.cjs',
        'scripts/audit/lib/auth-secrets-backfill-core.cjs',
      ])
        fs.copyFileSync(path.join(ROOT, f), path.join(proj, f));
      const stub = `
const writes=[]; const S=${JSON.stringify(S)};
const docs=[
 {id:S.uid,data:()=>({role:'admin',email:S.email,passwordHash:S.hash,passwordSalt:S.salt,totpEnabled:true,totpSecret:S.totp})},
 {id:'uid2',data:()=>({role:'vendedor'})},
 {id:'uid3',data:()=>({role:'unassigned'})},
];
const col=(name)=>({
 limit:()=>({get:async()=>({docs:docs.slice(0,1)})}),
 get:async()=>({docs}),
 doc:(id)=>({get:async()=>({exists:false,data:()=>null}),set:()=>writes.push(1),update:()=>writes.push(1),delete:()=>writes.push(1)}),
 add:()=>writes.push(1),
});
const app={options:{}};
module.exports={apps:[],initializeApp(o){app.options=o;this.apps.push(app);return app;},app:()=>app,
 firestore:()=>({collection:col,runTransaction:async()=>{writes.push(1);throw new Error('no');},batch:()=>({set(){writes.push(1)},commit:async()=>writes.push(1)})}),
 auth:()=>({getUsers:async(ids)=>({users:ids.filter(x=>x.uid!=='uid3').map(x=>({uid:x.uid,email:S.email,providerData:[{providerId:'google.com',email:S.email,uid:S.email}],metadata:{lastSignInTime:new Date().toUTCString()}}))})}),
};
process.on('exit',()=>process.stdout.write('\\n[stub-writes]='+writes.length+'\\n'));`;
      fs.writeFileSync(
        path.join(proj, 'functions', 'node_modules', 'firebase-admin', 'index.js'),
        stub
      );
      for (const extra of [[], ['--json']]) {
        const r = spawnSync(
          process.execPath,
          [path.join(proj, 'scripts', 'audit', 'BA_auth_secrets_backfill.cjs'), ...extra],
          {
            cwd: proj,
            encoding: 'utf8',
            env: {
              PATH: '',
              D8_DEFAULT_CANDIDATE: S.candidate,
              SystemRoot: process.env.SystemRoot || '',
            },
            timeout: 30000,
          }
        );
        const out = (r.stdout || '') + (r.stderr || '');
        expect(out).toContain('[stub-writes]=0');
        expect(out).toContain('DRY-RUN: no se escribió nada.');
        expect(out).not.toMatch(/\[APPLY\]/);
        for (const v of Object.values(S)) expect(out).not.toContain(v);
        if (extra.length) {
          const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
          expect(json.rows).toBeUndefined();
          expect(json.flagged).toBeUndefined();
          expect(json.aggregates.total).toBe(3);
          expect(json.aggregates.providers.noAuthUser).toBe(1);
          expect(json.aggregates.totp.both).toBe(1);
        } else {
          expect(out).toContain('Diagnóstico ampliado (solo conteos agregados)');
          expect(out).toMatch(/needs_reset: 0/);
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);
});

describe('Correcciones de la revisión independiente (P2-1, P2-6)', () => {
  it('P2-1: fila "error" (falla de auth_secrets) usa el rol de /roles y NO cuenta como sin_usuario_auth', () => {
    const rows = [
      core.classifyUser({ uid: 'e1', readError: true }),
      core.classifyUser({ uid: 'e2', readError: true }),
    ];
    const roles = new Map([['e1', { role: 'vendedor', totpEnabled: true, totpSecret: S.totp }]]);
    const auth = { byUid: new Map(), notFound: new Set(), failed: new Set(), errorCodes: [] };
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: (u) => roles.get(u) || null,
      auth,
      candidateProvided: false,
      nowMs: NOW,
    });
    expect(ag.byRole).toEqual({ vendedor: 1, no_disponible: 1 });
    expect(ag.totp.both).toBe(1);
    expect(ag.providers.noAuthUser).toBe(0);
    expect(ag.providers.unavailable).toBe(2);
    expect(ag.lastSignIn.unavailable).toBe(2);
  });
  it('P2-1: fila "error" con usuario Auth presente se cuenta normalmente', () => {
    const rows = [core.classifyUser({ uid: 'e1', readError: true })];
    const auth = {
      byUid: new Map([
        [
          'e1',
          {
            providerData: [{ providerId: 'google.com' }],
            lastSignInTime: new Date(NOW).toUTCString(),
          },
        ],
      ]),
      notFound: new Set(),
      failed: new Set(),
      errorCodes: [],
    };
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: () => ({ role: 'admin' }),
      auth,
      candidateProvided: false,
      nowMs: NOW,
    });
    expect(ag.providers.google).toBe(1);
    expect(ag.lastSignIn.lt30).toBe(1);
  });
  it('P2-6: última actividad = máximo entre lastSignInTime y lastRefreshTime', () => {
    const rows = [
      core.classifyUser({
        uid: 'a',
        rolesData: { role: 'vendedor', passwordHash: 'h', passwordSalt: 's' },
        authSecretData: null,
      }),
    ];
    const auth = {
      byUid: new Map([
        [
          'a',
          {
            providerData: [{ providerId: 'google.com' }],
            lastSignInTime: new Date(NOW - 200 * DAY).toUTCString(),
            lastRefreshTime: new Date(NOW - 2 * DAY).toUTCString(),
          },
        ],
      ]),
      notFound: new Set(),
      failed: new Set(),
      errorCodes: [],
    };
    const ag = core.buildDiagnosticAggregates({
      rows,
      rolesDataFor: () => ({ role: 'vendedor' }),
      auth,
      candidateProvided: false,
      nowMs: NOW,
    });
    expect(ag.lastSignIn.gt90).toBe(1);
    expect(ag.lastActivity.lt30).toBe(1);
    expect(ag.gateAccountsLastActivity.lt30).toBe(1);
    expect(core.renderDiagnosticReport(ag, {}).join('\n')).toMatch(
      /la suma puede superar el total/
    );
  });
  it('P2-6: collectAuthUsers conserva lastRefreshTime', async () => {
    const r = await core.collectAuthUsers({
      uids: ['a'],
      getUsers: async () => ({
        users: [{ uid: 'a', metadata: { lastSignInTime: 'x', lastRefreshTime: 'y' } }],
      }),
    });
    expect(r.byUid.get('a')).toMatchObject({ lastSignInTime: 'x', lastRefreshTime: 'y' });
  });
  it('P2-6: --limit inválido se marca y no se interpreta como número', () => {
    const w = require('../../../scripts/audit/BA_auth_secrets_backfill.cjs');
    expect(w.parseArgs(['--limit=abc'])).toMatchObject({ limit: Infinity, limitInvalid: true });
    expect(w.parseArgs(['--limit=0']).limitInvalid).toBe(true);
    expect(w.parseArgs(['--limit=5'])).toMatchObject({ limit: 5, limitInvalid: false });
    expect(w.parseArgs([]).limitInvalid).toBe(false);
  });
});
