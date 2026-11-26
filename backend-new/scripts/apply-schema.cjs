// Aplica backend-new/db/schema/0001_initial.sql contra una instancia PostgreSQL.
// Pensado para staging (crm-staging) via cloud-sql-proxy local:
//   cloud-sql-proxy --port=5433 app-vendedores-staging:southamerica-east1:crm-staging
//   PG_PASSWORD="$(gcloud secrets versions access latest --secret=PG_PASSWORD \
//     --project=app-vendedores-staging)" node scripts/apply-schema.cjs
// En prod se usa node-pg-migrate (ver `npm run migrate:up` en package.json). Este
// script existe para bootstrap del ambiente staging sin dependencias extra.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

async function main() {
  const sqlFile = path.join(__dirname, '..', 'db', 'schema', '0001_initial.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  console.log('SQL file:', sqlFile, 'size:', sql.length);

  const client = new Client({
    host: '127.0.0.1',
    port: 5433,
    user: 'crm_app',
    database: 'crm',
    password: process.env.PG_PASSWORD,
  });
  await client.connect();
  console.log('connected');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('schema applied OK');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    console.error('position:', e.position);
    console.error('severity:', e.severity);
    console.error('where:', e.where);
    if (typeof e.position === 'string' || typeof e.position === 'number') {
      const pos = Number(e.position);
      const start = Math.max(0, pos - 160);
      const end = Math.min(sql.length, pos + 160);
      console.error('--- context ---');
      console.error(sql.slice(start, pos) + '«HERE»' + sql.slice(pos, end));
    }
    process.exitCode = 1;
  } finally {
    const r = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    );
    console.log('tables in public:', r.rows.map((x) => x.table_name).join(', ') || '(none)');
    await client.end();
  }
}
main().catch((e) => { console.error('fatal', e); process.exit(2); });
