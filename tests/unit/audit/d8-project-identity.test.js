// @ts-check
/**
 * D8 — fix del guard de identidad del proyecto ADC (2026-11-11).
 * Pruebas puras: no invocan gcloud real, no tocan Firebase ni archivos reales.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const core = require('../../../scripts/audit/lib/auth-secrets-backfill-core.cjs');
const w = require('../../../scripts/audit/BA_auth_secrets_backfill.cjs');

const E = 'app-vendedores-shimano';
const OK_GC = { status: 'ok', value: E, reason: 'gcloud config' };
const ADC_USER = { status: 'ok', type: 'authorized_user', projectId: null, quotaProjectId: null };

/** Guard tal como lo arma el wrapper a partir de la identidad. */
const guardFrom = (id, confirm = E) =>
  core.resolveProjectGuard({
    activeProjectId: id.verified ? id.project : null,
    identityVerified: id.verified,
    identityReason: id.reason,
    expectedProjectId: E,
    confirmProjectArg: confirm,
    apply: true,
  });

describe('resolveProjectIdentity — casos pedidos', () => {
  it('proyecto correcto (gcloud config == esperado + sonda OK) → VERIFICADA y apply permitido', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      envProjects: {},
      gcloud: OK_GC,
      adc: ADC_USER,
      probeOk: true,
    });
    expect(id.verified).toBe(true);
    expect(id.project).toBe(E);
    expect(guardFrom(id).allowed).toBe(true);
  });

  it('caso real del operador: env vacío, gcloud config OK, ADC authorized_user sin quota → VERIFICADA', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      envProjects: {},
      gcloud: OK_GC,
      adc: ADC_USER,
      probeOk: true,
    });
    expect(id.verified).toBe(true);
  });

  it('proyecto distinto en gcloud config → NO verificada, apply bloqueado', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: { status: 'ok', value: 'otro-proyecto-x', reason: '' },
      adc: ADC_USER,
      probeOk: true,
    });
    expect(id.verified).toBe(false);
    expect(id.reason).toMatch(/contradicción/);
    expect(guardFrom(id).allowed).toBe(false);
  });

  it('proyecto no resuelto (gcloud unset, sin ADC, sin env) → NO verificada', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      envProjects: {},
      gcloud: { status: 'unset', value: null, reason: '' },
      adc: { status: 'absent' },
      probeOk: true,
    });
    expect(id.verified).toBe(false);
    expect(guardFrom(id).allowed).toBe(false);
  });

  it('variables de entorno ausentes no impiden verificar si gcloud confirma', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      envProjects: {},
      gcloud: OK_GC,
      adc: { status: 'absent' },
      probeOk: true,
    });
    expect(id.verified).toBe(true);
  });

  it('env == esperado SOLA no alcanza (manipulable) → NO verificada', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      envProjects: { GOOGLE_CLOUD_PROJECT: E, GCLOUD_PROJECT: E, CLOUDSDK_CORE_PROJECT: E },
      gcloud: { status: 'unset', value: null, reason: '' },
      adc: ADC_USER,
      probeOk: true,
    });
    expect(id.verified).toBe(false);
    expect(guardFrom(id).allowed).toBe(false);
  });

  it('env que contradice bloquea aunque gcloud confirme', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      envProjects: { GOOGLE_CLOUD_PROJECT: 'otro-proyecto-x' },
      gcloud: OK_GC,
      adc: ADC_USER,
      probeOk: true,
    });
    expect(id.verified).toBe(false);
    expect(id.contradictions.join()).toMatch(/GOOGLE_CLOUD_PROJECT/);
  });

  it('configuración gcloud con formato inválido → contradicción, bloqueado', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: { status: 'invalid', value: null, reason: '' },
      adc: ADC_USER,
      probeOk: true,
    });
    expect(id.verified).toBe(false);
    expect(guardFrom(id).allowed).toBe(false);
  });

  it('error al invocar gcloud y sin otra fuente fuerte → NO verificada', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: { status: 'error', value: null, reason: 'no se pudo invocar gcloud (ENOENT)' },
      adc: ADC_USER,
      probeOk: true,
    });
    expect(id.verified).toBe(false);
  });

  it('sonda de lectura del destino fallida → NO verificada aunque gcloud confirme', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: OK_GC,
      adc: ADC_USER,
      probeOk: false,
    });
    expect(id.verified).toBe(false);
    expect(id.reason).toMatch(/leer el destino/);
  });

  it('ADC service_account con project_id == esperado es confirmación fuerte (sin gcloud)', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: { status: 'error', value: null, reason: '' },
      adc: { status: 'ok', type: 'service_account', projectId: E, quotaProjectId: null },
      probeOk: true,
    });
    expect(id.verified).toBe(true);
  });

  it('ADC service_account de otro proyecto → contradicción', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: OK_GC,
      adc: {
        status: 'ok',
        type: 'service_account',
        projectId: 'otro-proyecto-x',
        quotaProjectId: null,
      },
      probeOk: true,
    });
    expect(id.verified).toBe(false);
  });

  it('ADC authorized_user: quota_project_id == esperado NO confirma por sí solo (no es identidad)', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: { status: 'unset', value: null, reason: '' },
      adc: { status: 'ok', type: 'authorized_user', projectId: null, quotaProjectId: E },
      probeOk: true,
    });
    expect(id.verified).toBe(false);
  });

  it('ADC authorized_user: quota_project_id distinto → contradicción (fail-closed)', () => {
    const id = core.resolveProjectIdentity({
      expectedProjectId: E,
      gcloud: OK_GC,
      adc: {
        status: 'ok',
        type: 'authorized_user',
        projectId: null,
        quotaProjectId: 'otro-proyecto-x',
      },
      probeOk: true,
    });
    expect(id.verified).toBe(false);
  });

  it('EXPECTED_PROJECT nunca se usa como fallback: sin fuentes, project es null', () => {
    const id = core.resolveProjectIdentity({ expectedProjectId: E, probeOk: true });
    expect(id.project).toBeNull();
    expect(id.verified).toBe(false);
  });
});

