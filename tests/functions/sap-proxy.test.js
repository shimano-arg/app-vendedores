import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractSessionCookies,
  handleSapProxy,
  makeHttpsError,
} from '../../functions/core/sap-proxy-core.js';

/** Helper para construir deps con overrides. */
function makeDeps(over = {}) {
  return {
    getUserRole: vi.fn(async () => 'admin'),
    fetch: vi.fn(async (url) => makeSlResponse(url)),
    sapConfig: {
      url: 'https://shimano-sap.test',
      companyDB: 'SHIMANO_TST_06',
      userName: 'APP_VENDEDORES',
      password: 'super-secret',
    },
    log: vi.fn(),
    ...over,
  };
}

/** Simula respuestas del Service Layer según el path llamado. */
function makeSlResponse(url) {
  if (url.endsWith('/b1s/v1/Login')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'B1SESSION=abc123; path=/, ROUTEID=.node1; path=/' },
      text: async () => JSON.stringify({ SessionId: 'abc123' }),
    };
  }
  if (url.endsWith('/b1s/v1/Logout')) {
    return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
  }
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ value: [{ ItemCode: 'SKU1' }] }),
  };
}

describe('extractSessionCookies', () => {
  it('extrae B1SESSION y ROUTEID', () => {
    const raw = 'B1SESSION=abc; path=/; HttpOnly, ROUTEID=.node1; path=/';
    expect(extractSessionCookies(raw)).toBe('B1SESSION=abc; ROUTEID=.node1');
  });
  it('vacío si no viene set-cookie', () => {
    expect(extractSessionCookies(null)).toBe('');
    expect(extractSessionCookies('')).toBe('');
  });
  it('ignora cookies desconocidas', () => {
    expect(extractSessionCookies('OTHER=x, B1SESSION=abc')).toBe('B1SESSION=abc');
  });
});

