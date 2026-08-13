-- ============================================================
-- RECONCILIACION: v_leads_detalle vs v_leads_vs_clientes_por_vendedor
-- (2026-08-13)
-- ============================================================
-- Objetivo: verificar que la vista nueva v_leads_detalle (1 fila por
-- socio, con geografia) da EXACTAMENTE los mismos conteos de
-- clientes_sap y leads por assigned_vendor que la vista de referencia
-- v_leads_vs_clientes_por_vendedor (agregada por vendor, sin geo).
--
-- Si alguno de los flags *_ok es FALSE, la logica de clasificacion en
-- v_leads_detalle divergio de v_leads_vs_clientes_por_vendedor y hay
-- que alinearlas antes de exponer al modelo Power BI.
--
-- Nota: no reconciliamos contra v_leads_snapshot_fin_mes porque esa
-- vista es serie MENSUAL reconstruida desde el changelog. v_leads_detalle
-- es FOTO ACTUAL (mismo snapshot que v_leads_vs_clientes_por_vendedor).
-- Para tener v_leads_detalle historica habria que volver a atacar el
-- changelog, fuera de alcance del pedido.
-- ============================================================
WITH detalle_agg AS (
  SELECT
    assigned_vendor,
    COUNTIF(tipo = 'CLIENTE_SAP') AS clientes_sap_detalle,
    COUNTIF(tipo = 'LEAD')         AS leads_detalle
  FROM `app-vendedores-shimano.shimano_app.v_leads_detalle`
  GROUP BY assigned_vendor
),
vendor_agg AS (
  SELECT
    assigned_vendor,
    clientes_sap AS clientes_sap_vendor,
    leads         AS leads_vendor
  FROM `app-vendedores-shimano.shimano_app.v_leads_vs_clientes_por_vendedor`
)
SELECT
  COALESCE(d.assigned_vendor, v.assigned_vendor) AS assigned_vendor,
  d.clientes_sap_detalle,
  v.clientes_sap_vendor,
  (COALESCE(d.clientes_sap_detalle, 0) = COALESCE(v.clientes_sap_vendor, 0))
                                                  AS clientes_sap_ok,
  d.leads_detalle,
  v.leads_vendor,
  (COALESCE(d.leads_detalle, 0) = COALESCE(v.leads_vendor, 0))
                                                  AS leads_ok
FROM detalle_agg d
FULL OUTER JOIN vendor_agg v USING (assigned_vendor)
ORDER BY assigned_vendor;

-- ============================================================
-- Query alternativo: totales globales (1 fila).
-- Util para un sanity check rapido despues del deploy.
-- ============================================================
-- SELECT
--   (SELECT COUNTIF(tipo='CLIENTE_SAP') FROM `app-vendedores-shimano.shimano_app.v_leads_detalle`) AS sap_detalle,
--   (SELECT SUM(clientes_sap)          FROM `app-vendedores-shimano.shimano_app.v_leads_vs_clientes_por_vendedor`) AS sap_vendor,
--   (SELECT COUNTIF(tipo='LEAD')       FROM `app-vendedores-shimano.shimano_app.v_leads_detalle`) AS leads_detalle,
--   (SELECT SUM(leads)                 FROM `app-vendedores-shimano.shimano_app.v_leads_vs_clientes_por_vendedor`) AS leads_vendor;
