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
  -- lines_json removido 2026-07-14: cada JSON pesa 5-50KB unico -> VertiPaq
  -- no puede comprimir y explota RAM en Power BI Desktop. El aplanamiento
  -- ya vive en v_ventas_lineas (63k filas) que es la fuente real para
  -- medidas de facturacion/margen. Si algun query necesita lines_json,
  -- leerlo directo de sap_invoices_raw.lines_json.
  inv._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
  ON inv.card_code = bp.card_code;


-- ============================================================
-- View 4-bis: v_sap_items_enriched (helper) — rollback 2026-07-14
-- ============================================================
-- ROLLBACK 2026-07-14: revirtio al schema original (solo sap_items_raw,
-- 755 items, sin is_in_master). El fix del 2026-07-13 (universo ampliado
-- con SKUs BIKE desde SQ/SO/PO) causaba freeze en Power BI Desktop del
-- usuario durante el refresh full - la maquina con 8GB RAM no podia
-- recomprimir VertiPaq desde cero con el nuevo schema. Al revertir al
-- schema original, PBI ve refresh incremental normal y no cuelga.
--
-- Contexto historico y disenio del fix + intento de rollback quirurgico
-- (WHERE is_in_master=TRUE) documentados en git log
-- (commits e5cef77 fix, 7729ced rollback quirurgico, 2026-07-14 rollback total).
--
-- El gap huerfano (1454 SKUs BIKE con backorder invisible) queda
-- pendiente. Cuando el user tenga mas RAM o migre a Power BI Service,
-- se puede reintroducir el fix (ver PLAN_POWERBI.md o el commit e5cef77
-- para la version amplia).
--
-- FIX 2026-07-13: sync_sap_to_bigquery.py filtra Items por
-- ItemsGroupCode eq PESCA (~755 items). SKUs BIKE con backorder
-- (patas de cambio, cadenas, shifters) NUNCA llegan a sap_items_raw,
-- entonces v_backorder_lineas los mostraba con item_name/familia/stock
-- en blanco y v_inventario no los listaba directamente. Ahora incluimos
-- todos los item_code que aparezcan en algun documento SAP abierto
-- (SQ / SO / PO), con stock=0 y familia='SIN CATALOGO' para huerfanos.
--
-- Filas resultantes: ~3.042 (755 maestro PESCA + 2.287 huerfanos con
-- actividad en algun documento abierto). No incluye sap_invoices_raw
-- para no inflar con SKUs historicos que ya no operan.
--
-- Nueva columna: is_in_master (BOOL). TRUE = existe en sap_items_raw
-- (grupo PESCA). FALSE = huerfano (venia de SQ/SO/PO). Reemplaza el
-- uso de `it.item_code IS NOT NULL` como sinonimo de "es PESCA" en
-- v_backorder_lineas y v_ventas_lineas.
--
-- Prioridad de familia_norm (sin cambios):
--   1. cat cargada en catalogo (fuente de verdad)
--   2. Overrides manuales por item_code
--   3. Regex heuristica por item_name
--   4. Si es huerfano (not is_in_master) -> 'SIN CATALOGO'
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_sap_items_enriched` AS
SELECT
  it.*,
  CASE
    WHEN it.cat IS NOT NULL AND it.cat != '' THEN it.cat
    -- Overrides manuales conocidos
    WHEN it.item_code IN ('CVC66H2CSA','CVC66MH2','CVC66MH4SACO','FXPR410','12843-01','55CRT12524') THEN 'CAÑAS'
    WHEN it.item_code = '471512' THEN 'FG'
    -- Heuristica por nombre
    WHEN REGEXP_CONTAINS(UPPER(it.item_name),
      r'CA(N|Ñ)A|SOJOURN|CRUZAR|PEJERREY|CONVERGENCE|TELESC|NRX|G\.LOOMIS|TIP ASQ|SOLARA|CLARUS') THEN 'CAÑAS'
    WHEN REGEXP_CONTAINS(UPPER(it.item_name),
      r'REEL |SPINNING REEL|BAITCAST|BAITCASTING|FRONTAL|SPINNING FRONTAL') THEN 'REEL'
    WHEN REGEXP_CONTAINS(UPPER(it.item_name), r'COMBO') THEN 'COMBO'
    WHEN REGEXP_CONTAINS(UPPER(it.item_name),
      r'POWER ?PRO| LINE | LINEA|SEDAL|NYLON|FLUOROCARB|LEADER|MULTIFILAMENTO') THEN 'LINEAS'
    WHEN REGEXP_CONTAINS(UPPER(it.item_name),
      r'STICKER|BANNER|RUBBER MATT|PROMO|BUFF|GORRA|SOMBRERO|REMERA|BANDANA|KIT |BOLSA|CAJA|NECESER|CAMPING|ESTUCHE|LENTE|POLARIZADO| CAP | SHIRT|SHIMANO PROMO|PINZA|TIJERA|BOX|BAG|DISPLAY|DISP |CORTADOR|CUCHILLO|BOGAGRIP|ROD DISPLAY|FLOOR|COUNTER') THEN 'FG'
    ELSE it.cat
  END                                       AS familia_norm
FROM `app-vendedores-shimano.shimano_app.sap_items_raw` it;


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
  -- BACKORDER en la logica comercial Shimano:
  -- Oferta de Venta (Sales Quotation) abierta con RemainingOpenQuantity > 0.
  -- Incluye tanto (a) SQ parcialmente atendidas (Santiago aprobo SO por parte
  -- del pedido, resto queda pendiente para el cliente) como (b) SQ intactas
  -- (todavia no procesadas por Santiago). Ambas son "asignado a cliente
  -- pendiente de entrega".
  SELECT
    JSON_VALUE(line, '$.ItemCode') AS item_code,
    SUM(SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)) AS qty_backorder
  FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw` q,
  UNNEST(JSON_EXTRACT_ARRAY(q.lines_json)) AS line
  WHERE q.document_status = 'bost_Open'
    AND COALESCE(q.cancelled, 'tNO') = 'tNO'
    AND SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64) > 0
  GROUP BY item_code
),
orders_open_agg AS (
  -- PEDIDOS EN CURSO: Sales Orders abiertas con RemainingOpenQty > 0.
  -- Ya son ventas comprometidas por Santiago, pendientes de entregar (delivery).
  -- No son backorder porque el compromiso ya paso a orden.
  SELECT
    JSON_VALUE(line, '$.ItemCode') AS item_code,
    SUM(SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)) AS qty_pedidos_en_curso
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
  it.familia_norm                                                     AS familia,
  it.fam                                                              AS subfamilia,
  it.sub                                                              AS sub_subfamilia,
  it.valid,
  it.frozen,
  -- Stock
  it.stock_total_sellable                                             AS stock_actual,
  it.stock_by_warehouse_json,
  -- Documentos abiertos (naming Shimano):
  --   qty_backorder        = SQ abiertas pendientes (asignado a cliente sin atender)
  --   qty_pedidos_en_curso = SO abiertas pendientes (comprometido en delivery)
  --   qty_incoming         = PO abiertas (mercaderia en camino)
  COALESCE(qo.qty_backorder, 0)                                       AS qty_backorder,
  COALESCE(oo.qty_pedidos_en_curso, 0)                                AS qty_pedidos_en_curso,
  COALESCE(po.qty_incoming, 0)                                        AS qty_incoming,
  -- Stock proyectado = actual + entrante - comprometido total (backorder + pedidos en curso)
  it.stock_total_sellable
    + COALESCE(po.qty_incoming, 0)
    - COALESCE(qo.qty_backorder, 0)
    - COALESCE(oo.qty_pedidos_en_curso, 0)                            AS stock_proyectado,
  -- Precios y costos. SAFE_CAST porque autodetect a veces tipa columnas
  -- todo-NULL como STRING (cost_last_purchase_ars hoy siempre None ->
  -- STRING en el schema BQ). Forzamos FLOAT64 para que COALESCE compile.
  SAFE_CAST(it.price_pesca_ars AS FLOAT64)                            AS price_pesca_ars,
  SAFE_CAST(it.cost_avg_ars AS FLOAT64)                               AS cost_avg_ars,
  SAFE_CAST(it.cost_last_purchase_ars AS FLOAT64)                     AS cost_last_purchase_ars,
  COALESCE(SAFE_CAST(it.cost_avg_ars AS FLOAT64),
           SAFE_CAST(it.cost_last_purchase_ars AS FLOAT64))            AS cost_efectivo_ars,
  -- Valores
  it.stock_total_sellable * COALESCE(SAFE_CAST(it.price_pesca_ars AS FLOAT64), 0.0) AS valor_inventario_venta_ars,
  it.stock_total_sellable * COALESCE(SAFE_CAST(it.cost_avg_ars AS FLOAT64),
                                     SAFE_CAST(it.cost_last_purchase_ars AS FLOAT64),
                                     0.0)                              AS valor_inventario_costo_ars,
  -- Flags derivados para semaforos rapidos en Power BI.
  -- QUEBRADO_CON_DEMANDA: sin stock Y con senial de demanda (SQ pendiente O
  -- SO abierta). Semaforo mas critico: hay clientes esperando y no tenemos.
  -- INSUFICIENTE: stock < compromiso total (backorder + pedidos en curso).
  CASE
    WHEN it.stock_total_sellable <= 0
         AND (COALESCE(qo.qty_backorder, 0) > 0 OR COALESCE(oo.qty_pedidos_en_curso, 0) > 0)
                                                                              THEN 'QUEBRADO_CON_DEMANDA'
    WHEN it.stock_total_sellable <= 0                                         THEN 'QUEBRADO'
    WHEN it.stock_total_sellable <
         COALESCE(qo.qty_backorder, 0) + COALESCE(oo.qty_pedidos_en_curso, 0) THEN 'INSUFICIENTE'
    WHEN COALESCE(qo.qty_backorder, 0) = 0
         AND COALESCE(oo.qty_pedidos_en_curso, 0) = 0
         AND it.stock_total_sellable > 0                                      THEN 'DISPONIBLE'
    ELSE 'PARCIAL'
  END                                                                 AS estado_stock,
  it._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.v_sap_items_enriched` it
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
WITH items_parsed AS (
  SELECT
    it.*,
    PARSE_JSON(it.stock_by_warehouse_json, wide_number_mode => 'round') AS whs_json
  FROM `app-vendedores-shimano.shimano_app.sap_items_raw` it
  WHERE it.stock_by_warehouse_json IS NOT NULL
)
SELECT
  ip.item_code,
  ip.item_name,
  ip.cat                                                              AS familia,
  ip.fam                                                              AS subfamilia,
  whs_code                                                            AS warehouse_code,
  -- JSON subscripting json[key] SI acepta expresion dinamica (a diferencia
  -- de JSON_VALUE path). LAX_FLOAT64 tolera valores que vengan como string.
  LAX_FLOAT64(ip.whs_json[whs_code])                                  AS stock_qty,
  whs_code IN ('05', '06')                                            AS is_non_sales,
  SAFE_CAST(ip.price_pesca_ars AS FLOAT64)                            AS price_pesca_ars,
  SAFE_CAST(ip.cost_avg_ars AS FLOAT64)                               AS cost_avg_ars,
  LAX_FLOAT64(ip.whs_json[whs_code])
    * COALESCE(SAFE_CAST(ip.price_pesca_ars AS FLOAT64), 0.0)         AS valor_venta_ars,
  LAX_FLOAT64(ip.whs_json[whs_code])
    * COALESCE(SAFE_CAST(ip.cost_avg_ars AS FLOAT64),
               SAFE_CAST(ip.cost_last_purchase_ars AS FLOAT64),
               0.0)                                                   AS valor_costo_ars,
  ip._sync_timestamp
FROM items_parsed ip,
UNNEST(JSON_KEYS(ip.whs_json, 1)) AS whs_code;


-- ============================================================
-- View 7: v_ventas_lineas
-- ============================================================
-- 1 fila POR LINEA de factura SAP (UNNEST del lines_json).
-- Alimenta:
--   * Top N productos mas vendidos (unidades / facturado)
--   * Treemap Familia x Subfamilia con participacion de facturado
--   * Cobertura de stock en dias (demanda promedio ultimos N dias)
--   * Mapa/ranking de ventas por provincia (usa provincia_cliente)
--
-- Filtra facturas canceladas. La categorizacion cat/fam/sub viene del
-- LEFT JOIN con sap_items_raw (fuente de verdad del catalogo pesca).
-- SKUs que no matchean quedan con familia NULL - se pueden filtrar en PBI.
--
-- provincia_cliente: como sap_bp_raw.state esta NULL (sync BQ no lo
-- pobla), hacemos lookup a client_applications (cardCodeSap) y
-- client_master (sapCardCode). Prioridad: client_applications > master.
-- Normalizado UPPERCASE, canonizando 'CORDOBA'/'ENTRE RIOS'/'TUCUMAN'
-- (sin tildes) y unificando 'CABA' (CIUDAD AUTONOMA DE BUENOS AIRES /
-- CAPITAL FEDERAL / CIUDAD DE BUENOS AIRES).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_ventas_lineas` AS
WITH prov_lookup AS (
  SELECT card_code, provincia AS provincia_raw
  FROM (
    SELECT card_code, provincia, priority,
           ROW_NUMBER() OVER (PARTITION BY card_code ORDER BY priority) AS rn
    FROM (
      SELECT
        JSON_VALUE(data, '$.cardCodeSap') AS card_code,
        UPPER(TRIM(JSON_VALUE(data, '$.provincia'))) AS provincia,
        1 AS priority
      FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
      WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
        AND JSON_VALUE(data, '$.provincia') IS NOT NULL
        AND JSON_VALUE(data, '$.provincia') NOT IN ('(sin provincia)', '')
      UNION ALL
      SELECT
        JSON_VALUE(data, '$.sapCardCode') AS card_code,
        UPPER(TRIM(JSON_VALUE(data, '$.provincia'))) AS provincia,
        2 AS priority
      FROM `app-vendedores-shimano.shimano_app.client_master_raw_raw_latest`
      WHERE JSON_VALUE(data, '$.sapCardCode') IS NOT NULL
        AND JSON_VALUE(data, '$.provincia') NOT IN ('(sin provincia)', '', NULL)
    )
    WHERE card_code IS NOT NULL
  )
  WHERE rn = 1
)
SELECT
  inv.doc_entry,
  inv.doc_num,
  inv.doc_date,
  EXTRACT(YEAR  FROM inv.doc_date) AS anio,
  EXTRACT(MONTH FROM inv.doc_date) AS mes,
  inv.card_code,
  inv.card_name,
  inv.sales_person_code,
  JSON_VALUE(line, '$.ItemCode')                                        AS item_code,
  JSON_VALUE(line, '$.Dscription')                                      AS descripcion_linea,
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)                  AS cantidad,
  SAFE_CAST(JSON_VALUE(line, '$.Price') AS FLOAT64)                     AS precio_unitario,
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64)                 AS importe_linea_ars,
  JSON_VALUE(line, '$.WarehouseCode')                                   AS warehouse_code,
  -- Categorizacion del catalogo (join con items).
  -- Parche encoding: el catalogo embebido en index.html perdio acentos/enies
  -- (bytes latin-1 leidos como UTF-8 -> U+FFFD). Reemplazamos los patrones
  -- mas comunes para que Power BI muestre "Cania"/"Accion"/etc. correctos.
  -- Fix definitivo pendiente en el build del catalogo maestro.
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    it.item_name,
    'Ca�as', 'Cañas'),
    'Ca�a',  'Caña'),
    'Tama�o','Tamaño'),
    'Se�uelo','Señuelo'),
    'Acci�n','Acción'),
    'visi�n','visión'),
    'Multifunci�n','Multifunción'),
    'C�digo','Código'),
    'Jap�n','Japón'),
    'Telesc�pica','Telescópica'),
    'Se�al','Señal'),
    'a�os','años'),
    'a�o','año'),
    '�',     '')                                                    AS item_name_catalogo,
  it.familia_norm                                                       AS familia,
  it.fam                                                                AS subfamilia,
  it.sub                                                                AS sub_subfamilia,
  -- is_pesca = TRUE si el SKU existe en sap_items_raw (grupo 102 PESCA).
  -- Permite filtrar en PBI para vistas PESCA-solo vs Shimano-entera.
  it.item_code IS NOT NULL                                              AS is_pesca,
  -- Provincia canonizada del cliente (para mapa/ranking por region).
  CASE
    WHEN prov.provincia_raw IN ('CIUDAD AUTÓNOMA DE BUENOS AIRES',
                                'CAPITAL FEDERAL',
                                'CIUDAD DE BUENOS AIRES') THEN 'CABA'
    WHEN prov.provincia_raw = 'CÓRDOBA'    THEN 'CORDOBA'
    WHEN prov.provincia_raw = 'ENTRE RÍOS' THEN 'ENTRE RIOS'
    WHEN prov.provincia_raw = 'TUCUMÁN'    THEN 'TUCUMAN'
    WHEN prov.provincia_raw = 'RÍO NEGRO'  THEN 'RIO NEGRO'
    WHEN prov.provincia_raw = 'NEUQUÉN'    THEN 'NEUQUEN'
    ELSE prov.provincia_raw
  END                                                                   AS provincia_cliente,
  inv._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv,
UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS line
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` it
  ON it.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN prov_lookup prov
  ON prov.card_code = inv.card_code
WHERE COALESCE(inv.cancelled, 'tNO') = 'tNO';


-- ============================================================
-- View 8: v_backorder_lineas
-- ============================================================
-- Granularidad LINEA: 1 fila por (SQ abierta, item_code, cliente).
-- Alimenta la tabla "Top Backorder" del dashboard.
--
-- BACKORDER en la logica Shimano:
--   Oferta de Venta (Sales Quotation) abierta con RemainingOpenQuantity > 0.
--   Incluye tanto SQ parcialmente atendidas (Santiago hizo SO por parte, resto
--   queda pendiente) como SQ intactas (aun no procesadas). Ambas = "asignado
--   a cliente pendiente de entrega".
--
-- Columnas:
--   sq_doc_entry/num/date = documento de la Sales Quotation.
--   pedido    = qty original de la linea de SQ.
--   pendiente = qty todavia sin cubrir por SO/Delivery/Invoice.
--   estado    = ASIGNADO (hay PO con fecha) / SIN ASIGNAR (sin embarque).
--
-- Nota historica: antes esta view leia de sap_orders_raw (SO), que en la
-- logica Shimano son "pedidos en curso" (ya comprometidos), no backorder.
-- Fix 2026-07-12 sobre feedback del user (flujo cotizacion 1200 -> SO 1000
-- + SQ pendiente 200 = backorder).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_backorder_lineas` AS
WITH po_prox AS (
  SELECT
    JSON_VALUE(line, '$.ItemCode') AS item_code,
    MIN(po.doc_due_date) AS prox_embarque_date,
    SUM(SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)) AS qty_incoming
  FROM `app-vendedores-shimano.shimano_app.sap_purchase_orders_raw` po,
  UNNEST(JSON_EXTRACT_ARRAY(po.lines_json)) AS line
  WHERE po.document_status = 'bost_Open'
    AND COALESCE(po.cancelled, 'tNO') = 'tNO'
    AND SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64) > 0
  GROUP BY item_code
)
SELECT
  o.doc_entry                                                           AS sq_doc_entry,
  o.doc_num                                                             AS sq_doc_num,
  o.doc_date                                                            AS sq_doc_date,
  JSON_VALUE(line, '$.ItemCode')                                        AS sku,
  -- Mismo parche encoding que v_ventas_lineas (catalogo con U+FFFD por
  -- bytes latin-1 leidos como UTF-8). Fix definitivo pendiente en build.
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    it.item_name,
    'Ca�as', 'Cañas'),
    'Ca�a',  'Caña'),
    'Tama�o','Tamaño'),
    'Se�uelo','Señuelo'),
    'Acci�n','Acción'),
    'visi�n','visión'),
    'Multifunci�n','Multifunción'),
    'C�digo','Código'),
    'Jap�n','Japón'),
    'Telesc�pica','Telescópica'),
    'Se�al','Señal'),
    'a�os','años'),
    'a�o','año'),
    '�',     '')                                                        AS producto,
  it.familia_norm                                                       AS familia,
  it.fam                                                                AS subfamilia,
  it.item_code IS NOT NULL                                              AS is_pesca,
  it.stock_total_sellable                                               AS stock_actual,
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64)                  AS pedido,
  SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64)     AS pendiente,
  SAFE_CAST(JSON_VALUE(line, '$.Price') AS FLOAT64)                     AS precio_unitario,
  o.card_code                                                           AS cliente_code,
  COALESCE(bp.card_name, o.card_name)                                   AS cliente_nombre,
  bp.city                                                               AS cliente_ciudad,
  po.prox_embarque_date,
  po.qty_incoming,
  IF(po.prox_embarque_date IS NOT NULL, 'ASIGNADO', 'SIN ASIGNAR')      AS estado,
  o._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw` o,
UNNEST(JSON_EXTRACT_ARRAY(o.lines_json)) AS line
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` it
  ON it.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
  ON bp.card_code = o.card_code
LEFT JOIN po_prox po
  ON po.item_code = JSON_VALUE(line, '$.ItemCode')
WHERE o.document_status = 'bost_Open'
  AND COALESCE(o.cancelled, 'tNO') = 'tNO'
  AND SAFE_CAST(JSON_VALUE(line, '$.RemainingOpenQuantity') AS FLOAT64) > 0;
