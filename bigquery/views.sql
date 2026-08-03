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
WITH cliente_app AS (
  -- v311+ (2026-07-22): traer el assignedVendor de la app desde
  -- client_applications. Solucion al problema del SlpCode SAP inconsistente:
  -- SAP tiene facturas cargadas con SlpCode incorrectos (49=Mariano admin,
  -- 54=Federico cuando el cliente es de Martin, etc). El assignedVendor
  -- de la app es la fuente de verdad del negocio. Filtrar por este campo
  -- en PBI muestra las facturas del vendedor real, no del que qued
  -- registrado en la carga SAP.
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      JSON_VALUE(data, '$.assignedVendor')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS assigned_vendor_app
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
-- v367+ (2026-07-30): UNION ALL con Credit Notes para que las NCs resten
-- automaticamente del Remitido/Facturado/Deuda en Power BI. Sin este UNION,
-- las NCs quedan invisibles y el reporte sobreestima ventas. sign=-1 en CNs
-- negando doc_total/paid_to_date/total_discount asegura que cualquier
-- SUM(doc_total) en PBI ya venga con las devoluciones aplicadas.
invoices_and_cns AS (
  SELECT *, 1 AS sign, 'INVOICE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`
  UNION ALL
  SELECT *, -1 AS sign, 'CREDIT_NOTE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw`
)
SELECT
  inv.doc_type,
  inv.doc_kind,                                                       -- v367+: 'INVOICE' | 'CREDIT_NOTE'
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
  -- v367+: multiplicamos por sign para que CNs vengan como negativo.
  inv.doc_total * inv.sign                                            AS doc_total,
  inv.doc_total_fc * inv.sign                                         AS doc_total_fc,
  inv.doc_rate,
  -- v302+ (2026-07-21): paid_to_date para calcular Cobrado / Deuda en PBI
  -- sin depender de v_facturado_cobrado_deuda_por_vendedor (que agrupa
  -- por assigned_vendor de la app; aca conservamos el criterio SlpCode
  -- de la pagina Facturacion por Vendedor).
  -- v367+: paid_to_date * sign para que en CNs sea negativo (cobrar una
  -- devolucion = plata que sale de tesoreria).
  inv.paid_to_date * inv.sign                                         AS paid_to_date,
  (inv.doc_total * inv.sign) - COALESCE(inv.paid_to_date * inv.sign, 0)
                                                                      AS saldo_ars,
  inv.discount_percent,
  inv.total_discount * inv.sign                                       AS total_discount,
  inv.sales_person_code                                               AS sales_person_code_invoice,
  -- v311+ (2026-07-22): vendedor real del cliente segun la app (source of truth).
  -- Usar este campo en los slicers del TABLERO SAR en vez de SlpCode.
  ca.assigned_vendor_app                                              AS assigned_vendor,
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
  -- leerlo directo de sap_invoices_raw.lines_json o sap_credit_notes_raw.lines_json.
  inv._sync_timestamp
FROM invoices_and_cns inv
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
  ON inv.card_code = bp.card_code
LEFT JOIN cliente_app ca
  ON ca.card_code = inv.card_code;


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
  -- v311+ (2026-07-22): alias legacy para no romper visuales viejos de PBI
  -- que todavia referencian el nombre pre-rename (qty_quotations_open era
  -- el nombre hasta 2026-07-12, cuando lo cambiamos a qty_backorder). El
  -- refresh del TABLERO SAR tiraba warning "column not found" y algunos
  -- visuales quedaban en blanco. Con este alias los visuales vuelven a
  -- funcionar sin tocar el .pbix; cuando alguien identifique el visual
  -- roto y lo actualice a qty_backorder, esta columna se puede sacar.
  COALESCE(qo.qty_backorder, 0)                                       AS qty_quotations_open,
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
),
cliente_app AS (
  -- v311+ (2026-07-22): assignedVendor de la app como fuente de verdad
  -- del vendedor real (independiente del SlpCode con el que se cargo la
  -- factura en SAP). Ver v_facturas_sap para contexto completo.
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      JSON_VALUE(data, '$.assignedVendor')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS assigned_vendor_app
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
-- v367+ (2026-07-30): UNION ALL con Credit Notes multiplicando cantidad e
-- importes por sign=-1 para que las NCs resten automaticamente cualquier
-- SUM(cantidad) o SUM(importe_linea_ars) en PBI. Sin este UNION, las NCs
-- no se veian en el pipeline (endpoint SAP separado /b1s/v1/CreditNotes)
-- y las cards de facturacion sobreestimaban el total. Bug reportado por
-- Mariano 2026-07-30: Santiago $29M vs $18.9M real (NC RC 1810 -$10.1M
-- no restaba).
invoices_and_cns AS (
  SELECT *, 1 AS sign, 'INVOICE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`
  UNION ALL
  SELECT *, -1 AS sign, 'CREDIT_NOTE' AS doc_kind
  FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw`
)
SELECT
  inv.doc_entry,
  inv.doc_num,
  inv.doc_kind,                                                         -- v367+: 'INVOICE' | 'CREDIT_NOTE'
  inv.doc_date,
  EXTRACT(YEAR  FROM inv.doc_date) AS anio,
  EXTRACT(MONTH FROM inv.doc_date) AS mes,
  inv.card_code,
  inv.card_name,
  inv.sales_person_code,
  JSON_VALUE(line, '$.ItemCode')                                        AS item_code,
  JSON_VALUE(line, '$.Dscription')                                      AS descripcion_linea,
  -- v367+: cantidad y montos multiplicados por sign para que CNs resten.
  SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) * inv.sign       AS cantidad,
  SAFE_CAST(JSON_VALUE(line, '$.Price') AS FLOAT64)                     AS precio_unitario,
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign      AS importe_linea_ars,
  -- v302+ (2026-07-21): prorrateo cobrado/deuda por linea.
  -- Permite en PBI:
  --   [Cobrado ARS] = CALCULATE(SUM(cobrado_prorrateado_ars), is_pesca=TRUE)
  --   [Deuda ARS]   = CALCULATE(SUM(deuda_prorrateada_ars),   is_pesca=TRUE)
  -- que suman exactamente [Facturacion Total] (que usa importe_linea_ars).
  -- Prorrateo lineal: cobrado_linea = importe_linea * (paid_to_date / doc_total)
  -- v367+: para CNs paid_to_date/doc_total ambos son sign=-1 en el numerator
  -- si aplicaramos negacion, pero SAFE_DIVIDE del ratio se cancela; entonces
  -- multiplicamos importe_linea (ya con sign) por el ratio unsigned original.
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign
    * SAFE_DIVIDE(inv.paid_to_date, inv.doc_total)                      AS cobrado_prorrateado_ars,
  SAFE_CAST(JSON_VALUE(line, '$.LineTotal') AS FLOAT64) * inv.sign
    * SAFE_DIVIDE(inv.doc_total - COALESCE(inv.paid_to_date, 0), inv.doc_total)
                                                                        AS deuda_prorrateada_ars,
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
  -- v311+ (2026-07-22): vendedor real del cliente segun la app (fuente
  -- de verdad del negocio). Usar en slicers PBI en lugar del SlpCode
  -- SAP que esta inconsistente en decenas de facturas.
  ca.assigned_vendor_app                                                AS assigned_vendor,
  inv._sync_timestamp
FROM invoices_and_cns inv,
UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) AS line
LEFT JOIN `app-vendedores-shimano.shimano_app.v_sap_items_enriched` it
  ON it.item_code = JSON_VALUE(line, '$.ItemCode')
LEFT JOIN prov_lookup prov
  ON prov.card_code = inv.card_code
LEFT JOIN cliente_app ca
  ON ca.card_code = inv.card_code
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


-- ============================================================
-- View 9: v_targets
-- ============================================================
-- Targets mensuales de facturacion en ARS, cargados por el gerente
-- desde el modal Targets de la app (coleccion Firestore `targets`).
-- Sincronizados a targets_raw via sync_sap_to_bigquery.py cada 30 min.
--
-- Esquema pedido por el usuario para consumo directo en Power BI:
--   slp_code        INT64    codigo vendedor SAP (mapeo hardcoded, ver abajo)
--   vendedor        STRING   nombre completo del vendedor (formato SAP)
--   anio            INT64
--   mes             INT64    1-12 (convertido desde 0-11 de Firestore)
--   target_ars      FLOAT64
--   _sync_timestamp TIMESTAMP
--
-- Mapeo vendorKey -> SlpCode HARDCODED en el CASE de abajo:
--   Gonzalo de la Rosa    -> 50
--   Mauricio Gil          -> 51
--   Ioannis Palkoudakis   -> 52
--   Santiago Esteban      -> 53
--   Federico Castelanelli -> 54
--   Martin Boiero         -> 55
--
-- HISTORIA / ADVERTENCIA (2026-07-14):
--   * Firestore sap_vendors tiene el mapeo corrido en -1 (49-54 en vez
--     de 50-55). Ese doc es una carga vieja errada de la app; el
--     canonico definido por el usuario es 50-55.
--   * SAP prod (SHIMANO_SAU) al 2026-07-14 aun NO tiene creados los
--     SlpCodes 50-55 - solo estan hasta 19 + 33 (Mariano) + 56. SEIDOR
--     los va a crear como parte del lanzamiento. Verificar los codes
--     efectivos en /SalesPersons cuando SEIDOR confirme (bloqueante
--     historico de la seccion 2 del README).
--   * SlpCode 49 se reserva a Mariano Erbino (admin), NUNCA es un
--     vendedor comercial - excluido explicitamente por regla del user.
--
-- DEDUP garantizado: doc ID en Firestore es {seller}_{year}_{MM}
-- (unico por combinacion), y el sync usa WRITE_TRUNCATE a targets_raw,
-- entonces la vista no puede tener duplicados por construccion.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_targets` AS
SELECT
  -- Mapeo canonico app -> SAP. Si SAP asigna otros SlpCodes al crear
  -- los usuarios en PROD, actualizar este CASE (unica fuente de verdad
  -- del mapeo).
  CASE seller_id
    WHEN 'GONZALO DE LA ROSA'    THEN 50
    WHEN 'MAURICIO GIL'          THEN 51
    WHEN 'IOANNIS PALKOUDAKIS'   THEN 52
    WHEN 'SANTIAGO ESTEBAN'      THEN 53
    WHEN 'FEDERICO CASTELANELLI' THEN 54
    WHEN 'MARTIN BOIERO'         THEN 55
  END                                                     AS slp_code,
  CASE seller_id
    WHEN 'GONZALO DE LA ROSA'    THEN 'Gonzalo de la Rosa'
    WHEN 'MAURICIO GIL'          THEN 'Mauricio Gil'
    WHEN 'IOANNIS PALKOUDAKIS'   THEN 'Ioannis Palkoudakis'
    WHEN 'SANTIAGO ESTEBAN'      THEN 'Santiago Esteban'
    WHEN 'FEDERICO CASTELANELLI' THEN 'Federico Castelanelli'
    WHEN 'MARTIN BOIERO'         THEN 'Martin Boiero'
  END                                                     AS vendedor,
  year                                                    AS anio,
  month + 1                                               AS mes,   -- 0-11 -> 1-12
  target_ars,
  -- v310+: desglose por familia. Docs viejos pre-v310 tienen null en
  -- estas 3 (targetByFamily no existia). Consumidores en PBI:
  --   * Card "Target Reel del mes" = SUM(target_reel_ars)
  --   * Cumplimiento por familia = SUM(reel_facturado) / SUM(target_reel_ars)
  target_reel_ars,
  target_canas_ars,
  target_lineas_ars,
  _sync_timestamp
FROM `app-vendedores-shimano.shimano_app.targets_raw`
WHERE seller_id IN (
  'GONZALO DE LA ROSA','MAURICIO GIL','IOANNIS PALKOUDAKIS',
  'SANTIAGO ESTEBAN','FEDERICO CASTELANELLI','MARTIN BOIERO'
)
  AND target_ars > 0;


-- ============================================================
-- View 10: v_deuda_por_vendedor (2026-07-20)
-- ============================================================
-- Facturas SAP abiertas con saldo pendiente, agrupadas por vendedor de la
-- APP (no por SalesPersonCode del BP, que hoy tiene codigos historicos
-- Baraldo).
--
-- Contexto (pedido de Pablo por Teams 2026-07-20):
--   "quiero ver cuanto lleva facturado cada vendedor, por el tema del
--   target tambien, y si tiene pedidos pendientes de pagar por ejemplo"
--
-- Estrategia:
--   1. Filtrar sap_invoices_raw: bost_Open + tNO + saldo>0 (usando
--      paid_to_date que se agrego en v302).
--   2. LEFT JOIN client_applications_raw_latest por card_code para
--      obtener el assignedVendor de la app.
--   3. Solo mostrar facturas de clientes pesca (asignados a algun
--      vendedor pesca de la app). Los clientes BIKE se descartan.
--
-- Nota SlpCode: NO usamos sap_invoices_raw.sales_person_code para
-- agrupar. Motivo: SAP prod hoy tiene codigos historicos (1,2,9,11,12,
-- 14,19,23,34) que corresponden a vendedores era Baraldo. Los codigos
-- 50-55 de nuestros vendedores app recien empezaron a usarse (SlpCode
-- 53 y 54 aparecen en pocas facturas 2026-07). Agrupar por assignedVendor
-- de la app es mas util operativamente: muestra la deuda "de mis
-- clientes" independiente de quien facturo historicamente.
--
-- Schema de salida:
--   assigned_vendor  STRING    vendorKey app ("GONZALO DE LA ROSA", etc)
--   facturas_pendientes    INT64     cantidad de facturas abiertas
--   clientes_con_deuda     INT64     cantidad de card_codes distintos
--   deuda_total_ars        FLOAT64   suma de saldos pendientes
--   deuda_vencida_ars      FLOAT64   suma solo de facturas con due_date < hoy
--   deuda_al_dia_ars       FLOAT64   suma de facturas con due_date >= hoy
--   proxima_vencimiento    DATE      MIN(doc_due_date) del vendedor
--   _sync_timestamp        TIMESTAMP
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_deuda_por_vendedor` AS
WITH facturas_abiertas AS (
  SELECT
    inv.card_code,
    inv.doc_entry,
    inv.doc_num,
    inv.doc_date,
    inv.doc_due_date,
    SAFE_CAST(inv.doc_total AS FLOAT64) - COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) AS saldo_ars,
    inv._sync_timestamp
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv
  WHERE inv.document_status = 'bost_Open'
    AND inv.cancelled = 'tNO'
    AND SAFE_CAST(inv.doc_total AS FLOAT64) - COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) > 0.01
),
clientes_app AS (
  -- Mapeo cardCode -> assignedVendor desde client_applications.
  -- Un mismo cardCode puede existir en varios docs (raro pero puede pasar).
  -- ARRAY_AGG + LIMIT 1 para deduplicar tomando el primero.
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      JSON_VALUE(data, '$.assignedVendor')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS assigned_vendor
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
enriquecido AS (
  SELECT
    fa.card_code,
    fa.doc_entry,
    fa.doc_num,
    fa.doc_date,
    fa.doc_due_date,
    fa.saldo_ars,
    fa._sync_timestamp,
    ca.assigned_vendor
  FROM facturas_abiertas fa
  INNER JOIN clientes_app ca USING (card_code)
  WHERE ca.assigned_vendor IS NOT NULL
    AND ca.assigned_vendor != ''
    AND ca.assigned_vendor IN (
      'GONZALO DE LA ROSA', 'MAURICIO GIL', 'IOANNIS PALKOUDAKIS',
      'SANTIAGO ESTEBAN', 'FEDERICO CASTELANELLI', 'MARTIN BOIERO'
    )
)
SELECT
  assigned_vendor,
  COUNT(*) AS facturas_pendientes,
  COUNT(DISTINCT card_code) AS clientes_con_deuda,
  ROUND(SUM(saldo_ars), 2) AS deuda_total_ars,
  ROUND(SUM(CASE WHEN doc_due_date < CURRENT_DATE() THEN saldo_ars ELSE 0 END), 2) AS deuda_vencida_ars,
  ROUND(SUM(CASE WHEN doc_due_date >= CURRENT_DATE() THEN saldo_ars ELSE 0 END), 2) AS deuda_al_dia_ars,
  MIN(doc_due_date) AS proxima_vencimiento,
  MAX(_sync_timestamp) AS _sync_timestamp
FROM enriquecido
GROUP BY assigned_vendor;


-- ============================================================
-- View 10-bis: v_deuda_facturas_detalle (2026-07-20)
-- ============================================================
-- Drill-down de v_deuda_por_vendedor: 1 fila por factura abierta.
-- Permite tabla detalle en Power BI mostrando cada factura por vendedor.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_deuda_facturas_detalle` AS
WITH facturas_abiertas AS (
  SELECT
    inv.card_code,
    inv.card_name AS card_name_sap,
    inv.doc_entry,
    inv.doc_num,
    inv.doc_date,
    inv.doc_due_date,
    SAFE_CAST(inv.doc_total AS FLOAT64) AS doc_total_ars,
    COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) AS paid_to_date_ars,
    SAFE_CAST(inv.doc_total AS FLOAT64) - COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) AS saldo_ars,
    inv.sales_person_code AS sap_sales_person_code,
    inv._sync_timestamp
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv
  WHERE inv.document_status = 'bost_Open'
    AND inv.cancelled = 'tNO'
    AND SAFE_CAST(inv.doc_total AS FLOAT64) - COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) > 0.01
),
clientes_app AS (
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      STRUCT(
        JSON_VALUE(data, '$.assignedVendor') AS assigned_vendor,
        JSON_VALUE(data, '$.comercio') AS comercio,
        JSON_VALUE(data, '$.fantasia') AS fantasia
      )
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS info
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
)
SELECT
  ca.info.assigned_vendor AS assigned_vendor,
  fa.card_code,
  COALESCE(NULLIF(ca.info.fantasia, ''), ca.info.comercio, fa.card_name_sap) AS cliente_display,
  ca.info.comercio AS cliente_titular,
  ca.info.fantasia AS cliente_fantasia,
  fa.doc_num,
  fa.doc_entry,
  fa.doc_date,
  fa.doc_due_date,
  DATE_DIFF(CURRENT_DATE(), fa.doc_due_date, DAY) AS dias_vencido,
  fa.doc_total_ars,
  fa.paid_to_date_ars,
  ROUND(fa.saldo_ars, 2) AS saldo_ars,
  CASE
    WHEN fa.doc_due_date < CURRENT_DATE() THEN 'VENCIDA'
    ELSE 'AL DIA'
  END AS estado,
  fa.sap_sales_person_code,
  fa._sync_timestamp
