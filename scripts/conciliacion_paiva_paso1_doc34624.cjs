// Paso 1 — ejemplo DocEntry 34624 en v_rentabilidad_bike.
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  // 1. Si 34624 es Factura (sap_invoices_raw) o NC (sap_credit_notes_raw)
  console.log('=== Buscar 34624 ===');
  const [inv] = await bq.query({
    query: `
      SELECT 'INVOICE' AS fuente, doc_entry, doc_num, doc_date, card_code, card_name, cancelled,
             doc_currency, total_discount, lines_count
      FROM \`app-vendedores-shimano.shimano_app.sap_invoices_raw\`
      WHERE doc_entry = 34624
      UNION ALL
      SELECT 'CREDIT_NOTE' AS fuente, doc_entry, doc_num, doc_date, card_code, card_name, cancelled,
             doc_currency, total_discount, lines_count
      FROM \`app-vendedores-shimano.shimano_app.sap_credit_notes_raw\`
      WHERE doc_entry = 34624
    `,
  });
  console.log('Encontrado en:', inv.length === 0 ? '(ninguno)' : inv[0].fuente);
  for (const r of inv) {
    console.log('  doc_entry=' + r.doc_entry + ' doc_num=' + r.doc_num + ' doc_date=' + (r.doc_date && r.doc_date.value) + ' card_code=' + r.card_code);
    console.log('  card_name=' + r.card_name + ' doc_currency=' + r.doc_currency + ' total_discount=' + r.total_discount);
  }

  // 2. Datos del cliente en sap_bp_raw
  if (inv.length > 0) {
    const cardCode = inv[0].card_code;
    console.log('\n=== Cliente ' + cardCode + ' en sap_bp_raw ===');
    const [bp] = await bq.query({
      query: `
        SELECT card_code, card_name, group_code, country, state, _sync_timestamp
        FROM \`app-vendedores-shimano.shimano_app.sap_bp_raw\`
        WHERE card_code = @cc
      `,
      params: { cc: cardCode },
    });
    for (const b of bp) {
      console.log(JSON.stringify(b, null, 2).slice(0, 500));
    }
  }

  // 3. v_rentabilidad_bike filas para 34624
  console.log('\n=== v_rentabilidad_bike doc_entry=34624 ===');
  const [vr] = await bq.query({
    query: `
      SELECT doc_entry, doc_num, line_num, item_code, card_code, doc_date, fecha_contable, doc_kind,
             division, cantidad, venta_neta_ars, dcto_cabecera_prorrateado_ars, costo_doc_ars,
             costo_prom_ars, costo_paiva_ars_sep2026
      FROM \`app-vendedores-shimano.shimano_app.v_rentabilidad_bike\`
      WHERE doc_entry = 34624
      ORDER BY line_num
    `,
  });
  console.log('Filas: ' + vr.length);
  for (const r of vr) {
    console.log('  line_num=' + r.line_num + ' item=' + r.item_code + ' kind=' + r.doc_kind + ' qty=' + r.cantidad + ' venta_neta=' + r.venta_neta_ars);
    console.log('    doc_date=' + (r.doc_date && r.doc_date.value) + ' fecha_contable=' + (r.fecha_contable && r.fecha_contable.value));
    console.log('    costo_doc=' + r.costo_doc_ars + ' costo_prom=' + r.costo_prom_ars + ' costo_paiva=' + r.costo_paiva_ars_sep2026);
  }
}

main().catch((e) => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
