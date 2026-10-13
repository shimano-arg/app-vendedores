-- Vista BQ v1257 (2026-10-13): perfil comercial del master de clientes.
-- Fuente: Firestore client_master (via extension Stream to BigQuery).
-- Expone los 6 atributos de segmentacion comercial (v1256 + cliTipo preexistente)
-- + metadata base (cardCode, cliente, vendor, provincia, localidad).
--
-- Uso principal: PowerBI dashboard "Perfil clientes" para armar matrices tipo
-- "FIDELIDAD vs TAMAÑO" o "ESPECIALIZACION por VENDEDOR" + filtros slicer.
--
-- Dataset: app-vendedores-shimano.shimano_app
-- Deploy: python scripts/bq/deploy_client_master_perfil.py

CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_client_master_perfil` AS
SELECT
  document_id AS doc_id,
  JSON_VALUE(data, '$.sapCardCode') AS cardcode,
  JSON_VALUE(data, '$.clientName') AS cliente,
  JSON_VALUE(data, '$.assignedVendor') AS vendor,
  UPPER(TRIM(JSON_VALUE(data, '$.provincia'))) AS provincia,
  UPPER(TRIM(JSON_VALUE(data, '$.localidad'))) AS localidad,
  -- Categorizacion (v630+)
  JSON_VALUE(data, '$.cliTipo') AS cli_tipo,
  SAFE_CAST(JSON_VALUE(data, '$.creditoCheque') AS INT64) AS credito_cheque_ars,
  -- Perfil comercial (v1256)
  JSON_VALUE(data, '$.fidelidad') AS fidelidad,
  JSON_VALUE(data, '$.prefContacto') AS pref_contacto,
  JSON_VALUE(data, '$.tamano') AS tamano,
  JSON_VALUE(data, '$.especializacion') AS especializacion,
  JSON_VALUE(data, '$.tipoLocal') AS tipo_local,
  -- Metadata auditoria
  JSON_VALUE(data, '$.updatedBy') AS updated_by,
  SAFE.PARSE_TIMESTAMP('%FT%H:%M:%E*SZ', JSON_VALUE(data, '$.updatedAt._seconds'))
    AS updated_at,
  -- Flags utiles para filtros
  CASE
    WHEN JSON_VALUE(data, '$.sapCardCode') IS NOT NULL
     AND LENGTH(JSON_VALUE(data, '$.sapCardCode')) > 0 THEN TRUE
    ELSE FALSE
  END AS en_sap,
  CASE
    WHEN JSON_VALUE(data, '$.cliTipo') IS NOT NULL
     AND JSON_VALUE(data, '$.fidelidad') IS NOT NULL
     AND JSON_VALUE(data, '$.tamano') IS NOT NULL THEN TRUE
    ELSE FALSE
  END AS perfil_completo
FROM `app-vendedores-shimano.shimano_app.client_master_raw_raw_latest`
WHERE JSON_VALUE(data, '$.sapCardCode') IS NOT NULL
  AND JSON_VALUE(data, '$.sapCardCode') != ''
;