FROM facturas_abiertas fa
INNER JOIN clientes_app ca USING (card_code)
WHERE ca.info.assigned_vendor IN (
  'GONZALO DE LA ROSA', 'MAURICIO GIL', 'IOANNIS PALKOUDAKIS',
  'SANTIAGO ESTEBAN', 'FEDERICO CASTELANELLI', 'MARTIN BOIERO'
);


-- ============================================================
-- View 11: v_facturado_cobrado_deuda_por_vendedor (2026-07-20)
-- ============================================================
-- La foto completa por vendedor de la app: cuanto facturo (total emitido),
-- cuanto cobro (paid_to_date acumulado) y cuanto deben.
--
-- Granularidad: 1 fila por (vendedor, anio, mes) para poder filtrar en PBI.
-- La deuda solo cuenta facturas ABIERTAS (bost_Open + saldo > 0); el
-- facturado y cobrado cuentan tanto Open como Closed (para tener la foto
-- historica completa de facturacion).
--
-- Verificacion matematica esperada:
--   facturado_ars = cobrado_ars + deuda_ars   (por vendedor, considerando
--   todas las facturas, abiertas y cerradas)
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_facturado_cobrado_deuda_por_vendedor` AS
WITH facturas AS (
  SELECT
    inv.card_code,
    inv.doc_date,
    EXTRACT(YEAR FROM inv.doc_date) AS anio,
    EXTRACT(MONTH FROM inv.doc_date) AS mes,
    SAFE_CAST(inv.doc_total AS FLOAT64) AS doc_total_ars,
    COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) AS paid_to_date_ars,
    inv.document_status,
    inv.cancelled
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv
  WHERE inv.cancelled = 'tNO'  -- No contamos facturas anuladas
    AND inv.doc_date IS NOT NULL
),
clientes_app AS (
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      JSON_VALUE(data, '$.assignedVendor')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS assigned_vendor
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
enriquecido AS (
  SELECT
    ca.assigned_vendor,
    f.anio,
    f.mes,
    f.doc_total_ars,
    f.paid_to_date_ars,
    -- Deuda solo cuenta facturas abiertas con saldo real > 0.
    -- Si esta cerrada, el saldo es 0 (aunque el saldo calculado
    -- pueda tener redondeo residual).
    CASE
      WHEN f.document_status = 'bost_Open'
       AND (f.doc_total_ars - f.paid_to_date_ars) > 0.01
      THEN (f.doc_total_ars - f.paid_to_date_ars)
      ELSE 0
    END AS saldo_pendiente_ars
  FROM facturas f
  INNER JOIN clientes_app ca USING (card_code)
  WHERE ca.assigned_vendor IN (
    'GONZALO DE LA ROSA', 'MAURICIO GIL', 'IOANNIS PALKOUDAKIS',
    'SANTIAGO ESTEBAN', 'FEDERICO CASTELANELLI', 'MARTIN BOIERO'
  )
)
SELECT
  assigned_vendor,
  anio,
  mes,
  COUNT(*) AS facturas_emitidas,
  ROUND(SUM(doc_total_ars), 2) AS facturado_ars,
  ROUND(SUM(paid_to_date_ars), 2) AS cobrado_ars,
  ROUND(SUM(saldo_pendiente_ars), 2) AS deuda_ars,
  CURRENT_TIMESTAMP() AS _sync_timestamp
FROM enriquecido
GROUP BY assigned_vendor, anio, mes;


-- ============================================================
-- View 12: v_rendiciones (2026-07-22)
-- ============================================================
-- 1 fila por rendicion de gasto. Solo `tipo='gasto'` (excluye solicitudes
-- de anticipo). Alimenta el dashboard "Rendiciones" de Power BI:
--   * KPIs: total rendido, ticket promedio, monto pendiente aprobacion,
--     % con comprobante fiscal
--   * Grafico gasto por vendedor + evolucion diaria
--   * Distribucion por concepto (COMBUSTIBLE/COMIDA/HOSPEDAJE/PEAJE/
--     TRASLADO/OTROS) - el campo `descripcion` de la app ES el concepto
--   * Modo de pago (RECARGABLE/CORPORATIVA/EFECTIVO)
--   * Local vs Regional (divisionGasto)
--   * Alertas: sin comprobante, pendientes, duplicados (ver v_rendiciones_duplicados)
--
-- Naming: usamos `concepto` en la vista aunque en el doc se llame
-- `descripcion` (mas claro para el usuario final de Power BI, que ve
-- "concepto de gasto" como categoria).
--
-- Foto ticket (v308+): preferir fotoTicketUrl (Storage) sobre fotoTicket
-- (base64 legacy). Los 45 docs pre-v308 se retro-migraron con
-- scripts/migrate_rendiciones_foto_to_storage.py el 2026-07-22.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_rendiciones` AS
SELECT
  document_id                                                         AS rendicion_id,
  JSON_VALUE(data, '$.ownerUid')                                      AS owner_uid,
  JSON_VALUE(data, '$.ownerEmail')                                    AS owner_email,
  JSON_VALUE(data, '$.ownerName')                                     AS owner_name,
  JSON_VALUE(data, '$.vendor')                                        AS vendor,
  JSON_VALUE(data, '$.status')                                        AS status,
  JSON_VALUE(data, '$.descripcion')                                   AS concepto,
  JSON_VALUE(data, '$.tipoGasto')                                     AS tipo_gasto,
  JSON_VALUE(data, '$.modoPago')                                      AS modo_pago,
  JSON_VALUE(data, '$.moneda')                                        AS moneda,
  JSON_VALUE(data, '$.divisionGasto')                                 AS division_gasto,
  SAFE_CAST(JSON_VALUE(data, '$.importe') AS FLOAT64)                 AS importe_ars,
  SAFE_CAST(JSON_VALUE(data, '$.importeUsd') AS FLOAT64)              AS importe_usd,
  JSON_VALUE(data, '$.numeroTicket')                                  AS numero_ticket,
  JSON_VALUE(data, '$.observaciones')                                 AS observaciones,
  JSON_VALUE(data, '$.approverEmail')                                 AS approver_email,
  JSON_VALUE(data, '$.approvedByEmail')                               AS approved_by_email,
  -- createdAt en Firestore serializa como {_seconds, _nanoseconds}.
  -- Convertimos a TIMESTAMP + DATE para PBI.
  TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(data, '$.createdAt._seconds') AS INT64))
                                                                      AS created_at,
  DATE(TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(data, '$.createdAt._seconds') AS INT64)),
       'America/Argentina/Buenos_Aires')                              AS fecha_gasto,
  EXTRACT(YEAR FROM DATE(TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(data, '$.createdAt._seconds') AS INT64)),
                          'America/Argentina/Buenos_Aires'))          AS anio,
  EXTRACT(MONTH FROM DATE(TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(data, '$.createdAt._seconds') AS INT64)),
                           'America/Argentina/Buenos_Aires'))         AS mes,
  EXTRACT(DAY FROM DATE(TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(data, '$.createdAt._seconds') AS INT64)),
                         'America/Argentina/Buenos_Aires'))           AS dia,
  TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(data, '$.approvedAt._seconds') AS INT64))
                                                                      AS approved_at,
  -- Foto ticket: preferir Storage URL sobre base64 legacy (aunque
  -- despues del retro-migrate solo debe quedar la URL).
  COALESCE(
    JSON_VALUE(data, '$.fotoTicketUrl'),
    JSON_VALUE(data, '$.fotoTicket')
  )                                                                   AS foto_ticket_url,
  -- Flags derivados para semaforos rapidos en Power BI.
  JSON_VALUE(data, '$.tipoGasto') IN ('FACTURA A', 'GASTO CON COMPROBANTE')
                                                                      AS tiene_comprobante_fiscal,
  JSON_VALUE(data, '$.status') = 'pending_approval'                   AS pendiente_aprobacion,
  JSON_VALUE(data, '$.status') = 'rejected'                           AS rechazada,
  timestamp                                                           AS last_operation_at,
  operation                                                           AS last_operation
