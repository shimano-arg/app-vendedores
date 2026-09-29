CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_leads_vs_clientes_por_vendedor` AS
SELECT
  IFNULL(NULLIF(JSON_VALUE(data, '$.assignedVendor'), ''), '(SIN ASIGNAR)') AS assigned_vendor,
  COUNTIF(
    JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  ) AS clientes_sap,
  COUNTIF(
    JSON_VALUE(data, '$.manualSapPending') = 'true'
    AND (
      JSON_VALUE(data, '$.cardCodeSap') IS NULL
      OR JSON_VALUE(data, '$.cardCodeSap') = ''
    )
  ) AS leads,
  COUNT(*) AS total_universo,
  SAFE_DIVIDE(
    COUNTIF(
      JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
      AND JSON_VALUE(data, '$.cardCodeSap') != ''
    ),
    COUNT(*)
  ) AS pct_conversion,
  CURRENT_TIMESTAMP() AS snapshot_at,
  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de
  -- assigned_vendor. Congruente con la atribucion del modelo PBI.
  MAX(CASE UPPER(TRIM(IFNULL(NULLIF(JSON_VALUE(data, '$.assignedVendor'), ''), '(SIN ASIGNAR)')))
      WHEN 'GONZALO DE LA ROSA'    THEN 50
      WHEN 'MAURICIO GIL'          THEN 51
      WHEN 'IOANNIS PALKOUDAKIS'   THEN 52
      WHEN 'SANTIAGO ESTEBAN'      THEN 53
      WHEN 'PACHI'                 THEN 53
      WHEN 'FEDERICO CASTELANELLI' THEN 54
      WHEN 'MARTIN BOIERO'         THEN 55
      WHEN 'DIEGO VALSI'           THEN 56
      ELSE NULL
    END) AS slp_asignado
FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
WHERE JSON_VALUE(data, '$.status') = 'approved'
  AND (
    JSON_VALUE(data, '$.assignedVendor') IS NULL
    OR NOT STARTS_WITH(JSON_VALUE(data, '$.assignedVendor'), 'ADMIN_')
  )
GROUP BY assigned_vendor
ORDER BY total_universo DESC
