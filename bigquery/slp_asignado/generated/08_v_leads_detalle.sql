CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_leads_detalle` AS
WITH base AS (
  SELECT
    document_id,
    NULLIF(JSON_VALUE(data, '$.cardCodeSap'), '')       AS card_code_sap,
    COALESCE(
      NULLIF(JSON_VALUE(data, '$.fantasia'), ''),
      NULLIF(JSON_VALUE(data, '$.comercio'), '')
    )                                                    AS card_name,
    JSON_VALUE(data, '$.status')                        AS status,
    JSON_VALUE(data, '$.manualSapPending')              AS manual_sap_pending,
    UPPER(TRIM(JSON_VALUE(data, '$.provincia')))        AS provincia_raw,
    JSON_VALUE(data, '$.localidadFinal')                AS localidad_final,
    JSON_VALUE(data, '$.localidad')                     AS localidad_libre,
    IFNULL(NULLIF(JSON_VALUE(data, '$.assignedVendor'), ''), '(SIN ASIGNAR)')
                                                        AS assigned_vendor
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.status') = 'approved'
    AND (JSON_VALUE(data, '$.assignedVendor') IS NULL
         OR NOT STARTS_WITH(JSON_VALUE(data, '$.assignedVendor'), 'ADMIN_'))
),
clasificado AS (
  SELECT
    COALESCE(card_code_sap, CONCAT('LEAD_', document_id)) AS card_code,
    card_name,
    CASE
      WHEN card_code_sap IS NOT NULL AND card_code_sap != ''            THEN 'CLIENTE_SAP'
      WHEN manual_sap_pending = 'true'
           AND (card_code_sap IS NULL OR card_code_sap = '')            THEN 'LEAD'
      ELSE 'OTRO'
    END AS tipo,
    CASE
      WHEN provincia_raw IN ('CIUDAD AUTÃ“NOMA DE BUENOS AIRES',
                             'CAPITAL FEDERAL',
                             'CIUDAD DE BUENOS AIRES')                  THEN 'CABA'
      -- v512 (2026-08-13): fix provincia mal cargada como codigo INDEC.
      -- '2' o '02' -> CABA (permite que MONSERRAT resuelva a COMUNA 1
      -- via alias del script build_geo_localidad_departamento.py).
      WHEN provincia_raw IN ('2', '02')                                 THEN 'CABA'
      WHEN provincia_raw = 'CÃ“RDOBA'                                    THEN 'CORDOBA'
      WHEN provincia_raw = 'ENTRE RÃ�OS'                                 THEN 'ENTRE RIOS'
      WHEN provincia_raw = 'TUCUMÃ�N'                                    THEN 'TUCUMAN'
      WHEN provincia_raw = 'RÃ�O NEGRO'                                  THEN 'RIO NEGRO'
      WHEN provincia_raw = 'NEUQUÃ‰N'                                    THEN 'NEUQUEN'
      WHEN provincia_raw IN ('(SIN PROVINCIA)', '')                     THEN NULL
      ELSE provincia_raw
    END AS provincia,
    NULLIF(TRIM(COALESCE(localidad_final, localidad_libre)), '')        AS localidad,
    assigned_vendor
  FROM base
),
-- v2/v513: normalizar localidad + provincia para JOIN con geo_localidad_departamento.
-- MISMA transformacion que scripts/build_geo_localidad_departamento.py:
--   1. UPPER + strip accents (NFD + \p{Mn})
--   2. drop puntos, parentesis, guiones (-> espacio)
--   3. colapsar espacios
--   4. expandir abreviaturas: GRAL/CNEL/CMTE/GDOR/PTO/CD/CAP
-- Sin este pipeline "SAN FRANCISCO SOLANO (QUILMES)" o "Cmte. Piedrabuena"
-- nunca matchean con la tabla alias.
con_geo AS (
  SELECT
    c.card_code, c.card_name, c.tipo,
    c.provincia, c.localidad, c.assigned_vendor,
    REGEXP_REPLACE(
      REGEXP_REPLACE(NORMALIZE(UPPER(c.provincia), NFD), r'\p{Mn}', ''),
      r'\s+', ' '
    )                                                                    AS provincia_norm,
    -- Localidad: strip accents + drop puntos/parentesis/guiones + colapsar
    -- espacios + expandir GRAL/CNEL/CMTE/GDOR/PTO/CD/CAP.
    TRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    REGEXP_REPLACE(
                      REGEXP_REPLACE(
                        REGEXP_REPLACE(NORMALIZE(UPPER(c.localidad), NFD), r'[.()\-]', ' '),
                        r'\p{Mn}', ''
                      ),
                      r'\s+', ' '
                    ),
                    r'\bGRAL\b', 'GENERAL'
                  ),
                  r'\bCNEL\b', 'CORONEL'
                ),
                r'\bCMTE\b', 'COMANDANTE'
              ),
              r'\bGDOR\b', 'GOBERNADOR'
            ),
            r'\bPTO\b', 'PUERTO'
          ),
          r'\bCD\b', 'CIUDAD'
        ),
        r'\bCAP\b', 'CAPITAN'
      )
    )                                                                   AS localidad_norm
  FROM clasificado c
  WHERE c.tipo IN ('CLIENTE_SAP', 'LEAD')
),
enriched AS (
  SELECT
    g.card_code, g.card_name, g.tipo,
    g.provincia, g.localidad, g.assigned_vendor,
    gld.departamento_topo AS departamento,
    gld.prov_depto        AS prov_depto
  FROM con_geo g
  LEFT JOIN `app-vendedores-shimano.shimano_app.geo_localidad_departamento` gld
    ON gld.provincia_norm = g.provincia_norm
   AND gld.localidad_norm = g.localidad_norm
),
-- v796 (2026-09-04, Mariano): override manual por card_code. LEFT JOIN
-- opcional con geo_overrides_clientes â€” si existe una fila para el
-- card_code, sus valores pisan provincia/departamento/localidad y se
-- recalcula prov_depto como override.provincia || ' | ' || override.departamento.
-- Objetivo: corregir clientes/leads que caen en blanco en el mapa del
-- tablero SAR pesca sin tocar SAP ni los forms de la app.
-- Ver bigquery/geo_overrides.sql para la lista de overrides + como
-- agregar mas.
-- El JOIN es LEFT y COALESCE â€” la vista sigue funcionando aunque la
-- tabla geo_overrides_clientes este vacia. NO afecta assigned_vendor,
-- asi que los totales por vendedor no cambian (solo se mueve la
-- ubicacion en el mapa).
enriched_with_override AS (
  SELECT
    e.card_code, e.card_name, e.tipo, e.assigned_vendor,
    COALESCE(ov.provincia,    e.provincia)    AS provincia,
    COALESCE(ov.localidad,    e.localidad)    AS localidad,
    COALESCE(ov.departamento, e.departamento) AS departamento,
    -- Cuando hay override, recalcular prov_depto con los valores nuevos.
    -- Cuando no hay override, mantener el prov_depto del JOIN con
    -- geo_localidad_departamento (puede ser null si no matcheo â€” el
    -- fallback CABA en `final` lo captura para provincia=CABA).
    CASE
      WHEN ov.card_code IS NOT NULL
        THEN CONCAT(ov.provincia, ' | ', ov.departamento)
      ELSE e.prov_depto
    END AS prov_depto
  FROM enriched e
  LEFT JOIN `app-vendedores-shimano.shimano_app.geo_overrides_clientes` ov
    ON ov.card_code = e.card_code
),
-- v512 (2026-08-13): fallback CABA. Si el socio tiene provincia=CABA
-- pero no matcheo una localidad conocida, asignamos COMUNA 1 como
-- placeholder porque la app no carga comuna. Sin este fallback los
-- CABA sin localidad quedaban sin pintar en el mapa.
final AS (
  SELECT
    card_code, card_name, tipo, provincia, localidad, assigned_vendor,
    CASE
      WHEN prov_depto IS NULL AND provincia = 'CABA' THEN 'COMUNA 1'
      ELSE departamento
    END AS departamento,
    CASE
      WHEN prov_depto IS NULL AND provincia = 'CABA'
        THEN 'CIUDAD AUTONOMA DE BUENOS AIRES | COMUNA 1'
      ELSE prov_depto
    END AS prov_depto
  FROM enriched_with_override
)
SELECT
  card_code,
  card_name,
  tipo,
  provincia,
  localidad,
  departamento,
  prov_depto,
  assigned_vendor,
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
FROM final
