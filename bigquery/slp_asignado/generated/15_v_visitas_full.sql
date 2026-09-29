CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_visitas_full` AS
-- v_visitas_full (2026-09-29): union 1:1 de v_visitas y v_visitas_enriquecida
-- por visita_id. Una fila por visita, todas las columnas incluyendo
-- card_code (del match) y slp_asignado (heredado de v_visitas via v.*).
-- Las vistas base NO se tocan.
SELECT
  v.*,
  e.card_code,
  e.card_name_sap,
  e.match_type,
  e.match_score,
  e.match_ambiguo
FROM `app-vendedores-shimano.shimano_app.v_visitas` v
LEFT JOIN `app-vendedores-shimano.shimano_app.v_visitas_enriquecida` e
  USING (visita_id)

