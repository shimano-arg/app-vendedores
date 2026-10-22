# K — D3 Doble conteo SAP @ 2026-10-22T19:46:43.759Z

Líneas `state=confirmed` + `asigReserva!=false` + `lineReservesStock=true` + 
`pedido.transferidoSAP.orderDocEntry != null`.

Esas líneas HOY reservan stock en la app, pero SAP también las descuenta 
de Available porque la cotización ya se convirtió en orden de venta. Doble conteo.

## Hallazgo pre-fix v1400 §40.8

- Líneas afectadas: **0**
- Unidades: **0**
- SKUs únicos: **0**

## Top 50 SKUs por unidades afectadas

| SKU | Fisico Dep 11 | Lineas | Unidades |
|---|---:|---:|---:|

## Interpretación

Al mergear v1400 §40.8, `lineReservesStock('confirmed')` devolverá `false` 
para estas líneas. El bucket `asignadas`/`confirmed` del breakdown baja N u 
por SKU → `libre` sube el mismo delta (hasta el cap físico).

Script: `scripts/audit/K_confirmed_con_order_docentry.cjs`.
