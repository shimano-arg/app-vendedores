// Conciliación Paiva Paso 1 — inspeccionar v_rentabilidad_bike + fuentes (READ-ONLY).
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  // 1. Schema v_rentabilidad_bike
  console.log('=== 1. Schema v_rentabilidad_bike ===');
  const [cols] = await bq.query({
    query: `
      SELECT column_name, data_type, ordinal_position
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'v_rentabilidad_bike'
      ORDER BY ordinal_position
    `,
  });
  if (cols.length === 0) {
    console.log('v_rentabilidad_bike NO existe');
  } else {
    console.log('N columnas:', cols.length);
    for (const c of cols) console.log(`  ${String(c.ordinal_position).padStart(2)}. ${c.column_name.padEnd(40)} ${c.data_type}`);
  }

  // 2. SQL del view (si está disponible)
  console.log('\n=== 2. SQL del view ===');
  const [views] = await bq.query({
    query: `
      SELECT view_definition
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.VIEWS\`
      WHERE table_name = 'v_rentabilidad_bike'
    `,
  });
  if (views.length === 0) {
    console.log('(no es view, o no se encontró definition)');
  } else {
    const sql = views[0].view_definition || '';
    console.log('view_definition (' + sql.length + ' chars):');
    console.log(sql.slice(0, 6000));
    if (sql.length > 6000) console.log('\n... (truncado, total ' + sql.length + ' chars)');
  }
}
main().catch((e) => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
