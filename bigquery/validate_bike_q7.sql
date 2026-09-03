-- Q7 (GATE): valuacion inventario al costo — esperado: valor_inventario_costo_ars > 0
-- Si > 0, el bug de Pesca (valuacion en 0) NO se replica en Bike.
SELECT
  ROUND(SUM(stock_deposito * costo_promedio_ars), 0) AS valor_inventario_costo_ars,
  ROUND(SUM(stock_deposito * precio_venta_usd), 0) AS valor_inventario_venta_usd
FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`
WHERE stock_deposito > 0;
