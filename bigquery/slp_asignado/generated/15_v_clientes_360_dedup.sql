CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_clientes_360_dedup` AS
-- v_clientes_360_dedup (2026-09-29): dedup de card_code_sap en clientes_360_view.
-- Prioridad: updated_at DESC (NULLS LAST) -> created_at DESC (NULLS LAST) ->
-- application_id DESC (tiebreaker deterministico).
-- 3 duplicados conocidos son el MISMO cliente en cada caso (mismo comercio+division).
-- clientes_360_view NO se modifica.
WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY card_code_sap
      ORDER BY
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        application_id DESC
    ) AS _rn
  FROM `app-vendedores-shimano.shimano_app.clientes_360_view`
)
SELECT * EXCEPT (_rn) FROM ranked WHERE _rn = 1

