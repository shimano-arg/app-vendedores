-- =============================================================================
-- geo_overrides.sql — overrides manuales de geolocalizacion por card_code
-- =============================================================================
-- v796 (2026-09-04, Mariano): tabla de correcciones manuales sobre provincia,
-- departamento y localidad para clientes/leads que caen en blanco en el mapa
-- del tablero SAR pesca. La vista v_leads_detalle hace LEFT JOIN por
-- card_code y COALESCE(override, base) para que el override tenga prioridad
-- sobre el dato original de client_applications_raw_raw_latest.
--
-- CRITERIO: NO tocar SAP ni los forms de la app. La correccion vive solo en
-- BigQuery. Cuando la app corrija el dato en Firestore/SAP, el override deja
-- de ser necesario (pero no molesta — el COALESCE sigue prefiriendo el
-- override si existe).
--
-- COMO AGREGAR MAS OVERRIDES:
--   1. Editar la lista de STRUCT abajo agregando la nueva fila
--      (card_code, provincia, departamento, localidad).
--   2. Re-deployar: Get-Content bigquery/geo_overrides.sql -Raw | bq query ...
--      (workaround PS 5.1 en README §46.6).
--   3. Re-deployar v_leads_detalle NO es necesario — el JOIN es dinamico.
--
-- IMPORTANTE:
--   - provincia: nombre COMPLETO en mayusculas sin acentos (ej. 'CORDOBA',
--     'ENTRE RIOS', 'CIUDAD AUTONOMA DE BUENOS AIRES', 'BUENOS AIRES').
--     Debe matchear el formato de las provincias en geo_localidad_departamento
--     para que prov_depto quede consistente con el resto del catalogo.
--   - departamento: nombre COMPLETO del depto/partido/comuna en mayusculas
--     sin acentos. Va a ir al lado derecho del separador ' | ' en prov_depto.
--   - localidad: ciudad/pueblo especifico. Puede coincidir con departamento
--     (ej. ESQUINA/ESQUINA en Corrientes cuando el pueblo lleva el mismo
--     nombre del depto cabecera).
--
-- El JOIN es LEFT (override opcional) — la vista sigue funcionando sin esta
-- tabla si aun no se deployo (aunque el sync SAP puede fallar si el archivo
-- no existe al momento de aplicar la vista). Buena practica: deployar esta
-- tabla ANTES que la vista.
-- =============================================================================

CREATE OR REPLACE TABLE `app-vendedores-shimano.shimano_app.geo_overrides_clientes`
(
  card_code    STRING NOT NULL,
  provincia    STRING NOT NULL,
  departamento STRING NOT NULL,
  localidad    STRING NOT NULL
)
OPTIONS(
  description = "v796 (2026-09-04): overrides manuales de geolocalizacion por card_code. LEFT JOIN en v_leads_detalle con COALESCE — override pisa provincia/departamento/localidad cuando existe. Para agregar mas: editar bigquery/geo_overrides.sql y re-deployar."
)
AS
SELECT * FROM UNNEST([
  -- =====================================================================
  -- Batch inicial 20 correcciones (Mariano 2026-09-04)
  -- Clientes SAR pesca que caian en blanco en el mapa por depto vacio
  -- o provincia mal cargada. Todos verificados manualmente contra la
  -- localidad real del cliente.
  -- =====================================================================
  STRUCT('LEAD_YZNefzpaylRqCsfp5AZt' AS card_code, 'CORRIENTES'   AS provincia, 'ESQUINA'              AS departamento, 'ESQUINA'                       AS localidad),
  STRUCT('LEAD_tNRVEmQIZaL4NIVhNe3B',                'CORRIENTES',                'ESQUINA',                              'ESQUINA'),
  STRUCT('LEAD_lL8CCkx3c3um3yM7NY1y',                'CORRIENTES',                'GOYA',                                 'GOYA'),
  STRUCT('LEAD_Uyej1B4bEGNJHogImFCb',                'CORRIENTES',                'GOYA',                                 'GOYA'),
  STRUCT('LEAD_Ssu5n4NEnnCVhpcgkIzn',                'CORRIENTES',                'ESQUINA',                              'ESQUINA'),
  STRUCT('LEAD_rcsiSnfbLFJBPTFBxLE0',                'BUENOS AIRES',              'ADOLFO ALSINA',                        'CARHUE'),
  STRUCT('LEAD_y8AfZ9lVSaApcAniXlIQ',                'BUENOS AIRES',              'SAN ANDRES DE GILES',                  'SAN ANDRES DE GILES'),
  STRUCT('LEAD_apECsYQE7o9YjelE9fvc',                'SANTA CRUZ',                'LAGO ARGENTINO',                       'EL CALAFATE'),
  STRUCT('C20440977805',                             'BUENOS AIRES',              'PILAR',                                'LA LONJA'),
  STRUCT('C20406799787',                             'CORDOBA',                   'MARCOS JUAREZ',                        'CRUZ ALTA'),
  STRUCT('C20068166196',                             'SANTA CRUZ',                'DESEADO',                              'PUERTO DESEADO'),
  STRUCT('C20243230064',                             'CORRIENTES',                'SAN LUIS DEL PALMAR',                  'SAN LUIS DEL PALMAR'),
  STRUCT('C23299432459',                             'CORDOBA',                   'CAPITAL',                              'CORDOBA'),
  STRUCT('LEAD_GZmt0qQwYv0DVJlu8woU',                'ENTRE RIOS',                'COLON',                                'COLON'),
  STRUCT('C20269003996',                             'ENTRE RIOS',                'URUGUAY',                              'CONCEPCION DEL URUGUAY'),
  STRUCT('LEAD_w8RWFHFyamTvdW6LNnVH',                'CORRIENTES',                'ITUZAINGO',                            'ITUZAINGO'),
  STRUCT('LEAD_xntNL0fvL0bJWMWvzYZ1',                'MISIONES',                  'CAPITAL',                              'POSADAS'),
  STRUCT('LEAD_2FagUcIgy5E6e3EFDd60',                'MISIONES',                  'SAN JAVIER',                           'SAN JAVIER'),
  STRUCT('LEAD_W859KrqXIXYhtzq4vUrZ',                'MISIONES',                  'IGUAZU',                               'PUERTO IGUAZU'),
  STRUCT('LEAD_QBZGhtbYphW8GfiDAAaQ',                'SANTA FE',                  'ROSARIO',                              'VILLA GOBERNADOR GALVEZ')
]);


