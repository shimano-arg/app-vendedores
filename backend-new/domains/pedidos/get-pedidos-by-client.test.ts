/**
 * Integration test — `getPedidosByClient` contra PG real via testcontainers.
 * Patron tolerante (CLAUDE.md §11): skip si no hay Docker ni DATABASE_URL.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createDb } from '../../infra/db/pool.js';
import { createPedidosRepo } from '../../infra/db/repos/pedidos-repo.js';
import { getPedidosByClient } from './get-pedidos-by-client.js';
import type { Kysely } from 'kysely';
import type { Database } from '../../infra/db/schema.js';

const EXTERNAL_DB_URL = process.env['DATABASE_URL'];
const _dockerAvailable = await detectDockerAvailable();
const canRunIntegration = Boolean(EXTERNAL_DB_URL) || _dockerAvailable;

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, '..', '..', 'db', 'schema', '0001_initial.sql');

describe.skipIf(!canRunIntegration)('integration: getPedidosByClient', () => {
  let db: Kysely<Database>;
  let container: { stop: () => Promise<unknown> } | null = null;

  beforeAll(async () => {
    let connectionString = '';
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
        .withDatabase('shimano_test_pedidos')
        .withUsername('test')
        .withPassword('test')
        .start();
      connectionString = started.getConnectionUri();
      container = { stop: () => started.stop() };
    }

    db = createDb(connectionString);

    const sql = readFileSync(schemaPath, 'utf8');
    const { Client } = await import('pg');
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }

    // Seed: 2 pedidos del mismo cliente con lineas.
    await db
      .insertInto('pedidos')
      .values([
        {
          id: 'p_old',
          order_number: 1001,
          client_card_code: 'C001',
          client_name: 'cliente A',
          assigned_vendor_uid: 'vendedor-01',
          assigned_vendor_key: 'VENDOR_A',
          owner_uid: 'vendedor-01',
          cargado_por_uid: 'vendedor-01',
          origen: 'manual',
          transferido_sap: {},
          created_at: new Date('2026-11-25T10:00:00Z'),
        },
        {
          id: 'p_new',
          order_number: 1002,
          client_card_code: 'C001',
          client_name: 'cliente A',
          assigned_vendor_uid: 'vendedor-01',
          assigned_vendor_key: 'VENDOR_A',
          owner_uid: 'vendedor-01',
          cargado_por_uid: 'vendedor-01',
          origen: 'cpst',
          transferido_sap: {},
          created_at: new Date('2026-11-26T11:00:00Z'),
        },
      ])
      .execute();

    await db
      .insertInto('pedido_lines')
      .values([
        {
          pedido_id: 'p_new',
          line_index: 0,
          sku: 'SKU-X',
          state: 'confirmed',
          qty: 3,
          qty_open: 3,
          price_ars: 1500,
          discount_percent: 10,
          confirmed_at: new Date('2026-11-26T12:00:00Z'),
        },
        {
          pedido_id: 'p_new',
          line_index: 1,
          sku: 'SKU-Y',
          state: 'BO',
          qty: 1,
          qty_open: 1,
          price_ars: 500,
        },
      ])
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    if (container) await container.stop();
  });

  test('returns open pedidos for client, newest first', async () => {
    const repo = createPedidosRepo(db);
    const out = await getPedidosByClient(
      { cardCode: 'C001', stage: 'open', limit: 50 },
      { repo },
    );

    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.id).toBe('p_new'); // newest first
    expect(out.items[0]!.orderNumber).toBe(1002);
    expect(out.items[0]!.lines).toHaveLength(2);
    // netAmountArs = 3 * 1500 * 0.9 = 4050
    expect(out.items[0]!.netAmountArs).toBe(4050);
    expect(out.items[0]!.confirmedAt).toBe('2026-11-26T12:00:00.000Z');
    expect(out.items[1]!.id).toBe('p_old');
    expect(out.items[1]!.netAmountArs).toBeNull();
    expect(out.pageInfo.hasMore).toBe(false);
  });

  test('paginates with cursor', async () => {
    const repo = createPedidosRepo(db);
    const page1 = await getPedidosByClient(
      { cardCode: 'C001', stage: 'open', limit: 1 },
      { repo },
    );
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]!.id).toBe('p_new');
    expect(page1.pageInfo.hasMore).toBe(true);
    expect(page1.pageInfo.nextCursor).not.toBeNull();

    const page2 = await getPedidosByClient(
      {
        cardCode: 'C001',
        stage: 'open',
        limit: 1,
        cursor: page1.pageInfo.nextCursor!,
      },
      { repo },
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.id).toBe('p_old');
    expect(page2.pageInfo.hasMore).toBe(false);
  });
});