FROM `app-vendedores-shimano.shimano_app.rendiciones_raw_raw_latest`
WHERE operation <> 'DELETE'
  AND JSON_VALUE(data, '$.tipo') = 'gasto';


-- ============================================================
-- View 13: v_rendiciones_duplicados (2026-07-22)
-- ============================================================
-- Alerta de control: detecta rendiciones sospechosas de duplicado.
-- Criterio: mismo vendor + misma fecha + mismo importe con count > 1.
--
-- Un vendedor podria legitimamente tener 2 gastos iguales el mismo dia
-- (ej: 2 cafes de $2000 en la misma jornada), pero el approver deberia
-- revisar cada caso. La vista NO borra ni marca automaticamente, solo
-- expone para revision.
--
-- Uso en PBI: cargar la vista, mostrar como tabla en la seccion Alertas
-- con drill-down a v_rendiciones filtrando por (vendor, fecha, importe).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_rendiciones_duplicados` AS
SELECT
  vendor,
  owner_email,
  fecha_gasto,
  importe_ars,
  COUNT(*)                                                            AS cantidad_duplicados,
  STRING_AGG(rendicion_id, ', ')                                      AS ids_afectados,
  STRING_AGG(DISTINCT concepto, ' / ')                                AS conceptos,
  STRING_AGG(DISTINCT tipo_gasto, ' / ')                              AS tipos_gasto,
  ARRAY_AGG(status)                                                   AS estados,
  MIN(created_at)                                                     AS primero_creado,
  MAX(created_at)                                                     AS ultimo_creado
FROM `app-vendedores-shimano.shimano_app.v_rendiciones`
WHERE vendor IS NOT NULL AND vendor != ''
GROUP BY vendor, owner_email, fecha_gasto, importe_ars
HAVING COUNT(*) > 1;


-- ============================================================
-- View 14: v_campanias_progreso  (2026-07-30, v367+)
-- ============================================================
-- 1 fila por campania con progreso agregado sobre TODO el rango [start_date, end_date].
-- Cruza `campaigns_raw` con `v_ventas_lineas` (facturado SAP = venta REAL, no pedido).
-- Alimenta la hoja "CAMPAÑAS" del TABLERO SAR (Power BI).
--
-- Reglas de cruce:
--   * doc_date de la factura BETWEEN campania.start_date AND campania.end_date.
--   * item_code de la linea IN UNNEST(campania.skus_json).
--   * Filtro de scope:
--       - scope='all'      -> todas las ventas del rango + SKUs.
--       - scope='province' -> WHERE provincia_cliente IN scope_values.
--       - scope='vendor'   -> WHERE assigned_vendor  IN scope_values.
--
-- Metricas:
--   realizado_qty       = SUM(cantidad) de las lineas que caen en el filtro.
--   realizado_ars       = SUM(importe_linea_ars) de las mismas lineas.
--   pct_cumplimiento    = (realizado / target) * 100, segun target_type:
--                         - target_type='units' -> divide por realizado_qty
--                         - target_type='money' -> divide por realizado_ars
--   dias_transcurridos  = DATE_DIFF(LEAST(CURRENT_DATE, end_date), start_date, DAY) + 1
--   dias_totales        = DATE_DIFF(end_date, start_date, DAY) + 1
--   dias_restantes      = GREATEST(DATE_DIFF(end_date, CURRENT_DATE, DAY), 0)
--   activa              = CURRENT_DATE BETWEEN start_date AND end_date AND NOT archived
--
-- Notas:
--   * Campanias sin skus (skus_count=0) quedan con 0 realizado (no matchea nada).
--   * scope='province' compara UPPERCASE strings normalizados (v_ventas_lineas
--     ya canoniza CABA/CORDOBA/etc; scope_values de la app se guarda tal cual
--     lo elige el gerente en el modal — validar en PBI si aparecen mismatches).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_campanias_progreso` AS
WITH c AS (
  SELECT
    campaign_id, name, familia, subfamilia, skus_json, skus_count,
    target_type, target_amount,
    start_date, end_date, scope, scope_values_json,
    created_by_email, created_at, archived, archived_at,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(sku) FROM UNNEST(JSON_EXTRACT_ARRAY(skus_json)) sku) AS skus,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(v)   FROM UNNEST(JSON_EXTRACT_ARRAY(scope_values_json)) v) AS scope_values
  FROM `app-vendedores-shimano.shimano_app.campaigns_raw`
),
matched_lines AS (
  SELECT
    c.campaign_id,
    v.item_code,
    v.doc_date,
    v.cantidad,
    v.importe_linea_ars,
    v.assigned_vendor,
    v.provincia_cliente
  FROM c
  JOIN `app-vendedores-shimano.shimano_app.v_ventas_lineas` v
    ON v.item_code IN UNNEST(c.skus)
   AND v.doc_date BETWEEN c.start_date AND c.end_date
  WHERE
    c.scope = 'all'
    OR (c.scope = 'province' AND v.provincia_cliente IN UNNEST(c.scope_values))
    OR (c.scope = 'vendor'   AND v.assigned_vendor   IN UNNEST(c.scope_values))
),
agg AS (
  SELECT
    campaign_id,
    SUM(COALESCE(cantidad, 0))          AS realizado_qty,
    SUM(COALESCE(importe_linea_ars, 0)) AS realizado_ars,
    COUNT(*)                             AS lineas_facturadas
  FROM matched_lines
  GROUP BY campaign_id
)
SELECT
  c.campaign_id,
  c.name,
  c.familia,
  c.subfamilia,
  c.skus_count,
  c.target_type,
  c.target_amount,
  c.start_date,
  c.end_date,
  c.scope,
  c.scope_values_json,
  ARRAY_TO_STRING(c.scope_values, ', ') AS scope_values_str,
  c.created_by_email,
  c.created_at,
  c.archived,
  c.archived_at,
  COALESCE(agg.realizado_qty, 0)  AS realizado_qty,
  COALESCE(agg.realizado_ars, 0)  AS realizado_ars,
  COALESCE(agg.lineas_facturadas, 0) AS lineas_facturadas,
  CASE
    WHEN c.target_type = 'units' AND c.target_amount > 0
      THEN SAFE_DIVIDE(COALESCE(agg.realizado_qty, 0), c.target_amount) * 100
    WHEN c.target_type = 'money' AND c.target_amount > 0
      THEN SAFE_DIVIDE(COALESCE(agg.realizado_ars, 0), c.target_amount) * 100
    ELSE NULL
  END                                                                     AS pct_cumplimiento,
  DATE_DIFF(c.end_date, c.start_date, DAY) + 1                            AS dias_totales,
  GREATEST(
    DATE_DIFF(LEAST(CURRENT_DATE(), c.end_date), c.start_date, DAY) + 1,
    0
  )                                                                       AS dias_transcurridos,
  GREATEST(DATE_DIFF(c.end_date, CURRENT_DATE(), DAY), 0)                 AS dias_restantes,
  (CURRENT_DATE() BETWEEN c.start_date AND c.end_date AND NOT c.archived) AS activa