describe('parseGcloudGetValueResult — salida real de gcloud', () => {
  it('proyecto seteado', () => {
    expect(core.parseGcloudGetValueResult({ status: 0, stdout: E + '\n' })).toMatchObject({
      status: 'ok',
      value: E,
    });
  });
  it('sin proyecto (Cloud SDK 570: stdout vacío, "(unset)" en stderr, exit 0)', () => {
    expect(core.parseGcloudGetValueResult({ status: 0, stdout: '' }).status).toBe('unset');
    expect(core.parseGcloudGetValueResult({ status: 0, stdout: '(unset)\n' }).status).toBe('unset');
  });
  it('salida inválida', () => {
    expect(core.parseGcloudGetValueResult({ status: 0, stdout: 'ERROR: algo raro' }).status).toBe(
      'invalid'
    );
    expect(core.parseGcloudGetValueResult({ status: 0, stdout: 'Proyecto_Con_Mayus' }).status).toBe(
      'invalid'
    );
  });
  it('gcloud no instalado (ENOENT), exit != 0 y timeout → error', () => {
    expect(
      core.parseGcloudGetValueResult({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) })
        .status
    ).toBe('error');
    expect(core.parseGcloudGetValueResult({ status: 1, stdout: '' }).status).toBe('error');
    expect(core.parseGcloudGetValueResult({ status: null, stdout: '' }).status).toBe('error');
  });
});

