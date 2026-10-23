// Capturar SQL completo actual de v_rentabilidad_bike + descripcion.
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const fs = require('node:fs');
const path = require('node:path');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  const [rows] = await bq.query({
    query: `
      SELECT view_definition
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.VIEWS\`
      WHERE table_name = 'v_rentabilidad_bike'
    `,
  });
  if (rows.length === 0) {
    console.error('v_rentabilidad_bike NO encontrada');
    process.exit(1);
  }
  const sql = rows[0].view_definition;
  const outDir = path.join(__dirname, '..', 'bigquery', 'views');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'v_rentabilidad_bike_actual.sql');
  fs.writeFileSync(outPath, sql, 'utf-8');
  console.log('OK  len=' + sql.length + '  path=' + outPath);
  console.log('---');
  console.log(sql.slice(0, 600) + '\n...\n' + sql.slice(-400));
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