FROM c
LEFT JOIN agg USING (campaign_id);


-- ============================================================
-- View 15: v_campanias_evolucion_diaria  (2026-07-30, v367+)
-- ============================================================
-- 1 fila por campania × dia dentro del rango [start_date, end_date] donde hubo
-- ventas facturadas. Permite line chart en Power BI mostrando la curva
-- acumulada del cumplimiento dia a dia.
--
-- Metricas:
--   qty_dia         = SUM(cantidad) facturado ese dia para SKUs de la campania.
--   ars_dia         = SUM(importe_linea_ars) idem.
--   qty_acumulado   = SUM window (partition by campaign_id order by doc_date).
--   ars_acumulado   = idem para pesos.
--   pct_acumulado   = (acumulado / target) * 100 segun target_type.
--
-- Notas:
--   * Solo dias con al menos 1 factura matcheada (dias vacios NO se generan
--     — no queremos rows fantasmas para 60 dias del rango si solo hubo
--     ventas en 5. Power BI puede rellenar con axis continua si hace falta).
--   * Mismos filtros de scope que v_campanias_progreso.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_campanias_evolucion_diaria` AS
WITH c AS (
  SELECT
    campaign_id, name, target_type, target_amount,
    start_date, end_date, scope,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(sku) FROM UNNEST(JSON_EXTRACT_ARRAY(skus_json)) sku) AS skus,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(v)   FROM UNNEST(JSON_EXTRACT_ARRAY(scope_values_json)) v) AS scope_values
  FROM `app-vendedores-shimano.shimano_app.campaigns_raw`
),
lines_per_day AS (
  SELECT
    c.campaign_id,
    c.name,
    c.target_type,
    c.target_amount,
    v.doc_date,
    SUM(COALESCE(v.cantidad, 0))          AS qty_dia,
    SUM(COALESCE(v.importe_linea_ars, 0)) AS ars_dia
  FROM c
  JOIN `app-vendedores-shimano.shimano_app.v_ventas_lineas` v
    ON v.item_code IN UNNEST(c.skus)
   AND v.doc_date BETWEEN c.start_date AND c.end_date
  WHERE
    c.scope = 'all'
    OR (c.scope = 'province' AND v.provincia_cliente IN UNNEST(c.scope_values))
    OR (c.scope = 'vendor'   AND v.assigned_vendor   IN UNNEST(c.scope_values))
  GROUP BY c.campaign_id, c.name, c.target_type, c.target_amount, v.doc_date
)
SELECT
  campaign_id,
  name,
  target_type,
  target_amount,
  doc_date,
  qty_dia,
  ars_dia,
  SUM(qty_dia) OVER (PARTITION BY campaign_id ORDER BY doc_date) AS qty_acumulado,
  SUM(ars_dia) OVER (PARTITION BY campaign_id ORDER BY doc_date) AS ars_acumulado,
  CASE
    WHEN target_type = 'units' AND target_amount > 0
      THEN SAFE_DIVIDE(SUM(qty_dia) OVER (PARTITION BY campaign_id ORDER BY doc_date), target_amount) * 100
    WHEN target_type = 'money' AND target_amount > 0
      THEN SAFE_DIVIDE(SUM(ars_dia) OVER (PARTITION BY campaign_id ORDER BY doc_date), target_amount) * 100
    ELSE NULL
  END AS pct_acumulado
FROM lines_per_day
ORDER BY campaign_id, doc_date;


-- ============================================================
-- View 16: v_campanias_ventas_detalle  (2026-07-30, v367+)
-- ============================================================
-- Granularidad DETALLE: 1 fila por (campania x linea de factura SAP).
-- SIN agregacion. Preserva todas las dimensiones para armar en Power BI
-- matrices tipo:
--   Filas:    campaign_name > assigned_vendor > card_name > item_code
--   Columnas: (nada) o mes
--   Valores:  SUM(cantidad), SUM(importe_linea_ars)
--
-- Motivacion: v_campanias_progreso ya viene GROUP BY campaign_id, entonces
-- perdio card_name, item_code, assigned_vendor. Para responder "quien le
-- vendio que a quien dentro de la campania X" hace falta esta vista de
-- detalle en la misma tabla (sino Power BI tira InvalidUnconstrainedJoin
-- por falta de relacion entre v_campanias_progreso y v_ventas_lineas).
--
-- Mismos filtros de scope que las otras 2 vistas (all/province/vendor).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_campanias_ventas_detalle` AS
WITH c AS (
  SELECT
    campaign_id, name AS campaign_name, familia AS campaign_familia,
    subfamilia AS campaign_subfamilia, target_type, target_amount,
    start_date, end_date, scope,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(sku) FROM UNNEST(JSON_EXTRACT_ARRAY(skus_json)) sku) AS skus,
    ARRAY(SELECT JSON_EXTRACT_SCALAR(v)   FROM UNNEST(JSON_EXTRACT_ARRAY(scope_values_json)) v) AS scope_values
  FROM `app-vendedores-shimano.shimano_app.campaigns_raw`
)
SELECT
  c.campaign_id,
  c.campaign_name,
  c.campaign_familia,
  c.campaign_subfamilia,
  c.target_type,
  c.target_amount,
  c.start_date                                                          AS campaign_start_date,
  c.end_date                                                            AS campaign_end_date,
  c.scope,
  ARRAY_TO_STRING(c.scope_values, ', ')                                 AS scope_values_str,
  -- Contexto de la factura
  v.doc_entry,
  v.doc_num,
  v.doc_date,
  v.anio,
  v.mes,
  -- Cliente
  v.card_code,
  v.card_name,
  v.provincia_cliente,
  -- SKU vendido (item de la campania)
  v.item_code,
  v.descripcion_linea,
  v.warehouse_code,
  -- Categorizacion del catalogo (item_name_catalogo con parche encoding, familia/subfamilia enriquecidas)
  v.item_name_catalogo,
  v.familia,
  v.subfamilia,
  v.is_pesca,
  -- Vendedor
  v.assigned_vendor,
  v.sales_person_code,
  -- Metricas
  v.cantidad,
  v.precio_unitario,
  v.importe_linea_ars,
  v.cobrado_prorrateado_ars,
  v.deuda_prorrateada_ars