describe('handleSapProxy — auth', () => {
  it('sin auth → unauthenticated', async () => {
    const deps = makeDeps();
    await expect(handleSapProxy({ endpoint: '/b1s/v1/Items' }, null, deps)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('auth pero sin rol → permission-denied', async () => {
    const deps = makeDeps({ getUserRole: vi.fn(async () => null) });
    await expect(
      handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('vendedor GET /Items → OK (lectura permitida)', async () => {
    const deps = makeDeps({ getUserRole: vi.fn(async () => 'vendedor') });
    const res = await handleSapProxy({ endpoint: '/b1s/v1/Items?$top=10' }, { uid: 'u1' }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ value: [{ ItemCode: 'SKU1' }] });
  });

  it('vendedor POST /Quotations → permission-denied', async () => {
    const deps = makeDeps({ getUserRole: vi.fn(async () => 'vendedor') });
    await expect(
      handleSapProxy(
        { endpoint: '/b1s/v1/Quotations', method: 'POST', body: {} },
        { uid: 'u1' },
        deps
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('interno POST /Quotations → permission-denied (solo admin/gerente)', async () => {
    const deps = makeDeps({ getUserRole: vi.fn(async () => 'interno') });
    await expect(
      handleSapProxy(
        { endpoint: '/b1s/v1/Quotations', method: 'POST', body: {} },
        { uid: 'u1' },
        deps
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('gerente POST /Quotations → OK', async () => {
    const deps = makeDeps({ getUserRole: vi.fn(async () => 'gerente') });
    const res = await handleSapProxy(
      { endpoint: '/b1s/v1/Quotations', method: 'POST', body: { CardCode: 'C1' } },
      { uid: 'u1' },
      deps
    );
    expect(res.status).toBe(200);
  });

  it('viewer GET /Items → permission-denied', async () => {
    const deps = makeDeps({ getUserRole: vi.fn(async () => 'viewer') });
    await expect(
      handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('handleSapProxy — sanitización', () => {
  it('endpoint sin /b1s/v1/ prefix → invalid-argument (protege SSRF)', async () => {
    const deps = makeDeps();
    await expect(
      handleSapProxy({ endpoint: 'https://evil.com/steal' }, { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('endpoint vacío → invalid-argument', async () => {
    const deps = makeDeps();
    await expect(handleSapProxy({ endpoint: '' }, { uid: 'u1' }, deps)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('method no soportado → invalid-argument', async () => {
    const deps = makeDeps();
    await expect(
      handleSapProxy(
        { endpoint: '/b1s/v1/Items', method: /** @type {any} */ ('HEAD') },
        { uid: 'u1' },
        deps
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('data sin endpoint → invalid-argument', async () => {
    const deps = makeDeps();
    await expect(
      handleSapProxy(/** @type {any} */ ({}), { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('handleSapProxy — SL relay', () => {
  let deps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it('llama Login con creds correctas', async () => {
    await handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps);
    const loginCall = deps.fetch.mock.calls.find((c) => c[0].endsWith('/Login'));
    expect(loginCall).toBeTruthy();
    const body = JSON.parse(loginCall[1].body);
    expect(body).toEqual({
      CompanyDB: 'SHIMANO_TST_06',
      UserName: 'APP_VENDEDORES',
      Password: 'super-secret',
    });
  });

  it('forward call usa Cookie de la sesión', async () => {
    await handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps);
    const proxyCall = deps.fetch.mock.calls.find((c) => c[0].includes('/Items'));
    expect(proxyCall[1].headers.Cookie).toBe('B1SESSION=abc123; ROUTEID=.node1');
  });

  it('POST forward incluye body serializado', async () => {
    await handleSapProxy(
      { endpoint: '/b1s/v1/Quotations', method: 'POST', body: { CardCode: 'C1', DocLines: [] } },
      { uid: 'u1' },
      deps
    );
    const proxyCall = deps.fetch.mock.calls.find((c) => c[0].endsWith('/Quotations'));
    expect(JSON.parse(proxyCall[1].body)).toEqual({ CardCode: 'C1', DocLines: [] });
  });

  it('llama Logout después del forward (hygiene)', async () => {
    await handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps);
    const logoutCall = deps.fetch.mock.calls.find((c) => c[0].endsWith('/Logout'));
    expect(logoutCall).toBeTruthy();
  });

  it('Login fail → unavailable con status del SL', async () => {
    deps.fetch = vi.fn(async (url) => {
      if (url.endsWith('/Login')) {
        return {
          ok: false,
          status: 401,
          headers: { get: () => null },
          text: async () => 'auth failed',
        };
      }
      return makeSlResponse(url);
    });
    await expect(
      handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('Login no devuelve cookies → unavailable', async () => {
    deps.fetch = vi.fn(async (url) => {
      if (url.endsWith('/Login')) {
        return { ok: true, status: 200, headers: { get: () => '' }, text: async () => '{}' };
      }
      return makeSlResponse(url);
    });
    await expect(
      handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('sapConfig incompleto → internal', async () => {
    deps.sapConfig = { url: '', companyDB: '', userName: '', password: '' };
    await expect(
      handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'internal' });
  });

  it('response no-JSON queda como string (no rompe)', async () => {
    deps.fetch = vi.fn(async (url) => {
      if (url.endsWith('/Login')) return makeSlResponse(url);
      if (url.endsWith('/Logout')) return makeSlResponse(url);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => 'not-json' };
    });
    const res = await handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps);
    expect(res.body).toBe('not-json');
  });

  it('logout fail se traga (no rompe la response)', async () => {
    const okCalls = [];
    deps.fetch = vi.fn(async (url, _init) => {
      if (url.endsWith('/Logout')) throw new Error('network err');
      okCalls.push(url);
      return makeSlResponse(url);
    });
    const res = await handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps);
    expect(res.status).toBe(200);
  });
});

describe('handleSapProxy — no leaks', () => {
  it('la response NO incluye la password', async () => {
    const deps = makeDeps();
    const res = await handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps);
    expect(JSON.stringify(res)).not.toContain('super-secret');
  });

  it('log NO incluye la password (paranoia)', async () => {
    const logs = [];
    const deps = makeDeps({ log: (msg, extra) => logs.push({ msg, extra }) });
    await handleSapProxy({ endpoint: '/b1s/v1/Items' }, { uid: 'u1' }, deps);
    for (const entry of logs) {
      expect(JSON.stringify(entry)).not.toContain('super-secret');
    }
  });
});