describe('readGcloudConfigProject — invocación por plataforma', () => {
  const fakeSpawn = (result) => {
    const calls = [];
    const fn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return result;
    };
    return { fn, calls };
  };

  it('Windows: gcloud.cmd con shell:true; Linux: gcloud sin shell', () => {
    const a = fakeSpawn({ status: 0, stdout: E });
    w.readGcloudConfigProject({ spawnSync: a.fn, platform: 'win32', env: {} });
    expect(a.calls[0].cmd).toBe('gcloud.cmd');
    expect(a.calls[0].opts.shell).toBe(true);
    const b = fakeSpawn({ status: 0, stdout: E });
    w.readGcloudConfigProject({ spawnSync: b.fn, platform: 'linux', env: {} });
    expect(b.calls[0].cmd).toBe('gcloud');
    expect(b.calls[0].opts.shell).toBe(false);
    expect(b.calls[0].args).toEqual(['config', 'get-value', 'project']);
  });

  it('invoca gcloud SIN CLOUDSDK_CORE_PROJECT ni CLOUDSDK_ACTIVE_CONFIG_NAME (no manipulable por env)', () => {
    const a = fakeSpawn({ status: 0, stdout: E });
    w.readGcloudConfigProject({
      spawnSync: a.fn,
      platform: 'linux',
      env: {
        CLOUDSDK_CORE_PROJECT: 'otro-proyecto-x',
        CLOUDSDK_ACTIVE_CONFIG_NAME: 'x',
        CLOUDSDK_CONFIG: '/c',
        PATH: '/bin',
      },
    });
    const env = a.calls[0].opts.env;
    expect(env.CLOUDSDK_CORE_PROJECT).toBeUndefined();
    expect(env.CLOUDSDK_ACTIVE_CONFIG_NAME).toBeUndefined();
    expect(env.CLOUDSDK_CONFIG).toBe('/c');
    expect(env.PATH).toBe('/bin');
  });

  it('spawnSync que lanza → status error (nunca propaga)', () => {
    const r = w.readGcloudConfigProject({
      spawnSync: () => {
        throw Object.assign(new Error('EINVAL'), { code: 'EINVAL' });
      },
      platform: 'win32',
      env: {},
    });
    expect(r.status).toBe('error');
  });
});

