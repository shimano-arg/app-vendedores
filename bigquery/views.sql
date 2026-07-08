-- ============================================================
-- BigQuery Views curadas para Power BI
-- ============================================================
-- Fase 2 del pipeline Power BI. Estas vistas aplanan el JSON crudo
-- de las tablas *_raw_latest (Firebase Extension) y arman datasets
-- limpios listos para consumir desde Power BI Desktop.
--
-- Filosofia:
--   - Las tablas raw se mantienen intactas (audit trail + fuente de
--     verdad). Cualquier bug de vista se arregla aca sin re-syncear.
--   - Los nombres de columnas se re-mapean a snake_case latino que le
--     resulta natural al usuario final (cliente_nombre en vez de
--     clientName). Power BI hereda esos nombres.
--   - SAFE_CAST en todos los conversions para que un dato malformado
--     no rompa toda la vista - sale como NULL y sigue.
--
-- Convencion de naming:
--   v_pedidos_header       1 fila por pedido (nivel cabecera)
--   v_pedidos_lines        1 fila por linea de pedido (explota lines[])
--   v_visitas              1 fila por visita
--   v_facturas_sap         1 fila por factura + LEFT JOIN con BP
--
-- Ejecutar en BigQuery Console:
--   1. Abrir https://console.cloud.google.com/bigquery?project=app-vendedores-shimano
--   2. Click en "Redactar consulta nueva"
--   3. Pegar UN bloque CREATE OR REPLACE VIEW por vez, Ejecutar
--   4. Verificar que aparece bajo shimano_app > "Vistas" con tick verde
--
-- Todas las views usan CREATE OR REPLACE VIEW, o sea que se pueden
-- correr de nuevo con cambios sin dropear/recrear.
-- ============================================================


-- ============================================================
-- View 1: v_pedidos_header
-- ============================================================
-- 1 fila por pedido con la data del header (cliente, mes, forma de pago,
-- forma de entrega, subtotales). Excluye DELETEs (la view _raw_latest
-- ya los filtra pero dejamos el WHERE por defensa).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_pedidos_header` AS
SELECT
  document_id                                                         AS pedido_id,
  JSON_VALUE(data, '$.stage')                                         AS stage,
  JSON_VALUE(data, '$.key')                                           AS pedido_key,
  JSON_VALUE(data, '$.tipo')                                          AS tipo_cliente,
  JSON_VALUE(data, '$.province')                                      AS provincia,
  JSON_VALUE(data, '$.locName')                                       AS localidad,
  JSON_VALUE(data, '$.clientName')                                    AS cliente_nombre,
  JSON_VALUE(data, '$.ownerUid')                                      AS owner_uid,
  JSON_VALUE(data, '$.ownerEmail')                                    AS owner_email,
  JSON_VALUE(data, '$.createdByUid')                                  AS created_by_uid,
  JSON_VALUE(data, '$.createdByEmail')                                AS created_by_email,
  JSON_VALUE(data, '$.createdByDisplayName')                          AS created_by_display_name,
  SAFE_CAST(JSON_VALUE(data, '$.onBehalfOf') AS BOOL)                 AS on_behalf_of,
  JSON_VALUE(data, '$.month')                                         AS mes_label,
  SAFE_CAST(JSON_VALUE(data, '$.monthIdx') AS INT64)                  AS mes_idx,
  SAFE_CAST(JSON_VALUE(data, '$.year') AS INT64)                      AS anio,
  SAFE_CAST(JSON_VALUE(data, '$.confirmedAt') AS TIMESTAMP)           AS confirmed_at,
  JSON_VALUE(data, '$.condicionPago')                                 AS condicion_pago,
  JSON_VALUE(data, '$.formaEntrega.tipo')                             AS forma_entrega_tipo,
  JSON_VALUE(data, '$.formaEntrega.transpNombre')                     AS transp_nombre,
  JSON_VALUE(data, '$.formaEntrega.transpDireccion')                  AS transp_direccion,
  JSON_VALUE(data, '$.formaEntrega.clienteDireccion')                 AS cliente_direccion_transp,
  JSON_VALUE(data, '$.formaEntrega.sucursalDireccion')                AS sucursal_direccion,
  SAFE_CAST(JSON_VALUE(data, '$.subtotalArs') AS FLOAT64)             AS subtotal_ars,
  SAFE_CAST(JSON_VALUE(data, '$.netAmountArs') AS FLOAT64)            AS net_amount_ars,
  SAFE_CAST(JSON_VALUE(data, '$.discountPct') AS FLOAT64)             AS discount_pct,
  SAFE_CAST(JSON_VALUE(data, '$.hasSkusToReview') AS BOOL)            AS has_skus_to_review,
  SAFE_CAST(JSON_VALUE(data, '$.skusToReviewCount') AS INT64)         AS skus_to_review_count,
  timestamp                                                           AS last_operation_at,
  operation                                                           AS last_operation
FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest`
WHERE operation <> 'DELETE';


