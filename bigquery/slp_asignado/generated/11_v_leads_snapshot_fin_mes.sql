CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_leads_snapshot_fin_mes` AS
WITH events AS (
  SELECT
    document_id,
    timestamp,
    JSON_VALUE(data, '$.cardCodeSap')      AS card_new,
    JSON_VALUE(data, '$.manualSapPending') AS pending_new,
    JSON_VALUE(data, '$.status')           AS status_new
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_changelog`
),
vendor_actual AS (
  SELECT
    document_id,
    IFNULL(NULLIF(JSON_VALUE(data, '$.assignedVendor'), ''), '(SIN ASIGNAR)') AS assigned_vendor
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.status') = 'approved'
    AND (JSON_VALUE(data, '$.assignedVendor') IS NULL
         OR NOT STARTS_WITH(JSON_VALUE(data, '$.assignedVendor'), 'ADMIN_'))
),
rango_meses AS (
  SELECT MIN(DATE_TRUNC(DATE(timestamp), MONTH)) AS min_mes,
         DATE_TRUNC(CURRENT_DATE(), MONTH) AS max_mes
  FROM events
),
meses AS (
  SELECT mes
  FROM rango_meses, UNNEST(GENERATE_DATE_ARRAY(min_mes, max_mes, INTERVAL 1 MONTH)) AS mes
),
vendor_x_mes AS (
  SELECT v.document_id, v.assigned_vendor, m.mes
  FROM vendor_actual v CROSS JOIN meses m
),
snapshot_fin_mes AS (
  SELECT
    vxm.mes,
    vxm.assigned_vendor,
    vxm.document_id,
    ARRAY_AGG(STRUCT(e.card_new, e.pending_new, e.status_new)
              ORDER BY e.timestamp DESC LIMIT 1)[OFFSET(0)] AS ultimo
  FROM vendor_x_mes vxm
  INNER JOIN events e ON e.document_id = vxm.document_id
                     AND e.timestamp < TIMESTAMP(DATE_ADD(vxm.mes, INTERVAL 1 MONTH))
  GROUP BY vxm.mes, vxm.assigned_vendor, vxm.document_id
),
agregado AS (
  SELECT
    mes,
    assigned_vendor,
    COUNTIF(ultimo.status_new = 'approved'
            AND ultimo.pending_new = 'true'
            AND (ultimo.card_new IS NULL OR ultimo.card_new = '')
    ) AS leads,
    COUNTIF(ultimo.status_new = 'approved'
            AND ultimo.card_new IS NOT NULL
            AND ultimo.card_new != ''
    ) AS clientes_sap
  FROM snapshot_fin_mes
  GROUP BY mes, assigned_vendor
)
SELECT
  LAST_DAY(mes, MONTH) AS mes,
  assigned_vendor,
  leads,
  clientes_sap,
  leads + clientes_sap AS total,
  SAFE_DIVIDE(clientes_sap, leads + clientes_sap) AS pct_conversion,
  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de
  -- assigned_vendor. Congruente con la atribucion del modelo PBI.
  CASE UPPER(TRIM(assigned_vendor))
      WHEN 'GONZALO DE LA ROSA'    THEN 50
      WHEN 'MAURICIO GIL'          THEN 51
      WHEN 'IOANNIS PALKOUDAKIS'   THEN 52
      WHEN 'SANTIAGO ESTEBAN'      THEN 53
      WHEN 'PACHI'                 THEN 53
      WHEN 'FEDERICO CASTELANELLI' THEN 54
      WHEN 'MARTIN BOIERO'         THEN 55
      WHEN 'DIEGO VALSI'           THEN 56
      ELSE NULL
    END AS slp_asignado
FROM agregado
WHERE (leads + clientes_sap) > 0
ORDER BY mes DESC, total DESC
