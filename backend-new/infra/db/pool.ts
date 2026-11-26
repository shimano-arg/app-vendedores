/**
 * Kysely + `pg` Pool.
 *
 * Patron:
 *   - 1 pool por proceso (Cloud Functions mantiene warm instance).
 *   - Connection string viene de `DATABASE_URL` (Secret Manager en prod,
 *     dotenv/testcontainers en dev/test).
 *   - El wrapper `createDb(connectionString)` permite inyectar el string
 *     para tests (testcontainers) sin tocar env vars globales.
 *   - Lazy singleton `getDb()` para codigo server-side que usa el default
 *     DATABASE_URL.
 */

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

const { Pool } = pg;

/**
 * Crea una instancia Kysely + Pool para un connection string dado.
 * Se usa en:
 *   - Prod: 1 vez al boot de la Cloud Function con `process.env.DATABASE_URL`.
 *   - Tests: 1 vez por suite con el string del testcontainer.
 */
export function createDb(connectionString: string, opts?: {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}): Kysely<Database> {
  const pool = new Pool({
    connectionString,
    max: opts?.max ?? 10,
    idleTimeoutMillis: opts?.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: opts?.connectionTimeoutMillis ?? 5_000,
  });

  pool.on('error', (err) => {
    // Idle client error. Log y seguir — el pool se auto-recupera.
    // eslint-disable-next-line no-console
    console.error('[pg-pool] idle client error', err);
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

// ---------------------------------------------------------------------------
// Singleton (process-wide). Util para Cloud Functions / HTTP server.
// ---------------------------------------------------------------------------

let _dbSingleton: Kysely<Database> | null = null;

/**
 * Devuelve el singleton Kysely. En test, preferir `createDb(testContainerUrl)`
 * y pasar la instancia explicitamente a los repos.
 */
export function getDb(): Kysely<Database> {
  if (_dbSingleton) return _dbSingleton;
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      '[pool] DATABASE_URL no esta set. Setealo via Secret Manager en prod ' +
        'o .env en dev. En test usar createDb(testContainerUrl) directo.',
    );
  }
  _dbSingleton = createDb(url);
  return _dbSingleton;
}

/**
 * Cierra el singleton. Util para graceful shutdown + tests.
 */
export async function closeDb(): Promise<void> {
  if (_dbSingleton) {
    await _dbSingleton.destroy();
    _dbSingleton = null;
  }
}
