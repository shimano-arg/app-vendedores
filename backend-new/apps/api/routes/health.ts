/**
 * Ruta de health check — bar check sencillo para readiness probes
 * + diagnostico de conectividad Kysely.
 */

import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { Database } from '../../../infra/db/schema.js';

export interface HealthRouteDeps {
  db: Kysely<Database>;
}

export function createHealthRoute(deps: HealthRouteDeps): Hono {
  const app = new Hono();

  app.get('/health', async (c) => {
    try {
      // Simple SELECT 1 — verifica conectividad PG.
      const row = await deps.db
        .selectNoFrom((eb) => eb.lit(1).as('ok'))
        .executeTakeFirst();
      return c.json({
        ok: true,
        data: {
          service: 'shimano-crm-backend-new',
          status: 'ok',
          db: row?.ok === 1 ? 'reachable' : 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (e) {
      return c.json(
        {
          ok: false,
          errorCode: 'DATABASE_UNAVAILABLE',
          data: {
            service: 'shimano-crm-backend-new',
            status: 'degraded',
            db: 'unreachable',
            err: e instanceof Error ? e.message : String(e),
            timestamp: new Date().toISOString(),
          },
        },
        503,
      );
    }
  });

  return app;
}
