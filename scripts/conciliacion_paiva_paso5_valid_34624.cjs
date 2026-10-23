// Validacion final — DocEntry 34624 (BERACOCHEA, factura 2026-10-08) +
// ejemplo septiembre (debe tener costo_finanzas_ars poblado).
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  // 1. DocEntry 34624 — 4 columnas nuevas
  console.log('=== DocEntry 34624 (BERACOCHEA FERNANDO HUGO, factura 2026-10-08) ===');
  const [rows] = await bq.query({
    query: `
      SELECT
        doc_entry, doc_num, line_num, item_code, card_code, card_name,
        doc_date, fecha_contable,
        division_cliente,
        nro_fiscal,
        nro_fiscal_completo,
        costo_finanzas_ars,
        costo_prom_ars,
        costo_doc_ars,
        cantidad
      FROM \`app-vendedores-shimano.shimano_app.v_rentabilidad_bike\`
      WHERE doc_entry = 34624
      ORDER BY line_num
      LIMIT 3
    `,
  });
  console.log('Filas: ' + rows.length);
  for (const r of rows) {
    console.log('  --- line_num=' + r.line_num + ' ---');
    console.log('    item=' + r.item_code + ' qty=' + r.cantidad);
    console.log('    doc_date=' + (r.doc_date && r.doc_date.value) + ' fecha_contable=' + (r.fecha_contable && r.fecha_contable.value));
    console.log('    card_code=' + r.card_code + ' name=' + r.card_name);
    console.log('    division_cliente=' + r.division_cliente);
    console.log('    nro_fiscal=' + r.nro_fiscal + ' nro_fiscal_completo=' + r.nro_fiscal_completo);
    console.log('    costo_finanzas_ars=' + r.costo_finanzas_ars);
    console.log('    (ref) costo_prom_ars=' + r.costo_prom_ars + ' costo_doc_ars=' + r.costo_doc_ars);
  }

  // 2. Totales septiembre 2026 — comparacion
  console.log('\n=== Totales septiembre 2026 — venta/costos ===');
  const [tot] = await bq.query({
    query: `
      SELECT
        COUNT(DISTINCT doc_entry) AS docs,
        COUNT(*) AS lineas,
        ROUND(SUM(venta_neta_ars), 2) AS venta_neta_sum,
        ROUND(SUM(costo_doc_ars), 2) AS costo_doc_sum,
        ROUND(SUM(costo_prom_ars), 2) AS costo_prom_sum,
        ROUND(SUM(costo_finanzas_ars), 2) AS costo_finanzas_sum,
        ROUND(SUM(costo_paiva_ars_sep2026), 2) AS costo_paiva_legacy_sum,
        COUNTIF(costo_finanzas_ars IS NOT NULL) AS lineas_con_finanzas,
        COUNTIF(costo_paiva_ars_sep2026 IS NOT NULL) AS lineas_con_paiva_legacy
      FROM \`app-vendedores-shimano.shimano_app.v_rentabilidad_bike\`
      WHERE doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
    `,
  });
  console.log(JSON.stringify(tot[0], null, 2));

  // 3. Distinct u_division en sap_bp_raw (post-sync D1)
  console.log('\n=== Distinct u_division (sap_bp_raw) ===');
  const [divs] = await bq.query({
    query: `
      SELECT
        COALESCE(NULLIF(u_division, ''), '(vacio)') AS valor,
        COUNT(*) AS clientes
      FROM \`app-vendedores-shimano.shimano_app.sap_bp_raw\`
      GROUP BY valor
      ORDER BY clientes DESC
    `,
  });
  for (const d of divs) console.log('  ' + d.valor + ' -> ' + d.clientes + ' clientes');

  // 4. Verificacion fol_num_to post-sync D2
  console.log('\n=== fol_num_* poblamiento (sap_invoices_raw) ===');
  const [fol] = await bq.query({
    query: `
      SELECT
        COUNT(*) AS total,
        COUNTIF(fol_num_to IS NOT NULL) AS con_fol_num_to,
        COUNTIF(folio_pref IS NOT NULL) AS con_folio_pref,
        COUNTIF(fol_num_to IS NOT NULL AND folio_pref IS NOT NULL) AS con_ambos
      FROM \`app-vendedores-shimano.shimano_app.sap_invoices_raw\`
      WHERE cancelled = 'tNO'
    `,
  });
  console.log(JSON.stringify(fol[0], null, 2));
}
main().catch((e) => { console.error('ERROR:', (e && e.message) || e); process.exit(1); });