-- ============================================================
-- View 2: v_pedidos_lines
-- ============================================================
-- Explota el array `lines` del pedido a filas separadas. UNA FILA POR
-- LINEA (o sea, 1 pedido con 10 SKUs = 10 filas aca). Incluye contexto
-- del pedido para que Power BI pueda queryear top SKUs por vendedor,
-- por zona, etc. sin joinear con v_pedidos_header.
--
-- El campo needs_review permite filtrar los SKUs "REVISAR EN SAP"
-- (los que se cargaron por Excel sin match en el catalogo).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_pedidos_lines` AS
SELECT
  p.document_id                                                       AS pedido_id,
  line_idx,
  JSON_VALUE(line_json, '$.code')                                     AS sku,
  JSON_VALUE(line_json, '$.desc')                                     AS descripcion,
  JSON_VALUE(line_json, '$.cat')                                      AS categoria,
  JSON_VALUE(line_json, '$.fam')                                      AS familia,
  JSON_VALUE(line_json, '$.sub')                                      AS subfamilia,
  SAFE_CAST(JSON_VALUE(line_json, '$.qty') AS FLOAT64)                AS cantidad,
  SAFE_CAST(JSON_VALUE(line_json, '$.precio') AS FLOAT64)             AS precio_unitario,
  SAFE_CAST(JSON_VALUE(line_json, '$.qty') AS FLOAT64)
    * SAFE_CAST(JSON_VALUE(line_json, '$.precio') AS FLOAT64)         AS subtotal_linea,
  COALESCE(SAFE_CAST(JSON_VALUE(line_json, '$.needsReview') AS BOOL), FALSE) AS needs_review,
  -- Contexto del pedido (denormalizado para queries rapidos)
  JSON_VALUE(p.data, '$.stage')                                       AS stage,
  JSON_VALUE(p.data, '$.tipo')                                        AS tipo_cliente,
  JSON_VALUE(p.data, '$.province')                                    AS provincia,
  JSON_VALUE(p.data, '$.locName')                                     AS localidad,
  JSON_VALUE(p.data, '$.clientName')                                  AS cliente_nombre,
  JSON_VALUE(p.data, '$.ownerUid')                                    AS owner_uid,
  JSON_VALUE(p.data, '$.ownerEmail')                                  AS owner_email,
  JSON_VALUE(p.data, '$.month')                                       AS mes_label,
  SAFE_CAST(JSON_VALUE(p.data, '$.monthIdx') AS INT64)                AS mes_idx,
  SAFE_CAST(JSON_VALUE(p.data, '$.year') AS INT64)                    AS anio,
  SAFE_CAST(JSON_VALUE(p.data, '$.confirmedAt') AS TIMESTAMP)         AS confirmed_at,
  JSON_VALUE(p.data, '$.condicionPago')                               AS condicion_pago
FROM `app-vendedores-shimano.shimano_app.pedidos_raw_raw_latest` p,
UNNEST(JSON_EXTRACT_ARRAY(p.data, '$.lines')) AS line_json WITH OFFSET AS line_idx
WHERE p.operation <> 'DELETE';


-- ============================================================
-- View 3: v_visitas
-- ============================================================
-- 1 fila por visita con todos los campos del formulario aplanados.
-- Los VDIs actuando "en nombre de" un VDE quedan reflejados en las
-- columnas owner_* (VDE) y created_by_* (VDI).
--
-- fecha_visita se parsea desde el string ISO. Si el formato es raro,
-- SAFE.PARSE_DATE devuelve NULL en vez de romper.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_visitas` AS
SELECT
  document_id                                                         AS visita_id,
  JSON_VALUE(data, '$.vendor')                                        AS vendedor,
  JSON_VALUE(data, '$.ownerUid')                                      AS owner_uid,
  JSON_VALUE(data, '$.ownerEmail')                                    AS owner_email,
  JSON_VALUE(data, '$.createdByUid')                                  AS created_by_uid,
  JSON_VALUE(data, '$.createdByEmail')                                AS created_by_email,
  SAFE_CAST(JSON_VALUE(data, '$.onBehalfOf') AS BOOL)                 AS on_behalf_of,
  JSON_VALUE(data, '$.province')                                      AS provincia,
  JSON_VALUE(data, '$.locName')                                       AS localidad,
  JSON_VALUE(data, '$.tienda')                                        AS tienda,
  JSON_VALUE(data, '$.tipo')                                          AS tipo_cliente,
  JSON_VALUE(data, '$.local')                                         AS local_tipo,
  JSON_VALUE(data, '$.tamano')                                        AS tamano,
  JSON_VALUE(data, '$.fidelidad')                                     AS fidelidad,
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
  timestamp                                                           AS last_operation_at,
  operation                                                           AS last_operation
