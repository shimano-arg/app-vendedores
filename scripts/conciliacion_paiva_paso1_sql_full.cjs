// Ver SQL completo del view y schemas de sap_invoices_raw/sap_credit_notes_raw/sap_bp_raw.
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  // 1. SQL completo (más allá de 6000)
  const [views] = await bq.query({
    query: `
      SELECT view_definition
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.VIEWS\`
      WHERE table_name = 'v_rentabilidad_bike'
    `,
  });
  const sql = (views[0] && views[0].view_definition) || '';
  console.log('=== SQL full (len ' + sql.length + ') ===');
  console.log(sql);
}
main().catch((e) => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