FROM c
JOIN `app-vendedores-shimano.shimano_app.v_ventas_lineas` v
  ON v.item_code IN UNNEST(c.skus)
 AND v.doc_date BETWEEN c.start_date AND c.end_date
WHERE
  c.scope = 'all'
  OR (c.scope = 'province' AND v.provincia_cliente IN UNNEST(c.scope_values))
  OR (c.scope = 'vendor'   AND v.assigned_vendor   IN UNNEST(c.scope_values));

-- ============================================================
-- V_LEADS_VS_CLIENTES_POR_VENDEDOR
-- ============================================================
-- Universo: colección `client_applications` de Firestore, docs con
-- status='approved' (los pending_approval / rejected / draft se excluyen).
--
-- Segmenta cada alta en 2 categorías mutuamente excluyentes:
--   * clientes_sap: tienen cardCodeSap NO nulo/vacío -> ya cerrados en SAP.
--   * leads: manualSapPending=true SIN cardCodeSap -> provisorios de Alta
--     Rápida que Admin todavía no cargó a SAP. Es la definición del KPI
--     "LEADS" del sidebar de la app (v386).
--
-- Métricas por assigned_vendor:
--   * clientes_sap, leads, total_universo (= clientes_sap + leads + otros)
--   * pct_conversion = clientes_sap / total_universo (0..1)
--
-- Notas:
--   * "otros" = altas approved sin cardCodeSap y sin manualSapPending
--     (docs viejos pre-v290 sin flag; muy pocos, quedan en el total
--     como referencia pero no se tocan).
--   * Altas huérfanas sin assignedVendor caen en el bucket "(SIN ASIGNAR)"
--     para que Admin las vea y las asigne (75 altas huérfanas a 2026-08-03).
--   * Docs de testing con assignedVendor tipo "ADMIN_<uid>" se filtran.
--   * snapshot_at devuelve CURRENT_TIMESTAMP() -> ayuda a distinguir en
--     Power BI cuándo se refreshó la vista.
--
-- Uso Power BI (TABLERO SAR): tarjetas KPI "LEADS" + "Clientes SAP" +
-- "% Conversión" en la hoja Desempeño-Pesca con slicer de vendedor.
-- Sin snapshot histórico todavía -> es la foto ACTUAL. Si se necesita
-- serie mes-a-mes, agregar tabla leads_snapshot_raw + vista de
-- evolución (ver §40 del README).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_leads_vs_clientes_por_vendedor` AS
SELECT
  IFNULL(NULLIF(JSON_VALUE(data, '$.assignedVendor'), ''), '(SIN ASIGNAR)') AS assigned_vendor,
  COUNTIF(
    JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  ) AS clientes_sap,
  COUNTIF(
    JSON_VALUE(data, '$.manualSapPending') = 'true'
    AND (
      JSON_VALUE(data, '$.cardCodeSap') IS NULL
      OR JSON_VALUE(data, '$.cardCodeSap') = ''
    )
  ) AS leads,
  COUNT(*) AS total_universo,
  SAFE_DIVIDE(
    COUNTIF(
      JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
      AND JSON_VALUE(data, '$.cardCodeSap') != ''
    ),
    COUNT(*)
  ) AS pct_conversion,
  CURRENT_TIMESTAMP() AS snapshot_at
FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
WHERE JSON_VALUE(data, '$.status') = 'approved'
  AND (
    JSON_VALUE(data, '$.assignedVendor') IS NULL
    OR NOT STARTS_WITH(JSON_VALUE(data, '$.assignedVendor'), 'ADMIN_')
  )
GROUP BY assigned_vendor
ORDER BY total_universo DESC;

-- ============================================================
-- V_REMITOS_LINEAS
-- ============================================================
-- Fuente REMITIDO para Power BI (vs Facturado / Cobrado). Alineada 1:1
-- con v_ventas_lineas para que Power BI clone la card "Facturacion por
-- Vendedor" cambiando SOLO la vista fuente.
--
-- Regla hibrida MAX(delivery, invoice) — decidida el 2026-08-03 tras
-- confirmar por probe que en Shimano SAP coexisten 2 caminos comerciales:
--   * Camino A (frecuente, ej: SEBASTIAN SALES fact 18364, SO 35063):
--     SO -> Invoice directo, sin Delivery Note. El "remitido" no existe
--     como documento formal en SAP; usamos la fecha de factura como
--     fallback.
--   * Camino C (dominante en volumen): SO -> Delivery + Invoice paralelas.
--     Las 18k+ DeliveryNotes existen pero NO se linkean doc-a-doc con la
--     Invoice (BaseType=15 en solo 5 de 4.681 facturas). Se matchean con
--     el SO comun (Delivery.BaseEntry = Invoice.BaseEntry).
--
-- Estructura:
--   1. `deliveries` — TODAS las lineas de DeliveryNotes no canceladas.
--      fecha_remito = ODLN.DocDate.
--   2. `invoices_sin_delivery` — lineas de facturas que NO tienen match
--      en `deliveries` por (SO_DocEntry, SO_LineNum). Fallback:
--      fecha_remito = OINV.DocDate.
--   3. UNION ALL + LEFT JOINs con client_applications (assigned_vendor)
--      y v_sap_items_enriched (familia/subfamilia/is_pesca).
--
-- Uso Power BI (TABLERO SAR): nueva card "REMITIDO" en la hoja
-- Facturacion por Vendedor con `SUM(importe_linea_ars)` filtrado por mes
-- actual + slicer vendor. El % Cumplimiento del vendedor deberia
-- calcularse sobre esta vista, NO sobre v_ventas_lineas.
--
-- Volumen esperado (ventana 24 meses): ~5-8k rows (~15 MB BQ).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_remitos_lineas` AS
WITH
cliente_app AS (
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      JSON_VALUE(data, '$.assignedVendor')
      IGNORE NULLS
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS assigned_vendor_app
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
),
items AS (
  -- v_sap_items_enriched no tiene columnas 'familia'/'subfamilia'/'is_pesca'
  -- directas; se derivan como en v_ventas_lineas: familia=familia_norm,
  -- subfamilia=fam, is_pesca=item_code IS NOT NULL (existe en sap_items_raw).
  SELECT
    item_code,
    familia_norm                 AS familia,
    fam                          AS subfamilia,
    item_code IS NOT NULL        AS is_pesca
  FROM `app-vendedores-shimano.shimano_app.v_sap_items_enriched`
),
deliveries AS (
  SELECT
    'DELIVERY' AS source,
    d.doc_entry                                                       AS remito_doc_entry,
    d.doc_num                                                         AS remito_doc_num,
    d.doc_date,
    EXTRACT(YEAR  FROM d.doc_date)                                    AS anio,
    EXTRACT(MONTH FROM d.doc_date)                                    AS mes,
    d.card_code,
    d.card_name,
    d.sales_person_code,
    d.doc_currency,
    d.doc_rate,
    SAFE_CAST(JSON_VALUE(ln, '$.LineNum')    AS INT64)                AS line_num,
    JSON_VALUE(ln, '$.ItemCode')                                      AS item_code,
    JSON_VALUE(ln, '$.Dscription')                                    AS descripcion_linea,
    SAFE_CAST(JSON_VALUE(ln, '$.Quantity')   AS FLOAT64)              AS cantidad,
    SAFE_CAST(JSON_VALUE(ln, '$.LineTotal')  AS FLOAT64)              AS importe_linea_ars,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry')  AS INT64)                AS so_doc_entry,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseLine')   AS INT64)                AS so_line_num
  FROM `app-vendedores-shimano.shimano_app.sap_deliveries_raw` d,
       UNNEST(JSON_QUERY_ARRAY(d.lines_json)) AS ln
  WHERE d.cancelled = 'tNO'
),
invoices_sin_delivery AS (
  SELECT
    'INVOICE_NO_DELIVERY' AS source,
    i.doc_entry                                                       AS remito_doc_entry,
    i.doc_num                                                         AS remito_doc_num,
    i.doc_date,
    EXTRACT(YEAR  FROM i.doc_date)                                    AS anio,
    EXTRACT(MONTH FROM i.doc_date)                                    AS mes,
    i.card_code,
    i.card_name,
    i.sales_person_code,
    i.doc_currency,
    i.doc_rate,
    SAFE_CAST(JSON_VALUE(ln, '$.LineNum')    AS INT64)                AS line_num,
    JSON_VALUE(ln, '$.ItemCode')                                      AS item_code,
    JSON_VALUE(ln, '$.Dscription')                                    AS descripcion_linea,
    SAFE_CAST(JSON_VALUE(ln, '$.Quantity')   AS FLOAT64)              AS cantidad,
    SAFE_CAST(JSON_VALUE(ln, '$.LineTotal')  AS FLOAT64)              AS importe_linea_ars,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry')  AS INT64)                AS so_doc_entry,
    SAFE_CAST(JSON_VALUE(ln, '$.BaseLine')   AS INT64)                AS so_line_num
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` i,
       UNNEST(JSON_QUERY_ARRAY(i.lines_json)) AS ln
  WHERE i.cancelled = 'tNO'
    AND JSON_VALUE(ln, '$.BaseType') = '17'    -- solo lineas que vienen de SO
    AND NOT EXISTS (
      SELECT 1
      FROM deliveries d
      WHERE d.so_doc_entry = SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry') AS INT64)
        AND d.so_line_num  = SAFE_CAST(JSON_VALUE(ln, '$.BaseLine')  AS INT64)
    )
),
unioned AS (
  SELECT * FROM deliveries
  UNION ALL
  SELECT * FROM invoices_sin_delivery
)
SELECT
  u.source,
  u.remito_doc_entry,
  u.remito_doc_num,
  u.doc_date,
  u.anio,
  u.mes,
  u.card_code,
  u.card_name,
  u.item_code,
  u.descripcion_linea,
  u.cantidad,
  u.importe_linea_ars,
  it.is_pesca,
  it.familia,
  it.subfamilia,
  u.sales_person_code,
  CASE
    WHEN u.sales_person_code BETWEEN 50 AND 55 THEN u.sales_person_code
    ELSE NULL
  END                              AS `SlpCode Asignado`,
  ca.assigned_vendor_app           AS assigned_vendor,
  u.so_doc_entry,
  u.doc_currency,
  u.doc_rate
FROM unioned u
LEFT JOIN items       it ON it.item_code = u.item_code
LEFT JOIN cliente_app ca ON ca.card_code = u.card_code;
