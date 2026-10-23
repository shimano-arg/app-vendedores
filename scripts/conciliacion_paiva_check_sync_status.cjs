// Chequear si u_division + fol_num_* ya existen en BQ post-sync (cancelado).
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  for (const [table, cols] of [
    ['sap_bp_raw', ['u_division']],
    ['sap_invoices_raw', ['fol_num_from', 'fol_num_to', 'folio_pref']],
    ['sap_credit_notes_raw', ['fol_num_from', 'fol_num_to', 'folio_pref']],
  ]) {
    const [rows] = await bq.query({
      query: `
        SELECT column_name
        FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS\`
        WHERE table_name = '${table}'
          AND column_name IN (${cols.map((c) => "'" + c + "'").join(',')})
      `,
    });
    const found = rows.map((r) => r.column_name);
    console.log(table + ': ' + (found.length === cols.length ? 'OK' : 'MISSING'));
    console.log('  esperado: ' + cols.join(', '));
    console.log('  encontrado: ' + (found.length ? found.join(', ') : '(ninguno)'));

    // Si existen, ver poblamiento (last sync)
    if (found.length === cols.length) {
      const [stats] = await bq.query({
        query: `
          SELECT
            MAX(_sync_timestamp) AS last_sync,
            COUNT(*) AS total,
            ${cols.map((c) => `COUNTIF(${c} IS NOT NULL) AS con_${c}`).join(', ')}
          FROM \`app-vendedores-shimano.shimano_app.${table}\`
        `,
      });
      console.log('  stats:', JSON.stringify(stats[0], null, 2));
    }
    console.log();
  }
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
