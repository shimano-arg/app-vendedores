// Paso 1 — todos los schemas completos y DocEntry 34624 example.
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function dump(table, label) {
  const [rows] = await bq.query({
    query: `
      SELECT column_name, data_type
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = '${table}'
      ORDER BY ordinal_position
    `,
  });
  console.log('\n=== ' + label + ' (' + rows.length + ' cols) ===');
  for (const c of rows) console.log('  ' + c.column_name + ' (' + c.data_type + ')');
}

async function main() {
  await dump('sap_invoices_raw', 'sap_invoices_raw');
  await dump('sap_credit_notes_raw', 'sap_credit_notes_raw');

  // Ver si lines_json contiene FolNumTo o U_Division (header).
  console.log('\n=== Primera fila sap_invoices_raw — campos top-level + sample lines_json key ===');
  const [sampleRows] = await bq.query({
    query: `
      SELECT doc_entry, doc_num,
        -- intento ver si hay fol_num_to, u_division o similares con JSON scan
        TO_JSON_STRING((SELECT AS STRUCT * EXCEPT (lines_json) FROM UNNEST([t]))) AS header_json,
        SUBSTR(lines_json, 1, 500) AS first_line_json_sample
      FROM \`app-vendedores-shimano.shimano_app.sap_invoices_raw\` t
      WHERE doc_entry IS NOT NULL
      LIMIT 1
    `,
  });
  if (sampleRows.length > 0) {
    const r = sampleRows[0];
    console.log('doc_entry:', r.doc_entry, 'doc_num:', r.doc_num);
    console.log('header_json (parcial):', String(r.header_json).slice(0, 1200));
    console.log('first_line_json_sample:', r.first_line_json_sample);
  }
}
main().catch((e) => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
