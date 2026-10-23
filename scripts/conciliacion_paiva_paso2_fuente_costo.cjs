// Paso 2 — confirmar origen de costo_prom_ars (cost_avg_ars).
// Verifica: sap_items_bike_raw tiene cost_avg_ars = ItemPrices[11, ARS]
// (segun flatten_bike_item). Mariano asumio "OITM.AvgPrice". Aclarar en informe.
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  // 1. sap_items_bike_raw schema + stats
  console.log('=== sap_items_bike_raw ===');
  const [schema] = await bq.query({
    query: `
      SELECT column_name, data_type
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'sap_items_bike_raw' AND column_name LIKE '%cost%'
      ORDER BY ordinal_position
    `,
  });
  for (const c of schema) console.log('  ' + c.column_name + ' ' + c.data_type);

  // 2. Stats cost_avg_ars
  const [stats] = await bq.query({
    query: `
      SELECT
        COUNT(*) AS total_items,
        COUNTIF(cost_avg_ars IS NOT NULL) AS con_cost_avg_ars,
        COUNTIF(cost_avg_ars IS NULL) AS sin_cost_avg_ars,
        ROUND(AVG(cost_avg_ars), 2) AS avg,
        ROUND(MIN(cost_avg_ars), 2) AS min,
        ROUND(MAX(cost_avg_ars), 2) AS max,
        MAX(_sync_timestamp) AS last_sync
      FROM \`app-vendedores-shimano.shimano_app.sap_items_bike_raw\`
    `,
  });
  console.log('\nstats:', JSON.stringify(stats[0], null, 2));

  // 3. Tabla seed Paiva septiembre 2026
  console.log('\n=== bike_test_paiva_sep2026 ===');
  const [paivaSchema] = await bq.query({
    query: `
      SELECT column_name, data_type
      FROM \`app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'bike_test_paiva_sep2026'
      ORDER BY ordinal_position
    `,
  });
  for (const c of paivaSchema) console.log('  ' + c.column_name + ' ' + c.data_type);

  const [paivaStats] = await bq.query({
    query: `
      SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT item_code) AS unique_items,
        COUNT(DISTINCT card_code) AS unique_clientes,
        COUNT(DISTINCT fecha_contab) AS unique_fechas,
        MIN(fecha_contab) AS min_fecha,
        MAX(fecha_contab) AS max_fecha,
        SUM(costo_total_paiva_ars) AS costo_total_sum,
        SUM(cantidad) AS cantidad_sum
      FROM \`app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026\`
    `,
  });
  console.log('\npaiva stats:', JSON.stringify(paivaStats[0], null, 2));

  // 4. ¿cost_avg_ars actual coincide con costo unitario Paiva?
  console.log('\n=== compare: cost_avg_ars (hoy) vs costo_paiva_unit (snapshot sep) ===');
  const [compare] = await bq.query({
    query: `
      WITH paiva_unit AS (
        SELECT
          item_code,
          -- Costo unitario promedio del snapshot Paiva (ponderado por cantidad total)
          SAFE_DIVIDE(SUM(costo_total_paiva_ars), SUM(cantidad)) AS costo_unit_paiva
        FROM \`app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026\`
        WHERE cantidad > 0
        GROUP BY item_code
      )
      SELECT
        pu.item_code,
        bi.cost_avg_ars AS cost_avg_hoy,
        pu.costo_unit_paiva AS costo_paiva_snapshot_sep,
        ROUND(bi.cost_avg_ars - pu.costo_unit_paiva, 2) AS diff_abs,
        ROUND(SAFE_DIVIDE(bi.cost_avg_ars - pu.costo_unit_paiva, pu.costo_unit_paiva) * 100, 2) AS diff_pct
      FROM paiva_unit pu
      JOIN \`app-vendedores-shimano.shimano_app.sap_items_bike_raw\` bi ON bi.item_code = pu.item_code
      WHERE bi.cost_avg_ars IS NOT NULL AND pu.costo_unit_paiva IS NOT NULL
      ORDER BY ABS(bi.cost_avg_ars - pu.costo_unit_paiva) DESC
      LIMIT 10
    `,
  });
  console.log('\nTop 10 items con mayor diff cost_avg_ars vs paiva_snapshot_sep:');
  for (const r of compare) {
    console.log('  ' + r.item_code + ' hoy=' + r.cost_avg_hoy + ' paiva=' + r.costo_paiva_snapshot_sep + ' diff=' + r.diff_abs + ' (' + r.diff_pct + '%)');
  }

  // 5. ¿Cuantos items coinciden (diff <5%)?
  const [coincidencia] = await bq.query({
    query: `
      WITH paiva_unit AS (
        SELECT item_code, SAFE_DIVIDE(SUM(costo_total_paiva_ars), SUM(cantidad)) AS costo_unit_paiva
        FROM \`app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026\`
        WHERE cantidad > 0
        GROUP BY item_code
      )
      SELECT
        COUNT(*) AS total,
        COUNTIF(ABS(SAFE_DIVIDE(bi.cost_avg_ars - pu.costo_unit_paiva, pu.costo_unit_paiva)) < 0.05) AS coinciden_5pct,
        COUNTIF(ABS(SAFE_DIVIDE(bi.cost_avg_ars - pu.costo_unit_paiva, pu.costo_unit_paiva)) < 0.01) AS coinciden_1pct,
        COUNTIF(bi.cost_avg_ars = pu.costo_unit_paiva) AS exacto
      FROM paiva_unit pu
      JOIN \`app-vendedores-shimano.shimano_app.sap_items_bike_raw\` bi ON bi.item_code = pu.item_code
      WHERE bi.cost_avg_ars IS NOT NULL AND pu.costo_unit_paiva IS NOT NULL
    `,
  });
  console.log('\ncoincidencia:', JSON.stringify(coincidencia[0], null, 2));
}
main().catch((e) => { console.error('ERROR:', (e && e.message) || e); process.exit(1); });
