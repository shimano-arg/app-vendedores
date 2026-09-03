-- ============================================================
-- bike.sql — vistas del tablero Power BI de Bike (division bicicletas).
-- v777 (2026-09-03). Diseñadas por COWORK/Mariano tras diagnostico Q1-Q4.
--
-- Pipeline aditivo: NO toca sap_items_raw (tablero Pesca en produccion).
-- Fuente: sap_items_bike_raw (poblada por scripts/sync_sap_to_bigquery.py
-- pass Items BIKE, ~7.000 items del grupo SAP 100).
--
-- Convencion:
--   - Todos los objetos usan sufijo `_bike` para no chocar con Pesca.
--   - Valuacion inventario al COSTO en ARS (cost_avg_ars viene de price
--     list 11 "COSTO ARTICULO ARS", no de campo del Item).
--   - Stock vendible = warehouse 10 SOLO (whitelist). Transito = warehouse
--     02 en columna aparte, NO sumado al vendible.
--   - Moneda: precios en USD sin convertir. El tipo de cambio se aplica
--     del lado del modelo Power BI con doc_rate de facturas.
-- ============================================================


-- ============================================================
-- v_inventario_bike
-- Una fila por item. Uso principal: cards KPI + tabla resumen del
-- tablero Bike (stock total, valor al costo, breakdown por warehouse).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_inventario_bike` AS
SELECT
    item_code,
    item_name,
    -- v778: categorizacion Bike desde UDFs OITM. Bike NO tiene solapa
    -- Ficha Tecnica Pesca (donde viven U_P_FAMILIA/etc). Usa UDFs
    -- generales sin prefijo U_P_. La decision de que UDF es "familia"
    -- para el modelo Power BI se toma del lado modelo (arrastrar el
    -- campo). Los 8 UDFs se exponen aca con nombres semanticos.
    marca,
    categoria,           -- U_CATEG: nivel alto — ~5 valores distintos
    clase,               -- U_CLASS: ~64 valores
    mss,                 -- U_MSS: ~56 valores
    subcategoria,        -- U_CATEGORIA: nivel fino — ~114 valores
    modelo,              -- U_MODELCD: ~1.603 valores
    ciclo_producto,      -- U_CICLO_PROD: activo/discontinuado/etc
    -- Stock por warehouse: warehouse 10 es vendible, 02 es transito.
    -- COALESCE a 0 porque no todos los items tienen todos los warehouses
    -- configurados en OITW — si SAP no reporta la clave "10" para un
    -- item, Power BI espera 0 y no NULL para poder sumar.
    COALESCE(
      SAFE_CAST(JSON_VALUE(stock_by_warehouse_json, '$."10"') AS FLOAT64),
      0
    ) AS stock_deposito,
    COALESCE(
      SAFE_CAST(JSON_VALUE(stock_by_warehouse_json, '$."02"') AS FLOAT64),
      0
    ) AS stock_transito,
    stock_total_sellable,
    -- Costos y precio venta. cost_avg_ars y cost_usd tipados FLOAT64
    -- desde el schema explicito en el pipeline (no dependen de autodetect).
    -- v778: costo_articulo_usd es una 2da fuente de costo USD desde UDF
    -- U_COS_ART_USD, independiente de price list 7. Sirve para cross-check
    -- contra la valuacion.
    cost_avg_ars       AS costo_promedio_ars,
    cost_usd           AS costo_usd,
    costo_articulo_usd,
    price_bike_usd     AS precio_venta_usd,
    valid,
    frozen,
    _sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_items_bike_raw`;


-- ============================================================
-- v_inventario_bike_por_warehouse
-- Una fila por item × warehouse. El JSON stock_by_warehouse_json
-- desarmado del lado BigQuery (Power Query se rompe por timeout al
-- parsearlo del lado modelo).
--
-- JSON_KEYS(json_expr, max_depth) esta disponible en BQ SQL desde 2024
-- y ya lo usamos en backorder_app.sql — funciona. Si en algun momento
-- BQ lo deprecara, hay un fallback comentado abajo con UNNEST literal
-- de la lista fija de warehouses Bike.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_inventario_bike_por_warehouse` AS
SELECT
    i.item_code,
    i.item_name,
    -- v778: categorizacion desde UDFs OITM (mismo comentario que
    -- v_inventario_bike). Se agregan las 4 mas utiles para filtrar
    -- del lado modelo (marca, categoria, subcategoria, modelo).
    i.marca,
    i.categoria,
    i.subcategoria,
    i.modelo,
    k AS warehouse_code,
    -- JSON_QUERY(x, '$."k"') no acepta path dinamico; usamos PARSE_JSON
    -- + subscript operator con el string key.
    SAFE_CAST(
      JSON_VALUE(PARSE_JSON(i.stock_by_warehouse_json)[k]) AS FLOAT64
    ) AS stock_qty,
    i.cost_avg_ars AS costo_promedio_ars,
    i._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_items_bike_raw` AS i,
     UNNEST(JSON_KEYS(PARSE_JSON(i.stock_by_warehouse_json), 1)) AS k
WHERE i.stock_by_warehouse_json IS NOT NULL;

