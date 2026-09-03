-- Q6: cobertura de costo y precio (esperado: ~5.386 costo ARS, ~5.381 USD, ~6.811 precio venta)
SELECT
  COUNT(*) AS n_items,
  COUNTIF(costo_promedio_ars IS NOT NULL) AS con_costo_ars,
  COUNTIF(costo_usd IS NOT NULL) AS con_costo_usd,
  COUNTIF(precio_venta_usd IS NOT NULL) AS con_precio_venta
FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`;
