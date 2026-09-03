-- Q4: stock dep 10 + transito 02 (esperado: ambos > 0)
SELECT
  SUM(stock_deposito) AS sum_dep_10,
  SUM(stock_transito) AS sum_dep_02
FROM `app-vendedores-shimano.shimano_app.v_inventario_bike`;
