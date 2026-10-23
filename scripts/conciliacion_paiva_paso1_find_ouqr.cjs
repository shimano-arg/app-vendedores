// Conciliación Paiva Paso 1 — buscar OUQR en BQ (READ-ONLY).
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  // 1. Tablas que podrían ser OUQR.
  const q1 = `
    SELECT table_name
    FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.TABLES\`
    WHERE LOWER(table_name) LIKE '%ouqr%'
       OR LOWER(table_name) LIKE '%userquer%'
       OR LOWER(table_name) LIKE '%user_quer%'
    ORDER BY table_name
    LIMIT 20
  `;
  const [rows1] = await bq.query({ query: q1 });
  console.log('=== OUQR candidates ===');
  if (rows1.length === 0) console.log('(ninguna)');
  for (const r of rows1) console.log('  ' + r.table_name);

  // 2. Lista todas las tablas sap_* como hint.
  const q2 = `
    SELECT table_name
    FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.TABLES\`
    WHERE LOWER(table_name) LIKE 'sap_%'
    ORDER BY table_name
    LIMIT 50
  `;
  const [rows2] = await bq.query({ query: q2 });
  console.log('\n=== Tablas sap_* ===');
  for (const r of rows2) console.log('  ' + r.table_name);
}
main().catch((e) => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
