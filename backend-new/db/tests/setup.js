/**
 * Setup compartido para los tests Vitest.
 *
 * Responsabilidades:
 *  - Detectar si hay PostgreSQL disponible via DATABASE_URL.
 *  - Exponer un pool `pg` para los tests.
 *  - Correr la migracion 0001_initial.sql si la DB esta vacia.
 *
 * Patron de skip: los archivos de test usan `describeIfDb(name, fn)` o
 * `it.skipIf(!hasDb)(...)`. Si no hay DB, el test suite se marca saltado con
 * mensaje claro.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, describe } from 'vitest';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_SQL_PATH = resolve(__dirname, '../schema/0001_initial.sql');

export const DATABASE_URL = process.env.DATABASE_URL || null;
export const hasDb = Boolean(DATABASE_URL);

let sharedPool = null;
let schemaApplied = false;

export function getPool() {
  if (!hasDb) {
    throw new Error(
      'getPool() llamado sin DATABASE_URL — chequear hasDb antes.'
    );
  }
  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return sharedPool;
}

export async function ensureSchemaApplied() {
  if (!hasDb) return;
  if (schemaApplied) return;

  const sql = readFileSync(SCHEMA_SQL_PATH, 'utf8');
  const pool = getPool();
  const client = await pool.connect();
  try {
    // La migracion 0001 no es idempotente per se (usa CREATE TYPE sin IF NOT
    // EXISTS porque PostgreSQL no lo soporta para ENUM pre-9.1-style).
    // Hacemos un DROP SCHEMA + CREATE SCHEMA defensivo: los tests arrancan
    // siempre con DB limpia.
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO public');
    await client.query(sql);
    schemaApplied = true;
  } finally {
    client.release();
  }
}

/**
 * describe que skippea el bloque entero si no hay DB.
 */
export function describeIfDb(name, fn) {
  if (!hasDb) {
    describe.skip(`${name} [skipped — DATABASE_URL no definido]`, fn);
  } else {
    describe(name, fn);
  }
}

/**
 * Utility: ejecutar un callback en una transaccion que SIEMPRE rollbackea.
 * Ideal para tests que no necesitan commit real (90% de los casos).
 *
 * Si el test necesita commit (ej. validar triggers IMMEDIATE), usar getPool()
 * directo y hacer cleanup manual.
 */
export async function withTx(cb) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fixture seeding: 1 cliente + 1 vendedor + 3 SKUs con stock.
 * Idempotente (ON CONFLICT DO NOTHING / UPDATE).
 */
export async function seedFixture(client) {
  // stock_snapshot (sku, warehouse) PK
  await client.query(`
    INSERT INTO stock_snapshot (sku, warehouse, physical_qty, source) VALUES
      ('SKU-AAA-001', 'dep_11', 10, 'seed'),
      ('SKU-AAA-001', 'dep_12',  0, 'seed'),
      ('SKU-BBB-002', 'dep_11',  5, 'seed'),
      ('SKU-BBB-002', 'dep_12',  3, 'seed'),
      ('SKU-CCC-003', 'dep_11',  0, 'seed'),
      ('SKU-CCC-003', 'dep_12', 20, 'seed')
    ON CONFLICT (sku, warehouse) DO UPDATE SET physical_qty = EXCLUDED.physical_qty;
  `);
}

// Cleanup del pool al final de la suite completa.
if (hasDb) {
  afterAll(async () => {
    if (sharedPool) {
      await sharedPool.end();
      sharedPool = null;
    }
  });
}