FROM `app-vendedores-shimano.shimano_app.visits_raw_raw_latest`
WHERE operation <> 'DELETE';


-- ============================================================
-- View 4: v_facturas_sap
-- ============================================================
-- Facturas SAP + LEFT JOIN con Business Partners para tener nombre
-- de cliente + tipo + moneda BP + ciudad al lado, sin que Power BI
-- tenga que hacer el join.
--
-- Si la factura tiene CardCode que no matchea con ningun BP en
-- sap_bp_raw (raro pero posible en Leads que aun no son Customer),
-- los campos bp_* quedan NULL - la factura sigue apareciendo.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_facturas_sap` AS
SELECT
  inv.doc_type,
  inv.doc_entry,
  inv.doc_num,
  inv.doc_date,
  inv.doc_due_date,
  inv.document_status,
  inv.cancelled,
  inv.card_code,
  inv.card_name                                                       AS card_name_invoice,
  bp.card_name                                                        AS card_name_bp,
  bp.card_type                                                        AS card_type_bp,
  bp.currency                                                         AS bp_currency,
  bp.group_code                                                       AS bp_group_code,
  bp.city                                                             AS bp_city,
  bp.country                                                          AS bp_country,
  bp.email                                                            AS bp_email,
  bp.phone1                                                           AS bp_phone1,
  bp.pay_terms_group_code                                             AS bp_pay_terms_group_code,
  bp.sales_person_code                                                AS bp_sales_person_code,
  bp.valid                                                            AS bp_valid,
  bp.frozen                                                           AS bp_frozen,
  inv.doc_currency,
  inv.doc_total,
  inv.doc_total_fc,
  inv.doc_rate,
  inv.discount_percent,
  inv.total_discount,
  inv.sales_person_code                                               AS sales_person_code_invoice,
  inv.comments,
  inv.jrnl_memo,
  inv.payment_group_code,
  inv.series,
  inv.create_date,
  inv.update_date,
  inv.lines_count,
  inv.lines_json,
  inv._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
  ON inv.card_code = bp.card_code;
