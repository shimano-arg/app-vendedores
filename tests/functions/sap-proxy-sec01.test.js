// @ts-check
/**
 * SEC-01 (P0, 2026-10-29) — bypass de la allowlist de sapProxy con puntos y
 * barras codificados.
 *
 * Todo con fetch mockeado: ningún test llama al Service Layer real. Además de
 * verificar el rechazo, se verifica que el fetch al SL NUNCA se dispara para
 * los endpoints maliciosos (ni siquiera el Login).
 */
import { describe, expect, it, vi } from 'vitest';
import { handleSapProxy, validateEndpointPath } from '../../functions/core/sap-proxy-core.js';

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
    text: async () => JSON.stringify({ value: [] }),
  };
}

function makeDeps(role) {
  return {
    getUserRole: vi.fn(async () => role),
    fetch: vi.fn(async (url) => makeSlResponse(url)),
    sapConfig: {
      url: 'https://shimano-sap.seidor.com.ar:50000',
      companyDB: 'TEST_DB',
      userName: 'TEST_USER',
      password: 'test-only',
    },
    log: vi.fn(),
  };
}

/** Variantes de bypass: [descripción, endpoint, método]. */
const MALICIOSOS = [
  ['%2e%2e minúsculas', '/b1s/v1/Items/%2e%2e/Invoices', 'GET'],
  ['%2E%2E mayúsculas', '/b1s/v1/Items/%2E%2E/BusinessPartners', 'GET'],
  ['.%2e mixto', '/b1s/v1/Items/.%2e/BusinessPartners', 'GET'],
  ['%2e. mixto', '/b1s/v1/Items/%2e./Users', 'GET'],
  ['%2e%2E mixto de mayúsculas', '/b1s/v1/Warehouses/%2e%2E/Invoices', 'GET'],
  ['segmento %2e solo', '/b1s/v1/Items/%2e/Invoices', 'GET'],
  ['barra codificada %2f', '/b1s/v1/Items%2f..%2fInvoices', 'GET'],
  ['barra codificada %2F', '/b1s/v1/Items%2F%2e%2e%2FInvoices', 'GET'],
  ['barra invertida %5c', '/b1s/v1/Items%5c..%5cInvoices', 'GET'],
  ['barra invertida literal', '/b1s/v1/Items\\..\\Invoices', 'GET'],
  ['doble codificación %252e', '/b1s/v1/Items/%252e%252e/Invoices', 'GET'],
  ['escritura admin a otra entidad', '/b1s/v1/Quotations/%2e%2e/Invoices', 'POST'],
  ['PATCH a BusinessPartners vía Quotations', '/b1s/v1/Quotations/.%2E/BusinessPartners', 'PATCH'],
  ['fragmento', '/b1s/v1/Items#/../Invoices', 'GET'],
  ['espacio en la ruta', '/b1s/v1/Items /../Invoices', 'GET'],
];

describe('SEC-01 — validateEndpointPath', () => {
  it.each(MALICIOSOS)('rechaza: %s', (_d, endpoint) => {
    expect(validateEndpointPath(endpoint).ok).toBe(false);
  });

  it.each([
    ['/b1s/v1/Items?$top=10'],
    ["/b1s/v1/Items('CAC58MH2UR')?$select=ItemCode,ItemWarehouseInfoCollection"],
    ["/b1s/v1/SQLQueries('ItemStockByWhs')/List?ItemCode='ABC'&WhsCode='11'"],
    ["/b1s/v1/BusinessPartners('C20175569635')?$select=CardCode,CardName"],
    ["/b1s/v1/Items('SKU%20CON%20ESPACIO')?$select=ItemCode"],
    ['/b1s/v1/Quotations(123)/Cancel'],
    ["/b1s/v1/Quotations?$filter=NumAtCard%20eq%20'abc'&$select=DocEntry"],
  ])('acepta endpoint legítimo: %s', (endpoint) => {
    expect(validateEndpointPath(endpoint)).toEqual({ ok: true });
  });
});

describe('SEC-01 — handleSapProxy rechaza bypass sin llamar a SAP', () => {
  it.each(MALICIOSOS)('%s → invalid-argument y sin fetch', async (_d, endpoint, method) => {
    // admin: el rol con más permisos, para probar que el rechazo no depende del rol.
    const deps = makeDeps('admin');
    await expect(
      handleSapProxy({ endpoint, method, body: {} }, { uid: 'u1' }, deps)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('vendedor: GET /Invoices vía %2e%2e queda rechazado', async () => {
    const deps = makeDeps('vendedor');
    await expect(
      handleSapProxy({ endpoint: '/b1s/v1/Items/%2e%2e/Invoices' }, { uid: 'v1' }, deps)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('SEC-01 — endpoints legítimos siguen funcionando', () => {
  it('vendedor GET Items con clave → 200 y el SL recibe exactamente esa ruta', async () => {
    const deps = makeDeps('vendedor');
    const endpoint = "/b1s/v1/Items('CAC58MH2UR')?$select=ItemCode,ItemWarehouseInfoCollection";
    const res = await handleSapProxy({ endpoint }, { uid: 'v1' }, deps);
    expect(res.status).toBe(200);
    const urls = deps.fetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain('https://shimano-sap.seidor.com.ar:50000' + endpoint);
  });

  it('vendedor GET SQLQueries stock por depósito → 200', async () => {
    const deps = makeDeps('vendedor');
    const res = await handleSapProxy(
      { endpoint: "/b1s/v1/SQLQueries('ItemStockByWhs')/List?ItemCode='ABC'&WhsCode='11'" },
      { uid: 'v1' },
      deps
    );
    expect(res.status).toBe(200);
  });

  it('admin POST Quotations → 200 (escritura permitida se conserva)', async () => {
    const deps = makeDeps('admin');
    const res = await handleSapProxy(
      { endpoint: '/b1s/v1/Quotations', method: 'POST', body: { CardCode: 'C1' } },
      { uid: 'a1' },
      deps
    );
    expect(res.status).toBe(200);
  });

  it('admin POST Quotations(N)/Cancel → 200', async () => {
    const deps = makeDeps('admin');
    const res = await handleSapProxy(
      { endpoint: '/b1s/v1/Quotations(42)/Cancel', method: 'POST' },
      { uid: 'a1' },
      deps
    );
    expect(res.status).toBe(200);
  });

  it('allowlist sin cambios: vendedor GET BusinessPartners sigue denegado', async () => {
    const deps = makeDeps('vendedor');
    await expect(
      handleSapProxy({ endpoint: "/b1s/v1/BusinessPartners('C1')" }, { uid: 'v1' }, deps)
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('allowlist sin cambios: vendedor POST Quotations sigue denegado', async () => {
    const deps = makeDeps('vendedor');
    await expect(
      handleSapProxy(
        { endpoint: '/b1s/v1/Quotations', method: 'POST', body: {} },
        { uid: 'v1' },
        deps
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
