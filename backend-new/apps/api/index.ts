/**
 * Entry Hono — wire-up de rutas + registry.
 *
 * Esta fn `createApp(db)` devuelve la instancia Hono con todas las rutas
 * montadas. El wrapper `wrapper-firebase.ts` la expone como CF Gen 2;
 * si/cuando se migre a Cloud Run, se usa el mismo app con el adapter
 * node.js (Hono soporta ambos).
 *
 * No hace side effects al import — todo es explicit con `createApp`.
 */

import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { Database } from '../../infra/db/schema.js';

import { createHealthRoute } from './routes/health.js';
import { createStockRoute } from './routes/stock.js';
import { createPedidosRoute } from './routes/pedidos.js';

export interface CreateAppDeps {
  db: Kysely<Database>;
}

/**
 * Monta la Hono app. Las rutas de negocio van bajo `/api/v1/*`;
 * `/health` queda fuera para que las probes Cloud Run / GCP la tengan
 * siempre disponible.
 */
export function createApp(deps: CreateAppDeps): Hono {
  const app = new Hono();

  // Middleware global: cada request mapea su `X-Request-Id` (o genera uno)
  // para correlacion en logs. En v1 se agrega structured logging con pino.
  app.use('*', async (c, next) => {
    const reqId =
      c.req.header('x-request-id') ??
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    c.set('requestId' as never, reqId);
    c.header('x-request-id', reqId);
    await next();
  });

  // Rutas infra.
  app.route('/', createHealthRoute({ db: deps.db }));

  // Rutas de negocio v1.
  const v1 = new Hono();
  v1.route('/', createStockRoute({ db: deps.db }));
  v1.route('/', createPedidosRoute({ db: deps.db }));
  app.route('/api/v1', v1);

  // Catch-all 404.
  app.notFound((c) =>
    c.json(
      {
        ok: false,
        errorCode: 'NOT_FOUND',
        data: { path: c.req.path, method: c.req.method },
      },
      404,
    ),
  );

  // Error handler global — defensiva en caso de que una ruta tire sin catch.
  app.onError((err, c) => {
    // eslint-disable-next-line no-console
    console.error('[hono] unhandled', err);
    return c.json(
      {
        ok: false,
        errorCode: 'INTERNAL',
        data: { err: err.message },
      },
      500,
    );
  });

  return app;
}
