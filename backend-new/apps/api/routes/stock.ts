/**
 * Ruta `GET /api/v1/stock/:sku`.
 *
 * Adapter Hono para la domain fn `getStockBreakdown`. Valida los params
 * con Zod, llama al core, mapea errores a envelopes canonicos.
 */

import { Hono } from 'hono';
import type { Kysely } from 'kysely';

import type { Database } from '../../../infra/db/schema.js';
import { createStockRepo } from '../../../infra/db/repos/stock-repo.js';
import { getStockBreakdown } from '../../../domains/stock/get-breakdown.js';
import { GetStockParams } from '../../../shared/contracts/get-stock.js';
import { isBusinessError, ERROR_CODES, type ErrorCode } from '../../../shared/errors/business-errors.js';

export interface StockRouteDeps {
  db: Kysely<Database>;
}

export function createStockRoute(deps: StockRouteDeps): Hono {
  const app = new Hono();
  const repo = createStockRepo(deps.db);

  app.get('/stock/:sku', async (c) => {
    // 1. Validar params.
    const parsed = GetStockParams.safeParse({ sku: c.req.param('sku') });
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          errorCode: ERROR_CODES.VALIDATION_ERROR,
          data: { issues: parsed.error.issues },
        },
        400,
      );
    }

    // 2. Ejecutar domain.
    try {
      const data = await getStockBreakdown(parsed.data.sku, { repo });
      return c.json({ ok: true, data });
    } catch (e) {
      if (isBusinessError(e)) {
        const status = httpStatusFor(e.errorCode);
        return c.json(
          {
            ok: false,
            errorCode: e.errorCode,
            data: e.data,
          },
          status,
        );
      }
      return c.json(
        {
          ok: false,
          errorCode: ERROR_CODES.INTERNAL,
          data: { err: e instanceof Error ? e.message : String(e) },
        },
        500,
      );
    }
  });

  return app;
}

function httpStatusFor(code: ErrorCode): 400 | 404 | 500 | 503 {
  switch (code) {
    case ERROR_CODES.VALIDATION_ERROR:
      return 400;
    case ERROR_CODES.STOCK_SKU_NOT_FOUND:
      return 404;
    case ERROR_CODES.STOCK_SNAPSHOT_UNAVAILABLE:
      return 503;
    case ERROR_CODES.DATABASE_UNAVAILABLE:
      return 503;
    default:
      return 500;
  }
}
