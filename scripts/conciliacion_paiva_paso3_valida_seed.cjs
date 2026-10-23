// Verificar que el costo_unitario_paiva_ars en bike_test_paiva_sep2026 es
// CONSTANTE por item_code (hipotesis: Juan tomo snapshot 1x el 5-oct y lo
// aplico a toda sep). Si NO es constante, revisar seed con MIN/MAX/MEDIAN.
const { BigQuery } = require('../functions/node_modules/@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'app-vendedores-shimano' });

async function main() {
  const [rows] = await bq.query({
    query: `
      SELECT
        item_code,
        COUNT(*) AS lineas,
        COUNT(DISTINCT costo_unitario_paiva_ars) AS distintos,
        ROUND(MIN(costo_unitario_paiva_ars), 2) AS min,
        ROUND(MAX(costo_unitario_paiva_ars), 2) AS max,
        ROUND(MAX(costo_unitario_paiva_ars) - MIN(costo_unitario_paiva_ars), 2) AS diff
      FROM \`app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026\`
      WHERE cantidad > 0
      GROUP BY item_code
      HAVING COUNT(DISTINCT costo_unitario_paiva_ars) > 1
      ORDER BY diff DESC
      LIMIT 20
    `,
  });
  console.log('Items con >1 costo unitario distinto en septiembre 2026:');
  console.log('Total:', rows.length);
  for (const r of rows) {
    console.log('  ' + r.item_code + ' lineas=' + r.lineas + ' distintos=' + r.distintos + ' min=' + r.min + ' max=' + r.max + ' diff=' + r.diff);
  }

  // Verificar coincidencia costo_snapshot_semanal vs costo_total_paiva_ars/cantidad
  console.log('\n=== costo_snapshot_semanal post-seed vs seed source ===');
  const [checks] = await bq.query({
    query: `
      WITH csn AS (
        SELECT item_code, cost_avg_ars AS csn_cost
        FROM \`app-vendedores-shimano.shimano_app.costo_snapshot_semanal\`
        WHERE snapshot_week_start = DATE('2026-10-05')
      ),
      paiva AS (
        SELECT item_code,
          -- Si el costo es constante por item, min=max=medio, y weighted-avg=mismo valor.
          ANY_VALUE(costo_unitario_paiva_ars) AS paiva_cost_sample,
          SAFE_DIVIDE(SUM(costo_total_paiva_ars), SUM(cantidad)) AS paiva_weighted
        FROM \`app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026\`
        WHERE cantidad > 0
        GROUP BY item_code
      )
      SELECT
        COUNT(*) AS items,
        COUNTIF(ABS(csn.csn_cost - paiva.paiva_weighted) < 0.01) AS exacto,
        COUNTIF(ABS(csn.csn_cost - paiva.paiva_sample_cost) < 0.01) AS exacto_sample,
        COUNTIF(ABS(csn.csn_cost - paiva.paiva_weighted) >= 0.01) AS difiere
      FROM csn
      JOIN paiva USING (item_code)
    `,
  }).catch(async () => {
    // El alias paiva_sample_cost no funciono porque arriba lo nombre paiva_cost_sample.
    return bq.query({
      query: `
        WITH csn AS (
          SELECT item_code, cost_avg_ars AS csn_cost
          FROM \`app-vendedores-shimano.shimano_app.costo_snapshot_semanal\`
          WHERE snapshot_week_start = DATE('2026-10-05')
        ),
        paiva AS (
          SELECT item_code,
            ANY_VALUE(costo_unitario_paiva_ars) AS paiva_sample,
            SAFE_DIVIDE(SUM(costo_total_paiva_ars), SUM(cantidad)) AS paiva_weighted
          FROM \`app-vendedores-shimano.shimano_app.bike_test_paiva_sep2026\`
          WHERE cantidad > 0
          GROUP BY item_code
        )
        SELECT
          COUNT(*) AS items,
          COUNTIF(ABS(csn.csn_cost - paiva.paiva_weighted) < 0.01) AS seed_match_weighted,
          COUNTIF(ABS(csn.csn_cost - paiva.paiva_sample) < 0.01) AS seed_match_sample,
          COUNTIF(ABS(csn.csn_cost - paiva.paiva_weighted) >= 0.01) AS seed_difiere_weighted
        FROM csn
        JOIN paiva USING (item_code)
      `,
    });
  });
  const result = checks[0];
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error('ERROR:', (e && e.message) || e); process.exit(1); });
