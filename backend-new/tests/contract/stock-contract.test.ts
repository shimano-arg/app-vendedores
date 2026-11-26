/**
 * Contract test — valida que el shape devuelto por el domain `getStockBreakdown`
 * matchea el schema Zod `GetStockOutput`.
 *
 * NO toca DB. Usa un mock `StockRepo` que devuelve un row fixture.
 * Si en el futuro el shape del repo cambia, este test falla ANTES de llegar
 * a integration.
 */

import { describe, it, expect } from 'vitest';
import { getStockBreakdown } from '../../domains/stock/get-breakdown.js';
import { GetStockOutput } from '../../shared/contracts/get-stock.js';
import type { StockRepo } from '../../infra/db/repos/stock-repo.js';
import { BusinessError, ERROR_CODES } from '../../shared/errors/business-errors.js';

function makeMockRepo(row: Awaited<ReturnType<StockRepo['getStockBreakdownBySku']>>): StockRepo {
  return {
    getStockBreakdownBySku: async () => row,
  };
}

describe('contract: getStockBreakdown ↔ GetStockOutput schema', () => {
  it('output matches Zod schema for a typical SKU', async () => {
    const repo = makeMockRepo({
      sku: 'SKU-001',
      fisicoDep11: 10,
      transitoDep12: 5,
      backorderApp: 3,
      asignadasDep11: 4,
      confirmadasDep11: 2,
      asignadasDep12: 1,
      confirmadasDep12: 0,
      reservadasDep11: 6,
      libreDep11: 4,
    });

    const out = await getStockBreakdown('SKU-001', { repo });

    // Schema parse — explode si el shape no matchea.
    const parsed = GetStockOutput.parse(out);

    expect(parsed.sku).toBe('SKU-001');
    expect(parsed.fisicoDep11).toBe(10);
    expect(parsed.libreDep11).toBe(4);
    expect(parsed._version).toBe(1);
  });

  it('output with zero stock matches schema', async () => {
    const repo = makeMockRepo({
      sku: 'SKU-ZERO',
      fisicoDep11: 0,
      transitoDep12: 0,
      backorderApp: 0,
      asignadasDep11: 0,
      confirmadasDep11: 0,
      asignadasDep12: 0,
      confirmadasDep12: 0,
      reservadasDep11: 0,
      libreDep11: 0,
    });
    const out = await getStockBreakdown('SKU-ZERO', { repo });
    expect(() => GetStockOutput.parse(out)).not.toThrow();
  });

  it('throws STOCK_SKU_NOT_FOUND when repo returns null', async () => {
    const repo = makeMockRepo(null);
    await expect(getStockBreakdown('SKU-GHOST', { repo })).rejects.toMatchObject({
      errorCode: ERROR_CODES.STOCK_SKU_NOT_FOUND,
    });
  });

  it('BusinessError carries the sku in data', async () => {
    const repo = makeMockRepo(null);
    try {
      await getStockBreakdown('SKU-GHOST', { repo });
      expect.fail('Expected BusinessError');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessError);
      expect((e as BusinessError).data).toEqual({ sku: 'SKU-GHOST' });
    }
  });

  it('schema rejects negative numbers (defense in depth vs bugs en el repo)', () => {
    expect(() =>
      GetStockOutput.parse({
        sku: 'X',
        fisicoDep11: -1,
        transitoDep12: 0,
        backorderApp: 0,
        asignadasDep11: 0,
        confirmadasDep11: 0,
        asignadasDep12: 0,
        confirmadasDep12: 0,
        reservadasDep11: 0,
        libreDep11: 0,
        _version: 1,
      }),
    ).toThrow();
  });
});
