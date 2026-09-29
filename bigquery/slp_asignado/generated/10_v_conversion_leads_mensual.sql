CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_conversion_leads_mensual` AS
WITH events AS (
  SELECT
    document_id,
    timestamp,
    JSON_VALUE(data,     '$.cardCodeSap')       AS card_new,
    JSON_VALUE(old_data, '$.cardCodeSap')       AS card_old,
    JSON_VALUE(data,     '$.manualSapPending')  AS pending_new,
    JSON_VALUE(data,     '$.status')            AS status_new
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
conversiones AS (
  SELECT
    DATE_TRUNC(DATE(e.timestamp), MONTH) AS mes,
    v.assigned_vendor,
    COUNT(*) AS conversiones_mes
  FROM events e
  INNER JOIN vendor_actual v USING(document_id)
  WHERE (e.card_old IS NULL OR e.card_old = '')
    AND e.card_new IS NOT NULL AND e.card_new != ''
  GROUP BY mes, v.assigned_vendor
),
meses AS (SELECT DISTINCT mes FROM conversiones),
vendor_x_mes AS (
  SELECT DISTINCT v.assigned_vendor, m.mes
  FROM vendor_actual v CROSS JOIN meses m
),
snapshot_ante_mes AS (
  SELECT
    vxm.mes,
    v.assigned_vendor,
    e.document_id,
    ARRAY_AGG(STRUCT(e.card_new, e.pending_new, e.status_new)
              ORDER BY e.timestamp DESC LIMIT 1)[OFFSET(0)] AS ultimo
  FROM vendor_x_mes vxm
  INNER JOIN vendor_actual v ON v.assigned_vendor = vxm.assigned_vendor
  INNER JOIN events e ON e.document_id = v.document_id
                      AND e.timestamp < TIMESTAMP(vxm.mes)
  GROUP BY vxm.mes, v.assigned_vendor, e.document_id
),
stock_inicio AS (
  SELECT mes, assigned_vendor,
    COUNTIF(ultimo.status_new = 'approved'
            AND ultimo.pending_new = 'true'
            AND (ultimo.card_new IS NULL OR ultimo.card_new = '')
    ) AS stock_leads_inicio
  FROM snapshot_ante_mes
  GROUP BY mes, assigned_vendor
)
SELECT
  vxm.mes,
  vxm.assigned_vendor,
  IFNULL(si.stock_leads_inicio, 0) AS stock_leads_inicio_mes,
  IFNULL(cv.conversiones_mes, 0)   AS conversiones_mes,
  SAFE_DIVIDE(cv.conversiones_mes, si.stock_leads_inicio) AS pct_conversion_mes,
  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de
  -- assigned_vendor. Congruente con la atribucion del modelo PBI.
  CASE UPPER(TRIM(vxm.assigned_vendor))
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
FROM vendor_x_mes vxm
LEFT JOIN stock_inicio si USING(mes, assigned_vendor)
LEFT JOIN conversiones cv USING(mes, assigned_vendor)
WHERE (cv.conversiones_mes > 0 OR si.stock_leads_inicio > 0)
ORDER BY vxm.mes DESC, cv.conversiones_mes DESC
