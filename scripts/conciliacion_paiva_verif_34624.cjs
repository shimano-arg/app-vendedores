// Verificar card_code real de DocEntry 34624.
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  console.log('=== Query 1: sap_invoices_raw directo ===');
  const [raw] = await bq.query({
    query: `
      SELECT doc_entry, doc_num, doc_date, card_code, card_name
      FROM \`app-vendedores-shimano.shimano_app.sap_invoices_raw\`
      WHERE doc_entry = 34624
    `,
  });
  for (const r of raw) {
    console.log('doc_entry=' + r.doc_entry + ' doc_num=' + r.doc_num);
    console.log('card_code=' + r.card_code + ' card_name=' + r.card_name);
  }

  console.log('\n=== Query 2: v_rentabilidad_bike directo ===');
  const [vr] = await bq.query({
    query: `
      SELECT DISTINCT doc_entry, doc_num, card_code, doc_date, doc_kind
      FROM \`app-vendedores-shimano.shimano_app.v_rentabilidad_bike\`
      WHERE doc_entry = 34624
    `,
  });
  for (const r of vr) {
    console.log('doc_entry=' + r.doc_entry + ' doc_num=' + r.doc_num + ' kind=' + r.doc_kind);
    console.log('card_code=' + r.card_code + ' doc_date=' + (r.doc_date && r.doc_date.value));
  }

  console.log('\n=== Query 3: sap_credit_notes_raw directo (por si existe también) ===');
  const [cn] = await bq.query({
    query: `
      SELECT doc_entry, doc_num, doc_date, card_code, card_name
      FROM \`app-vendedores-shimano.shimano_app.sap_credit_notes_raw\`
      WHERE doc_entry = 34624
    `,
  });
  console.log('Rows:', cn.length);
  for (const r of cn) {
    console.log('  doc_entry=' + r.doc_entry + ' card_code=' + r.card_code + ' card_name=' + r.card_name);
  }

  console.log('\n=== Query 4: BERACOCHEA FERNANDO HUGO en sap_bp_raw ===');
  const [bp] = await bq.query({
    query: `
      SELECT card_code, card_name
      FROM \`app-vendedores-shimano.shimano_app.sap_bp_raw\`
      WHERE card_code IN ('C27272960050', 'C20169905658')
         OR UPPER(card_name) LIKE '%BERACOCHEA%'
    `,
  });
  for (const r of bp) {
    console.log('  ' + r.card_code + ' → ' + r.card_name);
  }
}

main().catch((e) => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