-- ---------- FALLBACK (comentado, activar solo si JSON_KEYS falla) ----
-- Reemplaza el FROM ... UNNEST(JSON_KEYS(...)) por:
-- FROM `app-vendedores-shimano.shimano_app.sap_items_bike_raw` AS i,
--      UNNEST(['01','02','03','04','05','06','07','10','11','12','97','98','99']) AS k
-- WHERE i.stock_by_warehouse_json IS NOT NULL
--   AND JSON_VALUE(i.stock_by_warehouse_json, CONCAT('$."', k, '"')) IS NOT NULL;
-- ---------- FIN FALLBACK -------------------------------------------


-- ============================================================
-- Queries de validacion (correr con `bq query --use_legacy_sql=false`
-- despues del primer sync exitoso al pipeline)
-- ============================================================

-- 1) Tamaño de la tabla (esperado ~7.000, no 4.000)
-- SELECT COUNT(*) AS n_items FROM `app-vendedores-shimano.shimano_app.sap_items_bike_raw`;

-- 2) Grupo unico
-- SELECT DISTINCT items_group_code FROM `app-vendedores-shimano.shimano_app.sap_items_bike_raw`;
-- Esperado: solo 100.

-- 3) Sap items Pesca intacta (no la tocamos)
-- SELECT COUNT(*) AS n_items_pesca FROM `app-vendedores-shimano.shimano_app.sap_items_raw`;
-- Esperado: sigue en 773.

-- 4) Sum stock deposito + transito
-- SELECT
--   SUM(stock_deposito) AS sum_dep_10,
--   SUM(stock_transito) AS sum_dep_02
-- FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`;
-- Esperado: ambos > 0.

-- 5) Warehouses distintos en la vista wide
-- SELECT warehouse_code, COUNT(*) AS n_items, SUM(stock_qty) AS sum_qty
-- FROM `app-vendedores-shimano.shimano_app.v_inventario_bike_por_warehouse`
-- GROUP BY warehouse_code
-- ORDER BY warehouse_code;
-- Esperado: incluye 10 (deposito) y 02 (transito).

-- 6) Cobertura de costo
-- SELECT
--   COUNT(*) AS n_items,
--   COUNTIF(costo_promedio_ars IS NULL) AS sin_costo_ars,
--   COUNTIF(costo_promedio_ars IS NOT NULL) AS con_costo_ars,
--   COUNTIF(costo_usd IS NULL) AS sin_costo_usd,
--   COUNTIF(precio_venta_usd IS NULL) AS sin_precio_venta
-- FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`;
-- Esperado (segun COWORK): 5.386 con cost_ars, 5.381 con cost_usd, 6.811 con precio_venta.

-- 7) Valuacion inventario al costo (control)
-- SELECT
--   SUM(stock_deposito * costo_promedio_ars) AS valor_inventario_costo_ars,
--   SUM(stock_deposito * precio_venta_usd)   AS valor_inventario_venta_usd
-- FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`
-- WHERE stock_deposito > 0;
-- Esperado: valor_inventario_costo_ars > 0 (el bug de Pesca no se replica).

-- 8) v778: Cobertura UDFs OITM Bike (esperado post-probe: >83% cada uno
--    segun conteo COWORK; excepto U_PARTCD/U_COLOR que no incluimos).
-- SELECT
--   COUNT(*) AS n_items,
--   COUNTIF(marca IS NOT NULL) AS con_marca,
--   COUNTIF(categoria IS NOT NULL) AS con_categoria,
--   COUNTIF(clase IS NOT NULL) AS con_clase,
--   COUNTIF(mss IS NOT NULL) AS con_mss,
--   COUNTIF(subcategoria IS NOT NULL) AS con_subcategoria,
--   COUNTIF(modelo IS NOT NULL) AS con_modelo,
--   COUNTIF(ciclo_producto IS NOT NULL) AS con_ciclo_producto,
--   COUNTIF(costo_articulo_usd IS NOT NULL) AS con_costo_articulo_usd
-- FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`;

-- 9) v778: cross-check U_COS_ART_USD vs cost_usd (price list 7).
--    Ambos deberian estar cerca en items donde hay data. Si divergen
--    mucho, la fuente correcta puede ser una u otra.
-- SELECT
--   COUNT(*) AS n_items_ambos,
--   ROUND(AVG(costo_articulo_usd - costo_usd), 4) AS avg_diff_udf_minus_list,
--   ROUND(STDDEV(costo_articulo_usd - costo_usd), 4) AS stddev_diff,
--   ROUND(SUM(stock_deposito * costo_articulo_usd), 0) AS valor_stock_udf_usd,
--   ROUND(SUM(stock_deposito * costo_usd), 0) AS valor_stock_list_usd
-- FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`
-- WHERE stock_deposito > 0
--   AND costo_articulo_usd IS NOT NULL
--   AND costo_usd IS NOT NULL;

-- 10) v778: distribucion de valores en categoria (5 esperados por COWORK).
-- SELECT categoria, COUNT(*) AS n_items
-- FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`
-- GROUP BY categoria
-- ORDER BY n_items DESC;
