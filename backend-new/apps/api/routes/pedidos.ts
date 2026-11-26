/**
 * Ruta `GET /api/v1/pedidos?cardCode=...&stage=open&cursor=...&limit=50`.
 *
 * Adapter Hono para la domain fn `getPedidosByClient`.
 *
 * NOTA: cuando se abran mutaciones (`POST /pedidos`), agregar aqui:
 *   - Validacion de `idempotencyKey` (shared/contracts/common.ts).
 *   - Lookup en `pedido_draft_locks` (INSERT ON CONFLICT DO NOTHING RETURNING).
 *   - CLAUDE.md §58: ALL reads before ALL writes dentro de la transaccion.
 *   - CLAUDE.md §64.3: lock atomico dentro del runTransaction.
 *   - CLAUDE.md §64.2: log centralizado de rechazos a `operations_log`.
 */

import { Hono } from 'hono';
import type { Kysely } from 'kysely';

import type { Database } from '../../../infra/db/schema.js';
import { createPedidosRepo } from '../../../infra/db/repos/pedidos-repo.js';
import { getPedidosByClient } from '../../../domains/pedidos/get-pedidos-by-client.js';
import { GetPedidosByClientQuery } from '../../../shared/contracts/get-pedidos.js';
import {
  ERROR_CODES,
  isBusinessError,
  type ErrorCode,
} from '../../../shared/errors/business-errors.js';

export interface PedidosRouteDeps {
  db: Kysely<Database>;
}

export function createPedidosRoute(deps: PedidosRouteDeps): Hono {
  const app = new Hono();
  const repo = createPedidosRepo(deps.db);

  app.get('/pedidos', async (c) => {
    const rawCardCode = c.req.query('cardCode');
    const rawStage = c.req.query('stage');
    const rawCursor = c.req.query('cursor');
    const rawLimit = c.req.query('limit');

    const limitNum = rawLimit != null ? Number(rawLimit) : undefined;

    const toValidate: Record<string, unknown> = { cardCode: rawCardCode };
    if (rawStage !== undefined) toValidate['stage'] = rawStage;
    if (rawCursor !== undefined) toValidate['cursor'] = rawCursor;
    if (limitNum !== undefined && !Number.isNaN(limitNum)) {
      toValidate['limit'] = limitNum;
    }

    const parsed = GetPedidosByClientQuery.safeParse(toValidate);
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

    try {
      const input: Parameters<typeof getPedidosByClient>[0] = {
        cardCode: parsed.data.cardCode,
        stage: parsed.data.stage,
        limit: parsed.data.limit,
      };
      if (parsed.data.cursor !== undefined) {
        input.cursor = parsed.data.cursor;
      }
      const data = await getPedidosByClient(input, { repo });
      return c.json({ ok: true, data });
    } catch (e) {
      if (isBusinessError(e)) {
        return c.json(
          {
            ok: false,
            errorCode: e.errorCode,
            data: e.data,
          },
          httpStatusFor(e.errorCode),
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
    case ERROR_CODES.PEDIDOS_CURSOR_INVALIDO:
      return 400;
    case ERROR_CODES.PEDIDOS_CLIENTE_NO_ENCONTRADO:
      return 404;
    case ERROR_CODES.DATABASE_UNAVAILABLE:
      return 503;
    default:
      return 500;
  }
}
