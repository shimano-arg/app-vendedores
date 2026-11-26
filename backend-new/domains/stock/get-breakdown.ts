/**
 * Domain fn `getStockBreakdown(sku)` — ADR-013 piloto.
 *
 * Logica pura: recibe un `StockRepo` + un `SkuCode` validado. No conoce
 * Hono ni Firestore. Devuelve `GetStockOutput` que matchea el contrato Zod.
 *
 * Patron (CLAUDE.md §7): core puro con dependencia inyectable (repo).
 * El adapter Hono construye el repo contra Kysely y llama a esta fn.
 */

import { GetStockOutput, type GetStockOutput as TGetStockOutput } from '../../shared/contracts/get-stock.js';
import { BusinessError, ERROR_CODES } from '../../shared/errors/business-errors.js';
import type { StockRepo } from '../../infra/db/repos/stock-repo.js';

export interface GetStockBreakdownDeps {
  repo: StockRepo;
}

/**
 * Lee el breakdown para un SKU. Devuelve shape canonico v0.
 *
 * Errores:
 *   - `STOCK_SKU_NOT_FOUND` — el SKU no esta en stock_snapshot ni en
 *     pedido_lines viva. (La VIEW usa UNION: si el SKU no aparece en
 *     ninguna fuente, devuelve null).
 *   - El caller decide si tirar 404 o devolver un objeto "en 0" (depende
 *     de la UX — para el piloto, tiramos 404 explicito).
 */
export async function getStockBreakdown(
  sku: string,
  deps: GetStockBreakdownDeps,
): Promise<TGetStockOutput> {
  const row = await deps.repo.getStockBreakdownBySku(sku);
  if (!row) {
    throw new BusinessError(ERROR_CODES.STOCK_SKU_NOT_FOUND, {
      data: { sku },
    });
  }

  const output: TGetStockOutput = {
    sku: row.sku,
    fisicoDep11: row.fisicoDep11,
    transitoDep12: row.transitoDep12,
    backorderApp: row.backorderApp,
    asignadasDep11: row.asignadasDep11,
    confirmadasDep11: row.confirmadasDep11,
    asignadasDep12: row.asignadasDep12,
    confirmadasDep12: row.confirmadasDep12,
    reservadasDep11: row.reservadasDep11,
    libreDep11: row.libreDep11,
    _version: 1,
  };

  // Valida el shape antes de devolver — safety net contra drift del repo.
  return GetStockOutput.parse(output);
}
