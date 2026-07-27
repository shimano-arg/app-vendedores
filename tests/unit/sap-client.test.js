import { describe, it, expect, vi } from 'vitest';
import { createSapClient } from '../../src/sap-client.js';

/**
 * Fabrica un firebase namespace fake que devuelve un httpsCallable spy.
 * @param {{ status?: number, body?: unknown, throwCode?: string, throwMsg?: string }} [opts]
 */
function makeFirebase(opts = {}) {
  const callable = vi.fn(async (payload) => {
    if (opts.throwCode) {
      const err = new Error(opts.throwMsg || 'boom');
      err.code = opts.throwCode;
      throw err;
    }
    return { data: { status: opts.status ?? 200, body: opts.body ?? { ok: true, payload } } };
  });
  const httpsCallable = vi.fn((name) => callable);
  const functions = vi.fn((region) => ({ httpsCallable }));
  return { firebase: { functions }, callable, httpsCallable, functions };
}

describe('createSapClient.fetchWithSession', () => {
  it('happy GET: rutea por callable("sapProxy") con method=GET default', async () => {
    const { firebase, callable, httpsCallable } = makeFirebase({ status: 200, body: { value: [1, 2] } });
    const client = createSapClient(firebase);
    const res = await client.fetchWithSession('/b1s/v1/Items?$top=5');
    expect(httpsCallable).toHaveBeenCalledWith('sapProxy');
    expect(callable).toHaveBeenCalledWith({ endpoint: '/b1s/v1/Items?$top=5', method: 'GET', body: undefined });
    expect(res).toEqual({ ok: true, status: 200, body: { value: [1, 2] } });
  });

  it('POST con body JSON: parsea el string a objeto antes de mandarlo', async () => {
    const { firebase, callable } = makeFirebase({ status: 201, body: { DocEntry: 42 } });
    const client = createSapClient(firebase);
    const payload = { CardCode: 'C1', DocumentLines: [{ ItemCode: 'X' }] };
    const res = await client.fetchWithSession('/b1s/v1/Quotations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(callable).toHaveBeenCalledWith({ endpoint: '/b1s/v1/Quotations', method: 'POST', body: payload });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ DocEntry: 42 });
  });

  it('rechaza path fuera de /b1s/v1/ (defensa en profundidad contra el server-side)', async () => {
    const { firebase, httpsCallable } = makeFirebase();
    const client = createSapClient(firebase);
    const res = await client.fetchWithSession('/admin/danger');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error).toMatch(/\/b1s\/v1\//);
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  it('body no-JSON string: devuelve error client-side sin llamar callable', async () => {
    const { firebase, httpsCallable } = makeFirebase();
    const client = createSapClient(firebase);
    const res = await client.fetchWithSession('/b1s/v1/Items', { method: 'POST', body: 'no soy json{' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JSON/);
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  it('status 4xx: ok=false + body preservado + error con detail SL', async () => {
    const { firebase } = makeFirebase({
      status: 400,
      body: { error: { message: { value: 'Item inexistente' } } },
    });
    const client = createSapClient(firebase);
    const res = await client.fetchWithSession('/b1s/v1/Items(\'NOPE\')');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain('HTTP 400');
    expect(res.error).toContain('Item inexistente');
    expect(res.body).toBeDefined();
  });

  it('callable throw (permission-denied): mapea a ok=false + error con code', async () => {
    const { firebase } = makeFirebase({ throwCode: 'permission-denied', throwMsg: 'Rol vendedor no autorizado' });
    const client = createSapClient(firebase);
    const res = await client.fetchWithSession('/b1s/v1/Quotations', { method: 'POST', body: '{}' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error).toContain('permission-denied');
    expect(res.error).toContain('Rol vendedor no autorizado');
  });

  it('opts.callableName override: permite pointear a la function TEST', async () => {
    const { firebase, httpsCallable } = makeFirebase({ status: 200 });
    const client = createSapClient(firebase, { callableName: 'sapProxyTest' });
    await client.fetchWithSession('/b1s/v1/Items');
    expect(httpsCallable).toHaveBeenCalledWith('sapProxyTest');
  });

  it('default region: firebase.functions("southamerica-east1") — matchea el deploy real', async () => {
    const { firebase, functions } = makeFirebase({ status: 200 });
    const client = createSapClient(firebase);
    await client.fetchWithSession('/b1s/v1/Items');
    expect(functions).toHaveBeenCalledWith('southamerica-east1');
  });

  it('opts.region override: firebase.functions(<region>) — permite testing multi-region', async () => {
    const { firebase, functions } = makeFirebase({ status: 200 });
    const client = createSapClient(firebase, { region: 'us-central1' });
    await client.fetchWithSession('/b1s/v1/Items');
    expect(functions).toHaveBeenCalledWith('us-central1');
  });
});

describe('createSapClient.createQuotation', () => {
  it('llama fetchWithSession con POST /Quotations + payload serializado', async () => {
    const { firebase, callable } = makeFirebase({ status: 201, body: { DocEntry: 7 } });
    const client = createSapClient(firebase);
    const payload = { CardCode: 'C1', DocumentLines: [] };
    const res = await client.createQuotation(payload);
    expect(callable).toHaveBeenCalledWith({ endpoint: '/b1s/v1/Quotations', method: 'POST', body: payload });
    expect(res.ok).toBe(true);
  });
});
