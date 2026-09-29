CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_visitas_enriquecida` AS
SELECT
  v.*,
  m.card_code,
  m.card_name AS card_name_sap,
  m.match_type,
  m.score AS match_score,
  m.ambiguo AS match_ambiguo
FROM `app-vendedores-shimano.shimano_app.v_visitas` v
LEFT JOIN `app-vendedores-shimano.shimano_app.v_visitas_clientes_match` m
  ON m.visita_id = v.visita_id