describe('ADC — ruta y metadatos sin secretos', () => {
  // Fix multiplataforma (2026-11-11): rutas con IGUALDAD EXACTA. Antes se usaban
  // regex tolerantes ([\\/]) que aceptaban separadores mezclados y ocultaban que
  // resolveAdcPath usaba el `path` del HOST en vez de la plataforma pedida.
  it('ruta Linux exacta: GOOGLE_APPLICATION_CREDENTIALS > CLOUDSDK_CONFIG > ~/.config/gcloud', () => {
    expect(
      w.resolveAdcPath({
        env: { GOOGLE_APPLICATION_CREDENTIALS: '/k.json' },
        platform: 'linux',
        homedir: '/h',
      })
    ).toEqual({
      path: '/k.json',
      source: 'GOOGLE_APPLICATION_CREDENTIALS',
    });
    expect(
      w.resolveAdcPath({ env: { CLOUDSDK_CONFIG: '/c' }, platform: 'linux', homedir: '/h' }).path
    ).toBe('/c/application_default_credentials.json');
    expect(w.resolveAdcPath({ env: {}, platform: 'linux', homedir: '/h' }).path).toBe(
      '/h/.config/gcloud/application_default_credentials.json'
    );
    expect(w.resolveAdcPath({ env: {}, platform: 'linux', homedir: '' }).path).toBeNull();
  });

  it('ruta Windows exacta: GOOGLE_APPLICATION_CREDENTIALS > CLOUDSDK_CONFIG > %APPDATA%\\gcloud', () => {
    expect(
      w.resolveAdcPath({
        env: { GOOGLE_APPLICATION_CREDENTIALS: 'C:\\k.json' },
        platform: 'win32',
        homedir: 'C:\\U',
      }).path
    ).toBe('C:\\k.json');
    expect(
      w.resolveAdcPath({ env: { CLOUDSDK_CONFIG: 'D:\\cfg' }, platform: 'win32', homedir: 'C:\\U' })
        .path
    ).toBe('D:\\cfg\\application_default_credentials.json');
    expect(
      w.resolveAdcPath({
        env: { APPDATA: 'C:\\U\\AppData\\Roaming' },
        platform: 'win32',
        homedir: 'C:\\U',
      }).path
    ).toBe('C:\\U\\AppData\\Roaming\\gcloud\\application_default_credentials.json');
    expect(w.resolveAdcPath({ env: {}, platform: 'win32', homedir: 'C:\\U' }).path).toBeNull();
  });

  it('host simulado (Windows y Linux): la ruta depende de `platform`, nunca del `path` del host', () => {
    const nodeModule = require('node:module');
    const nodePath = require('node:path');
    const wrapperId = require.resolve('../../../scripts/audit/BA_auth_secrets_backfill.cjs');
    /** Carga el wrapper con node:path reemplazado por el path del host simulado. */
    const loadWithHostPath = (hostPath) => {
      const origLoad = nodeModule._load;
      delete require.cache[wrapperId];
      nodeModule._load = function (request, ...rest) {
        if (request === 'node:path' || request === 'path') return hostPath;
        return origLoad.call(this, request, ...rest);
      };
      try {
        return require(wrapperId);
      } finally {
        nodeModule._load = origLoad;
        delete require.cache[wrapperId];
      }
    };
    for (const [hostName, hostPath] of [
      ['host Windows', nodePath.win32],
      ['host Linux', nodePath.posix],
    ]) {
      const ww = loadWithHostPath(hostPath);
      expect(
        ww.resolveAdcPath({ env: { CLOUDSDK_CONFIG: '/c' }, platform: 'linux', homedir: '/h' })
          .path,
        hostName
      ).toBe('/c/application_default_credentials.json');
      expect(ww.resolveAdcPath({ env: {}, platform: 'linux', homedir: '/h' }).path, hostName).toBe(
        '/h/.config/gcloud/application_default_credentials.json'
      );
      expect(
        ww.resolveAdcPath({
          env: { APPDATA: 'C:\\U\\AppData\\Roaming' },
          platform: 'win32',
          homedir: 'C:\\U',
        }).path,
        hostName
      ).toBe('C:\\U\\AppData\\Roaming\\gcloud\\application_default_credentials.json');
    }
  });

  it('readAdcMetadata consulta exactamente la ruta de la plataforma pedida', () => {
    const seen = [];
    const fakeFs = {
      existsSync: (p) => {
        seen.push(p);
        return false;
      },
      readFileSync: () => '',
    };
    w.readAdcMetadata({
      fs: fakeFs,
      env: { APPDATA: 'C:\\U\\AppData\\Roaming' },
      platform: 'win32',
      homedir: 'C:\\U',
    });
    w.readAdcMetadata({ fs: fakeFs, env: {}, platform: 'linux', homedir: '/h' });
    expect(seen).toEqual([
      'C:\\U\\AppData\\Roaming\\gcloud\\application_default_credentials.json',
      '/h/.config/gcloud/application_default_credentials.json',
    ]);
  });

  it('parseAdcMetadata nunca devuelve tokens ni claves', () => {
    const txt = JSON.stringify({
      type: 'authorized_user',
      client_id: 'CID_SENTINEL',
      client_secret: 'CSECRET_SENTINEL',
      refresh_token: 'RTOKEN_SENTINEL',
      account: 'ACCOUNT_SENTINEL',
      quota_project_id: E,
    });
    const m = core.parseAdcMetadata(txt);
    expect(m).toMatchObject({
      status: 'ok',
      type: 'authorized_user',
      quotaProjectId: E,
      projectId: null,
    });
    const s = JSON.stringify(m) + w.describeAdc(Object.assign({ source: 'well-known file' }, m));
    for (const x of ['CID_SENTINEL', 'CSECRET_SENTINEL', 'RTOKEN_SENTINEL', 'ACCOUNT_SENTINEL'])
      expect(s).not.toContain(x);
  });

  it('parseAdcMetadata con service_account no filtra private_key ni client_email', () => {
    const m = core.parseAdcMetadata(
      JSON.stringify({
        type: 'service_account',
        project_id: E,
        private_key: 'PK_SENTINEL',
        client_email: 'MAIL_SENTINEL',
      })
    );
    expect(m).toMatchObject({ type: 'service_account', projectId: E });
    expect(JSON.stringify(m)).not.toMatch(/PK_SENTINEL|MAIL_SENTINEL/);
  });

  it('ADC inválido o ausente → no confirma', () => {
    expect(core.parseAdcMetadata('{no es json').status).toBe('invalid');
    const r = w.readAdcMetadata({
      fs: { existsSync: () => false, readFileSync: () => '' },
      env: {},
      platform: 'linux',
      homedir: '/h',
    });
    expect(r.status).toBe('absent');
    const r2 = w.readAdcMetadata({
      fs: {
        existsSync: () => true,
        readFileSync: () => {
          throw new Error('EACCES');
        },
      },
      env: {},
      platform: 'linux',
      homedir: '/h',
    });
    expect(r2.status).toBe('error');
  });
});

