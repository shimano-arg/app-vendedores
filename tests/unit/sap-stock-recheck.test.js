// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import {
  fetchLiveWhs11Availability,
  filterLinesByLiveStock,
  SALES_WAREHOUSE,
} from '../../functions/core/sap-stock-recheck-core.js';

/**
 * Helper: construye deps mock con un fetch que responde a `/b1s/v1/Items?...`
 * con el `itemsResponse` provisto. Si `httpStatus` != 200, devuelve error.
 * Si `throwErr` está setteado, el fetch tira ese error.
 */
function makeDeps({ itemsResponse = { value: [] }, httpStatus = 200, throwErr = null } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url) => {
    calls.push(url);
    if (throwErr) throw throwErr;
    const bodyStr = JSON.stringify(itemsResponse);
    return {
      status: httpStatus,
      ok: httpStatus >= 200 && httpStatus < 300,
      text: async () => bodyStr,
      headers: { get: () => null },
    };
  });
  return {
    deps: {
      fetch,
      sapConfig: {
        url: 'https://sap.example',
        companyDB: 'SBODEMOAR',
        userName: 'x',
        password: 'y',
      },
      log: () => {},
    },
    calls,
  };
}

const dummySession = { cookie: 'B1SESSION=abc; ROUTEID=r1' };

describe('SALES_WAREHOUSE', () => {
  it('está fijo en whs 11 (canónico Shimano PESCA vendible)', () => {
    expect(SALES_WAREHOUSE).toBe('11');
  });
});

describe('fetchLiveWhs11Availability', () => {
  it('retorna Map vacío si no hay itemCodes', async () => {
    const { deps, calls } = makeDeps();
    const res = await fetchLiveWhs11Availability(dummySession, [], deps);
    expect(res.ok).toBe(true);
    expect(res.map.size).toBe(0);
    expect(calls.length).toBe(0);
  });

  it('parsea InStock - Committed del whs 11 correctamente', async () => {
    const { deps } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'SKU-A',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 10, Committed: 3, Ordered: 20 },
              { WarehouseCode: '05', InStock: 999, Committed: 0, Ordered: 0 },
            ],
          },
        ],
      },
    });
    const res = await fetchLiveWhs11Availability(dummySession, ['SKU-A'], deps);
    expect(res.ok).toBe(true);
    expect(res.map.get('SKU-A')).toBe(7); // 10 - 3 = 7 (Ordered NO se resta)
  });

  it('ItemCode con whs 11 ausente → available = 0', async () => {
    const { deps } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'SKU-B',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '07', InStock: 5, Committed: 0, Ordered: 0 },
            ],
          },
        ],
      },
    });
    const res = await fetchLiveWhs11Availability(dummySession, ['SKU-B'], deps);
    expect(res.map.get('SKU-B')).toBe(0);
  });

  it('Committed > InStock → available clamped a 0 (no negativo)', async () => {
    const { deps } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'SKU-C',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 5, Committed: 10, Ordered: 0 },
            ],
          },
        ],
      },
    });
    const res = await fetchLiveWhs11Availability(dummySession, ['SKU-C'], deps);
    expect(res.map.get('SKU-C')).toBe(0);
  });

  it('SAP responde 500 → ok:false con error string', async () => {
    const { deps } = makeDeps({ httpStatus: 500 });
    const res = await fetchLiveWhs11Availability(dummySession, ['SKU-X'], deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });

  it('fetch throws → ok:false con "sapGet threw"', async () => {
    const { deps } = makeDeps({ throwErr: new Error('ETIMEDOUT') });
    const res = await fetchLiveWhs11Availability(dummySession, ['SKU-Y'], deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('sapGet threw');
    expect(res.error).toContain('ETIMEDOUT');
  });

  it('encodea el $filter con OR chain para varios items', async () => {
    const { deps, calls } = makeDeps({
      itemsResponse: {
        value: [{ ItemCode: 'A', ItemWarehouseInfoCollection: [] }],
      },
    });
    await fetchLiveWhs11Availability(dummySession, ['A', 'B', 'C'], deps);
    expect(calls.length).toBe(1);
    const url = decodeURIComponent(calls[0]);
    expect(url).toContain(`ItemCode eq 'A'`);
    expect(url).toContain(`ItemCode eq 'B'`);
    expect(url).toContain(`ItemCode eq 'C'`);
    expect(url).toContain(' or ');
    expect(url).toContain('$top=3');
  });

  it('sanitiza apóstrofes en ItemCode (defensa OData)', async () => {
    const { deps, calls } = makeDeps({ itemsResponse: { value: [] } });
    await fetchLiveWhs11Availability(dummySession, ["SKU'X"], deps);
    const url = decodeURIComponent(calls[0]);
    expect(url).toContain(`ItemCode eq 'SKU''X'`);
  });
});

