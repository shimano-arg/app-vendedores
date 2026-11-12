// @ts-check
/**
 * D8 — Tarea 62: auditoría de estado de despliegue (solo lectura).
 * Sin red real: fetch y token inyectados.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const dcore = require('../../../scripts/audit/lib/deploy-state-core.cjs');
const bb = require('../../../scripts/audit/BB_deploy_state_check.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const TOKEN = 'ya29.TOKENSENTINEL_no_debe_salir';
const LOCAL_RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

describe('analyzeRules', () => {
  it('reglas locales de la base: freeze presente y /auth_secrets cerrada', () => {
    const r = dcore.analyzeRules(LOCAL_RULES, LOCAL_RULES);
    expect(r).toMatchObject({
      available: true,
      freezePresent: true,
      authSecretsClosed: true,
      identicalToLocal: true,
    });
  });
  it('reglas sin freeze (versión anterior a PR-B) → freezePresent=false', () => {
    const viejo = LOCAL_RULES.replace(
      /&& !request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\s*\.hasAny\(\[[^\]]*\]\);/,
      ';'
    );
    expect(viejo).not.toBe(LOCAL_RULES);
    const r = dcore.analyzeRules(viejo, LOCAL_RULES);
    expect(r.freezePresent).toBe(false);
    expect(r.identicalToLocal).toBe(false);
  });
  it('CRLF vs LF (y mixto) no cuenta como diferencia', () => {
    // firestore.rules del repo está en CRLF; el desplegado puede venir en LF o duplicado.
    const lf = LOCAL_RULES.replace(/\r/g, '');
    expect(dcore.analyzeRules(lf, LOCAL_RULES).identicalToLocal).toBe(true);
    expect(dcore.analyzeRules(LOCAL_RULES.replace(/\n/g, '\r\n'), lf).identicalToLocal).toBe(true);
    expect(dcore.analyzeRules(lf + '\n// cambio', LOCAL_RULES).identicalToLocal).toBe(false);
  });
  it('sin reglas desplegadas obtenidas → no disponible (no inventa)', () => {
    expect(dcore.analyzeRules(null, LOCAL_RULES)).toMatchObject({
      available: false,
      freezePresent: null,
    });
  });
  it('rulesetSource concatena source.files', () => {
    expect(
      dcore.rulesetSource({ source: { files: [{ name: 'firestore.rules', content: 'abc' }] } })
    ).toBe('abc');
    expect(dcore.rulesetSource({})).toBeNull();
  });
});

describe('summarizeFunctions — allowlist, sin variables de entorno ni secretos', () => {
  const fn = (name, region, extra = {}) => ({
    name: `projects/app-vendedores-shimano/locations/${region}/functions/${name}`,
    state: 'ACTIVE',
    environment: 'GEN_2',
    updateTime: '2026-11-04T18:00:00Z',
    labels: {
      'deployment-tool': 'cli-firebase',
      'firebase-functions-hash': 'abc123',
      secreto: 'NOSALE',
    },
    buildConfig: {
      runtime: 'nodejs22',
      entryPoint: name,
      environmentVariables: { K: 'ENVSENTINEL' },
      source: { storageSource: { bucket: 'BUCKETSENTINEL' } },
    },
    serviceConfig: {
      availableMemory: '512Mi',
      timeoutSeconds: 30,
      maxInstanceCount: 100,
      revision: name.toLowerCase() + '-00001-abc',
      environmentVariables: { SECRET_X: 'ENVSENTINEL' },
      secretEnvironmentVariables: [{ key: 'K', secret: 'SECRETSENTINEL' }],
      serviceAccountEmail: 'sa@SASENTINEL.iam.gserviceaccount.com',
      uri: 'https://URISENTINEL.run.app',
    },
    url: 'https://URISENTINEL.cloudfunctions.net',
    ...extra,
  });
  it('detecta desplegadas / no desplegadas y región', () => {
    const s = dcore.summarizeFunctions([
      fn('verifyPasswordGate', 'southamerica-east1'),
      fn('setPasswordGate', 'southamerica-east1'),
      fn('commitPedidoCF', 'southamerica-east1'),
    ]);
    const by = Object.fromEntries(s.map((x) => [x.name, x]));
    expect(by.verifyPasswordGate.deployed).toBe(true);
    expect(by.verifyPasswordGate.instances[0]).toMatchObject({
      region: 'southamerica-east1',
      environment: 'GEN_2',
      runtime: 'nodejs22',
      state: 'ACTIVE',
      timeoutSeconds: 30,
    });
    expect(by.verifyTotpGate.deployed).toBe(false);
    expect(by.disableTotpGate.deployed).toBe(false);
    expect(s).toHaveLength(5);
  });
  it('match case-insensitive y múltiples regiones', () => {
    const s = dcore.summarizeFunctions([
      fn('verifypasswordgate', 'us-central1'),
      fn('verifyPasswordGate', 'southamerica-east1'),
    ]);
    expect(s[0].instances.map((i) => i.region).sort()).toEqual([
      'southamerica-east1',
      'us-central1',
    ]);
  });
  it('nunca expone env vars, secretos, service account, URLs ni labels fuera de la allowlist', () => {
    const out = JSON.stringify(
      dcore.summarizeFunctions([fn('verifyPasswordGate', 'southamerica-east1')])
    );
    for (const v of [
      'ENVSENTINEL',
      'SECRETSENTINEL',
      'SASENTINEL',
      'URISENTINEL',
      'BUCKETSENTINEL',
      'NOSALE',
    ])
      expect(out).not.toContain(v);
    expect(out).toContain('firebase-functions-hash');
  });
});

describe('analyzeFrontend — marcadores del fix D8', () => {
  const legacyIndex =
    "const APP_VERSION = 'v1554';\nconst DEFAULT_USER_PASSWORD = 'XXXXX';\n const creds = await buildPasswordCredentials(DEFAULT_USER_PASSWORD);";
  const legacyChunk = 'const creds = await buildPasswordCredentials(pwd); fbDb.collection("roles")';
  const fixedIndex = "const APP_VERSION = 'v1555';\n// sin default";
  const fixedChunk =
    "firebase.app().functions('southamerica-east1').httpsCallable('setPasswordGate')";
  it('frontend como 9456d967 (publicado hoy) → fix NO publicado', () => {
    expect(
      dcore.analyzeFrontend({ indexHtml: legacyIndex, adminChunk: legacyChunk })
    ).toMatchObject({
      available: true,
      appVersion: 'v1554',
      defaultPasswordConst: true,
      defaultPasswordInit: true,
      adminUsesSetPasswordGate: false,
      adminLegacyClientWrite: true,
      d8FixPublished: false,
    });
  });
  it('frontend con fix completo (index + chunk regenerado) → fix publicado', () => {
    expect(
      dcore.analyzeFrontend({ indexHtml: fixedIndex, adminChunk: fixedChunk }).d8FixPublished
    ).toBe(true);
  });
  it('index con fix pero chunk SIN regenerar → NO cuenta como publicado', () => {
    expect(
      dcore.analyzeFrontend({ indexHtml: fixedIndex, adminChunk: legacyChunk }).d8FixPublished
    ).toBe(false);
  });
  it('chunk no obtenido → no disponible (no inventa)', () => {
    expect(
      dcore.analyzeFrontend({ indexHtml: fixedIndex, adminChunk: null }).d8FixPublished
    ).toBeNull();
    expect(dcore.analyzeFrontend({ indexHtml: null, adminChunk: null }).available).toBe(false);
  });
  it('nunca devuelve el valor de la contraseña por defecto', () => {
    expect(
      JSON.stringify(dcore.analyzeFrontend({ indexHtml: legacyIndex, adminChunk: legacyChunk }))
    ).not.toContain('XXXXX');
  });
  it('archivos REALES de la réplica D8 (Tarea 63: chunk regenerado) → fix D8 publicable', () => {
    // Tarea 62 documentaba el estado previo (chunk sin regenerar → false).
    // Tarea 63 regeneró chunks/admin-users.js con `node build.js`: ahora este
    // test es la guarda de que el artefacto compilado acompaña al src.
    const r = dcore.analyzeFrontend({
      indexHtml: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
      adminChunk: fs.readFileSync(path.join(ROOT, 'chunks', 'admin-users.js'), 'utf8'),
    });
    expect(r.defaultPasswordConst).toBe(false);
    expect(r.defaultPasswordInit).toBe(false);
    expect(r.adminUsesSetPasswordGate).toBe(true);
    expect(r.adminLegacyClientWrite).toBe(false);
    expect(r.d8FixPublished).toBe(true);
  });
});

/** fetch falso que registra llamadas. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({
      url,
      method: opts && opts.method,
      auth: !!(opts && opts.headers && opts.headers.Authorization),
      authValue: opts && opts.headers && opts.headers.Authorization,
    });
    for (const [re, resp] of routes) {
      if (re.test(url)) {
        if (resp instanceof Error) throw resp;
        return {
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          json: async () => resp.body,
          text: async () => resp.body,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fn, calls };
}

describe('runDeployCheck — solo GET, token aislado, errores parciales', () => {
  const routes = () => [
    [
      /releases\/cloud\.firestore$/,
      {
        status: 200,
        body: {
          name: 'r',
          rulesetName: 'projects/app-vendedores-shimano/rulesets/abc',
          updateTime: '2026-11-04T18:00:00Z',
        },
      },
    ],
    [/rulesets\/abc$/, { status: 200, body: { source: { files: [{ content: LOCAL_RULES }] } } }],
    [
      /functions\?pageSize=200$/,
      {
        status: 200,
        body: {
          functions: [
            {
              name: 'projects/p/locations/southamerica-east1/functions/verifyPasswordGate',
              state: 'ACTIVE',
              environment: 'GEN_2',
            },
          ],
          nextPageToken: 'PAG2',
        },
      },
    ],
    [
      /pageToken=PAG2/,
      {
        status: 200,
        body: {
          functions: [
            {
              name: 'projects/p/locations/southamerica-east1/functions/setPasswordGate',
              state: 'ACTIVE',
              environment: 'GEN_2',
            },
          ],
        },
      },
    ],
    [
      /github\.io\/app-vendedores\/index\.html$/,
      { status: 200, body: "const APP_VERSION = 'v1554';\nconst DEFAULT_USER_PASSWORD = 'XXXXX';" },
    ],
    [/chunks\/admin-users\.js$/, { status: 200, body: 'buildPasswordCredentials(pwd)' }],
  ];

  it('flujo completo: solo GET, Authorization solo a googleapis, token nunca en la salida', async () => {
    const f = fakeFetch(routes());
    const r = await bb.runDeployCheck({
      fetch: f.fn,
      getToken: () => ({ token: TOKEN, error: null }),
      readLocalRules: () => LOCAL_RULES,
    });
    expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
    for (const c of f.calls) {
      if (/github\.io/.test(c.url)) expect(c.auth).toBe(false);
      if (/googleapis\.com/.test(c.url)) expect(c.authValue).toBe('Bearer ' + TOKEN);
    }
    expect(r.rules).toMatchObject({ available: true, freezePresent: true, identicalToLocal: true });
    expect(r.functions.find((x) => x.name === 'setPasswordGate').deployed).toBe(true); // paginación
    expect(r.functions.find((x) => x.name === 'verifyTotpGate').deployed).toBe(false);
    expect(r.frontend.d8FixPublished).toBe(false);
    const all = JSON.stringify(r) + dcore.renderDeployReport(r).join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('XXXXX');
  });

  it('sin token: reglas/Functions "no disponible", frontend igual se verifica', async () => {
    const f = fakeFetch(routes());
    const r = await bb.runDeployCheck({
      fetch: f.fn,
      getToken: () => ({ token: null, error: 'gcloud no devolvió token' }),
      readLocalRules: () => LOCAL_RULES,
    });
    expect(r.rules.available).toBe(false);
    expect(r.rulesError).toMatch(/sin token/);
    expect(r.functions).toBeUndefined();
    expect(r.frontend.available).toBe(true);
    expect(f.calls.some((c) => /googleapis/.test(c.url))).toBe(false);
  });

  it('403 en Rules API y red caída en Pages → errores parciales sin abortar', async () => {
    const rt = routes();
    rt[0] = [/releases\/cloud\.firestore$/, { status: 403, body: {} }];
    rt[4] = [
      /github\.io\/app-vendedores\/index\.html$/,
      Object.assign(new Error('x'), { code: 'ECONNRESET' }),
    ];
    const f = fakeFetch(rt);
    const r = await bb.runDeployCheck({
      fetch: f.fn,
      getToken: () => ({ token: TOKEN, error: null }),
      readLocalRules: () => LOCAL_RULES,
    });
    expect(r.rulesError).toMatch(/403/);
    expect(r.functions).toBeDefined();
    expect(r.frontendError).toMatch(/ECONNRESET/);
    expect(dcore.renderDeployReport(r).join('\n')).toMatch(/no disponible/);
  });
});

describe('httpGet — el token SOLO viaja a *.googleapis.com (barrera propia)', () => {
  it('con token: github.io sin Authorization; googleapis con Authorization; siempre GET', async () => {
    const seen = [];
    const f = async (url, opts) => {
      seen.push({ url, opts });
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    };
    await bb.httpGet(f, 'https://shimano-arg.github.io/app-vendedores/index.html', TOKEN, 'text');
    await bb.httpGet(f, 'https://evil.example/googleapis.com/x', TOKEN, 'text');
    await bb.httpGet(f, 'https://firebaserules.googleapis.com/v1/x', TOKEN, 'json');
    expect(seen[0].opts.headers.Authorization).toBeUndefined();
    expect(seen[1].opts.headers.Authorization).toBeUndefined();
    expect(seen[2].opts.headers.Authorization).toBe('Bearer ' + TOKEN);
    expect(seen.every((c) => c.opts.method === 'GET')).toBe(true);
  });
  it('HTTP no-OK → error con status; red caída → error con code (sin cuerpo)', async () => {
    await expect(
      bb.httpGet(
        async () => ({ ok: false, status: 403 }),
        'https://x.googleapis.com/a',
        TOKEN,
        'json'
      )
    ).rejects.toEqual({ status: 403 });
    await expect(
      bb.httpGet(
        async () => {
          throw Object.assign(new Error('boom'), { code: 'ENOTFOUND' });
        },
        'https://x.googleapis.com/a',
        TOKEN,
        'json'
      )
    ).rejects.toEqual({ code: 'ENOTFOUND' });
  });
});

describe('getAccessToken', () => {
  it('Windows: gcloud.cmd con shell; error de invocación → token null, nunca lanza', () => {
    const calls = [];
    const r = bb.getAccessToken({
      spawnSync: (cmd, args, o) => {
        calls.push({ cmd, args, shell: o.shell });
        return { status: 0, stdout: TOKEN + '\n' };
      },
      platform: 'win32',
      env: {},
    });
    expect(calls[0]).toEqual({
      cmd: 'gcloud.cmd',
      args: ['auth', 'print-access-token'],
      shell: true,
    });
    expect(r.token).toBe(TOKEN);
    const e = bb.getAccessToken({
      spawnSync: () => ({ error: { code: 'ENOENT' } }),
      platform: 'linux',
      env: {},
    });
    expect(e).toEqual({ token: null, error: 'no se pudo invocar gcloud (ENOENT)' });
    const t = bb.getAccessToken({
      spawnSync: () => {
        throw Object.assign(new Error('x'), { code: 'EINVAL' });
      },
      platform: 'win32',
      env: {},
    });
    expect(t.token).toBeNull();
  });
});

describe('Correcciones de la revisión independiente (P2-2 a P2-5)', () => {
  const lf = LOCAL_RULES.replace(/\r/g, '');
  it('P2-2: una segunda regla write en /roles anula el freeze (OR) → no efectivo', () => {
    const o = lf.replace(
      /allow delete: if isAdmin\(\);/,
      'allow delete: if isAdmin();\n      allow write: if request.auth != null;'
    );
    const r = dcore.analyzeRules(o, LOCAL_RULES);
    expect(r.rolesUpdateRules).toBe(2);
    expect(r.freezePresent).toBe(false);
  });
  it('P2-2: freeze solo en un comentario → no cuenta', () => {
    const c = lf.replace(
      /allow update: if isAdmin\(\)[\s\S]*?\.hasAny\(\[[^\]]*\]\);/,
      "// .affectedKeys().hasAny(['passwordHash', 'passwordSalt', 'totpSecret', 'totpEnabled'])\n      allow update: if isAdmin();"
    );
    expect(dcore.analyzeRules(c, LOCAL_RULES).freezePresent).toBe(false);
  });
  it('P2-2: comodín match /{document=**} → freeze y auth_secrets no efectivos', () => {
    const w = lf.replace(
      'match /databases/{database}/documents {',
      'match /databases/{database}/documents {\n    match /{document=**} { allow read, write: if true; }'
    );
    const r = dcore.analyzeRules(w, LOCAL_RULES);
    expect(r.wildcardMatch).toBe(true);
    expect(r.freezePresent).toBe(false);
    expect(r.authSecretsClosed).toBe(false);
  });
  it('P2-2: /auth_secrets con una regla extra → no cerrada', () => {
    const a = lf.replace(
      /match \/auth_secrets\/\{uid\} \{\s*allow read, write: if false;/,
      'match /auth_secrets/{uid} {\n      allow read, write: if false;\n      allow read: if request.auth != null;'
    );
    expect(dcore.analyzeRules(a, LOCAL_RULES).authSecretsClosed).toBe(false);
  });
  it('P2-3: regiones inalcanzables → CFs no encontradas quedan "no disponible", no "NO desplegada"', async () => {
    const f = fakeFetch([
      [
        /functions\?pageSize=200$/,
        {
          status: 200,
          body: {
            functions: [
              {
                name: 'projects/p/locations/southamerica-east1/functions/verifyPasswordGate',
                state: 'ACTIVE',
              },
            ],
            unreachable: ['us-central1'],
          },
        },
      ],
    ]);
    const r = await bb.runDeployCheck({
      fetch: f.fn,
      getToken: () => ({ token: TOKEN, error: null }),
      readLocalRules: () => LOCAL_RULES,
    });
    expect(r.functionsPartialReason).toMatch(/inalcanzable/);
    expect(r.functions.find((x) => x.name === 'verifyPasswordGate').deployed).toBe(true);
    expect(r.functions.find((x) => x.name === 'setPasswordGate').deployed).toBeNull();
    expect(dcore.renderDeployReport(r).join('\n')).toMatch(/setPasswordGate: no disponible/);
  });
  it('P2-3: tope de páginas → parcial', async () => {
    const f = fakeFetch([
      [
        /functions\?pageSize=200/,
        { status: 200, body: { functions: [], nextPageToken: 'SIEMPRE' } },
      ],
    ]);
    const r = await bb.runDeployCheck({
      fetch: f.fn,
      getToken: () => ({ token: TOKEN, error: null }),
      readLocalRules: () => LOCAL_RULES,
    });
    expect(r.functionsPartialReason).toMatch(/tope de 20 páginas/);
    expect(r.functions.every((x) => x.deployed === null)).toBe(true);
  });
  it('P2-4: DEFAULT_USER_PASSWORD con let/var o solo usado → sigue contando como presente', () => {
    expect(
      dcore.analyzeFrontend({
        indexHtml: "let DEFAULT_USER_PASSWORD = 'a';",
        adminChunk: "httpsCallable('setPasswordGate')",
      }).d8FixPublished
    ).toBe(false);
    expect(
      dcore.analyzeFrontend({
        indexHtml: 'x(DEFAULT_USER_PASSWORD)',
        adminChunk: "httpsCallable('setPasswordGate')",
      }).d8FixPublished
    ).toBe(false);
  });
  it('P2-4: setPasswordGate solo en un comentario del chunk → no cuenta', () => {
    const r = dcore.analyzeFrontend({
      indexHtml: "const APP_VERSION = 'v1';",
      adminChunk: "// httpsCallable('setPasswordGate')\nfoo()",
    });
    expect(r.adminUsesSetPasswordGate).toBe(false);
    expect(r.d8FixPublished).toBe(false);
  });
  it('P2-4: escritura legacy con otro nombre (passwordHash:) → legacy detectado', () => {
    const r = dcore.analyzeFrontend({
      indexHtml: "const APP_VERSION = 'v1';",
      adminChunk: "httpsCallable('setPasswordGate'); roles.update({ passwordHash: h })",
    });
    expect(r.adminLegacyClientWrite).toBe(true);
    expect(r.d8FixPublished).toBe(false);
  });
  it('P2-4: literal por defecto con otro nombre (candidato en memoria) → detectado, sin imprimir el valor', () => {
    const cand = 'CANDIDATO_SENTINEL_FRONT';
    const r = dcore.analyzeFrontend({
      indexHtml: `const OTRO_NOMBRE = '${cand}';`,
      adminChunk: "httpsCallable('setPasswordGate')",
      defaultCandidate: cand,
    });
    expect(r.defaultLiteralPresent).toBe(true);
    expect(r.d8FixPublished).toBe(false);
    expect(
      JSON.stringify(r) + dcore.renderDeployReport({ project: 'p', frontend: r }).join('\n')
    ).not.toContain(cand);
  });
  it('P2-5: hacia googleapis redirect:"error"; hacia Pages redirect:"follow"', async () => {
    const seen = [];
    const f = async (_url, opts) => {
      seen.push(opts.redirect);
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    };
    await bb.httpGet(f, 'https://cloudfunctions.googleapis.com/v2/x', TOKEN, 'json');
    await bb.httpGet(f, 'https://shimano-arg.github.io/app-vendedores/index.html', null, 'text');
    expect(seen).toEqual(['error', 'follow']);
  });
});

describe('Tarea 63 — diagnóstico seguro del HTTP 403 (sin cuerpos crudos)', () => {
  const GOOGLE_403 = {
    error: {
      code: 403,
      message: 'Permission denied for user x@y.z on project 123456789 — detalle que NO debe salir',
      status: 'PERMISSION_DENIED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'IAM_PERMISSION_DENIED',
          domain: 'iam.googleapis.com',
          metadata: {
            permission: 'firebaserules.releases.get',
            service: 'firebaserules.googleapis.com',
            consumer: 'projects/123456789',
            resource: 'projects/app-vendedores-shimano',
          },
        },
        {
          '@type': 'type.googleapis.com/google.rpc.Help',
          links: [{ url: 'https://evil.example/x' }],
        },
      ],
    },
  };

  it('extractGoogleErrorInfo: solo campos de allowlist (status, reason, permission, service)', () => {
    const info = dcore.extractGoogleErrorInfo(GOOGLE_403);
    expect(info).toEqual({
      status: 'PERMISSION_DENIED',
      reasons: ['IAM_PERMISSION_DENIED'],
      permissions: ['firebaserules.releases.get'],
      services: ['firebaserules.googleapis.com'],
    });
    const s = JSON.stringify(info);
    for (const leak of ['x@y.z', '123456789', 'evil.example', 'detalle', 'consumer']) {
      expect(s).not.toContain(leak);
    }
  });

  it('extractGoogleErrorInfo: valores fuera de formato se descartan; cuerpo raro → null', () => {
    expect(dcore.extractGoogleErrorInfo(null)).toBeNull();
    expect(dcore.extractGoogleErrorInfo('texto')).toBeNull();
    expect(dcore.extractGoogleErrorInfo({ error: {} })).toBeNull();
    const info = dcore.extractGoogleErrorInfo({
      error: {
        status: 'permission denied <script>',
        details: [{ reason: 'a@b.c', metadata: { permission: 'x y', service: 'evil.example' } }],
      },
    });
    expect(info).toBeNull();
  });

  it('httpGet: en 4xx de googleapis adjunta solo el resumen seguro; en Pages no lee el cuerpo', async () => {
    let readPages = false;
    await expect(
      bb.httpGet(
        async () => ({ ok: false, status: 403, json: async () => GOOGLE_403 }),
        'https://firebaserules.googleapis.com/v1/x',
        TOKEN,
        'json'
      )
    ).rejects.toEqual({
      status: 403,
      google: dcore.extractGoogleErrorInfo(GOOGLE_403),
    });
    await expect(
      bb.httpGet(
        async () => ({
          ok: false,
          status: 403,
          json: async () => {
            readPages = true;
            return GOOGLE_403;
          },
        }),
        'https://shimano-arg.github.io/app-vendedores/index.html',
        null,
        'text'
      )
    ).rejects.toEqual({ status: 403 });
    expect(readPages).toBe(false);
  });

  it('httpGet: cuerpo de error no-JSON no rompe (queda solo el status)', async () => {
    await expect(
      bb.httpGet(
        async () => ({
          ok: false,
          status: 403,
          json: async () => {
            throw new SyntaxError('bad json');
          },
        }),
        'https://firebaserules.googleapis.com/v1/x',
        TOKEN,
        'json'
      )
    ).rejects.toEqual({ status: 403 });
  });

  it('describeFetchError: 403 IAM → nombra permiso y rol mínimo; SERVICE_DISABLED → API; USER_PROJECT → cuota', () => {
    const iam = dcore.describeFetchError({
      status: 403,
      google: dcore.extractGoogleErrorInfo(GOOGLE_403),
    });
    expect(iam).toContain('PERMISSION_DENIED');
    expect(iam).toContain('IAM_PERMISSION_DENIED');
    expect(iam).toContain('firebaserules.releases.get');
    expect(iam).toContain('roles/firebaserules.viewer');
    const svc = dcore.describeFetchError({
      status: 403,
      google: {
        status: 'PERMISSION_DENIED',
        reasons: ['SERVICE_DISABLED'],
        permissions: [],
        services: ['firebaserules.googleapis.com'],
      },
    });
    expect(svc).toContain('API deshabilitada');
    const quota = dcore.describeFetchError({
      status: 403,
      google: {
        status: 'PERMISSION_DENIED',
        reasons: ['USER_PROJECT_DENIED'],
        permissions: [],
        services: [],
      },
    });
    expect(quota).toContain('--quota-project');
    // Sin detalle de Google se mantiene el texto genérico.
    expect(dcore.describeFetchError({ status: 403 })).toBe(
      'HTTP 403 (sin permiso o API deshabilitada)'
    );
  });

  it('quotaProject: solo se acepta el proyecto del sistema y solo hacia googleapis', async () => {
    const seen = [];
    const f = async (url, opts) => {
      seen.push({ url, opts });
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    };
    await bb.httpGet(f, 'https://firebaserules.googleapis.com/v1/x', TOKEN, 'json', {
      quotaProject: bb.PROJECT,
    });
    await bb.httpGet(f, 'https://firebaserules.googleapis.com/v1/x', TOKEN, 'json', {
      quotaProject: 'otro-proyecto',
    });
    await bb.httpGet(f, 'https://shimano-arg.github.io/app-vendedores/index.html', null, 'text', {
      quotaProject: bb.PROJECT,
    });
    expect(seen[0].opts.headers['x-goog-user-project']).toBe(bb.PROJECT);
    expect(seen[1].opts.headers['x-goog-user-project']).toBeUndefined();
    expect(seen[2].opts.headers['x-goog-user-project']).toBeUndefined();
  });

  it('runDeployCheck propaga quotaProject a las llamadas de Rules y Functions', async () => {
    const seen = [];
    const f = async (url, opts) => {
      seen.push({ url, opts });
      if (url.includes('github.io'))
        return { ok: true, status: 200, text: async () => '<html></html>' };
      return { ok: false, status: 403, json: async () => GOOGLE_403 };
    };
    const out = await bb.runDeployCheck({
      fetch: f,
      getToken: () => ({ token: TOKEN, error: null }),
      readLocalRules: () => LOCAL_RULES,
      quotaProject: bb.PROJECT,
    });
    const google = seen.filter((c) => c.url.includes('googleapis.com'));
    expect(google.length).toBeGreaterThan(0);
    expect(google.every((c) => c.opts.headers['x-goog-user-project'] === bb.PROJECT)).toBe(true);
    expect(out.rulesError).toContain('firebaserules.releases.get');
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain('123456789');
  });
});