describe('Garantía: ningún caso no verificado permite --apply', () => {
  const gcloudOpts = [
    { status: 'ok', value: E },
    { status: 'ok', value: 'otro-proyecto-x' },
    { status: 'unset', value: null },
    { status: 'invalid', value: null },
    { status: 'error', value: null },
  ];
  const adcOpts = [
    { status: 'absent' },
    { status: 'invalid' },
    { status: 'ok', type: 'authorized_user', projectId: null, quotaProjectId: null },
    { status: 'ok', type: 'authorized_user', projectId: null, quotaProjectId: E },
    { status: 'ok', type: 'authorized_user', projectId: null, quotaProjectId: 'otro-proyecto-x' },
    { status: 'ok', type: 'service_account', projectId: E, quotaProjectId: null },
    { status: 'ok', type: 'service_account', projectId: 'otro-proyecto-x', quotaProjectId: null },
  ];
  const envOpts = [
    {},
    { GOOGLE_CLOUD_PROJECT: E },
    { GOOGLE_CLOUD_PROJECT: 'otro-proyecto-x' },
    { CLOUDSDK_CORE_PROJECT: 'MAL FORMATO' },
  ];
  const confirmOpts = [E, null, 'otro-proyecto-x'];

  it('exhaustivo (5×7×4×2×3 = 840 combinaciones): allowed ⇒ verificada ∧ sonda OK ∧ confirm ∧ sin contradicciones', () => {
    let allowedCount = 0;
    for (const gcloud of gcloudOpts)
      for (const adc of adcOpts)
        for (const envProjects of envOpts)
          for (const probeOk of [true, false])
            for (const confirm of confirmOpts) {
              const id = core.resolveProjectIdentity({
                expectedProjectId: E,
                envProjects,
                gcloud,
                adc,
                probeOk,
              });
              const g = guardFrom(id, confirm);
              if (g.allowed) {
                allowedCount++;
                expect(id.verified).toBe(true);
                expect(probeOk).toBe(true);
                expect(confirm).toBe(E);
                expect(id.contradictions).toHaveLength(0);
                expect(id.confirmations.length).toBeGreaterThan(0);
                // Nunca solo por env:
                expect(id.confirmations.every((c) => !c.startsWith('env'))).toBe(true);
              }
              if (!id.verified) expect(g.allowed).toBe(false);
            }
    // Control: hay casos válidos que sí pasan (la garantía no es vacua).
    expect(allowedCount).toBeGreaterThan(0);
  });

  it('dry-run nunca se bloquea por identidad (no escribe)', () => {
    const id = core.resolveProjectIdentity({ expectedProjectId: E, probeOk: true });
    expect(
      core.resolveProjectGuard({
        activeProjectId: null,
        identityVerified: id.verified,
        expectedProjectId: E,
        apply: false,
      }).allowed
    ).toBe(true);
    // ...y planRun en dry-run sigue sin writes.
    const rows = [
      core.classifyUser({
        uid: 'a',
        rolesData: { passwordHash: 'h', passwordSalt: 's' },
        authSecretData: null,
      }),
    ];
    expect(core.planRun(rows, { apply: false }).writes).toHaveLength(0);
  });
});