-- =============================================================================
-- Validacion post-deploy (Mariano 2026-09-04)
-- =============================================================================

-- V1: confirmar que las 20 filas cargaron OK
-- SELECT COUNT(*) AS n_overrides,
--        COUNT(DISTINCT card_code) AS n_card_codes_distintos
-- FROM `app-vendedores-shimano.shimano_app.geo_overrides_clientes`;
-- Esperado: 20 / 20.

-- V2: confirmar que ningun override queda huerfano (todos matchean con un
-- lead/cliente en client_applications_raw_raw_latest)
-- SELECT o.card_code AS override_sin_cliente
-- FROM `app-vendedores-shimano.shimano_app.geo_overrides_clientes` o
-- LEFT JOIN `app-vendedores-shimano.shimano_app.v_leads_detalle` v
--   ON v.card_code = o.card_code
-- WHERE v.card_code IS NULL;
-- Esperado: 0 filas.

-- V3: confirmar que despues del override los 20 tienen prov_depto NO null
-- SELECT card_code, provincia, departamento, prov_depto
-- FROM `app-vendedores-shimano.shimano_app.v_leads_detalle`
-- WHERE card_code IN (
--   'LEAD_YZNefzpaylRqCsfp5AZt','LEAD_tNRVEmQIZaL4NIVhNe3B',
--   'LEAD_lL8CCkx3c3um3yM7NY1y','LEAD_Uyej1B4bEGNJHogImFCb',
--   'LEAD_Ssu5n4NEnnCVhpcgkIzn','LEAD_rcsiSnfbLFJBPTFBxLE0',
--   'LEAD_y8AfZ9lVSaApcAniXlIQ','LEAD_apECsYQE7o9YjelE9fvc',
--   'C20440977805','C20406799787','C20068166196','C20243230064',
--   'C23299432459','LEAD_GZmt0qQwYv0DVJlu8woU','C20269003996',
--   'LEAD_w8RWFHFyamTvdW6LNnVH','LEAD_xntNL0fvL0bJWMWvzYZ1',
--   'LEAD_2FagUcIgy5E6e3EFDd60','LEAD_W859KrqXIXYhtzq4vUrZ',
--   'LEAD_QBZGhtbYphW8GfiDAAaQ'
-- )
-- ORDER BY card_code;
-- Esperado: 20 filas, todas con prov_depto no null (formato 'PROVINCIA | DEPTO').

-- V4: confirmar que los totales por vendedor NO cambiaron (solo cambio geo,
-- no assigned_vendor)
-- SELECT assigned_vendor, tipo, COUNT(*) AS n
-- FROM `app-vendedores-shimano.shimano_app.v_leads_detalle`
-- GROUP BY assigned_vendor, tipo
-- ORDER BY assigned_vendor, tipo;
-- Esperado: mismos numeros que antes del deploy (correr snapshot pre-deploy
-- para comparar).
