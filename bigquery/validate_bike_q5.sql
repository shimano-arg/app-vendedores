-- Q5: warehouses en la vista wide (esperado: incluye 10 y 02)
SELECT
  warehouse_code,
  COUNT(*) AS n_items,
  ROUND(SUM(stock_qty), 0) AS sum_qty
FROM `app-vendedores-shimano.shimano_app.v_inventario_bike_por_warehouse`
GROUP BY warehouse_code
ORDER BY warehouse_code;
