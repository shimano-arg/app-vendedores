// Paso 1 — chequear fuentes para columnas nuevas (A division_cliente, C nro_fiscal).
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function listCols(table) {
  const [rows] = await bq.query({
    query: `
      SELECT column_name, data_type
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = '${table}'
      ORDER BY ordinal_position
    `,
  });
  return rows;
}

async function main() {
  // ====== A. División cliente ======
  console.log('=== sap_bp_raw schema (U_DIVISION?) ===');
  const bp = await listCols('sap_bp_raw');
  const bpDivCols = bp.filter((c) => /divis|u_div/i.test(c.column_name));
  console.log('Total cols: ' + bp.length);
  console.log('Cols con divis/u_div:');
  for (const c of bpDivCols) console.log('  ' + c.column_name + ' (' + c.data_type + ')');
  console.log('Todas:');
  for (const c of bp) console.log('  ' + c.column_name + ' (' + c.data_type + ')');

  // ====== C. FolNumTo ======
  console.log('\n=== sap_invoices_raw schema (FolNumTo?) ===');
  const inv = await listCols('sap_invoices_raw');
  const invFol = inv.filter((c) => /fol|num_to|docnum/i.test(c.column_name));
  console.log('Total cols: ' + inv.length);
  for (const c of invFol) console.log('  ' + c.column_name + ' (' + c.data_type + ')');

  console.log('\n=== sap_credit_notes_raw schema (FolNumTo?) ===');
  const cn = await listCols('sap_credit_notes_raw');
  const cnFol = cn.filter((c) => /fol|num_to|docnum/i.test(c.column_name));
  console.log('Total cols: ' + cn.length);
  for (const c of cnFol) console.log('  ' + c.column_name + ' (' + c.data_type + ')');
}

main().catch((e) => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
