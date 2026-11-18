-- v_altas_marcadas_por_mes_vendedor (v1557, 2026-11-18)
--
-- Agrega por (vendor, mes) las altas marcadas por VDI/VDE desde el modal
-- "Target Altas" de la app vendedores. Fuente: vdi_target_altas_raw
-- (sincronizada desde Firestore vdi_target_altas cada corrida del workflow).
--
-- Alimenta la tabla "Target - Altas De Cuentas por VDI" del Power BI
-- (hoja "Desempeño Vendedores"). Formato A (solo conteo): cada fila
-- es un vendedor × mes con la cantidad de altas marcadas en ese mes.
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_altas_marcadas_por_mes_vendedor` AS
SELECT
  vendor,
  month,
  month_date,
  cantidad_altas,
  updated_at,
  updated_by
FROM `app-vendedores-shimano.shimano_app.vdi_target_altas_raw`
WHERE cantidad_altas > 0
ORDER BY month_date DESC, vendor ASC;
