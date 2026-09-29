CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_visitas` AS
SELECT
  document_id                                                         AS visita_id,
  JSON_VALUE(data, '$.vendor')                                        AS vendedor,
  JSON_VALUE(data, '$.ownerUid')                                      AS owner_uid,
  JSON_VALUE(data, '$.ownerEmail')                                    AS owner_email,
  JSON_VALUE(data, '$.createdByUid')                                  AS created_by_uid,
  JSON_VALUE(data, '$.createdByEmail')                                AS created_by_email,
  SAFE_CAST(JSON_VALUE(data, '$.onBehalfOf') AS BOOL)                 AS on_behalf_of,
  -- IMPORTANTE: visits guarda estos campos con nombres en espaÃ±ol
  -- (a diferencia de pedidos que usa province/locName). Confirmado
  -- 2026-07-08 mirando submitVisita en index.html linea ~24155.
  JSON_VALUE(data, '$.provincia')                                     AS provincia,
  JSON_VALUE(data, '$.localidad')                                     AS localidad,
  JSON_VALUE(data, '$.tienda')                                        AS tienda,
  JSON_VALUE(data, '$.tipo')                                          AS tipo_cliente,
  JSON_VALUE(data, '$.local')                                         AS local_tipo,
  JSON_VALUE(data, '$.tamano')                                        AS tamano,
  JSON_VALUE(data, '$.fidelidad')                                     AS fidelidad,
  JSON_VALUE(data, '$.especializacion')                               AS especializacion,
  JSON_VALUE(data, '$.canalCompra')                                   AS canal_compra,
  SAFE_CAST(JSON_VALUE(data, '$.relevancia') AS FLOAT64)              AS relevancia,
  JSON_VALUE(data, '$.pop')                                           AS pop,
  JSON_VALUE(data, '$.necesidadPuntual')                              AS necesidad_puntual,
  JSON_VALUE(data, '$.oportunidad')                                   AS oportunidad,
  JSON_VALUE(data, '$.masVendido')                                    AS mas_vendido,
  JSON_VALUE(data, '$.masPreguntan')                                  AS mas_preguntan,
  JSON_VALUE(data, '$.ayudaTienda')                                   AS ayuda_tienda,
  JSON_VALUE(data, '$.tipoVenta')                                     AS tipo_venta,
  JSON_VALUE(data, '$.competencia')                                   AS competencia,
  JSON_VALUE(data, '$.categoriaCliente')                              AS categoria_cliente,
  -- fecha_visita: SAP guarda ISO date. SAFE.PARSE_DATE devuelve NULL si el formato no matchea.
  COALESCE(
    SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(JSON_VALUE(data, '$.fecha'), 1, 10)),
    SAFE_CAST(JSON_VALUE(data, '$.fecha') AS DATE)
  )                                                                   AS fecha_visita,
  JSON_VALUE(data, '$.fotoEspacio')                                   AS foto_espacio_url,
  JSON_VALUE(data, '$.fotoFrente')                                    AS foto_frente_url,
  -- v311+ (2026-07-23): distincion visita fisica vs contacto no presencial.
  -- El campo `interactionType` se agrego en v305 de la app. Docs pre-v305
  -- (~19 de 32 totales al 2026-07-22) no lo tienen -> se cuentan como
  -- 'visita' (COALESCE). En PBI usar:
  --   * `interaction_type` para agrupar / colorear (2 valores: visita/contacto)
  --   * `es_contacto` (BOOL) para filtros rapidos y medidas condicionales
  --      Ej DAX:  Visitas = CALCULATE(COUNTROWS(v_visitas), NOT [es_contacto])
  --              Contactos = CALCULATE(COUNTROWS(v_visitas), [es_contacto])
  COALESCE(JSON_VALUE(data, '$.interactionType'), 'visita')           AS interaction_type,
  -- COALESCE explicito con FALSE: si interactionType es NULL, el comparativo
  -- devuelve NULL (no FALSE) y COUNTIF(NOT es_contacto) no cuenta esos rows.
  COALESCE(JSON_VALUE(data, '$.interactionType') = 'contacto', FALSE) AS es_contacto,
  -- v313+ (2026-07-23): forma de contacto para interactionType='contacto'.
  -- Valores canonicos: LLAMADA TELEFONICA / MENSAJE DE WHATSAPP / MENSAJE SMS.
  -- En modo visita queda NULL (no aplica). Uso PBI: desglose "Contactos por
  -- canal" y comparar performance de WhatsApp vs telefono vs SMS.
  JSON_VALUE(data, '$.formaContacto')                                 AS forma_contacto,
  timestamp                                                           AS last_operation_at,
  operation                                                           AS last_operation,
  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de
  -- assigned_vendor. Congruente con la atribucion del modelo PBI.
  CASE UPPER(TRIM(JSON_VALUE(data, '$.vendor')))
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
FROM `app-vendedores-shimano.shimano_app.visits_raw_raw_latest`
WHERE operation <> 'DELETE'
