/**
 * Integration test — `getStockBreakdown` contra PG real via testcontainers.
 *
 * Patron tolerante (CLAUDE.md §11): si Docker no esta disponible en el
 * environment (ej. CI sin Docker, dev local sin Docker Desktop corriendo),
 * la suite se salta con `describe.skipIf`. NO rompe la build.
 *
 * Ejecucion:
 *   - Con DATABASE_URL set (ej. CI apuntando a shadow): usa ese PG.
 *   - Sin DATABASE_URL + Docker available: levanta testcontainer efimero.
 *   - Sin DATABASE_URL + sin Docker: skip.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createDb } from '../../infra/db/pool.js';
import { createStockRepo } from '../../infra/db/repos/stock-repo.js';
import { getStockBreakdown } from './get-breakdown.js';
import { BusinessError, ERROR_CODES } from '../../shared/errors/business-errors.js';
import type { Kysely } from 'kysely';
import type { Database } from '../../infra/db/schema.js';

// ---------------------------------------------------------------------------
// Detectar si podemos correr integration.
// ---------------------------------------------------------------------------

const EXTERNAL_DB_URL = process.env['DATABASE_URL'];
const _dockerAvailable = await detectDockerAvailable();
const canRunIntegration = Boolean(EXTERNAL_DB_URL) || _dockerAvailable;

/**
 * Chequea si Docker esta disponible via `docker info`. Usa execFile (no
 * shell interpolation) para evitar shell injection warnings.
 */
async function detectDockerAvailable(): Promise<boolean> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('docker', ['info'], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fixture del schema SQL
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, '..', '..', 'db', 'schema', '0001_initial.sql');

function readSchemaSql(): string {
  return readFileSync(schemaPath, 'utf8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!canRunIntegration)('integration: getStockBreakdown via v_stock_breakdown', () => {
  let db: Kysely<Database>;
  let connectionString = '';
  let container: { stop: () => Promise<unknown> } | null = null;

  beforeAll(async () => {
    if (EXTERNAL_DB_URL) {
      connectionString = EXTERNAL_DB_URL;
    } else {
      const tc = (await import('testcontainers')) as unknown as {
        PostgreSqlContainer: new (image: string) => {
          withDatabase: (n: string) => any;
          withUsername: (u: string) => any;
          withPassword: (p: string) => any;
          start: () => Promise<{
            getConnectionUri: () => string;
            stop: () => Promise<unknown>;
          }>;
        };
      };
      const started = await new tc.PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('shimano_test')
        .withUsername('test')
        .withPassword('test')
        .start();
      connectionString = started.getConnectionUri();
      container = { stop: () => started.stop() };
    }

    db = createDb(connectionString);

    // Correr migration v0 contra el container efimero.
    const sql = readSchemaSql();
    const { Client } = await import('pg');
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    if (container) await container.stop();
  });

  test('throws STOCK_SKU_NOT_FOUND for SKU without snapshot nor lines', async () => {
    const repo = createStockRepo(db);
    await expect(
      getStockBreakdown('SKU-GHOST-12345', { repo }),
    ).rejects.toBeInstanceOf(BusinessError);
    await expect(
      getStockBreakdown('SKU-GHOST-12345', { repo }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.STOCK_SKU_NOT_FOUND });
  });

  test('returns breakdown with physical stock, zero reservations', async () => {
    await db
      .insertInto('stock_snapshot')
      .values({
        sku: 'SKU-A',
        warehouse: 'dep_11',
        physical_qty: 10,
        source: 'seed',
      })
      .execute();

    const repo = createStockRepo(db);
    const out = await getStockBreakdown('SKU-A', { repo });

    expect(out.sku).toBe('SKU-A');
    expect(out.fisicoDep11).toBe(10);
    expect(out.libreDep11).toBe(10);
    expect(out.reservadasDep11).toBe(0);
    expect(out._version).toBe(1);

    await db.deleteFrom('stock_snapshot').where('sku', '=', 'SKU-A').execute();
  });

  test('libre = fisico - reservadas when an ASIG line exists', async () => {
    // Setup: snapshot 10u + pedido abierto con 1 linea ASIG qty_open=4
    await db
      .insertInto('stock_snapshot')
      .values({
        sku: 'SKU-B',
        warehouse: 'dep_11',
        physical_qty: 10,
        source: 'seed',
      })
      .execute();

    await db
      .insertInto('pedidos')
      .values({
        id: 'p_test_b',
        order_number: 99901,
        client_card_code: 'C001',
        client_name: 'cliente A',
        assigned_vendor_uid: 'vendedor-01',
        assigned_vendor_key: 'VENDOR_A',
        owner_uid: 'vendedor-01',
        cargado_por_uid: 'vendedor-01',
        origen: 'manual',
        transferido_sap: {},
      })
      .execute();

    await db
      .insertInto('pedido_lines')
      .values({
        pedido_id: 'p_test_b',
        line_index: 0,
        sku: 'SKU-B',
        state: 'ASIG',
        qty: 4,
        qty_open: 4,
        price_ars: 1000,
        asig_at: new Date(),
      })
      .execute();

    const repo = createStockRepo(db);
    const out = await getStockBreakdown('SKU-B', { repo });

    expect(out.fisicoDep11).toBe(10);
    expect(out.asignadasDep11).toBe(4);
    expect(out.reservadasDep11).toBe(4);
    expect(out.libreDep11).toBe(6);

    // Cleanup — cascade borra pedido_lines + stock_reservations (via trigger).
    await db.deleteFrom('pedidos').where('id', '=', 'p_test_b').execute();
    await db.deleteFrom('stock_snapshot').where('sku', '=', 'SKU-B').execute();
  });
});
