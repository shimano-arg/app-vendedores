// @ts-check
/**
 * §63 Fase 3 Capa 1 (v1444) — tests para session pool.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetPool,
  acquireSession,
  releaseSession,
  withSession,
} from '../../functions/core/sap-sl-session.js';

const CFG = {
  url: 'https://sap.test',
  companyDB: 'SBO_TEST',
  userName: 'MANAGER',
  password: 'xxx',
};

function makeFetchMock() {
  let loginCount = 0;
  const cookieGen = () => `COOKIE_${loginCount}_${Math.random().toString(36).slice(2, 6)}`;
  const fetchFn = vi.fn(async (url, _opts) => {
    if (String(url).endsWith('/Login')) {
      loginCount++;
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) =>
            name.toLowerCase() === 'set-cookie'
              ? `B1SESSION=${cookieGen()}; path=/; HttpOnly`
              : null,
        },
      };
    }
    if (String(url).endsWith('/Logout')) {
      return { ok: true, status: 204, headers: { get: () => null } };
    }
    throw new Error('unexpected url ' + url);
  });
  return { fetchFn, getLoginCount: () => loginCount };
}

beforeEach(() => _resetPool());

describe('§63 Capa 1 — sap-sl-session pool', () => {
  it('T1 — acquire crea sesión nueva si pool vacío', async () => {
    const { fetchFn } = makeFetchMock();
    const s = await acquireSession({ ...CFG, fetch: fetchFn });
    expect(s.cookie).toMatch(/^COOKIE_1_/);
    expect(s.inUse).toBe(true);
    releaseSession(s, true);
    expect(s.inUse).toBe(false);
  });

  it('T2 — acquire reusa sesión libre no expirada', async () => {
    const { fetchFn, getLoginCount } = makeFetchMock();
    const s1 = await acquireSession({ ...CFG, fetch: fetchFn });
    releaseSession(s1, true);
    const s2 = await acquireSession({ ...CFG, fetch: fetchFn });
    expect(s2.cookie).toBe(s1.cookie);
    expect(getLoginCount()).toBe(1);
    releaseSession(s2, true);
  });

  it('T3 — acquire crea segunda si primera inUse y pool tiene cupo', async () => {
    const { fetchFn, getLoginCount } = makeFetchMock();
    const s1 = await acquireSession({ ...CFG, fetch: fetchFn });
    const s2 = await acquireSession({ ...CFG, fetch: fetchFn });
    expect(s2.cookie).not.toBe(s1.cookie);
    expect(getLoginCount()).toBe(2);
    releaseSession(s1, true);
    releaseSession(s2, true);
  });

  it('T4 — release(ok=false) descarta la sesión del pool', async () => {
    const { fetchFn, getLoginCount } = makeFetchMock();
    const s1 = await acquireSession({ ...CFG, fetch: fetchFn });
    releaseSession(s1, false); // simular 401
    const s2 = await acquireSession({ ...CFG, fetch: fetchFn });
    expect(s2.cookie).not.toBe(s1.cookie);
    expect(getLoginCount()).toBe(2);
    releaseSession(s2, true);
  });

  it('T5 — withSession maneja release automático en happy path', async () => {
    const { fetchFn, getLoginCount } = makeFetchMock();
    const result = await withSession({ ...CFG, fetch: fetchFn }, async (cookie) => {
      expect(cookie).toMatch(/^COOKIE_1_/);
      return 'ok';
    });
    expect(result).toBe('ok');
    // La sesión debe quedar reusable.
    const s2 = await acquireSession({ ...CFG, fetch: fetchFn });
    expect(getLoginCount()).toBe(1);
    releaseSession(s2, true);
  });

  it('T6 — withSession descarta sesión si función tira error con 401', async () => {
    const { fetchFn, getLoginCount } = makeFetchMock();
    try {
      await withSession({ ...CFG, fetch: fetchFn }, async () => {
        const err = /** @type {any} */ (new Error('401 Unauthorized'));
        err.status = 401;
        throw err;
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e && e.message) || '').toContain('401');
    }
    // Próxima acquire crea nueva.
    const s2 = await acquireSession({ ...CFG, fetch: fetchFn });
    expect(getLoginCount()).toBe(2);
    releaseSession(s2, true);
  });
});