describe('filterLinesByLiveStock', () => {
  it('lista vacía → kept vacío, degraded vacío, check succeeded', async () => {
    const { deps } = makeDeps();
    const res = await filterLinesByLiveStock(dummySession, [], deps);
    expect(res.keptLines).toEqual([]);
    expect(res.degradedLines).toEqual([]);
    expect(res.checkSucceeded).toBe(true);
  });

  it('todas las líneas caben → kept intacto, degraded vacío', async () => {
    const { deps } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'A',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 100, Committed: 0, Ordered: 0 },
            ],
          },
          {
            ItemCode: 'B',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 50, Committed: 5, Ordered: 0 },
            ],
          },
        ],
      },
    });
    const lines = [
      { ItemCode: 'A', Quantity: 10, WarehouseCode: '11' },
      { ItemCode: 'B', Quantity: 40, WarehouseCode: '11' },
    ];
    const res = await filterLinesByLiveStock(dummySession, lines, deps);
    expect(res.keptLines).toEqual(lines);
    expect(res.degradedLines).toEqual([]);
    expect(res.checkSucceeded).toBe(true);
  });

  it('línea excede → sale a degraded, la otra queda en kept', async () => {
    const { deps } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'A',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 5, Committed: 0, Ordered: 0 },
            ],
          },
          {
            ItemCode: 'B',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 100, Committed: 0, Ordered: 0 },
            ],
          },
        ],
      },
    });
    const lines = [
      { ItemCode: 'A', Quantity: 10, WarehouseCode: '11' }, // pide 10, hay 5
      { ItemCode: 'B', Quantity: 3, WarehouseCode: '11' }, // pide 3, hay 100
    ];
    const res = await filterLinesByLiveStock(dummySession, lines, deps);
    expect(res.keptLines).toHaveLength(1);
    expect(res.keptLines[0].ItemCode).toBe('B');
    expect(res.degradedLines).toHaveLength(1);
    expect(res.degradedLines[0]).toEqual({
      itemCode: 'A',
      requested: 10,
      available: 5,
      reason: 'insufficient_whs11_stock',
    });
  });

  it('SAP no encuentra el ItemCode → degraded con reason sap_item_not_found', async () => {
    const { deps } = makeDeps({
      itemsResponse: { value: [] }, // SAP no devuelve nada
    });
    const lines = [{ ItemCode: 'FANTASMA', Quantity: 1, WarehouseCode: '11' }];
    const res = await filterLinesByLiveStock(dummySession, lines, deps);
    expect(res.keptLines).toEqual([]);
    expect(res.degradedLines[0].reason).toBe('sap_item_not_found');
    expect(res.degradedLines[0].available).toBe(0);
  });

  it('FAIL-OPEN: si el GET SAP falla, TODAS las líneas quedan intactas', async () => {
    const { deps } = makeDeps({ httpStatus: 500 });
    const lines = [
      { ItemCode: 'A', Quantity: 999, WarehouseCode: '11' },
      { ItemCode: 'B', Quantity: 999, WarehouseCode: '11' },
    ];
    const res = await filterLinesByLiveStock(dummySession, lines, deps);
    expect(res.keptLines).toEqual(lines); // ninguna se remueve
    expect(res.degradedLines).toEqual([]);
    expect(res.checkSucceeded).toBe(false);
    expect(res.checkError).toContain('500');
  });

  it('todas las líneas se degradan → keptLines vacío pero check exitoso', async () => {
    const { deps } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'A',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 0, Committed: 0, Ordered: 0 },
            ],
          },
        ],
      },
    });
    const lines = [{ ItemCode: 'A', Quantity: 5, WarehouseCode: '11' }];
    const res = await filterLinesByLiveStock(dummySession, lines, deps);
    expect(res.keptLines).toEqual([]);
    expect(res.degradedLines).toHaveLength(1);
    expect(res.checkSucceeded).toBe(true);
  });

  it('Quantity exactamente igual a available → línea queda (no degrada)', async () => {
    const { deps } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'A',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 5, Committed: 0, Ordered: 0 },
            ],
          },
        ],
      },
    });
    const lines = [{ ItemCode: 'A', Quantity: 5, WarehouseCode: '11' }];
    const res = await filterLinesByLiveStock(dummySession, lines, deps);
    expect(res.keptLines).toHaveLength(1);
    expect(res.degradedLines).toEqual([]);
  });

  it('deduplica ItemCodes en la query pero preserva las líneas de entrada', async () => {
    const { deps, calls } = makeDeps({
      itemsResponse: {
        value: [
          {
            ItemCode: 'DUP',
            ItemWarehouseInfoCollection: [
              { WarehouseCode: '11', InStock: 100, Committed: 0, Ordered: 0 },
            ],
          },
        ],
      },
    });
    // El caller upstream ya deduplica pero por si acaso, testeamos que
    // el query NO llame 2 veces por el mismo ItemCode.
    const lines = [
      { ItemCode: 'DUP', Quantity: 3, WarehouseCode: '11' },
      { ItemCode: 'DUP', Quantity: 4, WarehouseCode: '11' },
    ];
    const res = await filterLinesByLiveStock(dummySession, lines, deps);
    expect(res.keptLines).toHaveLength(2); // ambas líneas quedan (100 disp)
    const url = decodeURIComponent(calls[0]);
    // El $filter no debería tener DUP repetido dos veces.
    const dupCount = (url.match(/DUP/g) || []).length;
    expect(dupCount).toBe(1);
  });
});
