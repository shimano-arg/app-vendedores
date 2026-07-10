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
  -- IMPORTANTE: visits guarda estos campos con nombres en español
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


-- ============================================================
-- View 5: v_inventario
-- ============================================================
-- 1 fila por SKU pesca con la foto completa de inventario para la hoja
-- "Inventario" de Power BI:
--   * Stock actual sellable (excluye whs 05/06)
--   * Cantidad en cotizaciones abiertas (demanda potencial no cerrada)
--   * Cantidad en Sales Orders abiertas (backorder = comprometido sin entregar)
--   * Cantidad en Purchase Orders abiertas (asignado a embarque - hoy ~0)
--   * Valor inventario a costo y a precio de venta PESCA
--   * Categorizacion cat/fam/sub del catalogo (para treemap)
--   * Semaforos derivados: cobertura_meses = stock / demanda_promedio_ultimos_90d
--     (se calcula en Power BI desde v_pedidos_lines si hace falta)
--
-- Convencion "abierto":
--   - Quotations: document_status = 'bost_Open' (bost_Close = ganada o vencida).
--     Usamos SUM(qty) de las lineas abiertas.
--   - Orders: RemainingOpenQuantity por linea (SAP ya descuenta lo entregado).
--   - Purchase Orders: idem RemainingOpenQuantity.
--
-- Notas:
--   - stock_by_warehouse_json queda expuesta para que Power BI la explote
--     con un query M si arma la vista por deposito. Alternativa: crear
--     v_inventario_por_warehouse en fase posterior.
--   - COALESCE(precio) para no propagar NULLs en el valor total.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_inventario` AS
WITH quotations_open_agg AS (
  SELECT
    JSON_VALUE(line, '$.ItemCode') AS item_code,
    SUM(SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)) AS qty_quotations_open
  FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw` q,
  UNNEST(JSON_EXTRACT_ARRAY(q.lines_json)) AS line
  WHERE q.document_status = 'bost_Open'
    AND COALESCE(q.cancelled, 'tNO') = 'tNO'
  GROUP BY item_code
),
orders_open_agg AS (
  SELECT
    JSON_VALUE(line, '$.ItemCode') AS item_code,
    SUM(SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)) AS qty_backorder
  FROM `app-vendedores-shimano.shimano_app.sap_orders_raw` o,
  UNNEST(JSON_EXTRACT_ARRAY(o.lines_json)) AS line
  WHERE o.document_status = 'bost_Open'
    AND COALESCE(o.cancelled, 'tNO') = 'tNO'
  GROUP BY item_code
),
po_open_agg AS (
  SELECT
    JSON_VALUE(line, '$.ItemCode') AS item_code,
    SUM(SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)) AS qty_incoming
  FROM `app-vendedores-shimano.shimano_app.sap_purchase_orders_raw` po,
  UNNEST(JSON_EXTRACT_ARRAY(po.lines_json)) AS line
  WHERE po.document_status = 'bost_Open'
    AND COALESCE(po.cancelled, 'tNO') = 'tNO'
  GROUP BY item_code
)
SELECT
  it.item_code,
  it.item_name,
  it.foreign_name,
  it.cat                                                              AS familia,
  it.fam                                                              AS subfamilia,
  it.sub                                                              AS sub_subfamilia,
  it.valid,
  it.frozen,
  -- Stock
  it.stock_total_sellable                                             AS stock_actual,
  it.stock_by_warehouse_json,
  -- Documentos abiertos
  COALESCE(qo.qty_quotations_open, 0)                                 AS qty_quotations_open,
  COALESCE(oo.qty_backorder, 0)                                       AS qty_backorder,
  COALESCE(po.qty_incoming, 0)                                        AS qty_incoming,
  -- Stock proyectado = actual + entrante - comprometido
  it.stock_total_sellable
    + COALESCE(po.qty_incoming, 0)
    - COALESCE(oo.qty_backorder, 0)                                   AS stock_proyectado,
  -- Precios y costos
  it.price_pesca_ars,
  it.cost_avg_ars,
  it.cost_last_purchase_ars,
  COALESCE(it.cost_avg_ars, it.cost_last_purchase_ars)                AS cost_efectivo_ars,
  -- Valores
  it.stock_total_sellable * COALESCE(it.price_pesca_ars, 0)           AS valor_inventario_venta_ars,
  it.stock_total_sellable * COALESCE(it.cost_avg_ars, it.cost_last_purchase_ars, 0) AS valor_inventario_costo_ars,
  -- Flags derivados para semaforos rapidos en Power BI
  CASE
    WHEN it.stock_total_sellable <= 0 AND COALESCE(qo.qty_quotations_open, 0) > 0 THEN 'QUEBRADO_CON_DEMANDA'
    WHEN it.stock_total_sellable <= 0                                             THEN 'QUEBRADO'
    WHEN it.stock_total_sellable < COALESCE(oo.qty_backorder, 0)                  THEN 'INSUFICIENTE_BACKORDER'
    WHEN COALESCE(oo.qty_backorder, 0) = 0 AND it.stock_total_sellable > 0        THEN 'DISPONIBLE'
    ELSE 'PARCIAL'
  END                                                                 AS estado_stock,
  it._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_items_raw` it
LEFT JOIN quotations_open_agg qo ON it.item_code = qo.item_code
LEFT JOIN orders_open_agg     oo ON it.item_code = oo.item_code
LEFT JOIN po_open_agg         po ON it.item_code = po.item_code;


-- ============================================================
-- View 6: v_inventario_por_warehouse
-- ============================================================
-- Explota stock_by_warehouse_json a UNA FILA POR (item, warehouse).
-- Util para el drill "stock por deposito" de la hoja Inventario.
-- Filtra warehouses no-vendibles (05 Marketing, 06 Devoluciones) como
-- flag para que Power BI pueda mostrarlos u ocultarlos.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_inventario_por_warehouse` AS
SELECT
  it.item_code,
  it.item_name,
  it.cat                                                              AS familia,
  it.fam                                                              AS subfamilia,
  wh.whs                                                              AS warehouse_code,
  SAFE_CAST(wh.value AS FLOAT64)                                      AS stock_qty,
  wh.whs IN ('05', '06')                                              AS is_non_sales,
  it.price_pesca_ars,
  it.cost_avg_ars,
  SAFE_CAST(wh.value AS FLOAT64) * COALESCE(it.price_pesca_ars, 0)    AS valor_venta_ars,
  SAFE_CAST(wh.value AS FLOAT64) * COALESCE(it.cost_avg_ars, it.cost_last_purchase_ars, 0) AS valor_costo_ars,
  it._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_items_raw` it,
UNNEST(
  ARRAY(
    SELECT AS STRUCT
      whs_code                                                        AS whs,
      JSON_VALUE(PARSE_JSON(it.stock_by_warehouse_json, wide_number_mode => 'round'),
                 '$.' || whs_code)                                    AS value
    FROM UNNEST(JSON_KEYS(PARSE_JSON(it.stock_by_warehouse_json, wide_number_mode => 'round'), 1)) AS whs_code
  )
) AS wh
WHERE it.stock_by_warehouse_json IS NOT NULL;
