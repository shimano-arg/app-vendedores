import { describe, expect, it, vi } from 'vitest';
import { runSapSlHealthCheck } from '../../functions/core/sap-sl-health-core.js';

function makeFbDb(initial) {
  const store = { doc: initial || null };
  return {
    _store: store,
    doc(_path) {
      return {
        async get() {
          return { exists: !!store.doc, data: () => store.doc || {} };
        },
        async set(data) {
          store.doc = { ...data };
        },
      };
    },
  };
}

function slLoginOk() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'B1SESSION=abc; path=/, ROUTEID=.n1; path=/' },
    text: async () => JSON.stringify({ SessionId: 'abc' }),
  };
}

function slLogoutOk() {
  return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
}

const baseConfig = {
  url: 'https://sap.test',
  companyDB: 'DB',
  userName: 'U',
  password: 'P',
};

describe('runSapSlHealthCheck', () => {
  it('login exitoso → status ok, consecutiveFailures 0, firstFailureAt null', async () => {
    const fbDb = makeFbDb();
    const fetch = vi.fn().mockImplementation(async (url) => {
      if (url.endsWith('/Login')) return slLoginOk();
      if (url.endsWith('/Logout')) return slLogoutOk();
      return { ok: false, status: 404 };
    });
    const now = vi.fn(() => new Date('2026-08-25T10:00:00Z'));
    const payload = await runSapSlHealthCheck({ fbDb, fetch, sapConfig: baseConfig, now });
    expect(payload.status).toBe('ok');
    expect(payload.consecutiveFailures).toBe(0);
    expect(payload.firstFailureAt).toBeNull();
    expect(payload.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fbDb._store.doc.status).toBe('ok');
  });

  it('login fail → status error, consecutiveFailures 1, firstFailureAt set', async () => {
    const fbDb = makeFbDb();
    const fetch = vi.fn().mockRejectedValue(new Error('network fail'));
    const now = vi.fn(() => new Date('2026-08-25T10:00:00Z'));
    const payload = await runSapSlHealthCheck({ fbDb, fetch, sapConfig: baseConfig, now });
    expect(payload.status).toBe('error');
    expect(payload.consecutiveFailures).toBe(1);
    expect(payload.firstFailureAt).toBe('2026-08-25T10:00:00.000Z');
    expect(payload.errorMessage).toContain('network fail');
  });

  it('consecutivos fails incrementan contador', async () => {
    const fbDb = makeFbDb({
      status: 'error',
      consecutiveFailures: 3,
      firstFailureAt: '2026-08-25T09:00:00.000Z',
    });
    const fetch = vi.fn().mockRejectedValue(new Error('still down'));
    const now = vi.fn(() => new Date('2026-08-25T10:00:00Z'));
    const payload = await runSapSlHealthCheck({ fbDb, fetch, sapConfig: baseConfig, now });
    expect(payload.status).toBe('error');
    expect(payload.consecutiveFailures).toBe(4);
    // firstFailureAt se preserva del previo (no se reescribe)
    expect(payload.firstFailureAt).toBe('2026-08-25T09:00:00.000Z');
  });

  it('recovery: error → ok reset consecutive + firstFailureAt', async () => {
    const fbDb = makeFbDb({
      status: 'error',
      consecutiveFailures: 5,
      firstFailureAt: '2026-08-25T09:00:00.000Z',
    });
    const fetch = vi.fn().mockImplementation(async (url) => {
      if (url.endsWith('/Login')) return slLoginOk();
      if (url.endsWith('/Logout')) return slLogoutOk();
      return { ok: false, status: 404 };
    });
    const now = vi.fn(() => new Date('2026-08-25T10:00:00Z'));
    const payload = await runSapSlHealthCheck({ fbDb, fetch, sapConfig: baseConfig, now });
    expect(payload.status).toBe('ok');
    expect(payload.consecutiveFailures).toBe(0);
    expect(payload.firstFailureAt).toBeNull();
  });

  it('logout fail no invalida el health check (login OK cuenta)', async () => {
    const fbDb = makeFbDb();
    const fetch = vi.fn().mockImplementation(async (url) => {
      if (url.endsWith('/Login')) return slLoginOk();
      if (url.endsWith('/Logout')) return { ok: false, status: 500 };
      return { ok: false, status: 404 };
    });
    const now = vi.fn(() => new Date('2026-08-25T10:00:00Z'));
    // sapLogout tira si el status no es ok; el catch dentro de doPing lo tolera.
    const payload = await runSapSlHealthCheck({ fbDb, fetch, sapConfig: baseConfig, now });
    expect(payload.status).toBe('ok');
  });
});
